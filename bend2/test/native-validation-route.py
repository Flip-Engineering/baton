#!/usr/bin/env python3
"""Exercise the PR1335 Node route and its native workflow dependencies."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.github/scripts/native-validation-route.py'
spec = importlib.util.spec_from_file_location('validation_route', SCRIPT)
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)


def git(root, *args):
    return subprocess.check_output([
        'git', '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', *args,
    ], cwd=root, text=True).strip()


def write(root, path, text):
    destination = root / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(text)


def commit(root):
    git(root, 'add', '-A')
    git(root, 'commit', '-qm', 'fixture')
    return git(root, 'rev-parse', 'HEAD')


class Selection(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name)
        self.repo = self.work / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-qb', 'main')
        for path in route.ROOT_CHANNEL_INPUTS:
            write(self.repo, path, 'export const value = 1;\n')
        write(self.repo, 'docs/bend2/root-channel-attach-1212.md', 'Base documentation.\n')
        self.base = commit(self.repo)

    def run_route(self, *, source=None, event='pull_request', base=None, head=None):
        output = self.work / 'result.json'
        github_output = self.work / 'github-output'
        github_output.unlink(missing_ok=True)
        result = subprocess.run([
            sys.executable, str(SCRIPT), '--source', str(source or self.repo),
            '--event', event, '--base', base if base is not None else self.base,
            '--head', head or git(source or self.repo, 'rev-parse', 'HEAD'),
            '--output', str(output), '--github-output', str(github_output),
        ], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(output.read_text())
        self.assertEqual(github_output.read_text(), 'route=' + record['route'] + '\n')
        return record

    def test_observed_pr_1335_delta_runs_the_node_suite(self):
        paths = ('bend2/scripts/codex-root-relay.mjs', 'bend2/scripts/mcp-conductor.mjs',
                 'bend2/test/codex-root-relay.test.mjs', 'bend2/test/root-channel-attach.test.mjs',
                 'docs/bend2/root-channel-attach-1212.md')
        for path in paths:
            write(self.repo, path, 'Changed content.\n')
        head = commit(self.repo)
        record = self.run_route()
        self.assertEqual(record['route'], 'node-root-channel')
        self.assertEqual(record['base'], self.base)
        self.assertEqual(record['head'], head)
        self.assertEqual({row['path'] for row in record['changes']}, set(paths))

    def test_each_reviewed_node_input_selects_its_suite(self):
        for path in route.ROOT_CHANNEL_INPUTS:
            with self.subTest(path=path):
                self.assertEqual(route.select([('M', path)])[0], 'node-root-channel')

    def test_native_and_mixed_changes_keep_native_qualification(self):
        for path in ('bend2/src/coordinator/main.bend', 'bend2/src/host/native-entry.c',
                     'bend2/src/host/process.h', 'bend2/compiler/compiler.lock.json',
                     'bend2/scripts/package-native.py', 'bend2/scripts/build-native.sh',
                     'bend2/toolchain/runtime-pin.txt', '.github/workflows/bend2-native.yml',
                     '.github/scripts/native-validation-route.py', 'bend2/test/native-validation-route.py',
                     'bend2/harness/native-history.mjs', 'bend2/scripts/new-helper.mjs',
                     'docs/bend2/reference/toolchain/install-2.0.25.sh', 'LICENSE'):
            with self.subTest(path=path):
                self.assertEqual(route.select([('M', path)])[0], 'native')
                self.assertEqual(route.select([('M', 'bend2/scripts/codex-root-relay.mjs'),
                                               ('A', path)])[0], 'native')

    def test_removal_and_rename_keep_native_qualification(self):
        original = 'bend2/scripts/codex-root-relay.mjs'
        git(self.repo, 'mv', original, 'bend2/scripts/renamed.mjs')
        commit(self.repo)
        self.assertEqual(self.run_route()['route'], 'native')
        self.assertEqual(route.select([('D', original)])[0], 'native')
        self.assertEqual(route.select([('T', original)])[0], 'native')

    def test_docs_and_empty_comparisons_keep_native_qualification(self):
        self.assertEqual(self.run_route()['route'], 'native')
        write(self.repo, 'docs/bend2/root-channel-attach-1212.md', 'Updated documentation.\n')
        commit(self.repo)
        self.assertEqual(self.run_route()['route'], 'native')

    def test_dispatch_uses_native_qualification(self):
        self.assertEqual(self.run_route(event='workflow_dispatch', base='')['route'], 'native')

    def test_invalid_comparison_keeps_native_qualification(self):
        for base, head in ((self.base[:12], self.base), (self.base, '1' * 40)):
            with self.subTest(base=base, head=head):
                self.assertEqual(self.run_route(base=base, head=head)['route'], 'native')

    def test_shallow_checkout_fetches_only_the_exact_base(self):
        write(self.repo, 'bend2/scripts/codex-root-relay.mjs', 'export const value = 2;\n')
        commit(self.repo)
        shallow = self.work / 'shallow'
        git(self.work, 'clone', '-q', '--depth', '1', 'file://' + str(self.repo), str(shallow))
        record = self.run_route(source=shallow)
        self.assertEqual(record['route'], 'node-root-channel')
        self.assertEqual(record['base_availability'], 'fetched')

    def test_unavailable_base_keeps_native_qualification(self):
        self.assertEqual(self.run_route(base='0' * 40)['route'], 'native')


class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jobs = yaml.safe_load((ROOT / '.github/workflows/bend2-native.yml').read_text())['jobs']

    def test_native_jobs_require_native_selection_before_their_steps(self):
        for name in ('linux-candidate', 'darwin-arm64', 'linux-native-qualification', 'linux-target'):
            with self.subTest(job=name):
                job = self.jobs[name]
                self.assertIn('select-validation', job['needs'])
                self.assertIn("needs.select-validation.outputs.route == 'native'", job['if'])

    def test_node_route_runs_the_existing_root_channel_suite(self):
        selection = self.jobs['select-validation']
        self.assertEqual(selection['runs-on']['group'], 'baton2-native-homelab')
        step = next(step for step in selection['steps'] if step['name'] == 'Run root-channel Node checks')
        self.assertIn("steps.route.outputs.route == 'node-root-channel'", step['if'])
        self.assertIn('node --test bend2/test/root-channel-attach.test.mjs bend2/test/codex-root-relay.test.mjs', step['run'])
        self.assertIn('set -euo pipefail', step['run'])

    def test_old_candidate_without_selector_uses_native_validation(self):
        step = next(step for step in self.jobs['select-validation']['steps'] if step.get('id') == 'route')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(['bash', '-c', step['run']], cwd=root, text=True, capture_output=True,
                                    env=dict(os.environ, BATON2_VALIDATION_ROUTE=str(root / 'evidence'),
                                             GITHUB_OUTPUT=str(root / 'github-output')))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / 'github-output').read_text(), 'route=native\n')
            self.assertEqual(json.loads((root / 'evidence/selection.json').read_text())['route'], 'native')


if __name__ == '__main__':
    unittest.main()
