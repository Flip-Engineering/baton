# Phase 84 context successor wave review — partition 1/2

Scope: only `context-partition:2849ffdd96095d8bb79f9622ca343564d2cc47e53e0e85bf240583ce6412fdcd` (`impl/src/coordination-store.mjs`, bytes 344064–356352, content digest `253d3588d18075ebb2f10f6531e391aede6b838c590c48595f55324de32a842d`).

## Finding: `not_started` cleanup can conceal an unclosed process

Severity: high — cleanup/settlement overclaim.

`_validateTaskResourceReleasePayload` reads and sequence-checks the complete operational prefix, but when `release.process.state === 'not_started'` it validates only that `generation`, `pid`, `processGroupId`, `terminalKind`, and `terminalSeq` are null. It never rejects a matching earlier `lifecycle.process_started` row in that prefix. The stricter lifecycle search and terminal pairing run only in the other branch.

Consequently, a policy cleanup attestation with a valid digest, all cleanup checks set to true, and a null `not_started` process record is accepted even if the durable prefix already says that the same worker/task/run started a process and contains no matching close or recovery-absence event. The accepted release is stored as exact resource-release truth; `_normalizeContextMapCleanupReceipt` then treats its presence as an exact durable release, allowing Context map cleanup and child settlement to overclaim a leaked process.

Fix: derive `not_started` from the operational prefix rather than trusting the attested label. Reject that state if the prefix contains any `lifecycle.process_started` for the release's worker, task, and run. If a matching start exists, require the existing `closed`/`absent_after_restart` path to bind the latest generation to a valid later terminal event and reject a later matching restart. Add refusal and integrity-replay coverage for a complete prefix containing `process_started` followed by a forged `not_started` cleanup attestation, and ensure Context map cleanup cannot settle from it.
