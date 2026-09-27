# Bend2 architecture

This is the design of record for `bend2-rewrite`. The implementation is under
`bend2/`. The earlier [target architecture](target-architecture.md) and
[implementation plan](rewrite-plan.md) describe the proposal that preceded it.
This document describes the implemented system.

## Scope and execution

Bend2 coordinates native agent sessions on one host. A root recruits workers,
reads their reports, sends guidance, reviews committed changes, lands them on a
local Git branch and publishes that branch to an explicit remote. Native
harnesses supply model access and conversation storage through their existing
logins. Bend2 supplies parent routing, retained messages, turn supervision and
Git operations.

The native executable is invoked as `baton2 DATABASE COMMAND ARGS`. Each
invocation opens the named SQLite database and performs its command. A `turn`
invocation remains in the foreground while it supervises one native process.
There is no resident coordinator process. Separate invocations share the
database; SQLite serializes their write transactions.

| Source | Responsibility |
| --- | --- |
| `bend2/src/coordinator/main.bend` | Parse and dispatch the command line. |
| `coordinator/commands.bend`, `store.bend` | Define records, command SQL, retry semantics and transactional writes. |
| `coordinator/recruit.bend`, `turn.bend` | Create worker workspaces and supervise native turns. |
| `coordinator/guidance.bend`, `root.bend` | Send OMP guidance and invoke a root endpoint after a committed message. |
| `bend2/src/harness/` | Construct the four harness launch and resume protocols. |
| `bend2/src/git/` | Inspect Git state, create worktrees, prepare and judge landings, update refs and push. |
| `bend2/src/host/` | Bind process, file and SQLite effects to the host. |
| `bend2/scripts/*-root.mjs` | Connect committed messages to Codex, OMP and Claude Code root turns. |

Bend 2.0.25 emits C; the build links it with clang, pthreads and SQLite. The
three root adapters use Node's standard library, including `node:sqlite`.
Application decisions live in the Bend modules; C bindings perform host effects.
Production modules are imported libraries. Earlier JSON and replay experiments
and their frozen-output checks remain optional reference programs.

## Store and identity

The database holds three tables:

| Table | Meaning |
| --- | --- |
| `sessions` | A logical root or worker, parent, requested route, observed route, native session ID, delivery endpoint, workspace, branch and resolved base commit. |
| `messages` | Ordered messages with caller-supplied unique IDs, sender, recipient, kind, full body and optional native acceptance receipt. |
| `turns` | A completed turn's report ID, worker and native terminal event. |

A store mutation runs schema creation and its command SQL inside
`BEGIN IMMEDIATE` and `COMMIT`. Report creation saves the full body addressed to
the worker's recorded parent. Native terminal observation also records the turn.
Root delivery starts after the transaction commits. A delivery failure leaves
the message available in the database and returns an error to the writer.

A matching retry of a message ID returns its retained result and receipt.
Conflicting reuse of an ID fails. A repeated completed turn ID returns its
existing report. Retrying failed work uses a new turn ID and may resume the
same native session. `ack ID RECIPIENT RECEIPT` records the recipient's native
acceptance. It does not state that a branch was reviewed or landed; the receipt
body and Git result establish those separate facts.

The native session ID refers to the harness's retained conversation. The logical
worker ID routes messages and associates a workspace with that conversation.
Requested harness/model/effort and observed values occupy separate fields.
Codex's worker events identify its session but do not identify its model, so the
observed model remains empty. `status`, `workers`, `session`, `turns`, `inbox`,
`pending` and `delivery` read stored facts. `worktree` asks Git for current state.
Stored session presence does not establish a live process.

All processes operate with the local user's access. Session IDs and parent links
supply routing. They do not create an authorization boundary between agents.
The database, executable paths and root endpoint are trusted local inputs.

## Workers and turns

`recruit` takes an explicit parent, harness, model, effort, repository, branch,
worktree path and base. It creates the branch and worktree, resolves the base to
a commit, then records the worker. A matching repeat returns the existing worker.
`worker` registers an existing workspace; it can retain a checkout after a
registration failure. `bind` records observed native identity and route;
`connect` updates a native connection while retaining parentage and requested
route.

A separate `turn` command takes the worker, unique turn ID, native executable,
model, effort, working directory, task file, output log and optional native
session ID. The caller runs one foreground turn at a time for each worker.

| Worker harness | Native protocol and retained identity |
| --- | --- |
| Claude Code | Streaming JSON in print mode; native initialization identifies the session; resume passes the saved session ID. |
| Codex | `exec --json`, with task on stdin; `exec resume SESSION` continues the conversation. The supervisor derives the final report from the assistant and terminal events in the saved log after process exit. |
| OMP | RPC mode with session files beside the database. `get_state` supplies observed identity and model. Stdin remains open until turn completion. |
| Muse | `exec --json --prompt-file`, with `--session-id` for resume. Session and terminal envelopes supply native identity, model and report text. |

The supervisor drains native output to the supplied log and records relevant
events. Stderr has a separate file. Terminal output becomes a parent report.
Start failures, output-observation failures and exits without a native result
also produce parent reports. The parent decides the next task; a turn ending
does not remove the worker or workspace.

Workers can use `ask` and `report`, including file variants, to address their
parent. `message` and `message-file` route other inputs. During an OMP turn the
supervisor sends pending guidance as native `steer` frames on response, message
completion and tool events. A successful native steer response records its
receipt. Guidance during a silent tool operation waits for the next relevant
native event. Other worker harnesses currently receive further instructions
through their next explicitly started native turn; their inbox remains readable.

## Root delivery

The root endpoint is an executable argv array stored in its session row. The
process that commits a root-directed report, question or message invokes that
endpoint with the message ID. The writer waits for delivery to return and keeps
adapter output at `DATABASE.root.log`. The root adapter registers its own
endpoint. No endpoint discovery is performed.

### Codex and OMP

`codex-root.mjs` and `omp-root.mjs` accept the database, coordinator executable
and native executable. `--attach` stores their invocation, processes pending
messages once and exits. A later report writer starts the adapter for its
message. The adapter builds native input from committed messages; the native
root reviews it and acknowledges through coordinator commands.

Native initialization binds the root's session ID in the existing session row.
Later invocations resume it. Codex retains conversation files in its configured
home; OMP uses `DATABASE.root-sessions`. Reattaching preserves the native ID and
delivers pending messages. A launch wrapper supplies any harness-specific home
or login environment. Root model selections and OMP thinking selection are retained in the
registered invocation.

### Claude Code Channels

An interactive Claude Code root loads `mcp-root.mjs` through its Channels MCP
configuration. The server uses newline-delimited JSON-RPC over stdio and
advertises the Claude channel capability. It exposes tools that invoke the
coordinator for reads and mutations.

The server creates a local socket beside the database and records a one-shot
socket client as its root endpoint. A report writer calls that client; the
server reads the committed message and sends
`notifications/claude/channel` with its full content and string metadata.
The native channel notification starts the root's turn. The root calls
`baton2_ack` after accepting the report.

On attachment, pending messages wait until tool discovery completes a client
`ping` round trip. That order addresses the observed native startup replay loss.
The server's in-memory sent set suppresses repeated notifications during that
process lifetime. On restart it reads pending messages from SQLite again.
The interactive root must enable the local development channel. Its native
session is resumed with the same database and MCP configuration.

## Landing and publication

Workers commit on their own branches. The root inspects the worker's report,
branch and worktree, then chooses the landing command and any check selection.

`land` handles a fast-forward from the target to the worker's committed tip.
It returns `landed`, `already` when the target contains the worker commit, or
`blocked` when it cannot advance the target safely.

`land-checked` creates a scratch worktree, prepares a squashed candidate and
runs the supplied check script for each selected file on the candidate and the
target tree. Added build output excluded by the repository's ignore rules is
dropped from the candidate and named in its commit message. Checks emit failure
identities comprising file, test, failure type and semantic code. Candidate
failures absent from the target block the landing. An unjudged run also blocks
and names its cause. The caller supplies the check script and file selection;
the coordinator does not infer a suite from changed paths.

The target advances through a compare-and-swap ref update. If it moved during
the check, the candidate is rebased onto the new target and the existing verdict
is used. The current implementation makes one rebase attempt and returns a
blocked result if the target moves again. Conflicts name the paths and retained
scratch checkout. A target held by a checked-out worktree produces the current
`target busy` command failure. Worker guidance can resolve the branch against
the moved target, after which a new landing request judges the revised work.

The successful result names the commit now on the target. Landing retains the
worker branch and workspace. `push REPO BRANCH REMOTE` then runs Git's ordinary
push and reports `pushed` or `rejected` with the command output. The acceptance
run verifies publication with `git ls-remote` against its declared scratch bare
remote, including refusal after the remote moves incompatibly. Repository
network publication is the operator's explicit operation.

## Recovery and current limits

Recovery retains SQLite, native conversation storage, output files and Git
worktrees. The caller reads a worker's native ID and starts a new turn using it
in the same workspace. A Codex or OMP root reattaches and resumes its recorded
native session. Claude resumes its interactive session and reloads the channel;
pending messages replay after discovery. A crash before acknowledgment can
produce repeated input. Messages awaiting receipts are derived from SQLite.

The real recovery runs killed the owned coordinator, adapter and native
processes and resumed every tested session with pending work. They did not
reboot the machine or the shared resident. There is no automatic host-start
reconciliation, process discovery, worker cleanup or coordinator stop command.
Worktrees survive landing, turn end and process loss. Cleanup remains an
explicit operator action after determining the work is no longer needed.

## Deliberate omissions from the JS runtime

The rewrite's acceptance is the root's working day described above. These old
runtime facilities are outside this design:

| JS runtime facility | Bend2 scope |
| --- | --- |
| Resident deployment lifecycle, HTTP/web operator surface and general MCP command bridge | A native command executable and three purpose-specific root adapters. |
| Swarms, seats, waves, assignment boards, resource leases and concurrency admission | Explicit workers under a parent, with foreground turns started by that parent. |
| Route catalogs, credential probes, quota tracking and automatic provider rerouting | Caller-selected harness/model/effort using an existing native login. |
| Delegation grants, exclusive writer couplings and contribution review roles | Trusted local command access, native review and direct Git commands. |
| Contribution capture, integration queue and deployment-wide test selection | Committed worker branches, an explicit checked landing and caller-selected checks. |
| Knowledge stores, packages, scratchpad elevation and composed recruitment briefs | Task files, native conversation context and coordinator messages. |
| Operational event replay, wake subscriptions and resident recovery machinery | Current SQLite records, native session storage and direct post-commit root delivery. |
| Automatic workspace reclamation, old-state migration and old protocol compatibility | Retained workspaces and a separate Bend2 database. |
| Budget and usage telemetry, host scheduling | The orchestrator decides continuation from reports and actual task needs. |

These omissions do not define a compatibility backlog. Add behavior when a real
use fails without it, following `AGENTS.md`.

## Acceptance

The root-day acceptance exercises real OMP, Codex, Claude Code and Muse workers;
OMP guidance during a turn; report-triggered Codex, OMP and Claude root turns;
review, checked landing, target movement, conflict resolution and publication;
and native worker and root recovery after owned-process loss. The entry point
and its route configuration are described in the Bend2 README. Native logs,
SQLite rows, receipts and Git refs are the evidence from each run.

Historical runs are recorded in [root delivery](root-day-2026-09-27.md),
[root recovery](root-recovery-2026-09-27.md),
[worker landing](live-worker-2026-09-26.md) and
[target movement and resolution](target-move-2026-09-27.md). Those records name
what ran at their source revisions; they are not maintained runtime state.
