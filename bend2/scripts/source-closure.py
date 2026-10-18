#!/usr/bin/env python3
"""Write a complete hashed closure of receiver source and pinned compiler inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


ROOTS = ('bend2/src', 'bend2/compiler/upstream')
FILES = ('bend2/compiler/repl.ts', 'bend2/compiler/repl-upstream.lock.json',
         'bend2/compiler/repl-upstream.provenance.json', 'bend2/scripts/build-native.sh')


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--status', default='')
    parser.add_argument('--diff-output', type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    paths = []
    for root in ROOTS:
        base = source / root
        if not base.is_dir():
            raise RuntimeError('Missing source closure root: ' + str(base))
        paths.extend(path for path in base.rglob('*') if path.is_file())
    paths.extend(source / name for name in FILES if (source / name).is_file())
    records = []
    for path in sorted(set(paths)):
        if path.is_symlink():
            raise RuntimeError('Source closure contains a symlink: ' + str(path))
        records.append({'path': path.relative_to(source).as_posix(),
                        'bytes': path.stat().st_size, 'sha256': sha256(path)})
    diff = subprocess.run(['git', '-C', str(source), 'diff', '--binary'],
                          capture_output=True, text=True, check=True).stdout
    if args.diff_output:
        args.diff_output.write_text(diff)
    value = {'schema': 'baton2-source-closure-v1', 'source': str(source),
             'commit': args.commit, 'status': args.status,
             'diff_sha256': hashlib.sha256(diff.encode()).hexdigest(),
             'files': records}
    if args.diff_output:
        value['diff_path'] = str(args.diff_output.resolve())
    args.output.write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps({'status': 'written', 'output': str(args.output),
                      'files': len(records), 'diff_sha256': value['diff_sha256']}))


if __name__ == '__main__':
    main()
