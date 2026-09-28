# Coordinator comparison, 2026-09-28

The measured Bend2 coordinator uses less retained memory and storage for this
workload. The old coordinator completes several warm operations sooner. These
measurements establish a baseline for selecting useful optimizations.

## Sources and workload

The old source is `8120395abf641d34413b34400af5dbd390e0fb33`. Bend2 runtime
source is `9e00826300a864a0f0cfba385ed461473d281f9e`; validation commit
`1bbb2516` changes its test runner and one test. The benchmark scripts are
committed at `6c5da1dd`. The generated [final results](measurements/2026-09-28-coordinators.json)
retain exact revisions, source and executable hashes, raw samples and host
observations. This baseline precedes the native `receive` implementation.

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
| Read worker roster | `swarm.view`, participants projection | `workers` |
| Read retained reports | `swarm.view`, contributions projection | `inbox root` |
| Retain worker guidance | `swarm.guide` for a worker without streaming input | `message`, guidance kind |
| Retain a worker report | `swarm.update`, contribution event | `report` to its parent |

The records carry different metadata. Old contributions include review state;
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
| Worker roster | 6.61 / 13.24 | 7.51 / 8.42 |
| Read reports | 10.31 / 16.66 | 13.54 / 14.34 |
| Retain guidance | 5.51 / 10.98 | 7.93 / 12.03 |
| Retain report | 5.21 / 10.74 | 8.00 / 9.81 |

An [earlier diagnostic run](measurements/2026-09-28-coordinators-first.json)
is retained with the same runtime source. Its old timing includes caller JSON
parsing, while its Bend2 timing ends before parsing. It also predates the UTF-8
output-size correction and host load capture. The final run corrects those
measurement boundaries. Timings varied during work on the shared host; the
earlier run supplies no load observation for attributing that variation.

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
dependencies from the old checkout. It leaves the existing resident and its
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
