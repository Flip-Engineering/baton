"""Exercise the retained-observer executing-call protocol against a live owner.

The fixture starts one retained OMP native under the database instance owner.
The admitting process prints ``started`` and waits for a gate file, then exits:
that is observer loss while the owner keeper stays live. The keeper spawns the
recorded ``--recover-receive`` executing call from the attempt manifest. The
native writes a normal OMP session, one assistant message and an agent_end,
then exits 0.

One released old attempt is produced first by the same fixture and helper. Its
custody files are the durable record of a real start, observation,
acknowledgement and release.

Three scenarios run against the same source:

  normal       no competing lock. The executing call observes to EOF, records
               the retained exit, settles the executions row, continues the
               owed input in a new attempt and acknowledges it.
  contention   an admin writer holds BEGIN IMMEDIATE and an UPDATE. The
               executing call records a typed recovery-blocked cause for
               SQLITE_BUSY, retains every custody file and releases the exact
               wake-claim ticket.
  cycle        a public reader holds a SHARED read transaction; an admin writer
               begins an immediate transaction and its COMMIT is refused while
               the reader stays open. The reader stays open while the executing
               call contends, so recovery waits on the long read, records the
               typed cause and releases the exact ticket.

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
OWNER = pathlib.Path(os.environ.get(
    'OBSERVER_EXECUTING_OWNER', str(HELPER)))
SESSION = 'parent'
ATTEMPT = 'turn1'
OLD_ATTEMPT = 'receive:parent:old'
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


def write_native(path, observed, marker):
    """Write a native that emits the retained frames for both argv shapes.

    The admitting call uses ``[python, script, observed, marker]``. The
    continuation uses the OMP argv whose first argument is an option, so the
    script falls back to the values embedded here.
    """
    script = ['#!' + sys.executable,
              'import pathlib,sys,time',
              'fallback = (len(sys.argv) <= 2 or sys.argv[1].startswith("-")'
              ' or sys.argv[2].startswith("-"))',
              'value = %r if fallback else sys.argv[1]' % observed,
              'target = %r if fallback else sys.argv[2]' % str(marker),
              'pathlib.Path(target).write_text(value)']
    script += ['sys.stdout.write(' + repr(frame + '\n') + ')' for frame in FRAMES]
    script += ['sys.stdout.flush()', 'time.sleep(0.1)']
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
        for path in (FIXTURE, HELPER, OWNER):
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
        self.home = pathlib.Path(tempfile.mkdtemp(
            prefix='observer-home-', dir=ROOT / '.scratch/bend2'))
        self.addCleanup(shutil.rmtree, str(self.home), True)
        self.environment = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime),
                                HOME=str(self.home))
        self.environment.pop('BATON2_GIT_REGISTRY', None)
        self.db = self.directory / 'state.db'
        self.attempt = self.directory / 'attempt'
        self.workspace = self.directory / 'workspace'
        sqlite3.connect(self.db).close()
        self.workspace.mkdir()
        self.log = self.directory / 'native.log'
        self.uuid_marker = self.directory / 'native-uuid.txt'
        self.native = self.directory / 'native.py'
        write_native(self.native, NATIVE_UUID, self.uuid_marker)
        self.old_attempt = self.directory / (
            'state.db.attempt-' + OLD_ATTEMPT.encode().hex())
        self.old_log = self.directory / 'old.log'
        self.old_marker = self.directory / 'old-marker.txt'
        self.old_native = self.directory / 'old-native.py'
        write_native(self.old_native, NATIVE_UUID, self.old_marker)
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

    def launch_attempt(self, attempt, directory, native, marker, cursor, log):
        gate = self.directory / ('gate-' + attempt.replace(':', '-'))
        process = subprocess.Popen(
            [str(FIXTURE), 'start', str(self.db), attempt, str(directory),
             str(self.workspace), str(log), NATIVE_UUID, str(HELPER), 'omp',
             'controlled-model', 'low', sys.executable, str(native),
             str(marker), str(cursor), str(gate)],
            text=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, env=self.environment)
        line = process.stdout.readline()
        if 'started' not in line:
            rest = process.stdout.read()
            process.wait(timeout=60)
            self.fail('fixture start did not reach the gate: ' + line + rest)
        return process, gate, line

    def release_attempt(self, process, gate, first):
        gate.write_text('go\n')
        try:
            rest = process.stdout.read()
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            self.fail('fixture start did not complete')
        output = first + rest
        self.assertEqual(process.returncode, 0, output)
        return output

    def seed(self):
        self.fixture('init', self.db, 'omp')
        with sqlite3.connect(self.db) as database:
            database.execute('DELETE FROM messages')
        process, gate, first = self.launch_attempt(
            OLD_ATTEMPT, self.old_attempt, self.old_native, self.old_marker,
            '1', self.old_log)
        self.release_attempt(process, gate, first)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if ((self.old_attempt / 'acknowledged').exists() and
                    (self.old_attempt / 'released').exists()):
                break
            time.sleep(0.02)
        self.assertTrue((self.old_attempt / 'admission').exists(),
                        'the old attempt must be a real admitted attempt')
        self.assertTrue((self.old_attempt / 'manifest').exists(),
                        'the old attempt must keep its manifest')
        self.assertTrue((self.old_attempt / 'acknowledged').exists(),
                        'the old attempt must be acknowledged')
        self.assertTrue((self.old_attempt / 'released').exists(),
                        'the old attempt must be released')
        self.old_files = sorted(path.name for path in self.old_attempt.iterdir())
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET native=? WHERE id='parent'",
                             (NATIVE_UUID,))
            database.execute(
                "INSERT INTO messages(id,sender,recipient,kind,body) "
                "VALUES('task','parent','parent','task',"
                "'Monitor the retained attempt.')")
            for index in range(2, PENDING + 1):
                database.execute(
                    "INSERT INTO messages(id,sender,recipient,kind,body) "
                    "VALUES(?, 'parent','parent','task',?)",
                    ('msg-%02d' % index, 'synthetic pending input %d' % index))
            database.execute(
                "INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) "
                "VALUES('parent','claimed','task',1)")

    def start(self):
        process, gate, first = self.launch_attempt(
            ATTEMPT, self.attempt, self.native, self.uuid_marker, '0', self.log)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if ((self.attempt / 'native.pid').exists() and
                    (self.attempt / 'stdout').exists() and
                    self.uuid_marker.exists()):
                break
            time.sleep(0.02)
        self.assertTrue((self.attempt / 'native.pid').exists(),
                        'native.pid was not written')
        self.assertTrue((self.attempt / 'stdout').exists(),
                        'the owner did not spool native stdout to a file')
        self.spool_bytes = (self.attempt / 'stdout').stat().st_size
        self.stdout_regular = (self.attempt / 'stdout').is_file()
        self.stderr_regular = (self.attempt / 'native.stderr').is_file()
        self.assertIsNotNone(owner_pid(self.db), 'instance owner did not stay live')
        return process, gate, first

    def helper(self):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            pid = receive_pid(self.db, ATTEMPT)
            if pid:
                return pid
            if ((self.attempt / 'acknowledged').exists() and
                    (self.attempt / 'released').exists()):
                return None
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
                "SELECT id,phase,status FROM executions WHERE session='parent'"
            ).fetchone()
            turns = database.execute(
                "SELECT count(*) FROM turns WHERE worker='parent'").fetchone()[0]
            attempts = len([
                path for path in self.directory.iterdir()
                if path.name == 'attempt' or path.name.startswith('state.db.attempt-')])
        return {'claim': claim, 'claimOwner': claim_owner,
                'claimGeneration': claim_generation, 'pending': pending,
                'execution': execution, 'turns': turns, 'attempts': attempts}

    def wait_helper(self, pid, timeout=240):
        if pid is None:
            return None
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

    def run_scenario(self, scenario):
        self.seed()
        process, gate, first = self.start()
        guard = owner_pid(self.db)
        reader = None
        writer = None
        cycle = {}
        try:
            if scenario == 'contention':
                writer = sqlite3.connect(self.db, isolation_level=None, timeout=30)
                writer.execute('BEGIN IMMEDIATE')
                writer.execute("UPDATE messages SET body=body WHERE id='msg-02'")
            elif scenario == 'cycle':
                reader = sqlite3.connect(self.db, isolation_level=None, timeout=0)
                reader.execute('BEGIN')
                reader.execute("SELECT count(*) FROM messages").fetchone()
                writer = sqlite3.connect(self.db, isolation_level=None, timeout=0)
                writer.execute('BEGIN IMMEDIATE')
                writer.execute("UPDATE messages SET body=body WHERE id='msg-02'")
                try:
                    writer.execute('COMMIT')
                    cycle['writerCommit'] = 'accepted'
                except sqlite3.OperationalError as error:
                    cycle['writerCommit'] = 'refused'
                    cycle['writerError'] = str(error)
                writer.execute('ROLLBACK')
                writer.close()
                writer = None
            start_output = self.release_attempt(process, gate, first)
            blocked_seen = False
            pid = self.helper()
            if scenario != 'normal':
                blocked_seen = self.wait_marker('recovery-blocked')
                if blocked_seen:
                    time.sleep(2.0)
                if scenario == 'cycle':
                    reader.execute('ROLLBACK')
                    reader.close()
                    reader = None
                    cycle['readerEnded'] = 'released'
                    verifier = sqlite3.connect(self.db)
                    verifier.execute(
                        "UPDATE messages SET body=body WHERE id='msg-02'")
                    verifier.commit()
                    verifier.close()
                    cycle['after'] = 'committed'
                else:
                    writer.execute('ROLLBACK')
                    writer.close()
                    writer = None
            exit_status = self.wait_helper(pid)
        finally:
            for connection in (reader, writer):
                if connection is not None:
                    try:
                        connection.execute('ROLLBACK')
                    except sqlite3.OperationalError:
                        pass
                    connection.close()
        evidence = {'scenario': scenario,
                    'helperPid': pid, 'helperExit': exit_status,
                    'guardPid': guard, 'guardAlive': guard is not None and
                    pathlib.Path('/proc', str(guard)).exists(),
                    'blockedSeen': blocked_seen,
                    'cycle': cycle,
                    'startOutput': start_output,
                    'helperSha256': sha256(HELPER),
                    'fixtureSha256': sha256(FIXTURE),
                    'spoolBytes': self.spool_bytes,
                    'stdoutRegular': self.stdout_regular,
                    'stderrRegular': self.stderr_regular,
                    'oldFiles': self.old_files,
                    'markers': self.markers(),
                    'state': self.state(),
                    'observerLog': self.helper_output()}
        return evidence

    def assert_released_old_attempt(self):
        self.assertTrue((self.old_attempt / 'acknowledged').exists(),
                        'the released old attempt must stay acknowledged')
        self.assertTrue((self.old_attempt / 'released').exists(),
                        'the released old attempt must stay released')
        self.assertEqual((self.old_attempt / 'status').read_text().strip(), '0',
                         'the old attempt must record its natural exit')


class Lifecycle(Executing):
    def test_live_owner_recovery_completes_and_settles_the_claim(self):
        evidence = self.run_scenario('normal')
        print('EVIDENCE ' + json.dumps(evidence, sort_keys=True), flush=True)
        # The keeper holds the session guard for the retained attempt. The
        # executing call must observe without taking it: a call that tried to
        # acquire the guard would block and leave this attempt unobserved.
        self.assertTrue(evidence['guardAlive'],
                        'the keeper guard must stay live during the executing call')
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
        execution = evidence['state']['execution']
        self.assertIsNotNone(execution, 'the completion must record an execution')
        self.assertEqual(execution[1], 'exited',
                         'the completion must record the executions row')
        self.assertEqual(execution[2], 'exit 0',
                         'the continuation must record its natural exit')
        self.assertNotEqual(execution[0], ATTEMPT,
                            'the owed input must continue in a new attempt')
        self.assertEqual(evidence['state']['pending'], 0,
                         'the continuation must acknowledge the owed input')
        self.assertEqual(evidence['state']['claimGeneration'], 0,
                         'the settlement must remove the stale claim ticket')
        self.assertNotIn('claimed', evidence['state']['claim'])
        self.assertGreaterEqual(evidence['state']['attempts'], 3,
                                'the old attempt, the recovered attempt and its '
                                'continuation must remain on record')
        self.assertTrue(evidence['stdoutRegular'],
                        'native stdout must be a regular file')
        self.assertTrue(evidence['stderrRegular'],
                        'native stderr must be a regular file')
        self.assertGreater(evidence['spoolBytes'], 0,
                           'the native frames must be persisted in the stdout spool')
        self.assert_released_old_attempt()

    def test_contention_records_a_typed_blocked_cause_and_releases_the_ticket(self):
        evidence = self.run_scenario('contention')
        print('EVIDENCE ' + json.dumps(evidence, sort_keys=True), flush=True)
        self.assertTrue(evidence['blockedSeen'],
                        'the held write lock must produce a typed blocked cause')
        cause = json.loads((self.attempt / 'recovery-blocked').read_text())
        self.assertEqual(cause['schema'], 'baton2-recovery-blocked-v1')
        self.assertEqual(cause['session'], SESSION)
        self.assertEqual(cause['code'], 5, 'SQLITE_BUSY must stay the typed code')
        self.assertIn('locked', cause['cause'])
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
        self.assertNotIn('claimed', evidence['state']['claim'])
        self.assertEqual(evidence['state']['claimGeneration'], 0,
                         'the exact admission ticket must be released')
        self.assertEqual(evidence['state']['pending'], PENDING,
                         'owed input stays unacknowledged for the next driver')
        self.assertTrue((self.attempt / 'admission').exists(),
                        'a blocked recovery retains its admission')
        self.assertTrue((self.attempt / 'manifest').exists(),
                        'a blocked recovery retains its manifest')
        self.assertTrue((self.attempt / 'checkpoint').exists(),
                        'a blocked recovery retains its checkpoint')
        self.assertFalse((self.attempt / 'acknowledged').exists(),
                         'a blocked recovery must not acknowledge the attempt')
        self.assertFalse((self.attempt / 'released').exists(),
                         'a blocked recovery must not release the attempt')
        self.assertGreaterEqual(evidence['state']['attempts'], 2,
                                'the old attempt and the retained attempt must '
                                'remain on record')
        self.assert_released_old_attempt()

    def test_public_reader_admin_writer_long_read_cycle(self):
        evidence = self.run_scenario('cycle')
        print('EVIDENCE ' + json.dumps(evidence, sort_keys=True), flush=True)
        self.assertEqual(evidence['cycle'].get('writerCommit'), 'refused',
                         'the admin writer COMMIT must wait on the public reader')
        self.assertIn('locked', evidence['cycle'].get('writerError', ''))
        self.assertTrue(evidence['blockedSeen'],
                        'the long read must produce a typed blocked cause')
        cause = json.loads((self.attempt / 'recovery-blocked').read_text())
        self.assertEqual(cause['code'], 5)
        self.assertIn('locked', cause['cause'])
        self.assertNotIn('observer-error', evidence['markers'],
                         'a typed blocked cause must answer with exit 0')
        if evidence['helperExit'] is not None:
            self.assertEqual(evidence['helperExit'], 0,
                             'the typed blocked cause must answer with exit 0')
        self.assertEqual(evidence['state']['claimGeneration'], 0,
                         'the exact admission ticket must be released')
        self.assertEqual(evidence['state']['pending'], PENDING,
                         'owed input stays unacknowledged for the next driver')
        self.assertTrue((self.attempt / 'manifest').exists(),
                        'a blocked recovery retains its manifest')
        self.assertTrue((self.attempt / 'checkpoint').exists(),
                        'a blocked recovery retains its checkpoint')
        self.assertEqual(evidence['cycle'].get('readerEnded'), 'released')
        self.assertEqual(evidence['cycle'].get('after'), 'committed',
                         'the database must accept a write after the long read')
        self.assertGreaterEqual(evidence['state']['attempts'], 2)
        self.assert_released_old_attempt()


if __name__ == '__main__':
    unittest.main(verbosity=2)
