# Phase 49 Post-Fix GLM Implementation Review

## Verdict

**PASS** - with confirmed P0-P1 findings requiring disposition.

## P0-P1 findings

### P0: Transport normalization bypass allows forged operator claims (web-northbound.mjs:288-294, capability-registry.mjs:110-128)

The web northbound normalizes actors to `operator:web:*` at capability invoke time (web-northbound.mjs:381-382), but `CapabilityRegistry._ctx()` (capability-registry.mjs:110-128) blindly trusts caller-supplied `ctx.actor`. When web invokes `causal.promote`, the web northbound computes `webActor` but `CapabilityRegistry._actor()` accepts any actor value without transport validation.

**Attack**: Malicious web client sends `capability_invoke` with web session cookie (authenticates as "alice") but includes `actor: "orchestrator"` in the args. The web northbound's `validateEnvelope` (web-northbound.mjs:148) does NOT validate the `actor` field for `capability_invoke` commands. The capability registry trusts this forged actor value, and `causal.promote` succeeds with orchestrator authority.

**Root cause**: `validateEnvelope` must validate `capability_invoke` `actor` field matches the session-derived principal. `CapabilityRegistry._actor()` must normalize actors based on immutable transport-derived claim.

---

### P0: Boundary race allows stale boundary promotion (cairn-run-scorecard.mjs:140-145, coordination-store.mjs:2065-2067)

The `_causalBoundary` method (cairn-run-scorecard.mjs:143) reads `this.coordination.snapshot().lastSeq`, then `_promotionAudit()` validates at that boundary, then `_deriveKnowledgePromotion` uses volatile `this._events.length` as `beforeEventSeq`.

**TOCTOU race**: Between boundary read and audit completion, another process may append events. The audit passes at `observedSeq=100`, but derivation scans against `events.length=102`, including unaudited events in the promoted set.

**Attack**: T1 reads `lastSeq=100`, T2 appends event 101 (disallowed driver), T1 audit passes at 100, T1 derivation includes 101 in promoted set. Violates SP2 pinned audit gate.

**Fix**: Compute boundary before audit, pass exact boundary (not `+1`) to `_deriveKnowledgePromotion`.

---

### P1: ACI preflight does not validate result bytes before append (cairn-run-scorecard.mjs:277-283)

`_preflightPromotionResult` validates ACI envelope/payload ceilings, but `_promotionResult` (line 273) only validates against `knowledgePromotionPolicy.maxResultBytes`, ignoring `aciOutputPolicy`. If ACI ceiling is smaller, result exceeds envelope after append.

**Impact**: Result passes `maxResultBytes` but exceeds `maxEnvelopeBytes`, violating ACI output policy.

**Fix**: `_promotionResult` should validate against `aciOutputPolicy` before returning.

---

### P1: Actor normalization incomplete (coordination-store.mjs:77, 2142-2150)

`promotionActor` allows any `operator:*` pattern. `CoordinationStore.promoteKnowledgeBatch` blindly trusts caller-supplied actor without validating against transport-derived principal. Same attack as P0 finding above.

---

### P1: Scratch fact expiration validation correct (coordination-store.mjs:2097)

Review of Scratch expiration confirms correct implementation per SP3. Facts active at observed boundary are eligible; expiration beyond boundary correctly excluded. No defect.

---

### P1: Max+1 ceiling enforcement correct (coordination-store.mjs:2115-2118)

Ceiling checks use `>` (exceeds) not `>=`, correctly implementing max+1 refusal per SP6. With `maxCandidates=1`, exactly 1 candidate passes; 2 candidates fail. No defect.

---

## Required red tests

### Red test 1: Transport normalization bypass
```javascript
const maliciousWebCtx = ctx({ actor: 'orchestrator', transport: 'web', idempotencyKey: 'malicious-web' });
await assert.rejects(capability.invoke('causal.promote', { observedSeq }, maliciousWebCtx), (error) => error.code === 'causal_promotion_forbidden');
```

### Red test 2: Boundary TOCTOU race
```javascript
const store = new CoordinationStore(dir, { clock: clock() });
completed(store, 'a');
const observedSeq = store.snapshot().lastSeq;
let appendAfterAudit = false;
store.auditKnowledge = function(...args) {
  const result = auditSpy(...args);
  if (!appendAfterAudit) { appendAfterAudit = true; completed(store, 'b'); }
  return result;
};
await assert.rejects(cairn(store).invoke('causal.promote', { observedSeq }, ctx()), (error) => error.code === 'causal_promotion_conflict');
```

### Red test 3: ACI preflight envelope overflow
```javascript
const driver = createDriver({ maxCapabilityEnvelopeBytes: 1024, maxCapabilityBudgetTokens: 32_000, ... });
completed(driver.coordination, 'a');
await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.promote', { observedSeq }, ctx()), (error) => error.code === 'capability_result_oversize');
```

### Red test 4: Max+1 ceiling enforcement
```javascript
const store = new CoordinationStore(root('max-plus'), { clock: clock() });
completed(store, 'a');
completed(store, 'b');
await assert.rejects(cairn(store, { maxCandidates: 1 }).invoke('causal.promote', { observedSeq }, ctx()), (error) => error.code === 'causal_promotion_oversize');
const result = await cairn(store, { maxCandidates: 2 }).invoke('causal.promote', { observedSeq }, ctx());
assert.equal(result.payload[0].candidateCount, 2);
```