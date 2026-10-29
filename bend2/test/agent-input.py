"""Owned native reads through controlled retained turns."""

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

    def legacy_receipt(self, ident, receipt):
        with sqlite3.connect(str(self.fx.db)) as db:
            db.execute('UPDATE messages SET receipt=? WHERE id=?', (receipt, ident))

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

    def end(self, child, stream, *, failed=False, complete_task=False, successor_body=None):
        self.fx.action(stream, body='Controlled native result.', ack=False,
                       complete_task=complete_task, fail=failed)
        if successor_body is not None:
            self.assertEqual(stream.readline(), b'')
            successor, started = self.fx.accept_child(child, 'parent')
            self.assertIn(successor_body, started['prompt'])
            self.fx.action(successor, body='Controlled pending input failure.', ack=False,
                           complete_task=False, fail=True)
        return self.fx.finish(child, ok=not failed)

    def test_success_records_exact_owned_full_read_and_preserves_legacy_receipt(self):
        self.fx.prepare_input('already-handled', 'parent', 'Earlier handled input.\n',
                              kind='task')
        self.legacy_receipt('already-handled', 'earliest receipt')
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
        owned = [row for row in after if row['message'] == 'owned-input']
        self.assertTrue(owned)
        self.assertTrue(all(row['handled'] is None for row in owned))
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        self.assertEqual(self.fx.coord('delivery', 'already-handled')['receipt'],
                         'earliest receipt')
        self.assertIsNone(self.fx.coord('delivery', 'foreign-input')['receipt'])
        self.fx.shutdown_idle_database_owner('successful input observer did not record reads')

    def test_full_inbox_records_its_owned_items(self):
        self.fx.prepare_input('second-owned-input', 'parent', 'Second complete input.\n',
                              kind='guidance')
        child, stream, _ = self.start()
        result = self.action(stream, 'inbox')
        self.assertEqual(result['code'], 0, result)
        self.assertEqual({row['id'] for row in json.loads(result['stdout'])},
                         {'owned-input', 'second-owned-input'})
        self.assertEqual({row['message'] for row in self.reads()},
                         {'owned-input', 'second-owned-input'})
        self.end(child, stream, complete_task=True)
        rows = self.reads()
        self.assertTrue(all(row['handled'] is None for row in rows))
        self.assertEqual({row['message'] for row in rows},
                         {'owned-input', 'second-owned-input'})
        self.assertEqual(self.fx.coord('inbox', 'parent'), [])
        self.fx.shutdown_idle_database_owner('full inbox observer did not record reads')

    def test_read_set_bounds_redelivery_and_legacy_receipt_is_preserved(self):
        child, stream, started = self.start()
        self.fx.coord('message', 'ack-read-owned', 'root', 'parent', 'guidance',
                      'Complete late owned input.\nλ🙂\n')
        self.fx.coord('message', 'ack-unread-owned', 'root', 'parent', 'guidance',
                      'This late input has not been read.')
        self.fx.coord('message', 'ack-first-receipt', 'root', 'parent', 'guidance',
                      'Retain the first explicit receipt.')
        self.legacy_receipt('ack-first-receipt', 'Earliest explicit handling.')
        before = self.reads()
        indexed = self.action(stream, 'pending', '--index', legacy=True)
        self.assertEqual(indexed['code'], 0, indexed)
        self.assertEqual(self.reads(), before)
        result = self.action(stream, 'read', 'ack-read-owned', 'foreign-input',
                             'ack-first-receipt')
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(json.loads(result['stdout'])[0]['delivery']['body'],
                         'Complete late owned input.\nλ🙂\n')
        read_set = self.reads()
        self.assertEqual({row['message'] for row in read_set},
                         {'owned-input', 'ack-read-owned', 'ack-first-receipt'})
        self.assertTrue(all(row['recipient'] == 'parent' and
                            row['native'] == started['native'] for row in read_set))
        state = self.fx.coord('session', 'parent')['taskCompletion']
        # The acknowledge action is removed: read recording is the read evidence.
        refused = self.action(stream, 'acknowledge')
        self.assertEqual(refused['code'], 2, refused)
        self.assertIn('Choose inbox, read', refused['stderr'])
        for ident in ('owned-input', 'ack-read-owned'):
            self.assertIsNone(self.fx.coord('delivery', ident)['receipt'])
            self.assertEqual(self.fx.coord('delivery', ident)['nativeInputStatus']['read'],
                             'recorded')
        self.assertEqual(self.fx.coord('delivery', 'ack-first-receipt')['receipt'],
                         'Earliest explicit handling.')
        for ident in ('foreign-input', 'ack-unread-owned'):
            self.assertIsNone(self.fx.coord('delivery', ident)['receipt'])
        self.assertEqual(self.fx.coord('session', 'parent')['taskCompletion'], state)
        self.end(child, stream, failed=True,
                 successor_body='This late input has not been read.')
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        self.assertEqual(self.fx.coord('delivery', 'owned-input')['nativeInputStatus']['read'],
                         'recorded')
        self.assertIsNone(self.fx.coord('delivery', 'ack-unread-owned')['receipt'])

    def test_full_pending_records_late_owned_input_and_pretty_preserves_foreign_rows(self):
        child, stream, started = self.start()
        initial = self.reads()
        late_body = 'Late complete input through pending.\nλ🙂\n'
        foreign_body = 'Late complete foreign report.\nλ🙂\n'
        self.fx.coord('message', 'late-pending-owned', 'root', 'parent', 'guidance',
                      late_body)
        self.fx.coord('message', 'late-pending-foreign', 'parent', 'root', 'report',
                      foreign_body)
        index = self.action(stream, 'pending', '--index', legacy=True)
        self.assertEqual(index['code'], 0, index)
        metadata = {row['id']: row for row in json.loads(index['stdout'])}
        self.assertIn('late-pending-owned', metadata)
        self.assertIn('late-pending-foreign', metadata)
        self.assertNotIn('body', metadata['late-pending-owned'])
        self.assertEqual(self.reads(), initial)

        result = self.action(stream, 'pending')
        self.assertEqual(result['code'], 0, result)
        item, = json.loads(result['stdout'])
        self.assertEqual(item['status'], 'completed', item)
        self.assertEqual(item['waitStatus'], 'exit 0', item)
        exposed = {row['id']: row for row in json.loads(item['stdout'])}
        self.assertEqual(exposed['late-pending-owned']['body'], late_body)
        self.assertEqual(exposed['late-pending-foreign']['body'], foreign_body)
        self.assertEqual({row['message'] for row in self.reads()},
                         {'owned-input', 'late-pending-owned'})

        pretty_body = 'Late complete input through pretty pending.\nλ🙂\n'
        self.fx.coord('message', 'late-pending-pretty', 'root', 'parent', 'guidance',
                      pretty_body)
        pretty = self.action(stream, 'pending', '--pretty', legacy=True)
        self.assertEqual(pretty['code'], 0, pretty)
        formatted = {row['id']: row for row in json.loads(pretty['stdout'])}
        self.assertEqual(formatted['late-pending-pretty']['body'], pretty_body)
        self.assertEqual(formatted['late-pending-foreign']['body'], foreign_body)
        before = self.reads()
        self.assertEqual({row['message'] for row in before},
                         {'owned-input', 'late-pending-owned', 'late-pending-pretty'})
        self.assertTrue(all(row['recipient'] == 'parent' and
                            row['native'] == started['native'] and row['identity'] and
                            row['handled'] is None for row in before))
        for row in before:
            self.assertIsNone(self.fx.coord('delivery', row['message'])['receipt'])
        self.assertIsNone(self.fx.coord('delivery', 'late-pending-foreign')['receipt'])

        self.end(child, stream, complete_task=True)
        after = self.reads()
        self.assertEqual({row['message'] for row in after},
                         {row['message'] for row in before})
        self.assertTrue(all(row['handled'] is None for row in after))
        for row in after:
            self.assertIsNone(self.fx.coord('delivery', row['message'])['receipt'])
        self.assertIsNone(self.fx.coord('delivery', 'foreign-input')['receipt'])
        self.assertIsNone(self.fx.coord('delivery', 'late-pending-foreign')['receipt'])
        self.fx.shutdown_idle_database_owner('full pending observer did not record reads')

    def test_failed_native_turn_retains_reads(self):
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

    def test_missing_terminal_retains_reads(self):
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
        self.fx.action(stream, body='Controlled native result.', ack=False,
                       complete_task=False)
        self.fx.finish_without_start(child)
        calls = [json.loads(line) for line in self.fx.codex_calls.read_text().splitlines()]
        replacement = [call for call in calls
                       if call['params']['threadId'] == 'replacement-native']
        self.assertEqual(len(replacement), 1, calls)
        self.assertEqual(replacement[0]['method'], 'turn/steer')
        self.assertEqual(self.fx.coord('session', 'parent')['native'], 'replacement-native')
        self.assertEqual([row for row in self.reads() if row['attempt'] == before[0]['attempt']], before)
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])

    def test_unavailable_status_preserves_successful_exposure(self):
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

    def test_operator_stop_preserves_read(self):
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
        original = next(row['attempt'] for row in self.reads() if row['message'] == 'owned-input')
        self.fx.coord('message', 'late-owned-input', 'root', 'parent', 'guidance',
                      'Input admitted after the original prompt.\nλ🙂')
        result = self.action(stream, 'read', 'late-owned-input', output_file='/dev/full')
        self.assertNotEqual(result['code'], 0, result)
        self.assertTrue(result['stderr'], result)
        self.assertEqual({row['message'] for row in self.reads()}, {'owned-input'})
        self.fx.action(stream, body='Controlled native result.', ack=False,
                       complete_task=False, fail=True)
        self.assertEqual(stream.readline(), b'')
        successor, started = self.fx.accept_child(child, 'parent')
        self.assertIn('Input admitted after the original prompt.\nλ🙂', started['prompt'])
        self.assertNotIn('late-owned-input',
                         {row['message'] for row in self.reads() if row['attempt'] == original})
        self.end(child, successor, failed=True)
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

    def test_complete_initial_prompt_records_exact_receive_and_direct_reads(self):
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
                    successor = self.fx.accept_or_child_exit(
                        child, 'Initial input turn did not settle.', allow_exit=True)
                    if successor is not None:
                        next_stream, next_started = successor
                        self.fx.action(next_stream, exit_fixture=True)
                        self.fail('Initial input admitted another native before the receive '
                                  'child exited: ' + json.dumps({
                                      'native': next_started,
                                      'input': self.fx.coord('delivery', ident),
                                      'turns': self.fx.coord('turns', name),
                                  }, ensure_ascii=False))
                    self.fx.finish(child)
                    self.fx.shutdown_idle_database_owner('Initial input turn did not settle.')
                    rows = [row for row in self.reads() if row['message'] == ident]
                    self.assertEqual(len(rows), 1, rows)
                    self.assertEqual(rows[0]['native'], started['native'])
                    self.assertIsNone(rows[0]['handled'])
                    delivered = self.fx.coord('delivery', ident)
                    self.assertEqual(delivered['body'], text)
                    self.assertIsNone(delivered['receipt'])
                    self.assertNotIn('handled', delivered['nativeInputStatus'])
                    detail = self.fx.coord('input', ident)
                    self.assertEqual(detail['message']['nativeInputStatus']['read'], 'recorded')
                    self.assertEqual(detail['attemptRelation']['attempts'][0]['native'], started['native'])
                    state = self.fx.coord('session', name)['taskCompletion']
                    self.assertEqual(state['assignmentId'], ident)
                    self.assertTrue(state['open'])
                    self.assertFalse(state['confirmed'])

    def test_failed_initial_stdin_records_the_read_for_every_harness(self):
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
                self.assertEqual(len(rows), 1, rows)
                self.assertEqual(rows[0]['native'], started['native'])
                self.assertIsNone(rows[0]['handled'])
                self.assertIsNone(self.fx.coord('delivery', ident)['receipt'])
                self.assertTrue(self.fx.coord('session', name)['taskCompletion']['open'])

    def test_quoted_earlier_owned_input_is_not_a_producer_selected_message(self):
        earlier = 'Earlier complete body.\nλ🙂'
        self.fx.prepare_input('quoted-earlier', 'parent', earlier, kind='task')
        self.legacy_receipt('quoted-earlier', 'Earlier explicit receipt.')
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
        # The legacy receipt backfills a synthetic read row, so the stored message
        # reads as read; no current-attempt row exists for it.
        status = self.fx.coord('delivery', 'quoted-earlier')['nativeInputStatus']
        self.assertEqual(status['read'], 'recorded')
        self.assertTrue(all(row['identity'] == 'receipt' for row in status['attempts']))

    def app_action(self, *arguments, native='native-root', session=None, output=None, mcp_context=None):
        environment = os.environ.copy()
        environment['CODEX_THREAD_ID'] = native
        for name in ('BATON_DATABASE', 'BATON_SESSION', 'BATON_ATTEMPT_DIRECTORY',
                     'BATON_MCP_INPUT'):
            environment.pop(name, None)
        if session is not None:
            environment['BATON_SESSION'] = session
        if mcp_context is not None:
            environment['BATON_MCP_INPUT'] = json.dumps(mcp_context)
        command = [str(receive.EXE), str(self.fx.db), 'as', 'root', *arguments]
        return subprocess.run(command, stdout=output or subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=environment)

    def test_root_channel_read_records_a_connection_scoped_codex_witness(self):
        ident = 'root-channel-codex-read'
        self.fx.prepare_input(ident, 'root', 'Complete remote root input. λ🙂', kind='report')
        database = str(self.fx.db.resolve())
        endpoint = json.dumps([str(receive.EXE.resolve()), '/release/mcp-conductor.mjs',
                               database, str(receive.EXE.resolve()), '--session', 'root',
                               '--deliver', 'conductor-root.sock'])
        with sqlite3.connect(str(self.fx.db)) as db:
            db.execute("UPDATE sessions SET harness='codex',native='native-root',endpoint=? WHERE id='root'",
                       (endpoint,))
        context = {'ready': True, 'database': database, 'session': 'root',
                   'native': 'native-root', 'harness': 'codex', 'endpoint': endpoint,
                   'connection': 'connection-1', 'readMessage': ident}
        result = self.app_action('delivery', ident, native='native-root', session='root',
                                 mcp_context=context)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['body'], 'Complete remote root input. λ🙂')
        rows = [row for row in self.reads() if row['message'] == ident]
        self.assertTrue(any(row['native'] == 'native-root' and
                            row['attempt'] == 'root-channel:connection-1' and
                            row['identity'] == 'root-channel:connection-1:' + ident for row in rows), rows)
        self.assertTrue(all(row['handled'] is None for row in rows))

    def test_root_channel_codex_witness_cannot_read_a_different_message(self):
        ident = 'root-channel-codex-read'
        self.fx.prepare_input(ident, 'root', 'Complete remote root input.', kind='report')
        database = str(self.fx.db.resolve())
        endpoint = json.dumps([str(receive.EXE.resolve()), '/release/mcp-conductor.mjs',
                               database, str(receive.EXE.resolve()), '--session', 'root',
                               '--deliver', 'conductor-root.sock'])
        with sqlite3.connect(str(self.fx.db)) as db:
            db.execute("UPDATE sessions SET harness='codex',native='native-root',endpoint=? WHERE id='root'",
                       (endpoint,))
        context = {'ready': True, 'database': database, 'session': 'root',
                   'native': 'native-root', 'harness': 'codex', 'endpoint': endpoint,
                   'connection': 'connection-1', 'readMessage': 'another-message'}
        result = self.app_action('delivery', ident, native='native-root', session='root',
                                 mcp_context=context)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn(ident, {row['message'] for row in self.reads()})

    def test_app_pending_uses_explicit_session_when_codex_lookup_is_unmatched(self):
        self.fx.prepare_input('root-pending', 'root', 'Root pending input.\n', kind='guidance')
        self.fx.prepare_input('parent-pending', 'parent', 'Parent pending input.\n', kind='guidance')
        result = self.app_action('pending', '--pretty', native='unmatched-native', session='root')
        self.assertEqual(result.returncode, 0, result.stderr)
        pending = json.loads(result.stdout)
        self.assertEqual([row['id'] for row in pending], ['root-pending'])
        self.assertEqual(pending[0]['body'], 'Root pending input.\n')
        # The explicit session selects the pending recipient. The unmatched
        # Codex native does not identify a turn that can own a read record.
        self.assertEqual(self.reads(), [])
        self.assertIsNone(self.fx.coord('delivery', 'root-pending')['receipt'])
        self.assertIsNone(self.fx.coord('delivery', 'parent-pending')['receipt'])

    def test_app_full_read_records_exact_turn_and_preserves_legacy_receipt(self):
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
        self.legacy_receipt('app-task', 'Explicit earliest receipt.')
        self.assertEqual(self.fx.coord('delivery', 'app-task')['receipt'], 'Explicit earliest receipt.')
        self.assertIsNone(self.fx.coord('delivery', 'app-guidance')['receipt'])
        self.assertEqual(self.fx.coord('delivery', 'app-guidance')['nativeInputStatus']['read'],
                         'recorded')
        self.assertEqual(self.fx.coord('session', 'root')['taskCompletion'], before)
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])
        # A repeated read of the same input adds no row and writes no receipt.
        handled = self.reads()
        self.assertEqual(self.app_action('read', 'app-guidance').returncode, 0)
        self.assertEqual(self.reads(), handled)
        self.assertEqual(self.fx.coord('delivery', 'app-task')['receipt'], 'Explicit earliest receipt.')

    def test_app_reads_preserve_previous_attempt_and_unread_inputs(self):
        self.fx.prepare_input('app-earlier-read', 'root', 'Earlier full native read.',
                              kind='guidance')
        result = self.app_action('read', 'app-earlier-read')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.reads()[0]['attempt'], 'codex-turn:fixture-turn')
        proxy = self.fx.directory / 'codex'
        proxy.write_text(proxy.read_text().replace("'fixture-turn'", "'next-read-turn'"))
        self.fx.prepare_input('app-current-read', 'root', 'Current complete read.\nλ🙂',
                              kind='guidance')
        self.fx.prepare_input('app-current-unread', 'root', 'Unread current input.',
                              kind='guidance')
        result = self.app_action('read', 'app-current-read', 'owned-input')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]['delivery']['body'],
                         'Current complete read.\nλ🙂')
        self.assertEqual({(row['message'], row['attempt']) for row in self.reads()},
                         {('app-earlier-read', 'codex-turn:fixture-turn'),
                          ('app-current-read', 'codex-turn:next-read-turn')})
        before = self.reads()
        indexed = self.app_action('pending', '--index')
        self.assertEqual(indexed.returncode, 0, indexed.stderr)
        self.assertEqual(self.reads(), before)
        # The acknowledge action is removed everywhere, including foreign and
        # rebound native contexts.
        refused = self.app_action('acknowledge')
        self.assertEqual(refused.returncode, 2, refused.stderr)
        foreign = self.app_action('acknowledge', native='foreign-native')
        self.assertEqual(foreign.returncode, 2, foreign.stderr)
        self.assertEqual(self.reads(), before)
        for ident in ('app-earlier-read', 'app-current-unread', 'owned-input', 'foreign-input'):
            self.assertIsNone(self.fx.coord('delivery', ident)['receipt'])
        self.assertEqual(self.fx.coord('delivery', 'app-current-read')['nativeInputStatus']['read'],
                         'recorded')
        self.fx.coord('connect', 'root', 'replacement-native', '')
        replaced = self.app_action('acknowledge')
        self.assertEqual(replaced.returncode, 2, replaced.stderr)
        self.assertEqual(self.reads(), before)
        self.assertEqual(self.fx.coord('delivery', 'app-current-read')['nativeInputStatus']['read'],
                         'recorded')

    def test_app_read_keeps_explicit_operator_stop(self):
        self.fx.prepare_input('app-stopped-read', 'root', 'Complete input before stop.',
                              kind='task')
        read = self.app_action('read', 'app-stopped-read')
        self.assertEqual(read.returncode, 0, read.stderr)
        before = self.reads()
        self.fx.coord('stop', 'root', 'ack-operator-stop', 'Keep this explicit stop.')
        stopped = self.fx.coord('session', 'root')['stop']
        result = self.app_action('acknowledge')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(self.reads(), before)
        self.assertEqual(self.fx.coord('session', 'root')['stop'], stopped)
        self.assertEqual(stopped['id'], 'ack-operator-stop')
        self.assertIsNone(self.fx.coord('delivery', 'app-stopped-read')['receipt'])

    def test_app_foreign_context_and_stop_preserve_reads(self):
        self.fx.prepare_input('app-task', 'root', 'Unfinished App input.', kind='task')
        result = self.app_action('read', 'app-task', native='foreign-native')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.reads(), [])
        result = self.app_action('read', 'owned-input')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.reads(), [])
        result = self.app_action('read', 'app-task')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([row['message'] for row in self.reads()], ['app-task'])
        self.assertIsNone(self.fx.coord('delivery', 'app-task')['receipt'])
        self.fx.coord('stop', 'root', 'app-stop', 'Keep the explicit operator stop.')
        self.assertTrue(all(row['handled'] is None for row in self.reads()))
        self.assertEqual(self.fx.coord('delivery', 'app-task')['nativeInputStatus']['read'],
                         'recorded')
        self.assertIsNone(self.fx.coord('delivery', 'app-task')['receipt'])

    def test_app_inactive_native_and_changed_binding_preserve_reads(self):
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
        self.assertEqual([row['message'] for row in self.reads()], ['app-task'])
        self.fx.coord('connect', 'root', 'replacement-native', '')
        # A rebound native conversation keeps the earlier turn's read evidence.
        self.assertTrue(all(row['handled'] is None for row in self.reads()))
        self.assertEqual(self.fx.coord('delivery', 'app-task')['nativeInputStatus']['read'],
                         'recorded')
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
        self.fx.action(stream, body='Controlled native result.', ack=False,
                       complete_task=False, fail=True)
        self.assertEqual(stream.readline(), b'')
        successor, started = self.fx.accept_child(child, 'parent')
        self.assertIn(body, started['prompt'])
        self.end(child, successor, failed=True)
        self.assertTrue(all(row['handled'] is None for row in self.reads()))

    def test_old_schema_read_converges_and_reports_read_state(self):
        with sqlite3.connect(self.fx.db) as database:
            database.execute('DROP TABLE message_reads')
        body = self.fx.coord('delivery', 'owned-input')
        # The read path installs the current schema first; with no read rows the
        # stored message reports its delivered/unread state.
        self.assertEqual(body['nativeInputStatus'],
                         {'delivered': 'recorded', 'read': 'unrecorded', 'attempts': []})
        self.assertEqual(self.fx.coord('input', 'owned-input')['attemptRelation']['status'],
                         'unrecorded')
        with sqlite3.connect(f'{self.fx.db.as_uri()}?mode=ro', uri=True) as database:
            self.assertIsNotNone(database.execute(
                "SELECT name FROM sqlite_master WHERE name='message_reads'").fetchone())



    def test_forwarded_omp_input_kinds_record_reads_before_a_failed_turn(self):
        self.fx.player('omp-parent', harness='omp')
        self.fx.prepare_input('omp-owned-input', 'omp-parent', 'Complete OMP input.\nλ🙂\n',
                              kind='task')
        child = self.fx.spawn(*self.fx.receive_args('omp-parent'))
        stream, started = self.fx.accept_child(child, 'omp-parent')
        self.fx.eventually(lambda: self.fx.coord('player', 'omp-parent')['native'] == started['native'],
                           'The retained startup frame was not observed.')
        kinds = ('guidance', 'report', 'question', 'task', 'task-assignment',
                 'task-continuation', 'recovery', 'completion-request', 'completion-confirmed')
        expected_ids = {'omp-owned-input'}
        for index, kind in enumerate(kinds):
            ident = f'omp-input-{index}'
            body = f'Complete forwarded {kind} body.\nλ🙂\n'
            self.fx.action(stream, read_steer=True, signal_steer_wait=True,
                           check_steer_read=True)
            self.assertEqual(json.loads(stream.readline()), {'waiting_for_steer': True})
            self.fx.coord('message', ident, 'root', 'omp-parent', kind, body)
            steered = json.loads(stream.readline())['steer_received']
            self.assertEqual((steered['type'], steered['id']), ('steer', ident))
            expected = f'Message ({kind}) from root [id: {ident}]:\n{body}'
            if kind == 'completion-request':
                expected += ("\nReview the work against root's assignment and the supplied evidence. "
                             'Confirm with completion-confirmed --to root when the assignment is satisfied. '
                             'Otherwise use guide --to root --text TEXT to state what is missing and direct the remaining work.')
            self.assertEqual(steered['message'], expected)
            expected_ids.add(ident)
            self.assertEqual({row['message'] for row in self.reads()}, expected_ids)
            delivered = self.fx.coord('delivery', ident)
            self.assertIsNone(delivered['receipt'])
            self.assertEqual(delivered['nativeInputStatus']['read'], 'recorded')
        # Failed turn settlement preserves delivery-time read records.
        self.fx.action(stream, body='Controlled native result.', complete_task=False,
                       fail=True)
        self.fx.finish(child, ok=False)
        self.assertEqual({row['message'] for row in self.reads()}, expected_ids)
        self.assertEqual(self.fx.coord('inbox', 'omp-parent'), [])
        self.fx.shutdown_idle_database_owner('forwarded read observer did not exit')

    def test_legacy_receipt_counts_as_read_without_gating(self):
        # A historical database carries a receipted message with no read row.
        self.fx.prepare_input('legacy-receipted', 'parent', 'Receipted before reads existed.\n',
                              kind='task')
        self.legacy_receipt('legacy-receipted', 'historical receipt')
        # The next command converges the schema and backfills the read evidence.
        listed = self.fx.coord('inbox', 'parent')
        self.assertEqual([row['id'] for row in listed], ['owned-input'])
        status = self.fx.coord('delivery', 'legacy-receipted')['nativeInputStatus']
        self.assertEqual(status['read'], 'recorded')
        self.assertTrue(any(row['attempt'] == 'legacy' and row['identity'] == 'receipt'
                            for row in status['attempts']))
        # The legacy receipt does not gate a genuine later read.
        child, stream, _ = self.start()
        result = self.action(stream, 'read', 'legacy-receipted')
        self.assertEqual(result['code'], 0, result)
        self.assertEqual(json.loads(result['stdout'])[0]['delivery']['body'],
                         'Receipted before reads existed.\n')
        status = self.fx.coord('delivery', 'legacy-receipted')['nativeInputStatus']
        self.assertTrue(any(row['identity'] != 'receipt' for row in status['attempts']))
        self.assertEqual(self.fx.coord('delivery', 'legacy-receipted')['receipt'],
                         'historical receipt')
        self.fx.action(stream, body='Controlled native result.', complete_task=False)
        self.fx.finish(child)
        self.fx.shutdown_idle_database_owner('legacy read observer did not exit')

if __name__ == '__main__':
    unittest.main()
