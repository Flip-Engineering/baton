"""Exercise structural workspace creation and actual-root qualification.

BATON2_STRUCTURAL_EXE selects the composed public executable. For author module
qualification only, BATON2_STRUCTURAL_MODULE selects the compiled recruit module
entry while the public executable supplies ordinary fixture setup. Every case
uses a new owned repository and database; no endpoint is installed.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

EXE = str(Path(os.environ['BATON2_STRUCTURAL_EXE']).resolve())
MODULE = os.environ.get('BATON2_STRUCTURAL_MODULE')
if MODULE:
    MODULE = str(Path(MODULE).resolve())
ENV = {**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
       'GIT_AUTHOR_NAME': 'Workspace fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
       'GIT_COMMITTER_NAME': 'Workspace fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid'}


class Workspace(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='structural-workspace-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.repo = self.home / 'repo'
        self.repo.mkdir()
        self.db = self.home / 'fixture.db'
        self.git('init', '-q')
        (self.repo / 'seed').write_text('seed\n')
        self.git('add', 'seed')
        self.git('commit', '-qm', 'seed')
        self.base = self.git('rev-parse', 'HEAD')
        self.cli('attach', 'owner', 'codex', 'fixture-owner', '')
        self.cli('role', 'owner', 'principal-conductor')

    def command(self, args):
        return subprocess.run(list(map(str, args)), cwd=self.home, env=ENV,
                              capture_output=True, text=True, timeout=30)

    def git(self, *args):
        p = self.command(['git', '-C', self.repo, *args])
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def cli(self, *args):
        p = self.command([EXE, self.db, *args])
        self.assertEqual(p.returncode, 0, p.stderr)
        return p

    def recruit(self, path, name='child', legacy=False, code=0):
        args = [name, 'owner', 'codex', 'fixture-model', 'high', self.repo,
                'branch-' + name, path, self.base]
        if legacy:
            p = self.command([EXE, self.db, 'recruit', *args])
        elif MODULE:
            p = self.command([MODULE, self.db, *args, '--role', 'player'])
        else:
            p = self.command([EXE, self.db, 'recruit', *args, '--role', 'player'])
        self.assertEqual(p.returncode, code, p.stdout + p.stderr)
        if legacy:
            return
        stream = p.stdout if code == 0 else p.stderr
        self.assertEqual(p.stderr if code == 0 else p.stdout, '')
        self.assertTrue(stream.endswith('\n'))
        self.assertEqual(len(stream.splitlines()), 1)
        return json.loads(stream)

    def rows(self):
        with sqlite3.connect(self.db) as db:
            return db.execute('SELECT * FROM sessions ORDER BY id').fetchall()

    def test_nested_creation_matches_legacy_and_exact_retry(self):
        self.recruit(self.home / 'legacy' / 'nested' / 'child', 'legacy', legacy=True)
        path = self.home / 'new' / 'nested' / 'child'
        result = self.recruit(path)
        self.assertEqual(result['status'], 'configured')
        self.assertEqual(result['workspace']['disposition'], 'created')
        self.assertEqual(result['workspace']['observed']['root'], str(path))
        before = self.rows()
        retry = self.recruit(path)
        self.assertEqual(retry['workspace']['disposition'], 'unchanged')
        self.assertEqual(self.rows(), before)

    def test_enclosing_repository_cannot_replace_registered_worktree(self):
        path = self.repo / 'child'
        self.recruit(path)
        self.git('worktree', 'remove', str(path))
        self.git('checkout', '-q', 'branch-child')
        path.mkdir()
        marker = path / 'preserve'
        marker.write_text('owned directory\n')
        before = self.rows()
        refs = self.git('show-ref')
        result = self.recruit(path, code=2)
        self.assertEqual(result['status'], 'registrationRefused')
        self.assertEqual(result['workspace']['observed']['root'], str(self.repo))
        self.assertEqual(result['workspace']['observed']['canonicalPath'], str(path))
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.git('show-ref'), refs)
        self.assertEqual(marker.read_text(), 'owned directory\n')

    def test_dirty_matching_worktree_is_preserved(self):
        path = self.home / 'child'
        self.recruit(path)
        (path / 'seed').write_text('dirty\n')
        (path / 'untracked').write_bytes(b'\x00unaltered')
        before = self.rows()
        result = self.recruit(path)
        self.assertEqual(result['status'], 'configured')
        self.assertTrue(result['workspace']['observed']['dirty'])
        self.assertEqual(self.rows(), before)
        self.assertEqual((path / 'seed').read_text(), 'dirty\n')
        self.assertEqual((path / 'untracked').read_bytes(), b'\x00unaltered')

    def test_canonical_alias_keeps_recorded_assignment(self):
        alias = self.home / 'alias'
        alias.symlink_to(self.home, target_is_directory=True)
        path = alias / 'child'
        first = self.recruit(path)
        before = self.rows()
        second = self.recruit(path)
        self.assertEqual(first['workspace']['path'], str(path))
        self.assertEqual(second['workspace']['path'], str(path))
        self.assertEqual(second['workspace']['observed']['root'], str(self.home / 'child'))
        self.assertEqual(second['workspace']['observed']['canonicalPath'], str(self.home / 'child'))
        self.assertEqual(self.rows(), before)

    def test_occupied_nested_path_is_preserved(self):
        path = self.home / 'nested' / 'child'
        path.mkdir(parents=True)
        (path / 'preserve').write_text('original')
        before = self.rows()
        result = self.recruit(path, code=1)
        self.assertEqual(result['status'], 'workspaceFailed')
        self.assertEqual(self.rows(), before)
        self.assertEqual((path / 'preserve').read_text(), 'original')
        self.assertNotIn('refs/heads/branch-child', self.git('show-ref'))


if __name__ == '__main__':
    print('Qualification: ' + ('compiled Structural module; public entry unqualified' if MODULE else 'public native executable'), flush=True)
    unittest.main()
