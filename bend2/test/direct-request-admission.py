"""Execute DirectRequest decision SQL through the compiled Bend fixture entry.

This suite qualifies request/admission functions on fresh SQLite databases.
Preparation identities are constructed fixture values: no keeper, native process,
public direct command, lifetime evidence or notification is qualified here.
Compile direct-request-admission.bend and set BATON2_DIRECT_ADMISSION_EXE.
BATON2_BASELINE_EXE supplies ordinary attach for fresh fixture schema setup.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

EXE = os.environ.get('BATON2_DIRECT_ADMISSION_EXE')
BASELINE = os.environ.get('BATON2_BASELINE_EXE')


class Admission(unittest.TestCase):
    def setUp(self):
        self.assertTrue(EXE and Path(EXE).is_file(), 'set compiled BATON2_DIRECT_ADMISSION_EXE')
        self.assertTrue(BASELINE and Path(BASELINE).is_file(), 'set BATON2_BASELINE_EXE')
        self.temp = tempfile.TemporaryDirectory(prefix='direct-admission-')
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'fixture.db'
        for name in ('owner', 'child'):
            subprocess.run([BASELINE, str(self.db), 'attach', name, 'muse', '', ''],
                           capture_output=True, text=True, check=True, timeout=20)
        self.sql("UPDATE sessions SET parent='owner',model='model',effort='high',workspace='/workspace' WHERE id='child'")

    def sql(self, sql, parameters=()):
        with sqlite3.connect(self.db) as db:
            return db.execute(sql, parameters).fetchall()

    def run_decision(self, ident='first', directory='/attempt-first', task='task'):
        return subprocess.run([EXE, str(self.db), ident, directory, task],
                              capture_output=True, text=True, timeout=20)

    def decide(self, *args):
        result = self.run_decision(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_exact_replay_preserves_request_and_execution(self):
        first = self.decide()
        self.assertEqual(first['admissionDecision'], 'accepted')
        old = self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')
        self.assertEqual(self.decide(), first)
        self.assertEqual((self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')), old)

    def test_complete_defined_identity_names_each_conflicting_field(self):
        original = self.decide('first', '/attempt-first', "Unicode λ ' ;\ncontrol")['request']
        expected = {'version', 'session', 'harness', 'parent', 'recipient',
                    'assignmentModel', 'assignmentEffort', 'assignmentWorkspace',
                    'completionTarget', 'executable', 'model', 'effort', 'workspace',
                    'output', 'taskPath', 'task', 'explicitResume', 'resolvedResume',
                    'adapterArgv', 'initial', 'keepStdin'}
        self.assertEqual(set(original), expected)
        for field in sorted(expected):
            with self.subTest(field=field):
                changed = {**original, field: 'different'}
                answer = subprocess.run([EXE, str(self.db), json.dumps(original), json.dumps(changed)],
                                        capture_output=True, text=True, timeout=20)
                self.assertEqual(answer.returncode, 0, answer.stderr)
                self.assertEqual(answer.stdout, field + '\n')
        changed = {**original, 'explicitResume': ''}
        answer = subprocess.run([EXE, str(self.db), json.dumps(original), json.dumps(changed)],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(answer.stdout, 'explicitResume\n')

    def test_different_ids_compete_without_overwriting_active_execution(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(lambda ident: self.decide(ident, '/attempt-' + ident), ['one', 'two']))
        accepted = [a for a in answers if a['admissionDecision'] == 'accepted']
        rejected = [a for a in answers if a['admissionDecision'] == 'rejected']
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]['reason'], 'direct-execution-unresolved')
        self.assertEqual(self.sql('SELECT id FROM executions'), [(accepted[0]['requestId'],)])

    def test_task_and_directory_conflicts_preserve_original(self):
        first = self.decide()
        old = self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')
        for ident, directory, task, field in (
                ('first', '/attempt-first', 'changed', 'task'),
                ('first', '/another-attempt', 'task', 'attemptDirectory')):
            conflict = self.decide(ident, directory, task)
            self.assertEqual(conflict['error'], 'direct-request-conflict')
            self.assertEqual(conflict['field'], field)
            self.assertEqual(conflict['originalRequest'], first['request'])
            self.assertEqual((self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')), old)

    def test_rejected_decision_remains_rejected_after_facts_change(self):
        self.sql("INSERT INTO executions VALUES('child','legacy','direct','','starting','')")
        first = self.decide()
        self.assertEqual((first['admissionDecision'], first['reason']), ('rejected', 'direct-execution-unresolved'))
        self.assertEqual(self.sql("SELECT id,directory FROM executions WHERE session='child'"), [('legacy', '')])
        self.sql("UPDATE executions SET phase='exited'")
        self.assertEqual(self.decide(), first)
        self.assertEqual(self.sql("SELECT id FROM executions WHERE session='child'"), [('legacy',)])

    def test_stop_wins_new_admission_and_remains_the_winner(self):
        self.sql("INSERT INTO session_stops(session,id,reason,outcome) VALUES('child','stop','fixture','stopped')")
        first = self.decide()
        self.assertEqual((first['admissionDecision'], first['reason']), ('rejected', 'direct-session-stopped'))
        self.sql('DELETE FROM session_stops')
        self.assertEqual(self.decide(), first)
        self.assertEqual(self.sql('SELECT * FROM executions'), [])

    def test_historical_retry_leaves_newer_pointer_unchanged(self):
        self.decide()
        self.sql("UPDATE direct_requests SET phase='exited',outcome='exit 0',local_result='saved first',lifetime='ended' WHERE id='first'")
        self.sql("UPDATE executions SET phase='exited',status='exit 0'")
        newer = self.decide('second', '/attempt-second', 'second task')
        self.assertEqual(newer['admissionDecision'], 'accepted')
        before = self.sql('SELECT * FROM executions')
        old = self.decide()
        self.assertEqual(old['localResult'], 'saved first')
        self.assertEqual(old['lifetime'], 'ended')
        self.assertEqual(self.sql('SELECT * FROM executions'), before)

    def test_concurrent_identical_decisions_return_one_row(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(lambda _: self.decide(), range(2)))
        self.assertEqual(answers[0], answers[1])
        self.assertEqual(self.sql('SELECT id FROM direct_requests'), [('first',)])
        self.assertEqual(self.sql('SELECT id FROM executions'), [('first',)])

    def test_concurrent_different_requests_choose_one_immutable_identity(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            answers = list(pool.map(lambda task: self.decide('first', '/attempt-first', task), ['one', 'two']))
        accepted = [a for a in answers if a.get('admissionDecision') == 'accepted']
        conflicts = [a for a in answers if a.get('error') == 'direct-request-conflict']
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]['originalRequest'], accepted[0]['request'])

    def test_sql_error_rolls_back_request_and_execution_together(self):
        self.sql("CREATE TRIGGER fixture_abort BEFORE INSERT ON executions BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
        failed = self.run_decision()
        self.assertEqual(failed.returncode, 19)
        self.assertIn('fixture failure', failed.stderr)
        self.assertEqual(failed.stdout, '')
        self.assertEqual(self.sql('SELECT * FROM executions'), [])
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='direct_requests'"), [])


if __name__ == '__main__':
    unittest.main()
