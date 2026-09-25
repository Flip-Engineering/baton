# #146 RED-TEAM REPORT — adversarial attack on the fleet seat telemetry surface contract v1

[attempt: 5471bf44-610b-413d-a476-7a32a465f675 row-rt146]

- **Target:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md` (v1 — issue
  #146, the fleet seat telemetry surface: real-time per-route `{route, inFlight, ceiling,
  deferred, state}` reporting to the orchestrator).
- **Date:** 2026-08-13
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` — the worktree HEAD this report
  was written at, identical to the contract's claimed verification HEAD. Every `file:line` anchor
  below was re-verified against this HEAD with `grep -an` / `sed -n` / `Read` this session.
- **NUL discipline honored:** `application.mjs`, `coordination-store.mjs`, and
  `application-cli.mjs` carry NUL bytes — probed with `sed -n` / `grep -an` only, never whole-file
  reads. `coordinator.mjs`, `application-deployment.mjs`, `route-liveness.mjs`, `router.mjs`,
  `web-northbound.mjs`, `application-semantics.mjs`, `wave.mjs`, `wave-driver.mjs` were read
  directly (NUL-free).
- **Access note:** `gh issue view 146` is not available — `gh` is unauthenticated in this session
  (no `GH_TOKEN`). The issue is read via the row brief (`row-telemetry.md`), the contract, and the
  `foundry-qa` section, which carry its requirements. `foundry-qa.md` was read from the durable file
  (`docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md`); the `shared` scratchpad
  post is ABSENT (see the shared-publish note, §8).
- **Scope:** the single deliverable
  `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-146.md`; no source file was
  modified.
- **Bottom line:** **NOT FOLD-READY.** The foundry-qa verdict ("sound — the remaining risk is a
  derivation cost") is OVERTURNED: three fold-blocking holes on the brief's special axis — the
  seats' route→vendor binding is a *parallel resolution* that can disagree with the allocator (B1),
  the landing leaves TWO disagreeing occupancy computations inside one doctor response (B2), and
  the single replay-consistent freshness label does not label the one component that is not
  replay-consistent (B3). Plus four amendments (A3 object-roster capacity, A4 deferred semantics,
  A5 raw-path vendor resolution, A6 the QA's cost gap). No wrong citation found — the blockers are
  in the contract's *derivation provenance*, not its anchors.

---

## 1. Citation audit (all at HEAD `e371f70`)

Every `file:line` anchor in the contract was re-verified this session. **No wrong citation found —
no automatic blocker.** Verified highlights (each checked against the landed code, not the
contract's prose):

- **G1** `_inFlightCount(vendor)` `coordinator.mjs:3039-3045` (working|stopping|blocked) and the
  dispatch gate `if (this._inFlightCount(vendor) >= card.concurrencyCeiling)` `:2903` — exact. The
  deferral mint `:2904-2916` with idempotency key `task.dispatch_deferred:<taskId>:<taskCreatedSeq>`
  and payload `{taskId, vendor, ceiling, inFlight, taskCreatedSeq}` — exact.
- **G3** `deferTaskDispatch` `coordination-store.mjs:13186-13201` (`inFlight` frozen at
  `:13188-13189`); the no-projection-state replay note `:8039-8042`; `projectWaitingOn`
  `capacity_ceiling` `application.mjs:444-460` — all exact (the per-task projection already scans
  `events(1).find(...)` at `:447`, which A6 below uses as the cost precedent).
- **G4** `#occupancyFor` `application-deployment.mjs:1390-1398` — exact, including the fabricate-0
  fallback at `:1393-1394`; the non-enumerable attach `Object.defineProperty(composed, 'occupancy',
  …)` `:1346-1349`; `doctorReadiness()` `:1329-1369` — exact.
- **G5** `#rosterProjection()` `:1419-1442` (`new Date().toISOString()` at `:1420`), `publicRosterRow`
  `:1005-1016`, `fleet.roster()` `:1320-1322`, `fleet_roster` registered `application-semantics.mjs:1108`,
  NO dispatch branch in `application.mjs` (`grep -an "fleet_roster" application.mjs` empty), NO CLI
  fleet branch (`grep -an "fleet" application-cli.mjs` empty) — all exact.
- **G6/G7** `waveList` `application.mjs:11759-11822` (string-roster route recovery `:11782-11784`;
  wave row keys `:11811-11818`; pageSize 16 `:11769`), `_runWaveRoute` `:11610-11619`,
  `deploymentReadiness` `application-deployment.mjs:1088-1165` (`route_unavailable`/`route_ambiguous`
  `:1094-1102`, `route_not_ready` `:1158-1163`), raw `doctorReadiness` `state:'ready'`
  `application.mjs:12430-12432` — all exact.
- **G8/G10** `mcp-northbound.mjs:559-562` (doctor quota-free fresh, "route-picking prerequisite"),
  `:564-568` tool, `:541-547` `baton_waves_list`, `:1474-1479` quota skip; `application-cli.mjs:1261-1267`
  `baton doctor`, `:1335-1338` `waves list`; dispatch `application.mjs:12569,12574`; the
  `coordinator_authority_forbidden` observe carve-out `application.mjs:12560-12562` and `limits.mjs:141`;
  `coordination.events()` `coordination-store.mjs:8875-8879`, `task()` `:8917`,
  `ledgerHeadSeq()` `:13374-13376`, `coordinator.list()` `:12031-12034`, `routeCards()`
  `:10337-10342` — all exact.
- **G9** waiting-vocabulary §D5 `waiting-vocabulary-contract.md:223-240, 467, 485` — exact (the
  Arm-1 condition, the mint-time-frozen `inFlight`, the "durable RECEIPT … not a refusal" line).
- **Refusal anchors** `web-northbound.mjs:414`, `application-cli.mjs:50`,
  `application.mjs:11794-11799` — exact.

Two citation-hygiene nits (non-blocking, named so they are not repeated):

- **N1 — "(D5.2)" is a dangling cross-ref.** The refusal table cites `(D5.2)` for the
  `wave_not_found` row (`contract-146.md` refusal vocabulary). contract-146 has NO D5 section; the
  seam is the wave-observability contract's D5.2 (`wave-observability-contract.md:276-282`). A
  reader of this contract alone cannot resolve the anchor — cite `wave-observability-contract.md`
  §D5.2 explicitly.
- **N2 — A7's "neither tool description mentions … capacity" is substantively right, textually
  loose.** `baton_deployment_doctor`'s description DOES contain the word "capacity" ("workspace
  capacity") — but that is the workspace/disk probe, not seat capacity. The RED claim (no SEAT
  teaching) holds; the sentence should say "no *seat* capacity".

---

## 2. Attack on D1 — the projection shape (the brief's special-attention axis)

The operator's bar: *"where did these limits come from? is seat telemetry real time and accurate?
A telemetry surface that can disagree with the allocator is worse than none."* Three holes live
here. The good news first: for a vendor, `inFlight` and `ceiling` ARE the allocator's exact values
— `_inFlightCount(vendor)` is the identical method the dispatch gate reads (`coordinator.mjs:2903`),
and `adapter.card().concurrencyCeiling` is the identical field the gate compares against. The
drift is in the *binding* (which vendor a route's seats row shows) and the *freshness label*.

### 2.1 B1 — the route→vendor binding is a parallel resolution, not the allocator's. HOLE (blocker).

**The claim under attack.** D1 pins the atom's three counts to `adapterFor(route).vendor`
(`route-liveness.mjs:121-129`), and D3's vendor-scoped honesty says two routes on the same adapter
read identical counts. The contract presents this as "derived from the seat-holding machinery".

**The attack.** `adapterFor` is a *different resolution function* than the allocator's:

- **`adapterFor`** (`route-liveness.mjs:121-129`) matches `card.harness === route.harness ∧
  turnCompletion === 'pausable' ∧ exact-modelSelection`, unique-or-null. It is a static
  route→adapter match with a pausable gate.
- **The allocator** resolves each task via `_resolveVendor` (`coordinator.mjs:2953-2992`). For
  `vendorRequested: 'auto'` it builds candidates from **every** adapter that
  `cardSupportsSession` + `resolveCardModel` + `resolveEffort` succeed on — a model-keyed set,
  *wider* than `adapterFor`'s harness-keyed set — and then `AdaptiveRouter.pick`
  (`router.mjs:198-206`) chooses by **load and adaptive success history** (`eligible =
  candidates.filter(c => c.inFlight < c.concurrencyCeiling)`, round-robin or decayed-rate+exploration
  argmax). For an explicit `vendorRequested` it uses `_resolveExplicitRoute`
  (`:2995-3034`) — session+model+effort+worker-policy, unique-or-`route_ambiguous`.

Neither allocator path is guaranteed to equal `adapterFor`. Two reachable disagreeing cases:

1. **Provider aliasing.** Route R = `{harness: 'claude-code', model: M, effort: E, provider:
   'anthropic'}`. `adapterFor` prefers the `${harness}:${provider}` card and returns a single
   vendor V. A wave member on R is dispatched with `vendorRequested: member.vendor`
   (`coordinator.mjs:4051` — `vendorRequested: member.vendor, modelRequested: member.model`), and
   `member.vendor` is orchestrator-authored — it can name the generic adapter, a different provider
   card, or a backup adapter. The allocator's `_resolveExplicitRoute(member.vendor)` then runs on
   *that* vendor's capability set. The seats row shows V's `inFlight`/`ceiling`/`deferred`; the
   wave consumes a different vendor's seats.
2. **Load-aware `auto` routing.** A task requesting model M with `vendorRequested: 'auto'` can be
   dispatched to any model-serving adapter the `AdaptiveRouter` picks (round-robin/adaptive), while
   `adapterFor` returns a single (or null) route match. The seats row for the route reads the
   matched vendor's counts; the allocator's in-flight work is spread across the *eligible*
   candidate set. When the matched vendor is at ceiling, the seats say "full" while the allocator
   would still dispatch on a sibling adapter the row never shows — the exact "orchestrator flies
   blind / makes a wrong capacity call" failure the contract exists to prevent.

The contract's OQ1 names a *related* drift (a deferred task's receipt names the vendor at MINT time
and the count follows it) and calls it "the honest derivation". But the seats' `inFlight`/`ceiling`
carry the same class of unproven binding for the LIVE count, and that is not named anywhere — the
open questions never ask "is `adapterFor(route).vendor` the vendor the allocator will dispatch this
route's work to?" D3's vendor-scoped honesty (same-vendor routes agree) is *internal consistency
only*; it says nothing about allocator agreement. **A telemetry surface whose per-route vendor
differs from the allocator's vendor is a parallel guess that can drift — the brief's exact
forbidden shape.**

**Fix.** Bind the atom through the allocator's own resolution. The seats' vendor must be the vendor
`_resolveVendor` would return for a task requesting the route's identity — i.e., derive it from the
coordinator's resolution semantics (a route-scoped `_resolveExplicitRoute(route.harness, {model:
route.model, effort: route.effort, …})` for the wave path, with the `auto` path documented as
*ambiguous by design* → honest-null when the adaptive candidate set has >1 eligible member), OR
expose the allocator's per-route resolved vendor from the dispatch seam. Add an acceptance pin: for
a wave member dispatched with `vendorRequested: X` on route R, the seats row for R reads the
counts of X (or null when the allocator refuses `route_ambiguous`), never a different vendor's.

### 2.2 B2 — two disagreeing occupancy computations inside ONE doctor response. HOLE (blocker).

**The claim under attack.** D2.1 keeps the existing non-enumerable `occupancy` on the doctor's
`routes` rows ("the `occupancy`/`liveness` non-enumerable fields stay non-enumerable so non-reading
consumers and the serialized doctor output are untouched; `application-deployment.mjs:1346-1349`")
and adds `seats` as a new enumerable sibling. A4 asserts the new `seats[i]` reads
`{inFlight: null, ceiling: null, deferred: null}` for a blocked/unmatched route.

**The attack.** The fix never touches `#occupancyFor` (`application-deployment.mjs:1390-1398`).
For an unmatched route it falls back to `vendor = match?.vendor ?? route.harness` and returns
`inFlight: _inFlightCount(route.harness)` — a NUMBER, never `null`: `0` only in the no-coordinator
branch (`:1393-1394`) or when the harness-named vendor has no live handles; otherwise the vendor's
real live count, resolved against the route's HARNESS STRING rather than a matched adapter. (The
contract's own A4 RED justification claims `_inFlightCount(route.harness)` returns `0` — contract
A4 — which is not guaranteed.) The landing keeps this fabrication in place while the new `seats[i]`
reads `null` (A4). So after the landing, **the same doctor response carries both**:

```js
routes[i].occupancy.inFlight === <number>   // non-enumerable, #occupancyFor unchanged — _inFlightCount(route.harness); 0 only via the no-coordinator fallback (:1393-1394)
seats[i].inFlight        === null           // enumerable, the new honest atom (A4)
```

for the SAME route, in the SAME response. A consumer that reads `route.occupancy.inFlight`
(the doctor consumers / roster path the code comment at `:1339-1340` names) gets a NUMBER — `0` at
worst, the harness-named vendor's live count at best; a consumer reading `seats[i]` gets `null`. And `#rosterProjection` consumes the same `#occupancyFor`
(`:1430`) → `publicRosterRow` exposes the fabricate-0 as an **enumerable** `occupancy` field
(`:1013`) — so the moment OQ3's `fleet_roster` wiring lands, the contradiction is on a serialized
surface too. The contract's A8 byte-stability pin asserts the `occupancy` fields "stay
non-enumerable" — enumerability, not VALUE — so it does not catch this. The contract must either
(a) fix `#occupancyFor` to honest-null and PIN the ripple into `fleet_roster`/the roster document,
or (b) derive `seats` from the existing occupancy computation with the honesty correction applied at
one seam. It currently does neither, and leaves exactly the "telemetry that disagrees with the
allocator (and with itself)" the brief forbids.

**Fix.** Make `#occupancyFor` the single occupancy source and change its unmatched-vendor result to
`{inFlight: null, concurrencyCeiling: null}` (the A4 honesty rule), then pin the two consumers — the
doctor's non-enumerable `occupancy` and `publicRosterRow`'s enumerable `occupancy` — to the same
value. State explicitly in A8 that the occupancy VALUE changes (numeric → null) for unmatched routes and
that this is the intended correction, not a byte-stability break.

### 2.3 B3 — `observedAtEventSeq` does not label the `inFlight` component. HOLE (blocker).

**The claim under attack.** D3: "Every seats-bearing response carries `observedAtEventSeq` =
`coordination.ledgerHeadSeq()` at composition … so a reader can (a) compare two reads and know which
is newer, and (b) correlate the record with any event replay."

**The attack.** `ledgerHeadSeq()` is `this._events.length` (`coordination-store.mjs:13375`) — a
**replay-consistent** ledger seq. The atom's `inFlight` is **live handle state** — the contract's
own G1: "It is NOT replay-consistent by itself (a replay reconstructs task statuses, not
`stopping`/`blocked` handle statuses)". A single replay-consistent label over an atom that contains
a non-replay-consistent component cannot do what D3 claims:

- A handle status transition (working→stopping→…, a handle entering/leaving `blocked`) can change
  `inFlight` without appending a ledger event that a reader of route R can correlate — so two reads
  with the SAME `observedAtEventSeq` can carry DIFFERENT `inFlight`, and the reader following (a)
  concludes "nothing changed".
- The ledger can advance (e.g., a deferral receipt on vendor A) without touching vendor B's
  `inFlight` — the reader following (a) concludes "everything is newer".

The label is correct for the ledger-derived parts (`deferred`, `state`, `ceiling`); it is inert for
the one component that changes fastest and matters most to an orchestrator picking a route. The
"real-time" claim the operator is testing has no verifiable anchor for the live count.

**Fix.** Split the freshness labels: keep `observedAtEventSeq` for the ledger-derived parts, and add
an incarnation-local monotonic handle-revision marker (a counter incremented on every handle
status/insert/remove — a counter, not a clock, so the no-clock law holds) for the `inFlight`
component, OR drop claim (a) for the live component and state it is "as-of-now at composition, no
replay anchor". Either way the teaching text (D2.3) must not claim a reader can order reads by a
label that the live count does not move.

### 2.4 A4 — `deferred` can overstate "currently ceiling-waiting". HOLE (amendment).

**The claim under attack.** D1/D3 define `deferred` as the §D5 Arm-1 aggregate: distinct tasks that
are currently `pending` and hold a `task.dispatch_deferred` receipt on this vendor; D2.3 teaches it
as "tasks whose dispatch was skipped at the concurrency ceiling and is still pending" and "NOT a
promise of future dispatch".

**The attack.** The receipt is MINT-TIME evidence (`coordination-store.mjs:13188-13189`); the
aggregate joins receipts with *current* `pending` status but never re-applies the *current* ceiling
condition. The dispatch pass re-drives pending tasks only on events (completion `:3905`, stop
resolution `:9619`, startup `:1461`) — a pending-with-receipt task whose ceiling cleared between a
seat-freeing event and the pass's position in `_taskOrder` (or whose pass simply has not run) is
counted `deferred` even though the allocator's next pass would dispatch it. The operator reads
`{inFlight: 0, ceiling: 4, deferred: 2}` as "2 tasks blocked on capacity" when the route has 4 free
seats and the allocator would dispatch both on the next event. This is the same "telemetry
disagrees with the allocator's next action" class as B1, in the *other* direction.

**Fix.** Either (a) teach `deferred` strictly as "skipped-at-the-ceiling-and-still-pending" and
explicitly forbid the words "currently ceiling-waiting" (D2.3 currently uses both phrasings), or (b)
make the count live by adding the current-ceiling condition (`pending ∧ receipt ∧
_inFlightCount(vendor) >= ceiling`) — which deviates from §D5 Arm-1 and is a vocabulary
escalation to record, not a silent change.

### 2.5 The honesty table and `null` semantics — SOUND (verified).

The null-vs-0 rule (D1 table) is a real correction over `#occupancyFor`'s fabrication
(`application-deployment.mjs:1393-1394`), the `state` never-null rule matches `deploymentReadiness`
(G7, `:1088-1165`), and the vendor-scoped honesty (identical counts for same-vendor routes) is
internally consistent. These survive contact with the code — but see B1 (the binding) and B2 (the
two-source contradiction) that frame them.

---

## 3. Attack on D2 — the surfaces

### 3.1 A3 — D2.2's capacity block is empty for object-roster waves. HOLE (amendment).

**The claim under attack.** D2.2: "`waveList` gains, per wave row, an additive `capacity` block:
the closed set of DISTINCT routes its members occupy (from the #74 seat-map `route` fields,
`:11782-11784`)."

**The attack.** The `route` fields at `application.mjs:11782-11784` exist ONLY in the string-roster
branch (interpreter-seam waves). The object-roster branch (`:11803-11809`) renders the
wave-observability A3-1 pinned five keys `{attentionCount, liveness, phase, progressClass, role}` —
**no route field** (`wave-observability-contract.md:275`; `impl-74-notes.md` D3: "the object-roster
render is UNCHANGED"; the waveList object branch at `:11803-11809`). The `#74 seat-map` fix is
explicitly "scoped to the interpreter seam only". So a wave minted with object members (the
plan-wave path, CLI/web waves) renders an **empty** `capacity` block — D2.2 silently covers only
interpreter-seam waves, and the "one read" promise (who is in my wave, on which routes, with how
many seats left) fails for the other roster form. A shallow impl can return `capacity: []` for every
object-roster wave and pass A3.

**Fix.** Specify the object-roster path: recover each object member's route via `_runWaveRoute` /
the steering-registered record (or the member's `runId` inspect outline) for the capacity
derivation — the `capacity` block is on the WAVE row, so the pinned member row (`A3-1`) stays
untouched — or declare the interpreter-seam-only scope explicitly and pin the empty-capacity render
as the honest object-roster answer.

### 3.2 A5 — the raw application's seats path has no specified vendor resolution. HOLE (note).

**The claim under attack.** D2.1: the raw `doctorReadiness()` (`application.mjs:12429-12452`) "gains
the same `seats` array over its profile routes", and "a bare host with no coordinator reads
`inFlight: null` (unobservable …), never `0`."

**The attack.** The raw app has no `#liveness` (`application-deployment.mjs:1387` — the liveness
instance lives on the deployment facade), so the contract names no vendor-resolution mechanism for
the raw path. The no-coordinator case is pinned, but a raw app WITH a coordinator and WITH adapters
(`this.driver?.coordinator` exists — the raw doctor already reads `_reuseDecisionPolicy` off it at
`:12437`) would render every profile route's seats all-null ("unobservable") even though real
capacity exists — honest but useless, and the contract's claim that "the ordinary surface always has
an honest answer … holds for capacity too" is unverified for that case.

**Fix.** Name the raw path's resolver (route→`coordinator._adapters` vendor, or reuse
`adapterFor`'s matching over the raw driver's adapters) or pin that the raw path is all-null by
design with the teaching that capacity requires the deployment facade.

### 3.3 "No new MCP tool" / additive-landing / teaching decisions — SOUND (verified).

The no-new-tool decision is right: a dedicated `baton_route_seats` tool would need the full #159
admission chain for one observe verb the doctor already serves, and the doctor IS quota-free and
per-call fresh (`mcp-northbound.mjs:1474-1479` skips quota for `baton_deployment_doctor`). The
additive-sibling posture (D2.1/D2.2) is the correct byte-stability mechanism. D2.3's teaching
three-sentence shape is the right #159 application — modulo B3 (the freshness sentence overclaims)
and A4 (the "currently ceiling-waiting" phrase).

---

## 4. Attack on D3 — staleness + contention honesty

- **B3 developed in §2.3** — the single-label-over-two-freshness-classes defect.
- **A6 — the deferred aggregate cost is unbounded and unstated (the foundry-qa's named gap,
  confirmed and deepened).** The D1 aggregate is "scan `coordination.events()` for every
  `task.dispatch_deferred` receipt and join pending task status". `events()` returns the WHOLE
  ledger (`coordination-store.mjs:8875-8879`), and the existing per-task precedent
  `projectWaitingOn` already does `events(1).find(...)` per read (`application.mjs:447`) — so the
  aggregate is the established O(E)-scan pattern scaled to per-route rendering: worst case
  O(routes × events), and the doctor has no page bound (routes = the deployment's configured route
  set). The QA asked the contract to "state the cost/ceiling"; the contract does not, and no
  acceptance pin asserts any bound. **Fix:** pin a single-pass derivation (one sweep over the
  ledger building a receipt→(taskId, vendor) map, then filter by current `pending` per route — O(E)
  once, not per route), state the ceiling in the freshness/teaching text, and note that the
  `waves.list` page bound (≤16, `application.mjs:11769`) keeps the wave path bounded while the
  doctor path is bounded by the route count.
- **Point-in-time labeling discipline (D3 first bullet) — SOUND in spirit**, the "never a
  transaction" and "stale by up to one seat" statements are honest; the defect is only the label's
  reach (B3).

---

## 5. Refusal vocabulary — SOUND (with the N1 cross-ref nit)

Closed and typed; no new code; every code is an existing surface code re-verified at its anchor
(`web-northbound.mjs:414`, `application-cli.mjs:50`, `application.mjs:11794-11799`,
`limits.mjs:141` + `application.mjs:12560-12562`). The observe-posture pin is verified: `waves.list`
and `deployment.doctor` are NOT in the `_refuseCoordinatorAuthority` set (`application.mjs:12560`),
so a worker-seat principal reading the seats is served the same bounded projection. The
`wave_not_found` row's `(D5.2)` cross-ref is the N1 hygiene nit. The vocabulary survives contact.

---

## 6. Acceptance pins — all eight RED verified; three shallow-greenability notes

Every pin's RED claim is verified at HEAD: no `seats`/`capacity`/`observedAtEventSeq` exists;
`#occupancyFor` returns a NUMBER for an unmatched route (`vendor = route.harness`; `0` only via the
no-coordinator branch `application-deployment.mjs:1393-1394`); `fleet_roster` is
registered-but-dead; neither MCP description teaches seat capacity. But the pins are
**shallow-greenable on exactly the accuracy properties the operator's bar targets**:

- **A1/A4/A6 greenable without binding correctness.** A1 passes once a `seats` array exists, even
  if its rows read the wrong vendor's counts (B1) or the fabricate-0 occupancy is left in place
  (B2). A4 pins null on the NEW `seats` row but never pins that the EXISTING non-enumerable
  `occupancy` reads the same (B2 passes A4). A6 pins internal same-vendor consistency only — the
  allocator-agreement assertion (B1's fix) is not pinned anywhere.
- **A3 greenable as empty.** `capacity: []` is a legitimate render for an object-roster wave (A3 /
  H3), so the pin does not force the object-roster path to be specified.
- **A5 greenable with a static stamp.** The pin asserts the label is an event seq and no
  `Date.now()`; it never asserts the label actually TRACKS the live component (B3 passes A5).
- **A2 is the one pin that asserts live derivation** (a claimed task drops the count) — but it does
  not pin the ceiling-cleared case (A4/H4).
- **A7/A8 greenable by docs + additive shape** — right pins for what they assert, blind to B2's
  value-level contradiction.

A wrong impl that adds `seats`/`capacity`/`observedAtEventSeq` with the fabricate-0 occupancy left
in place and the adapterFor binding unchanged would pass all eight pins while shipping the
disagreeing-telemetry failure. The pin suite needs one new pin per blocker: the allocator-binding
pin (B1), the single-occupancy-source pin (B2), and the live-component freshness pin (B3).

---

## 7. Open questions — verdicts

- **OQ1 (vendor re-resolution drift) — SOUND as named, but it names the wrong drift.** The
  judgment (the deferred count follows the receipt's vendor until the task claims) is honest. But
  the seats' LIVE binding drift (B1 — `adapterFor` vs `_resolveVendor`) is un-named anywhere; OQ1
  should be widened to ask it.
- **OQ2 (waves.list capacity granularity) — SOUND, incomplete.** The per-wave repeat judgment is
  right, and the top-level-index alternative would duplicate the doctor. It does not address A3
  (object-roster waves render empty capacity).
- **OQ3 (fleet_roster fourth surface) — SOUND, with a caveat.** Wiring `fleet_roster` is correctly
  a separate #159 admission rung. Caveat: `publicRosterRow` exposes `occupancy` ENUMERABLY
  (`application-deployment.mjs:1013`), so once OQ3 lands, the fabricate-0 (B2) becomes a serialized
  surface contradiction — the fix for B2 must land before or with OQ3, and OQ3 should say so.

---

## 8. Final verdict — NOT FOLD-READY

The `foundry-qa` verdict ("sound — the remaining risk is a derivation cost") is **overturned**. The
derivation cost (A6) is real but is the least of it: three holes sit on the brief's special axis —
a telemetry surface that can disagree with the allocator is worse than none, and this contract's
seats row can disagree in three independent ways.

**Numbered blockers** (what + why + concrete fix):

1. **B1 — the per-route vendor binding is a parallel resolution, not the allocator's.** The atom
   reads `adapterFor(route).vendor` (`route-liveness.mjs:121-129`); the allocator dispatches via
   `_resolveVendor`/`_resolveExplicitRoute`/`AdaptiveRouter` (`coordinator.mjs:2953-3034`,
   `router.mjs:198-206`) — load-aware, model-keyed, provider-aware. These can disagree, so a
   seats row can report the wrong vendor's capacity and an orchestrator's routing call is made on
   the wrong numbers. **Fix:** bind the seats to the allocator's own resolution (route-scoped
   `_resolveVendor` semantics; `auto`-ambiguity → honest-null), and pin a test that a wave member's
   dispatched vendor equals the seats row's vendor for its route.
2. **B2 — one doctor response carries two disagreeing occupancy values.** The unchanged
   `#occupancyFor` returns a NUMBER for an unmatched route — `vendor = route.harness`, `inFlight =
   _inFlightCount(route.harness)`, `0` only via the no-coordinator branch
   (`application-deployment.mjs:1393-1394`) — never `null`, and `publicRosterRow` exposes it
   ENUMERABLY (`:1430` → `:1013`); the new `seats[i]` reads `inFlight: null` (A4). **Fix:** make
   `#occupancyFor` the single occupancy source, change its unmatched result to honest-null, and pin
   the ripple into the doctor's non-enumerable occupancy and `fleet_roster`; A8 must state the value
   change (numeric → null) is the intended correction.
3. **B3 — the freshness label does not label the live component.** `observedAtEventSeq` is a
   replay-consistent ledger seq (`coordination-store.mjs:13375`), but `inFlight` is incarnation-live
   (G1) — D3's "compare two reads and know which is newer" is false for it. **Fix:** add an
   incarnation-local handle-revision counter (not a clock) for `inFlight`'s freshness, or explicitly
   state the live component has no replay anchor and drop the overclaim.

**Amendments to land with the blockers:** A3 (specify the object-roster capacity path),
A4 (redefine or re-teach `deferred` so it cannot read as "currently ceiling-waiting"),
A5 (name the raw-path vendor resolver or pin it all-null by design), A6 (single-pass deferred
derivation + stated cost ceiling), plus N1/N2 citation hygiene.

**What survives.** All ten ground truths and every citation anchor verified against the landed code;
the per-vendor `inFlight`/`ceiling` pair is the allocator's exact gate inputs; the honesty
null-vs-0 rule, the no-new-tool decision, the additive landing posture, the observe-posture pin,
the closed refusal vocabulary, and the no-clock discipline are all sound. When B1–B3 and the
amendments land, the contract is fold-ready.

---

## Shared-publish note (the shared post is ABSENT — verified impossible, with evidence)

The foundry frame requires publishing this report's full text to the `shared` scratchpad partition
(kind `note`, title "#146"). Re-verified this session: no surface verb writes a scratchpad note at
this HEAD — the CLI scratchpad branch admits `read` and `elevate` only and throws
`unexpected argument <sub>` for anything else (`application-cli.mjs:1476-1512`); MCP exposes only
`baton_scratchpad_elevate|settle` / `baton_run_scratchpad_read|elevate`; the registry lists
read/elevate/settle only. The store kernel makes it impossible even with a privileged writer:
`writeScratchpad` (`coordination-store.mjs:14066-14148`) demands `auth.actor === 'worker'` AND
HARD-CODES the write scope to `` `worker:${fields.workerId}` `` — no code path writes a
`shared`-scope entry; shared entries arise only via worker-write-then-elevate, which requires a live
worker session emitting `scratchpad.write` from its own output text (`claude-session.mjs:1146`) —
unreachable from this filesystem worktree. The `run.scratchpad.append` verb is issue #158, whose contract
(`scratchpad-write-2026-08-13/scratchpad-write-contract.md`) is itself a draft, not an
implementation — the same asymmetry the wave-a drafts and `foundry-qa` documented. The durable file
`docs/reference/evidence/review-foundry-2026-08-13-b/redteam-146.md` is therefore the publish
channel (the coordinator brief's explicit fallback: "durable files as fallback — note which"); the
shared post is recorded as ABSENT.
