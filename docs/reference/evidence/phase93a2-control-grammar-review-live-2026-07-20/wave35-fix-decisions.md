# Wave-3.5 fix decisions — orchestrator-approved (2026-07-21)

Contract for the wave-3.5 implementer seat. Ground truth: `blue-review.md` and
`redraft-redteam.md` in this directory. Where the two reports diverge, these decisions rule.

1. **§93.9 clause 2 (settle-then-read) — transitive pure-data walk.** Replace the blanket
   pure-data exemption with the same walk clause 1 carries: from each settle-then-read position,
   walk the `collect`-item closure and require every control producer so reached to lie in the
   position's settlement domain (`value`/`context` add no refs; pure-data leaves unrestricted).
   Code: replace the `checkSettleThenRead` early return with a walked-guarded stack mirroring
   the demand walk. Tests: the three laundered exploits into `P93A2-D3`
   (`sequence.result=col.value`, branch arm `result=col.value`, parallel branch
   `result=col.value`) plus a two-hop collect-chain row; fix the wrong D3 comment (pure-data
   reads are exempt from the *dominator* check, not the settlement-domain check); keep the
   `value`-node green row.
2. **§93.9 settlement domain — per-position keying (matches shipped reference).**
   `sequence.result` → the sequence's domain (steps + step domains);
   `parallel.branches[b].result` → branch `b`'s control-chain domain, REGARDLESS of join kind;
   `branch.{then,otherwise}.result` → that arm's control-chain domain. Closure: the chain head;
   sequence steps recursively; `all_terminal` parallel branches' chain domains;
   non-`all_terminal` parallel and `branch` nodes contribute only themselves (a branch exposes
   only its own value port, never arm internals). Cross-branch reads under `all_terminal` are
   REFUSED (per-branch domains). Amend the spec text to say exactly this.
3. **§93.9 — effect inputs are demand edges.** Add normative text: `call.input`, `map.input`,
   `reduce.inputs`, `gate.candidate`, `notify.{target,message}`, `checkpoint.value`,
   `finish.{value,evidence}` are demand edges (dominator-checked), so 93C cannot re-open the
   hole; keep the two-relation claim true.
4. **§93.9/§93.8 — bodies are independently approved only.** Delete the "or within the parent
   envelope shape" alternative; in Program v1 every repeat/child body MUST be independently
   approved.
5. **§93.8 — content_ref scope composition.** State: a `content_ref` template's scopes MUST be
   covered by the envelope's `repositoryScopes` at approval time; until envelope authority
   exists (93E) the projection is inline-only, and an empty projection means NO repository
   access grant, never unconstrained access.
6. **§93.20 — deferral widening + classification scope.** State: the empty-reachable-role-set
   refusal AND the route-card/structural minimum are both deferred to 93E; serial classification
   is per-Program (control-reachable from that Program's own `root`; repeat/child bodies are
   different Programs).
7. **§93.9/§93.20 + code — inert parallel branch count.** An UNREACHABLE (inert) parallel's
   branch count is bounded by `policy.maxProgramNodes` as an explicitly stated pure shape bound;
   a reachable parallel is bounded by `policy.maxParallelBranches`. Move the branch-count check
   to the program-level pass where reachability is known; fix the misleading error message in
   `control-nodes.mjs`. Red rows: unreachable over `maxProgramNodes` refused; unreachable at
   `maxProgramNodes` accepted; reachable over `maxParallelBranches` stays refused (B1).
8. **Blue P1-3 — true two-hop rows.** Register a second fixture object schema (`collect_outer`
   wrapping `collect_result`) so `colOuter ← colInner ← selT` is constructible; add the two-hop
   row to `P93A2-D2` (a one-level-only walk must fail it) and the same two-hop shape to the D3
   settle rows.

Rules: red rows first and watch them fail; then implement to green. Do NOT modify
`canonical-value.mjs`, `schema-values.mjs`, `context-program.mjs`, `worker-policy.mjs`. Do NOT
git commit. NEVER write scratch or log files anywhere (including `/tmp`) — read output from
stdout. Run the pinned four suites, then the full suite `node impl/scripts/run-suite.mjs` from
the worktree root; both green. Keep `P93A2-` ids stable for amended rows; new rows continue the
scheme. Digest literals in `phase93a-digest-vectors.json` must remain valid — if any shifts,
that is itself a finding: regenerate ONLY via external `shasum -a 256` over inspected bytes and
report it.
