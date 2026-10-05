# Retained-read fixture source review

Reviewed immutable `5e7223929d748a56116cba71ea4eab3a8ec6b5b7`, its complete
retained-read fixture/runner/README and the scoped module delta. All four
supplied SHA-256 values match the committed blobs. No compiler, syntax check,
fixture or test gate ran. The remote execution request remains root-owned.

## Fixture type blocker

The new CLI passes `U32.read(high)` and the other parsed words directly into
`ByteOffset` fields, which require U32. `U32.read` returns `Maybe<&2,U32>`.
The baseline `git/text.bend:run_res_parsed`, `test/process.bend:signal_value`
and `keeper_value`, and `coordinator/main.bend:keeper` show the explicit Maybe
handling used by existing callers.

The fixture must unwrap each Some and refuse None before constructing the
two offsets. Preserve the four-word arity check and add remote invalid-input
cases for the parsing adapter. This is a source/type mismatch; no compiler
diagnostic is claimed. An unrelated baseline type error cannot establish an
intended arithmetic-law refusal.

## Interrupted child lifetime

`run` launches Popen, writes its launch receipt, then calls `child.wait`.
It has no exception path that retains or settles the launched child. The
mutation caller wraps this in `TemporaryDirectory`.

Source-derived schedule: a mutation compiler starts; the Python waiter receives
KeyboardInterrupt, or a launch-record/write/wait operation raises; stack
unwinding enters TemporaryDirectory cleanup while the child may still be
running. That can remove the active compiler's cwd and source. Direct file
stdout/stderr retention does not supply a completion observation or transfer
ownership to a replacement waiter.

Retain isolated mutation directories until actual child completion and define
how the existing remote job supervises a child after waiter loss. Preserve a
missing completion as unfinished, with enough launch identity for the existing
execution owner to reconcile it. A new output directory prevents evidence
overwrite; it does not deduplicate an existing execution. Root request custody
must still prevent a second launch of the same admitted work.

This is an unexecuted exception/lifetime schedule. No active remote child was
interrupted or inspected by this review. The correction belongs to the runner
author and existing remote execution owner.

## Control and evidence assessment

The three source replacements target low carry, high overflow and carry
overflow exactly as proposed in the earlier review. Splitting at the law
suffix preserves those equations. Each check requires exit 1, its named law
and the expected/observed Result constructors. Diagnostic spelling remains
pending the admitted platform compiler.

Python arbitrary-precision integers provide an independent runtime oracle for
ordinary sums and both overflow forms. This is appropriate once the fixture
parses its words correctly. The new `offset_nonzero_words_add` law belongs to
5e; it is absent from the earlier e1d source.

The runner retains complete raw streams, launch and completion records, source
and toolchain hashes, platform identity and a stability comparison. It correctly
leaves actual archive/library-to-compiler binding to root qualification. A
failed or interrupted run still needs its outer status and raw logs retained;
absence of identity-after or child completion is incomplete evidence.

The arithmetic implementation is unchanged. Raw octet transport, cursor
attempt/stream checks, signed host offset conversion, readiness synchronization
and post-ACK parent notice remain outside this fixture. Existing e1d/7de
findings and the historical3a probe keep their own evidence scope.

## Review of the 9930 correction

Reviewed committed `9930a52f6bb33f05e40964aba630426070066c64`, tree
`ba2c8d8cdf8251a6bf778363c3b78ae435a676cd`, including its changes from
`5d9ff939` and the preceding parsing and runner changes from `5e722392`.
The four supplied module, entry and runner hashes match the committed blobs.
This review used source inspection and retained evidence. No compilation,
syntax check, build, fixture or test ran locally or remotely in this review.

Root's retained Linux evidence is under
`.scratch/root-homelab-ci-20261005/instance-5e722392-evidence` in the root
checkout. The before/after source records identify 5e722392 and its tree,
and the final source-status record is empty. The two component check records
and their outer exit records report exit 1. Receive failed at the computed
scrutinee `match R.wake(message)`; retained-read failed at nested `match carry`.
Both raw diagnostics request a separate definition. Their later generation,
runtime and mutation stages did not run. The owner-admission outer record
reports exit 0; this review does not independently audit all its raw controls.

The 9930 receive entry passes the computed wake to `show_wake`, which matches
its parameter. Retained-read introduces `offset_limit`, `offset_carry` and
`offset_right`, and the fixture introduces `parsed_low` and `parsed_right`.
These helpers remove the reported scrutinees and the adjacent nested matches.
The source preserves high-word overflow refusal before carry adjustment.
The duplicated high/low arithmetic operands have explicit duplication binders.
The Result error/value ordering and Maybe payloads are consistent across the
reviewed helper signatures. Compiler acceptance remains due.

The complete arithmetic law suffix is byte-identical to 5e722392. Each of the
three comparison strings targeted by the mutation runner occurs once in the
implementation before that suffix. Public `offset_sum` and all three controls
retain their intended arithmetic behavior and source targets.

The preceding 5d parsing correction unwraps every `U32.read` result before
constructing a ByteOffset. None follows the explicit invalid-word path.
The runner supplies an invalid token in each of the four positions. This
addresses the earlier source type mismatch; execution of those cases remains
due because the original remote baseline stopped earlier.

The retained-read runner now preserves each mutation directory and records an
unobserved child when launch-record writing or waiting raises. That removes
the earlier exception-driven TemporaryDirectory deletion path. The existing
remote job still owns child reconciliation. An abrupt process loss can leave
no interruption receipt, and a PID alone does not establish an ended child.
This source correction does not prove supervision, deduplication or recovery
after job loss.

One further source risk remains in the unchanged receive-request runner.
Its `mismatch-loses-stderr` mutation inserts `match frame` inside the False
branch of `select`'s `match matches`. This has the nested scrutinee shape that
9930 removes from retained-read after the actual parser refusal. Its intended
law diagnostic has not run in the Linux evidence. Move that mutation's frame
destructuring into a parameterized helper before treating the control as
ready, or retain an actual admitted compiler result establishing that this
particular form is accepted. This is a source-derived risk, not an executed
mutation failure. The runner's named-law assertion would reject an unrelated
parser error, so this risk causes an unfinished gate rather than a false pass.

Disposition: the 5d/9930 source corrections address the identified parsing,
typing and temporary-directory lifetime problems within their stated scope.
The receive mutation risk and actual remote compiler/runtime/control outcomes
remain open. No host lifetime, byte transport, readiness or shared-owner
acceptance follows from this review.

## Receive mutation declaration-order correction

The subsequent fe07 source readback was retained in message
`native-instance-lifetime-fe07-readback-16`. It confirmed the helper extraction
but missed the requirement to declare that helper before its caller.
Root's actual fe07 Linux run exposed that omission. Its retained
`evidence/receive-request/mutation-mismatch-loses-stderr.stderr` reports
`expected : a defined name`, `observed : mismatch_stdout`, at
`receive-request.select`. The associated command record reports compiler
exit 1. The runner's named-law assertion rejected this structural error.
The wake mutation was not reached.

Reviewed the complete immutable fe07-to-171 delta at
`171bb8d7352bb77e9bcd72c9e97c0755c7d44e58`. Only the receive-request runner
changes. Its SHA-256 is
`d9198ce2878f46d22dd5e8c1c857f5ef5d28935ea12180f36a14535cff282a5a`.
The module and fixture hashes match the unchanged values in the handoff.
The mutation now replaces the full original select definition, which occurs
exactly once in the committed module.

The replacement inserts `mismatch_stdout` before `select`. OutputFrame,
OutputRoute, Stdout and Mismatched are declared earlier; route remains after
select. The helper matches its own parameter, retains correlation/cursor/bytes,
and substitutes Stdout. Each retained field is consumed once. The True branch
still returns the original Matched frame. The intended mismatch law and both
Mismatched diagnostic checks are unchanged. No further source blocker was
identified in this bounded delta.

This corrects the earlier source disposition using actual retained remote
evidence. It does not establish that 171 compiles or that its two remaining
controls produce their intended diagnostics. No compiler, syntax check, build
or test was run during this readback. Root retains remote execution ownership;
the original fe07 source, review and failed result remain historical evidence.
