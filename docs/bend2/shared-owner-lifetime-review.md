# Shared native owner lifetime review

## Scope and evidence

The reviewed baseline is `fca7af876c8260c32d17f95f3e19bc68ee1bf561`.
The review also reads the supplied receive custody note and the prepared host
checkpoint `e3dd9c58`. The latter has separate ownership and acceptance.
Production source remains unchanged. The new fixtures import baseline functions.
The live Orchestra received review messages and acknowledgments only.

The conductor proposal `shared-native-owner-boundaries.md` correctly separates
active admission from historical completion, keeps U32 handles process-local,
and requires task-specific results, output and harness environment. The source
boundaries are suitable for further design. Implementation acceptance requires
the concrete behavior below. No sibling owner design was available at the first
review snapshot.

## Measured error propagation

`bend2/test/shared-owner-lifetime-critic/failure.bend` forks an IO computation,
joins its result, and then prints `owner-survived`. Bend 2.0.25 produced:

| Task operation | Process exit | Owner reached the join continuation |
| --- | --- | --- |
| `IO.die(...,23,"task-die")` | 23 | No |
| `IO.try` on `Fail{(24,"task-try")}` | 24 | No |
| Actual `Stop.require_open(True{})` | 2 | No |
| Return `Fail{(25,"task-result")}` | 0 | Yes |

All four runs printed `owner-ready`. The first three printed their full error
to stderr. Only the returned-result case printed `owner-survived`.
The stopped case tests the named Stop helper. `Receive.available` already
returns a failure value for stopped admission; it does not call that helper.
`Receive.registered(False{})` still calls `IO.die`, and `Receive.run` and its
dependencies use `IO.try`.

A result-shaped return type does not contain an internal `IO.die` or failed
`IO.try`. The shared entry must propagate expected task errors through every
reachable effect. Qualification must run a failing task alongside a healthy
task and observe the healthy task's result, native requests and completion.
A mutation that unwraps a task failure with `IO.try` must fail that qualification.

## Measured guard identity

`guard.bend` calls actual `SessionLock.acquire_session` while the first guard is
still held. All probes exited 0 with these observed acquisitions:

| Second database path | Same session | Different session |
| --- | --- | --- |
| Original path | Busy | Acquired |
| Symlink to original | Busy | Acquired |
| Hard link to original | Acquired | Acquired |

`host/session-lock.c` derives a lock-file name from `realpath(database)` and
hex-encoded session bytes. Hard links preserve different canonical path strings.
The observed contract is canonical-path/session ownership. A shared owner's
claim of one instance per physical database requires an explicit database
binding policy and tests for aliasing and file replacement. This fixture tests
guards on empty temporary files; it does not establish SQLite safety under
hard-link access.

Simultaneous admission must keep the actual session guard through publication
of the attempt and custody transfer. `Stop.admit_sql` uses `BEGIN IMMEDIATE` and
replaces `executions(session)` on conflict; a transaction by itself allows two
successive admissions. Test two admissions for the same bound database/session
and a concurrent admission for another session. Removing the guard or releasing
it before custody transfer must produce a failing control.

## Historical finish duties and parent delivery

`Receive.completed` prepares diagnostics, releases its optional observer guard
and calls `ProcessChild.release` to release the keeper's session lock after
native exit. The attempt handle and completion duties remain. ACK later requires
exit and release, records acknowledgment and permits the keeper's spool cleanup.
`Receive.finish_pending` then forks `Turn.finish` and
`continue_pending`. It joins delivery, settles native requests, acknowledges the
original handle, and joins continuation. This permits the following schedule:

1. Attempt A releases its guard and starts a parent endpoint delivery.
2. The endpoint delays its reply. Input committed after A's cutoff admits B.
3. B replaces the session's current execution pointer and starts observation.
4. A's endpoint completes. A settles its requests and acknowledges A's handle.

A task map keyed only by session can overwrite A at step 3. A callback that
looks up the current handle can acknowledge B at step 4. The owner needs a
separate original-attempt duty with immutable directory, handle binding,
report identity, request deliveries and terminal outcome. Completing A must
leave B's observation and input active. Qualify this schedule using an endpoint
barrier and observed child events. Mutate the finish lookup to the current slot
and require the same test to fail.

`Turn.player_finished` invokes `Delivery.deliver` for the report and diagnostics,
then `Stop.deliver`. `Delivery.launch` executes a configured endpoint and waits
for its status. Its empty-endpoint branch returns `Done{saved}`. A committed
report or successful delivery result alone therefore cannot prove parent wake.
The qualification must capture the recipient's ordinary receive admission or
active-owner input acceptance and its exact report ID. Delayed, busy, absent and
failed endpoints need separately observable outcomes and continuation duties.
Any absent endpoint with owed live work requires an explicit disposition that
wakes the responsible orchestrator.

## Handle, output and request bindings

`host/process-spawn.c:baton_process_begin` allocates monotonic indices into the
process-local `baton_children` array. Two owner processes can each allocate
handle 0 for unrelated attempts. After replacement, a delayed request containing
only 0 can select the new owner's unrelated child. The external protocol must
validate owner instance, database binding and attempt before resolving a local
handle. Saved native identity or PID cannot authorize a new grant or resume.

`host/text.c:baton_control_output_call` serializes writes to fd 1. That lock
provides no request destination. Concurrent task A and B must receive their own
output and exit status through explicit response channels. Include one broken
client connection: A's output failure must leave B's response and the owner's
other completion duties observable. Mutate response routing to the latest
client and require the test to fail.

`NativeRequests.request_sql` keys native requests by `(attempt,native_id)` and
retains worker, parent and request identity. Test two sessions using the same
provider request ID, with one late response after active-slot replacement.
The reply must resolve the original attempt and its closed/stopped state.
Changing correlation to native ID or current session handle must fail.

## Readiness and resource lifetime

The generated Bend 2.0.25 C runtime defines `IO_HELP` as 64 and dispatches
blocking foreign calls through that helper pool. Baseline `br_read_line` waits
on `retained->changed` inside its helper call. If pending reads occupy the pool,
a queued write, database query or stop effect can depend on a helper that none
of those reads releases. This is a source-derived saturation counterexample;
this review has not run a loaded saturation fixture. The owner needs
readiness-driven observation. Qualification must discover the runtime's actual
helper capacity and demonstrate control progress with pending native reads.
That capacity supplies a test condition and must not become an agent limit.

Baseline `BP_ACK` closes retained descriptors and joins the receiver thread.
`baton_process_pack` frees the temporary call; it frees a `BatonChild` only when
creation fails. Successful handles remain in the monotonic table, and the ACK
path retains the child and retained allocations. A long-lived owner therefore
needs explicit retirement after its last historical duty and in-flight call.
If it reuses slots, it also needs generation validation. Test repeated completed
attempts, delayed old-handle requests and overlapping finish callbacks while
measuring retained allocations. A stale token must never act on a reused slot.

## Prepared custody, stop and recovery

At `e3dd9c58`, `br_grant` records `start_attempt` before spawning. `br_command`
validates the prepared request identity, refuses cancellation after a start
attempt, and allows ACK only after exit and release. These fields belong to one
`BrKeeper`. A shared keeper must bind every field, waiter and socket reply to its
specific child. Use distinct children A and B to test duplicate grants, cancel
before grant, grant after cancellation, release before exit, and ACK before
release. Releasing or acknowledging A must preserve B's guard, output, native
requests, waiter and actual exit status. Apply mutations to the operative child
selection and grant latch. This review has not run the successor host gate.

`Stop.admit_sql` and stop request publication share transaction ordering.
`Stop.started` reconciles a stop accepted during startup, and stop updates are
qualified by session and attempt. Test stop-before-admission, admission-before-
stop, and a delayed old-attempt exit while a newer pointer exists. The exact
stopped child must be reaped and reported; a healthy sibling must complete.

Observer loss and keeper loss require different evidence. Test owner loss with
retained keepers, shared keeper loss with several children, and failed recovery
or waiter creation. Recovery must inspect retained attempt/bootstrap identity,
qualified process birth, output and wait evidence before deciding custody.
Historical delivery obligations must also be recovered after owner loss when
the current execution pointer already names a newer attempt. Current-slot
enumeration alone cannot recover that older obligation. No correlated keeper
failure guarantee is established by the per-attempt custody note.

A fixed shared custody process can retain the anonymous stdin writers and
`waitpid` authority when the coordinator dies. Its central-loss tests must cover
every admitted attempt. Combining custody and coordination in one OS process
requires a separately reviewed recovery contract for loss of both resources.
The final process layout must meet the consolidated-footprint requirement;
keeping a resident keeper per session provides only intermediate evidence.

## Reproduction and limits

Run the new fixture runner with an installed Bend 2.0.25 compiler:

```sh
python3 bend2/test/shared-owner-lifetime-critic/run.py \
  --bend /absolute/path/to/bend \
  --output /absolute/path/to/evidence
```

The runner preserves complete compiler and child stdout, stderr, argv and exit
status, plus source commit and imported production-file hashes. The reviewed
run is in this worktree's `.scratch/lifetime-critic/verified`; the runner exited
0. The initial parser error remains in the surrounding scratch evidence; the
initial argv error is retained in the review turn's tool output. The corrected
probes demonstrate the error and guard behaviors above.
The remaining schedules are source-derived requirements for candidate tests.
These probes provide no native shared-owner acceptance, process savings,
deployment evidence or successor receive/Direct qualification.
