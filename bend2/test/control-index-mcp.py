"""Check MCP compact-reader argument translation and result preservation.

The real adapter calls a recording fixture executable. No coordinator database
is created and no attachment notification is sent. control-index.py covers the
native SQLite selection and read-only effects; these tests check adapter scope,
explicit empty values, invalid combinations and complete native responses.
BATON2_INDEX_MCP selects a candidate or installed adapter for this same test.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
MCP = Path(os.environ.get('BATON2_INDEX_MCP', ROOT / 'bend2/scripts/mcp-conductor.mjs'))
OMITTED = object()

FIXTURE = '''import json
from pathlib import Path
import sys

config = json.loads(Path(__file__).with_suffix('.json').read_text())
with Path(config['calls']).open('a') as calls:
    calls.write(json.dumps(sys.argv[1:]) + '\\n')
sys.stdout.write(config['stdout'])
sys.stderr.write(config['stderr'])
sys.exit(config['code'])
'''


class ControlIndexMcp(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='baton-control-index-mcp-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.database = self.directory / 'absent.db'
        self.calls = self.directory / 'calls.jsonl'
        self.executable = self.directory / 'fixture-coordinator'
        self.executable.write_text('#!' + sys.executable + '\n' + FIXTURE)
        self.executable.chmod(0o755)

    def exchange(self, tool, arguments=OMITTED, *, session='attached',
                 stdout='[]\n', stderr='', code=0):
        self.calls.unlink(missing_ok=True)
        self.executable.with_suffix('.json').write_text(json.dumps({
            'calls': str(self.calls), 'stdout': stdout, 'stderr': stderr, 'code': code,
        }))
        params = {'name': tool}
        if arguments is not OMITTED:
            params['arguments'] = arguments
        requests = [
            {'jsonrpc': '2.0', 'id': 'initialize', 'method': 'initialize', 'params': {}},
            {'jsonrpc': '2.0', 'id': 'tools', 'method': 'tools/list', 'params': {}},
            {'jsonrpc': '2.0', 'id': 'call', 'method': 'tools/call', 'params': params},
        ]
        run = subprocess.run(
            [os.environ.get('NODE', 'node'), str(MCP), str(self.database),
             str(self.executable), '--session', session],
            input=''.join(json.dumps(request) + '\n' for request in requests),
            capture_output=True, text=True,
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        responses = [json.loads(line) for line in run.stdout.splitlines()]
        self.assertEqual([response['id'] for response in responses],
                         ['initialize', 'tools', 'call'])
        for response in responses:
            self.assertNotIn('error', response, response)
        self.advertised = {tool['name']: tool for tool in responses[1]['result']['tools']}
        self.assertFalse(self.database.exists(), 'MCP discovery/call created a database')
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        return responses[2]['result'], calls

    def translated(self, tool, arguments, prefix, options=None, **configuration):
        result, calls = self.exchange(tool, arguments, **configuration)
        self.assertFalse(result.get('isError'), result)
        self.assertEqual(len(calls), 1, 'Read must invoke the native operation once')
        argv = calls[0]
        self.assertEqual(argv[:1 + len(prefix)], [str(self.database), *prefix])
        # The CLI contract permits option permutations. Compare option meaning,
        # preserving explicit empty values and detecting repeated options.
        actual = {}
        tail = iter(argv[1 + len(prefix):])
        for flag in tail:
            self.assertNotIn(flag, actual, 'Adapter repeated an option')
            if flag in ('--index', '--pretty'):
                actual[flag] = True
            else:
                self.assertIn(flag, ('--recipient', '--sender', '--kind', '--state', '--for', '--after-seq', '--through-seq'))
                value = next(tail, OMITTED)
                self.assertIsNot(value, OMITTED, 'Adapter omitted an option value')
                actual[flag] = value
        self.assertEqual(actual, options or {})
        return result

    def test_sequence_bounds_preserve_exact_decimal_argv(self):
        for tool, prefix in [('baton2_pending', ['pending']), ('baton2_inbox', ['inbox', 'attached'])]:
            for lower, upper in [('0', '0'), ('4294967296', '9007199254740993'),
                                 ('9007199254740993', '9223372036854775807')]:
                args = {'index': True, 'afterSeq': lower, 'throughSeq': upper,
                        'sender': '--after-seq', 'kind': '--through-seq', 'state': 'all', 'pretty': True}
                self.translated(tool, args, prefix, {'--index': True, '--after-seq': lower,
                                '--through-seq': upper, '--sender': '--after-seq',
                                '--kind': '--through-seq', '--state': 'all', '--pretty': True})
                properties = self.advertised[tool]['inputSchema']['properties']
                self.assertEqual(properties['afterSeq']['type'], 'string')
                self.assertEqual(properties['throughSeq']['type'], 'string')

    def test_sequence_invalid_bounds_refuse_before_native(self):
        for tool in ('baton2_pending', 'baton2_inbox'):
            for key in ('afterSeq', 'throughSeq'):
                for value in ['', '-1', '+1', '01', ' 1', '1 ', '1\n', '1.0', '1e2',
                              '١', '9223372036854775808',
                              '1234567890123456789012345678901234567890',
                              '1234567890123456789012345678901234567890x', 1, None, True]:
                    with self.subTest(tool=tool, key=key, value=value):
                        result, calls = self.exchange(tool, {'index': True, key: value})
                        self.assertTrue(result.get('isError'), result)
                        self.assertEqual(calls, [])
            for args in [{'afterSeq': '0'}, {'index': False, 'throughSeq': '1'},
                         {'index': True, 'afterSeq': '10', 'throughSeq': '9'}]:
                result, calls = self.exchange(tool, args)
                self.assertTrue(result.get('isError'), result)
                self.assertEqual(calls, [])

    def test_inbox_omission_and_empty_recipient_have_different_scopes(self):
        for session in ('attached', '', "Conductor's 日本語"):
            for arguments, recipient in (({'index': True}, session),
                                          ({'index': True, 'recipient': ''}, ''),
                                          ({'index': True, 'recipient': 'other'}, 'other')):
                with self.subTest(session=session, arguments=arguments):
                    self.translated('baton2_inbox', arguments, ['inbox', recipient],
                                    {'--index': True}, session=session)

    def test_pending_omission_means_all_recipients_and_empty_is_exact(self):
        for arguments, options in (({'index': True}, {'--index': True}),
                                  ({'index': True, 'recipient': ''},
                                   {'--index': True, '--recipient': ''}),
                                  ({'index': True, 'recipient': 'other'},
                                   {'--index': True, '--recipient': 'other'})):
            with self.subTest(arguments=arguments):
                self.translated('baton2_pending', arguments, ['pending'], options,
                                session='must-not-be-injected')

    def test_empty_and_literal_filters_are_forwarded_without_filtering_results(self):
        native = [{'id': 'native-selected', 'sender': 'native-sender',
                   'recipient': 'native-recipient', 'kind': 'native-kind',
                   'seq': 71, 'bodyBytes': 17, 'receiptState': 'acknowledged'}]
        # An intentionally different native result detects adapter-side selection.
        for value in ('', "author's λ %_", '--help'):
            for tool, prefix in (('baton2_inbox', ['inbox', 'attached']),
                                 ('baton2_pending', ['pending'])):
                with self.subTest(tool=tool, value=value):
                    args = {'index': True, 'sender': value, 'kind': value, 'state': 'all', 'pretty': True}
                    result = self.translated(tool, args, prefix,
                                             {'--index': True, '--sender': value,
                                              '--kind': value, '--state': 'all', '--pretty': True},
                                             stdout=json.dumps(native) + '\n')
                    self.assertEqual(json.loads(result['content'][0]['text']), native)

    def test_each_receipt_selection_reaches_native(self):
        for state in ('pending', 'acknowledged', 'all'):
            with self.subTest(state=state):
                self.translated('baton2_pending', {'index': True, 'state': state}, ['pending'],
                                {'--index': True, '--state': state})

    def test_orchestra_preserves_explicit_empty_focus_and_pretty(self):
        self.translated('baton2_orchestra', {'index': True}, ['orchestra'], {'--index': True})
        for session in ('', "Associate's λ"):
            with self.subTest(session=session):
                self.translated('baton2_orchestra', {'index': True, 'session': session, 'pretty': True},
                                ['orchestra'], {'--index': True, '--for': session, '--pretty': True})

    def test_legacy_read_arguments_remain_available(self):
        for tool, prefix in (('baton2_inbox', ['inbox', 'attached']),
                             ('baton2_pending', ['pending']),
                             ('baton2_orchestra', ['orchestra'])):
            for arguments, options in ((OMITTED, {}), ({}, {}),
                                       ({'index': False, 'pretty': False}, {}),
                                       ({'pretty': True}, {'--pretty': True})):
                with self.subTest(tool=tool, arguments=arguments):
                    self.translated(tool, arguments, prefix, options)
        self.translated('baton2_inbox', {'recipient': ''}, ['inbox', ''])

    def test_index_only_combinations_refuse_without_native_invocation(self):
        combinations = [
            ('baton2_inbox', 'sender', ''), ('baton2_inbox', 'kind', 'report'),
            ('baton2_inbox', 'state', 'all'), ('baton2_pending', 'recipient', ''),
            ('baton2_pending', 'sender', 'author'), ('baton2_pending', 'kind', ''),
            ('baton2_pending', 'state', 'pending'), ('baton2_orchestra', 'session', ''),
        ]
        for tool, field, value in combinations:
            for index in (OMITTED, False):
                args = {field: value}
                if index is not OMITTED:
                    args['index'] = index
                with self.subTest(tool=tool, args=args):
                    result, calls = self.exchange(tool, args)
                    self.assertTrue(result.get('isError'), result)
                    self.assertEqual(calls, [], 'Invalid combination reached the native reader')
                    self.assertTrue(result['content'][0]['text'])

    def test_wrong_types_and_unknown_properties_refuse_without_native_invocation(self):
        cases = [
            ('baton2_inbox', {'index': 'true'}),
            ('baton2_inbox', {'index': True, 'recipient': None}),
            ('baton2_inbox', {'index': True, 'sender': []}),
            ('baton2_pending', {'index': 1}),
            ('baton2_pending', {'index': True, 'kind': {}}),
            ('baton2_pending', {'index': True, 'state': 0}),
            ('baton2_pending', {'index': True, 'pretty': 'true'}),
            ('baton2_pending', {'index': True, 'allRecipients': True}),
            ('baton2_orchestra', {'index': True, 'session': False}),
            ('baton2_orchestra', {'index': True, 'sender': 'author'}),
            ('baton2_delivery', {}), ('baton2_delivery', {'id': None}),
            ('baton2_delivery', {'id': 'message', 'index': True}),
            ('baton2_delivery', {'id': 'message', 'pretty': 1}),
        ]
        for tool, args in cases:
            with self.subTest(tool=tool, args=args):
                result, calls = self.exchange(tool, args)
                self.assertTrue(result.get('isError'), result)
                self.assertEqual(calls, [])

    def test_delivery_preserves_complete_acknowledged_body_and_literal_id(self):
        body = 'begin\n' + ('λ 日本語\x00 after NUL\n' * 2048) + 'end'
        native = {'id': "report's λ", 'sender': 'author', 'recipient': 'attached',
                  'kind': 'report', 'body': body, 'receipt': ''}
        for ident in (native['id'], ''):
            with self.subTest(id=ident):
                expected = {**native, 'id': ident}
                result = self.translated('baton2_delivery', {'id': ident, 'pretty': True},
                                         ['delivery', ident], {'--pretty': True},
                                         stdout=json.dumps(expected, ensure_ascii=False, indent=2) + '\n')
                self.assertEqual(json.loads(result['content'][0]['text']), expected)
                self.assertEqual(result['content'][0]['type'], 'text')

    def test_native_structured_failure_and_diagnostics_survive_each_new_read_path(self):
        cases = [
            ('baton2_inbox', {'index': True}, ['inbox', 'attached', '--index']),
            ('baton2_pending', {'index': True}, ['pending', '--index']),
            ('baton2_orchestra', {'index': True, 'session': 'missing'},
             ['orchestra', '--index', '--for', 'missing']),
            ('baton2_delivery', {'id': 'missing'}, ['delivery', 'missing']),
        ]
        refusal = {'error': 'fixture-read-refused', 'condition': 'fixture diagnostic λ',
                   'next': 'inspect the supplied ID', 'subject': 'missing'}
        stdout = json.dumps(refusal, ensure_ascii=False) + '\n'
        stderr = 'native read diagnostic λ\n'
        for tool, args, argv in cases:
            with self.subTest(tool=tool):
                result, calls = self.exchange(tool, args, stdout=stdout, stderr=stderr, code=2)
                self.assertEqual(calls, [[str(self.database), *argv]])
                self.assertTrue(result.get('isError'), result)
                text = result['content'][0]['text']
                prefix, marker, streams = text.partition('\nstdout:\n')
                self.assertTrue(marker, text)
                self.assertIn('\nexit code: 2', prefix)
                actual_stdout, marker, actual_stderr = streams.partition('\nstderr:\n')
                self.assertTrue(marker, text)
                self.assertEqual(actual_stdout, stdout)
                self.assertEqual(json.loads(actual_stdout), refusal)
                self.assertEqual(actual_stderr, stderr)

    def test_discovery_exposes_typed_index_filters_and_delivery(self):
        self.translated('baton2_pending', {}, ['pending'])
        fields = {
            'baton2_inbox': {'recipient': 'string', 'index': 'boolean', 'sender': 'string',
                            'kind': 'string', 'state': 'string', 'pretty': 'boolean'},
            'baton2_pending': {'index': 'boolean', 'recipient': 'string', 'sender': 'string',
                              'kind': 'string', 'state': 'string', 'pretty': 'boolean'},
            'baton2_orchestra': {'index': 'boolean', 'session': 'string', 'pretty': 'boolean'},
            'baton2_delivery': {'id': 'string', 'pretty': 'boolean'},
        }
        for name, properties in fields.items():
            with self.subTest(tool=name):
                self.assertIn(name, self.advertised)
                schema = self.advertised[name]['inputSchema']
                self.assertEqual(schema['type'], 'object')
                self.assertFalse(schema['additionalProperties'])
                for field, kind in properties.items():
                    self.assertEqual(schema['properties'][field]['type'], kind)
                self.assertEqual(set(schema.get('required', [])), {'id'} if name == 'baton2_delivery' else set())
        for name in ('baton2_inbox', 'baton2_pending'):
            self.assertEqual(set(self.advertised[name]['inputSchema']['properties']['state']['enum']),
                             {'pending', 'acknowledged', 'all'})


    def test_knowledge_literal_translation_and_scope(self):
        for arguments, expected in [
            ({}, ['knowledge', 'attached']),
            ({'index': True}, ['knowledge', 'attached', '--index']),
            ({'reader': '', 'id': '--pretty'}, ['knowledge', '', '--id', '--pretty']),
            ({'reader': "reader ' λ", 'id': '', 'pretty': True},
             ['knowledge', "reader ' λ", '--id', '', '--pretty']),
        ]:
            result, calls = self.exchange('baton2_knowledge', arguments)
            self.assertFalse(result.get('isError'), result)
            self.assertEqual(calls, [[str(self.database), *expected]])
        schema = self.advertised['baton2_knowledge']['inputSchema']
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(schema.get('required', []), [])
        self.assertEqual({k: v['type'] for k, v in schema['properties'].items()},
                         {'reader': 'string', 'index': 'boolean', 'id': 'string', 'pretty': 'boolean'})

    def test_knowledge_invalid_arguments_launch_no_native_process(self):
        for arguments in [{'index': True, 'id': ''}, {'reader': None}, {'id': 1},
                          {'index': 'true'}, {'pretty': 1}, {'extra': True}, []]:
            result, calls = self.exchange('baton2_knowledge', arguments)
            self.assertTrue(result.get('isError'), result)
            self.assertEqual(calls, [])

    def test_knowledge_preserves_large_results_and_native_failures(self):
        body = json.dumps([{'claim': 'λ' * 200000, 'limits': 'complete'}])
        result, calls = self.exchange('baton2_knowledge', {'id': 'chosen'}, stdout=body+'\n')
        self.assertEqual(result['content'][0]['text'], body)
        self.assertEqual(calls, [[str(self.database), 'knowledge', 'attached', '--id', 'chosen']])
        result, _ = self.exchange('baton2_knowledge', {'index': True},
                                  stdout='retained stdout\n', stderr='exact failure\n', code=2)
        self.assertTrue(result.get('isError'), result)
        text = result['content'][0]['text']
        self.assertIn('retained stdout', text)
        self.assertIn('exact failure', text)
        self.assertIn('2', text)


if __name__ == '__main__':
    unittest.main()
