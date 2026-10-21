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
  records the unknown exit status, runs `Turn.retained_output`, and completes
  through `completed_observation`. A non-monitor handle keeps the existing
  `gone_orphan` path.
- `ack_then_retire` now takes the database, checks
  `Observer.monitor_handle`, and skips acknowledgment and retirement for a
  monitor handle. The non-monitor acknowledgment and retirement remain in
  `ack_and_retire`.

Expected behavior for the required test: the recovery replays the retained
spool from the stored cursor to EOF, commits monitor checkpoints, records
`unknown after keeper loss`, leaves the attempt unacknowledged and unreleased,
and exits nonzero because the native status is unknown. The final checkpoint
and custody offsets should equal 46,123,112.

## Focused checks

Both commands use the released compiler
`2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019`:

```sh
bend --check-only bend2/src/coordinator/receive.bend
bend --check-only bend2/test/observer-recovery-entry.bend
```

Both returned status 0. `receive.bend` reported only the usual unsafe or
foreign definitions. No build, replay, or full-suite run was performed.

## Limits

The proposal is not behaviorally verified. The canonical `observer-recovery`
binary was not rebuilt and no installed runtime was changed.

If `Observer.restore` rejects the stored reducer state, the recovery calls
`Instance.replay`. The host still refuses `BP_INSTANCE_REPLAY` on a
monitor-only handle. A monitor replay would also have to reconcile the
non-decreasing custody cursor enforced by `br_monitor_checkpoint`. This
proposal does not change that host guard; it addresses the observed path where
the stored state is used and the gone branch skips the spool entirely.

`completed_observation` has profile, transient and restart paths that were not
exercised. Root decides whether this proposal is the correct fix or whether
the monitor replay guard and cursor reset belong in the same change.
