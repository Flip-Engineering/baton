# Shared-checkout custody — minimal implementation design

2026-09-13. Written by the native swarm participant `shared-custody-review` (swarm
`swarm-dc7eb973c4c9ba1ba7357c91dc36bba0`), which ran in its own Baton worktree and read root
read-only. **All `file:line` citations are root `23a478cb46f858f59a450ad84e49a2ecf028951c`**, the
tree where workspace preservation landed. The assigned worktree base is `a17b5c70`; it does not
contain `worktree.mjs::observeOwnedWorktreeContent` or the preservation-gated reap, so the anchors
cited in §1 and §3 land elsewhere there. Verify every anchor against the tree you edit.

The design answers the last open item of `docs/39-swarm-runtime.md:172-175` and the boundary
recorded in `docs/audits/2026-09-13-runtime-policy/integration.md:84-85`: *group membership alone
must not grant filesystem custody*. It adds one concept (a **holder**) in the smallest available
places, deletes one dead abstraction, and adds no journal, no policy engine, no role ceiling and
no mandatory goal/plan graph.

## 0. What already exists — do not rebuild

Multiple participants can already share one physical checkout; nothing enforces one checkout per
participant. The machinery simply has no membership record and no holder-aware exit:

- **Attachment lane.** `Coordinator` spawn with `session.mode === 'resume'` plus an explicit
  context is an admitted lane, not a recovery-only one: `coordinator.mjs:4681-4694` validates the
  explicit context (`_validateSessionContext`) and refuses only when it is missing
  (`session_context_required`). A resume-mode dispatch sets
  `handle.ownedWorktreeAuthority = false` and borrows the checkout (`coordinator.mjs:3665-3677`,
  `3697`). The `session_already_attached` guard (`coordinator.mjs:4689-4691`) keys on the *native
  session id*, which stays per-participant — so it does not block two participants from naming the
  same checkout in `context`.
- **Context validation.** `worktreeManager.validateSessionContext` (`index.mjs:1009-1071`) already
  checks receipt state `ready`, receipt digest, logical task, branch, base, worktree realpath,
  sparse identity, toolchain projection and the `worker:<physicalOwnerId>` capacity reservation.
  A holder can satisfy all of it by carrying the custodian's `sessionContext` verbatim.
- **Serialized capture per physical checkout** (`worktreeManager.snapshot`, `index.mjs:704-736`)
  plus the isolated-index live snapshot (`workspace-snapshot.mjs:99-194`), which never writes the
  real index, HEAD or refs. This is the only capture a co-holder may use; the paused-turn
  `captureCommit` writes the shared index and branch (`worktree.mjs:1359-1379`, I6).
- **Content-preserving destruction** — `observeOwnedWorktreeContent` (`worktree.mjs:1090-1131`),
  `assertRemovableContent` (`1135-1146`), `reap` (`1652-1699`), `reconcile` (`1720+`). Dirty
  content is retained with a typed refusal; capacity stays reserved for retained checkouts.
- **Reconcile is already fail-closed for co-holders that are both expected.** Two expectations
  naming one physical owner produce `workspace_owner_binding_ambiguous` with `retained: true` and
  no removal (`worktree.mjs:1866-1877`); `workspace-preservation.test.mjs` pins by name that a live
  foreign controller is never touched, dirty or not. The missing protection is the *online* path,
  not reconciliation.
- **Logical membership independent of session/turn/task** — `swarm-state.mjs` folds
  `swarm.participant_joined` / `participant_bound` / `participant_left` and contributions over the
  existing durable coordination log (`coordination-store.mjs:13960-13983`); a participant keeps
  its identity across bindings (`swarm-runtime.mjs:70-78`, `123-166`).

## 1. The gap

1. **No holder record.** Nothing durable says *which participants are working in `ws-…`*.
   `participant_bound` carries only `workerId`/`taskId`/`sessionId` (`swarm-state.mjs:192-198`,
   `327-333`), and the physical owner receipt is deliberately single-controller
   (`worktree.mjs:679-729` — one `runId`/`attemptId`/`processGeneration`, closed field set).
2. **No holder-aware exit.** The custodian's cleanup chain runs
   `_preserveProgressBeforeReap` → `_removeTaskWorktree` → `worktreeManager.remove`
   (`coordinator.mjs:9045-9073`, `8926-8930`; `index.mjs:963-1008`) with no notion of a second live
   holder. `remove` reaps with `force: true` (`index.mjs:987-990`; that latch is inert anyway,
   `worktree.mjs:1662-1664`), settles capacity, and then releases the receipt **ignoring the
   return value** (`index.mjs:1007`). Preservation saves the *content* (dirty checkouts are
   retained, and retention is byte-for-byte proven by `workspace-preservation.test.mjs:164-215`),
   but it cannot save the *resource*: with committed peer edits the whole checkout and branch are
   destroyed, and with dirty peer edits the stopping run's cleanup is blocked by its peer's tree.
   Either way a peer that holds the checkout with `ownedWorktreeAuthority=false` can never clean
   it up afterwards — the guard at `coordinator.mjs:9024-9044` refuses with
   `workspace_owner_binding_unproven`.
3. **No non-destructive detach.** The only outcome meaning "this holder leaves, the checkout
   stays" is a thrown error: `releasePhysicalWorkspaceOwner` refuses while the checkout,
   registration or branch exists (`worktree.mjs:776-783`), and the coordinator flattens a
   retention refusal into `handle.cleanupError = 'worktree_cleanup_failed'`
   (`coordinator.mjs:9064-9068`). A legitimate detach must have a positive representation, not
   read as a cleanup failure.
4. **Dishonest attribution, twice.** A contribution captured from a shared tree records
   `workerId`/`taskId`/`changedPaths` (`contribution-service.mjs:42-53`) where `changedPaths` is
   the whole checkout's diff against the admitted base (`workspace-snapshot.mjs:182-186`).
   The paused-turn path is worse: `captureCommit` runs `git add -A` against the *shared* index and
   `git commit`s on the *shared* branch with `Baton-Task: <physicalOwnerId>`
   (`worktree.mjs:1359-1379`). Rendered as-is, a peer's edits become the capturer's changes.
   `live-snapshots.md:19` already concedes the primitive "does not attribute each edited line to a
   particular agent".

## 2. Model

Three layers, each in its existing home. No layer is duplicated.

| Layer | Authority | Lives in | Changes |
| --- | --- | --- | --- |
| **Custodian** | Git effects on the checkout: branch, path, base, receipt revision, capacity reservation, reap | owner receipt `.baton/workspace-owners/ws-<id>.json` (`worktree.mjs:286-318`), meta + branch + registration | **none** |
| **Holders** | who is working in the checkout, and therefore whether it may be closed | existing coordination log, swarm lane | participant row gains `workspaceId` (E1, E2) |
| **Capacity** | `worker:<physicalOwnerId>` reservation | `worktree-capacity.mjs` | **none** — already per resource, not per participant |

Invariants:

- **I1 — Custody is not authority to delete.** Holding a workspace never grants permission to
  remove it or to release its receipt/reservation.
- **I2 — Detach releases the holder, not the resource.** A holder's stop nulls its local worktree
  authority (so drain and terminal-release see a released handle) while the receipt, branch,
  registration and reservation stay live for the remaining holders.
- **I3 — Last holder closes.** Only when no other active holder names the workspace does cleanup
  run, through the *existing* preserve-then-reap chain; the receipt's controller must be provably
  not live-first (`workspaceOwnerAuthorityState`, `worktree.mjs:594-608`).
- **I4 — Preservation is unchanged and prior.** Every existing refusal
  (`workspace_uncommitted_content_retained`, `workspace_content_unobservable_retained`,
  `workspace_owner_binding_changed`) keeps its exact meaning. Custody decides *whether* cleanup
  runs; preservation decides *whether content may be destroyed*.
- **I5 — A shared revision is a checkout observation, not an authorship claim.**
- **I6 — A shared checkout is captured live, never committed.** Participants sharing a checkout use
  `worktreeManager.snapshot` (isolated index, no refs) exclusively; `captureCommit` writes the
  shared index and HEAD and is not usable by a co-holder (`worktree.mjs:1359-1379`).
- **I7 — One refusal code per reason.** "Another holder is live" must be distinguishable from
  "unrecorded content"; custody refusals get their own code so detach is never reported as
  `worktree_cleanup_failed`.

## 3. Exact edits

**E1 — `impl/src/swarm-contract.mjs`: `workspaceId` on recruit.**
`SWARM_COMMAND_ARGUMENTS['swarm.recruit'].optional` (`:182-185`) gains `'workspaceId'`, and the
matching registry row's `args` (`:23-90`) must gain it too — the boot check at `:204-211` throws
if the two disagree. Field rule: `/^ws-[a-f0-9]{32}$/u` (`SAFE_ID` at `:120` already admits the
spelling; the explicit rule keeps the meaning).

**E2 — `impl/src/swarm-state.mjs`: the holder record.**
`validateSwarmEvent` `swarm.participant_joined` (`:181-191`) accepts optional `workspaceId`
(same regex); `foldSwarmEvent` (`:312-317`) stores `workspaceId: p.workspaceId ?? null` on the
participant row. Add one pure query next to `swarmSnapshot` (`:529`):
`swarmWorkspaceHolders(swarm, workspaceId, { excludeRunId })` → active participants whose
`workspaceId` matches. This is the single source of "who is in this checkout" for both the
runtime's inspect and the coordinator's cleanup gate. Putting it on `participant_joined` rather
than on `participant_bound` matches the existing invariant that membership precedes dispatch
(`swarm-runtime.mjs:281-287`), so a holder is durable before its first native turn.

**E3 — `impl/src/swarm-runtime.mjs`: recruit into a checkout.**
In `swarm.recruit` (`:270-297`), when `args.workspaceId` is present: resolve the physical owner
receipt (`physicalWorkspaceOwnerReceipt`), refuse with a typed `swarm_workspace_unavailable`
unless it exists and `state === 'ready'`; carry `workspaceId` into the `swarm.participant_joined`
write (`:284-287`); and pass the adoption session through `startRun` so the admitted task lands on
the existing resume lane: `{ mode: 'resume', id: <participant's own native session id>, context:
{worktree, repoRoot, baseSha, branch, ownerTaskId, logicalTaskId, ownerReceiptDigest,
capacityReservation, sparsePaths, sparseCheckoutIdentity, toolchainProjection} }` — i.e. the
custodian's session context values (`index.mjs:644-653`) with the holder's own session id. The
recruiter's existing `recruit` grant is the authorization; delegating it already cannot exceed the
caller's own permissions (`swarm-runtime.mjs:275-277`). `startRun` is deployment-injected, so this
step is the one place that needs root's own wiring; everything it must produce is asserted by
T1/T2 below.

**E4a — `impl/src/worktree.mjs`: the holder gate at the one shared pre-effect predicate.**
`assertRemovableContent` (`:1135-1146`) is the only predicate both destructive boundaries consult,
and it is called exactly twice — `reap` before its first effect (`:1667`, removal at `:1669-1672`)
and `reconcile` before its capacity gate and removal (`:1941`). Its contract already gives the
needed shape: on refusal nothing is removed, released or logged (`:1133-1134`).

- Give it the holder set for the owner (an injected provider — see E4b — not a new file) and make
  removability `contentRemovable && noOtherLiveHolder`. On a live co-holder, throw a **distinct**
  typed refusal (e.g. `workspace_other_holder_live_retained`) carrying the holder ids, so detach is
  never confused with unrecorded content (I7).
- Both call sites then do the right thing with no further structural change: `reap` must skip
  removal, skip the receipt release (`:1696`) and skip the `worktree.reaped` log (`:1698`) — a
  detach that keeps the checkout must not log a reap; `reconcile` must add the owner to
  `retainedContentOwners` (mirroring `:1954-1959`) so capacity is not settled for a live resource.
  The secondary receipt-only loop (`:2063-2107`) must consult the same provider before releasing a
  receipt, even though `releasePhysicalWorkspaceOwner` already refuses while the checkout or branch
  exists (`:777-783`).
- Keep the existing `workspaceOwnerAuthorityState` verdict part of the gate: a receipt whose
  controller is live-first is never reaped by a late holder (`:594-608`).

**E4b — `impl/src/coordinator.mjs`: resolve holders, and make detach a positive outcome.**
Add `_workspaceHolders(physicalOwnerId, { excludeRunId })` reading `this._coordination.swarms()`
(`coordination-store.mjs:13983`) through E2's query, and inject it into the manager the same way the
existing `beforeOwnerCleanup` seam is injected (`index.mjs:1091-1097`) — a provider callback, no new
file, no new journal. Then in `_removeOwnedTaskWorktree` (`:9004-9074`):

- **Detach before cleanup.** When the handle's `sessionContext.ownerTaskId` is a `ws-…` id and
  other active holders remain, do not enter the preserve-and-reap chain at all (`:9045-9073`);
  set `handle.worktree = null`, `handle.ownedWorktreeAuthority = false`, leave
  `physicalWorkspaceCleanupCompleted = false`, record `handle.workspaceCleanupDeferred =
  'holders_remain'` (and clear `cleanupError`), and return. The E4a refusal is the backstop if any
  path reaches `remove` anyway. This satisfies the terminal resource-release assertion
  (`:1981-1986`) and the drain predicate (`:2052-2056`) without waiting on a resource still in use.
- **Map the custody refusal to a deferred success, not an error.** `coordinator.mjs:9064-9068`
  currently flattens any retention refusal into `worktree_cleanup_failed`; the new code must land
  in the deferred state instead, so a detach is never reported as a cleanup failure (I7).
- **Admit the last holder.** Relax the `workspace_owner_binding_unproven` refusal (`:9024-9044`)
  when no other active holder names the workspace and the receipt's controller is not live-first;
  the last holder then reaps through `worktreeManager.remove` (`index.mjs:963-1008`), which already
  settles capacity and releases the receipt. `remove` should also stop ignoring
  `releasePhysicalWorkspaceOwner`'s return value (`index.mjs:1007`): a refused release must be
  observable, not silently dropped.
- When the custodian is the last holder, nothing changes: the existing path runs unchanged.

**E5 — honest shared-revision records.**
`_captureTrustWorktree` (`coordinator.mjs:2670-2682`) already threads
`task.sessionContext.ownerTaskId`; pass the workspace coordinates to the receipt built in
`contribution-service.mjs:42-53`, which gains
`workspace: { physicalOwnerId, shared, holderCount }` and `observedHead` (the snapshot's parent —
`workspace-snapshot.mjs:135-137,176-180` observes HEAD and names it in the commit). `shared` is
`holderCount > 1`. The `swarm.contribution_revision_attached` payload
(`swarm-state.mjs:251-258`, `swarm-runtime.mjs:313-316`) gains the same `workspaceId` +
`observedHead` so the swarm record is honest without reading a worker log. `changedPaths` stays
what it is — the checkout's differing paths — but must be *labelled* as such (§4).

Under custody the paused-turn path must additionally refuse: `captureCommit` (`worktree.mjs:1359-1379`)
stages and commits the shared index and branch, so a co-holder reaching it must get a typed refusal
instead of corrupting its peers' staging area (I6, T7). The live snapshot stays the only capture a
holder may use.

**E6 — `impl/src/worktree.mjs`: delete the dead stop latch.**
`markStopped` (`:1630-1637`) has no production caller; the capability matrix already records it as
inert (`docs/handoff/evidence/capability-matrix.json:707`), and both real reap callers pass
`force: true` (`index.mjs:988`, `index.mjs:368-370`). Delete `markStopped`, its
`updateWorkspaceOwnerState(..., 'stopped')` state write, and the `stoppedAt` gate in `reap`
(`:1658-1668`, including the `WorktreeLockedError` throw). Keep `stoppedAt` in the metadata field
list (`:989`, `:996`, `:1296`) so existing `.baton/wt/*.meta.json` files still validate; keep the
`'stopped'` receipt state accepted by `expectedWorkspaceOwnerBindingCode` (`:663`) because
`reconcile` may still meet receipts written by older deployments. Update
`impl/test/worktree.test.mjs:373-380`, which is the latch's only remaining consumer.

## 4. Attribution rule

For a checkout with more than one holder:

- the retained revision is **the checkout's visible state at `observedHead`**, captured by a named
  participant; it is not a statement that the capturer wrote those lines;
- `changedPaths` is **the checkout's** differing-path set against the admitted base, and must be
  rendered with that noun — "the checkout differs in N paths", never "X changed N paths";
- the contribution's identity, author and review records are unchanged
  (`swarm-state.mjs:466-481` keeps author/reviewer integrity);
- a per-author *window* is derivable later without new storage, from the author's previous
  retained ref in the same workspace (`swarm.contributions[*].refs`) via
  `git diff --name-only <previous> <sha>`, and must be labelled a window, not authorship — a peer
  editing the same file still appears in it. Deferred; not needed for correctness of §3.

## 5. Strategy contrast

| Strategy | When | Cost | Guarantees |
| --- | --- | --- | --- |
| **Tight shared editing** (this design) | genuinely joint edit of one working tree: pair/ensemble work, a reviewer steering live edits, a coordinated interface change | shared Git index and working tree; concurrent `git add`/`commit` by participants remains a real hazard (the live snapshot avoids it by using a private index; ordinary agent Git use does not); the paused-turn capture is unavailable (I6); edits are visible to peers immediately | one branch/base; one capacity reservation for N participants; nothing is destroyed while a holder remains; uncommitted peer work is retained, not attributed |
| **Optional separate checkouts** (today's default) | competing implementations, independent slices, anything a participant can finish alone | one `ws-…`, branch and reservation per participant | full isolation of index and working tree; integration only through accepted revisions and retained refs |
| **Persistent reviewers** | review/verification that outlives the author's turn | none beyond a retained ref — `checkContribution` builds a fresh detached sandbox from the pinned sha (`contribution-service.mjs:67-124`) | review never depends on the checkout surviving, and never needs a holder record |

Decision rule: default to separate checkouts; attach only when the participants have deliberately
chosen one working tree and accept a shared index; reviewers prefer retained revisions over
custody. Attaching a reviewer as a holder is legal but buys nothing a pinned sha does not.

## 6. Acceptance tests

New: `impl/test/shared-workspace-custody.test.mjs`, real Git, MockAdapter, one shared
`ws-…` owner, two participants:

- **T1 attach** — participant B recruits with `workspaceId`; B's `task.sessionContext.ownerTaskId`
  equals A's physical owner id, `handle.worktree` equals A's path, exactly one `.baton/wt/ws-*`
  directory and one `worker:<id>` reservation exist, and `worktreeAvailable`/`validateSessionContext`
  report the checkout exact. Attaching to a receipt that is absent, not `ready`, or whose digest
  differs refuses (`swarm_workspace_unavailable`).
- **T2 detach under a live holder** — A stops while B is active: no `worktree.reaped` event, no
  branch deletion, receipt digest unchanged, reservation intact, A's handle released
  (`worktree === null`, `ownedWorktreeAuthority === false`, `physicalWorkspaceCleanupCompleted ===
  false`), `workspaceCleanupDeferred === 'holders_remain'`, drain still completes; B's next write
  lands and `swarm.capture` still pins a revision from the shared path.
- **T3 last-holder close, dirty** — B stops while the checkout holds uncommitted content: the
  existing refusal (`workspace_uncommitted_content_retained`) retains checkout, receipt and
  reservation byte-for-byte, and the content is readable afterwards.
- **T4 last-holder close, clean** — after the dirty path is resolved, the last holder's stop
  removes the checkout exactly once, releases the receipt and settles the reservation exactly once
  (idempotent on retry).
- **T5 attribution** — with a peer's file modified in the shared tree, the contribution receipt
  carries `workspace.shared === true`, `workspace.physicalOwnerId`, and `observedHead` equal to
  the pre-capture HEAD; the swarm revision record carries the same; no record claims the
  peer-modified path as the capturer's exclusive change.
- **T6 live foreign controller** — a checkout whose receipt names a live foreign controller is
  never reaped by a last holder; the refusal and full retention are observed.
- **T7 no paused-turn capture under custody** — a co-holder attempting the paused-turn capture path
  (`captureCommit`) is refused rather than letting it stage and commit the shared index and branch;
  the live snapshot path still succeeds (I6).

Regression set (must stay green, run together with the assigned
`node --test impl/test/phase92.2-physical-workspace-owner-red.test.mjs`):
`impl/test/workspace-preservation.test.mjs`, `impl/test/workspace-observation-truth.test.mjs`,
`impl/test/phase70-preserved-stop.test.mjs`, `impl/test/phase59-worktree-capacity-authority.test.mjs`,
`impl/test/worktree.test.mjs`, `impl/test/swarm-state.test.mjs`, `impl/test/swarm-runtime.test.mjs`,
`impl/test/swarm-native-access.test.mjs`, `impl/test/participant-contributions.test.mjs`.

## 7. Deletions and simplifications

1. `markStopped` + the `stoppedAt` reap latch + its test (E6). Net negative code; the latch's
   stated purpose — "a checkout may not be destroyed merely because a controller died" — is now
   served by observation and preservation, which are the mechanisms actually invoked. (Corroborated
   independently: see §9.)
2. Do **not** extend the owner receipt with a holder list. Its field set is closed and validated
   in four places (`worktree.mjs:334-337`, `384-404`; `coordinator.mjs:154-170`; session-context
   fields in `coordination-store.mjs:3330-3333`); membership belongs in the log, and the receipt
   stays a single-controller Git lease.
3. Do **not** add a `swarm.workspace_attached` event kind. The wire set is closed
   (`swarm-contract.mjs:5-14`) and mirrored in the native bridge; the recruit argument plus one
   optional field on `participant_joined` expresses the same fact for a fraction of the surface.
4. Do **not** build custody takeover/rebinding. Co-holders in one deployment already pass the
   snapshot's receipt check (`index.mjs:713-721` compares `controllerId`/`deploymentId`, which are
   deployment-scoped), and cross-deployment recovery remains `reconcile`'s job. Revisit only if a
   cross-deployment holder is ever admitted.
5. `remove`'s unconditional receipt release (`index.mjs:1007`) stops being fire-and-forget: the
   boolean already returned by `releasePhysicalWorkspaceOwner` must be observed (E4b).

## 8. Non-goals

No mandatory goal/plan graph, no role ceiling, no generic policy engine, no new journal or
registry file, no per-participant capacity reservation, no lock that blocks ordinary agent Git
use, no automatic publication of orphaned work, and no change to the owner receipt schema. Git
index serialization for participants that run ordinary `git add`/`commit` in a shared checkout is
explicitly *not* solved here — the design makes the hazard visible in the strategy choice (§5)
rather than silently pretending isolation.

## 9. Evidence and limits

Read in root: `worktree.mjs`, `index.mjs`, `coordinator.mjs`, `workspace-snapshot.mjs`,
`contribution-service.mjs`, `swarm-state.mjs`, `swarm-runtime.mjs`, `swarm-contract.mjs`,
`coordination-store.mjs` (cited ranges), plus `docs/39-swarm-runtime.md` and the
`2026-09-13-runtime-policy` audits (`workspace-preservation`, `live-snapshots`, `integration`).
Behavioral claims were observed, not assumed: at the worktree base
`node --test impl/test/phase92.2-physical-workspace-owner-red.test.mjs` → exit 0, 16 pass / 0 fail.

**Independent review.** Detach/reap semantics were reviewed read-only by a native subagent
(`DetachReapReview2`, transcript `agent://DetachReapReview2`) while this author reviewed
attachment/adoption. It ran the real suites: the assigned test → exit 0, 16 pass / 0 fail, and
`node --test impl/test/workspace-preservation.test.mjs` → exit 0, 28 pass / 0 fail. It confirms
the scalar receipt shape and the unreachable `stopped` state; it adds the two findings folded in
above — that `remove` releases the receipt ignoring its result (`index.mjs:1007`) and that
`captureCommit` stages and commits the shared index and branch (`worktree.mjs:1359-1379`) — and it
independently located the seam this design now uses (`assertRemovableContent`, called twice, at
`worktree.mjs:1667` and `:1941`). Its own limits: no production stop was exercised end to end
(the `markStopped`/`force` findings are grep-based), and the co-holder topology assumed here is
same-deployment participants, since a second receipt for one checkout is structurally impossible
(`worktree.mjs:344`).

**Limits.** The observation-to-effect window is not closed by this design: `reap` observes content
at `worktree.mjs:1667` and removes at `:1669-1672`; `reconcile` observes at `:1941` and removes at
`:1990-1993` with the capacity round trip in between. With a live co-holder the E4a gate shrinks
that window to the interval between the holder check and the removal, but does not eliminate it —
the design makes reaping *rare* (only the last holder) rather than atomic. Nothing here was tested
against a real two-holder checkout: no such scenario is constructible in the current tree, which
is the point of the design. E3's `startRun` wiring is deployment-injected and therefore root-owned.
