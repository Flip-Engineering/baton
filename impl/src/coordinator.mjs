// coordinator.mjs — the main loop and the 8 commands (spawn/send/wait/respond/interrupt/
// result/list/kill). Owns the worker pool, dispatches ready tasks, carries commands
// reliably (fence-checked), enforces two-phase stop, single-consumer approvals, and the
// trust gate. See spec/IMPLEMENTATION.md (CLUSTER 1 — CORE) and spec/RECONCILIATION.md
// (D1/D9/D10/D11), which is authoritative over any conflicting cluster spec.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cursor } from './log.mjs';
import { createBrief, createDigest, wrapFact, wrapProse } from './messages.mjs';

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

export class ModelSelectionError extends Error {
  constructor(message, code = 'model_unavailable') {
    super(message);
    this.name = 'ModelSelectionError';
    this.code = code;
  }
}

export class SessionSelectionError extends Error {
  constructor(message, code = 'session_mode_unavailable') {
    super(message);
    this.name = 'SessionSelectionError';
    this.code = code;
  }
}

export class DependencyCycleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DependencyCycleError';
  }
}

// SC13: cancellation is terminal too. No late spawn/delivery/turn continuation may revive it.
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function minimalBrief() {
  return { goal: '', constraints: [], pathScope: [], definitionOfDone: '', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 0, usd: 0, wallMin: 0 } };
}

function noop() {}

function normalizeModelPolicy(model, policy) {
  if (model !== undefined && (typeof model !== 'string' || model.length === 0)) {
    throw new ModelSelectionError('model must be a non-empty exact identifier', 'invalid_model');
  }
  if (policy == null) return null;
  if (typeof policy !== 'object' || Array.isArray(policy)) {
    throw new ModelSelectionError('modelPolicy must be an object', 'invalid_model_policy');
  }
  const normalized = {};
  for (const key of ['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies']) {
    if (policy[key] === undefined) continue;
    if (!Array.isArray(policy[key]) || policy[key].some((v) => typeof v !== 'string' || v.length === 0)) {
      throw new ModelSelectionError(`modelPolicy.${key} must be a non-empty string[]`, 'invalid_model_policy');
    }
    normalized[key] = [...policy[key]];
  }
  for (const key of ['reasoningEffort', 'serviceTier']) {
    if (policy[key] !== undefined && (typeof policy[key] !== 'string' || policy[key].length === 0)) {
      throw new ModelSelectionError(`modelPolicy.${key} must be a non-empty string`, 'invalid_model_policy');
    }
    if (policy[key] !== undefined) normalized[key] = policy[key];
  }
  if (model !== undefined && normalized.allow && !normalized.allow.includes(model)) {
    throw new ModelSelectionError(`exact model "${model}" is excluded by modelPolicy.allow`, 'model_policy_conflict');
  }
  if (model !== undefined && normalized.deny?.includes(model)) {
    throw new ModelSelectionError(`exact model "${model}" is excluded by modelPolicy.deny`, 'model_policy_conflict');
  }
  return Object.freeze(normalized);
}

function cardAcceptsExactModel(card, model, { explicit = false } = {}) {
  const selection = card?.modelSelection;
  if (!selection || selection.mode !== 'exact') return false;
  if (Array.isArray(selection.available)) return selection.available.includes(model);
  if (explicit) return true; // native wire is authoritative when discovery is unavailable
  if (selection.acceptedAliases?.includes(model)) return true;
  return (selection.acceptedPrefixes ?? []).some((prefix) => model.startsWith(prefix));
}

function resolveCardModel(card, requested, policy, { explicit = false } = {}) {
  const selection = card?.modelSelection;
  const family = selection?.family ?? null;
  if (policy?.allowFamilies && !policy.allowFamilies.includes(family)) return { ok: false, reason: 'family_not_allowed' };
  if (policy?.denyFamilies?.includes(family)) return { ok: false, reason: 'family_denied' };
  if (policy?.reasoningEffort && !selection?.reasoningEffort?.includes(policy.reasoningEffort)) {
    return { ok: false, reason: 'reasoning_effort_unsupported' };
  }
  if (policy?.serviceTier && !selection?.serviceTier?.includes(policy.serviceTier)) {
    return { ok: false, reason: 'service_tier_unsupported' };
  }

  if (requested != null) {
    return cardAcceptsExactModel(card, requested, { explicit })
      ? { ok: true, model: requested }
      : { ok: false, reason: 'model_unavailable' };
  }

  const permitted = (model) => model == null
    ? !(policy?.allow?.length)
    : (!policy?.allow || policy.allow.includes(model)) && !policy?.deny?.includes(model);
  for (const preferred of policy?.prefer ?? []) {
    if (permitted(preferred) && cardAcceptsExactModel(card, preferred, { explicit })) return { ok: true, model: preferred };
  }
  const configured = selection?.configuredDefault ?? null;
  if (permitted(configured)) return { ok: true, model: configured };
  if (Array.isArray(selection?.available)) {
    const candidate = selection.available.find(permitted);
    if (candidate !== undefined) return { ok: true, model: candidate };
  }
  return { ok: false, reason: 'model_policy_unmatched' };
}

function modelRouteKey(card, model) {
  const harness = card ? `${card.harness}@${card.version}` : 'unknown';
  return model ? `${harness}#${model}` : harness;
}

function normalizeSessionRequest(request) {
  if (request == null) return Object.freeze({ mode: 'new' });
  if (typeof request !== 'object' || Array.isArray(request)) {
    throw new SessionSelectionError('session must be an object', 'invalid_session_request');
  }
  const mode = request.mode ?? 'new';
  if (!['new', 'resume', 'fork'].includes(mode)) {
    throw new SessionSelectionError(`unknown session mode "${mode}"`, 'invalid_session_request');
  }
  if (mode !== 'new' && (typeof request.id !== 'string' || request.id.length === 0)) {
    throw new SessionSelectionError(`session.${mode} requires a non-empty id`, 'invalid_session_request');
  }
  if (request.lastTurnId !== undefined && (mode !== 'fork' || typeof request.lastTurnId !== 'string' || request.lastTurnId.length === 0)) {
    throw new SessionSelectionError('session.lastTurnId is valid only for fork and must be a non-empty string', 'invalid_session_request');
  }
  let context;
  if (request.context !== undefined) {
    if (typeof request.context !== 'object' || request.context === null || Array.isArray(request.context)) {
      throw new SessionSelectionError('session.context must be an object', 'invalid_session_request');
    }
    if (typeof request.context.worktree !== 'string' || request.context.worktree.length === 0) {
      throw new SessionSelectionError('session.context.worktree must be a non-empty path', 'invalid_session_request');
    }
    for (const key of ['repoRoot', 'baseSha', 'branch', 'ownerTaskId']) {
      if (request.context[key] !== undefined && (typeof request.context[key] !== 'string' || request.context[key].length === 0)) {
        throw new SessionSelectionError(`session.context.${key} must be a non-empty string`, 'invalid_session_request');
      }
    }
    context = Object.freeze({
      worktree: request.context.worktree,
      ...(request.context.repoRoot ? { repoRoot: request.context.repoRoot } : {}),
      ...(request.context.baseSha ? { baseSha: request.context.baseSha } : {}),
      ...(request.context.branch ? { branch: request.context.branch } : {}),
      ...(request.context.ownerTaskId ? { ownerTaskId: request.context.ownerTaskId } : {}),
    });
  }
  return Object.freeze({
    mode,
    ...(request.id ? { id: request.id } : {}),
    ...(request.lastTurnId ? { lastTurnId: request.lastTurnId } : {}),
    ...(context ? { context } : {}),
  });
}

function cardSupportsSession(card, request) {
  if (!request || request.mode === 'new') return true;
  return card?.sessions?.[request.mode] === 'native' || card?.sessions?.[request.mode] === 'emulated';
}

/** C1: the default done-gate, behavior-preserving-by-construction for every caller that
 * doesn't override it — exactly today's inline check, moved into an injectable, named
 * function. `acceptOpts.expectExit` carries the per-task expected exit code. */
function defaultAccept(verdict, acceptOpts) {
  return !!(verdict && verdict.reverified === true && verdict.observedExit === acceptOpts.expectExit);
}

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
    this._repoRoot = opts.repoRoot ?? null;
    this._now = opts.now || Date.now;
    this._approvalTimeoutMs = opts.approvalTimeoutMs ?? 60000;
    this._stopDeadlineMs = opts.stopDeadlineMs ?? 15000;
    this._recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 15000;
    this._waitPollMs = opts.waitPollMs ?? 25;
    // C1: the sole done-gate, and the driver-level policy passed to every accept() call.
    this._accept = opts.accept ?? defaultAccept;
    this._acceptOpts = opts.acceptOpts ?? {};
    // C4: injectable timer primitives for a real, unref'd stop-deadline timer.
    this._setTimeout = opts.setTimeout ?? globalThis.setTimeout;
    this._clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout;

    // D8: feed the optional story sink — wrap log.append so every logged event also reaches
    // the story compiler. Also guards the raw append itself: a write that fails because the
    // log destination was torn down out from under an in-flight background continuation
    // (e.g. a worker's scheduled completion racing external cleanup) must never crash the
    // process — matching the same "a broken sink never affects correctness" philosophy the
    // story wiring already applies, extended to the log destination itself.
    {
      const rawAppend = this._log.append.bind(this._log);
      this._appendFailures = 0;
      this._log.append = (partial) => {
        let e;
        try {
          e = rawAppend(partial);
        } catch (err) {
          // Log-is-truth means a dropped event may NOT be invisible: count every drop and warn
          // on the first. (The swallow exists for one benign race — a fire-and-forget adapter
          // continuation writing after external teardown — but a real append failure mid-run,
          // e.g. disk full, must be observable, not silent data loss.)
          this._appendFailures += 1;
          if (this._appendFailures === 1) {
            try { process.emitWarning(`baton coordinator: log.append failed and the event was dropped: ${err?.message ?? err}`); } catch { /* never throws */ }
          }
          return undefined;
        }
        if (this._story && typeof this._story.record === 'function') {
          try { this._story.record(e); } catch { /* a broken story sink never affects correctness */ }
        }
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
      const selection = this._resolveVendor(task);
      const vendor = selection?.vendor;
      if (!vendor || !this._adapters[vendor]) continue;
      const card = this._adapters[vendor].card();
      if (this._inFlightCount(vendor) >= card.concurrencyCeiling) continue;
      this._dispatch(task, vendor, selection.model);
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
    if (task.vendorRequested !== 'auto') {
      const vendor = task.vendorRequested;
      if (!cardSupportsSession(this._adapters[vendor]?.card(), task.sessionRequest)) return null;
      const resolved = resolveCardModel(this._adapters[vendor]?.card(), task.modelRequested, task.modelPolicy, { explicit: true });
      return resolved.ok ? { vendor, model: resolved.model } : null;
    }
    const cards = {};
    const resolvedModels = {};
    for (const [name, ad] of Object.entries(this._adapters)) {
      const card = ad.card();
      if (!cardSupportsSession(card, task.sessionRequest)) continue;
      const resolved = resolveCardModel(card, task.modelRequested, task.modelPolicy, { explicit: false });
      if (resolved.ok) {
        cards[name] = {
          ...card,
          modelSelection: { ...(card.modelSelection ?? {}), resolved: resolved.model ?? null },
        };
        resolvedModels[name] = resolved.model;
      }
    }
    const inFlight = {};
    for (const name of Object.keys(this._adapters)) inFlight[name] = this._inFlightCount(name);
    const chosen = this._route(task, cards, inFlight);
    if (!chosen || !this._adapters[chosen] || !Object.hasOwn(resolvedModels, chosen)) return null;
    return { vendor: chosen, model: resolvedModels[chosen] };
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

  _dispatch(task, vendor, model) {
    const handle = this._workers.get(task.assignee);
    const workerId = handle.id;
    this._fences.register(workerId);
    handle.vendor = vendor;
    handle.modelResolved = model ?? null;
    task.modelResolved = model ?? null;
    const harness = this._harnessOf(vendor);

    // Create the worktree; the returned readiness promise is handed to the adapter so the
    // worker waits for its checkout to exist before touching disk. Status still flips to
    // 'working' and the adapter is invoked synchronously below (so a bare tick() dispatches
    // in one turn), while the worker's actual work is gated on the worktree being ready.
    const worktreeSource = task.sessionRequest?.mode === 'resume'
      ? Promise.resolve({
          path: task.sessionContext.worktree,
          branch: task.sessionContext.branch,
          baseSha: task.sessionContext.baseSha,
          ownerTaskId: task.sessionContext.ownerTaskId,
        })
      : Promise.resolve(this._worktrees.create(task.id));
    const worktreeReady = worktreeSource
      .then(async (res) => {
        if (res && res.path) {
          task.worktree = res.path;
          handle.worktree = res.path;
          const sessionContext = Object.freeze({
            worktree: res.path,
            ...(this._repoRoot ? { repoRoot: this._repoRoot } : {}),
            ...(res.baseSha ? { baseSha: res.baseSha } : {}),
            ...(res.branch ? { branch: res.branch } : {}),
            ownerTaskId: res.ownerTaskId ?? task.sessionContext?.ownerTaskId ?? task.id,
          });
          task.sessionContext = sessionContext;
          handle.sessionContext = sessionContext;
          this._log.append({
            worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'worktree.ready', actor: 'orchestrator',
            payload: sessionContext,
          });
        }
        // SC12 adversarial erratum: a stop can reap before async creation finishes. Once the
        // late worktree exists, reap again while the adapter's cancelled reservation prevents
        // any child from entering it.
        if (handle.status === 'stopping' || handle.status === 'dead' || TERMINAL_TASK_STATUSES.has(task.status)) {
          if (this._worktrees && typeof this._worktrees.remove === 'function') {
            await this._removeTaskWorktree(task);
          }
        }
        return res;
      })
      .catch(() => null);

    const spawnTurnEpoch = this._fences.current(workerId).turnEpoch;
    this._log.append({
      worker: workerId, harness, turnEpoch: spawnTurnEpoch, kind: 'lifecycle.spawned', actor: 'orchestrator',
      payload: {
        taskId: task.id, brief: task.brief, vendorRequested: task.vendorRequested, vendorResolved: vendor,
        modelRequested: task.modelRequested, modelResolved: task.modelResolved, modelPolicy: task.modelPolicy,
        sessionRequest: task.sessionRequest,
        lineage: task.lineage,
      },
    });

    const stamp = this._fences.bumpTurn(workerId);

    const wallMin = task.brief && task.brief.budget && task.brief.budget.wallMin;
    // SC12: adapters receive an explicit cancellation signal in addition to their verb call.
    // Session adapters own the stronger pending-spawn reservation, while this signal makes the
    // coordinator's authority visible across the async worktree boundary.
    const spawnAbort = new AbortController();
    handle.spawnAbort = spawnAbort;
    // SC1d: the spawn Ack is consumed, not discarded — a refused spawn must fail the task
    // instead of leaving a zombie in 'working' (the G1 audit's silent failure mode).
    Promise.resolve(this._adapters[vendor].spawn(workerId, task.brief, {
      worktreeReady,
      timeoutMs: wallMin ? wallMin * 60000 : undefined,
      signal: spawnAbort.signal,
      model: task.modelResolved ?? undefined,
      reasoningEffort: task.modelPolicy?.reasoningEffort,
      serviceTier: task.modelPolicy?.serviceTier,
      session: task.sessionRequest?.mode === 'new' ? undefined : task.sessionRequest,
    })).then((ack) => {
      if (handle.spawnAbort === spawnAbort) handle.spawnAbort = null;
      if (ack && ack.ok === false) this._onSpawnRefused(handle, task, harness, ack);
    }).catch((err) => {
      if (handle.spawnAbort === spawnAbort) handle.spawnAbort = null;
      // SC15: rejection and resolved refusal are the same durable failure channel.
      this._onSpawnRefused(handle, task, harness, { ok: false, reason: String(err?.message ?? err) });
    });

    this._log.append({
      worker: workerId, harness, turnEpoch: stamp.turnEpoch, kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: {},
      modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved ?? null, modelObserved: handle.modelObserved ?? null,
    });

    task.status = 'working';
    handle.status = 'working';
  }

  /** SC1d: a refused spawn Ack may never strand its task in 'working'. `lifecycle.crashed` is
   * the honest kind — replay already folds it to 'failed' and the story compiler
   * terminal-transitions on it; payload phase:'spawn' says exactly what died and when. Skipped
   * if an adapter event already ended the worker (both paths racing is benign). */
  _onSpawnRefused(handle, task, harness, ack) {
    // SC13: a concurrent stop or earlier lifecycle terminal owns the outcome. Refusal is allowed
    // to fail only a still-live spawn; it may never clobber cancellation or duplicate a crash.
    if (TERMINAL_TASK_STATUSES.has(task.status)) return;
    if (handle.status === 'stopping' || handle.status === 'dead' || handle.status === 'idle' || handle.status === 'exited') return;
    this._log.append({
      worker: handle.id,
      harness,
      turnEpoch: this._safeTurnEpoch(handle),
      kind: 'lifecycle.crashed',
      actor: 'orchestrator',
      payload: { error: ack.reason ?? 'spawn refused', phase: 'spawn' },
    });
    handle.status = 'exited';
    task.status = 'failed';
    this._dispatchPass();
  }

  // =========================================================================
  // Command: spawn()
  // =========================================================================

  async spawn(vendor, brief, opts = {}) {
    this.tick();

    // CI1: admission is the pinning boundary. Never retain caller-owned mutable state and never
    // allow a malformed raw object to become a task merely because the caller skipped createBrief.
    const admittedBrief = createBrief(brief);
    const modelPolicy = normalizeModelPolicy(opts.model, opts.modelPolicy);
    let sessionRequest = normalizeSessionRequest(opts.session);

    const taskId = opts.taskId ?? this._autoTaskId();
    if (this._tasks.has(taskId)) throw new DuplicateTaskIdError(`duplicate taskId "${taskId}"`);
    if (vendor !== 'auto' && !this._adapters[vendor]) throw new UnknownVendorError(`unknown vendor "${vendor}"`);
    if (vendor !== 'auto' && !cardSupportsSession(this._adapters[vendor].card(), sessionRequest)) {
      throw new SessionSelectionError(`harness "${vendor}" does not support session mode "${sessionRequest.mode}"`);
    }
    if (vendor !== 'auto') {
      const resolved = resolveCardModel(this._adapters[vendor].card(), opts.model, modelPolicy, { explicit: true });
      if (!resolved.ok) {
        throw new ModelSelectionError(`harness "${vendor}" cannot honor model "${opts.model ?? '(policy)'}"`, resolved.reason);
      }
    } else if (opts.model !== undefined || modelPolicy) {
      const anyCapable = Object.values(this._adapters).some((ad) => resolveCardModel(ad.card(), opts.model, modelPolicy, { explicit: false }).ok);
      if (!anyCapable) throw new ModelSelectionError(`no harness can honor model "${opts.model ?? '(policy)'}"`, 'model_unavailable');
    }
    if (vendor === 'auto' && sessionRequest.mode !== 'new') {
      const anySessionCapable = Object.values(this._adapters).some((ad) => cardSupportsSession(ad.card(), sessionRequest));
      if (!anySessionCapable) throw new SessionSelectionError(`no harness supports session mode "${sessionRequest.mode}"`);
    }

    // PS8: conversational history is not permission to guess at filesystem state. Resume must
    // reuse a validated, explicitly-owned context (or one already observed for the same native
    // session), and must not attach while another live handle owns that session/worktree.
    if (sessionRequest.mode === 'resume') {
      const known = this._knownSessionContext(sessionRequest.id, vendor);
      if (!sessionRequest.context && known?.context) {
        sessionRequest = normalizeSessionRequest({ ...sessionRequest, context: known.context });
      }
      if (!sessionRequest.context?.ownerTaskId) {
        throw new SessionSelectionError('resume requires session.context.worktree and ownerTaskId', 'session_context_required');
      }
      if (known?.handle && ['pending', 'working', 'blocked', 'stopping', 'idle'].includes(known.handle.status)) {
        throw new SessionSelectionError(`session "${sessionRequest.id}" is already attached`, 'session_already_attached');
      }
      await this._validateSessionContext(sessionRequest.context);
    }

    const deps = opts.deps ? [...opts.deps] : [];
    this._assertNoCycle(taskId, deps);

    const workerId = this._allocWorkerId();
    const task = {
      id: taskId,
      brief: admittedBrief,
      deps,
      vendorRequested: vendor,
      modelRequested: opts.model,
      modelResolved: null,
      modelObserved: null,
      modelPolicy,
      sessionRequest,
      sessionContext: sessionRequest.mode === 'resume' ? sessionRequest.context : null,
      lineage: sessionRequest.mode === 'new' ? null : Object.freeze({
        relation: sessionRequest.mode,
        parentSessionId: sessionRequest.id,
        parentTaskId: opts.refines ?? this._knownSessionContext(sessionRequest.id, vendor)?.handle?.taskId ?? null,
      }),
      refines: opts.refines ?? null,
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
      modelRequested: opts.model ?? null,
      modelResolved: null,
      modelObserved: null,
      modelPolicy,
      sessionRequest,
      sessionContext: task.sessionContext,
      lineage: task.lineage,
      taskId,
      worktree: null,
      status: 'pending',
      pendingApprovalId: null,
      pendingQuestionId: null,
      budgetUsed: { tokens: 0, usd: 0 },
      spawnAbort: null,
      createdAt: new Date(this._now()).toISOString(),
    };
    this._workers.set(workerId, handle);

    this.tick();

    return this._publicHandle(handle);
  }

  _autoTaskId() {
    return `task-${++this._taskSeq}`;
  }

  _knownSessionContext(sessionId, vendor) {
    for (const handle of this._workers.values()) {
      if (handle.sessionRef?.id !== sessionId) continue;
      if (vendor !== 'auto' && handle.vendor !== vendor) continue;
      return { handle, context: handle.sessionContext ?? null };
    }
    return null;
  }

  async _validateSessionContext(context) {
    if (this._repoRoot && context.repoRoot && context.repoRoot !== this._repoRoot) {
      throw new SessionSelectionError('session context belongs to a different repository', 'session_context_mismatch');
    }
    if (typeof this._worktrees?.validateSessionContext === 'function') {
      const verdict = await this._worktrees.validateSessionContext(context);
      if (!verdict?.ok) {
        throw new SessionSelectionError(verdict?.reason ?? 'session worktree is not reusable', 'session_context_mismatch');
      }
      return;
    }
    if (!existsSync(context.worktree)) {
      throw new SessionSelectionError(`session worktree does not exist: ${context.worktree}`, 'session_context_missing');
    }
  }

  /** PS7: explicitly reattach a replayed native session. Recovery never trusts a stale PID;
   * authority comes only from a fresh adapter handshake that reports the expected native ID. */
  async recover(workerId, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (handle.status !== 'orphaned') return { ok: false, result: 'worker_not_orphaned' };
    if (!task || !handle.sessionRef || handle.sessionRef.persistence !== 'native') {
      return { ok: false, result: 'session_not_resumable' };
    }
    const adapter = this._adapters[handle.vendor];
    if (!adapter || !cardSupportsSession(adapter.card(), { mode: 'resume' })) {
      return { ok: false, result: 'session_not_resumable' };
    }
    const rawContext = opts.context ?? handle.sessionContext;
    const context = rawContext
      ? normalizeSessionRequest({ mode: 'resume', id: handle.sessionRef.id, context: rawContext }).context
      : null;
    if (!context) return { ok: false, result: 'session_context_required' };
    try {
      await this._validateSessionContext(context);
    } catch (err) {
      return { ok: false, result: err.code ?? 'session_context_mismatch', reason: err.message };
    }

    const timeoutMs = opts.timeoutMs ?? this._recoveryTimeoutMs;
    const admission = { events: [] };
    admission.spawned = new Promise((resolve) => { admission.resolveSpawned = resolve; });
    handle.turnAdmission = admission;
    const session = normalizeSessionRequest({ mode: 'resume', id: handle.sessionRef.id, context });
    this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'control.recovery_requested', actor: opts.actor ?? 'orchestrator',
      payload: { sessionRef: handle.sessionRef, context },
    });

    let timerHandle;
    let timedOut = false;
    const timeout = new Promise((resolve) => {
      timerHandle = this._setTimeout(() => { timedOut = true; resolve({ timeout: true }); }, timeoutMs);
      if (timerHandle && typeof timerHandle.unref === 'function') timerHandle.unref();
    });
    const attempt = Promise.resolve(adapter.spawn(workerId, task.brief, {
      worktree: context.worktree,
      timeoutMs: task.brief?.budget?.wallMin ? task.brief.budget.wallMin * 60000 : undefined,
      model: handle.modelResolved ?? undefined,
      reasoningEffort: handle.modelPolicy?.reasoningEffort,
      serviceTier: handle.modelPolicy?.serviceTier,
      session,
    })).then((ack) => ({ ack }), (error) => ({ error }));

    let outcome = await Promise.race([attempt, timeout]);
    if (outcome?.ack?.ok === true && !timedOut) {
      outcome = await Promise.race([
        admission.spawned.then((event) => ({ ack: outcome.ack, spawned: event })),
        timeout,
      ]);
    }
    if (timerHandle != null) this._clearTimeout(timerHandle);

    const expectedId = handle.sessionRef.id;
    const observedId = outcome?.spawned?.payload?.threadId ?? outcome?.spawned?.payload?.sessionId;
    const failed = outcome?.timeout
      ? { result: 'recovery_timeout', reason: `native reattachment exceeded ${timeoutMs}ms` }
      : outcome?.error
        ? { result: 'recovery_exception', reason: String(outcome.error?.message ?? outcome.error) }
        : outcome?.ack?.ok !== true
          ? { result: 'recovery_refused', reason: outcome?.ack?.reason ?? 'adapter refused recovery' }
          : observedId !== expectedId
            ? { result: 'session_identity_mismatch', reason: `expected ${expectedId}, observed ${observedId ?? '(none)'}` }
            : null;

    if (failed) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      handle.status = 'orphaned';
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.recovery_failed', actor: 'policy', payload: { ...failed, action: 'kill_untrusted_transport' },
      });
      Promise.resolve(adapter.kill(workerId)).catch(noop);
      return { ok: false, ...failed };
    }

    const stamp = this._fences.bumpTurn(workerId);
    task.status = 'working';
    task.result = null;
    task.verdict = null;
    task.sessionRequest = session;
    task.sessionContext = context;
    handle.status = 'working';
    handle.sessionRequest = session;
    handle.sessionContext = context;
    handle.turnAdmission = null;
    this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
      kind: 'control.recovery_attached', actor: 'orchestrator',
      payload: { sessionRef: handle.sessionRef, context },
    });
    this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
      kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: { recovery: true },
      modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved ?? null, modelObserved: handle.modelObserved ?? null,
    });
    for (const event of admission.events) this._handleEvent(event);
    return { ok: true, result: 'attached', handle: this._publicHandle(handle) };
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
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      modelMismatch: handle.modelMismatch ?? null,
      modelPolicy: handle.modelPolicy ?? null,
      sessionRequest: handle.sessionRequest ?? { mode: 'new' },
      sessionRef: handle.sessionRef ?? null,
      sessionContext: handle.sessionContext ?? null,
      lineage: handle.lineage ?? null,
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

  async send(workerId, message, mode, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    // SC4a: per-worker delivery serialization — deliveries reach the adapter strictly in
    // send()-call order (a slow steer emulation must never be overtaken by a fast nudge), and a
    // queued send re-evaluates its guards at slot acquisition (SC4b) because the world it
    // validated against may have changed while it waited. Ack boundedness is X3's existing
    // contract — no new timeout is introduced here. The chain never wedges: a rejected delivery
    // is absorbed on the chain while the caller still sees the rejection from its own slot.
    const slot = (handle.sendChain ?? Promise.resolve()).then(() => this._deliver(handle, message, mode, opts));
    handle.sendChain = slot.then(noop, noop);
    return slot;
  }

  async _deliver(handle, message, mode, opts) {
    const workerId = handle.id;
    const task = this._tasks.get(handle.taskId);
    // SC14: delivery-slot acquisition is the authority boundary. A queued continuation cannot
    // cross a finalized stop, and a terminal task cannot be resurrected by a surviving session.
    if (handle.status === 'stopping') return { ok: false, result: 'worker_stopping' };
    const card = this._adapters[handle.vendor]?.card();
    const reusableFollowUp = mode === 'turn'
      && handle.status === 'idle'
      && task && TERMINAL_TASK_STATUSES.has(task.status)
      && ['native', 'emulated'].includes(card?.sessions?.multiTurn);
    if (handle.status === 'idle' && !reusableFollowUp) return { ok: false, result: 'worker_not_active' };
    if (handle.status === 'dead' || handle.status === 'exited' || handle.status === 'orphaned' || handle.status === 'pending') {
      return { ok: false, result: 'worker_not_active' };
    }
    if (!task || (TERMINAL_TASK_STATUSES.has(task.status) && !reusableFollowUp)) return { ok: false, result: 'task_terminal' };

    if (reusableFollowUp) return this._deliverFollowUp(handle, task, message, opts);

    // C3: pre-check against an externally-supplied fence, BEFORE any delivery attempt —
    // re-evaluated HERE at delivery-slot acquisition, not at send() entry (SC4b).
    if (opts.expectedFence !== undefined) {
      const preCheck = this._fences.check(workerId, { fence: opts.expectedFence });
      if (!preCheck.ok) {
        const harness = this._harnessOf(handle.vendor);
        this._log.append({
          worker: workerId,
          harness,
          turnEpoch: this._fences.current(workerId).turnEpoch,
          kind: 'control.stale_rejected',
          actor: 'orchestrator',
          payload: { op: 'send', mode, attempted: opts.expectedFence, current: preCheck.current, phase: 'pre_delivery' },
        });
        return { ok: false, result: 'stale_fence', current: preCheck.current };
      }
    }

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
        payload: { op: 'send', mode, attempted: stamp, current: check.current, phase: 'post_delivery' },
      });
      // C3: delivery already happened despite the staleness — say so, loudly.
      this._log.append({
        worker: workerId,
        harness,
        turnEpoch: currentTurnEpoch,
        kind: 'control.delivery_amended',
        actor: 'policy',
        payload: { op: 'send', mode, message, deliveredDespiteStale: true, attempted: stamp, current: check.current },
      });
      return { ok: false, result: 'stale_fence', current: check.current };
    }

    if (ack && ack.ok === false) {
      return { ok: false, result: ack.reason ?? 'delivery_refused', reason: ack.reason };
    }

    const kind = mode === 'nudge' ? 'control.nudge' : mode === 'steer' ? 'control.steer' : 'control.send';
    const ev = { worker: workerId, harness, turnEpoch: currentTurnEpoch, kind, actor: 'orchestrator', payload: { message } };
    if (ack && ack.emulated === true) ev.emulated = true;
    this._log.append(ev);
    return { ok: true, result: 'ok', emulated: ack && ack.emulated === true };
  }

  async _deliverFollowUp(handle, task, message, opts) {
    const workerId = handle.id;
    if (opts.expectedFence !== undefined) {
      const preCheck = this._fences.check(workerId, { fence: opts.expectedFence });
      if (!preCheck.ok) return { ok: false, result: 'stale_fence', current: preCheck.current };
    }

    // A native adapter can emit turn_started synchronously inside prompt(), before returning its
    // Ack. Queue those events until admission commits; refusal leaves the prior terminal view.
    const admission = { events: [] };
    handle.turnAdmission = admission;
    let ack;
    try {
      ack = await this._adapters[handle.vendor].prompt(workerId, message, 'turn');
    } catch (err) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      if (admission.events.length > 0) this._rejectContradictoryAdmission(handle, admission, err);
      return { ok: false, result: 'delivery_exception', reason: String(err?.message ?? err) };
    }
    // A crash/exit is intentionally processed immediately instead of queued. It wins over an Ack
    // from the same call and can never be overwritten by reopening the prior terminal task.
    if (handle.status !== 'idle') {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      return { ok: false, result: 'worker_not_active' };
    }
    if (!ack || ack.ok !== true) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      if (admission.events.length > 0) this._rejectContradictoryAdmission(handle, admission, ack?.reason);
      return { ok: false, result: ack?.reason ?? 'delivery_refused', reason: ack?.reason };
    }

    const stamp = this._fences.bumpTurn(workerId);
    task.status = 'working';
    task.result = null;
    task.verdict = null;
    handle.status = 'working';
    handle.turnAdmission = null;
    this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
      kind: 'lifecycle.turn_started', actor: 'orchestrator',
      modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved ?? null, modelObserved: handle.modelObserved ?? null,
      payload: { followUp: true, message },
    });
    for (const event of admission.events) this._handleEvent(event);
    return { ok: true, result: 'ok', emulated: ack.emulated === true };
  }

  _rejectContradictoryAdmission(handle, admission, reason) {
    this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'control.protocol_violation', actor: 'policy',
      payload: {
        op: 'follow_up_admission', reason: String(reason ?? 'adapter refused after emitting turn events'),
        queuedKinds: admission.events.map((event) => event.kind), action: 'kill',
      },
    });
    // The old result remains authoritative, but the session is no longer safe to reuse: its wire
    // advanced despite refusing admission. Confirmed two-phase kill owns transport cleanup.
    this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
  }

  // =========================================================================
  // Command: interrupt() / kill() — two-phase stop (D9)
  // =========================================================================

  async interrupt(workerId, then, actor = 'orchestrator') {
    this.tick();
    const handle = this._getWorker(workerId);
    if (handle.status === 'dead' || handle.status === 'exited') {
      return { ok: true, result: handle.status === 'dead' ? 'already_dead' : 'already_stopped' };
    }
    if (handle.status === 'orphaned') {
      return { ok: false, result: 'session_not_attached', reason: 'restart replay found no controllable adapter session' };
    }
    return this._beginStop(handle, 'interrupt', then, actor);
  }

  async kill(workerId, actor = 'orchestrator') {
    this.tick();
    const handle = this._getWorker(workerId);
    if (handle.status === 'dead') return { ok: true, result: 'already_dead' };
    if (handle.status === 'orphaned') {
      return { ok: false, result: 'session_not_attached', reason: 'restart replay found no controllable adapter session' };
    }
    // CI3: a crashed/exited child cannot emit another kill.confirmed. Treat its authoritative
    // terminal event as the confirmation, finish cleanup now, and never arm an unfulfillable wait.
    if (handle.status === 'exited') {
      handle.status = 'dead';
      await this._removeTaskWorktree(this._tasks.get(handle.taskId));
      return { ok: true, result: 'already_dead' };
    }
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
    if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
      handle.spawnAbort.abort({ mode, actor });
    }
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
      timerHandle: null,
      then: mode === 'interrupt' ? then : undefined,
    };
    this._stopWaiters.set(handle.id, waiter);

    // C4: a real, injectable, unref'd deadline timer — independent of tick()'s sweep,
    // which remains as a redundant, harmless backup path.
    waiter.timerHandle = this._setTimeout(() => this._forceStop(handle.id, waiter), this._stopDeadlineMs);
    if (waiter.timerHandle && typeof waiter.timerHandle.unref === 'function') waiter.timerHandle.unref();

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

  async _removeTaskWorktree(task) {
    if (!task || !this._worktrees || typeof this._worktrees.remove !== 'function') return;
    const ownerTaskId = task.sessionContext?.ownerTaskId ?? task.id;
    await Promise.resolve(this._worktrees.remove(ownerTaskId)).catch(noop);
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
    if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
    const handle = this._workers.get(workerId);
    const harness = handle ? this._harnessOf(handle.vendor) : '';
    const kind = waiter.mode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed';
    const ev = {
      worker: workerId, harness, turnEpoch: handle ? this._safeTurnEpoch(handle) : 0, kind, actor: 'worker', payload: {},
      modelRequested: handle?.modelRequested ?? null, modelResolved: handle?.modelResolved ?? null, modelObserved: handle?.modelObserved ?? null,
    };
    if (waiter.emulated) ev.emulated = true;
    this._log.append(ev);

    if (handle) {
      const task = this._tasks.get(handle.taskId);
      if (waiter.mode === 'kill') {
        handle.status = 'dead';
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
        this._removeTaskWorktree(task).catch(noop);
      } else {
        if (waiter.then !== undefined) {
          const stamp = this._fences.bumpTurn(handle.id);
          handle.status = 'working';
          if (task) {
            task.status = 'working';
            task.result = null;
            task.verdict = null;
          }
          this._log.append({
            worker: workerId, harness, turnEpoch: stamp.turnEpoch, kind: 'lifecycle.turn_started', actor: 'orchestrator',
            modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved ?? null, modelObserved: handle.modelObserved ?? null,
            payload: { followUp: true, afterInterrupt: true },
          });
        } else {
          handle.status = 'idle';
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
        }
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
    if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
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
      this._removeTaskWorktree(task).catch(noop);
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
    if (record.state === 'resolving') {
      // Wait for the reserved delivery. Echo its winner if it commits; retry fairly if the
      // delivery rolls back to pending.
      await record.resolvingDone;
      if (record.state === 'resolved') {
        return { ok: false, result: 'already_resolved', resolution: record.resolution };
      }
      return this._resolveRecord(requestId, answer, actor);
    }
    if (record.state !== 'pending') return { ok: false, result: 'already_resolved', resolution: record.resolution };

    // CI2: reserve the single-consumer slot, but do not COMMIT resolution until the adapter
    // accepts delivery. A failed/throwing wire operation rolls back to pending for retry.
    record.state = 'resolving';
    let releaseResolving;
    record.resolvingDone = new Promise((resolve) => { releaseResolving = resolve; });
    const finishResolving = () => {
      releaseResolving();
      delete record.resolvingDone;
    };

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
      record.state = 'resolved';
      record.consumer = actor;
      record.resolution = answer;
      clearPending();
      finishResolving();
      return { ok: true, result: 'applied' };
    }

    const harness = this._harnessOf(handle.vendor);
    const currentTurnEpoch = this._safeTurnEpoch(handle);
    const stale = record.turnEpochAtAsk !== currentTurnEpoch;

    if (stale) {
      this._log.append({ worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'control.stale_rejected', actor, payload: { op: 'respond', requestId } });
      record.state = 'resolved';
      record.consumer = actor;
      record.resolution = answer;
      clearPending();
      finishResolving();
      return { ok: true, result: 'applied', note: 'answer arrived after the asking turn ended; discarded per fencing' };
    }

    let ack;
    try {
      if (record.kind === 'question') {
        ack = await this._adapters[handle.vendor].answer(handle.id, requestId, answer);
      } else {
        const decision = answer && answer.decision;
        ack = await this._adapters[handle.vendor].approve(handle.id, requestId, decision, answer && answer.payload);
      }
    } catch (err) {
      record.state = 'pending';
      record.consumer = null;
      record.resolution = null;
      finishResolving();
      throw err;
    }

    if (!ack || ack.ok !== true) {
      record.state = 'pending';
      record.consumer = null;
      record.resolution = null;
      finishResolving();
      return { ok: false, result: 'delivery_refused', reason: ack?.reason ?? 'adapter did not affirm response delivery' };
    }

    record.state = 'resolved';
    record.consumer = actor;
    record.resolution = answer;

    if (record.kind === 'question') {
      const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'question.answered', actor, payload: { requestId, answer } };
      if (ack && ack.emulated === true) ev.emulated = true;
      this._log.append(ev);
    } else {
      const decision = answer && answer.decision;
      const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'approval.resolved', actor, payload: { requestId, decision } };
      if (ack && ack.emulated === true) ev.emulated = true;
      this._log.append(ev);
    }

    clearPending();
    finishResolving();
    return { ok: true, result: 'applied' };
  }

  // =========================================================================
  // Command: result() / list()
  // =========================================================================

  async result(workerId) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    const attribution = {
      vendor: handle.vendor,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      modelMismatch: handle.modelMismatch ?? null,
      sessionRequest: handle.sessionRequest ?? { mode: 'new' },
      sessionRef: handle.sessionRef ?? null,
      sessionContext: handle.sessionContext ?? null,
      lineage: handle.lineage ?? null,
    };
    if (!task) return { ready: false, status: handle.status, ...attribution };
    if (!TERMINAL_TASK_STATUSES.has(task.status)) return { ready: false, status: task.status, ...attribution };
    return { ready: true, status: task.status, verdict: task.verdict, artifacts: task.result ? task.result.artifacts : undefined, ...attribution };
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
    const prose = [];
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
        } else if (e.kind === 'content.message') {
          // CI4: transport through the hub does not transmute model prose into trusted fact.
          prose.push({ ...wrapProse(workerId, e.payload?.text ?? ''), kind: e.kind, seq: e.seq, ts: e.ts, payload: e.payload });
        } else if (e.kind === 'lifecycle.turn_completed') {
          // The lifecycle observation is a hub fact; the worker's result narrative is not. Keep
          // model-written summary/blocker/questions out of the fact payload entirely.
          const result = e.payload ?? {};
          facts.push({
            ...wrapFact(workerId, e.kind, {
              status: result.status ?? null,
              artifactCount: Array.isArray(result.artifacts?.files) ? result.artifacts.files.length : null,
              hasVerificationClaim: result.verification != null,
            }),
            seq: e.seq,
            ts: e.ts,
          });
          for (const [field, value] of [
            ['summary', result.summary],
            ['blocker', result.blocker],
            ...((result.openQuestions ?? []).map((value) => ['openQuestion', value])),
          ]) {
            if (typeof value === 'string' && value.length > 0) {
              prose.push({ ...wrapProse(workerId, value), kind: 'result.prose', field, seq: e.seq, ts: e.ts });
            }
          }
        } else {
          facts.push({ ...wrapFact(workerId, e.kind, e.payload), seq: e.seq, ts: e.ts, payload: e.payload });
        }
      }
      this._pendingAck.set(workerId, maxSeq);
    }

    return createDigest({ cursor: null, attention, facts, prose, more: false });
  }

  // =========================================================================
  // Event handling — worker-originated events delivered via Adapter.onEvent(cb).
  // =========================================================================

  _handleEvent(event) {
    const { worker: workerId, kind, harness, turnEpoch, payload, actor } = event;
    const handle = this._workers.get(workerId);
    if (!handle) return;
    if (handle.turnAdmission && actor === 'worker' && !['lifecycle.crashed', 'lifecycle.exited', 'kill.confirmed'].includes(kind)) {
      handle.turnAdmission.events.push(event);
      if (kind === 'lifecycle.spawned') handle.turnAdmission.resolveSpawned?.(event);
      return;
    }

    if (actor === 'worker' && ['lifecycle.turn_completed', 'question.asked', 'approval.requested'].includes(kind)) {
      const currentEpoch = this._safeTurnEpoch(handle);
      if (handle.wireEpochOffset == null && typeof turnEpoch === 'number') handle.wireEpochOffset = currentEpoch - turnEpoch;
      const normalizedEpoch = typeof turnEpoch === 'number' ? turnEpoch + (handle.wireEpochOffset ?? 0) : currentEpoch;
      if (normalizedEpoch < currentEpoch) {
        this._log.append({
          worker: workerId, harness, turnEpoch: currentEpoch, kind: 'control.stale_rejected', actor: 'policy',
          modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved ?? null, modelObserved: handle.modelObserved ?? null,
          payload: { op: kind === 'lifecycle.turn_completed' ? 'terminal' : kind, attemptedTurnEpoch: normalizedEpoch, currentTurnEpoch: currentEpoch },
        });
        return;
      }
    }
    if (actor === 'worker' && kind === 'lifecycle.turn_started' && typeof turnEpoch === 'number') {
      const currentEpoch = this._safeTurnEpoch(handle);
      if (handle.wireEpochOffset == null) handle.wireEpochOffset = currentEpoch - turnEpoch;
    }

    if (kind === 'lifecycle.spawned' && actor === 'worker') {
      const nativeId = payload?.threadId ?? payload?.sessionId;
      if (typeof nativeId === 'string' && nativeId.length > 0) {
        handle.sessionRef = {
          vendor: handle.vendor,
          kind: payload?.threadId ? 'thread' : 'session',
          id: nativeId,
          persistence: this._adapters[handle.vendor]?.card()?.sessions?.resume === 'native' ? 'native' : 'process',
          source: 'wire',
        };
        const refTask = this._tasks.get(handle.taskId);
        if (refTask) refTask.sessionRef = handle.sessionRef;
      }
    }
    const observedModel = payload?.modelObserved ?? payload?.modelId ?? payload?.model;
    if (typeof observedModel === 'string' && observedModel.length > 0) {
      handle.modelObserved = observedModel;
      const task = this._tasks.get(handle.taskId);
      if (task) task.modelObserved = observedModel;

      const selection = this._adapters[handle.vendor]?.card()?.modelSelection;
      const requestedAlias = selection?.acceptedAliases?.includes(handle.modelResolved);
      if (handle.modelResolved && observedModel !== handle.modelResolved && !requestedAlias && !handle.modelMismatch) {
        handle.modelMismatch = { requested: handle.modelResolved, observed: observedModel };
        const mismatchTask = this._tasks.get(handle.taskId);
        if (mismatchTask) {
          mismatchTask.modelMismatch = handle.modelMismatch;
          if (!TERMINAL_TASK_STATUSES.has(mismatchTask.status)) mismatchTask.status = 'failed';
        }
        this._log.append({
          worker: workerId, harness, turnEpoch, kind: 'model.mismatch', actor: 'policy',
          modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved, modelObserved: observedModel,
          payload: { requested: handle.modelResolved, observed: observedModel, action: 'fail_and_kill' },
        });
        // Use the ordinary confirmed two-phase stop so process/worktree ownership remains live
        // until the adapter proves the mismatched session is gone.
        this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      }
    }
    const attribution = {
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
    };
    const appendAttributed = (partial) => this._log.append({ ...partial, ...attribution });

    switch (kind) {
      case 'lifecycle.turn_completed': {
        // Adapters may wrap the WorkerResult as { result } (MockAdapter) or emit it directly
        // (coordinator.test). Normalize so the logged claim and the gate both see the WorkerResult.
        const wr = (payload && payload.result !== undefined && payload.status === undefined) ? payload.result : payload;
        appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload: wr });
        if (handle.status !== 'stopping' && handle.status !== 'dead') {
          this._runTrustGate(handle, wr).catch(noop);
        }
        break;
      }
      case 'lifecycle.crashed':
      case 'lifecycle.exited': {
        appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        if (handle.status !== 'dead') handle.status = 'exited';
        break;
      }
      case 'question.asked': {
        const requestId = payload?.requestId;
        appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) break;
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
          if (task) task.status = 'input_required';
        }
        break;
      }
      case 'approval.requested': {
        const requestId = payload?.requestId;
        appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) break;
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
        appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
    }
  }

  // =========================================================================
  // Trust gate (D4/§3.6)
  // =========================================================================

  async _runTrustGate(handle, workerResult) {
    const task = this._tasks.get(handle.taskId);
    if (!task) return;
    // SC13/SC14: a late terminal event from a stopped session cannot reopen a terminal task.
    if (TERMINAL_TASK_STATUSES.has(task.status)) return;
    task.status = 'verifying';
    task.result = workerResult;
    const harness = this._harnessOf(handle.vendor);

    let verifyPath = null;
    try {
      // C5: thread the dispatching vendor through to captureCommit so the snapshot
      // commit (when one is made) is genuinely attributed.
      const captured = await this._worktrees.capture(handle.worktree ?? task.worktree, {
        vendor: handle.vendor,
        model: handle.modelObserved ?? handle.modelResolved,
      });
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
      // C1: referee.accept() (or an injected equivalent) is the SOLE done-gate.
      const acceptOpts = { ...this._acceptOpts, expectExit: task.brief.verification.expectExit };
      const accept = this._accept(verdict, acceptOpts);
      this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'verify.reverified',
        actor: 'policy',
        modelRequested: handle.modelRequested ?? null,
        modelResolved: handle.modelResolved ?? null,
        modelObserved: handle.modelObserved ?? null,
        payload: {
          verdict,
          accept,
          acceptOpts: {
            requireRedGreen: this._acceptOpts.requireRedGreen ?? false,
            requireCoverage: this._acceptOpts.requireCoverage ?? false,
          },
          capture: {
            sha: captured && captured.sha, snapshotted: captured && captured.snapshotted,
            vendor: handle.vendor ?? null, model: handle.modelObserved ?? handle.modelResolved ?? null,
          },
        },
      });
      task.status = accept ? 'completed' : 'failed';

      if (this._route && typeof this._route.record === 'function') {
        const card = this._adapters[handle.vendor]?.card();
        try {
          this._route.record(modelRouteKey(card, handle.modelObserved ?? handle.modelResolved), task.taskType ?? 'general', accept);
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
      let recoveryTerminalized = false;
      let vendorRequested = null;
      let vendorResolved = null;
      let modelRequested = null;
      let modelResolved = null;
      let modelObserved = null;
      let modelPolicy = null;
      let modelMismatch = null;
      let sessionRequest = Object.freeze({ mode: 'new' });
      let sessionRef = null;
      let sessionContext = null;
      let lineage = null;

      for (const e of events) {
        if (typeof e.turnEpoch === 'number' && e.turnEpoch > maxTurnEpoch) maxTurnEpoch = e.turnEpoch;
        modelRequested = e.modelRequested ?? modelRequested;
        modelResolved = e.modelResolved ?? modelResolved;
        modelObserved = e.modelObserved ?? modelObserved;
        if (e.kind === 'model.mismatch') modelMismatch = e.payload ?? modelMismatch;
        switch (e.kind) {
          case 'lifecycle.spawned':
            taskId = e.payload?.taskId ?? taskId;
            brief = e.payload?.brief ?? brief;
            vendorRequested = e.payload?.vendorRequested ?? vendorRequested;
            vendorResolved = e.payload?.vendorResolved ?? vendorResolved;
            modelRequested = e.payload?.modelRequested ?? modelRequested;
            modelResolved = e.payload?.modelResolved ?? modelResolved;
            modelPolicy = e.payload?.modelPolicy ?? modelPolicy;
            sessionRequest = e.payload?.sessionRequest ?? sessionRequest;
            lineage = e.payload?.lineage ?? lineage;
            modelObserved = e.payload?.modelObserved ?? e.payload?.model ?? modelObserved;
            if (e.actor === 'worker') {
              const nativeId = e.payload?.threadId ?? e.payload?.sessionId;
              if (typeof nativeId === 'string' && nativeId.length > 0) {
                sessionRef = {
                  vendor: vendorResolved,
                  kind: e.payload?.threadId ? 'thread' : 'session',
                  id: nativeId,
                  persistence: this._adapters[vendorResolved]?.card()?.sessions?.resume === 'native' ? 'native' : 'process',
                  source: 'wire',
                };
              }
            }
            break;
          case 'worktree.ready':
            sessionContext = e.payload ?? sessionContext;
            break;
          case 'control.recovery_attached':
            terminalStatus = 'working';
            lastResult = null;
            verdict = null;
            sessionContext = e.payload?.context ?? sessionContext;
            sessionRequest = sessionRef?.id
              ? { mode: 'resume', id: sessionRef.id, ...(sessionContext ? { context: sessionContext } : {}) }
              : sessionRequest;
            break;
          case 'lifecycle.turn_started':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'working';
            break;
          case 'lifecycle.turn_completed':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) {
              lastResult = e.payload;
              terminalStatus = 'verifying';
            }
            break;
          case 'verify.reverified':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) {
              verdict = e.payload?.verdict ?? null;
              terminalStatus = e.payload?.accept ? 'completed' : 'failed';
            }
            break;
          case 'lifecycle.crashed':
          case 'control.forced_stop':
          case 'control.recovery_terminalized':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'failed';
            break;
          case 'kill.confirmed':
          case 'control.interrupt_confirmed':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'cancelled';
            break;
          case 'question.asked':
          case 'approval.requested':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus) && e.payload?.blocking !== false) terminalStatus = 'input_required';
            break;
          case 'question.answered':
          case 'approval.resolved':
            if (terminalStatus === 'input_required') terminalStatus = 'working';
            break;
          default:
            modelObserved = e.payload?.modelObserved ?? e.payload?.modelId ?? e.payload?.model ?? modelObserved;
            break;
        }
      }

      // CI6: replay cannot resurrect an adapter session. Until the persistent-session phase can
      // prove native reattachment, any nonterminal reconstructed task is durably failed and its
      // worker is marked orphaned (uncontrollable), never presented as working/input_required.
      if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) {
        recoveryTerminalized = true;
        terminalStatus = 'failed';
        this._log.append({
          worker: workerId,
          harness: events.at(-1)?.harness ?? '',
          turnEpoch: maxTurnEpoch,
          kind: 'control.recovery_terminalized',
          actor: 'policy',
          payload: { reason: 'session_not_reattached', priorStatus: events.at(-1)?.kind ?? 'unknown' },
        });
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
          vendorRequested,
          modelRequested,
          modelResolved,
          modelObserved,
          modelPolicy,
          modelMismatch,
          sessionRequest,
          sessionRef,
          sessionContext,
          lineage,
        };
        task.assignee = workerId;
        task.status = terminalStatus;
        task.result = lastResult ?? task.result;
        task.verdict = verdict ?? task.verdict;
        task.sessionRequest = sessionRequest;
        task.sessionRef = sessionRef;
        task.sessionContext = sessionContext;
        task.lineage = lineage;
        task.worktree = sessionContext?.worktree ?? task.worktree;
        this._tasks.set(taskId, task);
        if (!this._taskOrder.includes(taskId)) this._taskOrder.push(taskId);
      }

      this._workers.set(workerId, {
        id: workerId,
        vendor: vendorResolved,
        modelRequested,
        modelResolved,
        modelObserved,
        modelPolicy,
        modelMismatch,
        sessionRequest,
        sessionRef,
        sessionContext,
        lineage,
        taskId,
        worktree: sessionContext?.worktree ?? null,
        // A durable native reference is not a live transport. Even a terminal task that was
        // reusable before restart must remain uncontrollable until PS7 proves reattachment.
        status: (recoveryTerminalized || sessionRef) ? 'orphaned' : this._deriveWorkerStatus(terminalStatus),
        pendingApprovalId: null,
        pendingQuestionId: null,
        budgetUsed: { tokens: 0, usd: 0 },
        spawnAbort: null,
        createdAt: new Date(0).toISOString(),
      });

      // CI6: replayed auto identifiers reserve their numeric slots. A subsequent allocation may
      // never collide with or overwrite reconstructed state.
      const workerMatch = /^w-(\d+)$/.exec(workerId);
      if (workerMatch) this._workerSeq = Math.max(this._workerSeq, Number(workerMatch[1]));
      const taskMatch = /^task-(\d+)$/.exec(taskId ?? '');
      if (taskMatch) this._taskSeq = Math.max(this._taskSeq, Number(taskMatch[1]));
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
