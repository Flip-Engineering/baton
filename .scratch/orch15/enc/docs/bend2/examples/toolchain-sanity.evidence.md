# toolchain-sanity — evidence

CLAIM: bend 2.0.25 on this host type-checks, runs, builds a native executable from, and builds
JavaScript from a typed IO program; the checker enforces affine variable use.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| Node | v25.8.0 (for the JavaScript output) |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

## Commands and observed output

All commands ran from the worktree root with `.bend/bin` on `PATH` and `BEND_NO_TELEMETRY=1`.

### 1. Type check

```sh
bend docs/bend2/examples/toolchain-sanity.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run through the toolchain

```sh
bend docs/bend2/examples/toolchain-sanity.bend
```

```
toolchain sanity: twice(21) = 42
```

Exit code 0. The value is computed by the program's own `twice` definition, not printed as a
literal.

### 3. Build a native executable and run it

```sh
bend docs/bend2/examples/toolchain-sanity.bend -o <scratch>/toolchain-sanity
<scratch>/toolchain-sanity
```

The build produced an executable of 1,126,832 bytes; running it printed
`toolchain sanity: twice(21) = 42` and exited 0.

### 4. Build JavaScript and run it under Node

```sh
bend docs/bend2/examples/toolchain-sanity.bend -o <scratch>/toolchain-sanity.js
node <scratch>/toolchain-sanity.js
```

Printed `toolchain sanity: twice(21) = 42`, exit code 0.

### 5. The affine rule refuses a variable used twice

The same program with an affine parameter (`def twice(x: U32) -> U32:` whose body is `x + x`) is
rejected:

```sh
bend docs/bend2/examples/toolchain-sanity.bend --check-only   # with the affine parameter
```

```
Error:
- expected : x
- observed : x (consumed more than once)
Location: twice
6 |
7>| def twice(x: U32) -> U32:
8 |   (x + x : U32)
```

Exit code 1. The annotation `+x` marks the parameter reusable; the guide states that a reusable
parameter requires the `Data` kind (`upstream/guide/GUIDE.md`, "Reusable variables require `Data`:
functions, arrays and IO handles are `Type`, so they can never be copied").

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: check, run, native build and
JavaScript build all succeed, and the checker refuses one use of a value twice. Rust is not needed
for any of the four paths; a C compiler is the only host requirement beyond the release archive.
