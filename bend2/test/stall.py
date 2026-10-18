"""Focused live fixtures for pending-input candidate classification and wake selection.

The fixtures write coordinator rows directly so each recorded state is exact:
an active attempt, an exited attempt, an explicit stop, a missing endpoint and an
existing wake claim. The report must classify all five; the wake command must
drive only the exited candidate and leave the other four unchanged.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Stall(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        scratch = ROOT / '.scratch/bend2'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.home = self.directory / 'home'
        self.runtime = self.directory / 'runtime'
        self.home.mkdir()
        self.runtime.mkdir()
        self.environment = dict(os.environ, HOME=str(self.home), XDG_RUNTIME_DIR=str(self.runtime))
        self.environment.pop('BATON2_GIT_REGISTRY', None)
        self.coord('attach', 'root', 'omp', 'native-root', '')
        self.fixtures()

    def tearDown(self):
        self.temp.cleanup()

    def coord(self, *args, ok=True):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True, env=self.environment)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout) if result.stdout.strip() else None
        return result

    def rows(self, statement, parameters=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(statement, parameters).fetchall()

    def endpoint(self, name):
        marker = self.directory / (name + '.marker')
        script = self.directory / (name + '.py')
        script.write_text(
            '#!/usr/bin/env python3\n'
            'import pathlib, sys\n'
            f'pathlib.Path({str(marker)!r}).open("a").write(" ".join(sys.argv)+"\\n")\n'
        )
        script.chmod(0o700)
        return json.dumps([str(script)])

    def session(self, name, phase, endpoint):
        self.rows('INSERT INTO sessions(id,parent,harness,model,effort,endpoint) VALUES(?,?,?,?,?,?)',
                  (name, 'root', 'omp', 'fixture', 'low', endpoint))
        if phase:
            self.rows('INSERT INTO executions(session,id,mode,directory,phase,status) VALUES(?,?,?,?,?,?)',
                      (name, 'attempt-' + name, 'retained', '', phase, 'exit 0'))
        self.rows('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                  ('owed-' + name, 'root', name, 'task', 'Owed work for ' + name))

    def fixtures(self):
        self.session('active', 'running', self.endpoint('active'))
        self.session('exited', 'exited', self.endpoint('exited'))
        self.session('stopped', 'exited', self.endpoint('stopped'))
        self.session('blocked', 'exited', '')
        self.session('claimed', 'exited', self.endpoint('claimed'))
        self.rows("INSERT INTO session_stops(session,id,reason,attempt,directory,outcome) VALUES(?,?,?,?,?,?)",
                  ('stopped', 'stop-stopped', 'operator stop', '', '', 'stopped'))
        self.rows("INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) VALUES(?,?,?,?)",
                  ('claimed', 'claimed', 'owed-claimed', 1))

    def wait_for(self, path, timeout=8):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if path.exists():
                return True
            time.sleep(0.05)
        return False

    def test_report_classifies_pending_candidates(self):
        report = self.coord('stall')
        rows = {row['id']: row for row in report['candidates']}
        self.assertEqual({name: row['state'] for name, row in rows.items()},
                         {'active': 'active', 'exited': 'stalled', 'stopped': 'stopped',
                          'blocked': 'blocked', 'claimed': 'claimed'})
        self.assertEqual(rows['exited']['owedMessage'], 'owed-exited')
        self.assertEqual(rows['exited']['attempt']['phase'], 'exited')
        self.assertEqual(rows['stopped']['stopped'], 1)
        self.assertEqual(rows['blocked']['endpointPresent'], 0)
        self.assertEqual(rows['claimed']['claim'], 'claimed')

    def test_report_without_the_claim_table(self):
        self.rows('DROP TABLE wake_claims')
        report = self.coord('stall')
        rows = {row['id']: row for row in report['candidates']}
        self.assertEqual(rows['claimed']['state'], 'stalled')
        self.assertEqual(rows['claimed']['claim'], '')

    def test_wake_drives_only_the_stalled_candidate(self):
        self.coord('stall-wake')
        claims = {session: state for session, state in self.rows('SELECT session,state FROM wake_claims')}
        self.assertEqual(claims.get('exited'), 'claimed')
        self.assertNotIn('active', claims)
        self.assertNotIn('blocked', claims)
        self.assertNotIn('stopped', claims)
        self.assertEqual(claims.get('claimed'), 'claimed')
        self.assertTrue(self.wait_for(self.directory / 'exited.marker'),
                        'the stalled candidate was not delivered')
        time.sleep(0.5)
        for name in ('active', 'stopped', 'blocked', 'claimed'):
            self.assertFalse((self.directory / (name + '.marker')).exists(),
                             f'{name} candidate was driven')
        self.assertEqual(len(self.rows('SELECT 1 FROM session_stops WHERE session=?', ('stopped',))), 1)


if __name__ == '__main__':
    unittest.main()
