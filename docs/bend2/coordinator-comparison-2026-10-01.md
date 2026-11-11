# Current coordinator comparison

## Sources and workload

The existing [comparison driver](../../bend2/scripts/compare-coordinators.py)
ran on 2026-10-01 against original Baton master
`6ccb2a6daf396fb9ce050cc91476ac49791b64c9` and Bend2 checkout
`47f5f82119fe56497d99a19bb2ce977e5c33b3f7`. Bend2's runtime sources and native
build script match the law-verified published source `46f1b86e`; it used the
unchanged executable SHA-256
`8aa2ac152783febdf6d3193b5caa432adc84f66a2f0131ef70dbd69e22e8c83a`.
The [build binding](measurements/2026-10-01-comparison-build-binding.json) records
the file identities.

The controlled workload used nine workers, 58 initial reports and 4,096-byte
Unicode bodies. Three warmups and 25 samples per operation retained 200 measured
samples across both implementations. Final state contained 86 reports and 28
guidance messages. Exact worker/report identities, routing, Unicode bodies and
retention across three original-helper restarts passed their assertions.

Original Baton used production `SwarmRuntime.command` and `CoordinationStore`
with controlled worker ports and a retained Node process. Bend2 used its native
executable and SQLite store, starting one process per command. Its root endpoint
was empty, so reports remained pending. The comparison maps participant/report
reads and retained guidance/report writes. It includes caller JSON parsing and
original scheduled group fsync before the helper response.

## Measurements

| Operation | Original p50 / p95, ms | Bend2 p50 / p95, ms |
| --- | ---: | ---: |
| Worker roster | 3.608 / 6.803 | 5.502 / 6.156 |
| Retained reports | 5.768 / 8.732 | 8.762 / 9.270 |
| Retain guidance | 4.502 / 5.838 | 5.942 / 7.169 |
| Retain report | 4.935 / 5.588 | 5.889 / 6.882 |

| Retained or returned data | Original Baton | Bend2 |
| --- | ---: | ---: |
| Final store, bytes | 1,580,716 | 581,632 |
| Median roster response, bytes | 18,072 | 41,573 |
| Median report-read response, bytes | 322,411 | 311,483 |

The original retained coordinator used 125.125 MiB RSS after the workload.
One Bend2 roster process peaked at 4.984 MiB. These labels identify different
process lifetimes and measure the coordinator portions described above.
All fifty measured original writes performed one fsync each. Original helper
restart took 124.995–126.806 ms, followed by first reads of 14.037–14.560 ms.

The run completed in 3.386 seconds. Its
[raw results](measurements/2026-10-01-coordinator-comparison.json) retain every
sample, response size, timing boundary, source/dependency identity and host
observation. Driver and original-helper stderr were empty. Recorded launcher
and driver processes were absent afterward, and source and executable hashes
remained unchanged.

## Interpretation and scope

Bend2's median caller time was higher for all four measured operations. Its
retained store was smaller, and its short roster process used less memory than
the retained original runtime. The current `workers` answer includes complete
latest report bodies: the nine 4,096-byte bodies occupy 37,611 JSON value bytes,
about 90.5% of the roster response. Original participant records carry guidance
metadata and omit those full report bodies. The returned fields explain that
payload difference; they do not establish the cause of timing differences.

One production `status` read on the same final dataset returned 4,000 bytes. It
matched all ten stored sessions, nine workers, parent links, route/native and
workspace metadata, branch/base/endpoint values and pending counts. The stored
database hash, schema and logical rows remained unchanged. Its
[read evidence](measurements/2026-10-01-status-usability.json) records command,
response hash and assertions. This single read measures output and correctness;
it supplies no repeated latency comparison.

Use `status` for stored route and backlog overview, then `inbox root` for owed
reports. Use `workers` when complete latest reports per worker are needed. The
existing `status` answer omits the latest report ID and last turn; the selected
read should supply the fields required by the task. These records describe
stored state. Process observations establish current liveness.

The host's one-minute load was 14.483 before and after this short run. Samples
were interleaved, caches were retained and writes grew both stores. These
observations describe this run; historical timing changes cannot be attributed
to source changes alone. Installed original dependencies remain mutable, with
direct-package metadata retained.

Native models, parent endpoint execution, resident transport, Git landing and
network publication have separate acceptance boundaries. This workload measures
controlled coordination costs and data volume. A matched native worker and
reviewed-landing comparison remains an open acceptance item.
