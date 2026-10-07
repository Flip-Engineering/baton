# Shared custody owner: host interface

This document is the interface between `src/host/process-spawn.c` and the
coordinator code that starts native attempts. It describes what exists in the
source, what a caller must do, and what each test establishes.

## Resident processes

One owner process serves one physical database. It holds, for every admitted
attempt, the native child's stdin writer, `waitpid` authority, process group and
stdout spool. A coordinator or observer can exit without ending the native work
or losing its output.

The owner is started by the first client that needs it, as
`<self> --instance-owner <database>`. Later clients reach the same process.

## Election directory

Lock, socket, owner record and custody epoch live in one fixed per-user
directory, the first writable of:

- `$XDG_RUNTIME_DIR/baton2`
- `/tmp/baton2-<uid>`
- `$HOME/.local/state/baton2`

No client `TMPDIR` value participates, so two clients with different
environments still elect one owner. The directory is checked with `lstat` (a
symlink is refused), `mkdir` 0700, and a final `fstat` that requires a directory
owned by the effective uid; a directory with group or other permission bits is
changed to 0700. Intermediate components such as `/tmp` belong to the system and
are used as they are.

The election key is `owner-<st_dev hex>-<st_ino hex>` of the physical database
file, so a hard link or a symlink alias of the same file elects the same owner.

## Binding

`br_owner_bind` performs these steps in order:

1. `realpath` the database, `open` it read-only and `fstat` the descriptor.
2. `stat` the pathname and require the same identity, so a replaced file is
   `ESTALE` before the owner is elected.
3. Take `flock(LOCK_EX|LOCK_NB)` on `<key>.lock`. A second owner is `EBUSY`.
4. Increment the persistent custody epoch in `<key>.generation`. The epoch is a
   counter in the election directory, so it advances across owner restarts and
   is never derived from a row that can be removed.
5. Draw a 128-bit incarnation token from `/dev/urandom`.
6. Bind and listen on `<key>.sock`, then publish `<key>.record`: the token, the
   epoch, the device and inode, the pid and the socket pathname. The record and
   the epoch are written by rename with a device flush.

Every admission re-`fstat`s the held descriptor, re-`stat`s the pathname and
requires both to match the bound identity. An attempt directory is admitted when
its parent directory has the same `(st_dev, st_ino)` as the bound database's
parent, so an alias pathname's attempt directory is admitted and an unrelated
directory is not.

The owner holds the database descriptor for its lifetime and removes its socket
and record when it exits. Liveness is the election lock and the socket, never a
heartbeat or an elapsed time.

## Handshake

A client reads `<key>.record` after connecting and refuses a reply whose token or
epoch differs, so a socket left behind by an earlier owner incarnation is
rejected. A request carries the expected token and epoch; a mismatch is `ESTALE`,
and the client re-reads the record and retries exactly once.

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
`import ../host/instance.bend as Custody` then `Custody.Instance.admit(...)`.
The same rule applies to `ProcessChild` and `SessionLock` callers
(`P.ProcessChild.read_line(handle)`).

`Instance.admit` returns the `RetainedStart` shape that `ProcessChild.retain`
returns, so a caller keeps its existing `retained_start` handling. When the owner
refuses an admission that started no custody (`EINVAL`, `ESTALE`, `ENOENT`,
`ENOMEM`), the client removes the attempt directory and manifest it created, so a
retry prepares them again. A refusal that may leave custody running (`EEXIST` for
an attempt that already launched, `EBUSY` for an attempt the owner already holds)
leaves the directory in place.

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

The owner socket carries a 48-byte header, little-endian:

```c
typedef struct { uint32_t op; int32_t error;
                 uint64_t owner, epoch, attempt, generation, length; } BrInstanceFrame;
```

Requests are `BI_ENSURE`, `BI_ADMIT`, `BI_SHUTDOWN` and `BI_STATE`. `BI_ADMIT`
carries the attempt directory as a NUL-terminated payload and may carry the
session guard as `SCM_RIGHTS` on the header. The socket is a persistent listener:
`BI_ENSURE` resolves the owner for ordinary CLI and MCP entry points, which is
what makes the resident instance the single owner for the database.

A successful `BI_ADMIT` reply is `BI_HELLO` with the token, the epoch, the
attempt id, the attempt generation and a `BrOwnerState` payload. `Instance.admit`
then connects to the attempt's own socket and performs the existing `BR_ATTACH`
handshake, so the client's observer protocol is the one it already uses.

## Observation checkpoint

`<attempt>/cursor` holds `BrCursor{ char magic[8]; uint64_t offset; uint64_t check; }`
and records the byte offset an observer has consumed from the attempt's stdout
spool. It is replaced by rename, without a device flush, because it is a resume
hint: a lost update means an observer reads a little more of the stream again.
An attaching observer resumes at the recorded offset, and the checkpoint
advances after every consumed frame, so recovery reads the unread extent instead
of parsing frames the previous observer already reported. A short, oversized or
checksum-mismatched record is a typed refusal and writes `<attempt>/cursor-error`;
a corrupted checkpoint never silently replays a stream.

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

`test/shared-instance.py` runs against the built `test/instance.bend`, which
`scripts/check-native.sh` builds with the other native test entries:

- Three concurrent attempts produce three distinct native processes whose parent
  is the single owner process for the database, and each attempt sees only its
  own input.
- A second owner for the same database is refused while the first holds it.
- A hard link to the database elects the owner already running: a second owner
  through the alias is refused, and an attempt admitted through the alias path
  runs under the same owner process.
- After the observer process is killed, the native child keeps running, and the
  recovery observer the owner launches reads the attempt's retained output from
  the beginning of its spool and continues to report new output and the exit
  status.
- An observer that consumed part of the stream leaves a checkpoint, and the
  recovery observer resumes there: it does not report output the checkpoint
  already covered.
- A corrupted checkpoint is refused and recorded, and the stream is not replayed.
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
- The owner holds one waiter thread and one wake pipe per attempt, and watches
  each attempt's spool file to notify the observer. The observer still reads the
  spool with blocking `read_line`, so readiness-driven child reads remain the
  controls handoff.
- The custody event subscription a UI client would use is specified in the
  coordination message that carries this interface; it is not implemented yet.
- Owner loss leaves each attempt's native child running with its spool intact,
  and the client falls back to the existing orphan attachment. A replacement
  owner starts custody only for an attempt whose manifest has no `launch` marker,
  so it never starts a second native child for a running attempt.
