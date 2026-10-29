"""The Claude Code stdin rule reads the native's own task list and forwards stream-json user frames (#1298).

The frames are lines recorded from claude 2.1.310 in the disposable stdin experiment
(a background `sleep 100` started with Bash run_in_background, then a result). The
SQL is evaluated from the definitions in guidance.bend, so the text under test is the
text the coordinator runs.
"""
import json
import pathlib
import re
import sqlite3
import unittest

GUIDANCE = pathlib.Path(__file__).resolve().parents[1] / 'src/coordinator/guidance.bend'
STATUS = pathlib.Path(__file__).resolve().parents[1] / 'src/coordinator/message-status.bend'

# Real lines from the experiment: the task list while the background command runs,
# the empty list when it ends, and two frames that carry no task list.
FRAMES = {
    'tasks': '{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"b08nmjy6o","run_id":"0mvtv2ejz-e9d9c946","task_type":"local_bash","description":"Sleep 100 seconds then echo marker"}],"uuid":"5e2ba467-2820-40a9-ba36-d7b8bb588933","session_id":"dc9081fb-a9e5-4a3a-9f52-c451d1357476"}',
    'empty': '{"type":"system","subtype":"background_tasks_changed","tasks":[],"uuid":"98b19b91-258e-4097-8c7a-eeb6fee9cb72","session_id":"dc9081fb-a9e5-4a3a-9f52-c451d1357476"}',
    'init': '{"type":"system","subtype":"init","session_id":"dc9081fb-a9e5-4a3a-9f52-c451d1357476","cwd":"/tmp/claude-stdin-open-zojw88bf"}',
    'result': '{"type":"result","subtype":"success","is_error":false,"result":"STARTED","stop_reason":"end_turn","session_id":"dc9081fb-a9e5-4a3a-9f52-c451d1357476"}',
}


def definition(name):
    text = GUIDANCE.read_text()
    match = re.search(r'^def ' + name + r'\(.*?\) -> String:\n((?:  .*\n)+)', text, re.M)
    assert match, name
    return match.group(1)


def evaluate(name, values, stand_in=None):
    """The SQL a one-expression Bend string definition builds, with its parameters bound."""
    body = definition(name)
    lines = [line for line in body.splitlines() if not line.strip().startswith('+complete')]
    out = ''
    for token in re.finditer(r'"((?:[^"\\]|\\.)*)"|C\.q\((\w+)\)|(\w+)', '\n'.join(lines)):
        if token.group(1) is not None:
            out += token.group(1).encode().decode('unicode_escape')
        elif token.group(2):
            out += "'" + values[token.group(2)].replace("'", "''") + "'"
        else:
            out += values.get(token.group(3), stand_in if token.group(3) == 'complete' else '')
    return out


# owed_sql("m") for the alias m, checked against its definition in message-status.bend.
OWED_M = ("NOT EXISTS(SELECT 1 FROM message_reads owed_read WHERE owed_read.message=m.id "
          "AND owed_read.recipient=m.recipient)")


def status_sql(name, values, read=False):
    """A message-status.bend string definition with q(x) bound, owed_sql("m") expanded and read fixed."""
    text = STATUS.read_text()
    owed_def = re.search(r'^def owed_sql\(.*?\) -> String:\n  (.*)\n', text, re.M).group(1)
    assert 'NOT EXISTS(SELECT 1 FROM message_reads owed_read WHERE owed_read.message=' in owed_def
    assert '" ++ row ++ ".id AND owed_read.recipient=" ++ row ++ ".recipient)' in owed_def
    exposed_def = definition_in(text, 'exposed')
    found_def = definition_in(text, 'found')
    assert read is False
    # found(False) is the last string of its Bool.pick; exposed(False, f) reads the field directly.
    found_plain = re.findall(r'"((?:[^"\\]|\\.)*)"', found_def)[-1]
    assert "json_extract(j.value,'$.\" ++ field ++ \"')" in exposed_def
    match = re.search(r'^def ' + name + r'\(.*?\) -> String:\n((?:  .*\n)+)', text, re.M)
    out = ''
    pattern = r'exposed\(read,"(\w+)"\)|found\(read\)|"((?:[^"\\]|\\.)*)"|q\((\w+)\)|owed_sql\("m"\)'
    for token in re.finditer(pattern, match.group(1)):
        if token.group(1):
            out += "json_extract(j.value,'$." + token.group(1) + "')"
        elif token.group(0) == 'found(read)':
            out += found_plain
        elif token.group(2) is not None:
            out += token.group(2).encode().decode('unicode_escape')
        elif token.group(3):
            out += "'" + values[token.group(3)].replace("'", "''") + "'"
        else:
            out += OWED_M
    return out


def definition_in(text, name):
    match = re.search(r'^def ' + name + r'\(.*?\) -> String:\n((?:  .*\n)+)', text, re.M)
    assert match, name
    return match.group(1)


class ReadRows(unittest.TestCase):
    """An in-memory orchestra with one claude-code session and two owed guidance messages."""

    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        schema = re.search(r'"(CREATE TABLE IF NOT EXISTS message_reads\(.*?\);)"', STATUS.read_text()).group(1)
        self.db.executescript(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY, harness TEXT, native TEXT NOT NULL DEFAULT '');"
            "CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, sender TEXT, recipient TEXT, kind TEXT, body TEXT);"
            "CREATE TABLE executions(session TEXT PRIMARY KEY, id TEXT, mode TEXT, directory TEXT, phase TEXT, status TEXT);"
            "CREATE TABLE session_stops(session TEXT PRIMARY KEY);"
            "CREATE TABLE wake_claims(session TEXT PRIMARY KEY, state TEXT, owner TEXT, generation INTEGER);"
            + schema +
            "INSERT INTO sessions VALUES('lead','claude-code','native-lead');"
            "INSERT INTO executions VALUES('lead','attempt-1','retained','/tmp/a','running','');"
            "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g1','root','lead','guidance','Use the new queue.'),('g2','root','lead','guidance','Second.');"
            "INSERT INTO wake_claims VALUES('lead','claimed','g1',1);")

    def forward(self, seq, attempt='attempt-1', native='native-lead'):
        sql = status_sql('forwarded_read_sql', {'session': 'lead', 'attempt': attempt, 'native': native,
                                                'identity': 'witness-1', 'next': str(seq)})
        self.db.executescript(sql)

    def owed(self):
        sql = "SELECT m.id FROM messages m WHERE m.recipient='lead' AND " + OWED_M
        return [row[0] for row in self.db.execute(sql)]


class ForwardedRead(ReadRows):
    """A forwarded frame records one read row after the write; a crash between the two can only forward again."""

    def test_a_forwarded_message_records_exactly_one_read_row_for_its_attempt(self):
        self.assertEqual(self.owed(), ['g1', 'g2'])
        self.forward(1)
        rows = self.db.execute('SELECT attempt,message,recipient,native,identity FROM message_reads').fetchall()
        self.assertEqual(rows, [('attempt-1', 'g1', 'lead', 'native-lead', 'witness-1')])
        self.assertEqual(self.owed(), ['g2'])

    def test_forwarding_the_same_message_again_adds_no_second_row(self):
        # A crash after the write and before the row forwards the message again; the row is still one.
        self.forward(1)
        self.forward(1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM message_reads WHERE message=?', ('g1',)).fetchone()[0], 1)

    def test_a_message_stays_owed_until_its_row_exists(self):
        # Before the row (a crash between the write and the row) the message is owed, so it can only be forwarded again.
        self.assertIn('g1', self.owed())
        self.forward(1)
        self.assertNotIn('g1', self.owed())

    def test_no_row_is_recorded_for_an_attempt_that_is_not_live(self):
        self.db.execute("UPDATE executions SET phase='exited'")
        self.forward(1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM message_reads').fetchone()[0], 0)
        self.assertIn('g1', self.owed())

    def test_no_row_is_recorded_for_another_attempt_or_native(self):
        self.forward(1, attempt='attempt-0')
        self.forward(1, native='native-other')
        self.assertEqual(self.db.execute('SELECT count(*) FROM message_reads').fetchone()[0], 0)

    def test_the_last_owed_message_clears_the_wake_claim(self):
        self.forward(1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM wake_claims').fetchone()[0], 1)
        self.forward(2)
        self.assertEqual(self.db.execute('SELECT count(*) FROM wake_claims').fetchone()[0], 0)


class HookAndForwardOverlap(ReadRows):
    """The turn-end hook and the forwarding path can both record the read of one message after the first result."""

    SAVED = json.dumps([{'id': 'g1', 'recipient': 'lead', 'body': 'Use the new queue.'}])

    def hook(self, identity='witness-1'):
        sql = status_sql('record_sql', {'session': 'lead', 'directory': '/tmp/a', 'attempt': 'attempt-1',
                                        'native': 'native-lead', 'identity': identity, 'saved': self.SAVED})
        self.db.executescript(sql)

    def rows(self):
        return self.db.execute('SELECT attempt,message,recipient,native,identity FROM message_reads').fetchall()

    def test_the_hook_after_the_forward_adds_no_row_and_raises_nothing(self):
        self.forward(1)
        self.hook()
        self.assertEqual(self.rows(), [('attempt-1', 'g1', 'lead', 'native-lead', 'witness-1')])

    def test_the_forward_after_the_hook_adds_no_row_and_raises_nothing(self):
        self.hook()
        self.assertEqual(self.rows(), [('attempt-1', 'g1', 'lead', 'native-lead', 'witness-1')])
        self.forward(1)
        self.assertEqual(self.rows(), [('attempt-1', 'g1', 'lead', 'native-lead', 'witness-1')])
        self.assertEqual(self.owed(), ['g2'])

    def test_the_first_recorded_read_wins(self):
        self.forward(1)
        self.hook(identity='witness-1')
        self.assertEqual([row[4] for row in self.rows()], ['witness-1'])


class BackgroundState(unittest.TestCase):
    def state(self, frame):
        sql = evaluate('background_sql', {'value': "'" + frame.replace("'", "''") + "'"})
        return sqlite3.connect(':memory:').execute(sql).fetchone()[0]

    def test_a_task_list_with_a_task_marks_background_work(self):
        self.assertEqual(self.state(FRAMES['tasks']), '1')

    def test_an_empty_task_list_clears_background_work(self):
        self.assertEqual(self.state(FRAMES['empty']), '0')

    def test_other_frames_carry_no_task_list(self):
        for name in ('init', 'result'):
            self.assertEqual(self.state(FRAMES[name]), '', name)
        self.assertEqual(self.state('not json'), '')
        self.assertEqual(self.state('{"type":"system","subtype":"background_tasks_changed"}'), '0')

    def test_the_recorded_sequence_ends_with_no_background_work(self):
        state = ''
        seen = []
        for name in ('init', 'tasks', 'result', 'empty'):
            observed = self.state(FRAMES[name])
            state = observed or state
            seen.append(state)
        self.assertEqual(seen, ['', '1', '1', '0'])


class ForwardedFrame(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY, harness TEXT);"
            "CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, sender TEXT, recipient TEXT, kind TEXT, body TEXT);"
            "INSERT INTO sessions VALUES('lead','claude-code'),('omp-seat','omp');"
            "INSERT INTO messages(id,sender,recipient,kind,body) VALUES"
            "('g1','root','lead','guidance','Use the new queue.'),"
            "('g2','root','omp-seat','guidance','Use the new queue.');")
        # The complete-message text is built by message-status.bend; a stand-in with the same shape keeps this test on the CASE.
        self.complete = "('Message (' || kind || ') from ' || sender || ' [id: ' || id || ']:' || char(10) || body)"

    def frame(self, seq):
        sql = evaluate('frame_sql', {'next': str(seq)}, self.complete)
        return json.loads(self.db.execute(sql).fetchone()[0])

    def test_a_claude_code_session_gets_a_stream_json_user_frame(self):
        frame = self.frame(1)
        self.assertEqual(frame['type'], 'user')
        self.assertEqual(frame['message']['role'], 'user')
        self.assertIn('Use the new queue.', frame['message']['content'])
        self.assertIn('[id: g1]', frame['message']['content'])

    def test_an_omp_session_keeps_its_steer_frame(self):
        frame = self.frame(2)
        self.assertEqual((frame['type'], frame['id']), ('steer', 'g2'))
        self.assertIn('Use the new queue.', frame['message'])


if __name__ == '__main__':
    unittest.main()
