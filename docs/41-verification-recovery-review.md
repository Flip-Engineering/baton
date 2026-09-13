# Verification and capture recovery: adversarial design review

Review date: 2026-09-13. Worktree: `ws-2d6ef501906393b37be8328f11b6f097`. Base commit:
`a966bba6`. This is a technical review artifact — not a claim that any described gap is fixed.

## Purpose and scope

This review traces the precise failure path that occurred when a live native self-build committed
useful work, but disk exhaustion during the trust gate's verification setup prevented Baton from
accepting the result. The review distinguishes capacity refusal types, names the exact code paths,
identifies the state left by each failure mode, and proposes the smallest coherent corrections.
Root implements; this document only critiques.

The required execution contract (`node --test impl/test/capacity-refusal-visibility-red.test.mjs`)
passes 6/6 on the reviewed base. That test covers pre-dispatch capacity refusal visibility only;
it is evidence for what it tests, not for the gaps named below.

---

## I. Complete flow trace

### 1. Worker checkpoint → orchestrator completion claim

A worker (native Claude session) finishes a turn. If the adapter card declares
`turnCompletion: 'pausable'`, the coordinator mints a pause record:

**coordinator.mjs:2114–2172 `_admitPauseRecord`**

- A `turn.paused` event is appended with the `turnEpoch` and a `changedPathsDigest`
  (attention evidence only — never gate input).
- The pause record is written to `_pausedTurns` under key
  `pause:${task.id}:${terminalEvent.seq}`.
- The task transitions to `paused`. No prompt, no timer, no automatic continuation.
- The coordinator parks and returns `false`. The pause is visible on `pausedTurns()`.

An orchestrator calls `claimTurn(pauseId)`:

**coordinator.mjs:2443–2497 `claimTurn`**

1. `_reservePauseRecord` acquires the record's single-consumer slot (Part A rule 1).
2. `_claimLivenessPreflight` (coordinator.mjs:2511) optionally confirms a real in-scope diff
   exists before the trust gate fires. If the diff is absent but liveness evidence
   exists, the record stays claimable and the caller is told to nudge first.
3. A `turn.settled` event unparks the task from `paused` to `working`.
4. `_runTrustGate(handle, record.workerResult ?? null)` fires.
5. `commit(...)` or `rollback()` consumes or releases the pause slot.

**After step 5, the pause record is consumed regardless of the gate outcome.** A failed gate
transitions the task to `failed`; the pause cannot be re-claimed.

### 2. Trust gate: capture, scope checks, verification worktree, verdict

**coordinator.mjs:13635–14048 `_runTrustGate`**

```
trustPhase = 'capture'  [set at :13653]
captured = await _captureTrustWorktree(handle, task)   [git rev-parse HEAD or snapshot :13657]
[forbidden_effect check :13664]
[path_scope check :13673]
[required_effect check :13689]

createVerifyWorktree(task.id, sha)                     [:13708]  ← DISK EXHAUSTION HERE
baseCreateVerifyWorktree(...)                          [:13723]  (optional)
structuralEvidence.classify(...)                       [:13731]  (optional)
await this._referee(task, workerResult, {...sandbox})  [:13750]

diagnosticCheckpoint = verdict.outcome is inconclusive | candidate_failed   [:13768]
if (accept && sha) retainedResultRef = pinAcceptedResult(...)               [:13776]
if (diagnosticCheckpoint && sha) checkpoint = retainCheckpoint(sha)         [:13778]

[trustPhase = 'terminal_batch' :13904]
coordination.transitionTaskWithArtifacts(task.id, terminalStatus, ...)      [:13915]
task.capturedSha = captured.sha                                              [:13935]
```

`finally` block removes verify worktrees (always), then if `cleanupAfterVerification` is set,
`_removeOwnedTaskWorktree` is called.

### 3. Where disk exhaustion hits

When the disk is full **at `createVerifyWorktree`** (coordinator.mjs:13708), the thrown error
is typically `worktree_capacity_exceeded` (from `WorktreeCapacityAuthority.reserveMany` at
worktree-capacity.mjs:402) or a raw ENOSPC from the git worktree add command.

The exception propagates to the `catch` block at coordinator.mjs:13970:

```javascript
const code = typeof err?.code === 'string' && /^[a-z0-9_]{1,64}$/u.test(err.code)
  ? err.code : 'trust_gate_failed';
// logs error event with trustPhase still = 'capture' (never updated for this path)
// transitions task to 'failed'
// for POLICY codes (forbidden_effect_observed, required_effect_absent,
//   worker_path_scope_violation): sets handle.terminalCause    [:14003]
// for ALL OTHER codes (including worktree_capacity_exceeded): terminalCause stays null
```

**Key facts at this point:**
- `task.capturedSha` is **never set** (only set at :13935, inside the happy path).
- `diagnosticCheckpoint` is **never computed** (requires reaching verdict at :13768).
- No checkpoint is pinned via the trust gate.
- `task.status = 'failed'`.
- `trustPhase` in the logged error event says `'capture'` even though the failure was during
  verification setup — a misleading label.

### 4. What keeps the work

After `_runTrustGate` returns (with the task failed), coordinator.mjs:14033–14042 runs:

```javascript
if (handle.cleanupAfterVerification) {
  const runtimeRemoved = this._removeRuntimeScope(handle);
  await this._removeOwnedTaskWorktree(handle, task);
  ...
}
```

`_removeOwnedTaskWorktree` (coordinator.mjs:8804) calls `_preserveProgressBeforeReap`
when `preserveUnaccepted` is true (coordinator.mjs:8847–8851):

```javascript
const preserveUnaccepted = Boolean(
  handle.worktree && existsSync(handle.worktree) && task
  && ['dead', 'exited'].includes(handle.status)
  && !['completed', 'verifying'].includes(task.status)
  && task.checkpoint?.state !== 'pinned'
  && task.progressPreservation?.state !== 'no_progress'
);
```

`_preserveProgressBeforeReap` (coordinator.mjs:8740–8801) tries `manager.capture()` then
`manager.retainCheckpoint(sha)`. **If the worker already committed its work** (i.e., `isClean(dir)`
returns true), `captureCommit` only runs `git rev-parse HEAD` — a read with no disk write. This
can succeed even on a full disk, which explains "Baton preserved the exact commit" from docs/40.

The `retainCheckpoint(sha)` call writes a small git ref entry. On a nearly-full volume that
just freed 6.1 GB, this also succeeds. A `worktree.progress_checkpointed` event is appended
and `task.checkpoint = { state: 'pinned', sha, ref }` is set in memory.

**This explains the docs/40 observation: the work survived through the progress-preservation
path during cleanup, not through the trust gate's own checkpoint pinning.**

---

## II. Three distinct failure semantics

### A. Pre-effect capacity refusal

**Code path:** `WorktreeCapacityAuthority.reserveMany` at worktree-capacity.mjs:399–402 throws
`WorktreeCapacityError(code = 'worktree_capacity_exceeded')` before any git operation begins.

This fires at wave/run dispatch time (inside `run.approve()`), before the session is started.
No worktree is created. No worker runs. No git effects exist.

**Run state:** `cancelled` with `terminalCause.kind = 'dispatch_refused'`,
`terminalCause.code = 'worktree_capacity_exceeded'`, `terminalCause.retryable = true`.
(coordinator.mjs area, confirmed by CAP-V2 test at capacity-refusal-visibility-red.test.mjs:148.)

**Correct remediation:** Free disk / raise capacity floors; start a **new Run**. No work to
recover. `retryable: true` is accurate here.

### B. Failed verification

**Code path:** `_runTrustGate` → `_referee` runs the verifier subprocess → verifier exits with
wrong code or fails a gate condition.

`observedVerdict` is computed. `diagnosticCheckpoint = true` when the outcome is `inconclusive`
or `candidate_failed`. A checkpoint is pinned at coordinator.mjs:13778. The trust gate completes
normally, the task reaches `'failed'`, and `task.checkpoint = { state: 'pinned', sha, ref }` is
set.

**Remediation:** Fix the code; resume from the checkpoint (PS5 / `resumeCheckpoint`) or nudge
and claim next checkpoint. The checkpoint carries the exact failing SHA for inspection.

### C. Unavailable verification (infrastructure failure during trust gate)

**Code path:** `_runTrustGate` → `createVerifyWorktree` throws (disk full, lock busy,
or similar) → caught at coordinator.mjs:13970.

`observedVerdict` is **never computed**. `diagnosticCheckpoint` is **never set**. No checkpoint
is pinned by the gate. Task goes to `'failed'` with `terminalCause = null` (since the
worktree capacity code is not in the policy-code set at :14003).

Progress is preserved via cleanup (described in §I.4 above), producing
`task.checkpoint.state = 'pinned'` in memory and a `worktree.progress_checkpointed` event.

**Remediation:** Fix the infrastructure; resume from the pinned progress checkpoint
(`resumeCheckpoint` PS5) after the condition clears. A **new Run** discards the preserved work.
`retryable: true` guidance pointing to a new Run is actively harmful here.

### Gap: the three failure modes are indistinguishable from the Run view

All three result in a terminal Run. Two result in `phase = 'failed'`. Only pre-effect produces
`phase = 'cancelled'`. But between B (failed verification) and C (unavailable verification):
- Both produce `phase = 'failed'`.
- B has a pinned checkpoint from the trust gate's own checkpoint path.
- C has a pinned checkpoint from the cleanup preservation path (if the process had already exited).
- Neither projects a `terminalCause` that distinguishes "code failed the check" from
  "infrastructure prevented the check."
- The `trustPhase = 'capture'` label in the error event is wrong for C (the failure is in
  verification setup, not in the snapshot step).

---

## III. Contribution lifetime vs author lifetime

The native observer worker committed its work (the git commit exists), reported completion, was
checkpointed at `claim_turn` time, and had its session closed. The **author** (the worker session)
is fully done. The **contribution** (the git commit pinned as a progress checkpoint) lives
independently.

The current design correctly preserves contributions via `_preserveProgressBeforeReap`, but the
API surface does not distinguish:

1. **Author lifetime:** the worker session, its process group, its capacity reservation. These
   are released on close.

2. **Contribution lifetime:** the pinned checkpoint SHA and its git ref. These persist until
   explicit cleanup by the owning controller. A coordinator restart or reattachment can read
   `task.checkpoint` from the durable coordination store and resume.

The acceptance gate is coupled to the author lifetime (the trust gate runs inside the worker's
active session context). An infrastructure failure at the end of the author's lifetime
incorrectly closes the contribution's path to acceptance.

**The consequence:** a checkpoint preserved through the cleanup path after a failed trust gate
is available for `resumeCheckpoint` (PS5), which re-dispatches the work on a fresh session.
This is the correct recovery path. But neither the Run view nor the terminal cause communicates
this: the caller sees a failed Run and may retry with a new unrelated Run.

---

## IV. Swarm isolation invariant

docs/39 §2 (worker/session failure): "Worker/session failure affects its owned activity and
actual dependents. Independent peers continue."

The current implementation preserves this correctly for capacity refusal scenarios:

- `createWave` uses `Promise.all` for concurrent admission (wave.mjs:314). One member's
  `run.approve()` failing with `worktree_capacity_exceeded` records that member's
  `startError` without affecting siblings.
- `settle` observes members in independent per-member loops (wave.mjs:654). A member's
  trust gate failure does not prevent other members from completing.
- `close` initiates all member stops concurrently (wave.mjs:831). One stop failure produces a
  typed stop record, not a peer abort.

**No regression here.** Tight and loose groups remain free to continue unaffected peers.

One residual uncertainty: when a verification worktree capacity failure causes a task to fail
during `_runTrustGate` while that task belongs to a wave member, the wave's `settle` call
observes the member as terminal (failed). The sibling members are unaffected because settle uses
per-member independent loops. This is correct per the swarm design.

---

## V. Implementation direction

These are the smallest coherent corrections, ordered by impact. Root decides which to act on.

### V-1. Distinguish unavailable verification from failed verification (highest impact)

When `createVerifyWorktree` (or `createBaseVerifyWorktree`) throws inside `_runTrustGate`,
set `trustPhase` to a distinct value before the throw propagates so the logged error event
carries an accurate label:

**coordinator.mjs:13708** — set `trustPhase = 'verification_setup'` before calling
`createVerifyWorktree`, and `trustPhase = 'base_verification_setup'` before
`createBaseVerifyWorktree`. The existing catch block at :13981 already logs `trustPhase`; this
change makes the logged phase accurate.

Additionally, pin a progress checkpoint from inside the catch block when the failure code
indicates an infrastructure problem (`worktree_capacity_exceeded`,
`worktree_capacity_unavailable`, `checkpoint_failed`) and a captured SHA exists. This
consolidates checkpoint pinning into one place rather than relying solely on cleanup.

### V-2. Surface verification-unavailable as a typed terminal cause (high impact)

The conditions at coordinator.mjs:14003 that set `handle.terminalCause` cover policy codes only.
Add an analogous clause for infrastructure failures during trust gate:

```javascript
if (['worktree_capacity_exceeded', 'worktree_capacity_unavailable'].includes(code)
    && trustPhase === 'verification_setup') {
  handle.terminalCause ??= deepFreeze({ kind: 'verification_infrastructure', code });
  task.terminalCause = handle.terminalCause;
}
```

This lets the Run view project a distinct `terminalCause.kind = 'verification_infrastructure'`
separate from `'policy_failure'` and `'provider_failure'`.

### V-3. Correct the retryable guidance for verification-infrastructure failures

The DISPATCH_REFUSAL_GUIDANCE at application-semantics.mjs:2185 correctly labels
`worktree_capacity_exceeded` as retryable. A VERIFICATION_INFRASTRUCTURE_GUIDANCE should carry
different remediation:

```
summary: 'The verification environment could not be created; the work is preserved as a checkpoint.'
remediation: 'Free repository volume space or raise capacity floors, then resume from the pinned checkpoint.'
retryable: false  // a new Run loses the preserved checkpoint
```

This requires `projectTypedTerminalCause` to recognize `kind = 'verification_infrastructure'`
and route to the new guidance object.

### V-4. Surface the preserved checkpoint in the terminal Run view

When a task is `'failed'` AND `task.checkpoint.state === 'pinned'`, the Run view should
surface the checkpoint SHA and ref. Today `task.capturedSha` is null (never set by the
trust gate in this path), so the checkpoint is not visible from the standard result surface.
The Run view projection should include:

```
checkpoint: { sha, ref, state: 'pinned', origin: 'progress_preserved' }
```

when `task.checkpoint` exists and `task.capturedSha` is absent. This avoids archaeology
in the event log to recover the SHA.

### V-5. No universal retry count or timer

The design document (docs/39 §2) explicitly prohibits elapsing time or repeated assertions as
evidence about work. No proposed correction introduces a retry count or a backoff timer.
A caller who recovers disk space and wants to re-verify calls `resumeCheckpoint`, which
re-dispatches the existing pinned SHA into a fresh worker session. That is the one sanctioned
path.

---

## VI. Adversarial acceptance invariants

These are behavioral claims that a correct implementation must satisfy. Each can be turned
into a targeted test in the existing test style.

**INV-1 (pre-effect vs post-work):** A capacity refusal that occurs before any git effect
produces `phase = 'cancelled'`, `terminalCause.kind = 'dispatch_refused'`, and no pinned
checkpoint. A capacity failure that occurs during `createVerifyWorktree` after a committed
worker result produces `phase = 'failed'`, `terminalCause.kind = 'verification_infrastructure'`,
and a pinned progress checkpoint accessible from the Run view. These two outcomes are never
conflated.

**INV-2 (checkpoint pinned after unavailable verification):** After a trust gate that fails at
verification setup, `task.checkpoint.state === 'pinned'` is set. The checkpoint SHA resolves
via `resolveCheckpoint` to the worker's committed HEAD. `resumeCheckpoint` on that SHA
dispatches successfully once the infrastructure condition clears.

**INV-3 (no retryable guidance for post-work failure):** The Run view for a
`verification_infrastructure` terminal cause carries `retryable: false` and names the
checkpoint in its remediation. It never says "start a new Run."

**INV-4 (independent peers unaffected):** One wave member failing at trust gate verification
setup does not terminate, pause, or delay sibling members. Their `settle` observations remain
independent. The wave's `close` still initiates all stops concurrently.

**INV-5 (pause record consumed only once):** A `claim_turn` that triggers a
verification-infrastructure failure does not leave the pause record claimable again. The task
is `'failed'`. A subsequent `claim_turn` on the same `pauseId` is refused. Recovery proceeds
via `resumeCheckpoint`, not via a second claim.

**INV-6 (trustPhase label accuracy):** The error event appended when `createVerifyWorktree`
throws carries `trustPhase = 'verification_setup'`, not `'capture'`. A caller reading the
event log can distinguish "snapshot failed" from "fresh verification sandbox failed."

**INV-7 (contribution outlives author):** A pinned progress checkpoint produced by
`_preserveProgressBeforeReap` during cleanup survives coordinator restart. After replay, the
task record carries `checkpoint.state === 'pinned'` and `checkpoint.sha` resolves. The worker
session (author) is fully closed; the checkpoint (contribution) is independently readable.

---

## VII. Source reference index

| Item | File | Approximate lines |
|------|------|-------------------|
| Pause record mint | coordinator.mjs | 2114–2172 |
| `claimTurn` | coordinator.mjs | 2443–2497 |
| Liveness preflight | coordinator.mjs | 2511–2574 |
| `_captureTrustWorktree` | coordinator.mjs | 2579–2588 |
| Trust gate entry | coordinator.mjs | 13635–13653 |
| Capture call | coordinator.mjs | 13657–13659 |
| `createVerifyWorktree` call | coordinator.mjs | 13708 |
| Verdict computation | coordinator.mjs | 13750 |
| `diagnosticCheckpoint` flag | coordinator.mjs | 13768 |
| Checkpoint pinning (gate) | coordinator.mjs | 13778–13786 |
| `task.capturedSha` set | coordinator.mjs | 13935 |
| Trust gate catch block | coordinator.mjs | 13970–14017 |
| Policy-code terminalCause | coordinator.mjs | 14003–14008 |
| `_removeOwnedTaskWorktree` | coordinator.mjs | 8804–8871 |
| `preserveUnaccepted` test | coordinator.mjs | 8847–8851 |
| `_preserveProgressBeforeReap` | coordinator.mjs | 8740–8801 |
| `captureCommit` | worktree.mjs | 1194–1244 |
| `WorktreeCapacityAuthority.reserveMany` | worktree-capacity.mjs | 351–415 |
| Capacity floor check | worktree-capacity.mjs | 399–402 |
| Pre-dispatch guidance | application-semantics.mjs | 2185–2204 |
| `projectTypedTerminalCause` | application-semantics.mjs | 2219+ |
| CAP-V1..V6 dispatch tests | capacity-refusal-visibility-red.test.mjs | 97–238 |
| Harvest recovery invariants | harvest-recovery-red.test.mjs | 241–399 |

---

## VIII. Evidence: test execution

The required test suite passes on this base:

```
node --test impl/test/capacity-refusal-visibility-red.test.mjs
# tests 6 / pass 6 / fail 0 / cancelled 0
```

CAP-V1 through CAP-V6 cover **pre-dispatch** capacity refusal visibility: typed code survival
through the Web mapping, cancelled-with-cause terminal state, durable event facts, doctor
reporting, jitter quantization, and retry refusal. These claims are validated.

The gaps named in §II–V are not covered by any existing targeted test. INV-1 through INV-7
above are the acceptance invariants for those gaps.

---

## Conclusion

The pre-dispatch capacity refusal path (CAP-V1–V6) is correctly implemented and tested. The
trust gate's handling of infrastructure failure during verification setup is not: it conflates
unavailable verification with failed verification, loses the `trustPhase` label accuracy, omits
a distinct `terminalCause.kind`, and projects `retryable: true` guidance that points to a new
Run when the correct recovery is `resumeCheckpoint` on the preserved progress checkpoint.
The pause record is correctly consumed exactly once, and the swarm isolation invariant (peers
continue unaffected) is correctly preserved. The contribution lifetime (the pinned checkpoint)
correctly outlives the author lifetime (the closed worker session) via the cleanup preservation
path, but this is invisible from the Run view surface. Corrections are in §V; invariants in §VI.
