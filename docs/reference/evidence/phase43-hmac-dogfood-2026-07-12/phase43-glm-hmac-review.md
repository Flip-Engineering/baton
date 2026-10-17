# Phase 43 HMAC Webhook Adversarial Review

Commit: cdae0e5

## Verdict

The HMAC webhook slice is **structurally sound** but contains one **P0 timing-validation bypass** via `new Date(Date.parse()).toISOString()` roundtripping and several **P1 semantic gaps** around sequence/cursor gap handling and policy transition contamination timing. The core signing domain, duplicate detection, private-CAS binding, and replay honesty are correctly implemented. The machine/user authority separation is upheld via distinct actor prefixes and provider-scoped ingress.

## P0-P1 findings

### P0: Timestamp format roundtrip bypass allows malformed but parseable timestamps

**Location**: `impl/src/hmac-advisory-webhook.mjs:56`

The timestamp validation uses `new Date(occurredMs).toISOString() !== occurredAt` as its format check. However, `Date.parse()` accepts multiple formats (e.g., `'2026-07-13T04:00:00'` without milliseconds, `'2026-07-13T04:00:00.000+00:00'` with timezone) that ISO-8601 stringifies to different values. A crafted `'2026-07-13T04:00:00'` parses to `occurredMs`, then stringifies to `'2026-07-13T04:00:00.000Z'`, which **fails the strict equality check**, but the earlier `Number.isFinite(Date.parse(occurredAt))` guard passes, creating a timing ambiguity window where `occurredAt` in the signed domain differs from the canonicalized receipt timestamp.

**Concrete mutation**: Submit `occurredAt: '2026-07-13T04:00:00'` with valid signature over that non-canonical string. The HMAC domain includes the malformed value, but `occurredMs` is derived from the parsed value. The receipt stores the original `occurredAt` while `occurredMs` may be a different instant, creating a durable mismatch between the signed occurrence time and the effective window check.

**Fix**: Reject timestamps that are not already in exact ISO-8601 format (`toISOString()` shape) before parsing, or sign over the canonicalized form rather than the raw input.

### P1: Sequence gap detection does not fence further deliveries

**Location**: `spec/phase43/adverse-provider-ingestion.md:102` vs `impl/src/hmac-advisory-webhook.mjs:54`

The spec states "A sequence gap marks the source `reconciliation_required` and schedules bounded full polling; it is never reported healthy." However, the HMAC verifier accepts any `sequence` value (including gaps) and stores it in the receipt. No implementation exists to compare `sequence` monotonicity against prior deliveries from the same provider.

**Concrete mutation**: Send deliveries with sequence `[1, 5, 9]` (skipping 2-4, 6-8). Each delivery is accepted individually, but the source is never marked `reconciliation_required`. A compromised provider could deliver targeted advisories at sparse sequence numbers while hiding bulk deliveries in the gaps.

**Fix**: Track `lastSequence` per provider/source-epoch and fence on gaps before accepting new deliveries.

### P1: Policy transition contamination lacks clock-skew validation against target timestamps

**Location**: `impl/src/coordinator.mjs:462` in `_validateReusePolicyPayload`

The policy transition validates `eventAt < Date.parse(this._knowledgeNodes.get(target.nodeId)?.validFrom ?? '')` but does not account for `maxClockSkewMs`. If a guard's `validFrom` is slightly in the future due to clock skew, the policy transition may incorrectly reject the guard as "predating the transition" when it's actually within the acceptable skew window.

**Concrete mutation**: Create a guard with `asOf: '2026-07-13T04:00:01.500Z'` (500ms ahead due to skew), then attempt policy transition at `2026-07-13T04:00:01.000Z`. The check `eventAt < validFrom` fails despite the skew being within tolerance (if `maxClockSkewMs >= 500`).

**Fix**: Compare against `validFrom` adjusted by clock skew, or validate monotonicity rather than strict ordering.

### P1: Duplicate signature headers accept conflicting values in some edge cases

**Location**: `impl/src/hmac-advisory-webhook.mjs:49`

The duplicate header check throws `provider webhook headers are ambiguous` if a lowercased header name appears twice. However, the signature-specific validation only reads the **last** value for required headers (`signature`, `deliveryId`, `timestamp`, `sequence`). If duplicate headers slip through with different values, the last one wins silently for HMAC validation, while the earlier value is ignored.

**Concrete mutation**: Send `['x-baton-signature', 'valid_sig']` followed by `['x-baton-signature', 'invalid_sig']`. The current code throws on duplicate detection, but if a mutation bypassed the `Map` set collision (e.g., case-sensitivity exploit in the lowercasing path), only the last signature would be checked.

**Fix**: Explicitly count each expected header name and reject if count != 1, rather than relying on `Map.has` collision detection alone.

## Required red tests

1. **Timestamp roundtrip bypass**: Submit `occurredAt` values that are valid for `Date.parse()` but not exact `toISOString()` format. Verify rejection or prove the canonicalized form is used consistently in HMAC domain.

2. **Sequence gap enforcement**: Deliver sequences `[1, 5, 9]` from a single provider and verify the source enters `reconciliation_required` state after detecting gaps at 2-4, 6-8.

3. **Policy transition clock skew**: Create a guard with `asOf` 500ms in the future (within `maxClockSkewMs`) and verify policy transition accepts it when skew tolerance is applied.

4. **Duplicate signature header flooding**: Send two `x-baton-signature` headers with different values. Verify rejection with `provider_auth_invalid` (not ambiguous headers error).

5. **Private CAS substitution timing**: Race `privateCas.put()` completion against crash. Verify recovery replays the receipt and rejects divergent CAS content rather than accepting substituted bytes.

6. **Machine/user authority cross-contamination**: Attempt user-actor `operator:alice` signing provider webhook headers, and provider-actor `provider:fixture.secure` invoking user commands. Verify both fail with code `provider_auth_invalid`.

7. **Sequence zero-padding exploit**: Send `x-baton-sequence: '007'` and verify it's rejected (spec requires `sequenceText.length > 1 && sequenceText.startsWith('0')` → throw).

8. **Content-Encoding smuggling**: Add `['content-encoding', 'gzip']` header with uncompressed body. Verify rejection per spec "duplicate/conflicting...content-encoding...headers fail closed".

9. **Delivery ID semantic alias test**: Deliver same semantic coordinates with two different `deliveryId` values. Verify both are stored as distinct receipts (no silent aliasing).

10. **Zero-network replay tamper**: After storing a receipt, modify the underlying coordination stream (simulating tamper). Verify replay detects divergence via `provider_cas_invalid` rather than accepting tampered bytes.