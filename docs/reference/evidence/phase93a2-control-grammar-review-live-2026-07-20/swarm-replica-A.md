# Swarm partition report — replica-A

Partition: §93.9 demand-edge dominance (clause 1) + settle-then-read settlement domains
(clause 2), including the collect-laundering fix, vs `impl/src/program-ir/normalize-program.mjs`
(read alongside `impl/src/program-ir/control-nodes.mjs` for the ref enumerations it consumes).

Spec source: `spec/phase93-closed-program-ir.md` §93.9, lines 757–793 (the two read relations),
752–755 (demand evaluation reach), and the node table at 668–728 (PortRef-typed fields).

Pinned verification (run in the assigned worktree, exact contract):
`node --test impl/test/phase93a-control-grammar-red.test.mjs` → exit code 0, 55/55 tests pass,
including the partition-relevant rows P93A2-DOM1, P93A2-D1, P93A2-D2, and P93A2-D3.

## Verdict

PASS. The implementation enforces both §93.9 read relations exactly as specified, as two
distinct relations, and the collect-laundering fix (commit `4cbc864`, "transitive
settle-then-read walk", per `wave35-fix-decisions.md` decisions 1 and 8) is correctly and
symmetrically applied to both walks. Claim-by-claim grounding:

**Clause 1 — demand edges, dominator-checked (spec lines 759–766).**

- Demand-root enumeration is exact and exhaustive. Spec: "`branch.predicate` operands,
  `await.target`, `select.candidates`, `repeat.initial` and `repeat.continueWhen` operands,
  and `child.input`". Impl `demandRoots` (normalize-program.mjs:238–254) returns exactly
  these, using `predicatePortRefs` (control-nodes.mjs:231–241), which is itself exhaustive
  over the eight predicate kinds of the §93.9 union (lines 830–839): `value` for
  is_true/exists, `left`/`right` for equals/not_equal, `container`/`item` for contains,
  `predicates` for and/or, `predicate` for not.
- The producer-kind set matches: spec names `sequence, branch, parallel, await, select,
  repeat, child, or finish`; `CONTROL_NODE_KINDS` (control-nodes.mjs:18–20) is exactly the
  seven 93a.2 kinds (`finish` is an effect node, 93C scope, and the 93a.2 grammar admits no
  effect nodes, consistent with spec lines 787–793).
- The dominance CFG (normalize-program.mjs:199–214) models §93.9 execution order
  (lines 795–799): sequence steps chain through the previous step's settlement, branch arms
  and parallel branches fork from their owner. The dataflow computation (lines 215–237) is
  the standard intersection fixed point seeded with `{root}` at the root.
- "Every `await` is therefore dominated by the handle producer it awaits" holds: an await's
  `target` is a demand root and its producer is enforced to be a parallel/child handle port
  (normalize-program.mjs:464–468), i.e. always a control producer, so the dominance check at
  lines 263–267 always applies to it. "Undominated demand reads fail before execution
  admission" — the refusal happens at normalization, before any canonical node exists.
- The transitive pure-data walk (spec: "`value`/`collect`/`context` chains") recurses through
  collect items only (lines 268–271), which is complete: `nodeDataRefs` (control-nodes.mjs
  529–553) confirms `value` and `context` nodes carry no PortRef fields, and context nodes
  are refused outright in 93a.2 (`contextNodeRefusal`, normalize-program.mjs:56–68).

**Clause 2 — settle-then-read, settlement-domain-checked, never dominator-checked (spec
lines 767–785).**

- Position set is exact: `sequence.result`, `parallel.branches[].result`,
  `branch.{then,otherwise}.result` — normalize-program.mjs:320–331, and these positions are
  absent from `demandRoots`, so they are never dominator-checked.
- Per-position keying matches the spec exactly: `sequence.result` keyed on the sequence
  itself (line 322); `parallel.branches[b].result` keyed on branch b's own control node
  "regardless of the parallel's join kind" (line 325, unconditional on join);
  `branch.{then,otherwise}.result` keyed on that arm's own control node (lines 328–329).
  Never the enclosing node's domain.
- The settlement-domain closure (lines 287–302) implements the spec's smallest-set closure:
  (a) the node itself; (b) sequence → every step and each step's own domain; (c)
  `all_terminal` parallel → every branch's control-chain domain. A `branch` node and a
  non-`all_terminal` parallel contribute only themselves (neither kind enters the recursion),
  so arm internals never leak and cross-branch reads under an `all_terminal` parallel are
  refused — each branch keys its own domain.
- The walk (lines 303–319) checks at the end of the transitive pure-data closure, recursing
  through collect items; control producers reached must lie in the domain, pure-data leaves
  are unrestricted (they are never control producers, so they fall through unchecked), and a
  control-produced port outside the domain fails `program_invalid` (line 312). Recursion
  termination is safe: control cycles are rejected earlier (line 192) and `walked` guards the
  collect graph (data cycles rejected at line 191).

**Collect-laundering fix.** Both walks recurse through nested collect chains with a `walked`
guard (demand: lines 268–271; settle-then-read: lines 314–317), closing the
single-indirection laundering gap for every position in both relations. The red suite pins
this: P93A2-D2 (one-hop and true two-hop `colOuter ← colInner ← producer` chains on the
demand side, referencing wave-3.5 decision 8) and P93A2-D3 (direct exploits plus
collect-laundered exploits for all three settle-then-read positions, plus the two-hop row,
and accepted control rows: natural `sequence.result = lastStep.value` and pure-data-leaf
reads). All pass.

**Exhaustiveness of the two relations (spec lines 792–793).** Cross-checking every
PortRef-typed field of the ten 93a.2 node kinds against `nodeDataRefs`: `sequence.result`,
`parallel.branches[].result`, `branch` arm results → clause 2; `branch.predicate` operands,
`await.target`, `select.candidates`, `repeat.{initial,continueWhen}`, `child.input` →
clause 1; `collect.items[].value` is covered by the recursive walk from any consuming
position and an unreferenced collect is inert data (spec line 752: "The node table is inert
data"). `value`/`context` carry no PortRefs. Effect-node input positions (spec lines
787–791) are vacuous in 93a.2 since the grammar constructs no effect node. No PortRef-typed
field escapes both relations.

## P0-P1 findings

None.

One observation below P1, recorded for completeness, no correction requested: a control node
unreachable from `root` in the dominance CFG retains the all-nodes dominator set
(normalize-program.mjs:217–229 leaves predecessor-less nodes dominated by everything), so its
own demand reads vacuously pass. This is spec-conformant: §93.9 frames clause 1 as an
execution-admission check ("fail before execution admission"), an unreachable node never
executes and never schedules a read ("Execution enters only `root:ControlRef`", line 752),
and the spec imposes no reachability requirement on inert table nodes — mirroring the §93.20
amended treatment of unreachable parallel nodes as inert (normalize-program.mjs:152–154).
Unreachable producers also cannot leak into reachable consumers: they never enter a reachable
node's computed dominator set, so a reachable demand read of one still fails. The
settle-then-read domains are computed structurally and are reachability-independent, so
clause 2 is unaffected.

## Required corrections

None. The partition is conformant as implemented and as pinned by the passing red suite
(exit 0, 55/55).
