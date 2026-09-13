# Shared workspaces for living swarms — design and code audit

Audit date: 2026-09-13. Subject: the current living-swarm implementation in the repository root
checkout `/Users/wahargis/Development/Experiments/baton` (branch `agent/swarm-runtime-foundation`,
HEAD `536b91a5`) **including its uncommitted working-tree state** — the swarm modules
(`impl/src/swarm-runtime.mjs`, `impl/src/swarm-state.mjs`, `impl/src/swarm-contract.mjs`,
`impl/src/swarm-surface.mjs`, `impl/src/swarm-client.mjs`) are untracked or modified there, so the
audited revision is pinned by content digest rather than by commit alone:

| File | sha256 (`git hash-object`) |
| --- | --- |
| `impl/src/coordinator.mjs` | `a9dabd72214b592fa6ecc3ddd67e3d69fc078371` |
| `impl/src/index.mjs` | `72480bed6acd172d8fdb67e908d988b6a4cf546b` |
| `impl/src/worktree.mjs` | `a6be74e2bfa42da5dc03d4cfd35d33a857befa7b` |
| `impl/src/worktree-capacity.mjs` | `e9e9e26254e1c81bed71ad042a446094827a9036` |
| `impl/src/contribution-verification.mjs` | `ca0e447a58f138afe841b8564569ec058b3f7d50` |
| `impl/src/coordination-store.mjs` | `4be84fa110ccd4398d1c51ed6e16f8bf898b3cb3` |
| `impl/src/swarm-runtime.mjs` | `ae9ef8bb3a0b55d2778aa3c76d52091eb1be6ea7` |
| `impl/src/swarm-state.mjs` | `46942d58f91e4f04b35457049da2d4021905ce12` |
| `impl/src/swarm-contract.mjs` | `eba146df6ee5be61c75dd1f1cce64c3142e1f4f5` |

Direction documents read first: [swarm runtime](../../39-swarm-runtime.md) ("Private worktrees, a
group-owned workspace, scoped shared editing, and mediated patches are different strategies with
different guarantees"; "Preserve the user's branch, index, and unrelated edits") and
[runtime review](../../40-runtime-review-2026-09-12.md) ("Private worktrees are a useful choice, not
the definition of collaboration. Shared group editing needs attributed ownership and conflict
handling"). Everything below is sourced from the tree at the pinned digests; every claim carries
`file:line`. Line numbers are as of that revision and are given with the symbol name so they survive
drift. No source file was modified by this audit.

**Scope answered here:** what the runtime actually does today when two agents are meant to work in
one checkout — worktree create/adopt/preserve/reap, physical workspace-owner identity, session
custody, capacity reservation, run/task lifetimes — and the minimal production integration that
makes intentional sharing safe, reusing the existing durable coordination log and the existing exact
resource-owner identity rather than adding a second journal or a policy layer.

---

## 1. Executive summary

**How: the runtime has exactly one custody chain, and it is single-holder end to end.**

| Layer | Single-holder artifact | Where |
| --- | --- | --- |
| Physical workspace | one opaque owner id `ws-<32hex>`, one branch `baton/<ws-…>`, one checkout `.baton/wt/<ws-…>` | `worktree.mjs:671-720`, receipt fields `worktree.mjs:324-328` |
| Owner receipt | one `controller {pid,pidStart}`, one `runId`, one `attemptId`, one `logicalTaskId`, `state ∈ {allocated,ready,stopped}` | `worktree.mjs:323-353` |
| Capacity | one reservation id `worker:<ws-…>` per checkout, one token `{id,ownerId,nonce}` | `index.mjs:294-302`, `index.mjs:399-401`, `worktree-capacity.mjs:564-571` |
| Session custody | one `handle.sessionContext` pointing at that one checkout | `coordinator.mjs:3581-3597` |
| Removal | one cleanup capability (`handle.ownedWorktreeAuthority`) that any terminal path may exercise | `coordinator.mjs:8886-8956` |
| Presence in the swarm | none — `SwarmRuntime` has no workspace/share/attach verb at all | `swarm-runtime.mjs:8-20`, `swarm-runtime.mjs:183-320` |

So "two participants sharing a checkout" cannot be expressed today. The tempting shortcut — point
two workers' `cwd` at one `.baton/wt/<ws-…>` — is unsafe for a precise reason: **every reap funnel
consults the receipt's *allocating controller*, never a peer's interest in the directory.** The
receipt records the controller that allocated the owner (`worktree.mjs:695-710`), and reconciliation
deletes a worker checkout whose controller is dead and which the caller did not list as expected
(`worktree.mjs:1684-1694`, `worktree.mjs:1793-1816`). A second worker standing in that directory
contributes nothing to that decision, and a second worker's terminal cleanup reaps by owner id alone
(`coordinator.mjs:8810-8811` → `index.mjs:927-970` → `worktree.mjs:1499-1541`).

**The gap is representational, not architectural.** The pieces needed already exist in the right
places: a sealed, cross-deployment receipt in the shared `.git` (`worktree.mjs:277-310`), a durable
idempotent append lane over one coordination log (`coordination-store.mjs:13960-13984`), a fold that
rebuilds living domain state from that same log (`swarm-state.mjs:11-23`, `swarm-state.mjs:164-263`),
and an exact resource-owner identity that already survives restart and foreign controllers
(`worktree.mjs:585-599`). What is missing is *(a)* a **holder set** on the resource that every
removal funnel must consult, *(b)* a **dirty-checkout guard** so uncommitted work cannot be deleted
by a path that never captured it, and *(c)* **two agent-visible verbs** — share and attach — that
mint holder authority instead of silently reusing one owner's capability.

**Five findings drive the design** (§3 has the evidence):

- **F1** Correct restart reconciliation deletes un-captured dirty checkouts of non-expected dead
  owners — no capture step exists on that path (`worktree.mjs:1793-1816`; the preserve-before-reap
  fail-safe is coordinator-side and conditional, `coordinator.mjs:8932-8937`).
- **F2** A forced `reap` has no dirty guard; preservation before it is a *coordinator* convention,
  not a reap invariant (`worktree.mjs:1505-1514`, `index.mjs:967-969`).
- **F3** `attemptId` is passed the worker id (`coordinator.mjs:3563`), so the receipt field that
  decides response-loss recovery is not an attempt identity (`worktree.mjs:601-668`).
- **F4** Capacity settlement can delete another controller's reservation by id alone
  (`worktree-capacity.mjs:670-683`), which is safe only while one id has one holder.
- **F5** Capture is `git add -A` over the whole checkout (`worktree.mjs:1208-1233`), so in a shared
  checkout a capture silently absorbs every peer's in-progress edits into one attributed commit.

**Recommendation.** Keep the physical owner as the *resource*; add **holders** to its receipt as a
versioned, sealed extension; make the three removal funnels (reap, reconcile, coordinator cleanup)
holder-aware and dirty-aware; put the *decisions and attributions* in the existing coordination log
as swarm events; expose `swarm.share` / `swarm.attach` / `swarm.detach` on the existing closed
command contract. No new journal, no universal workspace graph, no lock on ordinary conversation, no
coordinator singleton, no worker cap. §5 gives exact functions and anchors; §10 gives a five-step
order in which each step is independently landable and testable.

---

## 2. Trace

### 2.1 Physical workspace-owner identity

Layout and authority roots: everything a worker owns lives under `<repoRoot>/.baton/` —
`.baton/wt/<owner>` for the worker checkout and `<owner>.meta.json` / `<owner>.projection.exclude`
beside it, `.baton/verify/<label>-<suffix>` and `.baton/integrate/` for disposable sandboxes
(`worktree.mjs:9-11`, `worktree.mjs:96`, `worktree.mjs:142-152`, `worktree.mjs:1401-1403`).

The custody receipt is the durable identity, and it lives in the **shared common Git directory**,
not in the checkout and not in one deployment's log directory:

- `workspaceOwnerRoot()` = `<git-common-dir>/baton/workspace-owners`, mode-checked and symlink
  refused (`worktree.mjs:277-305`); receipt path `<physicalOwnerId>.json` (`worktree.mjs:307-310`).
- Field set is closed and strictly validated (`worktree.mjs:324-351`):
  `attemptId, baseSha, branch, controller{pid,pidStart}, controllerId, createdAt, deploymentId,
  logicalTaskId, physicalOwnerId, processGeneration, receiptDigest, runId, schemaVersion(=1), state,
  worktree`, with `physicalOwnerId = ws-[a-f0-9]{32}`, `branch = baton/<physicalOwnerId>`,
  `worktree = <repoRoot>/.baton/wt/<physicalOwnerId>`, `state ∈ {allocated, ready, stopped}`.
- Publication is failure-atomic and recoverable: exclusive `link` publication with directory fsync,
  temp receipts named `<owner>.json.tmp-*`, and a recovery pass that adopts exactly one matching
  publication and refuses ambiguity (`worktree.mjs:424-445`, `worktree.mjs:529-574`).
- Allocation refuses before any Git effect: the base must be an exact commit, and
  `allocatePhysicalWorkspaceOwner` validates the binding
  `{attemptId, baseSha, logicalTaskId, processGeneration, runId}` and the authority
  `{controllerId, deploymentId, pid, pidStart}` (`worktree.mjs:671-686`).
- Authority identity is minted per **writer process**, not per deployment install:
  `deploymentId = digest({repoId, logDir})`, `controllerId = digest({deploymentId,
  writerLeaseToken})`, `pid`/`pidStart` from the coordination writer lease
  (`index.mjs:1349-1356`), and that lease is exclusive per `(repoId, logDir)`
  (`coordination-store.mjs:1339-1389`).

Liveness classification is the hinge for every destructive decision (`worktree.mjs:585-599`):

```
same deployment, same controller      -> 'current'
same deployment, other controller     -> 'local_dead'      (no pid probe)
other deployment, pid alive + start matches -> 'live_foreign'
other deployment, pid alive + start differs -> 'dead_foreign'
other deployment, pid gone            -> 'dead_foreign'
pid probe indeterminate               -> 'ambiguous_foreign'
```

The `local_dead` short-circuit is sound **only** because the coordination writer lease makes exactly
one live writer per `(repoId, logDir)`: a same-deployment, different-controller receipt is
necessarily a previous process generation. Note the corollary for shared workspaces: a holder in a
*different* deployment is classified by pid+pidStart of the receipt's controller, so a holder set
must carry per-holder controller identity or the classification cannot speak about holders at all.

Absence of the resource has three separate implementations, all ending in the same test:
`physicalWorkspaceOwnerCleanupAbsent` (`worktree.mjs:736-752`), the no-receipt branch of
`releasePhysicalWorkspaceOwner` (`worktree.mjs:758-766`), and the postcheck inside `reap`
(`worktree.mjs:1527-1537`) — each re-derives "receipt gone, directory gone, registration gone,
branch gone".

### 2.2 Create, adopt, preserve, reap

**Create.** `createFromBase(repoRoot, taskId, baseSha, opts)` (`worktree.mjs:1076-1181`) is the only
creation path, and the value it is handed as `taskId` **is the physical owner id**
(`worktree.mjs:1077` validates it with `normalizePhysicalOwnerId`). With
`opts.ownerReceipt` supplied by the capacity-transaction wrapper, creation is one outer transaction:
the receipt must be durable and in `allocated` (`worktree.mjs:1080-1091`), and on any failure the
caller — not the callee — owns the exact reap, because "the capacity authority must settle before
any checkout, branch, administration, metadata, or receipt is removed"
(`worktree.mjs:1166-1178`). On success the receipt moves `allocated → ready`
(`worktree.mjs:1155`) and the branch/sha/owner receipt are logged as `worktree.created`.

The wrapper that owns that transaction is `worktreeManager()` in `index.mjs:256-1100`: it mints the
physical owner (`index.mjs:294-302`), reserves capacity against the owner id
(`index.mjs:399-401`, `index.mjs:614-616`), creates the checkout, materializes the reservation
(`index.mjs:637-639`), and returns the handle the coordinator stores as `sessionContext`
(`index.mjs:641-650`).

**Adopt.** There is no adoption verb for a *peer*. Adoption exists only as restart recovery of
one's own resource: `recoverWorkspaceOwnerPublication` adopts a matching in-flight publication
(`worktree.mjs:529-574`), `expectedWorkspaceOwnerBindingCode` proves a replayed handle's binding
against a receipt (`worktree.mjs:601-668`), `_restoreRecoveredPhysicalWorkspaceAuthority`
re-establishes it after restart (`coordinator.mjs:3231-3239`), and `_recoveryDispatchRefusal`
refuses dispatch while `workspaceOwnerBindingValid` is not true (`coordinator.mjs:1606-1608`).
Session resume is the one production path that takes an *externally supplied* owner context: it
requires `session.context.worktree` and `ownerTaskId` (`coordinator.mjs:4568-4570`) and validates the
receipt, branch, base and path (`index.mjs:971-1003`). That path is the natural transport for
attach, and it is already gated on exact receipt agreement.

**Preserve.** Preservation is a coordinator convention with a durable receipt, not a worktree-module
invariant: `_preserveProgressBeforeReap` captures the checkout, pins
`refs/baton/checkpoints/<sha>`, and records `worktree.progress_checkpointed`; a capture that yields
the base sha records `worktree.progress_unchanged` instead; any failure records
`worktree.progress_preservation_failed` and *retains* the checkout
(`coordinator.mjs:8814-8884`). Contribution capture is a different path with the same effect and a
different trigger: `captureContribution` (`coordinator.mjs:2248-2282`) requires a paused turn, stops
reaping while it runs (`handle.contributionCapturePending`, honoured at `coordinator.mjs:8888-8890`
and `coordinator.mjs:2271-2279`), and never ends the session.

**Reap.** Two destructive funnels:

1. `remove(taskId)` in the capacity wrapper releases capacity first, then calls
   `reap(repoRoot, taskId, { force: true, deleteBranch: true })` (`index.mjs:927-970`), which is
   reached from `_removeTaskWorktree` (`coordinator.mjs:8808-8812`) after the coordinator's
   preserve-before-reap step. `reap` removes the directory (`git worktree remove --force`, else
   `rm -rf`), the exact registration, the metadata and projection files, optionally the branch, and
   then requires an exactly absent post-state before releasing the receipt
   (`worktree.mjs:1499-1541`). The only non-`force` guard is `meta.stoppedAt`, written by
   `markStopped` (`worktree.mjs:1479-1486`).
2. `reconcile(repoRoot, expectedActiveTaskIds, opts)` (`worktree.mjs:1553-1964`), run at controller
   start (`coordinator.mjs:1336-1402`) and at drain (`coordinator.mjs:2784`). It **always retains**
   integration and verification sandboxes with `workspace_auxiliary_owner_unproven`
   (`worktree.mjs:1568-1601`), retains expected owners and foreign/live/ambiguous receipts
   (`worktree.mjs:1684-1694`, `worktree.mjs:1727-1767`), and removes everything else whose owner
   authority resolves to `local_dead` or `dead_foreign` **after** the capacity settlement callback
   (`worktree.mjs:1768-1792`, `worktree.mjs:1793-1816`). A second loop handles receipt-only residue
   with the same authority test (`worktree.mjs:1827-1923`).

The removal itself is unconditional with respect to working-tree content: `git worktree remove
--force` followed by `rmSync(..., { recursive: true, force: true })` (`worktree.mjs:1795-1799`,
`worktree.mjs:1512-1513`), and the branch is deleted where present
(`worktree.mjs:1804-1807`).

### 2.3 Session custody

A dispatched worker's custody is published in one step, once the checkout is confirmed
(`coordinator.mjs:3548-3655`):

- A pre-existing context is reused verbatim when the task already carries one
  (`coordinator.mjs:3548-3559`); otherwise `this._worktrees.create(task.id, …)` mints the owner
  (`coordinator.mjs:3561-3566`) with `attemptId: workerId`.
- The result becomes `task.sessionContext = handle.sessionContext` — an immutable record naming
  `worktree`, `repoRoot`, `baseSha`, `branch`, `sparsePaths`, `ownerTaskId`, `logicalTaskId`,
  `ownerReceiptDigest`, optional `capacityReservation` and `toolchainProjection`
  (`coordinator.mjs:3581-3597`), logged as `worktree.ready` (`coordinator.mjs:3619-3621`).
- `handle.worktreeReady` is the readiness gate consumed by adapters and by the trust gate
  (`coordinator.mjs:3652`, `coordinator.mjs:2552`, `coordinator.mjs:13106`).

Custody is released through exactly one function, `_removeOwnedTaskWorktree(handle, task)`
(`coordinator.mjs:8886-8956`), whose guards are:

- an opaque-owner handle whose binding is not proven refuses to clean up and reports
  `workspace_owner_binding_unproven` with a full authority state
  (`coordinator.mjs:8906-8926`);
- an already-finalized handle short-circuits idempotently (`coordinator.mjs:8892-8905`);
- the un-captured-work fail-safe — capture-or-retain — applies only to handles whose status is
  `dead` or `exited` and whose task is neither `completed` nor `verifying`
  (`coordinator.mjs:8932-8937`);
- after removal the handle is finalized: `worktree = null`,
  `ownedWorktreeAuthority = false`, `physicalWorkspaceCleanupCompleted = true`
  (`coordinator.mjs:8939-8941`).

Callers: run stop (`coordinator.mjs:1802`), kill/close paths (`coordinator.mjs:8201-8235`,
`coordinator.mjs:8351`), closed-transport cleanup after an explicit preservation
(`coordinator.mjs:8958-8976`), terminal release after verification (`coordinator.mjs:14094`),
stop of a `new` session (`coordinator.mjs:4152`), policy cleanup (`coordinator.mjs:9017`), and kill
waiters (`coordinator.mjs:9874-9875`, `coordinator.mjs:9933`).

### 2.4 Capacity reservation

Reservation rows are the capacity truth, and they are keyed by the *resource*, not by a session
(`worktree-capacity.mjs:564-571`): `{id, kind, resourceId, ownerId, nonce, pid, bytes, inodes,
baseSha, outstandingBytes, outstandingInodes, sparseDigest, toolchainProjectionDigest, createdAt,
materializedAt}`. `kind ∈ {worker, verify}` is derived from the id; worker ids are
`worker:<physicalOwnerId>` (`index.mjs:400`, `index.mjs:615`) and verification ids are
`verify:<label>:<seq>` (`index.mjs:713`, `index.mjs:734`). `ownerId` is the *authority instance's*
random id and `pid` the process that wrote the row — that pair, with `nonce`, is the release token
(`worktree-capacity.mjs:577-658`).

The mutation API is the one durable, locked lane: `reserve`/`reserveMany` refuse a whole wave before
any effect (`worktree-capacity.mjs:510-575`), `materialize` converts a declared reservation into a
runtime allowance only after the resource really exists and is exactly the id it claims
(`worktree-capacity.mjs:581-633`), `release`/`releaseMany` require the exact token
(`worktree-capacity.mjs:635-658`), `releaseAbsent` drops a row for a resource proven absent
(`worktree-capacity.mjs:660-668`), `settleForCleanup(id)` drops a row by id alone
(`worktree-capacity.mjs:670-683`), `adoptWorker(id)` re-owns a live worker row on restart
(`worktree-capacity.mjs:685-692`), and `reconcile(activeWorkerIds, retainedWorkerIds)` is the only
bulk authority (`worktree-capacity.mjs:694-729`) — it removes this controller's inactive rows and a
proved-dead peer's rows, retains live foreign verifiers, and refuses to touch a retained-unproven
checkout's row.

The coordinator side treats capacity as part of one admission transaction: reservation precedes
checkout, materialization follows it, and every failure funnels into
`finalizeFailedTransaction` which releases capacity *before* the exact reap
(`index.mjs:315-375`, `index.mjs:651-668`).

### 2.5 Run, task, and workspace lifetimes

Four lifetimes are adjacent but not equal:

- **Task**: `pending → working → blocked/input_required/paused → verifying → completed/failed/
  cancelled` with `TERMINAL_TASK_STATUSES` gating cleanup decisions
  (`coordinator.mjs:8932-8935`, `coordinator.mjs:9872`, `coordinator.mjs:1447`).
- **Session**: a continuing participant; `swarm.participant_left` explicitly returns
  `sessionStopped: false` (`swarm-runtime.mjs:243-245`), and recruiting writes the membership
  *before* dispatch (`swarm-runtime.mjs:259-275`).
- **Workspace**: created for a task attempt and released by cleanup — but it can outlive both the
  session that used it and the task that named it, because the receipt, not the task, is the release
  authority (`worktree.mjs:754-782`, `worktree.mjs:1538`).
- **Verification sandbox**: minted from a captured sha, never from a live checkout
  (`contribution-verification.mjs:39-43`, `index.mjs:712-753`), removed via its own confined path
  and its own reservation release (`index.mjs:909-925`).

Verification is already isolated from the author's mutable workspace, and that property must be
treated as an invariant rather than an implementation detail:

- the candidate sandbox is a fresh `git worktree add --detach <sha>` with copied dependencies, never
  a symlink or hardlink into the main checkout (`worktree.mjs:1441-1464`);
- the verifier's toolchain projection must match the worker's (`contribution-verification.mjs:9-15`,
  `contribution-verification.mjs:53`);
- the trust gate captures the worker result separately from the verifier's execution
  (`coordinator.mjs:13787-13791`).

### 2.6 What does not exist

- No share/attach/custody verb: `SWARM_PERMISSIONS` is
  `['read','communicate','contribute','review','organize','recruit','stop']`
  (`swarm-runtime.mjs:8`), the command map is
  `inspect/watch/recruit/guide/capture/check/stop` (`swarm-runtime.mjs:16-20`), and the update-event
  map is `group/work/assignment/context/contribution_recorded/contribution_reviewed/participant_left/closed`
  (`swarm-runtime.mjs:10-15`); the durable domain vocabulary is the eleven kinds in
  `swarm-state.mjs:11-23`, none of which mentions a workspace.
- No holder set anywhere on the resource: the receipt has one controller, one run, one attempt
  (`worktree.mjs:324-328`); the capacity row has one `ownerId`/`pid` (`worktree-capacity.mjs:564-571`).
- No dirty observation in the destructive paths (`reap`, `reconcile`) and no capture on the
  reconcile path (§3 F1, F2).
- No per-holder index or per-holder capture scope: capture is `git add -A` in the checkout
  (`worktree.mjs:1211`).

---

## 3. Findings

Severity: **H** = can destroy or misattribute recoverable work; **M** = wrong state or unenforceable
claim; **L** = representation debt that will cause the next bug.

**F1 (H) — Restart reconciliation destroys un-captured dirty checkouts and their branches.**
`reconcile` removes a worker checkout for a dead owner that the caller did not list as expected:
`git worktree remove --force`, `rmSync(... recursive, force)`, then `git branch -D baton/<id>`
(`worktree.mjs:1793-1816`; the branch-only residue loop at `worktree.mjs:1908`). Nothing on this path
reads the working tree or captures it, and the startup caller composes its expected set from
resumability predicates, not from content (`coordinator.mjs:1437-1468`). The coordinator's
capture-before-reap fail-safe runs *after* reconciliation and only for handles that are `dead` or
`exited` (`coordinator.mjs:8932-8937`), and the startup sweep that terminalizes un-spawned tasks
(`coordinator.mjs:15110-15141`) does not capture either. Consequence: a provider/controller crash
with an uncommitted second participant's edits — or even committed-but-unmerged commits on the
`baton/<ws-…>` branch — can be deleted at the next start without a retained ref. This directly
contradicts the direction documents' preservation rule and the brief's "adopted dirty work never
deleted".

**F2 (H) — `reap` has no dirty guard; preservation is a caller convention.**
`reap` removes the directory with `--force`/`rm -rf` and only requires `meta.stoppedAt` when
`opts.force` is not set (`worktree.mjs:1505-1514`); both production callers pass `force: true`
(`index.mjs:365-367`, `index.mjs:967-969`). The only thing standing between an uncommitted checkout
and deletion is that the coordinator happens to call `_preserveProgressBeforeReap` first on some
paths. A future caller of `worktrees.remove()` — or a new cleanup path — silently inherits delete
authority over uncommitted work.

**F3 (M) — `attemptId` is not an attempt identity.**
`allocationBinding` passes `attemptId: binding?.attemptId ?? \`legacy-${taskId}\``
(`index.mjs:276-280`) and the coordinator supplies `attemptId: workerId`
(`coordinator.mjs:3561-3564`). But `attemptId` is the field recovery matches on to adopt a partial
publication: `receiptMatchesAllocation` compares `attemptId`, `runId`, and `processGeneration`
(`worktree.mjs:399-410`), `expectedWorkspaceOwnerBindingCode` re-checks it against the handle's
receipt and its `ownerBound` (`worktree.mjs:601-668`), and `_removeOwnedTaskWorktree`'s refusal
message keys on the binding. A worker id is stable across process generations, so
"same worker, new attempt" is only distinguished by `processGeneration`; when shared custody starts
being nameable by participants, an identity that cannot distinguish two attempts of one worker is
the wrong authority to build attach on.

**F4 (M) — Capacity settlement can remove a peer's row by id alone.**
`settleForCleanup(id)` filters the reservation list by `id` with no owner/nonce check
(`worktree-capacity.mjs:670-683`), and the cleanup wrapper calls it with
`worker:<physicalOwnerId>` whenever it cannot find its own token (`index.mjs:958-962`,
`index.mjs:1077-1080`). That is defensible while one resource implies one holder that the caller has
already proved absent; with N holders, "I proved *my* holder stopped" must not authorize removing the
resource's reservation.

**F5 (H) — A shared capture silently absorbs peers' work.**
`captureCommit` stages everything (`git add -A`), commits, and reports `changedPaths` from the base
(`worktree.mjs:1208-1243`). In a shared checkout there is one working tree and one index, so a
capture triggered by holder A includes holder B's half-written files, and the resulting
`swarm.contribution_recorded` names A's revision (`swarm-runtime.mjs:283-294`) with the *whole*
checkout's content. The same is true of the pre-reap preservation capture
(`coordinator.mjs:8830-8838`) which can run after A's session ends while B is still editing.

**F6 (M) — Holder liveness cannot be evaluated for a foreign deployment holder.**
`workspaceOwnerAuthorityState` classifies using the *receipt's* controller tuple
(`worktree.mjs:585-599`). A holder set that records only `holderId` would leave a foreign
controller's reconcile unable to decide whether a peer is alive, so its only safe verdict would be
"ambiguous" for the whole resource — retained forever, or worse, deleted if a future reader
conflates the resource owner's death with holder death.

**F7 (M) — Three implementations of resource absence.**
`physicalWorkspaceOwnerCleanupAbsent` (`worktree.mjs:736-752`),
`releasePhysicalWorkspaceOwner`'s no-receipt branch (`worktree.mjs:754-766`), and `reap`'s postcheck
(`worktree.mjs:1527-1537`) each re-derive the same four-way test with slightly different inputs
(receipt presence, directory, registration, branch). Any holder-aware change must be applied three
times, or one of them silently becomes the weak link.

**F8 (L) — "Stopped" is recorded twice, and the two records gate different things.**
`markStopped` writes `meta.stoppedAt` and the receipt's `state: 'stopped'`
(`worktree.mjs:1479-1486`); `reap` gates on the metadata (`worktree.mjs:1508`) while
`expectedWorkspaceOwnerBindingCode` accepts `ready | stopped` (`worktree.mjs:654`). The metadata is
deployment-local (inside the checkout directory tree) while the receipt is cross-deployment; a
restart that loses the directory's metadata but keeps the receipt produces inconsistent stop truth.

**F9 (L) — `taskId` is the physical owner id, everywhere.**
`createFromBase`, `captureCommit`, `markStopped`, `reap`, and `listWorktrees` call their parameter
`taskId` and validate it as a physical owner (`worktree.mjs:1077`, `worktree.mjs:1194`,
`worktree.mjs:1480`, `worktree.mjs:1500`), while the receipt separately carries `logicalTaskId`
(`worktree.mjs:337`). Two audits of this seam will keep mis-scoping work while the identifier is
named wrongly.

**F10 (M) — Verification isolation is real but unguarded by contract.**
The isolation properties listed in §2.5 are enforced by construction in
`verifyContribution`/`createVerifyWorktree`, not by a check that a verifier never receives a
holder's checkout path. Nothing today would refuse `createVerifyWorktree` being handed a live
workspace path by a future caller, and the "mandatory trust/freshness guard"
(`coordinator.mjs:8942-8943`) compares the worker path with sandbox paths as a *historical* string,
not as a custody invariant.

**F11 (L) — No presence of workspaces in the swarm view.**
`SwarmRuntime.inspect` returns participants, caller authority, `availableActions`, `attention`,
`updates`, and a cursor (`swarm-runtime.mjs:120-152`) with no resource section, so an organizer
cannot see which participant holds which checkout, nor can a peer learn that a checkout is occupied
before asking to attach. The `worktree.*` log events exist (`coordinator.mjs:3619`,
`coordinator.mjs:8857`, `worktree.mjs:1540`) but are worker-scoped operational events, not
swarm-domain facts.

**F12 (L) — Idempotency exists for swarm operations but not for custody mutations.**
`_once` gives every effectful swarm command exactly-once semantics with a request digest and an
`...:completed` result record (`swarm-runtime.mjs:85-118`), and `recordSwarm` refuses a key reused
for a different payload (`coordination-store.mjs:13960-13972`). Any new custody verb must ride that
lane; a receipt-side mutation with its own retry would be a second, weaker journal.

---

## 4. What agents choose vs what the runtime must enforce

The brief asks for this distinction explicitly, and it decides how much machinery the design needs.

**Choices the runtime must not arbitrate** (it can only attribute and report them). Two participants
editing one file; a participant reverting a peer's edit; a participant running a formatter over
another's work; a participant committing with a message that misdescribes a peer's change;
a participant choosing to work in the shared checkout while a peer runs a test suite that reads
half-written state; a group deciding that one of them is the writer for a given file. None of these
are preventable by the runtime, none require a lock, and none may cause the runtime to hold a
global barrier or a per-file lock. They are *hazards of a chosen strategy*, and the honest runtime
contribution is evidence: who held the checkout, what was captured, when, by which contribution,
and which revision a check observed.

**Invariants the runtime must enforce** (a violation is a runtime defect, not a user choice):

1. **No deletion while held.** A checkout with at least one live or indeterminate holder is never
   removed by any path (`reap`, `reconcile`, coordinator cleanup, drain, foreign controller).
2. **No silent discard of uncommitted content.** A checkout with content that no capture has
   recorded is removed only after an owner-authorized capture-or-discard decision recorded in the
   durable log; unknown observation (unreadable status, ambiguous receipt) retains.
3. **Last actual holder release.** The resource is released — checkout, branch, registration,
   receipt, capacity row — only after the last holder's custody is gone, and only after the exact
   absence proof that `releasePhysicalWorkspaceOwner` already performs.
4. **Attribution independent of author closure.** A captured contribution is an identified revision
   that survives its author's session ending (`refs/baton/checkpoints/<sha>`,
   `refs/baton/results/<sha>`), and a check is an observation about that revision, never about a
   live checkout.
5. **Verification isolation.** A verifier runs only in a sandbox created from a captured revision;
   no verification reads or writes a holder's checkout.
6. **No capacity fabrication.** N holders on one checkout are one reservation with the same
   declared bytes; attaching and detaching never mints or releases capacity.
7. **Unknown is not permission.** Indeterminate liveness, unreadable receipts, and unobservable
   filesystems never authorize a destructive effect.
8. **Crash/restart truthfulness.** A restarted controller reconstructs custody from the durable
   log and the receipt; it never concludes "the previous controller died, therefore custody of my
   peers is over".
9. **Idempotence.** Replaying an attach/detach/share produces exactly one holder transition per
   request identity.

---

## 5. Design: minimal production integration

### 5.1 Representation: holders on the existing physical owner receipt

The physical owner stays exactly what it is — one opaque `ws-<32hex>` resource with one branch, one
checkout, one capacity reservation, one receipt in the shared `.git`. Sharing is **custody over that
resource**, recorded as a holder set on that receipt, and decided/attributed in the existing
coordination log. No new journal, no new directory layout, no per-holder checkout, no per-holder
capacity row.

```
receipt (schemaVersion 2) = receipt (schemaVersion 1 fields, unchanged)
  + holders: [{
      holderId,            // stable custody identity; the worker id in this deployment
      participantId,       // swarm participant, when the holder is a swarm member (nullable)
      role,                // 'edit' | 'read'  — 'read' holders block discard, not editing
      runId,               // the holder's Run (nullable for a non-swarm holder)
      deploymentId,        // holder's deployment — a foreign reader can classify this holder
      controllerId,        // holder's controller at attach time
      pid, pidStart,       // exact process identity for foreign liveness
      attachedAtSeq,       // coordination seq that authorized this holder (attribution)
      attachedBy,          // actor that attached it ('worker:…' | 'user:…' | 'policy')
    }]
```

Rules that keep this honest and backward-compatible:

- **R1 — Version policy.** `validateWorkspaceOwnerReceipt` accepts `schemaVersion 1` (field set
  exactly as today) and `schemaVersion 2` (v1 fields plus `holders`). The writer emits v1 while the
  holder set is empty or is exactly the allocating controller, and rewrites as v2 only when a second
  holder appears. An older deployment meeting a v2 receipt fails closed through the existing
  invalid-receipt path (`worktree.mjs:355-368`, `worktree.mjs:1835-1848`) — it retains and never
  deletes. That is the desired direction of failure for a shared resource.
- **R2 — Bounded shape.** `holders.length <= 16`, `holderId` validated by `validOwnerText`, roles
  from a closed set, no duplicate `holderId`, at most one holder with the allocating
  `deploymentId`+`controllerId` tuple. `receiptDigest` covers the whole array — no separate seal.
- **R3 — Publication protocol unchanged.** Every holder mutation goes through the same exclusive
  publish-then-confirm path (`writePrivateJson`, `worktree.mjs:189-275`) so partial publication is
  recoverable by the same `recoverWorkspaceOwnerPublication` logic and never leaves a half-written
  receipt.
- **R4 — States.** `state` keeps its meaning as the allocation/publication latch
  (`allocated → ready → stopped`). Holder emptiness is *not* a state; it is a derived predicate, so
  a stopped-but-held receipt is expressible and refuses release.

### 5.2 Exact functions to add or change

**`impl/src/worktree.mjs`**

| Change | Anchor | Detail |
| --- | --- | --- |
| Split authority classification | `workspaceOwnerAuthorityState` `worktree.mjs:585-599` | extract `controllerAuthorityState(identity, authority)` over a `{deploymentId, controllerId, pid, pidStart}` tuple; keep the existing function as a one-line wrapper so all current callers are unchanged |
| Holder read API | new, near `physicalWorkspaceOwnerReceipt` `worktree.mjs:732-734` | `export function workspaceOwnerHolders(repoRoot, physicalOwnerId)` → `{ schemaVersion, physicalOwnerId, receiptDigest, state, holders }` or `null` |
| Holder classification | new | `export function workspaceHolderStates(repoRoot, physicalOwnerId, authority)` → `[{ holder, state }]` using `controllerAuthorityState` |
| Attach | new, after `updateWorkspaceOwnerState` `worktree.mjs:722-730` | `export function attachWorkspaceHolder(repoRoot, physicalOwnerId, holder, opts = {})`: require receipt present and `state === 'ready'`; validate holder shape (R2); idempotent when an identical `holderId` row exists (return the same receipt); refuse `workspace_holder_limit`, `workspace_holder_invalid`, `workspace_owner_not_ready`, `workspace_owner_receipt_absent`; write via the publication protocol |
| Detach | new, beside attach | `export function detachWorkspaceHolder(repoRoot, physicalOwnerId, holderId, opts = {})`: refuse `workspace_holder_unknown`; refuse to detach the last holder unless `opts.allowLast === true` (the last release is `releasePhysicalWorkspaceOwner`) |
| Release guard | `releasePhysicalWorkspaceOwner` `worktree.mjs:754-782` | return `false` when the receipt still names more holders than `opts.releasingHolders ?? []`; `opts.force === true` (reconcile's dead-owner proof) bypasses — the existing absence test stays exactly as it is and remains the final authority |
| Reap guards | `reap` `worktree.mjs:1499-1541` | (a) observe dirtiness with `git status --porcelain` **and** treat an unreadable observation as dirty-unknown; (b) when dirty and `opts.force !== true` → `WorktreeLockedError`; (c) when `opts.force === true` require `opts.discard` describing the authorized discard (`{ reason, evidenceRef }`, where the evidence is a captured ref, a checkpoint sha, or a log event seq) so every forced discard names its evidence; (d) when `opts.holderId` is supplied, detach that holder first and return `{ reaped, remainingHolders }` instead of removing while holders remain |
| Reconcile guards | `reconcile` `worktree.mjs:1553-1964` | (a) before the removal at `worktree.mjs:1793-1816`, compute holder states; retain with a typed diagnostic when any holder is `live_foreign`, `ambiguous_foreign`, `current`, or `local_dead`-but-`dirty`; (b) add `opts.beforeOwnerRemoval(physicalOwnerId, receipt, observation)` — a sibling of the existing `beforeOwnerCleanup` (`worktree.mjs:1777-1782`) — that must return `true` to permit removal and may return `{ capturedRef }`; (c) a dirty checkout with no callback is retained and reported as `workspace_owner_dirty_checkout_retained` (refusal-set); (d) delete the branch only when the removal was authorized and no retained ref names that branch's head |
| Absence consolidation | `worktree.mjs:736-752`, `754-766`, `1527-1537` | one `physicalWorkspaceAbsence(repoRoot, physicalOwnerId, receipt)` returning `{ directory, registration, branch }`; the three call sites become one-line consumers (F7) |
| Naming | `worktree.mjs:1077`, `1194`, `1480`, `1500` | rename the `taskId` parameter to `physicalOwnerId` (pure rename, F9) |

**`impl/src/index.mjs`** (the capacity-transaction wrapper, `worktreeManager` `index.mjs:256-1100`)

| Change | Anchor | Detail |
| --- | --- | --- |
| Custody API | beside `capture` `index.mjs:701-711` | `holders(ownerTaskId)`, `attachHolder(ownerTaskId, holder)`, `detachHolder(ownerTaskId, holderId)` — thin pass-throughs that keep receipts out of the coordinator |
| Removal becomes holder-aware | `remove` `index.mjs:927-970` | accept `{ holderId }`; detach that holder; when holders remain, release nothing, reap nothing, and return `{ removed: false, remainingHolders }`; otherwise keep today's exact order (capacity release → reap) |
| Reconcile wiring | `reconcile` `index.mjs:1034-1099` | forward `opts.beforeOwnerRemoval`; include holder-retained owners in `report.retainedExpectedOwners` so the capacity path does not settle their rows |
| Capacity honesty | `settleForCleanup` call sites `index.mjs:958-962`, `index.mjs:1077-1080` | pass the caller's exact token where it exists; keep the id-only settlement only behind a holder-emptiness proof (F4) |
| Attempt identity | `allocationBinding` `index.mjs:276-280`, `allocateOwner` `index.mjs:294-302` | mint a real per-attempt token (`attempt-<digest>` over `{logicalTaskId, runId, processGeneration, workerId, nonce}`) and pass it as `attemptId`; the worker id stays a separate, explicit field if it is needed for display (F3) |

**`impl/src/coordinator.mjs`**

| Change | Anchor | Detail |
| --- | --- | --- |
| Holder identity | beside `workspaceOwnerExpectation` `coordinator.mjs:173-…` | `_holderFor(handle, task)` → the holder row for this worker, carrying `deploymentId/controllerId/pid/pidStart` from `this._ownerAuthority` |
| Attach / detach / share | new public methods beside `captureContribution` `coordinator.mjs:2248-2282` | `shareWorkspace(workerId, { visibility, participants })`, `attachWorkspace(workerId, { physicalOwnerId, role })`, `detachWorkspace(workerId, { physicalOwnerId })`, `workspaceCustody(physicalOwnerId)` — each wrapped in the existing authority-op section so a concurrent stop cannot interleave |
| Removal honours custody | `_removeOwnedTaskWorktree` `coordinator.mjs:8886-8956` | call `remove(ownerTaskId, { holderId: handle.id })`; on `{ removed: false }` do not set `physicalWorkspaceCleanupCompleted`, keep `cleanupPending` true, and append `worktree.release_deferred` with `{ physicalOwnerId, remainingHolders }` |
| Dirty guard at the fail-safe | `coordinator.mjs:8932-8937` | extend `preserveUnaccepted` from "handle is dead/exited" to "the checkout has content no capture has recorded" — the preserve step already refuses to delete on failure (`coordinator.mjs:8869-8882`), so this only widens when it runs |
| Startup truthfulness | `coordinator.mjs:1336-1402`, `coordinator.mjs:1437-1468` | supply `beforeOwnerRemoval` so a non-expected dead owner's dirty checkout is captured to a checkpoint ref before removal; holders are already covered because holder-retained owners land in `report.retainedExpectedOwners` |
| Capture attribution | `_captureTrustWorktree` `coordinator.mjs:2646-2656`, `_preserveProgressBeforeReap` `coordinator.mjs:8830-8838`, `captureContribution` `coordinator.mjs:2248-2282` | one `_captureOwned(handle, task, { reason, holderId })` used by all three, recording `sharedWorkspace` + `holdersAtCapture` when the receipt has more than one holder (F5) |

**`impl/src/swarm-state.mjs`, `impl/src/swarm-contract.mjs`, `impl/src/swarm-runtime.mjs`**

| Change | Anchor | Detail |
| --- | --- | --- |
| Durable events | `SWARM_EVENT_KINDS` `swarm-state.mjs:11-23`, `validateSwarmEvent` `swarm-state.mjs:164-263`, `foldSwarmEvent` `swarm-state.mjs:274-485` | add `swarm.workspace_shared`, `swarm.workspace_attached`, `swarm.workspace_detached`, `swarm.workspace_released` with payloads `{swarmId, workspaceId, physicalOwnerId, participantId, holderId, role, expectedVersion}`; fold into `swarm.workspaces` exactly like `groups`/`assignments` (version CAS, referential checks against `participants`) |
| Command contract | `SWARM_COMMAND_DEFINITIONS` `swarm-contract.mjs:23-90`, arg rules `swarm-contract.mjs:143-202`, `validateSwarmCommand` `swarm-contract.mjs:218-247`, MCP rows `swarm-contract.mjs:254-351` | add `swarm.share`, `swarm.attach`, `swarm.detach` with `idempotencyKey`; identities stay `SAFE_ID`-shaped; no new envelope fields |
| Permissions | `swarm-runtime.mjs:8-20` | `swarm.workspace_shared` → `organize`; `swarm.workspace_attached` / `swarm.workspace_detached` → `contribute`; `swarm.share` → `contribute`; `swarm.attach` → `contribute`; `swarm.detach` → `contribute` (self) or `organize` (other) |
| Runtime effects | `SwarmRuntime.command` `swarm-runtime.mjs:183-320` | each verb resolves the participant → worker (existing `_worker`, `swarm-runtime.mjs:67-75`), performs the custody mutation through the coordinator, then records the event through `_write`/`_once` so replay yields one holder transition (F12) |
| Visibility | `inspect` `swarm-runtime.mjs:120-152` | add a `workspaces` section built from the swarm row plus `coordinator.workspaceCustody(...)` — holders with their liveness state, the checkout path and base sha, and the last captured revision (F11) |

### 5.3 Control flow for the three critical operations

```
attach(participant B to A's checkout)
  swarm.attach ── permission('contribute') ── participant B ── worker B
     ├─ resolve workspace: participant A ── worker A ── sessionContext.ownerTaskId
     ├─ read receipt (worktree.mjs:355)  require state 'ready'
     ├─ holder = {holderId: B.workerId, participantId: B, role, runId, deployment/controller/pid/pidStart}
     ├─ attachWorkspaceHolder(...)  ── publishes receipt v2 (same protocol, atomic)
     ├─ _write('swarm.workspace_attached', …, key = swarm-attach:<hash>)
     └─ return { physicalOwnerId, worktree, baseSha, receiptDigest, holders }
     B's session starts/resumes with session.context = those coordinates
       (coordinator.mjs:4568-4570 requires ownerTaskId; index.mjs:971-1003 validates it)

release(holder B stops; A still holds)
  stop B ── _removeOwnedTaskWorktree(B) ── _preserveProgressBeforeReap(B)   [capture-or-retain]
        ── worktrees.remove(owner, {holderId: B})
             ├─ detachWorkspaceHolder(owner, B)
             ├─ remainingHolders = 1  ──►  { removed: false }
             └─ capacity: untouched; receipt: untouched; branch: untouched
        ── handle.worktree = null, ownedWorktreeAuthority = false,
           physicalWorkspaceCleanupCompleted = false
        ── append 'worktree.release_deferred' {physicalOwnerId, remainingHolders}

release(last holder A stops)
  … same path … remainingHolders = 0
        ── releaseCapacity(token) ── reap(owner, {force, discard:{reason, capturedRef}})
        ── receipt released only after directory + registration + branch absence
        ── append 'worktree.reaped' + 'swarm.workspace_released'
```

### 5.4 What this deliberately does not add

No universal workspace graph (a workspace is a resource with holders, not a node in a global
topology); no fixed roster or coordinator singleton (holders reference runs and participants the
existing log already models); no lock on ordinary conversation or on reads (only the receipt
publication is serialized, as today); no worker cap (admission math is untouched); no new journal
(events ride `recordSwarm`/`recordDrain`-style lanes over the one coordination log,
`coordination-store.mjs:13960-13984`); no per-holder checkouts (that would re-introduce the
isolation the design is explicitly trading away).

---

## 6. Critique: can the existing owner machinery be simplified instead of extended?

Yes — and the simplification should land first, because it is what makes the holder set small enough
to be obviously correct. Concretely:

1. **Delete the duplicate stop record (F8).** `meta.stoppedAt` and `receipt.state === 'stopped'`
   both mean "the owner may be reaped". Keep the receipt (cross-deployment visible, sealed,
   covered by the publication protocol) and let `reap` read it; drop the metadata gate. That removes
   one durable field, one write, and one restart inconsistency, and it means the *same* latch gates
   single-holder and multi-holder release.
2. **Collapse the three absence implementations (F7)** into `physicalWorkspaceAbsence(...)`. Today
   each is a slightly different four-way probe; after the collapse, "the resource is absent" has one
   definition and the holder-emptiness rule has one insertion point.
3. **Rename `taskId` → `physicalOwnerId` (F9)** across `worktree.mjs` and its wrapper. The module
   already carries `logicalTaskId` in the receipt; the double meaning is pure debt and it is exactly
   the confusion that makes "shared task" tempting.
4. **Fold the three capture call sites into one (F5)** `_captureOwned(handle, task, {reason})`. The
   shared-workspace attribution change then exists once, not three times.
5. **Derive holders rather than add a policy layer.** With the receipt carrying holders, the pass/fail
   predicate for every destructive path is one function:
   `resourceRemovable(receipt, absence, holderStates, { authorized })`. Reap, reconcile, and the
   coordinator cleanup call it and nothing else. There is no need for a workspace-policy module, a
   custody service, or a "shared workspace manager" beside the existing owner authority — that is the
   failure mode the swarm direction documents warn against (another universal policy layer that
   every operation must consult).
6. **One thing that must not be simplified away:** the `allocated` state latch and the
   publication-temp adoption path (`worktree.mjs:529-574`, `worktree.mjs:1078-1091`). They are what
   make create-vs-crash distinguishable, and `reconcile`'s "reconcile has already made the stronger
   proof … the allocated-state gate is a publication-path guard only" comment
   (`worktree.mjs:1909-1912`) documents a real asymmetry that a careless refactor would invert.

Net effect: the design adds one field array, three verbs, and one predicate — while *removing* one
duplicate record, two duplicate absence probes, and two duplicate capture wrappers.

---

## 7. Tests

All scenarios follow the existing fixture style of
`impl/test/phase59-worktree-capacity-authority.test.mjs` (real Git, real filesystem, injected
capacity observer, `createDriver` + `MockAdapter`) so they exercise the production wiring rather
than module units. New file: `impl/test/shared-workspace-custody.test.mjs`, plus additions to
phase59 and the pure-fold suite `impl/test/swarm-state.test.mjs`.

| ID | Scenario | Asserts |
| --- | --- | --- |
| SW1 | Two holders on one owner; second detaches | checkout, branch, registration, receipt and the `worker:<ws>` reservation are all unchanged; `remove` returns `{removed:false, remainingHolders:1}`; log has `worktree.release_deferred` and no `worktree.reaped` |
| SW2 | Last holder detaches | exact absent state — directory, registration, `baton/<ws>` branch, receipt file, capacity row — mirroring WC10/WC23 shapes; `worktree.reaped` + `swarm.workspace_released` |
| SW3 | Foreign live sibling holder | a receipt written by a second deployment (distinct `deploymentId`, live `pid`/`pidStart`) with a holder: local `reconcile` retains with `workspace_holder_live_foreign` and never removes; mirror of WC23's "does not steal live foreign capacity" |
| SW4 | Dead owners, dirty adopted checkout, not expected | `reconcile` captures to a checkpoint ref and only then removes, or retains with `workspace_owner_dirty_checkout_retained`; the captured sha resolves afterwards (this is the F1 regression) |
| SW5 | Forced reap without discard evidence | `reap(..., {force:true})` on a dirty checkout refuses `worktree_cleanup_failed`/`WorktreeLockedError` unless `opts.discard` names the capture; the checkout survives (F2 regression) |
| SW6 | Crash/restart custody truth | kill the controller after attach; restart; holder set, holders' liveness classification and the receipt digest are reconstructed; an indeterminate holder does not authorize removal; `workspace_owner_binding_unproven` still gates dispatch |
| SW7 | Verification isolation | with two holders editing, a check creates a sandbox whose realpath differs from the workspace; removing the sandbox leaves the workspace byte-identical (`git status --porcelain` before/after); the check reports the captured sha |
| SW8 | Capacity stability under custody churn | N attach/detach cycles leave `snapshot().reservations` length, `totals` and `outstanding` unchanged; last release drops exactly one row |
| SW9 | Shared capture attribution | two holders, one writer each; a capture by A records `sharedWorkspace: true` and `holdersAtCapture` naming both, and the resulting revision is checkable after A's session stops (extends `impl/test/participant-contributions.test.mjs`) |
| SW10 | Idempotent verbs | replayed `swarm.attach`/`swarm.detach` with one `idempotencyKey` yields one holder transition and one durable event; a conflicting retry refuses `swarm_replay_conflict` (uses `_once`, `swarm-runtime.mjs:85-118`) |
| SW11 | Receipt version compatibility | v1 reader meeting a v2 receipt retains and refuses rather than deleting; `workspaceOwnerHolders` round-trips both versions; publication-temp recovery still adopts exactly one candidate (`impl/test/phase92.2-physical-workspace-owner-red.test.mjs` patterns) |
| SW12 | Fold determinism | replaying a log containing the four new workspace events produces byte-identical `swarmSnapshot` output (extends `impl/test/swarm-state.test.mjs`) |

Every scenario must fail before its change and pass after; the existing suites that pin adjacent
contracts are `impl/test/worktree.test.mjs`, `impl/test/worktree-capacity-initialization.test.mjs`,
`impl/test/worktree-capacity-contention.test.mjs`, `impl/test/workspace-observation-truth.test.mjs`,
`impl/test/phase58-sparse-worker-worktree.test.mjs`, and `impl/test/auxiliary-workspace-reconciliation.test.mjs`.

---

## 8. A coherent SDK agent workflow

The SDK today is a thin facade over the swarm command port: `swarms.create()` / `swarms.open()` give
a `Swarm` handle, every verb validates against the same closed contract, `inspect()` carries the
authoritative `caller` authority and `availableActions`, and handles are coordinates rather than
sessions (`swarm-client.mjs:1-14`, `swarm-client.mjs:52-83`). The workflow below extends that
facade; nothing in it requires an agent to learn a worker id, a fence, or a receipt digest.

```js
// Organizer
const swarm = await swarms.create({ purpose: 'harden the capacity authority' });
await swarm.update({ event: 'swarm.work_updated', workId: 'w-capacity',
  objective: 'audit and repair the capacity wait path' });
await swarm.update({ event: 'swarm.group_updated', groupId: 'g-capacity',
  members: ['auditor', 'author'] });
await swarm.recruit({ participantId: 'auditor', objective: 'audit capacity paths' });
await swarm.recruit({ participantId: 'author',  objective: 'implement the repair' });

// Author opens its checkout to the group. The agent names a participant, never a path.
await swarm.share({ participantId: 'author', visibility: 'swarm' });

// Auditor attaches; the runtime mints holder custody and returns the coordinates to run in.
const ws = await swarm.attach({ participantId: 'author', role: 'edit' });
// ws = { workspaceId, physicalOwnerId, worktree, baseSha, receiptDigest, holders: [...] }
// The SDK passes ws into the next session start (session.context), which is exactly the
// owner-bound resume path the coordinator already validates (coordinator.mjs:4568-4570).

// Work happens; either holder captures an identified revision without ending its turn.
const rev = await swarm.capture({ participantId: 'auditor', contributionId: 'c-17' });
// rev = { sha, snapshotted, changedPaths, baseSha }  — attributed to the shared workspace

// Anyone checks the revision; the sandbox is never the shared checkout.
await swarm.check({ participantId: 'author', contributionId: 'c-17', checkId: 'unit' });

// Leaving the swarm does not release the checkout.
await swarm.update({ event: 'swarm.participant_left', payload: { participantId: 'auditor' } });
// Explicit release of custody (optional; a stopped Run releases it automatically).
await swarm.detach({ participantId: 'author' });
```

Semantics the runtime supplies, and the agent does not have to reason about:

- `share` is an offer recorded durably; it does not move a path or change ownership.
- `attach` refuses unless the target owner's receipt is `ready`, the caller holds `contribute`, the
  target is in the same deployment (`workspace_holder_foreign_deployment` otherwise), and the holder
  limit is not exceeded. Re-attaching the same holder is idempotent.
- A capture is a snapshot of the shared checkout attributed to the workspace with the holders
  recorded; the agent's `contributionId` is the identity, so repeated retries with one key cannot
  duplicate it.
- A check is an observation about a revision. Its cleanup state is reported separately
  (`swarm-runtime.mjs:300-304`), never folded into the verdict.
- `participant_left` and `swarm.stop` mean different things: the first keeps the session and the
  checkout, the second ends the Run and therefore releases custody.

---

## 9. Alternatives and tradeoffs

| Strategy | What it is | Why not (as the primary mechanism) |
| --- | --- | --- |
| **A. Two sessions, one path (naive sharing)** | point both workers' `cwd` at one `.baton/wt/<ws>` | Rejected on the brief's own terms and by the trace: ownership, capacity and cleanup all key on one owner; either participant's stop can reap the checkout (`index.mjs:927-970` → `worktree.mjs:1499-1541`). Acceptable only with the holder set, the dirty guard, and shared-capture attribution — i.e. it is not an alternative to this design, it is a *mode* of it |
| **B. Private worktrees + mediated patches** (today's default) | one checkout per participant, integration through structured merge (`worktree.mjs:1264-1356`) | Keep as the default. It is the only strategy with no concurrent-edit hazard; the design must not weaken it |
| **C. Shared checkout with per-holder index** | one working tree, `GIT_INDEX_FILE` per holder so captures are per-holder | The best middle for real co-editing, and the natural **step 4**: it makes F5 disappear for the staged content while keeping one tree. Costs: `captureCommit`'s `git add -A` (`worktree.mjs:1211`) must stage into the holder's index and commit via `git commit` with `GIT_INDEX_FILE`; `git worktree remove --force` and status observations must name the tree, not the index |
| **D. Per-holder sparse sub-checkout** | each holder materializes its own subdirectory of one owner | Rejected: duplicates bytes and inodes (capacity is already the honest constraint, `worktree-capacity.mjs:166-189`), and sparse identity is a per-owner projection with an exact-match contract (`worktree.mjs:997-1018`) |
| **E. A universal workspace graph / policy engine** | a global model of every workspace, holder and intent, consulted by every operation | Rejected: the direction documents explicitly refuse a universal graph; ordinary conversation and reads would inherit requirements they do not have; and the receipt plus the log already carry the two facts that matter (who may be inside, what was captured) |
| **F. Lock-based exclusive writer** | a mandatory lock per workspace | Rejected as a default. An exclusive writer is a *coordination choice* a group may take; making it universal would forbid the read-only participant, the reviewer reading live edits, and the observer that the swarm model depends on (`docs/39`, "Loose and tight orchestration"). If wanted, it is a holder `role` refinement, not a new mechanism |
| **G. Keep custody only in the coordination log** | holder set as swarm events, no receipt change | Rejected as insufficient: the log is per-deployment (`deploymentId = digest({repoId, logDir})`, `index.mjs:1350`), while the receipt is shared common-Git (`worktree.mjs:277-310`). A *foreign* controller's `reconcile` is the path that must see custody, and it never reads another deployment's log |

Tradeoff accepted explicitly: with a shared checkout the runtime cannot make concurrent edits safe.
It can only make custody, attribution, verification and cleanup truthful. That is exactly the
division the direction documents draw between what the runtime enforces and what participants choose.

---

## 10. Implementation order

Each step is independently landable, testable, and reversible; no step introduces a second journal
or a new durable store. Steps 1–2 are representation and enforcement (no agent surface); step 3
is the agent surface; step 4 is capacity and capture honesty; step 5 is the optional editing
refinement.

1. **Simplify and pin (no behavior change).** F7 absence consolidation, F8 duplicate stop record,
   F9 rename, F5 capture-wrapper fold, plus R1's version-tolerant receipt reader.
   Tests: existing worktree/phase59/observation suites unchanged and green; SW11 for the new reader.
2. **Custody authority and destructive-path guards.** Receipt `holders` (R1–R4);
   `attachWorkspaceHolder`/`detachWorkspaceHolder`/`workspaceOwnerHolders`; release guard;
   `reap` dirty + holder guards; `reconcile` holder-retention and `beforeOwnerRemoval`;
   `physicalWorkspaceAbsence` as the single predicate; coordinator `_holderFor` and
   holder-aware `_removeOwnedTaskWorktree` (`worktree.release_deferred`).
   Tests: SW1–SW6.
3. **Agent surface.** Swarm events in `swarm-state.mjs`, command rows in `swarm-contract.mjs`,
   permission and effect wiring in `swarm-runtime.mjs`, `workspaces` section in `inspect`, SDK verbs
   in `swarm-client.mjs`, surface registration in `swarm-surface.mjs` and
   `mcp-northbound`/CLI rows.
   Tests: SW10, SW12, plus one end-to-end workflow test mirroring §8.
4. **Capacity and capture honesty.** F3 attempt identity; F4 settlement tokens; holder-retained
   owners excluded from capacity settlement and reconciliation adoption
   (`worktree-capacity.mjs:694-729`); shared-capture attribution (F5) and SW9.
5. **Optional: per-holder index** (alternative C) for real editing isolation, gated behind an
   explicit holder `role`/option so the default stays today's behaviour. Tests: SW7 re-run with
   per-holder indexes, plus a two-real-session smoke test.

Landing order matters in one place: step 1 must precede step 2, because the holder guards are only
one predicate if the absence probes and the stop record have already been unified. Steps 3 and 4 are
independent of each other.

---

## 11. Verification performed, and one honest caveat

**What was executed.**

- `node --test impl/test/phase59-worktree-capacity-authority.test.mjs` at the audited revision
  (`/Users/wahargis/Development/Experiments/baton`, HEAD `536b91a5`, digests in the header):
  **66 tests, 66 pass, 0 fail**, exit 0. This is the deployment verification command for this
  assignment.
- The same command in the *dispatched base* worktree
  (`/tmp/baton-swarm-api-20260913/.baton/wt/ws-9dd2d60422b6b209f53f80d5ebe8e24b`, HEAD `f176ab31`,
  which is seven commits behind and does not contain `impl/src/swarm-runtime.mjs` at all):
  **65 pass, 1 fail** — `WC22: trust-gate capacity refusal exposes a bounded typed code without
  capacity internals`, at
  `impl/test/phase59-worktree-capacity-authority.test.mjs:908`, expected `'capture'`, actual
  `'candidate_sandbox'`. The cause is a stale expectation, not a live defect: commit `9e72a153`
  moved verify-worktree creation inside `verifyContribution` and began reporting phases through
  `onPhase` — `contribution-verification.mjs:27` initialises `phase = 'candidate_sandbox'` and
  `contribution-verification.mjs:39` advances to it before the sandbox is created — while the test
  still expected the coordinator's pre-verification default (`coordinator.mjs:13716`,
  `trustPhase = 'capture'`), which is now only observable before `verifyContribution` is entered.
  `536b91a5` corrected the expectation to `'candidate_sandbox'`. So the audited revision is green
  and the dispatched base is red, by one line, for a reason unrelated to this audit. This audit is a
  documentation change and does not affect either result.
- Live custody evidence read from the running wave's own ledger:
  `/private/tmp/baton-swarm-api-20260913/.baton/capacity/reservations.json` holds three
  `worker:ws-…` rows (`ws-859283f6…`, `ws-02234f0a…`, `ws-9dd2d604…`) with distinct
  `ownerId`/`nonce`/`pid` (`37651`, `22491`, `17881`) and one identical `baseSha`
  (`f176ab31a38b657d1f15b9858411e0c87067800c`) — three controllers mutating one repository capacity
  ledger, which is the multi-controller condition §2.4 and §5.2 are written against.

**What was not executed.** No source file was modified; no shared-workspace prototype was built, so
every proposed function is a design target pinned by the anchors above, not measured behaviour. The
per-holder-index alternative (C, step 5) is argued from the code, not prototyped: its cost estimate
for `captureCommit` (`worktree.mjs:1193-1243`) is `[INFERENCE]` from the staging call at
`worktree.mjs:1211` and was not validated against Git's behaviour with a resumed index.
