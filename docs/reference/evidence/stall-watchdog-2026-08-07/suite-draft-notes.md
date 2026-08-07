# #67 Suite Draft Notes — `stall-watchdog-red.test.mjs`

Date: 2026-08-07 · Contract: **stall-watchdog v1.1** (folded) · Suite: 23 rows
Deliverable: `impl/test/stall-watchdog-red.test.mjs` (this draft's only other deliverable).
Authority: `stall-watchdog-contract.md` (v1.1 source of truth), `contract-fold.md` (9 blockers
blk-1..blk-9), `contract-redteam.md` (attack surface), `suite-67-brief.md` (this suite's brief).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/stall-watchdog-red.test.mjs   # run from repo root
ℹ tests 23
ℹ pass 6
ℹ fail 17
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the suite was finalized. Two consecutive runs of the finished suite both produced
**pass 6 · fail 17** (run 1 ≈ 5.5 s, run 2 ≈ 5.1 s) — the split is deterministic. The 6 passes are
exactly the six PIN rows (B4, B5, C3, D3, D4, D5); the 17 failures are the red rows, each confirmed
to fail at its NAMED stage (the per-row stage is in the header and in each row's assertion message).

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY. Stages
in **bold** are the current HEAD failure seam.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | D1 | | **DEFAULT_WATCHDOG-missing** | no `DEFAULT_WATCHDOG` export (application-deployment.mjs:1993-2015); :1920 derives `stallMs` from `DEFAULT_BUDGET.wallMin` (480 min) |
| A2 | D1 | | **stall-exceeds-wall-admission-missing** | `createDriver` passes `watchdog` through unvalidated (index.mjs:1489); only guard is `stallMs > 0` (coordinator.mjs:8733) — `stallMs: 500*60_000` sails through |
| A3 | D1 | | **stall-nonpositive-admission-missing** | `stallMs: 0` constructs (never-armed watchdog sails through) |
| A4 | D1 | | **stall-noninteger-admission-missing** | `stallMs: 1.5` constructs |
| A5 | D1 | | **watchdog-config-disclosure-missing** | facade has zero `stallMs`/`watchdog` references (`grep -rn stallMs impl/src/application.mjs` empty) — disclosure is source-comment-only |
| B1 | D2 | | **rearm-kinds-missing** | coordinator exports no `REARM_KINDS` — the closed set does not exist |
| B2 | D2 | | **chatty-idler-rearms** | each `scratchpad.write` note re-arms (`_observeWatchdogEvent` re-arms on every worker-actor event, coordinator.mjs:9144-9146) |
| B3 | D2 | | **any-event-rearm-killed** | heartbeats/provider-calls/tokens re-arm (same any-event re-arm, :9144-9146) |
| B4 | D2 | PIN | resolution-liveness | green today — `question.answered` (worker actor) re-arms at HEAD and stays live under the contract (it is in the closed set) |
| B5 | D2 | PIN | orchestrator-silence | green today — `control.steer`/`control.nudge` are filtered by the actor gate (:9145), the stall fires; stays live under the contract (not in the set) |
| C1 | D2/blk-5 | | **in-flight-turn-gate-missing** | `handle.turnInFlight` does not exist (`grep turnInFlight coordinator.mjs` empty) |
| C2 | D2/blk-5 | | **in-flight-liveness-missing** | `turn_started` re-arms, then silence → the stall fires at `stallMs`; no in-flight gate re-arms without declaring |
| C3 | D2/blk-5 | PIN | slow-but-productive | green today — provider activity re-arms; stays live under the contract (the in-flight gate holds a mid-turn worker) |
| D1 | D3 | | **null-deadline-sweep-missing** | the `question` record mints `deadlineAt: null` (coordinator.mjs:12620) and `_sweepDeadlines` has no question branch (:2913-2931) — the worker stays blocked forever |
| D2 | D3 | | **interaction-ack-extension-missing** | no `claimInteraction` surface exists; no ack/claim concept on the pending interaction |
| D3 | D3 | PIN | blocked-honest | green today — the landed #10 vocabulary (`projectBlockedInteraction` application.mjs:372-388, `waitingOn` null :408) |
| D4 | D3 | PIN | blocked-never-killed | green today — `_armWatchdog` refuses non-`working` (coordinator.mjs:8731-8733) |
| D5 | D3 | PIN | escalation-not-a-close | green today — `respond` resolves a pending record (:9540-9547); nothing closes it at HEAD |
| E1 | D4 | | **stall-basis-missing** | `health.stall_suspected` payload is `{elapsedMs, action, mechanical}` only (:8739-8745) |
| E2 | D4 | | **stall-declared-reason-missing** | `_applyWatchdogAction` maps `'escalate'` to a NO-OP (:8761-8765); no `stall_declared` attention reason; the G8 inbox is empty |
| E3 | D4 | | **stall-seam-cycle-missing** | `_armStallCycle` does not exist; `_armSteeringCycle` is pause-scoped (:2165-2200, `_expireSteeringCycle` no-ops off `paused`, :2290) |
| E4 | D4 | | **stall-seam-answer-set-missing** | no cycle; `_steeringEvidenceQualifies` answers on TG2 evidence (scratchpad/capability digests, :2208-2238) — the claim-then-idle loophole |
| E5 | D4 | | **stall-lifetime-dedup-missing** | `handle.stallSeamDigestSet` does not exist (the per-cycle `steering.digestSet` is the only dedup, :2192) |

## Invented surfaces

Two invented modules are namespace-imported (`application-deployment.mjs`, `coordinator.mjs`); the
rest are probed through REAL surface entry points. Every invented member is absent at HEAD (the seam
the red row holds). The first assertion on every invented export is an `assert.ok(...)`, so the row
fails at the named stage — never on a shape assertion that `Object.isFrozen(undefined) === true`
could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `DEFAULT_WATCHDOG` (application-deployment.mjs) — separately-frozen `{stallMs: 20*60_000, blockingInteractionTimeoutMs: 20*60_000, loopThreshold: 3, loopAction: 'interrupt', stallAction: 'escalate'}` | namespace import `* as deploymentNs` | no such export (A1) |
| `REARM_KINDS` (coordinator.mjs) — frozen ACTUAL-sorted `['approval.resolved','decision.settled','lifecycle.turn_started','question.answered']` | namespace import `* as coordinatorNs` | no such export (B1) |
| `createDriver` watchdog admission — `stallMs` positive integer strictly < the wall `timeoutMs`, else typed `watchdog_stall_exceeds_wall` | real `createDriver` (`admissionRefusal`) | constructs for any `stallMs` (A2/A3/A4) |
| RunView `status().watchdog` — `{stallMs, basis: 'no_progress_evidence', rearmKinds: [ACTUAL-sorted]}` byte-stable | `BatonApplication.status` | absent from the view (A5) |
| `handle.turnInFlight` — per-handle liveness marker | `Coordinator._workers.get(handle.id)` after `lifecycle.turn_started` | undefined (C1) |
| `coordinator._armStallCycle(handle, task, {nudgeId, controlId})` — the stall-seam seam | the coordinator instance (E3/E4) | undefined (E3/E4) |
| `handle.stallSeamDigestSet` — per-stall-LIFETIME digest Set | `Coordinator._workers.get(handle.id)` | undefined (E5) |
| `coordinator.claimInteraction(requestId, {actor})` — the claim/ack surface | the coordinator instance | undefined (D2) |
| `_sweepDeadlines` question branch — `effectiveDeadlineAt = deadlineAt ?? mintedAt + blockingInteractionTimeoutMs`; expiry escalates (releases to working, receipts `question.expired {disposition:'escalated'}`, never closes) | mutable clock + `coordinator.tick()` | the worker stays blocked forever (D1) |

The mutable-clock rows (D1, D2, D5) drive the sweep through the coordinator's injected `now()` test
double and the public `tick()` — the real sweep seam, no fake timers.

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **B4** resolution-liveness | an impl that drops the resolution kinds from `REARM_KINDS` (a worker resolving its own blocking interaction would stall) |
| **B5** orchestrator-silence | an impl that re-adds `control.steer`/`control.nudge` to `REARM_KINDS` (the create-and-answer self-dealing loop) |
| **C3** slow-but-productive | an impl that removes the in-flight-turn liveness gate (the #55 regression / the 25-minute-compile-reap class) |
| **D3** blocked-honest | an impl that re-invents a 6th waiting kind or moves the honest state off `blockedInteraction` (blk-3) |
| **D4** blocked-never-killed | an impl that drops `_armWatchdog`'s non-`working` refusal (G3) — a blocked worker reaped for the orchestrator's un-answered question |
| **D5** escalation-not-a-close | an impl that closes the escalated record like `_expireDecision` (a late operator answer rejected `already_resolved`) |

## What makes each stage go green (implementer's checklist)

- **DEFAULT_WATCHDOG-missing** → D1: `application-deployment.mjs` lands the separately-frozen
  `DEFAULT_WATCHDOG` (`stallMs: 20*60_000`, `blockingInteractionTimeoutMs: 20*60_000`,
  `loopThreshold: 3`, `loopAction: 'interrupt'`, `stallAction: 'escalate'`); the :1920 override
  becomes `watchdog: { ...DEFAULT_WATCHDOG }`; nothing in `DEFAULT_BUDGET` feeds it and the wall
  (`timeoutMs` :900, `approvalTimeoutMs` :1913) stays `DEFAULT_BUDGET.wallMin * 60_000`.
- **stall-exceeds-wall / stall-nonpositive / stall-noninteger-admission-missing** → blk-6: deployment
  seam admission check — `stallMs` must be a positive safe integer strictly less than the node wall
  `timeoutMs`; violation throws the typed refusal `watchdog_stall_exceeds_wall` (no silent
  fallback); the same check re-runs at `_armWatchdog` for defense-in-depth.
- **watchdog-config-disclosure-missing** → blk-6: the resolved watchdog config
  `{stallMs, basis: 'no_progress_evidence', rearmKinds: [ACTUAL-sorted]}` rides the deployment/run
  status surface byte-stable (a read, never a throw).
- **rearm-kinds-missing** → D2: the frozen four-kind `REARM_KINDS` literal in ACTUAL sorted order is
  exported from the coordinator.
- **chatty-idler-rearms / any-event-rearm-killed** → blk-2/blk-8: `_observeWatchdogEvent` is
  re-ordered — the observation/loop-tracking branches (`resource.provider_call`,
  `content.tool_call` + `loopThreshold`, `content.file_edit`) run FIRST gated on their own kind
  checks, `lifecycle.turn_started` sets `turnInFlight` and resets the turn, and the REARM_KINDS
  silence-return comes LAST (`!REARM_KINDS.includes(event.kind) → return`); only the four kinds touch
  `_touchWatchdog`. The scratchpad/observation machinery still runs for its own purposes.
- **in-flight-turn-gate-missing / in-flight-liveness-missing** → blk-5: `handle.turnInFlight` set
  true on observed `lifecycle.turn_started`, cleared at the turn-terminal seam
  (`lifecycle.turn_completed` :12307-12323 and the crash/exit paths :12844); the `_armWatchdog` timer
  callback re-arms WITHOUT declaring while `handle.turnInFlight === true`. A 20-minute compile is not
  a stall; the wall budget is the operator-pinned hung-turn backstop.
- **null-deadline-sweep-missing** → blk-7: the `question` record gains `mintedAt: this._now()` at
  mint; `_sweepDeadlines` gains a `question` branch beside the decision branch:
  `effectiveDeadlineAt = record.deadlineAt ?? record.mintedAt + blockingInteractionTimeoutMs`; on
  expiry mint the `interaction_expired` attention reason (G8), release the worker to `working`
  (`_expireDecision` release precedent, `coordTransition` `input_required` → `working`, best-effort
  wire cancel, `handle.status = 'working'`), receipt `question.expired {resolution:
  {disposition: 'escalated'}}`; the record stays `pending` and answerable — never a fabricated
  answer, never a close.
- **interaction-ack-extension-missing** → blk-7/OQ-1: the claim/ack surface
  `claimInteraction(requestId, {actor})` (claim_turn-shape) on the pending interaction / attention
  reason marks it acknowledged-in-review; an acknowledged interaction extends its effective deadline
  by `+ blockingInteractionTimeoutMs` per ack and is skipped by the sweep. A legitimate >window
  operator review is never preempted.
- **stall-basis-missing** → D2: `health.stall_suspected` payload gains
  `basis: 'no_progress_evidence'` (and rides `waitingOn: {kind: 'provider_stalled'}` via G9) — the
  honest claim is no-evidence, never "too slow".
- **stall-declared-reason-missing** → D4 rung 1: a NEW `_applyWatchdogAction` `'escalate'` branch
  mints the `stall_declared` attention reason (`{seq, runId, mintEpoch, mintedAt, kind:
  'stall_declared', basis: 'no_progress_evidence', workerId, stallMs}`) into the orchestrator inbox
  (G8) and does NOT stop the worker; the `kill`/`interrupt` → `_beginStop` branches stay untouched.
- **stall-seam-cycle-missing** → blk-9: `_armStallCycle(handle, task, {nudgeId, controlId})` armed on
  `control.steer` OR `control.nudge`; record `{kind: 'stall_seam', worker, taskId, nudgeId, controlId,
  mintedAt, windowMs, answered: false, basis: 'no_progress_evidence', lifetime}`; expires on
  `windowMs` (`_progressNudgeWindowMs ?? 300_000`) with a `working` task — it does NOT reuse the
  `paused`-only `_expireSteeringCycle`.
- **stall-seam-answer-set-missing** → blk-4: the stall-seam cycle answers ONLY on a D2 REARM kind
  observed inside the window; a scratchpad/capability note cannot clear a stall; a qualifying re-arm
  calls `_clearStall(handle)` (the stall-flag removal seam — deletes the `stall` flag, clears the
  lifetime digest set, re-arms the watchdog fresh). Rung 3 reap requires the cycle expired
  unanswered AND `turnInFlight === false` AND the stall persists, with `_preserveProgressBeforeReap`
  first and the stop receipted.
- **stall-lifetime-dedup-missing** → blk-4: the cycle's digest set lives on the stall lifetime
  (`handle.stallSeamDigestSet`, cleared only by `_clearStall`), not per-cycle — one reused digest
  cannot answer successive cycles.

## Suite-law hygiene (verified)

- **Hermetic**: ScriptableAdapter (no harness, no network) + MockAdapter; `mkdtempSync` repos/logs;
  global `test.after` cleanup; the deployment-verification stub is the brief's `true` command.
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (a
  namespace `assert.ok(...)` for invented exports, a behavior assertion for the sweep/ladder seams);
  the PIN-before-stage rows (D1/E1/E2) verified to fail at the stage, not the PIN. 17 RED rows /
  6 PINs, stable across consecutive runs.
- **NUL discipline**: the two NUL-bearing files (`application.mjs`, `coordination-store.mjs`, 3 NUL
  bytes each) are never read whole — only their exports are imported (`BatonApplication`,
  `MockAdapter`, `coordinationForLog`). `application-deployment.mjs` and `coordinator.mjs` are
  NUL-free (0 NUL bytes) and read whole for the anchors. The suite file itself is NUL-free.
- **No clocks as controls / the control law holds**: the watchdog rows drive the real `_armWatchdog`
  timers exactly as production does (real `setTimeout`); the sweep rows (D1/D2/D5) drive the real
  `_sweepDeadlines` through the injected `now()` test double and the public `tick()`. No row asserts
  a wall-clock behavior of the fleet: `Date.now()` appears only as a harness timeout inside
  `findStall`. The control-law line is asserted directly (C2: no bound fires on elapsed time without
  an evidence check).
- **No `localeCompare`**; the `REARM_KINDS` literal is asserted in ACTUAL sorted order (the
  contract-verified `[...set].sort()` identity) and the disclosure row deep-compares it to the
  sorted constant.
