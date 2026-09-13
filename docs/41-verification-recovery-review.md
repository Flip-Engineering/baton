# Verification and capture recovery: adversarial design review

Review date: 2026-09-13. Worktree: `ws-2d6ef501906393b37be8328f11b6f097`. Base commit:
`a966bba6`. This is a technical review artifact — not a claim that any described behavior is
fixed. Sections are labeled **[PROVEN]**, **[PLAUSIBLE]**, or **[PROPOSED]** to distinguish
observed source behavior, inferred paths that require the run receipt to confirm, and design
directions that are not yet implemented.

---

## I. Traced source paths

### 1. Worker checkpoint → pause park

When a native worker turn completes and the adapter card declares `turnCompletion: 'pausable'`,
the coordinator mints a pause record (coordinator.mjs:2114–2172 `_admitPauseRecord`):

- Appends a durable `turn.paused` event carrying `turnEpoch` and `changedPathsDigest`.
- Writes a pause record to `_pausedTurns` keyed `pause:${task.id}:${terminalEvent.seq}`.
- Transitions task to `paused`. No prompt, no timer, no automatic continuation. **[PROVEN]**

### 2. `claimTurn` → trust gate

An orchestrator calls `claimTurn(pauseId)` (coordinator.mjs:2443–2497):

1. `_reservePauseRecord` acquires the single-consumer slot (Part A rule 1).
2. `_claimLivenessPreflight` (coordinator.mjs:2511) may return `{ok:false}` if the diff is
   absent but liveness evidence exists; rollback leaves the record claimable.
3. `turn.settled` unparks task from `paused` → `working`.
4. `_runTrustGate(handle, record.workerResult ?? null)` runs.
5. `commit()` or `rollback()` is called.

After step 5, **the pause record is consumed exactly once** regardless of gate outcome. A failed
gate moves the task to `'failed'`; the same pause record cannot be claimed again. **[PROVEN]**

### 3. Trust gate internals

**coordinator.mjs:13635–14048 `_runTrustGate`**

```
trustPhase = 'capture'                                        [:13653]
captured = await _captureTrustWorktree(handle, task)          [:13657]
  → captureCommit(dir, taskId, opts)                          [worktree.mjs:1194]
  → if !isClean(dir): git add -A + git commit                 [worktree.mjs:1209]
  → git rev-parse HEAD                                        [worktree.mjs:1235]

[forbidden_effect check]                                      [:13664]
[path_scope check]                                            [:13673]
[required_effect check]                                       [:13689]

createVerifyWorktree(task.id, sha, {...})                      [:13708]
  → WorktreeCapacityAuthority.reserveMany(...)                [worktree-capacity.mjs:351]
    checks floors: throws worktree_capacity_exceeded           [:13399-402]
  → or ENOSPC from git worktree add

observedVerdict = await _referee(task, ...)                   [:13750]

diagnosticCheckpoint = verdict.outcome ∈ {inconclusive, candidate_failed}  [:13768]
if accept && sha: retainedResultRef = pinAcceptedResult(...)  [:13776]
if diagnosticCheckpoint && sha: checkpoint = retainCheckpoint [:13778]

task.capturedSha = captured.sha   ← ONLY in happy path        [:13935]
```

`finally` removes verify worktrees; `_removeOwnedTaskWorktree` fires if
`handle.cleanupAfterVerification` is set. **[PROVEN]**

### 4. What happens when `createVerifyWorktree` throws

The exception enters the catch block at coordinator.mjs:13970 **[PROVEN]**:

```javascript
const code = err?.code ?? 'trust_gate_failed';  // e.g. 'worktree_capacity_exceeded'
// Logs error event with trustPhase still = 'capture' (never advanced for this path)
// Attempts: coordination.transitionTask(task.id, 'failed', ...)
// Policy-code guard at :14003 — sets handle.terminalCause ONLY for:
//   forbidden_effect_observed | required_effect_absent | worker_path_scope_violation
// worktree_capacity_exceeded is NOT in that set → handle.terminalCause stays null
```

Verified: `projectTypedTerminalCause` (application-semantics.mjs:2219–2242) receives
`terminalResult.terminalCause = null` and no `dispatchRefusal`, no `terminalOutcome`, no
`runStop` → **returns null**. The Run view terminalCause is absent, not wrong. There is no
retryable guidance because there is no terminalCause to read.

`production-convergence-state.mjs:264–271`: `collectRunViews` only considers non-null cause
objects; a null terminalCause is invisible to the AutomaticRecoveryController. **[PROVEN]**

The `trustPhase` label in the error event says `'capture'` even though the failure was at
verification setup — a misleading label but verifiable from source. **[PROVEN]**

`task.capturedSha` is never set (only at :13935, inside the happy path). **[PROVEN]**
`diagnosticCheckpoint` is never evaluated (requires reaching :13768). **[PROVEN]**
No checkpoint is pinned through the trust gate for this error path. **[PROVEN]**

### 5. The 6.1GB context and progress preservation — what is and is not known

docs/40 records: "a live disk-capacity refusal at capture prevented Baton acceptance. Baton
preserved the exact commit and closed with zero remaining owned resources. Root just recovered
6.1GB."

The 6.1GB recovery happened **after** the prior run closed. It does not explain how preservation
succeeded during that run while the disk was full. Two plausible explanations:

**[PLAUSIBLE — requires run receipt to confirm]**

*Path A:* `captureCommit` (worktree.mjs:1194) when the worker had already committed runs only
`git rev-parse HEAD` (no disk write), and the trust gate failure hit at `createVerifyWorktree`.
`_preserveProgressBeforeReap` (coordinator.mjs:8740) then called `retainCheckpoint`, which
writes a tiny git ref (~40 bytes). On a nearly-but-not-entirely-full volume this can succeed
where a full worktree checkout cannot.

*Path B:* The failure was elsewhere; the worker's committed branch remains on the disposable
task branch, which is not removed because `cleanupPending = true` when preservation fails.
"Preserved the exact commit" refers to physical presence in the git object store, not a durably
pinned ref.

**Neither path is confirmed without inspecting the run receipt.** The source analysis names
these as candidate paths, not established facts. The distinction matters: Path A produces a
re-findable ref; Path B produces a reachable-but-not-indexed commit that a later reconciliation
could remove.

`_preserveProgressBeforeReap` can itself fail (coordinator.mjs:8800):

```javascript
throw Object.assign(new Error('progress preservation failed before worktree reap'),
  { code: 'progress_preservation_failed' });
```

When it fails, `cleanupPending = true`, the worktree is not removed, and the commit remains
physically present. **Not all infrastructure failures at the trust gate produce pinned
checkpoints.** Preservation is best-effort and independently failable. **[PROVEN]**

---

## II. Three distinct failure semantics **[PROVEN from source]**

### A. Pre-effect capacity refusal

Fires at `WorktreeCapacityAuthority.reserveMany` (worktree-capacity.mjs:399–402) inside
`run.approve()`, before any session is started. No git effects exist.

Run state: `cancelled`, `terminalCause.kind = 'dispatch_refused'`,
`terminalCause.code = 'worktree_capacity_exceeded'`, `terminalCause.retryable = true`.
Confirmed by CAP-V1 through CAP-V6 (capacity-refusal-visibility-red.test.mjs, 6/6 pass).

The `retryable: true` guidance here is accurate — no work was done, a new Run is the right
action once the condition clears.

### B. Failed verification

`_runTrustGate` runs the verifier subprocess; it returns. `observedVerdict` is computed.
`diagnosticCheckpoint = true` when outcome is `inconclusive` or `candidate_failed`. A
checkpoint is pinned at coordinator.mjs:13778. Task reaches `'failed'` with
`task.checkpoint = { state: 'pinned', sha, ref }`. **[PROVEN]**

### C. Unavailable verification (infrastructure failure inside trust gate)

`createVerifyWorktree` throws before any verification subprocess runs. `observedVerdict` is
never computed. No checkpoint is pinned by the gate. Task reaches `'failed'` with
`handle.terminalCause = null`. Run view terminalCause is null. **[PROVEN]**

Progress may or may not be preserved through cleanup (see §I.5). **[PLAUSIBLE]**

---

## III. Contribution lifetime vs author lifetime

The **author** is the worker session: its process group, capacity reservation, and task slot.
All of these end at close.

The **contribution** is the git commit the worker produced. If the task branch survives cleanup
(because `cleanupPending = true` or because a ref was pinned), the commit exists independently.

The current API does not distinguish these lifetimes on the Run view surface. A caller who
sees `phase: 'failed'`, `terminalCause: null` cannot tell:

1. Whether a contribution exists at all.
2. Whether that contribution is reachable via a durable ref or only via the task branch.
3. Whether the failure was in the code (check B) or in infrastructure (check C).

`resumeCheckpoint` (coordinator.mjs:6403, PS5) is an existing path that re-dispatches a
pinned SHA into a fresh session. It requires `task.checkpoint.state === 'pinned'`. For path A
above (if confirmed), that ref exists. For path B, there may be no pinned ref to pass.

The design document (docs/39) notes that acceptance can identify a specific revision and that
contribution and author lifetimes are separate concepts. Whether re-verifying a contribution
without re-spawning its author is sanctioned or requires new surface is an open design
question this review cannot resolve from source alone. **[PROPOSED direction, not current
behavior]**

---

## IV. Swarm isolation **[PROVEN]**

`createWave` admits members concurrently via `Promise.all` (wave.mjs:314). One member's
`startError` from `run.approve()` is caught per-member without aborting siblings.

`settle` uses independent per-member loops (wave.mjs:654). One member's trust gate failure
does not delay or terminate sibling members.

`close` initiates all stops concurrently (wave.mjs:831). One stop failure produces a typed
record; peers are not affected.

Independent peers continue unaffected when one member fails at verification. This is correct
per docs/39 and is preserved by the current implementation.

---

## V. Implementation direction **[PROPOSED]**

These are coherent corrections, not implementation commitments. Root selects.

### V-1. Accurate `trustPhase` label

Set `trustPhase = 'verification_setup'` before the `createVerifyWorktree` call at
coordinator.mjs:13708 (and `'base_verification_setup'` before :13723). The existing catch
block at :13981 logs `trustPhase`; callers reading the event log currently see `'capture'`
when the failure was at verification setup.

### V-2. Typed terminal cause for infrastructure failures inside the trust gate

Add an analogous clause beside the policy-code guard at coordinator.mjs:14003:

```javascript
if (['worktree_capacity_exceeded', 'worktree_capacity_unavailable'].includes(code)
    && ['verification_setup', 'base_verification_setup'].includes(trustPhase)) {
  handle.terminalCause ??= deepFreeze({ kind: 'verification_unavailable', code });
  task.terminalCause = handle.terminalCause;
}
```

This produces a distinct `terminalCause.kind` that `projectTypedTerminalCause` can route to
its own guidance object, separate from `dispatch_refused` and from `policy_failure`.

### V-3. Surface the preserved contribution state in the failed Run view

When a task is `'failed'` and `task.checkpoint.state === 'pinned'` (however it was pinned),
the Run view should surface the checkpoint sha and whether a re-verification path is
available. Currently `task.capturedSha` stays null and the checkpoint is invisible to callers.
This is a projection gap, not a data gap — the data exists in the in-memory task record.

### V-4. Contribution-present guidance vs contribution-absent guidance

A new Run does not physically delete an existing pinned ref. It creates a new Run that does
not select the prior contribution. The guidance gap is that callers cannot determine from the
Run view whether a recoverable contribution exists. The correction is to surface that fact,
not to prevent new Runs.

Whether the recovery action is `resumeCheckpoint` (existing) or an independent re-verification
path that does not re-dispatch the author is a separate design question. The review does not
prescribe the API shape; it prescribes that the contribution state must be visible.

---

## VI. Selected invariants **[PROPOSED for targeted tests]**

These invariants distinguish the three failure modes. They are proposed contracts for targeted
tests, not universal assertions over existing legacy code.

**INV-A (pre-effect label):** A Run cancelled by pre-dispatch `worktree_capacity_exceeded`
carries `terminalCause.kind = 'dispatch_refused'` and `phase = 'cancelled'`. No checkpoint
field is present. The `retryable` field on the cause is `true`.

**INV-B (unavailable verification label, proposed):** After the trust gate fails at
verification setup with a capacity code, `handle.terminalCause.kind` equals
`'verification_unavailable'`, not `'policy_failure'` and not null. The logged error event
carries `trustPhase = 'verification_setup'`, not `'capture'`.

**INV-C (checkpoint visibility, proposed):** A failed Run that has a pinned progress
checkpoint surfaces the checkpoint sha in its Run view. This is readable without event log
archaeology.

**INV-D (peer isolation, proven):** One member's trust gate failure within a wave does not
prevent sibling member status reads from returning or their stops from being initiated.

**INV-E (pause consumed once, proven):** After `claimTurn` runs the trust gate — regardless
of gate outcome — the same `pauseId` cannot be claimed again.

---

## VII. Source reference index

| Subject | File | Lines |
|---------|------|-------|
| Pause record mint | coordinator.mjs | 2114–2172 |
| `claimTurn` | coordinator.mjs | 2443–2497 |
| Liveness preflight | coordinator.mjs | 2511–2574 |
| `_captureTrustWorktree` | coordinator.mjs | 2579–2588 |
| Trust gate | coordinator.mjs | 13635–14048 |
| `createVerifyWorktree` call | coordinator.mjs | 13708 |
| `diagnosticCheckpoint` flag | coordinator.mjs | 13768 |
| Policy-code terminalCause guard | coordinator.mjs | 14003–14008 |
| `_removeOwnedTaskWorktree` | coordinator.mjs | 8804–8871 |
| `_preserveProgressBeforeReap` | coordinator.mjs | 8740–8801 |
| `captureCommit` | worktree.mjs | 1194–1244 |
| `reserveMany` capacity floor check | worktree-capacity.mjs | 399–402 |
| `projectTypedTerminalCause` | application-semantics.mjs | 2219–2242 |
| `DISPATCH_REFUSAL_GUIDANCE` | application-semantics.mjs | 2185–2204 |
| `RETRYABLE_KINDS` | production-convergence-state.mjs | 231–240 |
| `collectRunViews` retryable check | production-convergence-state.mjs | 264–271 |

---

## VIII. Test execution

The required execution contract passes on this base:

```
node --test impl/test/capacity-refusal-visibility-red.test.mjs
# tests 6 / pass 6 / fail 0
```

These six tests cover pre-dispatch capacity refusal visibility (CAP-V1 through CAP-V6). They
are cited as evidence for what they test and nothing beyond that. The gaps named in §II-C,
§III, and §V are not covered by existing targeted tests; INV-B and INV-C name proposed
contracts for those gaps.
