#!/usr/bin/env python3
"""Prepare the selected pinned Linux compiler and retain its complete identity."""
import argparse
import json
import os
import pathlib
import runpy
import shutil
import subprocess
import sys

# Exit status for a compiler selection that this candidate tree cannot verify.
REFUSED = 78


def candidate_commit(root):
    """The checked-out candidate commit; the workflow SHA can name a merge commit instead."""
    result = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'],
                            capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else 'unknown'


def refuse(args, verifier, evidence, reason, requested_sha256, source, detail):
    """Retain why a selection was refused, then stop with a distinct status.

    The record names the candidate, the selected archive, where the selection came
    from, and the archives the candidate's verifier lists.
    """
    root = pathlib.Path(__file__).resolve().parents[2]
    known = [{'archive_sha256': sha, 'name': identity.get('name', ''),
              'source_commit': identity.get('source_commit', '')}
             for sha, identity in verifier['COMPILER_ARCHIVES'].items()]
    record = {'schema': 'baton2-linux-compiler-selection-refusal-v1',
              'reason': reason,
              'selection_source': source,
              'candidate_commit': candidate_commit(root),
              'workflow_sha': os.environ.get('GITHUB_SHA', ''),
              'selected_archive': args.archive,
              'selected_archive_sha256': requested_sha256,
              'default_selection': str(args.default_selection or ''),
              'verifier': str(pathlib.Path(__file__).resolve().with_name('reuse-native-main.py').relative_to(root)),
              'known_archives': known,
              'detail': detail}
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / 'compiler-selection-refusal.json').write_text(json.dumps(record, indent=2) + '\n')
    print(reason + ' (' + source + ') for candidate ' + record['candidate_commit']
          + ', archive SHA256 ' + (requested_sha256 or 'none') + '; this tree lists '
          + str(len(known)) + ' archives. See evidence/compiler-selection-refusal.json.',
          file=sys.stderr)
    raise SystemExit(REFUSED)


UNKNOWN_DETAIL = ('The candidate tree does not list the selected compiler archive. If the '
                  'candidate predates the commit that adds its verifier entry, integrate '
                  'that commit; otherwise select an archive this tree lists.')


def tree_default(args, verifier, evidence):
    """The compiler archive the checked-out tree selects when no input does.

    The file belongs to the same revision as the verifier, so a candidate and its
    default cannot come from different revisions.
    """
    path = args.default_selection
    try:
        record = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        refuse(args, verifier, evidence, 'no-tree-compiler-selection', '', 'tree-default',
               'The candidate tree has no readable compiler selection at ' + str(path) + ' ('
               + type(error).__name__ + '). A candidate that predates the file needs an explicit '
               'archive and SHA256, or the commit that adds the file.')
    archive = record.get('archive') if isinstance(record, dict) else None
    sha = record.get('archive_sha256') if isinstance(record, dict) else None
    valid = (isinstance(archive, str) and archive and isinstance(sha, str) and len(sha) == 64
             and all(c in '0123456789abcdef' for c in sha)
             and record.get('schema') == 'baton2-native-compiler-selection-v1')
    if not valid:
        refuse(args, verifier, evidence, 'malformed-tree-compiler-selection', '', 'tree-default',
               str(path) + ' must hold schema baton2-native-compiler-selection-v1, an archive path '
               'and a lowercase SHA256.')
    return archive, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=pathlib.Path, required=True)
    parser.add_argument('--archive', default='')
    parser.add_argument('--archive-sha256', default='')
    parser.add_argument('--runner', required=True)
    parser.add_argument('--ccache', default='')
    parser.add_argument('--github-env', type=pathlib.Path)
    parser.add_argument('--default-selection', type=pathlib.Path,
                        help='compiler selection file of the checked-out tree, used when no archive is given')
    args = parser.parse_args()
    verifier = runpy.run_path(str(pathlib.Path(__file__).with_name('reuse-native-main.py')))
    require, digest = verifier['require'], verifier['digest']
    run = args.run.resolve()
    archive = run / 'bend-2.0.25-linux-x64.tar.gz'
    evidence = run / 'evidence'
    home = run / 'toolchain-home'
    source = 'input'
    if args.default_selection and not (args.archive or args.archive_sha256):
        require(args.runner == 'homelab', 'A retained compiler requires the homelab runner.')
        args.archive, args.archive_sha256 = tree_default(args, verifier, evidence)
        source = 'tree-default'
    selected = bool(args.archive or args.archive_sha256)
    if selected:
        require(args.runner == 'homelab', 'A retained compiler requires the homelab runner.')
        require(args.archive and args.archive_sha256, 'Select both the compiler archive and its SHA256.')
        if args.archive_sha256 not in verifier['COMPILER_ARCHIVES']:
            refuse(args, verifier, evidence, 'unknown-compiler-archive', args.archive_sha256,
                   source, UNKNOWN_DETAIL)
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
    if archive_sha not in verifier['COMPILER_ARCHIVES']:
        refuse(args, verifier, evidence, 'unknown-compiler-archive', archive_sha, source,
               UNKNOWN_DETAIL)
    subprocess.run(['tar', '-xzf', str(archive), '-C', str(home), '--strip-components=1'], check=True)
    files = verifier['distribution'](archive, home)
    compiler = home / 'bin/bend'
    identity = verifier['COMPILER_ARCHIVES'][archive_sha]
    binary_sha = digest(compiler)
    if 'binary_sha256' in identity:
        require(binary_sha == identity['binary_sha256'], 'The selected compiler binary changed.')
    if 'bun_sha256' in identity:
        require(digest(home / 'bin/bun') == identity['bun_sha256'],
                'The selected compiler Bun runtime changed.')
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
            output.write('BATON2_SELECTED_COMPILER_ARCHIVE=' + str(archive) + '\n')
            output.write('BATON2_CCACHE=' + (str(wrapper) if cache else '') + '\n')
            if cache:
                output.write('CCACHE_DIR=' + cache['directory'] + '\n')
                output.write('CCACHE_LOGFILE=' + cache['log'] + '\n')
    (evidence / 'compiler-selection-source.json').write_text(json.dumps({
        'schema': 'baton2-linux-compiler-selection-source-v1',
        'selection_source': source if selected else 'download',
        'default_selection': str(args.default_selection or ''),
        'candidate_commit': candidate_commit(pathlib.Path(__file__).resolve().parents[2]),
        'archive': args.archive, 'archive_sha256': archive_sha}, indent=2) + '\n')
    path = run / 'generated/compiler-selection.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(selection, indent=2) + '\n')
    print(json.dumps({key: value for key, value in selection.items() if key != 'distribution'}))


if __name__ == '__main__':
    main()
