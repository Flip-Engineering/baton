"""Focused checks for the agy player (bend2/src/harness/agy-player.bend).

The fixture binary performs the real argument composition, frame encoding and
event projection. No model provider is contacted here.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/agy-player-test'))
FIXTURES = ROOT / 'bend2/test/fixtures/agy'
CMD = '/usr/local/bin/agy'
MODEL = 'agy-model-test'
EFFORT = 'high'


def run(*args):
    return subprocess.run([str(EXE), *map(str, args)], text=True,
                          capture_output=True, timeout=60)


def fixture_lines(name):
    return (FIXTURES / name).read_text(encoding='utf-8').splitlines()


class AgyPlayer(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'agy fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.db = pathlib.Path(self.temp.name) / 'fixture.db'
        sqlite3.connect(self.db).close()

    def out(self, *args):
        result = run(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    @staticmethod
    def values(output, key):
        return [line.split('\t', 1)[1] for line in output.splitlines()
                if line.startswith(key + '\t')]

    def arg_list(self, *args):
        return self.values(self.out(*args), 'arg')

    def event(self, line):
        return json.loads(self.out('event', self.db, line).split('\t', 1)[1])

    def test_arguments_compose_the_headless_stream_profile(self):
        self.assertEqual(self.arg_list('arguments', CMD, MODEL, EFFORT), [
            CMD, '--input-format', 'stream-json', '--output-format', 'stream-json',
            '--dangerously-skip-permissions', '--print-timeout', '0',
            '--model', MODEL, '--effort', EFFORT])

    def test_fresh_argv_has_no_conversation_flag(self):
        args = self.arg_list('argv-fresh', CMD, MODEL, EFFORT, '')
        self.assertEqual(args, self.arg_list('arguments', CMD, MODEL, EFFORT))
        self.assertNotIn('--conversation', args)

    def test_resume_argv_appends_the_conversation_id_last(self):
        session = 'c622d4e6-ea22-4a9d-b6be-b365ab31d87f'
        args = self.arg_list('argv-resume', CMD, MODEL, EFFORT, session)
        self.assertEqual(args, self.arg_list('arguments', CMD, MODEL, EFFORT)
                         + ['--conversation', session])

    def test_user_frame_is_one_json_object_for_each_text(self):
        texts = [
            'hello agy',
            'He said "hi"\nthen C:\\path\\file',
            'tab\tand carriage\rreturn',
            'héllo ✓ 漢字 🙂',
            '',
        ]
        for text in texts:
            with self.subTest(text=text):
                frame = self.values(self.out('frame', text), 'frame')[0]
                self.assertEqual(json.loads(frame), {
                    'event': 'user', 'message': {'content': text}})

    def test_kind_classifies_each_protocol_event(self):
        success = fixture_lines('success-1.3.5.jsonl')
        self.assertEqual(self.values(self.out('kind', success[0]), 'kind'), ['init'])
        self.assertEqual(self.values(self.out('kind', success[1]), 'kind'), ['step_update'])
        self.assertEqual(self.values(self.out('kind', success[-1]), 'kind'), ['result'])
        self.assertEqual(self.values(self.out('kind', '{"event":"user","message":{"content":"x"}}'), 'kind'), [''])
        self.assertEqual(self.values(self.out('kind', '{"event":"other"}'), 'kind'), [''])
        self.assertEqual(self.values(self.out('kind', ''), 'kind'), [''])

    def test_tool_fixture_is_init_then_steps_then_result(self):
        kinds = [self.values(self.out('kind', line), 'kind')[0]
                 for line in fixture_lines('tool-success.jsonl')]
        self.assertEqual(kinds[0], 'init')
        self.assertEqual(kinds[-1], 'result')
        self.assertTrue(all(kind == 'step_update' for kind in kinds[1:-1]))

    def test_init_becomes_the_native_session_identity(self):
        init = fixture_lines('success-1.3.5.jsonl')[0]
        self.assertEqual(self.event(init), {
            'type': 'session',
            'id': 'c622d4e6-ea22-4a9d-b6be-b365ab31d87f',
            'cwd': '/Users/wahargis/Development/Experiments/baton'})

    def test_success_result_becomes_a_successful_result(self):
        result = self.event(fixture_lines('success-1.3.5.jsonl')[-1])
        self.assertEqual(result, {'type': 'result', 'is_error': 0, 'result': 'ok\n'})
        self.assertIs(type(result['is_error']), int)

    def test_provider_error_result_becomes_an_error_result(self):
        result = self.event(fixture_lines('provider-error.jsonl')[-1])
        self.assertEqual(result, {'type': 'result', 'is_error': 1,
                                  'result': 'model provider returned HTTP 503'})

    def test_every_non_success_status_becomes_an_error_result(self):
        for status in ('ERROR', 'CANCELED', 'INTERRUPTED', 'INVALID', 'WAITING', 'RUNNING'):
            with self.subTest(status=status):
                line = json.dumps({'event': 'result', 'result': {
                    'conversation_id': 'c1', 'status': status, 'response': '',
                    'error': 'boom', 'usage': {}}})
                self.assertEqual(self.event(line),
                                 {'type': 'result', 'is_error': 1, 'result': 'boom'})
                line = json.dumps({'event': 'result', 'result': {
                    'conversation_id': 'c1', 'status': status, 'response': '',
                    'error': '', 'usage': {}}})
                self.assertEqual(self.event(line),
                                 {'type': 'result', 'is_error': 1, 'result': status})

    def test_auth_failure_is_an_error_result_with_no_conversation(self):
        line = fixture_lines('auth-failure-1.4.5.jsonl')[0]
        self.assertEqual(self.values(self.out('kind', line), 'kind'), ['result'])
        self.assertEqual(self.event(line), {
            'type': 'result', 'is_error': 1,
            'result': 'authentication failed or timed out'})

    def test_step_frames_stay_as_received(self):
        for line in fixture_lines('success-1.3.5.jsonl')[1:4]:
            with self.subTest(line=line[:60]):
                self.assertEqual(self.out('event', self.db, line).split('\t', 1)[1].strip(),
                                 line)

    def test_usage_is_the_result_usage_object(self):
        line = fixture_lines('success-1.3.5.jsonl')[-1]
        usage = json.loads(self.out('usage', self.db, line).split('\t', 1)[1])
        self.assertEqual(usage, json.loads(line)['result']['usage'])

    def test_admission_covers_init_and_result_only(self):
        for kind, admitted in (('init', 'true'), ('result', 'true'),
                               ('step_update', 'false'), ('', 'false')):
            with self.subTest(kind=kind):
                self.assertEqual(self.values(self.out('admitted', kind), 'admitted'),
                                 [admitted])


if __name__ == '__main__':
    unittest.main()
