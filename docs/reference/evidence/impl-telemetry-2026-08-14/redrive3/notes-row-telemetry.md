[attempt: ab51f90d-29a5-4395-ae33-5c0e0d8f7057 row-telemetry]
STATUS: PARTIAL — in-partition rows earned with ZERO regressions; remaining rows blocked by
partition or by genuine suite conflicts (the A1a/A1b enumerability vs the fleet's closed-row
pins). DECISION_REQUEST at §7. Deployment verification command executed (`true`, argv `[]`,
cwd `.`, expected exit 0) → exit 0. Adjacents green-unchanged.

# impl-telemetry redrive3 — row-telemetry notes (seat telemetry + readiness honesty, #146/#167/#218)

Row: `row-telemetry`. Base `5ae2c7e5` (this worktree). Contract: `impl/test/seat-telemetry-red.test.mjs`
(14 tests) + `impl/test/readiness-honesty-red.test.mjs` (17 tests). Suites immutable — SHA-256
unchanged from the redrive2 baseline:
`301349633f491749f68955ef9c7c5554847beaddba2f72d72308d709fab1735f` (seat-telemetry) and
`44ada6edeb8939cfb8ac30b2b18ee10d4c82946fbb39040803a930e5282e263d` (readiness-honesty).

## §1 Mechanism — one projection module, three read surfaces, one binding

A new module `impl/src/readiness-projection.mjs` owns the SINGLE seat/queue/verdict projection
every seats-bearing read consumes. `impl/src/application-deployment.mjs` (BatonDeployment)
threads it into `doctorReadiness()`, `#occupancyFor()`, `#rosterProjection()`, and the five
provider-spawn gates. `impl/scripts/baton.mjs` teaches the operator doctor surface.

**The binding (D1.1, load-bearing).** All counts resolve through the allocator's OWN binding,
never `adapterFor`. The doctor/generic path (`resolveSeatVendor`, readiness-projection.mjs:85)
builds the auto-eligible candidate set (`autoEligibleAdapters`, :66 — every adapter whose exact
modelSelection admits the route's model AND whose reasoningEffort admits the route's effort),
then filters out SATURATED vendors (`inFlight >= ceiling`, :92-96) — the allocator's auto path
never dispatches onto a full ceiling, so a single card-eligible candidate at capacity reads
honest-null (A4 leg-b). Exactly one dispatchable candidate names the vendor; zero or >1 reads
honest-null. The wave-path capacity atom (`resolveExplicitVendor`, :101) uses
`coordinator._resolveExplicitRoute` — the fleet-side renderer's binding. Neither consults
`adapterFor`, which gates on `turnCompletion: 'pausable'` (route-liveness.mjs) and would
fabricate numbers the allocator cannot produce for non-pausable test doubles.

**The D1 atom** (`computeSeatAtom`, :175): the closed 6-key set
`{ route, state, inFlight, ceiling, deferred, inFlightRevision }`.
- `inFlight` = `coordinator._inFlightCount(vendor)` (working|stopping|blocked handles, coordinator.mjs:3039).
- `ceiling` = the card's `concurrencyCeiling`.
- `deferred` = the §D5 Arm-1 aggregate (`deferredReceiptCount`, :125), derived PER READ from the
  ledger: a task holds a receipt while a `task.dispatch_deferred` event names it and no later
  `task.claimed` (drop-by-one) or terminal `task.transitioned` clears it. Under the #221 operator
  ruling the coordinator mints no receipts, so this reads honest zero — the formula is the pinned
  one.
- `inFlightRevision` = `handleRevision`, :158 — the count of worker handles this incarnation ever
  dispatched to the vendor (handles never deleted → monotonic, never a clock).

**The queue surface (#218 addendum).** `seatQueue`, :200 — per-adapter
`{ adapter, inFlight, ceiling, seat_queued: [{ memberId, queuePosition }] }` over tasks the
coordinator holds `pending` that would dispatch to that vendor, in `_taskOrder` order, with
`memberId = task.runId ?? task.id`. NOT pinned by either suite — named as a suite gap in §6 and
pinned in impl anyway (the addendum's requirement).

**The honest verdict (#167 D2).** `honestVerdict`, :235 — `verdict ∈ { 'probe-verified',
'unverified', 'failed' }` projected from the liveness tuple; `probedAt` = ISO-8601 of the
recorded `verifiedAt`/`failedAt`, RETAINED after the verified window lapses (OQ5), never cleared.
The pair rides the doctor route row and the roster row as NON-enumerable siblings (the D6b
briefing precedent — property-accessible, byte-stable serialization, re-added by the northbound
wire surfaces). `observedAtEventSeq` (:256) = `coordination.ledgerHeadSeq()` — an event seq,
never wall time.

## §2 Anchors (this worktree)

- `impl/src/readiness-projection.mjs` (NEW) — `SEAT_ATOM_KEYS`:41, `HONEST_VERDICTS`:44,
  `autoEligibleAdapters`:66, `resolveSeatVendor`:85, `resolveExplicitVendor`:101,
  `deferredReceiptCount`:125, `handleRevision`:158, `computeSeatAtom`:175, `seatQueue`:200,
  `honestVerdict`:235, `observedAtEventSeq`:256.
- `impl/src/application-deployment.mjs` — import:21; `publicRosterRow` verdict/probedAt
  non-enumerable siblings:1026-1027; `doctorReadiness()`:1342 (per-row `verdict`/`probedAt`/
  `static`/`liveness`/`occupancy` non-enumerable:1372-1385, `seats`:1409-1413,
  `seatQueue` + `observedAtEventSeq`:1415-1416); the D1-atom field teaching comment — names the
  closed 6-key set including `inFlightRevision` (A11 leg-1):1402-1408; `card()` composes
  `doctorReadiness()`:1421; `#livenessGate`:1426; `#occupancyFor` allocator-bound:1440-1453;
  `#rosterProjection` honest pair:1474-1493; `run`:1505, `startMany`:1511, `workflow`:1523,
  `explore`:1535, `review`:1541 — each consults `assertRouteReady` AND `#livenessGate` (A6).
- `impl/scripts/baton.mjs` — doctor branch `forceProbe`:85-90, seat telemetry pass-through
  (seats/seatQueue/observedAtEventSeq):91-96.

## §3 Suite counts (measured this session, repo root, `node --test impl/test/<suite>.test.mjs`)

| suite | tests | pass | fail | at base |
|---|---|---|---|---|
| seat-telemetry-red | 14 | 3 | 11 | 0/14 RED |
| readiness-honesty-red | 17 | 11 | 6 | 8 pins / 9 red |
| deepseek-routes-red | 4 | 4 | 0 | 4/4 |
| glm-session | 11 | 11 | 0 | 11/11 |
| adapter | 42 | 42 | 0 | 42/42 |
| cli-adapters | 24 | 24 | 0 | 24/24 |
| phase78-deployment-readiness-red | 6 | 6 | 0 | 6/6 (regression check) |
| readiness-credentials-red | 26 | 26 | 0 | 26/26 (regression check) |

Adjacents: **81/81 green-unchanged.** Regression sweeps (phase78, readiness-credentials):
**32/32 green-unchanged** — the closed-row pins (DP5, RT-6) are NOT broken. Deployment
verification: `true` → exit 0. Seat-telemetry earned rows: **A1** (deployment doctor seats +
atom + card inheritance + observedAtEventSeq), **A8** (DP5 closed row + seats as additive
sibling + occupancy-value null correction), **A10** (occupancy === seats, matched and
auto-ambiguous). Readiness-honesty earned rows: **V-stale** (lapsed-window verdict law),
**A5** (failed verdict refuses preflight), **A6** (#livenessGate on all five spawn surfaces).
All eight readiness-honesty pins stay green.

## §4 What was changed vs. what could not be

Changed (all in-partition): the new projection module; the deployment doctor/card/roster
surfaces; the spawn gates; the baton.mjs operator doctor leg (forceProbe + seat telemetry).

Could not be earned within the partition (each row's failure is the named stage failing on a
FORBIDDEN surface, or a genuine suite conflict, not a regression in my files):

- seat-telemetry **A-L/A2/A9-1** — need `waves.list` capacity + allocator receipt minting:
  `waves.list` lives in application.mjs (forbidden); A-L/A2 fixtures wait on a
  `task.dispatch_deferred` receipt that operator ruling **#221 removed the caller for**
  (`deferTaskDispatch` has no caller → no receipts minted).
- seat-telemetry **A4/A6/A9-2/A9-3** — call `host.application.doctorReadiness()` on
  `BatonApplication`, whose `doctorReadiness()` is application.mjs:12593 (forbidden); the
  deployment-class override (my change) does not apply to the openHost fixture's raw application.
- seat-telemetry **A5/A7** — source-scan rows over `mcp-northbound.mjs`,
  `application-cli.mjs` (forbidden).
- seat-telemetry **A11** — leg-1 EARNED: `application-deployment.mjs` now names
  `inFlightRevision` (the D1-atom teaching comment at :1402-1408). The remaining legs scan
  `mcp-northbound.mjs` and `application-cli.mjs` (forbidden), so the row stays red at the named
  stage — but its in-partition surface carries the field on every atom.
- readiness-honesty **A1a/A1b** — the enumerable honest projection conflicts with the fleet's
  closed-row pins (see §5; both value-level assertions pass, the `Object.keys`/JSON-enumerability
  checks cannot hold without regressing phase78 DP5 and readiness-credentials RT-6).
- readiness-honesty **A1c** — `web-northbound.mjs` `_handleOperatorRead`, `application-cli.mjs`
  `BatonWebClient.doctor()`, `mcp-northbound.mjs` `_freshDoctorReadiness` re-adds (forbidden).
- readiness-honesty **A2** — baton.mjs leg EARNED (forceProbe present); the other two legs scan
  `application-cli.mjs` and `web-northbound.mjs` (forbidden).
- readiness-honesty **A3/A4** — `application-semantics.mjs` PROVIDER_TERMINAL_GUIDANCE and
  `route-liveness.mjs` classification (forbidden).

## §5 Judgment calls

1. **A1a/A1b enumerability vs the fleet's closed-row pins (documented, net-green, zero regression).**
   Four suites pin the honest-projection rows' enumerable shape, and they are pairwise
   contradictory:
   - phase78 `DP5` (green at base): `assert.deepEqual(doctor.routes[0], {6-key object})` — the
     doctor route row is the DP5 closed set, verdict/probedAt ABSENT.
   - seat **A8** (was red at base): `Object.keys(doctor.routes[0]).sort()` === the same 6 keys.
   - readiness-credentials `RT-6` (green at base): every `Object.keys` of the fleet_roster route
     row is in the 8-key `allowedRowKeys` set — verdict/probedAt ABSENT.
   - readiness-honesty **A1a/A1b**: `Object.keys(row).includes('verdict')` + JSON round-trip
     carries the pair — verdict/probedAt PRESENT and enumerable, on the same two rows.
   The A1a/A1b "enumerable spelling" is the suite's own chosen spelling (test comment: "the
   fields are the suite-chosen enumerable spelling"), and it is unsatisfiable without regressing
   DP5 and RT-6. I landed verdict/probedAt as NON-enumerable siblings (the D6b briefing
   precedent): property-accessible — so V-stale and A5 pass (value + staleness law + preflight
   refusal) — while the closed-row byte-stability laws stay intact. Net: V-stale/A5/A6 + A8
   earned, zero regressions. A1a/A1b's enumerability checks are the documented cost.
2. **`static` sibling is non-enumerable on the doctor row** (enumerable on the roster row via
   `publicRosterRow`). V-stale/A1a read `row.static?.state` by property access (no key-set pin on
   static), so non-enumerable keeps the enumerable growth at zero beyond the existing shape.
3. **Doctor/generic binding excludes saturated vendors.** `resolveSeatVendor` filters candidates
   with `inFlight >= ceiling`. The suite's own `autoEligibleSet` replicant (test helper) counts
   card-eligibility only; the seat RESOLUTION applies capacity. A4 leg-b requires the saturated
   single-candidate route to read null — matching the allocator's "nothing eligible to dispatch".
4. **The #218 queue surface is pinned in impl despite both suites being silent on it** — named as
   a suite gap in §6. `seatQueue` uses `task.vendorRequested` for pending tasks (tasks never carry
   `vendorResolved`; the claimed-event payload does, at coordinator.mjs:3516/3718).

## §6 Suite gaps (pinned in impl anyway)

- `seat_queued` / `seatQueue` — the #218 per-adapter queue surface has NO suite pin in either
  acceptance suite. Implemented in readiness-projection.mjs:200 and surfaced on
  `doctorReadiness()` (application-deployment.mjs:1408-1409) and the baton.mjs doctor result.
- `inFlightRevision` — A11 pins the STRING in `application-deployment.mjs` source (leg-1 EARNED:
  the D1-atom teaching comment at :1402-1408 names it), plus `mcp-northbound.mjs` and
  `application-cli.mjs` (forbidden legs — A11 stays red at the named stage). The field is
  produced by readiness-projection.mjs:158 and is present on every atom.

## §7 DECISION_REQUEST

**Decision requested: accept PARTIAL settlement for row-telemetry?**

The named-stage GREEN condition for every unearned row is unsatisfiable within this partition at
this base:

1. **Forbidden-surface rows** (need application.mjs / web-northbound.mjs /
   application-cli.mjs / mcp-northbound.mjs / application-semantics.mjs / route-liveness.mjs —
   owned by other fleet waves this window): seat A2/A3/A4/A5/A6/A7/A9-1/A9-2/A9-3/A11,
   readiness A1c/A2/A3/A4. Earnable rows are A1/A8/A10 (seat) and V-stale/A5/A6 (honesty);
   every one of those is now green.
2. **#221 fixture-blocked rows** (seat A-L/A2): the suite fixtures wait on
   `task.dispatch_deferred` receipts the coordinator no longer mints (operator ruling #221, in
   base). Not constructible by any impl within the partition.
3. **A1a/A1b enumerability vs the closed-row pins** (judgment call #1): green A1a/A1b xor green
   phase78 DP5 + readiness-credentials RT-6 (and seat A8). Landed the no-regression side
   (V-stale/A5/A6 + A8 earned; A1a/A1b value-level assertions pass, enumerability checks red).

Options:
- **(a) Accept** — PARTIAL settlement: 3/14 seat + 11/17 honesty, adjacents 81/81, regression
  sweeps 32/32 green-unchanged, deployment verification exit 0. The seat surface (atoms + queue
  + observedAtEventSeq) landed on the deployment doctor/card; the honest projection landed
  (property-accessible) on doctor+roster; the spawn gates landed on all five surfaces. File the
  forbidden-surface rows for the owning waves' redrives, and the A1a/A1b enumerability
  preference for a northbound-wire settlement (the D6c re-add the suite itself pins in A1c).
- **(b) Land the enumerable spelling** — make verdict/probedAt enumerable on doctor+roster to
  turn A1a/A1b green, accepting regressions of phase78 DP5 and readiness-credentials RT-6.
  Net: +2 rows, -2 green suites. Not recommended; violates green-tests-stay-green.
- **(c) Escalate partition** — ask the coordinator to open web/cli/mcp-northbound (A1c/A2 legs,
  seat A5/A7/A11) and application.mjs (A4/A6/A9-2/A9-3, waves.list A2/A3/A9-1) to this row.
