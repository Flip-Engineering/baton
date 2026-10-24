# Receive messages for a Codex Player

This example assumes `worker` is registered with the `codex` harness and has
recorded model, effort, and workspace values. Current development source uses
the native controls below. First follow
[Codex subscription login](harness-setup.md#codex-subscription-login) to verify
the existing ChatGPT login. Its native Codex adapter removes `OPENAI_API_KEY`
and `CODEX_API_KEY` and forces ChatGPT login for new and resumed turns. Replace
the path placeholders with absolute paths to the coordinator, database and native
Codex executable. The recorded parent supplies the complete task text:

```sh
BATON=/path/to/baton2
DATABASE=/path/to/state.db
CODEX_NATIVE=/absolute/path/to/codex
PARENT=lead

BATON_SESSION="$PARENT" "$BATON" "$DATABASE" dispatch --to worker \
  --command "$CODEX_NATIVE" --text 'Review the assigned source and report the result.'
```

`dispatch` uses the recorded model, effort, workspace and saved native identity.
Its command option registers the receiver and selects a native output log.
An existing model Git registry selects the installed Node identity helper
automatically. The complete task text, setup outcome and message are stored in
the database. `dispatch --stdin` accepts complete standard input. The returned
inspection commands read the stored request and recipient state.
Receive supplies pending messages to the native turn and forwards its final
assistant text to the parent.

The immutable 1.0 archive requires its
[released subscription wrapper](harness-setup.md#released-10-launch-requirement)
as `HARNESS_CMD` for the lower-level
`receive SESSION HARNESS_CMD MODEL EFFORT CWD OUTPUT_LOG MESSAGE_ID` command.
Its interface and qualification retain that version's source scope.

Within the Player turn, read complete pending messages through the recorded
launch context:

```sh
"$BATON" "$DATABASE" inbox
```

`inbox` returns unread messages in sequence order. Baton records each complete
owned read internally; the read record persists when the turn later fails or is
interrupted.

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
the read is recorded internally. The active receive checks for
unread input beyond its original inbox cutoff when finishing the turn.

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
