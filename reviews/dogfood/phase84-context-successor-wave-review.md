# Phase 84 context successor wave review — partition 1/2

Scope: only `context-partition:5eb4e467be5b444586abb18750d7a16e2e0b8f0a6813cd8816a4e9df3f9f671a` from `impl/src/coordination-store.mjs`.

## P1 — Context-map settlement records an allowlist default instead of the executed route

The settlement path proves that the dispatch is bound to the current `planDigest` and `nodeKey`, but it never binds the receipt's route to the dispatch or task. It instead constructs `route` unconditionally from `node.routes.harnesses[0]`, `node.routes.models[0]`, and `node.routes.efforts[0]`.

Consequently, when a node permits more than one harness, model, or effort and execution selects a non-first option, settlement still emits `state: 'accepted'` with the first allowed option. `childDigest` then seals that invented route, so replay is deterministic but preserves the wrong execution truth. The task identity, terminal event, commit SHA, artifacts, and cleanup release in the same row do not repair the missing route binding.

Repair by obtaining the immutable selected route from the dispatch/task execution binding, requiring an exact match to the settled task, and placing that route in `core`. If context-map nodes are intentionally single-route, enforce exactly one value in every route array before dispatch and settlement rather than silently choosing index zero. Replay/integrity validation should recompute and compare the same selected-route binding.

Verification: `node` (expected exit code 0).
