#!/usr/bin/env python3
"""Check cleanup ownership for settled native-suite runs."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'bend2/scripts/check-native-parallel.py'
SPEC = importlib.util.spec_from_file_location('check_native_parallel', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeSuiteCleanupTest(unittest.TestCase):
    def test_process_group_probe_requires_an_empty_group(self):
        with patch.object(MODULE.os, 'killpg', side_effect=ProcessLookupError):
            self.assertFalse(MODULE.process_group_exists(123))
        with patch.object(MODULE.os, 'killpg', return_value=None):
            self.assertTrue(MODULE.process_group_exists(123))
        with patch.object(MODULE.os, 'killpg', side_effect=PermissionError):
            self.assertTrue(MODULE.process_group_exists(123))

    def test_success_removes_only_owned_scratch_and_keeps_results(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            work = root / 'native-suites-owned'
            ipc = root / 'b2-native-owned'
            output = root / 'durable-results'
            work.mkdir()
            (work / 'seed').mkdir()
            (work / '0').mkdir()
            ipc.mkdir()
            output.mkdir()
            (output / 'results.json').write_text('{"suite": "passed"}\n')
            (output / 'native-context.jsonl').write_text('{"event": "preserved"}\n')
            sibling = root / 'native-suites-unrelated'
            sibling.mkdir()
            (sibling / 'sentinel').write_text('keep')

            cleaned = MODULE.cleanup_successful_run(work, ipc, True)

            self.assertTrue(cleaned)
            self.assertFalse(work.exists())
            self.assertFalse(ipc.exists())
            self.assertEqual((output / 'results.json').read_text(), '{"suite": "passed"}\n')
            self.assertEqual((output / 'native-context.jsonl').read_text(),
                             '{"event": "preserved"}\n')
            self.assertEqual((sibling / 'sentinel').read_text(), 'keep')

    def test_failed_run_preserves_owned_scratch(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            work = root / 'native-suites-owned'
            ipc = root / 'b2-native-owned'
            work.mkdir()
            ipc.mkdir()
            (work / 'seed').mkdir()

            cleaned = MODULE.cleanup_successful_run(work, ipc, False)

            self.assertFalse(cleaned)
            self.assertTrue((work / 'seed').is_dir())
            self.assertTrue(ipc.is_dir())

    def make_repository(self, root):
        (root / 'bend2/test').mkdir(parents=True)
        (root / '.scratch/bend2').mkdir(parents=True)
        (root / 'bend2/test/one.py').write_text('print("fixture")\n')
        for name in ('baton2', 'process-test', 'process-test.c', 'instance-test',
                     'git-test', 'land-test'):
            (root / '.scratch/bend2' / name).write_text(name)
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(root)], check=True)
        subprocess.run(['git', '-C', str(root), 'config', 'user.name', 'Fixture'], check=True)
        subprocess.run(['git', '-C', str(root), 'config', 'user.email',
                        'fixture@example.invalid'], check=True)
        subprocess.run(['git', '-C', str(root), 'add', 'bend2'], check=True)
        subprocess.run(['git', '-C', str(root), 'commit', '-q', '-m', 'fixture'], check=True)

    def run_main_fixture(self, root, environment, return_code, remaining_process_group=False):
        real_popen = subprocess.Popen

        class FinishedProcess:
            pid = 2147483000

            def wait(self):
                return return_code

        def fake_popen(argv, *args, **kwargs):
            if not kwargs.get('start_new_session'):
                return real_popen(argv, *args, **kwargs)
            env = kwargs['env']
            destination = Path(env['FINAL_NATIVE_CONTEXT_EVIDENCE'])
            (destination / 'fixture.json').write_text(json.dumps({'argv': argv}))
            return FinishedProcess()

        stream = io.StringIO()
        with patch.object(MODULE, 'ROOT', root), \
                patch.object(MODULE, 'process_group_exists',
                             return_value=remaining_process_group), \
                patch.object(MODULE.subprocess, 'Popen', side_effect=fake_popen), \
                patch.object(sys, 'argv', ['check-native-parallel.py', sys.executable]), \
                patch.dict(os.environ, environment, clear=False), redirect_stdout(stream):
            for key in ('BATON2_LINUX_RUN',):
                if key not in environment:
                    os.environ.pop(key, None)
            result = MODULE.main()
        rows = [json.loads(line) for line in stream.getvalue().splitlines()]
        return result, rows[-1]

    def test_main_without_run_keeps_results_and_cleans_owned_trees(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / 'repository'
            root.mkdir()
            self.make_repository(root)
            result, summary = self.run_main_fixture(root, {}, 0)

            self.assertEqual(result, 0)
            self.assertEqual(summary['scratch_cleanup'], 'removed')
            self.assertFalse(Path(summary['work']).exists())
            self.assertTrue(Path(summary['results']).is_file())
            evidence_root = Path(summary['results']).parent
            rows = json.loads(Path(summary['results']).read_text())
            self.assertTrue(rows)
            for row in rows:
                native = Path(row['native_evidence'])
                self.assertTrue(native.is_dir())
                self.assertTrue((native / 'fixture.json').is_file())
                self.assertTrue(Path(row['stdout']).is_file())
            self.assertEqual(evidence_root.parent, root / '.scratch/bend2')

    def test_main_external_output_and_failed_suite_preserve_work(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / 'repository'
            run = Path(name) / 'run'
            (run / 'evidence').mkdir(parents=True)
            root.mkdir()
            self.make_repository(root)
            result, summary = self.run_main_fixture(root, {'BATON2_LINUX_RUN': str(run)}, 1)

            self.assertEqual(result, 1)
            self.assertEqual(summary['scratch_cleanup'], 'preserved')
            self.assertTrue(Path(summary['work']).is_dir())
            self.assertTrue(Path(summary['results']).is_file())
            rows = json.loads(Path(summary['results']).read_text())
            self.assertTrue(rows)
            for row in rows:
                self.assertTrue(Path(row['native_evidence']).is_dir())
                self.assertTrue((Path(row['native_evidence']) / 'fixture.json').is_file())

    def test_main_preserves_work_when_a_child_process_group_remains(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / 'repository'
            run = Path(name) / 'run'
            (run / 'evidence').mkdir(parents=True)
            root.mkdir()
            self.make_repository(root)
            result, summary = self.run_main_fixture(
                root, {'BATON2_LINUX_RUN': str(run)}, 0, remaining_process_group=True)

            self.assertEqual(result, 1)
            self.assertEqual(summary['scratch_cleanup'], 'preserved')
            self.assertTrue(Path(summary['work']).is_dir())
            rows = json.loads(Path(summary['results']).read_text())
            self.assertTrue(rows)
            self.assertTrue(all(row['process_group_empty'] is False for row in rows))
            self.assertTrue(all(row['child_exit_code'] == 0 for row in rows))


if __name__ == '__main__':
    unittest.main()
