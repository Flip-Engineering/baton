# Coordinator log policy

This document describes the files the coordinator writes during a native turn,
which of them Baton2 owns, and the commands that inspect and reclaim their
space. `bend2/src/coordinator/logs.bend` implements the policy and
`bend2/src/coordinator/turn.bend` applies it to each native frame.

## Producers and ownership

| Path | Writer | Owner |
| --- | --- | --- |
| `OUTPUT_LOG` | the turn or receive supervisor, one JSON frame per line | Baton2 |
| `OUTPUT_LOG.stderr` | the native process's stderr file | Baton2 |
| `<database>.root.log` | each successful message delivery | Baton2 |
| `<database>.dispatch-*` | a detached coordinator delivery | Baton2 |
| `<database>.attempt-*/` | the retained keeper: `stdout`, `native.stderr`, `observer.log`, `keeper.log`, `manifest`, and the release and acknowledgement markers | Baton2 |
| `<database>` | sessions, messages, turns, executions and the log policy | Baton2 |
| `<database>.sessions`, `<database>.root-sessions`, `<database>.session-<hex>` | the OMP provider conversation store | provider |
| Codex, Claude and Muse conversation stores | those harnesses | provider |

The coordinator writes the public log, its stderr file and the coordinator's own
records. Rotation and cleanup address only the logs the `log_files` registry
names for a session, so a provider conversation store, a retained attempt
directory, a checkpoint worktree and a harness history outside that registry
keep their contents.

## Retention levels

`logs SESSION` reads the effective policy. `logs SESSION LEVEL [BUDGET_BYTES
[KEEP_SEGMENTS]]` stores one; omitted values keep the stored value.

| Level | Frames the public log receives |
| --- | --- |
| `default` | Every frame the classification names, except the cumulative snapshots `message_update` and `tool_execution_update`. The newest `tool_execution_update` of each open `toolCallId` and the newest `message_start` of each message identity are held in memory. A held update is written immediately before its `tool_execution_end`; a held `message_start` is dropped when its `message_end` arrives. At the end of the turn, everything still held is written. |
| `quiet` | Terminal frames (`agent_end`, `result`, `turn_end`) and every frame the classification does not name. |
| `diagnostic` | Every frame verbatim. |

A frame whose JSON `type` is outside the classification keeps its own line at
every level. The classification covers the OMP frame vocabulary
(`message_update`, `tool_execution_update`, `response`, `message_end`,
`tool_execution_start`, `tool_execution_end`, `agent_end`,
`extension_ui_request`); a Codex, Muse or Claude frame therefore keeps its
default record until its types are classified.

The held frames are what an interrupted turn keeps. A turn that exits during a
long tool call writes the last observed partial result of that call, and the
`tool_execution_end` that never arrived is not invented. `message_update`
frames are not held: after the issue #662 `set_event_filter` request the server
sends per-delta frames, `message_end` carries the complete message, and a
`message_update` frame alone carries no completed message.

## Rotation

`budget_bytes` bounds each public log. Before a frame is written, the
coordinator reads the file size. At the budget the numbered segments shift one
position up, the replacement of the highest one included, and the live log then
takes the name `<log>.1` and opens with one `baton_log_rotation` frame naming
the level, the budget and the numbered segments that held a file when the
rotation ran. The live log moves exactly once per rotation.
A budget admits 65536 bytes or more, which holds at least one
observed frame: a measured OMP seat wrote 47 KB per retained frame, and a
budget below one frame rotates on every append. The upper bound is the U32
representation. `keep_segments` admits 1 to 4 segments today: the shift is one
explicit rename chain per admitted count, because the language's termination
checker requires a structurally decreasing argument and a numbered shift cannot
recurse on a counter. That bound is temporary and its measurement is owed; a
directory-listing effect would let the segment probe and the shift walk the
segments that exist, which removes the bound and the unrolled chain together.
A reader following the
log by path reopens it after a change of
name. Each step is one `rename`, so a concurrent reader sees either the old or
the new name for each segment.

A session with unacknowledged input rotates nothing. The shift overwrites the
oldest numbered segment whether or not the unlink ran, so a rotation that would
drop it is skipped and the live log records
`{"type":"baton_log_rotation","skipped":"pending-input",...}` while it keeps
growing. Answering the input lets the next turn rotate. For every other session
the oldest segment leaves the count: a retained receive keeps the same frames in
its attempt directory, every report and terminal frame is in the database, and
the note names the numbered segments that held a file when the rotation ran, so
a rename whose source was already gone is visible. A step that fails stops the
chain: the remaining segments stay where they are, the frame the step was
rotating for is still appended, and each append that could not rotate writes one
`baton_log_rotation` frame with `"failed":true` naming the error. Appends
continue after a failed rotation; an append that fails itself stops that log for
the rest of the turn.

The defaults are 32 MiB and two retained segments. A measured OMP seat wrote
47 KB per retained frame and one live log reached 773 MB, of which 95.8% of
bytes were `tool_execution_update` snapshots. The budget bounds one log at
three segments and the retained segments keep the frames that preceded the
current one.

## Storage inspection and cleanup

```
baton2 DATABASE logs-storage
baton2 DATABASE logs-clean SESSION
```

`logs-storage` reads and writes no file of its own. Its answer names the
database and root-log sizes, the defaults, one entry per registered public log
with its live size, its stderr size and its numbered segments, and one entry
per attempt directory with the sizes of its `stdout`, `native.stderr`,
`observer.log` and `keeper.log`, its retained byte total, and its release and
acknowledgement markers. A segment the session's `keep_segments` no longer
covers is marked `"eligible": true`.

`logs-clean SESSION` removes the segments marked eligible for that session and
answers with each removed path, its index and its size. It reads the same
eligibility rule `logs-storage` reports. The live log, `OUTPUT_LOG.stderr`,
attempt directories, pending messages and provider stores stay untouched. A
session with unacknowledged input removes nothing and its answer names
`"skipped":"pending-input"` and the pending count. A session with no registered
log answers with an empty removal list.

## Write failures

The supervisor records the first write error of a turn once, with the log path
and the size the log held when the write was attempted, and stops appending to
that log for the rest of the turn. The turn's report keeps the native result,
and the failure reaches the parent as a native output observation. A delivery
whose `<database>.root.log` record cannot be written answers with a failure
that names the delivery log; the endpoint has already run and the recipient's
inbox holds the message.

A turn whose native output read fails writes the prefix frames it still holds
and then one `baton_log_interrupted` frame naming how many it wrote, so the
partial output is in the log and its interruption is named. Both writes are
best effort: a log that already failed takes neither.

## Measurement

`python3 bend2/scripts/measure-omp-stream.py --exe EXECUTABLE --output
DIRECTORY` starts a provider-free OMP receiver and measures the bytes each
frame batch contributes to the retained log. The batches are `small` and
`cumulative` `message_update` frames, `tool` `tool_execution_update` frames,
and a `raw` batch that fixes the retention semantics of frames that name
`message_update` in unusual ways. The
[2026-10-06 measurement](measurements/2026-10-06-logging-policy.json) records
26,164,652 retained bytes before the policy and 112 after it on the same
`tool_execution_update` workload.

## Open work

A held prefix frame lives in the coordinator's memory until the frame that
closes its call arrives or the turn reaches the end of its output. A
coordinator killed before that point writes no held frame. A retained receive
keeps the raw stream in its attempt directory, which holds the same frames; a
direct turn loses the last partial update of every call it had open.

A receive that attaches to a retained attempt reads the attempt from its first
frame and appends each retained frame to the public log again. Rotation bounds
the result, and a lossless reconstruction watermark remains unqualified.

The provider's `set_event_filter` accepts `events` and `messageUpdates` alone,
so the reduction of intermediate tool output is the coordinator's own. The
`events` array can name the categories the server sends; the complete event
vocabulary, the interaction with the confirmation rule that requires an echoed
`events: null`, and the raw terminal evidence of issues #669 and #670 remain
open.

`<log>.stderr` rotates with no bound: the native process holds the descriptor
the keeper opened, so a rotation rule for it requires a change at that
boundary.
