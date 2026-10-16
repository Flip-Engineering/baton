## Verdict

**CONDITIONAL PASS** — Phase 48 implements bounded recall with audit gating and idempotency, but three P0-P1 findings weaken temporal integrity guarantees. The system correctly gates recall on critical audit violations, refuses incomplete contradiction bundles, and preserves deterministic ranking for recall operations. However, route advice (BR2 temporal boundaries) lacks audit gating and explicit stale-observation refusal, and max+1 overage handling for contradiction bundles may be overly restrictive.

## P0-P1 findings

### P0: Route advice violates BR2 pinned-audit-gate requirement

**File:** `impl/src/cairn-run-scorecard.mjs:96-116`

**Defect:** The `_routeAdvice` method fails to pin a coordination observation sequence before route generation and does not run the Phase 47 bounded audit gate. While it calls `this.coordination.routeObservations()` and validates `observedAt` is not earlier than the latest durable observation (line 109), this temporal check is insufficient. A later `coordinationUpperBound` observation could invalidate the route weights, and there is no `criticalViolations` check like `_recallAudit` (line 186-190). This contradicts BR2: "Every invocation pins one existing coordination observation sequence before ranking and runs the Phase 47 bounded audit at that exact boundary."

**Evidence:** Lines 110-111 call `this.routeAdvisor.advice()` without `_recallAudit` coordination gate. The method computes `coordinationUpperBound` from `observations.at(-1)?.eventSeq` (line 112) but does not validate the pinned boundary against current state or audit violations.

**Failure scenario:** Between `routeObservations()` snapshot and `advice()` computation, new route events arrive. The returned `coordinationUpperBound` and `selectedRouteKey` reference stale observations, causing non-replayable divergence. Worse, if the knowledge graph accumulated critical audit violations after the observation but before advice generation, route advice would silently succeed with contaminated state.

**Fix required:** Pin `observedSeq` via request argument (default to `snapshot().lastSeq`), call `_recallAudit(upper)` before `advice()`, and refuse with stale-audit-boundary if `observations.at(-1)?.observedAt < observationTime(upper)`.

### P1: Contradiction bundle max+1 handling may be overly restrictive

**File:** `impl/test/phase48-cairn-recall.test.mjs:68`

**Defect:** The test at line 68 refuses with `causal_recall_oversize` when `limit: 1` for a query matching two nodes in a contradiction bundle. However, the spec BR5 says "if a complete bundle does not fit, the operation refuses." The implementation appears to refuse based on `limit < 2` for the bundle rather than allowing the caller to specify `limit: 2` and fit both nodes. If this is enforced at the policy ceiling level, legitimate queries with `limit: maxResults - 1` would be incorrectly refused when they only need one additional slot for the mandatory peer.

**Evidence:** Test expects `causal_recall_oversize` for `limit: 1` with contradiction (line 68). This is correct only if `maxResults: 1`. If `maxResults: 16` (default policy), refusing `limit: 2` would violate the spec's allowance for up-to-limit requests.

**Ambiguity:** Without seeing the coordination store implementation, it's unclear whether this is a test-only issue or a product defect. The spec says "Mandatory peers count against the same return-node ceiling; if a complete bundle does not fit, the operation refuses." This suggests the check is against `limit` (caller request), not `maxResults` (deployment ceiling). If the implementation enforces at ceiling level, it's a P0 product defect.

**Fix required:** Clarify whether overage refusal is at `limit` or `maxResults` level. If at `maxResults` level, the refusal condition is correct. If at `limit` level, the test may be underspecified.

### P1: Deterministic ranking lacks explicit weight implementation

**File:** `impl/src/cairn-run-scorecard.mjs:223-233`

**Defect:** The `_causalRecall` method delegates ranking logic entirely to `coordination.previewKnowledgeRecallBounded` and `coordination.recallKnowledgeBounded` (lines 231-232). The scorecard does not implement or validate the normative weights specified in BR3: `idExact=1000`, `idToken=100`, `typeToken=40`, `bodyToken=10`, and graph score `max(1, 30 - 5 * distance)`. Without explicit implementation in the scorecard, the determinism guarantee depends entirely on the coordination store's correctness.

**Evidence:** Lines 231-232 make coordination calls without weight validation. The test at line 52-55 verifies `Number.isSafeInteger(node.score)` but does not verify the exact weight formula. The spec says "Ranking is integer-only and deterministic: exact node-ID, node-type, body-token, and graph-distance components have specified stable weights."

**Risk:** If the coordination store implementation uses floating-point scores, embedding services, wall-clock time, or non-deterministic term extraction, the ranking would violate BR3's determinism requirements. The scorecard layer should validate returned scores match the specified formula.

**Fix required:** Implement or mock the weight formula in `_causalRecall` and verify coordination store scores match. Add adversarial tests for term extraction normalization, Unicode handling, and tie-breaking by node ID.

## Required red tests

### 1. Route advice temporal boundary refusal

```javascript
test('BR2: route advice refuses when observationAt predates pinned boundary', async () => {
  const store = new CoordinationStore(root('stale-route'), { clock: clock() });
  const capability = cairn(store, {}, { maxTraceRows: 64, maxTraceDepth: 4 });
  const earlierObservedAt = store.observationTime(store.snapshot().lastSeq);
  // Inject a later route observation
  const later = store.addKnowledgeNode({ id: 'later', type: 'Finding', grounding: 'verified', body: 'later', evidence: [] }, { actor: 'policy', key: 'later' });
  const request = { taskType: 'causal-recall', candidates: [], observedAt: earlierObservedAt };
  await assert.rejects(() => capability.invoke('route.advice', request, ctx()),
    (error) => error.code === 'stale_route_advice');
});
```

### 2. Contradiction bundle limit vs ceiling distinction

```javascript
test('BR5: contradiction bundle fits when limit ≤ maxResults even at maxResults-1', async () => {
  const store = new CoordinationStore(root('bundle-limit'), { clock: clock() });
  const g = graph(store, { contradiction: true });
  const capability = cairn(store, { maxResults: 2 });
  const observedSeq = store.snapshot().lastSeq;
  // limit=2 fits both nodes of the bundle within maxResults=2
  const result = await capability.invoke('causal.recall',
    { text: 'duplicates', limit: 2, observedSeq, reader: {} }, ctx());
  assert.equal(result.payload[0].nodes.length, 2);
  assert.equal(result.payload[0].contradictions.length, 1);
});
```

### 3. Deterministic ranking weight formula

```javascript
test('BR3: ranking uses exact integer weights and deterministic tie-breaking', async () => {
  const store = new CoordinationStore(root('ranking'), { clock: clock() });
  graph(store);
  const capability = cairn(store);
  const result = await capability.invoke('causal.recall',
    { text: 'retry idempotent', limit: 10, observedSeq: store.snapshot().lastSeq, reader: {} }, ctx());
  // Verify term-id matches score 1000 per query term
  const idNode = result.payload[0].nodes.find(n => n.id === 'finding:left');
  assert.equal(idNode.score, 1000 + 100 + 10, 'idExact + idToken + bodyToken for exact ID match');
  // Verify deterministic ordering by node ID for ties
  const ids = result.payload[0].nodes.map(n => n.id);
  assert.deepEqual(ids, [...ids].sort(), 'nodes ordered by ID for equal scores');
});
```

### 4. Cross-platform transport parity

```javascript
test('BR9: direct, web, and MCP recall produce byte-identical results', async () => {
  // Extend existing test at line 120-137 to verify projectionDigest match
  // Verify that transport-specific field stripping (refs.path) yields identical public claims
  const direct = await driver.coordinator.invokeCapability('cairn', 'causal.recall', args, ctx());
  const web = await web.execute(...).body.result;
  const mcp = await mcp.handle(...).result.structuredContent;
  assert.equal(direct.payload[0].projectionDigest, web.payload[0].projectionDigest);
  assert.equal(direct.payload[0].projectionDigest, mcp.payload[0].projectionDigest);
});
```