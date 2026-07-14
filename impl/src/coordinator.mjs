// coordinator.mjs — the main loop and the 8 commands (spawn/send/wait/respond/interrupt/
// result/list/kill). Owns the worker pool, dispatches ready tasks, carries commands
// reliably (fence-checked), enforces two-phase stop, single-consumer approvals, and the
// trust gate. See spec/IMPLEMENTATION.md (CLUSTER 1 — CORE) and spec/RECONCILIATION.md
// (D1/D9/D10/D11), which is authoritative over any conflicting cluster spec.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Cursor } from './log.mjs';
import { createBrief, createDigest, wrapFact, wrapProse } from './messages.mjs';
import { resolveEffort, routeTupleKey } from './route-tuple.mjs';
import { hasNorthboundCapabilityAuthority } from './northbound-capability-authority.mjs';
import { processReadyPayload, validProcessClosedPayload, validProcessReadyPayload, validProcessReapUnconfirmedPayload, validProcessStartedPayload } from './process-lifecycle.mjs';
import { normalizeProviderGovernancePolicy, providerGovernanceRoute, validateProviderGovernanceCard } from './provider-governance.mjs';
import { normalizePhysicalOwnerId, normalizeSparseCheckoutIdentity, normalizeSparsePaths, sparseCheckoutIdentity } from './worktree.mjs';
import { GoalPlanValidationError, goalPlanDigest, normalizeGoalPlanContext, planBriefMatches } from './goal-plan.mjs';
import { addUsd, subtractUsdFloor, usdFromNanos, usdToNanos } from './usd.mjs';

const ORIENTATION_DELIVERY = Symbol('orientation-delivery');
const WORKTREE_FAILURE = Symbol('worktree-failure');
const PHYSICAL_LOG_APPENDS = new WeakMap();
const LOGICAL_CALL_PHASES = new Set(['requested', 'progress', 'completed', 'failed', 'cancelled']);

function validLogicalCallId(value) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value) <= 256 && !value.includes('\0');
}

function validLogicalCallPhase(value) {
  return typeof value === 'string' && LOGICAL_CALL_PHASES.has(value);
}

function logicalCallTransition(prior, next) {
  if (prior === undefined) return next === 'progress' ? 'invalid' : 'new';
  if (next === 'requested') return 'invalid';
  if (['completed', 'failed', 'cancelled'].includes(prior)) {
    return prior === next ? 'duplicate' : 'invalid';
  }
  if (next === 'progress') return 'progress';
  return 'terminal';
}

function boundedProcessObservation(event, code, extra = {}) {
  const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  const payloadKeys = Object.keys(payload).sort().slice(0, 24);
  const shape = payloadKeys.map((key) => `${key}:${Array.isArray(payload[key]) ? 'array' : typeof payload[key]}`);
  const correlation = {};
  for (const key of ['schemaVersion', 'generation', 'processGeneration', 'pid', 'processGroupId', 'ready', 'phase', 'reason']) {
    const value = payload[key];
    if (typeof value === 'boolean' || Number.isSafeInteger(value)
      || (typeof value === 'string' && value.length <= 32 && /^[a-z0-9_.-]+$/iu.test(value))) correlation[key] = value;
  }
  return {
    code,
    observedKind: typeof event?.kind === 'string' ? event.kind.slice(0, 64) : null,
    payloadKeys,
    shapeDigest: createHash('sha256').update(shape.join('\0')).digest('hex'),
    correlation,
    ...extra,
  };
}

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

function canonicalActionPath(path) {
  let existing = resolve(path); const suffix = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    suffix.unshift(basename(existing));
    existing = parent;
  }
  try { return resolve(realpathSync(existing), ...suffix); }
  catch { return resolve(path); }
}

// SC13: cancellation is terminal too. No late spawn/delivery/turn continuation may revive it.
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const COORDINATION_MUTATORS = new Set([
  'createTask', 'claimTask', 'transitionTask', 'transitionTaskWithArtifacts', 'mapOperationalEvent',
  'createAndClaimRecoveryRefinement', 'recordRecoveryContinuationIntent', 'completeRecoveryDispatch',
  'recordDriver', 'completeIntegration', 'completePublication', 'registerArtifact', 'supersedeArtifact', 'claimScratch', 'postScratchFact',
  'readScratch', 'expireScratchClaim', 'expireScratchFact', 'addKnowledgeNode', 'promoteKnowledgeNode',
  'addKnowledgeEdge', 'readKnowledge', 'invalidateKnowledge', 'recordContamination', 'recordReuseDecision',
  'recordReuseRiskGuard', 'recordReuseTtlInvalidation', 'activateReusePolicy', 'recordProviderDelivery', 'recordProviderGreenCompletion', 'recordProviderAdverseCompletion', 'recordProviderSourceReconciliation', 'recordProviderProcessingDeferral',
  'admitFleetDrain', 'recordFleetDrainDisposition', 'completeFleetDrain',
  'recordRepresentationProduction',
  'defineGoal', 'proposePlan', 'approvePlan', 'createPlanGatedTask',
]);

const DEFAULT_DRAIN_POLICY = Object.freeze({ maxWorkers: 1024, maxInteractions: 15_000, timeoutMs: 60_000, pollMs: 10 });

function normalizeDrainPolicy(value) {
  if (value === undefined) return DEFAULT_DRAIN_POLICY;
  const fields = ['maxWorkers', 'pollMs', 'timeoutMs'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || fields.some((field) => !Number.isSafeInteger(value[field]) || value[field] <= 0)
    || value.maxWorkers > 100_000 || value.timeoutMs > 300_000 || value.pollMs > value.timeoutMs) {
    throw new TypeError('drain policy must be a closed bounded deployment policy');
  }
  return Object.freeze({
    maxWorkers: value.maxWorkers,
    maxInteractions: Math.min(100_000, value.maxWorkers * 16, Math.max(1, Math.floor(value.timeoutMs / 4))),
    timeoutMs: value.timeoutMs,
    pollMs: value.pollMs,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function canonicalDigest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function replayProviderGovernanceRoute(event, vendor, model, effort) {
  const payload = event?.payload;
  const reserve = payload?.reserve;
  if (typeof vendor !== 'string' || vendor.length === 0 || Buffer.byteLength(vendor) > 128
    || typeof model !== 'string' || model.length === 0 || Buffer.byteLength(model) > 128
    || typeof effort !== 'string' || effort.length === 0 || Buffer.byteLength(effort) > 128
    || !['strict', 'observe'].includes(payload?.mode)
    || !reserve || typeof reserve !== 'object' || Array.isArray(reserve)
    || Object.keys(reserve).sort().join(',') !== 'tokens,usd'
    || !Number.isSafeInteger(reserve.tokens) || reserve.tokens < 0
    || usdToNanos(reserve.usd) === null
    || !/^[a-f0-9]{64}$/u.test(payload?.policyDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(payload?.routeDigest ?? '')) return null;
  const route = {
    harness: vendor,
    model,
    effort,
    terminalReserve: { tokens: reserve.tokens, usd: usdFromNanos(usdToNanos(reserve.usd)) },
    mode: payload.mode,
  };
  if (canonicalDigest(route) !== payload.routeDigest) return null;
  return {
    route: deepFreeze({ ...route, digest: payload.routeDigest }),
    policyDigest: payload.policyDigest,
  };
}
function providerProcessingFailureCode(error) {
  if (['provider_index_changed', 'reuse_policy_reconciliation_required', 'reuse_evidence_diverged'].includes(error?.code)) return error.code;
  if (typeof error?.code === 'string' && error.code.startsWith('capability_')) return 'capability_refused';
  return 'provider_processing_failed';
}
function throwIfProviderCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('provider processing cancelled'), { code: 'cancelled' });
}
function officialCoordinateMatches(identity, coordinate) {
  if (!identity || !coordinate) return false;
  const fields = Object.keys(identity).sort().join(',');
  if (!['ecosystem,package,version', 'ecosystem,package,system,version'].includes(fields)) return false;
  return identity.ecosystem === coordinate.ecosystem && identity.package === coordinate.package && identity.version === coordinate.version
    && (!Object.hasOwn(identity, 'system') || (coordinate.ecosystem === 'npm' && identity.system === 'NPM'));
}
function normalizedDecisionText(value, field, maxBytes) {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value) > maxBytes || value.includes('\0')) {
    const error = new TypeError(`reuse decision ${field} is invalid`); error.code = 'invalid_reuse_decision'; throw error;
  }
  return value.trim().replace(/\s+/g, ' ');
}
function decisionRef(ref, kind, mediaType) {
  if (!ref || ref.kind !== kind || ref.mediaType !== mediaType || !/^[a-f0-9]{64}$/.test(ref.digest ?? '')
    || ref.handle !== `art:sha256:${ref.digest}` || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) {
    const error = new TypeError('reuse decision evidence reference is invalid'); error.code = 'reuse_evidence_invalid'; throw error;
  }
  return { kind, handle: ref.handle, digest: ref.digest, bytes: ref.bytes, mediaType };
}

function minimalBrief() {
  return { goal: '', constraints: [], pathScope: [], definitionOfDone: '', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 0, usd: 0, wallMin: 0 } };
}

function noop() {}

function normalizeRunId(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
    const error = new TypeError('runId must be a bounded identifier');
    error.code = 'invalid_run_id';
    throw error;
  }
  return value;
}

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
  if (mode !== 'new' && (typeof request.id !== 'string' || request.id.length === 0
    || Buffer.byteLength(request.id) > 4_096 || request.id.includes('\0'))) {
    throw new SessionSelectionError(`session.${mode} requires a bounded non-empty id`, 'invalid_session_request');
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
    let sparsePaths;
    if (request.context.sparsePaths !== undefined) {
      try {
        sparsePaths = normalizeSparsePaths(request.context.sparsePaths);
      } catch (cause) {
        throw Object.assign(new SessionSelectionError('session.context.sparsePaths must be a bounded array of safe relative literals', 'invalid_session_request'), { cause });
      }
    }
    let sparseIdentity;
    if (request.context.sparseCheckoutIdentity !== undefined) {
      try { sparseIdentity = normalizeSparseCheckoutIdentity(request.context.sparseCheckoutIdentity); }
      catch (cause) { throw Object.assign(new SessionSelectionError('session.context.sparseCheckoutIdentity is invalid', 'invalid_session_request'), { cause }); }
    } else if (sparsePaths) sparseIdentity = sparseCheckoutIdentity(sparsePaths);
    if (sparsePaths && sparseIdentity && JSON.stringify(sparsePaths) !== JSON.stringify(sparseIdentity.paths)) {
      throw new SessionSelectionError('session sparse paths disagree with their identity', 'invalid_session_request');
    }
    let toolchainProjection;
    if (request.context.toolchainProjection !== undefined) {
      try {
        if (!request.context.toolchainProjection || typeof request.context.toolchainProjection !== 'object' || Array.isArray(request.context.toolchainProjection)) throw new Error();
        toolchainProjection = Object.freeze(JSON.parse(JSON.stringify(request.context.toolchainProjection)));
      } catch (cause) {
        throw Object.assign(new SessionSelectionError('session.context.toolchainProjection is invalid', 'invalid_session_request'), { cause });
      }
    }
    let capacityReservation;
    if (request.context.capacityReservation !== undefined) {
      try {
        const candidate = request.context.capacityReservation;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error();
        capacityReservation = Object.freeze(JSON.parse(JSON.stringify(candidate)));
      } catch (cause) {
        throw Object.assign(new SessionSelectionError('session.context.capacityReservation is invalid', 'invalid_session_request'), { cause });
      }
    }
    context = Object.freeze({
      worktree: request.context.worktree,
      ...(request.context.repoRoot ? { repoRoot: request.context.repoRoot } : {}),
      ...(request.context.baseSha ? { baseSha: request.context.baseSha } : {}),
      ...(request.context.branch ? { branch: request.context.branch } : {}),
      ...(request.context.ownerTaskId ? { ownerTaskId: request.context.ownerTaskId } : {}),
      ...(sparsePaths ? { sparsePaths } : {}),
      ...(sparseIdentity ? { sparseCheckoutIdentity: sparseIdentity } : {}),
      ...(toolchainProjection ? { toolchainProjection } : {}),
      ...(capacityReservation ? { capacityReservation } : {}),
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
    for (const method of ['snapshot', 'task', 'integrationAuthority', 'publicationAuthority', 'createTask', 'claimTask', 'transitionTask', 'transitionTaskWithArtifacts', 'createAndClaimRecoveryRefinement', 'recordRecoveryContinuationIntent', 'completeRecoveryDispatch', 'mapOperationalEvent', 'recordDriver', 'completeIntegration', 'completePublication', 'registerArtifact', 'artifact', 'recordReuseDecision', 'reuseDecision', 'reuseDecisionAdmission', 'reusePolicyState', 'activateReusePolicy', 'reuseRiskGuard', 'recordReuseRiskGuard', 'reuseRiskAdmission', 'recordReuseTtlInvalidation', 'reuseTtlAdmission', 'claimScratch', 'postScratchFact', 'readScratch', 'activeScratchClaims', 'expireScratchClaim', 'addKnowledgeNode', 'promoteKnowledgeNode', 'readKnowledge']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`Coordinator coordination store is missing ${method}()`);
    }
    this._closed = false;
    this._drainState = 'open';
    this._drainPolicy = normalizeDrainPolicy(opts.drainPolicy);
    this._drainPromise = null;
    this._drainReceipt = null;
    this._drainRequestPromises = new Map();
    this._drainTargetIds = null;
    this._drainPhysicalId = null;
    this._drainPhysicalActor = null;
    this._drainKillToken = Object.freeze({});
    this._drainHistoricalReconciled = false;
    this._drainHistoricalReconcilePromise = null;
    this._authorityOps = 0;
    this._authorityTokens = new Set();
    // Keep coordinator-local health/attribution wrappers on a facade. Reusing one Log across a
    // restart must not stack controller closures on the shared writer and let the prior
    // controller overwrite the fresh controller's task/run attribution.
    const rawLog = opts.log;
    const physicalLogAppend = PHYSICAL_LOG_APPENDS.get(rawLog) ?? rawLog.append.bind(rawLog);
    if (!PHYSICAL_LOG_APPENDS.has(rawLog)) PHYSICAL_LOG_APPENDS.set(rawLog, physicalLogAppend);
    this._log = new Proxy({}, {
      get: (target, property, receiver) => {
        if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver);
        const value = property === 'append' ? physicalLogAppend : Reflect.get(rawLog, property, rawLog);
        if (typeof value !== 'function') return value;
        const bound = value.bind(rawLog);
        return property === 'append' ? (...args) => {
          if (this._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' });
          return bound(...args);
        } : bound;
      },
      set: (target, property, value, receiver) => Reflect.set(target, property, value, receiver),
    });
    this._fences = opts.fences;
    this._adapters = opts.adapters;
    this._providerGovernance = opts.providerGovernance === undefined
      ? null
      : normalizeProviderGovernancePolicy(opts.providerGovernance, Object.keys(this._adapters));
    if (this._providerGovernance) {
      for (const adapter of Object.values(this._adapters)) validateProviderGovernanceCard(adapter.card());
      if (typeof opts.coordination.revokeTaskAcceptance !== 'function') throw new TypeError('Coordinator coordination store is missing revokeTaskAcceptance()');
    }
    this._worktrees = opts.worktrees;
    this._runtimeScopes = opts.runtimeScopes ?? null;
    this._capabilities = opts.capabilities ?? null;
    if (this._capabilities) {
      for (const method of ['cards', 'invoke', 'resume', 'reverify']) {
        if (typeof this._capabilities[method] !== 'function') {
          throw new TypeError(`Coordinator capability registry is missing ${method}()`);
        }
      }
    }
    this._advisoryFeeds = opts.advisoryFeeds ?? null;
    const advisoryCards = this._advisoryFeeds?.cards?.() ?? [];
    if (advisoryCards.length > 0) {
      if (typeof this._advisoryFeeds.verify !== 'function') throw new TypeError('Coordinator advisory feed registry is missing verify()');
      for (const method of ['recordProviderDelivery', 'pendingProviderReconciliation', 'providerReceipt', 'providerProcessing']) {
        if (typeof opts.coordination[method] !== 'function') throw new TypeError(`Coordinator coordination store is missing ${method}()`);
      }
      if (advisoryCards.some((card) => card.modes.includes('poll'))) {
        if (typeof this._advisoryFeeds.pollFull !== 'function' || typeof this._advisoryFeeds.reverifyPollSync !== 'function') throw new TypeError('Coordinator advisory feed registry is missing poll authority');
        for (const method of ['providerSourceHealth', 'recordProviderSourceReconciliation']) if (typeof opts.coordination[method] !== 'function') throw new TypeError(`Coordinator coordination store is missing ${method}()`);
      }
    }
    this._providerReconciliation = null;
    if (opts.providerReconciliation !== undefined) {
      const config = opts.providerReconciliation; const authority = config?.indexAuthority; const card = authority?.card?.();
      if (!config || Object.keys(config).sort().join(',') !== ['budgetTokens', 'indexAuthority', 'repoId'].sort().join(',') || !Number.isSafeInteger(config.budgetTokens) || config.budgetTokens <= 0
        || typeof config.repoId !== 'string' || !authority || typeof authority.current !== 'function' || typeof authority.reverify !== 'function'
        || !card || Object.keys(card).sort().join(',') !== ['schemaVersion', 'authorityId', 'repoId', 'atlasCardDigest'].sort().join(',') || card.schemaVersion !== 1 || card.repoId !== config.repoId
        || typeof card.authorityId !== 'string' || !/^[a-f0-9]{64}$/.test(card.atlasCardDigest ?? '')) throw new TypeError('provider reconciliation requires deployment-owned index authority');
      const cq = this._capabilities?.cards?.().find((item) => item.name === 'cartographer-quartermaster');
      if (!cq?.ops?.['reuse.vet'] || cq.actions?.reverify !== true) throw new TypeError('provider reconciliation requires reverifiable Quartermaster reuse.vet');
      const activePolicy = opts.coordination.reusePolicyState(config.repoId);
      if (!cq.reusePolicy || !activePolicy || activePolicy.policyHash !== cq.reusePolicy.hash) throw new TypeError('provider reconciliation requires the active Quartermaster policy');
      for (const method of ['providerProcessingAdmission', 'recordProviderGreenCompletion', 'recordProviderAdverseCompletion', 'reusePolicyState']) if (typeof opts.coordination[method] !== 'function') throw new TypeError(`Coordinator coordination store is missing ${method}()`);
      this._providerReconciliation = Object.freeze({ repoId: config.repoId, budgetTokens: config.budgetTokens, indexAuthority: authority, card: Object.freeze({ ...card }) });
    }
    this._providerProcessingSchedule = null;
    this._providerProcessingScanActive = false;
    if (opts.providerProcessingSchedule !== undefined) {
      const config = opts.providerProcessingSchedule; const fields = ['repoId', 'intervalMs', 'maxBatch', 'maxAttempts', 'initialBackoffMs', 'maxBackoffMs', 'maxStateRows'];
      if (!config || Object.keys(config).sort().join(',') !== fields.sort().join(',') || typeof config.repoId !== 'string' || config.repoId.length === 0
        || Object.entries(config).filter(([key]) => key !== 'repoId').some(([, value]) => !Number.isSafeInteger(value) || value <= 0)
        || config.initialBackoffMs > config.maxBackoffMs || config.intervalMs > 24 * 60 * 60 * 1_000 || config.maxBatch > 10_000 || config.maxBatch > config.maxStateRows || config.maxAttempts > 1_000_000 || config.maxBackoffMs > 24 * 60 * 60 * 1_000 || config.maxStateRows > 1_000_000
        || !this._providerReconciliation || this._providerReconciliation.repoId !== config.repoId
        || typeof opts.coordination.providerAttemptPolicy !== 'function' || typeof opts.coordination.dueProviderProcessing !== 'function' || typeof opts.coordination.recordProviderProcessingDeferral !== 'function') throw new TypeError('provider processing schedule requires bounded deployment retry and reconciliation authority');
      const { repoId, ...policy } = config;
      if (canonicalDigest(opts.coordination.providerAttemptPolicy()) !== canonicalDigest(policy)) throw new TypeError('provider processing schedule disagrees with durable attempt policy');
      this._providerProcessingSchedule = Object.freeze({ ...config });
    }
    this._providerRead = null;
    if (opts.providerRead !== undefined) {
      const config = opts.providerRead;
      if (!config || Object.keys(config).sort().join(',') !== ['maxBytes', 'maxProcessing', 'maxProviders', 'maxStateRows', 'repoId'].sort().join(',')
        || typeof config.repoId !== 'string' || config.repoId.length === 0 || Object.entries(config).filter(([key]) => key !== 'repoId').some(([, value]) => !Number.isSafeInteger(value) || value <= 0)
        || config.maxProviders > 10_000 || config.maxProcessing > 100_000 || config.maxStateRows > 1_000_000 || config.maxBytes > 16 * 1024 * 1024
        || typeof opts.coordination.readProviderStatus !== 'function' || advisoryCards.length === 0) throw new TypeError('provider reads require one deployment repository, provider cards, and positive ceilings');
      this._providerRead = Object.freeze({ ...config });
    }
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
    this._routeLearningPolicy = opts.routeLearningPolicy ? Object.freeze({ ...opts.routeLearningPolicy }) : null;
    if (this._routeLearningPolicy && (typeof opts.coordination.routePolicy !== 'function' || typeof opts.coordination.routeObservations !== 'function' || canonicalDigest(opts.coordination.routePolicy()) !== canonicalDigest(this._routeLearningPolicy))) throw new TypeError('Coordinator route learning policy disagrees with durable coordination');
    this._story = opts.story ?? null;
    this._repoRoot = opts.repoRoot ?? null;
    this._repoId = opts.repoId ?? null;
    this._goalPlanAuthority = null;
    if (opts.goalPlanAuthority !== undefined) {
      const authority = opts.goalPlanAuthority;
      if (!authority || Object.keys(authority).sort().join(',') !== ['authorize', 'policy'].sort().join(',')
        || typeof authority.authorize !== 'function' || typeof opts.coordination.goalPlanPolicy !== 'function'
        || canonicalDigest(opts.coordination.goalPlanPolicy()) !== canonicalDigest(authority.policy)) {
        throw new TypeError('Goal/Plan authority requires exact deployment policy and authorizer');
      }
      for (const method of ['defineGoal', 'proposePlan', 'approvePlan', 'goalPlanStatus', 'previewPlanDispatch', 'createPlanGatedTask', 'reconcilePlanGatedTask']) {
        if (typeof opts.coordination[method] !== 'function') throw new TypeError(`Coordinator coordination store is missing ${method}()`);
      }
      this._goalPlanAuthority = Object.freeze({ policy: Object.freeze({ ...authority.policy }), authorize: authority.authorize });
    }
    this._scratchOraclePolicy = null;
    if (opts.scratchOraclePolicy !== undefined) {
      const policy = opts.scratchOraclePolicy; const fields = ['repoId', 'maxTargetBytes', 'maxConstraints', 'maxConstraintBytes'];
      if (!policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',') || typeof policy.repoId !== 'string' || policy.repoId.length === 0 || policy.repoId !== this._repoId
        || !Number.isSafeInteger(policy.maxTargetBytes) || policy.maxTargetBytes <= 0 || policy.maxTargetBytes > 1024 * 1024
        || !Number.isSafeInteger(policy.maxConstraints) || policy.maxConstraints <= 0 || policy.maxConstraints > 1_024
        || !Number.isSafeInteger(policy.maxConstraintBytes) || policy.maxConstraintBytes <= 0 || policy.maxConstraintBytes > 64 * 1024
        || typeof opts.coordination.scratchFactOracleTarget !== 'function') throw new TypeError('Scratch oracle requires exact bounded deployment authority');
      this._scratchOraclePolicy = Object.freeze({ ...policy });
    }
    this._resolveEnvironmentRef = opts.resolveEnvironmentRef ?? null;
    this._reuseDecisionPolicy = null;
    if (opts.reuseDecisionPolicy !== undefined) {
      const policy = opts.reuseDecisionPolicy;
      if (!policy || typeof policy.authorize !== 'function' || !Number.isSafeInteger(policy.maxNeedBytes) || policy.maxNeedBytes <= 0
        || !Number.isSafeInteger(policy.maxRationaleBytes) || policy.maxRationaleBytes <= 0) throw new TypeError('reuse decision policy requires actor authorization and text ceilings');
      if (policy.authorizeRecheck !== undefined && typeof policy.authorizeRecheck !== 'function') throw new TypeError('reuse decision authorizeRecheck must be a function');
      const reconcile = policy.policyReconcile;
      if (!reconcile || Object.keys(reconcile).sort().join(',') !== ['maxDecisionTargets', 'maxGuardTargets', 'maxAffectedReads', 'maxStateRows', 'maxObservedPolicyHashes', 'maxEventBytes'].sort().join(',') || Object.values(reconcile).some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new TypeError('reuse decision policy requires reconciliation ceilings');
      this._reuseDecisionPolicy = Object.freeze({ authorize: policy.authorize, authorizeRecheck: policy.authorizeRecheck ?? null, maxNeedBytes: policy.maxNeedBytes, maxRationaleBytes: policy.maxRationaleBytes, policyReconcile: Object.freeze({ ...reconcile }) });
    }
    this._now = opts.now || Date.now;
    this._approvalTimeoutMs = opts.approvalTimeoutMs ?? 60000;
    this._stopDeadlineMs = opts.stopDeadlineMs ?? 15000;
    this._recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 15000;
    this._startupRecoveryAuthority = opts.startupRecoveryAuthority ?? null;
    this._startupRecoveryState = this._startupRecoveryAuthority ? 'idle' : 'disabled';
    this._startupRecoveryError = null;
    this._startupCleanupPromises = [];
    this._startupCleanupPending = 0;
    this._startupCleanupError = null;
    const budgetPolicy = opts.budgetPolicy ?? {};
    const budgetPolicyKeys = new Set(['hardStopAt', 'terminalGraceMs', 'thresholds']);
    if (!budgetPolicy || typeof budgetPolicy !== 'object' || Array.isArray(budgetPolicy)
      || Object.keys(budgetPolicy).some((key) => !budgetPolicyKeys.has(key))) throw new TypeError('budget policy must be a closed bounded deployment policy');
    const budgetThresholds = budgetPolicy.thresholds ?? [0.5, 0.8, 1];
    const budgetHardStopAt = budgetPolicy.hardStopAt ?? 1;
    const budgetTerminalGraceMs = budgetPolicy.terminalGraceMs ?? 250;
    if (!Array.isArray(budgetThresholds) || budgetThresholds.length === 0 || budgetThresholds.length > 32
      || budgetThresholds.some((value) => !Number.isFinite(value) || value <= 0 || value > 100)
      || new Set(budgetThresholds).size !== budgetThresholds.length
      || !Number.isFinite(budgetHardStopAt) || budgetHardStopAt <= 0 || budgetHardStopAt > 100
      || !Number.isSafeInteger(budgetTerminalGraceMs) || budgetTerminalGraceMs < 0 || budgetTerminalGraceMs > 60_000) {
      throw new TypeError('budget policy must be a closed bounded deployment policy');
    }
    this._budgetThresholds = Object.freeze([...budgetThresholds].sort((a, b) => a - b));
    this._budgetHardStopAt = budgetHardStopAt;
    this._budgetTerminalGraceMs = budgetTerminalGraceMs;
    const scopeAction = opts.watchdog?.scopeAction ?? 'kill';
    let scopeOrientation = null;
    if (scopeAction === 'orient') {
      const policy = opts.watchdog?.orientation;
      if (!policy || !/^[a-f0-9]{64}$/.test(policy.indexEpoch ?? '')
        || typeof policy.focus !== 'string' || policy.focus.length === 0 || Buffer.byteLength(policy.focus) > 2_048 || policy.focus.includes('\0')
        || !['brief', 'map'].includes(policy.shape ?? 'brief')
        || !Number.isSafeInteger(policy.budgetTokens) || policy.budgetTokens <= 0
        || !Number.isSafeInteger(policy.cooldownMs) || policy.cooldownMs < 0
        || !Number.isSafeInteger(policy.maxRefreshesPerTurn) || policy.maxRefreshesPerTurn <= 0
        || (policy.notePrefix !== undefined && (typeof policy.notePrefix !== 'string' || policy.notePrefix.length === 0 || Buffer.byteLength(policy.notePrefix) > 1_024 || policy.notePrefix.includes('\0')))) {
        throw new TypeError('scope orientation policy requires exact epoch, bounded focus/shape/budget/cooldown/maxRefreshesPerTurn');
      }
      scopeOrientation = Object.freeze({
        indexEpoch: policy.indexEpoch, focus: policy.focus, shape: policy.shape ?? 'brief', budgetTokens: policy.budgetTokens,
        cooldownMs: policy.cooldownMs, maxRefreshesPerTurn: policy.maxRefreshesPerTurn,
        notePrefix: policy.notePrefix ?? 'Scope drift detected; re-anchor on the configured boundary.',
      });
      const orientationCard = this._capabilities?.cards().find((card) => card.name === 'cartographer-quartermaster');
      if (!orientationCard?.ops?.['orientation.slice']) throw new TypeError('scope orientation policy requires registered cartographer-quartermaster/orientation.slice');
    }
    this._watchdog = Object.freeze({
      stallMs: opts.watchdog?.stallMs ?? 120000,
      loopThreshold: opts.watchdog?.loopThreshold ?? 3,
      scopeAction,
      orientation: scopeOrientation,
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
          const handle = this._workers?.get?.(partial?.worker) ?? null;
          // A provider event is untrusted input. For a known worker, current coordinator
          // ownership is the only task/run attribution authority; adapter-supplied fields may
          // neither move cost/evidence into another task nor escape the run being scored.
          const taskId = handle?.taskId ?? partial?.taskId ?? null;
          const task = taskId == null ? null : this._tasks?.get?.(taskId) ?? null;
          const runId = handle ? task?.runId ?? null : partial?.runId ?? task?.runId ?? null;
          e = rawAppend({ ...partial, taskId, runId });
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
              if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) {
                handle.recoverySpawnAbort.abort({ reason: 'operational_log_unavailable' });
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
      // Keep the public Log surface attributed by the newest controller while the controller's
      // own facade retains its immutable physical append. A restart replaces this one forwarding
      // closure instead of stacking the prior controller's task/run authority around the writer.
      rawLog.append = (...args) => this._log.append(...args);
    }

    /** @type {Map<string, object>} taskId -> DriverTask */
    this._tasks = new Map();
    /** @type {string[]} creation order, for FIFO dispatch */
    this._taskOrder = [];
    /** @type {Map<string, object>} workerId -> WorkerHandle (internal) */
    this._workers = new Map();
    /** @type {Map<string, object>} requestId -> pending question/approval record */
    this._pending = new Map();
    /** Active interaction authority only; historical resolved records stay queryable in _pending. */
    this._activeInteractionIds = new Set();
    /** @type {Map<string, object>} workerId -> stop-waiter bookkeeping */
    this._stopWaiters = new Map();
    /** @type {Map<string, object>} workerId -> unaudited emergency-stop waiter after poison */
    this._fatalStopWaiters = new Map();
    /** @type {Map<string, {identity:string,promise:Promise<object>}>} workerId -> live recovery */
    this._recoveryAttempts = new Map();
    /** @type {Map<string, Cursor>} */
    this._cursors = new Map();
    /** @type {Map<string, number>} workerId -> highest seq served but not yet acked */
    this._pendingAck = new Map();

    this._workerSeq = 0;
    this._taskSeq = 0;
    this._publicationSeq = 0;
    this._refinementSeq = 0;

    this._seedCoordinationTasks();
    if (typeof this._coordination.unsettledPlanNodeTasks === 'function' && typeof this._coordination.settlePlanNodeBudget === 'function') {
      for (const taskId of this._coordination.unsettledPlanNodeTasks()) this._settlePlanNodeBudget(taskId);
    }

    for (const [sourceVendor, adapter] of Object.entries(this._adapters)) {
      adapter.onEvent((e) => {
        if (this._closed) return;
        if (!e || typeof e !== 'object' || e.actor !== 'worker') {
          const handle = this._workers.get(e?.worker);
          if (!this._fatalError && handle) {
            this._log.append({
              worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
              kind: 'lifecycle.process_attribution_refused', actor: 'policy',
              payload: boundedProcessObservation(e, 'adapter_actor_authority_refused', { sourceVendor }),
              ...this._routeAttribution(handle),
            });
          }
          return;
        }
        // The callback itself is the southbound trust boundary. An adapter can describe only
        // worker observations; it can never mint orchestrator/policy authority or choose the
        // deployment-owned harness attribution by putting those strings on a wire event.
        const observed = {
          ...(e && typeof e === 'object' ? e : {}),
          actor: 'worker',
          harness: this._harnessOf(sourceVendor),
        };
        if (this._fatalError) {
          this._observeEmergencyTerminal(observed, sourceVendor);
          return;
        }
        try { this._handleEvent(observed, sourceVendor); } catch (err) {
          // Adapter callbacks are an asynchronous trust boundary. A fatal authoritative-write
          // failure has already poisoned this coordinator; do not let it become an uncaught
          // process exception. The next ordinary public command observes the fatal error. An
          // explicit emergency stop may still consume native confirmation without inventing a
          // durable event, solely so owned process/worktree/runtime resources can be reaped.
          if (!this._fatalError) throw err;
          const handle = this._workers.get(observed.worker);
          if (['kill.confirmed', 'lifecycle.process_closed'].includes(observed.kind)) {
            this._observeEmergencyTerminal(observed, sourceVendor);
          } else if (handle?.localAuthority === true && observed.kind === 'lifecycle.process_started') {
            this._emergencyKillUnlogged(handle).catch(noop);
          }
        }
      });
    }

    // Ordinary startup retains D10's reconcile-before-replay posture. Opt-in automatic native
    // recovery must first identify the exact replayed session owners; otherwise an empty expected
    // set would delete the very worktrees whose ownership the fresh handshake must validate.
    if (!this._startupRecoveryAuthority && this._worktrees && typeof this._worktrees.reconcile === 'function') this._trackStartupCleanup(() => this._worktrees.reconcile());
    if (!this._startupRecoveryAuthority && this._runtimeScopes && typeof this._runtimeScopes.reconcile === 'function') this._trackStartupCleanup(() => this._runtimeScopes.reconcile([]));
    this._replay();
    if (this._startupRecoveryAuthority) {
      const eligible = [...this._workers.values()].filter((handle) => {
        const adapter = this._adapters[handle.vendor];
        const task = this._tasks.get(handle.taskId);
        return handle.status === 'orphaned' && handle.sessionRef?.persistence === 'native'
          && handle.sessionContext?.ownerTaskId && adapter && cardSupportsSession(adapter.card(), { mode: 'resume' })
          && this._recoveryDispatchRefusal(handle, task) === null;
      });
      if (this._worktrees && typeof this._worktrees.reconcile === 'function') this._trackStartupCleanup(() => this._worktrees.reconcile(eligible.map((handle) => handle.sessionContext.ownerTaskId)));
      if (this._runtimeScopes && typeof this._runtimeScopes.reconcile === 'function') this._trackStartupCleanup(() => this._runtimeScopes.reconcile(eligible.map((handle) => handle.id)));
    }
    this._terminalizeUnattachedCoordinationTasks();
  }

  // =========================================================================
  // tick() — dispatch + deadline sweep. Called implicitly by every public command.
  // =========================================================================

  tick() {
    if (this._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' });
    if (this._drainState !== 'open') throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
    if (this._fatalError) throw this._fatalError;
    if (this._startupRecoveryState === 'pending') throw Object.assign(new Error('startup session recovery is pending'), { code: 'session_recovery_pending' });
    if (this._startupRecoveryState === 'failed') throw this._startupRecoveryError;
    if (this._startupCleanupPending > 0) throw Object.assign(new Error('startup owned-resource reconciliation is pending'), { code: 'coordinator_cleanup_pending' });
    if (this._startupCleanupError) throw this._startupCleanupError;
    this._sweepDeadlines();
    this._dispatchPass();
  }

  _assertReadable() {
    if (this._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' });
    if (this._fatalError) throw this._fatalError;
    if (this._startupRecoveryState === 'pending') throw Object.assign(new Error('startup session recovery is pending'), { code: 'session_recovery_pending' });
    if (this._startupRecoveryState === 'failed') throw this._startupRecoveryError;
    if (this._startupCleanupError) throw this._startupCleanupError;
    // Reads stay observational during drain. Deadline transitions, forced stops, and policy
    // resolutions are effects and remain owned by admitted control paths/timers.
  }

  async _withAuthorityOp(operation) {
    if (this._drainState !== 'open') throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
    // Preserve same-tick command admission once production startup reconciliation is complete.
    // Only a genuinely pending injected/asynchronous reconciler introduces an await boundary.
    if (this._startupCleanupPending > 0) await Promise.all(this._startupCleanupPromises);
    if (this._startupCleanupError) throw this._startupCleanupError;
    const release = this._acquireAuthorityOp();
    try { return await operation(); }
    finally { release(); }
  }

  _acquireAuthorityOp(allowDraining = false) {
    if (this._drainState !== 'open' && !(allowDraining && this._drainState === 'draining')) throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
    const token = Object.freeze({}); let active = true;
    this._authorityTokens.add(token); this._authorityOps = this._authorityTokens.size;
    return () => {
      if (!active) return;
      active = false; this._authorityTokens.delete(token); this._authorityOps = this._authorityTokens.size;
    };
  }

  _trackAuthorityPromise(operation, allowDraining = false) {
    const release = this._acquireAuthorityOp(allowDraining);
    let result;
    try { result = operation(); }
    catch (error) { release(); return Promise.reject(error); }
    return Promise.resolve(result).finally(release);
  }

  _trackStartupCleanup(operation) {
    let source;
    try { source = operation(); }
    catch {
      if (!this._startupCleanupError) this._startupCleanupError = Object.assign(new Error('startup owned-resource reconciliation failed'), { code: 'coordinator_cleanup_incomplete' });
      return Promise.resolve();
    }
    // The production reconcilers are deliberately synchronous: construction must finish their
    // bounded local inspection before legacy synchronous commands or close() can enter. Injected
    // reconcilers may still be genuinely asynchronous; those remain behind startupReady().
    if (!source || typeof source.then !== 'function') return Promise.resolve(source);
    this._startupCleanupPending += 1;
    const tracked = Promise.resolve(source).catch(() => {
      if (!this._startupCleanupError) this._startupCleanupError = Object.assign(new Error('startup owned-resource reconciliation failed'), { code: 'coordinator_cleanup_incomplete' });
    }).finally(() => { this._startupCleanupPending -= 1; });
    this._startupCleanupPromises.push(tracked);
    return tracked;
  }

  async startupReady() {
    await Promise.all(this._startupCleanupPromises);
    if (this._startupCleanupError) throw this._startupCleanupError;
    return true;
  }

  _fleetDrainOwnsShutdown() { return this._drainState !== 'open'; }

  beginStartupRecovery(authority) {
    if (!authority || authority !== this._startupRecoveryAuthority || this._startupRecoveryState !== 'idle') throw Object.assign(new Error('startup session recovery authority is unavailable'), { code: 'session_recovery_authority' });
    this._startupRecoveryState = 'pending';
  }

  startupRecoveryCandidates(authority, maxStateRows) {
    if (authority !== this._startupRecoveryAuthority || this._startupRecoveryState !== 'pending') throw Object.assign(new Error('startup session recovery authority is unavailable'), { code: 'session_recovery_authority' });
    if (!Number.isSafeInteger(maxStateRows) || maxStateRows <= 0 || this._workers.size > maxStateRows) throw Object.assign(new Error('startup session recovery state exceeds deployment capacity'), { code: 'session_recovery_capacity' });
    const rows = [];
    for (const handle of this._workers.values()) {
      const task = this._tasks.get(handle.taskId); const adapter = this._adapters[handle.vendor];
      if (handle.status !== 'orphaned' || !task || !handle.sessionContext || handle.sessionRef?.persistence !== 'native' || !adapter || !cardSupportsSession(adapter.card(), { mode: 'resume' })) continue;
      if (this._recoveryDispatchRefusal(handle, task) !== null) continue;
      rows.push(handle.id);
    }
    return rows;
  }

  _recoveryDispatchRefusal(handle, task) {
    const state = handle && typeof this._coordination?.recoveryDispatchState === 'function'
      ? this._coordination.recoveryDispatchState(handle.id)
      : null;
    if (!state || !task || state.taskId !== task.id) return null;
    const durable = this._coordination?.task?.(task.id);
    if (state.status === 'dispatch_accepted' && durable?.status === 'completed') return null;
    if (state.status === 'dispatch_accepted') return 'dispatch_accepted';
    if (state.status === 'dispatch_refused') return 'dispatch_refused';
    return 'dispatch_unknown';
  }

  completeStartupRecovery(authority, failureCode = null) {
    if (authority !== this._startupRecoveryAuthority || this._startupRecoveryState !== 'pending') throw Object.assign(new Error('startup session recovery authority is unavailable'), { code: 'session_recovery_authority' });
    if (failureCode === null) { this._startupRecoveryState = 'ready'; return; }
    const error = new Error('startup session recovery failed'); error.code = /^[a-z0-9_]{1,64}$/.test(failureCode) ? failureCode : 'session_recovery_failed'; this._startupRecoveryError = error; this._startupRecoveryState = 'failed';
  }

  /** Keep fleet capabilities behind the same coordinator health boundary as every other
   * public command. Northbounds call these methods; they never receive a second controller. */
  async _assertOperational() {
    await Promise.all(this._startupCleanupPromises);
    if (this._startupCleanupError) throw this._startupCleanupError;
    this.tick();
  }

  /** Irreversibly fence this controller before its durable writer lease is handed off. */
  closeAuthority() {
    if (this._closed) return false;
    // Durable replay handles describe prior ownership; they are not native transports owned by
    // this Coordinator instance. Locally dispatched handles are marked at the resource boundary
    // and remain drain-required while idle so resumable/persistent harnesses cannot be orphaned.
    const active = [...this._workers.values()].filter((worker) => this._ownsLocalResources(worker));
    if (active.length > 0) throw Object.assign(new Error(`coordinator still owns ${active.length} active worker(s); kill/reap before close`), { code: 'coordinator_not_drained' });
    if (this._authorityOps > 0) throw Object.assign(new Error(`coordinator still has ${this._authorityOps} authority operation(s) in flight`), { code: 'coordinator_not_drained' });
    if (this._hasPendingInteractionAuthority()) throw Object.assign(new Error('coordinator still owns pending interaction authority'), { code: 'coordinator_not_drained' });
    if (this._startupCleanupPending > 0) throw Object.assign(new Error('coordinator owned-resource reconciliation is pending'), { code: 'coordinator_not_drained' });
    if (this._startupCleanupError) throw Object.assign(new Error('coordinator owned-resource reconciliation is incomplete'), { code: 'coordinator_not_drained' });
    if (this._drainHistoricalReconcilePromise) throw Object.assign(new Error('coordinator historical resource reconciliation is pending'), { code: 'coordinator_not_drained' });
    if (!['disabled', 'ready'].includes(this._startupRecoveryState) && !(this._drainHistoricalReconciled && this._drainReceipt)) {
      throw Object.assign(new Error('coordinator startup recovery authority is not settled'), { code: 'coordinator_not_drained' });
    }
    this._drainState = 'draining';
    this._closed = true;
    this._drainState = 'closed';
    return true;
  }

  /** DC2-DC6: irreversibly fence admission, durably bind one fixed target set, and
   * converge every locally-owned resource through the ordinary stop state machine. */
  drain(ctx = {}) {
    if (this._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' });
    const fields = ['actor', 'idempotencyKey', 'repoId'];
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)
      || Object.keys(ctx).sort().join(',') !== fields.sort().join(',')
      || typeof ctx.actor !== 'string' || ctx.actor.length === 0 || ctx.actor.length > 256
      || typeof ctx.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(ctx.idempotencyKey)
      || typeof ctx.repoId !== 'string' || ctx.repoId !== this._repoId) {
      throw Object.assign(new TypeError('fleet drain authority is invalid'), { code: 'coordinator_drain_invalid' });
    }
    for (const method of ['fleetDrain', 'admitFleetDrain', 'recordFleetDrainDisposition', 'completeFleetDrain']) {
      if (typeof this._coordination[method] !== 'function') throw Object.assign(new Error('fleet drain coordination authority is unavailable'), { code: 'coordinator_drain_unavailable' });
    }
    const deadline = Date.now() + this._drainPolicy.timeoutMs;
    const assertWithinDeadline = () => {
      if (Date.now() >= deadline) throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
    };

    const requestDigest = canonicalDigest({ repoId: ctx.repoId, idempotencyKey: ctx.idempotencyKey });
    const drainId = `fleet-drain:${requestDigest}`;
    const durable = this._coordination.fleetDrain?.(drainId);

    let targetWorkerIds = durable?.targetWorkerIds ?? this._drainTargetIds;
    if (targetWorkerIds === null) {
      targetWorkerIds = [...this._workers.values()]
        .filter((handle) => {
          const task = this._tasks.get(handle.taskId);
          return task?.status === 'pending' || handle.status === 'pending' || this._ownsLocalResources(handle);
        })
        .map((handle) => handle.id).sort();
      if (targetWorkerIds.length > this._drainPolicy.maxWorkers) {
        throw Object.assign(new Error('fleet drain target set exceeds deployment capacity'), { code: 'coordinator_drain_capacity' });
      }
    } else {
      targetWorkerIds = [...targetWorkerIds].sort();
      if (this._drainTargetIds !== null && canonicalDigest(targetWorkerIds) !== canonicalDigest(this._drainTargetIds)) {
        throw Object.assign(new Error('fleet drain target set conflicts with active drain'), { code: 'coordinator_drain_incomplete' });
      }
    }
    if (durable?.status !== 'completed' && this._activeInteractionIds.size > this._drainPolicy.maxInteractions) {
      throw Object.assign(new Error('fleet drain interaction set exceeds deployment capacity'), { code: 'coordinator_drain_capacity' });
    }

    const admission = Object.freeze({
      schemaVersion: 1, drainId, repoId: ctx.repoId, requestDigest,
      targetWorkerIds: Object.freeze([...targetWorkerIds]), targetDigest: canonicalDigest(targetWorkerIds),
    });
    assertWithinDeadline();
    try { this._coordination.admitFleetDrain(admission, { actor: ctx.actor, key: `fleet.drain:${ctx.idempotencyKey}` }); }
    catch (error) { throw this._drainFailure(error); }
    try { assertWithinDeadline(); }
    catch (error) {
      if (durable?.status !== 'completed') {
        if (this._drainTargetIds === null) this._drainTargetIds = Object.freeze([...targetWorkerIds]);
        if (this._drainPhysicalId === null) { this._drainPhysicalId = drainId; this._drainPhysicalActor = ctx.actor; }
        this._drainState = 'draining';
      }
      throw error;
    }
    const existingRequest = this._drainRequestPromises.get(drainId);
    if (existingRequest) return existingRequest;
    if (durable?.status === 'completed') {
      const completed = Promise.resolve(deepFreeze(durable.receipt));
      this._drainRequestPromises.set(drainId, completed);
      return completed;
    }
    if (this._drainPhysicalId === null) { this._drainPhysicalId = drainId; this._drainPhysicalActor = ctx.actor; }
    if (this._drainTargetIds === null) this._drainTargetIds = Object.freeze([...targetWorkerIds]);
    this._drainState = 'draining';

    if (!this._drainPromise) {
      const physical = this._performDrain(this._drainTargetIds, ctx.repoId, deadline, this._drainPhysicalId, this._drainPhysicalActor);
      this._drainPromise = physical.then((receipt) => {
        this._drainReceipt = receipt;
        return receipt;
      }, (error) => {
        if (this._drainPromise === physical) this._drainPromise = null;
        throw error;
      });
      // Compare against the public Promise, not the inner operation, when a retry clears it.
      const publicPromise = this._drainPromise;
      publicPromise.catch(() => { if (this._drainPromise === publicPromise) this._drainPromise = null; });
    }
    const requestPromise = this._drainPromise.then((receipt) => {
      assertWithinDeadline();
      this._mirrorDrainDispositions(this._drainPhysicalId, drainId, ctx.actor, assertWithinDeadline);
      assertWithinDeadline();
      try { this._coordination.completeFleetDrain(drainId, receipt, { actor: ctx.actor, key: `fleet.drain.complete:${ctx.idempotencyKey}` }); }
      catch (error) { throw this._drainFailure(error); }
      assertWithinDeadline();
      return receipt;
    }, (error) => { throw this._drainFailure(error); });
    this._drainRequestPromises.set(drainId, requestPromise);
    requestPromise.catch(() => { if (this._drainRequestPromises.get(drainId) === requestPromise) this._drainRequestPromises.delete(drainId); });
    return requestPromise;
  }

  _drainFailure(error) {
    if (['coordinator_closed', 'coordinator_drain_capacity', 'coordinator_drain_invalid', 'coordinator_drain_unavailable'].includes(error?.code)) return error;
    return Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
  }

  _ownsLocalResources(handle) {
    if (!handle) return false;
    const processOwned = handle.currentIncarnation === true && handle.processRef && handle.processRef.state !== 'closed';
    const worktreeOwned = handle.ownedWorktreeAuthority === true && !!handle.worktree;
    return handle.localAuthority === true || processOwned || handle.runtimeScope?.active === true || worktreeOwned
      || handle.worktreeCreationPending === true || handle.nativeSpawnPending === true
      || handle.recoverySpawnPending === true
      || handle.cleanupPending === true || handle.cleanupAfterVerification === true || !!handle.cleanupPromise
      || !!handle.untrustedTransportReap || handle.recoveryPending === true
      || this._stopWaiters.has(handle.id) || this._fatalStopWaiters.has(handle.id);
  }

  _hasPendingInteractionAuthority() {
    return this._activeInteractionIds.size > 0;
  }

  _resolveInteractionAuthority(requestId, record) {
    record.state = 'resolved';
    this._activeInteractionIds.delete(requestId);
  }

  _recordDrainDisposition(drainId, actor, workerId, disposition) {
    const key = `fleet.drain.disposition:${canonicalDigest({ drainId, workerId })}`;
    this._coordination.recordFleetDrainDisposition(drainId, workerId, disposition, { actor, key });
  }

  _mirrorDrainDispositions(sourceDrainId, targetDrainId, actor, assertWithinDeadline) {
    const source = this._coordination.fleetDrain(sourceDrainId);
    if (!source || !['admitted', 'completed'].includes(source.status) || source.dispositions.length !== source.targetWorkerIds.length) {
      throw Object.assign(new Error('fleet drain durable dispositions are incomplete'), { code: 'coordinator_drain_incomplete' });
    }
    for (const row of source.dispositions) {
      assertWithinDeadline();
      this._recordDrainDisposition(targetDrainId, actor, row.workerId, row.disposition);
    }
  }

  async _cancelPendingForDrain(deadline) {
    let processed = 0;
    for (const requestId of [...this._activeInteractionIds]) {
      const record = this._pending.get(requestId);
      if (!record) { this._activeInteractionIds.delete(requestId); continue; }
      if (record.state !== 'pending') continue;
      if (Date.now() >= deadline || processed >= this._drainPolicy.maxInteractions) throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
      processed += 1;
      const handle = this._workers.get(record.worker); const task = handle ? this._tasks.get(handle.taskId) : null;
      const cancelled = this._log.append({
        worker: record.worker, harness: handle?.vendor ? this._harnessOf(handle.vendor) : '', turnEpoch: handle ? this._safeTurnEpoch(handle) : 0,
        kind: 'control.drain_interaction_cancelled', actor: 'policy', payload: { requestId, kind: record.kind },
      });
      const evidence = this._coordMapEvent(cancelled);
      this._coordRecord('authority.cancelled', {
        taskId: task?.id ?? null, workerId: record.worker, requestId, kind: record.kind, reason: 'fleet_drain', evidence,
      }, `driver.authority.cancelled:${record.worker}:${requestId}:${cancelled.seq}`, 'policy');
      this._resolveInteractionAuthority(requestId, record); record.consumer = 'policy';
      record.resolution = { decision: record.kind === 'publication' ? 'deny' : 'cancel', reason: 'fleet_drain' };
      if (handle?.pendingQuestionId === requestId) handle.pendingQuestionId = null;
      if (handle?.pendingApprovalId === requestId) handle.pendingApprovalId = null;
      if (processed % 32 === 0) await this._sleep(0);
    }
  }

  async _performDrain(targetWorkerIds, repoId, deadline, physicalDrainId, physicalActor) {
    await this._beforeDrainDeadline(Promise.all(this._startupCleanupPromises), deadline);
    if (this._startupCleanupError) throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
    // Operations admitted before the irreversible fence may finish, but no stop effect races
    // them. In particular, publisher/integration/provider work cannot be relabelled as drained
    // while it still owns an external or repository effect boundary.
    while (this._authorityOps > 0 && Date.now() < deadline) {
      await this._sleep(Math.min(this._drainPolicy.pollMs, Math.max(0, deadline - Date.now())));
    }
    if (this._authorityOps > 0) throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
    while (this._startupRecoveryState === 'pending' && Date.now() < deadline) {
      await this._sleep(Math.min(this._drainPolicy.pollMs, Math.max(0, deadline - Date.now())));
    }
    if (this._startupRecoveryState === 'pending') throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
    await this._cancelPendingForDrain(deadline);
    if (this._hasPendingInteractionAuthority()) throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
    const durablePhysical = this._coordination.fleetDrain(physicalDrainId);
    if (!durablePhysical || durablePhysical.status !== 'admitted'
      || canonicalDigest(durablePhysical.targetWorkerIds) !== canonicalDigest(targetWorkerIds)) {
      throw Object.assign(new Error('fleet drain durable target is unavailable'), { code: 'coordinator_drain_incomplete' });
    }
    const dispositions = new Map((durablePhysical.dispositions ?? []).map((row) => [row.workerId, row.disposition]));
    const setDisposition = (workerId, disposition) => {
      const prior = dispositions.get(workerId);
      if (prior !== undefined) {
        if (prior !== disposition) throw Object.assign(new Error('fleet drain durable disposition conflicts with live ownership'), { code: 'coordinator_drain_incomplete' });
        return;
      }
      this._recordDrainDisposition(physicalDrainId, physicalActor, workerId, disposition);
      dispositions.set(workerId, disposition);
    };
    for (const workerId of targetWorkerIds) {
      if (Date.now() >= deadline) throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
      if (dispositions.has(workerId)) continue;
      const handle = this._workers.get(workerId); const task = handle ? this._tasks.get(handle.taskId) : null;
      if (!handle) { setDisposition(workerId, 'alreadyTerminal'); continue; }
      if (task?.status === 'pending' || handle.status === 'pending') {
        const cancelled = this._log.append({
          worker: workerId, harness: handle.vendor ? this._harnessOf(handle.vendor) : '', turnEpoch: this._safeTurnEpoch(handle),
          kind: 'control.drain_cancelled', actor: 'policy', ...this._routeAttribution(handle, task), payload: {},
        });
        const evidence = this._coordMapEvent(cancelled);
        if (task && !TERMINAL_TASK_STATUSES.has(task.status)) this._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${cancelled.seq}`, evidence);
        if (task) task.status = 'cancelled';
        handle.status = 'dead';
        if (!handle.processRef && !handle.runtimeScope && !handle.worktree) handle.localAuthority = false;
        await this._beforeDrainDeadline(this._removeOwnedTaskWorktree(handle, task), deadline);
        setDisposition(workerId, 'pendingCancelled');
      } else if (!this._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed')) {
        setDisposition(workerId, 'alreadyTerminal');
      }
    }

    const attempt = async (handle) => {
      if (!handle || (dispositions.has(handle.id) && !this._ownsLocalResources(handle))) return;
      if (!this._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed')) {
        setDisposition(handle.id, 'alreadyTerminal');
        return;
      }
      if ((!handle.processRef || handle.processRef.state === 'closed') && ['dead', 'exited'].includes(handle.status)) {
        try {
          await this._cleanupClosedTransport(handle, this._tasks.get(handle.taskId));
          if (!this._ownsLocalResources(handle)) setDisposition(handle.id, 'alreadyTerminal');
        } catch { /* the bounded convergence loop retries exact cleanup */ }
        return;
      }
      try {
        const result = await this.kill(handle.id, 'policy', { drainToken: this._drainKillToken });
        if (result?.ok && result.result === 'confirmed') setDisposition(handle.id, 'killConfirmed');
        else if (result?.ok && ['already_dead', 'already_stopped'].includes(result.result)
          && !this._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed')) setDisposition(handle.id, 'alreadyTerminal');
      } catch { /* exact state below is authoritative; retry until the deployment deadline */ }
    };

    await this._beforeDrainDeadline(Promise.all(targetWorkerIds.map((id) => attempt(this._workers.get(id)))), deadline);
    while (Date.now() <= deadline) {
      const targets = targetWorkerIds.map((id) => this._workers.get(id)).filter(Boolean);
      const remaining = targets.filter((handle) => this._ownsLocalResources(handle));
      const globalRemaining = [...this._workers.values()].filter((handle) => this._ownsLocalResources(handle));
      if (remaining.length === 0 && globalRemaining.length === 0 && this._authorityOps === 0
        && !this._hasPendingInteractionAuthority() && targetWorkerIds.every((id) => dispositions.has(id))) {
        if (!this._drainHistoricalReconciled) {
          if (!this._drainHistoricalReconcilePromise) {
            const reconciliations = [];
            if (this._worktrees && typeof this._worktrees.reconcile === 'function') reconciliations.push(this._worktrees.reconcile([]));
            if (this._runtimeScopes && typeof this._runtimeScopes.reconcile === 'function') reconciliations.push(this._runtimeScopes.reconcile([]));
            const reconciliation = Promise.all(reconciliations);
            this._drainHistoricalReconcilePromise = reconciliation;
            reconciliation.catch(() => {
              if (this._drainHistoricalReconcilePromise === reconciliation) this._drainHistoricalReconcilePromise = null;
            });
          }
          const reconciliation = this._drainHistoricalReconcilePromise;
          await this._beforeDrainDeadline(reconciliation, deadline);
          if (this._drainHistoricalReconcilePromise === reconciliation) this._drainHistoricalReconcilePromise = null;
          this._drainHistoricalReconciled = true;
          continue;
        }
        const processesObserved = targets.filter((handle) => handle.processRef !== null).length;
        const processesClosed = targets.filter((handle) => handle.processRef?.state === 'closed').length;
        const counts = {
          pendingCancelled: [...dispositions.values()].filter((value) => value === 'pendingCancelled').length,
          killConfirmed: [...dispositions.values()].filter((value) => value === 'killConfirmed').length,
          alreadyTerminal: [...dispositions.values()].filter((value) => value === 'alreadyTerminal').length,
          processesObserved,
          processesClosed,
        };
        const core = {
          schemaVersion: 1, state: 'drained', scope: 'local-controller', repoId,
          targetCount: targetWorkerIds.length, remainingCount: 0, targetDigest: canonicalDigest(targetWorkerIds), counts,
          checks: { admissionClosed: true, authorityOpsDrained: true, stopWaitersDrained: true, cleanupDrained: true, localWorkerAuthorityReleased: true },
          effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
        };
        return deepFreeze({ ...core, receiptDigest: canonicalDigest(core) });
      }
      await this._beforeDrainDeadline(Promise.all(remaining.map(attempt)), deadline);
      if (Date.now() >= deadline) break;
      await this._sleep(Math.min(this._drainPolicy.pollMs, Math.max(0, deadline - Date.now())));
    }
    throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' });
  }

  _beforeDrainDeadline(operation, deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' }));
    return new Promise((resolveOperation, rejectOperation) => {
      const timer = setTimeout(() => rejectOperation(Object.assign(new Error('fleet drain did not converge before its deployment deadline'), { code: 'coordinator_drain_incomplete' })), remaining);
      Promise.resolve(operation).then(
        (value) => { clearTimeout(timer); resolveOperation(value); },
        (error) => { clearTimeout(timer); rejectOperation(error); },
      );
    });
  }

  _capabilityRegistry() {
    if (this._capabilities) return this._capabilities;
    const error = new Error('capability registry is unavailable');
    error.code = 'capability_unavailable';
    throw error;
  }

  _dispatchPass() {
    if (this._closed || this._drainState !== 'open') return;
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
        this._trackAuthorityPromise(() => this._resolveRecord(requestId, { decision: 'deny' }, 'policy')).catch(noop);
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

  _routeAttribution(handle, task = this._tasks.get(handle.taskId)) {
    return {
      taskId: task?.id ?? handle.taskId ?? null,
      runId: task?.runId ?? handle.runId ?? null,
      harnessRequested: task?.vendorRequested ?? null,
      harnessResolved: handle.vendor ? this._harnessOf(handle.vendor) : null,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      routeKey: handle.routeKey ?? task?.routeKey ?? null,
    };
  }

  _providerRoutePolicy(handle) {
    if (!this._providerGovernance || !handle?.vendor || !handle.modelResolved || !handle.effortResolved) return null;
    return providerGovernanceRoute(this._providerGovernance, handle.vendor, handle.modelResolved, handle.effortResolved);
  }

  _providerCapabilityRefusal(handle, route) {
    const adapter = this._adapters[handle.vendor];
    const governance = adapter?.card()?.governance;
    if (!governance) return 'provider_governance_card_unavailable';
    if (!Number.isSafeInteger(governance.maxWireFrameBytes)
      || governance.maxWireFrameBytes <= 0
      || governance.maxWireFrameBytes > this._providerGovernance.projection.maxWireFrameBytes) return 'wire_frame_bound_unavailable';
    if (route.mode !== 'strict') return null;
    if (governance.usage?.terminalSeal !== 'native') return 'terminal_usage_seal_unavailable';
    if (route.terminalReserve.tokens > 0 && governance.usage?.tokens !== 'native') return 'native_token_usage_unavailable';
    if (route.terminalReserve.usd > 0 && governance.usage?.usd !== 'native') return 'native_usd_usage_unavailable';
    if (governance.providerCalls?.enforcement !== 'native_pre_effect') return 'provider_call_pre_effect_enforcement_unavailable';
    if (governance.toolCalls?.enforcement !== 'approval_pre_effect') return 'tool_call_pre_effect_enforcement_unavailable';
    if (typeof adapter?.bindProviderGovernance !== 'function') return 'provider_policy_binding_unavailable';
    return null;
  }

  _bindStrictProviderGovernance(handle, route) {
    if (route.mode !== 'strict') return { ok: true, binding: null };
    const core = {
      schemaVersion: 1,
      policyDigest: this._providerGovernance.digest,
      routeDigest: route.digest,
      harness: handle.vendor,
      model: handle.modelResolved,
      effort: handle.effortResolved,
      maxWireFrameBytes: this._providerGovernance.projection.maxWireFrameBytes,
      maxProviderCallsPerTurn: this._providerGovernance.projection.maxProviderCallsPerTurn,
      maxToolCallsPerTurn: this._providerGovernance.projection.maxToolCallsPerTurn,
      terminalReserve: { ...route.terminalReserve },
    };
    const envelope = deepFreeze({ ...core, bindingDigest: canonicalDigest(core) });
    let ack;
    try { ack = this._adapters[handle.vendor].bindProviderGovernance(envelope); }
    catch { return { ok: false, code: 'provider_policy_binding_refused' }; }
    if (!ack || typeof ack !== 'object' || typeof ack.then === 'function'
      || Object.keys(ack).sort().join(',') !== ['bindingDigest', 'ok'].sort().join(',')
      || ack.ok !== true || ack.bindingDigest !== envelope.bindingDigest) {
      return { ok: false, code: 'provider_policy_binding_refused' };
    }
    return { ok: true, binding: { mechanism: 'adapter_sync_pre_effect', bindingDigest: envelope.bindingDigest } };
  }

  _admitProviderTurn(handle, task, phase) {
    const route = this._providerRoutePolicy(handle);
    handle.providerGovernance = route;
    handle.providerPolicyDigest = route ? this._providerGovernance?.digest ?? null : null;
    if (!this._providerGovernance) return { ok: true, route: null };
    if (!route) {
      const event = this._log.append({
        worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'resource.provider_turn_refused', actor: 'policy', ...this._routeAttribution(handle, task),
        payload: {
          phase,
          code: 'exact_provider_route_unconfigured',
          policyDigest: this._providerGovernance.digest,
          harness: handle.vendor ?? null,
          model: handle.modelResolved ?? null,
          effort: handle.effortResolved ?? null,
        },
      });
      return { ok: false, route: null, event, code: 'exact_provider_route_unconfigured' };
    }
    const limits = {
      tokens: Number(task?.brief?.budget?.tokens ?? 0),
      usd: usdFromNanos(usdToNanos(Number(task?.brief?.budget?.usd ?? 0))) ?? 0,
    };
    const used = { ...handle.budgetUsed };
    const remaining = {
      tokens: limits.tokens > 0 ? Math.max(0, limits.tokens - used.tokens) : 0,
      usd: limits.usd > 0 ? subtractUsdFloor(limits.usd, used.usd) ?? 0 : 0,
    };
    const capabilityRefusal = this._providerCapabilityRefusal(handle, route);
    const headroomRefusal = route.terminalReserve.tokens > 0 && (limits.tokens <= 0 || remaining.tokens < route.terminalReserve.tokens)
      ? 'token_reserve_unavailable'
      : route.terminalReserve.usd > 0 && (limits.usd <= 0 || remaining.usd < route.terminalReserve.usd)
        ? 'usd_reserve_unavailable'
        : null;
    let refusal = capabilityRefusal ?? headroomRefusal;
    const strictBinding = refusal ? { ok: false, binding: null } : this._bindStrictProviderGovernance(handle, route);
    refusal ??= strictBinding.ok ? null : strictBinding.code;
    const core = {
      phase,
      policyDigest: this._providerGovernance.digest,
      routeDigest: route.digest,
      harness: route.harness,
      model: route.model,
      effort: route.effort,
      mode: route.mode,
      reserve: { ...route.terminalReserve },
      used,
      limits,
      remaining,
      providerCallLimit: this._providerGovernance.projection.maxProviderCallsPerTurn,
      toolCallLimit: this._providerGovernance.projection.maxToolCallsPerTurn,
      ...(strictBinding.binding ? { strictBinding: strictBinding.binding } : {}),
    };
    const event = this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: refusal ? 'resource.provider_turn_refused' : 'resource.provider_turn_admitted', actor: 'policy',
      ...this._routeAttribution(handle, task),
      payload: refusal ? { ...core, code: refusal } : core,
    });
    if (refusal) return { ok: false, route, event, code: refusal };
    handle.providerTurn = {
      admissionSeq: event.seq,
      phase,
      usage: { tokens: 0, usd: 0 },
      counterIds: new Set(),
      counterObservations: new Map(),
      providerCallIds: new Set(),
      providerCallPhases: new Map(),
      anonymousProviderCalls: 0,
      providerCalls: 0,
      toolCallIds: new Set(),
      toolCallPhases: new Map(),
      anonymousToolCalls: 0,
      toolCalls: 0,
      violation: null,
      sealed: false,
    };
    handle.providerTerminalSeal = null;
    return { ok: true, route, event };
  }

  _failInitialProviderAdmission(handle, task, admission) {
    if (task?.sessionRequest?.mode === 'new' && typeof this._worktrees?.releaseCapacity === 'function') this._worktrees.releaseCapacity(task.id);
    const evidence = this._coordMapEvent(admission.event);
    this._coordTransition(task, 'failed', `task.failed:${task.id}:provider_turn:${admission.event.seq}`, evidence);
    task.status = 'failed';
    handle.status = 'exited';
    handle.localAuthority = false;
  }

  _releaseProviderTurnAdmission(handle, code) {
    if (!handle.providerGovernance || !handle.providerTurn || handle.providerTurn.sealed) return;
    this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'resource.provider_turn_released', actor: 'policy', ...this._routeAttribution(handle),
      payload: { admissionSeq: handle.providerTurn.admissionSeq, code, used: { ...handle.providerTurn.usage } },
    });
    handle.providerTurn.sealed = true;
  }

  _dispatch(task, vendor, model, effort) {
    const handle = this._workers.get(task.assignee);
    const workerId = handle.id;
    if (this._coordination) {
      const claim = this._coordination.claimTask(task.id, workerId, task.coordinationVersion, {
        actor: 'orchestrator', key: `task.claimed:${task.id}:${task.coordinationVersion}`,
      }, {
        harnessRequested: task.vendorRequested, harnessResolved: this._harnessOf(vendor),
        modelRequested: task.modelRequested ?? null, modelResolved: model ?? null, modelObserved: null,
        effortRequested: task.effortRequested ?? null, effortResolved: effort ?? null, effortObserved: null,
        routeKey: routeTupleKey(this._adapters[vendor]?.card(), model, effort, task.taskType),
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
    handle.currentIncarnation = true;
    handle.localAuthority = true;
    const providerAdmission = this._admitProviderTurn(handle, task, 'spawn');
    if (!providerAdmission.ok) {
      this._failInitialProviderAdmission(handle, task, providerAdmission);
      return;
    }
    let runtime;
    try {
      runtime = this._ensureRuntimeScope(handle);
    } catch (err) {
      try { this._runtimeScopes?.remove?.(workerId); } catch { /* best effort */ }
      if (task.sessionRequest?.mode === 'new' && typeof this._worktrees?.releaseCapacity === 'function') this._worktrees.releaseCapacity(task.id);
      this._releaseProviderTurnAdmission(handle, 'runtime_scope_unavailable');
      const crashEvent = this._log.append({
        worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'lifecycle.crashed', actor: 'policy',
        ...this._routeAttribution(handle, task),
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
    handle.worktreeCreationPending = true;
    let worktreeSource;
    if (task.sessionRequest?.mode === 'resume') {
      worktreeSource = Promise.resolve({
          path: task.sessionContext.worktree,
          branch: task.sessionContext.branch,
          baseSha: task.sessionContext.baseSha,
          ownerTaskId: task.sessionContext.ownerTaskId,
          ...(task.sessionContext.sparsePaths ? { sparsePaths: task.sessionContext.sparsePaths } : {}),
          ...(task.sessionContext.sparseCheckoutIdentity ? { sparseCheckoutIdentity: task.sessionContext.sparseCheckoutIdentity } : {}),
          ...(task.sessionContext.toolchainProjection ? { toolchainProjection: task.sessionContext.toolchainProjection } : {}),
          ...(task.sessionContext.capacityReservation ? { capacityReservation: task.sessionContext.capacityReservation } : {}),
        });
    } else {
      try { worktreeSource = Promise.resolve(this._worktrees.create(task.id, task.worktreeBaseSha ?? null)); }
      catch (error) { worktreeSource = Promise.reject(error); }
    }
    let worktreeReady = worktreeSource
      .then(async (res) => {
        if (res && res.path) {
          task.worktree = res.path;
          handle.worktree = res.path;
          // A resumed/recovered session merely borrows its durable session checkout. Only a
          // checkout created for this task is independent local authority that must block drain.
          handle.ownedWorktreeAuthority = task.sessionRequest?.mode !== 'resume';
          const sessionContext = Object.freeze({
            worktree: res.path,
            ...(this._repoRoot ? { repoRoot: this._repoRoot } : {}),
            ...(res.baseSha ? { baseSha: res.baseSha } : {}),
            ...(res.branch ? { branch: res.branch } : {}),
            ...(res.toolchainProjection ? { toolchainProjection: res.toolchainProjection } : {}),
            ...(res.sparsePaths !== undefined ? { sparsePaths: normalizeSparsePaths(res.sparsePaths) } : {}),
            ...(res.sparseCheckoutIdentity !== undefined ? { sparseCheckoutIdentity: normalizeSparseCheckoutIdentity(res.sparseCheckoutIdentity) } : {}),
            ...(res.capacityReservation ? { capacityReservation: Object.freeze({ ...res.capacityReservation }) } : {}),
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
            await this._removeOwnedTaskWorktree(handle, task);
          }
        }
        return res;
      });
    // WF1-WF5: readiness is a coordinator-owned prerequisite. Normalize both synchronous and
    // asynchronous creation failure before the adapter can observe the rejection, abort any
    // pending native spawn, write one fixed non-leaking terminal fact, and still rethrow a typed
    // rejection to the adapter so it cannot fall through to the orchestrator cwd. A concurrent
    // stop retains terminal authority; the second reap handles partial creation that failed late.
    worktreeReady = worktreeReady.catch((cause) => {
      void cause;
      const failure = new Error('worktree unavailable');
      failure.name = 'WorktreeReadinessError';
      failure.code = 'worktree_unavailable';
      if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
        handle.spawnAbort.abort({ reason: failure.code });
      }
      const terminalized = this._fatalError ? false : this._onSpawnRefused(handle, task, harness, {
        ok: false, reason: failure.message, code: failure.code, [WORKTREE_FAILURE]: true,
      });
      if (!terminalized && task.sessionRequest?.mode === 'new') this._removeOwnedTaskWorktree(handle, task).catch(noop);
      throw failure;
    }).finally(() => { handle.worktreeCreationPending = false; });
    // Some test/dummy adapters do not consume readiness. The prerequisite still owns failure,
    // while this observer prevents an otherwise-unhandled rejected promise.
    worktreeReady.catch(noop);

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
        ...(handle.providerGovernance ? { providerGovernance: handle.providerGovernance } : {}),
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
    handle.processGeneration = (handle.processGeneration ?? 0) + 1;
    // SC1d: the spawn Ack is consumed, not discarded — a refused spawn must fail the task
    // instead of leaving a zombie in 'working' (the G1 audit's silent failure mode).
    handle.nativeSpawnPending = true;
    let nativeSpawnSource;
    try {
      nativeSpawnSource = this._adapters[vendor].spawn(workerId, task.brief, {
        worktreeReady,
        timeoutMs: wallMin ? wallMin * 60000 : undefined,
        signal: spawnAbort.signal,
        model: task.modelResolved ?? undefined,
        reasoningEffort: task.effortResolved ?? undefined,
        serviceTier: task.modelPolicy?.serviceTier,
        session: task.sessionRequest?.mode === 'new' ? undefined : task.sessionRequest,
        env: runtime?.env,
        replaceEnv: runtime?.replaceEnv === true,
        processGeneration: handle.processGeneration,
        processReapTimeoutMs: Math.max(1, Math.floor(this._stopDeadlineMs * 0.8)),
      });
    } catch (error) { nativeSpawnSource = Promise.reject(error); }
    const nativeSpawnPromise = Promise.resolve(nativeSpawnSource).then((ack) => {
      if (handle.spawnAbort === spawnAbort) handle.spawnAbort = null;
      if (ack && ack.ok === false) this._onSpawnRefused(handle, task, harness, ack);
    }).catch((err) => {
      if (handle.spawnAbort === spawnAbort) handle.spawnAbort = null;
      // SC15: rejection and resolved refusal are the same durable failure channel.
      this._onSpawnRefused(handle, task, harness, { ok: false, reason: String(err?.message ?? err) });
    }).finally(() => {
      if (handle.nativeSpawnPromise === nativeSpawnPromise) handle.nativeSpawnPromise = null;
      handle.nativeSpawnPending = false;
    });
    handle.nativeSpawnPromise = nativeSpawnPromise;

    this._log.append({
      worker: workerId, harness, turnEpoch: stamp.turnEpoch, kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: {},
      ...this._routeAttribution(handle, task),
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
    if (TERMINAL_TASK_STATUSES.has(task.status)) return false;
    if (handle.status === 'stopping' || handle.status === 'dead' || handle.status === 'idle' || handle.status === 'exited') return false;
    this._releaseProviderTurnAdmission(handle, ack?.[WORKTREE_FAILURE] === true ? 'worktree_unavailable' : 'spawn_refused');
    const worktreeFailure = ack?.[WORKTREE_FAILURE] === true;
    const phase = worktreeFailure ? 'worktree' : 'spawn';
    const crashEvent = this._log.append({
      worker: handle.id,
      harness,
      turnEpoch: this._safeTurnEpoch(handle),
      kind: 'lifecycle.crashed',
      actor: 'orchestrator',
      ...this._routeAttribution(handle, task),
      payload: {
        error: worktreeFailure ? 'worktree unavailable' : ack.reason ?? 'spawn refused',
        phase,
        ...(worktreeFailure ? { code: 'worktree_unavailable' } : {}),
      },
    });
    const evidence = this._coordMapEvent(crashEvent);
    this._coordTransition(task, 'failed', `task.failed:${task.id}:${phase}`, evidence, 'orchestrator');
    handle.status = 'exited';
    task.status = 'failed';
    if (handle.processRef && ['initializing', 'ready'].includes(handle.processRef.state)) {
      handle.status = 'working';
      this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      return true;
    }
    this._removeRuntimeScope(handle);
    if (task.sessionRequest?.mode === 'new') this._removeOwnedTaskWorktree(handle, task).catch(noop);
    this._dispatchPass();
    return true;
  }

  // =========================================================================
  // First-class Goal/Plan authority
  // =========================================================================

  async _goalPlanAuth(ctx, power, operation, request) {
    if (!this._goalPlanAuthority) throw Object.assign(new Error('goal/plan authority is not configured'), { code: 'goal_plan_unavailable' });
    let normalized;
    try { normalized = normalizeGoalPlanContext(ctx, this._goalPlanAuthority.policy, power); }
    catch (error) {
      if (error instanceof GoalPlanValidationError) throw Object.assign(new Error(error.message), { code: error.code });
      throw error;
    }
    const allowed = await this._goalPlanAuthority.authorize(Object.freeze({ operation, power, principalId: normalized.principalId, repoId: normalized.repoId, runId: normalized.runId, requestDigest: goalPlanDigest(request) }));
    if (allowed !== true) throw Object.assign(new Error('goal/plan authority denied the operation'), { code: 'goal_plan_unauthorized' });
    return normalized;
  }

  defineGoal(fields, ctx) {
    return this._withAuthorityOp(async () => this._coordination.defineGoal(fields, await this._goalPlanAuth(ctx, 'goal:define', 'goal_define', fields)));
  }

  proposePlan(fields, ctx) {
    return this._withAuthorityOp(async () => this._coordination.proposePlan(fields, await this._goalPlanAuth(ctx, 'plan:propose', 'plan_propose', fields)));
  }

  approvePlan(fields, ctx) {
    return this._withAuthorityOp(async () => this._coordination.approvePlan(fields, await this._goalPlanAuth(ctx, 'plan:approve', 'plan_approve', fields)));
  }

  goalPlanStatus(fields, ctx) {
    return this._withAuthorityOp(async () => {
      const auth = await this._goalPlanAuth(ctx, 'goal:observe', 'goal_plan_status', fields);
      return this._coordination.goalPlanStatus(fields, auth);
    });
  }

  // =========================================================================
  // Command: spawn()
  // =========================================================================

  spawn(vendor, brief, opts = {}) {
    return this._withAuthorityOp(() => this._spawn(vendor, brief, opts));
  }

  async _spawn(vendor, brief, opts = {}) {
    // CI1: admission is the pinning boundary. Never retain caller-owned mutable state and never
    // allow a malformed raw object to become a task merely because the caller skipped createBrief.
    let admittedBrief = null;
    const runId = normalizeRunId(opts.runId);
    const modelPolicy = normalizeModelPolicy(opts.model, opts.modelPolicy, opts.effort);
    const effortRequested = opts.effort ?? modelPolicy?.reasoningEffort ?? null;
    let worktreeBaseSha = opts.worktreeBaseSha ?? null;
    if (worktreeBaseSha !== null && !/^[a-f0-9]{40}$/.test(worktreeBaseSha)) throw new TypeError('spawn worktreeBaseSha must be an exact commit ID');
    let sessionRequest = normalizeSessionRequest(opts.session);

    const taskId = opts.taskId ?? this._autoTaskId();
    normalizePhysicalOwnerId(taskId, 'taskId');
    const reconcileExistingPlanTask = this._tasks.has(taskId) && Boolean(opts.goalPlan);
    if (this._tasks.has(taskId) && !reconcileExistingPlanTask) throw new DuplicateTaskIdError(`duplicate taskId "${taskId}"`);
    if (opts.goalPlan && (opts.refines != null || (opts.taskType != null && opts.taskType !== 'general')
      || opts.review != null || worktreeBaseSha !== null || sessionRequest.mode !== 'new' || modelPolicy !== null)) {
      throw Object.assign(new Error('plan-gated execution fields require explicit plan authority'), { code: 'plan_execution_mismatch' });
    }
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
      if (this._drainState !== 'open') throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
    }

    const planMandatory = this._goalPlanAuthority?.policy?.mandatory === true;
    if (planMandatory && !opts.goalPlan) throw Object.assign(new Error('an approved goal/plan node is required'), { code: 'goal_plan_required' });
    if (opts.goalPlan && !this._goalPlanAuthority) throw Object.assign(new Error('goal/plan authority is not configured'), { code: 'goal_plan_unavailable' });
    if (opts.goalPlan && vendor === 'auto') throw Object.assign(new Error('plan-gated dispatch requires an exact harness'), { code: 'plan_route_mismatch' });
    let planAuth = null; let planState = null;
    const routeBinding = { vendor, model: opts.model ?? null, effort: effortRequested ?? null };
    if (opts.goalPlan) {
      planAuth = await this._goalPlanAuth({
        actor: opts.actor, principalId: opts.principalId, sessionId: opts.sessionId,
        powers: opts.powers, repoId: this._repoId, runId,
        idempotencyKey: opts.idempotencyKey ?? `task.created:${taskId}`,
      }, 'plan:dispatch', 'plan_dispatch', { gate: opts.goalPlan, route: routeBinding, taskId });
      if (brief?.goalPlan !== undefined) throw Object.assign(new Error('caller cannot supply authoritative goal/plan Brief coordinates'), { code: 'plan_brief_mismatch' });
      if (reconcileExistingPlanTask) {
        const reconciled = this._coordination.reconcilePlanGatedTask(taskId, opts.goalPlan, routeBinding, planAuth);
        const durableBrief = reconciled.task?.brief;
        if (!planBriefMatches(brief, durableBrief)) throw Object.assign(new Error('caller Brief differs from the admitted task'), { code: 'plan_dispatch_conflict' });
        const existingTask = this._tasks.get(taskId); const handle = this._workers.get(existingTask?.assignee);
        if (!handle) throw this._poisonCoordination(Object.assign(new Error('reconciled plan task lacks its reserved handle'), { code: 'goal_plan_integrity' }));
        return this._publicHandle(handle);
      }
      planState = this._coordination.previewPlanDispatch(opts.goalPlan, routeBinding);
      if (!planBriefMatches(brief, planState.brief)) throw Object.assign(new Error('caller Brief differs from the approved plan'), { code: 'plan_brief_mismatch' });
      admittedBrief = createBrief(planState.brief);
    } else {
      admittedBrief = createBrief(brief);
    }

    const deps = planState ? [...planState.resolvedDeps] : (opts.deps ? [...opts.deps] : []);
    if (planState && opts.deps && canonicalDigest([...opts.deps].sort()) !== canonicalDigest(deps)) throw Object.assign(new Error('caller dependencies differ from the approved plan DAG'), { code: 'plan_dependency_mismatch' });
    this._assertNoCycle(taskId, deps);

    const workerId = this._allocWorkerId();
    const taskFields = () => ({
      id: taskId, brief: admittedBrief, deps, refines: opts.refines ?? null,
      runId,
      taskType: opts.taskType ?? 'general', reservedWorkerId: workerId,
      vendorRequested: vendor, modelRequested: opts.model ?? null, modelPolicy,
      effortRequested, effortResolved: null, effortObserved: null, routeKey: null,
      sessionRequest, ...(worktreeBaseSha ? { worktreeBaseSha } : {}), ...(opts.review ? { review: Object.freeze({ ...opts.review }) } : {}),
    });
    let coordinationVersion = null;
    if (planState) {
      const created = this._coordination.createPlanGatedTask(taskFields(), opts.goalPlan, routeBinding, planAuth);
      coordinationVersion = created.task.version;
    }

    let capacityPrepared = false;
    try {
      if (sessionRequest.mode === 'new' && typeof this._worktrees?.reserveCapacity === 'function') {
        const prepared = await this._worktrees.reserveCapacity(taskId, worktreeBaseSha);
        if (prepared?.baseSha) worktreeBaseSha = prepared.baseSha;
        capacityPrepared = prepared !== null;
        if (this._drainState !== 'open') {
          if (capacityPrepared) await Promise.resolve(this._worktrees.releaseCapacity?.(taskId));
          throw Object.assign(new Error('coordinator admission is draining'), { code: 'coordinator_draining' });
        }
      }
      if (this._coordination && !planState) {
        const created = this._coordination.createTask(taskFields(), { actor: opts.actor ?? 'orchestrator', key: opts.idempotencyKey ?? `task.created:${taskId}` });
        coordinationVersion = created.task.version;
      }
    } catch (error) {
      if (capacityPrepared) await Promise.resolve(this._worktrees.releaseCapacity?.(taskId));
      if (planState) {
        try { this._coordination.transitionTask(taskId, 'cancelled', 1, { actor: 'policy', key: `task.cancelled:${taskId}:admission` }); }
        catch (transitionError) { throw this._poisonCoordination(transitionError); }
      }
      throw error;
    }
    const task = {
      id: taskId,
      runId,
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
      worktreeBaseSha,
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
      runId,
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
      budgetHardExceeded: false,
      usageCumulative: new Map(),
      budgetStopTimer: null,
      turnTerminalObserved: false,
      providerGovernance: null,
      providerPolicyDigest: null,
      providerTurn: null,
      providerPolicyHardExceeded: false,
      providerTelemetryFailed: false,
      providerTerminalSeal: null,
      watchdogActions: new Set(),
      recentFailedActions: [],
      watchdogGeneration: 0,
      watchdogTimer: null,
      runtimeScope: null,
      runtimeLease: null,
      spawnAbort: null,
      worktreeCreationPending: false,
      nativeSpawnPending: false,
      nativeSpawnPromise: null,
      recoverySpawnAbort: null,
      recoverySpawnPending: false,
      recoverySpawnPromise: null,
      recoveryStopReason: null,
      recoveryProviderReleaseDeferred: false,
      processGeneration: 0,
      processRef: null,
      cleanupPending: false,
      cleanupPromise: null,
      cleanupAfterVerification: false,
      currentIncarnation: true,
      ownedWorktreeAuthority: false,
      localAuthority: false,
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
        id: durable.id, runId: durable.runId ?? null, brief: durable.brief, deps: [...durable.deps],
        vendorRequested: durable.vendorRequested, modelRequested: durable.modelRequested,
        modelResolved: durable.modelResolved ?? null, modelObserved: durable.modelObserved ?? null, modelPolicy: durable.modelPolicy,
        effortRequested: durable.effortRequested ?? null, effortResolved: durable.effortResolved ?? null,
        effortObserved: durable.effortObserved ?? null, routeKey: durable.routeKey ?? null,
        sessionRequest: durable.sessionRequest ?? Object.freeze({ mode: 'new' }), worktreeBaseSha: durable.worktreeBaseSha ?? durable.review?.baseSha ?? null,
        sessionContext: null, lineage: null, refines: durable.refines ?? null,
        status: durable.status, assignee: workerId, worktree: null, result: null, verdict: null,
        capturedSha: null, integration: null, retainedResultRef: null, publication: null,
        review: durable.review ? Object.freeze({ ...durable.review }) : null, taskType: durable.taskType ?? 'general', coordinationVersion: durable.version,
      };
      this._tasks.set(task.id, task);
      this._taskOrder.push(task.id);
      this._workers.set(workerId, {
        id: workerId, runId: durable.runId ?? null, vendor: durable.vendorRequested === 'auto' ? null : durable.vendorRequested,
        modelRequested: durable.modelRequested ?? null, modelResolved: null, modelObserved: null,
        modelPolicy: durable.modelPolicy ?? null, modelMismatch: null,
        effortRequested: durable.effortRequested ?? null, effortResolved: durable.effortResolved ?? null,
        effortObserved: durable.effortObserved ?? null, routeKey: durable.routeKey ?? null, effortMismatch: null,
        sessionRequest: task.sessionRequest, sessionContext: null, lineage: null,
        taskId: task.id, worktree: null,
        status: durable.status === 'pending' ? 'pending' : (TERMINAL_TASK_STATUSES.has(durable.status) ? 'idle' : 'orphaned'), pendingApprovalId: null,
        pendingQuestionId: null, budgetUsed: { tokens: 0, usd: 0 }, budgetThresholdsFired: new Set(),
        budgetHardExceeded: false,
        usageCumulative: new Map(), budgetStopTimer: null, turnTerminalObserved: false,
        providerGovernance: null, providerPolicyDigest: null, providerTurn: null, providerPolicyHardExceeded: false,
        providerTelemetryFailed: false, providerTerminalSeal: null,
        watchdogActions: new Set(), recentFailedActions: [],
        watchdogGeneration: 0, watchdogTimer: null, runtimeScope: null, runtimeLease: null,
        spawnAbort: null, recoverySpawnAbort: null, recoverySpawnPending: false, recoverySpawnPromise: null, recoveryStopReason: null,
        recoveryProviderReleaseDeferred: false,
        processGeneration: 0, processRef: null, cleanupPending: false, cleanupPromise: null, cleanupAfterVerification: false, createdAt: new Date(0).toISOString(),
        currentIncarnation: false, ownedWorktreeAuthority: false, localAuthority: false,
      });
      const match = /^w-(\d+)$/.exec(workerId);
      if (match) this._workerSeq = Math.max(this._workerSeq, Number(match[1]));
      const taskMatch = /^task-(\d+)$/.exec(task.id);
      if (taskMatch) this._taskSeq = Math.max(this._taskSeq, Number(taskMatch[1]));
    }
  }

  /** AC4: spawn a separately-attributed oracle/review over immutable task evidence. */
  spawnReview(workerId, vendor, opts = {}) {
    return this._withAuthorityOp(() => this._spawnReview(workerId, vendor, opts));
  }

  async _spawnReview(workerId, vendor, opts = {}) {
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
      runId: parent.runId ?? null,
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

  /** Spawn a separately-routed oracle over one immutable derived Scratch assertion. The caller
   * selects the route but cannot supply or alter the fact target or its durable commitment. */
  spawnScratchOracle(scratchFactId, vendor, opts = {}) {
    return this._withAuthorityOp(() => this._spawnScratchOracle(scratchFactId, vendor, opts));
  }

  async _spawnScratchOracle(scratchFactId, vendor, opts = {}) {
    this.tick();
    if (!this._scratchOraclePolicy) throw new ReviewSelectionError('Scratch oracle is not deployment-configured', 'scratch_oracle_unavailable');
    const actor = opts.actor ?? 'orchestrator';
    if (actor !== 'orchestrator' && !(typeof actor === 'string' && actor.startsWith('operator:'))) throw new ReviewSelectionError('Scratch oracle requires operator or orchestrator authority', 'scratch_oracle_forbidden');
    if (vendor === 'auto' || !this._adapters[vendor]) throw new ReviewSelectionError('Scratch oracle requires an explicit known harness', 'explicit_vendor_required');
    if (!opts.verification || typeof opts.verification.command !== 'string' || opts.verification.command.length === 0) throw new ReviewSelectionError('Scratch oracle requires a pinned verification contract', 'verification_required');
    const constraints = opts.constraints ?? [];
    if (!Array.isArray(constraints) || constraints.length > this._scratchOraclePolicy.maxConstraints || constraints.some((value) => typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > this._scratchOraclePolicy.maxConstraintBytes)) {
      throw new ReviewSelectionError('Scratch oracle constraints exceeded deployment authority', 'scratch_oracle_oversize');
    }
    const bound = this._coordination.scratchFactOracleTarget(scratchFactId, this._scratchOraclePolicy.repoId, this._scratchOraclePolicy.maxTargetBytes);
    const producer = this._coordination.task(bound.commitment.producerTaskId);
    let tuple;
    try { tuple = JSON.parse(producer?.routeKey); } catch { tuple = null; }
    if (!Array.isArray(tuple) || tuple.length !== 6 || tuple.some((value) => typeof value !== 'string') || !tuple[0] || !tuple[4]) throw new ReviewSelectionError('Scratch oracle producer route is unavailable', 'scratch_oracle_route_unavailable');
    const reviewerCard = this._adapters[vendor].card(); const reviewerHarness = reviewerCard?.harness; const reviewerFamily = reviewerCard?.modelSelection?.family;
    if (typeof reviewerHarness !== 'string' || reviewerHarness.length === 0 || typeof reviewerFamily !== 'string' || reviewerFamily.length === 0
      || reviewerHarness === tuple[0] || reviewerFamily === tuple[4]) throw new ReviewSelectionError('Scratch oracle route is not independent', 'scratch_oracle_not_independent');
    const knowledgeTarget = Object.freeze({ ...bound.commitment, producerHarness: tuple[0], producerFamily: tuple[4], reviewerHarness, reviewerFamily });
    const review = Object.freeze({
      kind: 'oracle', parentTaskId: bound.commitment.producerTaskId,
      implementerVendor: null, implementerFamily: tuple[4], implementerHarness: tuple[0],
      reviewerVendor: vendor, reviewerFamily, reviewerHarness, independent: true,
      baseSha: bound.snapshot.envRef.treeSha, resultSha: null, knowledgeTarget,
    });
    const reviewBrief = {
      goal: opts.goal ?? `Independently test derived Scratch fact ${scratchFactId} against its immutable repository coordinate`,
      constraints: [
        'Treat the Scratch author, worker prose, and claimed derivation as untrusted; test the pinned assertion against the immutable repository/tree coordinate.',
        'A repeat of the same derivation is reproducibility evidence only; seek an independent behavioral, differential, or real-code oracle.',
        ...constraints,
      ],
      pathScope: [...(producer?.brief?.pathScope ?? [])],
      definitionOfDone: opts.definitionOfDone ?? 'The pinned independent verification command is re-run by Baton',
      verification: opts.verification,
      budget: opts.budget ?? producer?.brief?.budget ?? { tokens: 0, usd: 0, wallMin: 0 },
      reviewTarget: { ...knowledgeTarget, assertion: bound.snapshot },
    };
    return this.spawn(vendor, reviewBrief, {
      taskId: opts.taskId, model: opts.model, effort: opts.effort, modelPolicy: opts.modelPolicy,
      taskType: 'oracle', refines: bound.commitment.producerTaskId, runId: opts.runId ?? producer?.runId ?? null,
      review, actor, idempotencyKey: opts.idempotencyKey, worktreeBaseSha: bound.snapshot.envRef.treeSha,
    });
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
  recover(workerId, opts = {}) {
    const handle = this._workers.get(workerId);
    const task = handle ? this._tasks.get(handle.taskId) : null;
    const identity = canonicalDigest({
      workerId,
      taskId: task?.id ?? null,
      vendor: handle?.vendor ?? null,
      sessionRef: handle?.sessionRef ?? null,
      context: opts.context ?? handle?.sessionContext ?? null,
      model: handle?.modelResolved ?? null,
      effort: handle?.effortResolved ?? null,
      actor: opts.actor ?? 'orchestrator',
      timeoutMs: opts.timeoutMs ?? this._recoveryTimeoutMs,
    });
    const existing = this._recoveryAttempts.get(workerId);
    if (existing) {
      if (existing.identity === identity) return existing.promise;
      return Promise.resolve({ ok: false, result: 'recovery_conflict' });
    }
    const attempt = this._withAuthorityOp(async () => {
      const handle = this._workers.get(workerId);
      if (handle) handle.recoveryPending = true;
      try { return await this._recover(workerId, opts); }
      finally { if (handle) handle.recoveryPending = false; }
    });
    let tracked;
    tracked = attempt.finally(() => {
      if (this._recoveryAttempts.get(workerId)?.promise === tracked) this._recoveryAttempts.delete(workerId);
    });
    this._recoveryAttempts.set(workerId, { identity, promise: tracked });
    return tracked;
  }

  async _recover(workerId, opts = {}) {
    const startup = opts.startupAuthority === this._startupRecoveryAuthority && this._startupRecoveryState === 'pending';
    if (!startup) this.tick();
    else { if (this._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' }); if (this._fatalError) throw this._fatalError; }
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    const priorDispatchRefusal = this._recoveryDispatchRefusal(handle, task);
    if (priorDispatchRefusal !== null) return { ok: false, result: priorDispatchRefusal };
    if (handle.status !== 'orphaned') return { ok: false, result: 'worker_not_orphaned' };
    if (!task || !handle.sessionRef || handle.sessionRef.persistence !== 'native') {
      return { ok: false, result: 'session_not_resumable' };
    }
    if (task.brief?.goalPlan) {
      return { ok: false, result: 'goal_plan_continuation_not_authorized' };
    }
    if (task.runId && this._coordination.run?.(task.runId)?.status === 'sealed') throw Object.assign(new Error(`run ${task.runId} is sealed`), { name: 'CoordinationRefusal', code: 'run_sealed' });
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

    const providerAdmission = this._admitProviderTurn(handle, task, 'recovery');
    if (!providerAdmission.ok) return { ok: false, result: 'provider_turn_refused', reason: providerAdmission.code };

    const timeoutMs = opts.timeoutMs ?? this._recoveryTimeoutMs;
    const admission = { events: [] };
    admission.spawned = new Promise((resolve) => { admission.resolveSpawned = resolve; });
    handle.turnAdmission = admission;
    const session = normalizeSessionRequest({ mode: 'resume', id: handle.sessionRef.id, context });
    let recoveryRequested;
    let runtime;
    try {
      recoveryRequested = this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.recovery_requested', actor: opts.actor ?? 'orchestrator',
        payload: { sessionRef: handle.sessionRef, context },
      });
      const recoveryEvidence = this._coordMapEvent(recoveryRequested);
      this._coordRecord('recovery.requested', {
        taskId: task.id, workerId, sessionId: handle.sessionRef.id, context, evidence: recoveryEvidence,
      }, `driver.recovery.requested:${task.id}:${recoveryRequested.seq}`, opts.actor ?? 'orchestrator');
      runtime = this._ensureRuntimeScope(handle);
      handle.currentIncarnation = true;
      handle.localAuthority = true;
    } catch (error) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      const releaseError = this._releaseRecoveryProviderTurn(handle, 'recovery_setup_aborted');
      const runtimeRemoved = this._removeRuntimeScope(handle);
      if (runtimeRemoved) handle.localAuthority = false;
      throw releaseError ?? error;
    }

    let timerHandle;
    let timedOut = false;
    const timeout = new Promise((resolve) => {
      timerHandle = this._setTimeout(() => { timedOut = true; resolve({ timeout: true }); }, timeoutMs);
      if (timerHandle && typeof timerHandle.unref === 'function') timerHandle.unref();
    });
    handle.processGeneration = (handle.processGeneration ?? 0) + 1;
    const recoverySpawnAbort = new AbortController();
    handle.recoverySpawnAbort = recoverySpawnAbort;
    handle.recoverySpawnPending = true;
    const attempt = Promise.resolve().then(() => adapter.spawn(workerId, task.brief, {
      worktree: context.worktree,
      timeoutMs: task.brief?.budget?.wallMin ? task.brief.budget.wallMin * 60000 : undefined,
      model: handle.modelResolved ?? undefined,
      reasoningEffort: handle.effortResolved ?? undefined,
      serviceTier: handle.modelPolicy?.serviceTier,
      session,
      attachOnly: true,
      signal: recoverySpawnAbort.signal,
      env: runtime?.env,
      replaceEnv: runtime?.replaceEnv === true,
      processGeneration: handle.processGeneration,
      processReapTimeoutMs: Math.max(1, Math.floor(this._stopDeadlineMs * 0.8)),
    })).then((ack) => ({ ack }), (error) => ({ error }));
    let trackedAttempt;
    trackedAttempt = attempt.finally(async () => {
      if (handle.recoverySpawnPromise !== trackedAttempt) return;
      handle.recoverySpawnPending = false;
      if (handle.recoverySpawnAbort === recoverySpawnAbort) handle.recoverySpawnAbort = null;
      if (handle.recoveryStopReason) await this._stopRecoveryTransport(handle, handle.recoveryStopReason);
    }).finally(() => {
      if (handle.recoverySpawnPromise === trackedAttempt) handle.recoverySpawnPromise = null;
    });
    handle.recoverySpawnPromise = trackedAttempt;
    trackedAttempt.catch(noop);

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
    let failed = outcome?.timeout
      ? { result: 'recovery_timeout', reason: `native reattachment exceeded ${timeoutMs}ms` }
      : outcome?.error
        ? { result: 'recovery_exception', reason: String(outcome.error?.message ?? outcome.error) }
        : outcome?.ack?.ok !== true
          ? { result: 'recovery_refused', reason: outcome?.ack?.reason ?? 'adapter refused recovery' }
          : observedId !== expectedId
            ? { result: 'session_identity_mismatch', reason: `expected ${expectedId}, observed ${observedId ?? '(none)'}` }
            : null;
    if (!failed && (handle.processRef?.state === 'closed'
      || handle.processRef?.state === 'unconfirmed_after_restart'
      || ['dead', 'exited', 'stopping'].includes(handle.status))) {
      failed = { result: 'recovery_transport_closed', reason: 'native reattachment closed before admission committed' };
    }
    if (!failed) {
      const spawned = admission.events.filter((event) => event.kind === 'lifecycle.spawned');
      const unexpected = admission.events.filter((event) => event.kind !== 'lifecycle.spawned');
      if (spawned.length !== 1 || unexpected.length > 0) {
        failed = {
          result: 'recovery_protocol_violation',
          reason: spawned.length !== 1
            ? `attach-only adapter emitted ${spawned.length} provider-ready identities`
            : `attach-only adapter emitted pre-dispatch events: ${unexpected.map((event) => event.kind).join(',')}`,
        };
      }
    }

    if (failed) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.recovery_failed', actor: 'policy', payload: { ...failed, action: 'kill_untrusted_transport' },
      });
      await this._stopRecoveryTransport(handle, failed.result);
      return { ok: false, ...failed };
    }

    let activeTask;
    try {
      // Bind the durable refinement to the exact recovered request rather than the historical
      // first-turn request. No provider prompt has crossed the attach-only boundary yet.
      handle.sessionRequest = session;
      handle.sessionContext = context;
      activeTask = this._createCoordinationRecoveryRefinement(handle, task);
    } catch (err) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'recovery', requestedSeq: recoveryRequested.seq, reason: String(err?.message ?? err), action: 'kill_untrusted_transport' },
      });
      await this._stopRecoveryTransport(handle, 'recovery_refinement_aborted');
      throw err;
    }

    activeTask.status = 'working';
    activeTask.result = null;
    activeTask.verdict = null;
    activeTask.sessionRequest = session;
    activeTask.sessionContext = context;

    // Commit provider testimony only after the refinement exists. This can discover an exact
    // route mismatch, but attach-only guarantees that discovery still precedes provider work.
    handle.turnAdmission = null;
    for (const event of admission.events) {
      this._handleEvent(event, handle.vendor, { admittedReady: event.kind === 'lifecycle.spawned' });
    }
    if (handle.modelMismatch || handle.effortMismatch || ['dead', 'exited', 'stopping'].includes(handle.status)) {
      await this._stopRecoveryTransport(handle, 'recovery_route_mismatch');
      return { ok: false, result: 'recovery_route_mismatch' };
    }

    const adapterCardDigest = canonicalDigest(adapter.card());
    const route = {
      harness: handle.vendor,
      model: handle.modelResolved ?? null,
      effort: handle.effortResolved ?? null,
      serviceTier: handle.modelPolicy?.serviceTier ?? null,
      routeKey: handle.routeKey ?? null,
      adapterCardDigest,
    };
    const continuation = {
      schemaVersion: 1,
      taskId: activeTask.id,
      priorTaskId: task.id,
      workerId,
      sessionId: expectedId,
      processGeneration: handle.processGeneration,
      briefDigest: canonicalDigest(task.brief),
      contextDigest: canonicalDigest(context),
      routeDigest: canonicalDigest(route),
      adapterCardDigest,
    };
    let continuationIntent;
    try {
      const recorded = this._coordination.recordRecoveryContinuationIntent(continuation, {
        actor: opts.actor ?? 'orchestrator',
        key: `driver.recovery.continuation_intent:${activeTask.id}:${handle.processGeneration}`,
      });
      continuationIntent = recorded.event;
      if (recorded.dispatch?.status !== 'dispatch_unknown' || recorded.dispatch.intentSeq !== continuationIntent?.seq) {
        throw new Error('recovery continuation intent did not materialize exactly');
      }
    } catch (err) {
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'recovery', requestedSeq: recoveryRequested.seq, reason: 'continuation_intent_unavailable', action: 'kill_untrusted_transport' },
      });
      await this._stopRecoveryTransport(handle, 'recovery_continuation_intent_aborted');
      throw err;
    }

    // Native prompt methods can synchronously emit turn events before their Ack resolves. Keep
    // those observations private until the accepted receipt is durable.
    const dispatchAdmission = { events: [] };
    handle.turnAdmission = dispatchAdmission;
    let dispatchAck;
    let dispatchError = null;
    let dispatchTimer;
    const promptAttempt = Promise.resolve().then(() => (typeof adapter.promptBrief === 'function'
      ? adapter.promptBrief(workerId, task.brief)
      : adapter.prompt(workerId, task.brief, 'turn'))).then(
      (ack) => ({ ack }),
      (error) => ({ error }),
    );
    const promptTimeout = new Promise((resolvePromptTimeout) => {
      dispatchTimer = this._setTimeout(() => resolvePromptTimeout({ timeout: true }), timeoutMs);
      if (dispatchTimer && typeof dispatchTimer.unref === 'function') dispatchTimer.unref();
    });
    const dispatchOutcome = await Promise.race([promptAttempt, promptTimeout]);
    if (dispatchTimer != null) this._clearTimeout(dispatchTimer);
    if (dispatchOutcome.timeout) dispatchError = Object.assign(new Error(`recovery continuation dispatch exceeded ${timeoutMs}ms`), { code: 'dispatch_timeout' });
    else if (dispatchOutcome.error) dispatchError = dispatchOutcome.error;
    else dispatchAck = dispatchOutcome.ack;
    const stopWonDuringDispatch = () => this._stopWaiters.has(handle.id)
      || ['dead', 'exited', 'stopping'].includes(handle.status)
      || handle.processRef?.state === 'closed' || handle.processRef?.state === 'unconfirmed_after_restart';
    const dispatchHasFacts = dispatchAdmission.events.length > 0;
    const provenNotSent = !dispatchError && dispatchAck?.ok === false
      && dispatchAck.notSent === true && !dispatchHasFacts && !stopWonDuringDispatch();

    if (dispatchAck?.ok !== true && !provenNotSent) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      const unknownEvent = this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.recovery_dispatch_unknown', actor: 'policy',
        ...this._routeAttribution(handle, activeTask),
        payload: {
          code: dispatchError ? 'delivery_exception' : dispatchHasFacts ? 'contradictory_refusal' : 'not_sent_unproven',
          observedDispatchFacts: dispatchAdmission.events.slice(0, 16).map((event) => event.kind),
          action: 'kill_untrusted_transport',
        },
      });
      let unknownWriteError = null;
      try {
        const unknownEvidence = this._coordMapEvent(unknownEvent);
        const durable = this._coordination.task(activeTask.id);
        if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
          this._coordTransition(activeTask, 'failed', `task.failed:${activeTask.id}:recovery_dispatch_unknown`, unknownEvidence);
          activeTask.status = 'failed';
        }
      } catch (err) {
        unknownWriteError = err;
      }
      await this._stopRecoveryTransport(handle, 'recovery_dispatch_unknown');
      if (unknownWriteError) throw unknownWriteError;
      return {
        ok: false,
        result: 'dispatch_unknown',
        reason: String(dispatchError?.message ?? dispatchAck?.reason ?? 'recovery continuation dispatch is ambiguous'),
      };
    }

    if (provenNotSent) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      const refusedEvent = this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.recovery_dispatch_refused', actor: 'policy',
        ...this._routeAttribution(handle, activeTask),
        payload: {
          schemaVersion: 1,
          code: 'not_sent',
          taskId: activeTask.id,
          priorTaskId: task.id,
          workerId,
          sessionId: expectedId,
          processGeneration: handle.processGeneration,
          routeDigest: continuation.routeDigest,
          briefDigest: continuation.briefDigest,
          contextDigest: continuation.contextDigest,
          adapterCardDigest: continuation.adapterCardDigest,
          intentSeq: continuationIntent?.seq ?? null,
          observedDispatchFacts: [],
          action: 'kill_untrusted_transport',
        },
      });
      let refusalWriteError = null;
      try {
        const refusedEvidence = this._coordMapEvent(refusedEvent);
        const closed = this._coordination.completeRecoveryDispatch({
          disposition: 'refused', ...continuation, intentSeq: continuationIntent?.seq ?? null,
          code: 'not_sent', evidence: refusedEvidence,
        }, {
          actor: 'policy', key: `driver.recovery.dispatch_refused:${activeTask.id}:${handle.processGeneration}`,
        });
        activeTask.status = closed.task.status;
        activeTask.coordinationVersion = closed.task.version;
      } catch (err) {
        refusalWriteError = err;
      }
      await this._stopRecoveryTransport(handle, 'recovery_dispatch_refused');
      if (refusalWriteError) throw refusalWriteError;
      return {
        ok: false,
        result: 'dispatch_refused',
        reason: String(dispatchAck?.reason ?? 'adapter proved the continuation was not sent'),
      };
    }

    let dispatchReceipt;
    try {
      const accepted = this._coordination.completeRecoveryDispatch({
        disposition: 'accepted', ...continuation, intentSeq: continuationIntent?.seq ?? null,
      }, {
        actor: opts.actor ?? 'orchestrator',
        key: `driver.recovery.dispatch_accepted:${activeTask.id}:${handle.processGeneration}`,
      });
      dispatchReceipt = accepted.event;
    } catch (err) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      await this._stopRecoveryTransport(handle, 'recovery_dispatch_unknown');
      // The durable intent without an accepted/refused receipt is the replayable unknown marker.
      // Do not retry this continuation automatically.
      throw err;
    }

    const spawnedDuringDispatch = dispatchAdmission.events.some((event) => event.kind === 'lifecycle.spawned');
    if (stopWonDuringDispatch() || spawnedDuringDispatch) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      const code = spawnedDuringDispatch ? 'duplicate_provider_ready' : 'stop_won_after_dispatch';
      const racedEvent = this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.recovery_dispatch_not_exposed', actor: 'policy',
        ...this._routeAttribution(handle, activeTask),
        payload: { code, dispatchReceiptSeq: dispatchReceipt?.seq ?? null, action: 'kill_untrusted_transport' },
      });
      try {
        const evidence = this._coordMapEvent(racedEvent);
        const durable = this._coordination.task(activeTask.id);
        if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
          this._coordTransition(activeTask, 'failed', `task.failed:${activeTask.id}:recovery_dispatch_not_exposed`, evidence);
          activeTask.status = 'failed';
        }
      } catch (err) {
        await this._stopRecoveryTransport(handle, code);
        throw err;
      }
      await this._stopRecoveryTransport(handle, code);
      return { ok: false, result: spawnedDuringDispatch ? 'recovery_protocol_violation' : 'recovery_stopped_after_dispatch' };
    }

    try {
      const stamp = this._fences.bumpTurn(workerId);
      handle.status = 'working';
      handle.turnTerminalObserved = false;
      this._clearBudgetStop(handle);
      handle.turnAdmission = null;
      this._resetWatchdogTurn(handle);
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
        kind: 'control.recovery_attached', actor: 'orchestrator',
        payload: { sessionRef: handle.sessionRef, context, dispatchReceiptSeq: dispatchReceipt?.seq ?? null },
      });
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
        kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: { recovery: true },
        ...this._routeAttribution(handle, activeTask),
      });
      for (const event of dispatchAdmission.events) this._handleEvent(event, handle.vendor);
      return { ok: true, result: 'attached', handle: this._publicHandle(handle, { exposeRecovery: true }) };
    } catch (error) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      if (handle.status === 'working') handle.status = 'stopping';
      try { await this._stopRecoveryTransport(handle, 'recovery_exposure_unavailable'); }
      catch { /* preserve the first authoritative exposure failure */ }
      throw error;
    }
  }

  /** AC5: explicitly integrate an accepted captured commit. This never pushes. */
  integrate(workerId, opts = {}) {
    return this._withAuthorityOp(() => this._integrate(workerId, opts));
  }

  async _integrate(workerId, opts = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    if (!task || task.status !== 'completed' || !task.capturedSha) {
      throw new IntegrationError('integration requires an accepted captured task result', 'result_not_accepted');
    }
    if (task.review?.kind === 'oracle' && task.review?.knowledgeTarget?.kind === 'scratch.fact') {
      throw new IntegrationError('Scratch oracle worktrees are evidence-only and cannot be integrated', 'scratch_oracle_not_integrable');
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
    if (!['ff-only', 'structured'].includes(strategy)) {
      throw new IntegrationError(`unsupported integration strategy: ${strategy}`, 'unsupported_strategy');
    }
    if (!this._worktrees || typeof this._worktrees.integrate !== 'function') {
      throw new IntegrationError('worktree manager does not implement integration', 'integration_unavailable');
    }
    if (strategy === 'structured' && (typeof this._worktrees.stageStructuredIntegration !== 'function'
      || typeof this._worktrees.finalizeStructuredIntegration !== 'function'
      || typeof this._worktrees.inspectStructuredIntegration !== 'function'
      || typeof this._worktrees.removeStructuredIntegration !== 'function')) {
      throw new IntegrationError('worktree manager does not implement structured integration', 'integration_unavailable');
    }
    if (handle.status === 'working' || handle.status === 'blocked' || handle.status === 'stopping' || handle.status === 'pending') {
      throw new IntegrationError('worker must be idle, dead, exited, or orphaned before integration', 'worker_not_quiescent');
    }

    this._coordRecord('integration.requested', {
      taskId: task.id, workerId, strategy, sha: task.capturedSha,
      actor: opts.actor ?? 'orchestrator', effect: strategy === 'structured' ? 'staged_local_git_merge' : 'local_git_merge',
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

    let integrated; let structuredStage = null; let structuredVerifyPath = null; let structuredFinalizeStarted = false; let structuredToolchainProjection = null;
    try {
      if (strategy === 'ff-only') {
        integrated = await this._worktrees.integrate(task.capturedSha, { strategy });
      } else {
        structuredStage = await this._worktrees.stageStructuredIntegration(task.id, task.capturedSha);
        const created = await this._worktrees.createVerifyWorktree(`${task.id}-structured-merge`, structuredStage.stageSha);
        structuredVerifyPath = created?.path ?? null;
        structuredToolchainProjection = created?.toolchainProjection ?? null;
        const workerToolchainProjection = task.sessionContext?.toolchainProjection ?? null;
        if ((workerToolchainProjection || structuredToolchainProjection)
          && (!workerToolchainProjection || !structuredToolchainProjection || canonicalDigest(workerToolchainProjection) !== canonicalDigest(structuredToolchainProjection))) throw Object.assign(new Error('structured verification toolchain projection mismatch'), { code: 'structured_verification_environment_mismatch' });
        const verdict = await this._referee(task, { verification: { claimedExit: null } }, {
          pinnedVerification: task.brief.verification,
          sandbox: structuredVerifyPath,
        });
        const accepted = this._accept(verdict, {
          expectExit: task.brief.verification.expectExit,
          requireRedGreen: false,
          requireCoverage: false,
          requireMutation: false,
        });
        this._log.append({
          worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'integration.merge_reverified', actor: 'policy',
          ...this._routeAttribution(handle, task),
          payload: { strategy, stageSha: structuredStage.stageSha, verdict, accept: accepted, ...(structuredToolchainProjection ? { toolchainProjection: structuredToolchainProjection } : {}) },
        });
        if (!accepted) throw Object.assign(new Error('structured merge candidate failed fresh pinned verification'), { code: 'structured_verification_failed' });
        structuredFinalizeStarted = true;
        integrated = { ...(await this._worktrees.finalizeStructuredIntegration(structuredStage)), verdict, ...(structuredToolchainProjection ? { toolchainProjection: structuredToolchainProjection } : {}) };
      }
    } catch (err) {
      if (structuredVerifyPath) await this._worktrees.removeVerifyWorktree(structuredVerifyPath);
      if (structuredStage) await this._worktrees.removeStructuredIntegration(structuredStage);
      let structuredPostEffect = err?.postEffect === true || err?.code === 'structured_post_effect_inconsistent';
      if (strategy === 'structured' && structuredFinalizeStarted && structuredStage && !structuredPostEffect) {
        try { structuredPostEffect = (await this._worktrees.inspectStructuredIntegration(structuredStage)).effectApplied === true; }
        catch { /* the finalizer owns tagging when Git itself becomes unreadable after the effect */ }
      }
      if (strategy === 'structured' && structuredPostEffect) {
        const incompleteEvent = this._log.append({
          worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'integration.incomplete', actor: 'policy',
          ...this._routeAttribution(handle, task),
          payload: {
            strategy, beforeSha: structuredStage?.beforeSha ?? null, stageSha: structuredStage?.stageSha ?? null,
            sha: task.capturedSha, retainedResultRef: task.retainedResultRef, postEffect: true,
            reason: String(err?.message ?? err),
          },
        });
        const incompleteEvidence = this._coordMapEvent(incompleteEvent);
        this._coordRecord('integration.incomplete', {
          taskId: task.id, strategy, beforeSha: structuredStage?.beforeSha ?? null,
          stageSha: structuredStage?.stageSha ?? null, sha: task.capturedSha,
          retainedResultRef: task.retainedResultRef, postEffect: true,
          reason: String(err?.message ?? err), evidence: incompleteEvidence,
        }, `driver.integration.incomplete:${task.id}:${incompleteEvent.seq}`, 'policy');
        throw this._poisonIntegration(err);
      }
      const refusedEvent = this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'integration.refused', actor: 'policy',
        ...this._routeAttribution(handle, task),
        payload: { strategy, sha: task.capturedSha, retainedResultRef: task.retainedResultRef, reason: String(err?.message ?? err) },
      });
      const refusedEvidence = this._coordMapEvent(refusedEvent);
      this._coordRecord('integration.refused', {
        taskId: task.id, strategy, sha: task.capturedSha, retainedResultRef: task.retainedResultRef,
        reason: String(err?.message ?? err), evidence: refusedEvidence,
      }, `driver.integration.refused:${task.id}:${refusedEvent.seq}`, 'policy');
      throw new IntegrationError(String(err?.message ?? err), err?.code?.startsWith('structured_') ? err.code : 'non_fast_forward_or_dirty');
    }
    if (structuredVerifyPath) await this._worktrees.removeVerifyWorktree(structuredVerifyPath);
    if (structuredStage) await this._worktrees.removeStructuredIntegration(structuredStage);
    if (task.retainedResultRef && typeof this._worktrees.releaseResult === 'function') {
      try { await this._worktrees.releaseResult(task.retainedResultRef); } catch { /* merged HEAD now retains the result */ }
      task.retainedResultRef = null;
    }
    const integration = Object.freeze({ ...integrated, strategy, actor: opts.actor ?? 'orchestrator' });
    const integrationEvent = this._log.append({
      worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'integration.completed', actor: opts.actor ?? 'orchestrator', payload: integration,
      ...this._routeAttribution(handle, task),
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
    this._activeInteractionIds.add(requestId);
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

  _publicHandle(handle, opts = {}) {
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
      processRef: handle.processRef ? { ...handle.processRef } : null,
      review: this._tasks.get(handle.taskId)?.review ?? null,
      taskId: handle.taskId,
      runId: this._tasks.get(handle.taskId)?.runId ?? handle.runId ?? null,
      worktree: handle.worktree,
      fence,
      turnEpoch,
      status: handle.recoveryPending === true && opts.exposeRecovery !== true ? 'orphaned' : handle.status,
      pendingApprovalId: handle.pendingApprovalId,
      pendingQuestionId: handle.pendingQuestionId,
      budgetUsed: { ...handle.budgetUsed },
      providerGovernance: handle.providerGovernance ?? null,
      providerPolicyDigest: handle.providerPolicyDigest ?? null,
      providerTurn: handle.providerTurn ? {
        admissionSeq: handle.providerTurn.admissionSeq,
        phase: handle.providerTurn.phase,
        usage: { ...handle.providerTurn.usage },
        providerCalls: handle.providerTurn.providerCalls,
        toolCalls: handle.providerTurn.toolCalls,
        violation: handle.providerTurn.violation,
        sealed: handle.providerTurn.sealed,
      } : null,
      providerTerminalSeal: handle.providerTerminalSeal ?? null,
      providerPolicyHardExceeded: handle.providerPolicyHardExceeded === true,
      providerTelemetryFailed: handle.providerTelemetryFailed === true,
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

  send(workerId, message, mode, opts = {}) {
    return this._withAuthorityOp(() => this._send(workerId, message, mode, opts));
  }

  async _send(workerId, message, mode, opts = {}) {
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

  /** Build one bounded Cartographer slice and deliver it as a fenced, addressed nudge.
   * The capability owns evidence production; the Coordinator alone owns worker delivery. */
  orientWorker(workerId, args, note, ctx = {}) {
    return this._withAuthorityOp(() => this._orientWorker(workerId, args, note, ctx));
  }

  async _orientWorker(workerId, args, note, ctx = {}) {
    this.tick();
    const handle = this._getWorker(workerId);
    if (!Number.isSafeInteger(ctx.expectedFence)) throw new TypeError('orientation push requires expectedFence');
    if (typeof note !== 'string' || note.length === 0 || Buffer.byteLength(note) > 2_048 || note.includes('\0')) throw new TypeError('orientation push note is invalid');
    const precheck = this._fences.check(workerId, { fence: ctx.expectedFence });
    if (!precheck.ok) {
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._fences.current(workerId).turnEpoch,
        kind: 'control.stale_rejected', actor: ctx.actor ?? 'orchestrator',
        payload: { op: 'orientWorker', attempted: ctx.expectedFence, current: precheck.current, phase: 'pre_capability' },
      });
      return { ok: false, result: 'stale_fence', current: precheck.current };
    }
    if (handle.status === 'stopping') return { ok: false, result: 'worker_stopping' };
    if (!['working', 'blocked'].includes(handle.status)) return { ok: false, result: 'worker_not_active' };

    const claim = await this._capabilityRegistry().invoke('cartographer-quartermaster', 'orientation.slice', args, {
      budgetTokens: ctx.budgetTokens, signal: ctx.signal, actor: ctx.actor ?? 'orchestrator',
    });
    if (!['ok', 'partial', 'needs_resume'].includes(claim.status) || !claim.refs?.[0]?.digest) {
      throw Object.assign(new Error('orientation capability did not produce a deliverable slice'), { code: 'orientation_not_deliverable' });
    }
    const provenanceKeys = ['index_epoch', 'overlay_digest', 'staleness', 'artifactDigest', 'deterministic', 'mergeAuthority', 'verificationAuthority'];
    const message = {
      kind: 'baton.orientation.slice', note,
      slice: {
        op: claim.op, status: claim.status, summary: claim.summary, payload: claim.payload,
        refs: claim.refs.map((ref) => Object.fromEntries(Object.entries(ref).filter(([key]) => ['kind', 'handle', 'digest', 'bytes', 'mediaType'].includes(key)))),
        ...(claim.cursor ? { cursor: claim.cursor } : {}),
        provenance: Object.fromEntries(Object.entries(claim.provenance).filter(([key]) => provenanceKeys.includes(key))),
      },
    };
    const slot = (handle.sendChain ?? Promise.resolve()).then(() => this._deliver(handle, message, 'nudge', {
      expectedFence: ctx.expectedFence, actor: ctx.actor ?? 'orchestrator', internalKindToken: ORIENTATION_DELIVERY,
    }));
    handle.sendChain = slot.then(noop, noop);
    const ack = await slot;
    return {
      ...ack, sliceId: `art:sha256:${claim.refs[0].digest}`, sliceDigest: claim.refs[0].digest,
      status: claim.status, ...(claim.cursor ? { cursor: claim.cursor } : {}),
    };
  }

  async _deliver(handle, message, mode, opts) {
    const workerId = handle.id;
    const task = this._tasks.get(handle.taskId);
    // SC14: delivery-slot acquisition is the authority boundary. A queued continuation cannot
    // cross a finalized stop, and a terminal task cannot be resurrected by a surviving session.
    if (handle.status === 'stopping') return { ok: false, result: 'worker_stopping' };
    if (opts.internalKindToken === ORIENTATION_DELIVERY && !['working', 'blocked'].includes(handle.status)) return { ok: false, result: 'worker_not_active' };
    const card = this._adapters[handle.vendor]?.card();
    const reusableFollowUp = mode === 'turn'
      && handle.status === 'idle'
      && task && TERMINAL_TASK_STATUSES.has(task.status)
      && ['native', 'emulated'].includes(card?.sessions?.multiTurn);
    if (reusableFollowUp && task.brief?.goalPlan) {
      return { ok: false, result: 'goal_plan_continuation_not_authorized' };
    }
    if (reusableFollowUp && task.runId && this._coordination.run?.(task.runId)?.status === 'sealed') {
      throw Object.assign(new Error(`run ${task.runId} is sealed`), { name: 'CoordinationRefusal', code: 'run_sealed' });
    }
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
          actor: opts.actor ?? 'orchestrator',
          payload: { op: 'send', mode, attempted: opts.expectedFence, current: preCheck.current, phase: 'pre_delivery' },
        });
        return { ok: false, result: 'stale_fence', current: preCheck.current };
      }
    }

    if (handle.providerGovernance && mode === 'steer' && card?.verbs?.steer === 'emulated') {
      return this._interruptThenGoverned(handle, message, opts.actor ?? 'orchestrator');
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
        actor: opts.actor ?? 'orchestrator',
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

    const kind = opts.internalKindToken === ORIENTATION_DELIVERY
      ? 'knowledge.map_served'
      : mode === 'nudge' ? 'control.nudge' : mode === 'steer' ? 'control.steer' : 'control.send';
    const ev = { worker: workerId, harness, turnEpoch: currentTurnEpoch, kind, actor: opts.actor ?? 'orchestrator', payload: { message } };
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

    const providerAdmission = this._admitProviderTurn(handle, task, 'follow_up');
    if (!providerAdmission.ok) return { ok: false, result: 'provider_turn_refused', reason: providerAdmission.code };

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
      else this._releaseProviderTurnAdmission(handle, 'delivery_exception');
      return { ok: false, result: 'delivery_exception', reason: String(err?.message ?? err) };
    }
    // A crash/exit is intentionally processed immediately instead of queued. It wins over an Ack
    // from the same call and can never be overwritten by reopening the prior terminal task.
    if (handle.status !== 'idle') {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      this._releaseProviderTurnAdmission(handle, 'worker_not_active');
      return { ok: false, result: 'worker_not_active' };
    }
    if (!ack || ack.ok !== true) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      if (admission.events.length > 0) this._rejectContradictoryAdmission(handle, admission, ack?.reason);
      else this._releaseProviderTurnAdmission(handle, 'delivery_refused');
      return { ok: false, result: ack?.reason ?? 'delivery_refused', reason: ack?.reason };
    }

    const stamp = this._fences.bumpTurn(workerId);
    let activeTask;
    try {
      activeTask = this._createCoordinationRefinement(handle, task, 'follow_up');
    } catch (err) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      this._releaseProviderTurnAdmission(handle, 'follow_up_refinement_aborted');
      handle.status = 'orphaned';
      this._scheduleUntrustedTransportReap(handle, this._adapters[handle.vendor], {
        reason: 'follow_up_refinement_aborted',
        removeWorktree: true,
      });
      this._log.append({
        worker: workerId, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'follow_up', requestedSeq: requestedEvent.seq, reason: String(err?.message ?? err), action: 'kill_untrusted_transport' },
      });
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
      ...this._routeAttribution(handle, activeTask),
      payload: { followUp: true, message },
    });
    for (const event of admission.events) this._handleEvent(event, handle.vendor, { admittedReady: event.kind === 'lifecycle.spawned' });
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
    if (this._startupCleanupPending > 0) await this.startupReady();
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
    if (then !== undefined && handle.providerGovernance) return this._interruptThenGoverned(handle, then, actor);
    return this._beginStop(handle, 'interrupt', then, actor);
  }

  async _interruptThenGoverned(handle, then, actor) {
    // Never delegate `then` to an adapter: Codex/Grok can otherwise create the next provider
    // turn internally before Baton has sealed this turn and reserved the next exact route.
    const stopped = await this._beginStop(handle, 'interrupt', undefined, actor);
    if (!stopped?.ok || stopped.result !== 'confirmed') return stopped;
    const task = this._tasks.get(handle.taskId);
    const follow = await this._deliverFollowUp(handle, task, then, { actor });
    return follow.ok
      ? { ...stopped, followUp: 'admitted' }
      : { ok: false, result: 'follow_up_refused', stopped: stopped.result, reason: follow.reason ?? follow.result };
  }

  async kill(workerId, actor = 'orchestrator', opts = {}) {
    const startup = opts.startupAuthority === this._startupRecoveryAuthority && this._startupRecoveryState === 'pending';
    const draining = opts.drainToken === this._drainKillToken;
    if (this._fatalError) {
      if (opts.emergency !== true && !startup && !draining) throw this._fatalError;
      return this._emergencyKillUnlogged(this._getWorker(workerId));
    }
    if (!startup && !draining) {
      if (this._startupCleanupPending > 0) await this.startupReady();
      this.tick();
    }
    else if (this._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' });
    const handle = this._getWorker(workerId);
    if (opts.expectedFence !== undefined) {
      const check = this._fences.check(workerId, { fence: opts.expectedFence });
      if (!check.ok) return { ok: false, result: 'stale_fence', current: check.current };
    }
    if (handle.status === 'dead' && (handle.localAuthority !== true
      || (handle.processRef?.state === 'closed' && handle.cleanupPending !== true))) {
      return { ok: true, result: 'already_dead' };
    }
    if (handle.status === 'orphaned' && !(handle.localAuthority === true
      && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(handle.processRef?.state))) {
      return { ok: false, result: 'session_not_attached', reason: 'restart replay found no controllable adapter session' };
    }
    // CI3: a crashed/exited child cannot emit another kill.confirmed. Treat its authoritative
    // terminal event as the confirmation, finish cleanup now, and never arm an unfulfillable wait.
    if (handle.status === 'exited') {
      handle.status = 'dead';
      const runtimeRemoved = this._removeRuntimeScope(handle);
      await this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId));
      if (!runtimeRemoved) return { ok: false, result: 'cleanup_failed' };
      return { ok: true, result: 'already_dead' };
    }
    return this._beginStop(handle, 'kill', undefined, actor);
  }

  _emergencyKillUnlogged(handle) {
    if ((handle.status === 'dead' || handle.status === 'exited')
      && (!handle.processRef || handle.processRef.state === 'closed')) {
      const runtimeRemoved = this._removeRuntimeScope(handle);
      return this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId)).then(() => {
        if (!runtimeRemoved) return { ok: false, result: 'cleanup_failed_unlogged', auditUnavailable: true };
        handle.localAuthority = false;
        return { ok: true, result: 'already_dead_unlogged', auditUnavailable: true };
      }, () => ({ ok: false, result: 'cleanup_failed_unlogged', auditUnavailable: true }));
    }
    if (!this._adapters[handle.vendor]
      || (handle.status === 'orphaned' && handle.localAuthority !== true
        && !['initializing', 'ready'].includes(handle.processRef?.state))) {
      return Promise.resolve({ ok: false, result: 'session_not_attached', auditUnavailable: true });
    }
    const existing = this._fatalStopWaiters.get(handle.id);
    if (existing) return new Promise((resolve) => existing.resolvers.push(resolve));

    if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
      handle.spawnAbort.abort({ mode: 'kill', actor: 'policy', emergency: true });
    }
    if (handle.recoverySpawnPending === true) handle.recoveryProviderReleaseDeferred = true;
    if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) {
      handle.recoverySpawnAbort.abort({ mode: 'kill', actor: 'policy', emergency: true });
    }
    handle.status = 'stopping';
    this._clearBudgetStop(handle);
    this._clearWatchdog(handle);
    const waiter = { workerId: handle.id, resolvers: [], settled: false, timerHandle: null };
    this._fatalStopWaiters.set(handle.id, waiter);
    waiter.timerHandle = this._setTimeout(() => {
      if (waiter.settled) return;
      waiter.settled = true;
      this._fatalStopWaiters.delete(handle.id);
      const result = { ok: false, result: 'confirmation_timeout_unlogged', auditUnavailable: true };
      for (const resolve of waiter.resolvers) resolve(result);
    }, this._stopDeadlineMs);
    if (waiter.timerHandle && typeof waiter.timerHandle.unref === 'function') waiter.timerHandle.unref();

    Promise.resolve().then(() => this._adapters[handle.vendor].kill(handle.id)).then((ack) => {
      if (waiter.settled) return;
      // Session adapters may truthfully report that the native transport was already terminal;
      // no later kill.confirmed event can exist in that case. Treat the terminal Ack as the
      // confirmation and finish the same runtime/worktree reap before releasing authority.
      if (ack?.ok === true && ack?.terminal === true
        && (!handle.processRef || handle.processRef.state === 'closed')) {
        waiter.settled = true;
        if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
        this._fatalStopWaiters.delete(handle.id);
        handle.status = 'dead';
        const runtimeRemoved = this._removeRuntimeScope(handle);
        this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId)).then(() => {
          if (runtimeRemoved) handle.localAuthority = false;
          const result = runtimeRemoved
            ? { ok: true, result: 'confirmed_unlogged', auditUnavailable: true }
            : { ok: false, result: 'cleanup_failed_unlogged', auditUnavailable: true };
          for (const resolve of waiter.resolvers) resolve(result);
        }, () => {
          for (const resolve of waiter.resolvers) resolve({ ok: false, result: 'cleanup_failed_unlogged', auditUnavailable: true });
        });
        return;
      }
      if (ack?.ok !== false) return;
      waiter.settled = true;
      if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
      this._fatalStopWaiters.delete(handle.id);
      const result = { ok: false, result: 'adapter_refused_unlogged', auditUnavailable: true, reason: ack.reason ?? null };
      for (const resolve of waiter.resolvers) resolve(result);
    }, (error) => {
      if (waiter.settled) return;
      waiter.settled = true;
      if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
      this._fatalStopWaiters.delete(handle.id);
      const result = { ok: false, result: 'adapter_failed_unlogged', auditUnavailable: true, reason: String(error?.message ?? error) };
      for (const resolve of waiter.resolvers) resolve(result);
    });
    return new Promise((resolve) => waiter.resolvers.push(resolve));
  }

  _observeEmergencyTerminal(event, sourceVendor = null) {
    if (!['kill.confirmed', 'lifecycle.process_closed'].includes(event?.kind)) return;
    const handle = this._workers.get(event.worker);
    if (!handle) return;
    if (sourceVendor !== null && sourceVendor !== handle.vendor) {
      if (handle.localAuthority === true) this._emergencyKillUnlogged(handle).catch(noop);
      return;
    }
    if (event.kind === 'lifecycle.process_closed') {
      const current = handle.processRef;
      const exact = validProcessClosedPayload(event.payload) && current
        && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(current.state)
        && event.payload.generation === current.generation
        && event.payload.pid === current.pid
        && event.payload.processGroupId === current.processGroupId
        && event.payload.ready === current.ready;
      if (!exact) {
        if (handle.localAuthority === true) this._emergencyKillUnlogged(handle).catch(noop);
        return;
      }
      handle.emergencyProcessClosed = { ...event.payload };
      handle.processRef = { ...current, state: 'closed', ready: event.payload.ready, closedSeq: null };
    } else if (handle.processRef && handle.processRef.state !== 'closed') {
      return;
    }
    const waiter = this._fatalStopWaiters.get(event.worker);
    if (!waiter || waiter.settled) {
      if (event.kind === 'lifecycle.process_closed') {
        handle.status = 'exited';
        const runtimeRemoved = this._removeRuntimeScope(handle);
        this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId)).then(() => {
          if (runtimeRemoved) handle.localAuthority = false;
        }, noop);
      }
      return;
    }
    waiter.settled = true;
    if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
    this._fatalStopWaiters.delete(event.worker);
    handle.status = 'dead';
    const runtimeRemoved = this._removeRuntimeScope(handle);
    this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId)).then(() => {
      if (runtimeRemoved) handle.localAuthority = false;
      const result = runtimeRemoved
        ? { ok: true, result: 'confirmed_unlogged', auditUnavailable: true }
        : { ok: false, result: 'cleanup_failed_unlogged', auditUnavailable: true };
      for (const resolve of waiter.resolvers) resolve(result);
    }, () => {
      for (const resolve of waiter.resolvers) resolve({ ok: false, result: 'cleanup_failed_unlogged', auditUnavailable: true });
    });
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
        this._trackAuthorityPromise(() => this._resolveRecord(handle.pendingApprovalId, { decision: 'cancel' }, actor), this._drainState === 'draining').catch(noop);
      } else if (handle.pendingQuestionId) {
        this._trackAuthorityPromise(() => this._resolveRecord(handle.pendingQuestionId, { decision: 'cancel' }, actor), this._drainState === 'draining').catch(noop);
      }
    }
    if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) {
      handle.spawnAbort.abort({ mode, actor });
    }
    if (handle.recoverySpawnPending === true) handle.recoveryProviderReleaseDeferred = true;
    if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) {
      handle.recoverySpawnAbort.abort({ mode, actor });
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
      this._settlePlanNodeBudget(task.id);
    }
    return result.task;
  }

  _settlePlanNodeBudget(taskOrId) {
    if (!this._coordination || typeof this._coordination.settlePlanNodeBudget !== 'function') return null;
    const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId?.id;
    if (!taskId) return null;
    const durable = this._coordination.task(taskId);
    if (!durable || !TERMINAL_TASK_STATUSES.has(durable.status)) return null;
    return this._coordination.settlePlanNodeBudget(taskId, {
      actor: 'policy', key: `plan.budget:${canonicalDigest({ taskId, terminalEvent: durable.acceptanceRevocation?.priorTerminalEvent ?? durable.terminalEvent })}`,
    });
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
        if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) handle.recoverySpawnAbort.abort({ reason: 'coordination_write_unavailable' });
      }
    }
    return this._fatalError;
  }

  _poisonIntegration(err) {
    if (!this._fatalError) {
      const fatal = new Error(`structured integration crossed its Git effect boundary before final validation completed: ${err?.message ?? err}`, { cause: err });
      fatal.name = 'IntegrationWriteIntegrityError';
      fatal.code = 'structured_post_effect_inconsistent';
      this._fatalError = fatal;
      for (const handle of this._workers.values()) {
        if (handle.spawnAbort && !handle.spawnAbort.signal.aborted) handle.spawnAbort.abort({ reason: fatal.code });
        if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) handle.recoverySpawnAbort.abort({ reason: fatal.code });
      }
    }
    return this._fatalError;
  }

  _createCoordinationRefinement(handle, prior, relation) {
    if (!this._coordination) return prior;
    if (prior.brief?.goalPlan) {
      throw Object.assign(new Error('plan-bound continuation requires a separately approved plan node'), {
        name: 'CoordinationRefusal', code: 'goal_plan_continuation_not_authorized',
      });
    }
    const id = `${prior.id}:refinement-${++this._refinementSeq}`;
    const created = this._coordination.createTask({
      id, brief: prior.brief, deps: [], refines: prior.id, taskType: prior.taskType,
      runId: prior.runId ?? null,
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
    handle.runId = next.runId ?? null;
    return next;
  }

  _createCoordinationRecoveryRefinement(handle, prior) {
    if (!this._coordination) return prior;
    if (prior.brief?.goalPlan) {
      throw Object.assign(new Error('plan-bound recovery requires a separately approved plan node'), {
        name: 'CoordinationRefusal', code: 'goal_plan_continuation_not_authorized',
      });
    }
    const id = `recovery:${canonicalDigest({
      priorTaskId: prior.id,
      workerId: handle.id,
      sessionId: handle.sessionRequest?.id ?? handle.sessionRef?.id ?? null,
      processGeneration: handle.processGeneration,
    })}`;
    const result = this._coordination.createAndClaimRecoveryRefinement({
      id, brief: prior.brief, deps: [], refines: prior.id, taskType: prior.taskType,
      runId: prior.runId ?? null,
      reservedWorkerId: handle.id, vendorRequested: handle.vendor,
      modelRequested: handle.modelRequested, modelPolicy: handle.modelPolicy,
      effortRequested: handle.effortRequested,
      sessionRequest: handle.sessionRequest, relation: 'recovery',
    }, {
      harnessRequested: handle.vendor,
      harnessResolved: handle.vendor,
      modelRequested: handle.modelRequested ?? null,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      effortRequested: handle.effortRequested ?? null,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      routeKey: handle.routeKey ?? null,
    }, {
      actor: 'orchestrator', key: `task.created:${id}`,
    });
    const next = {
      ...prior, id, deps: [], refines: prior.id, status: 'working', result: null, verdict: null,
      capturedSha: null, integration: null, retainedResultRef: null, publication: null, review: null,
      coordinationVersion: result.task.version,
      sessionRequest: handle.sessionRequest,
    };
    this._tasks.set(id, next);
    this._taskOrder.push(id);
    handle.taskId = id;
    handle.runId = next.runId ?? null;
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
    await Promise.resolve(this._worktrees.remove(ownerTaskId));
  }

  _removeOwnedTaskWorktree(handle, task) {
    if (!handle) return this._removeTaskWorktree(task);
    if (handle.cleanupPromise) return handle.cleanupPromise;
    handle.cleanupPending = true;
    const cleanup = this._removeTaskWorktree(task).then(() => {
      handle.worktree = null;
      handle.ownedWorktreeAuthority = false;
      // Preserve the historical worker path on the task: the mandatory trust/freshness guard
      // compares it with later verification sandboxes even after the checkout was reaped.
      handle.cleanupPending = handle.runtimeScope?.active === true;
      if (!handle.cleanupPending) handle.cleanupError = null;
    }, (error) => {
      handle.cleanupPending = true;
      handle.cleanupError = 'worktree_cleanup_failed';
      throw error;
    }).finally(() => {
      if (handle.cleanupPromise === cleanup) handle.cleanupPromise = null;
    });
    handle.cleanupPromise = cleanup;
    return cleanup;
  }

  async _cleanupClosedTransport(handle, task) {
    const runtimeRemoved = this._removeRuntimeScope(handle);
    if (task?.status === 'verifying') {
      handle.cleanupAfterVerification = true;
      if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
      return;
    }
    await this._removeOwnedTaskWorktree(handle, task);
    if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
    handle.localAuthority = false;
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
    if (!handle || !this._runtimeScopes || typeof this._runtimeScopes.remove !== 'function') return true;
    try { this._runtimeScopes.remove(handle.id); } catch {
      handle.cleanupPending = true;
      handle.cleanupError = 'runtime_cleanup_failed';
      return false;
    }
    handle.runtimeLease = null;
    if (handle.runtimeScope) handle.runtimeScope = { ...handle.runtimeScope, active: false };
    if (!handle.cleanupPromise) handle.cleanupPending = false;
    handle.cleanupError = null;
    return true;
  }

  _scheduleUntrustedTransportReap(handle, adapter, opts = {}) {
    let cleanupPromise = null;
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const runtimeRemoved = this._removeRuntimeScope(handle);
        if (opts.removeWorktree === true) await this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId));
        if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
        // Recovery reuses a durable session checkout. If policy intentionally retains it, it is
        // historical/session evidence after exact process close rather than live host authority.
        if (opts.removeWorktree !== true) handle.ownedWorktreeAuthority = false;
        handle.localAuthority = false;
      })();
      return cleanupPromise;
    };
    const current = handle.processRef;
    if (!current || !['initializing', 'ready'].includes(current.state)) {
      const timerHandle = this._setTimeout(() => { cleanup().catch(noop); }, this._stopDeadlineMs);
      if (timerHandle && typeof timerHandle.unref === 'function') timerHandle.unref();
      Promise.resolve().then(() => adapter.kill(handle.id)).catch(noop).finally(() => {
        this._clearTimeout(timerHandle);
        cleanup().catch(noop);
      });
      return;
    }

    const record = {
      generation: current.generation,
      pid: current.pid,
      processGroupId: current.processGroupId,
      reason: opts.reason ?? 'untrusted_transport',
      cleanup,
      timerHandle: null,
    };
    handle.untrustedTransportReap = record;
    record.timerHandle = this._setTimeout(() => {
      if (handle.untrustedTransportReap !== record) return;
      handle.processRef = handle.processRef?.generation === record.generation
        && handle.processRef?.pid === record.pid
        && ['initializing', 'ready'].includes(handle.processRef?.state)
        ? { ...handle.processRef, state: 'unconfirmed_after_restart' }
        : handle.processRef;
      try {
        this._log.append({
          worker: handle.id,
          harness: this._harnessOf(handle.vendor),
          turnEpoch: this._safeTurnEpoch(handle),
          kind: 'control.untrusted_transport_forced_disposition',
          actor: 'policy',
          payload: {
            generation: record.generation,
            pid: record.pid,
            processGroupId: record.processGroupId,
            reason: record.reason,
          },
        });
      } catch {
        // append() already poisoned coordinator health; timer callbacks must never escape and
        // crash the host process. Exact close is still required before owned resources move.
      }
    }, this._stopDeadlineMs);
    if (record.timerHandle && typeof record.timerHandle.unref === 'function') record.timerHandle.unref();
    Promise.resolve().then(() => adapter.kill(handle.id)).catch(noop);
  }

  _releaseRecoveryProviderTurn(handle, reason) {
    try {
      this._releaseProviderTurnAdmission(handle, reason);
      return null;
    } catch (error) {
      // A poisoned audit sink cannot leave an already-terminated provider reservation live in
      // memory. The fatal error still escapes, but the coordinator may never advertise this seat
      // as reusable merely because the release record itself could not be persisted.
      if (handle.providerTurn && !handle.providerTurn.sealed) {
        handle.providerTurn.sealed = true;
        handle.providerTurn.violation ??= reason;
      }
      return error;
    }
  }

  async _stopRecoveryTransport(handle, reason) {
    // Recovery teardown uses the ordinary confirmation protocol. A kill Ack is merely request
    // admission; cleanup waits for kill.confirmed and, for a started generation, its correlated
    // process_closed. If coordination is poisoned, the stop-only emergency path retains the same
    // physical proof requirement without pretending it was durably audited.
    handle.recoveryStopReason = reason;
    if (handle.recoverySpawnPending === true) handle.recoveryProviderReleaseDeferred = true;
    if (handle.recoverySpawnAbort && !handle.recoverySpawnAbort.signal.aborted) {
      handle.recoverySpawnAbort.abort({ reason });
    }
    let stopped;
    if ((handle.status === 'dead' && handle.localAuthority !== true
      && (!handle.processRef || handle.processRef.state === 'closed') && handle.cleanupPending !== true)
      || (!this._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed'))) {
      stopped = { ok: true, result: 'already_stopped' };
    } else if (this._fatalError) {
      stopped = await this._emergencyKillUnlogged(handle);
    } else {
      stopped = await this._beginStop(handle, 'kill', undefined, 'policy');
      if (!stopped?.ok && stopped?.result !== 'forced') {
        this._log.append({
          worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'control.recovery_reap_unconfirmed', actor: 'policy', payload: { reason },
        });
      }
    }
    const transportConfirmed = ['confirmed', 'already_stopped', 'confirmed_unlogged', 'already_dead_unlogged'].includes(stopped?.result)
      || (stopped?.result === 'cleanup_failed' && handle.status === 'dead'
        && (!handle.processRef || handle.processRef.state === 'closed'));
    if (transportConfirmed && handle.recoverySpawnPending !== true) {
      handle.recoveryStopReason = null;
      handle.recoveryProviderReleaseDeferred = false;
      const releaseError = this._releaseRecoveryProviderTurn(handle, reason);
      if (releaseError) throw releaseError;
    }
    return stopped;
  }

  _finishUntrustedTransportReap(handle, processRef) {
    const record = handle.untrustedTransportReap;
    if (!record || record.generation !== processRef.generation || record.pid !== processRef.pid
      || record.processGroupId !== processRef.processGroupId) return;
    if (record.timerHandle != null) this._clearTimeout(record.timerHandle);
    handle.untrustedTransportReap = null;
    record.cleanup().catch(noop);
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
    handle.scopeOrientation = { count: 0, lastScheduledAt: null, inFlight: new Set(), violations: new Set(), suppressed: new Set() };
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

  _scheduleScopeOrientation(handle, path) {
    const policy = this._watchdog.orientation;
    if (!policy) return { scheduled: false, reason: 'policy_unavailable' };
    const state = handle.scopeOrientation ??= { count: 0, lastScheduledAt: null, inFlight: new Set(), violations: new Set(), suppressed: new Set() };
    const key = String(path);
    if (state.violations.has(key)) return { scheduled: false, reason: 'duplicate_path' };
    state.violations.add(key);
    const now = this._now();
    let reason = null;
    if (state.inFlight.size > 0) reason = 'refresh_in_flight';
    else if (state.lastScheduledAt !== null && now - state.lastScheduledAt < policy.cooldownMs) reason = 'cooldown';
    else if (state.count >= policy.maxRefreshesPerTurn) reason = 'turn_limit';
    if (reason) {
      const suppression = `${reason}:${key}`;
      if (!state.suppressed.has(suppression)) {
        state.suppressed.add(suppression);
        this._log.append({
          worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
          kind: 'health.scope_refresh_suppressed', actor: 'policy',
          payload: { path: key, reason, cooldownMs: policy.cooldownMs, maxRefreshesPerTurn: policy.maxRefreshesPerTurn, mechanical: true },
        });
      }
      return { scheduled: false, reason };
    }
    state.count += 1; state.lastScheduledAt = now; state.inFlight.add(key);
    const expectedFence = this._fences.current(handle.id).fence;
    let observed = key.slice(0, 512);
    let note = `${policy.notePrefix} Observed outside-scope path: ${observed}`;
    while (Buffer.byteLength(note) > 2_048 && observed.length > 0) {
      observed = observed.slice(0, -1);
      note = `${policy.notePrefix} Observed outside-scope path: ${observed}`;
    }
    Promise.resolve().then(() => this.orientWorker(handle.id, {
      indexEpoch: policy.indexEpoch, focus: policy.focus, shape: policy.shape,
    }, note, { actor: 'policy', budgetTokens: policy.budgetTokens, expectedFence })).then((ack) => {
      if (ack?.ok === true) return;
      this._log.append({
        worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'health.scope_refresh_refused', actor: 'policy',
        payload: { path: key, reason: ack?.result ?? 'orientation_refused', mechanical: true },
      });
    }).catch((error) => {
      this._log.append({
        worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
        kind: 'health.scope_refresh_refused', actor: 'policy',
        payload: { path: key, reason: typeof error?.code === 'string' ? error.code : 'orientation_failed', mechanical: true },
      });
    }).finally(() => state.inFlight.delete(key)).catch(noop);
    return { scheduled: true, reason: null };
  }

  _normalizeUsage(handle, payload) {
    const source = payload?.source ?? 'unknown';
    const wireAccounting = payload?.accounting ?? (payload?.tokenUsage ? 'cumulative' : 'delta');
    const governed = handle.providerGovernance != null;
    const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
    const tokenTotal = payload?.tokenUsage?.total;
    const tokensReported = own(payload, 'tokens') || own(payload, 'totalTokens') || own(tokenTotal, 'totalTokens');
    const usdReported = own(payload, 'usd') || own(payload, 'totalCostUsd');
    const rawTokens = own(payload, 'tokens') ? payload.tokens
      : own(payload, 'totalTokens') ? payload.totalTokens
        : own(tokenTotal, 'totalTokens') ? tokenTotal.totalTokens : 0;
    const rawUsd = own(payload, 'usd') ? payload.usd : own(payload, 'totalCostUsd') ? payload.totalCostUsd : 0;
    if (governed && !['delta', 'cumulative'].includes(wireAccounting)) return { invalidCode: 'usage_accounting_invalid' };
    if (governed && ((tokensReported && (!Number.isSafeInteger(rawTokens) || rawTokens < 0))
      || (usdReported && usdToNanos(rawUsd) === null))) {
      return { invalidCode: 'usage_value_invalid' };
    }
    const normalizedRawTokens = governed ? rawTokens : Number(rawTokens);
    const normalizedRawUsd = governed ? usdFromNanos(usdToNanos(rawUsd)) : Number(rawUsd);
    const counterId = payload?.counterId ?? source;
    if (governed && (typeof counterId !== 'string' || counterId.length === 0 || Buffer.byteLength(counterId) > 256 || counterId.includes('\0'))) return { invalidCode: 'usage_counter_invalid' };
    const tokenMetric = payload?.tokenMetric ?? null;
    if (governed && tokensReported) {
      const expectedMetric = this._adapters[handle.vendor]?.card()?.governance?.usage?.tokenMetric ?? null;
      if (typeof tokenMetric !== 'string' || tokenMetric.length === 0 || Buffer.byteLength(tokenMetric) > 256
        || tokenMetric.includes('\0') || tokenMetric !== expectedMetric) return { invalidCode: 'usage_token_metric_invalid' };
    }
    const deltaFor = (dimension, current) => {
      if (!Number.isFinite(current) || current < 0) return 0;
      if (wireAccounting !== 'cumulative') return current;
      const key = `${counterId}:${dimension}`;
      const prior = handle.usageCumulative.get(key) ?? 0;
      if (governed && current < prior) return null;
      handle.usageCumulative.set(key, current);
      if (dimension === 'usd') return current >= prior ? subtractUsdFloor(current, prior) : current;
      return current >= prior ? current - prior : current;
    };
    const tokens = deltaFor('tokens', normalizedRawTokens);
    const usd = deltaFor('usd', normalizedRawUsd);
    if (tokens === null || usd === null) return { invalidCode: 'usage_counter_regressed' };
    return {
      ...payload,
      tokens, usd, accounting: 'delta', counterId,
      tokenMetric: tokensReported ? tokenMetric : null,
      reportedDimensions: { tokens: tokensReported, usd: usdReported },
      wireAccounting, wireTokens: normalizedRawTokens, wireUsd: normalizedRawUsd,
    };
  }

  _scheduleProviderStop(handle, action = 'kill') {
    if (handle.status !== 'working' || handle.turnTerminalObserved || handle.budgetStopTimer != null) return;
    handle.budgetStopTimer = this._setTimeout(() => {
      handle.budgetStopTimer = null;
      if (handle.status === 'working' && !handle.turnTerminalObserved) this._beginStop(handle, action, undefined, 'policy').catch(noop);
    }, this._budgetTerminalGraceMs);
    if (handle.budgetStopTimer && typeof handle.budgetStopTimer.unref === 'function') handle.budgetStopTimer.unref();
  }

  _recordProviderGovernanceViolation(handle, code, details = {}, action = 'kill') {
    if (!handle.providerGovernance || handle.providerTurn?.violation) return null;
    if (handle.providerTurn) handle.providerTurn.violation = code;
    handle.providerPolicyHardExceeded = true;
    const task = this._tasks.get(handle.taskId);
    const event = this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'resource.provider_governance_exceeded', actor: 'policy', ...this._routeAttribution(handle, task),
      payload: { code, action, mode: handle.providerGovernance.mode, routeDigest: handle.providerGovernance.digest, ...details },
    });
    this._revokeAcceptedProviderOutcome(handle, event);
    this._scheduleProviderStop(handle, action);
    return event;
  }

  _recordProviderTelemetryInvalid(handle, code, details = {}) {
    if (!handle.providerGovernance) return null;
    if (handle.providerTurn?.violation) return null;
    if (handle.providerTurn) handle.providerTurn.violation = code;
    handle.providerTelemetryFailed = true;
    handle.providerPolicyHardExceeded = true;
    const task = this._tasks.get(handle.taskId);
    const invalid = this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'resource.provider_telemetry_invalid', actor: 'policy', ...this._routeAttribution(handle, task),
      payload: { code, action: 'kill', ...details },
    });
    this._revokeAcceptedProviderOutcome(handle, invalid);
    this._scheduleProviderStop(handle, 'kill');
    return invalid;
  }

  _recordProviderTurnUsage(handle, payload) {
    if (!handle.providerGovernance || !handle.providerTurn || handle.providerTurn.sealed) return;
    handle.providerTurn.usage.tokens += payload.tokens;
    const nextUsd = addUsd(handle.providerTurn.usage.usd, payload.usd);
    if (nextUsd === null) return this._recordProviderTelemetryInvalid(handle, 'usage_value_invalid');
    handle.providerTurn.usage.usd = nextUsd;
    const reserve = handle.providerGovernance.terminalReserve;
    if ((reserve.tokens > 0 && handle.providerTurn.usage.tokens > reserve.tokens)
      || (reserve.usd > 0 && handle.providerTurn.usage.usd > reserve.usd)) {
      this._recordProviderGovernanceViolation(handle, 'terminal_reserve_exceeded', {
        usedThisTurn: { ...handle.providerTurn.usage }, reserve: { ...reserve },
      });
    }
  }

  _recordUsage(handle, event) {
    const task = this._tasks.get(handle.taskId);
    const payload = handle.providerGovernance && handle.turnTerminalObserved
      ? { invalidCode: 'usage_after_terminal' }
      : this._normalizeUsage(handle, event.payload ?? {});
    if (payload.invalidCode) {
      return this._recordProviderTelemetryInvalid(handle, payload.invalidCode);
    }
    const nextBudgetUsd = handle.providerGovernance
      ? addUsd(handle.budgetUsed.usd, payload.usd)
      : handle.budgetUsed.usd + payload.usd;
    if (nextBudgetUsd === null) return this._recordProviderTelemetryInvalid(handle, 'usage_value_invalid');
    handle.budgetUsed.tokens += payload.tokens;
    handle.budgetUsed.usd = nextBudgetUsd;
    if (handle.providerTurn && typeof payload.counterId === 'string') {
      handle.providerTurn.counterIds.add(payload.counterId);
      const prior = handle.providerTurn.counterObservations.get(payload.counterId)
        ?? { tokens: false, usd: false, tokenMetric: null };
      handle.providerTurn.counterObservations.set(payload.counterId, {
        tokens: prior.tokens || payload.reportedDimensions.tokens,
        usd: prior.usd || payload.reportedDimensions.usd,
        tokenMetric: payload.reportedDimensions.tokens ? payload.tokenMetric : prior.tokenMetric,
      });
    }
    const usageEvent = this._log.append({
      ...event, payload,
      ...this._routeAttribution(handle, task),
    });
    this._recordProviderTurnUsage(handle, payload);
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
        ...this._routeAttribution(handle, task),
        payload: {
          threshold, hardStop, action: hardStop ? 'kill' : 'notify',
          used: { ...handle.budgetUsed }, limits: { tokens: tokenLimit, usd: usdLimit }, ratio,
          dimensions: { tokens: tokenRatio, usd: usdRatio },
        },
      });
    }
    if (hard) handle.budgetHardExceeded = true;
    if (hard) this._scheduleProviderStop(handle, 'kill');
    return usageEvent;
  }

  _validateTerminalUsageSeal(handle, seal) {
    if (!handle.providerGovernance) return { ok: true, seal: null };
    const fields = ['counterId', 'tokenMetric', 'tokens', 'usd'];
    if (!seal || typeof seal !== 'object' || Array.isArray(seal)
      || Object.keys(seal).sort().join(',') !== fields.sort().join(',')) return { ok: false, code: 'usage_seal_invalid' };
    const availability = new Set(['reported', 'unavailable', 'not_applicable']);
    if (!availability.has(seal.tokens) || !availability.has(seal.usd)) return { ok: false, code: 'usage_seal_invalid' };
    if (seal.counterId !== null && (typeof seal.counterId !== 'string' || seal.counterId.length === 0 || Buffer.byteLength(seal.counterId) > 256 || seal.counterId.includes('\0'))) return { ok: false, code: 'usage_seal_invalid' };
    if (seal.tokenMetric !== null && (typeof seal.tokenMetric !== 'string' || seal.tokenMetric.length === 0 || Buffer.byteLength(seal.tokenMetric) > 256 || seal.tokenMetric.includes('\0'))) return { ok: false, code: 'usage_seal_invalid' };
    const reported = seal.tokens === 'reported' || seal.usd === 'reported';
    if (reported && (seal.counterId === null || !handle.providerTurn?.counterIds?.has(seal.counterId))) return { ok: false, code: 'usage_seal_counter_unobserved' };
    if (!reported && seal.counterId !== null) return { ok: false, code: 'usage_seal_invalid' };
    if (seal.tokens !== 'reported' && seal.tokenMetric !== null) return { ok: false, code: 'usage_seal_invalid' };
    const observation = seal.counterId === null ? null : handle.providerTurn?.counterObservations?.get(seal.counterId) ?? null;
    if (seal.tokens === 'reported' && observation?.tokens !== true) return { ok: false, code: 'usage_seal_tokens_unobserved' };
    if (seal.usd === 'reported' && observation?.usd !== true) return { ok: false, code: 'usage_seal_usd_unobserved' };
    if (seal.tokens !== 'reported' && observation?.tokens === true) return { ok: false, code: 'usage_seal_tokens_contradiction' };
    if (seal.usd !== 'reported' && observation?.usd === true) return { ok: false, code: 'usage_seal_usd_contradiction' };
    const usageCard = this._adapters[handle.vendor]?.card()?.governance?.usage;
    if (seal.tokens === 'reported' && usageCard?.tokens !== 'native') return { ok: false, code: 'usage_seal_card_contradiction' };
    if (seal.usd === 'reported' && usageCard?.usd !== 'native') return { ok: false, code: 'usage_seal_card_contradiction' };
    if (seal.tokens === 'reported') {
      const metric = usageCard?.tokenMetric ?? null;
      if (seal.tokenMetric === null || seal.tokenMetric !== metric || observation?.tokenMetric !== metric) return { ok: false, code: 'usage_seal_metric_mismatch' };
    }
    if (handle.providerGovernance.terminalReserve.tokens > 0 && seal.tokens !== 'reported') return { ok: false, code: 'token_usage_unavailable' };
    if (handle.providerGovernance.terminalReserve.usd > 0 && seal.usd !== 'reported') return { ok: false, code: 'usd_usage_unavailable' };
    if (handle.providerTurn?.sealed) return { ok: false, code: 'usage_seal_duplicate' };
    return { ok: true, seal: deepFreeze({ tokens: seal.tokens, usd: seal.usd, counterId: seal.counterId, tokenMetric: seal.tokenMetric }) };
  }

  _failTerminalProviderGovernance(handle, terminalEvent, code, beginStop = true) {
    handle.providerTelemetryFailed = true;
    handle.providerPolicyHardExceeded = true;
    if (handle.providerTurn) { handle.providerTurn.sealed = true; handle.providerTurn.violation ??= code; }
    const task = this._tasks.get(handle.taskId);
    const invalid = this._log.append({
      worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
      kind: 'resource.provider_telemetry_invalid', actor: 'policy', ...this._routeAttribution(handle, task),
      payload: { code, terminalSeq: terminalEvent.seq, action: 'kill' },
    });
    this._revokeAcceptedProviderOutcome(handle, invalid);
    if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
      const evidence = this._coordMapEvent(invalid);
      this._coordTransition(task, 'failed', `task.failed:${task.id}:provider_telemetry:${invalid.seq}`, evidence);
      task.status = 'failed';
    }
    if (beginStop && !['dead', 'stopping', 'exited'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
  }

  _revokeAcceptedProviderOutcome(handle, event) {
    const task = this._tasks.get(handle.taskId);
    const durable = task ? this._coordination.task(task.id) : null;
    if (!task || durable?.status !== 'completed') return null;
    try {
      const evidence = this._coordMapEvent(event);
      const revoked = this._coordination.revokeTaskAcceptance({
        schemaVersion: 1,
        taskId: task.id,
        expectedTaskVersion: durable.version,
        evidence: { coordinationSeq: evidence.coordinationSeq },
      }, { actor: 'orchestrator', key: `task.acceptance_revoked:${task.id}:${event.seq}` });
      task.status = 'failed';
      task.coordinationVersion = revoked.task.version;
      return revoked;
    } catch (error) {
      throw this._poisonCoordination(error);
    }
  }

  _observeLogicalProviderCall(handle, payload) {
    if (!handle.providerGovernance || !handle.providerTurn) return;
    if (handle.providerTurn.sealed) {
      this._recordProviderGovernanceViolation(handle, 'provider_call_after_terminal');
      return;
    }
    const callId = payload?.callId ?? null;
    const phase = payload?.phase ?? null;
    if (!validLogicalCallId(callId)) {
      this._recordProviderTelemetryInvalid(handle, 'provider_call_id_invalid');
      return;
    }
    if (!validLogicalCallPhase(phase)) {
      this._recordProviderTelemetryInvalid(handle, 'provider_call_phase_invalid');
      return;
    }
    const transition = logicalCallTransition(handle.providerTurn.providerCallPhases.get(callId), phase);
    if (transition === 'invalid') {
      this._recordProviderTelemetryInvalid(handle, phase === 'requested' ? 'provider_call_phase_duplicate' : 'provider_call_phase_invalid');
      return;
    }
    if (transition === 'duplicate' || transition === 'progress' || transition === 'terminal') {
      handle.providerTurn.providerCallPhases.set(callId, phase);
      return;
    }
    handle.providerTurn.providerCallIds.add(callId);
    handle.providerTurn.providerCallPhases.set(callId, phase);
    handle.providerTurn.providerCalls += 1;
    const limit = this._providerGovernance.projection.maxProviderCallsPerTurn;
    if (handle.providerTurn.providerCalls > limit) this._recordProviderGovernanceViolation(handle, 'provider_call_limit_exceeded', { observed: handle.providerTurn.providerCalls, limit });
  }

  _observeLogicalToolCall(handle, payload) {
    if (!handle.providerGovernance || !handle.providerTurn) return;
    if (handle.providerTurn.sealed) {
      this._recordProviderGovernanceViolation(handle, 'tool_call_after_terminal');
      return;
    }
    const callId = payload?.callId ?? payload?.toolCallId ?? payload?.tool_use_id ?? payload?.item?.id ?? null;
    const phase = payload?.phase ?? null;
    if (!validLogicalCallId(callId)) {
      this._recordProviderTelemetryInvalid(handle, 'tool_call_id_invalid');
      return;
    }
    if (!validLogicalCallPhase(phase)) {
      this._recordProviderTelemetryInvalid(handle, 'tool_call_phase_invalid');
      return;
    }
    const transition = logicalCallTransition(handle.providerTurn.toolCallPhases.get(callId), phase);
    if (transition === 'invalid') {
      this._recordProviderTelemetryInvalid(handle, phase === 'requested' ? 'tool_call_phase_duplicate' : 'tool_call_phase_invalid');
      return;
    }
    if (transition === 'duplicate' || transition === 'progress' || transition === 'terminal') {
      handle.providerTurn.toolCallPhases.set(callId, phase);
      return;
    }
    handle.providerTurn.toolCallIds.add(callId);
    handle.providerTurn.toolCallPhases.set(callId, phase);
    handle.providerTurn.toolCalls += 1;
    const limit = this._providerGovernance.projection.maxToolCallsPerTurn;
    if (handle.providerTurn.toolCalls > limit) this._recordProviderGovernanceViolation(handle, 'tool_call_limit_exceeded', { observed: handle.providerTurn.toolCalls, limit });
  }

  _clearBudgetStop(handle) {
    if (handle.budgetStopTimer != null) this._clearTimeout(handle.budgetStopTimer);
    handle.budgetStopTimer = null;
  }

  _relativeActionPath(handle, path) {
    if (typeof path !== 'string' || path.length === 0) return null;
    if (!isAbsolute(path)) return path.replace(/^\.\//, '');
    if (!handle.worktree) return path;
    const rel = relative(canonicalActionPath(handle.worktree), canonicalActionPath(path));
    return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
  }

  _observeWatchdogEvent(handle, event) {
    if (event.actor !== 'worker') return;
    this._touchWatchdog(handle);
    if (event.kind === 'lifecycle.turn_started') {
      this._resetWatchdogTurn(handle);
      return;
    }
    if (event.kind === 'resource.provider_call') {
      this._observeLogicalProviderCall(handle, event.payload ?? {});
      return;
    }
    if (event.kind === 'content.tool_call') {
      const payload = event.payload ?? {};
      this._observeLogicalToolCall(handle, payload);
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
        if (this._watchdog.scopeAction === 'orient') {
          const refresh = this._scheduleScopeOrientation(handle, path);
          if (refresh.reason === 'duplicate_path') continue;
          this._log.append({
            worker: handle.id, harness: this._harnessOf(handle.vendor), turnEpoch: this._safeTurnEpoch(handle),
            kind: 'health.scope_violation', actor: 'policy',
            payload: { path, observedPath: rawPath, action: 'orient', refresh: refresh.scheduled ? 'scheduled' : refresh.reason, mechanical: true },
          });
          continue;
        }
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
        this._maybeFinalizeStop(waiter.workerId, waiter);
      })
      .catch(() => {
        waiter.ackReady = true;
        this._maybeFinalizeStop(waiter.workerId, waiter);
      });
  }

  _maybeFinalizeStop(workerId, waiter) {
    if (!waiter.ackReady || !waiter.confirmReceived) return;
    const handle = this._workers.get(workerId);
    if (waiter.mode === 'kill' && handle?.processRef && handle.processRef.state !== 'closed') return;
    this._finalizeStop(workerId, waiter);
  }

  _onStopConfirmed(handle, confirmKind, payload = {}) {
    const waiter = this._stopWaiters.get(handle.id);
    if (!waiter) return;
    if (confirmKind !== waiter.mode) return; // stale/mismatched confirmation — ignore
    if (handle.providerGovernance && handle.providerTurn && !handle.providerTurn.sealed
      && handle.recoveryProviderReleaseDeferred !== true) {
      const verdict = this._validateTerminalUsageSeal(handle, payload?.usageSeal ?? null);
      waiter.providerSealVerdict = verdict;
      handle.turnTerminalObserved = true;
      if (verdict.seal) {
        handle.providerTerminalSeal = verdict.seal;
        handle.providerTurn.sealed = true;
      }
    }
    waiter.confirmReceived = true;
    this._maybeFinalizeStop(handle.id, waiter);
  }

  _finalizeStop(workerId, waiter) {
    if (waiter.finalized) return;
    waiter.finalized = true;
    if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
    const handle = this._workers.get(workerId);
    const harness = handle ? this._harnessOf(handle.vendor) : '';
    const kind = waiter.mode === 'kill' ? 'kill.confirmed' : 'control.interrupt_confirmed';
    const ev = {
      worker: workerId, harness, turnEpoch: handle ? this._safeTurnEpoch(handle) : 0, kind, actor: 'worker',
      payload: waiter.providerSealVerdict?.seal ? { usageSeal: waiter.providerSealVerdict.seal } : {},
      ...(handle ? this._routeAttribution(handle) : {}),
    };
    if (waiter.emulated) ev.emulated = true;
    const stopEvent = this._log.append(ev);
    if (handle && waiter.providerSealVerdict && !waiter.providerSealVerdict.ok) {
      this._failTerminalProviderGovernance(handle, stopEvent, waiter.providerSealVerdict.code, false);
    }

    try {
      if (handle) {
        const task = this._tasks.get(handle.taskId);
        if (waiter.mode === 'kill') {
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
            const evidence = this._coordMapEvent(stopEvent);
            this._coordTransition(task, 'cancelled', `task.cancelled:${task.id}:${stopEvent.seq}`, evidence);
          }
          handle.status = 'dead';
          const runtimeRemoved = this._removeRuntimeScope(handle);
          if (task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'cancelled';
          waiter.cleanupPromise = this._removeOwnedTaskWorktree(handle, task).then(() => {
            if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
          });
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
              ...this._routeAttribution(handle, task),
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
        const runtimeRemoved = this._removeRuntimeScope(handle);
        waiter.cleanupPromise = this._removeOwnedTaskWorktree(handle, this._tasks.get(handle.taskId)).then(() => {
          if (!runtimeRemoved) throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
        });
        Promise.resolve(this._adapters[handle.vendor]?.kill(handle.id)).catch(noop);
      }
      Promise.resolve(waiter.cleanupPromise).then(() => {
        if (handle && (!handle.processRef || handle.processRef.state === 'closed') && handle.cleanupPending !== true) handle.localAuthority = false;
      }, noop).finally(() => {
        for (const resolve of waiter.resolvers) resolve({ ok: false, result: 'coordination_unavailable' });
        this._stopWaiters.delete(workerId);
      });
      return;
    }

    const result = { ok: true, result: 'confirmed', emulated: waiter.emulated === true };
    Promise.resolve(waiter.cleanupPromise).then(() => {
      if (handle && waiter.mode === 'kill') handle.localAuthority = false;
      for (const resolve of waiter.resolvers) resolve(result);
      this._stopWaiters.delete(workerId);
      this._dispatchPass();
    }, () => {
      for (const resolve of waiter.resolvers) resolve({ ok: false, result: 'cleanup_failed' });
      this._stopWaiters.delete(workerId);
    });
  }

  _forceStop(workerId, waiter) {
    if (waiter.finalized) return;
    waiter.finalized = true;
    if (waiter.timerHandle != null) this._clearTimeout(waiter.timerHandle);
    const handle = this._workers.get(workerId);
    const harness = handle ? this._harnessOf(handle.vendor) : '';
    let forcedEvent;
    try {
      forcedEvent = this._log.append({ worker: workerId, harness, turnEpoch: handle ? this._safeTurnEpoch(handle) : 0, kind: 'control.forced_stop', actor: 'policy', payload: {} });
    } catch {
      if (handle) this._emergencyKillUnlogged(handle).catch(noop);
      for (const resolve of waiter.resolvers) resolve({ ok: false, result: 'coordination_unavailable' });
      this._stopWaiters.delete(workerId);
      return;
    }

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
      if (handle.processRef && ['initializing', 'ready'].includes(handle.processRef.state)) {
        handle.processRef = { ...handle.processRef, state: 'unconfirmed_after_restart' };
      }
      handle.status = 'dead';
      // A deadline is an uncertainty observation, not process-close authority. Preserve the
      // runtime and worktree until an exact correlated close or a later confirmed kill.
      handle.cleanupPending = true;
      handle.cleanupError = 'stop_unconfirmed';
      const task = this._tasks.get(handle.taskId);
      if (!coordinationFailure && task && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
    }

    const result = coordinationFailure ? { ok: false, result: 'coordination_unavailable' } : { ok: true, result: 'forced' };
    for (const resolve of waiter.resolvers) resolve(result);
    this._stopWaiters.delete(workerId);
  }

  // =========================================================================
  // Command: respond()
  // =========================================================================

  respond(requestId, answer, actor = 'orchestrator') {
    return this._withAuthorityOp(() => this._respond(requestId, answer, actor));
  }

  async _respond(requestId, answer, actor = 'orchestrator') {
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
        this._resolveInteractionAuthority(requestId, record);
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
        this._resolveInteractionAuthority(requestId, record);
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
        this._resolveInteractionAuthority(requestId, record);
        record.consumer = actor;
        record.resolution = { decision: 'allow', outcome: 'unknown' };
        finishResolving();
        throw err;
      }
      this._resolveInteractionAuthority(requestId, record);
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
      this._resolveInteractionAuthority(requestId, record);
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
      this._resolveInteractionAuthority(requestId, record);
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
      this._resolveInteractionAuthority(requestId, record);
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
        this._resolveInteractionAuthority(requestId, record);
        record.consumer = actor;
        record.resolution = answer;
        finishResolving();
        throw err;
      }
    }

    this._resolveInteractionAuthority(requestId, record);
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
    this._assertReadable();
    const handle = this._getWorker(workerId);
    const task = this._tasks.get(handle.taskId);
    const providerGovernance = handle.providerGovernance ? {
      policyDigest: handle.providerPolicyDigest ?? null,
      routeDigest: handle.providerGovernance.digest,
      mode: handle.providerGovernance.mode,
      observationOnly: handle.providerGovernance.mode === 'observe',
      hardExceeded: handle.providerPolicyHardExceeded === true,
      telemetryFailed: handle.providerTelemetryFailed === true,
    } : null;
    const attribution = {
      taskId: task?.id ?? handle.taskId ?? null,
      runId: task?.runId ?? handle.runId ?? null,
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
      providerGovernance,
      observationOnly: providerGovernance?.observationOnly === true,
    };
    if (handle.recoveryPending === true) return { ready: false, status: 'orphaned', ...attribution };
    if (!task) return { ready: false, status: handle.status, ...attribution };
    if (!TERMINAL_TASK_STATUSES.has(task.status)) return { ready: false, status: task.status, ...attribution };
    return { ready: true, status: task.status, verdict: task.verdict, artifacts: task.result ? task.result.artifacts : undefined, ...attribution };
  }

  /** Return the closed, deployment-owned fleet capability inventory. */
  capabilityCards() {
    this._assertReadable();
    return this._capabilities ? this._capabilities.cards() : [];
  }

  /** Return deployment-pinned machine-ingress cards. This inventory is separate from ACI and
   * carries no user, MCP, install, merge, or verification authority. */
  advisoryFeedCards() {
    this._assertReadable();
    return this._advisoryFeeds?.cards?.() ?? [];
  }

  /** Admit one machine-authenticated provider delivery. The fixed provider route selects the
   * adapter; neither a user actor nor provider body may choose authority. Durable receipt and
   * pending fences are appended before this returns success. */
  async receiveProviderDelivery(providerId, input, ctx = {}) {
    await this._assertOperational();
    if (!this._advisoryFeeds || this.advisoryFeedCards().length === 0 || !this._repoId) throw Object.assign(new Error('provider machine ingress is not deployment-configured'), { code: 'provider_ingress_unavailable' });
    if (ctx && Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider machine ingress context is invalid'), { code: 'provider_delivery_invalid' });
    const releaseAuthority = this._acquireAuthorityOp();
    try {
      const receipt = await this._advisoryFeeds.verify(providerId, input, { signal: ctx.signal });
      const key = `provider-delivery:${canonicalDigest({ repoId: this._repoId, providerId, sourceEpoch: receipt.sourceEpoch, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest })}`;
      return this._coordination.recordProviderDelivery({ repoId: this._repoId, receipt }, { actor: `provider:${providerId}`, key });
    } finally { releaseAuthority(); }
  }

  /** Exact HTTP-envelope variant for Baton-owned native webhook authenticators. A deployment's
   * fixed HTTPS route supplies providerId; the body and headers cannot select a source. */
  async receiveProviderWebhook(providerId, input, ctx = {}) {
    await this._assertOperational();
    if (!this._advisoryFeeds || this.advisoryFeedCards().length === 0 || !this._repoId || typeof this._advisoryFeeds.verifyWebhook !== 'function') throw Object.assign(new Error('provider machine ingress is not deployment-configured'), { code: 'provider_ingress_unavailable' });
    if (ctx && Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider machine ingress context is invalid'), { code: 'provider_delivery_invalid' });
    const releaseAuthority = this._acquireAuthorityOp();
    try {
      const receipt = await this._advisoryFeeds.verifyWebhook(providerId, input, { signal: ctx.signal });
      const key = `provider-delivery:${canonicalDigest({ repoId: this._repoId, providerId, sourceEpoch: receipt.sourceEpoch, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest })}`;
      return this._coordination.recordProviderDelivery({ repoId: this._repoId, receipt }, { actor: `provider:${providerId}`, key });
    } finally { releaseAuthority(); }
  }

  /** Run one deployment-pinned authenticated full poll for a degraded source, durably admit every
   * item through ordinary delivery dedupe, then append the sole source-health recovery event. */
  async reconcileProviderSource(providerId, ctx = {}) {
    await this._assertOperational();
    if (typeof providerId !== 'string' || !ctx || Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider source reconciliation request is invalid'), { code: 'provider_reconciliation_invalid' });
    const card = this.advisoryFeedCards().find((row) => row.providerId === providerId); if (!this._advisoryFeeds || !this._repoId || !card?.modes?.includes('poll') || typeof this._advisoryFeeds.pollFull !== 'function' || typeof this._coordination.recordProviderSourceReconciliation !== 'function') throw Object.assign(new Error('provider full poll is not deployment-configured'), { code: 'provider_poll_unavailable' });
    if (!this._coordination.reusePolicyState(this._repoId)) throw Object.assign(new Error('provider polling requires active reuse policy'), { code: 'reuse_policy_reconciliation_required' });
    const before = this._coordination.providerSourceHealth(this._repoId, providerId, card.cardDigest); if (!before || before.status !== 'reconciliation_required') return Object.freeze({ ok: true, result: 'not_required', health: before, receipts: [] });
    const releaseAuthority = this._acquireAuthorityOp();
    try {
      const polled = await this._advisoryFeeds.pollFull(providerId, { signal: ctx.signal }); const receipts = [];
      for (const receipt of polled.receipts) { if (ctx.signal?.aborted) throw Object.assign(new Error('provider poll cancelled before durable admission'), { code: 'cancelled' }); const key = `provider-delivery:${canonicalDigest({ repoId: this._repoId, providerId, sourceEpoch: receipt.sourceEpoch, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest })}`; receipts.push(this._coordination.recordProviderDelivery({ repoId: this._repoId, receipt }, { actor: `provider:${providerId}`, key })); }
      if (ctx.signal?.aborted) throw Object.assign(new Error('provider poll cancelled before recovery'), { code: 'cancelled' });
      const current = this._coordination.providerSourceHealth(this._repoId, providerId, card.cardDigest); if (!current || current.status !== 'reconciliation_required') throw Object.assign(new Error('provider source health changed during full poll'), { code: 'provider_reconciliation_stale' });
      const result = this._coordination.recordProviderSourceReconciliation({ repoId: this._repoId, proof: polled.proof, expectedHealthEvent: current.lastEvent }, { actor: `provider-poller:${providerId}`, key: `provider-poll:${canonicalDigest({ repoId: this._repoId, providerId, sourceEpoch: card.cardDigest, proofDigest: polled.proof.proofDigest })}` });
      return Object.freeze({ ...result, receipts });
    } finally { releaseAuthority(); }
  }

  /** Return a deployment-bounded, repository-scoped provider health and processing projection. */
  readProviderStatus(request = {}, ctx = {}) {
    this._assertReadable(); const config = this._providerRead;
    if (!config) throw Object.assign(new Error('provider status reads are not deployment-configured'), { code: 'provider_read_unavailable' });
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !['providerId', 'after', 'limit'].includes(key))
      || !ctx || Object.keys(ctx).some((key) => key !== 'repoId') || ctx.repoId !== config.repoId) throw Object.assign(new Error('provider status repository authority mismatch'), { code: ctx?.repoId !== config.repoId ? 'reuse_repo_mismatch' : 'provider_read_invalid' });
    if (request.providerId !== undefined && (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.providerId) || !this.advisoryFeedCards().some((card) => card.providerId === request.providerId))) throw Object.assign(new Error('provider status provider is invalid'), { code: 'provider_read_invalid' });
    if (request.after !== undefined && !/^provider-processing:[a-f0-9]{64}$/.test(request.after)) throw Object.assign(new Error('provider status cursor is invalid'), { code: 'provider_read_invalid' });
    if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit <= 0 || request.limit > config.maxProcessing)) throw Object.assign(new Error('provider status limit is invalid'), { code: 'provider_read_invalid' });
    const { repoId, ...ceilings } = config;
    return this._coordination.readProviderStatus(repoId, request, ceilings);
  }

  /** Process one deployment-bounded batch of due provider roots. Individual official failures
   * become sanitized durable deferrals; cancellation and writer-lease loss remain fatal to the
   * scan and never synthesize attempt history. */
  async reconcileDueProviderProcessing(ctx = {}) {
    await this._assertOperational(); const config = this._providerProcessingSchedule;
    if (!config) throw Object.assign(new Error('provider processing schedule is not deployment-configured'), { code: 'provider_attempt_unavailable' });
    if (!ctx || Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider processing scan is invalid'), { code: 'provider_processing_invalid' });
    if (this._providerProcessingScanActive) throw Object.assign(new Error('provider processing scan is already active'), { code: 'provider_processing_scan_active' });
    this._providerProcessingScanActive = true;
    const releaseAuthority = this._acquireAuthorityOp();
    try {
      const due = this._coordination.dueProviderProcessing(config.repoId, new Date(this._now()).toISOString()); const results = [];
      for (const processingId of due) {
        if (ctx.signal?.aborted) throw Object.assign(new Error('provider processing scan cancelled'), { code: 'cancelled' });
        const initial = this._coordination.providerProcessing(processingId);
        if (!initial || initial.repoId !== config.repoId || initial.status !== 'pending') { results.push(Object.freeze({ processingId, result: 'stale' })); continue; }
        try {
          const completed = await this.reconcileProviderProcessing(processingId, { signal: ctx.signal });
          if (ctx.signal?.aborted) throw Object.assign(new Error('provider processing scan cancelled'), { code: 'cancelled' });
          results.push(Object.freeze({ processingId, result: completed.result }));
        } catch (error) {
          if (ctx.signal?.aborted || error?.code === 'cancelled' || error?.name === 'AbortError') throw Object.assign(new Error('provider processing scan cancelled'), { code: 'cancelled' });
          if (['coordination_writer_lost', 'coordination_write_unavailable', 'operational_log_unavailable', 'coordinator_closed', 'coordinator_draining'].includes(error?.code)) throw error;
          const current = this._coordination.providerProcessing(processingId);
          if (['provider_processing_stale', 'provider_deferral_conflict'].includes(error?.code)) { results.push(Object.freeze({ processingId, result: 'stale' })); continue; }
          if (!current || current.status !== 'pending' || current.version !== initial.version || current.lastReceiptEvent !== initial.lastReceiptEvent) {
            results.push(Object.freeze({ processingId, result: 'stale' })); continue;
          }
          const failureCode = providerProcessingFailureCode(error); const attempt = (current.attemptCount ?? 0) + 1;
          const key = `provider-deferral:${canonicalDigest({ actor: `provider-reconciler:${current.providerId}`, processingId, expectedProcessingVersion: current.version, expectedLastReceiptEvent: current.lastReceiptEvent, attempt })}`;
          const deferred = this._coordination.recordProviderProcessingDeferral({ processingId, expectedProcessingVersion: current.version, expectedLastReceiptEvent: current.lastReceiptEvent, failureCode }, { actor: `provider-reconciler:${current.providerId}`, key });
          results.push(Object.freeze({ processingId, result: deferred.result, failureCode, attempt: deferred.processing.attemptCount, nextAttemptAt: deferred.processing.nextAttemptAt }));
        }
      }
      return Object.freeze({ ok: true, result: 'scanned', dueCount: due.length, results: Object.freeze(results) });
    } finally { releaseAuthority(); this._providerProcessingScanActive = false; }
  }

  /** Freshly reconcile one durable provider processing root without caller-selected coordinates,
   * policy, index epoch, outcome, actor, or idempotency. Green and adverse coordinates complete as
   * one atomic root; only independently refreshed official facts can add monotonic guard authority. */
  async reconcileProviderProcessing(processingId, ctx = {}) {
    await this._assertOperational(); const config = this._providerReconciliation;
    if (!config) throw Object.assign(new Error('provider reconciliation is not deployment-configured'), { code: 'provider_reconciliation_unavailable' });
    if (typeof processingId !== 'string' || !ctx || Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider reconciliation request is invalid'), { code: 'provider_processing_invalid' });
    const initial = this._coordination.providerProcessing(processingId); if (!initial) throw Object.assign(new Error('provider processing root was not found'), { code: 'provider_processing_not_found' });
    if (initial.repoId !== config.repoId) throw Object.assign(new Error('provider reconciliation repository mismatch'), { code: 'reuse_repo_mismatch' });
    if (initial.status !== 'pending') return Object.freeze({ ok: true, result: 'idempotent', processing: initial, event: null });
    const releaseAuthority = this._acquireAuthorityOp();
    try {
      throwIfProviderCancelled(ctx.signal);
      const actor = `provider-reconciler:${initial.providerId}`; const head = this._coordination.reusePolicyState(config.repoId); if (!head) throw Object.assign(new Error('provider reconciliation policy is unavailable'), { code: 'reuse_policy_reconciliation_required' });
      const rawBinding = await config.indexAuthority.current({ repoId: config.repoId, signal: ctx.signal });
      throwIfProviderCancelled(ctx.signal);
      const bindingFields = ['schemaVersion', 'repoId', 'treeSha', 'indexEpoch', 'atlasCardDigest'];
      if (!rawBinding || Object.keys(rawBinding).sort().join(',') !== bindingFields.sort().join(',') || rawBinding.schemaVersion !== 1 || rawBinding.repoId !== config.repoId || rawBinding.atlasCardDigest !== config.card.atlasCardDigest
        || !/^[a-f0-9]{4,128}$/.test(rawBinding.treeSha ?? '') || !/^[a-f0-9]{64}$/.test(rawBinding.indexEpoch ?? '')) throw Object.assign(new Error('provider index binding is invalid'), { code: 'provider_index_changed' });
      const indexBinding = Object.freeze({ ...rawBinding, bindingDigest: canonicalDigest(rawBinding) }); const policy = Object.freeze({ hash: head.policyHash, version: head.version, constraintId: head.constraintId });
      const requestDigest = canonicalDigest({ actor, processingId, expectedProcessingVersion: initial.version, repoId: initial.repoId, providerId: initial.providerId, sourceEpoch: initial.sourceEpoch, policy, indexBindingDigest: indexBinding.bindingDigest, trigger: 'official_provider_refresh' });
      const key = `provider-processing:${requestDigest}`; const admitted = this._coordination.providerProcessingAdmission(key, requestDigest); if (admitted) return admitted;
      const candidates = [];
      for (const coordinate of initial.coordinates) {
        const args = { indexEpoch: indexBinding.indexEpoch, ecosystem: coordinate.ecosystem, package: coordinate.package, version: coordinate.version, refresh: true }; const verifyCtx = { budgetTokens: config.budgetTokens, actor, signal: ctx.signal };
        const claim = await this._capabilityRegistry().invoke('cartographer-quartermaster', 'reuse.vet', args, verifyCtx); const dossierRef = decisionRef(claim?.refs?.[0], 'dependency-dossier', 'application/vnd.baton.dependency-dossier+json');
        throwIfProviderCancelled(ctx.signal);
        const check = await this._capabilityRegistry().reverify('cartographer-quartermaster', 'reuse.vet', claim, args, verifyCtx); const snapshot = check.status === 'ok' ? check.payload?.[0]?.snapshot : null; const dossier = claim.payload?.[0];
        throwIfProviderCancelled(ctx.signal);
        if (!snapshot || !dossier || dossier.factDigest !== snapshot.factDigest || !officialCoordinateMatches(snapshot.identity, coordinate) || !Array.isArray(dossier.advisoryIds) || !Array.isArray(dossier.advisories)) throw Object.assign(new Error('provider official refresh diverged'), { code: 'reuse_evidence_diverged' });
        const advisoryIds = [...new Set(dossier.advisoryIds)].sort(); const maliciousAdvisoryIds = [...new Set(dossier.advisories.filter((item) => item?.malicious === true).map((item) => item.id))].sort(); candidates.push({ coordinate, dossierRef, snapshot, advisoryIds, maliciousAdvisoryIds, claim });
      }
      const currentBinding = await config.indexAuthority.current({ repoId: config.repoId, signal: ctx.signal }); throwIfProviderCancelled(ctx.signal); const bindingCheck = await config.indexAuthority.reverify(rawBinding, { signal: ctx.signal }); throwIfProviderCancelled(ctx.signal); const currentHead = this._coordination.reusePolicyState(config.repoId);
      if (canonicalDigest(currentBinding) !== canonicalDigest(rawBinding) || bindingCheck?.ok !== true) throw Object.assign(new Error('provider index changed during refresh'), { code: 'provider_index_changed' });
      if (!currentHead || currentHead.policyHash !== policy.hash || currentHead.version !== policy.version || currentHead.constraintId !== policy.constraintId) throw Object.assign(new Error('provider policy changed during refresh'), { code: 'reuse_policy_reconciliation_required' });
      const observations = [];
      for (const row of candidates) {
        throwIfProviderCancelled(ctx.signal);
        const projection = { processingId, coordinate: row.coordinate, dossierDigest: row.dossierRef.digest, factDigest: row.snapshot.factDigest, policyHash: policy.hash, indexBindingDigest: indexBinding.bindingDigest, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds }; const officialDigest = canonicalDigest(projection);
        const verifiedEvent = this._log.append({ worker: 'hub-capability', harness: 'baton', turnEpoch: 0, actor, kind: 'knowledge.reuse_provider_reverified', payload: { ...projection, officialDigest } }); const reverifyEvidence = this._coordMapEvent(verifiedEvent);
        observations.push({ coordinate: row.coordinate, dossierRef: row.dossierRef, snapshot: row.snapshot, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds, reverifyEvidence, officialDigest });
      }
      const fields = { requestDigest, processingId, expectedProcessingVersion: initial.version, repoId: initial.repoId, providerId: initial.providerId, sourceEpoch: initial.sourceEpoch, receiptIds: initial.receiptIds, policy, indexBinding, observations };
      throwIfProviderCancelled(ctx.signal);
      const result = candidates.some((row) => row.snapshot.recommendation !== 'borrow_candidate')
        ? this._coordination.recordProviderAdverseCompletion(fields, { actor, key })
        : this._coordination.recordProviderGreenCompletion(fields, { actor, key });
      return Object.freeze({ ...result, dossiers: candidates.map((row) => row.claim) });
    } finally { releaseAuthority(); }
  }

  /** Invoke an advertised ACI operation through the coordinator-owned registry. */
  async invokeCapability(name, op, args, ctx = {}) {
    await this._assertOperational();
    if (ctx.transport !== undefined) throw Object.assign(new Error('direct capability callers cannot assert northbound transport'), { code: 'capability_transport_forbidden' });
    const releaseAuthority = this._acquireAuthorityOp(); try { return await this._capabilityRegistry().invoke(name, op, args, ctx); } finally { releaseAuthority(); }
  }

  /** Resume a bounded ACI operation through the same coordinator-owned registry. */
  async resumeCapability(name, op, ref, cursor, ctx = {}) {
    await this._assertOperational();
    if (ctx.transport !== undefined) throw Object.assign(new Error('direct capability callers cannot assert northbound transport'), { code: 'capability_transport_forbidden' });
    const releaseAuthority = this._acquireAuthorityOp(); try { return await this._capabilityRegistry().resume(name, op, ref, cursor, ctx); } finally { releaseAuthority(); }
  }

  /** Reverify an ACI claim without granting the capability verification authority. */
  async reverifyCapability(name, op, claim, args, ctx = {}) {
    await this._assertOperational();
    if (ctx.transport !== undefined) throw Object.assign(new Error('direct capability callers cannot assert northbound transport'), { code: 'capability_transport_forbidden' });
    const releaseAuthority = this._acquireAuthorityOp(); try { return await this._capabilityRegistry().reverify(name, op, claim, args, ctx); } finally { releaseAuthority(); }
  }

  async invokeCapabilityNorthbound(transport, token, name, op, args, ctx = {}) {
    await this._assertOperational(); if (!hasNorthboundCapabilityAuthority(transport, token)) throw new Error('northbound capability authority refused');
    const releaseAuthority = this._acquireAuthorityOp(); try { return await this._capabilityRegistry().invoke(name, op, args, { ...ctx, transport }); } finally { releaseAuthority(); }
  }

  async resumeCapabilityNorthbound(transport, token, name, op, ref, cursor, ctx = {}) {
    await this._assertOperational(); if (!hasNorthboundCapabilityAuthority(transport, token)) throw new Error('northbound capability authority refused');
    const releaseAuthority = this._acquireAuthorityOp(); try { return await this._capabilityRegistry().resume(name, op, ref, cursor, { ...ctx, transport }); } finally { releaseAuthority(); }
  }

  async reverifyCapabilityNorthbound(transport, token, name, op, claim, args, ctx = {}) {
    await this._assertOperational(); if (!hasNorthboundCapabilityAuthority(transport, token)) throw new Error('northbound capability authority refused');
    const releaseAuthority = this._acquireAuthorityOp(); try { return await this._capabilityRegistry().reverify(name, op, claim, args, { ...ctx, transport }); } finally { releaseAuthority(); }
  }

  /** Record one immutable build-vs-borrow judgment after the Coordinator freshly reverifies the
   * exact dossier and actual-lockfile SBOM. Capability code supplies evidence only; this method is
   * the sole decision authority and never installs, edits, merges, verifies, or publishes code. */
  async decideReuse(request, ctx = {}) {
    await this._assertOperational();
    const releaseAuthority = this._acquireAuthorityOp();
    try {
    if (!this._reuseDecisionPolicy || typeof this._resolveEnvironmentRef !== 'function') {
      const error = new Error('reuse decision authority is not deployment-configured'); error.code = 'reuse_decision_unavailable'; throw error;
    }
    const actor = ctx.actor;
    if (typeof actor !== 'string' || actor.length === 0 || actor.length > 256) {
      const error = new Error('reuse decision actor is not authorized'); error.code = 'reuse_decision_forbidden'; throw error;
    }
    if (typeof ctx.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(ctx.idempotencyKey)) throw Object.assign(new TypeError('reuse decision idempotency key is invalid'), { code: 'invalid_reuse_decision' });
    if (typeof ctx.repoId !== 'string' || ctx.repoId.length === 0 || !request || typeof request !== 'object' || Array.isArray(request)
      || Object.hasOwn(request, 'actor')) throw Object.assign(new TypeError('reuse decision request is invalid'), { code: 'invalid_reuse_decision' });
    if (Object.keys(request).some((key) => !['need', 'choice', 'rationale', 'dossier', 'sbom', 'supersedes', 'budgetTokens'].includes(key))) throw Object.assign(new TypeError('reuse decision request has unknown fields'), { code: 'invalid_reuse_decision' });
    const need = normalizedDecisionText(request.need, 'need', this._reuseDecisionPolicy.maxNeedBytes);
    const rationale = normalizedDecisionText(request.rationale, 'rationale', this._reuseDecisionPolicy.maxRationaleBytes);
    if (!['borrow', 'build'].includes(request.choice)) throw Object.assign(new TypeError('reuse decision choice must be borrow|build'), { code: 'invalid_reuse_decision' });
    if (!request.dossier || !request.sbom || typeof request.dossier !== 'object' || typeof request.sbom !== 'object'
      || Object.keys(request.dossier).some((key) => !['claim', 'args'].includes(key)) || Object.keys(request.sbom).some((key) => !['claim', 'args'].includes(key))) throw Object.assign(new TypeError('reuse decision requires exact dossier and SBOM evidence'), { code: 'reuse_evidence_invalid' });
    const dossierArgs = request.dossier.args; const sbomArgs = request.sbom.args;
    if (!dossierArgs || dossierArgs.ecosystem !== 'npm' || typeof dossierArgs.package !== 'string' || typeof dossierArgs.version !== 'string'
      || !/^[a-f0-9]{64}$/.test(dossierArgs.indexEpoch ?? '') || !sbomArgs || typeof sbomArgs.lockfilePath !== 'string') throw Object.assign(new TypeError('reuse decision evidence arguments are invalid'), { code: 'reuse_evidence_invalid' });
    const coordinate = { ecosystem: 'npm', package: dossierArgs.package, version: dossierArgs.version };
    if (!(await this._reuseDecisionPolicy.authorize({ actor, repoId: ctx.repoId, choice: request.choice, need, coordinate }))) {
      const error = new Error('reuse decision actor is not authorized for this subject'); error.code = 'reuse_decision_forbidden'; throw error;
    }
    if (request.choice === 'borrow' && this._coordination.reuseRiskGuard(coordinate)?.blocked === true) {
      throw Object.assign(new Error('exact package coordinate is blocked by an advisory observation'), { code: 'reuse_risk_guarded' });
    }
    if (typeof this._coordination.pendingProviderReconciliation === 'function' && this._coordination.pendingProviderReconciliation(ctx.repoId, coordinate).length > 0) {
      throw Object.assign(new Error('exact package coordinate has an unresolved authenticated provider delivery'), { code: 'reuse_provider_pending' });
    }
    const dossierRef = decisionRef(request.dossier.claim?.refs?.[0], 'dependency-dossier', 'application/vnd.baton.dependency-dossier+json');
    const sbomRef = decisionRef(request.sbom.claim?.refs?.[0], 'lockfile-sbom', 'application/vnd.cyclonedx+json');
    if (request.supersedes != null && (typeof request.supersedes !== 'object' || Array.isArray(request.supersedes)
      || Object.keys(request.supersedes).some((key) => !['decisionId', 'expectedValidityVersion'].includes(key))
      || typeof request.supersedes.decisionId !== 'string' || !Number.isSafeInteger(request.supersedes.expectedValidityVersion) || request.supersedes.expectedValidityVersion <= 0)) throw Object.assign(new TypeError('reuse supersession is invalid'), { code: 'invalid_reuse_decision' });
    const supersedes = request.supersedes == null ? null : { decisionId: request.supersedes.decisionId, expectedValidityVersion: request.supersedes.expectedValidityVersion };
    const requestDigest = canonicalDigest({ actor, repoId: ctx.repoId, need, choice: request.choice, rationale, coordinate, dossierRef, dossierArgs, sbomRef, sbomArgs, supersedes });
    const admitted = this._coordination.reuseDecisionAdmission(ctx.idempotencyKey, requestDigest);
    if (admitted) return admitted;
    const verifyCtx = { budgetTokens: ctx.budgetTokens, actor };
    const dossierCheck = await this.reverifyCapability('cartographer-quartermaster', 'reuse.vet', request.dossier.claim, dossierArgs, verifyCtx);
    if (dossierCheck.status !== 'ok' || dossierCheck.payload?.[0]?.ok !== true || !dossierCheck.payload[0].snapshot) throw Object.assign(new Error('reuse dossier diverged'), { code: 'reuse_evidence_diverged' });
    const sbomCheck = await this.reverifyCapability('cartographer-quartermaster', 'provenance.sbom', request.sbom.claim, sbomArgs, verifyCtx);
    if (sbomCheck.status !== 'ok' || sbomCheck.payload?.[0]?.ok !== true || !sbomCheck.payload[0].snapshot) throw Object.assign(new Error('reuse SBOM diverged'), { code: 'reuse_evidence_diverged' });
    const dossierSnapshot = dossierCheck.payload[0].snapshot; const sbomSnapshot = sbomCheck.payload[0].snapshot;
    if (dossierSnapshot.indexEpoch !== dossierArgs.indexEpoch) throw Object.assign(new Error('reuse dossier epoch mismatch'), { code: 'reuse_evidence_diverged' });
    if (sbomSnapshot.lockfile !== sbomArgs.lockfilePath.replace(/^\.\//, '')) throw Object.assign(new Error('reuse SBOM path mismatch'), { code: 'reuse_evidence_diverged' });
    if (request.choice === 'borrow' && dossierSnapshot.recommendation !== 'borrow_candidate') throw Object.assign(new Error('blocked dossier cannot authorize borrowing'), { code: 'reuse_borrow_blocked' });
    const envRef = await this._resolveEnvironmentRef({ repoId: ctx.repoId, indexEpoch: dossierArgs.indexEpoch, overlayDigest: dossierSnapshot.overlayDigest, lockfileDigest: sbomSnapshot.lockfileDigest });
    const subjectDigest = canonicalDigest({ envRef, indexEpoch: dossierArgs.indexEpoch, need, coordinate, policyHash: dossierSnapshot.policyHash });
    const evidenceProjectionDigest = canonicalDigest({ dossierRef, dossierSnapshot, sbomRef, sbomSnapshot });
    const decisionRecord = { envRef, indexEpoch: dossierArgs.indexEpoch, need, choice: request.choice, rationale, coordinate, actor, dossierDigest: dossierRef.digest, sbomDigest: sbomRef.digest, subjectDigest, evidenceProjectionDigest, supersedes };
    const decisionDigest = canonicalDigest(decisionRecord); const id = `reuse-decision:${decisionDigest}`;
    const decisionContent = { ...decisionRecord, installAuthority: false, mergeAuthority: false, verificationAuthority: false, policyOverride: false };
    const decisionArtifactDigest = canonicalDigest(decisionContent);
    const verifiedEvent = this._log.append({
      worker: 'hub-capability', harness: 'baton', turnEpoch: 0, actor, kind: 'knowledge.reuse_evidence_reverified',
      payload: { requestDigest, decisionDigest, decisionArtifactDigest, evidenceProjectionDigest, dossierDigest: dossierRef.digest, dossierFactDigest: dossierSnapshot.factDigest, policyHash: dossierSnapshot.policyHash, recommendation: dossierSnapshot.recommendation, evidenceExpiresAt: dossierSnapshot.expiresAt, sbomDigest: sbomRef.digest, lockfileDigest: sbomSnapshot.lockfileDigest, indexEpoch: dossierArgs.indexEpoch },
    });
    const reverifyEvidence = this._coordMapEvent(verifiedEvent);
    const evidenceManifest = (artifactId, fresh) => {
      const prior = this._coordination.artifact(artifactId);
      return prior ? Object.fromEntries(Object.entries(prior).filter(([key]) => !['createdEvent', 'version', 'supersededBy', 'supersededEvent'].includes(key))) : fresh;
    };
    const dossierArtifactId = `capability-evidence:${dossierRef.digest}`; const sbomArtifactId = `capability-evidence:${sbomRef.digest}`;
    const artifacts = [
      evidenceManifest(dossierArtifactId, { id: dossierArtifactId, owner: { kind: 'capability-evidence', id: `cartographer-quartermaster:reuse.vet:${dossierRef.digest}` }, kind: dossierRef.kind, mediaType: dossierRef.mediaType, digest: dossierRef.digest, refs: [dossierRef], accepted: true, provenance: [reverifyEvidence] }),
      evidenceManifest(sbomArtifactId, { id: sbomArtifactId, owner: { kind: 'capability-evidence', id: `cartographer-quartermaster:provenance.sbom:${sbomRef.digest}` }, kind: sbomRef.kind, mediaType: sbomRef.mediaType, digest: sbomRef.digest, refs: [sbomRef], accepted: true, provenance: [reverifyEvidence] }),
      { id: `reuse-decision-artifact:${decisionArtifactDigest}`, owner: { kind: 'decision', id }, kind: 'reuse-decision', mediaType: 'application/vnd.baton.reuse-decision+json', digest: decisionArtifactDigest, refs: [{ artifactId: dossierArtifactId }, { artifactId: sbomArtifactId }], accepted: true, provenance: [reverifyEvidence], content: decisionContent },
    ];
    const prior = supersedes ? this._coordination.reuseDecision(supersedes.decisionId) : null;
    const knowledgeSnapshot = prior ? this._coordination.snapshot().knowledge : null;
    const priorNode = prior ? knowledgeSnapshot.nodes.find((node) => node.id === prior.nodeId) : null;
    const affectedReadEvents = prior && !priorNode?.validTo ? knowledgeSnapshot.reads.filter((read) => read.nodeIds.includes(prior.nodeId)).map((read) => read.eventSeq) : [];
    return this._coordination.recordReuseDecision({ schemaVersion: 1, id, requestDigest, decisionDigest, decisionArtifactDigest, subjectDigest, ...decisionRecord, dossierRef, sbomRef, dossierSnapshot, sbomSnapshot, reverifyEvidence, artifacts, affectedReadEvents }, { actor, key: ctx.idempotencyKey });
    } finally { releaseAuthority(); }
  }

  /** Recheck one immutable reuse lineage without accepting caller-supplied advisory facts. TTL is
   * deterministic from the stored dossier; advisory mode forces Quartermaster's official refresh
   * and lets the store atomically install the coordinate fence plus complete live target set. */
  async recheckReuseDecision(request, ctx = {}) {
    await this._assertOperational();
    const releaseAuthority = this._acquireAuthorityOp();
    try {
    if (!this._reuseDecisionPolicy?.authorizeRecheck) throw Object.assign(new Error('reuse recheck authority is not deployment-configured'), { code: 'reuse_recheck_unavailable' });
    const actor = ctx.actor;
    if (typeof actor !== 'string' || actor.length === 0 || actor.length > 256) throw Object.assign(new Error('reuse recheck actor is not authorized'), { code: 'reuse_recheck_forbidden' });
    if (typeof ctx.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(ctx.idempotencyKey)
      || typeof ctx.repoId !== 'string' || !request || typeof request !== 'object' || Array.isArray(request) || Object.hasOwn(request, 'actor')
      || Object.keys(request).some((key) => !['decisionId', 'expectedValidityVersion', 'trigger', 'budgetTokens'].includes(key))
      || typeof request.decisionId !== 'string' || !Number.isSafeInteger(request.expectedValidityVersion) || request.expectedValidityVersion <= 0
      || !['advisory_refresh', 'ttl_expired'].includes(request.trigger) || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0
      || request.budgetTokens !== ctx.budgetTokens) {
      throw Object.assign(new TypeError('reuse recheck request is invalid'), { code: 'invalid_reuse_recheck' });
    }
    const seed = this._coordination.reuseDecision(request.decisionId);
    if (!seed) throw Object.assign(new Error('reuse recheck decision was not found'), { code: 'reuse_decision_not_found' });
    if (seed.envRef?.repoId !== ctx.repoId) throw Object.assign(new Error('reuse recheck repository authority mismatch'), { code: 'reuse_repo_mismatch' });
    if (!(await this._reuseDecisionPolicy.authorizeRecheck({ actor, repoId: ctx.repoId, trigger: request.trigger, coordinate: seed.coordinate, decisionId: seed.id }))) {
      throw Object.assign(new Error('reuse recheck actor is not authorized for this subject'), { code: 'reuse_recheck_forbidden' });
    }
    const requestDigest = canonicalDigest({ actor, repoId: ctx.repoId, decisionId: seed.id, expectedValidityVersion: request.expectedValidityVersion, trigger: request.trigger });
    if (request.trigger === 'ttl_expired') {
      const admitted = this._coordination.reuseTtlAdmission(ctx.idempotencyKey, requestDigest); if (admitted) return admitted;
      return this._coordination.recordReuseTtlInvalidation({ requestDigest, decisionId: seed.id, expectedValidityVersion: request.expectedValidityVersion }, { actor, key: ctx.idempotencyKey });
    }
    const admitted = this._coordination.reuseRiskAdmission(ctx.idempotencyKey, requestDigest); if (admitted) return admitted;
    const dossierArgs = { indexEpoch: seed.indexEpoch, ecosystem: seed.coordinate.ecosystem, package: seed.coordinate.package, version: seed.coordinate.version, refresh: true };
    const verifyCtx = { budgetTokens: ctx.budgetTokens, actor };
    const claim = await this.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, verifyCtx);
    const dossierRef = decisionRef(claim?.refs?.[0], 'dependency-dossier', 'application/vnd.baton.dependency-dossier+json');
    const check = await this.reverifyCapability('cartographer-quartermaster', 'reuse.vet', claim, dossierArgs, verifyCtx);
    if (check.status !== 'ok' || check.payload?.[0]?.ok !== true || !check.payload[0].snapshot) throw Object.assign(new Error('reuse advisory refresh diverged'), { code: 'reuse_evidence_diverged' });
    const snapshot = check.payload[0].snapshot; const dossier = claim.payload?.[0];
    if (!dossier || dossier.factDigest !== snapshot.factDigest || dossier.identity?.ecosystem !== seed.coordinate.ecosystem
      || dossier.identity?.package !== seed.coordinate.package || dossier.identity?.version !== seed.coordinate.version
      || !Array.isArray(dossier.advisoryIds) || !Array.isArray(dossier.advisories)) throw Object.assign(new Error('reuse advisory projection is incomplete'), { code: 'reuse_evidence_diverged' });
    const advisoryIds = [...new Set(dossier.advisoryIds)].sort();
    const maliciousAdvisoryIds = [...new Set(dossier.advisories.filter((item) => item?.malicious === true).map((item) => item.id))].sort();
    const adverse = snapshot.recommendation !== 'borrow_candidate';
    const riskProjectionDigest = canonicalDigest({ coordinate: seed.coordinate, dossierRef, dossierSnapshot: snapshot, advisoryIds, maliciousAdvisoryIds, adverse });
    const verifiedEvent = this._log.append({
      worker: 'hub-capability', harness: 'baton', turnEpoch: 0, actor, kind: 'knowledge.reuse_risk_reverified',
      payload: { requestDigest, seedDecisionId: seed.id, expectedValidityVersion: request.expectedValidityVersion, dossierDigest: dossierRef.digest, factDigest: snapshot.factDigest, policyHash: snapshot.policyHash, recommendation: snapshot.recommendation, asOf: snapshot.asOf, expiresAt: snapshot.expiresAt, advisoryIds, maliciousAdvisoryIds, adverse, riskProjectionDigest },
    });
    const reverifyEvidence = this._coordMapEvent(verifiedEvent);
    const result = this._coordination.recordReuseRiskGuard({ requestDigest, seedDecisionId: seed.id, seedExpectedValidityVersion: request.expectedValidityVersion, coordinate: seed.coordinate, dossierRef, dossierSnapshot: snapshot, advisoryIds, maliciousAdvisoryIds, reverifyEvidence, adverse, effectiveAt: snapshot.asOf }, { actor, key: ctx.idempotencyKey });
    return Object.freeze({ ...result, dossier: claim });
    } finally { releaseAuthority(); }
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
    this._assertReadable();
    return [...this._workers.values()].map((h) => this._publicHandle(h));
  }

  // =========================================================================
  // Command: wait()
  // =========================================================================

  async wait(timeoutMs = 25000) {
    this._assertReadable();
    const deadline = Date.now() + timeoutMs;

    // Always yield at least one real macrotask turn so any in-flight microtask-only
    // background work (e.g. the trust gate, chained purely off resolved promises) has a
    // chance to fully settle before we snapshot the digest.
    await this._sleep(0);
    this._assertReadable();
    let digest = this._collectDigest();

    while (digest.attention.length === 0 && digest.facts.length === 0 && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this._sleep(Math.min(this._waitPollMs, remaining));
      this._assertReadable();
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

  _handleEvent(event, sourceVendor = null, opts = {}) {
    const { worker: workerId, kind, harness, turnEpoch, payload, actor } = event;
    const handle = this._workers.get(workerId);
    if (!handle) return;
    if (sourceVendor !== null && handle.vendor !== sourceVendor) {
      this._log.append({
        worker: workerId,
        harness: this._harnessOf(handle.vendor),
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'lifecycle.process_attribution_refused',
        actor: 'policy',
        payload: boundedProcessObservation(event, 'cross_adapter_worker', { sourceVendor, ownerVendor: handle.vendor }),
      });
      if (!['dead', 'stopping', 'exited'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      return;
    }
    const turnWasTerminal = handle.turnTerminalObserved === true;
    if (actor === 'worker' && kind === 'lifecycle.spawned') {
      const providerId = payload?.threadId ?? payload?.sessionId;
      const processBound = handle.processRef !== null
        || (payload?.processGeneration !== undefined && payload?.pid !== undefined);
      const validProviderReady = !processBound || ((handle.processRef?.state === 'initializing'
        || (opts.admittedReady === true && handle.processRef?.state === 'ready'))
        && payload?.processGeneration === handle.processRef.generation
        && payload?.pid === handle.processRef.pid
        && typeof providerId === 'string' && providerId.length > 0);
      if (!validProviderReady) {
        this._log.append({
          worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle),
          kind: 'lifecycle.process_attribution_refused', actor: 'policy',
          payload: boundedProcessObservation(event, 'invalid_provider_ready'),
          ...this._routeAttribution(handle),
        });
        if (!['dead', 'stopping', 'exited'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
        return;
      }
    }
    if (handle.turnAdmission && actor === 'worker' && !['lifecycle.crashed', 'lifecycle.exited', 'kill.confirmed', 'lifecycle.process_started', 'lifecycle.process_closed'].includes(kind)) {
      handle.turnAdmission.events.push(event);
      if (kind === 'lifecycle.spawned') {
        // Provider readiness is process telemetry even while recovery/follow-up admission is
        // transactional. Promote only the exact current PID here so a racing close can carry
        // ready:true; session identity, route observations, and turn effects remain buffered.
        const providerId = payload?.threadId ?? payload?.sessionId;
        if (handle.processRef?.state === 'initializing'
          && payload?.processGeneration === handle.processRef.generation
          && payload?.pid === handle.processRef.pid
          && typeof providerId === 'string' && providerId.length > 0) {
          const readyPayload = processReadyPayload(payload.processGeneration, payload.pid);
          this._log.append({
            worker: workerId, harness, turnEpoch, kind: 'lifecycle.process_ready', actor: 'policy',
            payload: readyPayload, ...this._routeAttribution(handle),
          });
          handle.processRef = { ...handle.processRef, state: 'ready', ready: true };
        }
        handle.turnAdmission.resolveSpawned?.(event);
      }
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
      if (handle.processRef?.state === 'initializing'
        && payload?.processGeneration === handle.processRef.generation
        && payload?.pid === handle.processRef.pid
        && typeof nativeId === 'string' && nativeId.length > 0) {
        handle.processRef = { ...handle.processRef, state: 'ready', ready: true };
      }
    }
    // Only adapter-mapped native lifecycle/usage metadata may establish provider identity.
    // Result/content/unknown worker payloads are untrusted and cannot forge a policy mismatch.
    const nativeObservation = actor === 'worker' && (kind === 'lifecycle.spawned' || kind === 'resource.tokens');
    const observedModel = nativeObservation ? (payload?.modelObserved ?? payload?.modelId ?? payload?.model) : null;
    if (typeof observedModel === 'string' && observedModel.length > 0) {
      handle.modelObserved = observedModel;
      const task = this._tasks.get(handle.taskId);
      if (task) task.modelObserved = observedModel;

      const selection = this._adapters[handle.vendor]?.card()?.modelSelection;
      const requestedAlias = selection?.acceptedAliases?.includes(handle.modelResolved);
      const legacyAliasObservation = requestedAlias && !handle.providerGovernance;
      if (handle.modelResolved && observedModel !== handle.modelResolved && !legacyAliasObservation && !handle.modelMismatch) {
        handle.modelMismatch = { requested: handle.modelResolved, observed: observedModel };
        const mismatchTask = this._tasks.get(handle.taskId);
        if (mismatchTask) {
          mismatchTask.modelMismatch = handle.modelMismatch;
        }
        const mismatchEvent = this._log.append({
          worker: workerId, harness, turnEpoch, kind: 'model.mismatch', actor: 'policy',
          ...this._routeAttribution(handle, mismatchTask),
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
    const observedEffort = nativeObservation ? payload?.effortObserved : null;
    if (typeof observedEffort === 'string' && observedEffort.length > 0) {
      handle.effortObserved = observedEffort;
      const effortTask = this._tasks.get(handle.taskId);
      if (effortTask) effortTask.effortObserved = observedEffort;
      if (handle.effortResolved && observedEffort !== handle.effortResolved && !handle.effortMismatch) {
        handle.effortMismatch = { requested: handle.effortResolved, observed: observedEffort };
        const mismatchEvent = this._log.append({ worker: workerId, harness, turnEpoch, kind: 'effort.mismatch', actor: 'policy',
          ...this._routeAttribution(handle, effortTask),
          payload: { requested: handle.effortResolved, observed: observedEffort, action: 'fail_and_kill' } });
        if (effortTask && !TERMINAL_TASK_STATUSES.has(effortTask.status)) {
          const evidence = this._coordMapEvent(mismatchEvent);
          this._coordTransition(effortTask, 'failed', `task.failed:${effortTask.id}:${mismatchEvent.seq}`, evidence);
          effortTask.status = 'failed';
        }
        this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
      }
    }
    const attribution = this._routeAttribution(handle);
    const appendAttributed = (partial) => this._log.append({ ...partial, ...attribution });
    let nativeObservationEvent = null;

    switch (kind) {
      case 'lifecycle.process_started': {
        const valid = actor === 'worker' && validProcessStartedPayload(payload)
          && handle.currentIncarnation === true && handle.localAuthority === true
          && (handle.nativeSpawnPending === true || handle.recoveryPending === true)
          && payload.generation === handle.processGeneration
          && (!handle.processRef || handle.processRef.state === 'closed' || handle.processRef.state === 'unconfirmed_after_restart');
        if (!valid) {
          appendAttributed({ worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(event, 'invalid_process_start') });
          const lateCurrentStart = actor === 'worker' && validProcessStartedPayload(payload)
            && handle.currentIncarnation === true && payload.generation === handle.processGeneration
            && (!handle.processRef || handle.processRef.state === 'closed' || handle.processRef.state === 'unconfirmed_after_restart');
          if (lateCurrentStart) {
            // A spawn Ack promises that no later process start can occur. If an adapter violates
            // that boundary while this controller can still observe it, reacquire exact transport
            // ownership and require another two-phase kill plus correlated process close.
            handle.processRef = { generation: payload.generation, pid: payload.pid, processGroupId: payload.processGroupId, state: 'initializing', ready: false, startedSeq: null, closedSeq: null };
            handle.localAuthority = true;
            this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
          } else if (!['dead', 'stopping', 'exited'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
          break;
        }
        const started = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        handle.processRef = { generation: payload.generation, pid: payload.pid, processGroupId: payload.processGroupId, state: 'initializing', ready: false, startedSeq: started.seq, closedSeq: null };
        break;
      }
      case 'lifecycle.process_closed': {
        const current = handle.processRef;
        const valid = actor === 'worker' && validProcessClosedPayload(payload) && current
          && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(current.state)
          && payload.generation === current.generation && payload.pid === current.pid
          && payload.processGroupId === current.processGroupId
          && payload.ready === current.ready;
        if (!valid) {
          appendAttributed({ worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(event, 'invalid_process_close') });
          if (!['dead', 'stopping', 'exited'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
          break;
        }
        const closed = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        handle.processRef = { ...current, state: 'closed', ready: payload.ready, closedSeq: closed.seq };
        this._finishUntrustedTransportReap(handle, handle.processRef);
        const stopWaiter = this._stopWaiters.get(handle.id);
        if (stopWaiter?.mode === 'kill') this._maybeFinalizeStop(handle.id, stopWaiter);
        if (!stopWaiter && handle.status === 'dead' && handle.cleanupPending !== true) handle.localAuthority = false;
        if (!stopWaiter && handle.status === 'dead' && handle.cleanupPending === true && !handle.untrustedTransportReap) {
          this._cleanupClosedTransport(handle, this._tasks.get(handle.taskId)).catch(noop);
        }
        if (!stopWaiter && !handle.untrustedTransportReap && turnWasTerminal
          && !['dead', 'stopping', 'orphaned'].includes(handle.status)) {
          handle.status = 'exited';
          this._cleanupClosedTransport(handle, this._tasks.get(handle.taskId)).catch(noop);
        }
        break;
      }
      case 'lifecycle.process_reap_unconfirmed': {
        const current = handle.processRef;
        const valid = actor === 'worker' && validProcessReapUnconfirmedPayload(payload) && current
          && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(current.state)
          && payload.generation === current.generation && payload.pid === current.pid
          && payload.processGroupId === current.processGroupId;
        if (!valid) {
          appendAttributed({ worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(event, 'invalid_process_reap_unconfirmed') });
        } else {
          appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        }
        if (!['dead', 'stopping', 'exited'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
        break;
      }
      case 'resource.tokens':
        nativeObservationEvent = this._recordUsage(handle, event);
        break;
      case 'lifecycle.turn_completed': {
        // Adapters may wrap the WorkerResult as { result } (MockAdapter) or emit it directly
        // (coordinator.test). Normalize so the logged claim and the gate both see the WorkerResult.
        const wr = (payload && payload.result !== undefined && payload.status === undefined) ? payload.result : payload;
        const sealVerdict = this._validateTerminalUsageSeal(handle, payload?.usageSeal ?? null);
        const terminalEvent = appendAttributed({
          worker: workerId, harness, turnEpoch, kind, actor,
          payload: sealVerdict.seal ? { ...wr, usageSeal: sealVerdict.seal } : wr,
        });
        this._clearWatchdog(handle);
        if (!sealVerdict.ok) {
          this._failTerminalProviderGovernance(handle, terminalEvent, sealVerdict.code);
          break;
        }
        if (sealVerdict.seal) {
          handle.providerTerminalSeal = sealVerdict.seal;
          if (handle.providerTurn) handle.providerTurn.sealed = true;
        }
        if (this._drainState === 'open' && handle.status !== 'stopping' && handle.status !== 'dead') {
          const releaseAuthority = this._acquireAuthorityOp();
          this._runTrustGate(handle, wr).catch(noop).finally(releaseAuthority);
        }
        break;
      }
      case 'lifecycle.crashed': {
        const sealVerdict = this._validateTerminalUsageSeal(handle, payload?.usageSeal ?? null);
        const terminalEvent = appendAttributed({
          worker: workerId, harness, turnEpoch, kind, actor,
          payload: sealVerdict.seal ? { ...payload, usageSeal: sealVerdict.seal } : payload,
        });
        if (!sealVerdict.ok) this._failTerminalProviderGovernance(handle, terminalEvent, sealVerdict.code);
        if (sealVerdict.seal) {
          handle.providerTerminalSeal = sealVerdict.seal;
          if (handle.providerTurn) handle.providerTurn.sealed = true;
        }
        const task = this._tasks.get(handle.taskId);
        const failActiveTask = task && !TERMINAL_TASK_STATUSES.has(task.status)
          && task.status !== 'verifying' && !turnWasTerminal;
        if (failActiveTask) {
          const evidence = this._coordMapEvent(terminalEvent);
          if (evidence) this._coordTransition(task, 'failed', `task.failed:${task.id}:${evidence.coordinationSeq}`, evidence);
        }
        if (failActiveTask && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        this._clearWatchdog(handle);
        // A turn crash does not normally prove transport death. A matching process_closed event
        // immediately before this crash does, so reap directly instead of arming an impossible
        // stop waiter for a child that can no longer emit kill.confirmed.
        if (handle.processRef?.state === 'closed' && !this._stopWaiters.has(handle.id)) {
          handle.status = 'exited';
          this._cleanupClosedTransport(handle, task).catch(noop);
        } else if (handle.status !== 'dead' && handle.status !== 'stopping') {
          this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
        }
        break;
      }
      case 'lifecycle.exited': {
        const terminalEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
        const task = this._tasks.get(handle.taskId);
        const failActiveTask = task && !TERMINAL_TASK_STATUSES.has(task.status)
          && task.status !== 'verifying' && !turnWasTerminal;
        if (failActiveTask) {
          const evidence = this._coordMapEvent(terminalEvent);
          if (evidence) this._coordTransition(task, 'failed', `task.failed:${task.id}:${evidence.coordinationSeq}`, evidence);
        }
        if (failActiveTask && !TERMINAL_TASK_STATUSES.has(task.status)) task.status = 'failed';
        this._clearWatchdog(handle);
        if (handle.processRef && handle.processRef.state !== 'closed') {
          appendAttributed({ worker: workerId, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'lifecycle.process_attribution_refused', actor: 'policy', payload: boundedProcessObservation(event, 'terminal_without_process_close') });
          if (!['dead', 'stopping'].includes(handle.status)) this._beginStop(handle, 'kill', undefined, 'policy').catch(noop);
        } else if (!this._stopWaiters.has(handle.id)) {
          if (handle.status !== 'dead') handle.status = 'exited';
          this._cleanupClosedTransport(handle, task).catch(noop);
        }
        break;
      }
      case 'question.asked': {
        const requestId = payload?.requestId;
        if (this._drainState !== 'open') {
          const discarded = appendAttributed({ worker: workerId, harness, turnEpoch, kind: 'control.drain_interaction_discarded', actor: 'policy', payload: { requestId, kind: 'question' } });
          const task = this._tasks.get(handle.taskId); const evidence = this._coordMapEvent(discarded);
          this._coordRecord('authority.cancelled', { taskId: task?.id ?? null, workerId, requestId, kind: 'question', reason: 'fleet_drain', evidence }, `driver.authority.cancelled:${workerId}:${requestId}:${discarded.seq}`, 'policy');
          break;
        }
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
        this._activeInteractionIds.add(requestId);
        if (payload?.blocking !== false) {
          handle.status = 'blocked';
          handle.pendingQuestionId = requestId;
          if (task) task.status = 'input_required';
        }
        break;
      }
      case 'approval.requested': {
        const requestId = payload?.requestId;
        if (this._drainState !== 'open') {
          const discarded = appendAttributed({ worker: workerId, harness, turnEpoch, kind: 'control.drain_interaction_discarded', actor: 'policy', payload: { requestId, kind: 'approval' } });
          const task = this._tasks.get(handle.taskId); const evidence = this._coordMapEvent(discarded);
          this._coordRecord('authority.cancelled', { taskId: task?.id ?? null, workerId, requestId, kind: 'approval', reason: 'fleet_drain', evidence }, `driver.authority.cancelled:${workerId}:${requestId}:${discarded.seq}`, 'policy');
          break;
        }
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
        this._activeInteractionIds.add(requestId);
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
        this._onStopConfirmed(handle, 'interrupt', payload);
        break;
      case 'kill.confirmed':
        this._onStopConfirmed(handle, 'kill', payload);
        break;
      default:
        nativeObservationEvent = appendAttributed({ worker: workerId, harness, turnEpoch, kind, actor, payload });
    }
    if (nativeObservation && nativeObservationEvent
      && ((typeof observedModel === 'string' && observedModel.length > 0) || (typeof observedEffort === 'string' && observedEffort.length > 0))) {
      const task = this._tasks.get(handle.taskId);
      const evidence = this._coordMapEvent(nativeObservationEvent);
      this._coordRecord('route.observed', {
        taskId: task?.id ?? handle.taskId, workerId, ...this._routeAttribution(handle, task), evidence,
      }, `driver.route_observed:${task?.id ?? handle.taskId}:${nativeObservationEvent.seq}`);
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
    let verifierToolchainProjection = null;
    let baseVerifierToolchainProjection = null;
    let verifierSparseCheckoutIdentity = null;
    let baseVerifierSparseCheckoutIdentity = null;
    let verificationCleanupError = null;
    let trustPhase = 'capture';
    try {
      // C5: thread the dispatching vendor through to captureCommit so the snapshot
      // commit (when one is made) is genuinely attributed.
      const captured = await this._worktrees.capture(handle.worktree ?? task.worktree, {
        vendor: handle.vendor,
        model: handle.modelObserved ?? handle.modelResolved,
        ...((handle.effortObserved ?? handle.effortResolved) ? { effort: handle.effortObserved ?? handle.effortResolved } : {}),
        ownerTaskId: task.sessionContext?.ownerTaskId ?? task.id,
        ...(task.sessionContext?.baseSha ? { expectedBaseSha: task.sessionContext.baseSha } : {}),
        ...(task.sessionContext?.branch ? { expectedBranch: task.sessionContext.branch } : {}),
        ...(task.sessionContext?.sparseCheckoutIdentity ? { workerSparseCheckoutIdentity: task.sessionContext.sparseCheckoutIdentity } : {}),
      });
      const sha = captured && captured.sha;
      const created = await this._worktrees.createVerifyWorktree(task.id, sha, { requiredPaths: captured?.changedPaths ?? [] });
      verifyPath = created && created.path;
      verifierToolchainProjection = created?.toolchainProjection ?? null;
      verifierSparseCheckoutIdentity = created?.sparseCheckoutIdentity ?? null;
      const workerToolchainProjection = task.sessionContext?.toolchainProjection ?? null;
      const declaredWorkerSparseCheckoutIdentity = task.sessionContext?.sparseCheckoutIdentity ?? null;
      const workerSparseCheckoutIdentity = declaredWorkerSparseCheckoutIdentity
        ?? (verifierSparseCheckoutIdentity ? captured?.sparseCheckoutIdentity ?? null : null);
      if ((workerSparseCheckoutIdentity || verifierSparseCheckoutIdentity)
        && (!workerSparseCheckoutIdentity || !verifierSparseCheckoutIdentity)) throw Object.assign(new Error('verification sparse checkout identity is missing'), { code: 'verification_environment_mismatch' });
      if ((workerToolchainProjection || verifierToolchainProjection)
        && (!workerToolchainProjection || !verifierToolchainProjection || canonicalDigest(workerToolchainProjection) !== canonicalDigest(verifierToolchainProjection))) throw Object.assign(new Error('verification toolchain projection mismatch'), { code: 'verification_environment_mismatch' });

      const baseSha = task.sessionContext?.baseSha ?? null;
      if (this._acceptOpts.requireRedGreen && baseSha && typeof this._worktrees.createBaseVerifyWorktree === 'function') {
        const baseCreated = await this._worktrees.createBaseVerifyWorktree(task.id, baseSha);
        baseVerifyPath = baseCreated?.path ?? null;
        baseVerifierToolchainProjection = baseCreated?.toolchainProjection ?? null;
        baseVerifierSparseCheckoutIdentity = baseCreated?.sparseCheckoutIdentity ?? null;
        if ((workerToolchainProjection || baseVerifierToolchainProjection)
          && (!workerToolchainProjection || !baseVerifierToolchainProjection || canonicalDigest(workerToolchainProjection) !== canonicalDigest(baseVerifierToolchainProjection))) throw Object.assign(new Error('base verification toolchain projection mismatch'), { code: 'verification_environment_mismatch' });
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
      const refereeAccept = this._accept(verdict, acceptOpts);
      // Provider usage can arrive only as a terminal lump. Native kill cannot claw back that
      // spend, but an over-hard-limit artifact must still fail admission and router learning.
      const accept = refereeAccept
        && handle.budgetHardExceeded !== true
        && handle.providerPolicyHardExceeded !== true
        && handle.providerTelemetryFailed !== true;
      const verifyEvent = this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'verify.reverified',
        actor: 'policy',
        ...this._routeAttribution(handle, task),
        payload: {
          verdict,
          accept,
          budgetAdmission: { hardExceeded: handle.budgetHardExceeded === true, refereeAccept, used: { ...handle.budgetUsed }, limits: { tokens: Number(task.brief.budget?.tokens ?? 0), usd: Number(task.brief.budget?.usd ?? 0) } },
          providerGovernanceAdmission: handle.providerGovernance ? {
            policyDigest: handle.providerPolicyDigest ?? this._providerGovernance?.digest ?? null,
            routeDigest: handle.providerGovernance.digest,
            mode: handle.providerGovernance.mode,
            observationOnly: handle.providerGovernance.mode === 'observe',
            hardExceeded: handle.providerPolicyHardExceeded === true,
            telemetryFailed: handle.providerTelemetryFailed === true,
            terminalSeal: handle.providerTerminalSeal,
            turn: handle.providerTurn ? {
              admissionSeq: handle.providerTurn.admissionSeq,
              usage: { ...handle.providerTurn.usage },
              providerCalls: handle.providerTurn.providerCalls,
              toolCalls: handle.providerTurn.toolCalls,
              violation: handle.providerTurn.violation,
              sealed: handle.providerTurn.sealed,
            } : null,
          } : null,
          acceptOpts: {
            requireRedGreen: this._acceptOpts.requireRedGreen ?? false,
            requireCoverage: this._acceptOpts.requireCoverage ?? false,
            requireMutation: this._acceptOpts.requireMutation ?? false,
          },
          capture: {
            sha: captured && captured.sha, snapshotted: captured && captured.snapshotted,
            baseSha: task.sessionContext?.baseSha ?? null,
            vendor: handle.vendor ?? null, model: handle.modelObserved ?? handle.modelResolved ?? null,
            effort: handle.effortObserved ?? handle.effortResolved ?? null,
            routeKey: handle.routeKey ?? null,
            ...(workerToolchainProjection ? { toolchainProjection: workerToolchainProjection, verifierToolchainProjection } : {}),
            ...(baseVerifierToolchainProjection ? { baseVerifierToolchainProjection } : {}),
            ...(workerSparseCheckoutIdentity ? { sparseCheckoutIdentity: workerSparseCheckoutIdentity, verifierSparseCheckoutIdentity } : {}),
            ...(baseVerifierSparseCheckoutIdentity ? { baseVerifierSparseCheckoutIdentity } : {}),
            changedPaths: captured?.changedPaths ?? [],
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
      const routeCard = this._adapters[handle.vendor]?.card(); const routeAttribution = this._routeAttribution(handle, task);
      const routeObservation = this._routeLearningPolicy ? {
        taskType: task.taskType ?? 'general', runId: task.runId ?? null,
        routeKey: task.routeKey ?? routeTupleKey(routeCard, handle.modelResolved, handle.effortResolved, task.taskType),
        modelFamily: routeCard?.modelSelection?.family ?? 'default',
        route: {
          harnessRequested: routeAttribution.harnessRequested, harnessResolved: routeAttribution.harnessResolved,
          modelRequested: routeAttribution.modelRequested, modelResolved: routeAttribution.modelResolved, modelObserved: routeAttribution.modelObserved,
          effortRequested: routeAttribution.effortRequested, effortResolved: routeAttribution.effortResolved, effortObserved: routeAttribution.effortObserved,
        },
        verifiedWin: accept, verificationEvidence: evidence,
      } : null;
      trustPhase = 'terminal_batch';
      const terminal = this._coordination.transitionTaskWithArtifacts(
        task.id, terminalStatus, task.coordinationVersion,
        routeObservation ? { manifests, routeObservation } : manifests, { actor: 'policy', key: `task.${terminalStatus}:${task.id}:${verifyEvent.seq}` }, evidence,
      );
      task.coordinationVersion = terminal.task.version;
      this._settlePlanNodeBudget(task.id);
      if (terminal.routeObservation && this._route && typeof this._route.record === 'function') this._route.record(terminal.routeObservation.routeKey, terminal.routeObservation.taskType, terminal.routeObservation.verifiedWin, { family: terminal.routeObservation.modelFamily, taskId: terminal.routeObservation.taskId, now: Date.parse(terminal.routeObservation.observedAt) });
      this._expireScratchClaims(handle, task, `task_${terminalStatus}`);
      const artifactEvidence = terminal.artifacts.map((artifact) => ({ artifactId: artifact.id }));
      trustPhase = 'promotion';
      this._coordination.promoteKnowledgeNode({
        id: `outcome:${task.id}:${verifyEvent.seq}`,
        taskId: task.id,
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

      if (!this._routeLearningPolicy && this._route && typeof this._route.record === 'function') {
        const card = this._adapters[handle.vendor]?.card();
        try {
          this._route.record(task.routeKey ?? routeTupleKey(card, handle.modelResolved, handle.effortResolved, task.taskType), task.taskType ?? 'general', accept);
        } catch {
          // never let a broken router affect coordinator correctness
        }
      }
    } catch (err) {
      const code = typeof err?.code === 'string' && /^[a-z0-9_]{1,64}$/u.test(err.code)
        ? err.code
        : 'trust_gate_failed';
      const errorEvent = this._log.append({
        worker: handle.id,
        harness,
        turnEpoch: this._safeTurnEpoch(handle),
        kind: 'error',
        actor: 'policy',
        payload: { message: String((err && err.message) || err), code, phase: 'trust_gate', trustPhase },
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
      const cleanupTargets = [verifyPath, baseVerifyPath].filter((path) => path != null);
      const cleanupResults = await Promise.allSettled(cleanupTargets.map((path) => this._worktrees.removeVerifyWorktree(path)));
      const failures = cleanupResults.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        verificationCleanupError = Object.assign(new Error(`verification cleanup failed for ${failures.length} owned sandbox(es)`), {
          code: 'worktree_cleanup_failed', causes: failures.map((result) => result.reason),
        });
        this._log.append({
          worker: handle.id, harness, turnEpoch: this._safeTurnEpoch(handle), kind: 'error', actor: 'policy',
          payload: { message: verificationCleanupError.message, phase: 'verification_cleanup' },
        });
      }
    }

    if (handle.cleanupAfterVerification) {
      const runtimeRemoved = this._removeRuntimeScope(handle);
      await this._removeOwnedTaskWorktree(handle, task);
      if (runtimeRemoved) {
        handle.cleanupAfterVerification = false;
        handle.localAuthority = false;
      } else {
        handle.cleanupPending = true;
      }
    }
    handle.status = handle.processRef?.state === 'closed' ? 'exited' : 'idle';
    this._dispatchPass();
    if (verificationCleanupError) throw verificationCleanupError;
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
      let processGeneration = 0;
      let processRef = null;
      let sessionContext = null;
      let lineage = null;
      let capturedSha = null;
      let integration = null;
      let retainedResultRef = null;
      let publication = null;
      let review = null;
      let runId = null;
      const budgetUsed = { tokens: 0, usd: 0 };
      let budgetHardExceeded = false;
      const budgetThresholdsFired = new Set();
      const usageCumulative = new Map();
      let providerGovernance = null;
      let providerPolicyDigest = null;
      let providerTurn = null;
      let providerPolicyHardExceeded = false;
      let providerTelemetryFailed = false;
      let providerTerminalSeal = null;

      for (const e of events) {
        runId = e.runId ?? runId;
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
          case 'lifecycle.process_started':
            if (validProcessStartedPayload(e.payload) && e.payload.generation > processGeneration) {
              processGeneration = e.payload.generation;
              processRef = { generation: e.payload.generation, pid: e.payload.pid, processGroupId: e.payload.processGroupId, state: 'initializing', ready: false, startedSeq: e.seq, closedSeq: null };
            }
            break;
          case 'lifecycle.process_closed':
            if (validProcessClosedPayload(e.payload) && processRef && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(processRef.state)
              && e.payload.generation === processRef.generation && e.payload.pid === processRef.pid
              && e.payload.processGroupId === processRef.processGroupId
              && e.payload.ready === processRef.ready) {
              processRef = { ...processRef, state: 'closed', ready: e.payload.ready, closedSeq: e.seq };
            }
            break;
          case 'lifecycle.process_ready':
            if (validProcessReadyPayload(e.payload) && processRef?.state === 'initializing'
              && e.payload.generation === processRef.generation && e.payload.pid === processRef.pid
              && e.payload.processGroupId === processRef.processGroupId) {
              processRef = { ...processRef, state: 'ready', ready: true };
            }
            break;
          case 'lifecycle.spawned':
            taskId = e.payload?.taskId ?? taskId;
            brief = e.payload?.brief ?? brief;
            vendorRequested = e.payload?.vendorRequested ?? vendorRequested;
            vendorResolved = e.payload?.vendorResolved ?? vendorResolved;
            modelRequested = e.payload?.modelRequested ?? modelRequested;
            modelResolved = e.payload?.modelResolved ?? modelResolved;
            modelPolicy = e.payload?.modelPolicy ?? modelPolicy;
            if (e.actor === 'orchestrator') providerGovernance = e.payload?.providerGovernance ?? providerGovernance;
            sessionRequest = e.payload?.sessionRequest ?? sessionRequest;
            lineage = e.payload?.lineage ?? lineage;
            review = e.payload?.review ?? review;
            if (e.actor === 'worker') {
              modelObserved = e.payload?.modelObserved ?? e.payload?.modelId ?? e.payload?.model ?? modelObserved;
            }
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
              if (processRef?.state === 'initializing'
                && e.payload?.processGeneration === processRef.generation
                && e.payload?.pid === processRef.pid
                && typeof nativeId === 'string' && nativeId.length > 0) {
                processRef = { ...processRef, state: 'ready', ready: true };
              }
            }
            break;
          case 'worktree.ready':
            sessionContext = e.payload ?? sessionContext;
            break;
          case 'resource.tokens':
            if (e.actor !== 'worker') break;
            {
            const replayTokens = providerGovernance ? e.payload?.tokens : Number(e.payload?.tokens ?? 0);
            const replayUsd = providerGovernance ? e.payload?.usd : Number(e.payload?.usd ?? 0);
            if (!(providerGovernance ? Number.isSafeInteger(replayTokens) : Number.isFinite(replayTokens)) || replayTokens < 0
              || (providerGovernance ? usdToNanos(replayUsd) === null : !Number.isFinite(replayUsd) || replayUsd < 0)) {
              providerTelemetryFailed = true;
              providerPolicyHardExceeded = true;
              if (providerTurn) providerTurn.violation ??= 'usage_value_invalid';
              break;
            }
            const nextBudgetUsd = providerGovernance ? addUsd(budgetUsed.usd, replayUsd) : budgetUsed.usd + replayUsd;
            if (nextBudgetUsd === null) { providerTelemetryFailed = true; providerPolicyHardExceeded = true; if (providerTurn) providerTurn.violation ??= 'usage_value_invalid'; break; }
            budgetUsed.tokens += replayTokens;
            budgetUsed.usd = nextBudgetUsd;
            if (providerTurn) {
              providerTurn.usage.tokens += replayTokens;
              const nextTurnUsd = providerGovernance ? addUsd(providerTurn.usage.usd, replayUsd) : providerTurn.usage.usd + replayUsd;
              if (nextTurnUsd === null) { providerTelemetryFailed = true; providerPolicyHardExceeded = true; providerTurn.violation ??= 'usage_value_invalid'; break; }
              providerTurn.usage.usd = nextTurnUsd;
              if (typeof e.payload?.counterId === 'string') {
                providerTurn.counterIds.add(e.payload.counterId);
                const dimensions = e.payload?.reportedDimensions;
                const prior = providerTurn.counterObservations.get(e.payload.counterId)
                  ?? { tokens: false, usd: false, tokenMetric: null };
                const tokensObserved = dimensions?.tokens === true;
                const usdObserved = dimensions?.usd === true;
                providerTurn.counterObservations.set(e.payload.counterId, {
                  tokens: prior.tokens || tokensObserved,
                  usd: prior.usd || usdObserved,
                  tokenMetric: tokensObserved ? e.payload?.tokenMetric ?? null : prior.tokenMetric,
                });
              }
            }
            if (e.payload?.wireAccounting === 'cumulative') {
              const counterId = e.payload?.counterId ?? e.payload?.source ?? 'unknown';
              usageCumulative.set(`${counterId}:tokens`, Number(e.payload?.wireTokens ?? 0));
              usageCumulative.set(`${counterId}:usd`, Number(e.payload?.wireUsd ?? 0));
            }
            }
            break;
          case 'resource.provider_turn_admitted':
            if (e.actor !== 'policy') break;
            {
              const eventVendor = e.payload?.harness
                ?? Object.keys(this._adapters).find((vendor) => this._harnessOf(vendor) === e.harnessResolved)
                ?? vendorResolved;
              const eventModel = e.payload?.model ?? e.modelResolved ?? modelResolved;
              const eventEffort = e.payload?.effort ?? e.effortResolved ?? effortResolved;
              const historical = replayProviderGovernanceRoute(
                e,
                eventVendor,
                eventModel,
                eventEffort,
              );
              if (!historical) {
                providerPolicyHardExceeded = true;
                providerTelemetryFailed = true;
                break;
              }
              providerGovernance = historical.route;
              providerPolicyDigest = historical.policyDigest;
              if (this._providerGovernance && e.payload?.policyDigest === this._providerGovernance.digest) {
              const admittedRoute = providerGovernanceRoute(
                this._providerGovernance,
                eventVendor,
                eventModel,
                eventEffort,
              );
              if (admittedRoute && admittedRoute.digest === e.payload?.routeDigest
                && admittedRoute.mode === e.payload?.mode
                && canonicalDigest(admittedRoute.terminalReserve) === canonicalDigest(e.payload?.reserve)) {
                providerGovernance = admittedRoute;
                providerPolicyDigest = this._providerGovernance.digest;
              } else {
                providerPolicyHardExceeded = true;
                providerTelemetryFailed = true;
              }
            }
            }
            providerTurn = {
              admissionSeq: e.seq, phase: e.payload?.phase ?? null, usage: { tokens: 0, usd: 0 }, counterIds: new Set(),
              counterObservations: new Map(),
              providerCallIds: new Set(), providerCallPhases: new Map(), anonymousProviderCalls: 0, providerCalls: 0,
              toolCallIds: new Set(), toolCallPhases: new Map(), anonymousToolCalls: 0, toolCalls: 0,
              violation: null, sealed: false,
            };
            break;
          case 'resource.provider_turn_released':
            if (e.actor !== 'policy') break;
            if (providerTurn && e.payload?.admissionSeq === providerTurn.admissionSeq) providerTurn.sealed = true;
            break;
          case 'resource.provider_call': {
            if (e.actor !== 'worker' || !providerTurn || providerTurn.sealed) break;
            const callId = e.payload?.callId;
            const phase = e.payload?.phase;
            if (!validLogicalCallId(callId) || !validLogicalCallPhase(phase)) {
              providerTelemetryFailed = true; providerPolicyHardExceeded = true;
              providerTurn.violation ??= validLogicalCallId(callId) ? 'provider_call_phase_invalid' : 'provider_call_id_invalid';
              break;
            }
            const transition = logicalCallTransition(providerTurn.providerCallPhases.get(callId), phase);
            if (transition === 'invalid') {
              providerTelemetryFailed = true; providerPolicyHardExceeded = true;
              providerTurn.violation ??= phase === 'requested' ? 'provider_call_phase_duplicate' : 'provider_call_phase_invalid';
              break;
            }
            providerTurn.providerCallPhases.set(callId, phase);
            if (transition !== 'new') break;
            providerTurn.providerCallIds.add(callId);
            providerTurn.providerCalls += 1;
            break;
          }
          case 'content.tool_call': {
            if (e.actor !== 'worker' || !providerTurn || providerTurn.sealed) break;
            const callId = e.payload?.callId ?? e.payload?.toolCallId ?? e.payload?.tool_use_id ?? e.payload?.item?.id;
            const phase = e.payload?.phase;
            if (!validLogicalCallId(callId) || !validLogicalCallPhase(phase)) {
              providerTelemetryFailed = true; providerPolicyHardExceeded = true;
              providerTurn.violation ??= validLogicalCallId(callId) ? 'tool_call_phase_invalid' : 'tool_call_id_invalid';
              break;
            }
            const transition = logicalCallTransition(providerTurn.toolCallPhases.get(callId), phase);
            if (transition === 'invalid') {
              providerTelemetryFailed = true; providerPolicyHardExceeded = true;
              providerTurn.violation ??= phase === 'requested' ? 'tool_call_phase_duplicate' : 'tool_call_phase_invalid';
              break;
            }
            providerTurn.toolCallPhases.set(callId, phase);
            if (transition !== 'new') break;
            providerTurn.toolCallIds.add(callId);
            providerTurn.toolCalls += 1;
            break;
          }
          case 'resource.provider_governance_exceeded':
            if (e.actor !== 'policy') break;
            providerPolicyHardExceeded = true;
            if (providerTurn) providerTurn.violation = e.payload?.code ?? 'provider_governance_exceeded';
            terminalStatus = 'failed';
            break;
          case 'resource.provider_telemetry_invalid':
            if (e.actor !== 'policy') break;
            providerTelemetryFailed = true;
            providerPolicyHardExceeded = true;
            if (providerTurn) providerTurn.violation ??= e.payload?.code ?? 'provider_telemetry_invalid';
            terminalStatus = 'failed';
            break;
          case 'resource.budget_threshold':
            if (e.actor !== 'policy') break;
            if (typeof e.payload?.threshold === 'number') budgetThresholdsFired.add(e.payload.threshold);
            if (e.payload?.hardStop === true) budgetHardExceeded = true;
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
              providerTerminalSeal = e.payload?.usageSeal ?? providerTerminalSeal;
              if (providerTurn && providerTerminalSeal) providerTurn.sealed = true;
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
            providerTerminalSeal = e.payload?.usageSeal ?? providerTerminalSeal;
            if (providerTurn && providerTerminalSeal) providerTurn.sealed = true;
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'failed';
            break;
          case 'control.forced_stop':
          case 'control.recovery_terminalized':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'failed';
            break;
          case 'control.refinement_aborted':
            refinementAborted = true;
            break;
          case 'kill.confirmed':
          case 'control.interrupt_confirmed':
            if (e.actor === 'worker') {
              providerTerminalSeal = e.payload?.usageSeal ?? providerTerminalSeal;
              if (providerTurn && providerTerminalSeal) providerTurn.sealed = true;
            }
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
          runId,
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
        task.runId = durable?.runId ?? runId ?? task.runId ?? null;
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

      if (processRef && ['initializing', 'ready'].includes(processRef.state)) processRef = { ...processRef, state: 'unconfirmed_after_restart' };
      this._workers.set(workerId, {
        id: workerId,
        runId: this._coordination?.task(taskId)?.runId ?? runId ?? null,
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
        budgetHardExceeded,
        usageCumulative,
        budgetStopTimer: null,
        turnTerminalObserved: false,
        providerGovernance,
        providerPolicyDigest,
        providerTurn,
        providerPolicyHardExceeded,
        providerTelemetryFailed,
        providerTerminalSeal,
        watchdogActions: new Set(),
        recentFailedActions: [],
        watchdogGeneration: 0,
        watchdogTimer: null,
        runtimeScope: null,
        runtimeLease: null,
        spawnAbort: null,
        worktreeCreationPending: false,
        nativeSpawnPending: false,
        nativeSpawnPromise: null,
        recoverySpawnAbort: null,
        recoverySpawnPending: false,
        recoverySpawnPromise: null,
        recoveryStopReason: null,
        recoveryProviderReleaseDeferred: false,
        processGeneration,
        processRef,
        cleanupPending: false,
        cleanupPromise: null,
        cleanupAfterVerification: false,
        currentIncarnation: false,
        ownedWorktreeAuthority: false,
        localAuthority: false,
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
