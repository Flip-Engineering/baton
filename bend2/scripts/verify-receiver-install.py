#!/usr/bin/env python3
"""Stage and verify the focused facade, full router and recovery helper installation."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def run(argv, **kwargs):
    return subprocess.run([str(item) for item in argv], text=True,
                          capture_output=True, **kwargs)


def require(result, label):
    if result.returncode != 0:
        raise RuntimeError(label + ' failed: ' + result.stdout + result.stderr)
    return result


def probe(prefix, expected, argv):
    result = run(argv)
    if result.returncode != expected:
        raise RuntimeError('operation probe returned ' + str(result.returncode)
                           + ' instead of ' + str(expected) + ': ' + str(argv)
                           + ': ' + result.stdout + result.stderr)
    return {'argv': [str(item) for item in argv], 'returncode': result.returncode,
            'stdout': result.stdout, 'stderr': result.stderr}


def probe_missing_full_routes(prefix):
    """The public executable remains usable as the full CLI when aliases are absent."""
    full = prefix / 'bin/baton'
    alias = prefix / 'bin/baton2'
    hidden_full = prefix / 'bin/.baton.retained'
    hidden_alias = prefix / 'bin/.baton2.retained'
    full.rename(hidden_full)
    alias.rename(hidden_alias)
    try:
        return probe(prefix, 0, [prefix / 'bin/baton-full', '--help'])
    finally:
        hidden_alias.rename(alias)
        hidden_full.rename(full)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--prefix', type=Path, required=True)
    parser.add_argument('--focused-binary', type=Path, required=True)
    parser.add_argument('--full-binary', type=Path, required=True)
    parser.add_argument('--recovery-binary', type=Path, required=True)
    for role in ('focused', 'full', 'recovery'):
        parser.add_argument('--' + role + '-source-commit', required=True)
        parser.add_argument('--' + role + '-source-tree', required=True)
        parser.add_argument('--' + role + '-source-status', default='')
        parser.add_argument('--' + role + '-source-manifest-sha256')
    parser.add_argument('--full-c-sha256')
    for name in ('commit', 'tree', 'status', 'manifest_sha256'):
        parser.add_argument('--full-wrapper-source-' + name.replace('_', '-'))
    parser.add_argument('--repl-compiler-source', type=Path, required=True)
    parser.add_argument('--repl-runtime', type=Path, required=True)
    parser.add_argument('--repl-runtime-sha256', required=True)
    parser.add_argument('--repl-runtime-notices', type=Path, required=True)
    parser.add_argument('--context-clang-package', type=Path)
    parser.add_argument('--context-typescript-package', type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    stage = [sys.executable, source / 'bend2/scripts/stage-native-install.py',
             '--prefix', args.prefix, '--focused-binary', args.focused_binary,
             '--full-binary', args.full_binary,
             '--recovery-binary', args.recovery_binary,
             '--repl-compiler-source', args.repl_compiler_source,
             '--repl-runtime', args.repl_runtime,
             '--repl-runtime-sha256', args.repl_runtime_sha256,
             '--repl-runtime-notices', args.repl_runtime_notices]
    for role in ('focused', 'full', 'recovery'):
        stage += ['--' + role + '-source-commit', getattr(args, role + '_source_commit'),
                  '--' + role + '-source-tree', getattr(args, role + '_source_tree'),
                  '--' + role + '-source-status', getattr(args, role + '_source_status')]
        manifest = getattr(args, role + '_source_manifest_sha256')
        if manifest:
            stage += ['--' + role + '-source-manifest-sha256', manifest]
    if args.full_c_sha256:
        stage += ['--full-c-sha256', args.full_c_sha256]
    for name in ('commit', 'tree', 'status', 'manifest_sha256'):
        value = getattr(args, 'full_wrapper_source_' + name)
        if value is not None:
            stage += ['--full-wrapper-source-' + name.replace('_', '-'), value]
    for name in ('context_clang_package', 'context_typescript_package'):
        value = getattr(args, name)
        if value:
            stage += ['--' + name.replace('_', '-'), value]
    staged = require(run(stage), 'staging')
    prefix = args.prefix.resolve()
    check_parent = Path(tempfile.mkdtemp(prefix=str(prefix) + '.check-'))
    check_output = check_parent / 'result'
    checked = require(run([sys.executable, prefix / 'libexec/baton2/check-install.py',
                           '--prefix', prefix, '--output', check_output]), 'installation check')
    operations = []
    operations.append(probe(prefix, 0, [prefix / 'bin/baton', '--help']))
    operations.append(probe(prefix, 0, [prefix / 'bin/baton-focused', '--help']))
    operations.append(probe(prefix, 0, [prefix / 'bin/baton-full', '--help']))
    operations.append(probe(prefix, 0, [prefix / 'bin/baton2', '--help']))
    operations.append(probe(prefix, 0, [prefix / 'bin/baton-recovery', '--help']))
    operations.append(probe_missing_full_routes(prefix))
    focused = prefix / 'bin/baton-focused'
    hidden_focused = prefix / 'bin/.baton.retained'
    focused.rename(hidden_focused)
    try:
        operations.append(probe(prefix, 78, [prefix / 'bin/baton', 'state.db', 'receive',
                                             'session', 'harness', 'output.jsonl']))
    finally:
        hidden_focused.rename(focused)
    full = prefix / 'bin/baton2'
    recovery = prefix / 'bin/baton-recovery'
    hidden_recovery = prefix / 'bin/.baton-recovery.retained'
    recovery.rename(hidden_recovery)
    try:
        operations.append(probe(prefix, 78, [full, '--recover-observer',
                                             'state.db', 'session', '12345']))
    finally:
        hidden_recovery.rename(recovery)
    print(json.dumps({'status': 'verified', 'stage': json.loads(staged.stdout),
                      'check': json.loads(checked.stdout), 'operations': operations}))


if __name__ == '__main__':
    main()
