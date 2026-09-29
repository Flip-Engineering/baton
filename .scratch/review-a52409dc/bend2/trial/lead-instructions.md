# Bend2 trial lead

Your root supplies your session ID, branch, workspace and issue assignment below.
Source the trial's `environment.sh` in each shell call. Read `AGENTS.md` and the
assigned issue, inspect the relevant code, and divide the change among your own
workers. Use your session ID as every worker's parent. Review and land their work
onto your registered lead branch. Report that branch to the root for its review
and final landing onto `bend2-trial`.

Set `LEAD_ID` and `LEAD_BRANCH` to the values in your assignment in each shell
that uses them. Acknowledge each task and reviewed worker report with
`"$B2" "$DB" ack MESSAGE_ID "$LEAD_ID" RECEIPT`. Your native supervisor sends your
final response to the root after every turn. Write progress or completion facts
in that response; the supervisor supplies the report message.

## Recruit and start workers

Use OMP `deepseek/deepseek-flash` with effort `low` initially. Muse
`muse-spark-1.3-contributor` is available for small items. Give each worker the
issue text, intended change, assigned paths, constraints and selected tests.
Ask it to read `AGENTS.md`, commit its work and report its commit, tests and any
limitation. Choose distinct IDs, branches and paths; replace `N` and `A` below.
Recruit from the current lead branch so later workers can use landed work:

```sh
base=$(git -C "$TRIAL_REPO" rev-parse "$LEAD_BRANCH")
"$B2" "$DB" recruit issue-N-worker-A "$LEAD_ID" omp deepseek/deepseek-flash low \
  "$TRIAL_REPO" bend2/issue-N-worker-A "$TRIAL_STATE/issue-N-worker-A" "$base"
```

Keep your lead branch unchecked-out so `land-checked` can advance it. From your
clean lead workspace, run `git checkout --detach` before landing workers. The
registered branch remains the source of the root's eventual landing. Inspect
that branch explicitly after it advances; your detached checkout keeps its old
commit until you update it.

Write the task at `$TRIAL_STATE/issue-N-worker-A-task.md`. Start its turn in the
background with standard streams redirected:

```sh
python3 - <<'PY'
import os, pathlib, subprocess
state = pathlib.Path(os.environ['TRIAL_STATE'])
with (state / 'issue-N-worker-A-supervisor.log').open('ab') as log:
    child = subprocess.Popen([
        os.environ['B2'], os.environ['DB'], 'turn',
        'issue-N-worker-A', 'issue-N-worker-A-turn-1',
        os.environ['TRIAL_OMP'], 'deepseek/deepseek-flash', 'low',
        str(state / 'issue-N-worker-A'), str(state / 'issue-N-worker-A-task.md'),
        str(state / 'issue-N-worker-A-native-1.jsonl'), '',
    ], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
print(child.pid)
PY
```

For Muse, recruit with harness `muse` and its model, and use `$TRIAL_MUSE` and the
same model in `turn`. End your turn after starting the worker; its report invokes
your registered native receiver and resumes your native session. Start independent
child turns concurrently and review each report when it arrives. The coordinator
serializes turns for each session.

## Guide, review and land

OMP accepts guidance during a running worker turn:

```sh
"$B2" "$DB" message issue-N-worker-A-guidance-1 "$LEAD_ID" issue-N-worker-A \
  guidance 'The additional requirement and its reason'
```

Read the message receipt to establish native acceptance. To continue a completed
worker, read its `native` field using `session WORKER`, write the next task file,
and start another background `turn` with a fresh turn ID and log path and that
native ID as the final argument. Retain its workspace.

On each report, inspect the actual branch diff and run the selected tests. Read
`workers`, `turns WORKER`, `worktree WORKER` and `inbox LEAD_ID` as needed.
Acknowledge the reviewed report. Request corrections through the same worker
when necessary. Run only the tests selected for the issue; do not run the whole
JS suite. The repository's dependencies must resolve in the worker and both
checked trees. Report missing dependencies to the root.

Land a reviewed worker onto your lead branch using the trial check adapter:

```sh
"$B2" "$DB" land-checked issue-N-worker-A "$TRIAL_REPO" "$LEAD_BRANCH" \
  "$TRIAL_CHECK" 'impl/test/selected.test.mjs'
```

Pass all selected test paths separated by spaces in one argument, including
existing behavior tests for changed production code. The adapter compares typed
verdicts on both trees; new failures and unjudged checks block. Resolve the named
cause of a refused landing. For a conflict, guide the worker to rebase onto the
current lead branch and review the resolution. Ask the root to choose a check
when the change has no applicable test. Keep the shared check adapter intact.

Inspect the final lead branch tree and run the selected tests on that tree.
Your completion report must name the issue, child IDs and parent bindings,
worker commits, worker landing commits, exact lead branch tip, tests, guidance
receipts when used, and any remaining limitation. State that the branch is ready
for root review only when the assigned work is complete. Keep workspaces and
native sessions available for corrections. The root owns the final trial landing
and remote publication.
