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

    def worker(self, name):
        return self.call('worker', name, 'root', 'requested-harness', 'requested-model',
                         'high', '/retained/worktree', 'worker-branch', 'base-commit')

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

    def test_report_file_and_stdin_preserve_complete_text(self):
        text = "Large report with apostrophe ' and unicode λ🙂.\n" * 6000
        report = pathlib.Path(self.temp.name) / 'report.txt'
        report.write_text(text)
        self.assertEqual(self.call('report-file', 'from-file', 'worker', str(report))['body'], text)
        p = subprocess.run([str(EXE), str(self.db), 'report-file', 'from-stdin', 'worker', '-'],
                           input=text, text=True, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout)['body'], text)
        self.call('report-file', 'missing', 'worker', str(report) + '.missing', success=False)
        self.assertEqual(len(self.call('inbox', 'root')), 2)

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

    def test_native_result_automatically_reports_with_full_source(self):
        init = {'type': 'system', 'subtype': 'init', 'session_id': 'native-1', 'model': 'actual-model'}
        self.assertIsNone(self.call('observe', 'turn-1', 'worker', json.dumps(init))['reportId'])
        self.assertEqual(self.call('session', 'worker')['observedModel'], 'actual-model')
        misleading = {'type': 'assistant', 'message': {'content': '{"type":"result","result":"not done"}'}}
        self.call('observe', 'turn-1', 'worker', json.dumps(misleading))
        self.assertEqual(self.call('inbox', 'root'), [])
        result = {'type': 'result', 'session_id': 'native-1', 'result': "Full answer.\nIt's complete. 🙂", 'is_error': False}
        raw = json.dumps(result)
        seen = self.call('observe', 'turn-1', 'worker', raw)
        self.assertEqual(seen['reportId'], 'turn-1')
        self.assertEqual(self.call('inbox', 'root')[0]['body'], result['result'])
        self.call('ack', 'turn-1', 'root', 'native-acceptance')
        self.call('observe', 'turn-1', 'worker', raw)
        self.assertEqual(self.call('pending'), [])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT event FROM turns WHERE id=?', ('turn-1',)).fetchone()[0], raw)
        changed = dict(result, session_id='different-session')
        self.call('observe', 'turn-1', 'worker', json.dumps(changed), success=False)
        self.assertEqual(self.call('session', 'worker')['native'], 'native-1')

    def test_native_failure_is_reported_and_malformed_input_does_not_commit(self):
        raw = json.dumps({'type': 'result', 'is_error': True, 'errors': ['provider unavailable']})
        self.call('observe', 'failed-turn', 'worker', raw)
        self.assertEqual(self.call('inbox', 'root')[0]['body'], raw)
        self.call('observe', 'bad-input', 'worker', '{"type":"result"', success=False)
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
        self.assertEqual(worker['workspace'], '/retained/worktree')

    def test_failed_routing_keeps_database_usable(self):
        self.call('report', 'missing-parent', 'missing-worker', 'report', success=False)
        self.call('bind', 'missing-worker', 's', 'h', 'm', 'e', success=False)
        self.assertEqual(self.call('inbox', 'root'), [])
        self.call('report', 'good', 'worker', 'available')
        self.assertEqual(self.call('inbox', 'root')[0]['id'], 'good')

    def test_sql_text_is_data(self):
        worker = "worker'); DROP TABLE sessions; --"
        self.worker(worker)
        text = "'quoted'\n\\tab\t\rJSON {\"a\":1} 🙂"
        self.call('report', "id'--", worker, text)
        self.assertEqual(self.call('inbox', 'root')[0]['body'], text)
        self.assertEqual(len(self.call('status')), 3)

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
