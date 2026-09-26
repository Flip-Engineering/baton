"""Integration test for the Bend2 Channels MCP root adapter."""
import json
import os
import pathlib
import select
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-root.mjs'


def send_mcp(proc, msg):
    body = json.dumps(msg).encode()
    header = f'Content-Length: {len(body)}\r\n\r\n'.encode()
    proc.stdin.write(header + body)
    proc.stdin.flush()


_mcp_buf = {}

def read_mcp(proc, timeout=5):
    """Read one Content-Length delimited message from the process stdout."""
    fd = proc.stdout.fileno()
    if fd not in _mcp_buf:
        os.set_blocking(fd, False)
        _mcp_buf[fd] = b''

    buf = _mcp_buf[fd]
    deadline = time.monotonic() + timeout

    while b'\r\n\r\n' not in buf:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f'Timed out reading header, got: {buf!r}')
        ready, _, _ = select.select([fd], [], [], min(remaining, 0.5))
        if ready:
            chunk = os.read(fd, 4096)
            if not chunk:
                raise EOFError('MCP server closed stdout')
            buf += chunk

    header_end = buf.index(b'\r\n\r\n')
    header = buf[:header_end].decode()
    buf = buf[header_end + 4:]

    match = None
    for line in header.splitlines():
        if line.lower().startswith('content-length:'):
            match = int(line.split(':', 1)[1].strip())
    if match is None:
        raise ValueError(f'No Content-Length in header: {header!r}')

    while len(buf) < match:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Timed out reading body')
        ready, _, _ = select.select([fd], [], [], min(remaining, 0.5))
        if ready:
            chunk = os.read(fd, 4096)
            if not chunk:
                raise EOFError('Unexpected EOF reading body')
            buf += chunk

    body = buf[:match]
    _mcp_buf[fd] = buf[match:]
    return json.loads(body.decode())


class McpRoot(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'

    def tearDown(self):
        self.temp.cleanup()

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *args],
            text=True, capture_output=True, timeout=10,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def start_mcp(self):
        proc = subprocess.Popen(
            ['node', str(MCP_SCRIPT), str(self.db), str(EXE)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.addCleanup(lambda: (proc.terminate(), proc.wait()))
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

    def test_initialize_advertises_channel_capability(self):
        proc = self.start_mcp()
        resp = self.initialize(proc)
        self.assertEqual(resp['result']['capabilities']['experimental'], {'claude/channel': {}})
        self.assertEqual(resp['result']['serverInfo']['name'], 'baton-root')

    def test_pending_report_triggers_channel_notification(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Worker completed the task.')

        proc = self.start_mcp()
        self.initialize(proc)
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

        # The server polls every 2s; wait for the channel notification.
        notification = read_mcp(proc, timeout=5)
        self.assertEqual(notification['method'], 'notifications/claude/channel')
        self.assertIn('Worker completed the task.', notification['params']['content'])
        self.assertIn('turn-1', notification['params']['meta']['messageIds'])

    def test_tool_status_returns_sessions(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        proc = self.start_mcp()
        self.initialize(proc)
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

        # Drain any pending channel notification first.
        time.sleep(0.5)

        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
            'params': {'name': 'baton2_status', 'arguments': {}},
        })
        resp = read_mcp(proc, timeout=5)
        # May need to skip channel notifications.
        while 'method' in resp and resp['method'] == 'notifications/claude/channel':
            resp = read_mcp(proc, timeout=5)
        self.assertIn('root', resp['result']['content'][0]['text'])

    def test_tool_ack_clears_pending_message(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Done.')

        proc = self.start_mcp()
        self.initialize(proc)
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

        # Wait for initial notification.
        notif = read_mcp(proc, timeout=5)
        self.assertEqual(notif['method'], 'notifications/claude/channel')

        # Ack the message.
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
            'params': {
                'name': 'baton2_ack',
                'arguments': {'id': 'turn-1', 'receipt': 'channel-delivered'},
            },
        })
        resp = read_mcp(proc, timeout=5)
        while 'method' in resp:
            resp = read_mcp(proc, timeout=5)
        self.assertNotIn('isError', resp['result'])

        # Inbox should be empty.
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
            'params': {'name': 'baton2_inbox', 'arguments': {}},
        })
        resp = read_mcp(proc, timeout=5)
        while 'method' in resp:
            resp = read_mcp(proc, timeout=5)
        self.assertEqual(json.loads(resp['result']['content'][0]['text']), [])

    def test_guide_sends_message_to_worker_inbox(self):
        # Set up root and worker sessions
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')

        # Start MCP and initialize
        proc = self.start_mcp()
        self.initialize(proc)
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

        # Send guidance via the baton2_guide tool
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 20, 'method': 'tools/call',
            'params': {
                'name': 'baton2_guide',
                'arguments': {
                    'id': 'guide-1',
                    'worker': 'w1',
                    'body': 'Focus on the login endpoint first.',
                },
            },
        })
        resp = read_mcp(proc, timeout=5)
        while 'method' in resp:
            resp = read_mcp(proc, timeout=5)
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
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Pending across restart.')

        proc1 = self.start_mcp()
        self.initialize(proc1)
        send_mcp(proc1, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        notif1 = read_mcp(proc1, timeout=5)
        self.assertEqual(notif1['method'], 'notifications/claude/channel')
        self.assertIn('Pending across restart', notif1['params']['content'])

        proc1.terminate()
        proc1.wait()

        proc2 = subprocess.Popen(
            ['node', str(MCP_SCRIPT), str(self.db), str(EXE)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.addCleanup(lambda: (proc2.terminate(), proc2.wait()))

        send_mcp(proc2, {
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {
                'protocolVersion': '2024-11-05',
                'capabilities': {},
                'clientInfo': {'name': 'test', 'version': '0.0.1'},
            },
        })
        read_mcp(proc2)
        send_mcp(proc2, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

        notif2 = read_mcp(proc2, timeout=5)
        self.assertEqual(notif2['method'], 'notifications/claude/channel')
        self.assertIn('Pending across restart', notif2['params']['content'])
        self.assertIn('turn-1', notif2['params']['meta']['messageIds'])

    def test_duplicate_notification_not_sent(self):
        self.coord('attach', 'root', 'native-test', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'First report.')

        proc = self.start_mcp()
        self.initialize(proc)
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})

        # First notification.
        notif1 = read_mcp(proc, timeout=5)
        self.assertEqual(notif1['method'], 'notifications/claude/channel')

        # Wait for two poll cycles (2s each = 4s), then send a ping and collect
        # everything that arrived. No duplicate channel notification should appear.
        time.sleep(5)
        send_mcp(proc, {'jsonrpc': '2.0', 'id': 10, 'method': 'ping', 'params': {}})

        msgs = []
        try:
            while True:
                msg = read_mcp(proc, timeout=3)
                msgs.append(msg)
                if msg.get('id') == 10:
                    break
        except (TimeoutError, EOFError):
            pass

        channel_notifs = [m for m in msgs if m.get('method') == 'notifications/claude/channel']
        self.assertEqual(len(channel_notifs), 0, 'Duplicate notification sent')


if __name__ == '__main__':
    unittest.main()
