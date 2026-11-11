"""Check retained hierarchy command diagnostics with real subprocesses."""
import importlib.util
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'hierarchy_diagnostics', ROOT / 'bend2/scripts/accept-kimi-hierarchy.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)

EMIT = ('import sys; sys.stdout.write(sys.argv[1]); '
        'sys.stderr.write(sys.argv[2]); sys.exit(int(sys.argv[3]))')


class CommandDiagnostics(unittest.TestCase):
    def command(self, stdout, stderr, code):
        return DRIVER.command([sys.executable, '-c', EMIT, stdout, stderr, str(code)])

    def test_failure_preserves_complete_stdout_and_stderr(self):
        stdout = 'stdout context Ω\n' + 'output detail\n' * 1024 + 'stdout completion\n'
        stderr = ('stderr cause λ: initial diagnostic must remain available\n'
                  + 'diagnostic detail\n' * 1024 + 'stderr completion\n')
        with self.assertRaises(RuntimeError) as raised:
            self.command(stdout, stderr, 7)
        diagnostic = str(raised.exception)
        self.assertIn('exited 7', diagnostic)
        self.assertTrue(stdout in diagnostic, 'Complete stdout is missing from the failure')
        self.assertTrue(stderr in diagnostic, 'Complete stderr is missing from the failure')

    def test_failure_preserves_stdout_when_stderr_empty(self):
        stdout = 'Failure reported on stdout Ω\n\n  Preserve trailing spaces.  \n'
        with self.assertRaises(RuntimeError) as raised:
            self.command(stdout, '', 3)
        diagnostic = str(raised.exception)
        self.assertIn('exited 3', diagnostic)
        self.assertTrue(stdout in diagnostic, 'Stdout-only failure details are missing')

    def test_success_returns_stripped_stdout(self):
        stdout = '  command result Ω\n' + 'output detail\n' * 1024 + '  \n'
        self.assertEqual(self.command(stdout, 'diagnostic warning λ\n', 0), stdout.strip())


if __name__ == '__main__':
    unittest.main()
