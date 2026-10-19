"""SQL microbenchmark for the production pending-input query (issue #943).

The fixture builds a disposable accounts-like database from the schema
literals in bend2/src/coordinator/commands.bend, asserts the production
completion_pending_sql, completion_oldest_sql and messages_pending fragments
are present, and measures the plan and database reads for that query shape.
It does not drive replay and makes no cursor, EOF or custody claim. The
158-byte value is a reference payload size for the bytes-per-byte ratio.
"""
import json
import pathlib
import re
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMMANDS = ROOT / 'bend2/src/coordinator/commands.bend'
ROWS = 30000
PENDING = 30
INDEX_NAME = 'messages_pending'


def source_literal(text, name):
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


class PendingInputQueryPlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = COMMANDS.read_text()
        cls.tables = {
            'sessions': source_literal(cls.source, 'CREATE TABLE IF NOT EXISTS sessions'),
            'messages': source_literal(cls.source, 'CREATE TABLE IF NOT EXISTS messages'),
            'turns': source_literal(cls.source, 'CREATE TABLE IF NOT EXISTS turns'),
            'session_stops': source_literal(cls.source,
                                            'CREATE TABLE IF NOT EXISTS session_stops'),
        }
        cls.index = source_literal(
            cls.source, 'CREATE INDEX IF NOT EXISTS ' + INDEX_NAME)
        for fragment in (
                'SELECT count(*) FROM messages WHERE recipient=',
                'AND receipt IS NULL AND NOT ',
                'ORDER BY seq LIMIT 1',
                'completion_pending_sql',
                'completion_oldest_sql'):
            if fragment not in cls.source:
                raise AssertionError(
                    f'production query fragment missing: {fragment}')
        if 'WHERE receipt IS NULL' not in cls.index:
            raise AssertionError(
                f'{INDEX_NAME} is not the partial pending index: {cls.index}')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pending-query-plan-')
        self.addCleanup(self.temp.cleanup)
        self.db = pathlib.Path(self.temp.name) / 'accounts-like.db'
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
        self.terminal_event = json.dumps(
            {'type': 'agent_end', 'isTerminal': True, 'session_id': 'root',
             'messages': [{'role': 'assistant',
                           'content': [{'type': 'text',
                                        'text': 'terminal output'}]}]})

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
            (self.terminal_event,))
        row = connection.execute(sql).fetchone()
        connection.execute('DROP TABLE temp.baton_observation_frame')
        connection.execute('COMMIT')
        after = rchar()
        plan = [row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + sql)]
        connection.close()
        return (row[0] if row else None, plan,
                after - before if before is not None and after is not None else None)

    def test_terminal_pending_query_uses_partial_index(self):
        sql = self.observe_sql()
        self.assertIn('receipt IS NULL', sql)
        self.assertIn('ORDER BY seq LIMIT 1', sql)
        before_row, before_plan, before_bytes = self.measure(sql)
        self.assertIn('SCAN messages', before_plan)
        self.connection.execute(self.index)
        self.connection.commit()
        after_row, after_plan, after_bytes = self.measure(sql)
        self.assertGreaterEqual(
            sum(1 for step in after_plan if INDEX_NAME in step), 3, after_plan)
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


if __name__ == '__main__':
    unittest.main()
