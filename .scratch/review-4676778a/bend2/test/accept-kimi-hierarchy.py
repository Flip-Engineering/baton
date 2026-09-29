"""Hierarchy acceptance checks final file scope and correction landing contents."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('hierarchy', ROOT / 'bend2/scripts/accept-kimi-hierarchy.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


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
        self.assertEqual(result['selected_worker_receipts']['deepseek'], 'landing-deepseek-correction.json')
        self.assertEqual(result['selected_worker_receipts']['muse'], 'landing-muse-correction.json')
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
        self.assertEqual(result['selected_worker_receipts']['deepseek'], 'landing-deepseek-next.json')
        self.assertEqual(self.git('show', 'hierarchy-deepseek:muse.txt'), 'corrected muse')

    def test_unlanded_worker_change_outside_run_scope_fails(self):
        self.git('checkout', '-q', 'hierarchy-deepseek')
        self.commit({'outside.txt': 'unassigned worker change'})
        with self.assertRaisesRegex(AssertionError, 'Unassigned worker changes'):
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


if __name__ == '__main__':
    unittest.main()
