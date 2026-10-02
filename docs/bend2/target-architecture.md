# Baton Bend2 design

This document records the earlier proposal. The
[current architecture](architecture.md) is the design of record. The
[naming legend](terminology.md) maps its agent `root` to Principal Conductor,
a coordinating `lead` to Associate Conductor and an individual `worker` to
Player. Ensembles and Sections are described in task briefs and shared context
over the existing sessions and parent links. The Orchestra is the whole
coordinated system.

## Workflow

The operator talks to the root in a native harness session. The root asks Baton
to recruit a worker with a harness and model. Baton creates a Git branch and
worktree and records the worker; a `turn` or `receive` invocation starts the
logged-in harness in that worktree and supplies the task. The worker can ask its
parent questions and report progress. Each completed turn sends its full report and work
location to the parent, which decides whether to guide another turn or land the
work. A turn ends when its native process exits. A retained receiver runs queued
input after the current process exits.

The first implementation runs on one host and one Git repository. The root
session remains the place where the operator reads and directs agent work. The
coordinator under `bend2/` implements this design: the
[Bend2 architecture](architecture.md) is the design of record for the
implemented system, and [bend2/README.md](../../bend2/README.md) gives its build,
commands and acceptance runs. A supervised live worker slice ran on 2026-09-26
([live worker](live-worker-2026-09-26.md)), and a real root reviewed, landed and
published a worker commit on 2026-09-27 ([root day](root-day-2026-09-27.md)).

## Parts and data

One native Bend2 executable supplies the coordinator commands. Each invocation
opens the database named on its command line and performs one command; a `turn`
or `receive` invocation stays in the foreground and supervises one native
process. Three modules implement the workflow:

| Part | Responsibility | Data kept |
|---|---|---|
| Coordinator | Accept root and worker commands, deliver messages, resume sessions, and recover unfinished operations. | Repository and target branch; attached root endpoint; worker ID, parent, requested and observed route, native session ID, worktree, branch and base commit; pending inputs and full reports with delivery acknowledgments. |
| Harness adapters | Start or resume a subscription session, deliver the task, send pending guidance through the native harness during an OMP turn, and observe output, terminal events and native session identity. Each harness launches with interactive approval disabled (see `bend2/src/harness/`). The adapter and command paths build no reply to a native question or approval request; a worker asks its parent with `ask` or `ask-file`. | Native connection handles in memory; session identity and complete output files on disk. Credentials remain with the harness. |
| Git operations | Create worker worktrees, inspect changes, prepare a landing, run selected checks, and advance the target branch. | Worker branches and worktrees; landing input commit, target before, candidate commit, check output and result commit. |

The coordinator stores current records and pending messages in a SQLite database
named on its command line. Each mutation runs inside one `BEGIN IMMEDIATE`
transaction, and a report and its pending parent delivery are saved together.
That transaction addresses lost reports across process exits and the observed
unwoken turn-end condition (#572). Bend2 decides transitions; the SQLite C
binding executes transactions. Reports and command receipts retain their IDs
when retried. Large transcripts and check output are files referenced by those
records. Git stores source history. Live process and worktree facts are read
from the host and Git when needed.

Each command is its own process and opens the shared SQLite database. The
database holds the coordination state, and its `BEGIN IMMEDIATE` transaction is
the writer serialization point: SQLite admits one writer at a time. Commands
bind local connections to session IDs for message routing and parentage through
the session row's parent and endpoint
columns. Workers report and ask through that identity; parent IDs route their
reports and guidance. The agents share the local user's repository access.
Session IDs establish routing, not a security boundary between these agents.

## Commands and notifications

The commands are `attach`, `recruit`, `connect`, `bind`, `message` and
`message-file`, `report`, `ask` and `ask-file`, `observe-file`, `ack`, `session`,
`delivery`, `pending`, `inbox`, `status`, `workers`, `turns`, `worktree`, `land`,
`land-checked`, `push`, `turn` and `receive`. `attach ID HARNESS NATIVE
ENDPOINT` records the session identity, its harness, its native session ID and
its delivery endpoint. Worker branches come from `recruit`; the target branch is
supplied to `land` and `land-checked`. `recruit` takes the worker identity,
parent, harness, model, effort, repository, branch, worktree path and base; its
answer names the worker and workspace. A `message-file` supplies the task to a
registered receiver; a direct `turn` takes the task file as an argument.
Guidance is a `message` with kind `guidance`. The
[Bend2 README](../../bend2/README.md) gives each command's arguments.

Each command answers with JSON text as it completes. The message-writing
commands (`report`, `ask`, `ask-file`, `message`, `message-file`, and an
`observe-file` whose event is terminal) wait for the recipient's configured
endpoint to exit before they answer: the commit path invokes that endpoint
(`bend2/src/coordinator/root.bend`) and waits on the process it spawned. The wait
lasts as long as the receiver's own work. Start commands that invoke lengthy
native work in the background and end the sender's turn, as the [Bend2
README](../../bend2/README.md) and [trial lead
instructions](../../bend2/trial/lead-instructions.md) describe. `turn` and
`receive` are the supervisor operations: each stays in the foreground while it
supervises native work. `status` shows the stored route, workspace and
pending count. Errors name the observed failure and the next action.

Every turn completion persists the harness's final output and wakes the parent,
including turns that contain no explicit `report` call. `ask` and `ask-file`
store a message of kind `question` addressed to the worker's recorded parent and
invoke that parent's registered endpoint after the transaction commits, the same
path `report` takes. For OMP, the supervisor sends pending guidance as native
`steer` frames on a response, message completion or tool event. `receive` admits
OMP and Codex workers and composes pending input into the next native turn it
starts for those sessions. Muse and Claude Code workers run under the direct
`turn` command, whose task file supplies their next turn. Each worker's pending
input remains readable with `inbox`. The parent sends guidance, requests further
work and reviews completed work for landing. After the native process exits,
`receive` releases session ownership and checks for new pending input.
`stop` ends a retained OMP or Codex session and prevents queued execution.
`force-stop` explicitly signals the same still-owned attempt. Active direct
`turn` execution returns an unsupported-stop refusal. The retained observer
records actual exit and delivers a stop report to the parent while preserving
output, receipts and workspace. Killing only a `receive` observer starts
observation recovery through the keeper.

A native attachment must demonstrate that a report can start a parent turn while
the parent is idle. The recipient records acceptance with `ack` after the
message reaches its native session; the receipt body is the acceptance text the
recipient supplies. An acceptance receipt establishes that the recipient
recorded acceptance of that message and nothing about the work itself. Parent
review is a separate action: the parent reads the report and inspects the branch
and worktree with `worktree`. A `land-checked` answer of `landed` names the
advanced target commit; `already` names a worker commit already in the target.
The `conflict` and `blocked` answers describe unresolved landing attempts. The
caller reads the actual Git ref and check results to verify the resulting state.
Pending notifications survive disconnection and are sent on
reconnection; repeated delivery carries the same message ID. A delivery failure
returns an error to the writer and leaves the message pending. `pending` lists
it with the recipient's current endpoint, and `inbox` lists it; `delivery ID`
reads the stored message and that endpoint without sending it, and `receive`
reads the pending input and starts the native attempt. A lost acknowledgment
can cause a repeated notification. A log line or ordinary MCP tool response
does not establish an unsolicited native wake.

Recovery uses explicit command invocations. The caller reads the stored session
and pending messages, inspects the workspace with `worktree` and checks Git refs.
Reconnecting updates the native identity and endpoint; `receive` reads the
pending input and resumes the recorded conversation. The trial launcher performs
those attachment and receive calls for its root. Endpoint invocation failures
return an error to the message writer and retain pending input. Status reads
stored bindings; live process state and landed commits require host and Git
observations. The [process-loss recovery run](host-restart-2026-09-28.md) validates recovery after
every coordinator and harness process for two sessions is killed while the host
stays up; host reboot and power-loss durability are not validated. The case of a
supervisor that dies while its harness child survives is recorded in
[native delivery](native-receive-2026-09-28.md) and
[receive recovery](receive-recovery-2026-09-28.md).

## Preserving and landing work

Each worker gets its own branch and worktree from an explicit base. Every report
names that location and its current commit, including dirty-worktree information.
Worktrees, untracked files and branch tips survive worker exit and coordinator
restart. Cleanup is explicit; the initial implementation retains workspaces.
A worker may finish a turn with uncommitted work, which its parent can inspect
and ask it to commit.

`land-checked WORKER_ID REPO TARGET_BRANCH CHECK FILES` takes a committed worker
branch and the configured target. Git operations prepare a squashed candidate
in a separate worktree, preserving the worker's commits. Conflicts return their
unmerged paths and the prepared worktree to the requesting agent. Each selected
check runs on both the candidate and the target. Candidate failure identities
absent from the target block the landing. An unjudged candidate run blocks; an
unjudged target run blocks when its candidate run fails. Checks use task
behavior as their specification. The
[checked-landing record](checked-landing-2026-09-28.md) and its
[measurement artifact](measurements/2026-09-28-checked-landing.json) describe the
gate and the target-movement scenario.

A successful landing advances the target to the checked candidate through a
compare-and-swap ref update using the checked target commit as the expected old
value, so it advances only while that commit still matches. A target that moved
during the checks blocks that invocation and retains the candidate and worker
work; a new `land-checked` invocation prepares and checks a candidate against the
current target. A landed or already-merged answer removes the two scratch
worktrees it prepared, and a blocked or conflicted answer keeps them until that
worker's next attempt. The target branch must be free of another checked-out
worktree before a direct ref update, and a held target returns its `target busy`
failure. The caller reads Git to resolve a lost acknowledgment; worker branches
remain available. The result names the actual target commit.

`push REPO BRANCH REMOTE` publishes an advanced target with Git's ordinary push
and answers `pushed` with the branch and remote, or `rejected` with a
generated reason naming the failed command. Retained runs read
the advertised ref back with `git ls-remote` against a declared scratch bare
remote, including a refused non-fast-forward push. Network publication to a
repository remote remains the operator's explicit action
([root day](root-day-2026-09-27.md), [live worker](live-worker-2026-09-26.md)).

## Deliberate omissions

The initial scope excludes a Baton conversation UI, old-state import, protocol
compatibility, shadow parity, automatic model routing, resource scheduling,
review roles, contribution approval gates, law registries, dependency boards,
remote workers and automatic cleanup. Repository instructions
and normal task messages carry working context. Add another facility when actual
use demonstrates the missing behavior.

The [shared knowledge workflow](knowledge-context-2026-09-29.md) adds immutable
findings with retained evidence messages, reader-relative session scopes and
explicit source-to-destination promotion. Agents generate and review findings.
The coordinator uses its existing SQLite database and parent message delivery.
Recording notifies the author's immediate parent, when present. Promotion
commits a notice to the destination-scope owner, which chooses further Ensemble
distribution. The [real acceptance run](knowledge-context-2026-10-01.md) covers
evidence review, explicit promotion, owner notices, sibling consumption by finding ID, retrieval
in a fresh conversation and a separately promoted immutable correction. Its
report states the parent-collector and investigated Python-fixture boundaries.

## Implementation boundary

The implementation uses the pinned Bend 2.0.25 toolchain. Its recorded
[C-only effect example](examples/c-only-spawn.evidence.md) demonstrates a native
foreign effect. The host bindings under `bend2/src/host/` supply process
supervision, SQLite transactions, file effects and the session lock, and the
coordinator wakes a parent endpoint after a committed report. The
[Bend2 architecture](architecture.md) states each module's responsibility and
the laws the entry proves.
[Native delivery validation](native-receive-2026-09-28.md) records a Codex root
and two OMP workers over this path. C supplies host primitives; Bend2 owns
command meaning, delivery decisions and landing progression. Production
libraries are ordinary imported modules. Tests have separate entry points and
exercise behavior through the real executable. `bend2/scripts/check-native.sh`
builds and runs them.
