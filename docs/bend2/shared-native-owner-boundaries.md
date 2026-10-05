# Shared native owner boundaries

## Source scope

This proposal reviews commit `fca7af876c8260c32d17f95f3e19bc68ee1bf561`.
The receive and prepared-process handoffs supplied with task
`semantic-synthesis-native-instance-conductor-46` describe successor work owned
by native-receive-conductor and semantic-controls-next. Their runtime acceptance
and source handoffs remain separate requirements.

## Current process and task boundaries

`coordinator/delivery.bend:launch` executes the registered endpoint and waits for
its process result. `coordinator/main.bend:execute` calls `Receive.run` for a
receive command. `host/process-spawn.c` retains child state in a process-local
`baton_children` array and launches an attempt keeper. The provider harness is a
separate child with its own process group.

`harness/git-series.mjs:launch` builds a model-scoped environment and uses
`process.execve`. The launcher therefore replaces its process image. A process
inventory must distinguish that replacement from a resident Node wrapper.
The scoped environment includes Git identity and authentication configuration;
the GPT route removes API-key overrides for the configured subscription route.

`scripts/mcp-conductor.mjs:coord` invokes the native command through
`execFileSync` and associates stdout, stderr and status with that invocation.
`host/text.c:baton_control_output_call` serializes writes to process fd 1. Its
stream lock provides byte serialization; each client still needs its own reply
destination and request correlation in a shared owner.

## Proposed ownership

One native owner serves one bound Orchestra database instance. Ordinary CLI
and MCP commands retain their public operation names and results. A short-lived
client resolves the owner, submits the operation and receives that operation's
output and status. Owner admission must qualify the database binding and owner
instance before sending work. A saved PID, native conversation ID or socket
pathname alone cannot establish that binding.

The owner keeps an active admission slot for each session and separately keeps
every admitted attempt until its completion duties finish. An attempt contains
its owner instance, database binding, session, attempt ID, directory, inbox
cutoff, native identity, observer guard, child capability, output cursor,
completion state and native-request deliveries. External clients identify an
attempt through the bound owner protocol. U32 child handles stay inside their
owning process.

`Receive.completed` releases the observer guard and child observer before
`finish_pending` completes. `finish_pending` concurrently starts parent delivery
and pending-input continuation, then settles native requests, acknowledges the
original handle and joins continuation. The owner must therefore retain the old
attempt's delivery and ACK duties after replacing the active session slot.
The mutable `executions` row supplies the current pointer; historical duties
require their original attempt identity and retained evidence.

Model-scoped environment construction belongs at each harness launch. The
shared owner must never change its global environment to impersonate the most
recent client. Concurrent harnesses must receive their configured identities
and model routes independently. The current host spawn passes `environ`; the
host owner must approve the exact child-environment API before integration.

## Failure and output isolation

The current `Receive.registered` refusal calls `IO.die`, and receive/turn helpers
use `IO.try` throughout. The bundled upstream guide describes these operations
as exiting on error. A shared task entry needs explicit result propagation and
task-scoped output. Forking the current public CLI entry requires a runtime
isolation proof before use. The initial implementation should expose an owned
task result to its caller and reserve process termination for owner failures.

A shared keeper also needs child-specific grant, cancellation, reap, release
and acknowledgment. Its failure can affect several native children. Existing
per-attempt keeper-loss evidence does not qualify this correlated failure
boundary. A coordinator-only prototype may measure observer savings while
per-attempt keepers remain; that prototype has a narrower process-reduction
claim than the complete one-instance requirement.

## Source handoffs

The new task-state module and isolated fixtures can be developed independently.
Integration requires explicit owner agreement for these interfaces:

- Receive/Turn: result-valued task entry, task output destination, attempt-local
  observation state and independently retained finish duties.
- ProcessChild/Direct: owner-bound child capabilities, child environment,
  selective grant/cancel/reap/ACK and correlated keeper-failure behavior.
- Main/Commands/MCP: owner resolution, ordinary command routing, request/reply
  correlation and importing operative laws through the real native entry.
- Delivery: endpoint acceptance and final delivery result semantics, including
  a busy recipient and a delayed historical parent notification.

This proposal grants no edit authority in those existing regions.

## Qualification

The baseline and candidate must run the same owned fixture workload with
concurrent healthy, stopped and failed sessions. Capture raw output, actual
child exits, source/tree/toolchain identity, process roles, elapsed startup,
CPU, RSS and available private-memory or physical-footprint measurements.
RSS totals and physical footprint are separate measures. The live Orchestra
supports read-only observations; destructive failure probes use fixtures.

Required semantic probes include distinct simultaneous inputs and native
requests, busy delivery at guard release, delayed old-attempt notification while
new work runs, late terminal frames, incomplete assistant activity, inert drain
output, stopped admission, failed sessions beside healthy sessions, observer
recovery, stale owner-instance handles and selective child acknowledgment.
Mutation controls must alter the operative implementation and demonstrate the
corresponding semantic failure. All applicable laws must be imported by the
real native entry and checked on each exact source build.
