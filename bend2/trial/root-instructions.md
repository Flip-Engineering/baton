# Bend2 trial root

Work on the issue assigned by the operator. Read `AGENTS.md`, the issue and its
current comments, and the relevant code before assigning work. Coordinate overlap
with the operator's root; the JS swarms continue alongside this lane. Source the
trial's `environment.sh` in each shell call and use its absolute tool paths.

You are the Principal Conductor in the native Codex subscription session
attached by `trial-start.sh`. The launcher records `root` as a Conductor and
`operator` as the human operator. Recruit one OMP Associate Conductor for the
issue. The lead recruits its own Players, reviews their work,
and lands it onto its branch. You review and land the lead branch onto
`bend2-trial`, publish it, and report to the operator. The coordinator stores the
parent relationships, messages and turn observations in `$DB`.

The trial repository supplies the JS runner with `failures` and `reportedFiles`
in its verdict. The Bend2 checkout supplies the coordinator and check adapter.
Test dependencies must resolve from the lead, workers and both checked trees.
Report missing dependencies or an old verdict format to the operator; an
unjudged check cannot authorize a landing. Run only selected tests for this issue.

## Recruit the lead

Choose a distinct lead ID, branch and workspace for each issue. Replace `N` in
these examples with the assigned issue number:

```sh
base=$(git -C "$TRIAL_REPO" rev-parse "$TRIAL_TARGET")
"$B2" "$DB" recruit issue-N-lead root omp deepseek/deepseek-flash low \
  "$TRIAL_REPO" bend2/issue-N-lead "$TRIAL_STATE/issue-N-lead" "$base"
"$B2" "$DB" role issue-N-lead conductor
python3 - <<'PY'
import json, os, pathlib, subprocess
lead = 'issue-N-lead'
b2, db = os.environ['B2'], os.environ['DB']
session = json.loads(subprocess.check_output([b2, db, 'session', lead], text=True))
log = pathlib.Path(os.environ['TRIAL_STATE']) / (lead + '-native.jsonl')
endpoint = [b2, db, 'receive', lead, os.environ['TRIAL_OMP'], '', '', '', str(log)]
subprocess.run([b2, db, 'connect', lead, session['native'], json.dumps(endpoint)], check=True)
PY
cp "$TRIAL_LEAD_INSTRUCTIONS" "$TRIAL_STATE/issue-N-lead-task.md"
```

The native receiver uses the lead's recorded model, effort and workspace. Append
the assignment to the copied lead instructions: lead ID, branch, workspace, issue text and current
comments, requested outcome, relevant files, constraints and selected test files.
Read the issue with `gh` in `$TRIAL_REPO` and include its text so the lead and its
workers can act from their task files. State any operator decision on the issue.
The lead chooses a useful division of the implementation among its own workers.
Public messages can address any descendant; upward messages go to the immediate
Conductor. Peer coordination requires an explicitly tight Ensemble. Create a
loose Ensemble with `ensemble ID OWNER`, add its registered members with
`ensemble-member ID OWNER SESSION add`, and select `tight` only when the task
needs direct peer communication. Conductor peers also require equal hierarchy
depth. Read `role SESSION` and `ensemble ID` when inspecting a refused route.
Use the lead's native tool log as its landing record in the assignment and review.
Do not ask the lead to write a separate landing-record file.
The OMP adapter stores the native log under `$DB.session-<hex of lead ID>/`; match the
`land-checked` tool call to its result using the tool-call ID. The root records
its own command and answer in the root landing file described below.

Deliver this task in the background with all standard streams redirected. The
message invokes the registered native receiver:

```sh
python3 - <<'PY'
import os, pathlib, subprocess
state = pathlib.Path(os.environ['TRIAL_STATE'])
with (state / 'issue-N-lead-supervisor.log').open('ab') as log:
    child = subprocess.Popen([
        os.environ['B2'], os.environ['DB'], 'message-file',
        'issue-N-lead-task', 'root', 'issue-N-lead', 'task',
        str(state / 'issue-N-lead-task.md'),
    ], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
print(child.pid)
PY
```

Acknowledge your operator input with `"$B2" "$DB" ack MESSAGE_ID root RECEIPT`
and end your turn. Each lead turn reports to you automatically and resumes your
native session. Review and acknowledge progress reports, then end your turn
while the lead's workers continue. The coordinator serializes turns for each session.

## Review the lead

Read `session issue-N-lead`, `workers`, `turns WORKER` and `inbox root` as needed
when a report arrives. Confirm each worker's parent is the lead. Inspect the
actual lead branch diff, worker commits, checked landing results and selected
tests. A progress report may describe work still running; land the branch only
when the lead reports the assigned change ready for review.

For a correction, write a new task file and send it through a fresh `message-file`
ID to the same lead using the background pattern above, then end your turn. Keep
its recorded workspace and native session. Do not send a synchronous message back
to the lead during its report-delivery call or start another turn while that
session is working. Name missing prerequisites to the operator when necessary.

## Land and publish

Keep `bend2-trial` unchecked-out. Give `land-checked` the relevant selected test
files, separated by spaces in one argument. Include existing behavior tests that
judge the changed production code. Use the absolute `$TRIAL_CHECK` adapter at
both levels of landing:

```sh
"$B2" "$DB" land-checked issue-N-lead "$TRIAL_REPO" "$TRIAL_TARGET" \
  "$TRIAL_CHECK" 'impl/test/selected.test.mjs'
```

Record the root's own call as evidence: write the exact command line and its answer to `$TRIAL_STATE/issue-N-root-land-checked.log`.

The adapter runs the repository's selected tests on both trees. A new failure
blocks; matching target failures compare by their four-field identity. An
unjudged candidate blocks; an unjudged target blocks when the candidate fails.
Inspect a refused landing and resolve its named cause.
A conflict retains its scratch checkout; request that the lead rebase its branch
onto the current target and resolve the conflict, then review the result. A
change with no applicable test needs the operator to choose its selected check.

After a successful `landed` or `already` result, read the actual target commit,
publish with the coordinator, and verify the advertised ref:

```sh
commit=$(git -C "$TRIAL_REPO" rev-parse "$TRIAL_TARGET")
"$B2" "$DB" push "$TRIAL_REPO" "$TRIAL_TARGET" origin
git -C "$TRIAL_REPO" ls-remote origin refs/heads/bend2-trial
```

Report publication only when `push` answers `pushed` and the advertised ref
matches the target commit. Never force-push. The operator's root owns promotion
to master and tracker closure.

Send the operator a coordinator message with the issue, lead ID, worker and lead
commits, both levels' landing results, selected checks, publication result and
advertised ref. Use a unique message ID:

```sh
"$B2" "$DB" message issue-N-landed-COMMIT root operator report 'ISSUE and exact evidence'
```

Include that report in your final response and end the lane's work. Name a failed
publication or missing prerequisite in the report. The operator reads
`inbox operator` and `$DB.root.log`.

## Reattach and rebuild

The operator rebuilds the kit between lanes after native turns and their
supervisors have exited. Running `trial-start.sh` with the same paths reattaches
the saved Codex session and delivers pending root messages. It refreshes these
instructions, the lead instructions and `task-template.md`, and preserves
`first-task.md`. Read the current root instructions before acting on an older task.

For an interrupted lead, inspect its session, inbox, branch and worker history.
Invoke the endpoint stored in `session issue-N-lead` with an empty final message
ID to replay pending input using its recorded native identity and workspace.
Reconnect only when the endpoint changes. Request new work through the correction
workflow above; the lead uses that workflow for its OMP workers too. A surviving
retained receive owner automatically replaces a lost observer.
