"""Replay of the retained #669/#670 native streams through a real receive.

The two original research streams and the Kimi quota frame are read from the
retained native logs and replayed in order through the socket fixture used by
receive.py, so the retained-assistant substitution, the terminal classification
and the receive failure decision are exercised by real executions of the public
receive path rather than by SQLite evaluation alone.

For each stream the test emits the original assistant message_end frame first
and the original terminal frame second, then ends the fixture. The report the
parent receives and the receive process's own exit status are the contracts.
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

ROOT = pathlib.Path(__file__).resolve().parents[2]


def logs_dir():
    """The retained evidence logs, in this tree or the canonical delivery tree."""
    for base in (ROOT, *ROOT.parents[:5]):
        candidate = base / '.scratch/semantic-context-20261005/logs'
        if candidate.is_dir():
            return candidate
    return ROOT / '.scratch/semantic-context-20261005/logs'


LOGS = logs_dir()


def stream_frames(name):
    """The last retained assistant message_end frame and the terminal frame."""
    path = LOGS / name
    retained, terminal = None, None
    for line in path.read_text(errors='replace').splitlines():
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


def assistant_text(frame):
    message = (frame or {}).get('message') or {}
    parts = [item.get('text') for item in (message.get('content') or [])
             if isinstance(item, dict) and item.get('type') == 'text']
    return '\n'.join(part for part in parts if isinstance(part, str))


class RetainedReplay(RECEIVE.Receive):
    def arrivals(self, timeout=15):
        """Accept every control connection that arrives within the bound."""
        found = []
        while select.select([self.server], [], [], timeout)[0]:
            found.append(self.accept_any())
        return found

    def native_status(self):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute(
                "SELECT status FROM executions WHERE session='parent' ORDER BY rowid DESC LIMIT 1").fetchone()
        return row[0] if row else '(none)'

    def replay(self, frames, failure=False):
        """Run one receive with the given frames and return report and statuses."""
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.coord('message', 'replay-task', 'root', 'parent', 'task', 'Replay the retained stream.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        self.assertIn('[id: replay-task]', started['prompt'])
        for frame in frames:
            self.action(stream, native_request=frame)
            self.assertEqual(json.loads(stream.readline()), {'request_written': frame})
        self.action(stream, exit_fixture=True)
        accepted = self.arrivals()
        notifications = []
        for control, event in accepted:
            notifications.append((event['session'], event['prompt']))
            self.action(control, body='notification reviewed')
        observer.communicate(timeout=15)
        return notifications, observer.returncode, self.native_status()

    def test_elided_research_streams_report_the_retained_assistant(self):
        for name in ('semantic-runtime-protocol-research.jsonl',
                     'semantic-runtime-observations-research.jsonl'):
            retained, terminal = stream_frames(name)
            self.assertIsNotNone(retained, name)
            self.assertIsNotNone(terminal, name)
            self.assertIsInstance(terminal['messages'][-1], str, name)
            notifications, code, status = self.replay([retained, terminal])
            self.assertEqual(code, 0)
            self.assertIn('exit 0', status)
            prompts = '\n'.join(prompt for _session, prompt in notifications)
            self.assertIn(assistant_text(retained), prompts, name)
            self.assertNotIn('Native report unavailable', prompts, name)
            raw = (self.directory / 'parent.jsonl').read_text()
            self.assertIn('agent_end', raw)

    def test_quota_frame_is_classified_while_the_native_exits_zero(self):
        retained = {'type': 'message_end', 'message': {
            'role': 'assistant', 'stopReason': 'endTurn',
            'content': [{'type': 'text', 'text': 'earlier successful report'}]}}
        quota = {'type': 'agent_end', 'isTerminal': True, 'messages': [
            {'role': 'user', 'content': [{'type': 'text', 'text': 'research task'}]},
            {'role': 'assistant', 'stopReason': 'endTurn',
             'content': [{'type': 'text', 'text': 'earlier successful report'}]},
            {'role': 'assistant', 'stopReason': 'error', 'errorStatus': 403,
             'errorMessage': '403 {"error":{"type":"permission_error","message":"quota"}}',
             'provider': 'kimi-code', 'model': 'k3', 'content': []}]}
        notifications, code, status = self.replay([retained, quota], failure=True)
        prompts = '\n'.join(prompt for _session, prompt in notifications)
        self.assertIn('Native model failure', prompts)
        self.assertIn('403', prompts)
        self.assertIn('kimi-code/k3', prompts)
        self.assertNotIn('earlier successful report', prompts.split('Native model failure')[1])
        self.assertIn('exit 0', status)
        self.assertNotEqual(code, 0)

    def test_empty_terminal_uses_the_retained_report(self):
        retained = {'type': 'message_end', 'message': {
            'role': 'assistant', 'stopReason': 'stop',
            'content': [{'type': 'text', 'text': 'Full retained report.'}]}}
        empty = {'type': 'agent_end', 'isTerminal': True, 'messages': []}
        notifications, code, status = self.replay([retained, empty])
        self.assertEqual(code, 0)
        self.assertIn('exit 0', status)
        prompts = '\n'.join(prompt for _session, prompt in notifications)
        self.assertIn('Full retained report.', prompts)
        self.assertNotIn('Native report unavailable', prompts)
        self.assertIn('exit 0', status)


if __name__ == '__main__':
    unittest.main()
