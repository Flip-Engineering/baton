# Phase 43 Ed25519/startup-CAS/sequence-health adversarial review

Commit: dc96948

## Verdict

**CONDITIONALLY PASS** — The shipped slice correctly implements Ed25519 SPKI fingerprint derivation, synchronous private-CAS replay on startup, and sequence conflict detection. However, three P0-P1 findings exist: (1) missing test coverage for Ed25519 base64 encoding edge cases, (2) incomplete sequence gap recovery semantics, and (3) absent replay authority mutation coverage. These are defects in this slice, not production HTTPS or cursor reconciliation work.

## P0-P1 findings

### P0: Ed25519 base64 signature validation accepts malformed encodings

**Source**: `impl/src/hmac-advisory-webhook.mjs:97-98`

The `_validSignatureEncoding` method for Ed25519 signatures has insufficient validation:

```javascript
_validSignatureEncoding(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 64 && bytes.toString('base64') === value;
}
```

**Defect**: The regex permits base64 strings without proper padding. While the length check catches the 64-byte requirement, a malformed signature like `ABC...XYZ` (missing `=` padding) with 64 decoded bytes would pass the final round-trip check, but an attacker could craft signatures that decode to 64 bytes with incorrect padding that still round-trip correctly on some Node.js versions.

**Failure scenario**: A crafted malformed base64 string that decodes to 64 bytes and round-trips could bypass signature validation, allowing arbitrary unsigned payloads.

**Evidence**: `impl/test/phase43-ed25519-webhook.test.mjs:27-35` tests wrong key and body substitution but not malformed base64 encodings with incorrect padding.

### P1: Sequence gap recovery cannot restore "healthy" status

**Source**: `impl/src/coordination-store.mjs:654-659`

```javascript
if (highSequence !== null && p.receipt.sequence > highSequence + 1) {
  status = 'reconciliation_required';
  firstGap ??= { from: highSequence + 1, to: p.receipt.sequence - 1 };
}
else if (highSequence !== null && p.receipt.sequence < highSequence) {
  status = 'reconciliation_required';
  firstGap ??= { from: p.receipt.sequence, to: p.receipt.sequence };
}
```

**Defect**: Once a source enters `reconciliation_required` status, there is no code path to restore it to `healthy`. Line 130 in the test confirms this: `assert.equal(store.providerSourceHealth(...).status, 'reconciliation_required', 'late fill cannot silently assert source health')`. This means after a single gap or out-of-order delivery, the source is permanently marked unhealthy even after bounded polling reconciles all missing sequences.

**Failure scenario**: A transient network glitch causing sequence 2 to arrive before sequence 1 permanently marks the source as `reconciliation_required`, requiring manual intervention or source epoch change to restore health status, even after sequence 1 arrives and the gap is filled.

**Evidence**: `impl/test/phase43-provider-receipts.test.mjs:129-131` explicitly tests that late fill cannot restore health, but this appears to be a design defect rather than intentional behavior per AF7 which states gaps "schedule bounded full polling" but doesn't specify permanent health degradation.

### P1: Replay authority validation omits critical mutation vectors

**Source**: `impl/src/coordination-store.mjs:622-628`

```javascript
if (integrity && this._loading === true && ['hmac-sha256', 'ed25519'].includes(card.auth?.scheme)) {
  if (typeof this._advisoryReceiptReverify !== 'function')
    fail('native provider receipt requires private CAS replay before readiness', 'provider_cas_replay_required');
  const replayReceipt = { /* ... */ };
  let reverified;
  try { reverified = this._advisoryReceiptReverify(replayReceipt); } catch (error) {
    throw integrity ? new CoordinationIntegrityError('native provider receipt private CAS replay failed', error?.code ?? 'provider_cas_invalid') : error;
  }
  if (reverified && typeof reverified.then === 'function')
    fail('native provider receipt replay must be synchronous', 'provider_cas_replay_required');
  if (canonicalDigest(reverified) !== canonicalDigest(replayReceipt))
    fail('native provider receipt private CAS replay diverged', 'provider_cas_invalid');
}
```

**Defect**: While this validates private CAS replay, it does not validate that the replay receipt contains the exact same authentication metadata. An attacker who can tamper with the private CAS store (or if there's a bug in CAS storage) could substitute the raw bytes while preserving the digest, and the replay would succeed with mismatched authentication evidence.

**Failure scenario**: If private CAS stores bytes that hash to the same digest but have different content (collision attack) or if CAS is tampered with, the replay would accept the substituted bytes without verifying that the authentication receipt (authReceiptDigest, keyFingerprint, sequence, etc.) matches the replayed content.

**Evidence**: `impl/test/phase43-hmac-webhook.test.mjs:80-84` tests byte substitution detection but only for the raw body, not for authentication receipt field validation during replay.

## Required red tests

1. **Ed25519 malformed base64 signatures** (P0): Test base64 strings with missing padding, extra padding, whitespace, URL-safe characters, and mixed encodings to ensure all are rejected with `provider_auth_invalid`.

2. **Sequence gap health restoration** (P1): Test that after a gap is detected and filled via bounded polling, the source health can be restored to `healthy` if all sequences are present and no conflicts exist. If this is not the intended behavior, add a test documenting that `reconciliation_required` is permanent and requires source epoch change.

3. **Replay authentication receipt validation** (P1): Test that replay rejects receipts where the authentication metadata (keyFingerprint, authReceiptDigest, sequence, deliveryId) has been tampered with, even if the raw CAS bytes and digest match.

4. **Concurrent key rotation during receipt replay** (P0): Test that if a source epoch changes between receipt storage and replay (key rotation), the replay fails with appropriate error rather than accepting the receipt under the wrong key.

5. **CAS digest collision** (P0): Test that if private CAS returns bytes with the same digest but different content (simulated collision), replay rejects with `provider_cas_invalid` rather than accepting the substituted bytes.

6. **Sequence rewind detection on replay** (P1): Test that on store reload, if the sequence tracking shows a lower highSequence than previously observed (indicating tampering or corruption), the store fails to load rather than silently accepting the rewind.