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
COORDINATOR = ROOT / '.scratch/bend2/observer-recovery'
OBSERVER_ENTRY = ROOT / 'bend2/test/observer-recovery-entry.bend'
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
            build(OBSERVER_ENTRY, COORDINATOR)

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
        self.release_marker = self.directory / 'release-later-output'
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

    def start_attempt(self, stderr_text='', native_uuid=NATIVE_UUID, attempt_id='attempt1',
                      stdout_text='monitor-line\n', sleep_seconds=8,
                      later_stdout_text=''):
        self.native.write_text(
            '\n'.join([
                '#!' + sys.executable,
                'import pathlib,sys,time',
                'pathlib.Path(sys.argv[2]).write_text(sys.argv[1])',
                *(['sys.stderr.write(' + repr(stderr_text) + ')'] if stderr_text else []),
                'sys.stdout.write(' + repr(stdout_text) + ')',
                'sys.stdout.flush()',
                *(['while not pathlib.Path(sys.argv[3]).exists(): time.sleep(0.02)',
                   'sys.stdout.write(' + repr(later_stdout_text) + ')',
                   'sys.stdout.flush()'] if later_stdout_text else []),
                'time.sleep(' + repr(sleep_seconds) + ')',
            ]) + '\n')
        self.native.chmod(0o700)
        self.attempt_id = attempt_id
        self.native_uuid = native_uuid
        self.stdout_text = stdout_text
        self.fixture('init', self.db)
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET native=? WHERE id='parent'", (native_uuid,))
        start = subprocess.Popen(
            [str(FIXTURE), 'start', str(self.db), attempt_id, str(self.attempt),
             str(self.workspace), str(self.log), native_uuid, 'codex',
             'controlled-model', 'low', sys.executable, str(self.native),
             native_uuid, str(self.uuid_marker),
             *([str(self.release_marker)] if later_stdout_text else [])],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        stdout, stderr = start.communicate(timeout=30)
        self.assertEqual(start.returncode, 0, stdout + stderr)
        self.assertIn('started', stdout)
        observer = start.pid
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if (self.attempt / 'native.pid').exists() and (self.attempt / 'stdout').exists():
                if (self.attempt / 'stdout').stat().st_size >= len(stdout_text.encode()):
                    break
            time.sleep(0.02)
        self.assertTrue((self.attempt / 'native.pid').exists(), 'native.pid was not written')
        self.native_process = int((self.attempt / 'native.pid').read_text())
        self.assertEqual(self.uuid_marker.read_text(), native_uuid)
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

    @staticmethod
    def stop_owned_process(process):
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)

    def row(self, sql, *args):
        with sqlite3.connect(self.db) as database:
            return database.execute(sql, args).fetchone()

    def test_unknown_status_monitor_advances_once_and_keeps_owed_input(self):
        first_line = 'monitor-line\n'
        second_line = 'monitor-line-after-log-removal\n'
        observer, birth, manifest = self.start_attempt(
            stdout_text=first_line, later_stdout_text=second_line,
            sleep_seconds=12)
        recover_argv = [str(COORDINATOR), '--recover-observer', str(self.db),
                        'parent', str(observer)]
        first = subprocess.Popen(
            recover_argv, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, first)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if (checkpoint_offset(self.attempt) == len(first_line.encode()) and
                    custody_offset(self.attempt) == len(first_line.encode())):
                break
            if first.poll() is not None:
                break
            time.sleep(0.02)
        self.assertEqual(checkpoint_offset(self.attempt), len(first_line.encode()),
                         'first monitor recovery did not persist its cursor')
        self.assertEqual(custody_offset(self.attempt), len(first_line.encode()))
        first_checkpoint = (self.attempt / 'checkpoint').read_bytes()
        first_custody = (self.attempt / 'custody').read_bytes()
        first_running = first.poll() is None
        if first_running:
            first.kill()
        first_stdout, first_stderr = first.communicate(timeout=10)
        if not first_running:
            self.assertNotEqual(first.returncode, 0, first_stdout + first_stderr)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        self.assertEqual(checkpoint_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(custody_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id=?", self.attempt_id)
        self.assertIsNotNone(status)
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertNotIn('exit 0', status[0])
        offset = checkpoint_offset(self.attempt)
        # Reopen the same durable monitor checkpoint with its public output log
        # absent. Recovery must keep the retained cursor and the original task
        # pending while it restores observer state from the attempt checkpoint.
        self.log.unlink(missing_ok=True)
        self.assertFalse(self.log.exists())
        expected_output = (first_line + second_line).encode()
        self.release_marker.touch()
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if (self.attempt / 'stdout').stat().st_size >= len(expected_output):
                break
            time.sleep(0.02)
        self.assertEqual((self.attempt / 'stdout').read_bytes(), expected_output)
        second = self.recover(observer)
        self.assertNotEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertNotEqual((self.attempt / 'checkpoint').read_bytes(), first_checkpoint)
        self.assertEqual(offset, len(first_line.encode()))
        self.assertEqual(checkpoint_offset(self.attempt), len(expected_output))
        self.assertEqual(custody_offset(self.attempt), len(expected_output))
        self.assertNotEqual((self.attempt / 'custody').read_bytes(), first_custody)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id=?", self.attempt_id)
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
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id=?", self.attempt_id)
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
        self.assertEqual(self.row('SELECT native FROM sessions WHERE id=?', 'parent'), (NATIVE_UUID,))
        self.assertEqual(self.row("SELECT count(*) FROM messages WHERE id LIKE 'attempt1:recovery%'"), (0,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id=?", self.attempt_id)
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_fframes_absent_native_partial_output_preserves_unknown_custody(self):
        uuid = '01a14c0e-db9f-7000-9e60-d47f6aed87d2'
        partial = '{"type":"tool_call","delta":"partial'
        observer, birth, manifest = self.start_attempt(
            native_uuid=uuid, attempt_id='attempt-1714',
            stdout_text=partial, sleep_seconds=1)
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            state = subprocess.run(['ps', '-o', 'stat=', '-p', str(self.native_process)],
                                   text=True, capture_output=True).stdout.strip()
            if not state or state.startswith('Z'):
                break
            time.sleep(0.02)
        result = self.recover(observer)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.attempt / 'stdout').read_text(), partial)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertFalse((self.attempt / 'status').exists())
        self.assertEqual(checkpoint_offset(self.attempt), len(partial.encode()))
        self.assertEqual(custody_offset(self.attempt), len(partial.encode()))
        self.assertEqual(self.row('SELECT native FROM sessions WHERE id=?', 'parent'), (uuid,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        status = self.row("SELECT status FROM executions WHERE session='parent' AND id=?", self.attempt_id)
        self.assertTrue(status[0].startswith('unavailable'), status)
        self.assertNotIn('exit 0', status[0])
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        duplicate = self.fixture(
            'start', self.db, 'attempt-1714', str(self.attempt), str(self.workspace),
            str(self.log), uuid, 'codex', 'controlled-model', 'low', sys.executable,
            str(self.native), uuid, str(self.uuid_marker), ok=False)
        self.assertNotEqual(duplicate.returncode, 0, duplicate.stdout + duplicate.stderr)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)



if __name__ == '__main__':
    unittest.main(verbosity=2)
