# Phase 26 structured integration evidence — 2026-07-11

## Outcome

Phase 26 adds explicit `structured` integration while preserving `ff-only` as the default. Baton
never uses main as a merge workspace. It pins clean main and the accepted worker result, creates a
detached stage under `.baton/integrate/`, performs a real Git three-way merge, and invokes an
injected Mergiraf-class resolver only for unresolved regular text paths. Each resolver call sees
one bounded temporary conflict file in an isolated directory rather than the staging repository.

Missing tools, non-success or unknown status, parse fallback, unsupported paths, oversized input
or output, timeout, invalid UTF-8, remaining conflict markers, unmerged index entries, and
`git diff --check` failure refuse. A candidate must have the exact main/result parents. Baton then
runs the immutable pinned primary command in a distinct fresh worktree at that candidate. Only an
observed pass may guard a final main fast-forward, which rechecks that main is still clean and at
the pinned SHA.

The integration record pins before/result/merge-base/stage/after identities, per-path classes,
resolver evidence, and the fresh verdict. Refusal retains the accepted result ref. Post-effect
coordination failure poisons; restart replay does not invent success. Startup reconciliation
removes orphan stages because an old candidate without a live fresh verdict has no authority.

## Validation

- Numbered contract: `spec/phase26/structured-merge.md` (SM1–SM10).
- Focused gate: 11/11.
- Existing acceptance/worktree plus Phase 26 gate: 65/65.
- Canonical owned suite: 761/761; suite root reaped.
- Reds cover unavailable resolver, marker retention, parse fallback, deployment file ceiling,
  resolver isolation, clean divergent three-way merge, false-clean syntax failure, dirty main,
  main-advance race, post-main authority failure/replay, and orphan-stage reconciliation.
- The external `mergiraf` binary is absent on this host. Production invocation is implemented
  with fixed no-shell `mergiraf solve <path>` argv, bounded time/output, and a minimal environment;
  tests use an injected executor and do not claim a live external-tool pass.

## Recursive Baton scope review

Exact `grok-4.5` and `grok-composer-2.5-fast` independently reviewed the scope concurrently through
Baton before implementation. Both provider identities were observed on distinct overlapping PIDs,
both reports were freshly verified, both workers were normally killed, and every process,
worktree, runtime, and branch was reaped. Both converged on isolated staging, an injected external
resolver, mandatory fresh verification, and an explicit ban on CPG/fingerprint merge authority.
The reports and lifecycle ledger are under
`docs/reference/evidence/phase26-structured-merge-scope-grok-review-2026-07-11/`.

## Honest boundary

This is syntax-aware structured integration, not semantic merge. Mergiraf can reduce textual
conflicts but cannot prove behavior. Baton's fresh pinned check can still be weak. CPG deltas and
behavioral fingerprints may later escalate review or refusal, but there is deliberately no hook by
which either can advance main or skip verification. True data/control-flow merge remains a
catalogued research bet pending an adoptable external engine, measured residual demand after this
rung, and an evidence-backed false-clean advantage.
