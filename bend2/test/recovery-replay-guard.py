"""Exercise the keeper replay guard for a completed retained attempt.

The fixture starts a retained native under the database owner and records a
valid ``--recover-receive`` argv whose executable writes a recovery marker.
The native exits 0, so the keeper records the durable status while the
admitting process is still the observer. Repeated attach and ready exchanges
then disconnect the observer. The keeper must not replay the captured argv:
the completed attempt is adopted through the keeper-attested observer
transfer path instead.

A supported stop on the exited execution keeps the owed input unacknowledged
through the observer transfer.

A second attempt keeps its native alive when the observer leaves. That
attempt has no durable status, so the keeper still spawns the recorded
recovery argv; its marker proves active-attempt recovery is preserved.
"""
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = pathlib.Path(os.environ.get(
    'RECOVERY_REPLAY_FIXTURE', ROOT / '.scratch/bend2/recovery-replay-fixture'))
HELPER = pathlib.Path(os.environ.get(
    'RECOVERY_REPLAY_HELPER', ROOT / '.scratch/bend2/baton-recovery-fix'))
OWNER = pathlib.Path(os.environ.get(
    'RECOVERY_REPLAY_OWNER', str(HELPER)))
SESSION = 'parent'
ATTEMPT = 'turn1'
NATIVE_UUID = '01a1604e-2f4a-7000-9d33-8d0e2b7c41aa'
FRAMES = [
    json.dumps({'type': 'session', 'id': NATIVE_UUID,
                'model': 'controlled-model'}),
    json.dumps({'type': 'agent_end', 'messages': [], 'isTerminal': True,
                'messageCount': 0}),
]


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


def write_native(path, observed, marker, delay):
    script = ['#!' + sys.executable,
              'import pathlib,sys,time',
              'time.sleep(%r)' % delay,
              'pathlib.Path(%r).write_text(%r)' % (str(marker), observed)]
    script += ['sys.stdout.write(' + repr(frame + '\n') + ')' for frame in FRAMES]
    script += ['sys.stdout.flush()']
    path.write_text('\n'.join(script) + '\n')
    path.chmod(0o700)


def write_recovery(path, marker):
    script = ['#!' + sys.executable,
              'import pathlib,sys',
              'pathlib.Path(%r).write_text("recovered\\n")' % str(marker)]
    path.write_text('\n'.join(script) + '\n')
    path.chmod(0o700)


class ReplayGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for path in (FIXTURE, HELPER, OWNER):
            if not path.exists():
                raise unittest.SkipTest(
                    'missing fixture %s; build it with bend2/scripts/build-native.sh' % path)

    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(
            prefix='recovery-replay-', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.runtime = pathlib.Path(tempfile.mkdtemp(prefix='rr-'))
        self.addCleanup(shutil.rmtree, str(self.runtime), True)
        self.home = pathlib.Path(tempfile.mkdtemp(
            prefix='recovery-home-', dir=ROOT / '.scratch/bend2'))
        self.addCleanup(shutil.rmtree, str(self.home), True)
        self.environment = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime),
                                HOME=str(self.home))
        self.environment.pop('BATON2_GIT_REGISTRY', None)
        self.db = self.directory / 'state.db'
        self.attempt = self.directory / 'attempt'
        self.workspace = self.directory / 'workspace'
        self.workspace.mkdir()
        self.log = self.directory / 'native.log'
        self.native_marker = self.directory / 'native-marker.txt'
        self.recovery_marker = self.directory / 'recovery-marker.txt'
        self.native = self.directory / 'native.py'
        self.recovery = self.directory / 'recovery.py'
        write_recovery(self.recovery, self.recovery_marker)
        self.fixture('init', self.db, 'omp')
        self.owner_log = self.directory / 'owner.log'
        self.owner_out = open(self.owner_log, 'w')
        self.owner = subprocess.Popen(
            [str(OWNER), '--instance-owner', str(self.db)],
            stdin=subprocess.DEVNULL, stdout=self.owner_out,
            stderr=subprocess.STDOUT, env=self.environment)
        self.addCleanup(self.stop_owner)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if owner_pid(self.db):
                break
            if self.owner.poll() is not None:
                self.fail('instance owner exited: ' + self.owner_log.read_text())
            time.sleep(0.02)
        self.assertIsNotNone(owner_pid(self.db),
                             'instance owner did not stay live')

    def stop_owner(self):
        if self.owner.poll() is None:
            self.owner.terminate()
            try:
                self.owner.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.owner.kill()
                self.owner.wait()
        self.owner_out.close()

    def fixture(self, *args):
        log = self.directory / ('fixture-%d.log' % time.monotonic_ns())
        with open(log, 'w') as out:
            result = subprocess.run(
                [str(FIXTURE), *map(str, args)], text=True,
                stdin=subprocess.DEVNULL, stdout=out,
                stderr=subprocess.STDOUT, env=self.environment, timeout=60)
        if result.returncode:
            self.fail(log.read_text())
        return result

    def launch(self, native, delay, cursor='1'):
        write_native(native, NATIVE_UUID, self.native_marker, delay)
        gate = self.directory / 'gate'
        process = subprocess.Popen(
            [str(FIXTURE), 'start-obsolete', str(self.db), ATTEMPT,
             str(self.attempt), str(self.workspace), str(self.log),
             NATIVE_UUID, str(self.recovery), 'omp', 'controlled-model', 'low',
             sys.executable, str(native), str(self.native_marker), cursor,
             str(gate)],
            text=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, env=self.environment)
        line = process.stdout.readline()
        if 'started' not in line:
            rest = process.stdout.read()
            process.wait(timeout=60)
            process.stdout.close()
            self.fail('fixture start did not reach the gate: ' + line + rest)
        return process, gate, line

    def release(self, process, gate, first):
        gate.write_text('go\n')
        try:
            rest = process.stdout.read()
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            process.stdout.close()
            self.fail('fixture start did not complete')
        process.stdout.close()
        output = first + rest
        self.assertEqual(process.returncode, 0, output)
        return output

    def wait_path(self, path, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists():
                return True
            time.sleep(0.02)
        return False

    def recovery_children(self):
        found = []
        for entry in pathlib.Path('/proc').iterdir():
            if not entry.name.isdigit():
                continue
            try:
                argv = [part.decode(errors='replace')
                        for part in (entry / 'cmdline').read_bytes().split(b'\0')
                        if part]
            except OSError:
                continue
            if '--recover-receive' in argv and str(self.recovery) in argv:
                found.append((int(entry.name), argv))
        return found

    def owed_input(self):
        with sqlite3.connect(self.db) as database:
            return database.execute(
                "SELECT sender,recipient,kind,body,receipt FROM messages "
                "WHERE id='task'").fetchone()

    def test_completed_native_rejects_captured_recovery_replay(self):
        initial = self.owed_input()
        self.assertIsNotNone(initial, 'the fixture must seed the owed task row')
        self.assertIsNone(initial[4], 'the owed task must start unacknowledged')
        process, gate, first = self.launch(self.native, 0)
        self.assertTrue(self.wait_path(self.attempt / 'native.pid'),
                        'native.pid was not written')
        self.assertTrue(self.wait_path(self.attempt / 'status'),
                        'the native exit status was not recorded')
        self.assertTrue(self.wait_path(self.native_marker),
                        'the native did not run')
        self.assertTrue(self.wait_path(self.attempt / 'stdout'),
                        'native stdout was not spooled')
        spool = (self.attempt / 'stdout').stat().st_size
        self.assertGreater(spool, 0, 'the native frames must be retained')
        observer_pid = process.pid
        self.release(process, gate, first)
        time.sleep(1.5)
        self.assertFalse(self.recovery_marker.exists(),
                         'a completed native must not replay the captured recovery argv')
        self.assertEqual(self.recovery_children(), [],
                         'no recovery child may run for a completed native')
        for _ in range(3):
            self.fixture('probe', self.db, self.attempt)
            time.sleep(0.2)
            self.assertFalse(self.recovery_marker.exists(),
                             'an attach and ready cycle must not replay the recovery')
            self.assertEqual(self.recovery_children(), [])
        self.assertEqual((self.attempt / 'status').read_text().strip(), '0',
                         'the durable native status must be preserved')
        self.assertEqual((self.attempt / 'stdout').stat().st_size, spool,
                         'the retained stdout must be preserved')
        self.assertEqual(self.owed_input(), initial,
                         'the completed-native probes must leave the owed row '
                         'unacknowledged and unmodified')
        identity = self.execution_identity()
        native_pid = (self.attempt / 'native.pid').read_text().strip()
        self.fixture('stop', self.db, SESSION, 'operator-stop',
                     'Preserve owed input')
        self.assertEqual(self.stop_row('operator-stop'), ('', '', 'stopped'),
                         'the completed stop records an empty attempt and '
                         'stopped outcome')
        self.assertEqual(self.execution_identity(), identity,
                         'the stop must not replace the recorded execution')
        self.assertEqual(self.execution_row(), ('exited', 'exit 0'),
                         'the completed execution stays exited under the stop')
        self.assertEqual(self.owed_input(), initial,
                         'the supported stop must leave the owed row '
                         'unacknowledged and unmodified')
        result = subprocess.run(
            [str(HELPER), '--recover-observer', str(self.db), SESSION,
             str(observer_pid)],
            text=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, env=self.environment, timeout=120)
        self.assertEqual(result.returncode, 0,
                         'the stopped observer transfer must succeed: ' + result.stdout)
        self.assertEqual(self.execution_identity(), identity,
                         'the transfer must not replace the recorded execution')
        self.assertEqual(self.execution_row(), ('exited', 'exit 0'),
                         'the transfer must preserve the completed status')
        self.assertEqual((self.attempt / 'native.pid').read_text().strip(),
                         native_pid,
                         'the transfer must not start another native execution')
        self.assertEqual(self.owed_input(), initial,
                         'the transfer must leave the complete owed tuple '
                         'unacknowledged and unmodified')
        self.assertIsNone(self.owed_input()[4],
                          'the owed input must stay unacknowledged')
        self.assertEqual((self.attempt / 'status').read_text().strip(), '0',
                         'the durable native status must be preserved')
        self.assertEqual((self.attempt / 'stdout').stat().st_size, spool,
                         'the retained stdout must be preserved')
        self.assertFalse(self.recovery_marker.exists(),
                         'the transfer path must not replay the captured recovery')
        self.assertEqual(self.recovery_children(), [],
                         'the transfer path must not run the captured recovery')

    def stop_row(self, stop_id):
        with sqlite3.connect(self.db) as database:
            return database.execute(
                "SELECT attempt,directory,outcome FROM session_stops "
                "WHERE session='parent' AND id=?", (stop_id,)).fetchone()

    def execution_row(self):
        with sqlite3.connect(self.db) as database:
            return database.execute(
                "SELECT phase,status FROM executions WHERE session='parent'"
            ).fetchone()

    def execution_identity(self):
        with sqlite3.connect(self.db) as database:
            return database.execute(
                "SELECT id,mode,directory FROM executions WHERE session='parent'"
            ).fetchone()

    def test_active_attempt_still_recovers(self):
        process, gate, first = self.launch(self.native, 2)
        self.assertTrue(self.wait_path(self.attempt / 'native.pid'),
                        'native.pid was not written')
        self.assertFalse((self.attempt / 'status').exists(),
                         'the active native must have no durable exit status')
        self.release(process, gate, first)
        self.assertTrue(self.wait_path(self.recovery_marker, timeout=30),
                        'an active attempt must still spawn its recorded recovery')


if __name__ == '__main__':
    unittest.main(verbosity=2)
