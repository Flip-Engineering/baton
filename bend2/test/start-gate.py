"""Verify gated native startup and legacy owner record compatibility."""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / '.scratch/bend2/start-gate'
SOURCE = ROOT / 'bend2/test/start-gate.c'
PROCESS_EXE = ROOT / '.scratch/bend2/process-test'
PROCESS_C = ROOT / '.scratch/bend2/process-test.c'

class StartGate(unittest.TestCase):
    def test_ordinary_start_and_legacy_owner_record(self):
        if not PROCESS_C.exists():
            result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                     'bend2/test/process.bend',
                                     '.scratch/bend2/process-test'], cwd=ROOT,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        compiler = os.environ.get('CC') or shutil.which('clang-19') or shutil.which('clang')
        self.assertIsNotNone(compiler, 'clang-19 or clang is required')
        result = subprocess.run([compiler, '-O1', '-pthread',
            '-DBATON2_PROCESS_SOURCE=' + repr(str(PROCESS_C)).replace("'", '"'),
            str(SOURCE), '-lsqlite3', '-lm', '-o', str(FIXTURE)],
            cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        env = dict(os.environ)
        env.pop('BATON2_CGROUP_PARENT', None)
        env.pop('BATON2_CGROUP_ROOT', None)
        result = subprocess.run([str(FIXTURE)], cwd=ROOT, env=env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('start-gate PASS', result.stdout)

    def test_retained_native_runs_without_cgroup_setup(self):
        with tempfile.TemporaryDirectory(prefix='ordinary-receive-') as name:
            work = pathlib.Path(name)
            runtime = work / 'rt'
            runtime.mkdir(mode=0o700)
            os.chmod(runtime, 0o700)
            (runtime / 'baton2').mkdir(mode=0o700)
            os.chmod(runtime / 'baton2', 0o700)
            database = work / 'state.db'
            database.touch()
            attempt = work / 'attempt'
            payload = work / 'payload'
            payload.write_text('task payload\n')
            environment = dict(os.environ, XDG_RUNTIME_DIR=str(runtime))
            environment.pop('BATON2_CGROUP_PARENT', None)
            environment.pop('BATON2_CGROUP_ROOT', None)
            try:
                result = subprocess.run([
                    str(PROCESS_EXE), 'retain', str(database), str(attempt), str(work),
                    str(payload), 'close', '/bin/sh', '-c',
                    'cat >/dev/null; printf ordinary-native-ok; echo',
                ], cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('ordinary-native-ok\n', result.stdout)
                self.assertIn('native-exit 0', result.stdout)
                self.assertIn('retained-complete', result.stdout)
                self.assertEqual((attempt / 'status').read_text(), '0\n')
                self.assertFalse((attempt / 'native.cgroup').exists())
            finally:
                owner = None
                for entry in pathlib.Path('/proc').iterdir():
                    if not entry.name.isdigit():
                        continue
                    try:
                        argv = (entry / 'cmdline').read_bytes().split(b'\0')
                    except OSError:
                        continue
                    if b'--instance-owner' in argv and os.fsencode(database) in argv:
                        owner = int(entry.name)
                        break
                if owner is not None:
                    stopped = subprocess.run([str(PROCESS_EXE), 'shutdown', str(database)],
                                             cwd=ROOT, env=environment,
                                             capture_output=True, text=True, timeout=10)
                    self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)

if __name__ == '__main__':
    unittest.main(verbosity=2)
