"""Exercise the retained-observer executing-call protocol against a live owner.

The fixture starts one retained OMP native under the database instance owner,
then the admitting process exits: that is observer loss while the owner keeper
stays live. The keeper spawns the recorded `--recover-receive` executing call
from the attempt manifest. The native writes a normal OMP session, one assistant
message and an agent_end, then exits 0. The synthetic inbox keeps 33 messages
unacknowledged and one wake claim generation, mirroring the film attempt.

Two scenarios run against the same source:

  normal       no competing reader. The executing call must observe to EOF,
               record the retained exit, settle the executions row, continue or
               reconcile the owed input and advance/release the wake claim.
  contention   a second process holds a SHARED read transaction on the database.
               The executing call must not exit with SQLITE_BUSY (5): it records
               a typed `recovery-blocked` cause in the attempt, retains every
               custody file and releases the stale wake-claim ticket.

The fixture never signals another process; it waits for the helper to exit.
"""
import hashlib
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
    'OBSERVER_EXECUTING_FIXTURE', ROOT / '.scratch/bend2/monitor-fixture'))
HELPER = pathlib.Path(os.environ.get(
    'OBSERVER_EXECUTING_HELPER', ROOT / '.scratch/bend2/baton-recovery-fix'))
SESSION = 'parent'
ATTEMPT = 'turn1'
NATIVE_UUID = '01a15c9e-2f4a-7000-9d33-8d0e2b7c41aa'
PENDING = 33
FRAMES = [
    json.dumps({'type': 'session', 'id': NATIVE_UUID,
                'model': 'controlled-model'}),
    json.dumps({'type': 'message_start',
                'message': {'role': 'assistant', 'content': []}}),
    json.dumps({'type': 'message_end',
                'message': {'role': 'assistant', 'content': [
                    {'type': 'text', 'text': 'retained work complete'}]}}),
    json.dumps({'type': 'agent_end', 'messages': [], 'isTerminal': True,
                'messageCount': 1}),
]

def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1 << 16), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_native(path):
    script = ['#!' + sys.executable,
              'import sys,time',
              'pathlib=__import__("pathlib")',
              'pathlib.Path(sys.argv[2]).write_text(sys.argv[1])']
    script += ['sys.stdout.write(' + repr(frame + '\n') + ')' for frame in FRAMES]
    script += ['sys.stdout.flush()', 'time.sleep(0.2)']
    path.write_text('\n'.join(script) + '\n')
    path.chmod(0o700)


def receive_pid(database, attempt):
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = [part.decode(errors='replace')
                    for part in (entry / 'cmdline').read_bytes().split(b'\0')
                    if part]
        except OSError:
            continue
        if (len(argv) >= 5 and argv[1] == '--recover-receive' and
                argv[2] == str(database) and argv[4] == attempt):
            return int(entry.name)
    return None


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


class Executing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for path in (FIXTURE, HELPER):
            if not path.exists():
                raise unittest.SkipTest(
                    'missing fixture %s; build it with bend2/scripts/build-native.sh' % path)

    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(
            prefix='observer-executing-', dir=ROOT / '.scratch/bend2')
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
        write_native(self.native)

    def fixture(self, *args):
        result = subprocess.run([str(FIXTURE), *map(str, args)], text=True,
                                capture_output=True, env=self.environment,
                                timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def seed(self):
        self.fixture('init', self.db, 'omp')
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET native=? WHERE id='parent'",
                             (NATIVE_UUID,))
            for index in range(2, PENDING + 1):
                database.execute(
                    "INSERT INTO messages(id,sender,recipient,kind,body) "
                    "VALUES(?, 'parent','parent','task',?)",
                    ('msg-%02d' % index, 'synthetic pending input %d' % index))
            database.execute(
                "INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) "
                "VALUES('parent','claimed','task',1)")

    def start(self):
        start = subprocess.Popen(
            [str(FIXTURE), 'start', str(self.db), ATTEMPT, str(self.attempt),
             str(self.workspace), str(self.log), NATIVE_UUID, str(HELPER), 'omp',
             'controlled-model', 'low', sys.executable, str(self.native),
             NATIVE_UUID, str(self.uuid_marker)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        stdout, stderr = start.communicate(timeout=60)
        self.assertEqual(start.returncode, 0, stdout + stderr)
        self.assertIn('started', stdout)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if (self.attempt / 'native.pid').exists() and self.uuid_marker.exists():
                if (self.attempt / 'stdout').exists():
                    break
            time.sleep(0.02)
        self.assertTrue((self.attempt / 'native.pid').exists(),
                        'native.pid was not written')
        self.assertIsNotNone(owner_pid(self.db), 'instance owner did not stay live')
        return start

    def helper(self):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            pid = receive_pid(self.db, ATTEMPT)
            if pid:
                return pid
            time.sleep(0.02)
        self.fail('the keeper did not invoke the recorded executing call')

    def state(self):
        with sqlite3.connect(self.db) as database:
            claim = database.execute(
                "SELECT coalesce((SELECT state FROM wake_claims WHERE session='parent'),'')"
            ).fetchone()[0]
            claim_owner = database.execute(
                "SELECT coalesce((SELECT owner FROM wake_claims WHERE session='parent'),'')"
            ).fetchone()[0]
            claim_generation = database.execute(
                "SELECT coalesce((SELECT generation FROM wake_claims WHERE session='parent'),0)"
            ).fetchone()[0]
            pending = database.execute(
                "SELECT count(*) FROM messages WHERE recipient='parent' AND receipt IS NULL"
            ).fetchone()[0]
            execution = database.execute(
                "SELECT phase,status FROM executions WHERE session='parent' AND id=?",
                (ATTEMPT,)).fetchone()
            turns = database.execute(
                "SELECT count(*) FROM turns WHERE worker='parent'").fetchone()[0]
            attempts = len(sorted(self.directory.glob('state.db.attempt-*')))
        return {'claim': claim, 'claimOwner': claim_owner,
                'claimGeneration': claim_generation, 'pending': pending,
                'execution': execution, 'turns': turns, 'attempts': attempts}

    def wait_helper(self, pid, timeout=240):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            stat = pathlib.Path('/proc') / str(pid) / 'stat'
            try:
                fields = stat.read_text().rsplit(')', 1)[1].split()
            except OSError:
                return None
            if not fields:
                return None
            if fields[0] == 'Z':
                return int(fields[49]) >> 8 if len(fields) >= 50 else None
            time.sleep(0.02)
        self.fail('the executing call did not return; no signal was sent')

    def wait_marker(self, name, timeout=150):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if (self.attempt / name).exists():
                return True
            time.sleep(0.05)
        return False

    def helper_output(self):
        path = self.attempt / 'observer.log'
        return path.read_text() if path.exists() else ''

    def markers(self):
        names = ('acknowledged', 'released', 'recovery-blocked', 'observer-error',
                 'status')
        return {name: (self.attempt / name).read_text().strip()
                for name in names if (self.attempt / name).exists()}

    def run_scenario(self, contention):
        self.seed()
        start = self.start()
        guard = owner_pid(self.db)
        holder = None
        if contention:
            holder = sqlite3.connect(self.db, isolation_level=None, timeout=30)
            holder.execute('BEGIN IMMEDIATE')
            holder.execute("UPDATE messages SET body=body WHERE id='msg-02'")
        blocked_seen = False
        try:
            pid = self.helper()
            if contention:
                blocked_seen = self.wait_marker('recovery-blocked')
                holder.execute('ROLLBACK')
                holder.close()
                holder = None
            exit_status = self.wait_helper(pid)
        finally:
            if holder is not None:
                holder.execute('ROLLBACK')
                holder.close()
        evidence = {'scenario': 'contention' if contention else 'normal',
                    'helperPid': pid, 'helperExit': exit_status,
                    'guardPid': guard, 'guardAlive': guard is not None and
                    pathlib.Path('/proc', str(guard)).exists(),
                    'blockedSeen': blocked_seen,
                    'startObserverPid': start.pid,
                    'helperSha256': sha256(HELPER),
                    'fixtureSha256': sha256(FIXTURE),
                    'markers': self.markers(),
                    'state': self.state(),
                    'observerLog': self.helper_output()}
        return evidence


class Lifecycle(Executing):
    def test_live_owner_recovery_completes_and_settles_the_claim(self):
        evidence = self.run_scenario(False)
        print('EVIDENCE ' + json.dumps(evidence, sort_keys=True), flush=True)
        # The keeper holds the session guard for the retained attempt. The
        # executing call must observe without taking it: a call that tried to
        # acquire the guard would block and leave this attempt unobserved.
        self.assertTrue(evidence['guardAlive'],
                        'the keeper guard must stay live during the executing call')
        # Exit status: a nonzero recovery exit records observer-error in the
        # attempt, and an observed zombie status is the call's own code.
        self.assertNotIn('observer-error', evidence['markers'],
                         'the executing call must exit 0')
        if evidence['helperExit'] is not None:
            self.assertEqual(evidence['helperExit'], 0,
                             'the executing call must exit 0')
        self.assertEqual(evidence['markers'].get('status'), '0',
                         'the retained exit status must stay recorded')
        self.assertTrue((self.attempt / 'acknowledged').exists(),
                        'the executing call must acknowledge the completed attempt')
        self.assertTrue((self.attempt / 'released').exists(),
                        'the executing call must release the retained attempt')
        self.assertFalse((self.attempt / 'recovery-blocked').exists(),
                         'a normal completion must not record a blocked cause')
        self.assertEqual(evidence['state']['execution'][0], 'exited',
                         'the completion must record the executions row')
        self.assertGreater(evidence['state']['claimGeneration'], 1,
                           'the completion must advance the wake claim for the '
                           'continuation, not leave generation 1 stranded')
        self.assertGreaterEqual(evidence['state']['turns'], 1,
                                'the released attempt must continue the owed '
                                'input in a new attempt')
        self.assertGreaterEqual(evidence['state']['attempts'], 1,
                                'the released attempt must remain on record')

    def test_contention_records_a_typed_blocked_cause_and_releases_the_ticket(self):
        evidence = self.run_scenario(True)
        print('EVIDENCE ' + json.dumps(evidence, sort_keys=True), flush=True)
        self.assertTrue(evidence['blockedSeen'],
                        'the held write lock must produce a typed blocked cause')
        blocked = self.attempt / 'recovery-blocked'
        cause = json.loads(blocked.read_text())
        self.assertEqual(cause['schema'], 'baton2-recovery-blocked-v1')
        self.assertEqual(cause['session'], SESSION)
        self.assertIn('locked', cause['cause'])
        # Typed cause, not an untyped database exit: the keeper records a
        # nonzero recovery exit and exit 5 appears as wait status 1280.
        self.assertNotIn('observer-error', evidence['markers'],
                         'a typed blocked cause must answer with exit 0')
        self.assertNotIn('wait status 1280',
                         evidence['markers'].get('observer-error', ''),
                         'the executing call must not exit with SQLITE_BUSY')
        if evidence['helperExit'] is not None:
            self.assertNotEqual(evidence['helperExit'], 5,
                                'the executing call must not exit with SQLITE_BUSY')
            self.assertEqual(evidence['helperExit'], 0,
                             'the typed blocked cause must answer with exit 0')
        # Exact ticket settlement: the admission row read under the guard is
        # released, never a blanket session delete, and the owed input stays.
        self.assertNotIn('claimed', evidence['state']['claim'])
        self.assertEqual(evidence['state']['claimGeneration'], 0,
                         'the exact admission ticket must be released')
        self.assertEqual(evidence['state']['pending'], PENDING,
                         'owed input stays unacknowledged for the next driver')


if __name__ == '__main__':
    unittest.main(verbosity=2)
