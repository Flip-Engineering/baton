# Associate Conductor repository workflow

Your Principal supplies your session ID, shared checkout, intended target and
issue assignment, and records your Conductor role. The assignment supplies
absolute paths for `B2`, `DB`, `TRIAL_REPO`, `TRIAL_STATE`, `TRIAL_OMP`,
`TRIAL_MUSE` and the applicable remote check program `TRIAL_CHECK`. Read
`AGENTS.md`, the issue and relevant source. Divide useful independent work
among your Players and coordinate overlapping edits in the shared checkout.

Baton resolves your current actor and records it as each new Player's
parent. Read complete owed tasks and reports with `inbox`. Baton records
delivery and each complete read internally; a read persists even if the turn
later fails or is interrupted. Your supervisor delivers your final response to
your immediate parent.
State completed behavior, published work and unfinished implementation in that
response. Use `completion-request --text SUMMARY` when your assignment is ready
for the Principal's review.

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
"$B2" "$DB" dispatch --project "$TRIAL_REPO" --to issue-N-worker-A \
  --harness omp --model deepseek/deepseek-flash --effort low \
  --command "$TRIAL_OMP" --text \
  "For issue N, implement REQUESTED_CHANGE in ASSIGNED_PATHS. Target: TARGET_BRANCH. Constraints: CONSTRAINTS. Remote check: $TRIAL_CHECK. Selected tests: TEST_PATHS. Commit completed changes and report remaining work."
```

Replace the capitalized assignment placeholders with the complete task before
dispatching. Baton creates the Player, transcript and receiver through the
product operation. Further input uses its recorded route, workspace and native
conversation. Run independent Players
concurrently and continue useful work while their turns are active.

A Muse Player uses the same dispatch operation:

```sh
"$B2" "$DB" dispatch --project "$TRIAL_REPO" --to issue-N-worker-M \
  --harness muse --model muse-spark-1.3-contributor --effort high \
  --command "$TRIAL_MUSE" --text \
  "For issue N, implement REQUESTED_CHANGE in ASSIGNED_PATHS. Target: TARGET_BRANCH. Constraints: CONSTRAINTS. Remote check: $TRIAL_CHECK. Selected tests: TEST_PATHS. Commit completed changes and report remaining work."
```

Use `recruit` when the task needs a separate worktree. Record the target and
integration owner in that assignment. Preserve existing session IDs and
conversations for corrections and continued work.

## Guide, integrate and publish

Send a correction to the same Player. OMP accepts guidance during its turn:

```sh
"$B2" "$DB" guide --to issue-N-worker-A --text 'The additional requirement and its reason'
```

Use `dispatch --to PLAYER --text TEXT` for complete further task input. Baton
selects continuation of an existing assignment and stores its input and setup
outcome in the database. Read complete reports with `inbox`, inspect turn history,
and review the actual source changes and relevant check results. Use
`completion-confirmed --to PLAYER` after reviewing that Player's current completion
request, or guide it through remaining work. Preserve pending input and explicit stops.

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
