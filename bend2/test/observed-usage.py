"""Check observed usage against recorded conversations and controlled usage children."""
import json
import pathlib
import sqlite3
import sys
import time
import subprocess
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
                  'providerUsage': {'availability': 'unknown', 'observationState': 'unknown',
                                    'condition': 'unavailableConfiguredCommand'}}
        answer.update(values)
        return answer

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


class ProviderUsage(unittest.TestCase):
    call = ObservedUsage.call
    read = ObservedUsage.read
    write = ObservedUsage.write

    def setUp(self):
        ObservedUsage.setUp(self)
        self.workspace = self.directory / 'recorded workspace'
        self.workspace.mkdir()
        self.child = self.directory / 'configured omp'
        self.child.write_text('#!' + sys.executable + '\n' + '''import json, os, pathlib, signal, sys
root = pathlib.Path(__file__).parent
with (root / 'calls.jsonl').open('a') as calls:
    calls.write(json.dumps({'argv': sys.argv, 'cwd': os.getcwd()}) + '\\n')
answer = json.loads((root / 'child-answer.json').read_text())
sys.stdout.write(answer['stdout'])
sys.stderr.write(answer['stderr'])
sys.stdout.flush()
sys.stderr.flush()
if answer.get('signal'):
    os.kill(os.getpid(), answer['signal'])
sys.exit(answer['code'])
''')
        self.child.chmod(0o700)
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE sessions SET model=?,workspace=? WHERE id='reader'",
                               ('kimi-code/k3', str(self.workspace)))
        result = self.call('receiver', 'reader', self.child, self.directory / 'receiver.log')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.write([])
        self.answer(self.document())

    def document(self, reports=None):
        return {'generatedAt': int(time.time() * 1000), 'reports': reports or [],
                'accountsWithoutUsage': [], 'disabledCredentials': [], 'capacity': {}}

    def report(self, fetched=None, reset=None):
        now = int(time.time() * 1000)
        return {'provider': 'kimi-code', 'fetchedAt': now - 5000 if fetched is None else fetched,
                'metadata': {'endpoint': 'https://api.kimi.com/coding/v1/usages'},
                'limits': [{'id': 'weekly', 'used': 100, 'limit': 100, 'remaining': 0,
                            'window': {'resetsAt': now + 86400000 if reset is None else reset}}]}

    def answer(self, value, code=0, stderr='', signal=None):
        stdout = json.dumps(value) + '\n' if isinstance(value, dict) else value
        (self.directory / 'child-answer.json').write_text(json.dumps(
            {'stdout': stdout, 'stderr': stderr, 'code': code, 'signal': signal}))
        return stdout

    def calls(self):
        path = self.directory / 'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def account(self):
        return self.read()['providerUsage']

    def update(self, column, value):
        self.assertIn(column, ('endpoint', 'harness', 'model', 'workspace'))
        with sqlite3.connect(self.db) as connection:
            connection.execute(f"UPDATE sessions SET {column}=? WHERE id='reader'", (value,))

    def test_reports_keep_source_windows_and_original_observation_time(self):
        report = self.report()
        document = self.document([report])
        stdout = self.answer(document, stderr='usage notice\n')
        result = self.account()
        self.assertEqual(self.calls(), [{'argv': [str(self.child), 'usage', '--json', '--provider',
                                                  'kimi-code'], 'cwd': str(self.workspace)}])
        self.assertEqual(result['availability'], 'unknown')
        self.assertEqual(result['observationState'], 'reported')
        self.assertEqual(result['condition'], 'cacheFreshnessUnspecified')
        self.assertEqual(result['generatedAt'], document['generatedAt'])
        self.assertGreaterEqual(result['observedAt'], report['fetchedAt'])
        account, = result['accounts']
        self.assertEqual(account['fetchedAt'], report['fetchedAt'])
        self.assertEqual(account['report'], report)
        self.assertEqual(account['source'], report['metadata']['endpoint'])
        self.assertEqual(account['freshness'], 'unknown')
        self.assertEqual(account['availability'], 'unknown')
        self.assertEqual(account['windows'], [{'reported': report['limits'][0],
                                              'availability': 'unknown', 'observationState': 'reported'}])
        self.assertEqual(result['source']['providerFilter'], 'outputOnly')
        self.assertEqual(result['source']['accountSelection'], 'configuredHarnessPool')
        self.assertEqual(result['process'], {'status': 'exit', 'code': 0, 'stdout': stdout,
                                             'stderr': 'usage notice\n'})

    def test_expired_quota_and_conversation_totals_do_not_assert_current_exhaustion(self):
        self.write([record('large', usage(9000000, 9000000, 0, 0)),
                    {'type': 'error', 'error': 'old quota exceeded'}])
        report = self.report(fetched=1000, reset=2000)
        self.answer(self.document([report]))
        result = self.read()
        self.assertEqual(result['observed']['totalTokens'], 18000000)
        account = result['providerUsage']['accounts'][0]
        self.assertEqual(account['fetchedAt'], 1000)
        self.assertEqual(account['availability'], 'unknown')
        self.assertEqual(account['windows'][0]['observationState'], 'expired')
        self.assertEqual(account['windows'][0]['availability'], 'unknown')

    def test_missing_and_disabled_accounts_remain_unknown(self):
        document = self.document()
        document['accountsWithoutUsage'] = [{'provider': 'kimi-code', 'reason': 'unsupported'}]
        document['disabledCredentials'] = [{'provider': 'kimi-code', 'reason': 'expired'}]
        self.answer(document)
        result = self.account()
        self.assertEqual(result['condition'], 'noProviderReport')
        self.assertEqual(result['observationState'], 'unknown')
        self.assertEqual(result['availability'], 'unknown')
        self.assertEqual(result['accounts'], [])
        self.assertEqual(result['accountsWithoutUsage'], document['accountsWithoutUsage'])
        self.assertEqual(result['disabledCredentials'], document['disabledCredentials'])

    def test_future_or_missing_report_timestamp_is_unknown(self):
        for fetched in (None, int(time.time() * 1000) + 86400000):
            with self.subTest(fetched=fetched):
                report = self.report()
                report['fetchedAt'] = fetched
                self.answer(self.document([report]))
                result = self.account()
                self.assertEqual(result['observationState'], 'unknown')
                self.assertEqual(result['accounts'][0]['observationState'], 'unknown')
                self.assertEqual(result['availability'], 'unknown')

    def test_malformed_nested_reports_do_not_become_account_observations(self):
        self.answer(self.document(['broken', 42, None, {'provider': 'other'}]))
        result = self.account()
        self.assertEqual(result['accounts'], [])
        self.assertEqual(result['condition'], 'noProviderReport')

    def test_child_failures_preserve_status_and_both_streams(self):
        for code, signal, status in ((17, None, 'exit'), (0, 15, 'signal')):
            with self.subTest(status=status):
                stdout = self.answer('quota\n\n', code=code, stderr='failure\n', signal=signal)
                result = self.account()
                self.assertEqual(result['availability'], 'unknown')
                self.assertEqual(result['observationState'], 'unknown')
                self.assertEqual(result['process'], {'status': status, 'code': signal or code,
                                                     'stdout': stdout, 'stderr': 'failure\n'})

    def test_malformed_json_and_unsupported_shape_preserve_child_output(self):
        for text, condition in (('{bad\n', 'malformedUsageJson'),
                                ('{}\n', 'unsupportedUsageShape')):
            with self.subTest(condition=condition):
                self.answer(text, stderr='notice\n')
                result = self.account()
                self.assertEqual(result['condition'], condition)
                self.assertEqual(result['availability'], 'unknown')
                self.assertEqual(result['process']['stdout'], text)
                self.assertEqual(result['process']['stderr'], 'notice\n')

    def test_unsupported_harness_does_not_run_usage(self):
        self.update('harness', 'codex')
        self.assertEqual(self.account(), {'availability': 'unknown', 'observationState': 'unknown',
                                          'condition': 'unsupportedHarness'})
        self.assertEqual(self.calls(), [])

    def test_absent_malformed_and_foreign_routes_do_not_run_usage(self):
        with sqlite3.connect(self.db) as connection:
            saved, = connection.execute("SELECT endpoint FROM sessions WHERE id='reader'").fetchone()
        foreign = json.loads(saved)
        foreign[9 if len(foreign) == 18 else 1 if len(foreign) == 9 else 9] = '/foreign.db'
        for endpoint in ('', '{bad', json.dumps(foreign)):
            with self.subTest(endpoint=endpoint):
                self.update('endpoint', endpoint)
                self.assertEqual(self.account()['condition'], 'unavailableConfiguredCommand')
                self.assertEqual(self.calls(), [])

    def test_configured_route_uses_its_command_and_requires_assignment_match(self):
        endpoint = ['node', '/recorded/helper', 'launch', '--registry', '/recorded/registry',
                    '--model-key', 'kimi-code/k3', '--', str(EXE), str(self.db.resolve()),
                    'receive-configured', 'reader', '3', 'omp', 'kimi-code/k3', '',
                    str(self.child), str(self.directory / 'receiver.log')]
        self.update('endpoint', json.dumps(endpoint))
        self.assertEqual(self.account()['condition'], 'noProviderReport')
        self.assertEqual(len(self.calls()), 1)
        endpoint[14] = 'kimi-code/other'
        self.update('endpoint', json.dumps(endpoint))
        self.assertEqual(self.account()['condition'], 'unavailableConfiguredCommand')
        self.assertEqual(len(self.calls()), 1)

    def test_failed_observation_preserves_session_task_and_operator_stop(self):
        self.answer('quota exceeded\n', code=19, stderr='old quota\n')
        with sqlite3.connect(self.db) as connection:
            connection.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)",
                               ('retained-task', 'reader', 'reader', 'task', 'retain this work'))
        stopped = self.call('stop', 'reader', 'operator-stop', 'explicit stop')
        self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
        with sqlite3.connect(self.db) as connection:
            before = list(connection.iterdump())
        self.assertEqual(self.account()['availability'], 'unknown')
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(list(connection.iterdump()), before)
        self.assertEqual(self.source.read_text(), json.dumps(header()) + '\n')

    def test_missing_executable_retains_failure_as_unknown(self):
        self.child.unlink()
        result = self.account()
        self.assertEqual(result['availability'], 'unknown')
        self.assertEqual(result['observationState'], 'unknown')
        self.assertEqual(self.calls(), [])
        self.assertTrue(result.get('condition') in ('hostFailure', 'usageCommandFailed'), result)


if __name__ == '__main__':
    unittest.main()
