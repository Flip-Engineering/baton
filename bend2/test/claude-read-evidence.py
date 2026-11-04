"""Confirm Claude Read evidence identifies only complete owed messages."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


ENTRY = os.environ.get('BATON2_CLAUDE_READ_EVIDENCE')


class ClaudeReadEvidence(unittest.TestCase):
    def setUp(self):
        if not ENTRY:
            self.skipTest('BATON2_CLAUDE_READ_EVIDENCE is not configured')
        self.temporary = tempfile.TemporaryDirectory(prefix='claude-read-evidence-')
        self.addCleanup(self.temporary.cleanup)
        self.database = sqlite3.connect(Path(self.temporary.name) / 'fixture.sqlite')
        self.addCleanup(self.database.close)
        self.database.executescript('''
            CREATE TABLE messages(id TEXT,recipient TEXT,sender TEXT,kind TEXT,body TEXT,seq INTEGER);
            CREATE TABLE message_reads(message TEXT,recipient TEXT);
            CREATE TABLE session_stops(session TEXT);
        ''')
        self.database.executemany('INSERT INTO messages VALUES(?,?,?,?,?,?)', [
            ('complete', 'worker', 'parent', 'guidance', 'Full input body. TAIL-CANARY-03473f37', 1),
            ('partial', 'worker', 'parent', 'guidance', 'Another full body. TAIL-CANARY-2', 2),
            ('other-recipient', 'elsewhere', 'parent', 'guidance', 'Elsewhere', 3),
        ])

    def selection(self, event):
        result = subprocess.run([ENTRY, 'worker', json.dumps(event)], check=True,
                                capture_output=True, text=True)
        return self.database.execute(result.stdout).fetchone()[0]

    def test_complete_native_read_confirms_full_input(self):
        event = {
            'hook_event_name': 'PostToolUse',
            'tool_name': 'Read',
            'tool_input': {'file_path': '/session/tool-results/hook-additionalContext.txt'},
            'tool_response': {'type': 'text', 'file': {'content':
                'Message (guidance) from parent [id: complete]:\n'
                'Full input body. TAIL-CANARY-03473f37\n'
                'The complete input is available in this turn.'}},
        }
        selected = json.loads(self.selection(event))
        self.assertEqual(selected, [{'id': 'complete', 'recipient': 'worker',
                                     'body': 'Full input body. TAIL-CANARY-03473f37'}])

    def test_preview_without_complete_body_does_not_confirm_input(self):
        event = {
            'hook_event_name': 'PostToolUse',
            'tool_name': 'Read',
            'tool_response': {'type': 'text', 'file': {'content':
                'Message (guidance) from parent [id: complete]:\n'
                'Preview only; TAIL-CANARY-03473f37 is omitted.'}},
        }
        self.assertEqual(json.loads(self.selection(event)), [])

    def test_other_native_tools_do_not_confirm_input(self):
        event = {
            'hook_event_name': 'PostToolUse',
            'tool_name': 'Bash',
            'tool_response': {'type': 'text', 'file': {'content':
                'Message (guidance) from parent [id: complete]:\n'
                'Full input body. TAIL-CANARY-03473f37\n'
                'The complete input is available in this turn.'}},
        }
        self.assertEqual(json.loads(self.selection(event)), [])


if __name__ == '__main__':
    unittest.main()
