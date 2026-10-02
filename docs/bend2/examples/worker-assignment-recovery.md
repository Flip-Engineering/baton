# Worker assignment recovery

This example shows the lead steps for a refused worker assignment. The refused
recruitment preserves the stored worker row, the worker workspace files, the
native binding, the endpoint, observations, and pending input. The lead inspects
the stored assignment, retries it exactly, or recruits a different assignment
through the supported recruitment flow.

The recruitment and endpoint behavior below is specified in
[recruit-conflict-2026-10-02.md](../recruit-conflict-2026-10-02.md) and
[connect-admission-2026-10-02.md](../connect-admission-2026-10-02.md). The lead
recruitment pattern is specified in
[lead-instructions.md](../../../bend2/trial/lead-instructions.md).

## Declared assignment

The lead declares the full assignment at recruitment: worker ID, parent session,
harness, model, effort, repository, branch, workspace path, and base commit.
The worker ID in this example is `issue-4-worker-a` and the parent is the lead
session `lead-1`:

```sh
base=$(git -C "$REPO" rev-parse "$LEAD_BRANCH")
"$B2" "$DB" recruit issue-4-worker-a "$LEAD_ID" omp deepseek/deepseek-flash low \
  "$REPO" bend2/issue-4-worker-a "$REPO-work/issue-4-worker-a" "$base"
```

The stored assignment fields are `parent`, `harness`, `model`, `effort`,
`workspace`, `branch`, and `base`. The comparison function is
`Commands.worker_matches` in
[commands.bend](../../../bend2/src/coordinator/commands.bend), and the stored
row construction is `Commands.worker_sql` in the same file. The worktree
creation and registration flow is `recruit` in
[recruit.bend](../../../bend2/src/coordinator/recruit.bend).

## Refused assignment

A second `recruit` call with the same worker ID and any differing assignment
field returns the `worker-assignment-conflict` error with exit status 2. The
error names the session ID, the stored (`existing`) assignment, the requested
assignment, and the recovery instruction. The classifier is `Store.committed`
in [store.bend](../../../bend2/src/coordinator/store.bend), which returns the
refusal before endpoint delivery. The behavior checks are
[recruit.py](../../../bend2/test/recruit.py).

The refusal preserves the stored row, the registered worktree and branch refs,
committed and uncommitted workspace files, untracked workspace files, the
native identity, the endpoint, observations, and pending input. No new branch
or workspace path is created for the refused request. Stored assignment changes
require the supported recruitment flow described below. The stored worker
remains available for its parent.

## Inspection

Read the stored session and the stored worktree before deciding:

```sh
"$B2" "$DB" session issue-4-worker-a
"$B2" "$DB" worktree issue-4-worker-a
```

`session` returns the stored assignment, native identity, endpoint, workspace,
branch, and base. `worktree` returns the workspace status, branch, commit, and
dirty flag.

## Exact retry of the stored assignment

Read the stored assignment and pass its fields back unchanged. A recomputed
base from the lead branch is not the stored base when the branch has advanced,
and that call raises `worker-assignment-conflict`. Extract the stored fields
from the `session` JSON output and supply them to `recruit`, with `"$REPO"`
as the repository argument:

```sh
"$B2" "$DB" session issue-4-worker-a
```

```python
import json
import os
import subprocess

b2, db, repo = os.environ["B2"], os.environ["DB"], os.environ["REPO"]
stored = json.loads(subprocess.check_output([b2, db, "session", "issue-4-worker-a"], text=True))
subprocess.run([b2, db, "recruit", "issue-4-worker-a",
                stored["parent"], stored["harness"], stored["model"], stored["effort"],
                repo, stored["branch"], stored["workspace"], stored["base"]], check=True)
```

This is the exact retry: every assignment field, including `base`, equals the
stored row. The call succeeds and returns the stored session row. The retry
leaves the database, native binding, pending input, and Git work unchanged.

## New assignment

A different assignment requires a new worker ID with a new branch and an
unused workspace path. The stored worker keeps its work and remains assigned
to its parent:

```sh
base=$(git -C "$REPO" rev-parse "$LEAD_BRANCH")
"$B2" "$DB" recruit issue-4-worker-b "$LEAD_ID" omp deepseek/deepseek-flash low \
  "$REPO" bend2/issue-4-worker-b "$REPO-work/issue-4-worker-b" "$base"
```

## Endpoint argument boundary

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

Build the endpoint value with `json.dumps` over the real argv array, and pass
the resulting string as the single endpoint argument:

```python
import json
import subprocess

argv = ["/usr/bin/python3", "/opt/lead/receiver.py", "lead-1"]
endpoint = json.dumps(argv)
subprocess.run([b2, db, "connect", "lead-1", "native-1", endpoint], check=True)
```

After a valid endpoint is connected, resend the retained message ID. A
repeated message ID with identical sender, recipient, kind, and body preserves
the original message fields and returns the stored message with its current
receipt. `Commands.matching_message_result` in
[commands.bend](../../../bend2/src/coordinator/commands.bend) selects the
stored row with its current receipt, so the same message reads with receipt
null before acknowledgment and with receipt `accepted` after it. A repeated ID
with different input fails the transaction. An accepted retry causes no second
endpoint invocation: the endpoint log still holds one delivery line.

## Acknowledgment and accepted retry

The retained task is addressed to `lead-1`. The lead acknowledges the
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
The caller inspects `session` and `inbox`, connects valid argv, and retries
the retained message ID.

The local CLI records the endpoint, message, and receipt rows. Native process
custody follows the receiver and observer rules in
[lead-instructions.md](../../../bend2/trial/lead-instructions.md).
