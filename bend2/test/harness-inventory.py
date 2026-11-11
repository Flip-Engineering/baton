"""Check the harness-inventory read over recorded sessions and profiles.

The inventory reports recorded harness/model/effort identities across
sessions with operator account profiles and limits. It runs no harness
command, writes nothing, and gates nothing (#792, #683, #598).
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))


class HarnessInventory(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.call('attach', 'reader', 'omp', 'native-1', '')
        self.call('attach', 'second', 'muse', 'native-2', '')
        self.call('attach', 'third', 'claude-code', 'native-3', '')
        with sqlite3.connect(self.db) as database:
            database.execute(
                "UPDATE sessions SET model='kimi-code/k3', effort='high', "
                "endpoint='[\"fixture-omp\"]', workspace=? WHERE id='reader'",
                (str(self.directory / 'reader-workspace'),))
            database.execute(
                "UPDATE sessions SET model='muse-spark-1.3-contributor', "
                "effort='high' WHERE id='second'")
        store = self.directory / 'omp store'
        store.mkdir()
        (self.directory / 'state.db.profiles').write_text(
            f'omp main {store}\ncodex fallback {store}\n')
        (self.directory / ('state.db.profile-' + 'reader'.encode().hex())).write_text(
            f' omp main {store}\n')

    def call(self, *args):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)],
                              text=True, capture_output=True)

    def read(self):
        result = self.call('harness-inventory')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_lists_recorded_identities_in_id_order_with_presence_bits(self):
        answer = self.read()
        self.assertEqual(answer['schema'], 'baton2-harness-inventory-v1')
        self.assertGreater(answer['observedAt'], 0)
        rows = answer['sessions']
        self.assertEqual([row['session'] for row in rows],
                         ['reader', 'second', 'third'])
        reader, second, third = rows
        self.assertEqual(
            (reader['harness'], reader['model'], reader['effort']),
            ('omp', 'kimi-code/k3', 'high'))
        self.assertEqual(
            (reader['observedHarness'], reader['observedModel'],
             reader['observedEffort']),
            ('', '', ''))
        self.assertTrue(reader['hasRecordedCommand'])
        self.assertTrue(reader['hasWorkspace'])
        self.assertEqual(reader['profile'],
                         {'harness': 'omp', 'label': 'main'})
        self.assertEqual(
            (second['harness'], second['model'], second['effort']),
            ('muse', 'muse-spark-1.3-contributor', 'high'))
        self.assertFalse(second['hasRecordedCommand'])
        self.assertFalse(second['hasWorkspace'])
        self.assertIsNone(second['profile'])
        self.assertEqual(
            (third['harness'], third['model'], third['effort']),
            ('claude-code', '', ''))
        self.assertIsNone(third['profile'])

    def test_unsupported_harness_is_listed_without_gating(self):
        rows = self.read()['sessions']
        third = next(row for row in rows if row['session'] == 'third')
        self.assertEqual(third['harness'], 'claude-code')
        self.assertFalse(third['hasRecordedCommand'])

    def test_reports_operator_profile_order_and_limits(self):
        answer = self.read()
        profiles = answer['profiles']
        self.assertEqual(profiles['state'], 'reported')
        self.assertEqual(
            [(entry['harness'], entry['label'])
             for entry in profiles['order']],
            [('omp', 'main'), ('codex', 'fallback')])
        self.assertTrue(answer['limits'])
        self.assertTrue(any('fallback preference' in limit
                            for limit in answer['limits']))
        self.assertTrue(any('decide nothing' in limit
                            for limit in answer['limits']))

    def test_missing_profile_list_is_unknown_with_cause(self):
        (self.directory / 'state.db.profiles').unlink()
        profiles = self.read()['profiles']
        self.assertEqual(profiles['state'], 'unknown')
        self.assertEqual(profiles['reason'], 'noOperatorProfileList')

    def test_the_read_records_nothing(self):
        before = self.call('status').stdout
        first = self.read()
        self.assertEqual(self.read(), first)
        self.assertEqual(self.call('status').stdout, before)
        sessions = subprocess.run(
            ['sqlite3', str(self.db),
             'SELECT count(*) FROM sessions; SELECT count(*) FROM messages;'],
            text=True, capture_output=True, check=True)
        self.assertEqual(sessions.stdout, '3\n0\n')


if __name__ == '__main__':
    unittest.main()
