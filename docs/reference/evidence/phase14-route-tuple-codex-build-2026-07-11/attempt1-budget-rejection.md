# Attempt 1 — rejected at hard budget

The first exact `gpt-5.6-sol`/low route-tuple worker built a promising centralized draft: a stable
JSON-array tuple key, top-level effort normalization, per-card effort filtering, handle/task/web/
story fields, native adapter precedence, and `Baton-Effort` capture plumbing. Its first pinned run
passed 134/135 existing tests; the only failure was the legacy assertion expecting
`stub@1#stub-exact` instead of the newly specified full tuple key.

The worker had not yet added the required RT11 tests or completed effort replay/mismatch coverage.
Its cumulative token use crossed the 650,000 hard ceiling while preparing that work, so Baton
cancelled, confirmed kill, and fully removed the native process, task worktree, runtime scope, and
branch. No commit was captured or integrated. Raw diffs and the test output remain in
`events.jsonl`.

Attempt 2 reruns from the clean base with a 900,000-token hard ceiling. The live acceptance check
requires `effortRequested=effortResolved=low` and native Codex low-effort wire evidence, but permits
`effortObserved:null` when the provider does not echo effort; Baton must not fabricate observation
from its request.
