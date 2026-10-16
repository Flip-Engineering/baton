# Chain C synthesis — Phase 93a.2 corrected slice final disposition

Synthesizer: chain member C. Upstream immutable artifacts:

- A claims at `7c5246eea5c46e6baee706f89dcf29630e18bb85`
  (`docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/chain-A-claims.md`)
- B verification at `d53eccddee2310dd56295a0d4e4990ce7aba0dba`
  (`docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/chain-B-verification.md`)

C's adjudication is independent of B's: the cited code locations were re-read directly in this
worktree (`impl/src/program-ir/normalize-program.mjs`, `approval-template.mjs`,
`canonical-value.mjs`, `role-catalog.mjs`, `control-nodes.mjs`) before any disposition was
accepted. Pinned verification run before writing this report:
`node --test impl/test/phase93a-control-grammar-red.test.mjs` → `tests 55 / pass 55 / fail 0`,
exit 0.

## Verdict

The corrected Phase 93a.2 slice is **specification-sound**. All ten chain A claims are upheld as
corrected by chain B: claims 1–8 stand as asserted (two with cosmetic line-citation drift only);
claim 9's safety conclusion stands with its one mechanism mis-statement (`keyByNodeId` is
last-write-wins, not first-dequeued) corrected and proven immaterial; claim 10's residual worry is
eliminated on two independent grounds. B's adversarial counterexample program (C1, C2) failed to
produce any counterexample, and B's only incidental finding (C3) is a fail-closed completeness gap
outside the soundness boundary. No claim requires further correction, and the pinned red test suite
passes 55/55 in this worktree.

## Disposition table

| # | A position | B disposition | A vs B agreement | C adjudication |
|---|---|---|---|---|
| 1 | Asserted: `controlReachable` DFS pushes only `controlRefs`; both serial/parallel consistency refusals implement §93.20 | CONFIRMED, citations exact | Agree | **Upheld.** Re-read `normalize-program.mjs:155-170`: stack seeded `[rootKey]`, pushes `controlRefs` only (`:161`); both refusals present (`:165-170`). Matches §93.20. |
| 2 | Asserted: `maxParallelBranches` bound applied only inside `controlReachable` iteration; inert parallel bounded by `maxProgramNodes` in `control-nodes.mjs:482-484` | CONFIRMED, citations exact | Agree | **Upheld.** `:175-180` iterates `controlReachable` only; `control-nodes.mjs:482-484` enforces the pure-shape ceiling with the two-tier rationale at `:477-481`. |
| 3 | Asserted: `demandRoots` enumerates the five §93.9 clause-1 root positions one-to-one | CONFIRMED, citations exact | Agree | **Upheld.** `:238-254` matches A's enumeration arm for arm, including the `default: []` fall-through. |
| 4 | Asserted: dominance failure fires only for control-kind producers; walk extends only through `collect` | CONFIRMED with citation drift (walk proper is `:258-272`, loop closes `:273`) | Agree on substance | **Upheld, with B's drift note accepted.** `:263` guards on `CONTROL_NODE_KINDS`; `:268-271` is the only transitive extension. B's added nuance — `context` producers are unreachable in 93a.2 because `contextNodeRefusal` (`:111`) fails closed first — is verified at `:111` and is the correct framing of A's "would-be `context`" parenthetical. |
| 5 | Asserted: `settlementDomain` extends only for `sequence` or `all_terminal` `parallel`; `branch`/non-`all_terminal` return exactly `{key}` | CONFIRMED, citations exact | Agree | **Upheld.** `:287-302`: domain starts `{key}` (`:290`); only the two extension arms (`:291-299`) exist. |
| 6 | Asserted: settle-then-read keyed per position — `key` for sequence, branch's own `control.nodeKey` for parallel branches, arm `control.nodeKey` for branch arms | CONFIRMED (loop closes `:331`, A wrote `:330`) | Agree on substance | **Upheld.** `:322`, `:325`, `:328-329` key exactly as asserted; `:325` is unconditional on `join.kind`, satisfying the spec's "regardless of the parallel's join kind." |
| 7 | Asserted: `usedEffectKinds` is literal `[]`, so `effectKinds` projection is unconditionally `[]` | CONFIRMED with citation drift (literal at `:117`; `:114-116` are comment) | Agree on substance | **Upheld.** `:117` declares the literal, passed unmodified at `:118-120`; `approval-template.mjs:51` dedup-sorts it. B's addition that author-supplied non-empty `effectKinds` is actively refused (`:130-134`) strengthens, not alters, the claim. |
| 8 | Asserted: `repositoryScopes` skips non-`inline` bindings, so `content_ref` roles contribute nothing | CONFIRMED, citations exact | Agree | **Upheld.** `approval-template.mjs:54` `continue`s before any scope read (`:55-56`); enforced against author templates at `:135-138`. |
| 9 | UNCERTAIN: admitted-branch check via `keyByNodeId` believed safe; mechanism described as "first one dequeued" | Safety CONFIRMED (C1 failed); mechanism sub-assertion REFUTED — last-write-wins, immaterial | Partial: B corrects A's mechanism, accepts A's conclusion | **Upheld as corrected by B.** Re-read `:596-607`: `keyByNodeId.set` runs unconditionally for every coalesced candidate (`:605`), so last-write-wins is correct and A's "first dequeued" is wrong. B's C1 argument is sound: coalescing is byte-identity of the constructed body (`:578-580`), and `branches[].name` is embedded verbatim in that body (`:449-452`), so coalesced parallels cannot disagree on admitted branch names; which key wins is unobservable at `:514-515`. Lookup is also well-ordered (producer constructed in an earlier Kahn round) and fails closed on a miss (`:512`, `:514-519`). |
| 10 | UNCERTAIN: constraint digests rely on `role-catalog.mjs:221`'s sort; `compareProgramIdentityKeys` implementation unread, supplementary-plane divergence not ruled out | CONFIRMED — comparator is unsigned UTF-16 code-unit order; worry doubly moot because role names are ASCII-gated `SafeId` | Agree (B resolves A's open question in A's favour) | **Upheld.** Re-read `canonical-value.mjs:67-72`: bare `<`/`>` on strings, which JS defines as UTF-16 code-unit-wise — exactly §93.8's order; the comment at `:65-66` states the intent. `role-catalog.mjs:221` sorts before `approval-template.mjs:59-69` consumes. B's second ground (SafeId regex admits no non-ASCII) and lone-surrogate refusal (`canonical-value.mjs:74+`) close the residual concern; C2's counterexample pair is unconstructible. |

## Residue

No P0/P1 residue.

Recorded for completeness (not P0/P1): B's incidental finding C3 — the `settlement_value` /
`branch`-member admitted-branch check (`normalize-program.mjs:510-519`) is over-restrictive: it
admits only `await`-produced envelopes, so a `repeat` settlement port or a `sequence`/`branch`/
`select` output schema'd as `baton.settlement_envelope` is refused even when a domain reading might
admit it. C concurs with B's characterization: the failure direction is fail-closed (never admits an
unadmitted branch name), so this is a completeness gap, not a soundness hole, and it does not
disturb claim 9. No change is proposed for this slice; candidate material for a future slice if
`repeat`-produced envelopes are meant to be selectable.
