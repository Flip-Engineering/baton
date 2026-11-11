# Logging workload measurement, 2026-10-07

A provider-free OMP workload measured the default and diagnostic logging levels
at revisions `351c9aba` and `31f261ff`, against a Linux rebuild of release 1.1.0
(`fca7af87`). Both measured revisions retained the same workload bytes at each
level. Their file retention settings differed.

The original driver, inputs, run records and file inventories are retained in
[the measurement archive](https://github.com/Flip-Engineering/baton/tree/archive/baton2/logging-measure-ds-20261007/docs/bend2/measurements).
That archive contains the complete original commit `b22642c1`.

## Results

One turn emitted 15,865,482 bytes across synthetic message updates, cumulative
shell output, real task-tool updates, a real OMP frame window and small protocol
frames. Each cumulative batch used 400 frames; the task batch used 300 frames.

| Output | Retained bytes |
| --- | ---: |
| Release 1.1.0 public log | 11,500,168 |
| Default public log | 63,775 |
| Diagnostic public log | 15,866,505 |

The default log was 99.445% smaller than the release 1.1.0 log for this workload.
The diagnostic log was 248.8 times the default log. Release 1.1.0 already omitted
message-update frames; most of the measured saving came from tool-update frames.

Storage outside the public log remained material: the largest sampled attempt
stdout spool was 15,866,413 bytes. Database files, attempt files, inputs and
public logs together retained 459,835 bytes after the default turn at `351c9aba`.
The public-log reduction does not measure total peak storage.

## Retained provider traces

| Trace | Frames | Input bytes | Retained bytes | Dropped frames |
| --- | ---: | ---: | ---: | ---: |
| OMP window, with an appended terminal | 141 | 69,131 | 16,881 | 128 |
| Codex A | 1,311 | 12,412,768 | 12,412,768 | 0 |
| Codex B | 371 | 2,297,259 | 2,297,259 | 0 |

Both measured revisions retained every frame from these Codex traces at both
logging levels. The OMP result therefore establishes no Codex storage saving.

## Scope

The runner used Bend 2.0.25, Clang 19.1.1, Python 3.12.3 and SQLite 3.45.1 on
Linux x86_64. The workload started one receiver or direct turn per database and
log path. It exercised coordinator logging without contacting a provider.
Wall times were recorded in the original run records; these results measure
retained bytes.

Subsequent terminal compaction changes the OMP default totals above. The output
position repair `27c18e55` changes the original incomplete-turn append behavior.
The archive also contains the historical byte-limit configuration that has been
removed from the current product. Current recovery and logging qualification is
handled by the normal hosted suites.

[The October 8 measurement](../2026-10-08-postchange/README.md) records a real
provider turn after event selection and delta message updates were configured.
