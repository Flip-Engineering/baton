# ROW — #216: the per-member sync git digest goes batched

Measured context (binds): 502 refs under refs/baton/results/; each
`resolveResult` = sync execFileSync git ≈40ms (index.mjs localGit), invoked per
completed member per view build (`_buildView` → inspectPreservedResult →
worktrees.resolveResult). ~90 members × ~3 git calls ≈ 11-13s per waves_list, all on
the event loop (the #229 chain measured the stacking).

Deliverable (red-first):
1. RED pin impl/test/git-batch-216-red.test.mjs: a page resolving N members' result
   refs makes ≤1 git invocation (one `git for-each-ref refs/baton/results/` or
   batched rev-parse), not N. Count invocations via a spy/spawnFn seam in the
   fixture. RED at HEAD (N calls).
2. Implement: a `resolveResults(refs[])` batch on the worktree authority
   (impl/src/index.mjs near resolveResult) — one for-each-ref/rev-parse process for
   the whole batch, Map<ref,sha|null> return; `_buildView`/`inspectPreservedResult`
   consumers batch per page. Keep `resolveResult(ref)` as the single-ref wrapper
   over the batch (one call = one process — no regression).
3. GREEN + batteries: coordinator, blind-waits (own RED roster aside),
   workflow-as-data, phase62.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/index.mjs, impl/src/coordinator.mjs (the consumer seam),
impl/src/application.mjs (view build), impl/test/**, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-g/notes-row-git-batch.md
