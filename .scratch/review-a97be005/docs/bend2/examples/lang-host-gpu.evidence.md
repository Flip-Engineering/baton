# lang-host-gpu — evidence

CLAIM: `!` marks a parallel call for the GPU. The native build of a program with a marked call
emits a `.gpu` companion beside the binary, which `file` reports as a Metal GPU executable; the
marked call and the same call under `--gpu off` print the same value; and a binary run without its
companion compiles the GPU program again.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0 (build 26A428), arm64 (Apple M4), one Metal GPU |
| C compiler | Apple clang 17.0.0 (clang-1700.0.13.5) |
| Toolchain | bend 2.0.25 at `<worktree>/node_modules/.bend/bin/bend`, installed by `../reference/toolchain/install-2.0.25.sh` |
| Reference pin | `docs/bend2/reference/README.md` (`bendlang/bend@a4952426`) |

All commands ran from the worktree root with `node_modules/.bend/bin` on `PATH` and
`BEND_NO_TELEMETRY=1`. Build artifacts went to `<worktree>/node_modules/.bend/scratch-host`.

`upstream/guide/GUIDE.md` fixes the syntax and the split: two calls in one statement are a
parallel call, `pow2(20n)` in a native executable runs that tree on the CPU's cores, `pow2!(20n)`
hands it and every parallel call inside it to the GPU, and a machine without a GPU runs `!` on the
CPU.

## Commands and observed output

### 1. Type check

```sh
bend docs/bend2/examples/lang-host-gpu.bend --check-only
```

```
All terms check.
```

Exit code 0.

### 2. Run through the toolchain

```sh
bend docs/bend2/examples/lang-host-gpu.bend
```

```
pow2!(20) = 1048576
```

Exit code 0. The interpreter lane has no GPU program and computes the tree on the CPU.

### 3. Native build

```sh
bend docs/bend2/examples/lang-host-gpu.bend -o <scratch>/lang-host-gpu
```

The build takes 3.623 s and writes two files:

| File | Bytes |
|---|---|
| `<scratch>/lang-host-gpu` | 1,229,968 |
| `<scratch>/lang-host-gpu.gpu` | 75,040 |

`file` identifies the companion as a GPU executable:

```sh
file <scratch>/lang-host-gpu.gpu
```

```
<scratch>/lang-host-gpu.gpu:  [air64:MetalLib executable (MacOS), version 1.2.9] [applegpu:Mach-O 64-bit GPU executable applegpu]
<scratch>/lang-host-gpu.gpu (for architecture cputype (16777239) cpusubtype (13)):	MetalLib executable (MacOS), version 1.2.9
<scratch>/lang-host-gpu.gpu (for architecture cputype (16777235) cpusubtype (403)):	Mach-O 64-bit GPU executable applegpu
```

### 4. Runs on the GPU and on the CPU

```sh
<scratch>/lang-host-gpu
<scratch>/lang-host-gpu --gpu off
```

Both print `pow2!(20) = 1048576` and exit 0.

| Run | GPU (default) | `--gpu off` |
|---|---|---|
| 1 | 2.346 s | 0.132 s |
| 2 | 0.398 s | 0.037 s |
| 3 | 0.413 s | 0.038 s |
| 4 | 0.619 s | |

The first GPU run carries the Metal program's compilation; the later ones carry its load. Every
leaf of this tree is one addition, so the GPU path's fixed cost is larger than the work, and the
CPU path is faster here. The guide states the same condition: the GPU suits uniform numeric work
with enough work per node, and a parallel call promises only that its two sides are independent.

### 5. A binary without its companion

```sh
cp <scratch>/lang-host-gpu <scratch>/gpu-no-companion
<scratch>/gpu-no-companion
```

```
bend: compiling the GPU program (<scratch>/gpu-no-companion.gpu is missing or stale)
pow2!(20) = 1048576
```

Exit code 0. The runtime compiles the GPU program for the new path, prints the value, and leaves
no `.gpu` file beside the copy.

## Verdict

The claim holds at pin `a4952426` with toolchain 2.0.25 on this host. `!` produces a GPU build: the
native build writes a 75,040-byte companion that `file` reports as a Metal GPU executable, and the
marked call prints the same value through it and with `--gpu off`. A copy of the binary without
its companion compiles the GPU program and runs.
