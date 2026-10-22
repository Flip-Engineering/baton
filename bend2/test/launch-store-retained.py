"""Retained-launch regression for the OMP and Muse configured store (#933).

The fixture drives Turn.retained_prepare with a profile record. The final argv
must bind PI_CODING_AGENT_DIR for OMP and XDG_CONFIG_HOME for Muse, with no
HOME assignment. A selected profile store overrides an inherited value, and
the OMP preflight checks the selected store. No provider is contacted.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/launch-store-retained-test'))
UNWRITABLE = pathlib.Path('/proc')


class RetainedStore(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'retained store fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        sqlite3.connect(self.db).close()
        self.attempt = self.root / 'attempt'
        self.attempt.mkdir()
        self.home = self.root / 'root-home'
        self.home.mkdir()
        self.owner = None

    def start_owner(self):
        self.owner = subprocess.Popen(
            [str(EXE), '--instance-owner', str(self.db)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.owner.poll() is not None:
                self.fail('instance owner exited before readiness: '
                          + (self.owner.stderr.read() or ''))
            witness = subprocess.run(
                [str(EXE), '--instance-witness', str(self.db)],
                capture_output=True, text=True, timeout=5)
            if witness.returncode == 0 and witness.stdout.strip():
                return
            time.sleep(0.05)
        self.fail('instance owner did not become ready')

    def tearDown(self):
        subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                       capture_output=True, timeout=20)
        if self.owner is not None:
            try:
                self.owner.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.owner.kill()
                self.owner.wait(timeout=10)

    def select(self, harness, store):
        (self.db.parent / (self.db.name + '.profiles')).write_text(
            harness + ' main ' + str(store) + '\n')
        record = self.root / (self.db.name + '.profile-' + 'store-fixture'.encode().hex())
        record.write_text(' ' + harness + ' main ' + str(store) + '\n')

    def run_fixture(self, harness, extra=None):
        self.start_owner()
        environment = {**os.environ, 'HOME': str(self.home)}
        if extra:
            environment.update(extra)
        return subprocess.run([str(EXE), str(self.db), str(self.attempt), harness],
                              env=environment, text=True, capture_output=True, timeout=120)

    def argv(self, harness, extra=None):
        result = self.run_fixture(harness, extra)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [line.split('\t', 1)[1] for line in result.stdout.splitlines()
                if line.startswith('arg\t')]

    def test_omp_profile_binds_agent_dir(self):
        store = self.root / 'omp-agent'
        store.mkdir()
        self.select('omp', store)
        argv = self.argv('omp', {'PI_CODING_AGENT_DIR': '/ambient-agent'})
        self.assertIn('PI_CODING_AGENT_DIR=' + str(store), argv)
        self.assertFalse([value for value in argv if value.startswith('HOME=')])
        self.assertNotIn('/ambient-agent', argv)

    def test_muse_profile_binds_config_home(self):
        store = self.root / 'muse-config'
        store.mkdir()
        self.select('muse', store)
        argv = self.argv('muse', {'XDG_CONFIG_HOME': '/ambient-config'})
        self.assertIn('XDG_CONFIG_HOME=' + str(store), argv)
        self.assertFalse([value for value in argv if value.startswith('HOME=')])
        self.assertNotIn('/ambient-config', argv)

    def test_no_profile_adds_no_store_binding(self):
        for harness in ('omp', 'muse'):
            with self.subTest(harness=harness):
                argv = self.argv(harness)
                self.assertFalse([value for value in argv if value.startswith('HOME=')])
                self.assertFalse([value for value in argv if value.startswith('PI_CODING_AGENT_DIR=')])
                self.assertFalse([value for value in argv if value.startswith('XDG_CONFIG_HOME=')])

    def test_unwritable_omp_profile_store_is_refused(self):
        self.select('omp', UNWRITABLE)
        result = self.run_fixture('omp')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('retained prepare failed', result.stderr)


if __name__ == '__main__':
    unittest.main()
