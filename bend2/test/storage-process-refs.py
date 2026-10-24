"""Current-user process evidence for released worktrees and live consumers."""
import contextlib
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

BINARY = pathlib.Path(os.environ['BATON2_STORAGE_TEST']).resolve()
ROOT = pathlib.Path(__file__).resolve().parents[2]


@contextlib.contextmanager
def peer(script, cwd, *args, registered=True):
    child = subprocess.Popen([sys.executable, '-u', '-c', script, *map(str, args)],
                             cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    entry = pathlib.Path(os.environ['BATON_STORAGE_TEST_PROC']) / str(child.pid)
    try:
        ready = child.stdout.readline().strip()
        if ready != 'ready':
            raise AssertionError(f'peer failed to start: {ready}: {child.stderr.read()}')
        if registered:
            entry.symlink_to(f'/proc/{child.pid}')
        yield child
    finally:
        child.stdin.close()
        child.wait()
        if registered and entry.is_symlink():
            entry.unlink()
        error = child.stderr.read()
        child.stdout.close()
        child.stderr.close()
        if child.returncode:
            raise AssertionError(f'peer exited {child.returncode}: {error}')


class StorageProcessRefs(unittest.TestCase):
    def setUp(self):
        (ROOT / '.scratch').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='storage-refs-', dir=ROOT / '.scratch')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.candidate = self.root / 'released'
        self.candidate.mkdir()
        proc = self.root / 'proc'
        proc.mkdir()
        self.previous_proc = os.environ.get('BATON_STORAGE_TEST_PROC')
        os.environ['BATON_STORAGE_TEST_PROC'] = str(proc)
        self.addCleanup(self.restore_proc)

    def restore_proc(self):
        if self.previous_proc is None:
            os.environ.pop('BATON_STORAGE_TEST_PROC', None)
        else:
            os.environ['BATON_STORAGE_TEST_PROC'] = self.previous_proc

    def scan(self, path=None):
        run = subprocess.run([str(BINARY), 'runtime-refs', str(path or self.candidate)],
                             text=True, capture_output=True, check=False)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return run

    def test_native_storage_policy_with_its_own_consumers(self):
        run = subprocess.run([str(BINARY)], cwd=ROOT, text=True, capture_output=True)
        print(run.stdout, end='', flush=True)
        print(run.stderr, end='', file=sys.stderr, flush=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn('storage checks: all green', run.stdout)

    def test_unregistered_unreadable_launcher_is_outside_the_fixture(self):
        script = "import ctypes,sys; assert ctypes.CDLL(None).prctl(4,0,0,0,0)==0; print('ready'); sys.stdin.read()"
        with peer(script, self.root, registered=False):
            run = self.scan()
            self.assertEqual(run.stdout.strip(), 'absent', run.stderr)

    def test_large_descriptor_list_has_a_definite_answer(self):
        script = "import os,sys; fds=[os.open(os.devnull,os.O_RDONLY) for _ in range(6000)]; print('ready'); sys.stdin.read()"
        with peer(script, self.root):
            run = self.scan()
            self.assertEqual(run.stdout.strip(), 'absent', run.stderr)

    def test_large_mapping_list_has_a_definite_answer(self):
        script = "import mmap,sys; maps=[mmap.mmap(-1,mmap.PAGESIZE) for _ in range(6000)]; print('ready'); sys.stdin.read()"
        with peer(script, self.root):
            run = self.scan()
            self.assertEqual(run.stdout.strip(), 'absent', run.stderr)

    def test_unreadable_live_peer_keeps_unknown_and_names_the_read(self):
        script = "import ctypes,sys; assert ctypes.CDLL(None).prctl(4,0,0,0,0)==0; print('ready'); sys.stdin.read()"
        with peer(script, self.root) as child:
            run = self.scan()
            self.assertTrue(run.stdout.startswith('unknown:'), run.stdout)
            self.assertIn(f'/proc/{child.pid}/', run.stderr)
            self.assertIn('error=13', run.stderr)
        self.assertEqual(self.scan().stdout.strip(), 'absent')

    def test_exiting_processes_release_their_references(self):
        script = """import subprocess,sys,pathlib,os
print('ready')
for _ in range(1000):
    child = subprocess.Popen(['/bin/true'])
    entry = pathlib.Path(os.environ['BATON_STORAGE_TEST_PROC']) / str(child.pid)
    entry.symlink_to(f'/proc/{child.pid}')
    child.wait()
    entry.unlink()
sys.stdin.read()
"""
        with peer(script, self.root):
            for _ in range(8):
                run = self.scan()
                self.assertEqual(run.stdout.strip(), 'absent', run.stderr)

    def test_twelve_released_worktrees_and_a_live_checkout(self):
        source = self.root / 'project'
        source.mkdir()
        def git(*args):
            return subprocess.run(['git', '-C', str(source), *map(str, args)],
                                  text=True, capture_output=True, check=True)
        git('init', '-q')
        git('config', 'user.name', 'Storage fixture')
        git('config', 'user.email', 'storage-fixture@example.invalid')
        (source / 'source.txt').write_text('source\n')
        git('add', 'source.txt')
        git('commit', '-qm', 'Fixture source')
        trees = [self.root / f'checkout-{i}' for i in range(12)]
        for path in trees:
            git('worktree', 'add', '--detach', path, 'HEAD')
        for path in trees:
            run = self.scan(path)
            self.assertEqual(run.stdout.strip(), 'absent', run.stderr)
        with peer("import sys; print('ready'); sys.stdin.read()", trees[5]) as child:
            run = self.scan(trees[5])
            self.assertTrue(run.stdout.startswith('present:'), run.stdout + run.stderr)
            self.assertIn(str(child.pid), run.stdout.split(':', 1)[1].strip().split(','))
        for path in trees:
            run = self.scan(path)
            self.assertEqual(run.stdout.strip(), 'absent', run.stderr)
            git('worktree', 'remove', path)


if __name__ == '__main__':
    unittest.main()
