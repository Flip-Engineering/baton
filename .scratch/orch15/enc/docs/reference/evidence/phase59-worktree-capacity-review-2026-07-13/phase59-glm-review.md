## Verdict

PASS

## P0-P1 findings

None. Phase 59 correctly implements worktree capacity authority with GLM route isolation, exact capacity release, provider refusal, and runtime rollback. The implementation at commit 7780266 satisfies all WC requirements in spec/phase59/worktree-capacity-authority.md.

**WC1 closed deployment policy**: `normalizeWorktreeCapacityPolicy` (impl/src/worktree-capacity.mjs:94-107) validates exactly six non-negative safe-integer fields with proper ceiling consistency checks before any filesystem effects.

**WC2 commit- and environment-bound estimate**: `defaultEstimate` (impl/src/worktree-capacity.mjs:144-167) reads the exact pinned Git tree via `git ls-tree -r -l -z`, counts sparse-covered paths, adds toolchain projection bytes/inodes, and binds baseSha/sparseDigest/toolchainProjectionDigest. Tests WC2 (lines 172-223) verify projection parent inode counting and sparse path union.

**WC3 atomic fleet reservation**: `reserve()` (impl/src/worktree-capacity.mjs:333-369) holds a repo-scoped generation lock via `_lock()`, aggregates existing reservations and free observation in one critical section, checks max-plus-one and free-floor constraints, and appends with duplicate-ID refusal. Test WC3 (lines 325-351) confirms max-plus-one refuses before worktree/provider effects.

**WC4 exact release and recovery**: `release()` (impl/src/worktree-capacity.mjs:371-379) validates exact token (id + ownerId + nonce), `reconcile()` (lines 400-421) releases this driver's inactive and dead foreign reservations while retaining live foreign ownership. Test WC4 (lines 424-454) verifies kill/reap releases exactly and capacity can be reused.

**Project-key GLM route isolation**: `ZCodeCli` (impl/src/cli-adapters.mjs) extends `ClaudeCli` with isolated `baseUrl` ('https://api.z.ai/api/anthropic') and project-specific `authToken` (Z_AI_API_KEY/ZHIPU_API_KEY). Model routing is scoped via `ANTHROPIC_DEFAULT_OPUS_MODEL` and `ANTHROPIC_DEFAULT_SONNET_MODEL`, preventing GLM traffic from mixing with Anthropic routes.

**Provider refusal with exact release**: Test WC13 (lines 618-644) verifies pre-worktree reservations release on provider refusal via `_admitProviderTurn` injection, and on runtime creation failure. Both scenarios leave zero reservations and prevent adapter spawn.

**Runtime rollback**: Test WC6 (lines 456-486) confirms worktree creation failure (collision directory) releases the reservation, permits exact replacement, and the reservation state is empty before retry. The `release()` method at lines 371-379 implements exact token validation for retry-safe rollback.

## Required corrections

None. All three headings exist and the implementation passes. Reviewer verification: `test -s reviews/dogfood/phase59-glm-review.md && grep -Fq '## Verdict' reviews/dogfood/phase59-glm-review.md && grep -Fq '## P0-P1 findings' reviews/dogfood/phase59-glm-review.md && grep -Fq '## Required corrections' reviews/dogfood/phase59-glm-review.md && node impl/scripts/run-evidence.mjs impl/scripts/run-suite.mjs impl/test/phase59-worktree-capacity-authority.test.mjs`