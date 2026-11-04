"""Run the OMP completion extension protocol fixture under the test recorder."""
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'bend2/test/omp-completion-extension.mjs'


class OmpCompletionExtension(unittest.TestCase):
    def test_session_stop_gate_and_completion_tool(self):
        result = subprocess.run(['node', str(FIXTURE)], cwd=ROOT,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('OMP session_stop gate and completion tool invoke Baton:ok',
                      result.stdout)


if __name__ == '__main__':
    unittest.main()
