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
- Phase 22 focused red/green result: 10/10.
- Combined Phase 18/19/20/22 R3 gate: 31/31.
- Canonical suite at Phase 22 closure: 733/733; the current suite is 740/740 after Phase 23
  emergency-reap and Phase 24 representation-ceiling regressions, with the owned suite root
  reaped.
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

The first correction review then found a second composition defect: a structured `if` nested
inside an atomic unsupported parent formed a disconnected CFG island. Its successful Grok 4.5
report produced a red regression; the concurrent Composer process closed before its terminal frame,
and Baton still reaped both workers completely. Effective anchoring now climbs through a
disconnected structured island to the reachable atomic parent, while literal-dead arms remain
dead. Same-name definitions collapsed into one atomic region are retained as a may-union instead
of source-order last-wins. The failed-as-a-whole review attempt is preserved honestly under
`docs/reference/evidence/phase22-atlas-cpg-correction-grok-review-2026-07-11/`.

A subsequent two-model gate completed and reaped cleanly. Composer reported no remaining
actionable defect; Grok 4.5 correctly found that comment-bearing boolean literals evaded the
text-based prune. Literal recognition now unwraps the AST and ignores comment children, and dead
arms no longer emit tail-to-join edges. The red regression covers leading/trailing comments on
both boolean values. Those independent reports are preserved under
`docs/reference/evidence/phase22-atlas-cpg-final-grok-review-2026-07-11/`.

The first closure replay then exposed a Baton proof-runner defect rather than a CPG defect: one
Grok 4.5 review exceeded the shared deadline after Composer had already completed and passed fresh
verification, but `Promise.all` aborted collection before the successful row's model, PID,
verification, and report could be copied into the summary. That failed-as-a-whole run remains
preserved under
`docs/reference/evidence/phase22-atlas-cpg-closure-grok-review-2026-07-11/`. The runner now uses
settled waits, hydrates every completed row before reporting failures, records stop results on all
paths, and accepts exact-model, focus, and timeout controls for bounded closure retries.

Two targeted closure replays at the same committed head then passed independently through Baton:
exact `grok-4.5` and exact `grok-composer-2.5-fast` were each requested, resolved, and
provider-observed; both reports stated that no actionable PS1–PS8 defect remains; the 30-test
fresh-sandbox verification gate passed for both; and each native process, task worktree, runtime
scope, and task branch was killed/reaped. The durable summaries and captured reports are under
`docs/reference/evidence/phase22-atlas-cpg-targeted-closure-grok45-2026-07-11/` and
`docs/reference/evidence/phase22-atlas-cpg-targeted-closure-composer-2026-07-11/`.

The reviewers' non-defect coverage suggestions were still useful. The Phase 22 red now directly
checks dead-tail absence for both literal values, nested parenthesized/comment literals, and null
anchors on dead calls. A Phase 19/PS7 red also requires a literal branch change to surface both
`CFG_TRUE` and `REACHING_DEF` edge removal in the delta while retaining the explicit
non-behavioral-proof impact claim. This raised the combined R3 gate to 31/31 and the owned
canonical suite to 733/733 without changing the shipped semantics.

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
