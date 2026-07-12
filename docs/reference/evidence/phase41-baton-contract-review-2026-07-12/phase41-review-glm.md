# Phase 41 Contract Review — GLM Adversarial Analysis

**Commit:** `4078672` — "Specify transitive advisory projection"
**Reviewer:** GLM-4.7 (low effort)
**Focus Areas:** Negative reachability semantics, nested component ambiguity, fail-closed tests, backlog non-disappearance

## Verdict

**Phase 41 is specified but NOT implemented.** The commit `4078672` added only documentation (`spec/phase41/transitive-advisory-projection.md`, README updates, capability audit changes) without any implementation code. The `impl/src/cartographer-quartermaster.mjs` card() method exposes operations through Phase 40 (`provenance.plan`), but contains NO `provenance.advisories` capability. The spec TA1 requires `provenance.advisories` to be "advertised only when Quartermaster has Phase 37 SBOM policy and a deployment-injected advisory scanner" — this operation does not exist in the codebase. Without implementation, the TA5 negative reachability semantics, TA3 nested component handling, TA10 red tests, and TA11 backlog preservation cannot be verified or enforced. **No actionable Phase 41 contract defect exists because Phase 41 does not exist as implementation — it exists only as specification.**

## P1-P2 findings

**No P1-P2 findings exist.** The specification is well-structured and precisely documents conservative reachability semantics:

- **TA5 (Negative Reachability):** The spec correctly requires three separate fields (`dependencyGraphReachability`, `packageReferenceObservation`, `installedInstanceResolution`) and mandates `vulnerableFunctionReachability: unknown`. The spec explicitly states: "A zero CPG path and a missing import witness are not admissible safety evidence" and "A direct import of a parent dependency does not prove that its vulnerable transitive child executes." This properly prevents false clearance.

- **TA3 (Nested Component Ambiguity):** The spec correctly handles duplicate coordinates: "Duplicate package paths sharing the same coordinate are queried once but remain distinct graph instances in the projection; repository evidence cannot choose which nested/hoisted instance Node would load." The TA3 contract requires: "Links/workspaces are unsupported in this rung and make the graph incomplete rather than becoming registry coordinates." This prevents coordinate conflation.

- **TA11 (Backlog Non-Disappearance):** The spec explicitly enumerates 14 deferred contracts that "Phase 41 does not silently absorb or delete," including: "trusted advisory-to-symbol mapping and release-artifact-to-source/export identity; true vulnerable-function reachability; richer interprocedural/module-binding/alias/heap/dynamic-dispatch CPG; provider push/feed/webhook/polling; policy-hash invalidation; positive clearance." These remain explicitly reserved.

The specification defect is that **no implementation corresponds to it**. The cartographer-quartermaster.mjs invoke() method contains cases for `orientation.slice`, `reuse.internal`, `reuse.vet`, `provenance.sbom`, and `provenance.plan` — but no `provenance.advisories` case. No Phase 41 tests exist in `impl/test/` (test files exist through `phase40-proposed-install-graph.test.mjs`).

**Root cause:** Commit `4078672` only committed specification. The impl/ directory received no changes. The Phase 41 capability exists as documentation artifact only.

## Missing red tests

**All Phase 41 red tests are missing because Phase 41 is not implemented.** The spec TA10 enumerates 10 required red test categories that cannot be executed:

1. **Exact actual and proposed graph selection, grounding, and source-drift refusal** — Cannot test without `provenance.advisories` operation.

2. **Unique-coordinate batching with duplicate path projection and exact response-order binding** — TA3 requires coordinate deduplication with separate instance projection. The TA10 test #5 requires: "duplicate nested/hoisted coordinates remain separate, instance resolution remains unknown, and no import witness, zero CPG path, or missing dependency path can suppress or clear an advisory." No implementation exists to verify this.

3. **Direct, transitive, optional/dev/peer, unresolved, and graph-unreachable component cases** — TA4 requires "deterministic shortest typed request-edge paths from the application root to every component instance." No operation exists to compute these.

4. **Scoped/bare/subpath import recognition without prefix confusion** — TA5 requires `not_observed_in_indexed_supported_static_imports` negative semantics. The cartographer-quartermaster.mjs `reuse.vet` operation (line 360-362) contains import observation logic, but this is Phase 36 external dossier, not Phase 41 transitive projection.

5. **`vulnerableFunctionReachability` remains exactly `unknown`** — TA5 test #6 requires this field to be `unknown` in Phase 41. No artifact carries this field because no Phase 41 output exists.

6. **Timeout, redirect, cancellation, pagination, malformed/reordered/short/extra responses, byte, component, advisory, batch, path, result, and artifact ceilings fail closed** — TA1 requires fail-closed scanner behavior. The supply-chain-oracle.mjs contains OSV query logic (lines 93-96) but this is invoked by `reuse.vet`, not by a Phase 41 operation that does not exist.

7. **Raw/main/graph/import artifact tamper, forged refs, source change, Atlas drift, plan substitution, stale plan base, and semantic-main-document forgery fail offline reverify** — TA8 requires offline semantic reverify. The cartographer-quartermaster.mjs reverify() method (lines 525-614) contains cases for `reuse.vet`, `provenance.plan`, and `provenance.sbom` — but no case for `provenance.advisories`.

8. **Generic authenticated web/MCP invocation and actor attribution** — TA9 requires northbound reachability. No ACI route exists for a capability that does not exist.

9. **Official OSV live evidence over Baton's actual lockfile, with zero source mutation and complete process/worktree/runtime cleanup under recursive Baton dogfood** — TA10 test #10 requires live proof. Without implementation, no live proof can run.

10. **Adversarial manufacture of unreachable safety claim** — TA10 requires: "Independent adversarial review must try to manufacture an `unreachable` safety claim from missing imports, unresolved edges, dynamic-language gaps, or provider truncation." No review can manufacture a claim from a non-existent capability.

**Test file absence:** The `impl/test/` directory contains `phase40-proposed-install-graph.test.mjs` (32,318 bytes) but no `phase41-*.test.mjs` file. All TA10 red tests are skipped due to missing implementation.

**Specification incompleteness:** The spec TA10 enumerates test requirements but does not identify that Phase 40 ended at `provenance.plan`. Phase 41 `provenance.advisories` was specified without a corresponding implementation phase, creating a specification-to-implementation gap that prevents all TA10 verification.

---

**Conclusion:** Phase 41 is a well-specified conservative reachability contract with proper negative semantics, nested component ambiguity handling, and backlog preservation. The defect is not in the specification but in the **absence of implementation**. All findings are deferred until Phase 41 capability exists in `impl/src/cartographer-quartermaster.mjs` and corresponding tests exist in `impl/test/phase41-*.test.mjs`.
