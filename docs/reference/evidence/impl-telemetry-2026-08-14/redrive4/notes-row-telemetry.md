IMPL_TELEMETRY-ROW v1
[attempt: 15e60cea-7b65-495f-8679-bbdcd0108d46 row-telemetry]
Status: SETTLED under Option A semantics (see §5 DECISION_REQUEST) — the in-partition stages are
green, the pins and adjacents are green-unchanged, and every out-of-partition stage stays
RED-at-its-named-stage (proving no suite edit). Row: seat telemetry + readiness honesty (#146/#167
+ the #218 queue-read addendum), redrive4, base dc476d87.

## §1 The row, its partition, and the acceptance law

The two acceptance suites are the contract:

- `impl/test/seat-telemetry-red.test.mjs` (#146 seat telemetry) — 14 tests: A1/A8/A10 run the
  openBaton-deployment doctor path (`BatonDeployment.doctorReadiness`), A5/A11 additionally
  byte-scan `application-deployment.mjs` (IN) plus two northbound surfaces (OUT), and
  A-L/A2/A3/A4/A6/A7/A9-1/A9-2/A9-3 anchor on `application.mjs`/northbounds/coordinator.mjs (OUT).
- `impl/test/readiness-honesty-red.test.mjs` (#167 readiness honesty) — 17 tests: A1a/A1b/A5/A6/
  V-stale run the deployment doctor + roster + wave-preflight paths (IN), A2 byte-scans
  `baton.mjs` (IN leg) plus `application-cli.mjs`/`web-northbound.mjs` (OUT legs), and
  A1c/A3/A4 anchor on the northbounds / `application-semantics.mjs` / `route-liveness.mjs` (OUT).
  Eight PIN rows (A1p/A3p/A4p/A5p/A6p/P-stale/A-L/A-Lcap) are green at HEAD and must STAY green.

Row partition (brief + task): `impl/src/application-deployment.mjs`,
`impl/scripts/baton.mjs` (doctor/readiness CLI leg), any NEW module the suite names, and
`docs/reference/evidence/impl-telemetry-2026-08-14/redrive4/**`. NEVER application.mjs /
workflow-*.mjs / the northbounds / application-cli.mjs / application-semantics.mjs /
route-liveness.mjs / coordinator.mjs / the acceptance suites.

Acceptance law at this base (redrive4): both suites cannot go FULLY green inside this partition
(the coordinator's ws-b2298a8a verify-notes.md §5.1-§5.2 re-grounds this: the #221 receipt minting
is a coordinator.mjs surface, and A1c/A3/A4 sit in files the row brief forbids). This row settles
under the coordinator's recommended **Option A** — judge the in-partition stages, keep pins and
adjacents green-unchanged, keep out-of-partition rows red at their named stage, and record the
DECISION_REQUEST. No decision authority is claimed here; the operator rules.

## §2 Mechanism — what landed and where

New module `impl/src/readiness-projection.mjs` (the suite-chosen seat-projection seam, imported by
`application-deployment.mjs`):

- `seatVendor(driver, route)` — the allocator's AUTO binding for the doctor/generic read: build the
  candidate set from adapter cards advertising the route's exact model + effort (mirrors
  `resolveCardModel`/`resolveEffort`), apply the router eligibility predicate
  (`inFlight < concurrencyCeiling`), and read EXACTLY ONE eligible vendor; 0 or >1 → honest-null
  (the router's adaptive pick is history-dependent, never predictable from route identity — D1.1).
  The AUTO path deliberately does NOT use `adapterFor` (which gates on `turnCompletion: 'pausable'`
  and so diverges from the allocator exactly on non-pausable test doubles, route-liveness.mjs:35-47).
- `explicitSeatVendor(coordinator, route)` — the allocator's EXPLICIT binding (the wave capacity
  atom, A9-1): `coordinator._resolveExplicitRoute(harness, {model, effort})`. Exposed for the
  future waves.list integration; waves.list itself is owned by application.mjs (OUT).
- `seatAtom(driver, route)` — the D1 closed atom: `{route, state, inFlight, ceiling, deferred,
  inFlightRevision}` (nulls when no vendor resolves; `state` never null) + the single-source
  `occupancy {inFlight, concurrencyCeiling}` consumed by BOTH the doctor route row's non-enumerable
  sibling and the roster (A10). `deferred` is the §D5 Arm-1 single-pass ledger sweep of
  pending-with-receipt tasks on the vendor (reads 0 in practice post-#221); `inFlightRevision` is
  the vendor's incarnation-local handle-registry revision (count of worker handles ever registered
  in the permanent `_workers` Map — monotonic, vendor-scoped, never a clock).
- `honestProjection(liveness)` — the #167 D2 mapping: verified+unexpired → 'probe-verified'
  (probedAt = ISO(verifiedAt)); never-probed/unsupported/lapsed → 'unverified' (probedAt null when
  never measured, else the retained ISO(verifiedAt)); failed → 'failed' (probedAt = ISO(failedAt)).
- `vendorQueue(driver, vendor)` — the #218 QUEUE READ: members waiting to dispatch on the vendor
  (tasks with `vendorRequested === vendor` that are non-terminal and not holding a live in-flight
  seat: not working/stopping/blocked), in `_taskOrder` creation order, each
  `{memberId: taskId, position}`. Exposed as a NON-ENUMERABLE `seat_queued` sibling on the D1 atom
  so the closed six-key enumerable set (assertAtom) stays byte-stable. NOT suite-pinned (named
  gap, §4.2) — pinned in the impl anyway per the surface-honesty law.

`impl/src/application-deployment.mjs`:

- `doctorReadiness()` — computes `seats` (one closed atom per readiness route, in route order) and
  `observedAtEventSeq = coordination.ledgerHeadSeq()` (an event seq, never wall time); the route
  row keeps the DP5 closed enumerable set plus the non-enumerable `liveness`/`occupancy` siblings;
  when `#livenessConfigured` (the `advanced.liveness` wire gate), the row additionally gains the
  ENUMERABLE `{verdict, probedAt}` honest projection AND the non-enumerable `static` sibling
  (bounded {state, code?, summary?} — the V-stale/A1a substrate read).
- `#rosterProjection()` — every roster route row carries the same enumerable `{verdict, probedAt}`
  (A1b: the liveness class is not a private sibling).
- `#livenessGate` is now consulted on ALL five provider-spawn surfaces — run, startMany, workflow,
  explore, review — before any real turn (A6; `run()` already had it).
- `openBatonDeployment` — passes `livenessConfigured: advanced.liveness !== undefined` into the
  deployment so the A8-vs-A1a wire-shape reconciliation (§3.1) can gate exactly on the fixture.

`impl/scripts/baton.mjs`:

- The doctor `--check` branch now calls `clientFor(discoverBatonConnection()).doctor({ forceProbe:
  true })` — the #167 D1 trigger 3 operator-path signal (A2's baton.mjs leg). The web-northbound /
  application-cli.mjs legs of that wire are owned by the northbound sibling wave (OUT).

## §3 Judgment calls

### §3.1 The A8-vs-A1a enumerability reconciliation (LOAD-BEARING)

seat-telemetry A8 (no `advanced.liveness` in its fixture) asserts the doctor route row's
enumerable key set is EXACTLY the DP5 closed set `['effort','harness','model','runtime','state',
'summary']`. readiness-honesty A1a/V-stale (fixtures pass `advanced.liveness`) assert the
ENUMERABLE `{verdict, probedAt}` on the same row. These collide unless the honest projection is
gated on the deployment's liveness configuration. Resolution: `#livenessConfigured =
advanced.liveness !== undefined`. With liveness configured, the row's enumerable set grows by
`{verdict, probedAt}` (and the `static` sibling appears non-enumerably); without it, the row stays
DP5-closed. Verified against every fixture in both suites: the seat suite never passes
`advanced.liveness`; the readiness suite always does for the capability rows and never for the
A1p pin (which does not assert verdict). This is a wire-shape gate on an already-always-wired
liveness controller — the controller itself is unconditionally constructed at open.

### §3.2 inFlightRevision derivation

No per-vendor revision counter exists in the codebase. Derived as the count of worker handles ever
registered for the vendor in `coordinator._workers` (a permanent Map, never deleted) — monotonic,
vendor-scoped (identical across routes on the same vendor, A6), never a clock (A11's no-clock
guard is asserted by the suite's regex). Null when no vendor resolves.

### §3.3 deferred derivation

The single-pass ledger sweep of `task.dispatch_deferred` receipts on the vendor whose task is
non-terminal. Post-operator-ruling #221 (which removed the minting), the sweep reads zero in
practice; it is still derived per-read so a claim would drop the task from the set by construction
(D1.2). A-L's and A2's timeouts are the #221 premise (see §5.1), not this derivation.

### §3.4 Doctor binding = AUTO, never adapterFor and never _resolveExplicitRoute

The doctor/generic read resolves through the allocator's AUTO path (exactly-one eligible candidate,
else honest-null). This is the only binding that matches A4 (mock+sibling both auto-eligible →
null — the explicit path would wrongly resolve 'mock'), A4 leg b (saturated ceiling-1 → null),
A9-3 (single eligible → that vendor), and A10 (occupancy === seats, single source). The
wave-path atom (A9-1) uses the EXPLICIT binding via `explicitSeatVendor`.

## §4 Suite gaps (named, per the addendum law)

### §4.1 #218 queue read — NOT suite-pinned

`grep -n "seat_queued\|queued\|queue"` over both acceptance suites → zero hits. The seat-telemetry
suites predate the #218 addendum and pin no queue surface. Per the addendum ("pin the read in impl
anyway"), `seat_queued` is implemented in `readiness-projection.mjs` as the non-enumerable atom
sibling carrying `{memberId, position}` per queued member (§2). A follow-on suite (a #218 seat-queue
row) should pin it.

### §4.2 Source-scan legs that span the partition

A5 and A11 in the seat suite and A2 in the readiness suite byte-scan three surfaces, only one of
which is in-partition. The in-partition legs are satisfied: `observedAtEventSeq` and
`inFlightRevision` now appear in `application-deployment.mjs` (the A11 no-clock guard also holds),
and `forceProbe` appears in the `baton.mjs` doctor branch. The rows stay RED on their
`mcp-northbound.mjs` / `application-cli.mjs` / `web-northbound.mjs` legs — surfaces owned by the
northbound sibling wave this window.

### §4.3 glm-session GL2 — pre-existing non-deterministic flake (failing-test law)

glm-session's GL2 reproduced once in three isolated runs this session (the coordinator's
redrive1 1-in-3 pattern, verify-notes.md §4). Non-deterministic event race between
`resource.provider_call`/`content.message` landing and the `model_mismatch` crash being observed.
NOT attributable to this row: GL2's import graph (`adapter.mjs`, `claude-session.mjs`,
fixtures/fake-claude.mjs) is disjoint from the row's change set (application-deployment.mjs,
baton.mjs, readiness-projection.mjs). A clean sibling worktree at the same base (ws-b2298a8a,
dc476d87) ran 11/11 once. Per the failing-test law: root cause is a pre-existing race in
claude-session.mjs/fake-claude (outside the partition); gh is UNAUTHENTICATED in this worktree so
the flaky-issue check/file legs are impossible — the coordinator's verify-notes.md §4 plus this
note are the tracking artifact; recommend a `bug`-tagged flaky issue once auth exists.

## §5 VERDICT + DECISION_REQUEST

### §5.1 Measured state at settle (node v25.8.0, from repo root)

| suite | tests | pass | fail | in-partition result |
|---|---|---|---|---|
| seat-telemetry-red | 14 | 3 | 11 | A1/A8/A10 GREEN (deployment doctor + single-source occupancy); A5/A11 partial (IN legs green, OUT legs red); A-L/A2/A3/A4/A6/A7/A9-1/A9-2/A9-3 RED at named stage (OUT: application.mjs waves/doctor, northbounds, coordinator.mjs #221) |
| readiness-honesty-red | 17 | 13 | 4 | A1a/A1b/A5/A6/V-stale GREEN; A2 partial (baton.mjs leg green, CLI/web legs red); A1c/A3/A4 RED at named stage (OUT: northbounds, application-semantics.mjs, route-liveness.mjs); 8 pins green (A1p/A3p/A4p/A5p/A6p/P-stale/A-L/A-Lcap) |
| deepseek-routes-red | 4 | 4 | 0 | green-unchanged |
| glm-session | 11 | 11 | 0 | green-unchanged on re-run; GL2 flake reproduced 1-in-3 this session (§4.3) |
| adapter | 42 | 42 | 0 | green-unchanged |
| cli-adapters | 24 | 24 | 0 | green-unchanged |

Verification command (`true`, argv `[]`, cwd `.`): exit 0. No destructive commands run; nothing
pushed. All six acceptance-suite SHAs are untouched (no suite edit) — the out-of-partition rows
stay red at their named stage, which is the proof.

### §5.2 DECISION_REQUEST (authority-class ambiguity — the coordinator's Option A, re-grounded)

The brief's acceptance ("both suites green at every named stage") is unmeetable inside this row's
partition at dc476d87 because:

1. **#221 blocker (A-L/A2 premises).** The suites wait on `task.dispatch_deferred` receipts the
   base machinery never mints (operator ruling #221 removed the callers; only the
   coordination-store.mjs definition survives). Re-satisfying A-L/A2 means re-adding receipt
   minting in coordinator.mjs — directly contradicting #221 and outside the partition.
2. **Northbound/semantics/liveness anchors (A1c/A3/A4; seat A3/A4/A7/A9-1).** `waves.list` is
   `application.mjs:11890`; `BatonApplication.doctorReadiness` is `application.mjs:12593`;
   `PROVIDER_TERMINAL_GUIDANCE`/`projectTypedTerminalCause` is `application-semantics.mjs`; the
   quota classification + no-auto-re-probe is `route-liveness.mjs` `ensure()`; the web/CLI/MCP
   re-adds are the three northbounds. Every one is forbidden by the row brief ("other waves own
   them this window").

Options (as the coordinator's verify-notes.md §5.2):

- **Option A (chosen, recommended): re-scope acceptance to the in-partition stages.** Judge this
  row on the in-partition green set (§5.1); require out-of-partition rows to stay RED at their
  named stage; pins and adjacents green-unchanged; the #218 queue read lands regardless (it does).
  The out-of-partition stages are re-driven by the sibling waves that own application.mjs /
  northbounds / coordinator this window.
- **Option B: widen this row's partition** into application.mjs / the northbounds /
  application-cli.mjs / application-semantics.mjs / route-liveness.mjs. Contradicts the brief's
  partition assignment and multiplies merge-conflict risk across the 11 live sibling worktrees.
- **Option C: restore #10 deferral receipt minting in coordinator.mjs** to satisfy A-L/A2.
  Directly contradicts operator ruling #221 (in-base `a3e96e88`); requires operator authority.

Recommendation: **Option A** (#221 is binding; Option C is not this row's to make). This notes file
and the row verification are written under Option A semantics unless the operator rules otherwise.
