# baton MVP — Implementation Spec (consolidated)

*The contract. Three module-cluster specs (Core / Workers+Trust / Messaging+Telemetry+Routing), produced in Phase 1 (spec-driven design), assembled here. Target: runnable ESM JavaScript (`.mjs`) + JSDoc, `node:test`, zero dependencies, AI/AX only (no UI). This is what Phase 2 tests and Phase 5 implements against. Where clusters reference each other's exports, the module graph is: coordinator → {log, fence, adapter, worktree, referee, router, story, messages}; referee → {worktree, log}; story/router → log.*

---

# CLUSTER 1 — CORE (log, fence, coordinator)

# Baton — Core Cluster Implementation Spec

*Cluster: **Core** — the coordinator and its reliability spine. Target: plain ESM `.mjs` + JSDoc, `node:test`/`node:assert`, zero external dependencies. Files: `impl/src/log.mjs`, `impl/src/fence.mjs`, `impl/src/coordinator.mjs`. This is the contract Phase 2 (tests) and the implementer both build against — no further design decisions should be needed to write either.*

---

## 0. Scope note — decisions this spec commits to

The design docs leave a few things as open questions or main-loop pseudocode rather than a literal API. This spec resolves them concretely so nothing is ambiguous:

- **Deps are a Core concept.** `spawn()` accepts an optional `deps: TaskId[]`. A task with unmet deps stays `pending` even with free concurrency headroom. (Requested explicitly in the assignment; consistent with `SYSTEM.md`'s dispatch step.)
- **No background timer thread.** The coordinator has no real `setInterval` loop. Every public command implicitly runs one internal `tick()` first (dispatch ready tasks, check approval/stop deadlines against an injectable clock). A `tick()` method is also exported so tests can advance time-based transitions deterministically without real sleeps.
- **Single orchestrator consumer for MVP.** `wait()` serves one logical consumer (the CLI agent driving this coordinator instance). Per-worker `Cursor`s are keyed by worker id under one fixed consumer identity. Multi-consumer fan-out is out of scope for Core MVP.
- **Fencing is per-worker, not per-worker-per-turn-as-a-separate-namespace.** One monotonic integer (`fence`) per worker is the thing every op is checked against; `turnEpoch` is tracked alongside it for readability/logging. `turnEpoch` bumps only on `bumpTurn`; `fence` bumps on both `bumpTurn` and `bumpHuman`. This satisfies I1's "reject any op whose fence < current" while also satisfying "human-authority actions bump the fence" without a new turn starting.
- **Fence staleness is checked at *application* time, not issue time.** A command snapshots the fence when the orchestrator calls it, then re-checks that snapshot immediately before the coordinator commits the resulting state change — after any `await` on the adapter. This is where a same-tick race (interrupt racing an in-flight `send`) actually gets caught.

---

## 1. Module: `log.mjs`

**Single responsibility:** the append-only event log (one JSONL file per worker) and the at-least-once read cursor. Nothing else in the system writes worker history directly.

### 1.1 Typedefs owned here

```js
/**
 * @typedef {Object} BatonEvent
 * @property {number} seq          - Per-worker, gap-free, 1-based, monotonic.
 * @property {string} ts           - ISO-8601, hub-stamped (never caller-supplied).
 * @property {string} worker       - WorkerId this event belongs to.
 * @property {string} harness      - e.g. "codex@0.144.0" (from the worker's HarnessCard at spawn time).
 * @property {number} turnEpoch    - The fence-scope this event occurred under.
 * @property {EventKind} kind
 * @property {'worker'|'orchestrator'|'human'|'policy'} actor
 * @property {boolean} [emulated]  - true iff this event is a degraded/emulated primitive, never omitted silently.
 * @property {*} payload
 */

/**
 * @typedef {'lifecycle.spawned'|'lifecycle.turn_started'|'lifecycle.turn_completed'|
 *   'lifecycle.session_compacted'|'lifecycle.exited'|'lifecycle.crashed'|
 *   'control.nudge'|'control.steer'|'control.send'|'control.interrupt_requested'|
 *   'control.interrupt_confirmed'|'control.stale_rejected'|'control.forced_stop'|
 *   'approval.requested'|'approval.resolved'|'question.asked'|'question.resolved'|
 *   'resource.tokens'|'resource.budget_threshold'|
 *   'health.stall_suspected'|'health.loop_suspected'|
 *   'verify.reverified'|'kill.requested'|'kill.confirmed'|'error'} EventKind
 */
```

### 1.2 `class Log`

```js
/**
 * Append-only, one-JSONL-file-per-worker event log. The ONLY source of truth (rule 5).
 * Any in-memory index the coordinator keeps is a projection rebuildable from this.
 */
export class Log {
  /**
   * @param {string} dir - directory holding `<workerId>.jsonl` files; created if absent.
   * @param {() => string} [clock] - injectable ISO-8601 clock, defaults to `() => new Date().toISOString()`.
   */
  constructor(dir, clock) {}

  /**
   * Append an event, stamping `seq` (gap-free, recovered from disk if this Log instance
   * is fresh — see Invariant L1) and `ts` (from `clock`). The caller-supplied object MUST
   * NOT include `seq` or `ts`; both are rejected with a TypeError if present, to prevent a
   * caller from ever forging the hub-authoritative stamp.
   * @param {Omit<BatonEvent, 'seq'|'ts'>} partial
   * @returns {BatonEvent} the fully stamped, persisted event
   * @throws {TypeError} if `partial.seq` or `partial.ts` is present
   */
  append(partial) {}

  /**
   * Read events for a worker at or after `fromSeq`, in seq order. Empty array for an
   * unknown worker (never throws — an unknown worker simply has no history yet).
   * @param {string} worker
   * @param {number} [fromSeq=1]
   * @returns {BatonEvent[]}
   */
  read(worker, fromSeq) {}

  /**
   * The last seq appended for a worker, or 0 if none. Used by the coordinator to recover
   * a worker's turnEpoch/fence bookkeeping on restart without re-reading the whole file.
   * @param {string} worker
   * @returns {number}
   */
  tail(worker) {}

  /** All worker ids that have at least one event on disk. For crash-recovery replay. */
  workers() {}
}
```

### 1.3 `class Cursor` — at-least-once read position

```js
/**
 * At-least-once cursor over one worker's Log. `next()` always serves everything after the
 * persisted ack floor; `ack()` moves that floor and persists it. A crash between `next()`
 * returning and the caller durably processing the page means the SAME page is re-served
 * on the next `next()` call after restart (a fresh Cursor pointed at the same stateFile) —
 * this is deliberate (spec I3): dropping an event could drop a worker's unanswered question.
 */
export class Cursor {
  /** @param {string} stateFile - path this cursor's ack floor is persisted to. */
  constructor(stateFile) {}

  /**
   * @param {Log} log
   * @param {string} worker
   * @returns {BatonEvent[]} everything with seq > the persisted floor, in order
   */
  next(log, worker) {}

  /**
   * Persist the new floor. Monotonic: `ack(n)` when `n <= currentFloor` is a no-op
   * (never regresses). Idempotent and safe to call multiple times with the same value.
   * @param {number} uptoSeq
   */
  ack(uptoSeq) {}

  /** Current persisted floor (0 if never acked). For tests/inspection. */
  floor() {}
}
```

---

## 2. Module: `fence.mjs`

**Single responsibility:** version-stamps. Nothing in this module talks to disk, an adapter, or a worker — it is pure bookkeeping consulted by the coordinator before it commits any state change.

### 2.1 Typedefs owned here

```js
/**
 * @typedef {Object} FenceStamp
 * @property {number} fence      - snapshot of the worker's fence at issue time
 * @property {number} turnEpoch  - snapshot of the worker's turnEpoch at issue time
 */

/**
 * @typedef {Object} FenceCheckResult
 * @property {boolean} ok
 * @property {'ok'|'stale_fence'|'unknown_worker'} result
 * @property {number} [current]        - the worker's current fence, present when result !== 'unknown_worker'
 * @property {number} [currentTurnEpoch]
 */
```

### 2.2 `class FenceTable`

```js
export class FenceTable {
  constructor() {}

  /**
   * Register a worker at its initial fence/turnEpoch (both = 1). Idempotent: calling this
   * again for an already-known worker is a no-op and does NOT reset its fence.
   * @param {string} worker
   */
  register(worker) {}

  /**
   * Snapshot the worker's CURRENT fence/turnEpoch, to be carried on an outgoing op.
   * Does NOT itself advance anything — issuing a stamp twice in a row with no bump in
   * between yields two IDENTICAL, both-currently-valid stamps.
   * @param {string} worker
   * @returns {FenceStamp}
   * @throws {RangeError} if `worker` was never `register()`-ed
   */
  issue(worker) {}

  /**
   * Compare a previously-issued stamp against the worker's fence NOW.
   * `ok:false, result:'stale_fence'` iff `stamp.fence < current fence`. Never mutates state.
   * @param {string} worker
   * @param {FenceStamp} stamp
   * @returns {FenceCheckResult}
   */
  check(worker, stamp) {}

  /**
   * A new turn begins (`lifecycle.turn_started`). Increments BOTH turnEpoch and fence —
   * any stamp issued before this call is now stale.
   * @param {string} worker
   * @returns {FenceStamp} the new current stamp
   */
  bumpTurn(worker) {}

  /**
   * A human-authority action occurs (human `respond`/`interrupt`/`kill`, or an explicit
   * takeover). Increments ONLY the fence, leaving turnEpoch unchanged — this is how "the
   * human always wins" works: any AI-issued stamp from earlier in the SAME turn is now
   * stale, without ending the turn itself.
   * @param {string} worker
   * @returns {FenceStamp}
   */
  bumpHuman(worker) {}

  /** Current stamp without consuming/checking anything. For `list()` / logging. */
  current(worker) {}
}
```

### 2.3 Semantics worth stating explicitly

- `fence` is **never reused or reset** for the lifetime of a given worker id (Invariant F1 below).
- A worker id is retired (never re-`register()`-ed) once its terminal state is reached; a fresh spawn always allocates a fresh worker id, so a late-arriving stale op can never accidentally resolve against an unrelated, newer worker of the same name.
- `bumpTurn`/`bumpHuman` are the ONLY two fence-advancing operations. The coordinator calls `bumpTurn` on `lifecycle.turn_started` (including the very first turn at spawn) and `bumpHuman` when the `actor` driving an `interrupt`/`respond`/`kill` is `'human'`, or when the orchestrator itself issues `interrupt`/`kill` (interrupts are always authoritative over any in-flight nudge/steer regardless of who requested them — see §3.5).

---

## 3. Module: `coordinator.mjs`

**Single responsibility:** the main loop and the 8 commands. Owns the worker pool, dispatches ready tasks, carries commands reliably (fence-checked), enforces two-phase stop, single-consumer approvals, and the trust gate. This is where all five reliability rules meet.

### 3.1 Typedefs owned here

```js
/**
 * @typedef {Object} Brief
 * @property {string} goal
 * @property {string[]} constraints
 * @property {string[]} pathScope
 * @property {string} definitionOfDone
 * @property {{command: string, expectExit: number}} verification  // the ONLY definition of "done" (never worker-redefinable)
 * @property {{tokens: number, usd: number, wallMin: number}} budget
 * @property {string} [orientationRef]      // artifact-store handle, opaque to Core
 * @property {'codex-v2'|'claude'|'glm'} [briefTemplate]
 */

/**
 * @typedef {Object} DriverTask
 * @property {string} id
 * @property {Brief} brief
 * @property {string[]} deps                // dispatchable iff every dep is 'completed'
 * @property {'pending'|'working'|'blocked'|'verifying'|'completed'|'failed'|'cancelled'} status
 * @property {string|null} assignee         // WorkerId, set once dispatched
 * @property {string|null} worktree         // path, set once dispatched
 * @property {WorkerResult|null} result     // the worker's (non-authoritative) claim
 * @property {Verdict|null} verdict         // the coordinator's own re-derived truth
 */

/**
 * @typedef {Object} WorkerResult
 * @property {'completed'|'failed'|'blocked'|'cancelled'} status
 * @property {string} summary
 * @property {{commits: string[], diffRef?: string, files: string[]}} artifacts
 * @property {{command: string, claimedExit: number, tailRef?: string}} verification  // a CLAIM
 * @property {string[]} openQuestions
 * @property {{tokens: number, usd: number}} budgetUsed
 */

/**
 * @typedef {Object} Verdict
 * @property {boolean} reverified
 * @property {number|null} observedExit     // what the COORDINATOR observed, never the worker's report
 * @property {boolean} matchesClaim
 * @property {'fresh_sandbox'} locus        // NEVER 'worker_sandbox' — see Invariant C3
 * @property {string} note
 */

/**
 * @typedef {'idle'|'working'|'stopping'|'blocked'|'orphaned'|'dead'} WorkerStatus
 */

/**
 * @typedef {Object} WorkerHandle
 * @property {string} id
 * @property {string} vendor
 * @property {string} taskId
 * @property {string|null} worktree
 * @property {number} fence
 * @property {number} turnEpoch
 * @property {WorkerStatus} status
 * @property {string|null} pendingApprovalId
 * @property {string|null} pendingQuestionId
 * @property {{tokens: number, usd: number}} budgetUsed
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Digest
 * @property {AttentionItem[]} attention   // questions/approvals/alarms FIRST, always ahead of facts
 * @property {FactItem[]} facts            // hub-computed, trusted; never raw worker prose
 * @property {boolean} more                // true if events remain queued beyond this page
 */
/** @typedef {Object} AttentionItem
 * @property {'question'|'approval'|'budget_alarm'|'stall'|'loop'} type
 * @property {string} worker
 * @property {string} [requestId]
 * @property {*} payload
 */
/** @typedef {Object} FactItem
 * @property {string} worker
 * @property {string} kind
 * @property {number} seq
 * @property {string} ts
 * @property {*} payload
 */
```

### 3.2 Dependency interfaces (owned by other clusters; Core calls these, never implements them)

```js
/** @typedef {Object} HarnessCard
 * @property {string} harness
 * @property {string} version
 * @property {'subscription'|'api_key'} authPosture
 * @property {number} concurrencyCeiling
 * @property {number} maxContext
 * @property {Record<string,'native'|'emulated'|'unsupported'>} verbs
 */

/** @typedef {Object} Ack
 * @property {boolean} ok
 * @property {boolean} [emulated]
 */

/**
 * Cluster B. One instance per vendor, keyed by vendor name in `opts.adapters`.
 * @typedef {Object} Adapter
 * @property {() => HarnessCard} card
 * @property {(worker: WorkerHandle, brief: Brief) => Promise<Ack>} spawn
 * @property {(worker: WorkerHandle, content: {text: string}, mode: 'nudge'|'steer'|'turn') => Promise<Ack>} prompt
 * @property {(worker: WorkerHandle, then?: {text: string}) => Promise<Ack>} interrupt
 * @property {(worker: WorkerHandle, requestId: string, decision: 'allow'|'deny'|'cancel', payload?: *) => Promise<Ack>} approve
 * @property {(worker: WorkerHandle) => Promise<Ack>} kill
 * @property {(cb: (e: Omit<BatonEvent,'seq'|'ts'|'worker'>) => void) => void} onEvent
 *   - Adapter pushes worker-originated events (turn_completed, ask, budget updates, the
 *     authoritative stop confirmation) via this callback. Core is the ONLY place that
 *     stamps seq/ts/worker before appending to the Log.
 */

/**
 * Cluster B.
 * @typedef {(task: DriverTask, result: WorkerResult, opts: {
 *   pinnedVerification: {command: string, expectExit: number},
 *   sandbox: string
 * }) => Promise<Verdict>} RefereeFn
 */

/**
 * Cluster B.
 * @typedef {Object} WorktreeManager
 * @property {(taskId: string, baseRef?: string) => Promise<{path: string, branch: string, baseSha: string}>} create
 * @property {(worktreePath: string) => Promise<{sha: string}>} capture           // commits a snapshot if dirty; returns HEAD sha
 * @property {(taskId: string, sha: string) => Promise<{path: string}>} createVerifyWorktree  // FRESH, detached, never task.worktree
 * @property {(verifyPath: string) => Promise<void>} removeVerifyWorktree
 * @property {(taskId: string) => Promise<void>} remove                          // cleanup on done/crash
 * @property {() => Promise<void>} reconcile                                     // zombie sweep on boot
 */

/**
 * Cluster C. Picks a vendor for a task given live capacity; returns null if nothing has headroom.
 * @typedef {(task: DriverTask, cards: Record<string,HarnessCard>, inFlight: Record<string,number>) => string|null} RouteFn
 */

/**
 * Cluster C. Optional; Core never blocks on this and never lets it throw past a try/catch.
 * @typedef {Object} StorySink
 * @property {(event: BatonEvent) => void} record
 */
```

### 3.3 Construction

```js
/**
 * @typedef {Object} CoordinatorOpts
 * @property {Log} log
 * @property {FenceTable} fences
 * @property {Record<string, Adapter>} adapters      - keyed by vendor name
 * @property {WorktreeManager} worktrees
 * @property {RefereeFn} referee
 * @property {RouteFn} route                          - used when spawn() is called with vendor:'auto'
 * @property {StorySink} [story]
 * @property {() => number} [now]                      - injectable clock (ms epoch), default Date.now
 * @property {number} [approvalTimeoutMs=60000]
 * @property {number} [stopDeadlineMs=15000]
 * @property {number} [waitPollMs=25]                 - internal poll granularity for wait()
 */
export class Coordinator {
  /** @param {CoordinatorOpts} opts */
  constructor(opts) {}

  /**
   * Runs one internal tick: promote dispatchable pending tasks (deps satisfied + vendor
   * headroom), sweep expired approval/question deadlines, escalate any 'stopping' worker
   * past its stopDeadlineMs. Called implicitly by every public command; also exported so
   * tests can drive time-based transitions deterministically (paired with a fake `now`).
   */
  tick() {}

  // ---- the 8 commands ----
  /** @param {string} vendor - a key of opts.adapters, or the literal string 'auto'
   *  @param {Brief} brief
   *  @param {{taskId?: string, deps?: string[]}} [opts]
   *  @returns {Promise<WorkerHandle>} */
  async spawn(vendor, brief, opts) {}

  /** @param {string} workerId
   *  @param {{text: string}} message
   *  @param {'nudge'|'steer'|'turn'} mode
   *  @returns {Promise<{ok: boolean, result: 'ok'|'stale_fence'|'worker_stopping', emulated?: boolean, current?: number}>} */
  async send(workerId, message, mode) {}

  /** @param {number} [timeoutMs=25000]
   *  @returns {Promise<Digest>} */
  async wait(timeoutMs) {}

  /** @param {string} requestId
   *  @param {*} answer
   *  @param {'orchestrator'|'human'} [actor='orchestrator']
   *  @returns {Promise<{ok: boolean, result: 'applied'|'already_resolved'|'not_found', resolution?: *}>} */
  async respond(requestId, answer, actor) {}

  /** @param {string} workerId
   *  @param {{text: string}} [then]
   *  @param {'orchestrator'|'human'} [actor='orchestrator']
   *  @returns {Promise<{ok: boolean, result: 'confirmed'|'stale_fence'|'forced'}>} */
  async interrupt(workerId, then, actor) {}

  /** @param {string} workerId
   *  @returns {Promise<{ready: boolean, status?: string, verdict?: Verdict, artifacts?: *}>} */
  async result(workerId) {}

  /** @returns {WorkerHandle[]} synchronous snapshot */
  list() {}

  /** @param {string} workerId
   *  @param {'orchestrator'|'human'} [actor='orchestrator']
   *  @returns {Promise<{ok: boolean, result: 'confirmed'|'already_dead'}>} */
  async kill(workerId, actor) {}
}
```

### 3.4 Error taxonomy (thrown, not returned, for programmer-error cases; command-level *domain* outcomes like `stale_fence`/`already_resolved` are returned, not thrown)

```js
export class WorkerNotFoundError extends Error {}
export class DuplicateTaskIdError extends Error {}
export class UnknownVendorError extends Error {}
```

### 3.5 The command bodies, precisely

**`spawn(vendor, brief, opts={})`**
1. `taskId = opts.taskId ?? autogenerate()`. If `taskId` already known → throw `DuplicateTaskIdError`.
2. Register `DriverTask{id:taskId, brief, deps: opts.deps ?? [], status:'pending', assignee:null, worktree:null, result:null, verdict:null}`.
3. `tick()`.
4. If the task was promoted to `working` during that tick, return its `WorkerHandle`. Otherwise return a placeholder `WorkerHandle` with `status:'pending'` (`id` allocated now so it's a stable reference for later `list()`/`wait()` calls, but `worktree`/`sessionRef` stay `null` and no adapter call has been made).

**Dispatch, inside `tick()`, for each `pending` task in creation order:**
1. Skip if `deps.some(d => tasks.get(d)?.status !== 'completed')`.
2. Resolve vendor: explicit name, or `route(task, cards(), inFlightCounts())` if `'auto'`; skip (leave pending) if `route` returns `null` or the resolved vendor is unknown.
3. Skip if `inFlight[vendor] >= adapters[vendor].card().concurrencyCeiling`.
4. Otherwise: allocate `workerId`; `fences.register(workerId)`; `await worktrees.create(taskId)` → `task.worktree`; append `lifecycle.spawned` (`actor:'orchestrator'`); `fences.bumpTurn(workerId)`; `await adapters[vendor].spawn(handle, brief)`; append `lifecycle.turn_started`; set `task.status='working'`, `worker.status='working'`.

**`send(workerId, message, mode)`**
1. `handle = getWorker(workerId)` (throws `WorkerNotFoundError` if absent).
2. If `handle.status === 'stopping'` → return `{ok:false, result:'worker_stopping'}` immediately, no adapter call, no log entry (a nudge cannot be queued against a worker mid-stop; the orchestrator must wait for the interrupt to resolve first).
3. `stamp = fences.issue(workerId)`.
4. `ack = await adapters[handle.vendor].prompt(handle, message, mode)`.
5. `check = fences.check(workerId, stamp)`.
6. If `!check.ok`: append `control.stale_rejected{op:'send', mode, attempted:stamp, current:check.current}`; return `{ok:false, result:'stale_fence', current:check.current}`. **No task/worker state mutation beyond this log entry** — the underlying adapter call may already have physically happened (JS can't unsend it), but the coordinator's authoritative state does not move.
7. Else append `control.<mode>{message, emulated: ack.emulated===true}`; return `{ok:true, result:'ok', emulated: ack.emulated===true}`.

**`interrupt(workerId, then, actor='orchestrator')`**
1. `handle = getWorker(workerId)`.
2. If `handle.status === 'blocked'` (an approval/question outstanding): auto-resolve it now with the documented cancel-decision (`respond(handle.pendingApprovalId, {decision:'cancel'}, actor)` internally) — precondition I6, prevents the worker hanging on a stale approval after cancel.
3. Bump the fence FIRST, synchronously, before awaiting anything: `stamp = actor==='human' ? fences.bumpHuman(workerId) : fences.bumpHuman(workerId)` — **interrupt always calls `bumpHuman`, regardless of `actor`**, because an interrupt is always authoritative over any in-flight nudge/steer issued earlier in the same turn (this is deliberate — see rationale below).
4. `handle.status = 'stopping'`; append `control.interrupt_requested{then, actor}`.
5. `await adapters[handle.vendor].interrupt(handle, then)`.
6. Await the adapter's **authoritative confirmed-stop event** (delivered via `onEvent`, matched by `workerId` + the bumped `stamp.fence`), bounded by `stopDeadlineMs` (checked via `tick()`/the injectable clock).
   - On confirmation within the deadline: `handle.status = 'idle'` (was-cancelled); append `control.interrupt_confirmed`; **only now** is the worktree lease released for reuse (a `spawn`/verify/merge referencing this worktree was refused with a fence/lease error at any point before this). Return `{ok:true, result:'confirmed'}`.
   - On deadline exceeded: append `control.forced_stop`; escalate via `adapters[handle.vendor].kill(handle)`; `handle.status='dead'`; return `{ok:true, result:'forced'}`.

*Rationale for step 3 always bumping regardless of actor:* the fence's job here is not "who requested this" (that's the `actor` field on the logged event) but "invalidate anything issued before this moment" — an orchestrator-issued interrupt must be just as authoritative over its own earlier in-flight `send()` as a human's would be, otherwise a race between `send()` and `interrupt()` from the *same* caller could still let a stale nudge land after the interrupt started. `bumpHuman` (fence-only, turnEpoch untouched) is the correct primitive either way; the distinction "human > orchestrator" is enforced elsewhere — a *human* `interrupt`/`respond`/`kill` additionally is never itself subject to a `stale_fence` rejection coming from a *concurrent orchestrator* op, because whichever actor's bump lands last in real wall-clock order wins, and only a human call is ever compared against with "human wins ties" as a documented tie-break in `respond()` (§3.5 respond, step 3).

**`respond(requestId, answer, actor='orchestrator')`**
1. Look up the pending `Approval`/`Question` record by `requestId`. Not found → `{ok:false, result:'not_found'}`.
2. **Compare-and-swap**: if `record.state !== 'pending'` → `{ok:false, result:'already_resolved', resolution: record.resolution}`. Else atomically set `record.state='resolved'`, `record.consumer=actor`, `record.resolution=answer` **before** any `await` (single JS synchronous block — this is what makes the CAS race-free without a real lock: two `respond()` calls for the same id, called back-to-back, both run their CAS check-and-set synchronously before either one's first `await`, so exactly one observes `state==='pending'`).
3. Tie-break note: if the CAS were ever contended across a real async boundary (not possible in the synchronous-CAS design above, but documented for the implementer), `actor==='human'` wins over `actor==='orchestrator'` for a genuinely simultaneous submission — but the synchronous CAS makes this moot for a single-process Core; flag as N/A in-process, relevant only if Core is ever split across processes.
4. If `record.kind==='question'`: bump-check via `fences.check` is **not** applied to answers (answers to questions are content-plane, not control-plane — but a stale-turn answer is still dropped, see below); deliver via `adapters[vendor].approve(handle, requestId, answer)` (or a `prompt`-based answer path per the adapter's `ask` mechanics); append `question.resolved`. If the worker had `blocking:true` (was `status:'blocked'`) → `handle.status='working'`.
5. If `record.kind==='approval'`: deliver via `adapters[vendor].approve(handle, requestId, answer.decision)`; append `approval.resolved`.
6. **Staleness for answers**: before delivering, check `record.turnEpochAtAsk === handle.turnEpoch` (captured when the `ask`/approval was first logged). If the worker's turn has since moved on (a new turn started while the question sat unanswered), the answer is **not delivered** to the current turn — append `control.stale_rejected{op:'respond'}` instead and return `{ok:true, result:'applied', note:'answer arrived after the asking turn ended; discarded per fencing'}` (it IS resolved/consumed — single-consumer still holds — it's just not delivered into a fresh turn, per communication-channel.md §7).

**`result(workerId)`**
1. `task = getTaskForWorker(workerId)`.
2. If `task.status` is not `'completed'`/`'failed'` → `{ready:false, status:task.status}`.
3. Else `{ready:true, status:task.status, verdict:task.verdict, artifacts:task.result.artifacts}`.

**`list()`** — synchronous map over the in-memory worker table; no I/O.

**`kill(workerId, actor='orchestrator')`**
- Same shape as `interrupt` (fence bump via `bumpHuman`, drain any outstanding approval with `cancel`, `status='stopping'` → confirmed → `'dead'`), except the terminal status is always `'dead'` (never `'idle'`) and the worker is removed from `inFlight` accounting and from the dispatch pool permanently. `worktrees.remove(taskId)` is called only after confirmed death.
- Idempotent: `kill()` on an already-`'dead'` worker is a no-op returning `{ok:true, result:'already_dead'}` — no duplicate `kill.confirmed` event is appended.

### 3.6 The trust gate (triggered when an adapter reports a worker's turn ended with `WorkerResult.status === 'completed'`)

1. `task.status = 'verifying'` (an explicit intermediate status — see Invariant C6).
2. `{sha} = await worktrees.capture(task.worktree)`.
3. `{path: verifyPath} = await worktrees.createVerifyWorktree(task.id, sha)`.
4. `verdict = await referee(task, task.result, {pinnedVerification: task.brief.verification, sandbox: verifyPath})`.
5. `await worktrees.removeVerifyWorktree(verifyPath)` — **always**, whether step 4 resolved or threw (the implementer wraps 4–5 in a try/finally; if `referee` throws, the task's terminal status becomes `'failed'` with `verdict:null` and the exception is logged as an `error` event, never silently swallowed and never left in `'verifying'` forever).
6. `task.verdict = verdict`; append `verify.reverified{verdict}` (`actor:'policy'`).
7. `task.status = (verdict.reverified && verdict.observedExit === task.brief.verification.expectExit) ? 'completed' : 'failed'`.
8. Append `lifecycle.turn_completed{status:task.status}`.

---

## 4. Invariants

Numbered for reference from the behaviors-to-test list and from other clusters' specs.

- **L1 (gap-free seq, crash-durable).** `seq` for a given worker is 1-based, strictly increasing by exactly 1 per `append()`, and this holds across process restarts: a fresh `Log` instance pointed at an existing directory recovers the next seq by reading the worker's file (via `tail()`), never by trusting in-memory state that didn't survive the crash.
- **L2 (ts is hub-stamped).** `ts` is never caller-supplied; `append()` rejects a partial event that already carries `seq` or `ts`.
- **L3 (log is the only truth).** No coordinator-visible state (`DriverTask.status`, `WorkerHandle.status`, fence values used for display, approval/question resolution) changes without a corresponding `Log.append()` having already happened or happening atomically in the same synchronous step. A coordinator rebuilt from nothing but the log's terminal events reconstructs the same terminal task/worker statuses.
- **F1 (fence never reused/reset).** For the lifetime of a worker id, `fence` only increases. A retired worker id (post-`kill`/terminal) is never `register()`-ed again; a new spawn always gets a new worker id.
- **F2 (stale command never applied).** If `fences.check()` reports `stale_fence`, the coordinator makes **no** mutation to `DriverTask`/`WorkerHandle` state beyond logging the rejection itself. The physical adapter call may already have fired (unavoidable in an async world) but its result is never trusted or acted on.
- **C1 (concurrencyCeiling is hard).** Dispatch never starts a worker for a vendor whose in-flight count already equals `card().concurrencyCeiling`.
- **C2 (deps gate dispatch).** A task with any dep not in `'completed'` status is never dispatched, regardless of ceiling headroom.
- **C3 (trust gate never runs in the worker's own worktree).** `referee()` is called ONLY with a `sandbox` path returned by `worktrees.createVerifyWorktree()`, which is always distinct from `task.worktree`. This is checked directly in tests via a spy `WorktreeManager`.
- **C4 (completion requires an observed pass).** `task.status` becomes `'completed'` iff `verdict.reverified === true && verdict.observedExit === brief.verification.expectExit`. The worker's `WorkerResult.status`/`claimedExit` never by itself produces `'completed'`.
- **C5 (two-phase stop; worktree lease held through it).** Between `control.interrupt_requested`/`kill.requested` and the confirmed stop/death event, `handle.status` is `'stopping'`, and no `spawn`/verify/merge operation is permitted to touch that task's worktree (attempting to do so is rejected — a fence/lease error, not a silent proceed).
- **C6 (verifying is a real, visible intermediate status).** Between a worker reporting `completed` and the trust gate resolving, `task.status === 'verifying'` — never jumps straight from `'working'` to `'completed'`, so an observer (or a crash-recovery replay) can never mistake "worker claims done" for "coordinator confirmed done."
- **C7 (single-consumer approvals/questions).** Exactly one `respond()` call for a given `requestId` transitions it out of `'pending'`; every other call for the same id, past or future, returns `'already_resolved'` with the original resolution — never a second delivery to the adapter.
- **C8 (at-least-once wait).** An event is only permanently un-re-servable once a `wait()` call has been made **after** the digest containing it was returned (the ack-on-next-arrival contract) — restart-safe, because the floor lives in `Cursor`'s persisted state file, not in memory.
- **C9 (no silent emulation).** Any `Ack.emulated === true` returned by an adapter is propagated verbatim into the logged event and into `send()`'s return value; Core never collapses `emulated` into a plain success.
- **C10 (attention before facts).** In every `Digest`, `attention` items (questions/approvals/budget alarms/stall/loop) are populated and conceptually prioritized ahead of `facts` — a consumer that only reads `attention` never misses a blocked worker.

---

## 5. Behaviors to test (numbered — this list drives Phase 2)

### `log.mjs`
1. `append()` assigns `seq = 1, 2, 3, …` gap-free for one worker; a second, independent worker starts its own sequence at 1.
2. `append({...,seq:1})` or `append({...,ts:'...'})` throws `TypeError` — caller cannot forge either field.
3. A fresh `Log` instance over a directory that already has `w1.jsonl` with events up to seq 7 continues at seq 8 on the next `append()` for `w1` (crash-recovery of the seq counter).
4. `read(worker, fromSeq)` returns only `seq >= fromSeq`, in order; `read('nonexistent-worker')` returns `[]`, never throws.
5. 50 synchronous back-to-back `append()` calls for the same worker produce 50 well-formed JSON lines with seqs `1..50` and no interleaving/corruption.
6. `Cursor.next()` before any `ack()` returns everything from seq 1.
7. `ack(5)` then `next()` returns only `seq > 5`.
8. `ack(3)` after `ack(5)` leaves the floor at 5 (monotonic; never regresses).
9. **At-least-once across restart:** call `next()` (don't call `ack()`), construct a brand-new `Cursor` on the same `stateFile`, call `next()` again — the second call re-serves the same events.
10. `ack()`'s effect is visible to a brand-new `Cursor` instance pointed at the same `stateFile` (durability).

### `fence.mjs`
11. `issue()` on an unregistered worker throws `RangeError`; `register()` then `issue()` returns `{fence:1, turnEpoch:1}`.
12. `check(worker, stamp)` with `stamp.fence === current` → `{ok:true, result:'ok'}`.
13. `check(worker, staleStamp)` with `staleStamp.fence < current` → `{ok:false, result:'stale_fence', current}`.
14. `bumpTurn()` increments both `fence` and `turnEpoch`; a stamp issued before the bump now fails `check()`.
15. `bumpHuman()` increments `fence` only; `turnEpoch` is unchanged; a stamp issued before it now fails `check()`.
16. Two `issue()` calls in a row with no bump in between produce identical stamps, and BOTH still pass `check()` — issuing alone never invalidates.
17. `check()` on a never-`register()`-ed worker returns `{ok:false, result:'unknown_worker'}` (does not throw — distinct failure mode from a stale stamp).
18. `register()` called twice for the same worker does not reset its fence (idempotent registration).

### `coordinator.mjs` — dispatch
19. `spawn(vendor, brief)` under headroom: creates the worktree, calls `adapter.spawn`, appends `lifecycle.spawned` then `lifecycle.turn_started` in that order, returns a `WorkerHandle` with `status:'working'`.
20. `spawn(vendor, brief)` at the vendor's ceiling: returns `status:'pending'`, no worktree created, no `adapter.spawn` call; after a different worker of that vendor completes (freeing a slot) and `tick()`/any subsequent command runs, the queued task promotes to `'working'`.
21. `spawn(vendor, brief, {deps:['t1']})` stays `'pending'` with free headroom until `t1` reaches `'completed'`.
22. `spawn('auto', brief)` calls the injected `route()` with the live `HarnessCard` map and current in-flight counts; the vendor it returns is the one dispatched to.
23. `spawn(vendor, brief, {taskId:'dup'})` twice throws `DuplicateTaskIdError` on the second call; the first task's state is untouched.
24. With two ready tasks and one free slot, exactly one dispatches per `tick()`, deterministically the earliest-created (FIFO) task.

### `coordinator.mjs` — send / fencing races
25. `send(worker, msg, 'nudge')` on a healthy `'working'` worker: `{ok:true}`, `control.nudge` logged.
26. Simulate an adapter whose `prompt()` yields control (an unresolved `await`) before resolving; call `interrupt()` on the same worker while `send()` is still pending; when `send()`'s promise resolves, assert it returns `{ok:false, result:'stale_fence'}` and that no `control.nudge` was appended (only `control.stale_rejected`).
27. `send('no-such-worker', ...)` throws `WorkerNotFoundError`.
28. `send()` with `mode:'steer'` against an adapter whose card declares `steer:'emulated'`: return value and logged event both carry `emulated:true`.
29. `send()` on a worker currently `'stopping'` returns `{ok:false, result:'worker_stopping'}` without calling the adapter.

### `coordinator.mjs` — interrupt / two-phase stop
30. `interrupt(worker)` sets `status:'stopping'` synchronously (observable via `list()`) before the adapter's confirmed-stop event arrives.
31. `interrupt(worker)`'s returned promise does not resolve until a MockAdapter emits its authoritative stop event (delayed on purpose in the test) — assert the promise is still pending immediately after the synchronous call returns, then resolves once the event fires.
32. While `'stopping'`, an attempt to dispatch a new task into that same worktree (or call `worktrees.createVerifyWorktree`/`remove` against it) is refused — model this via a spy `WorktreeManager` and assert it was never invoked for that task id during the stopping window.
33. `interrupt()` on a worker currently `'blocked'` with a pending approval auto-resolves that approval (`decision:'cancel'`) as part of the same call, before/without the caller separately invoking `respond()`.
34. If the MockAdapter never emits the confirmed-stop event, `interrupt()` resolves with `{ok:true, result:'forced'}` once `stopDeadlineMs` elapses (driven via the injectable clock + `tick()`, no real sleep), and `control.forced_stop` is logged.
35. `kill(worker)` on an already-`'dead'` worker returns `{ok:true, result:'already_dead'}` and does not append a second `kill.confirmed` event.

### `coordinator.mjs` — respond / single-consumer
36. A MockAdapter-emitted `ask{blocking:true}` event surfaces the worker as `status:'blocked'` and produces a `type:'question'` `AttentionItem` on the next `wait()`.
37. `respond(requestId, answer)` on a pending question: `{ok:true, result:'applied'}`, `question.resolved` logged, worker returns to `'working'`.
38. Two `respond(requestId, answerA)` / `respond(requestId, answerB)` calls issued back-to-back (before either awaits internally): exactly one returns `'applied'`, the other returns `'already_resolved'` echoing the first's answer; the adapter's `approve`/answer-delivery method is called exactly once.
39. `respond('unknown-id', ...)` returns `{ok:false, result:'not_found'}`, never throws.
40. An approval left unanswered past `approvalTimeoutMs` (driven via the injectable clock) auto-resolves to the documented default (`deny`/`cancel`) via `tick()`; a `respond()` arriving after that resolves to `'already_resolved'`.
41. An `answer` delivered to `respond()` for a question whose worker has since started a NEW turn (`turnEpoch` advanced past the ask's) is consumed (single-consumer holds — no double-resolution possible) but NOT delivered to the adapter; assert the adapter's answer-delivery method was not called and a `control.stale_rejected` event was logged instead.

### `coordinator.mjs` — trust gate
42. On a worker reporting `WorkerResult.status:'completed'`, the coordinator calls `worktrees.createVerifyWorktree` and passes that path (never `task.worktree`) into `referee()` — assert via a spy that the two paths differ.
43. **Forged done:** worker claims `verification.claimedExit:0` / `status:'completed'`, but the injected `referee()` fake returns `observedExit:1` — assert final `task.status === 'failed'`, `task.verdict.matchesClaim === false`, and `result(worker)` reflects `'failed'`.
44. `result(worker)` before the trust gate resolves returns `{ready:false, status:'verifying'}` (or `'working'`); after it resolves, `{ready:true, status, verdict}`.
45. `worktrees.removeVerifyWorktree` is called exactly once regardless of whether `referee()` resolves or throws (assert via a spy in both a passing and a throwing `referee` fake) — no leaked verify-worktree in either path.
46. If `referee()` throws, `task.status` ends at `'failed'` (never stuck at `'verifying'`, never accidentally `'completed'`), and an `error` event is logged.

### Crash / restart / log-is-truth
47. Replay: feed a hand-constructed sequence of `BatonEvent`s (spawned → turn_started → verify.reverified{pass} → turn_completed) into a fresh worker's log file directly, construct a new `Coordinator`/state-rebuild path, and assert the rebuilt `DriverTask.status === 'completed'` matches what a live run would have produced.
48. On `Coordinator` construction, `worktrees.reconcile()` is invoked exactly once (spy assertion).

### `list()` / `wait()`
49. `list()` includes `'pending'` (queued), `'working'`, `'stopping'`, and `'dead'` workers with correct `status`/`budgetUsed`/`pendingApprovalId` fields.
50. `wait(timeoutMs)` with nothing pending returns at/after `timeoutMs` (bounded, using a short `timeoutMs` in tests) with `{attention:[], facts:[], more:false}` — never hangs past the bound.
51. A pending question/approval/budget-alarm appears in `attention`, ahead of ordinary lifecycle facts, in the same `Digest`.
52. Calling `wait()` twice with nothing new between calls: the second call's `facts`/`attention` do not repeat what the first already returned.
53. **At-least-once across restart:** call `wait()` once (digest returned, NOT re-served yet since no subsequent call arrived), construct a fresh `Coordinator` over the same `Log`/`Cursor` state files (simulating a crash before the caller durably processed the digest), call `wait()` again — the same events are re-served.

---

## 6. Dependencies (module graph, acyclic)

Core (`log.mjs`, `fence.mjs`, `coordinator.mjs`) calls, by name, into:

- **Cluster B — adapter**: `Adapter.card/spawn/prompt/interrupt/approve/kill/onEvent` (§3.2). Core never imports a concrete adapter; it receives `Record<string,Adapter>` via `CoordinatorOpts.adapters`.
- **Cluster B — referee**: one `RefereeFn` passed in via `CoordinatorOpts.referee`.
- **Cluster B — worktree**: one `WorktreeManager` passed in via `CoordinatorOpts.worktrees`.
- **Cluster C — router**: one `RouteFn` passed in via `CoordinatorOpts.route`, used only when `spawn(vendor='auto', ...)`.
- **Cluster C — story**: an optional `StorySink` passed in via `CoordinatorOpts.story`; Core calls `story.record(event)` fire-and-forget (wrapped in try/catch — a broken story sink must never affect coordinator correctness or block a command).

Nothing outside Core (no adapter, no referee, no worktree manager, no router, no story compiler) ever imports from `coordinator.mjs`, `fence.mjs`, or `log.mjs` except to consume their exported classes/typedefs — the dependency arrow is one-directional: **Core is depended upon; Core depends on Cluster B/C only through the interfaces in §3.2, injected at construction time.**

**Test independence note:** Core's own test suite (`impl/test/*.test.mjs`) should construct minimal local fakes conforming to `Adapter`/`RefereeFn`/`WorktreeManager`/`RouteFn` (a few dozen lines each) rather than importing Cluster B's real `MockAdapter`/worktree implementation — this keeps Core buildable and testable in isolation, with no build-order dependency on Cluster B landing first. A later integration test suite (outside this cluster's scope) wires real Cluster B/C modules against Core.

---

## Files this spec targets

- `/Users/wahargis/Development/Experiments/baton/impl/src/log.mjs`
- `/Users/wahargis/Development/Experiments/baton/impl/src/fence.mjs`
- `/Users/wahargis/Development/Experiments/baton/impl/src/coordinator.mjs`
- Tests: `/Users/wahargis/Development/Experiments/baton/impl/test/log.test.mjs`, `fence.test.mjs`, `coordinator.test.mjs` (suggested split matching §5's grouping)

Source docs read to produce this spec: `SYSTEM.md`, `spec/driver.md`, `spec/worktrees.md`, `spec/communication-channel.md`, `spec/supervisor-state-machine.md`, `spec/adapter-contract.md`, `docs/20-adaptive-routing.md`, `docs/21-frontier-features.md`, `GLOSSARY.md`, and the prototype (`prototype/src/types.ts`, `ledger.ts`, `orchestrator.ts`, `referee.ts`, `adapter.ts`) for mining prior art — none of the prototype's TypeScript is reused directly; `impl/src`/`impl/test` are currently empty and untouched.

---

# CLUSTER 2 — WORKERS & TRUST (adapter, worktree, referee)

# Cluster B Implementation Spec — Workers & Trust

*How workers are reached (`adapter.mjs`), isolated (`worktree.mjs`), and verified (`referee.mjs`). Target: modern ESM `.mjs` + JSDoc, runs under plain `node` (v25), tested with `node:test`/`node:assert`, zero external dependencies. Source of authority: `SYSTEM.md`, `spec/driver.md`, `spec/worktrees.md`, `spec/communication-channel.md`, `spec/supervisor-state-machine.md`, `spec/adapter-contract.md`, `docs/20-adaptive-routing.md`, `docs/21-frontier-features.md`.*

---

## 0. Assumed dependency: `log.mjs` (Cluster A)

I do not own `log.mjs`. Every function in this cluster that emits events takes an **injected** `log` object (dependency injection, not an import), so this cluster is unit-testable in total isolation with a stub. The only method I call:

```js
/**
 * @typedef {Object} LogHandle
 * @property {(partial: LogEventInput) => BatonEvent} append
 *   Appends one event. `seq` and `ts` are hub-stamped by the log itself — callers
 *   never set them. MUST be synchronous-or-awaited-before-return from the caller's
 *   perspective (my modules always treat it as fire-and-forget from *their* control
 *   flow — they never block on the return value's `seq` — but they DO pass through
 *   whatever `append` returns to their own return value where documented, for callers
 *   that want it).
 */

/**
 * @typedef {Object} LogEventInput
 * @property {string} worker         - worker id, or a fixed sentinel ("referee","worktree") for non-worker-scoped events
 * @property {string} harness        - e.g. "mock@1.0.0", "codex@0.144.0"; "n/a" for worktree/referee-only events
 * @property {number} turnEpoch      - the fence in scope; 0 if not turn-scoped
 * @property {string} kind           - e.g. "lifecycle.spawned", "verify.reverified" (see docs/05 §1 taxonomy)
 * @property {"worker"|"orchestrator"|"human"|"policy"} actor
 * @property {boolean} [emulated]    - true iff a capability was faked, per adapter card
 * @property {unknown} payload
 */
```

If Cluster A's real signature differs, the fix is a one-line adapter shim at the call site in Cluster C's wiring code — nothing in this cluster's public API needs to change, because every function accepts `log` as a plain parameter (never a hardcoded import), and `log` is optional everywhere (default: a no-op `{ append: () => undefined }`) so every test in this cluster runs without Cluster A existing yet.

**Nothing in this cluster imports from Cluster C.** `referee.mjs` may import from `worktree.mjs` (same cluster, not a violation) but the spec below keeps that coupling to zero anyway — see §3.

---

## 1. Shared typedefs (used across all three modules)

```js
/** @typedef {string} WorkerId */
/** @typedef {string} TaskId */

/**
 * The only context a worker gets. Matches spec/communication-channel.md §3.
 * @typedef {Object} Brief
 * @property {string} goal
 * @property {string[]} constraints
 * @property {string[]} pathScope
 * @property {string} definitionOfDone
 * @property {{command: string, expectExit: number, coverageCommand?: string}} verification
 * @property {{tokens: number, usd: number, wallMin: number}} budget
 * @property {string} [orientationRef]
 * @property {"codex-v2"|"claude"|"glm"} [briefTemplate]
 */

/**
 * A worker's terminal output. NON-AUTHORITATIVE — referee.mjs re-derives the truth.
 * Matches spec/communication-channel.md §5 + prototype's `progress`/`blocker` additions.
 * @typedef {Object} WorkerResult
 * @property {"completed"|"failed"|"blocked"|"cancelled"} status
 * @property {number} progress                    - 0..1, graceful partial delivery
 * @property {string} summary                      - untrusted prose, ≤ ~2000 chars
 * @property {{commits: string[], diffRef?: string, files: string[]}} artifacts
 * @property {{command: string, claimedExit: number, tailRef?: string}} verification  - a CLAIM
 * @property {string} [blocker]                    - set iff status === "blocked"
 * @property {string[]} openQuestions
 * @property {{tokens: number, usd: number}} budgetUsed
 */

/**
 * Per-harness capability negotiation. Matches spec/adapter-contract.md "harness card".
 * @typedef {Object} HarnessCard
 * @property {string} harness                      - e.g. "mock", "codex", "claude-code", "glm-via-claude"
 * @property {string} version
 * @property {"subscription"|"api_key"} authPosture
 * @property {number} concurrencyCeiling            - HARD scheduler input (GLM Pro = 1)
 * @property {number} maxContext
 * @property {Record<string, "native"|"emulated"|"unsupported">} verbs
 *   Required keys at minimum: "spawn", "interrupt". Optional: "steer", "ask", "usage".
 */
```

---

## 2. `adapter.mjs`

### Single responsibility
Defines the worker-reaching contract (`card()` + `run()`), and ships two concrete implementations: `MockAdapter` (fully functional, deterministic, scriptable — the thing everything else tests against) and three `SubprocessAdapter`-family stubs (`CodexAdapter`, `ClaudeAdapter`, `GlmAdapter`) that are structurally complete but execution-guarded off by default so no test ever spends model quota.

### Exact public API

```js
/**
 * The adapter interface every harness implementation satisfies. Not a JS `interface`
 * (none exist) — a duck-typed contract. `assertIsAdapter(obj)` (below) validates it.
 *
 * @typedef {Object} Adapter
 * @property {() => HarnessCard} card
 * @property {(brief: Brief, opts: RunOpts) => Promise<WorkerResult>} run
 *   MUST resolve (never reject) for every WORKER-MEDIATED outcome — completed, failed,
 *   blocked, cancelled (including cancellation via opts.signal). MUST reject ONLY for
 *   adapter/process-level failure outside the worker's own task semantics: an
 *   unspawnable process, a crash, a fatal I/O error. Rejects with an AdapterCrashError.
 *   Callers MUST NOT conflate a low-quality WorkerResult with a rejection — they are
 *   different failure classes (I7 in supervisor-state-machine.md: even a "failed"
 *   WorkerResult is an unverified CLAIM the referee must still re-check; a rejection
 *   means there is no claim to check at all).
 */

/**
 * @typedef {Object} RunOpts
 * @property {string} worktree        - absolute path to the worker's OWN git worktree (its cwd). Never the verify sandbox.
 * @property {number} timeoutMs       - hard ceiling; adapter MUST settle by this deadline (resolve with status "cancelled" + a note, or for SubprocessAdapter, kill the child and resolve "failed")
 * @property {AbortSignal} [signal]   - caller aborts to request interrupt (two-phase stop, driven by Cluster C). Adapter MUST react and settle promptly — see Invariant A5.
 * @property {(q: AskQuestion) => Promise<AskAnswer>} [onAsk]
 *   Called when the worker needs to ask. If omitted and the worker scenario emits a
 *   BLOCKING ask, the adapter parks (does not settle) until `signal` aborts — this is
 *   intentional: it is how a real stuck/unanswered worker is simulated end-to-end.
 * @property {LogHandle} [log]        - see §0. Defaults to a no-op.
 * @property {WorkerId} [workerId]    - stamped onto emitted log events; defaults to "w_unknown"
 * @property {number} [turnEpoch]     - stamped onto emitted log events; defaults to 0
 * @property {Record<string,string>} [env]
 * @property {string} [model]
 * @property {boolean} [live]         - SubprocessAdapter only: MUST be true (AND process.env.BATON_ALLOW_LIVE_ADAPTERS === "1") to spawn a real CLI; else structural dry-run. MockAdapter ignores this field entirely — it always "does the work" deterministically, in-process, no quota involved by construction.
 */

/**
 * @typedef {Object} AskQuestion
 * @property {string} question
 * @property {string[]} [options]
 * @property {boolean} blocking
 * @property {string} [contextRef]
 */
/** @typedef {{decision?: string, text?: string}} AskAnswer */

/**
 * Thrown (as a Promise rejection from `run`) when the WORKER PROCESS ITSELF dies
 * unexpectedly — distinct from a WorkerResult with status "failed".
 * @extends Error
 */
export class AdapterCrashError extends Error {
  /** @param {{workerId: WorkerId, taskId?: TaskId, cause?: unknown}} info */
  constructor(info) { /* sets this.name = "AdapterCrashError"; this.workerId, this.taskId, this.cause */ }
}

/** Throws TypeError with a precise message if `obj` doesn't duck-type Adapter. */
export function assertIsAdapter(obj) { /* checks typeof card === "function" && typeof run === "function" */ }
```

#### `MockAdapter`

```js
/**
 * @typedef {Object} MockEdit
 * @property {string} path            - relative to the worktree
 * @property {string} content          - full file content to write (mock keeps it simple: whole-file writes, not patches)
 * @property {number} [delayMs=0]      - simulated think time BEFORE writing this edit (interruptible: checked against opts.signal via a cancellable sleep)
 */

/**
 * @typedef {Object} MockAskScript
 * @property {AskQuestion} question
 * @property {number} [afterEditIndex=0]  - emit the ask after this many edits have been applied (0 = before any edits)
 * @property {MockEdit[]} [onAnswerEdits] - extra edits appended after an answer/onAsk resolves (non-blocking scripts may supply a default continuation here even with no onAsk)
 */

/**
 * The full scenario a MockAdapter run enacts. Deterministic: same scenario + same
 * opts.signal timing → same event sequence and same final WorkerResult, every run.
 * @typedef {Object} MockScenario
 * @property {"completed"|"failed"|"blocked"|"cancelled"} outcome
 *   The outcome IF NOT interrupted and IF no crash fires first. "blocked" requires
 *   `blocker` to be set.
 * @property {MockEdit[]} [edits]      - applied strictly in order
 * @property {MockAskScript} [ask]
 * @property {number} [crashAfterMs]    - if set, `run` rejects with AdapterCrashError once this much simulated time has elapsed AND no earlier abort/completion has occurred
 * @property {boolean} [forgeSuccess=false]
 *   If true: WorkerResult.status is forced to "completed" and
 *   WorkerResult.verification.claimedExit is forced to the brief's `expectExit`,
 *   REGARDLESS of `outcome`/`edits` — i.e. the mock lies. The `edits` still get
 *   written and committed exactly as scripted (this is the whole point: the code on
 *   disk may still genuinely fail the pinned verification command — referee.mjs's job
 *   is to catch that divergence).
 * @property {string} [blocker]
 * @property {string[]} [openQuestions]
 * @property {string} [summary]
 * @property {{tokens: number, usd: number}} [budgetUsed]
 * @property {string} [authorName]      - git commit author; defaults to "baton-worker-mock"
 * @property {string} [authorEmail]     - defaults to "baton-worker-mock@localhost"
 */

export class MockAdapter {
  /**
   * @param {{harness?: string, version?: string, concurrencyCeiling?: number,
   *           maxContext?: number, scenario: MockScenario}} config
   *   `scenario` is the DEFAULT scenario used when a `run` call's `opts` doesn't
   *   override it. `harness`/`version`/etc. configure `card()` (per-vendor-simulation
   *   knobs — tests can construct e.g. `new MockAdapter({harness:"mock-codex",
   *   concurrencyCeiling:4, scenario})` to stand in for a specific vendor's limits).
   */
  constructor(config) {}

  /** @returns {HarnessCard} verbs: {spawn:"native", interrupt:"native", ask: scenario-dependent -> always declared "native" for MockAdapter (it fully implements ask)} */
  card() {}

  /**
   * @param {Brief} brief
   * @param {RunOpts & {scenario?: MockScenario}} opts
   *   `opts.scenario`, if present, OVERRIDES the constructor default for this one call
   *   (lets one MockAdapter instance stand in for a vendor across many differently-
   *   scripted spawns in a test without constructing N adapters).
   * @returns {Promise<WorkerResult>}
   * @throws {AdapterCrashError} per scenario.crashAfterMs
   */
  async run(brief, opts) {}
}
```

`MockAdapter.run` emits (via `opts.log`, if given) at minimum, in order: `lifecycle.turn_started` → zero-or-more `action.file_edit` (one per applied edit) → zero-or-one `control.approval.requested`-equivalent for the ask (`kind: "approval.requested"`, `payload: {question, blocking}`) → terminal event: `lifecycle.turn_completed` (outcome completed/failed/blocked) or `control.interrupt_confirmed` (outcome cancelled via abort). A crash emits `lifecycle.crashed` immediately before the promise rejects.

Mock git mechanics: `MockAdapter` performs real filesystem writes + real `git add -A && git commit` (via `node:child_process`, `cwd: opts.worktree`) for every scripted edit that gets reached before interruption/crash — it does **not** simulate git, it uses it, so `worktree.mjs`'s `captureCommit` and `referee.mjs`'s re-run see a genuinely real, genuinely inspectable commit. It never runs `brief.verification.command` itself (Invariant A6).

#### `SubprocessAdapter` family

```js
/**
 * Shared guard + argv-construction base. NOT exported directly — exported concrete
 * subclasses are CodexAdapter, ClaudeAdapter, GlmAdapter.
 */
class SubprocessAdapterBase {
  /** @returns {HarnessCard} */
  card() { throw new Error("abstract"); }

  /** @param {Brief} brief @param {RunOpts} opts @returns {{cmd: string, args: string[]}} */
  argv(brief, opts) { throw new Error("abstract"); }

  /**
   * @param {Brief} brief @param {RunOpts} opts
   * @returns {Promise<WorkerResult>}
   * GUARD: only actually spawns a child process when BOTH
   *   `opts.live === true` AND `process.env.BATON_ALLOW_LIVE_ADAPTERS === "1"`.
   * Otherwise returns synchronously (after an optional opts.simulateMs sleep) with
   *   { status: "blocked", progress: 0, blocker: "live adapters disabled
   *     (set BATON_ALLOW_LIVE_ADAPTERS=1 and opts.live=true)", verification:
   *     { command: brief.verification.command, claimedExit: -1 }, ... }
   * This dry-run WorkerResult's `verification.claimedExit` is always -1, deliberately
   * un-matchable to any real expectExit, so a caller that forgets the guard exists
   * cannot accidentally treat a disabled adapter as having passed anything.
   */
  async run(brief, opts) {}
}

export class CodexAdapter extends SubprocessAdapterBase {
  /** verbs: {spawn:"native", interrupt:"native", steer:"native", ask:"native"} */
  card() {}
  /** cmd:"codex", args:["--ask-for-approval","never","--sandbox","danger-full-access","exec","--json","--skip-git-repo-check", renderBrief(brief,"codex-v2")] */
  argv(brief, opts) {}
}

export class ClaudeAdapter extends SubprocessAdapterBase {
  /** verbs: {spawn:"native", interrupt:"native", steer:"emulated", ask:"native"} */
  card() {}
  /** cmd:"claude", args:["-p", renderBrief(brief,"claude"), "--permission-mode",opts.permissionMode ?? "bypassPermissions", ...(opts.model?["--model",opts.model]:[])] */
  argv(brief, opts) {}
}

export class GlmAdapter extends ClaudeAdapter {
  /** Same as ClaudeAdapter but harness:"glm-via-claude", concurrencyCeiling:1 (Pro tier, HARD). run() additionally injects ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN into the child env from opts.env (never falls back to the orchestrator's own Anthropic key — that would violate scoped-secrets safety, SYSTEM.md §5.6). */
  card() {}
}

/** Per-harness brief dialect (communication-channel.md §3: "authored per-harness"). Pure function, no side effects — this is what makes it trivially unit-testable without spawning anything. */
export function renderBrief(brief, dialect) {}
```

### Invariants

- **A1.** `run()` NEVER runs `brief.verification.command`. Only `referee.mjs` ever executes a pinned verification command, and only in a fresh sandbox. (A worker adapter that self-verified would make the trust gate meaningless.)
- **A2.** `run()` resolves for every worker-mediated outcome; rejects (with `AdapterCrashError`) only for adapter/process-level failure. These are never conflated in the same channel.
- **A3.** `MockAdapter` is **deterministic**: given an identical `scenario` and identical abort timing (or no abort), two runs produce byte-identical `WorkerResult` (module timestamps aside — none appear in `WorkerResult`) and the same ordered event-kind sequence.
- **A4.** `scenario.forgeSuccess` affects only the *claimed* result, never the actual files written/committed. The worktree's real content is always the literal, honest result of `scenario.edits` having been applied (or partially applied, if interrupted/crashed first).
- **A5 (confirm-it-stopped, adapter side).** Once `opts.signal` fires `abort`, `run()` MUST settle (resolve) within a bounded, adapter-declared reaction window — for `MockAdapter` this is the current microtask/next tick (no artificial delay beyond in-flight `git commit` completion); for `SubprocessAdapter`-family it is "the time to SIGTERM the child, wait `opts.killGraceMs` (default 3000), SIGKILL, then resolve." A caller MUST be able to treat "the promise settled" as the two-phase-stop confirmation.
- **A6.** `SubprocessAdapter.run()` never spawns a real process unless BOTH the per-call `opts.live===true` AND the process-wide `BATON_ALLOW_LIVE_ADAPTERS=1` env var are set. This is a two-key guard (one code-level, one operator-level) — flipping only one never enables live execution. No test may rely on the live path; it is out of scope (declared, not silently skipped) for this cluster's required test coverage.
- **A7.** `card()` never claims `"native"` for a verb the adapter cannot actually do; where SubprocessAdapter behavior is genuinely unverified (e.g. Codex `turn/steer` timing per `spec/adapter-contract.md`), the card must say `"emulated"` or omit the verb rather than assert `"native"` speculatively. (No silent emulation — `spec/adapter-contract.md`.)
- **A8.** Every `AbortSignal`-driven cancellation in `MockAdapter` yields `status: "cancelled"` with `progress` reflecting exactly how many scripted edits committed before the abort was observed (an integer count / total scripted edits, so tests can assert partial completion precisely).

### Behaviors to test

1. `card()` returns a well-formed `HarnessCard` for `MockAdapter`, `CodexAdapter`, `ClaudeAdapter`, `GlmAdapter` (required fields present, `concurrencyCeiling` a positive integer, `GlmAdapter.card().concurrencyCeiling === 1`).
2. `assertIsAdapter` accepts all four adapter classes and rejects `{}`, `{card(){}}` (missing `run`), and `null`.
3. `MockAdapter.run` with `outcome:"completed"`, no ask, no crash: resolves with `status:"completed"`, all scripted edits present as real files in `opts.worktree`, and a real git commit exists (`git log -1` in the worktree shows the commit; author matches `scenario.authorName` default or override).
4. `MockAdapter.run` with `outcome:"failed"`: resolves with `status:"failed"`; edits are still applied and committed (a worker can fail after doing real, if wrong, work).
5. `MockAdapter.run` with `outcome:"blocked"` and no `blocker` set: throws synchronously (construction-time contract violation) — or, if validated lazily, rejects with a `TypeError`, not a silently-empty `blocker`. (Pick one; document which — recommend: validate at `run()` entry, reject with `TypeError`.)
6. **Forge-success divergence surface**: `scenario.forgeSuccess:true` with `outcome:"failed"` and edits that do NOT satisfy some external verification command (proven by a downstream referee test, #34 below) still resolves `status:"completed"`, `verification.claimedExit === brief.verification.expectExit` — i.e. the mock successfully lies about itself, on purpose, so the trust gate has something real to catch.
7. Deterministic replay: running the same scenario twice (no abort) in two different fresh worktrees yields identical `WorkerResult` objects (deep-equal, modulo any deliberately-random field — there should be none) and identical committed file contents.
8. **Mid-run interrupt**: start a run with `scenario.edits` containing ≥3 edits each with `delayMs>0`; abort after the first edit lands (poll the worktree or use a log hook) but before the second. Assert: `run()` settles (resolves) within a small bounded time after abort; `status==="cancelled"`; exactly 1 edit is committed; `progress` reflects `1/3`.
9. **Interrupt races completion**: abort the signal at essentially the same moment `run()` would have naturally completed (`delayMs:0` on all edits, immediate abort). Assert the result is one of the two well-defined outcomes (`"cancelled"` or the scenario's natural `outcome`) — never a hang, never a rejected promise, never a malformed result missing required fields.
10. **Blocking ask, answered**: `scenario.ask.blocking:true`; `opts.onAsk` resolves with an answer after a delay. Assert `run()` does not settle before `onAsk`'s promise resolves, and the post-answer `onAnswerEdits` (if present) are applied afterward.
11. **Blocking ask, never answered, then interrupted**: `scenario.ask.blocking:true`, no `opts.onAsk`. Assert `run()` never settles until `opts.signal` aborts; once aborted, it settles with `status:"cancelled"` promptly (proves an unanswered worker doesn't hang the *adapter* forever — only the caller's choice not to interrupt would).
12. **Non-blocking ask**: `scenario.ask.blocking:false`, no `opts.onAsk`. Assert `run()` proceeds to completion without waiting, and the ask event was still emitted (checked via a stub `log`).
13. **Crash**: `scenario.crashAfterMs` set, shorter than the first edit's `delayMs`. Assert `run()` REJECTS (not resolves) with an `AdapterCrashError` carrying `workerId`. Assert no files past the crash point were committed (crash truncates work, doesn't fake completion).
14. **Crash never conflated with failure**: a promise-rejection handler and a `status:"failed"` resolution are distinguishable in a single test harness that runs both scenarios back-to-back and asserts they hit different code paths (`try/catch` vs a `.status` check).
15. **Timeout enforcement**: `opts.timeoutMs` shorter than the scripted total work time, no `opts.signal` provided by the caller. Assert `MockAdapter` self-enforces the timeout (settles with `status:"cancelled"` and a note mentioning timeout) — i.e. the adapter treats its own `timeoutMs` as an implicit abort source even without an externally-supplied `AbortSignal`.
16. **Log emission**: with a stub `log` (`append` pushes into an array), assert the emitted event *kinds* for a full `completed` run appear in the documented order, each with `payload` containing enough structure to reconstruct what happened (edit paths, ask question, final status).
17. **`opts.log` omitted**: `run()` behaves identically (same `WorkerResult`) whether or not `opts.log` is supplied — logging is observation, never a side channel that changes outcomes.
18. `renderBrief(brief, "codex-v2")` and `renderBrief(brief, "claude")` both include the exact `definitionOfDone` string and the exact `verification.command` string verbatim (this is the load-bearing property from `docs/21`: "the worker can never redefine done" — the rendered brief must literally contain the pinned command).
19. `SubprocessAdapter.run()` with the live guard OFF (default): resolves (never rejects, never actually spawns — assert via monkeypatching `child_process.spawn` to throw if called, or checking no child process appears) with `status:"blocked"`, `blocker` mentioning the guard, `verification.claimedExit === -1`, for all three of `CodexAdapter`/`ClaudeAdapter`/`GlmAdapter`.
20. `SubprocessAdapter.run()` with only ONE of the two guard keys set (either `opts.live:true` XOR the env var) still takes the disabled path — proves the two-key guard is a real AND, not an OR.
21. `argv()` for each `SubprocessAdapter` subclass produces the exact `cmd`/`args` documented in `spec/adapter-contract.md` (Codex: `codex --ask-for-approval never --sandbox danger-full-access exec --json --skip-git-repo-check <brief>`; Claude: `claude -p <brief> --permission-mode bypassPermissions`; GLM: same as Claude), verified as a pure unit test with no process spawned. Explicit narrower permission overrides remain selectable.
22. `GlmAdapter.card().harness === "glm-via-claude"` and `concurrencyCeiling === 1` even though it extends `ClaudeAdapter`.

---

## 3. `worktree.mjs`

### Single responsibility
All git-worktree lifecycle mechanics: create a worker's isolated checkout from a pinned base, capture its result as a commit, build a fresh throwaway sandbox at any SHA (used both for the trust gate's result check and, by a caller wiring red→green, for a base-SHA check), reap on done/crash, and reconcile zombies on boot. Everything shells out to a real `git` binary against a real repo — no git library, no mocking of git itself (tests run against real temp repos).

### Exact public API

```js
/**
 * @typedef {Object} WorktreeHandle
 * @property {TaskId} taskId
 * @property {string} dir            - absolute path, always under `<repoRoot>/.baton/wt/<taskId>`
 * @property {string} branch          - "baton/<taskId>"
 * @property {string} baseSha
 * @property {string} createdAt       - ISO string (worktree.mjs's own clock stamp; NOT the log's — this is local bookkeeping metadata, not an authoritative event)
 */

/**
 * @typedef {Object} VerifySandbox
 * @property {string} dir            - absolute path, always under `<repoRoot>/.baton/verify/<label>`, NEVER under `.baton/wt/`
 * @property {string} sha             - the SHA it's detached-checked-out at
 * @property {() => Promise<void>} cleanup  - removes the sandbox worktree; idempotent, safe to call more than once
 */

/**
 * @typedef {Object} PinnedBaseResult
 * @property {string} sha
 * @property {boolean} stashed        - true iff repoRoot had uncommitted changes that were auto-stashed
 * @property {string} [stashRef]      - present iff stashed:true (e.g. "stash@{0}") — worktree.mjs never auto-pops; the caller decides
 */

/**
 * @typedef {Object} CaptureResult
 * @property {string} sha             - the resulting HEAD sha of the worktree (worker's own commit, if clean, or a new snapshot commit)
 * @property {boolean} snapshotted    - true iff worktree.mjs created the commit (worktree was dirty); false iff the worker's own commit was used as-is
 */

/**
 * @typedef {Object} ReconcileReport
 * @property {string[]} prunedAdminEntries    - `git worktree prune` output lines
 * @property {string[]} removedZombieDirs     - directories under .baton/wt or .baton/verify removed because their taskId wasn't in `expectedActiveTaskIds`
 * @property {string[]} errors                - non-fatal issues encountered (e.g. a dir that couldn't be removed); reconcile() best-effort continues past these
 */

/**
 * Ensure `repoRoot` has a reproducible base SHA to branch from, per spec/worktrees.md
 * "pin a clean base": if the repo is dirty, either throws (default) or auto-stashes.
 * @param {string} repoRoot
 * @param {{autoStash?: boolean, targetRef?: string}} [opts]
 *   `targetRef` defaults to "HEAD". If provided, dirtiness of repoRoot is irrelevant
 *   ONLY when targetRef resolves to a sha that isn't HEAD-with-uncommitted-changes —
 *   in practice this function ALWAYS checks dirtiness when targetRef resolves to the
 *   currently-checked-out branch tip, because that's the only case where "dirty"
 *   creates ambiguity about what the pin actually captured.
 * @returns {Promise<PinnedBaseResult>}
 * @throws {DirtyRepoError} if dirty and !opts.autoStash
 */
export async function pinBaseSha(repoRoot, opts = {}) {}

/**
 * CREATE. Makes `.baton/wt/<taskId>` on branch `baton/<taskId>` from `baseSha`, and
 * writes a local metadata sidecar (`.baton/wt/<taskId>.meta.json`) recording
 * {taskId, branch, baseSha, createdAt, stoppedAt:null}. This sidecar is a CACHE, never
 * the source of truth — if lost, `reconcile()` treats the directory as a zombie unless
 * the caller supplies it in `expectedActiveTaskIds` (rebuilt from the log).
 * @param {string} repoRoot
 * @param {TaskId} taskId
 * @param {string} baseSha
 * @param {{log?: LogHandle}} [opts]
 * @returns {Promise<WorktreeHandle>}
 * @throws {BranchAlreadyCheckedOutError} if `baton/<taskId>` is already checked out elsewhere (git's own enforcement, surfaced with a precise error type instead of a raw git stderr blob)
 * @throws {WorktreeAlreadyExistsError} if `.baton/wt/<taskId>` already exists
 */
export async function createFromBase(repoRoot, taskId, baseSha, opts = {}) {}

/**
 * CAPTURE. The unit of result is a commit, never a dirty tree. If the worktree has
 * uncommitted changes, commits a snapshot (author defaults to "baton-worker-<vendor>"
 * if `opts.vendor` given, else "baton-snapshot"; trailers: `Baton-Task: <taskId>`,
 * `Baton-Vendor: <vendor>` if given). If already clean, returns the existing HEAD
 * unchanged — does NOT create an empty commit.
 * @param {string} repoRoot
 * @param {TaskId} taskId
 * @param {{vendor?: string, model?: string, log?: LogHandle}} [opts]
 * @returns {Promise<CaptureResult>}
 * @throws {UnknownWorktreeError} if `.baton/wt/<taskId>` doesn't exist
 */
export async function captureCommit(repoRoot, taskId, opts = {}) {}

/**
 * VERIFY sandbox. A NEW, throwaway, detached worktree at `sha` — never the worker's
 * own dir. `label` disambiguates concurrent/repeat sandboxes for the same task (e.g.
 * "<taskId>-result" vs "<taskId>-base"); worktree.mjs appends a short random suffix
 * internally so repeated calls with the same label never collide.
 * @param {string} repoRoot
 * @param {string} label
 * @param {string} sha
 * @param {{log?: LogHandle}} [opts]
 * @returns {Promise<VerifySandbox>}
 * @throws {InvalidShaError} if `sha` doesn't resolve to a commit in repoRoot
 */
export async function freshVerifySandbox(repoRoot, label, sha, opts = {}) {}

/**
 * Marks a worker's worktree as safe to reap (two-phase-stop confirmed by the caller —
 * Cluster C — AFTER it has observed the adapter's `run()` promise settle following an
 * interrupt/kill). `reap()` refuses without this (or `opts.force`) — see Invariant W5.
 * @param {string} repoRoot
 * @param {TaskId} taskId
 * @returns {Promise<void>}
 */
export async function markStopped(repoRoot, taskId) {}

/**
 * CLEANUP. Removes `.baton/wt/<taskId>` and (if `opts.deleteBranch`) the branch.
 * Idempotent: calling on an already-removed taskId is a no-op, not an error.
 * @param {string} repoRoot
 * @param {TaskId} taskId
 * @param {{force?: boolean, deleteBranch?: boolean, log?: LogHandle}} [opts]
 * @returns {Promise<void>}
 * @throws {WorktreeLockedError} if `markStopped` was never called and `!opts.force`
 */
export async function reap(repoRoot, taskId, opts = {}) {}

/**
 * BOOT reconciliation. `git worktree prune`s stale admin files, then scans
 * `.baton/wt/*` and `.baton/verify/*` and removes any directory whose taskId/label is
 * not in `expectedActiveTaskIds` (rebuilt by the caller from the log — the log is the
 * only source of truth about what SHOULD be active; this function only cleans up what
 * shouldn't be). Always safe to call repeatedly (idempotent).
 * @param {string} repoRoot
 * @param {TaskId[]} expectedActiveTaskIds
 * @param {{log?: LogHandle}} [opts]
 * @returns {Promise<ReconcileReport>}
 */
export async function reconcile(repoRoot, expectedActiveTaskIds, opts = {}) {}

/**
 * Structured diff between two SHAs, for coverage-of-change wiring (see referee.mjs
 * §4). Runs `git diff --unified=0 fromSha toSha` and parses hunk headers.
 * @param {string} repoRoot
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {Promise<Record<string, number[]>>}  - path -> sorted array of changed/added line numbers in `toSha`'s version of the file
 */
export async function changedLines(repoRoot, fromSha, toSha) {}

/** @returns {Promise<Array<{dir: string, sha: string, branch: string|null, detached: boolean}>>} */
export async function listWorktrees(repoRoot) {}

export class DirtyRepoError extends Error {}
export class BranchAlreadyCheckedOutError extends Error {}
export class WorktreeAlreadyExistsError extends Error {}
export class UnknownWorktreeError extends Error {}
export class InvalidShaError extends Error {}
export class WorktreeLockedError extends Error {}
```

### Invariants

- **W1.** Every worktree this module creates lives under `<repoRoot>/.baton/` — `.baton/wt/<taskId>` for a worker's own worktree, `.baton/verify/<label>-<suffix>` for a throwaway sandbox. The two directories are **structurally namespaced apart**; `freshVerifySandbox`'s output path can never equal any `createFromBase` output path, by construction, not by convention.
- **W2.** `captureCommit` NEVER leaves the worktree dirty and NEVER fabricates a commit when the tree is already clean (no empty commits).
- **W3.** `freshVerifySandbox` is always `--detach`ed at an exact SHA — never a branch — so it can never accidentally pick up new commits and can never be the same ref the worker's own worktree is on.
- **W4.** `pinBaseSha` never silently stashes; `stashed:true` is always reported back, and the stash is never auto-popped by this module.
- **W5 (ties to supervisor I6).** `reap()` refuses (throws `WorktreeLockedError`) on a worktree that hasn't been `markStopped`, unless `opts.force` — operationalizing "cleanup is gated on confirmed-stop" as an enforced precondition, not just caller discipline. `reconcile()` uses `opts.force`-equivalent internally only for directories whose taskId is NOT in `expectedActiveTaskIds` at all (a true zombie has no in-progress stop protocol to respect).
- **W6.** `reconcile()` is idempotent and side-effect-free on a state that's already clean (running it twice in a row produces an empty `removedZombieDirs` the second time).
- **W7.** All git plumbing errors are caught and re-thrown as the module's typed error classes with the offending `taskId`/`sha`/`branch` attached — never a bare `Error` wrapping raw stderr, so callers (and tests) can `assert.rejects(fn, ErrorClass)`.
- **W8.** `changedLines` is computed purely from git (`git diff --unified=0`), never from adapter/worker self-reports — the same "hub computes it, doesn't trust the claim" posture as verification itself.

### Behaviors to test

*(all against a real temp git repo created fresh per test — `git init`, one initial commit, `git config user.email/user.name` set locally)*

23. `pinBaseSha` on a clean repo returns `{sha: <HEAD>, stashed:false}`.
24. `pinBaseSha` on a dirty repo with `autoStash:false` (default) throws `DirtyRepoError`; the repo is left untouched (still dirty, nothing stashed).
25. `pinBaseSha` on a dirty repo with `autoStash:true` returns `{stashed:true, stashRef}`, and the repo is now clean at the same `sha` as before the dirty changes existed.
26. `createFromBase` produces a directory at exactly `<repoRoot>/.baton/wt/<taskId>`, on branch `baton/<taskId>`, whose `git log -1` is `baseSha`.
27. `createFromBase` called twice with the same `taskId` throws `WorktreeAlreadyExistsError` on the second call.
28. `createFromBase` called with a `taskId` whose branch is already checked out elsewhere (simulate by manually running `git worktree add`) throws `BranchAlreadyCheckedOutError`.
29. `captureCommit` on a worktree where the "worker" (test writes a file directly + `git commit`) already committed: `snapshotted:false`, returned `sha` equals that commit.
30. `captureCommit` on a worktree with uncommitted changes: `snapshotted:true`, a new commit exists with the given `vendor` trailer, worktree is clean afterward.
31. `captureCommit` on a worktree with NO changes at all since `baseSha` (worker did nothing): `snapshotted:false`, `sha === baseSha`, no empty commit created.
32. `freshVerifySandbox(repoRoot, "t1-result", sha)` produces a directory that is (a) not equal to and not nested under `.baton/wt/t1`, (b) detached HEAD at exactly `sha`, (c) contains the file content that commit has.
33. Two calls to `freshVerifySandbox` with the same `label` produce two non-colliding directories (both exist simultaneously without error).
34. `sandbox.cleanup()` removes the directory; calling `cleanup()` a second time does not throw.
35. `freshVerifySandbox` with a garbage `sha` throws `InvalidShaError` before creating any directory.
36. `reap()` on a worktree that was never `markStopped` throws `WorktreeLockedError`; the directory still exists afterward.
37. `reap()` on a worktree after `markStopped` succeeds: the directory is gone; `git worktree list` no longer shows it.
38. `reap()` with `opts.force:true` succeeds even without `markStopped`.
39. `reap()` called twice on the same (already-reaped) `taskId` is a no-op both times (no throw).
40. **Interrupt-then-reap sequencing (integration with adapter.mjs):** create a worktree, run a `MockAdapter` scenario in it, abort mid-run, await the settled `WorkerResult` (status `"cancelled"`), call `markStopped`, then `reap` — succeeds and the partial commit made by the mock before abort is gone with the directory (as expected — an abandoned worktree's uncommitted-and-committed-but-unmerged work is simply discarded unless the caller explicitly captured/merged it first).
41. `reconcile` with `expectedActiveTaskIds:[]` on a repo with two leftover `.baton/wt/*` directories from crashed "workers" (created directly via `createFromBase` in the test, not via a real crash) removes both, reports them in `removedZombieDirs`, and running it again immediately after reports empty arrays (W6).
42. `reconcile` with an `expectedActiveTaskIds` entry matching one of two leftover directories leaves that one alone and removes only the other.
43. `changedLines` between a base commit and a commit that adds 3 new lines to `foo.js` and modifies 1 existing line in `bar.js` returns `{ "foo.js": [<3 line numbers>], "bar.js": [<1 line number>] }` — verified against a hand-constructed diff with known line numbers.
44. `changedLines` between identical SHAs returns `{}`.
45. `listWorktrees` after creating two worktrees + one verify sandbox reports all three with correct `dir`/`branch`/`detached` fields.
46. Every function that accepts `opts.log` calls `append` with at least one event whose `kind` starts with a documented prefix (`lifecycle.` or a `worktree.`-scoped kind — pick and document a fixed vocabulary, e.g. `worktree.created`, `worktree.captured`, `worktree.verify_sandbox_created`, `worktree.reaped`, `worktree.reconciled`) for `createFromBase`, `captureCommit`, `freshVerifySandbox`, `reap`, `reconcile`.

---

## 4. `referee.mjs`

### Single responsibility
The TRUST GATE. Re-runs the task's *pinned* verification command in a fresh sandbox the worker never controlled, and derives a `Verdict` the coordinator can actually trust — hardened with red→green and coverage-of-change. The worker's self-reported exit code is used only to detect divergence, never as evidence of anything.

### Exact public API

```js
/**
 * @typedef {Object} PinnedVerification
 * @property {string} command
 * @property {number} expectExit
 * @property {string} [coverageCommand]  - optional. If present, run AFTER `command` (same sandbox) whenever `command`'s observed exit === expectExit. Its stdout MUST be JSON: { "files": { "<relative path>": { "executedLines": number[] } } }. Any other output format => coverageOfChange stays null and verdict.note records a parse failure (never crashes the whole verify()).
 * @property {number} [timeoutMs=120000]
 */

/**
 * @typedef {Object} RefereeTask
 * @property {TaskId} id
 * @property {PinnedVerification} verification
 * @property {Record<string, number[]>} [changedLines]  - path -> line numbers, typically from worktree.changedLines(repoRoot, baseSha, resultSha); required only if coverage-of-change is to be evaluated
 * @property {string} [workerWorktreeDir]  - absolute path of the WORKER's own worktree, if known to the caller — used purely as a defensive assertion (Invariant R1); omit if unknown
 */

/**
 * @typedef {Object} Verdict
 * @property {boolean} reverified
 * @property {number|null} observedExit
 * @property {boolean} matchesClaim
 * @property {boolean} passed
 * @property {"fresh_sandbox"} locus
 * @property {boolean|null} redGreen         - null: not evaluated (no baseSandbox given). true: base run's exit !== expectExit AND result run passed. false: base run's exit === expectExit (the check didn't actually distinguish before/after) regardless of the result run.
 * @property {number|null} baseExit
 * @property {boolean|null} coverageOfChange - null: not evaluated (no coverageCommand, or `command` didn't pass, or no `task.changedLines` supplied). true/false otherwise.
 * @property {string[]} uncoveredChangedLines  - e.g. ["src/x.js:42"]; empty when coverageOfChange is true or null
 * @property {string} observedOutputTail      - combined stdout+stderr from the RESULT run, truncated to the last 4000 chars
 * @property {string} note
 * @property {number} durationMs               - wall time of the result run only (not including base/coverage runs)
 */

/**
 * Re-derive the truth of a worker's result.
 * @param {RefereeTask} task
 * @param {WorkerResult} result
 * @param {VerifySandbox} sandbox         - built by the caller via worktree.freshVerifySandbox at the worker's COMMITTED result sha; MUST already be a fresh, throwaway sandbox
 * @param {{ baseSandbox?: VerifySandbox, requireRedGreen?: boolean, requireCoverage?: boolean, log?: LogHandle, worker?: WorkerId }} [opts]
 *   `baseSandbox`, if provided, MUST be built by the caller via
 *   worktree.freshVerifySandbox at the task's pinned base SHA — enabling red→green.
 *   `requireRedGreen`/`requireCoverage` do NOT change what `verify()` computes; they
 *   only affect what `accept()` later requires (kept as separate concerns: verify()
 *   always computes everything it can; accept() decides what's mandatory).
 * @returns {Promise<Verdict>}
 * @throws {SameWorktreeError} if `task.workerWorktreeDir` is given and equals `sandbox.dir` (Invariant R1) — thrown BEFORE any command runs
 */
export async function verify(task, result, sandbox, opts = {}) {}

/**
 * A verdict is trustworthy — and a result is safe to mark "done"/merge — iff the hub
 * itself observed a pass, AND (if required) the hardening checks that were requested
 * came back true, not merely non-false.
 * @param {Verdict} verdict
 * @param {{ requireRedGreen?: boolean, requireCoverage?: boolean }} [opts]
 * @returns {boolean}
 */
export function accept(verdict, opts = {}) {}

export class SameWorktreeError extends Error {}
```

`verify()` internals (precise, so an implementer needs no further questions):

1. If `task.workerWorktreeDir && task.workerWorktreeDir === sandbox.dir` → throw `SameWorktreeError` immediately (Invariant R1); nothing has run yet.
2. Run `task.verification.command` via `sh -c` in `sandbox.dir`, capturing combined stdout+stderr, bounded by `task.verification.timeoutMs` (default 120000ms; on timeout, kill the process group and treat as `observedExit: null`, `note` explains timeout).
3. `matchesClaim = observedExit === result.verification.claimedExit` (both may be `null`/differ in type only if a timeout occurred — document `null !== number` as always a mismatch).
4. `passed = observedExit === task.verification.expectExit`.
5. **Red→green**, only if `opts.baseSandbox` given: run the same `task.verification.command` in `opts.baseSandbox.dir`, same timeout handling, producing `baseExit`. `redGreen = passed && baseExit !== task.verification.expectExit`. If `opts.baseSandbox` absent: `redGreen = null`, `baseExit = null`.
6. **Coverage-of-change**, only if `task.verification.coverageCommand` given AND `passed === true` AND `task.changedLines` given and non-empty: run `coverageCommand` in `sandbox.dir` (same sandbox, after step 2 — reuses whatever build/instrumentation step 2 produced). Parse its stdout as the pinned JSON contract. For every `(path, lines)` in `task.changedLines`, check every line number appears in the report's `files[path].executedLines` (if `path` is absent from the report entirely, ALL of that path's changed lines count as uncovered). `coverageOfChange = uncoveredChangedLines.length === 0`. On any parse failure (non-JSON stdout, wrong shape): `coverageOfChange = null`, append a parse-failure note, do NOT throw. If any precondition (`passed===false`, no `coverageCommand`, no `changedLines`) isn't met: `coverageOfChange = null`, `uncoveredChangedLines = []`.
7. Compose `note` as one of a small fixed set of human-readable templates (PASS / FAIL / PASS-but-not-red-green / PASS-but-undercovered / diverged-from-claim), always including the observed vs. claimed exit codes when they diverge.
8. If `opts.log` given: `opts.log.append({ worker: opts.worker ?? task.id, harness: "n/a", turnEpoch: 0, kind: "verify.reverified", actor: "policy", payload: verdict })`.
9. Return the `Verdict`.

`accept(verdict, opts)`:
```js
function accept(verdict, opts = {}) {
  const { requireRedGreen = false, requireCoverage = false } = opts;
  if (!verdict.reverified || !verdict.passed) return false;
  if (requireRedGreen && verdict.redGreen !== true) return false;
  if (requireCoverage && verdict.coverageOfChange !== true) return false;
  return true;
}
```
`reverified` is always `true` from a real `verify()` call in this cluster (there is no dry-run mode in `referee.mjs` itself — dry-run/live gating belongs to `adapter.mjs`'s `SubprocessAdapter`; a task never reaches `verify()` at all in a fully-disabled dry-run pipeline, so `reverified` doesn't need a false branch here — document this explicitly as a deliberate simplification vs. the prototype, which conflated adapter-dry-run with referee-dry-run).

### Invariants

- **R1 (the load-bearing one).** `verify()` NEVER runs in the worker's own worktree. Enforced both structurally (callers are only ever expected to pass a `sandbox` built by `worktree.freshVerifySandbox`, which W1 guarantees is namespaced apart from `.baton/wt/`) and defensively (the `SameWorktreeError` check when the caller supplies `workerWorktreeDir`).
- **R2.** The worker's `result.verification.claimedExit` is read exactly once, only to compute `matchesClaim` — it never influences `observedExit`, `passed`, `redGreen`, or `coverageOfChange`.
- **R3.** `accept()` is the ONLY function whose return value may be used to decide "done"/mergeable. No other boolean in this cluster (not `result.status`, not `verdict.passed` alone) is sufficient by itself — `passed` alone ignores the hardening flags a caller may have required.
- **R4.** A `forgeSuccess:true` `MockAdapter` result whose actual committed code fails `task.verification.command` MUST produce `verdict.passed === false` (and therefore `accept() === false`), regardless of what `result.verification.claimedExit` claims. This is the single most important behavior in this entire cluster and gets a dedicated integration test (see #52).
- **R5.** `redGreen === false` is a real, distinct signal from `redGreen === null` — "we checked and the test *didn't* discriminate before/after" is different information from "we didn't check." Nothing in this module collapses the two.
- **R6.** A coverage parse failure never throws out of `verify()` — coverage is a *bonus* signal; its own malformedness must not crash the primary pass/fail determination.
- **R7.** `verify()` is read-only with respect to git state — it runs commands in `sandbox.dir`/`baseSandbox.dir` but never commits, merges, or mutates either sandbox's git state itself (any build artifacts the verification command produces are the sandbox's problem to clean up via `sandbox.cleanup()`, not referee's).

### Behaviors to test

47. **Basic pass**: a sandbox at a commit that genuinely passes `task.verification.command` (a trivial shell test, e.g. `test -f done.txt`), `result.verification.claimedExit` matching → `passed:true, matchesClaim:true`, `accept(verdict) === true`.
48. **Basic fail**: sandbox at a commit that fails the command, worker honestly claims failure → `passed:false, matchesClaim:true`, `accept() === false`.
49. **Divergence (worker forges a claim, but not via MockAdapter — direct construction)**: sandbox genuinely fails, `result.verification.claimedExit` set to the passing exit code → `passed:false, matchesClaim:false`, `note` mentions the divergence, `accept() === false`.
50. **`SameWorktreeError`**: call `verify()` with `task.workerWorktreeDir === sandbox.dir` → rejects with `SameWorktreeError`, and (assert via a spy) the verification command was never invoked.
51. **Timeout**: `task.verification.command` set to something that sleeps longer than `timeoutMs` → `observedExit: null`, `passed:false`, note mentions timeout, `verify()` still resolves (doesn't hang the test suite).
52. **End-to-end forge-catch (the flagship integration test)**: use `worktree.createFromBase` + `MockAdapter` with `scenario.forgeSuccess:true` and `scenario.edits` that do NOT make a real pinned check pass (e.g. the check is `node --test tests/` and the mock never actually writes a passing test fix) → `worktree.captureCommit` → `worktree.freshVerifySandbox` → `referee.verify()`. Assert the final `Verdict.passed === false` and `accept() === false`, proving the trust gate catches the lie end-to-end across all three modules.
53. **Red→green true**: `baseSandbox` at a commit where the command fails, `sandbox` (result) at a commit where it passes → `redGreen:true`.
54. **Red→green false (suspicious green-green)**: `baseSandbox` at a commit where the command ALREADY passes (nothing to fix), `sandbox` also passes → `redGreen:false` even though `passed:true`; `accept(verdict, {requireRedGreen:true}) === false`; `accept(verdict, {requireRedGreen:false}) === true`.
55. **Red→green not evaluated**: no `opts.baseSandbox` → `redGreen: null, baseExit: null`; `accept(verdict, {requireRedGreen:true})` is `false` (null ≠ true) and this is asserted explicitly so "forgot to wire red→green" fails loud when required.
56. **Coverage-of-change true**: `task.changedLines = {"src/x.js":[10,11]}`, `coverageCommand` emits JSON reporting `src/x.js` executedLines including 10 and 11 → `coverageOfChange:true`, `uncoveredChangedLines:[]`.
57. **Coverage-of-change false**: same, but executedLines is `[10]` only → `coverageOfChange:false`, `uncoveredChangedLines:["src/x.js:11"]`; `accept(verdict, {requireCoverage:true}) === false`.
58. **Coverage skipped because main check failed**: `passed:false` case, `coverageCommand` present → `coverageOfChange:null` (never even attempted — assert the coverage command was not invoked, via a sandbox where the coverage command would throw if run).
59. **Coverage parse failure doesn't crash**: `coverageCommand` outputs non-JSON garbage → `verify()` still resolves, `coverageOfChange:null`, `note` mentions a parse issue.
60. **`accept()` truth table**: parametrized test over all 8 combinations of `{passed, redGreen, coverageOfChange} × {true,false,null}` crossed with `{requireRedGreen, requireCoverage} × {true,false}` — assert against the exact logic in §4's `accept()` body (this pins the function's behavior precisely so a refactor can't silently loosen it).
61. **Log emission**: with a stub `log`, `verify()` appends exactly one `verify.reverified` event whose `payload` is deep-equal to the returned `Verdict`.
62. **`observedOutputTail` truncation**: a verification command that prints >4000 chars produces a tail of exactly the last 4000 chars, not the whole output (bounding memory/log size — ties to the "no silent truncation, but bounded" discipline from `docs/09`... document as `dropped` isn't tracked here since it's a tail-keep, not a coalesce — just assert the length bound and that it's the END of the output, not the start).

---

## 5. Cross-cluster dependency summary

```
adapter.mjs   → log (Cluster A, injected)                         [nothing else]
worktree.mjs  → log (Cluster A, injected), node:child_process, node:fs
referee.mjs   → log (Cluster A, injected), node:child_process       [does NOT import worktree.mjs or adapter.mjs — receives VerifySandbox objects as plain data from whoever built them]
```

Nothing in this cluster imports from Cluster C (the coordinator/CLI-command layer that will implement `spawn`/`send`/`wait`/`respond`/`interrupt`/`result`/`list`/`kill`). Cluster C is expected to be the glue that: picks an `Adapter` per vendor, calls `worktree.pinBaseSha`/`createFromBase` before spawning, passes `opts.signal`/`opts.log`/`opts.onAsk` into `adapter.run()`, calls `worktree.captureCommit` + `worktree.freshVerifySandbox` (and, for red→green, a second `freshVerifySandbox` at the base SHA) on completion, calls `referee.verify()` + `referee.accept()` to decide `result`/`done`, and calls `worktree.markStopped` + `worktree.reap` only after observing an interrupted `run()` promise settle. None of that orchestration logic lives in this cluster — this cluster only has to make each of those calls independently correct, testable, and honest about what it observed.

---

# CLUSTER 3 — MESSAGING, TELEMETRY & ROUTING (messages, story, router)

# Implementation Spec — Messaging, Telemetry & Routing Cluster

*Target: `impl/src/{messages,story,router}.mjs`, tested by `impl/test/{messages,story,router}.test.mjs`. Plain ESM + JSDoc, zero deps, `node:test`. Grounded in `SYSTEM.md` §4.2/4.3/5.2, `spec/communication-channel.md`, `spec/supervisor-state-machine.md`, `docs/05-telemetry-steering.md`, `docs/20-adaptive-routing.md`, `docs/21-frontier-features.md`, and the prototype (`prototype/src/types.ts`, `ledger.ts`, `orchestrator.ts`).*

---

## 0. Module graph (acyclic)

```
Cluster A (coordinator / log / supervisor)
   │ imports + calls
   ▼
messages.mjs   story.mjs   router.mjs      ← THIS cluster
   ▲               │
   └── (JSDoc-only type reference, no runtime import) ──┘
```

- **messages.mjs** — leaf module. Depends on nothing but `node:crypto` (`randomUUID`). No runtime dependency on `story.mjs` or `router.mjs`.
- **story.mjs** — consumes `LogEvent` objects that Cluster A's log/supervisor produces, by having Cluster A *call* `ingest()`/`ingestBatch()`. It does **not** `import` Cluster A's log module. It may reference `messages.mjs`'s `Brief` typedef in a JSDoc-only `@typedef {import('./messages.mjs').Brief} Brief` (erased at runtime — no import cycle).
- **router.mjs** — depends on nothing internally. Cluster A's dispatch step and trust-gate step import `AdaptiveRouter` and call `pick()` / `record()`.
- Nothing in this cluster imports Cluster A. The graph is acyclic by construction.

**Integration seam to flag to Cluster A's implementer:** `story.mjs`'s `KIND` map (§2.2) defines the literal event-kind strings it interprets (`lifecycle.spawned`, `control.interrupt_requested`, `question.asked`, …). If Cluster A's log emits different literal strings, only `KIND` needs editing — this is the one place a naming mismatch between clusters will surface as silently-ignored events, so it should be agreed before either side writes tests against fixtures.

---

## 1. `messages.mjs` — message shapes, briefs, provenance-typing

**Responsibility:** define and validate every shape that crosses the orchestrator↔worker data-plane channel (`spec/communication-channel.md`): the `Brief` (delegation contract), `nudge`, `steer`, `ask`/`answer`, `result`, and the `Digest` (the `wait` return value). Enforce provenance-typing (hub-computed fact vs. untrusted worker prose) as a structural property of the objects this module produces — not a convention callers might forget.

This module is pure data + validation. It never talks to a log, a worktree, or a subprocess. It has no notion of "current time passing" beyond stamping `ts` at construction (injectable for tests).

### 1.1 Typedefs

```js
/**
 * @typedef {Object} BriefVerification
 * @property {string} command   - exact shell command defining "done"; the SAME command
 *                                 the trust gate re-runs. There is no second notion of done.
 * @property {number} expectExit - exit code that counts as pass
 */

/**
 * @typedef {Object} BriefBudget
 * @property {number} tokens
 * @property {number} usd
 * @property {number} wallMinutes
 */

/**
 * @typedef {Object} BriefPathScope
 * @property {string[]} include - repo-relative glob patterns the worker may edit (may be empty = unscoped)
 * @property {string[]} exclude - repo-relative glob patterns forbidden even if under `include`
 */

/**
 * @typedef {Object} Brief
 * @property {string} goal
 * @property {string[]} constraints
 * @property {BriefPathScope} pathScope
 * @property {string[]} tools            - allowed tool names/categories
 * @property {string} outputFormat       - e.g. "unified diff + summary", "commit on branch"
 * @property {string} definitionOfDone
 * @property {BriefVerification} verification
 * @property {BriefBudget} budget
 * @property {string} [orientationRef]   - artifact-store handle; bulky context is NEVER inlined
 * @property {"codex-v2"|"claude"|"glm"|string} [briefTemplate]
 * @property {boolean} [planGate]        - if true, worker must send a plan before working
 */

/**
 * @typedef {Object} MessageEnvelope
 * @property {string} msgId
 * @property {string} from        - "orchestrator" | a worker id | "human"
 * @property {string} to          - a worker id | "orchestrator"
 * @property {"brief"|"nudge"|"steer"|"ask"|"answer"|"result"} kind
 * @property {string|null} inReplyTo
 * @property {number} turnEpoch   - the fence this message was composed against (I1)
 * @property {string} ts          - ISO 8601, construction time
 * @property {*} payload          - kind-specific, see below
 */

/** @typedef {Object} NudgePayload
 *  @property {string} text
 *  @property {"next_turn"|"tool_boundary"} at */

/** @typedef {Object} SteerPayload
 *  @property {string} text
 *  @property {string} [reason] */

/** @typedef {Object} AskPayload
 *  @property {string} question
 *  @property {string[]} [options]
 *  @property {boolean} blocking     - default true
 *  @property {string} [contextRef] */

/** @typedef {Object} AnswerPayload
 *  @property {string} [decision]    - one of the ask's `options`, when structured
 *  @property {string} [text]        - free-form, when unstructured
 *  - at least one of `decision`/`text` MUST be present */

/** @typedef {Object} ResultArtifacts
 *  @property {string[]} commits
 *  @property {string} [diffRef]
 *  @property {string[]} files */

/** @typedef {Object} ResultVerificationClaim
 *  @property {string} command
 *  @property {number} claimedExit
 *  @property {string} [tailRef]
 *  - CLAIM ONLY. This module never upgrades it to a fact. */

/** @typedef {Object} ResultPayload
 *  @property {"completed"|"failed"|"blocked"|"cancelled"} status
 *  @property {string} summary                       - untrusted prose; wrap with wrapProse before display
 *  @property {ResultArtifacts} artifacts
 *  @property {ResultVerificationClaim} verification  - CLAIM the hub re-runs (I7)
 *  @property {string} [blocker]
 *  @property {string[]} openQuestions
 *  @property {{tokens:number, usd:number}} budgetUsed */

/** @typedef {Object} Fact
 *  @property {string} worker
 *  @property {string} kind
 *  @property {Object} [data]
 *  @property {"hub-computed"} provenance
 *  @property {false} untrusted */

/** @typedef {Object} ProseItem
 *  @property {string} worker
 *  @property {string} text
 *  @property {"model-authored"} provenance
 *  @property {true} untrusted */

/** @typedef {Object} AttentionItem
 *  @property {"question"|"approval"|"budget_alarm"|"blocked"|"stalled"} type
 *  @property {string} worker
 *  @property {Object} data */

/** @typedef {Object} Digest
 *  @property {string} cursor
 *  @property {boolean} more
 *  @property {AttentionItem[]} attention   - ordered first, priority lane
 *  @property {Fact[]} facts                - hub-computed, trusted
 *  @property {ProseItem[]} prose           - opt-in, always untrusted */
```

### 1.2 Public API

```js
export class ValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {}
  /** @type {string[]} */ errors;
}

export const MESSAGE_KINDS = Object.freeze(['brief', 'nudge', 'steer', 'ask', 'answer', 'result']);
export const ATTENTION_TYPES = Object.freeze(['question', 'approval', 'budget_alarm', 'blocked', 'stalled']);

/**
 * Build and structurally validate a Brief. Throws on any missing/malformed required field.
 * Deep-frozen on return.
 * @param {Partial<Brief>} fields
 * @returns {Brief}
 * @throws {ValidationError}
 */
export function createBrief(fields) {}

/**
 * Non-throwing structural check, for callers that want to report errors rather than catch.
 * @param {Partial<Brief>} brief
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateBrief(brief) {}

/**
 * Low-level envelope constructor used by createNudge/createSteer/createAsk/createAnswer/createResult.
 * Exported for extensibility (a future message kind can reuse it without duplicating envelope logic).
 * @param {MessageEnvelope['kind']} kind
 * @param {{from:string, to:string, payload:Object, turnEpoch:number, inReplyTo?:string|null}} fields
 * @param {{now?: () => string, idGen?: () => string}} [opts]
 * @returns {MessageEnvelope}
 * @throws {ValidationError} if kind is not in MESSAGE_KINDS, or turnEpoch is not a finite number
 */
export function createMessage(kind, fields, opts) {}

/** @param {{from:string, to:string, text:string, at?: 'next_turn'|'tool_boundary', turnEpoch:number}} fields
 *  @param {{now?, idGen?}} [opts]  @returns {MessageEnvelope} @throws {ValidationError} */
export function createNudge(fields, opts) {}

/** @param {{from:string, to:string, text:string, reason?:string, turnEpoch:number}} fields
 *  @param {{now?, idGen?}} [opts]  @returns {MessageEnvelope} @throws {ValidationError} */
export function createSteer(fields, opts) {}

/** @param {{from:string, to:string, question:string, options?:string[], blocking?:boolean, contextRef?:string, turnEpoch:number}} fields
 *  @param {{now?, idGen?}} [opts]  @returns {MessageEnvelope} @throws {ValidationError} */
export function createAsk(fields, opts) {}

/** @param {{from:string, to:string, inReplyTo:string, decision?:string, text?:string, turnEpoch:number}} fields
 *  @param {{now?, idGen?}} [opts]  @returns {MessageEnvelope} @throws {ValidationError}
 *  requires inReplyTo non-empty AND at least one of decision/text */
export function createAnswer(fields, opts) {}

/** @param {{from:string, to:string, turnEpoch:number} & ResultPayload} fields
 *  @param {{now?, idGen?}} [opts]  @returns {MessageEnvelope} @throws {ValidationError}
 *  requires: if status==='completed', verification.command and verification.claimedExit must be present */
export function createResult(fields, opts) {}

/** @param {string} worker @param {string} kind @param {Object} [data] @returns {Fact} */
export function wrapFact(worker, kind, data) {}

/** @param {string} worker @param {string} text @returns {ProseItem}
 *  Always forces provenance:'model-authored', untrusted:true — any caller-supplied
 *  `untrusted`/`provenance` field in a misuse attempt is ignored, not honored. */
export function wrapProse(worker, text) {}

/**
 * @param {{cursor:string, more:boolean, attention?:AttentionItem[], facts?:Fact[], prose?:ProseItem[]}} fields
 * @returns {Digest}
 * @throws {ValidationError} if any `facts` entry lacks provenance:'hub-computed'/untrusted:false,
 *   or any `prose` entry lacks provenance:'model-authored'/untrusted:true
 */
export function createDigest(fields) {}

/** @param {*} x @returns {x is Fact} */
export function isFact(x) {}
/** @param {*} x @returns {x is ProseItem} */
export function isProse(x) {}

/**
 * Pure staleness check (comms-channel echo of supervisor I1). Does not consult any store.
 * @param {MessageEnvelope} message
 * @param {number} currentTurnEpoch
 * @returns {boolean} true iff message.turnEpoch < currentTurnEpoch
 * @throws {ValidationError} if message.turnEpoch is not a finite number
 */
export function isStale(message, currentTurnEpoch) {}
```

### 1.3 Invariants

1. Every constructed `MessageEnvelope` carries a `turnEpoch`; `isStale()` is the only sanctioned staleness check and is a pure function with no hidden state.
2. A `Brief`'s `verification.command` is the one and only command that ever defines "done" — no field anywhere lets a worker or a later message override it with a competing notion.
3. A `result` message's `verification` block is always a **claim**. Nothing in this module ever upgrades it to a fact — only Cluster A's trust gate, external to this cluster, may do that.
4. Every `Digest.facts[]` entry has `provenance:'hub-computed', untrusted:false`; every `Digest.prose[]` entry has `provenance:'model-authored', untrusted:true`. `createDigest` refuses to assemble a digest that violates this, even if the caller hand-built a malformed item.
5. All `create*` functions are pure given fixed `opts.now`/`opts.idGen` — no `Math.random()`, no ambient global time reads unless injected.
6. Returned objects are deeply frozen; mutation attempts throw `TypeError` (module runs under ES module strict mode).

### 1.4 Behaviors to test

1. `createBrief` with all required fields returns a frozen `Brief` containing exactly the given fields.
2. `createBrief` missing `verification.command` throws `ValidationError` whose `.errors` names that field.
3. `createBrief` with a `pathScope.include` entry starting with `/` (absolute path) throws — paths must be repo-relative.
4. `createBrief` with empty `pathScope.include` and empty `exclude` is accepted (explicitly unscoped).
5. `validateBrief` returns `{ok:false, errors:[...]}` without throwing, for programmatic checks.
6. `createNudge` defaults `at` to `'next_turn'` when omitted; rejects any other `at` value.
7. `createAsk` defaults `blocking` to `true` when omitted.
8. `createAnswer` throws when `inReplyTo` is empty/missing.
9. `createAnswer` throws when neither `decision` nor `text` is present.
10. `createResult` with `status:'completed'` and no `verification` block throws.
11. `createResult`'s returned payload has no `verified`/`trusted` boolean field anywhere — the shape itself cannot imply trust (guards against a later refactor accidentally laundering the claim into a fact).
12. `wrapFact` always sets `provenance:'hub-computed', untrusted:false` regardless of extra fields passed.
13. `wrapProse` always sets `provenance:'model-authored', untrusted:true`, even if the caller passes `untrusted:false` in an attempt to override it.
14. `createDigest` throws if a `facts[]` entry is missing/wrong provenance markers (defense in depth beyond `wrapFact`).
15. `createDigest` throws if a `prose[]` entry is missing/wrong provenance markers.
16. `createDigest` with only `attention` populated (empty `facts`/`prose`) is valid.
17. `isStale(msg, epoch)` returns `true` iff `msg.turnEpoch < epoch`; equal epoch returns `false`.
18. `isStale` throws `ValidationError` on a message with a non-numeric `turnEpoch`.
19. Two `createX()` calls with no injected `idGen` produce different `msgId`s; with a fixed injected `idGen`, `msgId` is deterministic and repeatable.
20. Given fixed `opts.now`/`opts.idGen`, calling the same `create*` function twice with identical fields produces deep-equal objects (determinism).
21. Attempting `brief.budget.tokens = 1` on a returned `Brief` throws `TypeError` (frozen).

---

## 2. `story.mjs` — the story compiler

**Responsibility:** an incremental, deterministic fold over the event log into a compact per-worker/per-task `StoryState`; render a plain-language narrative on demand; compute warning signals (stalled, looping, over-budget, out-of-scope). No LLM. Read-only with respect to the log — it never emits, mutates, or re-orders events.

### 2.1 Typedefs

```js
/**
 * @typedef {Object} LogEvent   - the shape Cluster A's log/supervisor is expected to feed in.
 * @property {number} seq        - per-worker monotonic, gap-flagged
 * @property {string} ts         - ISO 8601, hub-stamped
 * @property {string} worker
 * @property {string} harness
 * @property {number} turnEpoch
 * @property {string} kind       - see KIND, §2.2
 * @property {"worker"|"orchestrator"|"human"|"policy"} actor
 * @property {boolean} [emulated]
 * @property {Object} payload
 */

/**
 * @typedef {"idle"|"working"|"stopping"|"blocked"|"input_required"|"orphaned"|"exited"} WorkerStatus
 * Mirrors spec/supervisor-state-machine.md §2 exactly:
 *   (none) -spawn-> idle -turn_started-> working -interrupt_requested-> stopping
 *   -interrupt_confirmed-> idle; working -approval.requested-> blocked -approval.resolved-> working;
 *   working -question.asked-> input_required -question.answered-> working;
 *   any -lifecycle.exited|crashed-> exited; any -lease expiry-> orphaned.
 */

/**
 * @typedef {Object} WorkerStory
 * @property {string} workerId
 * @property {string} harness
 * @property {WorkerStatus} status
 * @property {string|null} taskId
 * @property {Brief|null} brief          - captured from lifecycle.spawned payload, if present
 * @property {number} turnEpoch
 * @property {number} turnCount
 * @property {number} lastEventSeq
 * @property {string} lastEventTs
 * @property {string|null} turnStartedAtTs
 * @property {boolean} sawGap
 * @property {{tokens:number, usd:number}} budgetUsed
 * @property {Set<number>} budgetThresholdsFired   - which of [0.5,0.8,1.0] already fired
 * @property {string[]} recentActionSignatures      - rolling window, reset on turn_started
 * @property {Set<string>} editedPaths
 * @property {Set<string>} outOfScopePaths
 * @property {{msgId:string, question:string}[]} questionsPending
 * @property {{id:string, kind:string}[]} approvalsPending
 * @property {Set<string>} warnings                 - current active warning types
 * @property {number} spawnedAtSeq                   - for stable narrative ordering
 */

/** @typedef {Object} StoryState
 *  @property {Map<string, WorkerStory>} workers */

/** @typedef {Object} Signal
 *  @property {"stalled"|"looping"|"over_budget"|"out_of_scope"|"log_gap"|"illegal_transition"|"path_scope_collision"} type
 *  @property {string} worker
 *  @property {Object} detail
 *  @property {string} since */
```

### 2.2 Public API

```js
/**
 * Canonical event-kind literals this module interprets. Cluster A's log MUST emit these
 * exact strings for the corresponding semantics, or ingest() silently no-ops the state-
 * relevant handling (unknown kinds are still bookkept — see invariant 7) — the single
 * integration point to keep in sync across clusters.
 */
export const KIND = Object.freeze({
  SPAWNED: 'lifecycle.spawned',
  TURN_STARTED: 'lifecycle.turn_started',
  TURN_COMPLETED: 'lifecycle.turn_completed',
  SESSION_COMPACTED: 'lifecycle.session_compacted',
  EXITED: 'lifecycle.exited',
  CRASHED: 'lifecycle.crashed',
  INTERRUPT_REQUESTED: 'control.interrupt_requested',
  INTERRUPT_CONFIRMED: 'control.interrupt_confirmed',
  STEER: 'control.steer',
  NUDGE: 'control.nudge',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_RESOLVED: 'approval.resolved',
  QUESTION_ASKED: 'question.asked',
  QUESTION_ANSWERED: 'question.answered',
  TOKENS: 'resource.tokens',
  FILE_EDIT: 'action.file_edit',
  COMMAND_EXEC: 'action.command_exec',
  ERROR: 'error',
});

export const DEFAULT_STALL_MS = 120_000;
export const DEFAULT_LOOP_REPEAT_THRESHOLD = 3;
export const BUDGET_THRESHOLDS = Object.freeze([0.5, 0.8, 1.0]);
export const MAX_ACTION_SIGNATURE_WINDOW = 10;

/** @returns {StoryState} a fresh, empty state */
export function initialState() {}

/**
 * Pure fold: apply one LogEvent to a StoryState, returning a new/updated state.
 * Idempotent: applying the same (worker, seq) twice is a no-op the second time.
 * @param {StoryState} state
 * @param {LogEvent} event
 * @returns {StoryState}
 */
export function foldEvent(state, event) {}

/**
 * Deterministic narrative string. Pure function of state (+ optional `now` for stall phrasing).
 * @param {StoryState} state
 * @param {{now?: number}} [opts]
 * @returns {string}
 */
export function renderNarrative(state, opts) {}

/**
 * @param {StoryState} state
 * @param {{now?: number, stallMs?: number, loopThreshold?: number}} [opts]
 * @returns {Signal[]}
 */
export function computeSignals(state, opts) {}

/**
 * Cross-worker collision check: two currently-working workers whose brief.pathScope.include
 * globs overlap AND both have recorded an action.file_edit within the overlapping region.
 * @param {StoryState} state
 * @returns {Signal[]}  (type: 'path_scope_collision')
 */
export function pathScopeCollisions(state) {}

export class StoryCompiler {
  /** @param {{stallMs?:number, loopThreshold?:number, now?: () => number}} [opts] */
  constructor(opts) {}
  /** @param {LogEvent} event */
  ingest(event) {}
  /** @param {LogEvent[]} events */
  ingestBatch(events) {}
  /** @param {{now?:number}} [opts] @returns {string} */
  narrative(opts) {}
  /** @param {{now?:number}} [opts] @returns {Signal[]} */
  signals(opts) {}
  /** @param {string} workerId @returns {WorkerStory|null} */
  workerState(workerId) {}
  /** @returns {Object} a plain deep-copy snapshot, not the live Map */
  snapshot() {}
  reset() {}
}
```

### 2.3 Narrative template (exact rules, for byte-level test assertions)

- If no workers: `"No workers active."`
- Header: `` `${activeCount} worker(s) active` `` where `activeCount` = workers not in `exited`; append `` `, ${doneCount} done` `` only if `doneCount > 0` (done = `exited` with no crash-derived warning).
- One line per worker, format: `` `${workerId} (${taskId ?? 'no task'}): ${statusPhrase}${warningSuffix}` ``.
  - `statusPhrase` by status: `idle` → `"idle"`; `working` → `` `working (turn ${turnCount}, ${budgetPct}% budget)` ``; `stopping` → `"stopping (interrupt pending)"`; `blocked` → `` `blocked — waiting on approval` ``; `input_required` → `` `blocked — waiting on: ${truncatedQuestion}` `` (question truncated to 60 chars + `…` if longer); `orphaned` → `"orphaned"`; `exited` → `"done"`.
  - `warningSuffix`: `""` if no active warnings; else `` ` — ${warnings.join('; ')}` `` where each warning renders as: stalled → `` `STALLED ${elapsedSec}s` ``; looping → `` `LOOPING on \`${cmd}\` (${count}x)` ``; over_budget → `` `${pct}% budget` ``; out_of_scope → `` `OUT OF SCOPE: ${path}` ``.
- Ordering: workers with any active warning first, then workers without; within each group, ascending `spawnedAtSeq` (stable, first-spawned-first).

### 2.4 Invariants

1. `foldEvent`/`ingest` is a pure/idempotent fold: replaying the same ordered, deduplicated event sequence with the same `now` always yields the same `StoryState` and narrative.
2. `story.mjs` never mutates or re-emits an event — read-only with respect to the log.
3. A worker's status only ever transitions along an edge that exists in `spec/supervisor-state-machine.md`'s diagram (§2.1); an event implying an illegal transition (e.g. `INTERRUPT_CONFIRMED` while status is `idle`) is recorded as an `illegal_transition` warning, not silently applied to move the status anyway.
4. An event with `seq <= workerStory.lastEventSeq` for that worker is treated as a duplicate/replay and dropped without side effects (protects against at-least-once redelivery).
5. A gap in `seq` (new seq > lastEventSeq + 1) sets `sawGap:true` and surfaces a `log_gap` signal; it does not block further ingestion.
6. `stalled` is never asserted for a worker in `blocked`/`input_required`/`stopping` — those states are legitimately waiting on someone else, not silently stuck.
7. Unknown event kinds never throw; they still update `lastEventSeq`/`lastEventTs` bookkeeping (forward-compatible ingestion) but touch nothing else.
8. `renderNarrative`/`computeSignals` never mutate the `StoryState` passed to them.

### 2.5 Behaviors to test

1. `SPAWNED` creates a `WorkerStory` with `status:'idle'`, capturing `brief`/`taskId` from the payload.
2. `TURN_STARTED` after `idle` sets `status:'working'`, increments `turnCount`, resets `recentActionSignatures`.
3. `INTERRUPT_REQUESTED` while `working` sets `status:'stopping'`; `INTERRUPT_CONFIRMED` after that sets `status:'idle'`. A worker that receives `INTERRUPT_REQUESTED` but never `INTERRUPT_CONFIRMED` stays `stopping` forever (I6 mirror).
4. `APPROVAL_REQUESTED` sets `status:'blocked'` and adds to `approvalsPending`; `APPROVAL_RESOLVED` clears it and reverts to `working` (only when no other approvals remain pending).
5. `QUESTION_ASKED` sets `status:'input_required'` and pushes to `questionsPending`; `QUESTION_ANSWERED` clears it and reverts to `working`.
6. Ingesting the identical event object twice (same worker+seq) leaves the snapshot unchanged after the second call.
7. `seq=1` then `seq=5` for a worker (skipping 2–4) sets `sawGap:true`; `signals()` includes a `log_gap` entry.
8. An event with `seq` less than or equal to the worker's `lastEventSeq` is dropped even if its content differs from what was previously ingested.
9. `TOKENS` events accumulate into `budgetUsed`; crossing 50/80/100% of `brief.budget.tokens` fires `over_budget` at each threshold exactly once (no duplicate firing on further events past an already-fired threshold).
10. Three consecutive `COMMAND_EXEC` events with identical `{cmd, exitCode!=0}` trigger `looping`; the same three with a passing exit code in the middle do not.
11. `TURN_STARTED` resets the loop-detection window: 2 identical failures in turn N followed by a new turn boundary followed by 1 identical failure in turn N+1 does not trigger `looping`.
12. Given `brief.pathScope = {include:['src/auth/**'], exclude:[]}`, a `FILE_EDIT` at `src/payments/x.js` produces `out_of_scope`; one at `src/auth/login.js` does not.
13. `signals({now})` called with `now` far past `lastEventTs + stallMs` for a `working` worker produces `stalled`; the same worker in `blocked`/`input_required` does not.
14. `pathScopeCollisions()` returns an entry when two `working` workers' `pathScope.include` globs overlap and both have a recorded `FILE_EDIT` inside the overlap.
15. `narrative()` is a pure function of state: called twice with no new ingests between, returns byte-identical strings.
16. `narrative()` orders workers-with-warnings before workers-without, and is stable (`spawnedAtSeq` ascending) within each group.
17. `reset()` returns the compiler to `initialState()`.
18. An unrecognized `kind` does not throw and updates only `lastEventSeq`/`lastEventTs`.
19. `EXITED`/`CRASHED` sets `status:'exited'` from any prior state (including mid-turn).

---

## 3. `router.mjs` — adaptive, recency-biased routing

**Responsibility:** implement `docs/20-adaptive-routing.md`. Track decayed success rate + decayed evidence count per `(modelVersion, taskType)`; `pick(task, candidates)` returns the highest-scoring eligible candidate (recent-success + exploration bonus), respecting concurrency; `record(...)` updates a bucket with recency weighting, learning **only** from caller-asserted `verifiedWin`; a new `modelVersion` seeds from a discounted predecessor in the same `family`. Off by default (round-robin) until enough history accumulates.

### 3.1 Concrete algorithm (so tests can assert exact numbers)

Each bucket keyed by `${family}::${modelVersion}::${taskType}` stores, as of `lastUsedTs`:

```
RouteStat = { modelVersion, taskType, family, weight, count, lastUsedTs, firstSeenTs, seededFrom }
```

- **Decay** (pure, read-time projection — never mutates storage on read):
  `decayFactor(nowMs, lastUsedTs, halfLifeMs) = 2 ** (-(nowMs - lastUsedTs) / halfLifeMs)`
  `decayedStat(stat, nowMs, halfLifeMs) = { weight: stat.weight * decayFactor(...), count: stat.count * decayFactor(...) }`
  (a bucket with no `lastUsedTs` — i.e. it doesn't exist — has no decayed values; see seeding.)

- **Recording** (mutates storage): at time `t`, first compute `decayedStat(existing, t, halfLifeMs)`, then:
  `weight' = decayed.weight + (verifiedWin ? 1 : 0)`, `count' = decayed.count + 1`, `lastUsedTs' = t`.

- **Score for candidate at time t**:
  `{weight, count} = decayedStat(bucketOrVirtualSeed, t, halfLifeMs)`
  `rate = count > 0 ? weight / count : defaultPriorSuccessRate`
  `bonus = explorationConstant * sqrt(ln(totalDecayedCountAcrossEligible + 1) / (count + epsilon))`
  `score = rate + bonus`

- **Seeding**: when a `(family, modelVersion, taskType)` bucket does not exist and is first touched by `pick()` or `record()`, look up the bucket for the same `family`+`taskType` with the most recent `lastUsedTs` among all *other* `modelVersion`s (the "predecessor"). If found: seed `weight = predecessorDecayed.weight * seedDiscount`, `count = predecessorDecayed.count * seedDiscount`, `lastUsedTs = t`, `seededFrom = predecessor.modelVersion`. If no predecessor exists in that family+taskType: bucket starts `{weight:0, count:0, seededFrom:null}` and scoring falls back to `defaultPriorSuccessRate`. Seeding never mutates the predecessor. Re-seeding an already-seeded (or already-recorded) bucket is a no-op — seeding only happens on first touch.

- **Defaults**: `DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000`, `DEFAULT_EXPLORATION_CONSTANT = 0.5`, `DEFAULT_SEED_DISCOUNT = 0.5`, `DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE = 5`, `DEFAULT_PRIOR_SUCCESS_RATE = 0.5`, `EPSILON = 1e-6`.

### 3.2 Typedefs

```js
/**
 * @typedef {Object} RouteCandidate
 * @property {string} modelVersion   - e.g. "codex-2025-11"
 * @property {string} family         - vendor/family grouping used for prior-seeding, e.g. "codex"
 * @property {number} concurrencyCeiling
 * @property {number} inFlight       - caller-supplied current running count
 */

/** @typedef {Object} RouteStat
 *  @property {string} modelVersion @property {string} taskType @property {string} family
 *  @property {number} weight @property {number} count
 *  @property {number} lastUsedTs @property {number} firstSeenTs
 *  @property {string|null} seededFrom */
```

### 3.3 Public API

```js
export class RouterUsageError extends Error {}

export const DEFAULT_HALF_LIFE_MS = 604_800_000;
export const DEFAULT_EXPLORATION_CONSTANT = 0.5;
export const DEFAULT_SEED_DISCOUNT = 0.5;
export const DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE = 5;
export const DEFAULT_PRIOR_SUCCESS_RATE = 0.5;

/** Pure. @param {{weight:number,count:number,lastUsedTs:number}|null} stat
 *  @param {number} nowMs @param {number} halfLifeMs
 *  @returns {{weight:number, count:number}} */
export function decayedStat(stat, nowMs, halfLifeMs) {}

/** Pure. @param {{weight:number,count:number}} decayed @param {number} totalDecayedCount
 *  @param {{explorationConstant?:number, defaultPriorSuccessRate?:number}} [opts]
 *  @returns {number} */
export function scoreCandidate(decayed, totalDecayedCount, opts) {}

export class AdaptiveRouter {
  /**
   * @param {{mode?:'round-robin'|'adaptive'|'auto', halfLifeMs?:number,
   *   explorationConstant?:number, seedDiscount?:number, minSamplesForAdaptive?:number,
   *   defaultPriorSuccessRate?:number, now?: () => number}} [opts]
   */
  constructor(opts) {}

  /**
   * @param {{taskType:string}} task
   * @param {RouteCandidate[]} candidates
   * @param {{now?:number}} [opts]
   * @returns {string|null} chosen modelVersion, or null if no candidate is eligible
   */
  pick(task, candidates, opts) {}

  /**
   * @param {string} modelVersion @param {string} taskType @param {boolean} verifiedWin
   *   MUST be computed by the caller from a re-verified trust-gate result — never from a
   *   worker's self-report. This module has no code path that reads worker-claimed status.
   * @param {{family?:string, taskId?:string, now?:number}} [opts]
   *   `taskId`, when given, makes the call idempotent: a second record() with the same
   *   taskId is a no-op (crash-recovery replay safety).
   * @returns {{applied:boolean}}
   * @throws {RouterUsageError} if verifiedWin is not strictly boolean
   */
  record(modelVersion, taskType, verifiedWin, opts) {}

  /** @param {string} modelVersion @param {string} taskType @returns {RouteStat|null} */
  getStat(modelVersion, taskType) {}

  /** @returns {Object} plain deep-copy snapshot */
  snapshot() {}
}
```

### 3.4 Invariants

1. `record()` learns only from the boolean the caller explicitly passes as `verifiedWin` — there is no parameter or code path deriving it from a worker's self-reported result.
2. Decay is monotonic-non-increasing between records: mere elapsed time only ever shrinks or holds a bucket's decay-projected `weight`/`count`; only an explicit `record()` call can increase them.
3. `pick()` never silently drops a candidate for scoring reasons; it excludes a candidate from selection only for the observable, stated reason of being at its `concurrencyCeiling`.
4. Seeding reads a predecessor bucket but never mutates it; seeding is idempotent — re-touching an already-seeded bucket does not re-discount it again.
5. `record()` with a repeated `taskId` applies at most once; `snapshot()` after the 2nd identical call equals `snapshot()` after the 1st.
6. No `Math.random()` anywhere; tie-breaking among equal scores is deterministic (first candidate in the input array wins). The only non-determinism is real wall-clock time, overridable via injected `now`.
7. `pick()` in `mode:'auto'` behaves as round-robin while total decayed evidence for that `taskType` is below `minSamplesForAdaptive`, and switches to adaptive scoring once at/above it — this is the "off by default until there's history" rule made mechanical.

### 3.5 Behaviors to test

1. `mode:'round-robin'` cycles through eligible candidates in given order, wrapping, independently per `taskType`.
2. Candidates with `inFlight >= concurrencyCeiling` are filtered before selection; if exactly one candidate remains eligible, it's returned regardless of mode.
3. `pick()` returns `null` for an empty candidates array or when all candidates are at ceiling.
4. `mode:'auto'` stays round-robin while `totalDecayedCount < minSamplesForAdaptive`, then switches to score-based selection once enough verified records exist.
5. `record(..., true)` increases decayed weight and count; `record(..., false)` increases count only (rate falls).
6. `record()` decays the existing bucket by elapsed time before adding the new observation — verified against a hand-computed half-life example.
7. A bucket recorded once at `t=0` and queried later via `pick()`/`getStat` at `t=10*halfLifeMs` shows continued decay toward the prior, purely from elapsed time (decay applies at read-time, not only on write).
8. A brand-new `modelVersion` in a family/taskType with prior history seeds at `seedDiscount * predecessor's decayed weight/count` — neither zero nor the full predecessor value.
9. A `modelVersion` in a different `family` never seeds from another family's bucket, even with an identical `taskType`.
10. Given two candidates with equal decayed success rate but very different decayed counts, `pick()` in adaptive mode prefers the lower-count (higher exploration-bonus) one.
11. `record(...)` throws `RouterUsageError` when `verifiedWin` is not strictly `true`/`false` (e.g. a truthy string) — forces callers to be explicit.
12. Two `record()` calls with the same `taskId` apply the update once; `snapshot()` is identical after the 2nd call as after the 1st.
13. `record()` calls without `taskId` are never deduped — every call applies (documented at-least-once tradeoff).
14. `getStat()` for a never-recorded, never-seeded bucket returns `null`, not a zeroed object.
15. `snapshot()` returns a deep copy; mutating it does not affect router state.
16. `decayedStat()`/`scoreCandidate()` are independently unit-testable without an `AdaptiveRouter` instance, including one hand-computed example verifying exactly one half-life halves the weight.
17. Two `AdaptiveRouter` instances fed the identical sequence of `record()`/`pick()` calls with the same injected `now` values produce identical snapshots.

---

## 4. Cross-cutting notes for the implementer / test author

- **File layout**: `impl/src/messages.mjs`, `impl/src/story.mjs`, `impl/src/router.mjs`; tests `impl/test/messages.test.mjs`, `impl/test/story.test.mjs`, `impl/test/router.test.mjs`, run via `node --test impl/test/`.
- **Determinism discipline**: every function that would otherwise read the wall clock or generate randomness (`Date.now()`, `crypto.randomUUID()`) accepts an injectable override (`now`, `idGen`) so `node:test` runs are fully reproducible with no timers, no sleeps, and no flaky stall/decay assertions.
- **The one shared data contract with Cluster A**: `messages.mjs`'s `Brief` is what `spawn()` accepts and what Cluster A must place in a `lifecycle.spawned` event's `payload.brief` — that's how `story.mjs` learns a worker's budget and path scope without importing anything from Cluster A. If Cluster A's `spawn()` shape diverges from `Brief`, `story.mjs`'s budget/scope-drift signals silently see `null` and skip those checks (per invariant 2.4.7) rather than crash — call this out to whoever implements Cluster A's dispatch step so the contract is honored, not accidentally degraded.
- **The one naming seam**: `story.mjs`'s `KIND` map (§2.2) is the single place literal event-kind strings live; agree these strings with Cluster A's log/supervisor implementer before writing fixtures, or tests on both sides will pass in isolation while integration silently drops events.
