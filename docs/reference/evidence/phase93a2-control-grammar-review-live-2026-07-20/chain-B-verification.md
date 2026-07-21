# Chain B verification — adversarial review of chain A's claims

Verifier: chain member B. Chain A artifact: pinned commit
`7c5246eea5c46e6baee706f89dcf29630e18bb85`, path
`docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/chain-A-claims.md`.
Verified against the working tree at HEAD (`9d78b76`), files
`impl/src/program-ir/{normalize-program,approval-template,role-catalog,control-nodes,canonical-value}.mjs`
and `spec/phase93-closed-program-ir.md`.

Pinned verification command run before writing this report:
`node --test impl/test/phase93a-control-grammar-red.test.mjs` → `tests 55 / pass 55 / fail 0`,
exit 0.

## Verdict

Chain A's substantive review is **sound**. All eight asserted claims (1–8) are CONFIRMED against
HEAD, with two cosmetic line-citation drifts noted (claims 4 and 7) that do not change any
conclusion. Both UNCERTAIN claims (9, 10) resolve in chain A's favour:

- **Claim 9** — the safety conclusion is CONFIRMED; no counterexample Program exists. However, one
  *mechanism* sub-assertion inside claim 9 is REFUTED: `keyByNodeId` is last-write-wins, not
  "first one dequeued". The correction is immaterial to the safety argument, because the coalesced
  source records are provably interchangeable for the field the check reads.
- **Claim 10** — CONFIRMED. `compareProgramIdentityKeys` is unsigned UTF-16 code-unit comparison,
  and the residual supplementary-plane worry is doubly moot because role names are `SafeId`
  (ASCII-only).

One incidental finding outside chain A's claim set is recorded in §Counterexamples (C3): the
`settlement_value` / `branch`-member admitted-branch check is *over*-restrictive (fail-closed), not
under-restrictive. It is a completeness gap, not a soundness hole, and is reported for the record
rather than as a refutation of any chain A claim.

## Claim dispositions

| # | Disposition | Evidence |
|---|---|---|
| 1 | CONFIRMED | `normalize-program.mjs:155-162` — DFS seeded with `[rootKey]` (`:156`) pushes `records.get(key).controlRefs` only (`:161`); `record.dataRefs` never enters the stack. `:163-164` computes `hasReachableParallel`. Both consistency refusals present: `:165-167` (no reachable parallel but `maxParallelBranches !== null`) and `:168-170` (reachable parallel but `=== null`). Spec §93.20 `spec/phase93-closed-program-ir.md:2254-2256` ("keys on `parallel` nodes reachable from *that Program's own* `root` through control edges, and an unreachable `parallel` node is inert"). Cited range exact. |
| 2 | CONFIRMED | `normalize-program.mjs:175-180` — the `branches.length > policy.maxParallelBranches` refusal lives inside `for (const key of controlReachable)`, so a parallel absent from that set is never tested. The pure-shape ceiling is `control-nodes.mjs:482-484` (`node.branches.length > policy.maxProgramNodes`), cited exactly, with the in-source rationale at `control-nodes.mjs:477-481`. Spec `:685-691` states the same two-tier bound. Cited ranges exact. |
| 3 | CONFIRMED | `normalize-program.mjs:238-254` — `branch` → `predicatePortRefs(node.predicate)` (`:242`); `await` → `[node.target]` (`:244`); `select` → `node.candidates.map(c => c.value)` (`:246`); `repeat` → `[node.initial, ...predicatePortRefs(node.continueWhen)]` (`:248`); `child` → `[node.input]` (`:250`); `default: []` (`:252`). One-to-one with §93.9 clause 1's enumeration at `spec:757-761`. Cited range exact. |
| 4 | CONFIRMED (citation drift) | `normalize-program.mjs:255-273` — the "does not dominate it" refusal (`:264-267`) is guarded by `CONTROL_NODE_KINDS.includes(producer.kind)` (`:263`); the only transitive extension is the `collect` arm (`:268-271`) pushing `producer.source.items.map(i => i.value)`. Any other producer kind falls through both arms and terminates the walk unchecked. Matches `spec:762` and `spec:770-773`. Drift: the loop body is `:255-273` but the closing brace of the enclosing `for` is `:273`; the walk proper is `:258-272`. Nuance worth stating: `context` producers cannot actually be reached in 93a.2 — `contextNodeRefusal` (`:56-68`, invoked at `:111`) fails closed before graph construction — so chain A's parenthetical "would-be `context`" is the correct framing, and the fall-through behaviour it describes is what a future `context` producer would get. |
| 5 | CONFIRMED | `normalize-program.mjs:287-302` — `domain` starts as `new Set([key])` (`:290`); extended only under `record.kind === 'sequence'` (`:291-294`, unioning each step's recursive domain) or `record.kind === 'parallel' && record.source.join.kind === 'all_terminal'` (`:295-299`, unioning each branch's control-chain domain). No other kind reaches an extension, so `branch` and non-`all_terminal` `parallel` return exactly `{key}`. Matches `spec:778-783` verbatim ("A `branch` node contributes only itself to any domain … a non-`all_terminal` `parallel` node likewise contributes only itself"). Cited range exact. |
| 6 | CONFIRMED | `normalize-program.mjs:320-331` — `sequence` keys on `key` (`:322`); each `parallel` branch keys on `branch.control.nodeKey`, *not* the parallel's `key` (`:325`); each `branch` arm keys on `then.control.nodeKey` / `otherwise.control.nodeKey`, *not* the branch node's `key` (`:328-329`). Matches `spec:774-778` ("keyed per position, not per enclosing node … `parallel.branches[b].result` is keyed on branch `b`'s own control node, regardless of the parallel's join kind"). Note the spec's "regardless of the join kind" is satisfied: `:325` is unconditional on `join.kind`, unlike the domain-*expansion* rule at `:295`. Cited range exact (A wrote 320-330; the loop closes at `:331`). |
| 7 | CONFIRMED (citation drift) | The literal is `const usedEffectKinds = [];` at `normalize-program.mjs:117` (A's `:114-120` covers it, but `:114-116` are the explanatory comment); it is passed unmodified at `:118-120`. `approval-template.mjs:51` sets `effectKinds = [...new Set(usedEffectKinds)].sort(compareProgramIdentityKeys)` (A's `:46-51` includes the input-shape guard at `:46-49`). Equality against the author-supplied template is enforced at `approval-template.mjs:130-134`, so a non-empty `effectKinds` is refused, not merely unused. The "no effect node" premise holds structurally: `control-nodes.mjs:18-22` defines the closed kind set as seven control kinds plus `collect/context/value` — none of the seven `EFFECT_KINDS` (`approval-template.mjs:26-28`) is a source node kind. Matches `spec:600-604`. |
| 8 | CONFIRMED | `approval-template.mjs:52-58` — `if (role.templateBinding.kind !== 'inline') continue;` (`:54`) precedes every read of `nodeTemplate.pathScope` / `.contextScope` (`:55-56`), so a `content_ref` role contributes nothing to `scopes`. Enforced against the author's template at `:135-138`. Matches `spec:605-609` ("A `content_ref` template's scopes … are never restated in the template … a catalog whose roles are all `content_ref` carries an empty `repositoryScopes` projection"). Cited range exact. |
| 9 | CONFIRMED (safety conclusion) / one sub-assertion REFUTED | Safety: CONFIRMED — see counterexample attempt C1; no admissible Program makes two source records share a coalesced `nodeId` while disagreeing on admitted branch names. Sub-assertion REFUTED: chain A describes `keyByNodeId` (`normalize-program.mjs:605`) as recording "whichever source `key` happened to be the **first** one dequeued". `:596-607` iterates *every* candidate sharing `chosen.nodeId` and calls `keyByNodeId.set(candidate.nodeId, candidate.key)` unconditionally, so the map retains the **last** such key, not the first. The correction does not disturb the conclusion (C1 shows the keys are interchangeable for the field read at `:513`), but the stated mechanism is wrong as written. Also note the check is well-ordered: `constructNode` runs at `:577`, and the envelope candidate's producer is a data ref of the `select`, hence constructed in a strictly earlier Kahn round (`:570-574`), so `keyByNodeId` is always populated for the id looked up at `:511`. The `?.` at `:512` and the falsy default at `:514-519` mean even a miss fails closed. |
| 10 | CONFIRMED | `canonical-value.mjs:67-72` — `compareProgramIdentityKeys` is `left < right ? -1 : left > right ? 1 : 0` after a string-type guard. JS abstract relational comparison on strings is code-unit-wise on UTF-16 units, i.e. exactly the unsigned UTF-16 order §93.8 requires (`spec:625-626`, and the same convention at `spec:144`, `:234`). There is no `localeCompare`, no `Intl.Collator`, and no default `Array.prototype.sort` string coercion anywhere on this path. The relied-upon sort is present and exact at `role-catalog.mjs:221` (`roles.sort((left, right) => compareProgramIdentityKeys(left.role, right.role))`), applied after the duplicate-role refusal at `:220`, and `approval-template.mjs:59-69` consumes `catalog.roles` in that already-sorted array order. The supplementary-plane divergence chain A could not rule out is additionally impossible by construction: role names pass `safeId` (`role-catalog.mjs` → `control-nodes.mjs:59-63`) against `SAFE_ID = /^[A-Za-z0-9._:@/-]{1,512}$/u` (`control-nodes.mjs:15`), which admits no non-ASCII code unit, let alone a surrogate pair. See C2. |

## Counterexamples

All three constructions below are **in-memory reasoning only**. No fixture, scratch file, or
temporary artifact was written anywhere on disk; the only file this task created is this report.

### C1 — attempted counterexample to claim 9 (coalesced envelope producer with divergent admitted branches) — FAILED to construct

Target: a Program where `records.get(keyByNodeId.get(envelopeCandidates[0].value.nodeId))`
(`normalize-program.mjs:511`) resolves to a source record whose `source.target.nodeKey`
(`:513`) leads to a `parallel` with a *different* branch-name set than the record the author
intended, letting `selector.member.name` be admitted (or wrongly refused) at `:514-515`.

Construction attempt: two `await` source records `A1`, `A2` with `A1.target.nodeKey = P1` and
`A2.target.nodeKey = P2`, where `P1` and `P2` are distinct `parallel` source keys with different
branch names (say `{alpha, beta}` vs `{alpha, gamma}`), arranged so `A1` and `A2` coalesce to one
`nodeId` and `keyByNodeId` retains the "wrong" one.

Why it cannot be built:

1. Coalescing is byte-identity of the *constructed body*, not of the source (`:578-580`,
   `nodeId = "pnode:" + digest(body)`). The `await` body is
   `{kind, target, join, outputSchema}` (`:487`), and `target = portRefFor(node.target)` carries
   `{nodeId, port, schema}` (`:354`). So `A1` and `A2` coalesce **only if**
   `constructed.get(P1).nodeId === constructed.get(P2).nodeId`.
2. That in turn requires `P1` and `P2` to have byte-identical `parallel` bodies
   (`{kind, branches, join, outputSchema}`, `:460`), and `branches` embeds every `branch.name`
   verbatim (`:449`, sorted at `:452`). Byte-identical bodies therefore force identical name sets —
   `{alpha, beta} ≠ {alpha, gamma}` makes the digests differ and the coalescing premise fails.
3. The check at `:515` reads `targetRecord.source.branches` (the **source** array), not the
   constructed one. This does not reopen the gap: `:449` copies `branch.name` through unchanged and
   `control-nodes.mjs:486-491` rejects duplicate names, so the source name *set* and the constructed
   name *set* are equal for every admissible `parallel`. Sorting at `:452` reorders but does not
   alter membership, and `:515` is a `.some(...)` membership test, so order is irrelevant.
4. Schema-ref digest aliasing (chain A's named residual worry) cannot help: aliasing could at most
   make two *different* schema definitions produce the same `outputSchema` ref, which affects the
   `outputSchema` field of the body, never the `branches[].name` strings. Two parallels differing
   only in schema aliasing still agree on admitted branch names, so the check's answer is unchanged.
5. Last-write-wins at `:605` (the mechanism chain A mis-stated) is therefore harmless: every source
   key mapped to a given `nodeId` yields the same answer at `:514-515`, so *which* one wins is not
   observable by this check.

Result: **no counterexample exists**. Claim 9's conclusion is CONFIRMED; only its description of
`keyByNodeId`'s tie-break is wrong.

### C2 — attempted counterexample to claim 10 (role-name ordering divergence) — FAILED to construct

Target: two catalog role names `R1`, `R2` for which `compareProgramIdentityKeys` disagrees with
§93.8's "entries sort by unsigned UTF-16 role name", producing a constraint-digest preimage in the
wrong order at `approval-template.mjs:59-69`.

Construction attempt: the classic supplementary-plane pair — `R1 = "role\u{1D400}"` (surrogate pair
`D835 DC00`) and `R2 = "role�"` (single unit `FFFD`). Under unsigned UTF-16 code-unit order,
`D835 < FFFD` so `R1 < R2`; under code-*point* order, `U+1D400 > U+FFFD` so the ordering flips. A
comparator that normalised to code points, or used `localeCompare`, would diverge here.

Why it cannot be built:

1. `compareProgramIdentityKeys` (`canonical-value.mjs:67-72`) uses the bare `<` / `>` operators.
   JS abstract relational comparison on two strings is defined as code-*unit*-wise lexicographic on
   UTF-16 units — exactly the required order. On the pair above it returns `R1 < R2`, which is the
   spec's answer. No divergence, even hypothetically.
2. The pair is unconstructible in the first place: role names are `safeId`-gated against
   `/^[A-Za-z0-9._:@/-]{1,512}$/u` (`control-nodes.mjs:15,59-63`). Neither `\u{1D400}` nor `�`
   is admissible, and for the ASCII-only alphabet that survives the gate, code-unit order,
   code-point order, and byte order all coincide.
3. A lone-surrogate smuggling route is separately closed: `canonical-value.mjs:74+`
   (`hasLoneSurrogate`) rejects unpaired surrogates in Program strings before any comparison.

Result: **no counterexample exists**. Claim 10 is CONFIRMED with the residual concern eliminated on
two independent grounds.

### C3 — incidental: over-restriction in the `settlement_value` / `branch`-member check (fail-closed, not a soundness hole)

Not a refutation of any chain A claim; recorded because it surfaced while attempting C1.

`normalize-program.mjs:510-519` admits a `branch`-member `settlement_value` selector **only** when
the sole `baton.settlement_envelope`-schema'd candidate is produced by an `await` node whose
`target` is a `parallel` (`:512-515`). But other node kinds legitimately publish a port whose
resolved schema name is `baton.settlement_envelope`:

- a `repeat` node's `settlement` port (`:528-529, 545`) is bound to `baton.settlement_envelope`
  by construction;
- a `sequence`, `branch`, or `select` node whose `outputSchema` happens to resolve to the registered
  `baton.settlement_envelope` definition (`:413`, `:431`, `:497`) also matches the
  `envelopeCandidates` filter at `:499-501`.

In each of those cases `producerRecord.kind` is not `'await'`, so `targetRecord` is `null` (`:513`),
`admitted` is `false` (`:514`), and normalization refuses at `:516-519`. That is the safe direction —
the check never *admits* an unadmitted branch name — so it is a completeness gap rather than a
soundness gap, and it does not disturb claim 9. Flagged for a future slice in case a `repeat`-produced
envelope is meant to be selectable; no change is proposed here.
