"""Qualify production focused Codex handlers with a retained backend and fake proxy.

BATON2_CODEX_FOCUSED_BINARY names the production receive-focused executable.
BATON2_CODEX_BACKEND_PREFIX names a retained native installation with its helpers.
No provider, user daemon or live database is used.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('receive_support', ROOT / 'bend2/test/receive.py')
SUPPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUPPORT)
NATIVE = '019a174b-1234-7123-8123-123456789abc'


class FocusedCodexInbox(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='focused-codex-inbox-')
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        prefix = self.home / 'prefix'
        (prefix / 'bin').mkdir(parents=True)
        retained = Path(os.environ['BATON2_CODEX_BACKEND_PREFIX'])
        self.focused, self.full = prefix / 'bin/baton', prefix / 'bin/baton-full'
        shutil.copy2(os.environ['BATON2_CODEX_FOCUSED_BINARY'], self.focused)
        for name in ('baton-full', 'baton2', 'baton-recovery'):
            shutil.copy2(retained / 'bin' / name, prefix / 'bin' / name)
        shutil.copytree(retained / 'libexec', prefix / 'libexec', symlinks=True)
        self.calls = self.home / 'proxy-calls.jsonl'
        SUPPORT.write_public_queue_codex(self.home, self.calls)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith('BATON_') and key != 'CODEX_THREAD_ID'}
        self.env.update(PATH=str(self.home) + os.pathsep + self.env['PATH'],
                        HOME=str(self.home / 'home'), CODEX_HOME=str(self.home / 'codex-home'))
        self.db = self.home / 'fixture.sqlite'
        self.addCleanup(self.shutdown)
        self.run_cli(self.full, 'attach', 'operator', 'operator', '', '')
        self.run_cli(self.full, 'role', 'operator', 'operator')
        self.run_cli(self.full, 'attach', 'worker', 'codex', NATIVE, '')
        self.run_cli(self.full, 'role', 'worker', 'player')
        self.body = 'Complete retained input. λ🙂\n' * 1000 + 'COMPLETE-TAIL'
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('owed','operator','worker','guidance',?)",
                       (self.body,))

    def shutdown(self):
        result = subprocess.run([str(self.focused), '--instance-shutdown', str(self.db)],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def run_cli(self, executable, *args, expected=0, env=None):
        result = subprocess.run([str(executable), str(self.db), *args], env=env or self.env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def proxy_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def reads(self):
        with sqlite3.connect(self.db) as db:
            return db.execute('SELECT message,native,identity,handled FROM message_reads').fetchall()

    def test_session_pointer_complete_read_and_next_input_with_retained_backend(self):
        self.run_cli(self.focused, 'codex-inbox-session', 'worker', NATIVE, 'owed', '')
        calls = self.proxy_calls()
        self.assertEqual([call['method'] for call in calls], ['turn/steer'])
        self.assertEqual(calls[0]['params']['threadId'], NATIVE)
        self.assertEqual(calls[0]['params']['expectedTurnId'], 'fixture-turn')
        self.assertNotIn(self.body, calls[0]['params']['input'][0]['text'])
        self.assertEqual(self.reads(), [])
        read = json.loads(self.run_cli(self.full, 'as', 'worker', 'read', 'owed',
                                      env={**self.env, 'CODEX_THREAD_ID': NATIVE}))
        self.assertEqual(read[0]['delivery']['body'], self.body)
        rows = self.reads()
        self.assertEqual([(row[0], row[1], json.loads(row[2]), row[3]) for row in rows],
                         [('owed', NATIVE, ['codex', NATIVE, 'fixture-turn'], None)])
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('later','operator','worker','guidance','Next complete input.')")
        self.run_cli(self.focused, 'codex-inbox-session', 'worker', NATIVE, 'later')
        self.assertEqual([call['method'] for call in self.proxy_calls()], ['turn/steer', 'turn/steer'])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT native FROM sessions WHERE id=\'worker\'').fetchone()[0], NATIVE)
            self.assertEqual(db.execute('SELECT id FROM messages WHERE receipt IS NOT NULL').fetchall(), [])
        self.assertEqual(self.reads(), rows)

    def test_session_rejects_another_recorded_native(self):
        self.run_cli(self.focused, 'codex-inbox-session', 'worker',
                     '019a174b-1234-7123-8123-123456789abd', 'owed', expected=1)
        self.assertEqual(self.proxy_calls(), [])
        self.assertEqual(self.reads(), [])

    def test_stale_claim_token_keeps_input_unread(self):
        self.run_cli(self.focused, 'codex-inbox-session', 'worker', NATIVE, 'owed', 'stale-token')
        self.assertEqual(self.proxy_calls(), [])
        self.assertEqual(self.reads(), [])

    def test_delivery_uses_existing_active_turn(self):
        pointer = 'Pending input λ🙂 with spaces.\nFinal line.'
        self.run_cli(self.focused, 'codex-inbox-deliver', NATIVE, pointer)
        self.assertEqual(self.proxy_calls()[0]['params'],
                         {'threadId': NATIVE, 'input': [{'type': 'text', 'text': pointer}],
                          'expectedTurnId': 'fixture-turn'})
        self.assertEqual(self.reads(), [])

    def test_unloaded_active_writer_uses_supported_codex_queue(self):
        self.env['BATON_FIXTURE_RESUME_CONFLICT'] = '1'
        self.run_cli(self.focused, 'codex-inbox-session', 'worker', NATIVE, 'owed', '')
        calls = self.proxy_calls()
        self.assertEqual([call['method'] for call in calls],
                         ['thread/read', 'thread/resume', 'codex queue'])
        self.assertEqual(calls[-1]['threadId'], NATIVE)
        self.assertIn('owed', calls[-1]['message'])
        self.assertNotIn(self.body, calls[-1]['message'])
        self.assertEqual(self.reads(), [])

    def test_witness_reports_existing_active_native_turn(self):
        output = self.run_cli(self.focused, 'codex-input-witness', NATIVE)
        self.assertEqual(json.loads(output),
                         {'threadId': NATIVE, 'turnId': 'fixture-turn', 'active': True})
        self.assertEqual(self.proxy_calls(), [])
        self.assertEqual(self.reads(), [])

    def test_follow_preserves_explicit_stop_and_unread_input(self):
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('worker','stop','Operator stop.','stopped')")
        output = self.run_cli(self.focused, 'codex-inbox-follow', 'worker', NATIVE)
        frames = [json.loads(line) for line in output.splitlines()]
        self.assertTrue(any(frame.get('type') == 'codexInboxReleased' and frame.get('stopped') for frame in frames))
        self.assertEqual(self.proxy_calls(), [])
        self.assertEqual(self.reads(), [])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT id FROM session_stops WHERE session=\'worker\'').fetchall(), [('stop',)])


if __name__ == '__main__':
    unittest.main()
