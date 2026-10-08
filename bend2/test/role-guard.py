import hashlib
import json
import os
import pathlib
import select
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/instance-test'


class PhysicalRoleGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='b2 role guard ')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'owner.db'
        with sqlite3.connect(self.db) as connection:
            connection.execute('CREATE TABLE fixture(value TEXT)')
        self.alias = self.root / 'owner-alias.db'
        os.link(self.db, self.alias)

    def binding(self, path):
        result = subprocess.run([EXE, 'role-binding', path], text=True,
                                capture_output=True, check=True)
        return result.stdout.strip()

    def identity(self):
        result = subprocess.run([EXE, 'role-identity'], text=True,
                                capture_output=True, check=True)
        return result.stdout.strip()

    def acquire(self, path, binding, key):
        return subprocess.run([EXE, 'role-guard', path, binding, key],
                              text=True, capture_output=True)

    def test_role_digest_matches_sha256_vector(self):
        result = subprocess.run([EXE, 'role-key', 'abc'], text=True,
                                capture_output=True, check=True)
        self.assertEqual(result.stdout.strip(),
                         'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

    def test_owner_restart_refuses_old_witness_before_admission(self):
        def command(*args):
            return subprocess.run([EXE, *map(str, args)], text=True,
                                  capture_output=True, timeout=20)

        def start_owner():
            return subprocess.Popen([EXE, 'owner', str(self.db)],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True)

        def owner_witness():
            for _ in range(100):
                result = command('owner-witness', self.db)
                if result.returncode == 0:
                    return result.stdout.strip()
                time.sleep(0.03)
            self.fail(result.stderr)

        old_owner = start_owner()
        old_witness = owner_witness()
        stopped = command('shutdown', self.db)
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertEqual(old_owner.wait(timeout=10), 0, old_owner.stderr.read())
        old_owner.stdout.close()
        old_owner.stderr.close()

        new_owner = start_owner()
        try:
            new_witness = owner_witness()
            self.assertNotEqual(old_witness, new_witness)
            attempt = self.root / 'stale-owner-attempt'
            refused = command('prepare-stale', self.db, old_witness, attempt,
                              self.root, '/bin/true', 'native.py', 'bootstrap')
            self.assertEqual(refused.returncode, 0, refused.stderr)
            self.assertIn('prepare-refused:116:', refused.stdout)
            self.assertFalse((attempt / 'manifest').exists())
            self.assertFalse((attempt / 'launch').exists())
        finally:
            stopped = command('shutdown', self.db)
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
            self.assertEqual(new_owner.wait(timeout=10), 0, new_owner.stderr.read())
            new_owner.stdout.close()
            new_owner.stderr.close()

    def test_owner_restart_refuses_start_for_prepared_attempt(self):
        env = os.environ.copy()
        owner = subprocess.Popen([EXE, 'owner', str(self.db)], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env)
        witness = None
        for _ in range(100):
            result = subprocess.run([EXE, 'owner-witness', str(self.db)], text=True,
                                    capture_output=True, env=env, timeout=10)
            if result.returncode == 0:
                witness = result.stdout.strip()
                break
            time.sleep(0.03)
        self.assertIsNotNone(witness, result.stderr)
        self.addCleanup(lambda: owner.kill() if owner.poll() is None else None)

        fixture = self.root / 'native.py'
        fixture.write_text('import sys\nprint("native-started", flush=True)\nfor line in sys.stdin:\n    if line.strip() == "exit": break\n')
        bootstrap = json.dumps({'schema': 'baton2-managed-context-bootstrap-v1',
                                'query': 'owner-witness-query', 'owner': 'owner-witness-test'},
                               sort_keys=True, separators=(',', ':'))
        decision = json.dumps({'schema': 'baton2-start-granted-v1',
                               'query': 'owner-witness-query', 'owner': 'owner-witness-test'},
                              sort_keys=True, separators=(',', ':'))
        attempt = self.root / 'prepared-before-owner-restart'
        observer = subprocess.Popen([EXE, 'prepare', str(self.db), 'witness-session',
                                     str(attempt), str(self.root), 'seed\n', sys.executable,
                                     str(fixture), bootstrap, decision, 'restart-start', witness],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, bufsize=0, env=env)
        output = bytearray()
        deadline = time.monotonic() + 20
        while b'prepared-waiting-for-start\n' not in output:
            ready, _, _ = select.select([observer.stdout], [], [], max(0, deadline-time.monotonic()))
            self.assertTrue(ready, f'prepared observer did not report ready: {bytes(output)!r}')
            chunk = os.read(observer.stdout.fileno(), 4096)
            self.assertTrue(chunk, f'prepared observer closed stdout: {bytes(output)!r}')
            output.extend(chunk)
        self.assertIn(b'prepare-ready:', output)

        owner.kill()
        self.assertEqual(owner.wait(timeout=10), -9)
        observer.stdin.close()
        remaining = observer.stdout.read().decode()
        observer_error = observer.stderr.read().decode()
        self.assertEqual(observer.wait(timeout=20), 0, observer_error)
        self.assertIn('start-after-owner-restart-failed:116:', remaining)
        self.assertFalse((attempt / 'launch').exists())
        self.assertFalse((attempt / 'native.pid').exists())

        replacement = subprocess.run([EXE, 'shutdown', str(self.db)], text=True,
                                     capture_output=True, env=env, timeout=10)
        self.assertEqual(replacement.returncode, 0, replacement.stderr)
        owner.stdout.close()
        owner.stderr.close()
        observer.stdout.close()
        observer.stderr.close()

    def test_hardlink_alias_collision_release_and_independent_role(self):
        binding = self.binding(self.db)
        alias_binding = self.binding(self.alias)
        self.assertNotEqual(json.loads(binding)['path'], json.loads(alias_binding)['path'])
        key = hashlib.sha256(self.identity().encode()).hexdigest()
        independent_key = hashlib.sha256(b'physical-db-role:other').hexdigest()

        holder = subprocess.Popen([EXE, 'role-guard', self.db, binding, key],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        self.assertEqual(holder.stdout.readline().strip(), 'role-held')
        collision = self.acquire(self.alias, alias_binding, key)
        self.assertNotEqual(collision.returncode, 0, collision.stdout + collision.stderr)
        independent = self.acquire(self.alias, alias_binding, independent_key)
        self.assertEqual(independent.returncode, 0, independent.stderr)
        self.assertEqual(independent.stdout.splitlines(), ['role-held', 'role-released'])
        holder.stdin.close()
        self.assertEqual(holder.stdout.readline().strip(), 'role-released')
        holder.stdout.close()
        holder_error = holder.stderr.read()
        holder.stderr.close()
        self.assertEqual(holder.wait(timeout=5), 0, holder_error)

        retried = self.acquire(self.alias, alias_binding, key)
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assertEqual(retried.stdout.splitlines(), ['role-held', 'role-released'])

    def test_invalid_binding_and_role_digest_are_refused(self):
        binding = self.binding(self.db)
        key = hashlib.sha256(self.identity().encode()).hexdigest()
        wrong_binding = binding.replace('"version":1', '"version":2')
        self.assertNotEqual(self.acquire(self.db, wrong_binding, key).returncode, 0)
        self.assertNotEqual(self.acquire(self.db, binding, 'xyz').returncode, 0)


if __name__ == '__main__':
    unittest.main()
