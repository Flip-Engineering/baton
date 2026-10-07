# Red-Team Findings — Core Cluster (log.mjs, fence.mjs, coordinator.mjs) + Adapter Seam

Scope reviewed: `spec/IMPLEMENTATION.md` §0–§6 (Core cluster + Cluster B `adapter.mjs`/`worktree.mjs` sections for the seam analysis), `impl/test/log.test.mjs`, `impl/test/fence.test.mjs`, `impl/test/coordinator.test.mjs`, `impl/test/adapter.test.mjs`, `SYSTEM.md`.

`log.mjs`/`fence.mjs` are in good shape — both are small, closed-form modules and the test suites cover their stated behaviors and invariants tightly (I only found one real gap there, #9 below). Almost everything below is in `coordinator.mjs`, which is where the five reliability rules actually interact and where the spec leaves real implementer discretion.

---

## 1. [BLOCKER] Question-answer delivery mechanism is self-contradictory in the spec, and completely unverified by any test

**What's wrong.** `respond()` step 4 (questions) says:

> "deliver via `adapters[vendor].approve(handle, requestId, answer)` (or a `prompt`-based answer path per the adapter's `ask` mechanics)"

Step 5 (approvals) says:

> "deliver via `adapters[vendor].approve(handle, requestId, answer.decision)`"

But the `Adapter.approve` typedef (§3.2) is:

```js
(worker, requestId, decision: 'allow'|'deny'|'cancel', payload?) => Promise<Ack>
```

`decision` is a **closed three-value enum**. Step 5 correctly extracts `.decision` to satisfy that signature. Step 4 passes the *entire free-text `answer` object* (e.g. `{text: 'option A'}`, per `coordinator.test.mjs:670`) into the same parameter slot — which is typed to accept only `'allow'|'deny'|'cancel'`. These cannot both be correct against one `Adapter` typedef. The parenthetical "or a `prompt`-based answer path" makes it worse: it offers a *second, entirely different adapter method* (`prompt`) as an alternative, without saying when an implementer should pick one over the other.

The test at `coordinator.test.mjs:654` ("respond() answers a pending question...") asserts `result.ok`, `question.resolved` is logged, and the worker returns to `working` — but **never inspects `adapter.calls.approve` (or `.prompt`) at all**. It is a textbook "checks a status but not the effect" weak assertion: an implementation that silently drops the answer on the floor and never calls *any* adapter method would still pass this test.

**Fix.**
- Spec change: pin ONE delivery path for question answers. Recommend adding a fourth `Adapter` method, `answer(worker, requestId, answer: {text?, decision?})`, distinct from `approve` (whose `decision` stays enum-only for real approvals). Update step 4 to call `adapters[vendor].answer(...)`, not `.approve(...)`.
- New/strengthened test: assert the exact adapter call (method + args) made for a question response, not just the coordinator-side status transition. Add a variant where the answer is a `decision`-shaped object vs. free text, to prove the two paths (question vs. approval) are not accidentally aliased.

---

## 2. [BLOCKER] `interrupt()`/`kill()` composed on the same worker before the first confirms is unspecified and can deadlock a caller's promise forever

**What's wrong.** §3.5 step 6 says the coordinator awaits "the adapter's **authoritative confirmed-stop event**... matched by `workerId` + the bumped `stamp.fence`". Step 3 says interrupt "always calls `bumpHuman`" — i.e. **every** call to `interrupt()`/`kill()` mints a *new, higher* fence value that becomes the expected match key for *that* call's own confirmation wait.

Nothing in the spec says what happens if a second `interrupt()` or a `kill()` is issued on a worker that is *already* `'stopping'` (first interrupt in flight, not yet confirmed):
- Does the second call bump the fence again (a new match key that the underlying adapter, which only ever received one interrupt signal, will never emit a confirmation stamped with)?
- Does the second call re-invoke `adapters[vendor].interrupt()`/`.kill()` a second time, or short-circuit because `status` is already `'stopping'`?
- If it bumps and waits on a fence value the adapter can never match, **that caller's promise hangs forever** — directly contradicting `kill()`'s job as documented in `SYSTEM.md` §5.6: *"The emergency stop always works and never asks for a written reason — you can always kill a runaway instantly."* A human hitting `kill()` on a worker mid-interrupt is exactly the panic-button scenario that must not be allowed to hang.

No test in `coordinator.test.mjs` calls `interrupt()` (or `kill()`) a second time on a worker whose first `interrupt()`/`kill()` hasn't yet resolved. This is precisely the "worker that never stops" / "interrupt during a running step" adversarial case called out in the brief, and it's untested.

**Fix.**
- Spec change: define composition explicitly. Recommend: if `status === 'stopping'` already, a second `interrupt()`/`kill()` call does **not** re-bump the fence or re-call the adapter; it attaches itself as an additional waiter on the *same* in-flight confirmation (or immediately upgrades the deadline/escalates to force-kill if the caller is `kill()` and the prior call was a soft `interrupt()`). Only a fresh `interrupt`/`kill` on an `'idle'`/`'working'`/`'blocked'` worker mints a new fence.
- New test: `interrupt()` then `kill()` (or `interrupt()` twice) on the same worker before the confirmed-stop event fires — assert **both promises resolve** (not just the second, not a hang), and assert only one underlying adapter interrupt/kill call happened (or, if two, that the confirmation-matching logic accounts for it).

---

## 3. [BLOCKER] Coordinator construction-time replay from the log is unspecified, and the one test for it (behavior 47) doesn't actually exercise it

**What's wrong.** Invariant L3 requires: *"A coordinator rebuilt from nothing but the log's terminal events reconstructs the same terminal task/worker statuses."* `Log.workers()` is documented explicitly as existing *"For crash-recovery replay."* But §3.3 (Construction) never describes a replay procedure — the only construction-time action mentioned anywhere is `worktrees.reconcile()` (behavior 48). There is no described mechanism for the constructor (or a lazy accessor) to:
- discover which workers/tasks exist by scanning `log.workers()`,
- replay each worker's event stream to rebuild `DriverTask`/`WorkerHandle`,
- or restore `FenceTable` state (`fence`/`turnEpoch`) from the log tail, since a fresh `FenceTable` starts empty and `fences.issue()`/`.check()` throw/report `unknown_worker` for anything not `register()`-ed.

The replay test (`coordinator.test.mjs:930`) does **not** test this path: it manually calls `fences.register(workerId)` itself (bypassing whatever the real constructor would do), and never calls `coordinator.spawn(...)` for the task — it relies entirely on `result(workerId)` finding a task that was never registered through any documented API. This only proves `result()` *can* answer from log data if some other code already reconstructed `fences` and the task table correctly — it doesn't prove the *construction path* does that reconstruction, because the test bypasses construction and does it by hand. An implementation that has **no replay logic in the constructor at all** would still pass this test, since the test itself performs the "replay."

**Fix.**
- Spec change: add a concrete §3.3 subsection, "Construction — replay," specifying: on `new Coordinator(opts)`, synchronously (or via an async `ready` you must `await` before issuing commands) iterate `log.workers()`, `log.read(worker)` each, and rebuild `DriverTask.status`/`WorkerHandle`/`FenceTable` fence+turnEpoch purely from event kinds — with an explicit table of "event kind → state transition" so this is implementable without guessing.
- New test: construct a `Coordinator` **the normal way** (no manual `fences.register`/pre-seeding) against a log directory containing a full hand-written event sequence for a worker that was never `spawn()`-ed on this instance, and assert `list()`/`result()` work correctly *and* that `fences.current(workerId)` returns the state implied by the log (not `unknown_worker`).

---

## 4. [BLOCKER] `wait()`'s at-least-once restart guarantee (C8) depends on a Cursor state-file location that is nowhere in the public contract

**What's wrong.** C8 requires the digest-ack floor to "live in `Cursor`'s persisted state file, not in memory," and behavior 53's restart test builds a *second* `Coordinator` pointed at the same `Log` directory and expects the same unacked digest to be re-served. But:
- `CoordinatorOpts` (§3.3) has no `cursorFile`/`cursorDir` field anywhere.
- `Cursor`'s constructor takes an explicit `stateFile` path (§1.3) — there is no documented convention for how the *Coordinator* derives that path.
- `Log`'s constructor takes `dir` but the spec never says `dir` is exposed as a public/gettable property the Coordinator could derive a sibling cursor path from.

So the restart test (`coordinator.test.mjs:1086`) — which constructs `coordinator2` with only a fresh `Log`, `FenceTable`, adapter, and worktree manager, no cursor-related option at all — can only pass if the implementer *independently guesses* the exact same directory convention the spec never wrote down. This is the same "implicit assumption not pinned by spec" pattern the test authors themselves already flagged for `lifecycle.spawned`'s payload shape (`coordinator.test.mjs:937-939`) — except this one is silent instead of called out, and it's load-bearing for a numbered invariant (C8).

**Fix.**
- Spec change: pin it explicitly — e.g. "the Coordinator's internal `Cursor` state file always lives at `<logDir>/.wait-cursor.json`, derived from `Log`'s constructor argument" — and either expose `Log.dir` as a documented public property, or add an explicit `CoordinatorOpts.cursorFile` (defaulting to a documented derived path) so tests and implementers agree without guessing.
- Test: assert the on-disk path directly (not just black-box restart behavior) so a future refactor can't silently change the convention and break restart compatibility.

---

## 5. [BLOCKER] The adapter-contract seam — own analysis + proposed unified contract

**The mismatch, confirmed by reading both specs directly.** Core's `Adapter` (§3.2) is a **persistent, event-driven session**: `card / spawn(worker,brief) / prompt(worker,content,mode) / interrupt(worker,then) / approve(worker,requestId,decision,payload) / kill(worker) / onEvent(cb)`. Cluster B's actual `adapter.mjs` (§2, just read in full) is **one-shot**: `card() / run(brief, opts) → Promise<WorkerResult>` — a single call that takes the *whole* brief up front and resolves once, at turn end, with cancellation only via `opts.signal` (abort) and worker-initiated (not orchestrator-initiated) questions via `opts.onAsk`.

`coordinator.test.mjs` itself documents the discrepancy in its FIXTURE NOTE (lines 6-20) and, per the spec's own §6 permission, sidesteps it by building local fakes (`ScriptableAdapter`) that conform to the *session* shape instead of importing the real `MockAdapter`. **This means all 221 Core+B tests can go green while the actual production wiring — turning `run()`-based engines into the session `Adapter` the coordinator needs — has never been specified or exercised anywhere.** This is exactly the seam the assignment calls out as "the KNOWN one," and it's worse than a shape mismatch — it's a **semantic gap**:

- `prompt(worker, content, 'nudge')` is documented (`SYSTEM.md` §4.4) as "a note delivered at the next natural pause" — explicitly *non-destructive*. But a `run()`-based engine (§2 of Cluster B) has **no inbound message channel at all** except `onAsk`, which only fires when the *worker* asks something — there is no "pause point" the orchestrator can inject into. The only mechanically possible translation is abort-current-run + restart-with-amended-brief, which is *always destructive* (discards uncommitted in-progress work). That's fine as the documented behavior for `'steer'` (already flagged emulated for Claude/GLM per `SYSTEM.md`), but it is **not** what `'nudge'` is supposed to mean, and MockAdapter — the thing the whole Core suite is validated against — has no better mechanism either.
- `onEvent(cb)` (called once, persistently) vs. `opts.log` (passed fresh per `run()` call) need a bridging shim; how many times `onEvent` may be registered, and how a per-run `log.append` maps to the coordinator's `Omit<BatonEvent,'seq'|'ts'|'worker'>` callback shape, is unspecified.
- `spawn()`'s Core contract awaits only an `Ack` and returns quickly (turn completion is reported later via `onEvent`'s `lifecycle.turn_completed`), but `run()` doesn't resolve until the *whole* turn is done (possibly minutes) — a naive shim that `await`s `run()` inside `spawn()` would make `coordinator.spawn()` block for the entire first turn, breaking the entire async command model.

**Proposed unified contract (concrete, for Phase 4 to pin in the spec).** Add a `SessionAdapter` class to Cluster B's `adapter.mjs`, exported alongside the existing one-shot engines, and specify it as the **only** thing ever passed into `CoordinatorOpts.adapters`:

- `card()` → delegates verbatim to the wrapped one-shot engine.
- `spawn(worker, brief)` → starts an internal `AbortController`, fires `engine.run(brief, {worktree, signal, onAsk: <bridge to pending-approve map>, log: <bridge that forwards each `append(partial)` into the stored `onEvent` callback>, workerId, turnEpoch})` **without awaiting completion**; resolves `spawn()`'s own promise immediately with `{ok:true}`. The eventual settlement of `run()` is surfaced later as an `onEvent`-pushed `lifecycle.turn_completed` (resolve) or `lifecycle.crashed` (reject, `AdapterCrashError`).
- `prompt(worker, content, 'turn')` → abort current run, await settlement, start a new `run()` with the prior context + `content.text` folded into a new brief.
- `prompt(worker, content, 'steer')` → same as `'turn'` (abort+restart); `card().verbs.steer` must be reported `'emulated'` for **every** run()-based engine, including `MockAdapter` — there is no other honest answer given the one-shot API.
- `prompt(worker, content, 'nudge')` → **decide and document one of two options, not left open**: (a) extend `RunOpts` with an `onNudge`/inbox mechanism the engine polls at natural pause points (real fix, more work), or (b) explicitly declare nudge is *also* emulated as abort+restart for the MVP and update `SYSTEM.md` §4.4 to stop promising non-destructive nudges until (a) exists. Silently defaulting to (b) without documenting it is the actual risk — it contradicts a system-level promise.
- `interrupt(worker, then)` → abort signal, await `run()` settlement (this **is** the A5 two-phase-stop confirmation from Cluster B's own spec), synthesize `control.interrupt_confirmed` through the `onEvent` bridge; if `then` present, start a follow-up `run()`.
- `approve(worker, requestId, decision, payload)` → resolves the specific pending `onAsk` promise captured for `requestId`; returns `{ok:false}` if no such pending ask exists (defense in depth alongside the coordinator's own CAS).
- `kill(worker)` → same as interrupt with no `then`, and marks the wrapper permanently dead (rejects/no-ops any further `run()` calls).

**Fix.** Pin this (or an equivalent) shim class in the Cluster B spec, require Cluster B's own test suite to test the *shim* against Core's session `Adapter` contract directly (currently `adapter.test.mjs` only exercises the low-level `run()` API — zero tests touch `spawn/prompt/interrupt/approve/kill/onEvent`), and add at least one integration test (can live outside either cluster's unit suite, per §6's own carve-out, but must exist somewhere in the plan) that wires the *real* shim-wrapped `MockAdapter` into a real `Coordinator`.

---

## 6. [MAJOR] Concurrency-ceiling accounting during `'stopping'`/`'blocked'` is unspecified — a real "concurrency ceiling race"

**What's wrong.** Dispatch step 3: *"Skip if `inFlight[vendor] >= adapters[vendor].card().concurrencyCeiling`."* Nothing defines whether a worker in `'stopping'` (mid-interrupt, not yet confirmed) or `'blocked'` still counts toward `inFlight`. This matters most for GLM (`concurrencyCeiling: 1`, called out repeatedly as a *hard* constraint in `SYSTEM.md` and the adapter card tests). If `'stopping'` workers are excluded from `inFlight`, then during the `stopDeadlineMs` window a **second** GLM worker could dispatch while the first GLM session is still physically alive underneath — violating the vendor's real hard limit, which is exactly the "concurrency ceiling race" called out in the assignment.

No test constructs this scenario: every ceiling test (`coordinator.test.mjs:252`, `:341`) frees the slot via a completed `lifecycle.turn_completed`, never via an in-flight `interrupt()`.

**Fix.**
- Spec change: state explicitly that `inFlight[vendor]` counts every worker whose `status` is one of `working | stopping | blocked` (i.e., everything except `pending | idle | dead`), and only frees on confirmed-stop/forced-stop/dead, not on `interrupt()` being merely *requested*.
- New test: with `concurrencyCeiling:1`, call `interrupt()` on the sole active worker (gate its confirmation so it stays `'stopping'`), then attempt `spawn()` for a second task on the same vendor — assert it stays `'pending'` until the first worker's stop is actually confirmed, not merely requested.

---

## 7. [MAJOR] The "implicit `tick()` on every command" contract is never tested except via literal `.tick()` calls

**What's wrong.** §0 states: *"No background timer thread... every public command implicitly runs one internal `tick()` first."* This is central to the "no timer thread but nothing needs to hang" design. But scan every clock-driven test in `coordinator.test.mjs` (`:591`, `:739`) — **both** advance the fake clock and then call `coordinator.tick()` **explicitly**. Not one test advances the clock and then calls a *different* public command (`send()`, `list()`, `respond()`, `wait()` with a short timeout, etc.) to prove the deadline sweep fires as a side effect of that command. An implementation that hardcodes deadline-sweeping *only* inside the literally-named `tick()` method — and never calls it internally from `spawn`/`send`/`respond`/`interrupt`/`kill`/`list`/`result` — would pass all 53 documented behaviors while silently violating the documented no-timer/every-command-ticks contract. This is exactly "a property the spec states but no test proves."

**Fix.** New test: advance the clock past `stopDeadlineMs` (or `approvalTimeoutMs`), then call some command **other than `tick()`** (e.g. `coordinator.list()` or `coordinator.send(otherWorker, ...)`), and assert the deadline-driven transition (forced-stop / auto-deny) has already happened as an observable side effect — without any explicit `tick()` call anywhere in the test.

---

## 8. [MAJOR] Approval auto-resolve default is left as "deny/cancel" in the spec, and the test accepts either — a weak assertion baked into the contract itself

**What's wrong.** §3.5 respond, referenced by behavior 40: *"auto-resolves to the documented default (`deny`/`cancel`)"* — never actually pinned to one value. The test (`coordinator.test.mjs:744`) codifies the ambiguity instead of resolving it:

```js
assert.ok(['deny', 'cancel'].includes(approveCall.decision));
```

This would pass an implementation that returns `'deny'` on one code path and `'cancel'` on another for the same trigger — nondeterministic behavior masquerading as tested. It also means two independently-correct-per-spec implementations of Phase 5 could disagree on live behavior for every timed-out approval in the system.

**Fix.**
- Spec change: pick one value (recommend `'deny'` — fail-closed for a risk-gated action) and state it as the fixed default in §3.5, not an either/or.
- Test change: `assert.equal(approveCall.decision, 'deny')` (or whichever is chosen) — an exact match, not an `includes()`.

---

## 9. [MAJOR] `respond()`'s stale-turn drop (turnEpochAtAsk) is untested — and arguably unspecified — for approvals, only for questions

**What's wrong.** §3.5 respond step 4 (questions) references "a stale-turn answer is still dropped, see below," pointing at step 6, "Staleness for answers." Step 5 (approvals) has **no mention of staleness at all**. It's genuinely ambiguous whether step 6 is meant to apply to both `kind==='question'` and `kind==='approval'` records, or only questions (as its placement directly under step 4 suggests). Behavior 41 tests only the question path (`coordinator.test.mjs:750`). If approvals are *not* staleness-checked, then a human `respond()` for an approval that was asked in a now-superseded turn is delivered into the adapter regardless — which is a real "the human always wins" edge case worth getting right on purpose rather than by accident.

**Fix.**
- Spec change: state explicitly whether `turnEpochAtAsk` staleness-gating applies to `kind==='approval'` records too.
- New test: mirror behavior 41 but for an `approval.requested` record — bump the turn, then `respond()` — assert the decided behavior (delivered vs. dropped-with-`control.stale_rejected`) matches whatever is pinned.

---

## 10. [MAJOR] Dependency cycles are entirely unhandled — silent permanent deadlock, no invariant, no test

**What's wrong.** `spawn(vendor, brief, {deps:['t1']})` staying `pending` until deps resolve is well-tested (behavior 21). But nothing in the spec's invariants (C2 or elsewhere) or behavior list addresses `t1` depending on `t2` and `t2` depending on `t1` (or a longer cycle). Dispatch step 1 (*"Skip if `deps.some(d => tasks.get(d)?.status !== 'completed')`"*) will happily leave both tasks `pending` forever with zero diagnostic — no error, no `list()` distinction from an ordinary queued task, nothing in the log. An orchestrator agent driving this has no way to detect "this will never dispatch" versus "this is legitimately waiting its turn."

**Fix.**
- Spec change: either (a) validate the dep graph acyclic at `spawn()` time and throw a new typed error (e.g. `CyclicDependencyError`) on the call that would complete the cycle, or (b) have `tick()` detect cycles among `pending` tasks and surface them as an `attention` item (`type:'stall'` or a new kind) in `wait()`'s digest rather than silent starvation. Pick one.
- New test: construct a two-task cycle, run several `tick()`s, and assert the chosen detection/surfacing behavior — not silent permanent-pending.

---

## 11. [MAJOR] The fate of a `lifecycle.turn_completed` claim that arrives *during* the stopping window is never resolved

**What's wrong.** The test at `coordinator.test.mjs:511` ("while a worker is stopping, its worktree lease is not touched...") correctly proves the trust gate's worktree machinery is **not** invoked while `'stopping'` — good, C5 is exercised. But it never asserts what happens to that completion claim **after** the interrupt confirms. Does the trust gate run for it retroactively (the worker genuinely finished its work right as the interrupt landed)? Is it discarded as moot because an interrupt was requested? Both are defensible designs, but the spec is silent, and the test explicitly stops short of it (`await interruptPromise;` and the test ends — no assertion on final `task.status`).

**Fix.** Spec change: add a §3.5 clause for this race — e.g. "a `lifecycle.turn_completed` event received while `status==='stopping'` is queued and re-evaluated against the trust gate once `interrupt_confirmed` lands, UNLESS the interrupt's `actor` was human-initiated, in which case it is discarded as `cancelled` (human cancellation takes precedence over a claimed result)." Extend the existing test to assert the final `task.status` after `interruptPromise` resolves.

---

## 12. [MINOR] `send()`-while-stopping test doesn't verify the "no log entry" half of its own spec claim

**What's wrong.** §3.5 send step 2 promises: *"no adapter call, no log entry."* The test at `coordinator.test.mjs:439` verifies only `adapter.calls.prompt.length` is unchanged — it never reads the log to confirm nothing was appended for the rejected nudge.

**Fix.** Add `assert.deepEqual(log.read(handle.id).filter(e => e.kind.startsWith('control.')).length, <before>)` (or equivalent) to the existing test.

---

## 13. [MINOR] `WorkerNotFoundError` is only proven for `send()`; not for `interrupt`/`kill`/`respond`/`result`

**What's wrong.** Behavior 27 tests `send('no-such-worker', ...)` throws `WorkerNotFoundError`. `interrupt()`, `kill()`, and `result()` presumably share `getWorker(workerId)` per §3.5's shared phrasing ("Same shape as interrupt"), but no test exercises the unknown-worker path for any of them.

**Fix.** Add one `assert.rejects(..., WorkerNotFoundError)` test per command (`interrupt`, `kill`, `result`) with an unknown worker id.

---

## 14. [MINOR] C9 ("no silent emulation") is only tested for `send()`; `interrupt()`/`kill()` have no `emulated` field in their return type at all

**What's wrong.** `interrupt()`'s return shape (§3.3) is `{ok, result: 'confirmed'|'stale_fence'|'forced'}` — no `emulated` field, even though `Adapter.interrupt`/`.kill` can return `Ack.emulated===true` just like `prompt` can. C9's text ("propagated verbatim into the logged event and into `send()`'s return value") only names `send()`, leaving it unstated whether emulation info from an interrupt/kill Ack is dropped, or only logged (not returned), or both. Untested either way.

**Fix.** Spec change: extend C9's scope statement to explicitly cover `interrupt`/`kill`/`respond`, and decide whether their return shapes should also gain an `emulated` field. New test: an adapter whose `interrupt()` returns `{ok:true, emulated:true}` — assert the logged `control.interrupt_confirmed` (or wherever it's meant to land) carries `emulated:true`.

---

## 15. [MINOR — log.mjs] No test for a truncated/partial last line on crash-recovery ("disk-full/partial-write")

**What's wrong.** Behavior 3 / test at `log.test.mjs:95` proves crash-recovery of the seq counter from a *well-formed* existing file. Nothing constructs a file whose **last line is truncated** (simulating a real OS crash mid-`append()` — the exact "disk-full/partial-write" case called out in the assignment). Depending on implementation, a fresh `Log` recovering `tail()`/next-seq by reading the file could either crash on `JSON.parse` of the garbage trailing line, silently miscount (off-by-one seq), or handle it gracefully (ignore/truncate the partial line) — all three are plausible outcomes of unspecified behavior.

**Fix.** Spec change: state that `Log` construction/`tail()` recovery must tolerate and discard a trailing malformed/incomplete JSON line (treat it as if the crash happened before that append committed). New test: write a well-formed prefix + a deliberately truncated final line to `w1.jsonl`, construct a fresh `Log`, and assert `tail()`/next `append()` behaves as if the truncated line never existed (not a thrown parse error, not double-counted).

---

## Summary table

| # | Severity | Area | One-line issue |
|---|----------|------|-----------------|
| 1 | Blocker | respond()/adapter | question-answer delivery mechanism self-contradictory + untested |
| 2 | Blocker | interrupt/kill | composing interrupt()+kill() before first confirms can deadlock |
| 3 | Blocker | construction | replay-from-log procedure unspecified; test 47 bypasses it |
| 4 | Blocker | wait()/Cursor | cursor state-file location not in the public contract |
| 5 | Blocker | adapter seam | session Adapter vs. one-shot run() — no shim, no nudge mechanism, zero integration tests |
| 6 | Major | dispatch | inFlight accounting during stopping/blocked unspecified (GLM=1 race) |
| 7 | Major | tick() model | implicit-tick-on-every-command never tested except via explicit .tick() |
| 8 | Major | respond() | approval default "deny/cancel" unpinned; test accepts either |
| 9 | Major | respond() | staleness check scope (question vs approval) ambiguous |
| 10 | Major | dispatch | dependency cycles cause silent permanent deadlock |
| 11 | Major | interrupt | fate of completion claim arriving mid-stop unresolved |
| 12 | Minor | send() | "no log entry" half of stopping-rejection unverified |
| 13 | Minor | error taxonomy | WorkerNotFoundError untested for interrupt/kill/result |
| 14 | Minor | C9 | emulation propagation untested/unspecified for interrupt/kill |
| 15 | Minor | log.mjs | no truncated-last-line crash-recovery test |

**Files reviewed:** `/Users/wahargis/Development/Experiments/baton/spec/IMPLEMENTATION.md`, `/Users/wahargis/Development/Experiments/baton/SYSTEM.md`, `/Users/wahargis/Development/Experiments/baton/impl/test/log.test.mjs`, `/Users/wahargis/Development/Experiments/baton/impl/test/fence.test.mjs`, `/Users/wahargis/Development/Experiments/baton/impl/test/coordinator.test.mjs`, `/Users/wahargis/Development/Experiments/baton/impl/test/adapter.test.mjs`.