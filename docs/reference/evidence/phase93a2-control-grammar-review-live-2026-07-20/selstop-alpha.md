# Phase 93a.2 review — selstop-alpha

Scope: `impl/src/program-ir/normalize-program.mjs` against `spec/phase93-closed-program-ir.md`
§93.9 (exhaustive control-node schemas, demand edges, settlement domains), read together with
§93.3/§93.4 (graph/identity rules) and §93.20 (deferred `maxParallelBranches` binding) that §93.9
depends on. Method: read every function in the target file top to bottom, cross-read the helper
modules it imports (`control-nodes.mjs`, `canonical-value.mjs`, `program-policy.mjs`,
`approval-template.mjs`), hand-traced the dominance computation and both settlement-domain walks
against §93.9 clause 1/clause 2 text using several constructed graphs, then ran the pinned red
suite.

## Verdict

CONFORMANT. I found no P0/P1 defect in `normalize-program.mjs` itself. The demand-edge
(dominator-checked) relation and the settle-then-read (settlement-domain-checked) relation are both
implemented exactly as §93.9 clauses 1 and 2 specify, including the subtle per-position keying
rules (`sequence.result` keyed on the sequence itself; `parallel.branches[b].result` keyed on
branch `b`'s own control node regardless of join kind; `branch.{then,otherwise}.result` keyed on
that arm's own control node) and the "arm/non-all_terminal-branch internals never leak into an
outer domain" rule. Kahn canonical ordering, byte-identical coalescing (both within one ready round
and across separate rounds), cycle detection over data/control/union graphs, and the §93.20
maxParallelBranches wholesale-deferral for 93a.2 are all correct. `node --test
impl/test/phase93a-control-grammar-red.test.mjs` passes 55/55, and I independently re-derived the
expected behavior for the settlement-domain exploits/laundered-exploits in that suite by hand rather
than trusting the assertions alone.

I have two informational (not P0/P1) notes below: one genuine but out-of-file asymmetry in a
dependency (`approval-template.mjs`), and one performance observation in the Kahn loop. Neither
blocks conformance of the reviewed file against §93.9.

## P0-P1 findings

None found in `impl/src/program-ir/normalize-program.mjs` against §93.9.

Specific things I actively tried to break and could not:

1. **Demand-edge producer set.** `demandRoots()` (lines 238-254) returns exactly the six root
   positions §93.9 clause 1 lists: `branch.predicate` operands, `await.target`, `select.candidates`,
   `repeat.initial` + `repeat.continueWhen` operands, and `child.input`. No more, no fewer. The
   outer loop only visits `CONTROL_NODE_KINDS`, which is redundant with the switch's default `[]`
   case for `sequence`/`parallel` but not incorrect.
2. **Demand walk depth.** The walk (lines 255-273) is a worklist, not a single-hop check: a
   `collect` producer pushes its own items back onto the stack, so an arbitrarily deep chain of
   nested `collect` nodes is walked to the actual control producer. I built a two-hop
   `collect(collect(controlPort))` case by hand and confirmed the loop reaches the innermost control
   producer before checking dominance — this matches test `P93A2-D2`'s explicit two-hop case and the
   §93.9 text "the transitive pure-data walk ... from each such root," not a one-level check.
3. **Settlement-domain closure.** `settlementDomain()` (lines 287-302) is recursively defined
   exactly per the spec's inductive definition: (a) itself; (b) for a `sequence`, every step's own
   domain; (c) for an `all_terminal` `parallel`, every branch's own control-chain domain. A `branch`
   node and a non-`all_terminal` `parallel` fall through to `domain = {key}` only, which is the
   "arm internals never leak" rule. I traced the `parLaundered`/`branchLaundered`
   collect-indirection cases from the test file by hand (a `branch`/`parallel`-branch result naming
   a `collect` that transitively reads a sibling arm/branch's port) and confirmed
   `checkSettleThenRead`'s worklist walk (lines 303-319) recurses through `collect` the same way the
   demand walk does, so the "launder through one collect hop" attack is caught, not just the direct
   read.
4. **`context` node interaction with the two walks.** `contextNodeRefusal()` (lines 56-68)
   unconditionally fails for any `context` source node before the graph is even built, so no
   `context` record ever reaches the dominance/settlement code in 93a.2. I checked whether this
   makes the walks' silent no-op on non-`collect` producers a latent gap for when 93a.3 admits
   `context` nodes: it does not, because `nodeDataRefs()` already returns `[]` for `kind: 'context'`
   (a `context` node structurally carries no `PortRef` fields — per §93.10 it addresses manifest/
   artifact bytes directly, never another node's port) — so the walks will keep treating `context`
   producers as pure leaves correctly once 93a.3 lands, with no code change needed in the walk logic
   itself. Not a bug, but worth recording since it wasn't obvious without cross-reading §93.10.
5. **Await/parallel join compatibility.** `child` handles are forced to `all_terminal`
   (lines 472-475); `parallel` handles require the awaiting join to be byte-identical
   (`canonicalValueText`) to the embedded join on the already-constructed parallel node
   (lines 476-481) — matches "MUST repeat the byte-identical join embedded in that handle."
6. **`repeat`/`child` bound checking.** `canonicalBound()` (lines 366-371) requires
   `value.policyDigest === policy.policyDigest` for both `repeat` and `child`, matching "MUST equal
   the enclosing Program's `policy.policyDigest`." Port schemas for `repeat`/`child` are resolved via
   `uniqueSchemaByName` against the registry rather than an author-supplied `outputSchema` field,
   which correctly matches that neither node's canonical schema in §93.9 lists an `outputSchema`
   field (only `await`/`parallel` do, and those two are checked against an author-supplied,
   name-pinned `SchemaRef`).
7. **Coalescing across non-adjacent Kahn rounds.** `bodiesByDigest` and `emittedIds` are declared
   outside the `while (pending.size > 0)` loop, so a node body that becomes byte-identical to one
   already emitted several rounds earlier is folded into the existing `nodeId` (its source key is
   mapped via `constructed.set`, `pending.delete`, but nothing new is pushed to `emitted`) — this is
   correct per "coalesce byte-identical node bodies to one node ID and rewrite all references,"
   which is not scoped to a single ready-set round.

## Required corrections

No correction is required in `impl/src/program-ir/normalize-program.mjs` for §93.9 conformance.
The following are informational notes for the maintainers, not required fixes to the reviewed file:

1. **Informational — `approval-template.mjs` roles/effectKinds ordering asymmetry (dependency, not
   the reviewed file).** `normalizeApprovalTemplate()` normalizes `repositoryScopes` through
   `normalizePathArray`, which accepts caller input in *any* order and re-sorts it before comparing
   to the computed projection (the test file explicitly documents this: "repositoryScopes is
   accepted in unsorted input order and normalizes to canonical order"). `roles` and `effectKinds`
   receive no equivalent sort — they are validated for duplicates only and then compared
   *positionally* against the sorted computed projection, so a syntactically valid, duplicate-free,
   correct-set-membership `roles`/`effectKinds` array submitted in non-canonical order is rejected.
   §93.4's array-classification table calls the analogous `RoleCatalog.roles` field "set-like by
   name" with normalization "reject duplicate names, sort by unsigned UTF-16 name" — the same
   semantics `repositoryScopes` gets here. This is a real asymmetry worth a follow-up in
   `approval-template.mjs`, but it is outside `normalize-program.mjs`'s own logic (that file only
   passes `parsed.approvalTemplate` through to `normalizeApprovalTemplate` unchanged) and does not
   affect Program identity/security, only strictness of what raw author input is accepted before
   normalization succeeds.
2. **Informational — repeated body construction inside one Kahn round.** In the `while
   (pending.size > 0)` loop (lines 569-608), `constructNode()` is invoked for *every* currently-ready
   key each iteration, even though only the candidates sharing the lexicographically smallest
   `nodeId` are consumed; the rest are silently recomputed (hashed again) on the next iteration since
   they remain in `pending` and still satisfy the readiness filter. This is not a correctness issue
   (idempotent, pure reconstruction, and `policy.maxProgramNodes` bounds it), only a potential
   O(n²)-ish reconstruction cost on a Program with a wide ready frontier. Not a spec-conformance
   defect; flagging only because the task asked for anything suspicious.

## Verification

Ran the pinned command from this worktree root:

```
node --test impl/test/phase93a-control-grammar-red.test.mjs
```

Result: `tests 55`, `pass 55`, `fail 0`, `cancelled 0`, exit code 0.
