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
| `BATON_EXPECTED_DEPENDENCY_GRAPH` | absolute admitted, reviewed dependency graph for the frozen producer (required) |
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

Dependency edges are **admitted, reviewed input**, not inferred. The graph file
declares, for each module, the modules it imports; admission resolves the
closure from that declaration and validates every module's digest against the
manifest. A graph refusal exits 3 with a named condition: `graphMissing`,
`graphMalformed`, `graphVersion`, `graphSelfEdge`, `graphDuplicateEdge`,
`graphEmpty`, `graphEntryUndeclared`, `graphEdgeUndeclared`,
`expectedHashesIncomplete` or `sourceHashMismatch`.

A missing admitted input — the manifest, the graph, the evidence directory, the
floor executable or a declared module — is a named refusal with exit status 3, not
a raw filesystem error escaping as an uncaught exception. That status-3
distinction is part of the contract.

Scope, stated plainly: this suite parses no source, so it makes **no claim about
arbitrary source**. It establishes that the modules it executed are exactly the
admitted ones with the admitted digests. A source change invalidates the graph
through its digests; a graph that omits a real edge is a reviewed-input defect
rather than a detected one. An earlier revision tried to infer edges from source
text, refused valid source such as `import.meta.url`, and is removed.

Reviewed artifacts for the current immutable target are in this directory:
`reviewed-graph-24ecd9d9.json` and `reviewed-manifest-24ecd9d9.sha256`.

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
| `grants-admission` | `cdp-intents`, `cdp-state`, `cdp-session`, `cdp-refs` | grant, serialization, worker-session and ref-decision refusals; admission-order probes |
| `session-transport` | `cdp-session.mjs` | controlled path: outbound frames, pending evaluation and release; live path: breakpoint refusal and admission only; plus default-factory loopback admission |
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
BATON_EXPECTED_DEPENDENCY_GRAPH=reviewed-graph-24ecd9d9.json \
"$NODE" run-all.mjs

# separate pinned historical run and evidence directory
BATON_PRODUCER_ROOT=<pinned root> BATON_FLOOR_NODE="$NODE" \
BATON_EVIDENCE_DIR=<pinned evidence> BATON_EXPECTED_PRODUCER_HASHES=<pinned manifest> \
BATON_HISTORICAL_PIN=review-verified-2026-10-05 "$NODE" run-all.mjs
```

Exit statuses: 0 pass, 1 assertion failure, 3 refused environment.

## Authoritative API of record

Candidate expectations target immutable CDP source commit
`24ecd9d954e0b21619f452958c0169f321143436`, tree
`364807c2299ba32b2ad93724e36ae373ebb89d50`, successor to `8c4fa004`:

| File | sha256 |
| --- | --- |
| `cdp-intents.mjs` | `b0ace58e32604d044f6c132e8d3f1a3d5889aa36321c42b4b0a830f814152462` |
| `cdp-session.mjs` | `b441b3cf1ae749fe49461ef55c8497c6dcd3341510a789f58f21f1ad44dee0f7` |
| `cdp-refs.mjs` | `80e32fd714c53e583c481bb3efea85a399bc703a6e6c3ba82c6bd0b0d5aac0ec` |
| `cdp-transport.mjs` | `b147efcd0fdf5e9d3452e203d7ab241da708b945d991ab9061e68557d850592b` |

Contract points these fixtures assert: `admitControlRequest(record, method,
params, effects, workers)` takes the owned worker session list as a fifth
argument; `NodeWorker.detach` and `NodeWorker.sendMessageToWorker` require a
nonempty `sessionId` present in that list, checked before the inner message is
validated; ref decisions carry an authoritative `decision` member and a bare
`{ok:true}` is not success (`refDecision`, `requireAdmittedRef`);
`createAdapterSession` accepts an injected `connect` factory defaulting to
`CdpTransport.connect`; and loopback admission (`admitLoopbackEndpoint`) is
enforced by the default factory, so the injected-factory path performs no
endpoint admission of its own. A remote run observing a different refusal name
is a real disagreement to report.

## Status and coverage limits

Authored source; not run or parsed on the operator laptop, so unvalidated until an
admitted remote runner executes it. Not covered: keeper custody and role
admission beyond the stubbed release, observer recovery, owner notification, the
S4 session close state, the S5 loopback boundary and the S6 delivered law import
fragment.
