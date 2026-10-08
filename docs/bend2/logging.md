# Coordinator logs

The coordinator appends native provider frames to each registered public log. It records native stderr, incomplete-frame checkpoints, delivery output, and retained-attempt files under their existing owners.

## Log levels

`logs SESSION` reads a session's effective level. `logs SESSION LEVEL` stores `quiet`, `default`, or `diagnostic`.

| Level | Frames written to the public log |
| --- | --- |
| `default` | Complete frames, plus the newest incomplete `tool_execution_update`, `message_start`, and `message_update` for each open identity. A completing frame supersedes its held prefix. Turn completion writes remaining prefixes. |
| `quiet` | Terminal frames (`agent_end`, `result`, `turn_end`) and frames outside the coordinator's classification. |
| `diagnostic` | Every frame verbatim. |

An unclassified frame is written at every level. The current classification covers the OMP frame vocabulary. Codex, Muse, and Claude frames remain unclassified and are written as received.

A direct turn writes incomplete prefixes to `OUTPUT_LOG.pending`. It syncs the replacement before publishing the name. A later turn appends that checkpoint before its new frames and removes the checkpoint after the append succeeds. Retained receive attempts keep their raw streams in the attempt directory through acknowledgement.

Public logs and their stderr files are append-only. `logs-storage` reports their current sizes. The operating system reports allocation and write failures with their causes; the supervisor records the first failed write for each turn and stops writing that log for the rest of the turn.

## Storage inspection and cleanup

```text
baton2 DATABASE logs-storage
baton2 DATABASE logs-clean SESSION
```

`logs-storage` initializes or migrates the policy schema and reports the database and root-log sizes, the effective level, each registered public log with its current size, stderr size, and checkpoint path and size, and retained attempts with their stream sizes and release, acknowledgement, and report state.

`logs-clean SESSION` removes only attempt diagnostics eligible under the existing lifecycle rules: native exit, release, acknowledgement, a durable report, no unanswered input, a verified attempt path, and at least one diagnostic file. Diagnostic-level attempts remain available. Cleanup holds the session lock while checking eligibility and removing registered attempt files. A live turn causes `session-busy`; unanswered input causes `pending-input`.

The registered public logs, their stderr files, checkpoints, database records, and provider conversation stores remain available after attempt cleanup. Old policy schemas migrate to the level-only schema while preserving stored levels and registered log paths.

## Output failures

A failed write records the log path and its size when the write was attempted. The turn report retains the native result, and the failure reaches the parent as a native output observation. A delivery whose root-log record cannot be written reports the delivery-log failure while the recipient inbox retains the message.

If a native output read fails, the supervisor writes any held prefix frames and an interruption frame as best effort. The turn outcome records the read failure.

## Open work

A receive that attaches to a retained attempt appends its retained frames to the public log again. Lossless reconstruction remains unqualified.

The provider's `set_event_filter` currently accepts `events` and `messageUpdates`. Its complete event vocabulary, the confirmation rule that requires an echoed `events: null`, and the raw terminal evidence of issues #669 and #670 remain open.
