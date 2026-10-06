# Candidate and gate state: delivery and quota-failover lanes (2026-10-06)

Read 2026-10-06 after resuming the retained session. Database reads use
`file:<db>?mode=ro`; remote reads use `git ls-remote` and `gh` only. No job was
re-triggered and no test or compiler gate ran on this host.

## 1. Published candidate

| Item | Value |
| --- | --- |
| Pull request | [Flip-Engineering/baton#687](https://github.com/Flip-Engineering/baton/pull/687), draft, base `bend2-rewrite`, head `codex/logging-impl-20261006` |
| Commits | `1edeb0f9` (policy, rotation, cleanup, held frames, tests, docs), `f438f2d3` (measurement) |
| Remote tip of the head branch | `f438f2d3d8` |
| CI handle | run `37520413798`, workflow `bend2-native-development`, job `darwin-arm64` ID `112464080936` |
| CI state at read | `in_progress`; steps Set up job, Checkout exact source, Select Node 22, Create owned build clone passed; the exact-source gates were running |
| Owner | root (`audit-root`); this review did not re-trigger or duplicate the run |

The candidate's own report (`logging-impl-20261006`, seq 13997) records that no
independent validator has reviewed the commit, and that the run above is the remaining
gate. `bend 2.0.25` with clang-19 passed the law gate and `bend2/test/logs.py` (12 tests)
and `bend2/test/turn.py` (17 tests) on the homelab; those results are the author's and the
homelab validator's self-reports.

## 2. Implementation-lane branch state

The `semantic-impl-*` sessions name 28 distinct branches. Exactly two are advertised on
`origin`:

| Branch | Remote tip |
| --- | --- |
| `codex/baton2-semantic-impl-models-20261005` | `1aa6f89448` |
| `codex/baton2-semantic-impl-native-20261005` | `63f909c03f` |

The other 26, including the conductor branches for `semantic-impl-code` and
`semantic-impl-runtime`, are not advertised.

The worker pins cited in the recovery-muse ledger exist locally and have no remote
presence:

| Pin | Object | Remote | Contained by an advertised branch |
| --- | --- | --- | --- |
| `8c4e67d6` (codec) | commit `8c4e67d608` | no | no |
| `07d35101` (lifecycle) | commit `07d3510185` | no | no |
| `e5cc9187` (typescript) | commit `e5cc918741` | no | no |
| `254d9371` (models) | commit `254d9371e2` | no | no |
| `100a0cbf` (models) | commit `100a0cbf3a` | no | no |

Consequences for the recovery-muse ledger (`recovery-muse-20261006-delivery-1`, seq
13657):

- Its row "zero lane branches are advertised on the remote" holds for the conductor
  branches of `semantic-impl-code` and `semantic-impl-runtime` and for every worker pin,
  and does not hold for `semantic-impl-models` and `semantic-impl-native`.
- `95ffe72d` in `recovery-muse-green-rerun-01` (seq 13656) is a tree hash, not a commit;
  it does not resolve as a commit locally.
- The unfinished gates it lists remain unfinished: independent validation bound to the
  exact tree, checked conductor integration, branch push, then `build-native`,
  `laws-check` and `check-native` on remote runners.

## 3. This review's artifacts

| Artifact | Commit | Remote |
| --- | --- | --- |
| `docs/bend2/recovery-quota-failover-review-2026-10-06.md` (issue review, gaps G1-G8, findings F1-F9) | `58600c63` | `codex/recovery-quota-failover-review-20261006` tip `1794b547` |
| `docs/bend2/recovery-quota-failover-evidence-2026-10-06.md` (quota-failure and continuation evidence tables) | `1794b547` | as above |

## 4. Blockers

| Blocker | Evidence |
| --- | --- |
| No Bend 2.0.25 compiler on this host, so `build-native`, `laws-check` and `check-native` run only on the remote runners | `bend 2.0.25` absent from `PATH`; `run-checks.mjs:9,35` pins it; `recovery-muse-validation-report-01` (seq 13610) records the same blocker |
| Kimi k3 route blocked | `session_stops` rows reading `K3 subscription quota exhausted`; four seats hold 1,236 unacknowledged inputs |
| ZAI route blocked at the recorded reset `2026-10-06 07:12:52` | 429/type1308 records at seq 9973, 9985, 10124, 10216 |
| Codex subscription limit | reset stated `Oct 9th, 2026 2:13 PM`; five seats continued to another provider |
| `recovery-muse-20261006` is outside the `recovery-delivery-reviewers-20261006` tight ensemble, so this seat cannot message it directly | `ensemble_members` for that ensemble lists the four recovery-*-review seats and not `recovery-muse-20261006` |
| Storage observation failure during the earlier recovery run | `recovery-muse-20261006-delivery-1:observation` (seq 13658) recorded `28: No space left on device`; the filesystems now report 13 GiB available |
