"""Delivery and recovery after plain-text and empty turn events (#1482)."""
import importlib.util
import json
import os
import pathlib
import select
import sqlite3
import subprocess
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('receive_fixture', ROOT / 'bend2/test/receive.py')
receive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receive)
receive.EXE = pathlib.Path(os.environ.get('BATON_EVENT_TEST_BINARY', str(receive.EXE))).resolve()


class NonJsonLastEvent(receive.Receive):
    def setUp(self):
        environment = dict(os.environ)
        for key in ('BATON_DATABASE', 'BATON_SESSION', 'BATON_ATTEMPT_DIRECTORY',
                    'BATON2_GIT_REGISTRY', 'HOME'):
            environment.pop(key, None)
        isolated = patch.dict(os.environ, environment, clear=True)
        isolated.start()
        self.addCleanup(isolated.stop)
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        super().setUp()

    def process_names(self):
        # Linux names the owner started through /proc/self/exe as exe.
        return super().process_names() | {'exe'}

    def eventually(self, observation, description):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            result = observation()
            if result:
                return result
            time.sleep(.01)
        self.fail(description)

    def next_native(self, session):
        ready, _, _ = select.select([self.server], [], [], 30)
        self.assertTrue(ready, 'Dispatch did not start a native turn')
        return self.accept(session)

    def dispatch_after(self, event):
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_child(first, 'parent')
        self.action(control, body='The first turn completed.', read=['first'])
        self.finish(first)
        with sqlite3.connect(self.db) as db:
            ident, = db.execute("SELECT id FROM turns WHERE worker='parent' ORDER BY rowid DESC LIMIT 1").fetchone()
            db.execute('UPDATE turns SET event=? WHERE id=?', (event, ident))
        self.connect('parent')
        delivery = self.spawn('message', 'second', 'root', 'parent', 'guidance',
                              'Continue the recorded conversation.')
        control, resumed = self.next_native('parent')
        self.assertEqual(resumed['resume'], started['native'])
        self.assertIn('[id: second]', resumed['prompt'])
        self.action(control, body='The second turn completed.', read=['second'])
        self.assertEqual(control.readline(), b'')
        self.finish(delivery)
        self.shutdown_idle_database_owner('The completed turn retained custody')
        self.assertTrue(receive.read_recorded(self.db, 'second'))
        self.assertEqual(self.execution('parent')[0], 'exited')
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

    def observe_event(self, event):
        path = self.directory / 'event.txt'
        path.write_text(event)
        self.coord('observe-file', 'observed-turn', 'root', path)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM refusal_recoveries').fetchone()[0], 0)

    def test_plain_text_outcome_can_be_observed(self):
        self.observe_event('The turn completed. λ')

    def test_empty_outcome_can_be_observed(self):
        self.observe_event('')

    def failed_refusal_retry(self, event):
        path = self.directory / 'retry-event.txt'
        path.write_text(json.dumps({'type': 'result', 'result': 'Completed.', 'is_error': False}))
        self.coord('observe-file', 'initial-turn', 'root', path)
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE sessions SET endpoint=? WHERE id='operator'", (json.dumps(['/usr/bin/true']),))
            db.execute("""INSERT INTO refusal_recoveries
                (id,source,conductor,instruction,harness,model,initial_turn,initial_refusal,status)
                VALUES('recovery','root','operator','Complete the task.','codex','fixture','refused-turn','I cannot help.','active')""")
            db.execute("""INSERT INTO refusal_attempts
                (id,recovery,stage,ordinal,session,instruction,status)
                VALUES('retry','recovery','fork-and-continue',1,'root','Complete the task.','running')""")
        path.write_text(event)
        for _ in range(2):
            self.coord('observe-file', 'failed-turn', 'root', path)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT status FROM refusal_recoveries WHERE id='recovery'").fetchone()[0], 'failed')
            self.assertEqual(db.execute("SELECT status FROM refusal_attempts WHERE id='retry'").fetchone()[0], 'failed')
            reports = db.execute("SELECT recipient,body FROM messages WHERE id='refusal-result:recovery'").fetchall()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0][0], 'operator')
            self.assertEqual(json.loads(reports[0][1])['refusal-recovery-failed']['cause'], event)

    def test_plain_text_refusal_retry_failure_is_reported_once(self):
        self.failed_refusal_retry('The native ended without a structured result. λ')

    def test_empty_refusal_retry_failure_is_reported_once(self):
        self.failed_refusal_retry('')


for name in dir(receive.Receive):
    if name.startswith('test_'):
        setattr(NonJsonLastEvent, name, None)


if __name__ == '__main__':
    unittest.main()
