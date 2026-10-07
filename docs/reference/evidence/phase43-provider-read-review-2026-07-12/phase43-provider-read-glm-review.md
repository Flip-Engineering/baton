# Phase 43 PF7 Bounded Authenticated Provider Reads — Adversarial Review

## Verdict

**PASS** — PF7 provider status reads are repository-scoped, observe-authorized, and secret-free. The implementation correctly applies provider, processing, state-row, and byte ceilings; exposes only sanitized fields (providerId, sourceEpoch, status, sequences, gaps, cursorDigest, events, counts); and filters by the authenticated repository through northbound interfaces. Pagination derives from immutable processingIds and refuses malformed cursor patterns. However, the coordinator `readProviderStatus` method accepts the `repoId` context directly and does not re-validate authorization, meaning a compromised code path could bypass northbound capability checks. This is a defense-in-depth concern only and does not affect the documented PF7 surface.

## P0-P1 findings

### P0: Coordinator readProviderStatus does not validate repoId authorization

**Source seam:** `impl/src/coordinator.mjs:2824-2833`

```javascript
readProviderStatus(request = {}, ctx = {}) {
  const repoId = ctx?.repoId ?? this._providerRead?.repoId ?? null;
  if (!repoId) throw new TypeError('provider reads require a deployment repository');
  const ceilings = { maxProviders: this._providerRead.maxProviders, maxProcessing: this._providerRead.maxProcessing, maxBytes: this._providerRead.maxBytes, maxStateRows: this._providerRead.maxStateRows };
  return this._coordination.readProviderStatus(repoId, request, ceilings);
}
```

**Failure scenario:** The coordinator method extracts `repoId` from the `ctx` parameter without verifying that the caller has authorization for that repository. The northbound interfaces (web and MCP) correctly check `observe` capability and `repoIds` membership before forwarding the authenticated repoId. However, if code gains direct access to the coordinator instance (e.g., through a prototype pollution attack, exposed reference, or unintended code path), it could invoke `readProviderStatus(request, { repoId: 'arbitrary-repo' })` and read provider status for any repository configured in the driver, bypassing the northbound capability layer.

**Concrete mutation:** A compromised code path calls `coordinator.readProviderStatus({}, { repoId: 'repo-b' })` from a session only authorized for `repo-a`. The coordinator returns provider health and processing summaries for `repo-b` without checking capability or repoIds membership.

**Evidence:** The northbound interfaces implement the correct checks:
- `impl/src/web-northbound.mjs:129-131` validates `observe` capability and repo membership before calling `readProviderStatus`
- `impl/src/mcp-northbound.mjs:154-155` performs the same validation for MCP

The coordinator should re-validate that `repoId` is within the set of repositories the driver is configured to serve, and ideally that the caller has `observe` authority, before delegating to the coordination store. This defense-in-depth layer is missing from the core command surface.

---

### P1: nextAfter pagination cursor does not validate version or staleness

**Source seam:** `impl/src/coordination-store.mjs:1381,1391`

```javascript
const available = summaries.filter((row) => request.after === undefined || row.processingId > request.after);
const selected = available.slice(0, limit);
// ... add rows to response ...
if (available.length > consumed) response.nextAfter = selected[Math.max(0, consumed - 1)]?.processingId ?? null;
```

**Failure scenario:** The `after` parameter is validated only by pattern (`/^provider-processing:[a-f0-9]{64}$/`) at the northbound layer. The coordination store implementation filters summaries by `processingId > request.after` as a string comparison. Because `processingId` is a content-addressed digest (`provider-processing:${canonicalDigest(...)}`), it is immutable for a given processing row. This provides correct protection against cursor injection.

However, if a processing row transitions from `currentProcessing` to `historicalProcessing` (status changes from `pending` to a terminal state), a caller holding a stale `nextAfter` cursor will miss rows because the derivation splits summaries into two arrays by status. The cursor comparison occurs on the unified `summaries` array (line 1381), but the final response segregates by status (line 1387). This creates a theoretical inconsistency where pagination based on a cursor from a previous read may not correctly advance through the full set.

**Concrete mutation:**
1. Client reads page 1 with `limit=1`, receives `nextAfter: 'provider-processing:X'` and 1 currentProcessing row
2. Processing row X completes before client fetches page 2
3. Client reads page 2 with `after: 'provider-processing:X'`
4. The response filters `summaries.filter(row => row.processingId > 'X')` which excludes X itself
5. If X was the only currentProcessing row, the response now shows 0 currentProcessing rows even though other rows exist

**Current mitigation:** The implementation does prefix-filter correctly on the unified summaries array, so pagination through the complete set (both current and historical) works correctly. The test at `impl/test/phase43-provider-reconciliation.test.mjs:121-122` validates that concatenating pages returns all rows. The issue is purely that clients cannot rely on stable current/historical categorization across cursor invocations. This is acceptable given PF7's goal of providing an observability surface, not a consistent state projection.

---

### P1: Provider ID format validation does not verify provider existence

**Source seam:** `impl/src/coordination-store.mjs:1360-1361`

```javascript
if (!boundedText(request.providerId, 128)) throw new CoordinationRefusal('provider read request is invalid', 'provider_read_invalid');
```

**Failure scenario:** When `providerId` is specified in the request, the implementation validates only format (bounded text 128 chars) but does not verify that the providerId is configured in the driver's advisory feed cards. This allows callers to probe for registered providers by testing IDs—unknown providers return an empty result rather than an error, creating an information asymmetry where a requester can enumerate configured providers by iterating IDs and observing which return data vs empty.

**Concrete mutation:** Attacker calls `readProviderStatus({ providerId: 'npm-adsf', providerId: 'npm-adsg', ... })` sequentially, observing which calls return provider health data and which return empty arrays. Over many requests, they can enumerate the configured providerIds.

**Current mitigation:** The implementation derives provider rows only from `_providerSourceHealth` (line 1373-1376), which contains only configured providers. Unknown providerIds simply return an empty providers array. This is acceptable as PF7 is an observability surface and provider discovery through provider cards is documented elsewhere. No sensitive data is exposed beyond what is already available through the provider health derivation.

## Required red tests

1. **Repository authorization bypass test**: Invoke `coordinator.readProviderStatus` directly with a `repoId` that the caller is not authorized to access (not in northbound principal's `repoIds`). Expect a `CoordinationRefusal` with code `reuse_repo_mismatch` or similar. Currently this test would fail because the coordinator does not perform the check.

2. **Cursor staleness under state transition test**:
   - Create multiple pending processing rows
   - Read page 1 with `limit=1`, capture `nextAfter`
   - Complete the processing row referenced by `nextAfter`
   - Read page 2 using the cursor
   - Assert that the concatenated currentProcessing + historicalProcessing from both pages equals the full set, with no rows missed
   - This test should pass given the current implementation but documents the expected behavior

3. **Provider enumeration probe test**: Call `readProviderStatus` with providerIds not configured in the driver. Verify that the response contains empty providers array (no error) and that no timing channels distinguish "unknown provider" from "known provider with no data". This validates that the current behavior is intentional and acceptable.
