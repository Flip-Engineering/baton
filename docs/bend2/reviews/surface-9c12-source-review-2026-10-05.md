> Audit record by `audit-surface`, committed 2026-10-05 from the author's worktree. Findings 1, 4 and 7 below are corrected by `surface-9c12-reconcile-2026-10-05.md` in the same directory, which is the correction of record for this lineage (wrapper-law closure overstatement, withdrawn stale-E1 claim, corrected set of added controls).

# audit-surface: preliminary source-only review — receive9c12 (9c12cc6d, tree 704d0089)

Remote-only preliminary review: committed source reads, no local compilation, Bend checks, Clang builds or test gates; no runtime edits; d4107d22 (receive-host-controls.json only) noted as unexecuted definitions. This is not the final runtime verdict; root admits exact-source candidates.

## Scope verified

- Exact delta 732d767f..9c12cc6d: turn.bend (+16/−3) and laws.bend (+35) only — call-site wrappers plus their laws.
- Cumulative receive repair 7b3eb519..9c12cc6d: laws-check.mjs (+6 mutations), laws.bend (+194), turn.bend (+104), receive-retained-replay.py (+448), receive-terminal-boundary.py (+111). receive.bend is UNCHANGED since the 7b3eb519 freeze — classification/failure-query/outcome paths are frozen side; all post-freeze work is turn-side normalization/activity, laws and tests.

## Findings

1. **Wrapper-law scope closed at source level.** The three new loop-call wrappers (`omp_retained_message`, `omp_retained_activity`, `omp_normalized_step`) are what consume actually calls, and three new laws (`omp_retained_message_is_the_loop_call`, `omp_retained_activity_is_the_loop_call`, `omp_normalized_step_is_the_loop_call`) bind each wrapper to the real inner call with the real gates. The consume call-site bypass I flagged at 5254/1e7de621 is addressed.
2. **Decision binding upgraded to named pieces.** The `omp_terminal_sql` law now equates the full composition of named helpers (`omp_terminal_elided_sql`, `omp_terminal_error_sql`, `omp_terminal_activity_commanding_sql`, `omp_terminal_justified_sql`, `omp_terminal_named_sql`, `omp_terminal_conflict_sql`, `omp_terminal_retained_sql`) — the 1e7de621 delegation-only gap is addressed at source level.
3. **Bypass risks at 9c12: none found in consume.** `consume` calls `omp_retained_message`/`omp_retained_activity`/`omp_normalized_step` on every line; the activity wrapper is deliberately not relevance-gated (message_start must update activity), and `omp_activity_sql` keeps the json_valid/type guards (plain output stays inert — the 5254 regression cause remains fixed). Recursive-state: every consume entry either replays the stream from the first frame (reattach) or legitimately resets activity for a fresh attempt (restart path); no bypass found.
4. **Ordered outcomes: one open semantic point.** The decision's new `omp_terminal_named_sql` branch keeps the terminal event unchanged when the stream activity reached the terminal's error id. For the ordered case I fixture-verified at 1e7de621 (stream reaches LATER failure E2 after terminal repeats older E1), 9c12 now reports the classified E1 failure (previously empty/unavailable) — an improvement in classification with a remaining staleness question: E1 is a real failure but not the stream-latest one (E2). This needs the host discriminators on the final artifact to weigh; not source-decidable.
5. **First seal and pending input: unchanged.** `observe_completion_sql` sealed behavior and the deferred-episode note are untouched by both diffs; pending-input cursor/reconciliation paths are covered by the added mutation set.
6. **Historical status fixture identity: still open.** receive-retained-replay.py `native_status` still reads `SELECT status FROM executions WHERE session='parent' ORDER BY rowid DESC LIMIT 1` — recency-based row identity, not the exact sealed-attempt binding required by the acknowledged corrections. This is the one acknowledged gap I confirm still present at 9c12.
7. **Six added mutation definitions (read, not executed):** they target real receive.bend call sites — the `reconciled_cursor` invocation, the adopted/fresh observation origin flags, and the known-failure/terminal/read-error cursor conditions — each naming an existing law (`adopted_*`, `fresh_attempt_preserves_its_input_cursor`, `retained_observation_uses_the_reconciled_input_cursor`, `newly_started_process_uses_fresh_observation`, `recorded_owner_uses_adopted_observation`, `guarded_observation_preserves_its_adopted_origin`, `keeper_recovery_preserves_the_original_input_cursor`). Replacement strings are actual expression replacements at those call sites; relevance to the named laws holds by inspection. Execution evidence remains remote/root-owned.

## Concrete missing behavior/controls and semantic fixtures to require

- **Activity-call bypass control**: a mutation replacing the consume `omp_retained_activity(...)` call with `previous` (or the wrapper with a constant), bound to an activity-state law — none of the six added mutations covers the activity call site.
- **Normalizer bypass control**: a mutation replacing the consume `omp_normalized_step(...)` call with `event` unchanged — same gap.
- **Stale recursive activity fixture**: with helper bodies unchanged, a same-attempt sequence where the activity array's last entry names an assistant that the terminal array omits (missing observed start), asserting explicit uncertainty — pins the provenance rule host-side.
- **Exact sealed-execution status binding** (finding 6): assert the execution id equals the sealed attempt id, or read the sealed attempt's retained process status.
- Host discriminators for the ordered retained-success/current-failure/uncertain outcomes on the final artifact, per the standing requirements.

## Limits

Source-only: no compilation, no mutation execution, no fixture runs; `receive-host-controls.json` definitions are unexecuted; synthetic-vs-incident evidence distinction stands. Final runtime verdict, the coherent successor, both final independent verdicts, native land-checked and root's gates remain pending. My 5254/1e7de621 REQUEST CHANGES verdicts and the qualified 2f846fb7 runtime-only ACCEPT stay preserved as history; nothing here transfers acceptance.
