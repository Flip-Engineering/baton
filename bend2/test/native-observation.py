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
        fixture = fixture.replace("omp='--mode' in args\n", "omp='--mode' in args\nmuse='--prompt-file' in args\n", 1)
        fixture = fixture.replace(
            "resume=args[args.index('--resume')+1] if '--resume' in args else (native_args[2] if native_args[:2]==['exec','resume'] else '')\n",
            "resume=args[args.index('--resume')+1] if '--resume' in args else (args[args.index('--session-id')+1] if '--session-id' in args else (native_args[2] if native_args[:2]==['exec','resume'] else ''))\n",
            1)
        fixture = fixture.replace(
            "if omp:\n    json.loads(sys.stdin.readline())\n",
            "if muse:\n    prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()\n    native=resume or config.get('muse_native','native-'+model)\n    command=config.get('muse_command','muse-primary')\n    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.model.configured','payload':{'kind':'run_model_configured','model_id':model}}),flush=True)\n    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user','payload':{'kind':'turn_input_user','command_id':command}}),flush=True)\nelif omp:\n    json.loads(sys.stdin.readline())\n",
            1)
        self.fixture.write_text(fixture.replace(needle, needle + addition, 1))

    def eventually_slow_case(self, observation, description):
        deadline = time.monotonic() + 180
        while True:
            result = observation()
            if result:
                return result
            self.assertLess(time.monotonic(), deadline, description)
            time.sleep(.01)

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

    def test_muse_retained_prompt_file_and_primary_terminal_survive_observer_reattach(self):
        self.player(harness='muse')
        seed_player = self.directory / 'muse session seed'
        seed_task = self.directory / 'seed task.txt'
        seed_task.write_text('Create the retained Muse session.')
        seed_player.write_text('#!' + sys.executable + '\n' + "import json\nsession='native-muse-retained'\nprint(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'run.model.configured','payload':{'kind':'run_model_configured','model_id':'parent'}}),flush=True)\nprint(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'turn.input.user','payload':{'kind':'turn_input_user','command_id':'seed-command'}}),flush=True)\nprint(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'run.terminal.completed','payload':{'kind':'run_terminal','terminal':'completed','command_id':'seed-command','text':'Session initialized.'}}),flush=True)\n")
        seed_player.chmod(0o755)
        seeded = subprocess.run([str(RECEIVE.EXE), str(self.db), 'turn', 'parent', 'muse-seed',
                                 str(seed_player), 'parent', 'low', str(self.repo), str(seed_task),
                                 str(self.directory / 'muse-seed.jsonl'), ''],
                                text=True, capture_output=True)
        self.assertEqual(seeded.returncode, 0, seeded.stderr)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(record_launches=True, muse_native='native-muse-retained',
                      muse_command='muse-primary-command')
        config_path.write_text(json.dumps(config))
        prompt = 'Review the report λ with exact prepared bytes.\nSecond line.'
        self.coord('message', 'muse-retained-task', 'root', 'parent', 'task', prompt)
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        self.assertEqual(started['native'], 'native-muse-retained')
        attempt, _ = self.eventually(lambda: self._retained_attempt(),
                                     'retained Muse attempt was not admitted')
        launches = self.directory / 'native-launches.jsonl'
        self.eventually(lambda: launches.exists() and launches.read_text(),
                        'retained Muse process launch was not recorded')
        launch_rows = [json.loads(line) for line in launches.read_text().splitlines()]
        self.assertEqual(len(launch_rows), 1)
        args = launch_rows[0]['args']
        prompt_path = pathlib.Path(args[args.index('--prompt-file') + 1])
        self.assertTrue(prompt_path.is_absolute())
        self.assertEqual(prompt_path.parent, attempt.resolve())
        self.assertEqual(prompt_path.read_bytes(), prompt.encode())
        self.assertEqual(args[args.index('--session-id') + 1], 'native-muse-retained')
        self.eventually(lambda: (self.directory / 'parent.jsonl').exists() and
                        'muse-primary-command' in (self.directory / 'parent.jsonl').read_text(),
                        'Muse primary command input was not observed')
        self.action(stream, native_frame={'id': 'muse-checkpoint-barrier',
                                          'payload_type': 'run.model.configured',
                                          'payload': {'kind': 'run_model_configured', 'model_id': 'parent'}})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: 'muse-checkpoint-barrier' in
                        (self.directory / 'parent.jsonl').read_text(),
                        'Muse primary reducer state was not checkpointed before observer loss')

        observer.kill()
        observer.wait(timeout=5)
        resumed = self.spawn(*self.receive_args('parent'))
        self.action(stream, native_frame={
            'id': 'unrelated-terminal', 'payload_type': 'run.terminal.completed',
            'payload': {'kind': 'run_terminal', 'terminal': 'completed',
                        'command_id': 'nested-command', 'text': 'Nested completion.'}})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, native_frame={
            'id': 'primary-terminal', 'payload_type': 'run.terminal.completed',
            'payload': {'kind': 'run_terminal', 'terminal': 'completed',
                        'command_id': 'muse-primary-command', 'text': 'Muse retained report.'}})
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.action(stream, exit_fixture=True)
        self.finish(resumed)

        turns = self.coord('turns', 'parent')
        self.assertEqual([row['reportBody'] for row in turns],
                         ['Session initialized.', 'Muse retained report.'])
        self.assertEqual(self.coord('player', 'parent')['native'], 'native-muse-retained')
        self.assertEqual(len(launches.read_text().splitlines()), 1,
                         'observer reattachment launched another native process')
        raw = (self.directory / 'parent.jsonl').read_text()
        self.assertIn('primary-terminal', raw)
        self.assertIn('unrelated-terminal', raw)
        reports = [row for row in self.coord('inbox', 'root') if row['kind'] == 'report']
        self.assertFalse(any('Native output observation failed' in row['body'] for row in reports))
        self.eventually(lambda: not self.owned_processes(), 'reattached Muse fixture did not exit')

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
        text = '"' * 400_000
        assistant = {'type': 'message_end', 'message': {
            'id': 'oversized-checkpoint-assistant', 'role': 'assistant', 'provider': 'fixture',
            'content': [{'type': 'text', 'text': text}]}}
        raw_frame = json.dumps(assistant, separators=(',', ':'))
        encoded_message = json.dumps(assistant['message'], separators=(',', ':'))
        encoded_state = json.dumps({'schema': 1, 'guidance_cursor': '0\n',
                                    'last_message': encoded_message,
                                    'muse_primary': '', 'muse_current': '', 'terminal': '',
                                    'filter_mode': '', 'codex_log': '', 'held': ''},
                                   separators=(',', ':'))
        self.assertLess(len(raw_frame.encode()), 1_000_000)
        self.assertGreater(len(encoded_state.encode()), 1 << 20)
        self.action(stream, native_frame=assistant)
        self.assertEqual(json.loads(stream.readline()), {'frame_written': True})
        self.eventually(lambda: (self.directory / 'parent.jsonl').exists() and
                        'oversized-checkpoint-assistant' in (self.directory / 'parent.jsonl').read_text(),
                        'the complete oversized assistant frame was not logged')
        checkpoint_diagnostic = self.eventually_slow_case(
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

        turns = self.eventually_slow_case(
            lambda: self.coord('turns', 'parent'),
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
        spool = (pathlib.Path(attempt) / 'stdout').read_text()
        self.assertEqual(spool.count('oversized-checkpoint-assistant'), 1)
        self.assertEqual(spool.count('checkpoint-barrier'), 1)
        assistant_frames = [json.loads(line) for line in log.splitlines()
                            if 'oversized-checkpoint-assistant' in line]
        self.assertEqual(len(assistant_frames), 2)
        self.assertEqual(assistant_frames[0], assistant_frames[1])
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
        self.eventually(lambda: not self.owned_processes(), 'oversized OMP fixture did not exit')

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
        stream, _ = self.accept('parent')
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
        self.assertIn('Not a directory', stderr)
        self.assertEqual(self.coord('turns', 'parent'), [])
        self.assertFalse(any(row['id'] == turn_id + ':checkpoint' for row in reports))
        self.assertFalse(pathlib.Path(args[-2]).exists())
        self.assertFalse(any('Native output observation failed' in row['body'] for row in reports))

if __name__ == '__main__':
    unittest.main(defaultTest=[
        'NativeObservation.test_mixed_agent_end_members_preserve_completion_and_raw_frame',
        'NativeObservation.test_muse_uses_admitted_turn_terminal_and_keeps_later_lifecycle_separate',
        'NativeObservation.test_omp_fallback_message_survives_observer_reattach_at_saved_cursor',
        'NativeObservation.test_oversized_omp_checkpoint_failure_replays_without_losing_completion',
        'NativeObservation.test_log_write_failure_remains_an_observation_failure',
    ])
