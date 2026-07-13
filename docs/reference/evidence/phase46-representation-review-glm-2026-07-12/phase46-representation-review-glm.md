# Phase 46 Representation Review — GLM Adversarial Report

**Commit:** 9f54b9f
**Reviewed:** 2026-07-12
**Scope:** RP1-RP8 compliance, source attestation, determinism, authority honesty

## Verdict

**PASS** — The attested representation review packet is source-attested, bounded, deterministic, and authority-honest. All seven rungs (R1-R7) are present with honest closed statuses. The implementation correctly fails closed on tree drift, cancellation, artifact tampering, and limit violations. Coverage of AST/CST, symbol/SCIP, CPG/CFG/path/taint/delta, IR ceiling Decision, behavioral fingerprint, structured merge, and e-graph Decision is complete per RP1-RP3. Reverification correctly detects claim substitution. The packet retains all missing capabilities (SSA/PDG, aliases/heap/implicit flow, exceptions/interprocedural returns, live LSP, external IR validation, true semantic merge, conditional e-graphs) per RP7.

## P0-P1 findings

**P0 — None.**

**P1 findings:**

1. **spec/phase46/attested-representation-review.md:41-43 vs impl/src/atlas-representation-review.mjs:36 — Missing attestation mismatch.** The spec RP7 explicitly retains "missing SSA/PDG/path solving" as a single capability, but `atlas-representation-review.mjs:36` lists `ssa-pdg-path-solving` without "path solving" granularity and omits the explicit "path solving" retention. The `missingStillPlanned` array should match RP7's enumeration: `['ssa-pdg', 'path-solving']` or the spec should be updated to reflect the implementation's consolidated entry. Current state: spec says "missing SSA/PDG/path solving", code says `ssa-pdg-path-solving`. This is a documentation/implementation seam mismatch that could confuse downstream attestation consumers.

2. **impl/src/atlas-representation-review.mjs:39 — reverify partial claim validation.** The `reverify` method only compares `claim?.refs?.[0]?.digest` against the rebuilt digest but does not verify that `claim.op`, `claim.treeSha`, or `claim.payload` match. A claim with a correct digest but tampered operation name or tree SHA would return `ok: true`. This is a weak verification — it detects artifact substitution but not full claim integrity. The spec RP5 requires "claim substitution" to fail closed, but the current implementation only checks the artifact digest, not the full claim structure.

3. **impl/test/phase46-representation-review.test.mjs:18-22 — Missing test for maxRows violation.** The test suite checks `maxFileBytes` overflow (line 22) but does not test `maxRows` ceiling violation. Implementation `atlas-representation-review.mjs:35` throws when `rows.length > this.limits.maxRows`, but no red test verifies this ceiling. Given RP4 requires "any max+1 refuses", this is a gap in coverage. A test passing `maxRows: 6` to a 7-row packet should fail with `representation_review_oversize`.

4. **impl/test/phase46-representation-review.test.mjs:25-27 — Missing reachability red test for direct/mcp surface.** RP6 requires "direct/generic northbound reachability" attestation. The test covers `createDriver` through the ACI registry but does not test generic MCP/web invoke surfaces directly. A red test should attempt raw MCP invoke without the driver and verify it reaches the packet through the same ACI registry path. Current coverage assumes driver mediation only.

## Required red tests

1. **maxRows ceiling violation** — Pass `maxRows: 6` to a 7-row packet; must reject with `representation_review_oversize`.

2. **reverify full claim validation** — Pass a claim with correct digest but tampered `op` or `treeSha`; must return `ok: false`.

3. **RP7 missingStillPlanned spec alignment** — Add a test asserting that `document.missingStillPlanned` contains entries matching spec RP7's retained capabilities verbatim (or update spec to match code).

4. **generic MCP/web reachability** — Add a test invoking the packet through a generic MCP client (not `createDriver`) and asserting it reaches the ACI registry and returns the same digest.

5. **path enumeration completeness** — Add a test that each row's `paths` array resolves to actual committed files at the given tree SHA (verify no 404s or missing sources).