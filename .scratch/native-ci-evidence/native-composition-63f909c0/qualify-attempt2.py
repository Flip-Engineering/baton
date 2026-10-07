#!/usr/bin/python3.12
"""Attempt 2 for native-composition-63f909c0 after host loss at 12:51:32.

Attempt 1 retained: provision (source verified), build-native PASS,
check-native FAIL (accept-kimi-hierarchy, 17 tests, 1 failure nesting the
receive raw-path assertion and the #679 Errno 7 large-argument failure),
laws-check killed mid-sweep by ungraceful host stop (no stream retained).
Attempt 2 runs check-native and laws-check. Stage output streams DIRECTLY
to evidence files as produced, so partial output survives process/host
loss; report-attempt2.json records exits and hashes.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

ROOT = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/native-composition-63f909c0')
CANDIDATE = ROOT / 'candidate'
EVIDENCE = ROOT / 'evidence2'
BEND = Path('/home/atari2036/baton-logging-686/toolchain-home/bin/bend')
NODE = Path('/home/atari2036/baton-integrate-recovered-20261006/node22')
SQLITE_LIB = '/home/atari2036/baton-sqlite-3460100'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def env():
    return {'HOME': str(ROOT), 'PATH': str(ROOT / 'bin') + ':/usr/bin:/bin',
            'LC_ALL': 'C', 'BEND': str(BEND), 'CC': '/usr/bin/clang-19',
            'BEND_NO_TELEMETRY': '1', 'LD_LIBRARY_PATH': SQLITE_LIB,
            'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
            'TMPDIR': str(ROOT / 'tmp'),
            'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONNOUSERSITE': '1'}


def run_stage(name, argv):
    out_path = EVIDENCE / f'{name}.stdout'
    err_path = EVIDENCE / f'{name}.stderr'
    started = now()
    with out_path.open('w') as out, err_path.open('w') as err:
        proc = subprocess.run(argv, cwd=CANDIDATE, env=env(),
                              stdout=out, stderr=err, timeout=None)
    ended = now()
    result = {'stage': name, 'argv': [str(a) for a in argv],
              'cwd': str(CANDIDATE),
              'exit_code': proc.returncode, 'started': started, 'ended': ended,
              'stdout_sha256': sha(out_path), 'stderr_sha256': sha(err_path),
              'stdout_bytes': out_path.stat().st_size,
              'stderr_bytes': err_path.stat().st_size}
    # Checkpoint after every stage so an interrupted run still leaves a
    # record of completed stages.
    checkpoint = EVIDENCE / 'checkpoint.json'
    prior = json.loads(checkpoint.read_text()) if checkpoint.exists() else []
    prior.append(result)
    checkpoint.write_text(json.dumps(prior, indent=2) + '\n')
    return result


def main():
    EVIDENCE.mkdir(exist_ok=True)
    (ROOT / 'tmp').mkdir(exist_ok=True)
    report = {'job': 'native-composition-63f909c0-attempt2', 'started': now(),
              'stages': [],
              'attempt1': 'build-native PASS; check-native FAIL '
                          '(accept-kimi-hierarchy: raw-path assertion + '
                          'Errno 7 large-argument, #679 signature); '
                          'laws-check killed by ungraceful host stop '
                          '12:51:32 PDT (journal boot -2 end)'}
    try:
        report['stages'].append(run_stage('check-native', [
            '/bin/sh', 'bend2/scripts/check-native.sh']))
        report['stages'].append(run_stage('laws-check', [
            str(NODE), 'bend2/scripts/laws-check.mjs']))
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
