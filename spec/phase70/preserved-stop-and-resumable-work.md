# Phase 70 — preserved stop and resumable work

Status: acceptance-red until every numbered contract below is implemented, adversarially tested,
projected through the unified application surface, and recursively exercised by Baton itself.

Recursive Phase 69 dogfood exposed a lifecycle defect more serious than an awkward command: Baton
stopped a correct, independently green worker at a deployment resource boundary, confirmed the
provider process was gone, and then deleted the only worktree and branch containing the edits. The
worker could not make an early commit because its sandbox could not write the linked Git
administration directory. A safety policy may refuse further provider work; it may not silently
turn resource enforcement into data loss.

## PS1 — exact stop barrier

A destructive stop has three ordered phases: fence and stop the provider, prove the exact owned
transport/process generation closed, then preserve and clean local resources. Baton never snapshots
while an agent can still write. A kill acknowledgement is not close authority. A deadline that
cannot prove process closure retains the worktree and runtime exactly as today; it cannot claim
preservation, reaping, or confirmed cleanup.

The rule applies to operator Run stop, deployment budget enforcement, provider-governance stops,
watchdog kills, shutdown, and recovery cleanup whenever a live task-owned worktree could contain
unaccepted progress. An absent worktree or a task that never acquired local authority is an explicit
no-progress case, not an error.

The same barrier applies when the provider transport has already closed before a kill waiter can be
armed. Crash/exit cleanup and host-signal drain must pass through preservation before removing either
the private runtime lease or the worktree; they may not call a generic closed-transport reap that
bypasses this contract. A preservation failure keeps both authorities and leaves drain/shutdown red
and retryable.

## PS2 — hub-owned progress checkpoint before reap

After exact close and before worktree removal, the Coordinator asks the deployment-owned worktree
authority to capture the task checkout. The worker is never required or trusted to write Git refs,
the index, or an early commit. Capture uses the physical owner, expected path, base, branch, sparse
identity, harness, orchestrator-selected model, and per-task model effort already pinned to the task.

If the captured commit differs from the task base, Baton pins it under the deterministic checkpoint
namespace, resolves the ref back to the exact commit, durably records `worktree.progress_checkpointed`,
and only then reaps the worktree and task branch. The checkpoint is immutable, replayable, and bound
to the stop cause and capture evidence. If no commit differs from base, Baton records bounded
`no_progress` evidence and may reap without manufacturing a checkpoint.

Capture, pin, resolution, or durable-record failure blocks worktree deletion. The stop reports
`preservation_failed`, retains local authority, and exposes a cleanup attention item. Emergency
paths prefer retained residue over unrecorded data loss.

## PS3 — preservation is not acceptance

A progress checkpoint is never an accepted result. It cannot satisfy verification, semantic review,
adoption, integration, export, publication, push, route learning, or knowledge promotion. Operator
stop remains cancelled; a policy hard-stop remains failed with its typed terminal cause. The ordinary
result may say that work was preserved, but never that it was correct.

The internal checkpoint ref and SHA remain evidence-depth coordinates. Outline depth exposes only
`work preserved`, the stop reason, cleanup state, and the next semantic action.

## PS4 — idempotent replay and response loss

Restart reconstructs the exact progress checkpoint and preservation state from immutable evidence.
It postchecks the checkpoint before advertising recovery. Replaying a confirmation, retrying cleanup,
or losing the stop response cannot create another snapshot, another checkpoint identity, or a second
terminal transition. A missing or substituted ref conflicts closed and retains attention.

## PS5 — one resumable application action

When preserved progress and the approved Goal/Plan remain current, the Run outline offers one
`resume_work` action. The caller supplies only a bounded reason. Baton derives the checkpoint,
repository, Plan node, base, route policy, and recovery lineage; creates a fresh owned worktree at
the preserved commit; and starts a new task under orchestrator-selected harness, model, and model
effort. It never silently defaults effort to `low`.

The caller never handles a Git ref, SHA, worktree path, harness command, provider credential, token
budget, byte limit, file-count limit, or export ceiling. Exact route selection remains available to
the orchestrator as harness/model/effort; it is not conflated with the harness adapter. A resumed
candidate must pass the normal fresh verifier and downstream gates before acceptance.

`run.recover` and `run.act` are one application cascade, not competing recovery systems: the
application selects native session reattachment for an attachable interrupted session and preserved
work restoration for a terminal checkpoint. Contextual help explains the selected branch.

## PS6 — resource policy is deployment policy, not agent ceremony

Ordinary objective-first invocation contains no budget, provider-turn, export-byte, file-count,
filesystem-root, or lifecycle tuning arguments. Deployment policy may retain bounded safeguards,
but Baton derives and enforces them internally. Hard-stop decisions name the exact accounting metric
and distinguish billable/new provider usage from context-throughput or cached-input telemetry. Baton
must not repeatedly charge a cumulative counter as a delta or kill useful work on an ambiguous
metric.

Model effort is selected per task by the orchestrator alongside the model. Profiles may constrain
eligible effort values, but no global or harness-owned `low` fallback decides all work.

## PS7 — progressive operator projection

Outline depth says what stopped, whether work was preserved, whether cleanup completed, and the
recommended action. Section depth explains the stop/capture/reap sequence and accounting metric.
Item depth identifies the task and recovery lineage. Evidence depth carries checkpoint coordinates,
event order, runtime/process closure receipts, and cleanup receipts. Every surface has contextual
help; ordinary output contains no secret, private path, Git ref, raw budget ledger, or provider wire
payload.

## PS8 — recursive and concurrent acceptance

Acceptance proves:

1. dirty uncommitted edits and worker-authored commits survive operator, budget, watchdog, and
   shutdown kills after exact process closure;
2. capture precedes checkpoint pinning, which precedes worktree/branch reap;
3. preservation failure retains the worktree and cannot report confirmed cleanup;
4. preserved work is non-adoptable until fresh verification;
5. replay and response loss reconstruct one checkpoint and one terminal transition;
6. `resume_work` restores the exact commit without caller coordinates and uses an
   orchestrator-selected harness/model/effort route;
7. a live recursive Baton run crosses a resource stop, reports preservation plainly, resumes, and
   completes without provider, worktree, branch, verifier, or runtime residue; and
8. concurrent Grok workers can be stopped, exactly reaped, and independently resumed without
   cross-worker checkpoint or process attribution.

No homelab integration is part of this phase.
