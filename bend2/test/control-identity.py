"""Packaged native receiver applies the shipped Node identity helper."""
import hashlib
import importlib.util
import json
import pathlib
import shutil
import sys
import unittest


SPEC = importlib.util.spec_from_file_location('native_control_fixture', pathlib.Path(__file__).with_name('control.py'))
controls = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controls)


class ControlIdentity(unittest.TestCase):
    git = controls.Control.git
    call = controls.Control.call
    root = controls.Control.root
    dispatch = controls.Control.dispatch
    accept = controls.Control.accept
    action = controls.Control.action
    finish = controls.Control.finish
    rows = controls.Control.rows
    eventually = controls.Control.eventually
    process_rows = controls.Control.process_rows
    exited = controls.Control.exited
    close_fixtures = controls.Control.close_fixtures

    def setUp(self):
        controls.Control.setUp(self)
        previous = controls.EXE
        self.prefix = self.directory / 'installed-prefix'
        self.binary = self.prefix / 'bin/baton2'
        self.helper = self.prefix / 'libexec/baton2/git-series.mjs'
        self.binary.parent.mkdir(parents=True)
        self.helper.parent.mkdir(parents=True)
        original_helper = controls.ROOT / 'bend2/harness/git-series.mjs'
        shutil.copy2(previous, self.binary)
        shutil.copy2(original_helper, self.helper)
        self.pins = []
        for source, copy in ((previous, self.binary), (original_helper, self.helper)):
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(hashlib.sha256(copy.read_bytes()).hexdigest(), digest)
            self.pins.append({'source': str(source), 'copy': str(copy), 'sha256': digest})
        controls.EXE = self.binary
        self.addCleanup(setattr, controls, 'EXE', previous)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(exe=str(self.binary), sessions={'kimi-code/k3': 'recipient'})
        config_path.write_text(json.dumps(config))
        original = controls.FIXTURE
        marker = "'apiKeyVariablesPresent':"
        self.assertIn(marker, original)
        fixture = original.replace(marker,
            "'author':os.environ.get('GIT_AUTHOR_NAME'),'authorEmail':os.environ.get('GIT_AUTHOR_EMAIL'),"
            "'committer':os.environ.get('GIT_COMMITTER_NAME'),'committerEmail':os.environ.get('GIT_COMMITTER_EMAIL'),"
            + marker, 1)
        self.fixture.write_text('#!' + sys.executable + '\n' + fixture)
        self.registry = self.home / '.config/baton/github-apps/series.json'
        self.registry.parent.mkdir(parents=True)
        profiles = {}
        self.identities = {}
        for index, (series, display) in enumerate((('gpt', 'GPT'), ('kimi', 'Kimi'))):
            directory = self.registry.parent / series
            directory.mkdir()
            slug = 'fixture-series-' + series
            bot = 10000 + index
            github = {'appId': 20000 + index, 'clientId': 'fixture-client-' + series,
                      'slug': slug, 'botLogin': slug + '[bot]', 'botId': bot,
                      'commitEmail': f'{bot}+{slug}[bot]@users.noreply.github.com',
                      'installationId': 30000 + index, 'repositoryFullName': 'Flip-Engineering/baton',
                      'repositoryId': 40000,
                      'permissions': {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}}
            metadata = directory / 'identity-series.json'
            metadata.write_text(json.dumps({'seriesKey': series, 'displaySeries': display, 'github': github}))
            metadata.chmod(0o600)
            self.identities[series] = github
            profiles[series] = str(directory)
        self.registry.write_text(json.dumps({'models': {'gpt-6-astra': 'gpt', 'kimi-code/k3': 'kimi'},
                                            'series': profiles}))
        self.registry.chmod(0o600)
        self.environment.update(GIT_AUTHOR_NAME='Flip Baton - GPT', GIT_COMMITTER_NAME='Flip Baton - GPT',
                                GIT_AUTHOR_EMAIL=self.identities['gpt']['commitEmail'],
                                GIT_COMMITTER_EMAIL=self.identities['gpt']['commitEmail'])
        (self.directory / 'identity-boundary.json').write_text(json.dumps({
            'actual_credentials': False, 'actual_profile_reads': False, 'network': False,
            'provider_execution': False, 'metadata': 'generated public fixture profiles',
            'copies': self.pins}, indent=2) + '\n')

    def test_packaged_receiver_reselects_recipient_identity_and_finishes_native_delivery(self):
        self.root()
        assignment = self.call('recruit', 'recipient', 'root', 'omp', 'kimi-code/k3', 'low',
                               self.repo, 'recipient-branch', self.checkouts / 'recipient', self.base)
        log = self.directory / 'recipient.jsonl'
        configured = self.call('receiver', 'recipient', self.fixture, log)
        endpoint = ['node', str(self.helper.resolve()), 'launch', '--registry', str(self.registry.resolve()),
                    '--model-key', 'kimi-code/k3', '--', str(self.binary.resolve()), str(self.db.resolve()),
                    'receive', 'recipient', str(self.fixture.resolve()), '', '', '', str(log.resolve())]
        self.assertEqual(configured['endpoint'], endpoint)
        self.dispatch('dispatch-file', 'recipient-task', 'root', 'recipient', 'task', self.task)
        stream, native = self.accept('recipient')
        self.assertEqual(native['args'][native['args'].index('--model') + 1], 'kimi-code/k3')
        self.assertEqual(native['cwd'], assignment['workspace'])
        self.assertIn(self.task.read_text(), native['prompt'])
        self.assertEqual((native['author'], native['committer']), ('Flip Baton - Kimi', 'Flip Baton - Kimi'))
        self.assertEqual((native['authorEmail'], native['committerEmail']),
                         (self.identities['kimi']['commitEmail'], self.identities['kimi']['commitEmail']))
        self.assertEqual(self.environment['GIT_AUTHOR_NAME'], 'Flip Baton - GPT')
        report = 'The compiled receiver used the packaged Kimi identity.\nComplete retained native report λ.'
        self.finish(stream, report)
        self.exited('recipient')
        self.eventually(lambda: any(row['reportBody'] == report for row in self.call('turns', 'recipient')))
        self.assertEqual(self.call('delivery', 'recipient-task')['receipt'], 'fixture-native-reviewed')
        saved = self.call('turns', 'recipient')[0]
        delivery = self.call('delivery', saved['id'])
        self.assertEqual((delivery['sender'], delivery['recipient'], delivery['body']),
                         ('recipient', 'root', report))
        self.assertEqual(self.call('player', 'recipient')['native'], native['native'])
        controls.shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())
        for pin in self.pins:
            self.assertEqual(hashlib.sha256(pathlib.Path(pin['copy']).read_bytes()).hexdigest(), pin['sha256'])
        self.assertEqual(list(self.home.rglob('private-key.pem')), [])


    def test_unmapped_recorded_model_refuses_configuration_before_launch(self):
        self.root()
        self.call('recruit', 'unmapped-receiver', 'root', 'omp', 'zai/glm-5.3-flash', 'low',
                  self.repo, 'unmapped-receiver-branch', self.checkouts / 'unmapped-receiver', self.base)
        self.call('recruit', 'unmapped-turn', 'root', 'muse', 'zai/glm-5.3-flash', 'low',
                  self.repo, 'unmapped-turn-branch', self.checkouts / 'unmapped-turn', self.base)
        self.call('message', 'unmapped-input', 'root', 'unmapped-receiver', 'guidance', 'Continue.')
        refused = self.call('receiver', 'unmapped-receiver', self.fixture,
                            self.directory / 'unmapped.jsonl', ok=False)
        self.assertEqual(refused['code'], 2)
        self.assertIn('Series Git operation refused', refused['stderr'])
        self.assertIn('does not resolve the recorded model zai/glm-5.3-flash', refused['stderr'])
        self.assertEqual(self.call('session', 'unmapped-receiver')['endpoint'], '')
        self.assertEqual([row['id'] for row in self.call('inbox', 'unmapped-receiver')], ['unmapped-input'])
        turn = self.call('dispatch-turn', 'unmapped-turn', 'muse-turn-1', self.fixture,
                         self.directory / 'muse.jsonl', self.task, ok=False)
        self.assertEqual(turn['code'], 2)
        self.assertIn('does not resolve the recorded model zai/glm-5.3-flash', turn['stderr'])
        self.assertEqual(self.controls, [])
        self.assertEqual(self.call('turns', 'unmapped-turn'), [])

if __name__ == '__main__':
    unittest.main()
