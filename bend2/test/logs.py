"""Log policy, rotation, storage inspection and cleanup checks."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

class Logs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.cwd = pathlib.Path(self.temp.name)
        self.db = self.cwd / 'state.db'
        self.task = self.cwd / 'task.txt'
        self.task.write_text('Log policy task.')
        self.log = self.cwd / 'turn.jsonl'
        self.events = self.cwd / 'events.jsonl'
        self.player = self.cwd / 'fixture-harness'
        self.repo = self.cwd / 'repository'
        self.repo.mkdir()
        self.checkouts = self.cwd / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Log fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'], check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach', 'root', 'native-fixture', 'root-session', 'root-endpoint')
        self.call('role', 'root', 'principal-conductor')
        self.register('omp-worker', 'root', 'omp', 'model', 'low')

    def register(self, name, parent, harness, model, effort):
        return self.call('recruit', name, parent, harness, model, effort, str(self.repo),
                         name + '-branch', str(self.checkouts / name), self.base)

    def tearDown(self): self.temp.cleanup()

    def call(self, *args):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout

    def refusal(self, *args):
        """A refused log command answers its rule on stderr with status 2."""
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 2, (p.stdout, p.stderr))
        return json.loads(p.stderr)

    def harness(self, body):
        """Write the fixture harness that replays this test's event file."""
        self.player.write_text('#!' + sys.executable + '\n' + body)
        self.player.chmod(0o700)

    def stream(self, frames, player='omp-worker', turn='turn-1'):
        """Write one native OMP stream, then run the turn over it."""
        self.events.write_text('\n'.join(frames) + '\n')
        self.harness('''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
''')
        return self.call('turn', player, turn, str(self.player), 'model', 'low',
                         str(self.cwd), str(self.task), str(self.log), '')

    def lines(self, path=None):
        return (path or self.log).read_text().splitlines()

    def rotated_frames(self):
        """Every frame line, oldest first, across the numbered segments and the live log."""
        lines = []
        for index in (4, 3, 2, 1):
            path = self.cwd / ('turn.jsonl.%d' % index)
            if path.exists() and path.is_file():
                lines += path.read_text().splitlines()
        lines += self.lines()
        return [line for line in lines if 'baton_log_rotation' not in line and 'baton_event_filter' not in line]

    def terminal(self, text='Complete answer λ'):
        return json.dumps({'type': 'agent_end', 'isTerminal': True,
                           'messages': [{'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}]})

    def test_default_policy_drops_snapshot_frames_and_keeps_evidence(self):
        payload = 'tool payload ' * 200
        frames = [
            json.dumps({'type': 'response', 'command': 'get_state', 'success': True, 'id': 'baton:session',
                        'data': {'sessionId': 'omp-default', 'model': {'provider': 'provider', 'id': 'actual'}}}),
            json.dumps({'type': 'message_update', 'messageId': 'm1', 'assistantMessageEvent': {'type': 'text_delta', 'delta': 'partial'}}),
            json.dumps({'type': 'tool_execution_update', 'toolCallId': 'tool-1', 'toolName': 'bash',
                        'partialResult': {'content': [{'type': 'text', 'text': payload}]}}),
            json.dumps({'type': 'tool_execution_start', 'toolCallId': 'tool-1', 'toolName': 'bash',
                        'args': {'command': 'echo ' + payload}}),
            json.dumps({'type': 'tool_execution_end', 'toolCallId': 'tool-1', 'toolName': 'bash',
                        'result': {'content': [{'type': 'text', 'text': payload}]}, 'isError': False}),
            json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'provider': 'provider',
                                                           'model': 'actual', 'content': [{'type': 'text', 'text': 'Complete answer λ'}]}}),
            self.terminal(),
            '{"probe":"unclassified frame"}',
        ]
        self.stream(frames)
        saved = self.lines()
        self.assertEqual([json.loads(line).get('type') for line in saved],
                         ['response', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
                          'message_end', 'agent_end', None, 'baton_event_filter'])
        self.assertEqual([f for f in map(json.loads, saved) if f.get('type') == 'message_update'], [])
        self.assertIn(payload, '\n'.join(saved))
        self.assertEqual(json.loads(self.call('delivery', 'turn-1'))['body'], 'Complete answer λ')
        self.assertEqual(json.loads(self.call('player', 'omp-worker'))['native'], 'omp-default')
        self.assertEqual(json.loads(self.call('logs', 'omp-worker'))['level'], 'default')

    def test_diagnostic_level_keeps_snapshot_frames(self):
        self.call('logs', 'omp-worker', 'diagnostic')
        frames = [
            json.dumps({'type': 'message_update', 'messageId': 'm1', 'assistantMessageEvent': {'type': 'text_delta', 'delta': 'partial λ'}}),
            json.dumps({'type': 'tool_execution_update', 'toolCallId': 'tool-1', 'partialResult': {'content': []}}),
            self.terminal(),
        ]
        self.stream(frames)
        note = '{"type":"baton_event_filter","requested":"delta","active":false,"outcome":"unacknowledged"}'
        self.assertEqual([json.loads(line).get('type') for line in self.lines()],
                         ['message_update', 'tool_execution_update', 'agent_end', 'baton_event_filter'])
        self.assertEqual(self.lines()[-1], note)
        self.assertEqual(json.loads(self.call('logs', 'omp-worker'))['level'], 'diagnostic')

    def test_quiet_level_keeps_terminal_and_unclassified_frames_alone(self):
        self.call('logs', 'omp-worker', 'quiet')
        frames = [
            json.dumps({'type': 'response', 'command': 'get_state', 'success': True, 'id': 'baton:session'}),
            json.dumps({'type': 'tool_execution_end', 'toolCallId': 'tool-1', 'isError': False}),
            self.terminal(),
            '{"probe":"unknown type"}',
        ]
        self.stream(frames)
        note = '{"type":"baton_event_filter","requested":"delta","active":false,"outcome":"unacknowledged"}'
        self.assertEqual(self.lines(), [self.terminal(), '{"probe":"unknown type"}', note])

    def test_policy_read_names_defaults_and_every_form_stores_one(self):
        self.assertEqual(json.loads(self.call('logs', 'omp-worker')),
                         {'session': 'omp-worker', 'level': 'default', 'budgetBytes': 33554432,
                          'keepSegments': 2, 'registeredLogs': 0})
        self.assertEqual(json.loads(self.call('logs', 'omp-worker', 'default', '1048576')),
                         {'session': 'omp-worker', 'level': 'default', 'budgetBytes': 1048576,
                          'keepSegments': 2, 'registeredLogs': 0})
        self.assertEqual(json.loads(self.call('logs', 'omp-worker', 'quiet', '1048576', '4')),
                         {'session': 'omp-worker', 'level': 'quiet', 'budgetBytes': 1048576,
                          'keepSegments': 4, 'registeredLogs': 0})
        self.assertEqual(json.loads(self.call('logs', 'omp-worker', 'diagnostic'))['level'], 'diagnostic')
        self.assertEqual(json.loads(self.call('logs', 'omp-worker'))['budgetBytes'], 1048576)
        self.assertEqual(self.refusal('logs', 'omp-worker', 'loud')['error'], 'invalid-log-setting')
        self.assertEqual(self.refusal('logs', 'omp-worker', 'default', '12')['error'], 'invalid-log-setting')
        self.assertEqual(self.refusal('logs', 'omp-worker', 'default', '1048576', '0')['error'], 'invalid-log-setting')
        self.assertEqual(self.refusal('logs', 'absent-session', 'default')['error'], 'unknown-session')
        self.assertEqual(json.loads(self.call('logs', 'omp-worker'))['level'], 'diagnostic')

    def test_rotation_retains_numbered_segments_and_notes_the_policy(self):
        self.call('logs', 'omp-worker', 'default', '65536', '2')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(10)]
        self.stream(frames + [self.terminal()])
        self.assertTrue((self.cwd / 'turn.jsonl.1').exists())
        live = self.lines()
        note = json.loads(live[0])
        self.assertEqual(note['type'], 'baton_log_rotation')
        self.assertEqual(note['level'], 'default')
        self.assertEqual(note['budgetBytes'], 65536)
        self.assertEqual(note['retainedSegments'], 2)
        self.assertEqual(note['moved'], [1])
        self.assertLess(self.log.stat().st_size, 65536 + len(self.terminal()) + 200)
        self.assertLessEqual((self.cwd / 'turn.jsonl.1').stat().st_size, 65536 + 20000)
        self.assertFalse((self.cwd / 'turn.jsonl.3').exists())
        note = '{"type":"baton_event_filter","requested":"delta","active":false,"outcome":"unacknowledged"}'
        self.assertEqual(live[-1], note)
        self.assertEqual(live[-2], self.terminal())
        self.assertEqual([json.loads(line).get('id') for line in self.rotated_frames()],
                         ['r%d' % i for i in range(10)] + [None])

    def test_rotation_is_skipped_while_input_is_unanswered(self):
        self.call('message', 'hold-1', 'root', 'omp-worker', 'guidance', 'Answer this before rotating.')
        self.call('logs', 'omp-worker', 'default', '65536', '2')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(10)]
        self.stream(frames + [self.terminal()])
        live = self.lines()
        skipping = [line for line in live if '"skipped":"pending-input"' in line]
        self.assertTrue(skipping, live[-3:])
        self.assertEqual(json.loads(skipping[0])['budgetBytes'], 65536)
        self.assertFalse((self.cwd / 'turn.jsonl.1').exists())
        self.assertGreater(self.log.stat().st_size, 65536)
        self.assertEqual(json.loads(self.call('inbox', 'omp-worker'))[0]['id'], 'hold-1')

    def test_rotation_stops_when_a_shift_step_fails(self):
        self.call('logs', 'omp-worker', 'default', '65536', '2')
        blocker = self.cwd / 'turn.jsonl.2'
        blocker.mkdir()
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(10)]
        self.stream(frames + [self.terminal()])
        self.assertTrue(blocker.is_dir())
        self.assertTrue((self.cwd / 'turn.jsonl.1').exists())
        live = self.lines()
        self.assertEqual(len([line for line in live if '"moved"' in line]), 1)
        failures = [json.loads(line) for line in live if '"failed":true' in line]
        self.assertTrue(failures, live[-4:])
        self.assertTrue(all('error' in item for item in failures), failures)
        self.assertIn('r9', self.log.read_text())
        self.assertIn('r0', (self.cwd / 'turn.jsonl.1').read_text())
        self.assertTrue(blocker.is_dir())
        self.assertTrue((self.cwd / 'turn.jsonl.1').exists())

    def test_rotation_removes_the_segment_above_the_count(self):
        self.call('logs', 'omp-worker', 'default', '65536', '1')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(10)]
        self.stream(frames + [self.terminal()])
        self.assertTrue((self.cwd / 'turn.jsonl.1').exists())
        self.assertFalse((self.cwd / 'turn.jsonl.2').exists())

    def test_storage_previews_rotated_segments_without_writing(self):
        self.call('logs', 'omp-worker', 'default', '65536', '4')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(16)]
        self.stream(frames + [self.terminal()])
        self.call('logs', 'omp-worker', 'default', '65536', '1')
        before = sorted(p.name for p in self.cwd.iterdir())
        report = json.loads(self.call('logs-storage'))
        self.assertEqual(report['defaults'], {'level': 'default', 'budgetBytes': 33554432, 'keepSegments': 2})
        self.assertGreater(report['databaseBytes'], 0)
        entry = [row for row in report['logs'] if row['path'] == str(self.log)][0]
        self.assertEqual(entry['session'], 'omp-worker')
        self.assertEqual(entry['level'], 'default')
        self.assertEqual(entry['budgetBytes'], 65536)
        self.assertEqual(entry['keepSegments'], 1)
        self.assertGreater(entry['bytes'], 0)
        indexed = {row['index']: row for row in entry['rotated']}
        self.assertIn(1, indexed)
        self.assertIn(2, indexed)
        self.assertFalse(indexed[1]['eligible'])
        self.assertTrue(indexed[2]['eligible'])
        self.assertGreater(indexed[2]['bytes'], 0)
        self.assertEqual(sorted(p.name for p in self.cwd.iterdir()), before)
        self.assertEqual(len(report['attempts']), 0)

    def test_cleanup_removes_only_eligible_segments_of_the_named_session(self):
        self.call('logs', 'omp-worker', 'default', '65536', '4')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(16)]
        self.stream(frames + [self.terminal()])
        self.register('second-worker', 'root', 'omp', 'model', 'low')
        self.log = self.cwd / 'second.jsonl'
        self.stream([self.terminal('Second answer')], 'second-worker', 'second-turn')
        kept = (self.cwd / 'second.jsonl').read_text()
        second_rotated = sorted(p.name for p in self.cwd.glob('second.jsonl.*'))
        self.call('logs', 'omp-worker', 'default', '65536', '1')
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual(answer['session'], 'omp-worker')
        self.assertTrue(all(item['removed'] for item in answer['removed']), answer)
        self.assertEqual(sorted(item['index'] for item in answer['removed']), [2, 3])
        self.assertTrue(all(item['bytes'] > 0 for item in answer['removed']), answer)
        self.assertTrue((self.cwd / 'turn.jsonl.1').exists())
        self.assertFalse((self.cwd / 'turn.jsonl.2').exists())
        self.assertFalse((self.cwd / 'turn.jsonl.3').exists())
        self.assertTrue(self.log.exists())
        self.assertEqual((self.cwd / 'second.jsonl').read_text(), kept)
        self.assertEqual(sorted(p.name for p in self.cwd.glob('second.jsonl.*')), second_rotated)
        self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['removed'], [])
        self.assertEqual(self.refusal('logs-clean', 'absent-session')['error'], 'unknown-session')

    def test_cleanup_during_a_live_turn_keeps_the_live_log(self):
        self.call('logs', 'omp-worker', 'default', '65536', '1')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(6)]
        self.events.write_text('\n'.join(frames) + '\n')
        self.harness('''import pathlib,sys,time
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
pathlib.Path('events.jsonl').read_text() and print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
while not pathlib.Path('release').exists(): time.sleep(.05)
print(%r,flush=True)
assert sys.stdin.read()==''
''' % self.terminal('Concurrent answer'))
        turn = subprocess.Popen([str(EXE), str(self.db), 'turn', 'omp-worker', 'turn-1', str(self.player),
                                 'model', 'low', str(self.cwd), str(self.task), str(self.log), ''],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(600):
                if (self.cwd / 'turn.jsonl.1').exists(): break
                if turn.poll() is not None: self.fail(turn.communicate()[1])
                subprocess.run(['sleep', '.05'])
            self.assertTrue((self.cwd / 'turn.jsonl.1').exists(), 'the turn did not rotate its live log')
            self.assertEqual(json.loads(self.call('logs-storage'))['logs'][0]['session'], 'omp-worker')
            self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['removed'], [])
            (self.cwd / 'release').write_text('go\n')
            stdout, stderr = turn.communicate(timeout=60)
        finally:
            if turn.poll() is None: turn.kill()
        self.assertEqual(turn.returncode, 0, stderr)
        self.assertIn(self.terminal('Concurrent answer'), self.lines())
        self.assertEqual(json.loads(self.call('delivery', 'turn-1'))['body'], 'Concurrent answer')

    def test_interrupted_tool_call_keeps_only_its_last_update(self):
        updates = [json.dumps({'type': 'tool_execution_update', 'toolCallId': 'tool-1', 'toolName': 'bash',
                               'partialResult': {'content': [{'type': 'text', 'text': 'partial %d' % i}]}})
                   for i in range(3)]
        self.stream(updates + [self.terminal()])
        saved = self.lines()
        note = '{"type":"baton_event_filter","requested":"delta","active":false,"outcome":"unacknowledged"}'
        self.assertEqual([json.loads(line)['type'] for line in saved], ['agent_end', 'tool_execution_update', 'baton_event_filter'])
        self.assertEqual(json.loads(saved[-2])['partialResult']['content'][0]['text'], 'partial 2')

    def test_message_start_is_kept_only_without_its_message_end(self):
        frames = [
            json.dumps({'type': 'message_start', 'messageId': 'open-1', 'message': {'role': 'assistant', 'content': []}}),
            json.dumps({'type': 'message_start', 'messageId': 'closed-1', 'message': {'role': 'assistant', 'content': []}}),
            json.dumps({'type': 'message_end', 'messageId': 'closed-1',
                        'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'done'}]}}),
            self.terminal(),
        ]
        self.stream(frames)
        self.assertEqual([json.loads(line).get('type') for line in self.lines()],
                         ['message_end', 'agent_end', 'message_start', 'baton_event_filter'])
        self.assertEqual([json.loads(line).get('messageId') for line in self.lines()][:3],
                         ['closed-1', None, 'open-1'])

    def test_cleanup_keeps_segments_while_input_is_unanswered(self):
        self.call('logs', 'omp-worker', 'default', '65536', '2')
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i, 'command': 'probe', 'pad': 'y' * 20000}) for i in range(16)]
        self.stream(frames + [self.terminal()])
        self.call('logs', 'omp-worker', 'default', '65536', '1')
        self.call('message', 'hold-2', 'root', 'omp-worker', 'guidance', 'Answer this before cleanup.')
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual(answer['removed'], [])
        self.assertEqual(answer['skipped'], 'pending-input')
        self.assertEqual(answer['pendingInput'], 1)
        self.assertTrue((self.cwd / 'turn.jsonl.1').exists())
        self.assertTrue((self.cwd / 'turn.jsonl.2').exists())

    def test_retention_count_above_four_preserves_requested_history(self):
        policy = json.loads(self.call('logs', 'omp-worker', 'default', '65536', '7'))
        self.assertEqual(policy['keepSegments'], 7)
        frames = [json.dumps({'type': 'response', 'id': 'r%d' % i,
                             'command': 'probe', 'pad': 'y' * 40000}) for i in range(20)]
        self.stream(frames + [self.terminal()])
        self.assertTrue((self.cwd / 'turn.jsonl.7').exists())
        self.assertFalse((self.cwd / 'turn.jsonl.8').exists())
        entry = next(row for row in json.loads(self.call('logs-storage'))['logs']
                     if row['path'] == str(self.log))
        self.assertEqual({row['index'] for row in entry['rotated']}, set(range(1, 8)))
        self.call('logs', 'omp-worker', 'default', '65536', '2')
        removed = json.loads(self.call('logs-clean', 'omp-worker'))['removed']
        self.assertEqual({row['index'] for row in removed}, set(range(3, 8)))
        self.assertTrue(all(row['removed'] for row in removed))
        self.assertTrue((self.cwd / 'turn.jsonl.2').exists())

    def test_input_arriving_during_turn_protects_existing_segments(self):
        import time
        self.call('logs', 'omp-worker', 'default', '65536', '1')
        protected = self.cwd / 'turn.jsonl.1'
        protected.write_text('sole earlier evidence\n')
        self.harness("""import pathlib,sys,time
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
pathlib.Path('ready').write_text('ready')
while not pathlib.Path('release').exists(): time.sleep(.01)
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
""")
        self.events.write_text('\n'.join(json.dumps({'type': 'response', 'id': 'r%d' % i,
                                                    'pad': 'z' * 40000}) for i in range(6))
                               + '\n' + self.terminal() + '\n')
        turn = subprocess.Popen([str(EXE), str(self.db), 'turn', 'omp-worker', 'late-input-turn',
                                 str(self.player), 'model', 'low', str(self.cwd), str(self.task),
                                 str(self.log), ''], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True)
        try:
            deadline = time.monotonic() + 30
            while not (self.cwd / 'ready').exists():
                self.assertIsNone(turn.poll(), 'turn stopped before harness was ready')
                self.assertLess(time.monotonic(), deadline, 'harness readiness deadline')
                time.sleep(.01)
            self.call('message', 'late-guidance', 'root', 'omp-worker', 'guidance',
                      'Keep the earlier evidence until this input is answered.')
            (self.cwd / 'release').write_text('go')
            stdout, stderr = turn.communicate(timeout=60)
            self.assertEqual(turn.returncode, 0, stderr)
            self.assertEqual(protected.read_text(), 'sole earlier evidence\n')
            self.assertIn('pending-input', self.log.read_text())
        finally:
            if turn.poll() is None:
                turn.kill()
                turn.communicate()

    def test_abrupt_observer_exit_preserves_latest_incomplete_frame(self):
        import os
        import signal
        import time
        updates = [json.dumps({'type': 'tool_execution_update', 'toolCallId': 'unfinished',
                               'partialResult': {'content': [{'type': 'text',
                                                             'text': 'partial %d' % i}]}})
                   for i in range(3)]
        self.events.write_text('\n'.join(updates) + '\n')
        self.harness("""import os,pathlib,sys,time
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
pathlib.Path('harness.pid').write_text(str(os.getpid()))
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
while True: time.sleep(1)
""")
        turn = subprocess.Popen([str(EXE), str(self.db), 'turn', 'omp-worker', 'abrupt-turn',
                                 str(self.player), 'model', 'low', str(self.cwd), str(self.task),
                                 str(self.log), ''], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True)
        pending = self.cwd / 'turn.jsonl.pending'
        try:
            deadline = time.monotonic() + 30
            while not pending.exists() or 'partial 2' not in pending.read_text():
                self.assertIsNone(turn.poll(), 'observer stopped before receiving latest update')
                self.assertLess(time.monotonic(), deadline, 'latest incomplete frame was not persisted')
                time.sleep(.01)
            turn.kill()
            turn.wait(timeout=10)
            self.assertEqual([json.loads(line) for line in pending.read_text().splitlines()],
                             [json.loads(updates[-1])])
            self.assertEqual(list(self.cwd.glob('turn.jsonl.pending.tmp.*')), [])
        finally:
            if turn.poll() is None:
                turn.kill()
                turn.wait(timeout=10)
            pid_file = self.cwd / 'harness.pid'
            if pid_file.exists():
                try: os.kill(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError: pass
            turn.communicate(timeout=10)

    def test_unwritable_log_reports_the_failure_and_keeps_the_report(self):
        unwritable = self.cwd / 'log-directory'
        unwritable.mkdir()
        self.events.write_text(json.dumps({'type': 'response', 'id': 'r1', 'command': 'probe'}) + '\n'
                               + self.terminal('Answer despite an unwritable log') + '\n')
        self.harness('''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
''')
        self.log = unwritable
        self.call('turn', 'omp-worker', 'turn-1', str(self.player), 'model', 'low',
                  str(self.cwd), str(self.task), str(self.log), '')
        inbox = json.loads(self.call('inbox', 'root'))
        bodies = [message['body'] for message in inbox]
        self.assertEqual(len([body for body in bodies if 'Native output observation failed' in body]), 1, bodies)
        self.assertTrue(any(str(unwritable) in body for body in bodies), bodies)
        self.assertTrue(any('Answer despite an unwritable log' in body for body in bodies), bodies)

if __name__ == '__main__':
    unittest.main()
