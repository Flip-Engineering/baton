# #67 IMPL NOTES — stall watchdog implementation wave

**Status:** IMPLEMENTED — 27/27 green, zero weakening edits
**Date:** 2026-08-12
**Brief:** `impl-67-brief.md` (this directory)
**Contract:** `stall-watchdog-contract.md` v1.1 (unchanged by this wave)
**Fold-2 oracles:** `suite-fold-2.md` F1–F7 (F8/F9/F10 deferred, out of scope)

---

## What landed (impl/src, by decision)

### D1 — decoupling + admission + disclosure (SW-01, SW-11, SW-12)

- `application-deployment.mjs`: new `DEFAULT_WATCHDOG` — a separately-frozen deployment constant
  `{ stallMs: 20*60_000, blockingInteractionTimeoutMs: 20*60_000, loopThreshold: 3, loopAction:
  'interrupt', stallAction: 'escalate' }`, frozen independently of `DEFAULT_BUDGET`. The
  `openBatonDeployment` seam now passes `watchdog: { ...DEFAULT_WATCHDOG }` instead of deriving
  `stallMs` from `DEFAULT_BUDGET.wallMin * 60_000`. `DEFAULT_BUDGET` and `DEFAULT_WATCHDOG` are
  exported for the admission check and the suite's namespace probe.
- `index.mjs` `createDriver`: admission check at the deployment seam — `watchdog.stallMs` must be a
  positive integer strictly less than `DEFAULT_BUDGET.wallMin * 60_000` (480 min); a violation
  throws the typed refusal `watchdog_stall_exceeds_wall` (no silent fallback). The coordinator's
  `_armWatchdog` keeps its silent `stallMs > 0` guard as defense-in-depth (F1 pin: the coordinator
  does not know the deployment wall).
- `coordinator.mjs` `watchdogConfig()` + `application.mjs` `view.watchdog`: the resolved config is
  disclosed byte-stable on the run status surface `{ stallMs, basis: 'no_progress_evidence',
  rearmKinds: [ACTUAL-sorted] }` (single-attempt and workflow views).

### D2 — closed re-arm set + feed + actor policy (SW-03/SW-04/SW-05) + in-flight gate (blk-5)

- `coordinator.mjs` exports `REARM_KINDS` — the frozen four-kind ACTUAL-sorted literal
  `['approval.resolved','decision.settled','lifecycle.turn_started','question.answered']`.
- `_observeWatchdogEvent` rewritten in blk-8 order: `resource.provider_call` /
  `content.tool_call` (loopThreshold detector intact) / `content.file_edit` (scope-orientation
  intact) branches run FIRST, each returning without re-arm; `lifecycle.turn_started` sets
  `handle.turnInFlight = true` + `_resetWatchdogTurn`; the `!REARM_KINDS.includes(kind)` silence
  return comes LAST. The blanket `event.actor !== 'worker'` gate is removed — the closed set is the
  gate.
- `handle.turnInFlight` (per-handle liveness marker) set on `lifecycle.turn_started`, cleared at
  the turn-terminal seam (`turn_completed`, `lifecycle.crashed`, `lifecycle.exited`).
- `_armWatchdog` timer callback: after the existing working/status/stall checks, an in-flight turn
  re-arms without declaring; the `health.stall_suspected` payload gains `basis: 'no_progress_evidence'`.

### D3 — blocked-status escape (SW-06/SW-07/SW-08)

- `question.asked` record gains `mintedAt` (anchor for the null-deadline default).
- `_sweepDeadlines` gains a `question` branch: a pending, un-acked, un-escalated blocking question
  with `deadlineAt == null` gets `effectiveDeadlineAt = mintedAt + blockingInteractionTimeoutMs`;
  on expiry `_expireQuestion` escalates (release to `working`, `question.expired
  {resolution:{disposition:'escalated'}}`, `interaction_expired` attention reason) and **never
  closes** the record — a late answer still lands (never `already_resolved`).
- `claimInteraction(requestId, {actor})` (the claim_turn-shape ack): an acknowledged interaction is
  skipped by the sweep (a legitimate >window operator review is never preempted).

### D4 — kill ladder (SW-02/SW-09/SW-10)

- `_applyWatchdogAction` gains the `escalate` branch → `_mintStallDeclared` (attention reason into
  the G8 inbox, never a stop).
- `_armStallCycle(handle, task, {nudgeId, controlId})` armed on `control.steer`/`control.nudge`
  (the `_deliver` hook) for a declared stall; `working`-compatible expiry on
  `_progressNudgeWindowMs ?? 300_000`. Unanswered expiry with `turnInFlight === false` reaps
  preserve-first (`_preserveProgressBeforeReap` → `kill`); a qualifying D2 re-arm inside the
  window answers the cycle via `_clearStall` (deletes the stall flag, clears
  `handle.stallSeamDigestSet`, re-arms fresh).
- `handle.stallSeamDigestSet` — per-stall-LIFETIME Set, empty at declaration, cleared only by
  `_clearStall`.

## Verification

- `node --test impl/test/stall-watchdog-red.test.mjs` (repo root): **27/27 pass, 0 fail** — stable
  across consecutive runs. All 20 RED rows green at their named stages; all 7 PINs green.
- Adjacents `phase51-process-lifecycle` + `phase62-goal-plan-authority`: **83/83 pass** (the two
  native-harness rows are timing-sensitive — the #7 load-flake class — and pass on repeat runs;
  no deterministic regression).
- Deployment verification command: executable `true`, arguments `[]`, expected exit `0`.

## Known follow-up (out of this worktree's edit boundary)

The A3 pin makes `createDriver({ watchdog: { stallMs: 0 } })` a typed refusal. The pre-#67 tree
used `watchdog: { stallMs: 0 }` as a "disable the watchdog" test idiom in ~17 suites (84 call
sites), including the named adjacent `phase56-drain-and-close.test.mjs`. Those suites now refuse at
the deployment seam and must be re-threaded to a valid positive `stallMs` (e.g. `60_000`) — a
mechanical test-only change under `impl/test/`, outside this brief's `impl/src/**` boundary. The
F1 fold re-threaded the stall suite's own sweep rows (D1/D2/D5) for exactly this collision; the
remaining suites were not in this wave's scope.

Affected suites (for the re-thread): `phase56-drain-and-close`, `phase11-acceptance-integration`,
`phase11-coordination-store`, `phase11-concurrent-grok-reap`, `phase12-web-northbound`,
`phase26-structured-merge`, `phase50-cairn-scratch-correction`, `phase57-provider-governance`,
`phase57-provider-turn-release`, `phase58-driver-sparse-projection`, `board-workerhalf-red`,
`briefing-pack-red`, `harvest-accessor-red`, `nested-orchestration-red`, `orchestrator-wake-red`,
`reflex2-boards-red`, `reply-chains-red`, `tight-cell-red`, `workflow-surface-red`.

## Boundary commits

- `feat(#67): D1 — separately-frozen DEFAULT_WATCHDOG, createDriver stall<wall admission` —
  `application-deployment.mjs` + `index.mjs`.
- `feat(#67): D2-D4 — evidence re-arm set, in-flight gate, null-deadline sweep, kill ladder` —
  `coordinator.mjs` + `application.mjs` (the run-status disclosure rides the coordinator's
  `watchdogConfig()`, so it commits with the machinery).
