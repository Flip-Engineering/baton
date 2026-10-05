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
import tarfile
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'bend2/scripts/laws-check.mjs'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stream_record(path, run=None):
    """One observed child stream, or an explicit unavailable observation.

    This guards OSError from the stream reads only: a missing or unreadable stream
    is recorded as unavailable instead of raising, so the accounting step does not
    replace the exception already being reported. Other failure kinds are not
    caught here.
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
            attach_secondary(error, 'record_error', record_error)
            raise error from record_error
        raise
    for stream, path in (('stdout', stdout), ('stderr', stderr)):
        entry[stream] = stream_record(path, run)
    settle(run, record, name, entry.get('outcome', 'completed'), **{
        key: value for key, value in entry.items() if key not in ('name', 'outcome')})
    return entry


def write_record(directory, record):
    """Replace the stage record atomically, keeping the previous rows intact.

    The replacement is written beside the record and swapped into place, so a
    partial write cannot truncate rows this run already settled. This is an
    immediate replacement, not a crash or power-loss durability protocol: no
    fsync or publication step is claimed.
    """
    path = directory / 'run.json'
    staged = directory / 'run.json.next'
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


def bind_response_to_verdict(response, verdict, identity):
    """Compare a retained endpoint response with the readback's verdict.

    The endpoint emits its raw verifier map and the reader's composition stores
    the canonical closure, so the response verifier is normalized through the same
    member contract before the comparison, and a raw identity the verdict retains
    is compared with the raw response. The endpoint evidence fields are compared
    as the reader reports them; only reader-added fields stay outside this contract.
    """
    package = package_handle()
    # Each endpoint evidence field the readback reports is compared with
    # the retained response; only the reader-added fields stay separate.
    for field in ('class', 'attributed_law', 'match', 'qualified', 'law',
                  'evidence_verified'):
        if response.get(field) != verdict.get(field):
            raise StageFailure('a retained response field differs from the reported '
                               'verdict: ' + field + ' for ' + identity,
                               fields={'case': identity, 'boundary': 'response-' + field})
    # The endpoint emits its raw verifier map and the reader's composition
    # stores the canonical closure, so the response is normalized through
    # the same member contract before the comparison. A raw identity the
    # verdict retains is still compared with the raw response.
    response_verifier = response.get('verifier')
    if not isinstance(response_verifier, dict):
        raise StageFailure('a retained response names no verifier map: ' + identity,
                           fields={'case': identity, 'boundary': 'response-verifier'})
    try:
        normalized = {member: package.verifier_member_value(
            response_verifier, member, identity)
            for member in package.VERIFIER_MEMBERS}
    except RuntimeError as error:
        # The member contract refuses with RuntimeError; that refusal is this
        # boundary's failure.
        raise StageFailure('a retained response verifier is not a valid closure: '
                           + identity + ': ' + str(error),
                           fields={'case': identity, 'boundary': 'response-verifier'})
    except BaseException as error:
        # Any other interruption keeps its own type and object, with the boundary
        # facts attached.
        reported = dict(getattr(error, 'fields', None) or {})
        reported.setdefault('case', identity)
        reported.setdefault('operation', 'response-verifier')
        setattr(error, 'fields', reported)
        raise
    if normalized != verdict.get('verifier'):
        raise StageFailure('a retained response verifier differs from the reported '
                           'verdict: ' + identity,
                           fields={'case': identity, 'boundary': 'response-verifier'})
    raw_verifier = verdict.get('verifier_raw')
    if raw_verifier is not None and raw_verifier != response_verifier:
        raise StageFailure('a retained response differs from the raw verifier the '
                           'verdict retains: ' + identity,
                           fields={'case': identity, 'boundary': 'response-verifier-raw'})
    if response.get('diagnostic_sha256') != verdict.get('diagnostic_sha256'):
        raise StageFailure('a retained response diagnostic differs from the reported '
                           'verdict: ' + identity,
                           fields={'case': identity, 'boundary': 'response-diagnostic'})


def extract_archive(directory, record, retained_input, target):
    """Open the retained archive, preflight it, extract it and read its manifest.

    Every member is checked and the admitted manifest member is located before a
    single member is extracted. The extraction phase settles its own verified or
    failed result, keeps the member being handled and the extraction target state
    on a failure, and reports the members it actually completed.
    """
    settle(directory, record, 'archive-extracted', 'attempted',
           source=retained_input.name, target=str(target))
    extracted = []
    attempted_member = None
    try:
        with tarfile.open(retained_input, 'r:gz') as archive:
            members = archive.getmembers()
            kinds = {}
            for member in members:
                name = member.name
                relative = pathlib.PurePosixPath(name)
                if (name != relative.as_posix() or relative.is_absolute()
                        or '..' in relative.parts or member.issym() or member.islnk()
                        or not (member.isfile() or member.isdir())):
                    raise StageFailure('the archive holds an unsupported or unsafe member: '
                                       + name,
                                       fields={'member': name,
                                               'boundary': 'archive-member-kind'})
                if name in kinds:
                    raise StageFailure('the archive names a member twice: ' + name,
                                       fields={'member': name,
                                               'boundary': 'archive-member-kind'})
                kinds[name] = 'directory' if member.isdir() else 'file'
            for name in sorted(kinds):
                prefix = name
                while '/' in prefix:
                    prefix = prefix.rsplit('/', 1)[0]
                    if kinds.get(prefix) == 'file':
                        raise StageFailure('the archive uses a file as a directory: ' + prefix,
                                           fields={'member': prefix,
                                                   'boundary': 'archive-member-kind'})
            roots = sorted({name.split('/', 1)[0] for name in kinds})
            if len(roots) != 1:
                raise StageFailure('the archive does not hold exactly one root: ' + repr(roots),
                                   fields={'roots': list(roots), 'boundary': 'archive-root'})
            selected_root = roots[0]
            manifest_member = selected_root + '/manifest.json'
            if kinds.get(manifest_member) != 'file':
                raise StageFailure('the archive does not hold the admitted manifest member: '
                                   + manifest_member,
                                   fields={'member': manifest_member,
                                           'boundary': 'archive-manifest-member'})
            # Only after the complete preflight is every member extracted.
            for member in members:
                attempted_member = member.name
                archive.extract(member, target)
                extracted.append(member.name)
                attempted_member = None
    except BaseException as error:
        target_present = None
        try:
            target_present = target.is_dir()
        except OSError as accounting_error:
            attach_secondary(error, 'accounting_error', accounting_error)
        reported = dict(getattr(error, 'fields', None) or {})
        reported.setdefault('members_extracted', len(extracted))
        reported.setdefault('members_extracted_names', list(extracted))
        if attempted_member is not None:
            reported.setdefault('failing_member', attempted_member)
        reported.setdefault('target', str(target))
        reported.setdefault('target_present', target_present)
        if getattr(error, 'accounting_error', None) is not None:
            reported.setdefault('accounting_error_text', repr(error.accounting_error))
        # The observations the phase reached are attached to the original work
        # object before the fallible recording, so they survive a failed write.
        setattr(error, 'fields', reported)
        try:
            settle(directory, record, 'archive-extracted', 'failed', **reported,
                   failure=repr(error), failure_type=type(error).__name__)
        except BaseException as record_error:
            attach_secondary(error, 'record_error', record_error)
            raise error from record_error
        raise
    record_verified(directory, record, 'archive-extracted', target=str(target),
                    members=len(members), manifest_member=manifest_member)
    return {'root': selected_root, 'manifest_member': manifest_member,
            'members': len(members)}


def record_verified(directory, record, name, **fields):
    """Settle a verified row, keeping a failed write from losing the outcome.

    These callers settle directly rather than through attempt, so the successful
    work attributes are attached to the recording error here.
    """
    try:
        settle(directory, record, name, 'verified', **fields)
    except BaseException as record_error:
        setattr(record_error, 'stage', name)
        setattr(record_error, 'stage_outcome', 'verified')
        setattr(record_error, 'stage_value', dict(fields))
        raise


def settle(directory, record, name, outcome, **fields):
    """Settle one stage row and persist it before anything else can fail.

    The row can be declared before its fallible work and settled again afterwards,
    so an observation this run already made is on disk before a later stage failure
    cannot erase it.
    """
    entry = {'name': name, 'outcome': outcome, **fields}
    for position, existing in enumerate(record):
        if existing.get('name') == name:
            record[position] = {**existing, **entry}
            break
    else:
        record.append(entry)
    write_record(directory, record)
    return record[-1] if record[-1].get('name') == name else entry


class StageFailure(SystemExit):
    """A stage stopped partway, naming what it reached and where it stopped."""

    def __init__(self, message, fields=None, partial=()):
        super().__init__(message)
        self.fields = dict(fields or {})
        self.partial = list(partial)


def attach_secondary(error, key, value):
    """Attach an ordered secondary observation to the primary work exception.

    The work exception stays primary. A later recording or cleanup failure never
    overwrites an earlier secondary observation: the first keeps the key and later
    ones are appended to its chain in the order they happened.
    """
    if not hasattr(error, key):
        setattr(error, key, value)
        setattr(error, key + '_text', repr(value))
        return
    chain = getattr(error, key + '_chain', None)
    if chain is None:
        chain = []
        setattr(error, key + '_chain', chain)
    chain.append(value)


def attempt(directory, record, name, work, **declared):
    """Run one stage with its identity declared first and settled on each exit.

    Each settlement replaces the run record. An attempted row is on disk only
    after its own write succeeds, so a stage whose first write fails leaves no
    attempted row, and a stage whose later write fails leaves the row that was
    last written. Retry or retry-on-crash behaviour is not part of this helper.

    The original exception is raised with any recording error attached, so a
    failure to persist the terminal row never replaces the cause it was recording.
    """
    settle(directory, record, name, 'attempted', **declared)
    try:
        value = work()
    except BaseException as error:
        try:
            # A stage that reports how far it got keeps those identities on its
            # failure row, so a partial result is not lost with the failure. A stage
            # that reports nothing partial records no partial identity.
            reported = dict(getattr(error, 'fields', None) or {})
            partial = getattr(error, 'partial', None)
            if partial:
                reported['partial_staged'] = list(partial)
            settle(directory, record, name, 'failed', **reported,
                   failure=repr(error), failure_type=type(error).__name__)
        except BaseException as record_error:
            attach_secondary(error, 'record_error', record_error)
            raise error from record_error
        raise
    try:
        settle(directory, record, name, 'verified', **(value if isinstance(value, dict) else {}))
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


_PACKAGE = None


def package_handle():
    """The production package module, loaded once for the module-level helpers."""
    global _PACKAGE
    if _PACKAGE is None:
        _PACKAGE = package_module()
    return _PACKAGE


def stage_metadata(directory, record, archived, retained_input, metadata,
                   expected_archive_sha256, documents):
    """Retain the archive and metadata bytes bound to this stage.

    What was copied, what is being copied and what has been verified are separate
    observations: a copied destination is not a verified one.
    """
    package = package_handle()
    metadata.mkdir(exist_ok=True)
    copied = []
    attempted = None
    verifying = None
    verified = []
    try:
        for name in package.ARCHIVE_METADATA:
            attempted = name
            shutil.copyfile(archived / name, metadata / name)
            copied.append(name)
            attempted = None
        # The retained copies are checked against the admitted identity, not only
        # the reader's own later observation.
        kept_archive = digest(retained_input)
        if kept_archive != expected_archive_sha256:
            raise StageFailure(
                'the retained archive copy differs from the admitted identity',
                fields={'boundary': 'retained-archive',
                        'retained_sha256': kept_archive,
                        'metadata_verified': list(verified)})
        for name in package.ARCHIVE_METADATA:
            verifying = name
            if digest(metadata / name) != documents[name]:
                raise StageFailure(
                    'the retained metadata copy differs from the admitted identity: ' + name,
                    fields={'boundary': 'retained-metadata',
                            'metadata_member': name,
                            'metadata_verified': list(verified)})
            verified.append(name)
            verifying = None
        return {'documents_copied': sorted(copied),
                'documents_verified': sorted(verified),
                'retained_archive_sha256': kept_archive,
                'metadata': sorted(str(row.relative_to(directory))
                                   for row in metadata.iterdir())}
    except BaseException as error:
        reported = dict(getattr(error, 'fields', None) or {})
        reported.setdefault('documents_copied', sorted(copied))
        reported.setdefault('documents_verified', sorted(verified))
        if attempted:
            reported['copy_attempted'] = attempted
        if verifying:
            reported['metadata_verifying'] = verifying
        if getattr(error, 'accounting_error', None) is not None:
            reported['accounting_error_text'] = repr(error.accounting_error)
        setattr(error, 'fields', reported)
        setattr(error, 'partial', sorted(copied))
        raise


def write_envelope(directory, record, envelope, envelope_path):
    """Write the complete returned envelope and hash the bytes that were written."""
    relative = str(envelope_path.relative_to(directory))
    operation = 'envelope-write'
    try:
        envelope_path.write_text(json.dumps(envelope, indent=2) + '\n')
        operation = 'envelope-sha256'
        return {'envelope': relative, 'envelope_sha256': digest(envelope_path)}
    except BaseException as error:
        present = None
        size = None
        try:
            present = envelope_path.is_file()
            size = envelope_path.stat().st_size if present else None
        except OSError as accounting_error:
            attach_secondary(error, 'accounting_error', accounting_error)
        setattr(error, 'fields', {
            'envelope': relative,
            'operation': operation,
            'envelope_present': present,
            'envelope_bytes': size,
            'accounting_error_text': (repr(error.accounting_error)
                                      if getattr(error, 'accounting_error', None) else None),
            'boundary': 'archive-envelope'})
        raise


def bind_case_acquisitions(audit, expected_ids, verdicts):
    """Bind each selected case's retained acquisition to its verdict.

    One selected case is bound at a time: the request bytes, both raw streams and
    the terminal record under the stem the classifier writer itself uses, with the
    recorded digests, the verdict acquisition equality and the response contract.
    A failure names the case and the operation it failed at on the original
    exception. Cases with no terminal record are reported as uncovered.
    """
    uncovered = []
    if len(verdicts) != len(expected_ids):
        raise SystemExit('the readback reports a repeated or missing verdict identity')
    for identity in expected_ids:
        operation = 'terminal-record'
        try:
            operation = 'terminal-record'
            stem = package_handle().acquisition_stem(identity)
            terminal_path = audit / (stem + '.acquisition.json')
            if not terminal_path.is_file():
                uncovered.append(identity)
                continue
            terminal = json.loads(terminal_path.read_text())
            # The request bytes are the ones the terminal record describes, and
            # the parsed request is the case this run asked about.
            operation = 'request-bytes'
            request_data = (audit / (stem + '.request.json')).read_bytes()
            if (len(request_data) != terminal.get('request_bytes')
                    or hashlib.sha256(request_data).hexdigest()
                    != terminal.get('request_sha256')):
                raise StageFailure(
                    'a retained request disagrees with its terminal record: ' + identity,
                    fields={'case': identity, 'boundary': 'request-bytes'})
            operation = 'request-parse'
            request = json.loads(request_data)
            if (request.get('case') or {}).get('id') != identity:
                raise StageFailure('a retained request names another case: ' + identity,
                               fields={'case': identity, 'boundary': 'request-case'})
            # Both raw streams are the bytes their terminal record describes,
            # with the digest taken from the buffer that was measured.
            streams = {}
            for suffix, field in (('.stdout', 'stdout'), ('.stderr', 'stderr')):
                operation = field + '-stream'
                stream_path = audit / (stem + suffix)
                if not stream_path.is_file():
                    raise StageFailure('a retained acquisition stream is missing: '
                                       + stream_path.name,
                                       fields={'case': identity, 'boundary': field + '-stream'})
                data = stream_path.read_bytes()
                if (len(data) != terminal.get(field + '_bytes')
                        or hashlib.sha256(data).hexdigest() != terminal.get(field + '_sha256')):
                    raise StageFailure('a retained acquisition stream disagrees with its '
                                       'terminal record: ' + stream_path.name,
                                       fields={'case': identity, 'boundary': field + '-stream'})
                streams[field] = data
            # The reported verdict is the one this acquisition recorded, and
            # the envelope's acquisition record is this terminal.
            verdict = verdicts.get(identity)
            if verdict is None:
                raise StageFailure(
                    'the readback reported no verdict for a retained case: ' + identity,
                    fields={'case': identity, 'boundary': 'verdict-present'})
            if (verdict.get('acquisition') or {}) != terminal:
                raise StageFailure(
                    'a retained terminal acquisition differs from the verdict acquisition: '
                    + identity,
                    fields={'case': identity, 'boundary': 'terminal-equality'})
            # The whole-terminal equality above already covers the process fields.
            # The retained response is the verdict the readback reported, with the
            # reader's own added fields kept separate from the endpoint contract.
            # The response is parsed from the buffer already verified against the
            # terminal record, so the bytes read and the bytes parsed are one.
            operation = 'response-parse'
            lines = [line for line in streams['stdout'].decode('utf-8').splitlines()
                     if line.strip()]
            if len(lines) != 1:
                raise StageFailure('a retained response is not one line: ' + identity,
                                   fields={'case': identity, 'boundary': 'response-line'})
            response = json.loads(lines[0])
            if (response.get('id') != identity
                    or response.get('schema') != 'capacity-controls/classify-verdict@1'):
                raise StageFailure('a retained response names another case or schema: '
                                   + identity,
                                   fields={'case': identity, 'boundary': 'response-identity'})
            bind_response_to_verdict(response, verdict, identity)
        except StageFailure:
            raise
        except BaseException as error:
            # The case and the operation being performed are attached to
            # the original exception, which stays the reported cause.
            reported = dict(getattr(error, 'fields', None) or {})
            reported.setdefault('case', identity)
            reported.setdefault('operation', operation)
            setattr(error, 'fields', reported)
            raise
    if uncovered:
        raise StageFailure('the acquisition omits selected cases: '
                           + repr(uncovered),
                           fields={'cases': list(uncovered),
                                   'boundary': 'terminal-record'})
    return {'cases_checked': len(expected_ids),
            'cases_uncovered': list(uncovered),
            'acquisition_directory': str(audit)}



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
            attach_secondary(error, 'record_error', record_error)
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
            attach_secondary(error, 'record_error', record_error)
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
        if not args.expected_archive_sha256:
            raise SystemExit('--archive requires --expected-archive-sha256, the admitted archive identity')
        target = run / 'readback'
        audit = run / 'archive-audit'

        def observe_archive():
            """Extract the admitted archive and read the envelope it carries."""
            settle(run, record, 'archive-retained', 'attempted',
                   source=str(args.archive), expected_sha256=args.expected_archive_sha256)
            retained_input = run / 'original-archive.tar.gz'
            try:
                shutil.copyfile(args.archive, retained_input)
                observed = digest(retained_input)
                if observed != args.expected_archive_sha256:
                    raise SystemExit('the retained archive does not match the admitted identity: '
                                     + observed + ' against ' + args.expected_archive_sha256)
            except BaseException as error:
                # An accounting read that fails leaves an explicit unavailable
                # observation and is not the same as a failure to record the row.
                retained_present = None
                retained_sha256 = None
                try:
                    retained_present = retained_input.is_file()
                    if retained_present:
                        retained_sha256 = digest(retained_input)
                except OSError as accounting_error:
                    attach_secondary(error, 'accounting_error', accounting_error)
                try:
                    settle(run, record, 'archive-retained', 'failed',
                           retained=retained_input.name,
                           retained_present=retained_present,
                           retained_sha256=retained_sha256,
                           accounting_error_text=(repr(error.accounting_error)
                                                  if getattr(error, 'accounting_error', None)
                                                  else None),
                           failure=repr(error))
                except BaseException as record_error:
                    attach_secondary(error, 'record_error', record_error)
                    raise error from record_error
                raise
            record_verified(run, record, 'archive-retained',
                            retained='original-archive.tar.gz', sha256=observed,
                            provenance=str(args.archive),
                            scope='the archive bytes are retained before extraction and '
                                  'extracted from the retained copy; the external path stays '
                                  'provenance')
            extracted_facts = extract_archive(run, record, retained_input, target)
            selected_root = extracted_facts['root']
            manifest_member = extracted_facts['manifest_member']
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
            try:
                current, bound = package.verify_archived_inventory(archived, result['inventory'],
                                                                   documents)
            except BaseException as error:
                try:
                    settle(run, record, 'archive-admitted', 'failed', root=selected_root,
                           documents=sorted(documents), failure=repr(error),
                           failure_type=type(error).__name__)
                except BaseException as record_error:
                    attach_secondary(error, 'record_error', record_error)
                    raise error from record_error
                raise
            record_verified(run, record, 'archive-admitted', root=selected_root,
                            documents=sorted(documents), members=len(current['members']))
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
            if len(expected_ids) != len(set(expected_ids)):
                raise SystemExit('the readback reports a case identity twice: '
                                 + repr(expected_ids))
            verdicts = {str(verdict.get('id')): verdict
                        for verdict in (envelope.get('classifier') or {})
                        .get('verdicts') or []}
            bound_cases = attempt(
                run, record, 'archive-case-acquisition',
                lambda: bind_case_acquisitions(audit, expected_ids, verdicts),
                expected_cases=len(expected_ids),
                acquisition_directory=str(audit),
                scope='each selected case retains its request, both raw streams and '
                      'terminal record, bound to its verdict')
            # Each later phase settles its own result where it happens, so a failure
            # in one of them is recorded at that boundary with what it did reach.
            def compare_inventory():
                records = sorted(entry.name for entry in audit.rglob('*')
                                 if entry.is_file())
                if not records:
                    raise SystemExit('the archived readback retained no acquisition file')
                inventory = package.producer_inventory(audit)
                bound_audit = (envelope.get('audit') or {})
                if inventory['inventory_sha256'] != bound_audit.get('inventory_sha256'):
                    raise SystemExit('the current acquisition inventory differs from the one '
                                     'the retained envelope binds')
                return {'records': records, 'inventory_sha256': inventory['inventory_sha256']}

            acquired = attempt(run, record, 'archive-inventory-compared', compare_inventory,
                               audit_directory=str(audit),
                               scope='the current listing and inventory of the reader-written '
                                     'acquisition directory, compared with the inventory the '
                                     'retained envelope binds; the per-case acquisition reads '
                                     'settle separately in archive-case-acquisition')
            records = acquired['records']

            staged = attempt(
                run, record, 'archive-metadata-staged',
                lambda: stage_metadata(run, record, archived, retained_input,
                                       run / 'archive-metadata',
                                       args.expected_archive_sha256, documents),
                archive=retained_input.name, root=selected_root,
                scope='copied destinations, the destination being copied and the '
                      'verified documents are separate observations')
            written = attempt(
                run, record, 'archive-envelope-written',
                lambda: write_envelope(run, record, envelope,
                                       run / 'archive-envelope.json'),
                document='archive-envelope.json',
                scope='the complete returned envelope, written to that file and '
                      'hashed from the written bytes')
            return {'root': selected_root, 'manifest_member': manifest_member,
                    'members': len(current['members']),
                    'documents': sorted(documents), 'archive': str(args.archive),
                    'archive_sha256': observed,
                    'extraction_target': str(target),
                    'extracted_acquisition': str(audit),
                    'extracted_acquisition_files': len(records),
                    'expected_verdict_ids': expected_ids,
                    'cases_bound': bound_cases['cases_checked'],
                    'audit_records_uncovered_ids': bound_cases['cases_uncovered'],
                    'audit_inventory_sha256': acquired['inventory_sha256'],
                    'envelope': written['envelope'],
                    'envelope_sha256': written['envelope_sha256'],
                    'original_archive': 'original-archive.tar.gz',
                    'metadata': staged['metadata'],
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
