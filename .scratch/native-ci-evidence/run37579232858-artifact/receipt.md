# Run 37579232858 laws-check failure classification — artifact 11475228995

Root-routed inspection (synthesis317 item 1). No gate rerun; this is analysis of the retained artifact only.

## Artifact identity

- Artifact 11475228995, name `baton2-development-darwin-arm64-70e53a210c22274c9451e829a77e9e35515eb36f-1`, 41 files, 24,181,488 bytes.
- Downloaded zip SHA256 `0f39fee2dd371aecf9410450d63fe2db33b58a81b31041826e86a1b16ea58712` — matches the routed digest exactly.
- Run source: HEAD `70e53a210c22274c9451e829a77e9e35515eb36f` ("Merge qualified held-worktree landing correction"), tree `62da8657f7e8c3b1832190ead6371ddec46ded42`, bend2 tree `96da21430e9146a671b7eb9e44169fc72678a583` (per `package/gates/summary.json`).
- Compiler: bend 2.0.25 darwin-arm64, binary SHA256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`; runtime base.bend `e5639663…` matches the pinned upstream digest.

## Gate outcome

`laws-check: red - 606 laws, 182 mutations, 789 compiles, 1 failures`. Baseline entry compile passed (build had passed before step 5). Exactly one failed control:

```json
{"mutation":"m3a-held-advance-drops-the-fast-forward-requirement","law":"m3a_held_advance_is_the_worktree_fast_forward","applied":false,"gate":"accepts","passed":false}
```

## Classification: stale negative control, not an established law violation

The failed control is a mutation whose `find` text no longer matches the source:

- Mutation find (laws-check.mjs at 70e53a21): `    g : T.GitOut <- Git.runGit(p2, ["merge", "--ff-only", c2])` — binder `g`, 4-space indent.
- Actual source at `bend2/src/git/land.bend:281` (70e53a21): `        merged : T.GitOut <- Git.runGit(p2, ["merge", "--ff-only", c2])` — binder `merged`, 8-space indent, inside `ld_adv_wt_head_same`'s `True{}` branch.

Because the find text matches nothing, the mutation did not apply (`applied:false`); the entry compiled (`gate:"accepts"`), and by the laws-check contract a mutation that cannot refuse compilation is recorded as a failure (`passed:false`).

Two facts bound the classification:

1. The fast-forward requirement the mutation targets is present and intact in the implementation at this source (`["merge", "--ff-only", c2]` at land.bend:281).
2. The named law `m3a_held_advance_is_the_worktree_fast_forward` (bend2/src/git/laws.bend:1107) was exercised by no failed control: its proof-removal control passed, and this mutation is the only control naming it. The red result therefore does not establish that the law fails to bind the implementation.

The drift is consistent with the run source being the merge of the held-worktree landing correction: the correction renamed the binder and reindented the call, and the mutation list in laws-check.mjs was not updated in the same change.

## Repair direction (owner's, not executed here)

Update the mutation's find/replace pair to the current text (`merged` binder, 8-space indent) so the control applies again, restoring the gate's ability to prove the law binds the `--ff-only` requirement. This is a one-pair source edit in bend2/scripts/laws-check.mjs; no rerun was performed per the task constraint.

## Evidence

`.scratch/native-ci-evidence/run37579232858-artifact/` — artifact.zip (digest above), extracted `package/gates/laws-check.log` (3,156,918 bytes), `summary.json`, `result.json`, compiler manifests.
