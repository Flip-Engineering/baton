"""Coordinator child-process completion and diagnostics through the MCP adapter."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MCP_SCRIPT = ROOT / 'bend2/scripts/mcp-conductor.mjs'

CHILD = '''import json
import os
from pathlib import Path
import sys
import time

values = json.loads(Path(__file__).with_suffix('.json').read_text())
if sys.argv[1:] == ['--help'] or (len(sys.argv) > 2 and sys.argv[2] == 'help'):
    if values.get('batch', True):
        sys.stdout.write('outbox\\ndelivery-batch\\nmessage-batch\\ninput MESSAGE_ID\\ntask --stdin\\nusage: baton2 as SESSION ACTION ARGS\\n')
        if values.get('dispatch', True):
            sys.stdout.write('dispatch --stdin\\n')
        if values.get('repl', False):
            sys.stdout.write('Actions: inbox, read, send, report, ask, guide, finish, confirm, dispatch, players, assignment, status, role, ensemble, section, orchestra, branch, knowledge, repl\\n')
    else:
        sys.stdout.write('delivery\\nmessage\\n')
    sys.exit(0)
time.sleep(values['delay'])
sys.stdout.write(values['stdout'])
sys.stdout.flush()
sys.stderr.write(values['stderr'])
sys.stderr.flush()
Path(values['completed']).write_text(json.dumps({
    'exit_code': values['code'], 'argv': sys.argv[1:], 'pid': os.getpid(),
    'stdin': sys.stdin.read(),
    'session': os.environ.get('BATON_SESSION'),
    'database': os.environ.get('BATON_DATABASE'),
}))
sys.exit(values['code'])
'''


class McpCommand(unittest.TestCase):
    def command(self, stdout='', stderr='', code=0, delay=0, *,
                tool='baton2_status', arguments=None, session=None, expected_args=None,
                expected_stdin='', expected_context=None, dispatch=True, repl=False):
        with tempfile.TemporaryDirectory() as home:
            home = pathlib.Path(home)
            executable = home / 'fixture-coordinator'
            completed = home / 'completed.json'
            executable.write_text('#!' + sys.executable + '\n' + CHILD)
            executable.chmod(0o755)
            executable.with_suffix('.json').write_text(json.dumps({
                'stdout': stdout, 'stderr': stderr, 'code': code,
                'delay': delay, 'completed': str(completed), 'batch': True,
                'dispatch': dispatch, 'repl': repl,
            }))
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
                {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                 'params': {'name': tool, **({} if arguments is None else
                                             {'arguments': arguments})}},
            ]
            result = subprocess.run(
                ['node', str(MCP_SCRIPT), str(home / 'state.db'), str(executable)]
                + ([] if session is None else ['--session', session]),
                input=''.join(json.dumps(row) + '\n' for row in requests),
                text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([row['id'] for row in replies], [1, 2, 3])
            self.assertEqual(replies[0]['result']['serverInfo']['name'], 'baton-conductor')
            self.instructions = replies[0]['result']['instructions']
            self.tools = {row['name']: row for row in replies[1]['result']['tools']}
            self.assertIn(tool, self.tools)
            self.assertTrue(completed.exists(), 'the coordinator child did not finish its operation')
            child = json.loads(completed.read_text())
            self.assertEqual(child['exit_code'], code)
            self.assertGreater(child['pid'], 0)
            actor = 'root' if session is None else session
            self.assertEqual(child['session'], actor)
            self.assertEqual(child['database'], str(home / 'state.db'))
            if expected_context is not None:
                expected = ['agent-contextual-input', actor]
            else:
                expected = expected_args or ['status']
            self.assertEqual(child['argv'], [str(home / 'state.db')] + expected)
            if expected_context is not None:
                self.assertEqual(json.loads(child['stdin']), expected_context)
            else:
                self.assertEqual(child['stdin'], expected_stdin)
            self.assertFalse((home / 'state.db.actions').exists())
            return replies[2]['result']

    def test_task_forwards_full_input_through_stdin_and_keeps_attached_authorship(self):
        body = 'Complete MCP input λ🙂\nMultiline task text with "quotes".\n' * 10000
        flags = ['--sender', 'attached-λ', '--project', '/explicit project',
                 '--session', 'selected', '--route', 'named', '--effort', 'high', '--continue']
        result = self.command(stdout='{"status":"admitted"}\n', tool='baton2_task',
            arguments={'text': body, 'project': '/explicit project', 'session': 'selected',
                       'route': 'named', 'effort': 'high', 'continue': True}, session='attached-λ',
            expected_args=['dispatch', '--stdin', *flags], expected_stdin=body)
        self.assertFalse(result.get('isError', False))
        schema = self.tools['baton2_task']['inputSchema']
        self.assertEqual(schema['oneOf'], [{'required': ['text']}, {'required': ['file']}])
        self.assertNotIn('sender', schema['properties'])
        self.assertFalse(schema['additionalProperties'])

    def test_task_file_forwards_literal_utf8_path_to_same_operation(self):
        path = "/task files/plain task's λ.txt"
        self.command(tool='baton2_task', arguments={'file': path, 'project': '/selected project',
                     'new': True, 'harness': 'omp', 'model': 'kimi-code/k3', 'effort': 'low'},
                     session='attached-λ', expected_args=['dispatch', '--file', path, '--sender',
                         'attached-λ', '--project', '/selected project', '--harness', 'omp',
                         '--model', 'kimi-code/k3', '--effort', 'low', '--new'])

    def test_dispatch_and_task_alias_select_advertised_input_operation(self):
        body = '\ufeffComplete dispatch input.\nλ🙂\nTrailing spaces  '
        for tool in ('baton2_dispatch', 'baton2_task'):
            with self.subTest(tool=tool):
                self.command(tool=tool, arguments={'text': body, 'project': '/selected project',
                             'to': 'existing conversation', 'continue': True}, session='attached-λ',
                             expected_args=['dispatch', '--stdin', '--sender', 'attached-λ',
                                            '--project', '/selected project', '--to',
                                            'existing conversation', '--continue'], expected_stdin=body)
                schema = self.tools[tool]['inputSchema']
                self.assertNotIn('dispatchId', schema.get('required', []))
                self.assertEqual(schema['properties']['dispatchId']['type'], 'string')
                self.assertEqual(schema['properties']['to']['type'], 'string')
        self.command(tool='baton2_task', arguments={'text': body, 'project': '/legacy project'},
                     session='attached-λ', dispatch=False,
                     expected_args=['task', '--stdin', '--sender', 'attached-λ',
                                    '--project', '/legacy project'], expected_stdin=body)
        self.assertNotIn('baton2_dispatch', self.tools)

    def test_contextual_action_retains_attached_identity_and_batch_argument_order(self):
        result = self.command(stdout='[{"status":"found"}]\n', tool='baton2_action',
            arguments={'action': 'read', 'arguments': ['first-λ', 'second-🙂']}, session='attached-λ',
            expected_context=['read', 'first-λ', 'second-🙂'])
        self.assertFalse(result.get('isError', False))
        self.assertNotIn('session', self.tools['baton2_action']['inputSchema']['properties'])

    def test_repl_guidance_matches_advertised_coordinator_capability(self):
        for available in (False, True):
            with self.subTest(repl=available):
                self.command(repl=available)
                self.assertEqual('baton2_repl' in self.tools, available)
                self.assertEqual('Use baton2_repl' in self.instructions, available)
                self.assertIn('repl', self.tools['baton2_action']['description'])

    def test_contextual_action_preserves_complete_bodies_for_independent_batch_items(self):
        first = '\ufeffFull first body λ🙂\nLiteral quotes " and tabs\t.\n' * 10000
        second = 'Second body Ω\n'
        values = ['first', '--kind', 'report', '--text', first,
                  '--and', 'second', '--kind', 'report', '--text', second]
        result = self.command(stdout='[{"status":"sent"},{"status":"sent"}]\n',
            tool='baton2_action', arguments={'action': 'send', 'arguments': values}, session='attached-λ',
            expected_context=['send', *values])
        self.assertFalse(result.get('isError', False))

    def test_contextual_native_body_fields_keep_complete_json_input_in_one_batch(self):
        bodies = tuple(('\ufeff' + name + ' λ🙂\nLast line  \n') * 10000
                       for name in ('claim', 'evidence', 'limits', 'links', 'query', 'reason'))
        values = ['record', '--id', 'finding-one', '--kind', 'finding',
                  '--claim', bodies[0], '--evidence', bodies[1], '--limits', bodies[2],
                  '--links', bodies[3], '--and', 'knowledge', 'search', '--query', bodies[4],
                  'and', 'stop', '--session', 'worker', '--id', 'stop-one', '--reason', bodies[5]]
        result = self.command(stdout='[{"status":"completed"}]\n', tool='baton2_action',
            arguments={'action': 'knowledge', 'arguments': values}, session='attached-λ',
            expected_context=['knowledge', *values])
        self.assertFalse(result.get('isError', False))

    def test_contextual_named_values_preserve_body_flag_literals(self):
        values = ['--command', '--text', '--output-log', '--claim', '--model', '--and',
                  '--effort', 'high', '--and', 'knowledge', 'read', '--id', '--query']
        result = self.command(stdout='[{"status":"completed"}]\n', tool='baton2_action',
            arguments={'action': 'configure', 'arguments': values}, session='attached-λ',
            expected_context=['configure', *values])
        self.assertFalse(result.get('isError', False))

    def test_pretty_inspection_preserves_large_guidance_body_in_mixed_batch(self):
        body = '\ufeffComplete guidance after inspection λ🙂\nLast line  \n' * 10000
        values = ['--pretty', '--and', 'guide', '--to', 'worker', '--text', body]
        result = self.command(stdout='[{"status":"completed"},{"status":"completed"}]\n',
            tool='baton2_action', arguments={'action': 'session', 'arguments': values},
            session='attached-λ', expected_context=['session', *values])
        self.assertFalse(result.get('isError', False))

    def native_controls(self):
        player = "Player's review λ"
        command = "/native tools/provider's executable"
        log = "/run output/Player's λ.jsonl"
        task = "/task files/review's λ.md"
        recruitment = {
            'player': player, 'harness': 'omp', 'model': 'deepseek/deepseek-flash',
            'effort': 'low', 'repo': "/repository's λ", 'branch': 'review-λ',
            'workspace': "/worktree's review λ", 'base': 'main',
        }
        return {
            'baton2_join': ({'player': player, 'harness': 'omp',
                'model': 'deepseek/deepseek-flash', 'effort': 'low', 'workspace': recruitment['workspace']},
                ['join', player, 'root', 'omp', 'deepseek/deepseek-flash', 'low', recruitment['workspace']]),
            'baton2_recruit': (recruitment, ['recruit', player, 'root', 'omp',
                'deepseek/deepseek-flash', 'low', recruitment['repo'], 'review-λ',
                recruitment['workspace'], 'main']),
            'baton2_receiver': ({'player': player, 'command': command, 'log': log},
                ['receiver', player, command, log]),
            'baton2_configure': ({'player': player, 'harness': 'omp', 'model': 'deepseek/deepseek-flash',
                'effort': 'high', 'command': command, 'log': log, 'expectedHarness': 'codex',
                'expectedModel': 'gpt-6-astra', 'expectedEffort': 'low'},
                ['configure', player, 'omp', 'deepseek/deepseek-flash', 'high', command, log,
                 'codex', 'gpt-6-astra', 'low']),
            'baton2_dispatch_file': ({'id': 'task-λ', 'recipient': player,
                'kind': 'task', 'path': task},
                ['dispatch-file', 'task-λ', 'root', player, 'task', task]),
            'baton2_dispatch_turn': ({'player': player, 'id': 'turn-λ',
                'command': command, 'log': log, 'task': task},
                ['dispatch-turn', player, 'turn-λ', command, log, task]),
        }

    def test_authored_completion_messages_use_the_attached_session(self):
        for kind,recipient,body in ((None,'worker','Continue the assigned work.'),
                                    ('completion-request','parent','The task result is ready.'),
                                    ('completion-confirmed','worker','worker-ready-λ')):
            with self.subTest(kind=kind):
                arguments={'id':'message-λ','player':recipient,'body':body}
                if kind is not None: arguments['kind']=kind
                self.command(tool='baton2_guide',arguments=arguments,session='attached-λ',
                             expected_args=['message','message-λ','attached-λ',recipient,
                                            kind or 'guidance',body])

    def test_inferred_mutation_schemas_keep_explicit_compatibility_fields(self):
        self.command()
        selectors = {
            'baton2_ack': ('id', 'receipt'),
            'baton2_guide': ('id', 'request'),
            'baton2_context_query_file': ('query',),
            'baton2_context_result': ('query',),
            'baton2_knowledge_record': ('id',),
            'baton2_knowledge_relate': ('id',),
            'baton2_knowledge_promote': ('id', 'source'),
            'baton2_dispatch_file': ('id',),
            'baton2_dispatch_turn': ('id',),
        }
        for tool, fields in selectors.items():
            with self.subTest(tool=tool):
                schema = self.tools[tool]['inputSchema']
                for field in fields:
                    self.assertNotIn(field, schema.get('required', []))
                    self.assertEqual(schema['properties'][field]['type'], 'string')
        self.assertEqual(self.tools['baton2_ack']['inputSchema'].get('required', []), [])
        self.assertEqual(self.tools['baton2_guide']['inputSchema']['required'], ['player'])
        link = self.tools['baton2_knowledge_record']['inputSchema']['properties']['links']['items']
        self.assertNotIn('id', link['required'])
        self.assertEqual(link['properties']['id']['type'], 'string')

    def test_inferred_actions_delegate_current_authority_to_attached_native_context(self):
        body = '\ufeffComplete authored input.\nλ🙂\nTrailing spaces  '
        cases = (
            ('baton2_ack', None, ['acknowledge']),
            ('baton2_ack', {'id': 'selected input'}, ['acknowledge', 'selected input']),
            ('baton2_guide', {'player': 'worker', 'body': body},
             ['send', 'worker', '--kind', 'guidance', '--text', body]),
            ('baton2_guide', {'player': 'worker', 'kind': 'completion-confirmed'},
             ['completion-confirmed', '--to', 'worker']),
            ('baton2_guide', {'player': 'worker', 'kind': 'completion-confirmed',
                              'request': 'exact request', 'id': 'exact confirmation'},
             ['completion-confirmed', '--to', 'worker', '--request', 'exact request',
              '--id', 'exact confirmation']),
            ('baton2_context_query_file', {'path': "/queries/query's λ.json"},
             ['context', 'query', '--file', "/queries/query's λ.json"]),
            ('baton2_context_result', None, ['context', 'result']),
            ('baton2_knowledge_record', {'claim': body, 'evidence': 'message:input',
                                         'limits': 'Observed handling only.'},
             ['knowledge', 'record', '--kind', 'finding', '--claim', body,
              '--evidence', 'message:input', '--limits', 'Observed handling only.']),
            ('baton2_knowledge_relate', {'source': 'finding:current', 'relation': 'Supports',
                                         'target': 'message:input'},
             ['knowledge', 'relate', '--source', 'finding:current', '--relation', 'Supports',
              '--target', 'message:input']),
            ('baton2_knowledge_promote', {'destination': 'review', 'finding': 'current'},
             ['knowledge', 'promote', '--to', 'review', '--finding', 'current']),
            ('baton2_dispatch_file', {'recipient': 'worker', 'kind': 'task',
                                       'path': "/tasks/task's λ.txt"},
             ['dispatch', '--to', 'worker', '--kind', 'task', '--file', "/tasks/task's λ.txt"]),
            ('baton2_dispatch_turn', {'player': 'worker', 'command': '/native command',
                                       'log': '/retained output', 'task': "/tasks/task's λ.txt"},
             ['turn', '--session', 'worker', '--command', '/native command',
              '--output-log', '/retained output', '--file', "/tasks/task's λ.txt"]),
        )
        for tool, arguments, contextual in cases:
            with self.subTest(tool=tool, arguments=arguments):
                result = self.command(stdout='{"retained":"native decision λ"}\n',
                                      tool=tool, arguments=arguments, session='attached-λ',
                                      expected_context=contextual)
                self.assertEqual(result['content'],
                                 [{'type': 'text', 'text': '{"retained":"native decision λ"}'}])
                self.assertNotIn('isError', result)
        self.command(tool='baton2_ack', arguments={'id': 'selected input',
                     'receipt': 'First complete handling.'}, session='attached-λ',
                     expected_args=['ack', 'selected input', 'attached-λ', 'First complete handling.'])

    def test_inferred_handling_keeps_native_refusal_and_complete_diagnostic(self):
        diagnostic = json.dumps({'error': 'handling-context',
                                 'condition': 'No live owned input context.\nλ🙂'}) + '\n'
        self.failure('', diagnostic, code=2, tool='baton2_ack', session='attached-λ',
                     expected_context=['acknowledge'])

    def test_semantic_report_evidence_uses_native_context_with_an_explicit_record_id(self):
        body = '\ufeffComplete source fact.\nλ🙂\nTrailing spaces  '
        arguments = {'id': 'semantic-finding', 'kind': 'observation',
                     'claim': body, 'evidence': 'report', 'limits': 'Current assignment only.'}
        self.command(tool='baton2_knowledge_record', arguments=arguments, session='attached-λ',
                     expected_context=['knowledge', 'record', '--kind', 'observation',
                                       '--claim', body, '--evidence', 'report',
                                       '--limits', 'Current assignment only.',
                                       '--id', 'semantic-finding'])
        description = self.tools['baton2_knowledge_record']['inputSchema']['properties']['evidence']['description']
        self.assertIn('current assignment', description)
        self.assertIn('ambiguous', description)

    def test_generated_linked_knowledge_keeps_explicit_record_and_full_relationship(self):
        links = [{'source': 'message:retained-input', 'relation': 'Supports',
                  'target': 'finding:explicit-record'}]
        body = '\ufeffComplete linked claim.\nλ🙂\nTrailing spaces  '
        arguments = {'id': 'explicit-record', 'kind': 'observation', 'claim': body,
                     'evidence': 'message:retained-input', 'limits': 'This retained result.',
                     'links': links}
        self.command(tool='baton2_knowledge_record', arguments=arguments, session='attached-λ',
                     expected_context=['knowledge', 'record', '--kind', 'observation',
                                       '--claim', body, '--evidence', 'message:retained-input',
                                       '--limits', 'This retained result.', '--id', 'explicit-record',
                                       '--links', json.dumps(links, ensure_ascii=False,
                                                           separators=(',', ':'))])

    def test_batch_message_tools_forward_structured_arrays_with_attached_authorship(self):
        ids = ['message-one', "message two's λ"]
        self.command(tool='baton2_input', arguments={'id': ids[0]},
                     session='reader', expected_args=['input', ids[0]])
        self.command(tool='baton2_delivery_batch', arguments={'ids': ids},
                     session='reader', expected_args=['delivery-batch',
                         json.dumps(ids, ensure_ascii=False, separators=(',', ':'))])
        messages = [
            {'id': 'one', 'player': 'leaf-a', 'body': 'First body.\n'},
            {'id': "two's λ", 'player': 'leaf-b', 'kind': 'custom',
             'body': 'Second λ🙂 body.'},
        ]
        native = [
            {'id': 'one', 'recipient': 'leaf-a', 'kind': 'guidance',
             'body': 'First body.\n'},
            {'id': "two's λ", 'recipient': 'leaf-b', 'kind': 'custom',
             'body': 'Second λ🙂 body.'},
        ]
        self.command(tool='baton2_message_batch', arguments={'messages': messages},
                     session='attached-λ', expected_args=['message-batch', 'attached-λ',
                         json.dumps(native, ensure_ascii=False, separators=(',', ':'))])
        self.command(tool='baton2_outbox', arguments={}, session='attached-λ',
                     expected_args=['outbox', 'attached-λ'])
        read_schema = self.tools['baton2_delivery_batch']['inputSchema']
        self.assertEqual(read_schema['properties']['ids']['type'], 'array')
        input_schema = self.tools['baton2_input']['inputSchema']
        self.assertEqual(set(input_schema['required']), {'id'})
        self.assertFalse(input_schema['additionalProperties'])
        send_schema = self.tools['baton2_message_batch']['inputSchema']
        item = send_schema['properties']['messages']['items']
        self.assertEqual(set(item['required']), {'player'})
        self.assertEqual(item['properties']['id']['type'], 'string')
        self.assertEqual(item['properties']['request']['type'], 'string')
        self.assertFalse(item['additionalProperties'])

    def test_generated_message_batch_delegates_exact_bodies_and_optional_ids(self):
        first = '\ufeffComplete first guidance.\nλ🙂\nTrailing spaces  '
        second = 'Full report with literal body flags --id --kind.\nλ🙂'
        messages = [{'player': 'leaf-a', 'body': first},
                    {'id': 'explicit-report', 'player': 'leaf-b', 'kind': 'report',
                     'body': second}]
        self.command(tool='baton2_message_batch', arguments={'messages': messages},
                     session='attached-λ', expected_context=['send', 'leaf-a', '--kind',
                         'guidance', '--text', first, '--and', 'leaf-b', '--kind', 'report',
                         '--text', second, '--id', 'explicit-report'])

    def test_completion_batch_keeps_inferred_and_explicit_parent_decisions_in_native_order(self):
        body = '\ufeffComplete further work guidance.\nλ🙂\nTrailing spaces  '
        messages = [
            {'player': 'ready-worker', 'kind': 'completion-confirmed'},
            {'id': 'explicit-guidance', 'player': 'held-worker', 'body': body},
            {'id': 'explicit-confirmation', 'player': 'selected-worker',
             'kind': 'completion-confirmed', 'request': 'exact-current-request'},
            {'player': 'legacy-worker', 'kind': 'completion-confirmed',
             'body': 'exact-legacy-request'},
        ]
        native = [
            'completion-confirmed', '--to', 'ready-worker', '--and', 'dispatch',
            '--to', 'held-worker', '--kind', 'guidance', '--text', body,
            '--id', 'explicit-guidance', '--and', 'completion-confirmed',
            '--to', 'selected-worker', '--request', 'exact-current-request',
            '--id', 'explicit-confirmation', '--and', 'completion-confirmed',
            '--to', 'legacy-worker', '--request', 'exact-legacy-request',
        ]
        output = json.dumps([{'status': 'completed', 'stdout': '[{"status":"refused"}]'},
                             {'status': 'completed', 'stdout': '[{"status":"admitted"}]'}])
        result = self.command(stdout=output + '\n', tool='baton2_message_batch',
                              arguments={'messages': messages}, session='attached-λ',
                              expected_context=native)
        self.assertEqual(result['content'], [{'type': 'text', 'text': output}])
        self.assertNotIn('isError', result)

    def test_batch_message_tools_require_recorded_executable_support(self):
        with tempfile.TemporaryDirectory() as home:
            home = pathlib.Path(home)
            executable = home / 'fixture-coordinator'
            executable.write_text('#!' + sys.executable + '\n' + CHILD)
            executable.chmod(0o755)
            executable.with_suffix('.json').write_text(json.dumps({
                'stdout': '', 'stderr': '', 'code': 0, 'delay': 0,
                'completed': str(home / 'completed.json'), 'batch': False,
            }))
            requests = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            ]
            result = subprocess.run(
                ['node', str(MCP_SCRIPT), str(home / 'state.db'), str(executable)],
                input=''.join(json.dumps(row) + '\n' for row in requests),
                text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            tools = {row['name'] for row in replies[1]['result']['tools']}
            self.assertTrue({'baton2_delivery', 'baton2_guide'} <= tools)
            self.assertTrue({'baton2_delivery_batch', 'baton2_outbox',
                             'baton2_message_batch'}.isdisjoint(tools))
            self.assertNotIn('baton2_input', tools)
            instructions = replies[0]['result']['instructions']
            self.assertIn('baton2_delivery reads one complete stored message', instructions)
            self.assertNotIn('baton2_delivery_batch', instructions)

    def test_native_control_tools_advertise_typed_arguments(self):
        self.command()
        contracts = {
            'baton2_join': ({'player', 'harness', 'model', 'effort', 'workspace'}, {'parent'}),
            'baton2_recruit': ({'player', 'harness', 'model', 'effort', 'repo',
                'branch', 'workspace', 'base'}, {'parent'}),
            'baton2_receiver': ({'player', 'command', 'log'}, {'cwd'}),
            'baton2_configure': ({'player', 'harness', 'model', 'effort', 'command', 'log',
                'expectedHarness', 'expectedModel', 'expectedEffort'}, set()),
            'baton2_dispatch_file': ({'recipient', 'kind', 'path'}, {'sender', 'id'}),
            'baton2_dispatch_turn': ({'player', 'command', 'log', 'task'}, {'id'}),
        }
        for name, (required, optional) in contracts.items():
            with self.subTest(tool=name):
                schema = self.tools[name]['inputSchema']
                self.assertEqual(schema['type'], 'object')
                self.assertFalse(schema['additionalProperties'])
                self.assertEqual(set(schema['required']), required)
                self.assertEqual(set(schema['properties']), required | optional)
                for field in schema['properties'].values():
                    self.assertEqual(field['type'], 'string')

    def test_recruit_defaults_parent_to_selected_conductor(self):
        arguments, argv = self.native_controls()['baton2_recruit']
        for session in (None, "Associate's λ", ''):
            with self.subTest(session=session):
                expected = list(argv)
                expected[2] = 'root' if session is None else session
                self.command(tool='baton2_recruit', arguments=arguments,
                             session=session, expected_args=expected)

    def test_recruit_preserves_explicit_parent(self):
        arguments, argv = self.native_controls()['baton2_recruit']
        for parent in ("Principal's λ", ''):
            with self.subTest(parent=parent):
                expected = list(argv)
                expected[2] = parent
                self.command(tool='baton2_recruit', arguments={**arguments, 'parent': parent},
                             session='associate', expected_args=expected)

    def test_join_defaults_parent_to_selected_conductor(self):
        arguments, argv = self.native_controls()['baton2_join']
        for session in (None, "Associate's λ", ''):
            with self.subTest(session=session):
                expected = list(argv)
                expected[2] = 'root' if session is None else session
                self.command(tool='baton2_join', arguments=arguments,
                             session=session, expected_args=expected)

    def test_join_preserves_explicit_parent(self):
        arguments, argv = self.native_controls()['baton2_join']
        for parent in ("Principal's λ", ''):
            with self.subTest(parent=parent):
                expected = list(argv)
                expected[2] = parent
                self.command(tool='baton2_join', arguments={**arguments, 'parent': parent},
                             session='associate', expected_args=expected)

    def test_receiver_forwards_explicit_player_and_native_paths(self):
        arguments, argv = self.native_controls()['baton2_receiver']
        self.command(tool='baton2_receiver', arguments=arguments,
                     session='associate', expected_args=argv)

    def test_landing_forwards_optional_reviewed_commit(self):
        for tool, command, extra in (
                ('baton2_land', 'land', {}),
                ('baton2_land_checked', 'land-checked', {'check': 'check.sh', 'files': 'file.txt'})):
            for selected in (None, 'reviewed-source'):
                with self.subTest(tool=tool, commit=selected):
                    args = {'player': 'worker', 'repo': '/repository', 'target': 'main', **extra}
                    argv = [command, 'worker', '/repository', 'main', *extra.values()]
                    if selected is not None:
                        args['commit'] = selected
                        argv += ['--commit', selected]
                    self.command(tool=tool, arguments=args, expected_args=argv)
                    schema = self.tools[tool]['inputSchema']
                    self.assertEqual(schema['properties']['commit']['type'], 'string')
                    self.assertNotIn('commit', schema['required'])

    def test_configure_forwards_the_requested_and_expected_route(self):
        arguments, argv = self.native_controls()['baton2_configure']
        self.command(tool='baton2_configure', arguments=arguments,
                     session='associate', expected_args=argv)

    def test_dispatch_file_defaults_sender_to_selected_conductor(self):
        arguments, argv = self.native_controls()['baton2_dispatch_file']
        for session in (None, "Associate's λ", ''):
            with self.subTest(session=session):
                expected = list(argv)
                expected[2] = 'root' if session is None else session
                self.command(tool='baton2_dispatch_file', arguments=arguments,
                             session=session, expected_args=expected)

    def test_dispatch_file_preserves_explicit_sender_and_kind(self):
        arguments, argv = self.native_controls()['baton2_dispatch_file']
        for sender in ("Principal's λ", ''):
            with self.subTest(sender=sender):
                expected = list(argv)
                expected[2] = sender
                expected[4] = 'guidance'
                self.command(tool='baton2_dispatch_file',
                             arguments={**arguments, 'sender': sender, 'kind': 'guidance'},
                             session='associate', expected_args=expected)

    def test_dispatch_turn_forwards_task_and_log_paths(self):
        arguments, argv = self.native_controls()['baton2_dispatch_turn']
        self.command(tool='baton2_dispatch_turn', arguments=arguments,
                     session='associate', expected_args=argv)

    def test_worker_argument_alias_replays_stored_calls(self):
        # Stored tool calls may carry the pre-rename 'worker' argument name;
        # the adapter forwards it to the native player position.
        self.command(tool='baton2_player', arguments={'worker': 'player-id'},
                     expected_args=['player', 'player-id'])

    def test_project_context_and_knowledge_tools_forward_literal_operands(self):
        session = "Producer's λ"
        path = "/shared project/query's λ.json"
        query = 'retained-object-λ'
        cases = {
            'baton2_project': ({'path': path}, ['project', path]),
            'baton2_project_sessions': ({'path': path}, ['project-sessions', path]),
            'baton2_resume': ({'session': 'recorded consumer'}, ['resume', 'recorded consumer']),
            'baton2_context_query_file': ({'query': query, 'path': path},
                ['context-query-file', session, query, path]),
            'baton2_context_result': ({'query': query}, ['context-result', query]),
            'baton2_knowledge': ({}, ['knowledge', session]),
            'baton2_knowledge_relations': ({}, ['knowledge-relations', session, 'worker', session]),
            'baton2_knowledge_search': ({'query': "reconnect ' λ"},
                ['knowledge-search', session, 'worker', session, "reconnect ' λ"]),
            'baton2_knowledge_traverse': ({'reference': "finding:node ' λ"},
                ['knowledge-traverse', session, 'worker', session, "finding:node ' λ",
                 'both', '', 'neighbors']),
            'baton2_knowledge_record': ({'id': 'finding-λ', 'claim': 'claim with\nnewlines',
                'evidence': 'message:retained-message', 'limits': 'source only'},
                ['record', 'finding-λ', session, 'claim with\nnewlines',
                 'message:retained-message', 'source only']),
            'baton2_knowledge_relate': ({'id': 'correction-link-λ', 'source': 'finding:corrected-λ',
                'relation': 'Supersedes', 'target': 'finding:original-λ'},
                ['relate', 'correction-link-λ', session, 'finding:corrected-λ',
                 'Supersedes', 'finding:original-λ']),
            'baton2_knowledge_promote': ({'id': 'promotion-λ', 'source': 'source session',
                'destination': session, 'finding': 'finding-λ'},
                ['promote', 'promotion-λ', session, 'source session', session, 'finding-λ']),
        }
        for tool, (arguments, argv) in cases.items():
            with self.subTest(tool=tool):
                result = self.command(stdout='{"retained":"object λ"}\n', tool=tool,
                                      arguments=arguments, session=session, expected_args=argv)
                self.assertEqual(result['content'], [{'type': 'text', 'text': '{"retained":"object λ"}'}])
                self.assertNotIn('isError', result)
                schema = self.tools[tool]['inputSchema']
                required = {'baton2_context_query_file': {'path'},
                            'baton2_context_result': set(),
                            'baton2_knowledge_record': {'claim', 'evidence', 'limits'},
                            'baton2_knowledge_relate': {'source', 'relation', 'target'},
                            'baton2_knowledge_promote': {'destination', 'finding'}}.get(
                                tool, set(arguments))
                self.assertEqual(set(schema.get('required', [])), required)
                optional = {'baton2_resume': {'liftStop'},
                            'baton2_knowledge': {'scope', 'subject', 'index', 'id', 'pretty'},
                            'baton2_knowledge_relations': {'scope', 'subject', 'pretty'},
                            'baton2_knowledge_search': {'scope', 'subject', 'pretty'},
                            'baton2_knowledge_traverse': {'scope', 'subject', 'direction',
                                                        'relation', 'recursive', 'pretty'},
                            'baton2_knowledge_record': {'kind', 'links'},
                            'baton2_knowledge_promote': {'sourceKind', 'destinationKind'}}.get(tool, set())
                expected_properties = set(arguments) | optional
                self.assertEqual(set(schema['properties']), expected_properties)
                self.assertFalse(schema['additionalProperties'])
        self.command(stdout='{"session":"recorded consumer"}\n', tool='baton2_resume',
                     arguments={'session': 'recorded consumer', 'liftStop': True}, session=session,
                     expected_args=['resume', 'recorded consumer', '--lift-stop'])
        self.command(tool='baton2_knowledge_record', session=session,
                     arguments={'id': 'corrected-λ', 'kind': 'correction', 'claim': 'Corrected\nclaim',
                                'evidence': 'message:retained-message', 'limits': 'One run'},
                     expected_args=['record-typed', 'corrected-λ', session, 'correction',
                                    'Corrected\nclaim', 'message:retained-message', 'One run'])
        self.command(tool='baton2_knowledge', session=session,
                     arguments={'scope': 'worker'},
                     expected_args=['knowledge-scope', session, 'worker', session])
        self.command(tool='baton2_knowledge', session=session,
                     arguments={'scope': 'group', 'subject': 'review-group'},
                     expected_args=['knowledge-scope', session, 'group', 'review-group'])
        self.command(tool='baton2_knowledge', session=session,
                     arguments={'index': True, 'pretty': True},
                     expected_args=['knowledge', session, '--index', '--pretty'])
        self.command(tool='baton2_knowledge', session=session,
                     arguments={'id': "finding's λ"},
                     expected_args=['knowledge', session, '--id', "finding's λ"])
        self.command(tool='baton2_knowledge', session=session,
                     arguments={'scope': 'group', 'subject': 'review-group',
                                'id': 'shared-finding', 'pretty': True},
                     expected_args=['knowledge-scope', session, 'group', 'review-group',
                                    '--id', 'shared-finding', '--pretty'])
        self.command(tool='baton2_knowledge_promote', session=session,
                     arguments={'id': 'group promotion λ', 'source': 'source session',
                                'destinationKind': 'group', 'destination': "review group's λ", 'finding': 'finding-λ'},
                     expected_args=['promote-scoped', 'group promotion λ', session, 'session',
                                    'source session', 'group', "review group's λ", 'finding-λ'])
        self.command(tool='baton2_knowledge_promote', session=session,
                     arguments={'id': 'onward promotion λ', 'sourceKind': 'group',
                                'source': "review group's λ", 'destination': session, 'finding': 'finding-λ'},
                     expected_args=['promote-scoped', 'onward promotion λ', session, 'group',
                                    "review group's λ", 'session', session, 'finding-λ'])
        self.command(tool='baton2_knowledge_relations', session=session,
                     arguments={'scope': 'group', 'subject': "review group's λ", 'pretty': True},
                     expected_args=['knowledge-relations', session, 'group', "review group's λ", '--pretty'])
        self.command(tool='baton2_knowledge_search', session=session,
                     arguments={'query': 'two terms', 'scope': 'universal', 'pretty': True},
                     expected_args=['knowledge-search', session, 'universal', '', 'two terms', '--pretty'])
        self.command(tool='baton2_knowledge_traverse', session=session,
                     arguments={'reference': 'message:source', 'scope': 'group', 'subject': 'team',
                                'direction': 'out', 'relation': 'supports', 'recursive': True,
                                'pretty': True},
                     expected_args=['knowledge-traverse', session, 'group', 'team', 'message:source',
                                    'out', 'supports', 'recursive', '--pretty'])
        links = [{'id': "link ' λ", 'source': 'message:source', 'relation': 'Supports',
                  'target': 'finding:hypothesis'}]
        self.command(tool='baton2_knowledge_record', session=session,
                     arguments={'id': 'hypothesis', 'kind': 'hypothesis', 'claim': 'Explanation',
                                'evidence': 'message:source', 'limits': 'One observation',
                                'links': links},
                     expected_args=['record-linked', 'hypothesis', session, 'hypothesis',
                                    'Explanation', 'message:source', 'One observation',
                                    json.dumps(links, ensure_ascii=False, separators=(',', ':'))])

    def test_context_query_uses_attached_identity_and_consumer_reads_same_query(self):
        query = 'shared-query'
        self.command(tool='baton2_context_query_file',
                     arguments={'query': query, 'path': '/query.json', 'owner': 'different-owner'},
                     session='producer', expected_args=['context-query-file', 'producer', query, '/query.json'])
        envelope = '{"query":"shared-query","owner":"producer","state":"complete"}'
        result = self.command(stdout=envelope, tool='baton2_context_result',
                              arguments={'query': query}, session='consumer',
                              expected_args=['context-result', query])
        self.assertEqual(result['content'][0]['text'], envelope)

    def test_message_metadata_filters_forward_literal_values_and_wide_sequences(self):
        wide = '9007199254740993'
        response = '[{"seq":9007199254740994,"id":"retained","receipt":""}]'
        cases = [
            ('baton2_inbox', {}, ['inbox', 'attached']),
            ('baton2_pending', {}, ['pending']),
            ('baton2_inbox', {'index': True, 'pretty': True},
             ['inbox', 'attached', '--index', '--pretty']),
            ('baton2_inbox', {'recipient': '', 'sender': '--index', 'kind': '--pretty',
                              'state': 'all', 'afterSeq': wide, 'throughSeq': '9007199254740994',
                              'pretty': True},
             ['inbox', '', '--index', '--sender', '--index', '--kind', '--pretty',
              '--state', 'all', '--after-seq', wide, '--through-seq', '9007199254740994', '--pretty']),
            ('baton2_pending', {'recipient': 'root', 'sender': '', 'kind': "report's λ",
                                'state': 'acknowledged', 'afterSeq': wide},
             ['pending', '--index', '--recipient', 'root', '--sender', '', '--kind', "report's λ",
              '--state', 'acknowledged', '--after-seq', wide]),
        ]
        for tool, arguments, argv in cases:
            with self.subTest(tool=tool, arguments=arguments):
                result = self.command(stdout=response + '\n', tool=tool, arguments=arguments,
                                      session='attached', expected_args=argv)
                self.assertEqual(result['content'][0]['text'], response)
                schema = self.tools[tool]['inputSchema']['properties']
                self.assertEqual(schema['afterSeq']['type'], 'string')
                self.assertEqual(schema['throughSeq']['type'], 'string')

    def test_context_and_resume_refusals_preserve_native_exit_and_diagnostics(self):
        for tool, arguments, argv, reason in (
                ('baton2_context_result', {'query': 'absent'}, ['context-result', 'absent'],
                 'contextResultAbsent:absent'),
                ('baton2_resume', {'session': 'stopped'}, ['resume', 'stopped'],
                 'session is stopped')):
            with self.subTest(tool=tool):
                self.failure('retained diagnostic\n', reason + '\n', code=3,
                             tool=tool, arguments=arguments, expected_args=argv)

    def test_native_control_success_preserves_complete_output(self):
        stdout = '{"status":"dispatched"}\n' + 'coordinator output λ\n' * 100000 + 'complete\n'
        for tool, (arguments, argv) in self.native_controls().items():
            with self.subTest(tool=tool):
                result = self.command(stdout=stdout, tool=tool, arguments=arguments,
                                      expected_args=argv)
                self.assertNotIn('isError', result)
                self.assertEqual(result['content'], [{'type': 'text', 'text': stdout.strip()}])

    def test_native_control_refusals_preserve_exit_and_both_streams(self):
        stdout = '{"error":"coordinator-refused"}\n' + 'refusal context λ\n' * 10000
        stderr = 'native control diagnostic λ\n' * 10000
        for tool, (arguments, argv) in self.native_controls().items():
            with self.subTest(tool=tool):
                self.failure(stdout, stderr, code=2, tool=tool, arguments=arguments,
                             expected_args=argv)

    def test_command_completes_after_the_former_deadline(self):
        result = self.command(stdout='completed after waiting\n', delay=10.25)
        self.assertNotIn('isError', result)
        self.assertEqual(result['content'], [{'type': 'text', 'text': 'completed after waiting'}])

    def test_success_preserves_large_unicode_output(self):
        stdout = '开始\n' + 'coordinator output λ\n' * 100000 + '完成\n'
        result = self.command(stdout=stdout)
        self.assertNotIn('isError', result)
        self.assertEqual(result['content'], [{'type': 'text', 'text': stdout.strip()}])

    def failure(self, stdout, stderr, code=7, **operation):
        result = self.command(stdout=stdout, stderr=stderr, code=code, **operation)
        self.assertTrue(result['isError'])
        text = result['content'][0]['text']
        prefix, separator, body = text.partition('\nstdout:\n')
        self.assertTrue(separator, 'MCP failure omitted captured stdout')
        self.assertIn(f'\nexit code: {code}', prefix)
        actual_stdout, separator, actual_stderr = body.partition('\nstderr:\n')
        self.assertTrue(separator, 'MCP failure omitted captured stderr')
        self.assertEqual(actual_stdout, stdout)
        self.assertEqual(actual_stderr, stderr)

    def test_failure_preserves_both_streams(self):
        self.failure('stdout first\n' + 'λ output\n' * 10000 + 'stdout last\n',
                     'stderr first\n' + 'λ diagnostic\n' * 10000 + 'stderr last\n')

    def test_failure_preserves_large_unicode_streams(self):
        self.failure('stdout first\n' + 'λ output\n' * 150000 + 'stdout last\n',
                     'stderr first\n' + 'λ diagnostic\n' * 100000 + 'stderr last\n')

    def test_failure_preserves_stdout_with_empty_stderr(self):
        self.failure('stdout-only failure\n', '')


if __name__ == '__main__':
    unittest.main()
