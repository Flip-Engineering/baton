"""SQL read-amplification fixture for issues #943 and #723.

This test measures a disposable SQL fixture with the source predicates used by
terminal completion. Under #723 a message is pending while its recipient has no
stored read row; the fixture checks those predicates and subquery counts
against commands.bend and message-status.bend. It does not execute the
coordinator replay loop or measure cursor advancement.
"""
import json
import pathlib
import re
import sqlite3
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
COMMANDS = ROOT / 'bend2/src/coordinator/commands.bend'
STATUS = ROOT / 'bend2/src/coordinator/message-status.bend'
ROWS = 30000
PENDING = 30
INDEX_NAME = 'messages_recipient_seq'


def source_literal(path, name):
    text = path.read_text()
    match = re.search(r'"(' + re.escape(name) + r'[^"]*)"', text)
    if not match:
        raise AssertionError(f'schema literal not found in {path}: {name}')
    return match.group(1)


def source_index():
    text = COMMANDS.read_text()
    match = re.search(r'"([^"]*CREATE INDEX IF NOT EXISTS ' + INDEX_NAME + r'[^"]*)"', text)
    if not match:
        raise AssertionError(f'index literal not found in {COMMANDS}: {INDEX_NAME}')
    return match.group(1)


def source_function(path, name):
    text = path.read_text()
    start = text.index(f'def {name}(')
    return text[start:].split('\ndef ', 1)[0]


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
            'sessions': source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS sessions'),
            'messages': source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS messages'),
            'turns': source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS turns'),
            'session_stops': source_literal(COMMANDS, 'CREATE TABLE IF NOT EXISTS session_stops'),
            'message_reads': source_literal(STATUS, 'CREATE TABLE IF NOT EXISTS message_reads'),
            'message_reads_message': source_literal(STATUS, 'CREATE INDEX IF NOT EXISTS message_reads_message'),
        }
        cls.index = source_index()
        pending = source_function(COMMANDS, 'completion_pending_sql')
        oldest = source_function(COMMANDS, 'completion_oldest_sql')
        completion = source_function(COMMANDS, 'completion_sql_expr')
        for fragment in ('recipient=', 'stopped_session_sql'):
            if fragment not in pending or fragment not in oldest:
                raise AssertionError(
                    f'completion SQL source no longer matches: {fragment}')
        if 'receipt' in pending or 'receipt' in oldest:
            raise AssertionError('completion SQL source derives pending from a receipt')
        if 'ORDER BY seq LIMIT 1' not in oldest:
            raise AssertionError('oldest-pending source must use sequence order')
        if completion.count('completion_pending_sql(player)') != 2:
            raise AssertionError('completion SQL must read the pending count twice')
        if completion.count('completion_oldest_sql(player)') != 1:
            raise AssertionError('completion SQL must read the oldest row once')
        if '(recipient,seq,id)' not in cls.index or 'receipt' in cls.index:
            raise AssertionError('pending index must cover the recipient order without a receipt predicate')
        if 'DROP INDEX IF EXISTS messages_pending' not in COMMANDS.read_text():
            raise AssertionError('the obsolete receipt index must be dropped')
        if 'CREATE INDEX IF NOT EXISTS ' + INDEX_NAME not in cls.index:
            raise AssertionError('pending index is not the source index')

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
        rows = [('m%06d' % i, 'sender', 'root', 'task', 'x' * 200, None)
                for i in range(ROWS)]
        self.connection.executemany(
            'INSERT INTO messages(id,sender,recipient,kind,body,receipt) '
            'VALUES(?,?,?,?,?,?)', rows)
        self.connection.executemany(
            'INSERT INTO message_reads(attempt,message,recipient,native,identity) '
            'VALUES(?,?,?,?,?)',
            [('seed', 'm%06d' % i, 'root', '', 'seed')
             for i in range(ROWS - PENDING)])
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

    def tearDown(self):
        self.connection.close()

    def observe_sql(self):
        pending = ("(SELECT count(*) FROM messages WHERE recipient='root' "
                   "AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient) "
                   "AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session='root'))")
        oldest = ("(SELECT id FROM messages WHERE recipient='root' "
                  "AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient) "
                  "AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session='root') "
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
        amount = after - before if before is not None and after is not None else None
        return row[0] if row else None, plan, amount

    def test_terminal_pending_query_uses_the_recipient_index(self):
        db_inode = self.db.stat().st_ino
        before_row, before_plan, before_bytes = self.measure(self.observe_sql())
        self.assertIn('SCAN messages', before_plan)
        for statement in self.index.split(';'):
            if statement.strip():
                self.connection.execute(statement)
        self.connection.commit()
        self.assertEqual(self.db.stat().st_ino, db_inode)
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
            self.assertGreater(before_bytes, 10000000)
            self.assertLess(after_bytes, 2000000)
            self.assertGreater(before_bytes, after_bytes * 5)
        self.assertEqual(self.spool.stat().st_size, self.spool_bytes)
        self.assertEqual(self.spool.read_text(),
                         '\n'.join(self.frames) + '\n')
        messages = self.connection.execute(
            'SELECT count(*), min(id), max(id) FROM messages').fetchone()
        self.assertEqual(messages, (ROWS, 'm000000', 'm029999'))


if __name__ == '__main__':
    unittest.main()
