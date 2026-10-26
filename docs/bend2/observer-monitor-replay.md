# Monitor-only observer recovery

This document describes how `--recover-observer` handles an attempt whose
keeper and database owner have ended, and how it handles Codex frames larger
than the checkpoint reducer reads. `bend2/test/observer-monitor.py` exercises
each behavior.

## Monitor-only custody

An attempt that lost its keeper is adopted as monitor-only custody. The host
refuses acknowledgment, release, close, write, signal and replay for a
monitor-only handle, so recovery only reads the retained spool and advances the
checkpoint and custody cursors.

- `Receive.observe_guarded_state` sends a handle with a gone native to
  `gone_monitor` when `Observer.monitor_handle` is true. `gone_monitor` records
  `unavailable: native exit status was not retained`, replays the retained
  spool through `Turn.retained_output` from the stored cursor to the end of the
  file, and completes through `completed_observation`. A handle that is not
  monitor-only keeps `gone_orphan`.
- `Receive.ack_then_retire` preserves a monitor-only handle's custody and
  admission ticket. The pending input stays unread. An owned completed handle
  follows the existing acknowledgment, ticket cleanup and retirement path.
- `Observer.restore` returns `Restored` or `Rejected`. For a monitor-only
  handle, an empty or invalid reducer state returns `Rejected`, which ends the
  observation as `checkpoint rejected` without a write, a replay or a cursor
  move. An owned handle resets its checkpoint and replays its retained spool.

## Codex frames larger than 4096 bytes

`Turn.retained_output` reads every Codex line as a byte range in the attempt
spool.

- `Turn.codex_frame_kind_sql`, `codex_frame_role_sql` and
  `codex_observation_span_sql` classify the complete retained JSON through
  `DB.Sql.query_span`. JSON escapes and the position of type fields preserve
  their ordinary JSON meaning. Classification returns the command kind,
  assistant or terminal role, or observation event type.
- A span of 4096 bytes or less is materialized and handled as text. A small
  frame that follows a span state fills the terminal slot of that state, or
  replaces the state when it is an assistant message.
- Every consumed span writes the checkpoint cursor, including a span whose
  reducer fields did not change.
- The state of a turn with a large message is the three-line value
  `codex-span-v1`, message token, terminal token. The result and the report are
  read from the full span when the turn ends.
- Span observations apply the configured harness check and the store's busy
  retry used by other native observations. Read state derives from the
  recipient's `message_reads` rows.

## Tests

`bend2/test/observer-monitor.py` runs observer recovery against `monitor-fixture`.
For production-role qualification, `OBSERVER_RECOVERY_BIN` selects a packaged
`receive-recovery-focused.bend` binary. The test's default entry,
`bend2/test/observer-recovery-entry.bend`, serves isolated fixture runs.
`OBSERVER_RECOVERY_BIN` and `OBSERVER_MONITOR_FIXTURE` select prebuilt
binaries. The 46,123,112-byte replay test reads the spool named by
`BATON_MONITOR_REPLAY_SPOOL_FIXTURE` and is skipped when that variable is not
set. It retains the recovery process until completion and checks the final
checkpoint, custody and output cursors. A slow replay retains its unfinished
qualification state.
