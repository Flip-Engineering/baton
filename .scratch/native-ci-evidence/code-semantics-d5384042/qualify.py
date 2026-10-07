#!/usr/bin/python3.12
"""Synthesis314 code-semantics oracle runner qualification.

Runs both oracle entrypoints from bend2/context/acceptance/code-semantics
at d5384042 with staged TypeScript 5.9.3, LLVM Clang/clangd 20.1.8 and
Node 22.15.0, fresh evidence directories, full stdout/stderr/exit retention.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import traceback

ROOT = Path('/mnt/nvme4tb/ci-runners/baton2-native-homelab/qualifications/code-semantics-d5384042')
CANDIDATE = ROOT / 'candidate'
CORPUS = CANDIDATE / 'bend2/context/acceptance/code-semantics'
EVIDENCE = ROOT / 'evidence'
NODE = ROOT / 'staged/node/bin/node'
TYPESCRIPT = ROOT / 'staged/typescript/package/lib/typescript.js'
CLANG = ROOT / 'staged/llvm/bin/clang'
CLANGD = ROOT / 'staged/llvm/bin/clangd'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run_stage(name, argv):
    env = {'HOME': str(ROOT), 'PATH': '/usr/bin:/bin', 'LC_ALL': 'C',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
           'TMPDIR': str(ROOT / 'tmp')}
    started = now()
    proc = subprocess.run(argv, cwd=CORPUS, env=env, capture_output=True,
                          text=True, timeout=None)
    ended = now()
    (EVIDENCE / f'{name}.stdout').write_text(proc.stdout)
    (EVIDENCE / f'{name}.stderr').write_text(proc.stderr)
    return {'stage': name, 'argv': [str(a) for a in argv], 'cwd': str(CORPUS),
            'exit_code': proc.returncode, 'started': started, 'ended': ended,
            'stdout_sha256': hashlib.sha256(proc.stdout.encode()).hexdigest(),
            'stderr_sha256': hashlib.sha256(proc.stderr.encode()).hexdigest(),
            'stdout_bytes': len(proc.stdout.encode()),
            'stderr_bytes': len(proc.stderr.encode())}


def version(argv):
    proc = subprocess.run(argv, capture_output=True, text=True,
                          env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    return {'argv': [str(a) for a in argv], 'exit_code': proc.returncode,
            'stdout': proc.stdout.strip(), 'stderr': proc.stderr.strip()}


def main():
    EVIDENCE.mkdir(exist_ok=True)
    (ROOT / 'tmp').mkdir(exist_ok=True)
    report = {'job': 'code-semantics-d5384042', 'started': now(), 'stages': []}
    try:
        report['tool_versions'] = {
            'node': version([str(NODE), '--version']),
            'typescript': version([str(NODE), '-e',
                f"console.log(require('{TYPESCRIPT}').version)"]),
            'clang': version([str(CLANG), '--version']),
            'clangd': version([str(CLANGD), '--version'])}
        report['uname'] = subprocess.check_output(['uname', '-a'], text=True).strip()
        report['source_state'] = {'head': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=CANDIDATE, text=True,
            env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_GLOBAL': '/dev/null',
                 'GIT_CONFIG_NOSYSTEM': '1'}).strip()}
        report['stages'].append(run_stage('oracle-ts', [
            str(NODE), 'run.mjs', 'ts', '--typescript', str(TYPESCRIPT),
            '--evidence-dir', str(EVIDENCE / 'ts-run')]))
        report['stages'].append(run_stage('oracle-c', [
            str(NODE), 'run.mjs', 'c', '--clang', str(CLANG),
            '--clangd', str(CLANGD),
            '--evidence-dir', str(EVIDENCE / 'c-run')]))
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
