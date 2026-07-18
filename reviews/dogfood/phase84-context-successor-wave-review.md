# Phase 84 context successor wave review

Reviewed only immutable context partition `54ccf2cc9210e9786339043e3172346e5a77a6f0e35cff900b55e18001f3c4d8` (`impl/src/coordination-store.mjs`, bytes 344064–356352).

## Finding

### [P1] Bind process cleanup proof to the released task and process

`_validateTaskResourceReleasePayload` accepts a non-`not_started` process release after checking only that `terminalSeq` selects a row with the claimed terminal kind and worker and that no later `lifecycle.process_started` row exists. It never checks that the selected terminal row belongs to the released `taskId`/`runId`, and it never compares the row's generation, PID, or process-group identity with `release.process.generation`, `pid`, or `processGroupId` (those three fields are not even required to be non-null in this branch). Consequently, a policy cleanup attestation for a completed task can cite an eligible terminal row for another process on the same worker and carry arbitrary process identity while still producing a durable task resource release. `_normalizeContextMapCleanupReceipt` then treats that release as an exact descendant target and accepts `remainingCount: 0`, allowing Context map settlement to overclaim cleanup.

Require the cited terminal row to match the release's task, run, generation, PID, and process group (with exact types and state-appropriate nullability), and bind recovery-absence evidence to that same identity before recording the resource release.
