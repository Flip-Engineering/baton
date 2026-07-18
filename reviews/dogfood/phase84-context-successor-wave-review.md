# Phase 84 context successor wave review — partition 1/2

Reviewed source: `impl/src/coordination-store.mjs`, immutable context partition `4e1e11b7032db8c1fc074acf1c2755a052edaa5c390da76b055521b177d21653` (chunk 28, bytes 344064–356352, digest `95eb86fe25cca7e22ca8e0e9fb468f4fb29adff4328054613c8cc8f52d6ac3ff`). No claims below depend on source outside that partition.

## Finding: process cleanup proof is not bound to the released task

`_validateTaskResourceReleasePayload` exactly binds the cleanup attestation itself to the completed task, worker, run, version, and terminal event. Its process-lifecycle check is weaker. For a process state other than `not_started`, it requires only `closed` or `absent_after_restart`, an integer `terminalSeq`, one of two terminal kinds, a terminal row of that kind for the same worker, and no later `lifecycle.process_started` row. It never binds that terminal row to `task.id` or `task.runId`, and never compares the release's `generation`, `pid`, or `processGroupId` with the referenced terminal row. Unlike the `not_started` branch, it does not even require those identity fields to be non-null or well-typed.

Consequently, a policy-authored cleanup attestation for task B can cite a qualifying terminal record belonging to a different process/task on the same worker (or declare null/invented process identity), provided the worker prefix has no later start. The validator accepts this in both live validation and integrity replay because `integrity` changes only the error type. `_normalizeContextMapCleanupReceipt` then treats the resulting entry in `_taskResourceReleases` as an “exact durable resource release”; that receipt can flow into the accepted child rows as `cleanupDigest` and `resourceRelease`. Context-map settlement can therefore record zero remaining descendants without durable proof that B's process was actually reaped.

## Required correction

For `closed` and `absent_after_restart`, require a complete, typed process identity and prove that the referenced terminal record targets the same task/run and the same generation/PID/process-group tuple. A recovery-absence record must carry an equally exact target binding. Reject any mismatch during both admission and integrity replay before inserting the release into `_taskResourceReleases`; only then may cleanup receipt normalization count that task toward `remainingCount: 0`.
