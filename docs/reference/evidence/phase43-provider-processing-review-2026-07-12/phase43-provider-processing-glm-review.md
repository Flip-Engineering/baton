# Phase 43 Provider Processing GLM Review

## Verdict

**PASS** — The Phase 43 durable deferred official processing implementation correctly implements retry-window semantics, deterministic bounded backoff, due selection bounds, event identity and replay protection, race handling, cancellation and writer loss semantics, supervisor single-flight lifecycle, PF7 observation non-leakage, and restart continuation. No P0 or P1 findings identified.

## P0-P1 findings

None. The implementation demonstrates:

- **DP1 (retry-window semantics)**: `providerAttemptDelay()` at coordination-store.mjs:23-26 implements deterministic doubling backoff capped at `maxBackoffMs`. The attempt counter correctly resets on receipt change (test phase43-provider-reconciliation.test.mjs:200-201).

- **DP2 (bounded due selection)**: Due selection scans at most `maxStateRows`, returns at most `maxBatch` in stable ID order, and correctly filters by `nextAttemptAt` ≤ injected clock (test phase43-provider-reconciliation.test.mjs:233-245).

- **DP3 (sanitized deferral)**: Deferral payloads bind only closed failure codes from `PROVIDER_FAILURE_CODES`, sanitized actor/event time, and omit stack traces/credentials (coordination-store.mjs:742-757, test phase43-provider-reconciliation.test.mjs:198).

- **DP4 (race handling)**: New receipts clear `nextAttemptAt` making the root immediately due while retaining attempt history (test phase43-provider-reconciliation.test.mjs:200-201). Stale deferrals against changed CAS or completed roots correctly reject (coordination-store.mjs:750).

- **DP5 (replay integrity)**: Deferral replay rejects idempotency key mutations and policy digests (test phase43-provider-reconciliation.test.mjs:228-230). Changed policy refuses readiness rather than reinterpreting old events (coordination-store.mjs:745).

- **DP6 (supervisor lifecycle)**: `ProviderProcessingSupervisor` enforces single-flight scans (provider-processing-supervisor.mjs:39). CloseAsync aborts, awaits, then releases writer lease (index.mjs:379-383, test phase43-provider-reconciliation.test.mjs:96-105).

- **DP7 (PF7 non-leakage)**: Provider status reads expose only `attemptCount`, `lastFailureCode`, `nextAttemptAt` from a closed failure-code taxonomy. No raw errors, credentials, or internal stack traces leak (test phase43-provider-reconciliation.test.mjs:107-130).

- **DP8 (red/live gates)**: Tests cover exact policy, max+1 attempts, first/doubled/capped delays, due ordering/batch/state ceiling, failure sanitization, exact replay, receipt/completion races, append failure, lease loss, close during fetch, and restart continuation (phase43-provider-reconciliation.test.mjs:189-252, run.mjs:29-40).

## Required red tests

None required. Existing red test coverage in `impl/test/phase43-provider-reconciliation.test.mjs` is comprehensive for DP1-DP8 and the live evidence script `docs/reference/evidence/phase43-provider-processing-retry-2026-07-12/run.mjs` validates end-to-end durability across restarts.

Claims do not exceed evidence. The spec's DP1-DP8 commitments are fully satisfied by implementation and verified by adversarial test cases.