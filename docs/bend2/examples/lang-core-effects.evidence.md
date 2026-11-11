# lang-core-effects — evidence

CLAIM: a foreign effect is a def of type IO(R) whose body names two host imports; the C side must
supply a run function registered under the def name's CID (`io_eff`, need 0), the JS side must
supply a function named after the def, and the same program then runs interpreted (JS host), as a
native executable (C host) and as emitted JavaScript under Node.

## Environment

| | |
|---|---|
| Host | macOS 27.0 (Build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` with `BEND_HOME=<worktree>/node_modules/.bend` (this worktree is cut from master, whose `.gitignore` does not carry the `.bend/` lines, so the install lives under the ignored `node_modules/`) |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5), target arm64-apple-darwin27.0.0 |
| Node | v25.8.0 (runs the emitted JavaScript) |
| Reference pin | `../reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. Build artifacts go to `node_modules/.bend/scratch-core/` (git-ignored).

## What each side supplies

The def is `Core.double`, so:

| Artifact | Required content |
|---|---|
| `lang-core-effects.c` | `Term core_double_run(Env e, Term* f, IoWork* w)` — reads the U32 argument as the word `(u32)f[0]`, returns the answer as a `Term`; plus a constructor registering `io_eff(CID_CORE_DOUBLE, core_double_run, 0)` |
| `lang-core-effects.js` | `function core_double(n) { ... }` — the argument arrives as a JS number, the answer returns as a number |

Both names derive mechanically from the def name: host function lowercased with dots to
underscores, CID uppercased the same way. The def body is just the two imports:

```python
def Core.double(n: U32) -> IO(U32):
  import "./lang-core-effects.c"
  import "./lang-core-effects.js"
```

This mirrors the pinned upstream shape `tests/io/far_types.{bend,c,js}` and the minimal
`tests/io/effect_proto.{bend,js}` at the pin; `../reference/upstream/guide/EFFECTS.md` documents
the contract, including that the C names are runtime internals with no ABI promise.

## Commands and observed output

### 1. Type check

```sh
bend docs/bend2/examples/lang-core-effects.bend --check-only
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- Core.double
- main
```

Exit code 0. The checker marks foreign-dependent defs by name and still checks everything else.

### 2. Run interpreted (the JS host half serves this path)

```sh
bend docs/bend2/examples/lang-core-effects.bend
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- Core.double
- main
Core.double(21) = 42
```

Exit code 0.

### 3. Build a native executable and run it (the C host half serves this path)

```sh
bend docs/bend2/examples/lang-core-effects.bend -o node_modules/.bend/scratch-core/lang-core-effects
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- Core.double
- main
```

Exit code 0. Then:

```sh
node_modules/.bend/scratch-core/lang-core-effects
```

```
Core.double(21) = 42
```

Exit code 0.

### 4. Emit JavaScript and run it under Node

```sh
bend docs/bend2/examples/lang-core-effects.bend -o node_modules/.bend/scratch-core/lang-core-effects.js
node node_modules/.bend/scratch-core/lang-core-effects.js
```

The emit printed the same two warning lines and exited 0; Node printed:

```
Core.double(21) = 42
```

Exit code 0.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host: a foreign effect needs one
bend def with two import lines, a C run function plus `io_eff` registration for the native path,
and a same-named JS function for the interpreted and emitted-JS paths; all three execution paths
answered `Core.double(21) = 42`. The IO model facts this exercises — effects sequenced in `do`
blocks, every bind annotated, host code reached only from the event loop — are the guide's IO
description, here run rather than only read.
