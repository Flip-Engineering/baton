"""Exercise installed native hook routes, complete reads and turn settlement.

BATON2_NATIVE_DELIVERY_PREFIX selects the staged production installation.
The harness and database belong to this test. No provider is contacted.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest


NATIVE = '019a174b-1234-7123-8123-123456789abc'
AGENT = r'''import hashlib, json, os, pathlib, sqlite3, subprocess, sys
config = json.loads(pathlib.Path(sys.argv[0]).with_suffix('.json').read_text())
arguments = sys.argv[1:]
settings = json.loads(arguments[arguments.index('--settings') + 1])
initial = json.loads(sys.stdin.readline())
assert initial['type'] == 'user'
print(json.dumps({'type':'system','subtype':'init','session_id':config['native']}), flush=True)
database = os.environ['BATON_DATABASE']
def query(sql, args=()):
    with sqlite3.connect(database) as db:
        return db.execute(sql, args).fetchall()
def invoke(argv, data=None):
    result = subprocess.run(argv, input=data, capture_output=True, text=True)
    assert result.returncode == 0, (argv, result.stdout, result.stderr)
    return result.stdout
def hook(event, active=False):
    command = settings['hooks'][event][0]['hooks'][0]['command']
    return invoke(['/bin/sh','-c',command], json.dumps({'hook_event_name':event,'stop_hook_active':active,'tool_name':'Bash'}))
def read_rows():
    return query('SELECT attempt,recipient,native,identity,handled FROM message_reads WHERE message=?', ('during-turn',))
body = pathlib.Path(config['body']).read_text()
for message, in query("SELECT id FROM messages WHERE recipient='worker'"):
    invoke([config['full'],database,'as','worker','read',message])
with sqlite3.connect(database) as db:
    assert db.execute("SELECT phase FROM executions WHERE session='worker'").fetchone() == ('running',)
    db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('during-turn','parent','worker','guidance',?)", (body,))
pointer = json.loads(hook('PostToolUse'))['hookSpecificOutput']['additionalContext']
assert 'baton read during-turn' in pointer
assert config['tail'] not in pointer
assert read_rows() == []
for active in (False, True):
    assert json.loads(hook('Stop',active))['decision'] == 'block'
read = json.loads(invoke([config['full'],database,'as','worker','read','during-turn']))
assert read[0]['delivery']['body'] == body
rows = read_rows()
assert len(rows) == 1 and rows[0][1:3] == ('worker',config['native']) and rows[0][3]
assert rows[0][4] is None
assert hook('PostToolUse').strip() == ''
assert json.loads(hook('Stop',True))['decision'] == 'block'
request = json.loads(invoke([config['full'],database,'as','worker','completion-request','--text','Read the complete input and finished the assignment.']))
assert request[0]['admission']['status'] == 'admitted', request
assert hook('Stop',True).strip() == ''
evidence = {'read':rows[0], 'request':request[0]['id'], 'bodySha256':hashlib.sha256(body.encode()).hexdigest()}
pathlib.Path(config['evidence']).write_text(json.dumps(evidence))
print(json.dumps({'type':'result','subtype':'success','is_error':False,'session_id':config['native'],'result':'Complete input read and completion requested.'}), flush=True)
'''


class NativeHookLifecycle(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='native-hook-lifecycle-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.prefix = self.directory / 'prefix'
        retained = Path(os.environ['BATON2_NATIVE_DELIVERY_PREFIX'])
        shutil.copytree(retained / 'bin', self.prefix / 'bin')
        shutil.copytree(retained / 'libexec', self.prefix / 'libexec', symlinks=True)
        self.full = self.prefix / 'bin/baton-full'
        self.focused = self.prefix / 'bin/baton'
        self.database = self.directory / 'fixture.sqlite'
        self.environment = {key: value for key, value in os.environ.items()
                            if not key.startswith('BATON') and key != 'CODEX_THREAD_ID'}
        self.environment.update(HOME=str(self.directory / 'home'),
                                XDG_RUNTIME_DIR=str(self.directory / 'runtime'))
        Path(self.environment['XDG_RUNTIME_DIR']).mkdir(mode=0o700)
        self.addCleanup(self.shutdown)
        self.cli('attach', 'parent', 'operator', '', '')
        self.cli('role', 'parent', 'conductor')
        self.cli('attach', 'worker', 'claude-code', NATIVE, '')
        self.cli('role', 'worker', 'player')
        with sqlite3.connect(self.database) as database:
            database.execute("UPDATE sessions SET parent='parent' WHERE id='worker'")

    def cli(self, *arguments):
        result = subprocess.run([str(self.full), str(self.database), *map(str, arguments)],
                                env=self.environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def shutdown(self):
        result = subprocess.run([str(self.focused), '--instance-shutdown', str(self.database)],
                                env=self.environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def lifecycle(self, body):
        agent = self.directory / 'fake-claude'
        agent.write_text('#!' + sys.executable + '\n' + AGENT)
        agent.chmod(0o755)
        body_path = self.directory / 'body.txt'
        body_path.write_text(body)
        evidence_path = self.directory / 'evidence.json'
        config = {'native': NATIVE, 'full': str(self.full), 'body': str(body_path),
                  'tail': 'COMPLETE-TAIL', 'evidence': str(evidence_path)}
        agent.with_suffix('.json').write_text(json.dumps(config))
        self.cli('turn-text', 'worker', 'lifecycle', agent, 'fixture-model', 'high',
                 self.directory, 'Complete the assignment and read new input.',
                 self.directory / 'native.jsonl', NATIVE)
        evidence = json.loads(evidence_path.read_text())
        self.assertEqual(evidence['bodySha256'], hashlib.sha256(body.encode()).hexdigest())
        with sqlite3.connect(self.database) as database:
            self.assertEqual(database.execute("SELECT phase,status FROM executions WHERE session='worker'").fetchall(),
                             [('exited', 'exit 0')])
            self.assertEqual(database.execute("SELECT count(*) FROM turns WHERE worker='worker'").fetchone(), (1,))
            self.assertEqual(database.execute("SELECT recipient,kind FROM messages WHERE id=?", (evidence['request'],)).fetchone(),
                             ('parent', 'completion-request'))
            self.assertEqual(database.execute("SELECT body,receipt FROM messages WHERE id='during-turn'").fetchone(), (body, None))
            self.assertEqual(database.execute("SELECT attempt,recipient,native,identity,handled FROM message_reads WHERE message='during-turn'").fetchall(),
                             [tuple(evidence['read'])])
            self.assertEqual(database.execute("SELECT id FROM messages WHERE recipient='worker' AND kind='completion-confirmed'").fetchall(), [])
            self.assertEqual(database.execute("SELECT m.id FROM messages m WHERE m.recipient='worker' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").fetchall(), [])

    def test_complete_read_request_stop_and_turn_settlement(self):
        self.lifecycle('Input committed during the native turn. λ🙂\nCOMPLETE-TAIL')

    def test_large_complete_read_request_stop_and_turn_settlement(self):
        self.lifecycle('Complete retained input. λ🙂\n' * 100000 + 'COMPLETE-TAIL')

    def test_explicit_stop_preserves_unread_input(self):
        with sqlite3.connect(self.database) as database:
            database.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('unread','parent','worker','guidance','Retain this input.')")
            database.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('worker','stop','Operator stop.','stopped')")
        environment = {**self.environment, 'BATON_DATABASE': str(self.database), 'BATON_SESSION': 'worker'}
        for event in ('PostToolUse', 'Stop'):
            result = subprocess.run([str(self.full), '--stop-hook'], env=environment,
                                    input=json.dumps({'hook_event_name': event, 'stop_hook_active': True}),
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), '')
        with sqlite3.connect(self.database) as database:
            self.assertEqual(database.execute("SELECT id,body,receipt FROM messages WHERE id='unread'").fetchall(), [('unread', 'Retain this input.', None)])
            self.assertEqual(database.execute("SELECT message FROM message_reads WHERE message='unread'").fetchall(), [])
            self.assertEqual(database.execute("SELECT id FROM session_stops WHERE session='worker'").fetchall(), [('stop',)])


if __name__ == '__main__':
    unittest.main()
