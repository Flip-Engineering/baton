# Baton in Bend2

The [design](../docs/bend2/target-architecture.md) describes a local coordinator,
native harness adapters and Git operations. The
[implementation plan](../docs/bend2/rewrite-plan.md) names the first live slice.

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
Code and OMP turns. Recruitment creates a Git worktree and records its resolved base. Native parent
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

`observe-file ID WORKER PATH` consumes one native JSON event. An initialization
event updates the observed session/model; a Claude result or terminal OMP
`agent_end` event saves a
parent report automatically and retains the complete source event. Native failure
results reach the parent as well. `observe` accepts the JSON as an argument.

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

## Native turns

After registering the worker, run:

```sh
.scratch/bend2/baton2 state.db turn worker1 turn1 HARNESS_COMMAND MODEL EFFORT WORKTREE TASK_FILE OUTPUT_LOG ""
```

The last argument is the native session to resume; an empty string starts a new
session. The worker's recorded harness selects the adapter. Claude uses stream JSON; OMP
uses `--print --mode json` and retains sessions beside the database. The harness
uses its existing login. A launch wrapper can set the harness's documented home
or config environment before executing its binary. This command runs one foreground
native process, sends the task, drains output while writing input, and closes
that process's input stream after the task. A later turn resumes the recorded
native session. The logical worker and its workspace remain available.

The supervisor retains stdout at `OUTPUT_LOG` and stderr at `OUTPUT_LOG.stderr`.
Native result events create pending parent reports. Process-start failures and
exits without a result also create reports. Repeating a completed turn ID returns
its retained report. `pending` shows reports awaiting native acceptance; delivery
is still being connected. Run one foreground turn at a time for a worker.

The check command builds the coordinator, process and Git test executables, then
runs persistence, recruitment, Git, OS-process and controlled-protocol tests. A controlled
process fixture verifies supervision; a real subscription worker and a native
root acceptance receipt are required for the live-slice result.

## Source layout

Application logic belongs in imported Bend2 modules under `src/`. Small C
bindings supply host primitives. Tests have separate entry points and exercise
the native executable.

The existing JSON and replay programs are earlier experiments. Their optional
runner, `node bend2/scripts/run-checks.mjs`, compares interpreted and native
output with their `.expected.txt` fixtures. It can install Bend locally if
absent. Application modules need no law annotations, frozen output fixtures or
independent `main` function.
