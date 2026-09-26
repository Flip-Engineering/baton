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

    def test_unregistered_worker_refused(self):
        error = self.call('land', 'nobody', self.repo, 'main', ok=False)
        self.assertIn('not registered', error)

    def test_worker_with_no_branch_refused(self):
        self.call('worker', 'w3', 'root', 'omp', 'model', 'high', '/tmp', '', '')
        error = self.call('land', 'w3', self.repo, 'main', ok=False)
        self.assertIn('no recorded branch', error)


class LandChecked(unittest.TestCase):
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
        (self.repo / 'src.txt').write_text('initial')
        self.git('add', 'src.txt')
        self.git('commit', '-q', '-m', 'initial')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '-q', '--detach', 'HEAD')
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
        return p

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

    def write_check_script(self, body='exit 0'):
        script = self.directory / 'check.sh'
        script.write_text(body)
        return str(script)

    def write_files_list(self, files):
        path = self.directory / 'files.txt'
        path.write_text('\n'.join(files))
        return str(path)

    def test_checked_landing_passes(self):
        self.recruit_and_commit()
        script = self.write_check_script('exit 0')
        files_path = self.write_files_list(['src.txt'])
        scratch = str(self.directory / 'scratch')
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           script, scratch, files_path)
        self.assertEqual(result['status'], 'landed')
        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, result['commit'])

    def test_checked_landing_blocks_on_new_failure(self):
        self.recruit_and_commit()
        hex_file = 'file.txt'.encode().hex()
        hex_test = 'test1'.encode().hex()
        hex_type = 'assertion'.encode().hex()
        hex_code = '2d'
        fail_line = f'{hex_file} {hex_test} {hex_type} {hex_code}'
        script = self.write_check_script(
            '#!/bin/sh\n'
            'if grep -q "worker change" "$1" 2>/dev/null; then\n'
            f'  echo "{fail_line}"\n'
            '  exit 1\n'
            'fi\n'
            'exit 0\n'
        )
        files_path = self.write_files_list(['file.txt'])
        scratch = str(self.directory / 'scratch')
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           script, scratch, files_path)
        self.assertEqual(result['status'], 'blocked')

    def test_checked_already_merged(self):
        commit = self.recruit_and_commit()
        script = self.write_check_script('exit 0')
        files_path = self.write_files_list(['src.txt'])
        scratch = str(self.directory / 'scratch')
        self.call('land-checked', 'w1', self.repo, 'main',
                  script, scratch, files_path)
        scratch2 = str(self.directory / 'scratch2')
        result = self.call('land-checked', 'w1', self.repo, 'main',
                           script, scratch2, files_path)
        self.assertEqual(result['status'], 'already')


if __name__ == '__main__':
    unittest.main()
