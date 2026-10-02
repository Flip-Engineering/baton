# Receive messages for a Codex worker

This example assumes `worker` is registered with the `codex` harness and has
recorded model, effort, and workspace values. Replace the path placeholders
with absolute paths to the existing executable, database, Codex executable,
and output log.

```sh
BATON=/path/to/baton2
DATABASE=/path/to/state.db
CODEX=/path/to/codex
OUTPUT_LOG=/path/to/worker-output.jsonl

"$BATON" "$DATABASE" inbox worker
"$BATON" "$DATABASE" receive worker "$CODEX" '' '' '' "$OUTPUT_LOG" ''
```

`receive` accepts `SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID`.
The three empty arguments use the recorded model, effort, and workspace.
The final empty argument reads the pending inbox. Receive supplies pending
messages to the native turn and forwards its final assistant text to the parent.

Within the worker turn, inspect pending messages and acknowledge each message
after accepting it. Replace `MESSAGE_ID` with the ID from the inbox and use a
receipt describing acceptance:

```sh
"$BATON" "$DATABASE" inbox worker
"$BATON" "$DATABASE" ack MESSAGE_ID worker 'accepted for this turn'
```

`inbox` returns unacknowledged messages in sequence order. `ack` accepts
`ID RECIPIENT NATIVE_RECEIPT` and preserves the first recorded receipt.

If the receive observer exits, the retained process keeper invokes recovery
with the original attempt and inbox cutoff. Recovery attaches to that attempt
and continues reading its output. If the recorded native conversation cannot
be resumed, receive records recovery input and continues pending input in a
fresh conversation using the current workspace state.

Command argument order is defined in `bend2/src/coordinator/commands.bend`;
dispatch and receive behavior are defined in `main.bend` and `receive.bend`
in the same directory.
