# Player assignment recovery

This example shows the Associate Conductor steps for a refused Player assignment. The refused
recruitment preserves the stored Player row, the Player workspace files, the
native binding, the endpoint, observations, and pending input. The Associate Conductor inspects
the stored assignment, retries it exactly, or recruits a different assignment
through the supported recruitment flow.

The recruitment and endpoint behavior below is specified in
[recruit-conflict-2026-10-02.md](../recruit-conflict-2026-10-02.md) and
[connect-admission-2026-10-02.md](../connect-admission-2026-10-02.md). The Associate Conductor
recruitment pattern is specified in
[associate-conductor-instructions.md](../../../bend2/trial/associate-conductor-instructions.md).
The native `receiver`, `dispatch-file` and `--pretty` examples require current
development source; the immutable 1.0 archive retains its version-specific interface.

## Declared assignment

The Associate Conductor declares the full assignment at recruitment: Player ID, parent session,
harness, model, effort, repository, branch, workspace path, and base commit.
The Player ID in this example is `issue-4-worker-a` and the parent is the Associate Conductor
session `lead-1`:

```sh
base=$(git -C "$REPO" rev-parse "$LEAD_BRANCH")
"$B2" "$DB" recruit issue-4-worker-a "$LEAD_ID" omp deepseek/deepseek-flash low \
  "$REPO" bend2/issue-4-worker-a "$REPO-work/issue-4-worker-a" "$base"
```

The stored assignment fields are `parent`, `harness`, `model`, `effort`,
`workspace`, `branch`, and `base`. The comparison function is
`Commands.player_matches` in
[commands.bend](../../../bend2/src/coordinator/commands.bend), and the stored
row construction is `Commands.player_sql` in the same file. The worktree
creation and registration flow is `recruit` in
[recruit.bend](../../../bend2/src/coordinator/recruit.bend).

## Refused assignment

A second `recruit` call with the same Player ID and any differing assignment
field returns the `player-assignment-conflict` error with exit status 2. The
error names the session ID, the stored (`existing`) assignment, the requested
assignment, and the recovery instruction. The classifier is `Store.committed`
in [store.bend](../../../bend2/src/coordinator/store.bend), which returns the
refusal before endpoint delivery. The behavior checks are
[recruit.py](../../../bend2/test/recruit.py).

The refusal preserves the stored row, the registered worktree and branch refs,
committed and uncommitted workspace files, untracked workspace files, the
native identity, the endpoint, observations, and pending input. No new branch
or workspace path is created for the refused request. Stored assignment changes
require the supported recruitment flow described below. The stored Player
remains available for its parent.

## Inspection

Read the stored session and the stored worktree before deciding:

```sh
"$B2" "$DB" session issue-4-worker-a --pretty
"$B2" "$DB" worktree issue-4-worker-a
```

`session` returns the stored assignment, native identity, endpoint, workspace,
branch, and base. `worktree` returns the workspace status, branch, commit, and
dirty flag.

## Exact retry of the stored assignment

Read the stored assignment and pass its fields back unchanged. A recomputed
base from the Associate Conductor branch is not the stored base when the branch has advanced,
and that call raises `player-assignment-conflict`. Read the stored fields
from the `session` output:

```sh
"$B2" "$DB" session issue-4-worker-a --pretty
```

Set `STORED_PARENT`, `STORED_HARNESS`, `STORED_MODEL`, `STORED_EFFORT`,
`STORED_BRANCH`, `STORED_WORKSPACE` and `STORED_BASE` to those field values,
including the original commit in `base`. Then retry with `REPO` naming the
same repository:

```sh
"$B2" "$DB" recruit issue-4-worker-a "$STORED_PARENT" "$STORED_HARNESS" \
  "$STORED_MODEL" "$STORED_EFFORT" "$REPO" "$STORED_BRANCH" \
  "$STORED_WORKSPACE" "$STORED_BASE"
```

This is the exact retry: every assignment field, including `base`, equals the
stored row. The call succeeds and returns the stored session row. The retry
leaves the database, native binding, pending input, and Git work unchanged.

## New assignment

A different assignment requires a new Player ID with a new branch and an
unused workspace path. The stored Player keeps its work and remains assigned
to its parent:

```sh
base=$(git -C "$REPO" rev-parse "$LEAD_BRANCH")
"$B2" "$DB" recruit issue-4-worker-b "$LEAD_ID" omp deepseek/deepseek-flash low \
  "$REPO" bend2/issue-4-worker-b "$REPO-work/issue-4-worker-b" "$base"
```

## Native receiver and endpoint argument boundary

For a Codex or OMP session, configure the receiver through the native command.
Set `OMP_NATIVE` and `LEAD_LOG` to absolute executable and output-log paths:

```sh
"$B2" "$DB" receiver lead-1 "$OMP_NATIVE" "$LEAD_LOG"
```

`receiver` builds the endpoint from the selected coordinator and the session's
recorded model, effort and workspace. It preserves the saved native identity.
Its implementation is in
[control.bend](../../../bend2/src/coordinator/control.bend).

`connect` takes three arguments: session ID, native ID, and the JSON argv
array itself as one `ENDPOINT` argument:

```sh
"$B2" "$DB" connect lead-1 native-1 "$ENDPOINT"
```

Passing a filename that contains the JSON returns the `invalid-endpoint` error
with exit status 2. The filename refusal preserves the previous native
identity, endpoint, and pending input. The admission predicate is
`Commands.endpoint_admitted` in
[commands.bend](../../../bend2/src/coordinator/commands.bend), and the checks
are [connect.py](../../../bend2/test/connect.py).

`connect` is the lower-level endpoint registration command. The native
`receiver` command supplies the correctly encoded argv for Codex and OMP.
After configuring a valid receiver, retry the retained task with its original
message fields and task file:

```sh
"$B2" "$DB" dispatch-file retained-task "$PARENT_ID" lead-1 task "$TASK_FILE"
```

A repeated message ID with identical sender, recipient, kind, and body preserves
the original message fields and returns the stored message with its current
receipt. `Commands.matching_message_result` in
[commands.bend](../../../bend2/src/coordinator/commands.bend) selects the
stored row with its current receipt, so the same message reads with receipt
null before acknowledgment and with receipt `accepted` after it. A repeated ID
with different input fails the transaction. An accepted retry causes no second
endpoint invocation: the endpoint log still holds one delivery line.

## Acknowledgment and accepted retry

The retained task is addressed to `lead-1`. The Associate Conductor acknowledges the
accepted input as the message recipient:

```sh
"$B2" "$DB" ack retained-task lead-1 accepted
```

`ack` records the receipt for the message ID and recipient pair and keeps the
first receipt. The acknowledgment establishes that the recipient accepted the
input. The accepted retry establishes that the original message was delivered
through the preserved endpoint: the endpoint log holds one delivery line, the
delivery row carries the `accepted` receipt, and the recipient inbox no longer
lists the message.

An empty endpoint disconnects delivery. A well-formed endpoint can still name
an unavailable executable; delivery then fails and the input stays pending.
The caller inspects `session ID --pretty` and `inbox ID --pretty`, configures a
valid receiver, and retries the retained message ID.

The local CLI records the endpoint, message, and receipt rows. Native process
custody follows the receiver and observer rules in
[associate-conductor-instructions.md](../../../bend2/trial/associate-conductor-instructions.md).
