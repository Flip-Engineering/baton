# #769 fix review: commit `32efd84` on `account-credit-base`

Status: critic review record, 2026-10-17, seat accounts-glm, requested by conductor
accounts-wonder (task `message:accounts-wonder:103796f05a4f85b798fc164e535b0777`). Reviewed
`git show 32efd84c45cadda034d43c1c61cb1fb05449188b` against parent `2928c2c` in
`retained/baton-account-credits-793-702-20261017T0106Z/repo`, with the #769 tracker body and its
follow-up comment as the defect ground truth. Evaluator outcome is stated separately at the end:
this review is source and logic only; no remote build or behavioral suite has run for this commit.

**Verdict: approve the commit as a #769 source fix.** All four requested checks pass; the three
new tests are red on the parent commit by code-path trace and green on this commit. Two residual
notes (R1, R2) are recorded assumptions, not blockers.

## 1. Slot identity (logs.bend `frame_id_sql`)

The change inserts one branch into the identity `coalesce`: a frame whose `$.type` is
`message_start`, `message_update` or `message_end` and that carries none of `toolCallId`,
`messageId`, `message.id` receives the constant key `omp-open-message`; two responseId fallbacks
follow; the empty-string fallback stays last.

- **Interleaved explicit-id frames are safe.** Held entries are keyed by the pair
  (`entry_kind`, `entry_id`) and `entry_matches` requires both to equal
  (`logs.bend:148-149`), so the shared slot under kind `message_update` can never absorb an
  explicit-id entry of the same kind, and kinds never cross (`step_message_end` drops only
  `message_start`/`message_update` pairs, `step_tool_end` only `tool_execution_update`).
- **Lifecycle drop is complete.** `step_message_end` (`logs.bend:344-347`) writes the
  `message_end` line and drops both the held start and the held update for the slot, so a closed
  message leaves nothing in the flush path.
- **Checkpoint held format is unchanged.** Entry shape stays `kind\tid\tline`
  (`entry_of`, `logs.bend:145-146`); the commit touches no walk, drop, restore, or count
  function; the Observer checkpoint/restore path is not in the diff.
- **Flush order.** `held_put` prepends and dedups (`logs.bend:178-179`), so the newest snapshot
  replaces per slot; `flush` writes every remaining held line and `interrupted` counts them
  (`logs.bend:427-440`), so an interrupted stream flushes the newest snapshot it held. The
  growth path is closed at the right point: the old `step_prefix` wrote an unidentified frame
  immediately and held nothing (`logs.bend:354-357`, unchanged), which is exactly the 7,002
  cumulative copies the issue measured; the new key routes unidentified lifecycle frames into the
  identified arm, which holds and replaces without writing.
- **R1 (recorded assumption).** The fix relies on the provider keeping one unidentified partial
  message open at a time (the issue's own protocol observation). If a future OMP streams two
  unidentified messages concurrently, their snapshots coalesce into the one slot and the first
  message's partial view is lost from an interrupted flush. The exposure is bounded to the held
  flush view; terminal frames and `message_end` content are unaffected. If a provider ever emits
  a real id literally equal to `omp-open-message`, it would merge with the shared slot; real ids
  are provider UUIDs, so this is theoretical.
- **responseId fallbacks.** Because `omp_frame_kind` classifies strictly by `$.type`
  (`turn.bend:546-549`) and `frame_identity` is polled only for the five prefix/close kinds
  (`logs.bend:224-231`), the two responseId fallbacks are reachable only for
  `tool_execution_update`/`tool_execution_end` frames that lack `toolCallId`. For those they
  refine the old shared empty slot by response id: coalescing within one response is preserved
  (the old `''` behavior), separation across responses is added. Field names come from the
  cumulative fields the issue measured. No defect.

## 2. Filter refusal classification (turn.bend `filter_mode_sql`)

Exact string comparison of the old and new SQL bodies: the new string is a 150-character
inserted branch followed by the complete old expression verbatim. The inserted branch reads
`type='response' AND command='set_event_filter' AND coalesce(json_extract('$.success'),1)=0 THEN
'refused'`.

- A success cannot classify as refused: `success` true (or 1) makes `coalesce(...,1)=0` false.
- Another command cannot classify: both the `command` and `type` predicates must hold.
- A missing `success` value stays unclassified: `coalesce` substitutes 1, the refusal branch is
  false, and the shape reaches the id-matched branch, which requires `id='baton:filter'` — the
  measured #769 answer omits `id` — and therefore falls to the unchanged outer `ELSE ''`.
- The id-matched refusal outcome is unchanged: the old inner `ELSE` already produced `'refused'`
  for an id-matched answer with `success` not 1; the new branch reaches the same mode earlier.
- Only the id-matched success-with-matching-selection path confirms a selection, verbatim from
  the old string. Downstream, `Omp.filter_next` keeps the state on empty mode and `filter_note`
  distinguishes refused / unconfirmed / unacknowledged (`omp-player.bend:72-87`), so the new
  `'refused'` mode is the only behavioral difference, and it is the intended one.

## 3. Receive-loop extraction (turn.bend `consume_frame` / `FrameStep` / `frame_next`)

The `AwakeLine` arm's inline fold moved verbatim into `consume_frame`, which returns the folded
state as `Again{...}`; `frame_next` pattern-matches it and calls `consume` after the fold has
returned.

- **Field mapping is identical.** All 26 parameters of the old recursive call map one-to-one:
  `db, player, id, log` unchanged; `current_policy→policy`, `next_held→held`,
  `failed→log_failed`, `handle, harness` unchanged, `next_cursor→cursor`, `message→last_message`,
  `next_primary→primary`, `next_current→current`, `ended→terminal`, `next_filter→filter`,
  `requested` threaded through `frame_next`'s parameter, `codex_state→codex_log`,
  `next_error→first_error`, `sender, attempt` unchanged, `next_checkpoint→checkpoint_state`,
  `next_incomplete→incomplete`, `wake_sub, alive` unchanged, `wakes→deliveries`, `next` unchanged.
- **Ordering is identical.** Every IO action runs in the same sequence inside
  `consume_frame`: positioned write, log append, checkpoint-of-held (`held≠next_held` guard),
  guidance observe, terminal classification, deferred note, observation store, input close,
  codex frames, request observation, filter mode, checkpoint after observation, error/incomplete
  accumulation — and `wake_line` remains the final fold action, exactly as before, with the next
  read only after the fold returns.
- **`AwakeEnd` and the exhausted path are untouched** by the diff; `consume_exhausted` is
  unrevised.
- The memory claim (each frame's line, query results and closures released before the next read)
  is a runtime property of the new shape, matching the candidate described in the issue's
  follow-up comment. The behavior identity is proven here; the resident-memory effect is exactly
  what the issue says still awaits a built executable and focused RSS/checkpoint/continuity
  validation.

## 4. Tests fail on the parent commit

Traced against the old code paths, not executed:

- `turn.py test_omp_filter_refusal_without_id_is_recorded_and_turn_completes`: the stub answers
  with `success:false` and no `id`. Old `filter_mode_sql` requires `id='baton:filter'` and yields
  `''`; `filter_next` keeps the state; `filter_note` emits
  `outcome:"unacknowledged"` (`omp-player.bend:87`). The test asserts
  `frames[-1] == {..., "outcome":"refused"}` — **fails on old, passes on new**. The delivery and
  native-identity assertions hold on both (the turn completes either way); the discriminating
  assertion is the outcome field.
- `logs.py test_unidentified_cumulative_updates_keep_only_the_latest_snapshot`: old
  `frame_id_sql` yields `''` for all three snapshots, so the old `step_prefix` unidentified arm
  writes each immediately — the log records three `message_update` rows. The test asserts exactly
  one row equal to the last snapshot (Unicode payloads included) — **fails on old, passes on
  new** (two held, replaced; one flushed at turn end; the `toolCallId`-bearing tool update held
  under its own key).
- `logs.py test_unidentified_updates_close_with_their_message_end`: old code writes all three
  updates immediately; the test asserts zero `message_update` rows and one `message_end` row —
  **fails on old, passes on new** (all three held and dropped by the `message_end` close).

## Evaluator separation

No remote build, no behavioral suite, and no focused RSS run has executed for `32efd84`. The
test verdicts above are logic traces over the parent's code paths. The issue's follow-up already
separates the deployed producer-side backport (SHA `0d22b0ea...`) from this awaiting-validation
source fix; the remaining qualification is the built executable, the focused
RSS/checkpoint/native-continuity run, and the remote behavioral suites on the real coordinator
binary.
