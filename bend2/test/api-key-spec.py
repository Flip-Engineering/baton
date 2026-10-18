"""Focused environment-specification boundary tests for the native account helper."""
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENTRY = pathlib.Path(os.environ.get('BATON2_API_KEY_SPEC', ROOT / '.scratch/bend2/api-key-spec'))
SECRET = 'sk-fixture-spec-2f0c9b'


def run(*arguments):
    return subprocess.run([str(ENTRY), *arguments], capture_output=True, text=True)


class ApiKeySpec(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='api-key-spec-'))
        self.addCleanup(lambda: __import__('shutil').rmtree(self.directory, ignore_errors=True))

    def spec(self, name='spec', text='BATON_SPEC_VALUE=' + SECRET + '\n', mode=0o600):
        path = self.directory / name
        path.write_text(text)
        path.chmod(mode)
        return path

    def result(self, name='result'):
        return self.directory / name

    def test_owner_only_spec_reaches_the_child_and_is_removed(self):
        spec = self.spec()
        result = self.result()
        completed = run(str(spec), str(result))
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('exit 0', completed.stdout)
        self.assertEqual(result.read_text(), SECRET)
        self.assertFalse(spec.exists())
        self.assertNotIn(SECRET, completed.stdout)
        self.assertNotIn(SECRET, completed.stderr)

    def test_wide_spec_is_refused_unread(self):
        spec = self.spec(mode=0o644)
        completed = run(str(spec), str(self.result()))
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIn('specUnreadable', completed.stderr)
        self.assertFalse(self.result().exists())
        self.assertNotIn(SECRET, completed.stderr)

    def test_symlink_spec_is_refused(self):
        target = self.spec(name='target')
        link = self.directory / 'link'
        link.symlink_to(target)
        completed = run(str(link), str(self.result()))
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIn('specUnreadable', completed.stderr)
        self.assertFalse(self.result().exists())
        self.assertEqual(target.read_text(), 'BATON_SPEC_VALUE=' + SECRET + '\n')

    def test_directory_spec_is_refused(self):
        directory = self.directory / 'directory'
        directory.mkdir()
        completed = run(str(directory), str(self.result()))
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIn('specUnreadable', completed.stderr)

    def test_malformed_spec_line_is_refused(self):
        spec = self.spec(text='NO_EQUALS_HERE\n')
        completed = run(str(spec), str(self.result()))
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIn('specLineMalformed', completed.stderr)
        self.assertFalse(self.result().exists())

    def test_private_write_is_owner_only_and_refuses_existing_paths(self):
        path = self.directory / 'private'
        completed = run('write', str(path), 'value')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        info = path.stat()
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
        self.assertEqual(info.st_uid, os.geteuid())
        self.assertEqual(path.read_text(), 'value')
        again = run('write', str(path), 'value')
        self.assertEqual(again.returncode, 2, again.stderr)

    def test_private_write_refuses_a_symlink(self):
        target = self.directory / 'absent'
        link = self.directory / 'link'
        link.symlink_to(target)
        completed = run('write', str(link), 'value')
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
