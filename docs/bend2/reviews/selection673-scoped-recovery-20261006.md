# #673 scoped recovery review, 2026-10-06 (DRAFT)

Seat: selection673-muse-review. Candidate: UNQUALIFIED. No local builds or
tests were run; all qualification needs remote runners on the same toolchain.

## Scope

Wholesale merge of `69435a25` stays unqualified: two-dot
`ecfbdd0b..69435a25` is 66 files (+2912/-8977) and contains published
logging, model, and documentation deletions that recovery must not carry.
The recoverable scope is the 10-commit selection chain
`e2e06950..69435a25` (15 files, +1260/-13):

- Full carry (5): `bend2/src/coordinator/land.bend`,
  `bend2/src/git/land.bend`, `bend2/test/land-reviewed-commit.bend`,
  `bend2/test/land-reviewed-commit.py`, `bend2/test/land-reviewed-mcp.py`.
- Reworked selection hunks only (10): `bend2/src/coordinator/commands.bend`,
  `bend2/src/coordinator/main.bend`, `bend2/src/coordinator/receive.bend`,
  `bend2/scripts/laws-check.mjs`, `bend2/scripts/codex-conductor.mjs`,
  `bend2/scripts/mcp-conductor.mjs`, `bend2/scripts/omp-conductor.mjs`,
  `bend2/test/codex-root.py`, `bend2/test/omp-root.py`,
  `bend2/test/receive.py`. Selection hunks sit on compact context that
  primary does not contain; they need manual re-basing, not cherry-pick.
- Excluded: 7 compact-only files (`index-laws.bend`, `index-reads.bend`,
  the `laws.bend` import, `host/sqlite.bend`/`.c`, `control-index.py`,
  `control-index-mcp.py`) and every hunk outside the 15 files.

Merge base with published `ecfbdd0b` is `98fbfe03`. Primary lacks all
selection markers (`select_reviewed`, `land_fast_forward_at`, `LandAt`,
`LandCheckedAt`). The `land_fast_forward_at` insertion point in
`bend2/src/git/land.bend` is intact on primary and `FFLD`/`FFNext` plus
`ff_go2..5` signatures are compatible with the published landing rewrite
(`3c64f407`, ancestor of `ecfbdd0b`). The tasking string `6743c64f407`
matches no local object; root confirms the intended hash.

## Open findings

F1: `sel_branch_pick` (`bend2/src/coordinator/land.bend:165` at `69435a25`)
has no equation law pinning its three-way mapping. `sel_commit_pick` and
`sel_ancestor_pick` have exact equation laws; the branch argv has a literal
argv law and the chain has ordering laws. No `laws-check.mjs` mutation
exercises the branch pick arms, so an arm swap inside `sel_branch_pick`
compiles. A law equating `sel_branch_pick` over all three `GitOut` classes
is needed before qualification.

F2: the `bend2/README.md` hunk in the 66-file diff predates the published
log policy paragraph at `ecfbdd0b` and sits outside the 15-file scope. It
is excluded from the composition. The rebase must not carry it.

F3: `bend2/src/git/land.bend` at `69435a25` still heads the module as one
squashed landing of a committed worker tip, and the reviewed oid travels in
the `wc` (worker-commit) slot with worker-branch wording in stage refusals,
while the reviewed path is a fast-forward of an immutable oid. No law bars
the reviewed entry from the squash (`ld_*`) stages. Mitigating fact, still
unverified remotely: `ff_stage3` re-records `tb` from the target HEAD, so
the `""` seed in `ff_go2(FFNext{wc, ""}, ...)` is replaced before the CAS
`update-ref`. Comment correction plus a stage-routing law are needed.

## Remote qualification plan

Baseline `ecfbdd0b` against candidate (`ecfbdd0b` + composition above) on
root-owned runners with pinned Bend 2.0.25: `land-reviewed-commit.py` (9
cases), `land-reviewed-mcp.py`, `laws-check.mjs` selection mutations, plus
regression on `land.py`, `codex-root.py`, `omp-root.py`, `receive.py`,
`logs.py`. CI run 69037523301471 is cancelled and is not a gate. Landing
integration stays root-owned; this seat does not merge primary.

## Pending

Remote qualification run; F1 law + F3 comment/routing law composed by the
owning seat; inbox acknowledgment via conductor (3 messages unacknowledged,
2 tasked as DB 14347/14339, acted on by essence; local DB not reachable
from this worktree).
