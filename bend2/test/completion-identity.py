"""Completion requests resolve their identity from the recorded assignment (#723).

A worker asks its recorded parent to confirm completion by sending a
completion-request. Baton generates the request identity when --id is omitted.
An explicit --id is accepted only when it names the actor's current recorded
request; an unrecorded, foreign or older identity is refused once with the
exact reason and stores nothing.

BATON2_STOP_HOOK_FIXTURE names a queue-built bend2/test/stop-hook-entry
binary; otherwise the test builds it with bend2/scripts/build-native.sh. The
fixture entry executes the production contextual handler as the recorded
session 'worker'.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '.scratch/bend2'
SEED = """
INSERT INTO sessions(id,parent,harness) VALUES('coordinator',NULL,'operator'),('worker','coordinator','claude-code');
INSERT INTO session_roles(session,role) VALUES('coordinator','conductor'),('worker','player');
INSERT INTO messages(id,sender,recipient,kind,body) VALUES('dispatch:assignment','coordinator','worker','task','Do the work.');
INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','dispatch:assignment','worker','','fixture');
"""
REQUEST = 'message:worker:request'
GUIDANCE = 'message:coordinator:next'


def fixture():
    binary = os.environ.get('BATON2_STOP_HOOK_FIXTURE')
    if binary:
        return binary
    SCRATCH.mkdir(parents=True, exist_ok=True)
    binary = str(SCRATCH / 'stop-hook-entry')
    build = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                            'bend2/test/stop-hook-entry.bend', binary],
                           cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True)
    if build.returncode:
        raise AssertionError(build.stdout + build.stderr)
    return binary


class CompletionIdentity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = fixture()
        schema = subprocess.run([cls.binary, 'schema'], capture_output=True, text=True)
        if schema.returncode:
            raise AssertionError(schema.stdout + schema.stderr)
        cls.schema = schema.stdout

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(pathlib.Path(self.temp.name) / 'orchestra.db')
        self.db = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript(self.schema + SEED)

    def invoke(self, *args):
        result = subprocess.run([self.binary, *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)[0]

    def invoke_all(self, *args, env=None):
        clean_env = os.environ.copy() if env is None else env.copy()
        for name in ('BATON_DATABASE', 'BATON_ATTEMPT_DIRECTORY',
                     'BATON_MCP_INPUT', 'CODEX_THREAD_ID'):
            clean_env.pop(name, None)
        result = subprocess.run([self.binary, *map(str, args)], capture_output=True,
                                text=True, env=clean_env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def request(self, body, ident=None):
        if ident is None:
            return self.invoke('completion-request', self.path, body)
        return self.invoke('completion-request-id', self.path, ident, body)

    def recorded(self, ident):
        return self.db.execute('SELECT sender,recipient,kind,body FROM messages WHERE id=?', (ident,)).fetchone()

    def requests(self):
        return self.db.execute("SELECT id,body FROM messages WHERE sender='worker' AND recipient='coordinator' AND kind='completion-request' ORDER BY seq").fetchall()

    def current_request(self):
        return self.db.execute("SELECT id FROM messages WHERE sender='worker' AND recipient='coordinator' "
                               "AND kind='completion-request' AND seq>coalesce((SELECT max(seq) FROM messages "
                               "WHERE recipient='worker' AND sender='coordinator' "
                               "AND kind IN ('task','guidance','recovery','task-assignment')),0) "
                               "ORDER BY seq DESC LIMIT 1").fetchone()

    def stored_request(self):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,'worker','coordinator','completion-request','Done.',NULL)",
                        (REQUEST,))
        self.db.execute("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture',?,'coordinator','','fixture')",
                        (REQUEST,))

    def next_assignment(self):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'coordinator','worker','guidance','Next assignment.')",
                        (GUIDANCE,))

    def test_stale_request_identity_is_refused_and_stores_nothing(self):
        self.stored_request()
        self.next_assignment()
        item = self.request('Done.', REQUEST)
        self.assertEqual(item['status'], 'refused', item)
        self.assertIn('current assignment', item['admission']['cause'])
        self.assertEqual(self.recorded(REQUEST), ('worker', 'coordinator', 'completion-request', 'Done.'))
        self.assertEqual(len(self.requests()), 1)
        self.assertIsNone(self.current_request())

    def test_unrecorded_request_identity_is_refused_and_stores_nothing(self):
        item = self.request('Done.', 'message:worker:absent')
        self.assertEqual(item['status'], 'refused', item)
        self.assertIn('is not recorded', item['admission']['cause'])
        self.assertIsNone(self.recorded('message:worker:absent'))
        self.assertEqual(self.requests(), [])
        self.assertIsNone(self.current_request())

    def test_an_assignment_identity_is_not_a_completion_request_identity(self):
        item = self.request('Done.', 'dispatch:assignment')
        self.assertEqual(item['status'], 'refused', item)
        self.assertIn('not this actor\'s completion request', item['admission']['cause'])
        self.assertEqual(self.requests(), [])

    def test_the_current_request_identity_replays_its_recorded_body(self):
        first = self.request('Done.')
        self.assertEqual(first['status'], 'admitted', first)
        self.assertEqual(self.current_request(), (first['id'],))
        replay = self.request('Done.', first['id'])
        self.assertEqual(replay['status'], 'admitted', replay)
        self.assertEqual(replay['id'], first['id'])
        self.assertEqual(self.requests(), [(first['id'], 'Done.')])

    def test_the_current_request_identity_refuses_a_different_body(self):
        first = self.request('Done.')
        self.assertEqual(first['status'], 'admitted', first)
        item = self.request('A different summary.', first['id'])
        self.assertEqual(item['status'], 'refused', item)
        self.assertIn('already recorded with different content', item['admission']['cause'])
        self.assertEqual(self.requests(), [(first['id'], 'Done.')])

    def test_a_newer_request_without_an_identity_becomes_current(self):
        first = self.request('Done.')
        second = self.request('Updated complete summary.')
        self.assertEqual(first['status'], 'admitted', first)
        self.assertEqual(second['status'], 'admitted', second)
        self.assertNotEqual(second['id'], first['id'])
        self.assertEqual(self.current_request(), (second['id'],))

    def test_a_request_recorded_before_succession_replays_to_its_recipient(self):
        first = self.request('Done.')
        self.db.executescript("""
INSERT INTO sessions(id,parent,harness) VALUES('successor',NULL,'operator');
INSERT INTO session_roles(session,role) VALUES('successor','conductor');
INSERT INTO session_stops(session,id,reason,outcome) VALUES('coordinator','stop-coordinator','retired','stopped');
INSERT INTO messages(id,sender,recipient,kind,body) VALUES('succession:coordinator:successor','successor','coordinator','succession','{}');
""")
        replay = self.request('Done.', first['id'])
        self.assertEqual(replay['status'], 'admitted', replay)
        self.assertEqual((replay['id'], replay['recipient']), (first['id'], 'coordinator'))
        self.assertEqual(self.requests(), [(first['id'], 'Done.')])
        later = self.request('Updated summary after succession.')
        self.assertEqual(later['status'], 'admitted', later)
        self.assertEqual(later['recipient'], 'successor')
        self.assertEqual(self.recorded(later['id'])[:3], ('worker', 'successor', 'completion-request'))
        stale = self.request('Done.', first['id'])
        self.assertEqual(stale['status'], 'refused', stale)
        self.assertIn('current assignment', stale['admission']['cause'])

    def test_inbox_emits_full_body_and_records_cli_read(self):
        body = 'Complete inbox body.\nSecond line.'
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('inbox-body','coordinator','worker','guidance',?)",
                        (body,))
        output = self.invoke_all('inbox', self.path, 'worker')
        item = next(row for row in output if row['id'] == 'inbox-body')
        self.assertEqual(item['body'], body)
        self.assertEqual(self.db.execute("SELECT attempt,message,recipient,native,identity FROM message_reads WHERE message='inbox-body'").fetchall(),
                         [('cli', 'inbox-body', 'worker', '', 'cli')])
        self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='inbox-body'").fetchone()[0])

    def test_pending_emits_full_body_and_records_cli_read(self):
        body = 'Complete pending body.\nSecond line.'
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('pending-body','coordinator','worker','guidance',?)",
                        (body,))
        env = os.environ.copy()
        env['BATON_SESSION'] = 'worker'
        output = self.invoke_all('pending', self.path, env=env)
        item = next(row for row in output if row['id'] == 'pending-body')
        self.assertEqual(item['body'], body)
        self.assertEqual(self.db.execute("SELECT attempt,message,recipient,native,identity FROM message_reads WHERE message='pending-body'").fetchall(),
                         [('cli', 'pending-body', 'worker', '', 'cli')])
        self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='pending-body'").fetchone()[0])


if __name__ == '__main__':
    unittest.main()
