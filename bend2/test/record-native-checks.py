import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

RECORDER = pathlib.Path(__file__).resolve().parents[2] / '.github/scripts/record-native-checks.py'


def observe(body, stall='2', sample='0.2', file='root-wake.py'):
    with tempfile.TemporaryDirectory() as root:
        root = pathlib.Path(root)
        test = root / 'bend2/test' / file
        test.parent.mkdir(parents=True)
        test.write_text(
            'import subprocess, threading, time, unittest\n'
            'class Case(unittest.TestCase):\n'
            '    def test_body(self):\n' + ''.join('        ' + line + '\n' for line in body.splitlines()) +
            'if __name__ == "__main__":\n    unittest.main()\n')
        environment = dict(os.environ, BATON2_STALL_SECONDS=stall, BATON2_STALL_SAMPLE_SECONDS=sample)
        started = time.monotonic()
        result = subprocess.run([sys.executable, str(RECORDER), 'observe', str(root / 'out'), '--', 'bend2/test/' + file],
                                cwd=root, env=environment, capture_output=True, text=True, timeout=120)
        recorded = root / 'out' / (file + '.json')
        document = json.loads(recorded.read_text()) if recorded.exists() else None
        return result, document, time.monotonic() - started


class Liveness(unittest.TestCase):
    def test_a_test_waiting_on_a_silent_child_is_recorded_as_stalled(self):
        result, document, elapsed = observe("subprocess.run(['sleep', '600'])")
        self.assertEqual(result.returncode, 1)
        self.assertLess(elapsed, 60)
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Case.test_body', 'stalled']])
        self.assertTrue(document['judged'])

    def test_a_test_polling_for_a_condition_that_never_arrives_fails_with_a_stalled_error(self):
        result, document, elapsed = observe('while True:\n    time.sleep(0.05)')
        self.assertEqual(result.returncode, 1)
        self.assertLess(elapsed, 60)
        self.assertEqual(document['runs'][0]['failures'],
                         [['__main__.Case.test_body', 'error'], ['__main__.Case.test_body', 'stalled']])
        self.assertEqual(document['runs'][0]['tests_run'], 1)
        self.assertTrue(document['judged'])

    def test_a_daemon_left_behind_by_a_test_is_stopped_and_releases_the_output_pipe(self):
        result, document, elapsed = observe(
            "subprocess.Popen(['setsid', 'sleep', '600'])\nself.assertTrue(True)")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(elapsed, 60)
        self.assertEqual(len(document['stopped_processes']), 1)
        self.assertIn('sleep 600', document['stopped_processes'][0])
        self.assertTrue(document['judged'])

    def test_a_test_blocked_in_its_own_process_ends_the_file_with_a_stalled_failure(self):
        result, document, elapsed = observe('threading.Event().wait()')
        self.assertEqual(result.returncode, 1)
        self.assertLess(elapsed, 60)
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Case.test_body', 'stalled']])
        self.assertTrue(document['judged'])

    def test_a_test_using_cpu_is_not_stalled(self):
        result, document, _ = observe('end = time.monotonic() + 4\nwhile time.monotonic() < end:\n    pass')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(document['runs'][0]['failures'], [])
        self.assertNotIn('stalled', document)

    def test_a_test_writing_output_is_not_stalled(self):
        result, document, _ = observe(
            'for _ in range(8):\n    print("working", flush=True)\n    time.sleep(0.5)')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('stalled', document)

    def test_a_test_file_outside_the_selected_list_is_watched_and_not_recorded(self):
        result, document, elapsed = observe('while True:\n    time.sleep(0.05)', file='codex-root.py')
        self.assertEqual(result.returncode, 1)
        self.assertLess(elapsed, 60)
        self.assertIn('made no progress', result.stderr)
        self.assertIsNone(document)

    def test_a_passing_file_is_recorded_as_before(self):
        result, document, _ = observe('self.assertTrue(True)')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(document['runs'], [{'expected_tests': 1, 'tests_run': 1, 'failures': [],
                                              'skipped': [], 'expected_failures': []}])
        self.assertTrue(document['judged'])


if __name__ == '__main__':
    unittest.main()
