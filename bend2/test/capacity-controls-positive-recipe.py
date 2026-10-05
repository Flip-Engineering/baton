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
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'bend2/scripts/laws-check.mjs'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stream_record(path, run=None):
    """One observed child stream, or an explicit unavailable observation.

    Accounting reads cannot be allowed to supersede the exception being reported,
    so a stream that is missing or unreadable is recorded as unavailable rather
    than raising here.
    """
    try:
        if path is None or not path.exists():
            return {'path': None, 'bytes': 0, 'sha256': None, 'unavailable': 'not observed'}
        data = path.read_bytes()
        return {'path': None if run is None else str(path.relative_to(run)),
                'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    except OSError as error:
        return {'path': None, 'bytes': 0, 'sha256': None, 'unavailable': repr(error)}


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
        entry['signal'] = getattr(locals().get('process', None), 'returncode', None)
        for stream, path in (('stdout', stdout), ('stderr', stderr)):
            entry[stream] = stream_record(path, run)
        try:
            settle(run, record, name, entry.get('outcome', 'failed'), **{
                key: value for key, value in entry.items() if key not in ('name', 'outcome')})
        except BaseException as record_error:
            setattr(error, 'record_error', repr(record_error))
            raise error from record_error
        raise
    for stream, path in (('stdout', stdout), ('stderr', stderr)):
        entry[stream] = stream_record(path, run)
    settle(run, record, name, entry.get('outcome', 'completed'), **{
        key: value for key, value in entry.items() if key not in ('name', 'outcome')})
    return entry


def write_record(run, record):
    """Replace the stage record atomically, keeping the previous rows intact.

    The replacement is written beside the record and swapped into place, so a
    partial write cannot truncate rows this run already settled. This is an
    immediate replacement, not a crash or power-loss durability protocol: no
    fsync or publication step is claimed.
    """
    path = run / 'run.json'
    staged = run / 'run.json.next'
    try:
        staged.write_text(json.dumps({'children': record}, indent=2) + '\n')
        os.replace(staged, path)
    except OSError as error:
        cleanup_error = None
        try:
            if staged.exists():
                staged.unlink()
        except OSError as secondary:
            # A cleanup failure is retained beside the write failure rather than
            # discarded, so the record of what happened stays complete.
            cleanup_error = repr(secondary)
        raised = RuntimeError('the run record could not be written: ' + repr(error))
        raised.cleanup_error = cleanup_error
        raise raised from error


def settle(run, record, name, outcome, **fields):
    """Settle one stage row and persist it before anything else can fail.

    The row can be declared before its fallible work and settled again afterwards,
    so an observation this run already made is durable and a later stage failure
    cannot erase it.
    """
    entry = {'name': name, 'outcome': outcome, **fields}
    for position, existing in enumerate(record):
        if existing.get('name') == name:
            record[position] = {**existing, **entry}
            break
    else:
        record.append(entry)
    write_record(run, record)
    return record[-1] if record[-1].get('name') == name else entry


def attempt(run, record, name, work, **declared):
    """Run one stage with its identity declared first and settled on every exit.

    The original exception is raised with any recording error attached, so a
    failure to persist the terminal row never replaces the cause it was recording.
    """
    settle(run, record, name, 'attempted', **declared)
    try:
        value = work()
    except BaseException as error:
        try:
            settle(run, record, name, 'failed', failure=repr(error),
                   failure_type=type(error).__name__)
        except BaseException as record_error:
            setattr(error, 'record_error', repr(record_error))
            raise error from record_error
        raise
    try:
        settle(run, record, name, 'verified', **(value if isinstance(value, dict) else {}))
    except BaseException as record_error:
        # The work completed; a failure to record that must not lose the outcome.
        setattr(record_error, 'stage', name)
        setattr(record_error, 'stage_outcome', 'completed')
        setattr(record_error, 'stage_value', value if isinstance(value, dict) else None)
        raise
    return value


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
    parser.add_argument('--expected-archive-sha256', default='',
                        help='the admitted archive digest; required with --archive and compared before extraction')
    parser.add_argument('--receipt', help='a gate receipt produced from this evidence, reused and compared')
    parser.add_argument('--receipt-sha256', default='')
    args = parser.parse_args()
    run = args.workdir.resolve()
    if run.exists():
        raise SystemExit(str(run) + ' exists')
    for name in ('producer', 'audit', 'out', 'relocate'):
        (run / name).mkdir(parents=True, exist_ok=True)
    if args.archive:
        # Required invocation arguments are validated before any child effect.
        if not args.expected_archive_sha256:
            raise SystemExit('--archive requires --expected-archive-sha256, '
                             'the admitted archive identity')
        if not re.fullmatch(r'[0-9a-f]{64}', args.expected_archive_sha256):
            raise SystemExit('--expected-archive-sha256 is not a sha256 hex digest')
        if not args.archive.is_file():
            raise SystemExit('the admitted archive is missing: ' + str(args.archive))
    record = []

    # 0. Preconditions: a clean admitted checkout and the pinned compiler.
    git = child(record, 'precondition-git', ['git', '-C', str(ROOT), 'status', '--porcelain=v1'],
                run)
    status = (run / git['stdout']['path']).read_text().strip() if git['exit_code'] == 0 else None
    compiler = child(record, 'precondition-compiler', [str(args.bend), 'version'], run)
    version = ((run / compiler['stdout']['path']).read_text().strip()
               if compiler['exit_code'] == 0 else None)
    settle(run, record, 'preconditions', 'observed', cwd=str(ROOT), git_status=status,
           bend=str(args.bend), bend_version=version,
           compiler_archive=str(args.compiler_archive), node=shutil.which('node'))
    if git['exit_code'] != 0:
        raise SystemExit('the checkout status could not be read: ' + repr(git['exit_code']))
    if status:
        raise SystemExit('the checkout is not clean')
    if version != 'bend 2.0.25':
        raise SystemExit('the compiler is not bend 2.0.25: ' + repr(version))
    if version != 'bend 2.0.25':
        raise SystemExit('the compiler is not bend 2.0.25: ' + version)


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
        try:
            settle(run, record, 'consume', 'refused', reason=repr(error))
        except BaseException as record_error:
            setattr(error, 'record_error', repr(record_error))
            raise error from record_error
        raise
    settle(run, record, 'consume', 'qualified', **{
                   'inventory_sha256': result['inventory_sha256'],
                   'reduction_sha256': result['reduction_sha256']})
    reduction_artifact = run / 'reduction.json'
    reduction_artifact.write_text(json.dumps(result['reduction'], indent=2) + '\n')
    settle(run, record, 'reduction-artifact', 'verified', artifact='reduction.json',
           sha256=digest(reduction_artifact))
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
        try:
            settle(run, record, 'relocated-consume', 'refused', reason=repr(error))
        except BaseException as record_error:
            setattr(error, 'record_error', repr(record_error))
            raise error from record_error
        raise
    settle(run, record, 'relocated-consume', 'qualified', **{
                   'reduction_sha256': relocated_result['reduction_sha256']})
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
        if not args.expected_archive_sha256:
            raise SystemExit('--archive requires --expected-archive-sha256, the admitted archive identity')
        target = run / 'readback'
        audit = run / 'archive-audit'

        def observe_archive():
            """Extract the admitted archive and read the envelope it carries."""
            settle(run, record, 'archive-retained', 'attempted',
                   source=str(args.archive), expected_sha256=args.expected_archive_sha256)
            shutil.copyfile(args.archive, run / 'original-archive.tar.gz')
            retained_input = run / 'original-archive.tar.gz'
            observed = digest(retained_input)
            if observed != args.expected_archive_sha256:
                raise SystemExit('the retained archive does not match the admitted identity: '
                                 + observed + ' against ' + args.expected_archive_sha256)
            settle(run, record, 'archive-retained', 'verified',
                   retained='original-archive.tar.gz', sha256=observed,
                   provenance=str(args.archive),
                   scope='the archive bytes are retained before extraction and extracted from '
                         'the retained copy; the external path stays provenance')
            settle(run, record, 'archive-extracted', 'attempted', source='original-archive.tar.gz',
                   target=str(target))
            with tarfile.open(retained_input, 'r:gz') as archive:
                members = archive.getmembers()
                # Complete preflight first: every member is checked and the admitted
                # manifest member is located before a single member is extracted.
                kinds = {}
                for member in members:
                    name = member.name
                    relative = pathlib.PurePosixPath(name)
                    if (name != relative.as_posix() or relative.is_absolute()
                            or '..' in relative.parts or member.issym() or member.islnk()
                            or not (member.isfile() or member.isdir())):
                        raise SystemExit('the archive holds an unsupported or unsafe member: ' + name)
                    if name in kinds:
                        raise SystemExit('the archive names a member twice: ' + name)
                    kinds[name] = 'directory' if member.isdir() else 'file'
                for name, kind in kinds.items():
                    prefix = name
                    while '/' in prefix:
                        prefix = prefix.rsplit('/', 1)[0]
                        if kinds.get(prefix) == 'file':
                            raise SystemExit('the archive uses a file as a directory: ' + prefix)
                roots = sorted({name.split('/', 1)[0] for name in kinds})
                if len(roots) != 1:
                    raise SystemExit('the archive does not hold exactly one root: ' + repr(roots))
                selected_root = roots[0]
                manifest_member = selected_root + '/manifest.json'
                if kinds.get(manifest_member) != 'file':
                    raise SystemExit('the archive does not hold the admitted manifest member: '
                                     + manifest_member)
                for member in members:
                    archive.extract(member, target)
            settle(run, record, 'archive-extracted', 'verified', target=str(target),
                   members=len(members), manifest_member=manifest_member)
            manifest_path = target / manifest_member
            manifest = json.loads(manifest_path.read_text())
            if selected_root != manifest.get('archive_root'):
                raise SystemExit('the archive root does not match the manifest')
            archived = manifest_path.parent / 'controls-evidence'
            if not archived.is_dir():
                raise SystemExit('the archive holds no controls evidence member')
            documents = (manifest.get('gates', {}).get('controls', {})
                         .get('archived', {}).get('documents') or {})
            if sorted(documents) != sorted(package.ARCHIVE_METADATA):
                raise SystemExit('the archive manifest does not bind both metadata documents')
            settle(run, record, 'archive-admitted', 'attempted', root=selected_root,
                   documents=sorted(documents))
            current, bound = package.verify_archived_inventory(archived, result['inventory'],
                                                               documents)
            audit.mkdir(exist_ok=True)
            envelope = package.controls_evidence(archived, package.snapshot(), args.bend,
                                                archived=True, documents=documents,
                                                audit=audit)
            if envelope['reduction_sha256'] != result['reduction_sha256']:
                raise SystemExit('the archived envelope produced a different stable reduction')
            expected_ids = sorted(str(verdict.get('id'))
                                  for verdict in (envelope.get('classifier') or {})
                                  .get('verdicts') or [])
            # Every selected case must have its own retained acquisition: the
            # request, both raw streams and the terminal record under the stem the
            # classifier writer itself uses, with the recorded digests agreeing.
            uncovered = []
            verdicts = {str(verdict.get('id')): verdict
                        for verdict in (envelope.get('classifier') or {}).get('verdicts') or []}
            terminals = {}
            for identity in expected_ids:
                stem = package.acquisition_stem(identity)
                terminal_path = audit / (stem + '.acquisition.json')
                if not terminal_path.is_file():
                    uncovered.append(identity)
                    continue
                terminal = json.loads(terminal_path.read_text())
                terminals[identity] = terminal
                # The request is the case this run asked about.
                request = json.loads((audit / (stem + '.request.json')).read_text())
                if (request.get('case') or {}).get('id') != identity:
                    raise SystemExit('a retained request names another case: ' + identity)
                # Both raw streams are the bytes their terminal record describes,
                # with the digest taken from the buffer that was measured.
                for suffix, field in (('.stdout', 'stdout'), ('.stderr', 'stderr')):
                    stream_path = audit / (stem + suffix)
                    if not stream_path.is_file():
                        raise SystemExit('a retained acquisition stream is missing: '
                                         + stream_path.name)
                    data = stream_path.read_bytes()
                    if (len(data) != terminal.get(field + '_bytes')
                            or hashlib.sha256(data).hexdigest() != terminal.get(field + '_sha256')):
                        raise SystemExit('a retained acquisition stream disagrees with its '
                                         'terminal record: ' + stream_path.name)
                # The reported verdict is the one this acquisition recorded, and
                # the envelope's acquisition record is this terminal.
                verdict = verdicts.get(identity)
                if verdict is None:
                    raise SystemExit('the readback reported no verdict for a retained case: '
                                     + identity)
                if (verdict.get('acquisition') or {}) != terminal:
                    raise SystemExit('a retained terminal acquisition differs from the verdict '
                                     'acquisition: ' + identity)
                for field in ('state', 'exit_code', 'signal', 'spawn_error'):
                    if terminal.get(field) != (verdict.get('acquisition') or {}).get(field):
                        raise SystemExit('a retained terminal process field differs from the '
                                         'verdict: ' + field)
            if uncovered:
                raise SystemExit('the acquisition omits selected cases: ' + repr(uncovered))
            records = sorted(entry.name for entry in audit.rglob('*') if entry.is_file())
            if not records:
                raise SystemExit('the archived readback retained no acquisition file')
            audit_inventory = package.producer_inventory(audit)
            bound_audit = (envelope.get('audit') or {})
            if audit_inventory['inventory_sha256'] != bound_audit.get('inventory_sha256'):
                raise SystemExit('the current acquisition inventory differs from the one the '
                                 'retained envelope binds')
            # Retain the original archive and metadata bytes, and the complete returned
            # envelope bound to this stage rather than only a count of any files.
            metadata = run / 'archive-metadata'
            metadata.mkdir(exist_ok=True)
            for name in package.ARCHIVE_METADATA:
                shutil.copyfile(archived / name, metadata / name)
            # The retained copies are checked against the admitted identity, not
            # only the reader's own later observation.
            kept_archive = digest(retained_input)
            if kept_archive != args.expected_archive_sha256:
                raise SystemExit('the retained archive copy differs from the admitted identity')
            for name in package.ARCHIVE_METADATA:
                if digest(metadata / name) != documents[name]:
                    raise SystemExit('the retained metadata copy differs from the admitted '
                                     'identity: ' + name)
            envelope_path = run / 'archive-envelope.json'
            envelope_path.write_text(json.dumps(envelope, indent=2) + '\n')
            return {'root': selected_root, 'manifest_member': manifest_member,
                    'members': len(current['members']),
                    'documents': sorted(documents), 'archive': str(args.archive),
                    'archive_sha256': observed,
                    'extraction_target': str(target),
                    'extracted_acquisition': str(audit),
                    'extracted_acquisition_records': len(records),
                    'expected_verdict_ids': expected_ids,
                    'audit_records_uncovered_ids': uncovered,
                    'audit_inventory_sha256': audit_inventory['inventory_sha256'],
                    'envelope': str(envelope_path.relative_to(run)),
                    'envelope_sha256': digest(envelope_path),
                    'original_archive': 'original-archive.tar.gz',
                    'metadata': sorted(str(row.relative_to(run))
                                       for row in metadata.iterdir()),
                    'documents_staged_scope': 'this readback hashes extracted bytes and keeps '
                                              'the original archive bytes; the package staged '
                                              'record is separate'}

        attempt(run, record, 'archive-readback', observe_archive,
                archive=str(args.archive),
                expected_archive_sha256=args.expected_archive_sha256,
                extraction_target=str(target), audit_scope=str(audit))
    if args.receipt:
        def observe_receipt():
            """Validate a supplied receipt against the fresh reduction."""
            logs = run / 'receipt-logs'
            logs.mkdir(exist_ok=True)
            destination, receipt = package.reuse_gates(pathlib.Path(args.receipt),
                                                       args.receipt_sha256, args.bend, logs,
                                                       package.snapshot())
            fresh = receipt.get('controls_evidence') or {}
            if fresh.get('reduction_sha256') != result['reduction_sha256']:
                raise SystemExit('the reused receipt names a different stable reduction')
            return {'scope': 'receipt summary and logs against the fresh reduction; '
                             'distinct from archive-fed full package reuse',
                    'receipt': str(destination)}

        attempt(run, record, 'receipt-validation', observe_receipt,
                receipt=str(args.receipt), receipt_sha256=args.receipt_sha256,
                output_scope='gates receipts and logs under ' + str(run / 'receipt-logs'))
    settle(run, record, 'recipe', 'complete', children=len(record))
    print('recipe complete; child receipts and streams are under ' + str(run))


if __name__ == '__main__':
    main()
