"""One shared custody owner serves concurrent attempts on one database.

The owner holds every attempt's stdin writer, wait authority and stdout spool.
These tests exercise concurrent attempts, an owner that starts once per
database, observer loss with the owner alive, database-binding refusals, the
retired-capability refusal and owner shutdown.
"""
import fcntl
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


class SharedInstance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="b2 shared instance's ")
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name).resolve()
        self.db = self.home / 'instance.db'
        self.db.touch()
        self.fixture = self.home / 'native.py'
        self.fixture.write_text(FIXTURE)
        self.children = []
        self.addCleanup(self.cleanup)

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

    # -- harness ----------------------------------------------------------

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

    def wait_run(self, child):
        child.stdin.close()
        child.wait(timeout=60)
        if child.returncode != 0:
            self.fail(child.stderr.read() + '\n' + self.owner_state())
        return ''.join(child.output)

    def owner_state(self):
        lines = ['owner processes: ' + ' | '.join(self.owner_processes())]
        directory, key, lock, record, socket_path = self.election_paths()
        lines.append(f'election {key} lock={lock.exists()} record={record.exists()} '
                     f'socket={socket_path.exists()} held={self.election_held()}')
        log = directory / f'{key}.log'
        if log.exists():
            lines.append('owner log: ' + log.read_text(errors='replace')[-800:])
        return '\n'.join(lines)

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
        print('evidence outputs', [output.replace('\n', '|') for output in outputs])

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

    def write_checkpoint(self, directory, incarnation, offset, blob, birth=None, attempt=0):
        """Writes the on-disk checkpoint record the host documents, so a test can
        present a record the host did not write itself."""
        header = struct.Struct('=8sQQQQQi4xQQ')
        if birth is None:
            pid, first, second = struct.unpack('=iQQ', (directory / 'native.birth').read_bytes())
        else:
            pid, first, second = birth
        body = header.pack(b'BATONC02', incarnation, attempt, offset, len(blob), 0, pid, first, second)
        digest = 0xcbf29ce484222325
        for byte in body[:40]:
            digest ^= byte
            digest = (digest * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
        head = body[:40]
        tail = body[48:]
        record = head + struct.pack('=Q', digest) + tail + blob.encode()
        (directory / 'checkpoint').write_bytes(record)

    def test_recovery_resumes_at_the_committed_checkpoint(self):
        directory, child = self.begin('partial', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-state-ok')
        checkpoint = directory / 'checkpoint'
        self.hold(checkpoint, '')
        record = checkpoint.read_bytes()
        self.assertEqual(record[:8], b'BATONC02')
        self.assertIn(b'seen two frames', record)
        self.write(directory, 'two\n')
        spool = directory / 'stdout'
        self.hold(spool, 'echo:two')
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

    def test_checkpoint_bound_to_another_incarnation_is_not_resumed(self):
        directory, child = self.begin('foreign', mode='partial', payload='one\n')
        self.line(child, 'admitted')
        self.line(child, 'echo:one')
        self.line(child, 'commit-state-ok')
        child.kill()
        child.wait(timeout=10)
        _, _, _, record, _ = self.election_paths()
        token = struct.unpack_from('=Q', record.read_bytes(), 0)[0]
        self.write_checkpoint(directory, token ^ 0xFFFFFFFFFFFFFFFF,
                              (directory / 'stdout').stat().st_size)
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('"role": "native"', text,
                      'a checkpoint bound to another incarnation must not be resumed')
        marker = self.hold(directory / 'checkpoint-error', 'unreadable or unbound observation checkpoint')
        print('evidence foreign-incarnation', marker.strip())

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
        self.line(child, 'commit-state-ok')
        (directory / 'checkpoint').write_bytes(b'\x00torn-checkpoint')
        child.kill()
        child.wait(timeout=10)
        marker = self.hold(directory / 'checkpoint-error',
                           'unreadable or unbound observation checkpoint')
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('"role": "native"', text,
                      'a damaged checkpoint must replay the stream rather than lose it')
        print('evidence torn-checkpoint', marker.strip())
        print('evidence torn-recovery-log', text.replace('\n', '|'))

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
        print('evidence repeated-admission spool', spool.read_text(errors='replace').replace('\n', '|'))
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
        print('evidence conflicting-reuse refused')
        child.kill()
        child.wait(timeout=10)

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
