# Phase 20 — Atlas operator-specified taint reachability

## CT1 — explicit policy vocabulary

`AtlasCpgTaint` accepts non-empty operator-specified source and sink call names plus optional
sanitizer names. Baton ships no hidden security taxonomy and does not infer that a name is trusted.

## CT2 — authoritative value graph

The query builds a confined Phase 18 graph. It traverses only explicit `ASSIGNED_FROM`,
`REACHING_DEF`, and `ARGUMENT_TO` edges from matching source-call nodes to matching sink-call nodes.

## CT3 — sanitizer cut

Traversal stops when it reaches an operator-named sanitizer call. Sanitization is a configured
policy assertion, not a proof that the implementation is correct.

## CT4 — bounded paths

Depth and path-count ceilings are deployment-derived and constructor-enforced. Results retain the
complete typed node/edge path and shortest distance. Baton returns a deterministic shortest witness
per reachable source/sink occurrence, not an exponential enumeration of every equivalent path.
Cancellation is checked through traversal.

## CT5 — honest meaning

A returned path proves reachability in the lexical single-file value graph. Absence does not prove
safety: branches, aliases, heap/object properties, closures, exceptions, implicit flows, dynamic
dispatch, interprocedural returns, and path feasibility remain unmodeled.

## CT6 — artifacts and parse health

Graph and taint artifacts are content-addressed and bounded. Source parse errors make status
`partial`, even when a path is found. Inputs, policy names, graph digest, and result digest are
pinned in provenance.

## CT7 — context, resume, and reverify

Inline paths are token-bounded with exact-path/schema/digest cursors. Reverify rebuilds the graph
and query. Caller claims cannot supply their own edges or mark a partial graph complete.

## CT8 — acceptance

Focused tests prove assignment and direct-argument flows, sanitizer cuts, negative/unresolved
cases, configured depth/path bounds, parse partials, cancellation, resume/tamper refusal,
determinism, and Baton-on-Baton execution.
