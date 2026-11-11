"""Read the orchestra and section projections while an orphaned membership row exists."""
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class OrchestraMembers(unittest.TestCase):
    """A membership whose session has no Player row is left out of the projection."""

    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='orchestra-members-', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        for argv in (['git', 'init', '-q', '-b', 'main', str(self.repo)],
                     ['git', '-C', str(self.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(self.repo), 'config', 'user.name', 'Orchestra fixture']):
            subprocess.run(argv, check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'], check=True, capture_output=True)
        base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                              check=True, capture_output=True, text=True).stdout.strip()

        self.call('attach', 'root', 'native-test', 'root-session', 'native-endpoint')
        self.call('role', 'root', 'principal-conductor')
        self.call('recruit', 'worker', 'root', 'requested-harness', 'requested-model', 'high',
                  str(self.repo), 'worker-branch', str(self.directory / 'worker'), base)
        self.call('ensemble', 'e1', 'root', 'tight')
        self.call('ensemble-member', 'e1', 'root', 'worker', 'add')
        self.call('section', 'e1', 's1', 'root', 'analysis')
        self.call('section-member', 'e1', 's1', 'root', 'worker', 'add')

        # A writer with foreign keys off leaves membership rows for a session that never
        # had a Player row. The read has to omit them; the rows stay recorded.
        self.orphans = sqlite3.connect(self.db)
        self.addCleanup(self.orphans.close)
        self.orphans.execute('PRAGMA foreign_keys=OFF')
        self.orphans.execute("INSERT INTO ensemble_members(ensemble,session) VALUES('e1','ghost-9')")
        self.orphans.execute("INSERT INTO section_members(ensemble,section,session) VALUES('e1','s1','ghost-9')")
        self.orphans.commit()

    def call(self, *args):
        proc = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    @unittest.skipUnless(EXE.exists(), 'Native coordinator is required')
    def test_reads_omit_a_membership_without_a_player_record(self):
        orchestra = self.call('orchestra')
        ensemble = orchestra['ensembles'][0]
        self.assertEqual(ensemble['members'], ['worker'])
        self.assertEqual(ensemble['sections'][0]['members'], ['worker'])
        self.assertEqual(self.call('section', 'e1', 's1')['members'], ['worker'])
        self.assertEqual(sorted(player['id'] for player in orchestra['players']), ['root', 'worker'])
        self.assertNotIn('ghost-9', json.dumps(orchestra))
        self.assertEqual(self.orphans.execute(
            "SELECT session FROM section_members WHERE ensemble='e1' AND section='s1' ORDER BY session").fetchall(),
            [('ghost-9',), ('worker',)])
        self.assertEqual(self.orphans.execute(
            "SELECT count(*) FROM ensemble_members WHERE session='ghost-9'").fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
