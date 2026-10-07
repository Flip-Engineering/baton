"""Check shared owner CLI verbs through the installed native binary."""
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class InstanceServe(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL);')
            connection.execute('CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);')
            connection.execute('CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL);')
            connection.commit()

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], cwd=self.directory,
                              capture_output=True, text=True)

    def call(self, *args):
        result = self.invoke(self.db, *args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_owner_status_empty_reports_null(self):
        self.assertIsNone(self.call('owner-status'))

    def test_subscribe_empty_reports_unready_cursor(self):
        answer = self.call('subscribe')
        self.assertEqual(answer, {'holder': None, 'change_id': 0, 'ready': 0})

    def test_subscribe_never_carries_row_bodies(self):
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute('CREATE TABLE native_changes (change_id INTEGER PRIMARY KEY NOT NULL);')
            connection.execute('INSERT INTO native_changes(change_id) VALUES (7),(41);')
            connection.commit()
        result = self.invoke(self.db, 'subscribe')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('body', result.stdout)
        answer = json.loads(result.stdout)
        self.assertEqual(answer['change_id'], 41)
        self.assertEqual(answer['ready'], 0)

    def test_serve_drains_empty_work_and_releases(self):
        result = self.invoke(self.db, 'serve', 'test-owner')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIsNone(self.call('owner-status'))

    def test_serve_recovers_a_lapsed_crash_row(self):
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute('CREATE TABLE instance_owner (owner TEXT PRIMARY KEY NOT NULL, heartbeat INTEGER NOT NULL, generation INTEGER NOT NULL);')
            connection.execute("INSERT INTO instance_owner(owner, heartbeat, generation) VALUES ('dead-owner', 1, 4);")
            connection.commit()
        result = self.invoke(self.db, 'serve', 'test-owner')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with closing(sqlite3.connect(self.db)) as connection:
            rows = connection.execute('SELECT owner, generation FROM instance_owner;').fetchall()
        self.assertEqual(rows, [])
        self.assertIsNone(self.call('owner-status'))

    def test_serve_refuses_beside_a_live_holder(self):
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute('CREATE TABLE instance_owner (owner TEXT PRIMARY KEY NOT NULL, heartbeat INTEGER NOT NULL, generation INTEGER NOT NULL);')
            connection.execute("INSERT INTO instance_owner(owner, heartbeat, generation) VALUES ('live-owner', strftime('%s','now'), 2);")
            connection.commit()
        result = self.invoke(self.db, 'serve', 'test-owner')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('duplicate-owner', result.stdout + result.stderr)
        with closing(sqlite3.connect(self.db)) as connection:
            rows = connection.execute('SELECT owner, generation FROM instance_owner;').fetchall()
        self.assertEqual(rows, [('live-owner', 2)])

    def test_serve_without_owner_is_refused(self):
        result = self.invoke(self.db, 'serve')
        self.assertEqual(result.returncode, 2)

    def test_help_lists_owner_verbs(self):
        result = self.invoke('help')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for operation in ['serve OWNER', 'owner-status', 'subscribe']:
            self.assertIn(operation, result.stdout)


if __name__ == '__main__':
    unittest.main()
