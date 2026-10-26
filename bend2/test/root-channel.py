"""A root with owed input and no attached channel is reported (#1054).

The root's Claude Code session loaded the removed impl/scripts/mcp-web.mjs.
That server failed at startup, so the root attached no channel, and its owed
input grew to 7136 messages with nothing reporting it. status, session and
orchestra now print one error line for each such root on stderr. A committed
message, report or question to it prints the line to its sender and appends
it to the database's .root.log.

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

    def run_entry(self, *args):
        return subprocess.run([self.binary, *args], capture_output=True, text=True)

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

    def warn(self):
        result = self.run_entry('warn', self.path)
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


    def test_codex_operator_route_is_not_a_claude_channel(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='codex',native='recorded-codex-thread' WHERE id='operator'")
        self.endpoint('operator', json.dumps(['/opt/baton/bin/baton', self.path, 'codex-inbox-session', 'operator', 'recorded-codex-thread']))
        self.assertEqual(self.warn(), [])

    def test_other_harness_operator_does_not_get_a_claude_attachment_instruction(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='omp' WHERE id='operator'")
        self.endpoint('operator', json.dumps(['/opt/baton/bin/baton', self.path, 'receive', 'operator']))
        self.assertEqual(self.warn(), [])

    def test_untyped_operator_is_not_classified_as_a_claude_channel(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='operator' WHERE id='operator'")
        self.assertEqual(self.warn(), [])

    def test_explicit_mcp_endpoint_keeps_channel_diagnostics(self):
        self.owe('operator', 1)
        self.sql("UPDATE sessions SET harness='operator' WHERE id='operator'")
        self.endpoint('operator', self.conductor_endpoint('operator', 'missing-mcp.sock'))
        lines = self.warn()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn('no process accepts connections on the conductor socket', lines[0])


if __name__ == '__main__':
    unittest.main()
