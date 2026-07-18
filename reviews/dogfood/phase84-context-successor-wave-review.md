# Phase 84 context successor-wave review

Reviewed only `context-partition:e5cbf0fafd390db77d018e6ad8ed3a3688a3d0973a6fedacea73144a71912528` (`impl/src/coordination-store.mjs`, bytes 344064–356352; content digest `95eb86fe25cca7e22ca8e0e9fb468f4fb29adff4328054613c8cc8f52d6ac3ff`).

## P1 — Resource-release proof does not bind the terminal process to the released task

`_validateTaskResourceReleasePayload` treats every process state other than `not_started` as proved when the state is `closed` or `absent_after_restart`, `terminalSeq` is an integer, `terminalKind` names either accepted terminal event, and the referenced operational row has that kind and worker with no later `lifecycle.process_started` row. The shown validation never requires `generation`, `pid`, or `processGroupId` to be non-null or well-typed in these states, never compares those fields with the referenced terminal row, and never checks that the terminal row belongs to the release's `taskId` or `runId`.

Consequently, a policy-authored cleanup attestation for completed task T on worker W can claim arbitrary (including null) process identity and point `terminalSeq` at an allowed terminal event for some other process on W. If no process-start row follows that coordinate and the remaining receipt fields are valid, every shown check passes. The authority and digest checks only prove who attested to those bytes and that the bytes stayed unchanged; they do not prove that T's exact process closed.

This false release can propagate into settlement: `_normalizeContextMapCleanupReceipt` trusts the stored release and binds only its worker, event, digest, and mapped evidence into each target. It can therefore accept `remainingCount: 0` and an “exact descendant union” even though the referenced operational terminal did not establish release of the descendant's process. The context-map child row then publishes that cleanup digest and resource-release target, preserving a digest of the overclaim rather than exact cleanup truth.

Require each non-`not_started` state to carry a complete typed process identity, require the referenced terminal row to match the same task, run, generation, PID, and process group, and restrict each state to its corresponding terminal event semantics before recording the release. The later-start check should be scoped to that same bound resource identity.
