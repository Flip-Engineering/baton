"""Baton-level DSH turn checks.

The fixture drives the real DSH frame classifier, event projection, terminal
predicate and report SQL, and proves the stdin contract (raw task text and EOF).
It starts no model provider.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/dsh-turn-test'))


class DshTurn(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'DSH turn fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        self.out = self.root / 'stdin.out'

    def run_fixture(self):
        result = subprocess.run([str(EXE), str(self.db), str(self.out)],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    @staticmethod
    def values(output, key):
        return [line.split('\t', 1)[1] for line in output.splitlines()
                if line.startswith(key + '\t')]

    def test_frames_classify_and_the_final_frame_becomes_a_report(self):
        output = self.run_fixture()
        self.assertEqual(self.values(output, 'kind'),
                         ['session', 'text', 'tool_call', 'tool_result', 'final'])
        self.assertEqual(self.values(output, 'native'), ['session-9'])
        self.assertEqual(self.values(output, 'report'), ['answer'])
        turn = self.values(output, 'turn')[0]
        self.assertIn('"type":"result"', turn)
        self.assertIn('"result":"answer"', turn)
        self.assertEqual(self.values(output, 'terminal'), ['1'])

    def test_dsh_input_is_raw_text_and_send_prompt_closes_stdin(self):
        output = self.run_fixture()
        self.assertEqual(self.values(output, 'stdin'), ['hello'])


if __name__ == '__main__':
    unittest.main()
