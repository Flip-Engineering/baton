# Workspace preservation: un-captured content survives destructive worktree removal

Wave `omp-rpc` (2026-09-13), revised after root's review of `7db48f83`. Scope:
`impl/src/worktree.mjs`, `impl/test/workspace-preservation.test.mjs`, this document. Delivered
`impl/src/worktree.mjs` `git hash-object` `0980e26dd56dce508098d52692e5f73c8fe97a19`, test suite
`414845e92b44ceae08c6d88b883c5073b800808d`. No shared-workspace feature was added: this fixes the
deletion defect at the two destructive boundaries that already exist (`reap`, `reconcile`).

The first pass also invented a deletion-policy API — `opts.discard`, `opts.authorizeDiscard`,
`opts.disposablePaths`, `opts.beforeRemove`, `PRESERVATION_MAX_BYTES`,
`report.authorizedDiscards`. The revision removes all of it. The assignment is to preserve work, not
to make its destruction authorizable by a caller. What remains is one observation, one typed refusal
(two codes), and truthful reconciliation diagnostics.

## 1. Defect

Both boundaries removed a checkout without observing its content: `reap` deletes with
`git worktree remove --force` (falling back to `rm -rf`) behind only the `meta.stoppedAt` latch that
`force: true` overrides (`index.mjs` `remove` always passes it), and `reconcile` destroys a dead
owner's checkout with no content observation anywhere on that path.

A first-pass observation running `git status --ignored=no` did not fix the second half of that:
ignored paths are invisible to it, so a checkout whose only content was a Git-ignored `.env` or notes
directory observed as `clean` and was deleted. Probe with a dead owner and exactly those two paths
(`node /tmp/probe-ignored-reap.mjs <module>`, git 2.50.1):

```
base c200ced7    reap(force:true, deleteBranch:true) -> no refusal; checkout, .env, notes gone; receipt released
this revision    reap(force:true, deleteBranch:true) -> WorkspacePreservationError:
                                                        workspace_uncommitted_content_retained;
                                                        checkout, .env, notes, receipt intact
```

## 2. Decision

`observeOwnedWorktreeContent(repoRoot, physicalOwnerId)` reports one state:

| state | meaning | removable |
| --- | --- | --- |
| `absent` | no directory | yes |
| `clean` | this repository's checkout; Git reports no differing path | yes |
| `generated` | every differing path is untracked or ignored **and** under an attested root | yes |
| `dirty` | at least one differing path has no recorded capture | no |
| `empty` | not this repository's checkout, and holds no entries | yes |
| `unobservable` | this repository's checkout whose status failed, or a non-checkout holding entries | no |

Ignored paths are enumerated, not assumed away: `--untracked-files=all --ignored=matching`
(git ≥ 2.16). A wholly ignored directory collapses to a single entry, and per-file untracked
enumeration keeps an attested root nested inside an untracked tree classifiable.

Attestation is the only thing that makes content generated, and only owner metadata can attest it:
`copiedDependencies` and `toolchainProjectionTargets`, and only from metadata `validatedMetadata`
accepts (corrupt metadata attests nothing). No caller option, no `force`, and no `markStopped`
substitutes for it — caller-declared paths are never authority to delete source. Even under an
attested root only untracked or ignored paths classify as generated: a modified tracked path is
somebody's work whatever the metadata says.

Attested roots are excluded from the walk by pathspec (`:(exclude,top)<root>`), so observing a
checkout cannot cost a walk of an installed dependency tree: measured on a 20 000-file untracked
copy, 0 reported paths in 7 ms versus 20 000 paths in 21 ms (git 2.50.1, M4, warm cache). The
consequence, stated plainly: a tracked modification *inside* an attested root is not observed there.
That is the copy/projection contract's own ground — `materializeDependencies` copies with
`errorOnExist`, and projection targets are the toolchain's tree.

Identity is not `--show-toplevel`: another repository checked out at the owned path answers that for
itself, so the observation also requires the checkout's `--git-common-dir` to be this repository's.

## 3. Boundary behavior

Both boundaries take the same decision before their first destructive effect and refuse with the
same typed error:

| code | meaning |
| --- | --- |
| `workspace_uncommitted_content_retained` | differing paths have no recorded capture |
| `workspace_content_unobservable_retained` | content could not be observed (status failed, or not this repository's checkout while holding entries) |

`WorkspacePreservationError` carries `retained: true` and the observation (`state`, `dir`,
`dirtyPaths`, `generatedPaths`, `generatedRoots`, `headSha`, `baseSha`). Nothing is removed,
released or logged on a refusal: directory, metadata, registration, branch, index, working tree and
owner receipt are byte-identical afterwards (the suite compares
`git status --porcelain=v2 -z --no-renames -uall --ignored=matching` before and after, so an ignored
side effect would be caught too).

**`reap`** order, unchanged apart from the decision: stop latch (`force` overrides only this) →
content decision → removal → registration → branch → metadata → exact absence proof → receipt
release → `worktree.reaped`. `force` never deletes dirty content.

**`reconcile`** order per candidate: owner/receipt/authority classification (foreign and live owners
untouched, as before) → content decision → capacity settlement callback (`beforeOwnerCleanup`) →
removal → absence proof → receipt release. The decision deliberately runs *before* capacity
settlement: a retained checkout still consumes its reservation, so it joins
`retainedExpectedOwners` — which is what keeps the capacity layer from dropping the row — and is
reported in `retainedContentOwners` and a `retained: true` diagnostic carrying the content evidence.
`removedZombieDirs`, `removedPhysicalOwners` and `errors` never mention a retained owner.

Committed-but-uncaptured work on the owner branch is still destroyable: `reap(deleteBranch: true)`
deletes `baton/<ws-…>`, and reconcile's loop-1 postcheck does the same, even when
`headSha !== baseSha`. That is a policy this assignment did not settle; the observation reports both
shas on every decision, so no silent discard is introduced.

## 4. Verification

Command (the deployment contract), working directory `.`:

```
node --test impl/test/workspace-preservation.test.mjs     -> exit 0, 27 tests, 27 pass, 0 fail
```

Scenarios: staged, unstaged, deleted and untracked changes; ignored `.env`, ignored notes directory,
and an ignored file inside an untracked directory; `force` refusal and refusal idempotence; no caller
option (including the removed API names) authorizes destruction, at either boundary; `markStopped` is
not an authorization; clean removal, double reap, exact absence and receipt release;
metadata-attested copied dependency (plain and Git-ignored) and toolchain projection target still
clean up; an un-attested look-alike is retained; an attested 1 500-file tree is not enumerated; a
foreign repository at the owned path and a checkout Git can no longer observe are retained;
dead-owner startup reconcile (dirty retained, ignored-content retained, clean twin removed, capacity
settled only for the removed one, idempotent retry); live foreign controller untouched; empty zombie
directory still removed; the observation interface's absent/clean/identity reports.

Directly affected suites, all re-run against the changed module (all pass, 0 fail):

| suite | result |
| --- | --- |
| `worktree.test.mjs` | 35/35 |
| `phase58-sparse-worker-worktree` + `phase58-sparse-capture-integrity` | 34/34 |
| `phase59-worktree-capacity-authority` | 66/66 |
| `phase92.2-physical-workspace-owner-red` + `issue45-startup-reconcile-red` + `auxiliary-workspace-reconciliation` | 29/29 |
| `phase58-p0-confinement-regressions` + `phase55-toolchain-projection` + `workspace-observation-truth` + `reap-on-terminal-red` | 25/25 |
| `coordinator.test.mjs` + `issue5-cross-controller-lifecycle-recovery` | 67/67 |
| `swarm-runtime` + `swarm-coordination` + `e2e` | 14/14 |
| `phase67-signal-reap` + `phase70-preserved-stop` | 7/7 |

## 5. Integration the facade still owns

The module edge is fixed; the wiring above it is not (other participants own those files, so it is
reported here rather than edited):

1. **Capacity ordering in `index.mjs` `remove(taskId)` (927-970).** It releases or settles capacity
   (948-963) *before* calling `reap` (967), so a refusal at the boundary retains a checkout whose
   reservation row is already gone. The boundary cannot close this from below: with the invented gate
   removed there is no callback left to hang settlement on. The fix is ordering in the facade —
   settle only once the boundary proves removal, or pre-observe with `observeOwnedWorktreeContent`
   and skip settlement for a non-removable resource.
2. **`coordinator.mjs` `_removeOwnedTaskWorktree` (8946-8950)** flattens every cleanup failure into
   `cleanupError: 'worktree_cleanup_failed'`. A `WorkspacePreservationError` is custody state, not a
   generic failure: keep `cleanupPending` and surface its code.
3. **Startup `reconcileStartupResources`** now retains a dead owner's un-captured checkout
   indefinitely. `index.mjs` `reconcile` already feeds `report.retainedExpectedOwners` into
   `worktreeCapacity.reconcile(retained, retainedUnproven)` (1082-1086), so the reservation row
   survives. Capturing that content and *then* reaping is a facade sequence (capture, then reap),
   not a callback this interface offers.
