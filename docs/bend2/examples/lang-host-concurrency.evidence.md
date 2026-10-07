# lang-host-concurrency — evidence

CLAIM: Bend2's parallelism is a binary fork-join call written as two calls in one statement
(`a b = f(x) f(y)`; four calls is the burst form of the same statement), the CPU runtime spreads
such calls over the cores given to `--threads`, and `IO.fork`/`IO.join` runs computations
concurrently on the program's one event loop. On this host, with a load average of 10.5 from the
other lanes, the balanced tree below takes a median 1.736 s at `--threads 1` and 0.330 s at
`--threads 10` (5.3x) and prints the same value in both runs; the JavaScript target runs the same
program sequentially.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0 (build 26A428), arm64 (Apple M4) |
| Cores | 10 logical: 4 performance, 6 efficiency (`hw.perflevel0.logicalcpu` = 4, `hw.perflevel1.logicalcpu` = 6) |
| Host load | 10.54 / 14.56 / 14.16 before the measurement, 10.56 / 14.37 / 14.10 after; the other lanes of this swarm were compiling on the same host |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| Node | v25.8.0 |
| bun | 1.x at `/Users/wahargis/.bun/bin/bun` (the JavaScript target needs bun; see step 6) |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

The toolchain sits under `node_modules/.bend` because this worktree is cut from `master`, whose
`.gitignore` carries `node_modules/` but no `.bend/` line. Build artifacts went to
`<worktree>/node_modules/.bend/scratch-host`, outside every committed path.

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`.

## Commands and observed output

### 1. Type check

```sh
bend docs/bend2/examples/lang-host-concurrency.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run through the toolchain

```sh
bend docs/bend2/examples/lang-host-concurrency.bend
```

```
tree(14, 50000) = 1333018624
burst(50000)    = 1300561610
worker 1 joined
worker 2 joined

real	1m35.394s
user	1m25.095s
sys	0m2.324s
```

Exit code 0. `bend <file>.bend` interprets the program, and 1.3 billion multiply-adds through the
interpreter take 95 s on this host.

### 3. Build a native executable and run it

```sh
bend docs/bend2/examples/lang-host-concurrency.bend -o <scratch>/lang-host-concurrency
<scratch>/lang-host-concurrency --threads 1
<scratch>/lang-host-concurrency --threads 10
```

The build takes 1.1 s and writes a 1,129,560-byte executable. Both runs print:

```
tree(14, 50000) = 1333018624
burst(50000)    = 1300561610
worker 1 joined
worker 2 joined
```

The tree value, the burst value and the join order are identical at both thread counts and in
every run below. The native binary accepts `--threads N`, which sets the number of cores the
runtime uses.

### 4. Thread scaling of the balanced tree (5 runs per count, real seconds)

```sh
for t in 1 4 10; do for i in 1 2 3 4 5; do time <scratch>/lang-host-concurrency --threads $t >/dev/null; done; done
```

| `--threads 1` | `--threads 4` | `--threads 10` |
|---|---|---|
| 1.736 | 0.455 | 0.349 |
| 1.779 | 0.441 | 0.287 |
| 1.597 | 0.476 | 0.315 |
| 1.624 | 0.477 | 0.330 |
| 1.771 | 0.514 | 0.627 |

| | 1 thread | 4 threads | 10 threads |
|---|---|---|---|
| Median | 1.736 s | 0.476 s | 0.330 s |
| Minimum | 1.597 s | 0.441 s | 0.287 s |
| Speedup over 1 thread (median) | 1.0x | 3.6x | 5.3x |

The `--threads 10` row carries the noise of a host at load average 10.5: one run took 0.627 s
where the other four took 0.287 s to 0.349 s. The 4-thread count reaches 3.6x on 4 performance
cores, and the 6 efficiency cores beyond them add 1.5x more, so the curve flattens after the
performance cores are full.

### 5. The same run at `--threads 10`, verbatim

```sh
<scratch>/lang-host-concurrency --threads 10
```

```
tree(14, 50000) = 1333018624
burst(50000)    = 1300561610
worker 1 joined
worker 2 joined

real	0m0.339s
user	0m1.454s
sys	0m0.054s
```

User time of 1.454 s over a wall time of 0.339 s: about 4.3 cores were busy on average.

### 6. The JavaScript target runs the program sequentially, and it needs bun

```sh
bend docs/bend2/examples/lang-host-concurrency.bend -o <scratch>/lang-host-concurrency.js
node <scratch>/lang-host-concurrency.js
```

`node` prints the two computed values and then stops at the first concurrent step:

```
tree(14, 50000) = 1333018624
burst(50000)    = 1300561610
Error: Cannot find module 'bun:ffi'
Require stack:
- <scratch>/lang-host-concurrency.js
```

Exit code 1, in 37.950 s, 40.020 s and 42.057 s of wall time over three runs.

```sh
bun <scratch>/lang-host-concurrency.js
```

```
tree(14, 50000) = 1333018624
burst(50000)    = 1300561610
worker 1 joined
worker 2 joined
```

Two runs under bun printed the four lines and exited 0, in 1m49.401s and 1m41.555s. A third run
was terminated by the lead of this lane after 0m40.439s; it is recorded here and carries no
timing claim.

The `bun:ffi` module that `node` cannot resolve is how the JavaScript side of Base's effects
reaches libc (`upstream/guide/EFFECTS.md`, "The JS side"), so the JavaScript lane of a program
that parks on a channel or a sleep runs under bun.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. A parallel call is two
calls in one statement; the native runtime spreads the tree over the cores named by `--threads`,
with a measured median of 1.736 s at one thread and 0.330 s at ten (5.3x) and the identical
result in every run; `IO.fork` and `IO.join` run two computations concurrently on one event loop.
The JavaScript target computes the same program's calls one after another in over 100 s, so the
parallel call reaches the cores on the native targets. `lang-host-gpu.evidence.md` runs the same
tree with a marked call and records the GPU build it produces.
