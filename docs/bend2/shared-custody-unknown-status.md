# Same-session custody with an unknown native status

A retained attempt can lose its observer while the native child is live, or
after the child exits without a durable `status` file. Issue #825 covers the
transition that keeps the exact attempt under monitor-only custody until a
status is observed.

## Transition

Observer recovery reads the admitted manifest, admission record, `native.pid`,
`native.birth`, the stdout spool, and the last validated checkpoint. It holds
the session guard and starts a monitor reader on the spool and the native
lifetime. It does not connect to the keeper, close a transferred connection,
signal the native, or spawn a new native.

The host writes one durable `custody` record in the attempt directory. The
record binds the manifest digest, native birth, spool device and inode, and the
checkpoint offset. Its flags name the status unknown and the input unfinished.
A retry validates the same identity and returns the same custody.

Recovery takes the session guard with a non-blocking exclusive lock. A live
holder keeps the attempt and the caller receives `EBUSY`.

The adopting process opens `monitor.lock` and holds an exclusive lock on it for
the lifetime of the monitor handle. A second adoption of the same attempt
returns `EBUSY`, so two observers cannot read the same spool and write the same
database. The lock ends when the process ends.

A legacy keeper reports `EBUSY` when another observer connection is still
attached. The client adopts only after the recorded observer process has ended.
A live observer keeps the attempt; the client returns `EBUSY` with a detail that
names the current receive.

When a keeper with a capability file cannot be reached for reconcile, the
connection errors `ENOENT`, `ECONNREFUSED`, `EPIPE` and `ECONNRESET` mark the
keeper as unavailable and take the same adoption path. This covers an owner
process that ended after preparing an owner-managed attempt.

New keepers write a `capabilities` file containing `reconcile`. The recovery
client sends `BR_CONTROL_RECONCILE` only when that file is present. A deployed
e6 keeper has no capability file, so the client never sends an operation the
keeper does not implement.

## Checkpoint

An adopted handle writes checkpoints through `Instance.monitor_commit`. The
host revalidates the custody record before each write: manifest digest, native
birth, and spool device and inode must equal the adoption values. The cursor
must not decrease and must stay within the current spool extent. The reducer
snapshot must be non-empty. A successful write stores the checkpoint and raises
the custody record's offset in the same step.

The ordinary `Instance.commit` operation remains refused with `EPERM` on an
adopted handle. The coordinator selects the monitor operation from the host
state field `observation`, which reads `monitor` for adopted custody.

## Prohibitions

While custody is unknown, the adopted handle refuses acknowledgement, release,
write, close, signal, ordinary checkpoint commit, and replay with `EPERM`. A
wait returns `unavailable: native exit status was not retained`; it never
returns `exit 0`. The attempt preparation path refuses an idempotent relaunch
when a `custody` record exists, so a new native cannot replace the original.

When the native exits and a valid status file appears, the monitor reports the
observed status. The adopted handle remains monitor-only; ordinary attachment
after exit remains the path for settlement.

## Coordinator outcome

`Turn.retained_output` reads the host observation mode. A monitor observation
returns an `Ended` outcome with `incomplete` set, so the completion path records
the observed status, keeps every owed message unread, and skips acknowledge and
retire. An incomplete observation also skips the refused-conversation restart,
which would otherwise record recovery input and attempt acknowledgement.
`release_native` skips the handle release for a monitor handle because the host
refuses it; the custody record, spool and checkpoint stay in place for a later
recovery.

## Tests

`bend2/test/custody-adopt.py` compiles `bend2/test/custody-adopt.c` and runs it
against the current keeper and against the deployed e6 keeper when
`BATON_E6_KEEPER` names that binary. The fixture covers live native, dead native
without status, PID/birth mismatch, retry, checkpoint retention, unavailable
wait, refusal of acknowledgement, write, signal, replay and relaunch, one
monitor checkpoint with manifest, birth, spool and cursor validation, and a
second adoption refusal while the monitor lock is held. It checks that no native
signal is sent.

`bend2/test/observer-monitor.py` runs the focused coordinator entry
`bend2/src/coordinator/receive-focused.bend` against an isolated database and a
retained native. It starts the attempt under the database owner, ends the
observer, kills the owner, and recovers the attempt with no status file. The
test checks that the native PID, birth, UUID argument and manifest are
unchanged, the durable checkpoint advances to the observed line once, a second
recovery leaves it in place, the owed message keeps a null receipt, the
execution status is the unavailable text, and no acknowledged or released
marker appears. A concurrent two-observer case checks that the cursor advances
once and the owed input remains.

## Limits

The adopting process holds the session guard and the monitor lock. If that
process exits, both end; a legacy keeper may then enter its own recovery. The
durable custody record remains, but no live process blocks the keeper after the
holder is gone.

The monitor reads spool lines through the existing retained reader. Memory use
for one line is proportional to that line's length. Receiver memory work is
tracked separately.
