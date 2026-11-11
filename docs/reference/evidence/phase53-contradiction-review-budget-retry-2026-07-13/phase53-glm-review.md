# Phase 53 GLM Adversarial Review

## Verdict

PASS

## P0-P1 findings

No confirmed P0-P1 defects. The committed Phase 53 implementation correctly realizes authenticated contradiction workspace operations with bounded non-bypassable authority, exact idempotency, ACI output preflight, and closed public shapes.

## Required corrections

None required. The implementation faithfully satisfies CX1–CX8:

**CX1–CX2 Authority and workspace (impl/src/cairn-run-scorecard.mjs:408–434)**
- `_contradictionActor()` correctly refuses worker/policy/transport-forged actors; only `orchestrator` and non-transport-tagged `operator:*` pass direct ACI, while web/MCP derive `operator:web:*` and `operator:mcp:*` from their authenticated principal. Test line 85 confirms `operator:web:forged` is refused.
- List accepts only `{observedSeq, afterEdgeId, limit}` with `limit ≤ maxItems`. The result reports bounded UTF-8 snippets (`maxSnippetBytes`), digested evidence, and never leaks node bodies, prompts, credentials, artifact paths, or reader identities. Test lines 59–60 verify safe shapes and forbidden omissions. Page continuation is stable and ordering is canonical.

**CX3–CX4 CAS resolution and historical truth (impl/src/cairn-run-scorecard.mjs:447–455)**
- Resolution requires exact `observedSeq`, `edgeId`, `winnerId`, `loserId`, and all three validity versions. The coordination-layer `resolveKnowledgeContradictionBounded()` reruns CAS at append time; mismatched, stale, reversed, or dead requests refuse. Test lines 89–96 verify winner/loser reversal refusal and concurrent race exclusion.
- Historical views are preserved: `store.queryKnowledge({observedSeq, ids: [loserId]})` returns the invalidated node, while current queries do not. Test line 76 confirms historical read returns resolved loser; line 77 confirms historical list returns same items; line 79 confirms current list shows zero unresolved.

**CX5 Authenticated direct/web/MCP authority (impl/src/web-northbound.mjs:403–413, impl/src/mcp-northbound.mjs:354–358)**
- Web and MCP northbound each invoke capability operations with `transport: 'web'` or `transport: 'mcp'` and their transport-derived actor (`web:{userId}:{sessionId}` or `mcp:{userId}:{sessionId}`). The Cairn `_contradictionActor()` then wraps these as `operator:web:*` or `operator:mcp:*` for the coordination effect. Test lines 157–166 confirm both transports invoke and reverify through the same authority, with correct actor attribution in the durable event.

**CX6 Exact idempotency and reverify (impl/src/cairn-run-scorecard.mjs:617–624)**
- Same actor/key/request returns the original receipt; same key with changed reason conflicts. Test line 89 verifies same-key replay idempotence; line 90 verifies changed-reason conflict. Reverify rebuilds edge/loser/contamination and compares the complete claim; test line 101 confirms tampered `affectedReadCount` fails verification.

**CX7 Audit gates and ACI preflight (impl/src/cairn-run-scorecard.mjs:442–445, impl/test/phase53-cairn-contradictions.test.mjs:124–148)**
- Both operations fail when Phase 47 audit reports critical violations (line 126). Resolution checks cancellation before audit, after audit, before derivation, at the preflight callback, and at the append seam. Test lines 128–134 verify each cancellation phase leaves coordination unchanged. Test lines 140–143 verify preflight mutation refuses with `causal_contradiction_integrity`.
- ACI output refusal happens before durable effect: `_preflightContradictionResolution()` is invoked before the append; if `aciOutputPolicy` ceiling is exceeded, the operation throws `capability_result_oversize` and no resolution event is written. Test lines 168–171 confirm ACI refusal prevents the contradiction resolution.

**CX8 Executable adversarial coverage**
- The test suite exhaustively covers configuration gating; empty, one-page, and multi-page listing with stable ordering; safe UTF-8 snippets; unresolved bundles; historical list after resolution; exact winner/loser/version CAS; worker/policy/forged transport refusal; direct/web/MCP invoke and reverify; same-key replay and conflict; concurrent race; restart/tamper reverify; affected recall and ordinary reads; append failure; cancellation at multiple seams; post-append commit-wins receipt delivery; audit failure; and each independent max/max+1 policy and ACI output ceiling.

Phase 53 authentically ships the contracted authority: deterministic bounded workspace, exact CAS resolution, preserved historical truth, and non-bypassable authenticated paths through direct ACI and the two trusted transports.
