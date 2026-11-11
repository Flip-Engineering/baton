# Red-Team Findings — Cluster 2 (Workers & Trust): adapter.mjs, worktree.mjs, referee.mjs

Scope: `spec/IMPLEMENTATION.md` §§2–4 (Cluster 2) plus its cross-cluster seams into Cluster 1 (`impl/test/adapter.test.mjs`, `worktree.test.mjs`, `referee.test.mjs`, cross-referenced against §3 of Cluster 1 where the coordinator consumes this cluster's exports). No implementation exists yet — every finding below is a spec/test defect, not a code bug.

---

## 1. BLOCKER — Coordinator bypasses `accept()`/`Verdict` hardening entirely; the "hardened trust gate" is dead on arrival at the integration boundary

**What's wrong.** Cluster 1's own `Verdict` typedef (§3.1) is:
```js
@typedef {Object} Verdict
@property {boolean} reverified
@property {number|null} observedExit
@property {boolean} matchesClaim
@property {'fresh_sandbox'} locus
@property {string} note
```
It has **no `passed`, `redGreen`, or `coverageOfChange` field** — the exact fields `referee.mjs`'s real `Verdict` (§4) exists to produce. And the coordinator's trust-gate body (§3.6 step 7) computes completion **inline**, never through `accept()`:
```
task.status = (verdict.reverified && verdict.observedExit === task.brief.verification.expectExit) ? 'completed' : 'failed'
```
This directly violates referee.mjs's own **R3**: *"`accept()` is the ONLY function whose return value may be used to decide 'done'/mergeable... `passed` alone ignores the hardening flags a caller may have required."* As literally spec'd, the coordinator never calls `accept()`, never reads `redGreen`/`coverageOfChange`, and can't — its own `Verdict` shape doesn't carry them. Red→green and coverage-of-change (SYSTEM.md §5.1's flagship trust feature, "right after MVP") become inert decoration: a task with `redGreen:false` ("suspicious green-green," referee test #54) or `coverageOfChange:false` (referee test #57) still gets marked `'completed'` by the coordinator, because the coordinator's completion predicate literally cannot see those fields.

Compounding this, `RefereeFn`'s call signature also doesn't match `verify()`'s real signature: Cluster 1 declares
```js
RefereeFn = (task, result, opts: {pinnedVerification, sandbox: string}) => Promise<Verdict>
```
but `referee.mjs` exports `verify(task, result, sandbox: VerifySandbox, opts)` — a **4-arg** function where `sandbox` is a positional `{dir, sha, cleanup}` object, not a string bundled into `opts`. Whoever wires Cluster 1 to Cluster 2 has to reconcile both the arg shape *and* the return-value shape, and nothing in either spec says how.

**The concrete fix.**
- Change Cluster 1's `Verdict` typedef to literally be (or `extends`) referee.mjs's real `Verdict` — same fields, no subset.
- Change §3.6 step 7 to: `task.verdict = verdict; task.status = accept(verdict, {requireRedGreen: task.brief.requireRedGreen, requireCoverage: task.brief.requireCoverage}) ? 'completed' : 'failed'` — routing completion through `accept()`, not an inline recomputation.
- Change `RefereeFn`'s typedef to match `verify`'s real signature (or explicitly document that Cluster A's `RefereeFn` glue = `(task, result, sandbox, opts) => verify(task, result, sandbox, opts).then(v => v)` composed with a *separate* injected `accept` policy).
- Add a Cluster-1-side test (flagged here since it's the seam, actionable by whoever owns coordinator.test.mjs) asserting that a `redGreen:false` or `coverageOfChange:false` verdict, when `requireRedGreen`/`requireCoverage` are configured, does **not** produce `task.status==='completed'`.

---

## 2. BLOCKER — Session adapter (coordinator) vs one-shot adapter (`adapter.mjs`): no unified contract exists

**What's wrong.** Cluster 1's dependency interface (§3.2) is:
```js
Adapter = { card(), spawn(worker,brief)=>Ack, prompt(worker,content,mode)=>Ack,
            interrupt(worker,then?)=>Ack, approve(worker,id,decision)=>Ack,
            kill(worker)=>Ack, onEvent(cb) }
```
— a long-lived **session**: a worker persists across multiple turns, `send(mode:'nudge'|'steer'|'turn')` can hit it repeatedly, and confirmation of state changes streams back via `onEvent`.

Cluster 2's actual `adapter.mjs` (§2) is:
```js
Adapter = { card(), run(brief, opts) => Promise<WorkerResult> }
```
— **one-shot**: called once, resolves once to a terminal result. There is no method to inject a nudge or a steer into an in-flight `run()`. The only external interaction points a running `MockAdapter` exposes are `opts.signal` (abort) and `opts.onAsk` (answer one pending question). There is no `RunOpts.inbox`/`onSteer` hook at all.

This is exactly the seam the task flagged as known, and the spec does not resolve it — it just states both interfaces independently in their respective clusters as if they were the same thing (§6 of Cluster 1 says "Cluster B — adapter: `Adapter.card/spawn/prompt/interrupt/approve/kill/onEvent`" while Cluster 2's own §5 cross-cluster summary never mentions those method names at all). Three concrete incompatibilities:

- **No nudge/steer channel.** A session adapter's `prompt(worker, msg, 'nudge'|'steer')` has nothing to map to on a one-shot `run()`.
- **Confirmation model differs.** Cluster 1 interrupt() step 6 says the coordinator "Await[s] the adapter's authoritative confirmed-stop event (delivered via `onEvent`, matched by `workerId` + the bumped `stamp.fence`)" — an **event-based** confirmation. Cluster 2's A5 says confirmation is "the promise settled" — a **promise-based** confirmation. A wrapper has to synthesize a `control.interrupt_confirmed` event out of promise settlement, but:
- **`fence` doesn't exist anywhere in Cluster 2.** `RunOpts` carries `workerId`/`turnEpoch` but no `fence`. Cluster 1's own `BatonEvent` typedef (§1.1) doesn't carry `fence` either (only `turnEpoch`) — so "matched by ... the bumped `stamp.fence`" (§3.5) has no field to match against anywhere in the log-event shape, on either side of the seam.

**The concrete fix.** Pin down a unified `SessionAdapter` decision in the spec, e.g.:
1. Add `RunOpts.inbox: {nudge(text), steer(text)}` (a caller-supplied object the running adapter polls/reacts to, mirroring how `opts.signal`/`opts.onAsk` already work) and extend `MockScenario` with an `onSteer`/`onNudge` continuation (mirroring `onAnswerEdits`) so `MockAdapter` can react deterministically and testably.
2. Specify a concrete `SessionAdapter` wrapper class (owned by Cluster C's "glue," but its exact method bodies belong in this spec since MockAdapter must satisfy it):
   - `spawn()`: fire-and-forget `run()`, store the promise; resolve `spawn()`'s own Ack once the `lifecycle.turn_started` log event has round-tripped through `opts.log`.
   - `prompt(..., 'nudge'|'steer')`: calls `inbox.nudge/steer`; for `'turn'`, only valid once the prior `run()` has settled (a new turn = a new `run()` call).
   - `interrupt()`: aborts `opts.signal`, awaits the stored promise, **and** synthesizes `control.interrupt_confirmed` via the `onEvent` callback once it settles.
   - `approve()`: resolves the pending `onAsk` promise.
   - `onEvent(cb)`: passed straight through as `opts.log = {append: e => cb(e)}`.
3. Add `BatonEvent.fence`/`LogEventInput` needs a `fence` field (or document explicitly that fence-matching is done by the coordinator against its own in-memory `FenceTable`, never against the log, and delete "matched by ... `stamp.fence`" from §3.5's prose).
4. Add a cross-cluster test: instantiate `MockAdapter`, wrap it in the `SessionAdapter`, and run it through `coordinator.test.mjs`'s existing scenarios — this is the test that would have caught this seam.

---

## 3. BLOCKER — `WorktreeManager` (Cluster 1 dependency interface) is a different API from worktree.mjs's real exports, and `reap()`'s load-bearing precondition is never invoked by the coordinator as spec'd

**What's wrong.** Cluster 1 §3.2 declares:
```js
WorktreeManager = {
  create(taskId, baseRef?) => {path, branch, baseSha},
  capture(worktreePath) => {sha},
  createVerifyWorktree(taskId, sha) => {path},
  removeVerifyWorktree(verifyPath) => void,
  remove(taskId) => void,
  reconcile() => void,
}
```
Cluster 2's real `worktree.mjs` exports:
```js
pinBaseSha(repoRoot, opts), createFromBase(repoRoot, taskId, baseSha, opts) => WorktreeHandle{...,dir,...},
captureCommit(repoRoot, taskId, opts) => {sha, snapshotted},
freshVerifySandbox(repoRoot, label, sha, opts) => VerifySandbox{dir, sha, cleanup()},
markStopped(repoRoot, taskId), reap(repoRoot, taskId, opts),
reconcile(repoRoot, expectedActiveTaskIds, opts) => ReconcileReport,
```
None of the names, arities, or return shapes line up 1:1 (`path` vs `dir`; `capture(worktreePath)` vs `captureCommit(repoRoot, taskId, opts)`; `removeVerifyWorktree(verifyPath)` as a free function vs `sandbox.cleanup()` as a bound method on an object the caller must have kept alive; zero-arg `reconcile()` vs `reconcile(repoRoot, expectedActiveTaskIds, opts)`, which needs a list the coordinator must derive from the log itself).

The dangerous part: `reap()` **throws `WorktreeLockedError` unless `markStopped()` was called first** (W5, test #36). But nowhere in Cluster 1's `spawn`/`interrupt`/`kill` command bodies (§3.5) is `markStopped` ever mentioned or called — `kill()`'s spec text says only *"`worktrees.remove(taskId)` is called only after confirmed death"*. If the glue implementer writes the obvious `remove: taskId => worktree.reap(repoRoot, taskId)`, **every single task completion** (not just interrupted ones) throws `WorktreeLockedError`, because `markStopped` was never called for a task that finished normally.

**The concrete fix.** Either:
- (a) Add `markStopped(taskId)` as a 7th method on the `WorktreeManager` typedef and add an explicit step to §3.5's `interrupt`/`kill`/completion-cleanup bodies: *"call `worktrees.markStopped(taskId)` immediately before `worktrees.remove(taskId)`, unconditionally — by the time `remove` is reached the coordinator's own state machine has already confirmed the stop, so this call is a formality that satisfies worktree.mjs's precondition."* — or —
- (b) Have the glue's `remove()` implementation call `markStopped` + `reap` together internally, and add exactly one test (integration, Cluster A-side) asserting `remove(taskId)` succeeds on both a normally-completed and an interrupted task.
- Regardless, the spec needs one literal glue-class code sample (a few dozen lines, like the `MockAdapter` sample) showing the full name/arity mapping, since right now an implementer has to invent it from scratch and could easily invent it wrong (as above).

---

## 4. MAJOR — R1's defensive guard is optional; the system's single most load-bearing invariant has an opt-out, and even the flagship test doesn't exercise it

**What's wrong.** `RefereeTask.workerWorktreeDir` is documented as *"omit if unknown"* (§4, `RefereeTask` typedef), and R1 says it's enforced *"structurally... AND defensively"* — but the defensive half only fires if the caller remembers to pass this field. If the coordinator's glue (per finding #3, already under-specified) simply forgets it, `verify()` silently runs with zero defense against a same-directory bug, relying purely on `worktree.mjs`'s structural namespacing holding in every code path forever.

Worse: the test billed as *"the flagship integration test"* (referee.test.mjs #52, lines 151-189) constructs `task = { id: 'forge-task', verification: brief.verification }` — **no `workerWorktreeDir` at all**. The single most important test in the cluster doesn't exercise the R1 defensive check.

**The concrete fix.**
- Make `workerWorktreeDir` a **required** field of `RefereeTask` (not `[workerWorktreeDir]`), forcing every caller to either supply the real worker worktree path (arming the defense) or an explicit sentinel that documents "I structurally guarantee separation and take responsibility for it" — never a silent omission.
- Add `task.workerWorktreeDir: handle.dir` to the flagship test (referee.test.mjs #52) so it actually exercises both the structural *and* defensive guarantees simultaneously.

---

## 5. MAJOR — Event-kind vocabulary drift: Cluster 1's `EventKind` enum doesn't include what Cluster 2 is spec'd (and tested) to emit

**What's wrong.** Cluster 1's `EventKind` union (§1.1, lines 48-56) is a closed list:
```
'lifecycle.spawned'|'lifecycle.turn_started'|'lifecycle.turn_completed'|
'lifecycle.session_compacted'|'lifecycle.exited'|'lifecycle.crashed'|
'control.nudge'|'control.steer'|'control.send'|'control.interrupt_requested'|
'control.interrupt_confirmed'|'control.stale_rejected'|'control.forced_stop'|
'approval.requested'|'approval.resolved'|'question.asked'|'question.resolved'|
'resource.tokens'|'resource.budget_threshold'|
'health.stall_suspected'|'health.loop_suspected'|
'verify.reverified'|'kill.requested'|'kill.confirmed'|'error'
```
It contains **no `action.file_edit`**, yet `adapter.mjs`'s spec explicitly requires `MockAdapter.run` to emit *"zero-or-more `action.file_edit` (one per applied edit)"* and `adapter.test.mjs` (behavior #16, line 450) hard-asserts `kinds.filter(k => k === 'action.file_edit').length === 2`. It also contains **no `worktree.*` prefix at all**, yet `worktree.mjs`'s own behavior-to-test #46 instructs: *"pick and document a fixed vocabulary, e.g. `worktree.created`, `worktree.captured`, `worktree.verify_sandbox_created`, `worktree.reaped`, `worktree.reconciled`."* If `Log.append()` (or any downstream consumer keyed off `EventKind`, e.g. Cluster 3's story compiler's `KIND` map) treats this as an exhaustive/validated union, every worktree-lifecycle and file-edit event is a spec violation by construction.

**The concrete fix.** Extend Cluster 1's `EventKind` union to include `'action.file_edit'` and the fixed `worktree.*` vocabulary worktree.mjs's test #46 asks for (pick the literal 5 strings now, in this doc, not "e.g."), or explicitly annotate `EventKind` as non-exhaustive (`| string`) and drop any validation against it in `Log.append()`. Also update Cluster 3's note (§0, line 1329) which already flags `story.mjs`'s `KIND` map as the "one place a naming mismatch... will surface as silently-ignored events" — that mismatch is real today, not hypothetical, for `action.file_edit` and `worktree.*`.

---

## 6. MAJOR — Spec self-contradiction: `CodexAdapter`'s declared `steer` verb directly contradicts invariant A7's own example

**What's wrong.** The `CodexAdapter.card()` doc comment (line 909-910) states:
```js
/** verbs: {spawn:"native", interrupt:"native", steer:"native", ask:"native"} */
```
Invariant A7 (line 939) states:
> "`card()` never claims `"native"` for a verb the adapter cannot actually do; where SubprocessAdapter behavior is genuinely unverified (**e.g. Codex `turn/steer` timing** per `spec/adapter-contract.md`), the card must say `"emulated"` or omit the verb rather than assert `"native"` speculatively."

A7 names Codex's `steer` timing as its own illustrative example of a verb that must NOT be asserted native, while the class spec three lines above (relatively) asserts exactly `steer:"native"` for that same adapter. (Note: SYSTEM.md §6 does say "Codex can redirect a running turn directly," which supports the `"native"` claim and suggests A7's parenthetical is the actual error — but either way, the two passages inside `IMPLEMENTATION.md` contradict each other and Phase 5 has no way to know which one is authoritative.)

No test catches this: behavior #1 in adapter.test.mjs only checks that `'spawn'`/`'interrupt'` keys exist in `verbs`, never asserting the value of `'steer'`/`'ask'` for any SubprocessAdapter subclass.

**The concrete fix.** Resolve the contradiction in the prose (most likely: fix A7's parenthetical to cite a genuinely-unverified verb, e.g. "Codex's exact re-prompt-after-interrupt latency" rather than steer-nativeness itself, since SYSTEM.md commits to native steer for Codex). Then add a test that pins the exact `verbs` map per adapter subclass (not just key-presence), so this class of contradiction can't recur silently.

---

## 7. MODERATE — Flagship forge-catch test proves re-verification happens, but not that *freshness* is what catches the forgery

**What's wrong.** In referee.test.mjs #52, the scripted lie (`scenario.forgeSuccess:true`, `edits: [{path:'unrelated.txt', ...}]`) never writes `done.txt` **anywhere** — not in the worker's own worktree, not in any commit. So the verification command (`test -f done.txt`) would fail identically whether `verify()` ran in the genuinely-fresh sandbox or (hypothetically, if a future refactor introduced a bug) in the worker's own worktree directly. The test therefore proves "referee re-runs the check and doesn't trust the claim," but does **not** prove "running in a fresh sandbox specifically matters" — the one property R1 exists to guarantee. `worktree.test.mjs` #32 separately proves structural directory-distinctness, but nothing proves the *consequence* of that distinctness (a differing verdict).

**The concrete fix.** Add a test where the worker's own worktree (before capture) contains an uncommitted or build-only artifact that would make the pinned check spuriously **pass** if run there directly, while the fresh sandbox at the captured commit genuinely fails (e.g., a worker that writes `done.txt` to disk but the git commit — inspected by `captureCommit` — never actually includes it because of a `.gitignore` entry, or a build cache directory the mock never commits). Assert the fresh-sandbox verdict is `passed:false` even though "checking the worker's directory as-is" would have shown `passed:true`. This is the test that actually earns R1's "the load-bearing one" label.

---

## 8. MINOR — Weak `argv()` assertions with a vacuous escape hatch

**What's wrong.** In adapter.test.mjs (lines 530-550):
```js
assert.ok(codex.args.some((a) => a.includes(brief.verification.command)) || codex.args.length === 4, ...)
```
The `|| codex.args.length === 4` branch means a broken `argv()` that renders e.g. `["exec","--json","--skip-git-repo-check","GARBAGE"]` (any 4th string, containing nothing of the brief) still **passes**. Separately, the `claude`/`glm` assertions in the same test only check `args[0]==='-p'` and flag presence (`--permission-mode`, `acceptEdits`) — never that the rendered-brief positional argument actually contains the pinned verification command, i.e. the wiring between `argv()` and `renderBrief()` is untested (only `renderBrief()` itself is directly tested, in isolation, at behavior #18).

**The concrete fix.** Drop the `|| args.length === 4` fallback; assert directly `codex.args[3] === renderBrief(brief, 'codex-v2')` (or at minimum `.includes(brief.verification.command)` unconditionally). Add the equivalent direct assertion for `claude.args` / `glm.args`'s brief-bearing argument.

---

## 9. MINOR — `reconcile()`'s log-event attribution is unspecified and untested

**What's wrong.** worktree.mjs's `LogEventInput.worker` doc (§0) says: *"worker id, or a fixed sentinel (`"referee"`,`"worktree"`) for non-worker-scoped events."* `reconcile()` can remove multiple zombie directories (multiple distinct `taskId`s) in one call. The spec never states whether it emits one log event per removed taskId (`worker: <taskId>`) or a single aggregate event (`worker: "worktree"`, payload listing all removed ids), and worktree.test.mjs behavior #46 only checks `events.every(e => prefixOk(e.kind))` — never inspecting the `worker` field. Any downstream consumer (Cluster 3's story compiler, or a future per-task audit trail) needs this pinned down.

**The concrete fix.** Specify explicitly: *"`reconcile()` emits one `worktree.reconciled` event per removed directory, `worker: <that dir's taskId>`, plus (if `prunedAdminEntries` is non-empty) one aggregate event with `worker: "worktree"`."* Add an assertion on the `worker` field to test #46.

---

## 10. MINOR — Indirect assertions where a direct one is available and cheap

- **`pinBaseSha` autoStash test** (worktree.test.mjs, "autoStash:true stashes...") infers non-popping only via repo-cleanliness + HEAD-matching, never directly checking `git stash list` contains `result.stashRef`. W4 ("never auto-popped") deserves a direct check: `assert.ok(sh('git',['stash','list'],dir).includes(result.stashRef.replace(/^stash@\{|\}$/g,'')))` or equivalent.
- **`captureCommit` vendor-trailer test** (worktree.test.mjs, "captures... with vendor trailer") substring-matches `/Baton-Task:\s*t1/` against the whole commit message body, which would also pass if that text appeared in the *subject* line rather than as a real trailing-footer trailer. Strengthen with `git interpret-trailers --parse` (or equivalent) to confirm it's a structurally valid trailer, not just a matching substring anywhere in the message.

---

## 11. MINOR — No adversarial case for a crash/abort landing mid-git-operation

**What's wrong.** Every crash/interrupt test (`adapter.test.mjs` #8, #13; `worktree.test.mjs` #40) times the crash/abort to land in the pre-edit `delayMs` gap, never mid-`git add`/`git commit`. A5 gestures at this ("no artificial delay beyond in-flight `git commit` completion") but doesn't state as a hard, testable guarantee that an in-flight git write always completes atomically before an abort/crash takes effect — it's implicit in the prose, not pinned as an invariant, and therefore untested. Given `MockAdapter` "performs real filesystem writes + real `git add -A && git commit`... via `node:child_process`" without specifying sync vs. async spawn, an implementer choosing an async `spawn()` for git could leave a `.git/index.lock` or a half-written index behind on a same-tick abort, corrupting the worktree for any subsequent operation (including the crash-recovery `reconcile()` sweep).

**The concrete fix.** State explicitly in A5 or A8: *"a scripted edit's git write (`add`+`commit`) is treated as atomic with respect to abort/crash — once started, it always completes before the adapter observes `signal`/`crashAfterMs`; `MockAdapter` MUST implement this via synchronous git calls (`execFileSync`) precisely to make this guarantee trivially true, not merely likely."* Add one test that aborts/crashes with `delayMs:0` (so the abort/crash fires essentially concurrently with the git call) and asserts the worktree's git state is always valid (`git status` doesn't error, no lockfile survives) afterward.