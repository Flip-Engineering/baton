# Phase 93a.2 SPEC RE-DRAFT — adversarial red-team (wave-2)

Scope: the six wave-2 amendments in `spec/phase93-closed-program-ir.md` — §93.9 demand-edge vs
settle-then-read split, §93.8 `effectKinds` own-nodes projection, §93.8 inline-only
`repositoryScopes` with the `content_ref` rule and `[0..]` bound, §93.9 `bound.policyDigest`
preimage, §93.5 value-authority vs `ProgramPolicy` ceiling split, and §93.20 reachable-parallel
serial classification plus the 93a.2 shape-only `maxParallelBranches` note — attacked against the
shipped reference in `impl/src/program-ir/{normalize-program,approval-template,role-catalog,
control-nodes,schema-values,program-policy}.mjs`. Every "verified" claim was reproduced by feeding
the cited Program to `normalizeProgramSource` in this worktree (read-only; no repo file other than
this report was mutated, no scratch files written). The pinned red suite
(`node --test impl/test/phase93a-{canonical-identity,schema-values,source-schema,control-grammar}-
red.test.mjs`) passes 73/73, exit 0 — it stays green precisely because it never exercises the
defective corners below.

## Verdict

The re-draft closes four of the six amendments without new contradiction — §93.9 `bound.policyDigest`
and §93.5 ceiling split cleanly; §93.8 `effectKinds`, §93.8 `repositoryScopes`, and §93.20
serial/parallel partially, each with a residual authority-semantics gap (P1). It also closes the
**direct** half of the §93.9 dominance fix: the three wave-1 exploits at `sequence.result`,
`parallel.branches[].result`, and `branch.arm.result` are now refused, and the R1 natural form
stays accepted (all verified below).

But the §93.9 amendment is **not spec-sound as written**. It carries two P0 defects.

1. The settle-then-read rule inspects only the **immediate** producer. A `collect` (or collect
   chain) reachable solely through a settle-then-read position hides a reference to a control node
   outside the settlement domain; the Program is **admitted** yet reads a conditionally-unsettled
   control port at runtime. This is a residual instance of the exact P0-1 class the amendment
   claimed to close (CE1, verified ADMITTED). The demand-edge half of the same split *does* catch
   the identical hidden read when it is reached from a demand root (verified REFUSED), proving the
   gap is the settle-then-read check's immediate-producer-only scope, not the graph machinery.

2. The settlement-domain definition — "the smallest set closed under (a) the enclosing node itself;
   (b) for sequence nodes …; (c) for parallel nodes whose join is `all_terminal` …" — diverges from
   the shipped reference and **over-restricts**. As written it refuses the canonical
   `branch.arm.result = armControl.value` form (CE2) and the non-`all_terminal`
   `parallel.branches[].result = branchControl.value` form (CE3); the reference admits both. The
   reference keys the settlement domain on the **arm/branch-control node itself**
   (`domainKey = arm.control.nodeKey` / `branch.control.nodeKey`); the spec keys it on the
   *enclosing* node and its closure never adds arm control chains or non-`all_terminal` branch
   control chains. Two conformant implementations of the spec text and the reference therefore
   disagree on core soundness accept/reject decisions, and a literal implementation of the spec
   rejects natural Programs the wave-1 report relied on as building blocks.

## P0-P1 findings

**P0-1 — §93.9 settle-then-read rule checks only the immediate producer, so a collect reachable
only via a settle-then-read position hides an undominated / conditionally-unsettled control read.
(Residual of wave-1 P0-1; soundness gap.)**

§93.9 rule 2: a settle-then-read `PortRef` "MUST resolve either to a pure data-node port
(`value`/`collect`/`context`, which demand evaluation settles) or to a port of a control node
inside the enclosing position's settlement domain." The pure-data branch is accepted with **no
transitive check**. A `collect`'s items are `PortRef`s (§93.9 `collect`), so a collect can reference
a control node's port while itself presenting as a pure-data producer. `value` and `context`
cannot do this (a `value` is a literal `TypedValue`; a `context` addresses artifacts/manifest, not
node ports), so `collect` is the unique hiding shape — but it is enough.

Counterexample (verified ADMITTED):

```text
value vs; value vb;
select selO [k:vs]; select selT [k:vs];
branch br (is_true vb): then {control:selT, result:selT.value},
                        otherwise {control:selO, result:vs.value};
collect col [{alpha:selT.value},{beta:vb.value}];
sequence seq: steps=[br], result=col.value;
root=seq.
```

`seq.result` is a settle-then-read position; its immediate producer `col` is a `collect` (pure
data) → accepted with no further walk. `col`'s `alpha` item reads `selT.value`, where `selT` is a
control node reached **only** through `br`'s then-arm. The reference (`normalize-program.mjs`
`checkSettleThenRead`, line 290–296) returns immediately for any non-control producer, and the
demand-edge walk (`demandRoots`, line 228–263) only fires for control-node demand roots — `col` is a
data node (skipped at line 246) and `seq.result` is not a demand root, so `col → selT` is never
walked. Result: the Program is admitted, yet when `br` takes the otherwise arm `selT` is never
entered, `selT.value` never settles, and `seq.result` demands `col.value → selT.value` against an
unsettled control port. This is the same "admitted at validation, fails before/at execution" class
as wave-1 P0-1.

The asymmetry is provable, not incidental: feed the **same** `col → selT` edge from a demand root
instead and it is refused — `select main [packed:col]; root=main` → "Program node main demands a
port produced by selT, which does not dominate it" (verified REFUSED). So the demand-edge relation
recurses through `collect` items (line 258–261) but the settle-then-read relation does not; the
re-draft's two relations are not the same strength, and the weaker one is on the side wave-1 P0-1
lived on. The fix is to make rule 2 walk the transitive pure-data closure (`collect` items;
`value`/`context` add nothing) from each settle-then-read position and require every control
producer so reached to lie in the settlement domain — the demand-edge walk already implements
exactly this recursion and can be reused.

**P0-2 — §93.9 settlement-domain definition diverges from the reference and wrongly rejects the
canonical branch-arm and non-`all_terminal` parallel-branch forms. (Spec/impl divergence;
wrong rejection.)**

Rule 2 defines one settlement domain per *enclosing node* via the closure (a)/(b)/(c). For a
`branch`, (b) and (c) do not apply, so the domain is `{branch}` plus the special clause "a branch
node's own value port is in its settlement domain" — i.e. `{branch, branch.value}`. The arm's
control node is never added; the clause "nodes inside branch arms are never in any outer settlement
domain" confirms arm-internal nodes are excluded. For a non-`all_terminal` `parallel`, (c) does not
apply, so the domain is `{parallel}`.

- *Counterexample CE2 (branch arm, verified ADMITTED by the reference):*
  `branch br (is_true vb): then {control:selT, result:selT.value}, otherwise {control:selO,
  result:vs.value}; root=br`. `br.then.result = selT.value` with `selT` the then-arm's own control.
  Per the spec text `selT ∉ SD(br) = {br, br.value}` and `selT` is a control node (not pure data),
  so the spec **refuses** this — the canonical "enter a control and expose its value" branch form
  that wave-1 P0-1 itself used as a building block. The reference admits it: `checkSettleThenRead`
  is called with `domainKey = record.source.then.control.nodeKey` (= `selT`), and
  `settlementDomain(selT) = {selT}` contains `selT` (line 304–306).
- *Counterexample CE3 (non-`all_terminal` parallel, verified ADMITTED):*
  `parallel par join=first_verified preference=[a]: branches [{name:a, control:selA,
  result:selA.value}]; root=par`. Per the spec text `SD(par) = {par}` (join is not `all_terminal`),
  `selA ∉ SD(par)`, so the spec **refuses** `par.branches[a].result = selA.value`. The reference
  admits it: `domainKey = branch.control.nodeKey = selA`, `settlementDomain(selA) = {selA}`.

The reference's algorithm is sound and matches every desired outcome: it refuses all three wave-1
exploits (CE4 `sequence.result = selT.value` → "settle-then-read ref to selT is outside its
settlement domain", verified REFUSED; the parallel and branch-arm exploits likewise) and accepts R1
(`sequence seq: steps=[br,sel3], result=sel3.value`, verified ADMITTED). The defect is that the
spec text expresses a *different* algorithm — domain of the enclosing node — which (i) refuses CE2
and CE3 and (ii) for `all_terminal` parallels is *more* permissive than the reference: the spec's
`SD(par)` includes every branch's control chain via (c), so `parallel.branches[a].result =
selB.value` (`selB` = a *different* branch's control) is accepted by the spec text but refused by
the reference (CE5, verified REFUSED: "settle-then-read ref to selB is outside its settlement
domain"). The spec's behavior there is itself sound (under `all_terminal` every branch settles), but
it is not what the shipped, tested implementation does.

Recursion termination and sequence/parallel nesting are otherwise sound: the closure descends only
along control edges (steps, branch/parallel control chains), the control graph is acyclic by §93.4
step 2, and the reference memoizes (`settlementDomainCache`). The failure is not termination; it is
that the closure omits the arm and non-`all_terminal`-branch control chains and is keyed on the
wrong node.

**P1-3 — §93.9 "two distinct read relations, never one universal rule" is not exhaustive: effect
input positions are in neither relation. (Under-specification; forward-looking into 93C.)**

The demand-edge list (rule 1) is `branch.predicate`, `await.target`, `select.candidates`,
`repeat.{initial,continueWhen}`, `child.input`. The settle-then-read list (rule 2) is
`sequence.result`, `parallel.branches[].result`, `branch.{then,otherwise}.result`. Effect-node
input positions — `call.input`, `map.input`, `reduce.inputs`, `gate.candidate`, `notify.target`/
`notify.message`, `checkpoint.value`, `finish.value`/`finish.evidence` (§93.11) — are `PortRef`s
that §93.11 requires to "already be settled", yet they appear in **neither** list. No dominator or
settlement-domain check covers them, so an effect input reading a control node outside its
settlement domain is statically unchecked (admitted at validation, fails at runtime), the same
class as P0-1. This does not bite in 93a.2 (effects are 93C and the 93a.2 grammar admits no effect
node), but the spec's claim that the two relations are exhaustive is false as written and will
re-open P0-1 the moment 93C lands unless effect inputs are added to one of the relations.

**P1-4 — §93.8 `effectKinds` own-nodes projection is unreconciled with §93.9 "within the parent
envelope shape" bodies. (Authority gap; forward-looking.)**

The amendment closes wave-1 P0-2 for the common case: `effectKinds` = own nodes only, repeat/child
bodies "bound by their own approval envelopes" (verified in `approval-template.mjs`: `usedEffectKinds`
is the caller-supplied own-node set, `[]` for every 93a.2 Program). But §93.9 still permits a body
that is "independently approved **or within the parent envelope shape**". A body that runs *within
the parent envelope shape* (no distinct envelope) dispatches its effects under the parent's
authority, so the parent's `approvedEffectKinds` must contain them — yet the own-nodes-only
projection omits them, so the parent envelope under-grants and the body's effect is unauthorized,
or the parent envelope is non-authoritative for that body. The re-draft's wording assumes every
body is independently approved; the shared-envelope alternative is left unaddressed, so two
conformant implementations disagree once such a body exists.

**P1-5 — §93.8 inline-only `repositoryScopes` + `[0..]` makes the parent envelope non-authoritative
for `content_ref` roles; whether an empty-scope envelope over-grants is unspecified. (Authority
gap.)**

The amendment closes wave-1 P1-3 cleanly on its own terms: `repositoryScopes` is the inline-only
union with a `[0..maxEvidenceRefs]` bound, `content_ref` scopes are deferred to the artifact's own
`approvalDigest` at replay, and an all-`content_ref` catalog is now approvable (verified in
`approval-template.mjs` line 54 `if (role.templateBinding.kind !== 'inline') continue;` and
`normalizePathArray(..., { min: 0, max: policy.maxEvidenceRefs })`; `role-catalog.mjs` gives
`content_ref` shape-only validation). But the parent envelope's `repositoryScopes` is now
non-authoritative for `content_ref` roles: a `content_ref` artifact's `approvalDigest` can grant
repository paths the parent envelope never listed, and the spec never requires
`content_ref`-artifact scopes ⊆ parent-envelope `repositoryScopes`. With an all-`content_ref`
catalog the envelope carries `repositoryScopes = ∅`; the spec does not say whether enforcement
treats that as "no access" or "unconstrained for content_ref roles", and the re-draft's "bound by
its own approvalDigest" makes the parent envelope bypassable for those roles — in tension with
§93.8's closing rule that "the template cannot omit Program authority merely to obtain a smaller
approval." Either state that the content_ref artifact's scopes MUST be a subset of the envelope's
(and revalidate at approval), or explicitly define the content_ref approvalDigest as a separate,
non-ceilinged authority and retract the envelope-ceiling language for content_ref roles.

**P1-6 — §93.20 reachable-parallel serial classification + shape-only `maxParallelBranches`: the
empty-role-set refusal is worded unconditionally but the deferral does not name it. (Spec internal
inconsistency; scope inconsistency.)**

The serial classification and shape-only note close wave-1 corrections 7–8 (verified in
`normalize-program.mjs`: `controlReachable` from `root` over control edges, line 155–170; an
unreachable parallel is inert; `maxParallelBranches` is null/non-null shape-only). Two residuals:

- §93.20 says "If that set is empty, normalization and preview refuse
  `program_parallel_authority_unavailable` **before constructing the parallel node**" with no 93E
  qualifier, while the deferral sentence names only "`maxParallelBranches` is shape-validated only"
  and "the route-card/structural minimum binding proof is deferred" — not the role-set refusal.
  In 93a.2 there are no `call`/`map`/`reduce` effect nodes (effects are 93C), so the reachable
  role set is **always empty**; enforcing the refusal as written would refuse every 93a.2 parallel,
  contradicting §93.24 (93a.2 normalizes parallels). The reference does not enforce it; the spec
  text should say the role-set/card machinery is deferred wholesale to 93E.
- "reachable from `root`" for serial classification does not include repeat/child bodies, but the
  role-set computation does ("including reachable repeat/child bodies"). A parallel inside a
  repeat/child body is in a different Program; the spec should state that serial classification is
  per-Program (control-reachable from that Program's own `root`) so the two scopes cannot be
  conflated.

**Closed without new contradiction.**

- **§93.9 `bound.policyDigest` (wave-1 P1-4): closed.** "MUST equal the enclosing Program's
  `policy.policyDigest`; the named bounds take their values from that one policy and no other
  authority." Verified in `normalize-program.mjs` `canonicalBound` (line 343–348): the bound rejects
  any `policyDigest ≠ policy.policyDigest`. Consistent with §93.20 (the values are copied into
  `ProgramPolicy` from the Workflow/Context policies; the bound names the field and pins the
  Program-policy digest). Program identity for repeat/child-bearing Programs is now settleable.
- **§93.5 value-authority vs `ProgramPolicy` ceiling split (wave-1 P1-5): closed.** Schema-internal
  ceilings (object properties, union variants, string enums, array `maxItems`) are the
  deployment-injected Program value authority; `ProgramPolicy.maxSchemaDefinitions` bounds the
  `schemas`/`verificationContracts` arrays and `ProgramPolicy.maxJoinMembers` bounds Program-level
  arrays; "the two authorities are never interchangeable." This matches the reference split
  (`schema-values.mjs` applies the value authority to schema internals; `normalize-program.mjs`
  applies `ProgramPolicy` to array lengths). No contradiction. (Minor coherence note, not a defect:
  a `collect`'s derived object schema has one property per item, so its property count is bounded by
  the value authority's `maxSchemaDefinitions` while its item count is bounded by
  `ProgramPolicy.maxJoinMembers`; if the former is set below the latter a Program can pass the
  item-count check and fail `collect` derivation. It fails closed.)

## Required corrections

1. **§93.9 rule 2 — walk the transitive pure-data closure from each settle-then-read position
   (P0-1).** Replace "resolve … to a pure data-node port (`value`/`collect`/`context`, which demand
   evaluation settles)" with a recursive requirement: from each settle-then-read position, walk the
   pure-data closure (`collect` items; `value`/`context` add no node refs) and require every
   control producer so reached to lie in the settlement domain (pure-data leaves are unrestricted).
   This is the same recursion the demand-edge relation already performs; reuse it. Without this, CE1
   is admitted.

2. **§93.9 rule 2 — key the settlement domain on the position's governing control chain, not the
   enclosing node (P0-2).** Define the domain per position: `sequence.result` → the sequence's
   step-chain domain; `parallel.branches[b].result` → branch `b`'s control-chain domain;
   `branch.{then,otherwise}.result` → that arm's control-chain domain. Add the missing closure
   cases (arm control chains; non-`all_terminal` branch control chains) so CE2 and CE3 are accepted
   as the reference accepts them. Decide and state the `all_terminal` cross-branch policy
   explicitly: either match the reference (per-branch domain, so CE5 is refused) or keep the
   enclosing-node domain (so CE5 is accepted) — but pick one and make the reference conform; today
   the spec and the reference disagree. The reference's per-position algorithm is the one that
   satisfies all of {refuse the three wave-1 exploits, accept R1, accept CE2/CE3}, so keying on the
   governing chain is the recommended fix.

3. **§93.9 — add effect input positions to one of the two relations (P1-3).** State that
   `call.input`, `map.input`, `reduce.inputs`, `gate.candidate`, `notify.{target,message}`,
   `checkpoint.value`, `finish.{value,evidence}` are demand edges (dominator-checked) or
   settle-then-read positions, and drop the "two distinct read relations" exhaustiveness claim or
   make it true by listing the third category. Otherwise P0-1 re-opens at 93C.

4. **§93.8 `effectKinds` — reconcile the shared-envelope body case (P1-4).** Either state that in
   Program v1 every repeat/child body is independently approved (delete or narrow the "within the
   parent envelope shape" alternative in §93.9), or require a body that runs within the parent
   envelope to contribute its effect kinds to the parent template's `effectKinds` projection (and
   define how those kinds are read from the body Program). As written the own-nodes-only projection
   under-grants for shared-envelope bodies.

5. **§93.8 `repositoryScopes` — define the content_ref/envelope authority composition (P1-5).**
   Either require the `content_ref` artifact's `pathScope`/`contextScope` to be a subset of the
   envelope's `repositoryScopes` (revalidated at approval, not only at replay), or explicitly define
   the `content_ref` `approvalDigest` as a separate non-ceilinged authority and retract the
   envelope-ceiling language for content_ref roles. State what an empty envelope `repositoryScopes`
   means at enforcement ("no access" vs "unconstrained for content_ref") so an all-`content_ref`
   catalog cannot over-grant.

6. **§93.20 — defer the role-set/card machinery wholesale to 93E and fix the scope (P1-6).** State
   that in 93a.2 the empty-reachable-role-set refusal and the route-card/structural minimum are both
   deferred (not only "`maxParallelBranches` shape-validated"), so the unconditional "refuse … before
   constructing the parallel node" text does not refuse every 93a.2 parallel. State that serial
   classification is per-Program over control edges from that Program's own `root`, distinct from
   the role-set computation's "including reachable repeat/child bodies" scope.
