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
        """The recorded delivery and the parent notification both carry the body."""
        self.assertIn(body, '\n'.join(self.reports()))
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

    def test_original_research_streams_report_the_retained_assistant(self):
        for name in ('semantic-runtime-protocol-research.jsonl',
                     'semantic-runtime-observations-research.jsonl'):
            retained, terminal = self.stream_frames(name)
            self.assertIsNotNone(retained, name)
            self.assertIsNotNone(terminal, name)
            self.assertIsInstance(terminal['messages'][-1], str, name)
            print(f'evidence {name} terminal sha256 {digest(terminal)} retained sha256 {digest(retained)}')
            notifications, code, status, bodies = self.replay([retained, terminal], task=name[:12])
            self.assertEqual(code, 0)
            self.assertIn('exit 0', status)
            self.assert_report(notifications, assistant_text(retained))
            logged = []
            for line in (self.directory / 'parent.jsonl').read_text(errors='replace').splitlines():
                try:
                    logged.append(json.loads(line))
                except Exception:
                    continue
            terminals = [frame for frame in logged
                         if frame.get('type') == 'agent_end' and frame.get('messages')]
            self.assertTrue(terminals, logged[-3:])
            self.assertEqual(terminals[-1]['messages'][-1], terminal['messages'][-1])
            retained_logged = [frame for frame in logged if frame.get('type') == 'message_end']
            self.assertTrue(any(assistant_text(frame) == assistant_text(retained)
                                for frame in retained_logged), retained_logged[-3:])
            self.assertIn(assistant_text(retained), bodies[-1])

    def test_original_quota_frame_is_classified_while_the_native_exits_zero(self):
        retained, quota = None, None
        for line in (EVIDENCE / 'lead.jsonl').read_text(errors='replace').splitlines():
            if 'errorStatus' not in line or 'errorMessage' not in line:
                continue
            try:
                record = json.loads(line)
            except Exception:
                continue
            message = record.get('message') or record
            if message.get('stopReason') != 'error':
                continue
            retained = {'type': 'message_end', 'message': assistant(
                stopReason='endTurn', content=[{'type': 'text', 'text': 'earlier successful report'}])}
            quota = {'type': 'agent_end', 'isTerminal': True, 'messages': [message]}
            break
        self.assertIsNotNone(quota, 'no captured quota frame in lead.jsonl')
        print(f'evidence lead.jsonl quota frame sha256 {digest(quota)}')
        notifications, code, status, bodies = self.replay([retained, quota], task='original-quota')
        self.assertIn('exit 0', status)
        self.assertNotEqual(code, 0)
        failure = [body for body in bodies if 'Native model failure' in body]
        self.assertTrue(failure, bodies)
        self.assertIn(str(quota['messages'][0].get('errorStatus')), failure[0])
        self.assertIn(str(quota['messages'][0].get('provider')), failure[0])
        self.assertNotIn('earlier successful report', failure[0])


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
        self.assert_report(notifications, 'Native report unavailable')

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

    def test_sealed_success_then_error_preserves_the_first_report(self):
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

    def test_sealed_error_then_success_preserves_the_first_failure(self):
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
