# lang-host-foreign — evidence

CLAIM: a host effect Base does not ship is a def whose body is two imports, one `.c` and one
`.js`; a program that adds its own process-spawn effect type-checks, runs natively, runs under
bun and runs through the interpreter. The effect answers the command's whole standard output and
reports its exit status as a failure code. It blocks the program's one event loop for the life of
the command, and it exposes no process handle, no streaming read, no signal and no cancellation.
Base ships no process spawn of its own.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0 (build 26A428), arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| bun | 1.3.8 (the interpreter lane and the JavaScript lane both run the `.js` half) |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. Build artifacts went to `<worktree>/node_modules/.bend/scratch-host`.

The effect is the shape `upstream/guide/EFFECTS.md` fixes: a def of type `IO(R)` whose body is one
`.c` import and one `.js` import, with the host function named after the def lowercased and dots
as underscores (`hostproc_exec`). Its type is `IO(Result<&1, &1, U32 & String, String>)`, so the
JavaScript half answers `io_done(value)` and `io_fail(code)` as Base's own `get_env.js` does; a
plain-typed effect such as `Clock.now` returns the bare value instead.

## Commands and observed output

### 1. Type check

```sh
bend docs/bend2/examples/lang-host-foreign.bend --check-only
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- HostProc.exec
- main
```

Exit code 0. The checker names the effect and every def that reaches it.

### 2. Run through the toolchain

```sh
bend docs/bend2/examples/lang-host-foreign.bend
```

```
All terms check, but 2 defs rely on unsafe or foreign code:
- HostProc.exec
- main
host process said: bend-foreign-exec

host process failed with status 3
```

Exit code 0. The blank line after the first message is the newline `echo` wrote, which the
effect returns as part of its output. The interpreter lane runs the `.js` half.

### 3. Native build and run

```sh
bend docs/bend2/examples/lang-host-foreign.bend -o <scratch>/lang-host-foreign
```

The build compiles a 1,127,776-byte executable and prints no warning; the first version of the
`.c` half declared the length as `u32` where the runtime takes `u64*`, and clang reported
`incompatible pointer types passing 'u32 *' (aka 'unsigned int *') to parameter of type 'u64 *'`.

```sh
<scratch>/lang-host-foreign
```

```
host process said: bend-foreign-exec

host process failed with status 3
```

Exit code 0. This lane runs the `.c` half.

### 4. JavaScript build and run

```sh
bend docs/bend2/examples/lang-host-foreign.bend -o <scratch>/lang-host-foreign.js
bun <scratch>/lang-host-foreign.js
```

The build writes a 14,397-byte JavaScript file, which prints the same four lines and exits 0. The
`.js` half answers through `Bun.spawnSync`.

### 5. What the effect does not carry

The `.c` half calls `popen` and reads to end of file before returning, and the `.js` half calls
`Bun.spawnSync`, so the command runs to completion inside one effect and the program's event loop
waits for it. `upstream/guide/EFFECTS.md` names the runtime's two ways out of the loop for host
code that blocks: `io_work(w, call, pack)` runs the call on a helper thread, and
`io_wait_on(w, fd, POLLIN, more)` parks until a descriptor is readable. Neither is used here.

The effect's whole answer is the output string or the exit status. It carries no process handle,
so there is no effect on it to read more output, send a signal, or cancel the command.

### 6. Base's own process surface

```sh
bend base exec
```

```
bend: Base has no exec (see bend --help)
```

Exit code 1. The complete `IO`, `File`, `Socket`, `Listener`, `TCP` and `UDP` listing at this pin
is in `lang-host-interop.evidence.md`, step 5; no name in it starts an operating-system process.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. A `.c` and `.js` pair turns
a def into a host effect, and this one starts a process, captures its output and reports its exit
status on the interpreter, native and bun lanes. The effect blocks the one event loop and carries
no process handle, streaming, signals or cancellation, so it proves the foreign escape hatch and
satisfies none of Baton's process-lifecycle needs on its own.
