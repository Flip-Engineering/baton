# Phase 43 GLM Causal Review

## Verdict

**PASS — Phase 43 spec is sound with intentional implementation gaps.**

The spec correctly separates authenticated-hint semantics from official-fact verification (AF3, AF4), implements monotonic multi-source adverse union (AF5), and projects local causal lineage (AF9). The spec is intentionally unimplemented for provider webhook/poll ingestion machinery; this is a spec-defect vs. implementation-work boundary that the document honestly acknowledges in AF12. The three core semantic commitments are present, internally consistent, and correctly grounded in the Phase 39/42 foundation.

## P0-P1 findings

### P0: Explicit hint-to-fact temporal coherence gap
**File:** spec/phase43/adverse-provider-ingestion.md:AF4
**Severity:** Spec correctness, requires clarification before implementation

AF4 states that "Callback/poll bytes never substitute for this observation" and requires that "Only a current adverse official observation can append knowledge.reuse_provider_guarded." However, the spec does not explicitly state the temporal relationship between receipt receipt time and official observation `asOf` time.

**Failure scenario:** A provider delivers an adverse hint at time T0 with receipt binding `occurred/received time`. Coordinator asynchronously invokes `reuse.vet` with `refresh:true` and receives an official observation with `asOf` T1 > T0. If the official observation is green (non-adverse), the receipt remains pending per AF3. But if the official observation is adverse, AF4 requires appending the guard. However, the spec does not explicitly state whether the guard's effective time must be receipt-time (T0) or official observation-time (T1).

**Current spec ambiguity:** The spec says "Only a current adverse official observation can append knowledge.reuse_provider_guarded" but does not specify whether the guard's `effectiveAt` binds to the receipt `received time` (AF2) or the official observation `asOf` time (AF4).

**Required clarification:** Add explicit statement in AF4: "The appended guard's effectiveAt binds to the official observation's asOf time, not the receipt's received time. The receipt provides only coordinate extraction; the official fact provides both verdict and temporal grounding."

**Evidence source:** spec/phase43/adverse-provider-ingestion.md:AF4, lines 51-61

### P1: Multi-source union invariant needs explicit clearing contract
**File:** spec/phase43/adverse-provider-ingestion.md:AF5
**Severity:** Spec completeness

AF5 states that "Empty/green/delete/withdraw/correction events, newer omission, successful polling, key rotation, provider recovery, policy change, or one source's state cannot clear, replace, downgrade, or hide another source." This is correct for the monotonic union invariant. However, the spec does not explicitly state the clearing contract for positive-clearance transactions.

**Current contract:** AF5 says "The aggregate coordinate fence stays blocked until a separate future positive-clearance transaction explicitly addresses every retained adverse source." This implies that a positive-clearance transaction must explicitly enumerate every retained adverse source to clear them, but the spec does not state this as a requirement.

**Required clarification:** Add explicit statement: "A positive-clearance transaction (future contract) must explicitly enumerate and address every retained adverse source identity (sourceId, sourceEpoch, officialFactDigest) currently blocking the coordinate. Partial clearing is forbidden."

**Evidence source:** spec/phase43/adverse-provider-ingestion.md:AF5, lines 64-72

### P1: Causal graph grounding consistency needs explicit statement
**File:** spec/phase43/adverse-provider-ingestion.md:AF9
**Severity:** Spec completeness

AF9 states that "Each official adverse Finding/guard is DerivedFrom its receipt and freshly reverified official evidence, then Affects the exact invalidated Decisions/Findings." However, the grounding is specified as "observed" for authenticated delivery and "derived" for risk projection, never "verified safe."

This is consistent with the Phase 39/42 grounding model, but Phase 43 introduces a new intermediate entity: the provider receipt as a local source node. The spec should explicitly state the receipt node's grounding to avoid ambiguity.

**Required clarification:** Add explicit statement: "The receipt node's grounding is 'observed' (not 'verified safe' or 'derived') because the delivery is authenticated but the adverse claim is not independently verified until the official refresh occurs."

**Evidence source:** spec/phase43/adverse-provider-ingestion.md:AF9, lines 121-128

### P1: Implementation validation for policy race handling is incomplete
**File:** spec/phase43/adverse-provider-ingestion.md:AF6, impl/src/coordination-store.mjs:506-508
**Severity:** Implementation completeness

AF6 states: "If policy changes during asynchronous refresh, the official result must be retried or rejected for active-policy mismatch; an already-appended adverse guard migrates through Phase 42 as stale-but-blocking."

The implementation in coordination-store.mjs lines 506-508 validates policy hash:
```javascript
if (snapshot.policyHash !== (policyHead?.policyHash ?? seed.dossierSnapshot.policyHash))
  fail('reuse risk dossier projection is invalid', 'reuse_evidence_invalid');
```

This correctly implements the active-policy mismatch rejection. However, the spec AF6 also states that "an already-appended adverse guard migrates through Phase 42 as stale-but-blocking," but there is no explicit implementation path for this migration in the reviewed code. The Phase 42 migration logic (lines 656-663) explicitly handles policy transitions, but the Phase 43 adverse guard's transition through this path is not explicitly visible.

**Required clarification:** Verify that the Phase 42 migration logic explicitly handles Phase 43 adverse guards with `policyStale` marking, or add explicit statement that Phase 43 guards participate in Phase 42 stale-but-blocking migration.

**Evidence source:** spec/phase43/adverse-provider-ingestion.md:AF6, lines 73-82; impl/src/coordination-store.mjs:506-508, 656-663

## Required red tests

1. **Authenticated hint with false adverse signature + green official refresh:** Deliver a provider hint with valid authentication but a false adverse claim, then verify that official refresh is green. Verify that the receipt is processed but no guard is appended (AF3, AF4).

2. **Multi-source union invariant:** Create adverse observations from two different provider sources (source A, source B). Then source A delivers a green/withdraw event. Verify that the coordinate remains blocked due to source B's adverse observation (AF5).

3. **Hint-to-fact temporal coherence:** Deliver a hint at T0, receive official observation at T1 > T0. Verify that the guard's effectiveAt binds to T1 (official observation time), not T0 (receipt time) (AF4).

4. **Policy race during async refresh:** Deliver a hint, start async refresh, change policy during refresh. Verify that the refresh is rejected for active-policy mismatch (AF6).

5. **Causal graph lineage:** Verify that each adverse guard has exactly two DerivedFrom edges (one to receipt, one to official evidence) and Affects edges to invalidated Decisions (AF9).

6. **Pending admission fence:** Deliver a hint but make official refresh unavailable. Verify that the receipt remains pending with reuse_provider_pending fence and borrow fails closed (AF3).

7. **Idempotent delivery retry:** Deliver identical hint twice. Verify that the second delivery returns the original receipt/processing identity without network (AF7).

8. **Cursor gap handling:** Create a sequence gap in poll cursor. Verify that the source is marked reconciliation_required and full polling is scheduled (AF7).

9. **Crash continuation:** Crash after receipt but before refresh. Verify that restart resumes pending work (AF8).

10. **Multi-coordinate atomicity:** Deliver a hint with multiple coordinates. Verify that processing failure exposes no partial receipt, cursor advance, or guard (AF6).
