"""Exercise native process effects against operating-system processes."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import os
import signal
import array
import fcntl
import socket
import struct
import threading
import shutil
import stat
import time

def write_fixture_bytes(path, data, mode):
    current_mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else mode
    if path.exists():
        path.chmod(current_mode | stat.S_IWUSR)
    try:
        path.write_bytes(data)
    finally:
        path.chmod(current_mode)
    if stat.S_IMODE(path.stat().st_mode) != mode:
        raise AssertionError(f"fixture mode changed for {path.name}")


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/process-test'

class Process(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.cwd = pathlib.Path(self.temp.name)
        self.log = self.cwd / 'stderr.log'
        self.runtime = pathlib.Path(tempfile.mkdtemp(prefix='br-'))
        self.environment = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime))

    def tearDown(self):
        database = self.cwd / 'state.db'
        if database.exists():
            shutdown = subprocess.run([str(EXE), 'shutdown', str(database)],
                                      text=True, capture_output=True,
                                      env=self.environment, timeout=10)
            self.assertEqual(shutdown.returncode, 0, shutdown.stderr)
            deadline = time.monotonic() + 2
            owners = []
            while time.monotonic() < deadline:
                process_list = subprocess.run(['ps', '-A', '-o', 'pid=', '-o', 'command='],
                                              text=True, capture_output=True, check=True)
                owners = [line.strip() for line in process_list.stdout.splitlines()
                          if '--instance-owner' in line and str(database.resolve()) in line]
                if not owners:
                    break
                time.sleep(0.02)
            self.assertFalse(owners, 'fixture owner remained after shutdown: ' + repr(owners))
        self.temp.cleanup()
        shutil.rmtree(self.runtime, ignore_errors=True)

    def run_child(self, *args, mode='run', cwd=None):
        return subprocess.run([str(EXE), mode, str(cwd or self.cwd), str(self.log), *args],
                              text=True, capture_output=True, env=self.environment)

    def wait_for_native_exit(self, attempt, observer, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if observer.poll() is not None:
                self.fail(f'retained observer exited {observer.returncode}: '
                          + observer.stderr.read())
            pid_path = attempt / 'native.pid'
            if pid_path.exists():
                pid = int(pid_path.read_text())
                state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)],
                                       text=True, capture_output=True).stdout.strip()
                if not state or state.startswith('Z'):
                    return
            time.sleep(0.02)
        self.fail(f'timed out waiting for native child exit in {attempt}')

    def test_argv_is_exact_including_empty_elements(self):
        args = ['a space', '', 'a\x1fseparator', 'line\nbreak', 'quote"', '🙂']
        p = self.run_child(sys.executable, '-c', 'import json,sys; print(json.dumps(sys.argv[1:]))', *args)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout.splitlines()[0]), args)
        self.assertTrue(p.stdout.endswith('exit 0\n'))

    def test_stderr_cannot_fill_an_unread_pipe(self):
        p = self.run_child(sys.executable, '-c', 'import sys; sys.stderr.write("error"*100000); print("complete")')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, 'complete\nexit 0\n')
        self.assertEqual(self.log.read_text(), 'error' * 100000)

    def test_invalid_cwd_does_not_run_in_the_callers_directory(self):
        marker = self.cwd / 'should-not-exist'
        p = self.run_child(sys.executable, '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).touch()',
                           str(marker), cwd=self.cwd / 'missing')
        self.assertNotEqual(p.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertIn('No such file', p.stderr)

    def test_spawn_and_write_errors_are_failures(self):
        p = self.run_child(str(self.cwd / 'missing-program'))
        self.assertNotEqual(p.returncode, 0)
        p = self.run_child('/usr/bin/true', mode='closed')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('Bad file descriptor', p.stderr)

    def test_wait_retains_signal_and_exit_distinction(self):
        p = self.run_child(sys.executable, '-c', 'raise SystemExit(143)')
        self.assertEqual(p.stdout, 'exit 143\n')
        p = self.run_child(sys.executable, '-c', 'import os,signal;os.kill(os.getpid(),signal.SIGTERM)')
        self.assertEqual(p.stdout, 'signal 15\n')

    def test_large_and_empty_stdout_lines_survive(self):
        p = self.run_child(sys.executable, '-c', 'print(); print("x"*300000)')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, '\n' + 'x'*300000 + '\nexit 0\n')

    def test_observer_recovery_restores_missing_status_and_checks_birth(self):
        runtime = self.runtime
        (runtime / 'baton2').mkdir(parents=True, mode=0o700)
        database = self.cwd / 'state.db'
        database.touch()
        attempt = self.cwd / 'retained-attempt'
        payload = self.cwd / 'payload.txt'
        payload.write_text('fixture input\n')
        observer = subprocess.Popen(
            [str(EXE), 'retain', str(database), str(attempt), str(self.cwd),
             str(payload), 'close', sys.executable, '-c',
             'import sys; sys.stdin.read(); print("fixture-done")'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=self.environment)
        try:
            self.wait_for_native_exit(attempt, observer)
            if (attempt / 'status').exists():
                (attempt / 'status').unlink()
            recovery = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt), str(observer.pid)],
                text=True, capture_output=True, env=self.environment, timeout=20)
            self.assertEqual(recovery.returncode, 0, recovery.stderr)
            self.assertIn('observer-recovered:exit 0', recovery.stdout)
            self.assertEqual((attempt / 'status').read_text(), '0\n')
            self.assertEqual(observer.wait(timeout=10), -signal.SIGTERM)
        finally:
            if observer.poll() is None:
                observer.terminate()
                observer.wait(timeout=10)
            if observer.stdin:
                observer.stdin.close()
            if observer.stdout:
                observer.stdout.close()
            if observer.stderr:
                observer.stderr.close()

    def test_observer_recovery_does_not_retire_unrelated_live_pid(self):
        (self.runtime / 'baton2').mkdir(parents=True, mode=0o700)
        database = self.cwd / 'state.db'
        database.touch()
        attempt = self.cwd / 'retained-attempt'
        payload = self.cwd / 'payload.txt'
        payload.write_text('fixture input\n')
        observer = subprocess.Popen(
            [str(EXE), 'retain', str(database), str(attempt), str(self.cwd),
             str(payload), 'close', sys.executable, '-c',
             'import sys; sys.stdin.read(); print("fixture-done")'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=self.environment)
        unrelated = subprocess.Popen(
            [sys.executable, '-c', 'import time; time.sleep(180)'],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, env=self.environment)
        try:
            self.wait_for_native_exit(attempt, observer)
            names = ('manifest', 'native.birth', 'native.pid', 'status', 'capabilities',
                     'stdout', 'checkpoint', 'custody', 'acknowledged', 'released')
            before = {name: (attempt / name).read_bytes() for name in names
                      if (attempt / name).exists()}
            refused = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt),
                 str(unrelated.pid)], text=True, capture_output=True,
                env=self.environment, timeout=20)
            self.assertNotEqual(refused.returncode, 0, refused.stdout)
            self.assertIsNone(unrelated.poll(), 'recovery signaled an unrelated live PID')
            self.assertIsNone(observer.poll(), 'refusal stopped the actual observer')
            after = {name: (attempt / name).read_bytes() for name in names
                     if (attempt / name).exists()}
            self.assertEqual(after, before, 'refusal changed retained attempt custody')

            ended = subprocess.Popen(
                [sys.executable, '-c', 'pass'], stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env=self.environment)
            ended_pid = ended.pid
            self.assertEqual(ended.wait(timeout=10), 0)
            refused_ended = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt),
                 str(ended_pid)], text=True, capture_output=True,
                env=self.environment, timeout=20)
            self.assertNotEqual(refused_ended.returncode, 0, refused_ended.stdout)
            after_ended = {name: (attempt / name).read_bytes() for name in names
                           if (attempt / name).exists()}
            self.assertEqual(after_ended, before,
                             'an already-ended observer PID changed retained custody')

            status_path = attempt / 'status'
            status_bytes = status_path.read_bytes()
            status_mode = stat.S_IMODE(status_path.stat().st_mode)
            capability_path = attempt / 'capabilities'
            capability_bytes = (capability_path.read_bytes()
                                if capability_path.exists() else None)
            capability_mode = (stat.S_IMODE(capability_path.stat().st_mode)
                               if capability_bytes is not None else None)
            if capability_bytes is not None:
                write_fixture_bytes(capability_path, b'reconcile\n', capability_mode)
                old_capability_before = {name: (attempt / name).read_bytes()
                                         for name in names if (attempt / name).exists()}
                old_capability_refused = subprocess.run(
                    [str(EXE), 'recover-observer', str(database), str(attempt),
                     str(observer.pid)], text=True, capture_output=True,
                    env=self.environment, timeout=20)
                self.assertNotEqual(old_capability_refused.returncode, 0,
                                    old_capability_refused.stdout)
                self.assertIsNone(observer.poll(),
                                  'an old keeper capability allowed an unattested transfer')
                old_capability_after = {name: (attempt / name).read_bytes()
                                        for name in names if (attempt / name).exists()}
                self.assertEqual(old_capability_after, old_capability_before,
                                 'old keeper refusal changed retained attempt custody')
                write_fixture_bytes(capability_path, capability_bytes, capability_mode)
            status_path.unlink()
            if capability_bytes is not None:
                capability_path.unlink()
            legacy_before = {name: (attempt / name).read_bytes() for name in names
                             if (attempt / name).exists()}
            legacy_refused = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt),
                 str(unrelated.pid)], text=True, capture_output=True,
                env=self.environment, timeout=20)
            self.assertNotEqual(legacy_refused.returncode, 0, legacy_refused.stdout)
            self.assertIsNone(unrelated.poll(), 'legacy recovery signaled an unrelated live PID')
            self.assertIsNone(observer.poll(), 'legacy refusal stopped the actual observer')
            legacy_after = {name: (attempt / name).read_bytes() for name in names
                            if (attempt / name).exists()}
            self.assertEqual(legacy_after, legacy_before,
                             'legacy refusal changed retained attempt custody')
            write_fixture_bytes(status_path, status_bytes, status_mode)
            if capability_bytes is not None:
                write_fixture_bytes(capability_path, capability_bytes, capability_mode)

            os.kill(observer.pid, signal.SIGSTOP)
            recovered = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt),
                 str(observer.pid)], text=True, capture_output=True,
                env=self.environment, timeout=20)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertIn('observer-recovered:exit 0', recovered.stdout)
            self.assertEqual(observer.wait(timeout=10), -signal.SIGTERM)
        finally:
            if observer.poll() is None:
                try:
                    os.kill(observer.pid, signal.SIGCONT)
                except ProcessLookupError:
                    pass
                observer.terminate()
                observer.wait(timeout=10)
            if unrelated.poll() is None:
                unrelated.terminate()
                unrelated.wait(timeout=10)
            if observer.stdin:
                observer.stdin.close()
            if observer.stdout:
                observer.stdout.close()
            if observer.stderr:
                observer.stderr.close()

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux pidfd zombie lifetime')
    def test_legacy_unknown_observer_zombie_transfer_reopens_spool_without_ack(self):
        (self.runtime / 'baton2').mkdir(parents=True, mode=0o700)
        database = self.cwd / 'state.db'
        database.touch()
        attempt = self.cwd / 'legacy-attempt'
        attempt.mkdir(mode=0o700)
        (attempt / 'stdout').write_bytes(b'legacy-output\n')
        control_dir = pathlib.Path(tempfile.mkdtemp(prefix='br-legacy-'))
        control = control_dir / 'keeper.sock'
        guard_path = attempt / 'guard'
        guard_fd = os.open(guard_path, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(guard_fd, fcntl.LOCK_EX)
        observer = None
        observer_image = self.cwd / 'legacy-observer-bin'
        shutil.copy2(EXE, observer_image)
        observer_image.chmod(0o700)
        native = subprocess.Popen([sys.executable, '-c', 'pass'],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, env=self.environment)
        proc_stat = pathlib.Path('/proc', str(native.pid), 'stat').read_text()
        ticks = int(proc_stat.rsplit(')', 1)[1].split()[19])
        boot = next(int(line.split()[1]) for line in pathlib.Path('/proc/stat').read_text().splitlines()
                    if line.startswith('btime '))
        native.wait(timeout=10)
        (attempt / 'native.pid').write_text(f'{native.pid}\n')
        (attempt / 'native.birth').write_bytes(
            struct.pack('=i4xQQ', native.pid, ticks, boot))

        fields = [
            b'/bin/true\0',
            os.fsencode(self.cwd),
            os.fsencode(attempt / 'native.stderr'),
            b'',
            os.fsencode(observer_image) + b'\0',
            os.fsencode(control),
        ]
        header = struct.pack('=8s6Q2I', b'BATONRP1',
                             *(len(value) for value in fields), 0, 0)
        manifest_bytes = header + b''.join(fields)
        (attempt / 'manifest').write_bytes(manifest_bytes)
        canonical = os.fsencode(attempt.resolve())
        info = attempt.stat()
        db_info = database.stat()
        prefix = struct.pack('=8sII7Q', b'BATONAD1', 1, 0,
                             db_info.st_dev, db_info.st_ino, 0, 0,
                             info.st_dev, info.st_ino, len(canonical))
        digest = 0xcbf29ce484222325
        for byte in prefix + canonical:
            digest = ((digest ^ byte) * 0x100000001b3) & 0xffffffffffffffff
        (attempt / 'admission').write_bytes(prefix + struct.pack('=Q', digest) + canonical)

        frame = struct.Struct('=IiQQq')
        server_errors = []
        server_events = []
        initial_ready = threading.Event()
        native_exited = True
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(control))
        listener.listen(2)
        listener.settimeout(8)

        def exact(connection, count):
            parts = []
            remaining = count
            while remaining:
                part = connection.recv(remaining)
                if not part:
                    raise EOFError('legacy recovery socket closed early')
                parts.append(part)
                remaining -= len(part)
            return b''.join(parts)

        def serve_legacy_keeper():
            old_connection = None
            try:
                old_connection, _ = listener.accept()
                first = exact(old_connection, frame.size)
                op, error, serial, length, value = frame.unpack(first)
                payload = exact(old_connection, length)
                peer_pid = struct.unpack('3i', old_connection.getsockopt(
                    socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))[0]
                assert (op, error, serial, value) == (11, 0, 0, 0)
                assert payload == os.fsencode(attempt.resolve()) + b'\0'
                server_events.append(('initial-peer', peer_pid))
                state = struct.pack('=5i', native.pid, int(native_exited), 0, 0,
                                    int(native_exited))
                hello = frame.pack(1, 0, 0, len(state), 2)
                old_connection.sendmsg([hello], [
                    (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [guard_fd]))])
                old_connection.sendall(state)
                ready = frame.unpack(exact(old_connection, frame.size))
                assert ready == (14, 0, 1, 0, 0), ready
                old_connection.sendall(frame.pack(4, 0, 1, 0, 0))
                initial_ready.set()

                while True:
                    replacement, _ = listener.accept()
                    first = replacement.recv(1)
                    if not first:
                        replacement.close()  # recovery liveness probe
                        continue
                    break
                with replacement:
                    op, error, serial, length, value = frame.unpack(
                        first + exact(replacement, frame.size - 1))
                    payload = exact(replacement, length)
                    assert (op, error, serial, value) == (11, 0, 0, peer_pid)
                    assert payload == os.fsencode(attempt.resolve()) + b'\0'
                    state = struct.pack('=5i', native.pid, int(native_exited), 0, 0,
                                        int(native_exited))
                    hello = frame.pack(1, 0, 0, len(state), 2)
                    replacement.sendmsg([hello], [
                        (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [guard_fd]))])
                    replacement.sendall(state)
                    if not native_exited:
                        try:
                            exact(replacement, frame.size)
                        except EOFError:
                            server_events.append('refused-before-ready')
                            old_connection.settimeout(10)
                            try:
                                while old_connection.recv(64):
                                    pass
                            except ConnectionResetError:
                                pass
                            return
                        raise AssertionError('recovery accepted a keeper reporting a live native')
                    old_connection.close()
                    old_connection = None
                    ready = frame.unpack(exact(replacement, frame.size))
                    assert ready == (14, 0, 0, 0, 0), ready
                    server_events.append('legacy-transfer-ready')
                    replacement.sendall(frame.pack(2, 0, 0, 0, 0))
                    replacement.settimeout(5)
                    try:
                        while replacement.recv(64):
                            pass
                    except ConnectionResetError:
                        pass
            except BaseException as error:
                server_errors.append(error)
            finally:
                if old_connection is not None:
                    old_connection.close()
                listener.close()

        server = threading.Thread(target=serve_legacy_keeper, daemon=True)
        server.start()
        observer = subprocess.Popen([str(observer_image), 'observer-hold', str(attempt)],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, env=self.environment)
        try:
            if not initial_ready.wait(timeout=5):
                if observer.poll() is not None:
                    observer_out, observer_err = observer.communicate(timeout=2)
                else:
                    observer_out, observer_err = '<still-running>', '<no stderr>'
                server.join(timeout=1)
                self.fail(f'legacy observer did not attach: rc={observer.returncode}; '
                          f'out={observer_out!r}; err={observer_err!r}; '
                          f'server={server_errors!r}')
            wrong_fields = fields.copy()
            wrong_fields[4] = b'/bin/true' + bytes((0,))
            (attempt / 'manifest').write_bytes(
                struct.pack('=8s6Q2I', b'BATONRP1',
                            *(len(value) for value in wrong_fields), 0, 0) +
                b''.join(wrong_fields))
            mismatch = subprocess.run(
                [str(EXE), 'recover-probe', str(database), str(attempt), str(observer.pid)],
                text=True, capture_output=True, env=self.environment, timeout=20)
            self.assertNotEqual(mismatch.returncode, 0, mismatch.stdout)
            self.assertIn('116:', mismatch.stderr)
            self.assertIsNone(observer.poll(), 'wrong executable binding retired the observer')
            self.assertEqual(server_events, [('initial-peer', observer.pid)])
            (attempt / 'manifest').write_bytes(manifest_bytes)
            os.kill(observer.pid, signal.SIGKILL)
            deadline = time.monotonic() + 5
            state = ''
            while time.monotonic() < deadline:
                stat_path = pathlib.Path('/proc', str(observer.pid), 'stat')
                if not stat_path.exists():
                    break
                state = stat_path.read_text().rsplit(')', 1)[1].split()[0]
                if state == 'Z':
                    break
                time.sleep(0.01)
            self.assertEqual(state, 'Z', 'observer did not remain an unreaped zombie')
            recovery = subprocess.run(
                [str(EXE), 'recover-probe', str(database), str(attempt), str(observer.pid)],
                text=True, capture_output=True, env=self.environment, timeout=20)
            self.assertEqual(recovery.returncode, 0, recovery.stderr)
            self.assertIn('probe:legacy-output', recovery.stdout)
            self.assertIn('probe-custody-open', recovery.stdout)
            self.assertEqual(observer.wait(timeout=10), -signal.SIGKILL)
            server.join(timeout=6)
            self.assertFalse(server.is_alive(), 'legacy keeper fixture did not close')
            self.assertEqual(server_errors, [])
            self.assertEqual(server_events, [('initial-peer', observer.pid), 'legacy-transfer-ready'])
            self.assertTrue((attempt / 'custody').is_file())
            self.assertFalse((attempt / 'status').exists())
            self.assertFalse((attempt / 'released').exists())
            self.assertFalse((attempt / 'acknowledged').exists())
        finally:
            if observer.poll() is None:
                observer.terminate()
                observer.wait(timeout=10)
            if observer.stdin:
                observer.stdin.close()
            if observer.stdout:
                observer.stdout.close()
            if observer.stderr:
                observer.stderr.close()
            os.close(guard_fd)
            shutil.rmtree(control_dir, ignore_errors=True)

    def test_legacy_unknown_observer_refuses_live_native_without_retiring_observer(self):
        (self.runtime / 'baton2').mkdir(parents=True, mode=0o700)
        database = self.cwd / 'state.db'
        database.touch()
        attempt = self.cwd / 'legacy-attempt'
        attempt.mkdir(mode=0o700)
        (attempt / 'stdout').write_bytes(b'legacy-output\n')
        control_dir = pathlib.Path(tempfile.mkdtemp(prefix='br-legacy-'))
        control = control_dir / 'keeper.sock'
        guard_path = attempt / 'guard'
        guard_fd = os.open(guard_path, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(guard_fd, fcntl.LOCK_EX)
        observer = None
        observer_image = self.cwd / 'legacy-observer-bin'
        shutil.copy2(EXE, observer_image)
        observer_image.chmod(0o700)
        native = subprocess.Popen(['/bin/sleep', '30'], stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  env=self.environment)
        proc_stat = pathlib.Path('/proc', str(native.pid), 'stat').read_text()
        ticks = int(proc_stat.rsplit(')', 1)[1].split()[19])
        boot = next(int(line.split()[1]) for line in pathlib.Path('/proc/stat').read_text().splitlines()
                    if line.startswith('btime '))
        (attempt / 'native.pid').write_text(f'{native.pid}\n')
        (attempt / 'native.birth').write_bytes(
            struct.pack('=i4xQQ', native.pid, ticks, boot))

        fields = [
            b'/bin/true\0',
            os.fsencode(self.cwd),
            os.fsencode(attempt / 'native.stderr'),
            b'',
            os.fsencode(observer_image) + b'\0',
            os.fsencode(control),
        ]
        header = struct.pack('=8s6Q2I', b'BATONRP1',
                             *(len(value) for value in fields), 0, 0)
        manifest_bytes = header + b''.join(fields)
        (attempt / 'manifest').write_bytes(manifest_bytes)
        canonical = os.fsencode(attempt.resolve())
        info = attempt.stat()
        db_info = database.stat()
        prefix = struct.pack('=8sII7Q', b'BATONAD1', 1, 0,
                             db_info.st_dev, db_info.st_ino, 0, 0,
                             info.st_dev, info.st_ino, len(canonical))
        digest = 0xcbf29ce484222325
        for byte in prefix + canonical:
            digest = ((digest ^ byte) * 0x100000001b3) & 0xffffffffffffffff
        (attempt / 'admission').write_bytes(prefix + struct.pack('=Q', digest) + canonical)

        frame = struct.Struct('=IiQQq')
        server_errors = []
        server_events = []
        initial_ready = threading.Event()
        native_exited = False
        server_events = []
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(control))
        listener.listen(2)
        listener.settimeout(8)

        def exact(connection, count):
            parts = []
            remaining = count
            while remaining:
                part = connection.recv(remaining)
                if not part:
                    raise EOFError('legacy recovery socket closed early')
                parts.append(part)
                remaining -= len(part)
            return b''.join(parts)

        def serve_legacy_keeper():
            old_connection = None
            try:
                old_connection, _ = listener.accept()
                first = exact(old_connection, frame.size)
                op, error, serial, length, value = frame.unpack(first)
                payload = exact(old_connection, length)
                peer_pid = struct.unpack('3i', old_connection.getsockopt(
                    socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))[0]
                assert (op, error, serial, value) == (11, 0, 0, 0)
                assert payload == os.fsencode(attempt.resolve()) + b'\0'
                server_events.append(('initial-peer', peer_pid))
                state = struct.pack('=5i', native.pid, int(native_exited), 0, 0,
                                    int(native_exited))
                hello = frame.pack(1, 0, 0, len(state), 2)
                old_connection.sendmsg([hello], [
                    (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [guard_fd]))])
                old_connection.sendall(state)
                ready = frame.unpack(exact(old_connection, frame.size))
                assert ready == (14, 0, 1, 0, 0), ready
                old_connection.sendall(frame.pack(4, 0, 1, 0, 0))
                initial_ready.set()

                while True:
                    replacement, _ = listener.accept()
                    first = replacement.recv(1)
                    if not first:
                        replacement.close()  # recovery liveness probe
                        continue
                    break
                with replacement:
                    op, error, serial, length, value = frame.unpack(
                        first + exact(replacement, frame.size - 1))
                    payload = exact(replacement, length)
                    assert (op, error, serial, value) == (11, 0, 0, peer_pid)
                    assert payload == os.fsencode(attempt.resolve()) + b'\0'
                    state = struct.pack('=5i', native.pid, int(native_exited), 0, 0,
                                        int(native_exited))
                    hello = frame.pack(1, 0, 0, len(state), 2)
                    replacement.sendmsg([hello], [
                        (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [guard_fd]))])
                    replacement.sendall(state)
                    if not native_exited:
                        try:
                            exact(replacement, frame.size)
                        except EOFError:
                            server_events.append('refused-before-ready')
                            old_connection.settimeout(10)
                            try:
                                while old_connection.recv(64):
                                    pass
                            except ConnectionResetError:
                                pass
                            return
                        raise AssertionError('recovery accepted a keeper reporting a live native')
                    old_connection.close()
                    old_connection = None
                    ready = frame.unpack(exact(replacement, frame.size))
                    assert ready == (14, 0, 0, 0, 0), ready
                    server_events.append('legacy-transfer-ready')
                    replacement.sendall(frame.pack(2, 0, 0, 0, 0))
                    replacement.settimeout(5)
                    try:
                        while replacement.recv(64):
                            pass
                    except ConnectionResetError:
                        pass
            except BaseException as error:
                server_errors.append(error)
            finally:
                if old_connection is not None:
                    old_connection.close()
                listener.close()

        server = threading.Thread(target=serve_legacy_keeper, daemon=True)
        server.start()
        observer = subprocess.Popen([str(observer_image), 'observer-hold', str(attempt)],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, env=self.environment)
        try:
            if not initial_ready.wait(timeout=5):
                if observer.poll() is not None:
                    observer_out, observer_err = observer.communicate(timeout=2)
                else:
                    observer_out, observer_err = '<still-running>', '<no stderr>'
                server.join(timeout=1)
                self.fail(f'legacy observer did not attach: rc={observer.returncode}; '
                          f'out={observer_out!r}; err={observer_err!r}; '
                          f'server={server_errors!r}')
            recovery = subprocess.run(
                [str(EXE), 'recover-probe', str(database), str(attempt), str(observer.pid)],
                text=True, capture_output=True, env=self.environment, timeout=20)
            self.assertNotEqual(recovery.returncode, 0, recovery.stdout)
            self.assertIn('16:', recovery.stderr)
            self.assertIsNone(observer.poll(), 'live-native refusal retired the old observer')
            self.assertIsNone(native.poll(), 'live-native refusal changed native process state')
            observer.terminate()
            self.assertEqual(observer.wait(timeout=10), -signal.SIGTERM)
            server.join(timeout=6)
            self.assertFalse(server.is_alive(), 'legacy keeper fixture did not close')
            self.assertEqual(server_errors, [])
            self.assertEqual(server_events, [('initial-peer', observer.pid), 'refused-before-ready'])
            self.assertFalse((attempt / 'custody').exists())
            self.assertFalse((attempt / 'status').exists())
            self.assertFalse((attempt / 'released').exists())
            self.assertFalse((attempt / 'acknowledged').exists())
        finally:
            if observer.poll() is None:
                observer.terminate()
                observer.wait(timeout=10)
            if observer.stdin:
                observer.stdin.close()
            if observer.stdout:
                observer.stdout.close()
            if observer.stderr:
                observer.stderr.close()
            if native.poll() is None:
                native.terminate()
                native.wait(timeout=10)
            os.close(guard_fd)
            shutil.rmtree(control_dir, ignore_errors=True)

    def test_observer_recovery_rejects_reused_pid_start_identity(self):
        runtime = self.runtime
        (runtime / 'baton2').mkdir(parents=True, mode=0o700)
        database = self.cwd / 'state.db'
        database.touch()
        attempt = self.cwd / 'retained-attempt'
        payload = self.cwd / 'payload.txt'
        payload.write_text('fixture input\n')
        observer = subprocess.Popen(
            [str(EXE), 'retain', str(database), str(attempt), str(self.cwd),
             str(payload), 'close', sys.executable, '-c',
             'import sys; sys.stdin.read(); print("fixture-done")'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=self.environment)
        try:
            self.wait_for_native_exit(attempt, observer)
            birth = (attempt / 'native.birth').read_bytes()
            status_path = attempt / 'status'
            status = status_path.read_bytes() if status_path.exists() else b'0\n'
            if status_path.exists():
                status_path.unlink()
            birth_path = attempt / 'native.birth'
            birth_path.unlink()
            forged = bytearray(birth)
            first = int.from_bytes(forged[8:16], byteorder=sys.byteorder)
            forged[8:16] = (first ^ 1).to_bytes(8, byteorder=sys.byteorder)
            birth_path.write_bytes(forged)
            refused = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt), str(observer.pid)],
                text=True, capture_output=True, env=self.environment, timeout=20)
            self.assertNotEqual(refused.returncode, 0, refused.stdout)
            self.assertIsNone(observer.poll(),
                              f'a mismatched start identity retired the observer with '
                              f'exit code {observer.returncode}')
            self.assertFalse((attempt / 'status').exists(),
                             'the keeper wrote status for a mismatched process identity')
            birth_path.unlink()
            birth_path.write_bytes(birth)
            (attempt / 'status').write_bytes(status)
            recovered = subprocess.run(
                [str(EXE), 'recover-observer', str(database), str(attempt), str(observer.pid)],
                text=True, capture_output=True, env=self.environment, timeout=20)
            self.assertEqual(recovered.returncode, 0, recovered.stderr)
            self.assertIn('observer-recovered:exit 0', recovered.stdout)
            self.assertEqual(observer.wait(timeout=10), -signal.SIGTERM)
        finally:
            if observer.poll() is None:
                observer.terminate()
                observer.wait(timeout=10)
            if observer.stdin:
                observer.stdin.close()
            if observer.stdout:
                observer.stdout.close()
            if observer.stderr:
                observer.stderr.close()

    def test_retained_line_span_reads_eight_mib_without_bend_string(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = 'import sys; sys.stdout.write("x"*8388608+"\\n")'
        p = subprocess.run([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                            str(payload), 'span', sys.executable, '-c', script],
                           text=True, capture_output=True, timeout=90)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('0\t8388608\n', p.stdout)
        self.assertIn('native-exit 0\nretained-complete\n', p.stdout)

    def test_retained_line_spans_preserve_empty_and_unterminated_lines(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = 'import sys; sys.stdout.write("a\\n\\nlast")'
        p = subprocess.run([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                            str(payload), 'span', sys.executable, '-c', script],
                           text=True, capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('0\t1\n2\t0\n3\t4\n', p.stdout)
        self.assertIn('native-exit 0\nretained-complete\n', p.stdout)

    def test_retained_line_span_waits_for_split_line_and_preserves_nul_bytes(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = ('import sys,time; sys.stdout.buffer.write(b"left\\x00mid"); '
                  'sys.stdout.flush(); time.sleep(0.05); '
                  'sys.stdout.buffer.write(b"right\\n"); sys.stdout.flush()')
        p = subprocess.Popen([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                              str(payload), 'span', sys.executable, '-c', script],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        observed = []
        while not any(line.startswith('native-exit ') for line in observed):
            line = p.stdout.readline()
            self.assertNotEqual(line, '', 'native span reader exited before the checkpoint gate')
            observed.append(line)
        self.assertEqual((attempt / 'stdout').read_bytes(), b'left\x00midright\n')
        p.stdin.write('\n')
        p.stdin.flush()
        p.stdin.close()
        p.stdin = None
        remaining, error = p.communicate(timeout=30)
        output = ''.join(observed) + remaining
        self.assertEqual(p.returncode, 0, error)
        self.assertIn('0\t13\n', output)
        self.assertIn('native-exit 0\nretained-complete\n', output)

    def test_retained_span_recovery_replays_after_last_durable_checkpoint(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = 'import sys; sys.stdout.write("durable\\nnext\\n")'
        p = subprocess.run([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                            str(payload), 'checkpoint-span', sys.executable, '-c', script],
                           text=True, capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('durable:0\t7\n', p.stdout)
        self.assertIn('uncommitted:8\t4\n', p.stdout)
        self.assertIn('restored:durable\n', p.stdout)
        self.assertIn('replay:8\t4\n', p.stdout)
        self.assertIn('native-exit 0\nretained-complete\n', p.stdout)

if __name__ == '__main__':
    unittest.main()
