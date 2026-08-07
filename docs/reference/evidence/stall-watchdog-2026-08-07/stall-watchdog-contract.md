# Issue #67 — The stall watchdog: from structurally inert to evidence-armed — implementation contract

**Status:** v1.0 DRAFT (acceptance pins red-first, ring-2 form)
**Date:** 2026-08-07
**Verification HEAD:** `95da44142b44d760392e9ba52776eaedef950106`
**Brief:** `contract-67-brief.md` (this directory, 47 lines)

**Seed.** The #64 trust-gate steering campaign named the watchdog dead in three independent ways —
"the stall watchdog is not a liveness bound (semantics A7, authority TG1/6b: production stallMs =
wallMin, any-event re-arm, blocked-status escape)" (`docs/reference/evidence/trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md:30-31`),
"Progress evidence must be farm-proof … 128 one-char notes buy the full 8h wall budget today; a
blocking question parks outside the watchdog with `deadlineAt: null`" (`:33-35`). The issue body
itself was unavailable at drafting time (`gh` is not authenticated in this worktree), so the brief's
decisions and the two named red-team receipts carry the requirements; every code anchor below was
re-verified against the current tree at the verification HEAD. The red-team's cited line anchors
drifted between their write-up and HEAD; all anchors below are the current ones.

**Read-order executed.** (1) the issue — unavailable, see above; (2) the receipts
(`trust-gate-steering-2026-08-02/redteam-semantics.md` A7, `redteam-authority.md` TG1/6b); (3) the
machinery (`impl/src/application-deployment.mjs`, `impl/src/coordinator.mjs`,
`impl/src/coordination-store.mjs`); (4) the TG2 distinct-digest precedent and the landed #10
waitingOn vocabulary (`baecb18`). Anchors verified by `grep -an`/`sed -n`; the three NUL-bearing
files (`coordinator.mjs`, `application.mjs`, `coordination-store.mjs`) were read by grep/sed only,
per campaign discipline.

**Cross-references (not re-specified here):** #64 trust-gate steering (TG2 distinct-digest evidence
class + the explicit "#67's sibling" null-deadline default, TG3 the one bounded steering cycle), #10
waitingOn vocabulary, #55 the three-waves incident, #7 the load-flake cluster. Each is cited at the
decision it touches. This contract owns only the watchdog liveness surface.

---

## 1. Ground truths (re-verified at HEAD)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **The stall budget is coextensive with the wall budget.** `DEFAULT_BUDGET = Object.freeze({tokens: 100_000_000, usd: 1_000, wallMin: 480, providerTurns: 2_048})`; `timeoutMs: DEFAULT_BUDGET.wallMin * 60_000`; `approvalTimeoutMs: DEFAULT_BUDGET.wallMin * 60_000`; and `watchdog: { stallMs: DEFAULT_BUDGET.wallMin * 60_000 }` — a stall takes **480 minutes** to declare in production, identical to the whole node wall budget. | `application-deployment.mjs:37-41, 900, 1913, 1920` |
| G2 | **The code default differs from the deployment override** (A7: "one stallTimeoutMs is three numbers"). Code default `this._watchdog = Object.freeze({stallMs: 120000, loopThreshold: 3, scopeAction, orientation, loopAction: 'interrupt', stallAction: 'interrupt'})` (2 min); production override 480 min (G1); the wave driver's own provider-stall clock is `stallTimeoutMs: 20 * 60_000` (20 min). | `coordinator.mjs:1057-1063`; `application-deployment.mjs:1920`; `wave-driver.mjs:39` |
| G3 | **The watchdog arms only on `working`.** `_armWatchdog`: `if (!(this._watchdog.stallMs > 0) \|\| handle.status !== 'working') return;` — a non-`working` handle is silently refused. The timer mints `health.stall_suspected` with `payload: {elapsedMs, action, mechanical: true}` then calls `_applyWatchdogAction(handle, stallAction)`. | `coordinator.mjs:8731-8746` (mint at `:8739-8745`) |
| G4 | **The any-event re-arm.** `_observeWatchdogEvent`: `if (event.actor !== 'worker') return; this._touchWatchdog(handle);` — every worker-actor event re-arms the full stall timer via `_touchWatchdog` (`if (handle.status === 'working') this._armWatchdog(handle)`). The feed is at `:12824`. `lifecycle.turn_started` additionally calls `_resetWatchdogTurn`. | `coordinator.mjs:9144-9146, 8757-8759, 12824` |
| G5 | **The chatty-idler cap.** `MAX_SCRATCHPAD_WORKER_ENTRIES = 128`. A worker can emit 128 one-char scratchpad notes (`scratchpad.write_result`); each rides the any-event re-arm (G4) — the A4/A7 farm. | `coordination-store.mjs:496`; `coordinator.mjs:12445, 2661` |
| G6 | **The blocked-status escape.** A blocking `question.asked` mints a `_pending` record with `deadlineAt: null`, then sets `handle.status = 'blocked'`, `handle.pendingQuestionId`, and `task.status = 'input_required'`. `_armWatchdog` refuses non-`working` (G3), so the parked worker is never stall-watched. `_sweepDeadlines` covers only `approval`/`publication` (deny) and `decision` (expire) — each only when `deadlineAt != null`. Blocking `question` records are **never swept**. | `coordinator.mjs:12614-12635` (`deadlineAt: null` at `:12620`; statuses at `:12631-12635`); `_sweepDeadlines` at `:2909-2930` (deny `:2920-2921`, expire `:2922-2924`), driven by `tick()` at `:1437` |
| G7 | **The decision-expiry release precedent.** `_expireDecision`: on expiry emits `decision.expired`, transitions the task `input_required` → `working` (`coordTransition`), answers the wire cancel best-effort, records `resolution = { disposition: 'expired' }`, sets `handle.status = 'working'`. | `coordinator.mjs:9951-9980` |
| G8 | **The attention inbox is the orchestrator's escalator.** `attentionFollow` is scope-first, cursor-chained; reasons paged by `_attentionPage` (kinds today: `candidacy_review`, `member_terminal`); `_attentionReasons = []`. The facade `attentionWatch` dispatches `run.attention.watch`. | `coordinator.mjs:7015-7060, 7088, 7122-7145, 1197`; `application.mjs:12749-12763, 12296` |
| G9 | **The #10 waitingOn vocabulary is landed.** `WAITING_ON_KINDS = ['capacity_ceiling','dispatch_pending','plan_approval','provider_stalled','spawning']` (frozen, ACTUAL sorted order); `projectWaitingOn` derives `provider_stalled` from the last `health.stall_suspected`; `projectBlockedInteraction` precedes it ("blocked (the interaction owns the member) > spawning > … > provider_stalled > honest null"). A blocked worker's honest state exists today. | `application-semantics.mjs:59-63`; `application.mjs:389-430, 455-458, 372-382` |
| G10 | **The #64 steering-cycle machinery is live.** `_admitPauseRecord` parks the pause and arms ONE bounded steering cycle; `_armSteeringCycle` (window `_progressNudgeWindowMs ?? 300_000`, nudge delivered via the worker's control lane); `_expireSteeringCycle` (expiry → `task.status = 'working'` + full final gate with `steered: {nudgeId, answered: false}`). | `coordinator.mjs:2076-2140, 2163-2200, 2276-2320`; `_progressNudgeWindowMs` default at `:1003` |
| G11 | **TG2's distinct-digest evidence class, with #67's sibling already named.** "receipts dedupe by content digest within the window. One distinct valid receipt answers the cycle; ten identical one-char notes count once"; "a blocking interaction older than its deadline (or a bounded deployment default when `deadlineAt` is null, #67's sibling) does not re-arm." | `trust-gate-steering-decisions.md:78-81` |
| G12 | **The preserve-before-reap precedent.** `_preserveProgressBeforeReap`: unchanged worktree → `worktree.progress_unchanged {state:'no_progress'}`; changed worktree → `worktree.progress_checkpointed` (a pinned sha). `_applyWatchdogAction` maps `kill`/`interrupt` → `_beginStop`. | `coordinator.mjs:8404-8460` (`progress_unchanged` at `:8435-8439`, `progress_checkpointed` at `:8448`); `:8761-8765` |
| G13 | **The wave-driver stall surfaces (cross-ref #55, not re-specified).** K=3 unsteerable; the stall clock and claim-on-stall fan-out; the #55 activity projection `{providerCalls, tokens, contentEvents, lastActivityAt}` moved the wave stall marker on ANY activity — activity ≠ evidence is the #55 lesson. The coordinator watchdog is a separate liveness surface. | `wave-driver.mjs:668-673, 729-762, 39-40`; `application.mjs:7934-7960` |

---

## 2. Decisions

### D1 — Decouple the stall budget from the wall budget

Pin the decoupling the brief demands: a deployment-level stall budget that is **strictly smaller,
separately configured, and honestly disclosed**. The wiring at `application-deployment.mjs:1920`
stops deriving `stallMs` from `DEFAULT_BUDGET.wallMin`:

```js
// contract — application-deployment.mjs (replaces :1920)
// DEFAULT_WATCHDOG is frozen SEPARATELY from DEFAULT_BUDGET: the stall budget is a liveness
// bound on no-progress EVIDENCE, never the wall budget. 20 min matches the wave-driver's
// provider-stall outer backstop (wave-driver.mjs:39) — one coherent stall vocabulary.
const DEFAULT_WATCHDOG = Object.freeze({
  stallMs: 20 * 60_000,                       // strictly < DEFAULT_BUDGET.wallMin * 60_000 (480 min)
  blockingInteractionTimeoutMs: 20 * 60_000,  // the null-deadline default for blocking interactions (D3)
  loopThreshold: 3,
  loopAction: 'interrupt',
  stallAction: 'escalate',                    // was 'interrupt' — D4 rung 1, never a direct stop
});
watchdog: { ...DEFAULT_WATCHDOG }
```

- **Strictly smaller, separately configured.** `DEFAULT_WATCHDOG.stallMs` (20 min) is strictly less
  than `DEFAULT_BUDGET.wallMin * 60_000` (480 min, G1). The two constants are frozen independently;
  nothing in `DEFAULT_BUDGET` feeds the watchdog. `DEFAULT_WATCHDOG` is a new, separately-named
  deployment constant — a future change to the wall budget cannot silently change the stall budget.
- **Honestly disclosed.** The knob measures **no-progress evidence, not speed**. The stall declares
  only "no evidence of progress for the window" (the D2 `basis` field), never "too slow." Every
  bound is measured in evidence units (the closed re-arm set, D2); time is the coarse outer
  backstop only.
- **The wall budget is untouched.** `timeoutMs` (`:900`) and `approvalTimeoutMs` (`:1913`) keep
  `DEFAULT_BUDGET.wallMin * 60_000`. The decoupling is one-directional: the watchdog shrinks, the
  wall budget does not.
- **The code default stays conservative.** `coordinator.mjs:1057`'s `stallMs: 120000` (2 min, G2)
  remains — a coordinator constructed without a deployment override declares stalls fast. The
  production override is now a bounded 20 min instead of 480 min.

### D2 — Progress-evidence re-arming (kill the any-event re-arm)

The any-event re-arm (G4) is killed. `_observeWatchdogEvent` re-arms **only** on a closed,
enumerated set of progress-evidence event kinds; everything else is silence.

```js
// contract — the closed re-arm set (frozen, ACTUAL sorted order — verified: the literal below
// IS its own [...set].sort() result)
const REARM_KINDS = Object.freeze([
  'approval.resolved',
  'control.steer',
  'decision.settled',
  'lifecycle.turn_started',
  'question.answered',
  'verify.reverified',
  'worktree.progress_checkpointed',
]);

// contract — _observeWatchdogEvent (coordinator.mjs:9144-9146 replacement)
_observeWatchdogEvent(handle, event) {
  if (event.actor !== 'worker') return;                 // unchanged
  if (event.kind === 'lifecycle.turn_started') {
    this._resetWatchdogTurn(handle);                    // turn-boundary reset (loop-tracking + fresh re-arm)
    return;
  }
  // the existing logical-observation branches (provider_call / tool_call loop-tracking) still
  // run — but they do NOT re-arm
  if (!REARM_KINDS.includes(event.kind)) return;        // EVERYTHING ELSE IS SILENCE
  this._touchWatchdog(handle);                          // progress evidence re-arms
}
```

- **The set is closed and enumerated by name.** The seven kinds map to the brief's classes and
  TG2's:
  - a changed in-scope digest / landed diff → `worktree.progress_checkpointed` (G12),
  - a verification result → `verify.reverified`,
  - an orchestrator steer → `control.steer`,
  - TG2's resolution-gated interactions → `question.answered` / `approval.resolved` /
    `decision.settled` (earn progress only when resolved — they are minted only on resolution,
    `coordinator.mjs:9774, 9779, 9906`),
  - a turn boundary → `lifecycle.turn_started` (the existing `_resetWatchdogTurn` special-case, G4;
    a completed turn clears the watchdog at `coordinator.mjs:12322`, so the boundary is the turn
    system's own progress unit).
- **The digest gate holds at mint.** `worktree.progress_checkpointed` is minted only when the
  captured sha differs from base (`_preserveProgressBeforeReap`, G12); the unchanged case mints
  `worktree.progress_unchanged {state:'no_progress'}` (`:8435-8439`) — which is explicitly **NOT** a
  re-arm, it is the no-progress receipt. No content floor is needed at the watchdog (TG2): the farm
  bound lives at the final's real-diff demand.
- **A chatty idler buys nothing.** 128 one-char `scratchpad.write_result` notes (G5), heartbeats,
  `resource.provider_call`, `resource.tokens`, `content.tool_call`, status noise — none re-arm
  (SW-03/SW-05). The scratchpad write path and the observation branches still run for their own
  machinery; they simply never touch `_touchWatchdog`.
- **Non-worker events are untouched.** The `event.actor !== 'worker'` early-return stays: policy and
  orchestrator events continue to flow through their own channels (the attention inbox, G8) — the
  watchdog's re-arm is worker-evidence-only.

### D3 — The blocked-status escape (whose stall; the null-deadline default)

Pin whose stall a never-answered blocking question is, then the blocking-interaction default when
`deadlineAt` is null.

- **A never-answered blocking question is a stall of the ORCHESTRATOR, not the worker.** The
  blocking `question.asked` parks the worker (`handle.status = 'blocked'`,
  `task.status = 'input_required'`, G6). The worker is not stalling — it is waiting on the
  orchestrator to answer. With #10 landed, the honest state is `waitingOn: {kind: 'blocked'}` (the
  interaction owns the member, G9). **`_armWatchdog`'s non-`working` refusal (G3) is retained and
  pinned**: a blocked worker is never stall-reaped for the orchestrator's un-answered question
  (SW-07). The D1/D2 watchdog surface applies only to workers in `working`.
- **The blocking-interaction default when `deadlineAt` is null.** The `question` record mints
  `deadlineAt: null` (G6) and is never swept. The contract fills the null with a bounded deployment
  default entering the **existing** `_sweepDeadlines` (G6), the #67's sibling TG2 already names:
  - `DEFAULT_WATCHDOG.blockingInteractionTimeoutMs` (D1, 20 min) is the effective deadline for a
    blocking `question` record whose `deadlineAt` is null:
    `effectiveDeadlineAt = record.deadlineAt ?? record.mintedAt + blockingInteractionTimeoutMs`
    (the record gains `mintedAt: this._now()` at mint — additive, mirroring the decision record's
    `deadlineAt: this._now() + request.deadlineMs` precedent at `coordinator.mjs:12775`).
  - `_sweepDeadlines` gains a `question` branch beside the decision branch (`:2922-2924`): on
    expiry, **escalate, never reap** — mint the attention reason `interaction_expired` into the
    orchestrator's inbox (G8, readable via `run.attention.watch`), release the worker to `working`
    per the `_expireDecision` precedent (G7: `coordTransition` `input_required` → `working`,
    best-effort wire cancel, `resolution = { disposition: 'escalated' }`,
    `handle.status = 'working'`), and receipt it as `question.expired` (the `decision.expired`
    analog).
  - **Escalation is not an answer.** The question is recorded `disposition: 'escalated'`, never
    auto-answered with a fabricated answer; a released worker that still needs the input may re-ask
    (the one-pending admission still holds).

### D4 — The kill ladder (escalate → claim/nudge → reap, receipted)

`_applyWatchdogAction` (G12) currently maps the stall action to an immediate `interrupt`. The
contract replaces the stall action with a three-rung ladder; each rung is receipted; **no silent
kills**.

- **Rung 1 — escalate.** The stall timer fires (D1 window) → `health.stall_suspected` mints with
  `basis: 'no_progress_evidence'` (D2) **and** a run-scoped attention reason `stall_declared` is
  minted into the orchestrator's inbox (G8). The stall action is `'escalate'` — a NEW
  `_applyWatchdogAction` branch that mints the reason and does **not** stop the worker. Receipted:
  `health.stall_suspected` (which also surfaces as `waitingOn: {kind: 'provider_stalled'}` via G9).
- **Rung 2 — claim/nudge.** The orchestrator claims the stall by steering: a `control.steer` /
  `control.nudge` arms a bounded TG3-style steering cycle at the stall seam (reusing
  `_armSteeringCycle`, G10: window `_progressNudgeWindowMs` default 300_000, nudge delivered
  through the worker's control lane). Receipted: `control.steer` / `control.nudge`. If the worker
  emits any D2 re-arm evidence inside the window → the cycle resolves
  `steered: {nudgeId, answered: true}` and the stall clears (the `stall` action flag is removed,
  the watchdog re-arms fresh).
- **Rung 3 — reap.** Only if the claimed steering cycle expired unanswered
  (`_expireSteeringCycle` → `steered: {nudgeId, answered: false}`, G10) **and** the stall persists:
  `_preserveProgressBeforeReap` runs first (G12 — receipts `worktree.progress_unchanged
  {state:'no_progress'}` or pins a checkpoint), then `_applyWatchdogAction` with `kill`/`interrupt`
  → `_beginStop`. Receipted: `worktree.progress_unchanged` / `worktree.progress_checkpointed`, then
  `kill.requested` / `control.interrupt_requested`.

- **An unclaimed stall stays escalated; it never auto-reaps.** If the orchestrator does not claim
  (no steer), the attention reason `stall_declared` persists in the inbox and the worker reads
  `provider_stalled`. A supervisor reap is always possible and receipted; the watchdog itself never
  silently kills.
- **K=3 (cross-ref #64/#55, not re-specified).** The wave-driver's three-waves-unsteerable rule
  (`wave-driver.mjs:668-673`) bounds the driver's own steering; the coordinator's stall seam uses
  one bounded TG3 cycle per stall-declared. This contract adds no new count bound — the ladder is
  the bound.

---

## 3. Refusal / observability vocabulary (closed)

| Code / kind / reason | Reach | Fires when |
|----------------------|-------|------------|
| `health.stall_suspected` (existing) | coordinator ledger → `waitingOn: {kind: 'provider_stalled'}` (G9) | the D1 stall window fires; payload gains `basis: 'no_progress_evidence'` (D2) |
| attention reason `stall_declared` (NEW) | `run.attention.watch` (G8) | D4 rung 1 — stall declared, escalate, no stop |
| attention reason `interaction_expired` (NEW) | `run.attention.watch` (G8) | a blocking interaction's effective deadline passes (D3) |
| `question.expired` (NEW event kind) | coordinator ledger | the blocking-question expiry release (D3; the `decision.expired` analog, G7) |
| `worktree.progress_unchanged` (existing) | coordinator ledger | reap pre-check finds no progress (G12) — NOT a re-arm (D2) |
| `worktree.progress_checkpointed` (existing) | coordinator ledger | reap pre-check pins a changed sha (G12) — a D2 re-arm kind |

No new worker-stream refusal code is introduced, and `stateFailureCode` / the web mapper are
untouched: the watchdog never crosses the MCP/web facade as a thrown error — its escalations ride
the attention inbox and the ledger. The `_armWatchdog` non-`working` refusal (G3) stays silent by
design; the blocked state is observable through `waitingOn` (G9), not a refusal code.

The wire sorted-key literals remain exactly as today: the closed-five `WAITING_ON_KINDS` literal
(G9) and the new `REARM_KINDS` literal (D2) are each written in ACTUAL sorted order.

---

## 4. Acceptance pins (red-first)

RED = fails at HEAD; GREEN = passes at HEAD and is pinned.

| Pin | Assertion | Today |
|-----|-----------|-------|
| SW-01 | **Stall budget decoupled.** `watchdog.stallMs` derives from a separately-frozen constant strictly smaller than `DEFAULT_BUDGET.wallMin * 60_000`; the deployment config discloses it; the wall budget (`timeoutMs`, `approvalTimeoutMs`) is untouched. | **RED** (`stallMs = wallMin * 60_000` = 480 min, `application-deployment.mjs:1920`) |
| SW-02 | **Stall declaration names its basis.** `health.stall_suspected` carries `basis: 'no_progress_evidence'` — the honest claim is "no evidence of progress," never "too slow." | **RED** (payload is `{elapsedMs, action, mechanical}` only, `coordinator.mjs:8742-8744`) |
| SW-03 | **Any-event re-arm killed.** A worker emitting only non-evidence events (scratchpad notes, heartbeats, provider calls, tool calls) never re-arms. | **RED** (`_observeWatchdogEvent` re-arms on every worker-actor event, `coordinator.mjs:9144-9146`) |
| SW-04 | **Closed re-arm set.** Only the seven enumerated kinds re-arm; the set is the frozen ACTUAL-sorted literal; `worktree.progress_unchanged` is NOT a re-arm; everything else is silence. | **RED** (no set — any event re-arms) |
| SW-05 | **Chatty-idler farm closed.** 128 one-char `scratchpad.write_result` notes (the `MAX_SCRATCHPAD_WORKER_ENTRIES` cap, `coordination-store.mjs:496`) buy zero re-arms; the farm bound at the final still demands a real in-scope diff (TG2). | **RED** (each note re-arms) |
| SW-06 | **Blocked worker reads honest waitingOn.** A worker parked on a blocking question reads `waitingOn: {kind: 'blocked'}` (interaction owns the member), `task.status='input_required'`, `handle.status='blocked'`. | **GREEN** (pin) |
| SW-07 | **Blocked worker never stall-killed.** `_armWatchdog`'s non-`working` refusal (G3) is retained; a blocked worker is never reaped for the orchestrator's un-answered question. | **GREEN** (pin) |
| SW-08 | **Null-deadline default + escalation.** A blocking question with `deadlineAt: null` gets a bounded deployment default entering `_sweepDeadlines`; on expiry it escalates (attention reason `interaction_expired` via `run.attention.watch`), releases the worker to `working` per the `_expireDecision` precedent, records `disposition: 'escalated'` — never reaps, never fabricates an answer. | **RED** (null deadline never swept; no attention reason; no release) |
| SW-09 | **Kill ladder: escalate first.** A stall-declared mints `health.stall_suspected` + attention reason `stall_declared`; the stall action is `escalate`, never a direct stop. | **RED** (stall → immediate `interrupt`, `coordinator.mjs:8761-8765`) |
| SW-10 | **Kill ladder: reap last, receipted.** Reap requires the claimed steering cycle to have expired unanswered; `_preserveProgressBeforeReap` runs first (receipts `worktree.progress_unchanged` or pins a checkpoint); the stop is receipted. An unclaimed stall stays escalated, never auto-reaps. | **RED** (no ladder — immediate stop, no preserve, no receipt trail) |

---

## 5. Campaign-law constraints and non-goals

- **No clocks as controls.** The watchdog is a LIVENESS bound, not a workflow gate: it may only ever
  declare "no evidence of progress" (D2 basis), never "too slow." Every bound it pins is measured in
  evidence units (the closed re-arm set, distinct digests); time is the coarse outer backstop only
  (the D1 window, the D3 effective deadline).
- **No new waiting kinds.** `WAITING_ON_KINDS` (five) and `BLOCKING_INTERACTION_KINDS` (three) are
  byte-unchanged (G9). `provider_stalled` continues to ride `health.stall_suspected`.
- **No new refusal codes on the worker stream.** The escalations ride the attention inbox and the
  ledger; `stateFailureCode` and the web mapper are untouched.
- **Sorted-key literals in ACTUAL order.** `REARM_KINDS` (D2) is written in ACTUAL sorted order
  (verified: the seven-kind literal IS its own `.sort()` result); `localeCompare` is banned.
- **NUL-byte discipline.** The three NUL-bearing files were verified by `grep -an`/`sed -n` only.
- **Non-goals.** Auto-answering an expired blocking question (D3 escalates, never fabricates); an
  attention-reason claim/ack surface beyond the ladder (OQ-1); the wave driver's own stall clock
  (cross-ref #55 — the wave marker stays its own surface); re-specifying #64's TG2/TG3, #10's
  vocabulary, #55's projection, #7's load-flake cluster (cross-referenced only).

---

## 6. Open questions

- **OQ-1 — The attention-reason claim surface.** Rung 2 of the ladder reads the orchestrator's
  `control.steer` as the claim. Is a dedicated claim/ack on an attention reason (marking
  `stall_declared` / `interaction_expired` acknowledged) worth adding, or does the steer suffice?
  The wave driver's `claim_turn` precedent (pause records) is a claim surface; the attention inbox
  (G8) currently has none. Decide from lived orchestrator choreography, not speculation.
- **OQ-2 — The unclaimed-stall residual.** A stall that no orchestrator ever claims stays escalated
  (`provider_stalled`) with no auto-reap. Is that the honest terminal, or does a deployment need a
  configurable supervisor-reap escalator? The control law forbids an automatic kill as a
  clock-gated control; a supervisor-armed reap is already possible and receipted.
- **OQ-3 — The `blockingInteractionTimeoutMs` value.** Pinned at 20 min (matching the wave-driver
  provider-stall precedent). The interaction is an ORCHESTRATOR-facing bound; a shorter value
  tightens orchestrator accountability at the cost of more escalations. Worth one lived observation
  before locking.
- **OQ-4 — Does `verify.reverified {accept: false}` re-arm?** This contract treats any
  `verify.reverified` as a verification RESULT (progress evidence). A failed verify is loop-adjacent;
  the loop-detection machinery (`loopThreshold`, `coordinator.mjs:1057`) already bounds repeated
  failures. Keep unconditional, or gate on `accept: true`? Deferred — the digest gate at the final's
  real-diff demand is the farm bound.

---

## 7. Verification

- **HEAD pinned:** `95da44142b44d760392e9ba52776eaedef950106` (current worktree HEAD). Every anchor
  in §1 was re-verified by `grep -an`/`sed -n` on the current tree; the NUL-bearing files were never
  read whole. Sorted-key literals appear only as verified.
- **The four red-team holes are LIVE at HEAD:** (1) production `stallMs = wallMin * 60_000` = 480 min
  (`application-deployment.mjs:1920`); (2) any-event re-arm (`coordinator.mjs:9144-9146`); (3) the
  blocked-status park with `deadlineAt: null` (`coordinator.mjs:12620, 12631-12635`) unswept
  (`:2909-2930`); (4) the immediate stall → `interrupt` stop (`:8761-8765`) with no ladder. The #64
  steering machinery (G10) and the #10 vocabulary (G9) are live and compose with the decisions.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
