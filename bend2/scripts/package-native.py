#!/usr/bin/env python3
"""Build a Darwin arm64 native artifact with exact-source gate evidence."""
import argparse
import base64
import datetime
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import subprocess
import tarfile
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_ROOT = 'baton2-development-darwin-arm64'
COMPILER_ARCHIVE_SHA256 = 'c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31'
COMPILER_ARCHIVE_URL = 'https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz'
COMPILER_LICENSE_URL = 'https://raw.githubusercontent.com/bendlang/bend/v2.0.25/LICENSE'
COMPILER_LICENSE_SHA256 = '0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35'
CONTEXT_PACKAGE_DIR = ROOT / 'bend2/context'
CONTEXT_STAGE_ROOT = 'libexec/baton2/context'
CONTEXT_PACKAGE_NAME = 'baton2-context'
CONTEXT_NODE_FLOOR = '>=22.15.0'
CONTEXT_DEPENDENCY_PINS = {'ajv': '8.17.1', 'typescript': '5.9.3', 'zod': '4.3.6'}
# License/notice files the LICENSE/NOTICE/COPYING prefix rule does not capture.
CONTEXT_EXTRA_NOTICES = {'typescript': ('ThirdPartyNoticeText.txt',)}
GATES = (
    ('build-native', ['sh', 'bend2/scripts/build-native.sh']),
    ('laws-check', ['node', 'bend2/scripts/laws-check.mjs']),
    ('check-native', ['sh', 'bend2/scripts/check-native.sh']),
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def file_info(path):
    return {'bytes': path.stat().st_size, 'sha256': sha256(path)}


def write_json(path, value):
    """Write value as indented JSON and return only after the completed write.

    The guarantee is a complete written and closed file before the caller
    proceeds; it is not crash or power-loss durability, and no fsync is added.
    """
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def snapshot():
    binary = ROOT / '.scratch/bend2/baton2'
    return {
        'head': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
        'bend2_tree': git('rev-parse', 'HEAD:bend2'),
        'status': git('status', '--porcelain=v1'),
        'binary_sha256': sha256(binary) if binary.is_file() else None,
    }


def same_source(observed, expected):
    for key in ('head', 'tree', 'bend2_tree', 'status'):
        require(observed[key] == expected[key], 'Exact source changed: ' + key)
    require(not observed['status'], 'Packaging requires committed, clean source')


def command(argv, cwd, env, directory, name):
    stdout = directory / (name + '.stdout')
    stderr = directory / (name + '.stderr')
    started = time.monotonic()
    with stdout.open('wb') as out, stderr.open('wb') as err:
        result = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=err)
    receipt = {'argv': argv, 'cwd': str(cwd), 'exit_code': result.returncode,
               'elapsed_seconds': time.monotonic() - started,
               'stdout': {'path': stdout.name, **file_info(stdout)},
               'stderr': {'path': stderr.name, **file_info(stderr)}}
    write_json(directory / (name + '.json'), receipt)
    require(result.returncode == 0, 'Command failed; see ' + str(directory / (name + '.json')))
    return stdout.read_text(errors='replace').strip()


def executable(name):
    found = shutil.which(name)
    require(found is not None, 'Required executable is unavailable: ' + name)
    return Path(found).resolve()


def inputs(compiler, env, logs, phase):
    runtime = compiler.parent.parent / 'bend2'
    require(runtime.is_dir(), 'The selected Bend compiler needs its sibling bend2 library directory')
    tools = {}
    for name, requested in (('cc', env.get('CC', 'clang')), ('node', 'node'),
                            ('python', 'python3'), ('git', 'git'), ('sh', 'sh')):
        path = executable(requested)
        tools[name] = {'path': str(path), **file_info(path)}
        if name != 'sh':
            tools[name]['version'] = command([str(path), '--version'], ROOT, env, logs, phase + '-' + name)
    version = command([str(compiler), 'version'], ROOT, env, logs, phase + '-bend')
    require(version == 'bend 2.0.25', 'The artifact requires Bend 2.0.25')
    runtime_files = [{'path': path.relative_to(runtime).as_posix(), **file_info(path)}
                     for path in sorted(runtime.rglob('*')) if path.is_file()]
    selected_clang = Path(command(['xcrun', '--find', 'clang'], ROOT, env, logs, phase + '-selected-clang')).resolve()
    return {'compiler': {'path': str(compiler), 'version': version, **file_info(compiler)},
            'runtime': {'directory': str(runtime), 'files': runtime_files}, 'tools': tools,
            'xcode': {'directory': command(['xcode-select', '-p'], ROOT, env, logs, phase + '-xcode-directory'),
                      'selected_clang': {'path': str(selected_clang), **file_info(selected_clang)},
                      'sdk_directory': command(['xcrun', '--show-sdk-path'], ROOT, env, logs, phase + '-sdk-directory'),
                      'sdk_version': command(['xcrun', '--show-sdk-version'], ROOT, env, logs, phase + '-sdk-version')},
            'os': {'system': platform.system(), 'machine': platform.machine(),
                   'uname': list(platform.uname()),
                   'sw_vers': command(['sw_vers'], ROOT, env, logs, phase + '-sw-vers')},
            'runner': {name: os.environ[name] for name in
                       ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH',
                        'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT') if name in os.environ}}


def archive_inputs(archive, compiler):
    require(sha256(archive) == COMPILER_ARCHIVE_SHA256, 'Compiler archive does not match the tracked Darwin arm64 pin')
    inventory, notices = [], []
    with tarfile.open(archive, 'r:gz') as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts, 'Unsafe compiler archive member: ' + member.name)
            row = {'path': member.name, 'kind': member.type.decode('ascii'), 'bytes': member.size,
                   'link': member.linkname or None}
            if member.isfile():
                data = source.extractfile(member).read()
                row['sha256'] = hashlib.sha256(data).hexdigest()
                if member.name == 'bend/bin/bend':
                    require(row['sha256'] == sha256(compiler), 'Installed Bend executable differs from the pinned archive')
                elif member.name.startswith('bend/bend2/'):
                    installed = compiler.parent.parent / member.name.removeprefix('bend/')
                    require(installed.is_file() and sha256(installed) == row['sha256'],
                            'Installed Bend library differs from the pinned archive: ' + member.name)
                base = path.name.upper()
                if base in ('LICENSE', 'NOTICE', 'COPYING') or base.startswith(('LICENSE.', 'NOTICE.', 'COPYING.')):
                    notices.append((path, data))
            inventory.append(row)
    require(any(row['path'] == 'bend/bin/bend' and 'sha256' in row for row in inventory),
            'Compiler archive has no regular bend/bin/bend')
    installed = {path.relative_to(compiler.parent.parent).as_posix()
                 for path in (compiler.parent.parent / 'bend2').rglob('*') if path.is_file()}
    archived = {row['path'].removeprefix('bend/') for row in inventory
                if row['path'].startswith('bend/bend2/') and 'sha256' in row}
    require(installed == archived, 'Installed Bend library file set differs from the pinned archive')
    return {'url': COMPILER_ARCHIVE_URL, 'path': str(archive), **file_info(archive),
            'inventory': inventory}, notices


RECEIPT_SCHEMA = 'baton2-native-gate-receipt-v2'
ADMITTED_ENTRY = 'bend2/src/coordinator/main.bend'
INVENTORY_SCHEMA = 'baton2-controls-inventory-v1'
REDUCTION_SCHEMA = 'baton2-controls-reduction-v1'
CONTROL_SCRIPT = 'bend2/scripts/laws-check.mjs'
CONTROL_FIELDS = ('id', 'kind', 'law', 'module', 'definition_sha256')
# The endpoint verdict contract this package already consumes names six members.
# The ordinary producer run adds a seventh for the group-run module, which is
# validated separately so the endpoint closure stays exactly as it is.
VERIFIER_MEMBERS = ('checker_sha256', 'aggregate_module_sha256', 'classifier_module_sha256',
                    'work_set_module_sha256', 'laws_common_module_sha256',
                    'definitions_module_sha256')
# The producer owner declares the ordinary run verifier with seven members and
# these names, while the endpoint verdict closure keeps its own six names.
ORDINARY_RUN_VERIFIER_MEMBERS = ('checker_sha256', 'aggregate_module_sha256',
                                 'classify_module_sha256', 'work_set_module_sha256',
                                 'laws_common_module_sha256', 'definitions_module_sha256',
                                 'group_run_module_sha256')
ORDINARY_VERIFIER_FILES = {
    'checker_sha256': 'bend2/scripts/laws-check.mjs',
    'aggregate_module_sha256': 'bend2/scripts/capacity-controls/aggregate.mjs',
    'classify_module_sha256': 'bend2/scripts/capacity-controls/classify.mjs',
    'work_set_module_sha256': 'bend2/scripts/capacity-controls/work-set.mjs',
    'laws_common_module_sha256': 'bend2/scripts/laws-common.mjs',
    'definitions_module_sha256': 'bend2/scripts/laws-mutations.mjs',
    'group_run_module_sha256': 'bend2/scripts/capacity-controls/group-run.mjs'}
CHILD_FIELDS = ('exit_code', 'signal', 'spawn_error')
ORIGIN_FIELDS = ('workflow', 'run_id', 'run_attempt', 'jobs', 'image_os', 'image_version')


def binding_bytes(controls):
    """The binding serialization shared with the checker's bindingRows.

    Fields joined by TAB, rows by LF, no trailing newline, rows ordered by
    unsigned UTF-8 bytes. Rows are sorted as bytes rather than as strings so a
    non-ASCII id cannot order differently in the two languages.
    """
    rows = [b'\t'.join(control[field].encode('utf-8') for field in CONTROL_FIELDS)
            for control in controls]
    return b'\n'.join(sorted(rows))


def canonical_record_bytes(record):
    """The complete control record as canonical bytes, for identity.

    The set binding uses the checker's five-field serialization, which is the
    only cross-language byte contract. This is a Python-local identity layer over
    every field the discovery record carries (definition metadata and expectation
    included), so a name alone cannot join a record to another. Keys are sorted
    and the separators are fixed, so the digest depends only on the values. It is
    not claimed to equal a JavaScript serialization of the same record.
    """
    return json.dumps(record, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False).encode('utf-8')


def zero_exit(value):
    """A locally launched gate ended at integer status zero."""
    return type(value) is int and value == 0


def is_finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def discover_controls():
    """Read the control definitions through the checker's own discovery API."""
    script = ROOT / CONTROL_SCRIPT
    require(script.is_file(), 'The laws-check script is missing: ' + str(script))
    try:
        output = subprocess.check_output(['node', str(script), '--discover'], cwd=ROOT, text=True,
                                         stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError('The checker discovery API did not answer: ' + repr(error)) from error
    controls = []
    seen = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError('A checker discovery line is not a control record: '
                               + line[:120]) from error
        absent = [field for field in CONTROL_FIELDS if field not in record]
        require(not absent, 'A discovered control omits ' + ', '.join(absent) + ': '
                + json.dumps(record, sort_keys=True))
        require((ROOT / record['module']).is_file(),
                'A discovered control names a module outside this source: ' + str(record['module']))
        require(record['id'] not in seen,
                'The checker discovery listed a duplicate control id: ' + json.dumps(record['id']))
        seen[record['id']] = record
        controls.append(record)
    ordered = sorted(controls, key=lambda control: control['id'].encode('utf-8'))
    return {'controls': ordered, 'by_id': {control['id']: control for control in ordered},
            'sha256': hashlib.sha256(binding_bytes(ordered)).hexdigest()}


def native_suites():
    return sorted(path.relative_to(ROOT).as_posix()
                  for path in (ROOT / 'bend2' / 'test').glob('*.py'))


def control_rows(text):
    """Separate the per-control rows a complete laws-check run prints."""
    laws, mutations, other = [], [], 0
    for line in text.splitlines():
        line = line.strip()
        if not (line.startswith('{') and line.endswith('}')):
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and 'law' in row and 'module' in row and 'proof' in row:
            laws.append(row)
        elif isinstance(row, dict) and 'mutation' in row and 'law' in row:
            mutations.append(row)
        else:
            other += 1
    return laws, mutations, other


def parent_verdicts(text):
    """Map each identity the complete invocation printed to its own row.

    The checker classifies each compile itself and prints one row per control,
    plus a baseline row. These rows are the parent verdict authority for the
    ordinary route; they are never read from a retained child stream.
    """
    rows = {}
    baseline_rows = 0
    for line in text.splitlines():
        line = line.strip()
        if not (line.startswith('{') and line.endswith('}')):
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        if 'law' in row and 'module' in row and 'proof' in row:
            identity = 'proof:' + str(row['law'])
        elif 'mutation' in row and 'law' in row:
            identity = 'mutation:' + str(row['mutation'])
        elif row.get('check') == 'entry compiles with every law proven':
            identity = 'baseline'
            baseline_rows += 1
        else:
            continue
        require(identity not in rows,
                'The parent run printed more than one row for ' + json.dumps(identity))
        rows[identity] = row
    require(baseline_rows == 1,
            'The parent run printed ' + str(baseline_rows) + ' baseline rows')
    return rows


def require_all_rows(rows, predicate, message):
    rejected = [row for row in rows if not predicate(row)]
    if rejected:
        require(False, message + '; first: ' + json.dumps(rejected[0], sort_keys=True)
                + (' and ' + str(len(rejected) - 1) + ' more' if len(rejected) > 1 else ''))


def succinct(values, limit=3):
    return json.dumps(values[:limit]) + (' (+' + str(len(values) - limit) + ' more)'
                                         if len(values) > limit else '')


def reconcile_controls(expected, laws, mutations):
    """Bind the complete invocation's rows to the discovered controls.

    The complete invocation prints one row per control, and its exit status is
    the gate's authority. This reconciliation establishes that every discovered
    control reported exactly once with its refusal recorded.
    """
    controls = {control['id']: control for control in expected['controls']}
    wanted_laws = {(control['law'], control['module']): control
                   for control in controls.values() if control['kind'] == 'proof-removal'}
    wanted_mutations = {control['id'].removeprefix('mutation:'): control
                        for control in controls.values() if control['kind'] == 'mutation'}

    observed = [(row.get('law'), row.get('module')) for row in laws]
    duplicates = len(observed) - len(set(observed))
    require(duplicates == 0, str(duplicates) + ' duplicate law control rows')
    missing = sorted(set(wanted_laws) - set(observed))
    require(not missing, 'Missing law control rows: ' + succinct(missing))
    unexpected = sorted(set(observed) - set(wanted_laws))
    require(not unexpected, 'Law control rows absent from this source: ' + succinct(unexpected))
    require_all_rows(laws,
                     lambda row: row.get('passed') is True and row.get('gate') == 'refuses'
                     and row.get('proof') == 'removed',
                     'A law control row did not record an attributable refusal')

    seen = []
    for row in mutations:
        name = row.get('mutation')
        require(name in wanted_mutations,
                'Mutation control row absent from this source: ' + json.dumps(name))
        require(row.get('law') == wanted_mutations[name]['law'],
                'Mutation ' + json.dumps(name) + ' names a different law than this source')
        seen.append(name)
    duplicates = len(seen) - len(set(seen))
    require(duplicates == 0, str(duplicates) + ' duplicate mutation control rows')
    missing = sorted(set(wanted_mutations) - set(seen))
    require(not missing, 'Missing mutation control rows: ' + succinct(missing))
    require_all_rows(mutations,
                     lambda row: row.get('applied') is True and row.get('passed') is True
                     and row.get('gate') == 'refuses',
                     'A mutation control row did not record an applied attributable refusal')


ORDINARY_SCHEMA = 'capacity-controls/ordinary-evidence@2'
ORDINARY_RUN_SCHEMA = 'capacity-controls/ordinary-run@1'
# The checker writes this index under its run-private scratch and records stream
# paths relative to that scratch, so the evidence root is the directory holding
# the evidence directory and every member resolves below it.
ORDINARY_INDEX_MEMBERS = ('evidence', 'index.json')
ORDINARY_OPERATION = '--check-only'
ORDINARY_OUTCOME_STATES = ('exited', 'signalled', 'spawn-error', 'not-run')
ORDINARY_VERDICT_FIELDS = ('class', 'attributed_law', 'qualified')
# The envelope carries every identity field. The index records index_path and
# scratch at its top level and the remaining fields inside its run block, which
# is the layout the checker writes.
ORDINARY_IDENTITY_FIELDS = ('index_path', 'scratch', 'source', 'compiler', 'entry', 'origin',
                            'invocation', 'verifier')
ORDINARY_INDEX_TOP_FIELDS = ('index_path', 'scratch')
# Fields the producer records in the run envelope only; an index that omits them
# is bound by the envelope, and an index that carries them must agree with it.
ORDINARY_ENVELOPE_ONLY_FIELDS = ('index_path', 'scratch')
ORDINARY_RUN_FIELDS = ('source', 'compiler', 'entry', 'origin', 'invocation', 'verifier')
ORDINARY_INTENDED_CLASS = 'intended-law-refusal'


def ordinary_envelope(text):
    """Read the run envelope the checker prints as its first output line.

    The envelope carries the identity of the run that produced the index: the
    index path, its scratch root, the source pins, the compiler, the admitted
    entry, the producing origin, the unique invocation and the verifier digests.
    """
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith('{'):
            continue
        try:
            record = json.loads(line)
        except ValueError:
            raise RuntimeError('The checker first output line is not a JSON envelope')
        require(isinstance(record, dict) and record.get('schema') == ORDINARY_RUN_SCHEMA,
                'The checker first output line names another envelope: '
                + json.dumps(record.get('schema') if isinstance(record, dict) else None))
        absent = [field for field in ORDINARY_IDENTITY_FIELDS
                  if not isinstance(record.get(field), (dict, str)) or record.get(field) == '']
        require(not absent, 'The run envelope omits ' + ', '.join(absent))
        require(isinstance(record.get('invocation'), str)
                and record['invocation'].startswith('ordinary:'),
                'The run envelope names no ordinary invocation: '
                + json.dumps(record.get('invocation')))
        return record
    raise RuntimeError('The checker printed no run envelope')


def ordinary_root(index_path, declared=None):
    """Resolve and check the run-private evidence root the index belongs to."""
    path = require_real_path(index_path, 'The ordinary evidence index')
    require(path.is_file(), 'The ordinary evidence index is missing: ' + str(path))
    require(path.parts[-2:] == ORDINARY_INDEX_MEMBERS,
            'The ordinary evidence index is not at <run>/evidence/index.json: ' + str(path))
    root = require_real_path(path.parent.parent, 'The ordinary evidence run root')
    require(root.is_absolute() and root.is_dir(),
            'The ordinary evidence run root is not an absolute directory: ' + str(root))
    if declared is not None:
        require(Path(declared).resolve() == root.resolve(),
                'The declared ordinary run root disagrees with the index location: '
                + str(declared))
    return root


def ordinary_member(root, relative, label):
    """Resolve one recorded stream path below the run root, refusing symlinks.

    The recorded string is checked segment by segment before any path library
    normalizes it, so an empty, dot or parent segment is refused rather than
    silently removed, and no component of the walked path may be a symlink.
    """
    require(isinstance(relative, str) and relative, label + ' records no path')
    require(not relative.startswith('/'),
            label + ' records an absolute path: ' + json.dumps(relative))
    segments = relative.split('/')
    require(all(segment not in ('', '.', '..') for segment in segments),
            label + ' records an unqualified path: ' + json.dumps(relative))
    member = root
    for segment in segments:
        member = member / segment
        require(not member.is_symlink(), label + ' passes through a symlink: '
                + json.dumps(relative))
    require(member.is_file(), label + ' is missing: ' + json.dumps(relative))
    require(root.resolve() in member.resolve().parents,
            label + ' escapes the run root: ' + json.dumps(relative))
    return member


def evidence_root_identity(directory, label):
    """Record and check the identity of an evidence root before resolving it.

    Inside this repository the root and its ancestors must be real paths. Outside
    it the lexical and resolved identities are both recorded, so a caller's
    resolution never erases the identity the admission checks saw.
    """
    directory = Path(directory)
    require(directory.is_absolute(), label + ' is not an absolute path: ' + str(directory))
    require(not directory.is_symlink(), label + ' is a symlink: ' + str(directory))
    require(directory.is_dir(), label + ' is not a directory: ' + str(directory))
    inside = ROOT.resolve() in directory.resolve().parents
    if inside:
        require_real_path(directory, label)
    resolved = directory.resolve()
    return {'lexical': str(directory), 'resolved': str(resolved),
            'shifted': str(resolved) != str(directory),
            'ancestor_policy': ('repository-real-paths' if inside else 'external-recorded'),
            'ancestors': [{'lexical': str(parent), 'symlink': parent.is_symlink()}
                          for parent in directory.parents]}


def require_real_path(path, label):
    """Refuse a path whose own components are symbolic links."""
    path = Path(path)
    require(not path.is_symlink(), label + ' is a symlink: ' + str(path))
    for parent in path.parents:
        require(not parent.is_symlink(), label + ' passes through a symlink: ' + str(parent))
    return path


def verify_ordinary_graph(root, label):
    """Check the original evidence graph before any copy follows its links."""
    require_real_path(root, label + ' root')
    evidence = root / 'evidence'
    require_real_path(evidence, label + ' evidence directory')
    require(evidence.is_dir(), label + ' evidence path is not a directory: ' + str(evidence))
    for member in sorted(evidence.iterdir()):
        require_real_path(member, label + ' member')
        require(member.is_file(), label + ' member is not a regular file: ' + str(member))
    return root


def verify_ordinary_outcome(outcome, label):
    """Check the ordinary terminal record against the shared process contract.

    The shared validator accepts four states, a nonnegative integer exit for a
    normal exit, and a nonempty string for a signal or a spawn error. The
    ordinary route records the checker child outcome in that shape, so this
    shares the state semantics and invents no wrapper identity. An absent
    outcome is refused rather than skipped.
    """
    require(isinstance(outcome, dict), label + ' records no terminal outcome')
    require(set(outcome) == {'state', 'exit_code', 'signal', 'spawn_error'},
            label + ' names another outcome shape: ' + succinct(sorted(outcome)))
    state = outcome['state']
    require(state in ORDINARY_OUTCOME_STATES,
            label + ' names no terminal state: ' + json.dumps(state))
    code, signal, spawned = outcome['exit_code'], outcome['signal'], outcome['spawn_error']
    require((code is None or (type(code) is int and code >= 0))
            and (signal is None or (isinstance(signal, str) and signal))
            and (spawned is None or (isinstance(spawned, str) and spawned)),
            label + ' records an unshared outcome field set: ' + json.dumps(outcome))
    if state == 'exited':
        require(type(code) is int and signal is None and spawned is None,
                label + ' records an inconsistent exited outcome: ' + json.dumps(outcome))
    elif state == 'signalled':
        require(code is None and signal is not None and spawned is None,
                label + ' records an inconsistent signalled outcome: ' + json.dumps(outcome))
    elif state == 'spawn-error':
        require(code is None and signal is None and spawned is not None,
                label + ' records an inconsistent spawn-error outcome: ' + json.dumps(outcome))
    else:
        require(code is None and signal is None and spawned is None,
                label + ' records an inconsistent not-run outcome: ' + json.dumps(outcome))
    return outcome


def ordinary_row(identity, expected, parent_rows, record):
    """Check one ordinary case against the index verdict and the parent row.

    The index carries the checker's own verdict for the case and the parent
    process printed the row for the same control. Both authorities are read, and
    the raw child stream is never parsed as a verdict.
    """
    require(isinstance(parent_rows, dict) and parent_rows,
            'The ordinary route has no parent verdict rows')
    row = parent_rows.get(identity)
    require(isinstance(row, dict),
            'The parent run printed no row for ' + json.dumps(identity))
    require(row.get('passed') is True,
            'The parent row did not pass: ' + json.dumps(row, sort_keys=True))
    verdict = record.get('verdict')
    require(isinstance(verdict, dict) and set(verdict) == set(ORDINARY_VERDICT_FIELDS),
            'An ordinary case carries no classifier verdict: ' + json.dumps(identity))
    require(verdict.get('qualified') is True,
            'The ordinary verdict did not qualify: ' + json.dumps(verdict, sort_keys=True))
    if identity == 'baseline':
        require(row.get('check') == 'entry compiles with every law proven',
                'The parent baseline row did not name the admitting compile')
        require(verdict.get('class') not in ('', None),
                'The baseline verdict names no class: ' + json.dumps(verdict))
        return row
    kind, _, name = identity.partition(':')
    require(kind in ('proof', 'mutation') and name,
            'An ordinary case names no control kind: ' + json.dumps(identity))
    control = expected['by_id'].get(identity)
    require(control is not None,
            'An ordinary case is absent from this source: ' + json.dumps(identity))
    require(verdict.get('class') == ORDINARY_INTENDED_CLASS,
            'The ordinary verdict is not an intended refusal: '
            + json.dumps(verdict, sort_keys=True))
    require(verdict.get('attributed_law') == control['law'],
            'The ordinary verdict attributes another law: '
            + json.dumps(verdict, sort_keys=True))
    require(row.get('gate') == 'refuses',
            'The parent row did not record an attributable refusal: '
            + json.dumps(row, sort_keys=True))
    if kind == 'proof':
        require(row.get('law') == control['law'] and row.get('module') == control['module'],
                'The parent proof row names another control: ' + json.dumps(row, sort_keys=True))
        require(row.get('proof') == 'removed',
                'The parent proof row did not apply its removal: '
                + json.dumps(row, sort_keys=True))
    else:
        require(row.get('applied') is True,
                'The parent mutation row did not apply its change: '
                + json.dumps(row, sort_keys=True))
        require(row.get('law') == control['law'],
                'The parent mutation row names another law: ' + json.dumps(row, sort_keys=True))
    return row


def verify_ordinary_delta(record, root, control, label):
    """Bind the applied source delta against the current admitted graph.

    The producer records the original and changed digests with the changed path.
    The current run must hold the changed bytes, and an applied control must
    carry the delta that was actually applied.
    """
    delta = record.get('delta')
    if control is None:
        require(delta is None,
                label + ' records an applied delta for the admitted compile')
        return None
    require(isinstance(delta, dict) and set(delta) == {'original_sha256', 'changed_sha256',
                                                       'changed_path'},
            label + ' names another delta shape: ' + succinct(sorted(delta or [])))
    for field in ('original_sha256', 'changed_sha256'):
        require(isinstance(delta.get(field), str) and re.fullmatch(r'[0-9a-f]{64}', delta[field]),
                label + ' records no ' + field)
    member = ordinary_member(root, delta.get('changed_path'), label + ' changed file')
    data = member.read_bytes()
    require(hashlib.sha256(data).hexdigest() == delta['changed_sha256'],
            label + ' changed file does not match its recorded digest')
    require(data != b'', label + ' changed file is empty')
    # changed_path is the retained evidence member the checker wrote, so it is
    # bound as a confined member. The control module is bound separately by the
    # original digest of the admitted module bytes.
    return delta


def ordinary_evidence(index_path, expected, compiler=None, declared_root=None,
                      parent_rows=None, producer_root=None, envelope=None, audit=None):
    """Consume the checker's retained ordinary per-case evidence.

    The caller supplies the admitted compiler. Its bytes are compared with the
    compiler block the run recorded, so an ordinary run is only consumed for the
    compiler this checkout selected.

    The index sits at <run>/evidence/index.json and records stream paths relative
    to <run>. Its run identity must equal the envelope the checker printed for
    the same run, every control the source states must appear exactly once with
    its applied setup, the checker's own verdict, its delta and both raw child
    streams verified byte for byte below the run root, exactly one positive
    baseline compile must precede the controls, and the index must declare a
    finished run over the admitted inputs.
    """
    require(compiler is not None,
            'The ordinary evidence is consumed without the compiler it binds')
    root = ordinary_root(index_path, declared_root)
    if producer_root is None:
        producer_root = root
    else:
        producer_root = Path(producer_root)
        require(producer_root.is_absolute(),
                'The ordinary producer root is not an absolute historical path: '
                + str(producer_root))
    path = Path(index_path)
    index = json.loads(path.read_text())
    require(index.get('schema') == ORDINARY_SCHEMA,
            'The ordinary evidence index names another schema: ' + json.dumps(index.get('schema')))
    require(index.get('complete') is True,
            'The ordinary evidence index does not declare a completed run')
    run_identity = index.get('run')
    require(isinstance(run_identity, dict), 'The ordinary evidence index records no run identity')
    require(isinstance(envelope, dict), 'The ordinary evidence is consumed without its run envelope')
    # One contract, stated once: the run block carries the producer identity, the
    # index may also carry the run location at its top level, and the envelope
    # supplies the location when the index records neither. Where more than one
    # place carries a field they must agree, so moving a field cannot present two
    # different runs silently.
    identity = {}
    for field in ORDINARY_IDENTITY_FIELDS:
        inside, outer = run_identity.get(field), index.get(field)
        if inside is None and outer is None:
            require(field in ORDINARY_ENVELOPE_ONLY_FIELDS,
                    'The ordinary index records no ' + field)
            identity[field] = envelope.get(field)
            require(identity[field] is not None,
                    'The run envelope records no ' + field)
            continue
        if inside is not None and outer is not None:
            require(json.dumps(inside, sort_keys=True) == json.dumps(outer, sort_keys=True),
                    'The ordinary index records two different ' + field + ' values')
        identity[field] = inside if inside is not None else outer
        require(json.dumps(identity[field], sort_keys=True)
                == json.dumps(envelope.get(field), sort_keys=True),
                'The ordinary index names another run ' + field + ': '
                + json.dumps(identity[field]) + ' against '
                + json.dumps(envelope.get(field)))
    for field in ('nonce', 'checker_argv'):
        identity[field] = (run_identity.get(field) if run_identity.get(field) is not None
                           else index.get(field))
    require(isinstance(identity.get('nonce'), str) and identity['nonce'],
            'The ordinary index records no run nonce')
    require(identity.get('invocation') == envelope.get('invocation'),
            'The ordinary index names another invocation')
    require(isinstance(identity.get('checker_argv'), list) and identity['checker_argv'],
            'The ordinary index records no checker command')
    recorded_index = Path(str(identity.get('index_path') or ''))
    require(recorded_index.is_absolute(),
            'The ordinary index records no absolute index path: '
            + json.dumps(identity.get('index_path')))
    if Path(producer_root).resolve() == root.resolve():
        require(recorded_index.resolve() == path.resolve(),
                'The ordinary index path disagrees with the location recorded for this run: '
                + json.dumps(identity.get('index_path')) + ' against ' + str(path))
    else:
        require(recorded_index.resolve()
                == (Path(producer_root) / 'evidence' / 'index.json').resolve(),
                'The ordinary index path does not match the recorded producer root: '
                + json.dumps(identity.get('index_path')) + ' against ' + str(producer_root))
    if compiler is not None:
        block = identity.get('compiler') or {}
        require(block.get('sha256') == sha256(compiler),
                'The ordinary run used another compiler than the selected one')
        require(block.get('path') not in (None, ''), 'The ordinary run records no compiler path')
    source_block = identity.get('source') or {}
    # Stream and delta members are relative to the evidence directory the run
    # recorded, which for the ordinary route is the index parent.
    members_root = path.parent
    verifier = identity.get('verifier') or {}
    admitted, missing_run_members = ordinary_verifier_digests()
    required = set(ORDINARY_RUN_VERIFIER_MEMBERS)
    require(isinstance(verifier, dict) and required <= set(verifier),
            'The ordinary run does not name every verifier member: '
            + succinct(sorted(required - set(verifier or {}))))
    differing = sorted(key for key, digest in admitted.items()
                       if verifier.get(key) != digest)
    require(not differing,
            'The ordinary run used other verifier bytes at: ' + succinct(differing))
    # A digest domain is checked for every member the run names, including the
    # ones whose local bytes are absent, so an unverifiable member is still a
    # well-formed claim rather than an unchecked string.
    for member, digest in verifier.items():
        require(isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest),
                'The ordinary run records no digest domain for ' + json.dumps(member))
    unavailable = sorted(missing_run_members)
    beyond = sorted(set(verifier) - required)
    # The index records the admitted inputs it captured as rows. Whether those
    # rows cover the complete non-target source and runtime graph is a
    # producer-side question this consumer cannot answer from the rows alone.
    recorded_inputs = index.get('inputs')
    input_value_shape = None
    if isinstance(recorded_inputs, dict):
        # The declared producer shape is a path-keyed map whose value is a flat
        # sha256 hex string. An object value is read for earlier producer pins and
        # recorded as a different value shape rather than treated as the contract.
        input_shape = 'map'
        input_rows = []
        for name, value in recorded_inputs.items():
            if isinstance(value, dict):
                input_value_shape = 'digest-object'
                input_rows.append({'path': name, 'sha256': value.get('sha256')})
            else:
                input_value_shape = input_value_shape or 'digest-string'
                input_rows.append({'path': name, 'sha256': value})
    elif isinstance(recorded_inputs, list):
        input_shape = 'rows'
        input_rows = recorded_inputs
    else:
        input_shape = None
        input_rows = []
    require(input_shape is not None and input_rows,
            'The ordinary index records no admitted input inventory')
    admitted_inputs = {}
    for row in input_rows:
        require(isinstance(row, dict), 'An admitted input row is not an object')
        name = row.get('path')
        require(isinstance(name, str) and name and not name.startswith('/')
                and all(segment not in ('', '.', '..') for segment in name.split('/')),
                'An admitted input row names no qualified path: ' + json.dumps(name))
        require(name not in admitted_inputs,
                'An admitted input row repeats: ' + json.dumps(name))
        require(isinstance(row.get('sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', row['sha256']),
                'The ordinary input inventory records no digest for ' + json.dumps(name))
        admitted_inputs[name] = row['sha256']
    cases = index.get('cases')
    require(isinstance(cases, list) and cases,
            'The ordinary evidence index holds no case')
    seen = {}
    baselines = 0
    baseline_reference = None
    recomputed = {}
    for position, case in enumerate(cases):
        require(isinstance(case, dict), 'An ordinary case row is not an object')
        identity_id = case.get('id')
        require(isinstance(identity_id, str) and identity_id,
                'An ordinary case row names no control: ' + json.dumps(identity_id))
        require(identity_id not in seen, 'An ordinary case row repeats: ' + json.dumps(identity_id))
        label = 'ordinary ' + json.dumps(identity_id)
        require(case.get('applied') is True, label + ' did not apply its setup')
        argv = case.get('argv')
        require(isinstance(argv, list) and argv and all(isinstance(part, str) for part in argv),
                label + ' records no command')
        if compiler is not None:
            require(len(argv) == 3 and argv[1] == ADMITTED_ENTRY
                    and argv[2] == ORDINARY_OPERATION,
                    label + ' did not run the admitted entry as a check: ' + json.dumps(argv))
            require(Path(argv[0]).resolve() == Path(compiler).resolve(),
                    label + ' ran another compiler: ' + json.dumps(argv[0]))
        outcome = verify_ordinary_outcome(case.get('outcome'), label)
        if identity_id == 'baseline':
            baselines += 1
            require(baselines == 1, 'The ordinary evidence records more than one baseline')
            require(position == 0,
                    'The ordinary baseline row does not precede the control rows')
            require(outcome['state'] == 'exited' and outcome['exit_code'] == 0,
                    label + ' did not compile successfully: ' + json.dumps(outcome))
        streams = {}
        for stream in ('stdout', 'stderr'):
            stream_record = case.get(stream)
            require(isinstance(stream_record, dict), label + ' omits its ' + stream)
            member = ordinary_member(members_root, stream_record.get('path'),
                                     label + ' ' + stream)
            data = member.read_bytes()
            require(len(data) == stream_record.get('bytes')
                    and hashlib.sha256(data).hexdigest() == stream_record.get('sha256'),
                    label + ' ' + stream + ' does not match its recorded bytes')
            streams[stream] = data
        control = expected['by_id'].get(identity_id)
        require(is_finite(case.get('started')) and is_finite(case.get('ended'))
                and case['ended'] >= case['started'],
                label + ' records an invalid interval')
        outcome_claim = {'state': outcome['state'], 'exit_code': outcome['exit_code'],
                         'signal': outcome['signal'], 'spawn_error': outcome['spawn_error']}
        stream_records = {}
        for stream in ('stdout', 'stderr'):
            member = ordinary_member(members_root, case[stream].get('path'),
                                     label + ' ' + stream)
            stream_records[stream] = {'path': str(member), 'bytes': case[stream].get('bytes'),
                                      'sha256': case[stream].get('sha256')}
        if identity_id == 'baseline':
            baseline_reference = {'argv': argv, 'outcome': outcome_claim,
                                  'streams': stream_records}
        else:
            require(baseline_reference is not None,
                    label + ' is consumed without its baseline reference')
            delta_record = verify_ordinary_delta(case, members_root, control, label)
            require(delta_record['original_sha256'] == sha256(ROOT / control['module']),
                    label + ' delta original digest is not the admitted module bytes')
            verdict = classify_control(
                control,
                {'process': outcome_claim, 'setup': 'applied',
                 'stdout': case['stdout'], 'stderr': case['stderr']},
                stream_records, baseline_reference, root, identity.get('source') or {},
                (identity.get('compiler') or {}).get('sha256'), compiler_path=compiler,
                delta=delta_record, audit=audit)
            require(verdict.get('match') is True and verdict.get('qualified') is True,
                    label + ' did not classify as a qualified match: '
                    + json.dumps(verdict.get('class')))
            require(verdict.get('class') == ORDINARY_INTENDED_CLASS,
                    label + ' did not classify as an intended refusal: '
                    + json.dumps(verdict.get('class')))
            require(verdict.get('attributed_law') == control['law'],
                    label + ' classifier attributed another law: '
                    + json.dumps(verdict.get('attributed_law')))
            claimed = case.get('verdict') or {}
            require(claimed.get('class') == verdict.get('class'),
                    label + ' producer verdict disagrees with the recomputed verdict: '
                    + json.dumps(claimed.get('class')) + ' against '
                    + json.dumps(verdict.get('class')))
            recomputed[identity_id] = {key: verdict.get(key) for key in
                                       ('class', 'attributed_law', 'qualified', 'match',
                                        'diagnostic_sha256', 'evidence_verified')}
        seen[identity_id] = ordinary_row(identity_id, expected, parent_rows, case)
    require(baselines == 1, 'The ordinary evidence records no baseline compile')
    audit_inventory = None
    if audit is not None:
        audit_path = Path(audit)
        audit_path.mkdir(parents=True, exist_ok=True)
        if any(member.is_file() for member in audit_path.rglob('*')):
            audit_inventory = producer_inventory(audit_path)
        else:
            audit_inventory = {'path': str(audit_path.resolve()), 'members': []}
    wanted = {control['id'] for control in expected['controls']}
    missing = sorted(wanted - set(seen))
    require(not missing, 'The ordinary evidence omits controls: ' + succinct(missing))
    unexpected = sorted(set(parent_rows) - set(seen))
    require(not unexpected,
            'The parent run recorded identities the ordinary evidence omits: '
            + succinct(unexpected))
    raw = {}
    for case in cases:
        raw[case['id']] = {'stdout': case['stdout']['sha256'], 'stderr': case['stderr']['sha256']}
    return {'path': str(path), **file_info(path), 'schema': ORDINARY_SCHEMA,
            'cases': len(seen), 'run_root': str(root), 'producer_root': str(producer_root),
            'root_identity': evidence_root_identity(root, 'The ordinary evidence run root'),
            'invocation': identity['invocation'], 'nonce': identity['nonce'],
            'compiler_sha256': (identity.get('compiler') or {}).get('sha256'),
            'source': source_block, 'verifier': verifier, 'inputs': admitted_inputs,
            'endpoint_members': list(VERIFIER_MEMBERS),
            'run_members': sorted(required), 'verifier_unavailable': unavailable,
            # The endpoint closure and the full producer-run identity qualify
            # separately: the extra run member is unqualified in a checkout that
            # does not hold its bytes.
            'run_identity_qualified': not unavailable,
            'run_members_beyond_contract': beyond,
            'input_rows': len(admitted_inputs), 'input_shape': input_shape,
            'input_value_shape': input_value_shape,
            'recomputed': recomputed,
            'audit': audit_inventory, 'raw': raw}


def validation(logs, remote=None, ordinary=None, compiler=None, producer_root=None, audit=None,
               consume_ordinary=True):
    expected = discover_controls()
    laws = [control for control in expected['controls'] if control['kind'] == 'proof-removal']
    mutations = [control for control in expected['controls'] if control['kind'] == 'mutation']
    counts = {'laws': len(laws), 'mutations': len(mutations),
              'compiles': len(laws) + len(mutations) + 1}
    if remote is not None:
        require(ordinary is None,
                'The ordinary evidence belongs to a run of this repository and not to the remote route')
        require(remote.get('binding') == expected['sha256'],
                'The remote laws obligation checked a different control definition set')
        require(remote.get('cases') == len(expected['controls'])
                and remote.get('groups') == len({control['module'] for control in expected['controls']}),
                'The remote laws obligation does not cover every discovered control')
    else:
        law_text = (logs / 'laws-check.log').read_text(errors='replace')
        match = re.search(r'^laws-check: green - (\d+) laws, (\d+) mutations, (\d+) compiles, 0 failures$',
                          law_text, re.MULTILINE)
        require(match is not None, 'The complete laws-check success summary is missing')
        observed = dict(zip(('laws', 'mutations', 'compiles'), map(int, match.groups())))
        require(observed == counts,
                'The laws-check summary counts ' + json.dumps(observed) + '; this source defines '
                + json.dumps(counts))
        law_rows, mutation_rows, _ = control_rows(law_text)
        reconcile_controls(expected, law_rows, mutation_rows)
        parents = parent_verdicts(law_text)
        envelope = ordinary_envelope(law_text)
        # The complete invocation prints the index it wrote, so the package
        # consumes the run's own index instead of an externally named file. An
        # explicit argument is checked against that recorded location.
        recorded_index = envelope.get('index_path')
        if not consume_ordinary:
            ordinary, ordinary_source = None, None
        elif ordinary is None:
            require(isinstance(recorded_index, str) and recorded_index,
                    'The checker envelope names no ordinary index: ' + json.dumps(recorded_index))
            require(Path(recorded_index).is_file(),
                    'The checker envelope names an ordinary index that is absent: '
                    + recorded_index)
            ordinary = Path(recorded_index)
            ordinary_source = 'envelope'
        else:
            ordinary_source = 'argument'
    native_text = (logs / 'check-native.log').read_text(errors='replace')
    result = {'laws': counts, 'controls_sha256': expected['sha256'],
              'route': 'remote-module-groups' if remote is not None else 'local-complete',
              'native': reconcile_native(native_text)}
    if ordinary is not None:
        if ordinary_source == 'envelope':
            # The checker writes its index under its own scratch, so the package
            # retains the graph it read before consuming it and keeps the
            # producer root beside the retained run root.
            source_root = verify_ordinary_graph(ordinary_root(ordinary, None),
                                                'The ordinary evidence source')
            require(not (logs / 'evidence').exists(),
                    'The package run already retains ordinary evidence')
            shutil.copytree(source_root / 'evidence', logs / 'evidence')
            verify_ordinary_graph(logs, 'The retained ordinary evidence')
            ordinary = logs / 'evidence' / 'index.json'
            if producer_root is None:
                producer_root = source_root
        consumed = ordinary_evidence(ordinary, expected, compiler, None, parents,
                                     producer_root, envelope, audit)
        retained = Path(consumed['path']).resolve()
        require(logs.resolve() in retained.parents,
                'The consumed ordinary evidence is not retained under the package run: '
                + str(retained))
        consumed['retained'] = str(retained.relative_to(logs.resolve()))
        consumed['selected'] = ordinary_source
        result['ordinary'] = consumed
    return result


def reconcile_native(text):
    """Match the native log to the suites check-native.sh selects.

    The stage's exit status carries the pass or failure of these suites. This
    records which of the selected suites reported and the unittest totals they
    printed, and it fails when a selected suite is absent or an unselected file
    reported instead.
    """
    wanted = native_suites()
    lines = [line.strip() for line in text.splitlines()]
    suite_lines = [index for index, line in enumerate(lines)
                   if line.startswith('bend2/') and line.endswith('.py')]
    observed = [lines[index] for index in suite_lines]
    duplicates = len(observed) - len(set(observed))
    require(duplicates == 0, str(duplicates) + ' duplicate native suite runs')
    missing = sorted(set(wanted) - set(observed))
    require(not missing, 'Missing native suite evidence: ' + succinct(missing))
    unexpected = sorted(set(observed) - set(wanted))
    require(not unexpected, 'Native suite evidence absent from this source: ' + succinct(unexpected))
    total, reported = 0, 0
    for position, index in enumerate(suite_lines):
        end = suite_lines[position + 1] if position + 1 < len(suite_lines) else len(lines)
        found = [line for line in lines[index + 1:end]
                 if re.fullmatch(r'Ran (\d+) tests? in [^\n]+', line)]
        require(len(found) == 1, 'Native suite reported ' + str(len(found))
                + ' unittest summaries: ' + json.dumps(lines[index]))
        total += int(re.fullmatch(r'Ran (\d+) tests? in [^\n]+', found[0]).group(1))
        reported += 1
    return {'python_tests': total, 'python_suites': reported}


def run_gates(compiler, env, logs, initial, before_inputs, remote=None, ordinary=None,
              ordinary_root_path=None):
    summary = {'schema': RECEIPT_SCHEMA, 'status': 'running', 'worktree': str(ROOT),
               'output': str(logs),
               'before': initial, 'environment': {'BEND': str(compiler), 'BEND_NO_TELEMETRY': '1',
                                                'CC': env.get('CC', 'clang')},
               'compiler_sha256': sha256(compiler), 'runner_sha256': sha256(Path(__file__)),
               'route': 'local-complete' if remote is None else 'remote-module-groups',
               'inputs_before': before_inputs, 'stages': []}
    if remote is not None:
        summary['controls_evidence'] = {key: remote[key] for key in
                                        ('path', 'bytes', 'sha256', 'cases', 'groups', 'binding',
                                         'origin', 'spans', 'classifier', 'closure_sha256',
                                         'modules', 'inventory_sha256', 'reduction_sha256',
                                         'inventory', 'reduction', 'root', 'root_identity',
                                         'provenance')}
    path = logs / 'summary.json'
    write_json(path, summary)
    try:
        for name, argv in GATES:
            stage = {'name': name, 'argv': argv, 'status': 'running',
                     'before': snapshot(), 'log': name + '.log'}
            if remote is not None and name == 'laws-check':
                stage['local_argv'] = list(argv)
                stage['template_command'] = remote['checker_invocation'] + ' --group <module>'
                stage['route'] = 'remote-module-groups'
                stage['kind'] = 'evidence-qualification'
                stage['spans'] = [dict(span) for span in remote['spans']]
                stage['evidence'] = {'path': remote['path'], 'sha256': remote['sha256'],
                                     'binding': remote['binding'], 'cases': remote['cases'],
                                     'groups': remote['groups'], 'origin': remote['origin'],
                                     'closure_sha256': remote['closure_sha256'],
                                     'inventory_sha256': remote['inventory_sha256'],
                                     'reduction_sha256': remote['reduction_sha256'],
                                     'root': remote['root'],
                                     'root_identity': remote['root_identity'],
                                     'provenance': remote['provenance']}
            same_source(stage['before'], initial)
            summary['stages'].append(stage)
            write_json(path, summary)
            print(json.dumps({'stage': name, 'status': 'running', 'log': str(logs / stage['log']),
                              'route': stage.get('route', 'local')}), flush=True)
            started = time.monotonic()
            if stage.get('route') == 'remote-module-groups':
                receipt = {'schema': RECEIPT_SCHEMA, 'route': 'remote-module-groups',
                           'kind': 'evidence-qualification',
                           'evidence': stage['evidence'], 'spans': stage['spans'],
                           'classifier': remote['classifier'],
                           'local_gates': ['build-native', 'check-native'],
                           'local_argv': list(argv)}
                (logs / stage['log']).write_text(json.dumps(receipt, indent=2) + '\n')
                result_exit = None
            else:
                with (logs / stage['log']).open('wb') as log:
                    result = subprocess.run(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                            stdout=log, stderr=subprocess.STDOUT)
                result_exit = result.returncode
            stage.update(exit_code=result_exit, elapsed_seconds=time.monotonic() - started,
                         status=('passed' if stage.get('route') == 'remote-module-groups'
                                 or zero_exit(result_exit) else 'failed'),
                         after=snapshot())
            if stage.get('route') == 'remote-module-groups':
                stage['elapsed_seconds'] = remote['slowest_span_seconds']
                stage['evidence_sha256'] = remote['sha256']
                require(stage['spans'] and stage['evidence']['closure_sha256'],
                        'A remote laws stage records no producing span or closure digest')
            stage['log_sha256'] = sha256(logs / stage['log'])
            write_json(path, summary)
            if stage.get('route') == 'remote-module-groups':
                require(bool(stage['spans']) and bool(stage['evidence']['closure_sha256']),
                        name + ' carries no qualified remote evidence')
            else:
                require(zero_exit(result_exit),
                        name + ' failed; full output is retained at ' + str(logs / stage['log']))
            same_source(stage['after'], initial)
        retained, source_root, audit = None, None, None
        if ordinary is not None:
            source_root = verify_ordinary_graph(ordinary_root(ordinary, ordinary_root_path),
                                                'The ordinary evidence source')
            audit = logs / 'classifier-audit'
            require(not (logs / 'evidence').exists(),
                    'The package run already retains ordinary evidence')
            shutil.copytree(source_root / 'evidence', logs / 'evidence')
            verify_ordinary_graph(logs, 'The retained ordinary evidence')
            retained = logs / 'evidence' / 'index.json'
        summary['validation'] = validation(logs, remote, retained, compiler,
                                           producer_root=source_root if ordinary is not None else None,
                                           audit=audit)
        summary['after'] = snapshot()
        require(summary['after']['binary_sha256'] == summary['stages'][0]['after']['binary_sha256'],
                'The native binary changed between gate stages')
        summary['inputs_after'] = inputs(compiler, env, logs, 'after')
        require(summary['inputs_after'] == before_inputs, 'Toolchain or host inputs changed during the gates')
        summary['status'] = 'passed'
    except BaseException as error:
        summary.update(status='failed', error=repr(error), after=snapshot())
        write_json(path, summary)
        raise
    write_json(path, summary)
    return path, summary


def reuse_gates(path, expected_sha, compiler, logs, initial):
    require(sha256(path) == expected_sha, 'The supplied gate receipt does not match its requested SHA256')
    summary = json.loads(path.read_text())
    require(summary.get('runner_sha256') == sha256(Path(__file__)),
            'The supplied gate receipt names different producing gate runner bytes')
    require('inputs_before' in summary and 'inputs_after' in summary,
            'The supplied gate receipt carries no historical toolchain and host inputs')
    require(summary['inputs_after'] == summary['inputs_before'],
            'The supplied gate receipt records changed inputs across its own gates')
    require(summary.get('schema') == RECEIPT_SCHEMA,
            'The supplied gate receipt was written to another schema: '
            + json.dumps(summary.get('schema')))
    require(summary['status'] == 'passed' and Path(summary['worktree']).resolve() == ROOT,
            'The supplied gate receipt must pass on this exact build directory')
    same_source(summary['before'], initial)
    same_source(summary['after'], initial)
    require(summary['after']['binary_sha256'] == initial['binary_sha256'], 'The receipt binary differs from the current binary')
    require(summary['compiler_sha256'] == sha256(compiler), 'The receipt compiler differs from the selected compiler')
    require(summary['environment']['BEND'] == str(compiler) and summary['environment']['BEND_NO_TELEMETRY'] == '1',
            'The receipt must select this compiler with telemetry disabled')
    require([stage['name'] for stage in summary['stages']] == [name for name, _ in GATES],
            'The receipt must contain the complete three gate stages in order')
    route = summary.get('route')
    require(route in ('local-complete', 'remote-module-groups'),
            'The supplied gate receipt names no route: ' + json.dumps(route))
    remote_laws = route == 'remote-module-groups'
    require((summary.get('controls_evidence') is not None) == remote_laws,
            'The receipt route and its controls evidence disagree')
    for stage in summary['stages']:
        name = stage['name']
        wants_remote = remote_laws and name == 'laws-check'
        if stage.get('route') is not None:
            require(wants_remote,
                    'Only the laws-check stage may carry the remote route: ' + json.dumps(name))
            require(stage.get('route') == 'remote-module-groups',
                    'A stage names an unsupported route: ' + json.dumps(stage.get('route')))
            require(stage.get('kind') == 'evidence-qualification',
                    'A remote stage must be marked as evidence qualification')
            require(stage.get('exit_code') is None,
                    'A remote stage must record no local exit')
            record = summary.get('controls_evidence') or {}
            reference = {key: record.get(key) for key in
                         ('path', 'sha256', 'binding', 'cases', 'groups', 'origin',
                          'closure_sha256', 'inventory_sha256', 'reduction_sha256',
                          'root', 'root_identity', 'provenance')}
            require(stage.get('evidence') == reference,
                    'A remote stage must reference the recorded producer evidence exactly')
            require(stage.get('local_argv') == list(dict(GATES)[name]),
                    'A remote stage must keep the local command it replaces')
            require(stage.get('status') == 'passed',
                    'A remote stage that did not qualify cannot be reused')
        else:
            require(not wants_remote,
                    'The laws-check stage must carry the remote route when the receipt does')
            require(stage.get('argv') == list(dict(GATES)[name]),
                    'A local gate stage must name its own command')
            require(stage.get('status') == 'passed'
                    and type(stage.get('exit_code')) is int and stage['exit_code'] == 0,
                    'A supplied gate did not pass with an integer zero exit')
        same_source(stage['before'], initial)
        same_source(stage['after'], initial)
        require(stage['log'] == stage['name'] + '.log', 'Unexpected gate log path')
        source = path.parent / stage['log']
        require(sha256(source) == stage['log_sha256'], 'Supplied gate log bytes changed: ' + str(source))
        shutil.copyfile(source, logs / stage['log'])
    if remote_laws:
        recorded = summary.get('controls_evidence') or {}
        reference = {key: recorded.get(key) for key in
                     ('path', 'sha256', 'binding', 'cases', 'groups', 'origin',
                      'closure_sha256', 'inventory_sha256', 'reduction_sha256',
                      'root', 'root_identity', 'provenance')}
        for stage in summary['stages']:
            if stage.get('route') != 'remote-module-groups':
                continue
            require(stage.get('spans') == recorded.get('spans'),
                    'The remote stage spans disagree with the recorded controls evidence')
            retained = logs / stage['log']
            require(retained.is_file(), 'The retained remote stage log is missing: ' + str(retained))
            entry = json.loads(retained.read_text())
            expected = {'schema': RECEIPT_SCHEMA, 'route': 'remote-module-groups',
                        'kind': 'evidence-qualification', 'evidence': reference,
                        'spans': stage.get('spans'), 'classifier': recorded.get('classifier'),
                        'local_gates': [name for name, _ in GATES if name != stage['name']],
                        'local_argv': stage.get('local_argv')}
            require(isinstance(entry, dict),
                    'The retained remote stage log is not a receipt object')
            unexpected = sorted(set(entry) ^ set(expected))
            require(not unexpected,
                    'The retained remote stage log carries another key set: '
                    + succinct(unexpected))
            differing = sorted(key for key in expected if entry[key] != expected[key])
            require(not differing,
                    'The retained remote stage log disagrees with the receipt at: '
                    + succinct(differing))
    require(summary['stages'][0]['after']['binary_sha256'] == initial['binary_sha256'],
            'The original build-stage binary differs from the receipt binary')
    recorded = summary['validation']
    fresh = validation(logs, summary.get('controls_evidence'), consume_ordinary=False)
    require({key: value for key, value in recorded.items() if key != 'ordinary'} == fresh,
            'The supplied receipt validation disagrees with its full logs')
    ordinary = recorded.get('ordinary')
    if ordinary is not None:
        source_root = verify_ordinary_graph(path.parent, 'The receipt ordinary evidence')
        require(not (logs / 'evidence').exists(),
                'The reused run already holds ordinary evidence')
        shutil.copytree(source_root / 'evidence', logs / 'evidence')
        verify_ordinary_graph(logs, 'The reused ordinary evidence')
        fresh_laws = (logs / 'laws-check.log').read_text(errors='replace')
        parents = parent_verdicts(fresh_laws)
        envelope = ordinary_envelope(fresh_laws)
        consumed = ordinary_evidence(logs / 'evidence' / 'index.json', discover_controls(),
                                     compiler, None, parents,
                                     producer_root=ordinary.get('producer_root'),
                                     envelope=envelope, audit=logs / 'classifier-audit')
        require(consumed['producer_root'] == ordinary['producer_root'],
                'The reused ordinary evidence does not keep the producer root the receipt records')
        require(consumed['sha256'] == ordinary['sha256']
                and consumed['cases'] == ordinary['cases']
                and consumed['schema'] == ordinary['schema']
                and consumed['raw'] == ordinary['raw'],
                'The copied ordinary evidence disagrees with the receipt')
        require(consumed['recomputed'] == ordinary['recomputed'],
                'The reused run reclassified the same bytes differently')
        require(consumed['input_shape'] == ordinary['input_shape']
                and consumed['inputs'] == ordinary['inputs'],
                'The reused run reads another admitted input inventory')
        require(consumed['run_root'] == str(logs),
                'The copied ordinary evidence is not rooted at the reused run')
        # The receipt keeps the acquisition scope of the original run; this run
        # records its own current scope beside it, so neither replaces the other.
        require(consumed['audit'] is not None,
                'The reused run recorded no classifier acquisition scope')
        summary.setdefault('acquired_now', {})['ordinary_audit'] = consumed['audit']
        summary.setdefault('acquired_now', {})['recorded_audit'] = ordinary.get('audit')
    destination = logs / 'summary.json'
    shutil.copyfile(path, destination)
    return destination, summary


def evidence_stream(directory, record, label):
    """Resolve one recorded member against the current evidence root.

    The recorded name must be a relative path with no empty, dot or parent
    segment, and no component of the walked member may be a symlink. A recorded
    absolute path is refused by name, and a relocated tree binds its members to
    the directory the caller supplies, which is the graph it holds now; any
    original absolute root a producer records stays provenance and is never
    followed for resolution.
    """
    require(isinstance(record, dict), 'A controls evidence record omits its ' + label)
    recorded = record.get('path')
    require(isinstance(recorded, str) and recorded, 'A controls evidence ' + label + ' records no path')
    require(not recorded.startswith('/'),
            'A controls evidence ' + label + ' records an absolute path: ' + json.dumps(recorded))
    segments = recorded.split('/')
    require(all(segment not in ('', '.', '..') for segment in segments),
            'A controls evidence ' + label + ' records an unqualified path: ' + json.dumps(recorded))
    walked = directory
    for segment in segments:
        walked = walked / segment
        require(not walked.is_symlink(),
                'A controls evidence ' + label + ' passes through a symlink: ' + json.dumps(recorded))
    path = walked.resolve()
    require(directory.resolve() in path.parents,
            'A controls evidence ' + label + ' names a file outside the evidence directory')
    require(path.is_file(), 'A controls evidence ' + label + ' is missing: ' + str(record.get('path')))
    data = path.read_bytes()
    require(len(data) == record.get('bytes'), 'A controls evidence ' + label + ' changed size')
    require(hashlib.sha256(data).hexdigest() == record.get('sha256'),
            'A controls evidence ' + label + ' does not match its recorded digest')
    return path


def runtime_list_digest(files):
    """Digest a claimed runtime inventory: sorted path TAB sha256 rows.

    The serialization is the one runtime_set_digest uses over the installed
    library files, so a producer's claimed list can be recomputed rather than
    trusted, and a path that escapes its root is refused.
    """
    rows = []
    seen = set()
    for entry in files:
        require(isinstance(entry, dict) and isinstance(entry.get('path'), str)
                and isinstance(entry.get('sha256'), str) and entry['sha256'],
                'A runtime inventory entry lacks a path or a digest')
        raw = entry['path']
        relative = PurePosixPath(raw)
        require(not relative.is_absolute() and '..' not in relative.parts,
                'A runtime inventory path escapes its root: ' + raw)
        canonical = relative.as_posix()
        require(canonical == raw and '//' not in canonical and not canonical.startswith('./')
                and not canonical.endswith('/') and '' not in relative.parts
                and canonical not in ('.', '..')
                and '\t' not in canonical and '\n' not in canonical,
                'A runtime inventory path is not canonical: ' + raw)
        digest = entry['sha256']
        require(len(digest) == 64 and all(character in '0123456789abcdef' for character in digest),
                'A runtime inventory digest is not a lowercase sha256: ' + raw)
        require(canonical not in seen,
                'A runtime inventory names the same path twice: ' + canonical)
        seen.add(canonical)
        rows.append(canonical + '\t' + entry['sha256'])
    require(rows, 'A runtime inventory holds no installed library file')
    return hashlib.sha256('\n'.join(sorted(rows)).encode('utf-8')).hexdigest()


def runtime_set_digest(compiler):
    """Digest the installed Bend library files beside a compiler executable."""
    runtime = compiler.parent.parent / 'bend2'
    if runtime.is_symlink():
        raise RuntimeError('The installed runtime root is a symlink: ' + str(runtime))
    if not runtime.is_dir():
        return None
    rows = []
    for path in sorted(runtime.rglob('*')):
        require(not path.is_symlink(),
                'The installed runtime holds a symlink: ' + str(path.relative_to(runtime)))
        if not path.is_file():
            continue
        name = path.relative_to(runtime).as_posix()
        require(name not in ('.', '..') and '\t' not in name and '\n' not in name
                and '' not in PurePosixPath(name).parts,
                'An installed runtime file name is not canonical: ' + name)
        rows.append(name + '\t' + sha256(path))
    require(rows, 'The installed runtime holds no file')
    return hashlib.sha256('\n'.join(sorted(rows)).encode('utf-8')).hexdigest()


def classify_control(case, result, streams, baseline, evidence_root, source, compiler_sha256,
                    compiler_path=None, delta=None, supplied=None, audit=None):
    """Ask the checker's classifier what the verified bytes establish.

    One JSON request on stdin, one verdict line on stdout. The checker owns
    the classifier; the package recomputes the verdict over the verified
    streams and the actual child outcome and compares the producer's claim
    with it. A case definition, including any expectation the definition
    owner bound, is a declared statement about the intended diagnostic: it is
    bound into the identity and never treated as a measured diagnostic.
    """
    outcome = result.get('process') or {}
    request = {
        'case': case,
        'outcome': {'state': outcome.get('state'), 'exit_code': outcome.get('exit_code'),
                    'signal': outcome.get('signal'), 'spawn_error': outcome.get('spawn_error')},
        'streams': streams,
        'baseline': baseline,
        'evidence_root': str(evidence_root),
        'source': source,
        'toolchain': {'compiler_sha256': compiler_sha256,
                      'compiler_path': (baseline.get('argv') or [None])[0]
                      or (str(compiler_path) if compiler_path else None),
                      'current_compiler_path': str(compiler_path) if compiler_path else None},
    }
    if delta is not None:
        request['delta'] = delta
    if supplied is not None:
        request['supplied'] = supplied
    argv = ['node', str(ROOT / CONTROL_SCRIPT), '--classify']
    request_bytes = json.dumps(request).encode('utf-8')
    identity = str(case.get('id', 'case'))
    acquire = None if audit is None else audit
    if acquire is not None:
        acquire.mkdir(parents=True, exist_ok=True)
        stem = identity.replace(':', '-').replace('/', '_')
        stem = stem + '-' + hashlib.sha256(identity.encode('utf-8')).hexdigest()[:12]
    stdout_bytes, stderr_bytes = None, None
    status, signal_name, spawn_error, open_error = None, None, None, None
    launch_attempted = False
    started = None
    interruption = None
    secondary = None
    capture_error = None
    stream_dir = acquire if acquire is not None else None
    if stream_dir is not None:
        (stream_dir / (stem + '.request.json')).write_bytes(request_bytes)
    out_path = (stream_dir / (stem + '.stdout')) if stream_dir is not None else None
    err_path = (stream_dir / (stem + '.stderr')) if stream_dir is not None else None

    def observed(path):
        """The bytes on disk, or None when they cannot be read."""
        if path is None:
            return None
        try:
            return path.read_bytes() if path.exists() else None
        except OSError:
            return None

    def settle(outcome, reason):
        """Write what this terminal path actually produced, or say it is unknown."""
        nonlocal secondary
        if stream_dir is None:
            return
        try:
            out_bytes = observed(out_path)
            err_bytes = observed(err_path)
            write_json(stream_dir / (stem + '.acquisition.json'),
                       {'argv': argv, 'cwd': str(ROOT), 'outcome': outcome, 'reason': reason,
                        'launch_attempted': launch_attempted, 'started': started,
                        'exit_code': status, 'signal': signal_name, 'spawn_error': spawn_error,
                        'secondary_error': secondary,
                        'stdout_bytes': None if out_bytes is None else len(out_bytes),
                        'stdout_sha256': (None if out_bytes is None
                                          else hashlib.sha256(out_bytes).hexdigest()),
                        'stderr_bytes': None if err_bytes is None else len(err_bytes),
                        'stderr_sha256': (None if err_bytes is None
                                          else hashlib.sha256(err_bytes).hexdigest()),
                        'request_sha256': hashlib.sha256(request_bytes).hexdigest()})
        except BaseException as write_error:
            secondary = secondary or repr(write_error)

    handles = []
    try:
        for path in (out_path, err_path):
            if path is not None:
                handles.append(path.open('wb'))
    except BaseException as error:
        open_error = error
        while handles:
            try:
                handles.pop().close()
            except BaseException as close_error:
                secondary = secondary or repr(close_error)
    completed = None
    if open_error is not None:
        settle('stream-open-error', repr(open_error))
        raise open_error
    if spawn_error is None:
        try:
            launch_attempted = True
            completed = subprocess.run(
                argv, cwd=ROOT, input=request_bytes,
                stdout=handles[0] if len(handles) > 0 else subprocess.PIPE,
                stderr=handles[1] if len(handles) > 1 else subprocess.PIPE,
                env={'PATH': os.environ.get('PATH', ''), 'BEND_NO_TELEMETRY': '1'})
            started = True
            status = completed.returncode
            if status < 0:
                signal_name, status = child_signal(status), None
        except OSError as error:
            spawn_error = repr(error)
        except BaseException as error:
            interruption = error
        finally:
            while handles:
                try:
                    handles.pop().close()
                except BaseException as close_error:
                    secondary = secondary or repr(close_error)
        if interruption is None and spawn_error is None and completed is not None:
            stdout_bytes = observed(out_path) if out_path is not None else completed.stdout
            stderr_bytes = observed(err_path) if err_path is not None else completed.stderr
            if stdout_bytes is None or stderr_bytes is None:
                capture_error = 'the classification streams could not be read'
    if interruption is not None:
        settle('interrupted', repr(interruption))
        raise interruption
    if spawn_error is not None:
        settle('spawn-error', spawn_error)
        raise RuntimeError('The checker classification could not be launched: ' + spawn_error
                           + ('; secondary: ' + str(secondary) if secondary else ''))
    if capture_error is not None:
        settle('capture-error', capture_error)
        raise RuntimeError(capture_error
                           + ('; secondary: ' + str(secondary) if secondary else ''))
    acquisition = {'argv': argv, 'cwd': str(ROOT), 'exit_code': status,
                   'outcome': 'signalled' if signal_name else 'exited',
                   'signal': signal_name, 'spawn_error': None,
                   'launch_attempted': launch_attempted, 'started': started,
                   'secondary_error': secondary,
                   'request_sha256': hashlib.sha256(request_bytes).hexdigest(),
                   'request_bytes': len(request_bytes),
                   'stdout_sha256': hashlib.sha256(stdout_bytes).hexdigest(),
                   'stdout_bytes': len(stdout_bytes),
                   'stderr_sha256': hashlib.sha256(stderr_bytes).hexdigest(),
                   'stderr_bytes': len(stderr_bytes)}
    if acquire is not None:
        (acquire / (stem + '.acquisition.json')).write_text(
            json.dumps(acquisition, indent=2, sort_keys=True) + '\n')
    require(spawn_error is None,
            'The checker classification could not be launched: ' + str(spawn_error))
    require(signal_name is None, 'The checker classification was signalled: ' + str(signal_name))
    stderr_text = stderr_bytes.decode('utf-8', 'replace')
    if status != 0:
        raise RuntimeError('The checker classification refused the request with status '
                           + str(status) + ': ' + stderr_text)
    require(not stderr_text.strip(),
            'The checker classification wrote to stderr: ' + stderr_text[:120])
    lines = [line for line in stdout_bytes.decode('utf-8').splitlines() if line.strip()]
    require(len(lines) == 1,
            'The checker classification printed ' + str(len(lines)) + ' response lines')
    verdict = json.loads(lines[0])
    verdict['acquisition'] = acquisition
    require(verdict.get('schema') == 'capacity-controls/classify-verdict@1',
            'The checker classification answered another schema: '
            + json.dumps(verdict.get('schema')))
    require(verdict.get('id') == case.get('id'),
            'The checker classification answered another case')
    require_verifier_closure(verdict, json.dumps(case.get('id')))
    return verdict


VERIFIER_FILES = {
    'checker_sha256': 'bend2/scripts/laws-check.mjs',
    'aggregate_module_sha256': 'bend2/scripts/capacity-controls/aggregate.mjs',
    'classifier_module_sha256': 'bend2/scripts/capacity-controls/classify.mjs',
    'work_set_module_sha256': 'bend2/scripts/capacity-controls/work-set.mjs',
    'laws_common_module_sha256': 'bend2/scripts/laws-common.mjs',
    'definitions_module_sha256': 'bend2/scripts/laws-mutations.mjs',
}


def expected_verifier_digests():
    """The admitted checker bytes of this checkout, or the files still missing."""
    digests, missing = {}, []
    for member, relative in VERIFIER_FILES.items():
        path = ROOT / relative
        if path.is_file():
            digests[member] = sha256(path)
        else:
            missing.append(relative)
    return digests, missing


def ordinary_verifier_digests():
    """The admitted bytes of the ordinary run's members, or those still absent."""
    digests, missing = {}, []
    for member, relative in ORDINARY_VERIFIER_FILES.items():
        path = ROOT / relative
        if path.is_file():
            digests[member] = sha256(path)
        else:
            missing.append(relative)
    return digests, missing


def require_verifier_closure(verdict, label):
    """A verdict must name its whole transitive verifier closure."""
    verifier = verdict.get('verifier')
    require(isinstance(verifier, dict), 'A verdict names no verifier closure: ' + label)
    for member in VERIFIER_MEMBERS:
        require(isinstance(verifier.get(member), str) and verifier[member],
                'A verdict omits verifier ' + member + ': ' + label)
    admitted, missing = expected_verifier_digests()
    require(not missing,
            'This checkout lacks admitted verifier source, so no verdict can be qualified: '
            + succinct(missing))
    for member, digest in admitted.items():
        require(verifier[member] == digest,
                'The verdict names verifier ' + member + ' bytes that differ from this checkout')
    return {member: verifier[member] for member in VERIFIER_MEMBERS}


def verify_process(record, baseline, label):
    """Validate one recorded child outcome by type and state consistency."""
    outcome = record.get('process')
    require(isinstance(outcome, dict), 'A controls evidence ' + label + ' omits its process outcome')
    for field in ('state', 'exit_code', 'signal', 'spawn_error'):
        require(field in outcome,
                'A controls evidence ' + label + ' omits its ' + field + ' field')
    state = outcome['state']
    require(state in ('exited', 'signalled', 'spawn-error', 'not-run'),
            'A controls evidence ' + label + ' records state ' + json.dumps(state))
    signal = outcome.get('signal')
    spawn_error = outcome.get('spawn_error')
    exit_code = outcome.get('exit_code')
    if state == 'exited':
        require(type(exit_code) is int and exit_code >= 0 and signal is None and spawn_error is None,
                'A controls evidence ' + label + ' records an inconsistent exited outcome: '
                + json.dumps(outcome, sort_keys=True))
    elif state == 'signalled':
        require(isinstance(signal, str) and signal and exit_code is None and spawn_error is None,
                'A controls evidence ' + label + ' records an inconsistent signalled outcome')
    elif state == 'spawn-error':
        require(isinstance(spawn_error, str) and spawn_error and exit_code is None and signal is None,
                'A controls evidence ' + label + ' records an inconsistent spawn-error outcome')
    else:
        require(exit_code is None and signal is None and spawn_error is None,
                'A controls evidence ' + label + ' records a not-run outcome with child fields')
    started, ended = outcome.get('started'), outcome.get('ended')
    require(is_finite(started) and is_finite(ended) and ended >= started >= 0,
            'A controls evidence ' + label + ' records an invalid child interval: '
            + json.dumps([started, ended]))
    require(outcome.get('attempt') not in (None, ''),
            'A controls evidence ' + label + ' records no attempt identity')
    require(type(outcome.get('wrapper_pid')) is int and outcome['wrapper_pid'] > 0,
            'A controls evidence ' + label + ' records no wrapper process identity')
    if 'wrapper_exit_code' in outcome:
        wrapper_exit = outcome['wrapper_exit_code']
        require(wrapper_exit is None or (type(wrapper_exit) is int and wrapper_exit >= 0),
                'A controls evidence ' + label + ' records an invalid wrapper exit status')
    if 'wrapper_signal' in outcome:
        wrapper_signal = outcome['wrapper_signal']
        require(wrapper_signal is None
                or (isinstance(wrapper_signal, str) and wrapper_signal),
                'A controls evidence ' + label + ' records an invalid wrapper signal')
    if state != 'exited':
        raise RuntimeError('A controls evidence ' + label + ' did not complete as an exited child: '
                           + json.dumps(state))
    return outcome


def stream_record(directory, record, label):
    path = evidence_stream(directory, record, label)
    return {'path': str(path), 'bytes': record['bytes'], 'sha256': record['sha256']}


def verify_resource(record, label):
    resource = record.get('resource')
    require(isinstance(resource, dict), 'A control carries no resource sample: ' + label)
    require(resource.get('profile') in ('darwin-usr-bin-time', 'gnu-time-v'),
            'A control resource sample names no qualified time profile: ' + label)
    for field in ('real_seconds', 'user_seconds', 'sys_seconds'):
        require(is_finite(resource.get(field)) and resource[field] >= 0,
                'A control resource sample records an invalid ' + field + ': ' + label)
    require(type(resource.get('max_rss_bytes')) is int and resource['max_rss_bytes'] >= 0
            and resource.get('max_rss_source_unit') in ('bytes', 'kbytes'),
            'A control resource sample records no maximum resident size in stated units: ' + label)
    return resource


def verify_delta(record, control, directory, label):
    """The delta must bind the admitted module bytes and a closure member."""
    delta = record.get('delta')
    require(isinstance(delta, dict), 'A control records no applied source delta: ' + label)
    for field in ('original_sha256', 'changed_sha256', 'changed_path'):
        require(isinstance(delta.get(field), str) and delta[field],
                'A control delta omits ' + field + ': ' + label)
    module = ROOT / control['module']
    require(module.is_file(), 'A control names no module in this checkout: ' + control['module'])
    require(delta['original_sha256'] == sha256(module),
            'A control delta original digest is not the admitted module bytes: ' + label)
    require(not (directory / delta['changed_path']).is_symlink(),
            'A control changed file is itself a symlink: ' + label)
    walked = directory.resolve()
    for part in PurePosixPath(delta['changed_path']).parts[:-1]:
        walked = walked / part
        require(not walked.is_symlink(), 'A control changed path crosses a symlink: ' + label)
    changed = (directory / delta['changed_path']).resolve()
    require(directory.resolve() in changed.parents,
            'A control changed file escapes the evidence closure: ' + label)
    require(changed.is_file(), 'A control changed file is absent from the closure: ' + label)
    require(delta['changed_sha256'] == sha256(changed),
            'A control changed file digest is not the closure bytes: ' + label)
    return delta


ARCHIVE_METADATA = ('inventory.json', 'reduction.json')


def producer_inventory(directory, destination=None, exclude=()):
    """Inventory the evidence closure bytes and optionally copy it elsewhere.

    Members are confined to the directory and must be regular files; a symlink
    anywhere in the closure refuses. The inventory digest covers the member rows
    only, so the inventory can never include itself. The copy is byte-for-byte
    and re-hashed, which is what makes the closure relocatable for reuse.
    """
    require(not Path(directory).is_symlink(),
            'The evidence closure root is a symlink: ' + str(directory))
    root = directory.resolve()
    members = []
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        require(not path.is_symlink(), 'The evidence closure holds a symlink: ' + str(relative))
        if path.is_dir():
            continue
        require(path.is_file(), 'The evidence closure holds a non-regular member: ' + str(relative))
        require('..' not in PurePosixPath(relative.as_posix()).parts,
                'An evidence member escapes its root: ' + str(relative))
        if relative.as_posix() in exclude:
            continue
        members.append({'path': relative.as_posix(), 'bytes': path.stat().st_size,
                        'sha256': sha256(path)})
    require(members, 'The evidence closure is empty: ' + str(root))
    document = {'schema': INVENTORY_SCHEMA, 'root': str(root), 'members': members}
    copied = None
    if destination is not None:
        for member in members:
            target = destination / member['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / member['path'], target)
            require(sha256(target) == member['sha256'],
                    'A copied evidence member changed: ' + member['path'])
        copied = str(destination)
    document['copied'] = copied
    document['inventory_sha256'] = hashlib.sha256(
        json.dumps(members, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return document


def verify_archived_inventory(directory, recorded, documents=None):
    """Require the recorded original members and any recorded documents to match."""
    current = producer_inventory(directory, exclude=ARCHIVE_METADATA)
    present = {member['path']: member for member in current['members']}
    recorded_members = {member['path']: member for member in recorded.get('members', [])}
    for path, member in recorded_members.items():
        found = present.get(path)
        require(found is not None and found['sha256'] == member['sha256']
                and found['bytes'] == member['bytes'],
                'An archived evidence member is missing or changed: ' + path)
    extra = sorted(set(present) - set(recorded_members))
    require(not extra, 'An archived evidence member was not produced: ' + succinct(extra))
    for name, digest in (documents or {}).items():
        path = directory / name
        require(path.is_file() and sha256(path) == digest,
                'An archived metadata document differs from its recorded identity: ' + name)
    return current


def verify_inventory(directory, recorded):
    """Re-hash a relocated closure and require it to match its inventory exactly."""
    current = producer_inventory(directory, exclude=ARCHIVE_METADATA)
    recorded_members = {member['path']: member for member in recorded.get('members', [])}
    extra = sorted({member['path'] for member in current['members']} - set(recorded_members))
    require(not extra, 'A relocated closure holds members that were not produced: '
            + succinct(extra))
    require(current['inventory_sha256'] == recorded.get('inventory_sha256'),
            'The relocated evidence closure differs from its inventory')
    return current


def semantic_reduction(result, inventory):
    """The versioned stable reduction over the qualified cases.

    It names each case identity, its source, entry, definition, admitted
    verifier digests, class, match and qualification, its diagnostic and delta
    references and the baseline reference, plus the closure, evidence and
    inventory digests. Ordering and serialization are fixed, so two reductions
    of the same evidence are byte equal and a changed member changes the digest.
    """
    cases = []
    for record in result['classifier']['verdicts']:
        cases.append({'id': record['id'], 'group': record['group'], 'entry': record['entry'],
                      'law': record['law'], 'attributed_law': record['attributed_law'],
                      'definition_sha256': record['definition_sha256'],
                      'case_sha256': record['case_sha256'],
                      'class': record['class'], 'match': record['match'],
                      'qualified': record['qualified'],
                      'evidence_verified': record['evidence_verified'],
                      'diagnostic_sha256': record['diagnostic_sha256'],
                      'verifier': record['verifier'], 'source': record['source']})
    document = {'schema': REDUCTION_SCHEMA, 'binding': result['binding'],
                'closure_sha256': result['closure_sha256'],
                'evidence_sha256': result['sha256'],
                'inventory_sha256': inventory['inventory_sha256'],
                'runtime_binding': result.get('runtime_local_comparison'),
                'modules': result['modules'],
                'cases': sorted(cases, key=lambda case: case['id'])}
    digest = hashlib.sha256(json.dumps(document, sort_keys=True,
                                       separators=(',', ':')).encode()).hexdigest()
    return {'schema': REDUCTION_SCHEMA, 'document': document, 'sha256': digest}


def controls_evidence(directory, initial, compiler, audit=None, destination=None,
                      archived=False, documents=None):
    """Validate one producer closure or one archived envelope of it.

    audit receives one acquisition record per case; destination copies the
    closure. archived=True accepts the reserved metadata names only when the
    caller binds their digests through documents, which is how an extracted
    archive envelope is validated against the graph it was written from.
    """
    audit_inventory = None
    """Validate remote module-group control evidence against this source.

    The evidence is the aggregate of one control job per module group. Each
    bundle binds its producing checker, source, compiler, archive and installed
    library bytes and its own origin, and each baseline binds the command and the
    inputs it ran with. Every control carries its definition, the applied source
    delta, its actual child outcome with the wrapper identity, the complete two
    output streams and its resource sample. Classification is recomputed by the
    checker's own classifier over those verified bytes; a producer's label is
    only compared with that verdict.
    """
    root_identity = evidence_root_identity(directory, 'The controls evidence root')
    path = directory / 'controls-summary.json'
    require(path.is_file(), 'The controls evidence has no controls-summary.json: ' + str(path))
    summary = json.loads(path.read_text())
    summary_sha = sha256(path)
    expected = discover_controls()
    wanted = expected['by_id']
    modules = {control['module'] for control in expected['controls']}
    require(not summary.get('rejections'),
            'The controls evidence reports rejections: '
            + json.dumps(summary.get('rejections', [])[:3]))
    require(summary.get('binding') == expected['sha256'],
            'The controls evidence checked a different control definition set')
    for field, value in (('source_sha', initial['head']), ('source_tree', initial['tree']),
                         ('source_bend2_tree', initial['bend2_tree'])):
        require(summary.get(field) == value, 'The controls evidence names a different ' + field)
    require(summary.get('checker_sha256') == sha256(ROOT / CONTROL_SCRIPT),
            'The controls evidence names different checker bytes')
    require(summary.get('compiler_sha256') == sha256(compiler),
            'The controls evidence names a different compiler than the selected one')
    origin = summary.get('origin') or {}
    absent = [field for field in ORIGIN_FIELDS if not origin.get(field)]
    require(not absent, 'The controls evidence does not name its producing origin: '
            + ', '.join(absent))
    for variable, field in (('GITHUB_WORKFLOW', 'workflow'), ('GITHUB_RUN_ID', 'run_id'),
                            ('GITHUB_RUN_ATTEMPT', 'run_attempt')):
        if os.environ.get(variable):
            require(str(origin[field]) == os.environ[variable],
                    'The controls evidence names a different ' + field + ' than this run')

    bundles = summary.get('bundles')
    require(isinstance(bundles, list) and bundles, 'The controls evidence holds no module bundles')
    compiler_sha = sha256(compiler)
    runtime_sha = runtime_set_digest(compiler)
    inputs = {'compiler_sha256': compiler_sha, 'checker_sha256': sha256(ROOT / CONTROL_SCRIPT),
              'archive_sha256': COMPILER_ARCHIVE_SHA256, 'runtime_set_sha256': runtime_sha}
    source_pins = {key: initial[key] for key in ('head', 'tree', 'bend2_tree')}
    seen_modules, seen_cases, seen_jobs, spans, verdicts = set(), {}, set(), [], {}
    baselines = {}
    provenance = {}
    for bundle in bundles:
        module = bundle.get('module')
        require(module in modules, 'A controls evidence bundle is absent from this source: '
                + json.dumps(module))
        require(module not in seen_modules, 'A controls evidence module appears twice: '
                + json.dumps(module))
        seen_modules.add(module)
        require(bundle.get('binding') == expected['sha256'],
                'A bundle checked a different control definition set: ' + json.dumps(module))
        require(bundle.get('status') == 'complete',
                'A bundle did not report complete: ' + json.dumps(bundle.get('status')))
        entry = bundle.get('entry')
        require(entry == ADMITTED_ENTRY,
                'A bundle names an entry that is not the admitted one: ' + json.dumps(entry))
        require((ROOT / ADMITTED_ENTRY).is_file(),
                'The admitted entry is absent from this checkout: ' + ADMITTED_ENTRY)
        producing = bundle.get('producing') or {}
        require(producing.get('checker_sha256') == sha256(ROOT / CONTROL_SCRIPT),
                'A bundle names different checker bytes: ' + json.dumps(module))
        require(producing.get('source') == source_pins,
                'A bundle names a different source: ' + json.dumps(module))
        bundle_compiler = producing.get('compiler') or {}
        require(bundle_compiler.get('sha256') == compiler_sha
                and bundle_compiler.get('version') == 'bend 2.0.25'
                and bundle_compiler.get('path') not in (None, ''),
                'A bundle used a different compiler: ' + json.dumps(module))
        require((producing.get('archive') or {}).get('sha256') == COMPILER_ARCHIVE_SHA256,
                'A bundle preserved a different compiler archive: ' + json.dumps(module))
        runtime = producing.get('runtime') or {}
        claimed = runtime.get('files')
        require(isinstance(claimed, list) and claimed,
                'A bundle runtime records no installed library inventory: ' + json.dumps(module))
        recomputed = runtime_list_digest(claimed)
        require(recomputed == producing.get('runtime_set_sha256'),
                'A bundle runtime inventory does not reproduce its digest: ' + json.dumps(module))
        require(runtime.get('sha256') == recomputed,
                'A bundle runtime digest field disagrees with its file list: ' + json.dumps(module))
        if runtime_sha is None:
            runtime_local = 'unqualified: this checkout holds no installed runtime inventory'
        else:
            runtime_local = 'qualified: matched this checkout installed library bytes'
            require(producing.get('runtime_set_sha256') == runtime_sha,
                    'A bundle used different installed Bend library bytes: ' + json.dumps(module))
        instrument = bundle.get('instrument') or {}
        require(instrument.get('tool') not in (None, '') and instrument.get('flag') not in (None, ''),
                'A bundle names no time instrument: ' + json.dumps(module))
        declared_root = bundle.get('evidence_root')
        if declared_root is not None:
            require(isinstance(declared_root, str) and declared_root.startswith('/'),
                    'A bundle evidence root is not an absolute provenance path: '
                    + json.dumps(declared_root))
            provenance.setdefault(str(declared_root), []).append(module)
        bundle_origin = producing.get('origin') or {}
        for field in ('workflow', 'run_id', 'run_attempt'):
            require(str(bundle_origin.get(field)) == str(origin[field]),
                    'A bundle names another run ' + field + ': ' + json.dumps(module))
        job = bundle_origin.get('job')
        require(job not in (None, '') and job not in seen_jobs,
                'A bundle names a repeated or absent producing job: ' + json.dumps(module))
        seen_jobs.add(job)
        if origin.get('image_version'):
            require(bundle_origin.get('image_version') == origin['image_version'],
                    'A bundle ran on another image: ' + json.dumps(module))
        baseline = bundle.get('baseline') or {}
        baseline_outcome = verify_process(baseline, baseline=True,
                                          label='baseline of ' + json.dumps(module))
        require(type(baseline_outcome['exit_code']) is int and baseline_outcome['exit_code'] == 0,
                'A group baseline did not exit 0: ' + json.dumps(module))
        require(baseline.get('argv') == [bundle_compiler['path'], entry, '--check-only'],
                'A baseline ran another command: ' + json.dumps(module))
        require(baseline.get('inputs') == inputs,
                'A baseline does not name the inputs it ran with: ' + json.dumps(module))
        baseline_reference = {
            'argv': baseline.get('argv'),
            'outcome': {'state': baseline_outcome['state'],
                        'exit_code': baseline_outcome['exit_code'],
                        'signal': baseline_outcome['signal'],
                        'spawn_error': baseline_outcome['spawn_error']},
            'streams': {stream: stream_record(directory, baseline.get(stream),
                                              'baseline ' + stream + ' of ' + json.dumps(module))
                        for stream in ('stdout', 'stderr')},
        }
        intervals = [(baseline_outcome['started'], baseline_outcome['ended'])]
        attempts = {baseline_outcome['attempt']}
        for result in bundle.get('results') or []:
            case = result.get('case') or {}
            identity = case.get('id')
            control = wanted.get(identity)
            require(control is not None, 'A controls evidence case is absent from this source: '
                    + json.dumps(identity))
            require(identity not in seen_cases, 'A controls evidence case appears twice: '
                    + json.dumps(identity))
            require(case == control, 'A controls evidence case definition differs from this source: '
                    + json.dumps(identity))
            require(case.get('module') == module, 'A case is bound to another module: '
                    + json.dumps(identity))
            require(result.get('setup') == 'applied',
                    'A control edit did not apply: ' + json.dumps(identity))
            outcome = verify_process(result, baseline=False, label=json.dumps(identity))
            require(outcome['attempt'] not in attempts, 'A controls evidence attempt repeats: '
                    + json.dumps(outcome['attempt']))
            attempts.add(outcome['attempt'])
            require(outcome['started'] >= baseline_outcome['ended'],
                    'A control started before its baseline ended: ' + json.dumps(identity))
            intervals.append((outcome['started'], outcome['ended']))
            streams = {stream: stream_record(directory, result.get(stream),
                                             json.dumps(identity) + ' ' + stream)
                       for stream in ('stdout', 'stderr')}
            verdict = classify_control(case, result, streams, baseline_reference, directory,
                                       source_pins, compiler_sha, compiler_path=compiler,
                                       delta=verify_delta(result, control, directory,
                                                          json.dumps(identity)),
                                       audit=audit)
            require(verdict.get('match') is True and verdict.get('qualified') is True
                    and verdict.get('evidence_verified') is True,
                    'The checker classifier did not qualify this control as an intended refusal: '
                    + json.dumps(identity) + ' ' + json.dumps(verdict.get('class')))
            closure = {member: verdict['verifier'][member] for member in VERIFIER_MEMBERS}
            verdicts[identity] = {'id': identity, 'class': verdict.get('class'),
                                  'law': verdict.get('law'),
                                  'attributed_law': verdict.get('attributed_law'),
                                  'match': verdict.get('match'),
                                  'qualified': verdict.get('qualified'),
                                  'diagnostic_sha256': verdict.get('diagnostic_sha256'),
                                  'evidence_verified': verdict.get('evidence_verified'),
                                  'definition_sha256': control['definition_sha256'],
                                  'case_sha256': hashlib.sha256(
                                      canonical_record_bytes(control)).hexdigest(),
                                  'group': module, 'entry': entry, 'verifier': closure,
                                  'acquisition': verdict.get('acquisition')}
            require(verdict.get('attributed_law') == control['law']
                    and verdict.get('law') == control['law'],
                    'The classified diagnostic names another law: ' + json.dumps(identity))
            acquisition = verdict.get('acquisition') or {}
            require(type(acquisition.get('exit_code')) is int and acquisition['exit_code'] == 0
                    and acquisition.get('signal') is None
                    and acquisition.get('spawn_error') is None,
                    'The classification endpoint did not exit zero for this case: '
                    + json.dumps(identity))
            reported = verdict.get('baseline')
            if isinstance(reported, dict):
                require(reported.get('ok') is True
                        and reported.get('exit_code') == baseline_outcome['exit_code']
                        and reported.get('state') == baseline_outcome['state'],
                        'The verdict baseline record disagrees with the verified baseline: '
                        + json.dumps(identity))
            claim = result.get('diagnostic') or {}
            if claim:
                require(claim.get('class') == verdict['class']
                        and claim.get('attributed_law') == verdict['attributed_law'],
                        'A produced diagnostic label disagrees with its bytes: '
                        + json.dumps(identity))
            seen_cases[identity] = {'resource': verify_resource(result, json.dumps(identity)),
                                    'group': module,
                                    'receipt': {'id': identity,
                                                'definition_sha256': control['definition_sha256'],
                                                'stdout_sha256': streams['stdout']['sha256'],
                                                'stderr_sha256': streams['stderr']['sha256'],
                                                'exit_code': outcome['exit_code'],
                                                'signal': outcome['signal'],
                                                'attempt': outcome['attempt']}}
        intervals.sort()
        require(all(left[1] <= right[0] for left, right in zip(intervals, intervals[1:])),
                'Two compilers overlapped in one module group: ' + json.dumps(module))
        spans.append({'module': module, 'job': job, 'cases': len(bundle.get('results') or []),
                      'started': intervals[0][0], 'ended': intervals[-1][1],
                      'seconds': round(intervals[-1][1] - intervals[0][0], 3)})
        baselines[module] = {'module': module, 'job': job,
                             'stdout_sha256': (baseline.get('stdout') or {}).get('sha256'),
                             'stderr_sha256': (baseline.get('stderr') or {}).get('sha256'),
                             'exit_code': baseline_outcome['exit_code'],
                             'attempt': baseline_outcome['attempt']}
    missing_modules = sorted(modules - seen_modules)
    require(not missing_modules, 'The controls evidence omits module groups: '
            + succinct(missing_modules))
    missing_cases = sorted(set(wanted) - set(seen_cases))
    require(not missing_cases, 'The controls evidence omits controls: ' + succinct(missing_cases))
    seconds = [span['seconds'] for span in spans]
    supplied = producer_inventory(directory)
    present = {member['path']: member['sha256'] for member in supplied['members']}
    if archived:
        bound = documents or {}
        require(set(bound) == set(ARCHIVE_METADATA),
                'An archived envelope must bind exactly its metadata documents: '
                + succinct(sorted(bound)))
        for name in ARCHIVE_METADATA:
            require(name in present, 'An archived envelope omits ' + name)
            require(bound.get(name) == present[name],
                    'An archived envelope metadata document is not the one recorded: ' + name)
    else:
        reserved = sorted(set(present) & set(ARCHIVE_METADATA))
        require(not reserved,
                'The producer closure names reserved archive metadata: ' + succinct(reserved))
    inventory = producer_inventory(directory, destination, exclude=ARCHIVE_METADATA)
    if audit is not None:
        audit_inventory = producer_inventory(audit)
    closure = hashlib.sha256(json.dumps(
        {'baselines': [baselines[module] for module in sorted(baselines)],
         'receipts': [seen_cases[identity]['receipt'] for identity in sorted(seen_cases)]},
        sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    result = {'path': str(path), **file_info(path), 'cases': len(wanted), 'groups': len(modules),
            'closure_sha256': closure,
            'root': str(Path(directory).resolve()),
            'root_identity': root_identity,
            'provenance': {declared: sorted(modules_of) for declared, modules_of in provenance.items()},
            'binding': expected['sha256'], 'origin': origin, 'route': 'remote-module-groups',
            'checker_invocation': 'node ' + CONTROL_SCRIPT, 'modules': sorted(seen_modules),
            'spans': spans, 'slowest_span_seconds': max(seconds) if seconds else 0,
            'classifier': {'command': ['node', CONTROL_SCRIPT, '--classify'],
                           'verdicts': [dict(verdicts[identity], source=source_pins,
                                             closure_sha256=closure,
                                             evidence_sha256=summary_sha)
                                        for identity in sorted(verdicts)]},
            'inventory': inventory,
            'slowest_seconds': max(entry['resource']['real_seconds']
                                   for entry in seen_cases.values()),
            'largest_child_max_rss_bytes': max((entry['resource'].get('max_rss_bytes') or 0)
                                               for entry in seen_cases.values()),
            'runtime_local_comparison': runtime_local,
            'audit': audit_inventory}
    result['reduction'] = semantic_reduction(result, inventory)
    if archived:
        archived_inventory = json.loads((directory / 'inventory.json').read_text())
        archived_reduction = json.loads((directory / 'reduction.json').read_text())
        require(archived_inventory.get('schema') == INVENTORY_SCHEMA,
                'The archived inventory document names another schema')
        require(archived_reduction.get('schema') == REDUCTION_SCHEMA,
                'The archived reduction document names another schema')
        archived_members = archived_inventory.get('members')
        require(isinstance(archived_members, list) and archived_members,
                'The archived inventory document holds no member list')
        recomputed_inventory = hashlib.sha256(
            json.dumps(archived_members, sort_keys=True,
                       separators=(',', ':')).encode()).hexdigest()
        require(recomputed_inventory == archived_inventory.get('inventory_sha256'),
                'The archived inventory document does not reproduce its own digest')
        require(recomputed_inventory == inventory['inventory_sha256'],
                'The archived inventory document does not describe this member graph')
        require(archived_members == inventory['members'],
                'The archived inventory member list differs from the extracted graph')
        archived_document = archived_reduction.get('document')
        require(isinstance(archived_document, dict),
                'The archived reduction document holds no canonical document')
        recomputed_reduction = hashlib.sha256(
            json.dumps(archived_document, sort_keys=True,
                       separators=(',', ':')).encode()).hexdigest()
        require(recomputed_reduction == archived_reduction.get('sha256'),
                'The archived reduction document does not reproduce its own digest')
        require(recomputed_reduction == result['reduction']['sha256'],
                'The archived reduction document does not match the fresh stable reduction')
        require(archived_document == result['reduction']['document'],
                'The archived reduction document differs from the fresh document')
        result['archived_origin_root'] = archived_inventory.get('root')
    result['inventory_sha256'] = inventory['inventory_sha256']
    result['reduction_sha256'] = result['reduction']['sha256']
    return result


def stage_adapters(payload):
    directory = payload / 'libexec/baton2'
    directory.mkdir(parents=True)
    for harness in ('codex', 'omp', 'mcp'):
        for suffix in ('conductor', 'root'):
            name = harness + '-' + suffix + '.mjs'
            shutil.copyfile(ROOT / 'bend2/scripts' / name, directory / name)
    shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', directory / 'git-series.mjs')


def context_package_manifest(directory=None):
    source = (directory or CONTEXT_PACKAGE_DIR) / 'package.json'
    require(source.is_file(), 'The context package manifest is missing: ' + str(source))
    manifest = json.loads(source.read_text())
    require(manifest.get('name') == CONTEXT_PACKAGE_NAME,
            'The context package name is fixed: ' + CONTEXT_PACKAGE_NAME)
    require(manifest.get('private') is True, 'The context package must be private')
    require(manifest.get('type') == 'module', 'The context package must be an ECMAScript module package')
    require(manifest.get('engines') == {'node': CONTEXT_NODE_FLOOR},
            'The context package must pin the Node floor ' + CONTEXT_NODE_FLOOR)
    require(manifest.get('dependencies') == CONTEXT_DEPENDENCY_PINS,
            'Context dependencies must equal the approved exact pins '
            + repr(dict(sorted(CONTEXT_DEPENDENCY_PINS.items()))))
    return manifest


def context_lockfile(directory=None):
    source = (directory or CONTEXT_PACKAGE_DIR) / 'package-lock.json'
    require(source.is_file(), 'The context lockfile is missing: ' + str(source))
    lock = json.loads(source.read_text())
    require(lock.get('name') == CONTEXT_PACKAGE_NAME and lock.get('version') == '0.0.0',
            'The context lockfile must name ' + CONTEXT_PACKAGE_NAME + ' 0.0.0')
    require(lock.get('lockfileVersion') == 3, 'The context lockfile must use lockfileVersion 3')
    packages = lock.get('packages')
    require(isinstance(packages, dict), 'The context lockfile has no packages map')
    root = packages.get('')
    require(isinstance(root, dict), 'The context lockfile has no root entry')
    require(root.get('dependencies') == CONTEXT_DEPENDENCY_PINS,
            'Lock root dependencies must equal the approved exact pins')
    require(root.get('engines') == {'node': CONTEXT_NODE_FLOOR},
            'Lock root engines must pin the Node floor ' + CONTEXT_NODE_FLOOR)
    entries = {}
    for key, row in packages.items():
        if key == '':
            continue
        name = key.removeprefix('node_modules/')
        # Conflicting nested transitive versions would stage an ambiguous tree;
        # the approved closure resolves to one version per package.
        require(key == 'node_modules/' + name and '/' not in name,
                'Unexpected nested lock entry: ' + key)
        resolved = row.get('resolved')
        require(isinstance(resolved, str) and resolved.startswith('https://registry.npmjs.org/'),
                'Lock entry must resolve from the npm registry: ' + name)
        integrity = row.get('integrity')
        require(isinstance(integrity, str) and integrity.startswith('sha512-'),
                'Lock entry must carry a sha512 integrity: ' + name)
        digest = base64.b64decode(integrity[len('sha512-'):], validate=True)
        require(len(digest) == 64, 'Lock integrity must decode to a sha512 digest: ' + name)
        require(isinstance(row.get('version'), str), 'Lock entry has no version: ' + name)
        entries[name] = row
    for name, version in CONTEXT_DEPENDENCY_PINS.items():
        require(entries.get(name, {}).get('version') == version,
                'Lock must pin ' + name + ' at exactly ' + version)
    for name, row in entries.items():
        for dependency in row.get('dependencies', {}):
            require(dependency in entries,
                    'Lock closure is missing ' + dependency + ' required by ' + name)
    return entries


def fetch_context_dependencies(entries, logs):
    destination = logs / 'context-dependencies'
    destination.mkdir(parents=True, exist_ok=True)
    fetched = []
    for name, row in sorted(entries.items()):
        with urllib.request.urlopen(row['resolved'], timeout=300) as response:
            data = response.read()
        require(base64.b64encode(hashlib.sha512(data).digest()).decode('ascii')
                == row['integrity'][len('sha512-'):],
                'Dependency bytes do not match the lockfile integrity: ' + name)
        path = destination / (name + '.tgz')
        path.write_bytes(data)
        fetched.append({'name': name, 'version': row['version'], 'resolved': row['resolved'],
                        'integrity': row['integrity'],
                        'tarball': {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}})
    return fetched


def extract_context_dependency(payload, name, tarball_path):
    module = payload / CONTEXT_STAGE_ROOT / 'node_modules' / name
    module.mkdir(parents=True)
    extracted = 0
    with tarfile.open(tarball_path, 'r:gz') as archive:
        for member in archive.getmembers():
            member_path = PurePosixPath(member.name)
            require(not member_path.is_absolute() and '..' not in member_path.parts,
                    'Unsafe dependency archive member: ' + member.name)
            if not member.isfile():
                require(member.isdir() and member.name == 'package',
                        'Unsafe dependency archive member: ' + member.name)
                continue
            relative = member_path.relative_to('package')
            destination = module.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(member).read())
            destination.chmod(0o644)
            extracted += 1
    require(extracted > 0, 'Dependency archive staged no files: ' + name)
    return module


def context_tree_digest(directory):
    digest = hashlib.sha256()
    for relative, path in sorted((path.relative_to(directory).as_posix(), path)
                                 for path in directory.rglob('*') if path.is_file()):
        digest.update(relative.encode('utf-8'))
        digest.update(b'\0')
        digest.update(sha256(path).encode('ascii'))
        digest.update(b'\n')
    return digest.hexdigest()


def context_closure_manifest(entries, digests):
    packages = {name: {'version': row['version'], 'integrity': row['integrity'],
                       'treeSha256': digests[name]}
                for name, row in sorted(entries.items())}
    return {'schema': 'baton2-context-dependency-closure-v1', 'packages': packages}


def stage_context_sources(payload):
    directory = payload / CONTEXT_STAGE_ROOT
    directory.mkdir(parents=True)
    staged = []
    for source in sorted(CONTEXT_PACKAGE_DIR.rglob('*')):
        if not source.is_file():
            continue
        relative = source.relative_to(CONTEXT_PACKAGE_DIR)
        if relative.parts[0] == 'node_modules' or relative.as_posix() in ('package.json', 'package-lock.json'):
            continue
        destination = directory / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        destination.chmod(0o644)
        staged.append(relative.as_posix())
    return staged


def stage_context_notices(payload, entries):
    directory = payload / 'notices/context'
    directory.mkdir(parents=True, exist_ok=True)
    terms = {}
    for name, row in sorted(entries.items()):
        module = payload / CONTEXT_STAGE_ROOT / 'node_modules' / name
        files = []
        for candidate in sorted(module.rglob('*')):
            if not candidate.is_file():
                continue
            base = candidate.name.upper()
            if (base in ('LICENSE', 'NOTICE', 'COPYING')
                    or base.startswith(('LICENSE.', 'NOTICE.', 'COPYING.'))
                    or candidate.name in CONTEXT_EXTRA_NOTICES.get(name, ())):
                destination = directory / name / candidate.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(candidate, destination)
                files.append({'path': destination.relative_to(payload).as_posix(),
                              'source': CONTEXT_STAGE_ROOT + '/node_modules/' + name + '/'
                                        + candidate.relative_to(module).as_posix(),
                              **file_info(destination)})
        require(files, 'Staged dependency has no staged license or notice file: ' + name)
        terms[name] = {'version': row['version'], 'license': row.get('license'), 'files': files}
    lines = ['Context dependency terms staged from lockfile-resolved npm bytes verified',
             'against the lockfile integrity hashes.', '']
    for name, row in terms.items():
        lines.append(name + '@' + row['version'] + ' - ' + str(row['license'])
                     + ' - ' + ', '.join(item['path'] for item in row['files']))
    (directory / 'context-packages.md').write_text('\n'.join(lines) + '\n')
    return terms


def context_gate_environment(node, logs, name):
    home = logs / ('context-gate-home-' + name)
    scratch = logs / ('context-gate-tmp-' + name)
    home.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    return {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(home),
            'TMPDIR': str(scratch), 'LC_ALL': 'C'}


def context_node_identity(node, payload, logs, name, suffix=''):
    version = command([str(node), '--version'], payload,
                      context_gate_environment(node, logs, name), logs,
                      'context-node-version-' + name + suffix)
    return {'path': str(node.resolve()), 'bytes': node.stat().st_size,
            'sha256': sha256(node), 'version': version}


def child_signal(returncode):
    if returncode is not None and returncode < 0:
        try:
            return signal.Signals(-returncode).name
        except ValueError:
            return 'signal-' + str(-returncode)
    return None


def retained_stream(record, error):
    if error is not None:
        return {'path': record.name, 'available': False, 'error': error}
    if not record.is_file():
        return {'path': record.name, 'available': False, 'error': 'stream file is absent'}
    try:
        info = file_info(record)
    except BaseException as hash_error:
        return {'path': record.name, 'available': False, 'error': repr(hash_error)}
    return {'path': record.name, 'available': True, **info}


def snapshot_evidence(path, state, evidence_errors, label):
    try:
        write_json(path, state)
    except BaseException as error:
        evidence_errors.append(label + ' snapshot write failed: ' + repr(error))
        return {'path': path.name, 'available': False, 'error': repr(error)}
    try:
        info = file_info(path)
    except BaseException as error:
        evidence_errors.append(label + ' snapshot metadata read failed: ' + repr(error))
        return {'path': path.name, 'available': False, 'write': 'completed',
                'error': repr(error)}
    return {'path': path.name, 'available': True, **info}


def context_receipt_logs(logs):
    return sorted(path for pattern in ('context-gate-*', 'context-node-version-*')
                  for path in logs.glob(pattern) if path.is_file())


def context_tree_state(payload):
    directory = payload / CONTEXT_STAGE_ROOT
    return {path.relative_to(payload).as_posix(): file_info(path)
            for path in sorted(directory.rglob('*')) if path.is_file()}


def run_context_gate(payload, logs, node, name, extra_env=None):
    env = context_gate_environment(node, logs, name)
    if extra_env:
        env.update(extra_env)
    cwd = payload / CONTEXT_STAGE_ROOT
    node_identity = context_node_identity(node, payload, logs, name)
    stdout = logs / ('context-gate-' + name + '.stdout')
    stderr = logs / ('context-gate-' + name + '.stderr')
    before_path = logs / ('context-gate-' + name + '.payload-before.json')
    after_path = logs / ('context-gate-' + name + '.payload-after.json')
    evidence_errors = []
    before = context_tree_state(payload)
    before_ref = snapshot_evidence(before_path, before, evidence_errors, 'before-payload')
    started = time.monotonic()
    stream_errors = {}
    out_handle = None
    err_handle = None
    try:
        out_handle = stdout.open('wb')
    except OSError as error:
        stream_errors['stdout'] = repr(error)
    try:
        err_handle = stderr.open('wb')
    except OSError as error:
        stream_errors['stderr'] = repr(error)
    spawn_stage = 'completed'
    spawn_error = None
    interrupted = None
    close_interrupt = None
    outcome = None
    cleanup_evidence = None
    if stream_errors:
        spawn_stage = 'streams-unavailable'
        spawn_error = '; '.join(name + ': ' + value
                                for name, value in sorted(stream_errors.items()))
    else:
        process = None
        try:
            # Only a Popen construction failure proves non-creation.
            process = subprocess.Popen([str(node), 'context-package-gate.mjs'], cwd=cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=out_handle,
                                       stderr=err_handle)
        except (OSError, ValueError) as error:
            spawn_stage = 'unspawned'
            spawn_error = repr(error)
        except BaseException as error:
            spawn_stage = 'interrupted'
            spawn_error = repr(error)
            interrupted = error
        if process is not None:
            try:
                outcome = subprocess.CompletedProcess(process.args, process.wait())
                spawn_stage = 'completed'
            except BaseException as error:
                # The original wait interruption is recorded before any cleanup
                # attempt; kill and reap are each guarded with their own error,
                # a successful reap return code is settlement evidence rather
                # than an error, and a failed cleanup never claims the child
                # was not leaked.
                interrupted = error
                spawn_stage = 'started-outcome-unknown'
                spawn_error = repr(error)
                cleanup = {}
                try:
                    process.kill()
                    cleanup['killCompleted'] = True
                except BaseException as kill_error:
                    cleanup['kill'] = repr(kill_error)
                try:
                    cleanup['reapReturncode'] = process.wait()
                except BaseException as reap_error:
                    cleanup['reap'] = repr(reap_error)
                cleanup_evidence = cleanup
                # Only actual cleanup errors are evidence failures; positive
                # settlement facts (killCompleted, reapReturncode) are retained
                # on the child record without ever entering evidence errors.
                cleanup_failures = {key: value for key, value in cleanup.items()
                                    if key in ('kill', 'reap')}
                if cleanup_failures:
                    evidence_errors.append('child cleanup after interruption: '
                                           + json.dumps(cleanup_failures, sort_keys=True))
    for handle in (out_handle, err_handle):
        if handle is not None:
            try:
                handle.close()
            except BaseException as error:
                # Every close failure is retained as evidence. A fresh
                # KeyboardInterrupt/SystemExit while no interruption exists
                # becomes the first interruption and is re-raised after the
                # receipt write; a close failure after an existing
                # interruption is recorded without replacing that original
                # object, and the remaining handle is still closed.
                if (close_interrupt is None and interrupted is None
                        and isinstance(error, (KeyboardInterrupt, SystemExit))):
                    close_interrupt = error
                evidence_errors.append('stream close failed: ' + repr(error))
    secondary_error = None
    if interrupted is None:
        try:
            after = context_tree_state(payload)
            after_ref = snapshot_evidence(after_path, after, evidence_errors, 'after-payload')
        except BaseException as error:
            secondary_error = error
            after_ref = {'path': after_path.name, 'available': False, 'error': repr(error)}
        post_identity = None
        post_error = None
        try:
            post_identity = context_node_identity(node, payload, logs, name, '-after')
        except BaseException as error:
            post_error = repr(error)
    else:
        post_identity = None
        post_error = 'not attempted: the gate child raised an interruption'
        try:
            after = context_tree_state(payload)
            after_ref = snapshot_evidence(after_path, after, evidence_errors, 'after-payload')
        except BaseException as error:
            secondary_error = error
            after_ref = {'path': after_path.name, 'available': False, 'error': repr(error)}
    receipt_path = logs / ('context-gate-' + name + '.json')
    try:
        if post_identity is None:
            node_identity['postIdentity'] = {'available': False, 'error': post_error}
            node_identity['versionAfter'] = None
            node_identity['sha256After'] = None
            node_identity['bytesAfter'] = None
        else:
            node_identity['postIdentity'] = {'available': True, 'version': post_identity['version'],
                                             'sha256': post_identity['sha256'],
                                             'bytes': post_identity['bytes']}
            node_identity['versionAfter'] = post_identity['version']
            node_identity['sha256After'] = post_identity['sha256']
            node_identity['bytesAfter'] = post_identity['bytes']
        if outcome is not None:
            child = {'spawned': True, 'stage': spawn_stage}
        elif spawn_stage == 'started-outcome-unknown':
            child = {'spawned': True, 'stage': spawn_stage, 'error': spawn_error}
            if cleanup_evidence is not None:
                child['cleanup'] = cleanup_evidence
        else:
            child = {'spawned': None if interrupted is not None else False,
                     'stage': spawn_stage}
            if spawn_error is not None:
                child['error'] = spawn_error
        receipt = {'runtime': name, 'node': node_identity,
                   'argv': [str(node), 'context-package-gate.mjs'], 'cwd': str(cwd),
                   'environmentKeys': sorted(env),
                   'child': child,
                   'exit_code': None if outcome is None else outcome.returncode,
                   'signal': child_signal(None if outcome is None else outcome.returncode),
                   'elapsed_seconds': time.monotonic() - started,
                   'stdout': retained_stream(stdout, stream_errors.get('stdout')),
                   'stderr': retained_stream(stderr, stream_errors.get('stderr')),
                   'payloadSnapshot': {'before': before_ref, 'after': after_ref,
                                       'equal': None if not after_ref.get('available')
                                                else before == after},
                   'evidenceErrors': evidence_errors,
                   'nodeVersionChanged': None if post_identity is None
                                         else post_identity['version'] != node_identity['version'],
                   'nodeIdentityChanged': None if post_identity is None
                                          else (post_identity['sha256'] != node_identity['sha256']
                                                or post_identity['bytes'] != node_identity['bytes'])}
        write_json(receipt_path, receipt)
    except BaseException as error:
        # The FIRST interruption wins precedence across all subsequent
        # evidence failures: a pre-existing child/wait interrupt, then a
        # fresh close interrupt, then the first secondary capture failure.
        # Phase records in the receipt stay truthful regardless of which
        # original wins; the new failure is chained as its cause.
        original = interrupted
        if original is None:
            original = close_interrupt
        if original is None:
            original = secondary_error
        if original is not None:
            raise original from error
        raise
    if interrupted is not None:
        if secondary_error is not None:
            raise interrupted from secondary_error
        # The completed receipt retains the evidence; interruption semantics
        # are preserved instead of converting the interrupt into a refusal.
        raise interrupted
    if close_interrupt is not None:
        # A fresh interruption during close becomes the first interruption;
        # the completed receipt retains all recorded evidence.
        raise close_interrupt
    require(spawn_stage == 'completed',
            'The context gate child did not complete (stage ' + spawn_stage + '): '
            + str(receipt_path))
    require(post_identity is not None,
            'The context gate node identity is unavailable after the package gate: '
            + str(receipt_path))
    require(not receipt['nodeVersionChanged'],
            'The context gate node reported a different version after the package gate: '
            + str(receipt_path))
    require(not receipt['nodeIdentityChanged'],
            'The context gate node executable bytes changed during the package gate: '
            + str(receipt_path))
    require(receipt['stdout']['available'] and receipt['stderr']['available'],
            'The context gate raw stream evidence is incomplete: ' + str(receipt_path))
    require(receipt['payloadSnapshot']['before']['available']
            and receipt['payloadSnapshot']['after']['available'],
            'The context payload snapshot evidence is incomplete: ' + str(receipt_path))
    require(secondary_error is None,
            'The context gate after-outcome evidence capture failed: ' + str(receipt_path))
    require(not receipt['evidenceErrors'],
            'The context gate evidence retention reported errors: ' + str(receipt_path))
    require(receipt['payloadSnapshot']['equal'],
            'The context payload changed during the package gate: ' + str(receipt_path))
    return receipt, stdout.read_text(errors='replace')


def require_gate_report(text, expected_packages):
    require(text.strip(), 'The context package gate printed no report')
    report = json.loads(text)
    require(report.get('gate') == 'baton2-context-package-gate',
            'Unexpected context gate report identity')
    closure = report.get('closure')
    require(isinstance(closure, dict) and closure.get('digestsVerified') is True
            and closure.get('packages') == expected_packages,
            'The context gate closure verification is missing or incomplete')
    stages = report.get('stages')
    require(isinstance(stages, list) and len(stages) == 3,
            'The context gate report is missing probes')
    ajv, zod_probe, typescript = stages
    require(ajv.get('version') == '8.17.1' and len(ajv.get('invalidErrors', [])) >= 2,
            'The Ajv gate probe is not useful')
    require(zod_probe.get('version') == '4.3.6'
            and zod_probe.get('validValue') == {'id': 7, 'name': 'report'}
            and len(zod_probe.get('invalidIssues', [])) >= 2,
            'The Zod gate probe is not useful')
    require(typescript.get('version') == '5.9.3'
            and typescript.get('resolvedDeclarationType') == '(name: string) => string'
            and typescript.get('messageType') == 'string',
            'The TypeScript gate probe is not useful')
    return report


def run_context_gates(payload, logs, args, entries):
    runs = []
    floor = {'requested': '22.15.0'}
    if args.context_node22 is not None:
        node22 = args.context_node22.resolve()
        identity = context_node_identity(node22, payload, logs, 'floor')
        require(identity['version'] == 'v22.15.0',
                'The supplied context floor node is not v22.15.0: ' + identity['version'])
        floor['available'] = True
        floor['node'] = identity
        receipt, text = run_context_gate(payload, logs, node22, 'node22.15.0')
        require(receipt['exit_code'] == 0,
                'The context package gate failed on the Node 22.15.0 floor; see '
                + str(logs / 'context-gate-node22.15.0.json'))
        require_gate_report(text, len(entries))
        runs.append(receipt)
    else:
        floor['available'] = False
        floor['reason'] = ('No --context-node22 executable was supplied; '
                           'floor gate evidence is pending provision.')
    host_node = executable('node')
    receipt, text = run_context_gate(payload, logs, host_node, 'host')
    require(receipt['exit_code'] == 0,
            'The context package gate failed on the host Node; see '
            + str(logs / 'context-gate-host.json'))
    require_gate_report(text, len(entries))
    runs.append(receipt)
    return {'floor': floor, 'runs': runs}


def compose_context(payload, logs, args):
    entries = context_lockfile()
    context_package_manifest()
    fetched = fetch_context_dependencies(entries, logs)
    staged_first_party = stage_context_sources(payload)
    for row in fetched:
        extract_context_dependency(payload, row['name'],
                                   logs / 'context-dependencies' / (row['name'] + '.tgz'))
    digests = {name: context_tree_digest(payload / CONTEXT_STAGE_ROOT / 'node_modules' / name)
               for name in entries}
    closure = context_closure_manifest(entries, digests)
    (payload / CONTEXT_STAGE_ROOT / 'dependency-closure.json').write_text(
        json.dumps(closure, indent=2, sort_keys=True) + '\n')
    terms = stage_context_notices(payload, entries)
    gate = run_context_gates(payload, logs, args, entries)
    return {'pins': dict(sorted(CONTEXT_DEPENDENCY_PINS.items())),
            'manifest': {'path': 'bend2/context/package.json',
                         **file_info(CONTEXT_PACKAGE_DIR / 'package.json')},
            'lockfile': {'path': 'bend2/context/package-lock.json',
                         **file_info(CONTEXT_PACKAGE_DIR / 'package-lock.json')},
            'dependencies': fetched,
            'stagedFirstParty': staged_first_party,
            'dependencyClosure': closure,
            'gate': gate,
            'terms': terms}


def append_context_distribution(payload, terms):
    lines = ['',
             'Context dependencies are staged from lockfile-resolved npm tarballs verified',
             'against the lockfile integrity hashes before staging.']
    for name, row in terms.items():
        lines.append(name + '@' + row['version'] + ' is distributed under ' + str(row['license'])
                     + '; staged terms: ' + ', '.join(item['path'] for item in row['files']) + '.')
    with (payload / 'notices/distribution.md').open('a') as distribution:
        distribution.write('\n'.join(lines) + '\n')




def stage_notices(payload, archive_notices, kind='development'):
    directory = payload / 'notices'
    directory.mkdir()
    terms = {'baton_root_license': None, 'baton_root_notice': None,
             'bend_reference_license': 'notices/bend-reference-LICENSE',
             'bend_compiler_runtime_license': {'path': 'notices/bend-2.0.25-LICENSE',
                                              'url': COMPILER_LICENSE_URL,
                                              'sha256': COMPILER_LICENSE_SHA256}}
    distribution = ['This is a Baton2 native ' + kind + ' artifact.']
    for name, field in (('LICENSE', 'baton_root_license'), ('NOTICE', 'baton_root_notice')):
        source = ROOT / name
        if source.is_file():
            destination = directory / ('baton2-' + name)
            shutil.copyfile(source, destination)
            terms[field] = {'source_path': name,
                            'path': destination.relative_to(payload).as_posix(),
                            **file_info(destination)}
            distribution.append('baton2-' + name + ' contains the Baton2 project '
                                + name.lower() + ' copied from root ' + name + '.')
    if terms['baton_root_license'] is None:
        distribution.extend(['This source snapshot has no root LICENSE.',
                             'The maintainer must resolve Baton2 distribution terms before a public release.'])
    reference = ROOT / 'docs/bend2/reference/upstream/LICENSE'
    require(sha256(reference) == COMPILER_LICENSE_SHA256, 'The upstream Bend license differs from its versioned pin')
    shutil.copyfile(reference, directory / 'bend-reference-LICENSE')
    shutil.copyfile(reference, directory / 'bend-2.0.25-LICENSE')
    for path, data in archive_notices:
        destination = directory / 'compiler-archive' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    distribution.extend([
        'bend-2.0.25-LICENSE is the pinned upstream compiler/runtime license at ' + COMPILER_LICENSE_URL + '.',
        'bend-reference-LICENSE applies to the separately pinned Bend reference.',
        'compiler-archive/ retains any license and notice files found in the verified Bend archive.'])
    (directory / 'distribution.md').write_text('\n'.join(distribution) + '\n')
    return terms


def check_project_terms(terms, source_files, files):
    sources = {entry['path']: entry for entry in source_files}
    staged = {entry['path']: entry for entry in files}
    for name, field in (('LICENSE', 'baton_root_license'), ('NOTICE', 'baton_root_notice')):
        source = sources.get(name)
        path = 'notices/baton2-' + name
        expected = None if source is None else {
            'source_path': name, 'path': path, 'bytes': source['bytes'], 'sha256': source['sha256']}
        require(terms[field] == expected, 'Baton2 ' + name + ' terms differ from the source inventory')
        file_expected = None if expected is None else {
            key: expected[key] for key in ('path', 'bytes', 'sha256')}
        require(staged.get(path) == file_expected, 'Baton2 ' + name + ' file differs from its terms')


def artifact_identity(release_version):
    if release_version is None:
        return {'archive_root': ARCHIVE_ROOT, 'kind': 'development'}
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', release_version) is not None,
            'Release version must be a single identifier starting with a letter or digit and containing letters, digits, dots, underscores, plus signs or hyphens')
    require((ROOT / 'LICENSE').is_file(), 'Release packaging requires the project root LICENSE')
    return {'archive_root': 'baton2-' + release_version + '-darwin-arm64',
            'kind': 'release', 'version': release_version}


def package(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    logs = output / 'gates'
    logs.mkdir()
    result = {'status': 'running', 'source_directory': str(ROOT), 'output': str(output)}
    write_json(output / 'result.json', result)
    try:
        require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'This native artifact requires a Darwin arm64 build host')
        initial = snapshot()
        same_source(initial, initial)
        context_package_manifest()
        context_entries = context_lockfile()
        identity = artifact_identity(args.release_version)
        compiler = args.bend.resolve()
        env = dict(os.environ, BEND=str(compiler), BEND_NO_TELEMETRY='1')
        if args.gate_receipt:
            receipt, summary = reuse_gates(args.gate_receipt.resolve(), args.gate_receipt_sha256, compiler, logs, initial)
        before_inputs = inputs(compiler, env, logs, 'before')
        archive, notices = archive_inputs(args.compiler_archive.resolve(), compiler)
        write_json(output / 'compiler-archive.json', archive)
        if args.controls_evidence:
            destination = output / 'controls-evidence'
            require(not destination.exists(),
                    'The controls evidence destination already exists: ' + str(destination))
            controls = controls_evidence(args.controls_evidence, initial, compiler,
                                         audit=logs / 'classifier-audit', destination=destination)
        else:
            controls = None
        if args.gate_receipt:
            if summary.get('route') == 'remote-module-groups':
                record = summary.get('controls_evidence') or {}
                require(controls is not None,
                        'A remote-route receipt must be supplied with its producer evidence')
                for field, fresh in (('sha256', controls['sha256']),
                                     ('binding', controls['binding']),
                                     ('closure_sha256', controls['closure_sha256']),
                                     ('inventory_sha256', controls['inventory_sha256']),
                                     ('reduction_sha256', controls['reduction_sha256'])):
                    require(fresh == record.get(field),
                            'The supplied controls evidence differs from the receipt at '
                            + field + ': fresh ' + str(fresh) + ', recorded '
                            + str(record.get(field)))
            require(summary['inputs_after'] == before_inputs, 'The receipt toolchain or host inputs differ from current inputs')
            input_boundary = 'Compiler libraries, CC and host captured after the supplied gates and checked again during packaging.'
        else:
            if args.ordinary_index is not None:
                source_root = ordinary_root(args.ordinary_index, args.ordinary_run)
                output_root = Path(args.output).resolve()
                require(source_root.resolve() != output_root
                        and output_root not in source_root.resolve().parents
                        and source_root.resolve() not in output_root.parents,
                        'The ordinary evidence run root and the package output must be disjoint')
                require(source_root.resolve() != ROOT.resolve()
                        and ROOT.resolve() in source_root.resolve().parents,
                        'The ordinary evidence run root must be a run-private directory inside '
                        'this repository')
            receipt, summary = run_gates(compiler, env, logs, initial, before_inputs,
                                         remote=controls, ordinary=args.ordinary_index,
                                         ordinary_root_path=args.ordinary_run)
            input_boundary = ('Compiler libraries, CC and host captured before and after the three gates.'
                              if controls is None else
                              'The laws obligation was carried by the remote module-group controls; '
                              'compiler libraries, CC and host captured before and after the two local gates.')
        binary = ROOT / '.scratch/bend2/baton2'
        generated = ROOT / '.scratch/bend2/baton2.c'
        require(binary.is_file() and generated.is_file(), 'The gated executable and generated C are required')
        require(command(['lipo', '-archs', str(binary)], ROOT, env, logs, 'binary-architectures') == 'arm64',
                'The gated executable must contain the arm64 architecture')
        linked = command(['otool', '-L', str(binary)], ROOT, env, logs, 'linked-libraries')
        command(['otool', '-l', str(binary)], ROOT, env, logs, 'mach-o-load-commands')
        libraries = []
        for line in linked.splitlines()[1:]:
            name = line.strip().split(' (', 1)[0]
            path = Path(name)
            libraries.append({'path': name, 'file': file_info(path) if path.is_file() else None,
                              'capture': 'regular file' if path.is_file() else 'load-command reference; file bytes unavailable'})
        after_inputs = inputs(compiler, env, logs, 'package-end')
        require(after_inputs == before_inputs, 'Toolchain or host inputs changed during packaging')
        final = snapshot()
        same_source(final, initial)
        require(final['binary_sha256'] == summary['after']['binary_sha256'], 'The gated native executable changed before packaging')
        payload = output / identity['archive_root']
        (payload / 'bin').mkdir(parents=True)
        shutil.copyfile(binary, payload / 'bin/baton2')
        (payload / 'bin/baton2').chmod(0o755)
        stage_adapters(payload)
        shutil.copytree(logs, payload / 'logs')
        archived = None
        if controls is not None:
            copied = (controls['inventory'] or {}).get('copied')
            require(copied, 'The verified controls closure was not copied for archiving')
            archived = payload / 'controls-evidence'
            require(not archived.exists(), 'The payload already holds controls evidence')
            shutil.copytree(copied, archived)
            write_json(archived / 'inventory.json', controls['inventory'])
            write_json(archived / 'reduction.json', controls['reduction'])
            archived_documents = {name: sha256(archived / name) for name in ARCHIVE_METADATA}
            require(verify_archived_inventory(archived, controls['inventory'],
                                              archived_documents)['members'],
                    'The archived controls closure holds no member')
        terms = stage_notices(payload, notices, identity['kind'])
        context = compose_context(payload, logs, args)
        context['dependencyClosureEntries'] = len(context_entries)
        terms['context_packages'] = context.pop('terms')
        append_context_distribution(payload, terms['context_packages'])
        receipt_logs = context_receipt_logs(logs)
        for receipt_log in receipt_logs:
            shutil.copyfile(receipt_log, payload / 'logs' / receipt_log.name)
        after_context = snapshot()
        same_source(after_context, final)
        generated_dir = output / 'generated'
        generated_dir.mkdir()
        shutil.copyfile(generated, generated_dir / 'baton2.c')
        files = [{'path': path.relative_to(payload).as_posix(), **file_info(path)}
                 for path in sorted(payload.rglob('*')) if path.is_file()]
        source_files = [{'path': name, **file_info(ROOT / name)}
                        for name in git('ls-files', 'bend2', 'docs/bend2/reference', '.github/workflows/bend2-native.yml',
                                        'LICENSE', 'NOTICE').splitlines()
                        if (ROOT / name).is_file()]
        check_project_terms(terms, source_files, files)
        manifest = {
            'schema': 'baton2-native-artifact-v1', **identity,
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': 'darwin-arm64',
            'source': {'commit': final['head'], 'tree': final['tree'], 'bend2_tree': final['bend2_tree'],
                       'directory': str(ROOT), 'status': final['status'], 'files': source_files},
            'binary': {'path': 'bin/baton2', **file_info(binary)}, 'files': files,
            'build': {'inputs_before': before_inputs, 'inputs_after': after_inputs,
                      'input_capture_boundary': input_boundary, 'compiler_archive': archive,
                      'generated_c': {'path': str(generated), **file_info(generated)},
                      'linked_libraries': libraries,
                      'context': context},
            'gates': {'receipt': 'logs/summary.json', **file_info(receipt),
                      'validation': summary['validation'], 'reused': bool(args.gate_receipt),
                      'route': summary.get('route', 'local-complete'),
                      **({'controls': controls} if controls else {})},
            'terms': terms,
        }
        if controls is not None:
            manifest['gates']['controls']['archived'] = {
                'path': 'controls-evidence',
                'original_root': controls['inventory']['root'],
                'excluded_metadata': list(ARCHIVE_METADATA),
                'inventory_sha256': controls['inventory_sha256'],
                'reduction_sha256': controls['reduction_sha256'],
                'origin': controls['origin'],
                'members': len(controls['inventory']['members']),
                'documents': archived_documents}
        write_json(payload / 'manifest.json', manifest)
        shutil.copyfile(payload / 'manifest.json', output / 'manifest.json')
        destination = output / (identity['archive_root'] + '-' + final['head'] + '.tar.gz')
        with tarfile.open(destination, 'x:gz') as artifact:
            artifact.add(payload, arcname=identity['archive_root'])
        require(sha256(payload / 'bin/baton2') == final['binary_sha256'], 'The staged executable changed')
        same_source(snapshot(), final)
        archive_sha = sha256(destination)
        (output / 'SHA256SUMS').write_text(archive_sha + '  ' + destination.name + '\n')
        result.update(status='packaged', archive={'path': destination.name, **file_info(destination)},
                      manifest={'path': 'manifest.json', **file_info(output / 'manifest.json')},
                      gate_summary=str(receipt), gate_summary_sha256=sha256(receipt), source=final)
        write_json(output / 'result.json', result)
        print(json.dumps(result), flush=True)
    except BaseException as error:
        result.update(status='failed', error=repr(error))
        write_json(output / 'result.json', result)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='new owned output directory, retained on failure')
    parser.add_argument('--bend', required=True, type=Path)
    parser.add_argument('--compiler-archive', required=True, type=Path, help='preserved official Darwin arm64 Bend 2.0.25 archive')
    parser.add_argument('--release-version', help='version identifier for a release archive; requires the project root LICENSE')
    parser.add_argument('--gate-receipt', type=Path, help='reuse a completed exact-source three-gate summary')
    parser.add_argument('--gate-receipt-sha256', help='required SHA256 pin when reusing a gate receipt')
    parser.add_argument('--context-node22', type=Path,
                        help='exact Node v22.15.0 executable for the context package floor gate')
    parser.add_argument('--ordinary-index', type=Path,
                        help='the checker retained ordinary evidence index for this run, consumed as gate evidence')
    parser.add_argument('--ordinary-run', type=Path,
                        help='the run root the ordinary evidence index belongs to, checked against the index location')
    parser.add_argument('--controls-evidence', type=Path,
                        help='directory holding controls-summary.json and its control logs, validated against this source')
    args = parser.parse_args()
    require(bool(args.gate_receipt) == bool(args.gate_receipt_sha256), 'Gate receipt and SHA256 must be supplied together')
    package(args)


if __name__ == '__main__':
    main()
