#!/usr/bin/env python3
"""Remote differential oracle harness for the Receive output view. DO NOT RUN LOCALLY.

This harness compares, for every case in a hashed input manifest, three things: the
independently written expectation, the structured facts reported by the pure candidate, and
the facts extracted from the admitted artifact's linked SQLite by evaluating the original
frame_kind and filter_mode_sql expressions.

Fact representation. A fact is null, a boolean, a string, a list, or an object. A numeric fact
is an object with exactly one key, "lexeme", whose value is the exact original spelling as a
string, because a bare JSON number would let the host language equate distinct spellings and
would let a boolean compare equal to a number. A bare number anywhere in a result or an
expectation is a protocol failure. An object carrying the reserved key lexeme together with
any other key is a protocol failure rather than a numeric fact, and every other object is
compared field by field, so an added or missing key is always a difference. Comparison is
kind sensitive and recursive: missing keys,
extra keys, list length and list order are all reported.

Manifest schema, receive-output-view-oracle/1:

  {
    "schema": "receive-output-view-oracle/1",
    "bridges": {
      "candidate": {"identity": ..., "present": false, "absent_reason": ...,
                    "path": ..., "sha256": ...},
      "oracle":    {"identity": ..., "present": false, "absent_reason": ...,
                    "expressions_bound": false, "path": ..., "sha256": ...}
    },
    "dependency": {
      "artifact":  {"identity": ..., "path": ..., "sha256": ...},
      "candidate": {"identity": ..., "path": ..., "pin": ..., "tree": ...,
                    "source_sha256": {name: sha}},
      "original":  {"identity": ..., "path": ..., "pin": ..., "tree": ...,
                    "source_sha256": {name: sha}},
      "sqlite":    {"identity": ..., "path": ..., "sha256": ...},
      "compiler":  {"identity": ..., "path": ..., "sha256": ...},
      "oracle":    {"identity": ..., "path": ..., "pin": ..., "tree": ...,
                    "source_sha256": {name: sha},
                    "expressions": {
                      "frame_kind":      {"text_sha256": ...,
                                          "source": {"path": ..., "first_line": ..., "last_line": ...},
                                          "source_commit": {"pin": ..., "tree": ...}},
                      "filter_mode_sql": {"text_sha256": ..., "source": {...}, "source_commit": {...}}
                    }}
    },
    "invocation": {
      "candidate": {"executable": ..., "argv": [...], "protocol": "json-lines"},
      "oracle":    {"executable": ..., "argv": [..., "{expressions_dir}", ...],
                    "protocol": "json-lines"}
    },
    "cases": [
      {"name": ..., "octets_hex": ..., "octets_sha256": ...,
       "expected": {"disposition": ..., "fields": {...}}}
    ]
  }

The manifest carries the input octets, the expected dispositions and fields, the complete
case definitions, both invocation commands and every dependency identity, so a case is
defined by hashed manifest content and nothing is taken from the caller. Each oracle
expression is declared as a provenance record: source path, first and last line, the commit
pin and tree those lines belong to, and the hash of the extracted text; the harness
re-extracts that text, verifies its hash before any invocation, writes the verified text into
a directory, and substitutes that directory into the declared oracle argv placeholder, so the
verified text is supplied to the invoked bridge rather than a label. It does not establish
that the bridge
evaluated that text, that the source commit label is a verified Git linkage, or that the
linked SQLite is the one the artifact loads; those require the real adapter and extractor plus
admitted evidence. Every path resolves against one documented base, the working directory
given on the command line, which the harness resolves once, records, and applies to every
manifest path before any hashing and to the argv head, which must resolve to the verified
bridge file; the manifest argument itself resolves against the launching process's working
directory. Arguments after the argv head stay protocol arguments and are not interpreted as
file paths.

What hashes prove and what they do not. A verified hash proves that the named bytes were
present at the named path when the harness ran. It does not prove that a build consumed them,
that the invoked executable is the artifact built from them, or that the linked SQLite is the
one the artifact loads. Those remain admitted-run evidence, and each invocation declares its
executable, which must be one of the verified files and must match the invoked argv head. The
harness refuses to invoke at all while either bridge is declared absent, which is the state
today: no candidate adapter emits the pure module's structured facts for a frame, and no
linked-SQLite extractor bound to the verified expressions exists.

Exit codes. Zero means every case matched from both sides. One means valid structured facts
were observed to differ from the expectation, or from each other, in a named field. Two means
inconclusive: the manifest, a dependency, a bridge, an invocation, a launch, an exit status or
the result protocol prevented observation. A compile, setup, launch or protocol failure is
inconclusive and is never recorded as a semantic rejection of the behaviour under test. A
conclusion is reported for a case only when both roles produced valid facts.

Per-case evidence, retained independently per role: the case name, its octets hash, each
role's exact argv and executable, process exit, stdout and stderr hashes, and either the
parsed facts or the parse or launch failure. The case is registered in the report before
either role is invoked, each role's evidence is retained before it is parsed, and a role-local
launch or protocol failure is recorded as that role's failure so a later failure never
discards an already observed side. This is in-memory accumulation: the report is emitted once,
at completion, and no incremental or durable output is written per case. The verified argv
head is preserved through launch construction, and placeholders bind only in protocol
arguments, so a bridge whose own path contains the placeholder is refused rather than
substituted.

Named negative controls that must identify their designated semantic mismatch on a successful
build, once the bridges exist: filter-only-in-delta, filter-stderr, advance-only-when-visible,
reset-state-at-cursor, note-without-phase, finish-on-child-exit, raw-export-via-line-plus-LF,
resolve-latest, view-calls-consume, nested-boolean-versus-number, nested-missing-field,
nested-extra-field, and exact-numeric-lexeme. The last four are exercised without any bridge
by the self-check mode below. Duplicate-member and numeric-precision dataset controls remain
dependent on a real run and are not claimed before it.

Self-check. Running with --self-check exercises the comparator and the fact validator against
in-script control data and reports the taxonomy for each control: a control whose equality
outcome is wrong is a harness defect and exits one; a control whose rejection is expected and
observed is a pass. This runs no bridge, reads no manifest and invokes nothing.

This file is source preparation. Running it locally is out of scope.
"""

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

MATCHED = 0
MISMATCH = 1
INCONCLUSIVE = 2

SCHEMA = 'receive-output-view-oracle/1'
ROLES = ('candidate', 'oracle')
DEPENDENCIES = ('artifact', 'candidate', 'original', 'sqlite', 'compiler', 'oracle')
EXPRESSIONS = ('frame_kind', 'filter_mode_sql')
LEXEME = 'lexeme'
EXPECTED_KEYS = ('disposition', 'fields')


class Blocker(Exception):
    """Observation was prevented. Never a rejection of the behaviour under test."""


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def digest_file(path):
    return digest_bytes(pathlib.Path(path).read_bytes())


def strict_json(text, label):
    """JSON with duplicate keys and non-finite numbers rejected for this protocol."""

    def no_duplicates(pairs):
        seen = set()
        for key, _value in pairs:
            if key in seen:
                raise ValueError(f'duplicate key {key!r}')
            seen.add(key)
        return dict(pairs)

    def no_constant(name):
        raise ValueError(f'non-finite number {name}')

    def no_decimal(value):
        raise ValueError(f'decimal literal {value} where an exact lexeme string is required')

    try:
        return json.loads(text, object_pairs_hook=no_duplicates, parse_constant=no_constant,
                          parse_float=no_decimal)
    except (json.JSONDecodeError, ValueError) as exc:
        raise Blocker(f'{label} is not strict JSON: {exc}')


def validate_fact(value, path):
    """A fact is null, a boolean, a string, a list or an object; numbers carry their lexeme."""
    if value is None or isinstance(value, (bool, str)):
        return
    if isinstance(value, int) or isinstance(value, float):
        raise Blocker(f'{path} is a bare number; a numeric fact must carry its exact lexeme')
    if isinstance(value, list):
        for index, item in enumerate(value):
            validate_fact(item, f'{path}[{index}]')
        return
    if isinstance(value, dict):
        if LEXEME in value:
            if list(value.keys()) != [LEXEME]:
                raise Blocker(f'{path} is a reserved numeric wrapper carrying more than its '
                              f'{LEXEME} key; a numeric fact is exactly one {LEXEME} key')
            if not isinstance(value[LEXEME], str):
                raise Blocker(f'{path}.{LEXEME} is not a string')
            return
        for key in value:
            if not isinstance(key, str):
                raise Blocker(f'{path} has a non-string key')
        for key in sorted(value):
            validate_fact(value[key], f'{path}.{key}')
        return
    raise Blocker(f'{path} has an unsupported type {type(value).__name__}')


def fact_differences(expected, observed, path):
    """Kind-sensitive recursive differences, including missing and extra keys."""
    if isinstance(expected, dict) and list(expected.keys()) == [LEXEME]:
        if not (isinstance(observed, dict) and list(observed.keys()) == [LEXEME]):
            return [f'{path}: expected numeric {LEXEME}, observed {observed!r}']
        if observed[LEXEME] != expected[LEXEME]:
            return [f'{path}.{LEXEME}: {observed[LEXEME]!r} does not equal {expected[LEXEME]!r}']
        return []
    if isinstance(expected, dict):
        if not isinstance(observed, dict):
            return [f'{path}: expected an object, observed {observed!r}']
        differences = []
        for key in sorted(set(expected) - set(observed)):
            differences.append(f'{path}.{key}: missing from the observed facts')
        for key in sorted(set(observed) - set(expected)):
            differences.append(f'{path}.{key}: reported but not declared as expected')
        for key in sorted(set(expected) & set(observed)):
            differences.extend(fact_differences(expected[key], observed[key], f'{path}.{key}'))
        return differences
    if isinstance(expected, list):
        if not isinstance(observed, list):
            return [f'{path}: expected a list, observed {observed!r}']
        if len(expected) != len(observed):
            return [f'{path}: expected {len(expected)} items, observed {len(observed)}']
        differences = []
        for index, item in enumerate(expected):
            differences.extend(fact_differences(item, observed[index], f'{path}[{index}]'))
        return differences
    if isinstance(expected, bool) or isinstance(observed, bool):
        if not (isinstance(expected, bool) and isinstance(observed, bool)):
            return [f'{path}: kind differs, expected {expected!r}, observed {observed!r}']
        return [] if expected == observed else [f'{path}: {observed!r} does not equal {expected!r}']
    if type(expected) is not type(observed):
        return [f'{path}: kind differs, expected {expected!r}, observed {observed!r}']
    return [] if expected == observed else [f'{path}: {observed!r} does not equal {expected!r}']


def resolve_path(base, value):
    """One explicit base: an absolute path is kept, a relative one resolves against base."""
    if not isinstance(value, str) or not value:
        raise Blocker('a manifest path is missing or is not a string')
    path = pathlib.Path(value)
    return (path if path.is_absolute() else pathlib.Path(base) / path).resolve()


def verified_file(entry, label, base):
    if not isinstance(entry, dict):
        raise Blocker(f'{label} is not a record')
    path = resolve_path(base, entry.get('path'))
    declared = entry.get('sha256')
    if not declared:
        raise Blocker(f'{label} must declare a hash')
    if not path.is_file():
        raise Blocker(f'{label} is missing: {path}')
    actual = digest_file(path)
    if actual != declared:
        raise Blocker(f'{label} hash mismatch: {actual}')
    if not entry.get('identity'):
        raise Blocker(f'{label} must declare an identity label')
    return {'identity': entry['identity'], 'sha256': actual, 'path': str(path)}


def verified_tree(entry, label, base):
    if not isinstance(entry, dict):
        raise Blocker(f'{label} is not a record')
    declared = entry.get('source_sha256')
    if not isinstance(declared, dict) or not declared:
        raise Blocker(f'{label} must declare at least one file to verify')
    root = resolve_path(base, entry.get('path'))
    for name, sha in sorted(declared.items()):
        path = root / name
        if not path.is_file():
            raise Blocker(f'{label} file is missing: {name}')
        if digest_file(path) != sha:
            raise Blocker(f'{label} hash mismatch: {name}')
    if not entry.get('pin') or not entry.get('tree'):
        raise Blocker(f'{label} must declare a pin and a tree')
    return {'identity': entry.get('identity', ''), 'pin': entry['pin'], 'tree': entry['tree'],
            'files': sorted(declared), 'root': str(root)}


def extracted_expression(name, record, base):
    """The exact text of one oracle expression, taken from its declared source lines."""
    source = record.get('source')
    if not isinstance(source, dict):
        raise Blocker(f'oracle expression {name} declares no source provenance')
    for key in ('path', 'first_line', 'last_line'):
        if key not in source:
            raise Blocker(f'oracle expression {name} is missing {key}')
    if type(source['first_line']) is not int or type(source['last_line']) is not int:
        raise Blocker(f'oracle expression {name} declares non-integer line numbers')
    if source['first_line'] < 1 or source['last_line'] < source['first_line']:
        raise Blocker(f'oracle expression {name} declares an empty line range')
    commit = record.get('source_commit')
    if not isinstance(commit, dict) or not commit.get('pin') or not commit.get('tree'):
        raise Blocker(f'oracle expression {name} declares no source commit')
    path = resolve_path(base, source['path'])
    if not path.is_file():
        raise Blocker(f'oracle expression source is missing: {source["path"]}')
    lines = path.read_text(encoding='utf-8').splitlines()
    if source['last_line'] > len(lines):
        raise Blocker(f'oracle expression {name} declares a range past the end of its source')
    text = '\n'.join(lines[source['first_line'] - 1:source['last_line']])
    if digest_bytes(text.encode('utf-8')) != record.get('text_sha256'):
        raise Blocker(f'oracle expression text hash mismatch: {name}')
    return text


def verify_dependency(manifest, base):
    dependency = manifest.get('dependency')
    if not isinstance(dependency, dict):
        raise Blocker('dependency identities are missing')
    for key in DEPENDENCIES:
        if key not in dependency:
            raise Blocker(f'dependency identity is missing: {key}')
    verified = {'artifact': verified_file(dependency['artifact'], 'admitted artifact', base),
                'sqlite': verified_file(dependency['sqlite'], 'linked sqlite', base),
                'compiler': verified_file(dependency['compiler'], 'compiler', base),
                'candidate': verified_tree(dependency['candidate'], 'candidate source', base),
                'original': verified_tree(dependency['original'], 'original source', base)}
    oracle = dependency['oracle']
    verified['oracle'] = verified_tree(oracle, 'oracle extraction', base)
    expressions = oracle.get('expressions')
    if not isinstance(expressions, dict):
        raise Blocker('oracle expressions are missing')
    for name in EXPRESSIONS:
        record = expressions.get(name)
        if not isinstance(record, dict):
            raise Blocker(f'oracle expression is missing or is not a provenance record: {name}')
        key = record.get('source_commit', {}).get('pin', '')
        verified[f'expression_{name}'] = {
            'text_sha256': digest_bytes(extracted_expression(name, record, base).encode('utf-8')),
            'source_commit': key}
    return verified


def verify_bridge(manifest, role, base):
    bridges = manifest.get('bridges')
    if not isinstance(bridges, dict):
        raise Blocker('bridge declarations are missing')
    bridge = bridges.get(role)
    if not isinstance(bridge, dict):
        raise Blocker(f'{role} bridge declaration is missing')
    if bridge.get('present') is not True:
        raise Blocker(f'{role} bridge is declared absent: {bridge.get("absent_reason", "no reason")}')
    verified = verified_file(bridge, f'{role} bridge', base)
    if role == 'oracle' and bridge.get('expressions_bound') is not True:
        raise Blocker('the oracle bridge does not declare the verified expressions bound')
    return verified


PLACEHOLDER = '{expressions_dir}'


def invocation(manifest, role, bridge, base):
    declared = manifest.get('invocation')
    if not isinstance(declared, dict) or role not in declared:
        raise Blocker(f'{role} invocation is not declared')
    entry = declared[role]
    if not isinstance(entry, dict):
        raise Blocker(f'{role} invocation is not a record')
    argv = entry.get('argv')
    if not isinstance(argv, list) or not argv or not all(isinstance(a, str) and a for a in argv):
        raise Blocker(f'{role} argv must be a non-empty list of non-empty strings')
    if any('\x00' in argument for argument in argv):
        raise Blocker(f'{role} argv contains a forbidden NUL byte')
    if entry.get('protocol') != 'json-lines':
        raise Blocker(f'{role} result protocol is unsupported: {entry.get("protocol")!r}')
    executable = entry.get('executable')
    if not isinstance(executable, str) or not executable:
        raise Blocker(f'{role} declares no executable')
    resolved_bridge = pathlib.Path(bridge['path']).resolve()
    if resolve_path(base, argv[0]) != resolved_bridge:
        raise Blocker(f'{role} argv head does not resolve to the verified bridge file under the '
                      'declared base')
    if resolve_path(base, executable) != resolved_bridge:
        raise Blocker(f'{role} declared executable does not resolve to the verified bridge file '
                      'under the declared base')
    if PLACEHOLDER in argv[0] or PLACEHOLDER in executable:
        raise Blocker(f'{role} executable path contains the reserved {PLACEHOLDER} placeholder')
    if role == 'oracle' and not any(PLACEHOLDER in argument for argument in argv[1:]):
        raise Blocker('the oracle argv does not bind the verified expressions in a protocol '
                      'argument')
    return {'argv': [str(resolved_bridge)] + list(argv[1:]), 'protocol': entry['protocol'],
            'executable': str(resolved_bridge)}


def write_expressions(workdir, expressions, verified):
    directory = pathlib.Path(workdir).resolve() / 'expressions'
    directory.mkdir(parents=True, exist_ok=True)
    for name in EXPRESSIONS:
        text = extracted_expression(name, expressions[name], workdir)
        digest = digest_bytes(text.encode('utf-8'))
        if digest != verified[f'expression_{name}']['text_sha256']:
            raise Blocker(f'oracle expression text hash changed while binding: {name}')
        (directory / f'{name}.sql').write_text(text, encoding='utf-8')
    return str(directory.resolve())


def launch_argv(entry, expressions_dir):
    """The verified head is preserved; placeholders bind only in protocol arguments."""
    return [entry['argv'][0]] + [argument.replace(PLACEHOLDER, expressions_dir)
                                 for argument in entry['argv'][1:]]


def invoke(entry, octets, workdir, expressions_dir, launcher=None):
    argv = launch_argv(entry, expressions_dir)
    evidence = {'argv': argv, 'executable': entry.get('executable')}
    if argv[0] != entry.get('executable'):
        evidence['launch_failure'] = 'the constructed launch head is not the verified executable'
        return evidence
    run = subprocess.run if launcher is None else launcher
    try:
        completed = run(argv, input=octets, capture_output=True,
                        cwd=str(pathlib.Path(workdir).resolve()))
    except Exception as exc:
        evidence['launch_failure'] = f'{type(exc).__name__}: {exc}'
        return evidence
    evidence['exit'] = completed.returncode
    evidence['stdout_sha256'] = digest_bytes(completed.stdout)
    evidence['stderr_sha256'] = digest_bytes(completed.stderr)
    try:
        evidence['stdout'] = completed.stdout.decode('utf-8')
    except UnicodeDecodeError as exc:
        evidence['decode_failure'] = str(exc)
    return evidence


def validate_result(parsed, label):
    if not isinstance(parsed, dict):
        raise Blocker(f'{label} is not an object')
    undeclared = sorted(set(parsed) - set(EXPECTED_KEYS))
    if undeclared:
        raise Blocker(f'{label} declares undeclared protocol fields {undeclared}')
    for key in EXPECTED_KEYS:
        if key not in parsed:
            raise Blocker(f'{label} declares no {key}')
    if not isinstance(parsed['disposition'], str) or not parsed['disposition']:
        raise Blocker(f'{label} has an empty disposition')
    if not isinstance(parsed['fields'], dict) or not parsed['fields']:
        raise Blocker(f'{label} declares no fields')
    validate_fact(parsed['fields'], f'{label} fields')
    return parsed


def parse_result(evidence, role):
    if evidence.get('launch_failure'):
        raise Blocker(f"{role} did not launch: {evidence['launch_failure']}")
    if evidence.get('decode_failure'):
        raise Blocker(f'{role} stdout is not valid UTF-8: {evidence["decode_failure"]}')
    if evidence.get('exit') != 0:
        raise Blocker(f"{role} exited {evidence['exit']}")
    lines = [line for line in evidence.get('stdout', '').splitlines() if line.strip()]
    if len(lines) != 1:
        raise Blocker(f'{role} reported {len(lines)} result lines, expected exactly one')
    return validate_result(strict_json(lines[0], f'{role} result'), f'{role} result')


def compare(case, candidate, oracle):
    expected = case['expected']
    differences = []
    for role, observed in (('candidate', candidate), ('oracle', oracle)):
        differences.extend(fact_differences(expected['disposition'], observed['disposition'],
                                            f'{role}.disposition'))
        differences.extend(fact_differences(expected['fields'], observed['fields'],
                                            f'{role}.fields'))
    return differences


def case_octets(case):
    """The case input bytes, or a protocol failure: absent, wrong type, bad hex or bad hash."""
    name = case.get('name')
    octets_hex = case.get('octets_hex')
    if not isinstance(octets_hex, str):
        raise Blocker(f'case {name} declares octets of the wrong type or not at all')
    try:
        octets = bytes.fromhex(octets_hex)
    except ValueError as exc:
        raise Blocker(f'case {name} declares octets that are not hex: {exc}')
    if digest_bytes(octets) != case.get('octets_sha256'):
        raise Blocker(f'case {name} octets hash mismatch')
    return octets


def run_case(case, entries, workdir, expressions_dir, report, launcher=None):
    name = case.get('name')
    if not isinstance(name, str) or not name:
        raise Blocker('a case has no name')
    octets = case_octets(case)
    expected = case.get('expected')
    if not isinstance(expected, dict) or set(expected) != set(EXPECTED_KEYS):
        raise Blocker(f'case {name} must declare exactly a disposition and fields')
    if not isinstance(expected['disposition'], str) or not expected['disposition']:
        raise Blocker(f'case {name} declares an empty expected disposition')
    if not isinstance(expected['fields'], dict) or not expected['fields']:
        raise Blocker(f'case {name} declares no expected fields')
    validate_fact(expected['fields'], f'case {name} expected fields')

    outcome = {'case': name, 'octets_sha256': case['octets_sha256'], 'roles': {}, 'differences': []}
    report['cases'].append(outcome)
    parsed = {}
    failures = []
    for role in ROLES:
        try:
            evidence = invoke(entries[role], octets, workdir, expressions_dir, launcher)
        except Exception as exc:
            evidence = {'argv': entries[role].get('argv'),
                        'construction_failure': f'{type(exc).__name__}: {exc}'}
        outcome['roles'][role] = evidence
        try:
            facts = parse_result(evidence, role)
            evidence['facts'] = facts
            parsed[role] = facts
        except Exception as exc:
            evidence['failure'] = f'{type(exc).__name__}: {exc}'
            failures.append(f'{role}: {evidence["failure"]}')

    if len(parsed) != len(ROLES):
        outcome['inconclusive'] = '; '.join(failures)
        report['inconclusive'].append({'case': name, 'reason': outcome['inconclusive']})
        return
    differences = compare(case, parsed['candidate'], parsed['oracle'])
    outcome['differences'] = differences
    if differences:
        report['mismatches'].append({'case': name, 'differences': differences})


def load_manifest(options):
    path = pathlib.Path(options.manifest)
    if not path.is_file():
        raise Blocker(f'manifest is missing: {path}')
    raw = path.read_bytes()
    actual = digest_bytes(raw)
    if actual != options.manifest_sha256:
        raise Blocker(f'manifest hash mismatch: {actual}')
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise Blocker(f'manifest is not valid UTF-8: {exc}')
    manifest = strict_json(text, 'manifest')
    if not isinstance(manifest, dict):
        raise Blocker(f'the manifest is not an object: {type(manifest).__name__}')
    if manifest.get('schema') != SCHEMA:
        raise Blocker(f'unknown manifest schema: {manifest.get("schema")!r}')
    cases = manifest.get('cases')
    if not isinstance(cases, list) or not cases:
        raise Blocker('manifest declares no cases')
    names = [case.get('name') for case in cases if isinstance(case, dict)]
    if len(set(names)) != len(cases):
        raise Blocker('the manifest declares a missing or duplicate case name')
    return manifest, actual


SELF_CHECK_CONTROLS = (
    ('nested-boolean-versus-number',
     {'flag': True}, {'flag': {'lexeme': '1'}}, 'differ'),
    ('nested-missing-field', {'outer': {'a': {'lexeme': '1'}}}, {'outer': {}}, None),
    ('nested-extra-field', {'outer': {}}, {'outer': {'a': {'lexeme': '1'}}}, None),
    ('exact-numeric-lexeme', {'n': {'lexeme': '1.0'}}, {'n': {'lexeme': '1'}}, 'differ'),
    ('equal-lexeme-different-position', {'a': {'lexeme': '1'}, 'b': {'lexeme': '1'}},
     {'b': {'lexeme': '1'}, 'a': {'lexeme': '1'}}, 'equal'),
    ('null-versus-missing', {'a': None}, {}, None),
    ('list-length', {'l': [{'lexeme': '1'}]}, {'l': [{'lexeme': '1'}, {'lexeme': '2'}]}, None),
    ('list-order', {'l': [{'lexeme': '1'}, {'lexeme': '2'}]},
     {'l': [{'lexeme': '2'}, {'lexeme': '1'}]}, 'differ'),
    ('boolean-versus-boolean', {'flag': False}, {'flag': False}, 'equal'),
    ('lexeme-wrapper-with-extra-key', {'n': {'lexeme': '1', 'other': False}},
     {'n': {'lexeme': '1', 'other': False}}, 'reject'),
    ('lexeme-versus-lexeme-plus-extra', {'n': {'lexeme': '1'}},
     {'n': {'lexeme': '1', 'extra': True}}, 'reject'),
    ('missing-additional-field', {'n': {'lexeme': '1'}, 'm': {'lexeme': '2'}},
     {'n': {'lexeme': '1'}}, None),
)

SELF_CHECK_REJECTIONS = (
    ('bare-number', '{"disposition": "accepted", "fields": {"n": 1}}'),
    ('bare-decimal', '{"disposition": "accepted", "fields": {"n": 1.5}}'),
    ('duplicate-key', '{"disposition": "accepted", "fields": {"a": {"lexeme": "1"}, "a": {"lexeme": "2"}}}'),
    ('non-finite', '{"disposition": "accepted", "fields": {"n": NaN}}'),
    ('missing-fields', '{"disposition": "accepted"}'),
    ('empty-fields', '{"disposition": "accepted", "fields": {}}'),
    ('top-level-extra-field',
     '{"disposition": "accepted", "fields": {"n": {"lexeme": "1"}}, "extra": true}'),
)

EMPTY_OCTETS_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'


def self_check():
    report = {'self_check': [], 'mismatches': [], 'inconclusive': []}
    for name, expected, observed, kind in SELF_CHECK_CONTROLS:
        try:
            validate_fact(expected, 'expected')
            validate_fact(observed, 'observed')
        except Blocker as exc:
            rejected = kind == 'reject'
            report['self_check'].append(
                {'control': name, 'outcome': 'rejected' if rejected else 'rejected-unexpectedly',
                 'reason': str(exc)})
            if not rejected:
                report['mismatches'].append({'case': name,
                                             'differences': [f'unexpected protocol rejection: {exc}']})
            continue
        if kind == 'reject':
            report['self_check'].append({'control': name, 'outcome': 'accepted-unexpectedly'})
            report['mismatches'].append({'case': name,
                                         'differences': ['expected a protocol rejection']})
            continue
        differences = fact_differences(expected, observed, 'fields')
        if kind == 'equal':
            passed = not differences
            recorded = 'equal' if passed else 'differ'
        else:
            passed = bool(differences)
            recorded = 'differ' if passed else 'equal'
        report['self_check'].append({'control': name, 'outcome': recorded,
                                     'differences': differences})
        if not passed:
            report['mismatches'].append({'case': name, 'differences': differences or
                                         ['expected a difference and observed none']})
    for name, case, should_pass in (
            ('valid-empty-input',
             {'name': 'empty-input', 'octets_hex': '', 'octets_sha256': EMPTY_OCTETS_SHA256}, True),
            ('absent-input', {'name': 'absent-input'}, False),
            ('wrong-type-input',
             {'name': 'wrong-type-input', 'octets_hex': 5, 'octets_sha256': EMPTY_OCTETS_SHA256},
             False),
            ('bad-hash-input',
             {'name': 'bad-hash-input', 'octets_hex': '', 'octets_sha256': 'ff'}, False)):
        try:
            octets = case_octets(case)
            ok = should_pass
            outcome = 'accepted' if ok else 'accepted-unexpectedly'
            reason = f'{len(octets)} bytes'
        except Blocker as exc:
            ok = not should_pass
            outcome = 'rejected' if ok else 'rejected-unexpectedly'
            reason = str(exc)
        report['self_check'].append({'control': name, 'outcome': outcome, 'reason': reason})
        if not ok:
            report['mismatches'].append({'case': name, 'differences': [reason]})
    first = resolve_path('/one/base', 'tools/bridge')
    second = resolve_path('/other/base', 'tools/bridge')
    base_ok = (str(first) == '/one/base/tools/bridge' and str(second) == '/other/base/tools/bridge'
               and first != second
               and resolve_path('/one/base', '/absolute/bridge') == pathlib.Path('/absolute/bridge'))
    report['self_check'].append({'control': 'path-base-distinguishes-directories',
                                 'outcome': 'accepted' if base_ok else 'rejected',
                                 'resolved': [str(first), str(second)]})
    if not base_ok:
        report['mismatches'].append({'case': 'path-base-distinguishes-directories',
                                     'differences': ['the declared base must decide the resolved path']})
    class _Completed(object):
        def __init__(self, stdout):
            self.returncode = 0
            self.stdout = stdout.encode('utf-8')
            self.stderr = b''

    def _fault_after_first(argv, input=None, capture_output=True, cwd=None):
        if any(PLACEHOLDER in argument for argument in argv):
            raise ValueError('embedded null byte')
        return _Completed('{"disposition": "accepted", "fields": {"n": {"lexeme": "1"}}}')

    retention_case = {
        'name': 'retention', 'octets_hex': '', 'octets_sha256': EMPTY_OCTETS_SHA256,
        'expected': {'disposition': 'accepted', 'fields': {'n': {'lexeme': '1'}}},
    }
    retention_entries = {
        'candidate': {'argv': ['/candidate/bridge', '--protocol'],
                      'executable': '/candidate/bridge', 'protocol': 'json-lines'},
        'oracle': {'argv': ['/oracle/bridge', PLACEHOLDER + '/frame_kind.sql'],
                   'executable': '/oracle/bridge', 'protocol': 'json-lines'},
    }
    retention_report = {'cases': [], 'mismatches': [], 'inconclusive': []}
    run_case(retention_case, retention_entries, '/work/base', '/work/base/expressions',
             retention_report, _fault_after_first)
    observed = retention_report['cases'][0] if retention_report['cases'] else {}
    roles = observed.get('roles', {})
    retention_ok = (len(retention_report['cases']) == 1
                    and observed.get('case') == 'retention'
                    and set(roles) == set(ROLES)
                    and bool(roles.get('candidate', {}).get('facts'))
                    and 'launch_failure' in roles.get('oracle', {})
                    and len(retention_report['inconclusive']) == 1
                    and not retention_report['mismatches'])
    report['self_check'].append({'control': 'second-role-fault-retains-both-roles',
                                 'outcome': 'accepted' if retention_ok else 'rejected',
                                 'roles': sorted(roles)})
    if not retention_ok:
        report['mismatches'].append({'case': 'second-role-fault-retains-both-roles',
                                     'differences': ['the case and both role records must survive']})

    placeholder_bridge = {'path': '/w/' + PLACEHOLDER + '/bridge'}
    placeholder_manifest = {'invocation': {'oracle': {
        'executable': '/w/' + PLACEHOLDER + '/bridge',
        'argv': ['/w/' + PLACEHOLDER + '/bridge', PLACEHOLDER],
        'protocol': 'json-lines'}}}
    head = launch_argv({'argv': ['/w/' + PLACEHOLDER + '/bridge', PLACEHOLDER]}, '/w/expressions')[0]
    try:
        invocation(placeholder_manifest, 'oracle', placeholder_bridge, '/w')
        head_ok = False
        reason = 'the reserved placeholder in an executable path was accepted'
    except Blocker as exc:
        head_ok = head == '/w/' + PLACEHOLDER + '/bridge'
        reason = str(exc)
    report['self_check'].append({'control': 'placeholder-in-executable-head',
                                 'outcome': 'accepted' if head_ok else 'rejected',
                                 'head': head, 'reason': reason})
    if not head_ok:
        report['mismatches'].append({'case': 'placeholder-in-executable-head',
                                     'differences': ['the verified head must stay unchanged or be refused']})
    for name, text in SELF_CHECK_REJECTIONS:
        rejected = False
        reason = ''
        try:
            validate_result(strict_json(text, name), name)
        except Blocker as exc:
            rejected = True
            reason = str(exc)
        report['self_check'].append({'control': name, 'outcome': 'rejected' if rejected else 'accepted',
                                     'reason': reason})
        if not rejected:
            report['mismatches'].append({'case': name, 'differences': ['expected rejection']})
    print(json.dumps(report, indent=2, sort_keys=True))
    if report['mismatches']:
        return MISMATCH
    if report['inconclusive']:
        return INCONCLUSIVE
    return MATCHED


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Remote differential oracle harness, not for local execution')
    parser.add_argument('--manifest', help='hashed input manifest carrying every case and dependency')
    parser.add_argument('--manifest-sha256', help='expected manifest hash, so the caller cannot substitute it')
    parser.add_argument('--workdir', help='working directory for invocations and bound expressions')
    parser.add_argument('--self-check', action='store_true',
                        help='exercise the comparator and fact validator on in-script controls')
    options = parser.parse_args(argv)
    if options.self_check:
        return self_check()
    if not (options.manifest and options.manifest_sha256 and options.workdir):
        parser.error('the manifest, its hash and a working directory are required')

    report = {'manifest': options.manifest, 'cases': [], 'mismatches': [], 'inconclusive': []}
    workdir = str(pathlib.Path(options.workdir).resolve())
    report['workdir'] = workdir
    try:
        manifest, manifest_hash = load_manifest(options)
        report['manifest_sha256'] = manifest_hash
        dependency = verify_dependency(manifest, workdir)
        report['dependency_verified'] = dependency
        expressions_dir = write_expressions(workdir, manifest['dependency']['oracle']['expressions'],
                                            dependency)
        report['expressions_dir'] = expressions_dir
        bridges = {role: verify_bridge(manifest, role, workdir) for role in ROLES}
        entries = {role: invocation(manifest, role, bridges[role], workdir) for role in ROLES}
        for case in manifest['cases']:
            try:
                run_case(case, entries, workdir, expressions_dir, report)
            except Blocker as exc:
                report['inconclusive'].append({'case': case.get('name'), 'reason': str(exc)})
    except Blocker as exc:
        report['inconclusive'].append({'case': None, 'reason': str(exc)})
    except Exception as exc:
        report['inconclusive'].append({'case': None, 'reason': f'unexpected harness failure: {exc!r}'})

    print(json.dumps(report, indent=2, sort_keys=True))
    if report['mismatches']:
        return MISMATCH
    if report['inconclusive']:
        return INCONCLUSIVE
    return MATCHED


if __name__ == '__main__':
    sys.exit(main())
