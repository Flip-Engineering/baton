"""Exercise the Git acceptance driver with controlled workers and real coordinator/Git effects."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
SPEC = importlib.util.spec_from_file_location('accept_git', ROOT / 'bend2/scripts/accept-git.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class GitAcceptance(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temporary = tempfile.TemporaryDirectory(prefix='accept-git-', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temporary.cleanup)
        self.out = Path(self.temporary.name)
        self.resumed = []
        env_patch = mock.patch.dict(os.environ, {
            'GIT_AUTHOR_NAME': 'Git acceptance fixture',
            'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
            'GIT_COMMITTER_NAME': 'Git acceptance fixture',
            'GIT_COMMITTER_EMAIL': 'fixture@example.invalid',
            'GIT_EDITOR': 'true',
        })
        env_patch.start()
        self.addCleanup(env_patch.stop)
        player_patch = mock.patch.object(DRIVER, 'turn_player', self.controlled_player)
        player_patch.start()
        self.addCleanup(player_patch.stop)
        self.config = {'omp': {'executable': 'controlled-worker', 'model': 'fixture', 'effort': 'low'}}

    def controlled_player(self, binary, db, repo, run_dir, route, player, branch, base,
                          path, line, turn, guided=False, session=''):
        DRIVER.coord(binary, db, 'recruit', player, 'root', 'omp', route['model'],
                     route['effort'], repo, branch, f'wt-{player}', base)
        worktree = repo / f'wt-{player}'
        if guided:
            self.assertEqual(session, 'controlled-' + player)
            inbox = DRIVER.coord_json(binary, db, 'inbox', player)
            self.assertEqual([message['id'] for message in inbox], ['g1'])
            self.assertIn('three and four', inbox[0]['body'])
            result = subprocess.run(['git', '-C', str(worktree), 'rebase', 'main'],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.resumed.append({'player': player, 'native': session, 'turn': turn})
        else:
            DRIVER.coord(binary, db, 'bind', player, 'controlled-' + player, 'omp', 'fixture', 'low')
        (worktree / path).write_text(line + '\n')
        DRIVER.git(worktree, 'add', path)
        if guided:
            DRIVER.git(worktree, 'rebase', '--continue')
            DRIVER.coord(binary, db, 'ack', 'g1', player, 'controlled-worker-reviewed')
        else:
            DRIVER.git(worktree, 'commit', '-q', '-m', f'{player} writes {line}')
        DRIVER.coord(binary, db, 'report', turn, player, f'controlled {player} committed {line}')
        return worktree

    def test_target_move_preserves_first_attempt_and_explicit_retry_lands(self):
        with contextlib.redirect_stdout(io.StringIO()):
            DRIVER.scenario_target_move(self.config, self.out, EXE)
        scenario = self.out / 'target-move'
        first = json.loads((scenario / 'land-w2.out').read_text())
        self.assertEqual(first['status'], 'blocked')
        self.assertIn('rerun land-checked', first['reason'])
        repo = scenario / 'repo'
        self.assertEqual(DRIVER.git(repo, 'show', 'main:data/a.txt'), 'alpha')
        self.assertEqual(DRIVER.git(repo, 'show', 'main:data/b.txt'), 'beta')
        self.assertEqual(DRIVER.git(repo, 'show', 'wb:data/b.txt'), 'beta')
        self.assertEqual(self.resumed, [])

    def test_conflict_requires_fresh_attempt_before_guided_native_resume(self):
        with contextlib.redirect_stdout(io.StringIO()):
            DRIVER.scenario_conflict_recovery(self.config, self.out, EXE)
        scenario = self.out / 'conflict-recovery'
        first = json.loads((scenario / 'land-w4.out').read_text())
        self.assertEqual(first['status'], 'blocked')
        self.assertEqual(self.resumed, [{'player': 'w4', 'native': 'controlled-w4', 'turn': 't3'}])
        repo = scenario / 'repo'
        self.assertEqual(DRIVER.git(repo, 'show', 'main:data/shared.txt'), 'three and four')
        delivery = DRIVER.coord_json(EXE, scenario / 'state.db', 'delivery', 'g1')
        self.assertEqual(delivery['receipt'], 'controlled-worker-reviewed')
        self.assertEqual(DRIVER.coord_json(EXE, scenario / 'state.db', 'player', 'w4')['native'],
                         'controlled-w4')


if __name__ == '__main__':
    unittest.main()
