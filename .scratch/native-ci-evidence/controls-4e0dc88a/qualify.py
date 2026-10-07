#!/usr/bin/python3.12
"""Synthesis317-4 Controls/Interfaces handoff remote qualification.

Successor 4e0dc88abc8538252b650113010f2b1de16336f9 (tree
075a65f08c993baed2153b90682a9526597506a8) on
codex/baton2-semantic-controls-interfaces-research-20261005, target
d688c80f405abb626687a6cd3dd0b459230a76cc (pre-change base of the scoped
delta: account-failure handling, readiness single-ping, attachment async
two-path change).
Suites per source: observed-usage.py, mcp-attachment.py, mcp-root.py,
mcp-contract.py, receiver-route-mcp.py. Suites absent at a source are
recorded as absent, not failed. Prescribed toolchain (synthesis317):
Bend 2.0.25 (baton-logging-686 path), CC=clang-19, Node 22.23.3
(baton-integrate-recovered node22), LD_LIBRARY_PATH=baton-sqlite-3460100.
Every stage runs regardless of earlier failures; full retention.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

ROOT = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/controls-4e0dc88a')
EVIDENCE = ROOT / 'evidence'
BEND = Path('/home/atari2036/baton-logging-686/toolchain-home/bin/bend')
NODE = Path('/home/atari2036/baton-integrate-recovered-20261006/node22')
SQLITE_LIB = '/home/atari2036/baton-sqlite-3460100'
SOURCES = [('target', 'd688c80f405abb626687a6cd3dd0b459230a76cc'),
           ('candidate', '4e0dc88abc8538252b650113010f2b1de16336f9')]
SUITES = ['bend2/test/observed-usage.py', 'bend2/test/mcp-attachment.py',
          'bend2/test/mcp-root.py', 'bend2/test/mcp-contract.py',
          'bend2/test/receiver-route-mcp.py']


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


def run_stage(name, argv, cwd):
    started = now()
    proc = subprocess.run(argv, cwd=cwd, env=env(), capture_output=True,
                          text=True, timeout=None)
    ended = now()
    (EVIDENCE / f'{name}.stdout').write_text(proc.stdout)
    (EVIDENCE / f'{name}.stderr').write_text(proc.stderr)
    return {'stage': name, 'argv': [str(a) for a in argv], 'cwd': str(cwd),
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
    for name, target_path in [('node', NODE), ('python3', '/usr/bin/python3.12')]:
        link = bindir / name
        if not link.exists():
            link.symlink_to(target_path)
    report = {'job': 'controls-4e0dc88a', 'started': now(), 'stages': [],
              'absent': []}
    try:
        report['tool_identity'] = {
            'bend': {'path': str(BEND), 'sha256': sha(BEND)},
            'node': {'path': str(NODE), 'sha256': sha(NODE)},
            'clang': {'path': '/usr/bin/clang-19',
                      'sha256': sha('/usr/bin/clang-19')},
            'sqlite_ld_library_path': SQLITE_LIB,
            'sqlite_so_sha256': sha(SQLITE_LIB + '/libsqlite3.so')}
        report['uname'] = subprocess.check_output(['uname', '-a'], text=True).strip()
        for label, commit in SOURCES:
            source = ROOT / label
            head = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
                cwd=source, text=True, env={'PATH': '/usr/bin:/bin',
                'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}).strip()
            report.setdefault('source_state', {})[label] = {
                'head': head, 'expected': commit, 'match': head == commit}
            report['stages'].append(run_stage(f'{label}-build-native', [
                '/bin/sh', 'bend2/scripts/build-native.sh'], source))
            for suite in SUITES:
                if not (source / suite).exists():
                    report['absent'].append({'source': label, 'suite': suite})
                    continue
                name = f'{label}-{Path(suite).stem}'
                report['stages'].append(run_stage(
                    name, ['/usr/bin/python3.12', suite], source))
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
