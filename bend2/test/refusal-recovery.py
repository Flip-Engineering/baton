"""Integration coverage for issue #1320 model-refusal recovery."""
import json
import pathlib
import socket
import sqlite3
import subprocess
import sys
import unittest

import control


class RefusalRecovery(control.Control):
    setUp_control = control.Control.setUp
    call = control.Control.call
    root = control.Control.root
    recruit = control.Control.recruit
    accept_any = control.Control.accept_any
    rows = control.Control.rows
    eventually = control.Control.eventually
    close_fixtures = control.Control.close_fixtures

    def setUp(self):
        self.setUp_control()
        self.root()
        self.source = self.recruit('source')
        self.source_workspace = pathlib.Path(self.source['workspace'])
        self.task_body = 'Complete the assigned task and retain complete evidence.\n' * 40
        self.call('message', 'source-task', 'root', 'source', 'task', self.task_body)
        with sqlite3.connect(self.db) as db:
            db.execute('UPDATE sessions SET observed_harness=?, observed_model=? WHERE id=?',
                       ('omp', 'fixture-observed-model', 'source'))
            db.execute('''CREATE TABLE direct_turn_requests(
                id TEXT PRIMARY KEY NOT NULL,
                session TEXT NOT NULL,
                harness TEXT NOT NULL,
                command TEXT NOT NULL,
                model TEXT NOT NULL,
                effort TEXT NOT NULL,
                workspace TEXT NOT NULL,
                task_path TEXT NOT NULL,
                task TEXT NOT NULL,
                output TEXT NOT NULL,
                native TEXT NOT NULL,
                directory TEXT NOT NULL)''')
            db.execute('''INSERT INTO direct_turn_requests(
                id,session,harness,command,model,effort,workspace,task_path,task,output,native,directory)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                       ('source-command', 'source', 'omp', str(self.fixture), 'source', 'low',
                        str(self.source_workspace), '', self.task_body, '', '', ''))
        self.events = self.directory / 'refusal-events'
        self.events.mkdir()

    def observe(self, ident, session, result):
        event = {'type': 'result', 'session_id': 'native-' + session,
                 'result': result, 'is_error': False}
        path = self.events / (ident + '.json')
        path.write_text(json.dumps(event))
        self.call('observe-file', ident, session, path)
        return event

    def test_detection_three_continue_attempts_three_flush_attempts_and_report(self):
        self.observe('source-refusal-1', 'source', 'I cannot help with that request.')
        recovery = self.rows('SELECT * FROM refusal_recoveries')[0]
        self.assertEqual(recovery['source'], 'source')
        self.assertEqual(recovery['conductor'], 'root')
        self.assertEqual(recovery['status'], 'active')
        self.assertEqual(recovery['harness'], 'omp')
        self.assertEqual(recovery['model'], 'fixture-observed-model')
        self.assertEqual(recovery['instruction'], self.task_body)
        self.assertIn('I cannot help with that request.', recovery['initial_refusal'])
        self.assertEqual(len(self.rows("SELECT * FROM refusal_attempts WHERE stage='fork-and-continue'")), 1)

        retry_one = self.rows("SELECT * FROM messages WHERE id='refusal-retry:'||?||':1'", (recovery['id'],))[0]
        self.assertEqual(retry_one['sender'], 'root')
        self.assertEqual(retry_one['recipient'], 'source')
        self.assertIn('Stage: fork-and-continue', retry_one['body'])
        self.assertIn(self.task_body, retry_one['body'])

        self.observe('source-refusal-2', 'source', "I can't assist with attempt two.")
        self.observe('source-refusal-3', 'source', 'I must decline attempt three.')
        self.observe('source-refusal-4', 'source', "I won't help with attempt three.")
        attempts = self.rows("SELECT * FROM refusal_attempts ORDER BY stage,ordinal")
        self.assertEqual([(row['stage'], row['ordinal'], row['status']) for row in attempts],
                         [('fork-and-continue', 1, 'refused'),
                          ('fork-and-continue', 2, 'refused'),
                          ('fork-and-continue', 3, 'refused')])
        self.assertIn("I can't assist with attempt two.", attempts[1]['refusal_description'])

        flush = [row for row in self.rows("SELECT * FROM refusal_attempts WHERE stage='fork-and-flush' ORDER BY ordinal")]
        self.assertEqual(len(flush), 3, flush)
        self.assertEqual(len({row['round'] for row in flush}), 3, flush)
        self.assertTrue(all(row['status'] == 'running' for row in flush), flush)
        rounds = self.rows('SELECT * FROM branch_rounds ORDER BY rowid')
        self.assertEqual(len(rounds), 3, rounds)
        trees = {subprocess.check_output(
            ['git', '-C', str(self.source_workspace), 'rev-parse', row['snapshot'] + '^{tree}'],
            text=True).strip() for row in rounds}
        self.assertEqual(len(trees), 1, rounds)
        self.assertEqual({row['source'] for row in rounds}, {'source'})

        self.server.settimeout(30)
        try:
            starts = [self.accept_any()[1] for _ in range(3)]
        except socket.timeout:
            self.fail('fork-and-flush did not start three native fixtures')
        finally:
            self.server.settimeout(None)
        players = {row['session'] for row in flush}
        by_session = {start['session']: start for start in starts}
        self.assertEqual(set(by_session), players)
        for row in flush:
            start = by_session[row['session']]
            self.assertIn('Stage: fork-and-flush', start['prompt'])
            self.assertIn('fresh conversation', start['prompt'])
            self.assertIn(row['instruction'], start['prompt'])

        for ordinal, attempt in enumerate(flush, 1):
            self.observe('flush-refusal-' + str(ordinal), attempt['session'],
                         'I cannot help with flush attempt %d.' % ordinal)

        recovery = self.rows('SELECT * FROM refusal_recoveries WHERE id=?', (recovery['id'],))[0]
        self.assertEqual(recovery['status'], 'refused')
        self.assertEqual(recovery['report'], 'refusal-result:' + recovery['id'])
        result_row = self.rows('SELECT * FROM messages WHERE id=?', (recovery['report'],))[0]
        self.assertEqual(result_row['sender'], 'source')
        self.assertEqual(result_row['recipient'], 'root')
        result = json.loads(result_row['body'])
        refusal = result['model-refusal']
        self.assertEqual((refusal['harness'], refusal['model']), ('omp', 'fixture-observed-model'))
        self.assertEqual(len(refusal['attempted_instructions']['fork-and-continue']), 3)
        self.assertEqual(len(refusal['attempted_instructions']['fork-and-flush']), 3)
        all_attempts = self.rows("SELECT * FROM refusal_attempts ORDER BY stage,ordinal")
        self.assertEqual(
            refusal['attempted_instructions']['fork-and-continue'],
            [{'refusal_description': row['refusal_description'], 'instruction': row['instruction']}
             for row in all_attempts if row['stage'] == 'fork-and-continue'])
        self.assertEqual(
            refusal['attempted_instructions']['fork-and-flush'],
            [{'refusal_description': row['refusal_description'], 'instruction': row['instruction']}
             for row in all_attempts if row['stage'] == 'fork-and-flush'])

    def test_non_refusal_provider_failure_does_not_start_recovery(self):
        event = {'type': 'result', 'result': '429 rate limit', 'is_error': True,
                 'session_id': 'native-source'}
        path = self.events / 'provider-failure.json'
        path.write_text(json.dumps(event))
        self.call('observe-file', 'provider-failure', 'source', path)
        self.assertEqual(self.rows('SELECT * FROM refusal_recoveries'), [])


if __name__ == '__main__':
    unittest.main()
