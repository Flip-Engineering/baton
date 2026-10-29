#!/usr/bin/env python3
"""Select the existing root-channel Node checks or native qualification for a PR."""
import argparse
import json
import pathlib
import re
import runpy
import subprocess


ROOT_CHANNEL_INPUTS = frozenset((
    'bend2/scripts/codex-root-relay.mjs',
    'bend2/scripts/mcp-conductor.mjs',
    'bend2/scripts/root-channel-config.mjs',
    'bend2/test/codex-root-relay.test.mjs',
    'bend2/test/root-channel-attach.test.mjs',
))
SHA1 = re.compile('[0-9a-f]{40}')


def select(changes):
    """Every changed executable input must belong to the selected Node suite."""
    node_changed = False
    for status, path in changes:
        if status not in ('A', 'M'):
            return 'native', 'A removed or replaced path requires native qualification.'
        if path in ROOT_CHANNEL_INPUTS:
            node_changed = True
        elif path.startswith('docs/') and path.endswith('.md'):
            continue
        else:
            return 'native', 'Native qualification covers the changed path: ' + path
    if node_changed:
        return 'node-root-channel', 'The changed executable inputs use the root-channel Node suite.'
    return 'native', 'Native qualification covers this change set.'


def decide(source, event, base, head):
    if event != 'pull_request':
        return {'route': 'native', 'reason': 'The requested workflow uses native qualification.'}
    if not SHA1.fullmatch(base) or not SHA1.fullmatch(head):
        raise ValueError('The comparison requires full base and head commit SHAs.')
    git = ['git', '-c', 'safe.directory=' + str(source), '-C', str(source)]
    actual = subprocess.check_output([*git, 'rev-parse', 'HEAD'], text=True).strip()
    if actual != head:
        raise ValueError('The checkout differs from the requested head commit.')
    producer = runpy.run_path(str(pathlib.Path(__file__).with_name('native-producer-route.py')))
    availability = producer['ensure_base'](source, base)
    fields = subprocess.check_output([
        *git, 'diff', '--no-renames', '--name-status', '-z', base, head,
    ]).decode().split('\0')
    if fields[-1] == '':
        fields.pop()
    if len(fields) % 2:
        raise ValueError('The changed-path output is incomplete.')
    changes = list(zip(fields[::2], fields[1::2]))
    route, reason = select(changes)
    return {'route': route, 'reason': reason, 'base_availability': availability,
            'changes': [{'status': status, 'path': path} for status, path in changes]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--event', required=True)
    parser.add_argument('--base', default='')
    parser.add_argument('--head', required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--github-output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        record = decide(args.source.resolve(), args.event, args.base, args.head)
    except Exception as error:
        record = {'route': 'native', 'reason': 'Native qualification covers an unavailable comparison: ' + str(error)}
    record.update(base=args.base, head=args.head, event=args.event)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(record, indent=2) + '\n')
    with args.github_output.open('a') as output:
        output.write('route=' + record['route'] + '\n')
    print(json.dumps(record))


if __name__ == '__main__':
    main()
