# lang-cap-durability — evidence

CLAIM: Base can write and close a file, and its public result exposes no durability receipt. Base
has no `File.sync`, `File.rename`, or `File.stat` operation at the pin, so a Bend program cannot
express an explicit durable-publication sequence with Base alone.

Programs: `lang-cap-durability.bend` is the positive write/close control.
`lang-cap-durability-sync.bend`, `lang-cap-durability-rename.bend`, and
`lang-cap-durability-stat.bend` are negative controls.

## Environment

| | |
|---|---|
| Host | macOS 27.0 (build 26A428), arm64 (Apple M4) |
| Toolchain | Bend 2.0.25 at `/tmp/codex-baton2-context-afnsav7o/toolchain/bend/bin/bend` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| Reference pin | `../reference/README.md` (`bendlang/bend@a4952426`) |

The installed toolchain reports `bend 2.0.25`. Its `GUIDE.md`, `EFFECTS.md`, and `SHADERS.md`
hashes are `9e464364…`, `4d7178c7…`, and `5831b0de…`, matching the manifest.

## Commands and observed output

### 1. Write and close control

```sh
bend docs/bend2/examples/lang-cap-durability.bend --check-only
```

```text
All terms check.
```

Exit code 0.

```sh
bend docs/bend2/examples/lang-cap-durability.bend
```

```text
write and close completed; Base returned Unit
```

Exit code 0. The output file contains the 18 bytes `durability control`.

```sh
bend docs/bend2/examples/lang-cap-durability.bend -o <scratch>/lang-cap-durability
<scratch>/lang-cap-durability
```

The build produced a 1,128,216-byte executable. It exited 0 with the same output and wrote the
same 18 bytes.

The program's types show the public acknowledgement boundary. `File.write` returns the live
`File` beside `Result<..., Unit>`, and `File.close` returns `IO(Unit)`. Neither operation returns a
durability or publication receipt.

### 2. Base File surface

```sh
bend base File | grep -E '^def '
```

```text
def File.open(path: String, mode: String) ->
def File.read(file: File, max: U32) ->
def File.read_bytes(file: File, max: U32) ->
def File.read_at(file: File, offset: U32, max: U32) ->
def File.size(file: File) ->
def File.write(file: File, data: String) ->
def File.write_bytes(file: File, data: List<&2, U32>) ->
def File.close(file: File) -> IO(Unit):
```

Exit code 0. This is the complete `File` definition list printed by the pinned toolchain.

### 3. Explicit synchronization refusal

```sh
bend docs/bend2/examples/lang-cap-durability-sync.bend --check-only
```

```text
Error:
- expected : a defined name
- observed : File.sync
Context:
- file : File
Location: main
 8 |     file : File <- IO.try(File, File.open("docs/bend2/examples/lang-cap-durability-output.tmp", "w"))
 9>|     synced : Unit <- File.sync(file)
10 |     return Unit{}
```

Exit code 1.

### 4. Atomic rename refusal

```sh
bend docs/bend2/examples/lang-cap-durability-rename.bend --check-only
```

```text
Error:
- expected : a defined name
- observed : File.rename
Location: main
7 |   do IO<Unit>:
8>|     renamed : Unit <- File.rename("from", "to")
9 |     return Unit{}
```

Exit code 1.

### 5. Metadata refusal

```sh
bend docs/bend2/examples/lang-cap-durability-stat.bend --check-only
```

```text
Error:
- expected : a defined name
- observed : File.stat
Location: main
7 |   do IO<Unit>:
8>|     metadata : Unit <- File.stat("docs/bend2/examples/lang-cap-durability-output.tmp")
9 |     return Unit{}
```

Exit code 1.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. Base writes and closes the
file, but the Bend-visible results carry no durability receipt, and the checker refuses explicit
sync, rename, and stat calls because those names do not exist. This evidence makes no claim about
internal operating-system behavior during `File.close`; it establishes the API limit. Baton2's
durable publication and metadata checks require authored host effects with fault-injection tests.
