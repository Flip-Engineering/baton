"""Landing module: advance a target branch to include a worker's committed tip."""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Land(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.db = self.directory / 'state.db'
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Baton test')
        self.git('config', 'user.email', 'baton@example.invalid')
        self.git('commit', '-q', '--allow-empty', '-m', 'initial')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.call('attach', 'root', 'codex', 'native-root', 'endpoint')

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ['git', '-C', str(self.repo), *args],
            check=True, text=True, capture_output=True,
        ).stdout

    def call(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *map(str, args)],
            text=True, capture_output=True,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        return p.stderr

    def recruit_and_commit(self, worker='w1', branch='w1-branch', path='wt'):
        self.call('recruit', worker, 'root', 'omp', 'model', 'high',
                  self.repo, branch, path, self.base)
        wt = self.repo / path
        (wt / 'file.txt').write_text(f'worker change for {worker}')
        subprocess.run(
            ['git', '-C', str(wt), 'add', 'file.txt'],
            check=True, capture_output=True,
        )
        subprocess.run(
            ['git', '-C', str(wt), 'commit', '-q', '-m', 'worker commit'],
            check=True, capture_output=True,
        )
        return self.git('rev-parse', branch).strip()

    def test_fast_forward_landing(self):
        commit = self.recruit_and_commit()
        result = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], commit)
        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, commit)

    def test_already_merged(self):
        commit = self.recruit_and_commit()
        self.call('land', 'w1', self.repo, 'main')
        result = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(result['status'], 'already')
        self.assertEqual(result['commit'], commit)

    def test_not_fast_forward_blocked(self):
        self.recruit_and_commit('w1', 'w1-branch', 'wt1')
        self.recruit_and_commit('w2', 'w2-branch', 'wt2')
        self.call('land', 'w1', self.repo, 'main')
        result = self.call('land', 'w2', self.repo, 'main')
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('not a fast-forward', result['reason'])

    def test_checked_landing_advances(self):
        (self.repo / 'check-pass.sh').write_text('exit 0\n')
        self.git('add', 'check-pass.sh')
        self.git('commit', '-q', '-m', 'check fixture')
        self.git('checkout', '-q', '--detach')
        commit = self.recruit_and_commit()
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(result['status'], 'landed')
        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, result['commit'])
        self.assertEqual(self.git('show', 'main:file.txt').strip(),
                         'worker change for w1')

    def test_checked_landing_blocks_on_new_failure(self):
        (self.repo / 'check-blocked.sh').write_text(
            'test -f "$1" && { echo 6161 6161 6161 2d; exit 1; }\n'
            'exit 0\n')
        self.git('add', 'check-blocked.sh')
        self.git('commit', '-q', '-m', 'check fixture')
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit()
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-blocked.sh', 'file.txt')
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('new failures', result['reason'])
        self.assertIn('6161 6161 6161 2d', result['reason'])

    def test_checked_landing_already_merged(self):
        (self.repo / 'check-pass.sh').write_text('exit 0\n')
        self.git('add', 'check-pass.sh')
        self.git('commit', '-q', '-m', 'check fixture')
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit()
        first = self.call('land-checked', 'w1', self.repo, 'main',
                          'check-pass.sh', 'file.txt')
        self.assertEqual(first['status'], 'landed')
        second = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(second['status'], 'already')
        self.assertEqual(self.git('rev-parse', 'main').strip(), first['commit'])

    def test_fast_forward_repeated_landing_keeps_one_result(self):
        commit = self.recruit_and_commit()
        first = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(first['status'], 'landed')
        self.assertEqual(first['commit'], commit)
        second = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(second['status'], 'already')
        self.assertEqual(second['commit'], commit)
        third = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(third['status'], 'already')
        self.assertEqual(third['commit'], commit)
        self.assertEqual(self.git('rev-parse', 'main').strip(), commit)

    def test_worker_with_no_branch_refused(self):
        self.call('worker', 'w3', 'root', 'omp', 'model', 'high', '/tmp', '', '')
        error = self.call('land', 'w3', self.repo, 'main', ok=False)
        self.assertIn('no recorded branch', error)

if __name__ == '__main__':
    unittest.main()
