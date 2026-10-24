#!/usr/bin/env python3
"""Record selected unittest outcomes during the native suite and compare trees."""
import hashlib
import json
import os
import pathlib
import runpy
import shlex
import signal
import subprocess
import sys
import threading
import time
import traceback
import unittest

SELECTED = (
    'root-wake.py', 'codex-root.py', 'omp-root.py',
    'coordinator.py', 'receive.py', 'turn.py',
    'receive-output.py', 'fixed-coordinator.py',
    'agent-actions.py', 'agent-input.py', 'task-start.py', 'mcp-command.py',
    'mcp-contract.py', 'mcp-root.py',
    'control.py', 'control-identity.py', 'configure.py', 'account-credits.py',
)

# An observed test file that shows no progress for this many seconds is treated as stalled.
# Progress is CPU time, read or write counters, output, or a change in the set of descendant processes.
STALL_SECONDS = float(os.environ.get('BATON2_STALL_SECONDS', '900'))
STALL_SAMPLE_SECONDS = float(os.environ.get('BATON2_STALL_SAMPLE_SECONDS', '5'))


def task_counters(path):
    text = pathlib.Path(path + '/stat').read_text()
    rest = text[text.rindex(')') + 2:].split()
    io = dict(line.split(': ') for line in pathlib.Path(path + '/io').read_text().splitlines())
    return rest, (int(rest[11]) + int(rest[12]),) + tuple(
        int(io.get(name, 0)) for name in ('rchar', 'wchar', 'syscr', 'syscw'))


def process_row(pid, watcher):
    try:
        rest, values = task_counters('/proc/%d' % pid)
        if pid == os.getpid():
            rows = [task_counters('/proc/%d/task/%s' % (pid, tid))[1]
                    for tid in os.listdir('/proc/%d/task' % pid) if int(tid) != watcher]
            values = tuple(map(sum, zip(*rows))) if rows else (0, 0, 0, 0, 0)
    except (OSError, ValueError):
        return None
    if rest[0] == 'Z':
        return None
    return int(rest[1]), values


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
        for pid, (ppid, _) in rows.items():
            if ppid == parent:
                found.append(pid)
                queue.append(pid)
    return {pid: rows[pid][1] for pid in found}


def stop_descendants(root, watcher):
    victims = [pid for pid in process_tree(root, watcher) if pid != root]
    for sent in (signal.SIGTERM, signal.SIGKILL):
        for pid in victims:
            try:
                os.kill(pid, sent)
            except OSError:
                pass
        time.sleep(2)
        victims = [pid for pid in victims if pid in process_tree(root, watcher)]


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


def observe(output, argv):
    if argv[:1] == ['--']:
        argv = argv[1:]
    selected = {str(pathlib.Path('bend2/test', name).resolve()): name for name in SELECTED}
    path = pathlib.Path(argv[0]).resolve() if argv else None
    if path is None or str(path) not in selected:
        os.execv(sys.executable, [sys.executable, *argv])
    name = selected[str(path)]
    document = {'file': 'bend2/test/' + name, 'argv': argv,
                'test_contract_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'runs': []}
    state = {'result': None, 'expected': 0, 'active': False, 'current': None, 'stalls': []}
    lock = threading.Lock()
    original = unittest.TextTestRunner.run
    start_test = unittest.TestResult.startTest

    def started(result, test):
        state['result'], state['current'] = result, test.id()
        start_test(result, test)

    def record(runner, suite):
        expected = suite.countTestCases()
        state.update(expected=expected, active=True, stalls=[])
        result = original(runner, suite)
        with lock:
            state['active'] = False
            document['runs'].append(run_row(result, expected, state['stalls']))
        return result

    def finish(status):
        failures = [failure for row in document['runs'] for failure in row['failures']]
        document['exit_code'] = status
        document['judged'] = bool(document['runs']) and all(
            row['expected_tests'] > 0 and row['tests_run'] == row['expected_tests'] and not row['skipped']
            for row in document['runs'])
        document['judged'] = document['judged'] and (
            (status == 0 and not failures) or (status == 1 and bool(failures)))
        write(output / (name + '.json'), document)

    def watch():
        pid, me = os.getpid(), threading.get_native_id()
        last, changed, stalled = process_tree(pid, me), time.monotonic(), None
        while True:
            time.sleep(STALL_SAMPLE_SECONDS)
            now = process_tree(pid, me)
            if now != last:
                last, changed = now, time.monotonic()
                continue
            if time.monotonic() - changed < STALL_SECONDS or not state['active']:
                continue
            test = state['current']
            print('record-native-checks: %s made no progress for %s seconds' % (test, STALL_SECONDS),
                  file=sys.stderr, flush=True)
            if test == stalled:
                with lock:
                    if state['active'] and state['result'] is not None:
                        document['runs'].append(run_row(state['result'], state['expected'], state['stalls']))
                    finish(1)
                os._exit(1)
            stalled = test
            state['stalls'].append(test)
            document.setdefault('stalled', []).append(test)
            stop_descendants(pid, me)
            last, changed = process_tree(pid, me), time.monotonic()

    unittest.TestResult.startTest = started
    unittest.TextTestRunner.run = record
    threading.Thread(target=watch, daemon=True).start()
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
        status = 1 if document.get('stalled') and status == 0 else status
        with lock:
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
