# lang-cap-dropped-child — evidence

CLAIM: dropping the `Chan` returned by `IO.fork` does not cancel or join the computation. The
parent returns first, the child continues after its sleep, and the program waits until the child
completes.

Provenance: the program body preserves the independent Codex architecture probe at
`/tmp/baton-bend2-laws-review/architecture/codex-probes/dropped-child.bend`; this checked-in copy
adds only its `# CLAIM:` and evidence headers. The original program has SHA256
`5c4f864338fedfebfc52dae6fb3b25d7b338fe60269405a386065ad49ad41200`. Its retained result JSON
has SHA256 `d7cee9a414af9daf9e625ca37bbc836223ccd5383a6d781de335acb50bc85427`.

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

### 1. Type check

```sh
bend docs/bend2/examples/lang-cap-dropped-child.bend --check-only
```

```text
All terms check.
```

Exit code 0.

### 2. Interpreter run

```sh
bend docs/bend2/examples/lang-cap-dropped-child.bend
```

```text
parent returned without joining
child continued
```

Exit code 0.

### 3. Native build and run

```sh
bend docs/bend2/examples/lang-cap-dropped-child.bend -o <scratch>/lang-cap-dropped-child
<scratch>/lang-cap-dropped-child
```

The build produced a 1,127,848-byte executable. The executable exited 0 and printed:

```text
parent returned without joining
child continued
```

### 4. Independent result comparison

The retained result JSON records a successful native build and this exact native output:

```text
parent returned without joining
child continued
```

The independent run and this reproduction agree.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. Returning from `main` after
dropping the fork channel does not cancel the child. The child runs after the parent message, and
the process exits only after the child completes. `IO.fork` supplies concurrency; this program
shows no lexical supervision or automatic cancellation when the channel is dropped.
