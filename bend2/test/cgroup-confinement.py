"""Per-native cgroup creation, gated attach and sibling isolation."""
import os
import pathlib
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/process-test'
PROCESS_C = ROOT / '.scratch/bend2/process-test.c'
FIXTURE = ROOT / '.scratch/bend2/cgroup-confinement'
SOURCE = ROOT / 'bend2/test/cgroup-confinement.c'


@unittest.skipUnless(sys.platform == 'linux', 'native cgroup confinement is Linux-specific')
class CgroupConfinement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        if not PROCESS_C.exists():
            result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                     'bend2/test/process.bend',
                                     '.scratch/bend2/process-test'],
                                    cwd=ROOT, capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)
        result = subprocess.run([
            os.environ.get('CC', 'clang'), '-O1', '-pthread',
            '-DBATON2_PROCESS_SOURCE=' + repr(str(PROCESS_C)).replace("'", '"'),
            str(SOURCE), '-lsqlite3', '-lm', '-o', str(FIXTURE),
        ], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        if not EXE.exists():
            result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                     'bend2/test/process.bend',
                                     '.scratch/bend2/process-test'],
                                    cwd=ROOT, capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)

    def test_disposable_hierarchy_bounds_native_and_leaves_sibling_keeper(self):
        with tempfile.TemporaryDirectory(prefix='cgroup-confinement-',
                                         dir=ROOT / '.scratch/bend2') as name:
            result = subprocess.run([str(FIXTURE), name],
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('cgroup-confinement PASS', result.stdout)
            self.assertIn('"attachBeforeExec":true', result.stdout)
            self.assertIn('"siblingUnchanged":true', result.stdout)
            self.assertIn('"memoryMax":17179869184', result.stdout)
            self.assertIn('"memorySwapMax":0', result.stdout)

    @staticmethod
    def wait_for(predicate, description, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = predicate()
            if value is not None:
                return value
            time.sleep(0.02)
        raise AssertionError(f'timed out waiting for {description}')

    @staticmethod
    def attempt_info(attempt):
        pid_path = attempt / 'native.pid'
        evidence_path = attempt / 'native.cgroup'
        if not pid_path.exists() or not evidence_path.exists():
            return None
        try:
            pid = int(pid_path.read_text())
        except ValueError:
            return None
        evidence = evidence_path.read_text()
        fields = dict(part.split('=', 1) for part in evidence.split() if '=' in part)
        return {'pid': pid, 'evidence': evidence, 'cgroup': fields.get('cgroup'),
                'memoryMax': fields.get('memory.max'),
                'memorySwapMax': fields.get('memory.swap.max')}

    @staticmethod
    def proc_cgroup(pid):
        try:
            return pathlib.Path(f'/proc/{pid}/cgroup').read_text().strip()
        except OSError:
            return None

    @staticmethod
    def identity(pid):
        try:
            value = pathlib.Path(f'/proc/{pid}/stat').read_text()
        except OSError:
            return None
        closing = value.rfind(')')
        opening = value.find('(')
        fields = value[closing + 2:].split()
        return (value[opening + 1:closing], fields[0], int(fields[1]), fields[19])

    @staticmethod
    def cmdline(pid):
        try:
            return pathlib.Path(f'/proc/{pid}/cmdline').read_bytes()
        except OSError:
            return None

    @staticmethod
    def keeper_pids(attempt):
        found = []
        marker = str(attempt).encode()
        for entry in pathlib.Path('/proc').iterdir():
            if not entry.name.isdigit():
                continue
            try:
                argv = (entry / 'cmdline').read_bytes().split(b'\0')
            except OSError:
                continue
            if b'--host-process-keeper' in argv and marker in argv:
                found.append(int(entry.name))
        return found

    @staticmethod
    def lines(attempt):
        try:
            text = (attempt / 'stdout').read_text()
        except OSError:
            return None
        values = {}
        for name in ('native-pid', 'descendant-pid'):
            marker = name + ' '
            for line in text.splitlines():
                if line.startswith(marker):
                    values[name] = int(line[len(marker):])
        return values if len(values) == 2 else None

    def test_two_keeper_attempts_leave_sibling_unchanged(self):
        with tempfile.TemporaryDirectory(prefix='cgroup-keeper-',
                                         dir=ROOT / '.scratch/bend2') as name:
            base = pathlib.Path(name)
            root = base / 'cgroup'
            receiver = root / 'receiver'
            receiver.mkdir(parents=True)
            (receiver / 'memory.max').write_text('17179869184\n')
            (receiver / 'memory.swap.max').write_text('0\n')
            (receiver / 'cgroup.subtree_control').write_text('memory\n')
            runtime_directory = tempfile.TemporaryDirectory(prefix='baton-cgroup-runtime-')
            runtime = pathlib.Path(runtime_directory.name)
            (runtime / 'baton2').mkdir(mode=0o700)
            cwd = base / 'cwd'
            cwd.mkdir()
            environment = dict(os.environ, BATON2_CGROUP_ROOT=str(root),
                               BATON2_CGROUP_PARENT='/receiver',
                               XDG_RUNTIME_DIR=str(runtime))

            def start_attempt(label, flag):
                database = base / (label + '.db')
                database.touch()
                payload = base / (label + '.payload')
                payload.write_text('fixture\n')
                attempt = base / (label + '-attempt')
                process = subprocess.Popen(
                    [str(EXE), 'retain', str(database), str(attempt), str(cwd),
                     str(payload), 'close', str(FIXTURE), flag],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, text=True, env=environment)
                return process, attempt, database

            processes = []
            try:
                sibling_process, sibling_attempt, sibling_db = start_attempt(
                    'sibling', '--sibling-keeper')
                processes.append((sibling_process, sibling_attempt, sibling_db))
                sibling = self.wait_for(lambda: self.attempt_info(sibling_attempt),
                                        'sibling keeper custody')
                sibling_owner = self.identity(sibling['pid'])[2]
                sibling_state = (self.proc_cgroup(sibling_owner),
                                 self.identity(sibling_owner),
                                 self.proc_cgroup(sibling['pid']),
                                 self.identity(sibling['pid']),
                                 self.cmdline(sibling['pid']))

                main_process, main_attempt, main_db = start_attempt(
                    'main', '--native-descendant')
                processes.append((main_process, main_attempt, main_db))
                main = self.wait_for(lambda: self.attempt_info(main_attempt),
                                     'main keeper custody')
                lines = self.wait_for(lambda: self.lines(main_attempt),
                                      'main native and descendant')
                self.assertEqual(lines['native-pid'], main['pid'])
                descendant = lines['descendant-pid']
                self.assertEqual(self.identity(descendant)[2], main['pid'])
                self.assertEqual(main['memoryMax'], '17179869184')
                self.assertEqual(main['memorySwapMax'], '0')
                self.assertEqual(sibling['memoryMax'], '17179869184')
                self.assertEqual(sibling['memorySwapMax'], '0')
                self.assertNotEqual(main['cgroup'], sibling['cgroup'])
                self.assertTrue(main['cgroup'].startswith('/receiver/'))
                self.assertTrue(sibling['cgroup'].startswith('/receiver/'))
                cgroup_dir = root / main['cgroup'].lstrip('/')
                self.assertIn(f"{main['pid']}\n",
                              (cgroup_dir / 'cgroup.procs').read_text())
                self.assertEqual((cgroup_dir / 'memory.max').read_text(),
                                 '17179869184\n')
                self.assertEqual((cgroup_dir / 'memory.swap.max').read_text(),
                                 '0\n')
                self.assertEqual((self.proc_cgroup(sibling_owner),
                                  self.identity(sibling_owner),
                                  self.proc_cgroup(sibling['pid']),
                                  self.identity(sibling['pid']),
                                  self.cmdline(sibling['pid'])), sibling_state)
                os.kill(sibling_owner, 0)
            finally:
                for process, attempt, database in processes:
                    info = self.attempt_info(attempt)
                    if info:
                        try:
                            os.killpg(info['pid'], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    if process.stdin:
                        try:
                            process.stdin.close()
                        except OSError:
                            pass
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                    subprocess.run([str(EXE), 'shutdown', str(database)],
                                   env=environment, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=10)
                runtime_directory.cleanup()

    def test_old_owner_falls_back_to_per_attempt_keeper(self):
        with tempfile.TemporaryDirectory(prefix='cgroup-old-owner-',
                                         dir=ROOT / '.scratch/bend2') as name:
            base = pathlib.Path(name)
            root = base / 'cgroup'
            receiver = root / 'receiver'
            receiver.mkdir(parents=True)
            (receiver / 'memory.max').write_text('17179869184\n')
            (receiver / 'memory.swap.max').write_text('0\n')
            (receiver / 'cgroup.subtree_control').write_text('memory\n')
            runtime = pathlib.Path(tempfile.mkdtemp(prefix='baton-cgroup-runtime-'))
            (runtime / 'baton2').mkdir(mode=0o700)
            cwd = base / 'cwd'
            cwd.mkdir()
            database = base / 'old.db'
            database.touch()
            info = database.stat()
            key = f'owner-{info.st_dev:x}-{info.st_ino:x}'
            record_path = runtime / 'baton2' / (key + '.record')
            socket_path = runtime / 'baton2' / 'old-owner.sock'
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(str(socket_path))
            listener.listen(1)
            listener.settimeout(15)
            encoded = str(socket_path).encode()
            self.assertLess(len(encoded), 104)
            record = struct.pack('<QQQQii104s', 1, 1, info.st_dev, info.st_ino,
                                 os.getpid(), 0, encoded)
            record_path.write_bytes(record)
            record_before = record_path.read_bytes()
            payload = base / 'old.payload'
            payload.write_text('fixture\n')
            attempt = base / 'old-attempt'
            environment = dict(os.environ, BATON2_CGROUP_ROOT=str(root),
                               BATON2_CGROUP_PARENT='/receiver',
                               XDG_RUNTIME_DIR=str(runtime))
            sibling = subprocess.Popen(['/bin/sleep', '30'])
            time.sleep(0.1)
            sibling_before = (self.proc_cgroup(sibling.pid),
                              self.identity(sibling.pid),
                              self.cmdline(sibling.pid))
            process = None
            try:
                process = subprocess.Popen(
                    [str(EXE), 'retain', str(database), str(attempt), str(cwd),
                     str(payload), 'close', str(FIXTURE), '--sibling-keeper'],
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, text=True, env=environment)
                connection, _ = listener.accept()
                received = connection.recv(4096)
                connection.close()
                self.assertEqual(received, b'')
                fallback = self.wait_for(lambda: self.attempt_info(attempt),
                                         'automatic per-attempt keeper custody', 30)
                self.assertTrue(fallback['cgroup'].startswith('/receiver/'))
                self.assertEqual(fallback['memoryMax'], '17179869184')
                self.assertEqual(fallback['memorySwapMax'], '0')
                child_dir = root / fallback['cgroup'].lstrip('/')
                self.assertIn(f"{fallback['pid']}\n",
                              (child_dir / 'cgroup.procs').read_text())
                self.assertEqual(record_path.read_bytes(), record_before)
                self.assertEqual((self.proc_cgroup(sibling.pid),
                                  self.identity(sibling.pid),
                                  self.cmdline(sibling.pid)), sibling_before)
                os.kill(sibling.pid, 0)
                self.assertEqual(len(list(receiver.glob('baton-native-*'))), 1)
            finally:
                if process is not None:
                    info = self.attempt_info(attempt)
                    if info:
                        try:
                            os.killpg(info['pid'], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    if process.stdin:
                        try:
                            process.stdin.close()
                        except OSError:
                            pass
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                for _ in range(100):
                    keepers = self.keeper_pids(attempt)
                    if not keepers:
                        break
                    for pid in keepers:
                        try:
                            os.kill(pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                    time.sleep(0.02)
                for pid in self.keeper_pids(attempt):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                time.sleep(0.05)
                listener.close()
                sibling.kill()
                sibling.wait(timeout=5)
                shutil.rmtree(runtime, ignore_errors=True)

    def test_unbounded_receiver_retry_is_typed_and_idempotent(self):
        with tempfile.TemporaryDirectory(prefix='cgroup-retry-',
                                         dir=ROOT / '.scratch/bend2') as name:
            base = pathlib.Path(name)
            root = base / 'cgroup'
            scope = root / 'session-6448.scope'
            scope.mkdir(parents=True)
            (scope / 'memory.max').write_text('max\n')
            (scope / 'memory.swap.max').write_text('max\n')
            runtime = pathlib.Path(tempfile.mkdtemp(prefix='baton-cgroup-runtime-'))
            (runtime / 'baton2').mkdir(mode=0o700)
            cwd = base / 'cwd'
            cwd.mkdir()
            database = base / 'retry.db'
            database.touch()
            payload = base / 'retry.payload'
            payload.write_text('fixture\n')
            attempt = base / 'retry-attempt'
            environment = dict(os.environ, BATON2_CGROUP_ROOT=str(root),
                               BATON2_CGROUP_PARENT='/session-6448.scope',
                               XDG_RUNTIME_DIR=str(runtime))
            command = [str(EXE), 'retain', str(database), str(attempt), str(cwd),
                       str(payload), 'close', str(FIXTURE), '--sibling-keeper']
            try:
                first = subprocess.run(command, capture_output=True, text=True,
                                       env=environment, timeout=30)
                self.assertNotEqual(first.returncode, 0)
                self.assertIn('cgroupUnbounded',
                              (attempt / 'native-start-error').read_text())
                self.assertFalse((attempt / 'launch').exists())
                self.assertFalse((attempt / 'native.pid').exists())
                second = subprocess.run(command, capture_output=True, text=True,
                                        env=environment, timeout=30)
                self.assertNotEqual(second.returncode, 0)
                output = second.stdout + second.stderr
                self.assertNotIn('File exists', output)
                self.assertNotIn('per-attempt keeper fallback', output)
                self.assertIn('cgroupUnbounded',
                              (attempt / 'native-start-error').read_text())
                self.assertFalse((attempt / 'launch').exists())
                self.assertFalse((attempt / 'native.pid').exists())
            finally:
                subprocess.run([str(EXE), 'shutdown', str(database)],
                               env=environment, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10)
                shutil.rmtree(runtime, ignore_errors=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
