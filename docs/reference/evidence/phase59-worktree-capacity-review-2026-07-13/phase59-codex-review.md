## Verdict

PASS. Commit `7780266` satisfies the reviewed Phase 59 authority requirements. The reservation is obtained before worker or verifier checkout effects; the default estimator reads the pinned commit, applies the same non-cone literal sparse identity used by worktree creation, adds runtime reserves, and composes the immutable toolchain projection’s attested bytes, files, directories, and unique strict target parents. Admission performs aggregate ceiling and free-floor checks under the ledger lock, with strict `>` / `<` boundaries that admit the exact maximum and refuse max-plus-one as `worktree_capacity_exceeded`.

The implementation also binds the reservation to base SHA, sparse digest, and projection digest, and releases exact nonce-bearing reservations on creation failure. The Phase 59 tests exercise byte and projection-parent inode max-plus-one refusal before checkout/runtime/provider effects, exact sparse/projection accounting, shared-parent unioning, dependency failure, concurrency, and lifecycle cleanup.

## P0-P1 findings

None confirmed in the committed Phase 59 scope.

The spec explicitly retains post-admission growth, unrelated host writes, hostile same-UID access, and hard filesystem enforcement as boundary/later-scope concerns. Those are not defects in this preflight concurrency-budget phase: WC5 accurately states that the estimate is not a quota and calls out isolated volumes, filesystem quotas, or stronger OS identity separation as follow-up authority.

## Required corrections

None.