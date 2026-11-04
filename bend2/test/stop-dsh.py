"""Focused checks for DSH stop request recording (bend2/src/coordinator/stop.bend).

The fixture binary runs the real Stop.request over a temporary database. It
checks request recording and refusal behavior. It does not exercise signal
delivery, DSH native custody, reconciliation, or process termination.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_STOP_DSH_FIXTURE', ROOT / '.scratch/bend2/stop-dsh-test'))


class StopDsh(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not EXE.is_file() and 'BATON2_STOP_DSH_FIXTURE' not in os.environ:
            subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                            'bend2/test/stop-dsh.bend', str(EXE)],
                           cwd=ROOT, check=True)

    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='stop-dsh-')
        self.addCleanup(directory.cleanup)
        self.database = str(pathlib.Path(directory.name) / 'state.db')
        with sqlite3.connect(self.database):
            pass
        self.owner = subprocess.Popen(
            [str(EXE), '--instance-owner', self.database],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.shutdown_owner)
        while True:
            if self.owner.poll() is not None:
                status = self.owner.wait()
                self.fail('instance owner exited before readiness with status '
                          + str(status) + ': ' + (self.owner.stderr.read() or ''))
            witness = subprocess.run(
                [str(EXE), '--instance-witness', self.database],
                text=True, capture_output=True)
            if witness.returncode == 0 and witness.stdout.strip():
                break

    def shutdown_owner(self):
        if self.owner is None:
            return
        shutdown = None
        if self.owner.poll() is None:
            shutdown = subprocess.run(
                [str(EXE), '--instance-shutdown', self.database],
                text=True, capture_output=True)
        status = self.owner.wait()
        if status != 0:
            self.fail('instance owner exited with status ' + str(status)
                      + ': ' + (self.owner.stderr.read() or ''))
        if shutdown is not None:
            self.assertEqual(shutdown.returncode, 0, shutdown.stderr + shutdown.stdout)

    def test_dsh_stop_request_force_and_terminal_cases(self):
        result = subprocess.run([str(EXE), self.database], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('fixture-stop-dsh-ok', result.stdout)


if __name__ == '__main__':
    unittest.main()
