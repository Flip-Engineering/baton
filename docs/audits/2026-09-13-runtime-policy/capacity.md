# Worktree capacity: cross-process coordination repair

Wave `omp-rpc` (2026-09-13), owned path scope: `impl/src/worktree-capacity.mjs`,
`impl/test/worktree-capacity-contention.test.mjs`, this document.

Two independent defects in one repository's capacity authority are repaired here. Both were
reproduced against the pre-change module before the repair (`§4.1`). Nothing outside the owned
paths was modified; `§1.3` records the cross-layer evidence that was requested.

## 1. Defects and repairs

### 1.1 Ordinary live lock contention was treated as a fatal refusal

Pre-change `_lock` (`impl/src/worktree-capacity.mjs@HEAD:302-351`) published the lock with an
atomic `linkSync` and then, on `EEXIST`:

* classified **any** valid lock whose owner process is alive as fatal —
  `if (!validLockOwner(observed) || livePid(observed.pid)) throw typed('worktree capacity
  reservation lock is busy', 'worktree_capacity_unavailable')` (`:319-321`), and
* classified a held reaper gate the same way (`:308`, `:323-324`), and
* retried at most once (`for (let attempt = 0; attempt < 2; attempt += 1)`, `:305`).

A capacity critical section is short but not instantaneous: it reads and HMAC-verifies the sealed
ledger, observes the filesystem, and rewrites + fsyncs the state. Three independent deployments
opening and reserving in one repository therefore overlapped constantly, and every loser was
refused with `worktree_capacity_unavailable` — indistinguishable, at the caller, from a corrupt or
unknown ledger. That is the startup/drain poisoning this repair removes.

A second, narrower race in the same file: `_ensureRoot` (`:245-255`) tested existence and then
created (`if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })`, `:248`). Two deployments
opening the same fresh repository could both observe "absent", and the loser's raw `EEXIST`
escaped every capacity operation untyped. The repair adopts `EEXIST` exactly as
`loadOrCreateWorktreeCapacityIntegrityKey` already does (`:55-62`), keeping the confinement checks
(regular directory, not a symlink, inside the repository) unchanged.

### 1.2 `reconcile()` settled every verifier, including a live foreign controller's

Pre-change `reconcile` removed verification reservations unconditionally:

```js
if (row.kind === 'verify') { removed.push(row.id); return false; }   // @HEAD:548
```

The production failure path this produces is exact. A controller creating a verification sandbox
(`impl/src/index.mjs:712-731`) reserves, builds the sandbox, then materializes:

```js
capacityReservation = opts.worktreeCapacity.reserve(reservationId, capacityRequest(...));
r = await worktreeMod.freshVerifySandbox(...);
capacityReservation = opts.worktreeCapacity.materialize(capacityReservation, r.dir ?? r.path);
```

A *different* deployment starting up in the same repository reconciles
(`index.mjs:1034-1086`, capacity call at `:1086`). With the pre-change filter, the live
controller's row is deleted between `reserve` and `materialize`, and `materialize` then throws
`capacity materialization reservation is unavailable` (`worktree-capacity.mjs:575`) — the reported
`materialized() failed capacity materialization reservation is unavailable`, which failed a
verification task whose capture had already been safely checkpointed.

Repair — verifiers have no adoption protocol, so a verifier is settled only on proof:

| verifier row | decision | reason |
| --- | --- | --- |
| `ownerId === this.ownerId` | settle | this authority's own verification generation |
| `pid === process.pid` (foreign owner, this process) | settle | this deployment's own process generation (an in-process restart); a live *foreign* controller is never this process |
| `!livePid(pid)` | settle | proven dead foreign owner — capacity is not leaked |
| live pid of another process | **preserve byte-for-byte** | a live foreign controller is mid-verification; settling it strands its `materialize()` |

Preserved rows are reported as `retainedVerifiers` (additive field) so retention is visible rather
than silent. Worker-row semantics, adoption, `settleForCleanup`, and `releaseAbsent` are unchanged.

### 1.3 A vanishing artifact was refused as corruption

The first version of this repair still classified one ordinary race as fatal: `lstat` the artifact,
then `readFileSync` it, and map *any* read failure to `owner record is unreadable`. A lock or gate
that disappears between those two syscalls — a holder releasing, a reaper renaming it away, another
deployment recovering a gate — therefore produced a typed refusal indistinguishable from a corrupt
repository. The pre-change code had the same misclassification in the same window (it folded the
read into `catch { throw typed('worktree capacity reservation lock is busy', ...) }`,
`@HEAD:314-318`), so this is the reported "benign contention is fatal" class, not a regression.

It was found by this wave's own suite when the ten-file regression batch ran its files
concurrently: `worktree capacity reservation lock owner record is unreadable` /
`... reaper gate owner record is unreadable` in WCC1/WCC4. A dedicated reproduction (two
deployments racing to reap one proved-dead lock, four rounds in flight) failed 3 times in 80
rounds; after the repair, 400 rounds (800 deployments) produced zero failures.

Repair: a read-time `ENOENT` means "absent", exactly like the stat-time case — the caller retries
and every branch already handles absence. Only a *readable but unparsable* or non-conforming record
stays a refusal. `_ensureRoot` is likewise wrapped so a vanished or unreadable root directory can
no longer escape the class of typed refusals (a raw `ENOENT` used to escape untyped).

WCC10 pins this deterministically: the fixture patches `readFileSync` so that the first read of the
lock (or the gate) removes the artifact and then fails with `ENOENT`, and asserts the deployment
still reserves, that the race actually fired, and that no residue survives. Reverting only this
branch of the shipped module fails WCC10 and nothing else (§4.1).

### 1.4 Cross-layer evidence for foreign verification paths (requested)

* `impl/src/worktree.mjs:1568-1601` already **retains** every `integrate`/`verify` sandbox:
  `retainSandbox` records `{ code: 'workspace_auxiliary_owner_unproven', kind, authority:
  'unproven', retained: true }` for each entry under both roots, and `report.removedVerifyDirs`
  (`worktree.mjs:1556`) is never populated anywhere in the module (two occurrences: the report
  field and the JSDoc). The physical reconciliation layer does **not** reap a foreign verifier's
  directory.
* `impl/src/index.mjs` touches capacity only with worker ids: `beforeOwnerCleanup: (id) =>
  settleForCleanup('worker:' + id)` (`:1056-1058`) and `worker:<physicalOwnerId>` (`:1073-1081`).
  `settleForCleanup(id)` removes exactly one id, so no `verify:` row can match it.

Conclusion: the unconditional verify branch in capacity `reconcile` was the only foreign-verifier
reaping in the repository. No change is required in `worktree.mjs` or `index.mjs` for this defect.

## 2. Mechanism, and why it is safe

```
publish  link(lock)             atomic O_EXCL publication; the loser observes the incumbent
wait     live incumbent         bounded by lockWaitMs, then a typed PRE-EFFECT refusal
reap     proved-dead incumbent  only while holding the exclusive reaper gate, and only after
                                re-reading the lock under that gate and proving the same dead
                                generation; a live lock is never stolen or renamed
gate     link(lock.reaper)      serializes reapers; an abandoned gate (dead owner) is recovered
```

**Why waiting is honest.** The public API is synchronous, so contention is absorbed by blocking
this thread in 5 ms slices (`Atomics.wait` on a shared buffer — no CPU spin, no event-loop damage).
The deadline is *real elapsed time* (`Date.now`), never the injectable `now`: drivers pass
`now: opts.now ?? Date.now` (`index.mjs:1225`), and fixtures freeze that clock, so a budget derived
from it could never expire. `lockWaitMs: 0` keeps fail-fast behavior; values are validated
(integer, 0…600000) at construction. There is no retry counter and no throttle: the loop is
deadline-driven and every non-waiting turn makes progress (publish, reap, or re-observe).

**Why the refusal is honest.** A live holder that never releases produces
`worktree_capacity_unavailable` with `lockContention: true`, `holderPid`, and a message naming the
deadline and stating that no capacity effect was applied. `reserve` is refused inside lock
acquisition, before any ledger write, and the existing tests assert the same code, so callers
(dispatch guidance, web 503 mapping) are unaffected. Ambiguous outcomes keep their own distinct
paths: a corrupt or non-conforming record is refused immediately, never waited on, and never
deleted; a failed state update is still `worktree capacity state update failed`.

**Absence is not corruption.** A refusal is only ever drawn from evidence: a bounded private
regular file whose contents cannot be parsed, or a parsed record that does not conform to the
closed owner schema. An artifact that is simply *gone* when read — the stat succeeded but a
release, a reap, or a gate recovery removed it before the read — is absent, and every branch of
the loop already handles absence by retrying. Conflating those two is the third repair (§1.3).

**Why reaping is still safe.** The reaper gate, the under-gate re-read, the generation/owner
equality proof, the dead-pid proof, and the tombstone rename are preserved from the original
protocol. Two changes make them hold under real concurrency:

1. A lock changed under the gate is no longer a fatal "changed during recovery": the turn ends
   without renaming (a lock we did not prove stale is never touched) and the loop re-observes,
   which is what converts a benign race into an ordinary wait. A live replacement is never renamed
   away because the under-gate re-read requires the *same* generation and a dead pid.
2. A published lock is trusted only after re-observation — its exact generation is still at the
   path **and** no live reaper gate exists (`_confirmLock`). A reaper that re-read the lock as
   stale before we published can only be mid-reap while its gate is published (the gate is created
   before the re-read and removed after the rename), so a late rename either meets a live gate
   (we withdraw our own record and retry) or the record is already gone (we do not enter). The
   only way to break gate exclusivity is recovering an *abandoned* gate, and that path is itself
   guarded by the same dead-owner proof with the record re-read immediately before the move.

**Why abandoned-gate recovery is necessary.** The pre-change gate check made a gate published by a
reaper that died mid-reap permanently fatal: every later acquisition saw the gate, failed to
publish, found no lock to attribute, and refused — the repository's capacity authority was bricked
until an operator deleted a file. Recovery restores the invariant (a fresh exclusive gate) instead
of bypassing it.

## 3. API compatibility

* Constructor: new optional `lockWaitMs` (default `5000`); all other options, defaults, and
  validation unchanged. Additive — extra keys were already ignored by callers.
* Errors: codes unchanged (`worktree_capacity_unavailable`, `worktree_capacity_exceeded`).
  `lockContention` / `holderPid` are additive attributes; the contention message is new text.
* `reconcile` return: additive `retainedVerifiers`; `removed` / `adopted` / `active` keep their
  meaning and shape.
* Preserved behavior pinned by the existing suite: corrupt/ambiguous refusal without deletion
  (WC11), dead-generation reap before exact admission (WC15), startup reconciliation and adoption
  (WC7, WC16), wave admission and refusal semantics (WC1–WC9), release/settlement/receipt
  exactness (WC12–WC48).

## 4. Evidence

All commands were run in the assigned worktree `ws-43c6034161252d551cd11917a8665370`.

### 4.1 The new contracts are RED against the pre-change module

The pre-change module was recovered with `git show HEAD:impl/src/worktree-capacity.mjs` into a
scratch tree (with `canonical-order.mjs` beside it) and the new suite was run against it with its
relative module URL resolving to that copy:

```
not ok 1  - WCC1: simultaneous deployments reserve and release through live contention without a refusal
not ok 2  - WCC2: live contention is waited out, and the live holder keeps its lock
not ok 3  - WCC3: a live holder past the deadline refuses pre-effect, untouched and never stolen
not ok 4  - WCC4: concurrent deployments reap one proved-dead holder exactly once and converge
not ok 5  - WCC5: an abandoned reaper gate is recovered, while a corrupt gate still refuses untouched
ok     6  - WCC6: corrupt or ambiguous locks refuse at once without waiting and are never deleted
not ok 7  - WCC7: the lock wait deadline is explicit, bounded, and configurable to fail fast
not ok 8  - WCC8: reconcile preserves a live foreign verifier and its materialize still succeeds
not ok 9  - WCC9: reconcile still settles owned and proved-dead verifiers
not ok 10 - WCC10: an artifact that vanishes between stat and read is a race, not corruption
# pass 1 / fail 9
```

WCC6 stays green on both sides by design: it pins the *preserved* fail-closed refusal of corrupt
artifacts. WCC9's pre-change failure is the missing `retainedVerifiers` report (its settlement
assertions already held). Every other failure is the repaired behavior itself.

The vanishing-artifact contract is also specific: taking the *shipped* module and reverting only
the read-time `ENOENT` branch (leaving every other repair in place) fails WCC10 and nothing else,
so the determinism is proof of that branch rather than of the batch's timing luck:

```
ok     1  - WCC1 ...          (passes: the concurrency cases are load-dependent)
ok     4  - WCC4 ...
not ok 10 - WCC10: an artifact that vanishes between stat and read is a race, not corruption
```

### 4.2 New suite and the existing authority suite

```
node --test impl/test/worktree-capacity-contention.test.mjs
  # tests 10 / pass 10 / fail 0   (3.9 s)

node --test impl/test/phase59-worktree-capacity-authority.test.mjs
  # tests 66 / pass 66 / fail 0   (20.2 s)
```

The contention suite drives real child processes through a filesystem barrier; each child holds the
critical section open with an injected `observe` that blocks on `Atomics.wait`, so overlap is real
rather than simulated. WCC8 runs a live foreign controller in one process and a *new deployment's*
`reconcile` in another, then asserts the controller's own `materialize()` still succeeds — the
exact reported failure. WCC9 kills a verifier process and asserts its row is still settled.

### 4.3 Wider regression comparison (before vs after)

`impl/` was copied to a scratch tree and only `src/worktree-capacity.mjs` reverted to HEAD, then
the same ten suites were run in both trees:

```
impl/test/worktree-capacity-initialization.test.mjs
impl/test/worktree-capacity-contention.test.mjs
impl/test/capacity-refusal-visibility-red.test.mjs
impl/test/worktree.test.mjs
impl/test/phase92.2-physical-workspace-owner-red.test.mjs
impl/test/frame-economics-red.test.mjs
impl/test/phase78-deployment-capacity-red.test.mjs
impl/test/issue5-cross-controller-lifecycle-recovery.test.mjs
impl/test/phase62-goal-plan-replay-reds.test.mjs
impl/test/prescriptive-doctor-red.test.mjs
```

Result: identical failure sets before and after. The only failures are three pre-existing
`phase78-deployment-capacity-red` rows (DC1, DC2, DC4) failing with
`route_credentials_unprojected` from `application-deployment.mjs:1283` (`assertRouteReady`), a
provider-credential readiness gate raised before any capacity effect; they fail identically at
HEAD, and DC3 (the capacity-seam row) passes in both trees.

The batch was then repeated three times against the shipped module (the runs execute their files
concurrently, which is the load that exposed §1.3): each run reported exactly the same 16
pre-existing failures and **zero** contention-suite failures, so the repaired contracts are stable
under the concurrency the suite gate actually applies.

### 4.4 Deployment verification

```
node --test impl/test/worktree-capacity-contention.test.mjs impl/test/phase59-worktree-capacity-authority.test.mjs
  # tests 76 / pass 76 / fail 0 / cancelled 0
exit 0
```

## 5. Remaining limits (recorded, not hidden)

1. **Same-UID advisory coordination, not a hostile-process boundary.** Unchanged from the phase 59
   authority's own honesty statement: the lock is a same-owner file protocol, not a kernel
   mandatory lock.
2. **In-process multi-authority settlement.** The only cross-process ownership signal on a row is
   `pid`. A second authority *in the same process* is therefore not distinguishable from a
   superseded generation, so its verifier rows are settled (pinned by WC16, which simulates a
   restart in-process). A live foreign controller in a *different* process is preserved — the
   reported production shape. If in-process multi-controller verification becomes real, the row
   needs a controller-generation field and this rule must be narrowed.
3. **pid reuse after a crash.** A crashed foreign verifier whose pid was reused by an unrelated
   live process stays preserved (capacity not reclaimed automatically). This is the conservative
   side of the reported bug; the escape hatches are `settleForCleanup(id)` / `releaseAbsent(id)`,
   and the row is visible in `snapshot()` with its preserved owner. There is no time-based
   staleness rule by design: a wall-clock grace window would be the weakest possible proof and
   would reintroduce exactly the race this repair removes.
4. **The single residual coordination window.** Gate recovery can, in principle, displace a *live*
   gate if the recovering process is descheduled between its re-read and its rename while another
   process publishes a new gate. The gate is re-read immediately before the move and a live owner
   is never displaced, so harm additionally requires: a reaper descheduled across another
   deployment's publish-and-verify, and the reaper completing its post-rename cleanup (two
   directory fsyncs plus an unlink — the gate is removed *after* the rename) inside that window.
   This is strictly narrower than the poisoning it replaces, which was certain rather than
   improbable. Closing it completely needs an atomic compare-and-unlink that POSIX name-based
   locking does not offer.
5. **Latency trade.** Under contention a caller now waits up to `lockWaitMs` (default 5 s) instead
   of failing immediately, and the 5 ms poll slice adds up to 5 ms of release latency. That is the
   intended trade for three deployments sharing one repository.
6. **No deployment-level knob yet.** `lockWaitMs` exists on the authority constructor; surfacing
   it through the deployment options (`impl/src/index.mjs`, outside this scope) would let
   operators tune it. The default is used by every driver today.
