# Unaccepted lifetime fixture and proposed host interfaces

## Preserved proposal fixture

Scope correction: conductor task `native-instance-lifetime-critic-continuation-12`
withdraws production implementation from this critic. The authored source is
preserved only at `test/shared-owner-lifetime-critic/proposal/lifetime-protocol.bend`.
It is unaccepted fixture/proposal evidence and is outside production source.
The owner must independently assess or implement the proposed interfaces.

The preserved pure fixture implements original-attempt binding comparison, operation acquisition and
completion, acknowledgment observation, lookup retirement, reclamation
eligibility, notification evidence handling and admitted failure retention.
Its laws call those functions. The module is separate from the owner's
`custody-tasks.bend` work and edits no existing Receive or host implementation.

`Binding` contains owner instance, database binding, session, original attempt,
directory and capability generation. Historical operations compare with the
original capability. The active session slot is absent from this comparison.
The host must validate the database binding and issue non-reused generations;
these strings and constructors alone confer no authority.

`Capability` tracks access phase, uniquely named operation references and the
observed ACK state. `acquire` rejects stale bindings, closed lookup and duplicate
operation names. `complete` removes an existing reference under its original
binding and works while lookup is closing. Repeated completion is refused.
`note_ack` preserves references. `begin_retire` requires successful ACK and
closes lookup while references still exist. `reclaim` requires closing lookup,
successful ACK and an empty reference set. It returns a retired value; it does
not free a host object. Host state updates must be atomic and each retained IO,
settlement or ACK user must acquire its reference before accessing the object.

`Invocation.Failed` is settled. `fail_admitted` retains the same capability and
notification responsibility with that error. `observe_notice` leaves a notice
owed after endpoint admission or failure. A matching recipient/report witness
can discharge it. A trusted host adapter must produce that witness from actual
parent admission or input acceptance. A caller-supplied string is insufficient.
Errors remain recorded independently of that obligation. The module handles
notices that have a required recipient; parentless local results use the output
boundary and need their own result retention.

The host must preserve an explicit retry owner and wake for every failed owed
effect. The pure module performs no retry, durable write, parent wake, grant,
recovery or destruction. An idle `Owed` value would not satisfy the runtime
contract. Durable enumeration must include released historical attempts and
must restore their duties without acquiring the successor's admission guard.

## Proposed Receive interfaces

The following are proposed signatures for the current source owners to
implement. They are not implemented effects or stub wrappers. `L` names the
compiled `lifetime-protocol.bend` types; `Result` is the existing Base result.

```text
Receive.run_hosted(
  context: L.HostedContext,
  command: String, model: String, effort: String,
  workspace: String, log: String, wake: String
) -> IO(L.HostedResult)

Receive.finish_hosted(
  context: L.HostedContext, original: L.AttemptContext,
  duty: L.Duty, outcome: Turn.Outcome,
  deliveries: List<Chan(Result<U32 & String,String>)>,
  again: Unit -> IO(L.HostedResult)
) -> IO(L.HostedResult)

Text.control_output_to(
  context: L.HostedContext, text: String
) -> IO(Result<U32 & String,Unit>)
```

`HostedContext` freezes owner/database/session/request/output-sink identity.
`AttemptContext` freezes the original capability binding, cutoff, native
identity, optional process-local handle and optional observer guard.
`HostedResult.BeforeAdmission` means no owned effect or guard remains.
`HeldAdmissionFailure` preserves an acquired guard and its cleanup owner when
native admission has not completed. `AfterAdmission` retains original attempt,
duty, model/process/observer outcomes, notification/settlement/ACK outcomes,
continuation outcome and client-output outcome separately. Some stages can
remain pending under their retained owner. Any actual native admission requires
the latter form, including an unknown outcome after lost transport.

The Receive owner must propagate results through the transitive Store/SQL,
SessionLock, Guidance, normalization, NativeRequests, Stop, Delivery and output
paths named in its source handoff. The ordinary Main termination adapter stays
outside `run_hosted`. A wrapper that calls the current entry cannot implement
these signatures safely. The sink lookup validates the complete request
context. Client disconnect produces a task output result and preserves native
custody, pending guidance and historical notification.

`finish_hosted` must preserve current sequencing: persist outcome and prepare
reports while owned; release the optional observer guard; request keeper lock
release after native exit; begin original parent delivery and continuation;
settle original requests; ACK the original child; join continuation. RELEASE
does not destroy or detach the handle. ACK is distinct from general host
destruction. The original capability can retire after its final users drain,
while the caller retains a smaller result context for the continuation join.

## Proposed ProcessChild capability interfaces

```text
ProcessChild.acquire_bound(
  binding: L.Binding, operation: String
) -> IO(Result<U32 & String,L.OperationLease>)

ProcessChild.complete_bound(
  lease: L.OperationLease
) -> IO(Result<U32 & String,Unit>)

ProcessChild.begin_retire_bound(
  binding: L.Binding
) -> IO(Result<U32 & String,Unit>)

ProcessChild.finish_retire_bound(
  binding: L.Binding
) -> IO(Result<U32 & String,Unit>)
```

`OperationLease` contains the validated binding, unique operation name and
process-local U32 handle. It is internal to the host process. External frames
carry qualified binding and operation identity; the host validates them before
looking up any local index. The host registry verifies active leases and rejects
forged or replayed lease values. Existing U32 functions remain private to that
validated operation path. No client controls a local index directly.

`begin_retire_bound` atomically invalidates lookup. A pending reference keeps
storage owned. Its final completion must trigger the outstanding retirement
operation, with no dependence on a later client request. `finish_retire_bound`
frees child/retained allocations, buffers and descriptors exactly once when
reclamation is permitted. Repeated destruction must return an identified
already-retired or stale result. A slot obtains a fresh generation before reuse.
The host must separately retain needed historical outcome and notification
data after removing the child object. These effects remain controls-next-owned.

## Proposed explicit environment interfaces

```text
ProcessChild.spawn_env(
  argv: String, workspace: String, stderr: String,
  environment: List<L.EnvironmentEntry>
) -> IO(Result<U32 & String,U32>)

ProcessChild.prepare_env(
  directory: String, argv: String, workspace: String, stderr: String,
  initial: String, keep_stdin: U32, guard: U32,
  recovery_argv: String, identity: String,
  native_environment: List<L.EnvironmentEntry>,
  recovery_environment_source: L.EnvironmentSource
) -> IO(Result<U32 & String,ProcessChild.RetainedStart>)
```

An `EnvironmentEntry` is a key/value pair. The complete immutable list supplies
one child's `envp`. Validate nonempty keys, absence of `=` and NUL in keys,
absence of NUL in values, and reject duplicate keys before spawning. Omitted
keys remain absent; there is no fallback to the owner's global environment.
Each launch constructs and frees its own `envp`. Neither `setenv` nor `unsetenv`
is used on the shared process.

The native snapshot is resolved in memory using the recorded model's existing
Git-series policy, including its removal rules. Its values have no durable
encoding in the new module and must not be copied into a report, manifest or
operation log. `EnvironmentSource` holds role, configuration key/revision and
route, with separate `NativeLaunch` and `CoordinatorRecovery` roles. Recovery
re-resolves the authorized configuration through the existing launch policy.
An unavailable or disallowed revision returns a retained recovery failure with
an explicit wake owner; it cannot fall back to a previous model's credentials.
Bootstrap/manifest evolution for that source reference is an unimplemented
host-owner interface. Existing eager/prepared APIs retain their semantics.

Prepared start/state/cancel remain the identity-qualified typed API from the
host handoff. Cancel before grant acts on a prepared child with potentially no
native PID. The fixed custody process keeps grant, wait, spool and stdin
authority per child. Its readiness and correlated-loss guarantees require real
host implementation and independent failure tests.

## Validation and remaining integration

`test/shared-owner-lifetime-critic/protocol.bend` imports the actual new module
and executes its pure transitions in a native binary. `run-protocol.py` checks
the fixture, builds and runs it, discovers each new law and removes its proof
in an isolated copy, then mutates operative implementations. Every proof removal must fail compilation as incomplete proof. Every
implementation mutation must fail with its affected law named in full output.
The runner retains each modified source beside that compiler result.
Source hashes, compiler identity, stdout/stderr and actual exits are retained.

No production module or normal `main.bend` import is changed. Any accepted
owner implementation will need operative laws in the real native entry before
landing. Fixture compilation and pure transition
controls do not prove actual shared-task failure containment, concurrency,
destruction, durable recovery, environment isolation or parent wake. This module
requires independent review; its author is not its independent acceptance gate.
