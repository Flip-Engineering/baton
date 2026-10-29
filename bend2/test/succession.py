"""Check conductor succession, live-parent report routing and the stop-time
children report over the coordinator's own SQL (#1257).

The executable is bend2/test/succession-focused.bend, built to BATON2_EXE.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/succession-focused'))
OPEN = 'turn:{}:task-input'


class Succession(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Focused entry not built at {EXE}')
        scratch = ROOT / '.scratch/bend2'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.run_command('attach', 'root', 'claude-code', 'native-root', '')
        self.run_command('role', 'root', 'principal-conductor')
        self.session('old', 'root', conductor=True)
        self.session('new', 'root', conductor=True)
        for child in ('open', 'closed', 'ended', 'unrequested'):
            self.session(child, 'old')
        self.rows = None

    # Fixture helpers -------------------------------------------------------
    def run_command(self, *args):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)], text=True, capture_output=True)

    def ok(self, *args):
        result = self.run_command(*args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def sql(self, statement, params=()):
        connection = sqlite3.connect(self.db)
        try:
            rows = connection.execute(statement, params).fetchall()
            connection.commit()
            return rows
        finally:
            connection.close()

    def session(self, name, parent, conductor=False):
        self.sql('INSERT INTO sessions(id,parent,harness,native) VALUES(?,?,?,?)',
                 (name, parent, 'claude-code', 'native-' + name))
        if conductor:
            self.sql("INSERT OR REPLACE INTO session_roles(session,role) VALUES(?,'conductor')", (name,))

    def message(self, id, sender, recipient, kind, body='body', read=False):
        self.sql('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                 (id, sender, recipient, kind, body))
        if read:
            self.sql("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('a',?,?,'n','i')",
                     (id, recipient))

    def stop(self, name):
        self.sql("INSERT INTO session_stops(session,id,reason,outcome) VALUES(?,?,'test','stopped')",
                 (name, 'stop-' + name))

    def task(self, child, parent='old', confirmed=False):
        self.message('assign-' + child, parent, child, 'task-assignment')
        if confirmed:
            self.message('request-' + child, child, parent, 'completion-request')
            self.message('confirm-' + child, parent, child, 'completion-confirmed', 'request-' + child)

    def state(self, child):
        return json.loads(self.ok('session', child))['taskCompletion']

    def populate(self):
        self.task('open')
        self.task('unrequested')
        self.task('closed', confirmed=True)
        self.task('ended')
        self.stop('ended')
        self.message('owed-report', 'open', 'old', 'report', 'unread report')
        self.message('owed-request', 'unrequested', 'old', 'completion-request', 'ready')
        self.message('read-report', 'open', 'old', 'report', 'read report', read=True)
        self.message('own-task', 'old', 'old', 'task-assignment', 'own task')
        self.stop('old')

    def recipient(self, id):
        rows = self.sql('SELECT recipient FROM messages WHERE id=?', (id,))
        return rows[0][0] if rows else None

    def parent(self, name):
        return self.sql('SELECT parent FROM sessions WHERE id=?', (name,))[0][0]

    # Succession --------------------------------------------------------------
    def test_successor_inherits_children_input_and_open_assignments(self):
        self.populate()
        self.assertTrue(self.state('open')['open'])
        result = json.loads(self.ok('succeed', 'new', 'old'))
        self.assertEqual(sorted(result['children']), ['closed', 'ended', 'open', 'unrequested'])
        self.assertEqual(sorted(result['inheritedAssignments']), ['open', 'unrequested'])
        self.assertEqual(sorted(result['movedInput']), ['owed-report', 'owed-request'])
        for child in ('open', 'closed', 'ended', 'unrequested'):
            self.assertEqual(self.parent(child), 'new')
        # Unread input moves with its identity; read and self-addressed input stays.
        self.assertEqual(self.recipient('owed-report'), 'new')
        self.assertEqual(self.recipient('owed-request'), 'new')
        self.assertEqual(self.recipient('read-report'), 'old')
        self.assertEqual(self.recipient('own-task'), 'old')
        self.assertEqual(self.sql("SELECT sender,kind,body FROM messages WHERE id='owed-report'"),
                         [('open', 'report', 'unread report')])
        # Open assignments continue under the successor.
        for child in ('open', 'unrequested'):
            guidance = 'succession:old:new:' + child
            self.assertEqual(self.sql('SELECT sender,recipient,kind FROM messages WHERE id=?', (guidance,)),
                             [('new', child, 'guidance')])
            state = self.state(child)
            self.assertTrue(state['open'])
            self.assertEqual(state['coordinator'], 'new')
            self.assertEqual(state['assignmentId'], guidance)
        # A confirmed assignment stays closed and an ended child gets no guidance.
        self.assertFalse(self.state('closed')['open'])
        self.assertEqual(self.recipient('succession:old:new:closed'), None)
        self.assertEqual(self.recipient('succession:old:new:ended'), None)
        # The record reaches the common parent.
        self.assertEqual(self.recipient('succession:old:new'), 'root')

    def test_completion_flows_to_the_successor(self):
        self.populate()
        self.ok('succeed', 'new', 'old')
        self.message('request-open', 'open', 'new', 'completion-request', 'done')
        self.assertEqual(self.state('open')['requestId'], 'request-open')
        self.message('confirm-open', 'new', 'open', 'completion-confirmed', 'request-open')
        self.assertFalse(self.state('open')['open'])

    def test_succession_is_idempotent(self):
        self.populate()
        self.ok('succeed', 'new', 'old')
        before = self.sql('SELECT count(*) FROM messages')
        again = json.loads(self.ok('succeed', 'new', 'old'))
        self.assertEqual(again['children'], [])
        self.assertEqual(again['movedInput'], [])
        self.assertEqual(self.sql('SELECT count(*) FROM messages'), before)

    def test_ancestor_adopts_the_children(self):
        self.populate()
        result = json.loads(self.ok('succeed', 'root', 'old'))
        self.assertIn('open', result['inheritedAssignments'])
        self.assertEqual(self.parent('open'), 'root')
        self.assertEqual(self.recipient('owed-report'), 'root')

    def test_refusals_leave_the_state_unchanged(self):
        self.populate()
        cases = {
            'live predecessor': ('new', 'open'),
            'self': ('old', 'old'),
            'unknown predecessor': ('new', 'missing'),
        }
        for label, (successor, predecessor) in cases.items():
            result = self.run_command('succeed', successor, predecessor)
            self.assertNotEqual(result.returncode, 0, label)
            self.assertIn('succession-refused', result.stdout + result.stderr, label)
        self.session('stranger', None, conductor=True)
        refused = self.run_command('succeed', 'stranger', 'old')
        self.assertNotEqual(refused.returncode, 0)
        self.stop('new')
        refused = self.run_command('succeed', 'new', 'old')
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.parent('open'), 'old')
        self.assertEqual(self.recipient('owed-report'), 'old')
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE id LIKE 'succession:%'"), [(0,)])

    def test_a_descendant_cannot_succeed_its_ancestor(self):
        self.populate()
        self.session('inner', 'old', conductor=True)
        refused = self.run_command('succeed', 'inner', 'old')
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.parent('open'), 'old')

    # Report routing ----------------------------------------------------------
    def test_reports_reach_the_nearest_live_ancestor(self):
        self.stop('old')
        report = json.loads(self.ok('report', 'r1', 'open', 'blocked'))
        self.assertEqual(report['recipient'], 'root')
        self.sql('DELETE FROM session_stops WHERE session=?', ('old',))
        report = json.loads(self.ok('report', 'r2', 'open', 'blocked again'))
        self.assertEqual(report['recipient'], 'old')

    def test_reports_skip_every_stopped_ancestor(self):
        self.session('deep', 'open')
        self.stop('open')
        self.stop('old')
        report = json.loads(self.ok('report', 'r3', 'deep', 'blocked'))
        self.assertEqual(report['recipient'], 'root')

    def test_a_report_keeps_the_recorded_parent_when_every_ancestor_is_stopped(self):
        self.stop('old')
        self.stop('root')
        report = json.loads(self.ok('report', 'r4', 'open', 'blocked'))
        self.assertEqual(report['recipient'], 'old')

    # Stop-time report ----------------------------------------------------------
    def test_stopping_a_conductor_reports_its_children_to_the_live_parent(self):
        self.task('open')
        self.stop('ended')
        self.ok('stop-request', 'old', 'stop-id', 'finished')
        rows = self.sql("SELECT sender,recipient,kind,body FROM messages WHERE id LIKE 'stop-orphans:%'")
        self.assertEqual(len(rows), 1)
        sender, recipient, kind, body = rows[0]
        self.assertEqual((sender, recipient, kind), ('old', 'root', 'report'))
        document = json.loads(body)
        self.assertEqual(document['type'], 'session-ended-with-children')
        children = {child['id']: child for child in document['children']}
        self.assertEqual(sorted(children), ['closed', 'open', 'unrequested'])
        self.assertTrue(children['open']['assignmentOpen'])
        self.assertFalse(children['closed']['assignmentOpen'])
        self.ok('stop-request', 'old', 'stop-id', 'finished')
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE id LIKE 'stop-orphans:%'"), [(1,)])

    def test_stopping_a_session_without_live_children_adds_no_report(self):
        self.ok('stop-request', 'closed', 'stop-leaf', 'finished')
        self.assertEqual(self.sql("SELECT count(*) FROM messages WHERE id LIKE 'stop-orphans:%'"), [(0,)])


if __name__ == '__main__':
    unittest.main()
