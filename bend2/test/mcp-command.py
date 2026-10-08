"""Coordinator child-process completion and diagnostics through the MCP adapter."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-conductor.mjs'

CHILD = '''import json
import os
from pathlib import Path
import sys
import time

values = json.loads(Path(__file__).with_suffix('.json').read_text())
time.sleep(values['delay'])
sys.stdout.write(values['stdout'])
sys.stdout.flush()
sys.stderr.write(values['stderr'])
sys.stderr.flush()
Path(values['completed']).write_text(json.dumps({
    'exit_code': values['code'], 'argv': sys.argv[1:], 'pid': os.getpid(),
}))
sys.exit(values['code'])
'''


class McpCommand(unittest.TestCase):
    def command(self, stdout='', stderr='', code=0, delay=0, *,
                tool='baton2_status', arguments=None, session=None, expected_args=None):
        with tempfile.TemporaryDirectory() as home:
            home = pathlib.Path(home)
            executable = home / 'fixture-coordinator'
            completed = home / 'completed.json'
            executable.write_text('#!' + sys.executable + '\n' + CHILD)
            executable.chmod(0o755)
            executable.with_suffix('.json').write_text(json.dumps({
                'stdout': stdout, 'stderr': stderr, 'code': code,
                'delay': delay, 'completed': str(completed),
            }))
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
                {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                 'params': {'name': tool, 'arguments': arguments or {}}},
            ]
            result = subprocess.run(
                ['node', str(MCP_SCRIPT), str(home / 'state.db'), str(executable)]
                + ([] if session is None else ['--session', session]),
                input=''.join(json.dumps(row) + '\n' for row in requests),
                text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([row['id'] for row in replies], [1, 2, 3])
            self.assertEqual(replies[0]['result']['serverInfo']['name'], 'baton-conductor')
            self.tools = {row['name']: row for row in replies[1]['result']['tools']}
            self.assertIn(tool, self.tools)
            self.assertTrue(completed.exists(), 'the coordinator child did not finish its operation')
            child = json.loads(completed.read_text())
            self.assertEqual(child['exit_code'], code)
            self.assertGreater(child['pid'], 0)
            self.assertEqual(child['argv'], [str(home / 'state.db')] + (expected_args or ['status']))
            return replies[2]['result']

    def native_controls(self):
        player = "Player's review λ"
        command = "/native tools/provider's executable"
        log = "/run output/Player's λ.jsonl"
        task = "/task files/review's λ.md"
        recruitment = {
            'player': player, 'harness': 'omp', 'model': 'deepseek/deepseek-flash',
            'effort': 'low', 'repo': "/repository's λ", 'branch': 'review-λ',
            'workspace': "/worktree's review λ", 'base': 'main',
        }
        return {
            'baton2_recruit': (recruitment, ['recruit', player, 'root', 'omp',
                'deepseek/deepseek-flash', 'low', recruitment['repo'], 'review-λ',
                recruitment['workspace'], 'main']),
            'baton2_receiver': ({'player': player, 'command': command, 'log': log},
                ['receiver', player, command, log]),
            'baton2_dispatch_file': ({'id': 'task-λ', 'recipient': player,
                'kind': 'task', 'path': task},
                ['dispatch-file', 'task-λ', 'root', player, 'task', task]),
            'baton2_dispatch_turn': ({'player': player, 'id': 'turn-λ',
                'command': command, 'log': log, 'task': task},
                ['dispatch-turn', player, 'turn-λ', command, log, task]),
        }

    def test_native_control_tools_advertise_typed_arguments(self):
        self.command()
        contracts = {
            'baton2_recruit': ({'player', 'harness', 'model', 'effort', 'repo',
                'branch', 'workspace', 'base'}, {'parent'}),
            'baton2_receiver': ({'player', 'command', 'log'}, {'cwd'}),
            'baton2_dispatch_file': ({'id', 'recipient', 'kind', 'path'}, {'sender'}),
            'baton2_dispatch_turn': ({'player', 'id', 'command', 'log', 'task'}, set()),
        }
        for name, (required, optional) in contracts.items():
            with self.subTest(tool=name):
                schema = self.tools[name]['inputSchema']
                self.assertEqual(schema['type'], 'object')
                self.assertFalse(schema['additionalProperties'])
                self.assertEqual(set(schema['required']), required)
                self.assertEqual(set(schema['properties']), required | optional)
                for field in schema['properties'].values():
                    self.assertEqual(field['type'], 'string')

    def test_recruit_defaults_parent_to_selected_conductor(self):
        arguments, argv = self.native_controls()['baton2_recruit']
        for session in (None, "Associate's λ", ''):
            with self.subTest(session=session):
                expected = list(argv)
                expected[2] = 'root' if session is None else session
                self.command(tool='baton2_recruit', arguments=arguments,
                             session=session, expected_args=expected)

    def test_recruit_preserves_explicit_parent(self):
        arguments, argv = self.native_controls()['baton2_recruit']
        for parent in ("Principal's λ", ''):
            with self.subTest(parent=parent):
                expected = list(argv)
                expected[2] = parent
                self.command(tool='baton2_recruit', arguments={**arguments, 'parent': parent},
                             session='associate', expected_args=expected)

    def test_receiver_forwards_explicit_player_and_native_paths(self):
        arguments, argv = self.native_controls()['baton2_receiver']
        self.command(tool='baton2_receiver', arguments=arguments,
                     session='associate', expected_args=argv)

    def test_dispatch_file_defaults_sender_to_selected_conductor(self):
        arguments, argv = self.native_controls()['baton2_dispatch_file']
        for session in (None, "Associate's λ", ''):
            with self.subTest(session=session):
                expected = list(argv)
                expected[2] = 'root' if session is None else session
                self.command(tool='baton2_dispatch_file', arguments=arguments,
                             session=session, expected_args=expected)

    def test_dispatch_file_preserves_explicit_sender_and_kind(self):
        arguments, argv = self.native_controls()['baton2_dispatch_file']
        for sender in ("Principal's λ", ''):
            with self.subTest(sender=sender):
                expected = list(argv)
                expected[2] = sender
                expected[4] = 'guidance'
                self.command(tool='baton2_dispatch_file',
                             arguments={**arguments, 'sender': sender, 'kind': 'guidance'},
                             session='associate', expected_args=expected)

    def test_dispatch_turn_forwards_task_and_log_paths(self):
        arguments, argv = self.native_controls()['baton2_dispatch_turn']
        self.command(tool='baton2_dispatch_turn', arguments=arguments,
                     session='associate', expected_args=argv)

    def test_worker_argument_alias_replays_stored_calls(self):
        # Stored tool calls may carry the pre-rename 'worker' argument name;
        # the adapter forwards it to the native player position.
        self.command(tool='baton2_player', arguments={'worker': 'player-id'},
                     expected_args=['player', 'player-id'])

    def test_native_control_success_preserves_complete_output(self):
        stdout = '{"status":"dispatched"}\n' + 'coordinator output λ\n' * 100000 + 'complete\n'
        for tool, (arguments, argv) in self.native_controls().items():
            with self.subTest(tool=tool):
                result = self.command(stdout=stdout, tool=tool, arguments=arguments,
                                      expected_args=argv)
                self.assertNotIn('isError', result)
                self.assertEqual(result['content'], [{'type': 'text', 'text': stdout.strip()}])

    def test_native_control_refusals_preserve_exit_and_both_streams(self):
        stdout = '{"error":"coordinator-refused"}\n' + 'refusal context λ\n' * 10000
        stderr = 'native control diagnostic λ\n' * 10000
        for tool, (arguments, argv) in self.native_controls().items():
            with self.subTest(tool=tool):
                self.failure(stdout, stderr, code=2, tool=tool, arguments=arguments,
                             expected_args=argv)

    def test_command_completes_after_the_former_deadline(self):
        result = self.command(stdout='completed after waiting\n', delay=10.25)
        self.assertNotIn('isError', result)
        self.assertEqual(result['content'], [{'type': 'text', 'text': 'completed after waiting'}])

    def test_success_preserves_large_unicode_output(self):
        stdout = '开始\n' + 'coordinator output λ\n' * 100000 + '完成\n'
        result = self.command(stdout=stdout)
        self.assertNotIn('isError', result)
        self.assertEqual(result['content'], [{'type': 'text', 'text': stdout.strip()}])

    def failure(self, stdout, stderr, code=7, **operation):
        result = self.command(stdout=stdout, stderr=stderr, code=code, **operation)
        self.assertTrue(result['isError'])
        text = result['content'][0]['text']
        prefix, separator, body = text.partition('\nstdout:\n')
        self.assertTrue(separator, 'MCP failure omitted captured stdout')
        self.assertIn(f'\nexit code: {code}', prefix)
        actual_stdout, separator, actual_stderr = body.partition('\nstderr:\n')
        self.assertTrue(separator, 'MCP failure omitted captured stderr')
        self.assertEqual(actual_stdout, stdout)
        self.assertEqual(actual_stderr, stderr)

    def test_failure_preserves_both_streams(self):
        self.failure('stdout first\n' + 'λ output\n' * 10000 + 'stdout last\n',
                     'stderr first\n' + 'λ diagnostic\n' * 10000 + 'stderr last\n')

    def test_failure_preserves_large_unicode_streams(self):
        self.failure('stdout first\n' + 'λ output\n' * 150000 + 'stdout last\n',
                     'stderr first\n' + 'λ diagnostic\n' * 100000 + 'stderr last\n')

    def test_failure_preserves_stdout_with_empty_stderr(self):
        self.failure('stdout-only failure\n', '')


if __name__ == '__main__':
    unittest.main()
