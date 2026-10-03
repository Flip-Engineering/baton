# Baton2 command guide

The [architecture](../docs/bend2/architecture.md) describes the implemented
coordinator, native harness adapters, Git operations and recovery.

A Principal Conductor coordinates the overall work. An Associate Conductor
coordinates delegated work. Each individual agent, including a Conductor, is a
Player. Ensembles are coordinated teams, Sections are
capability-specific subgroups, and the Orchestra is the whole coordinated
system. The [naming legend](../docs/bend2/terminology.md) describes these roles
and groups and their runtime records. The examples use arbitrary session IDs
such as `root`, `lead` and `worker1`.

## Build and check

With Bend 2.0.25, clang and SQLite development headers available:

```sh
sh bend2/scripts/check-native.sh
```

The build uses `.bend/bin/bend` or `node_modules/.bend/bin/bend`. Set `BEND` to
another installed compiler path if needed. It emits C and links the native
executable at `.scratch/bend2/baton2`. Host bindings execute on Bend IO threads.
The [native installation procedure](../docs/bend2/installation.md) covers staging,
runtime paths, dependencies and retained state. [Harness setup](../docs/bend2/harness-setup.md)
describes the qualified routes. [Native artifacts](../docs/bend2/native-artifacts.md)
describes the exact-source packaging and extracted-use gates.

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

The historical helper integration requires an explicit local repository and revision.
It retains the exported source, complete helper output and process results:

```sh
python3 bend2/test/external/compare-original.py --old-repo /path/to/old/baton \
  --old-ref FULL_COMMIT --output /fresh/owned/comparison-test
```

## Coordinator storage

The executable stores sessions and messages and supervises foreground Claude
Code, Codex, OMP and Muse turns. Recruitment creates a Git worktree and records its resolved base. Native parent
delivery through Claude Code Channels MCP is connected to this interface. Git
landing advances a target branch to include a Player's committed tip, and the
checked landing (bend2/src/git/land_checked in bend2/src/git/land.bend)
prepares a squashed candidate in a scratch worktree, runs the selected checks
on the candidate and on a tree at the target tip, blocks on failures the
target run does not show, and advances the target through a compare-and-swap
ref update. A target that moved meanwhile returns a retry instruction and leaves
the candidate and Player work available. The next `land-checked` invocation
prepares and checks against the current target.

```sh
.scratch/bend2/baton2 state.db attach root claude-code ROOT_SESSION ENDPOINT
.scratch/bend2/baton2 state.db role root principal-conductor
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
returns the stored message with its current delivery receipt. Conflicting reuse of
an ID fails. `ack` records native acceptance after the adapter observes it.

`observe-file ID PLAYER PATH` consumes one
native harness event. An initialization event (type `session`) updates the
Player's observed native session and model. A terminal event (type `result`
or a terminal `agent_end`) creates a pending parent report containing the
extracted result text and records the turn. Non-terminal events are recorded
without creating a report. `observe-file` reads the JSON from a file. A repeated
observe with the same ID
and matching content returns the original result.

Requested and observed routes are stored separately. Reading status reports the
stored session binding; it does not establish that a process is alive.

`message ID SENDER RECIPIENT KIND BODY` and its `message-file` variant store
guidance and questions. `report` routes a report and `ask ID PLAYER BODY`
routes a question to the Player's recorded parent, with the same retry
behavior; `ask-file` reads the question from a path or `-` for stdin.
`delivery ID` returns the message with its recipient's current native endpoint.
`pending` returns undelivered messages with those current endpoints, and
`session ID` reads one stored binding. `connect ID NATIVE ENDPOINT` updates an
existing Player connection while retaining its parent and requested route.
`ENDPOINT` is an empty string to disconnect, or the literal JSON argv array
passed as one argument. The array contains a nonempty executable and text
arguments with no NUL characters. An invalid endpoint returns `invalid-endpoint`
with exit status 2 and keeps the stored binding and pending input. Inspect
`session` and `inbox`, connect valid argv, and retry the retained message ID.
Each CLI invocation opens the same
database, and SQLite serializes transactions.
Workspaces and source files are retained by these commands.

Public messages follow [the messaging contract](../docs/bend2/messaging.md).
Declare a Principal Conductor with `role SESSION principal-conductor` when the
session has no parent, or an Associate Conductor with
`role SESSION associate-conductor` when it has a parent. Unassigned sessions
are Players. A Conductor can message descendants, and subordinate agents can
message their immediate parent. Peer messages require shared tight Ensemble
membership; Conductor peers also require the same hierarchy depth. An
explicit operator identity communicates with top-level Conductors.

`ensemble ID OWNER` declares loose coupling. Add members with
`ensemble-member ID OWNER SESSION add`, then use `ensemble ID OWNER tight`
when the task requires direct peer communication. `role SESSION` and
`ensemble ID` read the declarations. Previously accepted input remains
available after configuration changes.

`players` reads all agent sessions, including both Conductor tiers; `player ID`
reads one Player. Results include the responsibility recorded by `role ID`.
Explicit operator identities are available through `session ID` and `status`.
The compatibility spelling `workers` retains its existing subordinate roster.

`section ENSEMBLE SECTION OWNER CAPABILITY` records a capability-specific
subgroup owned through that Ensemble. `section-member ENSEMBLE SECTION OWNER
PLAYER add|remove` manages members already in the named Ensemble. Removing an
Ensemble member also removes its Section memberships within that Ensemble.
Read a group with `section ENSEMBLE SECTION`. Section membership identifies
work organization; public messages use hierarchy and Ensemble coupling.

`orchestra` returns one stored-state snapshot containing Players, operators,
Ensembles, Sections and execution state and pending counts. Each database
represents its own Orchestra. See [terminology](../docs/bend2/terminology.md)
for the full naming contract.

## Status and report inspection

`player ID` reads one stored Player binding. Format the parsed JSON across
lines for review:

```sh
.scratch/bend2/baton2 state.db player worker1 | python3 -m json.tool
```

`orchestra` returns the stored snapshot. For a displayed copy, parse the
complete stdout and remove `latestReport` from the Players and operators
records:

```sh
.scratch/bend2/baton2 state.db orchestra | python3 -c '
import json, sys
snapshot = json.load(sys.stdin)
for row in snapshot["players"] + snapshot["operators"]:
    row.pop("latestReport", None)
print(json.dumps(snapshot, indent=2))
'
```

The displayed copy retains `latestReportId`, execution state, route, pending
counts and all Ensemble and Section records. The stored machine JSON keeps
every field, and all command behavior is unchanged. `delivery REPORT_ID`
returns the stored message with its full body, receipt and current recipient
endpoint. `turns PLAYER` lists native turn history with report bodies and
receipts. Capture complete stdout and parse it when reviewing a report body;
harness tool display can truncate long strings.

During an OMP turn, send guidance with:

```sh
.scratch/bend2/baton2 state.db message guide1 root worker1 guidance "Focus the review on recovery."
```

The supervisor forwards pending guidance through OMP's `steer` command when it
receives a native response, a completed message or a tool event. During a silent
tool run or a stream of text updates, guidance waits for the next such event.
The native response records the delivery receipt. Guidance
with no receipt remains in the Player's inbox for a later delivery attempt.

`recruit ID PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE` creates a branch
and worktree, then records the Player under its parent. A relative `PATH` is
resolved from `REPO`; the stored workspace path is absolute. The base is stored
as a commit ID. A matching repeated recruitment returns the existing Player.
Conflicting assignment fields return `player-assignment-conflict` with exit
status 2, the existing and requested assignments, and a next-step instruction.
The recorded assignment, binding, pending input, branch and workspace remain
available. Read `session ID` and `worktree ID`, retry the recorded assignment,
or recruit a new ID with a new branch and unused path.
`worktree ID` reads its current Git branch, commit and dirty state.

`land PLAYER_ID REPO TARGET_BRANCH` looks up the Player's branch from the
database, verifies the Player tip is a fast-forward from the target, and
advances the target with a compare-and-swap `update-ref`. The answer is JSON
with a `status` field: `landed` with the new target commit, `already` when the
target already contains the Player commit, or `blocked` with a reason (the
Player branch diverged or the target moved during the update). Player branches
and worktrees are retained after landing.

`land-checked PLAYER_ID REPO TARGET_BRANCH CHECK FILES` runs the gated landing.
CHECK runs as `/bin/sh CHECK FILE` inside each checked tree, once per selected
file per tree. `bend2/scripts/check-unittest.sh` judges one selected Python
test file: a selection under `bend2/test/` builds the coordinator binary in
the checked tree first, the selected file runs, and each failing case prints
one identity line of four hex-encoded fields: file, test id, failure type, and
semantic code. The `blocked` answer names every candidate failure line the
target run does not show. An unjudged candidate run blocks the landing; an
unjudged target run blocks when its candidate run fails. The gate reads failure
identities from stdout. Child stderr remains on the coordinator's stderr for
logging. A nonzero exit with empty stdout is unjudged.
The answer is JSON with a `status` field: `landed` with the new target commit
(the squash candidate), `already` naming the Player commit whose changes are
already present on the target, `conflict` naming the unmerged paths and the
scratch worktree it keeps, or `blocked` with a reason. A landing that answers `landed` or
`already` removes the candidate and target scratch worktrees as it answers. A
refused or conflicted landing keeps them for the requester, and that Player's
next landing request drops them before preparing its own.

If the target moves while checks run, the command returns `blocked` and names
`land-checked` as the retry. Repeating that command checks the new candidate and
target before advancing the branch. The Player's branch and worktree remain
available throughout these attempts.

The squash message describes the Player history above its merge-base with the
target. A single commit retains its full message. Several commits use the tip
commit's subject, with every branch commit's subject in the body, oldest first
in topological order. The body also names the Player branch and any ignored
paths dropped during landing.

## Native turns

After registering the Player, run:

```sh
.scratch/bend2/baton2 state.db turn worker1 turn1 HARNESS_COMMAND MODEL EFFORT WORKTREE TASK_FILE OUTPUT_LOG ""
```

The last argument is the native session to resume; an empty string starts a new
session. The Player's recorded harness selects the adapter. Claude uses stream JSON.
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
terminal envelope supplies the parent report. `players` includes the native
session ID and last completed turn for selecting a session to resume.
The harness uses its existing login. A launch wrapper can set the harness's documented home
or config environment before executing its binary. This command runs one foreground
native process, sends the task and drains output while writing input. Claude,
Codex and Muse input closes after the task; OMP input closes at turn completion.
A later turn resumes the recorded
native session. The logical Player and its workspace remain available.

The supervisor retains stdout at `OUTPUT_LOG` and stderr at `OUTPUT_LOG.stderr`.
For OMP, stdout logging omits cumulative `message_update` frames and retains
every other frame, including complete `message_end` messages, tool output and
terminal events. Log size grows with the retained output. New supervisors use
the executable built by the trial launcher; rebuilding applies this behavior to
subsequent turns. Existing logs remain available at their original paths.
Native result events create pending parent reports. Process-start failures and
exits without a result also create reports. Repeating a completed turn ID returns
its retained report. To retry after a failure report, use a new turn ID. Read
`session PLAYER` for its native session ID and pass that ID as the last `turn`
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
process fixture verifies supervision; a real subscription Player and a native
Conductor acceptance receipt are required for the live-slice result.

## Shared knowledge

Agents record findings with a claim, a retained evidence message and stated
limits. The evidence reference must name an existing message the author sent
or received. An unpublished finding is visible to its author and immediate
parent. `knowledge READER` returns the complete visible list, including the
cited message body and promotion history.

```sh
.scratch/bend2/baton2 state.db record finding1 worker1 'Observed claim' message:report1 'Observed limits'
.scratch/bend2/baton2 state.db knowledge root
.scratch/bend2/baton2 state.db promote promotion1 root worker1 root finding1
```

After reviewing the evidence, the destination scope's owner can explicitly
promote the exact finding from its named source scope. A shared scope includes
its owner, the owner's immediate parent and the owner's subtree. Higher
promotion names the scope that already carries the finding. The original
author and each promotion's source, destination and promoter remain recorded.
Declared scope IDs are logical session IDs. An Ensemble or Section brief names
the sessions involved; knowledge visibility follows the recorded parent links
and promotions described above.

## Native Conductor delivery

Register a Conductor and its native receiver endpoint using absolute paths. This
example creates a new Codex Conductor:

```sh
/repo/.scratch/bend2/baton2 /repo/state.db attach root codex '' '["/repo/.scratch/bend2/baton2","/repo/state.db","receive","root","/path/to/codex","gpt-6-astra","low","/repo","/repo/root-native.jsonl"]'
/repo/.scratch/bend2/baton2 /repo/state.db role root principal-conductor
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

When the Bend receive observer exits while its retained process owner and
native process survive, the owner keeps the session lock, native stdin, and
exit status, and starts a replacement observer with the recorded recovery
command. The replacement attaches to the existing attempt directory, reads
its output from the beginning under the original report ID and inbox cutoff,
and a contending receive answers `queued`. The
[detailed recovery description](../docs/bend2/receive-recovery-2026-09-28.md#attempt-ownership)
records this observer-loss boundary.

When a resumed attempt exits without a terminal event and its stderr records
a refused conversation, receive stores a recovery input with the workspace
Git status, clears the refused native identity, and records a parent notice.
The next receive reads the pending task with that recovery input and starts
a fresh attempt; native initialization records the fresh identity. Loss of the retained process owner while its native process survives
requires separate recovery work and validation; the observer-loss evidence
does not cover it ([recovery boundary](../docs/bend2/receive-recovery-2026-09-28.md#recovery-boundary)).
Recovery after loss of all coordinator and harness processes is described in
the [process-loss record](../docs/bend2/host-restart-2026-09-28.md); that run
kills processes while the host, its filesystem, and its storage keep running.
Host reboot and power-loss durability remain unvalidated.

For OMP, register harness `omp` and use its executable, model and effort in the
same endpoint. Each harness uses its existing login; a launch wrapper can set
its documented configuration environment. Native initialization records the
session ID. Subsequent turns resume that ID. Keep it when reconnecting an
existing Conductor with `connect`; the trial launcher preserves it automatically.
Codex retains conversations in its configured storage. Native OMP receive uses
`DATABASE.root-sessions` for parentless sessions and `DATABASE.session-HEX_ID`
for sessions with a parent. The Node OMP adapter uses `DATABASE.root-sessions`
for logical ID `root` and `DATABASE.session-HEX_ID` for other IDs. Each directory
stores conversations by their native identity; the path does not assign a role.

Retained OMP children send native input, selection, confirmation and editor
questions to their registered parent. The question names its request ID and
response shape. Use `native-reply PARENT REQUEST RESPONSE_JSON` or
`native-reply-file PARENT REQUEST PATH` to answer through the existing keeper.
`stdin-written` records transport completion; subsequent native output records
progress. See [native interaction semantics and limits](../docs/bend2/native-interactions.md).

Use `stop SESSION STOP_ID REASON` to end a retained OMP or Codex session. The
command records a terminal stop, prevents further queued execution and submits
TERM to its current native process group. `force-stop SESSION STOP_ID` explicitly
submits KILL to the same still-owned attempt. `session`, `inbox` and `pending`
retain the work, messages, receipts and stop state. The stop answer distinguishes
signal submission from actual exit; the observer reports completion to the
parent. Active direct `turn` execution returns an unsupported-stop refusal.
See [session stop behavior](../docs/bend2/native-interactions.md#terminal-session-stop).

`codex-conductor.mjs` and `omp-conductor.mjs` provide the Node adapters.
The former `*-root.mjs` paths forward to the canonical scripts for existing
endpoints. Native `receive` supplies the session ownership and
queued delivery described here. The trial launcher uses that native path.

`python3 bend2/scripts/accept-native-receive.py --config routes.json --output .scratch/native-review`
starts a Codex Conductor and two OMP source reviewers in an isolated clone. The route
file supplies each harness's executable, model and effort. The driver builds
the selected committed revision in the clone; `BEND` can select an installed
compiler. It verifies retained report text, acknowledgment, native session reuse
and unchanged source checkouts.
It retains the database, native logs, process records and source and binary hashes
under the output directory. The command starts real model sessions.

## Claude Code Conductor channel adapter

A Claude Code Conductor uses an interactive session with a Channels MCP configuration.
For example, save this as `conductor-mcp.json`, replacing `/repo` with absolute paths:

```json
{"mcpServers":{"baton-conductor":{"command":"node","args":["/repo/bend2/scripts/mcp-conductor.mjs","/repo/state.db","/repo/.scratch/bend2/baton2","--session","root"]}}}
```

```sh
claude --mcp-config conductor-mcp.json --dangerously-load-development-channels server:baton-conductor
```

Accept the local development-channel prompt. To recover a Conductor, use the same
command with `--resume NATIVE_SESSION` and the same database and harness
configuration. Claude resumes its conversation and the channel delivers pending
reports. Once initialized, the server attaches a local socket endpoint and
delivers pending messages after the client's discovery handshake.
Subsequent report writers notify that endpoint;
the server reads the committed message and emits a Claude channel notification.
The server stays attached to the Claude process. Its socket is created beside
the database and closes with the server.

The native Conductor reviews the report and records acceptance with
`ack ID root RECEIPT`. It can send guidance with `message`, inspect Git state
with `worktree`, and land and publish reviewed work with `land`, `land-checked`
and `push`. A report's receipt records the Conductor's acceptance; committing the
report alone leaves that receipt empty.

## OMP Associate Conductors and Players

A recruited OMP Player assigned as an Associate Conductor can receive reports
from its own Players. The examples use `lead` for that session and `root` for
the Principal Conductor. Recruit the Associate Conductor under the Conductor, then connect its
native receiver:

```sh
.scratch/bend2/baton2 state.db recruit lead root omp deepseek/deepseek-flash low REPO lead-branch LEAD_WORKTREE BASE
.scratch/bend2/baton2 state.db role lead associate-conductor
.scratch/bend2/baton2 state.db connect lead '' '["/repo/.scratch/bend2/baton2","/repo/state.db","receive","lead","/path/to/omp","","","","/repo/lead-native.jsonl"]'
```

A Kimi K3 Associate Conductor uses `omp kimi-code/k3 high` for the harness, model and effort
arguments. OMP supplies the configured `kimi-code` provider credentials. The
same receiver endpoint selects the Associate Conductor's registered route.

The empty launch fields select the Associate Conductor's recorded model, effort and workspace.
Explicit fields override those values for that invocation. Connection preserves
the Associate Conductor's parent, branch and base. Supply its stored native ID when reconnecting.
Messages addressed to the Associate Conductor invoke its endpoint; subsequent invocations
resume its native session. Each finished Associate Conductor turn submits its result through
the coordinator, which delivers the report to the Associate Conductor's parent. A failed native
turn also reports its failure and leaves unacknowledged input available.

Send the Associate Conductor's task with `message-file ID root lead task TASK_FILE`. The Associate Conductor
recruits children by passing `lead` as their parent, reviews their reports and
lands their branches onto `lead-branch`. Detach the Associate Conductor's checkout before a
landing advances that branch. The Conductor can then review and land the Associate Conductor's
registered branch through the same landing command.

Use the same receiver path for OMP children. After recruitment, register each
child's endpoint once and send its initial task:

```sh
.scratch/bend2/baton2 state.db recruit worker1 lead omp deepseek/deepseek-flash low REPO worker-branch PLAYER_WORKTREE lead-branch
.scratch/bend2/baton2 state.db connect worker1 '' '["/repo/.scratch/bend2/baton2","/repo/state.db","receive","worker1","/path/to/omp","","","","/repo/worker1-native.jsonl"]'
.scratch/bend2/baton2 state.db message-file worker1-task-1 lead worker1 task /repo/worker1-task.md
```

For a correction, send another `message-file` with a fresh message ID and task
file to the same Player. Receive resumes its stored native conversation, uses
its recorded route and workspace, and appends to its native log. A receiver that
finds an active turn returns `queued`; newly pending work starts after native exit.
The Player acknowledges accepted messages with `ack` and its final response
reports to the Associate Conductor automatically.

Run the task-sending commands in background processes with standard streams
redirected, then end the parent turn so incoming reports can resume it. The
[trial Associate Conductor instructions](trial/associate-conductor-instructions.md) give the launch examples.
The coordinator serializes native turns for each session. Muse children use
the direct `turn` command and an explicit native session ID for continuation.
Retained receive supports OMP and Codex within its documented
[recovery boundary](../docs/bend2/receive-recovery-2026-09-28.md#recovery-boundary).
OMP Associate Conductors and Players using receive retain conversations in
`DATABASE.session-HEX_ID`, with the session ID encoded as lowercase UTF-8 hex.
This preserves conversation storage used by the earlier OMP adapter.

`python3 bend2/scripts/accept-hierarchy.py --config routes.json --output .scratch/hierarchy-run`
exercises the earlier Conductor adapters with a Codex Conductor, an OMP Associate Conductor and two OMP
Players in a scratch clone.
The route file uses the `codex` and `omp` executable/model/effort entries described
below. Build the coordinator first; `--coordinator` selects another executable.
The run retains native events, process records, SQLite messages, guidance receipts
and both levels of checked landings in its output directory.

`python3 bend2/scripts/accept-kimi-hierarchy.py --config routes.json --tasks tasks.json --output .scratch/kimi-hierarchy`
builds the selected source in a scratch clone and runs a subscription Codex Conductor,
a Kimi OMP Associate Conductor, and concurrent DeepSeek and Muse Players. The route file has
`codex`, `lead`, `omp` and `muse` entries. The task file assigns each Player its
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

Run the Conductor's working day with logged-in native harnesses:

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

The sequence starts real Players on all four routes, interrupts and resumes their
native sessions, guides a running OMP Player, triggers native Codex and OMP Conductors
from Player reports, delivers a Claude channel notification, and recovers all
three Conductors. The Git stage lands reviewed Player commits, exercises a moving
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
  /path/to/repository /path/to/bend2-checkout /path/to/trial.db \
  /path/to/bend2-checkout/bend2/scripts/check-unittest.sh
```

The repository path names the task checkout, from whose `HEAD` the trial branch
is created. The Bend2 checkout supplies the tools. The fourth argument selects
the check program. Use `check-unittest.sh` for Python tests. Use
`check-node-test.sh` for an external JS repository whose runner supplies typed
`failures` and `reportedFiles` verdict fields. Each issue task names its selected
test paths, separated by spaces in one argument to `land-checked`.

The launcher builds the coordinator beside the database, creates `bend2-trial`
from the repository's `HEAD` if that branch is absent, and attaches a Codex
`gpt-6-astra` Conductor using the existing ChatGPT subscription login. `BATON_CODEX`,
`BATON_OMP` and `BATON_MUSE` can name native executables or local launch wrappers;
the defaults are `codex`, `omp` and `muse` on `PATH`. Node, Python 3, Git and the
native build prerequisites must be available. The repository's test dependencies
must resolve from the Player and the candidate/target worktrees. Set `BEND` to
an installed compiler for Python checks under `bend2/test/`; the launcher
resolves it to an absolute path in `environment.sh`, and those checks build the
coordinator in each checked tree. A missing dependency or failed build produces an unjudged check that
blocks landing.

The launcher writes current Conductor and Associate Conductor instructions, an issue task template,
and a first task file. Copy the printed template to an issue task file, fill in
the assigned issue, and send it with the printed coordinator command and a fresh
message ID. The Conductor follows [the Conductor instructions](trial/principal-conductor-instructions.md)
and connects an OMP Associate Conductor through native `receive`. The Associate Conductor follows
[the Associate Conductor instructions](trial/associate-conductor-instructions.md), recruits Players and lands
their reviewed changes onto its branch. Player reports resume the Associate Conductor; Associate Conductor
reports resume the Codex Conductor. The Conductor reviews and lands the Associate Conductor branch through
the selected check program, pushes `bend2-trial` to `origin`, and records an operator
report with the issue and advertised commit. Keep each landing target branch
unchecked-out. The launcher prints the operator inbox command and Conductor log path.

Rebuild the kit between lanes after native turns and supervisors have exited.
Running the launcher with the same paths preserves the database, native Conductor
identity and first task file, refreshes the instructions and issue template, and
delivers pending Conductor messages. The trial target is `bend2-trial`; the operator's
Conductor owns promotion to the repository's integration branch and tracker closure.
