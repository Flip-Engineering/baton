# Worktree capacity: independent audit and repair of the cross-process coordination patch

Wave `omp-rpc` (2026-09-13). This audit reviewed the snapshot at commit `37e0476`
(`ws-43c6034161252d551cd11917a8665370`), which had already made ordinary contention waitable, and
repaired four defects in it, in place, inside the owned path scope:
`impl/src/worktree-capacity.mjs`, `impl/test/worktree-capacity-contention.test.mjs`, this document.
The repair is deliberately conservative where POSIX offers no safe primitive; the one limitation
that cannot be closed with name-based file operations is stated precisely in §1.1 and §5.2.

## 1. Findings and repairs

### 1.1 Abandoned-gate "recovery" could steal a live gate (root finding 1)

The reviewed commit's `_recoverAbandonedGate` observed a reaper gate whose owner pid is dead and
then renamed the gate path unconditionally. The observation and the rename are not one atomic
step, and the rename carries no proof of what it moves. Interleave two contenders A and B on one
abandoned gate:

1. A observes the gate (dead owner) and is descheduled.
2. B observes the same dead gate, renames it away, and publishes its own fresh live gate.
3. A resumes; its `renameSync` — unconditional — takes **B's live gate**, and A publishes its own.

Both A and B now act as the exclusive reaper. Two concurrent reapers can each tombstone the lock,
and a lock published after the other's proof is read can be renamed away — two lock holders, the
exact exclusion the gate exists to enforce. A "re-read immediately before the move" narrows the
window but cannot close it: the rename itself remains proof-free. And restoring on mismatch is not
an escape — the restore is the same unconditional rename and can clobber a gate published in the
meantime.

There is no conditional removal primitive on POSIX paths (no compare-and-unlink; `rename`/`link`
are not compare-and-swap), so this repair follows the conservative ruling for this wave: the unsafe
recovery is deleted, and an abandoned gate is **never touched**. What a dead gate actually does:

* It is **inert** — a gate's record names its creator's pid; nothing ever acts under a gate whose
  owner is dead. `_confirmLock` already treats a non-live gate as absent, so fresh acquisition
  (publish + confirm) is unaffected: reservations, materializations, and releases keep working.
* It blocks only **reclamation of a dead lock**, because reaping requires the gate. `_acquire`
  waits (bounded by `lockWaitMs`) and then refuses pre-effect with a message naming the dead gate
  and its pid: `a dead reaper gate (pid N) blocks reclamation of the dead holder (pid M)`. The
  refusal is precise and the artifact is left byte-for-byte intact (WCC5).
* An operator removes the gate file (the refusal names it and its dead pid); the next deployment
  reaps the dead lock and proceeds. WCC5 pins both the wedge and the one-file repair.

A gate whose pid was reused by an unrelated live process looks live and produces the ordinary
bounded deadline refusal — the conservative side of the same pid-liveness limitation every lock
row already has (§5.3).

### 1.2 The wait deadline covered only the live-holder path (root finding 2)

The reviewed `_acquire` derived its deadline from `Date.now()` and consulted it only where a live
holder (or live gate) was waited on. A deployment that kept observing absent-or-replaced lock
state — publish loses a race, observe, publish loses again — looped without ever consulting the
deadline. Repair: the deadline is monotonic (`performance.now()`), and the loop is shaped so every
turn returns, throws, or reaches `_waitSlice`, which refuses the moment the deadline passes. No
observed state — live holder, live gate, dead lock under a dead gate, churn — can extend the loop
past `lockWaitMs`. WCC3 bounds the live-holder refusal; the loop-shape invariant is enforced by
construction and stated at the loop head.

### 1.3 `MAX_LOCK_WAIT_MS = 600_000` was arbitrary (root finding 3)

The 10-minute ceiling imitated a platform limit that does not exist: the wait always sleeps in
`LOCK_POLL_MS` (5 ms) slices regardless of the deadline, so a large deadline costs nothing extra.
The constant and the upper-bound check are removed; `lockWaitMs` is validated as a non-negative
safe integer of milliseconds, defaulting to 5 000. Operators who want fail-fast pass `0` (WCC7);
operators who want long grace set what their deployment requires. This is a small visible change:
values above 600 000 previously threw at construction and are now accepted.

### 1.4 `reconcile()` treated a shared pid as ownership (root finding 4)

The reviewed verify-settle clause was:

```js
if (row.ownerId === this.ownerId || row.pid === process.pid || !livePid(row.pid))  // settle
```

`row.pid === process.pid` settled a foreign-owner verifier merely because it lives in this
process — but several deployments can live in one Node process, and settling a live foreign
controller's verifier strands it between `reserve()` and `materialize()`, the original production
failure. Ownership is now exact identity:

| verifier row | decision |
| --- | --- |
| `ownerId === this.ownerId` | settle — this authority's own generation |
| `!livePid(pid)` | settle — owner process proven gone; capacity is not leaked |
| live pid of another process, or a foreign same-process generation nobody claimed | **preserve byte-for-byte**, reported in `retainedVerifiers` |
| foreign live generation whose active worker this reconcile adopts | retain — worker adoption does not prove verification closure |

The last row is the one narrow exception, and it is a declaration, not an inference from pid:
adopting a foreign generation's active worker (`activeWorkerIds`) already rewrites that row to
this authority — the caller has claimed the workload of that generation. Its same-process
verifiers then settle in the same reconcile. This is what the phase 59 restart contract (WC16)
has always meant; the reviewed commit had implemented it as the blanket pid clause, which is the
misclassification removed here. WCC11 pins both faces: same-pid foreign verifier preserved under
`reconcile([])`, settled once its generation's worker is adopted.

**Worker-side audit for the same misconception:** none found. Worker adoption is by caller
declaration of active ids, dead-foreign reclamation requires a `livePid` proof, and a foreign
same-process worker row is already preserved (WC23 pins exactly that). `adoptWorker(id)` and
`settleForCleanup(id)` are explicit authority calls keyed by id; they carry no pid reasoning.

### 1.5 Simplification (root finding 5)

The reviewed patch was retained only where it earns its place. The lock protocol now fits one
screen of code with one banner comment carrying the safety argument: `_recoverAbandonedGate` is
deleted outright, `_waitForHolder` and the special-case paths collapse into `_waitSlice`, `_reap`
reports progress instead of needing recovery, and the reconcile filter lost its redundant kind
re-checks. Line counts, reviewed commit → this repair: source 748 → 750 (recovery machinery
replaced by the deadline/gate-refusal paths and their safety comments), tests 547 → 596 (every
preserved case kept, the recovered-gate case replaced by the wedge+heal pair, same-pid identity
added), this document 303 → ~170.

## 2. Mechanism, and why it is safe

```
publish  link(lock)         atomic O_EXCL; the loser observes the incumbent, never overwrites
wait     live incumbent     bounded by lockWaitMs of monotonic elapsed time, then a typed
                            PRE-EFFECT refusal: no reservation or release was applied
reap     dead incumbent     only under the exclusive reaper gate, and only after re-reading the
                            lock under that gate and proving the same dead generation
gate     link(lock.reaper)  serializes reapers; a gate whose owner died is inert but is never
                            recovered: reclamation behind it refuses at the deadline until an
                            operator removes the file the refusal names
```

* **Waiting is honest.** The public API is synchronous, so contention blocks this thread in 5 ms
  `Atomics.wait` slices (no CPU spin, no event-loop damage). The deadline is real elapsed time on
  the monotonic clock — never the injectable domain `now`, which fixtures freeze. Every
  non-progress turn passes through `_waitSlice`; there is no retry counter and no unbounded path.
* **The refusal is honest.** Deadline refusals carry `lockContention: true`, a message stating
  that no capacity effect was applied, and the specific obstacle: `holderPid` for a live holder or
  live reaper, `gatePid` for a dead gate. Ambiguous artifacts (directory, symlink, permissive
  mode, oversized, malformed, unknown schema) refuse immediately, never waited on, never deleted.
* **Reaping is safe.** Gate exclusivity, the under-gate re-read with generation/owner/dead-pid
  proof, and the tombstone rename are the original protocol's, unchanged — that is what makes the
  §1.1 refusal an acceptable trade instead of a shortcut.
* **Absence is not corruption.** A read-time `ENOENT` (artifact vanished between stat and read —
  a release, a reap, a race) is absence; the caller retries. Only readable-but-unparsable or
  non-conforming records refuse as corruption. WCC10 sabotages the read to fire the race
  deterministically.

## 3. API compatibility

* State: unchanged — same ledger JSON, same closed reservation schema, same HMAC seal. No
  migration, no new dependencies; Node ≥ 20 only (`performance` is used via `node:perf_hooks`).
* Constructor: `lockWaitMs` (optional, default 5 000) keeps its meaning; the undocumented
  600 000 ceiling is gone (§1.3). All other options unchanged.
* Errors: codes unchanged (`worktree_capacity_unavailable`, `worktree_capacity_exceeded`);
  `lockContention` / `holderPid` additive as before, `gatePid` additive, message text extended.
* `reconcile`: returns the same shape with additive `retainedVerifiers`; settlement semantics
  narrowed exactly as described in §1.4 — the defect under repair.
* Preserved behavior pinned by the existing suite: corrupt state and ownerless live lock fail
  closed (WC11), dead-generation reap before admission (WC15), restart adoption (WC16), dead
  foreign reclamation without stealing live foreign capacity (WC23), wave admission and release
  exactness (WC1–WC14, WC17–WC48).

## 4. Evidence

All commands run in the assigned worktree, direct `node --test` runs.

### 4.1 The deployment verification command

```
node --test impl/test/worktree-capacity-contention.test.mjs impl/test/phase59-worktree-capacity-authority.test.mjs
  # tests 77 / pass 77 / fail 0 / cancelled 0
exit 0
```

The contention suite drives real child processes through a filesystem barrier; each child holds
the critical section across real syscalls with an injected `observe` blocking on `Atomics.wait`,
so overlap is real rather than simulated.

### 4.2 The new contracts are RED against the reviewed commit

The reviewed module (`git show 37e0476:impl/src/worktree-capacity.mjs`, with
`canonical-order.mjs` beside it) was run against the repaired suite in a scratch tree:

```
ok   1  WCC1 ... WCC4, WCC6, WCC8-WCC10   (preserved contracts stay green)
not ok 5  WCC5: an abandoned reaper gate is never stolen; ... (reviewed code steals/recovers)
not ok 7  WCC7: the lock wait deadline is explicit ...  (reviewed code caps at 600 000)
not ok 11 WCC11: a verifier is settled by exact owner identity ... (reviewed code settles on pid)
# pass 8 / fail 3 — exactly the three repairs, nothing else moved
```

### 4.3 Focused regressions beyond the verification command

```
worktree-capacity-initialization + capacity-refusal-visibility-red + issue5-cross-controller:
  # tests 22 / pass 22 / fail 0
worktree.test.mjs:
  # tests 35 / pass 35 / fail 0
```

## 5. Remaining limits (recorded, not hidden)

1. **Same-UID advisory coordination, not a hostile-process boundary** — unchanged from the phase 59
   authority's own statement: this is a file protocol among trusted deployments on one machine.
2. **An abandoned gate wedges dead-lock reclamation until an operator acts.** This is the
   deliberate trade of §1.1: POSIX offers no conditional name removal, every automatic "recovery"
   tried so far steals live authority, and the refusal names the exact file and dead pid so the
   operator action is one `rm`. Fresh acquisition is never wedged by a dead gate.
3. **pid reuse.** A dead lock/gate owner whose pid an unrelated process reused looks live and
   yields the bounded deadline refusal; a dead verifier row with a reused pid stays preserved
   (capacity not reclaimed automatically). Escape hatches: `settleForCleanup(id)` /
   `releaseAbsent(id)`, and every row is visible in `snapshot()` with its owner. No wall-clock
   staleness rule by design — a grace window would be the weakest possible proof.
4. **In-process supersession requires a declaration.** Two deployments in one process are
   distinguished by `ownerId`; adopting a worker does not settle that owner's other live verifiers
   exactly when its worker is adopted, otherwise preserved (WCC11). A process exit settles them
   via the dead-pid proof.
5. **Latency trade.** Under contention a caller waits up to `lockWaitMs` (default 5 s) instead of
   failing immediately, and the 5 ms slice adds up to 5 ms of release latency. `lockWaitMs` is a
   constructor option with no artificial ceiling; the default serves every current driver.
