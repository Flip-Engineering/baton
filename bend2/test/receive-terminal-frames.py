"""Foreign terminal frames in native observation.

The terminal extraction resolves the latest assistant message from a terminal
messages array that can hold foreign members: strings (including strings whose
text is serialized JSON), nulls, booleans, numbers and arrays. It must read only
object members, classify a current assistant failure instead of returning the
raw conversation, and never let older successful history stand in for a current
failure or an older failure poison a later success.

These cases drive the public observe-file path against a fresh endpoint-free
store, so the recorded report body is the observable contract.
"""

import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


def assistant(**fields):
    return {'role': 'assistant', **fields}


def terminal(messages):
    return {'type': 'agent_end', 'isTerminal': True, 'messages': messages}


class TerminalFrames(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix="terminal frames ' paths ", dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        for argv in (('attach', 'operator', 'terminal', '', ''),
                     ('role', 'operator', 'operator'),
                     ('attach', 'p', 'codex', 'native-p', ''),
                     ('role', 'p', 'principal-conductor')):
            done = subprocess.run([str(EXE), str(self.db), *argv], capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)

    def observe(self, ident, event):
        path = self.directory / (ident + '.json')
        path.write_text(json.dumps(event))
        done = subprocess.run([str(EXE), str(self.db), 'observe-file', ident, 'p', str(path)],
                              capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        recorded = subprocess.run([str(EXE), str(self.db), 'delivery', ident], capture_output=True, text=True)
        self.assertEqual(recorded.returncode, 0, recorded.stderr)
        return json.loads(recorded.stdout)['body']

    def test_foreign_members_keep_the_latest_assistant_report(self):
        body = self.observe('mixed', terminal([
            assistant(stopReason='stop', content=[{'type': 'text', 'text': 'Complete report.'}]),
            'marker', None, True, 7, [1, 2],
            assistant(stopReason='stop', content=[{'type': 'text', 'text': 'Later full report.'}]),
        ]))
        self.assertEqual(body, 'Later full report.')

    def test_heterogeneous_content_keeps_every_text_part(self):
        body = self.observe('content', terminal([
            assistant(stopReason='stop', content=['plain', None, 3.5, {'type': 'text', 'text': 'first'},
                                                  {'type': 'text', 'text': 'second'}]),
        ]))
        self.assertEqual(body, 'first\nsecond')

    def test_serialized_json_string_is_never_an_assistant(self):
        body = self.observe('serialized', terminal([
            assistant(stopReason='stop', content=[{'type': 'text', 'text': 'Real report.'}]),
            json.dumps(assistant(stopReason='error', errorStatus=403, errorMessage='not the current assistant')),
        ]))
        self.assertEqual(body, 'Real report.')

    def test_current_failure_is_classified_not_replaced_by_history(self):
        body = self.observe('quota', terminal([
            {'role': 'user', 'content': [{'type': 'text', 'text': 'research task'}]},
            assistant(stopReason='endTurn', content=[{'type': 'text', 'text': 'earlier successful report'}]),
            assistant(stopReason='error', errorStatus=403, errorMessage='403 {"error":{"type":"permission_error"}}',
                      provider='kimi-code', model='k3', content=[]),
        ]))
        self.assertIn('Native model failure', body)
        self.assertIn('403', body)
        self.assertIn('kimi-code/k3', body)
        self.assertNotIn('earlier successful report', body)

    def test_partial_text_failure_is_still_classified(self):
        body = self.observe('partial', terminal([
            assistant(stopReason='error', errorStatus=429, errorMessage='rate limited',
                      content=[{'type': 'text', 'text': 'partial answer before the failure'}]),
        ]))
        self.assertIn('Native model failure', body)
        self.assertIn('429', body)
        self.assertNotIn('partial answer before the failure', body)

    def test_historical_failure_does_not_poison_a_later_success(self):
        body = self.observe('recovered', terminal([
            assistant(stopReason='error', errorStatus=403, errorMessage='quota'),
            assistant(stopReason='stop', content=[{'type': 'text', 'text': 'Task complete after recovery.'}]),
        ]))
        self.assertEqual(body, 'Task complete after recovery.')

    def test_unavailable_current_content_is_not_fabricated(self):
        body = self.observe('unavailable', terminal(['marker', None, True]))
        self.assertNotIn('Native model failure', body)
        self.assertIn('agent_end', body)


if __name__ == '__main__':
    unittest.main()
