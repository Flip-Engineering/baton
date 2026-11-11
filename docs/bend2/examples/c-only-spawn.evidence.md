# c-only-spawn — evidence

CLAIM: an effect whose only host half is a C file type-checks, and a native binary built from it
runs that effect with no JavaScript in its runtime; the interpreter lane refuses the same file
because it needs the `.js` half.

This matters to the operator's end state (mandate part 4, "a Baton written entirely in Bend2"): a
host effect Base does not ship, such as process spawn, is expressible in Bend2 with a C host half,
so a native Bend2 Baton needs no JavaScript effect host. It also fixes the boundary of that claim:
the interpreter and the `-o x.js` lane do need the JavaScript half, so those lanes are not the
production target.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

## Commands and observed output

### 1. Type check

```sh
node_modules/.bend/bin/bend docs/bend2/examples/c-only-spawn.bend --check-only
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- HostEcho.run
- main
```

Exit code 0. The checker admits a foreign def whose body imports only a `.c` file.

### 2. Build a native binary

```sh
node_modules/.bend/bin/bend docs/bend2/examples/c-only-spawn.bend -o <scratch>/c-only-spawn
<scratch>/c-only-spawn
```

The build printed the same checker line and wrote a 1,127,152-byte executable; running it printed

```
c-only-effect
```

Exit code 0, with the trailing newline the `echo` command wrote.

### 3. The interpreter lane refuses the same file

```sh
node_modules/.bend/bin/bend docs/bend2/examples/c-only-spawn.bend
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- HostEcho.run
- main
Error: a foreign def without a .js import: HostEcho.run
```

The interpreter needs a JavaScript half for every foreign def, so it cannot run a C-only effect.
The native build is unaffected.

## A convention this example had to learn

The effect's return type decides the C half's return. For a plain type (`IO(String)` here) the host
function returns the bare value — `io_str(e, buf, n)` — exactly as the pinned `guide/EFFECTS.md`
shows `Clock.now` returning `(Term)(uint32_t)(io_tick() / 1000000ull)`. Wrapping a plain-typed
result in `io_done(e, …)` type-checks and builds, and the program then prints an empty string: the
first version of this file did that and printed a blank line. The wrapper belongs to effects whose
Bend type is a `Result`.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25: a C-only effect is expressible, and a
native binary runs it with no JavaScript runtime. What a JavaScript-free Baton still needs is
authored C shims for the host effects Base does not ship (process spawn among them), not a
JavaScript host; and the lanes that need the `.js` half — the interpreter and `-o x.js` — are not
the production artifact.
