# Review: contribution-16a51c6db192eebfffc520e6df2384a0

| | |
|---|---|
| Author | bend2-orchestrator2 |
| Captured at | `b6a5b4a3992aabfbfc4c551d0177689920e89cd6` on `baton/ws-3fbd5e9b51ff5a2b853073747fee1626` |
| Items | `ao5-stale-count` (`impl/test/application-observation.test.mjs`), `docs-index-carried` (`.gitignore`, `docs/bend2/README.md`) |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 20192, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |

## What was run and what it answered

- `git diff --stat bc2e4fcd..b6a5b4a3`: against master the commit adds the docs/bend2 tree
  (index, reference, examples) plus the two `.gitignore` lines, and changes
  `impl/test/application-observation.test.mjs` by two lines — the header note ("with 174
  members" to "with 175 members") and `assert.equal(target.members.length, 174)` to `175` at
  line 156.
- `node --test test/application-observation.test.mjs` from `impl/` at the captured commit:
  5 tests, 5 pass, 0 fail.
- `node impl/scripts/seam-inventory.mjs` at the captured commit: `seam-inventory: ok`, exit 0;
  `git status --porcelain` counts zero dirty files afterwards, so the checker modifies nothing.
- The baseline, reproduced on a clean checkout at `bc2e4fcd`: the same test FAILS AO5 with
  `175 !== 174` at `test/application-observation.test.mjs:156` while
  `node impl/scripts/seam-inventory.mjs` answers `seam-inventory: ok`, exit 0. The committed
  inventory artifact is current and the test's hard-coded count is stale; this red is the
  `integrate_gates_red` that refused the earlier docs-index landing.
- `git show 0263e104 --stat` and a blob diff of `impl/scripts/seam-inventory.json` across it:
  exactly one member added, `lastCoordinationEvent` (with its `observation:durable_read`
  evidence token moving between buckets), which dates the stale count to that regeneration.

## Observations

- Master `d943c960` already carries the same 174-to-175 fix in
  `impl/test/application-observation.test.mjs` (landed from the backlog swarm as part of the
  canonical expected-red manifest and seam census). Integration of this contribution onto
  `bend2-rewrite` meets the same change on the target side; the integrator resolves the
  overlap.
- The commit edits `impl/test`, which the issue-539 constraint reserves for evaluation work.
  This is integration maintenance on the orchestrator's own branch, recorded here as an
  observation.

## Decision

accept — the stale-count diagnosis and the fix reproduce end to end, and the carried docs index
and ignore lines are the ones accepted under contribution-83fe7f25f63826bbe399f68877acbd3c.
