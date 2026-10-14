"""Owned native reads and routine handling through controlled retained turns."""

import json
import os
import pathlib
import sqlite3
import subprocess
import unittest

import receive


class AgentInput(unittest.TestCase):
    def setUp(self):
        self.fx = receive.Receive()
        self.addCleanup(self.fx.doCleanups)
        self.fx.setUp()
        source = self.fx.fixture.read_text()
        marker = "    if action.get('progress'):\n"
        operation = r'''    if 'agent_action' in action or 'legacy_action' in action:
        legacy='legacy_action' in action
        arguments=action['legacy_action' if legacy else 'agent_action']
        command=[config['exe'],config['db'],*arguments] if legacy else [config['exe'],config['db'],'as',model,*arguments]
        output=action.get('output_file')
        if output:
            with open(output,'wb',buffering=0) as target:
                result=subprocess.run(command,stdout=target,stderr=subprocess.PIPE,text=True)
        else:
            result=subprocess.run(command,capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout or '',
               'stderr':result.stderr,'arguments':arguments})
        continue
'''
        self.assertIn(marker, source)
        self.fx.fixture.write_text(source.replace(marker, operation + marker, 1))
        self.fx.player()
        self.fx.prepare_input('owned-input', 'parent', 'Complete owned input.\nλ🙂\n',
                              kind='guidance')
        self.fx.coord('message', 'foreign-input', 'parent', 'root', 'report',
                      'Complete foreign report.\n')

    def reads(self):
        with sqlite3.connect(f'{self.fx.db.as_uri()}?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute(
                'SELECT attempt,message,recipient,native,identity,handled '
                'FROM message_reads ORDER BY attempt,message')]

    def start(self):
        child = self.fx.spawn(*self.fx.receive_args('parent'))
        stream, started = self.fx.accept_child(child, 'parent')
        self.fx.eventually(lambda: self.fx.coord('session', 'parent')['native'] ==
                          started['native'], 'native identity was not recorded')
        self.fx.eventually(lambda: any(row['message'] == 'owned-input' for row in self.reads()),
                          'complete initial input was not recorded with its actual native identity')
        return child, stream, started

    def action(self, stream, *arguments, output_file=None, legacy=False):
        operation = {'legacy_action' if legacy else 'agent_action': list(arguments)}
        if output_file is not None:
            operation['output_file'] = str(output_file)
        self.fx.action(stream, **operation)
        result = json.loads(stream.readline())
        self.assertEqual(result['arguments'], list(arguments))
        return result

    def end(self, child, stream, *, failed=False, complete_task=False):
        self.fx.action(stream, body='Controlled native result.', ack=False,
                       complete_task=complete_task, fail=failed)
        return self.fx.finish(child, ok=not failed)

    def test_success_handles_exact_owned_full_read_and_retains_first_receipt(self):
        self.fx.prepare_input('already-handled', 'parent', 'Earlier handled input.\n',
                              kind='task')
        self.fx.coord('ack', 'already-handled', 'parent', 'earliest receipt')
        child, stream, started = self.start()
        result = self.action(stream, 'read', 'owned-input', 'foreign-input',
                             'absent-input', 'already-handled')
        self.assertEqual(result['code'], 0, result)
        body = json.loads(result['stdout'])
        self.assertEqual([row['id'] for row in body],
                         ['owned-input', 'foreign-input', 'absent-input',
                          'already-handled'])
        self.assertEqual(body[0]['delivery']['body'], 'Complete owned input.\nλ🙂\n')
        before = self.reads()
        self.assertEqual({row['message'] for row in before},
                         {'owned-input', 'already-handled'})
        self.assertTrue(all(row['recipient'] == 'parent' and
                            row['native'] == started['native'] and row['identity'] and
                            row['handled'] is None for row in before))
        repeated = self.action(stream, 'read', 'owned-input')
        self.assertEqual(repeated['code'], 0, repeated)
        self.assertEqual(self.reads(), before)
        self.assertEqual(json.loads(repeated['stdout'])[0]['nativeInputStatus']['read'],
                         'recorded')
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        self.assertIsNone(self.fx.coord('delivery', 'foreign-input')['receipt'])
        # The controlled coordinator exchange explicitly confirms its task.
        self.end(child, stream, complete_task=True)
        after = self.reads()
        receipt = 'native-turn:' + after[0]['attempt']
        self.assertTrue(all(row['handled'] == receipt for row in after))
        self.assertEqual(self.fx.coord('delivery', 'owned-input')['receipt'], receipt)
        self.assertEqual(self.fx.coord('delivery', 'already-handled')['receipt'],
                         'earliest receipt')
        self.assertIsNone(self.fx.coord('delivery', 'foreign-input')['receipt'])
        self.fx.shutdown_idle_database_owner('successful input observer did not settle')

    def test_full_inbox_records_its_owned_items(self):
        self.fx.coord('message', 'second-owned-input', 'root', 'parent', 'guidance',
                      'Second complete input.\n')
        child, stream, _ = self.start()
        result = self.action(stream, 'inbox')
        self.assertEqual(result['code'], 0, result)
        self.assertEqual({row['id'] for row in json.loads(result['stdout'])},
                         {'owned-input', 'second-owned-input'})
        self.assertEqual({row['message'] for row in self.reads()},
                         {'owned-input', 'second-owned-input'})
        self.end(child, stream, complete_task=True)
        self.assertTrue(all(row['handled'] for row in self.reads()))
        self.fx.shutdown_idle_database_owner('full inbox observer did not settle')

    def test_failed_native_turn_retains_reads_without_handling(self):
        self.fx.prepare_input('open-assignment', 'parent', 'Keep this assignment open.',
                              kind='task')
        child, stream, _ = self.start()
        result = self.action(stream, 'read', 'owned-input')
        self.assertEqual(result['code'], 0, result)
        self.end(child, stream, failed=True)
        self.assertEqual({row['message'] for row in self.reads()},
                         {'owned-input', 'open-assignment'})
        self.assertTrue(all(row['handled'] is None for row in self.reads()))
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        self.assertTrue(self.fx.coord('session', 'parent')['taskCompletion']['open'])

    def test_missing_terminal_retains_reads_without_handling(self):
        child, stream, _ = self.start()
        self.assertEqual(self.action(stream, 'read', 'owned-input')['code'], 0)
        self.fx.action(stream, stdout_fragment='{"type":')
        self.assertEqual(json.loads(stream.readline()), {'fragment_written': '{"type":'})
        self.fx.action(stream, exit_fixture=True)
        self.fx.finish(child, ok=False)
        self.assertEqual(len(self.reads()), 1)
        self.assertIsNone(self.reads()[0]['handled'])
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])

    def test_initial_read_preserves_original_native_after_explicit_connect(self):
        child, stream, started = self.start()
        before = self.reads()
        self.assertEqual(before[0]['native'], started['native'])
        self.fx.coord('connect', 'parent', 'replacement-native', '')
        self.end(child, stream)
        self.assertEqual(self.fx.coord('session', 'parent')['native'], 'replacement-native')
        self.assertEqual(self.reads(), before)
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])

    def test_unavailable_status_preserves_successful_exposure_without_handling(self):
        child, stream, _ = self.start()
        with sqlite3.connect(f'{self.fx.db.as_uri()}?mode=ro', uri=True) as database:
            directory = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent'"
            ).fetchone()[0])
        self.assertTrue(directory.is_relative_to(self.fx.directory))
        status = directory / 'status'
        status.symlink_to('status')
        self.addCleanup(status.unlink, missing_ok=True)
        result = self.action(stream, 'read', 'owned-input')
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(json.loads(result['stdout'])[0]['delivery']['body'],
                         'Complete owned input.\nλ🙂\n')
        self.assertEqual(len(self.reads()), 1)
        self.assertIsNone(self.reads()[0]['handled'])
        # The controlled status path also prevents the keeper's exclusive
        # terminal write. Its natural observer failure cannot handle the read.
        self.fx.action(stream, body='Controlled native result.', ack=False,
                       complete_task=False)
        self.fx.finish(child, ok=False)
        self.assertEqual(len(self.reads()), 1)
        self.assertIsNone(self.reads()[0]['handled'])
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])

    def test_operator_stop_preserves_read_with_incomplete_handling(self):
        child, stream, _ = self.start()
        self.assertEqual(self.action(stream, 'read', 'owned-input')['code'], 0)
        self.fx.coord('stop', 'parent', 'input-status-stop',
                      'Preserve this controlled operator stop.')
        self.fx.finish(child, ok=False)
        self.assertEqual(len(self.reads()), 1)
        self.assertIsNone(self.reads()[0]['handled'])
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        self.assertEqual(self.fx.coord('session', 'parent')['stop']['id'],
                         'input-status-stop')

    @unittest.skipUnless(pathlib.Path('/dev/full').exists(), 'requires /dev/full')
    def test_failed_action_output_records_no_read(self):
        child, stream, _ = self.start()
        self.fx.coord('message', 'late-owned-input', 'root', 'parent', 'guidance',
                      'Input admitted after the original prompt.\nλ🙂')
        result = self.action(stream, 'read', 'late-owned-input', output_file='/dev/full')
        self.assertNotEqual(result['code'], 0, result)
        self.assertTrue(result['stderr'], result)
        self.assertEqual({row['message'] for row in self.reads()}, {'owned-input'})
        self.end(child, stream, failed=True)
        self.assertNotIn('late-owned-input', {row['message'] for row in self.reads()})
        self.assertIsNone(self.fx.coord('delivery', 'late-owned-input')['receipt'])

    def test_administrative_and_foreign_reads_preserve_observations(self):
        self.fx.coord('as', 'parent', 'read', 'owned-input')
        self.fx.coord('as', 'root', 'read', 'owned-input')
        self.fx.coord('delivery', 'owned-input')
        self.assertEqual(self.reads(), [])
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        child, stream, _ = self.start()
        before = self.reads()
        result = self.action(stream, 'read', 'foreign-input')
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(self.reads(), before)
        self.end(child, stream, failed=True)
        self.assertIsNone(self.fx.coord('delivery', 'foreign-input')['receipt'])

    def test_complete_initial_prompt_handles_exact_receive_and_direct_input(self):
        text = 'Complete initial task with λ🙂, quotes " and a final newline.\n'
        task = self.fx.directory / 'initial task.txt'
        task.write_text(text)
        for harness in ('codex', 'omp', 'claude-code', 'muse'):
            for mode in ('receive', 'direct'):
                with self.subTest(harness=harness, mode=mode):
                    name = 'initial-' + harness + '-' + mode
                    self.fx.player(name, harness=harness)
                    ident = name + '-request'
                    if mode == 'receive':
                        self.fx.prepare_input(ident, name, text, kind='task')
                        child = self.fx.spawn(*self.fx.receive_args(name))
                    else:
                        child = self.fx.spawn('turn', name, ident, str(self.fx.fixture),
                                             name, 'low', str(self.fx.directory),
                                             str(task), str(self.fx.directory / (name + '.jsonl')), '')
                        ident += ':task-input'
                    stream, started = self.fx.accept_child(child, name)
                    self.assertIn('[id: ' + ident + ']:\n' + text, started['prompt'])
                    self.fx.action(stream, body='Initial input completed.', ack=False,
                                   complete_task=False)
                    self.fx.finish(child)
                    self.fx.shutdown_idle_database_owner('Initial input turn did not settle.')
                    rows = [row for row in self.reads() if row['message'] == ident]
                    self.assertEqual(len(rows), 1, rows)
                    self.assertEqual(rows[0]['native'], started['native'])
                    self.assertEqual(rows[0]['handled'], 'native-turn:' + rows[0]['attempt'])
                    delivered = self.fx.coord('delivery', ident)
                    self.assertEqual(delivered['body'], text)
                    self.assertEqual(delivered['receipt'], rows[0]['handled'])
                    self.assertEqual(delivered['nativeInputStatus']['handled'], 'recorded')
                    detail = self.fx.coord('input', ident)
                    self.assertEqual(detail['message']['nativeInputStatus']['read'], 'recorded')
                    self.assertEqual(detail['attemptRelation']['attempts'][0]['native'], started['native'])
                    state = self.fx.coord('session', name)['taskCompletion']
                    self.assertEqual(state['assignmentId'], ident)
                    self.assertTrue(state['open'])
                    self.assertFalse(state['confirmed'])

    def test_failed_initial_stdin_is_read_but_unhandled_and_muse_remains_unrecorded(self):
        for harness in ('codex', 'omp', 'claude-code', 'muse'):
            with self.subTest(harness=harness):
                name = 'failed-initial-' + harness
                self.fx.player(name, harness=harness)
                ident = name + '-input'
                self.fx.prepare_input(ident, name, 'Full input before provider failure.\nλ🙂', kind='task')
                child = self.fx.spawn(*self.fx.receive_args(name))
                stream, started = self.fx.accept_child(child, name)
                self.fx.action(stream, body='Retained failure result.', fail=True,
                               ack=False, complete_task=False)
                self.fx.finish(child, ok=False)
                rows = [row for row in self.reads() if row['message'] == ident]
                if harness == 'muse':
                    self.assertEqual(rows, [])
                else:
                    self.assertEqual(len(rows), 1, rows)
                    self.assertEqual(rows[0]['native'], started['native'])
                    self.assertIsNone(rows[0]['handled'])
                self.assertIsNone(self.fx.coord('delivery', ident)['receipt'])
                self.assertTrue(self.fx.coord('session', name)['taskCompletion']['open'])

    def test_quoted_earlier_owned_input_is_not_a_producer_selected_message(self):
        earlier = 'Earlier complete body.\nλ🙂'
        self.fx.prepare_input('quoted-earlier', 'parent', earlier, kind='task')
        self.fx.coord('ack', 'quoted-earlier', 'parent', 'Earlier explicit receipt.')
        quote = 'Message (task) from root [id: quoted-earlier]:\n' + earlier
        self.fx.prepare_input('actual-selected', 'parent', 'Task includes an exact quotation:\n' + quote,
                              kind='task')
        child, stream, started = self.start()
        self.assertIn(quote, started['prompt'])
        self.end(child, stream)
        self.assertEqual({row['message'] for row in self.reads()},
                         {'owned-input', 'actual-selected'})
        self.assertEqual(self.fx.coord('delivery', 'quoted-earlier')['receipt'],
                         'Earlier explicit receipt.')
        self.assertEqual(self.fx.coord('delivery', 'quoted-earlier')['nativeInputStatus']['read'],
                         'unrecorded')

    def app_action(self, *arguments, native='native-root', output=None):
        environment = os.environ.copy()
        environment['CODEX_THREAD_ID'] = native
        for name in ('BATON_DATABASE', 'BATON_SESSION', 'BATON_ATTEMPT_DIRECTORY'):
            environment.pop(name, None)
        command = [str(receive.EXE), str(self.fx.db), 'as', 'root', *arguments]
        return subprocess.run(command, stdout=output or subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=environment)

    def app_terminal(self, turn, status):
        body = {'type': 'codex-inbox-turn-settled', 'session': 'root',
                'threadId': 'native-root', 'turn': {'id': turn, 'status': status},
                'completedItems': []}
        report = self.fx.directory / ('terminal-' + turn + '.json')
        report.write_text(json.dumps(body))
        self.fx.coord('report-file', 'codex-inbox-turn:root:native-root:' + turn,
                      'root', str(report))
        return self.fx.coord('settle-agent-input', 'root', 'native-root', turn, status)

    def test_app_full_read_handles_exact_turn_after_explicit_first_ack(self):
        self.fx.prepare_input('app-task', 'root', 'Actual App task.\nλ🙂', kind='task')
        self.fx.prepare_input('app-guidance', 'root', 'Actual App guidance.\n', kind='guidance')
        before = self.fx.coord('session', 'root')['taskCompletion']
        result = self.app_action('read', 'app-task', 'app-guidance', 'foreign-input', 'absent')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]['delivery']['body'], 'Actual App task.\nλ🙂')
        rows = self.reads()
        self.assertEqual({row['message'] for row in rows}, {'app-task', 'app-guidance', 'foreign-input'})
        self.assertTrue(all(row['attempt'] == 'codex-turn:fixture-turn' and
                            row['native'] == 'native-root' and row['handled'] is None for row in rows))
        self.fx.coord('ack', 'app-task', 'root', 'Explicit earliest receipt.')
        result = self.app_terminal('fixture-turn', 'completed')
        self.assertEqual(result['status'], 'settled')
        self.assertEqual(self.fx.coord('delivery', 'app-task')['receipt'], 'Explicit earliest receipt.')
        self.assertEqual(self.fx.coord('delivery', 'app-guidance')['receipt'],
                         'native-turn:codex-turn:fixture-turn')
        self.assertEqual(self.fx.coord('session', 'root')['taskCompletion'], before)
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        handled = self.reads()
        self.fx.coord('settle-agent-input', 'root', 'native-root', 'fixture-turn', 'completed')
        self.assertEqual(self.reads(), handled)
        self.assertEqual(self.fx.coord('delivery', 'app-task')['receipt'], 'Explicit earliest receipt.')

    def test_app_foreign_context_failure_stop_and_missing_terminal_preserve_reads(self):
        self.fx.prepare_input('app-task', 'root', 'Unfinished App input.', kind='task')
        result = self.app_action('read', 'app-task', native='foreign-native')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.reads(), [])
        result = self.app_action('read', 'owned-input')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.reads(), [])
        result = self.app_action('read', 'app-task')
        self.assertEqual(result.returncode, 0, result.stderr)
        missing = self.fx.coord('settle-agent-input', 'root', 'native-root',
                                'fixture-turn', 'completed')
        self.assertEqual(missing['status'], 'incomplete')
        self.assertIsNone(self.fx.coord('delivery', 'app-task')['receipt'])
        result = self.app_terminal('fixture-turn', 'failed')
        self.assertEqual(result['status'], 'incomplete')
        self.fx.coord('stop', 'root', 'app-stop', 'Keep the explicit operator stop.')
        self.fx.coord('settle-agent-input', 'root', 'native-root', 'fixture-turn', 'completed')
        self.assertTrue(all(row['handled'] is None for row in self.reads()))
        self.assertIsNone(self.fx.coord('delivery', 'app-task')['receipt'])

    def test_app_inactive_native_and_changed_binding_keep_handling_incomplete(self):
        self.fx.prepare_input('app-task', 'root', 'Input whose native route changes.', kind='task')
        proxy = self.fx.directory / 'codex'
        source = proxy.read_text()
        proxy.write_text(source.replace("'type':'active'", "'type':'idle'"))
        result = self.app_action('read', 'app-task')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)[0]['delivery']['body'],
                         'Input whose native route changes.')
        self.assertEqual(self.reads(), [])
        proxy.write_text(source)
        self.assertEqual(self.app_action('read', 'app-task').returncode, 0)
        body = {'type': 'codex-inbox-turn-settled', 'session': 'root',
                'threadId': 'native-root',
                'turn': {'id': 'fixture-turn', 'status': 'completed'},
                'completedItems': []}
        report = self.fx.directory / 'completed-before-rebind.json'
        report.write_text(json.dumps(body))
        self.fx.coord('report-file', 'codex-inbox-turn:root:native-root:fixture-turn',
                      'root', str(report))
        self.fx.coord('connect', 'root', 'replacement-native', '')
        result = self.fx.coord('settle-agent-input', 'root', 'native-root',
                               'fixture-turn', 'completed')
        self.assertEqual(result['status'], 'incomplete')
        self.assertTrue(all(row['handled'] is None for row in self.reads()))
        self.assertIsNone(self.fx.coord('delivery', 'app-task')['receipt'])

    @unittest.skipUnless(pathlib.Path('/dev/full').exists(), 'requires /dev/full')
    def test_app_failed_stdout_keeps_complete_input_unrecorded(self):
        self.fx.prepare_input('app-task', 'root', 'Input whose stdout write fails.', kind='task')
        with open('/dev/full', 'wb', buffering=0) as output:
            result = self.app_action('read', 'app-task', output=output)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.reads(), [])
        self.assertIsNone(self.fx.coord('delivery', 'app-task')['receipt'])

    def test_legacy_complete_reads_record_owned_input_and_index_remains_observational(self):
        child, stream, _ = self.start()
        body = 'Complete late legacy input.\nλ🙂\n'
        self.fx.coord('message', 'late-legacy-input', 'root', 'parent', 'guidance', body)
        before = self.reads()
        result = self.action(stream, 'inbox', 'parent', '--index', legacy=True)
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(self.reads(), before)
        result = self.action(stream, 'delivery', 'late-legacy-input', '--pretty', legacy=True)
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(json.loads(result['stdout'])['body'], body)
        self.assertEqual({row['message'] for row in self.reads()}, {'owned-input', 'late-legacy-input'})
        result = self.action(stream, 'delivery-batch', '["late-legacy-input","foreign-input"]', legacy=True)
        self.assertEqual(result['code'], 0, result)
        self.assertEqual({row['message'] for row in self.reads()}, {'owned-input', 'late-legacy-input'})
        self.end(child, stream, failed=True)
        self.assertTrue(all(row['handled'] is None for row in self.reads()))

    def test_old_schema_read_is_observational_and_reports_unrecorded(self):
        with sqlite3.connect(self.fx.db) as database:
            database.execute('DROP TABLE message_reads')
        body = self.fx.coord('delivery', 'owned-input')
        self.assertEqual(body['nativeInputStatus'],
                         {'delivered': 'unrecorded', 'read': 'unrecorded',
                          'handled': 'unrecorded', 'attempts': []})
        self.assertEqual(self.fx.coord('input', 'owned-input')['attemptRelation']['status'],
                         'unrecorded')
        with sqlite3.connect(f'{self.fx.db.as_uri()}?mode=ro', uri=True) as database:
            self.assertIsNone(database.execute(
                "SELECT name FROM sqlite_master WHERE name='message_reads'").fetchone())


if __name__ == '__main__':
    unittest.main()
