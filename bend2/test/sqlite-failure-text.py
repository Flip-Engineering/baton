#!/usr/bin/env python3
"""A locked database reports its extended result code and how long the call ran.

BATON2_SQLITE_FAILURE_TEXT_FIXTURE names the built sqlite-failure-text-fixture.bend.
Another connection holds the write lock of a temporary WAL database while the
fixture runs a statement. The answer still reads "database is locked", and now
carries the extended result code and the milliseconds since the busy handler was
set: a deferred read-then-write upgrade is answered at once, a lock the busy
handler waits for ends after about 30000 ms (3000 retries of 10 ms). A failure
that is not a lock keeps its message unchanged.
"""
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest

FIXTURE = os.environ.get('BATON2_SQLITE_FAILURE_TEXT_FIXTURE')
if not FIXTURE:
    print('Set BATON2_SQLITE_FAILURE_TEXT_FIXTURE to the built sqlite-failure-text-fixture', file=sys.stderr)
    sys.exit(2)

TEXT = re.compile(r'^failed (\d+): (.*?) \((SQLITE_\w+), extended code (\d+), (\d+) ms since the busy handler was set\)$')


def run(mode, db, sql):
    done = subprocess.run([FIXTURE, mode, db, sql], capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, (done.stdout, done.stderr)
    return done.stdout.strip()


class FailureText(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='sqlite-failure-text-')
        self.addCleanup(self.directory.cleanup)
        self.db = os.path.join(self.directory.name, 'copy.db')
        connection = sqlite3.connect(self.db)
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('CREATE TABLE t(x INTEGER)')
        connection.commit()
        connection.close()
        self.writer = sqlite3.connect(self.db, isolation_level=None)
        self.writer.execute('BEGIN IMMEDIATE')
        self.writer.execute('INSERT INTO t VALUES(0)')
        self.addCleanup(self.writer.close)

    def test_a_deferred_upgrade_is_answered_at_once_with_its_code(self):
        answer = run('query', self.db, 'BEGIN; SELECT count(*) FROM t; INSERT INTO t VALUES(1); COMMIT;')
        parsed = TEXT.match(answer)
        self.assertTrue(parsed, answer)
        self.assertEqual(parsed.group(1), '5')
        self.assertEqual(parsed.group(2), 'database is locked')
        self.assertEqual(parsed.group(3), 'SQLITE_BUSY')
        self.assertEqual(parsed.group(4), '5')
        self.assertLess(int(parsed.group(5)), 2000, answer)

    def test_a_lock_the_busy_handler_waited_for_reports_the_wait(self):
        answer = run('query', self.db, 'BEGIN IMMEDIATE; INSERT INTO t VALUES(1); COMMIT;')
        parsed = TEXT.match(answer)
        self.assertTrue(parsed, answer)
        self.assertEqual(parsed.group(2), 'database is locked')
        self.assertEqual(parsed.group(3), 'SQLITE_BUSY')
        self.assertGreaterEqual(int(parsed.group(5)), 29000, answer)
        self.assertLess(int(parsed.group(5)), 60000, answer)

    def test_a_failure_that_is_not_a_lock_keeps_its_message(self):
        self.assertEqual(run('query', self.db, 'SELECT * FROM missing_table;'),
                         'failed 1: no such table: missing_table')

    def test_a_read_that_succeeds_is_unchanged(self):
        self.writer.execute('COMMIT')
        self.assertEqual(run('read', self.db, 'SELECT count(*) FROM t;'), 'ok\n1')


if __name__ == '__main__':
    unittest.main()
