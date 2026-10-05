"""Qualify native compact reads using fresh endpoint-free fixtures.

These fixtures exercise read semantics; they do not qualify team construction
or an agent's discovery of installed product surfaces. BATON2_INDEX_EXE and
BATON2_INDEX_MCP can select a staged artifact. Evidence directories are retained.
"""
from contextlib import closing
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import threading
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

    def test_reference_navigation_preserves_literal_argv_through_native_and_mcp(self):
        references = ['reference with spaces', 'reference\'s "$HOME"; $(printf literal)']
        children = {subject: subject + ' child' for subject in references}
        with closing(sqlite3.connect(self.db)) as db:
            for subject, child in children.items():
                db.executemany('INSERT INTO sessions(id,parent,harness) VALUES(?,?,?)',
                               [(subject, 'other-root', 'fixture'), (child, subject, 'fixture')])
                db.execute("INSERT INTO ensemble_members VALUES('team',?)", (subject,))
            db.commit()
        retained = self.retained()

        def mcp_view(subject, pretty):
            requests = [
                {'jsonrpc': '2.0', 'id': 'init', 'method': 'initialize', 'params': {}},
                {'jsonrpc': '2.0', 'id': 'view', 'method': 'tools/call',
                 'params': {'name': 'baton2_orchestra',
                            'arguments': {'index': True, 'session': subject, 'pretty': pretty}}},
            ]
            result = subprocess.run(
                [os.environ.get('NODE', 'node'), str(MCP), str(self.db), str(EXE),
                 '--session', 'associate'], capture_output=True, text=True,
                input=''.join(json.dumps(item) + '\n' for item in requests))
            self.assertEqual(result.returncode, 0, result.stderr)
            replies = {row['id']: row for row in map(json.loads, result.stdout.splitlines())}
            self.assertNotIn('error', replies['view'])
            self.assertFalse(replies['view']['result'].get('isError'))
            return json.loads(replies['view']['result']['content'][0]['text'])

        for pretty in (False, True):
            suffix = ['--pretty'] if pretty else []
            native = self.call('orchestra', '--index', '--for', 'associate', *suffix)
            mcp = mcp_view('associate', pretty)
            self.assertEqual(mcp, native)
            for surface, view in [('native', native), ('mcp', mcp)]:
                initial_ids = {row['id'] for row in view['players']}
                self.assertTrue(set(references) <= initial_ids)
                self.assertTrue(set(children.values()).isdisjoint(initial_ids))
                for subject in references:
                    with self.subTest(pretty=pretty, surface=surface, subject=subject):
                        reference = next(row for row in view['limitations'] if row['id'] == subject)
                        self.assertEqual(reference['next'], ['orchestra', '--index', '--for', subject])
                        # call passes the returned arguments directly to subprocess.run.
                        followed = self.call(*reference['next'], *suffix)
                        self.assertEqual(followed['subject'], subject)
                        self.assertEqual({row['id'] for row in followed['players']},
                                         {'other-root', 'associate', 'worker', 'stopped', 'external',
                                          children[subject], *references})
                        actors = {row['id']: row for row in followed['players']}
                        self.assertFalse(actors[subject]['reference'])
                        self.assertEqual(actors[children[subject]]['parent'], subject)
                        self.assertEqual({row['id'] for row in followed['ensembles']}, {'team'})
                        team = followed['ensembles'][0]
                        self.assertEqual(team['owner'], 'associate')
                        self.assertEqual(set(team['members']), {'worker', 'stopped', 'external', *references})
                        self.assertEqual(mcp_view(subject, pretty), followed)
        self.assertEqual(self.retained(), retained)

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

    def test_index_reads_from_read_only_database_and_directory(self):
        before = self.db.read_bytes()
        database_mode = self.db.stat().st_mode & 0o777
        directory_mode = self.directory.stat().st_mode & 0o777
        self.db.chmod(0o444)
        self.directory.chmod(0o555)
        try:
            if os.access(self.db, os.W_OK) or os.access(self.directory, os.W_OK):
                self.skipTest('Current privileges bypass fixture read-only permissions')
            for args in [('inbox', 'associate', '--index'),
                         ('pending', '--index'), ('orchestra', '--index')]:
                for pretty in (False, True):
                    command = [*args, *(['--pretty'] if pretty else [])]
                    with self.subTest(command=command):
                        result = subprocess.run([str(EXE), str(self.db), *command],
                                                capture_output=True, text=True, timeout=10)
                        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                        value = json.loads(result.stdout)
                        if args[0] == 'orchestra':
                            self.assertIn('worker', {row['id'] for row in value['players']})
                        else:
                            self.assertIn('pending-report', {row['id'] for row in value})
            self.assertEqual(self.db.read_bytes(), before)
        finally:
            self.directory.chmod(directory_mode)
            self.db.chmod(database_mode)

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
        for text in (replies['init']['result']['instructions'],
                     tools['baton2_orchestra']['description']):
            self.assertIn('inputRead argv', text)
            self.assertIn('pendingCount excludes stopped execution inputs', text)
            self.assertIn('unacknowledgedCount includes every NULL receipt', text)
            self.assertIn('baton2_inbox', text)
            self.assertIn('state:all', text)
        for name in ('index', 'view'):
            self.assertNotIn('error', replies[name])
            self.assertFalse(replies[name]['result'].get('isError'))
        index = json.loads(replies['index']['result']['content'][0]['text'])
        view = json.loads(replies['view']['result']['content'][0]['text'])
        self.assertEqual(index, self.index('--recipient', 'associate', '--sender', 'worker',
                                           '--kind', 'report', '--state', 'all'))
        self.assertEqual(view, self.call('orchestra', '--index', '--for', 'associate'))
        self.assertEqual(self.retained(), before)

    def test_utf16_compact_reads_refuse_and_full_reader_preserves_body(self):
        body = 'REPORT λ 日本語\0tail'
        with closing(sqlite3.connect(self.db)) as db:
            schema_and_rows = '\n'.join(db.iterdump())
        for encoding in ('UTF-16le', 'UTF-16be'):
            database = self.directory / (encoding + '.db')
            with closing(sqlite3.connect(database)) as db:
                db.execute("PRAGMA encoding='" + encoding + "'")
                db.executescript(schema_and_rows)
                db.execute("UPDATE messages SET body=? WHERE id='pending-report'", (body,))
                db.commit()
                self.assertEqual(db.execute('PRAGMA encoding').fetchone()[0], encoding)
                self.assertNotEqual(db.execute("SELECT length(CAST(body AS BLOB)) FROM messages "
                                               "WHERE id='pending-report'").fetchone()[0],
                                    len(body.encode('utf-8')))
            before = database.read_bytes()
            for args in [('pending', '--index'), ('pending', '--index', '--pretty'),
                         ('inbox', 'associate', '--index')]:
                with self.subTest(encoding=encoding, args=args):
                    result = subprocess.run([str(EXE), str(database), *args],
                                            capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('UTF-8', result.stdout + result.stderr)
                    self.assertIn('full', result.stdout + result.stderr)
            self.assertEqual(database.read_bytes(), before)
            for args in [('delivery', 'pending-report'), ('inbox', 'associate')]:
                with self.subTest(encoding=encoding, full_reader=args):
                    result = subprocess.run([str(EXE), str(database), *args],
                                            capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                    value = json.loads(result.stdout)
                    row = value if args[0] == 'delivery' else next(
                        row for row in value if row['id'] == 'pending-report')
                    self.assertEqual(row['body'], body)

    def test_focused_routes_agree_with_native_message_admission(self):
        self.assertIsNone(self.call('orchestra', '--index')['routes'],
                          'An unfocused route projection is not an empty route set')
        with closing(sqlite3.connect(self.db)) as db:
            recipients = [row[0] for row in db.execute('SELECT id FROM sessions ORDER BY id')]
            self.assertEqual(db.execute("SELECT id FROM sessions WHERE endpoint<>''").fetchall(), [])
        for sender in ('associate', 'worker'):
            view = self.call('orchestra', '--index', '--for', sender)
            projected = {(row['sender'], row['recipient']) for row in view['routes']}
            admitted = set()
            for recipient in recipients:
                ident = 'route-probe:' + sender + ':' + recipient
                # Every endpoint is empty. The retained row establishes route
                # admission even when stopped-recipient delivery returns an error.
                result = subprocess.run([str(EXE), str(self.db), 'message', ident,
                                         sender, recipient, 'note', 'fixture route check'],
                                        capture_output=True, text=True, timeout=10)
                with closing(sqlite3.connect(self.db)) as db:
                    row = db.execute('SELECT sender,recipient FROM messages WHERE id=?',
                                     (ident,)).fetchone()
                if row is not None:
                    admitted.add(row)
                else:
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn('message-route-denied', result.stdout + result.stderr)
            self.assertEqual(projected, admitted)

    def test_structure_and_counts_share_snapshot_during_commits(self):
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) "
                       "VALUES('snapshot-message','other-root','external','note','fixture')")
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) "
                       "VALUES('snapshot-anchor','root','associate','note','fixture')")
            db.commit()
        ready = threading.Event()
        finished = threading.Event()
        errors = []

        def change_membership_and_receipt():
            try:
                with closing(sqlite3.connect(self.db)) as db:
                    present = False
                    while not finished.is_set():
                        db.execute('BEGIN IMMEDIATE')
                        if present:
                            db.execute("INSERT OR IGNORE INTO ensemble_members VALUES('team','external')")
                            db.execute("INSERT OR IGNORE INTO section_members VALUES('team','review','external')")
                        else:
                            db.execute("DELETE FROM section_members WHERE ensemble='team' AND session='external'")
                            db.execute("DELETE FROM ensemble_members WHERE ensemble='team' AND session='external'")
                        db.execute("UPDATE messages SET receipt=? WHERE id IN ('snapshot-message','snapshot-anchor')",
                                   (None if present else 'fixture acknowledgment',))
                        db.commit()
                        ready.set()
                        present = not present
            except BaseException as error:
                errors.append(error)
                ready.set()

        writer = threading.Thread(target=change_membership_and_receipt, daemon=True)
        writer.start()
        try:
            self.assertTrue(ready.wait(10), 'Fixture writer did not start')
            for pretty in (False, True) * 6:
                args = ['orchestra', '--index', '--for', 'associate']
                if pretty:
                    args.append('--pretty')
                result = subprocess.run([str(EXE), str(self.db), *args],
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
                view = json.loads(result.stdout)
                team = next(row for row in view['ensembles'] if row['id'] == 'team')
                member = 'external' in team['members']
                actors = {row['id']: row for row in view['players']}
                self.assertEqual('external' in actors, member)
                self.assertEqual(actors['associate']['pendingCount'], 2 + int(member))
                self.assertEqual(actors['associate']['unacknowledgedCount'], 2 + int(member))
                if member:
                    self.assertTrue(actors['external']['reference'])
                    self.assertEqual(actors['external']['pendingCount'], 1)
                    self.assertEqual(actors['external']['unacknowledgedCount'], 1)
                self.assertNotIn('pending', view)
        finally:
            finished.set()
            writer.join(10)
        self.assertFalse(writer.is_alive(), 'Fixture writer did not finish')
        self.assertEqual(errors, [])

    def test_structure_preserves_relations_and_counts_as_backlogs_grow(self):
        literal_actor = "literal ' \" $() ; actor"
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('INSERT INTO sessions(id,parent,harness) VALUES(?,?,?)',
                       (literal_actor, 'associate', 'fixture'))
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) "
                       "VALUES('stopped-guidance','root','stopped','guidance','fixture')")
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) "
                       "VALUES('stopped-recovery','root','stopped','recovery','fixture')")
            db.commit()
        commands = [('orchestra', '--index'),
                    ('orchestra', '--index', '--for', 'associate')]

        def check_counts(view):
            self.assertNotIn('pending', view)
            with closing(sqlite3.connect(self.db)) as db:
                stopped = {row[0] for row in db.execute('SELECT session FROM session_stops')}
                for actor in view['players'] + view['operators']:
                    kinds = [row[0] for row in db.execute(
                        'SELECT kind FROM messages WHERE recipient=? AND receipt IS NULL',
                        (actor['id'],))]
                    self.assertEqual(actor['unacknowledgedCount'], len(kinds))
                    self.assertEqual(actor['pendingCount'], sum(
                        actor['id'] not in stopped or kind not in ('task', 'guidance', 'recovery')
                        for kind in kinds))
                    self.assertEqual(actor['inputRead'], ['inbox', actor['id'], '--index'])

        def structure(view):
            value = deepcopy(view)
            for actor in value['players'] + value['operators']:
                del actor['pendingCount'], actor['unacknowledgedCount']
            return value

        before = [self.call(*args) for args in commands]
        for view in before:
            check_counts(view)
        bodies = {}
        with closing(sqlite3.connect(self.db)) as db:
            for recipient in ('root', 'external', 'stopped', literal_actor):
                # Note-only growth preserves latest report and execution facts.
                for index in range(1024):
                    ident = f'backlog-{recipient}-{index}'
                    body = f'λ\0retained body for {ident}\nend'
                    bodies[ident] = body
                    db.execute('INSERT INTO messages(id,sender,recipient,kind,body,receipt) '
                               'VALUES(?,?,?,?,?,?)',
                               (ident, 'worker', recipient, 'note', body,
                                '' if index % 3 == 0 else None))
            db.commit()
        after = [self.call(*args) for args in commands]
        for old, new in zip(before, after):
            check_counts(new)
            self.assertEqual(structure(old), structure(new))
            self.assertNotEqual(old, new)
        for recipient in ('root', 'external', 'stopped', literal_actor):
            with closing(sqlite3.connect(self.db)) as db:
                expected = db.execute('SELECT id,receipt,body FROM messages WHERE recipient=? ORDER BY seq',
                                      (recipient,)).fetchall()
            rows = self.call('inbox', recipient, '--index', '--state', 'all')
            self.assertEqual([row['id'] for row in rows], [row[0] for row in expected])
            self.assertEqual(rows, self.index('--recipient', recipient, '--state', 'all'))
            self.assertEqual([row['bodyBytes'] for row in rows],
                             [len(row[2].encode()) for row in expected])
            actor = next(row for row in after[0]['players'] if row['id'] == recipient)
            self.assertEqual([row['id'] for row in self.call(*actor['inputRead'])],
                             [row[0] for row in expected if row[1] is None])
            for ident in (f'backlog-{recipient}-0', f'backlog-{recipient}-1023'):
                self.assertEqual(self.call('delivery', ident)['body'], bodies[ident])
        (self.directory / 'structural-growth.json').write_text(json.dumps({
            'before': before, 'after': after,
            'beforeBytes': [len(json.dumps(view).encode()) for view in before],
            'afterBytes': [len(json.dumps(view).encode()) for view in after],
        }, indent=2) + '\n')
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) "
                       "VALUES('new-report','worker','root','report','new full report')")
            db.commit()
        latest = self.call('orchestra', '--index', '--for', 'associate')
        worker = next(row for row in latest['players'] if row['id'] == 'worker')
        self.assertEqual(worker['latestReportId'], 'new-report')
        self.assertEqual(self.call('delivery', worker['latestReportId'])['body'], 'new full report')

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
