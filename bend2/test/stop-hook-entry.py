"""Claude hooks enforce completion and inject input during tool work (#1054).

The fixture runs the installed hook commands against SQLite databases and fake
Claude processes. BATON2_STOP_HOOK_FIXTURE names the queue-built native entry.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMA = '''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL DEFAULT 'claude-code', native TEXT NOT NULL DEFAULT '');
CREATE TABLE session_roles (session TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
CREATE TABLE executions (session TEXT PRIMARY KEY, id TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL);
CREATE TABLE message_reads(attempt TEXT NOT NULL, message TEXT NOT NULL, recipient TEXT NOT NULL, native TEXT NOT NULL, identity TEXT NOT NULL, handled TEXT, PRIMARY KEY(attempt,identity,message));
INSERT INTO sessions(id,parent) VALUES('coordinator',NULL),('worker','coordinator');
INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('dispatch:assignment','coordinator','worker','task','Do the work.','native-turn:receive:worker:1:aa');
'''
# The fake agent ignores repeated completion reminders, then requests completion.
HONOURING = r'''import json, os, sqlite3, subprocess, sys
args = sys.argv[1:]
settings = json.loads(args[args.index('--settings') + 1])
command = settings['hooks']['Stop'][0]['hooks'][0]['command']
log = open(sys.argv[0] + '.stops', 'a')
for active in (False, True, True):
    hook = subprocess.run(['/bin/sh', '-c', command], input=json.dumps({'hook_event_name': 'Stop', 'stop_hook_active': active}),
                          capture_output=True, text=True, timeout=120)
    decision = json.loads(hook.stdout) if hook.stdout.strip() else {}
    log.write(json.dumps({'active': active, 'decision': decision}) + '\n')
    log.flush()
    if active:
        with sqlite3.connect(os.environ['BATON_DATABASE']) as db:
            db.execute("INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body,receipt) VALUES('request','worker','coordinator','completion-request','Done.','read')")
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'done'}))
'''
# One successful tool finishes, new input commits, and another tool finishes.
TOOL_LOOP = r'''import json, os, sqlite3, subprocess, sys
args = sys.argv[1:]
settings = json.loads(args[args.index('--settings') + 1])
commands = [h['command'] for group in settings['hooks'].get('PostToolUse', []) for h in group['hooks']]
contexts = []
for tool in ('first', 'second'):
    if tool == 'second':
        with sqlite3.connect(os.environ['BATON_DATABASE']) as db:
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('mid-loop','coordinator','worker','guidance',?)", ('New complete body.\nλ🙂\n',))
    for command in commands:
        hook = subprocess.run(['/bin/sh', '-c', command], input=json.dumps({'hook_event_name': 'PostToolUse', 'tool_name': 'Bash', 'tool_response': tool}), capture_output=True, text=True, timeout=120)
        if hook.returncode:
            raise RuntimeError(hook.stderr)
        if hook.stdout.strip():
            contexts.append(json.loads(hook.stdout)['hookSpecificOutput'])
print(json.dumps(contexts))
'''
IGNORING = r'''import json, sys
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'done'}))
'''


def fixture():
    binary = os.environ.get('BATON2_STOP_HOOK_FIXTURE')
    if binary:
        return binary
    raise AssertionError('Set BATON2_STOP_HOOK_FIXTURE to the queue-built fixture.')


class StopHook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = fixture()
        listed = subprocess.run([cls.binary, 'arguments'], capture_output=True, text=True)
        if listed.returncode:
            raise AssertionError(listed.stdout + listed.stderr)
        cls.arguments = listed.stdout.splitlines()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name)
        self.path = str(self.home / 'orchestra.db')
        self.db = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA)
        self.env = dict(os.environ, BATON_SESSION='worker', BATON_DATABASE=self.path)

    def owe(self, ident='message:coordinator:mid-turn', kind='guidance', body='New detail.'):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'coordinator','worker',?,?)",
                        (ident, kind, body))

    def request(self):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('message:worker:request','worker','coordinator','completion-request','Done.','read')")

    def hook(self, active=False, env=None):
        result = subprocess.run([self.binary, '--stop-hook'], input=json.dumps({'hook_event_name': 'Stop', 'stop_hook_active': active}),
                                capture_output=True, text=True, env=env if env is not None else self.env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_b1_input_arriving_mid_turn_is_handed_to_the_turn(self):
        self.owe()
        decision = self.hook()
        self.assertEqual(decision['decision'], 'block')
        self.assertIn('Baton holds 1 owed inputs for worker', decision['reason'])
        self.assertIn('[id: message:coordinator:mid-turn]:\nNew detail.', decision['reason'])

    def test_stop_hook_active_keeps_blocking_owed_input(self):
        self.owe()
        self.assertEqual(self.hook(active=True)['decision'], 'block')

    def test_stop_hook_active_keeps_blocking_open_assignment(self):
        self.assertEqual(self.hook()['decision'], 'block')
        self.assertEqual(self.hook(active=True)['decision'], 'block')

    def test_open_assignment_without_request_is_named(self):
        decision = self.hook()
        self.assertEqual(decision['decision'], 'block')
        self.assertIn('Assignment dispatch:assignment is still open', decision['reason'])
        self.assertIn('completion-request --text SUMMARY', decision['reason'])

    def test_completion_request_lets_the_turn_end(self):
        self.request()
        self.assertIsNone(self.hook())

    def test_without_the_launch_environment_the_hook_does_nothing(self):
        self.owe()
        env = {k: v for k, v in os.environ.items() if k not in ('BATON_SESSION', 'BATON_DATABASE')}
        self.assertIsNone(self.hook(env=env))

    def settings_command(self):
        settings = json.loads(self.arguments[self.arguments.index('--settings') + 1])
        return settings['hooks']['Stop'][0]['hooks'][0]['command']

    def test_launch_arguments_name_the_stop_hook(self):
        self.assertEqual(self.arguments[0], 'claude')
        self.assertIn('--input-format', self.arguments)
        command = self.settings_command()
        quiet = subprocess.run(['/bin/sh', '-c', command], input='{}', capture_output=True, text=True,
                               env={k: v for k, v in self.env.items() if k != 'BATON_STOP_HOOK'})
        self.assertEqual((quiet.returncode, quiet.stdout), (0, ''))
        self.owe()
        wired = subprocess.run(['/bin/sh', '-c', command], input=json.dumps({'stop_hook_active': False}),
                               capture_output=True, text=True, env=dict(self.env, BATON_STOP_HOOK=self.binary))
        self.assertEqual(wired.returncode, 0, wired.stderr)
        self.assertEqual(json.loads(wired.stdout)['decision'], 'block')

    def fake(self, source):
        script = self.home / 'claude.py'
        script.write_text(source)
        result = subprocess.run(['python3', '-I', str(script)] + self.arguments[1:], capture_output=True, text=True,
                                env=dict(self.env, BATON_STOP_HOOK=self.binary), timeout=300)
        stops = (self.home / 'claude.py.stops')
        return result, [json.loads(line) for line in stops.read_text().splitlines()] if stops.exists() else []

    def test_claude_ignoring_two_blocks_must_request_completion(self):
        result, stops = self.fake(HONOURING)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([s['decision'].get('decision') for s in stops], ['block', 'block', None])

    def tool_hook(self, env=None):
        result = subprocess.run([self.binary, '--stop-hook'], input=json.dumps({'hook_event_name': 'PostToolUse', 'tool_name': 'Bash'}),
                                capture_output=True, text=True, env=env or self.env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_tool_loop_receives_new_body_before_stop(self):
        result, _ = self.fake(TOOL_LOOP)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contexts = json.loads(result.stdout)
        self.assertEqual(contexts, [{'hookEventName': 'PostToolUse', 'additionalContext':
            'Baton input for this turn. Handle the following complete messages:\nMessage (guidance) from coordinator [id: mid-loop]:\nNew complete body.\nλ🙂\n'}])
        self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='mid-loop'").fetchone()[0])
        self.assertEqual(self.db.execute('SELECT * FROM message_reads').fetchall(), [])

    def test_tool_hook_preserves_complete_bodies_and_order(self):
        body = "Quote ' \"\nλ🙂\n" + 'abcdef' * 3000 + '\nend\n'
        self.owe(body=body)
        self.owe(ident='second', kind='recovery', body='Second body.')
        context = self.tool_hook()['hookSpecificOutput']['additionalContext']
        self.assertIn(body, context)
        self.assertLess(context.index(body), context.index('Second body.'))
        self.assertEqual(self.db.execute('SELECT * FROM message_reads').fetchall(), [])

    def test_injected_reads_settle_only_with_the_owned_successful_turn(self):
        statements = subprocess.run([self.binary, 'state-statements'], capture_output=True, text=True)
        self.assertEqual(statements.returncode, 0, statements.stderr)
        selection, record, settle = statements.stdout.splitlines()
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions VALUES('worker','receive:worker:100:feed','/attempt','running')")
        self.owe(body='Exact full body.\nλ🙂\n')
        saved = self.db.execute(selection).fetchone()[0]
        self.assertEqual(json.loads(saved)[0]['body'], 'Exact full body.\nλ🙂\n')
        self.db.executescript(record.replace("'@INPUT@'", "'" + saved.replace("'", "''") + "'"))
        self.assertEqual(json.loads(self.db.execute(selection).fetchone()[0]), [])
        self.assertIsNone(self.db.execute('SELECT handled FROM message_reads').fetchone()[0])
        self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='message:coordinator:mid-turn'").fetchone()[0])
        self.db.executescript(settle)
        self.assertEqual(self.db.execute('SELECT handled FROM message_reads').fetchone()[0], 'native-turn:receive:worker:100:feed')
        self.assertEqual(self.db.execute("SELECT receipt FROM messages WHERE id='message:coordinator:mid-turn'").fetchone()[0], 'native-turn:receive:worker:100:feed')

    def test_admitted_tool_loop_records_reads_without_handling(self):
        directory = self.home / 'attempt'
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions VALUES('worker','attempt-1',?,'running')", (str(directory),))
        script = self.home / 'admitted.py'
        script.write_text(r'''import json, os, sqlite3, subprocess, sys
config = json.loads(sys.argv[1])
env = dict(os.environ, BATON_DATABASE=config['db'], BATON_SESSION='worker', BATON_ATTEMPT_DIRECTORY=config['directory'])
command = config['command']
results = []
for tool in ('first', 'second', 'third'):
    if tool == 'second':
        with sqlite3.connect(config['db']) as db:
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('admitted-message','coordinator','worker','guidance','Admitted full body.')")
    result = subprocess.run(['/bin/sh','-c',command], input=json.dumps({'hook_event_name':'PostToolUse','tool_name':'Bash'}), env=env, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr)
    results.append(json.loads(result.stdout) if result.stdout.strip() else None)
print(json.dumps(results), flush=True)
''')
        config = json.dumps({'db': self.path, 'directory': str(directory), 'command': self.settings_command()})
        env = dict(self.env, BATON_STOP_HOOK=self.binary)
        try:
            result = subprocess.run([self.binary, 'admit', self.path, str(directory), str(self.home),
                'python3', '-I', str(script), config], env=env, capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            outputs = result.stdout.splitlines()
            self.assertEqual(outputs[-1], 'exit 0')
            first, second, third = json.loads(outputs[0])
            self.assertIsNone(first)
            self.assertIn('Admitted full body.', second['hookSpecificOutput']['additionalContext'])
            self.assertIsNone(third)
            rows = self.db.execute("SELECT attempt,message,recipient,native,identity,handled FROM message_reads").fetchall()
            self.assertEqual([row[:4] for row in rows], [('attempt-1','admitted-message','worker','native-1')])
            self.assertTrue(rows[0][4])
            self.assertIsNone(rows[0][5])
            self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='admitted-message'").fetchone()[0])
        finally:
            subprocess.run([self.binary, 'shutdown', self.path], env=env, capture_output=True, text=True, timeout=30)

    def test_tool_hook_database_failure_keeps_tool_result_available(self):
        env = dict(self.env, BATON_DATABASE=str(self.home / 'absent' / 'bad.db'))
        self.assertIsNone(self.tool_hook(env))

    def test_tool_hook_does_nothing_for_stopped_session(self):
        self.owe()
        self.db.execute("INSERT INTO session_stops VALUES('worker','stop','operator request','stopped')")
        self.assertIsNone(self.tool_hook())
        self.assertIsNone(self.hook(active=True))

    def test_confirmation_and_new_assignment_derive_current_request(self):
        self.request()
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('confirm','coordinator','worker','completion-confirmed','message:worker:request','read')")
        self.assertIsNone(self.hook(active=True))
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('new-task','coordinator','worker','task','More work.','read')")
        self.assertEqual(self.hook(active=True)['decision'], 'block')

    def test_claude_ignoring_the_hook_still_ends_its_turn(self):
        self.owe()
        result, stops = self.fake(IGNORING)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(stops, [])
        self.assertIn('"type": "result"', result.stdout)


if __name__ == '__main__':
    unittest.main()
