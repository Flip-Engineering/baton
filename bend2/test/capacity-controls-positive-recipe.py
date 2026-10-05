#!/usr/bin/env python3
"""Complete production to classifier to package recipe, with negatives.

REMOTE EXECUTION ONLY, after Root admits this exact source and toolchain. It has
not been executed. It is a complete production run: every discovered module group
runs its own producer job, and the aggregate then sees the full work set, so no
control is missing when the package consumes the summary.

Layout, all beneath the work directory, keeps the original producer closure away
from everything the consumer writes:

    producer/<index>/        one group's manifest and streams (immutable)
    audit/                   classifier acquisition records
    out/                     every child's stdout, stderr and receipt
    payload-closure/         the copied original closure
    relocate/                a relocated copy used by the relocation check
    run.json                 every child's argv, cwd, pid, status and streams

Usage:
    python3 bend2/test/capacity-controls-positive-recipe.py --workdir W \
        --bend /path/to/.bend/bin/bend --compiler-archive /path/to/bend-2.0.25-darwin-arm64.tar.gz
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'bend2/scripts/laws-check.mjs'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def child(record, name, argv, run, stdin=None):
    """Run one child, keep its complete streams and record its actual identity."""
    stdout = run / 'out' / (name + '.stdout')
    stderr = run / 'out' / (name + '.stderr')
    stdout.parent.mkdir(parents=True, exist_ok=True)
    entry = {'name': name, 'argv': argv, 'cwd': str(ROOT)}
    try:
        with stdout.open('wb') as out, stderr.open('wb') as err:
            process = subprocess.Popen(argv, cwd=ROOT, stdin=subprocess.PIPE if stdin else None,
                                       stdout=out, stderr=err)
            entry['pid'] = process.pid
            process.communicate(stdin)
        entry['exit_code'] = process.returncode
    except OSError as error:
        entry['spawn_error'] = repr(error)
        entry['exit_code'] = None
    except BaseException as error:
        entry['interrupted'] = repr(error)
        entry['exit_code'] = None
        for stream, path in (('stdout', stdout), ('stderr', stderr)):
            entry[stream] = {'path': str(path.relative_to(run)) if path.exists() else None,
                             'bytes': path.stat().st_size if path.exists() else 0,
                             'sha256': digest(path) if path.exists() else None}
        record[-1:] = [entry]
        (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
        raise
    for stream, path in (('stdout', stdout), ('stderr', stderr)):
        entry[stream] = {'path': str(path.relative_to(run)) if path.exists() else None,
                         'bytes': path.stat().st_size if path.exists() else 0,
                         'sha256': digest(path) if path.exists() else None}
    record.append(entry)
    (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
    return entry


def package_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location('package_native',
                                                  ROOT / 'bend2/scripts/package-native.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir', required=True, type=pathlib.Path)
    parser.add_argument('--bend', required=True, type=pathlib.Path)
    parser.add_argument('--compiler-archive', required=True, type=pathlib.Path)
    parser.add_argument('--archive', type=pathlib.Path,
                        help='the built artifact archive, extracted and checked against the inventory')
    parser.add_argument('--receipt', help='a gate receipt produced from this evidence, reused and compared')
    parser.add_argument('--receipt-sha256', default='')
    args = parser.parse_args()
    run = args.workdir.resolve()
    if run.exists():
        raise SystemExit(str(run) + ' exists')
    for name in ('producer', 'audit', 'out', 'relocate'):
        (run / name).mkdir(parents=True, exist_ok=True)
    record = []

    # 0. Preconditions: a clean admitted checkout and the pinned compiler.
    status = subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain=v1'],
                                     text=True).strip()
    record.append({'name': 'preconditions', 'cwd': str(ROOT), 'git_status': status,
                   'bend': str(args.bend), 'compiler_archive': str(args.compiler_archive),
                   'node': shutil.which('node')})
    (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
    if status:
        raise SystemExit('the checkout is not clean')
    version = subprocess.check_output([str(args.bend), 'version'],
                                      env={'PATH': '/usr/bin:/bin', 'BEND_NO_TELEMETRY': '1'},
                                      text=True).strip()
    if version != 'bend 2.0.25':
        raise SystemExit('the compiler is not bend 2.0.25: ' + version)
    record[-1]['bend_version'] = version
    (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')

    # 1. Discovery, then one producer job per discovered group: a complete run.
    discovery = child(record, 'discover', ['node', str(CHECKER), '--discover'], run)
    if discovery['exit_code'] != 0:
        raise SystemExit('discovery failed with ' + repr(discovery['exit_code']))
    cases = [json.loads(line) for line in
             (run / discovery['stdout']['path']).read_text().splitlines() if line.strip()]
    groups = sorted({case['module'] for case in cases})
    if not groups:
        raise SystemExit('discovery returned no group')
    for index, group in enumerate(groups):
        evidence = run / 'producer' / str(index)
        evidence.mkdir()
        entry = child(record, 'produce-' + str(index),
                      ['node', str(CHECKER), '--group', group, '--evidence-dir', str(evidence),
                       '--time-tool', '/usr/bin/time', '--time-flag', '-l',
                       '--bend', str(args.bend), '--compiler-archive',
                       str(args.compiler_archive)], run)
        if entry['exit_code'] != 0:
            raise SystemExit('producer failed for ' + group)
    aggregate = child(record, 'aggregate',
                      ['node', str(CHECKER), '--aggregate', str(run / 'producer')], run)
    if aggregate['exit_code'] != 0:
        raise SystemExit('aggregate failed')

    # 2. Consumer: verify bytes, classification, references, then copy the closure.
    package = package_module()
    try:
        result = package.controls_evidence(run / 'producer', package.snapshot(), args.bend,
                                           audit=run / 'audit',
                                           destination=run / 'payload-closure')
    except BaseException as error:
        record.append({'name': 'consume', 'outcome': 'refused', 'reason': repr(error)})
        (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
        raise
    record.append({'name': 'consume', 'outcome': 'qualified',
                   'inventory_sha256': result['inventory_sha256'],
                   'reduction_sha256': result['reduction_sha256']})
    (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
    (run / 'reduction.json').write_text(json.dumps(result['reduction'], indent=2) + '\n')
    print(json.dumps({'cases': result['cases'], 'groups': result['groups'],
                      'inventory_sha256': result['inventory']['inventory_sha256'],
                      'closure_sha256': result['closure_sha256'],
                      'reduction_sha256': result['reduction']['sha256']}, indent=2))

    # 3. Relocation: the copied closure re-hashes to the same inventory, and the
    #    package consumes the relocated copy end to end, producing the same
    #    stable reduction as the original producer evidence.
    relocated = run / 'relocate' / 'closure'
    shutil.copytree(run / 'payload-closure', relocated)
    package.verify_inventory(relocated, result['inventory'])
    try:
        relocated_result = package.controls_evidence(relocated, package.snapshot(), args.bend,
                                                     audit=run / 'relocate' / 'audit')
    except BaseException as error:
        record.append({'name': 'relocated-consume', 'outcome': 'refused', 'reason': repr(error)})
        (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
        raise
    record.append({'name': 'relocated-consume', 'outcome': 'qualified',
                   'reduction_sha256': relocated_result['reduction_sha256']})
    (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
    if relocated_result['reduction_sha256'] != result['reduction_sha256']:
        raise SystemExit('the relocated closure produced a different stable reduction')
    (run / 'relocated-reduction.json').write_text(
        json.dumps(relocated_result['reduction'], indent=2) + '\n')

    # 4. Changed member: the relocated closure no longer matches its inventory.
    victim = next(path for path in sorted(relocated.rglob('*.stdout')))
    victim.write_bytes(b'changed\n')
    try:
        package.verify_inventory(relocated, result['inventory'])
        raise SystemExit('a changed member was accepted')
    except RuntimeError as error:
        print('changed member refused:', error)

    if args.archive:
        import tarfile
        with tarfile.open(args.archive, 'r:gz') as archive:
            archive.extractall(run / 'readback')
        archived = run / 'readback' / 'baton2-development-darwin-arm64' / 'controls-evidence'
        if not archived.is_dir():
            raise SystemExit('the archive holds no controls evidence member')
        current = package.verify_archived_inventory(archived, result['inventory'])
        record.append({'name': 'archive-readback', 'outcome': 'verified',
                       'members': len(current['members'])})
    if args.receipt:
        import subprocess as _subprocess
        logs = run / 'receipt-logs'
        logs.mkdir(exist_ok=True)
        destination, receipt = package.reuse_gates(pathlib.Path(args.receipt),
                                                   args.receipt_sha256, args.bend, logs,
                                                   package.snapshot())
        fresh = receipt.get('controls_evidence') or {}
        if fresh.get('reduction_sha256') != result['reduction_sha256']:
            raise SystemExit('the reused receipt names a different stable reduction')
        record.append({'name': 'receipt-reuse', 'outcome': 'verified',
                       'receipt': str(destination)})
    (run / 'run.json').write_text(json.dumps({'children': record}, indent=2) + '\n')
    print('recipe complete; child receipts and streams are under ' + str(run))


if __name__ == '__main__':
    main()
