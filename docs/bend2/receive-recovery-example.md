# Receive messages for a Codex Player

This example assumes `worker` is registered with the `codex` harness and has
recorded model, effort, and workspace values. Current development source uses
the native controls below. First follow
[Codex subscription login](harness-setup.md#codex-subscription-login) to verify
the existing ChatGPT login. Its native Codex adapter removes `OPENAI_API_KEY`
and `CODEX_API_KEY` and forces ChatGPT login for new and resumed turns. Replace
the path placeholders with absolute paths to the coordinator, database, native
Codex executable, output log and task file. Set the task's sender and ID to
their retained values when retrying pending input.

```sh
BATON=/path/to/baton2
DATABASE=/path/to/state.db
CODEX_NATIVE=/absolute/path/to/codex
OUTPUT_LOG=/path/to/worker-output.jsonl
PARENT=lead
TASK_ID=worker-task-1
TASK_FILE=/path/to/worker-task.md

"$BATON" "$DATABASE" receiver worker "$CODEX_NATIVE" "$OUTPUT_LOG"
"$BATON" "$DATABASE" inbox worker --pretty
"$BATON" "$DATABASE" dispatch-file "$TASK_ID" "$PARENT" worker task "$TASK_FILE"
```

`receiver` generates the endpoint with the recorded model, effort, workspace
and saved native identity. An existing model Git registry selects the installed
Node identity helper automatically. `dispatch-file` commits the task and starts
detached delivery through that endpoint. It returns the launched delivery PID.
Receive supplies pending messages to the native turn and forwards its final
assistant text to the parent.

The immutable 1.0 archive requires its
[released subscription wrapper](harness-setup.md#released-10-launch-requirement)
as `HARNESS_CMD` for the lower-level
`receive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID` command.
Its interface and qualification retain that version's source scope.

Within the Player turn, inspect pending messages and acknowledge each message
after accepting it. Replace `MESSAGE_ID` with the ID from the inbox and use a
receipt describing acceptance:

```sh
"$BATON" "$DATABASE" inbox worker --pretty
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

## Contributor note: released 1.0 observer recovery

The implementation details below describe the observer-loss path at released
source `ea514a28e080317b223414af9a2327a6b53384e6`. The
[recovery qualification](native-recovery-qualification-2026-10-02/README.md)
records the selected process-loss measurements and their boundaries.

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
