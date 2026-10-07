"""Exercise terminal observation across mixed native frame shapes and nested runs."""

import importlib.util
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import sys
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

    def test_mixed_agent_end_members_preserve_completion_and_raw_frame(self):
        self.player(harness='omp')
        self.coord('message', 'mixed-task', 'root', 'parent', 'task', 'Read this task.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
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
        log = (self.directory / 'parent.jsonl').read_text()
        self.assertIn('181 items elided for RPC frame', log)
        self.assertIn('plain string content block', log)
        self.assertIn('not-json', log)
        self.assertEqual(self.coord('player', 'parent')['native'], 'omp-native')
        self.assertFalse(any('Native output observation failed' in row['body']
                             for row in self.coord('inbox', 'root')))
        self.eventually(lambda: not self.owned_processes(), 'native observer processes did not exit')

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
        stream, started = self.accept('parent')

        assistant = {'type': 'message_end', 'message': {
            'id': 'checkpoint-assistant', 'role': 'assistant', 'provider': 'fixture',
            'content': [{'type': 'text', 'text': 'Recovered from the saved assistant message.'}]}}
        self.action(stream, native_frame=assistant)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: (self.directory / 'parent.jsonl').exists() and
                        'checkpoint-assistant' in (self.directory / 'parent.jsonl').read_text(),
                        'the assistant frame was not durably observed')
        barrier = {'type': 'checkpoint-barrier'}
        self.action(stream, native_frame=barrier)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: 'checkpoint-barrier' in
                        (self.directory / 'parent.jsonl').read_text(),
                        'the observer did not finish the assistant checkpoint before the barrier')

        observer.kill()
        observer.wait(timeout=5)
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
        log = (self.directory / 'parent.jsonl').read_text()
        self.assertEqual(log.count('checkpoint-assistant'), 1)
        self.assertIn('agent_end', log)
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual([launch['pid'] for launch in launches], [started['pid']])
        self.assertFalse(any('Native output observation failed' in row['body']
                             for row in self.coord('inbox', 'root')))
        self.eventually(lambda: not self.owned_processes(), 'reattached OMP fixture did not exit')

    def test_oversized_omp_checkpoint_failure_replays_without_losing_completion(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.coord('message', 'oversized-checkpoint-task', 'root', 'parent', 'task', 'Retain this complete large response.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        attempt, turn_id = self.eventually(lambda: self._retained_attempt(), 'retained attempt was not admitted')
        text = 'R' * (1024 * 1024 + 128 * 1024)
        assistant = {'type': 'message_end', 'message': {
            'id': 'oversized-checkpoint-assistant', 'role': 'assistant', 'provider': 'fixture',
            'content': [{'type': 'text', 'text': text}]}}
        self.action(stream, native_frame=assistant)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: (self.directory / 'parent.jsonl').exists() and
                        'oversized-checkpoint-assistant' in (self.directory / 'parent.jsonl').read_text(),
                        'the complete oversized assistant frame was not logged')
        checkpoint_diagnostic = self.eventually(
            lambda: next((row for row in self.coord('inbox', 'root')
                          if row['id'] == turn_id + ':checkpoint'), None),
            'oversized checkpoint failure did not produce its bounded diagnostic')
        self.assertIn(attempt, checkpoint_diagnostic['body'])
        self.assertLess(len(checkpoint_diagnostic['body']), 512)
        self.action(stream, native_frame={'type': 'checkpoint-barrier'})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: 'checkpoint-barrier' in (self.directory / 'parent.jsonl').read_text(),
                        'observer did not consume the oversized-frame barrier')

        observer.kill()
        observer.wait(timeout=5)
        resumed = self.spawn(*self.receive_args('parent'))
        terminal = {'type': 'agent_end', 'isTerminal': True, 'is_error': False, 'messages': []}
        self.action(stream, native_frame=terminal)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(resumed)

        turns = self.eventually(lambda: self.coord('turns', 'parent'),
                                'reattached observer did not preserve the oversized completion')
        self.assertEqual(len(turns), 1)
        report_body = turns[0]['reportBody']
        self.assertEqual(len(report_body), len(text))
        self.assertEqual(hashlib.sha256(report_body.encode()).hexdigest(),
                         hashlib.sha256(text.encode()).hexdigest())
        reports = [row for row in self.coord('inbox', 'root') if row['kind'] == 'report']
        checkpoint_reports = [row for row in reports if row['id'] == turn_id + ':checkpoint']
        self.assertEqual(len(checkpoint_reports), 1)
        self.assertFalse(any('Native output observation failed' in row['body'] for row in reports))
        log = (self.directory / 'parent.jsonl').read_text()
        self.assertEqual(log.count('oversized-checkpoint-assistant'), 1)
        self.assertEqual(log.count('checkpoint-barrier'), 1)
        assistant_frames = [json.loads(line) for line in log.splitlines()
                            if 'oversized-checkpoint-assistant' in line]
        raw_text = assistant_frames[0]['message']['content'][0]['text']
        self.assertEqual(len(raw_text), len(text))
        self.assertEqual(hashlib.sha256(raw_text.encode()).hexdigest(),
                         hashlib.sha256(text.encode()).hexdigest())
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual([launch['pid'] for launch in launches], [started['pid']])
        self.eventually(lambda: not self.owned_processes(), 'oversized OMP fixture did not exit')

    def _retained_attempt(self):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute("SELECT directory,id FROM executions WHERE session='parent' AND mode='retained'").fetchone()
        return (row[0], row[1]) if row else None

if __name__ == '__main__':
    unittest.main(defaultTest=[
        'NativeObservation.test_mixed_agent_end_members_preserve_completion_and_raw_frame',
        'NativeObservation.test_muse_uses_admitted_turn_terminal_and_keeps_later_lifecycle_separate',
        'NativeObservation.test_omp_fallback_message_survives_observer_reattach_at_saved_cursor',
        'NativeObservation.test_oversized_omp_checkpoint_failure_replays_without_losing_completion',
    ])
