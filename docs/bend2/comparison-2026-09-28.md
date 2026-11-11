# Coordinator comparison, 2026-09-28

The measured Bend2 coordinator uses less retained memory and storage for this
workload. The old coordinator completes several warm operations sooner. These
measurements establish a baseline for selecting useful optimizations.

## Sources and workload

The old source is `8120395abf641d34413b34400af5dbd390e0fb33`. Bend2 runtime
source is `9e00826300a864a0f0cfba385ed461473d281f9e`; validation commit
`1bbb2516` changes its test runner and one test. The benchmark scripts were added
at `8c9b1851`; `6c5da1dd` corrects their caller timing boundary. The generated
[final results](measurements/2026-09-28-coordinators.json) retain source revisions,
runtime source and executable hashes, benchmark script hashes, raw samples and
host observations. The old runtime uses the checkout's mutable `node_modules`;
those dependency contents were not pinned or hashed. This baseline precedes
the native `receive` implementation.

The workload starts with nine workers and 58 reports of 4,096 UTF-8 bytes each.
The worker count and payload size represent the current cutover trial. It uses
three warmups and 25 measured samples for each operation, with shuffled
operation and implementation order. Writes grow the stores to 86 reports and
28 guidance messages. The benchmark checks report bodies and IDs, worker IDs,
guidance recipients and bodies, and retention across three old-helper restarts.
Every Bend2 operation starts a new process using the retained database.

The old side runs production `SwarmRuntime.command` and `CoordinationStore`
inside one retained Node process. Controlled worker ports supply the native
worker boundary. A private stdio helper dispatches commands. The response waits
for the store's scheduled group fsync; every measured write performed one real
fsync. The raw samples also record command return time before that flush.

The Bend2 side invokes its native executable once per operation and uses its
ordinary SQLite transactions. Its root endpoint is empty, so reports remain
pending for measurement. Both implementations use new private stores.

| Outcome | Old operation | Bend2 operation |
| --- | --- | --- |
| Read worker roster | `swarm.view`, participants projection; median 18,210 output bytes | `workers`, including complete latest reports; 41,141 output bytes |
| Read retained reports | `swarm.view`, contributions projection | `inbox root` |
| Retain worker guidance | `swarm.guide` for a worker without streaming input | `message`, guidance kind |
| Retain a worker report | `swarm.update`, contribution event | `report` to its parent |

The roster commands serve a common worker-listing task with different fields
and output volumes. The timing pair includes the cost of each complete response.
Old contributions include review state;
Bend2 messages include recipients and receipts. Output sizes are retained with
the timing samples. This comparison excludes model execution, root delivery,
Git recruitment and landing, publication, and the old resident's full CLI and
Web transports.

## Results

The final run used macOS on ARM64, ten logical CPUs, Node 25.8.0, Python 3.14.3
and Bend 2.0.25. The shared host's one-minute load average was 10.85 before the
measurement and 10.54 afterward. Each wall time below includes the relevant
transport or process launch, command completion and caller JSON parsing.

| Operation | Old p50 / p95, ms | Bend2 p50 / p95, ms |
| --- | ---: | ---: |
| Worker roster, 18,210 / 41,141 median output bytes | 6.61 / 13.24 | 7.51 / 8.42 |
| Read reports | 10.31 / 16.66 | 13.54 / 14.34 |
| Retain guidance | 5.51 / 10.98 | 7.93 / 12.03 |
| Retain report | 5.21 / 10.74 | 8.00 / 9.81 |

An [earlier diagnostic run](measurements/2026-09-28-coordinators-first.json)
is retained with the same runtime source. Its benchmark and helper hashes refer
to uncommitted versions whose source snapshots are unavailable in this record.
The earlier run also lacks host load observations. It supports no reproducible
implementation comparison or attribution of changes in timing or output size.
The final results above use the committed scripts and matching caller boundaries.

The final old process retained 128.2 MiB RSS after the workload. A separate
native roster process peaked at 4.22 MiB RSS. These figures cover the measured
coordinator processes; agent harnesses and complete deployment memory are
outside this measurement. Bend2 requires no idle resident between commands.

The final old store occupied 1,586,771 bytes and the Bend2 database occupied
561,152 bytes. The old helper reopened its retained state in 292–323 ms,
with a median of 322 ms, followed by a median 33.58 ms first report read.
Each Bend2 read opens a new process and database, so its measured command time
includes that work.

All content, routing and retention assertions passed. The benchmark performs
ordinary process restarts; it makes no claim about recovery from power loss.

## Architecture and usage consequences

Keeping the old runtime loaded amortizes startup across commands. Bend2 pays
process and database-open costs for each invocation and releases that process's
memory afterward. The results support retaining the simpler invocation model
while measuring which call sequences consume material user time.

`workers` returns each worker's latest report. That command produced 41,141
bytes for this fixture. `status` already supplies route, workspace and pending
counts when the requester needs a compact overview. Selecting the appropriate
existing command can reduce the data an orchestrator reads.

Useful next measurements are native command startup, concurrent reads through
the current `BEGIN IMMEDIATE` path, and the time from worker completion to a
parent's accepted report. Any change to batching, read transactions or native
delivery should be measured against a named workload using the same outcome
checks. The current results establish no overall worker-completion speedup.

## Reproduce

Build the coordinator, then run:

```sh
python3 bend2/scripts/compare-coordinators.py \
  --old-repo /path/to/old/baton --old-ref 8120395a \
  --workers 9 --reports 58 --body-bytes 4096 --samples 25
```

The script exports the selected old source revision, runs private stores and
retains generated results below `.scratch/comparison/`. It uses available
dependencies from the old checkout. Future runs record installed direct-package
versions and package metadata hashes; those observations do not pin dependency
contents or establish the dependency versions used by this baseline.
It leaves the existing resident and its
stored state untouched. Sample counts, workload sizes and output location are
command-line options.

## Validation corrections

The first `check-native.sh` run built the coordinator and passed its Bend Git
and landing suites. It passed 57 discovered Python tests and nine explicit MCP
tests, then failed the final end-to-end test during initialization. That test
still sent Content-Length frames; the current channel server reads newline JSON
and activates replay after tool discovery and a ping round trip.

The corrected end-to-end test uses that protocol and verifies recruitment,
report notification, acknowledgment and landing. The runner now executes each
Python test file. Its previous discovery command skipped the hyphenated Codex,
OMP and check-runner filenames. The corrected baseline passed both Bend suites
and all 94 Python tests across ten files. Local before/after logs are retained
in `.scratch/validation/check-native.log` and `check-native-fixed.log`.
That count describes the pinned baseline. The subsequent receive implementation
passed 104 tests across eleven files, recorded in the
[native receive validation](native-receive-2026-09-28.md).

## Held-writer reads and deferred transaction follow-up

A later measurement used runtime source `9107256bc5f40075525cecc138bb762b8e2e5484`,
source tree `5d2613c9848c27b0b426f9704e9611228c300c87`, and coordinator SHA-256
`c6fcca8d251b38b1410c5269d53890266602dd7ef6037a9bd327b45b3ace39ed`.
The [read-contention artifact](measurements/2026-09-28-read-contention.json)
records the raw evidence and driver paths and hashes, SQL, source-file hashes,
and timing boundaries. Both runs used private databases in rollback-journal
(`delete`) mode.

At this source, `Store.commit` begins `Status` and `Inbox` with `BEGIN IMMEDIATE`
and runs schema initialization before the query. A fixture held an uncommitted
writer transaction while both coordinator processes opened the database. Neither
completed during the following approximately 250 ms observation. After writer commit, both
completed successfully and returned the updated values. Their recorded elapsed
times were 545.22 ms for `status` and 501.30 ms for `inbox root`, from immediately
after process creation returned through captured-output collection. Direct reads
on an already-open Python SQLite connection returned the previous committed
snapshot while the writer remained held, in 1.542 ms and 0.082 ms respectively.
Those query timings include fetching and parsing the JSON row.

The follow-up called `/usr/lib/libsqlite3.dylib` through `ctypes`, matching the
frozen coordinator's dynamic-library binding. That library reported SQLite
3.54.0; the separate fixture writer used Python SQLite 3.53.0. Each deferred
read executed `BEGIN`, the existing schema statements, the exact query and
`COMMIT` in one `sqlite3_exec` call. With the writer held, `Status` and `Inbox`
returned the committed snapshot in 0.195 ms and 0.156 ms. The equivalent
`BEGIN IMMEDIATE` controls returned `SQLITE_BUSY` after the probe's 250 ms busy
timeout, at 273.86 ms and 295.54 ms. These intervals cover SQL execution and its
JSON callback; connection setup and process startup are outside the interval.

Both individual reads on new databases initialized the three application tables
and returned empty arrays. All ten readers in five barrier-synchronized cold
`Status`/`Inbox` pairs completed with empty results and empty tables. The writer
committed, subsequent reads saw its changed model and message body, and pending
message IDs remained intact. The coordinator observation also confirmed that
reads wrote no receipts and all reader processes exited.

The 250 ms observation and busy timeout bound these tests. The production busy
handler retries without a cutoff. Deferred `BEGIN` ran only in the direct-SQL
probe; production source and the frozen executable remained unchanged. A
production read-admission change would require full coordinator validation,
including cold initialization and the content checks above. These measurements
establish the observed contention behavior; they provide no throughput estimate
or general claim about every concurrent schedule.


## Measurement on the law-bearing revision

A repeat on `08ee671b62528888a2facd0d3a8ce2af34e5ef98` used the same
nine-worker fixture, 58 initial reports, 4,096-byte bodies, three warmups and
25 samples per operation. The old source remained `8120395a`. The
[raw results](measurements/2026-09-28-coordinators-law-bearing.json) retain
source, executable and benchmark hashes, dependency metadata, every sample,
and host observations. The executable SHA-256 was
`c1fc3aa2c1396989cd79bb214d93cf786aeae22370ad6d1532d363899c82aed4`.
The build and its negative controls verified 223 laws and two implementation
mutations. That total includes the explicitly supplementary test-reader and
corpus laws described in the source.

The timing boundary and workload scope above apply. All content, routing and
restart assertions passed. The host's one-minute load average was 8.71 before
this run and 8.33 afterward.

| Operation | Old p50 / p95, ms | Bend2 p50 / p95, ms |
| --- | ---: | ---: |
| Worker roster | 3.64 / 6.27 | 4.42 / 5.00 |
| Retained reports | 5.48 / 9.25 | 7.57 / 9.56 |
| Retain guidance | 4.55 / 5.84 | 4.75 / 6.39 |
| Retain report | 4.28 / 5.60 | 4.55 / 5.24 |

The Bend2 roster response contained 41,600 bytes for this fixture, compared
with 41,141 bytes in the earlier run.

The old coordinator retained 127.88 MiB RSS after the workload; a separate
Bend2 roster process peaked at 4.45 MiB. Final retained storage was 1,586,771
bytes for the old store and 561,152 bytes for Bend2. Old helper restart times
were 142.98–143.95 ms, followed by first reads of 14.49–14.88 ms.

This run again measures a smaller coordinator memory and storage footprint
for Bend2 and faster median warm operations for the old retained runtime.
Host load and source both changed since the earlier run, so the difference
between these runs cannot be attributed to a runtime change.
Native model work, parent notification, Git landing and publication remain
outside this benchmark. Installed old dependency contents remain unpinned;
the artifact records the direct package versions and metadata hashes.
