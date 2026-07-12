# Phase 18 Atlas CPG seed evidence — 2026-07-11

- Contract: `spec/phase18/atlas-cpg-slice.md` (CG1–CG8).
- Focused: 6/6 via `npm test -- --test test/phase18-atlas-cpg.test.mjs` in `impl/`.
- Full: 707/707 via canonical `npm test`; owned suite root reaped.

The gate proves deterministic source-digest-bound graph identities; function/statement/identifier/
call/entry/exit nodes; syntax containment; block control order, branch, return/throw exit edges;
lexical reaching definitions; honest unique/ambiguous/dynamic local calls; parse-health partials;
confinement, UTF-8, cancellation, deployment source/artifact ceilings; bounded resume, tamper refusal,
and re-verification.

The Baton-on-Baton runner built the graph for `impl/src/mcp-northbound.mjs`. Its adjacent summary
has every check true: the graph was complete and substantial, contained every claimed edge family,
reverified byte-for-byte, recorded audit pairs, and removed its temporary artifact root.

This is explicitly a single-file intraprocedural seed. It does not claim SSA, path-sensitive PDG,
alias analysis, interprocedural dataflow, dynamic dispatch, taint, a CPG delta across revisions, or
polyglot completeness. Those are the next R3 measurements, not inferred features.
