# Phase 84 context successor wave review

Scope: only `impl/src/coordination-store.mjs` bytes 344064–356352 from `context-partition:d884fac5f12d55a3a9ecf83580ee587e0c9b5fc658e2a010fd2e0f6bca5c1bf8` (content digest `95eb86fe25cca7e22ca8e0e9fb468f4fb29adff4328054613c8cc8f52d6ac3ff`).

## High — resource-release replay is not bound to the task's process lifecycle

`_validateTaskResourceReleasePayload` loads the operational prefix through the mapped cleanup attestation, but its `process.state === 'not_started'` branch only requires `generation`, `pid`, `processGroupId`, `terminalKind`, and `terminalSeq` to be `null`. It never rejects an applicable earlier `lifecycle.process_started` row. A completed task whose prefix contains a start and no close can therefore be represented as never started and pass this branch.

The alternative branch is also under-bound: the cited terminal row is checked only for the supplied sequence, an allowed terminal kind, and the same worker. The validator does not compare the terminal row with the release's `taskId`, `runId`, `generation`, `pid`, or `processGroupId`. Consequently, a close/absence event for a different process on the same worker can satisfy the proof, provided no later `lifecycle.process_started` row appears after the cited sequence.

This is not contained to an informational record. `_normalizeContextMapCleanupReceipt` treats the resulting `_taskResourceReleases` entry as an exact durable release and verifies only the stored release event/digest/evidence tuple. The child settlement row then incorporates that cleanup receipt. Replay can thus preserve digest consistency while settling a Context map with false process-cleanup truth, potentially hiding an unreaped descendant process.

Required correction: validate `not_started` against the operational prefix, and bind every start/terminal lifecycle row used for cleanup to the exact task, run, and process identity in the release. Reject a release if an applicable start lacks its matching task-bound terminal evidence; then let cleanup receipt normalization consume only that stronger result.
