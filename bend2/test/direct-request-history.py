"""Direct request history and inspection for #672, first slice.

Owner: structure Section, session semantic-controls-structure-research. Test-only:
this file owns no shared source, no `turn.bend`, no `Store`, no interfaces file,
and it changes neither `bend2/test/direct-start-boundary.py` (920f9430) nor any
other test.

Surfaces, from `95bfccf0:docs/bend2/direct-start-672-proposal.md`: ordinary `turn`
and `dispatch-turn`, and the `turn-status ID` and `turn-recover ID` readers.

First slice, four areas:
  1. a completed exact retry returns its retained result, and a changed task
     conflicts;
  2. a historical retry of an older completed ID after a newer turn for the same
     session still returns that older request's retained result;
  3. a legacy artifact with no direct request row is inspected as legacy-unbound
     and refuses recovery without backfilling identity;
  4. a parentless foreground completion is local, while a parentless detached
     start refuses before effects.

Every case runs on all four adapters. Each case uses a fresh Git repository and a
fresh SQLite database, and the endpoint is a self-completing fixture harness that
records its own starts and the prompt it received, so "no second effect" is
asserted from the endpoint's own record rather than from process counts.

Foreground `turn` is asserted as success plus the actual saved result and the
endpoint effects. The `direct-start` envelope is NOT asserted on foreground: the
proposal specifies it for the accepted detached handoff, and the exact foreground
shape binds once its real finish integration is supplied.

Confirmations applied from `controls-next-direct-history-wire-2`: `error` carries
the refusal name; `direct-request-conflict` carries `field`, `originalRequest`,
`requestId` and `attemptDirectory`; `turn-status` exposes `identityBinding`,
`requestId`, `session`, `mode`, `phase`, `nativeStatus`, `attemptDirectory`,
`resultId`, `request` and `lifetime`, with no-evidence fields null or unavailable
rather than guessed; a wholly absent identity is `direct-request-not-found` at
exit 2.

Still pending the real Direct state implementation, and therefore NOT asserted by
value: the `notification` vocabulary, the `direct_requests` phase vocabulary, and
the detached `direct-start` envelope. Only key presence is checked there.

No deliverability claim is made: the fixture owner has no endpoint, so a retained
report row is evidence of retention, not of a delivered notice.

Executable: `BATON2_DIRECT_HISTORY_EXE`, else `BATON2_DIRECT_EXE` (the name the 920
slice uses), else the built `.scratch/bend2/baton2`. The candidate does not exist
yet, so a run against a built executable is the only qualified run and no skipped
or failing case is treated as a candidate pass.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest

import control


control.EXE = Path(
    os.environ.get('BATON2_DIRECT_HISTORY_EXE')
    or os.environ.get('BATON2_DIRECT_EXE')
    or control.EXE).resolve()

HARNESSES = ('omp', 'codex', 'muse', 'claude-code')

# Confirmed names, asserted by value.
CONFLICT = 'direct-request-conflict'
CONFLICT_FIELDS = ('field', 'originalRequest', 'requestId', 'attemptDirectory')
HISTORY_UNBOUND = 'direct-history-unbound'
NOT_FOUND = 'direct-request-not-found'
OWNER_UNAVAILABLE = 'direct-owner-unavailable'
LEGACY_BINDING = 'legacy-unbound'
STATUS_FIELDS = ('identityBinding', 'requestId', 'session', 'mode', 'phase',
                 'nativeStatus', 'attemptDirectory', 'resultId', 'request', 'lifetime')

HARNESS_SCRIPT = r'''import json, pathlib, sys
kwargs = sys.argv[1:]
home = pathlib.Path(__file__).resolve()
ledger = home.parent / 'starts.jsonl'
native = 'self-completing'
if '--mode' in kwargs:                       # omp: event filter, state, prompt
    sys.stdin.readline(); sys.stdin.readline()
    prompt = json.loads(sys.stdin.readline())['message']
    message = {'role': 'assistant', 'content': [{'type': 'text', 'text': prompt}]}
    frames = [{'type': 'session', 'id': native},
              {'type': 'message_end', 'message': message},
              {'type': 'agent_end', 'isTerminal': True, 'messages': []}]
elif '--prompt-file' in kwargs:              # muse
    prompt = pathlib.Path(kwargs[kwargs.index('--prompt-file') + 1]).read_text()
    frames = [{'stream': {'kind': 'session', 'id': native},
               'payload_type': 'run.terminal.completed',
               'payload': {'kind': 'run_terminal', 'terminal': 'completed', 'text': prompt}}]
elif '--input-format' in kwargs:             # claude
    prompt = json.loads(sys.stdin.readline())['message']['content']
    frames = [{'type': 'result', 'result': prompt, 'session_id': native, 'is_error': False}]
else:                                        # codex: exec --json, prompt on stdin
    prompt = sys.stdin.read()
    frames = [{'type': 'thread.started', 'thread_id': native},
              {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': prompt}},
              {'type': 'turn.completed', 'usage': {}}]
with ledger.open('a') as out:
    out.write(json.dumps({'argv': kwargs, 'prompt': prompt}) + '\n')
home.with_suffix('.effect').write_text(prompt)
for frame in frames:
    print(json.dumps(frame), flush=True)
'''


class DirectFixture(control.Control):
    """Shared fixture: a parentless root, a self-completing endpoint per adapter."""

    def prepare(self, with_operator=False, owner_endpoint=None):
        self.call('attach', 'root', 'codex', 'saved-root', '')
        self.call('role', 'root', 'principal-conductor')
        if with_operator:
            self.call('attach', 'operator', 'operator', '', '')
            self.call('role', 'operator', 'operator')
        if owner_endpoint is not None:
            self.call('connect', 'root', 'saved-root', json.dumps(owner_endpoint))

    def endpoint(self, name):
        executable = self.directory / name
        executable.write_text('#!' + sys.executable + '\n' + HARNESS_SCRIPT)
        executable.chmod(0o700)
        return executable

    def starts(self):
        ledger = self.directory / 'starts.jsonl'
        return [json.loads(line) for line in ledger.read_text().splitlines()] \
            if ledger.exists() else []

    def probe(self, *args):
        """Run one command without asserting its exit code.

        The base `call` helper asserts success, so a case that asserts a refusal
        code itself must go through this one.
        """
        child = subprocess.Popen([str(control.EXE), str(self.db), *map(str, args)],
                                 env=self.environment, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        stdout, stderr = child.communicate(timeout=30)
        record = {'argv': list(map(str, args)), 'code': child.returncode,
                  'stdout': stdout, 'stderr': stderr}
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps(record) + '\n')
        return record

    def one_object(self, record, channel='stdout'):
        text = record[channel]
        self.assertTrue(text.startswith('{'),
                        f'{channel} carries no object: {text[:120]!r}')
        obj, index = json.JSONDecoder().raw_decode(text)
        self.assertEqual(text[index:], '\n',
                         f'{channel} must end with exactly one newline, got {text[index:]!r}')
        return obj

    def refusal(self, record):
        """One typed refusal object on stderr at exit 2."""
        self.assertEqual(record['code'], 2, record['stderr'][:200])
        self.assertEqual(record['stdout'], '')
        return self.one_object(record, 'stderr')

    def foreground_success(self, record):
        """A foreground turn: success and one saved result object.

        The detached `direct-start` envelope is deliberately not asserted here.
        """
        self.assertEqual(record['code'], 0, record['stderr'][:300])
        self.assertEqual(record['stderr'], '')
        return self.one_object(record, 'stdout')

    def run_turn(self, session, ident, endpoint, task=None, resume='',
                 workspace=None, model=None, effort=None):
        recorded = self.call('player', session)
        task = task or self.task
        argv = ['turn', session, ident, str(endpoint),
                model or recorded['model'] or 'fixture-model',
                effort or recorded['effort'] or 'low',
                workspace or recorded['workspace'] or str(self.repo),
                str(task), str(self.directory / (ident + '.jsonl')), resume]
        return self.probe(*argv)

    def probe_ok(self, record):
        self.assertEqual(record['code'], 0, record['stderr'][:300])
        return record

    def retained(self, ident, body, recipient='root'):
        """The report row for one turn.

        This asserts retention, not delivery: the fixture owner has no endpoint,
        so a pending row is not evidence that a notice was delivered.
        """
        record = self.call('delivery', ident)
        self.assertEqual(record['body'], body)
        if recipient is not None:
            self.assertEqual(record['recipient'], recipient)
        return record

    def fixture_execution(self, session, ident, mode='direct', directory='',
                          phase='running', status=''):
        """Construct one legacy `executions` row in this fresh fixture database.

        Constructed, not produced by a runtime turn; used only where the reader
        must see a legacy pointer with no direct request row.
        """
        with sqlite3.connect(self.db) as database:
            database.execute('INSERT OR REPLACE INTO executions'
                             '(session,id,mode,directory,phase,status) VALUES(?,?,?,?,?,?)',
                             (session, ident, mode, directory, phase, status))


class CompletedRetry(DirectFixture):
    """Area 1: exact retry returns the retained result; a change conflicts."""

    def test_exact_retry_returns_the_retained_result(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                session = 'exact-' + harness
                self.recruit(session, harness)
                ident = session + '-turn'
                endpoint = self.endpoint('exact-' + harness)
                self.foreground_success(self.run_turn(session, ident, endpoint))
                self.retained(ident, self.task.read_text())
                self.assertEqual(len(self.starts()), 1)
                starts = len(self.starts())
                self.foreground_success(self.run_turn(session, ident, endpoint))
                self.retained(ident, self.task.read_text())
                self.assertEqual(len(self.starts()), starts,
                                 'an exact retry started the endpoint again')

    def test_changed_task_conflicts_and_preserves_the_original(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                session = 'changed-' + harness
                self.recruit(session, harness)
                ident = session + '-turn'
                endpoint = self.endpoint('changed-' + harness)
                self.foreground_success(self.run_turn(session, ident, endpoint))
                original = self.retained(ident, self.task.read_text())
                starts = len(self.starts())
                changed = self.directory / (ident + '-changed.txt')
                changed.write_text('A different task under the same turn ID.\n')
                result = self.run_turn(session, ident, endpoint, task=changed)
                obj = self.refusal(result)
                self.assertEqual(obj['error'], CONFLICT)
                for field in CONFLICT_FIELDS:
                    self.assertIn(field, obj, f'the conflict omits {field}')
                self.assertIn('task', str(obj['field']).lower(),
                              'the conflict must name the differing field')
                self.assertEqual(obj['requestId'], ident)
                self.assertEqual(self.retained(ident, self.task.read_text()), original,
                                 'a changed request altered the retained report')
                self.assertEqual(len(self.starts()), starts,
                                 'a changed request started the endpoint')


class HistoricalRetry(DirectFixture):
    """Area 2: an older completed ID survives a newer turn for the session."""

    def test_historical_retry_after_a_newer_turn(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                session = 'history-' + harness
                self.recruit(session, harness)
                older = session + '-older'
                older_endpoint = self.endpoint('older-' + harness)
                self.foreground_success(self.run_turn(session, older, older_endpoint))
                older_report = self.retained(older, self.task.read_text())
                newer = session + '-newer'
                newer_task = self.directory / (newer + '.txt')
                newer_task.write_text('A newer turn for the same session.\n')
                newer_endpoint = self.endpoint('newer-' + harness)
                self.foreground_success(self.run_turn(session, newer, newer_endpoint,
                                                      task=newer_task))
                self.retained(newer, newer_task.read_text())
                self.assertNotEqual(self.call('delivery', newer), older_report)
                starts = len(self.starts())
                self.foreground_success(self.run_turn(session, older, older_endpoint))
                self.assertEqual(self.retained(older, self.task.read_text()), older_report,
                                 'the older request lost its retained report')
                self.assertEqual(len(self.starts()), starts,
                                 'the historical retry started the endpoint again')


class LegacyUnbound(DirectFixture):
    """Area 3: artifacts with no direct request row, runtime and constructed."""

    def test_runtime_report_without_a_request_row_is_legacy_unbound(self):
        """Runtime artifact: an ordinary report command created this row."""
        self.prepare()
        self.recruit('leaf', 'muse')
        body = 'A retained report with no direct request row.\n'
        self.call('report', 'legacy-report', 'leaf', body)
        self.retained('legacy-report', body)
        status = self.probe('turn-status', 'legacy-report')
        self.assertEqual(status['code'], 0, status['stderr'][:200])
        obj = self.one_object(status)
        for field in STATUS_FIELDS:
            self.assertIn(field, obj, f'turn-status omits {field}')
        self.assertEqual(obj['identityBinding'], LEGACY_BINDING)
        self.assertEqual(obj['requestId'], 'legacy-report')
        for field in ('request', 'lifetime'):
            self.assertFalse(obj[field],
                             f'{field} must be null or unavailable, not guessed')
        recovered = self.probe('turn-recover', 'legacy-report')
        self.assertNotEqual(recovered['code'], 0)
        self.assertIn(HISTORY_UNBOUND, recovered['stdout'] + recovered['stderr'])
        self.retained('legacy-report', body)

    def test_constructed_running_execution_without_a_request_row(self):
        """Constructed artifact: a fixture-owned legacy pointer, no request row."""
        self.prepare()
        self.recruit('leaf', 'muse')
        ident = 'legacy-running'
        self.fixture_execution('leaf', ident, phase='running', status='')
        obj = self.one_object(self.probe('turn-status', ident))
        self.assertEqual(obj['identityBinding'], LEGACY_BINDING)
        self.assertEqual(obj['requestId'], ident)
        self.assertEqual(obj['session'], 'leaf')
        self.assertEqual(obj['mode'], 'direct')
        self.assertEqual(obj['phase'], 'running')
        self.assertFalse(obj['request'])
        self.assertFalse(obj['lifetime'])

    def test_completed_report_after_the_pointer_advanced(self):
        """Runtime report plus a constructed newer pointer for the same session."""
        self.prepare()
        self.recruit('leaf', 'muse')
        body = 'A completed report whose pointer has since advanced.\n'
        self.call('report', 'advanced-report', 'leaf', body)
        self.fixture_execution('leaf', 'newer-attempt', phase='running', status='')
        obj = self.one_object(self.probe('turn-status', 'advanced-report'))
        self.assertEqual(obj['identityBinding'], LEGACY_BINDING)
        self.assertEqual(obj['requestId'], 'advanced-report')
        self.assertFalse(obj['request'],
                         'the reader must not backfill a request identity')
        self.retained('advanced-report', body)

    def test_wholly_absent_identity_is_direct_request_not_found(self):
        self.prepare()
        obj = self.refusal(self.probe('turn-status', 'no-such-request'))
        self.assertEqual(obj['error'], NOT_FOUND)
        self.assertEqual(obj['requestId'], 'no-such-request')
        self.assertNotEqual(obj.get('identityBinding'), LEGACY_BINDING)


class ParentlessCompletion(DirectFixture):
    """Area 4: local foreground completion against detached owner refusal."""

    def test_parentless_foreground_completion_is_local(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                ident = 'local-' + harness
                endpoint = self.endpoint('local-' + harness)
                self.foreground_success(self.run_turn('root', ident, endpoint,
                                                      workspace=str(self.repo)))
                self.assertEqual(len(self.starts()), 1)
                self.assertEqual(
                    self.rows('SELECT id FROM messages WHERE id=?', (ident,)), [],
                    'a parentless local completion inserted a report message')
                self.foreground_success(self.run_turn('root', ident, endpoint,
                                                      workspace=str(self.repo)))
                self.assertEqual(len(self.starts()), 1,
                                 'the local retry started the endpoint again')

    def test_parentless_detached_start_refuses_before_effects(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                ident = 'detached-' + harness
                obj = self.refusal(self.probe('dispatch-turn', 'root', ident,
                                              self.endpoint('detached-' + harness),
                                              self.directory / (ident + '.jsonl'),
                                              self.task))
                self.assertEqual(obj['error'], OWNER_UNAVAILABLE)
                self.assertEqual(self.starts(), [],
                                 'the endpoint started before the refusal')
                self.assertEqual(
                    self.rows('SELECT id FROM messages WHERE id=?', (ident,)), [])


class BaselineAdapterFixtures(DirectFixture):
    """Executed evidence: each harness completes a real turn through its adapter.

    Not candidate qualification. It proves the fixture endpoint speaks each
    adapter's protocol by completing one ordinary foreground turn per adapter and
    reading back the report body.
    """

    def test_every_adapter_fixture_completes_a_real_turn(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                session = 'adapter-' + harness
                self.recruit(session, harness)
                ident = session + '-turn'
                self.probe_ok(self.run_turn(session, ident,
                                            self.endpoint('adapter-' + harness)))
                self.retained(ident, self.task.read_text())
                started = self.starts()[-1]
                self.assertEqual(started['prompt'], self.task.read_text(),
                                 f'the {harness} fixture did not receive the task prompt')


class BaselineDirectHistory(DirectFixture):
    """Bounded control: the required refusal is absent from a baseline binary."""

    def test_baseline_lacks_the_history_readers_and_replays_a_changed_request(self):
        self.prepare()
        self.assertNotEqual(self.probe('turn-status', 'control-id')['code'], 0,
                            'the baseline has a turn-status command')
        self.recruit('control-muse', 'muse')
        ident = 'baseline-muse-turn'
        endpoint = self.endpoint('baseline-muse')
        self.probe_ok(self.run_turn('control-muse', ident, endpoint))
        retained = self.retained(ident, self.task.read_text())
        starts = len(self.starts())
        changed = self.directory / (ident + '-changed.txt')
        changed.write_text('A different task under the same turn ID.\n')
        replay = self.run_turn('control-muse', ident, endpoint, task=changed)
        self.assertEqual(replay['code'], 0,
                         'the baseline refused the changed request; the defect is absent')
        self.assertEqual(self.retained(ident, self.task.read_text()), retained)
        self.assertEqual(len(self.starts()), starts,
                         'the baseline started the endpoint on the replay')


CASES = {
    CompletedRetry: ('test_exact_retry_returns_the_retained_result',
                     'test_changed_task_conflicts_and_preserves_the_original'),
    HistoricalRetry: ('test_historical_retry_after_a_newer_turn',),
    LegacyUnbound: ('test_runtime_report_without_a_request_row_is_legacy_unbound',
                    'test_constructed_running_execution_without_a_request_row',
                    'test_completed_report_after_the_pointer_advanced',
                    'test_wholly_absent_identity_is_direct_request_not_found'),
    ParentlessCompletion: ('test_parentless_foreground_completion_is_local',
                           'test_parentless_detached_start_refuses_before_effects'),
    BaselineAdapterFixtures: ('test_every_adapter_fixture_completes_a_real_turn',),
    BaselineDirectHistory: ('test_baseline_lacks_the_history_readers_and_replays_a_changed_request',),
}


def load_tests(loader, tests, pattern):
    # Reuse the owned fixture helpers without rerunning Control's own suite, and
    # honour an explicit selection such as `python3 FILE.py BaselineDirectHistory`.
    selected = []

    def walk(suite):
        for item in suite:
            if isinstance(item, unittest.TestSuite):
                walk(item)
                continue
            case = type(item)
            name = item._testMethodName
            if case in CASES and name in CASES[case]:
                selected.append(case(name))

    walk(tests)
    return unittest.TestSuite(selected)


if __name__ == '__main__':
    # `unittest.main()` cannot select a class here: every class inherits the base
    # Control suite, so a class-name selection would run those tests too.
    requested = [name for name in sys.argv[1:] if not name.startswith('-')]
    if requested:
        chosen = [case for case in CASES if case.__name__ in requested]
        assert chosen, f'unknown case class in {requested}'
        suite = unittest.TestSuite(case(name)
                                   for case in chosen for name in CASES[case])
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main()
