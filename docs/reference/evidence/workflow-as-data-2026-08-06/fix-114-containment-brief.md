# #114 FIX BRIEF — the harvest-containment realpath normalization (5 failing rows)

The #114 implementation (applied in this tree, UNCOMMITTED — `git status` shows it) passes 24/29
of `impl/test/workflow-as-data-red.test.mjs`. Five rows fail — W2-01 and W4-01..04 — all on the
harvest containment check in the NEW `impl/src/workflow-interpreter.mjs`. Your job: fix the
implementation so all 29 pass with ZERO weakening edits to any test.

## The defect

`assertHarvestContained` (`workflow-interpreter.mjs:305` area) throws `workflow_harvest_invalid`
("resolves outside the repository root (symlink escape)") for legitimate in-repo harvest paths
inside the suite's mkdtemp repos. Root cause class: the containment check compares a REALPATH-
resolved candidate against a LEXICAL root (or vice versa). On macOS the tmpdir is
`/var/folders/...` which realpaths to `/private/var/folders/...` — a one-sided realpath makes
every in-root path read as outside. The pinned precedent is `impl/src/mcp-descriptor.mjs:46-72`
(`resolveCredentialRef`): lexical `resolve` + `relative`-starts-with-`..` rejection PLUS a
`realpathSync` symlink-escape check — **with BOTH sides normalized through the same realpath
discipline, and nonexistent paths handled** (a harvest target may not exist yet at admission;
realpathSync throws on missing paths — the precedent's handling is the model).

## Method

1. Read the failing rows (W2-01, W4-01..04 in the suite) and the containment code
   (`workflow-interpreter.mjs` — `admitHarvest`, `admitHarvestEntry`, `assertHarvestContained`).
2. Read `mcp-descriptor.mjs:46-72` and mirror its normalization exactly (both sides realpath'd,
   missing-path behavior as the precedent handles it).
3. Keep every refusal the rows pin: `..`/absolute/backslash/NUL refuse at admission; a genuine
   symlink ESCAPE still refuses; containment failures are `workflow_harvest_invalid` typed.
4. Do NOT edit any test file. Edit ONLY `impl/src/workflow-interpreter.mjs` (and only the
   containment path — no drive-by changes).

## Verify (from the repo root, record the splits)

`node --test impl/test/workflow-as-data-red.test.mjs` — must reach **29/29**, stable across two
runs. Also run `node --test impl/test/workflow-surface-red.test.mjs` and
`node --test impl/test/wave-driver-red.test.mjs` (adjacents must stay green). Campaign law: no
clocks; NUL discipline; sorted-key literals ACTUAL order; `localeCompare` banned. Commit your
worktree at the boundary (issue #141's law).
