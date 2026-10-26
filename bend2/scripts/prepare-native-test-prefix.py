#!/usr/bin/env python3
"""Build and stage the production roles used by the native Python suites."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def relink_command(receipt, output):
    flags = receipt['compile_flags']
    if not flags or flags[-1] != '-Dmain=baton2_runtime_main':
        raise RuntimeError('The Main producer did not rename its runtime entry')
    flags = flags[:-1]
    if receipt['link_flags'][:len(flags)] != flags:
        raise RuntimeError('The Main producer records different compile and link flags')
    extra = receipt['link_flags'][len(flags):] + ['-DBATON2_NATIVE_RECEIVER_ROUTER']
    return [sys.executable, str(ROOT / 'tools/cgen-clang-parallel/build_and_measure.py'),
            '--source', receipt['source']['path'], '--outdir', str(output / 'router'),
            '--binary', str(output / 'baton-full'), '--cc', receipt['compiler']['path'],
            '--main-rename', '--build-only', '--max-aggregate-rss-mb', '0',
            *['--cflag=' + flag for flag in flags], '--link-flags=' + shlex.join(extra)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--main-receipt', type=Path,
                        default=ROOT / '.scratch/bend2/baton2.parallel/build-receipt.json')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    records = []

    def run(label, argv, environment=None):
        row = {'label': label, 'argv': list(map(str, argv)), 'cwd': str(ROOT),
               'started_ns': time.time_ns()}
        with (output / (label + '.stdout')).open('wb') as stdout, \
                (output / (label + '.stderr')).open('wb') as stderr:
            child = subprocess.Popen(row['argv'], cwd=ROOT, env=environment,
                                     stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
            row['pid'] = child.pid
            row['exit'] = child.wait()
        row['finished_ns'] = time.time_ns()
        row['stdout_sha256'] = digest(output / (label + '.stdout'))
        row['stderr_sha256'] = digest(output / (label + '.stderr'))
        records.append(row)
        (output / 'executions.json').write_text(json.dumps(records, indent=2) + '\n')
        if row['exit']:
            raise RuntimeError(label + ' failed; complete output is retained in ' + str(output))

    original = json.loads(args.main_receipt.read_text())
    command = relink_command(original, output)
    command.extend(['--relink-from', str(args.main_receipt.resolve())])
    driver = os.environ.get('BATON2_NATIVE_QUEUE_DRIVER')
    if driver:
        command = [sys.executable, driver, 'stage', 'cc', *command]
    run('full-router', command)
    role_environment = {key: value for key, value in os.environ.items()
                        if key not in ('BEND_GENERATED_C', 'BATON2_RECEIVE_FOCUSED',
                                       'BATON2_RECOVERY_HELPER', 'BATON2_NATIVE_RECEIVER_ROUTER')}
    for role, entry, mode in [
            ('focused', 'receive-focused.bend', 'BATON2_RECEIVE_FOCUSED'),
            ('recovery', 'receive-recovery-focused.bend', 'BATON2_RECOVERY_HELPER')]:
        run(role, ['sh', ROOT / 'bend2/scripts/build-native.sh',
                   ROOT / 'bend2/src/coordinator' / entry, output / ('baton-' + role)],
            dict(role_environment, **{mode: '1'}))

    repl = load('native_test_repl_inputs', ROOT / '.github/scripts/repl-package.py')
    repl.runtime_inputs(argparse.Namespace(output=output / 'repl-runtime'))
    runtime = json.loads((output / 'repl-runtime/runtime.json').read_text())
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip()
    status = subprocess.check_output(['git', 'status', '--porcelain=v1'], cwd=ROOT, text=True).strip()
    closure = output / 'source-closure.json'
    run('source-closure', [sys.executable, ROOT / 'bend2/scripts/source-closure.py',
                          '--source', ROOT, '--output', closure, '--commit', commit,
                          '--status', status, '--diff-output', output / 'source.diff'])
    prefix = output / 'prefix'
    command = [sys.executable, ROOT / 'bend2/scripts/stage-native-install.py',
               '--prefix', prefix, '--focused-binary', output / 'baton-focused',
               '--full-binary', output / 'baton-full', '--recovery-binary', output / 'baton-recovery',
               '--full-c-sha256', original['source']['sha256'],
               '--repl-runtime', output / 'repl-runtime/bun',
               '--repl-runtime-sha256', runtime['binary']['sha256'],
               '--repl-runtime-notices', output / 'repl-runtime/Bun-NOTICES']
    for role in ('focused', 'full', 'recovery', 'full-wrapper'):
        command.extend(['--' + role + '-source-commit', commit,
                        '--' + role + '-source-tree', tree,
                        '--' + role + '-source-status', status,
                        '--' + role + '-source-directory', ROOT,
                        '--' + role + '-source-closure', closure,
                        '--' + role + '-source-manifest-sha256', digest(closure)])
    run('stage', command)
    environment = dict(os.environ)
    if driver:
        queue = load('native_test_prefix_queue', ROOT / '.github/scripts/queue-native-checks.py')
        verification = output / 'verification-queue'
        verification.mkdir()
        environment = queue.legacy_environment(queue.environment(verification))
    run('verify', [sys.executable, prefix / 'libexec/baton2/check-install.py',
                   '--prefix', prefix, '--output', output / 'installation-check'], environment)
    print(json.dumps({'prefix': str(prefix), 'source_commit': commit, 'source_tree': tree,
                      'manifest_sha256': digest(prefix / 'manifest.json'),
                      'install_receipt_sha256': digest(prefix / 'install-receipt.json'),
                      'checksums_sha256': digest(prefix / 'SHA256SUMS')}))


if __name__ == '__main__':
    main()
