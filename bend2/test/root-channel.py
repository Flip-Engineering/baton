"""A root with owed input and no attached channel is reported (#1054, #1217).

The root's Claude Code session loaded the removed impl/scripts/mcp-web.mjs.
That server failed at startup, so the root attached no channel, and its owed
input grew to 7136 messages with nothing reporting it. status, session and
orchestra now print one error line for each such root on stderr. A committed
message, report or question to it prints the line to its sender and appends
it to the database's .root.log.

A root is any parentless session with the operator role, whatever its harness.
A Codex root with a recorded managed receiver is attached when 'codex app-server
proxy' connects through the receiver's recorded environment. An empty endpoint
cannot establish a route to a conversation on another host. A session below a
coordinator that has no endpoint reports its undeliverable input to that coordinator.

BATON2_ROOT_CHANNEL_FIXTURE names a built bend2/test/root-channel binary;
otherwise the test builds it with bend2/scripts/build-native.sh.
"""
import json
import os
import pathlib
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '.scratch/bend2'
CONDUCTOR = '/opt/baton/bend2/scripts/mcp-conductor.mjs'
# A conductor stand-in: listens on a socket name relative to its directory,
# as mcp-conductor.mjs does, until it is killed.
LISTENER = '''import socket, sys, time
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(sys.argv[1])
server.listen(8)
print('listening', flush=True)
while True:
    connection, _ = server.accept()
    connection.close()
'''


def fixture():
    binary = os.environ.get('BATON2_ROOT_CHANNEL_FIXTURE')
    if binary:
        return binary
    SCRATCH.mkdir(parents=True, exist_ok=True)
    binary = str(SCRATCH / 'root-channel')
    build = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                            'bend2/test/root-channel.bend', binary],
                           cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True)
    if build.returncode:
        raise AssertionError(build.stdout + build.stderr)
    return binary


class RootChannel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = fixture()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = pathlib.Path(self.temp.name)
        self.path = str(self.dir / 'orchestra.db')
        installed = self.run_entry('install', self.path)
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        self.sql("INSERT INTO sessions(id,parent,harness) VALUES('operator',NULL,'claude-code')")
        self.sql("INSERT INTO session_roles(session,role) VALUES('operator','operator')")
        self.sql("INSERT INTO sessions(id,parent,harness) VALUES('lead',NULL,'omp')")
        self.sql("INSERT INTO session_roles(session,role) VALUES('lead','conductor')")

    def run_entry(self, *args, env=None):
        return subprocess.run([self.binary, *args], capture_output=True, text=True, env=env,
                              stdin=subprocess.PIPE)

    def sql(self, statement, values=()):
        db = sqlite3.connect(self.path, isolation_level=None)
        try:
            db.execute(statement, values)
        finally:
            db.close()

    def owe(self, recipient, count, sender='lead', kind='report'):
        for n in range(count):
            self.sql('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                     (f'{recipient}:{kind}:{n}', sender, recipient, kind, f'body {n}'))

    def endpoint(self, session, value):
        self.sql('UPDATE sessions SET endpoint=? WHERE id=?', (value, session))

    def conductor_endpoint(self, session, socket_name):
        return json.dumps(['/usr/bin/node', CONDUCTOR, self.path, '/opt/baton/bin/baton',
                           '--session', session, '--deliver', socket_name])

    def listen(self, name):
        # mcp-conductor.mjs binds a name relative to the database directory,
        # which keeps long directory paths within the AF_UNIX path limit.
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        cwd = os.getcwd()
        os.chdir(self.dir)
        try:
            server.bind(name)
        finally:
            os.chdir(cwd)
        server.listen(1)
        self.addCleanup(server.close)

    def warn(self, env=None):
        result = self.run_entry('warn', self.path, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return [line for line in result.stderr.splitlines() if line.startswith('Baton error:')]

    def root_log(self):
        log = pathlib.Path(self.path + '.root.log')
        return log.read_text() if log.exists() else ''

    def test_operator_without_endpoint_is_reported(self):
        self.owe('operator', 2)
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('root session operator has 2 owed inputs and no attached channel', lines[0])
        self.assertIn('no channel endpoint is registered', lines[0])
        self.assertIn('bend2/scripts/mcp-conductor.mjs', lines[0])

    def test_operator_with_a_listening_conductor_socket_is_attached(self):
        self.owe('operator', 2)
        self.listen('conductor-1-a.sock')
        self.endpoint('operator', self.conductor_endpoint('operator', 'conductor-1-a.sock'))
        self.assertEqual(self.warn(), [])

    def test_conductor_endpoint_with_a_missing_socket_is_reported(self):
        self.owe('operator', 1)
        self.endpoint('operator', self.conductor_endpoint('operator', 'conductor-2-b.sock'))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('root session operator has 1 owed inputs', lines[0])
        self.assertIn(f'no process accepts connections on the conductor socket {self.dir}/conductor-2-b.sock', lines[0])

    def test_parentless_conductor_with_a_missing_socket_is_reported(self):
        self.owe('lead', 3, sender='operator', kind='guidance')
        self.endpoint('lead', self.conductor_endpoint('lead', 'conductor-3-c.sock'))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('root session lead has 3 owed inputs', lines[0])
        self.assertIn('accepts connections on the conductor socket', lines[0])
        self.assertIn('conductor-3-c.sock', lines[0])

    def test_socket_left_by_a_killed_conductor_is_reported(self):
        self.owe('operator', 1)
        name = 'conductor-4-d.sock'
        self.endpoint('operator', self.conductor_endpoint('operator', name))
        listener = subprocess.Popen([sys.executable, '-c', LISTENER, name], cwd=self.dir,
                                    stdout=subprocess.PIPE, text=True)
        self.addCleanup(lambda: listener.poll() is None and listener.kill())
        self.assertEqual(listener.stdout.readline().strip(), 'listening')
        self.assertEqual(self.warn(), [])
        listener.send_signal(signal.SIGKILL)
        listener.wait()
        self.assertTrue((self.dir / name).exists())
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn(f'no process accepts connections on the conductor socket {self.dir}/{name}', lines[0])

    def test_regular_file_at_the_socket_path_is_reported(self):
        self.owe('operator', 1)
        name = 'conductor-5-e.sock'
        (self.dir / name).write_text('')
        self.endpoint('operator', self.conductor_endpoint('operator', name))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn(f'no process accepts connections on the conductor socket {self.dir}/{name}', lines[0])

    def test_removed_resident_endpoint_is_reported(self):
        self.owe('operator', 1)
        self.endpoint('operator', json.dumps(['node', '/old/impl/scripts/mcp-web.mjs', self.path]))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('the registered endpoint is not a conductor channel', lines[0])
        self.assertIn('mcp-web.mjs', lines[0])

    def test_no_owed_input_and_receive_conductors_are_not_reported(self):
        self.owe('lead', 2, sender='operator', kind='guidance')
        self.endpoint('lead', json.dumps(['/opt/baton/bin/baton', self.path, 'receive', 'lead']))
        self.assertEqual(self.warn(), [])

    def test_message_to_an_unattached_root_reaches_the_sender_and_root_log(self):
        self.owe('operator', 1)
        result = self.run_entry('message', self.path, 'operator:report:0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Baton error: root session operator has 1 owed inputs', result.stderr)
        self.assertIn('Baton error: root session operator has 1 owed inputs', self.root_log())

    def test_message_to_another_session_is_not_reported(self):
        self.owe('operator', 1)
        self.owe('lead', 1, sender='operator', kind='guidance')
        result = self.run_entry('message', self.path, 'lead:guidance:0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('Baton error', result.stderr)
        self.assertEqual(self.root_log(), '')

    def test_report_command_wake_reports_the_unattached_root(self):
        self.owe('operator', 1)
        result = self.run_entry('report', self.path, 'operator:report:0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), 'driven')
        self.assertIn('Baton error: root session operator has 1 owed inputs', result.stderr)
        self.assertIn('Baton error: root session operator has 1 owed inputs', self.root_log())


    def test_recorded_reads_remove_root_warnings_with_null_receipts(self):
        self.owe('operator', 2)
        self.sql("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','operator:report:0','operator','','fixture')")
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('1 owed inputs', lines[0])
        self.sql("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','operator:report:1','operator','','fixture')")
        self.assertEqual(self.warn(), [])

    def test_unread_receipt_row_still_warns_for_the_committed_message(self):
        self.owe('operator', 1)
        self.sql("UPDATE messages SET receipt='legacy-only'")
        result = self.run_entry('message', self.path, 'operator:report:0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('1 owed inputs', result.stderr)
        self.assertIn('no channel endpoint is registered', self.root_log())


    def fake_codex(self, name, script):
        """A bin directory whose codex runs script in place of the app-server proxy."""
        directory = self.dir / name
        directory.mkdir()
        path = directory / 'codex'
        path.write_text('#!/bin/sh\n' + script)
        path.chmod(0o755)
        return str(directory)

    def codex_root(self, endpoint_path=None):
        self.sql("UPDATE sessions SET harness='codex',native='thread-1' WHERE id='operator'")
        if endpoint_path is not None:
            self.endpoint('operator', json.dumps(['/usr/bin/env', f'PATH={endpoint_path}:/usr/bin:/bin',
                                                  '/opt/baton/bin/baton', self.path,
                                                  'codex-inbox-session', 'operator', 'thread-1']))

    def ambient(self, directory):
        return dict(os.environ, PATH=f'{directory}:{os.environ["PATH"]}')

    # The proxy exits 0 after it connects. It reads its standard input to the end,
    # so a check that leaves standard input open does not return.
    CONNECTED = 'cat > /dev/null\nexit 0\n'
    REFUSED = 'echo "Error: failed to connect to socket at /home/x/.codex/app-server-control/app-server-control.sock" >&2\nexit 1\n'

    def test_codex_root_with_a_reachable_recorded_route_is_attached(self):
        self.owe('operator', 1)
        self.codex_root(self.fake_codex('connected', self.CONNECTED))
        self.assertEqual(self.warn(), [])

    def test_codex_root_with_an_unreachable_recorded_route_is_reported(self):
        self.owe('operator', 2)
        self.codex_root(self.fake_codex('refused', self.REFUSED))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('root session operator has 2 owed inputs and no attached channel', lines[0])
        self.assertIn('the Codex app-server is not reachable through the recorded route (exit 1)', lines[0])
        self.assertIn('failed to connect to socket', lines[0])
        self.assertIn('Codex root relay through the managed app-server that owns its conversation', lines[0])
        self.assertNotIn('mcp-conductor.mjs', lines[0])

    def test_codex_root_probe_uses_the_recorded_environment(self):
        self.owe('operator', 1)
        self.codex_root(self.fake_codex('recorded', self.CONNECTED))
        refused = self.fake_codex('ambient', self.REFUSED)
        self.assertEqual(self.warn(env=self.ambient(refused)), [])

    def test_codex_root_without_an_endpoint_is_reported_even_if_local_app_server_is_reachable(self):
        self.owe('operator', 1)
        self.codex_root()
        connected = self.fake_codex('connected', self.CONNECTED)
        lines = self.warn(env=self.ambient(connected))
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('no native conversation or channel endpoint is registered', lines[0])

    def test_codex_root_probe_does_not_rewrite_the_recorded_endpoint(self):
        self.owe('operator', 1)
        self.codex_root()
        self.warn(env=self.ambient(self.fake_codex('connected', self.CONNECTED)))
        db = sqlite3.connect(self.path)
        try:
            self.assertEqual(db.execute("SELECT endpoint FROM sessions WHERE id='operator'").fetchone()[0], '')
        finally:
            db.close()

    def test_codex_root_without_a_native_conversation_or_endpoint_is_reported(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='codex' WHERE id='operator'")
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('no native conversation or channel endpoint is registered', lines[0])

    def test_codex_root_with_a_generic_receive_endpoint_is_reported(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='codex',native='thread-1' WHERE id='operator'")
        self.endpoint('operator', json.dumps(['/opt/baton/bin/baton', self.path, 'receive', 'operator']))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('not a supported root notification channel', lines[0])

    def test_codex_root_message_reaches_the_sender_and_root_log(self):
        self.owe('operator', 1)
        self.codex_root(self.fake_codex('refused', self.REFUSED))
        result = self.run_entry('message', self.path, 'operator:report:0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('the Codex app-server is not reachable', result.stderr)
        self.assertIn('the Codex app-server is not reachable', self.root_log())

    def test_codex_root_stream_witness_records_the_accepted_complete_read(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='codex',native='thread-1' WHERE id='operator'")
        endpoint = self.conductor_endpoint('operator', 'conductor-thread.sock')
        self.endpoint('operator', endpoint)
        context = json.dumps({'ready': True, 'database': self.path, 'session': 'operator',
                              'harness': 'codex', 'native': 'thread-1', 'endpoint': endpoint,
                              'thread': 'thread-1', 'connection': 'root-connection',
                              'readMessage': 'operator:report:0'})
        env = os.environ | {'BATON_SESSION': 'operator', 'BATON_DATABASE': self.path,
                            'BATON_MCP_INPUT': context, 'CODEX_THREAD_ID': 'thread-1'}
        result = self.run_entry('read', self.path, 'operator', 'operator:report:0', env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        db = sqlite3.connect(self.path)
        try:
            rows = db.execute("SELECT attempt,message,native,identity FROM message_reads WHERE message='operator:report:0'").fetchall()
            self.assertIn(('root-channel:root-connection', 'operator:report:0', 'thread-1',
                           'root-channel:root-connection:operator:report:0'), rows)
        finally:
            db.close()

    def test_codex_root_stream_witness_rejects_a_different_message(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='codex',native='thread-1' WHERE id='operator'")
        endpoint = self.conductor_endpoint('operator', 'conductor-thread.sock')
        self.endpoint('operator', endpoint)
        context = json.dumps({'ready': True, 'database': self.path, 'session': 'operator',
                              'harness': 'codex', 'native': 'thread-1', 'endpoint': endpoint,
                              'thread': 'thread-1', 'connection': 'root-connection',
                              'readMessage': 'another-message'})
        env = os.environ | {'BATON_SESSION': 'operator', 'BATON_DATABASE': self.path,
                            'BATON_MCP_INPUT': context, 'CODEX_THREAD_ID': 'thread-1'}
        result = self.run_entry('read', self.path, 'operator', 'operator:report:0', env=env)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        db = sqlite3.connect(self.path)
        try:
            self.assertEqual(db.execute("SELECT count(*) FROM message_reads WHERE message='operator:report:0'").fetchone()[0], 0)
        finally:
            db.close()

    def test_codex_root_stream_witness_rejects_a_different_thread(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='codex',native='thread-1' WHERE id='operator'")
        endpoint = self.conductor_endpoint('operator', 'conductor-thread.sock')
        self.endpoint('operator', endpoint)
        context = json.dumps({'ready': True, 'database': self.path, 'session': 'operator',
                              'harness': 'codex', 'native': 'thread-1', 'endpoint': endpoint,
                              'thread': 'different-thread', 'connection': 'root-connection',
                              'readMessage': 'operator:report:0'})
        env = os.environ | {'BATON_SESSION': 'operator', 'BATON_DATABASE': self.path,
                            'BATON_MCP_INPUT': context, 'CODEX_THREAD_ID': 'thread-1'}
        result = self.run_entry('read', self.path, 'operator', 'operator:report:0', env=env)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        db = sqlite3.connect(self.path)
        try:
            self.assertEqual(db.execute("SELECT count(*) FROM message_reads WHERE message='operator:report:0'").fetchone()[0], 0)
        finally:
            db.close()
    def test_other_harness_operator_with_a_generic_receive_endpoint_is_reported(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='omp' WHERE id='operator'")
        self.endpoint('operator', json.dumps(['/opt/baton/bin/baton', self.path, 'receive', 'operator']))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('not a supported root notification channel', lines[0])

    def test_other_harness_operator_without_an_endpoint_is_reported(self):
        self.owe('operator', 3)
        self.sql("UPDATE sessions SET harness='omp' WHERE id='operator'")
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('root session operator has 3 owed inputs and no attached channel: no channel endpoint is registered', lines[0])
        self.assertIn("Register an endpoint for harness 'omp'", lines[0])
        self.assertNotIn('mcp-conductor.mjs', lines[0])

    def test_unsupported_harness_operator_without_an_endpoint_is_reported(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='operator' WHERE id='operator'")
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('no channel endpoint is registered', lines[0])
        self.assertIn("harness 'operator'", lines[0])

    def test_operator_endpoint_that_is_not_an_argv_array_is_reported(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='omp' WHERE id='operator'")
        self.endpoint('operator', 'not json')
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('the registered endpoint is not an argv array: not json', lines[0])

    def test_explicit_mcp_endpoint_keeps_channel_diagnostics(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='operator' WHERE id='operator'")
        self.endpoint('operator', self.conductor_endpoint('operator', 'missing-mcp.sock'))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('no process accepts connections on the conductor socket', lines[0])
        self.assertIn('bend2/scripts/mcp-conductor.mjs', lines[0])

    def worker(self, endpoint=None, harness='omp'):
        self.sql("INSERT INTO sessions(id,parent,harness) VALUES('worker','lead',?)", (harness,))
        if endpoint is not None:
            self.endpoint('worker', endpoint)

    def seat_input(self, recipient, count, kind='guidance'):
        self.owe(recipient, count, sender='lead', kind=kind)

    def coordinator_reports(self):
        db = sqlite3.connect(self.path)
        try:
            return db.execute("SELECT id,sender,recipient,body FROM messages WHERE id LIKE 'endpointless:%' ORDER BY seq").fetchall()
        finally:
            db.close()

    def deliver(self, message):
        result = self.run_entry('deliver', self.path, message)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), 'delivered')

    def test_endpointless_seat_input_is_reported_to_its_coordinator(self):
        self.worker()
        self.seat_input('worker', 2)
        self.deliver('worker:guidance:0')
        reports = self.coordinator_reports()
        self.assertEqual(len(reports), 1, reports)
        identity, sender, recipient, body = reports[0]
        self.assertEqual((sender, recipient), ('worker', 'lead'))
        self.assertRegex(identity, r'^endpointless:worker:\d+$')
        self.assertIn('Input worker:guidance:0 for worker was committed and cannot be delivered', body)
        self.assertIn('the session has no recorded endpoint', body)
        self.assertIn('worker has 2 owed inputs', body)
        self.assertIn('baton connect --endpoint JSON_ARGV --session worker', body)
        self.assertIn('baton resume --session worker to deliver the retained input', body)
        self.assertIn('The original input remains stored.', body)

    def test_second_input_to_the_same_endpointless_seat_adds_no_report(self):
        self.worker()
        self.seat_input('worker', 3)
        self.deliver('worker:guidance:0')
        self.deliver('worker:guidance:1')
        self.deliver('worker:guidance:2')
        self.assertEqual(len(self.coordinator_reports()), 1)

    def test_read_input_lets_the_next_owed_input_report_again(self):
        self.worker()
        self.seat_input('worker', 2)
        self.deliver('worker:guidance:0')
        self.sql("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','worker:guidance:0','worker','','fixture')")
        self.deliver('worker:guidance:1')
        reports = self.coordinator_reports()
        self.assertEqual(len(reports), 2, reports)
        self.assertNotEqual(reports[0][0], reports[1][0])

    def test_seat_with_an_endpoint_is_not_reported(self):
        self.worker(json.dumps(['/opt/baton/bin/true', '--ignored']))
        self.seat_input('worker', 1)
        self.run_entry('deliver', self.path, 'worker:guidance:0')
        self.assertEqual(self.coordinator_reports(), [])

    def test_unsupported_harness_seat_is_reported_with_its_cause(self):
        self.worker(harness='unknown')
        self.seat_input('worker', 1)
        self.deliver('worker:guidance:0')
        reports = self.coordinator_reports()
        self.assertEqual(len(reports), 1, reports)
        self.assertIn('its harness is not supported', reports[0][3])
        self.assertIn('Select a supported harness and record its receiver', reports[0][3])
        self.assertIn('baton resume --session worker to deliver the retained input', reports[0][3])
        self.assertIn('The original input and cause remain stored.', reports[0][3])

    def test_input_to_the_root_itself_adds_no_coordinator_report(self):
        self.seat_input('operator', 1)
        self.deliver('operator:guidance:0')
        self.assertEqual(self.coordinator_reports(), [])

    def test_stopped_seat_is_not_reported(self):
        self.worker()
        self.seat_input('worker', 1)
        self.sql("INSERT INTO session_stops(id,session,reason,outcome) VALUES('stop-1','worker','fixture','stopped')")
        self.run_entry('deliver', self.path, 'worker:guidance:0')
        self.assertEqual(self.coordinator_reports(), [])


if __name__ == '__main__':
    unittest.main()
