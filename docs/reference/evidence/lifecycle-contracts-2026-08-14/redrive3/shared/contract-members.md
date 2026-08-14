# CONTRACT-MEMBERS — the member-creation honesty contract (package ③, wave `lifecycle-contracts-2026-08-14-wave-a-rd3`)

[attempt: 0b60dbeb-913e-4a9c-a6ee-3329e8bd75f4 row-lc-members]

Ring-2 contract for the wave member-creation surface (`waves.start` / `runs.start` per member /
the interpreter drive / the resident drain / the adapter seat ceiling). Every ground truth was
re-verified THIS session against HEAD `dc476d87` (`grep -an` / `sed -n` on application.mjs +
coordination-store.mjs — NUL discipline; plain grep elsewhere). No clocks anywhere; the only
timestamps that appear are values the code itself emits or the suite pins. Sorted-key literals are
written in ACTUAL order. This contract gates the package-③ member-creation suite + its impl.

---

## 1. Ground truths (cited at HEAD dc476d87)

### GT1 — #199: member-creation failures emit NO store events. (verified)

A member whose `runs.start` refuses (profile/quota admission, `spill_body_exceeded`, an
`application_*` admission code) never mints a store record. The `coordination-store.mjs` `_append`
kind set has NO `wave.member_*` kind — the creation-emission gap is a missing EMIT, not a missing
validator:

- `task.created` minted in the create+claim batch inside `createTask`
  (`coordination-store.mjs:12514`, `_appendBatch` with the `task.created` kind at `:12575-12576` —
  only after a successful `run.start` resolves a runId);
- `task.claimed` `:12737`, `task.transitioned` `:12749`, `evidence.mapped` `:12805`,
  `driver.recorded` `:13279`, `task.dispatch_deferred` `:13296` (minted nowhere in production per
  the #221 ruling — see GT8), `authority.rejected` `:13304`;
- `grep -a -c "wave.member" impl/src/coordination-store.mjs` → **0**. No `wave.member_start_failed`,
  no `wave.member_seat_queued`, no per-member reservation/refusal record exists anywhere in the
  store layer.

The direct-port failure path is a THROW, not an emit: `startWave` wraps every member `run.start`
refusal in `applicationError('wave member … did not start', 'wave_member_invalid', {… cause …})`
(`application.mjs:11814`, the no-runId variant at `:11824`). The wave handle's in-memory
`entry.startError` catches it (`wave.mjs:235/250/317/331/334`) — a wire/process-lifetime fact, never
a store fact.

### GT2 — #200: member task ids derive from the objectiveRef PATH without the wave namespace. (verified)

`run.start`'s runId digest at `application.mjs:3346`:

```js
const runId = intent.runId ?? `run-${digest({
  objective: intent.objective,
  ...explicitResultIntentIdentity(intent),
  profileDigest: profile.digest,
  route: intent.route,
  composition: intent.composition,
  scope,
  …
```

The wave identity is DELIBERATELY excluded — the comment at `application.mjs:1563`:

> `// Deliberately NOT folded into intentDigest or runId derivation: driverKind describes who is
> driving a run, not what the run is. Two calls with identical objective/profile/route/scope must
> resolve to the SAME run whether or not a wave happens to be the caller. Same rationale for
> waveId/waveRole/waveStart below.`

Consequence: two members in different waves with the same `objective` (the same path — `#200`'s
"same-path re-drives") derive the SAME runId. The second drive binds the FIRST drive's run — live or
dead — through `assertWaveStartReplayable`/`wave_already_terminal` (`application.mjs:11756-11771`)
or by returning the existing run. The waveId itself carries the namespace
(`wave:${digest({idempotencyKey, members}).slice(0,32)}` at `application.mjs:11781`), but the runId
does not.

### GT3 — #200-surface (852700a5): phantoms are now NAMED on the wire, but the store is still silent. (re-verified — this CHANGES the prior contract's GT3)

The prior attempt (salt `9a07d8eb`) grounded "the interpreter's settle receipt reads a bare
'failed' with no cause for a phantom member." **That is FALSE at HEAD.** Commit `852700a5`
(`fix(#200-surface): phantom members are named with their typed start errors`) landed between the
prior verification base (`09200e9`) and HEAD:

- At drive start the interpreter pushes one steering evidence line per phantom —
  `steering.push({ evidence: 'wave_member_start_failed', role: member.role })`
  (`workflow-interpreter.mjs:844`, inside the `for (const member of spec.members)` loop at
  `:842-846`, under the phantom-surfacing comment at `:838-841`);
- The settle leg reads `wave.progress()` ONCE only when phantoms exist
  (`workflow-interpreter.mjs:648-663`, `phantomDetail` built at `:651-661`) and attaches the typed
  start error: `preOutcome.set(member.role, { phase: 'failed', terminal: true, resultSha: null,
  terminalCause: detail?.terminalCause ?? 'start', error: detail?.error ?? null })` at
  `:668-671`; the outcome build then carries `outcome.terminalCause`/`outcome.error` when present
  (`:700-703`);
- The projection that feeds it is `wave.progress()`'s member row
  (`wave.mjs:353`: `{ role, phase: 'failed', terminalCause: 'start', terminal: true, …, error:
  entry.startError, … }`).

So the RECEIPT now names the phantom with its typed cause. What has NOT changed: there is STILL no
durable store record at the creation boundary — no `task.created`, no `steering.registered`, no
`wave.member_*` append for the failed member. The naming is wire/process-lifetime; a driver that
dies before settle, or a caller on the direct `waves.start` port (which throws
`wave_member_invalid` without ever entering the interpreter), still observes nothing durable. GT1
stands: the store layer has no per-member creation record.

### GT4 — #218: adapter seat ceilings gate spawns INSIDE the adapter call; the member lifecycle never enters a typed state. (verified)

- Deployment ceiling override: `application-deployment.mjs:862-875` — `new DeepseekSessionCli({…,
  ceiling: 4, …})` and `new GlmSessionCli({…, ceiling: 4, …})` (operator policies named in the
  comments, "runs WIDE").
- Adapter-card ceilings: `cli-adapters.mjs:618-625` (`GlmSessionCli` default `ceiling: 1`),
  `adapter.mjs:790` (`GlmAdapter.card()` → `concurrencyCeiling: 1`), `adapter.mjs:749-771`
  (`ClaudeAdapter` ceiling 4 region).
- Occupancy read: `#occupancyFor(route)` returns `{ inFlight, concurrencyCeiling }`
  (`application-deployment.mjs:1396-1403`), reading `coordinator._inFlightCount(vendor)` and the
  adapter card.
- **The #221 operator ruling** (`a3e96e88`, 2026-08-14): the seat-ceiling PRE-CAP was ripped out of
  `_dispatchPass`. The coordinator comment at `coordinator.mjs:2919-2923`:
  > `// #221 (operator ruling, 2026-08-14): the seat-ceiling pre-cap is ripped out. It was an
  > invented literal that silently queued spawns ahead of any real provider signal … Backpressure is
  > provider-TRUE now: a real 429/quota answer arrives as a typed, retried, ledgered provider event
  > on the member — never a silent synthetic queue.`

  So the ceiling is no longer enforced by the coordinator pre-dispatch — it is enforced inside the
  adapter call itself (native spawn admission), where the member is already in `working` with no
  typed state.

### GT5 — #218: the residual silent vector is the auto-route all-at-ceiling skip. (verified)

The ceiling still bites routing: `router.pick` filters `eligible = candidates.filter((c) =>
c.inFlight < c.concurrencyCeiling)` and `returns null` when `eligible.length === 0`
(`router.mjs:202-203`). `_resolveVendor` auto-routes to `this._route(task, cards, inFlight)`
(`coordinator.mjs:3004`) → `router.pick` → null. `_dispatchPass` then hits the bare
`continue` at `coordinator.mjs:2918` when `!vendor || !this._adapters[vendor]`. Result: an
auto-route task at full ceiling stays `pending` with NO event minted — `task.dispatch_deferred` is
never written in production (per the #221 ruling: "zero task.dispatch_deferred ever"). This is the
v16 mechanism measured by the seat-telemetry row brief (`docs/reference/evidence/impl-telemetry-2026-08-14/redrive1/row-telemetry-brief.md`):
"19 members silently pending behind the deepseek ceiling while the roster showed nothing"; v16 = 24
reservations / 5 materialized / 19 silent; v17's healthy window = exactly the seat budget.

### GT6 — #218: spawn hops are emitted only into the in-memory worker log, never the store. (verified)

The hop chain exists but is ephemeral — `_log.append` (the coordinator's in-memory per-worker log),
not `coordination-store`:

- `worktree.ready` at `coordinator.mjs:3691` (after `worktreeCreationPending = true` at `:3610`);
- `lifecycle.spawned` at `:3731`;
- `lifecycle.process_ready` (kind set `:60-61`), `lifecycle.crashed` with phase `'spawn'/'worktree'`
  via `_onSpawnRefused` at `:4183-4212` (which sets `terminalCause { kind: 'provider_failure', code
  }`);
- `_coordMapEvent` maps them to `evidence:…` records (`:8553`, 88 call sites) — evidence records,
  not member lifecycle records with a sequence.

None of these carry a per-member monotonic `seq`; none are durable across the resident's lifetime;
none are visible to the waves.run roster or the store.

### GT7 — #204: the resident has NO drain-restart; closing forces process death that kills in-flight waves. (verified)

- `assertCapacityQuiescent` (`index.mjs:1554-1558`) THROWS `driver_capacity_active` when the driver
  still owns worktree-capacity reservations. `close()` calls it (`:1563`), `closeAsync()` calls it
  (`:1578`).
- `drainAndClose` (`index.mjs:1600-1666`) hard-drains the fleet and throws
  `coordinator_drain_incomplete` on any residue (deadline exceeded, owned reservations remaining,
  coordinator close not exact).
- The coordinator's `drain()` (`coordinator.mjs:1724-1727`, `_performDrain` at `:2770`) sets
  `_drainState = 'draining'` (`:1724`), binds one fixed target set (`_drainTargetIds`), and
  converges owned resources; terminal `_closed = true` / `_drainState = 'closed'` (`:1648`).
- There is NO reopen/restart surface: once `_closed`, the driver is terminal. The only way to land a
  new impl is process exit + fresh spawn, which orphans whatever was mid-flight. The application-host
  confirms it: `application_host_shutdown_failed` (`application-host.mjs:81,190`) and
  `serveDeployment` wiring `shutdown: () => deployment.close()` (`impl/scripts/baton.mjs:41-63`).
- The `#204` incident's v12→v13 dance is exactly this: impl landing → resident close → in-flight
  wave killed.

### GT8 — #221 disposition (context for the refusal vocabulary): `task.dispatch_deferred` is dead surface. (verified)

The deferred-dispatch kind (`coordination-store.mjs:13284-13300`) exists but the pre-cap that minted
it is gone. `dispatch_deferred` and `capacity_ceiling` must NOT be resurrected as the seat queue's
transport — the operator ruling named the pre-cap the wedge's true mechanism. The #218 addendum's
`seat_queued` is a DIFFERENT, store-truth fact minted at the moment a spawn actually waits on a
ceiling, with a queue position and the holding member ids.

### GT9 — the interpreter receipt shapes are closed and sorted. (verified)

- Settle receipt: EXACTLY seven keys, sorted — `{ basis, harvest, manifestDigest, outcomes,
  steering, verdict, waveId }` (`workflow-interpreter.mjs:733-741`; D6 comment "the receipt: EXACTLY
  the seven contract keys, in sorted order (F14)").
- Acceptance receipt: `{ accepted, manifestDigest, members, schemaVersion, verdict, waveId }`
  (`:748-755`), frozen.
- The receipt carries NO per-adapter row-count-vs-ceiling serialization summary — #218.3's gap.

### GT10 — the refusal vocabulary's existing anchors are allowlisted, closed, and typed. (verified)

- `wave_member_invalid` / `wave_member_not_found` are in the MCP `stateFailureCode` allowlist
  (`mcp-northbound.mjs:269`, the `if (cause?.code === 'wave_member_invalid' || cause?.code ===
  'wave_not_found') return cause.code;` clause inside the function at `:252`); the allowlist is the
  surface-constant gate. `coordinator_drain_incomplete` is likewise allowlisted (the
  `'coordinator_drain_capacity', 'coordinator_drain_incomplete', …` clause near `:295`).
- `wave.mjs:334` refuses `wave_member_not_found` on `attach` (no run matches the member objective).
- The closed waiting vocabulary `WAITING_ON_KINDS` = `['capacity_ceiling', 'dispatch_pending',
  'plan_approval', 'provider_stalled', 'spawning']` in ACTUAL sorted order
  (`application-semantics.mjs:59-61`). `seat_queued` is NOT in it (and #218.1 says it must be a
  ledgered state, not merely a waiting-on label — see D3/DR1).

---

## 2. Decisions (D-numbered)

### D1 — #199: mint a durable `wave.member_start_failed` store record at the creation boundary.

On ANY member `run.start` refusal inside `startWave`, BEFORE the `wave_member_invalid` throw
propagates, the driver MUST append a `wave.member_start_failed` record carrying
`{ waveId, role, runId: null, cause: { code, message } }` (the inner code preserved from the
refusal — `application.mjs:11814` currently preserves it in the throw payload). This is the store
event GT1 proves is absent today. Rationale: the #200-surface fix names the phantom on the WIRE
(GT3); the remaining #199 gap is that the STORE never learns the member existed. A creation-boundary
record makes the roster's truth and the store's truth agree without waiting for settle.

- Authority: the record is minted by the member-creation surface (`waves.start` /
  `application.mjs startWave`), which owns the refusal. It does NOT collide with the coordinator's
  task lifecycle (`task.created` is only for tasks that exist).
- Composition (addendum item 4): `wave.member_start_failed` and the in-progress `seat_queued` (D3)
  are DISTINCT records — a member may hold both across time (queued → refused); the suite must
  never collapse them (GT1: no such event exists today, so the states cannot currently be
  distinguished at all).

### D2 — #200: namespace the member runId with the wave identity.

Change the runId derivation so a wave member's runId digest folds in the wave namespace — the
`waveId` (`wave:${digest({idempotencyKey, members})…}`, `application.mjs:11781`) or an explicit
`waveNamespace` derived from it — WHILE preserving the deliberate-exclusion rationale at
`application.mjs:1563` for NON-wave callers. Concretely: wave-driven runs gain a namespace term in
the digest; ordinary `runs.start` stays exactly as today. Same-path re-drives under a NEW wave mint
a NEW run; same-path re-drives under the SAME wave (same idempotencyKey) still bind the prior run
(the `wave_already_terminal` replay law is preserved).

- This is the DURABLE fix; the #200-surface fix (GT3) only names phantoms. A re-drive must not bind
  a dead prior run from another wave (GT2's live-or-dead hazard).
- Anti-shallow: the namespacing must not be a cosmetic suffix appended after digest — it must be IN
  the digest so the id is self-verifying and collision-free across waves.

### D3 — #218.1: `seat_queued` is a first-class LEDGERED member state, minted the moment a spawn waits on a ceiling.

A member whose spawn is held by an adapter seat ceiling (GT4/GT5) emits a `wave.member_seat_queued`
store record carrying `{ waveId, role, adapterKey, queuePosition, memberIds }` — the adapter key,
the member's position in the queue, and the ids of all members currently holding seats behind that
ceiling. Emitted immediately when the wait begins; NEVER a silent pend. The state is distinct from
`dispatch_pending`/`capacity_ceiling` (GT8 — those are dead or provider-signal labels, not seat
truth).

- The roster/progress projections must surface it (`waves.list` member rows carry the state), and
  the store must be the source of truth for a member that is seat_queued at any instant.
- Authority-class: whether this is a new store event kind, a new `WAITING_ON_KINDS` entry, or both
  is a representation decision — escalate per DR1.

### D4 — #218.2: spawn-stage transition events at every hop, each carrying a per-member monotonic `seq`.

`reservation → worktree → native-spawn → ready` each mint a durable transition record
(`wave.member_spawn_stage` or distinct kinds) with a per-member `seq` (0,1,2,…) so a stall is a
NAMED state with an order, never a hole. Today the hops exist only in the in-memory worker log
(GT6: `worktree.ready` 3691, `lifecycle.spawned` 3731, `process_ready`, `_onSpawnRefused` 4183-4212).
The durable chain must mirror exactly those four hops plus the terminal refusal (`phase:
'worktree'|'spawn'`), so the launcher can answer "which hop, in what order, did it die at" from the
store.

- Anti-shallow: `seq` must be per-member monotonic and gap-checked (a stall between hops is the
  wedge; a seq gap is itself a finding).
- The in-memory worker log stays as-is (operational), the durable chain is additive.

### D5 — #218.3: waves.run's receipts carry admission-time serialization honesty.

The settle receipt (GT9, seven keys) and the acceptance receipt (GT9) gain a per-adapter
serialization summary at admission: `{ adapterKey, rows, ceiling, serialized: rows > ceiling,
estimatedOrder }` — "4 deepseek rows on 4 seats: serialized, est. order …". The launcher learns the
truth at admission, not after 44 silent minutes (the v16 measurement in GT5).

- The receipt's closed seven-key contract is a fold seam (package-③ launch row owns the receipt
  shape — see DR2 cross-lane note). This decision asserts the CONTENT requirement; the launch row
  owns the exact key placement.

### D6 — #218.4: the phantom-class refusals (#199/#200/#204) compose with `seat_queued` — the states distinguish, never collapse.

A member may be `seat_queued` AND later fail typed (queued behind a ceiling, then refused at native
spawn). The state machine must (a) keep both facts distinct in the store (D1 + D3 records), (b)
project the LATEST as the member's current state while retaining the history, and (c) never let a
`seat_queued` record be overwritten by a `wave_member_start_failed` in a way that erases the queue
fact (the audit trail of "it waited, then it died typed" is the anti-phantom evidence). A member
that is seat_queued and still alive at close must be drained to a named state, not silently dropped
(D7).

### D7 — #204: add a drain-restart surface that does NOT kill in-flight waves.

The resident must expose a drain-restart path distinct from `close`/`closeAsync` (which refuse
`driver_capacity_active`) and from `drainAndClose` (which hard-drains). A `drainForRestart()` (or
equivalent named surface) must:
1. quiesce NEW admissions (the coordinator already gates on `_drainState`, GT7),
2. converge in-flight waves to a named quiescent state WITHOUT process death,
3. reopen the driver (admissions resume) — the impl landing happens between 2 and 3, in the same
   process, so no orphaned wave and no store-split.

Authority-class: whether this lives on the coordinator (a reopen), the deployment (a driver
generation swap), or the application-host (a reload seam) is an authority ambiguity — escalate per
DR3.

---

## 3. Refusal vocabulary (closed, typed, surface-constant)

The vocabulary the impl MAY emit. New codes are typed, payload-keyed, and surface-constant (the MCP
allowlist gate, GT10). The set is CLOSED for package-③ member-creation.

| Code | Emitter | Payload | Status |
|---|---|---|---|
| `wave_member_invalid` | `startWave` on any member run.start refusal (`application.mjs:11814/11824`) | `{ actual?, cap?, cause, role }` | existing, allowlisted, UNCHANGED |
| `wave_member_not_found` | `wave.attach` no-run-match (`wave.mjs:334`) | `{ role }` | existing, allowlisted, UNCHANGED |
| `wave_member_start_failed` | NEW store event (D1) — the creation-boundary record | `{ waveId, role, runId: null, cause: { code, message } }` | NEW kind, typed, surfaced |
| `wave_member_seat_queued` | NEW store event (D3) — first-class ledgered seat state | `{ waveId, role, adapterKey, queuePosition, memberIds }` | NEW kind, typed, surfaced |
| `wave_member_spawn_stage` | NEW store event (D4) — per-hop transition | `{ waveId, role, stage: 'reservation'\|'worktree'\|'native_spawn'\|'ready', seq }` | NEW kind, typed, surfaced |
| `driver_capacity_active` | close/closeAsync on live reservations (`index.mjs:1554-1558`) | — | existing, UNCHANGED |
| `coordinator_drain_incomplete` | drainAndClose residue (`index.mjs:1600-1666`) | `{ code }` | existing, UNCHANGED |
| `application_wave_start_invalid` | no-runId resolve (`application.mjs:11824` cause) | `{ role }` | existing, UNCHANGED |

Dead/forbidden: `task.dispatch_deferred` must NOT be re-minted as the seat queue's transport (GT8 —
the #221 ruling removed its only producer; `capacity_ceiling` stays a waiting-on label for
provider-true signals, NOT a seat queue). Any impl that reintroduces a coordinator-side synthetic
queue violates the ruling.

New kinds MUST be added to the MCP `stateFailureCode` allowlist (`mcp-northbound.mjs:252-303+`)
before they are usable across the northbound surface — the allowlist is the surface-constancy gate
(GT10).

---

## 4. Red-first acceptance pins (each RED at HEAD `dc476d87` at a named stage; each green ONLY for a correct impl)

### A1 — #199 durable creation-boundary event (stage: `startWave` member loop)

- **RED at HEAD**: `grep -a -c "wave.member" impl/src/coordination-store.mjs` → 0; the only phantom
  naming is wire-level (GT3, `workflow-interpreter.mjs:844` + settle outcome) and the direct port
  throws `wave_member_invalid` with no store record (GT1). A store reader observes NOTHING for the
  failed member.
- **GREEN iff**: a member whose run.start refuses produces a `wave.member_start_failed` record
  (D1 fields) in the store, minted BEFORE the throw, and a member that starts successfully produces
  NO such record.
- **Anti-shallow**: an impl that always mints the record (success included) FAILS the green clause
  (false-positive guard); an impl that mints only in the interpreter path but not the direct
  `waves.start` port FAILS (the port is a named stage of the same contract).

### A2 — #200 wave namespace in member runId (stage: `runs.start` runId digest)

- **RED at HEAD**: runId digest excludes waveId/waveRole/waveStart (`application.mjs:3346`; the
  deliberate-exclusion comment at `:1563`). Same-objective members across waves → same runId (GT2).
- **GREEN iff**: two same-objective members under DIFFERENT waveIds mint DIFFERENT runIds, while a
  same-path re-drive under the SAME waveId (same idempotencyKey) still binds the prior run
  (`wave_already_terminal` law preserved).
- **Anti-shallow**: a cosmetic post-digest suffix fails (the namespace must be IN the digest); a
  change that breaks non-wave `runs.start` idempotency fails (the deliberate-exclusion rationale for
  ordinary callers must hold).

### A3 — #204 drain-restart (stage: driver close / drain)

- **RED at HEAD**: `close`/`closeAsync` refuse `driver_capacity_active`
  (`index.mjs:1554-1578`); `drainAndClose` hard-drains to `coordinator_drain_incomplete`
  (`:1600-1666`); the coordinator is terminal after drain (`_closed`, GT7). No reopen/restart
  surface exists.
- **GREEN iff**: a drain-restart surface quiesces admissions, converges in-flight waves to a named
  state WITHOUT process death, reopens, and the same store serves pre- and post-restart reads
  (no store split, no orphaned wave).
- **Anti-shallow**: a surface that just skips `assertCapacityQuiescent` and closes anyway FAILS
  (in-flight reservations dropped = data-loss hazard); a surface that requires an external process
  restart FAILS (that is today's v12→v13 dance).

### A4 — #218.1 `seat_queued` ledgered state (stage: adapter admission / `_dispatch`)

- **RED at HEAD**: no `seat_queued` anywhere — no kind, no `_append`, no roster projection, no
  `WAITING_ON_KINDS` entry (GT5: the 19-silent v16 measurement; GT4: ceilings enforce inside the
  adapter call with no typed state).
- **GREEN iff**: the moment a spawn waits on a ceiling, a `wave.member_seat_queued` record lands
  with `{ adapterKey, queuePosition, memberIds }` (D3), and the roster/progress projections surface
  it; a spawn that never waits emits nothing.
- **Anti-shallow**: resurrecting `task.dispatch_deferred` as the transport FAILS (GT8, the #221
  ruling); a runtime projection with no store record FAILS (the state must be ledgered, per the
  addendum's explicit wording).

### A5 — #218.2 spawn-stage transition events (stage: coordinator dispatch → ready)

- **RED at HEAD**: hops exist only in the in-memory worker log (`coordinator.mjs:3691` worktree.ready,
  `:3731` lifecycle.spawned, `:60-61` process_ready, `:4183-4212` spawn-refused) with no durable
  record and no per-member seq (GT6).
- **GREEN iff**: each hop mints a durable `wave.member_spawn_stage` record with a per-member
  monotonic `seq` (D4), the four hops `reservation → worktree → native_spawn → ready` are exactly
  the named stages, and a stall is a named state at a seq.
- **Anti-shallow**: a single aggregate "spawned" record with no hop breakdown FAILS (a stall between
  hops must be locatable); duplicate seqs or gaps FAIL the monotonic guard.

### A6 — #218.3 admission-time serialization honesty (stage: waves.run admission receipt)

- **RED at HEAD**: the settle receipt is exactly seven closed keys (GT9,
  `workflow-interpreter.mjs:733-741`) and carries NO per-adapter rows-vs-ceiling summary; the
  acceptance receipt (`:748-755`) likewise.
- **GREEN iff**: the receipt (settle AND/OR acceptance per DR2's launch-row seam) names per-adapter
  `{ adapterKey, rows, ceiling, serialized, estimatedOrder }` at admission (D5).
- **Anti-shallow**: a post-hoc settle-time summary FAILS (the addendum says "at admission, not after
  44 silent minutes"); a hardcoded estimate that ignores actual ceilings FAILS (the estimate must be
  derived from `#occupancyFor`, GT4).

### A7 — #218.4 phantom × seat_queued composition (stage: full lifecycle)

- **RED at HEAD**: a member cannot be BOTH seat_queued and later fail typed today — neither fact is
  durable, so the states cannot be distinguished at all (GT1/GT4).
- **GREEN iff**: a member queued behind a ceiling then refused at native spawn holds BOTH a
  `wave.member_seat_queued` (with its queue position) and a `wave.member_start_failed` (with its
  typed cause) in the store; projections show the latest while the queue fact remains in the audit
  trail; a queued-but-still-alive member at drain is converged to a named state (D6/D7).
- **Anti-shallow**: any impl that collapses the queue record into the failure record FAILS (the
  "waited, then died typed" history is the anti-phantom evidence); a member that is seat_queued at
  close and silently dropped FAILS.

---

## 5. Open questions (gated, not blocking this contract)

1. **OQ1 — seat_queued representation** (feeds DR1): store event kind, a `WAITING_ON_KINDS`
   projection entry, or both? A store-only record is invisible to the closed waiting vocabulary
   (`application-semantics.mjs:59-61`); a waiting-on label alone is not ledgered. Both surfaces
   change test fixtures.
2. **OQ2 — serialization honesty seam** (feeds DR2): the receipt shape is the launch row's lane
   (#202). If the launch contract already freezes the seven-key receipt, #218.3 must ride an
   additive key or the acceptance receipt — the exact placement is a cross-row fold decision, not
   this row's alone.
3. **OQ3 — drain-restart ownership** (feeds DR3): coordinator reopen vs. deployment generation
   swap vs. application-host reload. Each has different store/host invariants (the coordinator is
   terminal-after-close at `:1648`; the host's `shutdown` closes the deployment,
   `application-host.mjs:81,190`).
4. **OQ4 — spawn-stage seq lifetime**: per-member seq across the whole member lifetime vs.
   per-generation (a resume/retry after a crash restarts the member's spawn — the seq should reset
   per generation so the four-hop chain is gap-free per attempt).
5. **OQ5 — queue position stability**: is `queuePosition` a point-in-time value (recorded at mint)
   or a live projection? Concurrent arrivals change the position; the contract must fix which is
   durable.

---

## 6. Judgment calls (recorded)

1. **Deliverable path conflict resolved — deliverable path is authoritative.** The dispatch's
   scope constraint names `redrive6/**`, which does not exist on this tree; the deliverable is
   explicitly `redrive3/contract-members.md` and the wavefile's `scope` is `redrive3/**`. Written to
   `redrive3/`; the constraint is a stale template field.
2. **GT3 re-grounded.** The prior contract's "bare 'failed' with no cause" ground truth is FALSE at
   HEAD — `852700a5` landed the phantom naming (GT3). Re-grounded with the wire-vs-store
   distinction preserved: the receipt now names phantoms; the store is still silent. This is the
   single most important correction vs. the prior attempt.
3. **NUL-discipline confirmed.** `grep -an`/`sed -n` required on application.mjs +
   coordination-store.mjs (plain grep silently returns nothing for existing patterns — the
   `_runWaveIndex`/`runIdForWaveMember`/`steering.registered` anchors confirmed this live).
4. **#221 ruling honored.** `dispatch_deferred`/pre-cap semantics are dead; the seat-queue transport
   must be the NEW `seat_queued` record, not a resurrection (GT8, A4 anti-shallow).
5. **Adapter ceiling numbers quoted at HEAD.** deepseek 4 / glm 4 at the deployment override
   (`application-deployment.mjs:862-875`); GlmSessionCli default 1, GlmAdapter 1, ClaudeAdapter 4 —
   ceiling is per-adapter-card, not per-harness.

---

## 7. DECISION_REQUEST entries (authority-class ambiguity)

**DR1 — `seat_queued` representation (D3/OQ1).**
- Option A (recommended): new `wave.member_seat_queued` store kind + a `seat_queued` projection in
  waves.list member rows; NO `WAITING_ON_KINDS` change. The addendum says "first-class LEDGERED
  member state" — the store is the ledger; the waiting-on vocabulary stays for provider-signal
  labels.
- Option B: add `seat_queued` to `WAITING_ON_KINDS` only. Cheaper, but not ledgered and collides
  with `capacity_ceiling`'s meaning.
- Option C: both. Most honest, most fixture churn.
- Recommendation: A — it satisfies "ledgered" without reopening the frozen waiting-on vocabulary.

**DR2 — #218.3 receipt placement (D5/OQ2).**
- Option A (recommended): additive key on the ACCEPTANCE receipt (`application.mjs:748-755` region,
  interpreter's detach path) — admission-time is detach-time, and the acceptance receipt is
  explicitly the pre-settlement shape.
- Option B: extend the seven-key settle receipt. Conflicts with the closed-key law (GT9) and the
  launch row's #202 ownership.
- Option C: a separate `waves.admission` query surfaced beside the receipt. No receipt-shape change
  but a new surface.
- Recommendation: A, pending the launch row's #202 verdict — cross-row fold required (OQ2).

**DR3 — drain-restart ownership (D7/OQ3).**
- Option A (recommended): coordinator-level `drainForRestart()` + `reopen()` on the driver — the
  driver already owns admission gating and the store; the coordinator's terminal-after-close
  (`:1648`) is relaxed to a restartable drain state.
- Option B: deployment-level generation swap — heavier, touches `application-deployment.mjs` and the
  host lifecycle.
- Option C: application-host reload seam — cleanest process boundary but reintroduces a restart
  (today's kill).
- Recommendation: A — it is the only option that keeps in-flight waves alive in the SAME process
  with the SAME store, which is the #204 definition of done.

---

## 8. Publish

Full text published to `redrive3/shared/contract-members.md` (the `shared` publish, inside this
dispatch's `redrive3/**` write scope). No refusal recorded — the publish landed.
