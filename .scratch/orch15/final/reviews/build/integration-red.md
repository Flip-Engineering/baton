# RED-TEAM findings — Messaging/Telemetry/Routing (Cluster 3) + Whole-System Integration

Scope covered: `spec/IMPLEMENTATION.md` (all three cluster specs, since whole-system composition requires reading all of them), `SYSTEM.md`, and `impl/test/{messages,story,router,coordinator,referee,adapter,worktree}.test.mjs`. Findings are ranked by severity; each cites the exact spec/test text and a concrete fix.

---

## 1. [BLOCKER] The coordinator's Adapter and Cluster B's adapter.mjs are not the same interface — and the mismatch is worse than "different shapes," it makes `send()` structurally impossible

**What's wrong.** Core's `Adapter` typedef (`spec/IMPLEMENTATION.md:333-346`) is session-shaped: `card/spawn/prompt/interrupt/approve/kill/onEvent`, where `prompt(worker, content, mode)` is how a *live, already-running* worker receives a `nudge`/`steer`/`turn` mid-flight, and `onEvent` streams events out over the worker's whole lifetime. Cluster B's actual `adapter.mjs` (`:752-763`) is one-shot: `card()` + `run(brief, opts) → Promise<WorkerResult>` — a single promise that resolves once, for the worker's *entire* run. `MockAdapter` and the three `SubprocessAdapter` subclasses (`CodexAdapter`/`ClaudeAdapter`/`GlmAdapter`) are all built this way (`:805-929`).

This isn't cosmetic. Core's `send(workerId, message, mode)` (`:415-419`, command body `:473-481`) calls `adapters[handle.vendor].prompt(handle, message, mode)` on a worker that is already mid-`run()`. Cluster B's `run()` has no `.prompt()` method and no way to inject a message into an in-flight call — the only lever exposed to a caller mid-run is `opts.signal` (abort). So as literally specified, **`send()` cannot be implemented against `adapter.mjs` at all** for `nudge`/`steer`/`turn` modes — only `interrupt` (→ abort) is possible. `send` is one of the 8 commands the whole system is built around (SYSTEM.md §4.1, §4.4: "the hard part, and the most carefully engineered").

The test suite already *knows* this and has quietly routed around it rather than flagging it as a design gap: `coordinator.test.mjs:6-20` has a "FIXTURE NOTE" that explicitly documents "The two clusters' Adapter typedefs are not interchangeable" and constructs its own local `ScriptableAdapter` fake instead of importing the real `MockAdapter`. That is the correct short-term move for keeping Core's suite buildable in isolation (per the spec's own "Test independence note," `:635`) — but it means **no test anywhere in the 221-test suite exercises the real `adapter.mjs` against the real coordinator**. The seam is real, acknowledged, and never closed.

**The concrete fix (contract decision for Phase 4).** Specify ONE adapter contract, session-shaped (matching `spec/adapter-contract.md:13-20`, which both clusters were supposed to be grounded in), and make Cluster B's `MockAdapter`/`SubprocessAdapter` implement *that* instead of `run()`:
```js
card(): HarnessCard
spawn(worker, brief): Promise<Ack>          // starts the run, does not block on completion
prompt(worker, content, mode): Promise<Ack> // nudge/steer/turn into a LIVE run
interrupt(worker, then?): Promise<Ack>      // two-phase stop
approve(worker, requestId, decision): Promise<Ack>
kill(worker): Promise<Ack>
onEvent(cb): void                           // pushes turn_started/file_edit/ask/turn_completed/... over the run's lifetime
```
`MockAdapter`'s existing `MockScenario` (edits/ask/crash/forgeSuccess) is good material — reshape it so `spawn()` starts the scripted run asynchronously (emitting via `onEvent`) and `prompt()`/`interrupt()` can act on it mid-flight, rather than being parameters accepted only at the start of one `run()` call. This makes the *same* `MockAdapter` usable by (a) `coordinator.test.mjs` for full session-driven tests and (b) `referee.test.mjs`'s flagship forge-catch test, which today only needs `spawn`-then-drain semantics and can trivially await the terminal event. Cluster B's spec (`:740-967`) needs to be rewritten to this contract before Phase 5 implements it — this is not a Phase-2-tests-only fix, it changes the module's public API.

---

## 2. [BLOCKER] Core's own trust-gate step never calls `referee.accept()` — the hardened checks (red→green, coverage-of-change) are unreachable from the coordinator

**What's wrong.** Cluster B builds a real hardened trust gate: `referee.verify()` returns a `Verdict` with `passed`, `redGreen`, `coverageOfChange`, `uncoveredChangedLines` (`:1194-1207`), and explicitly states (Invariant R3, `:1266`): *"`accept()` is the ONLY function whose return value may be used to decide 'done'/mergeable. No other boolean in this cluster... is sufficient by itself."*

But Core's own `Verdict` typedef (`:267-274`) is a **different, smaller shape** — `{reverified, observedExit, matchesClaim, locus, note}` — with no `passed`, no `redGreen`, no `coverageOfChange` field at all. And Core's trust-gate step 7 (`:521`), stated as "The command bodies, precisely," computes completion itself:
```
task.status = (verdict.reverified && verdict.observedExit === task.brief.verification.expectExit) ? 'completed' : 'failed'
```
This **never calls `accept()`**. It reimplements a weaker equivalent of `passed` by hand and silently drops the entire hardening cluster (red→green, coverage-of-change, and any future `requireRedGreen`/`requireCoverage` options) that SYSTEM.md §5.1 calls "the highest-value thing to build after the basic driver." As specced, wiring Cluster B's real `referee.mjs` behind Core's `RefereeFn` (`:350-354`, which itself takes `sandbox: string` — a bare path, not the `VerifySandbox` object `baseSandbox`/`cleanup()` that red→green needs) makes it structurally impossible to ever require red→green or coverage from the coordinator, because the coordinator's own completion logic doesn't consult those fields even if a passthrough shim preserved them.

**Confirmed untested, not just unspecified**: `coordinator.test.mjs`'s "forged done" test (`:821-840`) uses a referee fake that returns a fixed verdict lacking `passed`/`redGreen`/`coverageOfChange` and never asserts anything about them — so nothing in the suite would catch a coordinator that never grew an `accept()` call in the first place.

**The concrete fix.** 1) Unify `Verdict` — Core's typedef must be `Cluster B`'s full `Verdict` (import it, don't re-declare a subset). 2) Rewrite trust-gate step 7 to call `accept(verdict, {requireRedGreen, requireCoverage})` (with those options sourced from `Brief`/task config, defaulting false for MVP) rather than hand-rolling `observedExit === expectExit`. 3) Fix `RefereeFn`'s third parameter to be the `VerifySandbox` object (or an options bag carrying it plus `baseSandbox`), not a bare string. 4) Add a coordinator-level test: inject a referee whose `Verdict.passed===true` but `redGreen===false`, assert `accept()`-driven completion respects `requireRedGreen:true` and fails the task — this is the only way to prove the coordinator actually reads the hardened fields rather than recomputing its own weaker check.

---

## 3. [BLOCKER] The adaptive router is never wired to the trust gate — `router.record()` has no caller anywhere in Core's spec

**What's wrong.** Cluster 3's own module graph note claims: *"Cluster A's dispatch step and trust-gate step import `AdaptiveRouter` and call `pick()` / `record()`."* (`:1326`). But Core's actual dependency interface (`:367-370`) only injects a `RouteFn` — a **plain function** `(task, cards, inFlight) => string|null`, used solely in dispatch for `spawn(vendor:'auto')` (`CoordinatorOpts.route`, `:389`, `:630`). A bare function has no `.record()` method. Core's 8-step trust gate (`:513-522`) — read in full — appends `verify.reverified`, sets `task.verdict`, sets `task.status`, appends `lifecycle.turn_completed`. **It never calls anything named `record`.**

This means the router's central promise — "learns only from re-verified wins" (SYSTEM.md §5.2, router Invariant 1 `:1884`) — has no event that ever triggers it in the specified system. `router.mjs`'s 17 tests (`router.test.mjs`) are all excellent in isolation (hand-computed decay, recency-beats-old-losses with real numbers `:190-209`, new-model-not-starved `:264-283`, `RouterUsageError` on non-boolean `:333-346`), but they only prove the module is *correct if called*. Nothing proves — or even specifies — that it *is* called after a real trust-gate verdict. As shipped, this is a fully-built, fully-tested feature with no wire connecting it to the rest of the system; `pick()` would run forever against empty buckets.

**The concrete fix.** Change `CoordinatorOpts.route` to accept the full `AdaptiveRouter` instance (or `{pick, record}`), and add an explicit step to §3.6's trust gate: after step 7 resolves `task.status`, call `route.record(vendor, task.brief.taskType ?? 'default', task.status === 'completed', {taskId: task.id, family: adapters[vendor].card().harness})`. Add a coordinator-level integration test asserting that a `completed` verdict calls `record(..., true, ...)` and a `failed` one calls `record(..., false, ...)`, and — crucially — that a worker's own `WorkerResult.status:'completed'` claim, absent a passing trust-gate verdict, produces *no* `record()` call at all (this is the concrete form of "only verified wins count" the task asked me to check for — right now it's untestable because there's no call site to test).

---

## 4. [BLOCKER] Provenance-typing (fact vs. untrusted prose) is enforced only inside `messages.mjs`'s own unit tests — Core's actual `wait()` output has no provenance field to enforce

**What's wrong.** `messages.mjs`'s `Digest`/`Fact`/`ProseItem` typedefs (`:1428-1451`) carry structural provenance markers (`provenance:'hub-computed', untrusted:false` / `provenance:'model-authored', untrusted:true`), and `createDigest()` throws if either is missing (Invariant 4, `:1551`; behaviors 14-15, `:1570-1571`). This is well-built and well-tested *within `messages.test.mjs`*.

But Core's `wait()` command (`:421-423`) returns Core's **own, independently-declared** `Digest` typedef (`:296-313`):
```js
@typedef {Object} Digest
  @property {AttentionItem[]} attention
  @property {FactItem[]} facts
  @property {boolean} more
/** @typedef {Object} FactItem
  @property {string} worker @property {string} kind @property {number} seq
  @property {string} ts @property {*} payload */
```
`FactItem` has **no `provenance` field, no `untrusted` field, and no `prose` array at all** — and there is no `cursor` field either (compare to messages.mjs's `Digest.cursor`, `:1447`). Core's §3.5 command bodies never mention calling `messages.createDigest()`, `wrapFact()`, or `wrapProse()` anywhere. So the one piece of the system that actually reaches the orchestrator — `wait()`'s return value, the thing SYSTEM.md §4.3 calls "tagged by where it came from" as a load-bearing safety property (§5.6: "Untrusted-by-default... Shared facts carry where they came from") — is specified, by Core's own typedef, to carry **no provenance tag at all**. The guarantee "provenance-typing enforced as a structural property, not a convention" (messages.mjs responsibility line, `:1335`) is true only inside a module that Core's `wait()` never actually calls.

Confirmed empirically: `coordinator.test.mjs` never imports `messages.mjs` (`grep` for `provenance|untrusted|wrapFact|wrapProse` across the file returns zero hits), so no test would notice `wait()` shipping bare, untagged facts.

**The concrete fix.** Core's `Digest`/`FactItem`/`AttentionItem` typedefs must be deleted and replaced with `@typedef {import('./messages.mjs').Digest}` etc. (module-graph line 3 already *claims* Core imports messages.mjs — make the command bodies actually do it). Rewrite `wait()`'s implementation to build its return value via `wrapFact()`/`createDigest()` (never construct a bare `{worker,kind,seq,ts,payload}` object directly). Add a coordinator test that imports `isFact`/`isProse` from `messages.mjs` and asserts every entry in a real `wait()` digest passes `isFact()`, and that nothing worker-authored (e.g. `WorkerResult.summary`) ever appears un-wrapped in `facts`.

---

## 5. [MAJOR] Three incompatible `Brief` typedefs across the three cluster specs — already manifested as contradictory test fixtures

**What's wrong.** Compare the three "authoritative" `Brief` shapes:

| field | Cluster 1 Core (`:233-243`) | Cluster 2 Workers&Trust (`:698-709`) | Cluster 3 messages.mjs (`:1362-1375`) |
|---|---|---|---|
| `pathScope` | `string[]` | `string[]` | `{include: string[], exclude: string[]}` |
| `budget` | `{tokens, usd, wallMin}` | `{tokens, usd, wallMin}` | `{tokens, usd, wallMinutes}` |
| `tools` | *(absent)* | *(absent)* | `string[]` |
| `outputFormat` | *(absent)* | *(absent)* | `string` |
| `planGate` | *(absent)* | *(absent)* | `boolean?` |

This is not theoretical — it is already baked into the test suites as **incompatible fixtures for the same conceptual object**: `messages.test.mjs:32,37` builds `pathScope: {include:[...], exclude:[...]}` and `budget:{...,wallMinutes:30}`; `coordinator.test.mjs:54,57` builds `pathScope: ['.']` and `budget:{...,wallMin:30}`; `story.test.mjs:32,37` follows Cluster 3's object-shaped `pathScope`. Since `story.mjs`'s out-of-scope and path-scope-collision signals (`:1707-1712`, behaviors 12/14 `:1766,1768`) hard-require `brief.pathScope.include` as a glob array on an *object*, any real `Brief` built to Cluster 1/2's `string[]` typedef would make `brief.pathScope.include` `undefined`, and `out_of_scope`/`path_scope_collision` would never fire against a real Core-produced worker.

**The concrete fix.** Pick one shape (Cluster 3's, since it's the richer, structurally-necessary one for story.mjs and is what a real "delegation contract" per SYSTEM.md §4.2 needs — tools/outputFormat/planGate are all named in prose there). Update Cluster 1 §3.1 and Cluster 2 §1's `Brief` typedefs to `@typedef {import('./messages.mjs').Brief} Brief` and delete the duplicated, drifted inline declarations. Update `coordinator.test.mjs`'s `makeBrief()` fixture to match. Add one cross-cluster test (see Finding 8) that constructs a `Brief` via `messages.createBrief()` and passes it, unmodified, all the way through `spawn()` → `lifecycle.spawned` payload → `StoryCompiler.ingest()` → `computeSignals()`, asserting `out_of_scope` fires — this is the only way to prove the shapes actually agree.

---

## 6. [MAJOR] Event-kind literal drift: Core's `EventKind` says `question.resolved`, `story.mjs`'s `KIND` map expects `question.answered` — a real event stream would leave the story permanently wrong

**What's wrong.** Core's `EventKind` union (`:48-56`) includes `'question.resolved'`, and `respond()`'s command body (`:498`) literally appends `question.resolved`. `story.mjs`'s `KIND` map (`:1653-1672`) defines `QUESTION_ANSWERED: 'question.answered'` — a **different string**. Per `foldEvent`'s own documented behavior for unrecognized kinds (Invariant 7, `:1750`; behavior 18, `:1772`), an event whose `kind` doesn't match any `KIND.*` value is bookkept (updates `lastEventSeq`/`lastEventTs`) but otherwise ignored. So a real `question.resolved` event from a real coordinator would **never** transition a worker's story status back from `input_required` to `working`, and would never clear `questionsPending` — the fleet narrative would show that worker permanently "blocked — waiting on: ..." forever after the question was actually answered.

This is exactly the failure mode the spec itself warns about: *"If Cluster A's log emits different literal strings, only `KIND` needs editing — this is the one place a naming mismatch between clusters will surface as silently-ignored events, so it should be agreed before either side writes tests against fixtures."* (`:1329`). That agreement never happened — the two literal enums disagree on this string today.

`story.test.mjs`'s own test for this transition (`:180-193`) uses `KIND.QUESTION_ANSWERED` directly (the constant, not a hardcoded string), so it will always pass regardless of what Core actually emits — it tests the fold logic, not cross-cluster agreement.

Secondary instance of the same class of bug: `story.mjs`'s `KIND` map includes `FILE_EDIT: 'action.file_edit'` and `COMMAND_EXEC: 'action.command_exec'` (needed for out-of-scope and looping detection, behaviors 10/12), but Core's `EventKind` union (`:48-56`) **does not contain these two kinds at all**, and Core's own command bodies never emit them. Only Cluster B's one-shot `MockAdapter` emits `action.file_edit` (`:874`) — but per Finding 1, that adapter is architecturally disconnected from Core's session-based event stream. In the specified system as it stands, `story.mjs`'s looping and out-of-scope signals have **no real event source** feeding them at all.

**The concrete fix.** 1) Reconcile the literal: either Core emits `question.answered` or `story.mjs`'s `KIND.QUESTION_ANSWERED` is changed to `'question.resolved'` — pick one and make it the single source of truth (`story.mjs` should `import {EventKind}` — or its literal values — from Core rather than re-declaring, or Core should re-export `KIND` from `story.mjs`). 2) Add `action.file_edit`/`action.command_exec`/`resource.budget_threshold` to Core's `EventKind` union and specify *where* in the command bodies they get appended (they must come from the (unified, per Finding 1) session adapter's `onEvent` stream, forwarded verbatim by Core's `log.append`). 3) Add a test in `story.test.mjs` (or the new integration suite) that builds its event fixtures using **hardcoded literal strings copied from Core's spec**, not `story.mjs`'s own `KIND` constants — this is the only test shape that can actually catch a re-drift.

---

## 7. [MAJOR] The "same done command" invariant is asserted by spec, but the flagship coordinator test can't actually distinguish it from the alternative

**What's wrong.** messages.mjs Invariant 2 states: *"A `Brief`'s `verification.command` is the one and only command that ever defines 'done'... no field anywhere lets a worker or a later message override it."* (`:1549`). Core's trust gate correctly *sources* the command from `task.brief.verification` (step 4, `:518`), never from `task.result.verification` — good, that part of Core's spec is right.

But `coordinator.test.mjs`'s "forged done" test (behavior 43, `:821-840`) — the test explicitly named for this property — never checks *which* verification object the referee was actually invoked with. It passes `referee: failingReferee(1)`, a fake that (per its name) ignores its arguments and just returns exit 1. And critically, the fixtures make this untestable even in principle: `makeBrief()` (`:56`) sets `verification.command: 'true'`; `makeWorkerResult()` (`:67`) *also* sets `verification.command: 'true'` — **identical by construction**. A broken implementation that accidentally re-runs `task.result.verification.command` (the worker's own, unverified claim) instead of `task.brief.verification.command` would pass every test in the suite, because nothing ever gives the two commands different values and nothing ever asserts on `opts.pinnedVerification`/the sandbox call's actual command argument.

**The concrete fix.** Strengthen behavior 43: set `brief.verification.command = 'exit 1'` (a command that would genuinely fail) and `result.verification.command = 'true'` (a command the worker could have snuck in as its own self-serving "done" check, claiming exit 0). Assert two things: (a) the fake referee is invoked with a pinned-verification `command` equal to `'exit 1'` (the brief's), never `'true'` (the worker's claim) — capture and assert on the actual argument, not just the outcome; (b) `task.status` ends `'failed'`. This is the only version of the test that would catch a coordinator wired to trust the wrong source.

---

## 8. [MAJOR] Zero end-to-end integration tests exist across the three clusters — self-acknowledged, not accidental

**What's wrong.** Every cross-cluster seam identified above (1, 2, 3, 4, 5, 6) is invisible to the current 221-test suite because no test wires more than one cluster's *real* modules together against Core's real `Coordinator`. Evidence:
- `coordinator.test.mjs` imports only `Coordinator`/`Log`/`FenceTable` and hand-rolls local fakes for `Adapter`/`WorktreeManager`/`RefereeFn`/`RouteFn` (`:27-34`, and explicitly directed to by spec `:635`).
- `referee.test.mjs`'s flagship forge-catch test (`:148-188`) wires `worktree.mjs` + `adapter.mjs` (`MockAdapter`) + `referee.mjs` together — a real Cluster-B-internal integration test — but never touches `coordinator.mjs`.
- No test file imports both `coordinator.mjs` and any of `messages.mjs`/`story.mjs`/`router.mjs`.

This is architecturally sound as a testing *strategy* per-cluster (keeps each cluster buildable independently — a legitimate, stated tradeoff, `:635`) but it means the seams are, by construction, never exercised. SYSTEM.md's own §8.1 MVP promise — "prove the hard parts" (dependable interrupt/steer, trustworthy done) — cannot be verified by this suite as it stands, because the hard parts are precisely at these boundaries.

**The one end-to-end integration test the suite is missing** (propose as a new `impl/test/integration.test.mjs`, run only after Findings 1-6 are resolved):

> Construct a real `Coordinator` wired with: the *unified* session-shaped `MockAdapter` (post-Finding-1 fix), the real `worktree.mjs` against a real temp git repo, the real `referee.verify`/`accept` (post-Finding-2 fix), a real `AdaptiveRouter` (post-Finding-3 fix), and a real `StoryCompiler` fed via `story: {record: c => compiler.ingest(c)}`. Build the `Brief` via `messages.createBrief()` (not a hand-rolled object). Script the `MockAdapter` with `forgeSuccess:true` and edits that do not satisfy the pinned command. Drive: `spawn` → worker emits `completed` → trust gate re-verifies in a fresh sandbox → **assert task ends `failed`** (the lie is caught) → **assert `router.getStat(...)` was updated with `verifiedWin:false`**, never `true` → **assert `StoryCompiler.narrative()`** reflects the failure/rejection, not a false "done" → **assert `coordinator.wait()`'s digest carries `isFact()`-passing entries only**, no bare/untagged data. Every assertion here fails today, for a different one of Findings 1-6, against the spec as written — which is exactly why it's the highest-value test to add before Phase 5 implementation starts.

---

## 9. [MINOR] StorySink wiring is described in prose but has zero test coverage

**What's wrong.** Core's dependency summary states: *"Core calls `story.record(event)` fire-and-forget (wrapped in try/catch — a broken story sink must never affect coordinator correctness or block a command)."* (`:631`). This is a real invariant (a throwing `StorySink` must not break `spawn`/`send`/etc.) but it appears nowhere in Core's numbered "Behaviors to test" list (§5, `:548-620`) and `coordinator.test.mjs` has zero references to `story`/`StorySink`/`record(`. Nobody will notice if this wrapping is omitted.

**The concrete fix.** Add to Core's behaviors-to-test list: (a) every appended `BatonEvent` triggers exactly one `story.record(event)` call with the exact event object; (b) a `StorySink.record` that throws synchronously does not propagate out of `spawn`/`send`/`interrupt`/etc. — the command still returns its normal result.

---

## 10. [MINOR] Spec self-contradicts on which cluster owns "the glue" — a naming slip, but the kind that confuses an implementer

**What's wrong.** Cluster 1 is named "CORE" and explicitly owns `coordinator.mjs` with the exact 8 commands (`spawn/send/wait/respond/interrupt/result/list/kill`, `:408-447`), and is referred to elsewhere as "Cluster A" (Cluster 3's own module graph, `:1316`). But Cluster 2's closing section says: *"Cluster C (the coordinator/CLI-command layer that will implement `spawn`/`send`/`wait`/`respond`/`interrupt`/`result`/`list`/`kill`)"* (`:1301`) — misnaming Core as "Cluster C," which per Cluster 1's own §3.2 (`:367-376`) is actually the router/story cluster. This is a copy-paste-era labeling slip, not a functional bug, but it's exactly the kind of ambiguity that leads an implementer to look for "the glue that wires worktree+referee+adapter into spawn()" in the wrong cluster's spec.

**The concrete fix.** Global find/replace in Cluster 2's §5 closing paragraph: "Cluster C" → "Cluster A / Core." Cheap, but should happen before Phase 5.

---

## 11. [MINOR] `WorktreeManager` (Core's dependency interface) doesn't match any function `worktree.mjs` actually exports

**What's wrong.** Core's `WorktreeManager` interface (`:356-365`) is `{create(taskId, baseRef?), capture(worktreePath), createVerifyWorktree(taskId, sha), removeVerifyWorktree(verifyPath), remove(taskId), reconcile()}`. `worktree.mjs`'s real exports (`:1026-1117`) are `pinBaseSha(repoRoot, opts)`, `createFromBase(repoRoot, taskId, baseSha, opts)`, `captureCommit(repoRoot, taskId, opts)`, `freshVerifySandbox(repoRoot, label, sha, opts)` (returns a `VerifySandbox` with a `.cleanup()` method — there is no standalone `removeVerifyWorktree` function), `markStopped`, `reap`, `reconcile`, `changedLines`, `listWorktrees`. No name matches, the argument shapes don't line up (`create(taskId, baseRef)` vs. `createFromBase(repoRoot, taskId, baseSha, opts)`), and cleanup is modeled as a closure method on the returned object in Cluster B vs. a free function taking a path in Core. Someone has to write a nontrivial adapter shim between these two interfaces, and — consistent with every other finding here — nothing in either test suite exercises that shim, because it doesn't exist yet as a spec artifact at all.

**The concrete fix.** Either (a) rewrite Core's `WorktreeManager` typedef to literally be `worktree.mjs`'s real export surface (preferred — stop maintaining a shadow interface), or (b) if the abstraction layer is intentional (e.g. to support a future non-git worktree backend), write the shim as a named, spec'd, tested module (`worktree-manager-adapter.mjs`) rather than leaving it as an implicit obligation on whoever writes "the glue."

---

## Summary for Phase 4 (Blue)

The unit-level work in Cluster 3 (`messages.mjs`, `story.mjs`, `router.mjs`) is well-specified and its own tests are largely rigorous — the recency-bias and new-model-not-starved router tests in particular use real hand-computed numbers and are hard to game. The severe problems are all at the **seams**: Core's coordinator, as literally specified, cannot actually drive Cluster B's adapter (Finding 1), does not consult Cluster B's hardened trust gate (Finding 2), never calls into Cluster 3's router (Finding 3) or messages.mjs's provenance wrapping (Finding 4), and three different cluster specs disagree on what a `Brief` even looks like (Finding 5) or what a resolved-question event is called (Finding 6). None of this is visible in the current 221 tests because — by explicit, documented design choice — no test wires more than one cluster's real modules together. Before Phase 5 implementation starts, Phase 4 should: (a) delete the duplicated `Brief`/`Digest`/`Verdict` typedefs from Core's spec in favor of importing Cluster 2/3's real ones, (b) rewrite Cluster B's `adapter.mjs` to the session-shaped contract from `spec/adapter-contract.md`, (c) add the explicit `router.record()` and `accept()` call sites to Core's trust-gate step, and (d) add the one integration test in Finding 8, which will fail loudly against every one of these gaps until they're actually closed.