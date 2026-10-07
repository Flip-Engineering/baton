#!/usr/bin/env python3
"""Exercise the comparison helper against an explicitly selected historical source.

This external integration requires --old-repo, --old-ref and a fresh --output.
The exported source, helper stderr, stores, response and process receipts remain
in that output. The ordinary native suite covers status validation and helper
lifecycle without requiring historical Git objects or JavaScript runtime files.
"""
import argparse
import contextlib
import copy
import importlib.util
import io
import json
import os
import pathlib
import shutil
import sys
import tarfile
import traceback
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('comparison_driver',
                                            ROOT / 'bend2/scripts/compare-coordinators.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)
PROCESSES = []


def process_records():
    return [{'case': case, 'pid': process.pid, 'exit_code': process.returncode}
            for case, process in PROCESSES]


class RecordedOutput:
    def __init__(self, stream, path):
        self.stream, self.saved = stream, path.open('w')

    @property
    def closed(self):
        return self.stream.closed

    def readline(self):
        line = self.stream.readline()
        self.saved.write(line)
        self.saved.flush()
        return line

    def close(self):
        self.saved.write(self.stream.read())
        self.stream.close()
        self.saved.close()


class OriginalStatus(unittest.TestCase):
    @contextlib.contextmanager
    def retained_case(self):
        path = OUTPUT / self._testMethodName
        path.mkdir()
        try:
            yield path
        finally:
            processes = [process for process in process_records() if process['case'] == path.name]
            (path / 'processes.json').write_text(json.dumps(processes, indent=2) + '\n')

    def start_old(self, path, env):
        launch = DRIVER.subprocess.Popen
        def recorded(*args, **kwargs):
            process = launch(*args, **kwargs)
            PROCESSES.append((path.name, process))
            process.stdout = RecordedOutput(process.stdout, path / 'helper.stdout')
            return process
        with mock.patch.object(DRIVER.subprocess, 'Popen', recorded):
            return DRIVER.Old(shutil.which('node'), SOURCE, path / 'store', 2, path, env)

    def test_participants_and_parked_guidance_use_the_original_production_helper(self):
        with self.retained_case() as path:
            (path / 'home').mkdir()
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                   'HOME': str(path / 'home'), 'LANG': 'en_US.UTF-8'}
            old = self.start_old(path, env)
            try:
                old.call('setup')
                workers = {'worker-0', 'worker-1'}
                answer, _ = old.call('workers')
                DRIVER.assert_original_status(answer, workers, {})
                guides = {}
                for ident in sorted(workers):
                    text = 'Retained Unicode λ guidance to ' + ident
                    saved, _ = old.call('guide', id=ident + '-guide', worker=ident, body=text)
                    guides[saved['guide']['messageId']] = (ident, text)
                answer, _ = old.call('workers')
                DRIVER.assert_original_status(answer, workers, guides)
                (path / 'participants.json').write_text(json.dumps(answer, indent=2) + '\n')
                with self.assertRaisesRegex(RuntimeError, 'Unknown operation unsupported-operation'):
                    old.call('unsupported-operation')
                answer, _ = old.call('workers')
                DRIVER.assert_original_status(answer, workers, guides)
                wrong = copy.deepcopy(answer)
                wrong['participants'].append(copy.deepcopy(wrong['participants'][0]))
                with self.assertRaises(AssertionError):
                    DRIVER.assert_original_status(wrong, workers, guides)
                wrong = copy.deepcopy(answer)
                wrong['participants'][0]['guidance'][0]['delivery']['state'] = 'delivered'
                with self.assertRaises(AssertionError):
                    DRIVER.assert_original_status(wrong, workers, guides)
                wrong = copy.deepcopy(answer)
                left, right = wrong['participants']
                left['guidance'], right['guidance'] = right['guidance'], left['guidance']
                with self.assertRaises(AssertionError):
                    DRIVER.assert_original_status(wrong, workers, guides)
            finally:
                old.close()
            self.assertEqual(old.process.returncode, 0)
            self.assertTrue(old.process.stdin.closed)
            self.assertTrue(old.process.stdout.closed)
            self.assertTrue(old.stderr.closed)

    def test_stdout_eof_is_reported_and_the_production_helper_is_reaped(self):
        with self.retained_case() as path:
            (path / 'home').mkdir()
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                   'HOME': str(path / 'home'), 'LANG': 'en_US.UTF-8'}
            old = self.start_old(path, env)
            try:
                old.call('setup')
                old.process.stdin.close()
                with self.assertRaisesRegex(RuntimeError, 'stdout reached EOF'):
                    old.read()
            finally:
                old.close()
            self.assertEqual(old.process.returncode, 0)
            self.assertTrue(old.process.stdin.closed)
            self.assertTrue(old.process.stdout.closed)
            self.assertTrue(old.stderr.closed)


def main():
    global OUTPUT, SOURCE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old-repo', type=pathlib.Path, required=True)
    parser.add_argument('--old-ref', required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args, test_args = parser.parse_known_args()
    OUTPUT = args.output.resolve()
    OUTPUT.mkdir(parents=True, exist_ok=False)
    with (OUTPUT / 'stdout').open('w') as stdout, (OUTPUT / 'stderr').open('w') as stderr:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                return run(args, test_args)
            except Exception as error:
                traceback.print_exc()
                (OUTPUT / 'failure.json').write_text(json.dumps({
                    'error': repr(error), 'processes': process_records()}, indent=2) + '\n')
                return 1


def run(args, test_args):
    global SOURCE
    SOURCE = OUTPUT / 'old-source'
    SOURCE.mkdir()
    commit = DRIVER.git(args.old_repo, 'rev-parse', args.old_ref + '^{commit}')
    archive = DRIVER.execute(['git', '-C', args.old_repo, 'archive', commit,
                              'impl/src', 'impl/scripts', 'impl/package.json']).stdout
    (OUTPUT / 'source.tar').write_bytes(archive)
    with tarfile.open(fileobj=io.BytesIO(archive)) as packed:
        packed.extractall(SOURCE, filter='data')
    dependencies = args.old_repo.resolve() / 'impl/node_modules'
    if dependencies.exists():
        (SOURCE / 'impl/node_modules').symlink_to(dependencies, target_is_directory=True)
    receipt = {'old_repo': str(args.old_repo.resolve()), 'old_commit': commit,
               'old_tree': DRIVER.git(args.old_repo, 'rev-parse', commit + '^{tree}'),
               'source_archive_sha256': DRIVER.digest(OUTPUT / 'source.tar'),
               'dependencies': DRIVER.dependency_metadata(SOURCE, dependencies),
               'driver_sha256': DRIVER.digest(ROOT / 'bend2/scripts/compare-coordinators.py'),
               'helper_sha256': DRIVER.digest(DRIVER.HELPER),
               'test_sha256': DRIVER.digest(pathlib.Path(__file__)),
               'node': shutil.which('node'), 'status': 'running',
               'helper_stdout_capture': 'Complete decoded text from the helper stdout pipe; original stderr files are retained.'}
    (OUTPUT / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    result = unittest.main(argv=[sys.argv[0], *test_args], exit=False).result
    receipt.update(status='passed' if result.wasSuccessful() else 'failed',
                   tests_run=result.testsRun, failures=len(result.failures),
                   errors=len(result.errors), processes=process_records())
    (OUTPUT / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
