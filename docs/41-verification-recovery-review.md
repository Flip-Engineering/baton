# Verification and contribution recovery

Reviewed 2026-09-13 against `a966bba6`. A Baton-managed Claude worker traced these paths;
root reviewed and revised the findings. This document describes existing behavior and proposed
corrections. It does not claim that the recovery changes below are implemented.

## Assessment

Baton needs to distinguish a rejected contribution from an unavailable verification environment.
Today a failure to create the verification sandbox can fail the task without producing a verifier
verdict, a useful terminal cause, or a checkpoint in the trust gate. Later cleanup can preserve
progress, but that is a separate operation which can also fail.

Recovery should address the retained contribution directly. Starting a fresh author session may
be useful for further edits; it should not be required merely to check an existing revision.
Independent members should continue while one contribution awaits infrastructure recovery.

## Existing behavior

The relevant functions are in [the coordinator](../impl/src/coordinator.mjs):
`_admitPauseRecord`, `claimTurn`, `_runTrustGate`, `_preserveProgressBeforeReap`, and
`_removeOwnedTaskWorktree`. References below describe the reviewed revision, rather than relying
on line numbers that change during implementation.

| Situation | Existing outcome | Evidence and limits |
| --- | --- | --- |
| Capacity refused before worker dispatch | Cancelled dispatch with typed `dispatch_refused` cause and retry guidance | The six `capacity-refusal-visibility` tests pass; they exercise this admission path |
| Verifier returns a diagnostic result | The gate can pin the captured revision as a checkpoint before recording failure | This depends on the verdict outcome and successful checkpoint retention; not every failed check guarantees a pinned result |
| Verification sandbox creation throws | The catch path records failure before a verifier verdict exists | It does not establish that the contribution failed a check; cleanup may later preserve progress |
| Preservation itself fails | Cleanup retains the workspace and reports failure | An attempted pin or reap is not evidence that either operation completed |

A pausable worker checkpoint does not automatically enter acceptance. `claimTurn` reserves the
pause, performs the liveness preflight, and invokes the gate. When the gate handles an error and
returns a failed task, the claim is consumed. Preflight refusal or an exception at a different
boundary can leave different outcomes. Do not assume every attempted claim consumes its pause.

Inside `_runTrustGate`, capture and scope/effect checks precede creation of a fresh verification
workspace. A capacity refusal at `createVerifyWorktree` occurs before `_referee` runs. In that
path:

- `trustPhase` still says `capture`, although capture may already have succeeded.
- The normal assignments to `task.capturedSha` and diagnostic checkpoint retention are not reached.
- The catch block's policy-code branch does not assign a typed cause for capacity exhaustion.
- The error log retains information, but the ordinary result does not provide the same recovery
  detail as a diagnostic verifier result.

[Terminal-cause projection](../impl/src/application-semantics.mjs) cannot derive a useful cause
from an absent one. This is missing guidance, not proof that the post-work path emits the
pre-dispatch retry advice. A new Run also does not delete an existing pinned ref; the concern is
that callers may start unrelated work without selecting the preserved contribution.

`_preserveProgressBeforeReap` attempts capture and checkpoint retention for eligible unaccepted
work. Its failure prevents successful reaping. A clean, already committed checkout can avoid
another snapshot commit, but retaining a checkpoint still needs a successful write. These source
paths do not by themselves establish which path a particular historical run took. Native run
receipts in [the runtime review](40-runtime-review-2026-09-12.md) remain the evidence for those runs.

## Proposed corrections

1. **Record the operation that failed.** Advance the gate phase before candidate sandbox setup,
   base sandbox setup, and verifier execution. Preserve the actual exception classification and
   whether any verifier started. Raw ENOSPC, pre-effect capacity refusal and uncertain partial
   materialization must not acquire the same retry authority merely because they share a symptom.

2. **Retain a contribution independently.** Once a specific revision has been captured, preserve
   its identity and the result of the pin attempt. A failed pin must remain visible with the
   workspace retained. A cleanup receipt must not imply accepted or durably retained work.

3. **Expose recovery information in the Run.** Distinguish an executed failed check, an
   unavailable check, and uncertain cleanup. Show the preserved contribution when one exists.
   Derive remediation from those facts; a single `retryable` boolean cannot identify what can
   safely be retried or which effect might already have occurred.

4. **Support verification without recreating the author.** Existing checkpoint-resume operations
   are relevant for further development. Add or reuse an operation that verifies a selected
   retained contribution against explicit acceptance requirements without requiring another
   provider turn. Keep its lifetime separate from the original pause and session.

These corrections need no universal DAG, automatic prompt, retry count, or timeout that declares
work failed. A subgroup can choose a barrier or retry policy while independent peers continue.
The existing concurrent wave observation behavior is useful evidence for peer independence;
it does not establish every future recovery interleaving.

## Acceptance evidence still needed

- Inject capacity refusal after successful capture and prove no verifier verdict is invented.
- Retain the exact revision where possible; separately inject pin failure and prove the workspace
  remains owned and recoverable.
- Recover infrastructure and verify the retained revision without requiring a new author turn.
- Interrupt or restart during reservation/materialization; reconcile the exact operation before
  issuing effects whose prior outcome is unknown.
- Exercise simultaneous claims, repeated recovery requests, cancellation, and close. Preserve
  the existing single-consumer claim contract without making legacy terminalization a permanent
  design requirement.
- Continue an unaffected peer through each failure, and verify preserved-contribution identity
  after restart using actual durable receipts.

The Baton-managed review passed its configured fresh-worktree dispatch checks. Those checks
validate the existing pre-dispatch contract; the scenarios above remain implementation work.
