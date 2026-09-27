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

## Coordinator storage

The executable stores sessions and messages and supervises foreground Claude
Code, Codex, OMP and Muse turns. Recruitment creates a Git worktree and records its resolved base. Native parent
delivery through Claude Code Channels MCP is connected to this interface. Git
landing advances a target branch to include a worker's committed tip, and the
checked landing (bend2/src/git/land_checked in bend2/src/git/land.bend)
prepares a squashed candidate in a scratch worktree, runs the selected checks
on the candidate and on a tree at the target tip, blocks on failures the
target run does not show, and advances the target through a compare-and-swap
ref update; a target that moved meanwhile rebases the candidate once.

```sh
.scratch/bend2/baton2 state.db attach root claude-code ROOT_SESSION ENDPOINT
.scratch/bend2/baton2 state.db recruit worker1 root omp MODEL high REPO BRANCH WORKTREE BASE
.scratch/bend2/baton2 state.db bind worker1 NATIVE_SESSION omp OBSERVED_MODEL high
.scratch/bend2/baton2 state.db report-file turn1 worker1 REPORT_FILE
.scratch/bend2/baton2 state.db inbox root
.scratch/bend2/baton2 state.db ack turn1 root NATIVE_ACCEPTANCE_RECEIPT
.scratch/bend2/baton2 state.db land worker1 /path/to/repo target-branch
.scratch/bend2/baton2 state.db push /path/to/repo target-branch origin
.scratch/bend2/baton2 state.db status
```

Commands return JSON. `report-file` accepts `-` to read stdin. It saves the full
body and pending parent delivery in one SQLite transaction. A matching retry
returns the first result, including its delivery receipt. Conflicting reuse of
an ID fails. `ack` records native acceptance after the adapter observes it.

`observe ID WORKER EVENT_JSON` and `observe-file ID WORKER PATH` consume one
native harness event. An initialization event (type `session`) updates the
worker's observed native session and model. A terminal event (type `result`
or a terminal `agent_end`) creates a pending parent report containing the
extracted result text and records the turn. Non-terminal events are recorded
without creating a report. `observe-file` reads the JSON from a file; `observe`
accepts it as a command-line argument. A repeated observe with the same ID
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
`worker` registers an existing workspace. If registration fails after Git has
created a worktree, the checkout is retained and can be registered with `worker`.

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
answer is JSON with a `status` field: `landed` with the new target commit
(the squash candidate), `already` naming the worker commit the target
contains, `conflict` naming the unmerged paths and the retained scratch
worktree, or `blocked` with a reason.

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
Codex uses `exec --json` and `exec resume SESSION`, with the task on stdin.
Its thread event records the native session. After process exit, the supervisor
reads the final assistant message and terminal event from the retained output
log to produce the parent report. Codex events do not name the observed model;
that field stays empty.
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
Native result events create pending parent reports. Process-start failures and
exits without a result also create reports. Repeating a completed turn ID returns
its retained report. To retry after a failure report, use a new turn ID. Read
`session WORKER` for its native session ID and pass that ID as the last `turn`
argument to continue the same conversation. For example:

```sh
.scratch/bend2/baton2 state.db session worker1
.scratch/bend2/baton2 state.db turn worker1 turn2 HARNESS_COMMAND MODEL EFFORT WORKTREE NEXT_TASK_FILE NEXT_OUTPUT_LOG NATIVE_SESSION
```

`pending` shows reports awaiting native acceptance. The root adapters in the
next section read messages addressed to a root session directly from the
database. Run one foreground turn at a time for a worker.

The check command builds the coordinator, process and Git test executables, then
runs persistence, recruitment, Git, OS-process and controlled-protocol tests. A controlled
process fixture verifies supervision; a real subscription worker and a native
root acceptance receipt are required for the live-slice result.

## Root adapters

Attach a Codex or OMP root to the database with its model and native executable:

```sh
CODEX_ROOT_MODEL=gpt-6-astra node bend2/scripts/codex-root.mjs state.db .scratch/bend2/baton2 codex --attach
OMP_ROOT_MODEL=deepseek/deepseek-flash OMP_ROOT_THINKING=low node bend2/scripts/omp-root.mjs state.db .scratch/bend2/baton2 omp --attach
```

Attachment records the adapter invocation in the existing root session's
`endpoint`, processes pending messages once and exits. When a coordinator
process commits a report, question or message addressed to that root, it invokes
the adapter for that message. The adapter starts one native root turn and the
writer waits for it to finish. Its output is retained at `DATABASE.root.log`.
A failed delivery leaves the committed message available in the pending inbox
and makes the writer return an error. Attaching again or running the adapter
with `--once` delivers pending messages. Native initialization records the root's
session ID. Later invocations resume that session, including after process loss.
Keep the same database and harness configuration when reattaching. Codex retains
its native session in its configured home; OMP stores root sessions in
`DATABASE.root-sessions`.

The database path comes first, followed by optional coordinator and native
executable paths. The coordinator defaults to `.scratch/bend2/baton2`; native
executables default to `codex` and `/opt/homebrew/bin/omp`. `--once` is the
mode when no flag is given. Codex reads `CODEX_ROOT_MODEL` (default `o4-mini`).
OMP reads `OMP_ROOT_MODEL` (default `zai/glm-5.3-flash`) and
`OMP_ROOT_THINKING` (default `high`). Attachment preserves these selections in
the invocation. Each harness uses its existing login. Pass a launch wrapper
as the native executable to set the harness's home or config environment.

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

## Source layout

Application logic belongs in imported Bend2 modules under `src/`. Small C
bindings supply host primitives. Tests have separate entry points and exercise
the native executable.

The existing JSON and replay programs are earlier experiments. Their optional
runner, `node bend2/scripts/run-checks.mjs`, compares interpreted and native
output with their `.expected.txt` fixtures. It can install Bend locally if
absent. Application modules need no law annotations, frozen output fixtures or
independent `main` function.

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
