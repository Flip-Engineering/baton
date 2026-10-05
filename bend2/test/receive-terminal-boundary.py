"""The managed completion boundary of a native receive.

The first native terminal seals the attempt's report under its managed
completion ID. A later terminal frame in the same native episode is named once
in the separate deferred diagnostic, and the guidance that attempt did not
accept stays pending for the continuation, which runs under its own managed
completion ID.
"""

import importlib.util
import json
import pathlib
import select
import sqlite3
import unittest

SPEC = importlib.util.spec_from_file_location(
    'receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
RECEIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECEIVE)


def late_terminal(text):
    return {'type': 'agent_end', 'isTerminal': True, 'is_error': False,
            'messages': [{'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}]}


def deferred_body(sealed, guidance):
    body = ('A later native terminal completed after the report ' + sealed +
            ' was sealed; the episode is retained in the native log')
    if guidance:
        body += ' and the deferred guidance ' + guidance + ' stays pending for the next receive'
    return body + '.'


class ReceiveTerminalBoundary(RECEIVE.Receive):
    def sealed_attempt(self, task, body, guidance=None):
        """Run the first terminal of an attempt and return its sealed report ID."""
        self.player(harness='omp')
        self.coord('message', task, 'root', 'parent', 'task', 'Task before the settled terminal.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        self.assertIn('[id: ' + task + ']', started['prompt'])
        self.action(stream, body=body, hold_exit=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True})
        sealed = self.eventually(lambda: self.coord('turns', 'parent'),
                                 'the sealed report was not recorded')[0]['id']
        if guidance:
            self.coord('message', guidance, 'root', 'parent', 'guidance',
                       'Guidance the sealed attempt does not accept.')
        return observer, stream, started, sealed

    def frame(self, stream, value):
        self.action(stream, native_request=value)
        self.assertEqual(json.loads(stream.readline()), {'request_written': value})

    def arrivals(self, timeout=10):
        found = []
        while select.select([self.server], [], [], timeout)[0]:
            found.append(self.accept_any())
        return found

    def test_late_error_terminal_keeps_the_sealed_report_and_defers_the_guidance(self):
        """An error terminal later in the same episode does not replace the sealed report."""
        observer, stream, started, sealed = self.sealed_attempt(
            'late-error-task', 'First sealed report.', 'late-error-guidance')
        self.frame(stream, {'type': 'response', 'command': 'steer', 'success': True,
                            'id': 'late-error-guidance'})
        self.assertIsNone(self.coord('delivery', 'late-error-guidance')['receipt'])
        self.frame(stream, {'type': 'agent_end', 'isTerminal': True,
                            'messages': [{'role': 'assistant', 'stopReason': 'error',
                                          'errorStatus': 403, 'errorMessage': '403 late failure',
                                          'provider': 'kimi-code', 'model': 'k3', 'content': []}]})
        self.action(stream, exit_fixture=True)
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: late-error-guidance]', resumed['prompt'])
        self.assertNotIn('[id: late-error-task]', resumed['prompt'])
        self.action(continuation, body='Continuation after the late error.')
        self.finish(observer)
        execution, _status = self.native_status()
        self.assertNotEqual(execution, sealed, 'the session row still names the sealed attempt')
        turns = self.coord('turns', 'parent')
        self.assertEqual(turns[0]['id'], sealed)
        self.assertEqual(turns[0]['reportBody'], 'First sealed report.')
        self.assertNotEqual(turns[1]['id'], sealed)
        self.assertEqual(self.coord('delivery', sealed)['body'], 'First sealed report.')
        notes = [report for report in self.coord('inbox', 'root')
                 if report['id'] == sealed + ':deferred']
        self.assertEqual([note['body'] for note in notes],
                         [deferred_body(sealed, 'late-error-guidance')])
        self.assertEqual(self.coord('delivery', 'late-error-guidance')['receipt'], 'native-reviewed')
        self.eventually(lambda: not self.owned_processes(), 'boundary fixtures did not exit')

    def stored_event(self, worker='parent'):
        """The stored turn event for this attempt, read from the store."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute("SELECT event FROM turns WHERE worker=? ORDER BY rowid LIMIT 1",
                                   (worker,)).fetchone()
        return row[0] if row else ''

    def native_status(self):
        """The execution row of the session, which the next attempt replaces."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute(
                "SELECT id, status FROM executions WHERE session='parent'").fetchone()
        self.assertIsNotNone(row, 'no execution row for the session')
        return row

    def test_same_attempt_error_then_late_success_keeps_the_sealed_failure(self):
        """A structured first provider failure is sealed; a later success in that episode does not replace it."""
        self.player(harness='omp')
        self.coord('message', 'same-attempt-task', 'root', 'parent', 'task',
                   'Task before the settled terminal.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        self.assertIn('[id: same-attempt-task]', started['prompt'])
        failure = {'type': 'agent_end', 'isTerminal': True, 'messages': [
            {'role': 'assistant', 'stopReason': 'error', 'errorStatus': 403,
             'errorMessage': '403 provider refused the request', 'provider': 'kimi-code',
             'model': 'k3', 'content': []}]}
        self.frame(stream, failure)
        turns = self.eventually(lambda: self.coord('turns', 'parent'),
                                'the sealed report was not recorded')
        sealed = turns[0]['id']
        self.assertIn('errorStatus', self.stored_event())
        self.assertIn('403 provider refused the request', self.stored_event())
        body = turns[0]['reportBody']
        self.assertIn('Native model failure', body)
        self.assertIn('403', body)
        self.assertIn('kimi-code', body)
        self.assertEqual(self.coord('delivery', sealed)['body'], body)
        self.coord('message', 'same-attempt-guidance', 'root', 'parent', 'guidance',
                   'Guidance the sealed attempt does not accept.')
        self.frame(stream, {'type': 'response', 'command': 'steer', 'success': True,
                            'id': 'same-attempt-guidance'})
        self.assertIsNone(self.coord('delivery', 'same-attempt-guidance')['receipt'])
        self.frame(stream, late_terminal('Later episode with a successful report.'))
        self.action(stream, exit_fixture=True)
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: same-attempt-guidance]', resumed['prompt'])
        self.assertIn('[id: same-attempt-task]', resumed['prompt'])
        self.action(continuation, body='Continuation after the sealed failure.')
        self.finish(observer, ok=False)
        execution, _status = self.native_status()
        self.assertNotEqual(execution, sealed, 'the session row still names the sealed attempt')
        turns = self.coord('turns', 'parent')
        self.assertEqual(turns[0]['id'], sealed)
        self.assertEqual(turns[0]['reportBody'], body)
        self.assertNotEqual(turns[1]['id'], sealed)
        self.assertEqual(self.coord('delivery', sealed)['body'], body)
        notes = [report for report in self.coord('inbox', 'root')
                 if report['id'] == sealed + ':deferred']
        self.assertEqual([note['body'] for note in notes],
                         [deferred_body(sealed, 'same-attempt-guidance')])
        self.assertEqual(self.coord('delivery', 'same-attempt-guidance')['receipt'], 'native-reviewed')
        self.eventually(lambda: not self.owned_processes(), 'boundary fixtures did not exit')

    def test_late_terminal_keeps_the_sealed_report_and_defers_the_guidance(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'boundary-task', 'First sealed report.', 'boundary-guidance')
        relevant = {'type': 'tool_execution_start', 'toolCallId': 't1', 'toolName': 'read'}
        self.frame(stream, relevant)
        acceptance = {'type': 'response', 'command': 'steer', 'success': True,
                      'id': 'boundary-guidance'}
        self.frame(stream, acceptance)
        self.assertIsNone(self.coord('delivery', 'boundary-guidance')['receipt'])
        self.frame(stream, late_terminal('Aborted episode body.'))
        self.action(stream, exit_fixture=True)
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: boundary-guidance]', resumed['prompt'])
        self.assertNotIn('[id: boundary-task]', resumed['prompt'])
        self.action(continuation, body='Continuation report.')
        self.finish(observer)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns],
                         ['First sealed report.', 'Continuation report.'])
        self.assertNotEqual(turns[0]['id'], turns[1]['id'])
        self.assertEqual(turns[0]['id'], sealed)
        self.assertEqual(self.coord('delivery', sealed)['body'], 'First sealed report.')
        notes = [report for report in self.coord('inbox', 'root')
                 if report['id'] == sealed + ':deferred']
        self.assertEqual([note['body'] for note in notes],
                         [deferred_body(sealed, 'boundary-guidance')])
        self.assertEqual(self.coord('delivery', 'boundary-guidance')['receipt'], 'native-reviewed')
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.eventually(lambda: not self.owned_processes(), 'boundary fixtures did not exit')

    def test_plain_output_after_the_seal_keeps_the_report_and_the_drain(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'plain-output-task', 'Report before plain native output.')
        line = 'plain native output without json'
        self.action(stream, stdout_line=line)
        self.assertEqual(json.loads(stream.readline()), {'line_written': line})
        self.frame(stream, late_terminal('Episode after the plain line.'))
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Report before plain native output.'])
        log = (self.directory / 'parent.jsonl').read_text()
        self.assertIn(line, log)
        notes = [report for report in self.coord('inbox', 'root')
                 if report['id'] == sealed + ':deferred']
        self.assertEqual([note['body'] for note in notes], [deferred_body(sealed, None)])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.eventually(lambda: not self.owned_processes(), 'boundary fixtures did not exit')

    def test_replayed_response_before_the_first_terminal_records_acceptance(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.coord('message', 'replay-task', 'root', 'parent', 'task', 'Work before the replay.')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        self.coord('message', 'replay-guidance', 'root', 'parent', 'guidance',
                   'Guidance accepted before the first terminal.')
        self.frame(original, {'type': 'message_end', 'message': {'role': 'user', 'content': []}})
        observer.kill()
        observer.wait(timeout=5)
        self.action(original, read_steer=True)
        accepted = json.loads(original.readline())
        self.assertEqual(accepted['steer_received']['id'], 'replay-guidance')
        report = 'Report replayed after the accepted steer.'
        # Event barrier: the fixture prints its terminal and then holds its exit,
        # so the manual re-invocation below meets a live native and its holder.
        # Without the hold the replay commits, finishes the native and releases
        # admission first, and the same invocation then finds no pending input.
        self.action(original, body=report, hold_exit=True)
        self.assertEqual(json.loads(original.readline()), {'terminal_written': True})
        self.assertEqual(self.coord(*self.receive_args('parent'))['status'], 'queued')
        self.action(original, exit_fixture=True)
        arrivals = self.arrivals()
        self.assertEqual({event['session'] for _, event in arrivals}, {'root'})
        stream, event = arrivals[0]
        self.assertIn(report, event['prompt'])
        self.assertNotIn('[id: replay-guidance]', event['prompt'])
        self.action(stream)
        self.assertEqual(stream.readline(), b'')
        self.eventually(lambda: self.coord('delivery', 'replay-guidance')['receipt'] is not None,
                        'replayed steer response did not record acceptance')
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.eventually(lambda: not self.owned_processes(), 'replay fixtures did not exit')

    def test_late_terminals_without_outstanding_guidance_keep_one_truthful_note(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'plain-task', 'Plain sealed report.')
        self.frame(stream, late_terminal('Late episode one.'))
        self.frame(stream, late_terminal('Late episode two.'))
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Plain sealed report.'])
        notes = [report for report in self.coord('inbox', 'root')
                 if report['id'] == sealed + ':deferred']
        self.assertEqual([note['body'] for note in notes], [deferred_body(sealed, None)])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.eventually(lambda: not self.owned_processes(), 'boundary fixtures did not exit')

    def test_pending_guidance_named_like_the_note_still_produces_it(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'recorded-task', 'Sealed report before the later terminal.', 'recorded')
        self.frame(stream, late_terminal('Later episode with the recorded guidance pending.'))
        self.action(stream, exit_fixture=True)
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: recorded]', resumed['prompt'])
        self.assertNotIn('[id: recorded-task]', resumed['prompt'])
        self.action(continuation, body='Continuation report after the recorded guidance.')
        self.finish(observer)
        notes = [report for report in self.coord('inbox', 'root')
                 if report['id'] == sealed + ':deferred']
        self.assertEqual([note['body'] for note in notes], [deferred_body(sealed, 'recorded')])
        self.assertEqual(self.coord('delivery', sealed)['body'],
                         'Sealed report before the later terminal.')
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Sealed report before the later terminal.',
                          'Continuation report after the recorded guidance.'])
        self.assertEqual(self.coord('delivery', 'recorded')['receipt'], 'native-reviewed')
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.eventually(lambda: not self.owned_processes(), 'boundary fixtures did not exit')


if __name__ == '__main__':
    unittest.main()
