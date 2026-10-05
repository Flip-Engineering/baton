#!/usr/bin/env python3
"""Remote differential oracle harness for the Receive output view. DO NOT RUN LOCALLY.

This harness compares, for every case in a hashed input manifest, three things: the
independently written expectation, the structured facts reported by the pure candidate, and
the facts extracted from the admitted artifact's linked SQLite by evaluating the original
frame_kind and filter_mode_sql expressions. It performs no comparison logic of its own beyond
field equality, and it produces no successful result that is not backed by a real invocation.

Manifest schema, receive-output-view-oracle/1:

  {
    "schema": "receive-output-view-oracle/1",
    "dependency": {
      "artifact":  {"path": ..., "sha256": ...},
      "candidate": {"path": ..., "pin": ..., "tree": ..., "source_sha256": {name: sha}},
      "original":  {"pin": ..., "tree": ...},
      "sqlite":    {"identity": ..., "sha256": ...},
      "compiler":  {"identity": ...},
      "oracle":    {"path": ..., "extraction_sha256": {name: sha},
                    "expressions": {"frame_kind": ..., "filter_mode_sql": ...}}
    },
    "invocation": {
      "candidate": {"argv": [...], "protocol": "json-lines"},
      "oracle":    {"argv": [...], "protocol": "json-lines"}
    },
    "cases": [
      {"name": ..., "octets_hex": ..., "octets_sha256": ...,
       "expected": {"disposition": ..., "fields": {...}}}
    ]
  }

The manifest carries the input octets, the expected dispositions and fields, the complete
case definitions, both invocation commands and every dependency identity, so a case is
defined by hashed manifest content and nothing is taken from the caller. No command line
option accepts a case name, a case label or a reported outcome, because a reported outcome is
not evidence that a case ran. Each case's octets are re-derived from the manifest and hashed
before use, so a case cannot be substituted.

Exit codes, and the taxonomy they encode:

  0  every case matched its expectation from both the candidate and the oracle
  1  at least one case was observed to differ from its expectation, or a result was missing,
     extra or malformed in a way that names a specific difference
  2  inconclusive: the manifest, a dependency identity, an invocation, the process launch,
     the exit status or the result protocol prevented observation. A compile, setup or launch
     failure is inconclusive and is never recorded as a successful rejection.

Precedence is mismatch first, then inconclusive, then matched, and the report states both.

Per-case evidence retained: the case name, its octets hash, the exact argv of each
invocation, the process exit and the stdout and stderr hashes for each, the parsed candidate
and oracle facts, and the field-by-field differences. The report also carries the manifest
hash, the two source pins, the artifact hash, the compiler identity and the SQLite identity.

Named negative controls that must identify their designated semantic mismatch on a successful
build: filter-only-in-delta, filter-stderr, advance-only-when-visible, reset-state-at-cursor,
note-without-phase, finish-on-child-exit, raw-export-via-line-plus-LF, resolve-latest, and
view-calls-consume. Duplicate-member and numeric-precision controls remain dependent on this
harness and are not claimed before it runs.

This file is source preparation. Running it locally is out of scope, and a candidate
extraction adapter and fold bridge that do not exist yet are reported as blockers rather than
invented here.
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


class Blocker(Exception):
    """Observation was prevented. Never a rejection of the behaviour under test."""


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def digest_file(path):
    return digest_bytes(pathlib.Path(path).read_bytes())


def load_manifest(options):
    path = pathlib.Path(options.manifest)
    if not path.is_file():
        raise Blocker(f'manifest is missing: {path}')
    raw = path.read_bytes()
    actual = digest_bytes(raw)
    if actual != options.manifest_sha256:
        raise Blocker(f'manifest hash mismatch: {actual}')
    manifest = json.loads(raw)
    if manifest.get('schema') != SCHEMA:
        raise Blocker(f'unknown manifest schema: {manifest.get("schema")!r}')
    if not isinstance(manifest.get('cases'), list) or not manifest['cases']:
        raise Blocker('manifest declares no cases')
    return manifest, actual


def verify_hashed_tree(root, declared, label):
    base = pathlib.Path(root)
    for name, sha in sorted(declared.items()):
        path = base / name
        if not path.is_file():
            raise Blocker(f'{label} file is missing: {name}')
        if digest_file(path) != sha:
            raise Blocker(f'{label} hash mismatch: {name}')


def verify_dependency(manifest):
    dependency = manifest.get('dependency')
    if not isinstance(dependency, dict):
        raise Blocker('dependency identities are missing')
    for key in DEPENDENCIES:
        if key not in dependency:
            raise Blocker(f'dependency identity is missing: {key}')
    artifact = dependency['artifact']
    path = pathlib.Path(artifact.get('path', ''))
    if not path.is_file():
        raise Blocker(f'admitted artifact is missing: {path}')
    if digest_file(path) != artifact.get('sha256'):
        raise Blocker('admitted artifact hash mismatch')
    candidate = dependency['candidate']
    if not candidate.get('pin') or not candidate.get('tree'):
        raise Blocker('candidate pin or tree is missing')
    verify_hashed_tree(candidate.get('path', ''), candidate.get('source_sha256', {}),
                       'candidate source')
    original = dependency['original']
    if not original.get('pin') or not original.get('tree'):
        raise Blocker('original pin or tree is missing')
    sqlite = dependency['sqlite']
    if not sqlite.get('identity') or not sqlite.get('sha256'):
        raise Blocker('sqlite identity is missing')
    if not dependency['compiler'].get('identity'):
        raise Blocker('compiler identity is missing')
    oracle = dependency['oracle']
    verify_hashed_tree(oracle.get('path', ''), oracle.get('extraction_sha256', {}),
                       'oracle extraction')
    expressions = oracle.get('expressions')
    if not isinstance(expressions, dict):
        raise Blocker('oracle expressions are missing')
    for name in EXPRESSIONS:
        if not expressions.get(name):
            raise Blocker(f'oracle expression is missing: {name}')
    return dependency


def invocation(manifest, role):
    declared = manifest.get('invocation')
    if not isinstance(declared, dict) or role not in declared:
        raise Blocker(f'{role} invocation is not declared')
    entry = declared[role]
    if not entry.get('argv'):
        raise Blocker(f'{role} argv is not declared')
    if entry.get('protocol') != 'json-lines':
        raise Blocker(f'{role} result protocol is unsupported: {entry.get("protocol")!r}')
    return entry


def invoke(entry, octets, workdir):
    argv = list(entry['argv'])
    try:
        completed = subprocess.run(argv, input=octets, capture_output=True, cwd=workdir)
    except OSError as exc:
        raise Blocker(f'launch failed for {argv[0]}: {exc}')
    return {
        'argv': argv,
        'exit': completed.returncode,
        'stdout_sha256': digest_bytes(completed.stdout),
        'stderr_sha256': digest_bytes(completed.stderr),
        'stdout': completed.stdout.decode('utf-8', 'replace'),
        'stderr': completed.stderr.decode('utf-8', 'replace'),
    }


def parse_result(evidence, role):
    if evidence['exit'] != 0:
        raise Blocker(f"{role} exited {evidence['exit']}: {evidence['stderr'].strip()[:200]}")
    lines = [line for line in evidence['stdout'].splitlines() if line.strip()]
    if len(lines) != 1:
        raise Blocker(f'{role} reported {len(lines)} result lines, expected exactly one')
    try:
        parsed = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise Blocker(f'{role} result is not JSON: {exc}')
    if not isinstance(parsed, dict):
        raise Blocker(f'{role} result is not an object')
    return parsed


def compare(case, candidate, oracle):
    expected = case['expected']
    if not isinstance(expected, dict):
        raise Blocker(f"case {case['name']} declares no expected object")
    differences = []
    for field in sorted(expected):
        for role, observed in (('candidate', candidate), ('oracle', oracle)):
            if field not in observed:
                differences.append(f'{role} is missing field {field}')
            elif observed[field] != expected[field]:
                differences.append(
                    f'{role} {field}: {observed[field]!r} does not equal expected {expected[field]!r}')
    for role, observed in (('candidate', candidate), ('oracle', oracle)):
        extra = sorted(set(observed) - set(expected))
        if extra:
            differences.append(f'{role} reported undeclared fields {extra}')
    return differences


def run_case(case, entries, workdir, report):
    name = case.get('name')
    if not name:
        raise Blocker('a case has no name')
    octets_hex = case.get('octets_hex')
    if not isinstance(octets_hex, str):
        raise Blocker(f'case {name} declares no octets')
    try:
        octets = bytes.fromhex(octets_hex)
    except ValueError as exc:
        raise Blocker(f'case {name} declares octets that are not hex: {exc}')
    if digest_bytes(octets) != case.get('octets_sha256'):
        raise Blocker(f'case {name} octets hash mismatch')
    evidence = {}
    parsed = {}
    for role in ROLES:
        entry = entries[role]
        evidence[role] = invoke(entry, octets, workdir)
        parsed[role] = parse_result(evidence[role], role)
    differences = compare(case, parsed['candidate'], parsed['oracle'])
    report['cases'].append({
        'case': name,
        'octets_sha256': case['octets_sha256'],
        'candidate_evidence': evidence['candidate'],
        'oracle_evidence': evidence['oracle'],
        'differences': differences,
    })
    if differences:
        report['mismatches'].append({'case': name, 'differences': differences})


def main(argv=None):
    parser = argparse.ArgumentParser(
        description='Remote differential oracle harness, not for local execution')
    parser.add_argument('--manifest', required=True,
                        help='hashed input manifest carrying every case and dependency')
    parser.add_argument('--manifest-sha256', required=True,
                        help='expected hash of the manifest, so the caller cannot substitute it')
    parser.add_argument('--workdir', required=True, help='working directory for invocations')
    options = parser.parse_args(argv)

    report = {'manifest': options.manifest, 'cases': [], 'mismatches': [], 'inconclusive': []}
    try:
        manifest, manifest_hash = load_manifest(options)
        report['manifest_sha256'] = manifest_hash
        dependency = verify_dependency(manifest)
        report['dependency'] = dependency
        entries = {role: invocation(manifest, role) for role in ROLES}
        names = [case.get('name') for case in manifest['cases']]
        if len(set(names)) != len(names):
            raise Blocker('the manifest declares a duplicate case name')
        for case in manifest['cases']:
            try:
                run_case(case, entries, options.workdir, report)
            except Blocker as exc:
                report['inconclusive'].append({'case': case.get('name'), 'reason': str(exc)})
    except Blocker as exc:
        report['inconclusive'].append({'case': None, 'reason': str(exc)})

    print(json.dumps(report, indent=2, sort_keys=True))
    if report['mismatches']:
        return MISMATCH
    if report['inconclusive']:
        return INCONCLUSIVE
    return MATCHED


if __name__ == '__main__':
    sys.exit(main())
