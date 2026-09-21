// Issue #259 slice 8: the coordinator's recovery bucket moves here against the injected
// recorder port (seam-map §4.3; the port itself landed in slice 6, runtime-recorder-port.mjs).
// The 42 members classified recovery in impl/scripts/seam-inventory.json keep verbatim
// bodies: `this.` became the explicit receiver `coordinator`, recording goes through the
// port parameter `recorder` (log / coordination / mapEvent / recordDriver — the same port
// createDriver assembles), and sibling recovery paths call each other inside the module.
// One-way import: coordinator.mjs imports this module; this module imports neither monolith.

import { observeAdapterEvents } from './adapter.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { boundedAttentionText, createBrief } from './messages.mjs';
import { KILL_ESCALATION_GRACE_MS, processAuthorityState, recoveryProcessAbsentPayload, validProcessAuthorityPayload, validProcessClosedPayload, validProcessReadyPayload, validProcessStartedPayload, validRecoveryProcessAbsentPayload, validRecoveryProcessReapedPayload } from './process-lifecycle.mjs';
import { providerGovernanceRoute } from './provider-governance.mjs';
import { createRecoveryAttemptAdmission, recoveryAttemptSeriesId } from './recovery-attempt.mjs';
import { CoordinationRefusal } from './coordination-internals.mjs';
import { addUsd, usdFromNanos, usdToNanos } from './usd.mjs';
import { compareWorkerPolicyObservation, normalizeWorkerPolicyObservation, normalizeWorkerPolicyRequest, normalizeWorkerPolicyResolution, resolveWorkerPolicy } from './worker-policy.mjs';
import { ensureLaneBranchAtHead, normalizeSparseCheckoutIdentity, normalizeSparsePaths, sparseCheckoutIdentity } from './worktree.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isPhysicalWorkspaceId } from './shared-workspace-custody.mjs';
import { normalizeVerifierFailureCapsule } from './verifier-diagnostics.mjs';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Module-scope primitives the moved bodies read, relocated verbatim from
// coordinator.mjs (28 declarations). Stay-behind coordinator code imports them back;
// PUSH_REFUSAL_CODES, REARM_KINDS and SessionSelectionError are re-exported so the
// coordinator's export surface is unchanged.
// ---------------------------------------------------------------------------

export const KILL_RULES = Object.freeze({
  stopRequested: 'stop_requested',
  runStop: 'run_stop',
  drain: 'deployment_drain',
  startupReconciliation: 'startup_reconciliation',
  preservedReattachmentFailed: 'preserved_reattachment_failed',
  stallReap: 'stall_reap',
  watchdog: 'watchdog_action',
  providerBudget: 'provider_budget_hard_limit',
  providerGovernance: 'provider_governance_violation',
  providerFault: 'provider_fault',
  providerCrash: 'provider_crash',
  preservationUnproven: 'preservation_unproven',
  stopDeadline: 'stop_deadline',
  interruptEscalated: 'interrupt_escalated_to_kill',
  workerPolicyMismatch: 'worker_policy_mismatch',
  worktreeAuthorityLost: 'worktree_authority_lost',
  spawnRefused: 'spawn_refused',
  protocolViolation: 'protocol_violation',
  processObservationRefused: 'process_observation_refused',
  terminalObservation: 'terminal_observation',
});

export const LOGICAL_CALL_PHASES = new Set(['requested', 'progress', 'completed', 'failed', 'cancelled']);

export const RUN_TIMELINE_OPERATIONAL_KINDS = new Set([
  'content.file_edit', 'content.message', 'content.tool_call',
  'control.delivery_amended', 'control.delivery_refused', 'control.delivery_requested',
  'control.follow_up_requested', 'control.interrupt_confirmed',
  'control.interaction_superseded', 'control.interrupt_requested',
  'control.session_preservation_reattached',
  'control.stale_rejected',
  'kill.confirmed', 'kill.requested',
  'lifecycle.crashed', 'lifecycle.process_closed', 'lifecycle.process_ready',
  'lifecycle.process_reap_unconfirmed', 'lifecycle.process_started', 'lifecycle.spawned',
  'lifecycle.turn_completed', 'lifecycle.turn_started',
  'resource.provider_call', 'resource.tokens',
  'verify.reverified', 'work.resumed',
]);

export const REARM_KINDS = Object.freeze([
  'approval.resolved',
  'decision.settled',
  'lifecycle.turn_started',
  'question.answered',
]);

export const PUSH_REFUSAL_CODES = Object.freeze({
  attention_push_not_addressed: 'an item’s workerId does not match the receiving worker',
  attention_push_oversized: 'the pending set exceeds the item-count bound and the spill lane is unavailable',
  attention_push_stale: 'a re-push attempted for an item that is no longer pending',
  attention_push_unknown_item: 'a referenced item id is not a push-qualified pending item',
});

export function validLogicalCallId(value) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value) <= 256 && !value.includes('\0');
}

export function validLogicalCallPhase(value) {
  return typeof value === 'string' && LOGICAL_CALL_PHASES.has(value);
}

export function addSafeTokenCounts(left, right) {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) return null;
  const total = left + right;
  return Number.isSafeInteger(total) ? total : null;
}

export function logicalCallTransition(prior, next) {
  if (prior === undefined) return next === 'progress' ? 'invalid' : 'new';
  if (next === 'requested') return 'invalid';
  if (['completed', 'failed', 'cancelled'].includes(prior)) {
    return prior === next ? 'duplicate' : 'invalid';
  }
  if (next === 'progress') return 'progress';
  return 'terminal';
}

export function boundedProcessObservation(event, code, extra = {}) {
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

export function validWorkspaceOwnerBoundPayload(value) {
  const fields = [
    'attemptId', 'baseSha', 'branch', 'controllerId', 'deploymentId', 'logicalTaskId',
    'physicalOwnerId', 'processGeneration', 'receiptDigest', 'runId', 'schemaVersion', 'worktree',
  ];
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === fields.sort().join(',')
    && value.schemaVersion === 1
    && isPhysicalWorkspaceId(value.physicalOwnerId)
    && /^[a-f0-9]{64}$/u.test(value.receiptDigest ?? '')
    && /^[a-f0-9]{64}$/u.test(value.deploymentId ?? '')
    && /^[a-f0-9]{64}$/u.test(value.controllerId ?? '')
    && /^[a-f0-9]{40}$/u.test(value.baseSha ?? '')
    && value.branch === `baton/${value.physicalOwnerId}`
    && typeof value.worktree === 'string' && value.worktree.length > 0
    && typeof value.logicalTaskId === 'string' && value.logicalTaskId.length > 0
    && (value.runId === null || (typeof value.runId === 'string' && value.runId.length > 0))
    && typeof value.attemptId === 'string' && value.attemptId.length > 0
    && Number.isSafeInteger(value.processGeneration) && value.processGeneration > 0;
}

export function workspaceOwnerExpectation(handle) {
  const context = handle?.sessionContext;
  const physicalOwnerId = context?.ownerTaskId;
  if (typeof physicalOwnerId !== 'string') return null;
  if (!isPhysicalWorkspaceId(physicalOwnerId)) return physicalOwnerId;
  const ownerBound = handle.workspaceOwnerBinding;
  return {
    expectationId: handle.id,
    handleRunId: handle.runId ?? null,
    physicalOwnerId,
    binding: {
      physicalOwnerId,
      receiptDigest: context.ownerReceiptDigest,
      logicalTaskId: context.logicalTaskId,
      runId: ownerBound?.runId,
      attemptId: ownerBound?.attemptId,
      processGeneration: ownerBound?.processGeneration,
      branch: context.branch,
      worktree: context.worktree,
      baseSha: context.baseSha,
      ownerBound,
    },
  };
}

export class SessionSelectionError extends Error {
  constructor(message, code = 'session_mode_unavailable') {
    super(message);
    this.name = 'SessionSelectionError';
    this.code = code;
  }
}

// Issue #259 slice 12 (runtime-effects tranche 2): the base-layer declarations the effect and
// admission modules both read. They live here — not in runtime-effects.mjs — because the import
// rule is one-way (effects may import admission, admission never imports effects), so a shared
// declaration in effects would be unreachable from admission without a cycle.

export class IntegrationError extends Error {
  constructor(message, code = 'integration_refused') {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
  }
}

export const ORIENTATION_DELIVERY = Symbol('orientation-delivery');

export function noop() {}

export const CLOSED_VERIFIER_OUTCOMES = new Set(['passed', 'candidate_failed', 'inconclusive']);

export const CLOSED_VERIFIER_OWNERS = new Set(['candidate', 'verifier', 'baseline_or_environment']);

export const CLOSED_VERIFIER_EXECUTIONS = new Map([
  ['completed', 'verification_completed'],
  ['timed_out', 'verification_timed_out'],
  ['output_exceeded', 'verification_output_exceeded'],
  ['unavailable', 'verification_spawn_unavailable'],
]);

export const CLOSED_VERIFIER_DIAGNOSTICS = new Set([
  'verification_output_exceeded', 'verification_timed_out', 'verification_spawn_unavailable',
  'verification_claim_diverged', 'verification_red_green_failed', 'verification_coverage_failed',
  'verification_mutation_failed', 'verification_coverage_unavailable', 'verification_mutation_unavailable',
  'verification_passed', 'verification_exit_mismatch', 'verification_not_required',
]);

export const hex64OrNull = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;

export const boolOrNull = (value) => typeof value === 'boolean' ? value : null;

export const intOrNull = (value) => Number.isSafeInteger(value) ? value : null;

export const closedExecution = (value, observedExit = null) => {
  const state = CLOSED_VERIFIER_EXECUTIONS.has(value?.state)
    ? value.state : Number.isSafeInteger(observedExit) ? 'completed' : 'unavailable';
  return Object.freeze({ state, code: CLOSED_VERIFIER_EXECUTIONS.get(state) });
};

export function closedVerificationVerdict(value, verification = {}) {
  const observed = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const observedExit = intOrNull(observed.observedExit);
  const reverified = observed.reverified === true;
  const passed = typeof observed.passed === 'boolean' ? observed.passed
    : reverified && observedExit === verification.expectExit;
  const execution = closedExecution(observed.execution, observedExit);
  const outcome = CLOSED_VERIFIER_OUTCOMES.has(observed.outcome) ? observed.outcome
    : execution.state !== 'completed' ? 'inconclusive' : passed ? 'passed' : 'candidate_failed';
  const failureOwnership = CLOSED_VERIFIER_OWNERS.has(observed.failureOwnership)
    ? observed.failureOwnership : outcome === 'candidate_failed' ? 'candidate'
      : outcome === 'inconclusive' ? 'verifier' : null;
  const uncovered = Array.isArray(observed.uncoveredChangedLines) ? observed.uncoveredChangedLines : [];
  const survived = Array.isArray(observed.survivedMutants) ? observed.survivedMutants : [];
  const capturedOutputBytes = Number.isSafeInteger(observed.capturedOutputBytes)
    && observed.capturedOutputBytes >= 0 ? observed.capturedOutputBytes : 0;
  const emptyDigest = createHash('sha256').update('').digest('hex');
  const capturedOutputDigest = hex64OrNull(observed.capturedOutputDigest) ?? emptyDigest;
  const failureCapsule = passed ? null : normalizeVerifierFailureCapsule(
    observed.failureCapsule,
    { capturedOutputBytes, capturedOutputDigest },
  );
  let diagnosticCode = CLOSED_VERIFIER_DIAGNOSTICS.has(observed.diagnosticCode)
    ? observed.diagnosticCode : null;
  if (!diagnosticCode) {
    diagnosticCode = execution.state !== 'completed' ? execution.code
      : passed ? 'verification_passed' : 'verification_exit_mismatch';
  }
  return Object.freeze({
    schemaVersion: 1,
    reverified,
    observedExit,
    outputExceeded: observed.outputExceeded === true,
    hadClaim: observed.hadClaim === true,
    matchesClaim: observed.matchesClaim !== false,
    passed,
    locus: observed.locus === 'fresh_sandbox' ? 'fresh_sandbox' : null,
    redGreen: boolOrNull(observed.redGreen),
    baseExit: intOrNull(observed.baseExit),
    coverageOfChange: boolOrNull(observed.coverageOfChange),
    uncoveredChangedLineCount: uncovered.length,
    uncoveredChangedLinesDigest: canonicalDigest(uncovered),
    mutationStrength: Number.isFinite(observed.mutationStrength)
      && observed.mutationStrength >= 0 && observed.mutationStrength <= 1 ? observed.mutationStrength : null,
    mutationPassed: boolOrNull(observed.mutationPassed),
    survivedMutantCount: survived.length,
    survivedMutantsDigest: canonicalDigest(survived),
    capturedOutputBytes,
    capturedOutputDigest,
    ...(failureCapsule ? { failureCapsule } : {}),
    diagnosticCode,
    durationMs: Number.isFinite(observed.durationMs) && observed.durationMs >= 0
      ? Math.trunc(observed.durationMs) : null,
    execution,
    baseExecution: observed.baseExecution == null ? null : closedExecution(observed.baseExecution),
    runtimeDigest: hex64OrNull(observed.runtimeDigest),
    outcome,
    failureOwnership,
  });
}


export const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function canonicalDigest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

export function replayProviderGovernanceRoute(event, vendor, model, effort) {
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

export function providerProcessingFailureCode(error) {
  if (['provider_index_changed', 'reuse_policy_reconciliation_required', 'reuse_evidence_diverged'].includes(error?.code)) return error.code;
  if (typeof error?.code === 'string' && error.code.startsWith('capability_')) return 'capability_refused';
  return 'provider_processing_failed';
}

export function typedTerminalCode(value, fallback) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && /^[a-z0-9][a-z0-9._-]*$/i.test(value) ? value : fallback;
}

export function throwIfProviderCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('provider processing cancelled'), { code: 'cancelled' });
}

export function officialCoordinateMatches(identity, coordinate) {
  if (!identity || !coordinate) return false;
  const fields = Object.keys(identity).sort().join(',');
  if (!['ecosystem,package,version', 'ecosystem,package,system,version'].includes(fields)) return false;
  return identity.ecosystem === coordinate.ecosystem && identity.package === coordinate.package && identity.version === coordinate.version
    && (!Object.hasOwn(identity, 'system') || (coordinate.ecosystem === 'npm' && identity.system === 'NPM'));
}

export function decisionRef(ref, kind, mediaType) {
  if (!ref || ref.kind !== kind || ref.mediaType !== mediaType || !/^[a-f0-9]{64}$/.test(ref.digest ?? '')
    || ref.handle !== `art:sha256:${ref.digest}` || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) {
    const error = new TypeError('reuse decision evidence reference is invalid'); error.code = 'reuse_evidence_invalid'; throw error;
  }
  return { kind, handle: ref.handle, digest: ref.digest, bytes: ref.bytes, mediaType };
}

export function minimalBrief() {
  return { goal: '', constraints: [], pathScope: [], definitionOfDone: '', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 0, usd: 0, wallMin: 0 } };
}

export function normalizeSessionRequest(request) {
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
    for (const key of ['repoRoot', 'baseSha', 'branch', 'ownerTaskId', 'logicalTaskId', 'ownerReceiptDigest']) {
      if (request.context[key] !== undefined && (typeof request.context[key] !== 'string' || request.context[key].length === 0)) {
        throw new SessionSelectionError(`session.context.${key} must be a non-empty string`, 'invalid_session_request');
      }
    }
    if (request.context.ownerReceiptDigest !== undefined
      && !/^[a-f0-9]{64}$/u.test(request.context.ownerReceiptDigest)) {
      throw new SessionSelectionError('session.context.ownerReceiptDigest must be an exact digest', 'invalid_session_request');
    }
    if (isPhysicalWorkspaceId(request.context.ownerTaskId)
      && (request.context.logicalTaskId === undefined || request.context.ownerReceiptDigest === undefined)) {
      throw new SessionSelectionError('physical session context requires its logical binding and receipt digest', 'invalid_session_request');
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
      ...(request.context.logicalTaskId ? { logicalTaskId: request.context.logicalTaskId } : {}),
      ...(request.context.ownerReceiptDigest ? { ownerReceiptDigest: request.context.ownerReceiptDigest } : {}),
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

export function cardSupportsSession(card, request) {
  if (!request || request.mode === 'new') return true;
  return card?.sessions?.[request.mode] === 'native' || card?.sessions?.[request.mode] === 'emulated';
}

export function startupReconcilerRecord(caught) {
  if (!caught || typeof caught !== 'object') return null;
  for (const candidate of [caught.record, caught.physicalOwnerId, caught.workspaceId, caught.workerId, caught.leaseId]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return null;
}

export function startupReconcilerNext(caught, observed, record, repair) {
  const named = typeof caught?.next === 'string' && caught.next.length > 0 ? caught.next : null;
  if (observed?.alive === true) {
    const target = record === null ? 'the named record' : record;
    return `retry after ${KILL_ESCALATION_GRACE_MS} ms — the process that still owns ${target}`
      + ` (pid ${observed.pid ?? 'unknown'}) is alive`;
  }
  const age = observed?.leaseAgeMs ?? null;
  if (Number.isSafeInteger(age)) {
    const grace = Number.isSafeInteger(observed.leaseGraceMs) ? observed.leaseGraceMs : KILL_ESCALATION_GRACE_MS;
    const target = record === null ? 'the named record' : record;
    return `retry after ${grace} ms — the lease on ${target} is ${age} ms old, inside its ${grace} ms grace`;
  }
  return named ?? repair;
}

// ---------------------------------------------------------------------------
// The moved recovery members. Same names, same parameter lists, same arity: the
// coordinator keeps a three-line delegate per member forwarding (this, this._recorder, ...).
// ---------------------------------------------------------------------------

export function completeDeferredStartup(coordinator, recorder) {
    if (coordinator._startupReconstructionPending !== true) return false;
    if (recorder.coordination?._deferredLoad === true) {
      throw new CoordinationRefusal('coordination store is still replaying: completeDeferredStartup runs after loadCoordinationStoreAsync resolves', 'coordination_store_loading');
    }
    coordinator._startupReconstructionPhase = 'running';
    coordinator._startupReconstructionStartedAt = Date.now();
    return coordinator._runStartupReconstructionAsync().then(() => {
      coordinator._startupReconstructionElapsedMs = Date.now() - coordinator._startupReconstructionStartedAt;
      coordinator._startupReconstructionPhase = 'done';
      return true;
    });
  }

export function _startupReconstruction(coordinator, recorder) {
    coordinator._startupReconstructionPhase = 'running';
    coordinator._startupReconstructionStartedAt = Date.now();
    const passes = coordinator._startupReconstructionPasses();
    let step = passes.next();
    while (!step.done) step = passes.next();
    coordinator._startupReconstructionElapsedMs = Date.now() - coordinator._startupReconstructionStartedAt;
    coordinator._startupReconstructionPhase = 'done';
  }

export async function _runStartupReconstructionAsync(coordinator, recorder) {
    const breathe = () => new Promise((resolve) => { setImmediate(resolve); });
    const passes = coordinator._startupReconstructionPasses();
    let step = passes.next();
    while (!step.done) {
      await breathe();
      step = passes.next();
    }
    return true;
  }

export function startupReconstructionStatus(coordinator, recorder) {
    const startedAt = coordinator._startupReconstructionStartedAt ?? null;
    const state = coordinator._startupReconstructionPhase ?? 'pending';
    return Object.freeze({
      state,
      startedAt,
      elapsedMs: state === 'done'
        ? (coordinator._startupReconstructionElapsedMs ?? null)
        : (startedAt === null ? null : Date.now() - startedAt),
    });
  }

export function startupWorkerFleet(coordinator, recorder) {
    return coordinator._startupWorkerFleet ?? null;
  }

export function* _startupReconstructionPasses(coordinator, recorder) {
    const chunk = FRAME_LIMITS['view.wake_replay.items'].value;
    coordinator._startupReconstructionPending = false;
    // One bounded startup clone feeds every reconstruction pass. Per-worker snapshot cloning made
    // replay proportional to worker-count times the complete coordination state.
    coordinator._startupCoordinationSnapshot = recorder.coordination.snapshot();
    yield;
    yield* coordinator._seedCoordinationTasksPasses();
    if (typeof recorder.coordination.unsettledPlanNodeTasks === 'function' && typeof recorder.coordination.settlePlanNodeBudget === 'function') {
      let sinceYield = 0;
      for (const taskId of recorder.coordination.unsettledPlanNodeTasks()) {
        coordinator._settlePlanNodeBudget(taskId);
        if ((sinceYield += 1) >= chunk) { sinceYield = 0; yield; }
      }
    }
    for (const [sourceVendor, adapter] of Object.entries(coordinator._adapters)) {
      // #477: a registration OBSERVES ALONGSIDE, it never replaces (adapter.mjs
      // observeAdapterEvents — the ONE derivation of the adapter listener chain). This seam is
      // registered from the startup reconstruction, so on the async open path
      // (coordinationAsyncOpen, #351 lane 3 / #434) it lands AFTER the deployment's liveness
      // observer, which route-liveness.mjs installs while the deployment opens. A plain `onEvent`
      // here replaced that wrapper: the probe's terminal wire then reached no liveness observer,
      // every probe settled `unknown`, and the readiness tier never verified or blocked — silently.
      // The helper forwards to whoever registered before this seam, so both observers stay fed and
      // registration order stops deciding who sees the adapter.
      observeAdapterEvents(adapter, (e) => {
        if (coordinator._closed) return;
        if (!e || typeof e !== 'object' || e.actor !== 'worker') {
          const handle = coordinator._workers.get(e?.worker);
          if (!coordinator._fatalError && handle) {
            recorder.log.append({
              worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
              kind: 'lifecycle.process_attribution_refused', actor: 'policy',
              payload: boundedProcessObservation(e, 'adapter_actor_authority_refused', { sourceVendor }),
              ...coordinator._routeAttribution(handle),
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
          harness: coordinator._harnessOf(sourceVendor),
        };
        if (coordinator._fatalError) {
          coordinator._observeEmergencyTerminal(observed, sourceVendor);
          return;
        }
        try { coordinator._handleEvent(observed, sourceVendor); } catch (err) {
          // Adapter callbacks are an asynchronous trust boundary. A fatal authoritative-write
          // failure has already poisoned this coordinator; do not let it become an uncaught
          // process exception. The next ordinary public command observes the fatal error. An
          // explicit emergency stop may still consume native confirmation without inventing a
          // durable event, solely so owned process/worktree/runtime resources can be reaped.
          if (!coordinator._fatalError) throw err;
          const handle = coordinator._workers.get(observed.worker);
          if (['kill.confirmed', 'lifecycle.process_closed'].includes(observed.kind)) {
            coordinator._observeEmergencyTerminal(observed, sourceVendor);
          } else if (handle?.localAuthority === true && observed.kind === 'lifecycle.process_started') {
            coordinator._bestEffort(coordinator._emergencyKillUnlogged(handle), 'emergency_kill');
          }
        }
      });
    }

    yield;
    yield* coordinator._replay();
    // An exact durable process authority can also prove that its group is already absent. Close
    // that generation now, before generic worktree/runtime reconciliation, so this controller's
    // first usable state agrees with the cleanup it is about to expose. This is policy-observed
    // restart absence, never a fabricated worker-origin process_closed event.
    const absentRecoveredProcessHandles = [...coordinator._workers.values()].filter((handle) => (
      handle.processRef?.state === 'unconfirmed_after_restart'
      && processAuthorityState(handle.processRef, handle.processAuthority) === 'absent'
    ));
    let sinceHandleYield = 0;
    for (const handle of absentRecoveredProcessHandles) {
      if ((sinceHandleYield += 1) >= chunk) { sinceHandleYield = 0; yield; }
      const task = coordinator._tasks.get(handle.taskId);
      const absent = recorder.log.append({
        worker: handle.id,
        harness: handle.vendor ? coordinator._harnessOf(handle.vendor) : '',
        turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.recovery_process_absent',
        actor: 'policy',
        ...coordinator._routeAttribution(handle, task),
        payload: recoveryProcessAbsentPayload(handle.processRef),
      });
      recorder.mapEvent(absent);
      handle.processRef = { ...handle.processRef, state: 'closed', closedSeq: absent.seq };
      handle.recoveredProcessAuthority = false;
    }
    // Issue #364: the fleet THIS incarnation actually controls, captured here — the one point where
    // both facts are settled: a handle this incarnation spawned (`currentIncarnation`, set at spawn
    // and never cleared) or a kernel-start-bound process the replay proved still alive
    // (`recoveredProcessAuthority`, the absent ones just cleared above). Every OTHER handle the
    // ledger replayed is a worker that died with an earlier incarnation: its process status is a
    // historical record, not a process. `startupWorkerFleet()` publishes exactly this split, and
    // the swarm runtime reconciles its participant runtime rows against it (#364) — never against a
    // hand-kept list of its own.
    {
      const owned = [];
      const recovered = [];
      const lost = [];
      for (const handle of coordinator._workers.values()) {
        if (handle.currentIncarnation === true) { owned.push(handle.id); continue; }
        if (handle.recoveredProcessAuthority === true) { recovered.push(handle.id); continue; }
        // `processGeneration` is the worker's own incarnation number; 0 is the honest reading for a
        // ledger that recorded none, never a fabricated generation.
        lost.push(Object.freeze({
          workerId: handle.id,
          incarnation: Number.isSafeInteger(handle.processGeneration) ? handle.processGeneration : 0,
          taskId: handle.taskId ?? null,
          runId: handle.runId ?? null,
        }));
      }
      coordinator._startupWorkerFleet = Object.freeze({
        owned: Object.freeze(owned), recovered: Object.freeze(recovered), lost: Object.freeze(lost),
      });
    }
    // A controller-local transport does not survive restart, but a kernel-start-bound process
    // generation can. Keep every checkout/runtime/capacity lease that generation still owns;
    // Run stop will close the exact group before these resources become reapable.
    const recoveredProcessHandles = [...coordinator._workers.values()].filter((handle) => (
      handle.recoveredProcessAuthority === true
      && handle.processRef?.state === 'unconfirmed_after_restart'
      && handle.sessionContext?.ownerTaskId
    ));
    const recoveredProcessOwners = recoveredProcessHandles
      .map((handle) => workspaceOwnerExpectation(handle))
      .filter(Boolean);
    const recoveredProcessWorkers = recoveredProcessHandles.map((handle) => handle.id);
    const uniqueOwnerExpectations = (entries) => [...new Map(entries.filter(Boolean).map((entry) => [
      typeof entry === 'string' ? entry : entry.expectationId, entry,
    ])).values()];
    const reconcileStartupResources = (expectedOwners, expectedWorkers) => {
      const reconciliations = [];
      if (coordinator._worktrees && typeof coordinator._worktrees.reconcile === 'function') {
        reconciliations.push(coordinator._trackStartupCleanup(
          () => {
            const applyOwnerAuthority = (report) => {
              const validated = new Set(report?.validatedExpectedBindings ?? []);
              const removed = new Set(report?.removedPhysicalOwners ?? []);
              for (const handle of coordinator._workers.values()) {
                const physicalOwnerId = handle.sessionContext?.ownerTaskId;
                if (!isPhysicalWorkspaceId(physicalOwnerId)) continue;
                const requested = expectedOwners.some((entry) => (
                  typeof entry === 'object' && entry?.expectationId === handle.id
                ));
                // Reconcile reports this only after exact capacity absence and path/admin/branch/
                // receipt finalization. Reflect that completed transaction on replayed terminal
                // handles so later idempotent resource settlement exercises no owner capability.
                if (removed.has(physicalOwnerId)) {
                  handle.worktree = null;
                  handle.ownedWorktreeAuthority = false;
                  handle.physicalWorkspaceCleanupCompleted = true;
                  handle.workspaceOwnerBindingValid = false;
                  handle.workspaceOwnerProcessAuthorityValid = false;
                  handle.workspaceOwnerBindingDiagnostic = 'workspace_owner_reconciled_absent';
                  continue;
                }
                if (!requested) {
                  const retainedDiagnostic = report?.diagnostics?.find((row) => (
                    row?.physicalOwnerId === physicalOwnerId && row.retained === true
                  ));
                  if (retainedDiagnostic) {
                    handle.workspaceOwnerBindingValid = false;
                    handle.workspaceOwnerProcessAuthorityValid = false;
                    handle.ownedWorktreeAuthority = false;
                    handle.physicalWorkspaceCleanupCompleted = false;
                    handle.workspaceOwnerBindingDiagnostic = retainedDiagnostic.code
                      ?? 'workspace_owner_binding_unproven';
                  }
                  continue;
                }
                const bindingValid = validated.has(handle.id);
                const processValid = handle.processRef?.state === 'unconfirmed_after_restart'
                  && handle.recoveredProcessAuthority === true
                  && processAuthorityState(handle.processRef, handle.processAuthority) === 'active';
                handle.workspaceOwnerBindingValid = bindingValid;
                handle.physicalWorkspaceCleanupCompleted = false;
                handle.workspaceOwnerProcessAuthorityValid = processValid;
                handle.ownedWorktreeAuthority = bindingValid && processValid
                  && typeof handle.worktree === 'string';
                if (!bindingValid) {
                  handle.workspaceOwnerBindingDiagnostic = report?.diagnostics?.find(
                    (row) => (row.expectationId === handle.id || row.physicalOwnerId === physicalOwnerId)
                      && row.retained === true,
                  )?.code ?? 'workspace_owner_binding_unproven';
                } else if (!processValid) {
                  handle.workspaceOwnerBindingDiagnostic = 'workspace_owner_process_authority_unproven';
                }
              }
              // Issue #428: the reconciliation's custody outcomes ride the coordination
              // ledger (driver.recorded) too, so the swarm projection derives a seat's
              // workspace story from rows, not from reconstruction.
              for (const row of report?.removedWorkspaces ?? []) {
                recorder.recordDriver('worktree.removed', {
                  workspaceId: row.physicalOwnerId, participantId: null, workerId: null,
                  reason: 'crash_reconciliation', snapshot: row.snapshot ?? null,
                  branch: row.branch ?? null, at: new Date().toISOString(),
                }, `worktree.removed:${row.physicalOwnerId}:${row.snapshot ?? 'none'}`);
              }
              for (const row of report?.diagnostics ?? []) {
                if (row?.code !== 'workspace_owner_head_uncontained_retained' || row.retained !== true) continue;
                recorder.recordDriver('worktree.custody_retained', {
                  workspaceId: row.physicalOwnerId, participantId: null,
                  code: row.code, reason: 'crash_reconciliation',
                  headSha: row.headSha ?? null, branch: row.branch ?? null,
                }, `worktree.custody_retained:${row.physicalOwnerId}:${row.headSha ?? 'unknown'}`);
              }
              return report;
            };
            const knownPhysicalOwnerIds = [...new Set([...coordinator._workers.values()]
              .map((handle) => handle.sessionContext?.ownerTaskId)
              .filter((owner) => isPhysicalWorkspaceId(owner)))];
            const result = coordinator._worktrees.reconcile(expectedOwners, knownPhysicalOwnerIds);
            return result && typeof result.then === 'function'
              ? Promise.resolve(result).then(applyOwnerAuthority)
              : applyOwnerAuthority(result);
          },
          'workspace_owners',
        ));
      }
      if (coordinator._runtimeScopes && typeof coordinator._runtimeScopes.reconcile === 'function') {
        reconciliations.push(coordinator._trackStartupCleanup(
          () => coordinator._runtimeScopes.reconcile(expectedWorkers),
          'worker_processes',
        ));
      }
      if (absentRecoveredProcessHandles.length > 0) {
        coordinator._trackStartupCleanup(() => Promise.all(reconciliations).then(() => {
          if (coordinator._startupCleanupError) throw coordinator._startupCleanupError;
          for (const handle of absentRecoveredProcessHandles) {
            if (isPhysicalWorkspaceId(handle.sessionContext?.ownerTaskId)
              && handle.physicalWorkspaceCleanupCompleted !== true) {
              handle.cleanupPending = true;
              handle.cleanupError = handle.workspaceOwnerBindingDiagnostic
                ?? 'workspace_owner_binding_unproven';
              continue;
            }
            handle.worktree = null;
            handle.ownedWorktreeAuthority = false;
            handle.runtimeLease = null;
            if (handle.runtimeScope) handle.runtimeScope = { ...handle.runtimeScope, active: false };
            handle.cleanupPending = false;
            handle.cleanupError = null;
            handle.localAuthority = false;
          }
        }), 'worker_process_cleanup');
      }
    };
    if (!coordinator._startupRecoveryAuthority) {
      // Phase 91: replay must identify closed preservation receipts before worktree
      // reconciliation. An empty expected set would destroy the exact checkout bound by the
      // receipt and make attach-only recovery impossible. Retain only nonterminal owners whose
      // operational fold closed on a preserved interrupt; every ordinary replayed checkout is
      // still reconciled away. Runtime scopes are never trusted across controller incarnation.
      const preservedOwners = [...coordinator._workers.values()].filter((handle) => {
        const task = coordinator._tasks.get(handle.taskId);
        const preservationAuthority = coordinator._exactProcesslessPreservationAuthority(handle, task);
        if (!preservationAuthority.ok) {
          handle.preservationAuthorityDiagnostic = preservationAuthority.result;
        }
        return handle.status === 'orphaned'
          && handle.sessionPreservation?.state === 'preserved'
          && handle.sessionPreservation?.transport === 'attached'
          && handle.sessionContext?.ownerTaskId
          && task && !TERMINAL_TASK_STATUSES.has(task.status)
          && preservationAuthority.ok;
      }).map((handle) => workspaceOwnerExpectation(handle));
      const expectedOwners = uniqueOwnerExpectations([...preservedOwners, ...recoveredProcessOwners]);
      reconcileStartupResources(expectedOwners, recoveredProcessWorkers);
    } else {
      const eligible = [...coordinator._workers.values()].filter((handle) => {
        const adapter = coordinator._adapters[handle.vendor];
        const task = coordinator._tasks.get(handle.taskId);
        return handle.status === 'orphaned' && handle.sessionRef?.persistence === 'native'
          && handle.sessionContext?.ownerTaskId && adapter && cardSupportsSession(adapter.card(), { mode: 'resume' })
          && coordinator._recoveryDispatchRefusal(handle, task, { allowUnvalidatedOwner: true }) === null;
      });
      const expectedOwners = uniqueOwnerExpectations([
        ...eligible.map((handle) => workspaceOwnerExpectation(handle)),
        ...recoveredProcessOwners,
      ]);
      const expectedWorkers = [...new Set([
        ...eligible.map((handle) => handle.id), ...recoveredProcessWorkers,
      ])];
      reconcileStartupResources(expectedOwners, expectedWorkers);
    }
    yield;
    yield* coordinator._terminalizeUnattachedCoordinationTasks();
    coordinator._startupCoordinationSnapshot = null;
  }

export function _startupCleanupIncomplete(coordinator, recorder, caught, reconciler = null) {
    let base = 'startup owned-resource reconciliation failed';
    const report = caught?.report;
    const named = new Set();
    if (report && (Array.isArray(report.diagnostics) || Array.isArray(report.errors))) {
      for (const row of (report.diagnostics ?? [])) {
        if (row?.retained === true && typeof row.physicalOwnerId === 'string') named.add(row.physicalOwnerId);
      }
      for (const entry of (report.errors ?? [])) {
        const [candidate] = String(entry).split(/[\s:]/u, 1);
        if (isPhysicalWorkspaceId(candidate)) named.add(candidate);
      }
      if (named.size > 0) {
        base = `startup owned-resource reconciliation refused: ${[...named].sort().join(', ')}`
          + ' — delete the named records under .git/baton/workspace-owners/ after proving their'
          + ' controllers dead, or restore their worktrees';
      }
    }
    const records = Object.freeze([...named].sort());
    const record = records[0] ?? startupReconcilerRecord(caught);
    const observed = coordinator._startupReconcilerObservation(caught, records, record);
    const next = startupReconcilerNext(caught, observed, record, /refused/u.test(base)
      ? 'delete the named records under .git/baton/workspace-owners/ after proving their controllers'
        + ' dead, or restore their worktrees'
      : null);
    const detail = Object.freeze({ reconciler, record, observed, next });
    const chain = reconciler === null ? '' : ` (reconciler ${reconciler}`
      + `${record === null ? '' : `; record ${record}`}`
      + `${observed === null ? '' : `; observed ${JSON.stringify(observed)}`}`
      + `${next === null ? '' : `; next: ${next}`})`;
    return Object.assign(new Error(`${base}${chain}`), {
      code: 'coordinator_cleanup_incomplete', cause: caught, reconciler, record, observed, next, detail,
    });
  }

export function _startupReconcilerObservation(coordinator, recorder, caught, records, record) {
    const reported = caught?.observed;
    const own = [];
    const candidates = records.length > 0 ? records : (record === null ? [] : [record]);
    for (const identity of candidates) {
      for (const handle of coordinator._workers.values()) {
        const bound = handle.id === identity
          || handle.taskId === identity
          || handle.sessionContext?.ownerTaskId === identity;
        if (!bound) continue;
        const processRef = handle.processRef ?? null;
        const state = processRef === null
          ? 'unavailable' : processAuthorityState(processRef, handle.processAuthority);
        own.push(Object.freeze({
          record: identity, workerId: handle.id,
          pid: processRef?.pid ?? null, generation: processRef?.generation ?? null,
          state, alive: state === 'active',
        }));
      }
    }
    const report = reported && typeof reported === 'object' && !Array.isArray(reported) ? reported : null;
    if (report === null && own.length === 0) {
      return typeof caught?.code === 'string' ? Object.freeze({ code: caught.code }) : null;
    }
    const alive = (report?.alive === true || report?.state === 'active') ? report
      : own.find((row) => row.alive === true) ?? null;
    const lease = Number.isSafeInteger(report?.leaseAgeMs) ? report
      : own.find((row) => Number.isSafeInteger(row.leaseAgeMs)) ?? null;
    return Object.freeze({
      // The reconciler's own report first (it saw the failure), then this incarnation's reading and
      // the derived judgment — so `observed.alive` is the coordinator's conclusion, never a
      // contradiction of the facts beside it.
      ...(report ?? {}),
      ...(typeof caught?.code === 'string' ? { code: caught.code } : {}),
      ...(own.length === 0 ? {} : { workers: Object.freeze(own) }),
      ...(alive === null ? {} : { alive: true, pid: alive.pid ?? null }),
      ...(lease === null ? {} : { leaseAgeMs: lease.leaseAgeMs,
        leaseGraceMs: Number.isSafeInteger(lease.leaseGraceMs) ? lease.leaseGraceMs : KILL_ESCALATION_GRACE_MS }),
    });
  }

export function _trackStartupCleanup(coordinator, recorder, operation, reconciler = null) {
    const scratchCleanupPending = (error) => reconciler === 'worker_processes'
      && error?.code === 'runtime_cleanup_failed'
      && error?.observed?.alive !== true;
    const cleanupObservation = (error) => Object.freeze({
      code: error.code,
      ...(typeof error?.cause?.code === 'string' ? { causeCode: error.cause.code } : {}),
    });
    const deferScratchCleanup = (error) => {
      const record = typeof error?.record === 'string' ? error.record : null;
      recorder.recordDriver('host.cleanup_pending', {
        code: error.code, reconciler, record, observed: cleanupObservation(error),
      }, `host.cleanup_pending:${reconciler}:${record ?? 'unknown'}`);
      const background = (async () => {
        while (!coordinator._closed) {
          await new Promise((resolveDelay) => {
            const timer = coordinator._setTimeout(resolveDelay, KILL_ESCALATION_GRACE_MS);
            timer?.unref?.();
          });
          if (coordinator._closed) return;
          try {
            await operation();
            return;
          } catch (caught) {
            if (scratchCleanupPending(caught)) continue;
            if (!coordinator._startupCleanupError) {
              coordinator._startupCleanupError = coordinator._startupCleanupIncomplete(caught, reconciler);
            }
            return;
          }
        }
      })();
      coordinator._startupCleanupBackground.add(background);
      background.then(
        () => coordinator._startupCleanupBackground.delete(background),
        (caught) => {
          coordinator._startupCleanupBackground.delete(background);
          if (!coordinator._startupCleanupError) {
            coordinator._startupCleanupError = coordinator._startupCleanupIncomplete(caught, reconciler);
          }
        },
      );
    };
    let source;
    try { source = operation(); }
    catch (error) {
      if (scratchCleanupPending(error)) {
        deferScratchCleanup(error);
        return Promise.resolve();
      }
      if (!coordinator._startupCleanupError) coordinator._startupCleanupError = coordinator._startupCleanupIncomplete(error, reconciler);
      return Promise.resolve();
    }
    // The production reconcilers are deliberately synchronous: construction must finish their
    // bounded local inspection before legacy synchronous commands or close() can enter. Injected
    // reconcilers may still be genuinely asynchronous; those remain behind startupReady().
    if (!source || typeof source.then !== 'function') return Promise.resolve(source);
    coordinator._startupCleanupPending += 1;
    const tracked = Promise.resolve(source).catch((error) => {
      if (scratchCleanupPending(error)) {
        deferScratchCleanup(error);
        return;
      }
      if (!coordinator._startupCleanupError) coordinator._startupCleanupError = coordinator._startupCleanupIncomplete(error, reconciler);
    }).finally(() => { coordinator._startupCleanupPending -= 1; });
    coordinator._startupCleanupPromises.push(tracked);
    return tracked;
  }

export async function startupReady(coordinator, recorder) {
    await Promise.all(coordinator._startupCleanupPromises);
    if (coordinator._startupCleanupError) throw coordinator._startupCleanupError;
    return true;
  }

export function beginStartupRecovery(coordinator, recorder, authority) {
    if (!authority || authority !== coordinator._startupRecoveryAuthority || coordinator._startupRecoveryState !== 'idle') throw Object.assign(new Error('startup session recovery authority is unavailable'), { code: 'session_recovery_authority' });
    coordinator._startupRecoveryState = 'pending';
  }

export function startupRecoveryCandidates(coordinator, recorder, authority, maxStateRows) {
    if (authority !== coordinator._startupRecoveryAuthority || coordinator._startupRecoveryState !== 'pending') throw Object.assign(new Error('startup session recovery authority is unavailable'), { code: 'session_recovery_authority' });
    if (!Number.isSafeInteger(maxStateRows) || maxStateRows <= 0 || coordinator._workers.size > maxStateRows) throw Object.assign(new Error('startup session recovery state exceeds deployment capacity'), { code: 'session_recovery_capacity' });
    const recoveryAttempts = recorder.coordination.snapshot().recoveryAttempts ?? [];
    if (recoveryAttempts.length > maxStateRows) throw Object.assign(new Error('startup recovery attempt state exceeds deployment capacity'), { code: 'session_recovery_capacity' });
    const rows = [];
    for (const handle of coordinator._workers.values()) {
      const task = coordinator._tasks.get(handle.taskId); const adapter = coordinator._adapters[handle.vendor];
      if (handle.status !== 'orphaned' || !task || !handle.sessionContext || handle.sessionRef?.persistence !== 'native' || !adapter || !cardSupportsSession(adapter.card(), { mode: 'resume' })) continue;
      if (recorder.coordination?.taskResourceRelease?.(task.id)) continue;
      if (coordinator._recoveryDispatchRefusal(handle, task) !== null) continue;
      if (recoveryAttempts.some((attempt) => attempt.priorTask?.id === task.id
        && attempt.verifiedOwner?.workerId === handle.id
        && ['pending', 'attached', 'unknown'].includes(attempt.state))) continue;
      rows.push(handle.id);
    }
    return rows;
  }

export function _recoveryDispatchRefusal(coordinator, recorder, handle, task, opts = {}) {
    if (task && recorder.coordination?.taskResourceRelease?.(task.id)) return 'resources_released';
    if (opts.allowUnvalidatedOwner !== true
      && isPhysicalWorkspaceId(handle?.sessionContext?.ownerTaskId)
      && handle.workspaceOwnerBindingValid !== true) return 'workspace_owner_binding_unproven';
    if (opts.allowUnvalidatedOwner !== true
      && handle?.processRef?.state === 'unconfirmed_after_restart'
      && handle.workspaceOwnerProcessAuthorityValid !== true) {
      return 'workspace_owner_process_authority_unproven';
    }
    const state = handle && typeof recorder.coordination?.recoveryDispatchState === 'function'
      ? recorder.coordination.recoveryDispatchState(handle.id)
      : null;
    if (!state || !task || state.taskId !== task.id) return null;
    const durable = recorder.coordination?.task?.(task.id);
    if (state.status === 'dispatch_accepted' && durable?.status === 'completed') return null;
    if (state.status === 'dispatch_accepted') return 'dispatch_accepted';
    if (state.status === 'dispatch_refused') return 'dispatch_refused';
    return 'dispatch_unknown';
  }

export function completeStartupRecovery(coordinator, recorder, authority, failureCode = null) {
    if (authority !== coordinator._startupRecoveryAuthority || coordinator._startupRecoveryState !== 'pending') throw Object.assign(new Error('startup session recovery authority is unavailable'), { code: 'session_recovery_authority' });
    if (failureCode === null) { coordinator._startupRecoveryState = 'ready'; return; }
    const error = new Error('startup session recovery failed'); error.code = /^[a-z0-9_]{1,64}$/.test(failureCode) ? failureCode : 'session_recovery_failed'; coordinator._startupRecoveryError = error; coordinator._startupRecoveryState = 'failed';
  }

export function orphanedCapacityReservations(coordinator, recorder) {
    const snapshot = typeof coordinator._worktrees?.capacitySnapshot === 'function'
      ? coordinator._worktrees.capacitySnapshot() : null;
    if (!snapshot || !Array.isArray(snapshot.reservations)) return Object.freeze([]);
    const rows = [];
    for (const reservation of snapshot.reservations) {
      const resource = reservation?.id;
      if (typeof resource !== 'string' || !resource.startsWith('worker:')) continue;
      const ownerTaskId = resource.slice('worker:'.length);
      if (ownerTaskId.length === 0 || coordinator._capacityOwnerHeld(ownerTaskId)) continue;
      const handle = [...coordinator._workers.values()].find((candidate) => (
        coordinator._capacityWorkerGone(candidate)
        && coordinator._capacityOwnerIds(candidate, coordinator._tasks.get(candidate.taskId)).includes(ownerTaskId)));
      if (!handle) continue;
      rows.push(Object.freeze({ workerId: handle.id, taskId: handle.taskId, ownerTaskId, resource }));
    }
    return Object.freeze(rows);
  }

export function _drainReaperFor(coordinator, recorder, handle, hold, settled, verifying) {
    switch (hold) {
      case 'stopWaiter':
      case 'fatalStopWaiter': return 'stop-chain';
      case 'cleanupPromise': return 'cleanup-promise';
      case 'untrustedTransportReap': return 'transport-reap';
      case 'recoveryPending': return 'recovery';
      case 'process': return 'drain-kill';
      default: break;
    }
    if (verifying) return 'verification';
    if (settled) return 'drain-reap';
    // A worker whose process is exactly closed is released by the drain's own exact-close
    // cleanup — the attempt the convergence loop makes every pass, which keeps the wait honest
    // while it fails (G-21) — never by a kill that could signal nothing. A still-live process
    // is the drain's kill, and the spawn holds ride with it.
    const exactClose = !handle.processRef || handle.processRef.state === 'closed';
    return exactClose ? 'exact-close-cleanup' : 'drain-kill';
  }

export function _orphanCapacityWaits(coordinator, recorder, targetWorkerIds) {
    coordinator._drainWaitSince ??= new Map();
    const now = Date.now();
    const targets = new Set(targetWorkerIds);
    const byWorker = new Map();
    const extra = [];
    for (const orphan of coordinator.orphanedCapacityReservations()) {
      const key = `${orphan.workerId}\0capacity:${orphan.resource}`;
      if (!coordinator._drainWaitSince.has(key)) coordinator._drainWaitSince.set(key, now);
      const entry = coordinator._drainWaitEntry(`capacity:${orphan.resource}`, 'capacity-settlement',
        coordinator._drainWaitSince.get(key));
      if (targets.has(orphan.workerId)) {
        byWorker.set(orphan.workerId, [...(byWorker.get(orphan.workerId) ?? []), entry]);
      } else {
        extra.push({ orphan, entry });
      }
    }
    return { byWorker, extra };
  }

export function _exactPreservedRecoveryContext(coordinator, recorder, handle, opts = {}) {
    let receiptContext;
    let context;
    try {
      receiptContext = handle?.sessionContext
        ? normalizeSessionRequest({
          mode: 'resume', id: handle.sessionRef.id, context: handle.sessionContext,
        }).context
        : null;
      const rawContext = opts.context ?? receiptContext;
      context = rawContext
        ? normalizeSessionRequest({
          mode: 'resume', id: handle.sessionRef.id, context: rawContext,
        }).context
        : null;
    } catch (error) {
      return { ok: false, result: error.code ?? 'session_context_mismatch', reason: error.message };
    }
    if (!receiptContext || !context) {
      return { ok: false, result: 'session_context_required' };
    }
    if (canonicalDigest(context) !== canonicalDigest(receiptContext)) {
      return {
        ok: false, result: 'session_context_mismatch',
        reason: 'preserved recovery context does not match the receipt-bound session context',
      };
    }
    return { ok: true, context };
  }

export function _restoreRecoveredPhysicalWorkspaceAuthority(coordinator, recorder, handle, context, opts = {}) {
    const physicalOwnerId = context?.ownerTaskId;
    if (!isPhysicalWorkspaceId(physicalOwnerId)) return true;
    const binding = handle?.workspaceOwnerBinding;
    const currentProcessExact = handle?.processRef?.generation === handle?.processGeneration
      && (['initializing', 'ready'].includes(handle?.processRef?.state)
        || (handle?.processRef?.state === 'unconfirmed_after_restart'
          && handle?.recoveredProcessAuthority === true))
      && processAuthorityState(handle.processRef, handle.processAuthority) === 'active';
    const processlessPreservedAttachExact = opts.authority
      === coordinator._preservedProcesslessAttachAuthority
      && opts.processGeneration === handle?.processGeneration
      && handle?.processRef === null && handle?.processAuthority === null
      && handle?.sessionPreservation?.state === 'preserved'
      && handle.sessionPreservation.transport === 'attached'
      && handle.sessionPreservation.processGeneration === handle.processGeneration;
    const currentOwnerExact = currentProcessExact || processlessPreservedAttachExact;
    const immutableBindingExact = handle?.workspaceOwnerBindingValid === true
      && validWorkspaceOwnerBoundPayload(binding)
      && binding.physicalOwnerId === physicalOwnerId
      && binding.receiptDigest === context.ownerReceiptDigest
      && binding.branch === context.branch
      && binding.worktree === context.worktree
      && binding.baseSha === context.baseSha;
    let checkoutExact = false;
    if (currentOwnerExact && immutableBindingExact
      && typeof coordinator._worktrees?.worktreeAvailable === 'function') {
      try {
        checkoutExact = coordinator._worktrees.worktreeAvailable(binding.logicalTaskId, context) === true;
      } catch { checkoutExact = false; }
    }
    if (!currentOwnerExact || !immutableBindingExact || !checkoutExact) {
      handle.workspaceOwnerProcessAuthorityValid = false;
      handle.workspaceOwnerBindingDiagnostic = !immutableBindingExact
        ? 'workspace_owner_binding_unproven'
        : !currentOwnerExact
          ? 'workspace_owner_process_authority_unproven'
          : 'workspace_owner_checkout_invalid';
      return false;
    }
    handle.workspaceOwnerProcessAuthorityValid = true;
    if (handle.processRef?.state === 'unconfirmed_after_restart') {
      handle.processRef = { ...handle.processRef, state: 'ready', ready: true };
    }
    handle.worktree = context.worktree;
    handle.ownedWorktreeAuthority = true;
    handle.workspaceOwnerBindingDiagnostic = null;
    return true;
  }

export function recover(coordinator, recorder, workerId, opts = {}) {
    const handle = coordinator._workers.get(workerId);
    const task = handle ? coordinator._tasks.get(handle.taskId) : null;
    if (task?.brief?.goalPlan && handle?.sessionPreservation?.state !== 'preserved') {
      return Promise.resolve({ ok: false, result: 'goal_plan_continuation_not_authorized' });
    }
    if (task?.runId && recorder.coordination.run?.(task.runId)?.status === 'sealed') {
      return Promise.reject(Object.assign(new Error(`run ${task.runId} is sealed`), {
        name: 'CoordinationRefusal', code: 'run_sealed',
      }));
    }
    if (handle?.sessionPreservation?.state === 'preserved') {
      const contextAuthority = coordinator._exactPreservedRecoveryContext(handle, opts);
      if (!contextAuthority.ok) return Promise.resolve(contextAuthority);
      const preservationAuthority = coordinator._exactProcesslessPreservationAuthority(handle, task);
      if (!preservationAuthority.ok) return Promise.resolve(preservationAuthority);
    }
    const identity = canonicalDigest({
      workerId,
      taskId: task?.id ?? null,
      vendor: handle?.vendor ?? null,
      sessionRef: handle?.sessionRef ?? null,
      context: opts.context ?? handle?.sessionContext ?? null,
      model: handle?.modelResolved ?? null,
      effort: handle?.effortResolved ?? null,
      actor: opts.actor ?? 'orchestrator',
      timeoutMs: opts.timeoutMs ?? coordinator._recoveryTimeoutMs,
    });
    const existing = coordinator._recoveryAttempts.get(workerId);
    if (existing) {
      if (existing.identity === identity) return existing.promise;
      return Promise.resolve({ ok: false, result: 'recovery_conflict' });
    }
    const attempt = coordinator._withAuthorityOp(async () => {
      const handle = coordinator._workers.get(workerId);
      if (handle) handle.recoveryPending = true;
      try { return await coordinator._recover(workerId, opts); }
      finally { if (handle) handle.recoveryPending = false; }
    });
    let tracked;
    tracked = attempt.finally(() => {
      if (coordinator._recoveryAttempts.get(workerId)?.promise === tracked) coordinator._recoveryAttempts.delete(workerId);
    });
    coordinator._recoveryAttempts.set(workerId, { identity, promise: tracked });
    return tracked;
  }

export function recoverPlanBound(coordinator, recorder, workerId, rawRequest) {
    const fields = [
      'actor', 'gate', 'maxAttempts', 'profileDigest', 'recoveryPolicyDigest', 'runId', 'timeoutMs',
    ];
    const receivedFields = rawRequest && typeof rawRequest === 'object' && !Array.isArray(rawRequest)
      ? Object.keys(rawRequest).filter((field) => field !== 'schemaVersion').sort()
      : [];
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)
      || receivedFields.join(',') !== fields.sort().join(',')
      || (rawRequest.schemaVersion !== undefined && rawRequest.schemaVersion !== 1)
      || typeof rawRequest.actor !== 'string' || rawRequest.actor.length === 0
      || Buffer.byteLength(rawRequest.actor) > 256 || rawRequest.actor.includes('\0')
      || typeof rawRequest.runId !== 'string' || rawRequest.runId.length === 0
      || !Number.isSafeInteger(rawRequest.maxAttempts) || rawRequest.maxAttempts <= 0
      || rawRequest.maxAttempts > 1_000_000
      || !Number.isSafeInteger(rawRequest.timeoutMs) || rawRequest.timeoutMs <= 0
      || !/^[a-f0-9]{64}$/u.test(rawRequest.profileDigest ?? '')
      || !/^[a-f0-9]{64}$/u.test(rawRequest.recoveryPolicyDigest ?? '')
      || !rawRequest.gate || typeof rawRequest.gate !== 'object' || Array.isArray(rawRequest.gate)) {
      throw Object.assign(new TypeError('Plan recovery request is invalid'), { code: 'plan_recovery_invalid' });
    }
    const request = Object.freeze({
      actor: rawRequest.actor,
      gate: Object.freeze(JSON.parse(JSON.stringify(rawRequest.gate))),
      maxAttempts: rawRequest.maxAttempts,
      profileDigest: rawRequest.profileDigest,
      recoveryPolicyDigest: rawRequest.recoveryPolicyDigest,
      runId: rawRequest.runId,
      timeoutMs: rawRequest.timeoutMs,
    });
    const handle = coordinator._workers.get(workerId);
    const task = handle ? coordinator._tasks.get(handle.taskId) : null;
    const identity = canonicalDigest({
      workerId,
      taskId: task?.id ?? null,
      vendor: handle?.vendor ?? null,
      sessionRef: handle?.sessionRef ?? null,
      context: handle?.sessionContext ?? null,
      model: handle?.modelResolved ?? null,
      effort: handle?.effortResolved ?? null,
      request,
    });
    const existing = coordinator._recoveryAttempts.get(workerId);
    if (existing) {
      if (existing.identity === identity) return existing.promise;
      return Promise.resolve({ ok: false, result: 'recovery_conflict' });
    }
    const operation = coordinator._withAuthorityOp(async () => {
      const current = coordinator._workers.get(workerId);
      try {
        const outcome = await coordinator._recover(workerId, {
          actor: request.actor,
          timeoutMs: request.timeoutMs,
          planRecovery: { authority: coordinator._planRecoveryAuthority, request },
        });
        const recovered = coordinator._workers.get(workerId);
        const recoveryAttempt = recovered?.recoveryAttemptId
          ? recorder.coordination.recoveryAttempt(recovered.recoveryAttemptId) : null;
        if (outcome?.ok !== true) return { ...outcome, attempt: outcome?.attempt ?? recoveryAttempt?.attempt ?? null };
        const dispatch = recorder.coordination.recoveryDispatchState?.(workerId) ?? null;
        return {
          ...outcome,
          workerId,
          taskId: recovered?.taskId ?? outcome.handle?.taskId ?? null,
          attempt: outcome.attempt ?? recoveryAttempt?.attempt ?? null,
          dispatchDisposition: dispatch?.status ?? null,
          processGeneration: recovered?.processGeneration ?? null,
          route: {
            requested: {
              harness: recovered?.vendor ?? null,
              model: recovered?.modelRequested ?? null,
              effort: recovered?.effortRequested ?? null,
            },
            resolved: {
              harness: recovered?.vendor ? coordinator._harnessOf(recovered.vendor) : null,
              model: recovered?.modelResolved ?? null,
              effort: recovered?.effortResolved ?? null,
            },
            observed: {
              harness: recovered?.vendor ? coordinator._harnessOf(recovered.vendor) : null,
              model: recovered?.modelObserved ?? null,
              effort: recovered?.effortObserved ?? null,
            },
          },
          cleanup: { state: recovered?.localAuthority === true ? 'owned' : 'unavailable' },
        };
      } finally {
        if (current) current.recoveryPending = false;
      }
    });
    let tracked;
    tracked = operation.finally(() => {
      if (coordinator._recoveryAttempts.get(workerId)?.promise === tracked) coordinator._recoveryAttempts.delete(workerId);
    });
    coordinator._recoveryAttempts.set(workerId, { identity, promise: tracked });
    return tracked;
  }

export function _admitDurableRecoveryAttempt(coordinator, recorder, handle, task, session, adapter, planRecovery = null, actor = 'orchestrator') {
    for (const method of ['events', 'admitRecoveryAttempt', 'completeRecoveryAttempt', 'recoveryAttempt', 'recoveryAttemptHead']) {
      if (typeof recorder.coordination?.[method] !== 'function') {
        throw Object.assign(new Error('durable recovery-attempt authority is unavailable'), {
          name: 'CoordinationRefusal', code: 'recovery_attempt_authority_unavailable',
        });
      }
    }
    const durable = recorder.coordination.task(task.id);
    // #286 G-45: one element, one read — never `eventsView()` with no arguments (the #210 class
    // copies the whole ledger to index one event out of it).
    const terminal = durable?.terminalEvent
      ? (recorder.coordination.eventsView(durable.terminalEvent, 1)[0] ?? null) : null;
    const verificationSeq = terminal?.payload?.evidence?.coordinationSeq;
    if (!durable || durable.status !== 'completed' || !Number.isSafeInteger(verificationSeq)) {
      throw Object.assign(new Error('recovery prior task lacks exact durable verification authority'), {
        name: 'CoordinationRefusal', code: 'recovery_attempt_owner_unverified',
      });
    }
    const repoId = coordinator._repoId ?? 'baton-local';
    const maxAttempts = planRecovery?.maxAttempts ?? coordinator._recoveryMaxAttempts;
    const recoveryPolicyDigest = planRecovery?.recoveryPolicyDigest ?? canonicalDigest({
      schemaVersion: 1, mode: 'direct', maxAttempts: coordinator._recoveryMaxAttempts,
      timeoutMs: coordinator._recoveryTimeoutMs,
    });
    const authority = {
      gateDigest: planRecovery ? canonicalDigest(planRecovery.gate) : canonicalDigest({
        schemaVersion: 1, mode: 'direct', repoId, runId: durable.runId ?? null,
        priorTaskId: durable.id,
      }),
      profileDigest: planRecovery?.profileDigest ?? canonicalDigest({
        schemaVersion: 1, repoId, recoveryPolicyDigest,
      }),
      recoveryPolicyDigest,
    };
    const base = {
      repoId,
      runId: durable.runId ?? null,
      priorTask: { id: durable.id, version: durable.version, terminalEvent: durable.terminalEvent },
      verifiedOwner: { workerId: handle.id, evidence: { coordinationSeq: verificationSeq } },
      session: {
        idDigest: canonicalDigest({ nativeSessionId: session.id }),
        contextDigest: canonicalDigest(session.context),
        nextProcessGeneration: (handle.processGeneration ?? 0) + 1,
      },
      route: {
        tupleKey: durable.routeKey ?? handle.routeKey,
        adapterCardDigest: canonicalDigest(adapter.card()),
        modelPolicyDigest: canonicalDigest(durable.modelPolicy ?? handle.modelPolicy ?? null),
      },
      workerPolicy: handle.workerPolicyResolution ? {
        requestDigest: handle.workerPolicyResolution.requestDigest,
        resolutionDigest: handle.workerPolicyResolution.resolutionDigest,
        adapterCardDigest: handle.workerPolicyResolution.adapterCardDigest,
      } : null,
      authority,
    };
    const seriesId = recoveryAttemptSeriesId(base);
    const head = recorder.coordination.recoveryAttemptHead(seriesId);
    const request = createRecoveryAttemptAdmission({
      ...base,
      attempt: head ? head.attempt + 1 : 1,
      maxAttempts,
      expectedAttemptHeadEvent: head?.completedEvent ?? null,
    });
    if (coordinator._taskTopologyPolicy) {
      recorder.coordination.previewTaskTopology({
        id: request.recoveryTaskId, runId: request.runId, refines: durable.id,
        taskType: durable.taskType ?? 'general', relation: 'recovery',
      }, 'recovery');
    }
    return recorder.coordination.admitRecoveryAttempt(request, {
      actor, key: `recovery.attempt:${request.attemptId}`,
    }).attempt;
  }

export async function _recover(coordinator, recorder, workerId, opts = {}) {
    const preflightHandle = coordinator._workers.get(workerId);
    const preflightTask = preflightHandle ? coordinator._tasks.get(preflightHandle.taskId) : null;
    const preflightPlanRecovery = opts.planRecovery?.authority === coordinator._planRecoveryAuthority;
    if (preflightTask?.brief?.goalPlan
      && preflightHandle?.sessionPreservation?.state !== 'preserved'
      && !preflightPlanRecovery) {
      return { ok: false, result: 'goal_plan_continuation_not_authorized' };
    }
    if (preflightTask?.runId
      && recorder.coordination.run?.(preflightTask.runId)?.status === 'sealed') {
      throw Object.assign(new Error(`run ${preflightTask.runId} is sealed`), {
        name: 'CoordinationRefusal', code: 'run_sealed',
      });
    }
    const startup = opts.startupAuthority === coordinator._startupRecoveryAuthority && coordinator._startupRecoveryState === 'pending';
    if (!startup) coordinator.tick();
    else { if (coordinator._closed) throw Object.assign(new Error('coordinator authority is closed'), { code: 'coordinator_closed' }); if (coordinator._fatalError) throw coordinator._fatalError; }
    const handle = coordinator._getWorker(workerId);
    const task = coordinator._tasks.get(handle.taskId);
    const planRecovery = opts.planRecovery?.authority === coordinator._planRecoveryAuthority
      ? opts.planRecovery.request : null;
    if (task?.brief?.goalPlan && handle.sessionPreservation?.state !== 'preserved'
      && !planRecovery) {
      return { ok: false, result: 'goal_plan_continuation_not_authorized' };
    }
    if (task?.runId && recorder.coordination.run?.(task.runId)?.status === 'sealed') {
      throw Object.assign(new Error(`run ${task.runId} is sealed`), {
        name: 'CoordinationRefusal', code: 'run_sealed',
      });
    }
    if (handle.sessionPreservation?.state === 'preserved') {
      if (handle.status !== 'orphaned') return { ok: false, result: 'worker_not_orphaned' };
      if (!task || !handle.sessionRef || handle.sessionRef.persistence !== 'native') {
        return { ok: false, result: 'session_not_resumable' };
      }
      return coordinator._reattachPreservedSession(handle, task, opts);
    }
    const priorDispatchRefusal = coordinator._recoveryDispatchRefusal(handle, task);
    if (priorDispatchRefusal !== null) return { ok: false, result: priorDispatchRefusal };
    if (handle.status !== 'orphaned') return { ok: false, result: 'worker_not_orphaned' };
    if (!task || !handle.sessionRef || handle.sessionRef.persistence !== 'native') {
      return { ok: false, result: 'session_not_resumable' };
    }
    let planRecoveryState = null;
    if (planRecovery) {
      if (!task.brief?.goalPlan || task.runId !== planRecovery.runId || handle.runId !== planRecovery.runId) {
        return { ok: false, result: 'plan_recovery_lineage_mismatch' };
      }
      const route = {
        vendor: handle.vendor,
        model: handle.modelResolved ?? null,
        effort: handle.effortResolved ?? null,
      };
      const preview = recorder.coordination.previewPlanDispatch(planRecovery.gate, route);
      if (preview.goal.runId !== planRecovery.runId
        || !preview.node.capabilities.includes('native_session_recovery')
        || !preview.node.effects.includes('provider_call')
        || !preview.resolvedDeps.includes(task.id)) {
        return { ok: false, result: 'plan_recovery_not_authorized' };
      }
      planRecoveryState = { request: planRecovery, preview, route };
    }
    const adapter = coordinator._adapters[handle.vendor];
    if (!adapter || !cardSupportsSession(adapter.card(), { mode: 'resume' })) {
      return { ok: false, result: 'session_not_resumable' };
    }
    const recoveryWorkerPolicyRequest = planRecoveryState?.preview.brief?.workerPolicy
      ? normalizeWorkerPolicyRequest(planRecoveryState.preview.brief.workerPolicy)
      : handle.workerPolicyRequest;
    let recoveryWorkerPolicyResolution = handle.workerPolicyResolution;
    if (recoveryWorkerPolicyRequest) {
      let currentResolution;
      try {
        currentResolution = resolveWorkerPolicy(recoveryWorkerPolicyRequest, adapter.card().workerPolicy);
      } catch (error) {
        return { ok: false, result: error?.code ?? 'worker_policy_unavailable' };
      }
      if (handle.workerPolicyResolution
        && currentResolution.resolutionDigest !== handle.workerPolicyResolution.resolutionDigest) {
        return { ok: false, result: planRecoveryState
          ? 'recovery_worker_policy_transition_unsupported' : 'recovery_worker_policy_card_drift' };
      }
      if (planRecoveryState && (!handle.workerPolicyResolution
        || currentResolution.requestDigest !== handle.workerPolicyResolution.requestDigest)) {
        return { ok: false, result: 'recovery_worker_policy_transition_unsupported' };
      }
      recoveryWorkerPolicyResolution = currentResolution;
      if (planRecoveryState) planRecoveryState.workerPolicyResolution = currentResolution;
    } else if (handle.workerPolicyResolution) {
      return { ok: false, result: 'recovery_worker_policy_request_missing' };
    }
    const rawContext = opts.context ?? handle.sessionContext;
    const context = rawContext
      ? normalizeSessionRequest({ mode: 'resume', id: handle.sessionRef.id, context: rawContext }).context
      : null;
    if (!context) return { ok: false, result: 'session_context_required' };
    try {
      await coordinator._validateSessionContext(context);
    } catch (err) {
      return { ok: false, result: err.code ?? 'session_context_mismatch', reason: err.message };
    }
    const session = normalizeSessionRequest({ mode: 'resume', id: handle.sessionRef.id, context });
    const recoveryActor = opts.actor ?? 'orchestrator';
    let durableRecoveryAttempt = coordinator._admitDurableRecoveryAttempt(
      handle, task, session, adapter, planRecovery, recoveryActor,
    );
    handle.recoveryAttemptId = durableRecoveryAttempt.attemptId;
    let recoveryEffectStarted = false;
    let recoveryAttemptSettled = false;
    const settleRecoveryAttempt = (state) => {
      if (recoveryAttemptSettled) return durableRecoveryAttempt;
      durableRecoveryAttempt = coordinator._completeDurableRecoveryAttempt(
        durableRecoveryAttempt, state, recoveryActor,
      );
      recoveryAttemptSettled = true;
      return durableRecoveryAttempt;
    };
    const stopRecoveryTransport = async (reason) => {
      let stopped;
      try { stopped = await coordinator._stopRecoveryTransport(handle, reason); }
      catch (error) { settleRecoveryAttempt('unknown'); throw error; }
      const confirmed = ['confirmed', 'already_stopped', 'confirmed_unlogged', 'already_dead_unlogged'].includes(stopped?.result)
        || (stopped?.result === 'cleanup_failed' && handle.status === 'dead'
          && (!handle.processRef || handle.processRef.state === 'closed'));
      settleRecoveryAttempt(confirmed ? 'closed' : 'unknown');
      return stopped;
    };
    try {
      const providerAdmission = coordinator._admitProviderTurn(handle, task, 'recovery');
      if (!providerAdmission.ok) {
        settleRecoveryAttempt('not_started');
        return { ok: false, result: 'provider_turn_refused', reason: providerAdmission.code, attempt: durableRecoveryAttempt.attempt };
      }

      const timeoutMs = opts.timeoutMs ?? coordinator._recoveryTimeoutMs;
      const admission = { events: [] };
      admission.spawned = new Promise((resolve) => { admission.resolveSpawned = resolve; });
      handle.turnAdmission = admission;
    let recoveryRequested;
    let runtime;
    try {
      recoveryRequested = recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.recovery_requested', actor: opts.actor ?? 'orchestrator',
        payload: { sessionRef: handle.sessionRef, context },
      });
      const recoveryEvidence = recorder.mapEvent(recoveryRequested);
      recorder.recordDriver('recovery.requested', {
        taskId: task.id, workerId, sessionId: handle.sessionRef.id, context,
        runId: task.runId ?? handle.runId ?? null,
        attempt: planRecovery?.attempt ?? null,
        evidence: recoveryEvidence,
      }, `driver.recovery.requested:${task.id}:${recoveryRequested.seq}`, opts.actor ?? 'orchestrator');
      runtime = coordinator._ensureRuntimeScope(handle, context.worktree);
      handle.currentIncarnation = true;
      handle.localAuthority = true;
    } catch (error) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      const releaseError = coordinator._releaseRecoveryProviderTurn(handle, 'recovery_setup_aborted');
      const runtimeRemoved = coordinator._removeRuntimeScope(handle);
      if (runtimeRemoved) handle.localAuthority = false;
      settleRecoveryAttempt('not_started');
      throw releaseError ?? error;
    }

    let timerHandle;
    let timedOut = false;
    const timeout = new Promise((resolve) => {
      timerHandle = coordinator._setTimeout(() => { timedOut = true; resolve({ timeout: true }); }, timeoutMs);
      if (timerHandle && typeof timerHandle.unref === 'function') timerHandle.unref();
    });
    const exactRecoveredProcess = handle.processRef?.state === 'unconfirmed_after_restart'
      && handle.processRef.generation === handle.processGeneration
      && handle.recoveredProcessAuthority === true
      && processAuthorityState(handle.processRef, handle.processAuthority) === 'active';
    if (!exactRecoveredProcess) handle.processGeneration = (handle.processGeneration ?? 0) + 1;
    if (!exactRecoveredProcess && isPhysicalWorkspaceId(context.ownerTaskId)) {
      handle.workspaceOwnerProcessAuthorityValid = false;
    }
    // Policy observation is bound to one exact process generation. A recovered child must
    // re-attest; replayed testimony from the dead predecessor cannot satisfy readiness.
    handle.workerPolicyObserved = null;
    handle.workerPolicyMismatch = null;
    const recoverySpawnAbort = new AbortController();
    handle.recoverySpawnAbort = recoverySpawnAbort;
    handle.recoverySpawnPending = true;
    const attachBrief = planRecoveryState?.preview.brief ?? task.brief;
    recoveryEffectStarted = true;
    const attempt = Promise.resolve().then(() => adapter.spawn(workerId, attachBrief, {
      worktree: context.worktree,
      timeoutMs: task.brief?.budget?.wallMin ? task.brief.budget.wallMin * 60000 : undefined,
      model: handle.modelResolved ?? undefined,
      reasoningEffort: handle.effortResolved ?? undefined,
      workerPolicy: recoveryWorkerPolicyResolution ?? undefined,
      serviceTier: handle.modelPolicy?.serviceTier,
      session,
      attachOnly: true,
      signal: recoverySpawnAbort.signal,
      env: runtime?.env,
      replaceEnv: runtime?.replaceEnv === true,
      redactProviderFrame: runtime?.redactProviderFrame,
      processGeneration: handle.processGeneration,
      processReapTimeoutMs: Math.max(1, Math.floor(coordinator._stopDeadlineMs * 0.8)),
    })).then((ack) => ({ ack }), (error) => ({ error }));
    let trackedAttempt;
    trackedAttempt = attempt.finally(async () => {
      if (handle.recoverySpawnPromise !== trackedAttempt) return;
      handle.recoverySpawnPending = false;
      if (handle.recoverySpawnAbort === recoverySpawnAbort) handle.recoverySpawnAbort = null;
      if (handle.recoveryStopReason) await stopRecoveryTransport(handle.recoveryStopReason);
    }).finally(() => {
      if (handle.recoverySpawnPromise === trackedAttempt) handle.recoverySpawnPromise = null;
    });
    handle.recoverySpawnPromise = trackedAttempt;
    coordinator._bestEffort(trackedAttempt, 'recovery_attempt_observer');

    let outcome = await Promise.race([attempt, timeout]);
    if (outcome?.ack?.ok === true && !timedOut) {
      outcome = await Promise.race([
        admission.spawned.then((event) => ({ ack: outcome.ack, spawned: event })),
        timeout,
      ]);
    }
    if (timerHandle != null) coordinator._clearTimeout(timerHandle);

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
      || (handle.processRef?.state === 'unconfirmed_after_restart' && !exactRecoveredProcess)
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
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.recovery_failed', actor: 'policy', payload: { ...failed, action: 'kill_untrusted_transport' },
      });
      await stopRecoveryTransport(failed.result);
      return { ok: false, ...failed };
    }

    let activeTask;
    try {
      // Bind the durable refinement to the exact recovered request rather than the historical
      // first-turn request. No provider prompt has crossed the attach-only boundary yet.
      handle.sessionRequest = session;
      handle.sessionContext = context;
      activeTask = planRecoveryState
        ? coordinator._createCoordinationPlanRecoveryRefinement(handle, task, planRecoveryState, durableRecoveryAttempt)
        : coordinator._createCoordinationRecoveryRefinement(handle, task, durableRecoveryAttempt);
    } catch (err) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'recovery', requestedSeq: recoveryRequested.seq, reason: String(err?.message ?? err), action: 'kill_untrusted_transport' },
      });
      await stopRecoveryTransport('recovery_refinement_aborted');
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
      coordinator._handleEvent(event, handle.vendor, { admittedReady: event.kind === 'lifecycle.spawned' });
    }
    if (isPhysicalWorkspaceId(context.ownerTaskId)
      && !coordinator._restoreRecoveredPhysicalWorkspaceAuthority(handle, context)) {
      await stopRecoveryTransport('recovery_workspace_authority_unproven');
      return { ok: false, result: 'workspace_owner_process_authority_unproven' };
    }
    if (handle.modelMismatch || handle.effortMismatch || handle.workerPolicyMismatch
      || ['dead', 'exited', 'stopping'].includes(handle.status)) {
      await stopRecoveryTransport('recovery_route_mismatch');
      return { ok: false, result: 'recovery_route_mismatch' };
    }

    const adapterCardDigest = canonicalDigest(adapter.card());
    const durableActiveTask = recorder.coordination.task(activeTask.id);
    const route = {
      harness: durableActiveTask?.harnessResolved ?? handle.vendor,
      model: durableActiveTask?.modelResolved ?? handle.modelResolved ?? null,
      effort: durableActiveTask?.effortResolved ?? handle.effortResolved ?? null,
      serviceTier: durableActiveTask?.modelPolicy?.serviceTier ?? handle.modelPolicy?.serviceTier ?? null,
      routeKey: durableActiveTask?.routeKey ?? handle.routeKey ?? null,
      adapterCardDigest,
    };
    const continuation = {
      schemaVersion: 1,
      taskId: activeTask.id,
      priorTaskId: task.id,
      workerId,
      sessionId: expectedId,
      processGeneration: handle.processGeneration,
      briefDigest: canonicalDigest(activeTask.brief),
      contextDigest: canonicalDigest(context),
      routeDigest: canonicalDigest(route),
      adapterCardDigest,
    };
    let providerBrief;
    try { providerBrief = coordinator._providerBrief(activeTask.brief, workerId); }
    catch (error) {
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor),
        turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'control.refinement_aborted', actor: 'policy',
        payload: {
          relation: 'recovery', requestedSeq: recoveryRequested.seq,
          reason: typedTerminalCode(error?.code, 'context_map_attachment_invalid'),
          action: 'kill_untrusted_transport',
        },
      });
      await stopRecoveryTransport('context_materialization_aborted');
      throw error;
    }
    let continuationIntent;
    try {
      const recorded = recorder.coordination.recordRecoveryContinuationIntent(continuation, {
        actor: opts.actor ?? 'orchestrator',
        key: `driver.recovery.continuation_intent:${activeTask.id}:${handle.processGeneration}`,
      });
      continuationIntent = recorded.event;
      if (recorded.dispatch?.status !== 'dispatch_unknown' || recorded.dispatch.intentSeq !== continuationIntent?.seq) {
        throw new Error('recovery continuation intent did not materialize exactly');
      }
    } catch (err) {
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.refinement_aborted', actor: 'policy',
        payload: { relation: 'recovery', requestedSeq: recoveryRequested.seq, reason: 'continuation_intent_unavailable', action: 'kill_untrusted_transport' },
      });
      await stopRecoveryTransport('recovery_continuation_intent_aborted');
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
      ? adapter.promptBrief(workerId, providerBrief)
      : adapter.prompt(workerId, providerBrief, 'turn'))).then(
      (ack) => ({ ack }),
      (error) => ({ error }),
    );
    const promptTimeout = new Promise((resolvePromptTimeout) => {
      dispatchTimer = coordinator._setTimeout(() => resolvePromptTimeout({ timeout: true }), timeoutMs);
      if (dispatchTimer && typeof dispatchTimer.unref === 'function') dispatchTimer.unref();
    });
    const dispatchOutcome = await Promise.race([promptAttempt, promptTimeout]);
    if (dispatchTimer != null) coordinator._clearTimeout(dispatchTimer);
    if (dispatchOutcome.timeout) dispatchError = Object.assign(new Error(`recovery continuation dispatch exceeded ${timeoutMs}ms`), { code: 'dispatch_timeout' });
    else if (dispatchOutcome.error) dispatchError = dispatchOutcome.error;
    else dispatchAck = dispatchOutcome.ack;
    const stopWonDuringDispatch = () => coordinator._stopWaiters.has(handle.id)
      || ['dead', 'exited', 'stopping'].includes(handle.status)
      || handle.processRef?.state === 'closed' || handle.processRef?.state === 'unconfirmed_after_restart';
    const dispatchHasFacts = dispatchAdmission.events.length > 0;
    const provenNotSent = !dispatchError && dispatchAck?.ok === false
      && dispatchAck.notSent === true && !dispatchHasFacts && !stopWonDuringDispatch();

    if (dispatchAck?.ok !== true && !provenNotSent) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      const unknownEvent = recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.recovery_dispatch_unknown', actor: 'policy',
        ...coordinator._routeAttribution(handle, activeTask),
        payload: {
          code: dispatchError ? 'delivery_exception' : dispatchHasFacts ? 'contradictory_refusal' : 'not_sent_unproven',
          observedDispatchFacts: dispatchAdmission.events.slice(0, 16).map((event) => event.kind),
          action: 'kill_untrusted_transport',
        },
      });
      let unknownWriteError = null;
      try {
        const unknownEvidence = recorder.mapEvent(unknownEvent);
        const durable = recorder.coordination.task(activeTask.id);
        if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
          coordinator._coordTransition(activeTask, 'failed', `task.failed:${activeTask.id}:recovery_dispatch_unknown`, unknownEvidence);
          activeTask.status = 'failed';
        }
      } catch (err) {
        unknownWriteError = err;
      }
      await stopRecoveryTransport('recovery_dispatch_unknown');
      if (unknownWriteError) throw unknownWriteError;
      return {
        ok: false,
        result: 'dispatch_unknown',
        reason: String(dispatchError?.message ?? dispatchAck?.reason ?? 'recovery continuation dispatch is ambiguous'),
      };
    }

    if (provenNotSent) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      const refusedEvent = recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.recovery_dispatch_refused', actor: 'policy',
        ...coordinator._routeAttribution(handle, activeTask),
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
        const refusedEvidence = recorder.mapEvent(refusedEvent);
        const closed = recorder.coordination.completeRecoveryDispatch({
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
      await stopRecoveryTransport('recovery_dispatch_refused');
      if (refusalWriteError) throw refusalWriteError;
      return {
        ok: false,
        result: 'dispatch_refused',
        reason: String(dispatchAck?.reason ?? 'adapter proved the continuation was not sent'),
      };
    }

    let dispatchReceipt;
    try {
      const accepted = recorder.coordination.completeRecoveryDispatch({
        disposition: 'accepted', ...continuation, intentSeq: continuationIntent?.seq ?? null,
      }, {
        actor: opts.actor ?? 'orchestrator',
        key: `driver.recovery.dispatch_accepted:${activeTask.id}:${handle.processGeneration}`,
      });
      dispatchReceipt = accepted.event;
    } catch (err) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      await stopRecoveryTransport('recovery_dispatch_unknown');
      // The durable intent without an accepted/refused receipt is the replayable unknown marker.
      // Do not retry this continuation automatically.
      throw err;
    }

    const spawnedDuringDispatch = dispatchAdmission.events.some((event) => event.kind === 'lifecycle.spawned');
    if (stopWonDuringDispatch() || spawnedDuringDispatch) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      const code = spawnedDuringDispatch ? 'duplicate_provider_ready' : 'stop_won_after_dispatch';
      const racedEvent = recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'control.recovery_dispatch_not_exposed', actor: 'policy',
        ...coordinator._routeAttribution(handle, activeTask),
        payload: { code, dispatchReceiptSeq: dispatchReceipt?.seq ?? null, action: 'kill_untrusted_transport' },
      });
      try {
        const evidence = recorder.mapEvent(racedEvent);
        const durable = recorder.coordination.task(activeTask.id);
        if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
          coordinator._coordTransition(activeTask, 'failed', `task.failed:${activeTask.id}:recovery_dispatch_not_exposed`, evidence);
          activeTask.status = 'failed';
        }
      } catch (err) {
        await stopRecoveryTransport(code);
        throw err;
      }
      await stopRecoveryTransport(code);
      return { ok: false, result: spawnedDuringDispatch ? 'recovery_protocol_violation' : 'recovery_stopped_after_dispatch' };
    }

    try {
      const stamp = coordinator._fences.bumpTurn(workerId);
      handle.status = 'working';
      handle.turnTerminalObserved = false;
      coordinator._clearBudgetStop(handle);
      handle.turnAdmission = null;
      coordinator._resetWatchdogTurn(handle);
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
        kind: 'control.recovery_attached', actor: 'orchestrator',
        payload: { sessionRef: handle.sessionRef, context, dispatchReceiptSeq: dispatchReceipt?.seq ?? null },
      });
      recorder.log.append({
        worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: stamp.turnEpoch,
        kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: { recovery: true },
        ...coordinator._routeAttribution(handle, activeTask),
      });
      for (const event of dispatchAdmission.events) coordinator._handleEvent(event, handle.vendor);
      settleRecoveryAttempt('attached');
      return {
        ok: true, result: 'attached', attempt: durableRecoveryAttempt.attempt,
        handle: coordinator._publicHandle(handle, { exposeRecovery: true }),
      };
    } catch (error) {
      if (handle.turnAdmission === dispatchAdmission) handle.turnAdmission = null;
      if (handle.status === 'working') handle.status = 'stopping';
      try { await stopRecoveryTransport('recovery_exposure_unavailable'); }
      catch { /* preserve the first authoritative exposure failure */ }
      throw error;
    }
    } catch (error) {
      if (!recoveryAttemptSettled) settleRecoveryAttempt(recoveryEffectStarted ? 'unknown' : 'not_started');
      throw error;
    }
  }

export async function _reattachPreservedSession(coordinator, recorder, handle, task, opts = {}) {
    const workerId = handle.id;
    const contextAuthority = coordinator._exactPreservedRecoveryContext(handle, opts);
    if (!contextAuthority.ok) return contextAuthority;
    const { context } = contextAuthority;
    const preservationAuthority = coordinator._exactProcesslessPreservationAuthority(handle, task);
    if (!preservationAuthority.ok) return preservationAuthority;
    const adapter = coordinator._adapters[handle.vendor];
    if (task.runId && (recorder.coordination.runStop?.(task.runId)
      || recorder.coordination.run?.(task.runId)?.status === 'sealed')) {
      return { ok: false, result: 'run_stopping' };
    }
    try { await coordinator._validateSessionContext(context); }
    catch (error) {
      return { ok: false, result: error.code ?? 'session_context_mismatch', reason: error.message };
    }

    const session = normalizeSessionRequest({ mode: 'resume', id: handle.sessionRef.id, context });
    const admission = { events: [] };
    admission.spawned = new Promise((resolve) => { admission.resolveSpawned = resolve; });
    handle.turnAdmission = admission;
    const requested = recorder.log.append({
      worker: workerId, harness: coordinator._harnessOf(handle.vendor),
      turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'control.recovery_requested',
      actor: opts.actor ?? 'orchestrator', ...coordinator._routeAttribution(handle, task),
      payload: { sessionRef: handle.sessionRef, context, preservationOnly: true },
    });
    recorder.recordDriver('recovery.requested', {
      taskId: task.id, workerId, sessionId: handle.sessionRef.id, context,
      runId: task.runId ?? handle.runId ?? null, preservationOnly: true,
      evidence: recorder.mapEvent(requested),
    }, `driver.recovery.requested:${task.id}:${requested.seq}`, opts.actor ?? 'orchestrator');
    const runtime = coordinator._ensureRuntimeScope(handle, context.worktree);
    handle.currentIncarnation = true;
    handle.localAuthority = true;
    const processlessPreservedAttach = preservationAuthority.processless === true;
    if (!processlessPreservedAttach) {
      handle.processGeneration = (handle.processGeneration ?? 0) + 1;
      if (isPhysicalWorkspaceId(context.ownerTaskId)) {
        handle.workspaceOwnerProcessAuthorityValid = false;
      }
    }
    handle.workerPolicyObserved = null;
    handle.workerPolicyMismatch = null;
    const abort = new AbortController();
    handle.recoverySpawnAbort = abort;
    handle.recoverySpawnPending = true;
    const timeoutMs = opts.timeoutMs ?? coordinator._recoveryTimeoutMs;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = coordinator._setTimeout(() => resolve({ timeout: true }), timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    const spawned = Promise.resolve().then(() => adapter.spawn(workerId, task.brief, {
      worktree: context.worktree,
      timeoutMs: task.brief?.budget?.wallMin ? task.brief.budget.wallMin * 60_000 : undefined,
      model: handle.modelResolved ?? undefined,
      reasoningEffort: handle.effortResolved ?? undefined,
      workerPolicy: handle.workerPolicyResolution ?? undefined,
      serviceTier: handle.modelPolicy?.serviceTier,
      session,
      attachOnly: true,
      signal: abort.signal,
      env: runtime?.env,
      replaceEnv: runtime?.replaceEnv === true,
      redactProviderFrame: runtime?.redactProviderFrame,
      processGeneration: handle.processGeneration,
      processReapTimeoutMs: Math.max(1, Math.floor(coordinator._stopDeadlineMs * 0.8)),
    })).then((ack) => ({ ack }), (error) => ({ error }));
    let outcome = await Promise.race([spawned, timeout]);
    if (outcome?.ack?.ok === true && !outcome.timeout) {
      outcome = await Promise.race([
        admission.spawned.then((event) => ({ ...outcome, spawned: event })), timeout,
      ]);
    }
    if (timer != null) coordinator._clearTimeout(timer);
    handle.recoverySpawnPending = false;
    handle.recoverySpawnAbort = null;

    const observed = outcome?.spawned?.payload?.threadId ?? outcome?.spawned?.payload?.sessionId;
    const unexpected = admission.events.filter((event) => event.kind !== 'lifecycle.spawned');
    const failed = outcome?.timeout ? 'recovery_timeout'
      : outcome?.error ? 'recovery_exception'
        : outcome?.ack?.ok !== true ? 'recovery_refused'
          : outcome.ack.attached !== true ? 'recovery_attachment_unproven'
          : observed !== handle.sessionRef.id ? 'session_identity_mismatch'
            : admission.events.filter((event) => event.kind === 'lifecycle.spawned').length !== 1
              || unexpected.length > 0 ? 'recovery_protocol_violation'
                : handle.processRef?.state === 'closed' ? 'recovery_transport_closed' : null;
    if (failed) {
      if (handle.turnAdmission === admission) handle.turnAdmission = null;
      if (outcome?.timeout && !abort.signal.aborted) {
        abort.abort({ reason: 'preserved_session_reattachment_timeout' });
      }
      return coordinator._failPreservedReattachment(handle, task, failed);
    }

    handle.sessionRequest = session;
    handle.sessionContext = context;
    handle.turnAdmission = null;
    for (const event of admission.events) {
      coordinator._handleEvent(event, handle.vendor, { admittedReady: event.kind === 'lifecycle.spawned' });
    }
    if (isPhysicalWorkspaceId(context.ownerTaskId)
      && !coordinator._restoreRecoveredPhysicalWorkspaceAuthority(handle, context,
        processlessPreservedAttach && outcome?.ack?.attached === true ? {
          authority: coordinator._preservedProcesslessAttachAuthority,
          processGeneration: handle.processGeneration,
        } : {})) {
      return coordinator._failPreservedReattachment(
        handle, task, 'workspace_owner_process_authority_unproven',
      );
    }
    if (handle.modelMismatch || handle.effortMismatch || handle.workerPolicyMismatch
      || handle.processRef?.state === 'closed') {
      return coordinator._failPreservedReattachment(handle, task, 'recovery_route_mismatch');
    }
    const binding = coordinator._semanticControlBinding(handle, task);
    const core = {
      schemaVersion: 2, state: 'preserved', transport: 'attached', attached: true,
      reattachment: 'confirmed', ...binding,
      adapterCardDigest: canonicalDigest(preservationAuthority.card),
      turnEpoch: coordinator._safeTurnEpoch(handle), fence: coordinator._fences.current(workerId).fence,
    };
    const preservation = deepFreeze({ ...core, receiptDigest: canonicalDigest(core) });
    handle.status = 'interrupted';
    handle.sessionPreservation = preservation;
    handle.preservedTurnEpoch = preservation.turnEpoch;
    const attached = recorder.log.append({
      worker: workerId, harness: coordinator._harnessOf(handle.vendor),
      turnEpoch: coordinator._safeTurnEpoch(handle), kind: 'control.session_preservation_reattached',
      actor: 'policy', ...coordinator._routeAttribution(handle, task), payload: { preservation },
    });
    recorder.mapEvent(attached);
    return { ok: true, result: 'attached_preserved', preservation,
      handle: coordinator._publicHandle(handle, { exposeRecovery: true }) };
  }

export function resumePreservedWork(coordinator, recorder, workerId, opts) {
    return coordinator._withAuthorityOp(() => coordinator._resumePreservedWork(workerId, opts));
  }

export async function _resumePreservedWork(coordinator, recorder, workerId, opts = {}) {
    coordinator.tick();
    const refuse = (message, code) => { throw Object.assign(new Error(message), { code }); };
    const request = coordinator._normalizeResumeRequest(opts);
    const handle = coordinator._getWorker(workerId);
    const task = coordinator._tasks.get(handle.taskId);
    if (!task || task.status !== 'cancelled' || !task.checkpoint || task.checkpoint.state !== 'pinned') {
      refuse('resume requires one cancelled task with a pinned progress checkpoint', 'resume_unavailable');
    }
    if (task.runId !== request.runId || handle.runId !== request.runId) {
      refuse('resume lineage does not match the requested Run', 'resume_conflict');
    }
    if (task.checkpoint.sha !== request.checkpointSha || task.checkpoint.ref !== request.checkpointRef) {
      refuse('resume checkpoint attestation does not match the pinned progress', 'resume_checkpoint_stale');
    }
    if (!coordinator._worktrees || typeof coordinator._worktrees.resolveCheckpoint !== 'function'
      || typeof coordinator._worktrees.capture !== 'function' || typeof coordinator._worktrees.create !== 'function') {
      refuse('resume requires the full preservation worktree authority', 'resume_unavailable');
    }
    // PS5/PS6: prove the immutable checkpoint still resolves to the exact preserved commit before
    // any re-dispatch. A missing or substituted ref refuses closed and retains the preserved task.
    const resolved = await coordinator._worktrees.resolveCheckpoint(task.checkpoint.ref);
    if (resolved !== task.checkpoint.sha) {
      refuse('resume checkpoint no longer resolves to the preserved commit', 'resume_checkpoint_stale');
    }
    const route = request.route;
    // PS6: the orchestrator selects harness, model, AND effort together. Effort is never defaulted
    // to `low`: it is the explicit per-task value pinned to the approved route, and a resumed task
    // may not inherit a silent global fallback.
    if (!route.vendor || !route.model || !route.effort) {
      refuse('resume route must select harness, model, and effort together', 'resume_route_invalid');
    }
    if (!coordinator._adapters[route.vendor]) refuse('resume route harness is not registered', 'resume_route_invalid');
    const card = coordinator._adapters[route.vendor].card();
    const inventory = card?.modelSelection?.reasoningEffort;
    if (!Array.isArray(inventory) || !inventory.includes(route.effort)) {
      refuse('resume route effort is outside the harness inventory', 'resume_route_invalid');
    }
    if (route.effort === 'low' && !inventory.includes('low')) {
      refuse('resume route effort defaulted to low', 'resume_route_invalid');
    }
    if (typeof recorder.coordination?.createAndClaimPreservedResumeRefinement !== 'function') {
      refuse('coordinator coordination store cannot admit a preserved resume', 'resume_unavailable');
    }
    const attestation = {
      priorTaskId: task.id,
      checkpointSha: task.checkpoint.sha,
      checkpointRef: task.checkpoint.ref,
    };
    const planState = recorder.coordination.previewPlanDispatch(request.gate, route, attestation);
    if (!planState?.brief) refuse('resume gate does not match an approved Plan node', 'resume_unavailable');
    // The authoritative Brief carries goal/plan coordinates that only the plan-gated admission may
    // pin (CI1/plan_brief_mismatch). Strip them and let _spawn rebuild the admitted Brief, mirroring
    // the ordinary dispatch path.
    const { goalPlan: _ignoredGoalPlan, ...briefCore } = planState.brief;
    const brief = createBrief(briefCore);
    const resumed = await coordinator._spawn(route.vendor, brief, {
      taskId: request.taskId,
      runId: task.runId,
      model: route.model,
      effort: route.effort,
      goalPlan: request.gate,
      refines: task.id,
      worktreeBaseSha: task.checkpoint.sha,
      preservedResume: attestation,
      derivedResumePlanToken: coordinator._derivedResumePlanToken,
      actor: request.actor,
      principalId: request.principalId,
      sessionId: request.sessionId,
      powers: request.powers,
      idempotencyKey: request.idempotencyKey,
    });
    const resumedHandle = coordinator._workers.get(resumed.id);
    const resumedTask = coordinator._tasks.get(resumed.taskId);
    const resumedEvent = recorder.log.append({
      worker: workerId, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
      kind: 'work.resumed', actor: 'policy', ...coordinator._routeAttribution(handle, task),
      payload: {
        runId: task.runId,
        resumedWorkerId: resumed.id, resumedTaskId: resumed.taskId,
        preservedTaskId: task.id, checkpoint: task.checkpoint,
        route: {
          requested: { harness: coordinator._harnessOf(route.vendor), model: route.model, effort: route.effort },
          resolved: {
            harness: coordinator._harnessOf(resumedHandle?.vendor ?? route.vendor),
            model: resumedHandle?.modelResolved ?? route.model,
            effort: resumedHandle?.effortResolved ?? route.effort,
          },
        },
        reasonDigest: request.reasonDigest,
        ...(request.semanticActionId ? {
          semanticActionId: request.semanticActionId,
          semanticPrincipalScopeDigest: request.semanticPrincipalScopeDigest,
        } : {}),
      },
    });
    recorder.mapEvent?.(resumedEvent);
    return Object.freeze({
      ok: true,
      result: 'resumed',
      workerId: resumed.id,
      taskId: resumed.taskId,
      preservedTaskId: task.id,
      checkpoint: task.checkpoint,
      route: {
        requested: { harness: coordinator._harnessOf(route.vendor), model: route.model, effort: route.effort },
        resolved: {
          harness: coordinator._harnessOf(resumedHandle?.vendor ?? route.vendor),
          model: resumedHandle?.modelResolved ?? route.model,
          effort: resumedHandle?.effortResolved ?? route.effort,
        },
        observed: {
          harness: coordinator._harnessOf(resumedHandle?.vendor ?? route.vendor),
          model: resumedHandle?.modelObserved ?? resumedHandle?.modelResolved ?? route.model,
          effort: resumedHandle?.effortObserved ?? resumedHandle?.effortResolved ?? route.effort,
        },
      },
      cleanup: { state: resumedTask?.status === 'cancelled' ? 'unavailable' : 'owned' },
    });
  }

export function _retryProcessReap(coordinator, recorder, handle) {
    const waiter = coordinator._stopWaiters.get(handle.id);
    if (!waiter) {
      // A forced stop has already consumed its deadline. Preserve authority for a later explicit
      // operator retry instead of silently creating an endless succession of deadline windows.
      if (handle.status === 'dead' && handle.cleanupPending === true) return;
      coordinator._stopInBackground(handle, 'kill', KILL_RULES.terminalObservation);
      return;
    }
    if (waiter.finalized || coordinator._now() >= waiter.deadlineAt) return;
    if (waiter.mode !== 'kill') {
      coordinator._stopInBackground(handle, 'kill', KILL_RULES.preservationUnproven);
      return;
    }
    if (waiter.reapRetryHandle != null) return;
    const delayMs = Math.max(1, Math.min(5, waiter.deadlineAt - coordinator._now()));
    waiter.reapRetryHandle = coordinator._setTimeout(() => {
      waiter.reapRetryHandle = null;
      if (waiter.finalized || coordinator._stopWaiters.get(handle.id) !== waiter
        || coordinator._now() >= waiter.deadlineAt) return;
      const call = Promise.resolve(coordinator._adapters[handle.vendor].kill(handle.id));
      coordinator._wireAck(waiter, call, waiter.operationGeneration, 'kill');
    }, delayMs);
    if (waiter.reapRetryHandle && typeof waiter.reapRetryHandle.unref === 'function') {
      waiter.reapRetryHandle.unref();
    }
  }

export function _createCoordinationRecoveryRefinement(coordinator, recorder, handle, prior, recoveryAttempt) {
    if (!recorder.coordination) return prior;
    if (prior.brief?.goalPlan) {
      throw Object.assign(new Error('plan-bound recovery requires a separately approved plan node'), {
        name: 'CoordinationRefusal', code: 'goal_plan_continuation_not_authorized',
      });
    }
    const id = recoveryAttempt?.recoveryTaskId;
    if (typeof id !== 'string' || !/^recovery:[a-f0-9]{64}$/u.test(id)) {
      throw Object.assign(new Error('recovery refinement lacks admitted durable identity'), {
        name: 'CoordinationRefusal', code: 'recovery_attempt_invalid',
      });
    }
    const result = recorder.coordination.createAndClaimRecoveryRefinement({
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
    coordinator._tasks.set(id, next);
    coordinator._taskOrder.push(id);
    handle.taskId = id;
    handle.runId = next.runId ?? null;
    return next;
  }

export function _createCoordinationPlanRecoveryRefinement(coordinator, recorder, handle, prior, state, recoveryAttempt) {
    const { request, preview, route } = state;
    const id = recoveryAttempt?.recoveryTaskId;
    if (typeof id !== 'string' || !/^recovery:[a-f0-9]{64}$/u.test(id)) {
      throw Object.assign(new Error('Plan recovery refinement lacks admitted durable identity'), {
        name: 'CoordinationRefusal', code: 'recovery_attempt_invalid',
      });
    }
    const result = recorder.coordination.createAndClaimPlanRecoveryRefinement({
      id,
      brief: preview.brief,
      deps: preview.resolvedDeps,
      refines: prior.id,
      taskType: prior.taskType ?? 'general',
      runId: request.runId,
      reservedWorkerId: handle.id,
      vendorRequested: route.vendor,
      modelRequested: route.model,
      modelPolicy: handle.modelPolicy ?? null,
      effortRequested: route.effort,
      sessionRequest: handle.sessionRequest,
      relation: 'recovery',
    }, request.gate, route, {
      harnessRequested: route.vendor,
      harnessResolved: coordinator._harnessOf(route.vendor),
      modelRequested: route.model,
      modelResolved: handle.modelResolved ?? null,
      modelObserved: handle.modelObserved ?? null,
      effortRequested: route.effort,
      effortResolved: handle.effortResolved ?? null,
      effortObserved: handle.effortObserved ?? null,
      routeKey: handle.routeKey ?? null,
    }, {
      actor: request.actor,
      principalId: 'baton-plan-recovery',
      repoId: coordinator._repoId,
      runId: request.runId,
      key: `plan.recovery:${canonicalDigest({
        runId: request.runId,
        gate: request.gate,
        workerId: handle.id,
        attempt: recoveryAttempt.attempt,
        profileDigest: request.profileDigest,
        recoveryPolicyDigest: request.recoveryPolicyDigest,
      })}`,
    });
    const next = {
      ...prior,
      id,
      brief: preview.brief,
      deps: [...preview.resolvedDeps],
      refines: prior.id,
      relation: 'recovery',
      status: 'working',
      result: null,
      verdict: null,
      capturedSha: null,
      integration: null,
      retainedResultRef: null,
      publication: null,
      review: null,
      coordinationVersion: result.task.version,
      vendorRequested: route.vendor,
      modelRequested: route.model,
      effortRequested: route.effort,
      workerPolicyRequest: preview.brief?.workerPolicy
        ? normalizeWorkerPolicyRequest(preview.brief.workerPolicy) : null,
      workerPolicyResolution: state.workerPolicyResolution ?? null,
      sessionRequest: handle.sessionRequest,
      sessionContext: handle.sessionContext,
    };
    coordinator._tasks.set(id, next);
    coordinator._taskOrder.push(id);
    handle.taskId = id;
    handle.runId = request.runId;
    return next;
  }

export async function _preserveProgressBeforeReap(coordinator, recorder, handle, task, stopEvent, enabled = true) {
    if (handle?.contributionCapturePending) await handle.contributionCapturePending;
    if (!enabled || !handle?.worktree || !task) return Object.freeze({ state: 'not_applicable' });
    const manager = coordinator._worktrees;
    // Direct Coordinator fixtures and legacy embedders may provide only create/remove. The real
    // createDriver worktree authority always exposes the complete preservation contract.
    if (!manager || typeof manager.capture !== 'function' || typeof manager.retainCheckpoint !== 'function'
      || typeof manager.resolveCheckpoint !== 'function') return Object.freeze({ state: 'unsupported' });
    handle.cleanupPending = true;
    try {
      if (task.progressPreservation?.state === 'no_progress') return task.progressPreservation;
      if (task.checkpoint?.state === 'pinned') {
        const resolved = await manager.resolveCheckpoint(task.checkpoint.ref);
        if (resolved !== task.checkpoint.sha) throw Object.assign(new Error('existing progress checkpoint postcheck failed'), { code: 'checkpoint_failed' });
        return task.checkpoint;
      }
      // A checkout this handle shares with another live holder is preserved live through the
      // isolated-index snapshot: the paused-turn commit primitive stages the REAL index and commits
      // on the shared branch, which would corrupt a checkout its peers are using. Only a checkout
      // this handle alone works in uses the mutating capture, and resume keeps it.
      let captured;
      if (coordinator._sharedCheckoutCustody(handle, task)) {
        if (typeof manager.snapshot !== 'function') {
          throw Object.assign(new Error('shared checkout preservation is unavailable'), {
            code: 'shared_workspace_capture_unavailable',
          });
        }
        captured = await coordinator._captureTrustWorktree(handle, task, { snapshot: true });
      } else {
        // Issue #428: before the capture commits anything, the seat's lane branch must be
        // at its checkout's HEAD — a branch that is missing or behind HEAD would leave the
        // stop's snapshot commit reachable through nothing. A repair refusal retains the
        // checkout (the catch below), never guesses.
        const laneBranch = task.sessionContext?.branch ?? null;
        const ownerTaskId = task.sessionContext?.ownerTaskId ?? task.id;
        // #435: the custody repair applies to a checkout the worktree authority owns — the one
        // at <repoRoot>/.baton/wt/<ownerTaskId>. A fixture or embedder manager that keeps its
        // checkouts elsewhere has no lane branch for the authority to repair, and running the
        // repair there turned every exact-kill preservation into `preservation_failed`
        // (phase70/71/72 pins) because the authority refuses a path outside its root.
        if (laneBranch && typeof handle.worktree === 'string' && existsSync(handle.worktree)
          && coordinator._isAuthorityCheckout(handle.worktree, ownerTaskId)) {
          await Promise.resolve(ensureLaneBranchAtHead(coordinator._repoRoot, ownerTaskId, {
            worktree: handle.worktree,
          }));
        }
        captured = await manager.capture(handle.worktree ?? task.worktree, {
          vendor: handle.vendor,
          model: handle.modelObserved ?? handle.modelResolved,
          ...((handle.effortObserved ?? handle.effortResolved) ? { effort: handle.effortObserved ?? handle.effortResolved } : {}),
          ownerTaskId: task.sessionContext?.ownerTaskId ?? task.id,
          ...(task.sessionContext?.baseSha ? { expectedBaseSha: task.sessionContext.baseSha } : {}),
          ...(task.sessionContext?.branch ? { expectedBranch: task.sessionContext.branch } : {}),
          ...(task.sessionContext?.sparseCheckoutIdentity ? { workerSparseCheckoutIdentity: task.sessionContext.sparseCheckoutIdentity } : {}),
        });
      }
      const sha = captured?.sha;
      if (!/^[a-f0-9]{40,64}$/u.test(sha ?? '')) {
        throw Object.assign(new Error('progress capture did not produce an exact commit'), { code: 'capture_failed' });
      }
      if (sha === task.sessionContext?.baseSha) {
        const unchanged = recorder.log.append({
          worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'worktree.progress_unchanged', actor: 'policy', ...coordinator._routeAttribution(handle, task),
          payload: { state: 'no_progress', stopSeq: stopEvent?.seq ?? null },
        });
        recorder.mapEvent(unchanged);
        task.progressPreservation = Object.freeze({ state: 'no_progress', eventSeq: unchanged.seq });
        return task.progressPreservation;
      }
      const ref = await manager.retainCheckpoint(sha);
      const resolved = await manager.resolveCheckpoint(ref);
      if (resolved !== sha) throw Object.assign(new Error('progress checkpoint postcheck failed'), { code: 'checkpoint_failed' });
      const checkpoint = Object.freeze({ state: 'pinned', sha, ref });
      const event = recorder.log.append({
        worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
        kind: 'worktree.progress_checkpointed', actor: 'policy', ...coordinator._routeAttribution(handle, task),
        payload: {
          checkpoint, stopSeq: stopEvent?.seq ?? null, snapshotted: captured?.snapshotted === true,
          changedPaths: Array.isArray(captured?.changedPaths) ? captured.changedPaths : [],
        },
      });
      recorder.mapEvent(event);
      // Issue #428: the custody row records exactly what the removal is backed by — the
      // pinned sha and the lane branch that now names it. It rides the coordination ledger
      // (driver.recorded) so the swarm projection derives custody from it.
      // Issue #453: it also names the SNAPSHOT's own changed paths — `git diff --name-only
      // base..snapshot` through the same worktree authority every other change reading uses —
      // never the pre-snapshot working-tree list, which reads 0 for the untracked files a crash
      // leaves behind and left the row unusable for noticing a carry that carried nothing. An
      // authority that cannot answer records null (unreadable), never an empty list.
      let snapshotPaths = null;
      if (typeof coordinator._worktrees?.changedPathsAtCommit === 'function' && task.sessionContext?.baseSha) {
        try { snapshotPaths = [...coordinator._worktrees.changedPathsAtCommit(task.sessionContext.baseSha, sha)]; }
        catch { snapshotPaths = null; }
      }
      recorder.recordDriver('worktree.snapshotted', {
        workspaceId: task.sessionContext?.ownerTaskId ?? task.id, participantId: null,
        workerId: handle.id, taskId: task.id, sha, branch: task.sessionContext?.branch ?? null,
        snapshotted: captured?.snapshotted === true, stopSeq: stopEvent?.seq ?? null,
        paths: snapshotPaths,
      }, `worktree.snapshotted:${handle.id}:${event.seq}`);
      task.checkpoint = checkpoint;
      task.progressPreservation = Object.freeze({ state: 'pinned', eventSeq: event.seq });
      return checkpoint;
    } catch (error) {
      const sourceCode = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/u.test(error.code)
        ? error.code : 'progress_preservation_failed';
      // #295 comment (c): preservation failure is never silent, and never anonymous. The row names
      // the checkout that was RETAINED (the work the member produced is still on disk there) and
      // the reason the checkpoint could not be written, bounded to a readable line — the shape this
      // closes was `{stopSeq: null, action: 'retain_worktree'}` leaving 15 minutes of work
      // stranding in an unnamed directory.
      const reason = boundedAttentionText(String(error?.message ?? error?.code ?? error), 512);
      try {
        const failed = recorder.log.append({
          worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
          kind: 'worktree.progress_preservation_failed', actor: 'policy', ...coordinator._routeAttribution(handle, task),
          payload: {
            code: sourceCode, stopSeq: stopEvent?.seq ?? null, action: 'retain_worktree',
            worktreePath: handle.worktree ?? null, reason,
          },
        });
        recorder.mapEvent(failed);
      } catch { /* Retaining the worktree remains the fail-safe when evidence is unavailable. */ }
      handle.preservationFailure = Object.freeze({
        code: sourceCode, worktreePath: handle.worktree ?? null, reason,
      });
      handle.cleanupPending = true;
      handle.cleanupError = 'progress_preservation_failed';
      throw Object.assign(new Error('progress preservation failed before worktree reap', { cause: error }), { code: 'progress_preservation_failed' });
    }
  }

export function _scheduleUntrustedTransportReap(coordinator, recorder, handle, adapter, opts = {}) {
    let cleanupPromise = null;
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const runtimeRemoved = coordinator._removeRuntimeScope(handle);
        if (opts.removeWorktree === true) await coordinator._removeOwnedTaskWorktree(handle, coordinator._tasks.get(handle.taskId));
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
      const timerHandle = coordinator._setTimeout(() => { coordinator._bestEffort(cleanup(), 'stop_deadline_cleanup'); }, coordinator._stopDeadlineMs);
      if (timerHandle && typeof timerHandle.unref === 'function') timerHandle.unref();
      coordinator._bestEffort(Promise.resolve().then(() => adapter.kill(handle.id)), 'adapter_kill').finally(() => {
        coordinator._clearTimeout(timerHandle);
        coordinator._bestEffort(cleanup(), 'stop_deadline_cleanup');
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
    record.timerHandle = coordinator._setTimeout(() => {
      if (handle.untrustedTransportReap !== record) return;
      handle.processRef = handle.processRef?.generation === record.generation
        && handle.processRef?.pid === record.pid
        && ['initializing', 'ready'].includes(handle.processRef?.state)
        ? { ...handle.processRef, state: 'unconfirmed_after_restart' }
        : handle.processRef;
      try {
        recorder.log.append({
          worker: handle.id,
          harness: coordinator._harnessOf(handle.vendor),
          turnEpoch: coordinator._safeTurnEpoch(handle),
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
    }, coordinator._stopDeadlineMs);
    if (record.timerHandle && typeof record.timerHandle.unref === 'function') record.timerHandle.unref();
    coordinator._bestEffort(Promise.resolve().then(() => adapter.kill(handle.id)), 'adapter_kill');
  }

export function _releaseRecoveryProviderTurn(coordinator, recorder, handle, reason) {
    try {
      coordinator._releaseProviderTurnAdmission(handle, reason);
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

export async function _stopRecoveryTransport(coordinator, recorder, handle, reason) {
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
      || (!coordinator._ownsLocalResources(handle) && (!handle.processRef || handle.processRef.state === 'closed'))) {
      stopped = { ok: true, result: 'already_stopped' };
    } else if (coordinator._fatalError) {
      stopped = await coordinator._emergencyKillUnlogged(handle);
    } else {
      stopped = await coordinator._beginStop(handle, 'kill', undefined, 'policy', { rule: KILL_RULES.stallReap });
      if (!stopped?.ok && stopped?.result !== 'forced') {
        recorder.log.append({
          worker: handle.id, harness: coordinator._harnessOf(handle.vendor), turnEpoch: coordinator._safeTurnEpoch(handle),
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
      const releaseError = coordinator._releaseRecoveryProviderTurn(handle, reason);
      if (releaseError) throw releaseError;
    }
    return stopped;
  }

export function _finishUntrustedTransportReap(coordinator, recorder, handle, processRef) {
    const record = handle.untrustedTransportReap;
    if (!record || record.generation !== processRef.generation || record.pid !== processRef.pid
      || record.processGroupId !== processRef.processGroupId) return;
    if (record.timerHandle != null) coordinator._clearTimeout(record.timerHandle);
    handle.untrustedTransportReap = null;
    coordinator._bestEffort(record.cleanup(), 'stop_cleanup');
  }

export function _refuseStallReap(coordinator, recorder, handle, error) {
    coordinator._recordStallReapRefusal(handle, error);
    if (handle?.watchdogActions?.has('stall')) {
      coordinator._armStallCycle(handle, coordinator._tasks.get(handle.taskId), {
        nudgeId: handle.stallSeamCycle?.nudgeId ?? null,
        controlId: handle.stallSeamCycle?.controlId ?? null,
      });
    }
  }

export function _recordStallReapRefusal(coordinator, recorder, handle, error) {
    coordinator._recordOperationFailure('health.stall_reap_refused', handle, 'stall_reap_failed', error, {
      stallLifetime: handle.stallSeamCycle?.lifetime ?? null,
    });
  }

export async function reconcileProviderSource(coordinator, recorder, providerId, ctx = {}) {
    await coordinator._assertOperational();
    if (typeof providerId !== 'string' || !ctx || Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider source reconciliation request is invalid'), { code: 'provider_reconciliation_invalid' });
    const card = coordinator.advisoryFeedCards().find((row) => row.providerId === providerId); if (!coordinator._advisoryFeeds || !coordinator._repoId || !card?.modes?.includes('poll') || typeof coordinator._advisoryFeeds.pollFull !== 'function' || typeof recorder.coordination.recordProviderSourceReconciliation !== 'function') throw Object.assign(new Error('provider full poll is not deployment-configured'), { code: 'provider_poll_unavailable' });
    if (!recorder.coordination.reusePolicyState(coordinator._repoId)) throw Object.assign(new Error('provider polling requires active reuse policy'), { code: 'reuse_policy_reconciliation_required' });
    const before = recorder.coordination.providerSourceHealth(coordinator._repoId, providerId, card.cardDigest); if (!before || before.status !== 'reconciliation_required') return Object.freeze({ ok: true, result: 'not_required', health: before, receipts: [] });
    const releaseAuthority = coordinator._acquireAuthorityOp();
    try {
      const polled = await coordinator._advisoryFeeds.pollFull(providerId, { signal: ctx.signal }); const receipts = [];
      for (const receipt of polled.receipts) { if (ctx.signal?.aborted) throw Object.assign(new Error('provider poll cancelled before durable admission'), { code: 'cancelled' }); const key = `provider-delivery:${canonicalDigest({ repoId: coordinator._repoId, providerId, sourceEpoch: receipt.sourceEpoch, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest })}`; receipts.push(recorder.coordination.recordProviderDelivery({ repoId: coordinator._repoId, receipt }, { actor: `provider:${providerId}`, key })); }
      if (ctx.signal?.aborted) throw Object.assign(new Error('provider poll cancelled before recovery'), { code: 'cancelled' });
      const current = recorder.coordination.providerSourceHealth(coordinator._repoId, providerId, card.cardDigest); if (!current || current.status !== 'reconciliation_required') throw Object.assign(new Error('provider source health changed during full poll'), { code: 'provider_reconciliation_stale' });
      const result = recorder.coordination.recordProviderSourceReconciliation({ repoId: coordinator._repoId, proof: polled.proof, expectedHealthEvent: current.lastEvent }, { actor: `provider-poller:${providerId}`, key: `provider-poll:${canonicalDigest({ repoId: coordinator._repoId, providerId, sourceEpoch: card.cardDigest, proofDigest: polled.proof.proofDigest })}` });
      return Object.freeze({ ...result, receipts });
    } finally { releaseAuthority(); }
  }

export async function reconcileDueProviderProcessing(coordinator, recorder, ctx = {}) {
    await coordinator._assertOperational(); const config = coordinator._providerProcessingSchedule;
    if (!config) throw Object.assign(new Error('provider processing schedule is not deployment-configured'), { code: 'provider_attempt_unavailable' });
    if (!ctx || Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider processing scan is invalid'), { code: 'provider_processing_invalid' });
    if (coordinator._providerProcessingScanActive) throw Object.assign(new Error('provider processing scan is already active'), { code: 'provider_processing_scan_active' });
    coordinator._providerProcessingScanActive = true;
    const releaseAuthority = coordinator._acquireAuthorityOp();
    try {
      const due = recorder.coordination.dueProviderProcessing(config.repoId, new Date(coordinator._now()).toISOString()); const results = [];
      for (const processingId of due) {
        if (ctx.signal?.aborted) throw Object.assign(new Error('provider processing scan cancelled'), { code: 'cancelled' });
        const initial = recorder.coordination.providerProcessing(processingId);
        if (!initial || initial.repoId !== config.repoId || initial.status !== 'pending') { results.push(Object.freeze({ processingId, result: 'stale' })); continue; }
        try {
          const completed = await coordinator.reconcileProviderProcessing(processingId, { signal: ctx.signal });
          if (ctx.signal?.aborted) throw Object.assign(new Error('provider processing scan cancelled'), { code: 'cancelled' });
          results.push(Object.freeze({ processingId, result: completed.result }));
        } catch (error) {
          if (ctx.signal?.aborted || error?.code === 'cancelled' || error?.name === 'AbortError') throw Object.assign(new Error('provider processing scan cancelled'), { code: 'cancelled' });
          if (['coordination_writer_lost', 'coordination_write_unavailable', 'operational_log_unavailable', 'coordinator_closed', 'coordinator_draining'].includes(error?.code)) throw error;
          const current = recorder.coordination.providerProcessing(processingId);
          if (['provider_processing_stale', 'provider_deferral_conflict'].includes(error?.code)) { results.push(Object.freeze({ processingId, result: 'stale' })); continue; }
          if (!current || current.status !== 'pending' || current.version !== initial.version || current.lastReceiptEvent !== initial.lastReceiptEvent) {
            results.push(Object.freeze({ processingId, result: 'stale' })); continue;
          }
          const failureCode = providerProcessingFailureCode(error); const attempt = (current.attemptCount ?? 0) + 1;
          const key = `provider-deferral:${canonicalDigest({ actor: `provider-reconciler:${current.providerId}`, processingId, expectedProcessingVersion: current.version, expectedLastReceiptEvent: current.lastReceiptEvent, attempt })}`;
          const deferred = recorder.coordination.recordProviderProcessingDeferral({ processingId, expectedProcessingVersion: current.version, expectedLastReceiptEvent: current.lastReceiptEvent, failureCode }, { actor: `provider-reconciler:${current.providerId}`, key });
          results.push(Object.freeze({ processingId, result: deferred.result, failureCode, attempt: deferred.processing.attemptCount, nextAttemptAt: deferred.processing.nextAttemptAt }));
        }
      }
      return Object.freeze({ ok: true, result: 'scanned', dueCount: due.length, results: Object.freeze(results) });
    } finally { releaseAuthority(); coordinator._providerProcessingScanActive = false; }
  }

export async function reconcileProviderProcessing(coordinator, recorder, processingId, ctx = {}) {
    await coordinator._assertOperational(); const config = coordinator._providerReconciliation;
    if (!config) throw Object.assign(new Error('provider reconciliation is not deployment-configured'), { code: 'provider_reconciliation_unavailable' });
    if (typeof processingId !== 'string' || !ctx || Object.keys(ctx).some((key) => key !== 'signal')) throw Object.assign(new TypeError('provider reconciliation request is invalid'), { code: 'provider_processing_invalid' });
    const initial = recorder.coordination.providerProcessing(processingId); if (!initial) throw Object.assign(new Error('provider processing root was not found'), { code: 'provider_processing_not_found' });
    if (initial.repoId !== config.repoId) throw Object.assign(new Error('provider reconciliation repository mismatch'), { code: 'reuse_repo_mismatch' });
    if (initial.status !== 'pending') return Object.freeze({ ok: true, result: 'idempotent', processing: initial, event: null });
    const releaseAuthority = coordinator._acquireAuthorityOp();
    try {
      throwIfProviderCancelled(ctx.signal);
      const actor = `provider-reconciler:${initial.providerId}`; const head = recorder.coordination.reusePolicyState(config.repoId); if (!head) throw Object.assign(new Error('provider reconciliation policy is unavailable'), { code: 'reuse_policy_reconciliation_required' });
      const rawBinding = await config.indexAuthority.current({ repoId: config.repoId, signal: ctx.signal });
      throwIfProviderCancelled(ctx.signal);
      const bindingFields = ['schemaVersion', 'repoId', 'treeSha', 'indexEpoch', 'atlasCardDigest'];
      if (!rawBinding || Object.keys(rawBinding).sort().join(',') !== bindingFields.sort().join(',') || rawBinding.schemaVersion !== 1 || rawBinding.repoId !== config.repoId || rawBinding.atlasCardDigest !== config.card.atlasCardDigest
        || !/^[a-f0-9]{4,128}$/.test(rawBinding.treeSha ?? '') || !/^[a-f0-9]{64}$/.test(rawBinding.indexEpoch ?? '')) throw Object.assign(new Error('provider index binding is invalid'), { code: 'provider_index_changed' });
      const indexBinding = Object.freeze({ ...rawBinding, bindingDigest: canonicalDigest(rawBinding) }); const policy = Object.freeze({ hash: head.policyHash, version: head.version, constraintId: head.constraintId });
      const requestDigest = canonicalDigest({ actor, processingId, expectedProcessingVersion: initial.version, repoId: initial.repoId, providerId: initial.providerId, sourceEpoch: initial.sourceEpoch, policy, indexBindingDigest: indexBinding.bindingDigest, trigger: 'official_provider_refresh' });
      const key = `provider-processing:${requestDigest}`; const admitted = recorder.coordination.providerProcessingAdmission(key, requestDigest); if (admitted) return admitted;
      const candidates = [];
      for (const coordinate of initial.coordinates) {
        const args = { indexEpoch: indexBinding.indexEpoch, ecosystem: coordinate.ecosystem, package: coordinate.package, version: coordinate.version, refresh: true }; const verifyCtx = { budgetTokens: config.budgetTokens, actor, signal: ctx.signal };
        const claim = await coordinator._capabilityRegistry().invoke('cartographer-quartermaster', 'reuse.vet', args, verifyCtx); const dossierRef = decisionRef(claim?.refs?.[0], 'dependency-dossier', 'application/vnd.baton.dependency-dossier+json');
        throwIfProviderCancelled(ctx.signal);
        const check = await coordinator._capabilityRegistry().reverify('cartographer-quartermaster', 'reuse.vet', claim, args, verifyCtx); const snapshot = check.status === 'ok' ? check.payload?.[0]?.snapshot : null; const dossier = claim.payload?.[0];
        throwIfProviderCancelled(ctx.signal);
        if (!snapshot || !dossier || dossier.factDigest !== snapshot.factDigest || !officialCoordinateMatches(snapshot.identity, coordinate) || !Array.isArray(dossier.advisoryIds) || !Array.isArray(dossier.advisories)) throw Object.assign(new Error('provider official refresh diverged'), { code: 'reuse_evidence_diverged' });
        const advisoryIds = [...new Set(dossier.advisoryIds)].sort(); const maliciousAdvisoryIds = [...new Set(dossier.advisories.filter((item) => item?.malicious === true).map((item) => item.id))].sort(); candidates.push({ coordinate, dossierRef, snapshot, advisoryIds, maliciousAdvisoryIds, claim });
      }
      const currentBinding = await config.indexAuthority.current({ repoId: config.repoId, signal: ctx.signal }); throwIfProviderCancelled(ctx.signal); const bindingCheck = await config.indexAuthority.reverify(rawBinding, { signal: ctx.signal }); throwIfProviderCancelled(ctx.signal); const currentHead = recorder.coordination.reusePolicyState(config.repoId);
      if (canonicalDigest(currentBinding) !== canonicalDigest(rawBinding) || bindingCheck?.ok !== true) throw Object.assign(new Error('provider index changed during refresh'), { code: 'provider_index_changed' });
      if (!currentHead || currentHead.policyHash !== policy.hash || currentHead.version !== policy.version || currentHead.constraintId !== policy.constraintId) throw Object.assign(new Error('provider policy changed during refresh'), { code: 'reuse_policy_reconciliation_required' });
      const observations = [];
      for (const row of candidates) {
        throwIfProviderCancelled(ctx.signal);
        const projection = { processingId, coordinate: row.coordinate, dossierDigest: row.dossierRef.digest, factDigest: row.snapshot.factDigest, policyHash: policy.hash, indexBindingDigest: indexBinding.bindingDigest, recommendation: row.snapshot.recommendation, asOf: row.snapshot.asOf, expiresAt: row.snapshot.expiresAt, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds }; const officialDigest = canonicalDigest(projection);
        const verifiedEvent = recorder.log.append({ worker: 'hub-capability', harness: 'baton', turnEpoch: 0, actor, kind: 'knowledge.reuse_provider_reverified', payload: { ...projection, officialDigest } }); const reverifyEvidence = recorder.mapEvent(verifiedEvent);
        observations.push({ coordinate: row.coordinate, dossierRef: row.dossierRef, snapshot: row.snapshot, advisoryIds: row.advisoryIds, maliciousAdvisoryIds: row.maliciousAdvisoryIds, reverifyEvidence, officialDigest });
      }
      const fields = { requestDigest, processingId, expectedProcessingVersion: initial.version, repoId: initial.repoId, providerId: initial.providerId, sourceEpoch: initial.sourceEpoch, receiptIds: initial.receiptIds, policy, indexBinding, observations };
      throwIfProviderCancelled(ctx.signal);
      const result = candidates.some((row) => row.snapshot.recommendation !== 'borrow_candidate')
        ? recorder.coordination.recordProviderAdverseCompletion(fields, { actor, key })
        : recorder.coordination.recordProviderGreenCompletion(fields, { actor, key });
      return Object.freeze({ ...result, dossiers: candidates.map((row) => row.claim) });
    } finally { releaseAuthority(); }
  }

export async function reapRunScratchpads(coordinator, recorder, runId) {
    coordinator.tick();
    const deadline = Date.now() + coordinator._drainPolicy.timeoutMs;
    const describe = (receipt) => ({
      code: 'coordinator_scratchpad_reap_incomplete',
      detail: { runId, remainingPartitions: receipt?.remainingPartitions ?? null, remainingEntries: receipt?.remainingEntries ?? null },
    });
    let receipt = recorder.coordination.reapRunScratchpads(runId);
    let previousProgress = null;
    while (receipt.result === 'partial') {
      const progress = `${receipt.remainingPartitions}:${receipt.remainingEntries}`;
      if (progress === previousProgress) {
        throw Object.assign(new Error('run scratchpad reap stopped advancing between passes'), describe(receipt));
      }
      previousProgress = progress;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('run scratchpad reap did not converge before its deadline'), describe(receipt));
      }
      await coordinator._sleep(0);
      receipt = recorder.coordination.reapRunScratchpads(runId);
    }
    return receipt;
  }

export function resumeOrphans(coordinator, recorder, { liveWorkers = [] } = {}) {
    coordinator._assertReadable();
    if (!recorder.coordination || typeof recorder.coordination.orphans !== 'function') return [];
    return recorder.coordination.orphans({ liveWorkers }).map((row) => {
      const cert = coordinator._lastDeathCertEvidence(row);
      return {
        taskId: row.taskId,
        workerId: row.workerId,
        sessionId: cert.sessionId,
        sessionDir: cert.sessionFile ? dirname(cert.sessionFile) : null,
        retry: cert.retry,
      };
    });
  }

export function* _replay(coordinator, recorder) {
    const chunk = FRAME_LIMITS['view.wake_replay.items'].value;
    let sinceYield = 0;
    const workerIds = recorder.log.workers();
    for (const workerId of workerIds) coordinator._replayedIds.workers.add(workerId);
    const durableTasksByWorker = new Map();
    for (const task of coordinator._startupCoordinationSnapshot?.tasks
      ?? recorder.coordination.snapshot().tasks) {
      const worker = task.reservedWorkerId ?? task.assignee;
      if (!worker) continue;
      const rows = durableTasksByWorker.get(worker) ?? [];
      rows.push(task);
      durableTasksByWorker.set(worker, rows);
    }
    for (const rows of durableTasksByWorker.values()) {
      rows.sort((left, right) => left.createdEvent - right.createdEvent);
    }
    yield;
    // F1: pending interaction records (question/approval/decision) are reconstructed purely
    // from the durable log, keyed by requestId (globally unique by construction). A blocking
    // question/approval/decision asked before a restart must remain answerable after it —
    // `respond()` must never return not_found for a record whose ask event is durable.
    const reconstructedPending = new Map();
    // Issue #31 Part B rule 4: pause records are reconstructed from the same durable per-worker
    // log, exactly like `reconstructedPending`. A `turn.paused` with no later `turn.settled` (and
    // no later `lifecycle.turn_started` proving the turn moved on) is still open.
    const reconstructedPaused = new Map();
    for (const workerId of workerIds) {
      const events = recorder.log.read(workerId);
      if (events.length === 0) continue;

      let taskId = null;
      let brief = null;
      let maxTurnEpoch = 1;
      let terminalStatus = 'working';
      // Issue #31: the live pause id is keyed off the TURN_COMPLETED event's seq (the pause is
      // minted immediately after it), so replay must key off the same seq to reconstruct the
      // identical `pause:${taskId}:${seq}` — not off the `turn.paused` entry's own seq.
      let lastTurnCompletedSeq = null;
      let verdict = null;
      let verificationStability = null;
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
      let workerPolicyRequest = null;
      let workerPolicyResolution = null;
      let workerPolicyObserved = null;
      let workerPolicyMismatch = null;
      let sessionRequest = Object.freeze({ mode: 'new' });
      let sessionRef = null;
      let processGeneration = 0;
      let processRef = null;
      let processAuthority = null;
      let sessionContext = null;
      let workspaceOwnerBinding = null;
      let lineage = null;
      let capturedSha = null;
      let integration = null;
      let retainedResultRef = null;
      let checkpoint = null;
      let progressPreservation = null;
      let publication = null;
      let review = null;
      let runId = null;
      const budgetUsed = { tokens: 0, usd: 0 };
      let budgetHardExceeded = false;
      let terminalCause = null;
      const budgetThresholdsFired = new Set();
      const usageCumulative = new Map();
      let providerGovernance = null;
      let providerPolicyDigest = null;
      let providerTurn = null;
      let providerPolicyHardExceeded = false;
      let providerTelemetryFailed = false;
      let providerTerminalSeal = null;
      let replayPreservation = null;
      let preservedTurnEpoch = null;

      for (const e of events) {
        // Issue #351 lane 4: the fold bound — a yield at the registry row, counted before any
        // `continue` so every folded event advances it.
        if ((sinceYield += 1) >= chunk) { sinceYield = 0; yield; }
        runId = e.runId ?? runId;
        if (typeof e.turnEpoch === 'number' && e.turnEpoch > maxTurnEpoch) maxTurnEpoch = e.turnEpoch;
        if (typeof e.payload?.requestId === 'string') coordinator._replayedIds.requests.add(e.payload.requestId);
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
        if (e.kind === 'worker_policy.mismatch' && e.actor === 'policy') {
          workerPolicyMismatch = e.payload ?? workerPolicyMismatch;
          terminalCause ??= deepFreeze({ kind: 'policy_failure', code: 'worker_policy_mismatch' });
        }
        switch (e.kind) {
          case 'lifecycle.process_started':
            if (validProcessStartedPayload(e.payload) && e.payload.generation > processGeneration) {
              processGeneration = e.payload.generation;
              processRef = { generation: e.payload.generation, pid: e.payload.pid, processGroupId: e.payload.processGroupId, state: 'initializing', ready: false, startedSeq: e.seq, closedSeq: null };
              processAuthority = null;
            }
            break;
          case 'lifecycle.process_authority':
            if (e.actor === 'policy' && validProcessAuthorityPayload(e.payload)
              && ['initializing', 'ready'].includes(processRef?.state)
              && e.payload.generation === processRef.generation
              && e.payload.pid === processRef.pid
              && e.payload.processGroupId === processRef.processGroupId) {
              processAuthority = { ...e.payload };
            }
            break;
          case 'lifecycle.process_closed':
            if (validProcessClosedPayload(e.payload) && processRef && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(processRef.state)
              && e.payload.generation === processRef.generation && e.payload.pid === processRef.pid
              && e.payload.processGroupId === processRef.processGroupId
              && e.payload.ready === processRef.ready) {
              processRef = { ...processRef, state: 'closed', ready: e.payload.ready, closedSeq: e.seq };
              if (terminalStatus === 'interrupted') {
                terminalStatus = 'failed';
                replayPreservation = null;
                preservedTurnEpoch = null;
                terminalCause ??= deepFreeze({
                  kind: 'provider_failure', code: 'transport_closed_after_preservation',
                });
              }
            }
            break;
          case 'control.recovery_process_absent':
            if (e.actor === 'policy' && validRecoveryProcessAbsentPayload(e.payload)
              && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(processRef?.state)
              && e.payload.generation === processRef.generation
              && e.payload.pid === processRef.pid
              && e.payload.processGroupId === processRef.processGroupId) {
              processRef = { ...processRef, state: 'closed', closedSeq: e.seq };
            }
            break;
          case 'control.recovery_process_reaped':
            if (e.actor === 'policy' && validRecoveryProcessReapedPayload(e.payload)
              && validProcessAuthorityPayload(processAuthority)
              && ['initializing', 'ready', 'unconfirmed_after_restart'].includes(processRef?.state)
              && e.payload.generation === processRef.generation
              && e.payload.pid === processRef.pid
              && e.payload.processGroupId === processRef.processGroupId
              && e.payload.pidStart === processAuthority.pidStart) {
              processRef = { ...processRef, state: 'closed', closedSeq: e.seq };
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
            if (e.actor === 'orchestrator' && e.payload?.workerPolicyRequest) {
              workerPolicyRequest = normalizeWorkerPolicyRequest(e.payload.workerPolicyRequest);
            }
            if (e.actor === 'orchestrator' && e.payload?.workerPolicyResolution) {
              workerPolicyResolution = normalizeWorkerPolicyResolution(e.payload.workerPolicyResolution);
            }
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
                  persistence: coordinator._adapters[vendorResolved]?.card()?.sessions?.resume === 'native' ? 'native' : 'process',
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
          case 'worker_policy.observed':
            if (e.actor === 'worker' && processRef
              && ['initializing', 'ready'].includes(processRef.state)
              && e.payload?.processGeneration === processRef.generation
              && e.payload?.pid === processRef.pid
              && e.payload?.processGroupId === processRef.processGroupId) {
              try {
                const observed = normalizeWorkerPolicyObservation(e.payload?.workerPolicyObserved);
                if (workerPolicyResolution
                  && compareWorkerPolicyObservation(workerPolicyResolution, observed).length === 0) {
                  workerPolicyObserved = observed;
                }
              } catch { /* the live trust boundary already refused malformed observations */ }
            }
            break;
          case 'worktree.ready':
            sessionContext = e.payload ?? sessionContext;
            break;
          case 'worktree.owner_bound':
            if (e.actor === 'policy' && validWorkspaceOwnerBoundPayload(e.payload)) {
              workspaceOwnerBinding = Object.freeze({ ...e.payload });
            }
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
            const nextBudgetTokens = providerGovernance ? addSafeTokenCounts(budgetUsed.tokens, replayTokens) : budgetUsed.tokens + replayTokens;
            const nextBudgetUsd = providerGovernance ? addUsd(budgetUsed.usd, replayUsd) : budgetUsed.usd + replayUsd;
            const nextTurnTokens = providerGovernance && providerTurn
              ? addSafeTokenCounts(providerTurn.usage.tokens, replayTokens)
              : providerTurn ? providerTurn.usage.tokens + replayTokens : null;
            const nextTurnUsd = providerTurn
              ? (providerGovernance ? addUsd(providerTurn.usage.usd, replayUsd) : providerTurn.usage.usd + replayUsd)
              : null;
            if (nextBudgetTokens === null || nextBudgetUsd === null
              || (providerTurn && (nextTurnTokens === null || nextTurnUsd === null))) {
              providerTelemetryFailed = true;
              providerPolicyHardExceeded = true;
              if (providerTurn) providerTurn.violation ??= 'usage_value_invalid';
              break;
            }
            budgetUsed.tokens = nextBudgetTokens;
            budgetUsed.usd = nextBudgetUsd;
            if (providerTurn) {
              providerTurn.usage = { tokens: nextTurnTokens, usd: nextTurnUsd };
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
                ?? Object.keys(coordinator._adapters).find((vendor) => coordinator._harnessOf(vendor) === e.harnessResolved)
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
              if (coordinator._providerGovernance && e.payload?.policyDigest === coordinator._providerGovernance.digest) {
              const admittedRoute = providerGovernanceRoute(
                coordinator._providerGovernance,
                eventVendor,
                eventModel,
                eventEffort,
              );
              if (admittedRoute && admittedRoute.digest === e.payload?.routeDigest
                && admittedRoute.mode === e.payload?.mode
                && canonicalDigest(admittedRoute.terminalReserve) === canonicalDigest(e.payload?.reserve)) {
                providerGovernance = admittedRoute;
                providerPolicyDigest = coordinator._providerGovernance.digest;
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
            if (e.payload?.hardStop === true) {
              budgetHardExceeded = true;
              const dimensions = e.payload?.dimensions ?? {};
              const dimension = Number(dimensions.tokens ?? 0) >= Number(dimensions.usd ?? 0) ? 'tokens' : 'usd';
              terminalCause ??= deepFreeze({
                kind: 'budget_exceeded', code: 'budget_hard_limit_exceeded', dimension,
                used: Number(e.payload?.used?.[dimension] ?? 0),
                limit: Number(e.payload?.limits?.[dimension] ?? 0),
                ratio: Number(dimensions[dimension] ?? e.payload?.ratio ?? 0),
              });
            }
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
          case 'control.session_preservation_reattached':
            if (e.actor === 'policy' && e.payload?.preservation?.state === 'preserved') {
              replayPreservation = e.payload.preservation;
              preservedTurnEpoch = e.payload.preservation.turnEpoch;
              processGeneration = Math.max(processGeneration,
                e.payload.preservation.processGeneration ?? 0);
              terminalStatus = 'interrupted';
            }
            break;
          case 'lifecycle.turn_started': {
            if (preservedTurnEpoch !== null) {
              const exactSuccessor = e.actor === 'orchestrator'
                && e.payload?.preservedSession === true
                && Number.isSafeInteger(e.turnEpoch)
                && e.turnEpoch > preservedTurnEpoch;
              if (!exactSuccessor) break;
              preservedTurnEpoch = null;
              replayPreservation = null;
            }
            // Issue #31 Part B rule 4: a later turn start proves any pause from the prior turn
            // moved on, so it is no longer an open record.
            for (const [pauseId, record] of reconstructedPaused) {
              if (record.worker === workerId) reconstructedPaused.delete(pauseId);
            }
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'working';
            break;
          }
          case 'lifecycle.turn_completed':
            lastTurnCompletedSeq = e.seq ?? lastTurnCompletedSeq;
            if (preservedTurnEpoch !== null) break;
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) {
              lastResult = e.payload;
              providerTerminalSeal = e.payload?.usageSeal ?? providerTerminalSeal;
              if (providerTurn && providerTerminalSeal) providerTurn.sealed = true;
              if (e.payload?.status === 'completed') terminalStatus = 'verifying';
              else {
                terminalStatus = 'failed';
                terminalCause ??= deepFreeze({
                  kind: 'provider_failure',
                  code: typedTerminalCode(e.payload?.failure?.code ?? e.payload?.code, 'provider_turn_failed'),
                });
              }
            }
            break;
          case 'verify.reverified':
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) {
              verdict = e.payload?.verdict ?? null;
              terminalStatus = e.payload?.accept ? 'completed' : 'failed';
              capturedSha = e.payload?.capture?.sha ?? capturedSha;
              retainedResultRef = e.payload?.capture?.retainedResultRef ?? retainedResultRef;
              checkpoint = e.payload?.capture?.checkpoint ?? checkpoint;
            } else if (e.actor === 'policy' && e.payload?.retry) {
              // VR6/VR8: a policy-authored retry attempt legitimately follows the terminal
              // inconclusive attempt. It refreshes the verdict/result identity, but durable
              // coordination status (set by the retry completion transaction) stays authoritative;
              // a worker event can still never reopen a terminal task (SC13/SC14).
              verdict = e.payload?.verdict ?? verdict;
              capturedSha = e.payload?.capture?.sha ?? capturedSha;
              retainedResultRef = e.payload?.capture?.retainedResultRef ?? retainedResultRef;
              checkpoint = e.payload?.capture?.checkpoint ?? checkpoint;
            }
            verificationStability = e.payload?.stability ?? verificationStability;
            break;
          case 'worktree.progress_checkpointed':
            if (e.actor === 'policy' && e.payload?.checkpoint?.state === 'pinned') {
              checkpoint = e.payload.checkpoint;
              progressPreservation = Object.freeze({ state: 'pinned', eventSeq: e.seq });
            }
            break;
          case 'worktree.progress_unchanged':
            if (e.actor === 'policy' && e.payload?.state === 'no_progress') {
              progressPreservation = Object.freeze({ state: 'no_progress', eventSeq: e.seq });
            }
            break;
          case 'integration.completed':
            if (recorder.coordination?.integrationAuthority(taskId, e)) {
              integration = e.payload ?? integration;
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
            if (recorder.coordination?.publicationAuthority(taskId, e)) publication = e.payload ?? publication;
            break;
          case 'lifecycle.crashed':
            if (preservedTurnEpoch !== null) break;
            providerTerminalSeal = e.payload?.usageSeal ?? providerTerminalSeal;
            if (providerTurn && providerTerminalSeal) providerTurn.sealed = true;
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'failed';
            // The recovered cause carries the SAME detail the live path does: the durable cert
            // names the route and the reset instant, so a death read back after a restart is not
            // less legible than the one read live.
            const recoveredFault = coordinator._providerFaultOf(e.payload);
            terminalCause ??= deepFreeze({
              kind: 'provider_failure',
              code: recoveredFault?.code ?? typedTerminalCode(e.payload?.code, 'provider_crashed'),
              ...(recoveredFault?.detail ? { detail: recoveredFault.detail } : {}),
            });
            break;
          case 'error':
            if (e.actor === 'policy' && e.payload?.phase === 'trust_gate'
              && e.payload?.code === 'required_effect_absent') {
              terminalStatus = 'failed';
              lastResult = null;
              verdict = null;
              terminalCause ??= deepFreeze({ kind: 'policy_failure', code: 'required_effect_absent' });
            }
            break;
          case 'control.forced_stop':
          case 'control.recovery_terminalized':
            if (e.kind === 'control.recovery_terminalized') recoveryTerminalized = true;
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
            if (e.kind === 'control.interrupt_confirmed'
              && e.payload?.preservation?.state === 'preserved') {
              replayPreservation = e.payload.preservation;
              preservedTurnEpoch = e.payload.preservation.turnEpoch;
              processGeneration = Math.max(processGeneration,
                e.payload.preservation.processGeneration ?? 0);
              terminalStatus = 'interrupted';
            } else {
              replayPreservation = null;
              preservedTurnEpoch = null;
              if (!TERMINAL_TASK_STATUSES.has(terminalStatus)) terminalStatus = 'cancelled';
            }
            break;
          // Issue #31 Part B rule 4. Deliberately does NOT touch `terminalStatus`: per P1-3 the
          // pause decision is downstream of the provider's own completed result, so replay keeps
          // computing 'verifying' from the turn_completed case and CI6 durably fails the task —
          // fail-closed parity with an unresolved `input_required` task, whose restart behavior
          // is identical today. No live session survives a restart to honor a pause.
          case 'turn.paused': {
            const pausedTaskId = e.payload?.taskId ?? taskId;
            if (pausedTaskId && lastTurnCompletedSeq !== null) {
              reconstructedPaused.set(`pause:${pausedTaskId}:${lastTurnCompletedSeq}`, {
                state: 'pending', resolution: null, consumer: null, worker: workerId,
                taskId: pausedTaskId, turnEpoch: e.payload?.turnEpoch ?? maxTurnEpoch,
                changedPathsDigest: e.payload?.changedPathsDigest ?? null,
                mintedEvent: lastTurnCompletedSeq,
                // Bidirectional v2: origin is durable on the event payload; pre-v2 events omit it.
                origin: e.payload?.origin ?? null,
              });
            }
            break;
          }
          // A settle (or a later turn start — see the turn_started case) proves the pause was
          // consumed and the turn moved on; the record is no longer open.
          case 'turn.settled': {
            for (const [pauseId, record] of reconstructedPaused) {
              if (record.worker === workerId) reconstructedPaused.delete(pauseId);
            }
            break;
          }
          // NOTE: this label deliberately falls through to approval/decision below — do not
          // insert a case between them.
          case 'question.asked':
          case 'approval.requested':
          case 'decision.requested': {
            if (!TERMINAL_TASK_STATUSES.has(terminalStatus) && e.payload?.blocking !== false) terminalStatus = 'input_required';
            // F1: track the durable ask as a reconstruction candidate. A later resolve/
            // supersede/expire/stale event for this requestId (below) clears it back out.
            const requestId = e.payload?.requestId;
            if (requestId) {
              const interactionKind = e.kind === 'question.asked' ? 'question' : e.kind === 'approval.requested' ? 'approval' : 'decision';
              reconstructedPending.set(requestId, {
                kind: interactionKind,
                worker: workerId,
                state: 'pending',
                resolution: null,
                consumer: null,
                // The live path stamps turnEpochAtAsk from the FENCE's current value
                // (_safeTurnEpoch), not the observed event's own claimed turnEpoch field — the
                // fence is authoritative, an adapter's self-reported turnEpoch is not. `maxTurnEpoch`
                // (already updated above for every event, including this one) is exactly that
                // fence value reconstructed incrementally: it can only be reached by the same
                // monotonic bumpTurn sequence the live fence itself followed.
                turnEpochAtAsk: maxTurnEpoch,
                // Deadlines are reconstructed relative to REPLAY time (this._now()), not the
                // durable event's own log timestamp — the log's wall-clock `ts` and the
                // coordinator's injected clock are two independently configurable sources (a
                // fake test clock never redefines Log.clock) and must never be mixed to derive
                // an authoritative wall-time comparison.
                deadlineAt: interactionKind === 'approval' ? (coordinator._now() + coordinator._approvalTimeoutMs)
                  : interactionKind === 'decision' ? (coordinator._now() + (e.payload?.request?.deadlineMs ?? 0)) : null,
                ...(interactionKind === 'decision' ? {
                  options: e.payload.request.options,
                  allowFreeResponse: e.payload.request.allowFreeResponse,
                  question: e.payload.request.question,
                  recommended: e.payload.request.recommended,
                } : {}),
              });
            }
            coordinator._bumpInteractionGeneration(taskId);
            break;
          }
          case 'question.answered':
          case 'approval.resolved':
          case 'decision.settled':
            if (terminalStatus === 'input_required') terminalStatus = 'working';
            if (e.payload?.requestId) reconstructedPending.delete(e.payload.requestId);
            coordinator._bumpInteractionGeneration(taskId);
            if (e.kind === 'decision.settled') coordinator._bumpDecisionSettleCount(runId);
            break;
          case 'decision.expired':
            if (terminalStatus === 'input_required') terminalStatus = 'working';
            if (e.payload?.requestId) reconstructedPending.delete(e.payload.requestId);
            break;
          case 'control.stale_rejected':
            // A stale-discarded respond() consumed the record (F2) without a question.answered/
            // approval.resolved/decision.settled event; it must not be reconstructed as pending.
            if (e.payload?.op === 'respond' && e.payload?.requestId) reconstructedPending.delete(e.payload.requestId);
            break;
          case 'control.drain_interaction_cancelled':
            if (e.payload?.requestId) reconstructedPending.delete(e.payload.requestId);
            break;
          case 'control.interaction_superseded':
            // Semantic interrupt preparation durably consumes the blocked interaction before
            // admitting its v2 control target. If the controller crashes in that gap, replay
            // must never resurrect the prompt or silently redeliver it. The generic unattached
            // nonterminal rule below then fails the task safe unless the preserved-interrupt
            // receipt was subsequently closed.
            if ((e.payload?.disposition === 'semantic_interrupt'
              || (e.payload?.disposition === 'native_cancelled' && e.payload?.unblocked === true))
              && terminalStatus === 'input_required') terminalStatus = 'working';
            if (e.payload?.disposition === 'native_cancelled') coordinator._bumpInteractionGeneration(taskId);
            if (e.payload?.requestId) reconstructedPending.delete(e.payload.requestId);
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
      const durableWorkerTasks = durableTasksByWorker.get(workerId) ?? [];
      const currentDurableTask = durableWorkerTasks.at(-1) ?? null;
      if (currentDurableTask) taskId = currentDurableTask.id;
      const revisionRecoveryUnknown = currentDurableTask?.relation === 'revision'
        && currentDurableTask.brief?.revisionContext;

      // Operational completion without its authoritative coordination terminal batch is a crash
      // gap, never permission to infer success from telemetry. Fail the claimed task durably so a
      // restart cannot leave it working forever or fabricate its missing accepted manifests.
      if (!revisionRecoveryUnknown && currentDurableTask
        && !TERMINAL_TASK_STATUSES.has(currentDurableTask.status)
        && TERMINAL_TASK_STATUSES.has(terminalStatus)) {
        recoveryTerminalized = true;
        const priorOperationalStatus = terminalStatus;
        terminalStatus = 'failed';
        const gapEvent = recorder.log.append({
          worker: workerId, harness: events.at(-1)?.harness ?? '', turnEpoch: maxTurnEpoch,
          kind: 'control.recovery_terminalized', actor: 'policy',
          payload: { reason: 'coordination_terminal_batch_missing', priorStatus: priorOperationalStatus },
        });
        const gapEvidence = recorder.mapEvent(gapEvent);
        const transitioned = recorder.coordination.transitionTask(currentDurableTask.id, 'failed', currentDurableTask.version, {
          actor: 'policy', key: `task.failed:${currentDurableTask.id}:coordination_gap:${gapEvent.seq}`,
        }, gapEvidence ?? { reason: 'coordination_terminal_batch_missing' });
        const seeded = coordinator._tasks.get(currentDurableTask.id);
        if (seeded) seeded.coordinationVersion = transitioned.task.version;
      }

      // CI6: replay cannot resurrect an adapter session. Ordinary nonterminal reconstructed tasks
      // are durably failed. Exact Candidate-base revisions are the deliberate exception: their
      // external effect may be live, so they remain uncontrollable/unknown and never redeliver.
      const preservedInterrupt = terminalStatus === 'interrupted';
      if (!revisionRecoveryUnknown && !preservedInterrupt
        && !TERMINAL_TASK_STATUSES.has(terminalStatus)) {
        recoveryTerminalized = true;
        terminalStatus = 'failed';
        const recoveryEvent = recorder.log.append({
          worker: workerId,
          harness: events.at(-1)?.harness ?? '',
          turnEpoch: maxTurnEpoch,
          kind: 'control.recovery_terminalized',
          actor: 'policy',
          payload: { reason: 'session_not_reattached', priorStatus: events.at(-1)?.kind ?? 'unknown' },
        });
        const durable = taskId ? recorder.coordination?.task(taskId) : null;
        if (durable && !TERMINAL_TASK_STATUSES.has(durable.status)) {
          const evidence = recorder.mapEvent(recoveryEvent);
          const transitioned = recorder.coordination.transitionTask(taskId, 'failed', durable.version, {
            actor: 'policy', key: `task.failed:${taskId}:replay:${recoveryEvent?.seq ?? maxTurnEpoch}`,
          }, evidence ?? { reason: 'session_not_reattached' });
          const seeded = coordinator._tasks.get(taskId);
          if (seeded) {
            seeded.coordinationVersion = transitioned.task.version;
            coordinator._expireScratchClaims(coordinator._workers.get(workerId), seeded, 'replay_failed');
            coordinator._expireBoardClaims(coordinator._workers.get(workerId), seeded, 'replay_failed');
          }
        }
      }

      coordinator._fences.register(workerId);
      while (coordinator._fences.current(workerId).turnEpoch < maxTurnEpoch) coordinator._fences.bumpTurn(workerId);

      if (taskId) {
        const task = coordinator._tasks.get(taskId) ?? {
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
          workerPolicyRequest,
          workerPolicyResolution,
          workerPolicyObserved,
          workerPolicyMismatch,
          routeKey,
          sessionRequest,
          sessionRef,
          sessionContext,
          lineage,
          capturedSha,
          integration,
          retainedResultRef,
          checkpoint,
          verificationStability,
          publication,
          review,
        };
        const durable = recorder.coordination?.task(taskId);
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
        task.checkpoint = checkpoint;
        task.verificationStability = verificationStability;
        task.progressPreservation = progressPreservation;
        task.publication = publication;
        task.review = review;
        task.workerPolicyRequest = workerPolicyRequest
          ?? (task.brief?.workerPolicy ? normalizeWorkerPolicyRequest(task.brief.workerPolicy) : null);
        task.workerPolicyResolution = workerPolicyResolution;
        task.workerPolicyObserved = workerPolicyObserved;
        task.workerPolicyMismatch = workerPolicyMismatch;
        task.worktree = sessionContext?.worktree ?? task.worktree;
        coordinator._tasks.set(taskId, task);
        if (!coordinator._taskOrder.includes(taskId)) coordinator._taskOrder.push(taskId);
      }

      if (processRef && ['initializing', 'ready'].includes(processRef.state)) processRef = { ...processRef, state: 'unconfirmed_after_restart' };
      const recoveredProcessAuthority = processRef?.state === 'unconfirmed_after_restart'
        && processAuthorityState(processRef, processAuthority) === 'active';
      coordinator._workers.set(workerId, {
        id: workerId,
        runId: recorder.coordination?.task(taskId)?.runId ?? runId ?? null,
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
        workerPolicyRequest,
        workerPolicyResolution,
        workerPolicyObserved,
        workerPolicyMismatch,
        routeKey,
        sessionRequest,
        sessionRef,
        sessionContext,
        workspaceOwnerBinding,
        workspaceOwnerBindingValid: null,
        workspaceOwnerProcessAuthorityValid: null,
        lineage,
        taskId,
        worktree: sessionContext?.worktree ?? null,
        // A durable native reference is not a live transport. Even a terminal task that was
        // reusable before restart must remain uncontrollable until PS7 proves reattachment.
        status: (recoveryTerminalized || refinementAborted || sessionRef)
          ? 'orphaned' : coordinator._deriveWorkerStatus(terminalStatus),
        pendingApprovalId: null,
        pendingQuestionId: null,
        pendingDecisionId: null,
        budgetUsed,
        budgetThresholdsFired,
        budgetHardExceeded,
        terminalCause,
        usageCumulative,
        budgetStopTimer: null,
        turnTerminalObserved: false,
        providerGovernance,
        providerPolicyDigest,
        providerTurn,
        providerPolicyHardExceeded,
        providerTelemetryFailed,
        providerTerminalSeal,
        sessionPreservation: preservedInterrupt ? replayPreservation : null,
        preservedTurnEpoch: preservedInterrupt ? preservedTurnEpoch : null,
        watchdogActions: new Set(),
        recentFailedActions: [],
        turnInFlight: false,
        stallSeamDigestSet: null,
        stallSeamCycle: null,
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
        processAuthority,
        recoveredProcessAuthority,
        cleanupPending: false,
        cleanupPromise: null,
        cleanupAfterVerification: false,
        currentIncarnation: false,
        ownedWorktreeAuthority: recoveredProcessAuthority
          && typeof sessionContext?.worktree === 'string'
          && !isPhysicalWorkspaceId(sessionContext?.ownerTaskId),
        physicalWorkspaceCleanupCompleted: false,
        localAuthority: false,
        createdAt: new Date(0).toISOString(),
      });

      // CI6: replayed identifiers are reserved by value (#267). A subsequent allocation is
      // checked against them, whatever their shape, so it can never collide with or overwrite
      // reconstructed state.
      coordinator._replayedIds.workers.add(workerId);
      if (typeof taskId === 'string' && taskId.length > 0) coordinator._replayedIds.tasks.add(taskId);
      // Issue #351 lane 4: the worker's finalize work counts toward the same bound.
      if ((sinceYield += 1) >= chunk) { sinceYield = 0; yield; }
    }

    // F1: seed the reconstructed pending interactions now that every worker/task has been
    // rebuilt. `respond()`/`interactionStatus()` never return not_found for these again.
    // Issue #31 Part B rule 4: seeded unconditionally, exactly like `reconstructedPending` below
    // — neither loop checks whether CI6 subsequently failed the owning task. A dead task can
    // therefore carry a dangling `state:'pending'` pause record after restart, which is the
    // pre-existing, already-tolerated behavior for a dead task's dangling `_pending` record,
    // inherited here rather than newly introduced.
    for (const [pauseId, record] of reconstructedPaused) {
      coordinator._pausedTurns.set(pauseId, record);
    }
    for (const [requestId, record] of reconstructedPending) {
      coordinator._pending.set(requestId, record);
      coordinator._activeInteractionIds.add(requestId);
      const handle = coordinator._workers.get(record.worker);
      if (!handle) continue;
      if (record.kind === 'question') handle.pendingQuestionId = requestId;
      else if (record.kind === 'approval') handle.pendingApprovalId = requestId;
      else if (record.kind === 'decision') handle.pendingDecisionId = requestId;
    }

    // #105 D5/B-4: rebuild the message chain topology from the durable audit rows. A fresh
    // coordinator reconstructs each root and each reply hop with its parent link (inReplyTo),
    // depth, budget, and remaining from the RECORDED minted ids (ids are never re-derived, G6).
    // Roots are message.sent rows WITHOUT inReplyTo; reply hops are message.delivered rows WITH
    // inReplyTo; the legacy alias send rows (alias: true, key message.sent:<workerId>:<tail>, no
    // depth/budget/remaining, no inReplyTo) are SKIPPED — never seeded as phantom roots. After
    // seeding, each reply record inherits its parent's target verbatim (B-1) and parent.reply is
    // re-linked (per-member multi-reply parents keep every reply row in _messages; the single
    // parent.reply retains the first reply for compatibility). The live delivery state
    // machine (delivered/read/actedOn/lastRefusal) stays process-scoped — replay never fabricates
    // delivery state.
    const rebuiltMessages = new Map();
    const replySeeds = [];
    const unmarkedLaneReceipts = [];
    // #286 G-45: the ONE intentional whole-ledger read left in this file. This is the constructor's
    // replay rebuild of the message lane and it must see every event once; every other site reads a
    // bounded view (`eventsView(seq, 1)`, or the store's own projections). A no-arg read added
    // anywhere else is the bug this issue names.
    const messageEvents = typeof recorder.coordination.events === 'function'
      ? recorder.coordination.eventsView()
      : [];
    for (const event of messageEvents) {
      // Issue #351 lane 4: the whole-ledger message-lane sweep counts toward the same bound.
      if ((sinceYield += 1) >= chunk) { sinceYield = 0; yield; }
      if (event.kind !== 'message.sent' && event.kind !== 'message.delivered') continue;
      const row = event.payload ?? {};
      const rowKey = event.idempotencyKey ?? '';
      if (!row || typeof row.messageId !== 'string' || !/^message:[a-f0-9]{64}$/u.test(row.messageId)) continue;
      // Lane receipts (run.send / nudge aliases) carry the alias marker; they are never roots.
      if (row.alias === true) continue;
      // A chain root is keyed by its own messageId (`message.sent:<messageId>`). A sent row keyed
      // any other way is a lane receipt written before the marker existed: it is never seeded
      // (that would mint a phantom root) and the skip is not silent — it is recorded below.
      if (event.kind === 'message.sent' && rowKey !== `message.sent:${row.messageId}`) {
        unmarkedLaneReceipts.push({ messageId: row.messageId, idempotencyKey: rowKey, seq: event.seq ?? null });
        continue;
      }
      if (event.kind === 'message.sent') {
        if (row.inReplyTo !== undefined) continue;
        rebuiltMessages.set(row.messageId, {
          messageId: row.messageId, kind: row.kind ?? 'inform', body: row.body ?? '', from: row.from ?? 'orchestrator',
          target: row.to && typeof row.to === 'object' ? { ...row.to } : {},
          depth: row.depth ?? 0, budget: row.budget ?? 1, remaining: row.remaining ?? (row.budget ?? 1),
          ...(row.spilled === true ? { spilled: true, bytes: row.bytes, digest: row.digest, spill: row.spill } : {}),
          deliveries: new Map(), readBy: new Set(), actedOn: false, reply: null, replies: new Map(), lastRefusal: null,
        });
      } else if (row.inReplyTo !== undefined) {
        replySeeds.push(row);
      }
    }
    for (const finding of unmarkedLaneReceipts) {
      // One durable finding per row, keyed by the row it names, so a restart replays rather than
      // repeats it (#267 item 3).
      coordinator._bestEffortSync(
        () => recorder.recordDriver('replay.message_alias_unmarked', finding,
          `driver.replay.message_alias_unmarked:${finding.seq ?? finding.idempotencyKey}`, 'policy'),
        'replay_alias_unmarked_audit',
      );
    }
    for (const row of replySeeds) {
      const depth = row.depth ?? 1;
      const budget = row.budget ?? 1;
      const remaining = row.remaining ?? Math.max(0, budget - depth);
      rebuiltMessages.set(row.messageId, {
        messageId: row.messageId, kind: 'reply', body: row.body ?? '', from: row.from ?? row.workerId ?? 'worker',
        target: null, // filled by the parent-inheritance link below (B-1)
        depth, budget, remaining, inReplyTo: row.inReplyTo,
        ...(row.spilled === true ? { spilled: true, bytes: row.bytes, digest: row.digest, spill: row.spill } : {}),
        deliveries: new Map(), readBy: new Set(), actedOn: false, reply: null, replies: new Map(), lastRefusal: null,
      });
    }
    // Second pass: link each reply to its parent — inherit the parent's target verbatim (B-1)
    // and re-link parent.reply.
    for (const row of replySeeds) {
      const record = rebuiltMessages.get(row.messageId);
      const parent = rebuiltMessages.get(row.inReplyTo);
      if (!record || !parent) continue;
      record.target = parent.target;
      if (parent.from !== 'orchestrator') record.deliveryTarget = { workerId: parent.from };
      // #105 D4 (replay parity): the re-linked envelope carries the same NON-ENUMERABLE
      // depth/budget/remaining as the live admission, so the rebuilt topology deep-equals the
      // live one (FP-04 identity row holds across replay; T2/B-4 read the fields through the
      // accessors). The durable rows keep them enumerable — this is a projection, not a row.
      const reply = Object.freeze(Object.defineProperties({
        messageId: row.messageId, inReplyTo: row.inReplyTo, from: record.from, body: record.body,
        ...(row.spilled === true ? { spilled: true, bytes: row.bytes, digest: row.digest, spill: row.spill } : {}),
      }, {
        depth: { enumerable: false, value: record.depth },
        budget: { enumerable: false, value: record.budget },
        remaining: { enumerable: false, value: record.remaining },
      }));
      parent.replies.set(record.from, reply);
      parent.reply ??= reply;
    }
    for (const [messageId, record] of rebuiltMessages) {
      coordinator._messages.set(messageId, record);
    }
  }
