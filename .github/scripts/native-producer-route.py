#!/usr/bin/env python3
"""Select the producer of Main C for a pull request run.

`route` compares the Main production inputs (the entry import closure that
reuse-native-main.py selects) and the producer tooling of the pull request base
with those of its head. When both are equal, the run takes its Main C from the
base commit and labels it as produced from the base. `produce` generates that C
through the shared compilation queue, `assemble` writes the producer handoff,
and `verify-base` is the consumer-side check of a base-produced handoff.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import runpy
import shutil
import subprocess
import sys
import time

# Files the Main producer step executes. A change to any of them can change the
# generated C or the way it is produced, so the pull request runs its own producer.
PRODUCER_TOOLING = (
    '.github/workflows/bend2-native.yml',
    '.github/scripts/native-producer-route.py',
    '.github/scripts/queue-native-checks.py',
    '.github/scripts/compile-cgen-exec.py',
    '.github/scripts/prepare-native-compiler.py',
    '.github/scripts/reuse-native-main.py',
    'bend2/scripts/build-native.sh',
    'bend2/scripts/queue-entry.sh',
    'bend2/scripts/bend-lineage-guard.sh',
)
ROUTE_SCHEMA = 'baton2-main-producer-route-v1'
HANDOFF_SCHEMA = 'baton2-generated-c-handoff-v1'
SHA1 = re.compile('[0-9a-f]{40}')
reuse = runpy.run_path(str(pathlib.Path(__file__).with_name('reuse-native-main.py')))
require, digest, save = reuse['require'], reuse['digest'], reuse['save']
ENTRY = reuse['ENTRY']


def git(root, *args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + str(root), *args], cwd=root).decode().rstrip('\n')


def checkout(source, commit, destination):
    log = destination.with_suffix('.log')
    with log.open('wb') as stream:
        subprocess.run(['git', 'clone', '--no-hardlinks', '--no-checkout', '--', str(source), str(destination)],
                       stdout=stream, stderr=stream, check=True)
        subprocess.run(['git', '-C', str(destination), 'checkout', '--detach', commit],
                       stdout=stream, stderr=stream, check=True)
    require(git(destination, 'rev-parse', 'HEAD') == commit, 'The checkout differs from the requested commit.')
    return destination


def production(root):
    commit, tree = git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD^{tree}')
    rows = reuse['source_files'](root, commit, tree)
    inputs, issue = reuse['production_inputs'](root, rows)
    return commit, tree, rows, inputs, issue


def tooling(root, commit):
    """Map each producer tooling path to its git blob at the commit; a missing path maps to an empty string."""
    blobs = {}
    for path in PRODUCER_TOOLING:
        found = subprocess.run(['git', '-c', 'safe.directory=' + str(root), 'rev-parse', '--verify', '-q', commit + ':' + path],
                               cwd=root, capture_output=True, text=True)
        blobs[path] = found.stdout.strip() if found.returncode == 0 else ''
    return blobs


def decide(source, event, base, head, scratch):
    """Return the producer name, the reason and the recorded comparison."""
    record = {'schema': ROUTE_SCHEMA, 'event': event, 'base': base, 'head': head}
    if event != 'pull_request':
        return 'candidate', 'The run is not a pull request.', record
    if not (SHA1.fullmatch(base or '') and SHA1.fullmatch(head or '')):
        return 'candidate', 'The base or head commit is not a full SHA.', record
    if git(source, 'rev-parse', 'HEAD') != head:
        return 'candidate', 'The checkout is not the head commit.', record
    try:
        base_root = checkout(source, base, scratch / 'route-base')
    except (subprocess.CalledProcessError, ValueError) as error:
        return 'candidate', 'The base commit is unavailable: ' + str(error), record
    old, new = tooling(source, base), tooling(source, head)
    changed = [path for path in PRODUCER_TOOLING if old[path] != new[path]]
    record['producer_tooling'] = {'base': old, 'head': new}
    if changed:
        return 'candidate', 'Producer tooling differs: ' + ', '.join(changed), record
    _, _, _, base_inputs, base_issue = production(base_root)
    _, _, _, head_inputs, head_issue = production(source)
    record['base_production_inputs_sha256'] = hashlib.sha256(json.dumps(base_inputs, sort_keys=True).encode()).hexdigest()
    record['head_production_inputs_sha256'] = hashlib.sha256(json.dumps(head_inputs, sort_keys=True).encode()).hexdigest()
    if base_issue or head_issue:
        return 'candidate', base_issue or head_issue, record
    if base_inputs != head_inputs:
        old_rows, new_rows = {r['path']: r for r in base_inputs}, {r['path']: r for r in head_inputs}
        paths = sorted(p for p in old_rows.keys() | new_rows.keys() if old_rows.get(p) != new_rows.get(p))
        return 'candidate', 'Main production inputs differ: ' + ', '.join(paths[:8]), record
    record['production_inputs'] = len(head_inputs)
    return 'base', 'The Main production inputs and producer tooling of base and head are equal.', record


def route(args):
    run = args.run.resolve()
    (run / 'evidence').mkdir(parents=True, exist_ok=True)
    scratch = run / 'route'
    scratch.mkdir(exist_ok=True)
    try:
        producer, reason, record = decide(args.source.resolve(), args.event, args.base, args.head, scratch)
    except Exception as error:  # Any doubt selects the normal producer.
        producer, reason, record = 'candidate', 'Route selection failed: %r' % (error,), {
            'schema': ROUTE_SCHEMA, 'event': args.event, 'base': args.base, 'head': args.head}
    record.update(producer=producer, reason=reason)
    save(run / 'evidence/producer-route.json', record)
    if args.github_output:
        with args.github_output.open('a') as output:
            output.write('producer=%s\nreason=%s\n' % (producer, reason.replace('\n', ' ')))
    print(json.dumps(record))


def produce(args):
    """Generate the base commit's Main C through the shared queue."""
    run = args.run.resolve()
    evidence = run / 'evidence'
    base_root = checkout(args.source.resolve(), args.base, run / 'base-source')
    queue = runpy.run_path(str(args.source.resolve() / '.github/scripts/queue-native-checks.py'))
    environment = queue['environment'](run)
    environment['BEND_NO_TELEMETRY'] = '1'
    output = base_root / '.scratch/bend2/baton2.c'
    output.parent.mkdir(parents=True, exist_ok=True)
    steps = [('base-lineage-guard', ['sh', 'bend2/scripts/bend-lineage-guard.sh', os.environ['BEND']]),
             ('base-main-cgen', [sys.executable, str(args.source.resolve() / '.github/scripts/queue-native-checks.py'),
                                 'stage', 'bend', os.environ['BEND'], ENTRY, '-o', str(output)])]
    checks = []
    for label, argv in steps:
        started = time.time()
        with (evidence / (label + '.stdout')).open('wb') as stdout, (evidence / (label + '.stderr')).open('wb') as stderr:
            result = subprocess.run(argv, cwd=base_root, stdout=stdout, stderr=stderr, env=environment)
        checks.append({'label': label, 'argv': argv, 'cwd': str(base_root), 'exit_code': result.returncode,
                       'elapsed_seconds': time.time() - started,
                       'stdout': label + '.stdout', 'stderr': label + '.stderr'})
        save(evidence / 'base-producer-checks.json', checks)
        if result.returncode:
            raise SystemExit(result.returncode)
    assemble_from(args, base_root, output, checks)


def assemble(args):
    checks = json.loads(args.checks.read_text()) if args.checks else []
    assemble_from(args, checkout(args.source.resolve(), args.base, args.run.resolve() / 'base-source'),
                  args.generated_c, checks)


def assemble_from(args, base_root, generated_c, checks):
    run = args.run.resolve()
    generated, evidence = run / 'generated', run / 'evidence'
    generated.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    source = args.source.resolve()
    head, head_tree = git(source, 'rev-parse', 'HEAD'), git(source, 'rev-parse', 'HEAD^{tree}')
    base, base_tree, base_rows, base_inputs, base_issue = production(base_root)
    require(base == args.base, 'The producer checkout is not the base commit.')
    require(base_issue is None, 'The base production inputs are unsupported: ' + str(base_issue))
    route_record = json.loads((evidence / 'producer-route.json').read_text())
    require(route_record['producer'] == 'base' and route_record['base'] == base and route_record['head'] == head,
            'The recorded route does not select this base for this head.')
    selection = json.loads((generated / 'compiler-selection.json').read_text())
    require(selection['compiler_archive_sha256'] in reuse['COMPILER_ARCHIVES'], 'Unknown compiler archive SHA256.')
    shutil.copyfile(generated_c, generated / 'baton2.c')
    source_manifest = {row['path']: row['sha256'] for row in base_rows}
    save(generated / 'source-manifest.json', source_manifest)
    save(generated / 'production-inputs.json', base_inputs)
    checks = [
        {'label': 'base-source-identity', 'exit_code': 0, 'source_commit': base, 'source_tree': base_tree},
        {'label': 'pinned-compiler-identity', 'exit_code': 0,
         'archive_sha256': selection['compiler_archive_sha256'],
         'binary_sha256': selection['compiler_binary_sha256'],
         'selection_sha256': digest(generated / 'compiler-selection.json')},
        *checks,
        {'label': 'main-producer-route', 'exit_code': 0, 'route': 'evidence/producer-route.json',
         'route_sha256': digest(evidence / 'producer-route.json')}]
    save(evidence / 'producer-checks.json', checks)
    handoff = {
        'schema': HANDOFF_SCHEMA, 'producer_kind': 'base',
        'source_commit': base, 'source_tree': base_tree,
        'consumer_source_commit': head, 'consumer_source_tree': head_tree,
        'platform': 'linux',
        'workflow_run_id': os.environ['GITHUB_RUN_ID'], 'workflow_run_attempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'compiler_archive_sha256': selection['compiler_archive_sha256'],
        'compiler_binary_sha256': selection['compiler_binary_sha256'],
        'compiler_selection_sha256': digest(generated / 'compiler-selection.json'),
        'generated_c_sha256': digest(generated / 'baton2.c'), 'generated_c_size': (generated / 'baton2.c').stat().st_size,
        'source_manifest_sha256': digest(generated / 'source-manifest.json'),
        'production_inputs_sha256': digest(generated / 'production-inputs.json'),
        'producer_tooling': tooling(base_root, base),
        'checks': checks, 'route': route_record}
    save(generated / 'handoff-manifest.json', handoff)
    print(json.dumps({'status': 'base-produced', 'source_commit': base, 'consumer_source_commit': head,
                      'generated_c_sha256': handoff['generated_c_sha256']}))


def verify_base(args):
    """Consumer-side check of a base-produced handoff against the consumer checkout."""
    generated = args.generated.resolve()
    root = args.source.resolve()
    handoff = json.loads((generated / 'handoff-manifest.json').read_text())
    require(handoff['schema'] == HANDOFF_SCHEMA and handoff['producer_kind'] == 'base', 'Not a base-produced handoff.')
    head, head_tree = git(root, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD^{tree}')
    require(handoff['consumer_source_commit'] == head and handoff['consumer_source_tree'] == head_tree,
            'The base-produced handoff was made for another consumer.')
    require(SHA1.fullmatch(handoff['source_commit']) and handoff['source_commit'] != head
            and handoff['route']['base'] == handoff['source_commit'] and handoff['route']['head'] == head
            and handoff['route']['producer'] == 'base', 'The recorded route does not bind the base producer.')
    for name, key in (('baton2.c', 'generated_c_sha256'), ('source-manifest.json', 'source_manifest_sha256'),
                      ('production-inputs.json', 'production_inputs_sha256'),
                      ('compiler-selection.json', 'compiler_selection_sha256')):
        require(digest(generated / name) == handoff[key], 'Base-produced file differs from its handoff digest: ' + name)
    require((generated / 'baton2.c').stat().st_size == handoff['generated_c_size'], 'Base-produced C size differs.')
    _, _, _, head_inputs, issue = production(root)
    require(issue is None, 'The consumer production inputs are unsupported: ' + str(issue))
    require(head_inputs == json.loads((generated / 'production-inputs.json').read_text()),
            'Consumer Main production inputs differ from the base-produced inputs.')
    current_tooling = tooling(root, head)
    changed = [path for path in PRODUCER_TOOLING if current_tooling[path] != handoff['producer_tooling'][path]]
    require(not changed, 'Consumer producer tooling differs from the base: ' + ', '.join(changed))
    require(handoff['route']['production_inputs'] == len(head_inputs), 'Recorded production input count differs.')
    print(json.dumps({'status': 'verified', 'producer_kind': 'base', 'source_commit': handoff['source_commit'],
                      'consumer_source_commit': head, 'generated_c_sha256': handoff['generated_c_sha256']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    route_parser = modes.add_parser('route')
    route_parser.add_argument('--source', type=pathlib.Path, required=True)
    route_parser.add_argument('--run', type=pathlib.Path, required=True)
    route_parser.add_argument('--event', required=True)
    route_parser.add_argument('--base', default='')
    route_parser.add_argument('--head', required=True)
    route_parser.add_argument('--github-output', type=pathlib.Path)
    produce_parser = modes.add_parser('produce')
    assemble_parser = modes.add_parser('assemble')
    for sub in (produce_parser, assemble_parser):
        sub.add_argument('--source', type=pathlib.Path, required=True)
        sub.add_argument('--run', type=pathlib.Path, required=True)
        sub.add_argument('--base', required=True)
    assemble_parser.add_argument('--generated-c', type=pathlib.Path, required=True)
    assemble_parser.add_argument('--checks', type=pathlib.Path)
    sub = modes.add_parser('verify-base')
    sub.add_argument('--source', type=pathlib.Path, required=True)
    sub.add_argument('--generated', type=pathlib.Path, required=True)
    args = parser.parse_args()
    {'route': route, 'produce': produce, 'assemble': assemble, 'verify-base': verify_base}[args.mode](args)


if __name__ == '__main__':
    main()
