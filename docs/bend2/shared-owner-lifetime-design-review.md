# Shared owner design review

## Reviewed sources

This review covers conductor proposal commit `0e872489` and the owner draft
`shared-owner-task-custody-design.md`, captured from the owner's worktree with
SHA256 `d2388c49f1a5dea2dd2babab7e387c8e04e972124e24a42cf2f35114b83621c3`.
The draft was uncommitted when read. Its captured bytes are retained in this
reviewer's `.scratch/lifetime-critic/review-0e872489/owner-design-snapshot.md`.
Findings apply to those versions. Source comparisons use unchanged baseline
`fca7af876c8260c32d17f95f3e19bc68ee1bf561`.

The updated conductor proposal includes the required fixed shared custody
process, readiness-driven operations, transitive error results, capability
cleanup and separate endpoint admission and delivery outcomes. These are
appropriate design requirements. They remain subject to source-owner handoffs
and implementation qualification. The owner draft needs the corrections below
before implementation of its proposed task-state module.

## Owner draft corrections

### Historical operations need attempt-specific generations

Section 1 increments the epoch on each admission into a session slot and rejects
operations carrying a stale epoch. It explicitly includes a client that read
state before a newer attempt replaced that slot. Section 2 preserves historical
duties after slot replacement.

Counterexample: A releases its guard; B is admitted with a newer epoch; A's
delayed parent delivery finishes and its original ACK is submitted. Applying
the stated current-slot epoch rule refuses A's valid ACK. An owner-instance
token, a session-slot version and an attempt-capability generation need distinct
roles. Historical operations validate against A's retained attempt capability.
After A retires, a request for that generation is stale even if its storage is
reused. Test valid A ACK after B admission, invalid retired A ACK after storage
reuse, and rejection across coordinator replacement with surviving custody.

### Released historical duties need a separate recovery path

Section 2 proposes rebuilding unacknowledged duties using
`ProcessChild.recovery_argv` and attaching each through `attach_owned` after
session-guard acquisition. Baseline `br_recovery` returns no command when the
directory contains `released` (`host/process-spawn.c:1096`). A released attempt
can still owe delivery, request settlement and ACK. The native fixture in this
review confirms this filter on a synthetic valid-format manifest:

| Directory state | Actual `recovery_argv` result | Process exit |
| --- | --- | --- |
| Launch marker and manifest; unreleased | Original fixture command | 0 |
| Same files plus released; unacknowledged | No command | 0 |

The fixture calls the real host function. Its birth record is synthetic and no
native child exists. It establishes the marker filter only. It does not prove
that the fixture represents an attachable or recoverable child.

A second conflict exists when B holds the session guard: historical A cannot
reacquire that same guard while B runs. Restoring A's finish duty must preserve
B's admission and observation. The contract needs durable discovery of each
original attempt and outstanding finish duty, plus a qualified attachment for
historical completion that does not acquire B's admission ownership. It also
needs exact reconstruction of each duty result; in-memory channels cannot be
recovered as channels after process loss.

Test coordinator loss after A's release and before A's parent-delivery result,
with B already current and running. A's notification and ACK must complete
against A while B remains usable. Removing released attempts from discovery or
requiring B's guard for A must make that test fail.

### Duty completion needs explicit failure dispositions

Section 2 keeps a duty open until its four results are observed. Section 6 says
it completes only when delivery, settle, ACK and continuation are all `Done`.
These conditions differ when a task returns `Fail`.

Counterexample: A returns a provider failure; every required diagnostic is
delivered, its native requests settle, and its handle is acknowledged. The
continuation result preserves a failure from a later attempt. Requiring every
result to be successful can retain A forever. Conversely, an ACK or delivery
failure may still leave a real obligation. Define settled outcomes and the
explicit retained retry or escalation owner for each failed effect. Each retry
owner must receive an actual wake. A failure value must not imply an unobserved
wait or silently discharge an owed effect.

Baseline `finish_pending` joins recursive continuation. A long-lived shared
owner must describe whether the historical-duty object retains that entire
future chain. Separate original-attempt cleanup from the caller's aggregate
result and from a successor task's lifetime. Qualify repeated session turns
with old reports completed, a running successor and stable retired allocations.

### Database ownership needs its own admission mechanism

Section 1 resolves the owner through the existing session guard. Session guards
allow concurrent ownership of different sessions. Two clients for sessions A
and B can therefore each establish an owner using those guards. The design must
specify atomic owner selection for the bound database and atomic custody owner
selection separately from per-session admission. Include concurrent cold starts,
owner loss during initial handshake and database aliases. The previous guard
fixture already shows that hard links have distinct canonical-path guards.

### Align the target and prepared semantics

Section 4 retains one keeper per attempt as the default. The current conductor
target has one fixed custody process per Orchestra. The draft also lacks the
operative readiness and safe capability retirement contracts. An intermediate
prototype can have narrower scope, but its API must account for the final
shared custody, recovery ownership and resource lifetime before composition.

Section 6 describes prepared cancellation as cancellation by signal. The
supplied prepared checkpoint exposes identity-qualified `cancel_typed` before
grant. A prepared child may have no native PID to signal. Preserve that boundary
and distinguish cancellation before grant from stop signaling after grant.
The baseline's orphan fallback treats some marker `EEXIST` cases as success;
that branch alone does not prove every duplicate release or ACK is idempotent.
Use the accepted ProcessChild contract for those operations and test retries.

## Remaining conductor contract details

- Coordinator recovery needs a trigger and a named owner. Custody retaining
  children after coordinator death does not by itself wake an orchestrator.
  Specify which custody event starts or wakes the single replacement and how
  failed replacement launch leaves an observed obligation. Per-child recovery
  must not recreate a resident coordinator per session.
- Admission must specify its durable commit point and retry identity. Test
  disconnect before commit, after commit but before the reply, and after the
  reply. A caller retry must resolve the original obligation without a second
  grant, even after coordinator replacement.
- Final notification delivery needs an observable criterion: the bound parent
  owner accepted the exact retained report into an active receive or an owned
  pending-input continuation. Define the witness and its failure disposition.
  The parent's later model turn outcome is separate. If task A waits for the
  parent's full turn while the parent waits on A's custody release, synchronous
  completion can produce a dependency cycle.
- Capability retirement must atomically prevent new references before waiting
  for outstanding references to drain. Then cleanup releases resources and
  advances the storage generation. Waiting first permits new requests to keep
  adding references and can race the final free. Test an old request arriving
  at that retirement boundary without a wall-clock timeout oracle.

These details can be expressed through the existing owner handoffs and scoped
task/custody APIs. This review proposes no separate messaging or service system.

## Evidence and limits

The new fixture files are `bend2/test/shared-owner-lifetime-critic/recovery.bend`
and `run-recovery.py`. Run them with:

```sh
python3 bend2/test/shared-owner-lifetime-critic/run-recovery.py \
  --bend /absolute/path/to/bend \
  --output /absolute/path/to/evidence
```

The runner retains compiler version, source commit, source hashes, child argv,
complete stdout/stderr and actual exits. The reviewed output is in
`.scratch/lifetime-critic/review-0e872489/verified`. No production source was
edited, no live Orchestra process was replaced, and no candidate lifetime,
resource, mutation or deployment acceptance is claimed. All other schedules
above are design counterexamples derived from the reviewed sources.
