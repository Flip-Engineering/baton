# Phase 22 Atlas bounded path-sensitive CPG evidence — 2026-07-11

## Outcome

PS1–PS8 ship as a bounded continuation of the existing single-file JS/TS-family CPG rather than a
claim of full path-sensitive program analysis. Braced `if`/`else` control now enters both correct
branches and rejoins through non-terminal tails. Boolean-literal dead branches are pruned. Lexical
last-definition was replaced by a deployment-bounded CFG may-reaching-definition relation, so all
definitions that can reach a join remain visible without claiming SSA or must-def semantics.

Direct identifier copies now carry value through `ASSIGNED_FROM`. Assignment and argument edges
describe immediate values rather than every nested descendant, preventing an inner source call
from bypassing an operator-named sanitizer. Taint excludes calls in literal-dead structured
branches and reports `cfg_may_reach_value_graph_not_safety_proof`.

Unsupported control remains explicitly atomic. The first Baton-on-Baton attempt caught a
regression where statements inside `try` were treated as unreachable. Nested occurrences under an
unsupported construct now collapse to the reachable outer statement, while a dead branch under a
structured literal `if` stays unreachable. The real `JSON.parse` to `server.handle` witness in
`impl/src/mcp-northbound.mjs` is preserved as a regression gate.

## Validation

- Numbered contract: `spec/phase22/atlas-cpg-path-sensitive.md`.
- Phase 22 focused red/green result: 7/7.
- Combined Phase 18/19/20/22 R3 gate: 27/27.
- Canonical suite: 729/729; owned suite root reaped.
- Baton-on-Baton proof: every check in
  `docs/reference/evidence/phase22-atlas-cpg-path-sensitive-2026-07-11/summary.json` is true. It
  built a 2,000-plus-node graph of the implementation itself, observed real CFG/may-def/copy
  relations, preserved the real MCP taint witness, exercised copy/branch/sanitizer composition,
  reverified deterministically, balanced audit events, and removed its temporary roots.

## Recursive review and disagreement

Two exact-model Grok workers reviewed the prior R3 implementation concurrently through Baton and
were independently fresh-verified, killed, and fully reaped. Both found the incorrect else edge;
one also found the copy-flow/card honesty gap. Their captured reports and normalized events are in
`docs/reference/evidence/phase22-atlas-path-sensitive-grok-review-2026-07-11/`.

After implementation, two more exact-model Grok reviews independently found that `else if` sugar
caused the outer structured `if` to fall back to atomic flow, orphaning the nested branch and
creating a false-negative taint result. A red regression now requires the outer `CFG_FALSE` edge
to enter the nested `if`, requires that condition to be reachable, and preserves a source in the
middle arm through the join. The correction is covered by the 7/7 focused and 729/729 canonical
results. The finding reports and their fully reaped lifecycle evidence are under
`docs/reference/evidence/phase22-atlas-cpg-implementation-grok-review-2026-07-11/`.

The implementation deliberately rejected one proposal that would have removed a source-to-sink
path whenever the source occurred in a conditional branch. That is must-path reasoning, not
may-reachability, and would create a false negative when the branch is taken. Baton instead keeps
all may-reaching definitions at an unknown branch join and prunes only source-level boolean
literals.

## Honest boundary

This is not full path feasibility, SSA, a PDG, or a safety/exploitability proof. Shadowing-aware
binding identity, aliases, heap/properties, implicit/control taint, exceptions, general condition
solving, interprocedural parameters/returns, dynamic dispatch, unbraced conditional expansion, and
repository-wide flow remain unclaimed.
