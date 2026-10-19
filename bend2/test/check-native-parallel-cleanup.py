#!/usr/bin/env python3
"""Check cleanup ownership for settled native-suite runs."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'bend2/scripts/check-native-parallel.py'
SPEC = importlib.util.spec_from_file_location('check_native_parallel', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeSuiteCleanupTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
