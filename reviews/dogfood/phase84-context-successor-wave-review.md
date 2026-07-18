# Phase 84 context successor wave review — partition 1/2

Scope: immutable `impl/src/coordination-store.mjs` chunk 28, bytes 344064–356352, content digest `d076a6321cd827ebc3a8b2862d3c7c973e4ee68dbff9afaaa84fb35fae00c418`.

## Finding: cleanup validation confuses unrelated process lifecycles on one worker

**Severity: High — cleanup/settlement denial and integrity replay failure**

`_validateTaskResourceReleasePayload` reads the full operational prefix for `payload.workerId`, but its two decisive `lifecycle.process_started` scans are not scoped to the released task or run. The pre-terminal lookup uses `findLast` on `row.kind` alone and only afterward demands that the selected row belong to `task.id` and `task.runId`. The post-terminal lookup similarly rejects when *any* later row has that kind, without checking its task, run, generation, PID, or process group.

Consequently, exact evidence for task A is rejected if the same worker's prefix contains a start for task B either between A's start and terminal record (the wrong row wins `findLast`) or between A's terminal record and cleanup attestation (the unscoped tail scan fires). In normal validation this becomes `task_resource_release_invalid`; during integrity validation the same false conflict becomes `task_resource_release_integrity`. A worker therefore cannot safely interleave or begin successor work before the prior task's cleanup attestation, even when A's own process lifecycle is fully closed. Context-map cleanup cannot truthfully settle that child because `_normalizeContextMapCleanupReceipt` depends on the resulting task resource-release record.

Scope both scans to `payload.workerId`, `task.id`, and `task.runId`, and match the recorded generation/process identity where applicable. Then only a restart of the released task's process can invalidate its release; unrelated successor lifecycle rows remain preserved as independent truth.
