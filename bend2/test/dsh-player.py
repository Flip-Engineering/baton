"""Focused checks for the DSH player (bend2/src/harness/dsh-player.bend).

The fixture binary performs the real argument composition, patch preparation
and event projection. No model provider is contacted here.
"""
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/dsh-player-test'))


def run(*args):
    return subprocess.run([str(EXE), *map(str, args)], text=True,
                          capture_output=True)


def argv_of(output):
    return [line.split('\t', 1)[1] for line in output.splitlines()
            if line.startswith('arg\t')]


class DshPlayer(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'DSH fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'fixture.db'
        sqlite3.connect(self.db).close()

    def out(self, *args):
        result = run(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_fresh_argv_composes_headless_launcher_and_no_task(self):
        args = argv_of(self.out('argv-fresh', '/home/seat', '/bin/dsh',
                                'deepseek/deepseek-flash', 'max',
                                '/attempt/tools.yml', '/attempt/model.yml'))
        self.assertEqual(args[:3], ['/usr/bin/env', 'DSH_HOME=/home/seat', '/bin/dsh'])
        self.assertEqual(args[3:], [
            '--profile', 'headless',
            '--patch', '/attempt/tools.yml',
            '--patch', '/attempt/model.yml',
            '--json'])
        self.assertFalse(any('DEEPSEEK_API_KEY' in arg for arg in args))
        self.assertFalse(any('sk-' in arg for arg in args))
        self.assertNotIn('fixture task', args)

    def test_resume_adds_session_after_app_json_flag(self):
        args = argv_of(self.out('argv-resume', '/home/seat', '/bin/dsh',
                                'deepseek-flash', 'high',
                                '/attempt/tools.yml', '/attempt/model.yml',
                                'session-123'))
        self.assertEqual(args[-2:], ['--session-id', 'session-123'])
        self.assertEqual(args[-3], '--json')

    def test_model_alias_maps_to_the_catalog_id(self):
        self.assertEqual(self.out('model', 'deepseek/deepseek-flash').strip(),
                         'model\tdeepseek-flash')
        self.assertEqual(self.out('model', 'deepseek-flash').strip(),
                         'model\tdeepseek-flash')
        self.assertEqual(self.out('model', '').strip(),
                         'model\tdeepseek-flash')

    def test_event_kinds_are_classified(self):
        samples = {
            'session': '{"type":"session","sessionId":"s","cwd":"/w"}',
            'status': '{"type":"status","phase":"step_start","turn":1,"step":1}',
            'thinking': '{"type":"thinking","text":"t"}',
            'text': '{"type":"text","text":"t"}',
            'tool_call': '{"type":"tool_call","callId":"c","tool":"bash","input":{}}',
            'tool_result': '{"type":"tool_result","callId":"c","status":"completed","result":"r"}',
            'final': '{"type":"final","text":"t"}',
            'error': '{"type":"error","message":"m"}',
        }
        for kind, line in samples.items():
            self.assertEqual(self.out('kind', line).strip(), 'kind\t' + kind)

    def test_session_event_records_native_identity(self):
        line = '{"type":"session","sessionId":"session-9","cwd":"/w"}'
        event = json.loads(self.out('event', self.db, line).split('\t', 1)[1])
        self.assertEqual(event['type'], 'session')
        self.assertEqual(event['id'], 'session-9')

    def test_final_event_becomes_the_terminal_result(self):
        event = json.loads(self.out('event', self.db,
                                    '{"type":"final","text":"answer"}').split('\t', 1)[1])
        self.assertEqual(event, {'type': 'result', 'result': 'answer'})

    def test_provider_error_becomes_an_error_result(self):
        line = '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"boom","code":"X"}}}'
        event = json.loads(self.out('event', self.db, line).split('\t', 1)[1])
        self.assertEqual(event['type'], 'result')
        self.assertEqual(event['is_error'], 1)
        self.assertEqual(event['result'], 'boom')

    def test_boot_error_becomes_an_error_result(self):
        line = '{"type":"error","message":"session \\"x\\" does not exist"}'
        event = json.loads(self.out('event', self.db, line).split('\t', 1)[1])
        self.assertEqual(event['type'], 'result')
        self.assertEqual(event['is_error'], 1)
        self.assertIn('does not exist', event['result'])

    def test_usage_rides_the_step_end_status(self):
        line = '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":11,"outputTokens":7,"totalTokens":18}}'
        usage = json.loads(self.out('usage', self.db, line).split('\t', 1)[1])
        self.assertEqual(usage, {'inputTokens': 11, 'outputTokens': 7,
                                 'totalTokens': 18})

    def test_text_thinking_and_tool_frames_stay_as_received(self):
        for line in (
            '{"type":"text","text":"hello"}',
            '{"type":"thinking","text":"why"}',
            '{"type":"tool_call","callId":"c","tool":"bash","input":{"command":"true"}}',
            '{"type":"tool_result","callId":"c","status":"completed","result":"ok"}',
        ):
            self.assertEqual(self.out('event', self.db, line).split('\t', 1)[1].strip(),
                             line)

    def test_minimal_tool_patch_disables_every_other_tool_plugin(self):
        directory = self.directory / 'tools'
        self.out('prepare', directory, 'deepseek/deepseek-flash', 'max', '')
        text = (directory / 'dsh-tools.patch.yml').read_text()
        disabled = set(re.findall(r'^- id: (\S+)\n  disabled: true', text, re.M))
        expected = {
            'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs-search',
            'tool-skill', 'skill-filesystem', 'tool-goal', 'command-goal',
            'plan-mode', 'tool-todo', 'tool-web',
            'user-questions', 'tool-subagent', 'tool-subagent-fork',
            'tool-subagent-control', 'tool-subagent-list-agents',
            'tool-workflow',
        }
        self.assertEqual(disabled, expected)
        self.assertNotIn('tool-fs', disabled)
        self.assertIn('    read: false', text)
        self.assertIn('    readImage: true', text)
        self.assertIn('    write: false', text)
        self.assertIn('    edit: false', text)
        self.assertIn("name: '@deepseek-ai/dsh-tool-bash-persistent'", text)

    def test_hooks_plugin_is_mounted_only_when_its_path_is_given(self):
        plain = self.directory / 'without-hooks'
        self.out('prepare', plain, 'deepseek/deepseek-flash', 'max', '')
        self.assertNotIn('baton-hooks', (plain / 'dsh-tools.patch.yml').read_text())
        mounted = self.directory / 'with-hooks'
        path = "/opt/baton/it's/dsh-baton-hooks.mjs"
        self.out('prepare', mounted, 'deepseek/deepseek-flash', 'max', path)
        text = (mounted / 'dsh-tools.patch.yml').read_text()
        self.assertIn("    - id: baton-hooks\n      name: '/opt/baton/it''s/dsh-baton-hooks.mjs'\n", text)
        self.assertLess(text.index('- id: baton-hooks'), text.index('- id: baton-worker'))

    def test_prepare_is_idempotent_for_a_reused_attempt_directory(self):
        directory = self.directory / 'reused'
        for _ in range(2):
            self.out('prepare', directory, 'deepseek/deepseek-flash', 'max', '')
        tools = (directory / 'dsh-tools.patch.yml').read_text()
        model = (directory / 'dsh-model.patch.yml').read_text()
        self.assertEqual(tools.count('- id: tool-jobs'), 1)
        self.assertEqual(tools.count("name: '@deepseek-ai/dsh-tool-bash-persistent'"), 1)
        self.assertEqual(model.count('provider: deepseek-official'), 1)
        self.assertEqual(model.count('reasoningEffort:'), 1)

    def test_model_patch_carries_route_and_effort_independently(self):
        directory = self.directory / 'model'
        self.out('prepare', directory, 'deepseek/deepseek-flash', 'max', '')
        text = (directory / 'dsh-model.patch.yml').read_text()
        self.assertIn('provider: deepseek-official', text)
        self.assertIn("model: 'deepseek-flash'", text)
        self.assertIn("reasoningEffort: 'max'", text)

    def test_empty_effort_omits_the_field(self):
        directory = self.directory / 'default-effort'
        self.out('prepare', directory, 'deepseek-flash', '', '')
        text = (directory / 'dsh-model.patch.yml').read_text()
        self.assertNotIn('reasoningEffort', text)


if __name__ == '__main__':
    unittest.main()
