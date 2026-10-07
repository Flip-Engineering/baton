#!/usr/bin/python3.12
"""Item1 dirty-worktree compile + laws qualification executor.

Runs two bounded checks against the audit-native worktree state
(3d164b96 + uncommitted delivery.bend +140/-36):
  1. entry compile: bend bend2/src/coordinator/main.bend --check-only
  2. laws gate: node bend2/scripts/laws-check.mjs (BEND pinned)
Full stdout/stderr/exit retained per stage.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

ROOT = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/delivery-dirty-3d164b96-item1')
CANDIDATE = ROOT / 'candidate'
EVIDENCE = ROOT / 'evidence'
BEND = ROOT / 'toolchain-home/bin/bend'
NODE = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/tool-cache/node/22.23.3/x64/bin/node')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def run_stage(name, argv, cwd, env_extra=None):
    env = {'HOME': os.environ.get('HOME', str(ROOT)), 'PATH': '/usr/bin:/bin',
           'LC_ALL': 'C', 'BEND_NO_TELEMETRY': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
           'TMPDIR': str(ROOT / 'tmp')}
    if env_extra:
        env.update(env_extra)
    started = now()
    proc = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True,
                          timeout=None)
    ended = now()
    (EVIDENCE / f'{name}.stdout').write_text(proc.stdout)
    (EVIDENCE / f'{name}.stderr').write_text(proc.stderr)
    result = {'stage': name, 'argv': [str(a) for a in argv], 'cwd': str(cwd),
              'exit_code': proc.returncode, 'started': started, 'ended': ended,
              'stdout_sha256': hashlib.sha256(proc.stdout.encode()).hexdigest(),
              'stderr_sha256': hashlib.sha256(proc.stderr.encode()).hexdigest(),
              'stdout_bytes': len(proc.stdout.encode()),
              'stderr_bytes': len(proc.stderr.encode())}
    return result


def main():
    EVIDENCE.mkdir(exist_ok=True)
    (ROOT / 'tmp').mkdir(exist_ok=True)
    report = {'job': 'delivery-dirty-3d164b96-item1', 'started': now(), 'stages': []}
    try:
        versions = {'bend': subprocess.check_output([str(BEND), 'version'], text=True,
                    env={'PATH': '/usr/bin:/bin', 'BEND_NO_TELEMETRY': '1'}).strip(),
                    'node': subprocess.check_output([str(NODE), '--version'], text=True).strip(),
                    'uname': subprocess.check_output(['uname', '-a'], text=True).strip()}
        report['tool_versions'] = versions
        state = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=CANDIDATE,
                 text=True, env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_GLOBAL': '/dev/null',
                 'GIT_CONFIG_NOSYSTEM': '1'}).strip(),
                 'delivery_bend_sha256': sha(CANDIDATE / 'bend2/src/coordinator/delivery.bend'),
                 'status': subprocess.check_output(['git', 'status', '--porcelain=v1'],
                 cwd=CANDIDATE, text=True, env={'PATH': '/usr/bin:/bin',
                 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'})}
        report['source_state_before'] = state
        report['stages'].append(run_stage(
            'compile',
            [str(BEND), 'bend2/src/coordinator/main.bend', '--check-only'],
            CANDIDATE))
        report['stages'].append(run_stage(
            'laws-check',
            [str(NODE), 'bend2/scripts/laws-check.mjs'],
            CANDIDATE, env_extra={'BEND': str(BEND)}))
        state_after = {'status': subprocess.check_output(['git', 'status', '--porcelain=v1'],
                       cwd=CANDIDATE, text=True, env={'PATH': '/usr/bin:/bin',
                       'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'})}
        report['source_state_after'] = state_after
        report['error'] = None
    except Exception:
        report['error'] = traceback.format_exc()
    report['ended'] = now()
    (EVIDENCE / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    # Job exit reflects the compile stage only; both stage results are in report.json.
    compile_stage = next((s for s in report['stages'] if s['stage'] == 'compile'), None)
    return 0 if (report['error'] is None and compile_stage
                 and compile_stage['exit_code'] == 0) else 1


if __name__ == '__main__':
    raise SystemExit(main())
