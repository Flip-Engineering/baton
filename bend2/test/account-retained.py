"""Focused retained account-binding test.

Drives the real retained_prepare_checked for claude-code with one subscription
account. The fixture starts its own instance owner, composes the argv and
records the attempt. No credential or provider is used.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/account-retained-test'))


class AccountRetained(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'account retained fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        sqlite3.connect(self.db).close()
        self.attempt = self.root / 'attempt'
        self.attempt.mkdir()
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

    def test_single_account_selection_reaches_the_argv_and_record(self):
        self.start_owner()
        result = subprocess.run([str(EXE), str(self.db), str(self.attempt)],
                                text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = result.stdout
        self.assertIn('CLAUDE_CONFIG_DIR=/fixture/store', output)
        self.assertIn('attempt\tclaude-sub\tsubscription\t/fixture/store', output)
        self.assertIn('keep\t0', output)
        self.assertIn('fixture prompt', output)
        self.assertNotIn('forced_login_method', output)


if __name__ == '__main__':
    unittest.main()
