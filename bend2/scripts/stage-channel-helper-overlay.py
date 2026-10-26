#!/usr/bin/env python3
"""Stage channel helpers and exact install/rollback argv for an existing prefix."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[2]
HELPERS = ('mcp-conductor.mjs', 'mcp-root.mjs', 'root-channel-config.mjs')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prefix, output = args.prefix.resolve(), args.output.absolute()
    commit = subprocess.check_output(['git', 'rev-parse', args.source_commit + '^{commit}'],
                                    cwd=ROOT, text=True).strip()
    output.mkdir(parents=True, exist_ok=False)
    records, install, rollback = [], [], []
    for name in HELPERS:
        source = 'bend2/scripts/' + name
        payload = subprocess.check_output(['git', 'show', commit + ':' + source], cwd=ROOT)
        relative = Path('libexec/baton2') / name
        staged, previous, target = output / 'forward' / relative, output / 'rollback' / relative, prefix / relative
        staged.parent.mkdir(parents=True, exist_ok=True)
        staged.write_bytes(payload)
        staged.chmod(0o644)
        before = None
        if target.exists():
            previous.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, previous)
            before = digest(previous)
            rollback.append(['install', '-m', format(target.stat().st_mode & 0o777, '04o'),
                             '--', str(previous), str(target)])
        else:
            rollback.append(['rm', '--', str(target)])
        install.append(['install', '-m', '0644', '--', str(staged), str(target)])
        records.append({'source': source, 'target': str(target), 'sha256': digest(staged),
                        'previousSha256': before})
    backend = prefix / 'bin/baton-full'
    plan = {'sourceCommit': commit, 'prefix': str(prefix), 'backend': str(backend),
            'backendSha256': digest(backend), 'helpers': records,
            'installArgv': install, 'rollbackArgv': rollback,
            'limits': ['Helper file installation only. Running MCP processes load the new code on reconnect.',
                       'Native binaries, live database, session records, provider settings and permissions are unchanged.',
                       'Stop-hook and native read-derived pending/wake changes require a qualified native role.']}
    (output / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    sums = [digest(path) + '  ' + str(path.relative_to(output))
            for path in sorted(output.rglob('*')) if path.is_file()]
    (output / 'SHA256SUMS').write_text('\n'.join(sums) + '\n')
    print(json.dumps(plan, indent=2))


if __name__ == '__main__':
    main()
