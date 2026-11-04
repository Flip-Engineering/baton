"""Write-ahead-log checks for the coordinator database connections (#1054).

The fixture compiles the verbatim baton_sql_busy and baton_sql_wal functions
of bend2/src/host/sqlite.c and opens disposable databases the way the host's
read-write paths do. Under the rollback journal a reader's open transaction
blocked every commit until the busy handler gave up, so wakes and observations
failed with SQLITE_BUSY ('database is locked'). The checks cover a commit
while a reader holds its transaction, the conversion of an existing
rollback-journal database by the first open, and connections of a binary
without the journal-mode statement opening the converted file.
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
FIXTURE_MAIN = ROOT / 'bend2/test/sqlite-wal.c'
SCRATCH = ROOT / '.scratch/bend2'
FIXTURE = SCRATCH / 'sqlite-wal'
HEADER = '#include <sqlite3.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n'
# A source without the helper keeps the rollback journal. The stub lets the
# same scenarios run there and fail for the reason the change removes.
WAL_STUB = 'static void baton_sql_wal(sqlite3 *db) { (void)db; }\n'


def function(lines, prefix):
    start = next((i for i, line in enumerate(lines) if line.startswith(prefix)), None)
    if start is None:
        return None
    end = start
    while lines[end].rstrip() != '}':
        end += 1
    return ''.join(lines[start:end + 1])


def build_fixture():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    lines = SQLITE_C.read_text().splitlines(keepends=True)
    busy = function(lines, 'static int baton_sql_busy')
    wal = function(lines, 'static void baton_sql_wal') or WAL_STUB
    combined = SCRATCH / 'sqlite-wal-combined.c'
    combined.write_text(HEADER + busy + wal + FIXTURE_MAIN.read_text())
    result = subprocess.run(
        [os.environ.get('CC', 'cc'), '-Wall', '-Wextra', '-O2',
         str(combined), '-lsqlite3', '-o', str(FIXTURE)],
        capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


class SqliteWal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which(os.environ.get('CC', 'cc')):
            raise unittest.SkipTest('C compiler is not available')
        build_fixture()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.db = str(pathlib.Path(self.temp.name) / 'orchestra.db')
        # A rollback-journal database, as the coordinator database was before
        # this change.
        with sqlite3.connect(self.db) as conn:
            conn.execute('CREATE TABLE t(v TEXT)')
            conn.execute("INSERT INTO t(v) VALUES('seed')")
        self.assertEqual(self.mode(), 'delete')

    def mode(self):
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute('PRAGMA journal_mode').fetchone()[0]
        finally:
            conn.close()

    def run_fixture(self, *args):
        return subprocess.run([str(FIXTURE), *args, ], capture_output=True, text=True)

    def test_first_open_converts_the_database(self):
        result = self.run_fixture('open', self.db)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), 'wal')
        self.assertEqual(self.mode(), 'wal')

    def test_commit_while_a_reader_holds_its_transaction(self):
        self.assertEqual(self.run_fixture('open', self.db).returncode, 0)
        reader = sqlite3.connect(self.db, isolation_level=None)
        self.addCleanup(reader.close)
        reader.execute('BEGIN')
        self.assertEqual(reader.execute('SELECT count(*) FROM t').fetchone()[0], 1)
        result = self.run_fixture('write', self.db, 'during-read')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('write_rc=0 ', result.stdout)
        elapsed = int(result.stdout.split('ms=')[1].split()[0])
        self.assertLess(elapsed, 5000, result.stdout)
        # The reader keeps its snapshot until it ends its transaction.
        self.assertEqual(reader.execute('SELECT count(*) FROM t').fetchone()[0], 1)
        reader.execute('COMMIT')
        self.assertEqual(reader.execute('SELECT count(*) FROM t').fetchone()[0], 2)

    def test_connection_without_the_journal_statement_opens_the_converted_file(self):
        self.assertEqual(self.run_fixture('open', self.db).returncode, 0)
        old = self.run_fixture('old-write', self.db, 'old-binary')
        self.assertEqual(old.returncode, 0, old.stdout + old.stderr)
        self.assertIn('write_rc=0 ', old.stdout)
        self.assertEqual(self.mode(), 'wal')
        read = self.run_fixture('read-only', self.db)
        self.assertEqual(read.returncode, 0, read.stdout + read.stderr)
        self.assertIn('2', read.stdout.splitlines()[0])

    def test_converted_database_reads_after_the_writers_exit(self):
        self.assertEqual(self.run_fixture('write', self.db, 'one').returncode, 0)
        self.assertEqual(self.run_fixture('write', self.db, 'two').returncode, 0)
        conn = sqlite3.connect(self.db)
        try:
            values = [row[0] for row in conn.execute('SELECT v FROM t ORDER BY rowid')]
        finally:
            conn.close()
        self.assertEqual(values, ['seed', 'one', 'two'])


if __name__ == '__main__':
    unittest.main()
