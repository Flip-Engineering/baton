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
- `Receive.ack_then_retire` skips acknowledgment and retirement for a
  monitor-only handle. The attempt stays unacknowledged and unreleased, and the
  pending input stays unread.
- `Observer.restore` returns `Restored` or `Rejected`. For a monitor-only
  handle, an empty or invalid reducer state returns `Rejected`, which ends the
  observation as `checkpoint rejected` without a write, a replay or a cursor
  move. A handle that is not monitor-only resets and replays as before.

## Codex frames larger than 4096 bytes

`Turn.retained_output` reads every Codex line as a span of the attempt spool
instead of materializing it.

- `Turn.codex_span_prefix_sql` classifies a span from its first 4096 bytes,
  closed with a quote and two braces when the prefix is not complete JSON. The
  Codex type fields precede the large body strings, so the prefix identifies an
  assistant message, a completed turn and a failed turn without parsing the
  body.
- A span of 4096 bytes or less is materialized and handled as text. A small
  frame that follows a span state fills the terminal slot of that state, or
  replaces the state when it is an assistant message.
- Every consumed span writes the checkpoint cursor, including a span whose
  reducer fields did not change.
- The state of a turn with a large message is the three-line value
  `codex-span-v1`, message token, terminal token. The result and the report are
  read from the full span when the turn ends.

## Tests

`bend2/test/observer-monitor.py` runs the focused observer recovery entry
(`bend2/test/observer-recovery-entry.bend`, which also serves
`--instance-owner` for the database owner) against `monitor-fixture`.
`OBSERVER_RECOVERY_BIN` and `OBSERVER_MONITOR_FIXTURE` select prebuilt
binaries. The 46,123,112-byte replay test reads the spool named by
`BATON_MONITOR_REPLAY_SPOOL_FIXTURE` and is skipped when that variable is not
set. It waits for recovery to finish and fails when the checkpoint cursor does
not move for 300 s.
