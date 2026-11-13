"""Delivery and recovery after plain-text and empty turn events (#1482)."""
import importlib.util
import json
import os
import pathlib
import select
import sqlite3
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('receive_fixture', ROOT / 'bend2/test/receive.py')
receive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receive)
receive.EXE = pathlib.Path(os.environ['BATON_EVENT_TEST_BINARY']).resolve()


class NonJsonLastEvent(receive.Receive):
    def next_native(self):
        ready, _, _ = select.select([self.server], [], [], 30)
        self.assertTrue(ready, 'Dispatch did not start a native turn')
        return self.accept('root')

    def dispatch_after(self, event):
        self.prepare_input('first', 'root')
        first = self.spawn(*self.receive_args('root'))
        control, started = self.accept_child(first, 'root')
        self.action(control, body='The first turn completed.')
        self.finish(first)
        with sqlite3.connect(self.db) as db:
            ident, = db.execute("SELECT id FROM turns WHERE worker='root' ORDER BY rowid DESC LIMIT 1").fetchone()
            db.execute('UPDATE turns SET event=? WHERE id=?', (event, ident))
        self.message('second', 'root', 'Continue the recorded conversation.')
        control, resumed = self.next_native()
        self.assertEqual(resumed['resume'], started['native'])
        self.assertIn('[id: second]', resumed['prompt'])
        self.action(control, body='The second turn completed.')
        self.assertEqual(control.readline(), b'')
        self.shutdown_idle_database_owner('The completed turn retained custody')
        self.assertTrue(receive.read_recorded(self.db, 'second'))
        self.assertEqual(self.execution('root')[0], 'exited')
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT event FROM turns WHERE id=?', (ident,)).fetchone()[0], event)

    def test_plain_text_last_event_dispatch_starts_a_turn(self):
        self.dispatch_after('The prior turn completed. λ')

    def test_empty_last_event_dispatch_starts_a_turn(self):
        self.dispatch_after('')

    def recovery_after(self, event):
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO turns(id,worker,event) VALUES('prior','root',?)", (event,))
            db.execute("UPDATE sessions SET endpoint=? WHERE id='operator'", (json.dumps(['/usr/bin/true']),))
        directory = self.directory / 'missing-attempt'
        argv = [str(receive.EXE), '--recover-receive', str(self.db), 'root', 'failed-attempt', '0',
                str(self.fixture), 'root', 'low', str(self.directory), str(self.directory / 'native.log'),
                'codex\n', str(directory), 'native-root']
        for _ in range(2):
            failed = subprocess.run(argv, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(failed.returncode, 0, failed.stdout + failed.stderr)
            self.assertNotIn('malformed JSON', failed.stdout + failed.stderr)
        with sqlite3.connect(self.db) as db:
            reports = db.execute("SELECT recipient,body FROM messages WHERE id='failed-attempt:recovery-failure'").fetchall()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0][0], 'operator')
            self.assertIn('Recovery of retained attempt failed-attempt', reports[0][1])
            self.assertIn(str(directory), reports[0][1])
            self.assertEqual(db.execute("SELECT event FROM turns WHERE id='prior'").fetchone()[0], event)
        self.assert_no_start()

    def test_plain_text_last_event_recovery_failure_is_reported_once(self):
        self.recovery_after('The prior turn completed. λ')

    def test_empty_last_event_recovery_failure_is_reported_once(self):
        self.recovery_after('')


for name in dir(receive.Receive):
    if name.startswith('test_'):
        setattr(NonJsonLastEvent, name, None)


if __name__ == '__main__':
    unittest.main()
