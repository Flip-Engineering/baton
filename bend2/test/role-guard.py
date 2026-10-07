import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
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
