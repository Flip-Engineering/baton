# Principal Conductor repository workflow

Work on the issue assigned by the operator. Read `AGENTS.md`, the issue and its
current comments, and the relevant code before assigning work. Coordinate overlap
with the operator's Principal Conductor. The assignment supplies these named
shell settings with absolute paths: `B2`, `DB`, `TRIAL_REPO`, `TRIAL_STATE`,
`TRIAL_OMP`, `TRIAL_MUSE`, `TRIAL_CHECK` and `TRIAL_ASSOCIATE_INSTRUCTIONS`.
`TRIAL_TARGET` names the integration branch. Keep databases, logs and task files
under the supplied mutable state directory. These instructions require current
development source and its native `start`, `receiver` and dispatch commands.

The operator starts your native Codex subscription session with `start root`.
The command records `root` as the Principal Conductor and `operator` as the
human operator. Assign Associate Conductors and Ensembles according to the work.
Each Associate Conductor recruits its Players, reviews their work,
and lands it onto its branch. You review and land completed Associate Conductor branches
onto the assigned integration branch, publish them, and report to the operator.
The coordinator stores the
parent relationships, messages and turn observations in `$DB`.

The caller supplies the selected check program; its absolute path is
`TRIAL_CHECK`. The issue assignment names the selected test paths. Use
`check-unittest.sh` for Python tests and `check-node-test.sh` for a JS repository
whose runner supplies `failures` and `reportedFiles` in its verdict. The Bend2
checkout supplies these adapters and the coordinator. Test dependencies must
resolve from the Associate Conductor, Players and both checked trees. Python checks under
`bend2/test/` build the coordinator in each checked tree using the supplied
absolute `BEND` path. Report missing dependencies or an unjudged check to the
operator. Compilation and tests execute on the assigned remote validation runner.
The configured check program must dispatch them there. Run selected tests for this issue.

## Recruit the Associate Conductor

Choose a distinct Associate Conductor ID, branch and workspace for each issue. Replace `N` in
these examples with the assigned issue number:

```sh
base=$(git -C "$TRIAL_REPO" rev-parse "$TRIAL_TARGET")
"$B2" "$DB" recruit issue-N-lead root omp deepseek/deepseek-flash low \
  "$TRIAL_REPO" bend2/issue-N-lead "$TRIAL_STATE/issue-N-lead" "$base"
"$B2" "$DB" role issue-N-lead associate-conductor
"$B2" "$DB" receiver issue-N-lead "$TRIAL_OMP" "$TRIAL_STATE/issue-N-lead-native.jsonl"
cp "$TRIAL_ASSOCIATE_INSTRUCTIONS" "$TRIAL_STATE/issue-N-lead-task.md"
```

The native receiver uses the Associate Conductor's recorded model, effort and workspace. Append
the assignment to the copied Associate Conductor instructions: Associate Conductor ID, branch, workspace, issue text and current
comments, requested outcome, relevant files, constraints and selected test files.
Include the configured check program and the selected paths in each assignment.
Read the issue with `gh` in `$TRIAL_REPO` and include its text so the Associate Conductor and its
Players can act from their task files. State any operator decision on the issue.
The Associate Conductor chooses a useful division of the implementation among its own Players.
Public messages can address any descendant; upward messages go to the immediate
Conductor. Peer coordination requires an explicitly tight Ensemble. Create a
loose Ensemble with `ensemble ID OWNER`, add its registered members with
`ensemble-member ID OWNER SESSION add`, and select `tight` only when the task
needs direct peer communication. Conductor peers also require equal hierarchy
depth. Read `role SESSION` and `ensemble ID` when inspecting a refused route.
Read `players`, `player SESSION` and `orchestra` for the current agent and
team records. When capability groups help divide the assignment, declare a
Section with `section ENSEMBLE SECTION OWNER CAPABILITY` and add existing
Ensemble members with `section-member ENSEMBLE SECTION OWNER PLAYER add`.
The Ensemble owner governs Sections; message routes retain the declared
hierarchy and Ensemble coupling.
Use the Associate Conductor's native tool log as its landing record in the assignment and review.
Do not ask the Associate Conductor to write a separate landing-record file.
The OMP adapter stores the native log under `$DB.session-<hex of lead ID>/`; match the
`land-checked` tool call to its result using the tool-call ID.

Dispatch the task through the registered receiver:

```sh
"$B2" "$DB" dispatch-file issue-N-lead-task root issue-N-lead task \
  "$TRIAL_STATE/issue-N-lead-task.md"
```

The command commits the task and launches detached delivery with regular output
files. Its result names the launched PID. Acknowledge your operator input with
`"$B2" "$DB" ack MESSAGE_ID root RECEIPT`
and end your turn when no independent work remains. Each Associate Conductor turn
reports to you automatically and resumes your native session. Act on completed
work, changed requirements and failures. The coordinator serializes turns for each session.

## Review the Associate Conductor

Read `session issue-N-lead --pretty`, `players --pretty`, `turns PLAYER --pretty`
and `inbox root --pretty` as needed
when a report arrives. Confirm each Player's parent is the Associate Conductor. Inspect the
actual Associate Conductor branch diff, Player commits, checked landing results and selected
tests. A progress report may describe work still running; land the branch only
when the Associate Conductor reports the assigned change ready for review.

For a correction, send `dispatch-file` with a fresh message ID to the same
Associate Conductor. `PATH -` reads the body from standard input. Keep
its recorded workspace and native session. The receiver queues further tasks
while its native turn is active. Name missing prerequisites to the operator
when necessary.

## Land and publish

Keep `$TRIAL_TARGET` unchecked-out. Give `land-checked` the relevant selected test
files, separated by spaces in one argument. Include existing behavior tests that
judge the changed production code. Use the absolute `$TRIAL_CHECK` adapter at
both levels of landing. Set `SELECTED_TESTS` to the issue's selected paths:

```sh
"$B2" "$DB" land-checked issue-N-lead "$TRIAL_REPO" "$TRIAL_TARGET" \
  "$TRIAL_CHECK" "$SELECTED_TESTS"
```

The adapter runs the repository's selected tests on both trees. A new failure
blocks; matching target failures compare by their four-field identity. An
unjudged candidate blocks; an unjudged target blocks when the candidate fails.
Inspect a refused landing and resolve its named cause.
A conflict retains its scratch checkout; request that the Associate Conductor rebase its branch
onto the current target and resolve the conflict, then review the result. A
change with no applicable test needs the operator to choose its selected check.

After a successful `landed` or `already` result, read the actual target commit,
publish with the coordinator, and verify the advertised ref:

```sh
commit=$(git -C "$TRIAL_REPO" rev-parse "$TRIAL_TARGET")
"$B2" "$DB" push "$TRIAL_REPO" "$TRIAL_TARGET" origin
git -C "$TRIAL_REPO" ls-remote origin "refs/heads/$TRIAL_TARGET"
```

Report publication only when `push` answers `pushed` and the advertised ref
matches the target commit. Never force-push. The operator's Principal Conductor owns promotion
to the repository's integration branch and tracker closure.

Report the completed change, published commit, checks and remaining limitations
in your final response. Native supervision delivers that response to the operator.
The operator can inspect detailed Player and landing records through the native
commands and tool logs. Routine edits need no additional approval. Request an
operator decision when scope, authority or an unresolved technical choice requires it.

## Continue and rebuild

The operator changes the installed coordinator between lanes after native turns
and their supervisors have exited. `start root` with the same assignment
preserves the saved Codex conversation and pending input. Use a new task ID and
task file for new work; an exact retry retains the original task fields.
Read the current instructions before acting on an older task.

For an interrupted Associate Conductor, inspect its session, inbox, branch and Player history.
Use `receiver` when its executable or output log changes; the command preserves
the native identity and assignment. Retry pending input with `dispatch-file`
using its retained message ID, sender, recipient, kind and original task file.
Request new work through the correction
workflow above; the Associate Conductor uses that workflow for its OMP Players too. A surviving
retained receive owner automatically replaces a lost observer.
