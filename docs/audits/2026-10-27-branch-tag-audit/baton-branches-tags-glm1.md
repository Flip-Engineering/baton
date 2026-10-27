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

## Full branch classification (pass 2)

Pass 2 added a subject-level test for every content-unique branch: each unique commit subject
was searched in main. 144 of 153 non-superseded branches carry at least one subject absent from
main; combined with issue state, they fall into the buckets below. "Confirm" means one specific
verification remains before deletion; everything else is a direct verdict.

### Superseded — delete (with named confirmation where a closure is recent)

| Set | Refs | Evidence |
|---|---|---|
| Zero-unique | 26 branches (list above) | every non-merge commit patch-id-present in main |
| 970 family | 19 `*compiler-queue-970*` + `consol/queue-line-20261022` | PR #982 closed unmerged with supersession statement; queue implemented by 10-27 wave |
| PR869/PR901 cluster | runtime-output-checkpoint-fix-20261019, runtime-output-checkpoint-fix-wonder-20261019, codex/pr901-monitor-replay-proposal-20261021, codex/pr901-current-main-c021089a-20261021, codex/pr901-safe-successor-20261021, codex/pr901-current-main-integration-20261020, codex/pr869-span-fix-20261021, codex/pr869-current-main-integration-20261020, consol/998-observer-20261022 | PRs #869/#901 closed unmerged; #998 closed; monitor replay re-landed as merged PR #1150. Confirm #998 closure comment, then delete. |
| Settlement fixture line | knowledge-pr862-settlement-20261019, codex/completed-guidance-786-20261018, dev/backlog-862-20261019 | #862 closed 2026-10-27; confirm the closure consumed the fixture work, then delete. |
| #788 line | dev/backlog-788-20261019, codex/backlog-788-866-integration-20261020 (83 unique each) | #788 closed 2026-10-27 18:33 and PR #866 merged; confirm, then delete. |
| Landed-elsewhere singles | fix/1019-series-gh-20261022 (PR #1053 merged), consol/866-qualification-20261022 (PR #1169 covers process-group reaping), fix/native-ci-target-reuse-key-20261023 (PR #1136 same subject), fix/issue905-main-port-20261022 / fix/logging-769-tests-main-port-20261022 / fix/receive-attempt-identity-tests-main-port-20261022 / fix/orchestra-subscription-test-main-port-20261022 / fix/inotify-909-main-port-20261022 / fix/compiler-queue-971-main-port-20261022 (explicit main ports; verify each port's target landed) | subjects match merged PRs |
| Closed-issue carriers | codex/postboot-recovery-985-20261020 (#985 closed; 10-27 recovery wave #1162/#1163/#1165/#1166), runtime919-attempt-identity-ds-20261019 + fix/pr919-invocation-identity-20261019 (#919 closed) | confirm closure consumed the approach |

### Open-issue work — review, port or return to the issue's conductor

| Issue (state) | Branches (content-unique) | Note |
|---|---|---|
| #1089 cgen 2h20m (open) | fix/1089-main-reuse-closure-20261026 (2), claude/cgen-stack-20261026 (1), fix/term-higher-iterative-20261026 (2 of 3; 3rd is archive admission shared with fix/compiler-lay-iterative-20261026) | small, current-main-based; strongest merge candidates in the fleet |
| #1146 receiver validation (open) | fix/1146-receiver-harness-probe-20261027 (1) | fresh, tiny |
| #905 fresh receive after start failure (open) | codex/issue905-start-failed-fresh-receive-20261019 (21) | 10-19 base; port cost moderate |
| #943 SQLite replay read amplification (open) | fix/sqlite943-read-reuse-20261019 (4), fix/replay-read-amplification-current-20261019 (4), fix/replay-read-reuse-943-main-20261022 (7), fix/sqlite937-reader-20261020 (1) | the -main-20261022 variant is already rebased |
| #1001 REPL staging after caller update (open) | fix/queue1001-repl-adapter-20261021 (98) | queue-era; rebasing onto post-#982 queue is the work |
| #995 binary queue inputs (open) | integrate/queue995-current-main-20261021 (91) | same era |
| #978 corrupt queue cache recovery (open) | codex/compiler-queue-978-cache-recovery-20261020 (60) | same era |
| #971 replay cursor before NUL suffix (open) | codex/compiler-queue-971-runtime-candidate-20261020 (59), fix/compiler-queue-971-followup-20261020 (1), codex/compiler-queue-971-investigator-ds-20261019 (3) | same era; regression test is 1 commit |
| #776 Bend build time/memory (open) | consol/776-compiler-20261022 (19), fix/compiler776-capture-main-integration-e8d5-20261020 (16), fix/compiler776-literal-default-production-20261020 (8), fix/compiler776-lit-default-share-20261020 (7), fix/compiler776-main-bend-arity-20261020 (1), fix/compiler776-literal-port-e8d5ac89-20261020 (1), baton/branch-1df5d351e684ff4605e02535c1381069-{0,1} (10/6) + preserve/ twins (11/7, incl. root-seat wip) | arm_eq structural equality + shared arm emitters; largest coherent un-landed performance line; return to the #776 owner |
| #1049 worker disk sprawl (open) | fix/1049-cargo-target-release-20261024 (12), design/1049-worker-disk-sprawl-20261023 (6, docs) | ops-relevant, current |
| #1045 storage process-reference check (open) | fix/1045-storage-process-reference-20261024 (5) | current |
| #965 remove native hard-limit admission (open) | fix/issue965-storage-cleanup-no-memory-cap-20261021 (1), consol/logs-cleanup-20261022 (1) | directly implements the no-memory-caps policy |
| #1014/#1037/#1025/#858 usage holds and quota windows (all open) | fix/usage-holds-1014-20261022 (3), fix/usage-holds-1014-zai-handoff-20261024 (4), docs/usage-reopen-design-1037-20261023 (2), fix/858-clear-stop-quota-20261019 (2) | account-credits/usage domain; coordinate with the credits conductor |
| #997 retained launchers after OOM (open) | fix/credit-maintained-caller-integration-20261021 (1) | credits line |
| #787 owner election across runtime dirs (open) | consol/787-20261022 (2) | tiny |
| #721 Antigravity harness (open) | codex/baton-721-agy-haiku-20261022 (2) | tiny |
| #956 Harness² evaluation (open) | research/h2-source (1), research/h2-evaluator (1) | knowledge capture |
| #951/#778/#775/#747 REPL and release gates (all open) | release-repl-deepseek-951-20261019 (8), release-repl-glm-778 (6), release-qual-deepseek-775-747 (5), consol/repl-critique-20261022 (1), consol/1009-repl-pins-20261022 (1), fix/repl-public-eval-20261019 (1), codex/repl-darwin-dependency-preflight-20261016 (2), dev/backlog-959-20261019 (3) | model-specific release qualification evidence |
| #769/#786 ENOSPC and retry backoff (both open) | runtime-deepseek-successor-769-786 (11), logging-deepseek-769-main-tests (4), logging-deepseek-769 (3), logging-glm-769 (2) | merged PR #1165 (ENOSPC retained status) may cover part; diff against it before porting |
| Coordinator laws (PR #782 era) | codex/hosted-laws-782-20261017 (3), codex/coordinator-law-gate-782-20261016 (1 of 6) | laws qualification; check against current law fixtures |
| Storage policy continuation | codex/storage-policy-core-20261019 (1), codex/storage-policy-core-continuation-20261019 (1), codex/storage-policy-20261019 (1) | all three are root-seat "wip: preserve uncommitted work" captures from 2026-10-22; root decides |
| PR1165 follow-ups | ensemble/critical-native-package-kimi-20261027 (2), codex/pr1165-darwin-recovery-workflow-20261027 (5) | confirm whether the #1166/#1167 chain consumed the workflow branch; kimi branch has an unknown ensemble owner |
| Residual singles | codex/storage-reflog-preservation-20261027 (9, feeds PR #1157), fix/graph-answer-fix-20261019, fix/issue937-{terminal-policy,replay-guard,legacy,live-attach}-202610xx, fix/inotify-909-ds-20261019, fix/stop-dsh-1015-20261022, fix/native-ci-{launch-guard-stubs,bun144}-20261023, codex/{canonical-owner-ipc,host-inspector-bounded,runtime-frame-span-review,frontend-check-custody-20261021}, consol/{string-eq,frame-span-tests}-20261022, compiler-knowledge-ds-20261019, baton/knowledge-attach-hang-ds-20261018 (5), qual/composite-reap-ports-20261022 (14) | each 1–5 unique commits; individually triaged in later passes |

`codex/frontend-check-custody-20261021` (93 unique) is listed under residuals pending one
check: its check-kind routing may be the same problem main's merged "Resolve check entries
from the source root" line already handles.

## Process observations

- The local clone tracked only `refs/heads/main`; any prior audit run on this worktree saw a
  fraction of the refs. Full-ref fetch is required before trusting ref counts here.
- Branch date suffixes lag committer dates: several `*-20261020` branches absorbed merges
  through 10-26. Name-derived age is not evidence.
- Main merged 769 commits since 2026-10-19, 40+ PRs on 10-27 alone. The branch fleet is
  downstream of a main that outran it; supersession-by-rewrite is the dominant failure mode,
  which the patch-id method detects directly.
