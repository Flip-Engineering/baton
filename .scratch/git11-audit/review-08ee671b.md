# Independent review of published 08ee671b (bend2-git11)

Swarm contribution: seq 424741, swarm-bend2-20260924.
Reviewed tree: 08ee671b62528888a2facd0d3a8ce2af34e5ef98 (origin/bend2-rewrite at review time).
Tree of that commit: c06e2bb1d2be32c04c7e89d185c7a10f6723bfa2. bend2 subtree: 935f829d58af4c2eb847819023b28447a3b783e3.
Isolated checkout for this review: `.scratch/review-08ee671b` (kept).
Read-only. No source, docs or branch change; no compiler, test or probe run; no push.

## 1. Receive fallback and recovery sequence

Source sequence, `bend2/src/coordinator/receive.bend`:

- `observed` (:121) reads the refusal from the current attempt and calls `complete_or_restart`.
- `complete_or_restart` (:116, call site :124): `gone=False` to `completed` (:80); `gone=True` to `restart_pending` (:104).
- `restart_pending` (:104): `record_recovery` (:97) then `recovery_input` (:89); then release the observer, release the process handle, fork `Root.deliver(:recovery)`, re-enter receive through `again`, join the delivery, acknowledge.
- `recovery_input` (:89): one `BEGIN IMMEDIATE` transaction; insert the recovery-input message only while `sessions.native` matches; clear `native` under `changes()=1`; insert the parent recovery report.

Reachable from the entry. `main.bend` receive path: `run` -> `acquired` (:161) -> `selected` (:137) -> `started` (:126) -> `observed` (:121). `main.bend` `--recover-receive` path: `recover` (:194) -> `attach_recorded` (:182) -> `observe_attached` (:187).

Law coverage. Qualified search of all seven `bend2/src/*/laws.bend`: `Receive.acquired` and `Receive.attach_recorded` are named. `observed`, `complete_or_restart`, `restart_pending`, `recovery_input`, `record_recovery`, `observe_attached`, `recover`, `selected`, `started`, `completed` are named by no law. The refusal predicate is partly bound under M-2; the dispatch on it is not.

## 2. Checked tree, verdict and candidate linkage

Source, `bend2/src/git/land.bend`:

- `ld_stage4` (:584) squashes the worker commit in the scratch tree; `ld_cand_read` (:601) reads the candidate commit; `LdCand{tip,cand}` carries the pair.
- `ld_stage6` (:746) creates the target worktree detached at `tip` (:752) and calls `ld_tree_runs`.
- `run_pair_go` (:389) runs each selected file in `candTree` then `targTree` and pairs the verdicts.
- `ld_tree_runs(True)` (:730) folds through `ld_judged` to `ld_advance` (:504).

Nominal coverage, `bend2/src/git/laws.bend`: `ld_judged_news(Nil,...) == ld_advance(repo,target,cand,tip)` (:807); CAS argv (:819); CAS invocation (:835); changed-basis block (:849); CAS outcomes (:860, :870).

Not named by any law: `ld_stage6`, `run_pairs`, `run_pair_go`, `ld_cand_read`, `ld_stage4`, `ld_stage5`, `ld_adv_tip`, `ld_adv_busy`, `run_check`. Only `ld_tree_runs`' `False` branch carries an equation (:1038).

Consequence: the effect of a moved target is fully constrained; no equation ties either verdict to the tree it was produced in. `bend2/test/land.py` exercises the linkage.

## 3. #633 repair present at the published tree

#633 records a landing that published `15d0f726...` while its checked tree was `593772aa...`. At 08ee671b:

- `ld_adv_tip` (:481) reads the current target commit and compares it with the checked basis; `ld_adv_same` (:466) blocks with `LBlocked` (:469) on a mismatch.
- `ld_update_argv` (:454) builds `git update-ref refs/heads/<target> <cand> <basis>`; `ld_adv_update` (:463) runs it. `basis` is the commit the target worktree was created at (:752); `cand` is the commit read in the scratch tree (:601).

The published pair is the checked pair, and the write is a compare-and-swap against the checked basis. Present and correct by inspection; no probe run.

## 4. Root gate and publication linkage

Retained summary: `baton-bend2-root-20260928/.scratch/root-handoff-20260928/20260928T230149.267520Z/summary.json`.

- `expected_head` 08ee671b. Three stages, all passed, exit 0: build-native, laws-check, check-native.
- Head, tree and bend2 tree unchanged before and after every stage: head 08ee671b, tree c06e2bb1..., bend2 tree 935f829d...
- Recomputed: `08ee671b^{tree}` = c06e2bb1..., `08ee671b:bend2` = 935f829d... So the gate measured exactly the published tree.
- laws-check log: `green - 223 laws, 2 mutations, 226 compiles, 0 failures`. Baseline row passed; both mutation rows `applied:true, gate:refuses, passed:true`; zero failed rows.
- Law count in the tree: 223 (git 106, coordinator 84, harness 16, json 6, main 4, host 3, receive-laws 3, canonical 1). Matches the log and the measurement document.
- Build binary sha256 `c1fc3aa2c1396989cd79bb214d93cf786aeae22370ad6d1532d363899c82aed4` equals `bend2_binary_sha256` in `docs/bend2/measurements/2026-09-28-coordinators-law-bearing.json`.
- check-native: 128 Python tests in 11 files; both Bend lane suites green.

These are the root's retained records read back, not a re-run.

## 5. Duplicated obligation

`receive-laws.bend:15 busy_receive_only_reports_queued` and `coordinator/laws.bend m8_one_native_owner_queues_the_second_writer` state the same equation:

```
Receive.acquired(db,session,cmd,model,effort,cwd,log,None{},again) == Receive.receive_status(db,session,"queued")
```

The copies differ only in the linearity annotations on the bound variables. Both count in the 223 and both are proof-removal-controlled. Redundancy in the count, not a defect.

## Reconciliation with peer reviews

- architect19, seq 421064: the two integration proof gaps match items 1 and 2.
- architect20, seq 424020: retained-fallback and checked-tree items match items 1 and 2; its settled-gates figures (223 laws, 2 mutations, 226 compiles, both Bend suites, 128 Python tests in 11 files) match the retained root logs exactly.
- git10, seq 422217: the accepted five-file delta attribution stands; its `docs/bend2/laws-trace.md` item stands (the word supplementary appears only in the r10 review-outcome row, not in the M-5 or M-14 rows).

## Proof limits

- The `git/laws.bend` header claim that every non-supplementary law there binds a function the entry reaches was not independently checked; that needs a full call-graph walk.
- Binary and executable hashes are taken from retained records; the runtime was not rebuilt.
- The mutation controls' named-law pass condition is self-detecting on a missing anchor. When the compiler names a different failing law first, the control reports a failure; the retained logs do not disambiguate which law the compiler named first.
