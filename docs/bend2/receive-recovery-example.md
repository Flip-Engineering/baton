# Receive messages for a Codex Player

This example assumes `worker` is registered with the `codex` harness and has
recorded model, effort, and workspace values. First follow
[Codex subscription login](harness-setup.md#codex-subscription-login) to verify
the existing ChatGPT login and create an executable launch wrapper at a retained
absolute path. The wrapper unsets `OPENAI_API_KEY` and `CODEX_API_KEY` and forces
ChatGPT login. Use that wrapper as the harness command for this receive and
registered Codex endpoints. Replace the path placeholders with absolute paths
to the coordinator, database, subscription wrapper and output log.

```sh
BATON=/path/to/baton2
DATABASE=/path/to/state.db
CODEX_WRAPPER=/absolute/path/to/codex-chatgpt-wrapper
OUTPUT_LOG=/path/to/worker-output.jsonl

"$BATON" "$DATABASE" inbox worker
"$BATON" "$DATABASE" receive worker "$CODEX_WRAPPER" '' '' '' "$OUTPUT_LOG" ''
```

`receive` accepts `SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID`.
The three empty arguments use the recorded model, effort, and workspace.
The final empty argument reads the pending inbox. Receive supplies pending
messages to the native turn and forwards its final assistant text to the parent.

Within the Player turn, inspect pending messages and acknowledge each message
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

## Contributor note: busy receive and observer recovery

When the session lock is busy, `acquired` in
`bend2/src/coordinator/receive.bend` returns successfully with
`{"session":"worker","status":"queued"}`. This reports lock contention;
message acceptance is recorded by `ack`. The active receive checks for
unacknowledged input beyond its original inbox cutoff when finishing the turn.

For retained Codex and OMP receive attempts, the keeper's `br_disconnected`
function in `bend2/src/host/process-spawn.c` starts the saved recovery command
when its observer disconnects before completion acknowledgment.
`bend2/src/coordinator/main.bend` dispatches `--recover-receive` to `recover`
in `bend2/src/coordinator/receive.bend`, preserving the attempt directory,
turn ID, and inbox cutoff. `ProcessChild.attach` reconnects to the keeper;
`retained_output` in `bend2/src/coordinator/turn.bend` reads the retained
output from its first frame to reconstruct completion. The native process
and its initial prompt remain owned by the existing retained attempt.

This recovery covers observer loss while the retained keeper and attempt
remain available. It requires the keeper's control endpoint and retained
files to be accessible. Keeper loss and host restart are outside this
implemented recovery scope. Refusal to resume a recorded native conversation
uses the separate `restart_pending` path in `receive.bend`, which records
recovery input and starts a fresh conversation.
