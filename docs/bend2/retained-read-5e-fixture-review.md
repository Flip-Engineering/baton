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
