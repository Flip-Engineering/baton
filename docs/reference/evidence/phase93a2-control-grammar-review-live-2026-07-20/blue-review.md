# Phase 93a.2 Program-IR slice — blue acceptance review (wave 2)

Scope: the wave-1 findings (`spec-redteam.md`, `tests-redteam.md`) checked row by row against the
amended `spec/phase93-closed-program-ir.md` §93.5/§93.8/§93.9/§93.20, the corrected
`impl/src/program-ir/{normalize-program,approval-template,control-nodes,role-catalog,program-policy}.mjs`,
`impl/test/phase93a-control-grammar-red.test.mjs`, `impl/test/fixtures/phase93a-program-fixtures.mjs`,
`impl/test/fixtures/phase93a-digest-vectors.json`, and the correction commit `8e45724`. Read-only:
no repository file was modified except this report; every exploit below was executed against the
shipped `normalizeProgramSource` in this worktree via stdin-only probes (nothing written to disk).

## Verdict

**Not accepted.** The wave-2 corrections are substantially real and the four pinned suites are
green — `node --test impl/test/phase93a-canonical-identity-red.test.mjs
impl/test/phase93a-schema-values-red.test.mjs impl/test/phase93a-source-schema-red.test.mjs
impl/test/phase93a-control-grammar-red.test.mjs` → **73 pass / 0 fail, exit 0**. All eight
spec-redteam Required corrections landed in the amended spec, and the digest circularity that made
`tests-redteam.md` P0-1/P0-2 unfalsifiable is genuinely broken: nine externally-computed literals in
`phase93a-digest-vectors.json` are wired into real assertions
(`...red.test.mjs:155,280,321,322,486,1612,1624,1673,1677`). I recomputed three of them with
`shasum -a 256` over the exact canonical bytes and all three matched, including the required non-BMP
key vector:

| Vector | Preimage | `shasum -a 256` | Fixture literal |
| --- | --- | --- | --- |
| `nonBmpKeyVector.digest` | the literal `canonicalBytesUtf16CodeUnitOrder` string in the fixture (fully external — no impl code in the preimage path) | `9d4cdc71dda603c42f9b21d88d0c2ffc31a76cd1bd461d7359406cf169845f1e` | match |
| `workerPolicyRequestDigest` | `{"access":{"mode":"full"},"autonomy":{"mode":"unattended"},"containment":{"minimum":"private_runtime","mode":"workspace_preferred"},"schemaVersion":1}` | `754c3f5f9ceb530a6cf3e0322ce3cd0684e0911f9f1da174cfedf419d7bcb2e8` | match |
| `nodeTemplateDigest` | the 5-key node template incl. nested `verificationContract`/`workerPolicyRequest` | `795e36b5e08c998819e3200bc493edea9a56058ea6b752c87890468f6249d0e4` | match |

The emitted bytes are visibly JCS-conformant (keys sorted, no whitespace, no trailing newline), and
no vector is stale. The `nonBmpKeyVector` correctly pins unsigned UTF-16 code-unit ordering: U+10000
sorts before U+E000 in the canonical bytes while sorting after it by code point.

The blocker is that the headline wave-1 defect is **only half closed**. §93.9's new settle-then-read
rule and its implementation exempt *pure data-node ports* wholesale instead of walking them
transitively, so all three P0-1 exploit shapes are re-admitted verbatim by inserting one `collect`
between the settle-then-read position and the undominated control producer. The direct forms are
correctly refused and `R1` is correctly accepted (confirmed independently, not just via `D3`), which
is exactly what makes the laundered form a check-set gap rather than a semantics choice: the
identical `collect → selT` read *is* refused when it is reached from a demand root
(`normalize-program.mjs:258-261`, pinned by `D2`). Two lower-severity defects newly introduced by
the corrections are below, plus one Required-corrections item that did not land.

## P0-P1 findings

**P0-1 — the settle-then-read check returns early for pure data producers and never walks their
port refs, so the wave-1 P0-1 exploits are re-admitted through one `collect` of indirection at all
three positions. (Unresolved; soundness gap. `impl/src/program-ir/normalize-program.mjs:292`,
`spec/phase93-closed-program-ir.md:759-760`.)**

`checkSettleThenRead` (`normalize-program.mjs:290-296`) does:

```js
const producer = records.get(ref.nodeKey);
if (!CONTROL_NODE_KINDS.includes(producer.kind)) return;   // :292
```

A `collect` producer is not a control kind, so the function returns before any settlement-domain
test — and a `collect` referenced *only* from a settle-then-read position is never visited by the
demand walk either, because `demandRoots` (`normalize-program.mjs:228-244`) enumerates only
`branch.predicate`, `await.target`, `select.candidates`, `repeat.{initial,continueWhen}`, and
`child.input`, and the demand loop skips non-control consumers outright
(`normalize-program.mjs:245-246`). The `collect` items are therefore checked by *nothing*.

Verified against the shipped normalizer (`selT` is a `select` entered only through `br`'s then-arm;
`col` is `collect{alpha: selT.value, beta: vb.value}`):

- *sequence.result:* `sequence seq: steps=[br], result=col.value; root=seq` — **ADMITTED**
  (`program`/`staticEffectOwnership` returned). The direct form `result=selT.value` is refused with
  `settle-then-read ref to selT is outside its settlement domain`.
- *branch.{then,otherwise}.result:* `branch br2: then/otherwise {control:selA, result:col.value};
  sequence seq: steps=[br,br2], result=br2.value` — **ADMITTED**.
- *parallel.branches[].result:* `parallel par: branches [{a,selA,vs.value},
  {b,selA,col.value}]; sequence seq: steps=[br,par], result=vs.value` — **ADMITTED**.
- *Control (proves the asymmetry):* the same `col` read from a demand root —
  `select sel2: candidates=[{a, col.value}]` — is refused with
  `Program node sel2 demands a port produced by selT, which does not dominate it`.

Each admitted Program is unsound in exactly the way §93.9 forbids: when `br` takes its otherwise
arm, `selT` is never entered, so settling the enclosing node requires demand evaluation to enter a
control node — which §93.9:743-744 and :779 declare must "fail before execution admission"
("Demand can never enter an effect, parallel branch, child, repeat body …"; "control reached by
demand … fail before execution admission").

The spec is complicit and must be amended alongside the code. §93.9:759-760 reads: *"Each such
`PortRef` MUST resolve either to a pure data-node port (`value`/`collect`/`context`, which demand
evaluation settles) or to a port of a control node inside the enclosing position's settlement
domain."* The parenthetical "which demand evaluation settles" is false for a `collect` whose items
reach a control port: demand evaluation *cannot* settle it. Clause 1 correctly requires "the
transitive pure-data walk (`value`/`collect`/`context` chains) from each such root"
(§93.9:750-751); clause 2 omits the identical walk. `D3`'s final row
(`...red.test.mjs:1505-1511`) actively encodes the wrong rule in its comment — *"Pure data
settle-then-read reads (value/collect/context) are always exempt from the check"* — and only passes
because its `collect` stand-in is a bare `value` node.

**P1-2 — the reachable-parallel carve-out lets an unreachable `parallel` node escape §93.9's
`branches[1..policy.maxParallelBranches]` bound entirely, and the over-bound node is still emitted
into the canonical Program. (Newly introduced by `8e45724`.
`impl/src/program-ir/control-nodes.mjs:482`.)**

The correction replaced the hard null-check with

```js
const maxBranches = policy.maxParallelBranches ?? policy.maxProgramNodes;   // :482
```

because reachability is not yet known at per-node validation time. But §93.20:2228-2230 now says an
unreachable `parallel` "never forces a non-null `maxParallelBranches`", so a Program carrying *only*
an unreachable parallel is required to set `maxParallelBranches = null` — at which point the branch
count silently falls back to `maxProgramNodes`, an unrelated structural bound that is 16× larger in
the fixture (64 vs. the `parallelPolicy` ceiling of 4). Verified: a Program whose root is `main` and
which carries an unreachable `parallel par` with **12** branches normalizes successfully under
`f.policy` (`maxParallelBranches = null`, `maxProgramNodes = 64`), and `par` is emitted into
`program.nodes` with all 12 branches — so it contributes to `programDigest` and to the
`maxProgramBytes` budget. §93.9:684 states the bound as an unconditional node-shape rule with no
reachability qualifier, and §93.20 never says the branch-count bound relaxes for inert nodes. No
execution authority is granted (the node is inert), which is why this is P1 and not P0, but the
canonical node shape is no longer the one §93.9 pins, and the error message at
`control-nodes.mjs:485` still claims a `maxParallelBranches` bound that was not applied.

**P1-3 — `tests-redteam.md` Required correction 3's two-hop collect-chain row did not land; `D2`
still tests exactly one hop, so the defect it was written to catch still ships green.
(Unresolved. `impl/test/phase93a-control-grammar-red.test.mjs:1439-1455`.)**

The wave-1 report asked for "a two-hop collect-chain dominance row (true transitivity for D2)"
because the original `D2` "packs the undominated port through a single `collect`", so a regression
that walks only one collect level passes it. The corrected `D2` builds
`selX (select, demand root) → col (collect) → selT (control)` — still a single `collect` level. The
implementation's walk (`normalize-program.mjs:258-261`) is genuinely transitive via its `walked`
set, so this is a coverage gap rather than a live bug, but the row's stated purpose is unmet: the
one-level-only regression the row exists to catch is still green. (Building it needs a second
registered object schema in `phase93a-program-fixtures.mjs`, since `fixture.collect_result` pins
`alpha:string, beta:boolean` and cannot nest itself.)

**Everything else in both wave-1 reports is closed.** Confirmed row by row:

- *spec-redteam 1 (§93.9 dominance split):* §93.9:746-768 now defines two named relations with an
  explicit demand-edge enumeration and an explicit settlement-domain closure. The direct P0-1
  exploits are refused and the R1 natural form is accepted — verified independently of `D3`, plus
  the join boundary behaves exactly as clause (c) specifies: a `sequence.result` reading a node
  inside a `first_verified` parallel's branch is **refused**, the same read inside an `all_terminal`
  parallel's branch is **admitted**. Subject to P0-1 above.
- *spec-redteam 2 (suite-4 dominance rows):* `P93A2-D3` pins all three exploits plus the R1 green
  row (`...red.test.mjs:1457-1512`).
- *spec-redteam 3 (§93.8 `effectKinds`):* §93.8:600-604 now scopes the projection to "the Program's
  own nodes" and states bodies are bound by their own envelopes; `approval-template.mjs:1-14`
  matches.
- *spec-redteam 4 (§93.8 `repositoryScopes` / `content_ref`):* §93.8:591,605-609 now says **inline**
  only and relaxes the bound to `[0..policy.maxEvidenceRefs]`; `approval-template.mjs:109` changed
  `min: 1` → `min: 0`; the content_ref-only catalog is approvable (`...red.test.mjs:444-447`).
- *spec-redteam 5 (`bound.policyDigest`):* pinned at §93.9:721-723.
- *spec-redteam 6 (§93.5 ceiling authority):* disambiguated at §93.5:288-293 in favour of the
  Program value authority, matching the shipped split.
- *spec-redteam 7/8 (`maxParallelBranches` deferral, serial classification):* §93.20:2228-2232 marks
  the 93E deferral and defines reachability; `normalize-program.mjs:152-170` implements it and
  `P93A2-P3` pins the unreachable case. Subject to P1-2 above.
- *tests-redteam P0-1/P0-2 (circularity):* closed by the nine externally-computed vectors, verified
  above.
- *tests-redteam P0-3 (S1 by name):* `...red.test.mjs:791-798` now deep-equals `outputSchema` and
  the full canonical `PortRef` shape of both items.
- *tests-redteam P1-1 … P1-11:* landed as `PERM1` (preference order semantic + all three set-like
  lists sorted), `DUP1`, `SELV1`, `J2`, `DOM1` (await/predicate-operand/`repeat.initial`/
  `child.input` + predicate self-edge at :1232), `BYTES1`, `VC1`, `K5`, `RV1`, `BOUND1`, `RAW2`,
  `CTX1` nested-impure (:601-615), unsorted `repositoryScopes` (:464), two-role catalog (:467), `C5`
  `nodeTemplateDigest` mismatch (:413), `A1` non-handle control producer (:845). `P2` drives all 14
  `NUMERIC_FIELDS` × `{0,-1,1.5,'8'}` plus `maxParallelBranches` (:192-203); `P1` formats all 8
  digest fields (:166-172); `N1` probes every exact field of every kind and the `value` probe now
  uses a distinct `vprobe` nodeKey (:504-531).
- *Recursion/ordering safety of the new code:* `settlementDomain`
  (`normalize-program.mjs:274-289`) recurses without an in-progress marker, but all three
  `detectCycle` passes run first (`normalize-program.mjs:181-183`) and unknown/self refs are
  rejected at :123-144, so no cyclic or dangling input can reach it. The reachability walk at
  :155-162 is visited-set guarded. No stack-overflow or crash path found.

## Required corrections

1. **Close P0-1 in both spec and code.** In §93.9 clause 2, replace the blanket pure-data exemption
   at :759-760 with the same transitive walk clause 1 already carries: a settle-then-read `PortRef`
   that resolves to a `value`/`collect`/`context` port MUST have every port transitively reachable
   through that pure-data chain resolve either to another pure data node or to a control node inside
   the position's settlement domain. In `normalize-program.mjs:290-296`, replace the `:292` early
   return with a `walked`-guarded stack that mirrors `:258-261` — on a `collect` producer, push
   `producer.source.items.map((item) => item.value)` and re-test each — so the settlement-domain
   test applies at the end of every pure-data chain, not only at its head.
2. **Pin the laundered exploits in `D3`.** Add three rows to `P93A2-D3` mirroring its existing three,
   each interposing a `collect` between the settle-then-read position and `selT`
   (`sequence.result = col.value`, `branch.{then,otherwise}.result = col.value`,
   `parallel.branches[].result = col.value`), and correct the `:1505` comment: pure-data reads are
   exempt from the *dominator* check, not from the settlement-domain check. Keep the existing
   `value`-node green row so the genuine exemption stays pinned.
3. **Restore the §93.9 branch-count bound for unreachable parallels (P1-2).** Either move the
   `branches[1..maxParallelBranches]` count check out of `validateSourceNode` into the Program-level
   pass where reachability is known (checking reachable parallels against
   `policy.maxParallelBranches` and unreachable ones against the same value when non-null), or state
   in §93.20 that an inert parallel's branch count is bounded by `maxProgramNodes` and fix the
   misleading message at `control-nodes.mjs:485`. Silently substituting `maxProgramNodes` for a
   concurrency bound is the substitution §93.20:2241-2244 explicitly forbids. Add a red row: an
   unreachable `parallel` whose branch count exceeds `parallelPolicy.maxParallelBranches` must be
   refused (or, if the relaxation is intended, a green row that says so and pins the bound actually
   applied).
4. **Land the two-hop collect-chain row (P1-3).** Register a second object schema in
   `phase93a-program-fixtures.mjs` (e.g. `fixture.collect_outer` with one `fixture.collect_result`
   property) so `colOuter ← colInner ← selT` is constructible, and add the row to `P93A2-D2` so a
   one-level-only walk fails it. Once correction 1 lands, add the same two-hop shape to the
   settle-then-read rows in `D3`.
5. **Re-run the pinned contract after the fixes.** `node --test
   impl/test/phase93a-canonical-identity-red.test.mjs impl/test/phase93a-schema-values-red.test.mjs
   impl/test/phase93a-source-schema-red.test.mjs impl/test/phase93a-control-grammar-red.test.mjs`
   from the worktree root, expecting exit 0. Note that corrections 1 and 3 will change canonical
   admission but not canonical *bytes* for any currently-legal Program, so the nine digest literals
   in `phase93a-digest-vectors.json` should remain valid; if any of them shifts, that is itself a
   finding and the new literal must again be produced by `shasum -a 256` over externally inspected
   bytes rather than by the implementation under test.
