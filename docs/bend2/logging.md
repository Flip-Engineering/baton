# Coordinator logs

The coordinator writes a public JSONL log for each turn and a separate file for the native process's stderr. `log_files` records public log paths. `log_generations` binds generation paths to turn IDs. `log_stderr_runs` records each unique stderr path for a generation.

## Levels

`baton2 DATABASE logs SESSION` reads the configured level. `baton2 DATABASE logs SESSION LEVEL` sets it. The available levels are `default`, `quiet`, and `diagnostic`.

At `default`, the coordinator retains completed frames and holds the newest `message_update`, `message_start`, and `tool_execution_update` frame for each open identity. A matching end frame either completes or replaces the held state. Turn completion writes any still-open frame. At `quiet`, the coordinator keeps terminal frames and frames whose type is not classified. At `diagnostic`, it keeps every received frame. Received frames with unknown event types remain in the log at every level.

The OMP setup request carries the session level to the provider before `get_state`. At `diagnostic` it requests all event categories with full message updates. At other levels it requests the event categories in the adapter's list (`omp-player.bend`), which omits the `tool_execution_update` progress category, with delta message updates. Protocol and session frames such as `response`, `prompt_result` and `session_settled` are delivered independently of the selection. The provider controls which frames it sends. The turn records frames it receives and records a correlated filter response when one arrives. A refused, mismatched, or missing response does not establish which selection the provider applied. The default request excludes event categories added to later schemas. At default an interrupted tool retains its start frame and unfinished status but can lose its latest partial update; diagnostic requests that detail.

The coordinator writes each retained frame to the generation log. It preserves complete frames, including large frames. The native process writes all stderr bytes to the unique path registered for that run.

### Terminal frames

An OMP terminal frame (`agent_end`, `turn_end`) reaches the public log as a compact projection of the provider envelope at every level except `diagnostic`. The line carries `type`, `compacted`, `eventBytes` (the byte length of the envelope it replaces), `messageCount`, `textCharacters`, `text`, `error` when the provider reported one, `isTerminal` and `yielded` when the envelope carries them, `identifiers.responseIds` and `identifiers.toolCallIds`, and `full`, which names the turn row and the log path. A key whose value the envelope does not carry is absent from the line.

The projection covers the terminal kinds the OMP classification names. A terminal frame from another harness (Codex, Muse, Claude) carries an unclassified kind and is written as received at every level. At `diagnostic` every frame is written verbatim.

`messageCount` counts the object entries the envelope carries across its messages array, its single message and its tool results, so a non-object marker in a messages array does not count. `identifiers.responseIds` lists the assistant entries, the only role that carries a `responseId`. `identifiers.toolCallIds` lists the tool result entries. `textCharacters` counts the extracted assistant text, the same text the `text` key carries, and includes the retained streamed completion when an `agent_end` envelope has an empty messages array. `error` carries the provider diagnostic for a terminal envelope whose last assistant message reports a failed stop reason.

The retained records hold different things. The public log holds this projection. The turns row holds the observed event, with its message and content arrays reduced to object entries. A retained receive keeps the raw frame stream in the attempt `stdout` spool until acknowledgement unlinks it. The provider's own journal holds the provider's raw record.

## Generations and checkpoints

`Logs.attempt_log(BASE, TURN)` names a separate generation file for each turn. A generation path preserves the turn identity and prevents later runs from appending into an earlier run's public log. `OUTPUT_LOG.pending` stores the latest incomplete frames for direct turns. A later turn appends that checkpoint before new frames and removes it after the append succeeds.

Retained observers save their public-output position and completion state in the attempt checkpoint. Reattachment writes at that position, preserves matching bytes already present, and writes new frames as they arrive.

The attempt directory retains native input, output, and process ownership according to its own lifecycle. The log registry tracks public paths and stderr paths; it does not replace provider conversation stores or retained attempt artifacts.

## Storage and cleanup

```
baton2 DATABASE logs-storage
baton2 DATABASE logs-clean SESSION
```

`logs-storage` reports database, root log, public log, historical numbered segment, checkpoint, attempt, and stderr file sizes. Numbered segments from earlier versions remain visible as historical files.

`logs-clean SESSION` removes eligible completed attempt diagnostics and generation logs. Cleanup requires the existing lifecycle evidence: process exit, release, acknowledgement, report, successful exit, no pending input, a verified attempt path, a non-diagnostic level, stderr health `ok` or `legacy`, and at least one diagnostic byte in the attempt. It preserves base logs, numbered historical segments, provider stores, unfinished attempts, and files with incomplete or malformed legacy stderr metadata. Cleanup runs under the session lock.

The policy migration preserves each session's level and every registered log path. Existing byte and segment-count policy columns are discarded during migration; they no longer affect logging.

## Write failures

The supervisor records the first write error for a turn with the log path and stops appending to that log for the rest of the turn. The turn report keeps the native result, and the failure reaches the parent as a native output observation.

When native output reading fails, the supervisor writes the prefix frames it still holds and one `baton_log_interrupted` frame with the count written. These writes are best effort. A failed log receives no further writes.

## Historical measurements

[The 2026-10-06 measurement](measurements/2026-10-06-logging-policy.json) records an earlier policy workload. It remains evidence for the frame-deduplication measurements; its byte and segment settings are historical data.
