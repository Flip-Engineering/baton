[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-146]

# Suite notes — #146 fleet seat telemetry (folded v1.1) — RED-first acceptance suite

Row type `row-suite-146`. This note records the red-first acceptance suite for the FOLDED #146
fleet seat-telemetry contract (`contract-146.md`, v1.1 fold). The suite itself is
`impl/test/seat-telemetry-red.test.mjs`; this note is the evidence record for the fold's suite
row: row inventory, stage table, measured RED splits (run twice, identical), judgment calls, the
publish-as-you-go refusal, and the deployment-verification command that "done" is gated on.

## Execution contract (reviewer enforces)

- Executable: `true`  (the run command is `node --test`)
- Argv: `[]`
- Cwd: `.`  (repo root — the suite resolves its source-file reads repo-root-relative)
- Expected exit: 0  — i.e. all 14 rows GREEN once the fold lands. RED at HEAD by design.
- Command: `node --test impl/test/seat-telemetry-red.test.mjs`

## Scope

Edits in this row: `impl/test/seat-telemetry-red.test.mjs` (created) and
`docs/reference/evidence/contract-foundry-2026-08-13/suite-notes-146.md` (this file). Nothing
else touched. Four throwaway probes were created during machinery verification and all deleted
before this row closed: `impl/test/.probe-146.mjs`, `impl/test/.probe-a2-time.mjs`,
`impl/test/.probe-146-verify.mjs` (the deployment-verification gate), and
`impl/test/.probe-a2-claim.mjs` (the A2 claim-forcing feasibility probe — see judgment call 7).

## Row inventory + stage table

Every RED row fails at a single **named stage assertion** — the first assertion in the row —
whose message is the string the row is titled with. The assertions after it are the contract's
GREEN condition and are reached only post-fold. The named stage is what the reviewer greps for.

| Row | Named stage | Contract pin | RED surface at HEAD |
|-----|-------------|--------------|---------------------|
| A-L | *(none — lint, GREEN)* | fixture machinery | blocking-decision dispatch holds a working seat; ceiling-skip mints the `mock` receipt; `adapterFor` diverges on pausability |
| A1 | `doctor-seats-missing` | D1 / D2.1 / D2.4 | `deployment.doctor` has no enumerable `seats` array; card does not inherit seats |
| A2 | `capacity-deferred-missing` | D1.2 / D2.2 / A4 / A6 | `waves.list` rows carry no capacity block — `deferred === 1` for a ceiling-skipped member unreadable |
| A3 | `waves-capacity-missing` | D2.2 / A3 | capacity block absent in BOTH roster forms (object via `_runWaveRoute`; run-less legacy string-roster reads `capacity: []`) |
| A4 | `doctor-seats-missing` | D1.2 / A4 / A5 | honest-null for auto routes (0 or >1 eligible) unreadable — no seats array exists |
| A5 | `seats-freshness-label-missing` | D3 / B3 | no seats-bearing read exists, so no `observedAtEventSeq` ledger-seq label; source surfaces carry no marker |
| A6 | `doctor-seats-missing` | D1.2 / A6 | vendor-scoped honesty (two routes → one vendor → identical counts) unreadable |
| A7 | `surface-teaching-missing` | D2.3 / #159 | doctor description names no seat capacity; waves.list description names no capacity; CLI doctor help teaches no closed field set |
| A8 | `doctor-seats-missing` | B2 / A8 | no additive `seats`/`observedAtEventSeq` siblings; occupancy VALUE for an auto-ambiguous route still fabricates a number |
| A9-1 | `capacity-inflight-missing` | D1.1 / B1 *(load-bearing)* | **allocator-agreement pin**: wave member dispatched with `vendorRequested: X` — counts of X via `_resolveExplicitRoute` unreadable; never `adapterFor`, never a different vendor |
| A9-2 | `doctor-seats-missing` | D1.1 / B1 *(load-bearing)* | doctor path — auto route with >1 eligible candidate reads all-null (router pick unpredictable from route identity) |
| A9-3 | `doctor-seats-missing` | D1.1 / B1 *(load-bearing)* | doctor path — auto route with exactly ONE eligible candidate reads that candidate's counts |
| A10 | `doctor-seats-missing` | D2.1 / B2 | single-occupancy-source: `routes[i].occupancy.inFlight === seats[i].inFlight` (matched numbers AND same null) unreadable |
| A11 | `inFlightRevision-missing` | D3 / B3 | live inFlight component has no per-atom `inFlightRevision` — incarnation-local handle-revision counter, never a clock |

Load-bearing row = **A9** (the allocator-agreement pin, redteam-146 B1). The 13 RED rows split
into projection rows (A1, A2, A3, A5, A6, A7, A11), staleness/honesty rows (A4, A8, A10), and
the allocator-binding legs (A9-1/A9-2/A9-3). A-L is the fixture-lint green guard: it proves the
machinery every RED row leans on (dispatch, ceiling-skip receipt, pausability-gated `adapterFor`)
is REAL at HEAD, so a RED row cannot fail for the wrong reason.

## Pin-coverage audit (every acceptance pin → a row at its named stage)

The folded contract's acceptance-pin table (contract-146.md:534-546) lists A1–A11. The suite maps
1:1, row → pin, and every row's first assertion is the row's named stage:

| Pin | Row(s) | Named stage | Pin clauses exercised in the row |
|-----|--------|-------------|----------------------------------|
| A1 | A1 | `doctor-seats-missing` | `seats` array enumerable; one atom per readiness route in order; `observedAtEventSeq`; route identity/state tracking; REAL numbers for a matched vendor (inFlight 0 / ceiling 4 / deferred 0); card inherits seats via `card()` (D2.4) |
| A2 | A2 | `capacity-deferred-missing` | capacity block present; dedup by route key (two members on R → ONE atom); `deferred === 1` = §D5 Arm-1 aggregate, never the mint-time-frozen inFlight; response `observedAtEventSeq` (D2.2) |
| A3 | A3 | `waves-capacity-missing` | capacity block in BOTH roster forms; object-roster route recovered via `_runWaveRoute`; run-less string-roster reads `capacity: []`; wave-observability A3-1 five-key member row byte-unchanged |
| A4 | A4 | `doctor-seats-missing` | honest-null for auto routes: >1 eligible (ambiguity) AND 0 eligible (saturation) read all-null incl. `inFlightRevision`; `state: 'ready'` never null |
| A5 | A5 | `seats-freshness-label-missing` | `observedAtEventSeq` is an event seq, never wall time; three source surfaces carry no marker at HEAD |
| A6 | A6 | `doctor-seats-missing` | two routes → one vendor read IDENTICAL inFlight/ceiling/deferred/inFlightRevision (vendor-scoped, never per-route) |
| A7 | A7 | `surface-teaching-missing` | doctor names seats + split staleness (inFlightRevision, observedAtEventSeq); waves.list names capacity; CLI help teaches the closed field set + deferred meaning |
| A8 | A8 | `doctor-seats-missing` | doctor route row stays the DP5 closed set (additive sibling, not a swap); occupancy VALUE for auto-ambiguous route corrects numeric → null |
| A9 | A9-1 / A9-2 / A9-3 | `capacity-inflight-missing` / `doctor-seats-missing` | wave path: `vendorRequested: X` reads X's counts via `_resolveExplicitRoute`, never a different vendor (A9-1); doctor path: >1 eligible → all-null (A9-2), exactly 1 eligible → that candidate's counts (A9-3); `adapterFor` is never the binding |
| A10 | A10 | `doctor-seats-missing` | `routes[i].occupancy.inFlight === seats[i].inFlight` for matched (same numbers) AND auto-ambiguous (same null) routes |
| A11 | A11 | `inFlightRevision-missing` | live inFlight component carries per-atom `inFlightRevision`; the source surfaces carry no `inFlightRevision` AND no clock derivation at HEAD |

Two pin clauses are covered by the derivation FORMULA rather than a forced fixture transition
(judgment calls 7 and 9): A2's "after a task claims, drops by one / a cancelled task leaves it"
(follows from deferred being derived per-read from the pending-with-receipt task set), and A4's
"bare host with no coordinator reads `inFlight: null`" (a bare host is not constructible through
public surfaces; the closest constructible equivalents — ambiguity and saturation — are both
pinned).

## Measured splits (run twice, identical)

Run from repo root (`cwd .`), at HEAD `e371f70`. The split was measured twice, and RE-MEASURED
twice after the pin-coverage strengthening edits (judgment calls 7–9, the A9-1 route→vendor
assertion, the A2 formula-coverage note) — identical every time:

**Run 1** — `node --test impl/test/seat-telemetry-red.test.mjs`
```
✔ A-L (lint)
✖ A1 ✖ A2 ✖ A3 ✖ A4 ✖ A5 ✖ A6 ✖ A7 ✖ A8 ✖ A9-1 ✖ A9-2 ✖ A9-3 ✖ A10 ✖ A11
ℹ tests 14   ℹ pass 1   ℹ fail 13
```

**Run 2** — identical
```
✔ A-L (lint)
✖ A1 ✖ A2 ✖ A3 ✖ A4 ✖ A5 ✖ A6 ✖ A7 ✖ A8 ✖ A9-1 ✖ A9-2 ✖ A9-3 ✖ A10 ✖ A11
ℹ tests 14   ℹ pass 1   ℹ fail 13
```

All 13 failing rows fail at their NAMED stage assertion (verified by grepping every distinct
`AssertionError` message — each is the row's `stage: ...` text; no fixture-lint failures, no
timeouts). All failures are expected RED: the fold's acceptance surfaces simply do not exist at
HEAD.

## Discriminator law (why `adapterFor` can never be the binding)

The allocator's explicit path (`_resolveExplicitRoute`, coordinator.mjs:2994-3034) does NOT gate
on `turnCompletion: 'pausable'`; `adapterFor` (route-liveness.mjs:121-129) DOES
(`routeMatches` gates pausable at route-liveness.mjs:35-47). Consequences the suite exploits:

- A **non-pausable** MockAdapter makes `adapterFor(route)` null while the allocator resolves the
  harness → a wrong impl reading `adapterFor` can never match the allocator's counts (A9-1/A9-3).
- A route with **>1 auto-eligible** adapter (mock + sibling, different harnesses, both
  advertising `mock-model`/`low`) makes the allocator's auto path read honest-null while
  `adapterFor` still reads the harness-keyed `'mock'` numeric counts (A9-2/A8/A10).

The `>1-eligible` case is the only constructible honest-null at HEAD (see judgment call 1). The
doctor-path auto rule also differs from the coordinator's round-robin `_resolveVendor`, which
PICKS among >1 eligible; the seats doctor path reads null for the same input (call 2).

## Publish-as-you-go: shared-scratchpad publish refusal

Per the foundry-brief law, this row attempted to publish to the `shared` scratchpad as it went.
The publish verb #158 (`run.scratchpad.append`) is **unlanded at HEAD** — the refusal IS the
evidence:

```
parseBatonCli(['run','scratchpad','append','run-1','--scope','shared','--entry','row-suite-146'])
  -> REFUSED cli_invalid | unexpected argument append
parseBatonCli(['run','scratchpad','write','run-1','--scope','shared','--entry','row-suite-146'])
  -> REFUSED cli_invalid | unexpected argument write
parseBatonCli(['run','scratchpad','read','run-1','--scope','shared'])
  -> PARSED { kind:'command', name:'run.scratchpad.read', ... }
```

Surfaces at HEAD expose only read/elevate/settle: the CLI `run scratchpad` subcommand handles
only read/elevate (application-cli.mjs:1476-1512), the command-name allowlist is
`run.scratchpad.read` / `run.scratchpad.elevate` (application-cli.mjs:30), and the only scratch
writer is the coordinator's internal `scratchpad.write` handler (coordinator.mjs:12690) — not a
worker-facing publish path. `cli_invalid: unexpected argument append` is the refusal; the shared
publish of this row's full text is deferred until #158 lands.

## Judgment calls (recorded, per the frame's escalation posture)

1. **route_unavailable / route_ambiguous blocked states are NOT constructible at HEAD.** Both
   `selectExactRouteCard` (application.mjs:1827 — returns null when `matches.length !== 1`) and
   the openBaton constructor (`application_profile_route_unavailable`) reject routes not matching
   exactly one adapter card. So A4/A9-2 construct the honest-null via the allocator's AUTO path:
   >1 eligible candidate (mock + sibling, both auto-eligible) or 0 eligible (ceiling-1 with one
   working member). Both share the "no single vendor to read" semantics the pins require.
2. **Doctor-path auto rule ≠ `_resolveVendor`.** `_resolveVendor` round-robins among >1 eligible;
   the seats doctor path reads null for >1 eligible by design (D1.1). The suite's `autoEligibleSet`
   replica implements the candidate predicate (`cardSupportsSession` + `resolveCardModel` +
   `resolveEffort`), not the pick.
3. **String-roster wave WITH a run is non-constructible.** `waves.start` accepts object members
   only (`_normalizeWaveStart` requires `member.exact`). A3 therefore seeds a run-less legacy
   string-roster wave via `recordDriver('wave.started', {roster: [...]})` and asserts the honest
   `capacity: []` for that arm — the object-roster arm proves the real rendering path.
4. **A8/A10 fixtures run WITHOUT a working run.** `BatonDeployment`'s `#driver` is private (no
   public getter), so a running-handle-based wait is impossible from the test side. Occupancy
   reads real zero at HEAD and must read null post-fix for an auto-ambiguous route; matched routes
   read the same zero from the same source. The blocking-decision dispatch (which proves a
   working seat stays held) lives in A-L/A9 where the receipt is observable.
5. **A11's source scan is repo-root-relative** (matches the execution contract `cwd .`); running
   the file from `impl/` alone breaks it. Recorded so a reviewer running `cd impl && node --test`
   knows the cwd requirement is deliberate.
6. **`observedAtEventSeq` is response-level, not per-wave-row.** A2 asserts it on the listed
   response (`listed.observedAtEventSeq`), consistent with D2.2 (ledger seq =
   `coordination.ledgerHeadSeq()`), not on each wave row.
7. **A2's dynamic clauses are formula-covered; forcing a claim is NOT constructible at HEAD.**
   The pin's "after a task claims (dispatches), the count drops by one; a cancelled task also
   leaves it" is guaranteed BY THE FORMULA: deferred is derived per-read from the set of
   pending-with-receipt tasks on the vendor, so a claim removes its task from that set (drop) and
   a cancel leaves the receipt (persist). Probing the fixture (`.probe-a2-claim.mjs`, deleted):
   the MockAdapter's blocking decision is NEVER delivered to the run's decision surface in the
   wave path — `decisionList` is `[]`, `status.attention` is `[]`, `blockedInteraction`/`waitingOn`
   are null (the task sits `claimed`/working without a surfaced ask) — so a holder cannot be
   answered to completion; and `run.stop` leaves the holder's handle `stopping`, which
   `_inFlightCount` (working|stopping|blocked, coordinator.mjs:3039-3045) still counts, so the
   seat never frees for a re-dispatch in the observation window. The suite therefore asserts the
   aggregate VALUE and single-pass derivation — the truth the pin's clauses follow from.
8. **A9-1's `vendorRequested: X` is the member's route harness.** `waves.start` accepts members
   of the strict shape `{role, objective, exact, scope}` only (`_normalizeWaveStart`,
   application.mjs:11907); there is no member-level `vendor` field. The vendor IS
   `member.exact.harness` → `task.vendorRequested` (coordinator.mjs:4058), and the 
   route.harness === vendorRequested identity is pinned at application.mjs:5543. So A9-1 asserts
   `atom.route.harness === 'mock'` as the `vendorRequested: X` axis, then that the atom reads
   `_inFlightCount('mock')` and NOT `_inFlightCount('sibling')`.
9. **A4's "bare host with no coordinator reads `inFlight: null`" is not constructible.**
   `openBaton`/`BatonDeployment` always wire a coordinator; a driver with a null coordinator is
   not reachable through public surfaces, and a ghost harness route is rejected at construction
   (`application_profile_route_unavailable`). The closest constructible equivalents of "no single
   vendor to read" — the >1-eligible auto route and the 0-eligible saturated route — are both
   pinned to all-null in A4, which is the honesty the clause is really about.

## Done-when gate (deployment verification)

Task brief: "Done when: Baton preserves exact route, result, and cleanup truth." That requires the
deployment verification command run against the fixture, not just the suite split. The suite's
fixture machinery (openHost/openBaton with `verification: {command: 'true', arguments: []}`,
cwd `.`, expectExit 0) is itself the deployment-verification substrate.

**Measured this session:** the suite-declared deployment verification command was run through the
harness's OWN verification path (`verify`, referee.mjs:249) — sandbox `cwd .`, `spawn('true', [],
{cwd, detached: true, env, shell: false})` (referee.mjs:181), expectExit 0, expectResult
`exit_code`:

```
verdict.passed = true
verdict.execution = completed
verdict.observedExit = 0
verdict.matchesClaim = true
```

The command exits 0 with the claimed exit matched — the exact-route / result / cleanup-truth gate
is clear at HEAD for the fixture substrate. The reviewer's RED/GREEN gate remains:

```
node --test impl/test/seat-telemetry-red.test.mjs   # cwd = repo root
# RED at HEAD: 14 tests, 1 pass (A-L), 13 fail at named stages (runs 1 and 2 identical)
```

Once the fold lands, the same command must exit 0 (all 14 rows GREEN) — preserving exact route,
result, and cleanup truth through the seats/observedAtEventSeq surface without disturbing the
doctor's DP5 closed route set or the waves.list roster truth.
