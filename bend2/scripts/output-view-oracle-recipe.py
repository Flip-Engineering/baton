#!/usr/bin/env python3
"""Future remote oracle recipe for the Receive output view. DO NOT RUN LOCALLY.

Compares the pure candidate classifier against the actual pinned behaviour of
Turn.frame_kind and Turn.filter_mode_sql as compiled into the admitted artifact with
its linked SQLite. This is source preparation only: no local execution, no remote
request, and no parity claim until the admitted run exists.

Inputs the runner must receive, each verified before any comparison:

- --artifact           the exact admitted native executable, hashed before use
- --corpus             a directory of original frame byte files plus a manifest of
                       their SHA-256, each one a complete LF-delimited original range
- --candidate-pin      the committed pin and tree of the pure candidate
- --original-pin       the pinned lineage whose frame_kind/filter_mode_sql behaviour
                       is the oracle, for example fca7af876c8260c32d17f95f3e19bc68ee1bf561
- --sqlite-identity    the SQLite library identity linked by that artifact
- --expected           per-case expected facts, transitions, ranges and phases

The runner extracts the oracle by evaluating the exact frame_kind and filter_mode_sql
expressions from the pinned extraction against each corpus frame in the artifact's
SQLite, and compares, per case: the recognized-update outcome, the transition, the
original range identity, the selection, and the resulting state and phase.

Failure conditions, all fatal: a missing artifact or corpus file, a manifest hash
mismatch, a case absent from the corpus, a build or launch failure, a skipped case,
a malformed oracle result, an unexpected failure outside the declared malformed and
unsupported categories, or any per-case difference. A compile, setup or launch
failure is inconclusive and is never recorded as a successful rejection.

Per-case output retained: case name, corpus bytes and hash, the candidate result, the
oracle result, the difference, and the actual process exits. The run also records the
candidate and oracle source pins, the artifact hash, the compiler identity and the
SQLite identity.

Named negative controls that must identify their designated semantic mismatch on a
successful build: filter-only-in-delta, filter-stderr, advance-only-when-visible,
reset-state-at-cursor, note-without-phase, finish-on-child-exit,
raw-export-via-line-plus-LF, resolve-latest, and view-calls-consume. Duplicate-member
and numeric-precision controls remain dependent on this oracle and are not claimed
before it runs.
"""

import argparse
import hashlib
import json
import pathlib
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description='Remote oracle recipe, not for local execution')
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--corpus', required=True)
    parser.add_argument('--candidate-pin', required=True)
    parser.add_argument('--original-pin', required=True)
    parser.add_argument('--sqlite-identity', required=True)
    parser.add_argument('--expected', required=True)
    options = parser.parse_args(argv)

    report = {'artifact': options.artifact, 'candidate_pin': options.candidate_pin,
              'original_pin': options.original_pin, 'sqlite_identity': options.sqlite_identity,
              'failures': [], 'cases': []}
    artifact = pathlib.Path(options.artifact)
    corpus = pathlib.Path(options.corpus)
    expected = json.loads(pathlib.Path(options.expected).read_text())

    if not artifact.is_file():
        report['failures'].append('the admitted artifact is missing')
    else:
        report['artifact_sha256'] = digest(artifact)
    manifest = corpus / 'manifest.json'
    if not manifest.is_file():
        report['failures'].append('the corpus manifest is missing')
    else:
        declared = json.loads(manifest.read_text())
        for name, sha in sorted(declared.items()):
            frame = corpus / name
            if not frame.is_file():
                report['failures'].append(f'corpus frame missing: {name}')
            elif digest(frame) != sha:
                report['failures'].append(f'corpus hash mismatch: {name}')
    cases = expected.get('cases', {})
    for name in sorted(cases):
        if not (corpus / name).is_file():
            report['failures'].append(f'expected case absent from the corpus: {name}')

    if report['failures']:
        print(json.dumps(report, indent=2))
        return 1
    report['failures'].append(
        'the oracle extraction and comparison are not implemented here; this recipe '
        'prepares the remote run and performs no comparison locally')
    print(json.dumps(report, indent=2))
    return 1


if __name__ == '__main__':
    sys.exit(main())
