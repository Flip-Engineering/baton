# Principal Conductor repository workflow

Work on the issue assigned by the operator. Read `AGENTS.md`, the issue, its
current comments and the relevant source. Coordinate overlapping edits with the
other Conductors. The assignment supplies absolute paths for `B2`, `DB`,
`TRIAL_REPO`, `TRIAL_STATE`, `TRIAL_OMP`, `TRIAL_MUSE`, `TRIAL_CHECK` and
`TRIAL_ASSOCIATE_INSTRUCTIONS`. `TRIAL_REPO` is the shared checkout of the
integration branch named by `TRIAL_TARGET`. Store mutable runtime state under
`TRIAL_STATE`. Dispatch complete assignments as text or stdin; Baton stores the
input and setup outcome in `DB`.

The operator starts your native session with `dispatch`. The coordinator
records the Principal and operator roles, assignments, native identities,
messages and turn reports in `DB`. Assign Associate Conductors, Players and
Ensembles according to the work. Coordinate source ownership in the shared
checkout. Review completed changes, integrate them into `TRIAL_TARGET`, publish
that branch and report remaining work.

## Assign an Associate Conductor

Choose a session ID and use the shared checkout. Replace `N` with the issue
number:

```sh
"$B2" "$DB" join --session issue-N-lead --harness omp \
  --model deepseek/deepseek-flash --effort low --path "$TRIAL_REPO"
"$B2" "$DB" role --session issue-N-lead --role associate-conductor
```

Kimi K3 uses `omp kimi-code/k3 high`. Select the model and effort for the work.
Supply the shared checkout, intended target, issue text, requested outcome,
assigned paths and relevant constraints in the complete dispatch text. Include
the standing Associate Conductor instructions and selected remote check program
and tests when they apply. The Associate Conductor coordinates its Players and
commits completed changes. The current actor is recorded as its parent.

Use `ensemble ID OWNER` for loose grouping or `ensemble ID OWNER tight` for
direct peer coordination. Add members with `ensemble-member`. Public routes
follow the recorded parent relationships and Ensemble coupling. Sections can
group capabilities within an Ensemble. Read `players`, `player SESSION` and
`orchestra` to inspect those records.

Dispatch the task:

```sh
"$B2" "$DB" dispatch --project "$TRIAL_REPO" --to issue-N-lead \
  --command "$TRIAL_OMP" --text \
  "Read $TRIAL_ASSOCIATE_INSTRUCTIONS. For issue N, implement REQUESTED_CHANGE in ASSIGNED_PATHS. Integrate into $TRIAL_TARGET. Constraints: CONSTRAINTS. Remote check: $TRIAL_CHECK. Selected tests: TEST_PATHS."
```

Replace the capitalized assignment placeholders before dispatching. The command
configures the receiver and transcript, stores complete input and setup results,
and returns the recorded session state.
Use `task-input-read --current` in the selected actor context to inspect its latest
dispatch. Read complete owed messages with `inbox`. Baton records delivery
and each complete read internally; a read persists even if the turn later fails
or is interrupted. Pending
input and explicit stops remain recorded. Each Associate Conductor response is
delivered to its parent through the registered receiver.

## Review and publish

Read the actual changes, completed commits, turn reports and applicable remote
check results. Continue independent work while Players are active. A report
must identify the intended target and unfinished work. Request corrections from
the same Player with `guide --to PLAYER --text TEXT` or complete `dispatch --to
PLAYER --text TEXT` input. Baton preserves its native conversation, assignment
and pending input. Review a completed assignment with `completion-confirmed --to
PLAYER`; Baton resolves that Player's current request addressed to you. Send
guidance for remaining work.

Commit completed shared-checkout changes without including another Player's
unfinished edits. For a contribution in a separate checkout, use `land` for a
fast-forward or reconcile it into the shared target with ordinary Git. Use
`land-checked` when the assignment calls for its selected remote comparison.
Compilation and tests run on the assigned remote runner. Repeat checks when
new changes, failures or unresolved concerns require them.

Publish the integrated target:

```sh
"$B2" "$DB" push "$TRIAL_REPO" "$TRIAL_TARGET" origin
```

Report the resulting behavior, publication, relevant checks and remaining work.
Keep tracker items open for unfinished implementation or delivery. Routine
implementation and integration need no further approval. Ask the operator when
a consequential scope or authority decision remains unresolved.

## Consolidate completed work

After an original Player's owned turn finishes and its contribution is
integrated and published, move that same Player to the shared checkout:

```sh
"$B2" "$DB" receiver PLAYER HARNESS_CMD OUTPUT_LOG "$TRIAL_REPO"
```

This preserves its native conversation, parent, base and retained input, and
records the shared checkout's current branch. Remove its clean inactive
temporary checkout with `git worktree remove`, then retire its fully integrated
local task branch with `git branch -d` and its remote task branch when present.
Preserve active checkouts, unfinished changes, unintegrated commits, explicit
stops, databases and native conversation stores.

Use `recruit` when the task needs a separate worktree. Its assignment must name
the integration target and who will integrate and retire the temporary branch.
Keep source work together in the shared checkout when a separate worktree is
unnecessary.

## Resume interrupted work

Inspect the original session, inbox, turn history and recorded checkout. Update
its supported receiver when the executable or output log changes. Use `resume
--session PLAYER` to deliver pending input, or dispatch complete further input to
the same Player. Preserve the original native identity and all unfinished source.
Completion of queued work is established by its result and coordinator decision.
