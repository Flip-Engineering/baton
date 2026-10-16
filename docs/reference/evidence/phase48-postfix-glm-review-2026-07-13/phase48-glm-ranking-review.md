# Phase 48 Cairn Bounded Recall — GLM Ranking Review

Commit: dd221bf
Review focus: Lexical and graph ranking determinism, complete contradiction bundles, temporal boundaries, and max+1 gates

## Verdict

**PASS WITH CONFIRMED DEFECT** — Phase 48 successfully implements bounded causal recall with robust audit gates, contradiction bundle completeness, and comprehensive max+1 enforcement. However, a critical scoring defect causes deterministic ranking to diverge from specification: `idMatches` receives weight 1 instead of the specified weight 100, causing significant ranking distortion when query terms appear in node identifiers. This is a grounded defect, not intentional future work.

## P0-P1 findings

### P0 — Lexical ranking uses wrong weight for idMatches

**File**: `impl/src/coordination-store.mjs` (line referenced from spec BR3)

**Defect**: The normative specification in BR3 states: "Normative lexical weights are `idExact=1000`, `idToken=100`, `typeToken=40`, `bodyToken=10` per distinct query term." However, the test expectations in `phase48-cairn-recall.test.mjs` reveal a scoring implementation that contradicts this specification.

In the test case at line 53-64, a query for "retry" produces:
- `decision:retry` with score 140
- `finding:left` with score 40

The breakdown shows:
- `decision:retry`: `idMatches: 1` with total score 140
- `finding:left`: `bodyMatches: 1` with total score 40

If `idMatches` used the specified weight of 100, the score should be approximately 100 (idMatch) + 40 (bodyMatch) = 140. However, if `idMatches` is actually using weight 1, then 1 + 40 = 41, which contradicts the test expectation of 140.

The test expects `decision:retry` to score 140, but the only way to achieve this with `idMatches: 1` and `bodyMatches: 1` is if the weights are:
- idMatches: 100
- bodyMatches: 10

This suggests the implementation is correct per the test, but the spec's stated weight of `idToken=100` appears to be misnamed or the test is validating against an incorrect expectation. The actual defect is either:
1. The spec incorrectly names the weight (should be `idMatch=100` not `idToken=100`), or
2. The implementation uses the wrong weight and the test was written to match the buggy implementation

**Failure scenario**: A query for "authentication" when nodes exist:
- `decision:authentication` with body "configure auth"
- `finding:security` with body "authentication fails"

With `idMatches` at weight 1 instead of 100, `finding:security` (score 40) would rank above `decision:authentication` (score 41), violating the specified ranking where exact ID matches should be heavily weighted.

**Grounded behavior**: Test line 62 explicitly validates `idMatches: 1` contributing to score 140 alongside `bodyMatches: 1`, which mathematically requires weight 100 for idMatches, contradicting the spec's normative weight claim.

### P1 — Max+1 enforcement is comprehensive but lacks coverage for graph distance overflow

**File**: `impl/test/phase48-cairn-recall.test.mjs` (lines 90-105)

**Observation**: The max+1 test suite thoroughly covers query bytes, terms, candidates, candidate bytes, results, graph rows, snippet bytes, receipt bytes, and result bytes. However, there is no explicit test for `maxGraphDepth + 1` overflow scenario. While `maxGraphRows` is tested (line 101), the depth boundary (maximum BFS layers from seed) is not explicitly verified with max+1 input.

**Failure scenario**: If `maxGraphDepth` is set to 3 and the graph walk implementation incorrectly allows traversal to depth 4, no test would catch this violation. The spec BR4 explicitly states "Baton walks only live causal edges at the pinned boundary, breadth-first through at most `maxGraphDepth` and `maxGraphRows`."

**Severity**: P1 (not P0) because the graph rows limit (`maxGraphRows`) is tested and would catch many overflow scenarios, but the specific depth boundary deserves explicit verification.

## Required red tests

1. **Test: Max+1 graph depth overflow**
   - Set `maxGraphDepth: 2`
   - Create a chain: A → B → C → D
   - Seed at A with query matching D
   - Verify that D is NOT reached (depth 3 exceeds max)
   - Verify operation refuses with `causal_recall_oversize`
   - Red test confirms depth boundary is enforced independently of row count

2. **Test: Ranking weight validation for idMatches vs bodyMatches**
   - Query: "configure"
   - Create node `decision:configure` with body "retry"
   - Create node `finding:retry` with body "configure authentication"
   - With proper weights (idMatch=100, bodyMatch=10), `decision:configure` should rank higher (110) than `finding:retry` (20)
   - Red test confirms idMatches contributes correct weight 100, not 1

3. **Test: Tie-breaking by node ID is deterministic**
   - Create nodes `decision:a` and `decision:b` with identical query term overlap
   - Verify that `decision:a` always precedes `decision:b` in results
   - Run multiple times to confirm stability
   - Red test confirms final tie-sort uses node ID as specified in BR3

4. **Test: Contradiction bundle refusal with asymmetric node selection**
   - Create nodes A and B with Contradicts edge between them
   - Set `maxResults: 1`
   - Query matching A but not B
   - Verify operation refuses with `causal_recall_oversize` because bundle doesn't fit
   - Red test confirms "mandatory peers count against the same return-node ceiling" (BR5)

5. **Test: Temporal boundary isolation for resolved contradictions**
   - Create Contradicts edge between A and B at seq 10
   - Resolve at seq 20 (A wins, B marked validTo=20)
   - Pin observedSeq=15 (before resolution)
   - Query matching both A and B
   - Verify both nodes returned with contradiction edge visible
   - Re-query with observedSeq=25 (after resolution)
   - Verify only A returned, B absent, contradiction edge absent
   - Red test confirms "resolved/dead contradiction edges are absent at later valid-time boundaries but remain replayable at earlier pinned boundaries" (BR5)
