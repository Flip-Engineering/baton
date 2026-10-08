"""Integration test for the Bend2 Channels MCP Conductor adapter."""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-conductor.mjs'


def send_mcp(proc, msg):
    body = json.dumps(msg).encode()
    proc.stdin.write(body + b'\n')
    proc.stdin.flush()


_mcp_buf = {}

def read_mcp(proc, handle_ping=True):
    """Read one newline-delimited MCP message, as the native Claude client does."""
    fd = proc.stdout.fileno()
    if fd not in _mcp_buf:
        os.set_blocking(fd, True)
        _mcp_buf[fd] = b''
    buf = _mcp_buf[fd]
    while b'\n' not in buf:
        chunk = os.read(fd, 4096)
        if not chunk:
            raise EOFError('MCP server closed stdout')
        buf += chunk
    body, rest = buf.split(b'\n', 1)
    _mcp_buf[fd] = rest
    message = json.loads(body)
    if handle_ping and message.get('method') == 'ping':
        send_mcp(proc, {'jsonrpc': '2.0', 'id': message['id'], 'result': {}})
        return read_mcp(proc)
    return message


class McpRoot(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = pathlib.Path(tempfile.mkdtemp(dir=ROOT / '.scratch/bend2'))
        self.keep_temp = False
        self.mcp_output = []
        self.addCleanup(self.cleanup_temp)
        self.repo = self.temp / 'repository'
        self.repo.mkdir()
        self.checkouts = self.temp / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'MCP root fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.db = self.temp / 'state.db'
        self.addCleanup(self.shutdown_instance)

    def cleanup_temp(self):
        if self.keep_temp:
            print(f'MCP fixture state preserved at {self.temp}')
            return
        shutil.rmtree(self.temp)

    def shutdown_instance(self):
        result = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                capture_output=True, text=True)
        if result.returncode:
            self.keep_temp = True
            raise AssertionError(
                f'instance shutdown failed for {self.db}: exit {result.returncode}; '
                f'stdout={result.stdout!r}; stderr={result.stderr!r}; '
                f'MCP output={self.mcp_output!r}; '
                f'fixture state preserved at {self.temp}')

    def register(self, name, parent, harness, model, effort, workspace=None, branch=None, base=None):
        """Recruit the session into this suite's fixture repository."""
        return self.coord('recruit', name, parent, harness, model, effort, str(self.repo),
                          branch or (name + '-branch'), str(self.checkouts / name), self.base)

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *args],
            text=True, capture_output=True,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def start_mcp(self, session='root', script=MCP_SCRIPT):
        proc = subprocess.Popen(
            ['node', str(script), str(self.db), str(EXE), '--session', session],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        def cleanup():
            stdout_fd = proc.stdout.fileno()
            _mcp_buf.pop(stdout_fd, None)
            if proc.poll() is None:
                proc.terminate()
            stdout, stderr = proc.communicate()
            self.mcp_output.append({
                'stdout': stdout.decode(errors='replace'),
                'stderr': stderr.decode(errors='replace'),
            })
        self.addCleanup(cleanup)
        return proc

    def initialize(self, proc):
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {
                'protocolVersion': '2024-11-05',
                'capabilities': {},
                'clientInfo': {'name': 'test', 'version': '0.0.1'},
            },
        })
        resp = read_mcp(proc)
        return resp

    def activate(self, proc):
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        send_mcp(proc, {'jsonrpc': '2.0', 'id': 'channel-tools', 'method': 'tools/list'})
        self.assertEqual(read_mcp(proc)['id'], 'channel-tools')
        ready = read_mcp(proc, handle_ping=False)
        self.assertEqual((ready['id'], ready['method']), ('conductor-channel-ready', 'ping'))
        send_mcp(proc, {'jsonrpc': '2.0', 'id': ready['id'], 'result': {}})

    def test_initialize_advertises_channel_capability(self):
        proc = self.start_mcp()
        resp = self.initialize(proc)
        self.assertEqual(resp['result']['capabilities']['experimental'], {'claude/channel': {}})
        self.assertEqual(resp['result']['serverInfo']['name'], 'baton-conductor')

    def tool(self, proc, name, arguments=None, ok=True):
        send_mcp(proc, {'jsonrpc': '2.0', 'id': name, 'method': 'tools/call',
                        'params': {'name': name, 'arguments': arguments or {}}})
        result = read_mcp(proc)
        while 'method' in result:
            result = read_mcp(proc)
        self.assertEqual(result['id'], name)
        if ok:
            self.assertNotIn('isError', result['result'], result)
        return json.loads(result['result']['content'][0]['text'])

    def test_canonical_schemas_and_section_orchestra_controls(self):
        self.coord('attach', 'principal', 'claude-code', 'native-principal', '')
        self.coord('role', 'principal', 'principal-conductor')
        self.register('player-id', 'principal', 'omp', 'model', 'low')
        proc = self.start_mcp('principal')
        self.initialize(proc)
        send_mcp(proc, {'jsonrpc': '2.0', 'id': 'schemas', 'method': 'tools/list'})
        tools = {item['name']: item for item in read_mcp(proc)['result']['tools']}
        self.assertIn('baton2_players', tools)
        self.assertIn('baton2_player_status', tools)
        self.assertNotIn('baton2_workers', tools)
        self.assertNotIn('baton2_worker_status', tools)
        for tool in tools.values():
            self.assertNotIn('worker', tool['inputSchema'].get('properties', {}))
        selected = self.tool(proc, 'baton2_player', {'player': 'player-id'})
        self.assertEqual((selected['kind'], selected['role']), ('player', 'player'))
        self.assertEqual(self.tool(proc, 'baton2_role', {'session': 'principal'})['role'],
                         'principal-conductor')
        self.assertEqual({row['id'] for row in self.tool(proc, 'baton2_players')},
                         {'principal', 'player-id'})
        self.tool(proc, 'baton2_ensemble', {'ensemble': 'team', 'coupling': 'loose'})
        self.tool(proc, 'baton2_ensemble_member',
                  {'ensemble': 'team', 'player': 'player-id', 'action': 'add'})
        declared = self.tool(proc, 'baton2_section',
                             {'ensemble': 'team', 'section': 'git', 'capability': 'repository changes'})
        self.assertEqual(declared, {'ensemble': 'team', 'id': 'git',
                                    'capability': 'repository changes', 'members': []})
        member = self.tool(proc, 'baton2_section_member',
                          {'ensemble': 'team', 'section': 'git', 'player': 'player-id', 'action': 'add'})
        self.assertEqual(member['player'], 'player-id')
        section = self.tool(proc, 'baton2_section', {'ensemble': 'team', 'section': 'git'})
        self.assertEqual(section['members'], ['player-id'])
        orchestra = self.tool(proc, 'baton2_orchestra')
        self.assertEqual(orchestra['ensembles'][0]['sections'], [section])
        self.assertEqual({row['id'] for row in orchestra['players']}, {'principal', 'player-id'})
        self.assertEqual(orchestra['operators'], [])
        # Stored tool calls retain input compatibility, while schemas advertise Players.
        old = self.tool(proc, 'baton2_workers')
        self.assertEqual([row['id'] for row in old], ['player-id'])

    def test_selected_associate_receives_and_guides_with_empty_parent(self):
        associate = "delegated's λ"
        self.coord('attach', '', 'codex', 'native-parent', '')
        self.coord('role', '', 'principal-conductor')
        self.register(associate, '', 'claude-code', 'model', 'low', branch='associate-branch')
        self.coord('connect', associate, 'native-associate', '')
        self.register('child', associate, 'omp', 'model', 'low')
        proc = self.start_mcp(associate, ROOT / 'bend2/scripts/mcp-root.mjs')
        initialized = self.initialize(proc)
        self.assertIn('Associate Conductor', initialized['result']['instructions'])
        self.activate(proc)
        selected = json.loads(self.coord('player', associate))
        self.assertEqual((selected['parent'], selected['native'], selected['role']),
                         ('', 'native-associate', 'associate-conductor'))
        endpoint = json.loads(selected['endpoint'])
        self.assertIn(str(MCP_SCRIPT), endpoint)
        self.assertEqual(endpoint[endpoint.index('--session') + 1], associate)
        self.coord('report', 'associate-report', 'child', 'Delivered to the selected Associate.')
        notification = read_mcp(proc)
        self.assertEqual(notification['params']['meta']['recipient'], associate)
        self.assertEqual(json.loads(notification['params']['meta']['messageIds']), ['associate-report'])
        self.tool(proc, 'baton2_ack', {'id': 'associate-report', 'receipt': 'selected-reviewed'})
        self.assertEqual(json.loads(self.coord('inbox', associate)), [])
        self.assertEqual(json.loads(self.coord('inbox', '')), [])
        self.tool(proc, 'baton2_guide',
                  {'id': 'selected-guide', 'player': 'child', 'body': 'Selected guidance.'})
        guidance = json.loads(self.coord('inbox', 'child'))
        self.assertEqual([(row['sender'], row['recipient']) for row in guidance], [(associate, 'child')])
        self.coord('report', 'associate-finished', associate, 'Report to empty-ID parent.')
        parent_inbox = self.tool(proc, 'baton2_inbox', {'recipient': ''})
        self.assertEqual([row['id'] for row in parent_inbox], ['associate-finished'])

    def test_pending_report_triggers_channel_notification(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Worker completed the task.')

        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)

        # Initialization replays the pending report.
        notification = read_mcp(proc)
        self.assertEqual(notification['method'], 'notifications/claude/channel')
        self.assertIn('Worker completed the task.', notification['params']['content'])
        self.assertEqual(json.loads(notification['params']['meta']['messageIds']), ['turn-1'])
        self.assertTrue(all(isinstance(value, str) for value in notification['params']['meta'].values()))

    def test_report_writer_notifies_an_initialized_channel(self):
        self.coord('attach', 'root', 'claude-code', 'root-session', '')
        self.register('w1', 'root', 'omp', 'model', 'low', '/wt', 'br', 'base')
        self.coord('report', 'before', 'w1', 'Before attachment.')
        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)
        self.assertIn('before', read_mcp(proc)['params']['meta']['messageIds'])
        self.coord('report', 'after', 'w1', 'After attachment.')
        pending = json.loads(self.coord('inbox', 'root'))
        self.assertEqual([row['id'] for row in pending], ['before', 'after'])
        for row in pending:
            self.assertIsNone(json.loads(self.coord('delivery', row['id']))['receipt'])
        note = read_mcp(proc)
        self.assertEqual(json.loads(note['params']['meta']['messageIds']), ['after'])
        self.assertIn('After attachment.', note['params']['content'])

    def test_tool_status_returns_sessions(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)

        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
            'params': {'name': 'baton2_status', 'arguments': {}},
        })
        resp = read_mcp(proc)
        # May need to skip channel notifications.
        while 'method' in resp and resp['method'] == 'notifications/claude/channel':
            resp = read_mcp(proc)
        self.assertIn('root', resp['result']['content'][0]['text'])

    def test_tool_ack_clears_pending_message(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Done.')

        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)

        # Wait for initial notification.
        notif = read_mcp(proc)
        self.assertEqual(notif['method'], 'notifications/claude/channel')

        # Ack the message.
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
            'params': {
                'name': 'baton2_ack',
                'arguments': {'id': 'turn-1', 'receipt': 'channel-delivered'},
            },
        })
        resp = read_mcp(proc)
        while 'method' in resp:
            resp = read_mcp(proc)
        self.assertNotIn('isError', resp['result'])

        # Inbox should be empty.
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
            'params': {'name': 'baton2_inbox', 'arguments': {}},
        })
        resp = read_mcp(proc)
        while 'method' in resp:
            resp = read_mcp(proc)
        self.assertEqual(json.loads(resp['result']['content'][0]['text']), [])

    def test_guide_sends_message_to_player_inbox(self):
        # Set up root and worker sessions
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')

        # Start MCP and initialize
        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)

        # Send guidance via the baton2_guide tool
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 20, 'method': 'tools/call',
            'params': {
                'name': 'baton2_guide',
                'arguments': {
                    'id': 'guide-1',
                    'player': 'w1',
                    'body': 'Focus on the login endpoint first.',
                },
            },
        })
        resp = read_mcp(proc)
        while 'method' in resp:
            resp = read_mcp(proc)
        # The guide tool should succeed
        self.assertNotIn('isError', resp.get('result', {}))

        # Verify the message landed in the worker's inbox via the coordinator
        inbox = self.coord('inbox', 'w1')
        import json as _json
        messages = _json.loads(inbox)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]['id'], 'guide-1')
        self.assertEqual(messages[0]['kind'], 'guidance')
        self.assertIn('login endpoint', messages[0]['body'])

    def test_restart_delivers_pending_report(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Pending across restart.')

        proc1 = self.start_mcp()
        self.initialize(proc1)
        self.activate(proc1)
        notif1 = read_mcp(proc1)
        self.assertEqual(notif1['method'], 'notifications/claude/channel')
        self.assertIn('Pending across restart', notif1['params']['content'])

        proc1.terminate()
        proc1.wait()

        proc2 = self.start_mcp()

        send_mcp(proc2, {
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {
                'protocolVersion': '2024-11-05',
                'capabilities': {},
                'clientInfo': {'name': 'test', 'version': '0.0.1'},
            },
        })
        read_mcp(proc2)
        self.activate(proc2)

        notif2 = read_mcp(proc2)
        self.assertEqual(notif2['method'], 'notifications/claude/channel')
        self.assertIn('Pending across restart', notif2['params']['content'])
        self.assertIn('turn-1', notif2['params']['meta']['messageIds'])

    def test_players_and_turns_tools_return_coordinator_data(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        event = self.temp / 'event.json'
        event.write_text(json.dumps({'type': 'result', 'result': 'done'}))
        self.coord('observe-file', 'turn-1', 'w1', str(event))

        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)

        def tool_call(call_id, name, arguments=None):
            send_mcp(proc, {
                'jsonrpc': '2.0', 'id': call_id, 'method': 'tools/call',
                'params': {'name': name, 'arguments': arguments or {}},
            })
            resp = read_mcp(proc)
            while 'method' in resp:
                resp = read_mcp(proc)
            return resp

        players_resp = tool_call(30, 'baton2_players')
        players = json.loads(players_resp['result']['content'][0]['text'])
        self.assertEqual({player['id'] for player in players}, {'root', 'w1'})
        reported = next(player for player in players if player['id'] == 'w1')
        self.assertEqual(reported['latestReport'], 'done')

        turns_resp = tool_call(31, 'baton2_turns', {'player': 'w1'})
        turns = json.loads(turns_resp['result']['content'][0]['text'])
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]['id'], 'turn-1')
        self.assertEqual(turns[0]['eventType'], 'result')

        pending_resp = tool_call(32, 'baton2_pending')
        pending = json.loads(pending_resp['result']['content'][0]['text'])
        self.assertTrue(len(pending) >= 1)
        self.assertEqual(pending[0]['id'], 'turn-1')

    def test_duplicate_notification_not_sent(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'First report.')

        proc = self.start_mcp()
        self.initialize(proc)
        self.activate(proc)

        # First notification.
        notif1 = read_mcp(proc)
        self.assertEqual(notif1['method'], 'notifications/claude/channel')

        # Re-deliver the same committed report to the attached channel.
        self.coord('report', 'turn-1', 'w1', 'First report.')
        send_mcp(proc, {'jsonrpc': '2.0', 'id': 10, 'method': 'ping', 'params': {}})

        msgs = []
        while True:
            msg = read_mcp(proc)
            if msg.get('id') == 10:
                self.assertEqual(msg.get('result'), {})
                break
            msgs.append(msg)

        channel_notifs = [m for m in msgs if m.get('method') == 'notifications/claude/channel']
        self.assertEqual(len(channel_notifs), 0, 'Duplicate notification sent')


if __name__ == '__main__':
    unittest.main()
