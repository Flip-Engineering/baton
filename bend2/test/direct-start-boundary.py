"""Exercise ordinary direct-turn retry admission with owned native fixtures.

Assertions express the required refusal invariant. An unfixed executable fails
them and retains commands, request changes, process identity and effect evidence.
BATON2_DIRECT_EXE selects the actual native executable under test.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import unittest

import control


control.EXE = Path(os.environ.get('BATON2_DIRECT_EXE', control.EXE)).resolve()


class DirectStartBoundary(control.Control):
    def setUp(self):
        super().setUp()
        self.root()
        self.evidence = {
            'executable': str(control.EXE),
            'sha256': hashlib.sha256(control.EXE.read_bytes()).hexdigest(),
            'cases': [],
        }
        self.addCleanup(self.save_evidence)

    def save_evidence(self):
        path = self.directory / 'direct-boundary.json'
        path.write_text(json.dumps(self.evidence, indent=2) + '\n')
        print('Direct boundary evidence: ' + str(path), flush=True)

    def instant_harness(self, name):
        executable = self.directory / name
        executable.write_text('#!' + sys.executable + '\n' + r'''
import json, pathlib, sys
args = sys.argv[1:]
if '--prompt-file' in args:
    prompt = pathlib.Path(args[args.index('--prompt-file') + 1]).read_text()
else:
    prompt = json.loads(sys.stdin.readline())['message']['content']
pathlib.Path(__file__).with_suffix('.effect').write_text(prompt)
if '--prompt-file' in args:
    print(json.dumps({'stream': {'kind': 'session', 'id': 'instant-native'},
                      'payload_type': 'run.terminal.completed',
                      'payload': {'kind': 'run_terminal', 'terminal': 'completed', 'text': prompt}}))
else:
    print(json.dumps({'type': 'result', 'result': prompt,
                      'session_id': 'instant-native', 'is_error': False}))
''')
        executable.chmod(0o700)
        return executable

    def turn_result(self, session, ident, executable, task, log):
        # This is the public direct entry used by the detached dispatch worker.
        # The helper records both streams and status without assuming success.
        assignment = self.call('player', session)
        return self.call('turn', session, ident, executable, assignment['model'],
                         assignment['effort'], assignment['workspace'], task, log,
                         assignment['native'], raw=True)

    def test_completed_id_rejects_changed_request(self):
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'completed-' + harness
                self.recruit(session, harness)
                first = self.instant_harness('first-' + harness)
                ident = session + '-turn'
                first_result = self.turn_result(session, ident, first, self.task,
                                                self.directory / (ident + '.jsonl'))
                self.assertEqual(first_result['code'], 0)
                self.assertEqual(first.with_suffix('.effect').read_text(), self.task.read_text())
                retained = self.call('delivery', ident)
                self.assertEqual(retained['body'], self.task.read_text())
                changed = self.instant_harness('changed-' + harness)
                changed_task = self.directory / ('changed-' + harness + '.txt')
                changed_task.write_text('Different task and executable under the same turn ID.\n')
                assignment = self.call('player', session)
                argv = ['turn', session, ident, str(changed), assignment['model'],
                        assignment['effort'], assignment['workspace'], str(changed_task),
                        str(self.directory / ('changed-' + harness + '.jsonl')), assignment['native']]
                result = subprocess.run([str(control.EXE), str(self.db), *argv],
                                        capture_output=True, text=True, timeout=10,
                                        env=self.environment)
                after = self.call('delivery', ident)
                self.evidence['cases'].append({
                    'case': 'completed-request-conflict', 'harness': harness,
                    'changedArgv': argv, 'code': result.returncode,
                    'stdout': result.stdout, 'stderr': result.stderr,
                    'originalReport': retained, 'reportAfter': after,
                    'changedEffect': changed.with_suffix('.effect').exists(),
                })
                self.assertEqual(after, retained)
                self.assertFalse(changed.with_suffix('.effect').exists())
                self.assertNotEqual(result.returncode, 0,
                                    'A changed direct request silently replayed the completed ID')

    def test_observer_loss_preserves_unresolved_attempt(self):
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'unresolved-' + harness
                self.recruit(session, harness)
                first_id = session + '-first'
                self.dispatch('dispatch-turn', session, first_id, self.fixture,
                              self.directory / (first_id + '.jsonl'), self.task)
                stream, start = self.accept(session)
                before = self.rows('SELECT * FROM executions WHERE session=?', (session,))[0]
                self.assertEqual(before['id'], first_id)
                self.assertIn(before['phase'], ('starting', 'running'))
                self.assertEqual(self.rows('SELECT id FROM messages WHERE id=?', (first_id,)), [])
                # Scope the injected loss to the direct worker that created this
                # fixture process. A keeper-based implementation needs a revised
                # observer barrier; do not signal an unidentified process.
                observer = subprocess.run(['ps', '-p', str(start['ppid']), '-o', 'command='],
                                          capture_output=True, text=True, check=True).stdout.strip()
                self.assertIn(str(self.db), observer)
                self.assertIn(first_id, observer)
                self.assertIn(' turn ', observer)
                replacement = self.instant_harness('replacement-' + harness)
                assignment = self.call('player', session)
                argv = ['turn', session, session + '-replacement', str(replacement),
                        assignment['model'], assignment['effort'], assignment['workspace'],
                        str(self.task), str(self.directory / (session + '-replacement.jsonl')),
                        assignment['native']]
                busy = subprocess.run([str(control.EXE), str(self.db), *argv],
                                      capture_output=True, text=True, timeout=10, env=self.environment)
                self.assertNotEqual(busy.returncode, 0, 'Live-worker lock negative control failed')
                self.assertFalse(replacement.with_suffix('.effect').exists())
                os.kill(start['ppid'], signal.SIGKILL)
                self.eventually(lambda: not any(
                    row.split(None, 1)[0] == str(start['ppid']) for row in self.process_rows()))
                self.assertEqual(self.action(stream, ack=True), {'acknowledged': True})
                result = subprocess.run([str(control.EXE), str(self.db), *argv],
                                        capture_output=True, text=True, timeout=10, env=self.environment)
                after = self.rows('SELECT * FROM executions WHERE session=?', (session,))[0]
                # The live fixture acknowledges via its private socket after the
                # replacement attempt; this proves survival beyond kill(pid,0).
                survived = self.action(stream, ack=True)
                self.evidence['cases'].append({
                    'case': 'observer-loss-unresolved-attempt', 'harness': harness,
                    'firstStart': start, 'observerCommand': observer,
                    'before': before, 'after': after,
                    'busyRefusal': {'code': busy.returncode, 'stderr': busy.stderr},
                    'retry': {'argv': argv, 'code': result.returncode,
                              'stdout': result.stdout, 'stderr': result.stderr},
                    'replacementEffect': replacement.with_suffix('.effect').exists(),
                    'firstFixtureStillResponsive': survived,
                    'firstReports': self.rows('SELECT id FROM messages WHERE id=?', (first_id,)),
                })
                self.assertEqual(survived, {'acknowledged': True})
                self.assertFalse(replacement.with_suffix('.effect').exists(),
                                 'A second endpoint ran while the unresolved first endpoint survived')
                self.assertEqual(after['id'], before['id'])
                self.assertNotEqual(result.returncode, 0)


def load_tests(loader, tests, pattern):
    # Reuse owned fixture helpers without rerunning Control's unrelated suite.
    return unittest.TestSuite(DirectStartBoundary(name) for name in (
        'test_completed_id_rejects_changed_request',
        'test_observer_loss_preserves_unresolved_attempt',
    ))


if __name__ == '__main__':
    unittest.main()
