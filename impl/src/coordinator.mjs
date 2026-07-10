// coordinator.mjs — the main loop and the 8 commands (spawn/send/wait/respond/interrupt/
// result/list/kill). Owns the worker pool, dispatches ready tasks, carries commands
// reliably (fence-checked), enforces two-phase stop, single-consumer approvals, and the
// trust gate. See spec/IMPLEMENTATION.md (CLUSTER 1 — CORE) and spec/RECONCILIATION.md
// (D1/D9/D10/D11), which is authoritative over any conflicting cluster spec.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cursor } from './log.mjs';

// ---------------------------------------------------------------------------
// Error taxonomy (thrown, not returned) — programmer-error / precondition failures.
// ---------------------------------------------------------------------------

export class WorkerNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkerNotFoundError';
  }
}

export class DuplicateTaskIdError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuplicateTaskIdError';
  }
}

export class UnknownVendorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnknownVendorError';
  }
}

export class DependencyCycleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DependencyCycleError';
  }
}

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed']);

function minimalBrief() {
  return { goal: '', constraints: [], pathScope: [], definitionOfDone: '', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 0, usd: 0, wallMin: 0 } };
}

function noop() {}

export class Coordinator {
  /** @param {object} opts */
  constructor(opts) {
    this._log = opts.log;
    this._fences = opts.fences;
    this._adapters = opts.adapters;
    this._worktrees = opts.worktrees;
    this._referee = opts.referee;
    this._route = opts.route;
    this._story = opts.story ?? null;
    this._now = opts.now || Date.now;
    this._approvalTimeoutMs = opts.approvalTimeoutMs ?? 60000;
    this._stopDeadlineMs = opts.stopDeadlineMs ?? 15000;
    this._waitPollMs = opts.waitPollMs ?? 25;

    // D8: feed the optional story sink — wrap log.append so every logged event also reaches
    // the story compiler. No-op when no story sink is provided (coordinator.test passes none).
    if (this._story && typeof this._story.record === 'function') {
      const rawAppend = this._log.append.bind(this._log);
      this._log.append = (partial) => {
        const e = rawAppend(partial);
        try { this._story.record(e); } catch { /* a broken story sink never affects correctness */ }
        return e;
      };
    }

    /** @type {Map<string, object>} taskId -> DriverTask */
    this._tasks = new Map();
    /** @type {string[]} creation order, for FIFO dispatch */
    this._taskOrder = [];
    /** @type {Map<string, object>} workerId -> WorkerHandle (internal) */
    this._workers = new Map();
    /** @type {Map<string, object>} requestId -> pending question/approval record */
    this._pending = new Map();
    /** @type {Map<string, object>} workerId -> stop-waiter bookkeeping */
    this._stopWaiters = new Map();
    /** @type {Map<string, Cursor>} */
    this._cursors = new Map();
    /** @type {Map<string, number>} workerId -> highest seq served but not yet acked */
    this._pendingAck = new Map();

    this._workerSeq = 0;
    this._taskSeq = 0;

    for (const adapter of Object.values(this._adapters)) {
      adapter.onEvent((e) => this._handleEvent(e));
    }

    // D10: reconcile first, then rebuild all state purely from the log.
    if (this._worktrees && typeof this._worktrees.reconcile === 'function') {
      Promise.resolve(this._worktrees.reconcile()).catch(noop);
    }
    this._replay();
  }

  // =========================================================================
  // tick() — dispatch + deadline sweep. Called implicitly by every public command.
  // =========================================================================

  tick() {
    this._sweepDeadlines();
    this._dispatchPass();
  }

  _dispatchPass() {
    for (const taskId of this._taskOrder) {
      const task = this._tasks.get(taskId);
      if (!task || task.status !== 'pending') continue;
      if (task.deps.some((d) => this._tasks.get(d)?.status !== 'completed')) continue;
      const vendor = this._resolveVendor(task);
      if (!vendor || !this._adapters[vendor]) continue;
      const card = this._adapters[vendor].card();
      if (this._inFlightCount(vendor) >= card.concurrencyCeiling) continue;
      this._dispatch(task, vendor);
    }
  }

  _sweepDeadlines() {
    const now = this._now();
    for (const [requestId, record] of [...this._pending]) {
      if (record.kind === 'approval' && record.state === 'pending' && record.deadlineAt != null && now >= record.deadlineAt) {
        this._resolveRecord(requestId, { decision: 'deny' }, 'policy').catch(noop);
      }
    }
    for (const [workerId, waiter] of [...this._stopWaiters]) {
      if (!waiter.finalized && waiter.deadlineAt != null && now >= waiter.deadlineAt) {
        this._forceStop(workerId, waiter);
      }
    }
  }

  _resolveVendor(task) {
    if (task.vendorRequested !== 'auto') return task.vendorRequested;
    const cards = {};
    for (const [name, ad] of Object.entries(this._adapters)) cards[name] = ad.card();
    const inFlight = {};
    for (const name of Object.keys(this._adapters)) inFlight[name] = this._inFlightCount(name);
    const chosen = this._route(task, cards, inFlight);
    if (!chosen || !this._adapters[chosen]) return null;
    return chosen;
  }

  _inFlightCount(vendor) {
    let n = 0;
    for (const h of this._workers.values()) {
      if (h.vendor === vendor && (h.status === 'working' || h.status === 'stopping' || h.status === 'blocked')) n++;
    }
    return n;
  }

  _harnessOf(vendor) {
    const card = this._adapters[vendor]?.card();
    return card ? `${card.harness}@${card.version}` : '';
  }

  _dispatch(task, vendor) {
    const handle = this._workers.get(task.assignee);
    const workerId = handle.id;
    this._fences.register(workerId);
    handle.vendor = vendor;
    const harness = this._harnessOf(vendor);

    // Create the worktree; the returned readiness promise is handed to the adapter so the
    // worker waits for its checkout to exist before touching disk. Status still flips to
    // 'working' and the adapter is invoked synchronously below (so a bare tick() dispatches
    // in one turn), while the worker's actual work is gated on the worktree being ready.
    const worktreeReady = Promise.resolve(this._worktrees.create(task.id))
      .then((res) => {
        if (res && res.path) { task.worktree = res.path; handle.worktree = res.path; }
        return res;
      })
      .catch(() => null);

    const spawnTurnEpoch = this._fences.current(workerId).turnEpoch;
    this._log.append({ worker: workerId, harness, turnEpoch: spawnTurnEpoch, kind: 'lifecycle.spawned', actor: 'orchestrator', payload: { taskId: task.id, brief: task.brief } });

    const stamp = this._fences.bumpTurn(workerId);

    const wallMin = task.brief && task.brief.budget && task.brief.budget.wallMin;
    Promise.resolve(this._adapters[vendor].spawn(workerId, task.brief, {
      worktreeReady,
      timeoutMs: wallMin ? wallMin * 60000 : undefined,
    })).catch(noop);

    this._log.append({ worker: workerId, harness, turnEpoch: stamp.turnEpoch, kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: {} });

    task.status = 'working';
    handle.status = 'working';
  }

  // =========================================================================
  // Command: spawn()
  // =========================================================================

  async spawn(vendor, brief, opts = {}) {
    this.tick();

    const taskId = opts.taskId ?? this._autoTaskId();
    if (this._tasks.has(taskId)) throw new DuplicateTaskIdError(`duplicate taskId "${taskId}"`);
    if (vendor !== 'auto' && !this._adapters[vendor]) throw new UnknownVendorError(`unknown vendor "${vendor}"`);

    const deps = opts.deps ? [...opts.deps] : [];
    this._assertNoCycle(taskId, deps);

    const workerId = this._allocWorkerId();
    const task = {
      id: taskId,
      brief,
      deps,
      vendorRequested: vendor,
      status: 'pending',
      assignee: workerId,
      worktree: null,
      result: null,
      verdict: null,
      taskType: opts.taskType ?? 'general',
    };
    this._tasks.set(taskId, task);
    this._taskOrder.push(taskId);

    const handle = {
      id: workerId,
      vendor: vendor === 'auto' ? null : vendor,
      taskId,
      worktree: null,
      status: 'pending',
      pendingApprovalId: null,
      pendingQuestionId: null,
      budgetUsed: { tokens: 0, usd: 0 },
      createdAt: new Date(this._now()).toISOString(),
    };
    this._workers.set(workerId, handle);

    this.tick();

    return this._publicHandle(handle);
  }

  _autoTaskId() {
    return `task-${++this._taskSeq}`;
  }

  _allocWorkerId() {
    return `w-${++this._workerSeq}`;
  }

  _assertNoCycle(taskId, deps) {
    const graph = new Map();
    for (const [id, t] of this._tasks) graph.set(id, t.deps);
    graph.set(taskId, deps);

    const visiting = new Set();
    const visited = new Set();
    const dfs = (node) => {
      if (visited.has(node)) return false;
      if (visiting.has(node)) return true;
      visiting.add(node);
      for (const dep of graph.get(node) ?? []) {
        if (dfs(dep)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    };
    if (dfs(taskId)) throw new DependencyCycleError(`spawn() would create a dependency cycle at "${taskId}"`);
  }

  _publicHandle(handle) {
    let fence = null;
    let turnEpoch = null;
    if (handle.status !== 'pending') {
      try {
        const s = this._fences.current(handle.id);
        fence = s.fence;
        turnEpoch = s.turnEpoch;
      } catch {
        // not yet registered — leave null
      }
    }
    return {
      id: handle.id,
      vendor: handle.vendor,
      taskId: handle.taskId,
      worktree: handle.worktree,
      fence,
      turnEpoch,
      status: handle.status,
      pendingApprovalId: handle.pendingApprovalId,
      pendingQuestionId: handle.pendingQuestionId,
      budgetUsed: handle.budgetUsed,
      createdAt: handle.createdAt,
    };
  }

  _getWorker(workerId) {
    const h = this._workers.get(workerId);
    if (!h) throw new WorkerNotFoundError(`unknown worker "${workerId}"`);
    return h;
  }

  // =========================================================================
  // Command: send()
  // =========================================================================

  async send(workerId, message, mode) {
    this.tick();
    const handle = this._getWorker(workerId);
    if (handle.status === 'stopping') return { ok: false, result: 'worker_stopping' };

    const stamp = this._fences.issue(workerId);
    const harness = this._harnessOf(handle.vendor);
    const ack = await this._adapters[handle.vendor].prompt(workerId, message, mode);
    const check = this._fences.check(workerId, stamp);
    const currentTurnEpoch = this._fences.current(workerId).turnEpoch;

    if (!check.ok) {
      this._log.append({
        worker: workerId,
        harness,
        turnEpoch: currentTurnEpoch,
        kind: 'control.stale_rejected',
        actor: 'orchestrator',
        payload: { op: 'send', mode, attempted: stamp, current: check.current },
      });
      return { ok: false, result: 'stale_fence', current: check.current };
    }

    const kind = mode === 'nudge' ? 'control.nudge' : mode === 'steer' ? 'control.steer' : 'control.send';
    const ev = { worker: workerId, harness, turnEpoch: currentTurnEpoch, kind, actor: 'orchestrator', payload: { message } };
    if (ack && ack.emulated === true) ev.emulated = true;
    this._log.append(ev);
    return { ok: true, result: 'ok', emulated: ack && ack.emulated === true };
  }

  // =========================================================================
  // Command: interrupt() / kill() — two-phase stop (D9)
  // =========================================================================

  async interrupt(workerId, then, actor = 'orchestrator') {
    this.tick();
    const handle = this._getWorker(workerId);
    return this._beginStop(handle, 'interrupt', then, actor);
  }

  async kill(workerId, actor = 'orchestrator') {
    this.tick();
    const handle = this._getWorker(workerId);
    if (handle.status === 'dead') return { ok: true, result: 'already_dead' };
    return this._beginStop(handle, 'kill', undefined, actor);
  }

  _beginStop(handle, mode, then, actor) {
    const existing = this._stopWaiters.get(handle.id);
    if (existing) {
      if (mode === 'kill' && existing.mode !== 'kill') {
        existing.mode = 'kill';
        existing.ackReady = false;
        existing.confirmReceived = false;
        const harness = this._harnessOf(handle.vendor);
        this._log.append({ worker: handle.id, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'kill.requested', actor, payload: {} });
        const call = Promise.resolve(this._adapters[handle.vendor].kill(handle.id));
        this._wireAck(existing, call);
      }
      return new Promise((resolve) => existing.resolvers.push(resolve));
    }

    if (handle.status === 'blocked') {
      if (handle.pendingApprovalId) {
        this._resolveRecord(handle.pendingApprovalId, { decision: 'cancel' }, actor).catch(noop);
      } else if (handle.pendingQuestionId) {
        this._resolveRecord(handle.pendingQuestionId, { decision: 'cancel' }, actor).catch(noop);
      }
    }

    this._fences.bumpHuman(handle.id);
    handle.status = 'stopping';

    const harness = this._harnessOf(handle.vendor);
    const turnEpoch = this._safeTurnEpoch(handle);
    const reqKind = mode === 'kill' ? 'kill.requested' : 'control.interrupt_requested';
    const reqPayload = mode === 'kill' ? {} : { then: then ?? null, actor };
    this._log.append({ worker: handle.id, harness, turnEpoch, kind: reqKind, actor, payload: reqPayload });

    const waiter = {
      mode,
      workerId: handle.id,
      emulated: false,
      resolvers: [],
      deadlineAt: this._now() + this._stopDeadlineMs,
      ackReady: false,
      confirmReceived: false,
      finalized: false,
    };
    this._stopWaiters.set(handle.id, waiter);

    const call =
      mode === 'kill'
        ? Promise.resolve(this._adapters[handle.vendor].kill(handle.id))
        : Promise.resolve(this._adapters[handle.vendor].interrupt(handle.id, then));
    this._wireAck(waiter, call);

    return new Promise((resolve) => waiter.resolvers.push(resolve));
  }

  _safeTurnEpoch(handle) {
    try {
      return this._fences.current(handle.id).turnEpoch;
    } catch {
      return 0;
    }
  }

  _wireAck(waiter, call) {
    call
      .then((ack) => {
        waiter.emulated = !!(ack && ack.emulated === true);
        waiter.ackReady = true;
        if (waiter.confirmReceived) this._finalizeStop(waiter.workerId, waiter);
      })
      .catch(() => {
        waiter.ackReady = true;
        if (waiter.confirmReceived) this._finalizeStop(waiter.workerId, waiter);
      });
  }

  _onStopConfirmed(handle, confirmKind) {
    const waiter = this._stopWaiters.get(handle.id);
    if (!waiter) return;
    if (confirmKind !== waiter.mode) return; // stale/mismatched confirmation — ignore
    waiter.confirmReceived = true;
    if (waiter.ackReady) this._finalizeStop(handle.id, waiter);
  }

  _finalizeStop(workerId, waiter) {
    if (waiter.finalized) return;
    waiter.finalized = true;
    const handle = this._workers.get(workerId);
    const harness = handle ? this._harnessOf(handle.vendor) : '';
    const kind = waiter.mode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed';
    const ev = { worker: workerId, harness, turnEpoch: handle ? this._safeTurnEpoch(handle) : 0, kind, actor: 'worker', payload: {} };
    if (waiter.emulated) ev.emulated = true;
    this._log.append(ev);

    if (handle) {
      const task = this._tasks.get(handle.taskId);
      if (waiter.mode === 'kill') {
        handle.status = 'dead';
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
        if (this._worktrees && typeof this._worktrees.remove === 'function') {
          Promise.resolve(this._worktrees.remove(handle.taskId)).catch(noop);
        }
      } else {
        handle.status = 'idle';
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
      }
    }

    const result = { ok: true, result: 'confirmed', emulated: waiter.emulated === true };
    for (const resolve of waiter.resolvers) resolve(result);
    this._stopWaiters.delete(workerId);
    this._dispatchPass();
  }

  _forceStop(workerId, waiter) {
    if (waiter.finalized) return;
    waiter.finalized = true;
    const handle = this._workers.get(workerId);
    const harness = handle ? this._harnessOf(handle.vendor) : '';
    this._log.append({ worker: workerId, harness, turnEpoch: handle ? this._safeTurnEpoch(handle) : 0, kind: 'control.forced_stop', actor: 'policy', payload: {} });

    if (handle && this._adapters[handle.vendor]) {
      Promise.resolve(this._adapters[handle.vendor].kill(workerId)).catch(noop);
    }

    if (handle) {
      handle.status = 'dead';
      const task = this._tasks.get(handle.taskId);
      if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
      if (this._worktrees && typeof this._worktrees.remove === 'function') {
        Promise.resolve(this._worktrees.remove(handle.taskId)).catch(noop);
      }
    }

    const result = { ok: true, result: 'forced' };
    for (const resolve of waiter.resolvers) resolve(result);
    this._stopWaiters.delete(workerId);
  }

  // =========================================================================
  // Command: respond()
  // =========================================================================

  async respond(requestId, answer, actor = 'orchestrator') {
    this.tick();
    return this._resolveRecord(requestId, answer, actor);
  }

  async _resolveRecord(requestId, answer, actor) {
    const record = this._pending.get(requestId);
    if (!record) return { ok: false, result: 'not_found' };
    if (record.state !== 'pending') return { ok: false, result: 'already_resolved', resolution: record.resolution };

    record.state = 'resolved';
    record.consumer = actor;
    record.resolution = answer;

    const handle = this._workers.get(record.worker);

    const clearPending = () => {
      if (!handle) return;
      if (record.kind === 'question' && handle.pendingQuestionId === requestId) handle.pendingQuestionId = null;
      if (record.kind === 'approval' && handle.pendingApprovalId === requestId) handle.pendingApprovalId = null;
      if (handle.status === 'blocked') {
        handle.status = 'working';
        const task = this._tasks.get(handle.taskId);
        if (task && task.status === 'input_required') task.status = 'working';
      }
    };

    if (!handle) {
      clearPending();
      return { ok: true, result: 'applied' };
    }

    const harness = this._harnessOf(handle.vendor);
    const currentTurnEpoch = this._safeTurnEpoch(handle);
    const stale = record.turnEpochAtAsk !== currentTurnEpoch;

    if (stale) {
      this._log.append({ worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'control.stale_rejected', actor, payload: { op: 'respond', requestId } });
      clearPending();
      return { ok: true, result: 'applied', note: 'answer arrived after the asking turn ended; discarded per fencing' };
    }

    if (record.kind === 'question') {
      const ack = await this._adapters[handle.vendor].answer(handle.id, requestId, answer);
      const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'question.answered', actor, payload: { requestId, answer } };
      if (ack && ack.emulated === true) ev.emulated = true;
      this._log.append(ev);
    } else {
      const decision = answer && answer.decision;
      const ack = await this._adapters[handle.vendor].approve(handle.id, requestId, decision, answer && answer.payload);
      const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'approval.resolved', actor, payload: { requestId, decision } };
      if (ack && ack.emulated === true) ev.emulated = true;
      this._log.append(ev);
    }

    clearPending();
    return { ok: true, result: 'applied' };
  }

  // =========================================================================
  // Command: result() / list()
  // =========================================================================

  async result(workerId) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (!task) return { ready: false, status: handle.status };
    if (!TERMINAL_TASK_STATUSES.has(task.status)) return { ready: false, status: task.status };
    return { ready: true, status: task.status, verdict: task.verdict, artifacts: task.result ? task.result.artifacts : undefined };
  }

  list() {
    this.tick();
    return [...this._workers.values()].map((h) => this._publicHandle(h));
  }

  // =========================================================================
  // Command: wait()
  // =========================================================================

  async wait(timeoutMs = 25000) {
    this.tick();
    const deadline = Date.now() + timeoutMs;

    // Always yield at least one real macrotask turn so any in-flight microtask-only
    // background work (e.g. the trust gate, chained purely off resolved promises) has a
    // chance to fully settle before we snapshot the digest.
    await this._sleep(0);
    this.tick();
    let digest = this._collectDigest();

    while (digest.attention.length === 0 && digest.facts.length === 0 && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this._sleep(Math.min(this._waitPollMs, remaining));
      this.tick();
      digest = this._collectDigest();
    }

    return digest;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  _cursorStateFile(workerId) {
    return join(this._log.dir, '.cursors', `${workerId}.floor`);
  }

  _ensureCursor(workerId) {
    let cursor = this._cursors.get(workerId);
    if (cursor) return cursor;
    const stateFile = this._cursorStateFile(workerId);
    if (!existsSync(stateFile)) {
      mkdirSync(join(stateFile, '..'), { recursive: true });
      writeFileSync(stateFile, JSON.stringify({ floor: 0 }), 'utf8');
    }
    cursor = new Cursor(stateFile);
    this._cursors.set(workerId, cursor);
    return cursor;
  }

  _collectDigest() {
    const attention = [];
    const facts = [];
    const attentionKinds = {
      'question.asked': 'question',
      'approval.requested': 'approval',
      'resource.budget_threshold': 'budget_alarm',
      'health.stall_suspected': 'stall',
      'health.loop_suspected': 'loop',
    };

    for (const workerId of this._workers.keys()) {
      const cursor = this._ensureCursor(workerId);
      const pending = this._pendingAck.get(workerId);
      if (pending != null) {
        cursor.ack(pending);
        this._pendingAck.delete(workerId);
      }
      const events = cursor.next(this._log, workerId);
      if (events.length === 0) continue;
      let maxSeq = 0;
      for (const e of events) {
        if (e.seq > maxSeq) maxSeq = e.seq;
        const attType = attentionKinds[e.kind];
        if (attType) {
          attention.push({ type: attType, worker: workerId, requestId: e.payload?.requestId, payload: e.payload });
        } else {
          facts.push({ worker: workerId, kind: e.kind, seq: e.seq, ts: e.ts, payload: e.payload, provenance: 'hub-computed', untrusted: false });
        }
      }
      this._pendingAck.set(workerId, maxSeq);
    }

    return { attention, facts, prose: [], more: false };
  }

  // =========================================================================
  // Event handling — worker-originated events delivered via Adapter.onEvent(cb).
  // =========================================================================

  _handleEvent(event) {
    const { worker: workerId, kind, harness, turnEpoch, payload, actor } = event;
    const handle = this._workers.get(workerId);
    if (!handle) return;

    switch (kind) {
      case 'lifecycle.turn_completed': {
        // Adapters may wrap the WorkerResult as { result } (MockAdapter) or emit it directly
        // (coordinator.test). Normalize so the logged claim and the gate both see the WorkerResult.
        const wr = (payload && payload.result !== undefined && payload.status === undefined) ? payload.result : payload;
        this._log.append({ worker: workerId, harness, turnEpoch, kind, actor, payload: wr });
        if (handle.status !== 'stopping' && handle.status !== 'dead') {
          this._runTrustGate(handle, wr).catch(noop);
        }
        break;
      }
      case 'lifecycle.crashed':
      case 'lifecycle.exited': {
        this._log.append({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        if (handle.status !== 'dead') handle.status = 'idle';
        break;
      }
      case 'question.asked': {
        const requestId = payload?.requestId;
        this._log.append({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        this._pending.set(requestId, {
          kind: 'question',
          worker: workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: this._safeTurnEpoch(handle),
          deadlineAt: null,
        });
        if (payload?.blocking !== false) {
          handle.status = 'blocked';
          handle.pendingQuestionId = requestId;
          const task = this._tasks.get(handle.taskId);
          if (task) task.status = 'input_required';
        }
        break;
      }
      case 'approval.requested': {
        const requestId = payload?.requestId;
        this._log.append({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        this._pending.set(requestId, {
          kind: 'approval',
          worker: workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: this._safeTurnEpoch(handle),
          deadlineAt: this._now() + this._approvalTimeoutMs,
        });
        if (payload?.blocking !== false) {
          handle.status = 'blocked';
          handle.pendingApprovalId = requestId;
          const task = this._tasks.get(handle.taskId);
          if (task) task.status = 'input_required';
        }
        break;
      }
      case 'control.interrupt_confirmed':
        this._onStopConfirmed(handle, 'interrupt');
        break;
      case 'kill.confirmed':
        this._onStopConfirmed(handle, 'kill');
        break;
      default:
        this._log.append({ worker: workerId, harness, turnEpoch, kind, actor, payload });
    }
  }

  // =========================================================================
  // Trust gate (D4/§3.6)
  // =========================================================================

  async _runTrustGate(handle, workerResult) {
    const task = this._tasks.get(handle.taskId);
    if (!task) return;
    task.status = 'verifying';
    task.result = workerResult;
    const harness = this._harnessOf(handle.vendor);

    let verifyPath = null;
    try {
      const captured = await this._worktrees.capture(handle.worktree ?? task.worktree);
      const sha = captured && captured.sha;
      const created = await this._worktrees.createVerifyWorktree(task.id, sha);
      verifyPath = created && created.path;

      let verdict;
      try {
        verdict = await this._referee(task, workerResult, { pinnedVerification: task.brief.verification, sandbox: verifyPath });
      } finally {
        if (verifyPath != null) await this._worktrees.removeVerifyWorktree(verifyPath);
      }

      task.verdict = verdict;
      const accept = !!(verdict && verdict.reverified === true && verdict.observedExit === task.brief.verification.expectExit);
      this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'verify.reverified',
        actor: 'policy',
        payload: { verdict, accept },
      });
      task.status = accept ? 'completed' : 'failed';

      if (this._route && typeof this._route.record === 'function') {
        const card = this._adapters[handle.vendor]?.card();
        try {
          this._route.record(card ? `${card.harness}@${card.version}` : undefined, task.taskType ?? 'general', accept);
        } catch {
          // never let a broken router affect coordinator correctness
        }
      }
    } catch (err) {
      task.verdict = null;
      task.status = 'failed';
      this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'error',
        actor: 'policy',
        payload: { message: String((err && err.message) || err), phase: 'trust_gate' },
      });
    }

    handle.status = 'idle';
    this._dispatchPass();
  }

  // =========================================================================
  // Construction replay (D10) — rebuild ALL state purely from the log.
  // =========================================================================

  _replay() {
    const workerIds = this._log.workers();
    for (const workerId of workerIds) {
      const events = this._log.read(workerId);
      if (events.length === 0) continue;

      let taskId = null;
      let brief = null;
      let maxTurnEpoch = 1;
      let terminalStatus = 'working';
      let verdict = null;
      let lastResult = null;

      for (const e of events) {
        if (typeof e.turnEpoch === 'number' && e.turnEpoch > maxTurnEpoch) maxTurnEpoch = e.turnEpoch;
        switch (e.kind) {
          case 'lifecycle.spawned':
            taskId = e.payload?.taskId ?? taskId;
            brief = e.payload?.brief ?? brief;
            break;
          case 'lifecycle.turn_started':
            terminalStatus = 'working';
            break;
          case 'lifecycle.turn_completed':
            lastResult = e.payload;
            terminalStatus = 'verifying';
            break;
          case 'verify.reverified':
            verdict = e.payload?.verdict ?? null;
            terminalStatus = e.payload?.accept ? 'completed' : 'failed';
            break;
          case 'lifecycle.crashed':
          case 'control.forced_stop':
            terminalStatus = 'failed';
            break;
          case 'kill.confirmed':
          case 'control.interrupt_confirmed':
            terminalStatus = 'cancelled';
            break;
          case 'question.asked':
          case 'approval.requested':
            if (e.payload?.blocking !== false) terminalStatus = 'input_required';
            break;
          case 'question.answered':
          case 'approval.resolved':
            if (terminalStatus === 'input_required') terminalStatus = 'working';
            break;
          default:
            break;
        }
      }

      this._fences.register(workerId);
      while (this._fences.current(workerId).turnEpoch < maxTurnEpoch) this._fences.bumpTurn(workerId);

      if (taskId) {
        const task = this._tasks.get(taskId) ?? {
          id: taskId,
          brief: brief ?? minimalBrief(),
          deps: [],
          status: 'pending',
          assignee: workerId,
          worktree: null,
          result: null,
          verdict: null,
          taskType: 'general',
        };
        task.assignee = workerId;
        task.status = terminalStatus;
        task.result = lastResult ?? task.result;
        task.verdict = verdict ?? task.verdict;
        this._tasks.set(taskId, task);
        if (!this._taskOrder.includes(taskId)) this._taskOrder.push(taskId);
      }

      this._workers.set(workerId, {
        id: workerId,
        vendor: null,
        taskId,
        worktree: null,
        status: this._deriveWorkerStatus(terminalStatus),
        pendingApprovalId: null,
        pendingQuestionId: null,
        budgetUsed: { tokens: 0, usd: 0 },
        createdAt: new Date(0).toISOString(),
      });
    }
  }

  _deriveWorkerStatus(taskStatus) {
    switch (taskStatus) {
      case 'completed':
      case 'failed':
      case 'cancelled':
        return 'idle';
      case 'input_required':
        return 'blocked';
      default:
        return 'working';
    }
  }
}
