# Issue #686 workload measurement, 2026-10-07

Two measurement records of the coordinator log policy, taken on one
provider-free OMP workload and on the same retained traces:

- `../2026-10-07-logging-policy-351c9aba.json` — commit `351c9aba`, whose policy
  carries a retention level, a byte budget with numbered segments, a bounded
  stderr spool and attempt generations.
- `../2026-10-07-logging-policy-31f261ff.json` — commit `31f261ff`, whose policy
  is the retention level alone.

`measure-driver.py` runs the workloads, `extract-windows.py` selects the
real-frame inputs, `queue.sh`, `queue-level-31f261ff.sh` and `final.sh` order
them, and `summarize.py` assembles a headline record plus `runs.json` from the
per-run `result.json` files. Each run directory on the runner keeps its fixture,
database, public log and attempt artifacts; `runs/` here keeps every
`result.json`, `inventory.json` and run log.

## Sources

| Record | Commit | Tree | Source archive SHA256 | Executable SHA256 |
| --- | --- | --- | --- | --- |
| `351c9aba` | `351c9aba85c69f4e4aab1f86cc31fb0f415fe327` | `9afffc172eec7b77eb5d3df1a15aaa6cc2e334c5` | `a70a745a741aa48467a80eb6cd4104d73f7cb650868db81293acbe65448b0e09` | `4a0cf22357c0f40c8ba405d7894218f32eccca81dd0b615b1d7ad6c8ebc84928` |
| `31f261ff` | `31f261ff1dd9535ac0fda9cf60e9940d14ae3b52` | `745763833b721c905db1cdca0d7059cb9dbdf839` | `47778f3d07e53c147dbc3da09aae8b83f582b71be08165a10ad4af3fbefb85be` | `9ce8b5b5ca8a8358d36c095a14d40e9b6da17242f685300d774efa27f003e988` |

Each archive is `git archive --format=tar --prefix=baton-<commit>/ <commit>`.
`binaries.txt` records the executable sizes. Two independent builds of
`351c9aba`, one under `/home/atari2036` and one under the NVMe mount, produced
the same executable SHA256.

The baseline executable is a Linux x86_64 rebuild of release 1.1.0 at
`fca7af876c8260c32d17f95f3e19bc68ee1bf561`, kept at
`/home/atari2036/baton-logging-686/baseline/.scratch/bend2/baton2`, SHA256
`93e7f20a271fe9834be3e8ca19469d34408b859f618ffd7475f5eeb5690ae46b`. The `bend2`
subtree of its source matches commit `fca7af87` at SHA256
`682faa27a05cabe23292b39b572e78ef409c34064d2b96c10d429354dcf6b48d`; the only
difference is a `bend2/test/__pycache__` bytecode file. The recorded baseline for
this workload is
`972d620ce6209193cb91273350a9c1ea2713cac6b4b2bcf692a6303df75c766c`, release
1.1.0 on a Darwin arm64 host.

## Toolchain and host

| Item | Value |
| --- | --- |
| bend | 2.0.25 (`/home/atari2036/baton-logging-686/toolchain-home/bin/bend`, SHA256 `d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693`) |
| clang | Ubuntu clang 19.1.1 (1ubuntu1~24.04.2) |
| python | 3.12.3 |
| sqlite | 3.45.1 |
| OS | Linux 6.14.0-37-generic x86_64 |
| Host | `acp-compute-cluster-001` |

Workspace `/home/atari2036/baton-measure-work`. The `/` filesystem held about
3 GiB free for the whole run; the NVMe mount that first hosted the workspace
dropped off the bus and is no longer present, so every reported run was taken on
`/`.

## Workload

`measure-driver.py batches` starts one native receive for the session `root`
(`attach root omp`), acknowledges the initial message, writes frame batches
through a provider-free fixture, and closes the turn with `agent_end`. One run
is one turn.

| Batch | Frames | Shape |
| --- | --- | --- |
| `native-small` | 400 | `message_update`, 128 characters each, no identity |
| `native-cumulative` | 400 | `message_update`, 51 characters added per frame, whole message resent |
| `native-tool-bash` | 400 | `tool_execution_update`, `toolName` `bash`, 51 characters added per frame |
| `native-tool-task` | 300 | the first 300 contiguous frames of the one real `task` tool call in the source OMP log |
| `native-omp-window` | 140 | contiguous real frames covering eight frame types |
| `native-semantic` | 8 | fixed lines pinning the classification of unusual `type` values |
| `native-accumulate` | 200 per cycle | unclassified `response` frames with a 20000-byte pad each |
| `native-stderr` | 1 per cycle | one batch writing 65536 bytes to the harness stderr |

The count was set to 400 rather than the 1000 of the 2026-10-06 record: the
cumulative batches grow quadratically, and 1000 frames took about 490 s per
batch on this host while producing the same per-frame retention. The
accumulation configuration repeats its plan four times inside one turn.

Real-frame inputs, from `extract-windows.py`:

| Input | Bytes | SHA256 |
| --- | --- | --- |
| `inputs/frames-task.jsonl` | 7206498 | `18a4bf45c4050198b95adf155cc2e13d788f0f01b78091f0e98097fc13561b4f` |
| `inputs/frames-omp-window.jsonl` | 69001 | `67dec8c12defc55d692091b9a62dc8a88ae824873c97a19d971a2346eee56047` |

Source OMP log `logging-impl-20261006-provider.jsonl`, SHA256
`9dc892779bf6e77c01e1a624d146212a3435f93a99087de24518467db6038096`. The task
call is `call_00_BF9yx8K9cfoORRLfR4mO2883` (3712 frames, 109,546,322 bytes in
the source log). The window starts at source line 7640.

`inputs/frames-omp-window.jsonl` is committed. `inputs/frames-task.jsonl` is not:
it is 7.2 MB, and `extract-windows.py` regenerates it byte for byte from the
source log above, which the SHA256 of the file identifies.

## Commands

```
python3 measure-driver.py batches --exe BASELINE --source-revision fca7af87 \
  --task-frames inputs/frames-task.jsonl --omp-window inputs/frames-omp-window.jsonl \
  --count 400 --step 51 --out RUN1
python3 measure-driver.py batches --exe AFTER --source-revision COMMIT --level default ...
python3 measure-driver.py batches --exe AFTER --level diagnostic ...
python3 measure-driver.py batches --exe AFTER --level default --budget 65536 --segments 2 \
  --count 60 --step 51 ...                              # rotation configuration
python3 measure-driver.py batches --exe AFTER --level default --accumulate 20000 \
  --accumulate-frames 200 --repeat 4 --stderr-bytes 65536 ...
python3 measure-driver.py replay --exe AFTER --harness omp   --level default    --frames inputs/frames-omp-window.jsonl ...
python3 measure-driver.py replay --exe AFTER --harness codex --level default    --frames inputs/codex-trace-a.jsonl ...
python3 measure-driver.py replay --exe AFTER --harness codex --level default    --frames inputs/codex-trace-b.jsonl ...
python3 measure-driver.py replay --exe AFTER --harness codex --level diagnostic --frames inputs/codex-trace-a.jsonl ...
python3 measure-driver.py incomplete --exe AFTER --level default ...
python3 measure-driver.py inventory --exe AFTER --db RUN/state.db --out RUN
```

`replay` and `incomplete` recruit a worker with `recruit` and run one `turn`.
`replay` appends one `agent_end` frame to a non-terminal OMP window, because a
direct OMP turn ends on its terminal frame; the appended line is recorded in
`appended_terminal_frames`. `logs SESSION LEVEL` receives a budget and a segment
count only in the rotation configuration. The Codex fixture reads stdin without
blocking, because a Codex turn holds the prompt stream open.

## Codex traces

| Trace | File | Bytes | Lines | SHA256 |
| --- | --- | --- | --- | --- |
| A | `ui682-codex-luna-backend-20261006-provider-1791353939.jsonl` | 12412768 | 1311 | `24df212a02c49e11695949a03f257b42256d613bebac2b9fa189a2b3cf4f5d26` |
| B | `ui682-codex-luna-backend-20261006-root-primary-1791362922.jsonl` | 2297259 | 371 | `83dbaeda96749724cf7c39b57e5928f63fff161688f3cedf7d69f67af3b44dac` |

Frame types in A: `item.completed` 676 (12,062,921 bytes), `item.started` 632
(349,570), `thread.started` 1, `turn.started` 1, `turn.completed` 1. Item types:
`command_execution` 1072 frames (12,331,499 bytes), `file_change` 192 (60,016),
`agent_message` 43 (20,779), `error` 1.

`frame_kind` in `bend2/src/coordinator/turn.bend` returns an empty kind for every
session whose harness is not `omp`, and an empty kind is written complete at
every level, so no measured Codex frame is dropped at `default` under either
policy.

## Findings

Retained public-log bytes for one turn of the workload. The baseline writes
every frame; both policies retain the same bytes, because the difference between
them is rotation and retention rather than which frames a level keeps.

| Batch | Emitted | Baseline | `default` both policies | `diagnostic` |
| --- | --- | --- | --- | --- |
| `native-small` | 123200 | 113 | 113 | 123313 |
| `native-cumulative` | 4243016 | 118 | 118 | 4243134 |
| `native-tool-bash` | 4223416 | 4223533 | 117 | 4223533 |
| `native-tool-task` | 7206498 | 7206615 | 117 | 7206615 |
| `native-omp-window` | 69001 | 69119 | 16473 | 69119 |
| `native-semantic` | 351 | 346 | 346 | 467 |
| **turn total** | **15865482** | **11500168** | **63775** | **15866505** |

`default` retains 63,775 bytes against 11,500,168 bytes with no policy, a
reduction of 99.445%. `diagnostic` retains 15,866,505 bytes, 248.8 times the
`default` figure, and the baseline already dropped `message_update` frames, so
`small` and `cumulative` retain the same bytes in every column.

Rotation, at `default` with a 65,536-byte budget and two retained segments over
60-frame synthetic batches: the live log holds 31,061 bytes and the two numbered
segments hold 131,427 bytes together (`run3-after-segments`). The level-only
policy has no such configuration, and its accumulation run retains 16,055,228
bytes in the single `native.jsonl` file with no numbered segment and no
`baton_log_rotation` frame.

Peak size of each transient file, largest across the runs of that record:

| File | `351c9aba` | `31f261ff` |
| --- | --- | --- |
| attempt stdout spool | 15,866,413 | 16,055,136 |
| live public log | 15,866,505 (`diagnostic`) | 16,055,228 (accumulation) |
| numbered segment | 65,837 (rotation run) | none |
| `.pending` checkpoint | 335 | 335 |
| stderr | 30,400 as `.stderr.run-1.full` | 262,144 as `native.stderr` |

Aggregate retained bytes after each turn, by producer:

| Producer | `351c9aba` `default` | `351c9aba` `diagnostic` | `31f261ff` `default` | `31f261ff` diagnostic |
| --- | --- | --- | --- | --- |
| database files | 188416 | 188416 | 131072 | 131072 |
| public log generations | 63775 | 15866505 | 63775 | 15866505 |
| numbered segments | 0 | 0 | 0 | 0 |
| attempt evidence | 58808 | 11310 | 58563 | 11065 |
| workload inputs | 2693 | 2693 | 2693 | 2693 |
| all files | 459835 | 16153505 | 401755 | 16084380 |

Policy disposition of the retained traces, at `default`:

| Trace | Frames | Emitted bytes | Retained bytes | Dropped lines |
| --- | --- | --- | --- | --- |
| OMP window | 141 | 69131 | 16881 | 128 |
| Codex A | 1311 | 12412768 | 12412768 | 0 |
| Codex B | 371 | 2297259 | 2297259 | 0 |

In the OMP window `tool_execution_update` contributes 126 frames of which 1 is
retained (the newest of the open call) and `message_start` contributes 3 of which
0 are retained; `message_end`, `tool_execution_start`, `tool_execution_end`,
`turn_start`, `turn_end`, `agent_end` and the unclassified `tool_stream_update`
are retained complete. Every Codex frame type is retained complete, so these
traces measure no aggregate saving at either level.

The incomplete-turn run cuts a direct turn inside its first tool call. At
`351c9aba` the checkpoint is `<generation>.pending` (335 bytes) and the restored
turn writes both held frames; at `31f261ff` it is `<log>.pending` (335 bytes)
with the same restore. The `351c9aba` run leaves 30,735 bytes in the live log
before the cut and writes the harness stderr to `<generation>.stderr.run-1.full`;
the `31f261ff` run leaves 0 bytes in the live log before the cut and writes the
harness stderr to `<log>.stderr`.

## Limits

- The fixture starts no provider. The batches are frames the driver writes, so
  the figures cover coordinator retention and not a provider's own behaviour.
- One receiver or turn process, one database and one log path per run.
- Wall times are recorded; they are not a performance claim.
- The before executable is the Linux rebuild of release 1.1.0 on the same host
  as the measured executables. The recorded baseline figure for this workload
  was taken on a Darwin arm64 host with a different executable build.
- The runner rebooted several times during the session and its NVMe mount
  dropped off the bus. Runs were shortened and resumed; every reported run
  completed and its files are listed in `runs.json`.
