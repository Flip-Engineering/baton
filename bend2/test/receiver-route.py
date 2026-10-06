"""Future native route-inspection cases; no provider or route change is requested.

BATON2_ROUTE_EXE must name the separately admitted compiled candidate.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


class ReceiverRoute(unittest.TestCase):
    def setUp(self):
        self.exe = Path(os.environ['BATON2_ROUTE_EXE']).resolve()
        temporary = tempfile.TemporaryDirectory(prefix='baton-route-inspection-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.db = self.directory / 'route.db'
        self.endpoint = '["node","/helper with spaces","launch","--model-key","old","--","/baton"]'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY, parent TEXT, harness TEXT, model TEXT, effort TEXT, endpoint TEXT, native TEXT, observed_harness TEXT, observed_model TEXT, observed_effort TEXT, workspace TEXT, branch TEXT, base TEXT)')
            db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       ('player', 'parent', 'omp', 'old', 'high', self.endpoint, 'original-native',
                        'omp', 'observed-old', 'high', '/work with spaces', 'branch', 'base'))
            db.execute('CREATE TABLE messages(id TEXT, body TEXT, receipt TEXT)')
            db.execute('INSERT INTO messages VALUES(?,?,NULL)', ('pending', 'retain full input'))
            db.execute('CREATE TABLE turns(id TEXT, event TEXT)')
            db.execute('INSERT INTO turns VALUES(?,?)', ('failed', 'HTTP429/type1308'))
        self.before = hashlib.sha256(self.db.read_bytes()).hexdigest()

    def inspect(self, expected='old', endpoint=None, model='deepseek/deepseek-flash', player='player'):
        run = subprocess.run([str(self.exe), str(self.db), 'receiver-route', player, expected,
                              self.endpoint if endpoint is None else endpoint, model, '--inspect'],
                             capture_output=True, text=True)
        self.assertEqual(run.returncode, 2, (run.stdout, run.stderr))
        self.assertEqual(run.stdout, '')
        answer = json.loads(run.stderr)
        self.assertFalse(answer['configurationApplied'])
        self.assertFalse(answer['providerStarted'])
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(), self.before)
        self.assertEqual(sorted(path.name for path in self.directory.iterdir()), ['route.db'])
        return answer

    def test_requested_route_does_not_replace_declared_or_observed_route(self):
        answer = self.inspect()
        self.assertEqual(answer['reason'], 'route-admission-unavailable')
        self.assertEqual(answer['requested']['model'], 'deepseek/deepseek-flash')
        self.assertEqual(answer['recorded'], {
            'parent': 'parent', 'harness': 'omp', 'model': 'old', 'effort': 'high',
            'endpoint': self.endpoint, 'native': 'original-native', 'observedHarness': 'omp',
            'observedModel': 'observed-old', 'observedEffort': 'high',
            'workspace': '/work with spaces', 'branch': 'branch', 'base': 'base'})
        self.assertEqual(answer['next'], [['session', 'player'], ['inbox', 'player', '--index'], ['turns', 'player']])

    def test_expected_model_and_exact_endpoint_are_both_compared(self):
        self.assertEqual(self.inspect(expected='different')['reason'], 'expected-route-mismatch')
        self.assertEqual(self.inspect(endpoint=self.endpoint + ' ')['reason'], 'expected-route-mismatch')

    def test_missing_actor_and_empty_request_are_distinct(self):
        self.assertEqual(self.inspect(player='missing')['reason'], 'session-missing')
        self.assertEqual(self.inspect(model='')['reason'], 'invalid-requested-model')

    def test_missing_database_remains_absent(self):
        absent = self.directory / 'absent.db'
        run = subprocess.run([str(self.exe), str(absent), 'receiver-route', 'player',
                              'old', self.endpoint, 'new', '--inspect'], capture_output=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertFalse(absent.exists())


if __name__ == '__main__':
    unittest.main()
