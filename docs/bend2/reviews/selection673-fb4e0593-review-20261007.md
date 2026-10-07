# #673 independent review of DS tip fb4e0593 against primary 859670ea (DRAFT)

Seat: selection673-muse-review. Verdict: ACCEPTED FOR ROOT COMPOSITION.
This is not a qualification declaration. Root owns composition, primary
publication, and the integration gate. No local builds or tests were run.

## Source identity

- Reviewed tip: `fb4e0593` (merge of pin `4f69543b` into `bd4ad4c4`),
  tree `4fde1c43`, branch `codex/selection673-deepseek-impl-20261006`.
- Current primary: `859670ea` (log-retention merge over `4f69543b`).
  Merge base of tip and primary is `4f69543b`.
- Delta `4f69543b..fb4e0593`: 16 files, +1314/-13, scoped to selection.
  Primary advance `4f69543b..859670ea` touches only `bend2/test/logs.py`
  and `docs/bend2/logging.md`: zero file overlap with the delta.
- Read-only `git merge-tree 4f69543b 859670ea fb4e0593`: 13 merged
  sections, 0 conflicts, 3 new files added cleanly. The delta still
  applies against current primary at file level.

## Receipts independently inspected (remote evidence, not DS summary)

All `merged-*` jobs name source `fb4e0593`, tree `4fde1c43`, pinned
toolchain bend `/home/atari2036/baton-logging-686/toolchain-home/bin/bend`,
CC `/usr/bin/clang-19`, sqlite `/home/atari2036/baton-sqlite-3460100`:

- `merged-build` exit 0; `merged-check-entry` exit 0.
- `merged-land-reviewed-commit` exit 0; `merged-land-reviewed-mcp`
  exit 0 (9 tests OK); `merged-file-land-reviewed-*` exit 0 both.
- `merged-selection-controls` exit 0:
  `green - 18 laws, 15 mutations, 34 compiles, 0 failures`. All 18 law
  names verified present in the receipt, each proof-removed and refused;
  34 `passed:true` lines counted.
- Paired `primary4f` (source `4f69543b`) fails the same files:
  `accept-kimi-hierarchy.py` exit 1 both trees; `check-native` stops at
  the same file both trees; `control.py` repeat fails the identical 3
  tests on both trees (timing/behavioral, outside the delta). No
  candidate-only failure.
- `candidate-land-reviewed-mcp` (older source `f5b70094`) failed with 8
  JSON errors. It is superseded by the merged-tree 9/9 pass and is not
  part of the qualification claim. A failed run is recorded as failed.

## Source findings

F1 closed: `reviewed_source_recorded_branch_keeps_three_decisions`
(`coordinator/land.bend:341` at tip) equates `sel_branch_pick` over all
three `GitOut` classes with exact refusal and detail strings.

F3 closed: `m3a_the_reviewed_source_entry_starts_at_the_containment_stage`
(`git/laws.bend:843`) equates `land_fast_forward_at` with an
independently written ff_go2..5 composition; the comment names the
oid-in-worker-slot semantics openly. The stale squash header line is the
only deletion across both land modules; default entries are pure addition.

Defaults: omission follows the unchanged tip path; `--commit` builds
`LandAt`/`LandCheckedAt` only on the literal flag (laws pin this); MCP
`landCommit` appends nothing when commit is undefined.

Containment: `require_association` then `select_reviewed` then
`selected_or_die`, and only the resolved oid reaches
`land_fast_forward_at` or the existing `run_checked`. Refusal exits 2
before scratch or target effects. Help text states selection grants no
review or landing authority.

Negative controls: 9 fixture cases present (ancestor lands, default tip,
refusal before effects, dirty workspace, foreign repository, divergent
same-repository commit, checked advance, checked block, moved-target
retry); caller and parser mutations refuse under their own law names.

Shared-file note: the delta touches `receive.bend` (1 instruction line
plus guidance sentence, owned by native685-muse-conductor) and shared
conductor/commands/main hunks. Composition stays root/lead owned with
owner sign-off; this seat changes no shared file.

## Follow-ups

DS full law sweep on `f5b70094` still running (pids 297173/297178,
preserved, not duplicated); its verdict is pending. Final build and
controls on the root-composed current-primary tree belong to the root
integration track (candidate `44a30402` in qualification). No new remote
run was opened from this seat: the composed tree differs from the proven
merged tree only in `logs.py` and `logging.md`, so no unresolved question
required one.
