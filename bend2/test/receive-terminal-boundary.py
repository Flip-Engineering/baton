"""The managed completion boundary of a native receive.

The first native terminal records the attempt's report under its managed
completion ID. Later terminal reports have separate episode IDs. Guidance
remains pending until the actor handles it in the current turn or continuation.
"""

import importlib.util
import json
import pathlib
import select
import unittest

SPEC = importlib.util.spec_from_file_location(
    'receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
RECEIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECEIVE)


def late_terminal(text):
    return {'type': 'agent_end', 'isTerminal': True, 'is_error': False,
            'messages': [{'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}]}


class ReceiveTerminalBoundary(RECEIVE.Receive):
    def sealed_attempt(self, task, body, guidance=None):
        """Run the first terminal of an attempt and return its sealed report ID."""
        self.player(harness='omp')
        self.coord('message', task, 'root', 'parent', 'task', 'Task before the settled terminal.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Boundary receive exited before native startup')
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

    def arrivals(self):
        found = []
        while select.select([self.server], [], [], 0)[0]:
            found.append(self.accept_any())
        return found

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
                         ['First sealed report.', 'Aborted episode body.',
                          'Continuation report.'])
        self.assertEqual(len({turn['id'] for turn in turns}), 3)
        self.assertEqual(turns[0]['id'], sealed)
        self.assertEqual(self.coord('delivery', sealed)['body'], 'First sealed report.')
        reports = [report for report in self.coord('inbox', 'root')
                   if report['id'] == turns[1]['id']]
        self.assertEqual([report['body'] for report in reports], ['Aborted episode body.'])
        self.assertEqual(self.coord('delivery', 'boundary-guidance')['receipt'], 'native-reviewed')
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.shutdown_idle_database_owner('boundary fixtures did not exit')

    def test_plain_output_after_the_seal_keeps_the_report_and_the_drain(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'plain-output-task', 'Report before plain native output.')
        line = 'plain native output without json'
        self.action(stream, stdout_line=line)
        self.assertEqual(json.loads(stream.readline()), {'line_written': line})
        self.frame(stream, late_terminal('Episode after the plain line.'))
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns],
                         ['Report before plain native output.', 'Episode after the plain line.'])
        self.assertNotEqual(turns[0]['id'], turns[1]['id'])
        log = self.output_log('parent').read_text()
        self.assertIn(line, log)
        reports = [report for report in self.coord('inbox', 'root')
                   if report['id'] == turns[1]['id']]
        self.assertEqual([report['body'] for report in reports], ['Episode after the plain line.'])
        self.assertEqual(self.coord('delivery', sealed)['body'], 'Report before plain native output.')
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.shutdown_idle_database_owner('boundary fixtures did not exit')

    def test_replayed_response_before_the_first_terminal_keeps_handled_guidance_receipt(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.coord('message', 'replay-task', 'root', 'parent', 'task', 'Work before the replay.')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept_child(observer, 'parent',
                                              'Replay receive exited before native startup')
        self.coord('message', 'replay-guidance', 'root', 'parent', 'guidance',
                   'Guidance accepted before the first terminal.')
        self.frame(original, {'type': 'message_end', 'message': {'role': 'user', 'content': []}})
        observer.kill()
        observer.wait()
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
        arrivals = [self.accept('root'), *self.arrivals()]
        self.assertEqual(len(arrivals), 1, 'one root report produced one native call')
        self.assertEqual({event['session'] for _, event in arrivals}, {'root'})
        stream, event = arrivals[0]
        self.assertIn(report, event['prompt'])
        self.assertNotIn('[id: replay-guidance]', event['prompt'])
        self.action(stream)
        self.assertEqual(stream.readline(), b'')
        self.eventually(lambda: self.coord('delivery', 'replay-guidance')['receipt'] is not None,
                        'the fixture handling receipt was not retained')
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.shutdown_idle_database_owner('replay fixtures did not exit')

    def test_late_terminals_without_outstanding_guidance_deliver_each_report(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'plain-task', 'Plain sealed report.')
        self.frame(stream, late_terminal('Late episode one.'))
        self.frame(stream, late_terminal('Late episode two.'))
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns],
                         ['Plain sealed report.', 'Late episode one.', 'Late episode two.'])
        self.assertEqual(len({turn['id'] for turn in turns}), 3)
        reports = [report for report in self.coord('inbox', 'root')
                   if report['id'] in {turns[1]['id'], turns[2]['id']}]
        self.assertEqual([report['body'] for report in reports],
                         ['Late episode one.', 'Late episode two.'])
        self.assertEqual(self.coord('delivery', sealed)['body'], 'Plain sealed report.')
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.shutdown_idle_database_owner('boundary fixtures did not exit')

    def test_pending_guidance_named_like_the_note_keeps_the_later_report(self):
        observer, stream, started, sealed = self.sealed_attempt(
            'recorded-task', 'Sealed report before the later terminal.', 'recorded')
        self.frame(stream, late_terminal('Later episode with the recorded guidance pending.'))
        self.action(stream, exit_fixture=True)
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: recorded]', resumed['prompt'])
        self.assertNotIn('[id: recorded-task]', resumed['prompt'])
        self.action(continuation, body='Continuation report after the recorded guidance.')
        self.finish(observer)
        self.assertEqual(self.coord('delivery', sealed)['body'],
                         'Sealed report before the later terminal.')
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns],
                         ['Sealed report before the later terminal.',
                          'Later episode with the recorded guidance pending.',
                          'Continuation report after the recorded guidance.'])
        self.assertEqual(len({turn['id'] for turn in turns}), 3)
        reports = [report for report in self.coord('inbox', 'root')
                   if report['id'] == turns[1]['id']]
        self.assertEqual([report['body'] for report in reports],
                         ['Later episode with the recorded guidance pending.'])
        self.assertEqual(self.coord('delivery', 'recorded')['receipt'], 'native-reviewed')
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.shutdown_idle_database_owner('boundary fixtures did not exit')


def load_tests(loader, tests, pattern):
    declared = sorted(name for name in vars(ReceiveTerminalBoundary) if name.startswith('test_'))
    return loader.loadTestsFromNames(declared, ReceiveTerminalBoundary)


if __name__ == '__main__':
    unittest.main()
