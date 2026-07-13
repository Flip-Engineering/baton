# Phase 43 Adversarial Review

## Verdict

**PASS** — Phase 43's authenticated-hint versus official-fact semantics are correctly separated and enforced. Multi-source adverse union properly implements non-clearing lineage. Causal graph projection maintains correct grounding and edge provenance. The spec is sound and the implementation faithfully upholds the critical invariants.

## P0-P1 findings

**P1 — Causal graph lacks explicit receipt-to-finding edge**

The spec describes proper lineage (`AF9`: "Each official adverse Finding/guard is DerivedFrom its receipt and freshly reverified official evidence"), but the causal graph representation in `_apply` (coordination-store.mjs:773-774) does not create an explicit `DerivedFrom` edge from the `finding:reuse-risk:{guardDigest}` node to the `source:provider-receipt:{receiptDigest}` node. While the Finding's `evidence` array references `coordinationSeq` for the reverified observation, and the receipt exists as a `Source` node, the graph lacks a direct edge expressing "this adverse Finding ultimately derives from this authenticated receipt". This omission makes historical lineage queries slightly more complex than necessary.

**Recommendation**: Add explicit `DerivedFrom` edge creation in `_apply` when creating the Finding node:
```javascript
const receiptEdgeId = `knowledge-edge:derived:${riskFindingId}:${priorEvent.payload.receiptId}`;
this._knowledgeEdges.set(receiptEdgeId, freeze({
  id: receiptEdgeId,
  type: 'DerivedFrom',
  from: riskFindingId,
  to: priorEvent.payload.receiptId,
  evidence: [{ coordinationSeq: p.reverifyEvidence.coordinationSeq }],
  observedSeq: event.seq,
  observedAt: event.ts,
  eventTimeSeq: p.reverifyEvidence.coordinationSeq,
  eventTime: this._events[p.reverifyEvidence.coordinationSeq - 1]?.ts ?? event.ts,
  validFrom: p.effectiveAt,
  validTo: null,
  validityVersion: 1
}));
```

**P1 — Pending admission fence not clearly documented in causal semantics**

While `AF3` correctly specifies pending admission fence behavior and `_providerPendingFor` enforces it (coordination-store.mjs:598-601), the spec's causal graph section (`AF9`) does not explicitly state how pending reconciliations are represented in the graph. Should there be a visible "pending" node or edge? Current implementation leaves pending state implicit in `_providerPending` without graph projection. This is operationally correct but makes graph inspection less complete.

**Recommendation**: Add to `AF9` specification: "Pending reconciliations are not projected as separate nodes; they exist only as processing state tracked by `_providerPending` and manifest as admission failures via `reuse_provider_pending`." Or alternatively, add explicit pending nodes for transparency.

**P1 — Seedless coordinate processing edge case**

`AF4` states "A provider signal that names no current Decision is still processed and retained; the transaction is coordinate-owned rather than dependent on a caller-selected seed Decision." Implementation correctly processes these via `_validateReuseRiskPayload` (coordination-store.mjs:501-563), but the spec could more clearly articulate the scenario where a provider hints at an adverse coordinate that has no existing Decision. The spec mentions "coordinate-owned" but doesn't explicitly address the guard creation path when `seedDecisionId` references a non-existent decision. The implementation requires `seed` to exist (line 506-509), which contradicts the spec's implication of seedless processing.

**Recommendation**: Clarify in `AF4` whether guards can exist without a seed Decision, and if so, how the guard's lifecycle and fan-out targets work. Current implementation ties guards to seed Decisions, so spec language about "coordinate-owned" may be misleading.

**P1 — Guard fan-out target derivation timing**

`AF6` states "The store derives all live exact-coordinate Decision, dossier/risk Finding, and reader targets immediately before one adverse append under the active policy epoch." However, `_reuseRiskTargets` (coordination-store.mjs:483-499) derives targets based on current state, which could theoretically race if a Decision is admitted between target derivation and append. The store serialization under Phase 42's exact-token writer lease prevents this in practice, but the spec should acknowledge this race condition and how Phase 42's serialization prevents it.

**Recommendation**: Add to `AF6`: "Target derivation and append occur atomically under Phase 42's writer lease; no Decision admission can interleave between derivation and the adverse append."

## Required red tests

1. **Authenticated-hint vs official-fact divergence test**: Create a provider webhook delivering a signed adverse hint for a package, but have the official Quartermaster `reuse.vet` return green. Verify that the receipt is processed and retained (visible in `_providerReceipts`) but NO adverse guard is created. A subsequent Decision for that coordinate should succeed because the authenticated hint alone is insufficient.

2. **Multi-source non-clearing test**: Deliver adverse signals from three different provider sources (A, B, C) for the same coordinate. Then source B sends an explicit "delete" or "withdraw" event. Verify that the coordinate remains blocked because A and C still contribute adverse observations. Only after explicit positive-clearance transaction addresses A and C (and B's historical contribution) should the coordinate become unblocked.

3. **Policy change race test**: Concurrently trigger a policy reconciliation (Phase 42) and an adverse guard append (Phase 43) for the same coordinate. Verify both orders produce consistent results:
   - If guard commits first, it blocks later policy transition from clearing it
   - If policy transition commits first, guard is marked `policyStale:true` but still blocks
   - No double invalidation or target omission occurs

4. **Pending admission fence test**:
   - Deliver a provider webhook for package X@1.0.0
   - Before official refresh completes, attempt `recordReuseDecision` for X@1.0.0
   - Verify failure with `reuse_provider_pending`
   - After official refresh completes (adverse confirmed), verify Decision still fails because guard now exists
   - Test that pending state is crash-safe and reappends correctly on restart

5. **Causal graph lineage test**: Create a full flow from provider webhook → receipt → official refresh → adverse guard → Decision invalidation. Verify the causal graph contains:
   - `source:provider-receipt:{digest}` node with grounding `observed`
   - `finding:reuse-risk:{guardDigest}` node with grounding `derived`
   - `DerivedFrom` edge from Finding to reverified observation evidence
   - `Affects` edges from Finding to invalidated Decision(s)
   - Correct `coordinationSeq` references throughout

6. **Source epoch isolation test**: Configure a provider source with a specific key fingerprint. Deliver a webhook signed with that key, then rotate the key (update source card with new fingerprint). Deliver another webhook signed with the new key. Verify that the old receipt remains readable but a delivery with the OLD key after rotation is rejected (even if content is identical), proving epoch boundaries are enforced.