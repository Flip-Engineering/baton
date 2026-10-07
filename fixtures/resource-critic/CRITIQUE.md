# Resource and ordinary CLI/MCP compatibility critique

Independent critic artifact. No production source was edited.

## Reviewed identity

- Source tree: commit `fca7af876c8260c32d17f95f3e19bc68ee1bf561` in the
  resource-critic worktree.
- Executable under test:
  `~/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2`,
  sha256 `972d620ce6209193cb91273350a9c1ea2713cac6b4b2bcf692a6303df75c766c`.
- Generated C for runtime citations:
  `.scratch/semantic-context-20261005/baseline/baton2.c`, built beside a binary
  byte-identical to the installed executable (same sha256).
- Host: macOS 27.0 (26A428), arm64; `kern.boottime` Mon Oct 5 10:46:16 PT.
- Live Orchestra database read only. All failure and load probes use the owned
  fixture database described below.
- Reviewed design documents: `docs/bend2/shared-native-owner-boundaries.md` at
  commit `5d457320` and its successor at `0e872489`.

Fixtures live at `fixtures/resource-critic/` in this worktree:
`measure.py` (sampler), `fx/harness.sh` (controlled non-provider harness), and
retained samples under `fx/evidence/`.

## 1. Measurement method

Three different memory numbers exist for one process. Measured simultaneously on
one idle observer process (fixture `idle-k1`, observer pid 51477, raw dumps
`fx/evidence/footprint.51477.txt` and `fx/evidence/vmmap.51477.txt`):

| Measure | Value |
|---|---|
| `ps -o rss` | 6.4 MB |
| `footprint -p` `phys_footprint` | 4.4 MB |
| `vmmap -summary` TOTAL resident | 83.4 MB |

The vmmap resident total is dominated by read-only shared regions that every
process on the host maps: `__TEXT` 8.7 MB, `__LINKEDIT` 25.3 MB, `__OBJC_RO`
42.2 MB, `shared memory` 48 KB. Those 76.2 MB are one set of physical pages, and
each Baton process reports them in its own summary.

Consequences for any baseline or candidate report:

- Report each process's `phys_footprint` as its resident charge, and report
  shared read-only pages once for the process family.
- A sum of `ps` RSS across processes overstates the family's memory, and a sum of
  vmmap resident totals overstates it by the process count. In the four-session
  active sample, summed vmmap shared read-only pages reached 1.24 GB while summed
  private footprint was 36.2 MB.
- `ps` RSS is not a stable statistic. It can fall below `phys_footprint` under
  memory pressure: idle-k4 probe3 reported RSS 2.5 MB against footprint 4.5 MB,
  and the 20 MB single-line probe reported footprint 830 MB with vmmap dirty
  0.36 MB because the pages were compressed.
- A candidate comparison must sample baseline and candidate on the same owned
  workload, and must record whether each process existed at sample time. Sample
  `idle-k4` shows probe4 with an observer and no keeper or harness because the
  harness exited during a slow sequential pass; treating the missing roles as
  zero would understate the family.

## 2. Controlled per-role results

Workload: one pending task per session on the owned fixture database, harness
`omp`, harness command `fx/harness.sh` (sleeps, optionally emits inert lines),
sampled 3 s after every role exists. Values are bytes unless noted.

| Sample | Role | private footprint | `ps` RSS |
|---|---|---|---|
| idle-k1 | observer | 4 505 600 | 6 701 056 |
| idle-k1 | keeper | 2 326 528 | 3 735 552 |
| idle-k1 | harness (`/bin/sh`) | 1 622 016 | 2 506 752 |
| idle-k4 (4 sessions) | observer | 4 521 984 – 4 521 984 | 2 621 440 – 4 128 768 |
| idle-k4 | keeper | 2 293 760 – 2 326 528 | 1 802 240 |
| active-k1 (4 MB inert output) | observer | 4 554 752 | 5 685 248 |
| active-k4 (4 MB per session) | observer | 4 718 592 – 4 800 512 | 4 882 432 – 7 094 272 |
| active-k4 | keeper | 2 392 064 – 2 408 448 | 1 802 240 – 3 817 472 |
| active-k4 | harness | 1 900 544 | 1 261 568 – 2 801 664 |

Findings:

- The Baton-fixed private charge per attached agent is the observer plus its
  keeper, about 6.8–7.1 MB, and it is flat from one to four sessions and from no
  output to 4 MB of inert output.
- The harness placeholder above is `/bin/sh`; live provider harnesses are far
  larger (125–198 MB RSS observed in the live Orchestra) and remain where the
  provider requires them.
- Summed `ps` RSS over the family divided by summed private footprint ranged
  1.09–1.53 across samples; divided by summed vmmap dirty it ranged 4.25–19.15.
  Either ratio alone is not a memory claim.
- CPU: idle observers and keepers sampled 0.0 percent; the 4 MB drain sampled at
  most 9.0 percent average for the observer. These are short-lived averages, not
  throughput.
- Ordinary CLI start: `baton2 DB status` ran 19–30 ms wall with at most 5.2 MB
  maximum RSS over five runs, with user and system CPU below the resolution of
  `/usr/bin/time -l`.

## 3. One large frame inflates an observer heap about 190 times

One inert line of the given size, delivered as one stdout line, sampled in the
observer while the harness held the turn open:

| Single line bytes | observer `phys_footprint` | observer `ps` RSS | retained log bytes |
|---|---|---|---|
| 0 (idle) | 4.5 MB | 6.7 MB | 0 |
| 1 000 000 | 202 375 168 | 195 477 504 | 1 000 117 |
| 5 000 000 | 593 494 016 | 584 876 032 | 5 000 025 |
| 20 000 000 | 870 318 080 | 691 814 400 | 20 000 117 |

The retained log holds exactly the line, so the inflation is in the observer's
own state, not in log storage. The observer grows about 190 times the line size
at 1 MB and about 30 times at 20 MB. `[INFERENCE]` The amplification matches
Bend's term-list string representation plus parse copies; confirming the
allocation sites needs `heap` or `malloc_history` against the same input.

This matters to the shared-owner design in two directions. Per-session observer
processes also isolate one session's frame cost: the 20 MB probe inflated one
observer to 830 MB while its sibling roles stayed near 2 MB. A single owner
process holding all session state places one session's large frame in the heap
that every attached session shares. Candidate qualification therefore needs a
large-frame case in addition to frame counts.

## 4. Source-verified compatibility and failure facts

**4.1 `IO.die` and `IO.try` are process-global.**

`bend2/base.bend:194` defines `IO.die(A, code, msg)` as `R => k => Halt{code, msg}`.
`bend2/base.bend:204` defines `IO.try` as `IO.bind(..., act, IO.pass(A))`, and
`IO.pass` re-raises a `Fail` through `IO.die`; it catches nothing. `IO.join`
raises `Halt` when its channel is closed (`bend2/base.bend:250`).

In the generated runtime, `io_step` returns the halt code when the request
continuation is `CID_HALT`, and `io_loop` returns that code as the process exit
status (`baseline/baton2.c:201252`, `:201307`). A halt raised by any spawned task
ends the process, so `IO.fork` provides no error boundary. Independent probes by
the shared-instance conductor returned the same result (`die` 23, `try` 24, a
stopped-session admission 2) with a `Fail` value returning 0.

The coordinator source contains more than twenty `IO.die` sites, including
`receive.bend:registered`, `control.bend`, `recruit.bend`, `stop.bend`,
`turn.bend` and `knowledge.bend`. `main.bend` also reaches `Text.control_output`
and `IO.write` from the public entry.

**4.2 A closed client output pipe terminates the process.**

`io_out` (`baseline/baton2.c:200803`) calls `err_fail` when `fwrite` writes fewer
bytes than requested, and `err_fail` (`:5582`) does `fflush(stdout)`,
`fprintf(stderr, ...)`, `_exit(1)`. The runtime ignores `SIGPIPE`, so a write to a
closed pipe returns `EPIPE` and reaches this path. `IO.write` and `IO.print`
(`effs/write.c`, `effs/print.c`) both call `io_out(stdout, ...)`.

**4.3 The control output sink is fd 1, without request correlation.**

`host/text.c:baton_control_output_call` takes the whole buffer, holds
`flockfile(stdout)`, and writes it to `STDOUT_FILENO`. The effect has no
destination parameter, so concurrent clients of one process cannot be separated.
Two further details: `IO.write` and `IO.print` use buffered `fwrite` without
`flockfile`, and the control output writes directly to the descriptor, so the
order between an ordinary answer and a control line is not defined while both
paths are live in one process.

**4.4 Child environment is process-global.**

`host/process-spawn.c:84` and `:392` pass the global `environ` to `posix_spawnp`.
No spawn or prepare entry accepts a child environment. `harness/git-series.mjs:203`
builds a scoped copy through `scoped_environment` and replaces its own image with
`process.execve` (`:181`), so the launcher process is gone after the call. The
scoped environment deletes `GIT_CONFIG_PARAMETERS`, `GH_TOKEN`, `GITHUB_TOKEN`
and, on the `gpt` series, `OPENAI_API_KEY` and `CODEX_API_KEY`, and sets Git
author and committer identity plus credential helper configuration for the
selected series. Per-child model identity therefore needs an explicit-env spawn
interface; an owner-level `setenv` would give one identity to every concurrent
child.

**4.5 Child handles are process-local, monotonic and not freed on completion.**

`baton_children` is indexed by a monotonically increasing `U32`
(`process-spawn.c:1250`). Entries are cleared and their child freed only on the
error path (`:1227`). For retained children the `BatonRetained` struct and its
directory string are freed only on error (`:481`, `:502`); `BR_ACK` closes the
socket, spool, life and watch descriptors and joins the receiver thread
(`:612`), and the keeper writes `acknowledged`, sets `finishing` and unlinks the
stdout spool (`:725`). The struct, the directory string and the table slot remain
for the life of the process, and the index is never reused. A long-lived owner
accumulates one slot and one small allocation per attempt until the `U32` space
is exhausted, at which point retention refuses with `ENOMEM` (`:1240`). The
stale-handle rejection at `:1276` exempts retained children, so a completed
retained handle is still addressable from the table.

**4.6 Keeper release and acknowledgement are distinct.**

Keeper-side: `BR_RELEASE` requires `keeper->exited`, closes `keeper->lock` and
writes `released` (`:719`). `BR_ACK` requires `exited` and `released`, writes
`acknowledged`, sets `finishing` and unlinks `stdout` (`:725`). Attachment and
recovery refuse a directory carrying `acknowledged`, `released` or
`native-start-error`, or missing `launch` (`:1096`). Release returns the session
guard; acknowledgement records completion. The Receive owner's clarification on
this point matches the source.

**4.7 A keeper failure is fail-fast for everything it hosts.**

`br_keeper` reaches `done:` on any error and calls `_exit(1)` (`:1033`), noting
the failure in `keeper-error` and only then unlinking its socket. The keeper is
single-directory, single-client and single-native by construction (`BrKeeper`,
`:134`; `br_keeper`, `:974`). A shared custody process inherits this behaviour:
any error path that ends the process ends custody for every child it owns, so
shared custody needs per-child error results and separate correlated-loss
qualification.

**4.8 Blocking child reads occupy a fixed helper pool.**

`IO_HELP` is 64 (`baseline/baton2.c:267`). `io_work` spawns a helper thread only
while `io_size < 64` and queues the job otherwise (`:200965`); helpers never exit
and wait on a condition variable (`:200946`). `br_read_line`
(`process-spawn.c:531`) waits on `retained->changed` until the child produces a
newline or exits, while holding `retained->reader`. Sixty-four sessions with an
outstanding read therefore occupy the pool and later jobs wait in queue order.
No read carries a deadline. The observed 64 describes this pool and is not an
agent cap; admission, stop, guidance and completion must use readiness
notification and bounded per-operation work.

**4.9 Delivery output has no session identity.**

`delivery.bend:completed` appends the endpoint's stdout to `db ++ ".root.log"`,
one path per database, then stores the message result. Concurrent deliveries
interleave in that file with no attempt or session field, so correlation must
come from the delivery invocation's own output and exit status.

**4.10 MCP correlation is process-level today.**

`scripts/mcp-conductor.mjs:114` runs
`execFileSync(coordinatorExe, [dbPath, ...args], ...)`, which gives each request
its own stdout, stderr and status, and blocks the server's event loop for the
call. A thin-client owner protocol has to preserve that per-request reply
contract; a process-global fd 1 destination cannot replace it (4.3, 4.2).

## 5. Limits

- The fixture harness is not a provider. Inert lines exercise the read, log and
  record paths only. The 4 MB inert case does not reproduce the ~44 MB vmmap
  dirty figure seen in live provider-driven observers, and this fixture does not
  isolate which frame classes retain heap.
- The measurements are single-host, single-instant snapshots. `phys_footprint`
  moves with memory pressure and compression, so a baseline and a candidate have
  to be sampled in the same session and reported together.
- The first 20 MB sample (`fx/evidence/big-k1-contaminated-run-overlap/`) is
  retained as a failing fixture result: two concurrent runs shared one fixture
  database path and the sampler matched both. `measure.py` now uses a per-label
  database path; the clean re-run is `fx/evidence/big-k1/`.
- Live-Orchestra numbers in this document (observer RSS up to 93 MB, vmmap dirty
  44 MB) are read-only instantaneous observations of an uncontrolled workload.
  They show the spread between RSS and private footprint. No savings claim is
  made from them.
- Stale-handle behaviour for retained children is read from source; no stale
  handle was executed against a live capability.
- No shared keeper exists, so correlated-loss behaviour for shared custody is
  argued from the current single-attempt keeper, not measured.

## 6. Conditions this scope supports

- Per-role private footprint with shared read-only pages counted once, plus a
  large-frame case in candidate qualification (sections 1–3).
- A task-local result and output sink; fd 1 cannot serve concurrent clients, and
  a client disconnect must not terminate the owner (4.1–4.3).
- An explicit per-child environment for spawn and recovery, with secret values
  kept out of logs and durable request records (4.4).
- Owner-instance and generation binding before external capability lookup, and a
  teardown that waits for in-flight IO and historical settlement before freeing
  once (4.5, 4.6).
- Correlated-loss qualification for any custody process that serves more than
  one child (4.7).
- Readiness-driven child IO with no per-read blocking wait (4.8).

## 7. Cross-review of sibling baseline and conductor draft

Reviewed artifacts: `native-instance-measure/bend2/measure/native-instance/baseline-2026-10-05.md`
with its `evidence/` and `fixture-*` directories, and
`native-instance-conductor/docs/bend2/shared-native-owner-boundaries.md` at commit
`94d7ec58` (delta over `0e872489`) with its new untracked
`bend2/src/coordinator/owner-admission.bend` and `bend2/test/owner-admission/`.

Sibling measurement, independent verdict. The method is sound and stronger than an
RSS sum: it uses `footprint -j` for `phys_footprint`, keeps RSS and footprint as
separate reported measures, states its observation load and swap, and claims no
saving. Its numbers agree with mine where they overlap (keeper private footprint
2.1–2.3 MiB against my 2.3 MiB; dispatch 2.9 MiB; binary sha256 identical). Three
method notes:

- The 218 bytes of peak observer footprint per recorded frame byte is a two-point
  ratio. My controlled single-frame probe brackets it from both sides: 40 000 small
  inert lines totalling 4.26 MB left the observer at 4.55 MB footprint, while one
  1 MB line produced 202 MB and one 20 MB line produced 870 MB. A candidate
  comparison has to fix the frame size distribution, not only the total volume.
- Its live snapshot sums `phys_footprint` across processes, which is additive for
  private memory and correctly excludes clean shared pages. The process count is 24
  observers, so its own limit about compressed pages understates nothing, but the
  report should also name the roughly 76 MB per-process read-only shared mapping
  that must be counted once, as section 1 does.
- Two process roles it measured are new to my inventory and change the plain-count
  story: `message`, `report` and `ask` run the endpoint inside the invoking CLI
  process and wait, so that process stays resident for the recipient's whole turn,
  and MCP `execFileSync` blocks the stdio server for the same interval.

Conductor draft `94d7ec58`, independent verdict. The release and acknowledgement
correction matches the source I read independently: `BR_RELEASE` requires exited and
closes `keeper->lock` (`process-spawn.c:719`), `BR_ACK` requires both exited and
released (`:725`), and no host child object is destroyed by either. The statement
that `ProcessChild.recovery_argv` cannot enumerate the released-but-unacknowledged
finish window matches the refusal at `:1096`, which returns no recovery command when
`acknowledged`, `released` or `native-start-error` exists. The immutable
environment snapshot with separate native and recovery sources, the pre-admission
versus post-admission distinction, and the generation separation between admission
slot, child capability and owner instance all follow from the source facts in
section 4.

Five resource and compatibility items stay outside the draft's qualification list:

1. A single large frame case (§3), with the frame size distribution fixed.
2. The blocking CLI delivery path and the blocking MCP call, which must not carry
   their wait into a shared owner's client protocol.
3. Client disconnect on fd 1 as an owner-death vector (§4.2), and fd 1 as an
   unusable shared reply sink (§4.3).
4. Correlated custody loss as fail-fast process exit (§4.7), not only as crash.
5. Handle and retained-allocation residue after ACK with monotonic U32 slots
   (§4.5), and the helper-pool readiness requirement (§4.8).

The guard-alias note added at `94d7ec58` comes from review `5fea8d62`; I did not
probe hard-linked database aliases, so I record it as that reviewer's fixture result.

