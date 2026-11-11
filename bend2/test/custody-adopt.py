"""Same-session unknown-status custody against the current and deployed e6 keeper."""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROCESS_C = ROOT / '.scratch/bend2/process-test.c'
FIXTURE = ROOT / '.scratch/bend2/custody-adopt'
SOURCE = ROOT / 'bend2/test/custody-adopt.c'


class CustodyAdopt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        if not PROCESS_C.exists():
            result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                     'bend2/test/process.bend',
                                     '.scratch/bend2/process-test'],
                                    cwd=ROOT, capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)
        result = subprocess.run([
            os.environ.get('CC', 'clang'), '-O1', '-pthread',
            '-DBATON2_PROCESS_SOURCE=' + repr(str(PROCESS_C)).replace("'", '"'),
            str(SOURCE), '-lsqlite3', '-lm', '-o', str(FIXTURE),
        ], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def run_fixture(self, keeper=None):
        with tempfile.TemporaryDirectory(prefix='custody-adopt-', dir=ROOT / '.scratch/bend2') as name:
            argv = [str(FIXTURE), str(pathlib.Path(name) / 'attempt')]
            if keeper:
                argv.append(str(keeper))
            result = subprocess.run(argv, capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('custody-adopt PASS', result.stdout)

    def test_current_keeper_adopts_unknown_custody(self):
        self.run_fixture()

    def test_deployed_e6_keeper_adopts_unknown_custody(self):
        keeper = os.environ.get('BATON_E6_KEEPER')
        if not keeper:
            self.skipTest('BATON_E6_KEEPER is not set')
        self.run_fixture(keeper)


if __name__ == '__main__':
    unittest.main(verbosity=2)
