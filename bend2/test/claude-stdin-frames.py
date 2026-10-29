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
