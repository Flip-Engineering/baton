"""players and project-sessions on SQLite before 3.46 (#1485).

SQLite before 3.46.0 parses with a fixed-depth stack. The player rows nest the
task and session state predicates, and project-sessions refused with "parser
stack overflow" on the 3.45.1 library of Ubuntu 24.04. The test runs the
coordinator with such a library selected through LD_LIBRARY_PATH, and checks
that a statement that does overflow names the loaded version and the version
Baton needs. A host without a library older than 3.46 skips it.
"""
import ctypes
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))
FIXTURE = pathlib.Path(os.environ.get('BATON2_SQLITE_STACK_FIXTURE', ROOT / '.scratch/bend2/sqlite-stack-entry'))
CANDIDATES = [pathlib.Path(path) for path in os.environ.get('BATON2_OLD_SQLITE', '').split(':') if path] or [
    pathlib.Path('/usr/lib/x86_64-linux-gnu/libsqlite3.so.0'), pathlib.Path('/usr/lib/aarch64-linux-gnu/libsqlite3.so.0')]


def old_library():
    for path in CANDIDATES:
        if path.exists():
            library = ctypes.CDLL(str(path))
            library.sqlite3_libversion.restype = ctypes.c_char_p
            if library.sqlite3_libversion_number() < 3046000:
                return path, library.sqlite3_libversion().decode()
    return None, None


class OldParser(unittest.TestCase):
    def setUp(self):
        self.library, self.version = old_library()
        if self.library is None:
            self.skipTest('no SQLite library older than 3.46 on this host')
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.environment = {key: value for key, value in os.environ.items()
                            if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON2_GIT_REGISTRY')}
        self.environment['HOME'] = str(self.directory / 'home')
        (self.directory / 'home').mkdir()
        self.old = {**self.environment, 'LD_LIBRARY_PATH': str(self.library.parent)}

    def baton(self, database, *args, environment):
        return subprocess.run([str(EXE), str(database), *map(str, args)], capture_output=True, text=True,
                              env=environment)

    def test_players_and_project_sessions_run_on_the_old_library(self):
        checkout = self.directory / 'project'
        subprocess.run(['git', 'init', '-q', str(checkout)], check=True, capture_output=True)
        database = checkout / '.git/baton2/orchestra.db'
        database.parent.mkdir(parents=True)
        self.addCleanup(lambda: subprocess.run([str(EXE), '--instance-shutdown', str(database)],
                                               capture_output=True, env=self.environment))
        # start-setup records each seat's workspace, which places it in the project.
        for args in (('project', checkout),
                     ('start-setup', 'seat-a', 'codex', '/bin/true', 'gpt-6-astra', 'low', checkout,
                      self.directory / 'seat-a.jsonl'),
                     ('start-setup', 'seat-b', 'codex', '/bin/true', 'gpt-6-astra', 'low', checkout,
                      self.directory / 'seat-b.jsonl'),
                     ('message', 'task-a', 'operator', 'seat-a', 'task', 'Do the work.')):
            result = self.baton(database, *args, environment=self.environment)
            self.assertEqual(result.returncode, 0, result.stderr)
        players = self.baton(database, 'as', 'operator', 'players', environment=self.old)
        self.assertEqual(players.returncode, 0, players.stderr)
        self.assertEqual([row['id'] for row in json.loads(players.stdout)], ['seat-a', 'seat-b'])
        sessions = self.baton(database, 'project-sessions', checkout, environment=self.old)
        self.assertEqual(sessions.returncode, 0, sessions.stderr)
        listed = json.loads(sessions.stdout)
        self.assertEqual(sorted(row['id'] for row in listed['sessions']), ['seat-a', 'seat-b'])
        self.assertEqual(listed['sessions'][0]['taskCompletion']['assignmentId'], 'task-a')

    def test_a_statement_that_overflows_names_the_sqlite_version_baton_needs(self):
        if not FIXTURE.is_file():
            self.fail(f'Fixture not built at {FIXTURE}')
        result = subprocess.run([str(FIXTURE)], capture_output=True, text=True, env=self.old)
        self.assertIn('parser stack overflow', result.stdout)
        self.assertIn(f'SQLite {self.version} is loaded; Baton\'s statements need SQLite 3.46.0 or later',
                      result.stdout)


if __name__ == '__main__':
    unittest.main()
