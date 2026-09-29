"""End-to-end slice: recruit a worker, receive its report via Channels MCP, land its change."""
import json
import os
import pathlib
import select
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-root.mjs'


def send_mcp(proc, msg):
    body = json.dumps(msg).encode()
    proc.stdin.write(body + b'\n')
    proc.stdin.flush()


_mcp_buf = {}


def read_mcp(proc, timeout=5):
    """Read one newline-delimited MCP message and answer client pings."""
    fd = proc.stdout.fileno()
    if fd not in _mcp_buf:
        os.set_blocking(fd, False)
        _mcp_buf[fd] = b''

    buf = _mcp_buf[fd]
    deadline = time.monotonic() + timeout

    while b'\n' not in buf:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f'Timed out reading message: {buf!r}')
        ready, _, _ = select.select([fd], [], [], min(remaining, 0.5))
        if ready:
            chunk = os.read(fd, 4096)
            if not chunk:
                raise EOFError('MCP server closed stdout')
            buf += chunk

    body, rest = buf.split(b'\n', 1)
    _mcp_buf[fd] = rest
    message = json.loads(body)
    if message.get('method') == 'ping':
        send_mcp(proc, {'jsonrpc': '2.0', 'id': message['id'], 'result': {}})
        return read_mcp(proc, timeout)
    return message


class EndToEnd(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.db = self.directory / 'state.db'
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Baton test')
        self.git('config', 'user.email', 'baton@example.invalid')
        self.git('commit', '-q', '--allow-empty', '-m', 'initial')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ['git', '-C', str(self.repo), *args],
            check=True, text=True, capture_output=True,
        ).stdout

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *map(str, args)],
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
        def cleanup():
            proc.terminate()
            proc.wait()
            _mcp_buf.pop(proc.stdout.fileno(), None)
            proc.stdin.close()
            proc.stdout.close()
            proc.stderr.close()
        self.addCleanup(cleanup)
        return proc

    def initialize_mcp(self, proc):
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
            'params': {
                'protocolVersion': '2024-11-05',
                'capabilities': {},
                'clientInfo': {'name': 'test', 'version': '0.0.1'},
            },
        })
        resp = read_mcp(proc)
        self.assertEqual(resp['id'], 1)
        send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        send_mcp(proc, {'jsonrpc': '2.0', 'id': 'channel-tools', 'method': 'tools/list'})
        self.assertEqual(read_mcp(proc)['id'], 'channel-tools')
        return resp

    def test_recruit_report_notify_land(self):
        # 1. Attach root and recruit a worker.
        self.coord('attach', 'root', 'claude-code', 'root-session', 'root-endpoint')
        self.coord('recruit', 'w1', 'root', 'omp', 'model', 'high',
                   self.repo, 'w1-branch', 'wt', self.base)

        # 2. Worker makes a commit.
        wt = self.repo / 'wt'
        (wt / 'feature.txt').write_text('worker delivered this feature')
        subprocess.run(['git', '-C', str(wt), 'add', 'feature.txt'],
                       check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'commit', '-q', '-m', 'worker feature'],
                       check=True, capture_output=True)
        worker_commit = self.git('rev-parse', 'w1-branch').strip()

        # 3. Worker reports its result.
        self.coord('report', 'turn-1', 'w1', 'Feature implemented and committed.')

        # 4. Start the MCP server; the root receives the report as a channel notification.
        proc = self.start_mcp()
        self.initialize_mcp(proc)

        notification = read_mcp(proc, timeout=5)
        self.assertEqual(notification['method'], 'notifications/claude/channel')
        self.assertIn('Feature implemented', notification['params']['content'])
        self.assertEqual(json.loads(notification['params']['meta']['messageIds']), ['turn-1'])

        # 5. Root acknowledges the report.
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
            'params': {
                'name': 'baton2_ack',
                'arguments': {'id': 'turn-1', 'receipt': 'channel-delivered'},
            },
        })
        ack_resp = read_mcp(proc, timeout=5)
        while 'method' in ack_resp:
            ack_resp = read_mcp(proc, timeout=5)
        self.assertNotIn('isError', ack_resp.get('result', {}))

        # 6. Root lands the worker's change via the MCP tool.
        send_mcp(proc, {
            'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
            'params': {
                'name': 'baton2_land',
                'arguments': {
                    'worker': 'w1',
                    'repo': str(self.repo),
                    'target': 'main',
                },
            },
        })
        land_resp = read_mcp(proc, timeout=10)
        while 'method' in land_resp:
            land_resp = read_mcp(proc, timeout=10)
        land_result = json.loads(land_resp['result']['content'][0]['text'])
        self.assertEqual(land_result['status'], 'landed')
        self.assertEqual(land_result['commit'], worker_commit)

        # 7. Verify the target branch advanced.
        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, worker_commit)


if __name__ == '__main__':
    unittest.main()
