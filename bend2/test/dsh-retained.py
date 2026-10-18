"""Bounded retained-launch checks for the DSH adapter.

The fixture derives DSH_HOME from a temporary database, prepares the two patch
overlays and calls the real retained launch composition. It spawns nothing.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/dsh-retained-test'))
SCHEMA = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, "
    "harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', "
    "effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', "
    "observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', "
    "observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', "
    "workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', "
    "base TEXT NOT NULL DEFAULT '');"
)


class DshRetained(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'DSH retained fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        self.link = self.root / 'link.db'
        self.attempt = self.root / 'attempt'
        self.attempt.mkdir()
        with sqlite3.connect(self.db) as database:
            database.executescript(SCHEMA)
            database.execute(
                "INSERT INTO sessions(id,harness,model,effort) VALUES"
                "('dsh-fixture','dsh','deepseek-flash','max')")
        self.link.symlink_to(self.db)

    def run_fixture(self):
        result = subprocess.run(
            [str(EXE), str(self.link), str(self.attempt), '/usr/bin/dsh',
             'deepseek/deepseek-flash', 'max', 'session-1'],
            text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_retained_argv_uses_seat_home_patches_and_stdin(self):
        output = self.run_fixture()
        argv = [line.split('\t', 1)[1] for line in output.splitlines()
                if line.startswith('arg\t')]
        home = str(self.db) + '.dsh-home-' + 'dsh-fixture'.encode().hex()
        self.assertEqual(argv[:3], ['/usr/bin/env', 'BATON_SESSION=dsh-fixture',
                                    '/usr/bin/env'])
        self.assertEqual(argv[3], 'DSH_HOME=' + home)
        self.assertEqual(argv[4], '/usr/bin/dsh')
        self.assertEqual(argv[5:], [
            '--profile', 'headless',
            '--patch', str(self.attempt / 'dsh-tools.patch.yml'),
            '--patch', str(self.attempt / 'dsh-model.patch.yml'),
            '--json', '--session-id', 'session-1'])
        self.assertIn('input\tfixture task', output)
        self.assertIn('keep\t0', output)
        self.assertIn('file\tfalse', output)

    def test_patch_inputs_are_the_minimal_roster_and_max_effort(self):
        self.run_fixture()
        tools = (self.attempt / 'dsh-tools.patch.yml').read_text()
        model = (self.attempt / 'dsh-model.patch.yml').read_text()
        self.assertIn('    read: false', tools)
        self.assertIn('    readImage: true', tools)
        self.assertIn('    write: false', tools)
        self.assertIn('    edit: false', tools)
        self.assertIn("name: '@deepseek-ai/dsh-tool-bash-persistent'", tools)
        self.assertIn('provider: deepseek-official', model)
        self.assertIn("model: 'deepseek-flash'", model)
        self.assertIn("reasoningEffort: 'max'", model)


if __name__ == '__main__':
    unittest.main()
