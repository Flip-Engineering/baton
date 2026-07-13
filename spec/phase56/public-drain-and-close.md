# Phase 56 — authenticated fleet drain and exact driver close

## Why this phase exists

Phase 51 makes every real provider process visible from OS spawn through exact process-group close,
and Phase 55 binds and reaps isolated toolchain projections. Baton still lacks one public operation
that turns those per-worker guarantees into a bounded fleet-wide closure. Operators and recursive
evidence runners currently enumerate workers, issue individual kills, poll private paths, call
`close()` themselves, and assemble an ad hoc cleanup summary. A missed pending task, in-flight trust
gate, verification sandbox, persistent session, or cleanup failure can therefore keep authority
alive even when the runner says it is done.

Phase 56 adds two deliberately separate operations. Authenticated web and MCP users may drain the
coordinator-owned local fleet while leaving the command transport and durable writer alive long
enough to record and replay the result. The deployment host may then call `driver.drainAndClose()`
to stop supervisors, perform the same drain, irreversibly close coordinator authority, and release
the writer lease. A remote command never shuts down the channel required to persist its own
completion. Existing web-server `shutdown()` remains transport-only and has no fleet effect.

This is a lifecycle and operator-control slice. It adds no worker-selected authority, no remote
machine execution, and no homelab or external project-manager integration.

## Contracts

### DC1 — closed deployment drain policy

`createDriver()` accepts an optional deployment-owned `drainPolicy` with exactly positive safe
integer `maxWorkers`, `timeoutMs`, and `pollMs`. Unknown fields, missing fields on a supplied object,
unsafe values, `pollMs > timeoutMs`, `maxWorkers > 100000`, or `timeoutMs > 300000` refuse before a
writer is claimed. Omission selects one documented fixed safe policy; web/MCP callers cannot
override it, name a subset, supply paths/PIDs, extend a deadline, or raise a bound.

Only locally controlled workers, cleanup-pending workers, and not-yet-dispatched pending tasks count
toward `maxWorkers`. Historical replay handles without current local authority are evidence, not
native transports, and are neither signalled nor counted as live ownership. Exact-limit admission
succeeds; max+1 refuses `coordinator_drain_capacity` before admission closes or any task is changed.

### DC2 — irreversible coordinator admission fence

`coordinator.drain({actor,repoId,idempotencyKey})` atomically changes the controller from `open` to `draining` before it
enumerates work. From that point, no ordinary public command, provider delivery, capability effect,
automatic dispatch, recovery attempt, or newly feasible pending task may create or advance fleet
authority. They fail with typed `coordinator_draining`. `_dispatchPass()` itself is fenced so an
asynchronous trust-gate or stop callback cannot bypass the public-command check.

Bounded list/result/wait/capability/provider-status reads remain available through a read-only health
check that never dispatches. The drain operation and its private kill authority are the only allowed
control path after the fence. Concurrent drains share one in-flight promise. A completed drain is
immutable and subsequent calls return the same attestation. A timed-out or cleanup-red attempt keeps
admission closed but may be retried with a new northbound idempotency key; it never reopens the
controller.

Every asynchronous authority path registers one coordinator-owned operation token before its first
await and releases it in `finally`. This includes recovery and context validation; integration and
structured merge; queued send/follow-up/orientation; question/approval response and publication;
provider ingress/reconciliation; capability invoke/resume/reverify; reuse decisions; and trust-gate
verification. Drain waits on the token set, not an incomplete hand-maintained subset. A new token
cannot be acquired after the drain fence.

### DC3 — pending tasks become durably terminal

A task that is still pending and owns no runtime, worktree, adapter, or process cannot be sent
through the ordinary per-worker kill path. Drain records one bounded policy event, transitions the
exact durable task to `cancelled`, and marks its handle terminal without fabricating a fence,
process start/close, or kill confirmation. Replay therefore cannot dispatch it after writer handoff.

Pending cancellation races safely with dispatch: either the drain fence wins before `_dispatch()`
and the task is cancelled without resources, or dispatch establishes local authority and the task
joins the exact kill/reap set. No task disappears between the two cases.

### DC4 — exact local kill, close, and cleanup convergence

Every locally controlled worker is drained through the existing coordinator-owned two-phase kill
state machine, not by calling adapters directly. A process that started must retain its exact
generation/PID/group correlation and reach `lifecycle.process_closed` before successful drain.
`forced`, timeout, `unconfirmed_after_restart`, adapter refusal, cleanup failure, or an open process
is a red drain, never a successful disposition.

Drain waits for all stop waiters, emergency/untrusted reap records, runtime scopes, task worktrees/
branches, toolchain projections, deferred post-verification cleanup, verifier/base-verifier
sandboxes, and coordinator authority
operations to converge. A process already closed may take the existing terminal cleanup path; an
idle persistent session is still local authority and must be killed. Cleanup is retryable and no
writer/authority-close claim is made while `cleanupPending`, `cleanupAfterVerification`, an active
process, a stop waiter, local worker authority, or `_authorityOps` remains.

### DC5 — bounded timeout and failure truth

The deployment deadline bounds the entire attempt, including in-flight verification and cleanup.
Failure throws one fixed typed code: `coordinator_drain_incomplete`; capacity refusal uses
`coordinator_drain_capacity`; calls after final coordinator close use `coordinator_closed`.
Messages and public failures contain no worker prose, provider error, path, PID, environment,
credential, or filesystem exception. Timeout does not release the writer, close coordinator
authority, reopen admission, or fabricate an attestation. A later drain may finish the same owned
state after the underlying close/cleanup converges.

Authoritative-log poison remains governed by Phase 23's emergency-reap path. Phase 56 may fail red
under poison; it may not relabel unaudited best-effort cleanup as an ordinary verified drain.

Cleanup calls used by this oracle are no longer best-effort. Worker and verifier removal propagates
failure and postchecks the owned directory, Git worktree registration, metadata, projection exclude,
and requested owned branch. Restart reconciliation includes abandoned `.baton/verify` sandboxes.
An untrusted-process timeout may mark the exact generation unconfirmed but cannot clear local
authority or remove resources until exact close. `closeAuthority()` refuses any
`localAuthority:true` handle regardless of its status label. Strict writer release verifies the
same lease token was removed and is absent; lost, replaced, or unlink-red authority is not success.

### DC6 — durable closed path-free fleet attestation

Before the first stop effect, CoordinationStore appends replay-validated `fleet.drain_admitted` with
one private drain ID derived from repository plus the northbound/direct idempotency identity, exact
sorted target worker IDs, their canonical target digest, and the request digest. It appends
`fleet.drain_completed` only after DC4's shared ownership oracle is empty. Target ordering,
uniqueness, closed fields, admitted-before-completed order, counts, target digest, and receipt digest
are validated during live apply and replay. Completion append failure exposes no successful receipt.

This nested durable record closes the crash window after resource reap but before a web/MCP command
completion. Retrying an outer command that is still `admitted` re-dispatches only drain using the
original outer command/call ID: completed nested drain returns its receipt without another kill;
an incomplete nested drain resumes the fixed target set. Other admitted command types retain their
existing fail-closed behavior.

A successful `coordinator.drain()` returns one deeply frozen exact object:

```json
{
  "schemaVersion": 1,
  "state": "drained",
  "scope": "local-controller",
  "repoId": "repo-a",
  "targetCount": 1,
  "remainingCount": 0,
  "targetDigest": "<sha256 of sorted private target IDs>",
  "counts": {
    "pendingCancelled": 0,
    "killConfirmed": 1,
    "alreadyTerminal": 0,
    "processesObserved": 1,
    "processesClosed": 1
  },
  "checks": {
    "admissionClosed": true,
    "authorityOpsDrained": true,
    "stopWaitersDrained": true,
    "cleanupDrained": true,
    "localWorkerAuthorityReleased": true
  },
  "effects": {
    "coordinatorClosed": false,
    "writerReleased": false,
    "transportsClosed": false
  },
  "receiptDigest": "<sha256 of every preceding public field>"
}
```

The public receipt is constant-shape and contains no worker rows. Exact per-worker kill/process-close
facts remain in the operational ledger; `targetDigest`, counts, and the nested durable event bind
them without making a large historical fleet response unbounded. No successful process count may
claim closed without exact correlated close. The receipt contains no timestamps, paths, branches,
repository roots, runtime homes, projection targets, PIDs/groups, argv, provider session IDs,
errors, credentials, or worker content. Callers cannot supply any field.

### DC7 — direct `driver.drainAndClose()`

The public driver exposes async `drainAndClose(actor = 'orchestrator')`. It:

1. prevents a concurrent legacy `close()`/`closeAsync()` race;
2. awaits or closes startup recovery and provider supervisors using their existing bounded paths;
3. calls the coordinator drain and obtains its immutable attestation;
4. requires `closeAuthority()` to accept the post-drain oracle;
5. releases the exact writer lease; and
6. returns a final path-free closure attestation.

The final exact shape is:

```json
{
  "schemaVersion": 1,
  "state": "closed",
  "fleet": {"schemaVersion": 1, "state": "drained"},
  "supervisors": {
    "sessionRecovery": "absent",
    "providerProcessing": "absent",
    "providerPolling": "absent"
  },
  "authority": {"coordinatorClosed": true, "writerReleased": true},
  "receiptDigest": "<sha256 of every preceding field>"
}
```

`fleet` is the complete DC6 object, not the abbreviated example. Supervisor values are exactly
`absent | closed`. Concurrent calls share one promise; later calls return the same frozen object.
Failure before writer release is retryable and returns no success object. Writer release failure is
red and cannot claim `writerReleased`. Calling `drainAndClose()` after a legacy close, or racing a
different close operation, fails with typed `driver_closed | driver_closing` rather than inventing
evidence. Existing `close()`/`closeAsync()` retain their refusal-only compatibility and return shape.

### DC8 — authenticated web drain without self-termination

The HTTPS northbound adds stateful command `drain` with an exact empty `args` object, required
command/repository/idempotency/origin identity, and `emergency_stop` authorization. It accepts no
worker, fence, deadline, path, model, harness, or effort input. Authentication, origin/CSRF,
repository scope, quota, audit, durable admission, same-key conflict, completion, and exact replay
use the existing command authority.

The command dispatches only `coordinator.drain({actor:webActor, repoId, idempotencyKey})`. It does
not call driver close, release
the writer, stop HTTPS/SSE, or call `WebNorthbound.shutdown()`. The durable coordination store can
therefore commit the response after the fleet is drained. An exact replay returns the stored
attestation without touching the drained coordinator. An admitted-but-uncompleted drain replay uses
the original command ID to resume or read DC6's nested durable receipt, then completes the original
outer command. A new drain idempotency key receives the same physical closure receipt. Browser
disconnect has no extra fleet meaning.

### DC9 — authenticated MCP drain parity

MCP adds stateful tool `fleet_drain` requiring exactly `repoId` and `idempotencyKey`, authorized by
`emergency_stop`, destructive/idempotent, and forbidden from task delegation. It is deliberately
not per-worker fenced. The existing injected principal, repository scope, quota, audit, durable
call admission/completion/failure, same-key conflict, and replay rules apply.

The tool dispatches only `coordinator.drain({actor:mcpActor, repoId, idempotencyKey})`. Its
normalized value is byte-equivalent to the HTTPS/direct coordinator attestation. Stdio/daemon
transport and writer authority remain alive until the deployment host calls its own close path.

### DC10 — direct/web/MCP replay, concurrency, and privacy

Two simultaneous direct, web, and/or MCP drain requests converge on one drain execution and one
physical receipt digest. Each request still has its own private nested drain admission and durable
northbound idempotency record, so every crash boundary is recoverable without duplicate kill.
Exact replay after the coordinator admission fence succeeds from durable northbound outcome;
different semantics under one idempotency scope conflict before dispatch.

The attestation and all success/failure projections are scanned for repository/toolchain/runtime
paths, project-key filenames or values, home directories, environment canaries, provider frames,
and worker content. Web/MCP use their existing response-size ceilings. Neither surface can invoke
`closeAuthority()`, release a writer, stop a server, or manufacture a successful check.

### DC11 — evidence-run temporary ownership

`impl/scripts/run-evidence.mjs <runner> [...args]` is the canonical evidence-run wrapper. It creates
one mode-0700 owner root beneath a deployment-selected parent, records its original device/inode/
owner identity, binds `TMPDIR`/`TMP`/`TEMP` for the child, and launches the runner in one detached
process group. It forwards INT/TERM, escalates within fixed TERM/KILL deadlines, requires group
ESRCH, and deletes only the still-matching owner root. Rename/replacement or cleanup failure is red;
an unrelated sibling is never removed. Configuration is independently bounded and max+1 tested.

Recursive runners place transient log/coordination state only beneath that owner root. The runner
calls `driver.drainAndClose()` in `finally` and writes only bounded redacted evidence to the
checked-in evidence directory. The wrapper removes its root on green, semantic-red, thrown, startup-
refused, SIGINT, and SIGTERM outcomes. Existing historical runners need not be rewritten to obtain
ownership when invoked through the wrapper. Bare `node run.mjs` is outside the cleanup claim.

The canonical `npm test` path remains the Phase 15 process-group and temporary-root owner. Direct
ad hoc `node --test` is not accepted as a leak-free full-suite proof. Abrupt host death/SIGKILL
reconciliation across independent evidence-runner processes remains a separately catalogued
daemon/supervisor requirement; Phase 56 does not claim an in-process `finally` can survive SIGKILL.

### DC12 — compatibility, recursive proof, and retained scope

Existing eight-command wording remains historical for the original worker command core; the new
fleet drain is a controller-level operator command, not a ninth per-worker verb or adapter card.
Individual kill, legacy close refusal, web transport-only shutdown, authenticated status, startup
recovery, provider supervisors, and test-runner behavior remain compatible.

Zero-quota tests prove pending/working/blocked/idle/verifying/cleanup-red states, exact close ordering,
all max/max+1 limits, concurrency, retry, replay, supervisor and writer ordering, web/MCP auth, and
path/credential privacy. Recursive evidence then uses the shipped drain API rather than manual
worker enumeration, routes exact Codex `gpt-5.6-sol`/low and project-key GLM `glm-4.7`/low, attempts
concurrent Grok 4.5 and Grok Build, and retains honest authentication/budget/verification outcomes.
Every started native process must close and every owned worktree/runtime/projection/branch/writer
must reap even when a provider route is red.

Phase 56 does not claim generic ACP/Gemini/OpenCode adapters, WebSocket parity, rich operator
takeover, deployment/federation, Scratch Board/Bench, executable Skill/Playbook promotion, Vantage,
the full Evidence Ladder, recall feedback, retention/compaction/export, live LSP/SCIP, closure/heap/
alias/interprocedural CPG, compiler IR/translation validation, true semantic merge/equivalence, or
conditional domain-specific e-graph research. The complete AST/CST/symbol/SCIP/CPG/IR/behavior/
semantic-delta and project-manager-inspired local causal-knowledge goals remain visible, with no
homelab integration added.

## Red tests

1. Exact drain policy bounds accept max and refuse max+1 before the admission fence; malformed or
   caller-supplied deadline/worker/path fields refuse.
2. Drain cancels an undispatched pending task durably without fabricating process/kill evidence,
   while a dispatch race joins either the pending-cancel or exact-kill case and never leaks.
3. Working, blocked, and idle persistent workers receive one coordinator-owned two-phase kill;
   every started generation closes before confirmation and cleanup.
4. Recovery, queued send/follow-up/orientation, integration/structured merge, publication, provider,
   capability, reuse, trust-gate, and verification races keep drain pending until every authority
   token, verifier/base-verifier, and deferred cleanup finishes; cleanup failure/timeout stays red
   and retry can finish later.
5. New spawn/send/capability/provider/recovery/dispatch work is refused after the fence, including
   an asynchronous `_dispatchPass()` callback; internal drain kill remains usable.
6. Concurrent drains share one execution and return the same deeply frozen exact DC6 attestation;
   nested admission/completion survives every outer-command crash boundary, while tampered targets,
   ordering, counts/digests, extra fields, and path/PID/credential canaries are refused or absent.
7. `driver.drainAndClose()` closes supervisors, drains, closes coordinator authority, then releases
   the writer; concurrent calls share the result and close races fail typed.
8. Authenticated web `drain` uses `emergency_stop`, empty args, origin/CSRF/repo/quota/audit and
   durable replay; unauthenticated, wrong-scope, unknown-field, and same-key-changed calls refuse.
9. MCP `fleet_drain` has the same authority, closed schema, idempotency, replay, and attestation;
   it cannot be delegated as a task or release driver/transport authority.
10. Web/MCP completed and admitted replay still succeeds after coordinator admission closes;
    bounded reads remain live while new effects cannot create work. Web `shutdown()` alone
    continues to have no fleet effect.
11. The evidence wrapper confines one private root, reaps descendant groups on pass/fail/startup-
    refusal/INT/TERM, refuses inode replacement, preserves siblings, and reports cleanup failure
    red; the recursive runner calls `drainAndClose()` and leaves no runner root or writer lease.
12. Focused Phase 56, adjacent Phase 12/15/16/45/51/55, privacy, `git diff --check`, and canonical
    suites remain green with zero canonical suite roots or owned Baton resources left afterward.

## Acceptance gate

Phase 56 closes only when DC1–DC12 are executable, red tests turn green, focused/adjacent/canonical
validation passes, adversarial findings are dispositioned, and recursive Baton evidence uses the
new public drain and direct close attestations across the exact supported route matrix. Any forced
or unconfirmed process, cleanup residue, open writer, credential/path disclosure, or false Grok
authentication claim keeps the relevant live gate red without weakening the implementation result.
