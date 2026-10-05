"""Retained native stream replay and sealed lifecycle cases for #669/#670.

Two test groups:

- `RetainedReplay` replays the *original* captured streams through the real
  receive path. It is evidence-gated: it runs only when the retained native logs
  are supplied as an explicit input, via the environment variable
  BATON_RETAINED_LOGS pointing at the directory holding them. Each replayed
  frame records the SHA-256 of the exact captured JSON it replays.
- `ControlledFrames` always runs. It uses portable constructed frames with the
  same foreign shapes, including the sealed success-then-error and
  error-then-success boundaries.

Both drive bend2/test/receive.py's socket fixture through importlib, emitting an
ordered assistant message_end frame and then a terminal frame, and assert the
recorded turn body, the parent notification and the parent prompt by full report
retrieval rather than substring presence alone.
"""

import hashlib
import importlib.util
import json
import os
import pathlib
import select
import sqlite3
import unittest

SPEC = importlib.util.spec_from_file_location(
    'receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
RECEIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECEIVE)

ROOT = pathlib.Path(__file__).resolve().parents[2]


def evidence_dir():
    """The caller-supplied retained native logs, or None when not provided."""
    supplied = os.environ.get('BATON_RETAINED_LOGS', '')
    if supplied and pathlib.Path(supplied).is_dir():
        return pathlib.Path(supplied)
    return None


EVIDENCE = evidence_dir()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def assistant_text(frame):
    message = (frame or {}).get('message') or {}
    parts = [item.get('text') for item in (message.get('content') or [])
             if isinstance(item, dict) and item.get('type') == 'text']
    return '\n'.join(part for part in parts if isinstance(part, str))


def assistant(**fields):
    return {'role': 'assistant', **fields}


class ReplayBase(RECEIVE.Receive):
    def arrivals(self, timeout=15):
        found = []
        while select.select([self.server], [], [], timeout)[0]:
            found.append(self.accept_any())
        return found

    def native_status(self):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute(
                "SELECT status FROM executions WHERE session='parent' ORDER BY rowid DESC LIMIT 1").fetchone()
        return row[0] if row else '(none)'

    def reports(self):
        """Every report body the native session delivered to the root."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            return [row[0] for row in database.execute(
                "SELECT body FROM messages WHERE kind='report' AND sender='parent' ORDER BY seq")]

    def start(self, task='replay-task'):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.coord('message', task, 'root', 'parent', 'task', 'Replay the retained stream.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        self.assertIn(f'[id: {task}]', started['prompt'])
        return observer, stream

    def emit(self, stream, frames):
        for frame in frames:
            self.action(stream, native_request=frame)
            self.assertEqual(json.loads(stream.readline()), {'request_written': frame})

    def collect(self, observer, stream):
        self.action(stream, exit_fixture=True)
        notifications = []
        for control, event in self.arrivals():
            notifications.append((event['session'], event['prompt']))
            self.action(control, body='notification reviewed')
        observer.communicate(timeout=15)
        return notifications, observer.returncode

    def replay(self, frames, task='replay-task'):
        observer, stream = self.start(task)
        self.emit(stream, frames)
        notifications, code = self.collect(observer, stream)
        return notifications, code, self.native_status(), self.reports()

    def assert_report(self, notifications, body):
        """The sealed turn and the public delivery both carry exactly the body."""
        turns = self.coord('turns', 'parent')
        self.assertEqual(turns[-1]['reportBody'], body)
        self.assertEqual(self.coord('delivery', turns[-1]['id'])['body'], body)
        prompts = [prompt for _session, prompt in notifications]
        self.assertTrue(any(body in prompt for prompt in prompts), prompts)


@unittest.skipUnless(EVIDENCE, 'retained native logs not supplied via BATON_RETAINED_LOGS')
class RetainedReplay(ReplayBase):
    def stream_frames(self, name):
        retained, terminal = None, None
        for line in (EVIDENCE / name).read_text(errors='replace').splitlines():
            try:
                frame = json.loads(line)
            except Exception:
                continue
            if frame.get('type') == 'message_end' and isinstance(frame.get('message'), dict) \
                    and frame['message'].get('role') == 'assistant':
                retained = frame
            if frame.get('type') == 'agent_end' and isinstance(frame.get('messages'), list):
                terminal = frame
        return retained, terminal

    def replay_captured_research_stream(self, name):
        """Replay one captured research stream and assert its exact report."""
        task = name.replace('.jsonl', '')
        retained, terminal = self.stream_frames(name)
        self.assertIsNotNone(retained, name)
        self.assertIsNotNone(terminal, name)
        self.assertIsInstance(terminal['messages'][-1], str, name)
        expected = assistant_text(retained)
        print(f'evidence {name} terminal parsed digest {digest(terminal)} '
              f'retained parsed digest {digest(retained)}')
        notifications, code, status, _bodies = self.replay([retained, terminal], task=task)
        self.assertEqual(code, 0)
        self.assertIn('exit 0', status)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [expected])
        self.assertEqual(self.coord('delivery', turns[0]['id'])['body'], expected)
        prompts = [prompt for _session, prompt in notifications]
        self.assertTrue(any(expected in prompt for prompt in prompts), prompts)
        logged = []
        for line in (self.directory / 'parent.jsonl').read_text(errors='replace').splitlines():
            try:
                logged.append(json.loads(line))
            except Exception:
                continue
        terminals = [frame for frame in logged
                     if frame.get('type') == 'agent_end' and frame.get('messages')]
        self.assertTrue(terminals, logged[-3:])
        self.assertEqual(terminals[-1], terminal)
        retained_logged = [frame for frame in logged if frame.get('type') == 'message_end']
        self.assertTrue(any(assistant_text(frame) == expected for frame in retained_logged),
                        retained_logged[-3:])

    def test_original_protocol_research_stream_reports_the_retained_assistant(self):
        self.replay_captured_research_stream('semantic-runtime-protocol-research.jsonl')

    def test_original_observations_research_stream_reports_the_retained_assistant(self):
        self.replay_captured_research_stream('semantic-runtime-observations-research.jsonl')

    def quota_frames(self):
        """The captured quota attempt: its assistant message_end and its agent_end."""
        lines = (EVIDENCE / 'lead.jsonl').read_text(errors='replace').splitlines()
        terminal, preceding, terminal_line = None, None, None
        for index, line in enumerate(lines):
            try:
                record = json.loads(line)
            except Exception:
                continue
            if record.get('type') == 'message_end':
                preceding = record
            if record.get('type') == 'agent_end':
                terminal, terminal_line = record, index
                break
        self.assertIsNotNone(terminal, 'no captured agent_end terminal in lead.jsonl')
        return preceding, terminal, lines[terminal_line]

    def test_original_quota_terminal_is_classified_while_the_native_exits_zero(self):
        preceding, terminal, raw = self.quota_frames()
        self.assertIsNotNone(preceding, 'no captured message_end before the terminal')
        print(f'evidence lead.jsonl agent_end parsed digest {digest(terminal)} '
              f'original byte sha256 {hashlib.sha256(raw.encode()).hexdigest()}')
        print(f'evidence lead.jsonl preceding message_end parsed digest {digest(preceding)}')
        notifications, code, status, bodies = self.replay(
            [preceding, terminal], task='original-quota-terminal')
        self.assertIn('exit 0', status)
        self.assertNotEqual(code, 0)
        failure = [body for body in bodies if 'Native model failure' in body]
        self.assertTrue(failure, bodies)
        errors = [message for message in (terminal.get('messages') or [])
                  if isinstance(message, dict) and message.get('stopReason') == 'error']
        self.assertTrue(errors, 'no error assistant in the captured terminal')
        self.assertEqual(errors[-1].get('errorStatus'), 403)
        self.assertEqual(errors[-1].get('provider'), 'kimi-code')
        self.assertIn(str(errors[-1].get('errorStatus')), failure[0])
        self.assertIn(str(errors[-1].get('provider')), failure[0])
        turns = self.coord('turns', 'parent')
        self.assertEqual(self.coord('delivery', turns[0]['id'])['body'], failure[0])
        logged = []
        for line in (self.directory / 'parent.jsonl').read_text(errors='replace').splitlines():
            try:
                logged.append(json.loads(line))
            except Exception:
                continue
        terminals = [frame for frame in logged
                     if frame.get('type') == 'agent_end' and frame.get('messages')]
        self.assertTrue(terminals, logged[-3:])
        self.assertEqual(terminals[-1], terminal)


class ControlledFrames(ReplayBase):
    def test_foreign_members_keep_the_latest_assistant_report(self):
        notifications, code, status, bodies = self.replay([
            {'type': 'message_end', 'message': assistant(
                stopReason='stop', content=[{'type': 'text', 'text': 'Later full report.'}])},
            {'type': 'agent_end', 'isTerminal': True, 'messages': [
                assistant(stopReason='toolUse', content=[{'type': 'text', 'text': '.'}]),
                'marker', None, True, 7, [1, 2]]}], task='foreign-members')
        self.assertEqual(code, 0)
        self.assert_report(notifications, 'Later full report.')

    def test_empty_terminal_uses_the_retained_report(self):
        notifications, code, status, bodies = self.replay([
            {'type': 'message_end', 'message': assistant(
                stopReason='stop', content=[{'type': 'text', 'text': 'Full retained report.'}])},
            {'type': 'agent_end', 'isTerminal': True, 'messages': []}], task='empty-terminal')
        self.assertEqual(code, 0)
        self.assertIn('exit 0', status)
        self.assert_report(notifications, 'Full retained report.')

    def test_unavailable_content_is_reported_truthfully(self):
        notifications, code, status, bodies = self.replay([
            {'type': 'agent_end', 'isTerminal': True, 'messages': ['marker', None, True]}],
            task='unavailable')
        self.assertEqual(code, 0)
        self.assert_report(notifications, 'Native report unavailable: the terminal frame carries '
                          'no complete assistant message; the original frame is retained in the '
                          'native log for this attempt.')

    def test_current_failure_is_classified_while_the_native_exits_zero(self):
        notifications, code, status, bodies = self.replay([
            {'type': 'message_end', 'message': assistant(
                stopReason='endTurn', content=[{'type': 'text', 'text': 'earlier successful report'}])},
            {'type': 'agent_end', 'isTerminal': True, 'messages': [
                assistant(stopReason='endTurn', content=[{'type': 'text', 'text': 'earlier successful report'}]),
                assistant(stopReason='error', errorStatus=403, errorMessage='403 quota',
                          provider='kimi-code', model='k3', content=[])]}], task='synthetic-quota')
        self.assertIn('exit 0', status)
        self.assertNotEqual(code, 0)
        failure = [body for body in bodies if 'Native model failure' in body]
        self.assertTrue(failure, bodies)
        self.assertNotIn('earlier successful report', failure[0])

    def test_an_elided_terminal_repeating_an_older_error_reports_the_later_completion(self):
        """The stream's completed success after E1 is the attempt's result, not E1."""
        error = assistant(stopReason='error', errorStatus=403, errorMessage='403 earlier failure',
                          provider='kimi-code', model='k3', responseId='response-e1', content=[])
        success = assistant(stopReason='stop', responseId='response-s2',
                            content=[{'type': 'text', 'text': 'Complete answer.'}])
        notifications, code, status, bodies = self.replay([
            {'type': 'agent_start'},
            {'type': 'message_end', 'message': error},
            {'type': 'message_end', 'message': success},
            {'type': 'agent_end', 'isTerminal': True, 'messages': [error, 'elided']}],
            task='ordered-error-then-success')
        self.assertEqual(code, 0)
        self.assertIn('exit 0', status)
        self.assertFalse([body for body in bodies if 'Native model failure' in body], bodies)
        turns = self.coord('turns', 'parent')
        self.assertEqual(turns[0]['reportBody'], 'Complete answer.')
        self.assertEqual(self.coord('delivery', turns[0]['id'])['body'], 'Complete answer.')

    def test_a_started_error_after_a_cached_success_stays_the_current_failure(self):
        """The error the stream started last is current, even when a success came earlier."""
        success = assistant(stopReason='stop', responseId='response-s1',
                            content=[{'type': 'text', 'text': 'Complete answer.'}])
        error = assistant(stopReason='error', errorStatus=403, errorMessage='403 current failure',
                          provider='kimi-code', model='k3', responseId='response-e2', content=[])
        notifications, code, status, bodies = self.replay([
            {'type': 'agent_start'},
            {'type': 'message_end', 'message': success},
            {'type': 'message_start', 'message': error},
            {'type': 'agent_end', 'isTerminal': True, 'messages': [success, error, 'elided']}],
            task='cached-success-then-error')
        self.assertNotEqual(code, 0)
        self.assertIn('exit 0', status)
        failure = [body for body in bodies if 'Native model failure' in body]
        self.assertTrue(failure, bodies)
        self.assertNotIn('Complete answer.', failure[0])

    def test_a_complete_terminal_after_a_success_keeps_its_current_error(self):
        """A terminal that names its own last assistant error keeps that error."""
        success = assistant(stopReason='stop', responseId='response-s1',
                            content=[{'type': 'text', 'text': 'Complete answer.'}])
        error = assistant(stopReason='error', errorStatus=403, errorMessage='403 current failure',
                          provider='kimi-code', model='k3', responseId='response-e2', content=[])
        notifications, code, status, bodies = self.replay([
            {'type': 'agent_start'},
            {'type': 'message_end', 'message': success},
            {'type': 'message_end', 'message': error},
            {'type': 'agent_end', 'isTerminal': True, 'messages': [success, error]}],
            task='ordered-success-then-error')
        self.assertNotEqual(code, 0)
        self.assertIn('exit 0', status)
        failure = [body for body in bodies if 'Native model failure' in body]
        self.assertTrue(failure, bodies)
        self.assertNotIn('Complete answer.', failure[0])

    def test_sequential_success_then_error_keeps_the_first_report(self):
        """Two consecutive receives: a later receive's failure does not change the earlier report."""
        sealed, code, status, bodies = self.replay([
            {'type': 'message_end', 'message': assistant(
                stopReason='stop', content=[{'type': 'text', 'text': 'Sealed first report.'}])},
            {'type': 'agent_end', 'isTerminal': True, 'messages': []}], task='sealed-first')
        self.assertEqual(code, 0)
        self.assertIn('Sealed first report.', bodies[0])
        later, later_code, later_status, later_bodies = self.replay([
            {'type': 'agent_end', 'isTerminal': True, 'messages': [
                assistant(stopReason='error', errorStatus=403, errorMessage='403 later failure',
                          provider='kimi-code', model='k3', content=[])]}], task='sealed-later')
        self.assertIn('exit 0', later_status)
        self.assertNotEqual(later_code, 0)
        self.assertIn('Sealed first report.', self.reports()[0])
        self.assertTrue(any('Native model failure' in body for body in later_bodies), later_bodies)

    def test_sequential_error_then_success_keeps_the_first_failure(self):
        """Two consecutive receives: a later success does not change the earlier failure."""
        first, code, status, bodies = self.replay([
            {'type': 'agent_end', 'isTerminal': True, 'messages': [
                assistant(stopReason='error', errorStatus=403, errorMessage='403 first failure',
                          provider='kimi-code', model='k3', content=[])]}], task='sealed-failure')
        self.assertIn('exit 0', status)
        self.assertNotEqual(code, 0)
        first_failure = [body for body in bodies if 'Native model failure' in body]
        self.assertTrue(first_failure, bodies)
        later, later_code, later_status, later_bodies = self.replay([
            {'type': 'message_end', 'message': assistant(
                stopReason='stop', content=[{'type': 'text', 'text': 'Later successful report.'}])},
            {'type': 'agent_end', 'isTerminal': True, 'messages': []}], task='sealed-success')
        self.assertEqual(later_code, 0)
        self.assertIn('Native model failure', self.reports()[0])
        self.assertIn('Later successful report.', later_bodies[-1])


if __name__ == '__main__':
    unittest.main()
