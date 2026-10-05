# Shared owner task, custody and concurrency design

This document designs the task, custody and concurrency layer for one native
owner process that serves one bound Orchestra database. It reviews commit
`fca7af876c8260c32d17f95f3e19bc68ee1bf561` and the two custody handoffs supplied
with this assignment (receive/Turn from native-receive-conductor; prepared
process checkpoint `e3dd9c58` from controls-next). Those handoffs are current
scoped source evidence. They are not accepted runtime guarantees, and this
document grants no edit authority in the regions they own.

Companion proposal reviewed: `docs/bend2/shared-native-owner-boundaries.md`
(native-instance-conductor). Its source claims were re-verified independently
in this worktree; the verification results are in "Verified source facts".

## Verified source facts

Every claim below was read from this worktree at `fca7af87`. Line numbers are
from that commit.

### Session guard

`host/session-lock.bend:acquire_session` canonicalizes the database path, calls
`try_acquire` for the canonical path and session, and passes the guard handle to
the continuation. `host/session-lock.c` builds the lock from `realpath(database)`
plus a `.lock-` suffix, hex session bytes, an open descriptor and
`flock(LOCK_EX|LOCK_NB)`. A busy acquisition returns `None` and the receive
answers `queued` (`receive.bend:acquired`). The attempt keeper inherits the
guard descriptor through `posix_spawn` (`process-spawn.c:br_spawn` passes
`call->lock` as fd 4; `main.bend:keeper` reads it back) and closes it when the
keeper processes a release after native exit (`process-spawn.c:720-724`).
`ProcessChild.attach_owned` passes a freshly acquired guard into an orphan
attachment (`receive.bend:recover_owned`, `process-spawn.c:1139`).

### Active slot

`stop.bend:admit_sql` writes one mutable `executions` row per session:
`ON CONFLICT(session) DO UPDATE SET id,mode,directory,phase,status`. The phase
moves `starting` (`admit`) to `running` (`Stop.started`) to `exited`
(`Stop.exited`, which also stores the status text and writes the stop report
message). This row is the current pointer. It carries no history: once a newer
attempt updates the row, the row names the newer attempt only.

### Per-attempt custody

Each admitted attempt gets a unique directory (`receive.bend:selected`:
`<db>.attempt-<hex(id)>`). The keeper writes `status`, `released` and
`acknowledged` marker files there (`process-spawn.c:693-695,723,728`), serves a
Unix socket recorded in the recovery manifest (field 5), and records native
birth in a `BrBirth`. Marker files are written exclusively (`br_file` uses
`O_EXCL` and reports `EEXIST`); only the release and ACK handlers treat an
existing marker as success (`process-spawn.c:602-606`), so marker writes are
not generally idempotent.
`ProcessChild.recovery_argv` reads the manifest
and returns the original `--recover-receive` invocation while the attempt is
unacknowledged; the underlying recovery read also suppresses attempts with a
missing launch marker, and for eager manifests additionally released or
native-start-error attempts, so historical-duty enumeration reads the marker
files directly instead of reusing this admission filter.

### Handles and cross-process addressing

`baton_children` is a process-local array; a child handle is its `U32` index
(`process-spawn.c:27,1250`). Handle operations (`write`, `close_stdin`,
`read_line`, `wait`, `signal`, `input_closed`, `pid`, `release`, `acknowledge`)
resolve through that array in the calling process. Cross-process operations
address the attempt by directory instead: `control_write(directory,frame)`,
`control_signal(directory,sig)`, `attach(directory)`, `recovery_argv(directory)`
connect to the keeper socket from the manifest. A handle therefore binds to one
OS process and is meaningless after that process exits.

### Finish duties outlive guard release

`receive.bend:completed` runs `Turn.prepare`, then releases the observer guard
when one is held (`release_observer`), then calls `ProcessChild.release`. The
release asks the keeper to release its held session lock after native exit:
`BR_RELEASE` requires `exited` and closes `keeper->lock`
(`process-spawn.c:720-724`). Release and acknowledgment are distinct: `BR_ACK`
requires `exited` and `released`, writes the `acknowledged` marker, marks the
keeper finishing and removes the stdout spool (`process-spawn.c:725-731`).
Neither step removes the attempt's completion duty or its task context.
`finish_pending` then forks `Turn.finish` (parent delivery through
`Delivery.deliver`, plus `Stop.deliver`) and `continue_pending` (reread of
unreceipted input above the cursor after release), joins the delivery, settles
the attempt's native-request delivery channels (`NativeRequests.settle`),
acknowledges the exact original handle, and joins the continuation
(`receive.bend:96-105`, `receive-laws.bend:421-423`). A session can therefore
have a newer attempt running while an older attempt still owes report
delivery, request settlement and ACK. The historical duties need the original
attempt identity; the `executions` row supplies only the current one.

### Task-local observation state

`turn.bend:consume` threads all observation state as parameters: cursor,
last assistant message, first terminal, OMP filter mode, Codex log, first
observation error, the prompt-sender channel, the attempt directory and the
native-request delivery channels. `Turn.retained_output` reconstructs this state
from an attempt's first frame for recovery. The event order is frame
classification, raw recording, guidance observation, retained message/activity
update, normalization, deferred diagnostics, terminal selection, native-request
observation, next read. Every state field belongs to one attempt of one
session.

### Native requests

`native-requests.bend` keys requests by `UNIQUE(attempt,native_id)` in SQLite,
records the parent session and attempt at observation, and delivers replies
through `ProcessChild.control_write(attempt,frame)` — the keeper socket of the
original attempt (`native-requests.bend:25`, `native-request-laws.bend:36-37`).
`NativeRequests.closed` marks unanswered requests `native-exited` per attempt.
The per-attempt keying already survives a shared owner; reply admission checks
parent, closed state and the worker session's stop state in SQL.

### Delivery and parent wake

`Delivery.deliver` runs the recorded endpoint argv as a fresh child process per
message (`delivery.bend:launch`) and appends its output to the database's
`.root.log`. A stopped recipient hands its input to the higher parent as a
report (`delivery.bend:handoff_sql`). `Delivery.wake_pending` reads the first
unreceipted message above the cursor after the owner releases the guard
(`delivery.bend:wake_sql`, comment at `wake_pending`). Delivery is already
process-isolated per message; a shared owner inherits that isolation and adds
concurrent deliveries for different sessions.

### Environment and process identity

`harness/git-series.mjs` builds a fresh environment object per launch
(`scoped_environment`, lines 141-169) and replaces the process image with
`process.execve` (line 181); the GPT route deletes `OPENAI_API_KEY` and
`CODEX_API_KEY` (lines 205-206). No launcher Node process remains after exec.
`process-spawn.c` declares `extern char **environ` (line 6) and passes it to
`posix_spawnp` (line 84). A child environment parameter is therefore missing at
the host spawn boundary, and the scoped-environment construction already exists
one layer up.

### Output surface

`host/text.c:baton_control_output_call` holds `flockfile(stdout)` and writes
directly to fd 1 (`text.c:71-74`). The stream lock serializes bytes; there is
one destination and no request correlation. `Receive.registered` calls
`IO.die` on an unregistered session (`receive.bend:247-248`); `Turn.acquired`,
`Turn.supported_harness`, `Turn.matching_turn` and `Stop.require_open` call
`IO.die` on their refusal paths (`turn.bend:544,480,485`, `stop.bend:29`).
Receive and Turn helpers thread failures as `Result` values and unwrap them
with `IO.try`. Root source review (supplied with the shared-instance
constraints, 2026-10-05) establishes the runtime semantics: `IO.try` and
`IO.die` halt the whole process on failure, and a forked fiber does not catch
that halt. Task isolation therefore requires result-valued error propagation
on every path a shared task can reach; a `die` reached from one session ends
every session in the process.

## Design

### 1. Owner identity and database binding

One owner process serves one bound database. The binding is a database-level
owner record with its own exclusive acquisition, separate from the per-session
session locks: the owner binds the actual SQL connection and effects to the
database under a qualified supported-path policy, records its fresh instance
token under a database-level lock, and serves clients that resolve the same
binding. A device/inode label or path text alone is an identifier for the
record, and does not supply the binding itself; connection binding and path-policy
qualification are host requirements outside the pure task module. The session
locks serialize per-session admission under
the owner; they do not establish the one-owner-per-database property by
themselves, and two owner processes can hold different sessions' guards for
the same database at once.

Path canonicalization groups symlink aliases, and a hard link is a distinct
canonical path for the same physical file. Independent measurement (lifetime
review `5fea8d62`: original path and symlink serialize one session, a hard link
acquires a second guard) shows the current guard contract is
canonical-path/session, and current `Sql.query` reopens its path per effect,
so an inode token or open descriptor alone binds no effect. The first
supported database policy is therefore: one canonical selected path, a checked
physical identity at binding time, database-level owner exclusion, and
explicit refusal of multiply-linked or replaced database files. The foreign
assumption is stated: nothing here qualifies SQLite behavior under hard-link
access; if alias support is wanted later, all SQL must use one selected owner
pathname and journal, WAL and replacement behavior must be qualified by
fixtures.

The owner token rides on every task record and socket frame. A saved PID or
native conversation ID establishes nothing.

The owner maintains a per-session slot generation that increments on each
admission into that session's active slot. Validation is scoped by what the
operation touches. An operation on the active slot (admission, current-slot
reads) compares the slot generation. An operation on a historical duty
validates the owner instance and the attempt's own recorded identity and
admission generation, and succeeds while that owner instance lives, including
after a newer attempt replaces the slot. Attempt A's delivery and ACK duties
stay valid after B starts; a client that read active-slot state before the
replacement or before an owner restart receives a typed `stale-slot` or
`stale-owner` refusal naming the current holder.

### 2. Active slot and historical duties

The `executions` row remains the current pointer. Ownership of historical duties
moves into a new duty record held per admitted attempt. A duty record carries:
original attempt id and directory, owner instance and admission generation,
session, inbox cutoff, sealed report identity, native-request delivery
channels, and the four tracked results (delivery, settle, ACK, continuation).
Replacing the active slot never closes a duty.

Owner recovery rebuilds open duties from durable state, and
`ProcessChild.recovery_argv` is not the enumeration source: it returns `None`
once the `released` marker exists (`process-spawn.c:1096`), which is exactly
the historical window where delivery, settlement and ACK are still owed.
Enumeration reads the attempt directory's marker files directly (`status`,
`released`, `acknowledged`), together with sealed reports lacking a recorded
wake outcome, `native_requests` rows with `written=0` or `closed IS NULL`,
`session_stops` rows with a pending `report_id`, and unreceipted messages above
the completed cursor. The enumeration also supplies the retained error record
text and the continuation evidence: a rebuilt duty's continuation reference is
open while retained continuation duties are pending, and records recovery
only when the enumeration shows the previous process-local operations ended
and their continuation duties are re-enumerated and owned by the recovering
owner; reconstruction never settles a live join and grants no replacement
authority, which the host guard and custody acquisition establish. When every
coordinator duty is fulfilled and the marker is present, the decision is
empty and the durable retained error record remains authoritative on its own.
The coordinator's own enumeration includes failed or
pending notices and settlements after the host acknowledgment; the host's
unacknowledged-child enumeration is another input to it, and an acknowledged
marker alone clears no coordinator duty. A duty is open while a notification
or settlement responsibility remains, regardless of
the `released` marker.

Rebuilt historical duties proceed under their own attempt evidence and address
the original attempt by directory through the custody control sockets. They
must not acquire the session guard: the guard belongs to current-attempt
admission and observation, and session B's active guard is not available to a
duty for attempt A. `attach_owned` with a guard applies only to adopting the
current attempt while the rebuilding owner holds that guard
(`receive.bend:recover_owned`); a live historical keeper is reached through
the directory-addressed attach without a guard, and a released attempt's
keeper still answers attach with its released state subject to the finishing
and busy checks, so the released-not-acknowledged window stays reachable. A
dead historical keeper needs a guard-free orphan-adoption decision; if the
current host API cannot express it, that variant is an explicit controls-next
handoff and this design assumes none.

A queued wake is a responsibility bound to its durable operation and to the
attempt that eventually consumes it, which can differ from the currently
active attempt when input commits while ownership is busy. The pure admission
decisions of the sibling module and the duty records here make no claim that
the active attempt accepted newly committed input.

Failure handling distinguishes pre-admission refusal from post-admission
failure. A refusal before admission (unregistered session, terminal stop,
stale slot, invalid request) returns a typed refusal and leaves no custody,
notification or cleanup responsibility. An accepted wake that fails before
any attempt exists is post-admission failure: it retains the request and
session identity, the exact error, cleanup ownership and the actual parent
notice responsibility, with an empty attempt list, and it manufactures no
attempt or consuming-attempt identity. A failure after admission leaves an
identified owner for cleanup, observation and notification: the duty record
keeps the original attempt identity, the pending guidance, the sealed report
and the error, and the recovery enumeration above re-derives the work from
durable state. Diagnostics preserve the exact attempt identity when database,
report or output operations fail.

### 3. Per-task state, output and native requests

The parameters of `Turn.consume` become the fields of one task record owned by
one task fiber. The task record adds: owner instance and epoch, attempt
directory, session, cutoff, and a task-local output sink. The sink is a buffer
keyed by request correlation id; `Text.control_output` gains a sink-targeted
successor that writes into the calling task's sink. The fd 1 writer remains for
the synchronous CLI command that owns the process. The existing laws pinning
`control_output` (for example `receive-laws.bend:report_persists_before_best_effort_control_output`)
get sink-parameterized successors imported through the real native entry.

Native requests need no structural change: the `(attempt,native_id)` key, the
SQL admission checks and the `control_write(attempt,frame)` delivery already
bind each request to its original attempt and parent. The shared owner runs
`NativeRequests.observe` and `settle` inside the owning task fiber, so two
sessions cannot route an extension event to another session's handle.

### 4. Failure isolation

The registered `IO.die` refusals become `Result`-valued refusals returned to
the requesting client; each converted site gains a law pinning the refusal
value and the next action named. Because `IO.try`/`IO.die` halt the whole
process and forks do not catch the halt, one session's refusal must never
reach a `die` in a shared owner. Process exit is reserved for owner-scope
failure (the owner cannot continue serving any session).

Task fibers isolate failure: one task's error records its outcome and
diagnostics under its own attempt and report identities and leaves sibling
tasks running. The conversion is transitive; the Receive owner's interface
review enumerates the concrete reachable paths, and each is converted and
pinned:

- `Receive.run` → `Store.commit`, registration, stop reads,
  `SessionLock.acquire_session` (itself `IO.try` over canonical and acquire),
  recorded-attempt resolution and manifest validation, `Stop.admit`, retained
  launch.
- `Turn.retained_output` → `consume` → frame and filter SQL readers, guidance
  observe/accepted/pending/write/close, deferred report storage,
  `NativeRequests.observe`/delivery, stop reconciliation and outcome
  persistence.
- `Receive.completed`/`restart_pending` → `Turn.prepare`, observer release,
  `ProcessChild.release`; `finish_pending` → outcome classification, forked
  `Turn.finish`, `NativeRequests.settle`, acknowledgment, queued continuation.
- `Turn.finish`/`player_finished` → `Store.commit`, `Delivery.deliver` and its
  normal/handoff/completed paths including the delivery-log append,
  `Stop.deliver`, `Text.control_output`.

The single-client CLI termination adapters (`Main.execute`'s `IO.try` unwrap
and the `--recover-receive` entry) stay outside the shared task body. A
result-shaped return type alone is not containment: an internal `IO.try` or
`IO.die` on the path still halts the process, so qualification injects
failures at these paths (guidance writes, normalization, stop persistence,
delivery-log append, late finish) while a healthy peer continues, and a
mutation that unwraps a task failure with `IO.try` must fail that
qualification.

### 5. Shared custody process

The per-attempt keeper currently holds three authorities: `waitpid` on the
native child, stdin writes, and the output spool. Merging them into the
coordinator process loses retained work whenever the coordinator dies, and the
accepted recovery behavior (#625) depends on the retained owner surviving. The
design target is one fixed shared custody process per Orchestra database that
holds those authorities for all attempts; the coordinator remains the event
owner. The prepare, start, state and cancel semantic boundary of checkpoint
`e3dd9c58` is retained while the host lifetime implementation is designed
around it; ProcessChild/Direct edits stay with controls-next and the exact new
functions and regions are coordinated before any shared-instance host edit.

Custody-process death is a correlated loss: every bound child loses its
`waitpid` authority, stdin writer and spool holder at once, where today one
keeper death costs one attempt. The contract that qualifies it is part of this
design: each attempt keeps its original identity (directory, recovery
manifest, native birth) in durable storage, so after custody loss every attempt
recovers or records loss independently through its own manifest, with one
active observer or recovery decision per attempt and no duplicate child or
grant. A single OS process variant (custody merged into the coordinator) is a
further consolidation that must present a separately reviewed central-death
contract covering retained work; this design does not assume one.

The coordinator-only prototype with per-attempt keepers supplies limited
observer-savings evidence; per-attempt keepers are the current baseline control
used for comparison, and the fixed shared custody process is the design target.
Final acceptance measures the consolidated
footprint: one coordinator process, one custody process, and the harness
children the providers require, serving all connected sessions through the
ordinary CLI and MCP surfaces.

### 6. Readiness-driven IO

The generated runtime executes blocking IO helpers through a bounded helper
pool (64 slots observed upstream). One fiber blocked in
`ProcessChild.read_line` per active session can saturate that pool and stall
unrelated tasks. The shared owner's read path is therefore readiness-driven:
the owner polls the custody sockets for readable output and dispatches
completed reads to task fibers, so a session waiting on native output holds no
runtime helper. This removes the saturation risk at any session count and the
design introduces no agent-count cap; the observed 64 is a helper-pool size,
and capacity is bounded by memory and file descriptors. The read path is a
ProcessChild boundary change and requires the controls-next handoff.

### 7. Handle lifetime, reuse and stale rejection

`baton_children` grows monotonically: `release` and `acknowledge` leave the
child and retained records allocated and handles increase for the life of the
process (`process-spawn.c:27,1250`). Release and acknowledgment are custody and
completion-duty steps, and neither is an object destructor. A capability
retires only after three conditions hold: every in-flight IO operation holding
a reference has returned, every historical settlement and acknowledgment user
has finished with it (the duty record retains whatever task or result context
that join needs), and the `acknowledged` marker is written. Retirement
invalidates the lookup first, then releases the retained allocation and
descriptor state exactly once, without touching any other child's state. A
freed index becomes reusable, and each capability carries the owner instance
token, the attempt identity and a generation alongside the index; a request
carrying an older generation or a foreign owner token is refused with a typed
result naming the current holder, and never resolves to the new child.
`U32` handles remain process-local; every cross-process surface keeps
addressing attempts by directory.

### 8. Guard binding

Every attempt-addressed operation (`control_write`, `control_signal`,
`attach`, `attach_owned`, `recovery_argv`) carries the attempt directory, which
is the durable identity. The design adds the owner instance token to the
protocol hello and reply frames so a socket peer can refuse a request from an
owner that no longer matches the admitted instance. The guard remains the
`flock` lock: a new owner process acquires a session's guard through
`SessionLock` before it adopts that session's current attempt, and
`attach_owned` keeps the guard held across a dead keeper's observation, as it
does today. Historical duty operations for older attempts proceed without the
guard, as section 2 specifies.

### 9. Prepared grants, cancellation, reap and acknowledgment

The prepared-process lifecycle keeps its current shape — prepare, typed
state transitions, typed prepared cancellation, reap by the keeper, release
and ACK by exclusive markers — and gains an owner-bound task-state module,
`src/context/custody-tasks.bend` (new, additive), with this proposed
surface:

- `Custody.open_duty(owner, attempt) -> Duty` — freezes the owner instance and
  the admission generation and creates the duty record.
- `Custody.check_slot(slot, session, generation) -> Result<Refusal,Slot>` —
  active-slot validation; a lower generation is a `stale-slot` refusal.
- `Custody.advance_slot(slot, session, next_generation) -> Slot` — names the
  replacement active slot; open duties are untouched.
- `Custody.check_attempt(duty, owner, attempt) -> Result<Refusal,Duty>` —
  historical validation against the owner instance and the attempt's own
  identity and admission generation; the current slot generation is not read.
- `Custody.record(duty, ...) -> Duty` — records one invocation result. A
  `Fail` settles that invocation, retains its error text, and leaves the
  matching responsibility outstanding; fulfillment is tracked separately.
- `Custody.duty_open(duty) -> Bool` — a duty is open while any invocation
  result is unsettled or any responsibility is outstanding.
- `Custody.rebuild(attempt, owner, acknowledged, native, delivery, settle) ->
  Maybe<Duty>` — the pure decision over enumerated durable evidence (see
  below). Durable enumeration itself is an explicit owner interface
  implemented at the host boundary.

Cancellation is the typed prepared cancellation of the controls-owned host
API: `BR_CANCEL` validates the exact prepared identity and refuses with `EBUSY`
once a start attempt is latched; signal delivery alone asserts no cancelled
state.

Settlement and fulfillment are distinct. A recorded `Fail` settles its
invocation and is never discarded: the duty retains the error text after it
closes. Fulfillment is tracked as outstanding responsibilities that clear only
on evidence: a parent wake clears when a delivery result names the original
report ID as actually delivered, and a `Fail` delivery settles the invocation
while the wake stays owed; the ACK responsibility clears when the
`acknowledged` marker is recorded; the settlement responsibility clears only
on a fulfilled settlement result, and a failed settlement survives host
acknowledgment with its retained error until fulfillment or an explicit owned
resolution. A duty closes when
every invocation has settled and no responsibility is outstanding, and its
retained errors remain readable. A continuation `Fail` never closes another
attempt's work, and replacing the active slot never retargets an old delivery,
native-request reply, ACK or retry to the new `executions` row.

The owner may reclaim a child capability only under the host ACK protocol of
section 7, while the duty record retains the task and result context that the
joined continuation needs. New work and old finish duties must not hold a
session-wide serialization across a parent delivery or a continuation join.

Grant, cancel, reap, release and ACK remain the existing `ProcessChild`
operations; the module validates owner binding and records duty state around
them. No new keeper, daemon or lifecycle service is introduced by this module.

### 10. Delivery outcomes

Transport acceptance, durable operation admission, endpoint execution and
final report delivery are distinct outcomes, and the caller contract must
correlate them under the original message and report IDs. Owner admission
acknowledges that the bound owner accepted responsibility for the wake; the
final delivery outcome records whether the required notification was actually
delivered. A short-lived dispatch client may exit after owner acceptance, and
the owed notification stays outstanding until its final outcome is recorded;
an admission response alone never discharges it. Retry identifies the same
request and attempt and cannot authorize a duplicate native grant. A client
that disconnects early leaves its retained or local result recorded, keeps the
delivery-log append attributed to its own task, and never cancels a native
child, acknowledges pending guidance or discards a historical parent
notification. An endpoint with an empty endpoint value completes without an
external delivery and its outcome is recorded as such.

### 11. Child environment

`ProcessChild.spawn` and `ProcessChild.retain` gain an explicit environment
parameter, and `process-spawn.c` passes that envp to `posix_spawnp` in place
of `environ`. The proposed additive signatures, following the controls-next
conditions:

The Controls-owned preparation contract (unimplemented export, proposed
shape) is `prepare_env(original_bootstrap, child_snapshot,
recovery_snapshot) -> Result<fault,PreparedWithSnapshotReceipt>` with
`describe_preparation(original_bootstrap)` and
`dispose_preparation(original_preparation)`: both complete immutable
snapshots are captured and validated before prepare returns, custody
retains both copies across qualified owner replacement, and loss of the
original in-memory copies stays uncertain. Duplicate keys are refused, the
owner never
calls `setenv`/`unsetenv` on itself. Native launch and recovery launch are
distinct roles; a recovery launch sources its argv from the recorded manifest
and the same explicit environment rule, so neither role inherits a previous
model's credentials. The scoped-environment construction stays in the harness
launcher layer (`git-series.mjs`), which supplies the removal and override
rules; API-key and Git secret values are passed to the child environment only
and are recorded nowhere — not in report logs, not in durable requests. The
recovery manifest needs no new field, so the `prepare` signature changes only
through the explicit-env variants. Existing eager APIs keep their current
semantics until explicit composition. This change is inside the
ProcessChild/Direct region and requires the controls-next handoff before any
edit.

### 12. Hosted entry

The shared owner is a new internal entry, proposed as `baton2 DATABASE
--owner-serve`, added to the CLI dispatch by synthesis handoff. The entry:

1. resolves the selected canonical database path, checks its physical
   identity, acquires the database-level owner lock, refuses
   multiply-linked or replaced database files, and binds a fresh instance
   token,
2. enumerates durable evidence and rebuilds open duties with
   `Custody.rebuild` decisions,
3. serves a readiness loop: control operations, custody-socket output
   dispatch to task fibers, and completion-duty progress, and
4. never runs the public `Main.execute` termination adapters inside a task;
   the CLI unwrapping (`IO.try` at `Main.execute` and `--recover-receive`)
   stays outside the shared task body.

A task's result distinguishes pre-admission refusal, native model or process
or observer outcome, notification, settlement and ACK results, and the
client-output result, under the immutable owner/database/session/request
context and the original attempt context (id, directory, cutoff, native
identity, capability, guard, observation state).

### 13. Scope

The owner serves the existing baton CLI and MCP operations with their current
names and results. The design adds no operation registry, plugin surface,
message bus or second messaging path. Session hierarchy, receipt semantics,
report/question routing and the knowledge plane are unchanged.

## Exact API/source boundaries

| Region | Current owner | Proposed change | Boundary |
| --- | --- | --- | --- |
| `src/context/custody-tasks.bend` (new) | this design | task records, duties, slot/attempt validation, rebuild decision, laws | additive, owned here |
| `src/coordinator/receive.bend`, `turn.bend` | native-receive-conductor | result-valued entry successors, sink-targeted output, per-task fiber entry | accepted handoff required |
| `src/coordinator/stop.bend` (`executions`) | shared stop semantics | slot replacement validated through `Custody.check_slot`/`advance_slot` | accepted handoff required |
| `src/host/process.bend`, `process-spawn.c` | semantic-controls-next | environment parameter, owner token in hello/reply frames, per-child shared-keeper prerequisites | accepted handoff required |
| `src/host/text.c`, `text.bend` | synthesis | sink-parameterized `control_output` successor | accepted handoff required |
| `src/coordinator/main.bend`, `commands.bend`, `scripts/mcp-conductor.mjs` | synthesis | owner resolution, request/reply correlation, law import through the real entry | accepted handoff required |
| `src/coordinator/native-requests.bend` | this design composes; receive owner owns observation | no structural change | compose only |
| `src/instance/event-registry.bend` (new) | this design | retained event-destination registry decisions: full-correlation resolution, registration arming, reference and disposal lifecycle | additive, owned here; Controls owns the file effects, reader serialization and shared event synchronization it composes |

The registry composes with the Controls offered-reader layer at
`72f081d3f5702c6afc244cbf2a7c8fc09742e0fb` (`br_read_offer_init/ready/take/
dispose`, internal, unexported): the version-qualified Controls wrapper
rejects stale observations before invocation, a pending contradiction latches
the reader fault, and one pending offer allocation exists at a time — the
instance retains the original task and destination and an in-flight reference
before borrowing, takes by exact serial only after task adoption, and a
retained failure task carries the latched fault and the original
task/correlation responsibility with the allocation. Take grants allocation
custody only; it advances no durable interpretation or effect checkpoint and
grants no ordinary interpretation permission.

Two transfers stay distinct. Readiness-event acceptance
(`Registry.accept_ready`) moves the responsibility to wake and retry
`read_ready` to the owning task; it transfers no offered allocation. Frame
adoption is a separate hosted operation after an actual `OfferedFrame`,
preserving the original correlation, the exact reader incarnation and serial,
the latched fault and task ownership before take. Event, task and destination
ownership is conserved across keyed adoption, requeue and completion: the
pure transitions refuse duplicate adoption, refuse requeue without an
outstanding task event, and check every increment and decrement, and the
module deliberately provides no unkeyed task-count debit.

The precise missing primitive preventing a concrete hosted call site is the
owner event-loop entry itself: `--owner-serve` is a pending composition
contract with no existing literal in any reviewed source, routed through
Interfaces and Controls. Until that entry exists, the instance region can
supply the pure decisions, their evidence, and the actual retained keyed
table and its checked transitions (`retained-table.bend`,
`event-registry.bend`); what remains missing is only the process hosting
of that table behind the pending owner entry and the operative exports
named above. The exact unavailable host primitives, as found at the
reviewed pins: no callable `attach_reader`, `read_ready`,
`register_ready_event`, `cancel_registration`, `release_frame`,
`release_reader`, `release_destination`, `prepare_env`,
`describe_preparation` or `dispose_preparation` export exists anywhere in
the reviewed source; the only concrete reader layer is the internal
Controls `br_read_source_*`/`br_read_offer_*` C helpers with no Bend
export. Startup, return and failure ownership for the Instance operations
follows the hosted entry: the entry process starts the owner loop, resolves
each call's leases under the shared synchronization, returns typed outcomes
to the calling client, and retains failures as duties — no pure record
establishes any of it.

Cleanup adoption follows the Controls `932cd36d` disposal contract: the
offered-frame/cleanup adoption returns an explicit accepted or refused
disposition; until the original task has accepted a complete copy bound to
the original correlation and reader incarnation, the cleanup record and its
responsible owner stay retained, acceptance precedes storage free or
reinitialization, the primary init/read error stays separate from both
close-attempt results, and a close error never authorizes another close on
the former numeric descriptor. Successful source disposal establishes
neither registry quiescence, settled interpretation or effects, parent
delivery nor ACK completion; a normal ACK attempts the raw unlink of
attempt and stdout records, so raw availability after ACK depends on the
cleanup outcome — retained when cleanup fails, gone when it succeeds —
while filtered public logs keep serving, so recovery binds to the
actual retained original sources and returns an explicit unavailable or
uncertain disposition where they no longer exist.

Finality and retention precision for the reader-facing duties: native
`waitpid` plus custody release establishes neither all-writer finality nor a
sealed extent — only Controls' qualified current observation does, and task
or reader operations never manufacture a seal from child exit, release, a
zero-byte read or an ACK. A normal ACK attempts the raw unlink, so raw-data
availability after ACK depends on the cleanup outcome: neither universal
retention nor universal deletion follows from ACK alone, cleanup uncertainty
is preserved with the original duties, and selected public-log byte offsets
denote a different byte stream from raw offsets — exact historical raw bytes
that are unavailable stay unavailable, with no substitution of public bytes
and no reinterpretation of public offsets as raw parser state.

The custody-task module and isolated fixtures can be developed now in this
worktree. Imports into the protected regions wait for the accepted handoffs;
the real native entry (`main.bend` importing `laws.bend`) must import every new
operative law at integration time.

## Qualification

The baseline and candidate run the same owned fixture workload with concurrent
sessions covering: distinct simultaneous inputs and native requests, busy
delivery at guard release, delayed historical parent notification while a newer
attempt runs, sealed replay with late terminal frames, unnamed or incomplete
assistant activity, inert drain output, stopped and failed sessions beside
healthy sessions, observer recovery across a dead keeper, stale owner-instance
handle rejection, and selective release/ACK of one attempt among several.

Measurements capture raw output, actual child exit statuses, source and
toolchain identity, process roles, startup latency, CPU, RSS and a private
memory measure. RSS sums and physical footprint are recorded as the separate
measures they are. The live Orchestra supports read-only observation only;
failure probes run against fixtures.

Every operative law is imported through the real native entry and checked on
each exact-source build. Mutation controls alter the operative implementation
and demonstrate the corresponding semantic failure. Recorded evidence retains
full child output and actual exit statuses. The design adds no test-count or
line-number pins, no fixed timeouts, no fixed worker counts and no expected-red
manifest entries. The `IO.try`/`IO.die` halt semantics are established by root
runtime review and independent bend 2.0.25 probes (die exit 23, failed `IO.try`
exit 24, the stopped-admission helper exit 2, a returned `Fail` exit 0 with the
caller surviving); the module fixtures re-run them on every evidence build.

Additional required probes from the owner interface reviews: failing database
or SQL operations injected inside guidance, normalization, stop persistence,
delivery-log append and a late finish while a healthy peer continues;
an unregistered or refused task beside a healthy task; one output client
disconnected during an old attempt's parent notification while the
notification completes and stays owed-recorded; an old attempt's ACK attempt
against a replaced capability refusing; recovery errors before and after guard
acquisition and native launch; two admissions for the same bound
database/session; slot reuse with outstanding old-generation requests; and
repeated task completion with stable owned allocations.
