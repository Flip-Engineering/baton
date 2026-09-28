# Baton in Bend2

The [architecture](../docs/bend2/architecture.md) describes the implemented
coordinator, native harness adapters, Git operations and recovery.

## Build and check

With Bend 2.0.25, clang and SQLite development headers available:

```sh
sh bend2/scripts/check-native.sh
```

The build uses `.bend/bin/bend` or `node_modules/.bend/bin/bend`. Set `BEND` to
another installed compiler path if needed. It emits C and links the native
executable at `.scratch/bend2/baton2`. Host bindings execute on Bend IO workers.

`bend2/src/coordinator/laws.bend` states the sixteen operative entries of
[the approved laws](../docs/bend2/laws-proposed.md) over the functions this
tree implements them with, and proves each one beside its claim. The entry
module imports that module, so a compile of the entry verifies every
operative law, and the native build refuses the tree while a law is unproven
or false.

```sh
node bend2/scripts/laws-check.mjs
```

This is the negative control for that gate. It removes one law's proof at a
time in a copy of the tree and requires the entry's compile to fail, so a law
whose proof the gate does not require is reported rather than assumed.

`python3 bend2/scripts/compare-coordinators.py --help` describes a repeatable
comparison of retained coordination operations with a pinned old Baton checkout.
The [measurement report](../docs/bend2/comparison-2026-09-28.md) records its
workload, source revisions, results and limits.

## Coordinator storage

The executable stores sessions and messages and supervises foreground Claude
Code, Codex, OMP and Muse turns. Recruitment creates a Git worktree and records its resolved base. Native parent
delivery through Claude Code Channels MCP is connected to this interface. Git
landing advances a target branch to include a worker's committed tip, and the
checked landing (bend2/src/git/land_checked in bend2/src/git/land.bend)
prepares a squashed candidate in a scratch worktree, runs the selected checks
on the candidate and on a tree at the target tip, blocks on failures the
target run does not show, and advances the target through a compare-and-swap
ref update. A target that moved meanwhile returns a retry instruction and leaves
the candidate and worker work available. The next `land-checked` invocation
prepares and checks against the current target.

```sh
.scratch/bend2/baton2 state.db attach root claude-code ROOT_SESSION ENDPOINT
.scratch/bend2/baton2 state.db recruit worker1 root omp MODEL high REPO BRANCH WORKTREE BASE
.scratch/bend2/baton2 state.db bind worker1 NATIVE_SESSION omp OBSERVED_MODEL high
.scratch/bend2/baton2 state.db report turn1 worker1 BODY
.scratch/bend2/baton2 state.db inbox root
.scratch/bend2/baton2 state.db ack turn1 root NATIVE_ACCEPTANCE_RECEIPT
.scratch/bend2/baton2 state.db land worker1 /path/to/repo target-branch
.scratch/bend2/baton2 state.db push /path/to/repo target-branch origin
.scratch/bend2/baton2 state.db status
```

Commands return JSON. `report` saves the full
body and pending parent delivery in one SQLite transaction. A matching retry
returns the first result, including its delivery receipt. Conflicting reuse of
an ID fails. `ack` records native acceptance after the adapter observes it.

`observe-file ID WORKER PATH` consumes one
native harness event. An initialization event (type `session`) updates the
worker's observed native session and model. A terminal event (type `result`
or a terminal `agent_end`) creates a pending parent report containing the
extracted result text and records the turn. Non-terminal events are recorded
without creating a report. `observe-file` reads the JSON from a file. A repeated
observe with the same ID
and matching content returns the original result.

Requested and observed routes are stored separately. Reading status reports the
stored session binding; it does not establish that a process is alive.

`message ID SENDER RECIPIENT KIND BODY` and its `message-file` variant store
guidance and questions. `report` routes a report and `ask ID WORKER BODY`
routes a question to the worker's recorded parent, with the same retry
behavior; `ask-file` reads the question from a path or `-` for stdin.
`delivery ID` returns the message with its recipient's current native endpoint.
`pending` returns undelivered messages with those current endpoints, and
`session ID` reads one stored binding. `connect ID NATIVE ENDPOINT` updates an
existing worker connection while retaining its parent and requested route. Each CLI invocation opens the same
database, and SQLite serializes transactions.
Workspaces and source files are retained by these commands.

During an OMP turn, send guidance with:

```sh
.scratch/bend2/baton2 state.db message guide1 root worker1 guidance "Focus the review on recovery."
```

The supervisor forwards pending guidance through OMP's `steer` command when it
receives a native response, a completed message or a tool event. During a silent
tool run or a stream of text updates, guidance waits for the next such event.
The native response records the delivery receipt. Guidance
with no receipt remains in the worker's inbox for a later delivery attempt.

`recruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE` creates a branch
and worktree, then records the worker under its parent. A relative `PATH` is
resolved from `REPO`; the stored workspace path is absolute. The base is stored
as a commit ID. A matching repeated recruitment returns the existing worker.
`worktree ID` reads its current Git branch, commit and dirty state.

`land WORKER_ID REPO TARGET_BRANCH` looks up the worker's branch from the
database, verifies the worker tip is a fast-forward from the target, and
advances the target with a compare-and-swap `update-ref`. The answer is JSON
with a `status` field: `landed` with the new target commit, `already` when the
target already contains the worker commit, or `blocked` with a reason (the
worker branch diverged or the target moved during the update). Worker branches
and worktrees are retained after landing.

`land-checked WORKER_ID REPO TARGET_BRANCH CHECK FILES` runs the gated landing.
CHECK runs as `/bin/sh CHECK FILE` inside each checked tree, once per selected
file per tree. `bend2/scripts/check-unittest.sh` judges one selected Python
test file: a selection under `bend2/test/` builds the coordinator binary in
the checked tree first, the selected file runs, and each failing case prints
one identity line of four hex-encoded fields: file, test id, failure type, and
semantic code. The `blocked` answer names every candidate failure line the
target run does not show, and an unjudged check run blocks the landing. The
gate reads failure identities from stdout. Child stderr remains on the
coordinator's stderr for logging. A nonzero exit with empty stdout is unjudged.
The answer is JSON with a `status` field: `landed` with the new target commit
(the squash candidate), `already` naming the worker commit the target
contains, `conflict` naming the unmerged paths and the scratch worktree it
keeps, or `blocked` with a reason. A landing that answers `landed` or
`already` removes the candidate and target scratch worktrees as it answers. A
refused or conflicted landing keeps them for the requester, and that worker's
next landing request drops them before preparing its own.

If the target moves while checks run, the command returns `blocked` and names
`land-checked` as the retry. Repeating that command checks the new candidate and
target before advancing the branch. The worker's branch and worktree remain
available throughout these attempts.

The squash message describes the worker history above its merge-base with the
target. A single commit retains its full message. Several commits use the tip
commit's subject, with every branch commit's subject in the body, oldest first
in topological order. The body also names the worker branch and any ignored
paths dropped during landing.

## Native turns

After registering the worker, run:

```sh
.scratch/bend2/baton2 state.db turn worker1 turn1 HARNESS_COMMAND MODEL EFFORT WORKTREE TASK_FILE OUTPUT_LOG ""
```

The last argument is the native session to resume; an empty string starts a new
session. The worker's recorded harness selects the adapter. Claude uses stream JSON.
OMP uses `--mode rpc`, retains sessions beside the database and keeps stdin open
for guidance until its terminal event. Its `get_state` response supplies the
native session ID and observed model.
The supervisor keeps the latest completed assistant message in memory. If OMP's
terminal envelope has an empty or missing message list, that completed message
supplies the parent report.
Codex uses `exec --json` and `exec resume SESSION`, with the task on stdin.
Its thread event records the native session. The supervisor retains the
current invocation's latest completed assistant message and terminal event in memory
and produces the parent report from those retained events after process exit.
Earlier successful turns in the same output log do not change the report.
Codex events do not name the observed model; that field stays empty.
Muse uses `exec --json --prompt-file` and resumes with `--session-id`.
Its session envelopes record the native session and observed model, and its
terminal envelope supplies the parent report. `workers` includes the native
session ID and last completed turn for selecting a session to resume.
The harness uses its existing login. A launch wrapper can set the harness's documented home
or config environment before executing its binary. This command runs one foreground
native process, sends the task and drains output while writing input. Claude,
Codex and Muse input closes after the task; OMP input closes at turn completion.
A later turn resumes the recorded
native session. The logical worker and its workspace remain available.

The supervisor retains stdout at `OUTPUT_LOG` and stderr at `OUTPUT_LOG.stderr`.
For OMP, stdout logging omits cumulative `message_update` frames and retains
every other frame, including complete `message_end` messages, tool output and
terminal events. Log size grows with the retained output. New supervisors use
the executable built by the trial launcher; rebuilding applies this behavior to
subsequent turns. Existing logs remain available at their original paths.
Native result events create pending parent reports. Process-start failures and
exits without a result also create reports. Repeating a completed turn ID returns
its retained report. To retry after a failure report, use a new turn ID. Read
`session WORKER` for its native session ID and pass that ID as the last `turn`
argument to continue the same conversation. For example:

```sh
.scratch/bend2/baton2 state.db session worker1
.scratch/bend2/baton2 state.db turn worker1 turn2 HARNESS_COMMAND MODEL EFFORT WORKTREE NEXT_TASK_FILE NEXT_OUTPUT_LOG NATIVE_SESSION
```

`pending` shows reports awaiting native acceptance. Native receivers read
messages from the database. `turn` and `receive` share process ownership for
each logical session; separate sessions can run concurrently.
An overlapping `turn` returns an active-session error. Send a message to queue
input for a session with a registered receiver, or retry the turn after it exits.

The check command builds the coordinator, process and Git test executables, then
runs persistence, recruitment, Git, OS-process and controlled-protocol tests. A controlled
process fixture verifies supervision; a real subscription worker and a native
root acceptance receipt are required for the live-slice result.

## Native root delivery

Register a root and its native receiver endpoint using absolute paths. This
example creates a new Codex root:

```sh
/repo/.scratch/bend2/baton2 /repo/state.db attach root codex '' '["/repo/.scratch/bend2/baton2","/repo/state.db","receive","root","/path/to/codex","gpt-6-astra","low","/repo","/repo/root-native.jsonl"]'
/repo/.scratch/bend2/baton2 /repo/state.db receive root /path/to/codex gpt-6-astra low /repo /repo/root-native.jsonl ''
```

The command is `receive SESSION HARNESS_COMMAND MODEL EFFORT CWD OUTPUT_LOG
MESSAGE_ID`. Empty model, effort and working-directory arguments use the
session's recorded values. The native executable and output-log path are
required. A committed message invokes the registered endpoint with its ID
appended. An empty final argument explicitly replays pending input.

The receiver reads pending messages and supervises the native turn. When that
session already has a native turn, delivery returns `queued`; the active
supervisor checks for incoming messages after releasing session ownership.
Reports remain pending until the recipient acknowledges them with `ack`. Native
events append to `OUTPUT_LOG`, and report writers retain receiver output at
`DATABASE.root.log`. A failed native turn leaves unacknowledged messages pending.

For OMP, register harness `omp` and use its executable, model and effort in the
same endpoint. Each harness uses its existing login; a launch wrapper can set
its documented configuration environment. Native initialization records the
session ID. Subsequent turns resume that ID. Keep it when reconnecting an
existing root with `connect`; the trial launcher preserves it automatically.
Codex retains conversations in its configured storage. OMP roots use
`DATABASE.root-sessions`.

The earlier `codex-root.mjs` and `omp-root.mjs` entry points remain available for
existing configurations. Native `receive` supplies the session ownership and
queued delivery described here. The trial launcher uses that native path.

`python3 bend2/scripts/accept-native-receive.py --config routes.json --output .scratch/native-review`
starts a Codex root and two OMP source reviewers in an isolated clone. The route
file supplies each harness's executable, model and effort. The driver builds
the selected committed revision in the clone; `BEND` can select an installed
compiler. It verifies retained report text, acknowledgment, native session reuse
and unchanged source checkouts.
It retains the database, native logs, process records and source and binary hashes
under the output directory. The command starts real model sessions.

## Claude Code channel adapter

A Claude Code root uses an interactive session with a Channels MCP configuration.
For example, save this as `root-mcp.json`, replacing `/repo` with absolute paths:

```json
{"mcpServers":{"baton-root":{"command":"node","args":["/repo/bend2/scripts/mcp-root.mjs","/repo/state.db","/repo/.scratch/bend2/baton2"]}}}
```

```sh
claude --mcp-config root-mcp.json --dangerously-load-development-channels server:baton-root
```

Accept the local development-channel prompt. To recover a root, use the same
command with `--resume NATIVE_SESSION` and the same database and harness
configuration. Claude resumes its conversation and the channel delivers pending
reports. Once initialized, the server attaches a local socket endpoint and
delivers pending messages after the client's discovery handshake.
Subsequent report writers notify that endpoint;
the server reads the committed message and emits a Claude channel notification.
The server stays attached to the Claude process. Its socket is created beside
the database and closes with the server.

The native root reviews the report and records acceptance with
`ack ID root RECEIPT`. It can send guidance with `message`, inspect Git state
with `worktree`, and land and publish reviewed work with `land`, `land-checked`
and `push`. A report's receipt records the root's acceptance; committing the
report alone leaves that receipt empty.

## OMP leads

A recruited OMP session can receive reports from its own workers. Recruit the
lead under the root, then connect its native receiver:

```sh
.scratch/bend2/baton2 state.db recruit lead root omp deepseek/deepseek-flash low REPO lead-branch LEAD_WORKTREE BASE
.scratch/bend2/baton2 state.db connect lead '' '["/repo/.scratch/bend2/baton2","/repo/state.db","receive","lead","/path/to/omp","","","","/repo/lead-native.jsonl"]'
```

A Kimi K3 lead uses `omp kimi-code/k3 high` for the harness, model and effort
arguments. OMP supplies the configured `kimi-code` provider credentials. The
same receiver endpoint selects the lead's registered route.

The empty launch fields select the lead's recorded model, effort and workspace.
Explicit fields override those values for that invocation. Connection preserves
the lead's parent, branch and base. Supply its stored native ID when reconnecting.
Messages addressed to the lead invoke its endpoint; subsequent invocations
resume its native session. Each finished lead turn submits its result through
the coordinator, which delivers the report to the lead's parent. A failed native
turn also reports its failure and leaves unacknowledged input available.

Send the lead's task with `message-file ID root lead task TASK_FILE`. The lead
recruits children by passing `lead` as their parent, reviews their reports and
lands their branches onto `lead-branch`. Detach the lead's checkout before a
landing advances that branch. The root can then review and land the lead's
registered branch through the same landing command.

Start independent child turns in the background and end the parent turn so
that incoming reports can resume it. The coordinator serializes native turns
for each session. OMP leads retain conversations in
`DATABASE.session-HEX_ID`, with the session ID encoded as lowercase UTF-8 hex.
This preserves conversation storage used by the earlier OMP adapter.

`python3 bend2/scripts/accept-hierarchy.py --config routes.json --output .scratch/hierarchy-run`
exercises the earlier root adapters with a Codex root, an OMP lead and two OMP
workers in a scratch clone.
The route file uses the `codex` and `omp` executable/model/effort entries described
below. Build the coordinator first; `--coordinator` selects another executable.
The run retains native events, process records, SQLite messages, guidance receipts
and both levels of checked landings in its output directory.

`python3 bend2/scripts/accept-kimi-hierarchy.py --config routes.json --tasks tasks.json --output .scratch/kimi-hierarchy`
builds the selected source in a scratch clone and runs a subscription Codex root,
a Kimi OMP lead, and concurrent DeepSeek and Muse workers. The route file has
`codex`, `lead`, `omp` and `muse` entries. The task file assigns each worker its
source files and selected Python checks, and supplies the mid-task guidance.
The command's `--help` describes both files. Native process overlap, steering,
session reuse, report contents and both checked landing levels are verified.

## Source layout

Application logic belongs in imported Bend2 modules under `src/`. Small C
bindings supply host primitives. Tests have separate entry points and exercise
the native executable.

The existing JSON and replay programs are earlier experiments. Their optional
runner, `node bend2/scripts/run-checks.mjs`, compares interpreted and native
output with their `.expected.txt` fixtures. It can install Bend locally if
absent. Those programs carry no law annotations and no dependence on the
coordinator's laws module, which the entry imports.

## Real-route acceptance

Run the root's working day with logged-in native harnesses:

```sh
python3 bend2/scripts/accept-root-day.py --config routes.json --output .scratch/root-day-run
```

`--output` names a new directory. The script builds the current coordinator with
`build-native.sh`; `BEND` selects the installed compiler. `--coordinator /path/to/baton2`
uses an existing executable when investigating a run. The route file gives each
native executable or launch wrapper an absolute path:

```json
{
  "omp": {"executable": "/path/to/omp", "model": "deepseek/deepseek-flash", "effort": "low"},
  "codex": {"executable": "/path/to/codex", "model": "gpt-6-astra", "effort": "low"},
  "claude-code": {"executable": "/path/to/claude", "model": "claude-opus-4-6", "effort": "low"},
  "muse": {"executable": "/path/to/muse", "model": "muse-spark-1.3-contributor", "effort": "low"}
}
```

The sequence starts real workers on all four routes, interrupts and resumes their
native sessions, guides a running OMP worker, triggers native Codex and OMP roots
from worker reports, delivers a Claude channel notification, and recovers all
three roots. The Git stage lands reviewed worker commits, exercises a moving
target and conflict resolution, and pushes to a scratch bare remote whose ref
is read with `git ls-remote`.

The Claude stage starts a real interactive terminal and accepts the local
workspace and development-channel prompts. Its transcript and debug log remain
in the output directory. Configure the harness login and complete its initial
onboarding before starting the run. Launch wrappers can keep native session and
configuration writes in an operator-selected directory.

The script kills only processes started for its recovery cases. It does not
reboot the host. Databases, native logs, Git worktrees and per-stage evidence
remain available after the run. `result.json` records the completed selection.
A failure exits with its cause and retains the evidence; `--stage workers`,
`guidance`, `native-roots`, `claude-channel` or `git` runs that stage in a new
output directory during diagnosis. A full acceptance result requires the whole
sequence.

## Cutover trial

Start a trial from the operator's terminal with the native logins and repository
push credentials available there:

```sh
BEND=/path/to/bend sh /path/to/bend2-checkout/bend2/scripts/trial-start.sh \
  /path/to/repository /path/to/bend2-checkout /path/to/trial.db
```

The repository path should name a current-master checkout, from which the trial
branch is created. The Bend2 checkout supplies the tools. The JS check adapter
requires the repository runner's typed verdict fields, `failures` and
`reportedFiles`; the historical JS runner on `bend2-rewrite` lacks them.

The launcher builds the coordinator beside the database, creates `bend2-trial`
from the repository's `HEAD` if that branch is absent, and attaches a Codex
`gpt-6-astra` root using the existing ChatGPT subscription login. `BATON_CODEX`,
`BATON_OMP` and `BATON_MUSE` can name native executables or local launch wrappers;
the defaults are `codex`, `omp` and `muse` on `PATH`. Node, Python 3, Git and the
native build prerequisites must be available. The repository's test dependencies
must resolve from the worker and the candidate/target worktrees when selected JS
tests run. Installing packages only in the original checkout does not establish
that those other trees can resolve them. A missing module produces an unjudged
check that blocks landing.

The launcher writes current root and lead instructions, an issue task template,
and a first task file. Copy the printed template to an issue task file, fill in
the assigned issue, and send it with the printed coordinator command and a fresh
message ID. The root follows [the root instructions](trial/root-instructions.md)
and connects an OMP lead through native `receive`. The lead follows
[the lead instructions](trial/lead-instructions.md), recruits workers and lands
their reviewed changes onto its branch. Worker reports resume the lead; lead
reports resume the Codex root. The root reviews and lands the lead branch through
`check-node-test.sh`, pushes `bend2-trial` to `origin`, and records an operator
report with the issue and advertised commit. Keep each landing target branch
unchecked-out. The launcher prints the operator inbox command and root log path.

Rebuild the kit between lanes after native turns and supervisors have exited.
Running the launcher with the same paths preserves the database, native root
identity and first task file, refreshes the instructions and issue template, and
delivers pending root messages. The trial target is `bend2-trial`; the operator's
root owns promotion to master.
