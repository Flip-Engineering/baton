# Phase 18 — Atlas code-property graph seed

This is the first measured R3 slice, not a claim of a complete production CPG.

## CG1 — truthful scope

`AtlasCpgSlice` supports one confined JavaScript/TypeScript-family file. Its card names syntax
containment, block-local CFG edges, lexical reaching-definition edges, and unambiguous local-call
edges, while explicitly denying SSA, path-sensitive PDG, alias analysis, interprocedural dataflow,
dynamic dispatch, taint, and polyglot completeness.

## CG2 — stable graph identity

Nodes and edges have deterministic IDs derived from file digest, syntax kind, source byte range,
and typed endpoints. Nodes retain one-based display ranges; provenance pins the source and graph.

## CG3 — syntax and control skeleton

The graph contains function, statement/declaration, identifier occurrence, entry, and exit nodes.
`CONTAINS`, block-local `CFG_NEXT`, function `CFG_ENTRY`/`CFG_EXIT`, and explicit `CFG_TRUE`/
`CFG_FALSE` branch edges are syntax-derived. Unsupported control constructs remain atomic nodes.

## CG4 — lexical def-use

Parameters, declarator names, and assignment-left identifiers are definitions. Later same-name
references within the same function receive `REACHING_DEF` from the nearest lexical definition.
This is deliberately not path-sensitive or SSA.

## CG5 — local calls

Call nodes record callee text/name and caller. A unique same-file function name receives `CALLS`;
ambiguous or dynamic calls retain candidates/unresolved status rather than fabricated resolution.

## CG6 — bounds, parse health, and cancellation

Source and graph-artifact ceilings are deployment-derived. Invalid UTF-8, path escape, unsupported
language, cancellation, and exceeded bounds fail typed. Parse errors yield `partial` status.

## CG7 — artifact, context, and reverify

The complete graph is content-addressed. Inline nodes/edges are token-bounded with a resumable,
integrity-checked cursor. Reverify rebuilds from source and compares the graph digest.

## CG8 — acceptance

Focused tests prove graph determinism, containment/CFG/def-use/call edges, ambiguity honesty,
parse health, confinement/bounds/cancellation, bounded resume/tamper refusal, and public export.
