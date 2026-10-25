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
    source = ('import os, pathlib, subprocess, sys, threading, time, unittest\n'
              'class Case(unittest.TestCase):\n'
              '    def test_body(self):\n' + ''.join('        ' + line + '\n' for line in body.splitlines()) +
              'if __name__ == "__main__":\n    unittest.main()\n')
    return observe_source(source, stall, sample, file)


def observe_source(source, stall='1', sample='0.1', file='root-wake.py', setup=''):
    with tempfile.TemporaryDirectory() as root:
        root = pathlib.Path(root)
        test = root / 'bend2/test' / file
        test.parent.mkdir(parents=True)
        test.write_text(source)
        environment = dict(os.environ, BATON2_STALL_SECONDS=stall, BATON2_STALL_SAMPLE_SECONDS=sample)
        argv = [str(RECORDER), 'observe', str(root / 'out'), '--', 'bend2/test/' + file]
        if setup:
            launcher = root / 'launch.py'
            launcher.write_text('import os, runpy, sys\n' + setup + '\nsys.argv = ' + repr(argv) +
                                '\nrunpy.run_path(' + repr(str(RECORDER)) + ', run_name="__main__")\n')
            argv = [str(launcher)]
        started = time.monotonic()
        result = subprocess.run([sys.executable, *argv],
                                cwd=root, env=environment, capture_output=True, text=True, timeout=30)
        recorded = root / 'out' / (file + '.json')
        document = json.loads(recorded.read_text()) if recorded.exists() else None
        return result, document, time.monotonic() - started


@unittest.skipUnless(sys.platform == 'linux', 'Linux /proc observer')
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
        busy = 'end = time.monotonic() + 4\nwhile time.monotonic() < end:\n    pass'
        for body in (busy, 'subprocess.run([sys.executable, "-c", ' + repr('import time\n' + busy) + '], check=True)'):
            with self.subTest(body=body):
                result, document, _ = observe(body)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(document['runs'][0]['failures'], [])
                self.assertNotIn('stalled', document)

    def test_a_test_writing_output_is_not_stalled(self):
        bodies = [
            'for _ in range(8):\n    print("working", flush=True)\n    time.sleep(0.5)',
            'for _ in range(8):\n    sys.stdout.buffer.write(b"working\\n")\n    sys.stdout.buffer.flush()\n    time.sleep(0.5)',
            'with open("stdout.log", "w") as log:\n    os.dup2(log.fileno(), 1)\n'
            '    for _ in range(8):\n        os.write(1, b"working\\n")\n        time.sleep(0.5)',
            'with open("state", "w") as stream:\n    for i in range(8):\n'
            '        stream.seek(0)\n        stream.write(str(i))\n        stream.flush()\n        time.sleep(0.5)',
            'with open("state", "w") as stream:\n    for _ in range(8):\n'
            '        os.utime("state", None)\n        time.sleep(0.5)',
        ]
        daemon = ('import os, time\nif os.fork(): os._exit(0)\n'
                  'with open("owner.log", "w") as stream:\n'
                  '    for i in range(8):\n        stream.write(str(i))\n        stream.flush()\n        time.sleep(.5)')
        bodies.append('subprocess.run([sys.executable, "-c", ' + repr(daemon) + '])\ntime.sleep(4)')
        for body in bodies:
            with self.subTest(body=body):
                result, document, _ = observe(body)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('stalled', document)

    def test_a_test_file_outside_the_selected_list_is_watched_and_not_recorded(self):
        result, document, elapsed = observe('while True:\n    time.sleep(0.05)', file='codex-root.py')
        self.assertEqual(result.returncode, 1)
        self.assertLess(elapsed, 60)
        self.assertIn('made no progress', result.stderr)
        self.assertIsNone(document)

    def test_polling_subprocesses_do_not_count_as_progress(self):
        result, document, _ = observe(
            "while True:\n    subprocess.run(['true'])\n    time.sleep(0.05)", stall='1', sample='0.1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('__main__.Case.test_body', document['stalled'])
        self.assertTrue(document['judged'])

    def test_reading_an_unchanged_open_file_does_not_count_as_progress(self):
        result, document, _ = observe(
            "pathlib.Path('state').write_text('unchanged')\n"
            "with open('state') as stream:\n"
            "    while True:\n        stream.seek(0)\n        stream.read()\n        time.sleep(0.05)",
            stall='1', sample='0.1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('__main__.Case.test_body', document['stalled'])
        self.assertTrue(document['judged'])

    def test_a_stall_before_unittest_is_recorded_as_incomplete(self):
        result, document, _ = observe_source('import threading, unittest\nthreading.Event().wait()\nunittest.main()\n')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(document['stalled'], ['<import>'])
        self.assertEqual(document['runs'], [])
        self.assertFalse(document['judged'])

    def test_a_non_unittest_script_stall_is_recorded_as_incomplete(self):
        result, document, _ = observe_source(
            'import threading\ndef main():\n    threading.Event().wait()\nmain()\n')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(document['stalled'], ['<script>'])
        self.assertEqual(document['runs'], [])
        self.assertFalse(document['judged'])

    def test_a_stall_after_unittest_is_recorded_as_incomplete(self):
        result, document, _ = observe_source(
            'import threading, unittest\nclass Case(unittest.TestCase):\n'
            '    def test_body(self): pass\nunittest.main(exit=False)\nthreading.Event().wait()\n')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(document['stalled'], ['<after-suite>'])
        self.assertEqual(document['runs'][0]['failures'], [])
        self.assertFalse(document['judged'])

    def test_stall_escalation_does_not_interrupt_the_next_test(self):
        result, document, _ = observe_source(
            'import subprocess, time, unittest\nclass Case(unittest.TestCase):\n'
            '    def test_a(self): subprocess.run(["sleep", "600"])\n'
            '    def test_b(self):\n'
            '        for _ in range(60):\n            print("working", flush=True)\n            time.sleep(.1)\n'
            'unittest.main()\n')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIsNotNone(document, result.stderr)
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Case.test_a', 'stalled']])
        self.assertEqual(document['runs'][0]['tests_run'], 2)
        self.assertTrue(document['judged'])

    def test_stall_escalation_finishes_before_outcome_writing(self):
        result, document, _ = observe_source(
            'import pathlib, subprocess, time, unittest\noriginal_write = pathlib.Path.write_text\n'
            'def slow_write(path, *args, **kwargs):\n'
            '    if path.name == "root-wake.py.json": time.sleep(4)\n'
            '    return original_write(path, *args, **kwargs)\n'
            'pathlib.Path.write_text = slow_write\nclass Case(unittest.TestCase):\n'
            '    def test_body(self): subprocess.run(["sleep", "600"])\nunittest.main()\n')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIsNotNone(document, result.stderr)
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Case.test_body', 'stalled']])
        self.assertTrue(document['judged'])
        self.assertNotIn('Traceback', result.stderr)

    def test_unavailable_proc_preserves_a_passing_outcome(self):
        for error in ('FileNotFoundError', 'PermissionError'):
            with self.subTest(error=error):
                result, document, _ = observe_source(
                    'import os, unittest\noriginal_listdir = os.listdir\n'
                    'def listdir(path):\n'
                    '    if path == "/proc": raise ' + error + '("unavailable /proc")\n'
                    '    return original_listdir(path)\nos.listdir = listdir\n'
                    'class Case(unittest.TestCase):\n    def test_body(self): pass\nunittest.main()\n')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(document['judged'])
                self.assertEqual(document['runs'][0]['failures'], [])
                self.assertEqual(result.stderr.count('liveness disabled'), 1)

    def test_non_linux_preserves_outcomes_without_proc(self):
        result, document, _ = observe_source(
            'import unittest\nclass Case(unittest.TestCase):\n'
            '    def test_body(self): pass\nunittest.main()\n',
            setup='sys.platform = "darwin"\noriginal_listdir = os.listdir\n'
                  'def listdir(path):\n'
                  '    if path == "/proc": raise FileNotFoundError("unavailable /proc")\n'
                  '    return original_listdir(path)\nos.listdir = listdir\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(document['judged'])
        self.assertNotIn('liveness disabled', result.stderr)
        self.assertNotIn('Exception in thread', result.stderr)

    def test_a_passing_file_is_recorded_as_before(self):
        result, document, _ = observe('self.assertTrue(True)')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(document['runs'], [{'expected_tests': 1, 'tests_run': 1, 'failures': [],
                                              'skipped': [], 'expected_failures': []}])
        self.assertTrue(document['judged'])


if __name__ == '__main__':
    unittest.main()
