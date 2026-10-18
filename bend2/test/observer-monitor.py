"""Isolated coordinator recovery of an adopted monitor-only attempt.

The fixture starts one retained native under the database owner, then ends the
observer and the keeper. No status is retained. The focused coordinator entry
adopts the attempt as monitor-only custody, reads its spool, advances the
durable checkpoint once and leaves the owed input unread. The native identity,
PID, UUID argument and manifest stay unchanged.
"""
import os
import pathlib
import shutil
import signal
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / '.scratch/bend2/monitor-fixture'
COORDINATOR = ROOT / '.scratch/bend2/receive-focused'
NATIVE_UUID = '01a14948-63f9-7000-abc2-89573aa39352'


def build(entry, output):
    result = subprocess.run(
        ['sh', 'bend2/scripts/build-native.sh', str(entry), str(output)],
        cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


def checkpoint_offset(directory):
    path = pathlib.Path(directory) / 'checkpoint'
    if not path.exists():
        return None
    data = path.read_bytes()
    if data[:8] != b'BATONC03':
        return None
    return struct.unpack_from('=Q', data, 56)[0]


def custody_offset(directory):
    path = pathlib.Path(directory) / 'custody'
    if not path.exists():
        return None
    data = path.read_bytes()
    if data[:8] != b'BATONCUS':
        return None
    return struct.unpack_from('=Q', data, 40)[0]


def owner_pid(database):
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = (entry / 'cmdline').read_bytes().split(b'\0')
        except OSError:
            continue
        if b'--instance-owner' in argv and str(database).encode() in argv:
            return int(entry.name)
    return None


class ObserverMonitor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        if not FIXTURE.exists():
            build(ROOT / 'bend2/test/monitor-fixture.bend', FIXTURE)
        if not COORDINATOR.exists():
            build(ROOT / 'bend2/src/coordinator/receive-focused.bend', COORDINATOR)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='observer-monitor-', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.runtime = pathlib.Path(tempfile.mkdtemp(prefix='br-'))
        self.addCleanup(shutil.rmtree, str(self.runtime), True)
        self.environment = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime))
        self.db = self.directory / 'state.db'
        self.attempt = self.directory / 'attempt'
        self.workspace = self.directory / 'workspace'
        self.workspace.mkdir()
        self.log = self.directory / 'native.log'
        self.uuid_marker = self.directory / 'native-uuid.txt'
        self.native = self.directory / 'native.py'
        self.native.write_text(
            '#!' + sys.executable + '\n'
            'import pathlib,sys,time\n'
            'pathlib.Path(sys.argv[2]).write_text(sys.argv[1])\n'
            'sys.stdout.write("monitor-line\\n")\n'
            'sys.stdout.flush()\n'
            'time.sleep(8)\n')
        self.native.chmod(0o700)
        self.native_process = None

    def tearDown(self):
        if self.native_process is not None:
            try:
                os.kill(self.native_process, signal.SIGKILL)
            except ProcessLookupError:
                pass
        subprocess.run([str(FIXTURE), 'shutdown', str(self.db)],
                       env=self.environment, capture_output=True, timeout=20)

    def fixture(self, *args, ok=True):
        result = subprocess.run([str(FIXTURE), *map(str, args)], text=True,
                                capture_output=True, env=self.environment, timeout=30)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def start_attempt(self, stderr_text=''):
        self.native.write_text(
            '#!' + sys.executable + '\n'
            'import pathlib,sys,time\n'
            'pathlib.Path(sys.argv[2]).write_text(sys.argv[1])\n'
            + ('sys.stderr.write(' + repr(stderr_text) + ')\n' if stderr_text else '')
            + 'sys.stdout.write("monitor-line\\n")\n'
            'sys.stdout.flush()\n'
            'time.sleep(8)\n')
        self.native.chmod(0o700)
        self.fixture('init', self.db)
        start = subprocess.Popen(
            [str(FIXTURE), 'start', str(self.db), 'attempt1', str(self.attempt),
             str(self.workspace), str(self.log), 'native-uuid', 'codex',
             'controlled-model', 'low', sys.executable, str(self.native),
             NATIVE_UUID, str(self.uuid_marker)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        stdout, stderr = start.communicate(timeout=30)
        self.assertEqual(start.returncode, 0, stdout + stderr)
        self.assertIn('started', stdout)
        observer = start.pid
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if (self.attempt / 'native.pid').exists() and (self.attempt / 'stdout').exists():
                if (self.attempt / 'stdout').stat().st_size >= len('monitor-line\n'):
                    break
            time.sleep(0.02)
        self.assertTrue((self.attempt / 'native.pid').exists(), 'native.pid was not written')
        self.native_process = int((self.attempt / 'native.pid').read_text())
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        birth = (self.attempt / 'native.birth').read_bytes()
        manifest = (self.attempt / 'manifest').read_bytes()
        self.assertTrue((self.attempt / 'capabilities').exists(),
                        'the owner keeper did not advertise reconcile')
        owner = owner_pid(self.db)
        self.assertIsNotNone(owner, 'database owner was not found')
        os.kill(owner, signal.SIGKILL)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and owner_pid(self.db) is not None:
            time.sleep(0.02)
        os.kill(self.native_process, 0)
        return observer, birth, manifest

    def recover(self, observer):
        result = subprocess.run(
            [str(COORDINATOR), '--recover-observer', str(self.db), 'parent', str(observer)],
            text=True, capture_output=True, env=self.environment, timeout=60)
        return result

    def row(self, sql, *args):
        with sqlite3.connect(self.db) as database:
            return database.execute(sql, args).fetchone()

    def test_unknown_status_monitor_advances_once_and_keeps_owed_input(self):
        observer, birth, manifest = self.start_attempt()
        first = self.recover(observer)
        self.assertNotEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        self.assertEqual(checkpoint_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(custody_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id='attempt1'")
        self.assertIsNotNone(status)
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertNotIn('exit 0', status[0])
        offset = checkpoint_offset(self.attempt)
        second = self.recover(observer)
        self.assertNotEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertEqual(checkpoint_offset(self.attempt), offset)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id='attempt1'")
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_concurrent_observers_advance_the_cursor_once(self):
        observer, birth, manifest = self.start_attempt()
        argv = [str(COORDINATOR), '--recover-observer', str(self.db), 'parent', str(observer)]
        first = subprocess.Popen(argv, text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=self.environment)
        second = subprocess.Popen(argv, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, env=self.environment)
        first_output = first.communicate(timeout=90)
        second_output = second.communicate(timeout=90)
        self.assertNotEqual(first.returncode, 0, ''.join(first_output))
        self.assertNotEqual(second.returncode, 0, ''.join(second_output))
        combined = ''.join(first_output) + ''.join(second_output)
        self.assertIn('Another observer holds the retained attempt', combined)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(checkpoint_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(custody_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id='attempt1'")
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_refused_resume_text_stays_an_incomplete_observation(self):
        observer, birth, manifest = self.start_attempt('Error: Session fixture not found\n')
        result = self.recover(observer)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertEqual(self.row('SELECT native FROM sessions WHERE id=?', 'parent'), ('native-uuid',))
        self.assertEqual(self.row("SELECT count(*) FROM messages WHERE id LIKE 'attempt1:recovery%'"), (0,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id='attempt1'")
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
