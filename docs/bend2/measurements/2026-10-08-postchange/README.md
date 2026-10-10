# Issue #686 post-change measurement, 2026-10-08

One real provider turn on the live session `logging-measure-ds-20261007`,
measured after the events-array selection and delta message updates reached the
provider request.

## Identity

| Item | Value |
| --- | --- |
| Baton2 package | `/Users/wahargis/.local/share/baton2/releases/development-ceb914218e5edbdcf5d9284f712b94fe6760ac7b/bin/baton2` |
| Provider executable | `.../toolchains/omp-v18.6.0/omp` |
| Turn command | `turn logging-measure-ds-20261007 logging-measure-ds-20261007-postchange-run1 <omp> deepseek/deepseek-flash high /tmp/baton-postchange-src <task> <log>` (`run-command.txt`) |
| Database | `.scratch/baton2-audit-followups-20261004/orchestra.db` |
| Session | `logging-measure-ds-20261007`, harness `omp`, model `deepseek/deepseek-flash`, effort `high` |
| Provider journal | `.scratch/baton2-audit-followups-20261004/orchestra.db.sessions/2026-10-08T02-47-20-893Z_01a11968-7e3d-744c-971c-ca9d5f7672a8.jsonl`, SHA256 `20867874eb07c5de7ddcdc5a78398416d9f81c526930ee7c85df96cb09b91bfe` before the turn (`journal-before.txt`) |
| Turn window | started `2026-10-08T23:27:19Z` (`run-window-start.txt`) |

The task (`post-change-task.md`) is a review of `docs/bend2/logging.md` against
`bend2/src/coordinator/logs.bend` with an explicit instruction to read in several
passes, so the output grows across many tool calls.

## Retained bytes for the turn

| File | Frames | Bytes |
| --- | --- | --- |
| Baton public log (`baton-log-snapshot.jsonl`, 516,030 bytes on disk) | 103 | 515,204 |
| Provider journal | 1084 | 3,244,559 |

Public-log content by frame type (`categories-baton-log.tsv`), largest first:
`message_end` 32 frames / 185,646 bytes, `turn_end` 14 / 180,869,
`tool_execution_end` 17 / 65,479, `response` 3 / 43,924,
`tool_execution_start` 17 / 21,683, `available_commands_update` 1 / 16,983,
`turn_start` 15 / 330, `ready` 1 / 131, `extension_ui_request` 1 / 104,
`advisor_cost_changed` 1 / 32, `agent_start` 1 / 23.

Provider-journal records by type (`categories-provider-journal.tsv`): `message`
680 / 3,031,283 bytes, `custom` 382 / 168,344, `custom_message` 18 / 44,103,
`title` 1 / 256, `session` 1 / 261, `model_change` 1 / 161,
`thinking_level_change` 1 / 151.

Tool frames (`tool-counts.txt`): 15 `tool_execution_start`, 15
`tool_execution_end`, 0 error frames. The two captures were taken at different
moments, so this count and the 17 starts and 17 ends in the categorized snapshot
differ.

The public log retains 515,204 bytes against 3,244,559 provider-journal bytes for
the same turn, 15.9%. No `message_update` frame is retained: the selected events
(`filter-echo.json`) omit `tool_execution_update` and request delta message
updates, and the retained volume is dominated by `message_end` and `turn_end`.

## Limits

- One real turn on one session. It is not a per-batch measurement and has no
  matched before turn, so the ratio above is one observation and not a rate.
- The capture predates the OMP terminal compaction: no retained line carries
  `compacted`, and the `turn_end` lines carry the full provider envelope. These
  bytes therefore measure the level filter alone.
- The paired attempt generation
  (`baton-turn-run1.jsonl.attempt-logging-measure-ds-20261007-postchange-run1`,
  960,581 bytes), the two large JSONL captures and the empty stderr sidecars are
  retained on branch `codex/logging-measure-ds-20261007` and in the measurement
  worktree. Only the small files are copied here; `SHA256SUMS` lists the whole
  original evidence directory with the paths it was written under.
- The planned second turn did not run: the session already had an active native
  turn (`turn-refusal.txt`, `plan-run-refusal-note.txt`).
- The turn used the `development-ceb91421` package rather than an immutable
  qualified package, so it does not satisfy the qualification requirement the
  retired plan stated.

## Retired

`docs/bend2/measurements/post-change-plan.md` (untracked, in the measurement
worktree) is the plan for this measurement and records status "prepared, not
run". Its method is carried by the 2026-10-07 driver and summarizer and by the
counting commands it quoted, and the run it planned is the single turn recorded
above. The plan is retired in favour of this record.
