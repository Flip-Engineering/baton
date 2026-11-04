"""Exercise bulk read SQL from the maintained Bend definitions on isolated state."""
import ast
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[2]
COORD = ROOT / 'bend2/src/coordinator'
TOKEN = re.compile(r'\s*("(?:[^"\\]|\\.)*"|\+\+|[\w.]+|[(),])')


def definition(name, filename='message-status.bend'):
    source = (COORD / filename).read_text()
    return source.split('def ' + name + '(', 1)[1].split('\ndef ', 1)[0]


class Expression:
    """Evaluate the pure string expressions used to construct these SQL calls."""
    def __init__(self, text, values):
        self.tokens = []
        self.values = values
        text = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#')).strip()
        while text:
            match = TOKEN.match(text)
            if not match:
                raise AssertionError('Unsupported SQL expression: ' + text[:80])
            self.tokens.append(match.group(1))
            text = text[match.end():].lstrip()
        self.at = 0

    def take(self):
        token = self.tokens[self.at]
        self.at += 1
        return token

    def expression(self):
        value = self.atom()
        while self.at < len(self.tokens) and self.tokens[self.at] == '++':
            self.take()
            value += self.atom()
        return value

    def atom(self):
        token = self.take()
        if token.startswith('"'):
            return ast.literal_eval(token)
        if self.at == len(self.tokens) or self.tokens[self.at] != '(':
            return 'String' if token == 'String' else self.values[token]
        self.take()
        args = []
        while self.tokens[self.at] != ')':
            args.append(self.expression())
            if self.tokens[self.at] != ',':
                break
            self.take()
        assert self.take() == ')'
        if token in ('q', 'C.q', 'Req.sql_quote'):
            return "'" + args[0].replace("'", "''") + "'"
        if token == 'Bool.pick':
            return args[2] if args[1] else args[3]
        return render(token.removeprefix('Status.'), *args)

    def result(self):
        value = self.expression()
        assert self.at == len(self.tokens), self.tokens[self.at:]
        return value


def render(name, *args):
    header, body = definition(name).split('\n', 1)
    parameters = re.findall(r'\+?(\w+):', header.split(') ->', 1)[0])
    return Expression(body, dict(zip(parameters, args, strict=True))).result()


def mcp_sql(saved):
    body = definition('mcp_record_scope', 'agent-input.bend')
    start = body.index('"BEGIN IMMEDIATE;INSERT INTO message_reads')
    end = body.index('\n      IO.pure(Unit', start)
    expression = body[start:end].strip()
    assert expression.endswith('))')
    current = ("EXISTS(SELECT 1 FROM sessions connected WHERE connected.id='worker' "
               "AND connected.native='native-1' AND connected.endpoint='route-1')")
    return Expression(expression[:-2], {'session': 'worker', 'native': 'native-1',
                       'attempt': 'attempt-1', 'identity': 'identity-1',
                       'saved': saved, 'read': True, 'current': current}).result()


def seed(db):
    db.executescript('''
        CREATE TABLE sessions(id TEXT PRIMARY KEY,native TEXT,harness TEXT,endpoint TEXT);
        CREATE TABLE messages(seq INTEGER PRIMARY KEY,id TEXT UNIQUE,sender TEXT,
                              recipient TEXT,kind TEXT,body TEXT);
        CREATE INDEX messages_recipient_kind_seq ON messages(recipient,kind,seq);
        CREATE INDEX messages_recipient_seq ON messages(recipient,seq);
        CREATE TABLE executions(session TEXT PRIMARY KEY,id TEXT,directory TEXT,phase TEXT);
        CREATE TABLE session_stops(session TEXT PRIMARY KEY);
        CREATE TABLE wake_claims(session TEXT PRIMARY KEY);
        CREATE TABLE message_reads(attempt TEXT,message TEXT,recipient TEXT,native TEXT,
                                  identity TEXT,PRIMARY KEY(attempt,identity,message));
        CREATE INDEX message_reads_message ON message_reads(message,recipient);
        INSERT INTO sessions VALUES('worker','native-1','codex','route-1'),
                                   ('other','native-2','codex','route-2');
        INSERT INTO executions VALUES('worker','attempt-1','/attempt','running');
        INSERT INTO wake_claims VALUES('worker');
    ''')
    rows = [(f'message-{i}', 'root', 'worker', 'guidance', f'Complete body {i}: λ\n' + 'details ' * 64)
            for i in range(2000)]
    rows += [('foreign', 'root', 'other', 'guidance', 'foreign body')]
    db.executemany('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)', rows)
    db.commit()
    messages = [{'id': row[0], 'recipient': row[2], 'body': row[4]} for row in rows[:1000]]
    invalid = [{'id': 'foreign', 'recipient': 'other', 'body': 'foreign body'},
               {'id': 'message-1000', 'recipient': 'worker', 'body': 'changed body'},
               {'id': 'message-1001', 'recipient': 'other', 'body': rows[1001][4]},
               {'id': 'missing', 'recipient': 'worker', 'body': 'missing'}]
    payload = [({'status': 'found', 'delivery': row} if i % 2 else row)
               for i, row in enumerate(messages + invalid)]
    return messages, json.dumps(payload, ensure_ascii=False)


def statements(saved):
    return {
        'cli': render('cli_read_sql', 'worker', saved),
        'native': render('record_sql', 'worker', '/attempt', 'attempt-1', 'native-1',
                         'identity-1', saved, True),
        'codex': render('codex_record_sql', 'worker', 'native-1', 'turn-1', saved, True),
        'mcp': mcp_sql(saved),
    }


class BulkReadWritePlan(unittest.TestCase):
    def assert_message_lookup(self, db, sql):
        insert = sql.removeprefix('BEGIN IMMEDIATE;').split(';DELETE FROM wake_claims', 1)[0]
        plan = [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + insert)]
        message_steps = [row for row in plan if re.match(r'(SCAN|SEARCH) m\b', row)]
        self.assertTrue(message_steps, plan)
        self.assertTrue(all(row.startswith('SEARCH m USING') and '(id=?)' in row
                            for row in message_steps), plan)

    def test_complete_bulk_reads_use_message_keys_and_preserve_exact_rows(self):
        with closing(sqlite3.connect(':memory:')) as db:
            messages, saved = seed(db)
            for name, sql in statements(saved).items():
                with self.subTest(path=name):
                    self.assert_message_lookup(db, sql)
                    db.executescript(sql)
                    rows = db.execute('SELECT message,recipient,native FROM message_reads ORDER BY message').fetchall()
                    self.assertEqual(sorted((row['id'], 'worker', 'native-1') for row in messages), rows)
                    db.executescript(sql)
                    self.assertEqual(len(messages), db.execute('SELECT count(*) FROM message_reads').fetchone()[0])
                    db.execute('DELETE FROM message_reads')
                    db.commit()

    def test_owned_read_custody_and_stop_checks_remain_effective(self):
        with closing(sqlite3.connect(':memory:')) as db:
            _, saved = seed(db)
            for change in ["UPDATE sessions SET native='new-native' WHERE id='worker'",
                           "INSERT INTO session_stops VALUES('worker')"]:
                with self.subTest(change=change):
                    db.execute(change)
                    db.commit()
                    for name, sql in statements(saved).items():
                        if name == 'cli':
                            continue
                        db.executescript(sql)
                        self.assertEqual([], db.execute('SELECT message FROM message_reads').fetchall(), name)
                    db.executescript("UPDATE sessions SET native='native-1';DELETE FROM session_stops;")

    def test_prompt_read_selection_uses_keys_and_checks_complete_body(self):
        with closing(sqlite3.connect(':memory:')) as db:
            messages, _ = seed(db)
            chosen = messages[:4]
            prompt = '\n\n'.join('Message (guidance) from root [id: ' + row['id'] + ']:\n' + row['body']
                                  for row in chosen[:3])
            payload = json.dumps({'inputMessages': [row['id'] for row in chosen],
                                  'session': 'worker', 'attempt': 'attempt-1',
                                  'direct': False, 'cursor': 2000, 'prompt': prompt})
            sql = render('prompt_record_sql', 'worker', 'attempt-1', 'native-1', 'identity-1', payload)
            self.assert_message_lookup(db, sql)
            db.executescript(sql)
            self.assertEqual([(row['id'],) for row in chosen[:3]],
                             db.execute('SELECT message FROM message_reads ORDER BY message').fetchall())


if __name__ == '__main__':
    unittest.main()
