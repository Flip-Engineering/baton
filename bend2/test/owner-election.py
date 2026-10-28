"""One physical database elects one owner across inherited runtime directories."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/instance-test'
WAIT_SECONDS = 10
COMMAND_SECONDS = 5
CLEANUP_SECONDS = 3


class OwnerElection(unittest.TestCase):
    def environment(self, root, name, runtime):
        env = os.environ.copy()
        home = root / name
        home.mkdir(mode=0o700)
        env['HOME'] = str(home)
        env.pop('XDG_RUNTIME_DIR', None)
        if runtime:
            directory = home / 'runtime'
            directory.mkdir(mode=0o700)
            env['XDG_RUNTIME_DIR'] = str(directory)
        return env

    def command(self, env, *args):
        return subprocess.run([str(EXE), *map(str, args)], env=env,
                              stdin=subprocess.DEVNULL, capture_output=True,
                              text=True, timeout=COMMAND_SECONDS)

    def witness(self, child, env, database):
        deadline = time.monotonic() + WAIT_SECONDS
        while time.monotonic() < deadline:
            if child.poll() is not None:
                stdout, stderr = child.communicate(timeout=CLEANUP_SECONDS)
                self.fail(f'owner exited before readiness: {child.returncode}, '
                          f'{stdout!r}, {stderr!r}')
            result = self.command(env, 'owner-witness', database)
            if result.returncode == 0:
                return result.stdout.strip()
            time.sleep(.03)
        self.fail(f'owner did not become ready within {WAIT_SECONDS}s')

    def reap(self, child):
        if child is None:
            return '', ''
        try:
            return child.communicate(timeout=CLEANUP_SECONDS)
        except subprocess.TimeoutExpired:
            child.terminate()
        try:
            return child.communicate(timeout=CLEANUP_SECONDS)
        except subprocess.TimeoutExpired:
            child.kill()
            return child.communicate(timeout=CLEANUP_SECONDS)

    def compare(self, first_runtime, second_runtime, alias):
        with tempfile.TemporaryDirectory(prefix='b2oe-', dir='/tmp') as temporary:
            root = Path(temporary).resolve()
            database = root / 'instance.db'
            database.touch(mode=0o600)
            target = database
            if alias:
                target = root / 'alias.db'
                if alias == 'hard':
                    os.link(database, target)
                else:
                    target.symlink_to(database)
            self.assertEqual((database.stat().st_dev, database.stat().st_ino),
                             (target.stat().st_dev, target.stat().st_ino))
            first_env = self.environment(root, 'first-home', first_runtime)
            second_env = self.environment(root, 'second-home', second_runtime)
            first = subprocess.Popen([str(EXE), '--instance-owner', str(database)],
                                     env=first_env, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            contender = None
            proof = {'database_device': database.stat().st_dev,
                     'database_inode': database.stat().st_ino,
                     'first_runtime': first_env.get('XDG_RUNTIME_DIR'),
                     'second_runtime': second_env.get('XDG_RUNTIME_DIR'), 'alias': alias,
                     'first_pid': first.pid, 'original_waits': []}
            try:
                original = self.witness(first, first_env, database)
                proof['first_witness'] = original
                contender = subprocess.Popen([str(EXE), 'owner-try', str(target)],
                                             env=second_env, stdin=subprocess.DEVNULL,
                                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                proof['contender_pid'] = contender.pid
                deadline = time.monotonic() + WAIT_SECONDS
                while contender.poll() is None and time.monotonic() < deadline:
                    result = self.command(second_env, 'owner-witness', target)
                    if result.returncode == 0 and result.stdout.strip() != original:
                        proof['split_witness'] = result.stdout.strip()
                        stopped = self.command(second_env, 'shutdown', target)
                        self.assertEqual(stopped.returncode, 0, stopped.stderr)
                        self.assertIn('shutdown-ok', stopped.stdout)
                        break
                    time.sleep(.03)
                if contender.poll() is None:
                    self.fail(f'owner contender did not finish within {WAIT_SECONDS}s: {proof}')
                stdout, stderr = contender.communicate(timeout=CLEANUP_SECONDS)
                proof['original_waits'].append({'pid': contender.pid,
                    'returncode': contender.returncode, 'stdout': stdout, 'stderr': stderr})
                self.assertEqual(contender.returncode, 0, proof)
                self.assertNotIn('split_witness', proof, proof)
                self.assertIn('owner-refused:', stdout, proof)
                self.assertIn('busy', stdout.lower(), proof)
                current = self.command(second_env, 'owner-witness', target)
                self.assertEqual(current.returncode, 0, current.stderr)
                self.assertEqual(current.stdout.strip(), original, proof)
                self.assertIsNone(first.poll(), proof)
            finally:
                for env, path in [(second_env, target), (first_env, database)]:
                    try:
                        stopped = self.command(env, 'shutdown', path)
                        proof.setdefault('shutdowns', []).append({'returncode': stopped.returncode,
                            'stdout': stopped.stdout, 'stderr': stopped.stderr})
                    except (OSError, subprocess.TimeoutExpired) as error:
                        proof.setdefault('shutdowns', []).append({'error': repr(error)})
                for child in [contender, first]:
                    if child is not None:
                        stdout, stderr = self.reap(child)
                        if not any(row['pid'] == child.pid for row in proof['original_waits']):
                            proof['original_waits'].append({'pid': child.pid,
                                'returncode': child.returncode, 'stdout': stdout, 'stderr': stderr})
                print('evidence owner-election', json.dumps(proof, sort_keys=True), flush=True)
            self.assertEqual(first.returncode, 0, proof)
            for stopped in proof['shutdowns']:
                self.assertEqual(stopped.get('returncode'), 0, proof)
                self.assertIn('shutdown-ok', stopped.get('stdout', ''), proof)

    def test_distinct_runtime_and_home_directories_share_one_owner(self):
        self.compare(True, True, None)

    def test_set_and_unset_runtime_directories_share_one_owner(self):
        self.compare(True, False, None)

    def test_hard_link_alias_and_runtime_change_share_one_owner(self):
        self.compare(True, True, 'hard')

    def test_symlink_alias_and_runtime_change_share_one_owner(self):
        self.compare(False, True, 'symbolic')


if __name__ == '__main__':
    unittest.main(verbosity=2)
