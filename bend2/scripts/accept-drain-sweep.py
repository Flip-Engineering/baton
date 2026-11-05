#!/usr/bin/env python3
"""Qualify deferred drain sweeps through the shared compilation queue."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
LAW_INPUTS = ('bend2/src/coordinator/instance-drain-laws.bend',
              'bend2/src/coordinator/instance-drain.bend',
              'bend2/src/git/text.bend')


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def git_file(commit, path):
    return subprocess.run(['git', 'show', f'{commit}:{path}'], cwd=ROOT,
                          capture_output=True, check=True).stdout


def resume_evidence(receipt_path, current_source):
    receipt_path = receipt_path.expanduser().resolve()
    try:
        prior = json.loads(receipt_path.read_text())
    except (OSError, ValueError) as error:
        raise SystemExit(f'could not read prior qualification receipt: {error}')
    if prior.get('schema') != 'baton1399-drain-sweep-qualification-final-receipt-v1':
        raise SystemExit('prior receipt has an unsupported schema')
    if (prior.get('status') != 'failed' or prior.get('exit_code') != 1
            or prior.get('terminal_stage') != 'build-focused-receiver'):
        raise SystemExit('prior receipt does not identify the failed focused receiver build')
    old_source = prior.get('source') or {}
    old_commit = old_source.get('commit')
    if not old_commit:
        raise SystemExit('prior receipt has no source commit')
    commands = prior.get('commands') or []
    law = next((item for item in commands if item.get('label') == 'check-instance-drain-laws'), None)
    if not law or law.get('exit_code') != 0:
        raise SystemExit('prior receipt does not contain a passing instance-drain laws check')
    check_log = (prior.get('logs') or {}).get('check-laws.log') or {}
    log_path = Path(check_log.get('path', ''))
    if not log_path.is_file() or sha256_bytes(log_path.read_bytes()) != check_log.get('sha256'):
        raise SystemExit('prior laws-check log is missing or has changed')
    if 'All terms check.' not in log_path.read_text(errors='replace'):
        raise SystemExit('prior laws-check log does not contain the success marker')
    error_text = prior.get('focused_build_error', '')
    if ('fork line c2aa4f7a2a101cdaf470efb6e7fff976b7e740ff' not in error_text
            or 'pins d1bbe3d2a3ff4974068e71df0a7e9936d53e775d' not in error_text):
        raise SystemExit('prior focused build did not fail on the expected compiler lineage pin')
    unchanged = {}
    for path in LAW_INPUTS:
        old_bytes = git_file(old_commit, path)
        current_bytes = (ROOT / path).read_bytes()
        old_hash = sha256_bytes(old_bytes)
        current_hash = sha256_bytes(current_bytes)
        if old_hash != current_hash:
            raise SystemExit(f'cannot reuse laws check; relevant source changed: {path}')
        unchanged[path] = current_hash
    old_compiler = prior.get('compiler') or {}
    if old_compiler.get('bend_sha256') != '5de0b620087e30747db8bee95d974e7805bf574a8d243bcc324f4278462e167e':
        raise SystemExit('prior laws check used a different compiler binary')
    current_compiler = Path(os.environ.get('BEND', ''))
    if (not current_compiler.is_file()
            or sha256_bytes(current_compiler.read_bytes()) != old_compiler.get('bend_sha256')):
        raise SystemExit('current qualification selects a different compiler binary')
    prior_queue = prior.get('queue_runner_sha256')
    current_queue = Path(os.environ.get('BATON2_COMPILE_QUEUE_BIN', ''))
    if (not current_queue.is_file() or not prior_queue
            or sha256_bytes(current_queue.read_bytes()) != prior_queue):
        raise SystemExit('current qualification selects a different shared queue runner')
    if os.environ.get('BATON2_COMPILE_QUEUE_PRIORITY') != '1':
        raise SystemExit('current shared queue priority differs from the prior laws check')
    return {
        'prior_receipt': str(receipt_path),
        'prior_source_commit': old_commit,
        'prior_source_tree': old_source.get('tree'),
        'reused_stage': 'check-instance-drain-laws',
        'reused_stage_exit_code': 0,
        'prior_check_log': str(log_path),
        'prior_check_log_sha256': check_log.get('sha256'),
        'unchanged_law_inputs': unchanged,
        'current_source_commit': current_source,
    }


def run(label, argv, output, env, evidence):
    record = {'label': label, 'argv': list(map(str, argv)), 'log': str(output)}
    with output.open('w') as stream:
        result = subprocess.run(list(map(str, argv)), cwd=ROOT, env=env,
                                stdout=stream, stderr=subprocess.STDOUT)
    record['exit_code'] = result.returncode
    evidence.append(record)
    (output.parent / 'commands.json').write_text(json.dumps(evidence, indent=2) + '\n')
    if result.returncode:
        raise SystemExit(f'{label} failed with exit {result.returncode}; see {output}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path,
                        help='new empty directory for private binaries and complete command logs')
    parser.add_argument('--resume-after', choices=('check-instance-drain-laws',),
                        help='reuse the named passing stage after verifying its prior receipt and unchanged inputs')
    parser.add_argument('--prior-receipt', type=Path,
                        help='terminal receipt required with --resume-after')
    args = parser.parse_args()
    if args.resume_after and not args.prior_receipt:
        parser.error('--prior-receipt is required with --resume-after')
    if args.prior_receipt and not args.resume_after:
        parser.error('--prior-receipt requires --resume-after')
    output = args.output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error('--output must be outside the repository')
    if output.exists() and any(output.iterdir()):
        parser.error('--output must be absent or empty')
    source = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True,
                            capture_output=True, check=True).stdout.strip()
    status = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=all'],
                            cwd=ROOT, text=True, capture_output=True, check=True).stdout
    if status:
        parser.error('qualification requires a clean source tree')
    reused = resume_evidence(args.prior_receipt, source) if args.resume_after else None
    output.mkdir(parents=True, exist_ok=True)
    artifacts = output / 'artifacts'
    artifacts.mkdir()
    queue_run = output / 'queue-run'
    queue_run.mkdir()
    temp = output / 'tmp'
    temp.mkdir()
    env = dict(os.environ)
    env.update({'BEND_NO_TELEMETRY': '1', 'BATON2_QUEUE_RUN_ROOT': str(queue_run),
                'TMPDIR': str(temp)})
    focused = artifacts / 'receive-focused'
    store_fixture = artifacts / 'drain-sweep-store'
    instance_fixture = artifacts / 'instance-test'
    evidence = []
    if reused:
        evidence.append({
            'label': reused['reused_stage'],
            'exit_code': reused['reused_stage_exit_code'],
            'reused_from_prior_run': True,
            'source_commit': reused['prior_source_commit'],
            'source_tree': reused['prior_source_tree'],
            'log': reused['prior_check_log'],
            'log_sha256': reused['prior_check_log_sha256'],
            'input_sha256': reused['unchanged_law_inputs'],
        })
        (output / 'commands.json').write_text(json.dumps(evidence, indent=2) + '\n')

    if not reused:
        run('check-instance-drain-laws',
            ['sh', 'bend2/scripts/check-entry.sh', 'bend2/src/coordinator/instance-drain-laws.bend'],
            output / 'check-laws.log', env, evidence)
    run('build-focused-receiver',
        ['sh', 'bend2/scripts/build-native.sh', 'bend2/src/coordinator/receive-focused.bend', focused],
        output / 'build-focused.log', env, evidence)
    run('build-store-lock-fixture',
        ['sh', 'bend2/scripts/build-native.sh', 'bend2/test/drain-sweep-store.bend', store_fixture],
        output / 'build-store-fixture.log', env, evidence)
    run('build-instance-fixture',
        ['sh', 'bend2/scripts/build-native.sh', 'bend2/test/instance.bend', instance_fixture],
        output / 'build-instance-fixture.log', env, evidence)

    fixture_env = dict(env, BATON2_DRAIN_SWEEP_EXE=str(focused),
                       BATON2_DRAIN_SWEEP_STORE=str(store_fixture))
    run('drain-sweep-regressions', [sys.executable, 'bend2/test/drain-sweep.py'],
        output / 'drain-sweep-regressions.log', fixture_env, evidence)
    instance_env = dict(env, BATON2_INSTANCE_TEST=str(instance_fixture))
    run('owner-sweep-lifecycle',
        [sys.executable, 'bend2/test/shared-instance.py',
         'SharedInstance.test_the_owner_launches_the_drain_sweep_when_it_starts_and_after_its_drain',
         'SharedInstance.test_drain_refuses_new_attempts_until_the_owner_exits'],
        output / 'owner-sweep-lifecycle.log', instance_env, evidence)

    final_source = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True,
                                  capture_output=True, check=True).stdout.strip()
    if final_source != source:
        raise SystemExit(f'source changed during qualification: {source} -> {final_source}')
    (output / 'qualification.json').write_text(json.dumps({
        'source_commit': source,
        'scope': 'instance-drain laws, focused receiver, private sweep fixtures, owner drain lifecycle',
        'resumed_after': reused,
        'main_entry_built': False,
        'commands': evidence,
    }, indent=2) + '\n')
    print(output / 'qualification.json')


if __name__ == '__main__':
    main()
