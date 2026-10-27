"""Turn-start input records a complete completion confirmation (#1054, instance D1).

consol-788-sonnet-20261022 received completion confirmation seq 246907 as a
pointer ('retained N bytes; read the complete body with baton read ID'). The
agent did not read it, so no read was recorded and the receipt stayed NULL;
every successful turn end found it owed and started another turn, ten starts
in 76 s. A completion confirmation now carries its complete body in the
prompt, so the prompt records it as read independently of the turn outcome.
These checks run the turn-start selection and prompt recording
statements against a fixture database.

BATON2_TURN_INPUT_FIXTURE names a built bend2/test/turn-input-settlement
binary; otherwise the test builds it with bend2/scripts/build-native.sh.
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
ATTEMPT = 'receive:worker:100:feed'
SCHEMA = '''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL DEFAULT 'claude-code', native TEXT NOT NULL DEFAULT '');
CREATE TABLE executions (session TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL, mode TEXT NOT NULL, directory TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT '');
CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
CREATE TABLE message_reads(attempt TEXT NOT NULL, message TEXT NOT NULL, recipient TEXT NOT NULL, native TEXT NOT NULL, identity TEXT NOT NULL, handled TEXT, PRIMARY KEY(attempt,identity,message));
CREATE TABLE wake_claims(session TEXT PRIMARY KEY,state TEXT,owner TEXT,generation INTEGER);
INSERT INTO sessions(id,parent,native) VALUES('coordinator',NULL,''),('worker','coordinator','native-1');
INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','receive:worker:100:feed','retained','/attempt','running');
'''


def statements():
    binary = os.environ.get('BATON2_TURN_INPUT_FIXTURE')
    if not binary:
        SCRATCH.mkdir(parents=True, exist_ok=True)
        binary = str(SCRATCH / 'turn-input-settlement')
        build = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                'bend2/test/turn-input-settlement.bend', binary],
                               cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True)
        if build.returncode:
            raise AssertionError(build.stdout + build.stderr)
    run = subprocess.run([binary], capture_output=True, text=True)
    if run.returncode:
        raise AssertionError(run.stdout + run.stderr)
    selection, record = run.stdout.splitlines()
    return selection, record


def quote(text):
    return "'" + text.replace("'", "''") + "'"


class TurnInputRead(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.selection, cls.record = statements()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = sqlite3.connect(str(pathlib.Path(self.temp.name) / 'orchestra.db'), isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA)

    def message(self, ident, kind, body):
        self.db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'coordinator','worker',?,?)",
                        (ident, kind, body))

    def admitted_prompt(self):
        selected = json.loads(self.db.execute(self.selection).fetchone()[0])
        prompt = 'Instructions.\n' + selected['text']
        admitted = json.dumps({'session': 'worker', 'attempt': ATTEMPT, 'cursor': '100', 'direct': False,
                               'prompt': prompt, 'inputMessages': selected['ids']})
        self.db.executescript(self.record.replace("'@INPUT@'", quote(admitted)))
        return prompt

    def receipt(self, ident):
        return self.db.execute('SELECT receipt FROM messages WHERE id=?', (ident,)).fetchone()[0]

    def owed(self):
        return self.db.execute("SELECT count(*) FROM messages m WHERE recipient='worker' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").fetchone()[0]

    def test_completion_confirmation_is_read_in_the_complete_admitted_prompt(self):
        self.message('message:coordinator:confirmed', 'completion-confirmed', 'message:worker:request')
        prompt = self.admitted_prompt()
        self.assertIn('Message (completion-confirmed) from coordinator [id: message:coordinator:confirmed]:\nmessage:worker:request', prompt)
        self.assertIsNone(self.receipt('message:coordinator:confirmed'))
        self.assertEqual(self.db.execute('SELECT attempt,message,recipient,native,identity,handled FROM message_reads').fetchall(),
                         [(ATTEMPT,'message:coordinator:confirmed','worker','native-1','identity-1',None)])
        self.assertEqual(self.owed(), 0)

    def test_task_body_stays_inline_and_is_read(self):
        self.message('dispatch:task', 'task', 'Do the work.')
        prompt = self.admitted_prompt()
        self.assertIn('Message (task) from coordinator [id: dispatch:task]:\nDo the work.', prompt)
        self.assertEqual(self.owed(), 0)

    def test_guidance_stays_a_pointer_until_the_agent_reads_it(self):
        self.message('message:coordinator:guidance', 'guidance', 'More detail.')
        prompt = self.admitted_prompt()
        self.assertIn('[id: message:coordinator:guidance] retained 12 bytes; read the complete body with baton read message:coordinator:guidance.', prompt)
        self.assertIsNone(self.receipt('message:coordinator:guidance'))
        self.assertEqual(self.owed(), 1)
        self.assertEqual(self.db.execute('SELECT * FROM message_reads').fetchall(), [])


    def test_complete_read_remains_recorded_after_provider_failure(self):
        self.message('dispatch:task', 'task', 'Do the work.')
        self.admitted_prompt()
        self.db.execute("UPDATE executions SET phase='exited',status='exit 1'")
        self.assertEqual(self.owed(), 0)
        self.assertIsNone(self.receipt('dispatch:task'))
        self.assertEqual(json.loads(self.db.execute(self.selection).fetchone()[0])['ids'], [])

    def test_an_unread_receipt_value_does_not_remove_the_complete_body(self):
        self.message('dispatch:task', 'task', 'Do the work.')
        self.db.execute("UPDATE messages SET receipt='legacy-only'")
        self.assertEqual(self.owed(), 1)
        self.assertIn('Do the work.', self.admitted_prompt())
        self.assertEqual(self.owed(), 0)
        self.assertEqual(self.receipt('dispatch:task'), 'legacy-only')


if __name__ == '__main__':
    unittest.main()
