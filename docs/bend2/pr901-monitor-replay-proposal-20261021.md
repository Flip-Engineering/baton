# Monitor replay proposal, 2026-10-21

Source-only proposal for the PR901 monitor replay failure. This branch does not
replace the canonical artifacts and does not rewrite the failure record on
`codex/pr901-current-main-c021089a-20261021`.

## Base

- Base and combined head: `942b6075c437b0eea831350a4e15f75f30a3b9df`
- Base tree: `b8719c5af625ac2919ce15e846da952c5551aa9d`
- Proposal branch: `codex/pr901-monitor-replay-proposal-20261021`

## Isolation evidence

The canonical `observer-recovery` binary was run against the preserved attempt
under `gdb`. The host process calls were:

```text
CALL kind=44 (BP_OBSERVER_RECOVERY)
CALL kind=34 observer_only=1 (BP_INSTANCE_STATE)
CALL kind=42 (BP_INSTANCE_INPUT_WITNESS)
CALL kind=11 observer_only=1 (BP_ACK)
CALL kind=23 observer_only=1 (BP_INSTANCE_RETIRE)
Operation not permitted
```

No `BP_READ_SPAN` (kind 45), `BP_INSTANCE_MONITOR_COMMIT` (kind 48) or
`BP_INSTANCE_REPLAY` (kind 26) call occurred. The recovery adopted the attempt,
read its custody state, and entered the completion path without reading the
46,123,112-byte spool.

`strace` recorded a session-lock `flock` returning `EAGAIN` during
`BP_OBSERVER_RECOVERY`. The later `BP_INSTANCE_STATE` and
`BP_INSTANCE_INPUT_WITNESS` calls show that adoption succeeded. The session-lock
`EAGAIN` is not the operation that terminates the recovery.

The direct `EPERM` is the host refusal of `BP_ACK` and `BP_INSTANCE_RETIRE` for
the monitor-only handle. `br_command` refuses `BR_ACK`; `baton_process_call`
refuses `BP_INSTANCE_RETIRE` when `retained->observer_only` is set.

The behavioral cause is in `receive.bend::observe_guarded_state`: when
`orphan_native_gone` is true, the function builds an unknown-status outcome and
calls `completed_orphan`. It does not call `Turn.retained_output`, so a monitor
recovery with an exited native never replays the retained spool.

## Patch

`bend2/src/coordinator/receive.bend`:

- `observe_guarded_state` with `gone=True` now reads
  `Observer.monitor_handle`. A monitor handle goes to `gone_monitor`, which
  records `unavailable: native exit status was not retained`, runs
  `Turn.retained_output`, and completes through `completed_observation`. A
  non-monitor handle keeps the existing `gone_orphan` path.
- `ack_then_retire` now takes the database, checks
  `Observer.monitor_handle`, and skips acknowledgment and retirement for a
  monitor handle. The non-monitor acknowledgment and retirement remain in
  `ack_and_retire`.

Expected behavior for the required test: the recovery replays the retained
spool from the stored cursor to EOF, commits monitor checkpoints, records
`unavailable: native exit status was not retained`, leaves the attempt
unacknowledged and unreleased, and exits nonzero because the native status is
unavailable. The final checkpoint and custody offsets should equal 46,123,112.

## Restore-invalid monitor path

`Turn.retained_output` computes `monitor = Observer.monitor_handle(db,handle)`.
When monitor is true it calls `Observer.restore(db,handle,True)`.
`Observer.restore` and `decode` now return `RestoreOutcome`.

- A valid stored state returns `Restored{state}`.
- An empty or invalid state with `monitor=true` returns
  `Rejected{"Native observer checkpoint state is empty or invalid at its
  retained cursor."}`.
- `monitor=false` keeps the existing non-monitor reset in
  `reset_nonmonitor`, which calls `Custody.Instance.replay` and commits an
  empty non-monitor state. That helper is not reachable with monitor true.

The rejected outcome becomes
`Ended{"checkpoint rejected","",reason,True{}}` in `retained_output_restored`.
It opens no subscription, writes no state, moves no cursor, and does not
acknowledge or retire. The existing checkpoint and custody remain.

The earlier `reset_empty_case` monitor branch committed an empty reducer at the
existing cursor. At a nonzero cursor that discarded held or terminal projection
while retaining consumed offsets. The monitor branch is removed. A
`monitor_reset...` law that enshrined the empty commit was removed; no law
asserts that empty commit is safe.

`monitor_handle` reads `observation` from `Custody.Instance.state`;
`br_instance_state_call` reports `monitor` when `retained->observer_only` is
set. If that predicate returns false for a monitor-only handle, the
non-monitor reset path becomes reachable; a future change to the field or guard
requires re-evaluation.

## 398d73b9 applicability

`398d73b9` is not present in this checkout or its fetched refs. It was not
applied or reviewed here. The 398d candidate `ef699465` and run
`1792614554404765428-469924` are pending under the root build custody hold.
This proposal keeps parent `942b6075c`. The analysis and host-guard limits
apply to `942b6075c`; if the pending candidate or a later change alters the
observer-only guard, the `Custody.Instance.state` observation field, or the
monitor checkpoint validation, the proposal must be re-evaluated.

## Host-guard limits

- `baton_process_call` rejects `BP_INSTANCE_REPLAY` when
  `retained->observer_only` is set.
- `br_command` rejects `BR_ACK`, `BR_RELEASE`, `BR_CLOSE`, `BR_WRITE` and
  `BR_SIGNAL` for a monitor-only keeper.
- `br_monitor_checkpoint` accepts only `observer_only`, and for an
  orphan-adopted monitor it requires `offset >= custody.offset` and rewrites
  the custody record.

The monitor invalid path rejects without replay or commit. Valid monitor state
proceeds to `monitor_commit` through the existing consume path. The proposal
does not change these host guards.

## Focused checks

Earlier direct check-only receipts, before the current custody hold, used the
released compiler `2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019`:

- `bend2/src/coordinator/observer-checkpoint.bend`: status 0
- `bend2/src/coordinator/turn.bend`: status 0
- `bend2/src/coordinator/receive.bend`: status 0
- `bend2/src/coordinator/observer-checkpoint-laws.bend`: status 0
- `bend2/test/observer-recovery-entry.bend`: status 0

The final source edit changed the monitor status string in `receive.bend` and
renamed the empty outcome helper. No new check-only was run under the custody
hold. All Bend2 compiler invocations now require the maintained shared-build
custody launchers.

## Limits

The proposal is not behaviorally verified. The canonical `observer-recovery`
binary was not rebuilt and no installed runtime was changed. The gone-native
monitor path, monitor completion, and `completed_observation` profile,
transient and restart paths were not exercised.

Acceptance must exercise a valid nonzero checkpoint through EOF and the
rejected-state path. Neither ran on a build. The prior empty-at-cursor risk is
named above; the successor rejects empty or invalid monitor state before any
write. The non-monitor reset remains and uses replay outside the monitor guard.

`893355f04` and the failed 46,123,112-byte evidence remain unchanged. No
independent ACK was sent.
