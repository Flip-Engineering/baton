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
EVIDENCE = Path(tempfile.mkdtemp(prefix='direct-admission-evidence-'))
print(f'Direct admission child evidence: {EVIDENCE}', flush=True)


def captured(argv, check=False):
    destination = Path(tempfile.mkdtemp(prefix='child-', dir=EVIDENCE))
    (destination / 'argv.json').write_text(json.dumps(argv), encoding='utf-8')
    try:
        result = subprocess.run(argv, capture_output=True, timeout=20)
    except subprocess.TimeoutExpired as error:
        (destination / 'stdout').write_bytes(error.stdout or b'')
        (destination / 'stderr').write_bytes(error.stderr or b'')
        (destination / 'outcome.json').write_text(json.dumps({'timeout': error.timeout}))
        raise
    (destination / 'stdout').write_bytes(result.stdout)
    (destination / 'stderr').write_bytes(result.stderr)
    (destination / 'outcome.json').write_text(json.dumps({'returncode': result.returncode}))
    if check:
        result.check_returncode()
    return subprocess.CompletedProcess(argv, result.returncode,
                                       result.stdout.decode('utf-8'), result.stderr.decode('utf-8'))


class Admission(unittest.TestCase):
    def setUp(self):
        self.assertTrue(EXE and Path(EXE).is_file(), 'set compiled BATON2_DIRECT_ADMISSION_EXE')
        self.assertTrue(BASELINE and Path(BASELINE).is_file(), 'set BATON2_BASELINE_EXE')
        self.temp = tempfile.TemporaryDirectory(prefix='direct-admission-')
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'fixture.db'
        for name in ('owner', 'child'):
            captured([BASELINE, str(self.db), 'attach', name, 'muse', '', ''], check=True)
        self.sql("UPDATE sessions SET parent='owner',model='model',effort='high',workspace='/workspace' WHERE id='child'")

    def sql(self, sql, parameters=()):
        with sqlite3.connect(self.db) as db:
            return db.execute(sql, parameters).fetchall()

    def run_decision(self, ident='first', directory='/attempt-first', task='task'):
        return captured([EXE, str(self.db), ident, directory, task])

    def decide(self, *args):
        result = self.run_decision(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def run_readback(self, ident='first'):
        # This fixture executes the SQL on its own database. It does not supply
        # the qualified binding or prepared keeper required by a product caller.
        return captured([EXE, 'readback', str(self.db), ident])

    def readback(self, ident='first'):
        result = self.run_readback(ident)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_readback_keeps_original_completion_after_newer_admission(self):
        admitted = self.decide()
        self.sql("UPDATE direct_requests SET phase='exited',outcome='exit 7',local_result='original result',result_message='original-report',notification='pending',cleanup='owed',lifetime='ended' WHERE id='first'")
        self.sql("UPDATE executions SET phase='exited',status='exit 7'")
        original = self.readback()
        self.assertEqual(original, dict(admitted, lookup='retained', phase='exited',
                                       outcome='exit 7', localResult='original result',
                                       resultId='original-report', notification='pending',
                                       cleanup='owed', lifetime='ended'))
        self.assertEqual(original['lookup'], 'retained')
        self.assertEqual(original['attemptDirectory'], '/attempt-first')
        self.assertEqual(original['keeper'], {'pid': 42, 'birth': 'fixture'})
        self.assertEqual(original['localResult'], 'original result')
        self.assertEqual(original['resultId'], 'original-report')
        self.assertEqual(original['outcome'], 'exit 7')
        self.assertEqual(original['notification'], 'pending')
        self.assertEqual(original['cleanup'], 'owed')
        self.assertEqual(original['lifetime'], 'ended')
        self.decide('second', '/attempt-second', 'second task')
        before = self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')
        self.assertEqual(self.readback(), original)
        self.assertEqual((self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')), before)

    def test_readback_preserves_rejection_after_predicates_change(self):
        self.sql("INSERT INTO session_stops(session,id,reason,outcome) VALUES('child','stop','fixture','stopped')")
        rejected = self.decide()
        self.sql('DELETE FROM session_stops')
        self.assertEqual(self.readback(), dict(rejected, lookup='retained'))
        self.assertEqual(self.sql('SELECT * FROM executions'), [])

    def test_readback_absence_and_literal_identity_do_not_admit(self):
        self.decide()
        ident = "absent' OR 1=1; -- λ\n"
        before = self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')
        self.assertEqual(self.readback(ident), {'lookup': 'absent', 'requestId': ident})
        self.assertEqual((self.sql('SELECT * FROM direct_requests'), self.sql('SELECT * FROM executions')), before)

    def test_readback_missing_schema_is_an_error(self):
        result = self.run_readback()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no such table: direct_requests', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='direct_requests'"), [])
        self.assertEqual(self.sql('SELECT * FROM executions'), [])

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
                answer = captured([EXE, str(self.db), json.dumps(original), json.dumps(changed)])
                self.assertEqual(answer.returncode, 0, answer.stderr)
                self.assertEqual(answer.stdout, field + '\n')
        changed = {**original, 'explicitResume': ''}
        answer = captured([EXE, str(self.db), json.dumps(original), json.dumps(changed)])
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
