# Chain D successor — independent refutation attempt against the clean verdict

Reviewer: chain member D (dynamic-topology successor). Upstream artifact under attack:
`chain-C-synthesis.md` verdict "specification-sound, no P0/P1 residue", itself built on chain A
claims (`7c5246eea5c46e6baee706f89dcf29630e18bb85`) and chain B verification
(`d53eccddee2310dd56295a0d4e4990ce7aba0dba`). D's attack surface is disjoint from B's: B's
counterexamples C1–C2 targeted claims 9–10 (coalescing tie-break, role-name ordering) and C3
characterized the `settlement_value` admitted-branch over-restriction. D attacks only the amended
§93.9 settlement-domain (clause 2) and demand-edge (clause 1) relations themselves, reimplemented
from the spec text at `spec/phase93-closed-program-ir.md:757-793` before reading the
implementation's defense in `impl/src/program-ir/normalize-program.mjs:195-331`.

All constructions below are **in-memory only**: every probe ran as a single `node -e` process
calling `normalizeProgramSource` against `impl/test/fixtures/phase93a-program-fixtures.mjs`. No
fixture, scratch, or temporary file was written anywhere (including `/tmp`); the only file this
task created is this report. Pinned verification run before writing:
`node --test impl/test/phase93a-control-grammar-red.test.mjs` → `tests 55 / pass 55 / fail 0`,
exit 0.

## Verdict

**Refutation FAILED; the clean verdict stands.** Sixteen adversarial Programs were constructed and
executed against the normalizer, each designed so that the amended §93.9 settlement-domain or
demand-edge rules would either (a) accept a Program whose controlling read can observe an unsettled
producer (soundness hole), or (b) reject a Program the spec text admits (wrongful rejection). Every
probe produced the spec-mandated verdict: 9 correct refusals, 7 correct admissions, 0 divergences.
The two nearest misses (D1, E3b) resolve in the implementation's favour on spec text, not on
charity: D1 is the standard vacuous-dominance convention applied to an inert (unreachable) node and
is additionally backstopped by byte-identity coalescing (D9); E3b's refusal is verbatim what the
amended clause-2 text mandates ("a non-`all_terminal` `parallel` node likewise contributes only
itself"), i.e. spec-level conservatism, not an implementation divergence. No P0/P1 residue found;
D concurs with chain C that C3 remains a fail-closed completeness gap outside the soundness
boundary and proposes no change for this slice.

## Refutation attempts

Each entry: the attack hypothesis, the constructed Program (fixture node-key shorthand), the
observed verdict, and why it does or does not refute. "dom(X)" = the implementation's computed
dominator set; "domain(X)" = the §93.9 clause-2 settlement domain.

### Batch 1 — settlement-domain closure and per-position keying

- **D3a/D3b — join-kind-gated domain extension (must refuse, then must accept).** `S = sequence[P]`
  with `P = parallel{b1: control C1}` and `S.result = C1.value`. With
  `join = first_verified([b1])`: REJECT ("settle-then-read ref to C1 is outside its settlement
  domain") — domain(S) = {S, P} since a non-`all_terminal` parallel contributes only itself. With
  `join = all_terminal`: ACCEPT — domain(S) = {S, P, C1} via clause (c). Both directions of the
  amended extension rule fire on exactly the spec's condition (`normalize-program.mjs:295`). No
  divergence.
- **D4 — cross-branch read under `all_terminal` (must refuse).** `P = parallel{b1: C1, b2: C2}`
  `all_terminal`, `b1.result = C2.value`. REJECT: keyed on domain(C1) = {C1}, per "each branch keys
  its own domain … one branch's settle-then-read position can never read a *different* branch's
  control port" (spec:782-784; `normalize-program.mjs:325`). The per-position keying is not
  silently widened by the `all_terminal` closure. No divergence.
- **D5 — transitive (b)+(c) closure (must accept; a wrongful rejection here refutes).**
  `S = sequence[P]`, `P = parallel{b1: Q}` `all_terminal`, `Q = sequence[C1]`,
  `S.result = C1.value`, `b1.result = C1.value`. ACCEPT: domain(S) = {S, P, Q, C1}, exactly the
  spec's smallest closure under (a)/(b)/(c). The recursion at `normalize-program.mjs:287-302` is
  neither under- nor over-closed on a three-level nest. No divergence.
- **E3a/E3b — arm keying composed with join kind, one level deeper (nearest miss #2).** Branch `B`
  whose then-arm control is `Q = parallel{b1: C1}`, then-arm result `C1.value`. `all_terminal`:
  ACCEPT (domain(Q) closes over its branch). `first_verified([b1])` — with a **single** branch, so
  C1 is guaranteed to settle before Q does: REJECT. This is semantically conservative but is the
  amended text verbatim ("regardless of the parallel's join kind" governs keying; domain extension
  is `all_terminal`-only). A reviewer could call the spec over-strict here; the implementation
  cannot be called divergent. No refutation.

### Batch 2 — demand-edge dominance, walk, and graph faithfulness

- **D6 — sibling-branch demand (must refuse).** `P = parallel{b1: C1, b2: C2}`, `C2 = select` with
  candidate `C1.value`. REJECT ("demands a port produced by C1, which does not dominate it"):
  dom(C2) = {P, C2}. Concurrent branches correctly fail clause 1.
- **D7 — demand through a `collect` hop (must refuse).** Same as D6 but the candidate is
  `K = collect{alpha: C1.value, beta: v2.value}` (derived schema registered as
  `fixture.collect_result`). REJECT with the same dominance refusal, proving the transitive
  pure-data walk (`normalize-program.mjs:268-271`) extends clause 1 through collect items rather
  than stopping at the data node. The refusal fires before construction, so the walk cannot be
  laundered through an unregistered derived schema either.
- **E2 — later-step demand in one sequence (must refuse).** `S = sequence[S1, S2]`,
  `S1 = select` candidate `S2.value`. REJECT: dom(S1) = {S, S1}; the chain edges
  (`addDomEdge(previous, step)`) order steps, so a producer later in array order never dominates an
  earlier consumer. Confirms the dom-graph chain abstraction is not accidentally symmetric.
- **E4 — arm-internal demand to an earlier arm-chain producer (must accept).** `B` then-arm control
  `T = sequence[P1, A]`, `A = select` candidate `P1.value`. ACCEPT: dom(A) = {B, T, P1, A}. A
  wrongful rejection here would have refuted from the completeness side.
- **E1 — arm node demanding its enclosing branch's own value port (must refuse).** `A = select`
  candidate `B.value`, with `A` the then-arm control of `B`. Dominance alone would **pass**
  (B dominates its own arm), but `B` publishes its value port only after the arm settles — a
  circular wait. REJECT, by the combined control/data cycle check
  (`detectCycle(unionEdges)`), which is the designed backstop: every control-descent path from an
  ancestor to the consumer plus the demand ref back to the ancestor is a union cycle. Clause 1
  relies on this ordering (cycles refused at `normalize-program.mjs:191-193`, before dominance at
  `:255`), and the ordering holds.
- **D10 — root as demand consumer (must refuse).** root `main = select` candidate `S.value`,
  `S = sequence[P1]`. REJECT: dom(root) = {root}, so no control producer can ever serve a root's
  demand edge — the spec's "every `await` is therefore dominated by the handle producer it awaits"
  generalizes correctly to "nothing settles before root".
- **D8/D8b — await/handle self-reference and the positive case.** D8: `A = await` target
  `P.handle` with `A` itself the sole branch control of `P` → REJECT (union cycle), closing the
  await-inside-own-parallel hole without needing the dominance check. D8b:
  `S = sequence[P, A]`, `A = await` on `P.handle`, `S.result = A.settlement` → ACCEPT (dominance
  via chain edge; settle-then-read via domain(S) ∋ A; byte-identical embedded join). Both
  directions correct.

### Batch 3 — reachability and coalescing edge cases

- **D1 — unreachable demand consumer, vacuous dominance (nearest miss #1).** Reachable
  `S = sequence[A]`; unreachable branch `U` whose predicate reads `A.value` (A cannot dominate U
  under any path-based reading, since no root→U path exists). ACCEPT, because the dataflow
  computation initializes non-root dominators to all-keys and an unreachable node keeps them —
  i.e. the standard convention under which "every node dominates an unreachable node" is vacuously
  true, matching the classic definition (universally quantified over an empty path set). This is
  the one place the implementation *could* have been accused of a wrongful accept; it fails
  because (i) §93.9 does not carve out unreachable nodes and §93.20 explicitly classifies
  unreachable nodes as inert, so the accepted read can never execute; (ii) the asymmetry D1b
  exposes is fail-safe, not fail-open. Not a divergence — but it is the weakest spot in the slice
  and is recorded here so a future reviewer does not re-derive it.
- **D1b — the asymmetry is fail-safe.** Unreachable `U2 = sequence[X]` with `U2.result = A.value`
  (A outside domain(U2)): REJECT. Clause 2 is applied strictly even to inert nodes while clause 1
  is vacuous — the asymmetry runs in the safe direction (demand acceptance on inert nodes is
  harmless; settle rejection on inert nodes is merely conservative).
- **D9 — cross-domain coalescing (must not launder domain membership).** `X` and `X2` are
  byte-identical `select{a: v1}` nodes; `X2` sits inside an `all_terminal` parallel branch, `X` is
  a step of the root sequence. ACCEPT with **4 canonical nodes emitted from 5 source keys** —
  coalescing confirmed to actually occur in the tested program. Per-source-key checks run before
  coalescing, and byte-identity of bodies forces identical control/data refs, so the merged
  nodeId can add no control-flow path that bypasses a dominator: the node is *entered* (and
  settles) at every position that references it. The scenario D feared — a read admitted against
  domain membership of one source key resolving at runtime to an unsettled twin — is
  unconstructible for the same reason B's C1 was. No divergence.

### Result tally

9 refusals and 7 admissions, all matching the §93.9 amended text; 0 Programs wrongly accepted, 0
wrongly rejected. The two nearest misses (D1 vacuous dominance on inert nodes; E3b
single-branch `first_verified` conservatism) are spec-conventions and spec-mandated strictness
respectively, not implementation defects. The clean verdict of `chain-C-synthesis.md` survives
independent refutation; pinned suite green at 55/55.
