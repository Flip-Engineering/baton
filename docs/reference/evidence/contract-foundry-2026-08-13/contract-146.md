# Issue #146 — fleet seat telemetry surface: folded contract v1.1

The implementation contract for issue #146: the fleet's seat truth — per-route `inFlight` /
`ceiling` / `deferred` counts — exists in the machinery and is exposed NOWHERE, so the
orchestrator (and every wave driver) flies blind on capacity until a refusal arrives. This is
the **v1.1 fold** of `contract-146.md` (v1): the adversarial red-team report
(`redteam-146.md`, same dir) found v1 **NOT FOLD-READY** with three numbered blockers (B1–B3),
four amendments (A3–A6), and two citation nits (N1/N2). Every finding is folded below with the
red-team's concrete fix; where the red-team offered a choice, this contract names ONE option and
states why. Per the **blind-QA law**, the row report governs on conflict: the earlier
contract-foundry QA's "sound — the remaining risk is a derivation cost" (`foundry-qa.md` §#146)
was written WITHOUT the row report and is **overturned** by the row's three blockers (B1–B3).
The wave-b QA's §5 verdict (`review-foundry-2026-08-13-b/review-qa.md` §5, "SOUND with one
amendment") was likewise written WITHOUT the row report and is superseded on conflict by the
row's blockers; its §5.4 fold instruction set is nonetheless folded in: **H1** (the `deferred`
derivation cost) is folded via **A6** (single-pass derivation + stated ceiling), the D1 record
shape / D2 three read surfaces / D3 staleness+contention honesty / observe posture ship as
written (modulo B1–B3/A3–A6), and **OQ3** (`fleet_roster` fourth-surface wiring) is kept as the
named follow-on. Everything verdict'd SOUND in the red-team report and the QA is kept byte-stable
in substance. The contract remains a **Ring-2 contract** (ground truths → decisions → refusal
vocabulary → red-first acceptance pins → open questions): it **specifies behavior**; it does not
amend implementation in this artifact. It cross-references — it does not re-specify — the #74
seat-map (`impl-74-notes.md`), the #10 `capacity_ceiling` vocabulary
(`waiting-vocabulary-contract.md` §D5), the `waves.list` registry projection
(`wave-observability-contract.md` §D2), the #159 surface doctrine
(`doc-truth-conformance-contract.md` §D1), and the #157 ghost-trap anti-pattern.

- **Date:** 2026-08-13
- **Status:** FOLDED — implementation contract v1.1 (red-first; no code landed for this rung)
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot"), the tree this fold was verified against — identical to the v1 contract's and the
  red-team's verification HEAD, so every anchor the red-team verified at `e371f70` holds verbatim
  at this fold. Every `file:line` citation below was re-verified THIS session with
  `grep -an` / `sed -n` / `Read` at this HEAD, not inherited.
- **Brief:** `foundry-brief.md` and `row-telemetry.md` (same dir) — read fully. The issue body
  (`gh issue view 146`) could not be fetched (`gh` is not authenticated in this worktree); the
  requirements are carried by the row brief, the foundry frame, and the read-order below.
- **Fold inputs.** (1) `redteam-146.md` (same dir) — the adversarial report: NOT FOLD-READY, the
  three numbered blockers B1–B3 and amendments A3–A6 + nits N1/N2 at its end; (2)
  `review-foundry-2026-08-13-b/review-qa.md` §5 (§5.4 fold instruction set) and
  `review-foundry-2026-08-13-b/row-rt146.md` (the row brief the red-team attacked under); (3)
  `foundry-qa.md` §#146 (same dir) — the overturning "sound" verdict; (4) the v1 contract
  `contract-146.md` (the edit source); (5) the cross-referenced landed laws cited below.
- **Read-order executed.** (1) `foundry-brief.md` (the shared frame — Ring-2 form, no clocks,
  publish-to-shared); (2) `row-telemetry.md` (the objective brief — D1/D2/D3 questions); (3)
  `redteam-146.md` (the blockers/amendments this fold resolves); (4) `review-qa.md` §5 (the
  §5.4 set this fold ships); (5) the v1 contract; (6) every source anchor below (each re-verified
  at HEAD this session).
- **Scope of the rung, in one sentence:** the deployment doctor (the route-picking prerequisite)
  and the `waves.list` seat-map gain the fleet seat projection — a closed per-route record
  `{route, inFlight, ceiling, deferred, state, inFlightRevision}` over the EXISTING machinery
  (the coordinator's live in-flight count, the adapter card's concurrency ceiling, the #10 durable
  deferral receipts, and the readiness route state) — whose per-route vendor is bound to the
  allocator's OWN resolution (`_resolveVendor`/`_resolveExplicitRoute`/`AdaptiveRouter` semantics;
  `auto`-ambiguity → honest-null), whose occupancy has ONE source (the corrected
  `#occupancyFor`), whose freshness labels are split (an event-seq for the ledger-derived parts and
  an incarnation-local handle-revision counter — NOT a clock — for the live `inFlight` component),
  and whose `deferred` count is a single-pass ledger derivation with a stated cost ceiling; the
  deployment card inherits it via its existing `doctorReadiness` composition; no new MCP tool, no
  new refusal code, no clock control.
- **Shared-publish note (the shared post is absent — VERIFIED impossible, with evidence).**
  The foundry frame requires publishing the folded draft to the `shared` scratchpad partition, but
  NO surface verb to write a scratchpad note exists in this tree — the missing verb is issue #158,
  whose contract (`scratchpad-write-2026-08-13/scratchpad-write-contract.md`) is itself a draft
  artifact, not an implementation. Verified this session: CLI surfaces only
  `run.scratchpad.read` / `run.scratchpad.elevate` (`application-cli.mjs:1476-1512`); MCP surfaces
  only `baton_scratchpad_elevate|settle` / `baton_run_scratchpad_read|elevate`
  (`mcp-northbound.mjs:586-665`); the web surface has NO scratchpad verb; the registry lists
  read/elevate/settle only (`application-semantics.mjs:1338,1678-1693`). The ONLY writer is the
  coordinator handling a live worker session's internal `scratchpad.write` event
  (`coordinator.mjs:12690-12693`, `claude-session.mjs:1146`) — unreachable from this filesystem
  worktree, and the store kernel (`coordination-store.mjs:14064-14148`) demands the live auth
  + idempotency envelope. The audit of the prior campaign flags the same asymmetry
  (`control-surface-audit-2026-08-13/control-surface-audit.md` §2 #10), and the red-team's own
  §8 shared-publish note re-verified it. The coordinator's brief provides the documented fallback
  for exactly this case: read the durable files where the shared post is absent and note which
  (`coordinator-brief.md:12`). The durable file below is that fallback; the shared post is recorded
  as ABSENT (this note is the "which").

---

## Fold map (red-team finding → resolution → where in v1.1)

| # | Finding (red-team / QA) | Verdict | Resolution folded | Where in v1.1 |
|---|---|---|---|---|
| 1 | **B1** — the per-route vendor binding is `adapterFor(route).vendor` (`route-liveness.mjs:121-129`), a *parallel resolution*, not the allocator's (`_resolveVendor`/`_resolveExplicitRoute`/`AdaptiveRouter`, `coordinator.mjs:2953-3034`, `router.mjs:198-206`); a seats row can report the wrong vendor's capacity | blocker | bind the atom through the allocator's OWN resolution: `#seatsVendor(route, member?)` runs the allocator's semantics route-scoped — the wave path binds `member.vendor` via `_resolveExplicitRoute` (`coordinator.mjs:4051` mints it); the `auto` path names a vendor only when the eligible adaptive set has exactly 1 member, else honest-null (ambiguous by design); `adapterFor` is dropped as the binding | D1 (D1.1), D2.2, A4, A9, OQ1 |
| 2 | **B2** — one doctor response carries two disagreeing occupancy values (`#occupancyFor` fabricates a NUMBER for an unmatched route; the new `seats[i]` reads null) | blocker | `#occupancyFor` is the SINGLE occupancy source, allocator-bound (B1), unmatched → `{inFlight: null, concurrencyCeiling: null}`; the doctor's non-enumerable `occupancy`, the seats atom, and `publicRosterRow`'s enumerable `occupancy` read the SAME value; A8 states the numeric→null change is the intended correction | D1 (D1.2), D2.1, A8, A10 |
| 3 | **B3** — `observedAtEventSeq` (a replay-consistent ledger seq) does not label the live `inFlight` component; D3's "compare two reads and know which is newer" is false for it | blocker | split the freshness labels: `observedAtEventSeq` labels the ledger-derived parts; a per-atom `inFlightRevision` (an incarnation-local per-vendor handle-revision counter, NOT a clock) labels the live component; D2.3 teaching reworked; claim (a) is pinned only for what each label actually tracks | D1 (D1.4), D3, D2.3, A11 |
| 4 | **A3** — D2.2's capacity block is empty for object-roster waves (the route field exists only in the string-roster branch, `application.mjs:11782-11784`) | amendment | the object-roster path recovers each member's route via `_runWaveRoute` / the steering-registered record (`application.mjs:11610-11619`); the pinned member row (wave-observability A3-1) stays untouched; `capacity` remains the wave-row sibling | D2.2, A3 |
| 5 | **A4** — `deferred` can overstate "currently ceiling-waiting": a pending-with-receipt task whose ceiling cleared is counted even though the allocator's next pass would dispatch it | amendment | **choice (a):** re-teach `deferred` STRICTLY as "skipped-at-the-ceiling-and-still-pending"; the words "currently ceiling-waiting" are explicitly forbidden; the §D5 Arm-1 derivation is unchanged (no current-ceiling condition — that would be a vocabulary escalation to record, not a silent change) | D1 (D1.2), D3, D2.3, A2 |
| 6 | **A5** — the raw application's seats path has no named vendor resolution (no `#liveness`) | note | the raw path runs the SAME allocator-bound `#occupancyFor`/`#seatsVendor` via `this.driver.coordinator` (the raw doctor already reaches the coordinator for `_reuseDecisionPolicy`, `application.mjs:12437`); a bare host with no coordinator reads all-null (the v1 pin) | D2.1, A4 |
| 7 | **A6** — the `deferred` aggregate is an unbounded O(routes × events) scan per read; the QA's H1 named the same gap | amendment | a SINGLE-PASS derivation: one ledger sweep builds a receipt→(vendor, pending-task) map — O(E+D) once, not per route — then O(R) to render; the cost ceiling is stated in the D2.3 teaching text | D1 (D1.2), D3, D2.3, A2 |
| 8 | **N1** — the refusal table's `(D5.2)` is a dangling cross-ref (contract-146 has no D5) | nit | cite `wave-observability-contract.md` §D5.2 explicitly | refusal vocabulary |
| 9 | **N2** — A7's "neither tool description mentions capacity" is textually loose (the doctor description DOES say "workspace capacity") | nit | reworded: "no *seat* capacity" | A7 |
| 10 | QA §5.4 **H1** — `deferred` cost/ceiling unstated | amendment | folded via A6 (single-pass + stated ceiling) | D1 (D1.2), D3, D2.3 |
| 11 | QA §5.4 — ship D1 record shape / D2 three surfaces / D3 staleness+contention / observe posture | ship | kept as written, modulo B1–B3 + A3–A6 (the blockers are the corrections, not re-scopes) | D1–D3, refusal vocabulary |
| 12 | QA §5.4 — keep OQ3 (`fleet_roster`) as the named follow-on | keep | OQ3 stays a separate surface-wiring rung; with the red-team's caveat that the B2 occupancy-honesty fix must land before/with the OQ3 wiring (else the enumerable `publicRosterRow` occupancy is the fabricate-0 on a serialized surface) | OQ3 |

---

## Ground truths (verified this session)

- **G1 — the per-vendor in-flight count EXISTS, is LIVE, and is the dispatch-gating authority.**
  `coordinator._inFlightCount(vendor)` (`coordinator.mjs:3039-3045`) counts worker handles with
  status `working | stopping | blocked` for the vendor. It is the exact count the ceiling skip
  gates on: `if (this._inFlightCount(vendor) >= card.concurrencyCeiling)` (`coordinator.mjs:2903`).
  It is **live coordinator state** (handle statuses), not a durable store projection — a
  restart reconstructs handles from the durable `task.claimed` records, but `stopping`/`blocked`
  handle statuses are incarnation-live. This is the ONE component of the record that is not
  replay-consistent by itself; the record labels it as such (D3, B3).
- **G2 — the per-vendor ceiling EXISTS and is STATIC.** `adapter.card().concurrencyCeiling` — read
  at `application-deployment.mjs:1395-1396` (`Number.isSafeInteger(match?.adapter?.card()
  ?.concurrencyCeiling) ? match.adapter.card().concurrencyCeiling : 1`). It is card config
  (durable static), not a live count.
- **G3 — "deferred" EXISTS as durable receipts; NO aggregate projection exists anywhere.** The
  ceiling skip mints ONE durable `task.dispatch_deferred` receipt per task dispatch,
  idempotency-keyed `task.dispatch_deferred:<taskId>:<taskCreatedSeq>`
  (`coordinator.mjs:2904-2916`; `deferTaskDispatch`, `coordination-store.mjs:13186-13201`). The
  payload is `{taskId, vendor, ceiling, inFlight, taskCreatedSeq}` — `inFlight` FROZEN at mint
  time (`coordination-store.mjs:13188-13189`). The replay path deliberately has **NO projection
  state**: "the waitingOn projection reads the ledger by task id; replay re-derives it by re-reading
  the log" (`coordination-store.mjs:8039-8042`). The per-task read exists
  (`projectWaitingOn` → `capacity_ceiling`, `application.mjs:444-460`); the per-vendor AGGREGATE
  does not.
- **G4 — the doctor ALREADY computes occupancy, but attaches it NON-ENUMERABLY — invisible to
  every serialized surface.** `#occupancyFor(route)` (`application-deployment.mjs:1390-1398`)
  resolves the vendor via `this.#liveness?.adapterFor(route)` (`route-liveness.mjs:121-129`;
  `match?.vendor ?? route.harness`) and computes `{inFlight, concurrencyCeiling}`. The deployment
  facade's `doctorReadiness()` (`application-deployment.mjs:1329-1369`) attaches it to each route
  row via `Object.defineProperty(composed, 'occupancy', { enumerable: false })`
  (`:1346-1349`) — same for `liveness`. JSON/CLI/MCP serialization drops non-enumerable fields, so
  the occupancy the doctor computes never reaches a serialized consumer. This is the exact gap
  #146 closes. **Fold (B2):** the SAME `#occupancyFor` is the single occupancy source for the new
  seats atom; its unmatched-vendor fabrication (`vendor = route.harness`, `inFlight =
  _inFlightCount(route.harness)`, `0` via the no-coordinator branch at `:1393-1394`) is corrected
  to honest-null (D1.2).
- **G5 — the fleet_roster projection computes the FULL route row including occupancy, but is NOT
  wired to ANY command surface.** `#rosterProjection()` (`application-deployment.mjs:1419-1442`)
  → `publicRosterRow` (`:1005-1016`) produces `{harness, model, effort, provider?, static:{state,
  code?, summary?}, liveness, occupancy:{inFlight, concurrencyCeiling}, learning}` — with
  `occupancy` ENUMERABLE at `:1013` (`#rosterProjection` consumes the same `#occupancyFor` at
  `:1430`). It is reachable ONLY via the facade `deployment.fleet.roster()` (`:1320-1322`). The
  `fleet_roster` operation is registered in the advanced set (`application-semantics.mjs:1108`) but
  has NO dispatch branch in `application.mjs`, NO MCP tool, NO CLI parser branch (`grep -an "fleet"
  application-cli.mjs` returns nothing). It is a registered-but-dead surface — the #157 ghost this
  contract refuses to copy (D2). **Fold (B2/OQ3):** because `publicRosterRow` exposes `occupancy`
  ENUMERABLY, the `#occupancyFor` honesty correction must land before/with any `fleet_roster`
  wiring (OQ3) so the serialized roster never reads the fabricate-0.
- **G6 — `waves.list` has the #74 seat-map (member → route) but NO capacity.** `waveList`
  (`application.mjs:11759-11822`) renders per-wave rows with per-member
  `{role, route, scope, liveness, phase, progressClass, attentionCount}`; the string-roster
  member's `route` is recovered from the steering-registered record via `_runWaveRoute`
  (`application.mjs:11610-11619`, `:11782-11784`) — the #74 D3 seat-map (`impl-74-notes.md:19`).
  The object-roster branch (`:11803-11809`) renders the wave-observability A3-1 pinned five keys
  `{attentionCount, liveness, phase, progressClass, role}` — **no route field**. The wave row
  (`:11811-11818`) carries NO inFlight/ceiling/deferred. **Fold (A3):** the object-roster path
  recovers each member's route via `_runWaveRoute` for the capacity derivation (D2.2).
- **G7 — route STATE exists on the readiness routes.** `deploymentReadiness`
  (`application-deployment.mjs:1088-1165`) computes every route's `state` (`ready` | `blocked` +
  `code` + `summary`, plus `additionalRouteStates`); `publicRosterRow` exposes it as
  `static.state` (`:1422-1426`). The raw application's `doctorReadiness` overrides every profile
  route's state to `'ready'` (`application.mjs:12430-12432`). State is always present (never null).
- **G8 — the three candidate surfaces.** (a) The **doctor** — `deployment.doctor`, the "route-
  picking prerequisite" (`mcp-northbound.mjs:559-562`); CLI `baton doctor` (`application-cli.mjs:
  1261-1267`); dispatch `application.mjs:12574`. (b) **`waves.list`** — the observe registry read
  (`application-semantics.mjs:1622-1632`); dispatch `application.mjs:12569`; MCP
  `baton_waves_list` (`mcp-northbound.mjs:541-547`). (c) The **deployment card** — `card()`
  (`application-deployment.mjs:1371`) composes `doctorReadiness()`, so it inherits whatever the
  doctor carries. The #74 seat-map lives on (b); the occupancy computation lives on (a).
- **G9 — the #10 `capacity_ceiling` vocabulary pins exactly what "deferred" means.** The
  waiting-vocabulary contract §D5 (`waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md:
  223-240`): `capacity_ceiling` iff the node's `taskId` exists AND `task.status === 'pending'` AND
  the deferral receipt exists (`:234-235`); "a durable RECEIPT (event kind), not a refusal — the
  ceiling queue" (`:485`); "`detail.inFlight` is mint-time-frozen, never live queue depth"
  (`:467`). The seat record's `deferred` is the §D5 Arm-1 condition aggregated per vendor.
  **Fold (A4):** the derivation is UNCHANGED (Arm-1: pending ∧ receipt); only the TEACHING is
  tightened so it cannot read as "currently ceiling-waiting" (D1.2, D2.3).
- **G10 — the derivation needs NO new authority.** `coordination.events()` returns the durable
  ledger (`coordination-store.mjs:8875-8879`); `coordination.task(id)` returns the durable task
  clone (`:8917`); `coordination.ledgerHeadSeq()` returns the replay-consistent head
  (`:13374-13376` — `this._events.length`); `coordinator.list()` returns the live public handles
  (`coordinator.mjs:12031-12034`); `routeCards()` returns the adapter cards (`:10337-10342`).
  Every field of the record is either an existing read or a derivation over existing reads — no new
  mechanism.
- **G11 — the allocator's own resolution is `_resolveVendor`/`_resolveExplicitRoute` +
  `AdaptiveRouter`, NOT `adapterFor`.** `_resolveVendor(task)` (`coordinator.mjs:2953-3034`) has
  two branches. For `vendorRequested !== 'auto'` it calls `_resolveExplicitRoute(vendorRequested,
  {sessionRequest, model, modelPolicy, effort, workerPolicyRequest})` (`:2994-3034`), which
  filters adapters by `name === requestedHarness || card().harness === requestedHarness` and
  refuses `route_ambiguous` when more than one candidate survives the session/model/effort/
  worker-policy gates (`:3028`). For `vendorRequested === 'auto'` it builds the candidate set over
  EVERY adapter that `cardSupportsSession` + `resolveCardModel` + `resolveEffort` succeed on, and
  `_route` (`:2986`) → `AdaptiveRouter.pick` (`router.mjs:198-206`) chooses by load + adaptive
  success history (eligible = `inFlight < concurrencyCeiling`, `:202`). **`adapterFor`
  (`route-liveness.mjs:121-129`) is a DIFFERENT static route→adapter match** (harness-keyed,
  unique-or-null) and is NOT the allocator's binding. **Fold (B1):** the seats atom binds through
  G11, never `adapterFor` (D1.1).
- **G12 — the handle lifecycle is incarnation-live, so a revision counter is derivable.** The
  handle registry is `this._workers` (a Map, initialized per incarnation at `coordinator.mjs:1166`);
  handles are inserted at `:4620, :4651` and their `status` transitions among the counted set at
  `:2494, :3783, :5717, :5740, :7571, :7679, :7751` (working; `:5740` working→stopping). A restart
  re-initializes the Map (`:1166`), so a counter over these transitions is incarnation-local by
  construction. **Fold (B3):** the atom's live-component freshness is a per-vendor
  incarnation-local handle-revision counter derived from this lifecycle (D1.4, D3).

---

## D1 — the projection shape

The closed per-route record — the ONE atom every surface carries, byte-identical across surfaces:

```js
{
  route:             { harness, model, effort, ...(provider ? { provider } : {}) },  // the readiness route identity
  inFlight:          <safe-integer> | null,   // coordinator._inFlightCount(vendor)        — LIVE
  ceiling:           <safe-integer> | null,   // adapter.card().concurrencyCeiling          — static
  deferred:          <safe-integer> | null,   // capacity_ceiling aggregate                 — single-pass ledger-derived
  state:             <string>,                // route.state from readiness                 — never null
  inFlightRevision:  <safe-integer> | null,   // resolved vendor's handle-revision counter  — LIVE (B3)
}
```

The atom is still the ONE atom every surface carries. The v1 atom is extended by ONE field —
`inFlightRevision` — and the vendor each count is read against is REBOUND to the allocator's own
resolution (B1). `observedAtEventSeq` remains a **response-level** composition marker (one value
per response, D3); `inFlightRevision` is **per-atom** (each row carries its resolved vendor's
revision).

### D1.1 — the route→vendor binding is the ALLOCATOR's, not `adapterFor` (B1)

Every count in the atom is computed for the vendor the allocator WOULD dispatch this route's work
to — never a parallel resolution. The binding function is `#seatsVendor(route, member?)`, running
the allocator's own semantics route-scoped:

- **Wave path** (a route in a `waves.list` capacity block): the wave member on the route was
  dispatched with `vendorRequested: member.vendor` (the orchestrator-authored binding,
  `coordinator.mjs:4051`). The seats vendor is the result of the allocator's EXPLICIT path,
  `_resolveExplicitRoute(member.vendor, {sessionRequest: {mode: 'new'}, model: route.model,
  modelPolicy: null, effort: route.effort, workerPolicyRequest: null})`
  (`coordinator.mjs:2994-3034`). When the explicit path returns `ok: false` (including
  `route_ambiguous`, `:3028`), the atom reads all-null counts (the allocator cannot name one
  vendor either). When the wave's members on the SAME route resolve to DIFFERENT vendors, the
  atom reads all-null (honest — the wave's work on that route would spread across vendors).
- **Doctor/generic path** (a readiness route with no wave member): run the allocator's semantics
  for a task requesting the route's identity. When `route.provider` is set, the request is
  explicit — `_resolveExplicitRoute(\`${route.harness}:${route.provider}\`, {sessionRequest:
  {mode: 'new'}, model: route.model, effort: route.effort, ...})` — the provider-scoped card the
  allocator's `_resolveExplicitRoute` harness filter (`name === requestedHarness ||
  card().harness === requestedHarness`, `:2994-3000`) selects. When `route.provider` is absent,
  the request is `auto` — build the `_resolveVendor` candidate set (every adapter that
  `cardSupportsSession` + `resolveCardModel` + `resolveEffort` succeed on, `:2967-2984`) and
  apply the router's eligibility predicate (`eligible = inFlight < concurrencyCeiling`,
  `router.mjs:202`):
  - exactly ONE eligible member → that vendor is the allocator's only choice; the atom reads its
    counts;
  - ZERO or MORE THAN ONE eligible member → **honest-null** (ambiguous by design: with 0 eligible
    the allocator dispatches nothing; with >1 eligible the router picks by load/adaptive history,
    which the route identity alone cannot predict).
- **`adapterFor` is dropped as the binding.** It remains in the machinery for the liveness probe
  and the pre-existing `#occupancyFor` callers, but the seats atom NEVER resolves its vendor through
  it — the whole point of B1 is that a telemetry surface whose vendor differs from the allocator's
  is worse than none.

**The wave-path acceptance pin (red-team B1):** for a wave member dispatched with
`vendorRequested: X` on route R, the seats row for R reads the counts of X (or null when the
allocator refuses `route_ambiguous`), never a different vendor's counts. Pinned as A9.

### D1.2 — field-by-field derivation (each verified G1–G12)

- **`route`** — the readiness route identity: `{harness, model, effort}` (`publicRoute`,
  `application-deployment.mjs:267-269`), plus `provider` when the route declares one
  (`route.provider`, `:1089`, `route-liveness.mjs:123`). This is the SAME identity
  `deploymentReadiness` maps routes with and the B1 resolution resolves vendors from.
- **`inFlight`** — `coordinator._inFlightCount(vendor)` for the B1-resolved vendor (G1, G11).
  This is the LIVE count that gates dispatch (`coordinator.mjs:2903`). It is NOT replay-consistent
  by itself — the record labels the atom as a point-in-time composition and labels the live
  component with `inFlightRevision` (D3, B3).
- **`ceiling`** — `adapter.card().concurrencyCeiling` for the B1-resolved vendor (G2). Static.
- **`deferred`** — the §D5 Arm-1 aggregate (G3, G9): the number of DISTINCT tasks that (a) are
  currently `pending` and (b) hold a `task.dispatch_deferred` receipt on this vendor:
  `#{ task : coordination.task(task.id)?.status === 'pending' ∧ ∃ receipt ∈ coordination.events() :
  receipt.kind === 'task.dispatch_deferred' ∧ receipt.payload.taskId === task.id ∧
  receipt.payload.vendor === vendor }`. **Fold (A6):** the aggregate is derived in ONE pass — a
  single sweep over the ledger builds a receipt→(vendor, pending-task) map (each receipt's
  `taskId` status read is O(1) via `coordination.task`, `coordination-store.mjs:8917`), then each
  route's `deferred` is the resolved vendor's map-set size — **O(E + D + R)** per response
  (E = ledger events, D = distinct deferred tasks, R = routes), NEVER O(routes × events). A task
  that later claims (dispatches) or cancels leaves the count. **Fold (A4):** `deferred` means
  EXACTLY "skipped at the ceiling and still pending" — the teaching text must not read as
  "currently ceiling-waiting" (D2.3).
- **`state`** — the route's static readiness state (G7), always a string, never null. The raw
  application (no facade) reads `'ready'` for every profile route (`application.mjs:12430-12432`);
  the deployment facade reads the computed state.
- **`inFlightRevision`** — **Fold (B3):** the resolved vendor's incarnation-local handle-revision
  counter at composition (G12). It is a counter incremented on every handle insert/remove/status
  transition for that vendor — never a clock — so two atoms for the same vendor with equal
  `inFlightRevision` carry the same live `inFlight`. `null` when the vendor is null/ambiguous (no
  handle registry to read a revision for). Its monotonicity is per incarnation; a restart resets it
  with the handle Map (`coordinator.mjs:1166`).

**The honesty of `null`.** A count is `null` exactly where it is **unobservable** — never a
fabricated zero:

| Field | `null` when | Numeric when |
|---|---|---|
| `inFlight` | the B1 resolution names NO vendor — `route_unavailable` / `route_ambiguous` (`application-deployment.mjs:1094-1102`), a route_not_ready block (`:1158-1163`), or `auto`-ambiguity (0 or >1 eligible members, D1.1). The coordinator has no adapter to count for; `0` would claim "definitely zero seats taken" against a route that cannot even run. | the B1 resolution names a vendor; `0` is a real, observable zero (the coordinator IS running and can count — `_inFlightCount` over an empty handle set). |
| `ceiling` | no vendor resolves (no card to read). | a vendor resolves; the card's declared ceiling (never `0` in practice — `application-deployment.mjs:1395-1396` defaults to `1` when a card lacks the field). |
| `deferred` | no vendor resolves (no dispatch would ever be deferred onto an unavailable vendor). | a vendor resolves; the pending-with-receipt count above (including `0` — an honest "no task was skipped at the ceiling and is still pending"). |
| `inFlightRevision` | no vendor resolves (B3 — no handle registry to read a revision for). | a vendor resolves; the vendor's handle-revision counter (a safe integer, `0` for a fresh incarnation with no handle transitions). |
| `state` | never. Readiness always computes a state for every route (G7). | always a string. |

**Fold (B2) — the single occupancy source.** The atom's `inFlight`/`ceiling` ARE the corrected
`#occupancyFor` (D2.1): the doctor's existing non-enumerable `occupancy`, the seats atom, and
`publicRosterRow`'s enumerable `occupancy` all read the SAME allocator-bound value. After the
rung, `routes[i].occupancy.inFlight === seats[i].inFlight` for the same route in the same
response — the two-disagreeing-values contradiction (B2) is structurally gone.

**The freshness frame.** The atom is a **point-in-time composition** over four sources:
`inFlight` from the coordinator's live handles (G1), `ceiling` from the static card (G2),
`deferred` from the durable ledger + task status (G3/G10), `state` from the readiness routes (G7).
It is a SNAPSHOT, never a transaction — a dispatch admitted between the `inFlight` count and the
render makes the read stale by up to one seat. Every seats-bearing response carries the
replay-consistent composition marker `observedAtEventSeq` = `coordination.ledgerHeadSeq()` at
composition time (`coordination-store.mjs:13374-13376`) — an **event sequence, never wall time**
(the campaign no-clock law; the roster projection's `new Date().toISOString()` at
`application-deployment.mjs:1420` is a data stamp this contract does NOT copy). **Fold (B3):** the
event-seq labels the ledger-derived parts (`deferred`, `state`, `ceiling`) only; the live
`inFlight` component is labeled by the per-atom `inFlightRevision` (D3). A reader that needs a
deterministic ordering across the ledger composes on the seq; a reader that needs to know whether a
route's live count moved compares `inFlightRevision`.

---

## D2 — the surfaces

**Decision: one projection function, three read surfaces — the doctor is primary, `waves.list`
is the additive seat-map completion, the deployment card inherits via composition. The MCP tool
shape is the EXISTING `baton_deployment_doctor` + `baton_waves_list`, extended — no new MCP tool.**

Why the doctor is primary: it is already described as "the route-picking prerequisite"
(`mcp-northbound.mjs:559-562`) — the exact capacity question an orchestrator asks before routing —
and it ALREADY computes occupancy per route (G4). Making that computation enumerable and adding
`deferred` completes an existing surface; it does not add a new one. Why `waves.list`: the #74
seat-map (member → route) just landed there (G6); adding route → capacity completes the seat map
— a wave driver reads "who is in my wave, on which routes, with how many seats left" in ONE read.
Why the card: `card()` composes `doctorReadiness()` (`application-deployment.mjs:1371`), so it
inherits the `seats` array with no separate seam — named, not re-specified.

Why **no new MCP tool**: a dedicated `baton_route_seats` tool would require the full #159
admission chain (a `TOOL_DEFINITIONS` row, a capability class, a `validateArguments` branch, a
`_dispatch` branch, the `ORDINARY_EXPLICIT_TOOLS` typed-failure mapping, and the generated docs)
for ONE observe verb the doctor already serves — the #157 ghost-trap the surface doctrine exists
to avoid (`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md` §D1; the
scratchpad-write fold names the same trap, `scratchpad-write-2026-08-13/contract-fold.md` D2.4).
The doctor is quota-free and per-call FRESH by design (`mcp-northbound.mjs:559-562,
1474-1479`), so capacity rides it without a new quota class.

### D2.1 — the doctor surface (`deployment.doctor`)

- The deployment facade's `doctorReadiness()` (`application-deployment.mjs:1329-1369`) gains a
  top-level **`seats`** array: one closed record per readiness route, in readiness route order
  (the `routes` order), each the D1 atom. The existing `routes` array stays **byte-unchanged**
  in shape (the DP5 closed enumerable set). **Fold (B2):** the `occupancy`/`liveness`
  non-enumerable fields stay non-enumerable, but their VALUE is the corrected single-source value —
  for an unmatched/ambiguous route, `occupancy` reads `{inFlight: null, concurrencyCeiling: null}`
  (the A8-stated numeric→null correction), so the non-enumerable `occupancy` and the enumerable
  `seats[i]` NEVER disagree for the same route in the same response. `seats` is a NEW enumerable
  SIBLING, and the response carries `observedAtEventSeq` (D3) with each atom carrying its own
  `inFlightRevision`.
- **Fold (B2) — `#occupancyFor` is the single occupancy source.** The existing
  `#occupancyFor(route)` (`application-deployment.mjs:1390-1398`) is corrected to resolve the
  vendor via the B1 allocator binding (D1.1) instead of `match?.vendor ?? route.harness`, and its
  unmatched-vendor result changes from the fabricate-0 `{inFlight: 0, concurrencyCeiling: 1}` to
  `{inFlight: null, concurrencyCeiling: null}` (the A4 honesty rule). Its two existing consumers —
  the doctor's non-enumerable `occupancy` and `#rosterProjection`'s pass-through to
  `publicRosterRow` (`:1430` → `:1013`) — are pinned to the SAME value (A10). This is the ONE
  occupancy computation in the doctor response; there is no second, disagreeing one.
- The raw application's `doctorReadiness()` (`application.mjs:12429-12452`) — used when no
  deployment facade overrides — gains the same `seats` array over its profile routes (state
  `'ready'`, `:12430-12432`), so "the ordinary surface always has an honest answer"
  (`:12426-12428`) holds for capacity too. **Fold (A5) — the raw path's resolver is NAMED:** the
  raw path runs the SAME allocator-bound `#occupancyFor`/`#seatsVendor` via
  `this.driver.coordinator` — the raw doctor already reaches the coordinator for
  `_reuseDecisionPolicy` (`:12437`), and `_resolveExplicitRoute`/`_resolveVendor` are coordinator
  methods, so no `#liveness` facade dependency is introduced. A bare host with no coordinator
  reads `inFlight: null` (unobservable — no coordinator incarnation), never `0`.
- **CLI:** `baton doctor` (`application-cli.mjs:1261-1267`) output gains `seats`; the `--check`
  verdict text teaches the record (D2.3).
- **MCP:** `baton_deployment_doctor` (`mcp-northbound.mjs:564-568`) returns the doctor document
  including `seats`; its description gains the teaching sentence (D2.3). No input-schema change
  (the tool is already argument-free beyond `repo`).

### D2.2 — the `waves.list` seat-map completion

- `waveList` (`application.mjs:11759-11822`) gains, per wave row, an additive **`capacity`**
  block: the closed set of DISTINCT routes its members occupy, each as the D1 atom, deduplicated
  by route key. The per-member rows (`:11783-11786`, `:11803-11809`) and the wave row's existing
  keys (`:11811-11818`) stay byte-unchanged — `capacity` is a new enumerable sibling on the wave
  row, and the response carries `observedAtEventSeq`.
- **Fold (A3) — the object-roster path is SPECIFIED.** The `route` fields at `:11782-11784` exist
  only in the string-roster branch; the object-roster branch (`:11803-11809`) has no route field.
  The capacity derivation therefore recovers each OBJECT member's route via `_runWaveRoute` / the
  steering-registered record (`application.mjs:11610-11619`) — the same recovery the string-roster
  branch uses — BEFORE computing the atom. The pinned member row (wave-observability A3-1) stays
  untouched: `capacity` is on the WAVE row, not the member row. A wave whose members' routes
  cannot be recovered (no steering-registered record) renders `capacity: []` — the honest
  object-roster answer — rather than silently covering only interpreter-seam waves.
- **Fold (B1) — the capacity atom is allocator-bound.** Each distinct route's atom in the block is
  derived with the wave-path binding (D1.1): the wave's members on that route resolve their
  `member.vendor` via `_resolveExplicitRoute`; when they all resolve to the SAME vendor, the atom
  reads that vendor's counts; when they resolve differently or any is ambiguous, the atom reads
  all-null counts. The per-member rows and the wave row's existing keys stay byte-unchanged.
- **CLI:** `baton waves list` renders `capacity` per wave row (the existing render at
  `application-cli.mjs:1335-1338` gains the additive block).
- **MCP:** `baton_waves_list` (`mcp-northbound.mjs:541-547`) returns the rows including
  `capacity`; its description gains the teaching sentence (D2.3). No input-schema change.

### D2.3 — the surface doctrine (each surface must teach it, #159)

Every surface that exposes the record teaches three things, in its own doc/description/help
text — the #159 "documented ⇄ parsed ⇄ admitted" invariant applied to the record's SEMANTICS, not
just its shape (`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md` §D1):

1. **The closed field set** — `{route, inFlight, ceiling, deferred, state, inFlightRevision}`;
   `route` identifies the harness/model/effort; `state` is the route's readiness, not a liveness
   probe. **Fold (B3):** `inFlightRevision` is named as the live-count freshness marker.
2. **The staleness label** — the record is a point-in-time snapshot. **Fold (B3):** the label is
   SPLIT: `observedAtEventSeq` labels the ledger-derived parts (`deferred`, `state`, `ceiling`);
   `inFlightRevision` labels the live `inFlight` component. The teaching sentence must not claim a
   reader can order the LIVE count by the event-seq alone — a reader compares revisions for the
   live component.
3. **What `deferred` means** — **Fold (A4):** STRICTLY "tasks whose dispatch was skipped at the
   concurrency ceiling and is still pending" (the #10 `capacity_ceiling` waiting cause) — NOT a
   store queue, NOT a promise of future dispatch, and NOT "currently ceiling-waiting" (the
   forbidden phrasing: a pending-with-receipt task whose ceiling cleared is still `deferred` until
   it claims, even if the allocator's next pass would dispatch it). **Fold (A6):** the sentence
   also names the derivation's cost — a single-pass ledger sweep, O(E + D + R) per read (E = ledger
   events, D = distinct deferred tasks, R = routes), with the `waves.list` path additionally
   bounded by its page bound (≤16 rows, `application.mjs:11769`) and the doctor path bounded by the
   route count — so no orchestrator pays an unadvertised O(routes × events) walk per read.

Concretely: `baton_deployment_doctor`'s description names `seats` + "point-in-time snapshot,
`observedAtEventSeq` (ledger parts) + `inFlightRevision` (live count)"; `baton_waves_list`'s
description names `capacity` + the same staleness sentences; the CLI `--check` verdict teaches the
same in prose. The registry rows (`application-semantics.mjs:1648-1653` for `deployment.doctor`,
`:1622-1632` for `waves.list`) keep their current surface claims — the additions are output-shape,
not new verbs, so the parser and admission tables are UNCHANGED (no new verb to admit; the
#153/#157 coherence is trivially preserved by not adding a verb at all).

### D2.4 — the deployment card

- `card()` (`application-deployment.mjs:1371`) composes `doctorReadiness()`, so the card carries
  `seats` + `observedAtEventSeq` + per-atom `inFlightRevision` automatically once D2.1 lands. No
  separate seam; the contract pins the inheritance in A1's GREEN condition rather than
  re-specifying a card path.

---

## D3 — staleness + contention honesty

- **Point-in-time composition, labeled as such — with the label SPLIT (B3).** The D1 atom is
  composed at read time from four sources (D1 freshness frame). It is never a transaction: a
  dispatch admitted between the `inFlight` count and the render makes the read stale by up to one
  seat. Every seats-bearing response carries `observedAtEventSeq` = `coordination.ledgerHeadSeq()`
  at composition (`coordination-store.mjs:13374-13376`) — replay-consistent (an event seq, never
  wall time), so a reader can (a) correlate the ledger-derived parts with any event replay and (b)
  compare two reads' ledger-derived parts. **Fold (B3):** the LIVE `inFlight` component is NOT
  labeled by the event-seq — a handle status transition can change `inFlight` without appending a
  correlatable ledger event, and the ledger can advance without touching a route's vendor. The
  live component carries the per-atom **`inFlightRevision`** — the resolved vendor's
  incarnation-local handle-revision counter (G12), incremented on every handle insert/remove/status
  transition for that vendor. **Two reads for the same vendor with equal `inFlightRevision` carry
  the same `inFlight`; a changed revision means the live count MAY have moved** (the counter is a
  monotonic marker, not a value delta). The claim "compare two reads and know which is newer" is
  therefore pinned per label: event-seq for the ledger parts, revision for the live part. The
  no-clock control law is honored: the revision counter is a counter, never `Date.now()`.
- **`inFlight` is the coordinator's LIVE count, distinct from the frozen receipt value.** The
  #10 receipt payload carries `inFlight` FROZEN at mint time (`waiting-vocabulary-contract.md:467`;
  `coordinator.mjs:2914`); the D1 atom's `inFlight` is the LIVE count read at composition
  (`coordinator.mjs:3039-3045`). The surfaces never confuse the two: the record's `inFlight` is
  "right now", the receipt's `detail.inFlight` is "at the moment that task was skipped". The
  teaching text (D2.3) states this.
- **`deferred` means EXACTLY the §D5 Arm-1 aggregate (A4).** A task whose dispatch was skipped at
  the concurrency ceiling (durable `task.dispatch_deferred` receipt, `coordination-store.mjs:13190`)
  and that is STILL `pending` at composition time. The count is a live derivation over current
  pending tasks — NOT mint-time data (the receipts are mint-time, the COUNT is now). A task that
  claims (dispatches) or cancels leaves the count. The teaching forbids reading it as "currently
  ceiling-waiting": a task that is still pending-with-receipt but whose ceiling has cleared is
  counted until it claims, exactly as the allocator's next pass would dispatch it — the count is
  "skipped at the ceiling and still pending", never a prediction of the allocator's next action.
  `deferred` is the aggregate sibling of the per-task `projectWaitingOn` `capacity_ceiling` arm
  (`application.mjs:444-460`).
- **Vendor-scoped honesty.** The three counts are VENDOR-scoped: computed for the route's
  B1-resolved adapter name (D1.1). Two routes resolving to the same adapter carry IDENTICAL
  `inFlight`/`ceiling`/`deferred` (and IDENTICAL `inFlightRevision`). The record never fabricates
  per-route independence — a route's "capacity" is its adapter's capacity, projected onto the
  route. The teaching text (D2.3) states this; a reader must not read two rows sharing a vendor as
  independent pools. This is internal consistency ONLY — the ALLOCATOR agreement is B1's pin (A9),
  not this paragraph.
- **Contention is disclosed, not hidden.** A reader racing dispatch sees a snapshot, and the
  snapshot is labeled so the race is visible: `observedAtEventSeq` changes between reads when the
  ledger moves, `inFlightRevision` changes when the live count can move. The record never claims to
  be a quiescent or fenced read; it is the same best-effort observe posture as the existing
  `waves.list` (a registry projection, never a live run inspection —
  `application-semantics.mjs:1622-1624`).

---

## Refusal vocabulary

No new refusal code is introduced. The seats read is an **observe** extension of two existing
observe surfaces, and every refusal below is an existing typed code the surfaces already emit:

| Code | Source | Context |
|---|---|---|
| `application_command_arguments_invalid` | `web-northbound.mjs:414` (gate) | An envelope carrying fields the port's normalizer rejects (no new args are added — the closed record is OUTPUT, so this only guards the existing envelope). |
| `cli_invalid` | `application-cli.mjs:50` | A malformed `baton doctor` / `baton waves list` parse (no new parse branches — the existing ones stay). |
| `wave_not_found` | `application.mjs:11798-11799` | A `waves.list` member whose run WAS registered and then disappeared — the seat-map read refuses the whole row (the wave-observability §D5.2 seam, `wave-observability-contract.md:276-282`), never a silent partial. **Fold (N1):** the §D5.2 anchor is cited explicitly here — contract-146 has no D5 section of its own. |
| `application_run_not_found` | `application.mjs:11794-11799` | The underlying `inspect` refusal a `waves.list` member read can surface. |
| `coordinator_authority_forbidden` | `limits.mjs:141` (the #74 code), `application.mjs:12560-12562` | The waves AUTHORITY boundary. It refuses worker-seat principals on `waves.start`/`waves.run`/`waves.stop` ONLY; `waves.list`/`deployment.doctor` are observe verbs NOT refused (`impl-74-notes.md:18`) — the seats read inherits the observe posture, never the control refusal. |

The observe posture is pinned: a worker-seat principal reading the seats (via `waves.list` or the
doctor) is served the same bounded projection as any principal — the seats are deployment capacity,
not a control surface. No code, no `gracefulPath`, no new byte literal enters `limits.mjs`.

---

## Red-first acceptance pins

RED = fails at HEAD (`e371f704727cbca5fdff86af31ec8b154620a71f`); GREEN = passes after this
rung lands. Each pin asserts behavior, not implementation. Verdicts from the red-team report are
folded; the three new pins (A9–A11) are the red-team's §6 "one new pin per blocker".

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 | **Doctor seats, enumerable.** `baton_deployment_doctor` / `baton doctor` returns a `seats` array (one D1 atom per readiness route, readiness order) AND the response carries `observedAtEventSeq`; the `routes` array is byte-unchanged in shape. GREEN condition: the deployment card inherits `seats` via `card()` composition (D2.4). | **RED** — `doctorReadiness` attaches `occupancy` NON-enumerably (`application-deployment.mjs:1346-1349`), `deferred` is absent, and there is no `seats` array nor `observedAtEventSeq`. |
| A2 | **`deferred` is the §D5 Arm-1 aggregate, single-pass.** With a wave whose tasks were ceiling-skipped (receipts minted at `coordinator.mjs:2904-2916`), the doctor's seats row for that vendor reads `deferred === <count of distinct pending tasks holding a receipt on that vendor>`; after a task claims (dispatches), the count drops by one; a cancelled task also leaves it. The count never reads the mint-time-frozen `inFlight` of the receipts. The derivation is single-pass (A6): one ledger sweep builds the receipt→(vendor, pending-task) map — an O(E+D+R) per response is the pinned ceiling, never O(routes × events). | **RED** — no `deferred` field anywhere; the receipts exist (`coordination-store.mjs:13190`) but no surface aggregates them. |
| A3 | **`waves.list` capacity block, BOTH roster forms.** Each `baton_waves_list` row carries an additive `capacity` block: the distinct routes its members occupy (from the #74 seat-map `route` fields, `application.mjs:11782-11784`), each the D1 atom, deduplicated; the response carries `observedAtEventSeq`. **Fold (A3):** the object-roster path (whose member rows have no `route` field, `:11803-11809`) recovers each member's route via `_runWaveRoute`/the steering-registered record (`:11610-11619`) — an object-roster wave does NOT render `capacity: []` unless its members' routes genuinely cannot be recovered; the pinned member row (wave-observability A3-1) is byte-unchanged. | **RED** — `waveList` rows have no capacity (`application.mjs:11811-11818`); only member→route, and only in the string-roster branch. |
| A4 | **`null` honesty, ONE occupancy source.** A route blocked `route_unavailable` / `route_ambiguous` (`application-deployment.mjs:1094-1102`) reads `{inFlight: null, ceiling: null, deferred: null, inFlightRevision: null}` with `state: 'blocked'` + the typed `code`; a ready route with a running adapter reads NUMERIC counts (`0` is a real zero); a bare host with no coordinator reads `inFlight: null` (unobservable). **Fold (B2):** the doctor's NON-enumerable `occupancy` reads the SAME null for the same route — `routes[i].occupancy.inFlight === seats[i].inFlight` in every response, never a fabricate-0 in one and null in the other. **Fold (A5):** the raw path (no facade) resolves vendors via the coordinator (`this.driver.coordinator`) and reads all-null on a bare host. | **RED** — no seats record; `#occupancyFor` fabricates a NUMBER for an unmatched vendor — `inFlight = _inFlightCount(route.harness)` (`application-deployment.mjs:1393-1394`), the harness-string-named vendor's real live count, `0` only via the no-coordinator branch; the v1 pin's "returns 0" claim was wrong (row §2.2/§6) and is corrected here. |
| A5 | **Replay-consistent freshness label + split live label (B3).** Every seats-bearing read carries `observedAtEventSeq` = `coordination.ledgerHeadSeq()` at composition (`coordination-store.mjs:13374-13376`) — an event seq, never wall time; the projection introduces NO `Date.now()` control (the roster's `new Date().toISOString()` at `application-deployment.mjs:1420` is NOT copied). The live `inFlight` component additionally carries the per-atom `inFlightRevision` — an incarnation-local per-vendor handle-revision counter (G12), never a clock. | **RED** — no seats, no `observedAtEventSeq`, no `inFlightRevision`; the roster's wall-time stamp is the only freshness precedent. |
| A6 | **Vendor-scoped honesty.** Two routes resolving to the same adapter read IDENTICAL `inFlight`/`ceiling`/`deferred`/`inFlightRevision`; the record never claims per-route independence. | **RED** — no seats record; the honesty rule is unwritten and unobservable. |
| A7 | **Surface teaching (#159).** `baton_deployment_doctor`'s description names `seats` + the split point-in-time/`observedAtEventSeq`/`inFlightRevision` staleness; `baton_waves_list`'s description names `capacity` + the same; the CLI doctor help teaches the closed field set, the split staleness label, and what `deferred` means (strictly "skipped-at-the-ceiling-and-still-pending", never "currently ceiling-waiting"). No surface advertises a `seats`/`capacity` VERB it cannot serve (no #157 ghost — no new verb is added at all). **Fold (N2):** neither tool description mentions *seat* capacity (the doctor description's "workspace capacity" is the workspace/disk probe, not seat capacity — the wording is exact). | **RED** — neither tool description teaches seat capacity/staleness (`mcp-northbound.mjs:542, 565`); the CLI help has no such prose. |
| A8 | **Additive landing + the OCCUPANCY-VALUE correction (B2).** The doctor's existing enumerable route rows (the DP5 closed set) and the `waves.list` per-member rows (the closed five-key object-roster render, `wave-observability-contract.md` A3-1) are byte-unchanged in SHAPE — `seats`/`capacity`/`observedAtEventSeq`/`inFlightRevision` are additive SIBLINGS, and the wave-observability + surface-audit suites stay green. **Fold (B2):** the OCCUPANCY VALUE for an unmatched/ambiguous route changes numeric → null in the non-enumerable `occupancy` (and `publicRosterRow`'s enumerable `occupancy`), and that value change IS the intended correction of #146 — not a byte-stability break (enumerability and shape are unchanged; the value is made honest). | **RED** — no additive fields exist yet; the pin's real assertions (the landing is additive, and the occupancy value is corrected at one seam) are unexercised. |
| A9 | **ALLOCATOR BINDING (B1, new pin).** For a wave member dispatched with `vendorRequested: X` on route R, the seats row for R reads the counts of X — via `_resolveExplicitRoute(X, {model, effort, ...})` — or null when the allocator refuses `route_ambiguous`; it NEVER reads a different vendor's counts. The doctor/generic path reads the allocator's own resolution: a provider-scoped route reads the provider card's counts; an `auto` route with exactly ONE eligible candidate reads that candidate's counts, and an `auto` route with 0 or >1 eligible candidates reads all-null (ambiguous by design). `adapterFor(route).vendor` is never the binding. | **RED** — no seats record; the binding rule is unwritten (the contract's only binding would have been the parallel `adapterFor`, `route-liveness.mjs:121-129`). |
| A10 | **SINGLE OCCUPANCY SOURCE (B2, new pin).** `#occupancyFor` is the ONLY occupancy computation; the doctor's non-enumerable `occupancy`, the seats atom's `inFlight`/`ceiling`, and `publicRosterRow`'s enumerable `occupancy` all read the SAME allocator-bound value — for an unmatched/ambiguous route ALL read null, for a matched route ALL read the same numbers. A fixture asserting `routes[i].occupancy.inFlight === seats[i].inFlight` passes for every readiness route (including the unmatched class). | **RED** — `#occupancyFor` fabricates a NUMBER for an unmatched route (`application-deployment.mjs:1393-1394`); the new seats atom would read null (A4) — two disagreeing values in one response. |
| A11 | **LIVE-COMPONENT FRESHNESS (B3, new pin).** Two consecutive doctor reads with the SAME `observedAtEventSeq` but a CHANGED `inFlightRevision` for a route's resolved vendor report a possibly-changed `inFlight` (the revision counter moved on a handle transition); two reads with the SAME `inFlightRevision` for the vendor report the SAME `inFlight`. The revision is an incarnation-local counter (resets with the handle Map at `coordinator.mjs:1166`), never a clock; the D2.3 teaching does not claim the event-seq orders the live count. | **RED** — no `inFlightRevision` exists; the single event-seq label over a non-replay-consistent component is D3's false "which is newer" claim. |

---

## Open questions

- **OQ1 — vendor re-resolution drift (WIDENED per the red-team).** Two drifts live here. (a) The
  LIVE binding: B1 now resolves the seats vendor through the allocator's own semantics, so the
  seats row and the allocator agree at composition — but the allocator re-resolves PER TASK, and a
  later task on the same route can legitimately pick a different `auto` candidate (load moved).
  Judgment: the seats atom is a point-in-time projection of the allocator's resolution AT COMPOSITION
  (D3 labels it); it never promises the next task's vendor. (b) The DEFERRED binding: a deferred
  task's receipt names the vendor at MINT time (`coordinator.mjs:2913`); if the allocator would
  pick a different vendor on a later pass, the `deferred` count follows the receipt's vendor, not
  the would-be current resolution. Judgment: this is the honest derivation (the task IS deferred on
  the receipt's vendor until it claims), and re-resolving every pending task per read would require
  running the allocator per task — new authority. A follow-on could key `deferred` to the task's
  current resolution; named, not shipped. The red-team's verdict ("OQ1 names the wrong drift") is
  folded: the LIVE drift is now answered by B1; the DEFERRED drift remains as named.
- **OQ2 — `waves.list` capacity granularity.** `capacity` repeats per-wave for the same route (a
  wave with three members on one route shows that route once — D2.2 dedups within the wave, but
  the same route appears in every wave that uses it). Judgment: per-wave blocks are the #74
  seat-map completion (member → route → capacity in one read); the deployment-level capacity read
  is the doctor's `seats`. A wave driver reads per-wave; an orchestrator reads per-deployment. The
  alternative (a top-level deduplicated route→capacity index on `waves.list`) is named, not
  changed — it would duplicate the doctor. Fold (A3): OQ2 does not cover the object-roster path —
  that path is now SPECIFIED (D2.2); what remains is the per-wave-repeat judgment only.
- **OQ3 — the `fleet_roster` fourth surface (kept as the named follow-on, QA §5.4).**
  `#rosterProjection()` already computes `occupancy` ENUMERABLY (`application-deployment.mjs:1419-1442`),
  and `fleet_roster` is registered-but-dead (`application-semantics.mjs:1108`; no dispatch — G5).
  Judgment: completing `fleet_roster` (add `deferred`, wire the dispatch) is a SEPARATE
  surface-wiring rung — it needs the full #159 admission chain (parser branch, MCP tool,
  `TOOL_DEFINITIONS`, dispatch branch) for an advanced operation, which this contract deliberately
  does not add (D2). **Fold (red-team OQ3 caveat):** because `publicRosterRow` exposes `occupancy`
  ENUMERABLY (`:1013`), the B2 occupancy-honesty correction must land before/with the OQ3 wiring —
  it does, in this rung (D2.1) — so a future `fleet_roster` never serializes the fabricate-0. A
  follow-on rung may wire it; named, not shipped.

---

## Cross-references

- **`worker-orchestrated-swarm-2026-08-13/impl-74-notes.md`** — the #74 D3 seat-map that just
  landed (`:19`): `start()` mints the member's exact route onto the steering-registered record;
  `_runWaveRoute` recovers it; `waveList` renders it. This contract completes that seat map with
  route→capacity (D2.2), including the object-roster path (A3).
- **`waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md`** §D5 (`:223-240,467,485`) —
  the #10 `capacity_ceiling` receipt semantics: the durable receipt, the pending-with-receipt
  condition, the mint-time-frozen `inFlight`. The D1 `deferred` field is the §D5 Arm-1 aggregate
  (single-pass, A6), taught strictly as "skipped-at-the-ceiling-and-still-pending" (A4).
- **`wave-observability-2026-08-06/wave-observability-contract.md`** §D2 (`:1622-1632` in
  `application-semantics.mjs`) — the `waves.list` registry projection; A3-1 (`:276`) pins the
  object-roster per-member render to the closed five keys — the A8 byte-stability anchor; §D5.2
  (`:276-282`) — the `wave_not_found` seam the refusal table cites explicitly (N1).
- **`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md`** §D1 — the #159
  "documented ⇄ parsed ⇄ admitted" surface doctrine; D2.3 applies it to the record's semantics.
- **`control-surface-audit-2026-08-13/control-surface-audit.md`** §2 #7 — the
  advertised-but-dead (#157) anti-pattern this contract avoids by NOT adding a new verb/tool.
- **`scratchpad-write-2026-08-13/contract-fold.md`** — the model Ring-2 fold form this contract
  mirrors (fold map, folded findings inline, one-option choices with why); D2.4 names the same
  ghost-trap avoidance.
- **`docs/reference/evidence/contract-foundry-2026-08-13/redteam-146.md`** — the adversarial
  report this fold resolves; its numbered blockers B1–B3 and amendments A3–A6 + nits N1/N2 are
  folded per the fold map above.
- **`docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md`** §5 — the wave-b QA's §5.4
  fold instruction set (H1 → A6; D1/D2/D3 + observe posture shipped; OQ3 kept).
- **`docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md`** §#146 — the wave-a QA's
  "sound" verdict, OVERTURNED by the row's three blockers (blind-QA law).
- **`docs/32` waiting vocabulary (§5)** — the waitingOn projection the `capacity_ceiling` arm
  implements at `application.mjs:406-460`.
- **Issue #10** — the `capacity_ceiling` vocabulary origin; **Issue #74** — the seat-map;
  **Issue #132** — the wave-observability registry; **Issue #159** — the surface doctrine;
  **Issue #89** — the FRAME_LIMITS registry (no new limit is declared).

## Campaign-law constraints

- **No clocks.** The freshness labels are `observedAtEventSeq` (an event sequence, never wall time)
  and `inFlightRevision` (an incarnation-local handle-revision COUNTER, never a clock — G12). The
  roster projection's `new Date().toISOString()` (`application-deployment.mjs:1420`) is a data
  stamp, NOT copied into the seats projection. No deadline/expiry/turn-cap enters the new paths.
- **No arbitrary numeric limits.** Every count in the record is a DERIVED count over existing
  machinery (live handles, card config, ledger receipts). No new cap is declared; the `waves.list`
  page bound (≤16 rows, `application.mjs:11769`) is pre-existing, and the A6 cost ceiling is a
  stated complexity bound (O(E + D + R)), not a control limit.
- **No new authority.** The D1 derivation reads only `coordination.events()`, `coordination.task()`,
  `coordination.ledgerHeadSeq()`, `coordinator.list()`, `routeCards()`, the readiness routes, and
  the allocator's OWN `_resolveVendor`/`_resolveExplicitRoute`/`AdaptiveRouter` semantics (G10,
  G11) — all existing read surfaces. The `inFlightRevision` counter is derived from the existing
  handle lifecycle (G12), not a new mechanism.
- **No new verb, no new refusal code.** The surfaces are extended observe outputs; the parser,
  admission, and `limits.mjs` tables are untouched (D2, refusal vocabulary). This preserves the
  #159 documented⇄parsed⇄admitted invariant by construction.
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was re-verified at HEAD (`e371f704727cbca5fdff86af31ec8b154620a71f`) this
  session — the NUL-bearing files (`application.mjs`, `coordination-store.mjs`) by `grep -an` /
  `sed -n` / `Read` only. Sorted-key literals appear in their ACTUAL order; `localeCompare` is
  never used.
- **Deliverable boundary.** The deliverables are
  `docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md` (this folded contract, in
  place) and `docs/reference/evidence/contract-foundry-2026-08-13/fold-146.md` (the fold report),
  plus the shared-publish note above. Work was confined to
  `docs/reference/evidence/contract-foundry-2026-08-13/**`. No source files were modified.

## Fold notes (judgment calls recorded per the brief)

- **B3 choice — counter over dropping the overclaim.** The red-team offered (a) an incarnation-local
  handle-revision counter or (b) dropping claim (a) for the live component. This fold chooses (a):
  the orchestrator's real need is a verifiable "did the live count move" anchor, and a counter is
  cheap, is explicitly not a clock, and is the stronger correction. The counter is PER-VENDOR so an
  equal revision means "this vendor's live count is unchanged" — a global counter would re-create
  the false-positive "everything changed" for routes whose vendor was untouched (the mirror of B3's
  objection). Judgment recorded: per-vendor granularity is the honest reading of the red-team's fix.
- **A4 choice — re-teach, not re-derive.** The red-team offered (a) teach `deferred` strictly as
  "skipped-at-the-ceiling-and-still-pending" or (b) add the current-ceiling condition to the count.
  This fold chooses (a): (b) deviates from the §D5 Arm-1 vocabulary and is a vocabulary escalation
  to record, not a silent change — and the operator's reading error is fixed by the teaching, not
  by a new count. Judgment recorded: the §D5 Arm-1 derivation is law; only the wording changes.
- **A5 choice — name the raw-path resolver, not all-null-by-design.** The red-team offered (a) name
  the raw path's resolver or (b) pin all-null. This fold chooses (a): the raw path already reaches
  the coordinator (`application.mjs:12437`), the allocator resolution is coordinator methods, and
  the v1 claim that "the ordinary surface always has an honest answer holds for capacity too" is
  only true if the raw path can actually resolve a vendor when one exists. All-null stays for the
  bare-host case (no coordinator → unobservable).
- **B1 wave-path member-set rule.** When a wave's members on one route resolve to DIFFERENT
  vendors, the route's capacity atom reads all-null rather than picking one member's vendor. This
  is the A4 honesty rule applied at the block level: the atom is a per-ROUTE atom, and a route whose
  work would spread across vendors has no single seat-truth to report. Judgment recorded: the
  alternative (per-member capacity rows) would re-shape the pinned member row (wave-observability
  A3-1), which the additive posture forbids.
- **QA §5.4 shipped as written, modulo the blockers.** The QA's §5.4 "ship D1/D2/D3 as written"
  was written without the row report; the fold ships those decisions as the SUBSTRATE and the row's
  blockers as the CORRECTIONS. Nothing the QA asked to ship is dropped; nothing the row blocked is
  left standing.
- **The complete disposition record is the incremental fold ledger** — every row finding (R-1…
  R-20, including the B1 provider-aliasing/auto-routing sub-cases, the B2 `publicRosterRow` ripple,
  and the pin-A4 RED-justification correction made THIS session) and every QA §5 instruction
  (Q-1…Q-9) is tagged FOLDED / STRUCK / ESCALATED in `fold-146.md` §0. Nothing in either governing
  document is silently dropped; the two QA verdicts that conflict with the row (Q-2 §5.1, Q-9 §7)
  are STRUCK by the blind-QA law while their non-conflicting amendment (H1) is still folded via A6.
