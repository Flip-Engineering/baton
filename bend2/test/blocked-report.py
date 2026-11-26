"""A seat that cannot go on says so with its own message kind.

blocked --text TEXT sends a message of kind blocked to the seat's recorded
coordinator. The stop hook then lets the turn end without a completion
request, the assignment stays open, and the seat's status state is blocked.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
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
        self.call('attach', 'seat', 'fixture', '', '')
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


if __name__ == '__main__':
    unittest.main()
