#!/usr/bin/python3.12
"""Synthesis316-1 exact-tree native composition qualification.

Source: 63f909c03f6ebef293ffb8bf09d6209214bf8613 (branch
codex/baton2-semantic-impl-native-20261005), tree c00d0df5.
Stages: build-native.sh, check-native.sh (Bend compile/run + fixtures),
laws-check.mjs (law execution + proof-removal/mutation negative controls).
Prescribed toolchain (synthesis317): Bend 2.0.25 at
/home/atari2036/baton-logging-686/toolchain-home/bin/bend, CC=clang-19,
Node 22.23.3 at /home/atari2036/baton-integrate-recovered-20261006/node22,
LD_LIBRARY_PATH=/home/atari2036/baton-sqlite-3460100.
Every stage runs to completion regardless of earlier failures; full
stdout/stderr/exit retained per stage.
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
EVIDENCE = ROOT / 'evidence'
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
            'TMPDIR': str(ROOT / 'tmp')}


def run_stage(name, argv):
    started = now()
    proc = subprocess.run(argv, cwd=CANDIDATE, env=env(), capture_output=True,
                          text=True, timeout=None)
    ended = now()
    (EVIDENCE / f'{name}.stdout').write_text(proc.stdout)
    (EVIDENCE / f'{name}.stderr').write_text(proc.stderr)
    return {'stage': name, 'argv': [str(a) for a in argv],
            'cwd': str(CANDIDATE),
            'exit_code': proc.returncode, 'started': started, 'ended': ended,
            'stdout_sha256': hashlib.sha256(proc.stdout.encode()).hexdigest(),
            'stderr_sha256': hashlib.sha256(proc.stderr.encode()).hexdigest(),
            'stdout_bytes': len(proc.stdout.encode()),
            'stderr_bytes': len(proc.stderr.encode())}


def main():
    EVIDENCE.mkdir(exist_ok=True)
    (ROOT / 'tmp').mkdir(exist_ok=True)
    bindir = ROOT / 'bin'
    bindir.mkdir(exist_ok=True)
    for name, target in [('node', NODE), ('python3', '/usr/bin/python3.12')]:
        link = bindir / name
        if not link.exists():
            link.symlink_to(target)
    report = {'job': 'native-composition-63f909c0', 'started': now(),
              'stages': []}
    try:
        report['tool_identity'] = {
            'bend': {'path': str(BEND), 'sha256': sha(BEND),
                     'version': subprocess.check_output([str(BEND), 'version'],
                     text=True, env={'PATH': '/usr/bin:/bin',
                     'BEND_NO_TELEMETRY': '1'}).strip()},
            'node': {'path': str(NODE), 'sha256': sha(NODE),
                     'version': subprocess.check_output([str(NODE), '--version'],
                     text=True).strip()},
            'clang': {'path': '/usr/bin/clang-19',
                      'sha256': sha('/usr/bin/clang-19')},
            'sqlite_ld_library_path': SQLITE_LIB,
            'sqlite_so_sha256': sha(SQLITE_LIB + '/libsqlite3.so')}
        report['uname'] = subprocess.check_output(['uname', '-a'], text=True).strip()
        report['source_state'] = {'head': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=CANDIDATE, text=True,
            env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_GLOBAL': '/dev/null',
                 'GIT_CONFIG_NOSYSTEM': '1'}).strip()}
        report['stages'].append(run_stage('build-native', [
            '/bin/sh', 'bend2/scripts/build-native.sh']))
        built = CANDIDATE / '.scratch/bend2/baton2'
        if built.exists():
            report['built_artifact'] = {'path': str(built.relative_to(CANDIDATE)),
                                        'sha256': sha(built),
                                        'bytes': built.stat().st_size}
        report['stages'].append(run_stage('check-native', [
            '/bin/sh', 'bend2/scripts/check-native.sh']))
        report['stages'].append(run_stage('laws-check', [
            str(NODE), 'bend2/scripts/laws-check.mjs']))
        report['source_state_after'] = {'status': subprocess.check_output(
            ['git', 'status', '--porcelain=v1'], cwd=CANDIDATE, text=True,
            env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_GLOBAL': '/dev/null',
                 'GIT_CONFIG_NOSYSTEM': '1'})}
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
