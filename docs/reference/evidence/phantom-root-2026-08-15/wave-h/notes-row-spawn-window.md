# row-spawn-window — implementation + red-first pin suite (issue #199 root)

[attempt: 8acdcc3d-17ab-471c-9525-0cce86606e3d row-spawn-window]

Deliverable: no failed-verdict inside the spawn-confirmation window. Implementation in
impl/src (wave.mjs, workflow-interpreter.mjs, wave-driver.mjs, coordinator.mjs,
application-semantics.mjs) plus the red-first pin suite impl/test/spawn-window-red.test.mjs.

## Red-first evidence

The pin suite was written against the pre-fix tree and run RED before any implementation:
- SW-2 (coordinator, contract 2) failed: the second lifecycle.spawned produced two
  `lifecycle.process_attribution_refused` events and a kill (member dead mid-window).
- SW-1 (wave drive, contract 1) failed: `wave.settle()` verdict-failed the member on the FIRST
  status read (`phase: 'failed'` with no typed cause), before the evidence advanced to
  `completed`.
- SW-1b / SW-3 passed pre-fix (they pin the evidence-count confirmation and the
  typed-cause-still-immediate semantics — the green side of the gate).

Post-fix: 4/4 green. Adjacent batteries: coordinator 58/58, wave-driver 21/21, workflow
(interpreter) 115/117 with FP-14-tools/FP-15 failing identically on the base commit
(pre-existing environmental), wave batch identical to base (24 expected-red rows in
redrive-continuity-red), trust-gate/phase90/phase92 41/41, semantics batch 52/53 with SC6
pre-existing on base.

## Contract 1 — the drive treats a member as failed ONLY on terminal evidence

The drive-loop member-status reads (wave.mjs `progress()`/`settle()`, wave-driver.mjs L5 poll,
workflow-interpreter.mjs `readView`/`isTerminal`) resolved terminality from the phase alone
(`applicationTerminal(outline.phase)`), so a `failed` phase racing the spawn window verdict-failed
the member instantly.

Fix (evidence-count, mirroring the landed tri-state pattern 3794b583):
- `typedTerminalEvidence(viewOrOutline)` (application-semantics.mjs): a `failed` read is backed
  by terminal evidence iff the view carries a typed `terminalCause` (kind+code — the durable task
  failed transition WITH cause, or process_closed with no successor) or `nodes[0].terminalOutcome`
  with `accepted: false`. Success-resting terminals are untouched — only the FAILED class can be
  produced by the spawn window.
- `terminalFrom` (wave.mjs) and the wave-driver/interpreter terminal predicates gate the failed
  class on that evidence; `startError` remains terminal (the pre-existing `entry.startError`
  branch).
- Suspicious reads (failed phase, no typed evidence) DEFER to the next poll and count
  consecutively; `SPAWN_WINDOW_CONFIRMATION_READS = 3` consecutive suspicious reads confirm the
  failed verdict (the 3794b583 3-sweep streak; never a clock). wave.settle's outcome carries
  `terminal: true` for a streak-confirmed member even if its final read still races the window.
- The interpreter's poll loop gains a `suspiciousFailedPolls` leg beside the existing A12
  unreadable leg (confirmation-pair + 1 = 3), hard-breaking only on the evidence-count
  confirmation.

## Contract 2 — the double-spawn window binds to the same member

A second lifecycle.spawned for the same worker inside the spawn-confirmation window is a harness
retry the coordinator owns. Previously `_handleEvent`'s validProviderReady gate refused
attribution and killed the member (orphaning the working process). Now:

- `_ownedHarnessRetry(handle, payload, opts)` identifies the coordinator-owned retry: the spawn
  is still being confirmed (nativeSpawnPending / recoverySpawnPending / turnAdmission /
  admittedReady) or the process is still `initializing`, and the retry does not testify to a
  STALE generation (never older than the coordinator's own). A genuinely foreign/stale identity
  still refuses.
- An owned retry's `lifecycle.spawned` is BOUND to the same member: the wire identity enriches
  the sessionRef, and when it testifies a new process identity inside the window the processRef
  is reacquired (generation advance) so the retried process's follow-on lifecycle attributes
  correctly. No new claim is ever minted (the claim count is pinned to 1 in SW-2).
- A same-generation `lifecycle.process_started` arriving while the first process is still
  `initializing` is likewise bound (reacquire exact transport identity + process_authority,
  keep working), never a kill.

## Judgment calls (recorded)

1. "Terminal evidence" on the drive side = the run view's typed terminalCause OR
   nodes[0].terminalOutcome(accepted:false). The evidence shape's third leg ("process_closed with
   no successor") is the coordinator-side fact that lands in the view as exactly such a typed
   cause (transport_closed / spawn_refused families); the drive has no independent process-close
   read, so the view-attached typed cause is the honest projection of it.
2. Confirmation count N=3: the landed 3794b583 pattern uses a persistent unknown streak of 3
   sweeps; the interpreter's own A12 leg uses confirmation-pair + 1 = 3. Three consecutive
   suspicious reads is the consistent evidence-count number across all three drive surfaces.
3. Contract 2's "not a new claim" is enforced at the event boundary (the retry never mints a
   task.claimed — SW-2 pins claims.length === 1). The coordinator's re-dispatch path already
   claims the same task/worker pair; the binding fix targets the event-level invalidation point
   the brief anchors (`_handleEvent` validProviderReady).
4. No authority-class ambiguity arose: the closed contract named the fix sites and semantics
   (wave.mjs drive read, coordinator spawn/claim sequencing) and this row's path scope covers
   every touched file. No DECISION_REQUEST needed.

## Files changed

- impl/src/application-semantics.mjs — `typedTerminalEvidence` + `SPAWN_WINDOW_CONFIRMATION_READS`.
- impl/src/wave.mjs — `terminalFrom` failed-class gate; settle suspicious-streak confirmation.
- impl/src/workflow-interpreter.mjs — readView terminal gate + suspicious-failed confirmation leg.
- impl/src/wave-driver.mjs — L5 poll + stall re-read failed-class gates with streak confirmation.
- impl/src/coordinator.mjs — `_ownedHarnessRetry`; spawned/process_started owned-retry binding.
- impl/test/spawn-window-red.test.mjs — red-first pin suite (SW-1/SW-1b/SW-2/SW-3).
