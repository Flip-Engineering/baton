"""Doc 56: a coordinator's pending notice lists its open children, and the standing texts treat a
shown result as settled.

The probe seeds a scratch orchestra with one coordinator and children in each state the digest
distinguishes (open, confirmed, continued, stopped, grandchild, waiting completion request,
answered request, unanswered question, unread reports, current and elapsed usage holds) and
checks the composed notice and the three standing texts. Red until doc 56 lands.
"""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROBE = ROOT / '.scratch/bend2/coordinator-digest'
CHECKS = ['leaf unchanged', 'open child listed', 'confirmed child omitted', 'continuation reopens',
          'stopped child omitted', 'grandchild omitted', 'waiting completion request',
          'answered completion request', 'unanswered question', 'new message count',
          'usage hold shown', 'usage hold elapsed', 'paragraph present', 'standing text']


class CoordinatorDigest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                 'bend2/test/coordinator-digest.bend', str(PROBE)], cwd=ROOT)
        if result.returncode:
            raise AssertionError('coordinator digest probe build exited ' + str(result.returncode))

    def test_digest_and_standing_text(self):
        with tempfile.TemporaryDirectory(prefix='coordinator-digest-', dir=ROOT / '.scratch/bend2') as name:
            database = pathlib.Path(name) / 'state.db'
            result = subprocess.run([str(PROBE), str(database)], capture_output=True, text=True)
            observed = [line[:-3] for line in result.stdout.splitlines() if line.endswith(':ok')]
            print(json.dumps({'test': self.id(), 'exit': result.returncode, 'passed': observed,
                              'stderr': result.stderr[-2000:]}))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(observed, CHECKS)


if __name__ == '__main__':
    unittest.main()
