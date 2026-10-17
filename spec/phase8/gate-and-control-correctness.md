# Phase 8 — Gate & Control Correctness (spec)

*Cluster: the correctness repairs. Scope pinned by `docs/22-completeness-audit.md` §3 ("What's PARTIAL/STUB"), §4 (one-shot adapter question, out of scope here — that's the session-adapter cluster), and §6 (ranked gaps #3, #5, #6, #7 — this doc covers exactly those four ranked gaps plus the two audit rows that name them: "`accept()` as sole done-gate", "Fencing / stale-command rejection", "captureCommit vendor attribution", "Two-phase confirmed-stop", "`createDriver()` assembly", "`router.pick()` / adaptive routing").*

*Authority order, per this task: `spec/RECONCILIATION.md` wins over any conflicting cluster spec. Every contract below is checked against RECONCILIATION's D1-D11 and supervisor-state-machine.md's I1-I7 before being written down. Where a contract is a straight compliance fix (the code violates an existing D-decision), that is stated. Where a contract adds something RECONCILIATION doesn't already pin, it is called out as an amendment, explicitly, in its own subsection.*

*Contracts are numbered C1-C7, one per audit-flagged item. Sub-clauses are C1.a, C1.b, etc. Every contract lists: the exact wiring, the RECONCILIATION relationship, the tests that pin it (test names match `test/phase8-correctness.test.mjs`), and — where relevant — existing tests elsewhere in the suite that the contract puts pressure on (named explicitly, not hand-waved).*

---

## C1 — GATE: `referee.accept()` is the single done-gate

### Relationship to RECONCILIATION
**Compliance fix, not an amendment.** D4 already mandates exactly this:

> `task.status = referee.accept(verdict) ? 'completed' : 'failed'   // accept() is the ONLY authority; worker claim ignored`

`coordinator.mjs:768` currently reimplements the boolean inline (`verdict.reverified === true && verdict.observedExit === task.brief.verification.expectExit`) and never calls `accept()` for the gate decision at all (`index.mjs`'s `refereeFn` DOES call `accept(verdict)` at line 50, but **discards the return value** — it's called only for its (nonexistent) side effects). This contract makes the code do what D4 already says.

### Wiring
- `Coordinator` constructor gains two new **optional** dependencies, alongside the existing `referee`:
  - `opts.accept: (verdict, acceptOpts) => boolean` — the sole done-gate function.
  - `opts.acceptOpts: {requireRedGreen?: boolean, requireCoverage?: boolean}` — the driver-level policy passed to every `accept()` call. Default `{}` (both flags default `false`, i.e. off).
- **Default `accept`** (used whenever `opts.accept` is not supplied — this is what keeps every existing `coordinator.test.mjs` fixture behaviorally unchanged, since those fixtures' fake referees return verdicts with `{reverified, observedExit, matchesClaim, locus, note}` and **no `.passed` field**, so wiring the *real* `referee.accept()` as the unconditional default would silently flip them all to `false`):
  ```js
  const defaultAccept = (verdict, acceptOpts) =>
    !!(verdict && verdict.reverified === true && verdict.observedExit === acceptOpts.expectExit);
  ```
  This is **exactly** today's inline check, moved into an injectable, named function — behavior-preserving by construction for every caller that doesn't override it.
- `_runTrustGate` calls:
  ```js
  const acceptOpts = { ...this._acceptOpts, expectExit: task.brief.verification.expectExit };
  const accepted = this._accept(verdict, acceptOpts);
  task.status = accepted ? 'completed' : 'failed';
  ```
  replacing the inline `const accept = !!(verdict && verdict.reverified === true && ...)` computation. **No other code path may set `task.status` to `'completed'`.**
- The logged `verify.reverified` event's payload gains one new field, `acceptOpts`, holding **only the driver-level policy portion** (`{requireRedGreen, requireCoverage}` — not the per-task `expectExit`, which is already visible via `task.brief.verification.expectExit` elsewhere in the log and would be redundant/brittle to assert on): `{ verdict, accept: accepted, acceptOpts: { requireRedGreen: this._acceptOpts.requireRedGreen ?? false, requireCoverage: this._acceptOpts.requireCoverage ?? false } }`.
- `createDriver(opts)` plumbs the **real** `referee.accept` as the coordinator's `accept` dependency, and exposes two new top-level `createDriver` options, `requireRedGreen` and `requireCoverage` (both **default `false`**, i.e. off — preserving current end-to-end behavior for every existing `createDriver`/e2e caller, since the real `referee.verify()` already always populates `.passed`, so `accept(verdict, {requireRedGreen:false, requireCoverage:false})` is exactly equivalent to today's inline check for the real, non-faked referee path):
  ```js
  accept: (verdict, acceptOpts) => accept(verdict, acceptOpts),
  acceptOpts: { requireRedGreen: opts.requireRedGreen ?? false, requireCoverage: opts.requireCoverage ?? false },
  ```

### No arbitrary numeric limits
N/A — this contract introduces no numeric ceiling; `requireRedGreen`/`requireCoverage` are booleans.

### Tests (`test/phase8-correctness.test.mjs`)
- **C1.a** `'C1: requireRedGreen:true fails a verdict that passes the exit-check but never went red->green'` — inject `accept: (v,o)=>accept(v,o)` (real referee.accept) with `acceptOpts:{requireRedGreen:true}`; a fake referee fn returns `{reverified:true, passed:true, observedExit:0, redGreen:false, matchesClaim:true}`. Asserts `task` ends `'failed'` via `coordinator.result()`. **Fails today** (current code ignores the injected `accept`/`acceptOpts` entirely and would end `'completed'`).
- **C1.b** `'C1: the logged verify.reverified payload records both the accept decision and the acceptOpts policy used'` — asserts `payload.accept === false` and `payload.acceptOpts` deep-equals `{requireRedGreen:true, requireCoverage:false}`. **Fails today** (no `acceptOpts` field exists on the payload at all).
- **C1.c** `'C1: with no accept/acceptOpts override, behavior is unchanged AND the default policy is still logged'` — constructs a Coordinator **without** `opts.accept`/`opts.acceptOpts` (old-style call, matching every existing `coordinator.test.mjs` fixture), uses a fake referee verdict with **no `.passed` field** (the `passingReferee()` shape). Asserts (i) `task.status === 'completed'` (documents preservation — this assertion **passes today**, unchanged) and (ii) the logged payload's `acceptOpts` deep-equals `{requireRedGreen:false, requireCoverage:false}` (this assertion **fails today** — the field doesn't exist — so the test as a whole is RED, for the right reason: the new field is missing, not that behavior regressed).

### Existing tests this contract puts pressure on
None functionally break. `coordinator.test.mjs`'s fixtures (`passingReferee()`, `failingReferee()`) and every trust-gate test built on them (lines ~1143-1330) keep passing unchanged, because the coordinator's *default* `accept` reproduces today's inline check exactly. The D10 replay tests (lines ~1300-1330) that hand-construct log entries shaped `{accept: true/false, verdict: {...}}` also keep passing — `_replay()` only reads `e.payload?.accept`, and adding a sibling `acceptOpts` field to future-written payloads doesn't affect replay of hand-seeded payloads that omit it.

---

## C2 — DISPATCH: `router.pick()` is the real selector, not first-fit

### Relationship to RECONCILIATION
**Compliance fix, not an amendment.** D5 already mandates:

> at dispatch, the coordinator picks the vendor via `router.pick(task, candidates)` ... Which candidates = the adapters whose `card().concurrencyCeiling` has headroom.

`index.mjs`'s shipped `route` function ignores the router entirely and returns `candidates[0] ?? Object.keys(opts.adapters)[0]` — first-fit, with a fallback that (harmlessly, because `_dispatchPass`'s own ceiling re-check catches it) can even return a *saturated* vendor. `router.pick()` is never called anywhere in `src/` (audit, grep-confirmed).

### Wiring
`createDriver`'s `route` function is rewritten to:
1. **Ceiling filter = feasibility mask** (unchanged from today, just made explicit as its own step): `feasible = Object.keys(opts.adapters).filter(v => (inFlight[v] ?? 0) < cards[v].concurrencyCeiling)`.
2. Build router candidates from the feasible set: `candidates = feasible.map(v => ({ modelVersion: \`${cards[v].harness}@${cards[v].version}\`, family: 'default', concurrencyCeiling: cards[v].concurrencyCeiling, inFlight: inFlight[v] ?? 0 }))`. **`family: 'default'`** is pinned to match the existing `route.record()` wiring, which never passes an `opts.family` override (so it already defaults to `'default'` inside `router.record()`) — `pick()`'s candidate family and `record()`'s bucket family MUST agree, or seeded/learned stats never connect to selection.
3. **Selection**: `const chosen = router.pick(task, candidates)` — the real `AdaptiveRouter#pick`, not first-fit. `pick()` already returns `null` when `candidates` is empty (its own `eligible.length === 0` guard), which is exactly what "all ceilings saturated" needs — no first-fit fallback vendor is invented.
4. Map the returned `modelVersion` back to a vendor key: `const byModelVersion = new Map(feasible.map(v => [\`${cards[v].harness}@${cards[v].version}\`, v])); return byModelVersion.get(chosen) ?? null;`
5. **Injectable `route` stays supported**: `Coordinator`'s constructor contract is unchanged (`opts.route` is still a plain `(task, cards, inFlight) => vendor|null` function) — `coordinator.test.mjs`'s local `fixedRoute()`/custom `route` fixtures need no changes at all. Only `index.mjs`'s *own* `route` implementation changes.
6. `route.record` is unchanged (`route.record = (mv, tt, win) => router.record(mv, tt, win)`), preserving the "verified outcomes only" learning wiring (D5's other half), which the audit did **not** flag as broken.

### No arbitrary numeric limits
The ceiling values (`concurrencyCeiling`) are per-vendor **resource-derived** limits (e.g. GLM Pro plan ≈ 1 concurrent session) declared by each adapter's own `card()` — not a limit this contract introduces.

### Tests
- **C2.a** `'C2: with two ceiling-feasible vendors, a strongly router-favored vendor is actually dispatched to, not first-fit'` — `createDriver()` with two `MockAdapter`s (`vendorA`, `vendorB`), same `taskType`. Pre-seed `driver.router.record('vendorB@1.0.0', 'general', true, {family:'default'})` five times (>= `DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE`) so B's decayed score clears the adaptive floor while A stays at the flat prior. Spawn `vendor:'auto'`. Asserts (spy on each adapter's `spawn`) B's `spawn()` was called and A's was not. **Fails today** (first-fit always picks whichever vendor key is enumerated first, ignoring router state).
- **C2.b** `'C2: with all ceilings saturated, router.pick is consulted (and returns null) and the task queues exactly as before'` — both vendors ceiling=1, both already occupied; spy on `driver.router.pick`; spawn `vendor:'auto'`. Asserts (i) the new task's handle stays `status:'pending'` (preserved queueing semantics — passes today too, since `_dispatchPass`'s own ceiling re-check already guards this independently of what `route()` returns) and (ii) `router.pick` was actually invoked at least once. **Fails today on (ii)** — `router.pick` is never called by `src/` at all (audit-confirmed), so this spy assertion is the genuinely new, currently-failing half.

### Existing tests this contract puts pressure on
None. `coordinator.test.mjs`'s own dispatch/routing tests (e.g. `'spawn(\'auto\', brief) resolves the vendor via the injected route() using live cards/inFlight'`, line ~409) construct their **own** `route` fixture directly and pass it via `opts.route` — they never touch `index.mjs`'s `route` implementation, so they are unaffected.

---

## C3 — FENCING AT DELIVERY: `send()` rejects-before-delivering when possible, and never silently hides a stale-but-delivered message

### Relationship to RECONCILIATION
**Amends D1 and D3.** D1's `prompt()` verb and I1 ("every control op carries the `(worker, turn_epoch)` fence it was issued against") already imply an op should be checkable *against the fence it was issued against* — but the current `send()` never receives an externally-issued fence to check against; it calls `fences.issue(workerId)` fresh, internally, at the moment it runs, so there is no way to observe "the caller's belief about the fence is already stale" **before** the delivery call, only **after** it (during the `await adapter.prompt(...)` window). This contract closes that gap.

- **Amends D1**: `send(worker, content, mode, opts?)` gains an optional 4th parameter, `opts.expectedFence: number`. This is additive — every existing call site (`send(id, msg, mode)`, 3 args) is unaffected; `opts` defaults to `{}` and `opts.expectedFence` defaults to `undefined`, meaning "no external staleness claim, use whatever is current" (today's exact behavior).
- **Amends D3**: adds **one** new kind to the canonical `EventKind` vocabulary: **`control.delivery_amended`**. Chosen over reusing `control.stale_rejected` because the two events mean different things and conflating them is the audit's actual complaint ("The recheck suppresses the coordinator's own log entry ... does not undo delivery"): `control.stale_rejected` means *the coordinator refused to apply this op* (whether or not the adapter was ever touched); `control.delivery_amended` means *the adapter's `prompt()` was actually invoked, content reached the worker, and the coordinator discovered — only afterward — that the fence had moved out from under it.* Readers of the log must be able to tell these apart; a stale-rejected event alone cannot distinguish "never touched the worker" from "touched the worker, too late to stop it." (RECONCILIATION.md's D3 table must be updated to list this ninth-lane kind alongside `control.stale_rejected`.)

### Wiring
```js
async send(workerId, message, mode, opts = {}) {
  this.tick();
  const handle = this._getWorker(workerId);
  if (handle.status === 'stopping') return { ok: false, result: 'worker_stopping' };

  // NEW: pre-check against an externally-supplied fence, BEFORE any delivery attempt.
  if (opts.expectedFence !== undefined) {
    const preCheck = this._fences.check(workerId, { fence: opts.expectedFence });
    if (!preCheck.ok) {
      const harness = this._harnessOf(handle.vendor);
      this._log.append({ worker: workerId, harness, turnEpoch: this._fences.current(workerId).turnEpoch,
        kind: 'control.stale_rejected', actor: 'orchestrator',
        payload: { op: 'send', mode, attempted: opts.expectedFence, current: preCheck.current, phase: 'pre_delivery' } });
      return { ok: false, result: 'stale_fence', current: preCheck.current };
    }
  }

  const stamp = this._fences.issue(workerId);
  const harness = this._harnessOf(handle.vendor);
  const ack = await this._adapters[handle.vendor].prompt(workerId, message, mode);   // delivery — irreversible past this line
  const check = this._fences.check(workerId, stamp);
  const currentTurnEpoch = this._fences.current(workerId).turnEpoch;

  if (!check.ok) {
    this._log.append({ worker: workerId, harness, turnEpoch: currentTurnEpoch, kind: 'control.stale_rejected',
      actor: 'orchestrator', payload: { op: 'send', mode, attempted: stamp, current: check.current, phase: 'post_delivery' } });
    // NEW: the delivery already happened despite the staleness — say so, loudly, not just via the ambiguous rejection kind.
    this._log.append({ worker: workerId, harness, turnEpoch: currentTurnEpoch, kind: 'control.delivery_amended',
      actor: 'policy', payload: { op: 'send', mode, message, deliveredDespiteStale: true, attempted: stamp, current: check.current } });
    return { ok: false, result: 'stale_fence', current: check.current };
  }

  // ...unchanged control.send/nudge/steer logging...
}
```
`control.delivery_amended` is logged **if and only if** `adapter.prompt()` was actually invoked and the post-check subsequently found the fence had moved — i.e. never for a pre-check rejection (nothing was delivered, nothing to amend).

### No arbitrary numeric limits
N/A.

### Tests
- **C3.a** `'C3: bumpHuman before send(), with the caller's stale fence supplied — adapter.prompt is never invoked'` — capture `oldFence = fences.current(workerId).fence`; call `fences.bumpHuman(workerId)` directly (white-box, same `FenceTable` instance the coordinator was built with); call `coordinator.send(id, msg, 'nudge', {expectedFence: oldFence})`. Asserts (spy on the fake adapter) `adapter.calls.prompt.length === 0` and `result.result === 'stale_fence'`. **Fails today** (no `opts.expectedFence`/pre-check exists at all — `send()`'s 4th arg is silently ignored, `prompt()` is called unconditionally).
- **C3.b** `'C3: bumpHuman during an in-flight send() (adapter awaits a controlled gate) — delivery happens, return is stale_fence, and a control.delivery_amended event is logged'` — adapter's `prompt()` awaits a test-held gate; call `coordinator.send(id, msg, 'nudge')` (no `expectedFence` — the pre-check passes trivially); while the promise is pending, call `fences.bumpHuman(workerId)` directly; resolve the gate. Asserts `adapter.calls.prompt.length === 1` (delivery **did** happen), `result.result === 'stale_fence'`, log contains `control.delivery_amended` with `payload.deliveredDespiteStale === true`. **Fails today** (the event kind doesn't exist; only `control.stale_rejected` is logged, with no signal that delivery occurred).

### Existing tests this contract puts pressure on
- `'send() a nudge to a healthy working worker succeeds and logs control.nudge'` (coordinator.test.mjs:478) — unaffected (no `expectedFence`, no staleness).
- `'a same-tick interrupt racing an in-flight send() rejects the send as stale (no control.nudge logged)'` (coordinator.test.mjs:490) — **unaffected but now under-specified**: this is precisely the C3.b scenario, and it will continue to pass (it still asserts `result.result === 'stale_fence'` and `!kinds.includes('control.nudge')` and `kinds.includes('control.stale_rejected')`, all still true), but it should be **extended in the implementation phase** to additionally assert `kinds.includes('control.delivery_amended')`, since that's now the more complete, honest signal this contract adds. Flagging it here rather than silently leaving it as the weaker of two overlapping tests.
- `'send() on a worker currently stopping is refused immediately, without calling the adapter or writing any log entry'` (coordinator.test.mjs:542) — unaffected; the `status === 'stopping'` early-return is untouched and still fires before the new pre-check block.

---

## C4 — STOP LIVENESS: a real, injectable, unref'd deadline timer, independent of `tick()`

### Relationship to RECONCILIATION
**Compliance fix to supervisor-state-machine.md's I6/§2** ("starts a `STOP_DEADLINE` timer ... on deadline -> escalate"), and to D9's "every interrupt/kill promise resolves ... none may hang." The *concept* of a deadline timer is already spec'd; the audit's finding is that the implementation faked it — `_sweepDeadlines()` only runs as a side effect of `tick()`, which every public command calls, so "the caller must keep calling *some* command" is silently load-bearing for "never hangs," contradicting the plain reading of I6/D9. This contract makes the timer real and self-sufficient. It **pins one implementation detail RECONCILIATION leaves open**: how the timer is injected for determinism (§below) — not a contradiction, an elaboration.

### Wiring
- `Coordinator` constructor gains two new **optional** dependencies: `opts.setTimeout` (default `globalThis.setTimeout`) and `opts.clearTimeout` (default `globalThis.clearTimeout`). Stored as `this._setTimeout` / `this._clearTimeout`.
- In `_beginStop`, when a **fresh** waiter is created (the `existing` branch is untouched — an already-in-flight waiter keeps its original timer, per D9's "does not re-bump the fence" symmetry), after `waiter.deadlineAt = this._now() + this._stopDeadlineMs` is set:
  ```js
  waiter.timerHandle = this._setTimeout(() => this._forceStop(handle.id, waiter), this._stopDeadlineMs);
  if (waiter.timerHandle && typeof waiter.timerHandle.unref === 'function') waiter.timerHandle.unref();
  ```
  The `unref()` guard means: with the real global timer (production default), the deadline timer **never keeps the Node process alive** on its own — an idle driver with only pending stop-deadlines can still exit naturally. With an injected fake handle lacking `.unref`, the guard is a harmless no-op.
- `_finalizeStop` and `_forceStop` both clear the timer (guarded, since either can run first — confirmation racing the deadline is exactly the scenario this exists for): `if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);` — before the existing `waiter.finalized` idempotency guard would otherwise skip a second physical clear, this is placed so it always fires exactly once per waiter (both `_finalizeStop`/`_forceStop` already early-return via `if (waiter.finalized) return;`, so the clear naturally happens exactly once regardless of which path wins the race).
- The **existing** `_sweepDeadlines()` (invoked opportunistically inside `tick()`, itself invoked by every public command) is **not removed**. It becomes a redundant, harmless backup path: if it fires `_forceStop` first, the real timer is cleared as part of that same call; if the real timer fires first, `_forceStop`'s own `waiter.finalized` guard makes any later opportunistic sweep a no-op. Both paths call the same idempotent `_forceStop`, so keeping both is strictly safer than removing either, and it costs nothing (the sweep is already O(stopWaiters) per tick).

### Why this is the authoritative liveness fix, not the sweep
The **new** real timer is what makes "never hangs" true **without any further command** — the audit's exact complaint. The sweep alone can never satisfy that, no matter how it's implemented, because by definition it only runs when something else calls `tick()`.

### No arbitrary numeric limits
`stopDeadlineMs` is an **existing**, already-configurable `createDriver`/`Coordinator` option (not introduced by this contract) — a real bound derived from "how long we're willing to wait for a worker process to acknowledge a stop before assuming it's wedged," analogous to supervisor-state-machine.md's `STOP_DEADLINE`. No new numeric constant is added.

### Tests
- **C4.a** `'C4: an adapter that never confirms a stop resolves the forced path after the deadline fires, with zero tick() calls after arming'` — construct a hand-rolled fake `setTimeout`/`clearTimeout` pair that **records** scheduled `(fn, ms)` pairs and returns a fake handle (with an `unref` spy) rather than actually scheduling on the real event loop; wire it into the `Coordinator` via `opts.setTimeout`/`opts.clearTimeout`, `stopDeadlineMs: 5000`. Spy on `coordinator.tick` (wrap the method) to count calls. Call `coordinator.interrupt(workerId)` (do not await yet) against an adapter whose `interrupt()` Acks but never emits a confirmation event. Record `tickCallsAtArm = spy.tick.callCount` (captures the synchronous portion of `interrupt()`, which itself calls `tick()` once at its own top). Manually invoke the **recorded** deadline callback (simulating the real timer firing, with no real wall-clock wait and no test-driven `tick()`/`advance()`/command in between). Await the `interrupt()` promise. Asserts: `result.result === 'forced'`, `spy.tick.callCount === tickCallsAtArm` (**no additional tick() calls occurred** between arming and the forced resolution), and the fake handle's `unref` was called. **Fails today** (no timer is armed at all; `interrupt()` never resolves without a further `tick()`/command — this test would otherwise hang, which is exactly why the fake timer harness, not a real clock, is required for a deterministic RED).
- **C4.b** `'C4: an adapter that confirms quickly clears the armed timer — a late manual fire of the (already-cleared) callback is a no-op'` — same fake timer harness; adapter's `interrupt()` Acks and the test immediately emits `control.interrupt_confirmed`. Await `interrupt()` — asserts `result.result === 'confirmed'`. Asserts the fake `clearTimeout` was called with the exact handle `setTimeout` returned. Then manually invokes the (already-cleared, per the fake harness honoring `clearTimeout` by deleting the callback) deadline callback anyway and asserts no additional `control.forced_stop` log entry appears and the worker's status is unchanged (still `idle`, not `dead`). **Fails today** on the "clearTimeout was called" assertion (no timer, so nothing to clear) — the behavioral no-op-after-confirm half already holds today trivially (there's no timer to fire), but the test is RED because the clear-call assertion has nothing to observe yet.

### Existing tests this contract puts pressure on
- `'core#7: the implicit tick-on-every-command contract fires a deadline sweep as a side effect of a command other than .tick()'` (coordinator.test.mjs:387) — **survives functionally unchanged** (its `setup()` never overrides `opts.setTimeout`/`opts.clearTimeout`, so it gets the real global timer with `stopDeadlineMs:1000`; the test's own fake-`now()`-driven sweep via `list()` still fires `_forceStop` first, in real time on the order of microseconds, long before the real 1-second background timer would ever fire, and `_forceStop`'s clear makes the later-armed real timer moot). **Its docstring/premise is now stale** — it was written to prove "no background timer thread ... every public command implicitly ticks first" as a *feature*; C4 deliberately adds exactly the background timer this test's name says doesn't exist. Recommend renaming/rewording this test's title and comment in the implementation phase to reflect "the sweep-based path also works, redundantly, alongside the real timer" rather than asserting the sweep is the *only* mechanism.
- `'if the adapter never emits a confirmed-stop event, interrupt() resolves forced once stopDeadlineMs elapses'` (coordinator.test.mjs:717) and the two D9 composition tests (lines 742, 779) — all survive unchanged for the same reason (no timer override passed, real global timer races harmlessly behind the fake-clock-driven sweep which always wins first in these tests' real-time-microseconds execution window).

---

## C5 — VENDOR ATTRIBUTION: the vendor reaches `captureCommit`, and log-is-truth covers the case git history can't

### Relationship to RECONCILIATION
**Compliance fix**, per worktrees.md ("Each worker commits as itself — author set to `baton-worker-<vendor>`") and the audit's own row ("captureCommit vendor attribution ... Overclaimed"). No amendment to D-numbered decisions (D7 pins the worktree.mjs *export names*, not their argument shapes; `captureCommit(repoRoot, taskId, {vendor})` already accepts `opts.vendor` today — it's simply never *passed* by the live wiring).

### Wiring
1. `coordinator.mjs`'s `_runTrustGate` passes the vendor through the capture call:
   ```js
   const captured = await this._worktrees.capture(handle.worktree ?? task.worktree, { vendor: handle.vendor });
   ```
   (today: `this._worktrees.capture(handle.worktree ?? task.worktree)` — no second argument at all).
2. `index.mjs`'s `worktreeManager(repoRoot).capture` wrapper threads the option through to the real `captureCommit`:
   ```js
   async capture(worktreePath, opts = {}) { return worktreeMod.captureCommit(repoRoot, basename(worktreePath), { vendor: opts.vendor }); }
   ```
   (today: `capture(worktreePath) { return worktreeMod.captureCommit(repoRoot, basename(worktreePath), {}); }` — `{}` unconditionally, vendor always `undefined`).
3. **The honest resolution of the MockAdapter self-commit interaction** (audit: "MockAdapter... runs a real git commit per edit; captureCommit then finds a clean tree and no-ops" — this is the *inverse* of what worktrees.md's lifecycle diagram assumes, where the coordinator's `captureCommit` is what creates the attributed commit): when `captureCommit` finds a **clean** tree (`snapshotted: false` — the worker already committed, under whatever author identity *it* chose, e.g. MockAdapter's hardcoded `baton-worker-mock`), **captureCommit cannot rewrite already-made history** — it cannot retroactively stamp a `Baton-Vendor` trailer onto a commit the worker itself authored and sealed. The `Baton-Task`/`Baton-Vendor` trailers apply **only** to commits captureCommit *itself* creates (the snapshot-commit path, `snapshotted: true`) — never to a worker's own pre-existing commits. **This is a real, permanent limit of the git-trailer mechanism, not a bug to "fix" further**: baton does not amend/rewrite a worker's own commits (that would corrupt a branch history a human or CI may already be looking at). Instead: **attribution for the self-committed case lands in the log, not in git** — log-is-truth. Concretely, `_runTrustGate`'s `verify.reverified` event payload (already extended in C1 with `acceptOpts`) gains one more field, `capture`: `{ sha: captured.sha, snapshotted: captured.snapshotted, vendor: handle.vendor ?? null }`. This is populated **unconditionally** (both when captureCommit snapshotted a new commit AND when it found a clean, self-committed tree) — so the coordinator's own append-only ledger always names which vendor produced a task's result, even in the one case git's own history cannot say so. (No new `EventKind` — this reuses the existing `verify.reverified` kind from D3's closed vocabulary, extending only its payload shape, which D3 never freezes.)

### No arbitrary numeric limits
N/A.

### Tests
- **C5.a** `'C5: a dirty-tree task (worker never self-commits) ends with HEAD authored as baton-worker-<vendor> and a Baton-Vendor trailer'` — `createDriver()` over a real temp git repo; a small local fake adapter (distinct from `MockAdapter` — it writes a file directly into the worktree via `fs.writeFileSync` and emits `lifecycle.turn_completed` **without ever running `git add`/`git commit` itself**, i.e. a genuinely dirty tree at capture time) registered under vendor key `'forgevendor'`. Spawn, wait for completion. Asserts, via real `git -C <worktree> log -1 --format=%an` / `%B`, the author is `baton-worker-forgevendor` and the body contains `Baton-Vendor: forgevendor`. **Fails today** (vendor is always `undefined` on the live path, so the author is the generic `baton-snapshot` and no `Baton-Vendor` line exists at all).
- **C5.b** `'C5: a self-committed task (clean tree at capture) still logs the vendor on verify.reverified, even though captureCommit cannot rewrite the worker's own commit'` — `createDriver()` with the real `MockAdapter` (which self-commits every edit) registered under vendor key `'mock'`. Spawn, wait for completion. Asserts the logged `verify.reverified` event's `payload.capture` deep-equals `{sha: <the real HEAD sha>, snapshotted: false, vendor: 'mock'}`. **Fails today** (no `capture` field exists on the payload at all, and vendor is never plumbed regardless).

### Existing tests this contract puts pressure on
`worktree.test.mjs`'s direct unit tests of `captureCommit(repoRoot, taskId, {vendor:'mock'})` (the audit's own citation: "asserted only in a unit test that passes `{vendor:'mock'}` explicitly, a shape the coordinator never produces") are unaffected — they test `worktree.mjs` directly and already pass `{vendor}` by hand; this contract makes the **live** coordinator+index.mjs path finally produce that same shape, closing the exact gap the audit named. No existing assertion anywhere currently checks that the live path passes `vendor:undefined` (i.e. nothing currently pins the *absence* of attribution as a feature), so nothing regresses.

---

## C6 — `.baton/` EXCLUSION: idempotent, preserves pre-existing exclude content, fires on first touch

### Relationship to RECONCILIATION
**Compliance fix**, per worktrees.md ("Everything baton creates lives under `.baton/` ... so it never clashes ...") and the audit's ranked gap #5 ("no git-exclude of `.baton/`, left to callers" — today `e2e.test.mjs`'s `makeRealRepo()` test helper manually writes `.git/info/exclude` itself, which is the tell: production code never does this). No D-numbered decision addresses git-exclude mechanics directly, so this is a straightforward gap-fill, not a reinterpretation of anything pinned.

**One narrow amendment to D7**: D7 pins worktree.mjs's exported surface as "exactly" `pinBaseSha, createFromBase, captureCommit, freshVerifySandbox, changedLines, reap, reconcile, listWorktrees` (+ `markStopped`). This contract adds **one** new export, `ensureBatonExcluded(repoRoot)`, to that list — additive only. It does not change the `WorktreeManager` shape the coordinator depends on (the coordinator never calls `ensureBatonExcluded` directly; it is consumed internally by `pinBaseSha` and separately available for direct testing/tooling).

### Wiring
- New export in `worktree.mjs`:
  ```js
  /** Idempotently ensures '.baton/' is present in <repoRoot>/.git/info/exclude, preserving any existing content. */
  export function ensureBatonExcluded(repoRoot) {
    const excludePath = join(repoRoot, '.git', 'info', 'exclude');
    let existing = '';
    if (existsSync(excludePath)) existing = readFileSync(excludePath, 'utf8');
    const lines = existing.split('\n');
    if (lines.some((l) => l.trim() === '.baton/')) return; // already present — no-op
    const withNewline = existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing;
    mkdirSync(dirname(excludePath), { recursive: true });
    writeFileSync(excludePath, `${withNewline}.baton/\n`, 'utf8');
  }
  ```
- `pinBaseSha(repoRoot, opts)` calls `ensureBatonExcluded(repoRoot)` as its **very first** action, **before** the `isClean(repoRoot)` check. This is the load-bearing ordering: a repo with a pre-existing, not-yet-gitignored `.baton/` directory (e.g. a leftover scaffold dir from a previous run, or simply created moments earlier by the same process before its first `pinBaseSha` call) must never be seen as "dirty" because of baton's own bookkeeping directory — the exclude line has to land before `git status --porcelain` is ever consulted.

### No arbitrary numeric limits
N/A.

### Tests
- **C6.a** `'C6: pinBaseSha succeeds on a fresh repo with a pre-existing .baton/ dir and no manual exclude'` — a **raw** temp git repo helper (deliberately distinct from `e2e.test.mjs`'s `makeRealRepo()`, which pre-writes the exclude line by hand as a workaround — this test's whole point is to not do that workaround), with a `.baton/junk/x.txt` file written directly (simulating pre-existing scaffold) **before** `.git/info/exclude` has any `.baton/` entry. Calls `worktreeMod.pinBaseSha(dir, {})` via a namespace import (`import * as worktreeMod from '../src/worktree.mjs'`, so a still-missing export fails inside the assertion, not at module load, keeping the rest of the file's tests running). Asserts the call resolves (does not throw `DirtyRepoError`). **Fails today** (no exclusion is written anywhere in `pinBaseSha`, so `.baton/junk/x.txt` shows up in `git status --porcelain`, and `DirtyRepoError` is thrown).
- **C6.b** `'C6: the exclude line is not duplicated across repeated calls'` — call `worktreeMod.pinBaseSha(dir, {})` (or `ensureBatonExcluded` directly, if exported) twice; assert `.git/info/exclude`'s content contains the literal line `.baton/` **exactly once**. **Fails today** for the direct-`ensureBatonExcluded` variant (missing export -> `TypeError`, isolated to this test) and is meaningless-but-vacuously-passing today for the indirect `pinBaseSha`-only variant (the file never gains a `.baton/` line at all under either call today) — the spec pins the direct-export variant as primary evidence.
- **C6.c** `'C6: a pre-existing, unrelated exclude line survives'` — pre-write `.git/info/exclude` with `*.log\n`; call `worktreeMod.ensureBatonExcluded(dir)`; assert the final file contains both `*.log` and `.baton/` as separate lines. **Fails today** (missing export).

### Existing tests this contract puts pressure on
None break. `e2e.test.mjs`'s `makeRealRepo()` manual `writeFileSync(join(dir, '.git', 'info', 'exclude'), '.baton/\n')` becomes redundant-but-harmless once `pinBaseSha` does this itself (the file already contains the line; `ensureBatonExcluded`'s own idempotency guard no-ops). Recommend removing that manual line from `e2e.test.mjs` in the implementation phase as a cleanup (not a required change — it costs nothing to leave, since it's idempotent with the new behavior), and note this is the exact workaround pattern this contract eliminates from being necessary.

---

## C7 — ENTRYPOINT: direct tests for `createDriver()`

### Relationship to RECONCILIATION
No amendment — this is coverage, not a contract change. The audit's own finding: `index.mjs` is never imported by any test; `e2e.test.mjs` hand-wires an equivalent system in its own `setupSystem()`, and that reimplementation has already drifted from the shipped `route()` (first-fit vs `e2e.test.mjs`'s fixed-vendor `routeFn`). This closes that gap by testing the actual shipped `createDriver()`.

### What must be true of the real `createDriver()` (rolling up C1-C6, exercised together over one real assembly)
- An honest task (worker leaves a dirty tree matching the pinned verification) ends `completed`, with the C5 attribution (author/trailer) genuinely on disk.
- A forged task (worker claims `completed` but the pinned check fails in the fresh sandbox) ends `failed`, never `completed` — the C1 gate, exercised through the real `referee.accept()` `createDriver` now actually plumbs.
- The router bucket (`driver.router.getStat(modelVersion, taskType)`) is updated after each verified outcome — the C2 `route.record()` wiring, unchanged by this phase but now sitting downstream of a `route()` that actually consults `router.pick()`.
- The repo's `.git/info/exclude` gets `.baton/` even though the test's own repo helper does **not** pre-write it (C6, exercised end-to-end via the real `pinBaseSha` call `worktreeManager.create()` makes).

### Tests
- **C7.a** `'C7: createDriver() end-to-end — an honest task completes, is attributed, and updates the router'` — a **raw** repo (no manual exclude, a pre-existing `.baton/` scaffold dir seeded before the driver ever runs, per C6), a local dirty-write fake adapter (per C5.a) registered as the sole vendor. `spawn()` an honest task via `driver.coordinator.spawn(...)`. Asserts `result.status === 'completed'`, `driver.router.getStat(modelVersion, taskType).count >= 1`, real git author/trailer on HEAD (C5), and that `pinBaseSha` never threw (C6 — proven simply by the task having dispatched and completed at all, since a thrown `DirtyRepoError` inside `worktreeManager.create()` would have left the task stuck `pending`/errored, never `working`/`completed`). **Fails today** on multiple independent axes (attribution absent, router never consulted at dispatch time even though it's still recorded to post-hoc, exclude absent though the specific repo shape chosen here happens not to trigger a `DirtyRepoError` on its own unless the pre-seeded `.baton/junk` dir is included — which it is, deliberately, to force the C6 axis to be live here too).
- **C7.b** `'C7: createDriver() end-to-end — a forged task never completes'` — same raw repo/driver assembly, the real `MockAdapter` with `scenario.forgeSuccess:true` (claims done, commits something unrelated). Asserts `result.status === 'failed'`, `result.verdict.passed === false`, the planted artifact is genuinely absent from the repo, and the router bucket recorded a **loss** (`verifiedWin === false` reflected in a lower decayed rate / the same `record()` call observed via a spy on `driver.router.record`). **Fails today only insofar as it depends on the C1/C2 wiring already covered above** — the forge-catch property itself (D4's freshness guard) already holds via `refereeFn`'s inline `accept()` call in `index.mjs` today; what's new here is asserting it through the now-real `accept`-gated status derivation and the now-real `router.pick`-mediated dispatch, both of which this file's earlier contracts are what actually turn red.

### e2e.test.mjs assertions that MUST be preserved when `setupSystem()` is replaced by `createDriver()` (implementation-phase note, not a test in this file)
When the implementation phase retires `e2e.test.mjs`'s hand-wired `setupSystem()` in favor of driving tests through the real `createDriver()`, the following properties — currently proven only against the hand-wired system — must continue to hold against the real one (this is the acceptance bar for that migration, listed here so it isn't quietly dropped):
1. `adapter.spawn()` receives the **identical** `Brief` object `createBrief()` produced (D2 identity, not equality) — "E2E happy path" test.
2. The trust gate genuinely runs `captureCommit` → `freshVerifySandbox` → `referee.verify` exactly once per completed task, and the verify sandbox is reaped afterward (never leaked on disk) — "E2E happy path" test.
3. `referee.verify()` is called with the **same** `verification` object reference the brief was frozen with, not a rehydrated copy — "E2E happy path" test (D2 structural identity).
4. The verify sandbox is never the worker's own worktree (D6) — "E2E happy path" test.
5. A forged completion is caught: `status:'failed'`, `verdict.passed:false`, `matchesClaim:false`, the planted artifact absent from the repo, and the **raw** (lying) worker claim is still logged verbatim in `lifecycle.turn_completed` even though `coordinator.result()` diverges from it — "E2E forge caught" test.
6. `router.record()`/`getStat()` reflect the **verified** outcome only (`verifiedWin === accept(verdict)`), never the worker's self-report — both "E2E happy path" and "E2E forge caught" tests.
7. A real two-phase interrupt mid-run: status flips to `stopping` synchronously; the promise only resolves once the adapter's real confirmed-stop event fires; the not-yet-reached slow edit never lands on disk; an interrupted run never enters the trust gate and never feeds the router — "E2E interrupt" test.
8. A ceiling=1 vendor genuinely serializes two tasks (second stays `pending`, `adapter.spawn()` not called for it, until the first vacates) — "E2E concurrency" test.

---

## Summary table

| Contract | Audit row / ranked gap | RECONCILIATION relationship | New export/opt |
|---|---|---|---|
| C1 | "`accept()` as sole done-gate"; ranked gap #3 | compliance fix (D4) | `Coordinator` opts `accept`, `acceptOpts`; `createDriver` opts `requireRedGreen`, `requireCoverage` |
| C2 | "`router.pick()` ... dead in dispatch"; ranked gap #3 | compliance fix (D5) | none (internal to `index.mjs`'s `route`) |
| C3 | "Fencing / stale-command rejection" | **amends D1** (`send()` gains `opts.expectedFence`) and **D3** (new kind `control.delivery_amended`) | `send()` 4th param `opts` |
| C4 | "Two-phase confirmed-stop"; ranked gap #6 | compliance fix (I6/D9); pins an open implementation detail | `Coordinator` opts `setTimeout`, `clearTimeout` |
| C5 | "captureCommit vendor attribution" | compliance fix (worktrees.md) | none (existing `{vendor}` opt, finally threaded) |
| C6 | ranked gap #5 (".baton/" exclude) | compliance fix (worktrees.md); **amends D7**'s export list (additive) | `worktree.mjs` export `ensureBatonExcluded` |
| C7 | "`createDriver()` assembly"; ranked gap #7 | coverage only, no amendment | none |
