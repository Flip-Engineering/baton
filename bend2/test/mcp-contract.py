"""Consumer behavior checks for the Channels MCP Conductor adapter.

Each check drives the real adapter over stdio and the real coordinator
binary against one temporary fixture database, and compares a tool result
with the same native CLI operation on that database.

Checked: the initialize handshake declares protocol 2024-11-05 and the
returned tool descriptions stay inside that wire contract; baton2_player
and baton2_inbox return the same rows and fields the native CLI prints;
a retained multi-line report body arrives complete through the inbox text
content; a refused acknowledgement returns isError with the exit code and
both captured CLI streams; the unadvertised baton2_workers replay alias
returns the native legacy workers rows, the same rows and legacy field
shape the CLI workers command prints.

Deliberately not checked: equality between the advertised tool set and
the native command catalogue, and any comparison against the adapter's
implementation text. The CLI and MCP surfaces are intentionally different
in coverage; the capability audit of the pinned revision records those
decisions, and this module pins behavior so the declared surface stays
free to change. mcp-command.py pins exact argument translation with a
fixture coordinator; mcp-root.py pins channel notification and replay
behavior.
"""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-conductor.mjs'


class McpContract(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        repo = pathlib.Path(self.temp.name) / 'repository'
        repo.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'MCP contract fixture']):
            subprocess.run(['git', '-C', str(repo), *argv], check=True, capture_output=True)
        (repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        base = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'],
                              check=True, capture_output=True, text=True).stdout.strip()
        self.coord('attach', 'root', 'claude-code', 'native-root', '')
        self.coord('recruit', 'w1', 'root', 'omp', 'model', 'low',
                   str(repo), 'w1-branch', str(pathlib.Path(self.temp.name) / 'worktrees' / 'w1'), base)
        self.body = 'surface-开始 λ\n' + 'coordinator output λ\n' * 4000 + 'surface-完成 λ'
        self.coord('report', 'turn-1', 'w1', self.body)

    def coord(self, *args, ok=True):
        p = subprocess.run([str(EXE), str(self.db), *args],
                           text=True, capture_output=True)
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p

    def mcp(self, *requests):
        """Run one adapter session over stdio and return its replies."""
        result = subprocess.run(
            ['node', str(MCP_SCRIPT), str(self.db), str(EXE), '--session', 'root'],
            input=''.join(json.dumps(row) + '\n' for row in requests),
            text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def tool(self, name, arguments=None):
        """Call one tool over stdio and return its wire result."""
        replies = self.mcp(
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
             'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                        'clientInfo': {'name': 'mcp-contract', 'version': '0'}}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
             'params': {'name': name, 'arguments': arguments or {}}},
        )
        self.assertEqual([row['id'] for row in replies], [1, 2])
        self.assertNotIn('error', replies[1], replies[1])
        return replies[1]['result']

    def test_initialize_declares_2024_11_05_and_wire_contract_tools(self):
        replies = self.mcp(
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
             'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                        'clientInfo': {'name': 'mcp-contract', 'version': '0'}}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
        )
        self.assertEqual(replies[0]['result']['protocolVersion'], '2024-11-05')
        tools = replies[1]['result']['tools']
        self.assertTrue(tools)
        for tool in tools:
            with self.subTest(tool=tool['name']):
                self.assertEqual(tool['inputSchema']['type'], 'object')
                self.assertNotIn('outputSchema', tool)

    def test_player_read_returns_the_native_rows(self):
        native = self.coord('player', 'w1').stdout
        result = self.tool('baton2_player', {'player': 'w1'})
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), json.loads(native))

    def test_relationship_discovery_returns_message_and_external_links(self):
        external = json.loads(self.coord('relate', 'external-link', 'root',
            'external:observation λ', 'DerivedFrom', 'file:source λ').stdout)
        message = json.loads(self.coord('relate', 'message-link', 'w1',
            'message:turn-1', 'Supersedes', "message:prior report's λ").stdout)
        result = self.tool('baton2_knowledge_relations')
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), [external])
        result = self.tool('baton2_knowledge_relations', {'scope': 'worker', 'subject': 'w1'})
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), [message])
        result = self.tool('baton2_knowledge_relations', {'scope': 'all', 'pretty': True})
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), [external, message])
        self.assertEqual(json.loads(self.coord('knowledge', 'root').stdout), [])

    def test_inbox_delivers_retained_bodies_complete(self):
        native = json.loads(self.coord('inbox', 'root').stdout)
        result = self.tool('baton2_inbox')
        self.assertFalse(result.get('isError', False))
        rows = json.loads(result['content'][0]['text'])
        self.assertEqual(rows, native)
        delivered = next(row for row in rows if row['id'] == 'turn-1')
        self.assertEqual(delivered['body'], self.body)

    def test_index_and_delivery_keep_complete_input_available_until_ack(self):
        for tool, command, arguments in (
                ('baton2_inbox', ('inbox', 'root', '--index'), {'index': True}),
                ('baton2_pending', ('pending', '--index'), {'index': True})):
            with self.subTest(tool=tool):
                native = json.loads(self.coord(*command).stdout)
                result = self.tool(tool, arguments)
                self.assertFalse(result.get('isError', False))
                rows = json.loads(result['content'][0]['text'])
                self.assertEqual(rows, native)
                retained = next(row for row in rows if row['id'] == 'turn-1')
                self.assertNotIn('body', retained)
                self.assertEqual((retained['sender'], retained['recipient'], retained['kind']),
                                 ('w1', 'root', 'report'))
                self.assertIsNone(retained['receipt'])
        result = self.tool('baton2_delivery', {'id': 'turn-1'})
        self.assertFalse(result.get('isError', False))
        delivery = json.loads(result['content'][0]['text'])
        self.assertEqual(delivery, json.loads(self.coord('delivery', 'turn-1').stdout))
        self.assertEqual(delivery['body'], self.body)
        self.assertIsNone(delivery['receipt'])
        self.tool('baton2_ack', {'id': 'turn-1', 'receipt': ''})
        index = self.tool('baton2_inbox', {'index': True})
        self.assertEqual(json.loads(index['content'][0]['text']), [])
        delivered = self.tool('baton2_delivery', {'id': 'turn-1'})
        row = json.loads(delivered['content'][0]['text'])
        self.assertEqual(row['body'], self.body)
        self.assertEqual(row['receipt'], '')

    def test_ack_refusal_returns_the_native_cli_output(self):
        cli = self.coord('ack', 'missing-ack', 'root', 'receipt', ok=False)
        self.assertNotEqual(cli.returncode, 0)
        result = self.tool('baton2_ack', {'id': 'missing-ack', 'receipt': 'receipt'})
        self.assertTrue(result['isError'])
        text = result['content'][0]['text']
        self.assertIn(f'exit code: {cli.returncode}', text)
        prefix, stdout_separator, body = text.partition('\nstdout:\n')
        self.assertTrue(stdout_separator, 'the refusal omitted captured stdout')
        stdout, stderr_separator, stderr = body.partition('\nstderr:\n')
        self.assertTrue(stderr_separator, 'the refusal omitted captured stderr')
        self.assertIn('Error: Command failed:', prefix)
        self.assertEqual(stdout, cli.stdout)
        self.assertEqual(stderr, cli.stderr)

    def test_workers_replay_alias_returns_the_native_legacy_rows(self):
        # baton2_workers replays the stored-call alias onto the native legacy
        # subordinate reader: same rows and legacy field shape as the CLI.
        native = json.loads(self.coord('workers').stdout)
        result = self.tool('baton2_workers')
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), native)


if __name__ == '__main__':
    unittest.main()
