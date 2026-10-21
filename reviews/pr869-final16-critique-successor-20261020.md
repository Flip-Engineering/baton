# PR869 final16 successor critique (2026-10-20)

Critic: runtime-glm-successor-20261019, authorized by root decision
operator-runtime-root-recovery-decision-20261019 as replacement for the
start-failed runtime-glm attempt (receive:runtime-glm:3902:371f89aba20487310390185b5adf669a).
The prior chain is preserved and untouched: branch runtime-glm-critic
(389fb61c..0462bec9), reviews/runtime-recovery-769-critique-2026-10-17.md, and
the runtime-output-checkpoint-fix critique 4ad2924df with its scope-correcting
amendment. This record continues that chain on a new branch.

## Verdict

Approve with conditions.

Scope of this approval: the PR835 legacy-reopen coverage run "final16" --
frozen source 788b806db8aefbe8453511bf19c615a1efa48bc1, build source
3fe6380de75432442b179987324fab2f7084fadc (parent 788b806d), frozen binary
ad9ee93a3977d9df30f0c22318ae054c7f8a419a694bba77980224a49ac36c8c. It is not an
approval of the PR869 Codex-span product (head d461a561), per the amendment
recorded in reviews/pr869-final16-critique-amendment-20261019.md, which this
critique verifies and preserves.

## Identity verification (recomputed, not trusted)

- Binary SHA-256 recomputed over
  worktrees/runtime-memory-g5-pr835-io-try-20261018/.scratch/receiver-g5-pr835/
  split-build/receive-focused-g5-pr835:
  ad9ee93a3977d9df30f0c22318ae054c7f8a419a694bba77980224a49ac36c8c. Matches the
  pin.
- g5-entry.bundle HEAD = 788b806d. io-try.bundle HEAD = 3fe6380d.
  pr835-33ac.bundle carries refs/heads/codex/pr835-source-pin-33ac = 33ac4ec8.
  All under retained/incoming-g5-pr835/.
- g5-acceptance-receipt.json (retained beside the binary) records
  source.head = 3fe6380d, source.parent = 788b806d,
  build.binary_sha256 = ad9ee93a..., and pins the test file it ran
  (bend2/test/receive-memory-acceptance.py, sha256 bae27f6b...) in the io-try
  worktree. The on-disk io-try copy hashes exactly to that pin.
- receipt.json (split build record): source_commit 3fe6380d, clang-19, 4-way
  split, link PASS, status PASS; semantic equivalence explicitly unclaimed.

## Test body verification

Reviewed file: worktrees/runtime-memory-acceptance-20261018/bend2/test/
receive-memory-acceptance.py (680 lines; legacy helper 526-654, wrappers
656-662, suite registration 668-671). This on-disk copy is the file that
carries the final16 pair; the receipt-pinned io-try copy does not contain it,
and neither does the frozen 788b806d tree (350-line version) or bundle head
214446d (350-line version).

Every property named in the task is asserted at byte or field level:

- Legacy checkpoint conversion preserves the spool cursor bytes [56:64] (565),
  header prefix [:56] (566), header suffix [80:104] (567), all state fields
  outside held (568-570), output and terminal fields (578-579), and byte
  identity outside the held value span (580-585). The held entry becomes the
  legacy embedded-text form (571-577).
- The test pins and verifies the binary hash in-test (611-612) before the
  fresh reopen.
- Spanned large terminal (~1 MiB plus unique marker, success and failure
  variants at 656-662) reaches the reopen spool (624-625) and is consumed
  exactly once (628-629).
- Held-once publication: the 1 MiB legacy held text is flushed exactly once
  (630-631); no 0x1f span token survives in the public log (632) or in the
  recovered checkpoint held value (636-637); the legacy held snapshot is
  consumed (638-639).
- Receipt and cursor outcomes: success requires rc 0 (649), a delivery receipt
  (650), and cursor advance beyond the pre-reopen legacy cursor (651-653).
  Failure requires rc nonzero (643), receipt None (644), cursor equal to the
  full raw spool size (645-646), and the session inbox still owed exactly the
  task (647). No synthetic success or ACK exists on the failure path.
- Reopen output must contain no span-token, malformed-JSON, or checkpoint
  field decode failure text (621-623).

The retained monitor approval report:0aed30102764a64348c0685551b597b0
(runtime-monitor-checkpoint-ds-20261018 to runtime-wonder, retained in the
orchestra database, handling receipt
native-turn:receive:runtime-wonder:4661:f6af400ba983603e4bd410bf104dd2f1,
native 01a14772-dfd2-7381-aefb-c9cc72ee1f6a) describes exactly these
assertions and outcomes, records the terminal receipt
/tmp/pr869-legacy-final16.log ("Ran 2 tests in 53.091s OK"), and carries the
cleanup note that the untracked fixture must not be published. The prior
critic recorded a direct read of the same log with the same result. The
attempt-level acknowledged-marker assertion is absent per ruling 9f93e542;
the held-entry tab-prefix failure was classified as test construction and
fixed by 4c3a77fa3.

## Fixture exclusion (verified)

bend2/test/observer-checkpoint-state-memory.bend is absent from the 788b806d
tree (ls-tree empty) and present on disk in the acceptance worktree (5182
bytes). The frozen tree still contains the ungated output_changed term in
checkpoint_due_fields at bend2/src/coordinator/observer-checkpoint.bend:119,
so the fixture (which exercises Observer.make_full and checkpoint_due_fields
with output_on) belongs to the PR894 predicate lineage and is correctly
excluded from final16 publication.

## Product scope (verified)

d461a5611b2b2819e1e7803c8b92ff0da5f9c9c9 ("Bound legacy failure fixture
lifetime", 2026-10-18) exists in the account repo and is not an ancestor of
788b806d (merge-base check). The amendment's divergence claim and its scope
correction stand: final16/ad9ee93a qualifies the PR835 legacy-reopen coverage,
not the PR869 Codex-span product.

## Evidence decay found on 2026-10-20

These findings do not change the recorded pass; they bound what can be
re-derived today.

1. The terminal receipt /tmp/pr869-legacy-final16.log no longer exists. It is
   absent from /tmp and from the entire retained tree. The recorded pass rests
   on the monitor report and the prior critic's direct read, both retained.
2. The acceptance lineage 1d5d0985b..344a808a0 (monitor: "worktree HEAD
   344a808a0") is not re-derivable: neither commit resolves in the account
   repo, neither is contained in either retained acceptance bundle (both have
   head 214446d, prerequisite 70620ed18 satisfied), and the acceptance
   worktree's gitfile points at the nonexistent
   /run/baton2-native-homelab/.../runtime-main70620-base/.git. The ruling and
   fix refs 9f93e542 and 4c3a77fa3 are not objects in the account repo either.
3. The final16 pair cannot be rerun today without a build: the acceptance
   harness skips when its fixture coordinator
   acceptance/.scratch/bend2/baton2 is missing, and it is missing. Rebuilding
   it is outside this critique's read-only scope.
4. The legacy pair survives in zero commits. A pickaxe across all account-repo
   refs for test_legacy_checkpoint_reopens_for_large_success_terminal returns
   nothing; the only copy is the uncommitted 680-line worktree file. The
   frozen tree and bundle head 214446d carry 350-line versions without it.
5. The test's SPANNED_BINARY default path uses the dead /run prefix; any
   rerun must set BATON_SPANNED_BINARY to the retained /mnt path.

## Conditions

1. Commit the legacy reopen pair to a retrievable ref before further reliance,
   and fix its hardcoded /run default path. The coverage currently survives
   only as one uncommitted file in a worktree whose gitdir is dead.
2. Preserve a durable terminal receipt under the retained tree. If the pair is
   rerun, record the fresh log, the fixture coordinator hash, and the binary
   hash together.
3. Before any future re-verification, rebuild or re-pin the acceptance lineage
   (1d5d0985b..344a808a0, HEAD 344a808a0, rulings 9f93e542/187739f7, fix
   4c3a77fa3) into a retrievable repo or bundle. Until then these remain
   monitor-attested, not independently re-checkable.
4. Keep the scope boundary: this approval does not qualify the PR869
   Codex-span product. Per the amendment, that still requires a main-based
   build containing CodexSpanState / codex_span_observe_fields, an actual
   8 MiB span run with terminal reopen, receipt/cursor and held-once
   coverage, and a fresh independent critique.
5. Keep observer-checkpoint-state-memory.bend out of publication. Land PR869
   on a main that already carries the PR894 predicate, or rebase and re-verify
   the predicate survives; do not credit PR869 with the checkpoint-rate fix.

## Limits

Read-only on frozen artifacts. No Cgen, no build, no rerun; the monitor report
was re-read in full from the database and taken as recorded attestation where
artifacts have decayed. The prior GLM chain was read for lineage only and not
rewritten. All paths in this record are relative to
retained/baton-account-credits-793-702-20261017T0106Z.
