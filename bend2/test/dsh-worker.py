"""Worker MCP forwarding and linked-worktree commits with retained child output.

The coordinator fixture supplies the native-context endpoint. Native custody and
the installed DSH tool pipeline require their own integration qualification.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'bend2/scripts/dsh-worker.mjs'
NODE = os.environ.get('NODE', 'node')
RETAINED = pathlib.Path(os.environ.get('BATON_WORKER_EVIDENCE', ROOT / '.scratch/dsh-worker-fixtures'))

COORDINATOR = '''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(__file__).parent
state = json.loads((root / 'control.json').read_text())
body = sys.stdin.read()
with (root / 'calls.jsonl').open('a') as out:
    out.write(json.dumps({'argv': sys.argv[1:], 'stdin': body,
        'session': os.environ.get('BATON_SESSION'), 'pid': os.getpid()}) + '\\n')
if sys.argv[2:] == ['agent-worker-context']:
    print(json.dumps(state['context']))
    sys.stderr.write(state.get('context_stderr', ''))
    sys.exit(state.get('context_code', 0))
print(state.get('stdout', 'semantic-result'))
sys.stderr.write(state.get('stderr', ''))
sys.exit(state.get('code', 0))
'''


class DshWorker(unittest.TestCase):
    def setUp(self):
        RETAINED.mkdir(parents=True, exist_ok=True)
        self.root = pathlib.Path(tempfile.mkdtemp(prefix=self._testMethodName + '-', dir=RETAINED))
        self.env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
        self.env.update(HOME=str(self.root), GIT_AUTHOR_NAME='fixture', GIT_AUTHOR_EMAIL='fixture@example.test',
                        GIT_COMMITTER_NAME='fixture', GIT_COMMITTER_EMAIL='fixture@example.test')
        self.process_number = 0
        self.common = self.root / 'common'
        self.workspace = self.root / 'workspace'
        self.git_at(self.root, 'init', self.common)
        (self.common / 'chosen').write_text('initial\n')
        (self.common / 'other').write_text('initial\n')
        (self.common / 'deleted').write_text('initial\n')
        self.git_at(self.common, 'add', '.')
        self.git_at(self.common, 'commit', '-m', 'fixture initial')
        self.git_at(self.common, 'worktree', 'add', '-b', 'worker-branch', self.workspace)
        self.database = self.root / 'state.db'
        self.database.touch()
        self.attempt = self.root / 'attempt'
        self.attempt.mkdir()
        self.coordinator = self.root / 'coordinator'
        self.coordinator.write_text(COORDINATOR)
        self.coordinator.chmod(0o700)
        self.state = {'context': {'session': 'worker', 'directory': str(self.attempt), 'attempt': 'turn',
            'native': 'retained-native', 'harness': 'dsh', 'workspace': str(self.workspace),
            'branch': 'worker-branch', 'model': 'exact-deepseek-model'}}
        self.save_state()
        identity = self.root / 'identity'
        identity.mkdir()
        (identity / 'identity-series.json').write_text(json.dumps({
            'seriesKey': 'deepseek', 'displaySeries': 'DeepSeek', 'github': {
                'appId': 1, 'botId': 2, 'clientId': 'fixture', 'slug': 'fixture-deepseek',
                'botLogin': 'fixture-deepseek[bot]',
                'commitEmail': '2+fixture-deepseek[bot]@users.noreply.github.com',
                'permissions': {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}}}))
        registry = self.root / 'registry.json'
        registry.write_text(json.dumps({'models': {'exact-deepseek-model': 'deepseek'},
                                       'series': {'deepseek': str(identity)}}))
        self.env.update(BATON_DATABASE=str(self.database), BATON_SESSION='worker',
                        BATON_ATTEMPT_DIRECTORY=str(self.attempt), BATON_COORDINATOR=str(self.coordinator),
                        BATON2_GIT_REGISTRY=str(registry), GIT_CONFIG_COUNT='1',
                        GIT_CONFIG_KEY_0='core.quotePath', GIT_CONFIG_VALUE_0='false')

    def save_state(self):
        (self.root / 'control.json').write_text(json.dumps(self.state))

    def child(self, argv, cwd, text=''):
        self.process_number += 1
        process = subprocess.Popen(list(map(str, argv)), cwd=cwd, env=self.env, text=True,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = process.communicate(text)
        result = {'argv': list(map(str, argv)), 'cwd': str(cwd), 'pid': process.pid,
                  'returncode': process.returncode, 'stdout': stdout, 'stderr': stderr}
        (self.root / f'process-{self.process_number}.json').write_text(json.dumps(result, indent=2))
        return result

    def git_at(self, cwd, *args):
        result = self.child(['git', *args], cwd)
        self.assertEqual(result['returncode'], 0, result)
        return result['stdout']

    def git(self, *args):
        return self.git_at(self.workspace, *args)

    def call(self, name, arguments):
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
             'params': {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'fixture', 'version': '1'}}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}]
        result = self.child([NODE, SCRIPT], self.workspace, ''.join(json.dumps(m) + '\n' for m in messages))
        self.assertEqual(result['returncode'], 0, result)
        replies = [json.loads(line) for line in result['stdout'].splitlines()]
        self.tools = {tool['name']: tool for tool in replies[1]['result']['tools']}
        return replies[2]['result']

    def calls(self):
        path = self.root / 'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_report_and_completion_forward_complete_text_with_recorded_actor(self):
        body = 'Evidence λ🙂\n"quoted"\n' * 10000
        for tool, action in [('report', 'report'), ('completion_request', 'completion-request')]:
            result = self.call(tool, {'text': body})
            self.assertFalse(result.get('isError'), result)
            check, operation = self.calls()[-2:]
            self.assertEqual(check['argv'], [str(self.database), 'agent-worker-context'])
            self.assertEqual(operation['argv'], [str(self.database), 'agent-contextual-input', 'worker'])
            self.assertEqual(json.loads(operation['stdin']), [action, '--text', body])
            self.assertEqual(operation['session'], 'worker')
        self.assertFalse(any('action' in tool['inputSchema']['properties'] for tool in self.tools.values()))

    def test_report_child_failure_retains_stderr_stdout_and_status(self):
        self.state.update(code=43, stdout='full output λ\n' * 10000, stderr='write failed\n')
        self.save_state()
        result = self.call('report', {'text': 'diagnosis'})
        self.assertTrue(result['isError'])
        failed = json.loads(result['content'][0]['text'])
        self.assertEqual((failed['status'], failed['stdout'], failed['stderr']),
                         (43, self.state['stdout'] + '\n', self.state['stderr']))

    def test_completion_confirmation_and_guide_use_recorded_context(self):
        cases = [
            ('completion_confirmed', {'to': 'worker'}, ['completion-confirmed', '--to', 'worker']),
            ('completion_confirmed', {'to': 'worker', 'next': 'Continue with evidence λ🙂\n' * 10000},
             ['completion-confirmed', '--to', 'worker', '--next', 'Continue with evidence λ🙂\n' * 10000]),
            ('guide', {'to': 'worker', 'text': 'Review complete λ🙂\n' * 10000},
             ['guide', '--to', 'worker', '--text', 'Review complete λ🙂\n' * 10000]),
        ]
        for tool, arguments, action in cases:
            result = self.call(tool, arguments)
            self.assertFalse(result.get('isError'), result)
            check, operation = self.calls()[-2:]
            self.assertEqual(check['argv'], [str(self.database), 'agent-worker-context'])
            self.assertEqual(operation['argv'], [str(self.database), 'agent-contextual-input', 'worker'])
            self.assertEqual(json.loads(operation['stdin']), action)
            self.assertEqual(operation['session'], 'worker')
            self.assertIn(tool, self.tools)

    def test_completion_confirmation_and_guide_validate_complete_text(self):
        for tool, arguments in [
                ('completion_confirmed', {'next': 'valid', 'to': 'worker\0'}),
                ('completion_confirmed', {'next': 'bad\ud800'}),
                ('guide', {'to': 'worker', 'text': 'bad\ud800'}),
                ('guide', {'to': 'worker', 'text': 'bad\0text'}),
                ('guide', {'to': 'worker', 'text': 'valid', 'session': 'other'})]:
            result = self.call(tool, arguments)
            self.assertTrue(result['isError'], result)
        self.assertEqual(self.calls(), [])

    def test_completion_confirmation_and_guide_preserve_child_failure(self):
        self.state.update(code=43, stdout='full output λ\n' * 10000, stderr='write failed\n')
        self.save_state()
        for tool, arguments in [('completion_confirmed', {}), ('guide', {'to': 'worker', 'text': 'evidence'})]:
            result = self.call(tool, arguments)
            self.assertTrue(result['isError'], result)
            try:
                failed = json.loads(result['content'][0]['text'])
            except json.JSONDecodeError:
                self.fail(f'{tool} did not preserve the native child failure: {result}')
            self.assertEqual((failed['status'], failed['stdout'], failed['stderr']),
                             (43, self.state['stdout'] + '\n', self.state['stderr']))

    def test_inbox_and_read_forward_complete_output_with_recorded_context(self):
        body = 'Complete owed input λ🙂\n"quoted"\n' * 10000
        messages = [{'id': 'message:parent:one', 'recipient': 'worker', 'body': body, 'receipt': None},
                    {'id': 'message:parent:two', 'recipient': 'worker', 'body': 'second', 'receipt': None}]
        ids = [message['id'] for message in messages]
        for tool, arguments, action, output in [
                ('inbox', {}, ['inbox'], messages),
                ('read', {'ids': ids}, ['read', *ids],
                 [{'status': 'found', 'delivery': message} for message in messages])]:
            self.state['stdout'] = json.dumps(output, ensure_ascii=False)
            self.save_state()
            result = self.call(tool, arguments)
            self.assertFalse(result.get('isError'), result)
            child = json.loads(result['content'][0]['text'])
            self.assertEqual(child['stdout'], self.state['stdout'] + '\n')
            self.assertEqual(json.loads(child['stdout']), output)
            check, operation = self.calls()[-2:]
            self.assertEqual(check['argv'], [str(self.database), 'agent-worker-context'])
            self.assertEqual(operation['argv'], [str(self.database), 'agent-contextual-input', 'worker'])
            self.assertEqual(json.loads(operation['stdin']), action)
            self.assertEqual(operation['session'], 'worker')

    def test_read_custody_failure_preserves_printed_body_and_readonly_cause(self):
        self.state.update(code=8, stdout=json.dumps([{'status': 'found', 'delivery': {
            'id': 'owed', 'recipient': 'worker', 'body': 'Already printed λ🙂\n' * 10000}}]),
            stderr='attempt to write a readonly database\n')
        self.save_state()
        for tool, arguments in [('inbox', {}), ('read', {'ids': ['owed']})]:
            result = self.call(tool, arguments)
            self.assertIn(tool, self.tools)
            self.assertTrue(result['isError'], result)
            child = json.loads(result['content'][0]['text'])
            self.assertEqual((child['status'], child['stdout'], child['stderr']),
                             (8, self.state['stdout'] + '\n', self.state['stderr']))

    def test_input_tools_accept_only_semantic_message_selection(self):
        for tool, arguments in [('inbox', {'session': 'other'}), ('inbox', {'database': '/other'}),
                                ('read', {'ids': ['owed'], 'session': 'other'}),
                                ('read', {'ids': ['owed'], 'action': 'acknowledge'}),
                                ('read', {'ids': ['--help']}), ('read', {'ids': []}),
                                ('read', {'ids': 'owed'}), ('read', {'ids': ['bad\0id']})]:
            result = self.call(tool, arguments)
            self.assertTrue(result['isError'], result)
        self.assertEqual(self.calls(), [])

    def test_ended_native_context_stops_the_operation(self):
        self.state.update(context_code=2, context_stderr='current native execution has ended')
        self.save_state()
        for tool, arguments in [('report', {'text': 'late'}), ('inbox', {}), ('read', {'ids': ['owed']})]:
            result = self.call(tool, arguments)
            self.assertTrue(result['isError'])
        self.assertTrue(all(call['argv'][1:] == ['agent-worker-context'] for call in self.calls()))

    def test_semantic_refusal_keeps_the_completed_process_result(self):
        self.state['stdout'] = json.dumps([{'status': 'refused', 'admission': {
            'status': 'refused', 'cause': 'recorded route refused the report'}}])
        self.save_state()
        result = self.call('report', {'text': 'evidence'})
        self.assertTrue(result['isError'])
        child = json.loads(result['content'][0]['text'])
        self.assertEqual(child['status'], 0)
        self.assertEqual(child['stdout'], self.state['stdout'] + '\n')

    def test_linked_worktree_commit_preserves_unrelated_staging_and_model_identity(self):
        (self.workspace / 'other').write_text('unrelated staged\n')
        self.git('add', 'other')
        staged = self.git('rev-parse', ':other')
        (self.workspace / 'chosen').write_text('worker edit\n')
        (self.workspace / 'new').write_text('worker new\n')
        (self.workspace / ':(glob)*').write_text('literal path\n')
        (self.workspace / 'deleted').unlink()
        result = self.call('commit', {'paths': ['chosen', 'new', 'deleted', ':(glob)*'], 'message': 'worker evidence λ'})
        self.assertFalse(result.get('isError'), result)
        self.assertEqual(set(self.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').splitlines()),
                         {'chosen', 'new', 'deleted', ':(glob)*'})
        self.assertEqual(self.git('diff', '--cached', '--name-only').strip(), 'other')
        self.assertEqual(self.git('rev-parse', ':other'), staged)
        self.assertEqual(self.git('show', 'HEAD:other'), 'initial\n')
        attribution = self.git('show', '-s', '--format=%an%n%ae%n%cn%n%ce').splitlines()
        self.assertEqual(attribution, ['Flip Baton - DeepSeek',
            '2+fixture-deepseek[bot]@users.noreply.github.com'] * 2)
        self.assertNotEqual(self.git('rev-parse', '--git-common-dir').strip(), '.git')

    def test_commit_failure_preserves_failed_git_output_and_staged_files(self):
        hooks = self.common / '.git/hooks'
        hook = hooks / 'pre-commit'
        hook.write_text('#!/bin/sh\necho retained-hook-failure >&2\nexit 1\n')
        hook.chmod(0o700)
        (self.workspace / 'new').write_text('unfinished\n')
        result = self.call('commit', {'paths': ['new'], 'message': 'unfinished'})
        self.assertTrue(result['isError'])
        failed = json.loads(result['content'][0]['text'])
        self.assertEqual(failed['status'], 1)
        self.assertIn('retained-hook-failure', failed['stderr'])
        self.assertEqual(self.git('diff', '--cached', '--name-only').strip(), 'new')

    def test_scope_comes_from_launch_context_and_selected_files(self):
        (self.workspace / 'outside').symlink_to(self.root, target_is_directory=True)
        for paths in [['../state.db'], ['outside/state.db'], ['.'], ['.git/config']]:
            result = self.call('commit', {'paths': paths, 'message': 'invalid selection'})
            self.assertTrue(result['isError'], result)
        result = self.call('report', {'text': 'wrong actor', 'session': 'other'})
        self.assertTrue(result['isError'])
        self.state['context']['branch'] = 'different-branch'
        self.save_state()
        result = self.call('commit', {'paths': ['chosen'], 'message': 'wrong branch'})
        self.assertTrue(result['isError'])
        self.assertEqual(self.git('diff', '--cached', '--name-only'), '')


if __name__ == '__main__':
    unittest.main()
