"""Landing module: advance a target branch to include a worker's committed tip."""
import json
import os
import pathlib
import socket
import subprocess
import sys
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
            text=True, capture_output=True, timeout=30,
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

    def scratch_trees(self, worker):
        """The scratch trees an attempt by WORKER left under the repository."""
        return sorted(p.name for p in (self.repo / '.scratch').glob(f'bend2-land-{worker}-*'))

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
        self.assertEqual(len(self.scratch_trees('w4')), 2)

    def test_conflicted_worker_relands_after_its_branch_is_rebased(self):
        self.waiting_checks()
        self.git('checkout', '-q', '--detach')
        self.recruit_and_commit('w5', 'we', 'wt5')
        self.recruit_and_commit('w6', 'wf', 'wt6')
        moved, under = self.land_under_a_move('w6', 'w5')
        self.assertEqual(under['status'], 'conflict')
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

    def budget_status(self, tree):
        """The exit status of the selected budget check run in TREE."""
        return subprocess.run(
            [sys.executable, 'budget-selected.py'],
            cwd=tree, capture_output=True, text=True,
        ).returncode

    def holding_checks(self):
        """The budget fixture: a selected check and a check script that waits.

        The first check run of the landing under test takes an attempt-local
        marker directory outside the checked trees, reports the outcome it
        evaluated over the fixture socket, and waits for a release byte. Later
        runs of that attempt find the marker and return their own verdict at
        once. A failing run prints the four hex failure-identity fields.
        """
        marker = self.directory / 'budget-held'
        (self.repo / 'budget-selected.py').write_text(
            'import pathlib, unittest\n'
            'class Budget(unittest.TestCase):\n'
            '    def test_capacity(self):\n'
            '        left = int(pathlib.Path("left.txt").read_text())\n'
            '        right = int(pathlib.Path("right.txt").read_text())\n'
            '        self.assertLessEqual(left + right, 10)\n'
            'if __name__ == "__main__":\n'
            '    unittest.main()\n')
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        listener.settimeout(30)
        self.addCleanup(listener.close)
        (self.repo / 'check-held.sh').write_text(
            '#!/bin/sh\n'
            f'exec python3 "{self.repo}/check-held.py" "$1"\n')
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
            f'    with socket.create_connection({listener.getsockname()!r}, timeout=30) as peer:\n'
            '        peer.sendall((json.dumps(report) + "\\n").encode())\n'
            '        released = peer.recv(1)\n'
            '    if released != b"1":\n'
            '        raise SystemExit("the check was not released")\n'
            'if run.returncode:\n'
            '    fields = [selected, "Budget.test_capacity", "assertion", "-"]\n'
            '    print(" ".join(field.encode().hex() for field in fields))\n'
            'raise SystemExit(run.returncode)\n')
        (self.repo / 'left.txt').write_text('4\n')
        (self.repo / 'right.txt').write_text('4\n')
        self.git('add', 'budget-selected.py', 'check-held.sh', 'check-held.py',
                 'left.txt', 'right.txt')
        self.git('commit', '-q', '-m', 'budget fixtures')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', '--detach')
        return listener

    def accept_check(self, listener):
        """Accept the held check; return its connection and its event."""
        connection = listener.accept()[0]
        connection.settimeout(30)
        self.addCleanup(connection.close)
        data = b''
        while not data.endswith(b'\n'):
            part = connection.recv(65536)
            if not part:
                self.fail('the check closed its connection before its event')
            data += part
        return connection, json.loads(data)

    def start_landing(self, worker, check, selected):
        """Start a checked landing in the background; return its process."""
        return subprocess.Popen(
            [str(EXE), str(self.db), 'land-checked', worker, str(self.repo),
             'main', check, selected],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def stop_landing(self, process):
        """Stop a landing this test started and read whatever it produced."""
        if process.poll() is None:
            process.kill()
        try:
            process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()

    def scratch_paths(self, worker):
        """The scratch trees an attempt by WORKER left under the repository."""
        return sorted((self.repo / '.scratch').glob(f'bend2-land-{worker}-*'))

    def test_target_moving_under_a_held_candidate_blocks_and_keeps_it(self):
        # Two worker changes that pass alone but fail together. The candidate
        # of one is checked, held, and the other lands meanwhile.
        listener = self.holding_checks()
        a_commit = self.recruit_and_write('wa', 'wa-branch', 'wta', 'left.txt', '6\n')
        b_commit = self.recruit_and_write('wb', 'wb-branch', 'wtb', 'right.txt', '6\n')
        self.assertEqual(self.budget_status(self.repo / 'wta'), 0)
        self.assertEqual(self.budget_status(self.repo / 'wtb'), 0)
        under = self.start_landing('wb', 'check-held.sh', 'budget-selected.py')
        self.addCleanup(self.stop_landing, under)
        held, event = self.accept_check(listener)
        self.assertTrue(event['passed'], event)
        self.assertEqual((event['left'], event['right']), (4, 6))
        moved = self.call('land-checked', 'wa', self.repo, 'main',
                          str(ROOT / 'bend2/scripts/check-unittest.sh'), 'budget-selected.py')
        self.assertEqual(moved['status'], 'landed')
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        held.sendall(b'1')
        held.close()
        out, err = under.communicate(timeout=120)
        self.assertEqual(under.returncode, 0, err)
        result = json.loads(out)
        # The landing holds the candidate it checked and the basis it checked
        # against. The target moved while that check ran, so the landing
        # blocks and names the retry it wants.
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('rerun land-checked', result['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('show', 'main:left.txt').strip(), '6')
        self.assertEqual(self.git('show', 'main:right.txt').strip(), '4')
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
                          str(ROOT / 'bend2/scripts/check-unittest.sh'), 'budget-selected.py')
        self.assertEqual(again['status'], 'blocked')
        self.assertIn('new failures', again['reason'])
        self.assertIn('budget-selected.py'.encode().hex(), again['reason'])
        self.assertEqual(self.git('rev-parse', 'main').strip(), moved['commit'])
        self.assertEqual(self.git('rev-parse', 'wb-branch').strip(), b_commit)
        retried = self.scratch_paths('wb')
        self.assertEqual(len(retried), 2)
        failed = [tree for tree in retried if self.budget_status(tree)]
        self.assertEqual(len(failed), 1)
        self.assertEqual((failed[0] / 'left.txt').read_text(), '6\n')
        self.assertEqual((failed[0] / 'right.txt').read_text(), '6\n')
        checked_target = [tree for tree in retried if tree.name.endswith('-target')]
        self.assertEqual(len(checked_target), 1)
        self.assertEqual(self.budget_status(checked_target[0]), 0)
        self.assertEqual((checked_target[0] / 'left.txt').read_text(), '6\n')
        self.assertEqual((checked_target[0] / 'right.txt').read_text(), '4\n')
        final = self.directory / 'final-target'
        self.git('worktree', 'add', '--detach', str(final), 'main')
        self.assertEqual(self.budget_status(final), 0)

if __name__ == '__main__':
    unittest.main()
