# Runtime security and lifecycle fixtures

Portable fixture set for the CDP runtime lane. Source only: nothing here runs
during authoring; execution belongs to an admitted remote runner.

## Environment contract

| Variable | Meaning |
| --- | --- |
| `BATON_PRODUCER_ROOT` | absolute producer worktree root under test |
| `BATON_FLOOR_NODE` | absolute exact-floor Node executable |
| `BATON_EVIDENCE_DIR` | absolute evidence directory (must exist) |
| `BATON_EXPECTED_PRODUCER_HASHES` | absolute root-admitted execution manifest (required) |
| `BATON_HISTORICAL_PIN` | optional pin NAME that selects one historical case |
| `BATON_HISTORICAL_CLOSURE_SHA256` | optional cross-check equal to that pin's closure digest |

The pin is selected by **name**; the closure digest is an assertion, never the
lookup key. The manifest is admitted input and must not be produced from the tree
under test. Observed digests go to `*.observed.sha256.json` and the summary.

## Closure admission

Admission has one authority: the admitted execution manifest. In **both** modes
it resolves the relative-import closure of the modules each fixture executes and
requires every one of those files to appear in the manifest with a matching
digest. It refuses with a named condition and exit 3 on: a missing, relative or
unreadable variable; an absent, malformed or duplicate-bearing manifest; an
unsupported dependency form; an unresolved relative specifier; a missing closure
module; an uncovered closure file; or a digest mismatch.

The resolver is a **specifier scan, not a JavaScript parser**. It handles
`import ... from './x'`, `import './x'`, `export ... from './x'`,
`export * from './x'` and literal `import('./x')`. A dynamic import with a
non-literal argument and any `require(` call are refused as
`closureUnsupportedForm`; a relative specifier that does not resolve to a file is
refused as `closureUnresolvedSpecifier`. A tree using a form the scanner cannot
follow therefore cannot be admitted by this suite, and says so rather than
passing silently.

## Modes

Mode is selected from the admitted environment **before** any producer import or
probe.

**Candidate mode** (default) exercises the current surface: `admitReadRequest`,
`admitControlRequest`, `admitIntent`, `startupStopRequests`, and a production
`createAdapterSession`. It asserts the named refusals and admissions described in
each fixture header, including that a condition-carrying breakpoint refuses while
the condition-free request with the same grants is admitted, that an absent
location refuses, that control and serialized intents refuse `runtimeBusy` while
an evaluation is pending even with full grants, and that release stays admitted.

**Historical mode** requires `BATON_HISTORICAL_PIN=review-verified-2026-10-05`
with the admitted closure equal to that pin's digest, and runs only
`bootstrap-exec` and `grants-admission`. That branch imports the historical module
only, requires the pinned adapter surface, and executes no current-API probe. The
pin is provenance labelling on top of the manifest check, not a substitute for
it: retained history covers those files only, `unverifiedForEra` lists executed
modules never digest-recorded for that era, `exactHistoricalQualification` is
false, and no old hash is fabricated.

## Custody semantics

A requested signal and an observed outcome are separate facts. Fixtures record
`requested` signals and the child's own `close`/`error` outcome; a requested
SIGKILL is never reported as a reap. `cleanupOwned` awaits each owned child's own
event with a bounded wait and reports `unresolved` pids explicitly. The process
`exit` hook can only request a signal and observes nothing, so no outcome is
attributed to it. Custody of a killed fixture's descendants is coordinator-level
and is outside this fixture's authority.

Raw debuggee streams are written in a `finally` block, so a refusal or failure
path still leaves `<fixture>.<tag>.stdout.txt` and `.stderr.txt` on disk.

## Fixtures

| Fixture | Entries | Claims |
| --- | --- | --- |
| `exec-continuity` | `bootstrap.mjs` | exec-in-place pid continuity, environment boundary, stdin EOF |
| `json-list-fields` | none | discovery surface, no pid field |
| `inspector-boundary` | none | pause/custody and pending evaluation against a real inspector |
| `bootstrap-exec` | `bootstrap.mjs` | pre-exec validation (candidate) or the pinned abort (historical) |
| `grants-admission` | `cdp-intents`, `cdp-state`, `cdp-session` | grant and serialization refusals; admission-order probes |
| `session-transport` | `cdp-session.mjs` | outbound-frame behavior through the production session and real transport |
| `endpoint-watch` | `cdp-endpoint.mjs` | refusal channel, replacement, truncation, split append |
| `endpoint-replacement` | `cdp-endpoint.mjs` | repeated replacement refusal |

## Exact remote invocation

```
NODE=<exact floor executable>
EVID=<absolute empty evidence directory>
MANIFEST=<root-admitted frozen execution manifest>
cd <checkout>/bend2/tests/runtime-security

"$NODE" --version                       > "$EVID/node.version.txt" 2>&1
shasum -a 256 "$NODE"                   > "$EVID/node.sha256.txt"  2>&1
shasum -a 256 <producer runtime dir>/*.mjs > "$EVID/observed.producer.sha256.txt" 2>&1

BATON_PRODUCER_ROOT=<producer root> BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR="$EVID" BATON_EXPECTED_PRODUCER_HASHES="$MANIFEST" \
"$NODE" run-all.mjs

# separate pinned historical run and evidence directory
BATON_PRODUCER_ROOT=<pinned root> BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR=<pinned evidence> BATON_EXPECTED_PRODUCER_HASHES=<pinned manifest> \
BATON_HISTORICAL_PIN=review-verified-2026-10-05 "$NODE" run-all.mjs
```

Exit statuses: 0 pass, 1 assertion failure, 3 refused environment.

## Authoritative API of record

Candidate expectations target the CDP lane's authoritative API report
`cdp-fixture-api-8c4fa004`, source commit
`8c4fa004bce8e7fc3cb1ed3df942e5d1a5256683`, tree
`8963a375427815a5da33960cfad49cd894ab6875`, `cdp-intents.mjs` sha256
`bbfc2bbbd81cef2aea5cc76538ac354a5e1f8a69a9206178e7ca45bec45b4bbc`. A remote run
observing a different refusal name is a real disagreement to report.

## Status and coverage limits

Authored source; not run or parsed on the operator laptop, so unvalidated until an
admitted remote runner executes it. Not covered: keeper custody and role
admission beyond the stubbed release, observer recovery, owner notification, the
S4 session close state, the S5 loopback boundary and the S6 delivered law import
fragment.
