# Phase 47 GLM Causal Review — 51217cf

## Verdict

**PASS with retained refinements**

Phase 47 correctly implements bitemporal observation boundaries, bounded causal trace with frontier accounting, contradiction resolution with contamination tracking, and independent audit across seven axes. The implementation respects deployment-pinned authority (CA1), validates replay integrity (CA2), and retains the full-system catalog explicitly (CA10). Three P0-P1 findings require confirmation as design intent rather than defects.

## P0-P1 findings

### P1: Typed earlier live lineage admits observed grounding without earlier evidence

**Location:** `impl/src/coordination-store.mjs:2248-2249`

The audit correctly verifies that `verified` Findings require `ProducedBy`/`VerifiedBy`/`DerivedFrom` lineage to earlier live sources. However, `observed` grounding Findings bypass this check entirely:

```javascript
const verifiedFindings = liveNodes.filter((node) => node.type === 'Finding' && node.grounding === 'verified');
const completeFindings = verifiedFindings.filter((node) => earlierEvidence(node) && liveEdges.some(...));
```

The specification (CA4) states: "A verified Finding requires earlier production/verification/derivation lineage" — and the implementation enforces this. Yet `observed` Findings with zero evidence are reported as causally complete despite the requirement that "node and edge types are closed; endpoints and referenced evidence must already exist" (CA2). This creates a causal completeness bypass: an `observed` Finding with no `Informed` edges and no evidence is both valid under CA2 and counted as complete under CA4.

**Contract seam:** CA2 requires "referenced evidence must already exist" for node creation, but the audit does not check whether `observed` Findings actually have evidence. The validation at lines 1976-1977 only requires evidence for `verified` Findings.

**Red test:** Create an `observed` Finding with empty evidence, no `Informed` edges, and verify that `causal.audit` either marks it as causally incomplete or rejects creation per CA2's evidence-must-exist rule.

**Status:** Requires confirmation whether `observed` grounding without evidence is intended as a valid "claim" node type or should be rejected as causally incomplete.

---

### P1: Bounded trace frontier may report false-complete at depth limit

**Location:** `impl/src/coordination-store.mjs:2198-2224`

The `traceKnowledgeBounded` function correctly tracks visited nodes, limits depth, and records a frontier for nodes encountered beyond `maxDepth`. However, completeness determination at line 2223 may be optimistic:

```javascript
return freeze({ ..., complete: frontier.size === 0, ... });
```

When `current.depth >= maxDepth`, the loop adds incident neighbors to the frontier (line 2213) but does **not** enqueue them. This is correct for bounded traversal. Yet the loop exits when the queue is empty, not when all frontier nodes are processed. A frontier with unexplored neighbors at maxDepth results in `complete: true` even though the trace did not visit those neighbors.

**Contract seam:** CA8 requires "bounded node/edge/evidence projections" and "explicit frontier metadata." The implementation provides frontier metadata but interprets an empty frontier as complete regardless of whether depth-limited exploration truncated the graph.

**Scenario:** A decision at depth 0 with `Supports` edges to 20 findings at depth 1. With `maxDepth: 1`, the trace visits the decision and one finding, then adds the remaining 19 findings to the frontier. On the next iteration, the queue is empty (depth 1 was the limit), the frontier contains 19 unvisited nodes, and the trace reports `complete: true`.

**Red test:** Construct a wide graph where maxDepth < graph diameter, verify that trace reports `complete: false` and non-empty frontier when unvisited nodes exist at the depth boundary.

---

### P1: Contradiction identity does not enforce endpoint validity at edge creation

**Location:** `impl/src/coordination-store.mjs:2004-2009`

The canonical contradiction ID construction (line 2005) correctly produces an unordered-pair digest. However, endpoint validity is checked against the current wall clock (`effective`), not the edge's `validFrom`:

```javascript
const effective = fields.validFrom ?? event.ts;
const lifecycleFields = ['validTo', 'resolvedBy', 'winnerId', 'loserId', 'resolutionReason'];
if (lifecycleFields.some((key) => Object.hasOwn(fields, key)) || fields.from === fields.to || from.type !== to.type || !this._knowledgeLiveAt(from, effective) || !this._knowledgeLiveAt(to, effective) || ...)
```

If `validFrom` is future-dated relative to `event.ts`, this check passes because `_knowledgeLiveAt(row, effective)` uses the wall-clock time. A contradiction edge with `validFrom: "2099-01-01T00:00:00.000Z"` and endpoints live now would be accepted, violating CA2's requirement that "valid times must parse and form a non-negative interval."

**Contract seam:** CA2 requires invalid intervals "fail readiness rather than materializing a plausible graph." The edge validation checks endpoint live-ness but does not reject backdated `validFrom` relative to evidence sequence.

**Red test:** Attempt to create a `Contradicts` edge with `validFrom` set to the future (e.g., 2099-01-01) while endpoints are live now; verify rejection under temporal incoherence. The supersession validation (lines 1997-2002) correctly rejects backdated effective times for `Supersedes`; `Contradicts` should have equivalent protection.

---

## Required red tests

### R1: Historical observation boundary prevents newer invalidation from contaminating old queries

Create a node at observedSeq 10, read it at observedSeq 15, invalidate it at observedSeq 20. Query `queryKnowledge({ observedSeq: 15 })` and verify the node is visible. Query `queryKnowledge({ observedSeq: 20 })` and verify the node is invisible. This confirms CA3: "A later invalidation, supersession, or contradiction resolution cannot rewrite what an earlier observation-time query returns."

### R2: Trace detects cycles and refuses to emit infinite paths

Construct a cycle: A → B via `Supports`, B → C via `Refines`, C → A via `Supports`. Call `traceKnowledgeBounded` from A with sufficient limits. Verify the trace returns a complete result with no duplicate nodes and the frontier is empty, confirming cycle safety per CA8: "Stable edge/id ordering, a visited set, exact depth/row/evidence ceilings, and explicit frontier metadata prevent cycles or truncation from masquerading as a complete path."

### R3: Audit exceeds ceiling when max+1 state rows exist

Set `maxStateRows: 10`, create 11 nodes, and call `causal.audit`. Verify it throws `causal_audit_oversize` rather than returning a false-green partial audit. This confirms CA7: "Max+1 state refuses instead of emitting a false-green partial audit."

### R4: Contradiction resolution double-resolution rejects

Create a contradiction, resolve it with winner A and loser B, then immediately attempt to resolve the same contradiction with winner B and loser A. Verify the second resolution throws under `stale_version` or `contradiction_resolved`, confirming CA6: "Racing, stale, reversed, or double resolution refuses."

### R5: Zero authority is explicitly denied

The test at line 26 confirms repoId mismatch in web/MCP paths. Extend this to verify that the Cairn ACI card explicitly declares all authority fields as false: `workerAuthority: false, editAuthority: false, verificationAuthority: false, mergeAuthority: false, approvalAuthority: false, publicationAuthority: false, routingMutationAuthority: false, proofAuthority: false, noteAuthority: false, policyAuthoringAuthority: false`. This confirms CA9: "Cairn receives no worker, edit, verification, merge, approval, publication, routing, proof, note, or policy-authoring authority."

### R6: Full-system scope catalog is non-empty

Verify that `result.payload[0].retainedScope.capabilityIds` from `causal.audit` includes entries from `RETAINED_GOAL_CATALOG` (lines 10-18 of `cairn-run-scorecard.mjs`). The test at line 141 checks for specific IDs; add a general check that the catalog is non-empty and contains versioned, digested entries. This confirms CA10: "The attested packet carries a versioned, digested stable-ID catalog rather than only broad prose."

### R7: Replay rejects tampered event content

The test at lines 47-51 confirms that tampering with event payloads throws `CoordinationIntegrityError`. Add a test that tampers with the `seq` field itself (e.g., duplicate sequence numbers or gaps) and verifies rejection on reload. This confirms CA2: "Recomputed event tamper...fail readiness rather than materializing a plausible graph."

### R8: Supersession atomically invalidates target and records contamination

Create supersession edge A → B, read B before supersession, then supersede. Verify that `affectedReaders` returns the read event and that contamination was recorded atomically with the edge. The test at lines 94-100 covers disk failure atomicity; add a test that verifies contamination contents are exact. This confirms CA5: "Edge creation, target invalidation, and exact affected-reader contamination remain one atomic append."