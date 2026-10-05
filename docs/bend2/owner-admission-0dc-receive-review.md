# Admission successor and Receive handoff review

## Reviewed source

The executable review pins `0dc3c99051c4df9521546f14aacbd57a19174480` and
reads its module, native fixture and runner through `git show`. Their SHA-256
values match message `native-instance-lifetime-critic-refusal-source-20`.
The proposal review pins documentation successor
`8258e6a57f7011efcff4e0f8470cca3b59e1b02c`. The Receive and controls contracts
are retained in `native-instance-lifetime-critic-contracts56-22`; those logical
signatures remain proposed interfaces. Baseline Main, Delivery and Receive
inspection refers to `fca7af876c8260c32d17f95f3e19bc68ee1bf561`.

## Executed identity-law counterexamples

The pure successor returns the original conflicting attempt and the first
different field. Its baseline changed-request, changed-session and
changed-operation executions return the corresponding
`conflict:attempt-a:FIELD`. Exact replay returns `replay:attempt-a`; an absent
record returns `fresh`.

Each isolated mutation replaces one actual `String.eq` comparison in
`difference` with `True{}`. The imported author laws accept each mutation.

| Removed comparison | Compiler check / generation / native build | Changed-field execution |
| --- | --- | --- |
| Request | All exit 0 | Exit 0, `replay:attempt-a` |
| Session | All exit 0 | Exit 0, `replay:attempt-a` |
| Operation | All exit 0 | Exit 0, `replay:attempt-a` |

The new `conflict_preserves_attempt_and_field` law proves the `replay` helper's
handling of a supplied mismatch. It leaves detection of these mismatches
unprotected. Add actual `decide` laws for each changed field, preserving both
the original attempt and correct field, and selective comparison-removal
controls that fail those laws. This is a measured law-coverage gap. The
unmodified pure implementation passed the exercised cases.

The counterexample runner is
`bend2/test/shared-owner-lifetime-critic/review-admission.py --pin
0dc3c99051c4df9521546f14aacbd57a19174480`. Its original historical pin remains
the default. Run evidence is `.scratch/lifetime-critic/admission-0dc-independent`,
with outer stdout/stderr in `admission-0dc-review.*`. Every command, full output,
actual exit and isolated source is retained. The runner exited 0 after
reproducing all counterexamples. Bend 2.0.25 SHA-256 is
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`.

## Corrected successor verdict

Message `native-instance-lifetime-critic-identity-laws-25` supplied immutable
`7de194e02aa7ae0a4e7d19bf5845198182a97881`. Its source delta adds actual `decide`
laws for changed request, session and operation, with corresponding intended
comparison-removal controls. Independent committed-blob hashes match the
supplied module, fixture and runner hashes.

The same critic runner with `--pin 7de194e02aa7ae0a4e7d19bf5845198182a97881`
independently checked, generated and built the unmodified entry, then ran the
three field refusals, exact replay and absent-record cases. Those processes
exited 0. Each isolated comparison-removal mutation now exits 1 at its own
`changed_FIELD_refuses_request_reuse` law, with `Replay` and `Conflict`
constructors, original `attempt-a` and the corresponding Field in the complete
diagnostic. The runner exited 0. Evidence is retained separately in
`.scratch/lifetime-critic/admission-7de-independent` and
`admission-7de-review.stdout`/`.stderr`; the earlier failing evidence remains.

This closes the reported request/session/operation comparison-law gap at 7de.
The verdict covers these actual-function mutations and exercised baseline
cases. The author reports the remaining controls; this review did not rerun
that complete author suite. Main imports, atomic bound-store callers and the
shared runtime remain outside this component result.

## Receive admission and completion

The new handoff distinguishes `OwnedWake`, `Queued` and `Refused`, and keeps
the observed active attempt separate from eventual input disposition. This
resolves the earlier proposed use of generic attempt replay for a queued wake.
The pure `Record` still requires an attempt. A queued wake with unknown
consuming attempt therefore needs the command-specific wake responsibility
owned by the actual Receive caller. Neither an empty attempt nor the current
active attempt can fill that field correctly.

Baseline `Main.execute C.Receive` waits for `Receive.run` through `IO.try`.
`Delivery.launch` waits for that endpoint, and `Delivery.result` maps endpoint
exit 0 to `Done(saved)`. `Receive.finish_pending` joins original delivery,
settlement, ACK and continuation before returning. The proposed early
`OwnedWake` response changes the nonbusy endpoint's completion point. The
Receive handoff explicitly identifies this change. Composition must bind its
new accepted-responsibility phase to the retained eventual task result and
actual parent delivery before routing is enabled.

Two additional lifetime cases need concrete caller representation:

1. Owner O accepts wake W and replies `OwnedWake`. An inbox read then fails
   before an attempt is selected, or a stop recheck refuses native admission.
   The client has disconnected. There is no `AttemptCompletion` to retain this
   failure. The owner must retain W, its exact error, remaining notification
   responsibility and any acquired guard cleanup independently of the attempt
   list. `run_receive_task` returning outer `Fail` is sufficient only if its
   caller performs that retention and notification. Define that caller's
   result/cleanup ownership explicitly and fault it before and after guard
   acquisition. This is an interface requirement; no hosted implementation was
   exercised.
2. O accepts W, loses its response, then exits. Replacement O2 recovers W.
   The protocol must reject stale O capabilities while allowing reconciliation
   of W's stable database/request identity through O2. Define whether
   `WakeRef.owner` records original provenance or current execution authority,
   and how recovery relates them. The pure Request omits an owner-process
   token, which supports durable retry; the hosted capability check must
   preserve the distinction. Test a retry through O2 plus a stale callback
   from O against a reused local child slot.

These cases can use existing owner result/disposition types. They do not
require another receiver registry or admission authority. A proposed completion
envelope should retain the wake reference, the task Result and its notification
disposition even when the attempt list is empty. Its concrete type belongs to
the interfaces and Receive owners.

## Historical completion and host boundaries

The reviewed document now separates admission-slot generation, child-capability
generation, owner identity, outstanding references and failed invocation
results. It also identifies the released historical recovery gap. These text
corrections address the earlier draft conflicts. Runtime implementation and
qualification remain outstanding.

Preserve the exact release boundary: the observer guard and keeper-held session
lock are released separately; ACK follows exit and release. Completion recovery
must enumerate original attempts independently of the current execution slot
and must not acquire a newer attempt's admission guard. The historical fixture
only demonstrated `recovery_argv` filtering after `released`. It did not show
that `BR_ATTACH` refuses every released attempt.

Root50's attempt-description recovery seam, one replacement shared owner,
`read_ready` waiting/frame/EOF distinction and explicit environment preparation
are required caller/host work. Controls' proposed `begin` and `recover` are
unimplemented at its cited checkpoint. Identity-bound typed prepared
cancellation and same-binding transaction readback remain necessary before a
grant or cancellation decision. A missing observer, directory string, PID or
unavailable record cannot authorize replacement launch.

The database proposal correctly leaves actual effect binding with the bound
store owner. Device/inode text and a path check cannot establish identity for
subsequent `Sql.query` calls that reopen the path. Real connection binding,
owner exclusion, supported-path assumptions and SQLite/WAL/replacement probes
remain unqualified here.

The complete later `native-instance-lifetime-critic-atomic57-24` and
`native-instance-lifetime-critic-host-duty58-25` contracts were also read. The
first hosted command remains C.Receive. Accepted Direct replay retains its
original immutable decision and preparation authority; a known accepted replay
may resume the same idempotent grant after revalidation. Unknown commit needs
same-binding readback. These obligations belong to the one Direct admission
authority.

Receive59 explicitly enumerates coordinator notice and settlement duties even
after child ACK. Controls60 supplies proposed description/attachment,
versioned readiness registration with partial-line retention, one shared
replacement-owner responsibility and separate in-memory child/recovery
environment snapshots. Their source-scoped contracts address the earlier
missing host signatures. They remain unimplemented exports at the cited host
checkpoint. Host unacknowledged-child enumeration alone cannot replace
Receive59's enumeration of post-ACK notification obligations. The pre-attempt
wake failure and replacement identity cases above still require concrete
caller representation and executed probes.

## Review limits

This review changes only critic fixtures and documentation. It executes the
pure admission module's actual functions in isolated native builds and inspects
the stated baseline call paths. It does not execute shared owner admission,
database concurrency, task error containment, central-loss recovery, environment
isolation, actual parent wake or candidate resource reduction. Production source
ownership and the full combined acceptance gates remain with their assigned
owners.
