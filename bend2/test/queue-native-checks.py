"""Check adapter exit disposition with small subprocesses; no compiler runs."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
ADAPTER = Path(os.environ.get(
    'BATON2_NATIVE_QUEUE_ADAPTER', ROOT / '.github/scripts/queue-native-checks.py'))


@unittest.skipUnless(os.name == 'posix', 'Linux CI adapter requires POSIX signals')
class AdapterExitTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='queue-adapter-exit-')
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name) / 'output.c'

    def run_child(self, code, *args):
        return subprocess.run([
            sys.executable, str(ADAPTER), 'execute-cgen', str(self.output),
            sys.executable, '-c', code, *args], capture_output=True)

    def assert_signal(self, signum):
        result = self.run_child(
            'import os, signal; os.kill(os.getpid(), ' + str(signum) + ')')
        self.assertEqual(result.returncode, -signum, result.stderr)
        self.assertFalse(self.output.exists())

    def test_compiler_sigkill_is_visible_to_the_queue(self):
        self.assert_signal(signal.SIGKILL)

    def test_compiler_sigterm_is_visible_to_the_queue(self):
        self.assert_signal(signal.SIGTERM)

    def test_nonzero_exit_and_output_are_preserved(self):
        result = self.run_child(
            'import sys; print("child stdout"); '
            'print("child stderr", file=sys.stderr); sys.exit(17)')
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stdout, b'child stdout\n')
        self.assertEqual(result.stderr, b'child stderr\n')
        self.assertFalse(self.output.exists())

    def test_successful_check_creates_its_artifact(self):
        result = self.run_child('pass')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_text(),
                         '/* Compiler check completed successfully. */\n')

    def test_generated_output_is_preserved(self):
        result = self.run_child(
            'from pathlib import Path; import sys; '
            'Path(sys.argv[2]).write_text("generated output\\n")',
            '-o', str(self.output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_text(), 'generated output\n')


if __name__ == '__main__':
    unittest.main()
