"""Qualify native compact reads using fresh endpoint-free fixtures.

These fixtures exercise read semantics; they do not qualify team construction
or an agent's discovery of installed product surfaces. BATON2_INDEX_EXE and
BATON2_INDEX_MCP can select a staged artifact. Evidence directories are retained.
"""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_INDEX_EXE', ROOT / '.scratch/bend2/baton2'))
MCP = Path(os.environ.get('BATON2_INDEX_MCP', ROOT / 'bend2/scripts/mcp-conductor.mjs'))


class ControlIndex(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix='baton-control-index-'))
        self.db = self.directory / 'fixture.db'
        self.calls = self.directory / 'calls.jsonl'
        self.call('attach', 'root', 'codex', '', '')
        self.call('role', 'root', 'principal-conductor')
        self.bodies = {
            'pending-report': ('REPORT λ 日本語\n' * 4096) + 'retained-end',
            'other-report': 'other author',
            'task': '--help\nopaque task',
            'acknowledged-report': 'complete after acknowledgment',
            'stopped-task': 'retained task for stopped Player',
        }
        # Fresh fixture rows include incomplete setup. No registered endpoint
        # can launch; no live database is copied or modified by this test.
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('PRAGMA foreign_keys=ON')
            for ident, parent in [('associate', 'root'), ('nested', 'associate'),
                                  ('worker', 'nested'), ('stopped', 'nested'),
                                  ('other-root', None), ('external', 'other-root'),
                                  ('outside-child', 'external')]:
                db.execute('INSERT INTO sessions(id,parent,harness,workspace,branch) VALUES(?,?,?,?,?)',
                           (ident, parent, 'codex', '/fixture/' + ident, 'fixture/' + ident))
            db.executemany('INSERT INTO session_roles(session,role) VALUES(?,?)',
                           [('associate', 'conductor'), ('nested', 'conductor'),
                            ('other-root', 'conductor'), ('external', 'conductor')])
            db.execute("INSERT INTO ensembles VALUES('team','associate','tight')")
            db.execute("INSERT INTO ensembles VALUES('empty','root','loose')")
            db.executemany("INSERT INTO ensemble_members VALUES('team',?)",
                           [('worker',), ('stopped',), ('external',)])
            db.execute("INSERT INTO sections VALUES('team','review','independent review')")
            db.execute("INSERT INTO sections VALUES('empty','unfilled','unfilled capability')")
            db.executemany("INSERT INTO section_members VALUES('team','review',?)",
                           [('worker',), ('external',)])
            for ident, sender, recipient, kind, receipt in [
                    ('pending-report', 'worker', 'associate', 'report', None),
                    ('other-report', 'external', 'associate', 'report', None),
                    ('task', 'root', 'worker', 'task', None),
                    ('acknowledged-report', 'worker', 'associate', 'report', 'accepted-not-reviewed'),
                    ('stopped-task', 'root', 'stopped', 'task', None)]:
                db.execute('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)',
                           (ident, sender, recipient, kind, self.bodies[ident], receipt))
            db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('stopped','stop-id','opaque stop reason','stopped')")
            db.commit()

    def call(self, *args, expected=0):
        result = subprocess.run([str(EXE), str(self.db), *args], capture_output=True, text=True)
        self.last_output_bytes = len(result.stdout.encode())
        with self.calls.open('a') as log:
            log.write(json.dumps({'args': args, 'code': result.returncode,
                                  'stdoutBytes': len(result.stdout.encode()),
                                  'stderr': result.stderr}) + '\n')
        self.assertEqual(result.returncode, expected, result.stderr or result.stdout)
        return json.loads(result.stdout) if expected == 0 else result

    def retained(self):
        with closing(sqlite3.connect(self.db)) as db:
            return db.execute('SELECT seq,id,sender,recipient,kind,body,receipt FROM messages ORDER BY seq').fetchall()

    def index(self, *args):
        return self.call('pending', '--index', *args)

    def test_selection_preserves_full_body_and_receipt(self):
        before = self.retained()
        selected = self.index('--recipient', 'associate', '--sender', 'worker', '--kind', 'report')
        self.assertEqual([row['id'] for row in selected], ['pending-report'])
        row = selected[0]
        self.assertEqual((row['sender'], row['recipient'], row['kind']), ('worker', 'associate', 'report'))
        self.assertEqual(row['seq'], before[0][0])
        self.assertEqual(row['bodyBytes'], len(self.bodies['pending-report'].encode()))
        self.assertEqual(row['receiptState'], 'unacknowledged')
        self.assertEqual(selected, self.call('inbox', 'associate', '--index', '--sender', 'worker', '--kind', 'report'))
        self.assertNotIn('body', row)
        self.assertNotIn('receipt', row)
        self.assertEqual(self.index('--recipient', 'associate', '--kind', 'question'), [])
        self.assertEqual(self.index('--sender', "' OR 1=1 --"), [])
        acked = self.index('--recipient', 'associate', '--state', 'acknowledged')
        self.assertEqual([item['id'] for item in acked], ['acknowledged-report'])
        self.assertEqual(acked[0]['receiptState'], 'acknowledged')
        self.assertEqual(self.retained(), before, 'Index reads mutated retained messages')
        for ident, body in self.bodies.items():
            self.assertEqual(self.call('delivery', ident)['body'], body)
        self.call('ack', 'pending-report', 'associate', 'delivery accepted')
        self.assertEqual(self.index('--recipient', 'associate', '--sender', 'worker'), [])
        all_rows = self.index('--recipient', 'associate', '--sender', 'worker', '--state', 'all')
        self.assertEqual([item['id'] for item in all_rows], ['pending-report', 'acknowledged-report'])
        self.assertEqual(self.call('delivery', 'pending-report')['body'], self.bodies['pending-report'])

    def test_stopped_input_is_pending_and_not_accepted(self):
        rows = self.index('--recipient', 'stopped')
        self.assertEqual([row['id'] for row in rows], ['stopped-task'])
        self.assertEqual(rows[0]['receiptState'], 'unacknowledged')
        self.assertEqual(rows[0]['executionDisposition'], 'stopped')
        self.assertEqual(rows[0]['stopId'], 'stop-id')
        self.assertIsNone(self.call('delivery', 'stopped-task')['receipt'])

    def test_exact_empty_selectors_and_empty_receipt(self):
        body = 'UTF-8 λ\0retained after NUL'
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('PRAGMA encoding').fetchone()[0], 'UTF-8')
            db.execute("INSERT INTO sessions(id,harness) VALUES('','fixture')")
            db.execute('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)',
                       ('empty-fields', '', '', '', body, ''))
            db.commit()
        self.assertEqual(self.index('--recipient', '', '--state', 'pending'), [])
        selected = self.index('--kind', '', '--state', 'all', '--sender', '', '--recipient', '')
        self.assertEqual([row['id'] for row in selected], ['empty-fields'])
        self.assertEqual(selected[0]['receiptState'], 'acknowledged')
        self.assertEqual(selected[0]['bodyBytes'], len(body.encode()))
        self.assertEqual(self.call('delivery', 'empty-fields')['body'], body)
        self.assertEqual(self.index('--sender', '%'), [])
        self.assertEqual(self.index('--kind', '_'), [])

    def test_invalid_options_and_missing_database_do_not_write(self):
        before = self.retained()
        for args in [('pending', '--index', '--sender'),
                     ('pending', '--index', '--state', 'invalid'),
                     ('pending', '--index', '--sender', 'worker', '--sender', 'external'),
                     ('inbox', 'associate', '--sender', 'worker'),
                     ('orchestra', '--index', '--for')]:
            with self.subTest(args=args):
                self.call(*args, expected=2)
        self.assertEqual(self.retained(), before)
        missing = self.directory / 'must-not-create.db'
        for args in [('pending', '--index'), ('pending', '--index', '--pretty'),
                     ('orchestra', '--index'), ('orchestra', '--index', '--pretty')]:
            result = subprocess.run([str(EXE), str(missing), *args], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(missing.exists(), 'Index inspection created a database')

    def test_structural_focus_keeps_cross_parent_references(self):
        before = self.retained()
        view = self.call('orchestra', '--index', '--for', 'associate')
        players = {row['id']: row for row in view['players']}
        self.assertTrue({'root', 'associate', 'nested', 'worker', 'stopped', 'external'} <= players.keys())
        self.assertNotIn('outside-child', players)
        self.assertEqual(players['external']['parent'], 'other-root')
        self.assertEqual(players['nested']['parent'], 'associate')
        self.assertTrue(players['external']['reference'])
        ensembles = {row['id']: row for row in view['ensembles']}
        self.assertEqual(ensembles['team']['owner'], 'associate')
        section = next(row for row in ensembles['team']['sections'] if row['id'] == 'review')
        self.assertEqual(set(section['members']), {'worker', 'external'})
        self.assertIn('empty', ensembles)
        text = json.dumps(view, ensure_ascii=False)
        for marker in ('REPORT λ', 'retained-end', 'opaque stop reason', 'latestReport"'):
            self.assertNotIn(marker, text)
        self.assertEqual(self.retained(), before)
        self.assertEqual(self.call('orchestra', '--index', '--for', 'associate', '--pretty'), view)

    def test_index_reads_under_writer_reservation_preserve_database(self):
        with closing(sqlite3.connect(self.db)) as db:
            before = list(db.iterdump())
            db.execute('BEGIN IMMEDIATE')
            try:
                for args in [('inbox', 'associate', '--index'),
                             ('pending', '--index'),
                             ('orchestra', '--index', '--for', 'associate')]:
                    plain = None
                    for pretty in (False, True):
                        command = [*args, *(['--pretty'] if pretty else [])]
                        with self.subTest(command=command):
                            result = subprocess.run(
                                [str(EXE), str(self.db), *command],
                                capture_output=True, text=True, timeout=10)
                            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                            value = json.loads(result.stdout)
                            if pretty:
                                self.assertEqual(value, plain)
                            else:
                                plain = value
            finally:
                db.rollback()
            self.assertEqual(list(db.iterdump()), before)

    def test_structural_index_preserves_native_status_and_observed_assignment(self):
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("UPDATE sessions SET model=?,effort=?,observed_harness=?,"
                       "observed_model=?,observed_effort=? WHERE id='worker'",
                       ('recorded-model', 'high', 'codex', 'observed-model', 'medium'))
            db.execute('INSERT INTO executions(session,id,mode,directory,phase,status) '
                       'VALUES(?,?,?,?,?,?)',
                       ('worker', 'native-attempt', 'receive', '/fixture/execution', 'exited', '17'))
            db.commit()
        for args in [('orchestra', '--index'),
                     ('orchestra', '--index', '--for', 'associate', '--pretty')]:
            with self.subTest(args=args):
                view = self.call(*args)
                worker = next(row for row in view['players'] if row['id'] == 'worker')
                self.assertEqual((worker['model'], worker['effort']), ('recorded-model', 'high'))
                self.assertEqual((worker['observedModel'], worker['observedEffort']),
                                 ('observed-model', 'medium'))
                self.assertEqual(worker['execution']['attempt'], 'native-attempt')
                self.assertEqual(worker['execution']['mode'], 'receive')
                self.assertEqual(worker['execution']['phase'], 'exited')
                self.assertEqual(worker['execution']['status'], '17')

    def test_uninitialized_database_is_not_migrated(self):
        uninitialized = self.directory / 'uninitialized.db'
        with closing(sqlite3.connect(uninitialized)) as db:
            db.execute('CREATE TABLE unrelated(value TEXT)')
            db.execute("INSERT INTO unrelated VALUES('retain this database')")
            db.commit()
            before = list(db.iterdump())
        for args in [('pending', '--index'), ('pending', '--index', '--pretty'),
                     ('orchestra', '--index'), ('orchestra', '--index', '--pretty')]:
            with self.subTest(args=args):
                result = subprocess.run([str(EXE), str(uninitialized), *args],
                                        capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
        with closing(sqlite3.connect(uninitialized)) as db:
            self.assertEqual(list(db.iterdump()), before)

    def test_mcp_has_same_native_selection(self):
        args = {'recipient': 'associate', 'index': True, 'sender': 'worker', 'kind': 'report', 'state': 'all'}
        requests = [
            {'jsonrpc': '2.0', 'id': 'init', 'method': 'initialize', 'params': {}},
            {'jsonrpc': '2.0', 'id': 'tools', 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 'index', 'method': 'tools/call',
             'params': {'name': 'baton2_inbox', 'arguments': args}},
            {'jsonrpc': '2.0', 'id': 'view', 'method': 'tools/call',
             'params': {'name': 'baton2_orchestra', 'arguments': {'index': True, 'session': 'associate'}}},
        ]
        before = self.retained()
        result = subprocess.run([os.environ.get('NODE', 'node'), str(MCP), str(self.db), str(EXE),
                                 '--session', 'associate'], capture_output=True, text=True,
                                input=''.join(json.dumps(item) + '\n' for item in requests))
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = {row['id']: row for row in map(json.loads, result.stdout.splitlines()) if 'id' in row}
        tools = {item['name']: item for item in replies['tools']['result']['tools']}
        self.assertIn('index', tools['baton2_inbox']['inputSchema']['properties'])
        self.assertIn('baton2_delivery', tools)
        for name in ('index', 'view'):
            self.assertNotIn('error', replies[name])
            self.assertFalse(replies[name]['result'].get('isError'))
        index = json.loads(replies['index']['result']['content'][0]['text'])
        view = json.loads(replies['view']['result']['content'][0]['text'])
        self.assertEqual(index, self.index('--recipient', 'associate', '--sender', 'worker',
                                           '--kind', 'report', '--state', 'all'))
        self.assertEqual(view, self.call('orchestra', '--index', '--for', 'associate'))
        self.assertEqual(self.retained(), before)

    def test_index_size_tracks_metadata_and_read_is_pure(self):
        before = self.retained()
        legacy = self.call('inbox', 'associate')
        legacy_bytes = self.last_output_bytes
        index = self.index('--recipient', 'associate')
        self.assertEqual([row['id'] for row in legacy], [row['id'] for row in index])
        metric = {'legacyBytes': legacy_bytes, 'indexBytes': self.last_output_bytes,
                  'binary': str(EXE), 'binarySha256': hashlib.sha256(EXE.read_bytes()).hexdigest()}
        self.assertLess(metric['indexBytes'], metric['legacyBytes'])
        (self.directory / 'measurement.json').write_text(json.dumps(metric, indent=2) + '\n')
        self.assertEqual(self.retained(), before)


if __name__ == '__main__':
    unittest.main()
