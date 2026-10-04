# Bend2 architecture

This is the design of record for `bend2-rewrite`. The implementation is under
`bend2/`. The earlier [target architecture](target-architecture.md) and
[implementation plan](rewrite-plan.md) describe the proposal that preceded it.
This document describes the implemented system.

## Scope and execution

Bend2 coordinates native agent sessions on one host. A Principal Conductor
recruits Players, reads their reports, sends
guidance, reviews committed changes, lands them on a
local Git branch and publishes that branch to an explicit remote. Native
harnesses supply model access and conversation storage through their existing
logins. Bend2 supplies parent routing, retained messages, turn supervision and
Git operations.

An Associate Conductor coordinates delegated work. The
[naming legend](terminology.md) defines the coordination roles, Ensembles,
Sections and Orchestra. Stored parentage distinguishes Principal and Associate
Conductor responsibilities. Ensemble and Section records describe team and
capability membership. Stored roles, Ensemble membership and coupling
govern [public message routes](messaging.md).

The native executable is invoked as `baton2 DATABASE COMMAND ARGS`. Each
invocation opens the named SQLite database and performs its command. A `turn`
invocation remains in the foreground while it supervises one native process.
A `receive` invocation reads an attempt whose process owner survives loss of
that reader. Separate invocations share the database; SQLite serializes their
write transactions.

| Source | Responsibility |
| --- | --- |
| `bend2/src/coordinator/main.bend` | Parse and dispatch the command line. |
| `coordinator/commands.bend`, `store.bend` | Define records, command SQL, retry semantics and transactional writes. |
| `coordinator/recruit.bend`, `turn.bend` | Create Player workspaces and supervise native turns. |
| `coordinator/receive.bend` | Read parent input, select the native route and continue queued session work. |
| `coordinator/guidance.bend`, `delivery.bend` | Send OMP guidance and invoke the recipient endpoint after a committed message. |
| `bend2/src/harness/` | Construct the four harness launch and resume protocols. |
| `bend2/src/git/` | Inspect Git state, create worktrees, prepare and judge landings, update refs and push. |
| `bend2/src/host/` | Bind process, file and SQLite effects to the host. |
| `bend2/scripts/mcp-conductor.mjs` | Connect committed messages to an interactive Claude Code Conductor. |

Bend 2.0.25 emits C; the build links it with clang, pthreads and SQLite. The
Claude channel adapter uses Node's standard library, including `node:sqlite`.
Native `receive` supplies Codex and OMP Conductor delivery. Their earlier Node
adapters remain available for existing configurations.
Application decisions live in the Bend modules; C bindings perform host effects.
Production modules are imported libraries. Earlier JSON and replay experiments
and their frozen-output checks remain optional reference programs.

## Store and identity

The core session and message records are:

| Table | Meaning |
| --- | --- |
| `sessions` | A logical session, parent, requested route, observed route, native session ID, delivery endpoint, workspace, branch and resolved base commit. |
| `messages` | Ordered messages with caller-supplied unique IDs, sender, recipient, kind, full body and optional native acceptance receipt. |
| `turns` | A completed turn's report ID, Player and native terminal event. |
| `session_roles` | An explicit Player, Conductor or operator assignment; an unassigned session is a Player. |
| `ensembles` | A declared Conductor owner and loose or tight coupling. |
| `ensemble_members` | Registered agent session IDs belonging to an Ensemble. |
| `sections` | A capability-specific subgroup identified within one Ensemble. |
| `section_members` | Section membership constrained to members of its Ensemble. |

Execution, stop, native request and knowledge records retain the state described
in their workflow sections.

A store mutation runs schema creation and its command SQL inside
`BEGIN IMMEDIATE` and `COMMIT`. Report creation saves the full body addressed to
the Player's recorded parent. Native terminal observation also records the turn.
Recipient delivery starts after the transaction commits. A delivery failure leaves
the message available in the database and returns an error to the writer.

A matching retry of a message ID, sender, recipient, kind and body returns its
retained result and receipt.
Conflicting reuse of an ID fails. A repeated completed turn ID returns its
existing report. Retrying failed work uses a new turn ID and may resume the
same native session. `ack ID RECIPIENT RECEIPT` records the recipient's native
acceptance. It does not state that a branch was reviewed or landed; the receipt
body and Git result establish those separate facts.

The native session ID refers to the harness's retained conversation. The logical
Player ID routes messages and associates a workspace with that conversation.
Requested harness/model/effort and observed values occupy separate fields.
Codex's Player events identify its session but do not identify its model, so the
observed model remains empty. `status`, `players`, `session`, `turns`, `inbox`,
`pending` and `delivery` read stored facts. `worktree` asks Git for current state.
Stored session presence does not establish a live process.

All processes operate with the local user's access. Session IDs and parent links
supply routing. They do not create an authorization boundary between agents.
The database, executable paths and Conductor endpoint are trusted local inputs.

`role SESSION principal-conductor` requires a parentless agent;
`role SESSION associate-conductor` requires an agent with a parent. Stored
Conductor assignments retain the `conductor` family, and queries derive the
public tier from the session parentage. An agent Principal Conductor and a
human operator session can both have `parent=null`; `role SESSION operator`
explicitly declares the operator identity. Declared knowledge scope IDs are logical session IDs,
whose owners and parent links determine visibility.

`players` lists all non-operator sessions, including both Conductor tiers.
`player ID` reads an individual agent; `orchestra` reads Players, operators,
Ensembles, Sections and execution state and pending counts together. An
Orchestra can contain several Principal Conductors. The compatibility command
`workers` retains its subordinate roster. Existing database column names and
native storage paths remain valid for retained state.

A Section inherits its Ensemble owner. Members must already belong to that
Ensemble. Removing an Ensemble member also removes its Section memberships
within that Ensemble. Section membership describes capability-specific work;
message routing uses the existing hierarchy and Ensemble coupling.

## Players and turns

`recruit` takes an explicit parent, harness, model, effort, repository, branch,
worktree path and base. It creates the branch and worktree, resolves the base to
a commit, then records the Player. A matching repeat returns the existing Player.
`bind` records observed native identity and route; `connect` updates a native
connection while retaining parentage and requested
route.

A separate `turn` command takes the Player, unique turn ID, native executable,
model, effort, working directory, task file, output log and optional native
session ID. `turn` and `receive` acquire the same OS file lock for each logical
session. Its key uses the canonical database path and UTF-8 session identity.
Different sessions use different locks and can run concurrently. The supervisor
retains ownership until the native process exits and releases it before parent
delivery. An overlapping direct `turn` returns an active-session error; queued
input uses messages and `receive`. Both commands use the canonical database
path for OMP conversation storage. The lock records no durable session state.

| Player harness | Native protocol and retained identity |
| --- | --- |
| Claude Code | Streaming JSON in print mode; native initialization identifies the session; resume passes the saved session ID. |
| Codex | `exec --json`, with task on stdin; `exec resume SESSION` continues the conversation. The supervisor retains the current assistant and terminal events while draining native output. |
| OMP | RPC mode with session files beside the database. `get_state` supplies observed identity and model. Stdin remains open until turn completion. |
| Muse | `exec --json --prompt-file`, with `--session-id` for resume. Session and terminal envelopes supply native identity, model and report text. |

The supervisor drains native output and records relevant events. For OMP it
logs every frame except `message_update`; `message_end` retains each complete
message. Other harness frames go to the supplied log unchanged. Stderr has a
separate file. Terminal output becomes a parent report. If OMP omits the terminal
message list, the latest assistant `message_end` supplies the report.
Start failures, output-observation failures and exits without a native result
also produce parent reports. The parent decides the next task; a turn ending
does not remove the Player or workspace.

Players use `ask` or `ask-file` for parent questions and `report` for explicit
parent reports. `message` and `message-file` admit inputs from a Conductor to
any descendant, from a subordinate to its immediate parent, between explicitly
tight Ensemble peers, and between an operator and a top-level Conductor.
Conductor peers require equal hierarchy depth. Ancestor and descendant
relationships cannot qualify as peers. Loose coupling is the default.
A denied route stores no message and invokes no recipient endpoint. Accepted
pending input remains deliverable after role or membership changes.
During an OMP turn
the supervisor sends pending guidance as native `steer` frames on response, message
completion and tool events. A successful native steer response records its
receipt. Guidance during a silent tool operation waits for the next relevant
native event. Other Player harnesses currently receive further instructions
through their next explicitly started native turn; their inbox remains readable.

## Conductor delivery

The recipient endpoint is an executable argv array stored in its session row. The
process that commits a report, question or message invokes that
endpoint with the message ID. The writer waits for delivery to return and keeps
receiver output at `DATABASE.root.log`. `attach` or `connect` registers the
explicit endpoint.

### Codex and OMP

The endpoint invokes `receive SESSION HARNESS_COMMAND MODEL EFFORT CWD
OUTPUT_LOG MESSAGE_ID`. Empty model, effort and working-directory arguments
select the recorded session values. The executable and log path are required.
The receiver reads pending messages under session ownership and supervises the
native turn through the Player harness code. The recipient reviews the input
and acknowledges it with coordinator commands.

A receiver that finds an active turn returns `queued`. The active supervisor
releases ownership after native exit, then checks for newly pending input and
invokes the receiver again. Reading after release covers messages committed
while the previous turn was ending. Pending messages remain in the existing
SQLite inbox. A failed turn retains unacknowledged input for later delivery.

Receive retains each attempt's launch arguments, initial input, recovery command,
native stdout and stderr beside the database. A process owner holds the session lock,
native stdin and exit status. It restarts the Bend observer when the observer's
connection closes before completion acknowledgment. Recovery reads the existing
attempt with its original report ID and inbox cutoff. The owner releases its lock
after native exit and completion preparation, and exits after the observer
finishes parent delivery and pending-input continuation. Successful acknowledgment
removes the temporary raw stdout file; the filtered native log remains.
The [recovery validation](receive-recovery-2026-09-28.md) records the tested
process-loss boundary.

When a resumed attempt exits without a terminal event and its stderr reports a
missing conversation, receive records a recovery input containing the workspace's
Git status. The same transaction clears the refused native identity and records
a parent notice named `<attempt>:recovery`. Normal receive then reads the pending
task and recovery input under the session lock and starts a fresh retained attempt.
Native initialization records the fresh identity. The recovery input also records
that the transition occurred, so replay of the refused attempt preserves the new
identity. Fresh completion has its own attempt ID.

Native initialization binds the session ID in the existing row. Later turns
resume it. Codex retains conversations in its configured storage. Native OMP
receive uses `DATABASE.root-sessions` for parentless sessions and
`DATABASE.session-HEX_ID` for sessions with a parent. The Node OMP adapter uses
`DATABASE.root-sessions` for logical ID `root` and `DATABASE.session-HEX_ID` for
other IDs. Each directory stores conversations by their native identity; its
path does not assign a Conductor role.
The trial launcher preserves the
Conductor ID, registers its native endpoint and replays pending input. A launch
wrapper supplies harness-specific configuration or login settings.

`codex-conductor.mjs` and `omp-conductor.mjs` provide the Node adapters.
The former `*-root.mjs` paths forward to these canonical entry points for
existing endpoints. New trial Conductors use native `receive`. Claude's
channel transport remains the runtime component that requires Node.

### Claude Code Channels

An interactive Claude Code Conductor loads `mcp-conductor.mjs` through its Channels MCP
configuration. The server uses newline-delimited JSON-RPC over stdio and
advertises the Claude channel capability. It exposes tools that invoke the
coordinator for reads and mutations.

The server creates a local socket beside the database and records a one-shot
socket client as its receive endpoint. A report writer calls that client; the
server reads the committed message and sends
`notifications/claude/channel` with its full content and string metadata.
The native channel notification starts the Conductor's turn. The Conductor calls
`baton2_ack` after accepting the report.

On attachment, pending messages wait until tool discovery completes a client
`ping` round trip. That order addresses the observed native startup replay loss.
The server's in-memory sent set suppresses repeated notifications during that
process lifetime. On restart it reads pending messages from SQLite again.
The interactive Conductor must enable the local development channel. Its native
session is resumed with the same database and MCP configuration.

## Landing and publication

Players commit on their own branches. The Conductor inspects the Player's report,
branch and worktree, then chooses the landing command and any check selection.

`land` handles a fast-forward from the target to the Player's committed tip.
It returns `landed`, `already` when the target contains the Player commit, or
`blocked` when it cannot advance the target safely.

`land-checked` creates a scratch worktree, prepares a squashed candidate and
runs the supplied check script for each selected file on the candidate and the
target tree. Added build output excluded by the repository's ignore rules is
dropped from the candidate and named in its commit message. Checks emit failure
identities comprising file, test, failure type and semantic code. Candidate
failures absent from the target block the landing. An unjudged candidate run
blocks and names its cause; an unjudged target run blocks when its candidate run
fails. The caller supplies the check script and file selection; the coordinator
does not infer a suite from changed paths.

The target advances through a compare-and-swap ref update using the checked
candidate and the checked target commit as the expected old value. If the target
moved during the checks, the command returns `blocked` with a retry instruction.
A failed ref update returns a command failure. A new `land-checked` invocation
prepares and checks a candidate against the current target. Conflicts name the
paths and the scratch checkout they keep. A landing that answers
`landed` or `already` removes the candidate and target worktrees it prepared; a
refused or conflicted landing keeps them for the requester, and that Player's
next landing request drops them before preparing its own. A target held by a checked-out worktree produces the current
`target busy` command failure. Player guidance can resolve the branch against
the moved target, after which a new landing request judges the revised work.

`landed` names the new target commit; `already` names the Player commit that
needs no further landing. Landing retains the Player branch and workspace.
`push REPO BRANCH REMOTE` then runs Git's ordinary push. Its JSON answer reports
`pushed` with the branch and remote, or `rejected` with a generated reason naming
the failed command. `remote-tip REPO BRANCH REMOTE` reads the declared remote
with `git ls-remote` and answers the advertised object, an absent branch, or the
read's own exit status. The acceptance run verifies publication with
`git ls-remote` against its declared scratch bare remote, including refusal after
the remote moves incompatibly. Repository network publication is the operator's
explicit operation.

## Recovery and current limits

Recovery retains SQLite, native conversation storage, output files and Git
worktrees. The caller reads a Player's native ID and starts a new turn using it
in the same workspace. A Codex or OMP Conductor reattaches and resumes its recorded
native session. Claude resumes its interactive session and reloads the channel;
pending messages replay after discovery. A crash before acknowledgment can
produce repeated input. Messages awaiting receipts are derived from SQLite.

The real recovery runs killed the owned coordinator, adapter and native
processes and resumed every tested session with pending work. They did not
reboot the machine or the shared resident. There is no automatic host-start
reconciliation, process discovery or Player cleanup. `stop` ends a retained OMP
or Codex session, with explicit `force-stop` for the same owned attempt. Native
output, receipts and workspace remain available; queued execution is stopped.
Worktrees survive landing, turn end and process loss. Cleanup remains an
explicit operator action after determining the work is no longer needed.

## Acceptance

The [shared knowledge workflow](knowledge-context-2026-09-29.md) adds recording,
scoped retrieval, explicit promotion and destination-owner notification in the
existing coordinator database. The [real acceptance](knowledge-context-2026-10-01.md)
records producer investigation, Conductor evidence review, promotion, sibling retrieval,
fresh-conversation retrieval after receipts and separately promoted correction.
Its Conductor endpoint collected notices; scope selection used trusted declared actors.
The owner chooses which Ensembles receive further messages.

The implemented paths support OMP, Codex, Claude Code and Muse Players;
OMP guidance during a turn; report-triggered Codex, OMP and Claude Conductor turns;
review, checked landing, target movement, conflict resolution and publication;
and native Player and Conductor recovery after owned-process loss. The September
2026 records below exercised selected paths at their listed source revisions. The
[2026-09-27 root-day record](root-day-2026-09-27.md) starts from source base
`3ddc0363e22acf287e23d9364f1195a0cf2e6c5c`; its report-triggered follow-up names
worker source base `de2a9944`. Those runs apply to their recorded source revisions.
The [current 1.0 scope](release-1.0.md) declares the qualified native routes and
recovery boundaries. Native logs, SQLite rows, receipts and Git refs retain the
evidence for each run.

Historical runs are recorded in [Conductor delivery](root-day-2026-09-27.md),
[Conductor recovery](root-recovery-2026-09-27.md),
[Player landing](live-worker-2026-09-26.md) and
[target movement and resolution](target-move-2026-09-27.md). Those records name
what ran at their source revisions; they are not maintained runtime state.
