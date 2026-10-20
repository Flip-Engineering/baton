# Host compilation queue (#970)

The native build launchers share one host compilation queue. The queue key
covers source contents, compiler/toolchain identity, entry, mode and the
relevant options. Requests with the same key share one active execution and its
completed C and object artifacts. One host lock serializes distinct heavy
requests across C generation and C compilation. Each request keeps its own
shard parallelism; `tools/cgen-clang-parallel/build_and_measure.py` runs four
shards inside one queued compilation.

The 2026-10-19 outage recorded nine Bun processes with a summed 182.56 GiB RSS
and 168 KiB free swap before the kernel killed an ACP validation process. The
queue serializes the expensive C-generation step so independent callers cannot
repeat that overlap with identical inputs, and so distinct generation requests
run one at a time.

## Identity

The material for one request is a line-oriented text record. The identity schema is versioned independently of the bootstrap shell; a shell key is never reused as a permanent cache key because it omits imported C and header inputs.

```
schema=baton-compile-queue-v1
kind=<cgen|cc>
entry=<entry argument>
option=<KEY=VALUE>                      sorted
compiler-entry=<sha256 of the resolved compiler or wrapper>
compiler-wrapper=<sha256>               one per followed absolute exec wrapper
toolchain=release|executable
toolchain-file=<relative path> <sha256> <bytes>   sorted, release layout only
source-entry=<relative entry path>      cgen only
source-file=<relative path> <sha256> <bytes>      sorted, cgen only
input=<destination> <sha256> <bytes>    copied inputs
artifact-name=<name>                    requested artifact names
argv=<normalized token>                 command order
```

The key is the lowercase hex SHA-256 of the material bytes. Normalization
replaces each artifact destination with `{out:<name>}`, each input source with
`{in:<destination>}`, the compiler token with `{compiler}`, a `--root` prefix
with `@root/`, and a `--cwd` prefix with `@cwd/`. Output locations and absolute
worktree paths do not enter the key; identical content in different worktrees
produces the same key.

The C-generation source closure covers the entry, every imported `.bend` file
and every imported C or header file reachable from it (for example
`control.c`, `files.c`, `process-spawn.c`, `sqlite.c`, `text.c`). The C
compilation closure covers the generated C, `native-entry.c`, the builder and
sharder sources, included host C/header files, and the compiler/linker
identity. The compiler identity hashes the wrapper chain and, when the resolved
path has a release layout with `bend2/main.ts` and `bin/bun`, every file under
`bend2/` and `bin/bun`.

## Language boundary

The host C bindings supply primitives: SHA-256 over bytes and files, file
reading and size, directory listing, `realpath`/`readlink`, script detection,
executable resolution through `PATH`, and storage observation for file, link and
directory kind. Bend2 owns the queue policy: `.bend` import and C `#include`
parsing, closure membership and order, wrapper exec-chain parsing, Bend release
layout detection, toolchain file enumeration and composition, normalized
identity material, result parsing and verification, artifact publication, and
the public run/key/wait/cancel/status/adopt behavior.

`bend2/src/host/compile-queue-lifecycle.c` owns `flock(2)` descriptors,
`setsid(2)` detachment, process start identity and zombies, signals, and the
detached spawn. Key and heavy lock descriptors are inherited by the
supervisor; the parent closes its references without calling `LOCK_UN`. The
spawn remaps the inherited key, heavy and status descriptors through
duplicates at fd 10 or higher before installing them at fds 9 and 8.

## Execution

A request opens `$state/keys/<key>/lock` and takes an exclusive record lock. With the
lock held it reads `completed/result`; a valid completed result is copied to the
caller's artifact paths. Without a completed result, the requester writes one
attempt directory, copies the declared inputs, normalizes output paths into the
attempt work directory, and starts a supervisor.

The supervisor is detached from the requester and holds the key lock through
inherited descriptors. It takes the shared `$state/heavy.lock` before it runs
the command, for both `cgen` and `cc`, and it holds that lock until the command
and artifact publication finish. It runs the command with the recorded cwd and
captures stdout and stderr. On success it copies the declared artifacts into
`completed/artifacts/` and publishes `completed/result`. On failure it writes
`runs/<attempt>/result` with the exit status and retained logs. A later request
with the same key retries a failed or canceled attempt; a request that was
waiting when the attempt failed receives the failure.

Waiters block on the key lock. Requesters that witnessed an attempt compare the
attempt finish time with the time they started waiting. This distinguishes a
waiter that owns the failure from a later request that should retry.

A lost requester does not stop the supervisor. When another requester remains,
it receives the shared result. When the only requester is lost, the execution
still completes and its artifacts remain available for the next request. A
supervisor that dies without a result releases the lock, and the next waiter
starts a new attempt. Liveness requires both a matching process start identity
and a non-zombie process state; a zombie child is treated as ended.

Each requester is bound to an owner token. `cancel --token` withdraws that
owner; the shared execution is canceled only when no owners remain. The active
process group is verified by leader start time, sent `SIGTERM`, and, after the
grace window, `SIGKILL`. The supervisor writes a canceled result. External
adopted executions are never signaled.

## Artifacts and state

```
$state/keys/<key>/lock
$state/keys/<key>/active                       pid, starttime, kind, mode
$state/keys/<key>/completed/result
$state/keys/<key>/completed/artifacts/<name>
$state/keys/<key>/runs/<attempt>/command
$state/keys/<key>/runs/<attempt>/meta
$state/keys/<key>/runs/<attempt>/stdout
$state/keys/<key>/runs/<attempt>/stderr
$state/keys/<key>/runs/<attempt>/result
$state/heavy.lock
```

`completed/result` uses schema `baton-compile-queue-result-v1` with `status`,
`exit`, `kind`, `key`, `started_ns`, `finished_ns`, `finished_at`, `attempt`,
`detail`, stdout/stderr hashes and byte counts, and one
`artifact=<name>\t<bytes|directory>\t<sha256>` row per artifact. The cache copy
of each artifact is verified by SHA-256 before reuse; a changed cache entry is
treated as a miss. Copying to a requester preserves executable mode and installs
files through a temporary name followed by rename.

Status is derived by enumerating the key directories, reading `active` and
verifying `completed/result`. The queue keeps no separate status ledger.

## Compiler adoption

`adopt --pid PID` reads the running compiler's cwd, entry, `BEND` environment
and output path, computes the same key a normal request would use, and starts a
guard that holds the key lock and the heavy lock for the process lifetime. The
guard records the live argv, cwd, options, input hashes and output path and
publishes the artifact with those fields. The result is reusable only when the
command, process start identity, inputs, output path and artifact hashes match
the recorded values exactly; an unverified external result remains evidence.
Identical requests attach to the adopted execution; distinct heavy requests
queue behind it. The guard records the pid start time and never signals the
adopted process.

## Bootstrap boundary

Permanent queue behavior is Bend2 source at:

- `bend2/src/host/compile-queue.bend`
- `bend2/src/host/compile-queue-identity.bend`
- `bend2/src/host/compile-queue-result.bend`
- `bend2/src/host/compile-queue-lifecycle.c/.bend`
- `bend2/src/host/compile-queue-digest.c/.bend`
- `bend2/src/host/compile-queue-artifact.c/.bend`

`bend2/scripts/bootstrap-compile-queue.sh` is the one-time bootstrap. It
builds exactly `bend2/src/host/compile-queue.bend` to one output path and
accepts no entry, command or option arguments. It runs Bend to produce C and
the host C compiler to link the queue executable. It is the only supported
pre-queue build path, and it cannot build another entry.

```
BEND=/path/to/bend CC=clang \
  sh bend2/scripts/bootstrap-compile-queue.sh .scratch/bend2/compile-queue
```

`bend2/scripts/compile-queue.sh` resolves the queue executable only from
`BATON2_COMPILE_QUEUE_BIN`, `BATON2_COMPILE_QUEUE`, or
`$BATON2_PREFIX/bin/baton-compile-queue`, and executes the public operation
with the original arguments. It exits 2 when no executable is available.
After the one-time bootstrap, set `BATON2_COMPILE_QUEUE_BIN` to its output or
install that output under the prefix; the launcher does not resolve
`.scratch` paths. `bend2/scripts/build-native.sh` and the Bend internal
`cli_build` require `BATON_COMPILE_QUEUE_ROOT` to be one absolute shared
directory; `cli_build` also requires the queue entry. A `run` or `adopt`
request rejects a `--state-root` that differs from
`BATON_COMPILE_QUEUE_ROOT`, and it rejects a root that is missing, unreadable,
unwritable or unable to hold `$state/heavy.lock`.

Every cc request also supplies an absolute `--source-root`, the resolved
linker path and the captured compiler `--version` text. The queue rejects a cc
request without any of the four fields. When `BATON2_CCACHE` is set,
build-native passes the ccache config file as an `--aux` input and a sorted
`CCACHE_*` environment snapshot as an `--option`; both enter the identity.

After the executable exists, validate it with:

```
BATON2_COMPILE_QUEUE_BIN=.scratch/bend2/compile-queue \
  sh bend2/test/compile-queue.sh
```

The lifecycle boundary uses portable host primitives: BSD `flock(2)` for the
inherited key and heavy locks, `setsid(2)` for detachment, and SHA-256 in the
digest binding. Every supported host requires queue coordination;
`bend2/scripts/build-native.sh` has no un-queued compile path.

## Qualification

Host: homelab Linux, 220 GiB RAM. C compiler: `/usr/lib/llvm-19/bin/clang`,
Ubuntu clang 19.1.1, SHA-256
`f6d5286a52de10b1e3e8841457c9903a1ea28f222ac0f58cd616697d0dcd9db3`.
State root (reference-shell measurements): `$HOME/.cache/baton/compile-queue`.
Evidence:
`.scratch/evidence/compile-queue-cc.cLXmYeF5/`.

| Case | Result |
| --- | --- |
| Two concurrent identical `cc` requests | 1 compiler start; both outputs SHA-256 `ae7b3db78e011bba163ab7b4702dd75c725aaee7815a0391567b192e22c9120d` |
| Reuse after completion | 0 additional compiler starts; same SHA-256 |
| Two distinct `cc` requests (reference shell) | 2 compiler intervals overlapping for 3.446 s; 3.50 s and 3.50 s wall; 121,992 KiB and 118,156 KiB peak RSS |
| Shared failure | 1 compiler start; both requesters exit 1 with the same stderr tail; no completed artifact |
| Retry after failure | 1 compiler start |
| Cancellation | exit 130; compiler process group gone |
| Requester loss | survivor exits 0; 1 compiler start |

The measurements used the reference shell identity for queue mechanics. The
permanent Bend2 identity adds the imported C/header closure and the compiler,
linker and toolchain closure, so the reference keys are bootstrap evidence and
are not reused as permanent cache keys.

The reference shell did not serialize distinct `cc` requests. The permanent
queue serializes every distinct heavy request through `$state/heavy.lock` and
keeps each request's internal shard parallelism. Commit 97a95949 retains the
reference shell used for these measurements; it is not a bootstrap route for
the permanent queue.

The executor requester's `/usr/bin/time -v` maximum RSS includes the supervisor
and compiler; waiters report the requester only (2,680-3,192 KiB). Memory values
come from `wait4` `ru_maxrss` for the waited child tree.

The adopted `#959` compiler ran as PID 42767 in
`home/worktrees/backlog-959-impl-20261019`, entry
`bend2/src/coordinator/main.bend`, BEND release
`2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019`. Its queue key is
`9be2a723056f078d56116374b824b8ff03f64ea4e13b0c4f706bebae742915d0`. The source
differs from current main by the two-line PR #959 `ContextEval` change, so the
artifact is bootstrap evidence for that source identity and is not reused by the permanent identity.

## Open items

- The Bend2 implementation has passed static review only; it has not been
  built or run. Root owns the first build, qualification and deployment.
- `cli_build` in `bend2/compiler/upstream/main.ts` requires the shared queue
  executable and the explicit state root. A missing entry, missing root or
  failed queue execution is an error, and no direct compiler path remains.
  `bend2/test/compiler-arm-sharing.py` requires the same queue and root.
- `BEND_GENERATED_C` is rejected by `build-native.sh` and `package-native.py`.
  Only the verified Main-C reuse inputs (`BATON2_MAIN_GENERATED_C*`) are
  accepted.
- The one-time queue bootstrap is `bootstrap-compile-queue.sh`; it is separate
  from `build-native.sh` and only builds the queue entry.
- The reference shell `cancel --key` interface is bootstrap-only. The permanent
  queue binds each requester to an owner token and cancels a shared execution
  only when no owners remain.
- External adoption is reusable only after the live command, process start
  identity, input hashes, output path and artifact hashes are verified.
- C-generation qualification and the ordinary `build-native.sh` main build run
  after the operator hold permits compilation.
- macOS provides BSD `flock(2)` and `setsid(2)` through its POSIX host boundary.
  The Bend2 lifecycle uses those primitives, so macOS jobs use the queue.
