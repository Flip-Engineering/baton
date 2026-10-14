"""Ordinary task input through native CLI and the packaged MCP operation."""
import hashlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import unittest


def fixture_module(name, file):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


identity = fixture_module('task_identity_fixture', 'control-identity.py')
controls = identity.controls


class TaskStart(unittest.TestCase):
    git = identity.ControlIdentity.git
    call = identity.ControlIdentity.call
    root = identity.ControlIdentity.root
    accept = identity.ControlIdentity.accept
    action = identity.ControlIdentity.action
    finish = identity.ControlIdentity.finish
    rows = identity.ControlIdentity.rows
    eventually = identity.ControlIdentity.eventually
    process_rows = identity.ControlIdentity.process_rows
    exited = identity.ControlIdentity.exited
    close_fixtures = identity.ControlIdentity.close_fixtures

    def setUp(self):
        identity.ControlIdentity.setUp(self)
        for directory, name in (('harness', 'task-start.mjs'),
                                ('harness', 'project-settings.mjs'),
                                ('scripts', 'mcp-conductor.mjs')):
            source = controls.ROOT / 'bend2' / directory / name
            copy = self.prefix / 'libexec/baton2' / name
            shutil.copy2(source, copy)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(hashlib.sha256(copy.read_bytes()).hexdigest(), digest)
            self.pins.append({'source': str(source), 'copy': str(copy), 'sha256': digest})
        (self.directory / 'task-package-copies.json').write_text(json.dumps(self.pins, indent=2) + '\n')
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

    def task_call(self, *args, stdin=None, ok=True, project=None, database=False):
        argv = [str(self.binary)] + ([str(self.db)] if database else []) + ['task', *map(str, args)]
        result = subprocess.run(argv, input=stdin, cwd=project or self.repo,
                                env=self.environment, capture_output=True)
        stdout, stderr = result.stdout.decode(), result.stderr.decode()
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps({'argv': argv, 'code': result.returncode,
                                     'stdout': stdout, 'stderr': stderr,
                                     'direct_wait_completed': True}) + '\n')
        self.assertEqual(result.returncode == 0, ok, stdout + stderr)
        value = json.loads(stdout)
        if value.get('resultPath'):
            self.assertEqual(json.loads(pathlib.Path(value['resultPath']).read_text()), value)
        return value

    def settings(self, routes, subscriptions=None):
        value = {'schema': 'baton2-project-settings-v1', 'routes': routes,
                 'context': {'disabled': ['preserved-context'], 'preferred': ['existing-context']},
                 'subscriptions': subscriptions or []}
        self.settings_path.write_text(json.dumps(value))
        return self.settings_path.read_bytes()

    def assert_retained_input(self, result, body):
        self.assertEqual(result['input']['body'], body)
        self.assertEqual(pathlib.Path(result['inputPath']).read_bytes(), body.encode())
        saved = self.call('delivery', result['task'])
        self.assertEqual(saved['body'], body)
        self.assertEqual(saved['recipient'], result['session'])
        self.assertEqual(result['inspect']['input'], [str(self.binary.resolve()), str(self.db), 'input', result['task']])

    def failed_turn(self, session, stream, report):
        self.finish(stream, report, fail=True)
        self.exited(session)
        turn = self.eventually(lambda: next((row for row in self.call('turns', session)
                                            if row['reportBody'] == report), None))
        self.eventually(lambda: self.call('session', session)['blockedCause'] == 'provider-failure')
        return turn

    def test_complete_text_stdin_and_utf8_file_use_owned_setup_and_transcripts(self):
        body = '\ufeffTask λ🙂\nReview "quotes" and the entire input.\n' * 2000
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
                    file = self.directory / 'complete UTF8 input.txt'
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
                self.assertEqual(native['cwd'], str(self.repo.resolve()))
                self.failed_turn(session, stream, 'Retained provider error λ🙂\n' + source)
                self.assertTrue(pathlib.Path(result['outputLog']).is_file())
                self.assertEqual(self.call('delivery', result['task'])['receipt'], 'fixture-native-reviewed')

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
        self.assertEqual(native['args'][native['args'].index('--model') + 1], 'kimi-code/k3')
        self.assertEqual(native['args'][native['args'].index('--thinking') + 1], 'high')
        self.failed_turn('named', stream, 'Retain the named route result.')

    def test_missing_route_does_not_choose_first_saved_route_or_an_existing_session(self):
        self.settings([{'name': 'first', 'harness': 'codex', 'model': 'gpt-6-astra', 'effort': 'low'}])
        result = self.task_call('Task text is retained when defaults are incomplete.',
                                '--command', self.fixture, ok=False)
        self.assertEqual(result['error']['reason'], 'taskRouteIncomplete')
        self.assertIn('--route NAME', result['error']['next'])
        self.assertEqual(pathlib.Path(result['inputPath']).read_text(), result['input']['body'])
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
        result = self.task_call('--stdin', stdin=b'Invalid stdin \xff', ok=False)
        self.assertEqual(result['error']['reason'], 'taskInputInvalidUtf8')
        self.assertEqual(result['input']['bytesHex'], b'Invalid stdin \xff'.hex())
        result = self.task_call('--text', 'one', '--stdin', stdin=b'two', ok=False)
        self.assertEqual(result['error']['reason'], 'taskInputAmbiguous')
        self.assertEqual(self.rows('SELECT * FROM messages ORDER BY seq'), before)

    def test_existing_continuation_preserves_assignment_native_parent_workspace_and_pending_input(self):
        session = 'continuing'
        self.route(session)
        assignment = self.call('recruit', session, 'root', 'codex', 'gpt-6-astra', 'low',
                               self.repo, 'continuing-branch', self.checkouts / session, self.base)
        self.call('connect', session, 'recorded-native-continuation', '')
        log = self.directory / 'existing.jsonl'
        self.call('receiver', session, self.fixture, log)
        self.call('message', 'original-assignment', 'root', session, 'task', 'Original owed task λ.')
        self.call('message', 'prior-pending', 'root', session, 'custom-note', 'Preserve this pending note.')
        before = self.call('session', session)
        body = 'Continue the same task.\nComplete supplemental input λ🙂.'
        refused = self.task_call('--session', session, '--continue', '--text',
                                 'Operator authority remains scoped to its Principal.', ok=False)
        self.assertEqual(refused['error']['reason'], 'taskAdmissionRefused')
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', (refused['task'],)), [])
        result = self.task_call('--sender', 'root', '--session', session, '--continue',
                                '--effort', 'high', '--text', body)
        self.assert_retained_input(result, body)
        self.assertEqual(self.call('delivery', result['task'])['kind'], 'task-continuation')
        current = result['currentSession']
        for field in ('native', 'parent', 'workspace', 'branch', 'base', 'endpointArgv'):
            self.assertEqual(current[field], before[field])
        self.assertEqual(current['taskCompletion']['assignmentId'], 'original-assignment')
        self.assertEqual(current['effort'], 'high')
        self.assertEqual(current['workspace'], assignment['workspace'])
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

    def test_stopped_session_and_implicit_new_assignment_leave_owned_state_unchanged(self):
        self.call('join', 'stopped', 'root', 'codex', 'gpt-6-astra', 'low', self.repo)
        self.call('message', 'owed-original', 'root', 'stopped', 'task', 'Retain the stopped task.')
        open_result = self.task_call('--session', 'stopped', '--text', 'New task is ambiguous.', ok=False)
        self.assertEqual(open_result['error']['reason'], 'taskAssignmentOpen')
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
        self.call('message', 'operator-original', 'operator', session, 'task', 'Retain the operator task.')
        before = self.call('session', session)
        result = self.task_call('--session', session, '--continue', '--text', 'Continue the operator task λ🙂.')
        self.assertEqual(result['currentSession']['taskCompletion']['assignmentId'], 'operator-original')
        for field in ('native', 'parent', 'workspace', 'branch', 'base', 'endpointArgv'):
            self.assertEqual(result['currentSession'][field], before[field])
        stream, native = self.accept(session)
        self.assertEqual(native['native'], 'recorded-principal-native')
        self.assertIn('Retain the operator task.', native['prompt'])
        self.assertIn('Continue the operator task λ🙂.', native['prompt'])
        self.failed_turn(session, stream, 'Retain the unfinished operator task and its provider cause.')

    def test_project_selection_rejects_an_unrelated_recorded_session(self):
        unrelated = self.directory / 'unrelated-project'
        unrelated.mkdir()
        self.call('join', 'foreign', 'root', 'codex', 'gpt-6-astra', 'low', unrelated)
        self.call('message', 'foreign-task', 'root', 'foreign', 'task', 'Retain the other project task.')
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

    def test_non_git_nested_workspace_uses_native_prefix_membership_and_rejects_adjacent_path(self):
        project = self.directory / 'plain-project'
        workspace = project / 'nested'
        workspace.mkdir(parents=True)
        adjacent = self.directory / 'plain-project-other'
        adjacent.mkdir()
        self.call('project', project)
        self.call('join', 'plain', 'root', 'codex', 'gpt-6-astra', 'low', workspace)
        self.call('receiver', 'plain', self.fixture, self.directory / 'plain.jsonl')
        self.call('message', 'plain-assignment', 'root', 'plain', 'task', 'Original plain project task.')
        self.route('plain')
        result = self.task_call('--sender', 'root', '--project', project, '--session', 'plain', '--continue',
                                '--text', 'Continue the nested non-Git workspace.', project=project)
        self.assertEqual(result['projectResolution']['rule'], 'path-prefix')
        self.assertEqual(result['currentSession']['workspace'], str(workspace.resolve()))
        self.assertEqual(result['currentSession']['taskCompletion']['assignmentId'], 'plain-assignment')
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
        self.assertEqual(pathlib.Path(result['inputPath']).read_text(), body)
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', (result['task'],)), [])

    def test_receiver_setup_failure_retains_input_and_native_error_without_admission(self):
        body = 'The setup failure must retain all input.\nλ🙂'
        result = self.task_call('--harness', 'codex', '--model', 'gpt-6-astra', '--effort', 'low',
                                '--command', self.directory / 'missing-native-executable',
                                '--text', body, ok=False)
        self.assertEqual(result['error']['reason'], 'taskOperationFailed')
        self.assertEqual(pathlib.Path(result['inputPath']).read_text(), body)
        failure = next(step for step in result['steps'] if step['argv'][2] == 'start-setup')
        self.assertNotEqual(failure['exitCode'], 0)
        self.assertTrue(failure['stderr'])
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', (result['task'],)), [])

    def test_packaged_mcp_task_uses_same_operation_and_attached_parent_for_complete_input(self):
        script = self.prefix / 'libexec/baton2/mcp-conductor.mjs'
        body = 'MCP task λ🙂\nComplete multiline input owned by the attached Conductor.\n' * 2000
        for source in ('text', 'file'):
            with self.subTest(source=source):
                self.mcp_task(script, body, source)

    def mcp_task(self, script, body, source):
        session = 'mcp-child-' + source
        self.route(session)
        task_file = self.directory / 'MCP plain task.txt'
        task_file.write_bytes(body.encode())
        arguments = {source: body if source == 'text' else str(task_file), 'project': str(self.repo),
                     'session': session, 'harness': 'codex', 'model': 'gpt-6-astra',
                     'effort': 'low', 'command': str(self.fixture)}
        requests = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                    {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
                    {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {
                        'name': 'baton2_task', 'arguments': arguments}}]
        child = subprocess.run(['node', str(script), str(self.db), str(self.binary), '--session', 'root'],
                               input=''.join(json.dumps(row) + '\n' for row in requests),
                               env=self.environment, capture_output=True, text=True)
        self.assertEqual(child.returncode, 0, child.stderr)
        replies = [json.loads(line) for line in child.stdout.splitlines()]
        self.assertEqual([reply['id'] for reply in replies], [1, 2, 3])
        tools = {tool['name']: tool for tool in replies[1]['result']['tools']}
        self.assertIn('baton2_task', tools)
        result = json.loads(replies[2]['result']['content'][0]['text'])
        self.assert_retained_input(result, body)
        self.assertEqual(self.call('delivery', result['task'])['sender'], 'root')
        self.assertEqual(self.call('session', session)['parent'], 'root')
        self.assertTrue(any(step['argv'][2] == 'join' for step in result['steps']))
        stream, native = self.accept(session)
        self.assertIn(body, native['prompt'])
        self.finish(stream, 'The attached fixture parent confirms the complete MCP task.')
        self.exited(session)
        self.assertTrue(self.call('session', session)['taskCompletion']['confirmed'])


if __name__ == '__main__':
    unittest.main()
