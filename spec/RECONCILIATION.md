# baton MVP — Contract Reconciliation (authoritative)

*Resolves the cross-cluster seams the Phase-3 red team found. Where this doc and `spec/IMPLEMENTATION.md` disagree, **this doc wins** — it is the single source of truth for the shared interfaces every module and test must conform to. Written as decisions, not prose.*

## D1 — The unified Adapter contract (session-shaped, one interface)

There is ONE adapter interface. It is session-shaped (a worker is a live run driven over its lifetime), because the coordinator needs mid-run control (interrupt/steer) and streaming events. Every adapter (Mock, Codex, Claude, GLM) implements exactly:

```js
/** @typedef {{ok:boolean, emulated?:boolean, reason?:string}} Ack */
interface Adapter {
  card(): HarnessCard;                                  // { harness, version, concurrencyCeiling, maxContext, authPosture, verbs }
  spawn(worker: WorkerId, brief: Brief): Promise<Ack>;  // starts the run; does NOT block on completion; emits events via onEvent
  prompt(worker: WorkerId, content: string, mode: 'turn'|'nudge'|'steer'): Promise<Ack>; // message into a LIVE run
  interrupt(worker: WorkerId, then?: string): Promise<Ack>; // request stop; the CONFIRMED stop arrives as an onEvent event, not this return
  approve(worker: WorkerId, requestId: string, decision: 'allow'|'deny'|'cancel', payload?: object): Promise<Ack>; // for approvals ONLY (closed enum)
  answer(worker: WorkerId, requestId: string, answer: {text?: string, decision?: string}): Promise<Ack>; // for QUESTIONS (free-form) — distinct from approve (red core#1)
  kill(worker: WorkerId): Promise<Ack>;                 // force end; confirmed via onEvent
  onEvent(cb: (e: BatonEvent) => void): void;           // register; adapter pushes lifecycle/content/control/question events over the run
}
```

- **`answer()` is distinct from `approve()`** (red core#1): approvals carry a closed `'allow'|'deny'|'cancel'` decision; questions carry free-form `{text|decision}`. The coordinator's `respond()` routes to `approve()` for an approval wait-item and `answer()` for a question wait-item, and the tests MUST assert *which adapter method was called with what args* (not just the coordinator status).
- **`MockAdapter` additionally exposes a `run(brief, opts): Promise<WorkerResult>` convenience** = `spawn` + await the `lifecycle.turn_completed` event + return its result payload. This exists so the one-shot Cluster-B tests (adapter/worktree/referee) keep working; the coordinator uses only the session methods. `MockScenario` drives `spawn()` to emit its scripted events (`turn_started` → edits → optional `question.asked` → `lifecycle.turn_completed{result}` or `lifecycle.crashed`), and `interrupt()`/`kill()` cause a `control.interrupt_confirmed`/`kill.confirmed` event after the scripted stop delay.
- **Confirmed-stop is an event, never a return value** (red core#2): `interrupt()`/`kill()` return an `Ack` immediately; the coordinator awaits the matching `control.interrupt_confirmed`/`kill.confirmed` event (matched by `worker` + the bumped fence) before the worker becomes `idle`.

## D2 — One Brief typedef (the delegation contract)

All three clusters use exactly this shape (resolves red integration#5, the three incompatible Briefs):

```js
/**
 * @typedef {Object} Brief   — the delegation contract (SYSTEM.md §4.2)
 * @property {string} goal
 * @property {string[]} constraints
 * @property {string[]} pathScope            — in-scope path globs (feeds path leases + out-of-scope signal)
 * @property {string} definitionOfDone
 * @property {{command:string, expectExit:number}} verification  — the EXACT command the trust gate re-runs. THE SAME OBJECT, not a copy.
 * @property {{tokens:number, usd:number, wallMin:number}} budget
 * @property {string[]} [tools]
 * @property {string} [outputFormat]
 * @property {'codex-v2'|'claude'|'glm'} [briefTemplate]
 * @property {string} [orientationRef]
 */
```

- **The "same done command" invariant is structural** (red integration#7): the trust gate re-runs `task.brief.verification` — a reference to the very object created with the brief, so a worker literally cannot present a different command. `createBrief()` deep-freezes `verification`. Tests assert identity, not just equality.

## D3 — One EventKind vocabulary

Canonical set (resolves red integration#6 / workers-trust#5 — `question.answered` is the chosen name, not `question.resolved`):

```
lifecycle.spawned | lifecycle.turn_started | lifecycle.turn_completed | lifecycle.session_compacted | lifecycle.exited | lifecycle.crashed
content.message | content.file_edit | content.tool_call | content.plan
control.send | control.nudge | control.steer | control.interrupt_requested | control.interrupt_confirmed | control.stale_rejected | control.forced_stop
approval.requested | approval.resolved
question.asked | question.answered
kill.requested | kill.confirmed
resource.tokens | resource.budget_threshold
health.stall_suspected | health.loop_suspected | health.scope_drift
verify.reverified
error
```

`story.mjs`'s `KIND` map and `coordinator.mjs`'s emitters both use exactly these strings. No other kind strings exist. An unmapped kind in the story fold is passed through as `unknown.passthrough` (never dropped, never crashes).

## D4 — The trust-gate wiring (the "dead on arrival" fix — red workers-trust#1, integration#2)

The coordinator's completion path MUST use the hardened referee, not a hand-rolled exit-code compare:

```
on a worker's lifecycle.turn_completed (claimed result):
  sha     = worktree.captureCommit(taskId)              // capture worker's work as a commit
  sandbox = worktree.freshVerifySandbox(taskId, sha)    // MANDATORY fresh worktree, NEVER the worker's own (D6)
  verdict = await referee.verify(task, result, sandbox, opts)   // re-run pinned cmd; red→green; coverage-of-change
  worktree.reap-verify-sandbox
  emit verify.reverified{verdict}
  task.status = referee.accept(verdict) ? 'completed' : 'failed'   // accept() is the ONLY authority; worker claim ignored
  router.record(worker.modelVersion, task.taskType, referee.accept(verdict))   // D5
```

`referee.accept(verdict)` is the sole decider of `completed`. The worker's self-reported exit is used only to emit a divergence flag.

## D5 — Router wiring (red integration#3)

- **Selection**: at dispatch, the coordinator picks the vendor via `router.pick(task, candidates)` (round-robin when the router has no history; recency-biased once it does). Which candidates = the adapters whose `card().concurrencyCeiling` has headroom.
- **Learning**: after the trust gate, the coordinator calls `router.record(modelVersion, taskType, verifiedWin)` where `verifiedWin = referee.accept(verdict)` — **verified outcomes only, never worker self-report** (doc 20). `modelVersion` comes from the worker's `card()`; `taskType` from `task.taskType` (a coarse string on the brief/task, default `"general"`).

## D6 — Referee freshness guard is MANDATORY (red workers-trust#1/#4, integration; the product's spine)

`referee.verify(task, result, sandbox, opts)` MUST assert `sandbox !== task.worktree` (the worker's own dir) and throw `SameWorktreeError` if equal — this is not optional. The forge-catch test asserts the gate catches a lie *because* it ran in a fresh worktree (prove freshness is the mechanism: a version that re-ran in the worker's dir would be fooled by a planted artifact).

## D7 — WorktreeManager interface = worktree.mjs's real exports (red workers-trust#3, integration#11)

The coordinator's dependency is exactly what `worktree.mjs` exports (no separate `WorktreeManager` shape):
`pinBaseSha(repo)`, `createFromBase(taskId, baseSha)`, `captureCommit(taskId)`, `freshVerifySandbox(taskId, sha)`, `changedLines(taskId, sha)`, `reap(taskId, {force?})`, `reconcile()`, `listWorktrees()`. Names are fixed here.

## D8 — Provenance in real digests (red integration#4)

`coordinator.wait()` builds its `digest` through `messages.wrapFact()` (hub-computed: statuses, diffstats, exit codes, verdicts) and `messages.wrapProse()` (worker-authored summaries — marked `untrusted:true`, delimited). Untrusted prose is opt-in and never presented as fact. Tested at the coordinator level, not just in messages unit tests.

## D9 — interrupt/kill composition (red core#2)

- A fresh `interrupt`/`kill` on an `idle`/`working`/`blocked` worker: bump fence (`bumpHuman`), call the adapter, mark `stopping`, await the confirmed-stop event.
- A second `interrupt`/`kill` while already `stopping`: does NOT re-bump the fence or re-call the adapter; it **attaches as an additional waiter on the same in-flight confirmation**. Exception: a `kill()` arriving during a soft `interrupt()`'s wait escalates the deadline to immediate force-kill. **Every interrupt/kill promise resolves** (kill always works — SYSTEM.md §5.6); none hangs on a fence value the adapter can never emit.
- A `lifecycle.turn_completed` that arrives *during* the stopping window is discarded (the worker is being cancelled); the task ends `cancelled`/`failed`, not `completed`.

## D10 — Construction replay (red core#3)

`new Coordinator(opts)` (or an awaited `ready`) rebuilds all state from the log alone, via this event-kind → state table, before accepting commands. No test may pre-seed `fences`/tasks by hand.

| terminal/last event for a worker | rebuilt task.status | fence/turnEpoch |
|---|---|---|
| `lifecycle.turn_completed` + later `verify.reverified{accept:true}` | `completed` | from event `turnEpoch` |
| `verify.reverified{accept:false}` / `lifecycle.crashed` / `control.forced_stop` | `failed` | " |
| `kill.confirmed` / `control.interrupt_confirmed` (no later turn) | `cancelled`/`idle` | " |
| `lifecycle.turn_started` (no terminal) | `working` (resumable) | " |
| `question.asked`/`approval.requested` (unanswered) | `input_required` | " |

`FenceTable` is repopulated: for each `log.workers()`, `register()` then set fence/turnEpoch to the max seen in that worker's events.

## D11 — Other pins

- **Cursor state files** (red core#4): the coordinator owns them under `<logDir>/.cursors/<worker>.floor`; `wait()`'s at-least-once survives restart because the floor is on disk there.
- **Dependency cycles** (red core#10): `spawn()` rejects a task whose `deps` would form a cycle with existing tasks (`DependencyCycleError`); never a silent permanent-pending deadlock.
- **Concurrency accounting** (red core#6): a worker in `stopping` or `blocked` still counts against its vendor's ceiling until it reaches `idle`/terminal (it's still occupying a seat).
- **CodexAdapter `steer` verb** (red workers-trust#6): Codex declares `steer:'native'` (per `spec/adapter-contract.md`); the earlier "unsupported" note referred to `pause`, not `steer`. Pinned: Codex `verbs.steer='native'`, `verbs.pause='unsupported'`.
- **No silent emulation** (red core#14): `interrupt`/`kill`/`steer` Acks carry `emulated` where the harness emulates the primitive; tests assert it.
