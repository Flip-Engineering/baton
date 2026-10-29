#!/usr/bin/env python3
"""Producer routing and provenance for pull request native runs.

Synthetic git repositories exercise `.github/scripts/native-producer-route.py`:
a change outside the Main production inputs selects the base-produced Main C,
a change inside them (or to the producer tooling) selects the pull request's
own producer, and a base-produced handoff stays labelled with the base commit
and binds to the head only through equal inputs. The workflow tests check the
job graph and the step conditions. No compiler is launched.
"""
import hashlib
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
SCRIPT = ROOT / '.github/scripts/native-producer-route.py'
WORKFLOW = ROOT / '.github/workflows/bend2-native.yml'
spec = importlib.util.spec_from_file_location('native_producer_route', SCRIPT)
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)
ARCHIVE = next(iter(route.reuse['COMPILER_ARCHIVES']))


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def git(root, *args):
    return subprocess.check_output(
        ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
         '-c', 'commit.gpgsign=false', *args], cwd=root, text=True).strip()


def commit(root, message):
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', message)
    return git(root, 'rev-parse', 'HEAD')


STUB_ADAPTER = """import os, sys
from pathlib import Path


def environment(run):
    Path(run, 'queue-config.json').write_text('{}')
    return dict(os.environ, STUB_QUEUE='1')


if __name__ == '__main__':
    mode, kind, compiler, entry, flag, output = sys.argv[1:7]
    assert (mode, kind, flag, entry) == ('stage', 'bend', '-o', 'bend2/src/coordinator/main.bend')
    assert os.environ['STUB_QUEUE'] == '1'
    Path(output).write_text('C generated in ' + os.getcwd() + '\\n')
"""


class Repository:
    """A repository holding a Main closure, an unrelated module, harness files and the tooling."""

    def __init__(self, directory):
        self.root = Path(directory) / 'repo'
        self.root.mkdir()
        git(self.root, 'init', '-q', '-b', 'main')
        write(self.root / 'bend2/src/coordinator/main.bend',
              'import Base\nimport ./store.bend as Store\n\ndef main() -> U32:\n  Store.value\n')
        write(self.root / 'bend2/src/coordinator/store.bend',
              'import Base\nimport ../host/process.bend as Process\n\ndef value() -> U32:\n  Process.value\n')
        write(self.root / 'bend2/src/host/process.bend',
              'import Base\n\ndef value() -> U32:\n  foreign:\n    import "./process-spawn.c"\n')
        write(self.root / 'bend2/src/host/process-spawn.c', '#include "persistent-path.h"\nint spawn(void){return 1;}\n')
        write(self.root / 'bend2/src/host/persistent-path.h', '#define PERSISTENT 1\n')
        write(self.root / 'bend2/src/coordinator/unrelated.bend',
              'import Base\n\ndef unrelated() -> U32:\n  1\n')
        write(self.root / 'bend2/harness/git-series.mjs', 'export const version = 1;\n')
        write(self.root / 'bend2/test/git-series.mjs', 'export const test = 1;\n')
        write(self.root / 'docs/note.md', 'note\n')
        for path in route.PRODUCER_TOOLING:
            write(self.root / path, 'tooling ' + path + '\n')
        write(self.root / '.github/scripts/queue-native-checks.py', STUB_ADAPTER)
        write(self.root / 'bend2/scripts/bend-lineage-guard.sh', 'exit 0\n')
        self.base = commit(self.root, 'base')

    def change(self, path, text):
        write(self.root / path, text)
        return commit(self.root, 'change ' + path)

    def route(self, event='pull_request', base=None, head=None):
        run = self.root.parent / ('run-' + str(len(list(self.root.parent.glob('run-*')))))
        run.mkdir()
        output = run / 'github-output'
        head = head or git(self.root, 'rev-parse', 'HEAD')
        arguments = [sys.executable, str(SCRIPT), 'route', '--source', str(self.root), '--run', str(run),
                     '--event', event, '--base', self.base if base is None else base, '--head', head,
                     '--github-output', str(output)]
        subprocess.run(arguments, check=True, stdout=subprocess.PIPE)
        values = dict(line.split('=', 1) for line in output.read_text().splitlines())
        return values['producer'], values['reason'], run


class RouteSelection(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repository = Repository(self.directory.name)

    def test_harness_and_test_changes_select_the_base_producer(self):
        self.repository.change('bend2/harness/git-series.mjs', 'export const version = 2;\n')
        self.repository.change('bend2/test/git-series.mjs', 'export const test = 2;\n')
        self.repository.change('docs/note.md', 'changed\n')
        producer, reason, run = self.repository.route()
        self.assertEqual(producer, 'base', reason)
        record = json.loads((run / 'evidence/producer-route.json').read_text())
        self.assertEqual(record['base'], self.repository.base)
        self.assertEqual(record['producer'], 'base')
        self.assertEqual(record['production_inputs'], 5)

    def test_bend_module_outside_the_main_closure_selects_the_base_producer(self):
        self.repository.change('bend2/src/coordinator/unrelated.bend', 'import Base\n\ndef unrelated() -> U32:\n  2\n')
        self.assertEqual(self.repository.route()[0], 'base')

    def test_changes_inside_the_main_closure_select_the_candidate_producer(self):
        for path, text in (('bend2/src/coordinator/store.bend',
                            'import Base\nimport ../host/process.bend as Process\n\ndef value() -> U32:\n  2\n'),
                           ('bend2/src/host/process-spawn.c', '#include "persistent-path.h"\nint spawn(void){return 2;}\n'),
                           ('bend2/src/host/persistent-path.h', '#define PERSISTENT 2\n')):
            with self.subTest(path=path):
                self.setUp()
                self.repository.change(path, text)
                producer, reason, _ = self.repository.route()
                self.assertEqual(producer, 'candidate')
                self.assertIn(path, reason)

    def test_new_import_pulls_the_file_into_the_comparison(self):
        self.repository.change('bend2/src/coordinator/main.bend',
                               'import Base\nimport ./store.bend as Store\nimport ./unrelated.bend as Other\n\ndef main() -> U32:\n  Store.value\n')
        producer, reason, _ = self.repository.route()
        self.assertEqual(producer, 'candidate')
        self.assertIn('bend2/src/coordinator/main.bend', reason)

    def test_every_producer_tooling_file_selects_the_candidate_producer(self):
        for path in route.PRODUCER_TOOLING:
            with self.subTest(path=path):
                self.setUp()
                self.repository.change(path, 'changed\n')
                producer, reason, _ = self.repository.route()
                self.assertEqual(producer, 'candidate')
                self.assertIn(path, reason)

    def test_runtime_pin_change_selects_the_candidate_producer(self):
        # bend-lineage-guard.sh reads this file, so the guard outcome can differ between base and head.
        self.repository.change('bend2/toolchain/runtime-pin.txt', 'lineage_commit=' + '1' * 40 + '\n')
        producer, reason, _ = self.repository.route()
        self.assertEqual(producer, 'candidate')
        self.assertIn('bend2/toolchain/runtime-pin.txt', reason)

    def test_tooling_file_absent_from_the_base_selects_the_candidate_producer(self):
        self.repository.change('docs/note.md', 'changed\n')
        missing = route.PRODUCER_TOOLING[1]
        git(self.repository.root, 'rm', '-q', missing)
        self.repository.base = commit(self.repository.root, 'remove tooling')
        self.repository.change(missing, 'added\n')
        producer, reason, _ = self.repository.route()
        self.assertEqual(producer, 'candidate')
        self.assertIn(missing, reason)

    def test_runs_that_are_not_pull_requests_use_their_own_producer(self):
        self.repository.change('docs/note.md', 'changed\n')
        for event in ('workflow_dispatch', 'push'):
            with self.subTest(event=event):
                self.assertEqual(self.repository.route(event=event)[0], 'candidate')

    def test_unavailable_or_malformed_base_uses_the_candidate_producer(self):
        self.repository.change('docs/note.md', 'changed\n')
        for base in ('', 'abc', '0' * 40):
            with self.subTest(base=base):
                self.assertEqual(self.repository.route(base=base)[0], 'candidate')

    def test_unsupported_import_shape_uses_the_candidate_producer(self):
        self.repository.change('bend2/src/coordinator/main.bend', 'import Base\nimport ./store.bend\n\ndef main() -> U32:\n  1\n')
        self.repository.base = git(self.repository.root, 'rev-parse', 'HEAD')
        self.repository.change('docs/note.md', 'changed\n')
        producer, reason, _ = self.repository.route()
        self.assertEqual(producer, 'candidate')
        self.assertIn('requires a normal compilation', reason)


class BaseProducedHandoff(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repository = Repository(self.directory.name)
        self.repository.change('bend2/harness/git-series.mjs', 'export const version = 2;\n')
        self.head = git(self.repository.root, 'rev-parse', 'HEAD')
        producer, _, self.run = self.repository.route()
        self.assertEqual(producer, 'base')
        generated = self.run / 'generated'
        generated.mkdir()
        selection = {'schema': 'baton2-linux-compiler-selection-v1', 'compiler_archive_sha256': ARCHIVE,
                     'compiler_binary_sha256': '5' * 64}
        write(generated / 'compiler-selection.json', json.dumps(selection))
        write(Path(self.directory.name) / 'generated.c', 'int main(void){return 0;}\n')
        self.environment = dict(os.environ, GITHUB_RUN_ID='7', GITHUB_RUN_ATTEMPT='1')
        subprocess.run([sys.executable, str(SCRIPT), 'assemble', '--source', str(self.repository.root),
                        '--run', str(self.run), '--base', self.repository.base,
                        '--generated-c', self.directory.name + '/generated.c'],
                       check=True, env=self.environment, stdout=subprocess.PIPE)
        self.generated = generated

    def verify(self, source=None):
        return subprocess.run([sys.executable, str(SCRIPT), 'verify-base',
                               '--source', str(source or self.repository.root), '--generated', str(self.generated)],
                              capture_output=True, text=True)

    def test_handoff_stays_labelled_with_the_base_commit(self):
        handoff = json.loads((self.generated / 'handoff-manifest.json').read_text())
        self.assertEqual(handoff['producer_kind'], 'base')
        self.assertEqual(handoff['source_commit'], self.repository.base)
        self.assertEqual(handoff['consumer_source_commit'], self.head)
        self.assertNotEqual(handoff['source_commit'], handoff['consumer_source_commit'])
        self.assertNotIn('linux_binary_sha256', handoff)
        self.assertEqual([row['label'] for row in handoff['checks']],
                         ['base-source-identity', 'pinned-compiler-identity', 'main-producer-route'])
        manifest = json.loads((self.generated / 'source-manifest.json').read_text())
        base_bytes = subprocess.check_output(['git', 'show', self.repository.base + ':bend2/harness/git-series.mjs'],
                                             cwd=self.repository.root)
        self.assertEqual(manifest['bend2/harness/git-series.mjs'], hashlib.sha256(base_bytes).hexdigest())

    def test_produce_generates_the_base_commit_through_the_queue_adapter(self):
        run = self.repository.root.parent / 'produce-run'
        (run / 'generated').mkdir(parents=True)
        (run / 'evidence').mkdir()
        write(run / 'generated/compiler-selection.json', (self.run / 'generated/compiler-selection.json').read_text())
        write(run / 'evidence/producer-route.json', (self.run / 'evidence/producer-route.json').read_text())
        subprocess.run([sys.executable, str(SCRIPT), 'produce', '--source', str(self.repository.root),
                        '--run', str(run), '--base', self.repository.base],
                       check=True, env=dict(self.environment, BEND='/bin/true'), stdout=subprocess.PIPE)
        handoff = json.loads((run / 'generated/handoff-manifest.json').read_text())
        self.assertEqual(handoff['producer_kind'], 'base')
        self.assertEqual([row['label'] for row in handoff['checks']],
                         ['base-source-identity', 'pinned-compiler-identity', 'base-lineage-guard',
                          'base-main-cgen', 'main-producer-route'])
        self.assertTrue(all(row['exit_code'] == 0 for row in handoff['checks']))
        generated_c = (run / 'generated/baton2.c').read_text()
        self.assertIn(str(run / 'base-source'), generated_c)
        self.assertEqual(json.loads((run / 'evidence/producer-checks.json').read_text()), handoff['checks'])
        result = self.verify_at(run / 'generated')
        self.assertEqual(result.returncode, 0, result.stderr)

    def verify_at(self, generated):
        return subprocess.run([sys.executable, str(SCRIPT), 'verify-base', '--source', str(self.repository.root),
                               '--generated', str(generated)], capture_output=True, text=True)

    def test_consumer_with_equal_inputs_verifies(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['producer_kind'], 'base')

    def test_changed_generated_c_is_refused(self):
        (self.generated / 'baton2.c').write_text('int main(void){return 1;}\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_consumer_commit_other_than_the_recorded_head_is_refused(self):
        self.repository.change('docs/note.md', 'later\n')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_changed_production_inputs_are_refused(self):
        handoff_path = self.generated / 'handoff-manifest.json'
        inputs = json.loads((self.generated / 'production-inputs.json').read_text())
        inputs[0]['sha256'] = '0' * 64
        (self.generated / 'production-inputs.json').write_text(json.dumps(inputs))
        handoff = json.loads(handoff_path.read_text())
        handoff['production_inputs_sha256'] = hashlib.sha256((self.generated / 'production-inputs.json').read_bytes()).hexdigest()
        handoff_path.write_text(json.dumps(handoff))
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Consumer Main production inputs differ', result.stderr)


class ShallowCheckout(unittest.TestCase):
    """The pull request checkout holds only the head; the route fetches the exact base commit."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name)
        self.origin = Repository(self.directory.name)
        git(self.origin.root, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
        for number in range(3):
            self.origin.change('docs/note.md', 'history %d\n' % number)
        self.origin.base = git(self.origin.root, 'rev-parse', 'HEAD')
        self.origin.change('bend2/harness/git-series.mjs', 'export const version = 2;\n')
        self.head = git(self.origin.root, 'rev-parse', 'HEAD')
        self.clone = self.work / 'clone'
        git(self.work, 'clone', '-q', '--depth', '1', 'file://' + str(self.origin.root), str(self.clone))

    def base_present(self):
        return subprocess.run(['git', '-C', str(self.clone), 'cat-file', '-e', self.origin.base + '^{commit}'],
                              capture_output=True).returncode == 0

    def route(self, base=None):
        run = self.work / ('run-' + str(len(list(self.work.glob('run-*')))))
        run.mkdir()
        output = run / 'github-output'
        subprocess.run([sys.executable, str(SCRIPT), 'route', '--source', str(self.clone), '--run', str(run),
                        '--event', 'pull_request', '--base', base or self.origin.base, '--head', self.head,
                        '--github-output', str(output)], check=True, stdout=subprocess.PIPE)
        values = dict(line.split('=', 1) for line in output.read_text().splitlines())
        return values['producer'], values['reason'], run

    def test_exact_base_is_fetched_without_its_history(self):
        self.assertFalse(self.base_present())
        producer, reason, run = self.route()
        self.assertEqual(producer, 'base', reason)
        self.assertEqual(json.loads((run / 'evidence/producer-route.json').read_text())['base_availability'], 'fetched')
        self.assertTrue(self.base_present())
        # Depth 1: the base ref holds one commit and the checkout gained no other history.
        self.assertEqual(git(self.clone, 'rev-list', '--count', 'refs/baton/producer-base'), '1')
        self.assertEqual(git(self.clone, 'rev-list', '--count', '--all'), '2')

    def test_fetched_base_stays_available_to_the_producer_steps(self):
        producer, _, run = self.route()
        self.assertEqual(producer, 'base')
        generated = run / 'generated'
        generated.mkdir()
        write(generated / 'compiler-selection.json', json.dumps({
            'schema': 'baton2-linux-compiler-selection-v1', 'compiler_archive_sha256': ARCHIVE,
            'compiler_binary_sha256': '5' * 64}))
        write(self.work / 'generated.c', 'int main(void){return 0;}\n')
        subprocess.run([sys.executable, str(SCRIPT), 'assemble', '--source', str(self.clone), '--run', str(run),
                        '--base', self.origin.base, '--generated-c', str(self.work / 'generated.c')],
                       check=True, env=dict(os.environ, GITHUB_RUN_ID='7', GITHUB_RUN_ATTEMPT='1'), stdout=subprocess.PIPE)
        handoff = json.loads((generated / 'handoff-manifest.json').read_text())
        self.assertEqual(handoff['source_commit'], self.origin.base)
        self.assertEqual(handoff['consumer_source_commit'], self.head)

    def test_unreachable_origin_selects_the_candidate_producer(self):
        git(self.clone, 'remote', 'set-url', 'origin', 'file://' + str(self.work / 'missing'))
        producer, reason, _ = self.route()
        self.assertEqual(producer, 'candidate')
        self.assertIn('could not be fetched', reason)
        self.assertFalse(self.base_present())

    def test_commit_unknown_to_origin_selects_the_candidate_producer(self):
        producer, reason, _ = self.route(base='0' * 40)
        self.assertEqual(producer, 'candidate')
        self.assertIn('could not be fetched', reason)

    def test_abbreviated_base_is_not_fetched(self):
        producer, reason, _ = self.route(base=self.origin.base[:12])
        self.assertEqual(producer, 'candidate')
        self.assertIn('full SHA', reason)
        self.assertFalse(self.base_present())


class WorkflowGraph(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.safe_load(WORKFLOW.read_text())
        cls.jobs = cls.workflow['jobs']

    def test_job_dependencies_are_defined_and_acyclic(self):
        remaining = {name: set(job.get('needs', [])) for name, job in self.jobs.items()}
        for name, needs in remaining.items():
            self.assertLessEqual(needs, set(self.jobs), name)
        while remaining:
            ready = [name for name, needs in remaining.items() if not needs]
            self.assertTrue(ready, 'dependency cycle among ' + ', '.join(remaining))
            for name in ready:
                del remaining[name]
            for needs in remaining.values():
                needs.difference_update(ready)

    def steps(self):
        return {step['name']: (index, step) for index, step in enumerate(self.jobs['linux-candidate']['steps'])}

    def test_pull_request_producer_is_selected_before_either_producer_runs(self):
        steps = self.steps()
        route_index, route_step = steps['Select the Main C producer']
        base_index, base_step = steps['Produce Main C from the base commit']
        candidate_index, candidate_step = steps['Produce exact-source Main C and Linux binary']
        self.assertLess(route_index, base_index)
        self.assertLess(route_index, candidate_index)
        self.assertIn("github.event_name == 'pull_request'", route_step['if'])
        self.assertEqual(route_step['id'], 'route')
        self.assertIn("steps.route.outputs.producer == 'base'", base_step['if'])
        self.assertIn("steps.route.outputs.producer != 'base'", candidate_step['if'])

    def test_route_step_selects_the_candidate_when_the_checkout_lacks_the_script(self):
        # A pull request branch cut before the script existed runs this workflow from the merge
        # commit but checks out its own tree.
        step = self.steps()['Select the Main C producer'][1]
        with tempfile.TemporaryDirectory() as directory:
            run, output = Path(directory) / 'run', Path(directory) / 'github-output'
            (run / 'evidence').mkdir(parents=True)
            workspace = Path(directory) / 'workspace'
            workspace.mkdir()
            result = subprocess.run(['bash', '-c', step['run']], cwd=workspace, capture_output=True, text=True,
                                    env=dict(os.environ, BATON2_LINUX_RUN=str(run), GITHUB_OUTPUT=str(output),
                                             GITHUB_WORKSPACE=str(workspace), GITHUB_EVENT_NAME='pull_request',
                                             BATON2_SOURCE_SHA='1' * 40, BATON2_PULL_REQUEST_BASE='2' * 40))
            self.assertEqual(result.returncode, 0, result.stderr)
            values = dict(line.split('=', 1) for line in output.read_text().splitlines())
            self.assertEqual(values['producer'], 'candidate')
            self.assertIn('native-producer-route.py', values['reason'])
            record = json.loads((run / 'evidence/producer-route.json').read_text())
            self.assertEqual(record['producer'], 'candidate')

    def test_candidate_checkout_stays_shallow_and_the_route_receives_the_origin_token(self):
        steps = self.steps()
        self.assertNotIn('fetch-depth', steps['Checkout exact candidate'][1]['with'])
        route_step = steps['Select the Main C producer'][1]
        self.assertEqual(route_step['env']['BATON2_ORIGIN_TOKEN'], '${{ github.token }}')
        self.assertNotIn('BATON2_ORIGIN_TOKEN', steps['Produce Main C from the base commit'][1].get('env', {}))

    def test_darwin_job_accepts_the_candidate_job_for_both_producers(self):
        darwin = self.jobs['darwin-arm64']
        self.assertEqual(darwin['needs'], ['linux-candidate'])
        self.assertIn("needs.linux-candidate.result == 'success'", darwin['if'])
        verify = next(step for step in darwin['steps'] if step['name'].startswith('Verify generated C'))
        self.assertIn('native-producer-route.py', verify['run'])
        self.assertIn('verify-base', verify['run'])
        self.assertIn("handoff.get('producer_kind') == 'base'", verify['run'])


if __name__ == '__main__':
    unittest.main()
