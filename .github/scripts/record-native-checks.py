#!/usr/bin/env python3
"""Record selected unittest outcomes during the native suite and compare trees."""
import ast
import ctypes
from contextlib import nullcontext
import hashlib
import json
import os
import pathlib
import runpy
import shlex
import signal
import stat
import subprocess
import sys
import threading
import time
import traceback
import unittest
import uuid

SELECTED = (
    'root-wake.py', 'coordinator.py', 'receive.py', 'turn.py',
    'receive-output.py', 'fixed-coordinator.py',
    'agent-actions.py', 'agent-input.py', 'completion-identity.py', 'task-start.py', 'mcp-command.py',
    'mcp-contract.py', 'mcp-root.py',
    'control.py', 'control-identity.py', 'configure.py', 'account-credits.py',
)

# A quiet period lasts this many seconds without output, an open file changing,
# or computing. Computing means a persistent process uses at least half of the
# elapsed sample interval on CPU.
STALL_SECONDS = float(os.environ.get('BATON2_STALL_SECONDS', '900'))
STALL_SAMPLE_SECONDS = float(os.environ.get('BATON2_STALL_SAMPLE_SECONDS', '5'))


def task_stat(path):
    text = pathlib.Path(path + '/stat').read_text()
    return text[text.rindex(')') + 2:].split()


def process_row(pid, watcher):
    try:
        rest = task_stat('/proc/%d' % pid)
        cpu = int(rest[11]) + int(rest[12])
        if pid == os.getpid():
            cpu = 0
            for tid in os.listdir('/proc/%d/task' % pid):
                if int(tid) == watcher:
                    continue
                try:
                    task = task_stat('/proc/%d/task/%s' % (pid, tid))
                    cpu += int(task[11]) + int(task[12])
                except (OSError, ValueError):
                    pass
        if rest[0] == 'Z':
            return None
        return int(rest[1]), int(rest[19]), cpu
    except (OSError, ValueError):
        return None


def process_tree(root, watcher):
    rows = {}
    for entry in os.listdir('/proc'):
        if entry.isdigit():
            row = process_row(int(entry), watcher)
            if row:
                rows[int(entry)] = row
    found, queue = [root] if root in rows else [], [root]
    while queue:
        parent = queue.pop()
        for pid, (ppid, _, _) in rows.items():
            if ppid == parent:
                found.append(pid)
                queue.append(pid)
    return {pid: rows[pid][1:] for pid in found}


class Stalled(Exception):
    """Raised in the test thread when the observed test made no progress."""


class Output:
    """Count writes through the observed process's text and binary streams."""

    def __init__(self, stream, count):
        self.stream, self.count = stream, count

    def write(self, value):
        written = self.stream.write(value)
        value = value if written is None else value[:written]
        if isinstance(value, str):
            value = value.encode(getattr(self.stream, 'encoding', None) or 'utf-8', errors='replace')
        self.count(len(value))
        return written

    def writelines(self, values):
        for value in values:
            self.write(value)

    def __getattr__(self, name):
        if name == 'buffer':
            return Output(self.stream.buffer, self.count)
        return getattr(self.stream, name)


def tagged_processes(tag):
    """Processes that inherited the observer's tag, including daemons that left the process tree."""
    needle = b'BATON2_OBSERVE_TAG=' + tag.encode() + b'\0'
    found = {}
    for entry in os.listdir('/proc'):
        if not entry.isdigit() or int(entry) == os.getpid():
            continue
        try:
            if needle in pathlib.Path('/proc/' + entry + '/environ').read_bytes():
                command = pathlib.Path('/proc/' + entry + '/cmdline').read_bytes().replace(b'\0', b' ')
                found[int(entry)] = command.decode(errors='replace').strip()
        except OSError:
            pass
    return found


def progress_snapshot(tag, watcher):
    root = os.getpid()
    processes, files = {}, {}
    for descriptor in (1, 2):
        try:
            info = os.fstat(descriptor)
            if stat.S_ISREG(info.st_mode):
                files[(info.st_dev, info.st_ino)] = (info.st_size, info.st_mtime_ns)
        except OSError:
            pass
    for pid in (root, *tagged_processes(tag)):
        row = process_row(pid, watcher)
        if row is None:
            if pid == root:
                raise OSError('cannot read observer process counters')
            continue
        processes[(pid, row[1])] = row[2]
        try:
            directory = '/proc/%d/fd' % pid
            descriptors = os.listdir(directory)
        except OSError:
            if pid == root:
                raise
            continue
        for descriptor in descriptors:
            try:
                path = directory + '/' + descriptor
                target = os.readlink(path)
                if target.startswith(('/dev/', '/proc/', 'pipe:', 'socket:', 'anon_inode:')):
                    continue
                info = os.stat(path)
                if stat.S_ISREG(info.st_mode):
                    files[(info.st_dev, info.st_ino)] = (info.st_size, info.st_mtime_ns)
            except OSError:
                pass
    return processes, files


def made_progress(before, after, elapsed, ticks):
    processes, files = after
    previous_processes, previous_files = before
    return any(key in previous_files and value != previous_files[key] for key, value in files.items()) or any(
        key in previous_processes and cpu - previous_processes[key] >= elapsed * ticks / 2
        for key, cpu in processes.items())


def stop_processes(root, watcher, tag, lock=None, current=None):
    """Stop descendants and tagged processes while the stalled phase remains current."""
    stopped = {}

    def victims():
        found = {pid: '' for pid in process_tree(root, watcher) if pid != root}
        found.update(tagged_processes(tag))
        return found

    for sent in (signal.SIGTERM, signal.SIGKILL):
        found = victims()
        with lock if lock is not None else nullcontext():
            if current is not None and not current():
                break
            if not found:
                break
            for pid, command in found.items():
                stopped.setdefault(pid, command)
                try:
                    os.kill(pid, sent)
                except OSError:
                    pass
        time.sleep(2)
    return [command for _, command in sorted(stopped.items()) if command]


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def shim(directory, output):
    directory.mkdir(parents=True, exist_ok=False)
    argv = [sys.executable, str(pathlib.Path(__file__).resolve()), 'observe', str(output.resolve()), '--']
    executable = directory / 'python3'
    executable.write_text('#!/bin/sh\nexec ' + ' '.join(shlex.quote(value) for value in argv) + ' "$@"\n')
    executable.chmod(0o755)


def run_row(result, expected, stalls):
    failures = [(test.id(), 'assertion') for test, _ in result.failures]
    failures.extend((test.id(), 'error') for test, _ in result.errors)
    failures.extend((test.id(), 'unexpected-success') for test in result.unexpectedSuccesses)
    failures.extend((test, 'stalled') for test in stalls)
    return {'expected_tests': expected, 'tests_run': result.testsRun, 'failures': failures,
            'skipped': [test.id() for test, _ in result.skipped],
            'expected_failures': [test.id() for test, _ in result.expectedFailures]}


def has_unittest(source):
    """Identify unittest entry points for the phase before the first runner call."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    modules, entries = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.asname or alias.name for alias in node.names if alias.name == 'unittest')
        elif isinstance(node, ast.ImportFrom) and node.module == 'unittest':
            entries.update(alias.asname or alias.name for alias in node.names
                           if alias.name in ('main', 'TextTestRunner'))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        function = node.func
        if isinstance(function, ast.Name) and function.id in entries:
            return True
        if (isinstance(function, ast.Attribute) and function.attr in ('main', 'TextTestRunner')
                and isinstance(function.value, ast.Name) and function.value.id in modules):
            return True
    return False


def observe(output, argv):
    if argv[:1] == ['--']:
        argv = argv[1:]
    tests = pathlib.Path('bend2/test').resolve()
    selected = {str(pathlib.Path('bend2/test', name).resolve()): name for name in SELECTED}
    path = pathlib.Path(argv[0]).resolve() if argv and argv[0].endswith('.py') else None
    if path is None or path.parent != tests or not path.is_file():
        os.execv(sys.executable, [sys.executable, *argv])
    # Every test file is watched for progress; the selected files also record outcomes.
    name = selected.get(str(path))
    source = path.read_bytes()
    document = {'file': 'bend2/test/' + path.name, 'argv': argv,
                'test_contract_sha256': hashlib.sha256(source).hexdigest(), 'runs': []}
    state = {'result': None, 'expected': 0, 'running': False, 'active': False,
             'current': '<import>' if has_unittest(source) else '<script>', 'generation': 0, 'stalls': [], 'output': 0, 'proc': sys.platform == 'linux', 'ending': None}
    lock = threading.Lock()
    stop = threading.Event()
    tag = uuid.uuid4().hex
    os.environ['BATON2_OBSERVE_TAG'] = tag
    runner = threading.main_thread().ident
    original = unittest.TextTestRunner.run
    start_test, stop_test = unittest.TestResult.startTest, unittest.TestResult.stopTest
    stdout, stderr = sys.stdout, sys.stderr

    def count_output(size):
        with lock:
            state['output'] += size

    def disable_liveness(error):
        with lock:
            note = state['proc']
            state['proc'] = False
        if note:
            print('record-native-checks: liveness disabled: /proc unavailable or unreadable: %s' % error,
                  file=stderr, flush=True)

    def started(result, test):
        with lock:
            state.update(result=result, current=test.id(), active=True)
            state['generation'] += 1
        start_test(result, test)

    def stopped(result, test):
        with lock:
            state['active'] = False
            state['generation'] += 1
        stop_test(result, test)

    def record(runner, suite):
        expected = suite.countTestCases()
        with lock:
            state.update(result=None, expected=expected, running=True, active=True, current='<import>', stalls=[])
            state['generation'] += 1
        try:
            result = original(runner, suite)
            with lock:
                if state['ending'] is None:
                    document['runs'].append(run_row(result, expected, state['stalls']))
            return result
        finally:
            with lock:
                state.update(running=False, active=False, current='<after-suite>')
                state['generation'] += 1

    def finish(status):
        failures = [failure for row in document['runs'] for failure in row['failures']]
        document['exit_code'] = status
        document['judged'] = bool(document['runs']) and all(
            row['expected_tests'] > 0 and row['tests_run'] == row['expected_tests'] and not row['skipped']
            for row in document['runs'])
        document['judged'] = document['judged'] and (
            (status == 0 and not failures) or (status == 1 and bool(failures)))
        # A stall outside a unittest run leaves part of the file unjudged.
        document['judged'] = document['judged'] and not any(
            phase in ('<import>', '<script>', '<after-suite>') for phase in document.get('stalled', []))
        if name:
            write(output / (name + '.json'), document)

    def end_file():
        # The final escalation also joins the watcher before cleanup and writing.
        watcher.join()
        try:
            try:
                leftover = stop_processes(os.getpid(), threading.get_native_id(), tag)
                if leftover:
                    document.setdefault('stopped_processes', []).extend(leftover)
            except OSError as error:
                disable_liveness(error)
            finish(1)
        finally:
            os._exit(1)

    def watch():
        pid, me = os.getpid(), threading.get_native_id()
        try:
            last = progress_snapshot(tag, me)
            ticks = os.sysconf('SC_CLK_TCK')
            sampled = changed = time.monotonic()
            identity, attempts, written = None, 0, 0
            while not stop.wait(STALL_SAMPLE_SECONDS):
                now = progress_snapshot(tag, me)
                sampled_now = time.monotonic()
                with lock:
                    current = state['current'], state['generation']
                    output = state['output']
                progress = output != written or made_progress(last, now, sampled_now - sampled, ticks)
                last, sampled, written = now, sampled_now, output
                if current != identity:
                    identity, attempts, changed = current, 0, sampled_now
                if progress:
                    changed = sampled_now
                if sampled_now - changed < STALL_SECONDS:
                    continue

                def still_current():
                    return not stop.is_set() and identity == (state['current'], state['generation'])

                with lock:
                    if not still_current():
                        continue
                    test, _ = identity
                    attempts += 1
                    if test not in document.setdefault('stalled', []):
                        document['stalled'].append(test)
                    if state['running'] and test not in state['stalls']:
                        state['stalls'].append(test)
                    print('record-native-checks: %s made no progress for %s seconds' % (test, STALL_SECONDS),
                          file=stderr, flush=True)
                    if attempts == 3:
                        if state['running'] and state['result'] is not None:
                            document['runs'].append(run_row(state['result'], state['expected'], state['stalls']))
                        state['active'] = False
                        stop.set()
                        state['ending'] = threading.Thread(target=end_file, daemon=True)
                        state['ending'].start()
                        return
                killed = stop_processes(pid, me, tag, lock, still_current)
                with lock:
                    if killed:
                        document.setdefault('stopped_processes', []).extend(killed)
                    if still_current() and state['active']:
                        ctypes.pythonapi.PyThreadState_SetAsyncExc(
                            ctypes.c_ulong(runner), ctypes.py_object(Stalled))
                last = progress_snapshot(tag, me)
                sampled = changed = time.monotonic()
        except OSError as error:
            disable_liveness(error)

    unittest.TestResult.startTest, unittest.TestResult.stopTest = started, stopped
    unittest.TextTestRunner.run = record
    watcher = None
    if state['proc']:
        sys.stdout, sys.stderr = Output(stdout, count_output), Output(stderr, count_output)
        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
    sys.path[0] = str(path.parent)
    sys.argv = argv
    status = 0
    try:
        runpy.run_path(str(path), run_name='__main__')
    except SystemExit as error:
        status = error.code if isinstance(error.code, int) else int(error.code is not None)
    except BaseException:
        traceback.print_exc()
        status = 1
    finally:
        with lock:
            state['active'] = False
            state['generation'] += 1
            stop.set()
            ending = state['ending']
        if watcher is not None:
            watcher.join()
        if ending is not None:
            ending.join()
        sys.stdout, sys.stderr = stdout, stderr
        unittest.TestResult.startTest, unittest.TestResult.stopTest = start_test, stop_test
        unittest.TextTestRunner.run = original
        status = 1 if document.get('stalled') and status == 0 else status
        try:
            if state['proc']:
                leftover = stop_processes(os.getpid(), threading.get_native_id(), tag)
                if leftover:
                    document.setdefault('stopped_processes', []).extend(leftover)
        except OSError as error:
            disable_liveness(error)
        finish(status)

    raise SystemExit(status)


def compare(candidate, target, output):
    rows = []
    accepted = True
    for name in SELECTED:
        row = {'file': 'bend2/test/' + name, 'judged': False}
        try:
            current = json.loads((candidate / (name + '.json')).read_text())
            before = json.loads((target / (name + '.json')).read_text())
            assert current['file'] == before['file'] == row['file']
            assert current['test_contract_sha256'] == before['test_contract_sha256']
            assert current['judged'] and before['judged']
            assert [run['expected_tests'] for run in current['runs']] == [run['expected_tests'] for run in before['runs']]
            current_failures = {(row['file'], test, kind) for run in current['runs'] for test, kind in run['failures']}
            target_failures = {(row['file'], test, kind) for run in before['runs'] for test, kind in run['failures']}
            row.update(judged=True, new_failures=sorted(current_failures - target_failures),
                       inherited_failures=sorted(current_failures & target_failures),
                       repaired_failures=sorted(target_failures - current_failures),
                       candidate=current, target=before)
            accepted = accepted and not row['new_failures']
        except (OSError, ValueError, KeyError, AssertionError) as error:
            row['cause'] = repr(error)
            accepted = False
        rows.append(row)
    write(output, {'status': 'accepted' if accepted else 'refused', 'files': rows})
    raise SystemExit(0 if accepted else 1)


def main():
    mode, *argv = sys.argv[1:]
    if mode == 'shim' and len(argv) == 2:
        shim(pathlib.Path(argv[0]), pathlib.Path(argv[1]))
    elif mode == 'observe':
        output, *arguments = argv
        observe(pathlib.Path(output), arguments)
    elif mode == 'compare' and len(argv) == 3:
        compare(*(pathlib.Path(value) for value in argv))
    else:
        raise SystemExit('usage: record-native-checks.py shim DIR RESULTS | observe RESULTS -- ARGS | compare CANDIDATE TARGET RESULT')


if __name__ == '__main__':
    main()
