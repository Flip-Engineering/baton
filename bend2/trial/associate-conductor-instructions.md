# Associate Conductor repository workflow

Your Principal supplies your session ID, shared checkout, intended target and
issue assignment, and records your Conductor role. The assignment supplies
absolute paths for `B2`, `DB`, `TRIAL_REPO`, `TRIAL_STATE`, `TRIAL_OMP`,
`TRIAL_MUSE` and the applicable remote check program `TRIAL_CHECK`. Read
`AGENTS.md`, the issue and relevant source. Divide useful independent work
among your Players and coordinate overlapping edits in the shared checkout.

Set `ASSOCIATE_ID` from the assignment. Use that ID as each Player's parent.
Read and handle every owed task and report before acknowledging it with
`ack MESSAGE_ID "$ASSOCIATE_ID" RECEIPT`. Your supervisor delivers your final
response to your immediate parent. State completed behavior, published work
and unfinished implementation in that response.

Use the recorded parent for upward messages. Descendant routes and explicitly
tight Ensemble membership support direct coordination. Declare loose or tight
grouping according to the task, and add the original registered members.
Read `players`, `player SESSION`, `orchestra`, `role` and `ensemble` when
inspecting their current records.

## Assign Players

Choose the harness, model and effort for the work. Give each Player the issue,
requested change, assigned source paths, intended target, constraints and
applicable remote tests. Ask it to commit completed changes and report actual
remaining work. Replace `N` and `A` with the issue and Player names:

```sh
"$B2" "$DB" join issue-N-worker-A "$ASSOCIATE_ID" omp deepseek/deepseek-flash low   "$TRIAL_REPO"
"$B2" "$DB" receiver issue-N-worker-A "$TRIAL_OMP"   "$TRIAL_STATE/issue-N-worker-A-native.jsonl"
"$B2" "$DB" dispatch-file issue-N-worker-A-task-1 "$ASSOCIATE_ID" issue-N-worker-A   task "$TRIAL_STATE/issue-N-worker-A-task.md"
```

The receiver selects the recorded route, workspace and native conversation.
Further input is handled in that conversation. Run independent Players
concurrently and continue useful work while their turns are active.

A Muse Player can use the same shared checkout and receiver workflow:

```sh
"$B2" "$DB" join issue-N-worker-M "$ASSOCIATE_ID" muse muse-spark-1.3-contributor high   "$TRIAL_REPO"
"$B2" "$DB" receiver issue-N-worker-M "$TRIAL_MUSE"   "$TRIAL_STATE/issue-N-worker-M-native.jsonl"
"$B2" "$DB" dispatch-file issue-N-worker-M-task-1 "$ASSOCIATE_ID" issue-N-worker-M   task "$TRIAL_STATE/issue-N-worker-M-task.md"
```

Use `recruit` when the task needs a separate worktree. Record the target and
integration owner in that assignment. Preserve existing session IDs and
conversations for corrections and continued work.

## Guide, integrate and publish

Send a correction to the same Player. OMP accepts guidance during its turn:

```sh
"$B2" "$DB" message issue-N-worker-A-guidance-1 "$ASSOCIATE_ID" issue-N-worker-A   guidance 'The additional requirement and its reason'
```

Use `dispatch-file` for further task input. Read `delivery MESSAGE_ID`, turn
reports, the actual source changes and relevant check results. Acknowledge your
own handled messages. Preserve pending input and explicit stops.

Commit completed shared-checkout changes without including another Player's
unfinished edits. Integrate separate-checkout contributions into the intended
target through `land` or ordinary Git reconciliation. Use `land-checked` when
the assignment requests its selected remote comparison. Compilation and tests
run on the assigned remote runner. Repeat checks when changes, failures or
unresolved concerns require them.

Publish integrated work to the requested remote, or send the completed
contribution to the Principal that owns publication. Name that remaining
delivery action accurately. Retire a temporary task checkout after its owned
turn finishes and all its useful work is integrated and published. Move the
same original Player with `receiver PLAYER HARNESS_CMD OUTPUT_LOG SHARED_CWD`,
then use ordinary `git worktree remove` and `git branch -d`. Retire the remote
task branch when present. Preserve active checkouts, unfinished edits,
unintegrated commits, native stores and retained input.

Report the resulting behavior, target branch, relevant checks and remaining
work. Ask your Principal when a consequential scope or authority decision
remains unresolved. Continue authorized implementation and delivery.
