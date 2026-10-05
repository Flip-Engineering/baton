"""Reviewed landing CLI/MCP interface tests using fresh owned repositories."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_REVIEWED_LAND_EXE', ROOT / '.scratch/bend2/baton2'))
MCP = Path(os.environ.get('BATON2_REVIEWED_LAND_MCP', ROOT / 'bend2/scripts/mcp-conductor.mjs'))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bend2/test' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


translation = load('reviewed_land_translation', 'control-index-mcp.py')
translation.MCP = MCP
landing = load('reviewed_land_fixture', 'land.py')
landing.EXE = EXE


class Translation(unittest.TestCase):
    def setUp(self):
        self.h = translation.ControlIndexMcp()
        self.h.setUp()
        self.addCleanup(self.h.doCleanups)
        self.args = dict(player="player's λ", repo='/repo with spaces', target='target')

    def test_literal_selector_and_legacy_omission_each_use_one_native_call(self):
        for tool, command in [('baton2_land', 'land'), ('baton2_land_checked', 'land-checked')]:
            base = self.args if command == 'land' else dict(self.args, check='check file', files='a b')
            for selector in [None, '', "review's λ $(literal)", '--commit']:
                with self.subTest(tool=tool, selector=selector):
                    args = base if selector is None else dict(base, commit=selector)
                    result, calls = self.h.exchange(tool, args, stdout='{"status":"landed"}')
                    self.assertFalse(result.get('isError'), result)
                    self.assertEqual(calls, [[str(self.h.database), command, *base.values(),
                                             *([] if selector is None else ['--commit', selector])]])
                    self.assertEqual(json.loads(result['content'][0]['text']), {'status': 'landed'})

    def test_invalid_selector_type_is_refused_without_invocation(self):
        for tool in ['baton2_land', 'baton2_land_checked']:
            for value in [None, False, 3, [], {}]:
                args = dict(self.args, commit=value)
                if tool.endswith('_checked'):
                    args.update(check='script', files='file')
                result, calls = self.h.exchange(tool, args)
                self.assertTrue(result.get('isError'), result)
                self.assertEqual(calls, [])

    def test_native_refusal_streams_and_exit_are_preserved(self):
        for tool in ['baton2_land', 'baton2_land_checked']:
            args = dict(self.args, commit='selected')
            if tool.endswith('_checked'):
                args.update(check='check', files='file')
            result, calls = self.h.exchange(tool, args, stdout='', stderr='native refusal λ\n', code=2)
            self.assertEqual(len(calls), 1)
            self.assertTrue(result.get('isError'), result)
            text = result['content'][0]['text']
            self.assertIn('\nexit code: 2', text)
            self.assertEqual(text.split('\nstdout:\n', 1)[1], '\nstderr:\nnative refusal λ\n')

    def test_discovery_advertises_optional_string_selector(self):
        self.h.exchange('baton2_land', self.args)
        for tool in ['baton2_land', 'baton2_land_checked']:
            schema = self.h.advertised[tool]['inputSchema']
            self.assertEqual(schema['properties']['commit']['type'], 'string')
            self.assertNotIn('commit', schema['required'])
            self.assertIn('recorded branch', schema['properties']['commit']['description'])


class NativeProjection(unittest.TestCase):
    def setUp(self):
        self.f = landing.Land()
        self.f.setUp()
        self.addCleanup(self.f.tearDown)
        self.selected = self.f.recruit_and_commit()
        self.wt = self.f.repo / 'wt'
        (self.wt / 'later.txt').write_text('unreviewed\n')
        subprocess.run(['git', '-C', str(self.wt), 'add', 'later.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.wt), 'commit', '-qm', 'later work'], check=True, capture_output=True)
        self.later = self.f.git('rev-parse', 'w1-branch').strip()

    def call(self, tool, args):
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                   'params': {'name': tool, 'arguments': args}}
        p = subprocess.run(['node', str(MCP), str(self.f.db), str(EXE)],
                           input=json.dumps(request) + '\n', capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)['result']

    def test_fast_forward_selected_ancestor_and_default_tip(self):
        args = dict(player='w1', repo=str(self.f.repo), target='main', commit=self.selected)
        result = self.call('baton2_land', args)
        self.assertFalse(result.get('isError'), result)
        self.assertEqual(json.loads(result['content'][0]['text']),
                         {'status': 'landed', 'target': 'main', 'commit': self.selected})
        self.assertEqual(self.f.git('rev-parse', 'main').strip(), self.selected)
        self.assertEqual(self.f.git('rev-parse', 'w1-branch').strip(), self.later)
        self.assertEqual((self.wt / 'later.txt').read_text(), 'unreviewed\n')
        args.pop('commit')
        result = self.call('baton2_land', args)
        self.assertFalse(result.get('isError'), result)
        self.assertEqual(json.loads(result['content'][0]['text'])['commit'], self.later)

    def test_checked_selection_runs_checks_and_excludes_later_work(self):
        self.f.git('checkout', '-q', '--detach')
        check = self.f.directory / 'check.sh'
        check.write_text('test ! -f later.txt\n')
        args = dict(player='w1', repo=str(self.f.repo), target='main',
                    check=str(check), files='file.txt', commit=self.selected)
        result = self.call('baton2_land_checked', args)
        self.assertFalse(result.get('isError'), result)
        obj = json.loads(result['content'][0]['text'])
        self.assertEqual(obj['status'], 'landed', obj)
        paths = self.f.git('ls-tree', '-r', '--name-only', 'main').splitlines()
        self.assertIn('file.txt', paths)
        self.assertNotIn('later.txt', paths)
        self.assertEqual(self.f.git('rev-parse', 'w1-branch').strip(), self.later)
        self.assertTrue((self.wt / 'later.txt').exists())

    def test_literal_invalid_selectors_preserve_native_failure_without_effects(self):
        before = self.f.git('rev-parse', 'main')
        trees = self.f.git('worktree', 'list', '--porcelain')
        for tool, command in [('baton2_land', 'land'), ('baton2_land_checked', 'land-checked')]:
            for selector in ['', '--quiet', "missing' λ $(literal)"]:
                with self.subTest(tool=tool, selector=selector):
                    args = dict(player='w1', repo=str(self.f.repo), target='main')
                    if command == 'land-checked':
                        args.update(check='unused-check', files='unused-file')
                    native = subprocess.run([str(EXE), str(self.f.db), command, *args.values(),
                                             '--commit', selector], capture_output=True, text=True)
                    self.assertEqual(native.returncode, 2, native.stderr)
                    result = self.call(tool, dict(args, commit=selector))
                    self.assertTrue(result.get('isError'), result)
                    streams = result['content'][0]['text'].split('\nstdout:\n', 1)[1]
                    self.assertEqual(tuple(streams.split('\nstderr:\n', 1)), (native.stdout, native.stderr))
                    self.assertEqual(self.f.git('rev-parse', 'main'), before)
                    self.assertEqual(self.f.git('worktree', 'list', '--porcelain'), trees)

    def test_malformed_native_selectors_have_no_target_or_scratch_effect(self):
        before = self.f.git('rev-parse', 'main')
        trees = self.f.git('worktree', 'list', '--porcelain')
        for command, args in [('land', []), ('land-checked', ['unused-check', 'unused-file'])]:
            for tail in [ ['--commit'], ['--commit', self.selected, '--commit', self.later],
                          ['--unknown', self.selected], ['--commit', self.selected, 'extra'] ]:
                p = subprocess.run([str(EXE), str(self.f.db), command, 'w1', str(self.f.repo),
                                    'main', *args, *tail], capture_output=True, text=True)
                self.assertEqual(p.returncode, 2, p.stderr)
                self.assertIn('usage:', p.stderr)
                self.assertEqual(self.f.git('rev-parse', 'main'), before)
                self.assertEqual(self.f.git('worktree', 'list', '--porcelain'), trees)


if __name__ == '__main__':
    unittest.main()
