"""Default receiver registration through the focused recruitment entry."""
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BINARY = pathlib.Path(os.environ['BATON2_RECRUIT_BINARY']).resolve()


class RecruitReceiver(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="baton recruit receiver λ ")
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.prefix = self.directory / 'installed'
        self.bin = self.prefix / 'bin'
        self.bin.mkdir(parents=True)
        self.exe = self.bin / 'baton'
        shutil.copy2(BINARY, self.exe)
        self.helper = self.prefix / 'libexec/baton2/git-series.mjs'
        self.helper.parent.mkdir(parents=True)
        shutil.copy2(ROOT / 'bend2/harness/git-series.mjs', self.helper)
        self.home = self.directory / 'home'
        self.home.mkdir()
        self.db = self.directory / 'orchestra.db'
        self.registry = self.directory / 'series.json'
        models = {'gpt-6.1-sol': 'gpt', 'zai/glm-5.3-flash': 'glm',
                  'claude-sonnet-5-5': 'claude', 'muse-spark-1.3-contributor': 'muse',
                  'deepseek/deepseek-flash': 'deepseek'}
        series = {}
        for index, key in enumerate(('gpt', 'glm', 'claude', 'muse', 'deepseek')):
            app = self.directory / key
            app.mkdir()
            slug, bot = 'fixture-' + key, 9000 + index
            identity = {'seriesKey': key, 'displaySeries': {'gpt': 'GPT', 'glm': 'GLM',
                        'claude': 'Claude', 'muse': 'Muse', 'deepseek': 'DeepSeek'}[key],
                        'github': {'appId': 1000 + index, 'clientId': 'fixture-' + key,
                        'botId': bot, 'slug': slug, 'botLogin': slug + '[bot]',
                        'commitEmail': f'{bot}+{slug}[bot]@users.noreply.github.com',
                        'installationId': 2000 + index, 'repositoryId': 3000,
                        'repositoryFullName': 'Flip-Engineering/baton',
                        'permissions': {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}}}
            self.save(app / 'identity-series.json', identity)
            series[key] = str(app)
        self.save(self.registry, {'models': models, 'series': series})
        for name in ('codex', 'omp', 'claude', 'muse', 'dsh'):
            executable = self.bin / name
            executable.write_text('#!/bin/sh\nexit 91\n')
            executable.chmod(0o755)
        self.environment = {'HOME': str(self.home), 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                            'BATON2_GIT_REGISTRY': str(self.registry), 'GIT_CONFIG_GLOBAL': os.devnull,
                            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_TERMINAL_PROMPT': '0'}
        self.git('init', '-q', '-b', 'main')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '-qm', 'Initial fixture', '--allow-empty')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.call('--ensure-schema', self.db)
        self.call(self.db, 'attach', 'parent', 'codex', 'fixture-native', '[]')

    def save(self, path, value):
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], env=self.environment,
                              check=True, capture_output=True, text=True).stdout

    def call(self, *args, code=0):
        result = subprocess.run([str(self.exe), *map(str, args)], env=self.environment,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        return result

    def sql(self, statement, values=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(statement, values).fetchall()

    def recruit(self, session, harness='codex', model='gpt-6.1-sol', code=0):
        return self.call(self.db, 'recruit', session, 'parent', harness, model, 'high',
                         self.repo, session + '-branch', session + '-work', self.base, code=code)

    def session(self, session):
        return json.loads(self.call(self.db, 'session', session).stdout)

    def assert_receiver(self, row, harness, model, directory=None):
        argv = row['endpointArgv']
        self.assertIsInstance(argv, list)
        self.assertNotEqual(row.get('blockedCause'), 'endpoint-absent')
        self.assertEqual(argv[:8], ['node', str(self.helper), 'launch', '--registry',
                                   str(self.registry), '--model-key', model, '--'])
        command = 'claude' if harness == 'claude-code' else harness
        self.assertEqual(argv[8:], [str(self.exe), str(self.db), 'receive', row['id'],
                                   str(self.bin / command), '', '', '',
                                   str((directory or self.directory) / (row['id'] + '.native.jsonl'))])
        self.assertFalse(pathlib.Path(argv[-1]).exists())

    def test_recruit_registers_all_supported_harnesses_and_the_glm_control(self):
        routes = [('codex', 'gpt-6.1-sol'), ('omp', 'gpt-6.1-sol'),
                  ('omp', 'zai/glm-5.3-flash'), ('claude-code', 'claude-sonnet-5-5'),
                  ('muse', 'muse-spark-1.3-contributor'), ('dsh', 'deepseek/deepseek-flash')]
        for index, (harness, model) in enumerate(routes):
            with self.subTest(harness=harness, model=model):
                session = 'worker-' + str(index)
                row = json.loads(self.recruit(session, harness, model).stdout)
                self.assert_receiver(row, harness, model)
                self.assertEqual(self.session(session)['endpointArgv'], row['endpointArgv'])
        players = json.loads(self.call(self.db, 'players').stdout)
        self.assertEqual({row['id'] for row in players}, {'parent', *('worker-' + str(i) for i in range(len(routes)))})
        for row in players:
            if row['id'] != 'parent':
                self.assertNotEqual(row.get('blockedCause'), 'endpoint-absent')
                self.assertTrue(row['endpointArgv'])
        print('players=' + json.dumps(players))

    def test_join_registers_a_receiver_in_a_shared_dirty_worktree(self):
        unfinished = self.repo / 'unfinished.txt'
        unfinished.write_text('unfinished work\n')
        row = json.loads(self.call(self.db, 'join', 'shared', 'parent', 'omp',
                                   'zai/glm-5.3-flash', 'high', self.repo).stdout)
        self.assert_receiver(row, 'omp', 'zai/glm-5.3-flash')
        self.assertEqual(unfinished.read_text(), 'unfinished work\n')

    def test_recruit_and_join_keep_an_existing_endpoint(self):
        self.recruit('existing')
        endpoint = json.dumps(['/usr/bin/true', 'preserved endpoint'])
        self.sql('UPDATE sessions SET endpoint=? WHERE id=?', (endpoint, 'existing'))
        self.recruit('existing')
        self.assertEqual(self.session('existing')['endpoint'], endpoint)
        row = self.session('existing')
        self.call(self.db, 'join', 'existing', 'parent', row['harness'], row['model'], row['effort'], row['workspace'])
        self.assertEqual(self.session('existing')['endpoint'], endpoint)

    def test_stopped_session_keeps_its_endpoint_empty(self):
        self.recruit('stopped')
        self.sql("UPDATE sessions SET endpoint='' WHERE id='stopped'")
        self.sql("INSERT INTO session_stops(session,id,reason,outcome) VALUES('stopped','stop-fixture','operator stop','stopped')")
        (self.bin / 'codex').unlink()
        self.recruit('stopped')
        row = self.session('stopped')
        self.assertEqual(row['endpoint'], '')
        self.assertEqual(row.get('blockedCause'), 'terminal-stop')

    def test_unmapped_model_refuses_before_recording_a_receiver(self):
        result = self.recruit('unmapped', model='fixture/unmapped-model', code=2)
        self.assertIn('configured series registry does not resolve the recorded model fixture/unmapped-model', result.stderr)
        self.assertEqual(self.sql("SELECT endpoint FROM sessions WHERE id='unmapped'"), [('',)])
        self.assertEqual(result.stdout, '')

    def test_parent_log_directory_sets_the_default_transcript_path(self):
        state = self.directory / 'parent-state'
        state.mkdir()
        self.sql('INSERT INTO log_files(session,log) VALUES(?,?)', ('parent', str(state / 'parent.native.jsonl')))
        row = json.loads(self.recruit('with-parent-log').stdout)
        self.assert_receiver(row, 'codex', 'gpt-6.1-sol', state)

    def test_default_endpoint_matches_explicit_receiver_registration(self):
        row = json.loads(self.recruit('receiver-comparison').stdout)
        expected = row['endpointArgv']
        self.sql("UPDATE sessions SET endpoint='' WHERE id='receiver-comparison'")
        self.call(self.db, 'register-receiver', row['id'], self.bin / 'codex', expected[-1])
        self.assertEqual(self.session(row['id'])['endpointArgv'], expected)

    def test_parent_receiver_log_supplies_the_directory_before_first_turn(self):
        state = self.directory / 'parent-receiver-state'
        state.mkdir()
        endpoint = [str(self.exe), str(self.db), 'receive', 'parent', str(self.bin / 'codex'),
                    '', '', '', str(state / 'parent.native.jsonl')]
        self.sql('UPDATE sessions SET endpoint=? WHERE id=?', (json.dumps(endpoint), 'parent'))
        row = json.loads(self.recruit('with-parent-receiver').stdout)
        self.assert_receiver(row, 'codex', 'gpt-6.1-sol', state)


if __name__ == '__main__':
    unittest.main()
