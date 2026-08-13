# Issue #146 — fleet seat telemetry surface: contract v1

The implementation contract for issue #146: the fleet's seat truth — per-route `inFlight` /
`ceiling` / `deferred` counts — exists in the machinery and is exposed NOWHERE, so the
orchestrator (and every wave driver) flies blind on capacity until a refusal arrives. This
contract is a **Ring-2 contract** (ground truths → decisions → refusal vocabulary → red-first
acceptance pins → open questions): it **specifies behavior**; it does not amend implementation
in this artifact. It is the row-telemetry row of the contract-foundry campaign
(`docs/reference/evidence/contract-foundry-2026-08-13/foundry-brief.md`).

- **Date:** 2026-08-13
- **Status:** DRAFT — implementation contract v1 (red-first; no code landed for this rung)
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot"), the tree this contract was verified against. Every `file:line` citation below was
  re-verified THIS session with `grep -an` / `sed -n` / `Read` at this HEAD, not inherited.
- **Brief:** `row-telemetry.md` (same dir) and `foundry-brief.md` (same dir) — read fully.
  The issue body (`gh issue view 146`) could not be fetched (`gh` is not authenticated in this
  worktree); the requirements are carried by the row brief, the foundry frame, and the read-order
  below.
- **Read-order executed.** (1) `foundry-brief.md` (the shared frame — Ring-2 form, no clocks,
  publish-to-shared); (2) `row-telemetry.md` (the objective brief — D1/D2/D3 questions); (3) the
  #74 seat-map implementation notes (`worker-orchestrated-swarm-2026-08-13/impl-74-notes.md`) —
  the seat map that just landed; (4) the #10 waiting vocabulary
  (`waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md` §D5) — the `capacity_ceiling`
  receipt semantics; (5) the wave-observability fold
  (`wave-observability-2026-08-06/wave-observability-contract.md` §D2) — the `waves.list` registry
  projection the seat-map rides; (6) the #159 surface doctrine
  (`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md` §D1) — "documented ⇄
  parsed ⇄ admitted, per surface"; (7) the model contract form
  (`scratchpad-write-2026-08-13/contract-fold.md`) — the folded Ring-2 shape this contract
  mirrors; (8) every source anchor below.
- **Scope of the rung, in one sentence:** the deployment doctor (the route-picking prerequisite)
  and the `waves.list` seat-map gain the fleet seat projection — a closed per-route record
  `{route, inFlight, ceiling, deferred, state}` over the EXISTING machinery (the coordinator's
  live in-flight count, the adapter card's concurrency ceiling, the #10 durable deferral
  receipts, and the readiness route state) — labeled as a point-in-time snapshot with a
  replay-consistent `observedAtEventSeq`; the deployment card inherits it via its existing
  `doctorReadiness` composition; no new MCP tool, no new refusal code, no clock control.
- **Shared-publish note (the shared post is absent — VERIFIED impossible, with evidence).**
  The foundry frame requires publishing the final draft to the `shared` scratchpad partition, but
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
  (`control-surface-audit-2026-08-13/control-surface-audit.md` §2 #10). The coordinator's brief
  provides the documented fallback for exactly this case: read the durable files where the shared
  post is absent and note which (`coordinator-brief.md:12`). The durable file below is that
  fallback; the shared post is recorded as ABSENT (this note is the "which").

---

## Ground truths (verified this session)

- **G1 — the per-vendor in-flight count EXISTS, is LIVE, and is the dispatch-gating authority.**
  `coordinator._inFlightCount(vendor)` (`coordinator.mjs:3039-3045`) counts worker handles with
  status `working | stopping | blocked` for the vendor. It is the exact count the ceiling skip
  gates on: `if (this._inFlightCount(vendor) >= card.concurrencyCeiling)` (`coordinator.mjs:2903`).
  It is **live coordinator state** (handle statuses), not a durable store projection — a
  restart reconstructs handles from the durable `task.claimed` records, but `stopping`/`blocked`
  handle statuses are incarnation-live. This is the ONE component of the record that is not
  replay-consistent by itself; the record labels it as such (D3).
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
  #146 closes.
- **G5 — the fleet_roster projection computes the FULL route row including occupancy, but is NOT
  wired to ANY command surface.** `#rosterProjection()` (`application-deployment.mjs:1419-1442`)
  → `publicRosterRow` (`:1005-1016`) produces `{harness, model, effort, provider?, static:{state,
  code?, summary?}, liveness, occupancy:{inFlight, concurrencyCeiling}, learning}`. It is reachable
  ONLY via the facade `deployment.fleet.roster()` (`:1320-1322`). The `fleet_roster` operation is
  registered in the advanced set (`application-semantics.mjs:1108`) but has NO dispatch branch in
  `application.mjs`, NO MCP tool, NO CLI parser branch (`grep -an "fleet" application-cli.mjs`
  returns nothing). It is a registered-but-dead surface — the #157 ghost this contract refuses to
  copy (D2).
- **G6 — `waves.list` has the #74 seat-map (member → route) but NO capacity.** `waveList`
  (`application.mjs:11759-11822`) renders per-wave rows with per-member
  `{role, route, scope, liveness, phase, progressClass, attentionCount}`; the string-roster
  member's `route` is recovered from the steering-registered record via `_runWaveRoute`
  (`application.mjs:11610-11619`, `:11779-11786`) — the #74 D3 seat-map (`impl-74-notes.md:19`).
  The wave row (`:11811-11818`) carries NO inFlight/ceiling/deferred.
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
- **G10 — the derivation needs NO new authority.** `coordination.events()` returns the durable
  ledger (`coordination-store.mjs:8875-8879`); `coordination.task(id)` returns the durable task
  clone (`:8917`); `coordination.ledgerHeadSeq()` returns the replay-consistent head
  (`:13374-13376`); `coordinator.list()` returns the live public handles (`coordinator.mjs:
  12031-12034`); `routeCards()` returns the adapter cards (`:10337-10342`). Every field of the
  record is either an existing read or a derivation over existing reads — no new mechanism.

---

## D1 — the projection shape

The closed per-route record — the ONE atom every surface carries, byte-identical across surfaces:

```js
{
  route:     { harness, model, effort, ...(provider ? { provider } : {}) },  // the readiness route identity
  inFlight:  <safe-integer> | null,   // coordinator._inFlightCount(vendor)  — LIVE
  ceiling:   <safe-integer> | null,   // adapter.card().concurrencyCeiling    — static
  deferred:  <safe-integer> | null,   // capacity_ceiling aggregate           — ledger-derived
  state:     <string>,                // route.state from readiness            — never null
}
```

**Field-by-field derivation (each verified G1–G10):**

- **`route`** — the readiness route identity: `{harness, model, effort}` (`publicRoute`,
  `application-deployment.mjs:267-269`), plus `provider` when the route declares one
  (`route.provider`, `:1089`, `route-liveness.mjs:123`). This is the SAME identity
  `deploymentReadiness` maps routes with and `adapterFor` resolves vendors from.
- **`inFlight`** — `coordinator._inFlightCount(vendor)` where `vendor` is the route's resolved
  adapter name (`adapterFor(route).vendor`, `route-liveness.mjs:121-129`). This is the LIVE count
  that gates dispatch (G1). It is NOT replay-consistent by itself (a replay reconstructs task
  statuses, not `stopping`/`blocked` handle statuses) — the record labels the whole atom as a
  point-in-time composition (D3).
- **`ceiling`** — `adapter.card().concurrencyCeiling` for the resolved vendor (G2). Static.
- **`deferred`** — the §D5 Arm-1 aggregate (G3, G9): the number of DISTINCT tasks that (a) are
  currently `pending` and (b) hold a `task.dispatch_deferred` receipt on this vendor:
  `#{ task : coordination.task(task.id)?.status === 'pending' ∧ ∃ receipt ∈ coordination.events() :
  receipt.kind === 'task.dispatch_deferred' ∧ receipt.payload.taskId === task.id ∧
  receipt.payload.vendor === vendor }`. Derivable from `events()` + `task()` — no new authority
  (G10). A task that later claims (dispatches) or cancels leaves the count.
- **`state`** — the route's static readiness state (G7), always a string, never null. The raw
  application (no facade) reads `'ready'` for every profile route (`application.mjs:12430-12432`);
  the deployment facade reads the computed state.

**The honesty of `null`.** A count is `null` exactly where it is **unobservable** — never a
fabricated zero:

| Field | `null` when | Numeric when |
|---|---|---|
| `inFlight` | the route resolves to NO vendor (`adapterFor` returns null — `route_unavailable` / `route_ambiguous` / `route_not_ready`, `application-deployment.mjs:1094-1102,1158-1163`). The coordinator has no adapter to count for; `0` would claim "definitely zero seats taken" against a route that cannot even run. | the route resolves to a vendor; `0` is a real, observable zero (the coordinator IS running and can count — `_inFlightCount` over an empty handle set). |
| `ceiling` | no vendor resolves (no card to read). | a vendor resolves; the card's declared ceiling (never `0` in practice — `application-deployment.mjs:1395-1396` defaults to `1` when a card lacks the field). |
| `deferred` | no vendor resolves (no dispatch would ever be deferred onto an unavailable vendor). | a vendor resolves; the pending-with-receipt count above (including `0` — an honest "no task is currently ceiling-waiting"). |
| `state` | never. Readiness always computes a state for every route (G7). | always a string. |

**The freshness frame.** The atom is a **point-in-time composition** over four sources:
`inFlight` from the coordinator's live handles (G1), `ceiling` from the static card (G2),
`deferred` from the durable ledger + task status (G3/G10), `state` from the readiness routes (G7).
It is a SNAPSHOT, never a transaction — a dispatch admitted between the `inFlight` count and the
render makes the read stale by up to one seat (D3 pins the label). Every seats-bearing response
carries the replay-consistent composition marker `observedAtEventSeq` =
`coordination.ledgerHeadSeq()` at composition time (`coordination-store.mjs:13374-13376`) — an
**event sequence, never wall time** (the campaign no-clock law; the roster projection's
`new Date().toISOString()` at `application-deployment.mjs:1420` is a data stamp this contract does
NOT copy — event-seq is the freshness frame). Two reads can be correlated by comparing
`observedAtEventSeq`; a reader that needs a deterministic ordering across the ledger composes on
that seq, not on wall time.

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
  (the DP5 closed enumerable set — the `occupancy`/`liveness` non-enumerable fields stay
  non-enumerable so non-reading consumers and the serialized doctor output are untouched;
  `application-deployment.mjs:1346-1349`). `seats` is a NEW enumerable SIBLING, and the response
  carries `observedAtEventSeq` (D3).
- The raw application's `doctorReadiness()` (`application.mjs:12429-12452`) — used when no
  deployment facade overrides — gains the same `seats` array over its profile routes (state
  `'ready'`, `:12430-12432`), so "the ordinary surface always has an honest answer"
  (`:12426-12428`) holds for capacity too. A bare host with no coordinator reads `inFlight:
  null` (unobservable — no coordinator incarnation), never `0`.
- **CLI:** `baton doctor` (`application-cli.mjs:1261-1267`) output gains `seats`; the `--check`
  verdict text teaches the record (D2.3).
- **MCP:** `baton_deployment_doctor` (`mcp-northbound.mjs:564-568`) returns the doctor document
  including `seats`; its description gains the teaching sentence (D2.3). No input-schema change
  (the tool is already argument-free beyond `repo`).

### D2.2 — the `waves.list` seat-map completion

- `waveList` (`application.mjs:11759-11822`) gains, per wave row, an additive **`capacity`**
  block: the closed set of DISTINCT routes its members occupy (from the #74 seat-map `route`
  fields, `:11782-11784`), each as the D1 atom, deduplicated by route key. The per-member rows
  (`:11783-11786`, `:11803-11809`) and the wave row's existing keys (`:11811-11818`) stay
  byte-unchanged — `capacity` is a new enumerable sibling on the wave row, and the response
  carries `observedAtEventSeq`.
- **CLI:** `baton waves list` renders `capacity` per wave row (the existing render at
  `application-cli.mjs:1335-1338` gains the additive block).
- **MCP:** `baton_waves_list` (`mcp-northbound.mjs:541-547`) returns the rows including
  `capacity`; its description gains the teaching sentence (D2.3). No input-schema change.

### D2.3 — the surface doctrine (each surface must teach it, #159)

Every surface that exposes the record teaches three things, in its own doc/description/help
text — the #159 "documented ⇄ parsed ⇄ admitted" invariant applied to the record's SEMANTICS, not
just its shape (`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md` §D1):

1. **The closed field set** — `{route, inFlight, ceiling, deferred, state}`; `route` identifies
   the harness/model/effort; `state` is the route's readiness, not a liveness probe.
2. **The staleness label** — the record is a point-in-time snapshot, `observedAtEventSeq` labels
   the composition moment; the counts change under the reader.
3. **What `deferred` means** — tasks whose dispatch was skipped at the concurrency ceiling and is
   still pending (the #10 `capacity_ceiling` waiting cause), NOT a store queue and NOT a promise
   of future dispatch.

Concretely: `baton_deployment_doctor`'s description names `seats` + "point-in-time snapshot,
`observedAtEventSeq`"; `baton_waves_list`'s description names `capacity` + the same staleness
sentence; the CLI `--check` verdict teaches the same in prose. The registry rows
(`application-semantics.mjs:1648-1653` for `deployment.doctor`, `:1622-1632` for `waves.list`)
keep their current surface claims — the additions are output-shape, not new verbs, so the parser
and admission tables are UNCHANGED (no new verb to admit; the #153/#157 coherence is trivially
preserved by not adding a verb at all).

### D2.4 — the deployment card

- `card()` (`application-deployment.mjs:1371`) composes `doctorReadiness()`, so the card carries
  `seats` + `observedAtEventSeq` automatically once D2.1 lands. No separate seam; the contract
  pins the inheritance in A1's GREEN condition rather than re-specifying a card path.

---

## D3 — staleness + contention honesty

- **Point-in-time composition, labeled as such.** The D1 atom is composed at read time from four
  sources (D1 freshness frame). It is never a transaction: a dispatch admitted between the
  `inFlight` count and the render makes the read stale by up to one seat. Every seats-bearing
  response carries `observedAtEventSeq` = `coordination.ledgerHeadSeq()` at composition
  (`coordination-store.mjs:13374-13376`) — replay-consistent (an event seq, never wall time), so
  a reader can (a) compare two reads and know which is newer, and (b) correlate the record with
  any event replay. The no-clock control law is honored: the freshness label is an event seq,
  never `Date.now()`.
- **`inFlight` is the coordinator's LIVE count, distinct from the frozen receipt value.** The
  #10 receipt payload carries `inFlight` FROZEN at mint time (`waiting-vocabulary-contract.md:467`;
  `coordinator.mjs:2914`); the D1 atom's `inFlight` is the LIVE count read at composition
  (`coordinator.mjs:3039-3045`). The surfaces never confuse the two: the record's `inFlight` is
  "right now", the receipt's `detail.inFlight` is "at the moment that task was skipped". The
  teaching text (D2.3) states this.
- **`deferred` means EXACTLY the §D5 Arm-1 aggregate.** A task whose dispatch was skipped at the
  concurrency ceiling (durable `task.dispatch_deferred` receipt, `coordination-store.mjs:13190`)
  and that is STILL `pending` at composition time. The count is a live derivation over current
  pending tasks — NOT mint-time data (the receipts are mint-time, the COUNT is now). A task that
  claims (dispatches) or cancels leaves the count. `deferred` is the aggregate sibling of the
  per-task `projectWaitingOn` `capacity_ceiling` arm (`application.mjs:444-460`): it answers
  "how many tasks are currently ceiling-waiting on this vendor", not "how many were ever skipped".
- **Vendor-scoped honesty.** The three counts are VENDOR-scoped: computed for the route's resolved
  adapter name (`adapterFor(route).vendor`, `route-liveness.mjs:121-129`). Two routes resolving
  to the same adapter carry IDENTICAL `inFlight`/`ceiling`/`deferred`. The record never fabricates
  per-route independence — a route's "capacity" is its adapter's capacity, projected onto the
  route. The teaching text (D2.3) states this; a reader must not read two rows sharing a vendor as
  independent pools.
- **Contention is disclosed, not hidden.** A reader racing dispatch sees a snapshot, and the
  snapshot is labeled so the race is visible: `observedAtEventSeq` changes between reads when the
  ledger moves. The record never claims to be a quiescent or fenced read; it is the same
  best-effort observe posture as the existing `waves.list` (a registry projection, never a live
  run inspection — `application-semantics.mjs:1622-1624`).

---

## Refusal vocabulary

No new refusal code is introduced. The seats read is an **observe** extension of two existing
observe surfaces, and every refusal below is an existing typed code the surfaces already emit:

| Code | Source | Context |
|---|---|---|
| `application_command_arguments_invalid` | `web-northbound.mjs:414` (gate) | An envelope carrying fields the port's normalizer rejects (no new args are added — the closed record is OUTPUT, so this only guards the existing envelope). |
| `cli_invalid` | `application-cli.mjs:50` | A malformed `baton doctor` / `baton waves list` parse (no new parse branches — the existing ones stay). |
| `wave_not_found` | `application.mjs:11798-11799` | A `waves.list` member whose run WAS registered and then disappeared — the seat-map read refuses the whole row (D5.2), never a silent partial. |
| `application_run_not_found` | `application.mjs:11794-11799` | The underlying `inspect` refusal a `waves.list` member read can surface. |
| `coordinator_authority_forbidden` | `limits.mjs` (the #74 code), `application.mjs:12560-12562` | The waves AUTHORITY boundary. It refuses worker-seat principals on `waves.start`/`waves.run`/`waves.stop` ONLY; `waves.list`/`deployment.doctor` are observe verbs NOT refused (`impl-74-notes.md:18`) — the seats read inherits the observe posture, never the control refusal. |

The observe posture is pinned: a worker-seat principal reading the seats (via `waves.list` or the
doctor) is served the same bounded projection as any principal — the seats are deployment capacity,
not a control surface. No code, no `gracefulPath`, no new byte literal enters `limits.mjs`.

---

## Red-first acceptance pins

RED = fails at HEAD (`e371f704727cbca5fdff86af31ec8b154620a71f`); GREEN = passes after this
rung lands. Each pin asserts behavior, not implementation.

| Pin | Assertion | At HEAD |
|---|---|---|
| A1 | **Doctor seats, enumerable.** `baton_deployment_doctor` / `baton doctor` returns a `seats` array (one D1 atom per readiness route, readiness order) AND the response carries `observedAtEventSeq`; the `routes` array is byte-unchanged. GREEN condition: the deployment card inherits `seats` via `card()` composition (D2.4). | **RED** — `doctorReadiness` attaches `occupancy` NON-enumerably (`application-deployment.mjs:1346-1349`), `deferred` is absent, and there is no `seats` array nor `observedAtEventSeq`. |
| A2 | **`deferred` is the §D5 Arm-1 aggregate.** With a wave whose tasks were ceiling-skipped (receipts minted at `coordinator.mjs:2904-2916`), the doctor's seats row for that vendor reads `deferred === <count of distinct pending tasks holding a receipt on that vendor>`; after a task claims (dispatches), the count drops by one; a cancelled task also leaves it. The count never reads the mint-time-frozen `inFlight` of the receipts. | **RED** — no `deferred` field anywhere; the receipts exist (`coordination-store.mjs:13190`) but no surface aggregates them. |
| A3 | **`waves.list` capacity block.** Each `baton_waves_list` row carries an additive `capacity` block: the distinct routes its members occupy (from the #74 seat-map `route` fields, `application.mjs:11782-11784`), each the D1 atom, deduplicated; the response carries `observedAtEventSeq`. | **RED** — `waveList` rows have no capacity (`application.mjs:11811-11818`); only member→route. |
| A4 | **`null` honesty.** A route blocked `route_unavailable` / `route_ambiguous` (`application-deployment.mjs:1094-1102`) reads `{inFlight: null, ceiling: null, deferred: null}` with `state: 'blocked'` + the typed `code`; a ready route with a running adapter reads NUMERIC counts (`0` is a real zero); a bare host with no coordinator reads `inFlight: null` (unobservable). | **RED** — no seats record; `#occupancyFor` would fabricate `inFlight: 0` for an unmatched vendor (`application-deployment.mjs:1393-1394` — `_inFlightCount(route.harness)` returns `0`). |
| A5 | **Replay-consistent freshness label.** Every seats-bearing read carries `observedAtEventSeq` = `coordination.ledgerHeadSeq()` at composition (`coordination-store.mjs:13374-13376`) — an event seq, never wall time; the projection introduces NO `Date.now()` control (the roster's `new Date().toISOString()` at `application-deployment.mjs:1420` is NOT copied). | **RED** — no seats, no `observedAtEventSeq`; the roster's wall-time stamp is the only freshness precedent. |
| A6 | **Vendor-scoped honesty.** Two routes resolving to the same adapter read IDENTICAL `inFlight`/`ceiling`/`deferred`; the record never claims per-route independence. | **RED** — no seats record; the honesty rule is unwritten and unobservable. |
| A7 | **Surface teaching (#159).** `baton_deployment_doctor`'s description names `seats` + the point-in-time/`observedAtEventSeq` staleness; `baton_waves_list`'s description names `capacity` + the same; the CLI doctor help teaches the closed field set, the staleness label, and what `deferred` means. No surface advertises a `seats`/`capacity` VERB it cannot serve (no #157 ghost — no new verb is added at all). | **RED** — neither tool description mentions seats/capacity/staleness (`mcp-northbound.mjs:542, 565`); the CLI help has no such prose. |
| A8 | **Additive landing preserves byte-stability.** The doctor's existing enumerable route rows (the DP5 closed set — the `occupancy`/`liveness` non-enumerable fields stay non-enumerable) and the `waves.list` per-member rows (the closed five-key object-roster render, `wave-observability-contract.md` A3-1) are byte-unchanged — `seats`/`capacity`/`observedAtEventSeq` are additive SIBLINGS, and the wave-observability + surface-audit suites stay green. | **RED** — no additive fields exist yet; the pin's real assertion (the landing is additive, never a re-shape) is unexercised. |

---

## Open questions

- **OQ1 — vendor re-resolution drift.** A deferred task's receipt names the vendor at MINT time
  (`coordinator.mjs:2913`). If `_resolveVendor` would pick a different vendor on a later pass
  (e.g., a new adapter becomes available, `coordinator.mjs:2953-2992`), the `deferred` count
  follows the receipt's vendor, not the would-be current resolution. Judgment: this is the honest
  derivation (the task IS deferred on the receipt's vendor until it claims), and re-resolving
  every pending task per read would require re-running `_resolveVendor` per task — new authority.
  A follow-on could key `deferred` to the task's current `vendorRequested` resolution; named, not
  shipped.
- **OQ2 — `waves.list` capacity granularity.** `capacity` repeats per-wave for the same route (a
  wave with three members on one route shows that route once — D2.2 dedups within the wave, but
  the same route appears in every wave that uses it). Judgment: per-wave blocks are the #74
  seat-map completion (member → route → capacity in one read); the deployment-level capacity read
  is the doctor's `seats`. A wave driver reads per-wave; an orchestrator reads per-deployment. The
  alternative (a top-level deduplicated route→capacity index on `waves.list`) is named, not
  changed — it would duplicate the doctor.
- **OQ3 — the `fleet_roster` fourth surface.** `#rosterProjection()` already computes
  `occupancy` ENUMERABLY (`application-deployment.mjs:1419-1442`), and `fleet_roster` is
  registered-but-dead (`application-semantics.mjs:1108`; no dispatch — G5). Judgment: completing
  `fleet_roster` (add `deferred`, wire the dispatch) is a SEPARATE surface-wiring rung — it needs
  the full #159 admission chain (parser branch, MCP tool, `TOOL_DEFINITIONS`, dispatch branch)
  for an advanced operation, which this contract deliberately does not add (D2). A follow-on rung
  may wire it; named, not shipped.

---

## Cross-references

- **`worker-orchestrated-swarm-2026-08-13/impl-74-notes.md`** — the #74 D3 seat-map that just
  landed (`:19`): `start()` mints the member's exact route onto the steering-registered record;
  `_runWaveRoute` recovers it; `waveList` renders it. This contract completes that seat map with
  route→capacity (D2.2).
- **`waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md`** §D5 (`:223-240,467,485`) —
  the #10 `capacity_ceiling` receipt semantics: the durable receipt, the pending-with-receipt
  condition, the mint-time-frozen `inFlight`. The D1 `deferred` field is the §D5 Arm-1 aggregate.
- **`wave-observability-2026-08-06/wave-observability-contract.md`** §D2 (`:1622-1632` in
  `application-semantics.mjs`) — the `waves.list` registry projection; A3-1 (`:276`) pins the
  object-roster per-member render to the closed five keys — the A8 byte-stability anchor.
- **`doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md`** §D1 — the #159
  "documented ⇄ parsed ⇄ admitted" surface doctrine; D2.3 applies it to the record's semantics.
- **`control-surface-audit-2026-08-13/control-surface-audit.md`** §2 #7 — the 
  advertised-but-dead (#157) anti-pattern this contract avoids by NOT adding a new verb/tool.
- **`scratchpad-write-2026-08-13/contract-fold.md`** — the model Ring-2 form this contract
  mirrors; D2.4 names the same ghost-trap avoidance.
- **`docs/32` waiting vocabulary (§5)** — the waitingOn projection the `capacity_ceiling` arm
  implements at `application.mjs:406-460`.
- **Issue #10** — the `capacity_ceiling` vocabulary origin; **Issue #74** — the seat-map; 
  **Issue #132** — the wave-observability registry; **Issue #159** — the surface doctrine;
  **Issue #89** — the FRAME_LIMITS registry (no new limit is declared).

## Campaign-law constraints

- **No clocks.** The freshness label is `observedAtEventSeq` — an event sequence, never wall time.
  The roster projection's `new Date().toISOString()` (`application-deployment.mjs:1420`) is a data
  stamp, NOT copied into the seats projection. No deadline/expiry/turn-cap enters the new paths.
- **No arbitrary numeric limits.** Every count in the record is a DERIVED count over existing
  machinery (live handles, card config, ledger receipts). No new cap is declared; the `waves.list`
  page bound (≤16 rows, `application.mjs:11769`) is pre-existing.
- **No new authority.** The D1 derivation reads only `coordination.events()`, `coordination.task()`,
  `coordination.ledgerHeadSeq()`, `coordinator.list()`, `routeCards()`, and the readiness routes —
  all existing read surfaces (G10).
- **No new verb, no new refusal code.** The surfaces are extended observe outputs; the parser,
  admission, and `limits.mjs` tables are untouched (D2, refusal vocabulary). This preserves the
  #159 documented⇄parsed⇄admitted invariant by construction.
- **Ring-2 form.** This contract specifies behavior; it does not amend implementation. Every
  `file:line` citation was re-verified at HEAD (`e371f704727cbca5fdff86af31ec8b154620a71f`) this
  session — the NUL-bearing files (`application.mjs`, `coordination-store.mjs`) by `grep -an` /
  `sed -n` / `Read` only. Sorted-key literals appear in their ACTUAL order; `localeCompare` is
  never used.
- **Deliverable boundary.** The sole deliverable is
  `docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md` (plus the shared-publish
  note above). No source files were modified.
