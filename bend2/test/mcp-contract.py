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
        external_read = {
            **external, 'sourceReference': 'external:observation λ', 'sourceKind': 'external',
            'targetReference': 'file:source λ', 'targetKind': 'external',
        }
        message_read = {
            **message, 'sourceReference': 'message:turn-1', 'sourceKind': 'message',
            'targetReference': "message:prior report's λ", 'targetKind': 'message',
        }
        result = self.tool('baton2_knowledge_relations')
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), [external_read])
        result = self.tool('baton2_knowledge_relations', {'scope': 'worker', 'subject': 'w1'})
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), [message_read])
        result = self.tool('baton2_knowledge_relations', {'scope': 'all', 'pretty': True})
        self.assertFalse(result.get('isError', False))
        self.assertEqual(json.loads(result['content'][0]['text']), [external_read, message_read])
        self.assertEqual(json.loads(self.coord('knowledge', 'root').stdout), [])

        self.coord('record-typed', 'measured-recovery', 'w1', 'evidence',
                   'Measured original process recovery', 'message:turn-1', 'One retained process')
        self.coord('record-typed', 'recovery-decision', 'root', 'decision',
                   'Continue the original process recovery', 'finding:measured-recovery',
                   'The recorded provider fault')
        self.coord('relate', 'recovery-basis', 'root', 'finding:recovery-decision',
                   'DerivedFrom', 'finding:measured-recovery')
        for tool, arguments in (
                ('baton2_knowledge_search', {'query': 'original recovery'}),
                ('baton2_knowledge_traverse', {'reference': 'finding:recovery-decision',
                                               'direction': 'out'})):
            with self.subTest(tool=tool):
                result = self.tool(tool, arguments)
                self.assertFalse(result.get('isError', False), result)
                graph = json.loads(result['content'][0]['text'])
                self.assertEqual({row['id'] for row in graph['nodes']}, {'recovery-decision'})
                reference = next(row for row in graph['references']
                                 if row['reference'] == 'finding:measured-recovery')
                record = json.loads(self.coord(*reference['detailRead']).stdout)[0]
                self.assertEqual((record['id'], record['kind'], record['claim'], record['limits']),
                                 ('measured-recovery', 'evidence',
                                  'Measured original process recovery', 'One retained process'))
                complete = self.tool('baton2_knowledge', {'scope': 'all', 'id': record['id']})
                self.assertFalse(complete.get('isError', False), complete)
                self.assertEqual(json.loads(complete['content'][0]['text']), [record])
                self.assertEqual(record['evidenceMessage']['body'], self.body)
                delivery = self.tool('baton2_delivery', {'id': record['evidenceMessage']['id']})
                self.assertFalse(delivery.get('isError', False), delivery)
                self.assertEqual(json.loads(delivery['content'][0]['text'])['body'], self.body)
        holdings = self.tool('baton2_knowledge', {'scope': 'worker', 'subject': 'root'})
        self.assertFalse(holdings.get('isError', False), holdings)
        self.assertEqual([row['id'] for row in json.loads(holdings['content'][0]['text'])],
                         ['recovery-decision'])

    def test_group_promotions_and_onward_sharing_use_attached_destination_owner(self):
        self.coord('role', 'root', 'principal-conductor')
        self.coord('ensemble', 'review-group', 'root', 'tight')
        self.coord('ensemble', 'other-group', 'root', 'loose')
        self.coord('record', 'shared-finding', 'w1', 'Measured finding', 'run:measured', 'One run')
        shared = self.tool('baton2_knowledge_promote', {'id': 'group-share', 'source': 'w1',
            'destinationKind': 'group', 'destination': 'review-group', 'finding': 'shared-finding'})
        self.assertFalse(shared.get('isError', False))
        promotion = json.loads(shared['content'][0]['text'])
        self.assertEqual((promotion['sourceKind'], promotion['destinationKind']), ('session', 'group'))
        group = self.tool('baton2_knowledge', {'scope': 'group', 'subject': 'review-group'})
        self.assertEqual([row['id'] for row in json.loads(group['content'][0]['text'])], ['shared-finding'])
        other = self.tool('baton2_knowledge', {'scope': 'group', 'subject': 'other-group'})
        self.assertEqual(json.loads(other['content'][0]['text']), [])
        root = self.tool('baton2_knowledge', {'scope': 'universal'})
        self.assertEqual(json.loads(root['content'][0]['text']), [])
        onward = self.tool('baton2_knowledge_promote', {'id': 'root-share', 'sourceKind': 'group',
            'source': 'review-group', 'destination': 'root', 'finding': 'shared-finding'})
        self.assertFalse(onward.get('isError', False))
        self.assertEqual(json.loads(onward['content'][0]['text'])['sourceKind'], 'group')
        root = self.tool('baton2_knowledge', {'scope': 'universal'})
        self.assertEqual([row['id'] for row in json.loads(root['content'][0]['text'])], ['shared-finding'])

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
