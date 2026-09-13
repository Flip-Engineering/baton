# Live workspace snapshots — runtime policy audit

Audit date: 2026-09-13. Companion to [admission.md](admission.md) in this directory. Scope: the
contribution-capture seam between a running worker and its physical worktree, and the new
primitive `impl/src/workspace-snapshot.mjs` that makes capture possible *while the worker is
still working*. The question this audit answers is narrow:

> How can an agent snapshot its own in-progress contribution mid-turn — as a tool call —
> without the paused-turn contract, without mutating the workspace it still owns, and without
> inventing custody of the result?

Everything below describes the tree as of this revision; line references name symbols so they
survive drift. This audit was written by the same worker that implemented the primitive, as the
baton brief requires; the preservation side of this seam (`worktree.mjs captureCommit`, refs/
retention) is owned by another worker and is described here only as observed behavior, not
changed.

---

## 1. The defect this closes

`captureCommit` (`impl/src/worktree.mjs`) is the only contribution capture in the tree. It:

1. validates owned-worktree state, then runs `git add -A` **against the real index**;
2. commits on the checked-out branch (moving a ref);
3. on failure, best-effort resets the real index (`git reset -q`) — acceptance says the reset
   "refuses to run" but the reset itself is a mutation of live staging state.

Each step is *correct for a paused turn*: the worker is gone, nobody else is editing, and the
result index/commit is the deliverable. None of them is safe mid-turn:

- `git add -A` rewrites the real index out from under the live agent. A concurrent `git add` by
  the agent races it; a capture failure leaves staging state that the agent did not choose.
- Committing on the branch moves HEAD while the turn is still open, so any subsequent work the
  agent does is silently stacked on a "result" it never declared finished.
- The agent cannot even *use* captureCommit as a tool: the paused-turn contract means the turn
  must end before capture, so a native implementer can never record its own code while working.
  It must stop, end the turn, and let the coordinator capture — losing the ability to, say,
  snapshot a working intermediate state and keep going.

The gap is structural, not a bug in captureCommit: a mid-turn capture needs different mechanics,
not looser guarding around the same ones.

## 2. The primitive

`snapshotWorkspace({ worktree, baseSha, excludedPaths = [] })` (new,
`impl/src/workspace-snapshot.mjs`) records the **visible work** of an active workspace — staged,
unstaged, and untracked files, at their visible on-disk versions — into an immutable commit:

1. **Validation before any mutation.** Shape checks (pure), then read-only git checks: the path
   must *be* the root of a git worktree (`rev-parse --show-toplevel` resolves to it — a scratch
   directory nested in an outer repository is refused, not adopted); `baseSha` must resolve to a
   commit (`^{commit}` peeling also rejects tree/blob objects); HEAD must resolve (an unborn HEAD
   cannot name the required parent); each excluded path must be relative, contained, and free of
   `.git` segments. A path that is *tracked* while named in `excludedPaths` refuses with
   `workspace_snapshot_projection_tracked` — a snapshot cannot both exclude and include a path;
   silently dropping a tracked path would fabricate a deletion, keeping it would betray the
   exclusion. This is the force-tracked projection refusal.
2. **Isolated temporary index, outside the worktree.** A private `mkdtemp` directory under
   `os.tmpdir()` holds `index` and `excludes`. The temporary index is seeded by **copying the
   real index** (falling back to `read-tree --empty` when no index file exists yet), then
   `git add -A` runs with `GIT_INDEX_FILE` pointed at the copy. Every git invocation strips all
   inherited `GIT_*` variables and pins `GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL`, so ambient
   environment cannot redirect `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` at the capture.
3. **Copy, not `read-tree <baseSha>` — deliberately.** Seeding from base would stage deletions
   for every tracked file that a sparse checkout has not materialized. Copying carries the real
   index's skip-worktree and assume-unchanged bits across verbatim, and `add -A` honors them
   exactly as it does for an ordinary commit, so non-visible tracked files stay in the snapshot
   at their base state and are never misrecorded as deletions (pinned by test).
4. **Commit without refs.** `write-tree` on the temporary index, then
   `commit-tree <tree> -p <HEAD observed before capture>`. The parent names the actual HEAD
   observed at capture time — a live snapshot is pinned to the workspace state it observed, not
   to the caller's (possibly stale) idea of HEAD. No ref is created, moved, or deleted; the
   commit is a dangling object until the **caller** pins it via the existing `retainCheckpoint`.
   The primitive validates no custody and invents none.
5. **`changedPaths` from the immutable pair.** The returned `changedPaths` is the exact path set
   of the snapshot tree versus `baseSha` (`diff-tree`), computed *after* capture from immutable
   objects — never from the live tree, which concurrent editors may already have moved again.
6. **Cleanup on all paths.** The `finally` block removes the temporary index and excludes file on
   success, refusal-mutation failure, and mid-capture git failure alike (pinned by test).

Return contract: `{ sha, baseSha, changedPaths, snapshotted: true }` — always a fresh commit,
even when the visible tree equals base (a no-change snapshot still honestly records "observed
nothing new at this point, under this parent"; its tree equals the base tree).

## 3. Exclusions and credentials

`excludedPaths` are matched as root-anchored gitignore patterns (`/path`), following the same
convention as `configureProjectionExcludes` in `worktree.mjs`. Because the primitive must
override `core.excludesFile` to inject them, the effective ignore file's current content — the
configured `core.excludesFile`, else the default `info/exclude` — is folded into the temporary
exclude file ahead of the caller's paths, so repository ignore authority (including
`ensureBatonExcluded`'s `.baton/` entry) survives the override (pinned by test).

The temporary index lives outside the worktree and is therefore unreachable by `add -A`'s
pathspec: the snapshot can never include its own staging state. Callers own the *semantic*
exclusions (toolchain projection targets, credential and private-runtime paths); the primitive
owns the mechanics and refuses to guess. The credentials test pins that a repo-configured
excludes file keeps `secret-*.key`/`.env*` out of the snapshot.

## 4. Concurrency and locks

A live snapshot is **not** an atomic transaction across concurrent editors; it records the file
versions visible at the moment `add -A` ran. The brief assigns serialization of capture requests
for the same physical checkout to root (via the owned worktree manager); this module takes no
lock that could block ordinary agent work:

- every invocation passes `--no-optional-locks`, so no untracked-cache/fsmonitor optional lock
  is taken on the real repo;
- the only lock ever taken is `<tempIndex>.lock` inside the private temp directory, which no
  other process uses;
- the real index is opened for reading exactly once (`copyFileSync`); all writes go to
  `GIT_INDEX_FILE`.

`-c core.fsmonitor=false` additionally keeps the capture from spawning an fsmonitor daemon for
the worktree.

## 5. Invariants vs accidental policy

| Kind | This primitive | Status |
| --- | --- | --- |
| Resource bound on one call | ≤ 1024 excluded paths, ≤ 2048 bytes/path (mirrors `SPARSE_MAX_*`) | Declared constant, structural |
| Custody | Caller validates ownership before/after and pins via `retainCheckpoint` | Enforced by refusal to touch refs |
| Refs | Zero ref effects; parent names observed HEAD | Pinned by test |
| Real index bytes | Byte-identical across capture and refusals | Pinned by test |
| Concurrency honesty | Visible versions, not atomicity; root serializes per checkout | Documented here + module header |
| Journals/caps | None added | Confirmed: no new state files, no counters |

## 6. Behavioral acceptance (all pinned in `impl/test/workspace-snapshot.test.mjs`, 13/13)

- **AC1 visible work:** staged-then-re-modified file records the on-disk version; unstaged and
  untracked files included; ignored `*.log` excluded; `changedPaths` exactly
  `['README.md', 'a.txt', 'c.txt']`.
- **AC2 index preservation:** real index bytes sha256-identical across capture; staged partial
  content still staged (`ls-files -s` row unchanged) while the snapshot carries the visible tree.
- **AC3 refs and worktree:** HEAD, current branch, and a second branch unchanged; parent of the
  snapshot commit equals the HEAD observed before the call; the commit is reachable from no
  branch; worktree files untouched.
- **AC4 exclusions:** untracked `proj/toolchain` excluded from tree and `changedPaths`, left on
  disk; force-tracked projection refuses with `workspace_snapshot_projection_tracked` before any
  mutation (index bytes and HEAD unchanged, no temp residue).
- **AC5 no-change tree:** `snapshotted: true`, `changedPaths: []`, snapshot tree equals base tree.
- **AC6 refusals:** missing sha, tree (non-commit) object, garbage, `undefined` base refused
  (`invalid_base`/TypeError); `.git` itself, a non-repo directory nested under an outer repo, a
  missing path refused (`invalid_worktree`); absolute/escaping/`.git`/NUL/non-string/bound-
  exceeding exclusions refused (`invalid_exclusion`/TypeError) — all before git mutation, all
  leaving index bytes unchanged.
- **AC7 spaces:** `my notes/final draft.txt` staged+modified and `scratch pad/idea two.md`
  untracked snapshot exactly; `changedPaths` matches byte-for-byte.
- **AC8 failure cleanup:** corrupt-index mid-capture failure surfaces as
  `workspace_snapshot_failed` and leaves zero `baton-live-snapshot-*` directories in `tmpdir()`.
- **AC9 sparse:** a cone sparse-checkout worktree does not record non-materialized tracked files
  as deletions; they stay in the snapshot at base state; visible changes and untracked files
  still captured.
- **AC10 credentials:** repo-configured `core.excludesFile` (file outside the checkout, mirroring
  Baton runtime state) keeps `secret-*.key`/`.env*` out of the snapshot.

## 7. Wiring and non-goals

- Root wires this into the owned worktree manager and serializes capture requests per physical
  checkout. `worktree.mjs`, `index.mjs`, and coordinator/application/swarm modules are explicitly
  out of scope here; nothing in the tree calls the new module yet.
- No new dependency, no shell interpolation (all argv via `execFileSync`), no new journal, cap,
  or state directory. The only filesystem residue is the temporary directory, removed on every
  path.
- `captureCommit` remains the paused-turn capture path and is unchanged.

## Appendix — evidence

```
git rev-parse HEAD                                   # worktree revision under audit
node --test impl/test/workspace-snapshot.test.mjs    # 13/13 pass, exit 0
```

Probe behind the design (copy-index sparse safety): with a cone sparse checkout, `git add -A`
against a copied index honors the skip-worktree bit — the non-materialized file is absent from
`diff --cached` and remains at its base blob in the staged tree.
