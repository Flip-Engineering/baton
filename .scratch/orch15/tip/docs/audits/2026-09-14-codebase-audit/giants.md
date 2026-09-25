<!-- Slice report of the 2026-09-14 deep codebase audit. Author: Claude Opus 5 reading agent (audit-giants), dispatched read-only by the root orchestrator (Claude Fable 5.1) at master f2ea904c. The root's synthesis, verification status of each item and the fixes taken are in root.md; this file is the slice report as delivered, unedited. -->

# Baton giants audit — coordinator, coordination store, custody, verification

Slice: `impl/src/coordinator.mjs`, `coordination-store.mjs`, `coordination-internals.mjs`,
`coordination-replay.mjs`, `contribution-service.mjs`, `contribution-verification.mjs`,
`referee.mjs`, `worktree.mjs`, `worktree-capacity.mjs`, `log.mjs`, `process-lifecycle.mjs`.
About 38,800 lines read. Read-only; nothing modified, no tests run.

**Line-number provenance.** `coordinator.mjs` line numbers are pinned against HEAD `f2ea904c`
("Guidance frames name their sender and time (#273, coordinator side)"), which landed while this
audit was in progress and shifted the file by about 15 lines (15,644 -> 15,659). Every other file
in the slice was byte-identical at the start and end of the audit, so their line numbers are
stable. Two findings (18, 19, 29) were verified empirically by running the isolated code.

46 items.

---

## FRICTIONS
*Things an agent or operator must know or do that the code could do for them.*

**1. Drain interaction capacity is uncontrollable and derived from a unit mismatch.**
`normalizeDrainPolicy` (coordinator.mjs:322) accepts only `maxWorkers`, `pollMs`, `timeoutMs` and
rejects any object containing `maxInteractions`. It then derives it:

```js
maxInteractions: Math.min(100_000, value.maxWorkers * 16, Math.max(1, Math.floor(value.timeoutMs / 4))),
```

Milliseconds divided by four becomes a count of interactions. `DEFAULT_DRAIN_POLICY`
(coordinator.mjs:320) separately hardcodes `maxInteractions: 15_000`. The literal and the
derivation agree only at the default `timeoutMs: 60_000` and diverge silently otherwise. The
refusals this bound produces, `coordinator_drain_capacity` at coordinator.mjs:1734 and
coordinator.mjs:2867, name no remedy because there is no field to set.

**2. A drain that trips its deadline at admission latches the fleet shut.**
coordinator.mjs:1749 sets `this._drainState = 'draining'` on the deadline path, before any physical
drain promise exists. Every later `stopRunTargets` then fails its `_drainState !== 'open'` guard at
coordinator.mjs:1815 and reports `coordinator_closed` — a code that names the wrong condition. The
coordinator is neither closed nor draining; it is stuck in a state no operation can leave.

**3. Terminal resource release is impossible during a drain.**
`releaseTerminalTaskResources` (coordinator.mjs:1986) calls `stopRunTargets` at
coordinator.mjs:2012, which refuses while draining. The policy path that frees a completed task's
worktree, runtime scope and process is unavailable exactly when the fleet is trying to release
worktrees, runtime scopes and processes.

**4. A crashed contribution check permanently poisons its identity, and the remedy is a comment.**
contribution-service.mjs:79 refuses any `(contributionId, checkId)` carrying a
`contribution.check_started` with no verdict:

```js
const error = failure('The prior contribution check did not produce a verdict',
  unavailable?.payload?.code ?? 'contribution_check_unconfirmed');
```

The instruction an agent needs — mint a new `checkId` — appears only in the comment at
contribution-service.mjs:80. The thrown error carries a code, a `verificationAttempt`, and no
`gracefulPath`.

**5. A capacity policy change bricks the ledger with no named remedy.**
worktree-capacity.mjs:301 refuses forever once `state.policyDigest !== this.policy.digest` and any
reservation is live, with `worktree capacity state disagrees with deployment policy`. The refusal
does not name `.baton/capacity/reservations.json`, the file an operator must inspect or clear.

**6. `pinBaseSha` parks operator work in a stash nobody pops, under a name that moves.**
worktree.mjs:1240 runs `git stash push -u` on the main repository and returns
`stashRef: 'stash@{0}'`. That is a moving reference: any later stash makes the returned name point
at a different commit. No code path in the slice ever pops it. The correct identity, the stash
commit sha, is one `git rev-parse stash@{0}` away and is never captured.

**7. Startup failure discards the counts it already had, and archived replay reports no progress.**
coordination-replay.mjs:328 reports `totalEvents: 0, checkpointEvents: 0, replayedEvents: 0` on the
failure path, even when replay got most of the way through. Separately, progress is reported only
inside the tail loop at coordination-replay.mjs:311 (`(offset + 1) % 256 === 0`). The segment loop
at coordination-replay.mjs:283 and the checkpoint loop at coordination-replay.mjs:302 report
nothing, so `replayedEvents` reads 0 for the entire archived prefix.

---

## GAPS
*Missing capabilities or unhandled cases.*

**8. The trust gate does not run during a drain.**
coordinator.mjs:13605 guards the gate:

```js
if (this._drainState === 'open' && handle.status !== 'stopping' && handle.status !== 'dead') {
```

A turn that completes while draining is never verified. Its task stays `working` until the drain
cancels it, and no receipt anywhere says verification was skipped rather than failed.

**9. Verification cleanup failure is recorded and then ignored.**
`verifyContribution` returns `cleanupError` on the success path (contribution-verification.mjs:108).
`contribution-service.mjs:135` builds its receipt from `checked.observedVerdict` and
`checked.attempt` and never reads `checked.cleanupError`. Verify sandboxes that could not be removed
accumulate on disk with only an `attempt.cleanup.state` field to show for it, and nothing reconciles
them.

**10. `runCommand` has no output bound at all.**
referee.mjs:179 pushes every chunk into an unbounded `chunks` array. `runClosedCommand` bounds head
and tail carefully at referee.mjs:227-271 for issue #266. The unbounded path serves legacy string
verifications (referee.mjs:290) plus every coverage command (referee.mjs:360) and every mutation
command (referee.mjs:385). A verifier that prints gigabytes takes the hub's heap with it.

**11. Cancellation does not reach auxiliary verification.**
The coverage run at referee.mjs:360 and the mutation run at referee.mjs:385 are called without
`opts.signal`, unlike the candidate run at referee.mjs:327 and the base run at referee.mjs:347.
Aborting a verification leaves them running to completion in a sandbox the caller believes is done.

**12. One timeout is spent up to four times.**
`const timeoutMs = task.verification.timeoutMs ?? 120000;` (referee.mjs:321) is passed unchanged to
the candidate run, the base run, the coverage run and the mutation run. Worst-case wall time is four
times the pinned timeout, and no caller is told that.

**13. The operational log has no archival.**
`log.mjs` accumulates one JSONL file per worker forever; `Log.workers()` (log.mjs:199) enumerates
the directory. `_replay` (coordinator.mjs:14617) reads every one of them in full on every
construction. The coordination ledger got segment compaction (issue #223, coordination-store.mjs:134);
the operational log got nothing, so startup cost grows without bound in the number of workers ever
spawned.

**14. Segment compaction does not reduce startup work.**
coordination-replay.mjs:283 reads each segment file, verifies its sha256, checks UTF-8 exactness,
splits every line, `JSON.parse`s it and applies it into `store._events`. The archived prefix costs
exactly what the live tail costs. Compaction buys disk layout and an integrity boundary, not startup
time or memory.

**15. `accept()` ignores the `expectExit` threaded into it.**
contribution-service.mjs:138 passes `expectExit: source.brief.verification.expectExit` into the
accept options. referee.mjs:481 destructures only `requireRedGreen`, `requireCoverage`,
`requireMutation`. The parameter is dead; `verdict.passed` already encodes the comparison.

**16. Nothing bounds `turnInFlight`.**
`_armWatchdog` (coordinator.mjs:9645) re-arms indefinitely whenever `handle.turnInFlight === true`:

```js
if (handle.turnInFlight === true) { this._armWatchdog(handle); return; }
```

That is the stated D2 control law and it is defensible, but there is no second bound anywhere. An
adapter that crashes or a code path that fails to clear the flag disarms the stall detector
permanently for that worker.

---

## ERRORS
*Suspected bugs: state that can go wrong, races, silent failures, dead code, comment/code
contradictions. Confidence stated per item.*

**17. `wait()` silently discards worker prose. HIGH confidence.**
`_collectDigest` (coordinator.mjs:13054) records the page high-water mark at coordinator.mjs:13110
(`this._pendingAck.set(workerId, maxSeq)`) and the *next* call acks it (coordinator.mjs:13072).
`wait()`'s loop at coordinator.mjs:13022 continues while
`digest.attention.length === 0 && digest.facts.length === 0`, ignoring `prose` entirely. A poll
iteration that reads only `content.message` events builds a prose array, fails the loop test,
discards the digest, and the following iteration advances the persisted cursor past those events.
Worker messages and `lifecycle.turn_completed` summaries, blockers and open questions vanish
permanently. `Cursor`'s own docstring at log.mjs:216 says dropping an event "could drop a worker's
unanswered question". This is the harness losing data it was built to never lose.

**18. The referee's ENOENT shell fallback is dead and produces a false FAILED verdict. HIGH
confidence, verified empirically.**
referee.mjs:184 handles a direct-exec ENOENT by re-spawning through a shell:

```js
if (usingDirect && err && err.code === 'ENOENT') {
  usingDirect = false; clearTimeout(timer); child = spawnShell(); armTimer(); wire(); return;
}
```

The original child's `close` listener, attached by the first `wire()` at referee.mjs:194, is still
registered. I confirmed by running the isolated case that Node emits `error:ENOENT` and then
`close:-2`, in that order. The stale listener therefore calls `finish(-2)` and settles the promise
before the shell child produces anything. `executionOf` (referee.mjs:295) treats a non-null exit as
`state: 'completed'`, so `passed` is false and `diagnosticCode` is `verification_exit_mismatch` — a
*candidate* failure, not `verification_spawn_unavailable`. Any pinned command whose first token is
absent from the deployment-owned PATH built by `prepareVerificationRuntime` (referee.mjs:37) is
blamed on the worker. `mise exec -- ...`, the documented build command for this operator's other
project, is exactly that shape.

**19. `tokenize` collapses two quoted arguments into one mangled token. HIGH confidence, verified.**
referee.mjs:114 matches against the LAST occurrence of the quote character in the whole command
string: `const lastQuote = command.lastIndexOf(ch);`. Verified output:

```
"npm test -- --grep \"foo\" --reporter \"bar\""
  => ["npm","test","--","--grep","foo\" --reporter \"bar"]
"node --test \"a b\" \"c d\""   => ["node","--test","a b\" \"c d"]
"sh -c 'x' 'y'"                 => ["sh","-c","x' 'y"]
```

The greedy-to-last rule is deliberate for the `node -e "...\"...\""` case described at
referee.mjs:101, but it silently corrupts the far more common two-quoted-argument form. The pinned
verification command then runs something other than what the receipt says it ran, and
`looksLikeSimpleCommand` (referee.mjs:97) routes plenty of real commands down this path because it
only looks for `[|&;<>\`]` and `$(`.

**20. `_performDrain` gates success on workers it never attempts. MEDIUM-HIGH confidence.**
coordinator.mjs:2974 computes the success test over the whole fleet:

```js
const remaining = targets.filter((handle) => this._ownsLocalResources(handle));
const globalRemaining = [...this._workers.values()].filter((handle) => this._ownsLocalResources(handle));
if (remaining.length === 0 && globalRemaining.length === 0 && ...) { ... return receipt; }
await this._beforeDrainDeadline(Promise.all(remaining.map(attempt)), deadline, ...);
```

Only `remaining`, the frozen target set, is ever attempted. Any non-target worker that acquires a
local-resource hold after the target set was computed at coordinator.mjs:1715 blocks the drain
forever. `cleanupAfterVerification` (set by `_cleanupClosedTransport` at coordinator.mjs:9439) is
the easiest way in, since a verification settling mid-drain sets it. `_drainTargetIds` is latched at
coordinator.mjs:1762 and conflict-checked at coordinator.mjs:1720, so retrying with a fresh
idempotency key inherits the same blind spot rather than recomputing.

**21. The drain's terminal throw carries no detail, contradicting its own wrapper's comment. HIGH
confidence.**
coordinator.mjs:3016 throws bare:

```js
throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'),
  { code: 'coordinator_drain_incomplete' });
```

No `detail`, no `waitingOn`, even though `_stopWaitingOn` (coordinator.mjs:2154) exists and is used
on every other deadline path in the same function. `_drainFailure`'s comment at coordinator.mjs:1795
states "so the drain never reports a bare non-convergence"; its `else if (error?.code !== undefined)`
branch then wraps this failure as its own cause, yielding
`detail: { cause: { code: 'coordinator_drain_incomplete', message: '...' } }`. The operator is told
the drain failed because the drain failed.

**22. `stopRunTargets` spins to its deadline on a durable non-terminal task with no handle. HIGH
confidence.**
coordinator.mjs:1847:

```js
const durable = this._coordination.snapshot().tasks.find((task) => (task.reservedWorkerId ?? task.assignee) === workerId);
if (!durable || TERMINAL_TASK_STATUSES.has(durable.status)) dispositions.set(workerId, 'alreadyTerminal');
return;
```

A durable task that exists and is NOT terminal falls through with no disposition and nothing that
could ever change, because there is no in-memory handle to kill. The convergence loop re-attempts
every `pollMs` until the deadline and then reports `coordinator_run_stop_incomplete`. Worse, each
attempt calls `this._coordination.snapshot()`, which deep-clones the entire projection
(coordination-store.mjs:11103).

**23. Dead branch in the `stopRunTargets` success path. HIGH confidence.**
coordinator.mjs:1964 breaks out of the convergence loop when
`processesObserved !== processesClosed`. Reaching that line requires `resourcesReleased`, computed
just above, which already asserts `targets.every(h => ... && (!h.processRef || h.processRef.state === 'closed'))`
over the same `targets` array. The two counts are necessarily equal. The branch can never be taken.

**24. `reapRunScratchpads` is an unbounded synchronous spin that can hang the process. HIGH
confidence.**
coordinator.mjs:12302:

```js
let receipt;
do { receipt = this._coordination.reapRunScratchpads(runId); }
while (receipt.result === 'partial');
```

No deadline, no yield, no progress assertion. The store side (coordination-replay.mjs:1137) does
synchronous `_appendBatch` ledger writes for up to `MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS` (64)
partitions per pass and returns `'partial'` while any remain. A large run stop therefore blocks the
event loop for the whole reap, starving every stop deadline, watchdog timer and adapter callback.
Any store-side condition that returns `'partial'` without deleting entries hangs the process
outright with no timeout and no diagnostic.

**25. A failed spill mint silently truncates attention, contradicting the docstring one line above.
HIGH confidence.**
`_mintAttentionSpill` (coordinator.mjs:4280) ends `catch { return null; }`. `_pendingAttentionPush`
(coordinator.mjs:4296) then does:

```js
const spill = this._mintAttentionSpill(spillItems);
if (spill) { result.push({ kind: 'spill', ... }); }
```

On a null return the overflow items are simply absent from `result`, with no refusal and no
receipt. The docstring at coordinator.mjs:4294 says the projection is "Bounded by the item-count row
(overflow spills, never truncates)". It truncates.

**26. A failed progress preservation cancels the stall reap without a trace. MEDIUM-HIGH
confidence.**
`_expireStallCycle` (coordinator.mjs:9753) sets `cycle.answered = true`, clears the timer, then:

```js
this._preserveProgressBeforeReap(handle, task, null, true)
  .then(() => this._applyWatchdogAction(handle, 'kill'))
  .catch(noop);
```

If preservation rejects, no kill happens, no event is appended, and the cycle is already consumed
(`answered = true`, timer cleared, `stallSeamCycle` still set). The worker stays stalled with
nothing left that can fire. The stall flag remains in `watchdogActions`, so `_armStallCycle` will
only re-arm on a fresh nudge or steer.

**27. Every trust-gate failure is swallowed, including one the gate deliberately rethrows. HIGH
confidence.**
coordinator.mjs:13606 fires the gate as
`Promise.resolve(handle.worktreeReady).then(() => this._runTrustGate(handle, wr)).catch(noop).finally(releaseAuthority)`.
The gate's final statement at coordinator.mjs:14609 is
`if (verificationCleanupError) throw verificationCleanupError;` — an explicit escalation that lands
in the `noop`. So does a poisoned coordination write from `_coordTransition`, an Atlas structural
evidence failure, and any bug inside the 400-line gate. The task is left in whatever state the gate
reached before throwing, with no observable error anywhere. This is the most consequential
`.catch(noop)` in the file: `referee.mjs:1` calls this path "THE TRUST GATE".

**28. A poisoned coordinator turns stop convergence into a deadline spin. MEDIUM confidence.**
`kill()` (coordinator.mjs:8526) throws `this._fatalError` unless `opts.emergency`, `startupAuthority`
or `drainToken` is set. `stopRunTargets` calls `this.kill(workerId, actor)` with no options
(coordinator.mjs:1943) and swallows the throw at coordinator.mjs:1946
(`catch { /* bounded convergence below retries exact physical state */ }`). Under poison this is a
full `timeoutMs` wait ending in `coordinator_run_stop_incomplete`, with the actual fatal cause never
surfaced. `_performDrain`'s `attempt` passes `{ drainToken: this._drainKillToken }`
(coordinator.mjs:2955) and so takes the emergency path. The two stop surfaces behave differently
under the same poison, and only the drain behaves correctly.

**29. `defaultVerificationConcurrency` contradicts its own docstring on two cores. HIGH confidence,
verified.**
referee.mjs:47:

```js
return Math.max(1, Math.floor(cores / Math.max(1, verificationCores)));
```

with `verificationCores = Math.max(1, cores - 1)`. Measured across core counts:

| cores | 1 | 2 | 3 | 4 | 8 | 16 |
|---|---|---|---|---|---|---|
| lanes | 1 | 2 | 1 | 1 | 1 | 1 |

The docstring at referee.mjs:44 says "one, on any machine with two or more cores". A two-core
machine gets two concurrent full suites, which is the exact overcommit issue #269 set out to stop.
The formula also never scales up: a 64-core machine gets one lane, so `advanced.verification.concurrency`
is the only way to use a large host.

**30. A reap that exhausts its attempt count reports a deadline. MEDIUM confidence.**
`reapOwnedProcessGroup` (process-lifecycle.mjs:107) defaults `maxAttempts` to 500. The loop at
process-lifecycle.mjs:115 is `for (let attempts = 0; attempts < maxAttempts && now() <= deadline; ...)`
and the refusal at process-lifecycle.mjs:121 says `reason: 'deadline'` for both exits. An
attempt-exhausted reap is misreported as a timeout, which matters because the caller's recovery
differs. The 500 is also a bare numeric ceiling with no derivation.

**31. `_waveIdOf` returns the oldest binding, not the current one. MEDIUM confidence.**
coordinator.mjs:12467 (and `_waveRoleOf` at coordinator.mjs:12457) scan forward and `return` on the
first `driver.recorded` / `steering.registered` matching the run. A run re-registered under a new
wave resolves to its stale wave, and that value decides at coordinator.mjs:7493 whether two members
may exchange messages at all. `orphans` (coordination-replay.mjs:1213) derives the same class of
fact with last-write-wins (`lastGeneration.set(...)` in a full loop). The codebase disagrees with
itself about how to read current state from an append-only log.

**32. Git is invoked with Node's 1 MB default buffer almost everywhere, and exactly one call knows
better. HIGH confidence.**
`sh` (worktree.mjs:86) and `gitFile` (worktree.mjs:99) set no `maxBuffer`. That covers, among
others: `isClean` at worktree.mjs:104 (`git status --porcelain` on the whole repo),
`trackedPathsAtCommit` at worktree.mjs:953 (`ls-tree -r --name-only -z`), `assertSparseIndexState`
at worktree.mjs:973 (`ls-files -t -z`), and `defaultEstimate` at worktree-capacity.mjs:170
(`ls-tree -r -l -z`). Exactly one call sets a real bound: `maxBuffer: 64 * 1024 * 1024` at
worktree.mjs:1061. The limit was understood in one place and missed in every other. On a repository
of roughly twenty thousand paths these begin throwing ENOBUFS, surfacing as
`worktree_capacity_unavailable` (worktree-capacity.mjs:534) or a cleanup failure, neither of which
names the real cause.

**33. `materialize` derives a label from an id shape and silently mangles it. MEDIUM confidence.**
worktree-capacity.mjs:618:

```js
const verifyLabel = row.resourceId.slice(0, row.resourceId.lastIndexOf(':'));
```

With no colon present `lastIndexOf` is -1 and `slice(0, -1)` drops the final character, producing a
wrong prefix that the `basename(materializedPath).startsWith(`${verifyLabel}-`)` check at
worktree-capacity.mjs:623 then enforces as an identity guard. A control decision taken from an id's
shape, with no validation that the shape holds.

**34. A corrupt cursor file silently replays the whole worker log. MEDIUM confidence.**
log.mjs:229: `catch { this._floor = 0; }`. A truncated or unparseable `.floor` file resets the
at-least-once position to the beginning, and the next `next()` re-serves every event the worker ever
emitted as if new. There is no signal that this happened.

**35. `reconcile` drops this process's own live verify reservations. MEDIUM confidence.**
worktree-capacity.mjs:711:

```js
if (row.kind === 'verify') {
  if (row.ownerId === this.ownerId || !livePid(row.pid)) { removed.push(row.id); return false; }
```

Any `verify` row owned by this authority is removed unconditionally, with no liveness or in-flight
test. A verification running in the same process loses its capacity reservation, after which the
ledger under-counts committed bytes and inodes and a subsequent `reserveMany` can overcommit the
filesystem.

**36. Eight-plus inline copies of one custody predicate. HIGH confidence.**
`isPhysicalWorkspaceId` is imported at coordinator.mjs:45 (from shared-workspace-custody.mjs:27) and
used at coordinator.mjs:2803 and coordinator.mjs:9324. The same test is open-coded as
`/^ws-[a-f0-9]{32}$/u.test(...)` at coordinator.mjs lines 166, 183, 748, 1370, 1422, 1439, 1567,
1633, 3529, 5955, 6075, 6366, 6431, 6482 and 15483. Each gates whether a checkout is a shared
physical workspace and therefore whether cleanup may destroy it (see `_removeOwnedTaskWorktree`,
coordinator.mjs:9324). A format change updates the named helper and leaves fifteen inline copies
enforcing the old shape against live custody decisions.

---

## IMPROVEMENTS
*Concrete, narrow, well-engineered changes. No hardcoded numeric limits as control mechanisms.*

**37. Answer wave closure from the projection the store already maintains.**
`_messagePeers` (coordinator.mjs:7493) answers "is this wave closed" with
`!(this._coordination.eventsView() ?? []).some((event) => event.kind === 'wave.closed' && ...)`.
coordination-store.mjs:12801 already exposes `waveClosure(waveId)`, an O(1) lookup over the
replay-derived `_waveClosures` map (coordination-internals.mjs:32724). Replace the scan with the
lookup. This also removes a duplicated derivation that can drift from the projection.

**38. Stop calling `eventsView()` with no arguments.**
The store's own comment at coordination-store.mjs:8500 names this "the #210 class" and calls the
no-argument form "copies the world"; coordination-store.mjs:8510 confirms it is
`this._events.slice(start, undefined)`. The coordinator does it at 7493, 12457, 12467 and 5697. The
worst is coordinator.mjs:5697, which copies the entire ledger to read one element:

```js
const terminal = durable?.terminalEvent ? this._coordination.eventsView()[durable.terminalEvent - 1] : null;
```

That should be `eventsView(durable.terminalEvent, 1)[0]`. `_messagePeers` pays three of these copies
per peer message, because it calls `_waveIdOf` twice and then scans a third time. Removing or
guarding the zero-argument form would make the store's contract enforceable rather than advisory.

**39. Index the per-worker attention derivations.**
`_derivePendingAttentionItems` (coordinator.mjs:4219), `_knownAttentionIds` (coordinator.mjs:4333)
and `_attentionReceipt` (coordinator.mjs:4355) each call `this._log.read(workerId)`, which slices
the full frozen event vector (log.mjs:166). `_assertAttentionPushServed` (coordinator.mjs:4372)
triggers three of these in one call, because it invokes `_knownAttentionIds` and then
`_pendingAttentionPush`. A per-worker index keyed by event kind, built once and appended to on
`Log.append`, removes the quadratic growth with zero semantic change.

**40. Give `tick()` a cheap fast path.**
coordinator.mjs:1503 runs `_sweepDeadlines` and `_dispatchPass` on every public command.
`_sweepDeadlines` (coordinator.mjs:3101) walks all workers, all `_pending` records and all
`_stopWaiters`; `_dispatchPass` (coordinator.mjs:3049) walks `_taskOrder` and each pending task's
dependency list. With roughly two hundred public methods this is a hidden quadratic in command count
paid on every read as well as every write.

**41. Replace the magic ceilings with derivations, configuration, or notify-only signals.**
Per the repository's own "No Arbitrary Numeric Limits" rule, these are control mechanisms with no
physical derivation and no configurability, and each produces a *refusal* rather than a throttle:

- `ACCEPTANCE_REVOCATION_LIMITS` (coordination-store.mjs:225): `maxStateRows: 1_000_000`,
  `maxTargets: 100_000`, `maxReferences: 1_000_000`, `maxPayloadBytes: 16 MiB`, enforced at
  coordination-store.mjs:7012, 7024, 7032, 7041, 7053, 7069, 7076.
- `MAX_SCRATCHPAD_WORKER_ENTRIES = 128`, `MAX_SCRATCHPAD_SHARED_ENTRIES = 512`,
  `MAX_SCRATCHPAD_SNAPSHOT_REAPS = 256` (coordination-store.mjs:481-484). The reap cap silently
  `shift()`s durable receipts out of the projection at coordination-store.mjs:8062.
- `MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS = 64` (coordination-internals.mjs:60). It exists only so
  the caller can loop to exhaustion, which it does at coordinator.mjs:12302, so it buys nothing but
  the ability to observe `'partial'`.
- `budgetTokens: Math.max(1, Math.min(20_000, Number(task.brief.budget?.tokens ?? 20_000)))`
  (coordinator.mjs:14298) — the same literal used as both default and ceiling in one expression.
- `maxAttempts` default 500 (process-lifecycle.mjs:107), redundant with the deadline beside it.

**42. Make the capacity lock wait asynchronous, or move it off the main thread.**
worktree-capacity.mjs:233 is `Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, ms)`, and the design comment at
worktree-capacity.mjs:32 acknowledges it is "blocking this thread in short slices". Under contention
this freezes the event loop for up to `lockWaitMs`, 5,000 ms by default (worktree-capacity.mjs:37).
The synchronous API shape is the constraint; a promise-returning `reserveMany` would remove the need
for it entirely.

---

## NOVEL INSIGHTS
*Design observations a maintainer would not get from any single file.*

**43. The deadline machinery assumes a responsive event loop that three paths take away.**
Every stop, drain and watchdog bound in `coordinator.mjs` is a `setTimeout` racing an operation:
`_beginStop`'s waiter timer (coordinator.mjs:9700ff), `_beforeDrainDeadline`
(coordinator.mjs:3021), `_armWatchdog` (coordinator.mjs:9645). Three code paths block that loop
synchronously for unbounded or multi-second stretches: the `Atomics.wait` capacity lock
(worktree-capacity.mjs:233), the `do/while` scratchpad reap (coordinator.mjs:12302), and the
whole-ledger `readFileSync` plus per-line parse in `_load` (coordination-replay.mjs:234). A stop
deadline can therefore expire because the loop was blocked, and `_forceStop` (coordinator.mjs:10488)
will record `cleanupError = 'stop_unconfirmed'` and mark the process
`unconfirmed_after_restart` for a child that was perfectly healthy and answering. The harness has no
way to distinguish "the child did not answer" from "we were not listening", and both produce the
same durable receipt. This is the deepest coupling in the slice and it crosses three files that
never reference each other.

**44. `_localResourceOwnership` is the one honest derivation, and the drain uses it globally while
acting locally.**
coordinator.mjs:2124 is genuinely good design: a single named derivation feeds both the boolean
predicate `_ownsLocalResources` and the `waitingOn` rows that `_stopWaitingOn` reports, so a stop
that cannot converge always names the exact hold (`local_resources:cleanupPending`,
`process:unconfirmed_after_restart`, and so on). The drain then applies that predicate to every
worker in the fleet (coordinator.mjs:2974) while only acting on its frozen target set. The quality
of the diagnostic actively hides the convergence bug: the failure will faithfully name a hold on a
worker the drain was never going to touch, so the report reads like a stuck worker rather than a
logic error. Good observability can make a control bug harder to see.

**45. The store defends against full-ledger materialization and the coordinator quietly undoes it.**
coordination-store.mjs:8500 adds `eventCursor()` specifically so delta consumers stop copying the
log, and names the pattern "the loop-starvation furnace". Four coordinator call sites do it anyway,
one of them (`_messagePeers`, coordinator.mjs:7493) inside the per-message delivery path, where it
runs three times per message. The abstraction is correct, documented, and completely unenforced.
The same shape recurs with `isPhysicalWorkspaceId` (item 36): a named, correct helper exists, and
fifteen inline copies of its regex coexist with it. Baton's real weakness here is not missing
abstractions but the absence of any mechanism that makes an existing abstraction the only way to
express a fact.

**46. Seventy-seven silent-catch sites in `coordinator.mjs` encode two very different policies with
one syntax.**
A scan finds 77 occurrences of `.catch(noop)` or a commented bare catch in `coordinator.mjs`, 28 in
`worktree.mjs`, 23 in `coordination-store.mjs`. They divide cleanly in intent but not in form. Most
are genuine best-effort audit writes, and the comment says so: "audit is best-effort"
(coordinator.mjs:7616), "a broken story sink never affects correctness" (coordinator.mjs:1190). But
`.catch(noop)` on `_runTrustGate` (coordinator.mjs:13606), on `_beginStop` at
coordinator.mjs:9690, and on `_cleanupClosedTransport` at coordinator.mjs:13500 discards the outcome
of the operation itself, not an observation about it. There is no typed distinction between "this
failure is observational" and "this failure *was* the operation", so the two are indistinguishable
to a reader, to a grep, and to any future refactor. A named `bestEffort(promise, reason)` helper
would separate them at zero runtime cost and make the dangerous ones countable.

---

## The five I would fix first

**1. The referee's ENOENT fallback (referee.mjs:184) and `tokenize` (referee.mjs:114).**
Both make the trust gate report a *candidate* failure caused by the harness itself. A false failed
verdict is the worst output this system can produce: it is silent, it is durable, and it blames the
worker. Both were verified by running the code, and both fixes are a few lines. Remove the old
child's listeners before re-wiring the shell fallback; tokenize with a scanner that matches the
nearest closing quote and keeps the `-e` payload case as an explicit exception.

**2. `wait()` dropping prose (coordinator.mjs:13011 and 13110).**
Worker messages disappear with no receipt, no error and no way to notice. The persisted cursor is
advanced past content that was collected into an array and then thrown away. Either include `prose`
in the loop's non-empty test or accumulate across poll iterations instead of discarding each page.
The `Cursor` contract at log.mjs:216 already says this must not happen.

**3. `reapRunScratchpads`'s unbounded spin (coordinator.mjs:12302).**
It is the only place in the slice that can hang the entire process with no deadline and no escape,
and it runs during run stop, precisely when every other deadline is also trying to converge. Give it
a deadline, a yield between passes, and a progress assertion so a non-advancing `'partial'` fails
loudly instead of freezing the event loop.

**4. Drain convergence (coordinator.mjs:2974, 3016 and 1847).**
Three defects compound into one bad operator experience. Success is gated on workers that are never
attempted; the terminal throw omits the `waitingOn` that every other path supplies; and a durable
task without a handle spins to the deadline. Together they mean an operator draining a fleet gets a
timeout whose stated cause is itself. Attempt `globalRemaining` rather than only `remaining`, and
route the final throw through `_stopWaitingOn`.

**5. The inline `/^ws-[a-f0-9]{32}$/` copies (coordinator.mjs:166 and fourteen more).**
Highest leverage per line changed in the whole slice. `isPhysicalWorkspaceId` is already imported in
the same file and already used twice. Each inline copy decides whether a checkout is shared and
therefore whether cleanup may delete another holder's work, so drift here destroys data. The
replacement is mechanical, testable, and eliminates an entire class of future failure.

