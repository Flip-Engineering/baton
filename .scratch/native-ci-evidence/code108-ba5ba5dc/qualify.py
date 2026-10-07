#!/usr/bin/python3.12
"""Code108 bounded remote admission: three pinned commands.

Candidate ba5ba5dc (bend2/context/bend2) with pinned upstream inputs.
Commands (from candidate repository root):
  1. node --test bend2/context/bend2/source-binding.test.mjs
  2. node --test bend2/context/bend2/frontend-adapter.test.mjs
  3. env BATON2_*=<pinned inputs> node --experimental-strip-types
     bend2/context/bend2/frontend-invocation.harness.mjs
Full stdout/stderr/exit retained per command. No package install,
no live provider, no full-law run.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

ROOT = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/frontend-code108-ba5ba5dc')
CANDIDATE = ROOT / 'candidate'
PINNED = ROOT / 'pinned'
EVIDENCE = ROOT / 'evidence'
NODE = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/tool-cache/node/22.23.3/x64/bin/node')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run_stage(name, argv, env_extra=None):
    env = {'HOME': str(ROOT), 'PATH': '/usr/bin:/bin', 'LC_ALL': 'C',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
           'TMPDIR': str(ROOT / 'tmp')}
    if env_extra:
        env.update(env_extra)
    started = now()
    proc = subprocess.run(argv, cwd=CANDIDATE, env=env, capture_output=True,
                          text=True, timeout=None)
    ended = now()
    (EVIDENCE / f'{name}.stdout').write_text(proc.stdout)
    (EVIDENCE / f'{name}.stderr').write_text(proc.stderr)
    return {'stage': name, 'argv': [str(a) for a in argv],
            'env_extra': env_extra or {}, 'cwd': str(CANDIDATE),
            'exit_code': proc.returncode, 'started': started, 'ended': ended,
            'stdout_sha256': hashlib.sha256(proc.stdout.encode()).hexdigest(),
            'stderr_sha256': hashlib.sha256(proc.stderr.encode()).hexdigest(),
            'stdout_bytes': len(proc.stdout.encode()),
            'stderr_bytes': len(proc.stderr.encode())}


def main():
    EVIDENCE.mkdir(exist_ok=True)
    (ROOT / 'tmp').mkdir(exist_ok=True)
    report = {'job': 'frontend-code108-ba5ba5dc', 'started': now(), 'stages': []}
    try:
        report['node_version'] = subprocess.check_output(
            [str(NODE), '--version'], text=True).strip()
        report['node_help_strip_types'] = subprocess.run(
            [str(NODE), '--help'], capture_output=True, text=True).stdout.find(
            'experimental-strip-types') >= 0
        report['uname'] = subprocess.check_output(['uname', '-a'], text=True).strip()
        report['source_state'] = {
            'head': subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=CANDIDATE, text=True,
                env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_GLOBAL': '/dev/null',
                     'GIT_CONFIG_NOSYSTEM': '1'}).strip()}
        report['stages'].append(run_stage(
            'source-binding-test',
            [str(NODE), '--test', 'bend2/context/bend2/source-binding.test.mjs']))
        report['stages'].append(run_stage(
            'frontend-adapter-test',
            [str(NODE), '--test', 'bend2/context/bend2/frontend-adapter.test.mjs']))
        report['stages'].append(run_stage(
            'frontend-invocation-harness',
            [str(NODE), '--experimental-strip-types',
             'bend2/context/bend2/frontend-invocation.harness.mjs'],
            env_extra={
                'BATON2_BEND_TS': str(PINNED / 'bend.ts'),
                'BATON2_MAIN_TS': str(PINNED / 'main.ts'),
                'BATON2_COMP_TS': str(PINNED / 'comp.ts'),
                'BATON2_BASE_BEND': str(PINNED / 'base.bend'),
                'BATON2_FIXTURE_DIR': 'bend2/context/bend2/fixtures'}))
        report['error'] = None
    except Exception:
        report['error'] = traceback.format_exc()
    report['ended'] = now()
    (EVIDENCE / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    ok = (report['error'] is None and report['stages']
          and all(s['exit_code'] == 0 for s in report['stages']))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
