"""Focused checks for the SQLite change-projection installer (issue #937).

The fixture compiles the verbatim projection section of
bend2/src/host/sqlite.c and drives it against disposable databases. It covers
the lock lifecycle that stalled retained recovery, steady-state installation
without a write reservation, concurrent first installs, retained recovery
reads and settlement, schema migration and repair, marker migration, and
rollback on a failed schema.
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
        self.processes = []
        self.addCleanup(self.reap)

    def reap(self):
        for process in self.processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
            for stream in (process.stdout, process.stderr):
                if stream is not None and not stream.closed:
                    stream.close()

    def start(self, mode, argument=1):
        process = subprocess.Popen(
            [str(FIXTURE), mode, self.db, str(argument)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.processes.append(process)
        return process

    def finish(self, process, timeout=30):
        try:
            out, err = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            out, err = process.communicate()
            self.fail(f'{process.args[1]} did not complete within '
                      f'{timeout}s: {out}{err}')
        return process.returncode, out, err

    def install(self, mode='install', count=1, timeout=30):
        process = self.start(mode, count)
        code, out, err = self.finish(process, timeout)
        return subprocess.CompletedProcess(process.args, code, out, err)

    def stop(self, process):
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)

    def hold(self, mode='hold', seconds=10):
        process = self.start(mode, seconds)
        line = process.stdout.readline().strip()
        expected = 'hold_rc=0' if mode == 'hold' else 'read_held=0'
        if not line.startswith(expected):
            self.stop(process)
            self.fail(f'{mode} did not hold: {line!r}')
        return process

    def query(self, sql):
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute(sql).fetchone()[0]
        finally:
            conn.close()

    def seed_recovery(self):
        conn = sqlite3.connect(self.db)
        try:
            conn.execute(
                "INSERT INTO executions(session,id,mode,directory,phase,status) "
                "VALUES('root','a','native','/tmp','exited','exit 0')")
            conn.execute(
                "INSERT INTO messages(id,sender,recipient,kind,body,receipt) "
                "VALUES('m1','runtime-wonder','root','task','owned input',NULL)")
            conn.commit()
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
        self.assertEqual(
            self.query('SELECT schema_version FROM baton_projection_state WHERE id=1'),
            self.query('PRAGMA schema_version'))
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='index' "
            "AND name='messages_pending'"), 1)
        state = self.install('state')
        self.assertEqual(state.returncode, 0, state.stdout + state.stderr)
        self.assertIn('current=1', state.stdout)
        conn = sqlite3.connect(self.db)
        try:
            conn.execute("INSERT INTO knowledge(id,author,claim,evidence,limits) "
                         "VALUES('k1','a','c','e','l')")
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self.query('SELECT count(*) FROM native_changes'), 1)

    def test_steady_state_install_takes_no_write_lock(self):
        self.assertEqual(self.install().returncode, 0)
        holder = self.hold('hold')
        try:
            result = self.install(timeout=2)
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
        finally:
            self.stop(holder)

    def test_steady_state_install_does_not_wait_for_reserved_holder(self):
        self.assertEqual(self.install().returncode, 0)
        holder = self.hold('hold')
        try:
            result = self.install('install-busy', timeout=5)
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
        finally:
            self.stop(holder)

    def test_steady_state_install_does_not_wait_for_retained_reader(self):
        self.assertEqual(self.install().returncode, 0)
        holder = self.hold('hold-read')
        try:
            result = self.install('install-busy', timeout=5)
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
        finally:
            self.stop(holder)

    def test_module_native_change_trigger_does_not_force_reinstall(self):
        self.assertEqual(self.install().returncode, 0)
        conn = sqlite3.connect(self.db)
        try:
            conn.execute(
                "CREATE TRIGGER native_changes_requests_insert "
                "AFTER INSERT ON messages BEGIN SELECT 1; END")
            conn.commit()
        finally:
            conn.close()
        # The external DDL invalidates the marker; the next install refreshes it.
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' "
            "AND name='native_changes_requests_insert'"), 1)
        state = self.install('state')
        self.assertIn('current=1', state.stdout)
        holder = self.hold('hold')
        try:
            result = self.install('install-busy', timeout=5)
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
        finally:
            self.stop(holder)

    def test_lock_lifecycle_reserved_reads_commit_conflict(self):
        self.assertEqual(self.install().returncode, 0)
        writer = sqlite3.connect(self.db, timeout=0, isolation_level=None)
        reader = sqlite3.connect(self.db, timeout=0, isolation_level=None)
        self.addCleanup(reader.close)
        self.addCleanup(writer.close)
        writer.execute('BEGIN IMMEDIATE')
        try:
            self.assertEqual(
                reader.execute('SELECT count(*) FROM messages').fetchone()[0], 0)
            reader.execute('BEGIN')
            reader.execute('SELECT count(*) FROM messages').fetchone()
            with self.assertRaises(sqlite3.OperationalError):
                writer.execute('COMMIT')
            reader.execute('COMMIT')
            writer.execute('COMMIT')
        finally:
            for conn in (reader, writer):
                try:
                    conn.execute('ROLLBACK')
                except sqlite3.OperationalError:
                    pass

    def test_concurrent_first_installs_share_one_marker(self):
        results = [self.finish(self.start('install-busy')) for _ in range(6)]
        for code, out, err in results:
            self.assertEqual(code, 0, out + err)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' "
            "AND name LIKE 'native_changes_%'"), 37)
        self.assertEqual(self.query(
            'SELECT count(*) FROM baton_projection_state WHERE id=1'), 1)
        self.assertEqual(
            self.query('SELECT schema_version FROM baton_projection_state WHERE id=1'),
            self.query('PRAGMA schema_version'))

    def test_recovery_status_and_input_settle_during_projection_calls(self):
        self.assertEqual(self.install().returncode, 0)
        self.seed_recovery()
        installers = [self.start('install-busy', 10) for _ in range(4)]
        recovery = self.start('recover')
        for process in installers:
            code, out, err = self.finish(process)
            self.assertEqual(code, 0, out + err)
        code, out, err = self.finish(recovery)
        self.assertEqual(code, 0, out + err)
        self.assertIn('status=exited/exit 0', out)
        self.assertIn('input=m1:owned input', out)
        self.assertIn('read_rc=0', out)
        self.assertIn('settle_rc=0', out)
        self.assertEqual(
            self.query("SELECT receipt FROM messages WHERE id='m1'"), 'accepted')

    def test_missing_application_table_is_repaired(self):
        self.assertEqual(self.install().returncode, 0)
        conn = sqlite3.connect(self.db)
        try:
            conn.execute('DROP TABLE usage_windows')
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='table' "
            "AND name='usage_windows'"), 0)
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='table' "
            "AND name='usage_windows'"), 1)
        self.assertEqual(
            self.query('SELECT schema_version FROM baton_projection_state WHERE id=1'),
            self.query('PRAGMA schema_version'))

    def test_migration_adds_columns_and_preserves_rows(self):
        conn = sqlite3.connect(self.db)
        try:
            conn.executescript(
                "CREATE TABLE knowledge (id TEXT UNIQUE NOT NULL, author TEXT NOT NULL, "
                "claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL);"
                "CREATE TABLE knowledge_promotions (id TEXT UNIQUE NOT NULL, "
                "finding TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL, "
                "destination TEXT NOT NULL, promoted_by TEXT NOT NULL);"
                "INSERT INTO knowledge VALUES('k1','a','c','e','l');"
                "INSERT INTO knowledge_promotions VALUES('p1','k1','a','s','d','a');")
            conn.commit()
        finally:
            conn.close()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.query("SELECT kind FROM knowledge WHERE id='k1'"),
                         'finding')
        self.assertEqual(
            self.query("SELECT source_kind FROM knowledge_promotions WHERE id='p1'"),
            'session')
        self.assertEqual(
            self.query("SELECT destination_kind FROM knowledge_promotions WHERE id='p1'"),
            'session')
        conn = sqlite3.connect(self.db)
        try:
            conn.execute(
                "INSERT INTO knowledge(id,author,claim,evidence,limits) "
                "VALUES('k2','b','c','e','l')")
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self.query('SELECT count(*) FROM native_changes'), 1)

    def test_dropped_trigger_is_reinstalled(self):
        self.assertEqual(self.install().returncode, 0)
        conn = sqlite3.connect(self.db)
        try:
            conn.execute('DROP TRIGGER native_changes_knowledge_insert')
            conn.commit()
        finally:
            conn.close()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' "
            "AND name LIKE 'native_changes_%'"), 37)
        self.assertEqual(
            self.query('SELECT schema_version FROM baton_projection_state WHERE id=1'),
            self.query('PRAGMA schema_version'))
        conn = sqlite3.connect(self.db)
        try:
            conn.execute(
                "INSERT INTO knowledge(id,author,claim,evidence,limits) "
                "VALUES('k1','a','c','e','l')")
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self.query('SELECT count(*) FROM native_changes'), 1)

    def test_failed_schema_rolls_back_without_marker(self):
        result = self.install('bad')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('code=1 err=', result.stdout)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='table'"), 0)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master "
            "WHERE name='baton_projection_state'"), 0)
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.query(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger' "
            "AND name LIKE 'native_changes_%'"), 37)

    def test_old_marker_table_is_migrated(self):
        self.assertEqual(self.install().returncode, 0)
        conn = sqlite3.connect(self.db)
        try:
            conn.executescript(
                "CREATE TABLE old_marker (id INTEGER PRIMARY KEY CHECK(id=1), "
                "fingerprint TEXT NOT NULL);"
                "INSERT INTO old_marker SELECT id, fingerprint "
                "FROM baton_projection_state;"
                "DROP TABLE baton_projection_state;"
                "ALTER TABLE old_marker RENAME TO baton_projection_state;")
            conn.commit()
        finally:
            conn.close()
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        conn = sqlite3.connect(self.db)
        try:
            columns = [row[1] for row in
                       conn.execute('PRAGMA table_info(baton_projection_state)')]
        finally:
            conn.close()
        self.assertIn('schema_version', columns)
        self.assertEqual(
            self.query('SELECT schema_version FROM baton_projection_state WHERE id=1'),
            self.query('PRAGMA schema_version'))


if __name__ == '__main__':
    unittest.main()
