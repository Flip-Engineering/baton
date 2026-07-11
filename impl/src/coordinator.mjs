// coordinator.mjs — the main loop and the 8 commands (spawn/send/wait/respond/interrupt/
// result/list/kill). Owns the worker pool, dispatches ready tasks, carries commands
// reliably (fence-checked), enforces two-phase stop, single-consumer approvals, and the
// trust gate. See spec/IMPLEMENTATION.md (CLUSTER 1 — CORE) and spec/RECONCILIATION.md
// (D1/D9/D10/D11), which is authoritative over any conflicting cluster spec.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { Cursor } from './log.mjs';
import { createBrief, createDigest, wrapFact, wrapProse } from './messages.mjs';
import { resolveEffort, routeTupleKey } from './route-tuple.mjs';

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

export class IntegrationError extends Error {
  constructor(message, code = 'integration_refused') {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
  }
}

export class ReviewSelectionError extends Error {
  constructor(message, code = 'review_refused') {
    super(message);
    this.name = 'ReviewSelectionError';
    this.code = code;
  }
}

export class PublicationError extends Error {
  constructor(message, code = 'publication_refused') {
    super(message);
    this.name = 'PublicationError';
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
const COORDINATION_MUTATORS = new Set([
  'createTask', 'claimTask', 'transitionTask', 'transitionTaskWithArtifacts', 'mapOperationalEvent',
  'recordDriver', 'completeIntegration', 'completePublication', 'registerArtifact', 'supersedeArtifact', 'claimScratch', 'postScratchFact',
  'readScratch', 'expireScratchClaim', 'expireScratchFact', 'addKnowledgeNode', 'promoteKnowledgeNode',
  'addKnowledgeEdge', 'readKnowledge', 'invalidateKnowledge', 'recordContamination',
]);

function minimalBrief() {
  return { goal: '', constraints: [], pathScope: [], definitionOfDone: '', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 0, usd: 0, wallMin: 0 } };
}

function noop() {}

function globRegex(glob) {
  let re = '^';
  const text = String(glob);
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '*') {
      if (text[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (text[i + 1] === '/') i += 1;
      } else re += '[^/]*';
    } else if (char === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(char)) re += `\\${char}`;
    else re += char;
  }
  return new RegExp(`${re}$`);
}

function pathInScope(scopes, path) {
  if (!Array.isArray(scopes) || scopes.length === 0) return true;
  return scopes.some((scope) => scope === '**' || scope === '.' || scope === './' || globRegex(scope).test(path));
}

function normalizeModelPolicy(model, policy, effort) {
  if (effort !== undefined && (typeof effort !== 'string' || effort.length === 0)) throw new ModelSelectionError('effort must be a non-empty exact identifier', 'invalid_effort');
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
  if (effort !== undefined && normalized.reasoningEffort !== undefined && effort !== normalized.reasoningEffort) throw new ModelSelectionError('effort conflicts with modelPolicy.reasoningEffort', 'effort_policy_conflict');
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
    if (!opts?.coordination) throw new TypeError('Coordinator requires a durable coordination store');
    for (const method of ['snapshot', 'task', 'integrationAuthority', 'publicationAuthority', 'createTask', 'claimTask', 'transitionTask', 'transitionTaskWithArtifacts', 'mapOperationalEvent', 'recordDriver', 'completeIntegration', 'completePublication', 'registerArtifact', 'artifact', 'claimScratch', 'postScratchFact', 'readScratch', 'activeScratchClaims', 'expireScratchClaim', 'addKnowledgeNode', 'promoteKnowledgeNode', 'readKnowledge']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`Coordinator coordination store is missing ${method}()`);
    }
    this._log = opts.log;
    this._fences = opts.fences;
    this._adapters = opts.adapters;
    this._worktrees = opts.worktrees;
    this._runtimeScopes = opts.runtimeScopes ?? null;
    const rawCoordination = opts.coordination;
    this._coordination = new Proxy(rawCoordination, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        const bound = value.bind(target);
        if (!COORDINATION_MUTATORS.has(property)) return bound;
        return (...args) => {
          try { return bound(...args); } catch (err) {
            if (err?.name === 'CoordinationRefusal' || err instanceof TypeError) throw err;
            throw this._poisonCoordination(err);
          }
        };
      },
    });
    this._referee = opts.referee;
    this._route = opts.route;
    this._story = opts.story ?? null;
    this._repoRoot = opts.repoRoot ?? null;
    this._now = opts.now || Date.now;
    this._approvalTimeoutMs = opts.approvalTimeoutMs ?? 60000;
    this._stopDeadlineMs = opts.stopDeadlineMs ?? 15000;
    this._recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 15000;
    this._budgetThresholds = Object.freeze([...(opts.budgetPolicy?.thresholds ?? [0.5, 0.8, 1])].sort((a, b) => a - b));
    this._budgetHardStopAt = opts.budgetPolicy?.hardStopAt ?? 1;
    this._budgetTerminalGraceMs = opts.budgetPolicy?.terminalGraceMs ?? 250;
    this._watchdog = Object.freeze({
      stallMs: opts.watchdog?.stallMs ?? 120000,
      loopThreshold: opts.watchdog?.loopThreshold ?? 3,
      scopeAction: opts.watchdog?.scopeAction ?? 'kill',
      loopAction: opts.watchdog?.loopAction ?? 'interrupt',
      stallAction: opts.watchdog?.stallAction ?? 'interrupt',
    });
    this._waitPollMs = opts.waitPollMs ?? 25;
    // C1: the sole done-gate, and the driver-level policy passed to every accept() call.
    this._accept = opts.accept ?? defaultAccept;
    this._acceptOpts = opts.acceptOpts ?? {};
    this._requireIndependentOracle = opts.requireIndependentOracle ?? false;
    this._publisher = opts.publisher ?? null;
    // C4: injectable timer primitives for a real, unref'd stop-deadline timer.
    this._setTimeout = opts.setTimeout ?? globalThis.setTimeout;
    this._clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout;

    // D8/CK1: feed the optional story sink, but never turn an authoritative-log failure into a
    // warning-and-drop. Once an append fails the coordinator is poisoned: every public command
    // fails closed until process restart/replay, and any not-yet-entered spawn is aborted. A
    // caller may tear storage down only after it has quiesced the coordinator; racing teardown
    // is an integrity failure, not a benign sink failure.
    {
      const rawAppend = this._log.append.bind(this._log);
      this._appendFailures = 0;
      this._fatalError = null;
      this._log.append = (partial) => {
        let e;
        try {
          e = rawAppend(partial);
        } catch (err) {
          this._appendFailures += 1;
          if (!this._fatalError) {
            const fatal = new Error(`authoritative operational log append failed: ${err?.message ?? err}`, { cause: err });
            fatal.name = 'OperationalLogIntegrityError';
            fatal.code = 'operational_log_unavailable';
            this._fatalError = fatal;
            for (const handle of this._workers?.values?.() ?? []) {
              if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
                handle.spawnAbort.abort({ reason: 'operational_log_unavailable' });
              }
            }
          }
          throw this._fatalError;
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
    this._publicationSeq = 0;
    this._refinementSeq = 0;

    this._seedCoordinationTasks();

    for (const adapter of Object.values(this._adapters)) {
      adapter.onEvent((e) => {
        try { this._handleEvent(e); } catch (err) {
          // Adapter callbacks are an asynchronous trust boundary. A fatal authoritative-write
          // failure has already poisoned this coordinator; do not let it become an uncaught
          // process exception. The next public command observes the fatal error.
          if (!this._fatalError) throw err;
        }
      });
    }

    // D10: reconcile first, then rebuild all state purely from the log.
    if (this._worktrees && typeof this._worktrees.reconcile === 'function') {
      Promise.resolve(this._worktrees.reconcile()).catch(noop);
    }
    if (this._runtimeScopes && typeof this._runtimeScopes.reconcile === 'function') {
      Promise.resolve(this._runtimeScopes.reconcile([])).catch(noop);
    }
    this._replay();
    this._terminalizeUnattachedCoordinationTasks();
  }

  // =========================================================================
  // tick() — dispatch + deadline sweep. Called implicitly by every public command.
  // =========================================================================

  tick() {
    if (this._fatalError) throw this._fatalError;
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
      this._dispatch(task, vendor, selection.model, selection.effort);
    }
  }

  _sweepDeadlines() {
    const now = this._now();
    for (const [requestId, record] of [...this._pending]) {
      if ((record.kind === 'approval' || record.kind === 'publication') && record.state === 'pending' && record.deadlineAt != null && now >= record.deadlineAt) {
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
      const effort = resolveEffort(this._adapters[vendor]?.card(), task.effortRequested);
      return resolved.ok && effort.ok ? { vendor, model: resolved.model, effort: effort.effort } : null;
    }
    const cards = {};
    const resolvedModels = {};
    for (const [name, ad] of Object.entries(this._adapters)) {
      const card = ad.card();
      if (!cardSupportsSession(card, task.sessionRequest)) continue;
      const resolved = resolveCardModel(card, task.modelRequested, task.modelPolicy, { explicit: false });
      const effort = resolveEffort(card, task.effortRequested);
      if (resolved.ok && effort.ok) {
        cards[name] = {
          ...card,
          modelSelection: { ...(card.modelSelection ?? {}), resolved: resolved.model ?? null, resolvedEffort: effort.effort ?? null },
        };
        resolvedModels[name] = resolved.model;
        cards[name]._resolvedEffort = effort.effort;
      }
    }
    const inFlight = {};
    for (const name of Object.keys(this._adapters)) inFlight[name] = this._inFlightCount(name);
    const chosen = this._route(task, cards, inFlight);
    if (!chosen || !this._adapters[chosen] || !Object.hasOwn(resolvedModels, chosen)) return null;
    return { vendor: chosen, model: resolvedModels[chosen], effort: cards[chosen]._resolvedEffort ?? null };
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

  _dispatch(task, vendor, model, effort) {
    const handle = this._workers.get(task.assignee);
    const workerId = handle.id;
    if (this._coordination) {
      const claim = this._coordination.claimTask(task.id, workerId, task.coordinationVersion, {
        actor: 'orchestrator', key: `task.claimed:${task.id}:${task.coordinationVersion}`,
      });
      task.coordinationVersion = claim.task.version;
    }
    this._fences.register(workerId);
    handle.vendor = vendor;
    handle.modelResolved = model ?? null;
    task.modelResolved = model ?? null;
    handle.effortResolved = effort ?? null;
    task.effortResolved = effort ?? null;
    task.routeKey = routeTupleKey(this._adapters[vendor]?.card(), task.modelResolved, task.effortResolved, task.taskType);
    handle.routeKey = task.routeKey;
    const harness = this._harnessOf(vendor);
    let runtime;
    try {
      runtime = this._ensureRuntimeScope(handle);
    } catch (err) {
      try { this._runtimeScopes?.remove?.(workerId); } catch { /* best effort */ }
      const crashEvent = this._log.append({
        worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'lifecycle.crashed', actor: 'policy',
        payload: { phase: 'runtime_scope', error: String(err?.message ?? err) },
      });
      const evidence = this._coordMapEvent(crashEvent);
      this._coordTransition(task, 'failed', `task.failed:${task.id}:runtime_scope`, evidence);
      task.status = 'failed';
      handle.status = 'exited';
      return;
    }
    if (runtime) task.runtimeScope = handle.runtimeScope;

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
      harnessRequested: task.vendorRequested, harnessResolved: harness,
      modelRequested: task.modelRequested ?? null, modelResolved: task.modelResolved ?? null, modelObserved: null,
      effortRequested: task.effortRequested ?? null, effortResolved: task.effortResolved ?? null, effortObserved: null,
      routeKey: task.routeKey ?? null,
      payload: {
        taskId: task.id, brief: task.brief, vendorRequested: task.vendorRequested, vendorResolved: vendor,
        modelRequested: task.modelRequested, modelResolved: task.modelResolved, modelPolicy: task.modelPolicy,
        effortRequested: task.effortRequested, effortResolved: task.effortResolved, routeKey: task.routeKey,
        sessionRequest: task.sessionRequest,
        lineage: task.lineage,
        review: task.review,
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
      reasoningEffort: task.effortResolved ?? undefined,
      serviceTier: task.modelPolicy?.serviceTier,
      session: task.sessionRequest?.mode === 'new' ? undefined : task.sessionRequest,
      env: runtime?.env,
      replaceEnv: runtime?.replaceEnv === true,
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
    handle.turnTerminalObserved = false;
    this._clearBudgetStop(handle);
    this._resetWatchdogTurn(handle);
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
    const crashEvent = this._log.append({
      worker: handle.id,
      harness,
      turnEpoch: this._safeTurnEpoch(handle),
      kind: 'lifecycle.crashed',
      actor: 'orchestrator',
      payload: { error: ack.reason ?? 'spawn refused', phase: 'spawn' },
    });
    const evidence = this._coordMapEvent(crashEvent);
    this._coordTransition(task, 'failed', `task.failed:${task.id}:spawn`, evidence, 'orchestrator');
    handle.status = 'exited';
    task.status = 'failed';
    this._removeRuntimeScope(handle);
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
    const modelPolicy = normalizeModelPolicy(opts.model, opts.modelPolicy, opts.effort);
    const effortRequested = opts.effort ?? modelPolicy?.reasoningEffort ?? null;
    let sessionRequest = normalizeSessionRequest(opts.session);

    const taskId = opts.taskId ?? this._autoTaskId();
    if (this._tasks.has(taskId)) throw new DuplicateTaskIdError(`duplicate taskId "${taskId}"`);
    if (vendor !== 'auto' && !this._adapters[vendor]) throw new UnknownVendorError(`unknown vendor "${vendor}"`);
    if (vendor !== 'auto' && !cardSupportsSession(this._adapters[vendor].card(), sessionRequest)) {
      throw new SessionSelectionError(`harness "${vendor}" does not support session mode "${sessionRequest.mode}"`);
    }
    if (vendor !== 'auto') {
      const effort = resolveEffort(this._adapters[vendor].card(), effortRequested);
      if (!effort.ok) throw new ModelSelectionError(`harness "${vendor}" cannot honor effort "${effortRequested}"`, effort.reason);
      const resolved = resolveCardModel(this._adapters[vendor].card(), opts.model, modelPolicy, { explicit: true });
      if (!resolved.ok) {
        throw new ModelSelectionError(`harness "${vendor}" cannot honor model "${opts.model ?? '(policy)'}"`, resolved.reason);
      }
    } else if (opts.model !== undefined || modelPolicy || effortRequested) {
      const modelCapable = Object.values(this._adapters).filter((ad) => resolveCardModel(ad.card(), opts.model, modelPolicy, { explicit: false }).ok);
      const anyCapable = modelCapable.some((ad) => resolveEffort(ad.card(), effortRequested).ok);
      if (!anyCapable) {
        const code = effortRequested && modelCapable.length > 0 ? 'effort_unavailable' : 'model_unavailable';
        throw new ModelSelectionError(`no harness can honor route model="${opts.model ?? '(policy)'}" effort="${effortRequested ?? '(default)'}"`, code);
      }
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
    let coordinationVersion = null;
    if (this._coordination) {
      const created = this._coordination.createTask({
        id: taskId, brief: admittedBrief, deps, refines: opts.refines ?? null,
        taskType: opts.taskType ?? 'general', reservedWorkerId: workerId,
        vendorRequested: vendor, modelRequested: opts.model ?? null, modelPolicy,
        effortRequested, effortResolved: null, effortObserved: null, routeKey: null,
        sessionRequest,
      }, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey ?? `task.created:${taskId}` });
      coordinationVersion = created.task.version;
    }
    const task = {
      id: taskId,
      brief: admittedBrief,
      deps,
      vendorRequested: vendor,
      modelRequested: opts.model,
      modelResolved: null,
      modelObserved: null,
      effortRequested,
      effortResolved: null,
      effortObserved: null,
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
      capturedSha: null,
      integration: null,
      retainedResultRef: null,
      publication: null,
      review: opts.review ? Object.freeze({ ...opts.review }) : null,
      coordinationVersion,
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
      effortRequested,
      effortResolved: null,
      effortObserved: null,
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
      budgetThresholdsFired: new Set(),
      usageCumulative: new Map(),
      budgetStopTimer: null,
      turnTerminalObserved: false,
      watchdogActions: new Set(),
      recentFailedActions: [],
      watchdogGeneration: 0,
      watchdogTimer: null,
      runtimeScope: null,
      runtimeLease: null,
      spawnAbort: null,
      createdAt: new Date(this._now()).toISOString(),
    };
    this._workers.set(workerId, handle);

    this.tick();

    return this._publicHandle(handle);
  }

  _seedCoordinationTasks() {
    if (!this._coordination) return;
    for (const durable of this._coordination.snapshot().tasks) {
      if (this._tasks.has(durable.id)) continue;
      const workerId = durable.reservedWorkerId;
      if (!workerId) continue;
      const task = {
        id: durable.id, brief: durable.brief, deps: [...durable.deps],
        vendorRequested: durable.vendorRequested, modelRequested: durable.modelRequested,
        modelResolved: durable.modelResolved ?? null, modelObserved: durable.modelObserved ?? null, modelPolicy: durable.modelPolicy,
        effortRequested: durable.effortRequested ?? null, effortResolved: durable.effortResolved ?? null,
        effortObserved: durable.effortObserved ?? null, routeKey: durable.routeKey ?? null,
        sessionRequest: durable.sessionRequest ?? Object.freeze({ mode: 'new' }),
        sessionContext: null, lineage: null, refines: durable.refines ?? null,
        status: durable.status, assignee: workerId, worktree: null, result: null, verdict: null,
        capturedSha: null, integration: null, retainedResultRef: null, publication: null,
        review: null, taskType: durable.taskType ?? 'general', coordinationVersion: durable.version,
      };
      this._tasks.set(task.id, task);
      this._taskOrder.push(task.id);
      this._workers.set(workerId, {
        id: workerId, vendor: durable.vendorRequested === 'auto' ? null : durable.vendorRequested,
        modelRequested: durable.modelRequested ?? null, modelResolved: null, modelObserved: null,
        modelPolicy: durable.modelPolicy ?? null, modelMismatch: null,
        effortRequested: durable.effortRequested ?? null, effortResolved: durable.effortResolved ?? null,
        effortObserved: durable.effortObserved ?? null, routeKey: durable.routeKey ?? null, effortMismatch: null,
        sessionRequest: task.sessionRequest, sessionContext: null, lineage: null,
        taskId: task.id, worktree: null,
        status: durable.status === 'pending' ? 'pending' : (TERMINAL_TASK_STATUSES.has(durable.status) ? 'idle' : 'orphaned'), pendingApprovalId: null,
        pendingQuestionId: null, budgetUsed: { tokens: 0, usd: 0 }, budgetThresholdsFired: new Set(),
        usageCumulative: new Map(), budgetStopTimer: null, turnTerminalObserved: false,
        watchdogActions: new Set(), recentFailedActions: [],
        watchdogGeneration: 0, watchdogTimer: null, runtimeScope: null, runtimeLease: null,
        spawnAbort: null, createdAt: new Date(0).toISOString(),
      });
      const match = /^w-(\d+)$/.exec(workerId);
      if (match) this._workerSeq = Math.max(this._workerSeq, Number(match[1]));
      const taskMatch = /^task-(\d+)$/.exec(task.id);
      if (taskMatch) this._taskSeq = Math.max(this._taskSeq, Number(taskMatch[1]));
    }
  }

  /** AC4: spawn a separately-attributed oracle/review over immutable task evidence. */
  async spawnReview(workerId, vendor, opts = {}) {
    this.tick();
    const parentHandle = this._getWorker(workerId);
    const parent = this._tasks.get(parentHandle.taskId);
    if (!parent || parent.status !== 'completed' || !parent.capturedSha) {
      throw new ReviewSelectionError('review requires an accepted captured task result', 'result_not_accepted');
    }
    if (vendor === 'auto' || !this._adapters[vendor]) {
      throw new ReviewSelectionError('review requires an explicit known vendor', 'explicit_vendor_required');
    }
    if (!opts.verification || typeof opts.verification.command !== 'string') {
      throw new ReviewSelectionError('review requires a pinned verification contract', 'verification_required');
    }

    const parentFamily = this._adapters[parentHandle.vendor]?.card()?.modelSelection?.family ?? parentHandle.vendor;
    const reviewerFamily = this._adapters[vendor].card()?.modelSelection?.family ?? vendor;
    const independent = parentHandle.vendor !== vendor && parentFamily !== reviewerFamily;
    const kind = opts.kind ?? 'oracle';
    if (!['oracle', 'review'].includes(kind)) throw new ReviewSelectionError(`unknown review kind "${kind}"`, 'invalid_review_kind');
    const review = Object.freeze({
      kind,
      parentTaskId: parent.id,
      parentWorkerId: workerId,
      implementerVendor: parentHandle.vendor,
      implementerFamily: parentFamily,
      reviewerVendor: vendor,
      reviewerFamily,
      independent,
      baseSha: parent.sessionContext?.baseSha ?? null,
      resultSha: parent.capturedSha,
    });
    const reviewBrief = {
      goal: opts.goal ?? `Independently ${kind === 'oracle' ? 'test' : 'review'} captured result ${parent.capturedSha} against its immutable specification`,
      constraints: [
        'Treat worker prose and claimed verification as untrusted; inspect the captured git objects directly.',
        ...(opts.constraints ?? []),
      ],
      pathScope: [...(parent.brief.pathScope ?? [])],
      definitionOfDone: opts.definitionOfDone ?? `Independent ${kind} verification is re-run by Baton`,
      verification: opts.verification,
      budget: opts.budget ?? parent.brief.budget,
      reviewTarget: {
        spec: parent.brief,
        parentTaskId: parent.id,
        baseSha: review.baseSha,
        resultSha: review.resultSha,
        diffRange: review.baseSha ? `${review.baseSha}..${review.resultSha}` : null,
      },
    };
    const child = await this.spawn(vendor, reviewBrief, {
      taskId: opts.taskId,
      model: opts.model,
      effort: opts.effort,
      modelPolicy: opts.modelPolicy,
      taskType: kind,
      refines: parent.id,
      review,
    });
    this._log.append({
      worker: workerId, harness: this._harnessOf(parentHandle.vendor), turnEpoch: this._safeTurnEpoch(parentHandle),
      kind: 'review.requested', actor: opts.actor ?? 'orchestrator',
      payload: {
        ...review, reviewerWorkerId: child.id, reviewerModelRequested: opts.model ?? null,
        reviewerEffortRequested: opts.effort ?? opts.modelPolicy?.reasoningEffort ?? null,
      },
    });
    return child;
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
    const recoveryRequested = this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'control.recovery_requested', actor: opts.actor ?? 'orchestrator',
      payload: { sessionRef: handle.sessionRef, context },
    });
    const recoveryEvidence = this._coordMapEvent(recoveryRequested);
    this._coordRecord('recovery.requested', {
      taskId: task.id, workerId, sessionId: handle.sessionRef.id, context, evidence: recoveryEvidence,
    }, `driver.recovery.requested:${task.id}:${recoveryRequested.seq}`, opts.actor ?? 'orchestrator');
    const runtime = this._ensureRuntimeScope(handle);

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
      env: runtime?.env,
      replaceEnv: runtime?.replaceEnv === true,
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
      Promise.resolve(adapter.kill(workerId)).catch(noop).finally(() => this._removeRuntimeScope(handle));
      return { ok: false, ...failed };
    }

    const stamp = this._fences.bumpTurn(workerId);
    let activeTask;
    try {
      activeTask = this._createCoordinationRefinement(handle, task, 'recovery');
    } catch (err) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      handle.status = 'orphaned';
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'recovery', requestedSeq: recoveryRequested.seq, reason: String(err?.message ?? err), action: 'kill_untrusted_transport' },
      });
      Promise.resolve(adapter.kill(workerId)).catch(noop).finally(() => this._removeRuntimeScope(handle));
      throw err;
    }
    activeTask.status = 'working';
    activeTask.result = null;
    activeTask.verdict = null;
    activeTask.sessionRequest = session;
    activeTask.sessionContext = context;
    handle.status = 'working';
    handle.turnTerminalObserved = false;
    this._clearBudgetStop(handle);
    handle.sessionRequest = session;
    handle.sessionContext = context;
    handle.turnAdmission = null;
    this._resetWatchdogTurn(handle);
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

  /** AC5: explicitly integrate an accepted captured commit. This never pushes. */
  async integrate(workerId, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (!task || task.status !== 'completed' || !task.capturedSha) {
      throw new IntegrationError('integration requires an accepted captured task result', 'result_not_accepted');
    }
    if (this._requireIndependentOracle) {
      const oracle = [...this._tasks.values()].find((candidate) =>
        candidate.review?.parentTaskId === task.id
        && candidate.review.kind === 'oracle'
        && candidate.review.independent === true
        && candidate.status === 'completed');
      if (!oracle) {
        throw new IntegrationError('integration requires a completed independent oracle from a different model family', 'independent_oracle_required');
      }
    }
    const strategy = opts.strategy ?? 'ff-only';
    if (strategy !== 'ff-only') {
      throw new IntegrationError(`unsupported integration strategy: ${strategy}`, 'unsupported_strategy');
    }
    if (!this._worktrees || typeof this._worktrees.integrate !== 'function') {
      throw new IntegrationError('worktree manager does not implement integration', 'integration_unavailable');
    }
    if (handle.status === 'working' || handle.status === 'blocked' || handle.status === 'stopping' || handle.status === 'pending') {
      throw new IntegrationError('worker must be idle, dead, exited, or orphaned before integration', 'worker_not_quiescent');
    }

    this._coordRecord('integration.requested', {
      taskId: task.id, workerId, strategy, sha: task.capturedSha,
      actor: opts.actor ?? 'orchestrator', effect: 'local_git_merge',
    }, `driver.integration.requested:${task.id}:${task.capturedSha}`, opts.actor ?? 'orchestrator');

    if (typeof this._worktrees.retainResult === 'function') {
      task.retainedResultRef = await this._worktrees.retainResult(task.capturedSha);
    }

    if (handle.status === 'idle') {
      const stopped = await this.kill(workerId, opts.actor ?? 'orchestrator');
      if (!['confirmed', 'already_dead', 'already_stopped'].includes(stopped.result)) {
        throw new IntegrationError('worker could not be safely stopped before integration', 'worker_stop_failed');
      }
    } else if (handle.status === 'exited') {
      await this.kill(workerId, opts.actor ?? 'orchestrator');
    }
    await this._removeTaskWorktree(task);

    let integrated;
    try {
      integrated = await this._worktrees.integrate(task.capturedSha, { strategy });
    } catch (err) {
      const refusedEvent = this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'integration.refused', actor: 'policy',
        payload: { strategy, sha: task.capturedSha, retainedResultRef: task.retainedResultRef, reason: String(err?.message ?? err) },
      });
      const refusedEvidence = this._coordMapEvent(refusedEvent);
      this._coordRecord('integration.refused', {
        taskId: task.id, strategy, sha: task.capturedSha, retainedResultRef: task.retainedResultRef,
        reason: String(err?.message ?? err), evidence: refusedEvidence,
      }, `driver.integration.refused:${task.id}:${refusedEvent.seq}`, 'policy');
      throw new IntegrationError(String(err?.message ?? err), 'non_fast_forward_or_dirty');
    }
    if (task.retainedResultRef && typeof this._worktrees.releaseResult === 'function') {
      try { await this._worktrees.releaseResult(task.retainedResultRef); } catch { /* merged HEAD now retains the result */ }
      task.retainedResultRef = null;
    }
    const integration = Object.freeze({ ...integrated, strategy, actor: opts.actor ?? 'orchestrator' });
    const integrationEvent = this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'integration.completed', actor: opts.actor ?? 'orchestrator', payload: integration,
    });
    const integrationEvidence = this._coordMapEvent(integrationEvent);
    if (this._coordination) {
      const acceptingEvidence = this._coordination.task(task.id).artifactIds
        .map((artifactId) => this._coordination.artifact(artifactId))
        .filter((artifact) => artifact?.accepted === true)
        .flatMap((artifact) => artifact.provenance ?? []);
      this._coordination.completeIntegration({
        taskId: task.id, integration, evidence: integrationEvidence,
        artifact: {
          taskId: task.id, kind: 'report', refs: { beforeSha: integration.beforeSha, resultSha: integration.resultSha, afterSha: integration.afterSha },
          mediaType: 'application/vnd.baton.integration+json', accepted: true, provenance: [integrationEvidence, ...acceptingEvidence],
        },
        knowledge: {
          id: `decision:integrate:${task.id}:${integrationEvent.seq}`, type: 'Decision',
          body: `Integrated task ${task.id} at ${integration.afterSha}`, grounding: 'observed',
          informedBy: [`task:${task.id}`], evidence: [{ coordinationSeq: integrationEvidence.coordinationSeq }],
        },
      }, { actor: opts.actor ?? 'orchestrator', key: `integration.commit:${task.id}:${integrationEvent.seq}` });
    }
    task.integration = integration;
    return { ok: true, result: 'integrated', integration };
  }

  /** AC6: create an approval-gated exact-SHA publication request. No side effect occurs here. */
  requestPublication(workerId, target = {}, actor = 'orchestrator') {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (!task?.integration?.afterSha) {
      throw new PublicationError('publication requires a locally integrated result', 'result_not_integrated');
    }
    const remote = target.remote;
    const ref = target.ref;
    const sha = target.sha ?? task.integration.afterSha;
    if (typeof remote !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) {
      throw new PublicationError('remote must be a credential-free git remote name', 'invalid_remote');
    }
    if (typeof ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(ref) || ref.includes('..')) {
      throw new PublicationError('ref must be a full, safe refs/heads/* name', 'invalid_ref');
    }
    if (sha !== task.integration.afterSha) {
      throw new PublicationError('publication SHA must equal the integrated result SHA', 'sha_mismatch');
    }
    const stamp = this._fences.bumpHuman(workerId);
    const requestId = `publication-${workerId}-${++this._publicationSeq}`;
    const publication = Object.freeze({ remote, ref, sha });
    const deadlineAt = this._now() + this._approvalTimeoutMs;
    const record = {
      kind: 'publication', worker: workerId, state: 'pending', resolution: null, consumer: null,
      turnEpochAtAsk: stamp.turnEpoch, fenceAtAsk: stamp.fence,
      deadlineAt, publication,
    };
    const requestedEvent = this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
      kind: 'publication.requested', actor,
      payload: { requestId, ...publication, fence: stamp.fence, deadlineAt },
    });
    const evidence = this._coordMapEvent(requestedEvent);
    this._coordRecord('publication.requested', {
      taskId: task.id, workerId, requestId, publication, fence: stamp.fence, deadlineAt, evidence,
    }, `driver.publication.requested:${task.id}:${requestId}`, actor);
    this._pending.set(requestId, record);
    return { ok: true, requestId, fence: stamp.fence, target: publication };
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
      harnessRequested: this._tasks.get(handle.taskId)?.vendorRequested ?? null,
      harnessResolved: handle.vendor ? this._harnessOf(handle.vendor) : null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      routeKey: handle.routeKey ?? null,
      modelMismatch: handle.modelMismatch ?? null,
      effortMismatch: handle.effortMismatch ?? null,
      modelPolicy: handle.modelPolicy ?? null,
      sessionRequest: handle.sessionRequest ?? { mode: 'new' },
      sessionRef: handle.sessionRef ?? null,
      sessionContext: handle.sessionContext ?? null,
      lineage: handle.lineage ?? null,
      runtimeScope: handle.runtimeScope ?? null,
      review: this._tasks.get(handle.taskId)?.review ?? null,
      taskId: handle.taskId,
      worktree: handle.worktree,
      fence,
      turnEpoch,
      status: handle.status,
      pendingApprovalId: handle.pendingApprovalId,
      pendingQuestionId: handle.pendingQuestionId,
      budgetUsed: { ...handle.budgetUsed },
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
        const recoveryEvent = this._log.append({
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

    const requestedEvent = this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'control.follow_up_requested', actor: opts.actor ?? 'orchestrator',
      payload: { message, expectedFence: opts.expectedFence ?? null },
    });
    const requestedEvidence = this._coordMapEvent(requestedEvent);
    this._coordRecord('follow_up.requested', {
      taskId: task.id, workerId, expectedFence: opts.expectedFence ?? null, evidence: requestedEvidence,
    }, `driver.follow_up.requested:${task.id}:${requestedEvent.seq}`, opts.actor ?? 'orchestrator');

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
    let activeTask;
    try {
      activeTask = this._createCoordinationRefinement(handle, task, 'follow_up');
    } catch (err) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      handle.status = 'orphaned';
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'follow_up', requestedSeq: requestedEvent.seq, reason: String(err?.message ?? err), action: 'kill_untrusted_transport' },
      });
      Promise.resolve(this._adapters[handle.vendor].kill(workerId)).catch(noop);
      this._removeRuntimeScope(handle);
      this._removeTaskWorktree(task).catch(noop);
      throw err;
    }
    activeTask.status = 'working';
    activeTask.result = null;
    activeTask.verdict = null;
    handle.status = 'working';
    handle.turnTerminalObserved = false;
    this._clearBudgetStop(handle);
    handle.turnAdmission = null;
    this._resetWatchdogTurn(handle);
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

  async interrupt(workerId, then, actor = 'orchestrator', opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    if (opts.expectedFence !== undefined) {
      const check = this._fences.check(workerId, { fence: opts.expectedFence });
      if (!check.ok) return { ok: false, result: 'stale_fence', current: check.current };
    }
    if (handle.status === 'dead' || handle.status === 'exited') {
      return { ok: true, result: handle.status === 'dead' ? 'already_dead' : 'already_stopped' };
    }
    if (handle.status === 'orphaned') {
      return { ok: false, result: 'session_not_attached', reason: 'restart replay found no controllable adapter session' };
    }
    return this._beginStop(handle, 'interrupt', then, actor);
  }

  async kill(workerId, actor = 'orchestrator', opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    if (opts.expectedFence !== undefined) {
      const check = this._fences.check(workerId, { fence: opts.expectedFence });
      if (!check.ok) return { ok: false, result: 'stale_fence', current: check.current };
    }
    if (handle.status === 'dead') return { ok: true, result: 'already_dead' };
    if (handle.status === 'orphaned') {
      return { ok: false, result: 'session_not_attached', reason: 'restart replay found no controllable adapter session' };
    }
    // CI3: a crashed/exited child cannot emit another kill.confirmed. Treat its authoritative
    // terminal event as the confirmation, finish cleanup now, and never arm an unfulfillable wait.
    if (handle.status === 'exited') {
      handle.status = 'dead';
      this._removeRuntimeScope(handle);
      await this._removeTaskWorktree(this._tasks.get(handle.taskId));
      return { ok: true, result: 'already_dead' };
    }
    return this._beginStop(handle, 'kill', undefined, actor);
  }

  _beginStop(handle, mode, then, actor) {
    const existing = this._stopWaiters.get(handle.id);
    if (existing) {
      if (mode === 'kill' && existing.mode !== 'kill') {
        const harness = this._harnessOf(handle.vendor);
        const requested = this._log.append({ worker: handle.id, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'kill.requested', actor, payload: {} });
        const evidence = this._coordMapEvent(requested);
        this._coordRecord('control.stop_requested', { taskId: handle.taskId, workerId: handle.id, mode: 'kill', escalation: true, evidence }, `driver.stop_requested:${handle.taskId}:${requested.seq}`, actor);
        existing.mode = 'kill';
        existing.ackReady = false;
        existing.confirmReceived = false;
        const call = Promise.resolve(this._adapters[handle.vendor].kill(handle.id));
        this._wireAck(existing, call);
      }
      return new Promise((resolve) => existing.resolvers.push(resolve));
    }

    this._fences.bumpHuman(handle.id);
    const harness = this._harnessOf(handle.vendor);
    const turnEpoch = this._safeTurnEpoch(handle);
    const reqKind = mode === 'kill' ? 'kill.requested' : 'control.interrupt_requested';
    const reqPayload = mode === 'kill' ? {} : { then: then ?? null, actor };
    const requested = this._log.append({ worker: handle.id, harness, turnEpoch, kind: reqKind, actor, payload: reqPayload });
    const evidence = this._coordMapEvent(requested);
    this._coordRecord('control.stop_requested', { taskId: handle.taskId, workerId: handle.id, mode, then: then ?? null, evidence }, `driver.stop_requested:${handle.taskId}:${requested.seq}`, actor);

    if (handle.status === 'blocked') {
      if (handle.pendingApprovalId) {
        this._resolveRecord(handle.pendingApprovalId, { decision: 'cancel' }, actor).catch(noop);
      } else if (handle.pendingQuestionId) {
        this._resolveRecord(handle.pendingQuestionId, { decision: 'cancel' }, actor).catch(noop);
      }
    }
    if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
      handle.spawnAbort.abort({ mode, actor });
    }
    handle.status = 'stopping';
    this._clearBudgetStop(handle);
    this._clearWatchdog(handle);

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

  _coordTransition(task, to, key, evidence = null, actor = 'policy') {
    if (!this._coordination || !task) return null;
    const durable = this._coordination.task(task.id);
    if (!durable || durable.status === to) return durable;
    const result = this._coordination.transitionTask(task.id, to, task.coordinationVersion ?? durable.version, { actor, key }, evidence);
    task.coordinationVersion = result.task.version;
    if (TERMINAL_TASK_STATUSES.has(to)) {
      const handle = this._workers.get(task.assignee);
      this._expireScratchClaims(handle, task, `task_${to}`);
    }
    return result.task;
  }

  _coordMap(event, key) {
    if (!this._coordination || !event) return null;
    return this._coordination.mapOperationalEvent(event, { actor: 'policy', key }).evidence;
  }

  _coordMapEvent(event) {
    if (!event) return null;
    return this._coordMap(event, `evidence:${event.worker}:${event.seq}`);
  }

  _coordRecord(kind, payload, key, actor = 'policy') {
    if (!this._coordination) return null;
    return this._coordination.recordDriver(kind, payload, { actor, key }).event;
  }

  _poisonCoordination(err) {
    if (!this._fatalError) {
      const fatal = new Error(`authoritative coordination mutation failed: ${err?.message ?? err}`, { cause: err });
      fatal.name = 'CoordinationWriteIntegrityError';
      fatal.code = 'coordination_write_unavailable';
      this._fatalError = fatal;
      for (const handle of this._workers.values()) {
        if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) handle.spawnAbort.abort({ reason: 'coordination_write_unavailable' });
      }
    }
    return this._fatalError;
  }

  _createCoordinationRefinement(handle, prior, relation) {
    if (!this._coordination) return prior;
    const id = `${prior.id}:refinement-${++this._refinementSeq}`;
    const created = this._coordination.createTask({
      id, brief: prior.brief, deps: [], refines: prior.id, taskType: prior.taskType,
      reservedWorkerId: handle.id, vendorRequested: handle.vendor,
      modelRequested: handle.modelRequested, modelPolicy: handle.modelPolicy,
      sessionRequest: handle.sessionRequest, relation,
    }, { actor: 'orchestrator', key: `task.created:${id}` });
    const claimed = this._coordination.claimTask(id, handle.id, created.task.version, {
      actor: 'orchestrator', key: `task.claimed:${id}:${created.task.version}`,
    });
    const next = {
      ...prior, id, deps: [], refines: prior.id, status: 'working', result: null, verdict: null,
      capturedSha: null, integration: null, retainedResultRef: null, publication: null, review: null,
      coordinationVersion: claimed.task.version,
    };
    this._tasks.set(id, next);
    this._taskOrder.push(id);
    handle.taskId = id;
    return next;
  }

  _expireScratchClaims(handle, task, reason) {
    if (!this._coordination || !task) return;
    const workerId = handle?.id ?? task.assignee ?? null;
    for (const claim of this._coordination.activeScratchClaims({ workerId, taskId: task.id })) {
      this._coordination.expireScratchClaim(claim.id, claim.version, {
        actor: 'policy', key: `scratch.claim_expired:${claim.id}:${claim.version}:${reason}`,
      });
    }
  }

  async _removeTaskWorktree(task) {
    if (!task || !this._worktrees || typeof this._worktrees.remove !== 'function') return;
    const ownerTaskId = task.sessionContext?.ownerTaskId ?? task.id;
    await Promise.resolve(this._worktrees.remove(ownerTaskId)).catch(noop);
  }

  _ensureRuntimeScope(handle) {
    if (!this._runtimeScopes || typeof this._runtimeScopes.create !== 'function') return null;
    if (handle.runtimeLease) return handle.runtimeLease;
    const lease = this._runtimeScopes.create(handle.id, handle.vendor);
    handle.runtimeLease = lease;
    handle.runtimeScope = { ...lease.posture, active: true };
    this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'runtime.scope_created', actor: 'policy', payload: handle.runtimeScope,
    });
    return lease;
  }

  _removeRuntimeScope(handle) {
    if (!handle || !this._runtimeScopes || typeof this._runtimeScopes.remove !== 'function') return;
    try { this._runtimeScopes.remove(handle.id); } catch { /* best-effort cleanup continues */ }
    handle.runtimeLease = null;
    if (handle.runtimeScope) handle.runtimeScope = { ...handle.runtimeScope, active: false };
  }

  _clearWatchdog(handle) {
    handle.watchdogGeneration = (handle.watchdogGeneration ?? 0) + 1;
    if (handle.watchdogTimer != null) this._clearTimeout(handle.watchdogTimer);
    handle.watchdogTimer = null;
  }

  _armWatchdog(handle) {
    this._clearWatchdog(handle);
    if (!(this._watchdog.stallMs > 0) || handle.status !== 'working') return;
    const generation = handle.watchdogGeneration;
    handle.watchdogTimer = this._setTimeout(() => {
      if (handle.watchdogGeneration !== generation || handle.status !== 'working') return;
      const task = this._tasks.get(handle.taskId);
      if (!task || task.status !== 'working' || handle.watchdogActions?.has('stall')) return;
      handle.watchdogActions?.add('stall');
      this._log.append({
        worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'health.stall_suspected', actor: 'policy',
        payload: { elapsedMs: this._watchdog.stallMs, action: this._watchdog.stallAction, mechanical: true },
      });
      this._applyWatchdogAction(handle, this._watchdog.stallAction);
    }, this._watchdog.stallMs);
    if (handle.watchdogTimer && typeof handle.watchdogTimer.unref === 'function') handle.watchdogTimer.unref();
  }

  _resetWatchdogTurn(handle) {
    handle.watchdogActions = new Set();
    handle.recentFailedActions = [];
    this._armWatchdog(handle);
  }

  _touchWatchdog(handle) {
    if (handle.status === 'working') this._armWatchdog(handle);
  }

  _applyWatchdogAction(handle, action) {
    if (handle.status !== 'working' && handle.status !== 'blocked') return;
    if (action === 'kill') this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
    else if (action === 'interrupt') this._beginStop(handle, 'interrupt', undefined, 'policy').catch(noop);
  }

  _normalizeUsage(handle, payload) {
    const source = payload?.source ?? 'unknown';
    const wireAccounting = payload?.accounting ?? (payload?.tokenUsage ? 'cumulative' : 'delta');
    const rawTokens = Number(payload?.tokens ?? payload?.totalTokens ?? payload?.tokenUsage?.total?.totalTokens ?? 0);
    const rawUsd = Number(payload?.usd ?? payload?.totalCostUsd ?? 0);
    const deltaFor = (dimension, current) => {
      if (!Number.isFinite(current) || current < 0) return 0;
      if (wireAccounting !== 'cumulative') return current;
      const key = `${source}:${dimension}`;
      const prior = handle.usageCumulative.get(key) ?? 0;
      handle.usageCumulative.set(key, current);
      return current >= prior ? current - prior : current;
    };
    return {
      ...payload,
      tokens: deltaFor('tokens', rawTokens), usd: deltaFor('usd', rawUsd), accounting: 'delta',
      wireAccounting, wireTokens: rawTokens, wireUsd: rawUsd,
    };
  }

  _recordUsage(handle, event) {
    const task = this._tasks.get(handle.taskId);
    const payload = this._normalizeUsage(handle, event.payload ?? {});
    handle.budgetUsed.tokens += payload.tokens;
    handle.budgetUsed.usd += payload.usd;
    this._log.append({
      ...event, payload,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      harnessRequested: task?.vendorRequested ?? null,
      harnessResolved: handle.vendor ? this._harnessOf(handle.vendor) : null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      routeKey: handle.routeKey ?? task?.routeKey ?? null,
    });
    const tokenLimit = Number(task?.brief?.budget?.tokens ?? 0);
    const usdLimit = Number(task?.brief?.budget?.usd ?? 0);
    const tokenRatio = tokenLimit > 0 ? handle.budgetUsed.tokens / tokenLimit : 0;
    const usdRatio = usdLimit > 0 ? handle.budgetUsed.usd / usdLimit : 0;
    const ratio = Math.max(tokenRatio, usdRatio);
    let hard = false;
    for (const threshold of this._budgetThresholds) {
      if (ratio < threshold || handle.budgetThresholdsFired.has(threshold)) continue;
      handle.budgetThresholdsFired.add(threshold);
      const hardStop = threshold >= this._budgetHardStopAt;
      hard ||= hardStop;
      this._log.append({
        worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'resource.budget_threshold', actor: 'policy',
        payload: {
          threshold, hardStop, action: hardStop ? 'kill' : 'notify',
          used: { ...handle.budgetUsed }, limits: { tokens: tokenLimit, usd: usdLimit }, ratio,
          dimensions: { tokens: tokenRatio, usd: usdRatio },
        },
      });
    }
    if (hard && handle.status === 'working' && !handle.turnTerminalObserved && handle.budgetStopTimer == null) {
      handle.budgetStopTimer = this._setTimeout(() => {
        handle.budgetStopTimer = null;
        if (handle.status === 'working' && !handle.turnTerminalObserved) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      }, this._budgetTerminalGraceMs);
      if (handle.budgetStopTimer && typeof handle.budgetStopTimer.unref === 'function') handle.budgetStopTimer.unref();
    }
  }

  _clearBudgetStop(handle) {
    if (handle.budgetStopTimer != null) this._clearTimeout(handle.budgetStopTimer);
    handle.budgetStopTimer = null;
  }

  _relativeActionPath(handle, path) {
    if (typeof path !== 'string' || path.length === 0) return null;
    if (!isAbsolute(path)) return path.replace(/^\.\//, '');
    if (!handle.worktree) return path;
    const rel = relative(handle.worktree, path);
    return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
  }

  _observeWatchdogEvent(handle, event) {
    if (event.actor !== 'worker') return;
    this._touchWatchdog(handle);
    if (event.kind === 'lifecycle.turn_started') {
      this._resetWatchdogTurn(handle);
      return;
    }
    if (event.kind === 'content.tool_call') {
      const payload = event.payload ?? {};
      const command = payload.command ?? payload.cmd ?? payload.item?.command ?? payload.rawInput?.command ?? payload.rawOutput?.command;
      const exitCode = payload.exitCode ?? payload.item?.exitCode ?? payload.rawOutput?.exit_code;
      const status = payload.status ?? payload.item?.status ?? (exitCode !== undefined ? 'completed' : null);
      if (typeof command === 'string' && status === 'completed' && Number(exitCode) !== 0) {
        const signature = `${command}::${Number(exitCode)}`;
        handle.recentFailedActions.push(signature);
        const threshold = this._watchdog.loopThreshold;
        const tail = handle.recentFailedActions.slice(-threshold);
        if (threshold > 0 && tail.length === threshold && tail.every((value) => value === signature) && !handle.watchdogActions.has('loop')) {
          handle.watchdogActions.add('loop');
          this._log.append({
            worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
            kind: 'health.loop_suspected', actor: 'policy',
            payload: { command, exitCode: Number(exitCode), count: threshold, action: this._watchdog.loopAction, mechanical: true },
          });
          this._applyWatchdogAction(handle, this._watchdog.loopAction);
        }
      }
      return;
    }
    if (event.kind === 'content.file_edit') {
      const payload = event.payload ?? {};
      const rawPaths = [payload.path, ...(payload.paths ?? []), payload.item?.path,
        ...((payload.item?.changes ?? []).map((change) => change.path)),
        ...((payload.content ?? []).filter((item) => item?.type === 'diff').map((item) => item.path))].filter(Boolean);
      const task = this._tasks.get(handle.taskId);
      for (const rawPath of rawPaths) {
        const path = this._relativeActionPath(handle, rawPath);
        if (!path || pathInScope(task?.brief?.pathScope, path)) continue;
        if (handle.watchdogActions.has('scope')) break;
        handle.watchdogActions.add('scope');
        this._log.append({
          worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'health.scope_violation', actor: 'policy',
          payload: { path, observedPath: rawPath, action: this._watchdog.scopeAction, mechanical: true },
        });
        this._applyWatchdogAction(handle, this._watchdog.scopeAction);
      }
    }
  }

  _wireAck(waiter, call) {
    call
      .then((ack) => {
        waiter.emulated = !!(ack && ack.emulated === true);
        waiter.ackReady = true;
        if (ack?.ok === true && ack?.terminal === true) waiter.confirmReceived = true;
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
    const stopEvent = this._log.append(ev);

    try {
      if (handle) {
        const task = this._tasks.get(handle.taskId);
        if (waiter.mode === 'kill') {
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
            const evidence = this._coordMapEvent(stopEvent);
            this._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${stopEvent.seq}`, evidence);
          }
          handle.status = 'dead';
          this._removeRuntimeScope(handle);
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
          this._removeTaskWorktree(task).catch(noop);
        } else {
          if (waiter.then !== undefined) {
            const stamp = this._fences.bumpTurn(handle.id);
            handle.status = 'working';
            handle.turnTerminalObserved = false;
            this._clearBudgetStop(handle);
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
            this._resetWatchdogTurn(handle);
          } else {
            if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
              const evidence = this._coordMapEvent(stopEvent);
              this._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${stopEvent.seq}`, evidence);
            }
            handle.status = 'idle';
            if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
          }
        }
      }
    } catch (err) {
      if (handle) {
        handle.status = 'dead';
        this._removeRuntimeScope(handle);
        this._removeTaskWorktree(this._tasks.get(handle.taskId)).catch(noop);
        Promise.resolve(this._adapters[handle.vendor]?.kill(handle.id)).catch(noop);
      }
      for (const resolve of waiter.resolvers) resolve({ ok: false, result: 'coordination_unavailable' });
      this._stopWaiters.delete(workerId);
      throw err;
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
    const forcedEvent = this._log.append({ worker: workerId, harness, turnEpoch: handle ? this._safeTurnEpoch(handle) : 0, kind: 'control.forced_stop', actor: 'policy', payload: {} });

    let coordinationFailure = null;
    if (handle) {
      const task = this._tasks.get(handle.taskId);
      if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
        try {
          const evidence = this._coordMapEvent(forcedEvent);
          this._coordTransition(task, 'failed', `task.failed:${task.id}:${forcedEvent.seq}`, evidence);
        } catch (err) {
          coordinationFailure = err;
        }
      }
    }

    if (handle && this._adapters[handle.vendor]) {
      Promise.resolve(this._adapters[handle.vendor].kill(workerId)).catch(noop);
    }

    if (handle) {
      handle.status = 'dead';
      this._removeRuntimeScope(handle);
      const task = this._tasks.get(handle.taskId);
      if (!coordinationFailure && task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
      this._removeTaskWorktree(task).catch(noop);
    }

    const result = coordinationFailure ? { ok: false, result: 'coordination_unavailable' } : { ok: true, result: 'forced' };
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

    if (record.kind === 'publication') {
      const decision = answer?.decision;
      if (!['allow', 'deny'].includes(decision)) {
        record.state = 'pending';
        finishResolving();
        return { ok: false, result: 'invalid_decision' };
      }
      const currentFence = handle ? this._fences.current(handle.id).fence : null;
      const fenceValid = actor === 'policy' || answer?.fence === record.fenceAtAsk;
      if (!handle || !fenceValid || currentFence !== record.fenceAtAsk) {
        if (handle) {
          const refusedEvent = this._log.append({
            worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
            kind: 'publication.refused', actor: 'policy',
            payload: { requestId, reason: 'stale_fence', remote: record.publication.remote, ref: record.publication.ref, sha: record.publication.sha },
          });
          const evidence = this._coordMapEvent(refusedEvent);
          this._coordRecord('publication.refused', { taskId: handle.taskId, requestId, reason: 'stale_fence', publication: record.publication, evidence }, `driver.publication.refused:${handle.taskId}:${requestId}`, 'policy');
        }
        record.state = 'resolved';
        record.consumer = actor;
        record.resolution = { decision: 'deny', reason: 'stale_fence' };
        finishResolving();
        return { ok: false, result: 'stale_fence', current: currentFence };
      }
      if (decision === 'deny') {
        const deniedEvent = this._log.append({
          worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'publication.denied', actor,
          payload: { requestId, remote: record.publication.remote, ref: record.publication.ref, sha: record.publication.sha },
        });
        const evidence = this._coordMapEvent(deniedEvent);
        this._coordRecord('publication.denied', { taskId: handle.taskId, requestId, publication: record.publication, evidence }, `driver.publication.denied:${handle.taskId}:${requestId}`, actor);
        record.state = 'resolved';
        record.consumer = actor;
        record.resolution = { decision: 'deny' };
        finishResolving();
        return { ok: true, result: 'denied' };
      }
      if (typeof this._publisher !== 'function') {
        record.state = 'pending';
        finishResolving();
        return { ok: false, result: 'publication_unavailable' };
      }
      let authorizedEvent;
      try {
        authorizedEvent = this._log.append({
          worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'publication.authorized', actor,
          payload: { requestId, remote: record.publication.remote, ref: record.publication.ref, sha: record.publication.sha, fence: record.fenceAtAsk },
        });
        const evidence = this._coordMapEvent(authorizedEvent);
        this._coordRecord('publication.authorized', { taskId: handle.taskId, requestId, publication: record.publication, fence: record.fenceAtAsk, evidence }, `driver.publication.authorized:${handle.taskId}:${requestId}`, actor);
      } catch (err) {
        record.state = 'pending';
        finishResolving();
        throw err;
      }
      let published;
      try {
        published = await this._publisher(record.publication);
      } catch (err) {
        record.state = 'pending';
        finishResolving();
        throw new PublicationError(String(err?.message ?? err), 'publisher_failed');
      }
      const task = this._tasks.get(handle.taskId);
      void published;
      const publication = Object.freeze({ requestId, ...record.publication, actor });
      try {
        const publicationEvent = this._log.append({
          worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'publication.completed', actor, payload: publication,
        });
        const publicationEvidence = this._coordMapEvent(publicationEvent);
        this._coordination?.completePublication({
          taskId: task.id, publication, evidence: publicationEvidence,
          knowledge: {
          id: `decision:publish:${task.id}:${publicationEvent.seq}`, type: 'Decision',
          body: `Published task ${task.id} to ${publication.remote}/${publication.ref}`,
          grounding: 'observed', informedBy: [`task:${task.id}`],
          evidence: [{ coordinationSeq: publicationEvidence.coordinationSeq }],
          },
        }, { actor, key: `publication.commit:${task.id}:${publicationEvent.seq}` });
        task.publication = publication;
      } catch (err) {
        // The publisher may have advanced, so this reservation cannot roll back for retry. The
        // coordinator is poisoned by either authoritative append path, replay requires the atomic
        // coordination commit below, and a racing responder is released instead of hanging.
        record.state = 'resolved';
        record.consumer = actor;
        record.resolution = { decision: 'allow', outcome: 'unknown' };
        finishResolving();
        throw err;
      }
      record.state = 'resolved';
      record.consumer = actor;
      record.resolution = { decision: 'allow' };
      finishResolving();
      return { ok: true, result: 'published', publication };
    }

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
      const staleEvent = this._log.append({ worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'control.stale_rejected', actor, payload: { op: 'respond', requestId } });
      const task = this._tasks.get(handle.taskId);
      if (task && this._coordination?.task(task.id)?.status === 'input_required') {
        const evidence = this._coordMapEvent(staleEvent);
        this._coordTransition(task, 'working', `task.working:${task.id}:${staleEvent.seq}`, { ...evidence, interaction: { requestId, disposition: 'stale_discarded' } }, actor);
      }
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

    let resolvedEvent;
    try {
      if (record.kind === 'question') {
        const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'question.answered', actor, payload: { requestId, answer } };
        if (ack && ack.emulated === true) ev.emulated = true;
        resolvedEvent = this._log.append(ev);
      } else {
        const decision = answer && answer.decision;
        const ev = { worker: handle.id, harness, turnEpoch: currentTurnEpoch, kind: 'approval.resolved', actor, payload: { requestId, decision } };
        if (ack && ack.emulated === true) ev.emulated = true;
        resolvedEvent = this._log.append(ev);
      }
    } catch (err) {
      // Delivery was accepted by the native adapter and is not safely retryable. Commit the
      // in-memory single-consumer reservation, release racing responders, and rely on poisoned
      // fail-closed behavior plus replay terminalization for the missing durable resolution.
      record.state = 'resolved';
      record.consumer = actor;
      record.resolution = answer;
      finishResolving();
      throw err;
    }
    const task = this._tasks.get(handle.taskId);
    if (task && this._coordination?.task(task.id)?.status === 'input_required') {
      try {
        const evidence = this._coordMapEvent(resolvedEvent);
        this._coordTransition(task, 'working', `task.working:${task.id}:${resolvedEvent.seq}`, { ...evidence, interaction: { requestId, disposition: 'delivered' } }, actor);
      } catch (err) {
        record.state = 'resolved';
        record.consumer = actor;
        record.resolution = answer;
        finishResolving();
        throw err;
      }
    }

    record.state = 'resolved';
    record.consumer = actor;
    record.resolution = answer;
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
      harnessRequested: task?.vendorRequested ?? null,
      harnessResolved: handle.vendor ? this._harnessOf(handle.vendor) : null,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      modelMismatch: handle.modelMismatch ?? null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      effortMismatch: handle.effortMismatch ?? null,
      routeKey: handle.routeKey ?? task?.routeKey ?? null,
      sessionRequest: handle.sessionRequest ?? { mode: 'new' },
      sessionRef: handle.sessionRef ?? null,
      sessionContext: handle.sessionContext ?? null,
      lineage: handle.lineage ?? null,
      review: task?.review ?? null,
      integration: task?.integration ?? null,
      publication: task?.publication ?? null,
      retainedResultRef: task?.retainedResultRef ?? null,
    };
    if (!task) return { ready: false, status: handle.status, ...attribution };
    if (!TERMINAL_TASK_STATUSES.has(task.status)) return { ready: false, status: task.status, ...attribution };
    return { ready: true, status: task.status, verdict: task.verdict, artifacts: task.result ? task.result.artifacts : undefined, ...attribution };
  }

  /** Pull-only causal recall. The coordination append is the authority boundary: if the read
   * audit cannot be durably written, no recalled content is returned to the caller. */
  recallKnowledge(query, reader = {}, opts = {}) {
    this.tick();
    if (!this._coordination) throw new Error('coordination store is required for knowledge recall');
    const actor = opts.actor ?? 'orchestrator';
    const key = opts.idempotencyKey;
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('knowledge recall requires idempotencyKey');
    let taskId = reader.taskId ?? null;
    const workerId = reader.workerId ?? reader.readerWorker ?? null;
    if (workerId) {
      const handle = this._getWorker(workerId);
      if (taskId && taskId !== handle.taskId) throw new Error('knowledge reader task does not match worker ownership');
      taskId = handle.taskId;
    }
    return this._coordination.readKnowledge(query, {
      readerActor: actor,
      readerWorker: workerId,
      taskId,
      runId: reader.runId ?? null,
    }, { actor, key });
  }

  claimScratch(workerId, fields, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (!task || !['working', 'input_required'].includes(task.status)) return { ok: false, result: 'task_not_active' };
    if (opts.expectedFence === undefined) throw new TypeError('Scratch claim requires expectedFence');
    const check = this._fences.check(workerId, { fence: opts.expectedFence });
    if (!check.ok) return { ok: false, result: 'stale_fence', current: check.current };
    if (typeof opts.idempotencyKey !== 'string' || opts.idempotencyKey.length === 0) throw new TypeError('Scratch claim requires idempotencyKey');
    return this._coordination.claimScratch({
      ...fields,
      ownerWorker: workerId,
      ownerTask: task.id,
      fence: check.current.fence,
    }, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey });
  }

  postScratchFact(workerId, fields, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (!task || !['working', 'input_required'].includes(task.status)) return { ok: false, result: 'task_not_active' };
    if (opts.expectedFence === undefined) throw new TypeError('Scratch fact requires expectedFence');
    const check = this._fences.check(workerId, { fence: opts.expectedFence });
    if (!check.ok) return { ok: false, result: 'stale_fence', current: check.current };
    if (typeof opts.idempotencyKey !== 'string' || opts.idempotencyKey.length === 0) throw new TypeError('Scratch fact requires idempotencyKey');
    return this._coordination.postScratchFact({
      ...fields,
      ownerWorker: workerId,
      ownerTask: task.id,
      fence: check.current.fence,
    }, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey });
  }

  readScratch(workerId, resource, envRef, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    if (typeof opts.idempotencyKey !== 'string' || opts.idempotencyKey.length === 0) throw new TypeError('Scratch read requires idempotencyKey');
    return this._coordination.readScratch(resource, envRef, {
      readerActor: opts.actor ?? 'orchestrator', readerWorker: workerId,
      taskId: handle.taskId, runId: opts.runId ?? null,
    }, { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey });
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
    if (kind === 'lifecycle.turn_started') {
      handle.turnTerminalObserved = false;
      this._clearBudgetStop(handle);
    } else if (['lifecycle.turn_completed', 'lifecycle.crashed', 'lifecycle.exited'].includes(kind)) {
      handle.turnTerminalObserved = true;
      this._clearBudgetStop(handle);
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
        }
        const mismatchEvent = this._log.append({
          worker: workerId, harness, turnEpoch, kind: 'model.mismatch', actor: 'policy',
          modelRequested: handle.modelRequested ?? null, modelResolved: handle.modelResolved, modelObserved: observedModel,
          payload: { requested: handle.modelResolved, observed: observedModel, action: 'fail_and_kill' },
        });
        if (mismatchTask && !TERMINAL_TASK_STATUSES.has(mismatchTask.status)) {
          const evidence = this._coordMapEvent(mismatchEvent);
          this._coordTransition(mismatchTask, 'failed', `task.failed:${mismatchTask.id}:${mismatchEvent.seq}`, evidence);
          mismatchTask.status = 'failed';
        }
        // Use the ordinary confirmed two-phase stop so process/worktree ownership remains live
        // until the adapter proves the mismatched session is gone.
        this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      }
    }
    // Only an adapter's explicitly mapped native lifecycle/usage observation is authoritative.
    // In particular, worker result/content fields named `effort` are untrusted prose/data.
    const observedEffort = (actor === 'worker' && (kind === 'lifecycle.spawned' || kind === 'resource.tokens'))
      ? payload?.effortObserved : null;
    if (typeof observedEffort === 'string' && observedEffort.length > 0) {
      handle.effortObserved = observedEffort;
      const effortTask = this._tasks.get(handle.taskId);
      if (effortTask) effortTask.effortObserved = observedEffort;
      if (handle.effortResolved && observedEffort !== handle.effortResolved && !handle.effortMismatch) {
        handle.effortMismatch = { requested: handle.effortResolved, observed: observedEffort };
        const mismatchEvent = this._log.append({ worker: workerId, harness, turnEpoch, kind: 'effort.mismatch', actor: 'policy',
          effortRequested: handle.effortRequested, effortResolved: handle.effortResolved, effortObserved: observedEffort,
          payload: { requested: handle.effortResolved, observed: observedEffort, action: 'fail_and_kill' } });
        if (effortTask && !TERMINAL_TASK_STATUSES.has(effortTask.status)) {
          const evidence = this._coordMapEvent(mismatchEvent);
          this._coordTransition(effortTask, 'failed', `task.failed:${effortTask.id}:${mismatchEvent.seq}`, evidence);
          effortTask.status = 'failed';
        }
        this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      }
    }
    const attribution = {
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
    };
    const appendAttributed = (partial) => this._log.append({ ...partial, ...attribution });

    switch (kind) {
      case 'resource.tokens':
        this._recordUsage(handle, event);
        break;
      case 'lifecycle.turn_completed': {
        // Adapters may wrap the WorkerResult as { result } (MockAdapter) or emit it directly
        // (coordinator.test). Normalize so the logged claim and the gate both see the WorkerResult.
        const wr = (payload && payload.result !== undefined && payload.status === undefined) ? payload.result : payload;
        appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload: wr });
        this._clearWatchdog(handle);
        if (handle.status !== 'stopping' && handle.status !== 'dead') {
          this._runTrustGate(handle, wr).catch(noop);
        }
        break;
      }
      case 'lifecycle.crashed': {
        const terminalEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
          const evidence = this._coordMapEvent(terminalEvent);
          if (evidence) this._coordTransition(task, 'failed', `task.failed:${task.id}:${evidence.coordinationSeq}`, evidence);
        }
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        this._clearWatchdog(handle);
        // A crashed TURN does not prove a session-shaped adapter process exited. Codex app-server,
        // for example, reports quota/turn failures while its native child remains alive. Keep
        // ownership and runtime scope until the ordinary two-phase kill confirms transport death.
        if (handle.status !== 'dead' && handle.status !== 'stopping') this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
        break;
      }
      case 'lifecycle.exited': {
        const terminalEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
          const evidence = this._coordMapEvent(terminalEvent);
          if (evidence) this._coordTransition(task, 'failed', `task.failed:${task.id}:${evidence.coordinationSeq}`, evidence);
        }
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        if (handle.status !== 'dead') handle.status = 'exited';
        this._clearWatchdog(handle);
        this._removeRuntimeScope(handle);
        break;
      }
      case 'question.asked': {
        const requestId = payload?.requestId;
        const askedEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) break;
        const record = {
          kind: 'question',
          worker: workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: this._safeTurnEpoch(handle),
          deadlineAt: null,
        };
        const evidence = this._coordMapEvent(askedEvent);
        if (payload?.blocking !== false) {
          if (task) {
            this._coordTransition(task, 'input_required', `task.input_required:${task.id}:${askedEvent.seq}`, { ...evidence, interaction: { kind: 'question', requestId, blocking: true } });
          }
        } else {
          this._coordRecord('input.requested', { taskId: task?.id ?? null, workerId, kind: 'question', requestId, blocking: false, evidence }, `driver.input_requested:${handle.taskId}:${askedEvent.seq}`, actor ?? 'worker');
        }
        this._pending.set(requestId, record);
        if (payload?.blocking !== false) {
          handle.status = 'blocked';
          handle.pendingQuestionId = requestId;
          if (task) task.status = 'input_required';
        }
        break;
      }
      case 'approval.requested': {
        const requestId = payload?.requestId;
        const askedEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && TERMINAL_TASK_STATUSES.has(task.status)) break;
        const record = {
          kind: 'approval',
          worker: workerId,
          state: 'pending',
          resolution: null,
          consumer: null,
          turnEpochAtAsk: this._safeTurnEpoch(handle),
          deadlineAt: this._now() + this._approvalTimeoutMs,
        };
        const evidence = this._coordMapEvent(askedEvent);
        if (payload?.blocking !== false) {
          if (task) {
            this._coordTransition(task, 'input_required', `task.input_required:${task.id}:${askedEvent.seq}`, { ...evidence, interaction: { kind: 'approval', requestId, blocking: true } });
          }
        } else {
          this._coordRecord('input.requested', { taskId: task?.id ?? null, workerId, kind: 'approval', requestId, blocking: false, evidence }, `driver.input_requested:${handle.taskId}:${askedEvent.seq}`, actor ?? 'worker');
        }
        this._pending.set(requestId, record);
        if (payload?.blocking !== false) {
          handle.status = 'blocked';
          handle.pendingApprovalId = requestId;
          if (task) task.status = 'input_required';
        }
        break;
      }
      case 'question.answered':
      case 'approval.resolved': {
        const resolvedEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        if (task && this._coordination?.task(task.id)?.status === 'input_required') {
          const evidence = this._coordMapEvent(resolvedEvent);
          this._coordTransition(task, 'working', `task.working:${task.id}:${resolvedEvent.seq}`, evidence, actor ?? 'worker');
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
    this._observeWatchdogEvent(handle, event);
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
    let baseVerifyPath = null;
    let trustPhase = 'capture';
    try {
      // C5: thread the dispatching vendor through to captureCommit so the snapshot
      // commit (when one is made) is genuinely attributed.
      const captured = await this._worktrees.capture(handle.worktree ?? task.worktree, {
        vendor: handle.vendor,
        model: handle.modelObserved ?? handle.modelResolved,
        ...((handle.effortObserved ?? handle.effortResolved) ? { effort: handle.effortObserved ?? handle.effortResolved } : {}),
      });
      const sha = captured && captured.sha;
      const created = await this._worktrees.createVerifyWorktree(task.id, sha);
      verifyPath = created && created.path;

      const baseSha = task.sessionContext?.baseSha ?? null;
      if (this._acceptOpts.requireRedGreen && baseSha && typeof this._worktrees.createBaseVerifyWorktree === 'function') {
        const baseCreated = await this._worktrees.createBaseVerifyWorktree(task.id, baseSha);
        baseVerifyPath = baseCreated?.path ?? null;
      }
      if (this._acceptOpts.requireCoverage && baseSha && sha && typeof this._worktrees.changedLines === 'function') {
        task.changedLines = await this._worktrees.changedLines(baseSha, sha);
      }

      const verdict = await this._referee(task, workerResult, {
        pinnedVerification: task.brief.verification,
        sandbox: verifyPath,
        baseSandbox: baseVerifyPath,
      });

      task.verdict = verdict;
      // C1: referee.accept() (or an injected equivalent) is the SOLE done-gate.
      const acceptOpts = { ...this._acceptOpts, expectExit: task.brief.verification.expectExit };
      const accept = this._accept(verdict, acceptOpts);
      const verifyEvent = this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'verify.reverified',
        actor: 'policy',
        modelRequested: handle.modelRequested ?? null,
        modelResolved: handle.modelResolved ?? null,
        modelObserved: handle.modelObserved ?? null,
        effortRequested: handle.effortRequested ?? null,
        effortResolved: handle.effortResolved ?? null,
        effortObserved: handle.effortObserved ?? null,
        routeKey: handle.routeKey ?? null,
        payload: {
          verdict,
          accept,
          acceptOpts: {
            requireRedGreen: this._acceptOpts.requireRedGreen ?? false,
            requireCoverage: this._acceptOpts.requireCoverage ?? false,
            requireMutation: this._acceptOpts.requireMutation ?? false,
          },
          capture: {
            sha: captured && captured.sha, snapshotted: captured && captured.snapshotted,
            vendor: handle.vendor ?? null, model: handle.modelObserved ?? handle.modelResolved ?? null,
            effort: handle.effortObserved ?? handle.effortResolved ?? null,
            routeKey: handle.routeKey ?? null,
          },
        },
      });
      if (!verifyEvent) throw new Error('operational verification event was not durably appended');
      trustPhase = 'evidence_mapping';
      const evidence = this._coordMapEvent(verifyEvent);
      const manifests = [];
      if (captured?.sha) {
        manifests.push({
          taskId: task.id, kind: 'commit', refs: { sha: captured.sha }, mediaType: 'application/vnd.git.commit',
          accepted: accept, provenance: [evidence],
        });
        if (task.review) {
          manifests.push({
            taskId: task.id, kind: 'review', refs: { sha: captured.sha, parentTaskId: task.review.parentTaskId },
            mediaType: 'application/vnd.baton.review+json', accepted: accept,
            provenance: [evidence], review: task.review,
          });
        }
      }
      manifests.push({
        taskId: task.id, kind: 'verification', refs: { worker: handle.id, workerSeq: verifyEvent.seq },
        mediaType: 'application/vnd.baton.verdict+json', accepted: accept,
        provenance: [evidence], verdict,
      });
      if ((workerResult?.artifacts?.files?.length ?? 0) > 0 || (workerResult?.artifacts?.commits?.length ?? 0) > 0) {
        const claimEvent = this._log.read(handle.id).filter((event) => event.kind === 'lifecycle.turn_completed').at(-1);
        const claimEvidence = this._coordMapEvent(claimEvent);
        manifests.push({
          taskId: task.id, kind: 'report', refs: { claimedArtifacts: workerResult.artifacts },
          mediaType: 'application/vnd.baton.worker-artifact-claim+json', accepted: false,
          provenance: claimEvidence ? [claimEvidence] : [], grounding: 'worker_prose',
        });
      }
      const terminalStatus = accept ? 'completed' : 'failed';
      trustPhase = 'terminal_batch';
      const terminal = this._coordination.transitionTaskWithArtifacts(
        task.id, terminalStatus, task.coordinationVersion,
        manifests, { actor: 'policy', key: `task.${terminalStatus}:${task.id}:${verifyEvent.seq}` }, evidence,
      );
      task.coordinationVersion = terminal.task.version;
      this._expireScratchClaims(handle, task, `task_${terminalStatus}`);
      const artifactEvidence = terminal.artifacts.map((artifact) => ({ artifactId: artifact.id }));
      trustPhase = 'promotion';
      this._coordination.promoteKnowledgeNode({
        id: `outcome:${task.id}:${verifyEvent.seq}`,
        type: accept ? 'Finding' : 'Counterexample',
        body: accept ? `Task ${task.id} passed its hub verification` : `Task ${task.id} failed its hub verification`,
        grounding: 'verified', evidence: [{ coordinationSeq: evidence.coordinationSeq }, ...artifactEvidence],
      }, { kind: accept ? 'Finding' : 'Counterexample', trigger: 'verified_task_outcome' }, { actor: 'policy', key: `knowledge.outcome:${task.id}:${verifyEvent.seq}` });
      trustPhase = 'complete';
      task.status = accept ? 'completed' : 'failed';
      task.capturedSha = captured?.sha ?? null;

      if (task.review?.parentWorkerId) {
        const parentHandle = this._workers.get(task.review.parentWorkerId);
        if (parentHandle) {
          this._log.append({
            worker: parentHandle.id,
            harness: this._harnessOf(parentHandle.vendor),
            turnEpoch: this._safeTurnEpoch(parentHandle),
            kind: accept ? 'review.completed' : 'review.failed',
            actor: 'policy',
            payload: {
              ...task.review,
              reviewerWorkerId: handle.id,
              reviewerModelResolved: handle.modelResolved ?? null,
              reviewerModelObserved: handle.modelObserved ?? null,
              reviewerEffortResolved: handle.effortResolved ?? null,
              reviewerEffortObserved: handle.effortObserved ?? null,
              reviewerRouteKey: handle.routeKey ?? null,
              accepted: accept,
            },
          });
        }
      }

      if (this._route && typeof this._route.record === 'function') {
        const card = this._adapters[handle.vendor]?.card();
        try {
          this._route.record(task.routeKey ?? routeTupleKey(card, handle.modelResolved, handle.effortResolved, task.taskType), task.taskType ?? 'general', accept);
        } catch {
          // never let a broken router affect coordinator correctness
        }
      }
    } catch (err) {
      const errorEvent = this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'error',
        actor: 'policy',
        payload: { message: String((err && err.message) || err), phase: 'trust_gate', trustPhase },
      });
      let durable = this._coordination.task(task.id);
      if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
        try {
          const evidence = this._coordMapEvent(errorEvent);
          const transitioned = this._coordination.transitionTask(task.id, 'failed', durable.version, {
            actor: 'policy', key: `task.failed:${task.id}:trust_gate:${errorEvent.seq}`,
          }, evidence ?? { reason: 'trust_gate_exception', trustPhase });
          task.coordinationVersion = transitioned.task.version;
          durable = transitioned.task;
        } catch (coordinationError) {
          this._poisonCoordination(coordinationError);
          durable = this._coordination.task(task.id);
        }
      }
      if (['evidence_mapping', 'terminal_batch', 'promotion'].includes(trustPhase)) this._poisonCoordination(err);
      task.status = durable?.status ?? 'failed';
      if (task.status !== 'completed') task.verdict = null;
    } finally {
      if (verifyPath != null) await this._worktrees.removeVerifyWorktree(verifyPath);
      if (baseVerifyPath != null) await this._worktrees.removeVerifyWorktree(baseVerifyPath);
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
      let refinementAborted = false;
      let vendorRequested = null;
      let vendorResolved = null;
      let modelRequested = null;
      let modelResolved = null;
      let modelObserved = null;
      let modelPolicy = null;
      let modelMismatch = null;
      let effortRequested = null;
      let effortResolved = null;
      let effortObserved = null;
      let effortMismatch = null;
      let routeKey = null;
      let sessionRequest = Object.freeze({ mode: 'new' });
      let sessionRef = null;
      let sessionContext = null;
      let lineage = null;
      let capturedSha = null;
      let integration = null;
      let retainedResultRef = null;
      let publication = null;
      let review = null;
      const budgetUsed = { tokens: 0, usd: 0 };
      const budgetThresholdsFired = new Set();
      const usageCumulative = new Map();

      for (const e of events) {
        if (typeof e.turnEpoch === 'number' && e.turnEpoch > maxTurnEpoch) maxTurnEpoch = e.turnEpoch;
        const publicationMatch = /^publication-w-\d+-(\d+)$/.exec(e.payload?.requestId ?? '');
        if (publicationMatch) this._publicationSeq = Math.max(this._publicationSeq, Number(publicationMatch[1]));
        modelRequested = e.modelRequested ?? modelRequested;
        modelResolved = e.modelResolved ?? modelResolved;
        modelObserved = e.modelObserved ?? modelObserved;
        effortRequested = e.effortRequested ?? (e.kind === 'lifecycle.spawned' ? e.payload?.effortRequested : null) ?? effortRequested;
        effortResolved = e.effortResolved ?? (e.kind === 'lifecycle.spawned' ? e.payload?.effortResolved : null) ?? effortResolved;
        effortObserved = e.effortObserved
          ?? (e.actor === 'worker' && (e.kind === 'lifecycle.spawned' || e.kind === 'resource.tokens') ? e.payload?.effortObserved : null)
          ?? effortObserved;
        routeKey = e.routeKey ?? e.payload?.routeKey ?? routeKey;
        if (e.kind === 'model.mismatch') modelMismatch = e.payload ?? modelMismatch;
        if (e.kind === 'effort.mismatch') effortMismatch = e.payload ?? effortMismatch;
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
            review = e.payload?.review ?? review;
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
          case 'resource.tokens':
            budgetUsed.tokens += Number(e.payload?.tokens ?? 0);
            budgetUsed.usd += Number(e.payload?.usd ?? 0);
            if (e.payload?.wireAccounting === 'cumulative') {
              const source = e.payload?.source ?? 'unknown';
              usageCumulative.set(`${source}:tokens`, Number(e.payload?.wireTokens ?? 0));
              usageCumulative.set(`${source}:usd`, Number(e.payload?.wireUsd ?? 0));
            }
            break;
          case 'resource.budget_threshold':
            if (typeof e.payload?.threshold === 'number') budgetThresholdsFired.add(e.payload.threshold);
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
              capturedSha = e.payload?.capture?.sha ?? capturedSha;
            }
            break;
          case 'integration.completed':
            if (this._coordination?.integrationAuthority(taskId, e)) {
              integration = e.payload ?? integration;
              retainedResultRef = null;
            }
            break;
          case 'integration.refused':
            retainedResultRef = e.payload?.retainedResultRef ?? retainedResultRef;
            break;
          case 'publication.completed':
            // Operational completion follows an outside effect, but it is not authoritative by
            // itself. The publication decision and driver completion are an atomic coordination
            // batch; absence of that decision means replay must report outcome unknown, never
            // fabricate a successful publication from the telemetry stream.
            if (this._coordination?.publicationAuthority(taskId, e)) publication = e.payload ?? publication;
            break;
          case 'lifecycle.crashed':
          case 'control.forced_stop':
          case 'control.recovery_terminalized':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'failed';
            break;
          case 'control.refinement_aborted':
            refinementAborted = true;
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

      // A persistent worker can own a chain of immutable refinement tasks. Only the first turn
      // carries lifecycle.spawned.taskId; later native turns deliberately reuse the same worker
      // and wire session. The coordination stream is authoritative for which refinement is
      // current after restart, so associate the replayed terminal/result state with the newest
      // durable task reserved for this worker instead of silently snapping back to turn one.
      const durableWorkerTasks = this._coordination?.snapshot().tasks
        .filter((task) => (task.reservedWorkerId ?? task.assignee) === workerId)
        .sort((a, b) => a.createdEvent - b.createdEvent) ?? [];
      const currentDurableTask = durableWorkerTasks.at(-1) ?? null;
      if (currentDurableTask) taskId = currentDurableTask.id;

      // Operational completion without its authoritative coordination terminal batch is a crash
      // gap, never permission to infer success from telemetry. Fail the claimed task durably so a
      // restart cannot leave it working forever or fabricate its missing accepted manifests.
      if (currentDurableTask && !TERMINAL_TASK_STATUSES.has(currentDurableTask.status)
        && TERMINAL_TASK_STATUSES.has(terminalStatus)) {
        recoveryTerminalized = true;
        const priorOperationalStatus = terminalStatus;
        terminalStatus = 'failed';
        const gapEvent = this._log.append({
          worker: workerId, harness: events.at(-1)?.harness ?? '', turnEpoch: maxTurnEpoch,
          kind: 'control.recovery_terminalized', actor: 'policy',
          payload: { reason: 'coordination_terminal_batch_missing', priorStatus: priorOperationalStatus },
        });
        const gapEvidence = this._coordMapEvent(gapEvent);
        const transitioned = this._coordination.transitionTask(currentDurableTask.id, 'failed', currentDurableTask.version, {
          actor: 'policy', key: `task.failed:${currentDurableTask.id}:coordination_gap:${gapEvent.seq}`,
        }, gapEvidence ?? { reason: 'coordination_terminal_batch_missing' });
        const seeded = this._tasks.get(currentDurableTask.id);
        if (seeded) seeded.coordinationVersion = transitioned.task.version;
      }

      // CI6: replay cannot resurrect an adapter session. Until the persistent-session phase can
      // prove native reattachment, any nonterminal reconstructed task is durably failed and its
      // worker is marked orphaned (uncontrollable), never presented as working/input_required.
      if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) {
        recoveryTerminalized = true;
        terminalStatus = 'failed';
        const recoveryEvent = this._log.append({
          worker: workerId,
          harness: events.at(-1)?.harness ?? '',
          turnEpoch: maxTurnEpoch,
          kind: 'control.recovery_terminalized',
          actor: 'policy',
          payload: { reason: 'session_not_reattached', priorStatus: events.at(-1)?.kind ?? 'unknown' },
        });
        const durable = taskId ? this._coordination?.task(taskId) : null;
        if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
          const evidence = this._coordMapEvent(recoveryEvent);
          const transitioned = this._coordination.transitionTask(taskId, 'failed', durable.version, {
            actor: 'policy', key: `task.failed:${taskId}:replay:${recoveryEvent?.seq ?? maxTurnEpoch}`,
          }, evidence ?? { reason: 'session_not_reattached' });
          const seeded = this._tasks.get(taskId);
          if (seeded) {
            seeded.coordinationVersion = transitioned.task.version;
            this._expireScratchClaims(this._workers.get(workerId), seeded, 'replay_failed');
          }
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
          vendorRequested,
          modelRequested,
          modelResolved,
          modelObserved,
          modelPolicy,
          modelMismatch,
          effortRequested,
          effortResolved,
          effortObserved,
          effortMismatch,
          routeKey,
          sessionRequest,
          sessionRef,
          sessionContext,
          lineage,
          capturedSha,
          integration,
          retainedResultRef,
          publication,
          review,
        };
        const durable = this._coordination?.task(taskId);
        task.assignee = durable?.reservedWorkerId ?? workerId;
        task.deps = durable ? [...durable.deps] : task.deps;
        task.coordinationVersion = durable?.version ?? task.coordinationVersion ?? null;
        task.status = durable?.status ?? terminalStatus;
        task.result = lastResult ?? task.result;
        task.verdict = verdict ?? task.verdict;
        task.sessionRequest = sessionRequest;
        task.sessionRef = sessionRef;
        task.sessionContext = sessionContext;
        task.lineage = lineage;
        task.capturedSha = capturedSha;
        task.integration = integration;
        task.retainedResultRef = retainedResultRef;
        task.publication = publication;
        task.review = review;
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
        effortRequested,
        effortResolved,
        effortObserved,
        effortMismatch,
        routeKey,
        sessionRequest,
        sessionRef,
        sessionContext,
        lineage,
        taskId,
        worktree: sessionContext?.worktree ?? null,
        // A durable native reference is not a live transport. Even a terminal task that was
        // reusable before restart must remain uncontrollable until PS7 proves reattachment.
        status: (recoveryTerminalized || refinementAborted || sessionRef) ? 'orphaned' : this._deriveWorkerStatus(terminalStatus),
        pendingApprovalId: null,
        pendingQuestionId: null,
        budgetUsed,
        budgetThresholdsFired,
        usageCumulative,
        budgetStopTimer: null,
        turnTerminalObserved: false,
        watchdogActions: new Set(),
        recentFailedActions: [],
        watchdogGeneration: 0,
        watchdogTimer: null,
        runtimeScope: null,
        runtimeLease: null,
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

  _terminalizeUnattachedCoordinationTasks() {
    if (!this._coordination) return;
    for (const durable of this._coordination.snapshot().tasks) {
      if (!['working', 'input_required'].includes(durable.status)) continue;
      const workerId = durable.assignee ?? durable.reservedWorkerId;
      const events = workerId ? this._log.read(workerId) : [];
      if (events.some((event) => event.kind === 'lifecycle.spawned')) continue;
      const recorded = this._coordRecord('recovery.claimed_without_spawn', { taskId: durable.id, workerId }, `driver.recovery:${durable.id}:claimed_without_spawn`);
      const transitioned = this._coordination.transitionTask(durable.id, 'failed', durable.version, {
        actor: 'policy', key: `task.failed:${durable.id}:claimed_without_spawn`,
      }, { coordinationSeq: recorded?.seq ?? null, reason: 'claimed_without_operational_spawn' });
      const task = this._tasks.get(durable.id);
      if (task) {
        task.status = 'failed'; task.coordinationVersion = transitioned.task.version;
        this._expireScratchClaims(this._workers.get(workerId), task, 'claimed_without_spawn');
      }
      const handle = workerId ? this._workers.get(workerId) : null;
      if (handle) handle.status = 'exited';
    }
  }
}
