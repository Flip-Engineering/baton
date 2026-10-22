"""Turn-level checks for the agy adapter.

AgyTurn drives bend2/test/agy-turn.bend against the fake agy (bend2/test/fake-agy).
The fixture projects the admitted frames into the native identity and the turn report.

FakeAgy runs the fake executable directly. It needs no compiled fixture and checks the
replay and rejection rules that the turn checks depend on. No model provider is contacted.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/agy-turn-test'))
FAKE = ROOT / 'bend2/test/fake-agy'
FIXTURES = ROOT / 'bend2/test/fixtures/agy'
SESSION = 'c622d4e6-ea22-4a9d-b6be-b365ab31d87f'
ERROR_SESSION = 'c9d1f0a2-4b7e-4c3a-9f10-2e8d6a5b7c41'
ERROR_TEXT = 'model provider returned HTTP 503'
TEXT = 'hello agy'
FRAME = b'{"event":"user","message":{"content":"hello agy"}}\n'
FLAGS = ['--input-format', 'stream-json', '--output-format', 'stream-json']


def fake_env(fixture, argv_file, stdin_file, **extra):
    env = {key: value for key, value in os.environ.items() if not key.startswith('FAKE_AGY_')}
    env.update(FAKE_AGY_FIXTURE=str(FIXTURES / fixture), FAKE_AGY_ARGV=str(argv_file),
               FAKE_AGY_STDIN=str(stdin_file), **extra)
    return env


def values(output, key):
    return [line.split('\t', 1)[1] for line in output.splitlines()
            if line.startswith(key + '\t')]


class AgyTurn(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'agy turn fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'

    def run_turn(self, mode, fixture, tag):
        argv_file = self.root / f'{tag}.argv'
        stdin_file = self.root / f'{tag}.stdin'
        result = subprocess.run([str(EXE), str(self.db), str(FAKE), mode, TEXT],
                                text=True, capture_output=True, timeout=60,
                                env=fake_env(fixture, argv_file, stdin_file))
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout, argv_file, stdin_file

    def test_first_turn_records_the_native_identity_and_the_terminal_report(self):
        output, _, _ = self.run_turn('fresh', 'success-1.3.5.jsonl', 'fresh')
        self.assertEqual(values(output, 'native'), [SESSION])
        kinds = values(output, 'kind')
        self.assertEqual(kinds[0], 'init')
        self.assertEqual(kinds[-1], 'result')
        self.assertEqual(values(output, 'report'), ['ok'])
        self.assertEqual(values(output, 'terminal'), ['1'])
        turn = json.loads(values(output, 'turn')[0])
        self.assertEqual(turn['type'], 'result')
        self.assertEqual(turn['is_error'], 0)
        self.assertEqual(turn['result'], 'ok\n')

    def test_stdin_carries_one_user_frame_for_the_task(self):
        _, _, stdin_file = self.run_turn('fresh', 'success-1.3.5.jsonl', 'fresh')
        self.assertEqual(stdin_file.read_bytes(), FRAME)

    def test_second_dispatch_resumes_the_identity_from_the_first_turn(self):
        self.run_turn('fresh', 'success-1.3.5.jsonl', 'first')
        output, argv_file, _ = self.run_turn('resume', 'resumed-success.jsonl', 'second')
        argv = argv_file.read_bytes().split(b'\0')
        self.assertEqual(argv[-2:], [b'--conversation', SESSION.encode()])
        self.assertEqual(values(output, 'native'), [SESSION])
        self.assertEqual(values(output, 'report'), ['resumed'])
        self.assertEqual(values(output, 'terminal'), ['1'])

    def test_provider_error_result_records_an_error_terminal(self):
        output, _, _ = self.run_turn('fresh', 'provider-error.jsonl', 'error')
        self.assertEqual(values(output, 'native'), [ERROR_SESSION])
        turn = json.loads(values(output, 'turn')[0])
        self.assertEqual(turn['type'], 'result')
        self.assertEqual(turn['is_error'], 1)
        self.assertEqual(turn['result'], ERROR_TEXT)
        self.assertTrue(any(ERROR_TEXT in body for body in values(output, 'report')))
        self.assertEqual(values(output, 'terminal'), ['1'])


class FakeAgy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.argv_file = self.root / 'argv'
        self.stdin_file = self.root / 'stdin'

    def fake(self, args, stdin, fixture='success-1.3.5.jsonl', **extra):
        return subprocess.run([str(FAKE), *args], input=stdin, text=True,
                              capture_output=True, timeout=60,
                              env=fake_env(fixture, self.argv_file, self.stdin_file, **extra))

    def test_replays_the_fixture_for_a_valid_user_frame(self):
        result = self.fake(FLAGS, FRAME.decode())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.encode(), (FIXTURES / 'success-1.3.5.jsonl').read_bytes())

    def test_records_argv_with_the_executable_first_and_the_stdin_bytes(self):
        self.fake(FLAGS + ['--model', 'm'], FRAME.decode())
        argv = self.argv_file.read_bytes().split(b'\0')
        self.assertEqual([arg.decode() for arg in argv], [str(FAKE)] + FLAGS + ['--model', 'm'])
        self.assertEqual(self.stdin_file.read_bytes(), FRAME)

    def test_rejects_argv_without_both_stream_json_flags(self):
        for args in (FLAGS[:2], FLAGS[2:]):
            with self.subTest(args=args):
                result = self.fake(args, FRAME.decode())
                self.assertEqual(result.returncode, 1)
                self.assertIn('lacks', result.stderr)

    def test_rejects_stdin_that_is_not_json(self):
        result = self.fake(FLAGS, 'not json\n')
        self.assertEqual(result.returncode, 1)
        self.assertIn('not JSON', result.stderr)

    def test_rejects_stdin_that_is_json_but_not_a_user_frame(self):
        result = self.fake(FLAGS, '{"event":"step_update","step_update":{}}\n')
        self.assertEqual(result.returncode, 1)
        self.assertIn('not a user frame', result.stderr)

    def test_rejects_empty_stdin(self):
        self.assertEqual(self.fake(FLAGS, '').returncode, 1)

    def test_conversation_argument_replaces_each_non_empty_id(self):
        result = self.fake(FLAGS + ['--conversation', 'resumed-id'], FRAME.decode(),
                           fixture='resumed-success.jsonl')
        self.assertEqual(result.returncode, 0, result.stderr)
        frames = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(frames[0]['conversation_id'], 'resumed-id')
        self.assertEqual(frames[-1]['result']['conversation_id'], 'resumed-id')
        self.assertEqual(frames[1]['step_update']['conversation_id'], 'resumed-id')

    def test_empty_conversation_id_stays_empty_on_replay(self):
        result = self.fake(FLAGS + ['--conversation', 'resumed-id'], FRAME.decode(),
                           fixture='auth-failure-1.4.5.jsonl')
        self.assertEqual(json.loads(result.stdout)['result']['conversation_id'], '')

    def test_auth_failure_fixture_exits_1_and_writes_its_stderr(self):
        result = self.fake(FLAGS, FRAME.decode(), fixture='auth-failure-1.4.5.jsonl')
        self.assertEqual(result.returncode, 1)
        self.assertIn('authentication required', result.stderr)

    def test_exit_status_comes_from_the_environment(self):
        result = self.fake(FLAGS, FRAME.decode(), FAKE_AGY_EXIT='3')
        self.assertEqual(result.returncode, 3)


if __name__ == '__main__':
    unittest.main()
