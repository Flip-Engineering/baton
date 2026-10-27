"""Packaged native receiver applies the shipped Node identity helper."""
import hashlib
import importlib.util
import json
import pathlib
import shutil
import shlex
import subprocess
import sys
import unittest


SPEC = importlib.util.spec_from_file_location('native_control_fixture', pathlib.Path(__file__).with_name('control.py'))
controls = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controls)


class ControlIdentity(unittest.TestCase):
    read_count = controls.Control.read_count
    git = controls.Control.git
    call = controls.Control.call
    root = controls.Control.root
    dispatch = controls.Control.dispatch
    accept = controls.Control.accept
    accept_any = controls.Control.accept_any
    capture_child_output = controls.Control.capture_child_output
    child_communication = controls.Control.child_communication
    action = controls.Control.action
    finish = controls.Control.finish
    rows = controls.Control.rows
    eventually = controls.Control.eventually
    process_rows = controls.Control.process_rows
    exited = controls.Control.exited
    close_fixtures = controls.Control.close_fixtures

    def setUp(self):
        controls.Control.setUp(self)
        subprocess.run(['git', '-C', str(self.repo), 'remote', 'add', 'origin',
                        'https://github.com/Flip-Engineering/baton.git'],
                       env=self.environment, check=True, capture_output=True)
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
        config.update(exe=str(self.binary), sessions={'kimi-code/k3': 'recipient'},
                      envDump=str(self.directory / 'native-env.json'))
        config_path.write_text(json.dumps(config))
        original = controls.FIXTURE
        marker = "'apiKeyVariablesPresent':"
        self.assertIn(marker, original)
        fixture = original.replace(marker,
            "'author':os.environ.get('GIT_AUTHOR_NAME'),'authorEmail':os.environ.get('GIT_AUTHOR_EMAIL'),"
            "'committer':os.environ.get('GIT_COMMITTER_NAME'),'committerEmail':os.environ.get('GIT_COMMITTER_EMAIL'),"
            "'gitConfig':{k:v for k,v in os.environ.items() if k.startswith('GIT_CONFIG_')},"
            "'askpass':os.environ.get('GIT_ASKPASS'),"
            "'envDump':(pathlib.Path(config['envDump']).write_text(json.dumps("
            "{k:v for k,v in os.environ.items() if k.startswith('GIT_') "
            "or k == 'BATON2_GIT_REGISTRY' or k in ('HOME','PATH')})),None)[1],"
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
                      'installationId': 30000 + index,
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
                    '--model-key', 'kimi-code/k3', '--repository', 'Flip-Engineering/baton',
                    '--', str(self.binary.resolve()), str(self.db.resolve()),
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
        self.assertGreater(self.read_count('recipient-task'), 0)
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

    def test_native_worker_commit_uses_the_selected_series_over_shared_configuration(self):
        self.root()
        assignment = self.call('recruit', 'recipient', 'root', 'omp', 'kimi-code/k3', 'low',
                               self.repo, 'recipient-branch', self.checkouts / 'recipient', self.base)
        log = self.directory / 'recipient.jsonl'
        self.call('receiver', 'recipient', self.fixture, log)
        self.dispatch('dispatch-file', 'recipient-task', 'root', 'recipient', 'task', self.task)
        stream, native = self.accept('recipient')
        result = self.action(stream, git_commit=['worker.txt', 'worker change\n'])
        self.assertEqual(result['git_commit']['code'], 0, result)
        header = subprocess.run(
            ['git', '-C', assignment['workspace'], 'cat-file', '-p', 'HEAD'],
            check=True, text=True, capture_output=True, env=self.environment).stdout
        for field in ('author', 'committer'):
            self.assertIn(f"{field} Flip Baton - Kimi <{self.identities['kimi']['commitEmail']}> ", header)
        self.assertNotIn('fixture@example.invalid', header)
        self.finish(stream, 'The worker commit retained the selected series identity.')
        self.exited('recipient')
        controls.shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())

    def test_nested_receiver_selects_its_assignment_repository_over_an_inherited_scope(self):
        self.root()
        outer = self.call('recruit', 'outer', 'root', 'omp', 'gpt-6-astra', 'low',
                          self.repo, 'outer-branch', self.checkouts / 'outer', self.base)
        outer_log = self.directory / 'outer.jsonl'
        outer_endpoint = self.call('receiver', 'outer', self.fixture, outer_log)['endpoint']
        self.assertEqual(outer_endpoint[outer_endpoint.index('--repository') + 1],
                         'Flip-Engineering/baton')
        self.dispatch('dispatch-file', 'outer-task', 'root', 'outer', 'task', self.task)
        outer_stream, outer_native = self.accept('gpt-6-astra')
        self.assertEqual(outer_native['cwd'], outer['workspace'])
        inherited = json.loads((self.directory / 'native-env.json').read_text())
        count = int(inherited['GIT_CONFIG_COUNT'])
        inherited[f'GIT_CONFIG_KEY_{count}'] = 'diff.algorithm'
        inherited[f'GIT_CONFIG_VALUE_{count}'] = 'patience'
        inherited['GIT_CONFIG_COUNT'] = str(count + 1)
        self.assertTrue(any('credential.https://github.com/Flip-Engineering/baton' in value
                            for value in inherited.values()), inherited)

        flip_repo = self.directory / 'flip-repository'
        flip_repo.mkdir()
        for args in (['init', '-q', '-b', 'main'], ['config', 'user.name', 'Flip fixture'],
                     ['config', 'user.email', 'flip@example.invalid']):
            subprocess.run(['git', '-C', str(flip_repo), *args], env=self.environment,
                           check=True, capture_output=True)
        (flip_repo / 'seed.txt').write_text('flip seed\n')
        for args in (['add', 'seed.txt'], ['commit', '-q', '-m', 'Flip seed'],
                     ['remote', 'add', 'origin', 'https://github.com/flip-engineer/flip.git']):
            subprocess.run(['git', '-C', str(flip_repo), *args], env=self.environment,
                           check=True, capture_output=True)
        flip_base = subprocess.run(['git', '-C', str(flip_repo), 'rev-parse', 'HEAD'],
                                   env=self.environment, check=True, capture_output=True,
                                   text=True).stdout.strip()
        self.call('recruit', 'nested', 'outer', 'omp', 'kimi-code/k3', 'low',
                  flip_repo, 'nested-branch', self.checkouts / 'nested', flip_base, env=inherited)
        nested_log = self.directory / 'nested.jsonl'
        nested_endpoint = self.call('receiver', 'nested', self.fixture, nested_log,
                                    env=inherited)['endpoint']
        self.assertEqual(nested_endpoint[nested_endpoint.index('--repository') + 1],
                         'flip-engineer/flip')
        launched = self.call('dispatch-file', 'nested-task', 'outer', 'nested', 'task',
                             self.task, env=inherited)
        self.assertEqual(launched['state'], 'launched')
        nested_stream, nested_native = self.accept('recipient')
        config = nested_native['gitConfig']
        pairs = {config[f'GIT_CONFIG_KEY_{index}']: config[f'GIT_CONFIG_VALUE_{index}']
                 for index in range(int(config['GIT_CONFIG_COUNT']))}
        self.assertEqual(nested_native['askpass'], 'false')
        for suffix in ('', '.git'):
            helper = pairs[f'credential.https://github.com/flip-engineer/flip{suffix}.helper']
            arguments = shlex.split(helper[1:])
            self.assertEqual(arguments[arguments.index('--repository') + 1], 'flip-engineer/flip')
        self.assertFalse(any('Flip-Engineering/baton' in key for key in pairs), pairs)
        self.assertEqual(pairs['diff.algorithm'], 'patience')
        self.finish(nested_stream, 'The nested worker retained its assigned repository.')
        self.exited('nested')
        self.finish(outer_stream, 'The outer worker completed its fixture turn.')
        self.exited('outer')
        controls.shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())

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
