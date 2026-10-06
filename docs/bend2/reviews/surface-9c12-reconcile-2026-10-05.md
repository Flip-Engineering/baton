# audit-surface: reconciliation of the 9c12 preliminary review — three corrections, exact derivations, and the 9c12..0598302f source review

Remote-only; committed-blob reads; no local compilation, SQL probing or fixtures. Original audit-surface-9c12-source-review stays retained; this reconciles three discrepancies with exact derivations and reviews 9c12..0598302f source-only.

## Correction 1 — loop-call laws: observed caller vs proved coverage

The three laws (`omp_retained_message_is_the_loop_call`, `omp_retained_activity_is_the_loop_call`, `omp_normalized_step_is_the_loop_call`) equate each WRAPPER BODY with its helper/gate call (`omp_message`/`omp_activity`/`omp_terminal` under `omp_terminal_enabled`/`omp_activity_enabled`). They do not contain `consume` and leave imperative wrapper bypass or recursive activity drop unconstrained. Corrected statement: consume's use of the wrappers is OBSERVED correct caller source (git-read at 9c12cc6d), not PROVED caller coverage; d4107d22's `receive-host-controls.json` supplies separate, unexecuted host controls for exactly the three actual consume mutations. My original "wrapper-law scope closed at source level" overstated closure; the accurate statement is "wrapper bodies bound; caller coverage observed only".

## Correction 2 — the exact six added laws-check controls

The added controls in `git diff 7b3eb519..9c12cc6d -- bend2/scripts/laws-check.mjs` are, exactly:
1. `terminal-decision-drops-the-keep-branch` (turn.bend) → law `omp_terminal_decision_composition_is_ordered`;
2. `terminal-decision-swaps-the-keep-and-conflict-branches` (turn.bend) → same law;
3. `terminal-decision-replaces-the-justified-branch` (turn.bend) → same law;
4. `activity-gate-always-enabled` (turn.bend) → law `omp_activity_enabled_is_the_harness_gate`;
5. `terminal-gate-always-enabled` (turn.bend) → law `omp_terminal_enabled_is_the_omp_relevance_gate`;
6. `outcome-failed-bypasses-the-classifier` (receive.bend) → law `receive_outcome_failed_reads_the_classifier`.
My original report named the pre-existing receive.bend cursor/origin mutations instead — wrong set, corrected here. Note: control 6 is the outcome_failed caller binding whose absence I flagged at 2f846fb7; it now exists at this lineage.

## Correction 3 — ordered E1/E2 derivation: my stale-E1 claim was unsupported

Committed order at 9c12: branch 1 `error=0 AND message≠'' AND commanding=1 → retained`; branch 2 `justified=1 → retained`; branch 3 `named=1 → keep event`; branch 4 `message≠'' → conflict (empty)`; branch 5 `error=1 → conflict`; else event — justified precedes named. Predicates: `commanding` = last activity kind is message_end; `same` = retained message responseId equals last activity id; `seen` = terminal error id appears in the activity; `named` = last activity id equals terminal error id. `justified = commanding AND same AND seen` — with NO success-only guard.

Exact derivation for observed E1 (start+end, stopReason error) then completed E2 (start+end, success) then elided terminal naming E1: activity = [sE1,eE1,sE2,eE2]; commanding=1 (last = end E2); message = retained = E2's message_end; same=1 (E2==E2); seen=1 (E1 in activity); justified=1 → branch 2 substitutes the retained E2 success BEFORE the named branch. **The candidate reports the later completed success E2 — my "9c12 reports the classified stale E1 failure" claim is not supported by source for this input and is withdrawn.**

Preserved distinct counterexample (exact input): observed E1 (start+end, stopReason error) → observed start E3 (role assistant, responseId resp-e3, NO end) → elided terminal naming E1. Then commanding=0 (last activity is a start), justified=0; named: last activity id resp-e3 ≠ error_id resp-e1 → 0; message≠'' (retained = E1's message_end) → branch 4 conflict/empty → unavailable. Truthful state is uncertainty (E3 outcome unknown); the committed outcome is explicit unavailability — acceptable per the uncertainty requirement, but it is the uncertainty path, not E1-as-current. Second residual: when the terminal names an error that the stream DID reach and no later activity exists, branch 3 keeps the terminal's own error — correct for the real #670 quota shape. First-binding overwrite by a later start and a post-second-start reread remain due, as the conductor notes.

## 9c12..0598302f source-only review (immutable pins, unvalidated locally)

- d8d1ce91: keep branch now requires a known (non-empty) terminal error identity matching the last activity id — two missing identities cannot establish which error the stream reached last; laws +2-line adjustment, turn change, +19 test lines.
- 25bcd3ef: requires explicit unavailable outcomes and covers an unidentified retained failure (+22 test lines). Test-only.
- 111fa032: retargets the stale review-4-era normalizer mutation definitions to the current named composition (3+/3− in laws-check.mjs). UNVALIDATED: source definitions only.
- 0598302f: binds the replay status to the ORIGINAL attempt — `native_status` now reads the sealed attempt's own directory `status` file via `os.WEXITSTATUS` instead of the recency-based executions row. This implements the exact sealed-execution binding I required; source-only, no local fixture run. A secondary executions read remains in the file for other assertions.
All four are marked source-only/unvalidated by their own messages; author continues; not a final successor or runtime verdict.

## Standing limits

Remote-only; no compiler/build/fixture execution by me; Root alone admits exact-source remote validation. My 5254/1e7de621 REQUEST CHANGES verdicts and the qualified 2f846fb7 runtime-only ACCEPT stay preserved as history. Final coherent successor, both final independent verdicts, native land-checked and root gates remain pending; #671 stays separately owned.
