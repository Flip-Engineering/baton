#!/usr/bin/env python3
"""Retain a completed exact-target native build for a later comparison run."""
import argparse
import hashlib
import json
import pathlib
import shutil
import stat
import subprocess


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fact(path):
    if not path.is_file() or path.is_symlink():
        raise RuntimeError('Expected a regular file: ' + str(path))
    return {'path': path.name, 'size_bytes': path.stat().st_size, 'sha256': digest(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--run', type=pathlib.Path, required=True)
    parser.add_argument('--target-commit', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--run-attempt', required=True)
    parser.add_argument('--compiler', type=pathlib.Path, required=True)
    parser.add_argument('--compiler-archive', type=pathlib.Path, required=True)
    parser.add_argument('--cc', required=True)
    args = parser.parse_args()

    source = args.source.resolve()
    run = args.run.resolve()
    evidence = run / 'evidence'
    selected = json.loads((run / 'generated/compiler-selection.json').read_text())
    results_path = evidence / 'results.json'
    results = json.loads(results_path.read_text())
    builds = [row for row in results if row.get('label') == 'target-build']
    if len(builds) != 1:
        raise RuntimeError('Expected one exact target build result')
    record = builds[0]
    if (record.get('exit_code') != 0
            or record.get('argv') != ['sh', 'bend2/scripts/build-native.sh']
            or record.get('cwd') != str(source)):
        raise RuntimeError('The exact target build did not complete with the maintained command')
    if subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() != args.target_commit:
        raise RuntimeError('The target source commit differs from the requested commit')
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'],
                               cwd=source, text=True).strip():
        raise RuntimeError('The target source has tracked changes')
    if selected.get('compiler_archive_sha256') != digest(args.compiler_archive):
        raise RuntimeError('The selected compiler archive differs from the build compiler')

    c_source = source / '.scratch/bend2/baton2.c'
    binary = source / '.scratch/bend2/baton2'
    c_fact = fact(c_source)
    binary_fact = fact(binary)
    mode = stat.S_IMODE(binary.stat().st_mode)
    if not mode & 0o100:
        raise RuntimeError('The exact target build output is not executable')

    baseline = evidence / 'baseline-build'
    baseline.mkdir()
    c_destination = baseline / 'generated.c'
    binary_destination = baseline / 'baton2'
    shutil.copyfile(c_source, c_destination)
    shutil.copyfile(binary, binary_destination)
    binary_destination.chmod(mode)

    streams = {}
    for field in ('stdout', 'stderr'):
        name = record[field]
        original = evidence / name
        stream_fact = fact(original)
        streams[name] = {'size_bytes': stream_fact['size_bytes'], 'sha256': stream_fact['sha256']}
        shutil.copyfile(original, baseline / name)

    manifest = {
        'schema': 'baton2-baseline-build-evidence-v1',
        'target_commit': args.target_commit,
        'workflow_run_id': args.run_id,
        'workflow_run_attempt': args.run_attempt,
        'source_path': str(source),
        'compiler_archive_sha256': digest(args.compiler_archive),
        'compiler_binary_sha256': digest(args.compiler.resolve()),
        'native_compiler_version': subprocess.check_output([args.cc, '--version'], text=True),
        'target_build': {'status': 'completed', 'record': record},
        'build_streams': streams,
        'generated_c': {'path': 'generated.c', 'size_bytes': c_fact['size_bytes'],
                        'sha256': c_fact['sha256']},
        'binary': {'path': 'baton2', 'size_bytes': binary_fact['size_bytes'],
                   'sha256': binary_fact['sha256'], 'mode': format(mode, 'o')},
    }
    manifest_path = baseline / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'status': 'retained', 'target_commit': args.target_commit,
                      'workflow_run_id': args.run_id, 'workflow_run_attempt': args.run_attempt,
                      'manifest_sha256': digest(manifest_path),
                      'generated_c_sha256': c_fact['sha256'],
                      'binary_sha256': binary_fact['sha256']}))


if __name__ == '__main__':
    main()
