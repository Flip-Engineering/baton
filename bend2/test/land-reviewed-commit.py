"""Reviewed-source landing: fixture cases driven by the compiled test entry.

The coordinator binary is used only for ordinary endpoint-free setup (attach and
recruit), the way land.py does. Every landing call goes through the compiled
bend2/test/land-reviewed-commit.bend, which calls the real Land entries, so each
assertion is about a whole operation: the process status, the outcome object the
Land entry printed, and the Git state afterwards.
"""
import json
import os
import pathlib
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
ENTRY = ROOT / 'bend2/test/land-reviewed-commit.bend'
BUILD = ROOT / 'bend2/scripts/build-native.sh'
MISSING_COMMIT = '0' * 40
MALFORMED = 'not a selector!!'


def compiler():
    """The Bend the build script requires, from BEND or the two standard places."""
    for candidate in (os.environ.get('BEND'), ROOT / '.bend/bin/bend',
                      ROOT / 'node_modules/.bend/bin/bend'):
        if candidate and pathlib.Path(candidate).exists():
            return pathlib.Path(candidate)
    return None


def build_entry():
    """Compile the fixture entry once per run; None when no toolchain is present."""
    bend = compiler()
    if bend is None:
        return None
    target = pathlib.Path(tempfile.mkdtemp(prefix='land-reviewed-commit-')) / 'entry'
    run = subprocess.run(
        ['sh', str(BUILD), str(ENTRY), str(target)],
        env=dict(os.environ, BEND=str(bend)), text=True, capture_output=True,
    )
    if run.returncode != 0:
        raise AssertionError('the fixture entry did not build: ' + (run.stderr or run.stdout))
    return target


class ReviewedSourceLanding(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not EXE.exists():
            raise unittest.SkipTest(f'Coordinator not built at {EXE}')
        cls.entry = build_entry()
        if cls.entry is None:
            raise unittest.SkipTest('Bend 2.0.25 is unavailable for the fixture entry')

    def setUp(self):
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

    # --- setup and process plumbing -----------------------------------------

    def git(self, *args):
        return subprocess.run(
            ['git', '-C', str(self.repo), *args],
            check=True, text=True, capture_output=True,
        ).stdout

    def git_in(self, path, *args):
        return subprocess.run(
            ['git', '-C', str(path), *args],
            check=True, text=True, capture_output=True,
        ).stdout

    def call(self, *args):
        """An ordinary coordinator command, used only to build fixture state."""
        run = subprocess.run(
            [str(EXE), str(self.db), *map(str, args)], text=True, capture_output=True,
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout)

    def run_entry(self, *args):
        return subprocess.run(
            [str(self.entry), *map(str, args)], text=True, capture_output=True,
        )

    def landing(self, mode, *args):
        """A landing entry that is expected to reach an outcome."""
        run = self.run_entry(mode, *args)
        self.assertEqual(run.returncode, 0, f'{mode} failed: {run.stderr}')
        return json.loads(run.stdout)

    def refusal(self, mode, *args):
        """A landing entry that is expected to refuse; returns what it printed."""
        run = self.run_entry(mode, *args)
        self.assertEqual(run.returncode, 2,
                         f'{mode} did not refuse with status 2: {run.stdout} {run.stderr}')
        return run.stdout + run.stderr

    def scratch_trees(self, player):
        """The scratch trees an attempt by PLAYER left under the repository."""
        return sorted(p.name for p in (self.repo / '.scratch').glob(f'bend2-land-{player}-*'))

    def recruit_and_commit(self, player='w1', branch='w1-branch', path='wt', name='file.txt'):
        self.call('recruit', player, 'root', 'omp', 'model', 'high',
                  self.repo, branch, path, self.base)
        worktree = self.repo / path
        (worktree / name).write_text(f'worker change for {player}\n')
        self.git_in(worktree, 'add', name)
        self.git_in(worktree, 'commit', '-q', '-m', 'worker commit')
        return self.git('rev-parse', branch).strip()

    def commit_more(self, path, name, body):
        """One further commit on the recorded branch, returning the new tip."""
        worktree = self.repo / path
        (worktree / name).write_text(body)
        self.git_in(worktree, 'add', name)
        self.git_in(worktree, 'commit', '-q', '-m', f'later commit adds {name}')
        return self.git_in(worktree, 'rev-parse', 'HEAD').strip()

    def commit_on_branch(self, path, name, body):
        return self.commit_more(path, name, body)

    def check_fixtures(self, scripts):
        """Commit the check scripts onto main, the way land.py does."""
        for name, body in scripts.items():
            (self.repo / name).write_text(body)
            self.git('add', name)
        self.git('commit', '-q', '-m', 'check fixtures')

    def status_porcelain(self, path):
        return subprocess.run(
            ['git', '-C', str(path), 'status', '--porcelain'],
            text=True, capture_output=True,
        ).stdout

    # --- cases ---------------------------------------------------------------

    def test_reviewed_source_lands_the_named_ancestor_and_excludes_the_later_commit(self):
        """The reviewed commit older than the tip is what lands, not the tip."""
        ancestor = self.recruit_and_commit()
        self.assertEqual(self.git('show', 'w1-branch:file.txt').strip(),
                         'worker change for w1')
        later = self.commit_more('wt', 'later.txt', 'later content\n')
        self.assertNotEqual(later, ancestor)

        result = self.landing('land-player-at', self.db, 'w1', self.repo, 'main', ancestor)

        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], ancestor)
        self.assertEqual(self.git('rev-parse', 'main').strip(), ancestor)
        self.assertEqual(self.git('show', 'main:file.txt').strip(), 'worker change for w1')
        excluded = subprocess.run(
            ['git', '-C', str(self.repo), 'show', 'main:later.txt'],
            text=True, capture_output=True,
        )
        self.assertNotEqual(excluded.returncode, 0,
                            'the later commit reached the target')
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), later,
                         'the recorded branch must keep its later commit')

    def test_default_landing_still_lands_the_recorded_branch_tip(self):
        """The unchanged default source stays the tip of the recorded branch."""
        self.recruit_and_commit()
        tip = self.commit_more('wt', 'later.txt', 'later content\n')

        result = self.landing('land-player', self.db, 'w1', self.repo, 'main')

        self.assertEqual(result['status'], 'landed')
        self.assertEqual(result['commit'], tip)
        self.assertEqual(self.git('rev-parse', 'main').strip(), tip)
        self.assertEqual(self.git('show', 'main:later.txt').strip(), 'later content')

    def test_reviewed_source_refuses_before_any_scratch_or_target_change(self):
        """A selector that resolves to no commit refuses before every effect."""
        commit = self.recruit_and_commit()
        blob = self.git('rev-parse', 'w1-branch:file.txt').strip()
        selectors = [MISSING_COMMIT, blob, MALFORMED]
        for mode, tail in (('land-player-at', []),
                           ('land-checked-player-at', ['true', 'file.txt'])):
            for selector in selectors:
                with self.subTest(mode=mode, selector=selector[:12]):
                    printed = self.refusal(mode, self.db, 'w1', self.repo, 'main',
                                           *tail, selector)
                    self.assertIn('not a commit', printed)
                    self.assertEqual(self.git('rev-parse', 'main').strip(), self.base,
                                     'the target moved for a refused selector')
                    self.assertEqual(self.scratch_trees('w1'), [],
                                     'a refused selector prepared a scratch tree')
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), commit)

    def test_reviewed_source_landing_preserves_a_dirty_workspace_and_branches(self):
        """The player's own workspace and branch survive the landing unchanged."""
        ancestor = self.recruit_and_commit()
        worktree = self.repo / 'wt'
        (worktree / 'file.txt').write_text('uncommitted local edit\n')
        (worktree / 'untracked.txt').write_text('untracked\n')
        before_status = self.status_porcelain(worktree)
        before_branch = self.git('rev-parse', 'w1-branch').strip()
        self.assertNotEqual(before_status.strip(), '')

        result = self.landing('land-player-at', self.db, 'w1', self.repo, 'main', ancestor)

        self.assertEqual(result['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), ancestor)
        self.assertEqual((worktree / 'file.txt').read_text(), 'uncommitted local edit\n')
        self.assertEqual((worktree / 'untracked.txt').read_text(), 'untracked\n')
        self.assertEqual(self.status_porcelain(worktree), before_status)
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), before_branch)

    def test_reviewed_source_refuses_a_workspace_in_another_repository(self):
        """The association is one of the caller's steps: a foreign workspace refuses."""
        commit = self.recruit_and_commit()
        other = self.directory / 'other'
        other.mkdir()
        identity = dict(
            os.environ,
            GIT_AUTHOR_NAME='Baton test', GIT_AUTHOR_EMAIL='baton@example.invalid',
            GIT_COMMITTER_NAME='Baton test', GIT_COMMITTER_EMAIL='baton@example.invalid',
        )
        subprocess.run(['git', '-C', str(other), 'init', '-q', '-b', 'main'],
                       check=True, capture_output=True)
        subprocess.run(['git', '-C', str(other), 'commit', '-q', '--allow-empty', '-m', 'foreign'],
                       check=True, capture_output=True, env=identity)
        def foreign(*args):
            return subprocess.run(['git', '-C', str(other), *args],
                                  check=True, text=True, capture_output=True).stdout

        other_tip = foreign('rev-parse', 'HEAD').strip()
        other_status = foreign('status', '--porcelain')
        for mode, tail in (('land-player-at', []),
                           ('land-checked-player-at', ['true', 'file.txt'])):
            with self.subTest(mode=mode):
                printed = self.refusal(mode, self.db, 'w1', other, 'main', *tail, commit)
                self.assertIn('different repository', printed)
                # the recorded source repository, its branch and its worktrees are untouched
                self.assertEqual(self.git('rev-parse', 'main').strip(), self.base,
                                 'a foreign workspace moved the recorded repository')
                self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), commit,
                                 'a foreign workspace moved the recorded branch')
                self.assertEqual(self.scratch_trees('w1'), [],
                                 'a foreign workspace prepared a scratch tree')
                # and the repository the caller named as the landing target is untouched
                self.assertEqual(foreign('rev-parse', 'refs/heads/main').strip(), other_tip,
                                 'the named target branch moved')
                self.assertEqual(foreign('rev-parse', 'HEAD').strip(), other_tip,
                                 'the named target HEAD moved')
                self.assertEqual(foreign('status', '--porcelain'), other_status,
                                 'the named target worktree changed')
                self.assertEqual(self.foreign_scratch(other, 'w1'), [],
                                 'the named target holds landing scratch effects')
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), commit)

    @staticmethod
    def foreign_scratch(repo, player):
        """Any landing scratch tree the named repository left for PLAYER."""
        scratch = repo / '.scratch'
        return sorted(p.name for p in scratch.glob(f'bend2-land-{player}-*')) if scratch.exists() else []

    def test_reviewed_source_refuses_a_divergent_commit_in_the_same_repository(self):
        """A commit that exists here but is not an ancestor of the recorded branch refuses."""
        commit = self.recruit_and_commit()
        self.check_fixtures({'check-pass.sh': 'exit 0\n'})
        divergent = self.git('rev-parse', 'main').strip()
        self.assertNotEqual(divergent, commit, 'the fixture did not create a divergent commit')
        target_before = self.git('rev-parse', 'main').strip()
        for mode, tail in (('land-player-at', []),
                           ('land-checked-player-at', ['check-pass.sh', 'file.txt'])):
            with self.subTest(mode=mode):
                printed = self.refusal(mode, self.db, 'w1', self.repo, 'main', *tail, divergent)
                self.assertIn('is not an ancestor of the recorded branch', printed)
                self.assertEqual(self.git('rev-parse', 'main').strip(), target_before,
                                 'the target moved for a divergent selection')
                self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), commit,
                                 'the recorded branch moved for a divergent selection')
                self.assertEqual(self.scratch_trees('w1'), [],
                                 'a divergent selection prepared a scratch tree')
        self.assertEqual((self.repo / 'wt' / 'file.txt').read_text(), 'worker change for w1\n',
                         'the recorded workspace changed')

    def test_checked_reviewed_landing_advances_when_the_checks_pass(self):
        self.check_fixtures({'check-pass.sh': 'exit 0\n'})
        self.git('checkout', '-q', '--detach')
        commit = self.recruit_and_commit()

        result = self.landing('land-checked-player-at', self.db, 'w1', self.repo, 'main',
                              'check-pass.sh', 'file.txt', commit)

        self.assertEqual(result['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), result['commit'])
        self.assertEqual(self.git('show', 'main:file.txt').strip(), 'worker change for w1')
        self.assertEqual(self.scratch_trees('w1'), [])

    def test_checked_reviewed_landing_blocks_a_new_failure_and_keeps_the_target(self):
        """The candidate gate blocks a failure the target does not have."""
        self.check_fixtures({
            'check-blocked.sh': 'test -f "$1" && { echo 6161 6161 6161 2d; exit 1; }\nexit 0\n',
        })
        self.git('checkout', '-q', '--detach')
        tip = self.git('rev-parse', 'main').strip()
        commit = self.recruit_and_commit()

        result = self.landing('land-checked-player-at', self.db, 'w1', self.repo, 'main',
                              'check-blocked.sh', 'file.txt', commit)

        self.assertEqual(result['status'], 'blocked')
        self.assertIn('new failures', result['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), tip,
                         'a blocked candidate advanced the target')
        self.assertEqual(self.git('rev-parse', 'w1-branch').strip(), commit,
                         'a blocked candidate changed the recorded branch')
        self.assertEqual(len(self.scratch_trees('w1')), 2,
                         'a refused attempt keeps the trees it prepared')

    # --- the moved-target barrier -------------------------------------------

    def waiting_checks(self):
        """Hold the first candidate check until the other landing finishes."""
        self.check_socket = socket.socket()
        self.check_socket.bind(('127.0.0.1', 0))
        self.check_socket.listen()
        self.check_socket.settimeout(30)
        self.addCleanup(self.check_socket.close)
        handshake = (
            'import socket; '
            f's=socket.create_connection({self.check_socket.getsockname()!r}, timeout=30); '
            's.sendall(b"ready"); assert s.recv(1)==b"1"; s.close()'
        )
        self.check_fixtures({
            'check-wait.sh': (
                f'if mkdir {shlex.quote(str(self.directory / "check-held"))} 2>/dev/null; then\n'
                f'  {shlex.quote(sys.executable)} -c {shlex.quote(handshake)} || exit 1\n'
                'fi\n'
                'git rev-parse --verify HEAD >/dev/null || '
                '{ echo 77616974 6e6f68656164 6572726f 2d; exit 1; }\n'
                'exit 0\n'),
            'check-plain.sh': (
                'git rev-parse --verify HEAD >/dev/null || '
                '{ echo 706c61696e 6e6f68656164 6572726f 2d; exit 1; }\n'
                'exit 0\n'),
        })

    def land_under_a_move(self, under, under_commit, mover, mover_commit):
        """Start UNDER's landing, move the target with MOVER's, answer UNDER's."""
        answer = {}

        def land_under():
            try:
                answer['result'] = self.landing(
                    'land-checked-player-at', self.db, under, self.repo, 'main',
                    'check-wait.sh', 'file.txt', under_commit)
            except BaseException as error:  # noqa: BLE001 - reported below
                answer['error'] = error

        thread = threading.Thread(target=land_under)
        thread.start()
        connection, _ = self.check_socket.accept()
        with connection:
            connection.settimeout(30)
            with connection.makefile('rb') as incoming:
                self.assertEqual(incoming.read(5), b'ready')
            try:
                moved = self.landing(
                    'land-checked-player-at', self.db, mover, self.repo, 'main',
                    'check-plain.sh', 'file.txt', mover_commit)
            finally:
                connection.sendall(b'1')
        thread.join(120)
        self.assertFalse(thread.is_alive(), f'the landing of {under} did not finish')
        self.assertNotIn('error', answer, str(answer.get('error')))
        return moved, answer['result']

    def test_target_moves_under_the_reviewed_checked_landing_and_the_retry_lands(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        mover_commit = self.recruit_and_commit('w1', 'wa', 'wt1', 'a.txt')
        under_commit = self.recruit_and_commit('w2', 'wb', 'wt2', 'b.txt')

        moved, under = self.land_under_a_move('w2', under_commit, 'w1', mover_commit)

        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(under['status'], 'blocked')
        self.assertIn('target moved', under['reason'])
        self.assertIn('rerun land-checked', under['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('rev-parse', 'wb').strip(), under_commit)
        self.assertNotIn('b.txt', self.git('ls-tree', '--name-only', 'main').splitlines())
        self.assertEqual(len(self.scratch_trees('w2')), 2)

        retry = self.landing('land-checked-player-at', self.db, 'w2', self.repo, 'main',
                             'check-plain.sh', 'file.txt', under_commit)

        self.assertEqual(retry['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), retry['commit'])
        self.assertEqual(self.git('rev-parse', 'main^').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:a.txt').strip(), 'worker change for w1')
        self.assertEqual(self.git('show', 'main:b.txt').strip(), 'worker change for w2')
        self.assertEqual(self.scratch_trees('w2'), [])


if __name__ == '__main__':
    unittest.main()
