"""Exercise persistence and message delivery using separate native processes."""
import concurrent.futures
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Coordinator(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.repo.mkdir()
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['git', 'init', '-q', '-b', 'main', str(self.repo)],
                     ['git', '-C', str(self.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(self.repo), 'config', 'user.name', 'Coordinator fixture']):
            subprocess.run(argv, check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach', 'root', 'native-test', 'root-session', 'native-endpoint')
        self.call('role', 'root', 'principal-conductor')
        self.player('worker')

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args, success=True):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        if success:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        self.assertNotEqual(p.returncode, 0)
        return p

    def player(self, name, parent='root', harness='requested-harness',
               model='requested-model', effort='high', workspace=None, branch=None, base=None):
        """Recruit a session into the fixture repository's own checkout."""
        return self.call('recruit', name, parent, harness, model, effort, str(self.repo),
                         name + '-branch', str(self.checkouts / name), self.base)

    def observe(self, ident, player, event, success=True):
        # One native event, written where the coordinator reads it.
        path = pathlib.Path(self.temp.name) / (ident + '-event.json')
        path.write_text(event)
        return self.call('observe-file', ident, player, str(path), success=success)

    def test_report_survives_process_exit_and_waits_for_native_acceptance(self):
        text = "Question: what's next?\nUnicode λ🙂 and full multiline report.\n" * 100
        report = self.call('report', 'turn-1', 'worker', text)
        self.assertEqual(report['recipient'], 'root')
        self.assertEqual(report['body'], text)
        self.assertIsNone(report['receipt'])
        self.assertEqual(self.call('inbox', 'root')[0]['body'], text)
        self.call('attach', 'root', 'native-test', 'resumed-session', 'new-endpoint')
        self.assertEqual(self.call('inbox', 'root')[0]['id'], 'turn-1')
        self.call('ack', 'turn-1', 'root', 'native-accepted-42')
        self.assertEqual(self.call('inbox', 'root'), [])
        retry = self.call('report', 'turn-1', 'worker', text)
        self.assertEqual(retry['receipt'], 'native-accepted-42')
        self.assertEqual(self.call('inbox', 'root'), [])

    def test_guidance_and_question_route_to_the_named_session(self):
        self.call('message', 'guide-1', 'root', 'worker', 'guide', 'Continue the task.')
        self.assertEqual(self.call('inbox', 'worker')[0]['kind'], 'guide')
        self.call('message', 'ask-1', 'worker', 'root', 'ask', 'Which branch?')
        self.assertEqual(self.call('inbox', 'root')[0]['body'], 'Which branch?')
        self.call('ack', 'guide-1', 'worker', 'accepted')
        self.assertEqual(self.call('inbox', 'worker'), [])
        self.assertEqual(len(self.call('inbox', 'root')), 1)

    def test_ask_records_full_question_to_parent_and_retry_does_not_duplicate(self):
        text = "Question with apostrophe ' and unicode λ🙂.\n" * 40
        asked = self.call('ask', 'askq-1', 'worker', text)
        self.assertEqual(asked['sender'], 'worker')
        self.assertEqual(asked['recipient'], 'root')
        self.assertEqual(asked['kind'], 'question')
        self.assertEqual(asked['body'], text)
        self.assertEqual(self.call('ask', 'askq-1', 'worker', text)['body'], text)
        self.call('ask', 'askq-1', 'worker', text + 'changed', success=False)
        inbox = self.call('inbox', 'root')
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]['id'], 'askq-1')
        self.assertEqual(inbox[0]['kind'], 'question')
        self.assertEqual(inbox[0]['body'], text)
        progress = {'type': 'system', 'subtype': 'init', 'session_id': 'native-question'}
        self.assertIsNone(self.observe('askq-1', 'worker', json.dumps(progress))['reportId'])
        conflict = self.observe('askq-1', 'worker', json.dumps({'type': 'result', 'result': 'Different output.'}), success=False)
        self.assertIn('message-id-conflict', conflict.stderr)
        self.assertNotIn(text, conflict.stderr)
        self.assertEqual(self.call('turns', 'worker'), [])
        self.assertEqual(self.call('delivery', 'askq-1')['body'], text)

    def test_ask_file_reads_file_and_stdin_into_complete_questions(self):
        text = "Piped question with apostrophe ' and unicode λ🙂.\n" * 6000
        question = pathlib.Path(self.temp.name) / 'question.txt'
        question.write_text(text)
        self.assertEqual(self.call('ask-file', 'askq-file', 'worker', str(question))['body'], text)
        p = subprocess.run([str(EXE), str(self.db), 'ask-file', 'askq-stdin', 'worker', '-'],
                           input=text, text=True, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout)['body'], text)
        self.assertEqual(len(self.call('inbox', 'root')), 2)

    def test_delivery_uses_current_native_attachment(self):
        self.call('report', 'turn-1', 'worker', 'work available')
        self.call('attach', 'root', 'native-test', 'new-native-session', 'new-endpoint')
        delivery = self.call('delivery', 'turn-1')
        self.assertEqual(delivery['native'], 'new-native-session')
        self.assertEqual(delivery['endpoint'], 'new-endpoint')
        self.assertEqual(delivery['body'], 'work available')
        self.assertEqual(self.call('player', 'root')['native'], 'new-native-session')
        self.assertEqual(self.call('pending'), [delivery])
        self.call('ack', 'turn-1', 'root', 'accepted')
        self.assertEqual(self.call('pending'), [])
        self.assertEqual(self.call('delivery', 'turn-1')['receipt'], 'accepted')

    def test_message_index_keeps_owed_messages_and_complete_body_retrieval(self):
        body = "Retained report with apostrophe ' and unicode λ🙂.\n" * 4000
        report = pathlib.Path(self.temp.name) / 'large-report.txt'
        report.write_text(body)
        self.call('report-file', 'large-report', 'worker', str(report))
        self.call('report', 'handled-report', 'worker', 'Already handled.')
        self.call('ack', 'handled-report', 'root', '')
        self.player('stopped-worker', harness='omp')
        self.call('message', 'stopped-task', 'root', 'stopped-worker', 'task',
                  'This input remains owed after the explicit stop.')
        self.call('stop', 'stopped-worker', 'operator-stop', 'Stopped by operator.')
        self.call('report', 'later-report', 'worker', 'Later report.')
        with sqlite3.connect(self.db) as db:
            db.execute('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                       ('historical-orphan', 'worker', 'retired-recipient', 'report',
                        'Retained historical message without a session row.'))

        full = self.call('inbox', 'root')
        index = self.call('inbox', 'root', '--index')
        self.assertEqual([row['id'] for row in index], [row['id'] for row in full])
        self.assertEqual([row['seq'] for row in index], sorted(row['seq'] for row in index))
        for row in index:
            self.assertNotIn('body', row)
            self.assertNotIn('endpoint', row)
            self.assertIsNone(row['receipt'])
            self.assertEqual((row['sender'], row['recipient'], row['kind']),
                             ('worker', 'root', 'report'))
        for flags in (('--index', '--pretty'), ('--pretty', '--index')):
            self.assertEqual(self.call('inbox', 'root', *flags), index)
        self.assertEqual(self.call('inbox', 'missing-recipient', '--index'), [])

        pending = self.call('pending', '--index')
        self.assertEqual([row['id'] for row in pending],
                         [row['id'] for row in self.call('pending')])
        self.assertNotIn('historical-orphan', [row['id'] for row in pending])
        orphan = self.call('inbox', 'retired-recipient', '--index')
        self.assertEqual([row['id'] for row in orphan],
                         [row['id'] for row in self.call('inbox', 'retired-recipient')])
        self.assertEqual(orphan[0]['id'], 'historical-orphan')
        for flags in (('--index', '--pretty'), ('--pretty', '--index')):
            self.assertEqual(self.call('pending', *flags), pending)
        stopped = next(row for row in pending if row['id'] == 'stopped-task')
        self.assertEqual(stopped['executionDisposition'], 'stopped')
        self.assertEqual(stopped['stopId'], 'operator-stop')
        self.assertEqual(self.call('inbox', 'stopped-worker', '--index'), [stopped])
        self.assertEqual(self.call('delivery', 'large-report')['body'], body)
        self.assertIsNone(self.call('delivery', 'large-report')['receipt'])
        self.assertEqual(self.call('delivery', 'handled-report')['receipt'], '')
        self.assertEqual(self.call('inbox', 'root'), full)

    def test_message_index_filters_receipts_routes_and_exact_sequence_ranges(self):
        wide = 9007199254740993
        rows = [
            ('first-report', 'worker', 'root', 'report', 'First retained body.', None),
            ('handled-report', 'worker', 'root', 'report', 'Handled body.', ''),
            ('worker-guidance', 'root', 'worker', 'guidance', 'Worker guidance.', None),
            ('literal-options', '--index', 'root', '--pretty', 'Literal option names.', None),
            ('empty-fields', '', 'root', '', 'Literal empty fields.', None),
            ('quoted-sender', "sender's λ", 'root', 'report', 'Quoted sender.', None),
            ('orphan-report', 'worker', 'retired-recipient', 'report', 'Historical body.', None),
        ]
        with sqlite3.connect(self.db) as db:
            db.executemany('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)', rows)
            for offset in range(3):
                db.execute('INSERT INTO messages(seq,id,sender,recipient,kind,body) VALUES(?,?,?,?,?,?)',
                           (wide + offset, 'wide-' + str(offset), 'worker', 'root', 'report',
                            'Wide sequence body ' + str(offset)))
            before = db.execute('SELECT * FROM messages ORDER BY seq').fetchall()

        index = self.call('inbox', 'root', '--index', '--state', 'all')
        self.assertEqual([row['seq'] for row in index], sorted(row['seq'] for row in index))
        self.assertTrue(all('body' not in row for row in index))
        handled = self.call('inbox', 'root', '--index', '--state', 'acknowledged')
        self.assertEqual([row['id'] for row in handled], ['handled-report'])
        self.assertEqual(handled[0]['receipt'], '')
        reports = self.call('pending', '--pretty', '--recipient', 'root', '--index',
                            '--sender', 'worker', '--kind', 'report', '--state', 'all')
        self.assertEqual([row['id'] for row in reports],
                         ['first-report', 'handled-report', 'wide-0', 'wide-1', 'wide-2'])
        self.assertEqual(self.call('pending', '--index', '--recipient', 'retired-recipient'), [])
        self.assertEqual([row['id'] for row in self.call('inbox', 'retired-recipient', '--index')],
                         ['orphan-report'])

        bounded = self.call('inbox', 'root', '--index', '--after-seq', str(wide),
                            '--through-seq', str(wide + 1))
        self.assertEqual([(row['id'], row['seq']) for row in bounded], [('wide-1', wide + 1)])
        self.assertEqual(self.call('inbox', 'root', '--index', '--after-seq', str(wide + 1),
                                   '--through-seq', str(wide)), [])
        self.assertEqual(self.call('inbox', 'root', '--index', '--after-seq', '+000' + str(wide),
                                   '--through-seq', str(wide + 1), '--after-seq', str(wide)), bounded)
        for sender, kind, expected in (
                ('--index', '--pretty', 'literal-options'),
                ('', '', 'empty-fields'),
                ("sender's λ", 'report', 'quoted-sender')):
            with self.subTest(sender=sender, kind=kind):
                selected = self.call('inbox', 'root', '--sender', sender, '--kind', kind, '--index')
                self.assertEqual([row['id'] for row in selected], [expected])
        self.assertEqual(self.call('inbox', 'root', '--pretty'), self.call('inbox', 'root'))
        self.assertEqual(self.call('delivery', 'wide-1')['body'], 'Wide sequence body 1')
        for flags in (('--after-seq', 'not-an-integer'), ('--through-seq',), ('--state', 'unknown')):
            with self.subTest(flags=flags):
                self.call('pending', '--index', *flags, success=False)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT * FROM messages ORDER BY seq').fetchall(), before)

    def test_codex_thread_event_records_resume_identity_before_report(self):
        self.player('codex', 'root', 'codex', 'gpt-6-astra', 'low',
                  '/retained/codex', 'codex-branch', 'base')
        event = {'type': 'thread.started',
                 'thread_id': '01a0e0cd-18e6-72a1-a46f-88790278891a'}
        observed = self.observe('codex-turn', 'codex', json.dumps(event))
        self.assertIsNone(observed['reportId'])
        session = self.call('player', 'codex')
        self.assertEqual(session['native'], event['thread_id'])
        self.assertEqual(session['model'], 'gpt-6-astra')
        self.assertEqual(session['observedModel'], '')
        self.assertEqual(self.call('inbox', 'root'), [])

    def test_omp_rpc_state_records_native_session_and_observed_route(self):
        self.player('omp', 'root', 'omp', 'requested-model', 'low',
                  '/retained/omp', 'omp-branch', 'base')
        event = {'type': 'response', 'command': 'get_state', 'success': True,
                 'id': 'baton:session', 'data': {'sessionId': 'omp-rpc-native',
                 'model': {'provider': 'deepseek', 'id': 'deepseek-flash'}}}
        self.assertIsNone(self.observe('omp-turn', 'omp', json.dumps(event))['reportId'])
        session = self.call('player', 'omp')
        self.assertEqual(session['native'], 'omp-rpc-native')
        self.assertEqual(session['model'], 'requested-model')
        self.assertEqual(session['observedModel'], 'deepseek/deepseek-flash')
        self.assertEqual(self.call('inbox', 'root'), [])

    def test_muse_session_envelope_supplies_native_resume_identity(self):
        # Live muse-review-2 emitted this envelope before any terminal result.
        event = {
            'schema_version': 1,
            'stream': {'kind': 'session', 'id': '01a0df98-f209-76e0-b110-8c178a29e221'},
            'payload_type': 'run.model.configured',
            'payload': {'kind': 'run_model_configured', 'provider_id': 'meta',
                        'model_id': 'muse-spark-1.3-contributor'},
        }
        self.player('muse', 'root', 'muse', 'requested-muse', 'low',
                  '/retained/muse', 'muse-branch', 'base')
        self.assertIsNone(self.observe('muse-turn', 'muse', json.dumps(event))['reportId'])
        session = self.call('player', 'muse')
        self.assertEqual(session['native'], event['stream']['id'])
        self.assertEqual(session['model'], 'requested-muse')
        self.assertEqual(session['observedModel'], 'muse-spark-1.3-contributor')
        player = next(w for w in self.call('players') if w['id'] == 'muse')
        self.assertEqual(player['native'], event['stream']['id'])
        self.assertIsNone(player['lastTurnId'])
        self.assertEqual(self.call('inbox', 'root'), [])

    def test_muse_terminal_envelope_reports_text_and_retains_source(self):
        event = {
            'schema_version': 1,
            'stream': {'kind': 'session', 'id': 'muse-native'},
            'payload_type': 'run.terminal.completed',
            'payload': {'kind': 'run_terminal', 'terminal': 'completed',
                        'text': 'Resumed Muse receives no task.\nFull report λ', 'reason': None},
        }
        observed = self.observe('muse-turn', 'worker', json.dumps(event))
        self.assertEqual(observed['reportId'], 'muse-turn')
        self.assertEqual(observed['eventType'], 'run.terminal.completed')
        self.assertEqual(self.call('inbox', 'root')[0]['body'], event['payload']['text'])
        with sqlite3.connect(self.db) as db:
            source = db.execute('SELECT event FROM turns WHERE id=?', ('muse-turn',)).fetchone()[0]
        self.assertEqual(json.loads(source), event)
        player = next(row for row in self.call('players') if row['id'] == 'worker')
        self.assertEqual(player['native'], 'muse-native')
        self.assertEqual(player['lastTurnId'], 'muse-turn')
        self.assertEqual(player['lastTurnEvent'], 'run.terminal.completed')
        self.assertEqual(self.call('turns', 'worker')[0]['eventType'], 'run.terminal.completed')
        self.observe('muse-turn', 'worker', json.dumps(event))
        self.assertEqual(len(self.call('inbox', 'root')), 1)

    def test_native_result_automatically_reports_with_full_source(self):
        init = {'type': 'system', 'subtype': 'init', 'session_id': 'native-1', 'model': 'actual-model'}
        self.assertIsNone(self.observe('turn-1', 'worker', json.dumps(init))['reportId'])
        self.assertEqual(self.call('player', 'worker')['observedModel'], 'actual-model')
        misleading = {'type': 'assistant', 'message': {'content': '{"type":"result","result":"not done"}'}}
        self.observe('turn-1', 'worker', json.dumps(misleading))
        self.assertEqual(self.call('inbox', 'root'), [])
        result = {'type': 'result', 'session_id': 'native-1', 'result': "Full answer.\nIt's complete. 🙂", 'is_error': False}
        raw = json.dumps(result)
        seen = self.observe('turn-1', 'worker', raw)
        self.assertEqual(seen['reportId'], 'turn-1')
        self.assertEqual(self.call('inbox', 'root')[0]['body'], result['result'])
        self.call('ack', 'turn-1', 'root', 'native-acceptance')
        self.observe('turn-1', 'worker', raw)
        self.assertEqual(self.call('pending'), [])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT event FROM turns WHERE id=?', ('turn-1',)).fetchone()[0], raw)
        changed = dict(result, session_id='different-session')
        self.observe('turn-1', 'worker', json.dumps(changed))
        self.assertEqual(self.call('player', 'worker')['native'], 'different-session')
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT event FROM turns WHERE id=?', ('turn-1',)).fetchone()[0], raw)

    def test_native_failure_is_reported_and_malformed_input_does_not_commit(self):
        raw = json.dumps({'type': 'result', 'is_error': True, 'errors': ['provider unavailable']})
        self.observe('failed-turn', 'worker', raw)
        self.assertEqual(self.call('inbox', 'root')[0]['body'], raw)
        self.observe('bad-input', 'worker', '{"type":"result"', success=False)
        self.assertEqual(len(self.call('inbox', 'root')), 1)

    def operator(self, role=True):
        self.call('attach', 'operator', 'operator', '', '')
        if role:
            self.call('role', 'operator', 'operator')

    def test_principal_terminal_and_public_report_reach_registered_operator(self):
        self.operator()
        text = "Principal result with apostrophe ' and Unicode λ🙂.\n" * 6000
        event = {'type': 'result', 'session_id': 'principal-native', 'result': text, 'is_error': False}
        raw = json.dumps(event)
        observed = self.observe('principal-result', 'root', raw)
        self.assertEqual(observed['reportId'], 'principal-result')
        self.assertEqual(self.call('turns', 'root')[0]['reportBody'], text)
        delivered = self.call('delivery', 'principal-result')
        self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind'], delivered['body']),
                         ('root', 'operator', 'report', text))
        self.assertIsNone(delivered['receipt'])
        self.assertEqual(self.call('inbox', 'operator')[0]['body'], text)
        self.call('ack', 'principal-result', 'operator', 'operator-reviewed')
        self.observe('principal-result', 'root', raw)
        self.assertEqual(self.call('inbox', 'operator'), [])
        self.assertEqual(self.call('delivery', 'principal-result')['receipt'], 'operator-reviewed')
        changed = dict(event, result=text + 'changed')
        self.observe('principal-result', 'root', json.dumps(changed), success=False)
        self.assertEqual(self.call('turns', 'root')[0]['reportBody'], text)
        manual = self.call('report', 'principal-manual', 'root', 'Reviewed report.')
        self.assertEqual((manual['recipient'], manual['body']), ('operator', 'Reviewed report.'))
        self.assertIsNone(self.call('session', 'root')['parent'])

    def test_subordinate_reports_keep_immediate_parent_with_registered_operator(self):
        self.operator()
        for role in ('player', 'associate-conductor'):
            with self.subTest(role=role):
                self.call('role', 'worker', role)
                ident = 'subordinate-' + role
                event = {'type': 'result', 'result': 'Subordinate full result λ.', 'is_error': False}
                self.observe(ident, 'worker', json.dumps(event))
                self.assertEqual(self.call('delivery', ident)['recipient'], 'root')
                self.assertEqual(self.call('delivery', ident)['body'], event['result'])
        self.assertEqual(self.call('inbox', 'operator'), [])

    def test_parentless_player_keeps_identity_without_operator_report(self):
        self.operator()
        self.call('attach', 'bare', 'codex', '', '')
        event = {'type': 'result', 'session_id': 'bare-native', 'result': 'Bare result.', 'is_error': False}
        self.assertIsNone(self.observe('bare-result', 'bare', json.dumps(event))['reportId'])
        self.assertEqual(self.call('session', 'bare')['native'], 'bare-native')
        self.assertEqual(self.call('turns', 'bare'), [])
        self.assertEqual(self.call('inbox', 'operator'), [])
        self.call('report', 'bare-manual', 'bare', 'No upstream recipient.', success=False)
        self.assertEqual(self.call('inbox', 'operator'), [])

    def test_principal_reporting_requires_explicit_registered_operator_role(self):
        event = json.dumps({'type': 'result', 'result': 'Principal result.', 'is_error': False})
        self.assertIsNone(self.observe('without-operator', 'root', event)['reportId'])
        self.operator(role=False)
        self.assertIsNone(self.observe('without-operator-role', 'root', event)['reportId'])
        self.assertEqual(self.call('turns', 'root'), [])
        self.assertEqual(self.call('inbox', 'operator'), [])
        self.call('role', 'operator', 'operator')
        self.assertEqual(self.observe('with-operator-role', 'root', event)['reportId'], 'with-operator-role')
        self.assertEqual(self.call('delivery', 'with-operator-role')['recipient'], 'operator')

    def test_empty_parent_identity_keeps_priority_over_operator(self):
        self.operator()
        self.call('attach', '', 'native-test', '', '')
        self.call('role', '', 'principal-conductor')
        self.player('empty-child', parent='')
        event = json.dumps({'type': 'result', 'result': 'Result for empty parent λ.', 'is_error': False})
        self.observe('empty-parent-result', 'empty-child', event)
        self.assertEqual(self.call('delivery', 'empty-parent-result')['recipient'], '')
        self.assertEqual(self.call('inbox', '')[0]['body'], 'Result for empty parent λ.')
        self.assertEqual(self.call('inbox', 'operator'), [])

    def test_stopped_principal_handoff_retains_child_input_and_notifies_operator(self):
        self.operator()
        self.call('attach', 'stopped-principal', 'codex', 'principal-native', '')
        self.call('role', 'stopped-principal', 'principal-conductor')
        self.player('stopped-child', parent='stopped-principal')
        stopped = self.call('stop', 'stopped-principal', 'stop-principal', 'Review ended.')
        self.assertIsNone(stopped['requestedSignal'])
        self.call('report', 'child-retained-report', 'stopped-child', 'Full child result λ.', success=False)
        original = self.call('delivery', 'child-retained-report')
        self.assertEqual((original['recipient'], original['body'], original['receipt']),
                         ('stopped-principal', 'Full child result λ.', None))
        notice = self.call('inbox', 'operator')[0]
        self.assertEqual((notice['sender'], notice['recipient'], notice['kind']),
                         ('stopped-principal', 'operator', 'report'))
        body = json.loads(notice['body'])
        self.assertEqual((body['originalMessage'], body['originalBody'], body['originalSender']),
                         ('child-retained-report', 'Full child result λ.', 'stopped-child'))
        self.assertEqual(self.call('delivery', notice['id'])['receipt'], None)

    def test_player_connection_retains_parentage_and_requested_route(self):
        self.call('message', 'guide-1', 'root', 'worker', 'guide', 'Continue.')
        endpoint = json.dumps(['/usr/bin/true', 'worker-supervisor-endpoint'])
        self.call('connect', 'worker', 'worker-native-session', endpoint)
        binding = self.call('player', 'worker')
        self.assertEqual(binding['parent'], 'root')
        self.assertEqual(binding['harness'], 'requested-harness')
        self.assertEqual(self.call('delivery', 'guide-1')['endpoint'], endpoint)
        self.call('report', 'worker-turn', 'worker', 'ready')
        self.assertEqual(self.call('delivery', 'worker-turn')['recipient'], 'root')

    def test_retry_id_preserves_original_input(self):
        self.call('report', 'turn-1', 'worker', 'first')
        self.call('report', 'turn-1', 'worker', 'different', success=False)
        self.assertEqual(self.call('inbox', 'root')[0]['body'], 'first')
        self.assertEqual(len(self.call('inbox', 'root')), 1)
        self.call('ack', 'turn-1', 'worker', 'wrong-recipient', success=False)
        self.assertEqual(len(self.call('inbox', 'root')), 1)

    def test_route_observation_preserves_requested_route_and_workspace(self):
        self.call('bind', 'worker', 'real-session', 'observed-harness', 'observed-model', 'low')
        player = self.player('worker')
        self.assertEqual(player['harness'], 'requested-harness')
        self.assertEqual(player['model'], 'requested-model')
        self.assertEqual(player['effort'], 'high')
        self.assertEqual(player['observedHarness'], 'observed-harness')
        self.assertEqual(player['observedModel'], 'observed-model')
        self.assertEqual(player['native'], 'real-session')
        self.assertEqual(player['workspace'], str(self.checkouts / 'worker'))

    def test_failed_routing_keeps_database_usable(self):
        self.call('report', 'missing-parent', 'missing-worker', 'report', success=False)
        self.call('bind', 'missing-worker', 's', 'h', 'm', 'e', success=False)
        self.assertEqual(self.call('inbox', 'root'), [])
        self.call('report', 'good', 'worker', 'available')
        self.assertEqual(self.call('inbox', 'root')[0]['id'], 'good')

    def test_sql_text_is_data(self):
        text = "'quoted'\n\\tab\t\rJSON {\"a\":1} 🙂"
        self.call('report', "id'--", 'worker', text)
        self.assertEqual(self.call('inbox', 'root')[0]['body'], text)
        self.call('message', "m'--", 'root', 'worker', 'guidance', text)
        self.assertEqual(self.call('inbox', 'worker')[0]['body'], text)
        self.assertEqual(len(self.call('status')), 2)

    def test_status_classifies_each_session_route_and_codex_app_root(self):
        self.call('attach', 'root', 'codex', 'codex-thread', '')
        omp_endpoint = json.dumps(['/usr/bin/true'])
        self.call('attach', 'configured-omp', 'omp', 'omp-thread', omp_endpoint)
        muse_endpoint = json.dumps(['/usr/bin/true'])
        self.call('attach', 'configured-muse', 'muse', 'muse-thread', muse_endpoint)

        status = {row['id']: row for row in self.call('status')}

        self.assertEqual(status['root']['harness'], 'codex')
        self.assertEqual(status['root']['native'], 'codex-thread')
        self.assertEqual(status['root']['endpoint'], '')
        self.assertEqual(status['root']['blockedCause'], '')
        self.assertEqual(status['configured-omp']['harness'], 'omp')
        self.assertEqual(status['configured-omp']['endpoint'], omp_endpoint)
        self.assertEqual(status['configured-omp']['blockedCause'], '')
        self.assertEqual(status['configured-muse']['harness'], 'muse')
        self.assertEqual(status['configured-muse']['endpoint'], muse_endpoint)
        self.assertEqual(status['configured-muse']['blockedCause'], '')

    def test_players_lists_players_with_latest_report(self):
        self.player('other', 'root', 'omp', 'model', 'high', '/wt2', 'br2', 'base2')
        self.call('report', 'r1', 'worker', 'Task completed successfully.')

        players = self.call('players')

        reported = next(w for w in players if w['id'] == 'worker')
        self.assertEqual(reported['parent'], 'root')
        self.assertEqual(reported['latestReport'], 'Task completed successfully.')
        self.assertEqual(reported['latestReportId'], 'r1')

        idle = next(w for w in players if w['id'] == 'other')
        self.assertIsNone(idle['latestReport'])
        self.assertIsNone(idle['latestReportId'])

    def test_turns_lists_turn_history_for_a_player(self):
        self.assertEqual(self.call('turns', 'worker'), [])
        result1 = json.dumps({'type': 'result', 'result': 'first answer'})
        self.observe('turn-1', 'worker', result1)
        result2 = json.dumps({'type': 'result', 'result': 'second answer'})
        self.observe('turn-2', 'worker', result2)

        turns = self.call('turns', 'worker')

        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]['id'], 'turn-1')
        self.assertEqual(turns[0]['player'], 'worker')
        self.assertEqual(turns[0]['eventType'], 'result')
        self.assertEqual(turns[0]['reportBody'], 'first answer')
        self.assertIsNone(turns[0]['receipt'])
        self.assertEqual(turns[1]['id'], 'turn-2')
        self.assertEqual(turns[1]['reportBody'], 'second answer')

        self.call('ack', 'turn-1', 'root', 'accepted')
        turns_after = self.call('turns', 'worker')
        self.assertEqual(turns_after[0]['receipt'], 'accepted')
        self.assertIsNone(turns_after[1]['receipt'])

    def test_parallel_reports_have_one_durable_record_per_id(self):
        def report(i):
            return self.call('report', f'turn-{i % 4}', 'worker', f'body-{i % 4}')
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(report, range(12)))
        rows = self.call('inbox', 'root')
        self.assertEqual({r['id'] for r in rows}, {f'turn-{i}' for i in range(4)})
        self.assertEqual(len(rows), 4)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')


if __name__ == '__main__':
    unittest.main()
