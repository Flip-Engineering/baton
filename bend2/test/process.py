"""Exercise native process effects against operating-system processes."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import os
import signal
import shutil
import time

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
            [sys.executable, '-c', 'import time; time.sleep(60)'],
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

            status_bytes = (attempt / 'status').read_bytes()
            capability_bytes = ((attempt / 'capabilities').read_bytes()
                                if (attempt / 'capabilities').exists() else None)
            (attempt / 'status').unlink()
            if capability_bytes is not None:
                (attempt / 'capabilities').unlink()
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
            (attempt / 'status').write_bytes(status_bytes)
            if capability_bytes is not None:
                (attempt / 'capabilities').write_bytes(capability_bytes)

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

if __name__ == '__main__':
    unittest.main()
