"""Exercise the adapter's actual attachment startup with a recording coordinator."""
import importlib.util
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location('mcp_root', HERE / 'mcp-root.py')
mcp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp)

COORDINATOR = r'''#!/usr/bin/env python3
import json
import os
import sqlite3
import sys

db, command, *args = sys.argv[1:]
with open(os.environ['ATTACH_CALLS'], 'a') as log:
    log.write(json.dumps([command, *args]) + '\n')
mode = os.environ['ATTACH_MODE']
if command in ('attach', 'connect'):
    with open(os.environ['ATTACH_GATE'], 'rb', buffering=0) as gate:
        gate.read(1)
if mode == command + '-failure':
    sys.stdout.write('original output\nsecond output\n')
    sys.stderr.write('original error\nsecond error\n')
    sys.exit(71)
if command in ('attach', 'connect'):
    endpoint = args[-1] if mode != 'mismatch' else '["changed endpoint"]'
    with sqlite3.connect(db) as connection:
        connection.execute('UPDATE sessions SET endpoint=? WHERE id=?', (endpoint, args[0]))
print('{}')
'''


class Attachment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.calls = self.directory / 'calls.jsonl'
        self.gate = self.directory / 'gate'
        os.mkfifo(self.gate)
        self.gate_fd = os.open(self.gate, os.O_RDWR | os.O_NONBLOCK)
        self.addCleanup(os.close, self.gate_fd)
        self.coordinator = self.directory / 'coordinator'
        self.coordinator.write_text(COORDINATOR)
        self.coordinator.chmod(0o755)
        with sqlite3.connect(self.db) as connection:
            connection.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, parent TEXT, '
                               'harness TEXT, native TEXT, endpoint TEXT)')
            connection.executemany('INSERT INTO sessions VALUES (?,?,?,?,?)', [
                ('root', None, 'claude-code', 'native-root', ''),
                ('child', 'root', 'codex', 'native-child', ''),
            ])

    def start(self, mode='success', session=None):
        argv = ['node', str(ROOT / 'bend2/scripts/mcp-conductor.mjs'),
                str(self.db), str(self.coordinator)]
        if session is not None:
            argv.extend(['--session', session])
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env={**os.environ,
                                    'ATTACH_CALLS': str(self.calls),
                                    'ATTACH_GATE': str(self.gate), 'ATTACH_MODE': mode})

        def cleanup():
            # Release a fixture child even when an assertion interrupted startup.
            os.write(self.gate_fd, b'xxxxxxxx')
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=5)
            mcp._mcp_buf.pop(proc.stdout.fileno(), None)
            proc.stdin.close()
            proc.stdout.close()
            proc.stderr.close()

        self.addCleanup(cleanup)
        mcp.send_mcp(proc, {'jsonrpc': '2.0', 'id': 'initialize', 'method': 'initialize'})
        self.assertEqual(mcp.read_mcp(proc)['id'], 'initialize')
        return proc

    def begin(self, proc):
        # Both notifications exercise the same in-flight attachment.
        for _ in range(2):
            mcp.send_mcp(proc, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        for identity in ('tools', 'tools-again', 'tools-third'):
            mcp.send_mcp(proc, {'jsonrpc': '2.0', 'id': identity, 'method': 'tools/list'})
            self.assertEqual(mcp.read_mcp(proc, handle_ping=False)['id'], identity)
        mcp.send_mcp(proc, {'jsonrpc': '2.0', 'id': 'responsive', 'method': 'ping'})
        self.assertEqual(mcp.read_mcp(proc, handle_ping=False),
                         {'jsonrpc': '2.0', 'id': 'responsive', 'result': {}})
        # The recording coordinator cannot finish attachment until this write.
        os.write(self.gate_fd, b'x')

    def recorded(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_default_root_and_child_attach_once_and_preserve_identity(self):
        for session in (None, 'child'):
            with self.subTest(session=session):
                proc = self.start(session=session)
                self.begin(proc)
                self.assertEqual(mcp.read_mcp(proc, handle_ping=False),
                                 {'jsonrpc': '2.0', 'id': 'conductor-channel-ready',
                                  'method': 'ping'})
                # The readiness reply is withheld while ordinary replies continue.
                for identity in ('ready-tools', 'ready-tools-again'):
                    mcp.send_mcp(proc, {'jsonrpc': '2.0', 'id': identity, 'method': 'tools/list'})
                    self.assertEqual(mcp.read_mcp(proc, handle_ping=False)['id'], identity)
                mcp.send_mcp(proc, {'jsonrpc': '2.0', 'id': 'conductor-channel-ready', 'result': {}})
                mcp.send_mcp(proc, {'jsonrpc': '2.0', 'id': 'acknowledged-tools', 'method': 'tools/list'})
                self.assertEqual(mcp.read_mcp(proc, handle_ping=False)['id'], 'acknowledged-tools')
                selected = session or 'root'
                calls = self.recorded()
                attachment, role = calls[-2:]
                self.assertEqual(attachment[:-1],
                                 ['connect', 'child', 'native-child'] if session else
                                 ['attach', 'root', 'claude-code', 'native-root'])
                self.assertEqual(role, ['role', selected,
                                       'associate-conductor' if session else 'principal-conductor'])
                endpoint = json.loads(attachment[-1])
                self.assertEqual(endpoint[2:7], [str(self.db), str(self.coordinator),
                                                 '--session', selected, '--deliver'])
                with sqlite3.connect(self.db) as connection:
                    row = connection.execute('SELECT parent,harness,native,endpoint '
                                             'FROM sessions WHERE id=?', (selected,)).fetchone()
                self.assertEqual(row, ('root' if session else None,
                                       'codex' if session else 'claude-code',
                                       'native-' + selected, attachment[-1]))
                self.assertEqual(len(calls), 4 if session else 2)

    def assert_startup_failure(self, mode, expected_commands):
        proc = self.start(mode=mode)
        self.begin(proc)
        self.assertEqual(proc.wait(timeout=5), 1)
        self.assertEqual(mcp._mcp_buf.get(proc.stdout.fileno(), b''), b'')
        self.assertEqual(proc.stdout.read(), b'')
        self.assertEqual([call[0] for call in self.recorded()], expected_commands)
        return proc.stderr.read().decode()

    def test_attach_failure_preserves_exit_and_complete_streams(self):
        detail = self.assert_startup_failure('attach-failure', ['attach'])
        self.assertIn('exit code: 71', detail)
        self.assertIn('original output\nsecond output\n', detail)
        self.assertIn('original error\nsecond error\n', detail)

    def test_role_failure_never_announces_ready(self):
        detail = self.assert_startup_failure('role-failure', ['attach', 'role'])
        self.assertIn('exit code: 71', detail)
        self.assertIn('original error\nsecond error\n', detail)

    def test_changed_registration_never_announces_ready(self):
        detail = self.assert_startup_failure('mismatch', ['attach', 'role'])
        self.assertIn('Attachment endpoint registration did not match the selected session', detail)


if __name__ == '__main__':
    unittest.main()
