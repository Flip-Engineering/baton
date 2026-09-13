# Workspace preservation: un-captured content survives destructive worktree removal

Wave `omp-rpc` (2026-09-13). Scope: `impl/src/worktree.mjs`, `impl/test/workspace-preservation.test.mjs`,
this document. Base revision `c200ced7` (worktree `ws-efeb4ac0b86540cdd51f391668aa372b`). Delivered
`impl/src/worktree.mjs` `git hash-object` `8e958485d9d619b103e2da48e05f83960a78951e`, test suite
`dbab9c52f0c282d54c9bd232deabc68afcd7f60e`. No shared-workspace feature was added: this change fixes
the deletion defect at the two destructive boundaries that already exist (`reap`, `reconcile`).

## 1. Defect

The independent audit (`/tmp/baton-shared-workspaces-review.md`, F1/F2) found that both destructive
worktree boundaries remove a checkout without ever observing its content:

- `reap` deletes the directory with `git worktree remove --force` (falling back to `rm -rf`), and the
  only gate is `meta.stoppedAt` when `opts.force` is unset. Both production callers pass
  `force: true` (`index.mjs` `remove`).
- `reconcile` destroys the checkout of a dead owner that the caller did not list as expected —
  `git worktree remove --force` → `rmSync(..., { recursive: true, force: true })` → `git branch -D`
  — with no content observation anywhere on that path.

Measured on the base revision (probe: dirty tracked edit + untracked file in a `ws-…` checkout whose
receipt names a locally dead controller):

```
BEFORE  reap(force:true, deleteBranch:true)   -> no refusal; checkout gone; content gone; receipt released
BEFORE  reconcile([], ownerAuthority=restart)-> removedPhysicalOwners=[ws-…] (+ capacity settled,
                                                 receipt released); diagnostics=[]
AFTER   reap(force:true, deleteBranch:true)   -> WorkspacePreservationError
                                                 workspace_uncommitted_content_retained; content + receipt intact
AFTER   reconcile([], ownerAuthority=restart)-> removedPhysicalOwners=[]; settled=[]; diagnostics=
                                                 [workspace_uncommitted_content_retained, …]; content + receipt intact
```

The same defect covered two "disposable" cases that must keep working; both are calibrated in the
suite rather than assumed: copied dependencies (metadata `copiedDependencies`), toolchain projection
targets (hidden by the worktree's own `core.excludesFile` projection excludes), genuine
create-failure rollback (clean tree), and empty zombie directories.

## 2. Invariant and decision

`observeOwnedWorktreeContent(repoRoot, physicalOwnerId, opts)` reports one of:

| state | meaning | removable |
| --- | --- | --- |
| `absent` | no directory | yes |
| `clean` | live checkout, `git status` reports nothing | yes |
| `disposable` | every changed path is untracked **and** under a declared infrastructure root | yes |
| `dirty` | at least one changed path has no recorded capture | no |
| `empty` | not this repository's checkout, and holds no content entries | yes |
| `unobservable` | live checkout whose status failed, or a non-checkout directory holding entries | no |

Declared infrastructure roots come from exactly three sources: the owner metadata's
`copiedDependencies` and `toolchainProjectionTargets` (only when `validatedMetadata` accepts the
metadata — corrupt metadata proves nothing and therefore declares nothing), and the caller's
`opts.disposablePaths` (validated safe relative literals, never `.git`/`.baton`, never escaping).
Projection targets normally never reach this classification at all: Git itself ignores them through
the worktree-local `core.excludesFile` that `configureProjectionExcludes` installs, so a projected
checkout observes as `clean`.

`removable` is false only for `dirty` and `unobservable`: unknown is not permission. A non-checkout
directory is judged by a bounded walk — a top-level `.git` administration entry and empty
directories are content-free, anything else is unproven. Per-file untracked enumeration
(`--untracked-files=all`) is required: with collapsed `?? dir/` entries, a declared root nested
inside the untracked tree (`legacy/deps`) cannot be classified, which is a real regression the
phase55 suite caught during this change.

## 3. Boundary behavior

Both boundaries take the same decision (`authorizeWorktreeRemoval`) and refuse with a typed error
before their first destructive effect:

| code | raised by | meaning |
| --- | --- | --- |
| `workspace_uncommitted_content_retained` | `reap`, `reconcile` | worked content with no recorded capture and no discard authorization |
| `workspace_content_unobservable_retained` | `reap`, `reconcile` | content could not be observed |
| `workspace_discard_authorization_invalid` | `reconcile` (callback return) | the per-owner authorization was malformed |
| `workspace_removal_deferred` | `reap` (`opts.beforeRemove`) | the caller's transaction gate refused after the decision |

`WorkspacePreservationError` carries `retained: true` and the full `observation` (state, `dir`,
`dirtyPaths`, `disposablePaths`, `headSha`, `baseSha`). Nothing is removed, released, or logged on a
refusal: directory, metadata, registration, branch, index, working tree and owner receipt are
byte-identical afterwards (the suite compares `git status --porcelain=v2 -z --no-renames -uall`
output before and after).

**`reap`** order: validate caller configuration → stop latch (`force` still overrides only this) →
content decision → `opts.beforeRemove` gate → directory removal → registration → branch → metadata
→ exact absence proof → `worktree.discard_authorized` (if content was discarded) → receipt release →
`worktree.reaped`. The discard record is written only after the absence proof, so a deferred or
failed removal never claims a discard that did not happen.

**`reconcile`** order per candidate: owner/receipt/authority classification (foreign and live
owners are untouched, as before) → content decision → capacity settlement callback
(`beforeOwnerCleanup`) → removal → absence proof → discard record → receipt release. The decision
deliberately runs *before* capacity settlement: a retained checkout still consumes its reservation,
so its row must not be settled. Retained owners are reported in a new field
`report.retainedContentOwners`, emit a `retained: true` diagnostic carrying the content evidence,
and join `retainedExpectedOwners` — which is what keeps the capacity layer's retained set
(`index.mjs` `reconcile` → `worktreeCapacity.reconcile(retained, retainedUnproven)`) from dropping
the row for a resource that still exists. `report.removedZombieDirs`, `report.removedPhysicalOwners`
and `report.errors` never mention a retained owner, and an authorized discard is recorded in
`report.authorizedDiscards` with its reason, evidence reference and actor.

Authorization is a decision, not a flag: `opts.discard = {reason, evidenceRef?, actor?}` for a whole
call, or `opts.authorizeDiscard(physicalOwnerId, receipt, observation)` per owner. `evidenceRef` may
be `null` for an honest "nothing was captured" decision; when a caller captured first, it names the
pinned revision, and the boundary records it. `force: true` never substitutes for this decision and
`markStopped` is not one either (both pinned by tests).

## 4. What the boundary deliberately does not do

It never stages, commits, stashes, moves or rewrites the content it judges: preservation is by
retention. That is the conservative reading of the brief, and it is measurable:

- `git stash create -u` was probed as a candidate in-boundary capture and **silently omits untracked
  files**: the returned commit's tree contained only tracked paths and had no third parent, while the
  index and working tree were unchanged (git 2.50.1). A capture that silently drops untracked work
  would be worse than the refusal it replaces.
- The runtime's own capture (`captureCommit`) stages with `git add -A`; in a shared checkout that
  absorbs every concurrent holder's edits (audit F5). Attribution of a mixed tree is a caller
  decision, so it stays outside the boundary.

`opts.authorizeDiscard` is synchronous (reconcile is synchronous), so a caller that wants to
preserve-then-remove either runs its capture before the call or performs a synchronous capture in
the callback (the suite proves the pattern with a sync add + commit + `update-ref
refs/baton/checkpoints/<sha>`, then confirms both the modified tracked file and the untracked file
resolve from the pinned revision after the checkout is gone, and that a caller which declines —
returns `null` — leaves the content untouched). Nothing about group membership is treated as
filesystem custody here: the only inputs are owner receipts, metadata, Git state and the caller's
explicit decision.

## 5. Verification

Verification command (the deployment contract), working directory `.`:

```
node --test impl/test/workspace-preservation.test.mjs     -> exit 0, 24 tests, 24 pass, 0 fail
```

Scenarios, mapped to the assigned work: dirty tracked (staged and unstaged), deleted tracked file,
untracked file, `force` refusal and refusal idempotence; `markStopped` + non-forced refusal; clean
checkout removal + double-reap no-op + exact absence proof; copied dependency and toolchain
projection disposability; caller-declared generated residue; discard with and without evidence and
malformed-authorization rejection before any effect; `beforeRemove` deferral (no discard record) and
retry; unobservable content retention; empty zombie directory still removed; startup reconciliation
of a locally-dead owner (dirty retained / clean twin removed, capacity settled only for the removed
one, idempotent retry); live foreign controller untouched; `authorizeDiscard` decline, invalid
return, and capture-in-refs removal.

Directly affected existing suites, all re-run against the changed module:

| suite | result |
| --- | --- |
| `worktree.test.mjs` | 35/35 |
| `phase58-sparse-worker-worktree.test.mjs` + `phase58-sparse-capture-integrity.test.mjs` | 34/34 |
| `phase59-worktree-capacity-authority.test.mjs` | 66/66 |
| `phase92.2-physical-workspace-owner-red.test.mjs` + `issue45-startup-reconcile-red.test.mjs` + `auxiliary-workspace-reconciliation.test.mjs` | 29/29 |
| `phase58-p0-confinement-regressions.test.mjs` + `phase55-toolchain-projection.test.mjs` + `workspace-observation-truth.test.mjs` + `reap-on-terminal-red.test.mjs` | 25/25 |
| `swarm-runtime.test.mjs` + `swarm-coordination.test.mjs` + `e2e.test.mjs` | 14/14 |
| `phase67-signal-reap.test.mjs` + `phase70-preserved-stop.test.mjs` | 7/7 |

Two failures encountered are **pre-existing at the base revision**, proven by running each suite from
a read-only `git archive HEAD impl` copy with the workspace `impl/node_modules` linked:
`phase56-drain-and-close.test.mjs` `DC2-DC7` (asserts the second worker is `pending` under
`concurrencyCeiling: 1`; observes `working`; fails identically on both revisions) and
`phase91-semantic-interrupt-preservation-red.test.mjs` `P91-3`…`P91-12`
(`cancelledByParent: Promise resolution is still pending but the event loop has already resolved`;
same on both revisions). Neither touches worktree removal.

## 6. Contracts the integration layer must still adjust

The module edge is fixed; the wiring above it is not (owned by other participants, so it is reported
here rather than edited):

1. **`index.mjs` `remove(taskId)` (927-970) releases capacity before calling `reap`.** With the
   guard, a refusal after that release would retain a checkout whose reservation row is already
   gone. Settle capacity inside the boundary with the new gate —
   `reap(root, taskId, { force: true, deleteBranch: true, beforeRemove: () => capacity.settleForCleanup(id) })`
   — or pre-observe with `observeOwnedWorktreeContent` and skip settlement for a non-removable
   resource. The gate runs after the preservation decision, before the first effect, and a refusal
   leaves the reservation untouched.
2. **`index.mjs` `finalizeFailedTransaction` (343) must classify its own creation residue.** A failed
   creation can leave materialized dependencies with no metadata on disk (metadata is written after
   materialization), which is unprovable to the boundary: pass the transaction's declared dependency
   directories as `disposablePaths`, or an explicit `discard` — otherwise the rollback retains.
3. **`coordinator.mjs` `_removeOwnedTaskWorktree` (8886) must treat the typed refusal as custody
   state, not as a generic failure.** Today any error becomes `cleanupError: 'worktree_cleanup_failed'`
   (8948) and propagates; a `WorkspacePreservationError` should keep `cleanupPending` and surface its
   own code (and `workspace_removal_deferred` likewise). The preserve-before-reap fail-safe
   (`preserveUnaccepted`, 8932-8937) is still only enabled for `dead`/`exited` handles on
   non-terminal tasks — widening it to "checkout holds content no capture recorded" (audit §5.2) turns
   today's refusal into capture-then-remove for the ordinary stop paths.
4. **Startup `reconcileStartupResources` (1334) should supply `authorizeDiscard`** so a dirty
   dead-owner checkout is captured to a checkpoint ref (sync capture) and then removed, instead of
   being retained indefinitely; without it, retention is the safe default and the owner is reported
   in `report.retainedContentOwners`, which the capacity layer must also receive (it already lands in
   `report.retainedExpectedOwners`, so today's `index.mjs` wiring keeps the row).
5. **`index.mjs` `reconcile` (1034) should forward `disposablePaths` / `discard` / `authorizeDiscard`**
   from the coordinator (and may expose `observeOwnedWorktreeContent` for pre-flight checks).

## 7. Remaining gap, reported not fixed

Committed-but-uncaptured work on the owner branch is still destroyable at both boundaries:
`reap(deleteBranch: true)` deletes `baton/<ws-…>` after removal, and reconcile's loop-1 does the same
at its postcheck, even when `headSha !== baseSha`. The observation now exposes `headSha`/`baseSha`, so
the missing piece is a policy: pin `refs/baton/checkpoints/<tip>` before deleting a branch whose tip
moved, or refuse `deleteBranch` for a moved tip without a discard authorization. It is intentionally
out of this change: the assignment fixes un-captured *working-tree* content first, the coordinator
already pins captured revisions (`_preserveProgressBeforeReap`), and `reap(deleteBranch)` on a moved
tip is exercised by existing suites (`phase11`, `phase55`) whose contracts root must judge before
tightening. No silent discard was introduced for it: the observation reports `headSha`/`baseSha` on
every decision, and the discard record carries them.
