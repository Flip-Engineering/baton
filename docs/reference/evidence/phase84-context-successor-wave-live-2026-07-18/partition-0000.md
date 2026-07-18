# Phase 84 context successor wave review

## High — Failed or cancelled tasks cannot record resource release

`_validateTaskResourceReleasePayload` rejects a release unless `task.status === 'completed'`, before it examines the supplied cleanup proof. That excludes failed and cancelled terminal tasks even though they can have the same process, worktree, runtime, session, and local-authority resources that the remainder of this validator requires to be absent or closed. A valid policy-authored `resource.worker_cleanup_attested` record for such a task therefore cannot populate `_taskResourceReleases`; the cleanup normalizer shown later reads that map by child task ID, so durable cleanup truth is missing precisely on unsuccessful stop paths.

This restriction is not needed to protect result settlement. In the same partition, Context map child settlement separately requires a terminal task, then rejects every status other than `completed`, and additionally requires accepted commit and verification artifacts. Cleanup authority can therefore admit `TERMINAL.has(task.status)` while retaining the existing task version, terminal event, assignee, operational-evidence, lifecycle, digest, actor, and idempotency checks. That preserves exact result truth while allowing failed and cancelled tasks to prove that they were reaped.

Source: immutable partition `context-partition:8f6cb3110b2eef66891b0a206129b8de2f300db9ec53a9c0fc36c89c2a0bd103`, `impl/src/coordination-store.mjs`, chunk 28.
