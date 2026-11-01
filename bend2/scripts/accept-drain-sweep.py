#!/usr/bin/env python3
"""Qualify deferred drain sweeps through the shared compilation queue."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]


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
    args = parser.parse_args()
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
         'test_the_owner_launches_the_drain_sweep_when_it_starts_and_after_its_drain',
         'test_drain_refuses_new_attempts_until_the_owner_exits'],
        output / 'owner-sweep-lifecycle.log', instance_env, evidence)

    final_source = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True,
                                  capture_output=True, check=True).stdout.strip()
    if final_source != source:
        raise SystemExit(f'source changed during qualification: {source} -> {final_source}')
    (output / 'qualification.json').write_text(json.dumps({
        'source_commit': source,
        'scope': 'instance-drain laws, focused receiver, private sweep fixtures, owner drain lifecycle',
        'main_entry_built': False,
        'commands': evidence,
    }, indent=2) + '\n')
    print(output / 'qualification.json')


if __name__ == '__main__':
    main()
