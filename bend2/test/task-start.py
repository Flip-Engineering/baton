"""Complete dispatch input and outcomes through native CLI and packaged MCP."""
import hashlib
import fcntl
from contextlib import contextmanager
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import unittest


def fixture_module(name, file):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


identity = fixture_module('task_identity_fixture', 'control-identity.py')
controls = identity.controls
fixed = fixture_module('task_fixed_fixture', 'fixed-coordinator.py')


class TaskStart(unittest.TestCase):
    git = identity.ControlIdentity.git
    call = identity.ControlIdentity.call
    read_count = identity.ControlIdentity.read_count
    root = identity.ControlIdentity.root
    accept = identity.ControlIdentity.accept
    accept_any = identity.ControlIdentity.accept_any
    capture_child_output = identity.ControlIdentity.capture_child_output
    child_communication = identity.ControlIdentity.child_communication
    action = identity.ControlIdentity.action
    finish = identity.ControlIdentity.finish
    rows = identity.ControlIdentity.rows
    eventually = identity.ControlIdentity.eventually
    process_rows = identity.ControlIdentity.process_rows
    exited = identity.ControlIdentity.exited
    close_fixtures = identity.ControlIdentity.close_fixtures
    output_log = controls.Control.output_log

    def setUp(self):
        identity.ControlIdentity.setUp(self)
        self.environment.pop('BATON_SESSION', None)
        self.environment.pop('CODEX_THREAD_ID', None)
        for directory, name in (('harness', 'task-start.mjs'),
                                ('harness', 'project-settings.mjs'),
                                ('scripts', 'mcp-conductor.mjs')):
            source = controls.ROOT / 'bend2' / directory / name
            copy = self.prefix / 'libexec/baton2' / name
            shutil.copy2(source, copy)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(hashlib.sha256(copy.read_bytes()).hexdigest(), digest)
            self.pins.append({'source': str(source), 'copy': str(copy), 'sha256': digest})
        (self.directory / 'dispatch-package-copies.json').write_text(json.dumps(self.pins, indent=2) + '\n')
        fixture = self.fixture.read_text()
        fixture = fixture.replace("'apiKeyVariablesPresent':",
                                  "'codexHome':os.environ.get('CODEX_HOME'),'apiKeyVariablesPresent':", 1)
        self.fixture.write_text(fixture)
        self.root()
        self.call('project', self.repo)
        self.settings_path = self.repo / '.git/baton2/settings.json'

    def route(self, session, model='gpt-6-astra'):
        path = self.directory / 'fixture.json'
        config = json.loads(path.read_text())
        config['sessions'][model] = session
        path.write_text(json.dumps(config))

    def task_call(self, *args, stdin=None, ok=True, project=None, database=False, prefix=(), environment=None):
        argv = [str(self.binary)] + ([str(self.db)] if database else list(map(str, prefix))) + ['dispatch', *map(str, args)]
        result = subprocess.run(argv, input=stdin, cwd=project or self.repo,
                                env={**self.environment, **(environment or {})}, capture_output=True)
        stdout, stderr = result.stdout.decode(), result.stderr.decode()
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps({'argv': argv, 'code': result.returncode,
                                     'stdout': stdout, 'stderr': stderr,
                                     'direct_wait_completed': True}) + '\n')
        self.assertEqual(result.returncode == 0, ok, stdout + stderr)
        value = json.loads(stdout)
        if value.get('requestId') and not value.get('inputRecordError') and not value.get('resultRecordError'):
            saved = self.call('task-input-read', value['requestId'])
            self.assertEqual(saved['id'], value['requestId'])
            self.assertEqual(saved['result'], value)
        self.assertNotIn('inputPath', value)
        self.assertNotIn('resultPath', value)
        self.assertFalse(pathlib.Path(str(value.get('database', self.db)) + '.tasks').exists())
        return value

    def native_input(self, *args, body, ok=True, database=None, environment=None):
        data = body if isinstance(body, bytes) else body.encode()
        argv = [str(self.binary), str(self.db if database is None else database), *map(str, args)]
        child = subprocess.run(argv, input=data, env={**self.environment, **(environment or {})}, capture_output=True)
        record = {'argv': argv, 'stdinHex': data.hex(), 'code': child.returncode,
                  'stdout': child.stdout.decode(), 'stderr': child.stderr.decode(),
                  'direct_wait_completed': True}
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps(record) + '\n')
        self.assertEqual(child.returncode == 0, ok, record['stdout'] + record['stderr'])
        return json.loads(record['stdout']) if ok else record

    def settings(self, routes, subscriptions=None):
        value = {'schema': 'baton2-project-settings-v1', 'routes': routes,
                 'context': {'disabled': ['preserved-context'], 'preferred': ['existing-context']},
                 'subscriptions': subscriptions or []}
        self.settings_path.write_text(json.dumps(value))
        return self.settings_path.read_bytes()

    @contextmanager
    def held_session(self, session):
        path = fixed.FixedCoordinator.session_lock_path(self, session)
        with path.open('a') as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def pending_input(self, ident, sender, recipient, kind, body):
        self.native_input('message-batch-file', sender, '-', body=json.dumps([
            {'id': ident, 'recipient': recipient, 'kind': kind, 'body': body}]))
        row, = self.rows('SELECT id,sender,recipient,kind,body,receipt FROM messages WHERE id=?',
                         (ident,))
        self.assertEqual(row, {'id': ident, 'sender': sender, 'recipient': recipient,
                               'kind': kind, 'body': body, 'receipt': None})

    def assert_retained_input(self, result, body):
        self.assertEqual(result['input']['body'], body)
        request = self.call('task-input-read', result['requestId'])
        self.assertEqual(request['request']['input']['body'], body)
        self.assertEqual(request['request']['messageId'], result['task'])
        self.assertEqual(request['request']['session'], result['session'])
        self.assertEqual(request['result'], result)
        saved = self.call('delivery', result['task'])
        self.assertEqual(saved['body'], body)
        self.assertEqual(saved['recipient'], result['session'])
        self.assertEqual(result['inspect']['input'], [str(self.binary.resolve()), str(self.db), 'input', result['task']])
        self.assertEqual(result['inspect']['request'],
                         [str(self.binary.resolve()), str(self.db), 'task-input-read', '--current'])
        admission = next(step for step in result['steps'] if step['argv'][2] == 'message-batch-file')
        self.assertEqual(admission['argv'][-1], '-')

    def assert_initial_prompt(self, result, body, native):
        execution = self.rows('SELECT * FROM executions WHERE session=?', (result['session'],))[0]
        rows = self.rows('SELECT * FROM native_initial_inputs WHERE attempt=?', (execution['directory'],))
        self.assertEqual(len(rows), 1)
        initial = rows[0]
        self.assertEqual((initial['session'], initial['turn']), (result['session'], execution['id']))
        self.assertRegex(initial['seed'], r'^[0-9a-f]{128}$')
        self.assertIn('abstract qualities', initial['instruction'])
        self.assertIn('task', initial['instruction'])
        self.assertIn(body, initial['guidance'])
        prefix = initial['seed'] + '\n\n' + initial['instruction'] + '\n\n'
        self.assertEqual(native['prompt'], prefix + initial['guidance'])
        self.assertEqual(native['prompt'].count(prefix), 1)
        self.assertEqual((pathlib.Path(initial['attempt']) / 'prompt.txt').read_bytes(),
                         native['prompt'].encode())
        self.assertEqual(self.call('delivery', result['task'])['body'], body)
        return initial['seed']

    def failed_turn(self, session, stream, report):
        self.finish(stream, report, fail=True)
        execution = self.exited(session)
        turn = self.eventually(lambda: next((row for row in self.call('turns', session)
                                            if row['id'] == execution['id']), None))
        state = self.call('session', session)
        if state['harness'] == 'codex':
            event = {'type': 'result', 'is_error': 1,
                     'nativeEvent': {'type': 'turn.failed', 'error': {'message': report}},
                     'result': report}
        elif state['harness'] == 'omp':
            event = {'type': 'agent_end', 'isTerminal': True, 'messages': [
                {'role': 'assistant', 'stopReason': 'error', 'errorStatus': 503,
                 'errorMessage': report, 'content': [{'type': 'text', 'text': report}]}]}
        elif state['harness'] == 'muse':
            event = {'stream': {'kind': 'session', 'id': state['native']},
                     'payload_type': 'run.terminal.failed',
                     'payload': {'kind': 'run_terminal', 'terminal': 'failed',
                                 'command_id': 'fixture-primary', 'text': report}}
        else:
            self.assertEqual(state['harness'], 'claude-code')
            event = {'type': 'result', 'session_id': state['native'],
                     'result': report, 'is_error': True}
        stored_event = self.rows('SELECT event FROM turns WHERE id=? AND worker=?',
                                 (execution['id'], session))[0]['event']
        self.assertEqual(json.loads(stored_event), event)
        if state['harness'] == 'omp':
            self.assertEqual(turn['reportBody'],
                             'OMP provider failure: stopReason=error, errorStatus=503; ' + report)
        else:
            self.assertEqual(json.loads(turn['reportBody']), event)
        delivered = self.call('delivery', execution['id'])
        self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind'], delivered['body']),
                         (session, state['parent'] or 'operator', 'report', turn['reportBody']))
        self.eventually(lambda: self.call('session', session)['blockedCause'] == 'provider-failure')
        return turn

    def test_complete_text_stdin_and_utf8_file_use_owned_setup_and_transcripts(self):
        body = '\ufeffTask λ🙂\nReview "quotes" and the entire input.\n' * 2000
        seeds = set()
        for source in ('argument', 'stdin', 'file'):
            with self.subTest(source=source):
                session = 'task-' + source
                self.route(session)
                flags = ['--session', session, '--harness', 'codex', '--model', 'gpt-6-astra',
                         '--effort', 'low', '--command', self.fixture]
                stdin = None
                if source == 'argument':
                    flags += ['--text', body]
                elif source == 'stdin':
                    flags += ['--stdin']
                    stdin = body.encode()
                else:
                    file = self.directory / 'supplied UTF8 input.txt'
                    file.write_bytes(body.encode())
                    flags += ['--file', file]
                result = self.task_call(*flags, stdin=stdin)
                self.assertEqual(result['status'], 'admitted')
                self.assert_retained_input(result, body)
                state = self.call('session', session)
                self.assertEqual((state['role'], state['parent'], state['workspace']),
                                 ('principal-conductor', None, str(self.repo.resolve())))
                stream, native = self.accept(session)
                self.assertIn(body, native['prompt'])
                seed = self.assert_initial_prompt(result, body, native)
                self.assertNotIn(seed, seeds)
                seeds.add(seed)
                self.assertEqual(native['cwd'], str(self.repo.resolve()))
                self.failed_turn(session, stream, 'Retained provider error λ🙂\n' + source)
                self.assertTrue(self.output_log(session).is_file())
                self.assertGreater(self.read_count(result['task']), 0)

    def test_muse_file_and_claude_stdin_receive_complete_seeded_initial_input(self):
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'seeded-' + harness
                self.route(session)
                body = '\ufeffReview the complete task λ🙂\nPreserve trailing spaces  '
                result = self.task_call('--to', session, '--harness', harness,
                    '--model', 'gpt-6-astra', '--effort', 'low', '--command', self.fixture,
                    '--stdin', stdin=body.encode())
                self.assert_retained_input(result, body)
                stream, native = self.accept(session)
                self.assert_initial_prompt(result, body, native)
                self.failed_turn(session, stream, 'Retained seeded ' + harness + ' result.')

    def test_saved_named_route_explicit_overrides_and_path_command_preserve_settings(self):
        original = self.settings([{'name': 'selected', 'harness': 'omp', 'model': 'kimi-code/k3',
                                   'effort': 'low'},
                                  {'name': 'another', 'harness': 'codex', 'model': 'gpt-6-astra',
                                   'effort': 'high'}])
        self.route('named', 'kimi-code/k3')
        directory = self.directory / 'native-path'
        directory.mkdir()
        (directory / 'omp').symlink_to(self.fixture)
        self.environment['PATH'] = str(directory) + ':' + self.environment['PATH']
        body = 'Use the selected named route.\nLiteral Unicode λ.'
        result = self.task_call(body, '--session', 'named', '--route', 'selected', '--effort', 'high')
        self.assertEqual(result['route']['sources'], {'harness': 'named-project-route',
                          'model': 'named-project-route', 'effort': 'explicit'})
        self.assertEqual(result['command'], {'executable': str(self.fixture.resolve()), 'source': 'PATH'})
        self.assertEqual(self.settings_path.read_bytes(), original)
        stream, native = self.accept('named')
        self.assert_initial_prompt(result, body, native)
        self.assertEqual(native['args'][native['args'].index('--model') + 1], 'kimi-code/k3')
        self.assertEqual(native['args'][native['args'].index('--thinking') + 1], 'high')
        self.failed_turn('named', stream, 'Retain the named route result.')

    def test_missing_route_does_not_choose_first_saved_route_or_an_existing_session(self):
        self.settings([{'name': 'first', 'harness': 'codex', 'model': 'gpt-6-astra', 'effort': 'low'}])
        result = self.task_call('Task text is retained when defaults are incomplete.',
                                '--command', self.fixture, ok=False)
        self.assertEqual(result['error']['reason'], 'taskRouteIncomplete')
        self.assertIn('--route NAME', result['error']['next'])
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['input']['body'],
                         result['input']['body'])
        self.assertIsNone(result.get('admission'))
        self.assertEqual(self.rows('SELECT * FROM sessions WHERE id=?', (result['session'],)), [])

    def test_named_subscription_profile_binds_external_store_before_native_input(self):
        store = self.directory / 'external authenticated account'
        store.mkdir()
        original = self.settings([{'name': 'account', 'harness': 'codex', 'model': 'gpt-6-astra',
                                   'effort': 'low', 'profile': 'primary'}],
                                 [{'harness': 'codex', 'label': 'primary', 'store': str(store)}])
        self.route('account')
        result = self.task_call('--session', 'account', '--route', 'account', '--command', self.fixture,
                                '--text', 'Task with its named external subscription λ.')
        steps = [step['argv'][2] for step in result['steps']]
        self.assertLess(steps.index('profile-bind'), steps.index('message-batch-file'))
        stream, native = self.accept('account')
        self.assertEqual(native['codexHome'], str(store))
        self.assertEqual(self.settings_path.read_bytes(), original)
        self.failed_turn('account', stream, 'Retained account fixture result.')

    def test_invalid_utf8_and_ambiguous_input_are_actionable_and_admit_no_messages(self):
        before = self.rows('SELECT * FROM messages ORDER BY seq')
        malformed = self.directory / 'invalid.txt'
        malformed.write_bytes(b'Original invalid UTF8 \xff')
        result = self.task_call('--file', malformed, ok=False)
        self.assertEqual(result['error']['reason'], 'taskInputInvalidUtf8')
        self.assertEqual(result['input']['bytesHex'], malformed.read_bytes().hex())
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['input']['bytesHex'],
                         malformed.read_bytes().hex())
        result = self.task_call('--stdin', stdin=b'Invalid stdin \xff', ok=False)
        self.assertEqual(result['error']['reason'], 'taskInputInvalidUtf8')
        self.assertEqual(result['input']['bytesHex'], b'Invalid stdin \xff'.hex())
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['input']['bytesHex'],
                         b'Invalid stdin \xff'.hex())
        result = self.task_call('--text', 'one', '--stdin', stdin=b'two', ok=False)
        self.assertEqual(result['error']['reason'], 'taskInputAmbiguous')
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['argv'],
                         ['--text', 'one', '--stdin'])
        self.assertEqual(self.rows('SELECT * FROM messages ORDER BY seq'), before)

    def test_refused_retries_retain_distinct_database_requests_and_complete_outcomes(self):
        bodies = ['First complete unadmitted input.\nλ🙂', 'Changed input with the same message ID.\nλ🙂']
        requests = []
        for body in bodies:
            result = self.task_call('--dispatch-id', 'repeat-dispatch', '--text', body, ok=False)
            self.assertEqual(result['error']['reason'], 'taskRouteIncomplete')
            requests.append(result['requestId'])
        self.assertNotEqual(requests[0], requests[1])
        for request_id, body in zip(requests, bodies):
            saved = self.call('task-input-read', request_id)
            self.assertEqual(saved['request']['input']['body'], body)
            self.assertEqual(saved['request']['messageId'], 'repeat-dispatch')
            self.assertEqual(saved['result']['error']['reason'], 'taskRouteIncomplete')
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', ('repeat-dispatch',)), [])

    def test_native_request_and_first_outcome_are_immutable_and_do_not_dispatch(self):
        request_id = "request ' λ🙂"
        request = {'id': request_id, 'input': {'body': 'Full input λ🙂\n'},
                   'options': {'session': 'owned-agent'}, 'setup': ['Preserve all setup values.']}
        text = json.dumps(request, ensure_ascii=False) + '\n'
        before = self.rows('SELECT * FROM messages ORDER BY seq')
        expected = {'id': request_id, 'status': 'recorded'}
        for _ in range(2):
            self.assertEqual(self.native_input('task-input-record', '-', body=text), expected)
        self.assertEqual(self.call('task-input-read', request_id),
                         {'id': request_id, 'request': request, 'result': None})
        conflict = self.native_input('task-input-record', '-', body=json.dumps({
            **request, 'input': {'body': 'Changed input.'}}), ok=False)
        self.assertEqual(json.loads(conflict['stderr']),
                         {'id': request_id, 'status': 'requestConflict'})
        outcome = {'status': 'refused', 'input': request['input'],
                   'steps': [{'argv': ['Preserved executable λ', 'literal argument'],
                              'exitCode': 1, 'stdout': 'Full output\n', 'stderr': 'Full error λ🙂\n'}],
                   'error': {'reason': 'Original setup failure', 'detail': 'Complete retained detail.'}}
        result_text = json.dumps(outcome, ensure_ascii=False) + '\n'
        for _ in range(2):
            self.assertEqual(self.native_input('task-input-result', request_id, '-', body=result_text), expected)
        changed = self.native_input('task-input-result', request_id, '-',
                                    body=json.dumps({'status': 'admitted'}), ok=False)
        self.assertEqual(json.loads(changed['stderr']),
                         {'id': request_id, 'status': 'resultConflict'})
        absent = self.native_input('task-input-result', 'absent-request', '-',
                                   body=result_text, ok=False)
        self.assertEqual(json.loads(absent['stderr']),
                         {'id': 'absent-request', 'status': 'requestAbsent'})
        self.assertEqual(self.call('task-input-read', request_id),
                         {'id': request_id, 'request': request, 'result': outcome})
        self.assertEqual(self.rows('SELECT * FROM messages ORDER BY seq'), before)

    def test_native_request_installs_schema_on_a_fresh_owned_database(self):
        database = self.directory / 'fresh-request.db'
        self.assertFalse(database.exists())

        def shutdown():
            result = subprocess.run([str(self.binary), '--instance-shutdown', str(database)],
                                    env=self.environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        self.addCleanup(shutdown)
        request = {'id': 'fresh-request', 'input': {'body': 'Complete fresh input λ🙂\n'}}
        self.assertEqual(self.native_input('task-input-record', '-', database=database,
                                          body=json.dumps(request, ensure_ascii=False)),
                         {'id': request['id'], 'status': 'recorded'})
        self.assertEqual(self.native_input('task-input-read', request['id'],
                                          database=database, body=b''),
                         {'id': request['id'], 'request': request, 'result': None})

    def test_native_request_refuses_invalid_json_ids_and_utf8_without_storage(self):
        before = self.rows('SELECT * FROM task_input_requests ORDER BY id')
        for body in (b'{"id":"\\ud800"}', b'{"id":""}', b'{"id":4}',
                     b'{"id":"bad\\u0000id"}', b'{"id":"first","id":"second"}',
                     b'[]', b'{"id":"bad-utf8","input":"\xff"}'):
            with self.subTest(input=body):
                failed = self.native_input('task-input-record', '-', body=body, ok=False)
                self.assertTrue(json.loads(failed['stderr'])['condition'])
                self.assertEqual(self.rows('SELECT * FROM task_input_requests ORDER BY id'), before)

    def test_primary_dispatch_routes_consume_literal_flag_text_and_select_named_agents(self):
        routes = [('bare', ()), ('project', ('--project', self.repo)), ('database', (self.db,))]
        for label, prefix in routes:
            for body in ('--id', '--kind'):
                with self.subTest(route=label, body=body):
                    session = 'dispatch-' + label + body
                    self.route(session)
                    mode = ['--new'] if (label, body) == ('bare', '--id') else []
                    result = self.task_call(*mode, '--to', session, '--harness', 'codex',
                                            '--model', 'gpt-6-astra', '--effort', 'low',
                                            '--command', self.fixture, '--text', body, prefix=prefix)
                    self.assertEqual(result['session'], session)
                    self.assert_retained_input(result, body)
                    stream, native = self.accept(session)
                    self.assertIn(body, native['prompt'])
                    self.failed_turn(session, stream, 'Complete ' + label + ' literal ' + body + ' fixture result.')

    def test_explicit_database_dispatch_preserves_executable_at_non_git_project_pointer(self):
        collision = self.directory / 'baton2'
        shutil.copy2(self.binary, collision)
        digest = hashlib.sha256(collision.read_bytes()).hexdigest()
        mode = collision.stat().st_mode
        environment = {'BATON_SESSION': 'root',
                       'GIT_CEILING_DIRECTORIES': str(self.directory.parent)}
        session = 'explicit-database-child'
        self.call('join', session, 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
        self.route(session)
        before = self.call('session', session)
        body = '\ufeffComplete database dispatch λ🙂\nPreserve every input line.\n' * 2000
        result = self.task_call('--to', session, '--stdin', '--command', self.fixture,
                                stdin=body.encode(), database=True, project=self.directory,
                                environment=environment)
        self.assertEqual(result['status'], 'admitted')
        self.assertEqual(result['database'], str(self.db.resolve()))
        self.assertEqual(result['projectKey'], str(self.directory.resolve()))
        self.assertEqual(result['projectResolution']['rule'], 'path-prefix')
        self.assertEqual(result['actor'], {'id': 'root', 'source': 'agent-launch-context'})
        for field in ('id', 'parent', 'workspace', 'harness', 'model', 'effort'):
            self.assertEqual(result['currentSession'][field], before[field])
        self.assertFalse(any(step['argv'][2] == 'project' for step in result['steps']))
        self.assert_retained_input(result, body)
        stream, native = self.accept(session)
        self.assertEqual(native['cwd'], str(self.repo.resolve()))
        self.assertEqual(self.call('session', session)['native'], native['native'])
        self.assert_initial_prompt(result, body, native)
        report = 'Retain the explicit database native result.'
        self.finish(stream, report, fail=True)
        execution = self.exited(session)
        turns = self.call('turns', session)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]['id'], execution['id'])
        self.assertEqual(json.loads(turns[0]['reportBody']), {'type': 'result', 'is_error': 1,
            'nativeEvent': {'type': 'turn.failed', 'error': {'message': report}}, 'result': report})
        retained = self.call('delivery', execution['id'])
        self.assertEqual((retained['sender'], retained['recipient'], retained['kind'], retained['body']),
                         (session, 'root', 'report', turns[0]['reportBody']))
        self.assertEqual(self.rows('SELECT event FROM turns WHERE id=? AND worker=?',
                                  (execution['id'], session))[0]['event'], retained['body'])
        self.eventually(lambda: self.call('session', session)['blockedCause'] == 'provider-failure')
        self.assertGreater(self.read_count(result['task']), 0)
        refused = self.task_call('--stdin', stdin=body.encode(), project=self.directory,
                                 environment=environment, ok=False)
        self.assertEqual(refused['error']['reason'], 'ENOTDIR')
        self.assertEqual(refused['input']['body'], body)
        self.assertEqual(hashlib.sha256(collision.read_bytes()).hexdigest(), digest)
        self.assertEqual(collision.stat().st_mode, mode)

    def test_explicit_database_dispatch_preserves_readable_project_pointer_conflict(self):
        pointer = self.repo / '.git/baton2/database'
        before = pointer.read_bytes()
        other = self.directory / 'other-state.db'
        body = 'Keep the registered database selection λ🙂.'
        refused = self.task_call('--text', body, prefix=(other,), ok=False)
        self.assertEqual(refused['error']['reason'], 'taskProjectDatabaseConflict')
        self.assertEqual(refused['input']['body'], body)
        self.assertEqual(pointer.read_bytes(), before)
        self.assertFalse(other.exists())

    def test_existing_as_dispatch_keeps_contextual_message_authority_and_full_body(self):
        session = 'contextual-dispatch-agent'
        self.call('join', session, 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
        endpoint = json.dumps([sys.executable, '-c', 'import sys;print(sys.argv[-1])'])
        self.call('connect', session, '', endpoint)
        body = 'Complete contextual dispatch λ🙂\n'
        before = self.rows('SELECT * FROM task_input_requests ORDER BY id')
        rows = self.call('as', 'root', 'dispatch', '--id', 'contextual-dispatch',
                         '--to', session, '--kind', 'task', '--text', body)
        self.assertEqual(rows[0]['status'], 'completed')
        saved = self.call('delivery', 'contextual-dispatch')
        self.assertEqual((saved['sender'], saved['recipient'], saved['kind'], saved['body']),
                         ('root', session, 'task', body))
        self.assertEqual(self.rows('SELECT * FROM task_input_requests ORDER BY id'), before)

    def test_recorded_actor_context_dispatches_and_continues_without_sender_or_control_ids(self):
        native = self.call('session', 'root')['native']
        for label, environment in (('session', {'BATON_SESSION': 'root'}),
                                   ('native', {'CODEX_THREAD_ID': native})):
            with self.subTest(context=label):
                recipient = 'actor-child-' + label
                self.call('join', recipient, 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
                endpoint = json.dumps([sys.executable, '-c', 'import sys;print(sys.argv[-1])'])
                self.call('connect', recipient, '', endpoint)
                first = self.task_call('--to', recipient, '--text', 'Original context task λ🙂',
                                       environment=environment)
                second = self.task_call('--to', recipient, '--text', 'Continue through recorded state λ🙂',
                                        environment=environment)
                self.assertEqual(second['actor'], {'id': 'root', 'source': 'agent-launch-context'})
                self.assertTrue(any(step['argv'][2] == 'agent-current-session' for step in second['steps']))
                self.assertEqual(self.call('delivery', first['task'])['sender'], 'root')
                self.assertEqual(self.call('delivery', second['task'])['sender'], 'root')
                self.assertEqual(self.call('delivery', second['task'])['kind'], 'task-continuation')
                self.assertEqual(second['currentSession']['endpointArgv'], json.loads(endpoint))
                self.assertIsNone(self.call('delivery', first['task'])['receipt'])
                self.assertIsNone(self.call('delivery', second['task'])['receipt'])
                self.assertEqual(second['currentSession']['taskCompletion']['assignmentId'], first['task'])
                request = self.call('task-input-read', second['requestId'])
                self.assertEqual(request['request']['sender'], 'root')
                self.assertEqual(second['inspect']['request'],
                                 [str(self.binary.resolve()), str(self.db), 'task-input-read', '--current'])
                self.assertEqual(self.native_input('task-input-read', '--current', body=b'',
                                                  environment=environment), request)

    def test_unresolved_agent_context_refuses_dispatch_and_preserves_input_without_operator_fallback(self):
        native = self.call('session', 'root')['native']
        before = self.rows('SELECT * FROM sessions ORDER BY id'), self.rows('SELECT * FROM messages ORDER BY seq')
        for environment in ({'BATON_SESSION': 'absent-actor', 'CODEX_THREAD_ID': native},
                            {'CODEX_THREAD_ID': 'unbound-native-thread'}):
            with self.subTest(context=environment):
                body = 'Preserve the entire unresolved-context input λ🙂\n'
                result = self.task_call('--to', 'root', '--text', body,
                                        environment=environment, ok=False)
                self.assertEqual(result['actor'], {'id': None, 'source': 'agent-launch-context'})
                self.assertEqual(result['error']['reason'], 'taskOperationFailed')
                failed = next(step for step in result['steps'] if step['argv'][2] == 'agent-current-session')
                self.assertNotEqual(failed['exitCode'], 0)
                saved = self.call('task-input-read', result['requestId'])
                self.assertIsNone(saved['request']['sender'])
                self.assertEqual(saved['request']['input']['body'], body)
                self.assertEqual(saved['result'], result)
                self.assertFalse(any(step['argv'][2] in ('start-setup', 'join', 'receiver', 'message-batch-file')
                                     for step in result['steps']))
                self.assertEqual((self.rows('SELECT * FROM sessions ORDER BY id'),
                                  self.rows('SELECT * FROM messages ORDER BY seq')), before)

    def test_scoped_request_inspection_preserves_other_authors_and_all_original_requests(self):
        requests = [
            {'id': 'owned-earlier', 'sender': 'root', 'session': 'first-recipient', 'input': {'body': 'Earlier owned λ'}},
            {'id': 'owned-current', 'sender': 'root', 'session': 'second-recipient', 'input': {'body': 'Current owned λ🙂'}},
            {'id': 'foreign-later', 'sender': 'other-author', 'session': 'second-recipient', 'input': {'body': 'Foreign complete input'}},
            {'id': 'operator-latest', 'sender': 'operator', 'session': 'second-recipient', 'input': {'body': 'Operator input'}},
        ]
        self.call('attach', 'other-author', 'codex', 'other-native', '')
        for request in requests:
            self.native_input('task-input-record', '-', body=json.dumps(request, ensure_ascii=False))
        before = self.rows('SELECT * FROM task_input_requests ORDER BY id')
        current = self.native_input('task-input-read', '--current', body=b'',
                                    environment={'BATON_SESSION': 'root'})
        self.assertEqual(current['request'], requests[1])
        selected = self.native_input('task-input-read', '--session', 'first-recipient', body=b'',
                                     environment={'BATON_SESSION': 'root'})
        self.assertEqual(selected['request'], requests[0])
        foreign = self.native_input('task-input-read', '--current', body=b'',
                                    environment={'BATON_SESSION': 'other-author'})
        self.assertEqual(foreign['request'], requests[2])
        operator = self.native_input('task-input-read', '--current', body=b'')
        self.assertEqual(operator['request'], requests[3])
        self.native_input('task-input-read', '--session', 'absent-recipient', body=b'',
                          environment={'BATON_SESSION': 'root'}, ok=False)
        self.native_input('task-input-read', '--current', body=b'',
                          environment={'CODEX_THREAD_ID': 'unbound-native-thread'}, ok=False)
        self.assertEqual(self.rows('SELECT * FROM task_input_requests ORDER BY id'), before)
        for request in requests:
            self.assertEqual(self.call('task-input-read', request['id'])['request'], request)

    def test_explicit_continue_requires_an_existing_open_assignment(self):
        self.call('join', 'idle', 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
        result = self.task_call('--to', 'idle', '--continue', '--text', 'Require recorded open work.', ok=False)
        self.assertEqual(result['error']['reason'], 'taskAssignmentClosed')
        self.assertIsNone(result.get('admission'))

    def test_database_record_failure_returns_full_input_and_native_error_without_dispatch(self):
        project = self.directory / 'record-failure-project'
        project.mkdir()
        subprocess.run(['git', '-C', str(project), 'init', '-q'],
                       env=self.environment, check=True, capture_output=True)
        database = project / '.git/baton2/orchestra.db'
        database.parent.mkdir()
        original = b'Original non-SQLite database bytes.\n'
        database.write_bytes(original)
        body = 'Preserve the complete refused dispatch.\nλ🙂'
        before = self.rows('SELECT * FROM messages ORDER BY seq')
        result = self.task_call('--to', 'uncreated-agent', '--text', body, project=project, ok=False)
        self.assertEqual(result['status'], 'refused')
        self.assertEqual(result['input']['body'], body)
        self.assertEqual(result['database'], str(database))
        self.assertEqual(result['inputRecordError']['reason'], 'taskOperationFailed')
        failed = next(step for step in result['steps'] if step['argv'][2] == 'task-input-record')
        self.assertNotEqual(failed['exitCode'], 0)
        self.assertTrue(failed['stderr'])
        self.assertEqual(json.loads(result['inputRecordError']['detail']), failed)
        self.assertEqual(failed['argv'][-1], '-')
        self.assertEqual(sum(step['argv'][2] == 'task-input-record' for step in result['steps']), 1)
        self.assertFalse(any(step['argv'][2] in ('project', 'start-setup', 'join', 'configure',
                                                'receiver', 'message-batch-file', 'task-input-result')
                             for step in result['steps']))
        self.assertIsNone(result.get('admission'))
        self.assertEqual(database.read_bytes(), original)
        self.assertFalse(pathlib.Path(str(database) + '.transcripts').exists())
        self.assertEqual(self.rows('SELECT * FROM messages ORDER BY seq'), before)

    def test_to_and_session_aliases_reject_duplicate_selection_without_dispatch(self):
        before = self.rows('SELECT * FROM messages ORDER BY seq')
        args = ['--to', 'root', '--session', 'different-agent', '--text', 'Full input λ🙂']
        result = self.task_call(*args, ok=False)
        self.assertEqual(result['error']['reason'], 'taskOptionInvalid')
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['argv'], args)
        self.assertEqual(self.rows('SELECT * FROM messages ORDER BY seq'), before)

    def test_existing_continuation_preserves_assignment_native_parent_workspace_and_pending_input(self):
        session = 'continuing'
        self.route(session)
        assignment = self.call('recruit', session, 'root', 'codex', 'gpt-6-astra', 'low',
                               self.repo, 'continuing-branch', self.checkouts / session, self.base)
        self.call('connect', session, 'recorded-native-continuation', '')
        log = self.directory / 'existing.jsonl'
        self.call('receiver', session, self.fixture, log)
        with self.held_session(session):
            self.pending_input('original-assignment', 'root', session, 'task', 'Original owed task λ.')
            self.pending_input('prior-pending', 'root', session, 'custom-note', 'Preserve this pending note.')
            before = self.call('session', session)
            body = 'Continue the same task.\nComplete supplemental input λ🙂.'
            refused = self.task_call('--session', session, '--continue', '--text',
                                     'Operator authority remains scoped to its Principal.', ok=False)
            self.assertEqual(refused['error']['reason'], 'taskAdmissionRefused')
            self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', (refused['task'],)), [])
            result = self.task_call('--sender', 'root', '--to', session,
                                    '--effort', 'high', '--text', body)
            self.assert_retained_input(result, body)
            self.assertEqual(self.call('delivery', result['task'])['kind'], 'task-continuation')
            current = result['currentSession']
            for field in ('native', 'parent', 'workspace', 'branch', 'base', 'endpointArgv'):
                self.assertEqual(current[field], before[field])
            self.assertEqual(current['taskCompletion']['assignmentId'], 'original-assignment')
            self.assertEqual(current['effort'], 'high')
            self.assertEqual(current['workspace'], assignment['workspace'])
        self.call('receiver', session, self.fixture, log)
        stream, native = self.accept(session)
        self.assertEqual(native['native'], 'recorded-native-continuation')
        self.assertIn('model_reasoning_effort="high"', native['args'])
        for text in (body, 'Original owed task λ.', 'Preserve this pending note.'):
            self.assertIn(text, native['prompt'])
        self.finish(stream, 'The immediate fixture coordinator confirms the assigned work.')
        self.exited(session)
        completion = self.call('session', session)['taskCompletion']
        self.assertEqual(completion['assignmentId'], 'original-assignment')
        self.assertTrue(completion['confirmed'])
        self.assertFalse(completion['open'])

    def test_missing_recorded_receiver_is_reported_before_admission_and_can_be_repaired(self):
        session = 'repaired-receiver'
        assignment = self.call('recruit', session, 'root', 'codex', 'gpt-6-astra', 'low',
                               self.repo, 'repaired-receiver-branch', self.checkouts / session, self.base)
        old = self.directory / 'removed-client'
        shutil.copy2(self.fixture, old)
        log = self.directory / 'repaired-receiver.jsonl'
        self.call('receiver', session, old, log)
        with self.held_session(session):
            self.pending_input('repaired-receiver-assignment', 'root', session, 'task', 'Original receiver task.')
            old.unlink()
            body = 'Keep this input available while the recorded receiver is repaired.'
            refused = self.task_call('--sender', 'root', '--session', session, '--continue',
                                     '--text', body, ok=False)
            self.assertEqual(refused['error']['reason'], 'taskCommandMissing')
            self.assertIn(str(old), refused['error']['detail'])
            self.assertIn('baton receiver', refused['error']['next'])
            self.assertEqual(self.rows('SELECT id FROM messages WHERE id=?', (refused['task'],)), [])
            self.assertEqual(self.call('delivery', 'repaired-receiver-assignment')['body'], 'Original receiver task.')
            self.call('receiver', session, self.fixture, log)
            result = self.task_call('--sender', 'root', '--session', session, '--continue', '--text', body)
        self.assertEqual(result['status'], 'admitted')
        self.assertEqual(result['currentSession']['workspace'], assignment['workspace'])
        self.assert_retained_input(result, body)
        stream, native = self.accept(session)
        self.assertEqual(native['cwd'], assignment['workspace'])
        self.assertIn(body, native['prompt'])
        self.finish(stream, 'The repaired receiver delivered the continued task.')
        self.exited(session)

    def test_stopped_session_and_explicit_new_assignment_leave_owned_state_unchanged(self):
        self.call('join', 'stopped', 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
        self.pending_input('owed-original', 'root', 'stopped', 'task', 'Retain the stopped task.')
        open_result = self.task_call('--session', 'stopped', '--new', '--text', 'A fresh session is required.', ok=False)
        self.assertEqual(open_result['error']['reason'], 'taskSessionExists')
        self.call('stop', 'stopped', 'explicit-stop', 'The operator stopped this session.')
        before = self.rows('SELECT * FROM sessions ORDER BY id'), self.rows('SELECT * FROM messages ORDER BY seq')
        stopped = self.task_call('--session', 'stopped', '--continue', '--text', 'Retain this refusal.', ok=False)
        self.assertEqual(stopped['error']['reason'], 'taskSessionStopped')
        self.assertIn('--lift-stop', stopped['error']['next'])
        self.assertEqual((self.rows('SELECT * FROM sessions ORDER BY id'),
                          self.rows('SELECT * FROM messages ORDER BY seq')), before)

    def test_operator_continues_recorded_principal_assignment_and_native_conversation(self):
        session = 'principal-continuing'
        self.route(session)
        self.call('start-setup', session, 'codex', self.fixture, 'gpt-6-astra', 'low',
                  self.repo, self.directory / 'principal-continuing.jsonl')
        self.call('connect', session, 'recorded-principal-native',
                  self.call('session', session)['endpoint'])
        with self.held_session(session):
            self.pending_input('operator-original', 'operator', session, 'task', 'Retain the operator task.')
            before = self.call('session', session)
            result = self.task_call('--session', session, '--text', 'Continue the operator task λ🙂.')
            self.assertEqual(self.call('delivery', result['task'])['kind'], 'task-continuation')
            self.assertEqual(result['currentSession']['taskCompletion']['assignmentId'], 'operator-original')
            for field in ('native', 'parent', 'workspace', 'branch', 'base', 'endpointArgv'):
                self.assertEqual(result['currentSession'][field], before[field])
        self.call('receiver', session, self.fixture, self.directory / 'principal-continuing.jsonl')
        stream, native = self.accept(session)
        self.assertEqual(native['native'], 'recorded-principal-native')
        self.assertIn('Retain the operator task.', native['prompt'])
        self.assertIn('Continue the operator task λ🙂.', native['prompt'])
        self.failed_turn(session, stream, 'Retain the unfinished operator task and its provider cause.')

    def test_project_selection_rejects_an_unrelated_recorded_session(self):
        unrelated = self.directory / 'unrelated-project'
        subprocess.run(['git', 'clone', '--quiet', '--shared', str(self.repo), str(unrelated)],
                       env=self.environment, check=True, capture_output=True)
        self.call('join', 'foreign', 'root', 'codex', 'gpt-6-astra', 'low', unrelated)
        self.pending_input('foreign-task', 'root', 'foreign', 'task', 'Retain the other project task.')
        before = self.rows('SELECT * FROM sessions ORDER BY id'), self.rows('SELECT * FROM messages ORDER BY seq')
        result = self.task_call('--session', 'foreign', '--continue', '--text', 'No cross-project selection.', ok=False)
        self.assertEqual(result['error']['reason'], 'taskProjectSessionConflict')
        self.assertEqual((self.rows('SELECT * FROM sessions ORDER BY id'),
                          self.rows('SELECT * FROM messages ORDER BY seq')), before)

    def test_registered_database_and_git_common_directory_preserve_trailing_spaces(self):
        controls.shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())
        self.db = self.directory / 'database with trailing space '
        self.repo = self.directory / 'separate-git-checkout'
        common = self.directory / 'git common directory '
        subprocess.run(['git', 'init', '-q', '-b', 'main', '--separate-git-dir', str(common), str(self.repo)],
                       env=self.environment, check=True, capture_output=True)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['db'] = str(self.db)
        config_path.write_text(json.dumps(config))
        self.root()
        registered = self.call('project', self.repo)
        self.assertEqual(registered['project'], str(common.resolve()))
        self.assertEqual((common / 'baton2/database').read_bytes(), str(self.db.resolve()).encode())
        self.route('literal-paths')
        result = self.task_call('--session', 'literal-paths', '--harness', 'codex', '--model', 'gpt-6-astra',
                                '--effort', 'low', '--command', self.fixture,
                                '--text', 'Preserve the actual registered paths λ🙂.')
        self.assertEqual(result['database'], str(self.db.resolve()))
        self.assertEqual(result['projectKey'], str(common.resolve()))
        self.assert_retained_input(result, result['input']['body'])
        stream, native = self.accept('literal-paths')
        self.assertEqual(native['cwd'], str(self.repo.resolve()))
        self.failed_turn('literal-paths', stream, 'Retain the literal-path provider result.')

    def test_dispatch_from_outside_project_resolves_explicit_or_recorded_workspace_before_input(self):
        body = 'Resolve dispatch setup from the selected repository workspace.'
        explicit = self.task_call('--new', '--workspace', self.repo, '--harness', 'codex',
                                  '--model', 'gpt-6-astra', '--effort', 'low', '--command', self.fixture,
                                  '--text', body, database=True, project=self.directory)
        self.assertEqual(explicit['status'], 'admitted')
        self.assertEqual(explicit['projectKey'], str(self.repo.joinpath('.git').resolve()))
        self.assertEqual(explicit['currentSession']['workspace'], str(self.repo.resolve()))
        self.assert_retained_input(explicit, body)
        stream, native = self.accept(explicit['session'])
        self.assertEqual(native['cwd'], str(self.repo.resolve()))
        self.finish(stream, 'Explicit workspace dispatch completed.')
        self.exited(explicit['session'])

        session = 'recorded-workspace-dispatch'
        assignment = self.call('recruit', session, 'root', 'codex', 'gpt-6-astra', 'low',
                               self.repo, 'recorded-workspace-branch', self.checkouts / session, self.base)
        self.call('receiver', session, self.fixture, self.directory / 'recorded-workspace.jsonl')
        with self.held_session(session):
            self.pending_input('recorded-workspace-assignment', 'root', session, 'task', 'Original task.')
            result = self.task_call('--sender', 'root', '--session', session, '--continue',
                                    '--harness', 'codex', '--model', 'gpt-6-astra', '--effort', 'low',
                                    '--command', self.fixture, '--text', body,
                                    database=True, project=self.directory)
        self.assertEqual(result['status'], 'admitted')
        self.assertEqual(result['projectKey'], str(self.repo.joinpath('.git').resolve()))
        self.assertEqual(result['currentSession']['workspace'], assignment['workspace'])
        self.assert_retained_input(result, body)
        stream, native = self.accept(session)
        self.assertEqual(native['cwd'], assignment['workspace'])
        self.finish(stream, 'Recorded workspace dispatch completed.')
        self.exited(session)

    def test_non_git_nested_workspace_uses_native_prefix_membership_and_rejects_adjacent_path(self):
        self.environment['GIT_CEILING_DIRECTORIES'] = str(self.directory)
        project = self.directory / 'plain-project'
        workspace = project / 'nested'
        workspace.mkdir(parents=True)
        adjacent = self.directory / 'plain-project-other'
        adjacent.mkdir()
        self.call('project', project)
        self.call('join', 'plain', 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
        self.call('receiver', 'plain', self.fixture, self.directory / 'plain.jsonl', workspace)
        with self.held_session('plain'):
            self.pending_input('plain-assignment', 'root', 'plain', 'task', 'Original plain project task.')
            self.route('plain')
            result = self.task_call('--sender', 'root', '--project', project, '--session', 'plain', '--continue',
                                    '--text', 'Continue the nested non-Git workspace.', project=project)
            self.assertEqual(result['projectResolution']['rule'], 'path-prefix')
            self.assertEqual(result['currentSession']['workspace'], str(workspace.resolve()))
            self.assertEqual(result['currentSession']['taskCompletion']['assignmentId'], 'plain-assignment')
        self.call('receiver', 'plain', self.fixture, self.directory / 'plain.jsonl', workspace)
        stream, native = self.accept('plain')
        self.assertEqual(native['cwd'], str(workspace.resolve()))
        self.finish(stream)
        self.exited('plain')
        refused = self.task_call('--project', project, '--workspace', adjacent, '--harness', 'codex',
                                 '--model', 'gpt-6-astra', '--effort', 'low', '--command', self.fixture,
                                 '--text', 'Reject adjacent unrelated workspace.', project=project, ok=False)
        self.assertEqual(refused['error']['reason'], 'taskWorkspaceProjectConflict')
        self.assertIsNone(refused.get('admission'))

    def test_profile_append_failure_retains_applied_configuration_and_complete_unadmitted_input(self):
        session = 'partial'
        self.call('join', session, 'root', 'codex', 'kimi-code/k3', 'low', self.repo)
        self.call('receiver', session, self.fixture, self.directory / 'partial.jsonl')
        store = self.directory / 'external-account'
        store.mkdir()
        self.settings([{'name': 'profile', 'harness': 'codex', 'model': 'gpt-6-astra',
                        'effort': 'high', 'profile': 'primary'}],
                      [{'harness': 'codex', 'label': 'primary', 'store': str(store)}])
        profile_path = pathlib.Path(str(self.db) + '.profile-' + session.encode().hex())
        profile_path.mkdir()
        body = 'Keep complete task text after a physical profile write failure.\nλ🙂'
        result = self.task_call('--session', session, '--route', 'profile', '--text', body, ok=False)
        self.assertEqual(result['error']['reason'], 'taskOperationFailed')
        self.assertEqual((result['currentSession']['model'], result['currentSession']['effort']),
                         ('gpt-6-astra', 'high'))
        self.assertTrue(any(step['argv'][2] == 'profile-bind' and step['exitCode'] != 0 for step in result['steps']))
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['input']['body'], body)
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', (result['task'],)), [])

    def test_receiver_setup_failure_retains_input_and_native_error_without_admission(self):
        body = 'The setup failure must retain all input.\nλ🙂'
        result = self.task_call('--harness', 'codex', '--model', 'gpt-6-astra', '--effort', 'low',
                                '--command', self.directory / 'missing-native-executable',
                                '--text', body, ok=False)
        self.assertEqual(result['error']['reason'], 'taskOperationFailed')
        self.assertEqual(self.call('task-input-read', result['requestId'])['request']['input']['body'], body)
        failure = next(step for step in result['steps'] if step['argv'][2] == 'start-setup')
        self.assertNotEqual(failure['exitCode'], 0)
        self.assertTrue(failure['stderr'])
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', (result['task'],)), [])

    def test_packaged_mcp_task_uses_same_operation_and_attached_parent_for_complete_input(self):
        script = self.prefix / 'libexec/baton2/mcp-conductor.mjs'
        body = 'MCP task λ🙂\nComplete multiline input owned by the attached Conductor.\n' * 2000
        for tool in ('baton2_dispatch', 'baton2_task'):
            for source in ('text', 'file'):
                with self.subTest(tool=tool, source=source):
                    self.mcp_task(script, body, source, tool)

    def mcp_task(self, script, body, source, tool):
        session = 'mcp-child-' + source + '-' + tool
        self.route(session)
        self.call('attach', 'root', 'claude-code', 'saved-root', '')
        task_file = self.directory / 'MCP plain task.txt'
        if source == 'file':
            task_file.write_bytes(body.encode())
        arguments = {source: body if source == 'text' else str(task_file), 'project': str(self.repo),
                     'session': session, 'harness': 'codex', 'model': 'gpt-6-astra',
                     'effort': 'low', 'command': str(self.fixture)}
        argv = ['node', str(script), str(self.db), str(self.binary), '--session', 'root']
        stdout_path = self.directory / (session + '.mcp.stdout.jsonl')
        stderr_path = self.directory / (session + '.mcp.stderr')
        environment = dict(self.environment)
        for name in ('BATON_ATTEMPT_DIRECTORY', 'BATON_MCP_INPUT', 'CODEX_THREAD_ID'):
            environment.pop(name, None)
        with stdout_path.open('wb') as output, stderr_path.open('wb') as errors:
            child = subprocess.Popen(argv, env=environment, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=errors)
            graceful = False

            def send(value):
                child.stdin.write((json.dumps(value) + '\n').encode())
                child.stdin.flush()

            def read():
                line = child.stdout.readline()
                output.write(line)
                output.flush()
                self.assertTrue(line, f'MCP output ended; stdout={stdout_path}; stderr={stderr_path}')
                return json.loads(line)

            def response(ident):
                while True:
                    answer = read()
                    if 'method' not in answer:
                        self.assertEqual(answer['id'], ident, answer)
                        self.assertIn('result', answer, answer)
                        return answer['result']

            def invoke(name, value):
                send({'jsonrpc': '2.0', 'id': name, 'method': 'tools/call',
                      'params': {'name': name, 'arguments': value}})
                answer = response(name)
                self.assertNotIn('isError', answer, answer)
                return json.loads(answer['content'][0]['text'])

            def owned_reads():
                if not self.rows("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message_reads'"):
                    return []
                return self.rows("SELECT * FROM message_reads WHERE recipient='root' ORDER BY attempt,message")

            try:
                send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}})
                self.assertEqual(response(1)['serverInfo']['name'], 'baton-conductor')
                send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
                send({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
                tools = {item['name']: item for item in response(2)['tools']}
                self.assertIn('baton2_dispatch', tools)
                self.assertIn('baton2_task', tools)
                ready = read()
                self.assertEqual((ready['id'], ready['method']), ('conductor-channel-ready', 'ping'))
                send({'jsonrpc': '2.0', 'id': ready['id'], 'result': {}})
                root = self.call('session', 'root')
                self.assertEqual((root['harness'], root['native']), ('claude-code', 'saved-root'))
                self.assertIn(str(script), json.loads(root['endpoint']))
                before = owned_reads()
                result = invoke(tool, arguments)
                self.assertEqual(result['status'], 'admitted', result)
                self.assert_retained_input(result, body)
                self.assertEqual(self.call('delivery', result['task'])['sender'], 'root')
                self.assertEqual(self.call('session', session)['parent'], 'root')
                self.assertTrue(any(step['argv'][2] == 'join' for step in result['steps']))
                self.assertEqual(owned_reads(), before)
                stream, native = self.accept(session)
                self.assertIn(body, native['prompt'])
                report = 'The attached fixture parent confirms the complete MCP task.\nλ🙂\n'
                self.finish(stream, report)
                self.exited(session)
                self.assertTrue(self.call('session', session)['taskCompletion']['confirmed'])
                self.eventually(lambda: any(row['reportBody'] == report for row in self.call('turns', session)))
                inbox = invoke('baton2_inbox', {})
                reports = [row for row in inbox if row['sender'] == session and row['body'] == report]
                self.assertEqual(len(reports), 1, inbox)
                owned = next(row for row in owned_reads() if row['message'] == reports[0]['id'])
                self.assertEqual((owned['recipient'], owned['native']), ('root', 'saved-root'))
                self.assertTrue(owned['attempt'].startswith('claude-mcp:'), owned)
                self.assertIsNone(owned['handled'])
                self.assertIsNone(self.call('delivery', reports[0]['id'])['receipt'])
                child.stdin.close()
                child.stdin = None
                graceful = True
            finally:
                if not graceful and child.poll() is None:
                    child.terminate()
                tail, _ = child.communicate()
                output.write(tail)
                with (self.directory / 'commands.jsonl').open('a') as commands:
                    commands.write(json.dumps({'argv': argv, 'code': child.returncode,
                        'stdoutPath': str(stdout_path), 'stderrPath': str(stderr_path),
                        'direct_wait_completed': True}) + '\n')
        self.assertEqual(child.returncode, 0, stderr_path.read_text())


if __name__ == '__main__':
    unittest.main()
