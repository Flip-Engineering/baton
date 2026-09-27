# Bend2 trial root

Run one lane against this repository's open tracker issues. Work in the repository
and use the absolute paths in the trial's `environment.sh`. Read `AGENTS.md` before
assigning work. Read an issue and its current comments with `gh`, inspect the
relevant code, and choose a small change with a named failure or an explicit
operator request. Coordinate overlapping work with the operator's root. The JS
swarms continue alongside this lane.

Use the native Codex subscription session started by `trial-start.sh`. Your task,
reports and decisions remain in that session. The coordinator stores worker
identities, messages and turn observations in `$DB`.

The trial repository starts from current master and supplies the JS runner with
`failures` and `reportedFiles` in its verdict. The Bend2 checkout supplies the
coordinator and check adapter. Follow the repository's dependency setup for the
selected tests: packages must resolve from the worker and both checked trees.
An installation only in the original checkout may not serve linked worktrees.
Report missing dependencies or an old verdict format to the operator; an
unjudged check cannot authorize the landing.

## Recruit and start work

Use OMP `deepseek/deepseek-flash` for implementation. Use Muse
`muse-spark-1.3-contributor` for small items. Set effort to `low` initially; choose
another native effort when the task warrants it. Give the worker the issue,
observed behavior, intended change, relevant files, and the selected tests. Ask it
to commit its work and report the commit, touched paths, tests and any limitation.
Tell it to read its checkout's `AGENTS.md` and stay within the assigned change.

Choose a distinct worker ID and branch. Read the current target commit and recruit
from it. For example, after sourcing the trial environment:

```sh
base=$(git -C "$TRIAL_REPO" rev-parse "$TRIAL_TARGET")
"$B2" "$DB" recruit issue-N root omp deepseek/deepseek-flash low \
  "$TRIAL_REPO" bend2/issue-N "$TRIAL_STATE/issue-N" "$base"
```

For Muse use harness `muse`, model `muse-spark-1.3-contributor` and `$TRIAL_MUSE`
as the native executable. For OMP the executable is `$TRIAL_OMP`. Write the task
in `$TRIAL_STATE/issue-N-task.md`.

Start the turn in the background with all standard streams redirected. This
example starts a new OMP native session and immediately returns its supervisor
PID to your shell:

```sh
python3 - <<'PY'
import os, pathlib, subprocess
state = pathlib.Path(os.environ['TRIAL_STATE'])
with (state / 'issue-N-supervisor.log').open('ab') as log:
    child = subprocess.Popen([
        os.environ['B2'], os.environ['DB'], 'turn', 'issue-N', 'issue-N-turn-1',
        os.environ['TRIAL_OMP'], 'deepseek/deepseek-flash', 'low',
        str(state / 'issue-N'), str(state / 'issue-N-task.md'),
        str(state / 'issue-N-native.jsonl'), '',
    ], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
print(child.pid)
PY
```

Acknowledge the input that caused your turn with
`"$B2" "$DB" ack MESSAGE_ID root RECEIPT`, then end your turn after launching the
worker. Do not wait or poll for it. The supervisor records its report and invokes
your registered adapter, which resumes your native session for the next turn.
Only one worker turn in this trial lane should be active at a time.

## Guide and review

Read `workers`, `turns WORKER` and `inbox root` when a report arrives. Acknowledge
the report after reviewing it. OMP accepts a `message ID root WORKER guidance BODY`
during a running turn. To continue a completed worker, write its next task file,
read its `native` field with `session WORKER`, and start another background `turn`
with a fresh turn ID and log path and that native ID as the final argument.
Retain the recorded workspace for the resumed session.

Review the actual branch diff and tests. A worker report alone does not establish
that the change fixes the issue. Request a correction when necessary and resume
the same worker. Run only the selected test files for this change. Never run the
whole JS suite as part of the trial. Do not invent checks or recovery machinery
for hypothetical failures.

## Land and publish

Keep `bend2-trial` unchecked-out. Give `land-checked` the test files the change
touches, separated by spaces in one argument. Include existing behavior tests
that judge changed production code. Pass the absolute check script path from
`$TRIAL_CHECK`, so the same adapter runs against both trees:

```sh
"$B2" "$DB" land-checked issue-N "$TRIAL_REPO" "$TRIAL_TARGET" \
  "$TRIAL_CHECK" 'impl/test/selected.test.mjs'
```

The check uses this repository's runner and its verdict. A new failure blocks;
a matching failure on the target is compared by its four-field identity. An
unjudged run blocks. Inspect a blocked or conflicted result and resolve its named
cause. A conflict retains its scratch checkout; guide the worker to rebase its
branch onto the current target and resolve, then review and request a new checked
landing. A docs-only change still needs a relevant selected check; ask the operator
to choose it if the change has no applicable test.

After a successful `landed` or `already` result, read the actual target commit,
publish with the coordinator, and verify the advertised ref:

```sh
commit=$(git -C "$TRIAL_REPO" rev-parse "$TRIAL_TARGET")
"$B2" "$DB" push "$TRIAL_REPO" "$TRIAL_TARGET" origin
git -C "$TRIAL_REPO" ls-remote origin refs/heads/bend2-trial
```

Report publication only when `push` answers `pushed` and the advertised ref
matches the target commit. Never force-push. Do not change another target branch
or close the tracker issue; the operator's root decides promotion and closure.

For every landing, send the operator a coordinator message containing the issue,
worker commit, landed target commit, checks, publication result and advertised
ref. Use a unique message ID, for example:

```sh
"$B2" "$DB" message issue-N-landed-COMMIT root operator report 'ISSUE and exact evidence'
```

Also include that report in your final response. The operator reads `inbox operator`
and the native responses in `$DB.root.log`; the trial launcher prints both paths.
Name a failed publication or missing prerequisite in that report. After finishing
the seeded issue, end the lane's work and report to the operator's root.

## Reattach

The operator reruns `trial-start.sh` with the same paths after an interruption.
It rebuilds the executable and reattaches the saved Codex session, delivering its
pending reports. A worker interrupted before its report needs a new `turn` using
its stored native ID and retained workspace. Inspect its history and existing
commit before continuing. Workspaces and native sessions remain available for
that continuation.
