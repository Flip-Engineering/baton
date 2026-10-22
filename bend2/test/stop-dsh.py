"""Focused checks for the stop request on DSH sessions (bend2/src/coordinator/stop.bend).

The fixture binary runs the real Stop.request over a temporary database. No
native process or model provider is contacted here.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/stop-dsh-test'))


class StopDsh(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='stop-dsh-')
        self.addCleanup(directory.cleanup)
        self.database = str(pathlib.Path(directory.name) / 'state.db')
        self.addCleanup(self.shutdown_owner)

    def shutdown_owner(self):
        result = subprocess.run([str(EXE), '--instance-shutdown', self.database],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dsh_stop_request_force_and_terminal_cases(self):
        result = subprocess.run([str(EXE), self.database], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('fixture-stop-dsh-ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
