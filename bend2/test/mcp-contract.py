"""Declared CLI/MCP contract overlap for the Channels MCP Conductor adapter.

The adapter's tools/list response, its tools/call dispatch and the native
coordinator usage text are three declared views of one control surface. This
check compares them. Every surface difference is stated in a declaration
below, so a new tool, a removed native command or a new dispatch case is a
reviewed contract change rather than silent drift.
"""
import json
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-conductor.mjs'

# The intended MCP surface: each advertised tool and the native command its
# dispatch invokes. Adding, removing or re-pointing a tool updates this table
# together with the capability audit row in
# docs/bend2/v1-capability-audit-2026-10-04.md.
CONTRACT = {
    'baton2_player': 'player',
    'baton2_recruit': 'recruit',
    'baton2_receiver': 'receiver',
    'baton2_dispatch_file': 'dispatch-file',
    'baton2_dispatch_turn': 'dispatch-turn',
    'baton2_role': 'role',
    'baton2_ensemble': 'ensemble',
    'baton2_ensemble_member': 'ensemble-member',
    'baton2_section': 'section',
    'baton2_section_member': 'section-member',
    'baton2_orchestra': 'orchestra',
    'baton2_status': 'status',
    'baton2_inbox': 'inbox',
    'baton2_ack': 'ack',
    # baton2_guide invokes message with the fixed kind 'guidance'; the other
    # message kinds stay CLI-only.
    'baton2_guide': 'message',
    'baton2_player_status': 'worktree',
    'baton2_land': 'land',
    'baton2_land_checked': 'land-checked',
    'baton2_players': 'players',
    'baton2_turns': 'turns',
    'baton2_pending': 'pending',
    'baton2_push': 'push',
}

# Dispatched names that tools/list withholds. Replay of stored conversations
# still sends them; mcp-root.py pins that behavior.
LEGACY_DISPATCH = {
    'baton2_workers': 'workers',
    'baton2_worker_status': 'worktree',
}

# Native commands with no MCP tool. The capability audit records knowledge,
# stop and ask this way; the remaining commands are declared here so that a
# new command or a new tool is an explicit surface decision.
CLI_ONLY = frozenset([
    'ask', 'ask-file', 'attach', 'bind', 'connect', 'delivery', 'force-stop',
    'knowledge', 'message-file', 'native-reply', 'native-reply-file',
    'observe-file', 'promote', 'receive', 'record', 'report', 'session',
    'start', 'stop', 'turn',
])


class McpContract(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')

    def usage_verbs(self):
        """Return the command names declared by the native usage text."""
        result = subprocess.run([str(EXE)], text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(result.stdout, '')
        verbs = set()
        for line in result.stderr.splitlines():
            token = line.split()[0] if line.split() else ''
            if re.fullmatch(r'[a-z][a-z0-9-]*', token):
                verbs.add(token)
        return verbs

    def dispatch_map(self):
        """Map every tools/call case in the adapter source to its native command."""
        source = MCP_SCRIPT.read_text()
        body = source[source.index('switch (name)'):]
        body = body[:body.index('sendResponse(msg.id, {')]
        mapping = {}
        pending = []
        for match in re.finditer(r"case '([a-z0-9_]+)':|coord\('([a-z-]+)'", body):
            name, verb = match.groups()
            if name:
                pending.append(name)
            elif pending:
                for fallthrough in pending:
                    mapping[fallthrough] = verb
                pending = []
        return mapping

    def mcp_surface(self):
        """Initialize the adapter over stdio and return its advertised tools."""
        with tempfile.TemporaryDirectory() as home:
            # Without notifications/initialized the adapter performs no attach
            # and never invokes the coordinator; the absent database keeps this
            # check free of state effects.
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                 'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                            'clientInfo': {'name': 'mcp-contract', 'version': '0'}}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            ]
            result = subprocess.run(
                ['node', str(MCP_SCRIPT), str(pathlib.Path(home) / 'absent.db'), str(EXE)],
                input=''.join(json.dumps(row) + '\n' for row in requests),
                text=True, capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([row['id'] for row in replies], [1, 2])
            return replies[0]['result'], replies[1]['result']['tools']

    def test_initialize_declares_the_2024_11_05_wire_contract(self):
        initialized, _ = self.mcp_surface()
        self.assertEqual(initialized['protocolVersion'], '2024-11-05')
        self.assertEqual(initialized['serverInfo']['name'], 'baton-conductor')

    def test_advertised_tools_match_the_declared_contract(self):
        _, tools = self.mcp_surface()
        self.assertEqual({tool['name'] for tool in tools}, set(CONTRACT))
        dispatch = self.dispatch_map()
        for tool in tools:
            with self.subTest(tool=tool['name']):
                schema = tool['inputSchema']
                self.assertEqual(schema['type'], 'object')
                self.assertFalse(schema.get('additionalProperties', True))
                self.assertNotIn('outputSchema', tool)
                self.assertEqual(dispatch.get(tool['name']), CONTRACT[tool['name']])

    def test_dispatch_handles_exactly_the_advertised_and_legacy_names(self):
        mapping = self.dispatch_map()
        self.assertEqual(set(mapping), set(CONTRACT) | set(LEGACY_DISPATCH))
        for name, verb in LEGACY_DISPATCH.items():
            self.assertEqual(mapping[name], verb, name)

    def test_mapped_commands_exist_in_the_native_usage(self):
        verbs = self.usage_verbs()
        for name, verb in CONTRACT.items():
            self.assertIn(verb, verbs, name)
        self.assertIn(LEGACY_DISPATCH['baton2_worker_status'], verbs)

    def test_native_commands_without_tools_stay_explicit(self):
        # workers stays out of the usage text; the hidden legacy alias is
        # pinned behaviorally in test_legacy_workers_alias_is_still_a_command.
        self.assertNotIn('workers', self.usage_verbs())
        mapped = set(CONTRACT.values()) | set(LEGACY_DISPATCH.values())
        self.assertEqual(self.usage_verbs() - mapped, set(CLI_ONLY))

    def test_legacy_workers_alias_is_still_a_native_command(self):
        with tempfile.TemporaryDirectory() as home:
            db = pathlib.Path(home) / 'absent.db'
            result = subprocess.run([str(EXE), str(db), 'workers'],
                                    text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), [])


if __name__ == '__main__':
    unittest.main()
