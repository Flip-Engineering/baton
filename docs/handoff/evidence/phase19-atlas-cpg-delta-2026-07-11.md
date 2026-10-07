# Phase 19 Atlas CPG delta/impact evidence — 2026-07-11

- Contract: `spec/phase19/atlas-cpg-delta-impact.md` (CD1–CD8).
- Focused Phase 18/19 command: `npm test -- --test test/phase18-atlas-cpg.test.mjs --test test/phase19-atlas-cpg-delta.test.mjs` in `impl/`.
- Current focused R3 result: 20/20 passing (8 CPG seed/value graph, 6 delta/impact, 6 taint).
- Current full canonical result: 721/721 passing; the owned suite root was reaped.

The gate proves independently built before/after graph authorities, formatting-invariant semantic
keys, honest ordinal/rename behavior, syntax-fingerprint node modifications, typed edge deltas,
bounded impact through containment/def-use/reverse calls, unresolved-call non-propagation, parse
partials, cancellation, deployment depth/source/graph/delta bounds, exact-path/schema/digest resume
authority, tamper refusal, and deterministic re-verification. The same hardening corrected
parameterized arrow-function naming in the underlying CPG seed.

The Baton-on-Baton runner copied `impl/src/atlas-cpg.mjs` into isolated before/after roots, added a
`normalizeDigestInput` helper and routed `sha` through it, then ran the public delta. All adjacent
summary checks are true: complete node/edge changes, non-empty impact including `sha`, balanced
audit events, deterministic reverify, and full removal of the three temporary roots.

Impact remains graph reachability under the shipped single-file seed, not runtime behavioral proof.
SSA, path-sensitive PDG, alias analysis, interprocedural dataflow, dynamic dispatch, taint, and
repository-wide CPG overlays remain the next explicit R3 depth.
