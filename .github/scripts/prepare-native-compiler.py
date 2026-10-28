#!/usr/bin/env python3
"""Prepare the selected pinned Linux compiler and retain its complete identity."""
import argparse
import json
import os
import pathlib
import runpy
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=pathlib.Path, required=True)
    parser.add_argument('--archive', default='')
    parser.add_argument('--archive-sha256', default='')
    parser.add_argument('--runner', required=True)
    parser.add_argument('--ccache', default='')
    parser.add_argument('--github-env', type=pathlib.Path)
    args = parser.parse_args()
    verifier = runpy.run_path(str(pathlib.Path(__file__).with_name('reuse-native-main.py')))
    require, digest = verifier['require'], verifier['digest']
    run = args.run.resolve()
    archive = run / 'bend-2.0.25-linux-x64.tar.gz'
    evidence = run / 'evidence'
    home = run / 'toolchain-home'
    selected = bool(args.archive or args.archive_sha256)
    if selected:
        require(args.runner == 'homelab', 'A retained compiler requires the homelab runner.')
        require(args.archive and args.archive_sha256, 'Select both the compiler archive and its SHA256.')
        require(args.archive_sha256 in verifier['COMPILER_ARCHIVES'], 'Unknown compiler archive SHA256.')
        original = pathlib.Path(os.path.expandvars(os.path.expanduser(args.archive))).resolve()
        require(digest(original) == args.archive_sha256, 'The retained compiler archive changed.')
        shutil.copyfile(original, archive)
    else:
        with (evidence / 'compiler-download.stdout').open('wb') as stdout, \
                (evidence / 'compiler-download.stderr').open('wb') as stderr:
            subprocess.run(['curl', '--proto', '=https', '--tlsv1.2', '-fsSL',
                            'https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-linux-x64.tar.gz',
                            '-o', str(archive)], stdout=stdout, stderr=stderr, check=True)
        require(digest(archive) == verifier['ARCHIVE_SHA'], 'The downloaded compiler archive changed.')
    archive_sha = digest(archive)
    require(archive_sha in verifier['COMPILER_ARCHIVES'], 'Unknown compiler archive SHA256.')
    subprocess.run(['tar', '-xzf', str(archive), '-C', str(home), '--strip-components=1'], check=True)
    files = verifier['distribution'](archive, home)
    compiler = home / 'bin/bend'
    identity = verifier['COMPILER_ARCHIVES'][archive_sha]
    binary_sha = digest(compiler)
    if 'binary_sha256' in identity:
        require(binary_sha == identity['binary_sha256'], 'The selected compiler binary changed.')
    selection = {'schema': 'baton2-linux-compiler-selection-v1', **identity,
                 'selection': 'retained' if selected else 'downloaded',
                 'compiler_archive_sha256': archive_sha, 'compiler_binary_sha256': binary_sha,
                 'distribution': files}
    cache = None
    if args.ccache:
        require(args.runner == 'homelab', 'The private native object cache requires the homelab runner.')
        wrapper = pathlib.Path(os.path.expandvars(os.path.expanduser(args.ccache))).resolve()
        require(digest(wrapper) == '1b1833c4032d92fad2515dd8194e0106cd1e4a45cbe2f30a16d73035bacfd035',
                'The native object cache wrapper differs from its measured version.')
        cache = {'wrapper': verifier['fact'](wrapper),
                 'directory': str(pathlib.Path.home() / '.cache/baton-native-objects'),
                 'log': str(evidence / 'native-object-cache.log')}
        pathlib.Path(cache['directory']).mkdir(parents=True, exist_ok=True)
    (evidence / 'native-object-cache.json').write_text(json.dumps(cache, indent=2) + '\n')
    if args.github_env:
        with args.github_env.open('a') as output:
            output.write('BATON2_CCACHE=' + (str(wrapper) if cache else '') + '\n')
            if cache:
                output.write('CCACHE_DIR=' + cache['directory'] + '\n')
                output.write('CCACHE_LOGFILE=' + cache['log'] + '\n')
    path = run / 'generated/compiler-selection.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(selection, indent=2) + '\n')
    print(json.dumps({key: value for key, value in selection.items() if key != 'distribution'}))


if __name__ == '__main__':
    main()
