#!/usr/bin/env python3
"""Build the source-pinned Linux x64 Baton compiler fork in a new directory."""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
NAME = 'bend-2.0.25-baton741-cgen-cache'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def fetch(url, path, expected):
    urllib.request.urlretrieve(url, path)
    if sha(path) != expected:
        raise ValueError('Downloaded bytes differ from the pinned input: ' + url)


def run(label, argv, cwd, evidence):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (evidence / (label + '.stdout')).open('xb') as stdout, \
            (evidence / (label + '.stderr')).open('xb') as stderr:
        child = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL,
                                 stdout=stdout, stderr=stderr,
                                 env={**os.environ, 'BEND_NO_TELEMETRY': '1'})
        record = {'argv': argv, 'cwd': str(cwd), 'pid': child.pid, 'started': started}
        save(evidence / (label + '.running.json'), record)
        record['returncode'] = child.wait()
    record['ended'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save(evidence / (label + '.result.json'), record)
    if record['returncode']:
        raise RuntimeError('Command failed; complete streams are in ' + str(evidence))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700)
    pins = json.loads((HERE / 'pins.json').read_text())
    if sha(HERE / 'memo.patch') != pins['patch_sha256']:
        raise ValueError('The compiler patch differs from its pin.')
    fixpoint = pins['fixpoint_patch']['filename']
    if sha(HERE / 'cache.patch') != pins['cache_patch']['sha256']:
        raise ValueError('The Cgen cache patch differs from its pin.')
    if sha(HERE / fixpoint) != pins['fixpoint_patch']['sha256']:
        raise ValueError('The emit-lits fixpoint patch differs from its pin.')
    archive = output / 'upstream.tar.gz'
    fetch(pins['upstream_archive']['url'], archive, pins['upstream_archive']['sha256'])
    unpacked = output / 'upstream'
    with tarfile.open(archive, 'r:gz') as package:
        package.extractall(unpacked, filter='data')
    roots = list(unpacked.iterdir())
    if len(roots) != 1 or not roots[0].is_dir():
        raise ValueError('The upstream archive must have one top-level directory.')
    prefix = output / NAME
    roots[0].rename(prefix)
    evidence = prefix / 'provenance'
    evidence.mkdir()
    baseline = evidence / 'baseline'
    baseline.mkdir()
    for name, expected in pins['sources'].items():
        path = baseline / name
        fetch(pins['source_url_prefix'] + name, path, expected)
        shutil.copy2(path, prefix / 'bend2' / name)
    shutil.copy2(HERE / 'memo.patch', evidence / 'memo.patch')
    shutil.copy2(HERE / 'cache.patch', evidence / 'cache.patch')
    shutil.copy2(HERE / fixpoint, evidence / fixpoint)
    shutil.copy2(HERE / 'pins.json', evidence / 'pins.json')
    shutil.copy2(Path(__file__), evidence / 'build-fork.py')
    run('patch', ['patch', '--batch', '--forward', '-p0', '-i',
                  str(evidence / 'memo.patch')], prefix / 'bend2', evidence)
    if sha(prefix / 'bend2/comp.ts') != pins['patched_comp_sha256']:
        raise ValueError('The patched backend differs from its pin.')
    run('cache-patch', ['patch', '--batch', '--forward', '-p1', '-i',
                        str(evidence / 'cache.patch')], prefix, evidence)
    run('fixpoint-patch', ['patch', '--batch', '--forward', '-p1', '-i',
                           str(evidence / fixpoint)], prefix, evidence)
    for name, expected in pins['patched_sources'].items():
        if sha(prefix / 'bend2' / name) != expected:
            raise ValueError('The cached-source input differs from its pin: ' + name)
    bun_archive = evidence / 'bun-linux-x64.zip'
    fetch(pins['bun']['url'], bun_archive, pins['bun']['archive_sha256'])
    bun = output / 'bun'
    with zipfile.ZipFile(bun_archive) as package:
        bun.write_bytes(package.read('bun-linux-x64/bun'))
    bun.chmod(0o700)
    if sha(bun) != pins['bun']['binary_sha256']:
        raise ValueError('The Bun runtime differs from its pin.')
    run('compiler-build', [str(bun), 'build', '--compile',
                          str(prefix / 'bend2/main.ts'), '--outfile',
                          str(prefix / 'bin/bend')], prefix, evidence)
    run('compiler-version', [str(prefix / 'bin/bend'), 'version'], prefix, evidence)
    if (evidence / 'compiler-version.stdout').read_bytes() != b'bend 2.0.25\n':
        raise ValueError('The compiler version output differs.')
    members = [{'path': str(path.relative_to(prefix)), 'sha256': sha(path),
                'size_bytes': path.stat().st_size, 'mode': oct(path.stat().st_mode & 0o777)}
               for path in sorted(prefix.rglob('*')) if path.is_file()]
    save(prefix / 'fork-manifest.json', {
        'schema': 'baton-bend-741-rebuilt-fork-v1', 'official_release_artifact': False,
        'upstream_version': pins['base_version'], 'inputs': pins,
        'compiler_sha256': sha(prefix / 'bin/bend'), 'files': members})
    result = output / (NAME + '-full-linux-x64.tar.gz')
    with result.open('xb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as zipped, \
            tarfile.open(fileobj=zipped, mode='w|') as package:
        for path in [prefix, *sorted(prefix.rglob('*'))]:
            info = package.gettarinfo(str(path), arcname=str(path.relative_to(output)))
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            if path.is_file():
                with path.open('rb') as stream:
                    package.addfile(info, stream)
            else:
                package.addfile(info)
    receipt = {'archive': str(result), 'sha256': sha(result),
               'size_bytes': result.stat().st_size,
               'compiler_sha256': sha(prefix / 'bin/bend'),
               'official_release_artifact': False}
    save(output / 'receipt.json', receipt)
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
