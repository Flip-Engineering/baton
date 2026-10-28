"""Claude hooks enforce completion and inject input during tool work (#1054).

The fixture runs the installed hook commands against SQLite databases and fake
Claude processes. BATON2_STOP_HOOK_FIXTURE names the queue-built native entry.
"""
import json
import hashlib
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SEED = """
INSERT INTO sessions(id,parent,harness) VALUES('coordinator',NULL,'operator'),('worker','coordinator','claude-code');
INSERT INTO session_roles(session,role) VALUES('coordinator','conductor'),('worker','player');
INSERT INTO messages(id,sender,recipient,kind,body) VALUES('dispatch:assignment','coordinator','worker','task','Do the work.');
INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','dispatch:assignment','worker','','fixture');
"""
# The fake agent ignores repeated completion reminders, then requests completion.
HONOURING = r'''import json, os, sqlite3, subprocess, sys
args = sys.argv[1:]
settings = json.loads(args[args.index('--settings') + 1])
command = settings['hooks']['Stop'][0]['hooks'][0]['command']
log = open(sys.argv[0] + '.stops', 'a')
for active in (False, True, True):
    hook = subprocess.run(['/bin/sh', '-c', command], input=json.dumps({'hook_event_name': 'Stop', 'stop_hook_active': active}),
                          capture_output=True, text=True)
    decision = json.loads(hook.stdout) if hook.stdout.strip() else {}
    log.write(json.dumps({'active': active, 'decision': decision}) + '\n')
    log.flush()
    if active:
        with sqlite3.connect(os.environ['BATON_DATABASE']) as db:
            db.execute("INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body,receipt) VALUES('request','worker','coordinator','completion-request','Done.',NULL)")
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
        hook = subprocess.run(['/bin/sh', '-c', command], input=json.dumps({'hook_event_name': 'PostToolUse', 'tool_name': 'Bash', 'tool_response': tool}), capture_output=True, text=True)
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
        schema = subprocess.run([cls.binary, 'schema'], capture_output=True, text=True)
        if schema.returncode:
            raise AssertionError(schema.stdout + schema.stderr)
        cls.schema = schema.stdout

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name)
        self.path = str(self.home / 'orchestra.db')
        self.db = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript(self.schema + SEED)
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ('BATON_ATTEMPT_DIRECTORY', 'BATON_MCP_INPUT', 'CODEX_THREAD_ID')}
        self.env.update(BATON_SESSION='worker', BATON_DATABASE=self.path)

    def owe(self, ident='message:coordinator:mid-turn', kind='guidance', body='New detail.'):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'coordinator','worker',?,?)",
                        (ident, kind, body))

    def read(self, ident):
        self.db.execute("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture',?,'worker','','fixture')", (ident,))

    def request(self):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('message:worker:request','worker','coordinator','completion-request','Done.',NULL)")

    def hook(self, active=False, env=None):
        result = subprocess.run([self.binary, '--stop-hook'], input=json.dumps({'hook_event_name': 'Stop', 'stop_hook_active': active}),
                                capture_output=True, text=True, env=env if env is not None else self.env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_b1_input_arriving_mid_turn_is_handed_to_the_turn(self):
        self.owe()
        decision = self.hook()
        self.assertEqual(decision['decision'], 'block')
        self.assertIn('Baton holds 1 unread inputs for worker', decision['reason'])
        self.assertIn('[id: message:coordinator:mid-turn]:\nNew detail.\nUse inbox or read to record a complete read.', decision['reason'])

    def decision_sql(self):
        result = subprocess.run([self.binary, 'decision-sql'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def record(self, directory, attempt, native, identity, ident, body):
        saved = json.dumps([{'id': ident, 'recipient': 'worker', 'body': body}], ensure_ascii=False)
        result = subprocess.run([self.binary, 'record-sql', directory, attempt, native, identity, saved],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.db.executescript(result.stdout)

    def test_valid_complete_read_is_durable_and_unread_input_stays_owed(self):
        self.request()
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','attempt-1','retained','/attempt','running')")
        self.owe(kind='question', body='Complete question.')
        sql = self.decision_sql()
        unread = json.loads(self.db.execute(sql).fetchone()[0])
        self.assertEqual(unread['decision'], 'block')

        self.record('/attempt', 'attempt-1', 'native-1', 'identity-1',
                    'message:coordinator:mid-turn', 'Complete question.')
        self.assertEqual(self.db.execute(sql).fetchone()[0], '')
        self.assertEqual(self.db.execute("SELECT count(*) FROM message_reads WHERE message='message:coordinator:mid-turn'").fetchone()[0], 1)

        # A later attempt or native identity does not make a valid durable read owed again.
        self.db.execute("UPDATE sessions SET native='native-2' WHERE id='worker'")
        self.db.execute("UPDATE executions SET id='attempt-2',directory='/later' WHERE session='worker'")
        self.assertEqual(self.db.execute(sql).fetchone()[0], '')

    def test_stale_attempt_native_or_incomplete_body_cannot_record_a_read(self):
        self.request()
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','attempt-1','retained','/attempt','running')")
        self.owe(kind='question', body='Complete question.')
        for directory, attempt, native, identity, body in (
                ('/attempt', 'old-attempt', 'native-1', 'identity-1', 'Complete question.'),
                ('/attempt', 'attempt-1', 'old-native', 'identity-1', 'Complete question.'),
                ('/stale', 'attempt-1', 'native-1', 'identity-1', 'Complete question.'),
                ('/attempt', 'attempt-1', 'native-1', 'identity-1', 'Incomplete')):
            with self.subTest(directory=directory, attempt=attempt, native=native, body=body):
                self.record(directory, attempt, native, identity, 'message:coordinator:mid-turn', body)
                self.assertEqual(self.db.execute("SELECT count(*) FROM message_reads WHERE message='message:coordinator:mid-turn'").fetchone()[0], 0)
                decision = json.loads(self.db.execute(self.decision_sql()).fetchone()[0])
                self.assertEqual(decision['decision'], 'block')

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

    def arguments_command(self, event):
        settings = json.loads(self.arguments[self.arguments.index('--settings') + 1])
        return settings['hooks'][event][0]['hooks'][0]['command']

    def settings_command(self):
        return self.arguments_command('Stop')

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
                                env=dict(self.env, BATON_STOP_HOOK=self.binary))
        stops = (self.home / 'claude.py.stops')
        return result, [json.loads(line) for line in stops.read_text().splitlines()] if stops.exists() else []

    def test_claude_ignoring_two_blocks_must_request_completion(self):
        result, stops = self.fake(HONOURING)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([s['decision'].get('decision') for s in stops], ['block', 'block', None])

    def tool_hook(self, env=None):
        result = subprocess.run([self.binary, '--stop-hook'], input=json.dumps({'hook_event_name': 'PostToolUse', 'tool_name': 'Bash'}),
                                capture_output=True, text=True, env=env or self.env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_tool_loop_receives_complete_body_before_stop(self):
        result, _ = self.fake(TOOL_LOOP)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contexts = json.loads(result.stdout)
        self.assertEqual(contexts, [{'hookEventName': 'PostToolUse', 'additionalContext':
            'Baton input for this turn. Handle the following complete messages:\nMessage (guidance) from coordinator [id: mid-loop]:\nNew complete body.\nλ🙂\n\nThe complete input is available in this turn.'}])
        self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='mid-loop'").fetchone()[0])
        self.assertEqual(self.db.execute("SELECT message FROM message_reads ORDER BY message").fetchall(), [('dispatch:assignment',)])

    def test_tool_hook_injects_complete_bodies_in_order_without_unowned_read(self):
        body = "Quote ' \"\nλ🙂\n" + 'abcdef' * 3000 + '\nend\n'
        self.owe(body=body)
        self.owe(ident='second', kind='recovery', body='Second body.')
        context = self.tool_hook()['hookSpecificOutput']['additionalContext']
        self.assertIn(body, context)
        self.assertIn('Second body.', context)
        self.assertLess(context.index(body), context.index('Second body.'))
        self.assertNotIn('baton read', context)
        self.assertEqual(self.db.execute("SELECT body FROM messages WHERE id='message:coordinator:mid-turn'").fetchone()[0], body)
        self.assertEqual(self.db.execute("SELECT message FROM message_reads ORDER BY message").fetchall(), [('dispatch:assignment',)])

    def test_admitted_tool_loop_records_a_read_only_after_supported_read(self):
        directory = self.home / 'attempt'
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','attempt-1','retained',?,'running')", (str(directory),))
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
    result = subprocess.run(['/bin/sh','-c',command], input=json.dumps({'hook_event_name':'PostToolUse','tool_name':'Bash'}), env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    results.append(json.loads(result.stdout) if result.stdout.strip() else None)
    if tool == 'second':
        with sqlite3.connect(config['db']) as db:
            assert db.execute("SELECT count(*) FROM message_reads WHERE message='admitted-message'").fetchone()[0] == 1
print(json.dumps(results), flush=True)
''')
        config = json.dumps({'db': self.path, 'directory': str(directory), 'command': self.settings_command()})
        env = dict(self.env, BATON_STOP_HOOK=self.binary)
        try:
            result = subprocess.run([self.binary, 'admit', self.path, str(directory), str(self.home),
                'python3', '-I', str(script), config], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            outputs = result.stdout.splitlines()
            self.assertEqual(outputs[-1], 'exit 0', result.stdout + result.stderr)
            first, second, third = json.loads(outputs[0])
            self.assertIsNone(first)
            self.assertIn('Admitted full body.', second['hookSpecificOutput']['additionalContext'])
            self.assertIsNone(third)
            rows = self.db.execute("SELECT attempt,message,recipient,native,identity,handled FROM message_reads WHERE message='admitted-message'").fetchall()
            self.assertEqual([row[:4] for row in rows], [('attempt-1','admitted-message','worker','native-1')])
            self.assertTrue(rows[0][4])
            self.assertIsNone(rows[0][5])
            self.assertIsNone(self.db.execute("SELECT receipt FROM messages WHERE id='admitted-message'").fetchone()[0])
        finally:
            subprocess.run([self.binary, 'shutdown', self.path], env=env, capture_output=True, text=True)

    REVIEW = ("Review the work against coordinator's assignment and the supplied evidence. "
              "Confirm with completion-confirmed --to coordinator when the assignment is satisfied. "
              "Otherwise use guide --to coordinator --text TEXT to state what is missing and direct the remaining work.")

    def test_tool_hook_gives_a_completion_request_with_the_review_instruction(self):
        self.owe(ident='message:coordinator:request', kind='completion-request', body='Evidence: tests pass.\nλ🙂')
        context = self.tool_hook()['hookSpecificOutput']['additionalContext']
        self.assertEqual(context, 'Baton input for this turn. Handle the following complete messages:\n'
            'Message (completion-request) from coordinator [id: message:coordinator:request]:\nEvidence: tests pass.\nλ🙂\n'
            + self.REVIEW + '\nThe complete input is available in this turn.')

    def test_stop_block_gives_a_completion_request_with_the_review_instruction(self):
        self.owe(ident='message:coordinator:request', kind='completion-request', body='Evidence: tests pass.')
        reason = self.hook()['reason']
        self.assertIn('[id: message:coordinator:request]:\nEvidence: tests pass.\n' + self.REVIEW + '\nUse inbox or read to record a complete read.', reason)

    def test_other_input_kinds_carry_no_review_instruction(self):
        for kind in ('guidance', 'report', 'question', 'task', 'completion-confirmed'):
            self.owe(ident='message:coordinator:' + kind, kind=kind, body='Body of ' + kind + '.')
        context = self.tool_hook()['hookSpecificOutput']['additionalContext']
        self.assertNotIn('Review the work', context)
        self.assertNotIn('Review the work', self.hook()['reason'])

    def prompt(self, session='worker'):
        cursor = self.db.execute('SELECT coalesce(max(seq),0) FROM messages').fetchone()[0]
        result = subprocess.run([self.binary, 'prompt-selection-sql', session, str(cursor)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(self.db.execute(result.stdout).fetchone()[0])

    def test_turn_start_prompt_carries_the_complete_request_and_review_instruction(self):
        self.owe(ident='message:coordinator:request', kind='completion-request', body='Evidence: tests pass.\nλ🙂')
        self.owe(ident='message:coordinator:note', kind='report', body='Progress.')
        selection = self.prompt()
        self.assertEqual(selection['ids'], ['message:coordinator:request', 'message:coordinator:note'])
        self.assertEqual(selection['text'].split('\n\n')[0],
            'Message (completion-request) from coordinator [id: message:coordinator:request]:\nEvidence: tests pass.\nλ🙂\n' + self.REVIEW)
        self.assertIn('Message (report) from coordinator [id: message:coordinator:note] retained 9 bytes; read the complete body with baton read message:coordinator:note.', selection['text'])

    def test_turn_start_prompt_for_a_dsh_conductor_carries_the_review_instruction(self):
        self.db.execute("UPDATE sessions SET harness='dsh' WHERE id='worker'")
        self.owe(ident='message:coordinator:request', kind='completion-request', body='Evidence: tests pass.')
        self.owe(ident='message:coordinator:note', kind='report', body='Progress.')
        text = self.prompt()['text']
        self.assertIn('[id: message:coordinator:request]:\nEvidence: tests pass.\n' + self.REVIEW, text)
        self.assertIn('[id: message:coordinator:note]:\nProgress.', text)

    def test_turn_start_request_body_and_review_for_each_harness(self):
        self.db.execute("UPDATE session_roles SET role='conductor' WHERE session='worker'")
        body = 'Evidence with paragraphs.\n\n' + 'Complete λ🙂 evidence.\n' * 5000 + 'REQUEST-BODY-END'
        self.owe(ident='message:coordinator:request', kind='completion-request', body=body)
        for harness in ('claude-code', 'codex', 'omp', 'muse', 'dsh', 'antigravity'):
            with self.subTest(harness=harness):
                self.db.execute("UPDATE sessions SET harness=? WHERE id='worker'", (harness,))
                text = self.prompt()['text']
                self.assertIn('[id: message:coordinator:request]:\n' + body + '\n' + self.REVIEW, text)

    def test_complete_prompt_with_the_review_instruction_still_records_the_read(self):
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','attempt-1','retained','/attempt','running')")
        self.owe(ident='message:coordinator:request', kind='completion-request', body='Evidence: tests pass.')
        selection = self.prompt()
        cursor = self.db.execute('SELECT max(seq) FROM messages').fetchone()[0]
        prompt = {'session': 'worker', 'attempt': 'attempt-1', 'direct': False, 'cursor': cursor,
                  'prompt': 'Instructions.\n' + selection['text'], 'inputMessages': selection['ids']}
        result = subprocess.run([self.binary, 'prompt-record-sql', 'attempt-1', 'native-1', 'identity-1', json.dumps(prompt)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.db.executescript(result.stdout)
        self.assertEqual(self.db.execute("SELECT attempt,native FROM message_reads WHERE message='message:coordinator:request'").fetchall(),
                         [('attempt-1', 'native-1')])

    def test_stop_preview_keeps_input_owed_until_a_complete_read(self):
        directory = self.home / 'stop-attempt'
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','attempt-1','retained',?,'running')", (str(directory),))
        script = self.home / 'stopped.py'
        script.write_text(r"""import json, os, sqlite3, subprocess, sys
config = json.loads(sys.argv[1])
env = dict(os.environ, BATON_DATABASE=config['db'], BATON_SESSION='worker', BATON_ATTEMPT_DIRECTORY=config['directory'])
with sqlite3.connect(config['db']) as db:
    db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('stop-delivered','coordinator','worker','guidance','Delivered at Stop.')")
decisions = []
for _ in range(2):
    result = subprocess.run(['/bin/sh','-c',config['command']], input=json.dumps({'hook_event_name':'Stop','stop_hook_active':False}), env=env, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    decisions.append(json.loads(result.stdout))
print(json.dumps(decisions), flush=True)
""")
        config = json.dumps({'db': self.path, 'directory': str(directory),
            'command': self.arguments_command('Stop')})
        env = dict(self.env, BATON_STOP_HOOK=self.binary)
        try:
            result = subprocess.run([self.binary, 'admit', self.path, str(directory), str(self.home),
                'python3', '-I', str(script), config], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            outputs = result.stdout.splitlines()
            self.assertEqual(outputs[-1], 'exit 0', result.stdout + result.stderr)
            first, second = json.loads(outputs[0])
            self.assertIn('Delivered at Stop.', first['reason'])
            self.assertIn('Delivered at Stop.', second['reason'])
            self.assertIn('Baton holds', second['reason'])
            rows = self.db.execute("SELECT attempt,recipient,native FROM message_reads WHERE message='stop-delivered'").fetchall()
            self.assertEqual(rows, [])
        finally:
            subprocess.run([self.binary, 'shutdown', self.path], env=env, capture_output=True, text=True)

    def test_tool_hook_database_failure_keeps_tool_result_available(self):
        env = dict(self.env, BATON_DATABASE=str(self.home / 'absent' / 'bad.db'))
        self.assertIsNone(self.tool_hook(env))

    def test_tool_hook_does_nothing_for_stopped_session(self):
        self.owe()
        self.db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('worker','stop','operator request','stopped')")
        self.assertIsNone(self.tool_hook())
        self.assertIsNone(self.hook(active=True))

    def test_confirmation_and_new_assignment_derive_current_request(self):
        self.request()
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('confirm','coordinator','worker','completion-confirmed','message:worker:request',NULL)")
        self.read('confirm')
        self.assertIsNone(self.hook(active=True))
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('new-task','coordinator','worker','task','More work.',NULL)")
        self.read('new-task')
        self.assertEqual(self.hook(active=True)['decision'], 'block')

    def test_claude_ignoring_the_hook_still_ends_its_turn(self):
        self.owe()
        result, stops = self.fake(IGNORING)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(stops, [])
        self.assertIn('"type": "result"', result.stdout)


    def test_complete_read_from_a_previous_attempt_is_not_injected_again(self):
        self.owe()
        self.read('message:coordinator:mid-turn')
        self.assertIsNone(self.tool_hook())
        self.assertIn('Assignment message:coordinator:mid-turn is still open', self.hook()['reason'])

    def test_unread_input_with_legacy_receipt_stays_owed(self):
        self.owe()
        self.db.execute("UPDATE messages SET receipt='legacy-only' WHERE id='message:coordinator:mid-turn'")
        decision = self.hook()
        self.assertIn('Baton holds 1 unread inputs', decision['reason'])
        self.assertNotIn('acknowledge', decision['reason'])
        self.assertIn('New detail.', self.tool_hook()['hookSpecificOutput']['additionalContext'])

    def combined_lifecycle(self, body, label):
        ident = 'lifecycle-guidance'
        directory = self.home / 'lifecycle-attempt'
        self.db.execute("UPDATE sessions SET native='native-1' WHERE id='worker'")
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','attempt-1','retained',?,'running')", (str(directory),))
        body_path = self.home / 'lifecycle-body.txt'
        body_path.write_text(body, encoding='utf-8')
        script = self.home / 'lifecycle.py'
        script.write_text(r'''import hashlib, json, os, pathlib, sqlite3, subprocess, sys
config = json.loads(sys.argv[1])
env = dict(os.environ, BATON_DATABASE=config['database'], BATON_SESSION='worker', BATON_ATTEMPT_DIRECTORY=config['directory'])
def invoke(name, args, data=None):
    result = subprocess.run(args, input=data, env=env, capture_output=True, text=True)
    if config['evidence']:
        path = pathlib.Path(config['evidence']) / config['label']
        path.mkdir(parents=True, exist_ok=True)
        (path / (name + '.json')).write_text(json.dumps({'argv':args,'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr}, indent=2) + '\n')
    assert result.returncode == 0, result.stdout + result.stderr
    return result
def reads():
    with sqlite3.connect(config['database']) as db:
        return db.execute('SELECT attempt,recipient,native,identity,handled FROM message_reads WHERE message=?', (config['id'],)).fetchall()
with sqlite3.connect(config['database']) as db:
    assert db.execute("SELECT phase FROM executions WHERE session='worker' AND id='attempt-1'").fetchone() == ('running',)
    assert db.execute('SELECT count(*) FROM messages WHERE id=?', (config['id'],)).fetchone()[0] == 0
    db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'coordinator','worker','guidance',?)",
               (config['id'], pathlib.Path(config['bodyPath']).read_text(encoding='utf-8')))
hook = invoke('injected-input', [config['binary'],'--stop-hook'], json.dumps({'hook_event_name':'PostToolUse','tool_name':'Bash'}))
context = json.loads(hook.stdout)['hookSpecificOutput']['additionalContext']
assert config['tail'] in context
assert 'baton read ' + config['id'] not in context
rows = reads()
assert len(rows) == 1 and rows[0][:3] == ('attempt-1','worker','native-1') and rows[0][3] and rows[0][4] is None
before = invoke('stop-after-injection', [config['binary'],'--stop-hook'], json.dumps({'hook_event_name':'Stop','stop_hook_active':True}))
assert json.loads(before.stdout)['decision'] == 'block'
assert 'Baton holds 1 unread inputs' not in json.loads(before.stdout)['reason']
after = invoke('post-injection', [config['binary'],'--stop-hook'], json.dumps({'hook_event_name':'PostToolUse','tool_name':'Bash'}))
assert after.stdout.strip() == ''
request = invoke('completion-request', [config['binary'],'completion-request',config['database'],'Read the complete input and finished the work.'])
admitted = json.loads(request.stdout)[0]
assert admitted['admission']['status'] == 'admitted', admitted
stop = invoke('stop-after-request', [config['binary'],'--stop-hook'], json.dumps({'hook_event_name':'Stop','stop_hook_active':True}))
assert stop.stdout.strip() == ''
evidence = {'fullBodyInjectedAndRecorded':True,'guidanceProcess':os.getpid(),'completeReadSha256':config['sha256'],'tail':config['tail'],'requestId':admitted['id'],'requestWake':admitted['wake'],'stopAllowed':True,'nativeRead':rows[0][:4]}
print(json.dumps({'type':'result','subtype':'success','is_error':False,'session_id':'native-1','result':json.dumps(evidence)}), flush=True)
''')
        tail = 'TAIL-READ-PROOF-' + label
        self.assertTrue(body.endswith(tail))
        config = {'database': self.path, 'directory': str(directory), 'binary': self.binary,
                  'id': ident, 'bodyPath': str(body_path), 'sha256': hashlib.sha256(body.encode()).hexdigest(),
                  'tail': tail, 'label': label, 'evidence': os.environ.get('BATON2_HOOK_EVIDENCE', '')}
        env = dict(self.env, BATON_STOP_HOOK=self.binary)
        try:
            result = subprocess.run([self.binary, 'lifecycle', self.path, str(directory), str(self.home),
                'python3', '-I', str(script), json.dumps(config)], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            lines = result.stdout.splitlines()
            self.assertTrue(lines, result.stderr)
            self.assertEqual(lines[-1], 'exit 0', result.stdout + result.stderr)
            event = json.loads(lines[0])
            evidence = json.loads(event['result'])
            self.assertEqual(evidence['completeReadSha256'], config['sha256'])
            self.assertEqual(evidence['tail'], tail)
            self.assertTrue(evidence['stopAllowed'])
            self.assertEqual(self.db.execute("SELECT phase,status FROM executions WHERE id='attempt-1'").fetchone(), ('exited','exit 0'))
            self.assertEqual(self.db.execute("SELECT recipient,kind FROM messages WHERE id=?", (evidence['requestId'],)).fetchone(), ('coordinator','completion-request'))
            self.assertEqual(self.db.execute("SELECT count(*) FROM turns WHERE id='attempt-1'").fetchone()[0], 1)
            self.assertEqual(self.db.execute('SELECT attempt,recipient,native,identity,handled FROM message_reads WHERE message=?',
                (ident,)).fetchall(), [tuple(evidence['nativeRead']) + (None,)])
            self.assertEqual(self.db.execute('SELECT body FROM messages WHERE id=?', (ident,)).fetchone()[0], body)
            self.assertIsNone(self.db.execute('SELECT receipt FROM messages WHERE id=?', (ident,)).fetchone()[0])
            self.assertEqual(self.db.execute("SELECT count(*) FROM messages m WHERE m.recipient='worker' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").fetchone()[0], 0)
            self.assertEqual(self.db.execute("SELECT count(*) FROM messages WHERE recipient='worker' AND kind='completion-confirmed'").fetchone()[0], 0)
            self.assertIsNone(self.hook(active=True))
            self.owe(ident='unread-after-exit', body='Input committed after the native exit.')
            self.assertEqual(self.db.execute("SELECT m.id FROM messages m WHERE m.recipient='worker' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").fetchall(), [('unread-after-exit',)])
            self.assertIn('Baton holds 1 unread inputs', self.hook(active=True)['reason'])
        finally:
            subprocess.run([self.binary, 'shutdown', self.path], env=env, capture_output=True, text=True)

    def test_injected_read_completion_stop_and_ended_attempt(self):
        self.combined_lifecycle('Complete short body.\nTAIL-READ-PROOF-short', 'short')

    def test_large_body_injected_read_completion_stop_and_ended_attempt(self):
        self.combined_lifecycle('Large complete body λ🙂.\n' * 25000 + 'TAIL-READ-PROOF-large', 'large')


if __name__ == '__main__':
    unittest.main()
