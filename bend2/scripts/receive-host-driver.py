"""Remote driver for the Receive host behaviour controls. Remote runners only.

The driver never runs on the operator machine. It:

  1. exports one committed source snapshot into a unique run root and preserves it;
  2. derives isolated positive and mutant copies from that snapshot, without ever
     writing into an existing copy root;
  3. resolves the input directory and the compiler to absolute paths, requires the
     compiler to be present and executable before any build, and hashes every
     declared input, failing on a mismatch;
  4. builds the positive copy first, requires the build to succeed, requires the
     exact newly built artifact to exist, records its hash, and stops dependent
     work on any failure;
  5. runs the positive fixture set against that artifact, requiring the structured
     fixture report to show every named case present exactly once, in the test
     phase, passed, with no skip and no collection, setup or teardown error;
  6. for each of the four consume-site controls copies the snapshot, requires
     exactly one occurrence of its find text, builds, and then requires every
     companion case to pass and every discriminating case to fail in its test
     phase with the designated assertion marker;
  7. writes full stdout and stderr files plus a summary per run, into a unique run
     root, so later review sees the actual evidence rather than an excerpt.

A missing case, a skip, a collection, setup or teardown error, a launch or IO
failure, an unavailable or non-executable compiler, a missing artifact, a failed
positive, a failed mutant build, an abnormal process termination or an assertion
that is not the designated one is inconclusive and makes the run nonzero. Only a
designated discriminator failing in its test phase, after a successful mutant
build and a clean positive run, counts as a behavioural rejection.
"""

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
CONTROLS = REPO / 'bend2' / 'scripts' / 'receive-host-controls.json'
FIXTURE_RELATIVE = pathlib.Path('bend2/test/receive-retained-replay.py')
ARTIFACT_RELATIVE = pathlib.Path('.scratch/bend2/baton2')
BUILD_SCRIPT = pathlib.Path('bend2/scripts/build-native.sh')

POSITIVE_CASES = [
    'ControlledFrames.test_foreign_members_keep_the_latest_assistant_report',
    'ControlledFrames.test_empty_terminal_uses_the_retained_report',
    'ControlledFrames.test_unavailable_content_is_reported_truthfully',
    'ControlledFrames.test_current_failure_is_classified_while_the_native_exits_zero',
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
    'ControlledFrames.test_sequential_success_then_error_keeps_the_first_report',
    'ControlledFrames.test_sequential_error_then_success_keeps_the_first_failure',
    'RetainedReplay.test_original_protocol_research_stream_reports_the_retained_assistant',
    'RetainedReplay.test_original_observations_research_stream_reports_the_retained_assistant',
    'RetainedReplay.test_original_quota_terminal_is_classified_while_the_native_exits_zero',
]

CONSUME_CONTROLS = [
    'consume-bypasses-the-activity-update',
    'consume-bypasses-terminal-normalization',
    'consume-propagates-the-previous-activity',
    'consume-propagates-empty-activity',
]

IGNORED = shutil.ignore_patterns('.git', '.scratch', '__pycache__', '*.pyc')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(root, label, command, completed):
    stdout_path = root / f'{label}.stdout'
    stderr_path = root / f'{label}.stderr'
    stdout_path.write_bytes(completed.stdout or b'')
    stderr_path.write_bytes(completed.stderr or b'')
    return {'command': [str(part) for part in command],
            'exit': completed.returncode,
            'stdout_path': str(stdout_path),
            'stderr_path': str(stderr_path)}


def run(root, label, command, cwd, env):
    try:
        completed = subprocess.run([str(part) for part in command], cwd=str(cwd), env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as error:
        return {'command': [str(part) for part in command], 'exit': None,
                'launch_error': str(error), 'stdout_path': None, 'stderr_path': None}
    return record(root, label, command, completed)


def load_report(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except ValueError:
        return None


def case_findings(report, cases):
    """Per-case findings from the structured fixture report, or a reason it is unusable."""
    if report is None:
        return None, 'the structured fixture report is missing or not JSON'
    findings = {}
    for case in cases:
        entries = report.get(case)
        if not isinstance(entries, list) or len(entries) != 1:
            findings[case] = {'outcome': 'inconclusive',
                              'reason': 'the case is not present exactly once in the report'}
            continue
        entry = entries[0]
        findings[case] = {'outcome': entry.get('outcome'),
                          'phase': entry.get('phase'),
                          'message': entry.get('message')}
    return findings, None


def judge(findings, expected):
    problems = []
    for case, state in findings.items():
        if state['outcome'] == 'skipped':
            problems.append(f'{case} was skipped')
        elif state['phase'] != 'test':
            problems.append(f'{case} failed in its {state["phase"]} phase')
        elif state['outcome'] == 'error':
            problems.append(f'{case} raised an error rather than failing an assertion')
        elif state['outcome'] == 'inconclusive':
            problems.append(f'{case}: {state.get("reason", "no structured result")}')
    return problems


def prepare_snapshot(snapshot):
    snapshot.mkdir(parents=True)
    for name in ('bend2',):
        shutil.copytree(REPO / name, snapshot / name, ignore=IGNORED)
    manifest = {}
    for path in sorted((snapshot / 'bend2').rglob('*')):
        if path.is_file():
            manifest[str(path.relative_to(snapshot))] = digest(path)
    (snapshot / 'source-manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description='Receive host control driver, remote runners only')
    parser.add_argument('--inputs', required=True)
    parser.add_argument('--bend', required=True)
    parser.add_argument('--run-root', required=True)
    parser.add_argument('--assertion-marker', default='AssertionError')
    options = parser.parse_args(argv)

    inputs = pathlib.Path(options.inputs).resolve()
    compiler = pathlib.Path(options.bend).resolve()
    run_root = pathlib.Path(options.run_root).resolve()
    summary = {'run_root': str(run_root), 'failures': [], 'executions': []}

    if run_root.exists():
        print(json.dumps({'failures': [f'run root {run_root} already exists; refusing to overwrite']},
                         indent=2))
        return 1
    if not compiler.is_file() or not os.access(str(compiler), os.X_OK):
        print(json.dumps({'failures': [f'compiler {compiler} is unavailable or not executable']},
                         indent=2))
        return 1

    controls = json.loads(CONTROLS.read_text())
    for entry in controls.get('immutable_inputs', []):
        if 'sha256' not in entry:
            continue
        source = inputs / entry['name']
        if not source.exists():
            summary['failures'].append(f"missing input {entry['name']} in {inputs}")
        elif digest(source) != entry['sha256']:
            summary['failures'].append(f"input hash mismatch for {entry['name']}")
    declared = controls['control_expectations']['controls']
    if sorted(declared) != sorted(CONSUME_CONTROLS):
        summary['failures'].append('the control mapping does not match the four consume controls')
    mapped = {case for entry in declared.values()
              for case in entry['discriminating'] + entry['companion_expected_to_pass']}
    unmapped = sorted(case for case in mapped if case not in POSITIVE_CASES)
    if unmapped:
        summary['failures'].append(f'mapped cases missing from the positive gate: {unmapped}')
    definitions = {entry['name']: entry for entry in controls['controls']
                   if entry['name'] in CONSUME_CONTROLS}
    if sorted(definitions) != sorted(CONSUME_CONTROLS):
        summary['failures'].append('a consume control has no definition')
    if 'targets' in json.dumps(controls['control_expectations']):
        summary['failures'].append('the mapping carries a descriptive targets duplicate')

    if summary['failures']:
        print(json.dumps(summary, indent=2))
        return 1

    run_root.mkdir(parents=True)
    snapshot = run_root / 'snapshot'
    manifest = prepare_snapshot(snapshot)
    summary['snapshot'] = str(snapshot)
    summary['snapshot_entries'] = len(manifest)

    env = dict(os.environ, BEND_NO_TELEMETRY='1', BEND=str(compiler),
               BATON_RETAINED_LOGS=str(inputs),
               BATON_FIXTURE_REPORT=str(run_root / 'positive-report.json'))

    positive = run_root / 'positive'
    shutil.copytree(snapshot, positive, ignore=IGNORED)
    build = run(run_root, 'positive-build', ['sh', str(BUILD_SCRIPT)], positive, env)
    summary['executions'].append({'label': 'positive-build', **build})
    if build['exit'] != 0:
        summary['failures'].append('the positive build did not succeed; dependent work stopped')
        (run_root / 'summary.json').write_text(json.dumps(summary, indent=2))
        print(json.dumps(summary, indent=2))
        return 1
    artifact = positive / ARTIFACT_RELATIVE
    if not artifact.is_file():
        summary['failures'].append(f'the positive build produced no artifact at {artifact}')
        (run_root / 'summary.json').write_text(json.dumps(summary, indent=2))
        print(json.dumps(summary, indent=2))
        return 1
    summary['positive_artifact_sha256'] = digest(artifact)

    fixture = positive / FIXTURE_RELATIVE
    positive_run = run(run_root, 'positive-fixtures',
                       [sys.executable, str(fixture), *POSITIVE_CASES, '-v'], positive, env)
    summary['executions'].append({'label': 'positive-fixtures', **positive_run})
    report_path = pathlib.Path(env['BATON_FIXTURE_REPORT'])
    findings, reason = case_findings(load_report(report_path), POSITIVE_CASES)
    if reason:
        summary['failures'].append(reason)
    else:
        summary['failures'].extend(judge(findings, POSITIVE_CASES))
        for case, state in findings.items():
            if state['outcome'] != 'pass':
                summary['failures'].append(f'positive case {case} is {state["outcome"]}')
    if positive_run['exit'] != 0 and not summary['failures']:
        summary['failures'].append(f'the positive run exited {positive_run["exit"]}')
    if summary['failures']:
        (run_root / 'summary.json').write_text(json.dumps(summary, indent=2))
        print(json.dumps(summary, indent=2))
        return 1

    (run_root / 'positive-report.json').replace(run_root / 'positive-report-kept.json')

    for name in CONSUME_CONTROLS:
        entry = definitions[name]
        expectation = declared[name]
        work = run_root / f'mutant-{name}'
        shutil.copytree(snapshot, work, ignore=IGNORED)
        target = work / entry['file']
        text = target.read_text()
        occurrences = text.count(entry['find'])
        record_entry = {'control': name, 'occurrences': occurrences}
        if occurrences != 1:
            record_entry['inconclusive'] = f'the find text occurs {occurrences} times, not once'
            summary['failures'].append({'control': name, 'inconclusive': record_entry['inconclusive']})
            summary['executions'].append(record_entry)
            continue
        target.write_text(text.replace(entry['find'], entry['replace']))
        mutant_build = run(run_root, f'{name}-build', ['sh', str(BUILD_SCRIPT)], work, env)
        record_entry['build'] = mutant_build
        if mutant_build['exit'] != 0:
            record_entry['inconclusive'] = 'the mutant build failed; not a behavioural rejection'
            summary['failures'].append({'control': name, 'inconclusive': record_entry['inconclusive']})
            summary['executions'].append(record_entry)
            continue
        mutant_artifact = work / ARTIFACT_RELATIVE
        if not mutant_artifact.is_file():
            record_entry['inconclusive'] = 'the mutant build produced no artifact'
            summary['failures'].append({'control': name, 'inconclusive': record_entry['inconclusive']})
            summary['executions'].append(record_entry)
            continue
        record_entry['artifact_sha256'] = digest(mutant_artifact)
        cases = expectation['discriminating'] + expectation['companion_expected_to_pass']
        report_file = run_root / f'{name}-report.json'
        mutant_env = dict(env, BATON_FIXTURE_REPORT=str(report_file))
        mutant_run = run(run_root, f'{name}-fixtures',
                         [sys.executable, str(work / FIXTURE_RELATIVE), *cases, '-v'], work, mutant_env)
        record_entry['fixtures'] = mutant_run
        mutant_findings, mutant_reason = case_findings(load_report(report_file), cases)
        problems = []
        if mutant_reason:
            problems.append(mutant_reason)
        else:
            problems.extend(judge(mutant_findings, cases))
            for case in expectation['companion_expected_to_pass']:
                if mutant_findings[case]['outcome'] != 'pass':
                    problems.append(f'companion {case} is {mutant_findings[case]["outcome"]}')
            for case in expectation['discriminating']:
                state = mutant_findings[case]
                if state['outcome'] == 'assertion':
                    if options.assertion_marker not in (state.get('message') or ''):
                        problems.append(f'discriminator {case} failed without the designated marker')
                elif state['outcome'] != 'fail':
                    problems.append(f'discriminator {case} is {state["outcome"]}, not a failure')
                if state.get('phase') != 'test':
                    problems.append(f'discriminator {case} failed in its {state.get("phase")} phase')
        if problems:
            record_entry['problems'] = problems
            summary['failures'].append({'control': name, 'problems': problems})
        summary['executions'].append(record_entry)

    (run_root / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps({'run_root': str(run_root), 'failures': summary['failures'],
                      'executions': summary['executions']}, indent=2))
    return 1 if summary['failures'] else 0


if __name__ == '__main__':
    sys.exit(main())
