# Host compilation queue (#970)

The native build launchers share one host compilation queue. The queue key
covers source contents, compiler/toolchain identity, entry, mode and the
relevant options. Requests with the same key share one active execution and its
completed C and object artifacts. Distinct requests are admitted by measured
memory (see "Admission by memory"). Each request keeps its own
shard parallelism; `tools/cgen-clang-parallel/build_and_measure.py` runs four
shards inside one queued compilation.

The 2026-10-19 outage recorded nine Bun processes with a summed 182.56 GiB RSS
and 168 KiB free swap before the kernel killed an ACP validation process. The
queue serializes the expensive C-generation step so independent callers cannot
repeat that overlap with identical inputs, and so distinct generation requests
run one at a time.

## Host resource sharing

The host queue has two lanes. The `cgen` lane admits one execution at a time:
distinct C-generation requests wait on `$state/cgen.lock`, while identical
requests attach to the one active key and its result. The `cc` lane admits
independent compilations concurrently; each `build_and_measure.py` invocation
keeps its four shards and four jobs, and `build-native.sh` passes
`--max-aggregate-rss-mb 0`, so the queue adds no process memory ceiling. A
requester that disconnects leaves its supervisor running under the key lock;
other requesters continue and receive the shared result. Owner tokens count
live requesters, and cancellation stops the execution only when no live owner
remains. The fake-command suite covers distinct cgen serialization, concurrent
cc overlap, identical coalescing, requester loss, and one-owner withdrawal.

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
inherited descriptors. It waits for admission (see "Admission by memory") before it runs
the command, for both `cgen` and `cc`. Admission gives the supervisor a claim
file whose lock is descriptor 8, inherited by the command. When the command
writes the per-attempt compile marker named by `BATON_COMPILE_QUEUE_COMPILED`
(`<attempt>/compiled`), the marker watcher unlocks the claim and the
supervisor keeps the key lock, attempt ownership and command wait. A command
that does not write the marker keeps the claim until the command and its
processes exit.
It runs the command with the recorded cwd and captures stdout and stderr.
On success it copies the declared artifacts into
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
and a non-zombie process state; a zombie child is treated as ended. A fresh run
refuses a live or uncertain active record after the key lock; a dead owner is
removed and a completed result remains reusable.

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
$state/keys/<key>/peak                         largest recorded peak, kB
$state/keys/<key>/runs/<attempt>/peak          peak of one run, kB
$state/keys/<key>/runs/<attempt>/group         history group of the attempt
$state/peaks/<group>                           largest recorded peak of a group, kB
$state/admission/lock                          serializes the records below
$state/admission/waiting/<queue time>-<pid>    one ticket per waiting supervisor
$state/admission/running/<time>-<pid>          one claim per admitted job
$state/admission/observed                      process measurements
$state/heavy.lock                              bootstrap and older queue executables
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

## Admission by memory (#1026)

Until 2026-10-22 the queue ran every job under one exclusive host lock,
`$state/heavy.lock`. On that day one 66 GB coordinator cgen held the lock for
more than two hours with 122 GB of memory available, and 36 jobs of 1 GB or
less waited behind it. The lock was added after the 2026-10-22 04:10Z
out-of-memory incident (#1010), where three Bend2 compiles of 71, 87 and 20 GB
ran together and used 211 of 220 GB. Admission by memory also keeps such
compiles apart, and it lets small jobs run beside a large one.

### Measurement

The supervisor samples the memory of its session while the command runs, every
two seconds, as the sum of `RssAnon` and `RssShmem` over the session. When the
command ends, the peak is the larger of the samples and the `ru_maxrss` of the
command's descendants. A run that was canceled records no peak. The peak is
written to `runs/<attempt>/peak`, raised in `keys/<key>/peak`, and raised in
`peaks/<group>`. The group is the SHA-256 of the kind, the entry file, the
compiler closure digest and the normalized command (the text the key uses:
compiler, outputs and root-relative paths replaced by placeholders). A new
commit of the same entry joins the group of earlier ones; `--check-only` and a
full C generation of the same entry do not share a group. Options are not part
of the group. The values are the largest peak recorded; none is removed.

### Expected peak

A ticket's expected peak is, in order:

1. the recorded peak of its key;
2. the largest recorded peak of its group;
3. no recorded peak. The job has no history. Its memory need is then the
   current memory of the largest running job of the same group, or nothing when
   the entry is empty or no such job runs. A job without a group, and the
   holder of the older lock, are matched by entry file.

### Rule

All records are read and written under `admission/lock`. A waiting supervisor
polls every 200 ms and starts when its ticket passes the rule. Tickets are
ordered by queue time, so the first ticket is the head.

- `reserve` is one quarter of `MemTotal`. It is the part of memory the rule
  never grants. Its purpose is the difference between recorded and actual
  peaks: the 2026-10-22 04:10Z incident used 211 of 220 GB, 96% of memory.
  Capping granted memory at 75% leaves room for a job that exceeds its record
  and for processes outside the queue.
- `unspent` is the sum over running jobs of `max(0, expected - current)`.
  A job admitted a moment ago counts at its full expected peak until it grows
  to it, so two jobs cannot be admitted against the same free memory.
- `free = MemAvailable - unspent - reserve`.
- `idle = MemAvailable + (current memory of all running jobs) - reserve`: the
  memory the rule could grant if every running job ended.

A ticket starts when its need is at most `free`; a ticket with no need starts
when `free > 0`. A ticket without history also waits while a running job
without history exists. When
nothing runs, the head starts whatever its expected peak, so a job that never
fits still runs when it is alone.

A ticket that is not the head starts only when it also fits as follows, so the
head is not delayed:

- if the head fits now, the ticket and the head fit together (`expected +
  head expected <= free`);
- the jobs that started while they were not the head, plus this ticket and the
  head, fit in `idle`.

The queue keeps no job count and no memory constant. The poll interval and the
sample interval are the only fixed values and they do not affect which jobs
are admitted. On a platform without `/proc/meminfo` the rule starts one job at
a time.

With the 220 GB host and its observed 31 GB of memory used outside the queue,
a coordinator cgen with an expected peak of 70 GB or more leaves `free` at
most `220 - 31 - 55 - 70 = 64` GB, whether the cgen has grown to its peak or
not. A second cgen of 70 to 95 GB waits until the first ends. A job of 1 GB
starts beside the first.

### Custody and cleanup

The claim file is locked by the supervisor and inherited by the command, the
marker watcher and anything the command starts. A claim is alive while any
holder remains, so a command that outlives its supervisor keeps its
reservation. A dead claim or ticket found during a read is removed. Records are
derived again after a crash; a repeated read or poll has no other effect.

### Older queue executables

An executable from before #1026 serializes jobs with `$state/heavy.lock`. When
`/proc/locks` shows a holder of that lock, the rule counts the holder's
current memory as a running job, with the entry file of its attempt, and does
not count it as a job without history. Jobs with the holder's entry file are
bounded by the holder's current memory.

`takeover --state-root DIR` replaces the supervisors of an older executable
that wait for the lock. For each one it stops the supervisor (a stopped
process leaves the lock queue and cannot start its command), then starts a
successor with `__takeover`. The successor takes the queue position of the
stopped supervisor, waits for admission, runs the same attempt, and kills the
stopped supervisor when the attempt has a result. The requester that waited
for the stopped supervisor then reads that result. The holder of the lock is
not touched. A supervisor of another user, and a supervisor in another mount
namespace (its working directory and command may not exist in the namespace of
`takeover`), are reported as skipped and keep waiting. `status` lists the memory the rule works from, the legacy holder,
each running job and each waiting ticket.

## State root

The one host state root is `BATON_COMPILE_QUEUE_ROOT` when set, else the fixed
host path `/var/tmp/baton/compile-queue`. The queue, `build-native.sh` and the
compiler-internal `cli_build` resolve the root by this one rule, so every host
build shares one lock domain. A set-but-relative `BATON_COMPILE_QUEUE_ROOT` is
a configuration error: the queue, the launcher and `cli_build` fail closed.
The per-user XDG/HOME/UID fallbacks are gone. On a multi-user host the operator
creates the shared root with write access for every build user; an unusable
root fails at use instead of falling back.

## Compiler adoption

`adopt --pid PID` reads the running compiler's cwd, entry, `BEND` environment
and output path, computes the same key a normal request would use, and starts a
guard that holds the key lock and an admission claim for the process lifetime.
The adopted process is registered as a running job and is never refused. The
guard records the live argv, cwd, options, input hashes and output path and
publishes the artifact with those fields. The result is reusable only when the
command, process start identity, inputs, output path and artifact hashes match
the recorded values exactly; an unverified external result remains evidence.
Identical requests attach to the adopted execution. Distinct requests are
admitted by the memory rule, which counts the adopted process. The guard records the pid start time and never signals the
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
request without any of the four fields. Source inputs and aux files must
resolve inside the declared source root. When `BATON2_CCACHE` is set,
build-native hashes the ccache config file and passes the digest as
`--option ccache-config-sha=<sha256>`, and passes the sorted `CCACHE_*`
environment snapshot as `--option ccache-env=<text>`; both enter the identity.

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
queue admits distinct requests by measured memory and keeps each request's
internal shard parallelism. Commit 97a95949 retains the
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

## Related failure evidence

The adopted `#959` failure matches the retained compiler failure family: SIGTRAP
exit 133 with roughly 140-150 GiB peak RSS, no kernel OOM entry and no core,
with retained diagnostics ending in `normal_cli`/`term_higher` lowering. The
`dev/backlog-959-20261019` tree at `452fa6db` is clean and pushed. The #959
diff does not modify `normal_cli`, and the compiler completed its term check
before C generation. The exact native cause remains unverified; #970 owns the
queue mitigation and #722 retains the compiler diagnosis.

## Integration sites

Every compiler entry point that the queue scope covers now invokes the queue.
The command path below is the validation path for each site.

- `bend2/compiler/upstream/main.ts` `cli_build` resolves
  `BATON2_COMPILE_QUEUE_BIN`, then `BATON2_COMPILE_QUEUE`, and runs
  `"$queue" run --kind cc --state-root <state> --cwd <file dir>
  --compiler <cc> --input <c> --artifact binary=<bin> ... -- <cc args>`.
  It throws on queue failure; no direct compiler path remains.
- `bend2/compiler/upstream/main.ts` and `bend2/compiler/repl.ts` call
  `cli_build`.
- `bend2/scripts/stage-repl-compiler.py` exports
  `BATON2_COMPILE_QUEUE_BIN` for the staged launcher, resolving
  `$prefix/bin/baton-compile-queue`.
- `bend2/scripts/build-native.sh` admits cgen and the final link through
  `"$queue" run`.
- `bend2/test/compile_queue.py:compile_cc` runs
  `"$queue" run --kind cc --state-root <state> --cwd <cwd>
  --compiler <cc> --input <file> --artifact binary=<output> ... -- <args>`.
- Direct fixtures use that helper: `native-cli.py` (three calls),
  `compiler-arm-sharing.py` (its own `run_queue`), `custody-adopt.py`,
  `start-gate.py`, `spool-watch-overflow.py`, `retained-control.py`
  (three calls), `shared-instance.py` (two calls),
  `sqlite-projection.py`, and `native-dispatch-runtime.py`.
- `bend2/scripts/check-install.py` `compile_with_queue` admits the fixed
  SQLite C probe through the same executable.
- `bend2/test/compile-queue.sh` exercises the queue contract with a fake
  compiler and covers explicit configuration, concurrency, serialized
  cgen, failure, cancellation, adoption and requester loss.

`bend2/scripts/bootstrap-compile-queue.sh` is the only pre-queue build. It
builds only `bend2/src/host/compile-queue.bend` to one output path; every
other site uses the resulting executable. The installed prefix packages it as
`bin/baton-compile-queue`.

## Open items

- The Bend2 implementation has passed static review only; it has not been
  built or run. Root owns the first build, qualification and deployment.
- Direct fixture compiler sites and Bend internal `cli_build` are wired in
  source. `cli_build` in `bend2/compiler/upstream/main.ts` requires the shared
  queue executable and the explicit state root; a missing entry, missing root
  or failed queue execution is an error, and no direct compiler path remains.
  The staged REPL launcher exports the installed `bin/baton-compile-queue`.
  `bend2/test/compiler-arm-sharing.py` requires the same queue and root.
  Distinct `cgen` and `cc` requests are admitted by measured memory while each
  request keeps its internal C-shard parallelism.
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
- The cc identity covers the compiler and linker executables, wrapper chains,
  the captured `--version` text, the Bend release tree when present, all
  declared inputs and their quoted includes, and the requested options. It
  does not hash the sysroot, system headers or system libraries; a toolchain
  change that preserves the compiler, linker and version text but changes
  those files can reuse an artifact. This is a known limit for root review.
- `bend2/scripts/check-install.py` admits its fixed SQLite C probe through the
  queue; it requires the configured queue entry and the shared absolute state
  root.
