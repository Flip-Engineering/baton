"""One shared custody owner serves concurrent attempts on one physical database.

The owner holds every attempt's stdin writer, wait authority and stdout spool,
and it is elected by the database's physical identity in one stable per-user IPC
directory. These tests exercise concurrent attempts, alias election, observer
loss, the bound observation checkpoint, admission identity and owner shutdown.
"""
import fcntl
import hashlib
import json
import os
import pathlib
import queue
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/instance-test'

FIXTURE = r'''import json,os,sys
print(json.dumps({"role":"native","pid":os.getpid(),"ppid":os.getppid()}),flush=True)
for line in sys.stdin:
    if line.strip()=="exit": break
    print("echo:"+line.strip(),flush=True)
print("native-done",flush=True)
'''


MUSE_FIXTURE = r'''import hashlib,json,os,sys
args=sys.argv[1:]
path=args[args.index("--prompt-file")+1]
data=open(path,"rb").read()
mode=oct(os.stat(path).st_mode & 0o777)
print(json.dumps({"role":"native","pid":os.getpid(),"ppid":os.getppid(),
                  "prompt_bytes":len(data),"prompt_sha256":hashlib.sha256(data).hexdigest(),
                  "prompt_mode":mode,"session_id":args[args.index("--session-id")+1]}),flush=True)
first=sys.stdin.read(1)
print("stdin_state:"+("eof" if first=="" else "open"),flush=True)
for index in range(1,4):
    print("progress:%d"%index,flush=True)
print("terminal",flush=True)
'''


SURVIVOR = r'''import json,os,sys,threading,time
print(json.dumps({"role":"native","pid":os.getpid(),"ppid":os.getppid()}),flush=True)
def drain():
    try:
        for line in sys.stdin:
            print("echo:"+line.rstrip("\n"),flush=True)
    except Exception:
        pass
threading.Thread(target=drain,daemon=True).start()
count=0
while True:
    print("tick:%d"%count,flush=True)
    count+=1
    time.sleep(1)
'''


class SharedInstance(unittest.TestCase):
    CHECKPOINT_HEADER = struct.Struct('=8sIIQQQQQQQQi4xQQ')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="b2 shared instance's ")
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name).resolve()
        self.db = self.home / 'instance.db'
        self.db.touch()
        self.fixture = self.home / 'native.py'
        self.fixture.write_text(FIXTURE)
        self.muse_fixture = self.home / 'muse.py'
        self.muse_fixture.write_text(MUSE_FIXTURE)
        self.survivor = self.home / 'survivor.py'
        self.survivor.write_text(SURVIVOR)
        self.children = []
        self.addCleanup(self.cleanup)

    # -- harness ----------------------------------------------------------

    def ipc_directory(self):
        runtime = os.environ.get('XDG_RUNTIME_DIR')
        for candidate in [f'{runtime}/baton2' if runtime else None,
                          f'/tmp/baton2-{os.geteuid()}',
                          f"{os.environ.get('HOME')}/.local/state/baton2"]:
            if not candidate:
                continue
            path = pathlib.Path(candidate)
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError:
                continue
            if path.is_dir() and not path.is_symlink() and path.stat().st_uid == os.geteuid():
                return path
        self.fail('no per-user IPC directory')

    def election_paths(self, database=None):
        info = os.stat(database or self.db)
        key = f'owner-{info.st_dev:x}-{info.st_ino:x}'
        directory = self.ipc_directory()
        return directory, key, directory / f'{key}.lock', directory / f'{key}.record', directory / f'{key}.sock'

    def election_held(self, database=None):
        _, _, lock, _, _ = self.election_paths(database)
        if not lock.exists():
            return False
        handle = os.open(lock, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(handle, fcntl.LOCK_UN)
            return False
        except BlockingIOError:
            return True
        finally:
            os.close(handle)

    def cleanup(self):
        subprocess.run([str(EXE), 'shutdown', str(self.db)], capture_output=True,
                       text=True, timeout=10)
        # Every owner this test started must be gone and the election free before
        # the next test runs, so one test's custody cannot answer for another's
        # database when the filesystem reuses an inode.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            for line in self.owner_processes():
                try:
                    os.kill(int(line.split()[0]), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            _, _, _, record, _ = self.election_paths()
            if self.election_held() and record.exists():
                raw = record.read_bytes()
                if len(raw) == 144:
                    incumbent = struct.unpack_from('=i', raw, 32)[0]
                    try:
                        os.kill(incumbent, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            if not self.election_held():
                break
            time.sleep(.05)
        self.assertFalse(self.election_held(), 'the election lock stayed held after cleanup')
        _, key, _, record, socket_path = self.election_paths()
        for path in (record, socket_path, self.ipc_directory() / f'{key}.log'):
            if path.exists():
                path.unlink()
        for child in self.children:
            if child.poll() is None:
                child.kill()
            if child.stdin and not child.stdin.closed:
                child.stdin.close()
            child.wait(timeout=10)
            child.stdout.close()
            child.stderr.close()

    def spawn(self, *args):
        child = subprocess.Popen([str(EXE), *map(str, args)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        child.lines = queue.Queue()
        child.output = []

        def read():
            for line in child.stdout:
                child.output.append(line)
                child.lines.put(line.rstrip('\n'))
            child.lines.put(None)

        threading.Thread(target=read, daemon=True).start()
        return child

    def line(self, child, expected):
        while True:
            value = child.lines.get(timeout=30)
            self.assertIsNotNone(value, ''.join(child.output))
            if value == expected:
                return

    def owner_state(self):
        lines = ['owner processes: ' + ' | '.join(self.owner_processes())]
        directory, key, lock, record, socket_path = self.election_paths()
        lines.append(f'election {key} lock={lock.exists()} record={record.exists()} '
                     f'socket={socket_path.exists()} held={self.election_held()}')
        log = directory / f'{key}.log'
        if log.exists():
            lines.append('owner log: ' + log.read_text(errors='replace')[-800:])
        return '\n'.join(lines)

    def wait_run(self, child):
        child.stdin.close()
        child.wait(timeout=60)
        if child.returncode != 0:
            self.fail(child.stderr.read() + '\n' + self.owner_state())
        return ''.join(child.output)

    def command(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], capture_output=True,
                              text=True, timeout=30)

    def begin(self, label, session=None, mode='admit', payload='hello\n', cwd=None):
        directory = pathlib.Path(f'{self.db}.attempt-{label}')
        child = self.spawn(mode, self.db, session or label, directory, cwd or self.home,
                           payload, sys.executable, self.fixture)
        return directory, child

    def native(self, output):
        for line in output.splitlines():
            if line.startswith('{'):
                return json.loads(line)
        self.fail('no native summary in ' + output)

    def owner_processes(self):
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,command='], capture_output=True,
                                text=True, timeout=10)
        return [line for line in result.stdout.splitlines()
                if '--instance-owner' in line and str(self.home) in line]

    def write(self, directory, text):
        path = self.home / 'control.payload'
        path.write_text(text)
        result = self.command('control-write', directory, path)
        self.assertIn('control-write-complete', result.stdout, result.stderr)

    def hold(self, path, expected, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists() and expected in path.read_text(errors='replace'):
                return path.read_text(errors='replace')
            time.sleep(.05)
        self.fail(f'{expected!r} never reached {path}: ' +
                  (path.read_text(errors='replace') if path.exists() else 'missing'))

    # -- checkpoint fixtures ----------------------------------------------

    def patch_checkpoint(self, directory, recompute=True, state=None, **overrides):
        """Takes the record the host wrote and changes exactly one binding, so a
        test presents a record whose only defect is the one under test."""
        path = directory / 'checkpoint'
        raw = path.read_bytes()
        header = self.CHECKPOINT_HEADER
        (magic, schema, reserved, incarnation, attempt, manifest, spool_device,
         spool_inode, offset, length, check, pid, first, second) = header.unpack_from(raw, 0)
        body = raw[header.size:]
        values = dict(schema=schema, attempt=attempt, incarnation=incarnation,
                      manifest=manifest, spool=(spool_device, spool_inode), offset=offset,
                      birth=(pid, first, second))
        for key, value in overrides.items():
            values[key] = value
        schema, attempt, incarnation = values['schema'], values['attempt'], values['incarnation']
        manifest, offset = values['manifest'], values['offset']
        spool_device, spool_inode = values['spool']
        pid, first, second = values['birth']
        if state is not None:
            body = state.encode()
            length = len(body)
        head = header.pack(magic, schema, reserved, incarnation, attempt, manifest,
                           spool_device, spool_inode, offset, length, 0, pid, first, second)
        digest = check
        if recompute:
            digest = 0xcbf29ce484222325
            for byte in head[:72] + head[80:] + body:
                digest ^= byte
                digest = (digest * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
        path.write_bytes(head[:72] + struct.pack('=Q', digest) + head[80:] + body)

    def replays_from_the_beginning(self, directory, child):
        """Kills the observer and asserts the recovery observer replays every frame."""
        child.kill()
        child.wait(timeout=10)
        marker = self.hold(directory / 'checkpoint-error',
                           'unusable observation checkpoint; replaying from the beginning')
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('"role": "native"', text,
                      'an unusable checkpoint must replay the stream rather than skip it')
        return marker.strip(), text

    # -- tests ------------------------------------------------------------

    def test_concurrent_attempts_share_one_owner_process(self):
        runs = [self.begin(f'a{index}', session=f's{index}', payload=f'hello-{index}\n')
                for index in range(3)]
        outputs = [self.wait_run(child) for _, child in runs]
        for index, output in enumerate(outputs):
            self.assertIn('admitted', output)
            self.assertIn(f'echo:hello-{index}', output)
            self.assertIn('native-done', output)
            self.assertIn('native-exit 0', output)
            self.assertIn('release-ok', output)
            self.assertIn('acknowledge-ok', output)
            self.assertIn('attempt-complete', output)
            for other in range(3):
                if other != index:
                    self.assertNotIn(f'echo:hello-{other}', output)
        summaries = [self.native(output) for output in outputs]
        parents = {summary['ppid'] for summary in summaries}
        self.assertEqual(len(parents), 1, summaries)
        self.assertNotIn(os.getpid(), parents)
        owners = self.owner_processes()
        self.assertEqual(len(owners), 1, owners)
        owner_pid = int(owners[0].split()[0])
        self.assertEqual(parents, {owner_pid}, (owners, summaries))
        print('evidence owner', owners[0].strip())
        print('evidence natives', [summary['pid'] for summary in summaries])

    def test_second_owner_for_one_database_is_refused(self):
        directory, child = self.begin('a0')
        self.line(child, 'admitted')
        result = self.command('owner-try', self.db)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('owner-refused:', result.stdout)
        self.assertIn('busy', result.stdout.lower())
        self.assertEqual(len(self.owner_processes()), 1)
        print('evidence second-owner', result.stdout.strip())

    def test_hard_link_alias_converges_on_one_owner(self):
        directory, child = self.begin('base', payload='base\n')
        self.assertIn('echo:base', self.wait_run(child))
        owners = self.owner_processes()
        self.assertEqual(len(owners), 1, owners)
        link = self.home / 'alias.db'
        os.link(self.db, link)
        result = self.command('owner-try', link)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('owner-refused:', result.stdout)
        self.assertIn('busy', result.stdout.lower())
        aliased = pathlib.Path(f'{link}.attempt-alias')
        second = self.spawn('admit', link, 'alias-session', aliased, self.home,
                            'alias\n', sys.executable, self.fixture)
        alias_output = self.wait_run(second)
        self.assertIn('echo:alias', alias_output)
        summary = self.native(alias_output)
        self.assertEqual(summary['ppid'], int(owners[0].split()[0]), (summary, owners))
        print('evidence alias-election', result.stdout.strip())
        print('evidence alias-native', summary['pid'], 'owner', summary['ppid'])

    def test_election_directory_binds_the_physical_database(self):
        directory, child = self.begin('layout', payload='layout\n')
        self.assertIn('echo:layout', self.wait_run(child))
        ipc, key, lock, record, socket_path = self.election_paths()
        self.assertTrue(lock.exists())
        self.assertTrue(socket_path.exists())
        self.assertTrue(record.exists())
        mode = ipc.stat().st_mode & 0o777
        self.assertEqual(mode, 0o700, oct(mode))
        self.assertEqual(ipc.stat().st_uid, os.geteuid())
        token, epoch, device, inode, pid, _ = struct.unpack_from('=QQQQii', record.read_bytes(), 0)
        info = os.stat(self.db)
        self.assertEqual(device, info.st_dev)
        self.assertEqual(inode, info.st_ino)
        self.assertGreaterEqual(epoch, 1)
        self.assertGreater(token, 0)
        self.assertEqual(record.read_bytes()[40:].split(b'\0')[0].decode(), str(socket_path))
        print('evidence election', str(ipc), key, 'epoch', epoch, 'pid', pid)

    def test_observer_loss_keeps_native_work_and_retained_output(self):
        directory, child = self.begin('held', mode='hold', payload='one\n')
        self.line(child, 'admitted')
        spool = directory / 'stdout'
        self.hold(spool, 'echo:one')
        summary = self.native(spool.read_text(errors='replace'))
        child.kill()
        child.wait(timeout=10)
        alive = os.kill(summary['pid'], 0) is None
        self.assertTrue(alive, 'the native child ended with its observer')
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('"role": "native"', text)
        self.write(directory, 'two\n')
        self.hold(log, 'echo:two')
        self.write(directory, 'exit\n')
        self.hold(log, 'native-exit 0')
        print('evidence native-pid', summary['pid'], 'survived-observer-kill', alive)
        print('evidence recovery-log', text.replace('\n', '|'))

    def test_retired_capability_refuses_the_old_generation(self):
        directory, child = self.begin('cycle')
        output = self.wait_run(child)
        self.assertIn('retire-ok', output)
        self.assertIn('stale-write-failed:', output)
        self.assertNotIn('stale-write-ok', output)
        print('evidence retirement', output.replace('\n', '|'))

    def test_recovery_resumes_at_the_committed_checkpoint(self):
        directory, child = self.begin('partial', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-ok')
        checkpoint = directory / 'checkpoint'
        self.hold(checkpoint, '')
        record = checkpoint.read_bytes()
        self.assertEqual(record[:8], b'BATONC03')
        self.assertIn(b'seen two frames', record)
        self.write(directory, 'two\n')
        self.hold(directory / 'stdout', 'echo:two')
        child.kill()
        child.wait(timeout=10)
        log = directory / 'observer.log'
        text = self.hold(log, 'restored:{"reducer":"seen two frames"}')
        self.assertNotIn('echo:one', text,
                         'the recovery observer replayed output the checkpoint already covered')
        self.write(directory, 'exit\n')
        self.hold(log, 'native-exit 0')
        print('evidence committed-checkpoint-bytes', len(record))
        print('evidence committed-recovery-log', text.replace('\n', '|'))

    def test_checkpoint_accepted_across_an_owner_restart(self):
        directory, child = self.begin('restart', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-ok')
        _, _, _, record, _ = self.election_paths()
        token = struct.unpack_from('=Q', record.read_bytes(), 0)[0]
        self.patch_checkpoint(directory, incarnation=token ^ 0xFFFFFFFFFFFFFFFF)
        child.kill()
        child.wait(timeout=10)
        log = directory / 'observer.log'
        text = self.hold(log, 'restored:{"reducer":"seen two frames"}')
        self.assertNotIn('echo:one', text,
                         'a checkpoint from the same custody must survive an owner restart')
        print('evidence restart-resume', text.replace('\n', '|'))

    def test_checkpoint_bindings_are_enforced(self):
        cases = [('schema', dict(schema=2)),
                 ('attempt', dict(attempt=12345)),
                 ('birth', dict(birth=(999999, 1, 2))),
                 ('manifest', dict(manifest=1)),
                 ('spool', dict(spool=(12345, 67890))),
                 ('offset', dict(offset=1 << 40))]
        for label, mutation in cases:
            directory, child = self.begin(f'bind-{label}', mode='partial', payload='one\n')
            self.line(child, 'admitted')
            self.line(child, 'echo:one')
            self.line(child, 'commit-ok')
            self.patch_checkpoint(directory, **mutation)
            marker, _ = self.replays_from_the_beginning(directory, child)
            print('evidence binding', label, 'refused:', marker)
        # A same-length corruption of the state bytes, with the record's own
        # checksum left as written, must also be refused.
        directory, child = self.begin('bind-state', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-ok')
        record = (directory / 'checkpoint').read_bytes()
        inverted = bytes(byte ^ 0x01 for byte in record[self.CHECKPOINT_HEADER.size:])
        self.patch_checkpoint(directory, recompute=False, state=inverted.decode())
        marker, _ = self.replays_from_the_beginning(directory, child)
        print('evidence binding', 'state-corruption', 'refused:', marker)

    def test_crash_between_read_and_commit_reports_the_frame_again(self):
        directory, child = self.begin('uncommitted', mode='partial-uncommitted',
                                      payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-skipped')
        self.assertFalse((directory / 'checkpoint').exists(),
                         'a bare read must not create a durable checkpoint')
        child.kill()
        child.wait(timeout=10)
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('restored:', text)
        self.assertIn('"role": "native"', text,
                      'recovery must replay from the beginning when nothing was committed')
        print('evidence uncommitted-recovery-log', text.replace('\n', '|'))

    def test_torn_checkpoint_recovers_and_preserves_output(self):
        directory, child = self.begin('torn', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-ok')
        (directory / 'checkpoint').write_bytes(b'\x00torn-checkpoint')
        marker, text = self.replays_from_the_beginning(directory, child)
        print('evidence torn-checkpoint', marker)
        print('evidence torn-recovery-log', text.replace('\n', '|'))

    def test_repeated_admission_starts_no_second_native(self):
        directory, first = self.begin('repeat', mode='hold', payload='one\n')
        self.line(first, 'admitted')
        spool = directory / 'stdout'
        self.hold(spool, 'echo:one')
        repeated, second = self.begin('repeat', mode='hold', payload='one\n')
        second.stdin.close()
        second.wait(timeout=60)
        self.assertNotEqual(second.returncode, 0,
                            'a repeated admission while an observer holds the attempt is refused')
        self.assertEqual(spool.read_text(errors='replace').count('"role": "native"'), 1,
                         'a repeated admission must not start a second native child')
        first.kill()
        first.wait(timeout=10)
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('"role": "native"', text,
                      'the admitted attempt kept its custody and its stream across the repeat')
        self.assertEqual(spool.read_text(errors='replace').count('"role": "native"'), 1,
                         'the recovery observer must join the one existing native child')
        print('evidence repeated-admission second-exit', second.returncode)
        print('evidence repeated-admission recovery', text.replace('\n', '|'))

    def test_conflicting_reuse_of_one_attempt_is_refused(self):
        other = self.home / 'other-cwd'
        other.mkdir()
        directory, child = self.begin('conflict', mode='hold', payload='one\n')
        self.line(child, 'admitted')
        self.hold(directory / 'stdout', 'echo:one')
        repeated, second = self.begin('conflict', mode='hold', payload='one\n', cwd=other)
        second.stdin.close()
        second.wait(timeout=60)
        self.assertNotEqual(second.returncode, 0,
                            'different work in the same attempt directory must be refused')
        self.assertIn('File exists', second.stderr.read())
        # A refusal must never remove the custody that already exists.
        for name in ('manifest', 'stdout', 'native.birth', 'native.pid'):
            self.assertTrue((directory / name).exists(),
                            f'the refusal removed {name} from the existing attempt')
        self.assertEqual((directory / 'stdout').read_text(errors='replace').count('"role": "native"'), 1)
        print('evidence conflicting-reuse refused with custody preserved')
        child.kill()
        child.wait(timeout=10)

    def begin_file(self, label, artifact, session=None, name='prompt.txt', program=None):
        directory = pathlib.Path(f'{self.db}.attempt-{label}')
        args = program or [sys.executable, str(self.muse_fixture),
                           '--prompt-file', str(directory / name), '--session-id', label]
        child = self.spawn('admit-file', self.db, session or label, directory, self.home,
                           artifact, *args)
        return directory, child

    def test_prepared_file_admission_delivers_exact_bytes(self):
        artifact = 'the admitted prompt bytes\nwith a second line\n'
        directory, child = self.begin_file('muse', artifact)
        output = self.wait_run(child)
        summary = self.native(output)
        self.assertEqual(summary['prompt_bytes'], len(artifact))
        self.assertEqual(summary['prompt_sha256'], hashlib.sha256(artifact.encode()).hexdigest())
        self.assertEqual(summary['prompt_mode'], '0o400')
        self.assertIn('stdin_state:eof', output)
        self.assertEqual(output.count('terminal'), 1)
        self.assertEqual(output.count('progress:'), 3)
        record = (directory / 'manifest').read_bytes()
        self.assertEqual(record[:8], b'BATONRP2')
        self.assertIn(b'prompt.txt', record)
        print('evidence prepared-file', summary['prompt_sha256'], summary['prompt_mode'])

    def test_prepared_file_name_is_safely_refused(self):
        for name in ('../escape', '/absolute', '.', 'a/b', '..'):
            directory = pathlib.Path(f'{self.db}.attempt-{abs(hash(name))}')
            child = self.spawn('admit-file', self.db, 'bad', directory, self.home,
                               'bytes\n', name, sys.executable, str(self.muse_fixture),
                               '--prompt-file', str(directory / 'x'))
            child.stdin.close()
            child.wait(timeout=60)
            self.assertNotEqual(child.returncode, 0, name)
            self.assertTrue(str(child.stderr.read()).strip(), name)
            self.assertFalse((self.home / 'escape').exists(), name)
            print('evidence artifact-name refused', name)

    def test_prepared_file_identity_is_the_bytes(self):
        artifact = 'same bytes\n'
        directory, first = self.begin_file('same', artifact)
        self.line(first, 'admitted')
        repeated, second = self.begin_file('same', artifact)
        second.stdin.close()
        second.wait(timeout=60)
        self.assertNotEqual(second.returncode, 0,
                            'a repeat while an observer holds the attempt is refused, not duplicated')
        self.hold(directory / 'stdout', '"role": "native"')
        self.assertEqual((directory / 'stdout').read_text(errors='replace').count('"role": "native"'), 1)
        first.kill()
        first.wait(timeout=10)
        differing, third = self.begin_file('same', 'different bytes\n')
        third.stdin.close()
        third.wait(timeout=60)
        self.assertNotEqual(third.returncode, 0,
                            'different artifact bytes in the same attempt are conflicting reuse')
        self.assertIn('File exists', third.stderr.read())
        print('evidence prepared-file identity enforced')

    # -- committed-change subscription -------------------------------------

    def subscription_line(self, child, prefix):
        """Reads one subscription line and returns its JSON payload."""
        value = child.lines.get(timeout=30)
        self.assertIsNotNone(value, ''.join(child.output))
        self.assertTrue(value.startswith(prefix), value)
        return json.loads(value[len(prefix):])

    def test_committed_change_subscription_fans_out_and_survives_owner_loss(self):
        first = self.spawn('subscribe', self.db, '0', '0')
        ready = self.subscription_line(first, 'ready:')
        # An unknown incarnation cannot be served continuously, so the first
        # subscription takes a snapshot at the cursor the owner recorded. Publish
        # values are derived from that cursor: the owner record is keyed by the
        # physical database, and a temporary file can reuse an earlier file's key.
        self.assertTrue(ready['gap'], ready)
        baseline = ready['cursor']
        self.command('publish', self.db, str(baseline + 1))
        notice = self.subscription_line(first, 'notice:')
        self.assertEqual((notice['kind'], notice['cursor']), ('commit', baseline + 1), notice)
        self.command('publish', self.db, str(baseline + 2))
        self.assertEqual(self.subscription_line(first, 'notice:')['cursor'], baseline + 2)
        # A repeated cursor changes nothing.
        self.command('publish', self.db, str(baseline + 2))
        with self.assertRaises(queue.Empty):
            first.lines.get(timeout=1.5)
        # A subscription of the incumbent incarnation with a consumed cursor
        # resumes without a snapshot.
        second = self.spawn('subscribe', self.db, str(baseline + 2), str(ready['generation']))
        resuming = self.subscription_line(second, 'ready:')
        self.assertFalse(resuming['gap'], resuming)
        self.assertEqual(resuming['cursor'], baseline + 2, resuming)
        self.command('publish', self.db, str(baseline + 3))
        self.assertEqual(self.subscription_line(second, 'notice:')['cursor'], baseline + 3)
        self.assertEqual(self.subscription_line(first, 'notice:')['cursor'], baseline + 3)
        # A cursor below the record belongs to a different sequence: the publisher
        # is the authority there, and subscribers are told to snapshot rather than
        # wait for a value the database already passed.
        self.command('publish', self.db, str(baseline + 1))
        reset = self.subscription_line(first, 'notice:')
        self.assertEqual((reset['kind'], reset['cursor']), ('gap', baseline + 1), reset)
        # The cursor is durable across the owner incarnation, and a replaced
        # incarnation reports the gap that forces a snapshot.
        owners = self.owner_processes()
        self.assertEqual(len(owners), 1, owners)
        os.kill(int(owners[0].split()[0]), signal.SIGKILL)
        third = self.spawn('subscribe', self.db, str(baseline + 1), str(ready['generation']))
        replaced = self.subscription_line(third, 'ready:')
        self.assertTrue(replaced['gap'], replaced)
        self.assertEqual(replaced['cursor'], baseline + 1, replaced)
        self.command('publish', self.db, str(baseline + 4))
        self.assertEqual(self.subscription_line(third, 'notice:')['cursor'], baseline + 4)
        print('evidence subscription ready', ready, 'resuming', resuming, 'replaced', replaced)

    def test_checkpoint_record_beyond_the_state_bound_replays(self):
        """A record that claims more state than the bound is unusable, so the
        observer replays from the beginning instead of reporting a transport
        failure."""
        directory, child = self.begin('oversize', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-ok')
        path = directory / 'checkpoint'
        header = self.CHECKPOINT_HEADER
        (magic, schema, reserved, incarnation, attempt, manifest, spool_device,
         spool_inode, offset, length, check, pid, first, second) = header.unpack_from(path.read_bytes(), 0)
        body = b'x' * ((1 << 20) + 1)
        path.write_bytes(header.pack(magic, schema, reserved, incarnation, attempt, manifest,
                                     spool_device, spool_inode, offset, len(body), check,
                                     pid, first, second) + body)
        marker, text = self.replays_from_the_beginning(directory, child)
        self.assertIn('unusable observation checkpoint', marker)
        self.assertIn('echo:one', text)
        print('evidence oversize-checkpoint', marker)

    def test_adoption_refuses_a_directory_without_custody(self):
        """The request-level ENOENT adoption path adopts real custody only: a
        directory that holds no attempt gets no child and no new custody."""
        directory = self.home / 'no-attempt'
        directory.mkdir()
        result = self.command('attach-owned', self.db, directory)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(list(directory.iterdir()), [],
                         'adoption wrote custody into a directory that holds no attempt')
        self.assertIn('instance_attach_owned', result.stderr + result.stdout)
        print('evidence adoption-refusal', (result.stderr + result.stdout).strip().replace('\n', '|'))

    def test_recovery_after_owner_death_restores_the_committed_state(self):
        """Owner death with a surviving native child: a replacement owner is
        elected, the guard-holding caller adopts the same child through its own
        custody, and the reducer state the previous observer committed is
        restored at its offset, so the adopted reader resumes after the frames
        that checkpoint covered and reports no duplicate child."""
        directory = pathlib.Path(f'{self.db}.attempt-death')
        child = self.spawn('partial', self.db, 'fixture', directory, self.home, 'one\n',
                           sys.executable, self.survivor)
        self.line(child, 'admitted')
        self.line(child, 'commit-ok')
        summary = self.native(''.join(child.output))
        owners = self.owner_processes()
        self.assertEqual(len(owners), 1, owners)
        os.kill(int(owners[0].split()[0]), signal.SIGKILL)
        child.kill()
        child.wait(timeout=10)
        adopter = self.spawn('attach-owned', self.db, directory)
        self.line(adopter, 'attached')
        restored = self.subscription_line(adopter, 'restored:')
        self.assertEqual(restored, {'reducer': 'seen two frames'}, restored)
        # The restored offset stops after the frames the checkpoint covered, so
        # the adopted reader reports the next tick and not the covered rows.
        self.line(adopter, 'tick:1')
        self.assertNotIn('"role": "native"', ''.join(adopter.output),
                         'the adopted reader replayed the frame the checkpoint covered')
        os.kill(summary['pid'], 0)
        spool = (directory / 'stdout').read_text(errors='replace')
        self.assertEqual(spool.count('"role": "native"'), 1, 'adoption duplicated the native child')
        print('evidence owner-death restore', restored, 'native', summary['pid'])

    # -- adoption authority ------------------------------------------------

    def prepared_survivor(self, label, session, artifact='ALPHA-01\n'):
        """Admits a prepared-file attempt under a session guard, with a native
        child that keeps running after stdin EOF."""
        directory = pathlib.Path(f'{self.db}.attempt-{label}')
        child = self.spawn('admit-file', self.db, session, directory, self.home, artifact,
                           sys.executable, self.survivor)
        self.line(child, 'admitted')
        summary = self.native(''.join(child.output))
        return directory, child, summary

    def kill_owner(self):
        owners = self.owner_processes()
        self.assertEqual(len(owners), 1, owners)
        os.kill(int(owners[0].split()[0]), signal.SIGKILL)

    def adoption_refusal(self, directory):
        result = self.command('attach-owned', self.db, directory)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        detail = (result.stdout + result.stderr).strip().replace('\n', '|')
        self.assertNotIn('attached', detail, detail)
        self.assertNotIn('busy', detail.lower(), detail)
        return detail

    def test_adoption_requires_durable_attempt_authority(self):
        """An attempt whose owner is gone is adopted from durable evidence: the
        admission record binding the directory, the database and the caller's
        session guard, the launch marker, the manifest and its prepared bytes, and
        the native birth. Files copied into another directory, a changed artifact,
        a malformed manifest, a missing launch marker and a different session
        guard are each refused, and the valid original stays adoptable."""
        directory, observer, summary = self.prepared_survivor('authority', 'fixture')
        original = {name: (directory / name).read_bytes()
                    for name in ('manifest', 'launch', 'prompt.txt')}
        self.kill_owner()
        observer.kill()
        observer.wait(timeout=10)
        spool_before = (directory / 'stdout').read_bytes()

        # A decoy holding only copies of this attempt's birth and spool, with no
        # admission record, manifest or launch marker.
        decoy = pathlib.Path(f'{self.db}.attempt-decoy')
        decoy.mkdir()
        for name in ('native.birth', 'stdout'):
            (decoy / name).write_bytes((directory / name).read_bytes())
        detail = self.adoption_refusal(decoy)
        self.assertIn('not permitted', detail, detail)
        self.assertEqual(sorted(p.name for p in decoy.iterdir()), ['native.birth', 'stdout'],
                         'the refused adoption wrote into the decoy')

        # A prepared artifact whose bytes were changed after the launch.
        (directory / 'prompt.txt').write_bytes(b'BRAVO-01\n')
        detail = self.adoption_refusal(directory)
        self.assertIn('Invalid argument', detail, detail)
        (directory / 'prompt.txt').write_bytes(original['prompt.txt'])

        # A manifest whose first byte was flipped after the launch.
        (directory / 'manifest').write_bytes(b'X' + original['manifest'][1:])
        detail = self.adoption_refusal(directory)
        self.assertNotIn('attached', detail, detail)
        (directory / 'manifest').write_bytes(original['manifest'])

        # A missing launch marker.
        (directory / 'launch').unlink()
        detail = self.adoption_refusal(directory)
        self.assertIn('not permitted', detail, detail)
        (directory / 'launch').write_bytes(original['launch'])

        # The same attempt admitted under a different session guard.
        other, other_observer, _ = self.prepared_survivor('authority-other', 'other')
        self.kill_owner()
        other_observer.kill()
        other_observer.wait(timeout=10)
        detail = self.adoption_refusal(other)
        self.assertIn('not permitted', detail, detail)

        # The valid original: same directory, same database, same session guard.
        adopter = self.spawn('attach-owned', self.db, directory)
        self.line(adopter, 'attached')
        adopted = [json.loads(line) for line in adopter.output
                   if line.startswith('{') and 'role' in json.loads(line)]
        self.assertEqual([row['pid'] for row in adopted], [summary['pid']],
                         'adoption did not bind the original native process')
        os.kill(summary['pid'], 0)
        spool = (directory / 'stdout').read_text(errors='replace')
        self.assertEqual(spool.count('"role": "native"'), 1, 'adoption duplicated the native child')
        self.assertTrue(spool.startswith(spool_before.decode(errors='replace').splitlines()[0]),
                        'the attempt spool was rewritten by a refusal')
        print('evidence adoption authority native', summary['pid'])

    def test_shutdown_releases_the_database_for_a_new_owner(self):
        directory, child = self.begin('a0')
        self.wait_run(child)
        self.assertEqual(len(self.owner_processes()), 1)
        result = self.command('shutdown', self.db)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('shutdown-ok', result.stdout)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and self.owner_processes():
            time.sleep(.05)
        self.assertEqual(self.owner_processes(), [])
        directory, second = self.begin('b0', payload='again\n')
        output = self.wait_run(second)
        self.assertIn('echo:again', output)
        self.assertEqual(len(self.owner_processes()), 1)
        print('evidence after-shutdown', self.owner_processes()[0].strip())
        print('evidence new-attempt', output.replace('\n', '|'))


if __name__ == '__main__':
    unittest.main()
