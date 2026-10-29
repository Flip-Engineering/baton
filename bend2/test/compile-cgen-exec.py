"""Unit cache directory selection of the queued C-generation wrapper.

The wrapper chooses BEND_CGEN_CACHE_DIR from file ownership under the queue state
root and ignores the job environment. These tests run it against a fake state root.
No compiler is started. They show the selection logic; the kernel's refusal of writes
by other users is not exercised, because an unprivileged test cannot switch user.
"""
import json
import os
from pathlib import Path
import runpy
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXEC = ROOT / '.github/scripts/compile-cgen-exec.py'
ADAPTER = ROOT / '.github/scripts/queue-native-checks.py'
WRAPPER = runpy.run_path(str(EXEC))


class CacheSelection(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / 'state'
        (self.state / 'keys/key/runs/attempt/work').mkdir(parents=True)
        (self.state / 'heavy.lock').write_text('')
        self.attempt = self.state / 'keys/key/runs/attempt'
        self.shared = self.state / 'cgen-cache/trusted'
        self.report = Path(self.directory.name) / 'seen.json'

    def publisher(self, mode=0o755):
        self.shared.mkdir(parents=True)
        os.chmod(self.shared, mode)

    def run_wrapper(self, environment=None, output=None, command=None):
        environment = {'PATH': os.environ['PATH'], 'HOME': self.directory.name, **(environment or {})}
        output = output or str(self.attempt / 'work/output.c')
        command = command or [sys.executable, '-c',
                              'import json,os,sys;open(sys.argv[1],"w").write(json.dumps([os.environ.get("BEND_CGEN_CACHE_DIR"), os.umask(0)]))',
                              str(self.report), '-o', 'x']
        return subprocess.run([sys.executable, str(EXEC), output, *command], env=environment, capture_output=True, text=True)

    def compiler_saw(self):
        return json.loads(self.report.read_text())

    def selection(self):
        return json.loads((self.attempt / 'cache-selection.json').read_text())

    def private(self):
        return self.state / 'cgen-cache/untrusted' / str(os.getuid())

    def test_the_owner_of_an_exclusive_directory_shares_it(self):
        self.publisher()
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.compiler_saw(), [str(self.shared), 0o022], 'the compiler gets the shared directory and a readable umask')
        selection = self.selection()
        self.assertEqual((selection['shared'], selection['kind'], selection['owner'], selection['umask']), (True, 'shared', os.getuid(), '022'))

    def test_without_the_shared_directory_the_compile_uses_a_private_one_and_creates_nothing_shared(self):
        self.run_wrapper()
        self.assertEqual(self.compiler_saw()[0], str(self.private()))
        self.assertEqual(stat.S_IMODE(self.private().stat().st_mode) & 0o077, 0)
        self.assertFalse(self.shared.exists(), 'the wrapper never creates the shared directory')
        self.assertFalse(self.selection()['shared'])
        self.assertIn('does not exist', self.selection()['reason'])

    def test_a_directory_that_another_user_owns_is_not_shared(self):
        self.publisher()
        ok, reason = WRAPPER['sole_writer'](self.shared, uid=os.getuid() + 1)
        self.assertFalse(ok)
        self.assertIn('owned by uid', reason)

    def test_a_writable_parent_must_be_sticky(self):
        self.publisher()
        parent = self.shared.parent
        os.chmod(parent, 0o775)
        ok, reason = WRAPPER['sole_writer'](self.shared)
        self.assertFalse(ok)
        self.assertIn('not sticky', reason)
        os.chmod(parent, 0o1775)
        self.assertTrue(WRAPPER['sole_writer'](self.shared)[0])
        self.run_wrapper()
        self.assertTrue(self.selection()['shared'])

    def test_group_or_other_write_makes_the_directory_unusable(self):
        for mode in (0o775, 0o757, 0o777):
            with self.subTest(mode=oct(mode)):
                shutil.rmtree(self.shared, ignore_errors=True)
                self.publisher(mode)
                self.run_wrapper()
                self.assertFalse(self.selection()['shared'])
                self.assertIn('writable by its group or by others', self.selection()['reason'])
                self.assertEqual(self.compiler_saw()[0], str(self.private()))

    @unittest.skipUnless(shutil.which('setfacl'), 'setfacl is required')
    def test_an_acl_entry_that_lets_another_user_write_makes_it_unusable(self):
        self.publisher()
        other = 'nobody'
        for acl, expected in (('u:%s:r-x' % other, True), ('u:%s:rwx' % other, False)):
            with self.subTest(acl=acl):
                subprocess.run(['setfacl', '-b', str(self.shared)], check=True)
                try:
                    subprocess.run(['setfacl', '-m', acl, str(self.shared)], check=True, capture_output=True)
                except subprocess.CalledProcessError:
                    self.skipTest('this filesystem does not take ACLs')
                self.assertEqual(WRAPPER['sole_writer'](self.shared)[0], expected)

    @unittest.skipUnless(shutil.which('setfacl'), 'setfacl is required')
    def test_a_default_acl_that_lets_another_user_write_makes_it_unusable(self):
        self.publisher()
        try:
            subprocess.run(['setfacl', '-d', '-m', 'u:nobody:rwx', str(self.shared)], check=True, capture_output=True)
        except subprocess.CalledProcessError:
            self.skipTest('this filesystem does not take ACLs')
        ok, reason = WRAPPER['sole_writer'](self.shared)
        self.assertFalse(ok)
        self.assertIn('posix_acl_default', reason)

    def test_a_symbolic_link_is_not_the_shared_directory(self):
        target = Path(self.directory.name) / 'elsewhere'
        target.mkdir(mode=0o755)
        self.shared.parent.mkdir(parents=True)
        self.shared.symlink_to(target)
        self.run_wrapper()
        self.assertFalse(self.selection()['shared'])
        self.assertIn('not a plain directory', self.selection()['reason'])

    def test_inherited_cache_variables_are_ignored_and_recorded(self):
        self.publisher()
        elsewhere = str(Path(self.directory.name) / 'chosen-by-the-job')
        self.run_wrapper({'BEND_CGEN_CACHE_DIR': elsewhere, 'XDG_CACHE_HOME': elsewhere})
        self.assertEqual(self.compiler_saw()[0], str(self.shared))
        selection = self.selection()
        self.assertEqual((selection['inherited_cache_dir'], selection['inherited_xdg_cache_home']), (elsewhere, elsewhere))
        os.chmod(self.shared, 0o775)
        self.run_wrapper({'BEND_CGEN_CACHE_DIR': str(self.shared)})
        self.assertNotEqual(self.compiler_saw()[0], str(self.shared), 'a job cannot name a shared directory the wrapper rejected')

    def test_an_attempt_outside_a_state_root_keeps_its_cache_local(self):
        outside = Path(self.directory.name) / 'loose/work'
        outside.mkdir(parents=True)
        self.run_wrapper(output=str(outside / 'output.c'))
        self.assertEqual(self.compiler_saw()[0], str(outside / 'cgen-cache'))
        self.assertFalse(json.loads((outside.parent / 'cache-selection.json').read_text())['shared'])

    def test_exit_status_and_the_check_placeholder_are_kept(self):
        result = self.run_wrapper(command=[sys.executable, '-c', 'raise SystemExit(3)', '-o', 'x'])
        self.assertEqual(result.returncode, 3)
        output = self.attempt / 'work/output.c'
        self.run_wrapper(command=[sys.executable, '-c', 'pass'])
        self.assertIn('Compiler check completed successfully', output.read_text())

    def test_the_adapter_retains_the_selection_with_the_attempt_diagnostics(self):
        self.publisher()
        self.run_wrapper()
        (self.attempt / 'meta').write_text('kind=cgen\nkey=key\n')
        (self.attempt / 'source-digest').write_text('digest\n')
        for name in ('argv', 'command'):
            (self.attempt / name).write_text('x\n')
        adapter = runpy.run_path(str(ADAPTER))
        adapter['compiler_diagnostics'](self.attempt, [sys.executable])
        diagnostics = json.loads((self.attempt / 'compiler-diagnostics.json').read_text())
        self.assertEqual(diagnostics['cgen_cache'], self.selection())
        self.assertIn('BEND_CGEN_CACHE_DIR', diagnostics['environment'])


if __name__ == '__main__':
    unittest.main()
