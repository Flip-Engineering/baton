"""Native REPL context transfer, immutable versions and recipient authority."""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_REPL_EXE', ROOT / '.scratch/bend2/baton2'))


class ReplContext(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.fail('Build the focused REPL entry on the homelab before this acceptance.')
        self.temp = tempfile.TemporaryDirectory(prefix='baton-repl-context-')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.env = dict(os.environ, XDG_RUNTIME_DIR=str(self.directory))
        self.owner = subprocess.Popen([str(EXE), '--instance-owner', str(self.db)],
                                      env=self.env, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE)
        for actor in ('author', 'recipient', 'outsider'):
            self.invoke('attach', actor, 'fixture', '', '')
        with sqlite3.connect(self.db) as connection:
            connection.execute('UPDATE sessions SET workspace=?', (str(self.directory),))
            connection.execute("UPDATE sessions SET parent='author' WHERE id='recipient'")
        # Each operation below starts a separate native process against the same database.

    def tearDown(self):
        result = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                env=self.env, capture_output=True, timeout=30)
        self.owner.communicate(timeout=30)
        self.temp.cleanup()
        self.assertEqual(result.returncode, 0, result.stderr)

    def invoke(self, *args, success=True):
        result = subprocess.run([str(EXE), str(self.db), *args], cwd=self.directory,
                                env=self.env, capture_output=True, text=True, timeout=180)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def repl(self, actor, *args, success=True):
        return self.invoke('as', actor, 'repl', *args, success=success)

    def define(self, value=41):
        result = self.repl('author', 'define', f'def context_value() -> U32:\n  {value}\n',
                           '--label', 'context')
        return json.loads(result.stdout)['cells'][0]['reference']

    def cite(self, cell):
        return json.loads(self.repl('author', 'cite', '--cell', cell).stdout)

    def share(self, cell):
        result = self.repl('author', 'share', '--cell', cell, '--to', 'recipient')
        return json.loads(result.stdout)

    def query(self, sql, values=()):
        with sqlite3.connect(self.db) as connection:
            return connection.execute(sql, values).fetchall()

    def resolve(self, actor, citation, success=True):
        result = self.repl(actor, 'resolve', '--cell', citation, success=success)
        if not success:
            return result
        # Recipient resolution first prints its complete owned citation message.
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_shared_version_survives_rebinding_restart_and_import(self):
        first = self.define()
        citation = self.cite(first)
        message = self.share(first)
        self.assertEqual(json.loads(message['body']), citation)
        self.assertNotIn('source', citation)
        self.assertNotIn('attempts', citation)
        self.assertNotIn(str(self.directory), message['body'])
        self.assertEqual(self.query('SELECT message,cell FROM repl_shares'), [(message['id'], first)])
        second = self.define(42)
        self.assertNotEqual(self.cite(second)['citation'], citation['citation'])
        resolved = self.resolve('recipient', citation['citation'])
        self.assertEqual(resolved['reference'], first)
        self.assertIn('41', resolved['source'])
        self.assertEqual(resolved['attempts'][0]['waitStatus'], 'exit 0')
        self.assertNotIn('directory', resolved['attempts'][0])
        self.assertEqual(self.resolve('author', first)['source'], resolved['source'])
        self.repl('recipient', 'import', message['id'])
        result = self.repl('recipient', 'eval', 'context_value()')
        cell = json.loads(result.stdout)['cells'][0]
        self.assertEqual(json.loads(cell['attempts'][0]['stdout'])['value'], '41')
        self.assertIn('42', self.resolve('author', second)['source'])

    def test_citation_and_forged_message_cannot_grant_access(self):
        cell = self.define()
        citation = self.cite(cell)
        self.resolve('recipient', citation['citation'], success=False)
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES("
                               "'forged','author','recipient','bend-repl',?)", (json.dumps(citation),))
        self.resolve('recipient', cell, success=False)
        self.repl('recipient', 'import', 'forged', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM repl_shares'), [(0,)])
        self.share(cell)
        self.resolve('outsider', cell, success=False)
        self.resolve('outsider', citation['citation'], success=False)

    def test_pure_context_value_is_resolved_completely(self):
        context = '{"topic":"compiler","facts":["λ", "complete context"]}'
        result = self.repl('author', 'eval', json.dumps(context, ensure_ascii=False),
                           '--label', 'task-context')
        cell = json.loads(result.stdout)['cells'][0]
        self.share(cell['reference'])
        resolved = self.resolve('recipient', self.cite(cell['reference'])['citation'])
        outcome = json.loads(resolved['attempts'][0]['stdout'])
        self.assertEqual(outcome['type'], 'String')
        self.assertEqual(json.loads(outcome['value']), context)
        self.assertEqual(resolved['source'], cell['source'])

    def test_stopped_actors_cannot_resolve_import_cite_or_recover(self):
        cell = self.define()
        message = self.share(cell)
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES("
                               "'recipient','stop-recipient','fixture','completed')")
        self.resolve('recipient', cell, success=False)
        self.repl('recipient', 'import', message['id'], success=False)
        before = self.query('SELECT * FROM repl_attempts')
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES("
                               "'author','stop-author','fixture','completed')")
        self.repl('author', 'cite', '--cell', cell, success=False)
        self.repl('author', 'recover', '--cell', cell, success=False)
        self.assertEqual(self.query('SELECT * FROM repl_attempts'), before)

    def test_native_cell_requires_a_successful_retained_native_outcome(self):
        cell = self.define()
        # Represent the custody boundary after successful native compilation.
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE repl_attempts SET stdout=? WHERE cell=?",
                               (json.dumps({'kind': 'native', 'type': 'IO(Unit)'}), cell))
        self.repl('author', 'cite', '--cell', cell, success=False)
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT INTO repl_attempts(cell,stage,directory,argv,input,"
                               "stdout,stderr,wait_status,cause) VALUES(?, 'native', ?,"
                               "'[]','','native output','failure','exit 1','')",
                               (cell, str(self.directory / 'native-fixture')))
        self.repl('author', 'share', '--cell', cell, '--to', 'recipient', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM repl_shares'), [(0,)])
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE repl_attempts SET wait_status='exit 0',stderr='' "
                               "WHERE cell=? AND stage='native'", (cell,))
        self.share(cell)
        resolved = self.resolve('recipient', cell)
        native = next(row for row in resolved['attempts'] if row['stage'] == 'native')
        self.assertEqual(native['stdout'], 'native output')
        self.assertEqual(native['waitStatus'], 'exit 0')

    def test_failed_and_unfinished_cells_are_not_citable(self):
        self.repl('author', 'eval', 'missing_context_value()', success=False)
        self.repl('author', 'cite', success=False)
        self.repl('author', 'share', '--to', 'recipient', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM repl_shares'), [(0,)])
        # A retained compiler attempt with no outcome represents interrupted work.
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE repl_attempts SET wait_status=NULL, cause=NULL")
        self.repl('author', 'cite', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM messages'), [(0,)])

    def test_denied_route_and_stopped_recipient_have_no_message_or_grant(self):
        cell = self.define()
        self.repl('author', 'share', '--cell', cell, '--to', 'outsider', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM messages'), [(0,)])
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES("
                               "'recipient','stop-fixture','fixture','completed')")
        self.repl('author', 'share', '--cell', cell, '--to', 'recipient', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM messages'), [(0,)])
        self.assertEqual(self.query('SELECT count(*) FROM repl_shares'), [(0,)])

    def test_failed_grant_persistence_rolls_back_message(self):
        cell = self.define()
        with sqlite3.connect(self.db) as connection:
            connection.execute("CREATE TRIGGER reject_grant BEFORE INSERT ON repl_shares "
                               "BEGIN SELECT RAISE(ABORT,'grant fixture'); END")
        self.repl('author', 'share', '--cell', cell, '--to', 'recipient', success=False)
        self.assertEqual(self.query('SELECT count(*) FROM messages'), [(0,)])
        self.assertEqual(self.query('SELECT count(*) FROM repl_shares'), [(0,)])


if __name__ == '__main__':
    unittest.main()
