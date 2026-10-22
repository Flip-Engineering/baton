#!/usr/bin/env python3
"""Record selected unittest outcomes during the native suite and compare trees."""
import hashlib
import json
import os
import pathlib
import runpy
import shlex
import subprocess
import sys
import traceback
import unittest

SELECTED = (
    'root-wake.py', 'coordinator.py', 'receive.py', 'turn.py',
    'receive-output.py', 'fixed-coordinator.py',
    'agent-actions.py', 'agent-input.py', 'task-start.py', 'mcp-command.py',
    'mcp-contract.py', 'mcp-root.py',
    'control.py', 'control-identity.py', 'configure.py', 'account-credits.py',
)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def shim(directory, output):
    directory.mkdir(parents=True, exist_ok=False)
    argv = [sys.executable, str(pathlib.Path(__file__).resolve()), 'observe', str(output.resolve()), '--']
    executable = directory / 'python3'
    executable.write_text('#!/bin/sh\nexec ' + ' '.join(shlex.quote(value) for value in argv) + ' "$@"\n')
    executable.chmod(0o755)


def observe(output, argv):
    if argv[:1] == ['--']:
        argv = argv[1:]
    selected = {str(pathlib.Path('bend2/test', name).resolve()): name for name in SELECTED}
    path = pathlib.Path(argv[0]).resolve() if argv else None
    queued = os.environ.get('BATON2_NATIVE_QUEUE')
    if queued:
        adapter = pathlib.Path(__file__).with_name('queue-native-checks.py')
        runpy.run_path(str(adapter))['install']()
    if path is None or str(path) not in selected:
        if queued and path is not None and path.is_file():
            sys.path[0] = str(path.parent)
            sys.argv = argv
            runpy.run_path(str(path), run_name='__main__')
            return
        os.execv(sys.executable, [sys.executable, *argv])
    name = selected[str(path)]
    document = {'file': 'bend2/test/' + name, 'argv': argv,
                'test_contract_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'runs': []}
    original = unittest.TextTestRunner.run

    def record(runner, suite):
        expected = suite.countTestCases()
        result = original(runner, suite)
        failures = [(test.id(), 'assertion') for test, _ in result.failures]
        failures.extend((test.id(), 'error') for test, _ in result.errors)
        failures.extend((test.id(), 'unexpected-success') for test in result.unexpectedSuccesses)
        document['runs'].append({'expected_tests': expected, 'tests_run': result.testsRun,
                                 'failures': failures,
                                 'skipped': [test.id() for test, _ in result.skipped],
                                 'expected_failures': [test.id() for test, _ in result.expectedFailures]})
        return result

    unittest.TextTestRunner.run = record
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
        document['exit_code'] = status
        document['judged'] = bool(document['runs']) and all(
            row['expected_tests'] > 0 and row['tests_run'] == row['expected_tests'] and not row['skipped']
            for row in document['runs'])
        failures = [failure for row in document['runs'] for failure in row['failures']]
        document['judged'] = document['judged'] and (
            (status == 0 and not failures) or (status == 1 and bool(failures)))
        write(output / (name + '.json'), document)
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
