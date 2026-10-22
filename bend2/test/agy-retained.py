"""Retained receive checks for the agy player.

The fixture resumes a native conversation through agy-player.bend, writes the user
frame and reads stdout to EOF. The fake agy (bend2/test/fake-agy) records argv and
stdin and replays a constructed resumed-turn fixture. No model provider is contacted.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/agy-retained-test'))
FAKE = ROOT / 'bend2/test/fake-agy'
FIXTURE = ROOT / 'bend2/test/fixtures/agy/resumed-success.jsonl'
SESSION = 'c622d4e6-ea22-4a9d-b6be-b365ab31d87f'
TEXT = 'hello agy'


class AgyRetained(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'agy retained fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.argv_file = self.root / 'argv'
        self.stdin_file = self.root / 'stdin'

    def run_fixture(self):
        env = dict(os.environ, FAKE_AGY_FIXTURE=str(FIXTURE),
                   FAKE_AGY_ARGV=str(self.argv_file), FAKE_AGY_STDIN=str(self.stdin_file))
        result = subprocess.run([str(EXE), str(FAKE), str(self.root), SESSION, TEXT],
                                text=True, capture_output=True, env=env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    @staticmethod
    def stdout_frames(output):
        return [json.loads(line.split('\t', 1)[1]) for line in output.splitlines()
                if line.startswith('out\t')]

    def test_resume_argv_carries_the_native_conversation_last(self):
        self.run_fixture()
        argv = self.argv_file.read_bytes().split(b'\0')
        self.assertEqual(argv[0].decode(), str(FAKE))
        self.assertEqual([arg.decode() for arg in argv[1:]], [
            '--input-format', 'stream-json', '--output-format', 'stream-json',
            '--dangerously-skip-permissions', '--print-timeout', '0',
            '--model', 'agy-model-test', '--effort', 'high',
            '--conversation', SESSION])

    def test_stdin_is_exactly_one_user_frame_then_eof(self):
        self.run_fixture()
        self.assertEqual(self.stdin_file.read_bytes(),
                         b'{"event":"user","message":{"content":"hello agy"}}\n')

    def test_stdout_replays_the_resumed_identity_after_the_frame(self):
        frames = self.stdout_frames(self.run_fixture())
        self.assertEqual(frames[0]['event'], 'init')
        self.assertEqual(frames[0]['conversation_id'], SESSION)
        self.assertEqual(frames[-1]['event'], 'result')
        self.assertEqual(frames[-1]['result']['conversation_id'], SESSION)
        self.assertEqual(frames[-1]['result']['status'], 'SUCCESS')


if __name__ == '__main__':
    unittest.main()
