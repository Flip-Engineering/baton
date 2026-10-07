# Bounded correction and admission verdict

Sender: native-instance-resource-critic. Recipient: native-instance-conductor.
Corrects `native-instance-resource-critic-report-14` without altering it. Task
message `native-instance-resource-critic-admission-review-16`.

## Corrections I accept

1. `process-spawn.c:1096` is `br_recovery` only. I withdraw the claim that it
   establishes a broad released-directory attach refusal. The attach path is
   `br_control_command`: a finishing keeper answers `ESHUTDOWN` at line 822, an
   already-attached client answers `EBUSY` at line 827, and the accepted attach
   returns the retained `released` flag in its state frame at line 832, which is
   reached through `BR_ATTACH` at line 825 and dispatched from line 1121. The
   `acknowledged`, `released` and `native-start-error` markers refuse the
   recovery-manifest path at 1096 and do not gate attach.
2. The fixed per-agent footprint claim holds for an active fixture attempt, not
   for every attached session. Correct statement: while a fixture attempt is
   pending, the observer measures about 4.5 MB and its keeper about 2.3 MB of
   private footprint, flat from one to four concurrent sessions and unchanged by
   4 MB of inert output; an attached session with no pending input has no
   resident Baton process at all, which matches the sibling measurement.
3. The admission runner mutates operative implementation expressions and requires
   the compile to report the named law deviation. That is an implementation
   mutation control. Proof removal is the separate mechanism in
   `laws-check.mjs`, and I should not have used that phrase for the runner.
4. I withdraw the normalization angle on payload encoding. With canonical command
   bytes as the module premise, a trailing newline is a real difference and
   literal comparison is correct. My independent case confirms the module answers
   `Conflict{attempt-a, payload}` for it. The duty sits on the parser that supplies
   canonical bytes, not on this comparison.
5. I withdraw the durable-payload-copy wording as a defect. `Request` and `Record`
   are in-memory pure values and no durable request row exists yet. The forward
   requirement stands for the persistence handoff: because `Request` carries the
   payload by value, any durable record of the request reproduces the payload
   unless a digest is introduced, and that choice needs the canonical codec plus
   preservation of immutable captured input.
6. I accept that owner qualification, session occupancy and atomic persistence
   belong to the caller and the task protocol, and that a Boolean here would not
   prove authority. They remain integration requirements rather than module
   defects.

## Independent execution

I copied the two source files into my own layout, built them with the pinned
compiler, and ran my own case set. Reviewed bytes: module sha256
`f08897d2a58372eec1fdf85acc0c748b9d209b4b8d28659e20c9062084d622d0`, entry
`eeef980db4e8b08087deaf399bcc5f7163247a1c2822665a0927e00eb496290f`, compiler
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`. Check exit 0,
native build exit 0. Twenty-six cases ran with twenty-five matching; the one
mismatch is my harness artifact, since the entry fixes the stored identity to
payload `input`, so a stored and expected payload equality for any other payload
is not expressible through this entry and my 200 KB identical case returned
conflict. That expressive limit applies equally to the runner's own cases.

Results worth keeping: replay returns the original attempt; each changed field
returns `Conflict{attempt-a, field}` naming that field; each empty required field
returns `Invalid{field}`; a stored record with an empty attempt returns
`Invalid{attempt}` even when other fields differ; a missing required field beats a
conflict; the difference order is database, request, session, operation, payload;
an absent record with an empty payload returns `Fresh`; flag-like and non-ASCII
values are compared literally.

Bounded resource result from the same run: the current ordinary path carries the
request in argv, so payload size is bounded by the operating system. A 200 KB
payload raised a case from about 0.03 s to 0.41 s, and a 1.2 MB payload was refused
with errno 7, argument list too long. This bears on the request-local captured
input requirement, and on the 20 MB single-frame payloads the runtime can produce
internally.

## Provenance blocker

Three different byte sets exist for the same three files. Commit `bea247cc` holds
module `4ea47147…`, entry `d02b0677…`, runner `90b3959b…`. The recorded validation
identity in `.scratch/native-instance/admission-validation-3/source-sha256.json`
holds module `0b5e4241…`, entry `eeef980d…`, runner `bbdf5522…`. The working tree I
built holds module `f08897d2…` with eight laws, entry `eeef980d…`, and a further
runner change, uncommitted against `bea247cc` by 69 insertions and 34 deletions.
The recorded release-2 and release-3 runs passed against `0b5e4241`, which is no
longer present in the worktree. Both `admission-run-2.stdout` and
`admission-run-3.stdout` are complete, each ending in the pass line with all four
mutation rejections. The pin named in the task therefore does not identify the
validated revision, and the validated revision does not identify the current one.
Commit the exact validated bytes and cite that commit.

## Disposition

The pure decision module is correct for its stated premise, canonical command bytes
with a qualified database binding supplied by the caller. Its eight laws pin the
decision table including the attempt and field carried by a refusal, and my
independent build and cases agree with them. Within the module the open items are
that `Fresh` is not admission capacity, and that no law covers decision stability
across owner replacement, which the design places outside durable identity by
intent.

Blocking integration work, in order of confidence: real-main wiring, since the
module is not reachable from `main.bend` and the ordinary entry still funnels
through `IO.try` and `IO.die`; bound persistence, which needs the atomic
read-decide-persist sequence and a durable request row; request context, which
needs request-local working directory, stdin and file capture with lossless argv
under the measured argument-size bound; and concurrency, which needs one admission
slot per session with generation binding and stale-owner rejection. No concurrency
or persistence evidence exists for any of these, and I ran none.

## Limits

Verification is one host, one compiler and one build of uncommitted bytes. No
durable persistence, concurrency or real-entry integration was exercised. The
twenty-six cases cover the decision function only, and the entry's fixed stored
identity limits stored-versus-expected comparisons to the payload `input`. The
200 KB timing includes argument delivery and is not a comparison-cost measurement
in isolation.
