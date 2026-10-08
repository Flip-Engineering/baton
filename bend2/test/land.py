"""Landing module: advance a target branch to include a worker's committed tip."""
import json
import os
import pathlib
import shlex
import shutil
import socket
import subprocess
import sys
import threading
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

    def call(self, *args, ok=True, env=None):
        p = subprocess.run(
            [str(EXE), str(self.db), *map(str, args)],
            text=True, capture_output=True, env=env,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        return p.stderr

    def separate_target_holder(self):
        holder = self.repo / 'holder'
        self.git('branch', 'other', self.base)
        self.git('checkout', '-q', '--detach')
        self.git('worktree', 'add', '-q', str(holder), 'main')
        return holder

    def git_race_env(self, holder, trigger, action):
        real_git = shutil.which('git')
        self.assertIsNotNone(real_git)
        wrapper_dir = self.directory / 'git-wrapper'
        wrapper_dir.mkdir()
        wrapper = wrapper_dir / 'git'
        wrapper.write_text(
            f'#!{sys.executable}\n'
            'import os, subprocess, sys\n'
            f'REAL_GIT = {real_git!r}\n'
            f'REPO = {str(self.repo)!r}\n'
            f'HOLDER = {str(holder)!r}\n'
            f'TRIGGER = {trigger!r}\n'
            f'ACTION = {action!r}\n'
            'args = sys.argv[1:]\n'
            'if (TRIGGER == "after-worktree-list" and len(args) >= 4 and\n'
            '        args[:2] == ["-C", REPO] and args[2:4] == ["worktree", "list"]):\n'
            '    result = subprocess.run([REAL_GIT, *args], capture_output=True)\n'
            'elif (TRIGGER == "after-held-merge" and len(args) >= 4 and\n'
            '        args[:2] == ["-C", HOLDER] and args[2:4] == ["merge", "--ff-only"]):\n'
            '    result = subprocess.run([REAL_GIT, *args], capture_output=True)\n'
            'else:\n'
            '    os.execv(REAL_GIT, [REAL_GIT, *args])\n'
            'if result.returncode == 0:\n'
            '    subprocess.run(ACTION, check=True, capture_output=True)\n'
            'sys.stdout.buffer.write(result.stdout)\n'
            'sys.stderr.buffer.write(result.stderr)\n'
            'raise SystemExit(result.returncode)\n'
        )
        wrapper.chmod(0o755)
        env = os.environ.copy()
        env['PATH'] = str(wrapper_dir) + os.pathsep + env.get('PATH', '')
        return env

    def recruit_and_commit(self, player='w1', branch='w1-branch', path='wt'):
        self.call('recruit', player, 'root', 'omp', 'model', 'high',
                  self.repo, branch, path, self.base)
        wt = self.repo / path
        (wt / 'file.txt').write_text(f'worker change for {player}')
        subprocess.run(
            ['git', '-C', str(wt), 'add', 'file.txt'],
            check=True, capture_output=True,
        )
        subprocess.run(
            ['git', '-C', str(wt), 'commit', '-q', '-m', 'worker commit'],
            check=True, capture_output=True,
        )
        return self.git('rev-parse', branch).strip()

    def test_reviewed_commit_lands_ancestor_while_player_continues(self):
        reviewed = self.recruit_and_commit()
        wt = self.repo / 'wt'
        (wt / 'later.txt').write_text('work after review\n')
        subprocess.run(['git', '-C', str(wt), 'add', 'later.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'commit', '-q', '-m', 'later work'], check=True, capture_output=True)
        later = self.git('rev-parse', 'w1-branch').strip()

        result = self.call('land', 'w1', self.repo, 'main', '--commit', reviewed)

        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], reviewed)
        self.assertEqual(self.git('rev-parse', 'main').strip(), reviewed)
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), later)
        self.assertNotIn('later.txt', self.git('ls-tree', '-r', '--name-only', 'main').splitlines())
        self.assertEqual((wt / 'later.txt').read_text(), 'work after review\n')

    def test_checked_reviewed_commit_keeps_later_work_on_player_branch(self):
        (self.repo / 'check-pass.sh').write_text('test "$(cat file.txt)" = "worker change for w1"\n')
        self.git('add', 'check-pass.sh')
        self.git('commit', '-q', '-m', 'check fixture')
        self.base = self.git('rev-parse', 'HEAD').strip()
        reviewed = self.recruit_and_commit()
        wt = self.repo / 'wt'
        (wt / 'file.txt').write_text('later work\n')
        self.git('-C', str(wt), 'add', 'file.txt')
        self.git('-C', str(wt), 'commit', '-q', '-m', 'later work')
        later = self.git('rev-parse', 'w1-branch').strip()

        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt', '--commit', reviewed)

        self.assertEqual(result['status'], 'landed')
        self.assertEqual((self.repo / 'file.txt').read_text(), 'worker change for w1')
        self.assertEqual(self.tracked_status(), '')
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), later)
        self.assertEqual((wt / 'file.txt').read_text(), 'later work\n')

    def test_unrelated_reviewed_commit_preserves_target_and_scratch(self):
        worker = self.recruit_and_commit()
        self.git('commit', '-q', '--allow-empty', '-m', 'unrelated target work')
        target = self.git('rev-parse', 'main').strip()
        scratch = self.scratch_paths('w1')
        for command in ('land', 'land-checked'):
            with self.subTest(command=command):
                args = [] if command == 'land' else ['unused-check.sh', 'file.txt']
                result = subprocess.run(
                    [str(EXE), str(self.db), command, 'w1', str(self.repo), 'main',
                     *args, '--commit', target], text=True, capture_output=True)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn('not an ancestor', result.stderr)
                self.assertEqual(self.git('rev-parse', 'main').strip(), target)
                self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), worker)
                self.assertEqual(self.tracked_status(), '')
                self.assertEqual(self.scratch_paths('w1'), scratch)

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

    def tracked_status(self):
        """The tracked index and worktree deltas of the landing repository."""
        return self.git('status', '--porcelain', '--untracked-files=no')

    def test_fast_forward_landing_onto_a_checked_out_target_updates_its_worktree(self):
        # The repository's own worktree holds the target. The landing must move
        # the branch, the index and the files together: a landing that only
        # moves the ref leaves the held tree reporting the landed paths as
        # deleted.
        commit = self.recruit_and_commit()
        result = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], commit)
        self.assertEqual(self.git('rev-parse', 'main').strip(), commit)
        self.assertEqual(self.tracked_status(), '')
        self.assertEqual((self.repo / 'file.txt').read_text(),
                         'worker change for w1')

    def test_checked_landing_onto_a_checked_out_target_updates_its_worktree(self):
        (self.repo / 'check-pass.sh').write_text('exit 0\n')
        self.git('add', 'check-pass.sh')
        self.git('commit', '-q', '-m', 'check fixture')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.recruit_and_commit()
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), result['commit'])
        self.assertEqual(self.tracked_status(), '')
        self.assertEqual((self.repo / 'file.txt').read_text(),
                         'worker change for w1')

    def test_checked_landing_on_a_checked_out_target_preserves_uncommitted_work(self):
        (self.repo / 'check-pass.sh').write_text('exit 0\n')
        (self.repo / 'keep.txt').write_text('fixture\n')
        self.git('add', 'check-pass.sh')
        self.git('add', 'keep.txt')
        self.git('commit', '-q', '-m', 'check fixture')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.recruit_and_commit()
        (self.repo / 'keep.txt').write_text('local edit\n')
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), result['commit'])
        self.assertEqual((self.repo / 'keep.txt').read_text(), 'local edit\n')
        self.assertEqual((self.repo / 'file.txt').read_text(),
                         'worker change for w1')
        self.assertEqual(self.tracked_status(), ' M keep.txt\n')

    def test_checked_out_target_preserves_uncommitted_work(self):
        (self.repo / 'keep.txt').write_text('fixture\n')
        self.git('add', 'keep.txt')
        self.git('commit', '-q', '-m', 'tracked fixture')
        self.base = self.git('rev-parse', 'HEAD').strip()
        commit = self.recruit_and_commit()
        (self.repo / 'keep.txt').write_text('local edit\n')
        result = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], commit)
        self.assertEqual((self.repo / 'keep.txt').read_text(), 'local edit\n')
        self.assertEqual((self.repo / 'file.txt').read_text(),
                         'worker change for w1')
        self.assertEqual(self.tracked_status(), ' M keep.txt\n')

    def test_checked_out_target_blocks_on_overlapping_uncommitted_work(self):
        (self.repo / 'file.txt').write_text('fixture\n')
        self.git('add', 'file.txt')
        self.git('commit', '-q', '-m', 'tracked fixture')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.assertNotEqual(self.recruit_and_commit(), self.base)
        (self.repo / 'file.txt').write_text('local edit\n')
        result = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('is checked out at', result['reason'])
        self.assertIn('commit or stash', result['reason'])
        self.assertIn('rerun land', result['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), self.base)
        self.assertEqual((self.repo / 'file.txt').read_text(), 'local edit\n')
        self.assertEqual(self.tracked_status(), ' M file.txt\n')

    def test_landing_onto_a_target_held_by_a_separate_worktree(self):
        holder = self.repo / 'holder'
        self.git('checkout', '-q', '--detach')
        self.git('worktree', 'add', '-q', str(holder), 'main')
        commit = self.recruit_and_commit()
        result = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], commit)
        self.assertEqual(self.git('rev-parse', 'main').strip(), commit)
        status = subprocess.run(
            ['git', '-C', str(holder), 'status', '--porcelain',
             '--untracked-files=no'],
            check=True, text=True, capture_output=True,
        ).stdout
        self.assertEqual(status, '')
        self.assertEqual((holder / 'file.txt').read_text(),
                         'worker change for w1')
        self.assertTrue((self.repo / 'wt' / 'file.txt').is_file())

    def test_holder_change_after_worktree_discovery_does_not_mutate_other_branch(self):
        holder = self.separate_target_holder()
        candidate = self.recruit_and_commit()
        action = ['git', '-C', str(holder), 'switch', '--quiet', 'other']
        env = self.git_race_env(holder, 'after-worktree-list', action)
        result = self.call('land', 'w1', self.repo, 'main', env=env)
        head = subprocess.run(
            ['git', '-C', str(holder), 'symbolic-ref', '--quiet', 'HEAD'],
            check=True, text=True, capture_output=True,
        ).stdout.strip()
        observed = (
            result['status'],
            'changed away from target branch main' in result.get('reason', ''),
            self.git('rev-parse', 'main').strip(),
            self.git('rev-parse', 'other').strip(),
            self.git('rev-parse', 'w1-branch').strip(),
            head,
            (holder / 'file.txt').exists(),
        )
        expected = ('blocked', True, self.base, self.base, candidate,
                    'refs/heads/other', False)
        self.assertEqual(observed, expected)

    def test_holder_change_after_successful_merge_is_not_reported_as_landed(self):
        holder = self.separate_target_holder()
        candidate = self.recruit_and_commit()
        action = ['git', '-C', str(holder), 'switch', '--quiet', 'other']
        env = self.git_race_env(holder, 'after-held-merge', action)
        result = self.call('land', 'w1', self.repo, 'main', env=env)
        head = subprocess.run(
            ['git', '-C', str(holder), 'symbolic-ref', '--quiet', 'HEAD'],
            check=True, text=True, capture_output=True,
        ).stdout.strip()
        observed = (
            result['status'],
            'changed away from target branch main' in result.get('reason', ''),
            self.git('rev-parse', 'main').strip(),
            self.git('rev-parse', 'other').strip(),
            self.git('rev-parse', 'w1-branch').strip(),
            head,
            (holder / 'file.txt').exists(),
        )
        expected = ('blocked', True, candidate, self.base, candidate,
                    'refs/heads/other', False)
        self.assertEqual(observed, expected)

    def test_target_moving_after_successful_held_merge_blocks_success_answer(self):
        holder = self.separate_target_holder()
        candidate = self.recruit_and_commit()
        self.git('checkout', '-q', '--detach', candidate)
        (self.repo / 'mover.txt').write_text('target mover\n')
        self.git('add', 'mover.txt')
        self.git('commit', '-q', '-m', 'target mover')
        moved = self.git('rev-parse', 'HEAD').strip()
        action = [
            shutil.which('git'), '-C', str(holder), 'merge', '--ff-only', moved,
        ]
        env = self.git_race_env(holder, 'after-held-merge', action)
        result = self.call('land', 'w1', self.repo, 'main', env=env)
        observed = (
            result['status'],
            'target moved during landing' in result.get('reason', ''),
            self.git('rev-parse', 'main').strip(),
            self.git('rev-parse', 'w1-branch').strip(),
            subprocess.run(
                ['git', '-C', str(self.repo), 'merge-base', '--is-ancestor',
                 candidate, 'main'],
                check=False, capture_output=True,
            ).returncode == 0,
        )
        expected = ('blocked', True, moved, candidate, True)
        self.assertEqual(observed, expected)
        retry = self.call('land', 'w1', self.repo, 'main')
        self.assertEqual(retry['status'], 'already')
        self.assertEqual(retry['commit'], candidate)

    def test_target_moves_under_a_checked_out_target_and_the_retry_lands(self):
        self.waiting_checks()
        self.recruit_and_write('w1', 'wa', 'wt1', 'a.txt', 'alpha\n')
        self.recruit_and_write('w2', 'wb', 'wt2', 'b.txt', 'beta\n')
        moved, under = self.land_under_a_move('w2', 'w1')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(under['status'], 'blocked')
        self.assertIn('target moved', under['reason'])
        self.assertIn('rerun land-checked', under['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual((self.repo / 'a.txt').read_text(), 'alpha\n')
        self.assertEqual(self.tracked_status(), '')
        self.assertEqual(len(self.scratch_trees('w2')), 2)
        retry = self.call('land-checked', 'w2', self.repo, 'main',
                          'check-plain.sh', 'file.txt')
        self.assertEqual(retry['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), retry['commit'])
        self.assertEqual(self.git('show', 'main:a.txt').strip(), 'alpha')
        self.assertEqual(self.git('show', 'main:b.txt').strip(), 'beta')
        self.assertEqual((self.repo / 'a.txt').read_text(), 'alpha\n')
        self.assertEqual((self.repo / 'b.txt').read_text(), 'beta\n')
        self.assertEqual(self.tracked_status(), '')
        self.assertEqual(self.scratch_trees('w2'), [])

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

    def diagnostic_landing(self, assertion):
        test = self.repo / 'diagnostic-test.py'
        test.write_text(
            'import pathlib, sys, unittest\n'
            'class Diagnostic(unittest.TestCase):\n'
            '    def test_result(self):\n'
            '        print("calibration diagnostic " + "x" * 100000, file=sys.stderr)\n'
            f'        {assertion}\n')
        self.git('add', test.name)
        self.git('commit', '-q', '-m', 'diagnostic test')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit()
        run = subprocess.run(
            [str(EXE), str(self.db), 'land-checked', 'w1', str(self.repo),
             'main', str(ROOT / 'bend2/scripts/check-unittest.sh'), test.name],
            text=True, capture_output=True,
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertEqual(run.stderr.count('calibration diagnostic ' + 'x' * 100000), 2)
        self.assertNotIn('calibration diagnostic', run.stdout)
        return result

    def test_checked_landing_logs_stderr_with_shared_failure(self):
        result = self.diagnostic_landing('self.fail("existing failure")')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), result['commit'])
        self.assertEqual(self.git('show', 'main:file.txt').strip(), 'worker change for w1')
        self.assertEqual(self.scratch_trees('w1'), [])

    def test_checked_landing_logs_stderr_with_new_failure(self):
        result = self.diagnostic_landing('self.assertFalse(pathlib.Path("file.txt").exists())')
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('new failures', result['reason'])
        self.assertIn('diagnostic-test.py'.encode().hex(), result['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), self.base)

    def test_checked_landing_cannot_read_failure_identities_from_stderr(self):
        (self.repo / 'check-stderr.sh').write_text('echo 6161 6161 6161 2d >&2\nexit 1\n')
        self.git('add', 'check-stderr.sh')
        self.git('commit', '-q', '-m', 'stderr identity fixture')
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit()
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-stderr.sh', 'file.txt')
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('unjudged', result['reason'])

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

    def scratch_trees(self, player):
        """The scratch trees an attempt by WORKER left under the repository."""
        return sorted(p.name for p in (self.repo / '.scratch').glob(f'bend2-land-{player}-*'))

    def test_landed_attempt_removes_its_scratch_trees(self):
        (self.repo / 'check-pass.sh').write_text('exit 0\n')
        self.git('add', 'check-pass.sh')
        self.git('commit', '-q', '-m', 'check fixture')
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit()
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(result['status'], 'landed')
        self.assertEqual(self.scratch_trees('w1'), [])

    def test_refused_attempt_keeps_its_scratch_trees_until_the_next_attempt(self):
        (self.repo / 'check-blocked.sh').write_text(
            'test -f "$1" && { echo 6161 6161 6161 2d; exit 1; }\n'
            'exit 0\n')
        (self.repo / 'check-pass.sh').write_text('exit 0\n')
        self.git('add', 'check-blocked.sh')
        self.git('add', 'check-pass.sh')
        self.git('commit', '-q', '-m', 'check fixtures')
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit()
        refused = self.call('land-checked', 'w1', self.repo, 'main',
                            'check-blocked.sh', 'file.txt')
        self.assertEqual(refused['status'], 'blocked')
        kept = self.scratch_trees('w1')
        self.assertEqual(len(kept), 2)
        self.assertIn(f'{kept[0]}-target', kept)
        landed = self.call('land-checked', 'w1', self.repo, 'main',
                           'check-pass.sh', 'file.txt')
        self.assertEqual(landed['status'], 'landed')
        self.assertEqual(self.scratch_trees('w1'), [])

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

    def test_session_with_no_branch_refused(self):
        # An attached session records no branch, so a landing for it names that.
        self.call('attach', 'attached-root', 'native-test', 'attached-session', '')
        error = self.call('land', 'attached-root', self.repo, 'main', ok=False)
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
        """Hold the first candidate check until the other landing finishes."""
        self.check_socket = socket.socket()
        self.check_socket.bind(('127.0.0.1', 0))
        self.check_socket.listen()
        self.addCleanup(self.check_socket.close)
        handshake = (
            'import socket; '
            f's=socket.create_connection({self.check_socket.getsockname()!r}); '
            's.sendall(b"ready"); assert s.recv(1)==b"1"; s.close()'
        )
        (self.repo / 'check-wait.sh').write_text(
            f'if mkdir {shlex.quote(str(self.directory / "check-held"))} 2>/dev/null; then\n'
            f'  {shlex.quote(sys.executable)} -c {shlex.quote(handshake)} || exit 1\n'
            'fi\n'
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
        connection, _ = self.check_socket.accept()
        with connection:
            with connection.makefile('rb') as incoming:
                self.assertEqual(incoming.read(5), b'ready')
            try:
                moved = self.call('land-checked', mover, self.repo, 'main',
                                  'check-plain.sh', 'file.txt')
            finally:
                connection.sendall(b'1')
        thread.join()
        self.assertNotIn('error', answer, str(answer.get('error')))
        return moved, answer['result']

    def recruit_and_write(self, player, branch, path, name, body):
        self.call('recruit', player, 'root', 'omp', 'model', 'high',
                  self.repo, branch, path, self.base)
        wt = self.repo / path
        (wt / name).write_text(body)
        subprocess.run(['git', '-C', str(wt), 'add', name], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'commit', '-q', '-m', f'{player} writes {name}'],
                       check=True, capture_output=True)
        return self.git('rev-parse', branch).strip()

    def test_target_moves_under_the_second_landing_and_retry_lands(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_write('w1', 'wa', 'wt1', 'a.txt', 'alpha\n')
        player = self.recruit_and_write('w2', 'wb', 'wt2', 'b.txt', 'beta\n')
        moved, under = self.land_under_a_move('w2', 'w1')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(under['status'], 'blocked')
        self.assertIn('target moved', under['reason'])
        self.assertIn('rerun land-checked', under['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('rev-parse', 'wb').strip(), player)
        self.assertEqual((self.repo / 'wt2' / 'b.txt').read_text(), 'beta\n')
        self.assertNotIn('b.txt', self.git('ls-tree', '--name-only', 'main').splitlines())
        self.assertEqual(len(self.scratch_trees('w2')), 2)
        retry = self.call('land-checked', 'w2', self.repo, 'main',
                          'check-plain.sh', 'file.txt')
        self.assertEqual(retry['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), retry['commit'])
        self.assertEqual(self.git('rev-parse', 'main^').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:a.txt').strip(), 'alpha')
        self.assertEqual(self.git('show', 'main:b.txt').strip(), 'beta')
        self.assertEqual(self.scratch_trees('w2'), [])

    def test_target_moves_under_the_second_landing_and_retry_conflicts(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit('w3', 'wc', 'wt3')
        player = self.recruit_and_commit('w4', 'wd', 'wt4')
        moved, under = self.land_under_a_move('w4', 'w3')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(under['status'], 'blocked')
        self.assertIn('target moved', under['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('rev-parse', 'wd').strip(), player)
        self.assertEqual((self.repo / 'wt4' / 'file.txt').read_text(), 'worker change for w4')
        self.assertEqual(len(self.scratch_trees('w4')), 2)
        retry = self.call('land-checked', 'w4', self.repo, 'main',
                          'check-plain.sh', 'file.txt')
        self.assertEqual(retry['status'], 'conflict')
        self.assertEqual(retry['files'], 'file.txt')
        self.assertTrue(pathlib.Path(retry['dir']).is_dir())
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:file.txt').strip(), 'worker change for w3')
        self.assertEqual(self.scratch_trees('w4'), [pathlib.Path(retry['dir']).name])
        unmerged = subprocess.run(
            ['git', '-C', retry['dir'], 'diff', '--name-only', '--diff-filter=U'],
            check=True, text=True, capture_output=True,
        ).stdout.splitlines()
        self.assertEqual(unmerged, ['file.txt'])
        self.assertEqual(self.git('rev-parse', 'wd').strip(), player)
        self.assertEqual((self.repo / 'wt4' / 'file.txt').read_text(), 'worker change for w4')

    def test_conflicted_player_relands_after_its_branch_is_rebased(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit('w5', 'we', 'wt5')
        player = self.recruit_and_commit('w6', 'wf', 'wt6')
        moved, under = self.land_under_a_move('w6', 'w5')
        self.assertEqual(under['status'], 'blocked')
        self.assertIn('target moved', under['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('rev-parse', 'wf').strip(), player)
        self.assertEqual(len(self.scratch_trees('w6')), 2)
        retry = self.call('land-checked', 'w6', self.repo, 'main',
                          'check-plain.sh', 'file.txt')
        self.assertEqual(retry['status'], 'conflict')
        self.assertEqual(retry['files'], 'file.txt')
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        wt = self.repo / 'wt6'
        rebase = subprocess.run(['git', '-C', str(wt), 'rebase', 'main'],
                                capture_output=True, text=True)
        self.assertNotEqual(rebase.returncode, 0, 'the rebase was to stop on the conflict')
        (wt / 'file.txt').write_text('worker change for w5 and w6\n')
        subprocess.run(['git', '-C', str(wt), 'add', 'file.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'rebase', '--continue'], check=True,
                       capture_output=True, env={**os.environ, 'GIT_EDITOR': 'true'})
        self.assertEqual(self.git('rev-parse', 'wf^').strip(), moved['commit'])
        again = self.call('land-checked', 'w6', self.repo, 'main',
                          'check-plain.sh', 'file.txt')
        self.assertEqual(again['status'], 'landed')
        self.assertEqual(self.git('show', 'main:file.txt').strip(), 'worker change for w5 and w6')
        self.assertEqual(self.scratch_trees('w6'), [])

    def fixture_status(self, tree):
        """The exit status of the selected identity check run in TREE."""
        return subprocess.run(
            [sys.executable, 'identity-selected.py'],
            cwd=tree, capture_output=True, text=True,
        ).returncode

    def holding_checks(self):
        """The identity fixture: a selected check and a check script that waits.

        The first check run of the landing under test takes an attempt-local
        marker directory outside the checked trees, reports the outcome it
        evaluated over the fixture socket, and waits for a release byte. Later
        runs of that attempt find the marker and return their own verdict at
        once. A failing run prints the four hex failure-identity fields.
        """
        marker = self.directory / 'identity-held'
        (self.repo / 'identity-selected.py').write_text(
            'import pathlib, unittest\n'
            'class Identity(unittest.TestCase):\n'
            '    def test_distinct_ids(self):\n'
            '        left = int(pathlib.Path("left.txt").read_text())\n'
            '        right = int(pathlib.Path("right.txt").read_text())\n'
            '        self.assertNotEqual(left, right)\n'
            'if __name__ == "__main__":\n'
            '    unittest.main()\n')
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        self.addCleanup(listener.close)
        (self.repo / 'check-held.sh').write_text(
            '#!/bin/sh\n'
            f'exec {shlex.quote(sys.executable)} {shlex.quote(str(self.repo / "check-held.py"))} "$1"\n')
        (self.repo / 'check-held.py').write_text(
            'import json, pathlib, socket, subprocess, sys\n'
            f'marker = pathlib.Path({str(marker)!r})\n'
            'selected = sys.argv[1]\n'
            'run = subprocess.run([sys.executable, selected], capture_output=True, text=True)\n'
            'report = {"selected": selected, "passed": run.returncode == 0,\n'
            '          "left": int(pathlib.Path("left.txt").read_text()),\n'
            '          "right": int(pathlib.Path("right.txt").read_text())}\n'
            'try:\n'
            '    marker.mkdir()\n'
            '    first = True\n'
            'except FileExistsError:\n'
            '    first = False\n'
            'if first:\n'
            f'    with socket.create_connection({listener.getsockname()!r}) as peer:\n'
            '        peer.sendall((json.dumps(report) + "\\n").encode())\n'
            '        released = peer.recv(1)\n'
            '    if released != b"1":\n'
            '        raise SystemExit("the check was not released")\n'
            'if run.returncode:\n'
            '    fields = [selected, "Identity.test_distinct_ids", "assertion", "-"]\n'
            '    print(" ".join(field.encode().hex() for field in fields))\n'
            'raise SystemExit(run.returncode)\n')
        (self.repo / 'left.txt').write_text('4\n')
        (self.repo / 'right.txt').write_text('5\n')
        self.git('add', 'identity-selected.py', 'check-held.sh', 'check-held.py',
                 'left.txt', 'right.txt')
        self.git('commit', '-q', '-m', 'identity fixtures')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', '--detach')
        return listener

    def accept_check(self, listener):
        """Accept the held check; return its connection and its event."""
        connection = listener.accept()[0]
        self.addCleanup(connection.close)
        data = b''
        while not data.endswith(b'\n'):
            part = connection.recv(65536)
            if not part:
                self.fail('the check closed its connection before its event')
            data += part
        return connection, json.loads(data)

    def start_landing(self, player, check, selected):
        """Start a checked landing in the background; return its process."""
        return subprocess.Popen(
            [str(EXE), str(self.db), 'land-checked', player, str(self.repo),
             'main', check, selected],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def stop_landing(self, process):
        """Stop a landing this test started and read whatever it produced."""
        if process.poll() is None:
            process.kill()
        process.communicate()

    def scratch_paths(self, player):
        """The scratch trees an attempt by WORKER left under the repository."""
        return sorted((self.repo / '.scratch').glob(f'bend2-land-{player}-*'))

    def test_target_moving_under_a_held_candidate_blocks_and_keeps_it(self):
        # Two worker changes that pass alone but fail together. The candidate
        # of one is checked, held, and the other lands meanwhile.
        listener = self.holding_checks()
        a_commit = self.recruit_and_write('wa', 'wa-branch', 'wta', 'left.txt', '6\n')
        b_commit = self.recruit_and_write('wb', 'wb-branch', 'wtb', 'right.txt', '6\n')
        self.assertEqual(self.fixture_status(self.repo / 'wta'), 0)
        self.assertEqual(self.fixture_status(self.repo / 'wtb'), 0)
        under = self.start_landing('wb', 'check-held.sh', 'identity-selected.py')
        self.addCleanup(self.stop_landing, under)
        held, event = self.accept_check(listener)
        self.assertTrue(event['passed'], event)
        self.assertEqual((event['left'], event['right']), (4, 6))
        moved = self.call('land-checked', 'wa', self.repo, 'main',
                          str(ROOT / 'bend2/scripts/check-unittest.sh'), 'identity-selected.py')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        held.sendall(b'1')
        held.close()
        out, err = under.communicate()
        self.assertEqual(under.returncode, 0, err)
        result = json.loads(out)
        # The landing holds the candidate it checked and the basis it checked
        # against. The target moved while that check ran, so the landing
        # blocks and names the retry it wants.
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('rerun land-checked', result['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:left.txt').strip(), '6')
        self.assertEqual(self.git('show', 'main:right.txt').strip(), '5')
        self.assertEqual(self.git('rev-parse', 'wa-branch').strip(), a_commit)
        self.assertEqual(self.git('rev-parse', 'wb-branch').strip(), b_commit)
        self.assertEqual((self.repo / 'wtb' / 'right.txt').read_text(), '6\n')
        kept = self.scratch_paths('wb')
        self.assertEqual(len(kept), 2)
        candidates = [tree for tree in kept if not tree.name.endswith('-target')]
        targets = [tree for tree in kept if tree.name.endswith('-target')]
        self.assertEqual(len(candidates), 1)
        self.assertEqual(len(targets), 1)
        self.assertEqual((candidates[0] / 'left.txt').read_text(), '4\n')
        self.assertEqual((candidates[0] / 'right.txt').read_text(), '6\n')
        # The explicit retry prepares the combination on the moved target,
        # checks it, and blocks on a failure the target does not show.
        again = self.call('land-checked', 'wb', self.repo, 'main',
                          str(ROOT / 'bend2/scripts/check-unittest.sh'), 'identity-selected.py')
        self.assertEqual(again['status'], 'blocked')
        self.assertIn('new failures', again['reason'])
        self.assertIn('identity-selected.py'.encode().hex(), again['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('rev-parse', 'wb-branch').strip(), b_commit)
        retried = self.scratch_paths('wb')
        self.assertEqual(len(retried), 2)
        failed = [tree for tree in retried if self.fixture_status(tree)]
        self.assertEqual(len(failed), 1)
        self.assertEqual((failed[0] / 'left.txt').read_text(), '6\n')
        self.assertEqual((failed[0] / 'right.txt').read_text(), '6\n')
        checked_target = [tree for tree in retried if tree.name.endswith('-target')]
        self.assertEqual(len(checked_target), 1)
        self.assertEqual(self.fixture_status(checked_target[0]), 0)
        self.assertEqual((checked_target[0] / 'left.txt').read_text(), '6\n')
        self.assertEqual((checked_target[0] / 'right.txt').read_text(), '5\n')
        final = self.directory / 'final-target'
        self.git('worktree', 'add', '--detach', str(final), 'main')
        self.assertEqual(self.fixture_status(final), 0)

if __name__ == '__main__':
    unittest.main()
