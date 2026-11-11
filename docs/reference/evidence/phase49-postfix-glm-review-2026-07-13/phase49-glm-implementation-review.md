# Phase 49 GLM Implementation Review

Reviewed commit: fd8cc0c  
Spec: `spec/phase49/cairn-selective-promotion.md`  
Implementation: `impl/src/coordination-store.mjs`, `impl/src/cairn-run-scorecard.mjs`, `impl/src/capability-registry.mjs`, `impl/src/web-northbound.mjs`, `impl/src/mcp-northbound.mjs`  
Tests: `impl/test/phase49-cairn-promotion.test.mjs`

## Verdict

**REVISE** — One P0 vulnerability requiring immediate fix before production use. Multiple P1 issues require documentation clarification or defensive hardening.

## P0-P1 findings

### P0: Verified outcome liveness check bypass (SP3, SP5 violation)

**File**: `impl/src/coordination-store.mjs`, lines 2078-2079

**Defect**: The verified outcome query does not filter for `validTo` null, allowing promotion of Scratch facts based on invalidated or superseded verification outcomes.

```javascript
const verifiedOutcomes = new Map(nodesAtBoundary.filter((node) => 
  node.type === 'Finding' && node.grounding === 'verified' && 
  node.promotion?.trigger === 'verified_task_outcome' && 
  typeof node.taskId === 'string' && !node.validTo  // Missing check for invalidated edges
  && edgesAtBoundary.some((edge) => edge.type === 'VerifiedBy' && edge.from === node.id && edge.to === `task:${node.taskId}`))
  .map((node) => [node.taskId, node]));
```

**Failure scenario**: 
1. Task A completes with verified outcome Finding F1
2. Contradiction resolution invalidates F1 (sets `validTo` to resolution event)
3. Later, Scratch fact S is read by Task A and another completed task
4. Promotion uses invalidated F1 as "verified outcome" evidence
5. `VerifiedBy` edges reference dead Finding, violating SP5 requirement that endpoints be live

The query correctly excludes nodes with `validTo` set, but does not verify that the `VerifiedBy` edge itself remains valid (no `edge.validTo`). A contradiction resolution that invalidates the Finding should also invalidate its verification edges, but the code doesn't check edge liveness.

**Root cause**: `edgesAtBoundary.some(...)` only checks edge existence, not edge validity. Should also filter for `!edge.validTo`.

**Impact**: Violates SP5 "If a required endpoint is absent, non-live, mismatched, or outside the prefix, the entire batch refuses."

### P1: Driver actor authority bypass (SP1, SP3 violation)

**File**: `impl/src/coordination-store.mjs`, lines 77, 2094

**Defect**: `promotionActor()` accepts any string starting with `operator:`, allowing forged driver events with actors like `operator:forged:malicious` to create Decision candidates.

```javascript
function promotionActor(value) { 
  return value === 'orchestrator' || (typeof value === 'string' && value.startsWith('operator:')); 
}
```

**Failure scenario**: If a worker can inject a `driver.recorded` event with `actor: 'operator:web:bob:malicious'`, the promotion code would accept it as a valid Decision source because `promotionActor()` only checks the prefix.

**Mitigation**: Driver event recording should validate actors, but this is not shown in the reviewed code. The spec SP3 says "where the event actor is `orchestrator` or `operator:*`" but the implementation accepts the prefix check as sufficient.

**Impact**: Low - requires driver code compromise or lack of driver validation. Should harden to exact `operator:*` format check or whitelist.

### P1: `sourceDigest` implementation detail leakage (SP4, SP8 violation)

**File**: `impl/src/coordination-store.mjs`, lines 2086, 2108

**Defect**: The `sourceDigest` field is included in the public projection, exposing internal implementation state (full event serialization digest) rather than staying within "closed identifiers/digests" bounds.

**Spec requirement SP4**: "Candidates retain only closed identifiers/digests, source kind and sequence, grounding, evidence references, and a fixed implementation-authored body. It never copies raw... or arbitrary driver fields."

The `sourceDigest` field leaks the internal coordination event serialization, which is not a "closed identifier" but an implementation artifact.

**Impact**: Information disclosure. Should document this as deliberate or remove from projection.

### P1: Cancellation window after preflight (SP6, SP8 violation)

**File**: `impl/src/coordination-store.mjs`, lines 2159-2161

**Defect**: ACI preflight accepts the projection, but cancellation is not checked between preflight completion and event append, allowing a race where cancellation during final validation leaves the batch partially validated.

```javascript
if (beforeAppend) { 
  const before = this._events.length; 
  beforeAppend(freeze({ projection: clone(projection), jsonBytes: Buffer.byteLength(JSON.stringify(projection)) })); 
  if (this._events.length !== before) throw new CoordinationRefusal(...); 
}
const fixedTs = this._clock(); 
const predicted = { ...prospective, ts: fixedTs }; 
this._validateKnowledgePromotionPayload(payload, predicted, false);  // No cancellation check
const event = this._append('knowledge.promotion_batch', payload, auth, fixedTs);
```

**Mitigation**: `_validateKnowledgePromotionPayload` should check `ctx.signal?.aborted` at entry, as other operations do.

**Impact**: Low - narrow window. But violates SP8 "Any refusal leaves no effect" for cancellation signals during final validation.

### P1: Transport normalization lacks validation (SP1, SP8 violation)

**File**: `impl/src/cairn-run-scorecard.mjs`, lines 288-290

**Defect**: Transport normalization accepts malformed actors without validating format, allowing `operator:web:bob` or `operator:mcp:alice:` with incorrect colon count.

```javascript
const promotionActor = ctx.actor === 'orchestrator' || (typeof ctx.actor === 'string' && ctx.actor.startsWith('operator:'))
  ? ctx.actor : (typeof ctx.actor === 'string' && (ctx.actor.startsWith('web:') || ctx.actor.startsWith('mcp:'))) 
    ? `operator:${ctx.actor}`  // No format validation
    : null;
```

**Failure scenario**: If a web request somehow has `actor: 'web:bob:extra:colon'`, it would normalize to `operator:web:bob:extra:colon` which bypasses the intended format.

**Mitigation**: Should validate that web actors are `web:{userId}:{sessionId}` and MCP actors are `mcp:{userId}:{sessionId}` before normalization.

**Impact**: Low - requires caller compromise. But format validation is defense-in-depth.

### P1: No-op ACI preflight bypass (SP8 violation)

**File**: `impl/src/cairn-run-scorecard.mjs`, lines 300-302

**Defect**: No-op results skip the preflight size check, allowing a no-op projection to exceed result bytes when cached and replayed.

```javascript
if (promoted.noOp && ctx?.aciOutputPolicy && ...) {
  // Only checks if promoted.noOp is true
  throw typed('causal promotion result exceeded ACI publication ceiling', 'capability_result_oversize');
}
return result;
```

But in `_promotionResult`, the no-op case creates the projection before the check, and the check only applies if `promoted.noOp` is true. A replayed no-op from an earlier batch (without ACI context) could return a projection that exceeds current ACI limits.

**Impact**: Low - no-op projections are typically small. But violates ACI preflight intent.

## Required red tests

1. **Verified outcome liveness bypass**: Create a task with verified outcome, invalidate it via contradiction resolution, then attempt to promote a Scratch fact read by that task. Should refuse with `causal_promotion_conflict` or endpoint validation failure.

2. **Driver actor authority**: Inject a `driver.recorded` event with `actor: 'operator:notvalid:format'` and verify promotion refuses it (or document that driver validation prevents this).

3. **Cancellation after preflight**: Send a cancellation signal during the window between `beforeAppend` callback and `_append` call. Verify operation refuses with no effect.

4. **Transport format validation**: Attempt promotion with malformed web/MCP actors (wrong colon count, empty segments) and verify refusal before normalization.

5. **No-op ACI bypass**: Replay a historical no-op promotion result with current ACI policy limits lower than the cached projection size. Verify refusal or size validation.

6. **Edge liveness in reverify**: Tamper with a promotion batch event by invalidating a referenced Finding node (set validTo) and verify reverify fails.

7. **Max+1 ceilings**: Test each limit (scan, candidates, bytes, evidence, batch, result) at exactly limit+1 with valid candidates. Verify refusal with unchanged tail.

8. **Race condition on promotion overlap**: Run two concurrent promotions for overlapping prefixes from different actors. Verify idempotency conflict handling and no partial promotion.

9. **Cross-repository Scratch exclusion**: Create Scratch facts with different `repoId` in `envRef` and verify they are excluded from promotion regardless of grounding.

10. **Derived Scratch quarantine**: Create a derived Scratch fact and verify it cannot create Finding candidates even if read by completed tasks with verified outcomes.