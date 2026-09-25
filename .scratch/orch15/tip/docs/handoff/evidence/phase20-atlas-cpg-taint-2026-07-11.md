# Phase 20 Atlas CPG taint reachability evidence — 2026-07-11

- Contract: `spec/phase20/atlas-cpg-taint.md` (CT1–CT8).
- Focused R3 command: `npm test -- --test test/phase18-atlas-cpg.test.mjs --test test/phase19-atlas-cpg-delta.test.mjs --test test/phase20-atlas-cpg-taint.test.mjs` in `impl/`.
- Focused result: 20/20 passing (8 graph, 6 delta, 6 taint).
- Full canonical result: 721/721 passing; owned suite root reaped.

The CPG now emits explicit `ASSIGNED_FROM` and `ARGUMENT_TO` edges in addition to lexical
`REACHING_DEF`. The taint query accepts only operator-specified source/sink/sanitizer call names,
returns deterministic shortest witnesses, stops at configured sanitizers, enforces deployment
depth/path/source/graph/result ceilings, preserves parse partials, checks cancellation, and uses
exact-path/schema/digest resume plus deterministic re-verification.

The Baton-on-Baton runner queried `impl/src/mcp-northbound.mjs` with source `parse` and sink
`handle`. Every summary check is true: it found the real `JSON.parse` assignment through the
message reference into `server.handle`, and the witness edge sequence contains
`ASSIGNED_FROM`, `REACHING_DEF`, and `ARGUMENT_TO`. Reverify and balanced audit checks passed and
the temporary artifact root was removed.

This establishes lexical value-graph reachability, not safety or exploitability. Absence of a path
does not cover branch feasibility, aliases, heap/object properties, closures, exceptions, implicit
flows, dynamic dispatch, or interprocedural returns. Operator-named sanitizers are policy
assertions, not verified sanitizer correctness.
