# Phase 17 Atlas structural search/rewrite evidence — 2026-07-11

## Contract and deterministic gate

- Contract: `spec/phase17/atlas-structural-search-rewrite.md` (AR1–AR10).
- Focused command: `npm test -- --test test/phase17-atlas-structural-rewrite.test.mjs` from `impl/`.
- Focused result: 9/9 passing.
- Canonical command: `npm test` from `impl/`.
- Full result: 701/701 passing with the canonical suite root reaped.

The tests use the pinned real `@ast-grep/napi` parser/matcher/edit API. They prove syntax matches
instead of comment lookalikes, one-based ranges and capture provenance, single and variadic
replacement interpolation, non-overlapping multi-edit proposal generation, source immutability,
input/output parse health, confinement, fatal UTF-8, cancellation, deployment-derived source and
artifact ceilings, bounded resume, tamper refusal, and deterministic re-verification.

## Baton-on-Baton live capability proof

`docs/reference/evidence/phase17-atlas-rewrite-2026-07-11/run.mjs` ran the shipped capability over
`impl/src/atlas-rewrite.mjs` itself. It structurally found real `sha($A)` calls, proposed replacing
every match with `digest($A)`, verified the proposed-source digest, proved the repository source
remained byte-identical, re-ran to the same manifest/output digests, recorded three started/completed
audit pairs, and removed its temporary artifact root. Every check in the adjacent `summary.json`
is true.

## Honest boundary

Rewrite is proposal-only: Atlas has no direct worktree apply authority. This slice implements
pattern matching, not the complete ast-grep rule/constraint/transform surface, and does not claim
live LSP, CPG/dataflow/taint, IR, behavioral equivalence, semantic merge, or e-graphs. Those remain
separately measured R2–R7 pursuits.
