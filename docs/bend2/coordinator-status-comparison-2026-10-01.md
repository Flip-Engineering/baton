# Stored status comparison

## Sources and workload

The comparison ran on 2026-10-01 Pacific time, starting at
`2026-10-02T00:01:04.602907Z`. It used original Baton master
`6ccb2a6daf396fb9ce050cc91476ac49791b64c9` and isolated Bend2 source
`9ba8ff74913d38cdbfbc30b80f0f89f745d98b27`. That source adds the
`status_read` operation and its correctness tests to `cfe69bf0`. The native
runtime sources and build script match both `cfe69bf0` and the published build
source `46f1b86e`. The copied executable remained unchanged at SHA-256
`8aa2ac152783febdf6d3193b5caa432adc84f66a2f0131ef70dbd69e22e8c83a`.
The [build binding](measurements/2026-10-01-status-comparison-build-binding.json)
records the source identities and file hashes. No native build ran in this lane.

The workload used nine workers, 58 initial reports and 4,096-byte Unicode bodies.
Three warmups and 25 samples for each of five operations and two implementations
produced 250 measured samples. The final stores retained nine workers, 86 reports
and 28 guidance messages. The existing `workers` measurement and API are retained.

Original Baton ran production `SwarmRuntime.command` and `CoordinationStore` in
one retained Node process with controlled worker ports and a private stdio helper.
Bend2 ran its native executable and SQLite store in a new process for each
command. Its root endpoint was empty; reports remained pending. The run used
Node 25.8.0, Python 3.14.3 and macOS on ARM64 with ten logical CPUs.

## Stored status and correctness

The new Bend2 operation invokes `status`. Every read checks the root and all nine
workers exactly once, with their stored parent, requested and observed route,
native identity, endpoint, workspace, branch and base. Expected metadata comes
from the setup arguments. Root pending input equals the retained report count;
each worker's pending input equals its addressed guidance count. The checker
requires integer counts and explicit field presence.

Original `status_read` invokes `swarm.view` with the `participants` projection,
the same helper operation used by its roster measurement. The answer carries
worker rows and a swarm frame. This setup recruits workers without parent or
route options, so their `parentId` and `route` fields are null. Assertions check
those values, unique worker identities and each worker's parked guidance IDs
and delivery states. The original answer has no corresponding root session or
pending-report counter. Its fields and Bend2's fields have different scopes.

Status checks run during the samples and after each of three original-helper
restarts. Existing checks still verify worker and report identities, guidance
recipients, complete Unicode bodies and retained reports. The fixture contains
no stopped sessions. Stored session presence requires a separate process
observation to establish liveness.

The [behavioral tests](../../bend2/test/compare-coordinators.py) passed five cases
in 0.893 seconds before this run. Production commands exercise nested parents,
distinct requested and observed routes, nonempty native and endpoint values,
and acknowledged report and guidance transitions. Incorrect captured responses
test missing or duplicate identities, omitted fields, changed metadata, swapped
recipient counts and string or Boolean counts. The original test uses the frozen
Bend2 checkout's `impl` source; this comparison executes the archived `6ccb2a6d`
source. Private fixture directories and helper processes were cleaned up.

## Measurements

| Operation | Original p50 / p95, ms | Bend2 p50 / p95, ms |
| --- | ---: | ---: |
| Stored status | 3.090 / 5.543 | 3.885 / 4.705 |
| Worker roster | 2.995 / 5.533 | 4.318 / 4.955 |
| Retained reports | 4.857 / 7.120 | 7.182 / 8.093 |
| Retain guidance | 5.075 / 8.971 | 4.538 / 5.310 |
| Retain report | 4.980 / 6.887 | 4.557 / 5.142 |

| Retained or returned data | Original Baton | Bend2 |
| --- | ---: | ---: |
| Final store, bytes | 1,580,716 | 581,632 |
| Median status response, bytes | 18,452 | 4,135 |
| Median roster response, bytes | 18,452 | 41,708 |
| Median report-read response, bytes | 322,411 | 311,483 |

The original retained coordinator used 124.422 MiB RSS after the workload.
One Bend2 roster process peaked at 5.031 MiB. These figures cover different
process lifetimes and the measured coordinator portions. All fifty measured
original writes performed one fsync each; its status reads performed none.
Original helper restarts took 121.212–123.452 ms, followed by first report reads
of 13.744–14.148 ms.

Caller wall times include command transport or process launch, completion and
JSON parsing. Original helper responses wait for scheduled group fsync. Bend2
uses its ordinary SQLite transactions. The
[raw results](measurements/2026-10-01-status-comparison.json) are an unchanged
copy retaining all 250 numerical samples, response sizes, source and executable
hashes, dependency metadata, timing boundaries and host observations. Complete
report and guidance bodies remain in the private retained stores.

The run completed in 3.232 seconds with exit 0.
[Launch evidence](measurements/2026-10-01-status-comparison-launch.json) records
the exact command and captured process IDs. The
[lifecycle record](measurements/2026-10-01-status-comparison-lifecycle.json)
records unchanged source and executable hashes, absent launcher and driver
processes, and no remaining comparative command process. Driver stderr and all
four original-helper stderr files were empty. No benchmark repeat ran.

## Usage and limits

For this workload, Bend2 `status` returned 4,135 bytes and `workers` returned
41,708 bytes. The corresponding Bend2 medians were 3.885 and 4.318 ms. `status`
supplies stored routes, workspace metadata and pending counts across all
sessions. `workers` includes each worker's complete latest report, latest
report ID and last-turn fields. Select the read that supplies the task's fields;
`inbox root` supplies reports awaiting acceptance.

Original status and roster invoke the same participant projection at different
points in the interleaved workload. Their timing and size distributions reflect
those separate calls. Writes grew both stores during measurement, caches were
retained, and the host's one-minute load was 2.407 before and after. Adding a
fifth operation changed sample ordering; workspace paths also differ from the
[earlier run](coordinator-comparison-2026-10-01.md). Cross-run timing changes
cannot be attributed to a coordinator change. Installed original dependencies
remain mutable; direct-package versions and metadata hashes are recorded.

This workload measures controlled coordination costs, returned data and stored
state correctness. Native models, parent endpoint execution, resident transport,
Git landing and network publication have separate acceptance boundaries. A
matched native worker and reviewed-landing comparison remains open.
