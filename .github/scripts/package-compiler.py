#!/usr/bin/env python3
"""Package committed compiler source with a retained Linux distribution."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git(*argv):
    return subprocess.check_output(['git', *argv], cwd=ROOT)


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def package(args):
    commit = git('rev-parse', args.source_commit + '^{commit}').decode().strip()
    source_tree = git('rev-parse', commit + '^{tree}').decode().strip()
    lock_bytes = git('show', commit + ':bend2/compiler/repl-upstream.lock.json')
    lock = json.loads(lock_bytes)
    args.output.mkdir(parents=True)
    prefix = args.output / 'bend-2.0.25'
    with tarfile.open(args.base_archive) as archive:
        archive.extractall(args.output, filter='data')
    source = prefix / 'bend2'
    for row in lock['files']:
        content = git('show', commit + ':bend2/compiler/upstream/' + row['path'])
        if hashlib.sha256(content).hexdigest() != row['sha256'] or len(content) != row['bytes']:
            raise ValueError('Committed compiler input differs from its lock: ' + row['path'])
        target = source / row['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    provenance = prefix / 'provenance'
    provenance.mkdir(exist_ok=True)
    manifest_path = prefix / 'fork-manifest.json'
    shutil.copyfile(manifest_path, provenance / (args.name + '-parent.json'))
    (provenance / (args.name + '-source.lock.json')).write_bytes(lock_bytes)
    manifest = {
        'schema': 'baton-bend-distribution-fork-manifest-v1',
        'upstream': lock['upstream'], 'upstream_version': '2.0.25',
        'official_release_artifact': False, 'distribution_state': 'packaged_not_installed',
        'package_id': args.name, 'release_name': '2.0.25-' + args.name,
        'source_commit': commit, 'source_tree': source_tree,
        'source_root': 'bend2/compiler/upstream', 'package_root': 'bend2',
        'source_lock_sha256': hashlib.sha256(lock_bytes).hexdigest(),
        'source_files': lock['files'],
        'inherited_distribution': {'path': str(args.base_archive.resolve()),
                                   'sha256': digest(args.base_archive)},
        'compiler': {'path': 'bin/bend', 'sha256': digest(prefix / 'bin/bend')},
        'bun': {'path': 'bin/bun', 'sha256': digest(prefix / 'bin/bun')},
        'cache_ts': {'path': 'bend2/cache.ts', 'sha256': digest(source / 'cache.ts')},
    }
    save(manifest_path, manifest)
    output = args.output / ('bend-2.0.25-linux-x64-' + args.name + '.tar.gz')
    with output.open('xb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as zipped, \
            tarfile.open(fileobj=zipped, mode='w|') as archive:
        for path in [prefix, *sorted(prefix.rglob('*'))]:
            info = archive.gettarinfo(str(path), arcname=str(path.relative_to(args.output)))
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            if path.is_file():
                with path.open('rb') as stream:
                    archive.addfile(info, stream)
            else:
                archive.addfile(info)
    receipt = {'archive': str(output.resolve()), 'archive_sha256': digest(output),
               'source_commit': commit, 'source_tree': source_tree,
               'release_name': manifest['release_name'],
               'compiler_sha256': manifest['compiler']['sha256'],
               'bun_sha256': manifest['bun']['sha256']}
    save(args.output / 'receipt.json', receipt)
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--base-archive', type=Path, required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--output', type=Path, required=True)
    package(parser.parse_args())
