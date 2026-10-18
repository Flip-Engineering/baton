#!/usr/bin/env python3
"""Stage and verify the focused/full/registrar receiver installation layout."""
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--prefix', type=Path, required=True)
    parser.add_argument('--focused-binary', type=Path, required=True)
    parser.add_argument('--full-binary', type=Path, required=True)
    parser.add_argument('--register-binary', type=Path, required=True)
    for role in ('focused', 'full', 'register'):
        parser.add_argument('--' + role + '-source-commit', required=True)
        parser.add_argument('--' + role + '-source-tree', required=True)
        parser.add_argument('--' + role + '-source-status', default='')
        parser.add_argument('--' + role + '-source-manifest-sha256')
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
             '--full-binary', args.full_binary, '--register-binary', args.register_binary,
             '--repl-compiler-source', args.repl_compiler_source,
             '--repl-runtime', args.repl_runtime,
             '--repl-runtime-sha256', args.repl_runtime_sha256,
             '--repl-runtime-notices', args.repl_runtime_notices]
    for role in ('focused', 'full', 'register'):
        stage += ['--' + role + '-source-commit', getattr(args, role + '_source_commit'),
                  '--' + role + '-source-tree', getattr(args, role + '_source_tree'),
                  '--' + role + '-source-status', getattr(args, role + '_source_status')]
        manifest = getattr(args, role + '_source_manifest_sha256')
        if manifest:
            stage += ['--' + role + '-source-manifest-sha256', manifest]
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
    operations.append(probe(prefix, 0, [prefix / 'bin/baton-full', '--help']))
    operations.append(probe(prefix, 0, [prefix / 'bin/baton2', '--help']))
    full = prefix / 'bin/baton-full'
    hidden_full = prefix / 'bin/.baton-full.retained'
    full.rename(hidden_full)
    try:
        operations.append(probe(prefix, 78, [prefix / 'bin/baton', '--help']))
    finally:
        hidden_full.rename(full)
    register = prefix / 'bin/baton-register'
    hidden_register = prefix / 'bin/.baton-register.retained'
    register.rename(hidden_register)
    try:
        operations.append(probe(prefix, 78, [prefix / 'bin/baton', 'state.db', 'receiver',
                                             'session', 'harness', 'output.jsonl']))
    finally:
        hidden_register.rename(register)
    print(json.dumps({'status': 'verified', 'stage': json.loads(staged.stdout),
                      'check': json.loads(checked.stdout), 'operations': operations}))


if __name__ == '__main__':
    main()
