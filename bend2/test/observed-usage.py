"""Check the observed-usage read over recorded OMP conversation fixtures."""
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


def header(native='native-1'):
    return {'type': 'session', 'id': native}


def record(identity, usage, provider='deepseek', model='deepseek-flash',
           api='openai-completions', response=None, kind='message', role='assistant'):
    return {'type': kind, 'id': identity,
            'message': {'role': role, 'provider': provider, 'model': model, 'api': api,
                        'responseId': response or ('msg_' + identity), 'usage': usage}}


def usage(input_, output, cache_read, cache_write, reasoning=None, cost=None):
    value = {'input': input_, 'output': output, 'cacheRead': cache_read, 'cacheWrite': cache_write,
             'totalTokens': input_ + output + cache_read + cache_write}
    if reasoning is not None:
        value['reasoningTokens'] = reasoning
    if cost is not None:
        value['cost'] = dict(zip(('input', 'output', 'cacheRead', 'cacheWrite', 'total'), cost))
    return value


class ObservedUsage(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.call('attach', 'reader', 'omp', 'native-1', '')
        self.sessions = self.directory / 'state.db.root-sessions'
        self.sessions.mkdir(parents=True, exist_ok=True)
        self.source = self.sessions / 'stamp_native-1.jsonl'

    def call(self, *args):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)],
                              text=True, capture_output=True)

    def write(self, records, name='stamp_native-1.jsonl', directory=None, with_header=True):
        path = (directory or self.sessions) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = ([header()] if with_header else []) + list(records)
        path.write_text(''.join(json.dumps(entry) + '\n' if isinstance(entry, dict) else entry + '\n'
                                for entry in rows))
        return path

    def models(self, session='reader'):
        result = self.call('models', session)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def read(self, session='reader'):
        result = self.call('observed-usage', session)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def refused(self, session='reader'):
        result = self.call('observed-usage', session)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')
        return result.stderr

    def expected(self, **values):
        answer = {'session': 'reader', 'harness': 'omp', 'native': 'native-1',
                  'source': str(self.source), 'shape': 'message-usage',
                  'records': 0, 'observations': 0, 'duplicates': 0, 'conflicts': 0,
                  'malformed': 0, 'routes': [], 'absent': [], 'invalid': [],
                  'providerUsage': {'state': 'unknown', 'harness': 'omp',
                                    'observedAt': None, 'command': '',
                                    'argv': ['usage', '--json'],
                                    'condition': 'noRecordedHarnessCommand'}}
        answer.update(values)
        return answer

    def provider_command(self, body, exit_code=0, identity_prefix=False):
        workspace = self.directory / 'provider workspace'
        workspace.mkdir()
        program = workspace / 'provider fixture'
        program.write_text('#!' + sys.executable + '\n'
                           'import json, pathlib, sys\n'
                           "pathlib.Path('queried.json').write_text(json.dumps({'argv': sys.argv[1:], 'cwd': str(pathlib.Path.cwd())}))\n"
                           'print(' + repr(body) + ', flush=True)\n'
                           'sys.exit(' + repr(exit_code) + ')\n')
        program.chmod(0o755)
        command = './provider fixture'
        endpoint = [str(EXE), str(self.db), 'receive', 'reader', command,
                    '', '', '', str(self.directory / 'native.jsonl')]
        if identity_prefix:
            endpoint = ['node', 'identity.mjs', 'launch', '--registry', 'series.json',
                        '--model-key', 'fixture', '--', *endpoint]
        connected = self.call('connect', 'reader', 'native-1', json.dumps(endpoint))
        self.assertEqual(connected.returncode, 0, connected.stderr)
        with sqlite3.connect(self.db) as database:
            database.execute('UPDATE sessions SET workspace=? WHERE id=?',
                             (str(workspace), 'reader'))
        return workspace, command

    def test_provider_query_preserves_opencode_go_facts_and_recorded_workspace(self):
        self.write([])
        observation = {'generatedAt': 1791442800000,
                       'reports': [{'provider': 'opencode-go', 'fetchedAt': 1791442800000,
                                    'limits': [{'used': 100, 'limit': 100}],
                                    'metadata': {'source': 'provider'}}],
                       'accountsWithoutUsage': [{'provider': 'other-provider'}],
                       'disabledCredentials': [], 'capacity': {'additionalFact': 'retained'},
                       'unreportedScope': None}
        workspace, command = self.provider_command(json.dumps(observation), identity_prefix=True)
        status = self.call('status')
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertFalse((workspace / 'queried.json').exists())
        answer = self.read()
        provider = answer['providerUsage']
        self.assertEqual(provider['state'], 'reported')
        self.assertEqual(provider['answer'], observation)
        self.assertEqual(provider['command'], command)
        self.assertGreater(provider['observedAt'], 0)
        self.assertEqual(json.loads((workspace / 'queried.json').read_text()),
                         {'argv': ['usage', '--json'], 'cwd': str(workspace)})
        self.assertEqual(answer['observations'], 0)
        self.assertNotIn('observed', answer)

    def test_provider_nonzero_exit_preserves_process_status_and_output(self):
        self.write([])
        self.provider_command('Provider returned an authentication failure.', exit_code=7)
        provider = self.read()['providerUsage']
        self.assertEqual(provider['state'], 'unknown')
        self.assertEqual(provider['condition'], 'usageCommandFailed')
        self.assertEqual(provider['process'], {'status': 'exit', 'code': 7})
        self.assertIn('authentication failure', provider['stdout'])

    def test_provider_spawn_failure_preserves_actual_errno(self):
        self.write([])
        workspace, _ = self.provider_command('{}')
        (workspace / 'provider fixture').unlink()
        provider = self.read()['providerUsage']
        self.assertEqual(provider['state'], 'unknown')
        self.assertEqual(provider['condition'], 'usageCommandHostFailure')
        self.assertEqual(provider['code'], 2)

    def test_provider_malformed_json_keeps_output_and_conversation_projection(self):
        self.write([record('m1', usage(10, 2, 0, 0))])
        self.provider_command('Actual non-JSON provider response')
        answer = self.read()
        self.assertEqual(answer['observed']['input'], 10)
        self.assertEqual(answer['providerUsage']['state'], 'unknown')
        self.assertEqual(answer['providerUsage']['condition'], 'malformedUsageJson')
        self.assertIn('Actual non-JSON provider response', answer['providerUsage']['detail'])

    def test_models_runs_the_recorded_omp_catalog_in_its_workspace_and_keeps_json(self):
        catalog = {'models': [{'provider': 'fixture-provider', 'selector': 'fixture/model',
                               'metadata': {'context': 8192, 'extra': ['kept', None]}}],
                   'other': {'provider-specific': True}}
        workspace, command = self.provider_command(json.dumps(catalog), identity_prefix=True)
        answer = self.models()
        self.assertEqual(answer['state'], 'reported')
        self.assertEqual(answer['harness'], 'omp')
        self.assertEqual(answer['command'], command)
        self.assertEqual(answer['argv'], ['models', '--json'])
        self.assertEqual(answer['workspace'], str(workspace))
        self.assertEqual(answer['response'], catalog)
        self.assertEqual(answer['raw'], json.dumps(catalog) + '\n')
        self.assertEqual(json.loads((workspace / 'queried.json').read_text()),
                         {'argv': ['models', '--json'], 'cwd': str(workspace)})

    def test_models_uses_the_recorded_codex_catalog_command(self):
        catalog = {'models': [{'slug': 'provider-model', 'metadata': {'retained': None}}]}
        workspace, _ = self.provider_command(json.dumps(catalog))
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET harness='codex' WHERE id='reader'")
        answer = self.models()
        self.assertEqual(answer['response'], catalog)
        self.assertEqual(json.loads((workspace / 'queried.json').read_text()),
                         {'argv': ['debug', 'models'], 'cwd': str(workspace)})

    def test_models_keeps_unparseable_catalog_bytes(self):
        raw = 'provider returned text that is not JSON'
        workspace, command = self.provider_command(raw)
        answer = self.models()
        self.assertEqual(answer['state'], 'unknown')
        self.assertEqual(answer['reason'], 'providerOutputNotJson')
        self.assertEqual(answer['raw'], raw + '\n')
        self.assertEqual(answer['command'], command)
        self.assertEqual(json.loads((workspace / 'queried.json').read_text()),
                         {'argv': ['models', '--json'], 'cwd': str(workspace)})

    def test_models_keeps_muse_profile_text_without_claiming_model_existence(self):
        profile = 'model: requested-but-unverified\nprovider: fixture\nprofile: retained text'
        workspace, command = self.provider_command(profile)
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET harness='muse', model='requested-but-unverified' WHERE id='reader'")
        answer = self.models()
        self.assertEqual(answer['state'], 'reported')
        self.assertEqual(answer['harness'], 'muse')
        self.assertEqual(answer['command'], command)
        self.assertEqual(answer['argv'], ['model-profile', 'show', 'requested-but-unverified'])
        self.assertEqual(answer['requestedModel'], 'requested-but-unverified')
        self.assertEqual(answer['modelExistence'], 'unknown')
        self.assertEqual(answer['profileText'], profile + '\n')
        self.assertEqual(json.loads((workspace / 'queried.json').read_text()),
                         {'argv': ['model-profile', 'show', 'requested-but-unverified'],
                          'cwd': str(workspace)})

    def test_models_reports_provider_failure_and_unknown_routes_without_gating(self):
        workspace, command = self.provider_command('provider says unavailable', exit_code=7)
        answer = self.models()
        self.assertEqual(answer['state'], 'unknown')
        self.assertEqual(answer['command'], command)
        self.assertEqual(answer['process'], {'status': 'exit', 'code': 7})
        self.assertEqual(answer['raw'], 'provider says unavailable\n')
        marker = workspace / 'queried.json'
        marker.unlink()
        (workspace / 'provider fixture').unlink()
        host_failure = self.models()
        self.assertEqual(host_failure['state'], 'unknown')
        self.assertEqual(host_failure['reason'], 'providerCommandHostFailure')
        self.assertEqual(host_failure['code'], 2)
        self.assertFalse(marker.exists())
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET harness='claude-code' WHERE id='reader'")
        unsupported = self.models()
        self.assertEqual(unsupported['state'], 'unknown')
        self.assertEqual(unsupported['reason'], 'unsupportedHarness')
        self.assertFalse(marker.exists())
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET harness='omp',endpoint='[]' WHERE id='reader'")
        missing = self.models()
        self.assertEqual(missing['state'], 'unknown')
        self.assertEqual(missing['reason'], 'noRecordedHarnessCommand')

    def test_unsupported_provider_harness_does_not_run_a_usage_command(self):
        self.write([])
        workspace, _ = self.provider_command('{}')
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET harness='codex' WHERE id='reader'")
        provider = self.read()['providerUsage']
        self.assertEqual(provider['state'], 'unknown')
        self.assertEqual(provider['condition'], 'unsupportedHarness')
        self.assertFalse((workspace / 'queried.json').exists())

    def costing_absent(self, *extra):
        """Absent components for a fixture that states no cost and no reasoning."""
        return ['reasoningTokens', *extra, 'cost.input', 'cost.output', 'cost.cacheRead',
                'cost.cacheWrite', 'cost.total']

    def test_per_message_records_sum_under_the_recorded_contract(self):
        self.write([record('m1', usage(10, 2, 1, 0, reasoning=3, cost=(0.5, 0.25, 0.125, 0, 0.875))),
                    record('m2', usage(4, 8, 0, 1, cost=(0.125, 0.25, 0, 0.0625, 0.4375)))])
        self.assertEqual(self.read(), self.expected(
            records=2, observations=2, absent=['reasoningTokens'],
            routes=[{'provider': 'deepseek', 'model': 'deepseek-flash',
                     'api': 'openai-completions', 'observations': 2}],
            observed={'input': 14, 'output': 10, 'cacheRead': 1, 'cacheWrite': 1, 'totalTokens': 26},
            cost={'input': 0.625, 'output': 0.5, 'cacheRead': 0.125, 'cacheWrite': 0.0625,
                  'total': 1.3125}))

    def test_independent_records_that_only_grow_and_then_reset_are_all_counted(self):
        self.write([record('m1', usage(10, 0, 0, 0)), record('m2', usage(20, 0, 0, 0)),
                    record('m3', usage(11, 0, 0, 0))])
        self.assertEqual(self.read(), self.expected(
            records=3, observations=3, observed={'input': 41, 'output': 0, 'cacheRead': 0,
                                                 'cacheWrite': 0, 'totalTokens': 41},
            routes=[{'provider': 'deepseek', 'model': 'deepseek-flash',
                     'api': 'openai-completions', 'observations': 3}],
            absent=self.costing_absent()))

    def test_increasing_records_are_message_usage_and_never_refused(self):
        self.write([record('m1', usage(10, 0, 0, 0)), record('m2', usage(20, 0, 0, 0)),
                    record('m3', usage(30, 0, 0, 0))])
        answer = self.read()
        self.assertEqual(answer['shape'], 'message-usage')
        self.assertEqual(answer['observed']['input'], 60)
        self.assertEqual(answer['observations'], 3)

    def test_only_message_entries_with_object_usage_are_summed(self):
        self.write([record('m1', usage(10, 2, 0, 0)),
                    record('c1', {'input': 99}, kind='custom'),
                    record('u1', {'input': 5}, role='user'),
                    {'type': 'message', 'id': 'bad', 'message': {'role': 'assistant', 'usage': 'twelve'}}])
        self.assertEqual(self.read(), self.expected(
            records=1, observations=1, observed={'input': 10, 'output': 2, 'cacheRead': 0,
                                                 'cacheWrite': 0, 'totalTokens': 12},
            routes=[{'provider': 'deepseek', 'model': 'deepseek-flash',
                     'api': 'openai-completions', 'observations': 1}],
            absent=self.costing_absent()))

    def test_a_truncated_tail_is_reported_and_no_sum_is_projected(self):
        self.write([record('m1', usage(10, 2, 0, 0)), '{"type":"message","id":"m2","mess'])
        answer = self.read()
        self.assertEqual(answer['malformed'], 1)
        self.assertEqual((answer['records'], answer['observations']), (1, 1))
        self.assertNotIn('observed', answer)
        self.assertNotIn('cost', answer)
        self.assertEqual(answer['invalid'], [])
        untouched = self.write([record('m1', usage(10, 2, 0, 0))])
        self.assertEqual(self.read()['malformed'], 0)
        self.assertEqual(self.read()['observed']['input'], 10)
        self.assertEqual(untouched, self.source)

    def test_two_persisted_ids_with_the_same_response_are_two_observations(self):
        self.write([record('a1', usage(10, 2, 0, 0), response='msg_same'),
                    record('a2', usage(4, 0, 0, 0), response='msg_same')])
        answer = self.read()
        self.assertEqual((answer['records'], answer['observations'], answer['duplicates'],
                          answer['conflicts']), (2, 2, 0, 0))
        self.assertEqual(answer['observed']['input'], 14)

    def test_a_repeated_identity_that_changed_its_route_is_a_conflict(self):
        self.write([record('m1', usage(10, 2, 0, 0), provider='zai', model='glm-5.3-flash'),
                    record('m1', usage(10, 2, 0, 0), provider='kimi-code', model='k3')])
        answer = self.read()
        self.assertEqual((answer['records'], answer['observations'], answer['duplicates'],
                          answer['conflicts']), (2, 1, 1, 1))
        self.assertEqual(answer['routes'], [{'provider': 'zai', 'model': 'glm-5.3-flash',
                                             'api': 'openai-completions', 'observations': 1}])
        self.assertNotIn('observed', answer)
        self.assertNotIn('cost', answer)

    def test_a_conversation_with_no_usage_record_is_unavailable(self):
        self.write([{'type': 'message', 'id': 'u1', 'message': {'role': 'user', 'content': []}}])
        self.assertEqual(self.read(), self.expected(shape='unavailable'))

    def test_zero_cost_components_are_preserved(self):
        self.write([record('m1', usage(3, 1, 0, 0, cost=(0, 0, 0, 0, 0)),
                           provider='kimi-code', model='k3', api='anthropic-messages')])
        self.assertEqual(self.read(), self.expected(
            records=1, observations=1, absent=['reasoningTokens'],
            routes=[{'provider': 'kimi-code', 'model': 'k3', 'api': 'anthropic-messages',
                     'observations': 1}],
            observed={'input': 3, 'output': 1, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 4},
            cost={'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}))

    def test_a_repeated_identical_record_counts_once(self):
        self.write([record('m1', usage(10, 2, 0, 0)), record('m1', usage(10, 2, 0, 0)),
                    record('m2', usage(4, 0, 0, 0))])
        answer = self.read()
        self.assertEqual((answer['records'], answer['observations'], answer['duplicates'],
                          answer['conflicts']), (3, 2, 1, 0))
        self.assertEqual(answer['observed']['input'], 14)
        self.assertNotIn('cost', answer)

    def test_a_component_the_source_does_not_state_throughout_is_absent(self):
        self.write([record('m1', usage(10, 2, 0, 0, reasoning=5)), record('m2', usage(4, 0, 0, 0))])
        answer = self.read()
        self.assertEqual(answer['absent'], self.costing_absent())
        self.assertNotIn('reasoningTokens', answer['observed'])

    def test_a_component_stated_without_a_number_is_invalid_and_not_summed(self):
        self.write([record('m1', {'input': '12', 'output': 2, 'cacheRead': 0, 'cacheWrite': 0,
                                  'totalTokens': 14})])
        answer = self.read()
        self.assertEqual(answer['invalid'], ['input'])
        self.assertEqual(answer['absent'], ['input'] + self.costing_absent())
        self.assertEqual(answer['observed'], {'output': 2, 'cacheRead': 0, 'cacheWrite': 0,
                                              'totalTokens': 14})

    def test_a_non_numeric_cost_component_is_invalid_and_not_summed(self):
        self.write([record('m1', {'input': 1, 'cost': {'total': 1, 'output': 'bad'}})])
        answer = self.read()
        self.assertEqual(answer['invalid'], ['cost.output'])
        self.assertEqual(answer['cost'], {'total': 1})
        self.assertIn('cost.output', answer['absent'])

    def test_a_lone_reasoning_component_is_preserved(self):
        self.write([record('m1', {'reasoningTokens': 5})])
        self.assertEqual(self.read()['observed'], {'reasoningTokens': 5})

    def test_a_lone_cost_component_is_preserved(self):
        self.write([record('m1', {'cost': {'input': 0.5}})])
        self.assertEqual(self.read()['cost'], {'input': 0.5})

    def test_a_route_without_a_recorded_file_is_unavailable(self):
        self.source.unlink(missing_ok=True)
        self.assertEqual(self.read(), self.expected(shape='unavailable', source=''))

    def test_the_alternate_store_is_used_when_only_it_records_the_conversation(self):
        alternate = self.directory / 'state.db.sessions'
        path = self.write([record('m1', usage(10, 2, 0, 0))], directory=alternate)
        self.source.unlink(missing_ok=True)
        answer = self.read()
        self.assertEqual(answer['source'], str(path))
        self.assertEqual(answer['observed']['input'], 10)

    def test_two_stores_with_distinct_matching_files_are_refused(self):
        self.write([record('m1', usage(10, 2, 0, 0))])
        alternate = self.write([record('m9', usage(99, 0, 0, 0))],
                               directory=self.directory / 'state.db.sessions')
        stderr = self.refused()
        self.assertIn(str(self.source), stderr)
        self.assertIn(str(alternate), stderr)
        self.assertIn('native-1', stderr)

    def test_a_file_that_records_another_native_identity_is_refused(self):
        self.write([record('m1', usage(10, 2, 0, 0))], with_header=False)
        self.source.write_text(json.dumps(header('native-other')) + '\n'
                               + self.source.read_text())
        stderr = self.refused()
        self.assertIn('native-other', stderr)
        self.assertIn('native-1', stderr)

    def test_a_file_without_a_session_header_is_refused(self):
        self.write([record('m1', usage(10, 2, 0, 0))], with_header=False)
        self.assertIn('no recorded session header', self.refused())

    def test_an_unregistered_session_is_refused(self):
        self.assertIn('not registered', self.refused('missing-player'))

    def test_the_read_records_nothing(self):
        self.write([record('m1', usage(10, 2, 0, 0))])
        before = self.source.read_text()
        first = self.read()
        self.assertEqual(self.read(), first)
        self.assertEqual(self.source.read_text(), before)
        sessions = subprocess.run(['sqlite3', str(self.db),
                                   'SELECT count(*) FROM sessions; SELECT count(*) FROM messages;'],
                                  text=True, capture_output=True, check=True)
        self.assertEqual(sessions.stdout, '1\n0\n')


if __name__ == '__main__':
    unittest.main()
