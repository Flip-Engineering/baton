# Baton2 repository workflow

## Installation scope

The released 1.0 installation retains its version-specific interface. The
native controls in this guide (`start`, `receiver`, `dispatch-file`,
`dispatch-turn`, `land-checked`) require the current native-control
development installation.

This trial repository contains no `bend2` scripts. The command guide at
`/Users/wahargis/Development/Experiments/baton-bend2-native-root-final-v2-20261003/bend2/README.md`
and the check adapter at
`/Users/wahargis/Development/Experiments/baton-bend2-native-root-final-v2-20261003/bend2/scripts/check-node-test.sh`
are supplied from that source checkout. The installed executable is
`/Users/wahargis/.local/bin/baton2`. Every command below opens the same
SQLite database, which serializes transactions:

```sh
B2=/Users/wahargis/.local/bin/baton2
DB=/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/.scratch/installed-native-control-factory-v2-20261003/orchestra.db
```

Commands return JSON. `$REPO` is the trial repository path, `$STATE` a
mutable state directory holding native logs.

## Start

`start` configures a native receiver for the Principal and dispatches its
task:

```sh
"$B2" "$DB" start root codex /path/to/codex MODEL EFFORT \
  "$REPO" "$STATE/root-native.jsonl" initial-task /path/to/principal-task.md
"$B2" "$DB" status --pretty
"$B2" "$DB" inbox operator --pretty
```

## Recruit

`recruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE` creates the
branch and worktree, then records the Player under its parent. A relative
`PATH` resolves from `REPO`; the base is stored as a commit ID. A repeated
recruitment with matching fields returns the existing Player; conflicting
fields return `player-assignment-conflict` with exit status 2.

```sh
"$B2" "$DB" recruit lead root omp MODEL EFFORT "$REPO" lead-branch "$STATE/lead-worktree" BASE
"$B2" "$DB" role lead associate-conductor
"$B2" "$DB" recruit worker1 lead omp MODEL EFFORT "$REPO" worker-branch "$STATE/worker1-worktree" lead-branch
```

## Receiver

`receiver SESSION HARNESS_COMMAND OUTPUT_LOG` generates the delivery
endpoint for an existing Codex or OMP session. It resolves executable and
log paths, selects the recorded model, effort and workspace, and preserves
the saved native session identity.

```sh
"$B2" "$DB" receiver lead /path/to/omp "$STATE/lead-native.jsonl"
"$B2" "$DB" receiver worker1 /path/to/omp "$STATE/worker1-native.jsonl"
```

## Dispatch

`dispatch-file ID SENDER RECIPIENT KIND PATH` commits an authorized message
and launches its delivery. `dispatch-turn PLAYER TURN_ID HARNESS_COMMAND
OUTPUT_LOG TASK_FILE` launches a recruited Muse or Claude Player with its
recorded assignment. Each result names a launched native delivery PID.
Completion is observed through `inbox`, `turns` and the native output
logs.

```sh
"$B2" "$DB" dispatch-file worker1-task-1 lead worker1 task /path/to/worker1-task.md
"$B2" "$DB" dispatch-file hierarchy-initial root lead task /path/to/lead-task.md
"$B2" "$DB" dispatch-turn muse-player muse-turn-1 /path/to/muse \
  "$STATE/muse-native.jsonl" /path/to/muse-task.md
```

A correction to a Codex or OMP Player sends another `dispatch-file` with
a fresh message ID and task file to the same Player; receive resumes its
stored native conversation and appends to its native log. A receiver that
finds an active turn returns `queued`; newly pending work starts after
native exit. Independent dispatches run concurrently; the coordinator
serializes native turns per session.

## Report and ACK

Native result events create pending parent reports. Read the full body from
the database; harness tool display can truncate long strings. `session`
reads the stored native session ID for resuming the same conversation in a
later turn.

```sh
"$B2" "$DB" inbox lead --pretty
"$B2" "$DB" turns worker1 --pretty
"$B2" "$DB" delivery REPORT_ID --pretty
"$B2" "$DB" session worker1
```

Review each report against the actual diff and the check output, then record
acceptance:

```sh
"$B2" "$DB" ack REPORT_ID lead NATIVE_ACCEPTANCE_RECEIPT
```

Reports remain pending until the recipient acknowledges them. A failed
native turn leaves unacknowledged messages pending.

## Checked landing

```sh
"$B2" "$DB" land-checked worker1 "$REPO" TARGET_BRANCH CHECK "FILES"
```

`land-checked` prepares a squashed candidate in a scratch worktree, runs the
selected checks on the candidate tree and on a tree at the target tip, and
blocks on candidate failures the target run does not show. The answer is
JSON with a `status` field: `landed` with the new target commit, `already`
when the target contains the Player commit, `conflict` naming unmerged
paths, or `blocked` with a reason. A moved target returns `blocked` naming
`land-checked` as the retry; the retry checks the new candidate and target
before advancing the branch.

### CHECK and FILES

CHECK runs as `/bin/sh CHECK FILE` inside each checked tree, once per
selected file per tree: one invocation per file for the candidate tree and
one per file for the target-tip tree. FILES is the space-separated
selection, passed as one argument.

`check-node-test.sh` adapts one JS suite verdict to the gate's identity
lines. It runs `impl/scripts/run-suite.mjs` against the selected file under
`impl/test/`, with the verdict path supplied through
`BATON_SUITE_VERDICT_FILE`. It requires the verdict document to carry typed
`failures` and `reportedFiles` arrays. A missing verdict file, an unreadable
verdict, or a verdict without those fields is unjudged. A selection outside
`impl/test/`, a missing selected file, a selection absent from
`reportedFiles`, or a selection the runner lists as skipped is rejected as
not judged. Failure rows must name the selected file, the test name and the
failure type; each failing case prints one identity line of four hex-encoded
fields (file, test id, failure kind, failure type). A runner that ends
without a passing verdict and without failure identities is unjudged. An
unjudged candidate run blocks the landing; an unjudged target run blocks
when its candidate run fails.

## Conductor workflow

The landing target branch stays unchecked out in every worktree. An
Associate Conductor detaches its own checkout HEAD before a child landing
advances its branch. The Associate Conductor recruits children with itself
as parent, reviews their reports, and lands their branches onto its own
branch; the Principal then reviews and lands the Associate Conductor branch
through the same landing command.

Receiver admission supports Codex and OMP sessions; Muse and Claude
Players are launched with `dispatch-turn`. A follow-up to a Muse or
Claude Player sends a fresh `dispatch-turn` turn ID and task after the
prior direct turn completes. `dispatch-turn` selects the Player's
recorded native identity automatically; its callers pass no identity
argument. When a resumed attempt exits without a terminal event and its
stderr records a refused conversation, receive retains the task and a
recovery notice with the workspace Git status, clears the refused native
identity, and starts a fresh attempt. Dispatch returns the launched
delivery PID. Completion is observed through `inbox`, `turns` and the
output logs. The parent ends its native turn after independent dispatch
so that incoming child reports resume the parent's saved conversation.
Each report is reviewed against the actual diff and the check output,
then acknowledged with `ack`.

## Assignment boundary

This assignment ends at the local checked landing. An external Root owns
publication of the landed target.
