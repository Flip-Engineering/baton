"""Retained-launch checks for the agy adapter.

The launch mode composes the retained launch through the coordinator's agy branch
(Turn.retained_launch_checked) and needs no instance owner. The admit mode admits the
same launch through the instance owner (Turn.retained_admit), so the fake agy
(bend2/test/fake-agy) is really spawned, receives the user frame, sees EOF and replays
a fixture. No model provider is contacted.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/agy-retained-test'))
FAKE = ROOT / 'bend2/test/fake-agy'
FIXTURES = ROOT / 'bend2/test/fixtures/agy'
SESSION = 'c622d4e6-ea22-4a9d-b6be-b365ab31d87f'
MODEL = 'agy-model-test'
EFFORT = 'high'
TEXT = 'hello agy'
FRAME = '{"event":"user","message":{"content":"hello agy"}}'
FLAGS = ['--input-format', 'stream-json', '--output-format', 'stream-json',
         '--dangerously-skip-permissions', '--print-timeout', '0']
SCHEMA = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, "
    "harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', "
    "effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', "
    "observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', "
    "observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', "
    "workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', "
    "base TEXT NOT NULL DEFAULT '');"
)


def values(output, key):
    return [line.split('\t', 1)[1] for line in output.splitlines()
            if line.startswith(key + '\t')]


def expected_argv(native):
    argv = [str(FAKE)] + FLAGS + ['--model', MODEL, '--effort', EFFORT]
    return argv + (['--conversation', native] if native else [])


class AgyRetainedLaunch(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'agy retained fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)

    def launch(self, native):
        result = subprocess.run([str(EXE), 'launch', str(FAKE), str(self.directory),
                                 MODEL, EFFORT, native, TEXT],
                                text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_fresh_launch_composes_the_stream_profile_without_conversation(self):
        output = self.launch('')
        self.assertEqual(values(output, 'arg'), expected_argv(''))
        self.assertNotIn('--conversation', values(output, 'arg'))

    def test_resumed_launch_appends_the_native_conversation_last(self):
        output = self.launch(SESSION)
        self.assertEqual(values(output, 'arg'), expected_argv(SESSION))
        self.assertEqual(values(output, 'arg')[-2:], ['--conversation', SESSION])

    def test_launch_input_is_exactly_one_user_frame_and_stdin_is_closed(self):
        output = self.launch(SESSION)
        self.assertEqual(values(output, 'input'), [FRAME])
        self.assertEqual(json.loads(values(output, 'input')[0]),
                         {'event': 'user', 'message': {'content': TEXT}})
        self.assertEqual(values(output, 'keep'), ['0'])
        self.assertEqual(values(output, 'file'), ['false'])


class AgyRetainedAdmit(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'agy retained fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        self.link = self.root / 'link.db'
        self.directory = self.root / 'attempt'
        self.argv_file = self.root / 'argv'
        self.stdin_file = self.root / 'stdin'
        with sqlite3.connect(self.db) as database:
            database.executescript(SCHEMA)
            database.execute(
                "INSERT INTO sessions(id,harness,model,effort) VALUES"
                "('agy-fixture','antigravity',?,?)", (MODEL, EFFORT))
        self.link.symlink_to(self.db)
        self.addCleanup(self.shutdown_owner)

    def shutdown_owner(self):
        subprocess.run([str(EXE), 'shutdown', str(self.db)],
                       text=True, capture_output=True, timeout=10)

    def admit(self, fixture, native='', directory=None):
        env = dict(os.environ, FAKE_AGY_FIXTURE=str(FIXTURES / fixture),
                   FAKE_AGY_ARGV=str(self.argv_file), FAKE_AGY_STDIN=str(self.stdin_file))
        env.pop('FAKE_AGY_EXIT', None)
        result = subprocess.run([str(EXE), 'admit', str(self.link),
                                 str(directory or self.directory), str(FAKE),
                                 MODEL, EFFORT, native, TEXT],
                                text=True, capture_output=True, timeout=60, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('native-exit 0', result.stdout)
        return [json.loads(line) for line in result.stdout.splitlines()
                if line.startswith('{')]

    def recorded_argv(self):
        return [arg.decode() for arg in self.argv_file.read_bytes().split(b'\0')]

    def test_first_admission_spawns_fresh_and_replays_the_recorded_identity(self):
        frames = self.admit('success-1.3.5.jsonl')
        self.assertEqual(self.recorded_argv(), expected_argv(''))
        self.assertEqual(self.stdin_file.read_bytes(), (FRAME + '\n').encode())
        self.assertEqual(frames[0]['event'], 'init')
        self.assertEqual(frames[0]['conversation_id'], SESSION)
        self.assertEqual(frames[-1]['result']['status'], 'SUCCESS')

    def test_resumed_admission_passes_the_native_conversation_and_replays_it(self):
        frames = self.admit('resumed-success.jsonl', native=SESSION)
        self.assertEqual(self.recorded_argv(), expected_argv(SESSION))
        self.assertEqual(self.stdin_file.read_bytes(), (FRAME + '\n').encode())
        self.assertEqual(frames[0]['conversation_id'], SESSION)
        self.assertEqual(frames[-1]['result']['conversation_id'], SESSION)


if __name__ == '__main__':
    unittest.main()
