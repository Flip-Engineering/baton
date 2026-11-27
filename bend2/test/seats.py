"""One command reads every seat database under a seat home.

baton seats --root SEAT_HOME finds each checkout's project database the way
dispatch does and prints the status rows of all of them, each with its
database, as one JSON array or as a short table.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))


class Seats(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.fail(f'Coordinator not built at {EXE}')
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.home = self.directory / 'worktrees'
        self.home.mkdir()
        self.environment = {key: value for key, value in os.environ.items()
                            if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON2_GIT_REGISTRY')}
        self.environment['HOME'] = str(self.directory / 'home')
        (self.directory / 'home').mkdir()
        self.databases = []
        self.addCleanup(self.shutdown)

    def shutdown(self):
        for database in self.databases:
            if database.exists():
                subprocess.run([str(EXE), '--instance-shutdown', str(database)],
                               capture_output=True, text=True, env=self.environment)

    def run_baton(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], capture_output=True, text=True,
                              env=self.environment)

    def call(self, database, *args):
        result = self.run_baton(database, *args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def seat_project(self, name, seat):
        checkout = self.home / name
        subprocess.run(['git', 'init', '-q', str(checkout)], check=True, capture_output=True)
        database = checkout / '.git/baton2/orchestra.db'
        database.parent.mkdir(parents=True)
        self.databases.append(database)
        self.call(database, 'project', checkout)
        self.call(database, 'attach', 'operator', 'fixture', '', '')
        self.call(database, 'role', 'operator', 'operator')
        self.call(database, 'attach', seat, 'fixture', '', '')
        self.call(database, 'role', seat, 'principal-conductor')
        self.call(database, 'message', seat + '-task', 'operator', seat, 'task', 'Do the work.')
        return database.resolve()

    def test_every_seat_under_a_seat_home_in_one_call(self):
        first = self.seat_project('alpha', 'seat-a')
        second = self.seat_project('beta', 'seat-b')
        (self.home / 'not-a-checkout').mkdir()
        result = self.run_baton('seats', '--root', self.home)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        rows = json.loads(result.stdout)
        self.assertEqual([(row['database'], row['id']) for row in rows],
                         [(str(first), 'seat-a'), (str(second), 'seat-b')])
        for row in rows:
            self.assertEqual((row['state'], row['blockedCause']), ('blocked', 'harness-unsupported'))
            self.assertIsNotNone(row['operatorWaitingSince'])
        table = self.run_baton('seats', '--root', self.home, '--table')
        self.assertEqual(table.returncode, 0, table.stderr)
        lines = table.stdout.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith(f'{first}  seat-a  blocked  harness-unsupported  '), lines[0])
        self.assertTrue(lines[0].endswith(rows[0]['operatorWaitingSince']), lines[0])


if __name__ == '__main__':
    unittest.main()
