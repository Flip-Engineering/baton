"""Exercise the focused qualification scope cleanup with a detached child.

The fixture replaces systemctl with a small recorder that manages one detached
sleep process. It checks the exact .scope unit name, the SIGKILL escalation
when SIGTERM leaves the scope active, and the cancellation record. No compiler
or real systemd scope is involved.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
DRIVER = ROOT / '.github/scripts/run-focused-native.py'
SPEC = importlib.util.spec_from_file_location('focused_native_driver', DRIVER)
DRIVER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER_MODULE)

SYSTEMCTL = '''#!/usr/bin/env python3
import os
import signal
import sys

args = sys.argv[1:]
state = os.environ['FAKE_SCOPE_STATE']
pidfile = os.environ['FAKE_SCOPE_PID']
log = os.environ['FAKE_SCOPE_LOG']
with open(log, 'a') as stream:
    stream.write(' '.join(args) + '\\n')
if len(args) >= 2 and args[0] == '--user' and args[1] == 'is-active':
    if os.path.exists(state):
        print(open(state).read().strip())
    else:
        print('inactive')
    sys.exit(0)
if len(args) >= 2 and args[0] == '--user' and args[1] == 'kill':
    kill = '--signal=KILL' in args
    if kill or os.environ.get('FAKE_SCOPE_IGNORE_TERM') != '1':
        try:
            os.kill(int(open(pidfile).read()), signal.SIGKILL if kill else signal.SIGTERM)
        except (FileNotFoundError, ProcessLookupError):
            pass
        open(state, 'w').write('inactive\\n')
    sys.exit(0)
sys.exit(2)
'''


class ScopeCleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='focused-scope-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        binary = self.directory / 'bin'
        binary.mkdir()
        systemctl = binary / 'systemctl'
        systemctl.write_text(SYSTEMCTL)
        systemctl.chmod(0o755)
        self.state = self.directory / 'state'
        self.state.write_text('active\n')
        self.pidfile = self.directory / 'pid'
        self.log = self.directory / 'log'
        self.log.write_text('')
        self.environment = mock.patch.dict(os.environ, {
            'PATH': str(binary) + ':' + os.environ.get('PATH', ''),
            'FAKE_SCOPE_STATE': str(self.state),
            'FAKE_SCOPE_PID': str(self.pidfile),
            'FAKE_SCOPE_LOG': str(self.log),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def child(self):
        process = subprocess.Popen(['sleep', '30'], start_new_session=True)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        self.pidfile.write_text(str(process.pid))
        return process

    def test_cleanup_uses_scope_name_and_reaps_detached_child(self):
        child = self.child()
        record = DRIVER_MODULE.cleanup_scope('unit')
        child.wait(timeout=5)
        self.assertEqual(record['scope'], 'unit.scope')
        self.assertFalse(record['active'])
        self.assertFalse(record['escalated'])
        self.assertIn('--user kill --kill-who=all unit.scope', self.log.read_text())
        self.assertIsNotNone(child.poll())

    def test_cleanup_escalates_after_term_ignored(self):
        child = self.child()
        with mock.patch.dict(os.environ, {'FAKE_SCOPE_IGNORE_TERM': '1'}):
            record = DRIVER_MODULE.cleanup_scope('unit', poll_seconds=0.01, attempts=10)
        child.wait(timeout=5)
        self.assertTrue(record['escalated'])
        self.assertFalse(record['active'])
        self.assertIn('--signal=KILL --kill-who=all unit.scope', self.log.read_text())
        self.assertIsNotNone(child.poll())

    def test_cancellation_records_cleanup(self):
        child = self.child()
        evidence = self.directory / 'evidence'
        evidence.mkdir()
        DRIVER_MODULE.terminate_scope('unit', child, evidence, 'launcher-cancel')
        child.wait(timeout=5)
        record = json.loads((evidence / 'launcher-cancel.json').read_text())
        self.assertEqual(record['scope'], 'unit.scope')
        self.assertEqual(record['cleanup']['scope'], 'unit.scope')
        self.assertFalse(record['cleanup']['active'])
        self.assertIsNotNone(child.poll())


if __name__ == '__main__':
    unittest.main()
