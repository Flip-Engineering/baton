#!/usr/bin/env python3
"""The predecessor statement of a native initial input prepares on the system SQLite.

BATON2_NATIVE_INITIAL_SQL_FIXTURE names the built native-initial-sql-fixture.bend.
The fixture prints the statements that native-initial-input.bend generates; the
tests prepare and run them with the SQLite library of this host. The statement
once nested the coordinator walk of C.report_recipient inside the predecessor
predicate and failed with "parser stack overflow" on SQLite 3.45.1.

Each case seeds a worker whose retained execution exited, whose profile hand-off
report was sent to its report recipient, and whose owed input is selected. The
predecessor is found exactly when the report went to the recipient that the
coordinator rules give the worker now.
"""
import json
import os
import sqlite3
import subprocess
import sys
import unittest

FIXTURE = os.environ.get('BATON2_NATIVE_INITIAL_SQL_FIXTURE')
if not FIXTURE:
    print('Set BATON2_NATIVE_INITIAL_SQL_FIXTURE to the built native-initial-sql-fixture', file=sys.stderr)
    sys.exit(2)

# The failing statement came from a session of this length.
WORKER = 'whole-baton-cgen-opus-max-secondary-isolated-20261029'


def printed(*arguments):
    done = subprocess.run([FIXTURE, *arguments], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, (arguments, done.stdout, done.stderr)
    return done.stdout


class Seeded(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = printed('schema')

    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(self.schema)
        self.seq = 0

    def tearDown(self):
        self.db.close()

    def session(self, name, parent=None, role=None):
        self.db.execute("INSERT INTO sessions(id,parent,harness) VALUES(?,?,'claude-code')", (name, parent))
        if role:
            self.db.execute('INSERT INTO session_roles(session,role) VALUES(?,?)', (name, role))

    def message(self, identity, sender, recipient, kind, body=''):
        self.db.execute('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                        (identity, sender, recipient, kind, body))

    def tree(self):
        """operator <- conductor <- parent <- worker."""
        self.session('operator', None, 'operator')
        self.session('conductor', None, 'conductor')
        self.session('parent', 'conductor', 'conductor')
        self.session(WORKER, 'parent')

    def retained_execution(self, cursor=5):
        """An exited retained execution with a selected owed input at or below its cursor."""
        self.message('input-1', 'parent', WORKER, 'guidance')
        execution = 'receive:%s:%d' % (WORKER, cursor)
        self.db.execute("INSERT INTO executions(session,id,mode,directory,phase,status) VALUES(?,?,'retained','dir-1','exited','exit 0')",
                        (WORKER, execution))
        self.db.execute("INSERT INTO native_initial_inputs(attempt,session,turn,seed,instruction,guidance) VALUES('dir-1',?,?,'seed','i','g')",
                        (WORKER, execution))
        return execution

    def recipient(self):
        return self.db.execute(printed('recipient', WORKER)).fetchone()[0]

    def predecessor(self, inputs=('input-1',)):
        statement = printed('predecessor', WORKER, json.dumps(list(inputs)))
        row = self.db.execute(statement).fetchone()
        return bytes.fromhex(row[0]).decode()

    def handoff(self, execution, to):
        self.message(execution + ':profile-handoff-1', WORKER, to, 'report')


class PredecessorStatement(Seeded):
    def test_the_failing_statement_prepares_on_this_library(self):
        self.tree()
        self.retained_execution()
        statement = printed('predecessor', WORKER, '["input-1"]')
        self.assertGreater(len(statement), 5000)
        self.db.execute('EXPLAIN ' + statement.rstrip().rstrip(';'))
        self.assertEqual(self.db.execute(printed('recipient', WORKER)).fetchone()[0], 'parent')

    def test_fresh_worker_has_no_predecessor(self):
        self.tree()
        self.assertEqual(self.predecessor(), '')

    def test_a_handoff_guidance_input_selects_the_exited_execution(self):
        self.tree()
        execution = self.retained_execution()
        self.message(execution + ':handoff-guidance', WORKER, WORKER, 'guidance')
        self.assertEqual(self.predecessor((execution + ':handoff-guidance',)), 'dir-1')

    def test_a_retry_after_a_report_to_the_live_coordinator_finds_the_predecessor(self):
        self.tree()
        execution = self.retained_execution()
        self.handoff(execution, self.recipient())
        self.assertEqual(self.recipient(), 'parent')
        self.assertEqual(self.predecessor(), 'dir-1')

    def test_a_report_to_another_session_is_not_a_handoff(self):
        self.tree()
        execution = self.retained_execution()
        self.handoff(execution, 'conductor')
        self.assertEqual(self.predecessor(), '')

    def test_a_stopped_coordinator_hands_the_report_to_its_ancestor(self):
        self.tree()
        execution = self.retained_execution()
        self.db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('parent','stop-1','test','stopped')")
        self.assertEqual(self.recipient(), 'conductor')
        self.handoff(execution, 'parent')
        self.assertEqual(self.predecessor(), '')
        self.message(execution + ':profile-handoff-2', WORKER, 'conductor', 'report')
        self.assertEqual(self.predecessor(), 'dir-1')

    def test_the_recorded_successor_of_a_stopped_coordinator_receives_the_report(self):
        self.tree()
        self.session('successor', 'conductor', 'conductor')
        self.message('succession:parent:successor', 'successor', 'parent', 'succession')
        execution = self.retained_execution()
        self.assertEqual(self.recipient(), 'parent')
        self.db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('parent','stop-1','test','stopped')")
        self.assertEqual(self.recipient(), 'successor')
        self.handoff(execution, 'conductor')
        self.assertEqual(self.predecessor(), '')
        self.message(execution + ':profile-handoff-2', WORKER, 'successor', 'report')
        self.assertEqual(self.predecessor(), 'dir-1')

    def test_a_coordinator_whose_completion_was_confirmed_is_skipped(self):
        self.tree()
        execution = self.retained_execution()
        self.message('request-1', 'parent', 'conductor', 'completion-request')
        self.message('confirmed-1', 'conductor', 'parent', 'completion-confirmed', 'request-1')
        self.assertEqual(self.recipient(), 'conductor')
        self.handoff(execution, 'parent')
        self.assertEqual(self.predecessor(), '')
        self.message(execution + ':profile-handoff-2', WORKER, 'conductor', 'report')
        self.assertEqual(self.predecessor(), 'dir-1')

    def test_the_operator_receives_the_report_when_every_ancestor_is_over(self):
        self.tree()
        execution = self.retained_execution()
        for name in ('parent', 'conductor'):
            self.db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES(?,?,'test','stopped')", (name, 'stop-' + name))
        self.assertEqual(self.recipient(), 'operator')
        self.handoff(execution, 'operator')
        self.assertEqual(self.predecessor(), 'dir-1')

    def test_a_task_after_the_cursor_cancels_the_retry_predecessor(self):
        self.tree()
        execution = self.retained_execution(cursor=1)
        self.handoff(execution, 'parent')
        self.message('task-2', 'parent', WORKER, 'task')
        self.assertEqual(self.predecessor(('input-1', 'task-2')), '')

    def test_a_read_input_is_not_owed(self):
        self.tree()
        execution = self.retained_execution()
        self.handoff(execution, 'parent')
        self.db.execute("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('a','input-1',?,'n','i')", (WORKER,))
        self.assertEqual(self.predecessor(), '')


if __name__ == '__main__':
    unittest.main()
