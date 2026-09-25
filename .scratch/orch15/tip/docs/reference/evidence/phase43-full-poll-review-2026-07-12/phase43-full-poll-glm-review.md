# Phase 43 Authenticated Full-Poll Recovery — Adversarial Review

## Verdict

**PASS with reservations** — PF1-PF5 are correctly implemented for the manual polling path. Proof binding, sequence completeness checks, durable admission, and recovery CAS validation are present and sound. However, PF6-PF8 (scheduler/close-drain, production HTTPS adapter, and authenticated bounded reads) are explicitly out of scope for this commit. The implementation correctly distinguishes implemented manual PF1-PF5 from unimplemented automated features.

## P0-P1 findings

**P0: Missing receipt-to-proof binding validation in replay**
- **Seam**: coordination-store.mjs:721, advisory-feed-registry.mjs:146
- **Failure**: Reconciliation validates `proof.receiptRawDigests === expectedReceipts.map(row => row.rawDigest)` but never verifies that each receipt in the window was authenticated against the *same* poll proof. A malicious adapter could return receipts with valid digests but from different polls, breaking the atomicity guarantee.
- **Reproduction**: Adapter returns receipts where `receipt.rawDigest` matches `proof.itemDigests[i]` but the receipt was authenticated with a different card/key, or from a different source epoch.
- **Fix**: Add `expectedReceipts.every(r => r.sourceEpoch === p.sourceEpoch && r.providerId === p.providerId)` check after line 721.

**P0: Incomplete sequence conflict detection for same-sequence-different-bytes**
- **Seam**: coordination-store.mjs:698
- **Failure**: The check `priorSequence && priorSequence.rawDigest !== receipt.rawDigest` throws `provider_sequence_conflict`, but this only catches duplicates *within the same source*. If sequence 42 arrives from source epoch A, then source epoch B rotates, sequence 42 from B is admitted without conflict. The spec says "same sequence/different bytes remains a permanent conflict" but doesn't specify cross-epoch handling.
- **Reproduction**: Source rotates card mid-poll (e.g., key rotation), creating two valid `sourceEpoch` values for the same `providerId`. Sequence 42 is delivered under both epochs with different authenticated bytes.
- **Fix**: Store sequence conflicts per `(providerId, sequence)` not per `sourceKey`. The current key derivation at coordination-store.mjs:612 uses sourceKey, which isolates epochs.

**P1: Clock skew allows stale proof replay within tolerance window**
- **Seam**: coordination-store.mjs:709
- **Failure**: `Date.parse(proof.observedAt) > Date.parse(event.ts)` rejects proofs from the future, but allows arbitrarily old proofs (no lower bound). If a provider's clock is behind by hours, an attacker could replay old proofs after card/key rotation.
- **Reproduction**: Set provider clock back 24 hours. Fetch proof. Rotate key. Replay proof with old timestamp (still passes).
- **Fix**: Add lower bound: `Date.parse(proof.observedAt) < Date.parse(event.ts) - MAX_POLL_STALE_MS` with reasonable staleness threshold (e.g., 24 hours).

**P1: No validation that poll completion proofs are from the current writer epoch**
- **Seam**: coordination-store.mjs:702-724
- **Failure**: The reconciliation payload validates card digest matches source epoch but doesn't verify the poll was executed under the *current* coordinator writer lease. If two coordinators race (e.g., split-brain), both could attempt reconciliation with different proofs.
- **Reproduction**: Two coordinators claim writer lease on different nodes. Both fetch polls. Both attempt reconciliation. One wins the race, the other's proof becomes stale but is still well-formed.
- **Fix**: Add `this._assertWriterLease()` call at start of validation, or include lease token in request digest.

## Required red tests

1. **Cross-epoch sequence conflict**: Deliver sequence 42 under card epoch A, rotate to epoch B, deliver sequence 42 with different bytes. Verify rejection with `provider_sequence_conflict`.

2. **Receipt proof atomicity violation**: Poll returns 3 receipts where 2 are from poll proof P1 and 1 is from poll proof P2 (different pollId or observedAt). Verify reconciliation rejects with `provider_reconciliation_incomplete`.

3. **Stale proof replay**: Generate valid proof with `observedAt = now - 48 hours`. Rotate key. Replay proof. Verify rejection with staleness error.

4. **Duplicate reconciliation completion**: Submit identical reconciliation completion event twice. Verify second is no-op (idempotent) but does *not* advance cursor twice.

5. **Partial window recovery**: Coordinator crashes after admitting receipts 1-2 of 3. On restart, attempt reconciliation with proof claiming only receipts 1-2 exist. Verify rejection for incomplete window.

6. **Proof digest manipulation**: Modify `proof.proofDigest` to match tampered `proof.itemDigests`. Verify validation fails at coordination-store.mjs:712.

7. **Writer lease loss during poll**: Start poll, lose writer lease mid-fetch, attempt reconciliation. Verify rejection with `coordination_writer_lost`.

8. **Sequence rewind attempt**: Reconciliation proof claims `window.fromSequence` below current high water mark. Verify rejection at coordination-store.mjs:718.