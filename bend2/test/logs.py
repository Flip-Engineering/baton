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
        self.call('attach', 'root', 'native-fixture', 'root-session', '')
        self.call('role', 'root', 'principal-conductor')
        self.register('omp-worker', 'root', 'omp', 'model', 'low')

    def register(self, name, parent, harness, model, effort):
        return self.call('recruit', name, parent, harness, model, effort, str(self.repo),
                         name + '-branch', str(self.checkouts / name), self.base)

    def tearDown(self):
        self.temp._finalizer.detach()
        expected = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        processes = subprocess.run(['ps', '-axo', 'pid=,stat=,command='],
                                   check=True, capture_output=True, text=True)
        owners = []
        for line in processes.stdout.splitlines():
            fields = line.strip().split(None, 2)
            if len(fields) == 3 and fields[2] == expected and not fields[1].startswith('Z'):
                owners.append(int(fields[0]))
        self.assertLessEqual(len(owners), 1, owners)
        stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                 capture_output=True, text=True)
        self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
        for pid in owners:
            while True:
                owner = subprocess.run(['ps', '-p', str(pid), '-o', 'stat=,command='],
                                       capture_output=True, text=True)
                if owner.returncode == 1 and not owner.stdout.strip():
                    break
                self.assertEqual(owner.returncode, 0, owner.stderr)
                fields = owner.stdout.strip().split(None, 1)
                if not fields or fields[0].startswith('Z') or fields[1] != expected:
                    break
                time.sleep(.01)
        self.temp.cleanup()

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

    def completion_code(self, player, turn, frames):
        """Review the scripted successful result through the recorded parent."""
        parent = json.loads(self.call('session', player))['parent']
        parent_state = json.loads(self.call('session', parent))
        request = turn + ':completion-request'
        body = '\n'.join(frames) + '\n'
        prefix = [str(EXE), str(self.db)]
        reviewer = self.cwd / ('completion-review-' + turn.encode().hex() + '.py')
        reviewer.write_text('import json,subprocess,sys\n'
                            + 'prefix=' + repr(prefix) + '\n'
                            + 'worker=' + repr(player) + '\n'
                            + 'parent=' + repr(parent) + '\n'
                            + 'expected_request=' + repr(request) + '\n'
                            + 'expected_body=' + repr(body) + '\n'
                            + 'expected_assignment=' + repr(turn + ':task-input') + '\n'
                            + 'expected_task=' + repr(self.task.read_text()) + '\n'
                            + """def coordinator(*arguments):
    return json.loads(subprocess.check_output([*prefix,*arguments],text=True))
message=coordinator('delivery',sys.argv[-1])
assert message['recipient']==parent,message
if message['kind']=='completion-request':
    assert (message['id'],message['sender'],message['body'])==(expected_request,worker,expected_body),message
    state=coordinator('session',worker)
    completion=state['taskCompletion']
    assert state['parent']==parent and completion['coordinator']==parent,completion
    assert completion['requestId']==expected_request and completion['assignmentId']==expected_assignment,completion
    assignment=coordinator('delivery',completion['assignmentId'])
    assert (assignment['recipient'],assignment['kind'],assignment['body'])==(worker,'task-assignment',expected_task),assignment
    assert assignment['receipt']=='Fixture native reviewed its log task.',assignment
    coordinator('ack',expected_request,parent,'Fixture parent reviewed the complete scripted log result.')
    coordinator('message',expected_request+':confirmed',parent,worker,'completion-confirmed',expected_request)
""")
        self.call('connect', parent, parent_state['native'],
                  json.dumps([sys.executable, str(reviewer)]))
        code = ('import json,subprocess\n'
                + 'prefix=' + repr(prefix) + '\n'
                + 'worker=' + repr(player) + '\n'
                + 'parent=' + repr(parent) + '\n'
                + 'request=' + repr(request) + '\n'
                + 'result_body=' + repr(body) + '\n'
                + 'expected_assignment=' + repr(turn + ':task-input') + '\n'
                + 'expected_task=' + repr(self.task.read_text()) + '\n'
                + """def coordinator(*arguments):
    return json.loads(subprocess.check_output([*prefix,*arguments],text=True))
state=coordinator('session',worker)
assert state['parent']==parent and state['taskCompletion']['assignmentId']==expected_assignment,state
for pending in coordinator('inbox',worker):
    message=coordinator('delivery',pending['id'])
    assert (message['sender'],message['recipient'],message['kind'],message['body'])==(worker,worker,'task-assignment',expected_task),message
    coordinator('ack',message['id'],worker,'Fixture native reviewed its log task.')
assert coordinator('inbox',worker)==[]
coordinator('message',request,worker,parent,'completion-request',result_body)
reviewed=coordinator('delivery',request)
assert (reviewed['sender'],reviewed['recipient'],reviewed['kind'],reviewed['body'])==(worker,parent,'completion-request',result_body),reviewed
assert reviewed['receipt']=='Fixture parent reviewed the complete scripted log result.',reviewed
confirmation=coordinator('delivery',request+':confirmed')
assert (confirmation['sender'],confirmation['recipient'],confirmation['kind'],confirmation['body'])==(parent,worker,'completion-confirmed',request),confirmation
coordinator('ack',confirmation['id'],worker,'Fixture native handled parent completion confirmation.')
completion=coordinator('session',worker)['taskCompletion']
assert completion['assignmentId']==expected_assignment and completion['requestId']==request and completion['confirmed'] and not completion['open'],completion
""")
        return code, parent_state

    def completion_finished(self, player, turn, parent_state):
        state = json.loads(self.call('session', player))
        self.assertEqual(state['taskCompletion'], {
            'assignmentId': turn + ':task-input', 'coordinator': parent_state['id'],
            'requestId': turn + ':completion-request', 'confirmed': True, 'open': False})
        confirmation = json.loads(self.call('delivery', turn + ':completion-request:confirmed'))
        self.assertEqual(confirmation['receipt'], 'Fixture native handled parent completion confirmation.')
        self.assertEqual(json.loads(self.call('inbox', player)), [])
        self.call('connect', parent_state['id'], parent_state['native'], parent_state['endpoint'])

    def stream(self, frames, player='omp-worker', turn='turn-1', exit_code=0):
        """Write one native OMP stream, then run the turn over it."""
        self.events.write_text('\n'.join(frames) + '\n')
        completion, parent_state = self.completion_code(player, turn, frames) if exit_code == 0 else ('', None)
        self.harness('''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
''' + completion + ('''print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
sys.exit(%d)
''' % exit_code))
        self.active_turn = turn
        result = self.call('turn', player, turn, str(self.player), 'model', 'low',
                           str(self.cwd), str(self.task), str(self.base_log), '')
        self.log = self.generation(self.base_log, turn)
        if parent_state is not None:
            self.completion_finished(player, turn, parent_state)
        return result

    def generation(self, base, turn):
        code = ''.join(c if c.isascii() and (c.isalnum() or c in '-_') else '%%%02x' % ord(c)
                       for c in turn)
        return pathlib.Path(str(base) + '.attempt-' + code)

    def segment(self, index, log=None):
        return pathlib.Path(str(log or self.log) + '.%d' % index)

    def legacy_stderr_run(self, attempt):
        """Create legacy stderr metadata in this fixture database."""
        stderr = pathlib.Path(str(self.log) + '.stderr.run-1')
        stderr.write_bytes(b'Legacy stderr fixture.\n')
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                'INSERT INTO log_stderr_runs(session,attempt,run,generation,stderr) VALUES (?,?,?,?,?)',
                ('omp-worker', attempt, 1, str(self.log), str(stderr)))
        return stderr

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
            directory, = connection.execute(
                'SELECT directory FROM executions WHERE session=? AND id=?',
                ('omp-worker', self.active_turn)).fetchone()
            terminal_event = json.loads(connection.execute(
                'SELECT event FROM turns WHERE id=? AND worker=?',
                (self.active_turn, 'omp-worker')).fetchone()[0])
        attempt_dir = pathlib.Path(directory)
        stderr = attempt_dir / 'native.stderr'
        self.assertTrue(stderr.is_file())
        self.assertFalse((attempt_dir / 'stderr.full').exists())
        self.assertFalse((attempt_dir / 'stderr.meta').exists())
        storage = json.loads(self.call('logs-storage'))
        stderr_row = next(row for row in storage['attempts'] if row['attempt'] == self.active_turn)
        self.assertEqual(stderr_row['directory'], directory)
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
        assignment = json.loads(self.call('delivery', 'turn-1:task-input'))
        self.assertEqual((assignment['sender'], assignment['recipient'], assignment['kind'], assignment['body']),
                         ('omp-worker', 'omp-worker', 'task-assignment', self.task.read_text()))
        self.assertIsNone(assignment['receipt'])
        row = next(item for item in json.loads(self.call('logs-storage'))['attempts']
                   if item['attempt'] == attempt)
        self.assertFalse(row['cleanupEligible'], row)
        self.assertEqual(row['status'], 'exit 1')
        self.assertEqual(row['pendingInput'], 1)
        self.assertEqual(row['cleanupReason'], 'pending-input')
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
        stderr = self.legacy_stderr_run(self.active_turn)
        stderr_meta = pathlib.Path(str(stderr) + '.meta')
        stderr_full = pathlib.Path(str(stderr) + '.full')
        stderr_full.write_bytes(b'Legacy diagnostic evidence.\n')
        stderr_meta.write_text('{')
        row = next(item for item in json.loads(self.call('logs-storage'))['stderrRuns']
                   if item['stderr'] == str(stderr))
        self.assertEqual(row['stderrBytes'], stderr.stat().st_size)
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
        completion, parent_state = self.completion_code(
            'omp-worker', 'turn-1', frames + [self.terminal('Concurrent answer')])
        self.harness('''import pathlib,sys,time
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
pathlib.Path('events.jsonl').read_text() and print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
while not pathlib.Path('release').exists(): time.sleep(.05)
''' + completion + ('''print(%r,flush=True)
assert sys.stdin.read()==''
''' % self.terminal('Concurrent answer')))
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
        self.completion_finished('omp-worker', 'turn-1', parent_state)
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
        import struct
        updates = [json.dumps({'type': 'tool_execution_update', 'toolCallId': 'unfinished',
                               'partialResult': {'content': [{'type': 'text',
                                                             'text': 'partial %d' % i}]}})
                   for i in range(3)]
        terminal = self.terminal('Resumed from checkpoint')
        update_bytes = ('\n'.join(updates) + '\n').encode()
        self.events.write_bytes(update_bytes)
        completion, parent_state = self.completion_code(
            'omp-worker', 'abrupt-turn', updates + [terminal])
        release = self.cwd / 'resume-native'
        self.harness("""import os,pathlib,sys,time
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
pathlib.Path('harness.pid').write_text(str(os.getpid()))
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
while not pathlib.Path('resume-native').exists(): time.sleep(.01)
""" + completion + 'print(' + repr(terminal) + ",flush=True)\nassert sys.stdin.read()==''\n")
        self.log = self.generation(self.base_log, 'abrupt-turn')
        turn = subprocess.Popen([str(EXE), str(self.db), 'turn', 'omp-worker', 'abrupt-turn',
                                 str(self.player), 'model', 'low', str(self.cwd), str(self.task),
                                 str(self.base_log), ''], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True)
        pending = pathlib.Path(str(self.log) + '.pending')
        raw = None
        attempt = None
        native_pid = None
        try:
            print('checkpoint retry: waiting for the complete retained update stream', flush=True)
            while True:
                self.assertIsNone(turn.poll(), 'observer stopped before retaining the updates')
                with sqlite3.connect(self.db) as connection:
                    execution = connection.execute(
                        'SELECT id,directory,phase,status FROM executions WHERE session=?',
                        ('omp-worker',)).fetchone()
                if execution is not None and execution[0] == 'abrupt-turn':
                    attempt = pathlib.Path(execution[1])
                    spool = attempt / 'stdout'
                    if spool.is_file() and spool.read_bytes() == update_bytes:
                        break
                time.sleep(.01)
            self.assertEqual(execution[2:], ('running', ''))
            self.assertEqual([json.loads(line) for line in spool.read_text().splitlines()],
                             [json.loads(line) for line in updates])
            self.assertFalse(pending.exists())
            self.assertEqual(list(self.cwd.glob(self.log.name + '.pending.tmp.*')), [])
            self.assertFalse((attempt / 'checkpoint').exists())
            self.assertFalse((attempt / 'checkpoint-error').exists())
            manifest = (attempt / 'manifest').read_bytes()
            birth = (attempt / 'native.birth').read_bytes()
            native_pid = int((self.cwd / 'harness.pid').read_text())
            os.kill(native_pid, 0)
            raw = spool.open('rb')
            spool_identity = os.fstat(raw.fileno())
            print('checkpoint retry: raw updates retained; stopping the first observer', flush=True)
            turn.kill()
            turn.wait()
            self.assertEqual(turn.returncode, -signal.SIGKILL)
            os.kill(native_pid, 0)
            release.write_text('continue the original native\n')
            print('checkpoint retry: waiting for same-attempt recovery and native completion', flush=True)
            while not (attempt / 'acknowledged').is_file():
                if (attempt / 'observer-error').is_file():
                    error = (attempt / 'observer-error').read_text()
                    observer_log = attempt / 'observer.log'
                    if observer_log.is_file():
                        error += observer_log.read_text()
                    self.fail(error)
                time.sleep(.01)
            self.assertEqual((attempt / 'status').read_text(), '0\n')
            self.assertTrue((attempt / 'released').is_file())
            self.assertEqual((attempt / 'manifest').read_bytes(), manifest)
            self.assertEqual((attempt / 'native.birth').read_bytes(), birth)
            self.assertEqual(int((self.cwd / 'harness.pid').read_text()), native_pid)
            self.assertEqual((attempt / 'native.stderr').read_bytes(), b'')
            self.assertTrue((attempt / 'observer.log').is_file())
            self.assertFalse((attempt / 'observer-error').exists())
            self.assertFalse((attempt / 'checkpoint-error').exists())
            raw.seek(0)
            raw_bytes = raw.read()
            self.assertEqual(raw_bytes, update_bytes + (terminal + '\n').encode())
            checkpoint = (attempt / 'checkpoint').read_bytes()
            header = struct.unpack('=8sII8Q24s', checkpoint[:104])
            self.assertEqual(header[:3], (b'BATONC03', 1, 0))
            self.assertEqual(header[6:9],
                             (spool_identity.st_dev, spool_identity.st_ino, len(raw_bytes)))
            self.assertEqual(struct.unpack('=i4xQQ', header[11]),
                             struct.unpack('=i4xQQ', birth))
            self.assertEqual(len(checkpoint), 104 + header[9])
            checkpoint_state = json.loads(checkpoint[104:])
            self.assertTrue(checkpoint_state['output_done'])
            self.assertEqual(checkpoint_state['held'], '')
            self.assertEqual(list(attempt.glob('checkpoint.tmp-*')), [])
            print('checkpoint retry: replaying the settled original turn', flush=True)
            replay = json.loads(self.call('turn', 'omp-worker', 'abrupt-turn', str(self.player),
                                          'model', 'low', str(self.cwd), str(self.task),
                                          str(self.base_log), ''))
            self.assertEqual(replay['body'], 'Resumed from checkpoint')
            self.completion_finished('omp-worker', 'abrupt-turn', parent_state)
            with sqlite3.connect(self.db) as connection:
                execution = connection.execute(
                    'SELECT id,directory,phase,status FROM executions WHERE session=?',
                    ('omp-worker',)).fetchone()
                generations = connection.execute(
                    'SELECT attempt,log FROM log_generations WHERE session=?',
                    ('omp-worker',)).fetchall()
                turns = connection.execute('SELECT id FROM turns WHERE worker=?',
                                           ('omp-worker',)).fetchall()
            self.assertEqual(execution, ('abrupt-turn', str(attempt), 'exited', 'exit 0'))
            self.assertEqual(generations, [('abrupt-turn', str(self.log))])
            self.assertEqual(turns, [('abrupt-turn',)])
            saved = [json.loads(line) for line in self.log.read_text().splitlines()]
            self.assertEqual([item for item in saved if item.get('toolCallId') == 'unfinished'],
                             [json.loads(updates[-1])])
            self.assertEqual(len([item for item in saved if item.get('type') == 'agent_end']), 1)
            self.assertFalse(pending.exists())
            self.assertEqual(list(self.cwd.glob(self.log.name + '.pending.tmp.*')), [])
        finally:
            print('checkpoint retry: releasing fixture processes', flush=True)
            if raw is not None:
                raw.close()
            if turn.poll() is None:
                turn.kill()
                turn.wait()
            pid_file = self.cwd / 'harness.pid'
            if native_pid is None and pid_file.is_file():
                native_pid = int(pid_file.read_text())
            if native_pid is not None and (attempt is None or not (attempt / 'status').exists()):
                try: os.kill(native_pid, signal.SIGKILL)
                except ProcessLookupError: pass
            turn.communicate()
            print('checkpoint retry: fixture processes released', flush=True)

    def test_later_direct_turn_preserves_an_earlier_checkpoint(self):
        import struct
        previous = json.dumps({'type': 'tool_execution_update', 'toolCallId': 'previous',
                               'partialResult': {'content': [{'type': 'text', 'text': 'earlier partial'}]}})
        terminal = self.terminal('Earlier answer')
        self.stream([previous, terminal], turn='earlier-turn')
        earlier_log = self.log
        earlier_bytes = earlier_log.read_bytes()
        self.assertEqual([json.loads(line) for line in earlier_log.read_text().splitlines()
                          if json.loads(line).get('toolCallId') == 'previous'], [json.loads(previous)])
        with sqlite3.connect(self.db) as connection:
            directory, = connection.execute(
                'SELECT directory FROM executions WHERE session=? AND id=?',
                ('omp-worker', 'earlier-turn')).fetchone()
        attempt_dir = pathlib.Path(directory)
        checkpoint = (attempt_dir / 'checkpoint').read_bytes()
        birth = (attempt_dir / 'native.birth').read_bytes()
        manifest = (attempt_dir / 'manifest').read_bytes()
        header = struct.unpack('=8sII8Q24s', checkpoint[:104])
        self.assertEqual(header[:3], (b'BATONC03', 1, 0))
        self.assertEqual(header[8], len((previous + '\n' + terminal + '\n').encode()))
        self.assertEqual(struct.unpack('=i4xQQ', header[11]), struct.unpack('=i4xQQ', birth))
        self.assertEqual(len(checkpoint), 104 + header[9])
        state = json.loads(checkpoint[104:])
        self.assertTrue(state['output_done'])
        self.assertEqual(state['held'], '')
        self.assertEqual(int(state['output']), len(earlier_bytes))
        self.assertEqual((attempt_dir / 'status').read_text(), '0\n')
        self.assertTrue((attempt_dir / 'released').is_file())
        self.assertTrue((attempt_dir / 'acknowledged').is_file())
        self.assertFalse(pathlib.Path(str(earlier_log) + '.pending').exists())
        self.stream([self.terminal()], turn='later-turn')
        self.assertNotEqual(self.log, earlier_log)
        self.assertEqual((attempt_dir / 'checkpoint').read_bytes(), checkpoint)
        self.assertEqual((attempt_dir / 'native.birth').read_bytes(), birth)
        self.assertEqual((attempt_dir / 'manifest').read_bytes(), manifest)
        self.assertEqual(earlier_log.read_bytes(), earlier_bytes)
        self.assertFalse(any(json.loads(line).get('toolCallId') == 'previous' for line in self.lines()))
        self.assertEqual(json.loads(self.call('delivery', 'earlier-turn'))['body'], 'Earlier answer')
        self.assertEqual(json.loads(self.call('delivery', 'later-turn'))['body'], 'Complete answer λ')

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
            retained_rows = connection.execute(
                'SELECT id,directory FROM direct_turn_requests WHERE session=? ORDER BY rowid',
                ('omp-worker',)).fetchall()
        self.assertEqual(rows, [('first-run', str(first), str(self.base_log)),
                                ('second-run', str(second), str(self.base_log))])
        self.assertEqual([row[0] for row in retained_rows], ['first-run', 'second-run'])
        self.assertEqual(len({row[1] for row in retained_rows}), 2)
        for turn, directory in retained_rows:
            attempt_dir = pathlib.Path(directory)
            self.assertEqual(directory, str(self.db) + '.direct-' + turn.encode().hex())
            self.assertTrue((attempt_dir / 'native.stderr').is_file())
            self.assertFalse((attempt_dir / 'stderr.full').exists())
            self.assertFalse((attempt_dir / 'stderr.meta').exists())
            self.assertEqual((attempt_dir / 'status').read_text(), '0\n')
            self.assertTrue((attempt_dir / 'released').is_file())
            self.assertTrue((attempt_dir / 'acknowledged').is_file())
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
        stderr = self.legacy_stderr_run(attempt)
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
        diagnostic = ('Native output observation failed: 21: Log ' + str(blocked_generation)
                      + ': Could not write file at output position.')
        self.assertEqual(failures[0].split('\nNative event: ', 1)[0], diagnostic)
        self.assertEqual(failures[0].count(diagnostic), 1)
        event = json.loads(failures[0].split('\nNative event: ', 1)[1])
        self.assertEqual(event, json.loads(self.terminal('Answer despite an unwritable log')))
        self.assertEqual(json.loads(self.call('turns', 'omp-worker')), [])
        self.assertTrue(any('Player process ended without a native result' in body for body in bodies), bodies)

if __name__ == '__main__':
    unittest.main()
