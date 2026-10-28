"""Check cancellation cleanup for a focused qualification child process group."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
DRIVER = ROOT / '.github/scripts/run-focused-native.py'
SPEC = importlib.util.spec_from_file_location('focused_native_driver', DRIVER)
DRIVER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER_MODULE)

PARENT = r'''
import signal
import subprocess
import sys

child_code = "import signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN if sys.argv[1] == 'ignore' else signal.SIG_DFL); open(sys.argv[2], 'w').write('ready'); time.sleep(30)"
child = subprocess.Popen([sys.executable, '-c', child_code, sys.argv[2], sys.argv[3]])
signal.signal(signal.SIGTERM, signal.SIG_IGN)
with open(sys.argv[1], 'w') as stream:
    stream.write(str(child.pid))
child.wait()
'''


class ProcessGroupCleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='focused-process-group-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.pidfile = self.directory / 'child.pid'
        self.readyfile = self.directory / 'child.ready'
        self.evidence = self.directory / 'evidence'
        self.evidence.mkdir()
        self.children = []
        self.addCleanup(self.cleanup_children)

    def start_group(self, ignore_term=False):
        process = subprocess.Popen(
            [sys.executable, '-c', PARENT, str(self.pidfile),
             'ignore' if ignore_term else 'term', str(self.readyfile)],
            start_new_session=True)
        self.children.append(process)
        deadline = time.monotonic() + 5
        while not self.readyfile.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.readyfile.exists(), 'fixture child did not start')
        return process, int(self.pidfile.read_text())

    def cleanup_children(self):
        for process in self.children:
            if process.poll() is None:
                DRIVER_MODULE.terminate_process_group(
                    process, self.evidence, 'fixture-cleanup',
                    poll_seconds=0.01, attempts=10)

    def assert_pid_gone(self, pid):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.01)
        self.fail('fixture child remained after process-group cleanup')

    def test_cleanup_terminates_launcher_and_child(self):
        process, child_pid = self.start_group()
        record = DRIVER_MODULE.terminate_process_group(
            process, self.evidence, 'launcher-cancel',
            poll_seconds=0.01, attempts=10)
        self.assertFalse(record['group_exists'])
        self.assertTrue(record['term_sent'])
        self.assertFalse(record['kill_sent'])
        self.assert_pid_gone(child_pid)
        self.assertEqual(process.poll(), record['exit_code'])

    def test_cleanup_escalates_when_group_ignores_term(self):
        process, child_pid = self.start_group(ignore_term=True)
        record = DRIVER_MODULE.terminate_process_group(
            process, self.evidence, 'launcher-cancel',
            poll_seconds=0.01, attempts=10)
        self.assertTrue(record['kill_sent'], record)
        self.assertFalse(record['group_exists'])
        self.assert_pid_gone(child_pid)

    def test_cancellation_retains_cleanup_evidence(self):
        parent_script = self.directory / 'parent.py'
        parent_script.write_text(PARENT)
        wrapper_script = self.directory / 'launcher.py'
        wrapper_script.write_text('''
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys

driver_path = os.environ['DRIVER_PATH']
spec = importlib.util.spec_from_file_location('focused_native_driver', driver_path)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
signal.signal(signal.SIGTERM, driver.handle_sigterm)
records = []
driver.run_command('fixture', [sys.executable, '-c', Path(os.environ['PARENT_SCRIPT']).read_text(),
                               os.environ['CHILD_PIDFILE'], 'term', os.environ['CHILD_READY']],
                   os.environ['FIXTURE_CWD'], dict(os.environ),
                   Path(os.environ['FIXTURE_EVIDENCE']), records)
''')
        env = dict(os.environ)
        env.update({'DRIVER_PATH': str(DRIVER), 'PARENT_SCRIPT': str(parent_script),
                    'CHILD_PIDFILE': str(self.pidfile), 'CHILD_READY': str(self.readyfile),
                    'FIXTURE_CWD': str(self.directory),
                    'FIXTURE_EVIDENCE': str(self.evidence)})
        wrapper = subprocess.Popen([sys.executable, str(wrapper_script)], env=env,
                                   start_new_session=True)
        self.children.append(wrapper)
        deadline = time.monotonic() + 5
        while not self.readyfile.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.readyfile.exists(), 'launcher child did not start')
        child_pid = int(self.pidfile.read_text())
        os.kill(wrapper.pid, signal.SIGTERM)
        self.assertEqual(wrapper.wait(timeout=5), 143)
        self.assert_pid_gone(child_pid)
        records = json.loads((self.evidence / 'commands.json').read_text())
        self.assertTrue(records[0]['cancelled'])
        self.assertFalse(records[0]['process_group_cleanup']['group_exists'])
        record = json.loads((self.evidence / 'fixture-launcher-cancel.json').read_text())
        self.assertEqual(record['pid'], records[0]['process_group_cleanup']['pid'])
        self.assertFalse(record['group_exists'])


if __name__ == '__main__':
    unittest.main()
