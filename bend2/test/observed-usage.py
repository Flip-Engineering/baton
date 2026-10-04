"""Check the observed-usage read over recorded OMP conversation fixtures."""
import json
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


def record(identity, usage, provider='deepseek', model='deepseek-flash', api='openai-completions'):
    return {'type': 'message', 'id': 'r' + identity,
            'message': {'role': 'assistant', 'provider': provider, 'model': model,
                        'api': api, 'responseId': identity, 'usage': usage}}


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

    def write(self, records, name='stamp_native-1.jsonl'):
        path = self.sessions / name
        path.write_text(''.join(json.dumps(entry) + '\n' for entry in records))
        return path

    def read(self, session='reader'):
        result = self.call('observed-usage', session)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def expected(self, **values):
        answer = {'session': 'reader', 'harness': 'omp', 'native': 'native-1',
                  'source': str(self.source), 'shape': 'message-usage',
                  'records': 0, 'observations': 0, 'duplicates': 0, 'conflicts': 0,
                  'routes': [], 'absent': ['reasoningTokens', 'cost'], 'invalid': []}
        answer.update(values)
        return answer

    def test_per_message_records_sum_under_the_recorded_contract(self):
        self.write([record('m1', usage(10, 2, 1, 0, cost=(0.5, 0.25, 0.125, 0, 0.875))),
                    record('m2', usage(4, 8, 0, 1, cost=(0.125, 0.25, 0, 0.0625, 0.4375)))])
        self.assertEqual(self.read(), self.expected(
            records=2, observations=2,
            routes=[{'provider': 'deepseek', 'model': 'deepseek-flash',
                     'api': 'openai-completions', 'observations': 2}],
            observed={'input': 14, 'output': 10, 'cacheRead': 1, 'cacheWrite': 1, 'totalTokens': 26},
            cost={'input': 0.625, 'output': 0.5, 'cacheRead': 0.125, 'cacheWrite': 0.0625,
                  'total': 1.3125},
            absent=['reasoningTokens']))

    def test_independent_records_that_only_grow_and_then_reset_are_all_counted(self):
        self.write([record('m1', usage(10, 0, 0, 0)), record('m2', usage(20, 0, 0, 0)),
                    record('m3', usage(11, 0, 0, 0))])
        self.assertEqual(self.read(), self.expected(
            records=3, observations=3,
            routes=[{'provider': 'deepseek', 'model': 'deepseek-flash',
                     'api': 'openai-completions', 'observations': 3}],
            observed={'input': 41, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 41}))

    def test_increasing_records_are_message_usage_and_never_refused(self):
        self.write([record('m1', usage(10, 0, 0, 0)), record('m2', usage(20, 0, 0, 0)),
                    record('m3', usage(30, 0, 0, 0))])
        answer = self.read()
        self.assertEqual(answer['shape'], 'message-usage')
        self.assertEqual(answer['observed']['input'], 60)
        self.assertEqual(answer['observations'], 3)

    def test_a_conversation_with_no_usage_record_is_unavailable(self):
        self.write([{'type': 'session', 'id': 'native-1'},
                    {'type': 'message', 'id': 'u1', 'message': {'role': 'user', 'content': []}}])
        self.assertEqual(self.read(), self.expected(shape='unavailable', absent=[]))

    def test_zero_cost_components_are_preserved(self):
        self.write([record('m1', usage(3, 1, 0, 0, cost=(0, 0, 0, 0, 0)),
                           provider='kimi-code', model='k3', api='anthropic-messages')])
        self.assertEqual(self.read(), self.expected(
            records=1, observations=1,
            routes=[{'provider': 'kimi-code', 'model': 'k3', 'api': 'anthropic-messages',
                     'observations': 1}],
            observed={'input': 3, 'output': 1, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 4},
            cost={'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0},
            absent=['reasoningTokens']))

    def test_a_repeated_identical_record_counts_once(self):
        self.write([record('m1', usage(10, 2, 0, 0)), record('m1', usage(10, 2, 0, 0)),
                    record('m2', usage(4, 0, 0, 0))])
        answer = self.read()
        self.assertEqual(answer['records'], 3)
        self.assertEqual(answer['observations'], 2)
        self.assertEqual(answer['duplicates'], 1)
        self.assertEqual(answer['conflicts'], 0)
        self.assertEqual(answer['observed']['input'], 14)
        self.assertNotIn('cost', answer)

    def test_a_changed_repeat_is_a_conflict_and_keeps_the_first_record(self):
        self.write([record('m1', usage(10, 2, 0, 0)), record('m1', usage(11, 2, 0, 0))])
        answer = self.read()
        self.assertEqual((answer['records'], answer['observations'], answer['duplicates'],
                          answer['conflicts']), (2, 1, 1, 1))
        self.assertEqual(answer['observed']['input'], 10)

    def test_a_component_the_source_does_not_state_throughout_is_absent(self):
        self.write([record('m1', usage(10, 2, 0, 0, reasoning=5)), record('m2', usage(4, 0, 0, 0))])
        answer = self.read()
        self.assertEqual(answer['absent'], ['reasoningTokens', 'cost'])
        self.assertNotIn('reasoningTokens', answer['observed'])

    def test_a_component_stated_without_a_number_is_invalid_and_not_summed(self):
        self.write([record('m1', {'input': '12', 'output': 2, 'cacheRead': 0, 'cacheWrite': 0,
                                  'totalTokens': 14})])
        answer = self.read()
        self.assertEqual(answer['invalid'], ['input'])
        self.assertEqual(answer['absent'], ['input', 'reasoningTokens', 'cost'])
        self.assertEqual(answer['observed'], {'output': 2, 'cacheRead': 0, 'cacheWrite': 0,
                                              'totalTokens': 14})

    def test_a_route_without_a_recorded_file_is_unavailable(self):
        self.source.unlink(missing_ok=True)
        self.assertEqual(self.read(), self.expected(shape='unavailable', source='', absent=[]))

    def test_an_unregistered_session_is_refused(self):
        result = self.call('observed-usage', 'missing-player')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertIn('not registered', result.stderr)

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
