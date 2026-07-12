# Phase 24 — Atlas executable representation ceiling

The concurrent exact-model review in
`docs/reference/evidence/phase23-atlas-ir-scope-grok-review-2026-07-11/` found that Baton's
JavaScript/TypeScript-family source has no honest commodity compiler-IR and translation-validation
substrate. This contract makes that result executable without relabeling the shipped R3 CPG as R4.
It does not retire real external LLVM/MIR/MLIR representations for languages and tasks that can
justify them later.

## RG1 — honest capability card

`AtlasRepresentationCeiling` exposes `representation.ceiling` and names the R0–R3 JS/TS views
already available. Its limitations explicitly say that it produces no compiler IR and no
translation-validation verdict.

## RG2 — JS/TS stops at R3

For `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`, requests for `ir.build`,
`ir.delta`, or `tv.validate` fail typed `rung_ceiling`. The error names `maximumRung: R3`, the
Phase 24 Decision id, and the existing structural/CPG redirects. It never silently falls back to
a CPG artifact labeled IR.

## RG3 — policy result uses the ACI envelope

`representation.ceiling` returns status, summary, token-bounded payload, content-addressed refs,
cost, and provenance. The artifact has a versioned schema and an explicit `policy_decision` media
type; no kind or media type contains `compiler_ir`, `llvm`, `mir`, or `mlir`.

## RG4 — bounds, cancellation, and confinement

Artifact size is deployment-bounded. Budget is positive and token-bounds inline payload.
Cancellation fails typed. Paths must be relative confined paths with a recognized JS/TS-family
extension; unsupported languages fail typed rather than inheriting the JS Decision.

## RG5 — resume, integrity, and reverify

A truncated result resumes only through a digest- and offset-bound cursor. Exact artifact path,
digest, schema, and operation are checked before payload. Tamper and path escape fail typed.
`reverify` rebuilds the policy result from the same request and compares its digest.

## RG6 — semantic delta is not translation validation

Provenance says that R1 structural delta and R3 CPG delta are review/risk representations, not
compiler-IR refinement certificates or behavioral proofs. Future external IR tools must use a
different capability, artifact schema, tool/version provenance, and Evidence-ladder verdict.

## RG7 — acceptance

Focused reds cover RG1–RG6 and all eight extensions. The canonical suite remains green. A
Baton-on-Baton proof queries a real Baton `.mjs` path, resumes a bounded result, reverifies it, and
observes typed refusal for every false R4 operation without creating process/worktree residue.
