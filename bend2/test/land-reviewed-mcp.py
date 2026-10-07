"""Reviewed landing CLI/MCP interface tests using fresh owned repositories.

The translation cases drive the real adapter with a recording coordinator, so
each assertion is about the exact native argv the adapter composes. The native
cases drive the real coordinator and the real adapter against a fixture
repository, so each assertion is about a whole operation: the process status,
the outcome the native CLI printed, and the Git state afterwards.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_REVIEWED_LAND_EXE', ROOT / '.scratch/bend2/baton2'))
MCP = Path(os.environ.get('BATON2_REVIEWED_LAND_MCP', ROOT / 'bend2/scripts/mcp-conductor.mjs'))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'bend2/test' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


command = load('reviewed_land_command', 'mcp-command.py')
landing = load('reviewed_land_fixture', 'land.py')
landing.EXE = EXE


class Translation(command.McpCommand):
    """One tool call, the native argv it composed, and the adapter's discovery."""

    def selector(self, tool, commit=None):
        """The tool arguments and the exact native argv for an optional selector."""
        arguments = dict(player="player's λ", repo='/repo with spaces', target='target')
        if tool == 'baton2_land_checked':
            arguments.update(check='check file', files='a b')
        argv = ['land' if tool == 'baton2_land' else 'land-checked'] + list(arguments.values())
        if commit is not None:
            arguments['commit'] = commit
            argv += ['--commit', commit]
        return arguments, argv

    def exchange(self, tool, arguments):
        """Run one tool call and report what the recordable coordinator received."""
        with tempfile.TemporaryDirectory() as home:
            home = Path(home)
            executable = home / 'fixture-coordinator'
            completed = home / 'completed.json'
            executable.write_text('#' + sys.executable + '\n' + command.CHILD)
            executable.chmod(0o755)
            executable.with_suffix('.json').write_text(json.dumps({
                'stdout': '{"status":"landed"}', 'stderr': '', 'code': 0,
                'delay': 0, 'completed': str(completed),
            }))
            request = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                       {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                        'params': {'name': tool, 'arguments': arguments}}]
            run = subprocess.run(
                ['node', str(MCP), str(home / 'state.db'), str(executable)],
                input=''.join(json.dumps(row) + '\n' for row in request),
                text=True, capture_output=True,
            )
            self.assertEqual(run.returncode, 0, run.stderr)
            replies = {}
            for line in run.stdout.splitlines():
                row = json.loads(line)
                if 'id' in row:
                    replies[row['id']] = row
            self.assertIn(2, replies, run.stdout)
            recorded = json.loads(completed.read_text())['argv'] if completed.exists() else None
            return replies[2]['result'], recorded

    def test_literal_selector_and_legacy_omission_each_use_one_native_call(self):
        for tool in ['baton2_land', 'baton2_land_checked']:
            for selector in [None, '', "review's λ $(literal)", '--commit']:
                with self.subTest(tool=tool, selector=selector):
                    arguments, argv = self.selector(tool, selector)
                    result = self.command(tool=tool, arguments=arguments, expected_args=argv)
                    self.assertNotIn('isError', result)
                    self.assertEqual(json.loads(result['content'][0]['text']),
                                     {'status': 'landed'})

    def test_invalid_selector_type_is_refused_without_invocation(self):
        for tool in ['baton2_land', 'baton2_land_checked']:
            for value in [None, False, 3, [], {}]:
                with self.subTest(tool=tool, value=value):
                    arguments, _ = self.selector(tool)
                    arguments['commit'] = value
                    result, recorded = self.exchange(tool, arguments)
                    self.assertTrue(result.get('isError'), result)
                    self.assertIsNone(recorded, 'a rejected selector reached the coordinator')

    def test_native_refusal_streams_and_exit_are_preserved(self):
        for tool in ['baton2_land', 'baton2_land_checked']:
            with self.subTest(tool=tool):
                arguments, argv = self.selector(tool, 'selected')
                self.failure('', 'native refusal λ\n', code=2, tool=tool,
                             arguments=arguments, expected_args=argv)

    def test_discovery_advertises_optional_string_selector(self):
        arguments, argv = self.selector('baton2_land')
        self.command(tool='baton2_land', arguments=arguments, expected_args=argv)
        for tool in ['baton2_land', 'baton2_land_checked']:
            with self.subTest(tool=tool):
                schema = self.tools[tool]['inputSchema']
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
        for tool, command_ in [('baton2_land', 'land'), ('baton2_land_checked', 'land-checked')]:
            for selector in ['', '--quiet', "missing' λ $(literal)"]:
                with self.subTest(tool=tool, selector=selector):
                    args = dict(player='w1', repo=str(self.f.repo), target='main')
                    if command_ == 'land-checked':
                        args.update(check='unused-check', files='unused-file')
                    native = subprocess.run([str(EXE), str(self.f.db), command_, *args.values(),
                                             '--commit', selector], capture_output=True, text=True)
                    self.assertEqual(native.returncode, 2, native.stderr)
                    result = self.call(tool, dict(args, commit=selector))
                    self.assertTrue(result.get('isError'), result)
                    streams = result['content'][0]['text'].split('\nstdout:\n', 1)[1]
                    self.assertEqual(tuple(streams.split('\nstderr:\n', 1)), (native.stdout, native.stderr))
                    self.assertEqual(self.f.git('rev-parse', 'main'), before)
                    self.assertEqual(self.f.git('worktree', 'list', '--porcelain'), trees)

    def test_divergent_same_repository_selection_refuses_before_effects(self):
        self.f.git('commit', '-q', '--allow-empty', '-m', 'divergent target')
        divergent = self.f.git('rev-parse', 'main').strip()
        ancestor = subprocess.run(['git', '-C', str(self.f.repo), 'merge-base',
                                   '--is-ancestor', divergent, 'w1-branch'],
                                  capture_output=True, text=True)
        self.assertEqual(ancestor.returncode, 1, ancestor.stderr)

        def snapshot():
            files = {str(p.relative_to(self.wt)): p.read_bytes()
                     for p in self.wt.rglob('*') if p.is_file()}
            return (self.f.git('show-ref'), self.f.git('worktree', 'list', '--porcelain'),
                    self.f.git('status', '--porcelain'),
                    subprocess.check_output(['git', '-C', str(self.wt),
                                             'status', '--porcelain']), files,
                    sorted(str(p.relative_to(self.f.directory))
                           for p in self.f.directory.rglob('*') if p.is_dir()))

        before = snapshot()
        for tool, command_ in [('baton2_land', 'land'),
                               ('baton2_land_checked', 'land-checked')]:
            with self.subTest(tool=tool):
                args = dict(player='w1', repo=str(self.f.repo), target='main')
                if command_ == 'land-checked':
                    args.update(check='unused-check', files='file.txt')
                native = subprocess.run([str(EXE), str(self.f.db), command_,
                                         *args.values(), '--commit', divergent],
                                        capture_output=True, text=True)
                self.assertEqual(native.returncode, 2, native.stderr)
                self.assertIn('is not an ancestor of the recorded branch', native.stderr)
                self.assertEqual(native.stdout, '')
                self.assertEqual(snapshot(), before)
                result = self.call(tool, dict(args, commit=divergent))
                self.assertTrue(result.get('isError'), result)
                text = result['content'][0]['text']
                self.assertIn('\nexit code: 2', text)
                streams = text.split('\nstdout:\n', 1)[1]
                self.assertEqual(tuple(streams.split('\nstderr:\n', 1)),
                                 (native.stdout, native.stderr))
                self.assertEqual(snapshot(), before)

    def test_malformed_native_selectors_have_no_target_or_scratch_effect(self):
        before = self.f.git('rev-parse', 'main')
        trees = self.f.git('worktree', 'list', '--porcelain')
        for command_, args in [('land', []), ('land-checked', ['unused-check', 'unused-file'])]:
            for tail in [['--commit'], ['--commit', self.selected, '--commit', self.later],
                         ['--unknown', self.selected], ['--commit', self.selected, 'extra']]:
                with self.subTest(command=command_, tail=tail):
                    p = subprocess.run([str(EXE), str(self.f.db), command_, 'w1', str(self.f.repo),
                                        'main', *args, *tail], capture_output=True, text=True)
                    self.assertEqual(p.returncode, 2, p.stderr)
                    self.assertIn('usage:', p.stderr)
                    self.assertEqual(self.f.git('rev-parse', 'main'), before)
                    self.assertEqual(self.f.git('worktree', 'list', '--porcelain'), trees)


if __name__ == '__main__':
    unittest.main()
