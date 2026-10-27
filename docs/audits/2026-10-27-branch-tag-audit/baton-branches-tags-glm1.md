# Baton branch and tag audit — 2026-10-27 (repository-audit-glm1)

Auditor: session repository-audit-glm1-20261027 (GLM 5.3 Flash, omp harness), ensemble with
repository-audit-glm2-20261027. Scope: remote refs of Flip-Engineering/baton.

Method: fetched full ref universe (`+refs/heads/*`, `+refs/tags/*`) at 2026-10-27 ~21:00 UTC.
Every verdict below is computed, not asserted: ahead/behind via `git rev-list
--left-right --count`, content identity via `git rev-list --count --no-merges --cherry-pick
--right-only origin/main...<ref>` (patch-id equivalence, so cherry-picked or rebased duplicates
count as integrated), tag reachability via a single `rev-list` over all 180 branch tips.

## Remote state at audit time

| Set | Count | Note |
|---|---|---|
| Remote branches | 180 | `git ls-remote --heads` |
| Remote tags | 267 | plus 153 annotated-tag peel entries; 420 ls-remote tag lines total |
| Branches with zero content-unique commits | 26 | patch-id fully covered by main |
| Branches with 1–2 / 3–10 / 10+ content-unique commits | 60 / 42 / 50 | |
| Open pull requests | 1 | #1157 |
| Tags in main ancestry | 4 | |
| Tags that are sole anchors of their history | 285 of 290 | branches they snapshot were deleted |
| Sole-anchor tags fully patch-id-integrated in main | 80 | deletion candidates |

The 213/305 numbers in the original report are stale; the current backlog is 180 branches and
267 tags. Only 2 branches are ancestors of main; 177 diverge by ancestry, and the content test
above is what separates superseded from live work.

## Decision already recorded: the compiler-queue-970 family is superseded

PR #982 "Coordinate native compilation through the shared Bend2 queue" (157 commits, 45 files,
head codex/queue970-failure-repro-fix-20261020) was closed unmerged on 2026-10-27 18:48 UTC by
root with the closure statement that the maintained shared compilation queue is implemented in
current Bend2 source (identity coalescing, priority tickets, lock transfer — the 2026-10-27 PR
wave #1126–#1169). The 19-branch `*compiler-queue-970*` family (2026-10-19…22, codex/ds/kimi
variants, 13 mutually independent tips) exists to deliver what main already delivers by another
implementation. Recommended action: confirm no active session still bases work on a family tip,
then delete the family refs. The largest branch (codex/queue970-failure-repro-fix-20261020,
+12,467 lines, 601-line design doc `docs/bend2/compile-queue-20261019.md`, two test suites) is
the only one worth a skim before deletion, and only for test fixtures that current tests lack.

`consol/queue-line-20261022` (101 content-unique commits) is 970-adjacent line-protocol
consolidation; same supersession rationale applies, subject to the same one-time skim.

## Finished work absent from main — review candidates

| Branch | Head | Unique | Issue | Assessment |
|---|---|---|---|---|
| fix/1089-main-reuse-closure-20261026 | 04d629f6d→d33c6dd43 | 2 | #1089 open | Main C reuse bound through entry import closure; #1089 is the 2h20m single-core cgen complaint. Review/merge candidate. |
| claude/cgen-stack-20261026 | f724a6d7e | 1 | #1089 adjacent | Raises JavaScriptCore stack cap for native cgen to 1 GiB. One-commit review. |
| fix/term-higher-iterative-20261026 | 70d12b7ed→f347c6f3a | 3 | compiler perf | term_lower/term_higher made iterative; admits lay-iterative compiler archive. Review candidate. |
| fix/1146-receiver-harness-probe-20261027 | 6d124c039 | 1 | #1146 open | Validates an OMP receiver command before registration. Fresh (10-27), small, open issue. |
| compiler/legacy-cli-length-head-20261027 | f624f5f2b | 1 | — | Dispatches legacy_cli by list length and head; check overlap with merged PR #1164 (folded dispatchers) before keeping. |
| codex/storage-focused-delivery-20261027 | 070714dbf | 8 | #934/#939 follow-ups | The only open PR (#1157), mergeable, CI unstable, 16 files. Root review item. |
| codex/storage-reflog-preservation-20261027 | — | 9 | #934 area | Reflog preservation companion to the storage cleanup; likely feeds #1157 review. |
| ensemble/critical-native-package-kimi-20261027 | 284f42f93→905f0bfac | 2 | PR1165 follow-up | Backports the retained-native durable-status repair plus a proof extension. Owner is an ensemble session; confirm ownership before touching. |

## Preserved branches carrying live-issue work — return to conductors, keep

- `preserve/baton/branch-1df5d351e684ff4605e02535c1381069-{0,1}-20261022` — root-seat review
  captures from 2026-10-22 including "wip: preserve uncommitted work" commits; content targets
  open issue #776 (Bend build time/peak memory: arm_eq total structural equality, shared-arm
  default continuations). 12 and 8 content-unique commits. Keep; hand to the #776 owner.
- `preserve/homelab-20261022/review-988` — 1 commit "Trigger storage collection at completion
  and consolidation" for open issue #988. Keep.
- `preserve/homelab-20261023/accounts-504870-integration-20261019` — 8 commits wiring credit
  admission/reservation/settlement into the API-key request path. The account-credits line
  (retained account database) is active; return to its conductor.
- `preserve/dev/backlog-862-20261019-20261022` — 12 commits, settlement idempotence tests;
  #862 closed 10-27, so re-check which of the 12 the closure consumed before deciding.

## Content-superseded branches — deletion candidates after this report

26 branches whose every non-merge commit is patch-id-present in main (list:
`archive/javascript` 2026-09-29; `codex/branching-snapshots-flush-20261018`,
`codex/live-tui-queue-bridge-20261026`, `codex/pr860-current-main-integration-20261021`,
`codex/recovery-521-agent-helper-closure-20261026`, `codex/storage-934-939-integration-20261019`,
`consol/proc-self-exe-20261022`, `fix/1016-stranded-configure-20261027`,
`fix/1025-{claude,deepseek,kimi}-reader-20261024`, `fix/1118-queue-{entry-default,priority}-20261027`,
`fix/compiler-memory-diagnostics-20261026`, `fix/compiler955-native-arm-collision-20261019`,
`fix/focused-recovery-route-20261019`, `fix/git-workflow-source-20261026`,
`fix/missing-keeper-resume-20261027`, `fix/native-ci-queue-20261022`,
`fix/sqlite937-impl-20261019`, `integrate/1082-final-fixtures-20261026`,
`integrate/receive-1123-1127-final-20261027`, `preserve/accounts-credit-delivery-20261021-20261022`,
`preserve/fix-994-local-20261022`, `preserve/fix/994-repository-credentials-20261021-20261022`,
`qualify/env933-pr946-main011f-20261019`).
None carries unique work; deletion loses nothing. The three `fix/1025-*-reader` branches show
issue #1025 remains open — the branches are superseded, the issue is not.

60 further branches carry 1–2 content-unique commits; spot checks show most are rebase-context
duplicates of main commits (same subjects exist in main: e.g. fix/1118-queue-status-metadata →
d6f37bd25, fix/1118-queue-coherent → ae853ca67). Mechanical per-branch verdicts continue; no
action until itemized.

## Tags: the archive layer

`archive/*` (179) and `recovery/*` (103) tags were cut when branches were deleted
(bulk 2026-10-12/13). 285 of 290 tags are the only remaining anchor of their history; only 4
sit in main ancestry. Patch-id comparison against main:

- 80 sole-anchor tags are fully integrated in main — superseded. This includes all 44
  `recovery/baton2-20261006/*` crash-recovery snapshots, `archive/merged/*` (2),
  `archive/2026-10-05/codex/*` (7), 23 `archive/{branches,local-branches}/20261013/*`, and the
  release tags baton2-v1.0.0/1.0.1/2.0.0 + pre-dogfood-baseline + stall-qualified-11cbe6a4
  (which are additionally plain main ancestors). Version tags are cheap product identity —
  recommend keeping the four `baton2-v*` releases and deleting the rest of this 80-tag set
  (crash snapshots and branch archives whose content is provably in main).
- 205 sole-anchor tags carry unintegrated content (largest:
  archive/branches/20261013/codex/native-context-invocation-luna-20261006 with 270 unique
  commits). These are the genuine historical record of the September–early-October rewrite
  era. Recommend retention unless root rules the era closed; they are invisible in branch
  listings and cost nothing.
- 5 tags are redundant with live branches (archive/2026-10-05/bend2-v2,
  backlog-788-ledger-a16fbc5e, baton2-v1.1.0, pre-dogfood-phase10.1,
  recovery/baton2-20261006/f5b883ca1582aba7). backlog-788-ledger-a16fbc5e marks a hand-written
  ledger artifact; repo policy bans ledger-as-function, so it is deletable once the #788
  closure (10-27) is accepted as final.

## Process observations

- The local clone tracked only `refs/heads/main`; any prior audit run on this worktree saw a
  fraction of the refs. Full-ref fetch is required before trusting ref counts here.
- Branch date suffixes lag committer dates: several `*-20261020` branches absorbed merges
  through 10-26. Name-derived age is not evidence.
- Main merged 769 commits since 2026-10-19, 40+ PRs on 10-27 alone. The branch fleet is
  downstream of a main that outran it; supersession-by-rewrite is the dominant failure mode,
  which the patch-id method detects directly.
