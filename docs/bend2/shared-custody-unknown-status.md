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

New keepers write a `capabilities` file containing `reconcile`. The recovery
client sends `BR_CONTROL_RECONCILE` only when that file is present. A deployed
e6 keeper has no capability file, so the client never sends an operation the
keeper does not implement.

## Prohibitions

While custody is unknown, the adopted handle refuses acknowledgement, release,
write, close, signal, checkpoint commit and replay with `EPERM`. A wait returns
`unavailable: native exit status was not retained`; it never returns `exit 0`.
The attempt preparation path refuses an idempotent relaunch when a `custody`
record exists, so a new native cannot replace the original.

When the native exits and a valid status file appears, the monitor reports the
observed status. The adopted handle remains monitor-only; ordinary attachment
after exit remains the path for settlement.

## Tests

`bend2/test/custody-adopt.py` compiles `bend2/test/custody-adopt.c` and runs it
against the current keeper and against the deployed e6 keeper when
`BATON_E6_KEEPER` names that binary. The fixture covers live native, dead native
without status, PID/birth mismatch, retry, checkpoint retention, unavailable
wait, and refusal of acknowledgement, write, signal, replay and relaunch. It
checks that no native signal is sent.

## Limits

The adopting process holds the session guard. If that process exits, the guard
and the monitor disappear; a legacy keeper may then enter its own recovery. The
durable custody record remains, but no live process blocks the keeper after the
holder is gone.
