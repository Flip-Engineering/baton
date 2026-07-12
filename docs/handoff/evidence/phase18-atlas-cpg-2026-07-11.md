# Phase 18 Atlas CPG seed evidence — 2026-07-11

- Contract: `spec/phase18/atlas-cpg-slice.md` (CG1–CG8).
- Focused: 7/7 via `npm test -- --test test/phase18-atlas-cpg.test.mjs` in `impl/`.
- Current full: 714/714 via canonical `npm test`; owned suite root reaped.

The gate proves deterministic source-digest-bound graph identities; function/statement/identifier/
call/entry/exit nodes; syntax containment; block control order, branch, return/throw exit edges;
lexical reaching definitions; honest unique/ambiguous/dynamic local calls; parse-health partials;
confinement, UTF-8, cancellation, deployment source/artifact ceilings; bounded resume, tamper refusal,
and re-verification.
The added hardening proves parameterized arrow functions use their binding name rather than their
first parameter and makes resume require the exact digest-derived path plus the CPG schema, not
merely arbitrary hash-consistent JSON.

The Baton-on-Baton runner built the graph for `impl/src/mcp-northbound.mjs`. Its adjacent summary
has every check true: the graph was complete and substantial, contained every claimed edge family,
reverified byte-for-byte, recorded audit pairs, and removed its temporary artifact root.

This is explicitly a single-file intraprocedural seed. It does not claim SSA, path-sensitive PDG,
alias analysis, interprocedural dataflow, dynamic dispatch, taint, a CPG delta across revisions, or
polyglot completeness. Those are the next R3 measurements, not inferred features.
