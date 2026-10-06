"""Packaged native receiver applies the shipped Node identity helper."""
import hashlib
import importlib.util
import json
import os
import pathlib
import shlex
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
        controls.Control.setUp(self, preserve_home=True)
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
        action_marker = "    if action.get('ack'):"
        self.assertIn(action_marker, fixture)
        fixture = fixture.replace(action_marker, r'''    if action.get('git_headers'):
        def git(*argv, text=None):
            return subprocess.run(['git', *argv], input=text, capture_output=True,
                                  text=True, check=True, timeout=10).stdout
        tree=git('hash-object','-w','-t','tree','--stdin',text='').strip()
        oid=git('-c','commit.gpgSign=false','commit-tree',tree,'-m','Native attribution fixture').strip()
        raw=git('cat-file','commit',oid)
        helpers={context:git('config','--get-all','credential.'+context+'.helper').splitlines()
                 for context in ('https://github.com/Flip-Engineering/baton',
                                 'https://github.com/Flip-Engineering/baton.git')}
        reply({'oid':oid,'raw':raw,'helpers':helpers,'home':os.environ.get('HOME'),
               'globalConfig':os.environ.get('GIT_CONFIG_GLOBAL')})
        continue
''' + action_marker, 1)
        self.fixture.write_text('#!' + sys.executable + '\n' + fixture)
        self.registry = self.home / '.config/baton/github-apps/series.json'
        self.registry.parent.mkdir(parents=True)
        profiles = {}
        self.identities = {}
        self.models = {'gpt': 'gpt-6-astra', 'kimi': 'kimi-code/k3',
                       'muse': 'fixture/muse', 'deepseek': 'fixture/deepseek',
                       'claude': 'fixture/claude', 'glm': 'fixture/glm'}
        config['sessions'].update({model: 'shared-' + series for series, model in self.models.items()})
        config['sessions']['kimi-code/k3'] = 'recipient'
        config_path.write_text(json.dumps(config))
        for index, (series, display) in enumerate((('gpt', 'GPT'), ('kimi', 'Kimi'),
                                                   ('muse', 'Muse'), ('deepseek', 'DeepSeek'),
                                                   ('claude', 'Claude'), ('glm', 'GLM'))):
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
        self.registry.write_text(json.dumps({'models': {model: series for series, model in self.models.items()},
                                            'series': profiles}))
        self.registry.chmod(0o600)
        self.environment['BATON2_GIT_REGISTRY'] = str(self.registry)
        self.environment.update(GIT_AUTHOR_NAME='Flip Baton - GPT', GIT_COMMITTER_NAME='Flip Baton - GPT',
                                GIT_AUTHOR_EMAIL=self.identities['gpt']['commitEmail'],
                                GIT_COMMITTER_EMAIL=self.identities['gpt']['commitEmail'])
        (self.directory / 'identity-boundary.json').write_text(json.dumps({
            'actual_credentials': False, 'actual_profile_reads': False, 'network': False,
            'provider_execution': False, 'metadata': 'generated public fixture profiles',
            'copies': self.pins}, indent=2) + '\n')

    def test_shared_attribution_reaches_native_headers_with_each_canonical_series(self):
        settings = json.loads(self.registry.read_text())
        settings['attribution'] = {'name': 'Flip - Baton', 'email': 'baton@example.invalid'}
        self.registry.write_text(json.dumps(settings))
        metadata = {}
        for series, directory in settings['series'].items():
            path = pathlib.Path(directory) / 'identity-series.json'
            value = json.loads(path.read_text())
            value['authorEmail'] = series + '@example.invalid'
            path.write_text(json.dumps(value))
            metadata[path] = path.read_bytes()
        self.root()
        for series, model in self.models.items():
            with self.subTest(series=series):
                actor = 'recipient' if series == 'kimi' else 'shared-' + series
                assigned = self.call('recruit', actor, 'root', 'omp', model, 'low',
                                     self.repo, actor + '-branch', self.checkouts / actor, self.base)
                log = self.directory / (actor + '.jsonl')
                configured = self.call('receiver', actor, self.fixture, log)
                endpoint = ['node', str(self.helper.resolve()), 'launch', '--registry', str(self.registry.resolve()),
                            '--model-key', model, '--', str(self.binary.resolve()), str(self.db.resolve()),
                            'receive', actor, str(self.fixture.resolve()), '', '', '', str(log.resolve())]
                self.assertEqual(configured['endpoint'], endpoint)
                task_id = actor + '-task'
                self.dispatch('dispatch-file', task_id, 'root', actor, 'task', self.task)
                stream, native = self.accept(actor)
                self.assertEqual(native['cwd'], assigned['workspace'])
                self.assertEqual(native['args'][native['args'].index('--model') + 1], model)
                headers = self.action(stream, git_headers=True)
                (self.directory / (actor + '-git-headers.json')).write_text(json.dumps(headers, indent=2) + '\n')
                for field in ('author', 'committer'):
                    lines = [line for line in headers['raw'].split('\n') if line.startswith(field + ' ')]
                    self.assertEqual(len(lines), 1)
                    self.assertTrue(lines[0].startswith(field + ' Flip - Baton <baton@example.invalid> '), lines)
                for values in headers['helpers'].values():
                    self.assertEqual(len(values), 1)
                    self.assertTrue(values[0].startswith('!'))
                    argv = shlex.split(values[0][1:])
                    self.assertEqual(argv[1:], [str(self.helper.resolve()), 'helper', '--registry',
                                               str(self.registry.resolve()), '--series-key', series])
                self.assertEqual(headers['home'], os.environ.get('HOME'))
                self.assertEqual(headers['globalConfig'], os.devnull)
                report = 'Shared native attribution fixture completed for ' + series
                self.finish(stream, report)
                self.exited(actor)
                self.eventually(lambda: any(row['reportBody'] == report for row in self.call('turns', actor)))
                self.assertEqual(self.call('delivery', task_id)['receipt'], 'fixture-native-reviewed')
                retained = self.call('player', actor)
                for key in ('parent', 'harness', 'model', 'effort', 'workspace', 'branch', 'base'):
                    self.assertEqual(retained[key], assigned[key])
                self.assertEqual(retained['native'], native['native'])
                self.assertEqual(retained['observedModel'], 'fixture/' + model)
                self.eventually(lambda: not self.process_rows())
        for path, content in metadata.items():
            self.assertEqual(path.read_bytes(), content)
            value = json.loads(content)
            self.assertEqual(value['github'], self.identities[value['seriesKey']])
        for pin in self.pins:
            self.assertEqual(hashlib.sha256(pathlib.Path(pin['copy']).read_bytes()).hexdigest(), pin['sha256'])
        self.assertEqual(self.environment['GIT_AUTHOR_EMAIL'], self.identities['gpt']['commitEmail'])

    def test_malformed_shared_attribution_refuses_receiver_without_native_delivery(self):
        self.root()
        self.call('recruit', 'recipient', 'root', 'omp', 'kimi-code/k3', 'low',
                  self.repo, 'recipient-branch', self.checkouts / 'recipient', self.base)
        self.call('message', 'retained-input', 'root', 'recipient', 'guidance', 'Preserve pending work.')
        before = self.call('player', 'recipient')
        settings = json.loads(self.registry.read_text())
        for malformed in ({'name': '', 'email': 'baton@example.invalid'},
                          {'name': 'Flip\nBaton', 'email': 'baton@example.invalid'},
                          {'name': 'Flip <Baton>', 'email': 'baton@example.invalid'},
                          {'name': 'Flip - Baton', 'email': 'bad\n@example.invalid'},
                          {'name': 'Flip - Baton'}):
            with self.subTest(attribution=malformed):
                settings['attribution'] = malformed
                self.registry.write_text(json.dumps(settings))
                refused = self.call('receiver', 'recipient', self.fixture,
                                    self.directory / 'refused.jsonl', ok=False)
                self.assertEqual(refused['code'], 2)
                self.assertIn('Series Git operation refused', refused['stderr'])
                self.assertEqual(self.call('player', 'recipient'), before)
                self.assertIsNone(self.call('delivery', 'retained-input')['receipt'])
                self.assertEqual(self.call('turns', 'recipient'), [])
                self.assertEqual(self.rows('SELECT * FROM executions'), [])
                self.assertFalse(self.process_rows())
        self.assertEqual(self.controls, [])
        settings['attribution'] = {'name': 'Flip - Baton', 'email': 'baton@example.invalid'}
        self.registry.write_text(json.dumps(settings))
        configured = self.call('receiver', 'recipient', self.fixture, self.directory / 'refused.jsonl')
        settings['attribution']['email'] = 'invalid\n@example.invalid'
        self.registry.write_text(json.dumps(settings))
        self.dispatch('dispatch-file', 'malformed-launch', 'root', 'recipient', 'task', self.task)
        diagnostic = pathlib.Path(str(self.db) + '.dispatch-' + 'malformed-launch'.encode().hex() + '.stderr')
        self.eventually(lambda: diagnostic.exists() and 'Series Git operation refused' in diagnostic.read_text())
        self.eventually(lambda: not self.process_rows())
        self.assertEqual(json.loads(self.call('session', 'recipient')['endpoint']), configured['endpoint'])
        self.assertIsNone(self.call('delivery', 'malformed-launch')['receipt'])
        self.assertIsNone(self.call('delivery', 'retained-input')['receipt'])
        self.assertEqual(self.call('turns', 'recipient'), [])
        self.assertEqual(self.rows('SELECT * FROM executions'), [])
        self.assertFalse((self.directory / 'native-starts.jsonl').exists())

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
