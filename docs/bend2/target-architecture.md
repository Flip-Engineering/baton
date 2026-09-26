# Baton Bend2 design

## Workflow

The operator talks to the root in a native harness session. The root asks Baton
to recruit a worker with a task, harness and model. Baton creates a Git branch
and worktree, starts the logged-in harness there, and supplies the task. The
worker can ask its parent questions and report progress. Each completed turn
sends its full report and work location to the parent, which decides whether
to guide another turn, land the work, or stop the worker.

The first implementation runs on one host and one Git repository. The root
session remains the place where the operator reads and directs agent work.
The following describes the implementation to build; a live slice is still due.

## Parts and data

One native Bend2 executable supplies a local service and a command client.
Three modules implement the workflow:

| Part | Responsibility | Data kept |
|---|---|---|
| Coordinator | Accept root and worker commands, deliver messages, resume sessions, and recover unfinished operations. | Repository and target branch; attached root endpoint; worker ID, parent, requested and observed route, native session ID, worktree, branch and base commit; pending inputs and full reports with delivery acknowledgments. |
| Harness adapters | Start or resume a subscription session, send input, observe questions, output and turn completion, stop on instruction, and inject parent notifications through the native harness. | Native connection handles in memory; session identity and complete output files on disk. Credentials remain with the harness. |
| Git operations | Create worker worktrees, inspect changes, prepare a landing, run selected checks, and advance the target branch. | Worker branches and worktrees; landing input commit, target before, candidate commit, check output and result commit. |

The coordinator stores current records and pending messages in a repository-local
SQLite database. A transaction saves a report and its pending parent delivery
together. This addresses lost reports across process exits and the observed
unwoken turn-end condition (#572). Bend2 decides transitions; the SQLite C
binding executes transactions. Reports and command receipts retain their IDs
when retried. Large transcripts and check output are files referenced by those
records. Git stores source history. Live process and worktree facts are read
from the host and Git when needed.

The service is the database's single writer. It accepts local authenticated
connections with session-bound identities: a worker can report and ask, and
manage workers it recruited; the root can manage the whole tree. Identity comes
from the connection established at attachment or recruitment. Runtime files
and connection credentials are private to the local user. This boundary
coordinates cooperating agents running with that user's repository access.

## Commands and notifications

The initial commands are `attach`, `recruit`, `guide`, `ask`, `report`, `status`,
`land` and `stop`. `attach` binds the existing native root session and target
branch. `recruit` takes a task and explicit harness/model/effort; its answer names
the worker and workspace. Long operations return an operation ID; their result
is delivered to the requesting agent. `status` shows the observed route, current
operation, latest report and work location. Errors include the operation,
observed failure and the available next action.

Every turn completion persists the harness's final output and wakes the parent,
including turns that contain no explicit `report` call. A question is delivered
while the worker session still exists. Guidance enters the harness's supported
input queue or starts its next turn. The parent makes continuation decisions.
A worker's declaration that it is done or an explicit parent stop ends its work.
Process failure reports the exit and retained workspace to the parent.

A native attachment must demonstrate that a report can start a parent turn while
the parent is idle. It acknowledges delivery only after native acceptance.
Pending notifications survive disconnection and are sent on reconnection;
repeated delivery carries the same message ID. Delivery acknowledgment means
accepted input, not completed parent action. A lost acknowledgment can cause a
repeated notification. The UI exposes an unavailable parent connection, and
reconnecting resumes delivery. A log line or ordinary MCP tool response does
not establish an unsolicited native wake.

After restart, the service opens pending records and reconciles native sessions,
Git refs and worktrees. An uncertain process start is inspected before another
session is started. A lost root connection is shown explicitly. A recorded
status alone never establishes that a process is running or that work landed.

## Preserving and landing work

Each worker gets its own branch and worktree from an explicit base. Every report
names that location and its current commit, including dirty-worktree information.
Worktrees, untracked files and branch tips survive worker exit and service
restart. Cleanup is explicit; the initial implementation retains workspaces.
A worker may finish a turn with uncommitted work, which its parent can inspect
and ask it to commit.

`land` takes a committed worker tip and the configured target. Git operations
prepare a merge candidate in a separate worktree, preserving the worker's commits.
Conflicts return their paths and the prepared worktree to the requesting agent.
Selected checks run on the candidate; failing files run on the target to identify
new failures as AGENTS.md requires. Missing verdicts and newly failing tests
block the landing. Checks use task behavior as their specification.

A successful landing advances the target to the checked candidate only while
its prior commit still matches. A changed target requires preparing and checking
the new candidate. The target branch must be free of another checked-out worktree
before a direct ref update. Recovery reads Git to resolve a lost acknowledgment;
worker branches remain available. The result names the actual target commit.
The first slice lands locally; remote publication is a later explicit operation.

## Deliberate omissions

The initial scope excludes a Baton conversation UI, old-state import, protocol
compatibility, shadow parity, automatic model routing, resource scheduling,
review roles, contribution approval gates, law registries, dependency boards,
knowledge stores, remote workers and automatic cleanup. Repository instructions
and normal task messages carry working context. Add another facility when actual
use demonstrates the missing behavior.

## Implementation boundary

Use the pinned Bend 2.0.25 toolchain initially. Its recorded
[C-only effect example](examples/c-only-spawn.evidence.md) demonstrates a native
foreign effect; process supervision, database transactions and harness wake
still need executable implementations and tests. C supplies host primitives;
Bend2 owns command meaning, delivery decisions and landing progression.
Production libraries are ordinary imported modules. Tests have separate entry
points and exercise behavior through the real executable.
