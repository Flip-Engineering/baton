"""Remote driver for the Receive host behaviour controls.

Runs only on a root-admitted remote runner. It never runs here.

The driver reads the authoritative mapping from receive-host-controls.json, takes
its inputs from an explicit remote input directory, and for each of the four
consume-site controls:

  1. verifies every declared input hash, failing on a mismatch;
  2. requires the exact artifact path, failing when it is missing, and records its
     SHA-256;
  3. copies the source tree, requires exactly one occurrence of the control's find
     text, applies its replacement, and builds; a build that does not exit zero is
     inconclusive, never a rejection;
  4. runs the positive fixture set against the untouched artifact, requiring every
     case to pass with no skip;
  5. runs the control's discriminating and companion cases against the mutant,
     requiring each companion to pass and each discriminating case to fail as an
     assertion;
  6. retains, per case, the identity, the complete command, stdout, stderr and
     actual exit.

A missing named case, a skip, a setup or collection error, an unrelated exception
or a compiler error is inconclusive and fails the run. Only an assertion failure
in a designated discriminating case, after a successful mutant build and a
passing positive run on the untouched artifact, counts as a behavioural rejection.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
CONTROLS = REPO / 'bend2' / 'scripts' / 'receive-host-controls.json'
ARTIFACT = pathlib.Path('.scratch/bend2/baton2')
FIXTURE = 'bend2/test/receive-retained-replay.py'

POSITIVE_CASES = [
    'ControlledFrames.test_an_observed_later_failure_is_reported_over_an_older_observed_error',
    'ControlledFrames.test_an_elided_terminal_repeating_an_older_error_reports_the_later_completion',
    'ControlledFrames.test_a_started_error_after_a_cached_success_stays_the_current_failure',
    'ControlledFrames.test_a_complete_terminal_after_a_success_keeps_its_current_error',
    'ControlledFrames.test_empty_terminal_keeps_a_retained_failure',
    'ControlledFrames.test_empty_terminal_keeps_an_unidentified_retained_failure',
    'ControlledFrames.test_a_terminal_only_error_after_an_observed_success_is_not_a_success',
    'ControlledFrames.test_a_started_success_without_completion_does_not_replace_an_error',
    'ControlledFrames.test_an_assistant_frame_without_a_response_ends_the_completion_authority',
    'ControlledFrames.test_a_started_message_over_an_empty_terminal_is_not_the_retained_success',
    'ControlledFrames.test_two_missing_identities_cannot_establish_the_current_error',
    'ControlledFrames.test_a_neutral_frame_after_an_incomplete_start_keeps_no_success',
    'ControlledFrames.test_a_neutral_frame_before_the_terminal_keeps_the_later_completion',
    'ControlledFrames.test_empty_terminal_uses_the_retained_report',
    'ControlledFrames.test_unavailable_content_is_reported_truthfully',
    'ControlledFrames.test_sequential_success_then_error_keeps_the_first_report',
    'ControlledFrames.test_sequential_error_then_success_keeps_the_first_failure',
]

CONSUME_CONTROLS = [
    'consume-bypasses-the-activity-update',
    'consume-bypasses-terminal-normalization',
    'consume-propagates-the-previous-activity',
    'consume-propagates-empty-activity',
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command, cwd, env):
    completed = subprocess.run(list(command), cwd=str(cwd), env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return {'command': [str(part) for part in command], 'exit': completed.returncode,
            'stdout': completed.stdout, 'stderr': completed.stderr}


def case_outcome(result, case):
    """The outcome of one unittest case: pass, assertion, inconclusive."""
    text = result['stdout'] + result['stderr']
    if re.search(r'skipped', text) and case.split('.')[-1] in text and 'skipped' in text:
        return 'skipped'
    if re.search(r'^ERROR: ' + re.escape(case), text, re.M):
        return 'error'
    if re.search(r'^FAIL: ' + re.escape(case), text, re.M):
        return 'assertion'
    if re.search(r'^' + re.escape(case) + r'.*\.\.\. ok', text, re.M):
        return 'pass'
    return 'inconclusive'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Receive host control driver, remote runners only')
    parser.add_argument('--inputs', required=True, help='directory holding the immutable replay inputs')
    parser.add_argument('--bend', required=True, help='path to the pinned Bend executable')
    parser.add_argument('--store', required=True, help='directory for retained per-execution evidence')
    parser.add_argument('--copy-root', required=True, help='directory for isolated source copies')
    options = parser.parse_args(argv)

    inputs = pathlib.Path(options.inputs)
    store = pathlib.Path(options.store)
    store.mkdir(parents=True, exist_ok=True)
    controls = json.loads(CONTROLS.read_text())
    summary = {'failures': [], 'executions': []}

    for entry in controls['immutable_inputs']:
        if 'sha256' not in entry:
            continue
        source = inputs / entry['name']
        if not source.exists():
            summary['failures'].append(f"missing input {entry['name']} in {inputs}")
            continue
        if digest(source) != entry['sha256']:
            summary['failures'].append(f"input hash mismatch for {entry['name']}")

    mapping = controls['control_expectations']
    declared = mapping['controls']
    missing = [name for name in CONSUME_CONTROLS if name not in declared]
    extra = [name for name in declared if name not in CONSUME_CONTROLS]
    if missing or extra:
        summary['failures'].append(f'control metadata does not match the four consume controls: '
                                   f'missing {missing}, extra {extra}')

    definitions = {entry['name']: entry for entry in controls['controls']}
    for name in CONSUME_CONTROLS:
        if name not in definitions:
            summary['failures'].append(f'no definition for control {name}')

    if summary['failures']:
        json.dump(summary, open(store / 'preflight.json', 'w'), indent=2)
        print(json.dumps(summary, indent=2))
        return 1

    env = dict(os.environ, BEND_NO_TELEMETRY='1', BATON_RETAINED_LOGS=str(inputs))
    positive = run([sys.executable, FIXTURE, *POSITIVE_CASES, '-v'], REPO, env)
    (store / 'positive.json').write_text(json.dumps(positive, indent=2))
    positive_outcomes = {case: case_outcome(positive, case) for case in POSITIVE_CASES}
    summary['executions'].append({'case': 'positive', **{k: positive[k] for k in ('command', 'exit')}})
    if positive['exit'] != 0 or any(state != 'pass' for state in positive_outcomes.values()):
        summary['failures'].append(f'positive fixture set did not pass cleanly: {positive_outcomes}')

    for name in CONSUME_CONTROLS:
        entry = definitions[name]
        expect = declared[name]
        work = pathlib.Path(options.copy_root) / name
        if work.exists():
            shutil.rmtree(work)
        shutil.copytree(REPO, work, dirs_exist_ok=False, ignore=shutil.ignore_patterns('.git'))
        target = work / entry['file']
        text = target.read_text()
        occurrences = text.count(entry['find'])
        if occurrences != 1:
            summary['failures'].append(f'{name}: find text occurs {occurrences} times, not once')
            continue
        target.write_text(text.replace(entry['find'], entry['replace']))
        build = run(['sh', 'bend2/scripts/build-native.sh'], work, dict(env, BEND=options.bend))
        artifact = work / ARTIFACT
        record = {'control': name, 'build_exit': build['exit'], 'command': build['command']}
        if build['exit'] != 0:
            record['inconclusive'] = 'mutant build failed; not a behavioural rejection'
            record['stderr'] = build['stderr'][-4000:]
            summary['executions'].append(record)
            continue
        if not artifact.exists():
            record['inconclusive'] = 'mutant artifact missing after a successful build'
            summary['executions'].append(record)
            continue
        record['artifact_sha256'] = digest(artifact)
        cases = expect['discriminating'] + expect['companion_expected_to_pass']
        result = run([sys.executable, str(work / FIXTURE), *cases, '-v'], work, env)
        outcomes = {case: case_outcome(result, case) for case in cases}
        record.update({'cases': cases, 'outcomes': outcomes, 'fixture_exit': result['exit'],
                       'stdout': result['stdout'][-8000:], 'stderr': result['stderr'][-4000:]})
        for case in expect['companion_expected_to_pass']:
            if outcomes[case] != 'pass':
                record.setdefault('failures', []).append(f'companion {case} is {outcomes[case]}')
        for case in expect['discriminating']:
            if outcomes[case] != 'assertion':
                record.setdefault('failures', []).append(
                    f'discriminating {case} is {outcomes[case]}, not a named assertion failure')
        if record.get('failures'):
            summary['failures'].append({'control': name, 'detail': record['failures']})
        summary['executions'].append(record)

    (store / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps({'failures': summary['failures'],
                      'executions': [{k: v for k, v in record.items() if k not in ('stdout', 'stderr')}
                                     for record in summary['executions']]}, indent=2))
    return 1 if summary['failures'] else 0


if __name__ == '__main__':
    sys.exit(main())
