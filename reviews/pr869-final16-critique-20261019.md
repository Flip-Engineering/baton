# PR869 final16 independent critique

## Verdict

Approve with conditions.

## Identity checks

- Qualified source 788b806db8aefbe8453511bf19c615a1efa48bc1 is reachable as HEAD of
  incoming-g5-pr835/g5-entry.bundle (git bundle list-heads, verified in this
  worktree). Its parent chain includes 33ac4ec8 from pr835-33ac.bundle.
- Binary SHA-256 recomputed:
  ad9ee93a3977d9df30f0c22318ae054c7f8a419a694bba77980224a49ac36c8c, matching the
  named pin for worktrees/runtime-memory-g5-pr835-io-try-20261018/.scratch/
  receiver-g5-pr835/split-build/receive-focused-g5-pr835. The acceptance test
  also asserts this hash before the fresh reopen.
- PR head d461a5611b2b2819e1e7803c8b92ff0da5f9c9c9 is not reachable from this
  worktree, from /tmp/pr869-src fetched with both incoming-g5-pr835 bundles,
  or from the retained worktrees (their gitdirs under
  runtime-main70620-base/.git/worktrees are absent). Reconciliation of
  d461a561 against 788b806 could not be performed. This is condition 1.
- Checkpoint predicate PR894 is merged on main at 259fdca per root direction.
  788b806 still contains output_changed in checkpoint_due_fields
  (observer-checkpoint.bend:119 in that tree). PR869 is therefore not the
  checkpoint-rate predicate fix and must not be credited as one. Root states
  PR894 is already merged; PR890 is not treated as unmerged product work.

## Evidence run

/tmp/pr869-legacy-final16.log, read directly: both
test_legacy_checkpoint_reopens_for_large_success_terminal and
test_legacy_checkpoint_reopens_for_large_failure_terminal pass,
"Ran 2 tests in 53.091s, OK". No Cgen and no full build were run in this
critique; frozen artifacts were read only.

## Test body review (runtime-memory-acceptance-20261018/bend2/test/receive-memory-acceptance.py:540-662)

The legacy reopen test builds a spanned checkpoint, rewrites only the held
value into legacy embedded-text form, and asserts the header prefix, header
suffix, spool cursor bytes [56:64] and every state field outside held are
unchanged. It then kills the legacy receiver, restores the legacy checkpoint,
and reopens with the spanned binary.

Verified assertions in the body:

- Large terminal (about 1 MiB plus a unique marker) reaches the spanned
  reopen output exactly once, for both success and failure terminals.
- Legacy held text is flushed exactly once (held-once publication); no US
  (0x1f) span token survives in the public log or in the recovered
  checkpoint held value, and the legacy held snapshot is consumed.
- Success: fresh return code 0, delivery receipt present, checkpoint spool
  cursor advances past its pre-reopen value.
- Failure: fresh return code non-zero, delivery receipt is None, checkpoint
  spool cursor equals the full raw spool size, and the task remains in the
  session inbox. No synthetic success or ACK is produced.
- No span token, malformed JSON, or checkpoint field decode failure text
  appears in the reopen output.

## Fixture exclusion

bend2/test/observer-checkpoint-state-memory.bend exists on disk in the
acceptance worktree but is not in the 788b806 tree (3,711 files listed,
no match). Exclusion confirmed. That fixture exercises
Observer.make_full and checkpoint_due_fields cases including output_on; it
belongs to the checkpoint predicate work (PR894 lineage), not to PR869
final16, and its presence in the acceptance worktree does not qualify or
disqualify the PR869 binary.

## Conditions

1. Reconcile PR head d461a561 against qualified source 788b806 before merge.
   If they differ in any file that reaches the receiver binary, rerun the
   final16 legacy pair against a binary rebuilt from the reconciled head
   and record its hash. The current approval covers 788b806 and binary
   ad9ee93a only.
2. Land PR869 on a main that already contains the PR894 checkpoint
   predicate (259fdca per root), or rebase and re-verify that the predicate
   survives. Do not describe PR869 as fixing checkpoint rate.

## Limits

The prior GLM critique chain (branch runtime-glm-critic, 389fb61c..0462bec9)
could not be read: the runtime-glm worktree gitdir is absent, so that chain
was neither used nor rewritten. The monitor approval report
(report:0aed30102764a64348c0685551b597b0) was taken as named root evidence;
the baton CLI is not on PATH in this worktree, so it was not re-read here.
