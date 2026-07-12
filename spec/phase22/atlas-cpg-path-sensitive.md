# Phase 22 — Atlas bounded path-sensitive CPG continuation

## PS1 — structured `if` control flow

For braced `if` statements, `CFG_TRUE` enters the consequence and `CFG_FALSE` enters the
alternative when present, otherwise the join. Every non-terminal branch tail reaches the join.
Literal `true`/`false` conditions omit the unreachable branch edge. Unbraced conditions, loops,
switches, short-circuit expressions, ternaries, and exception constructs remain atomic unless a
later contract expands them.

## PS2 — bounded CFG may-reaching definitions

`REACHING_DEF` means a same-function, same-binding-name definition may reach a reference through
the shipped CFG without another definition of that name on that path. Multiple definitions may
reach a join; this is neither lexical-last-def nor SSA/must-def. Definitions in a CFG-unreachable
literal branch do not reach later references. A deployment-supplied `maxReachDefPairs` ceiling is
mandatory and fails typed before an oversized relation is emitted.

## PS3 — direct value edges

Identifier-to-identifier declarator/assignment copies emit direct `ASSIGNED_FROM` edges. Call
assignment and `ARGUMENT_TO` edges describe only the direct RHS/direct argument, not every nested
descendant; nested expressions compose through their immediate calls instead of bypassing a
configured sanitizer.

## PS4 — taint consumes CFG truth

Operator-specified taint retains Phase 20 flow edge types and sanitizer cuts. Source and sink calls
anchored in CFG-unreachable statements are excluded. Richer may-reaching definitions preserve a
possible path across a branch join, while syntax-literal dead branches are pruned. Provenance says
`cfg_may_reach_value_graph_not_safety_proof`; a missing path is not a safety claim.

## PS5 — explicit non-goals

No claim is made for shadowing-aware binding identity, aliases, heap/object properties, implicit
or control taint, exceptions, interprocedural parameters/returns, dynamic dispatch, full PDG, SSA,
SAT/SMT condition solving, repository-wide flow, or unbraced conditional expansion.

## PS6 — artifact and lifecycle integrity

Graph schema/version, content addressing, deterministic order, parse-partial status, cancellation,
result ceilings, bounded resume, tamper refusal, and reverify remain mandatory. Statement/value
nodes expose only deterministic statement anchors and CFG reachability facts derived from source.

## PS7 — delta inheritance

CPG delta compares the richer graph and impact may follow its richer `REACHING_DEF` relation.
This does not upgrade impact reachability into behavioral proof or path-sensitive impact.

## PS8 — acceptance

Red tests prove else entry and branch joins, literal dead-branch pruning, alternate may-reaching
definitions, direct copy flow, sanitizer non-bypass through nested calls, the mandatory relation
ceiling, retained direct-argument behavior, deterministic artifacts, and the explicit non-goals.
The combined R3 and canonical suites must stay green.
