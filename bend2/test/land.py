"""Landing module: advance a target branch to include a worker's committed tip."""
import json
import pathlib
import subprocess
import threading
import time
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
        commit = self.recruit_and_commit()
        first = self.call('land-checked', 'w1', self.repo, 'main',
                          'check-pass.sh', 'file.txt')
        self.assertEqual(first['status'], 'landed')
        second = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(second['status'], 'already')
        self.assertEqual(second['commit'], commit)
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

    def test_push_publishes_branch_to_remote(self):
        remote = self.directory / 'remote.git'
        subprocess.run(
            ['git', 'init', '-q', '--bare', str(remote)],
            check=True, capture_output=True,
        )
        self.git('remote', 'add', 'test-remote', str(remote))
        self.git('push', '-q', 'test-remote', 'main')
        commit = self.recruit_and_commit()
        self.call('land', 'w1', self.repo, 'main')
        result = self.call('push', self.repo, 'main', 'test-remote')
        self.assertEqual(result['status'], 'pushed')
        self.assertEqual(result['branch'], 'main')
        self.assertEqual(result['remote'], 'test-remote')
        remote_tip = subprocess.run(
            ['git', 'ls-remote', str(remote), 'refs/heads/main'],
            check=True, text=True, capture_output=True,
        ).stdout.split()
        self.assertEqual(remote_tip, [commit, 'refs/heads/main'])

    def test_push_rejected_when_remote_ahead(self):
        remote = self.directory / 'remote.git'
        subprocess.run(
            ['git', 'init', '-q', '--bare', str(remote)],
            check=True, capture_output=True,
        )
        self.git('remote', 'add', 'test-remote', str(remote))
        self.git('push', '-q', 'test-remote', 'main')
        clone = self.directory / 'clone'
        subprocess.run(
            ['git', 'clone', '-q', '-b', 'main', str(remote), str(clone)],
            check=True, capture_output=True,
        )
        for k, v in [('user.name', 'Other'), ('user.email', 'o@e.i')]:
            subprocess.run(
                ['git', '-C', str(clone), 'config', k, v],
                check=True, capture_output=True,
            )
        subprocess.run(
            ['git', '-C', str(clone), 'commit', '-q', '--allow-empty', '-m', 'ahead'],
            check=True, capture_output=True,
        )
        subprocess.run(
            ['git', 'push', str(remote), 'main'],
            cwd=str(clone), check=True, capture_output=True,
        )
        self.recruit_and_commit()
        self.call('land', 'w1', self.repo, 'main')
        result = self.call('push', self.repo, 'main', 'test-remote')
        self.assertEqual(result['status'], 'rejected')

    def waiting_checks(self):
        """Checks for the target-move rows: one waits for the target to move."""
        (self.repo / 'check-wait.sh').write_text(
            'common=$(git rev-parse --git-common-dir)\n'
            'repo=$(dirname "$common")\n'
            'before=$(git -C "$repo" rev-parse refs/heads/main)\n'
            'n=0\n'
            'while [ "$(git -C "$repo" rev-parse refs/heads/main)" = "$before" ]; do\n'
            '  n=$((n + 1))\n'
            '  [ "$n" -gt 60 ] && { echo 77616974 6e6f6d6f7665 6572726f 2d; exit 1; }\n'
            '  sleep 0.2\n'
            'done\n'
            'git rev-parse --verify HEAD >/dev/null || '
            '{ echo 77616974 6e6f68656164 6572726f 2d; exit 1; }\n'
            'exit 0\n')
        (self.repo / 'check-plain.sh').write_text(
            'git rev-parse --verify HEAD >/dev/null || '
            '{ echo 706c61696e 6e6f68656164 6572726f 2d; exit 1; }\n'
            'exit 0\n')
        self.git('add', 'check-wait.sh')
        self.git('add', 'check-plain.sh')
        self.git('commit', '-q', '-m', 'check fixtures')

    def wait_for_candidate(self, worker, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if list(self.repo.glob(f'.scratch/bend2-land-{worker}-*')):
                return
            time.sleep(0.1)
        self.fail(f'the candidate for {worker} was never prepared')

    def land_under_a_move(self, under, mover):
        """Start UNDER's landing, move the target with MOVER's, answer UNDER's."""
        answer = {}

        def land_under():
            try:
                answer['result'] = self.call('land-checked', under, self.repo, 'main',
                                             'check-wait.sh', 'file.txt')
            except BaseException as error:
                answer['error'] = error

        thread = threading.Thread(target=land_under)
        thread.start()
        self.wait_for_candidate(under)
        moved = self.call('land-checked', mover, self.repo, 'main',
                          'check-plain.sh', 'file.txt')
        thread.join(120)
        self.assertFalse(thread.is_alive(), f'the landing of {under} did not finish')
        self.assertNotIn('error', answer, str(answer.get('error')))
        return moved, answer['result']

    def recruit_and_write(self, worker, branch, path, name, body):
        self.call('recruit', worker, 'root', 'omp', 'model', 'high',
                  self.repo, branch, path, self.base)
        wt = self.repo / path
        (wt / name).write_text(body)
        subprocess.run(['git', '-C', str(wt), 'add', name], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'commit', '-q', '-m', f'{worker} writes {name}'],
                       check=True, capture_output=True)
        return self.git('rev-parse', branch).strip()

    def test_target_moves_under_the_second_landing_and_it_rebases(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_write('w1', 'wa', 'wt1', 'a.txt', 'alpha\n')
        self.recruit_and_write('w2', 'wb', 'wt2', 'b.txt', 'beta\n')
        moved, under = self.land_under_a_move('w2', 'w1')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(under['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main^').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:a.txt').strip(), 'alpha')
        self.assertEqual(self.git('show', 'main:b.txt').strip(), 'beta')

    def test_target_moves_under_the_second_landing_and_the_rebase_conflicts(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit('w3', 'wc', 'wt3')
        self.recruit_and_commit('w4', 'wd', 'wt4')
        moved, under = self.land_under_a_move('w4', 'w3')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(under['status'], 'conflict')
        self.assertEqual(under['files'], 'file.txt')
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:file.txt').strip(), 'worker change for w3')

if __name__ == '__main__':
    unittest.main()
