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
from pathlib import Path
import sys
import time

values = json.loads(Path(__file__).with_suffix('.json').read_text())
if sys.argv[2] == 'status':
    time.sleep(values['delay'])
    sys.stdout.write(values['stdout'])
    sys.stdout.flush()
    sys.stderr.write(values['stderr'])
    sys.stderr.flush()
    Path(values['completed']).write_text(json.dumps({'exit_code': values['code']}))
    sys.exit(values['code'])
'''


class McpCommand(unittest.TestCase):
    def command(self, stdout='', stderr='', code=0, delay=0):
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
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                 'params': {'name': 'baton2_status', 'arguments': {}}},
            ]
            result = subprocess.run(
                ['node', str(MCP_SCRIPT), str(home / 'state.db'), str(executable)],
                input=''.join(json.dumps(row) + '\n' for row in requests),
                text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([row['id'] for row in replies], [1, 2])
            self.assertEqual(replies[0]['result']['serverInfo']['name'], 'baton-conductor')
            self.assertTrue(completed.exists(), 'the coordinator child did not finish its operation')
            self.assertEqual(json.loads(completed.read_text()), {'exit_code': code})
            return replies[1]['result']

    def test_command_completes_after_the_former_deadline(self):
        result = self.command(stdout='completed after waiting\n', delay=10.25)
        self.assertNotIn('isError', result)
        self.assertEqual(result['content'], [{'type': 'text', 'text': 'completed after waiting'}])

    def test_success_preserves_large_unicode_output(self):
        stdout = '开始\n' + 'coordinator output λ\n' * 100000 + '完成\n'
        result = self.command(stdout=stdout)
        self.assertNotIn('isError', result)
        self.assertEqual(result['content'], [{'type': 'text', 'text': stdout.strip()}])

    def failure(self, stdout, stderr):
        result = self.command(stdout=stdout, stderr=stderr, code=7)
        self.assertTrue(result['isError'])
        text = result['content'][0]['text']
        prefix, separator, body = text.partition('\nstdout:\n')
        self.assertTrue(separator, 'MCP failure omitted captured stdout')
        self.assertIn('\nexit code: 7', prefix)
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
