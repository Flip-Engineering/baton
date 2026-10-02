"""Hierarchy acceptance checks final file scope, correction landings, and the generated CHECK."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('hierarchy', ROOT / 'bend2/scripts/accept-kimi-hierarchy.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)

ADAPTER = Path('bend2/scripts/check-unittest.sh')

PASSING = '''
import pathlib
import unittest

class Executed(unittest.TestCase):
    def test_body_runs(self):
        pathlib.Path('executed.marker').write_text('ran')
        self.assertEqual(1, 1)
'''

SKIPPED = '''
import unittest

class Skipped(unittest.TestCase):
    @unittest.skip('prerequisite absent')
    def test_skipped(self):
        self.fail('never')
'''

EMPTY = 'import unittest\n'


def compiler():
    """The installed Bend compiler the native fixture build uses."""
    value = os.environ.get('BEND')
    if value:
        return str(Path(shutil.which(value) or value).resolve())
    for candidate in (ROOT / '.bend/bin/bend', ROOT / 'node_modules/.bend/bin/bend'):
        if candidate.is_file():
            return str(candidate)
    raise AssertionError('No Bend compiler for the native fixture build')


class HierarchyHistory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.repo = self.out / 'repo'
        self.repo.mkdir()
        self.git('init', '-q', '-b', 'base')
        self.git('config', 'user.name', 'Hierarchy test')
        self.git('config', 'user.email', 'hierarchy@example.invalid')
        self.commit({'deep.txt': 'base', 'muse.txt': 'base', 'outside.txt': 'base'})
        self.base = self.git('rev-parse', 'HEAD')
        for branch in ['hierarchy-lead', 'hierarchy-deepseek', 'hierarchy-muse', 'bend2-trial']:
            self.git('branch', branch, self.base)
        self.run_record = {'source': self.base, 'tasks': {
            'deepseek': {'files': ['deep.txt']}, 'muse': {'files': ['muse.txt']}}}
        self.sessions = {seat: {'base': self.base} for seat in ['deepseek', 'muse']}
        self.git('checkout', '-q', 'hierarchy-muse')
        self.commit({'muse.txt': 'first muse'})
        self.land('muse')
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.commit({'deep.txt': 'first deep'})
        self.land('deepseek')
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.commit({'deep.txt': 'corrected deep'})
        self.merge_target('deepseek', {'deep.txt': 'corrected deep'})
        self.land('deepseek', '-correction')
        self.git('checkout', '-q', 'hierarchy-muse')
        self.commit({'muse.txt': 'corrected muse'})
        self.merge_target('muse', {'muse.txt': 'corrected muse'})
        self.land('muse', '-correction')
        self.publish_target()

    def git(self, *args):
        result = subprocess.run(['git', '-C', str(self.repo), *args],
                                text=True, capture_output=True, check=True)
        return result.stdout.strip()

    def commit(self, files):
        for name, body in files.items():
            (self.repo / name).write_text(body + '\n')
        self.git('add', '-A')
        self.git('commit', '-q', '--allow-empty', '-m', 'fixture change')
        return self.git('rev-parse', 'HEAD')

    def receipt(self, name, target, commit):
        value = {'status': 'landed', 'target': target, 'commit': commit}
        (self.out / f'landing-{name}.json').write_text(json.dumps(value))

    def land(self, seat, suffix=''):
        self.git('checkout', '-q', 'hierarchy-lead')
        self.git('merge', '--squash', f'hierarchy-{seat}')
        commit = self.commit({})
        self.receipt(seat + suffix, 'hierarchy-lead', commit)

    def merge_target(self, seat, resolution):
        inherited = {name: self.git('show', f'hierarchy-lead:{name}')
                     for name in ['deep.txt', 'muse.txt', 'outside.txt']}
        self.git('checkout', '-q', f'hierarchy-{seat}')
        result = subprocess.run(['git', '-C', str(self.repo), 'merge', '--no-ff', '--no-commit',
                                 'hierarchy-lead'], text=True, capture_output=True)
        self.assertIn(result.returncode, [0, 1], result.stderr)
        self.assertTrue((self.repo / '.git/MERGE_HEAD').exists(), result.stdout + result.stderr)
        return self.commit({**inherited, **resolution})

    def publish_target(self):
        self.git('checkout', '-q', 'bend2-trial')
        self.git('read-tree', '--reset', '-u', 'hierarchy-lead')
        self.receipt('root', 'bend2-trial', self.commit({}))
        self.git('checkout', '-q', '--detach')

    def verify(self):
        return DRIVER.verify_landings(self.out, self.run_record, self.sessions)

    def test_correction_merges_keep_initial_and_latest_landings(self):
        result = self.verify()
        self.assertEqual(result['selected_player_receipts']['deepseek'], 'landing-deepseek-correction.json')
        self.assertEqual(result['selected_player_receipts']['muse'], 'landing-muse-correction.json')
        initial = json.loads((self.out / 'landing-deepseek.json').read_text())
        self.assertEqual(result['landing_receipts']['landing-deepseek.json'], initial)
        self.assertNotEqual(result['landings']['deepseek']['commit'], initial['commit'])

    def test_rebased_correction_preserves_peer_changes(self):
        self.git('checkout', '-q', 'hierarchy-deepseek')
        previous = self.git('rev-parse', 'HEAD')
        self.commit({'deep.txt': 'next deep'})
        self.git('rebase', '--onto', 'hierarchy-lead', previous, 'hierarchy-deepseek')
        self.land('deepseek', '-next')
        self.publish_target()
        result = self.verify()
        self.assertEqual(result['selected_player_receipts']['deepseek'], 'landing-deepseek-next.json')
        self.assertEqual(self.git('show', 'hierarchy-deepseek:muse.txt'), 'corrected muse')

    def test_unlanded_player_change_outside_run_scope_fails(self):
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.commit({'outside.txt': 'unassigned worker change'})
        with self.assertRaisesRegex(AssertionError, 'Unassigned Player changes'):
            self.verify()

    def test_unlanded_assigned_file_correction_fails(self):
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.commit({'deep.txt': 'unlanded correction'})
        with self.assertRaisesRegex(AssertionError, 'correction was not landed'):
            self.verify()

    def test_initial_receipt_cannot_authorize_unlanded_correction(self):
        path = self.out / 'landing-deepseek-correction.json'
        path.write_text(json.dumps({'status': 'blocked', 'reason': 'fixture refusal'}))
        with self.assertRaisesRegex(AssertionError, 'correction was not landed'):
            self.verify()

    def test_final_target_scope_covers_lead_edits(self):
        self.git('checkout', '-q', 'hierarchy-lead')
        self.commit({'outside.txt': 'unassigned lead change'})
        self.publish_target()
        with self.assertRaisesRegex(AssertionError, 'Unassigned target changes'):
            self.verify()

    def test_final_target_preserves_assigned_file_mode(self):
        self.git('checkout', '-q', 'hierarchy-lead')
        (self.repo / 'deep.txt').chmod(0o755)
        self.commit({})
        self.publish_target()
        with self.assertRaisesRegex(AssertionError, 'content or mode'):
            self.verify()

    def test_landed_deletion_keeps_stored_absence_and_peer_content(self):
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.merge_target('deepseek', {})
        self.git('rm', '-q', 'deep.txt')
        self.commit({})
        self.land('deepseek', '-delete')
        self.publish_target()
        result = self.verify()
        self.assertEqual(result['selected_player_receipts']['deepseek'],
                         'landing-deepseek-delete.json')
        player = result['tips']['deepseek']
        landed = result['landings']['deepseek']['commit']
        target = result['tips']['target']
        self.assertEqual(DRIVER.git_entry(self.repo, player, 'deep.txt'), '',
                         'the worker branch stores the deleted file')
        self.assertEqual(DRIVER.git_entry(self.repo, landed, 'deep.txt'), '',
                         'the selected receipt does not store the deletion')
        self.assertEqual(DRIVER.git_entry(self.repo, target, 'deep.txt'), '',
                         'the final target restored the deleted file')
        self.assertNotEqual(DRIVER.git_entry(self.repo, target, 'muse.txt'), '',
                            'the peer file is absent from the final target')
        self.assertEqual(self.git('show', 'bend2-trial:muse.txt'), 'corrected muse')
        initial = self.out / 'landing-deepseek.json'
        self.assertEqual(result['landing_receipts']['landing-deepseek.json'],
                         json.loads(initial.read_text()))

    def test_unlanded_deletion_after_last_landing_is_refused(self):
        last = json.loads((self.out / 'landing-deepseek-correction.json').read_text())
        self.assertEqual(last['status'], 'landed')
        self.assertNotEqual(DRIVER.git_entry(self.repo, last['commit'], 'deep.txt'), '',
                            'the earlier receipt did not land the file')
        target = self.git('rev-parse', 'bend2-trial')
        self.assertNotEqual(DRIVER.git_entry(self.repo, target, 'deep.txt'), '',
                            'the final target lost the previously landed file')
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.git('rm', '-q', 'deep.txt')
        self.commit({})
        with self.assertRaisesRegex(AssertionError, 'correction was not landed'):
            self.verify()

    def test_divergent_successful_correction_receipts_are_refused(self):
        for name in ['landing-deepseek.json', 'landing-deepseek-correction.json']:
            self.assertEqual(json.loads((self.out / name).read_text())['status'], 'landed')
        player = self.git('rev-parse', 'hierarchy-deepseek')
        assigned = DRIVER.git_entry(self.repo, player, 'deep.txt')
        self.assertNotEqual(assigned, '', 'the worker tip has no assigned content')
        original = self.git('show', f'{player}:deep.txt')
        self.git('checkout', '-q', 'hierarchy-lead')
        self.git('checkout', '-q', '-b', 'diverge-a')
        transient = self.commit({'deep.txt': 'divergent a'})
        self.assertNotEqual(DRIVER.git_entry(self.repo, transient, 'deep.txt'), assigned,
                            'the first fork did not commit its transient change')
        first = self.commit({'deep.txt': original})
        self.assertEqual(DRIVER.git_entry(self.repo, first, 'deep.txt'), assigned,
                         'the first receipt does not restore the assigned content')
        self.receipt('deepseek-diverge-a', 'hierarchy-lead', first)
        self.git('checkout', '-q', 'hierarchy-lead')
        self.git('checkout', '-q', '-b', 'diverge-b')
        transient = self.commit({'deep.txt': 'divergent b'})
        self.assertNotEqual(DRIVER.git_entry(self.repo, transient, 'deep.txt'), assigned,
                            'the second fork did not commit its transient change')
        second = self.commit({'deep.txt': original})
        self.assertEqual(DRIVER.git_entry(self.repo, second, 'deep.txt'), assigned,
                         'the second receipt does not restore the assigned content')
        self.receipt('deepseek-diverge-b', 'hierarchy-lead', second)
        self.git('checkout', '-q', 'hierarchy-lead')
        self.git('merge', '--no-ff', '--no-edit', 'diverge-a')
        self.git('merge', '--no-ff', '--no-edit', 'diverge-b')
        self.publish_target()
        target = self.git('rev-parse', 'bend2-trial')
        lead = self.git('rev-parse', 'hierarchy-lead')
        for commit in (first, second):
            self.assertEqual(self.git('merge-base', commit, lead), commit)
            self.assertEqual(DRIVER.git_entry(self.repo, player, 'deep.txt'),
                             DRIVER.git_entry(self.repo, commit, 'deep.txt'))
            self.assertEqual(DRIVER.git_entry(self.repo, target, 'deep.txt'),
                             DRIVER.git_entry(self.repo, commit, 'deep.txt'))
        self.assertNotEqual(self.git('merge-base', first, second), first)
        self.assertNotEqual(self.git('merge-base', first, second), second)
        with self.assertRaisesRegex(AssertionError, 'divergent histories'):
            self.verify()


class GeneratedCheck(unittest.TestCase):
    """The generated hierarchy CHECK routes each selected file through the adapter."""

    def setUp(self):
        self.scratch = ROOT / '.scratch'
        self.scratch.mkdir(exist_ok=True)
        self.fixture = Path(tempfile.mkdtemp(prefix='hierarchy-check-', dir=self.scratch))
        self.addCleanup(shutil.rmtree, self.fixture, ignore_errors=True)

    def install_adapter(self):
        adapter = self.fixture / ADAPTER
        adapter.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / ADAPTER, adapter)

    def select(self, name, body):
        path = self.fixture / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        return name

    def check(self, selected):
        script = self.fixture / 'check.sh'
        script.write_text(DRIVER.hierarchy_check(compiler()))
        return subprocess.run(['/bin/sh', str(script), selected],
                              cwd=self.fixture, text=True, capture_output=True)

    def test_generated_check_runs_the_selected_test_body(self):
        self.install_adapter()
        selected = self.select('selected/executed.py', PASSING)
        result = self.check(selected)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertTrue((self.fixture / 'executed.marker').is_file(),
                        'the selected test body did not run')

    def test_generated_check_refuses_a_skipped_selection(self):
        self.install_adapter()
        selected = self.select('selected/skipped.py', SKIPPED)
        result = self.check(selected)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('unjudged', result.stdout)

    def test_generated_check_refuses_an_empty_selection(self):
        self.install_adapter()
        selected = self.select('selected/empty.py', EMPTY)
        result = self.check(selected)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('unjudged', result.stdout)

    def test_generated_check_builds_and_runs_selected_native_tests(self):
        shutil.copytree(ROOT / 'bend2', self.fixture / 'bend2')
        coordinator = self.fixture / '.scratch/bend2/baton2'
        self.assertFalse(coordinator.exists(), 'the fixture tree started with a coordinator')
        result = self.check('bend2/test/receive.py')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertNotIn('unjudged', result.stdout + result.stderr)
        self.assertTrue(coordinator.is_file(), 'the adapter did not build the coordinator')


if __name__ == '__main__':
    unittest.main()
