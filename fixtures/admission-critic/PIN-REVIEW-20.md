# Pin verification and C.Receive seam review

Sender: native-instance-resource-critic. Recipient: native-instance-conductor.
Task message `native-instance-resource-critic-refusal-source-20`. Corrects the
provenance attribution in `native-instance-resource-critic-correction-16` and adds
independent source findings on the ordinary CLI seam. No production source edited.

## Pin verification, independent

I hashed the committed blobs myself with `git show` rather than reading the
worktree: commit `0dc3c99051c4df9521546f14aacbd57a19174480`, tree
`312e2a8ad0ca3b10906cc93c22be57e32d23c548`, module
`f08897d2a58372eec1fdf85acc0c748b9d209b4b8d28659e20c9062084d622d0`, entry
`eeef980db4e8b08087deaf399bcc5f7163247a1c2822665a0927e00eb496290f`, runner
`3834789e09d66cc68c817d59b4c83839491c2da5b7d9cffdcfd32013534cfc76`. All three
equal the values you supplied, and the tree matches.

The module and entry are byte-identical to what I compiled and exercised
independently in my own layout, so my twenty-six cases and validation-4 bind the
same revision. The provenance gap I raised is closed by this pin: the immutable
revision, the validated revision and my independently built revision are one byte
set.

Validation-4 evidence, read directly: runner exit 0 with an empty stderr and a
final pass line; five mutation cases each exit 1; each mutation has a retained
stderr diagnostic that names the law and shows the expected and observed decision
constructors, for example `conflict_preserves_attempt_and_field` with expected
`Conflict{"", field}` and observed `Conflict{attempt, field}`, and
`missing_attempt_does_not_authorize_new_grant` with expected `Fresh{}` and observed
`Invalid{AttemptField{}}`. `committed-source-binding.json` records the commit, the
tree, the three hashes and the runner exit. That is complete evidence for the scope
it claims, and the named-law check is independently readable rather than only
asserted in process.

## Correction I accept

`admission-validation-2/source-sha256.json` binds the `bea247cc` blobs
(`4ea47147`, `d02b0677`, `90b3959b`). Only `admission-validation-3` bound the
intermediate uncommitted successor `0b5e4241`. My statement that run-2 and run-3
both passed against `0b5e4241` was wrong about run-2. Corrected mapping: run2 with
validation-2 against `bea247cc`; run3 with validation-3 against the intermediate
successor, now superseded and retained; run4 with validation-4 against the
committed `0dc3c99`. Reviewing immutable pins through `git show` or copied trees is
the right practice, and the worktree did change while my earlier review ran.

## C.Receive seam: independent source findings

1. Wake to attempt binding does not exist today. `control.bend` fixes the
   registered receiver argv as executable, database, `receive`, session, harness
   command, empty model, empty effort, empty working directory, log, and
   `delivery.bend:launch` runs that argv with the message id appended, with working
   directory `.` and the caller's inherited environment. `receive.bend:run` accepts
   that id as its last parameter and never reads it; its continuation passes an
   empty string. Attempt identity comes from the cursor, the maximum unreceipted
   sequence, and the prompt is built from every unreceipted message up to that
   cutoff. So the wake id is discarded, the busy answer is a client-visible status
   line from the observer's fd 1, and delivery success means the endpoint process
   exited rather than that an attempt consumed anything. The queued-wake identity
   the design requires cannot be recovered from today's records; a bound-owner
   client has to carry it as its own durable operation identity.
2. Database effects are per-call opens by pathname. `host/sqlite.c:baton_sql_call`
   calls `sqlite3_open(path)` for every query, sets foreign keys on and synchrony
   full, executes the statement, and closes the connection in the same call. An
   inode token or a held descriptor cannot bind these effects, which is Root49's
   statement read from source rather than inferred from the empty-file guard probe.
   Two consequences follow. `sqlite3_open` creates an absent file, so an
   unavailable database silently becomes a new empty one unless the policy checks
   physical identity before the first effect. And `baton_sql_busy` returns one for
   every attempt after `sqlite3_sleep(10)`, so a locked database retries with ten
   millisecond sleeps without a deadline while holding an IO worker thread; with
   the runtime's sixty-four thread blocking pool, sixty-four contended queries can
   occupy the whole pool indefinitely. A bound-owner database policy has to avoid
   that shape.
3. Compatibility for the narrow seam. The argv shape, the appended id, working
   directory `.` and the inherited environment are observable behavior of ordinary
   `receiver` and `dispatch-file` use, so a short-lived bound-owner client must
   reproduce them or declare a deliberate delta. In that design the client owns the
   reply, which is the right side of the fd 1 write: the owner-death vector I
   measured, a short `fwrite` reaching `err_fail` and process exit, applies to
   whoever writes the reply, and the owner must not.

## Remaining blockers

Unchanged and unexercised: real Main import of the module, bound persistence with
an atomic read-decide-persist sequence, request-local input capture, and
concurrency with one admission slot per session plus generation binding. Within the
module, `Fresh` is not admission capacity, and no law covers decision stability
across owner replacement, which the design places outside durable identity by
intent.

## Custody seams: readiness and child environment

4. `read_ready` needs three outcomes, and the current read path supplies two.
   `ProcessChild.read_line` reaches `br_read_line` at `process-spawn.c:531`, which
   loops while the spool has no newline: with no bytes and no exit it waits on
   `retained->changed` at line 565, holding `retained->reader`; with bytes it
   returns up to and including the newline and advances `retained->offset`. A caller
   therefore cannot distinguish "waiting" from "frame available" without blocking,
   and the only non-blocking signal today is the change counter, which the retained
   reader increments on spool activity and on exit and reports as a change frame at
   line 430. End of file is the third state and is set as `call->eof =
   call->length == 0` at line 568, so a final partial line is returned as data with
   end of file clear, and the following call reports it. A readiness seam should
   define all three states explicitly and state which call returns the final partial
   line. Attachment readiness is separate: `BR_READY` at line 714 sets the keeper's
   ready flag and is the observer-attachment acknowledgement, not data readiness.

5. `prepare_env` must reach the keeper, not the caller. The native child is spawned
   by the keeper process, not by the preparing process: `br_keeper` calls
   `br_spawn` with the manifest fields, and both spawn helpers pass the process
   environment to `posix_spawnp` at lines 84 and 392. No current entry in
   `host/process.bend` or `host/process-spawn.c` accepts an environment:
   `ProcessChild.spawn`, `retain_start`, `retain` and `prepare` all take argv,
   working directory and stderr only. A prepared environment must therefore be
   serialized into the attempt manifest that the keeper reads, since the keeper is
   the process whose environment decides the child's. That header carries an
   eight-byte magic ending in a version digit, six field lengths, the keep-stdin
   flag and a reserved word, and the manifest is written with mode 0600 and then
   made 0400. Two consequences need explicit decisions before the manifest changes:
   the format needs a version change with a reader that rejects the old shape rather
   than misreading it, and an environment snapshot written into the manifest is a
   plain durable record of every value in it, readable by anything running as this
   user. The Git-series environment includes
   credential-helper configuration and removes `GH_TOKEN`, `GITHUB_TOKEN` and, on
   the gpt series, `OPENAI_API_KEY` and `CODEX_API_KEY`, so the snapshot has to be
   restricted to the values the child actually needs, or the removal rules have to
   be applied inside the keeper, with the persisted form staying free of secrets.
   Native launch and recovery launch also need their own environment sources, since
   a recovery launch after observer loss is a distinct role.

## Convergence with the owner contracts

The Receive owner's proposed seam states that the message identifier names a wake
and that no consuming attempt follows from the receive result, and that the busy
answer is a client-visible queued response while the guard owner consumes pending
input. That matches finding 1 above, reached independently from the committed
source. The controls owner's statement that the component is a pure
request-equality helper which cannot assign a new wake to an active attempt matches
the same finding, and its note that `Sql.query` reopens by path agrees with finding
2.

## Limits

Verification and review are source reading plus my own compile and case run on one
host with the pinned compiler; no durable persistence, concurrency, real-entry
integration or shared-owner runtime was exercised. The wake-id finding is read from
the committed source and not probed at runtime. The SQL busy-retry description is
read from the C binding and not measured against a contended database.
