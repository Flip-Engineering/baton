"""Focused checks for the SQLite change-projection installer (issue #937).

The fixture compiles the verbatim projection section of
bend2/src/host/sqlite.c and drives it against disposable databases.
Steady-state installation must take no write lock, so it succeeds while
another connection holds RESERVED; first installation still installs the
full schema and triggers in one transaction.
"""
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SQLITE_C = ROOT / 'bend2/src/host/sqlite.c'
FIXTURE_MAIN = ROOT / 'bend2/test/sqlite-projection.c'
SCRATCH = ROOT / '.scratch/bend2'
FIXTURE = SCRATCH / 'sqlite-projection'


def build_fixture():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    lines = SQLITE_C.read_text().splitlines(keepends=True)
    start = next(i for i, line in enumerate(lines)
                 if line.startswith('static int baton_sql_install_projection'))
    end = start
    while lines[end].rstrip() != '}':
        end += 1
    busy = next(i for i, line in enumerate(lines)
                if line.startswith('static int baton_sql_busy'))
    busy_end = busy
    while lines[busy_end].rstrip() != '}':
        busy_end += 1
    combined = SCRATCH / 'sqlite-projection-combined.c'
    combined.write_text(''.join(lines[:end + 1])
                        + ''.join(lines[busy:busy_end + 1])
                        + FIXTURE_MAIN.read_text())
    result = subprocess.run(
        [os.environ.get('CC', 'cc'), '-Wall', '-Wextra', '-O2',
         str(combined), '-lsqlite3', '-o', str(FIXTURE)],
        capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


class SqliteProjection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which(os.environ.get('CC', 'cc')):
            raise unittest.SkipTest('C compiler is not available')
        build_fixture()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.db = str(pathlib.Path(self.temp.name) / 'fixture.db')

    def install(self, mode='install', count=1, timeout=30):
        return subprocess.run([str(FIXTURE), mode, self.db, str(count)],
                              capture_output=True, text=True, timeout=timeout)

    def query(self, sql):
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute(sql).fetchone()[0]
        finally:
            conn.close()

    def test_fresh_install_commits_projection_and_marker(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' "
            "AND name LIKE 'native_changes_%'"), 37)
        self.assertEqual(self.query(
            'SELECT count(*) FROM baton_projection_state WHERE id=1'), 1)
        conn = sqlite3.connect(self.db)
        conn.execute("INSERT INTO knowledge(id,author,claim,evidence,limits) "
                     "VALUES('k1','a','c','e','l')")
        conn.commit()
        conn.close()
        self.assertEqual(self.query('SELECT count(*) FROM native_changes'), 1)

    def test_steady_state_install_takes_no_write_lock(self):
        self.assertEqual(self.install().returncode, 0)
        holder = subprocess.Popen([str(FIXTURE), 'hold', self.db],
                                  stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'hold_rc=0')
            result = self.install()
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
        finally:
            holder.wait(timeout=30)

    def test_dropped_trigger_is_reinstalled(self):
        self.assertEqual(self.install().returncode, 0)
        conn = sqlite3.connect(self.db)
        conn.execute('DROP TRIGGER native_changes_knowledge_insert')
        conn.commit()
        conn.close()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' "
            "AND name LIKE 'native_changes_%'"), 37)


if __name__ == '__main__':
    unittest.main()
