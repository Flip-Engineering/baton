"""Exercise terminal observation across mixed native frame shapes and nested runs."""

import importlib.util
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import sys
import time
import unittest

SPEC = importlib.util.spec_from_file_location(
    'receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
RECEIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECEIVE)


class NativeObservation(RECEIVE.Receive):
    def setUp(self):
        super().setUp()
        fixture = self.fixture.read_text()
        needle = "    action=json.loads(line)\n"
        addition = (
            "    if 'native_line' in action:\n"
            "        print(action['native_line'],flush=True)\n"
            "        reply({'line_written':action['native_line']})\n"
            "        continue\n"
            "    if 'native_frame' in action:\n"
            "        print(json.dumps(action['native_frame']),flush=True)\n"
            "        reply({'frame_written':True})\n"
            "        continue\n")
        self.assertIn(needle, fixture)
        self.fixture.write_text(fixture.replace(needle, needle + addition, 1))

    def eventually_slow_case(self, observation, description):
        while True:
            result = observation()
            if result:
                return result
            time.sleep(.01)

    def test_mixed_agent_end_members_preserve_completion_and_raw_frame(self):
        self.player(harness='omp')
        self.coord('message', 'mixed-task', 'root', 'parent', 'task', 'Read this task.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Observation receive exited before native startup')
        self.assertIn('[id: mixed-task]', started['prompt'])

        for line in ('', 'not-json', 'null'):
            self.action(stream, native_line=line)
            self.assertEqual(json.loads(stream.readline()), {'line_written': line})

        self.action(stream, native_frame={
            'type': 'response', 'command': 'get_state', 'success': True,
            'id': 'metadata-only', 'data': {'sessionId': 'omp-native', 'model': {'provider': 'fixture', 'id': 'model'}}})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})

        terminal = {
            'type': 'agent_end', 'isTerminal': True, 'is_error': False,
            'messages': [
                {'role': 'assistant', 'content': 'plain string content'},
                {'role': 'assistant', 'content': [
                    {'type': 'text', 'text': 'Observed completion text.'},
                    'plain string content block', None, {'metadata': 'content metadata'},
                ]},
                '…[181 items elided for RPC frame]', None, {'metadata': 'retained in raw log'},
            ],
        }
        self.action(stream, native_frame=terminal)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(observer)

        turns = self.coord('turns', 'parent')
        self.assertEqual([row['reportBody'] for row in turns], ['Observed completion text.'])
        log = self.output_log('parent').read_text()
        self.assertIn('181 items elided for RPC frame', log)
        self.assertIn('plain string content block', log)
        self.assertIn('not-json', log)
        self.assertEqual(self.coord('player', 'parent')['native'], 'omp-native')
        self.assertFalse(any('Native output observation failed' in row['body']
                             for row in self.coord('inbox', 'root')))
        self.shutdown_idle_database_owner('fixture database owner did not exit')

    def test_muse_uses_admitted_turn_terminal_and_keeps_later_lifecycle_separate(self):
        self.player(harness='muse')
        fake = self.directory / 'muse native fixture'
        task = self.directory / 'muse task.txt'
        task.write_text('Review this report.')
        log = self.directory / 'muse direct turn.jsonl'
        frames = [
            {'id': 'input-frame', 'payload_type': 'turn.input.user',
             'payload': {'kind': 'turn_input_user', 'command_id': 'primary-run'}},
            {'id': 'unlinked-frame', 'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'terminal': 'completed',
                         'text': 'Terminal without command identity.'}},
            {'id': 'nested-frame', 'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'command_id': 'nested-run',
                         'terminal': 'completed', 'text': 'Nested task completion.'}},
            {'id': 'primary-frame', 'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'command_id': 'primary-run',
                         'terminal': 'completed', 'text': 'Primary completion.'}},
            {'id': 'primary-frame', 'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'command_id': 'primary-run',
                         'terminal': 'completed', 'text': 'Primary completion.'}},
            {'id': 'changed-primary-frame', 'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'command_id': 'primary-run',
                         'terminal': 'completed', 'text': 'Changed primary output.'}},
            {'id': 'later-input', 'payload_type': 'turn.input.user',
             'payload': {'kind': 'turn_input_user', 'command_id': 'later-run'}},
            {'id': 'later-frame', 'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'command_id': 'later-run',
                         'terminal': 'completed', 'text': 'Later lifecycle completion.'}},
        ]
        fake.write_text('#!' + sys.executable + '\nimport json\nframes=' + repr(frames) +
                        '\nfor frame in frames: print(json.dumps(frame), flush=True)\n')
        fake.chmod(0o755)
        result = subprocess.run([str(RECEIVE.EXE), str(self.db), 'turn', 'parent',
                                 'muse-observation-turn', str(fake), 'parent', 'low',
                                 str(self.checkouts / 'parent'), str(task), str(log), ''],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.output_log('parent')

        turns = self.coord('turns', 'parent')
        self.assertEqual([row['reportBody'] for row in turns], ['Primary completion.'])
        reports = [row for row in self.coord('inbox', 'root') if row['kind'] == 'report']
        deferred = [row for row in reports if row['id'].endswith(':deferred')]
        self.assertEqual(len(deferred), 1)
        self.assertIn('later native terminal completed', deferred[0]['body'])
        self.assertTrue(any('original report is preserved' in row['body'] for row in reports))
        self.assertFalse(any('Nested task completion' in row['body'] for row in reports))
        self.assertFalse(any('Terminal without command identity.' in row['body'] for row in reports))
        self.assertFalse(any('Native output observation failed' in row['body'] for row in reports))
        self.assertIn('primary-frame', log.read_text())
        self.assertIn('unlinked-frame', log.read_text())
        self.assertIn('nested-frame', log.read_text())
        self.assertIn('Changed primary output.', log.read_text())
        self.assertIn('Later lifecycle completion.', log.read_text())

    def test_omp_fallback_message_survives_observer_reattach_at_saved_cursor(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.coord('message', 'checkpoint-task', 'root', 'parent', 'task', 'Retain the assistant message before the terminal.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Observation receive exited before native startup')

        assistant = {'type': 'message_end', 'message': {
            'id': 'checkpoint-assistant', 'role': 'assistant', 'provider': 'fixture',
            'content': [{'type': 'text', 'text': 'Recovered from the saved assistant message.'}]}}
        self.action(stream, native_frame=assistant)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: self.output_log('parent').exists() and
                        'checkpoint-assistant' in self.output_log('parent').read_text(),
                        'the assistant frame was not durably observed')
        barrier = {'type': 'checkpoint-barrier'}
        self.action(stream, native_frame=barrier)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: 'checkpoint-barrier' in
                        self.output_log('parent').read_text(),
                        'the observer did not finish the assistant checkpoint before the barrier')

        observer.kill()
        observer.wait()
        resumed = self.spawn(*self.receive_args('parent'))
        self.action(stream, native_frame={'type': 'agent_end', 'isTerminal': True,
                                          'is_error': False, 'messages': []})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(resumed)

        turns = self.eventually(lambda: self.coord('turns', 'parent'),
                                'reattached observer did not store its terminal report')
        self.assertEqual([row['reportBody'] for row in turns],
                         ['Recovered from the saved assistant message.'])
        log = self.output_log('parent').read_text()
        self.assertEqual(log.count('checkpoint-assistant'), 1)
        self.assertIn('agent_end', log)
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual([launch['pid'] for launch in launches], [started['pid']])
        self.assertFalse(any('Native output observation failed' in row['body']
                             for row in self.coord('inbox', 'root')))
        self.shutdown_idle_database_owner('fixture database owner did not exit after OMP completion')

    def test_omp_completion_survives_observer_reattach(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.coord('message', 'reattach-checkpoint-task', 'root', 'parent', 'task', 'Retain this complete response.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Observation receive exited before native startup')
        text = 'The complete native response remains available after observer recovery.'
        assistant = {'type': 'message_end', 'message': {
            'id': 'reattach-checkpoint-assistant', 'role': 'assistant', 'provider': 'fixture',
            'content': [{'type': 'text', 'text': text}]}}
        self.action(stream, native_frame=assistant)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: self.output_log('parent').exists() and
                        'reattach-checkpoint-assistant' in self.output_log('parent').read_text(),
                        'the complete assistant frame was not logged')
        self.action(stream, native_frame={'type': 'checkpoint-barrier'})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: 'checkpoint-barrier' in self.output_log('parent').read_text(),
                        'observer did not consume the checkpoint barrier')

        observer.kill()
        observer.wait()
        resumed = self.spawn(*self.receive_args('parent'))
        terminal = {'type': 'agent_end', 'isTerminal': True, 'is_error': False, 'messages': []}
        self.action(stream, native_frame=terminal)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(resumed)

        turns = self.eventually_slow_case(
            lambda: self.coord('turns', 'parent'),
            'reattached observer did not preserve the completion')
        self.assertEqual(len(turns), 1)
        report_body = turns[0]['reportBody']
        self.assertEqual(len(report_body), len(text))
        self.assertEqual(hashlib.sha256(report_body.encode()).hexdigest(),
                         hashlib.sha256(text.encode()).hexdigest())
        reports = [row for row in self.coord('inbox', 'root') if row['kind'] == 'report']
        self.assertFalse(any('Native output observation failed' in row['body'] for row in reports))
        log = self.output_log('parent').read_text()
        assistant_frames = [json.loads(line) for line in log.splitlines()
                            if 'reattach-checkpoint-assistant' in line]
        self.assertEqual(len(assistant_frames), 1)
        raw_text = assistant_frames[0]['message']['content'][0]['text']
        self.assertEqual(len(raw_text), len(text))
        self.assertEqual(hashlib.sha256(raw_text.encode()).hexdigest(),
                         hashlib.sha256(text.encode()).hexdigest())
        barrier_frames = [json.loads(line) for line in log.splitlines()
                          if 'checkpoint-barrier' in line]
        self.assertEqual(len(barrier_frames), 2)
        self.assertEqual(barrier_frames[0], barrier_frames[1])
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual([launch['pid'] for launch in launches], [started['pid']])
        self.shutdown_idle_database_owner('fixture database owner did not exit after OMP completion')

    def test_omp_provider_error_terminal_records_failure_not_success(self):
        self.player(harness='omp')
        self.coord('message', 'provider-error-task', 'root', 'parent', 'task', 'Read this task.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Observation receive exited before native startup')
        self.assertIn('[id: provider-error-task]', started['prompt'])
        terminal = {
            'type': 'agent_end', 'isTerminal': True, 'is_error': False,
            'messages': [
                {'role': 'user', 'content': [{'type': 'text', 'text': 'Read this task.'}]},
                {'role': 'assistant', 'content': [
                    {'type': 'text', 'text': 'Earlier successful assistant text.'}]},
                {'role': 'assistant', 'stopReason': 'error', 'errorStatus': 403,
                 'errorMessage': '403 {"error":{"type":"permission_error","message":"fixture provider refusal"}}',
                 'content': [{'type': 'text', 'text': 'Unfinished assistant text.'}]},
                '…[181 items elided for RPC frame]', None, {'metadata': 'retained marker'},
            ],
        }
        self.action(stream, native_frame=terminal)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        _, stderr = self.finish(observer, ok=False)

        self.assertIn('Native receive failed;', stderr)
        turns = self.eventually(lambda: self.coord('turns', 'parent'),
                                'error terminal did not store its failure report')
        self.assertEqual(len(turns), 1)
        body = turns[0]['reportBody']
        self.assertIn('OMP provider failure', body)
        self.assertIn('403', body)
        self.assertIn('fixture provider refusal', body)
        self.assertNotIn('Earlier successful assistant text.', body)
        self.assertNotIn('Unfinished assistant text.', body)
        self.assertNotIn('agent_end', body)
        log = self.output_log('parent').read_text()
        self.assertIn('stopReason', log)
        self.assertIn('errorStatus', log)
        self.assertTrue(any(row['id'] == 'provider-error-task'
                            for row in self.coord('inbox', 'parent')))
        self.shutdown_idle_database_owner('fixture database owner did not exit')

    def test_omp_late_failure_keeps_the_sealed_result_and_reports_failure(self):
        self.player(harness='omp')
        self.coord('message', 'stale-success-task', 'root', 'parent', 'task', 'Read this task.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Observation receive exited before native startup')
        self.assertIn('[id: stale-success-task]', started['prompt'])
        success = {'type': 'agent_end', 'isTerminal': True, 'is_error': False,
                   'messages': [{'role': 'assistant', 'content': [
                       {'type': 'text', 'text': 'Stale success text.'}]}]}
        self.action(stream, native_frame=success)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: self.coord('turns', 'parent'),
                        'first terminal did not seal its report')
        refusal = {'type': 'agent_end', 'isTerminal': True, 'is_error': False,
                   'messages': [{'role': 'assistant', 'stopReason': 'error', 'errorStatus': 403,
                                 'errorMessage': '403 {"error":{"message":"fixture late refusal"}}',
                                 'content': []}]}
        self.action(stream, native_frame=refusal)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        turns = self.eventually(lambda: self.coord('turns', 'parent'),
                                'sealed success report was not retained')
        self.assertEqual(turns[0]['reportBody'], 'Stale success text.')
        reports = [row for row in self.coord('inbox', 'root') if row['kind'] == 'report']
        deferred = next((row for row in reports if row['id'].endswith(':deferred')), None)
        self.assertIsNotNone(deferred)
        self.assertIn('failed after the report', deferred['body'])
        self.assertIn('OMP provider failure', deferred['body'])
        self.assertIn('fixture late refusal', deferred['body'])
        self.assertNotIn('Stale success text.', deferred['body'])
        log = self.output_log('parent').read_text()
        self.assertIn('Stale success text.', log)
        self.assertIn('stopReason', log)
        self.assertIsNotNone(self.coord('delivery', 'stale-success-task')['receipt'])
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            sealed = json.loads(database.execute(
                'SELECT event FROM turns WHERE id=?', (turns[0]['id'],)).fetchone()[0])
        self.assertEqual(sealed, success)
        self.shutdown_idle_database_owner('fixture database owner did not exit')

    def test_observe_file_reads_mixed_omp_terminals_and_nested_failure(self):
        self.player(harness='omp')
        for failed in (False, True):
            with self.subTest(failed=failed):
                assistant = {'role': 'assistant', 'content': [
                    {'type': 'text', 'text': 'Observed file completion.'},
                    'content marker', None, {'metadata': 'content metadata'},
                ]}
                if failed:
                    assistant.update(stopReason='error', errorStatus=403,
                                     errorMessage='fixture file provider refusal')
                terminal = {'type': 'agent_end', 'isTerminal': True,
                            'messages': [assistant, 'message marker', None,
                                         {'metadata': 'message metadata'}]}
                event = self.directory / ('mixed-file-' + str(failed) + '.json')
                event.write_text(json.dumps(terminal))
                ident = 'mixed-file-' + str(failed)
                self.coord('observe-file', ident, 'parent', event)
                body = self.coord('delivery', ident)['body']
                if failed:
                    self.assertIn('OMP provider failure', body)
                    self.assertIn('403', body)
                    self.assertIn('fixture file provider refusal', body)
                    self.assertNotIn('Observed file completion.', body)
                else:
                    self.assertEqual(body, 'Observed file completion.')
                self.assertEqual(json.loads(event.read_text()), terminal)

    def test_omp_earlier_error_with_successful_latest_assistant_stays_successful(self):
        self.player(harness='omp')
        self.coord('message', 'latest-success-task', 'root', 'parent', 'task', 'Read this task.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Observation receive exited before native startup')
        self.assertIn('[id: latest-success-task]', started['prompt'])
        terminal = {
            'type': 'agent_end', 'isTerminal': True, 'is_error': False,
            'messages': [
                {'role': 'assistant', 'stopReason': 'error', 'errorStatus': 500,
                 'errorMessage': '500 {"error":{"message":"earlier refusal, superseded"}}',
                 'content': []},
                {'role': 'assistant', 'content': [
                    {'type': 'text', 'text': 'Latest successful assistant text.'}]},
            ],
        }
        self.action(stream, native_frame=terminal)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(observer)

        turns = self.eventually(lambda: self.coord('turns', 'parent'),
                                'successful latest assistant did not store its report')
        self.assertEqual([row['reportBody'] for row in turns],
                         ['Latest successful assistant text.'])
        self.assertFalse(any(row['id'] == 'latest-success-task'
                             for row in self.coord('inbox', 'parent')))
        self.shutdown_idle_database_owner('fixture database owner did not exit')

    def _retained_attempt(self):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute("SELECT directory,id FROM executions WHERE session='parent' AND mode='retained'").fetchone()
        return (row[0], row[1]) if row else None

    def test_log_write_failure_remains_an_observation_failure(self):
        self.player(harness='omp')
        self.coord('message', 'log-failure-task', 'root', 'parent', 'task', 'Retain this output.')
        args = self.receive_args('parent')
        args[-2] = str(self.fixture / 'parent.jsonl')
        observer = self.spawn(*args)
        stream, _ = self.accept_child(observer, 'parent',
                                      'Observer exited before native startup')
        _, turn_id = self.eventually(lambda: self._retained_attempt(), 'retained attempt was not admitted')
        self.action(stream, native_frame={'type': 'message_end', 'message': {
            'id': 'log-failure-assistant', 'role': 'assistant', 'provider': 'fixture',
            'content': [{'type': 'text', 'text': 'This output must not be reported as successful.'}]}})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, native_frame={'type': 'agent_end', 'isTerminal': True,
                                          'is_error': False, 'messages': []})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        _, stderr = self.finish(observer, ok=False)

        reports = [row for row in self.coord('inbox', 'root') if row['kind'] == 'report']
        self.assertIn('Native receive failed;', stderr)
        observation = next((row for row in reports if row['id'] == turn_id + ':observation'), None)
        self.assertIsNotNone(observation)
        self.assertIn('Native output observation failed:', observation['body'])
        self.assertIn('Not a directory', observation['body'])
        self.assertEqual(self.coord('turns', 'parent'), [])
        self.assertFalse(any(row['id'] == turn_id + ':checkpoint' for row in reports))
        self.assertFalse(pathlib.Path(args[-2]).exists())
        directory, retained_turn = self._retained_attempt()
        self.assertEqual(retained_turn, turn_id)
        self.assertIn('log-failure-assistant', (pathlib.Path(directory) / 'stdout').read_text())
        self.assertTrue(any(row['id'] == 'log-failure-task'
                            for row in self.coord('inbox', 'parent')))

def load_tests(loader, tests, pattern):
    declared = sorted(name for name in vars(NativeObservation) if name.startswith('test_'))
    return loader.loadTestsFromNames(declared, NativeObservation)


if __name__ == '__main__':
    unittest.main()
