"""Check message-read lookup plans and reader completion on isolated databases."""
import ast
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3
import threading
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'bend2/src/coordinator/message-status.bend'
LEGACY = "CREATE TABLE message_reads(attempt TEXT NOT NULL,message TEXT NOT NULL,recipient TEXT NOT NULL,native TEXT NOT NULL,identity TEXT NOT NULL,handled TEXT,PRIMARY KEY(attempt,identity,message));"

def expression(name, values=None):
    text = SOURCE.read_text().split('def ' + name, 1)[1].split('\n', 1)[1].split('\ndef ', 1)[0]
    tokens = re.findall(r'"(?:[^"\\]|\\.)*"|\bmessage\b', text)
    return ''.join(ast.literal_eval(token) if token.startswith('"') else values[token] for token in tokens)

def projection_sql():
    expr = expression('projection(', {'message': "json_extract(j.value,'$.id')"})
    return "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT json_patch(j.value,json_object('nativeInputStatus'," + expr + ")) AS item FROM json_each(?) j ORDER BY CAST(j.key AS INTEGER));"

def seed(connection):
    connection.executescript(LEGACY)
    connection.executemany('INSERT INTO message_reads VALUES(?,?,?,?,?,?)', [
        (str(i), 'history-' + str(i), 'actor', 'native', 'identity', None) for i in range(2000)])
    connection.executemany('INSERT INTO message_reads VALUES(?,?,?,?,?,?)', [
        ('a', 'pending-0', 'actor', 'native-a', 'identity-a', None),
        ('b', 'pending-1', 'actor', 'native-b', 'identity-b', 'settled-b'),
        ('c', 'pending-1', 'actor', 'native-c', 'identity-c', None)])
    connection.commit()

def payload():
    return json.dumps([{'id': 'pending-' + str(i), 'body': 'complete body ' + str(i) + '\nUnicode: λ'} for i in range(20)])

class MessageReadIndex(unittest.TestCase):
    def test_schema_migrates_existing_history_and_repeats(self):
        with closing(sqlite3.connect(':memory:')) as db:
            seed(db)
            before = db.execute('SELECT * FROM message_reads ORDER BY rowid').fetchall()
            db.executescript(expression('schema('))
            db.executescript(expression('schema('))
            self.assertEqual(before, db.execute('SELECT * FROM message_reads ORDER BY rowid').fetchall())
            self.assertEqual(['message'], [row[2] for row in db.execute('PRAGMA index_info(message_reads_by_message)')])

    def test_complete_projection_and_attempt_custody_are_preserved(self):
        with closing(sqlite3.connect(':memory:')) as db:
            seed(db)
            before = db.execute(projection_sql(), (payload(),)).fetchone()[0]
            db.executescript(expression('schema('))
            after = db.execute(projection_sql(), (payload(),)).fetchone()[0]
            self.assertEqual(before, after)
            records = json.loads(after)
            self.assertEqual([row['body'] for row in json.loads(payload())], [row['body'] for row in records])
            self.assertEqual('incomplete', records[0]['nativeInputStatus']['handled'])
            self.assertEqual('recorded', records[1]['nativeInputStatus']['handled'])
            self.assertEqual(['native-b', 'native-c'], [row['native'] for row in records[1]['nativeInputStatus']['attempts']])
            self.assertEqual('unrecorded', records[2]['nativeInputStatus']['read'])

    def test_every_message_history_lookup_uses_the_message_index(self):
        with closing(sqlite3.connect(':memory:')) as db:
            seed(db)
            db.executescript(expression('schema('))
            plan = [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + projection_sql(), (payload(),))]
            lookups = [row for row in plan if row.startswith(('SCAN r', 'SEARCH r'))]
            self.assertEqual(5, len(lookups))
            self.assertTrue(all(row.startswith('SEARCH r USING') and 'message_reads_by_message' in row for row in lookups), plan)

    def test_reader_finishes_and_writer_commits_without_cancelling_either(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'state.db')
            db = sqlite3.connect(path)
            try:
                seed(db)
                db.executescript(expression('schema(') + 'CREATE TABLE writer_result(value TEXT);')
            finally:
                db.close()
            reader_started, writer_reserved, reader_closed = [threading.Event() for _ in range(3)]
            errors = []
            outputs = []
            def writer():
                connection = sqlite3.connect(path, timeout=0, isolation_level=None)
                try:
                    reader_started.wait()
                    connection.execute('BEGIN IMMEDIATE')
                    connection.execute("INSERT INTO writer_result VALUES('committed')")
                    writer_reserved.set()
                    while True:
                        try:
                            connection.execute('COMMIT')
                            break
                        except sqlite3.OperationalError as error:
                            if 'locked' not in str(error):
                                raise
                            reader_closed.wait()
                except BaseException as error:
                    errors.append(error)
                    writer_reserved.set()
                finally:
                    connection.close()
            thread = threading.Thread(target=writer)
            thread.start()
            connection = sqlite3.connect(path)
            entered = [False]
            def progress():
                if not entered[0]:
                    entered[0] = True
                    reader_started.set()
                    writer_reserved.wait()
                return 0
            try:
                connection.set_progress_handler(progress, 100)
                outputs.append(connection.execute(projection_sql(), (payload(),)).fetchone()[0])
            finally:
                connection.close()
                reader_started.set()
                reader_closed.set()
                thread.join()
            self.assertFalse(errors, errors)
            self.assertEqual(20, len(json.loads(outputs[0])))
            with closing(sqlite3.connect(path)) as check:
                self.assertEqual([('committed',)], check.execute('SELECT value FROM writer_result').fetchall())

if __name__ == '__main__':
    unittest.main()
