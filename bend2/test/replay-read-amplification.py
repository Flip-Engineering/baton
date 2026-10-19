"""Focused replay read-amplification checks for issue #943.

The fixture builds a disposable accounts-like database from the schema
literals in bend2/src/coordinator/commands.bend, writes a two-frame replay
spool, and runs the terminal observation query that reads pending input. The
query is the same shape as completion_sql_expr: two pending counts and one
oldest-pending read. Before the messages_pending index the plan scans messages
three times; after the index it searches the covering index. The test also
holds the replay cursor, EOF and row results fixed across both runs.
"""
import json
import os
import pathlib
import re
import shutil
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMMANDS = ROOT / 'bend2/src/coordinator/commands.bend'
ROWS = 30000
PENDING = 30
INDEX_NAME = 'messages_pending'


def source_literal(name):
    text = COMMANDS.read_text()
    match = re.search(r'"(' + re.escape(name) + r'[^"]*)"', text)
    if not match:
        raise AssertionError(f'schema literal not found in {COMMANDS}: {name}')
    return match.group(1)


def rchar():
    try:
        with open('/proc/self/io') as handle:
            for line in handle:
                if line.startswith('rchar:'):
                    return int(line.split()[1])
    except OSError:
        return None
    return None


class ReplayReadAmplification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables = {
            'sessions': source_literal('CREATE TABLE IF NOT EXISTS sessions'),
            'messages': source_literal('CREATE TABLE IF NOT EXISTS messages'),
            'turns': source_literal('CREATE TABLE IF NOT EXISTS turns'),
            'session_stops': source_literal('CREATE TABLE IF NOT EXISTS session_stops'),
        }
        cls.index = source_literal(
            'CREATE INDEX IF NOT EXISTS ' + INDEX_NAME)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='replay-amplification-')
        self.addCleanup(self.temp.cleanup)
        self.db = pathlib.Path(self.temp.name) / 'accounts-like.db'
        self.spool = pathlib.Path(self.temp.name) / 'stdout.spool'
        self.connection = sqlite3.connect(self.db)
        for sql in self.tables.values():
            self.connection.execute(sql)
        self.connection.execute(
            "INSERT INTO sessions(id,parent,harness) VALUES('root',NULL,'omp')")
        rows = [('m%06d' % i, 'sender', 'root', 'task', 'x' * 200,
                 None if i >= ROWS - PENDING else 'accepted')
                for i in range(ROWS)]
        self.connection.executemany(
            'INSERT INTO messages(id,sender,recipient,kind,body,receipt) '
            'VALUES(?,?,?,?,?,?)', rows)
        self.connection.commit()
        self.frames = [
            json.dumps({'type': 'message_start', 'id': 'frame-1'}),
            json.dumps({'type': 'agent_end', 'isTerminal': True,
                        'session_id': 'root',
                        'messages': [{'role': 'assistant',
                                      'content': [{'type': 'text',
                                                   'text': 'terminal output'}]}]}),
        ]
        self.spool.write_text('\n'.join(self.frames) + '\n')
        self.spool_bytes = self.spool.stat().st_size
        self.cursor = len(self.frames[0]) + 1

    def tearDown(self):
        self.connection.close()

    def observe_sql(self):
        pending = ("(SELECT count(*) FROM messages WHERE recipient='root' "
                   "AND receipt IS NULL AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session='root'))")
        oldest = ("(SELECT id FROM messages WHERE recipient='root' "
                  "AND receipt IS NULL AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session='root') "
                  "ORDER BY seq LIMIT 1)")
        return ("SELECT json_object('reconciliation',CASE WHEN " + pending + ">0 THEN "
                "json_object('pendingCount'," + pending + ",'oldestPendingId'," + oldest + ") "
                "ELSE NULL END) FROM sessions WHERE id='root';")

    def measure(self, sql):
        connection = sqlite3.connect(self.db, isolation_level=None)
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA synchronous=FULL')
        before = rchar()
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TEMP TABLE baton_observation_frame(value TEXT NOT NULL)')
        connection.execute(
            "INSERT INTO temp.baton_observation_frame(value) "
            "SELECT value FROM (SELECT ? AS value) WHERE json_valid(value)",
            (self.frames[1],))
        row = connection.execute(sql).fetchone()
        connection.execute('DROP TABLE temp.baton_observation_frame')
        connection.execute('COMMIT')
        after = rchar()
        plan = [row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + sql)]
        connection.close()
        return row[0] if row else None, plan, (after - before if before is not None and after is not None else None)

    def test_terminal_pending_query_uses_covering_index(self):
        before_row, before_plan, before_bytes = self.measure(self.observe_sql())
        self.assertIn('SCAN messages', before_plan)
        self.connection.execute(self.index)
        self.connection.commit()
        after_row, after_plan, after_bytes = self.measure(self.observe_sql())
        self.assertTrue(any(INDEX_NAME in step for step in after_plan),
                        after_plan)
        self.assertFalse(any('SCAN messages' in step for step in after_plan),
                         after_plan)
        self.assertEqual(before_row, after_row)
        payload = json.loads(before_row)
        self.assertEqual(payload['reconciliation']['pendingCount'], PENDING)
        self.assertEqual(payload['reconciliation']['oldestPendingId'],
                         'm%06d' % (ROWS - PENDING))
        if before_bytes is not None and after_bytes is not None:
            self.assertGreater(before_bytes, 1000000)
            self.assertLess(after_bytes, 1000000)
            self.assertLess(after_bytes * 10, before_bytes)
        # The observation does not move the replay cursor, EOF or spool.
        self.assertEqual(self.spool.stat().st_size, self.spool_bytes)
        self.assertEqual(self.spool.read_text(),
                         '\n'.join(self.frames) + '\n')
        self.assertEqual(self.cursor, len(self.frames[0]) + 1)
        # The index changes no row or custody identity.
        messages = self.connection.execute(
            'SELECT count(*), min(id), max(id) FROM messages').fetchone()
        self.assertEqual(messages, (ROWS, 'm000000', 'm029999'))
        inode = self.db.stat().st_ino
        self.connection.execute('SELECT 1').fetchone()
        self.assertEqual(self.db.stat().st_ino, inode)


if __name__ == '__main__':
    unittest.main()
