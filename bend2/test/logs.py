"""Log levels, event preservation, storage inspection and cleanup checks."""
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
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
        self.base_log = self.log
        self.active_turn = 'turn-1'
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
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout

    def refusal(self, *args):
        """A refused log command answers its rule on stderr with status 2."""
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        self.assertEqual(p.returncode, 2, (p.stdout, p.stderr))
        return json.loads(p.stderr)

    def harness(self, body):
        """Write the fixture harness that replays this test's event file."""
        self.player.write_text('#!' + sys.executable + '\n' + body)
        self.player.chmod(0o700)

    def stream(self, frames, player='omp-worker', turn='turn-1', exit_code=0):
        """Write one native OMP stream, then run the turn over it."""
        self.events.write_text('\n'.join(frames) + '\n')
        self.harness('''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
sys.exit(%d)
''' % exit_code)
        self.active_turn = turn
        result = self.call('turn', player, turn, str(self.player), 'model', 'low',
                           str(self.cwd), str(self.task), str(self.base_log), '')
        self.log = self.generation(self.base_log, turn)
        return result

    def generation(self, base, turn):
        code = ''.join(c if c.isascii() and (c.isalnum() or c in '-_') else '%%%02x' % ord(c)
                       for c in turn)
        return pathlib.Path(str(base) + '.attempt-' + code)

    def segment(self, index, log=None):
        return pathlib.Path(str(log or self.log) + '.%d' % index)

    def prepare_attempt_artifacts(self):
        """Give the completed fixture turn a deterministic retained-attempt directory."""
        with sqlite3.connect(self.db) as connection:
            session, attempt, phase = connection.execute(
                'SELECT session,id,phase FROM executions WHERE session=?', ('omp-worker',)).fetchone()
            self.assertEqual(phase, 'exited')
            directory = str(self.db) + '.attempt-' + attempt.encode().hex()
            connection.execute('UPDATE executions SET directory=? WHERE session=?', (directory, session))
        attempt_dir = pathlib.Path(directory)
        attempt_dir.mkdir()
        for name, body in (('manifest', b'retained manifest'), ('status', b'0\n'),
                           ('released', b'released\n'), ('acknowledged', b'acknowledged\n')):
            (attempt_dir / name).write_bytes(body)
        stderr_full = b'complete native diagnostics\n'
        (attempt_dir / 'stderr.full').write_bytes(stderr_full)
        (attempt_dir / 'stderr.meta').write_text(json.dumps({
            'schema': 'baton2-stderr-v1', 'status': 'complete', 'truncated': False,
            'observedBytes': len(stderr_full), 'retainedBytes': len(stderr_full),
            'spool': 'stderr.full'}))
        return attempt, attempt_dir

    def lines(self, path=None):
        return (path or self.log).read_text().splitlines()

    def all_frames(self):
        """Every frame line, oldest first, across historical segments and the live log."""
        lines = []
        for index in (4, 3, 2, 1):
            path = self.segment(index)
            if path.exists() and path.is_file():
                lines += path.read_text().splitlines()
        lines += self.lines()
        return [line for line in lines if 'baton_event_filter' not in line]

    def terminal(self, text='Complete answer λ'):
        return json.dumps({'type': 'agent_end', 'isTerminal': True,
                           'messages': [{'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}]})

    def test_default_policy_drops_snapshot_frames_and_keeps_evidence(self):
        payload = "tool payload λ's\n" * 200
        answer = "Complete answer λ's\n" * 200
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
            json.dumps({'type': 'message_end', 'message': {'id': 'm1', 'role': 'assistant', 'provider': 'provider',
                                                           'model': 'actual', 'content': [{'type': 'text', 'text': answer}]}}),
            self.terminal(answer),
            '{"probe":"unclassified frame"}',
        ]
        self.stream(frames)
        with sqlite3.connect(self.db) as connection:
            stderr = pathlib.Path(connection.execute(
                'SELECT stderr FROM log_stderr_runs WHERE session=? AND attempt=? ORDER BY run DESC LIMIT 1',
                ('omp-worker', self.active_turn)).fetchone()[0])
            terminal_event = json.loads(connection.execute(
                'SELECT event FROM turns WHERE id=? AND worker=?',
                (self.active_turn, 'omp-worker')).fetchone()[0])
        self.assertTrue(stderr.is_file())
        self.assertFalse(pathlib.Path(str(stderr) + '.full').exists())
        self.assertFalse(pathlib.Path(str(stderr) + '.meta').exists())
        storage = json.loads(self.call('logs-storage'))
        stderr_row = next(row for row in storage['stderrRuns'] if row['stderr'] == str(stderr))
        self.assertEqual(stderr_row['stderrBytes'], stderr.stat().st_size)
        saved = self.lines()
        self.assertEqual([json.loads(line).get('type') for line in saved],
                         ['response', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
                          'message_end', 'agent_end', None, 'baton_event_filter'])
        self.assertEqual([f for f in map(json.loads, saved) if f.get('type') == 'message_update'], [])
        tool_end = next(frame for frame in map(json.loads, saved) if frame.get('type') == 'tool_execution_end')
        self.assertEqual(tool_end['result']['content'][0]['text'], payload)
        self.assertEqual(json.loads(self.call('delivery', 'turn-1'))['body'], answer)
        self.assertEqual(terminal_event, json.loads(self.terminal(answer)))
        compact = next(frame for frame in map(json.loads, saved) if frame.get('type') == 'agent_end')
        self.assertEqual(compact['text'], answer)
        self.assertEqual(compact['textCharacters'], len(answer))
        self.assertEqual(compact['eventBytes'], len(self.terminal(answer).encode()))
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
        note = '{"type":"baton_event_filter","requested":"null+full","active":false,"outcome":"unacknowledged"}'
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
        note = '{"type":"baton_event_filter","requested":"array+delta","active":false,"outcome":"unacknowledged"}'
        lines = self.lines()
        self.assertEqual(len(lines), 3)
        compact = json.loads(lines[0])
        self.assertEqual(compact['type'], 'agent_end')
        self.assertEqual(compact['text'], 'Complete answer λ')
        self.assertEqual(compact['textCharacters'], len('Complete answer λ'))
        self.assertEqual(compact['eventBytes'], len(self.terminal().encode()))
        self.assertEqual(lines[1], '{"probe":"unknown type"}')
        self.assertEqual(lines[2], note)

    def test_policy_reads_and_sets_only_the_concise_level(self):
        self.assertEqual(json.loads(self.call('logs', 'omp-worker')),
                         {'session': 'omp-worker', 'level': 'default', 'registeredLogs': 0})
        self.assertEqual(json.loads(self.call('logs', 'omp-worker', 'quiet'))['level'], 'quiet')
        self.assertEqual(json.loads(self.call('logs', 'omp-worker', 'diagnostic'))['level'], 'diagnostic')
        self.assertEqual(self.refusal('logs', 'omp-worker', 'loud')['error'], 'invalid-log-setting')
        self.assertEqual(self.refusal('logs', 'absent-session', 'default')['error'], 'unknown-session')
        self.assertEqual(json.loads(self.call('logs', 'omp-worker'))['level'], 'diagnostic')

    def test_omp_keeps_unclassified_codex_command_frames_verbatim(self):
        self.call('logs', 'omp-worker', 'default')
        started = json.dumps({'type': 'item.started', 'item': {'type': 'command_execution',
                             'id': 'cmd-1', 'command': 'probe', 'status': 'in_progress'}})
        first = json.dumps({'type': 'item.completed', 'item': {'type': 'command_execution',
                            'id': 'cmd-1', 'command': 'probe', 'status': 'in_progress',
                            'exit_code': None, 'aggregated_output': 'part one'}})
        second = json.dumps({'type': 'item.completed', 'item': {'type': 'command_execution',
                             'id': 'cmd-1', 'command': 'probe', 'status': 'completed',
                             'exit_code': 0, 'aggregated_output': 'part one part two'}})
        self.stream([started, first, second, self.terminal()])
        retained = self.all_frames()
        self.assertIn(started, retained)
        self.assertIn(first, retained)
        self.assertIn(second, retained)

    def test_cleanup_removes_only_reported_settled_attempt_diagnostics(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        for name in ('stdout', 'native.stderr', 'observer.log', 'keeper.log'):
            (attempt_dir / name).write_text('diagnostic data for ' + name)
        protected = ('manifest', 'status', 'released', 'acknowledged')
        for name in protected:
            self.assertTrue((attempt_dir / name).is_file(), name)
        preview = json.loads(self.call('logs-storage'))['attempts']
        row = next(item for item in preview if item['attempt'] == attempt)
        self.assertTrue(row['released'])
        self.assertTrue(row['acknowledged'])
        self.assertTrue(row['reported'])
        self.assertTrue(row['cleanupEligible'], row)
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual({item['file'] for item in answer['attemptFiles']
                          if item.get('removed') and 'file' in item},
                         {'stdout', 'native.stderr', 'stderr.full', 'stderr.meta', 'observer.log', 'keeper.log'})
        for name in protected:
            self.assertTrue((attempt_dir / name).is_file(), name)
        self.assertEqual(json.loads(self.call('delivery', 'turn-1'))['body'], 'Complete answer λ')

    def test_attempt_without_durable_turn_record_is_retained(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        with sqlite3.connect(self.db) as connection:
            connection.execute('DELETE FROM turns WHERE id=?', (attempt,))
            for report_id in (attempt, attempt + ':exit', attempt + ':observation'):
                connection.execute('DELETE FROM messages WHERE id=? AND kind=?', (report_id, 'report'))
        evidence = attempt_dir / 'observer.log'
        evidence.write_text('observer evidence')
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['reported'])
        self.assertEqual(row['cleanupReason'], 'observation-unreported')
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual(answer['attemptFiles'], [])
        self.assertEqual(evidence.read_text(), 'observer evidence')
        self.assertTrue((attempt_dir / 'stderr.full').is_file())

    def test_failed_native_turn_retains_attempt_diagnostics(self):
        self.stream([self.terminal()], exit_code=1)
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        evidence = attempt_dir / 'observer.log'
        evidence.write_text('failure diagnostics')
        with sqlite3.connect(self.db) as connection:
            status, report_count = connection.execute(
                "SELECT e.status,(SELECT count(*) FROM messages m WHERE m.sender=e.session AND m.kind='report') "
                'FROM executions e WHERE e.session=?', ('omp-worker',)).fetchone()
        self.assertEqual(status, 'exit 1')
        self.assertGreater(report_count, 0)
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['cleanupEligible'], row)
        self.assertEqual(row['cleanupReason'], 'native-turn-failed')
        self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['attemptFiles'], [])
        self.assertEqual(evidence.read_text(), 'failure diagnostics')
        self.assertTrue((attempt_dir / 'stderr.full').is_file())

    def test_attempt_with_pending_input_is_retained(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        evidence = attempt_dir / 'observer.log'
        evidence.write_text('observer evidence')
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                'INSERT INTO messages(id,sender,recipient,kind,body) VALUES (?,?,?,?,?)',
                ('pending-attempt-cleanup', 'root', 'omp-worker', 'guidance', 'Review this first.'))
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertEqual(row['cleanupReason'], 'pending-input')
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual(answer['skipped'], 'pending-input')
        self.assertEqual(evidence.read_text(), 'observer evidence')
        self.assertTrue((attempt_dir / 'stderr.full').is_file())

    def test_diagnostic_policy_retains_attempt_files(self):
        self.call('logs', 'omp-worker', 'diagnostic')
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        evidence = attempt_dir / 'observer.log'
        evidence.write_text('observer evidence')
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertEqual(row['cleanupReason'], 'diagnostic-policy')
        self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['attemptFiles'], [])
        self.assertEqual(evidence.read_text(), 'observer evidence')
        self.assertTrue((attempt_dir / 'stderr.full').is_file())

    def test_unfinalized_stderr_spool_is_accounted_and_retained(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        (attempt_dir / 'stderr.meta').unlink()
        (attempt_dir / 'stderr-processing-error').write_text('metadata finalization failed\n')
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['cleanupEligible'])
        self.assertEqual(row['cleanupReason'], 'processing-error')
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual(answer['attemptFiles'], [])
        self.assertTrue((attempt_dir / 'stderr.full').is_file())
        self.assertTrue((attempt_dir / 'stderr-processing-error').is_file())

    def test_missing_stderr_metadata_with_spool_is_retained(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        (attempt_dir / 'stderr.meta').unlink()
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['cleanupEligible'])
        self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['attemptFiles'], [])
        self.assertTrue((attempt_dir / 'stderr.full').is_file())

    def test_malformed_stderr_metadata_with_spool_is_retained(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        (attempt_dir / 'stderr.meta').write_text('{')
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['cleanupEligible'])
        self.assertEqual(row['cleanupReason'], 'metadata-invalid')
        self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['attemptFiles'], [])
        self.assertTrue((attempt_dir / 'stderr.full').is_file())
        self.assertEqual((attempt_dir / 'stderr.meta').read_text(), '{')

    def test_cleanup_retains_a_run_with_malformed_stderr_metadata(self):
        self.stream([self.terminal()])
        with sqlite3.connect(self.db) as connection:
            stderr_name, = connection.execute(
                'SELECT stderr FROM log_stderr_runs WHERE session=? AND attempt=? ORDER BY run DESC LIMIT 1',
                ('omp-worker', self.active_turn)).fetchone()
        stderr = pathlib.Path(stderr_name)
        stderr_meta = pathlib.Path(str(stderr) + '.meta')
        stderr_full = pathlib.Path(str(stderr) + '.full')
        stderr_full.write_bytes(b'Legacy diagnostic evidence.\n')
        stderr_meta.write_text('{')
        row = next(item for item in json.loads(self.call('logs-storage'))['stderrRuns']
                   if item['stderr'] == str(stderr))
        self.call('logs-clean', 'omp-worker')
        self.assertTrue(stderr.is_file())
        self.assertEqual(stderr_full.read_bytes(), b'Legacy diagnostic evidence.\n')
        self.assertEqual(stderr_meta.read_text(), '{')


    def test_attempt_cleanup_rejects_symlink_diagnostic_file(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        outside = self.cwd / 'outside.log'
        outside.write_text('must remain')
        evidence = attempt_dir / 'observer.log'
        evidence.symlink_to(outside)
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        row = next(item for item in answer['attemptFiles'] if item['file'] == 'observer.log')
        self.assertFalse(row['removed'])
        self.assertIn('error', row)
        self.assertTrue(evidence.is_symlink())
        self.assertEqual(outside.read_text(), 'must remain')

    def test_cleanup_during_a_live_turn_keeps_the_live_log(self):
        self.call('logs', 'omp-worker', 'default')
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
        self.log = self.generation(self.base_log, 'turn-1')
        turn = subprocess.Popen([str(EXE), str(self.db), 'turn', 'omp-worker', 'turn-1', str(self.player),
                                 'model', 'low', str(self.cwd), str(self.task), str(self.base_log), ''],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            while not self.log.exists() or self.log.stat().st_size == 0:
                if turn.poll() is not None:
                    self.fail(turn.communicate()[1])
                time.sleep(.05)
            self.assertTrue(self.log.exists(), 'the turn did not create its live log')
            self.assertEqual(json.loads(self.call('logs-storage'))['logs'][0]['session'], 'omp-worker')
            self.assertEqual(json.loads(self.call('logs-clean', 'omp-worker'))['removed'], [])
            (self.cwd / 'release').write_text('go\n')
            stdout, stderr = turn.communicate()
        finally:
            if turn.poll() is None: turn.kill()
        self.assertEqual(turn.returncode, 0, stderr)
        retained = [json.loads(line) for line in self.lines()]
        self.assertEqual([row['text'] for row in retained if row.get('type') == 'agent_end'],
                         ['Concurrent answer'])
        self.assertEqual(json.loads(self.call('delivery', 'turn-1'))['body'], 'Concurrent answer')

    def test_interrupted_tool_call_keeps_only_its_last_update(self):
        updates = [json.dumps({'type': 'tool_execution_update', 'toolCallId': 'tool-1', 'toolName': 'bash',
                               'partialResult': {'content': [{'type': 'text', 'text': 'partial %d' % i}]}})
                   for i in range(3)]
        self.stream(updates + [self.terminal()])
        saved = self.lines()
        note = '{"type":"baton_event_filter","requested":"array+delta","active":false,"outcome":"unacknowledged"}'
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

    def test_abrupt_observer_checkpoint_restores_on_same_turn_retry(self):
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
        self.log = self.generation(self.base_log, 'abrupt-turn')
        turn = subprocess.Popen([str(EXE), str(self.db), 'turn', 'omp-worker', 'abrupt-turn',
                                 str(self.player), 'model', 'low', str(self.cwd), str(self.task),
                                 str(self.base_log), ''], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True)
        pending = pathlib.Path(str(self.log) + '.pending')
        try:
            print('checkpoint retry: waiting for the latest pending update', flush=True)
            while not pending.exists() or 'partial 2' not in pending.read_text():
                self.assertIsNone(turn.poll(), 'observer stopped before receiving latest update')
                time.sleep(.01)
            print('checkpoint retry: pending update received; stopping the first turn', flush=True)
            turn.kill()
            turn.wait()
            self.assertEqual([json.loads(line) for line in pending.read_text().splitlines()],
                             [json.loads(updates[-1])])
            self.assertEqual(list(self.cwd.glob(self.log.name + '.pending.tmp.*')), [])
            pid_file = self.cwd / 'harness.pid'
            if pid_file.exists():
                try: os.kill(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError: pass
            (self.cwd / 'events.jsonl').write_text(self.terminal('Resumed from checkpoint') + '\n')
            self.harness('''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
''')
            print('checkpoint retry: starting the same-turn retry', flush=True)
            self.call('turn', 'omp-worker', 'abrupt-turn', str(self.player), 'model', 'low',
                      str(self.cwd), str(self.task), str(self.base_log), '')
            print('checkpoint retry: retry returned; checking retained events', flush=True)
            with sqlite3.connect(self.db) as connection:
                stderr_runs = connection.execute(
                    'SELECT run,stderr FROM log_stderr_runs WHERE session=? AND attempt=? ORDER BY run',
                    ('omp-worker', 'abrupt-turn')).fetchall()
            self.assertEqual([run for run, _ in stderr_runs], [1, 2])
            for _, stderr_path in stderr_runs:
                self.assertTrue(pathlib.Path(stderr_path).is_file())
                self.assertFalse(pathlib.Path(stderr_path + '.full').exists())
                self.assertFalse(pathlib.Path(stderr_path + '.meta').exists())
            saved = [json.loads(line) for line in self.log.read_text().splitlines()]
            self.assertEqual([item for item in saved if item.get('toolCallId') == 'unfinished'],
                             [json.loads(updates[-1])])
            self.assertTrue(any(item.get('type') == 'agent_end' for item in saved))
            self.assertFalse(pending.exists())
        finally:
            print('checkpoint retry: releasing fixture processes', flush=True)
            if turn.poll() is None:
                turn.kill()
                turn.wait()
            pid_file = self.cwd / 'harness.pid'
            if pid_file.exists():
                try: os.kill(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError: pass
            turn.communicate()
            print('checkpoint retry: fixture processes released', flush=True)

    def test_later_direct_turn_preserves_an_earlier_checkpoint(self):
        previous = json.dumps({'type': 'tool_execution_update', 'toolCallId': 'previous',
                               'partialResult': {'content': [{'type': 'text', 'text': 'earlier partial'}]}})
        pending = pathlib.Path(str(self.generation(self.base_log, 'turn-1')) + '.pending')
        pending.write_text(previous)
        self.stream([self.terminal()])
        self.assertIn(json.loads(previous), [json.loads(line) for line in self.lines()])
        self.assertFalse(pending.exists())

    def test_unfinished_assistant_message_keeps_latest_update(self):
        frames = [json.dumps({'type': 'message_start', 'messageId': 'unfinished-message',
                             'message': {'id': 'unfinished-message', 'role': 'assistant', 'content': []}})]
        frames.extend(json.dumps({'type': 'message_update', 'messageId': 'unfinished-message',
                                  'message': {'id': 'unfinished-message', 'role': 'assistant',
                                              'content': [{'type': 'text', 'text': 'partial answer %d' % i}]}})
                      for i in range(3))
        self.stream(frames + [self.terminal()])
        updates = [row for row in map(json.loads, self.lines()) if row.get('type') == 'message_update']
        self.assertEqual(updates, [json.loads(frames[-1])])

    def test_existing_policy_migrates_and_preserves_registered_logs(self):
        with sqlite3.connect(self.db) as connection:
            connection.executescript("DROP TABLE log_policies;DROP TABLE log_files;"
                                     "CREATE TABLE log_policies(session TEXT PRIMARY KEY,level TEXT NOT NULL,budget_bytes INTEGER NOT NULL,keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4));"
                                     "CREATE TABLE log_files(session TEXT NOT NULL,log TEXT NOT NULL,PRIMARY KEY(session,log));")
            connection.execute('INSERT INTO log_policies VALUES(?,?,?,?)',
                               ('omp-worker', 'diagnostic', 1048576, 3))
            connection.execute('INSERT INTO log_files VALUES(?,?)', ('omp-worker', str(self.log)))
        before = json.loads(self.call('logs', 'omp-worker'))
        self.assertEqual((before['level'], before['registeredLogs']), ('diagnostic', 1))
        with sqlite3.connect(self.db) as connection:
            self.assertEqual({row[1] for row in connection.execute('PRAGMA table_info(log_policies)')},
                             {'session', 'level', 'budget_bytes', 'keep_segments'})
        after = json.loads(self.call('logs', 'omp-worker', 'diagnostic'))
        self.assertEqual((after['level'], after['registeredLogs']), ('diagnostic', 1))
        with sqlite3.connect(self.db) as connection:
            columns = {row[1] for row in connection.execute('PRAGMA table_info(log_policies)')}
            self.assertEqual(columns, {'session', 'level'})
            self.assertEqual(connection.execute('SELECT log FROM log_files').fetchone()[0], str(self.log))

    def test_numbered_historical_segments_are_reported_and_preserved(self):
        self.stream([self.terminal()])
        for index in (1, 65, 101):
            self.segment(index).write_text('retained historical evidence\n')
        pending = pathlib.Path(str(self.log) + '.pending')
        pending.write_text('checkpoint\n')
        entry = next(row for row in json.loads(self.call('logs-storage'))['logs']
                     if row['path'] == str(self.log))
        self.assertEqual({row['index'] for row in entry['legacySegments']}, {1, 65, 101})
        self.assertEqual(entry['pendingBytes'], pending.stat().st_size)
        self.assertEqual(entry['pendingPath'], str(pending))
        self.call('logs-clean', 'omp-worker')
        self.assertTrue(all(self.segment(index).exists() for index in (1, 65, 101)))

    def test_failed_migration_preserves_original_rows_and_refuses_success(self):
        import sqlite3
        with sqlite3.connect(self.db) as connection:
            connection.executescript('DROP TABLE log_policies;CREATE TABLE log_policies(session TEXT PRIMARY KEY,level TEXT NOT NULL,budget_bytes INTEGER NOT NULL,keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4));')
            connection.execute('INSERT INTO log_policies VALUES(?,?,?,?)',
                               ('omp-worker', 'invalid-legacy-level', 1048576, 3))
        before = json.loads(self.call('logs', 'omp-worker'))
        self.assertEqual(before['level'], 'invalid-legacy-level')
        with sqlite3.connect(self.db) as connection:
            self.assertIn('keep_segments',
                          {row[1] for row in connection.execute('PRAGMA table_info(log_policies)')})
        result = subprocess.run([str(EXE), str(self.db), 'logs', 'omp-worker', 'default'],
                                text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CHECK constraint failed', result.stderr)
        self.assertNotIn('"keepSegments"', result.stdout)
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute('SELECT level,keep_segments FROM log_policies').fetchall(),
                             [('invalid-legacy-level', 3)])
            self.assertEqual(connection.execute("SELECT count(*) FROM sqlite_master WHERE name='log_policies_legacy'").fetchone()[0], 0)

    def test_two_real_turns_register_distinct_generations_for_one_output_log(self):
        self.stream([self.terminal('First run')], turn='first-run')
        first = self.log
        self.stream([self.terminal('Second run')], turn='second-run')
        second = self.log
        self.assertNotEqual(first, second)
        with sqlite3.connect(self.db) as connection:
            rows = connection.execute(
                'SELECT attempt,log,base FROM log_generations WHERE session=? ORDER BY rowid',
                ('omp-worker',)).fetchall()
            stderr_rows = connection.execute(
                'SELECT attempt,run,stderr FROM log_stderr_runs WHERE session=? ORDER BY rowid',
                ('omp-worker',)).fetchall()
        self.assertEqual(rows, [('first-run', str(first), str(self.base_log)),
                                ('second-run', str(second), str(self.base_log))])
        self.assertEqual([(row[0], row[1]) for row in stderr_rows],
                         [('first-run', 1), ('second-run', 1)])
        for _, _, stderr_name in stderr_rows:
            self.assertTrue(pathlib.Path(stderr_name).is_file())
            self.assertFalse(pathlib.Path(stderr_name + '.full').exists())
            self.assertFalse(pathlib.Path(stderr_name + '.meta').exists())
        self.assertEqual(json.loads(self.call('delivery', 'first-run'))['body'], 'First run')
        self.assertEqual(json.loads(self.call('delivery', 'second-run'))['body'], 'Second run')

    def test_storage_reports_attempt_generations_with_identity(self):
        self.stream([self.terminal()])
        generation = self.log
        logs = json.loads(self.call('logs-storage'))['logs']
        self.assertFalse(any(row['path'] == str(self.base_log) for row in logs))
        entry = next(row for row in logs if row['path'] == str(generation))
        self.assertEqual(entry['attempt'], 'turn-1')
        self.assertEqual(entry['bytes'], generation.stat().st_size)

    def test_cleanup_removes_the_live_file_of_a_settled_attempt_generation(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        generation = self.log
        generation.write_text('derived generation view\n')
        (self.cwd / (generation.name + '.pending')).write_text('')
        with sqlite3.connect(self.db) as connection:
            stderr_name, = connection.execute(
                'SELECT stderr FROM log_stderr_runs WHERE session=? AND attempt=? ORDER BY run DESC LIMIT 1',
                ('omp-worker', attempt)).fetchone()
        stderr = pathlib.Path(stderr_name)
        stderr_full = b'complete native diagnostics\n'
        stderr.write_bytes(stderr_full)
        pathlib.Path(str(stderr) + '.full').write_bytes(stderr_full)
        pathlib.Path(str(stderr) + '.meta').write_text(json.dumps({
            'schema': 'baton2-stderr-v1', 'status': 'complete',
            'truncated': False,
            'observedBytes': len(stderr_full), 'retainedBytes': len(stderr_full),
            'spool': str(stderr) + '.full'}))
        for name in ('stdout', 'native.stderr', 'observer.log', 'keeper.log'):
            (attempt_dir / name).write_text('diagnostic data for ' + name)
        stderr_row = next(row for row in json.loads(self.call('logs-storage'))['stderrRuns']
                          if row['stderr'] == str(stderr))
        self.assertEqual(stderr_row['stderrBytes'], stderr.stat().st_size)
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        removed = [item for item in answer['attemptLogs'] if item.get('attempt') == attempt and item.get('path') == str(generation)]
        self.assertEqual(len(removed), 1, answer)
        self.assertTrue(removed[0]['removed'], answer)
        self.assertEqual(removed[0]['path'], str(generation))
        self.assertFalse(generation.exists())
        self.assertFalse((self.cwd / (generation.name + '.pending')).exists())
        self.assertFalse(stderr.exists(), answer)
        self.assertFalse(pathlib.Path(str(stderr) + '.full').exists())
        self.assertFalse(pathlib.Path(str(stderr) + '.meta').exists())
        self.assertFalse(self.base_log.exists())

    def test_cleanup_retains_the_generation_of_an_unreported_attempt(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        with sqlite3.connect(self.db) as connection:
            connection.execute('DELETE FROM turns WHERE id=?', (attempt,))
            for report_id in (attempt, attempt + ':exit', attempt + ':observation'):
                connection.execute('DELETE FROM messages WHERE id=? AND kind=?', (report_id, 'report'))
        generation = self.cwd / ('turn.jsonl.attempt-' + attempt)
        generation.write_text('unreported generation view\n')
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)',
                               ('omp-worker', str(generation)))
        answer = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual(answer['attemptLogs'], [])
        self.assertEqual(generation.read_text(), 'unreported generation view\n')

    def test_storage_reports_terminal_event_metadata(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertEqual(row['terminalType'], 'agent_end')
        self.assertGreater(row['eventChars'], 0)
        self.assertGreater(row['eventCount'], 0)
        self.assertTrue(row['reported'])

    def test_storage_reports_empty_terminal_metadata_without_a_turn_row(self):
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        with sqlite3.connect(self.db) as connection:
            connection.execute('DELETE FROM turns WHERE id=?', (attempt,))
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['reported'])
        self.assertEqual(row['terminalType'], '')
        self.assertEqual(row['eventChars'], 0)
        self.assertEqual(row['eventCount'], 0)

    def test_storage_reports_encoded_generation_identity(self):
        self.stream([self.terminal()])
        self.prepare_attempt_artifacts()
        coded = "a%2fb%2ec"
        generation = self.cwd / ("turn.jsonl.attempt-" + coded)
        generation.write_text("encoded generation view\n")
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)", ("omp-worker", str(generation)))
        logs = json.loads(self.call("logs-storage"))["logs"]
        entry = next(row for row in logs if row["path"] == str(generation))
        self.assertEqual(entry["attempt"], coded)

    def test_encoded_identity_binds_the_registered_attempt(self):
        import sqlite3
        self.stream([self.terminal()], turn="a/b")
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        self.assertEqual(attempt, "a/b")
        first = self.log
        first.write_text("derived generation view" + chr(10))
        (self.cwd / (first.name + ".pending")).write_text("")
        (self.cwd / (first.name + ".stderr")).write_text("native diagnostics stay" + chr(10))
        for name in ("stdout", "native.stderr", "observer.log", "keeper.log"):
            (attempt_dir / name).write_text("diagnostic data for " + name)
        self.stream([self.terminal()], turn="turn-2")
        second = self.log
        second.write_text("newest generation view" + chr(10))
        with sqlite3.connect(self.db) as connection:
            connection.executescript("CREATE TABLE IF NOT EXISTS log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));CREATE UNIQUE INDEX IF NOT EXISTS log_generations_log ON log_generations(log);")
            for path, turn in ((first, "a/b"), (second, "turn-2")):
                connection.execute("INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)", ("omp-worker", str(path)))
                connection.execute("INSERT OR IGNORE INTO log_generations(session,attempt,log,base) VALUES(?,?,?,?)", ("omp-worker", turn, str(path), str(self.log)))
        answer = json.loads(self.call("logs-clean", "omp-worker"))
        removed = [item for item in answer["attemptLogs"]
                   if item.get("attempt") == "a/b" and item.get("path") == str(first)]
        self.assertEqual(len(removed), 1, answer)
        self.assertTrue(removed[0]["removed"], answer)
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())

    def test_dotted_identity_in_a_marker_parent_cleans_by_basename(self):
        parent = self.cwd / "archive.attempt-old"
        parent.mkdir()
        self.base_log = parent / "turn.jsonl"
        self.stream([self.terminal()], turn="v1.2")
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        self.assertEqual(attempt, "v1.2")
        first = self.log
        (parent / (first.name + ".pending")).write_text("")
        (parent / (first.name + ".stderr")).write_text("native diagnostics stay" + chr(10))
        for name in ("stdout", "native.stderr", "observer.log", "keeper.log"):
            (attempt_dir / name).write_text("diagnostic data for " + name)
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)", ("omp-worker", str(first)))
        answer = json.loads(self.call("logs-clean", "omp-worker"))
        removed = [item for item in answer["attemptLogs"] if item.get("attempt") == "v1.2"]
        self.assertEqual(len(removed), 1, answer)
        self.assertTrue(removed[0]["removed"], answer)
        self.assertFalse(first.exists())

    def test_generation_identity_uses_marker_after_base_name_marker(self):
        import sqlite3
        self.stream([self.terminal()])
        base = self.cwd / "turn.attempt-base.jsonl"
        generation = pathlib.Path(str(base) + ".attempt-v1%2E2")
        generation.write_text("generation view\n")
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)",
                               ("omp-worker", str(generation)))
            connection.executescript("CREATE TABLE IF NOT EXISTS log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));CREATE UNIQUE INDEX IF NOT EXISTS log_generations_log ON log_generations(log);")
            connection.execute("INSERT OR IGNORE INTO log_generations(session,attempt,log,base) VALUES(?,?,?,?)",
                               ("omp-worker", "v1.2", str(generation), str(base)))
        logs = json.loads(self.call("logs-storage"))["logs"]
        entry = next(row for row in logs if row["path"] == str(generation))
        self.assertEqual(entry["attempt"], "v1%2E2")

    def test_unacknowledged_failed_generation_stays(self):
        import sqlite3
        self.stream([self.terminal()], exit_code=1)
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        self.assertEqual(attempt, "turn-1")
        first = self.cwd / "turn.jsonl.attempt-turn-1"
        first.write_text("derived generation view" + chr(10))
        (self.cwd / (first.name + ".pending")).write_text("")
        (self.cwd / (first.name + ".stderr")).write_text("native diagnostics stay" + chr(10))
        for name in ("stdout", "native.stderr", "observer.log", "keeper.log"):
            (attempt_dir / name).write_text("diagnostic data for " + name)
        (attempt_dir / "acknowledged").unlink()
        self.stream([self.terminal()], turn="turn-2")
        second = self.cwd / "turn.jsonl.attempt-turn-2"
        second.write_text("newest generation view" + chr(10))
        with sqlite3.connect(self.db) as connection:
            connection.executescript("CREATE TABLE IF NOT EXISTS log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));CREATE UNIQUE INDEX IF NOT EXISTS log_generations_log ON log_generations(log);")
            for path, turn in ((first, "turn-1"), (second, "turn-2")):
                connection.execute("INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)", ("omp-worker", str(path)))
                connection.execute("INSERT OR IGNORE INTO log_generations(session,attempt,log,base) VALUES(?,?,?,?)", ("omp-worker", turn, str(path), str(self.log)))
        answer = json.loads(self.call("logs-clean", "omp-worker"))
        self.assertEqual(answer["attemptLogs"], [], answer)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())

    def test_superseded_generation_leaves_after_the_executions_row_moves_on(self):
        import sqlite3
        self.stream([self.terminal()])
        attempt, attempt_dir = self.prepare_attempt_artifacts()
        self.assertEqual(attempt, "turn-1")
        first = self.cwd / "turn.jsonl.attempt-turn-1"
        first.write_text("derived generation view" + chr(10))
        (self.cwd / (first.name + ".pending")).write_text("")
        (self.cwd / (first.name + ".stderr")).write_text("native diagnostics stay" + chr(10))
        for name in ("stdout", "native.stderr", "observer.log", "keeper.log"):
            (attempt_dir / name).write_text("diagnostic data for " + name)
        self.stream([self.terminal()], turn="turn-2")
        second = self.cwd / "turn.jsonl.attempt-turn-2"
        second.write_text("newest generation view" + chr(10))
        with sqlite3.connect(self.db) as connection:
            connection.executescript("CREATE TABLE IF NOT EXISTS log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));CREATE UNIQUE INDEX IF NOT EXISTS log_generations_log ON log_generations(log);")
            for path, turn in ((first, "turn-1"), (second, "turn-2")):
                connection.execute("INSERT OR IGNORE INTO log_files(session,log) VALUES(?,?)", ("omp-worker", str(path)))
                connection.execute("INSERT OR IGNORE INTO log_generations(session,attempt,log,base) VALUES(?,?,?,?)", ("omp-worker", turn, str(path), str(self.log)))
        answer = json.loads(self.call("logs-clean", "omp-worker"))
        removed = [item for item in answer["attemptLogs"]
                   if item.get("attempt") == "turn-1" and item.get("path") == str(first)]
        self.assertEqual(len(removed), 1, answer)
        self.assertTrue(removed[0]["removed"], answer)
        self.assertFalse(first.exists())
        self.assertFalse((self.cwd / (first.name + ".pending")).exists())
        self.assertEqual((self.cwd / (first.name + ".stderr")).read_text(), "native diagnostics stay" + chr(10))
        self.assertTrue(second.exists())

    def test_unwritable_log_retains_the_terminal_in_the_failure_report(self):
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
        blocked_generation = pathlib.Path(str(unwritable) + '.attempt-turn-1')
        blocked_generation.mkdir()
        self.base_log = unwritable
        self.call('turn', 'omp-worker', 'turn-1', str(self.player), 'model', 'low',
                  str(self.cwd), str(self.task), str(self.base_log), '')
        inbox = json.loads(self.call('inbox', 'root'))
        bodies = [message['body'] for message in inbox]
        failures = [body for body in bodies if 'Native output observation failed' in body]
        self.assertEqual(len(failures), 1, bodies)
        self.assertIn(str(blocked_generation), failures[0])
        self.assertIn('Is a directory', failures[0])
        self.assertEqual(failures[0].count('Is a directory'), 1)
        event = json.loads(failures[0].split('\nNative event: ', 1)[1])
        self.assertEqual(event, json.loads(self.terminal('Answer despite an unwritable log')))
        self.assertEqual(json.loads(self.call('turns', 'omp-worker')), [])
        self.assertTrue(any('Player process ended without a native result' in body for body in bodies), bodies)

if __name__ == '__main__':
    unittest.main()
