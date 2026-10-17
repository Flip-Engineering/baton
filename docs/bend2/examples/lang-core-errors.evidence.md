# lang-core-errors — evidence

CLAIM: fallible effects answer the handle beside a `Result<&1, &1, (U32 & String), A>`, so a
failed operation keeps its live handle; IO.try unwraps the Done branch or exits the program with
the error; the Fail branch carries a U32 code and a String message. Destructuring happens in def
bodies: a do block binds only plain annotated binders.

## Environment

| | |
|---|---|
| Host | macOS 27.0 (Build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` with `BEND_HOME=<worktree>/node_modules/.bend` (this worktree is cut from master, whose `.gitignore` does not carry the `.bend/` lines, so the install lives under the ignored `node_modules/`) |
| Reference pin | `../reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. The scratch file the program writes and re-reads, and the IO.try variant,
live under `node_modules/.bend/scratch-core/` (git-ignored). The program's shape mirrors the
pinned upstream test `tests/io/fail_keeps_handle.bend`: a read on a write-only handle must fail
with EBADF while the handle stays usable for a following write.

## Commands and observed output

### 1. Type check

```sh
bend docs/bend2/examples/lang-core-errors.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run: a failed read keeps its handle, the write then succeeds, the file is read back

```sh
rm -f node_modules/.bend/scratch-core/errors.tmp
bend docs/bend2/examples/lang-core-errors.bend
```

```
read failed (9): Bad file descriptor
read: kept
```

Exit code 0. `report` matched the `Fail{error}` branch, destructured `(code, message)` and printed
code 9 with the system message; the same handle then wrote `kept`, closed, and a fresh open read
the string back through the `Done{data}` branch.

### 3. IO.try exits the program when the effect fails

`node_modules/.bend/scratch-core/errors-try-dies.bend`:

```python
import Base

def main() -> IO(Unit):
  do IO<Unit>:
    f : File <- IO.try(File, File.open("node_modules/.bend/scratch-core/absent.tmp", "r"))
    IO.print("unreachable")
```

```sh
bend node_modules/.bend/scratch-core/errors-try-dies.bend
```

```
No such file or directory
```

Exit code 2 (stderr; the line `unreachable` was not printed).

### 4. A destructuring let inside a do block is refused

An earlier draft of this example wrote, inside `do IO<U32>:`:

```python
    w : File & Result<&1, &1, (U32 & String), Unit> <- File.write(h, s)
    (h2, r) = w
```

```sh
bend docs/bend2/examples/lang-core-errors.bend --check-only   # with that draft
```

```
Error:
- expected : a pattern (a binder or a constructor)
- observed : IO.bind(Pair(File, Result<&1, &1, Pair(U32, String), Unit>), U32, File.write(h, s), w => {(h2, r) : IO(U32)})
Location:
26 |   do IO<U32>:
27>|     w : File & Result<&1, &1, (U32 & String), Unit> <- File.write(h, s)
28 |     (h2, r) = w
```

Exit code 1. The draft was rewritten to destructure in a def body (`write_close` takes the pair),
which is the shape the pinned upstream tests use throughout.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: errors are ordinary values
of `Result` with a U32 code and a String message, the handle threads outside the Result so no
failure path leaks it, IO.try is the fail-fast unwrapper (exit code 2 with the errno message on
stderr), and a do block's binds are plain annotated binders only.
