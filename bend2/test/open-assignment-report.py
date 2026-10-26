"""Turn end with an open assignment reports the idle seat (#1054, instance C1).

compiler-crash-1017-opus-20261022 ended turn
receive:compiler-crash-1017-opus-20261022:225548 at 10:16:21Z with its
assignment open, no completion request and no owed input. The coordinator
acknowledged the ordinary turn report and nothing started a further turn for
14 h 28 min. The turn end now also writes a report to the coordinator that
names the open assignment and the continue-task action. These checks run the
generated statement against fixture databases.

BATON2_OPEN_ASSIGNMENT_FIXTURE names a built bend2/test/open-assignment-report
binary; otherwise the test builds it with bend2/scripts/build-native.sh.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '.scratch/bend2'
ATTEMPT = 'receive:worker:7:feed'
SCHEMA = '''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL DEFAULT 'claude-code');
CREATE TABLE session_roles (session TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');
CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
INSERT INTO sessions(id,parent) VALUES('coordinator',NULL),('worker','coordinator');
INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('dispatch:assignment','coordinator','worker','task','Do the work.','native-turn:receive:worker:1:aa');
'''


def statement():
    binary = os.environ.get('BATON2_OPEN_ASSIGNMENT_FIXTURE')
    if not binary:
        SCRATCH.mkdir(parents=True, exist_ok=True)
        binary = str(SCRATCH / 'open-assignment-report')
        build = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                'bend2/test/open-assignment-report.bend', binary],
                               cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True)
        if build.returncode:
            raise AssertionError(build.stdout + build.stderr)
    run = subprocess.run([binary], capture_output=True, text=True)
    if run.returncode:
        raise AssertionError(run.stdout + run.stderr)
    return run.stdout


class OpenAssignmentReport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = statement()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = sqlite3.connect(str(pathlib.Path(self.temp.name) / 'orchestra.db'))
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA)

    def turn_ends(self):
        self.db.executescript(self.sql)
        return self.db.execute(
            "SELECT sender, recipient, kind, body FROM messages WHERE id=?",
            (ATTEMPT + ':assignment',)).fetchall()

    def message(self, ident, sender, recipient, kind, body, receipt='native-turn:receive:worker:2:bb'):
        self.db.execute('INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(?,?,?,?,?,?)',
                        (ident, sender, recipient, kind, body, receipt))

    def test_open_assignment_without_request_reports_the_idle_seat(self):
        rows = self.turn_ends()
        self.assertEqual(len(rows), 1)
        sender, recipient, kind, body = rows[0]
        self.assertEqual((sender, recipient, kind), ('worker', 'coordinator', 'report'))
        self.assertIn('dispatch:assignment still open', body)
        self.assertIn(ATTEMPT, body)
        self.assertIn('continue-task --session worker', body)

    def test_completion_request_after_the_assignment_writes_no_report(self):
        self.message('message:worker:request', 'worker', 'coordinator', 'completion-request', 'Done.')
        self.assertEqual(self.turn_ends(), [])

    def test_owed_input_writes_no_report(self):
        self.message('message:coordinator:guidance', 'coordinator', 'worker', 'guidance', 'More.', receipt=None)
        self.assertEqual(self.turn_ends(), [])

    def test_confirmed_assignment_writes_no_report(self):
        self.message('message:worker:request', 'worker', 'coordinator', 'completion-request', 'Done.')
        self.message('message:coordinator:confirmed', 'coordinator', 'worker', 'completion-confirmed', 'message:worker:request')
        self.assertEqual(self.turn_ends(), [])

    def test_stopped_seat_writes_no_report(self):
        self.db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('worker','stop:1','operator','stopped')")
        self.assertEqual(self.turn_ends(), [])

    def test_the_same_turn_end_reports_once(self):
        self.assertEqual(len(self.turn_ends()), 1)
        self.assertEqual(len(self.turn_ends()), 1)
        count = self.db.execute("SELECT count(*) FROM messages WHERE id=?", (ATTEMPT + ':assignment',)).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == '__main__':
    unittest.main()
