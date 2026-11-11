# Phase 93a.2 Program-IR Spec — Adversarial Red-Team Report

Scope: `spec/phase93-closed-program-ir.md` §93.3–93.9, §93.20, §93.23 (suite 4), §93.24 (93a.2
entry), attacked as a normative contract against the 93a.2 reference in
`impl/src/program-ir/{program-policy,role-catalog,approval-template,control-nodes,normalize-program,
canonical-value,schema-values}.mjs`. Every claim below was checked against the cited spec text and
exercised against the shipped normalizer (read-only; no repo files were mutated). Findings are
spec defects — contradictions, under-specified digest preimages, and a dominance rule that both
admits undominated reads and would reject natural programs — not implementation style nits.

## Verdict

The 93a.2 slice is **not spec-sound as written**. The single hardest defect is the §93.9 control
dominance rule: it is stated as one universal invariant ("every data ref to a control-produced
port is dominated by that producer's settlement") but the spec never enumerates the demand-edge
set it applies to, and the invariant is in direct tension with the sequence/parallel result
semantics in the same section. The reference resolves the tension by simply not checking three
consumer positions, which lets genuinely undominated reads through (demonstrated below), while the
same prose enforced literally would reject the slice's own kitchen-sink Program. Two of the
amended §93.8 approval-template projections (`effectKinds`, `repositoryScopes`) are unimplementable
against the §93.7/§93.9 catalog and body shapes they project over, so the reference silently
emits under-stated values and the approval envelope under-grants authority. One digest preimage
that feeds Program identity (`bound.policyDigest`) is entirely undefined. These are P0/P1 and
must be resolved in the spec before 93a.2 is claimed; the pinned red suite passes only because
it never exercises the affected consumer positions or catalog/body combinations.

## P0-P1 findings

**P0-1 — §93.9 dominance rule admits undominated reads at `sequence.result`,
`parallel.branches[].result`, and `branch.{then,otherwise}.result`, and would reject natural
programs if enforced literally. (Contradiction + soundness gap.)**

§93.9 states: *"every await is dominated by the handle producer it awaits; every data ref to a
control-produced port is dominated by that producer's settlement … Multiple owners, undominated
reads, control reached by demand, and effect reachability outside the selected arm fail before
execution admission."* In the same section: *"A demanded port produced by await, select, sequence,
branch, repeat, or finish MUST already be settled on a dominating control edge."* The first
sentence is a universal invariant over **all** data refs; the second enumerates only the
**producer** kinds whose ports are demanded and says nothing about which **consumer** positions
are subject to the walk. The spec never gives a normative demand-edge set.

The 93a.2 reference (`normalize-program.mjs`, `demandRoots`) checks exactly five consumer
positions — `branch.predicate`, `await.target`, `select.candidates`, `repeat.initial` +
`repeat.continueWhen`, `child.input` — and checks **none** of `sequence.result`,
`parallel.branches[].result`, or `branch.{then,otherwise}.result`. Each of those is a `PortRef`
(§93.4: a pure data dependency) and therefore a "data ref" that §93.9 requires to be dominated.
All three admit undominated reads (verified against the shipped normalizer):

- *Exploit (sequence.result):* `value vs; value vb; select selT [k:vs]; select selO [k:vs];
  branch br (is_true vb): then {control:selT, result:selT.value}, otherwise {control:selO,
  result:vs.value}; sequence seq: steps=[br], result=selT.value; root=seq`. `selT` is a control
  node reached only through `br`'s then-arm; it does **not** dominate `seq`. §93.9 requires
  rejection. The normalizer **admits** it (`demandRoots(sequence)=[]`).
- *Exploit (parallel branch result):* with the same `br`/`selT`, `parallel par: branches
  [{name:a, control:selA, result:vs.value}, {name:b, control:selA, result:selT.value}];
  root=par; maxParallelBranches>0`. `selT` does not dominate `par`. **Admitted.**
- *Exploit (branch arm result):* with the same `br1`/`selT`, `branch br2 (is_true vb): then
  {control:selA, result:selT.value}, otherwise {control:selA, result:vs.value}; sequence seq:
  steps=[br1,br2], result=br2.value; root=seq`. `selT` does not dominate `br2`. **Admitted.**

The rule is also **too strong** in the same breath. The R1 kitchen-sink Program (suite 4,
`P93A2-R1`) is `sequence seq: steps=[br, sel3], result=sel3.value`. `sel3` is a step of `seq`;
the dominator containment runs `seq → br → sel3`, so `sel3` does **not** dominate `seq`. If
§93.9's universal invariant were enforced on `sequence.result`, R1 would be **rejected** — yet
R1 is the canonical natural form of a sequence exposing its last step's value, and §93.9 itself
says *"sequence enters its control steps in array order and exposes only its explicit result ref
after all steps settle."* The reference admits R1 only because it omits the check entirely.

So §93.9 conflates two distinct relations it never separates: **demand positions** (operand read
*before* the producer has necessarily settled — must be dominator-checked) and **settle-then-read
positions** (a sequence/parallel result read *after* the producer settles by construction — safe,
not a dominator relation). Because the spec gives neither the relation split nor the demand-edge
enumeration, the slice both admits undominated reads and would reject natural Programs if the
prose were applied uniformly. (For contrast, a reachable `select` reading the same undominated
`selT` *is* correctly rejected — `P93A2-D1` — proving the check set is the variable, not the
graph machinery.)

**P0-2 — §93.8 `effectKinds` projection over "statically reachable repeat/child bodies" is
unimplementable against the §93.9 digest-reference body shape, so 93a.2 silently emits the empty
set and the approval envelope under-grants effect-kind authority. (Amended-projection
contradiction; authority circumvention.)**

§93.8: *"`effectKinds` MUST equal the sorted set of the seven effect kinds statically present in
the Program's own nodes or in statically reachable repeat/child bodies."* §93.9 defines those
bodies as opaque digest references: *"`ProgramRef = exact{kind,programId,programDigest,
resultSchema}` … `ChildProgramRef = exact{kind,program,inputSchema,resultSchema}` … A child/repeat
body is already normalized, independently approved or within the parent envelope shape, acyclic by
`programDigest`."* A `ProgramRef`/`ChildProgramRef` carries **no nodes** — only a `programDigest`.
The parent normalizer therefore cannot inspect the body's nodes, so the §93.8 projection has no
data to project. The reference hard-codes `usedEffectKinds = []` for every 93a.2 Program
(`normalize-program.mjs`), and the approval envelope (§93.8: *"`approvedEffectKinds` … retain their
template bounds"*) consequently carries `approvedEffectKinds = ∅`.

- *Counterexample:* a parent Program `P` whose `repeat r` body is a separately-normalized Program
  `B`; once 93C ships, `B` legitimately contains a `gate` (or `call`/`reduce`) effect node. Per
  §93.8, `P`'s template `effectKinds` MUST contain `gate` (a statically reachable repeat body).
  Per §93.9, `P` can only name `B` by `programDigest`, so the 93a.2 normalizer emits
  `effectKinds = ∅`; `P`'s envelope then grants `approvedEffectKinds = ∅` while `B` dispatches
  `gate`. That directly violates §93.8's closing rule: *"The projection rules above are
  exhaustive: the template cannot omit Program authority merely to obtain a smaller approval."*

The spec never picks a resolution (project by resolving the body Program's own approval? bound
transitively by the parent envelope? excluded from the projection?), so two conformant
implementations disagree and the shipped one under-grants. This is a contradiction between the
amended §93.8 projection rule and the §93.9 body shape, surfacing in-scope because both the
approval template and the body grammar land in 93a.2 (§93.24).

**P1-3 — §93.8 `repositoryScopes` projection ("every catalog role template's `pathScope` and
`contextScope`") is incompatible with §93.7 `content_ref` templates: their scopes live in an
artifact read only at replay, so they are dropped, under-granting the approval; a content_ref-only
catalog cannot be approved at all in 93a.2. (Verified.)**

§93.8: *"`repositoryScopes` MUST equal the sorted union of every catalog role template's
`pathScope` and `contextScope`."* §93.7 defines a `content_ref` template as
`exact{kind,artifact,nodeTemplateDigest,approvalDigest}` — it has **no** `pathScope`/`contextScope`
fields; those live inside the `NodeTemplate` pinned by the immutable artifact, which §93.7 says is
read only at replay ("replay reads that artifact, never current Plan/template defaults"). The
reference (`approval-template.mjs`) therefore unions scopes only from `inline` templates and
skips `content_ref`. Two consequences, both verified:

- *Un-approvable catalog:* a catalog whose only role is `content_ref` yields `repositoryScopes =
  []`, which violates the template schema `repositoryScopes = set-like … [1..policy.maxEvidenceRefs]`
  (§93.8). The normalizer throws *"repositoryScopes must contain 1..16 entries."* A legal catalog
  shape (§93.7) has no legal approval template in 93a.2.
- *Silent under-grant:* a mixed catalog with one `inline` role (`pathScope=[src], contextScope=
  [docs]`) and one `content_ref` role whose artifact template carries `pathScope=[secret]` produces
  `repositoryScopes = ["docs","src"]` — `secret` is dropped. Verified. Per §93.8 last ¶ the template
  "cannot omit Program authority merely to obtain a smaller approval"; here the content_ref role's
  real scope is omitted from the approval entirely. At runtime the content_ref template writes to
  `secret` under an envelope that granted only `{docs,src}` — either the write is wrongly blocked or
  the envelope's `repositoryScopes` is non-authoritative for content_ref roles, defeating §93.8.

The spec asserts the projection is exhaustive and replay-bound but never reconciles the two; the
deferral the reference relies on ("that projection completes with replay (93E)", per its own
comment) is not stated in §93.8.

**P1-4 — §93.9 `bound.policyDigest` has no defined preimage, yet it feeds `nodeDigest`→
`programDigest`; the reference pins the Program-policy digest, but the spec never says so, so
cross-language byte-identity (§93.4) is unsettleable from the text. (Under-specified digest
preimage, identity-affecting.)**

§93.9 (repeat and child): *"`bound=exact{kind,name,policyDigest}; kind="policy_bound";
name="program_repeat_rounds"`"* (and `program_child_depth`). The field set is given, `kind` and
`name` are pinned, but **`policyDigest` is never defined** — nowhere in §93.3–93.9, §93.20, or
§93.8 is its preimage stated (grep over the spec finds only the two field-set occurrences). The
reference (`normalize-program.mjs`, `canonicalBound`) requires `bound.policyDigest ===
policy.policyDigest` (the enclosing `ProgramPolicy.policyDigest`), and `P93A2-R2` bakes that choice
into the red suite. But `bound` is part of the repeat/child canonical node body, so
`bound.policyDigest` is an input to `nodeDigest` (§93.4 step 4) and therefore to `programDigest`.

- *Counterexample:* the §93.20 source authorities for these bounds are the Workflow policy
  (`maxRepeatRounds = Workflow policy v1 maxRounds`) and the Context policy
  (`maxChildDepth = Context Program policy v1 recursionDepth`). A faithful implementer could
  reasonably set `bound.policyDigest` to the **Workflow**-policy digest for repeat and the
  **Context**-policy digest for child (the actual owning lower authorities), or to the
  `ProgramPolicy.policyDigest` (the reference's choice). These produce different `nodeDigest`s and
  hence different `programDigest`s for the *same* Program, contradicting §93.4: *"The raw JSON
  source, Python builder, and TypeScript builder MUST … normalize to byte-identical Program
  bytes."* The spec must pin the exact digest preimage; until it does, Program identity for any
  repeat/child-bearing Program is implementation-defined.

**P1-5 — §93.5 schema-internal ceilings ("`policy.maxSchemaDefinitions`", "`policy.maxJoinMembers`")
are ambiguous in 93a.2: two distinct authorities carry same-named fields at different values, the
reference applies them inconsistently, and over-ceiling schemas are admitted. (Verified.)**

§93.5: *"It has at most `policy.maxSchemaDefinitions` members; object properties, union variants,
and string enums share that ceiling, and an array schema's `maxItems` cannot exceed
`policy.maxJoinMembers`."* In 93a.2 there are two candidate "policies": the 93a.1 Program value
authority (`createProgramValueAuthority`, with its own `maxSchemaDefinitions`/`maxJoinMembers`) and
the 93a.2 `ProgramPolicy` (§93.20, same field names). The fixture sets them to **different values**
(value-authority `maxSchemaDefinitions=64`, `maxJoinMembers=64`; `ProgramPolicy`
`maxSchemaDefinitions=32`, `maxJoinMembers=8`). The reference applies them inconsistently: the
schemas **array length** and the `collect`/`select`/`sequence` node bounds are capped by
`ProgramPolicy` (`normalize-program.mjs`), but schema-internal object-property / union-variant /
string-enum counts and array `maxItems` are capped by the **value authority** inside
`schema-values.mjs`.

- *Exploit:* a 40-property object schema is **registered** by the reference (40 < value-authority
  64), even though a literal reading of §93.5 with "policy" = `ProgramPolicy` (32) would reject it
  (properties exceed the ceiling). Verified. Likewise an array schema with `maxItems` between 9 and
  64 is admitted though `ProgramPolicy.maxJoinMembers = 8`. The spec never states which authority
  §93.5's "policy" denotes, so conformant implementations disagree on schema validity and the
  reference's split is one unjustified interpretation.

## Required corrections

1. **§93.9 — split and enumerate the dominance relations.** Replace the single universal sentence
   with two explicitly defined relations and a normative demand-edge table: (a) *demand edges* —
   the exact consumer positions that read a port whose producer may not yet have settled — which
   MUST be dominator-checked (producer dominates consumer), and (b) *settle-then-read positions*
   (`sequence.result`, `parallel.branches[].result`, `branch.{then,otherwise}.result`) whose safety
   is guaranteed by the enclosing node's settlement contract, explicitly **exempt** from the
   dominator check and explicitly required to read only ports of nodes that the enclosing node
   settles. The demand-edge table must list every checked position (`branch.predicate`,
   `await.target`, `select.candidates`, `repeat.{initial,continueWhen}`, `child.input`) **and** add
   a row that either checks or exempts each of `sequence.result`, `parallel.branches[].result`, and
   `branch.{then,otherwise}.result`, with the exact safety condition for each. Without this, the
   reference's three admitted undominated reads (P0-1) are spec-permitted and R1 is spec-rejected.

2. **§93.23 suite 4 — add dominance rows for the missing consumer positions.** The suite currently
   covers only `select` and transitive `collect` demand (`P93A2-D1`, `P93A2-D2`). Add red rows
   proving `sequence.result`, `parallel.branches[].result`, and `branch.{then,otherwise}.result`
   are each refused when they read a control-produced port that does not settle them, and a green
   row proving the R1-style `sequence.result = lastStep.value` is accepted (pinning the
   settle-then-read exemption).

3. **§93.8 — make `effectKinds` projection computable.** Either (a) state that repeat/child bodies
   contribute their effect kinds via the resolved body Program's own approval (and define the
   resolution source — e.g., the body's approval envelope, not "current state"), or (b) restate the
   projection to cover only the Program's own inline nodes and explicitly defer body-effect
   projection to the slice that normalizes bodies inline. As written, §93.8 requires data the §93.9
   body shape cannot supply (P0-2), and the 93a.2 envelope under-grants effect-kind authority.

4. **§93.8 — reconcile `repositoryScopes` with `content_ref`.** Either state that
   `repositoryScopes` unions only *staticly visible* (inline) template scopes and that content_ref
   scopes are bound by the content_ref artifact's own approval at replay (and relax the
   `repositoryScopes[1..maxEvidenceRefs]` minimum so a content_ref-only catalog is approvable), or
   require the content_ref artifact bytes to be read and revalidated at approval time so its scopes
   join the union. The current text ("every catalog role template") plus the `[1..]` minimum makes a
   content_ref-only catalog un-approvable and a mixed catalog silently under-grant (P1-3).

5. **§93.9 — define the `bound.policyDigest` preimage.** Pin the exact digest (e.g.,
   "`policyDigest` MUST equal the enclosing `ProgramPolicy.policyDigest`") for both
   `program_repeat_rounds` and `program_child_depth`, or specify the per-bound lower-authority
   digest. Until then Program identity for repeat/child-bearing Programs is implementation-defined
   and §93.4 byte-identity is unsettleable (P1-4).

6. **§93.5 — disambiguate the ceiling authority.** State explicitly whether
   `policy.maxSchemaDefinitions`/`policy.maxJoinMembers` in §93.5 denote the Program value authority
   or `ProgramPolicy`, and apply one consistently to schema-internal property/variant/enum/`maxItems`
   counts. If the value authority is intended (the 93a.1 reading), say so and confirm
   `ProgramPolicy.maxSchemaDefinitions` bounds only the schemas array length; if `ProgramPolicy` is
   intended, the reference must reject the 40-property / `maxItems>8` schemas it currently admits
   (P1-5).

7. **§93.20 / §93.24 — flag the `maxParallelBranches` binding as unenforced in 93a.2.** §93.20
   presents `maxParallelBranches` as the exact route-card/structural minimum ("a value unequal to
   its table binding … fails before effect"), but 93a.2 injects no lower-policy authorities and the
   reference accepts any positive integer (it checks only nullness and branch count). Either state
   in §93.24 that 93a.2 validates shape only and the binding proof is 93E, or inject the route-card
   authority now. (Lower severity — the deferral is documented in the reference; the spec should
   match it.)

8. **§93.20 — define "a Program with no parallel" for the serial/parallel null check.** The
   reference keys the null/non-null `maxParallelBranches` rule on the presence of any `parallel`
   *node*, but §93.9 makes unreachable nodes inert ("Execution enters only `root:ControlRef`").
   State whether an *unreachable* parallel node forces non-null `maxParallelBranches`, so an
   unreachable parallel node cannot change a Program's serial/parallel classification. (Lower
   severity.)
