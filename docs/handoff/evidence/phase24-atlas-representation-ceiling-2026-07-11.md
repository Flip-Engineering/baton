# Phase 24 Atlas executable representation ceiling evidence — 2026-07-11

## Outcome

The R4 compiler-IR premise was tested through two concurrent exact-model Grok workers after the
Phase 23 emergency-reap repair. Exact `grok-4.5` and `grok-composer-2.5-fast` were independently
requested, resolved, and provider-observed on distinct overlapping native processes. Both reports
were freshly verified, normally killed, and fully reaped with no process, worktree, runtime,
metadata, or branch residue. Their reports and lifecycle ledger are under
`docs/reference/evidence/phase23-atlas-ir-scope-grok-review-2026-07-11/`.

Both reviews reached the same substantive decision: JavaScript/TypeScript has no honest commodity
compiler-IR plus translation-validation substrate in Baton. Renaming the Phase 18–22 CPG would be
a category error; inventing a Baton SSA would be an unvalidated maintenance project. JS/TS should
therefore stop honestly at R3 while real external LLVM/MIR/MLIR paths remain separately
catalogued for languages and Evidence-ladder tasks that can justify them.

`AtlasRepresentationCeiling` makes that Decision executable. `representation.ceiling` derives
the language family from a confined relative path and returns a bounded, content-addressed ACI
policy result. Every JS/TS-family extension reports maximum rung R3 and names the shipped
structural, symbol, CPG, delta, and taint redirects. Requests for `ir.build`, `ir.delta`, or
`tv.validate` fail typed `rung_ceiling` with the Decision id and never silently emit CPG under an
IR label.

## Validation

- Numbered contract: `spec/phase24/atlas-representation-ceiling.md`.
- Focused RG1–RG7 gate: 5/5.
- Canonical owned suite: 740/740; suite root reaped.
- The concurrent scope review passed every exact-model, fresh-verification, normal kill, process,
  worktree, runtime, metadata, and branch cleanup check.
- The Baton-on-Baton policy proof under
  `docs/reference/evidence/phase24-atlas-representation-ceiling-2026-07-11/` queries the real
  `impl/src/coordinator.mjs` path, forces bounded resume, reverifies the policy digest, observes all
  three typed false-R4 refusals, balances capability events, and removes its artifact root.

## Honest boundary

This is an explicit negative result for Baton's current JS/TS product, not a claim that compiler IR
has no value. R4 remains meaningful for optimization and translation validation when an external
language toolchain produces a stable IR and an Evidence task demands it. The policy artifact is
not a behavioral proof, compiler artifact, or translation-validation certificate. R1 structural
and R3 CPG deltas remain review/risk signals with their existing limitations.
