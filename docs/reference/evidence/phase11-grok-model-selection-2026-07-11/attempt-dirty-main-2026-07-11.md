# Concurrent Grok fallback — dirty-main refusal

The two-worker exact-model fallback allocated both Grok tasks concurrently but reached no child
process: the checkout contained the current uncommitted web-edge fixes/evidence, so worktree
readiness could not be established and both adapter spawns failed typed with `spawn requires a
worktree`. Baton confirmed both kills and removed both worktrees, metadata records, and task
branches. This is not an authentication result. The runner should preflight and report checkout
cleanliness before allocating provider work.

