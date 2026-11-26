"""Session setup in a workspace whose repository has no origin remote.

The setup reads the workspace's origin remote to select a GitHub repository.
A repository without that remote has no repository selection, and the setup
writes no Git error text for it.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))


class StartSetupRemote(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.fail(f'Coordinator not built at {EXE}')
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.addCleanup(self.shutdown)
        # An empty HOME has no series registry, so setup consults no identity helper.
        self.environment = {key: value for key, value in os.environ.items()
                            if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON2_GIT_REGISTRY')}
        self.environment['HOME'] = str(self.directory / 'home')
        (self.directory / 'home').mkdir()

    def shutdown(self):
        if self.db.exists():
            subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                           capture_output=True, text=True, env=self.environment)

    def repository(self, name, *remote):
        path = self.directory / name
        for args in (['init', '-q', str(path)],
                     ['-C', str(path), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                      'commit', '-q', '--allow-empty', '-m', 'Initial tree']):
            subprocess.run(['git', *args], check=True, capture_output=True, text=True)
        if remote:
            subprocess.run(['git', '-C', str(path), 'remote', 'add', *remote], check=True,
                           capture_output=True, text=True)
        return path

    def start_setup(self, session, workspace):
        return subprocess.run([str(EXE), str(self.db), 'start-setup', session, 'codex', '/bin/true',
                               'gpt-6-astra', 'low', str(workspace), str(self.directory / (session + '.jsonl'))],
                              capture_output=True, text=True, env=self.environment)

    def test_a_workspace_without_an_origin_remote_sets_up_without_git_error_text(self):
        for name, remote in (('no-remote', ()), ('other-remote', ('upstream', 'https://github.com/Example/fixture.git'))):
            with self.subTest(repository=name):
                result = self.start_setup('seat-' + name, self.repository(name, *remote))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads(result.stdout)['id'], 'seat-' + name)
                self.assertNotIn('No such remote', result.stderr)
                self.assertNotIn('error:', result.stderr)


if __name__ == '__main__':
    unittest.main()
