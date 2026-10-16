[attempt: 30cb5c9c-4134-407f-b460-b04f6a26768e row-git-batch]
# ROW notes — row-git-batch: the per-member sync git digest goes batched (#216)

RED-first pin + implementation. The per-member preserved-result git resolve (~40 ms sync
`execFileSync` spawn each, on the event loop) now batches per waves.list page: N members'
result refs resolve in ONE `git for-each-ref refs/baton/results/` process instead of N
`git rev-parse` spawns.

## Deliverable 1 — RED pin (`impl/test/git-batch-216-red.test.mjs`, GB-1)

A real end-to-end fixture (createDriver + BatonApplication + createWave + settle): one open
wave with 5 completed MockAdapter members, each result retained under `refs/baton/results/`
(asserted `result_ready` + 40-hex resultSha). Two spy seams count resolution work during one
`waves.list` call:

- **method spy**: wraps the worktree manager's `resolveResult`/`resolveResults` on
  `driver.coordinator._worktrees` (the same seam harvest-accessor D5 uses);
- **spawn seam**: `createDriver({ gitExec })` replaces the manager's git spawn for the
  resolution paths, so the test counts REAL `git` processes.

Assertions: the page resolves ≤1 resolution call, ≤1 real git spawn, and — when the batch
exists — the single `resolveResults` call carries all N retained refs. Semantics: the
batched inspection of a completed member still reads `pinned` with the exact captured sha
against the real repo (coordinator.result() is the source of the captured sha / retained
ref — the coordination-store task row is a projection and does NOT carry them; verified
empirically during fixture bring-up).

**RED at HEAD**: `waves.list resolved 5 preserved-result refs for 5 members` — one
resolveResult per member (`_buildView` → `inspectPreservedResult` → `worktrees.resolveResult`).
**GREEN after**: 1 batched `resolveResults([5 refs])`, 1 spawn, all members read `pinned`.

## Deliverable 2 — implementation

### `impl/src/index.mjs` — the worktree authority batch (near resolveResult)

- `worktreeManager` gains a `gitExec` spawn seam (`opts.gitExec ?? localGit`, validated);
  `createDriver` passes it through.
- New `resolveResults(refs[])`: validates every ref (`result_ref_invalid` on any outside
  `refs/baton/results/[a-f0-9]{40,64}`), runs ONE `git for-each-ref --format=%(refname)%00%(objectname)`
  over `refs/baton/results/` (16 MiB maxBuffer bound), returns `Map<ref, sha|null>` — null
  exactly when the ref is absent (missing/mismatch truth preserved). Empty array → no process.
- `resolveResult(ref)` is now the single-ref wrapper over the batch (one call = one process —
  no regression); identical validation/error semantics.

### `impl/src/coordinator.mjs` — the consumer seam

- New `inspectPreservedResults(entries)` (bounded ≤4096): same per-entry rules as
  `inspectPreservedResult` (unknown worker → WorkerNotFoundError, un-completed / sha-mismatch /
  no-ref → `unavailable`, no resolver → `unverifiable`), but resolves every distinct retained
  ref through ONE `worktrees.resolveResults`; per-entry frozen `{sha, ref, state, resolved}`.
  Stub worktrees without `resolveResults` fall back to per-entry `resolveResult` (stub semantics).
- `inspectPreservedResult(workerId, expectedSha)` delegates to the batch (single entry).

### `impl/src/application.mjs` — the view-build consumers batch per page

- `_buildView` / `_buildWorkflowView`: when `options.preservedResults` (a
  `Map<"workerId\0expectedSha", inspection>`) carries the member's key, the view consumes the
  pre-resolved inspection instead of calling `inspectPreservedResult`; otherwise the exact
  prior single-ref path runs (workflow selected-candidate, cache misses, non-page commands).
- `inspect` accepts an optional 4th `viewOptions` param threaded into its `_buildView` calls
  (default null — all other callers untouched).
- `waveList` pre-resolves the page: `_pagePreservedInspections(page, waveIndex)` collects one
  entry per completed member (`coordinator.list()` by runId + `coordinator.result()` for the
  captured sha / retained ref — memory/log reads, never a git spawn), resolves them in ONE
  `inspectPreservedResults`, and threads the keyed map into each member's `inspect`.

## Deliverable 3 — batteries

| suite | with change | at HEAD | note |
|---|---|---|---|
| git-batch-216-red (new) | 1/0 GREEN | RED (5 calls) | the pin |
| coordinator.test.mjs | 58/0 | 58/0 | |
| blind-waits-red.test.mjs | 22/12 | 22/12 | 12 fails = its own RED roster (row-suite-164 #164/#148/#158 pins) — "own RED roster aside" |
| workflow-as-data-red.test.mjs | 31/0 | 31/0 | |
| phase62-goal-plan-authority | 8/0 | 8/0 | |
| phase62-goal-plan-replay-reds | 18/0 | 18/0 | |
| phase62-goal-plan-stream | 3/0 | 3/0 | |
| phase62-mcp-goal-plan | 6/0 | 6/0 | |
| phase62-web-goal-plan | 6/1 | 6/1 | GP7/GP8 pre-existing RED at HEAD |
| waves-list-scaling-red | 1/0 | 1/0 | |
| wave-driver-red | 10/0 | 10/0 | |
| phase80-plan-revision-store | 6/0 | 6/0 | stub `resolveResult` contract intact |
| turn-checkpoints-31b-red / 31b5-surface-red | 20/0, 5/0 | same | application.mjs source pins intact |
| harvest-accessor-red | 5/34 | 5/34 | RED-by-design "stage: ports absent" suite; identical at HEAD |
| phase67-change-aware-inspect | 4/4 | 4/4 | fixture gap (`eventsView` missing); identical at HEAD |
| phase92-result-intent-vertical | 9/1 | 9/1 | identical at HEAD |

Failure sets are byte-identical with vs. without this change (verified twice via
stash-and-rerun at pristine HEAD): **zero regressions**. The 12 blind-waits fails are the
suite's own RED roster; harvest-accessor's 34 are its ports/projection RED pins; phase67's 4
and phase62-web's 1 are pre-existing fixture/pin states.

## Conflicts / sibling coordination

Parallel siblings edit shared files. This row's enumerated sites: application.mjs (view
build + waveList page seam — the goalplan row also touches application.mjs; edits here are
confined to `_buildView`/`_buildWorkflowView` preservation blocks, the `inspect` signature,
and the waveList page loop — no store/index seams shared with goalplan/compaction), and
index.mjs / coordinator.mjs (git-batch-only sites: `resolveResults`/`inspectPreservedResults`).
No unresolved conflicts observed at write time; the page batch degrades cleanly if the
coordinator batch seam is absent (per-member fallback), so sibling landings stay order-independent.

## Verification

- RED at HEAD: `node --test test/git-batch-216-red.test.mjs` → 1 fail (5 resolution calls).
- GREEN: same command → 1 pass (1 batch call, 1 spawn, `pinned` semantics).
- Deployment verification: `true` (direct executable + empty argv, exit 0).
