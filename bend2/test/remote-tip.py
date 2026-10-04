"""Check the declared remote-tip reader against a local bare remote."""
import json
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class RemoteTip(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.remote = self.directory / 'remote.git'
        self.repo = self.directory / 'source'
        self.git('init', '--bare', '-q', self.remote)
        self.git('init', '-q', '-b', 'main', self.repo)
        for setting in (('user.name', 'Remote tip fixture'),
                        ('user.email', 'fixture@example.invalid')):
            self.git('-C', self.repo, 'config', *setting)
        (self.repo / 'seed.txt').write_text('seed\n')
        self.git('-C', self.repo, 'add', 'seed.txt')
        self.git('-C', self.repo, 'commit', '-q', '-m', 'Fixture seed')
        self.git('-C', self.repo, 'remote', 'add', 'origin', self.remote)
        self.git('-C', self.repo, 'push', '-q', 'origin', 'main')
        self.git('-C', self.repo, 'branch', 'local-only')
        self.head = self.git('-C', self.repo, 'rev-parse', 'HEAD').stdout.strip()

    def git(self, *args):
        return subprocess.run(['git', *map(str, args)], check=True, text=True,
                              capture_output=True)

    def call(self, *args):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)],
                              text=True, capture_output=True)

    def tip(self, branch, remote):
        result = self.call('remote-tip', self.repo, branch, remote)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def refs(self, repo):
        return self.git('-C', repo, 'show-ref').stdout

    def test_advertised_branch_reports_the_remote_object(self):
        advertised = self.tip('main', self.remote)
        self.assertEqual(advertised, {'status': 'advertised', 'repo': str(self.repo),
                                      'branch': 'main', 'remote': str(self.remote),
                                      'objectId': self.head})
        named = self.tip('main', 'origin')
        self.assertEqual(named, {'status': 'advertised', 'repo': str(self.repo),
                                 'branch': 'main', 'remote': 'origin', 'objectId': self.head})
        read = self.git('-C', self.repo, 'ls-remote', self.remote, 'refs/heads/main')
        self.assertEqual(read.stdout.split()[0], advertised['objectId'])

    def test_unadvertised_branch_reports_absent(self):
        for branch in ('missing', 'local-only'):
            with self.subTest(branch=branch):
                self.assertEqual(self.tip(branch, self.remote),
                                 {'status': 'absent', 'repo': str(self.repo),
                                  'branch': branch, 'remote': str(self.remote)})

    def test_unreachable_remote_reports_the_read_failure(self):
        missing = self.directory / 'missing.git'
        result = self.call('remote-tip', self.repo, 'main', missing)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('does not appear to be a git repository', result.stderr)
        answer = json.loads(result.stdout)
        self.assertEqual(set(answer), {'status', 'repo', 'branch', 'remote', 'exit', 'reason'})
        self.assertEqual((answer['status'], answer['repo'], answer['branch'], answer['remote']),
                         ('failed', str(self.repo), 'main', str(missing)))
        self.assertNotEqual(answer['exit'], 0)
        self.assertEqual(answer['reason'], f'git ls-remote {missing} failed')

    def test_a_leading_option_remote_is_read_as_the_remote_operand(self):
        result = self.call('remote-tip', self.repo, 'main', '--get-url')
        self.assertEqual(result.returncode, 0, result.stderr)
        answer = json.loads(result.stdout)
        self.assertEqual((answer['status'], answer['repo'], answer['branch'], answer['remote']),
                         ('failed', str(self.repo), 'main', '--get-url'))
        self.assertEqual(answer['reason'], 'git ls-remote --get-url failed')
        self.assertNotEqual(answer['exit'], 0)
        self.assertTrue(result.stderr.strip(), result.stdout)
        self.assertNotIn('objectId', answer)
        self.assertEqual(self.tip('main', self.remote)['status'], 'advertised')
        self.assertEqual(self.tip('missing', self.remote)['status'], 'absent')

    def test_the_read_changes_no_ref(self):
        local_before, remote_before = self.refs(self.repo), self.refs(self.remote)
        for branch, remote in (('main', self.remote), ('main', 'origin'), ('missing', self.remote),
                               ('main', self.directory / 'missing.git'), ('main', '--get-url')):
            with self.subTest(branch=branch, remote=remote):
                self.call('remote-tip', self.repo, branch, remote)
        self.assertEqual(self.refs(self.repo), local_before)
        self.assertEqual(self.refs(self.remote), remote_before)
        self.assertEqual(self.git('-C', self.repo, 'rev-parse', 'HEAD').stdout.strip(), self.head)


if __name__ == '__main__':
    unittest.main()
