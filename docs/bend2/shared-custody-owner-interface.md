# Shared custody owner: host interface

This document is the interface between `src/host/process-spawn.c` and the
coordinator code that starts native attempts. It describes what exists in the
source, what a caller must do, and what each test establishes.

## Resident processes

One owner process serves one canonical database. It holds, for every admitted
attempt, the native child's stdin writer, `waitpid` authority, process group and
stdout spool. A coordinator or observer can exit without ending the native work
or losing its output.

The owner is started by the first client that needs it, as
`<self> --instance-owner <database>`. Later clients reach the same process.

## Binding

`br_owner_bind` performs these steps in order:

1. `realpath` the database, `stat` it; a non-regular file is `EINVAL` and a file
   with more than one link is `EMLINK`.
2. `open` `<database>.owner-lock` and take `flock(LOCK_EX|LOCK_NB)`. A second
   owner is refused with `EBUSY`.
3. Draw a 128-bit token from `/dev/urandom` and write it to
   `<database>.owner-token` with `fsync`.
4. `bind` a rendezvous socket under `TMPDIR` with a name derived from the
   database's `(st_dev, st_ino)`, then `listen`.
5. Write the bound pathname to `<database>.owner-endpoint`.

Every admission re-`stat`s the database path and compares `(st_dev, st_ino)`
with the bound identity; a replacement is `ESTALE`. An attempt directory outside
`<database>.attempt-` is `EINVAL`.

`<database>.owner-endpoint` exists so a client started with a different `TMPDIR`
connects to the owner that is running. Its content is the pathname the owner
bound. The owner removes both the socket and the endpoint record when it exits.

## Bend surface

```bend
def Instance.owner(database: String) -> IO(Result<&1,&1,U32 & String,Unit>)
def Instance.admit(database: String, directory: String, argv: String, cwd: String,
                   stderr: String, initial: String, keep_stdin: U32,
                   lock: Maybe<U32>, recovery_argv: String)
  -> IO(Result<&1,&1,U32 & String,P.RetainedStart>)
def Instance.attach(database: String, directory: String)
  -> IO(Result<&1,&1,U32 & String,U32>)
def Instance.attach_owned(database: String, directory: String, lock: U32)
  -> IO(Result<&1,&1,U32 & String,U32>)
def Instance.shutdown(database: String) -> IO(Result<&1,&1,U32 & String,Unit>)
def Instance.retire(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>)
```

The module is `src/host/instance.bend`. A caller imports the file with any alias
and writes the alias, the module name and the function:
`import ../host/instance.bend as Custody` then
`Custody.Instance.admit(...)`. The same rule applies to `ProcessChild` and
`SessionLock` callers (`P.ProcessChild.read_line(handle)`).

`Instance.admit` returns the `RetainedStart` shape that `ProcessChild.retain`
returns, so a caller keeps its existing `retained_start` handling.

## Unchanged caller surface

A handle from `Instance.admit` or `Instance.attach` supports the existing
attempt operations with their current signatures: `ProcessChild.write`,
`close_stdin`, `read_line`, `wait`, `signal`, `input_closed`, `pid`, `release`,
`acknowledge`, `control_write(directory,...)` and
`control_signal(directory,...)`.

The attempt protocol is unchanged: `BR_WRITE`, `BR_CLOSE`, `BR_RELEASE`,
`BR_ACK`, `BR_CHANGE`, `BR_EXIT`, `BR_INPUT_CLOSED`, `BR_REPLY`, `BR_ATTACH`,
`BR_CONTROL_WRITE`, `BR_CONTROL_SIGNAL`.

## Owner protocol

The owner socket carries a 40-byte header, little-endian:

```c
typedef struct { uint32_t op; int32_t error;
                 uint64_t owner, attempt, generation, length; } BrInstanceFrame;
```

Requests are `BI_ENSURE`, `BI_ADMIT`, `BI_SHUTDOWN` and `BI_STATE`. `BI_ADMIT`
carries the attempt directory as a NUL-terminated payload and may carry the
session guard as `SCM_RIGHTS` on the header. A request whose `owner` field does
not equal the bound token is refused with `ESTALE`.

A successful `BI_ADMIT` reply is `BI_HELLO` with the owner token,
the attempt id, the attempt generation and a `BrState` payload
(`pid,exited,status,released,input_closed`). `Instance.admit` then connects to
the attempt's own socket and performs the existing `BR_ATTACH` handshake, so the
client's observer protocol is the one it already uses.

`BI_ADMIT` refuses an attempt that already launched, so a retry after a lost
reply never starts a second native child for the same attempt.

## Capability lifetime

A child capability packs a slot index and a generation into the `U32` handle.
`Instance.retire` requires that the attempt was acknowledged, releases the
retained observer state, returns the slot to a free list and advances the slot's
generation. A request for a retired generation fails with `ESTALE` and does not
reach the slot's new child. A slot whose generation reaches the encoding maximum
is not reused.

## Caller changes this interface requires

1. `receive.bend:selected` — `ProcessChild.retain(attempt,argv,cwd,stderr,initial,keep_stdin,lock,recovery_argv)`
   becomes `Custody.Instance.admit(db,attempt,argv,cwd,stderr,initial,keep_stdin,lock,recovery_argv)`.
2. `receive.bend:recover` and `recover_owned` — `ProcessChild.attach(directory)`
   and `ProcessChild.attach_owned(directory,lock)` become the `Instance`
   equivalents with the database first.
3. `receive.bend:finish_pending` — after the existing `ProcessChild.acknowledge`,
   call `Custody.Instance.retire(handle)`.
4. The product entry needs a case for `--instance-owner DATABASE` that calls
   `Custody.Instance.owner(database)`. It must sit before the
   `case db <> rest` branch so an ordinary `<database> <command>` invocation is
   unaffected. `test/instance.bend:owner_cli` is a working shape for that case.

## What the tests establish

`test/shared-instance.py` runs against the built `test/instance.bend`:

- Three concurrent attempts produce three distinct native processes whose parent
  is the single owner process for the database; each attempt sees only its own
  input.
- A second owner for the same database is refused while the first holds it.
- A hard link to the database is refused by the physical-identity check.
- After the observer process is killed, the native child keeps running, and the
  recovery observer the owner launches reads the attempt's retained output from
  the beginning of its spool and continues to report new output and the exit
  status.
- A write through a retired capability is refused.
- `Instance.shutdown` ends the owner, and a later attempt starts a new one.

`test/process.py`, `test/retained-control.py`, `test/receive.py` and
`test/native-cli.py` run unchanged as regression controls for the launch path.

## Limits

- The owner is reachable only through `Instance.*` until the Receive and Direct
  callers accept the changes above. Until then the product starts one keeper
  process per attempt.
- The child environment is still `environ`; the explicit snapshot and
  `prepare_env` receipt remain with their named owner.
- The owner holds one waiter thread and one wake pipe per attempt, and it watches
  each attempt's spool file to notify the observer. The observer still reads the
  spool with blocking `read_line`, so readiness-driven child reads remain the
  controls handoff.
- Owner loss leaves each attempt's native child running with its spool intact;
  the client falls back to the existing orphan attachment. A replacement owner
  starts custody only for attempts whose manifest has no `launch` marker, so it
  never starts a second native child for a running attempt.
