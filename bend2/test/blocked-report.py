"""A seat that cannot go on says so with its own message kind.

blocked --text TEXT sends a message of kind blocked to the seat's recorded
coordinator. The stop hook then lets the turn end without a completion
request, the assignment stays open, and the seat's status state is blocked.
The end of that turn queues no continuation and sends no open-assignment
report, and the state stays blocked until the coordinator sends the seat new
input or the seat sends a completion request.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))


class BlockedReport(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.fail(f'Coordinator not built at {EXE}')
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.environment = {key: value for key, value in os.environ.items()
                            if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON2_GIT_REGISTRY')}
        self.environment['HOME'] = str(self.directory / 'home')
        (self.directory / 'home').mkdir()
        self.addCleanup(self.shutdown)
        self.call('attach', 'operator', 'fixture', '', '')
        self.call('role', 'operator', 'operator')
        # A supported harness and a recorded endpoint, so no route cause sets the
        # blocked state.
        self.call('attach', 'seat', 'claude-code', '', json.dumps(['/bin/true']))
        self.call('role', 'seat', 'principal-conductor')
        self.call('message', 'seat-task', 'operator', 'seat', 'task', 'Build from commit X.')

    def shutdown(self):
        if self.db.exists():
            subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                           capture_output=True, text=True, env=self.environment)

    def call(self, *args):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True, env=self.environment)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def stop_hook(self):
        result = subprocess.run([str(EXE), '--stop-hook'], input=json.dumps({'hook_event_name': 'Stop'}),
                                capture_output=True, text=True,
                                env={**self.environment, 'BATON_SESSION': 'seat', 'BATON_DATABASE': str(self.db)})
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_a_blocked_report_reaches_the_operator_and_releases_the_stop_hook(self):
        self.call('as', 'seat', 'read', 'seat-task')
        held = json.loads(self.stop_hook())
        self.assertEqual(held['decision'], 'block')
        self.assertIn('blocked --text', held['reason'])
        sent = self.call('as', 'seat', 'blocked', '--text', 'The remote has no commit X.')[0]
        self.assertEqual(sent['status'], 'completed', sent)
        with sqlite3.connect(self.db) as db:
            stored = db.execute("SELECT id,recipient,kind,body FROM messages WHERE sender='seat' "
                                "ORDER BY seq DESC LIMIT 1").fetchone()
        self.assertTrue(stored[0].startswith('blocked:'), stored)
        self.assertEqual(stored[1:], ('operator', 'blocked', 'The remote has no commit X.'))
        self.assertEqual(self.stop_hook(), '')
        row = next(row for row in self.call('status') if row['id'] == 'seat')
        self.assertEqual(row['state'], 'blocked')
        self.assertEqual(row['operatorLatest']['kind'], 'blocked')
        completion = self.call('session', 'seat')['taskCompletion']
        self.assertTrue(completion['open'])
        self.assertIsNone(completion['requestId'])

    def seat_row(self):
        return next(row for row in self.call('status') if row['id'] == 'seat')

    def test_the_turn_end_after_a_blocked_report_queues_no_continuation(self):
        self.call('as', 'seat', 'read', 'seat-task')
        native = self.directory / 'blocked-native'
        runs = self.directory / 'native-runs'
        native.write_text('#!' + sys.executable + '\n' + textwrap.dedent(f'''
            import json, pathlib, re, subprocess, sys
            coordinator = [{str(EXE)!r}, {str(self.db)!r}, 'as', 'seat']
            if sys.argv[1:] == ['--version']:
                print('2.0.0 (Claude Code)')
                sys.exit(0)
            runs = pathlib.Path({str(runs)!r})
            with runs.open('a') as record: record.write('run\\n')
            # A queued continuation would start the native again; that run fails
            # at once, so the turn ends there.
            if len(runs.read_text().splitlines()) > 1: sys.exit(1)
            prompt = json.loads(sys.stdin.readline())['message']['content']
            for ident in dict.fromkeys(re.findall(r'\\[id: ([^\\]]+)\\]', prompt)):
                subprocess.run([*coordinator, 'read', ident], capture_output=True)
            subprocess.run([*coordinator, 'blocked', '--text', 'The remote has no commit X.'],
                           check=True, capture_output=True)
            print(json.dumps({{'type': 'system', 'subtype': 'init', 'session_id': 'native-blocked',
                              'model': 'fixture-model'}}), flush=True)
            print(json.dumps({{'type': 'result', 'result': 'The remote has no commit X.',
                              'session_id': 'native-blocked', 'is_error': False}}), flush=True)
            '''))
        native.chmod(0o700)
        task = self.directory / 'task.txt'
        task.write_text('Build from commit X.')
        result = subprocess.run([str(EXE), str(self.db), 'turn', 'seat', 'turn-1', str(native), 'fixture-model',
                                 'high', str(self.directory), str(task), str(self.directory / 'turn.jsonl'), ''],
                                capture_output=True, text=True, env=self.environment, timeout=300)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with sqlite3.connect(self.db) as db:
            kinds = db.execute("SELECT id,kind FROM messages WHERE sender='seat' ORDER BY seq").fetchall()
            continuations = db.execute("SELECT id FROM messages WHERE recipient='seat' "
                                       "AND kind='task-continuation'").fetchall()
            reports = db.execute("SELECT body FROM messages WHERE sender='seat' AND kind='report' "
                                 "AND body LIKE '%sent no completion request%'").fetchall()
        self.assertEqual(continuations, [])
        self.assertEqual(runs.read_text().splitlines(), ['run'], kinds)
        # The turn's own report follows the blocked report.
        order = [ident for ident, kind in kinds if kind == 'blocked' or ident == 'turn-1']
        self.assertEqual(len(order), 2, kinds)
        self.assertEqual(order[1], 'turn-1', kinds)
        self.assertEqual(continuations, [])
        self.assertEqual(reports, [])
        row = self.seat_row()
        self.assertEqual(row['state'], 'blocked', row)
        self.assertEqual(row['blockedCause'], 'blocked-report')
        self.assertEqual(row['blockedReport']['body'], 'The remote has no commit X.')
        self.assertTrue(row['taskCompletion']['open'])
        self.assertIsNone(row['taskCompletion']['requestId'])

    def test_a_blocked_report_holds_until_coordinator_input_or_a_completion_request(self):
        self.call('as', 'seat', 'read', 'seat-task')
        self.call('as', 'seat', 'blocked', '--text', 'The remote has no commit X.')
        self.call('as', 'seat', 'report', '--text', 'Turn ended.')
        self.assertEqual(self.seat_row()['state'], 'blocked')
        self.call('message', 'operator-note', 'operator', 'seat', 'report', 'Commit X is pushed now.')
        row = self.seat_row()
        self.assertNotEqual(row['state'], 'blocked', row)
        self.assertNotIn('blockedReport', row)
        self.call('as', 'seat', 'read', 'operator-note')
        self.call('as', 'seat', 'blocked', '--text', 'The build needs a newer compiler.')
        self.assertEqual(self.seat_row()['state'], 'blocked')
        self.call('as', 'seat', 'completion-request', '--text', 'Built from commit X.')
        row = self.seat_row()
        self.assertEqual(row['state'], 'asks-to-end', row)
        self.assertNotIn('blockedReport', row)


if __name__ == '__main__':
    unittest.main()
