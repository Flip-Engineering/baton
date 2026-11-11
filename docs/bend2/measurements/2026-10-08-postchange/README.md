# Logging measurement of a provider turn, 2026-10-08

One real DeepSeek Flash turn reviewed the logging documentation and source in
session `logging-measure-ds-20261007`, using OMP 18.6.0 and the
`development-ceb91421` Baton2 package. The recorded window started at
`2026-10-08T23:27:19Z`.

The provider accepted the selected event types and delta message updates, as
recorded in [filter-echo.json](filter-echo.json).

## Results

| Output | Frames | Bytes |
| --- | ---: | ---: |
| Public-log categorized content | 103 | 515,204 |
| Provider-journal records | 1,084 | 3,244,559 |

The public-log content was 15.9% of the provider-journal bytes in this capture.
The public snapshot occupied 516,030 bytes on disk. The category totals are in
[categories-baton-log.tsv](categories-baton-log.tsv) and
[categories-provider-journal.tsv](categories-provider-journal.tsv).

Assistant message completions contributed 185,646 bytes and turn completions
180,869 bytes to the public log. Tool completions contributed 65,479 bytes.
No message-update frame appeared in the categorized public snapshot.

## Scope

This is one observed turn with no matched earlier turn. The captures predate
OMP terminal compaction; their turn-completion frames contain the full provider
envelope. The public and provider snapshots were taken at different moments,
so this ratio is approximate. A separately captured tool count recorded 15
starts and 15 completions; the categorized public snapshot recorded 17 of each.
A planned separate turn was refused while this session already had an active
native turn.

The original captures, attempt output and measurement plan remain in the
measurement worker checkout and in the local source archive at
`.git/baton2-archives/20261009/logging-measure-postchange-untracked-20261009.tar.gz`.
The completed evidence is published in
[`archive/baton2/logging-measure-ds-20261007-postchange`](https://github.com/Flip-Engineering/baton/tree/archive/baton2/logging-measure-ds-20261007-postchange/docs/bend2/measurements/2026-10-08-postchange).

The worker and conductor also checked two retained logs after terminal
compaction. Their `full.turnsRow` references resolve to stored `turns` rows,
and `full.log` references resolve to registered `log_files` paths. The stored
event sizes were 542,161 and 25,598 bytes. Superseded attempts have no row in
`executions`, which stores the current attempt for each session. This check
covers those two logs. The October 7 baseline run's raw log and database were
not retained, and its executable predates terminal compaction.

[The October 7 measurement](../2026-10-07-logging-measurement/README.md) records
controlled workload totals and two retained Codex traces.
