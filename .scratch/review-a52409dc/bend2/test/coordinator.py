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
        self.worker('worker')

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args, success=True):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        if success:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        self.assertNotEqual(p.returncode, 0)
        return p

    def worker(self, name, parent='root', harness='requested-harness',
               model='requested-model', effort='high', workspace=None, branch=None, base=None):
        """Recruit a session into the fixture repository's own checkout."""
        return self.call('recruit', name, parent, harness, model, effort, str(self.repo),
                         name + '-branch', str(self.checkouts / name), self.base)

    def observe(self, ident, worker, event, success=True):
        # One native event, written where the coordinator reads it.
        path = pathlib.Path(self.temp.name) / (ident + '-event.json')
        path.write_text(event)
        return self.call('observe-file', ident, worker, str(path), success=success)

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
        self.assertEqual(self.call('session', 'root')['native'], 'new-native-session')
        self.assertEqual(self.call('pending'), [delivery])
        self.call('ack', 'turn-1', 'root', 'accepted')
        self.assertEqual(self.call('pending'), [])
        self.assertEqual(self.call('delivery', 'turn-1')['receipt'], 'accepted')

    def test_codex_thread_event_records_resume_identity_before_report(self):
        self.worker('codex', 'root', 'codex', 'gpt-6-astra', 'low',
                  '/retained/codex', 'codex-branch', 'base')
        event = {'type': 'thread.started',
                 'thread_id': '01a0e0cd-18e6-72a1-a46f-88790278891a'}
        observed = self.observe('codex-turn', 'codex', json.dumps(event))
        self.assertIsNone(observed['reportId'])
        session = self.call('session', 'codex')
        self.assertEqual(session['native'], event['thread_id'])
        self.assertEqual(session['model'], 'gpt-6-astra')
        self.assertEqual(session['observedModel'], '')
        self.assertEqual(self.call('inbox', 'root'), [])

    def test_omp_rpc_state_records_native_session_and_observed_route(self):
        self.worker('omp', 'root', 'omp', 'requested-model', 'low',
                  '/retained/omp', 'omp-branch', 'base')
        event = {'type': 'response', 'command': 'get_state', 'success': True,
                 'id': 'baton:session', 'data': {'sessionId': 'omp-rpc-native',
                 'model': {'provider': 'deepseek', 'id': 'deepseek-flash'}}}
        self.assertIsNone(self.observe('omp-turn', 'omp', json.dumps(event))['reportId'])
        session = self.call('session', 'omp')
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
        self.worker('muse', 'root', 'muse', 'requested-muse', 'low',
                  '/retained/muse', 'muse-branch', 'base')
        self.assertIsNone(self.observe('muse-turn', 'muse', json.dumps(event))['reportId'])
        session = self.call('session', 'muse')
        self.assertEqual(session['native'], event['stream']['id'])
        self.assertEqual(session['model'], 'requested-muse')
        self.assertEqual(session['observedModel'], 'muse-spark-1.3-contributor')
        worker = next(w for w in self.call('workers') if w['id'] == 'muse')
        self.assertEqual(worker['native'], event['stream']['id'])
        self.assertIsNone(worker['lastTurnId'])
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
        worker = self.call('workers')[0]
        self.assertEqual(worker['native'], 'muse-native')
        self.assertEqual(worker['lastTurnId'], 'muse-turn')
        self.assertEqual(worker['lastTurnEvent'], 'run.terminal.completed')
        self.assertEqual(self.call('turns', 'worker')[0]['eventType'], 'run.terminal.completed')
        self.observe('muse-turn', 'worker', json.dumps(event))
        self.assertEqual(len(self.call('inbox', 'root')), 1)

    def test_native_result_automatically_reports_with_full_source(self):
        init = {'type': 'system', 'subtype': 'init', 'session_id': 'native-1', 'model': 'actual-model'}
        self.assertIsNone(self.observe('turn-1', 'worker', json.dumps(init))['reportId'])
        self.assertEqual(self.call('session', 'worker')['observedModel'], 'actual-model')
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
        self.observe('turn-1', 'worker', json.dumps(changed), success=False)
        self.assertEqual(self.call('session', 'worker')['native'], 'native-1')

    def test_native_failure_is_reported_and_malformed_input_does_not_commit(self):
        raw = json.dumps({'type': 'result', 'is_error': True, 'errors': ['provider unavailable']})
        self.observe('failed-turn', 'worker', raw)
        self.assertEqual(self.call('inbox', 'root')[0]['body'], raw)
        self.observe('bad-input', 'worker', '{"type":"result"', success=False)
        self.assertEqual(len(self.call('inbox', 'root')), 1)

    def test_worker_connection_retains_parentage_and_requested_route(self):
        self.call('message', 'guide-1', 'root', 'worker', 'guide', 'Continue.')
        self.call('connect', 'worker', 'worker-native-session', 'worker-supervisor-endpoint')
        binding = self.call('session', 'worker')
        self.assertEqual(binding['parent'], 'root')
        self.assertEqual(binding['harness'], 'requested-harness')
        self.assertEqual(self.call('delivery', 'guide-1')['endpoint'], 'worker-supervisor-endpoint')
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
        worker = self.worker('worker')
        self.assertEqual(worker['harness'], 'requested-harness')
        self.assertEqual(worker['model'], 'requested-model')
        self.assertEqual(worker['effort'], 'high')
        self.assertEqual(worker['observedHarness'], 'observed-harness')
        self.assertEqual(worker['observedModel'], 'observed-model')
        self.assertEqual(worker['native'], 'real-session')
        self.assertEqual(worker['workspace'], str(self.checkouts / 'worker'))

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

    def test_workers_lists_workers_with_latest_report(self):
        self.worker('other', 'root', 'omp', 'model', 'high', '/wt2', 'br2', 'base2')
        self.call('report', 'r1', 'worker', 'Task completed successfully.')

        workers = self.call('workers')

        reported = next(w for w in workers if w['id'] == 'worker')
        self.assertEqual(reported['parent'], 'root')
        self.assertEqual(reported['latestReport'], 'Task completed successfully.')
        self.assertEqual(reported['latestReportId'], 'r1')

        idle = next(w for w in workers if w['id'] == 'other')
        self.assertIsNone(idle['latestReport'])
        self.assertIsNone(idle['latestReportId'])

    def test_turns_lists_turn_history_for_a_worker(self):
        self.assertEqual(self.call('turns', 'worker'), [])
        result1 = json.dumps({'type': 'result', 'result': 'first answer'})
        self.observe('turn-1', 'worker', result1)
        result2 = json.dumps({'type': 'result', 'result': 'second answer'})
        self.observe('turn-2', 'worker', result2)

        turns = self.call('turns', 'worker')

        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]['id'], 'turn-1')
        self.assertEqual(turns[0]['worker'], 'worker')
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
