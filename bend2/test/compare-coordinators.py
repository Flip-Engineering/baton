"""Check comparison status assertions against production commands and incorrect answers."""
import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
SPEC = importlib.util.spec_from_file_location('comparison_driver',
                                            ROOT / 'bend2/scripts/compare-coordinators.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class NativeStatus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.path = pathlib.Path(cls.temp.name)
        cls.db = cls.path / 'state.db'
        cls.repo = cls.path / 'repo'
        for args in (['git', 'init', '-q', '-b', 'main', str(cls.repo)],
                     ['git', '-C', str(cls.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(cls.repo), 'config', 'user.name', 'Comparison fixture']):
            subprocess.run(args, check=True, capture_output=True)
        (cls.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(cls.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(cls.repo), 'commit', '-qm', 'Create status fixture'],
                       check=True, capture_output=True)
        base = subprocess.check_output(['git', '-C', str(cls.repo), 'rev-parse', 'HEAD'],
                                       text=True).strip()
        cls.call('attach', 'root', 'fixture-root', 'root-login', '')
        cls.call('role', 'root', 'conductor')
        cls.expected = {'root': {
            'id': 'root', 'parent': None, 'harness': 'fixture-root', 'model': '', 'effort': '',
            'native': 'root-login', 'observedHarness': '', 'observedModel': '', 'observedEffort': '',
            'endpoint': '', 'workspace': '', 'branch': '', 'base': '',
        }}
        for ident, parent, harness, model, effort in (
                ('alpha', 'root', 'omp', 'requested-alpha', 'high'),
                ('beta', 'alpha', 'codex', 'requested-beta', 'low')):
            workspace = str(cls.path / ident)
            branch = ident + '-branch'
            cls.call('recruit', ident, parent, harness, model, effort,
                     str(cls.repo), branch, workspace, base)
            observed = {'native': ident + '-login', 'observedHarness': 'observed-' + harness,
                        'observedModel': 'observed-' + model, 'observedEffort': 'medium'}
            cls.call('bind', ident, observed['native'], observed['observedHarness'],
                     observed['observedModel'], observed['observedEffort'])
            cls.expected[ident] = {
                'id': ident, 'parent': parent, 'harness': harness, 'model': model, 'effort': effort,
                **observed, 'endpoint': '', 'workspace': workspace, 'branch': branch, 'base': base,
            }
        cls.call('role', 'alpha', 'conductor')
        cls.call('report', 'alpha-report-1', 'alpha', 'Full Unicode λ report\n')
        cls.call('report', 'alpha-report-2', 'alpha', 'Second root report')
        cls.call('report', 'beta-report', 'beta', 'Report to the immediate parent')
        cls.call('message', 'alpha-guide', 'root', 'alpha', 'guidance', 'Review the task')
        cls.call('message', 'beta-guide-1', 'alpha', 'beta', 'guidance', 'Continue')
        cls.call('message', 'beta-guide-2', 'alpha', 'beta', 'guidance', 'Check the result')
        cls.before_ack = cls.call('status')
        cls.call('ack', 'alpha-report-1', 'root', 'Reviewed first report')
        cls.call('ack', 'alpha-guide', 'alpha', 'Accepted guidance')
        for ident in cls.expected:
            endpoint = json.dumps(['/usr/bin/true', ident])
            cls.call('connect', ident, cls.expected[ident]['native'], endpoint)
            cls.expected[ident]['endpoint'] = endpoint
        cls.pending = {'root': 1, 'alpha': 1, 'beta': 2}
        cls.valid = cls.call('status')

    @classmethod
    def call(cls, *args):
        result = subprocess.run([str(EXE), str(cls.db), *map(str, args)],
                                capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stderr)
        return json.loads(result.stdout)

    def test_production_status_keeps_metadata_and_counts_only_unaccepted_input(self):
        before_metadata = copy.deepcopy(self.expected)
        for row in before_metadata.values():
            row['endpoint'] = ''
        DRIVER.assert_bend_status(self.before_ack, before_metadata,
                                  {'root': 2, 'alpha': 2, 'beta': 2})
        DRIVER.assert_bend_status(self.valid, self.expected, self.pending)
        before = hashlib.sha256(self.db.read_bytes()).hexdigest()
        again = self.call('status')
        DRIVER.assert_bend_status(again, self.expected, self.pending)
        self.assertEqual(again, self.valid)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(), before)
        workers = self.call('workers')
        self.assertEqual({row['id'] for row in workers}, {'alpha', 'beta'})
        self.assertEqual({row['latestReportId'] for row in workers},
                         {'alpha-report-2', 'beta-report'})

    def test_missing_extra_and_duplicate_sessions_are_refused(self):
        responses = [self.valid[1:], self.valid + [copy.deepcopy(self.valid[0])]]
        extra = copy.deepcopy(self.valid)
        extra[0]['id'] = 'unknown-session'
        responses.append(extra)
        for response in responses:
            with self.subTest(identities=[row['id'] for row in response]):
                with self.assertRaises(AssertionError):
                    DRIVER.assert_bend_status(response, self.expected, self.pending)

    def test_missing_nullable_field_and_incorrect_metadata_are_refused(self):
        response = copy.deepcopy(self.valid)
        del next(row for row in response if row['id'] == 'root')['parent']
        with self.assertRaises(AssertionError):
            DRIVER.assert_bend_status(response, self.expected, self.pending)
        changes = {'parent': 'root', 'harness': 'wrong-harness', 'model': 'wrong-model',
                   'effort': 'high', 'native': 'wrong-login', 'observedHarness': 'wrong-observation',
                   'observedModel': 'wrong-observation', 'observedEffort': 'low',
                   'endpoint': '', 'workspace': str(self.path / 'alpha'),
                   'branch': 'alpha-branch', 'base': 'wrong-base'}
        for field, value in changes.items():
            with self.subTest(field=field):
                response = copy.deepcopy(self.valid)
                next(row for row in response if row['id'] == 'beta')[field] = value
                with self.assertRaises(AssertionError):
                    DRIVER.assert_bend_status(response, self.expected, self.pending)

    def test_incorrect_pending_counts_are_refused_per_recipient(self):
        for value in (0, '1', True):
            with self.subTest(value=value):
                response = copy.deepcopy(self.valid)
                next(row for row in response if row['id'] == 'root')['pending'] = value
                with self.assertRaises(AssertionError):
                    DRIVER.assert_bend_status(response, self.expected, self.pending)
        response = copy.deepcopy(self.valid)
        next(row for row in response if row['id'] == 'alpha')['pending'] = 2
        next(row for row in response if row['id'] == 'beta')['pending'] = 1
        with self.assertRaises(AssertionError):
            DRIVER.assert_bend_status(response, self.expected, self.pending)


class OriginalStatus(unittest.TestCase):
    def test_participants_and_parked_guidance_use_the_original_production_helper(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as temp:
            path = pathlib.Path(temp)
            (path / 'home').mkdir()
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                   'HOME': str(path / 'home'), 'LANG': 'en_US.UTF-8'}
            old = DRIVER.Old(shutil.which('node'), ROOT, path / 'store', 2, path, env)
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
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as temp:
            path = pathlib.Path(temp)
            (path / 'home').mkdir()
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                   'HOME': str(path / 'home'), 'LANG': 'en_US.UTF-8'}
            old = DRIVER.Old(shutil.which('node'), ROOT, path / 'store', 2, path, env)
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


class HelperCompletion(unittest.TestCase):
    def test_failed_launch_closes_the_owned_stderr_handle(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as temp:
            path = pathlib.Path(temp)
            handles = []
            launch = subprocess.Popen

            def capture_stderr(*args, **kwargs):
                handles.append(kwargs['stderr'])
                return launch(*args, **kwargs)

            try:
                with mock.patch.object(DRIVER.subprocess, 'Popen', capture_stderr):
                    with self.assertRaises(FileNotFoundError):
                        DRIVER.Old(str(path / 'missing-executable'), ROOT, path / 'store',
                                   1, path, os.environ.copy())
                self.assertTrue(handles)
                self.assertTrue(all(handle.closed for handle in handles))
            finally:
                for handle in handles:
                    handle.close()

    def test_subprocess_completion_preserves_success_and_complete_error_output(self):
        result = DRIVER.execute([sys.executable, '-c', "print('Completed Unicode λ')"])
        self.assertEqual(result.stdout.decode().strip(), 'Completed Unicode λ')
        stderr = 'Failure starts here\n' + 'x' * 6000 + '\nFailure ends here\n'
        with self.assertRaises(RuntimeError) as caught:
            DRIVER.execute([sys.executable, '-c',
                            'import sys; sys.stderr.write(' + repr(stderr) + '); sys.exit(7)'])
        self.assertIn('exited 7', str(caught.exception))
        self.assertIn(stderr, str(caught.exception))

    def test_startup_eof_and_invalid_greeting_close_owned_processes_and_handles(self):
        fixtures = {
            'eof': ("import sys\nsys.stderr.write('Startup fixture failed\\n')\nsys.exit(9)\n",
                    'stdout reached EOF', 9),
            'invalid-greeting': ("import sys\nprint('{\"ready\": false}', flush=True)\nsys.stdin.read()\n",
                                 'did not become ready', 0),
        }
        for name, (source, error, exit_code) in fixtures.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as temp:
                path = pathlib.Path(temp)
                helper = path / 'helper.py'
                helper.write_text(source)
                processes = []
                launch = subprocess.Popen

                def capture_process(*args, **kwargs):
                    process = launch(*args, **kwargs)
                    processes.append((process, kwargs['stderr']))
                    return process

                try:
                    with mock.patch.object(DRIVER, 'HELPER', helper), \
                            mock.patch.object(DRIVER.subprocess, 'Popen', capture_process):
                        with self.assertRaisesRegex(RuntimeError, error) as caught:
                            DRIVER.Old(sys.executable, ROOT, path / 'store', 1, path, os.environ.copy())
                    process, stderr = processes[0]
                    self.assertEqual(process.returncode, exit_code)
                    self.assertTrue(process.stdin.closed)
                    self.assertTrue(process.stdout.closed)
                    self.assertTrue(stderr.closed)
                    if name == 'eof':
                        self.assertIn(str(stderr.name), str(caught.exception))
                        self.assertEqual(pathlib.Path(stderr.name).read_text(), 'Startup fixture failed\n')
                finally:
                    for process, stderr in processes:
                        if not process.stdin.closed:
                            process.stdin.close()
                        process.wait()
                        process.stdout.close()
                        stderr.close()


if __name__ == '__main__':
    unittest.main()
