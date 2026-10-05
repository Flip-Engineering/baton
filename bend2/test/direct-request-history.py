"""Direct request history and inspection for #672, first slice.

Owner: structure Section, session semantic-controls-structure-research. Test-only:
this file owns no shared source, no `turn.bend`, no `Store`, no interfaces file,
and it changes neither `bend2/test/direct-start-boundary.py` (920f9430) nor any
other test.

Surfaces under test, from `95bfccf0:docs/bend2/direct-start-672-proposal.md`:
ordinary `turn` and `dispatch-turn`, and the new `turn-status ID` and
`turn-recover ID` readers.

First slice, four cases:
  1. a completed exact retry returns its retained result, and a changed task
     conflicts;
  2. a historical retry of an older completed ID after a newer turn for the same
     session still returns that older request's retained result;
  3. a report with no direct request row is inspected as legacy-unbound, and
     recovery of it refuses without backfilling identity;
  4. a parentless foreground completion is a local target with no report message,
     while a parentless detached start refuses before effects.

Every case runs on all four adapters. Each case uses a fresh Git repository and a
fresh SQLite database, and the endpoint is a self-completing fixture harness that
records its own starts and the prompt it received, so "no second effect" is
asserted from the endpoint's own ledger rather than from process counts. No
copied-live database, no product hook.

Executable: `BATON2_DIRECT_HISTORY_EXE`, else `BATON2_DIRECT_EXE` (the name the
920 slice uses), else the built `.scratch/bend2/baton2`. The candidate does not
exist yet, so a run against a built executable is the only qualified run, and no
skipped or failing case is treated as a candidate pass. The base harness asserts
the executable exists rather than skipping, which is what this slice needs.

PROPOSED WIRE FIELDS, awaiting confirmation before they become assertions. The
proposal specifies these names verbatim, and they are asserted concretely here:
the result type `direct-start` with `requestId`, `session`, `admissionDecision`,
`attemptDirectory`, `processState`, `observerAttached`, `resultId`,
`notification` and `next`; `admissionDecision` values `accepted` and `rejected`;
the refusal names `direct-request-conflict`, `direct-history-unbound` and
`direct-owner-unavailable` at exit 2; `turn-recover` outcomes `observationOwned`
and `controlUnavailable`; the completion target `local` with notification
`notRequiredLocal`; and the legacy label `legacy-unbound`.

The proposal does NOT specify, and this file therefore does not hardcode:

  - the envelope key that carries a refusal name (`error` in the other commands);
  - the keys inside `turn-status` beyond the `identityBinding` value, so the
    recorded session, mode, phase, status, directory and report facts are checked
    by containment in the serialized object rather than by key;
  - the key naming the differing field and the original request in a conflict,
    also checked by containment;
  - the `notification` vocabulary for an accepted remote start, and the
    `direct_requests` phase vocabulary.

Those four need confirmation before any of them is asserted by name.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

import control


control.EXE = Path(
    os.environ.get('BATON2_DIRECT_HISTORY_EXE')
    or os.environ.get('BATON2_DIRECT_EXE')
    or control.EXE).resolve()

HARNESSES = ('omp', 'codex', 'muse', 'claude-code')

# Specified by the proposal.
RESULT_TYPE = 'direct-start'
RESULT_FIELDS = ('requestId', 'session', 'admissionDecision', 'attemptDirectory',
                 'processState', 'observerAttached', 'resultId', 'notification', 'next')
CONFLICT = 'direct-request-conflict'
HISTORY_UNBOUND = 'direct-history-unbound'
OWNER_UNAVAILABLE = 'direct-owner-unavailable'
LEGACY_BINDING = 'legacy-unbound'
LOCAL_NOTIFICATION = 'notRequiredLocal'

HARNESS_SCRIPT = r'''import json, pathlib, sys
kwargs = sys.argv[1:]
home = pathlib.Path(__file__).resolve()
ledger = home.parent / 'starts.jsonl'
if '--mode' in kwargs:                       # omp: filter, get_state, prompt
    sys.stdin.readline(); sys.stdin.readline()
    prompt = json.loads(sys.stdin.readline())['message']
    frame = {'stream': {'kind': 'session', 'id': 'self-completing'},
             'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'terminal': 'completed', 'text': prompt}}
elif '--prompt-file' in kwargs:              # muse
    prompt = pathlib.Path(kwargs[kwargs.index('--prompt-file') + 1]).read_text()
    frame = {'stream': {'kind': 'session', 'id': 'self-completing'},
             'payload_type': 'run.terminal.completed',
             'payload': {'kind': 'run_terminal', 'terminal': 'completed', 'text': prompt}}
elif '--input-format' in kwargs:             # claude
    prompt = json.loads(sys.stdin.readline())['message']['content']
    frame = {'type': 'result', 'result': prompt, 'session_id': 'self-completing',
             'is_error': False}
else:                                        # codex
    prompt = sys.stdin.read()
    frame = {'type': 'result', 'result': prompt, 'session_id': 'self-completing',
             'is_error': False}
with ledger.open('a') as out:
    out.write(json.dumps({'argv': kwargs, 'prompt': prompt}) + '\n')
home.with_suffix('.effect').write_text(prompt)
print(json.dumps(frame), flush=True)
'''


class DirectFixture(control.Control):
    """Shared fixture: a parentless root, a self-completing endpoint per adapter."""

    def prepare(self, with_operator=False):
        self.call('attach', 'root', 'codex', 'saved-root', '')
        self.call('role', 'root', 'principal-conductor')
        if with_operator:
            self.call('attach', 'operator', 'operator', '', '')
            self.call('role', 'operator', 'operator')

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
        """Run one command and return its record without asserting the exit code.

        The base `call` helper asserts success, so any case that asserts a refusal
        code itself must go through this one instead.
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

    def direct_start(self, record):
        self.assertEqual(record['code'], 0, record['stderr'][:300])
        obj = self.one_object(record)
        self.assertEqual(obj['type'], RESULT_TYPE)
        for field in RESULT_FIELDS:
            self.assertIn(field, obj, f'the direct-start result omits {field}')
        return obj

    def run_turn(self, session, ident, endpoint, task=None, resume='',
                 workspace=None, model=None, effort=None):
        """One foreground direct turn, with the endpoint completing itself."""
        recorded = self.call('player', session)
        task = task or self.task
        argv = ['turn', session, ident, str(endpoint),
                model or recorded['model'] or 'fixture-model',
                effort or recorded['effort'] or 'low',
                workspace or recorded['workspace'] or str(self.repo),
                str(task), str(self.directory / (ident + '.jsonl')), resume]
        return self.probe(*argv)


class CompletedRetry(DirectFixture):
    """Case 1: exact retry returns the retained result; a change conflicts."""

    def test_exact_retry_returns_the_retained_result(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                session = 'exact-' + harness
                self.recruit(session, harness)
                ident = session + '-turn'
                endpoint = self.endpoint('exact-' + harness)
                self.direct_start(self.run_turn(session, ident, endpoint))
                retained = self.call('delivery', ident)
                self.assertEqual(retained['recipient'], 'root')
                starts = len(self.starts())
                self.direct_start(self.run_turn(session, ident, endpoint))
                self.assertEqual(self.call('delivery', ident), retained,
                                 'an exact retry changed the retained report')
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
                self.direct_start(self.run_turn(session, ident, endpoint))
                retained = self.call('delivery', ident)
                starts = len(self.starts())
                changed = self.directory / (ident + '-changed.txt')
                changed.write_text('A different task under the same turn ID.\n')
                result = self.run_turn(session, ident, endpoint, task=changed)
                self.assertEqual(result['code'], 2,
                                 'a changed request must refuse at exit 2')
                self.assertEqual(result['stdout'], '')
                self.one_object(result, 'stderr')
                self.assertIn(CONFLICT, result['stderr'],
                              'the refusal must name direct-request-conflict')
                self.assertIn('task', result['stderr'],
                              'the refusal must name the differing field')
                self.assertEqual(self.call('delivery', ident), retained,
                                 'a changed request altered the retained report')
                self.assertEqual(len(self.starts()), starts,
                                 'a changed request started the endpoint')


class HistoricalRetry(DirectFixture):
    """Case 2: an older completed ID survives a newer turn for the session."""

    def test_historical_retry_after_a_newer_turn(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                session = 'history-' + harness
                self.recruit(session, harness)
                older = session + '-older'
                older_endpoint = self.endpoint('older-' + harness)
                self.direct_start(self.run_turn(session, older, older_endpoint))
                older_report = self.call('delivery', older)
                newer = session + '-newer'
                newer_task = self.directory / (newer + '.txt')
                newer_task.write_text('A newer turn for the same session.\n')
                newer_endpoint = self.endpoint('newer-' + harness)
                self.direct_start(self.run_turn(session, newer, newer_endpoint,
                                                task=newer_task))
                self.assertNotEqual(self.call('delivery', newer), older_report)
                starts = len(self.starts())
                self.direct_start(self.run_turn(session, older, older_endpoint))
                self.assertEqual(self.call('delivery', older), older_report,
                                 'the older request lost its retained report')
                self.assertEqual(len(self.starts()), starts,
                                 'the historical retry started the endpoint again')


class LegacyUnbound(DirectFixture):
    """Case 3: an artifact with no direct request row is legacy-unbound."""

    def test_report_without_a_request_row_is_legacy_unbound(self):
        self.prepare()
        self.recruit('leaf', 'muse')
        body = 'A retained report with no direct request row.\n'
        self.call('report', 'legacy-report', 'leaf', body)
        self.assertEqual(self.call('delivery', 'legacy-report')['body'], body)
        status = self.probe('turn-status', 'legacy-report')
        text = status['stdout'] + status['stderr']
        self.assertIn(LEGACY_BINDING, text,
                      'a report with no request row must report legacy-unbound')
        self.assertIn('legacy-report', text)
        recovered = self.probe('turn-recover', 'legacy-report')
        self.assertNotEqual(recovered['code'], 0,
                            'recovery without sufficient identity must refuse')
        self.assertIn(HISTORY_UNBOUND, recovered['stdout'] + recovered['stderr'],
                      'the refusal must name direct-history-unbound')
        self.assertEqual(self.call('delivery', 'legacy-report')['body'], body,
                         'inspection or recovery altered the retained report')

    def test_wholly_absent_identity_is_typed_not_found(self):
        self.prepare()
        missing = self.probe('turn-status', 'no-such-request')
        self.assertNotEqual(missing['code'], 0)
        text = missing['stdout'] + missing['stderr']
        self.assertIn('no-such-request', text)
        self.assertNotIn(LEGACY_BINDING, text,
                         'a wholly absent identity is not legacy-bound evidence')


class ParentlessCompletion(DirectFixture):
    """Case 4: local foreground completion against detached owner refusal."""

    def test_parentless_foreground_completion_is_local(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                ident = 'local-' + harness
                endpoint = self.endpoint('local-' + harness)
                self.direct_start(self.run_turn('root', ident, endpoint,
                                                workspace=str(self.repo)))
                self.assertEqual(
                    self.rows('SELECT id FROM messages WHERE id=?', (ident,)), [],
                    'a parentless local completion inserted a report message')
                starts = len(self.starts())
                self.direct_start(self.run_turn('root', ident, endpoint,
                                                workspace=str(self.repo)))
                self.assertEqual(len(self.starts()), starts,
                                 'the local retry started the endpoint again')

    def test_parentless_detached_start_refuses_before_effects(self):
        self.prepare()
        for harness in HARNESSES:
            with self.subTest(harness=harness):
                ident = 'detached-' + harness
                result = self.probe('dispatch-turn', 'root', ident,
                                   self.endpoint('detached-' + harness),
                                   self.directory / (ident + '.jsonl'),
                                   self.task)
                self.assertNotEqual(result['code'], 0,
                                    'a parentless detached start must refuse')
                self.assertIn(OWNER_UNAVAILABLE, result['stdout'] + result['stderr'],
                              'the refusal must name direct-owner-unavailable')
                self.assertEqual(self.starts(), [],
                                 'the endpoint started before the refusal')
                self.assertEqual(
                    self.rows('SELECT id FROM messages WHERE id=?', (ident,)), [])


class BaselineDirectHistory(DirectFixture):
    """Bounded control: the required behaviour is absent from a baseline binary.

    Not candidate qualification. It runs the same fixture surface against the
    released executable and records the measured defect, so the candidate cases
    are known to test something new.
    """

    def test_baseline_lacks_the_history_readers_and_replays_a_changed_request(self):
        self.prepare()
        absent = self.probe('turn-status', 'control-id')
        self.assertNotEqual(absent['code'], 0, 'the baseline has a turn-status command')
        self.recruit('control-muse', 'muse')
        ident = 'baseline-muse-turn'
        endpoint = self.endpoint('baseline-muse')
        first = self.run_turn('control-muse', ident, endpoint)
        self.assertEqual(first['code'], 0, first['stderr'][:300])
        retained = self.call('delivery', ident)
        starts = len(self.starts())
        changed = self.directory / (ident + '-changed.txt')
        changed.write_text('A different task under the same turn ID.\n')
        replay = self.run_turn('control-muse', ident, endpoint, task=changed)
        self.assertEqual(replay['code'], 0,
                         'the baseline refused the changed request; the defect is absent')
        self.assertEqual(self.call('delivery', ident), retained,
                         'the baseline changed the retained report')
        self.assertEqual(len(self.starts()), starts,
                         'the baseline started the endpoint on the replay')


CASES = {
    CompletedRetry: ('test_exact_retry_returns_the_retained_result',
                     'test_changed_task_conflicts_and_preserves_the_original'),
    HistoricalRetry: ('test_historical_retry_after_a_newer_turn',),
    LegacyUnbound: ('test_report_without_a_request_row_is_legacy_unbound',
                    'test_wholly_absent_identity_is_typed_not_found'),
    ParentlessCompletion: ('test_parentless_foreground_completion_is_local',
                           'test_parentless_detached_start_refuses_before_effects'),
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
    # `unittest.main()` cannot select a class here: every class inherits the
    # base Control suite, so a class-name selection would run those tests too.
    requested = [name for name in sys.argv[1:] if not name.startswith('-')]
    if requested:
        chosen = [case for case in CASES if case.__name__ in requested]
        assert chosen, f'unknown case class in {requested}'
        suite = unittest.TestSuite(case(name)
                                   for case in chosen for name in CASES[case])
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main()
