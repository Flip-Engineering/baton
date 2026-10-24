"""The Claude Code Stop hook gives a running turn its owed input (#1054, B1).

During turn receive:compiler-crash-1017-opus-20261022:246199, coordinator
guidance 030aa2fbe8e4f667f... arrived at 01:22:52Z. Claude Code turns get one
input frame and their stdin closes, so the message reached the agent only
because the agent ran 'baton inbox'. Baton now launches Claude Code with a
Stop hook that runs 'baton --stop-hook': owed input is handed to the same
turn, and an open assignment without a completion request is named. When
Claude Code reports stop_hook_active the hook allows the stop.

These checks run the hook entry against fixture databases, run the hook
command from the generated Claude arguments, and drive two fake Claude
processes: one that honours Stop hooks the way Claude Code does, and one that
ignores them.

BATON2_STOP_HOOK_FIXTURE names a built bend2/test/stop-hook-entry binary;
otherwise the test builds it with bend2/scripts/build-native.sh.
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
SCHEMA = '''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL DEFAULT 'claude-code');
CREATE TABLE session_roles (session TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
INSERT INTO sessions(id,parent) VALUES('coordinator',NULL),('worker','coordinator');
INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('dispatch:assignment','coordinator','worker','task','Do the work.','native-turn:receive:worker:1:aa');
'''
# A fake Claude Code that ends its turn the way Claude Code does: it runs each
# Stop hook command with the hook input on stdin; a block decision continues
# the turn with the reason as input, and the next stop reports
# stop_hook_active. The agent never reads its inbox. Each stop is recorded.
HONOURING = r'''import json, subprocess, sys
args = sys.argv[1:]
settings = json.loads(args[args.index('--settings') + 1])
command = settings['hooks']['Stop'][0]['hooks'][0]['command']
log = open(sys.argv[0] + '.stops', 'a')
active = False
while True:
    hook = subprocess.run(['/bin/sh', '-c', command], input=json.dumps({'hook_event_name': 'Stop', 'stop_hook_active': active}),
                          capture_output=True, text=True, timeout=120)
    decision = json.loads(hook.stdout) if hook.stdout.strip() else {}
    log.write(json.dumps({'active': active, 'decision': decision}) + '\n')
    log.flush()
    if decision.get('decision') != 'block':
        break
    active = True
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'done'}))
'''
IGNORING = r'''import json, sys
print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False, 'result': 'done'}))
'''


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
        self.assertIn('[id: message:coordinator:mid-turn] retained 11 bytes; read the complete body with baton read message:coordinator:mid-turn.', decision['reason'])

    def test_stop_hook_active_lets_the_turn_end(self):
        self.owe()
        self.assertIsNone(self.hook(active=True))

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

    def test_claude_honouring_the_hook_ends_after_one_continuation(self):
        self.owe()
        result, stops = self.fake(HONOURING)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(stops), 2)
        self.assertEqual(stops[0]['decision']['decision'], 'block')
        self.assertEqual(stops[1], {'active': True, 'decision': {}})

    def test_claude_ignoring_the_hook_still_ends_its_turn(self):
        self.owe()
        result, stops = self.fake(IGNORING)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(stops, [])
        self.assertIn('"type": "result"', result.stdout)


if __name__ == '__main__':
    unittest.main()
