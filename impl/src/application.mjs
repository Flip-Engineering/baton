import { createHash, randomUUID } from 'node:crypto';
import {
  normalizeGoalRequest, normalizePlanRequest, planRouteAuthorityState, planRouteMatches,
  planSingleExactRoute,
} from './goal-plan.mjs';
import {
  contextEffectCallIdentity, contextEffectNodeBinding, contextEffectRetryCallIdentity,
} from './context-call.mjs';
import { contextProgramIsPure } from './context-authority.mjs';
import { normalizeContextProgram } from './context-program.mjs';
import { normalizeWorkerPolicyRequest } from './worker-policy.mjs';
import { normalizeWorkflowRevision } from './workflow-revision.mjs';
import {
  buildWorkflowRoleCatalog, validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3,
  workflowAttempt,
  workflowAttemptLogicalRole, workflowAttemptRoute, workflowCatalogRole,
} from './workflow-definition.mjs';
import {
  LEGACY_WORKFLOW_POLICY, normalizeWorkflowPolicy,
} from './workflow-policy.mjs';
import {
  identifyResultExportRoot, ResultExportLifecycle,
} from './result-export.mjs';
import { APPLICATION_SEMANTIC_REGISTRY, projectTypedTerminalCause } from './application-semantics.mjs';
import { hasNorthboundCapabilityAuthority } from './northbound-capability-authority.mjs';
import { projectRunTimelinePage } from './run-timeline.mjs';

export { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';

const MAX_PROFILES = 256;
const MAX_PROFILE_BYTES = 256 * 1024;
const APPLICATION_PROFILE_RECORD_KIND = 'application.profile_registered';
const APPLICATION_PROFILE_RECORD_ACTOR = 'application:profile-registry';
const APPLICATION_WORKFLOW_RECORD_KIND = 'application.workflow_definition_bound';
const APPLICATION_WORKFLOW_RECORD_ACTOR = 'application:workflow-registry';
const APPLICATION_WORKFLOW_SELECTION_RECORD_KIND = 'application.workflow_candidate_selected';
const APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND = 'application.workflow_feedback_recorded';
const APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND = 'application.workflow_member_stop_admitted';
const APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND = 'application.workflow_member_stop_completed';
const MAX_RUN_RECORDS = 100_000;
const MAX_RUN_VIEW_BYTES = 512 * 1024;
const MAX_RUN_VIEW_WORKERS = 1_024;
const MAX_RUN_LIST_ITEMS = 64;
const MAX_ATTENTION = 64;
const MAX_ATTENTION_TEXT_BYTES = 4_096;
const MAX_REVIEW_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_WORKFLOW_PLAN_HISTORY = 16;
// VR9/RV closed verifier projection bounds. Durable verdicts carry only exact captured-byte
// metadata and closed enums; raw command output and free-form diagnostics never cross the referee
// receipt boundary. A malformed duration is dropped rather than passed through.
const VERIFIER_DURATION_BOUND_MS = 7 * 24 * 60 * 60 * 1_000;
const HEX64 = /^[a-f0-9]{64}$/u;
const VERIFIER_OUTCOMES = Object.freeze(new Set(['passed', 'candidate_failed', 'inconclusive']));
const VERIFIER_OWNERSHIPS = Object.freeze(new Set(['candidate', 'verifier', 'baseline_or_environment']));
const VERIFIER_EXECUTION_STATES = Object.freeze(new Set(['completed', 'timed_out', 'output_exceeded', 'unavailable']));
const VERIFIER_EXECUTION_CODES = Object.freeze(new Set([
  'verification_completed', 'verification_timed_out', 'verification_output_exceeded', 'verification_spawn_unavailable',
]));
const VERIFIER_DIAGNOSTIC_CODES = Object.freeze(new Set([
  'verification_output_exceeded', 'verification_timed_out', 'verification_spawn_unavailable',
  'verification_claim_diverged', 'verification_red_green_failed', 'verification_coverage_failed',
  'verification_mutation_failed', 'verification_coverage_unavailable', 'verification_mutation_unavailable',
  'verification_passed', 'verification_exit_mismatch',
]));
function sanitizeHex64(value) {
  return typeof value === 'string' && HEX64.test(value) ? value : null;
}
function closedEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}
const SEMANTIC_ACTION_DISPATCH = Object.freeze({});
// Provider execution can settle while the application Run remains open for
// result finalization. These closed sets intentionally model separate lifecycles.
export const PROVIDER_EXECUTION_SETTLED_PHASES = new Set([
  'work_completed', 'selection_required', 'candidate_selected', 'completed', 'failed', 'cancelled', 'denied', 'stopped', 'closed',
]);
export const APPLICATION_RUN_TERMINAL_PHASES = new Set([
  'completed', 'failed', 'cancelled', 'denied', 'stopped', 'closed',
]);

export const APPLICATION_COMMAND_DEFINITIONS = Object.freeze({
  'application.help': Object.freeze({ args: Object.freeze(['topic', 'depth', 'runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'runs.list': Object.freeze({ args: Object.freeze([]), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.start': Object.freeze({ args: Object.freeze(['intent']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.inspect': Object.freeze({ args: Object.freeze(['runId', 'depth', 'section', 'item', 'offset', 'pageCursor', 'recipient', 'cursor', 'waitMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.act': Object.freeze({ args: Object.freeze(['runId', 'actionId', 'inputs']), capabilities: Object.freeze([]), semanticCapabilities: true, web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.status': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.follow': Object.freeze({ args: Object.freeze(['runId', 'afterCursor', 'timeoutMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.approve': Object.freeze({ args: Object.freeze(['runId', 'planDigest']), capabilities: Object.freeze(['approve', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.wait': Object.freeze({ args: Object.freeze(['runId', 'timeoutMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.answer': Object.freeze({ args: Object.freeze(['runId', 'requestId', 'answer']), capabilities: Object.freeze(['approve', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.feedback': Object.freeze({ args: Object.freeze(['runId', 'role', 'feedback']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.steer': Object.freeze({ args: Object.freeze(['runId', 'target', 'mode', 'message', 'reason']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: false }),
  'run.stop': Object.freeze({ args: Object.freeze(['runId', 'reason']), capabilities: Object.freeze(['emergency_stop', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.evidence': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.adopt': Object.freeze({ args: Object.freeze(['runId', 'nodeKey', 'resultSha', 'evidenceDigest', 'reason']), capabilities: Object.freeze(['adopt_result', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.retry_verification': Object.freeze({ args: Object.freeze(['runId', 'reason']), capabilities: Object.freeze(['retry_verification', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.resume_work': Object.freeze({ args: Object.freeze(['runId', 'reason']), capabilities: Object.freeze(['resume_work', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.review': Object.freeze({ args: Object.freeze(['runId', 'route', 'reason']), capabilities: Object.freeze(['review', 'control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.integrate': Object.freeze({ args: Object.freeze(['runId', 'evidenceDigest', 'strategy', 'reason']), capabilities: Object.freeze(['integrate_result', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.export': Object.freeze({ args: Object.freeze(['runId', 'evidenceDigest']), capabilities: Object.freeze(['export_result', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.recover': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'application.shutdown': Object.freeze({ args: Object.freeze([]), capabilities: Object.freeze(['emergency_stop']), web: false, mcp: false, mcpStateful: false, reconcilable: false }),
});

function applicationError(message, code) {
  return Object.assign(new Error(message), { code });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

// Transport admission, audit, and completion events advance the global cursor without changing
// a Run's semantic authority. Keep those events observable through `cursor`, but never let them
// invalidate an action Baton just offered to an authenticated caller.
function semanticViewDigest(view) {
  const { cursor: _transportCursor, ...semanticView } = view;
  return digest(semanticView);
}

function uuidFromDigest(hex) {
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function contentDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resultExportArchiveCeiling(policy) {
  const value = policy.maxBytes + MAX_RUN_VIEW_BYTES + ((policy.maxFiles + 1) * 1_024);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw applicationError('profile export archive ceiling is invalid', 'application_export_policy_stale');
  }
  return value;
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function exactObject(value, fields, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) {
    throw applicationError(`${label} has unknown or missing fields`, code);
  }
}

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value); }
function validText(value, maxBytes = 4096) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= maxBytes;
}

const SECRET_SHAPED_TEXT = Object.freeze([
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/u,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/iu,
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
]);

function boundedAttentionText(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim();
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) return '[credential-shaped content redacted]';
  const bytes = Buffer.from(normalized);
  if (bytes.length <= MAX_ATTENTION_TEXT_BYTES) return normalized;
  return `${bytes.subarray(0, MAX_ATTENTION_TEXT_BYTES).toString('utf8')}…`;
}

function normalizeAnswer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw applicationError('Run answer is invalid', 'application_answer_invalid');
  }
  if (Object.keys(value).sort().join(',') === 'text') {
    if (!validText(value.text, MAX_ATTENTION_TEXT_BYTES)
      || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.text))) {
      throw applicationError('Run answer is invalid', 'application_answer_invalid');
    }
    return { text: value.text.normalize('NFKC').trim() };
  }
  if (Object.keys(value).sort().join(',') === 'decision' && ['allow', 'deny', 'cancel'].includes(value.decision)) {
    return { decision: value.decision };
  }
  throw applicationError('Run answer is invalid', 'application_answer_invalid');
}

function normalizeSteer(value) {
  exactObject(value, ['runId', 'target', 'mode', 'message', 'reason'], 'application_steer_invalid', 'Run steer');
  if (!validId(value.runId) || !validId(value.target) || !['nudge', 'now', 'turn'].includes(value.mode)
    || !validText(value.message, MAX_ATTENTION_TEXT_BYTES) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.message) || pattern.test(value.reason))) {
    throw applicationError('Run steer request is invalid', 'application_steer_invalid');
  }
  return deepFreeze(clone(value));
}

function normalizeStop(value) {
  exactObject(value, ['runId', 'reason'], 'application_stop_invalid', 'Run stop');
  if (!validId(value.runId) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run stop request is invalid', 'application_stop_invalid');
  }
  return deepFreeze({ runId: value.runId, reason: value.reason.normalize('NFKC').trim() });
}

function normalizeAdopt(value) {
  exactObject(value, ['runId', 'nodeKey', 'resultSha', 'evidenceDigest', 'reason'], 'application_adopt_invalid', 'Run adoption');
  if (!validId(value.runId) || !validId(value.nodeKey)
    || !/^[a-f0-9]{40,64}$/u.test(value.resultSha ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.evidenceDigest ?? '')
    || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run adoption request is invalid', 'application_adopt_invalid');
  }
  return deepFreeze({ ...clone(value), reason: value.reason.normalize('NFKC').trim() });
}

function normalizeRetryVerification(value) {
  exactObject(value, ['runId', 'reason'], 'application_retry_invalid', 'Run verification retry');
  if (!validId(value.runId) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run verification retry request is invalid', 'application_retry_invalid');
  }
  return deepFreeze({ runId: value.runId, reason: value.reason.normalize('NFKC').trim() });
}

// PS5: resume_work is coordinate-free. The caller supplies only a bounded audit reason — never a
// Git ref, SHA, worktree path, harness command, provider credential, budget, or storage ceiling.
function normalizeResumeWork(value) {
  exactObject(value, ['runId', 'reason'], 'application_resume_invalid', 'Run resume');
  if (!validId(value.runId) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run resume request is invalid', 'application_resume_invalid');
  }
  return deepFreeze({ runId: value.runId, reason: value.reason.normalize('NFKC').trim() });
}

function normalizeReviewRequest(value) {
  exactObject(value, ['runId', 'route', 'reason'], 'application_review_invalid', 'Run review');
  if (!validId(value.runId) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run review request is invalid', 'application_review_invalid');
  }
  return deepFreeze({
    runId: value.runId,
    route: normalizeRoute(value.route, 'application_review_invalid'),
    reason: value.reason.normalize('NFKC').trim(),
  });
}

function normalizeIntegrationRequest(value) {
  exactObject(value, ['runId', 'evidenceDigest', 'strategy', 'reason'], 'application_integration_invalid', 'Run integration');
  if (!validId(value.runId) || !/^[a-f0-9]{64}$/u.test(value.evidenceDigest ?? '')
    || !['ff-only', 'structured'].includes(value.strategy) || !validText(value.reason, 1_024)
    || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(value.reason))) {
    throw applicationError('Run integration request is invalid', 'application_integration_invalid');
  }
  return deepFreeze({ ...clone(value), reason: value.reason.normalize('NFKC').trim() });
}

function normalizePrincipal(value, label) {
  exactObject(value, ['actor', 'principalId', 'sessionId'], 'application_authority_invalid', label);
  if (!validText(value.actor, 256) || !validId(value.principalId) || !validId(value.sessionId)) {
    throw applicationError(`${label} is invalid`, 'application_authority_invalid');
  }
  return deepFreeze(clone(value));
}

function semanticAuthorityPayload(value) {
  return {
    schemaVersion: 1,
    actionId: value.actionId,
    kind: value.kind,
    effect: value.effect,
    requiredCapabilities: [...value.requiredCapabilities].sort(),
  };
}

function normalizeSemanticAuthority(value, code = 'application_context_invalid') {
  exactObject(value,
    ['schemaVersion', 'actionId', 'kind', 'effect', 'requiredCapabilities', 'authorityDigest'],
    code, 'semantic action authority');
  if (value.schemaVersion !== 1 || !validId(value.actionId) || !validId(value.kind)
    || !validId(value.effect) || !Array.isArray(value.requiredCapabilities)
    || value.requiredCapabilities.length === 0 || value.requiredCapabilities.length > 16
    || value.requiredCapabilities.some((capability) => !validId(capability))
    || new Set(value.requiredCapabilities).size !== value.requiredCapabilities.length
    || value.requiredCapabilities.join('\0') !== [...value.requiredCapabilities].sort().join('\0')
    || !/^[a-f0-9]{64}$/u.test(value.authorityDigest ?? '')) {
    throw applicationError('semantic action authority is invalid', code);
  }
  const payload = semanticAuthorityPayload(value);
  if (digest(payload) !== value.authorityDigest) {
    throw applicationError('semantic action authority digest is invalid', code);
  }
  return deepFreeze({ ...payload, authorityDigest: value.authorityDigest });
}

function semanticAuthorityForAction(action) {
  const payload = semanticAuthorityPayload(action);
  return deepFreeze({ ...payload, authorityDigest: digest(payload) });
}

function normalizeCommandContext(value) {
  if (value === undefined || value === null) return null;
  const fields = ['idempotencyKey', 'requestId', 'transport'];
  if (Object.hasOwn(value ?? {}, 'sessionAuthority')) fields.push('sessionAuthority');
  const hasCapabilityAuthority = Object.hasOwn(value ?? {}, 'capabilityAuthority');
  if (hasCapabilityAuthority) fields.push('capabilityAuthority');
  if (Object.hasOwn(value ?? {}, 'capabilities')) fields.push('capabilities');
  if (Object.hasOwn(value ?? {}, 'semanticAuthority')) fields.push('semanticAuthority');
  exactObject(value, fields, 'application_context_invalid', 'application command context');
  if (!['direct', 'mcp', 'web'].includes(value.transport)
    || !validText(value.requestId, 256) || !validText(value.idempotencyKey, 512)) {
    throw applicationError('application command context is invalid', 'application_context_invalid');
  }
  if (value.sessionAuthority !== undefined) {
    exactObject(value.sessionAuthority,
      ['schemaVersion', 'authorityDigest', 'expiresAt', 'orchestratorLeaseId'],
      'application_context_invalid', 'application session authority');
    if (value.sessionAuthority.schemaVersion !== 1
      || !/^[a-f0-9]{64}$/u.test(value.sessionAuthority.authorityDigest ?? '')
      || !validText(value.sessionAuthority.orchestratorLeaseId, 512)
      || !Number.isFinite(Date.parse(value.sessionAuthority.expiresAt ?? ''))
      || new Date(Date.parse(value.sessionAuthority.expiresAt)).toISOString() !== value.sessionAuthority.expiresAt) {
      throw applicationError('application session authority is invalid', 'application_context_invalid');
    }
  }
  const hasCapabilities = Object.hasOwn(value, 'capabilities');
  const hasSemanticAuthority = Object.hasOwn(value, 'semanticAuthority');
  if (hasCapabilityAuthority || hasCapabilities || hasSemanticAuthority) {
    if (!hasCapabilityAuthority || !hasCapabilities
      || !hasNorthboundCapabilityAuthority(value.transport, value.capabilityAuthority)
      || !Array.isArray(value.capabilities) || value.capabilities.length > 128
      || value.capabilities.some((capability) => !validId(capability))
      || new Set(value.capabilities).size !== value.capabilities.length) {
      throw applicationError('application capability context is invalid', 'application_context_invalid');
    }
  }
  const normalized = {
    transport: value.transport,
    requestId: value.requestId,
    idempotencyKey: value.idempotencyKey,
    ...(value.sessionAuthority === undefined ? {} : { sessionAuthority: deepFreeze(clone(value.sessionAuthority)) }),
    ...(hasCapabilityAuthority ? {
      capabilityAuthority: value.capabilityAuthority,
      capabilities: Object.freeze([...value.capabilities].sort()),
    } : {}),
    ...(hasSemanticAuthority
      ? { semanticAuthority: normalizeSemanticAuthority(value.semanticAuthority) } : {}),
  };
  return Object.freeze(normalized);
}

function normalizeRoute(value, code = 'application_route_invalid') {
  exactObject(value, ['harness', 'model', 'effort'], code, 'route');
  if (![value.harness, value.model, value.effort].every((item) => validText(item, 256))) {
    throw applicationError('route is invalid', code);
  }
  return deepFreeze({ harness: value.harness, model: value.model, effort: value.effort });
}

function normalizeRouteSelector(value) {
  if (value === undefined) return null;
  const allowed = new Set(['harness', 'model', 'effort']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length === 0 || Object.keys(value).some((key) => !allowed.has(key))
    || Object.values(value).some((item) => !validText(item, 256))
    || value.model === undefined || value.effort === undefined) {
    throw applicationError('route selector is invalid', 'application_route_invalid');
  }
  return deepFreeze(clone(value));
}

function normalizeStringSet(value, label, { empty = false, max = 64, maxBytes = 4096 } = {}) {
  if (!Array.isArray(value) || value.length > max || (!empty && value.length === 0)
    || value.some((item) => !validText(item, maxBytes)) || new Set(value).size !== value.length) {
    throw applicationError(`${label} is invalid`, 'application_profile_invalid');
  }
  return [...value].sort();
}

function normalizeBudget(value, label) {
  exactObject(value, ['tokens', 'usd', 'wallMin', 'providerTurns'], 'application_profile_invalid', label);
  if (!Number.isSafeInteger(value.tokens) || value.tokens <= 0
    || typeof value.usd !== 'number' || !Number.isFinite(value.usd) || value.usd <= 0
    || !Number.isSafeInteger(value.wallMin) || value.wallMin <= 0
    || !Number.isSafeInteger(value.providerTurns) || value.providerTurns <= 0) {
    throw applicationError(`${label} is invalid`, 'application_profile_invalid');
  }
  return clone(value);
}

function normalizeVerification(value) {
  const fields = ['command', 'arguments', 'cwd', 'envAllowlist', 'expectExit', 'expectResult', 'timeoutMs', 'maxOutputBytes', 'requiredPredecessorEvidence'];
  exactObject(value, fields, 'application_profile_invalid', 'profile verification');
  if (!validText(value.command) || !Array.isArray(value.arguments) || value.arguments.length > 64
    || value.arguments.some((item) => typeof item !== 'string' || item.includes('\0') || Buffer.byteLength(item) > 4096)
    || !validText(value.cwd) || !Array.isArray(value.envAllowlist) || value.envAllowlist.length > 64
    || value.envAllowlist.some((item) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(item))
    || !Number.isSafeInteger(value.expectExit) || value.expectExit < 0 || value.expectExit > 255
    || value.expectResult !== 'exit_code' || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0
    || !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes <= 0
    || !Array.isArray(value.requiredPredecessorEvidence) || value.requiredPredecessorEvidence.length !== 0) {
    throw applicationError('profile verification is invalid', 'application_profile_invalid');
  }
  return clone(value);
}

function normalizeResultPolicy(value) {
  exactObject(value, ['mode', 'maxAdoptedResults', 'locator'], 'application_profile_invalid', 'profile resultPolicy');
  if (!['none', 'manual'].includes(value.mode) || value.locator !== 'git_ref'
    || !Number.isSafeInteger(value.maxAdoptedResults)
    || (value.mode === 'none' && value.maxAdoptedResults !== 0)
    || (value.mode === 'manual' && value.maxAdoptedResults !== 1)) {
    throw applicationError('profile resultPolicy is invalid', 'application_profile_invalid');
  }
  return clone(value);
}

function normalizeReviewPolicy(value) {
  if (value === undefined) return deepFreeze({ mode: 'none', routes: [], reportPath: null, maxFindings: 0, maxReportBytes: 0 });
  exactObject(value, ['mode', 'routes', 'reportPath', 'maxFindings', 'maxReportBytes'], 'application_profile_invalid', 'profile reviewPolicy');
  if (value.mode === 'none' && Array.isArray(value.routes) && value.routes.length === 0
    && value.reportPath === null && value.maxFindings === 0 && value.maxReportBytes === 0) {
    return deepFreeze(clone(value));
  }
  if (value.mode !== 'required' || !Array.isArray(value.routes) || value.routes.length === 0 || value.routes.length > 64
    || !safeScopePath(value.reportPath) || !Number.isSafeInteger(value.maxFindings) || value.maxFindings <= 0 || value.maxFindings > 1_024
    || !Number.isSafeInteger(value.maxReportBytes) || value.maxReportBytes < 256 || value.maxReportBytes > 16 * 1024 * 1024) {
    throw applicationError('profile reviewPolicy is invalid', 'application_profile_invalid');
  }
  const routes = value.routes.map((route) => normalizeRoute(route, 'application_profile_invalid'));
  if (new Set(routes.map(digest)).size !== routes.length) throw applicationError('profile reviewPolicy routes contain duplicates', 'application_profile_invalid');
  return deepFreeze({
    mode: 'required', routes: routes.map(clone).sort((a, b) => {
      const left = digest(a); const right = digest(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    reportPath: value.reportPath, maxFindings: value.maxFindings, maxReportBytes: value.maxReportBytes,
  });
}

function normalizeIntegrationPolicy(value) {
  if (value === undefined) return deepFreeze({ mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false });
  exactObject(value, ['mode', 'strategies', 'requireAdoptedResult', 'requireSemanticReview'], 'application_profile_invalid', 'profile integrationPolicy');
  if (value.mode === 'none' && Array.isArray(value.strategies) && value.strategies.length === 0
    && value.requireAdoptedResult === false && value.requireSemanticReview === false) {
    return deepFreeze(clone(value));
  }
  if (value.mode !== 'manual' || !Array.isArray(value.strategies) || value.strategies.length === 0
    || value.strategies.length > 2 || value.strategies.some((strategy) => !['ff-only', 'structured'].includes(strategy))
    || new Set(value.strategies).size !== value.strategies.length
    || typeof value.requireAdoptedResult !== 'boolean' || typeof value.requireSemanticReview !== 'boolean') {
    throw applicationError('profile integrationPolicy is invalid', 'application_profile_invalid');
  }
  return deepFreeze({ ...clone(value), strategies: [...value.strategies].sort() });
}

function normalizeExportPolicy(value) {
  if (value === undefined) return deepFreeze({
    mode: 'none', format: 'directory-v1', maxFiles: 0, maxBytes: 0,
    requireAdoptedResult: false, requireSemanticReview: false, requireIntegration: false,
  });
  exactObject(value, [
    'mode', 'format', 'maxFiles', 'maxBytes',
    'requireAdoptedResult', 'requireSemanticReview', 'requireIntegration',
  ], 'application_profile_invalid', 'profile exportPolicy');
  if (value.mode === 'none' && value.format === 'directory-v1' && value.maxFiles === 0 && value.maxBytes === 0
    && value.requireAdoptedResult === false && value.requireSemanticReview === false
    && value.requireIntegration === false) {
    return deepFreeze(clone(value));
  }
  if (value.mode !== 'manual' || value.format !== 'directory-v1'
    || !Number.isSafeInteger(value.maxFiles) || value.maxFiles <= 0
    || !Number.isSafeInteger(value.maxBytes) || value.maxBytes <= 0
    || typeof value.requireAdoptedResult !== 'boolean'
    || typeof value.requireSemanticReview !== 'boolean'
    || typeof value.requireIntegration !== 'boolean') {
    throw applicationError('profile exportPolicy is invalid', 'application_profile_invalid');
  }
  return deepFreeze(clone(value));
}

function normalizeFollowPolicy(value) {
  if (value === undefined) return deepFreeze({
    // Disabled change waiting still permits one bounded semantic inspection. Zero response/item
    // bounds made the unified Run surface unusable for otherwise valid deployment profiles.
    mode: 'none', maxWaitMs: 0, maxChanges: MAX_ATTENTION,
    maxResponseBytes: MAX_RUN_VIEW_BYTES, maxScanEvents: 0,
  });
  exactObject(value, ['mode', 'maxWaitMs', 'maxChanges', 'maxResponseBytes', 'maxScanEvents'],
    'application_profile_invalid', 'profile followPolicy');
  if (value.mode === 'none' && value.maxWaitMs === 0 && value.maxChanges === MAX_ATTENTION
    && value.maxResponseBytes === MAX_RUN_VIEW_BYTES && value.maxScanEvents === 0) {
    return deepFreeze(clone(value));
  }
  if (value.mode !== 'enabled'
    || ![value.maxWaitMs, value.maxChanges, value.maxResponseBytes, value.maxScanEvents]
      .every((item) => Number.isSafeInteger(item) && item > 0)
    || value.maxWaitMs > 24 * 60 * 60 * 1_000
    || value.maxChanges > value.maxScanEvents
    || value.maxResponseBytes > MAX_RUN_VIEW_BYTES) {
    throw applicationError('profile followPolicy is invalid', 'application_profile_invalid');
  }
  return deepFreeze(clone(value));
}

function normalizeRecoveryPolicy(value) {
  if (value === undefined) return deepFreeze({
    mode: 'none', maxAttempts: 0, timeoutMs: 0,
    eligibleSessionModes: [], ambiguousDispatch: 'operator_required',
  });
  exactObject(value, [
    'mode', 'maxAttempts', 'timeoutMs', 'eligibleSessionModes', 'ambiguousDispatch',
  ], 'application_profile_invalid', 'profile recoveryPolicy');
  if (value.mode === 'none' && value.maxAttempts === 0 && value.timeoutMs === 0
    && Array.isArray(value.eligibleSessionModes) && value.eligibleSessionModes.length === 0
    && value.ambiguousDispatch === 'operator_required') {
    return deepFreeze(clone(value));
  }
  if (value.mode !== 'manual'
    || !Number.isSafeInteger(value.maxAttempts) || value.maxAttempts <= 0
    || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0
    || !Array.isArray(value.eligibleSessionModes) || value.eligibleSessionModes.length === 0
    || value.eligibleSessionModes.some((mode) => mode !== 'resume')
    || new Set(value.eligibleSessionModes).size !== value.eligibleSessionModes.length
    || value.ambiguousDispatch !== 'operator_required') {
    throw applicationError('profile recoveryPolicy is invalid', 'application_profile_invalid');
  }
  return deepFreeze({ ...clone(value), eligibleSessionModes: [...value.eligibleSessionModes].sort() });
}

function normalizeProfile(name, value, repoId) {
  const profileVersion = value?.schemaVersion;
  const requiredFields = [
    'schemaVersion', 'repoId', 'definitionOfDone', 'constraints', 'risk', 'goalBudget',
    'nodeBudget', 'pathScope', 'verification', 'routes', 'capabilities', 'effects', 'resultPolicy',
  ];
  if (profileVersion === 2) requiredFields.push('workerPolicy');
  const allowedFields = new Set([...requiredFields, 'requiredEffects', 'reviewPolicy', 'integrationPolicy', 'followPolicy', 'exportPolicy', 'recoveryPolicy']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || requiredFields.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw applicationError(`profile ${name} has unknown or missing fields`, 'application_profile_invalid');
  }
  if (!validId(name) || ![1, 2].includes(value.schemaVersion) || value.repoId !== repoId || !validText(value.risk, 64)) {
    throw applicationError(`profile ${name} is invalid`, 'application_profile_invalid');
  }
  if (!Array.isArray(value.routes) || value.routes.length === 0 || value.routes.length > 64) {
    throw applicationError(`profile ${name} routes are invalid`, 'application_profile_invalid');
  }
  const routes = value.routes.map((route) => normalizeRoute(route, 'application_profile_invalid'));
  if (new Set(routes.map(digest)).size !== routes.length) {
    throw applicationError(`profile ${name} routes contain duplicates`, 'application_profile_invalid');
  }
  const reviewPolicy = normalizeReviewPolicy(value.reviewPolicy);
  const normalized = {
    schemaVersion: value.schemaVersion,
    repoId,
    definitionOfDone: normalizeStringSet(value.definitionOfDone, 'profile definitionOfDone'),
    constraints: normalizeStringSet(value.constraints, 'profile constraints', { empty: true }),
    risk: value.risk,
    goalBudget: normalizeBudget(value.goalBudget, 'profile goalBudget'),
    nodeBudget: normalizeBudget(value.nodeBudget, 'profile nodeBudget'),
    pathScope: normalizeStringSet(value.pathScope, 'profile pathScope'),
    verification: normalizeVerification(value.verification),
    routes: routes.map(clone).sort((a, b) => {
      const left = digest(a); const right = digest(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    capabilities: normalizeStringSet(value.capabilities, 'profile capabilities', { empty: true, maxBytes: 128 }),
    effects: normalizeStringSet(value.effects, 'profile effects', { empty: true, maxBytes: 128 }),
    ...(value.schemaVersion === 2 ? { workerPolicy: normalizeWorkerPolicyRequest(value.workerPolicy) } : {}),
    ...(Object.hasOwn(value, 'requiredEffects') ? {
      requiredEffects: normalizeStringSet(value.requiredEffects, 'profile requiredEffects', { empty: true, maxBytes: 128 }),
    } : {}),
    resultPolicy: normalizeResultPolicy(value.resultPolicy),
    reviewPolicy,
    integrationPolicy: normalizeIntegrationPolicy(value.integrationPolicy),
    followPolicy: normalizeFollowPolicy(value.followPolicy),
    exportPolicy: normalizeExportPolicy(value.exportPolicy),
    recoveryPolicy: normalizeRecoveryPolicy(value.recoveryPolicy),
  };
  if (normalized.pathScope.some((entry) => !safeScopePath(entry))) {
    throw applicationError(`profile ${name} path scope is invalid`, 'application_profile_invalid');
  }
  if ((normalized.requiredEffects ?? []).some((effect) => effect !== 'repository_edit' || !normalized.effects.includes(effect))) {
    throw applicationError(`profile ${name} required effects exceed authorized effects`, 'application_profile_invalid');
  }
  if (reviewPolicy.mode === 'required'
    && !normalized.pathScope.some((entry) => scopeEntryWithin(reviewPolicy.reportPath, entry))) {
    throw applicationError(`profile ${name} review report path is outside Plan scope`, 'application_profile_invalid');
  }
  if (normalized.constraints.some((constraint) => constraint.startsWith('Baton deployment profile '))) {
    throw applicationError(`profile ${name} uses a reserved application constraint`, 'application_profile_invalid');
  }
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_PROFILE_BYTES) {
    throw applicationError(`profile ${name} exceeds the byte ceiling`, 'application_profile_invalid');
  }
  return deepFreeze({ ...normalized, digest: digest(normalized) });
}

function profileDefinition(profile) {
  const { digest: ignored, ...definition } = clone(profile);
  void ignored;
  return definition;
}
function profileRegistryCoordinate(name, profileDigest) { return `${name}\0${profileDigest}`; }
function profileRegistryKey(repoId, name, profileDigest) { return `${APPLICATION_PROFILE_RECORD_KIND}:${digest({ repoId, name, profileDigest })}`; }
function normalizeProfileRegistryEvent(event) {
  const payload = event?.payload;
  exactObject(payload, ['kind', 'schemaVersion', 'repoId', 'name', 'profileDigest', 'profileDefinition'],
    'application_profile_registry_invalid', 'application profile registry record');
  if (event.kind !== 'driver.recorded' || payload.kind !== APPLICATION_PROFILE_RECORD_KIND
    || payload.schemaVersion !== 1 || !validId(payload.repoId) || !validId(payload.name)
    || !/^[a-f0-9]{64}$/u.test(payload.profileDigest ?? '')
    || event.actor !== APPLICATION_PROFILE_RECORD_ACTOR
    || event.idempotencyKey !== profileRegistryKey(payload.repoId, payload.name, payload.profileDigest)) {
    throw applicationError('application profile registry record is invalid', 'application_profile_registry_invalid');
  }
  let profile;
  try { profile = normalizeProfile(payload.name, payload.profileDefinition, payload.repoId); }
  catch (cause) {
    throw Object.assign(applicationError('application profile registry definition is invalid',
      'application_profile_registry_invalid'), { cause });
  }
  if (profile.digest !== payload.profileDigest) {
    throw applicationError('application profile registry digest is invalid', 'application_profile_registry_invalid');
  }
  return deepFreeze({ repoId: payload.repoId, name: payload.name, profile });
}

function normalizeIntent(value) {
  const allowed = new Set(['runId', 'objective', 'profile', 'route', 'scope', 'composition']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || !Object.hasOwn(value, 'objective')
    || (value.runId !== undefined && !validId(value.runId))
    || !validText(value.objective) || (value.profile !== undefined && !validId(value.profile))
    || (value.scope !== undefined && (!Array.isArray(value.scope) || value.scope.length === 0 || value.scope.length > 64
      || value.scope.some((item) => !validText(item)) || new Set(value.scope).size !== value.scope.length))) {
    throw applicationError('run intent is invalid', 'application_intent_invalid');
  }
  return deepFreeze({
    runId: value.runId ?? null,
    objective: value.objective.normalize('NFKC').trim(),
    profile: value.profile ?? null,
    route: normalizeRouteSelector(value.route),
    scope: value.scope === undefined ? null : [...value.scope].sort(),
    composition: value.composition === undefined ? null : normalizeWorkflowComposition(value.composition),
  });
}

function normalizeWorkflowComposition(value) {
  exactObject(value, ['strategy', 'workspace', 'join', 'team'],
    'application_workflow_invalid', 'workflow composition');
  if (value.strategy !== 'parallel_attempts' || value.workspace !== 'isolated'
    || value.join !== 'operator_selected' || !Array.isArray(value.team)
    || value.team.length < 2 || value.team.length > 16) {
    throw applicationError('workflow composition is outside the supported authority',
      'application_workflow_invalid');
  }
  const team = value.team.map((member) => {
    exactObject(member, ['role', 'route'], 'application_workflow_invalid', 'workflow team member');
    if (!validId(member.role)) {
      throw applicationError('workflow role is invalid', 'application_workflow_invalid');
    }
    return { role: member.role, route: clone(normalizeRoute(member.route, 'application_workflow_invalid')) };
  }).sort((left, right) => (left.role < right.role ? -1 : left.role > right.role ? 1 : 0));
  if (new Set(team.map(({ role }) => role)).size !== team.length) {
    throw applicationError('workflow roles contain duplicates', 'application_workflow_invalid');
  }
  return deepFreeze({
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected', team,
  });
}

function normalizeWorkflowFeedback(value) {
  const input = typeof value === 'string'
    ? {
      summary: value,
      findings: [{ kind: 'observation', severity: 'info', message: value, path: null, line: null }],
    } : value;
  exactObject(input, ['summary', 'findings'], 'application_workflow_feedback_invalid',
    'workflow feedback');
  if (!validText(input.summary, 4_096) || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(input.summary))
    || !Array.isArray(input.findings) || input.findings.length === 0 || input.findings.length > 32) {
    throw applicationError('workflow feedback is invalid', 'application_workflow_feedback_invalid');
  }
  const findings = input.findings.map((finding) => {
    exactObject(finding, ['kind', 'severity', 'message', 'path', 'line'],
      'application_workflow_feedback_invalid', 'workflow feedback finding');
    if (!['contradiction', 'defect', 'risk', 'suggestion', 'question', 'observation'].includes(finding.kind)
      || !['info', 'low', 'medium', 'high', 'critical'].includes(finding.severity)
      || !validText(finding.message, 4_096)
      || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(finding.message))
      || (finding.path !== null && !safeScopePath(finding.path))
      || (finding.line !== null && (!Number.isSafeInteger(finding.line) || finding.line <= 0))) {
      throw applicationError('workflow feedback finding is invalid',
        'application_workflow_feedback_invalid');
    }
    return {
      kind: finding.kind, severity: finding.severity,
      message: finding.message.normalize('NFKC').trim(),
      path: finding.path, line: finding.line,
    };
  });
  return deepFreeze({ summary: input.summary.normalize('NFKC').trim(), findings });
}

function assertWorkflowFeedbackAnchors(feedback, candidate) {
  const changedPaths = new Set(candidate.changedPaths);
  for (const finding of feedback.findings) {
    if (finding.line !== null && finding.path === null) {
      throw applicationError('Workflow feedback line anchors require an exact changed path',
        'application_workflow_feedback_anchor_invalid');
    }
    if (finding.path !== null && !changedPaths.has(finding.path)) {
      throw applicationError('Workflow feedback path is outside the exact Candidate delta',
        'application_workflow_feedback_anchor_invalid');
    }
  }
  return true;
}

function workflowNodeBudget(profile, members, rounds = 1) {
  const divisor = members * rounds;
  const divide = (value) => Math.floor(value / divisor);
  const budget = {
    tokens: Math.min(profile.nodeBudget.tokens, divide(profile.goalBudget.tokens)),
    usd: Math.min(profile.nodeBudget.usd,
      Math.floor((profile.goalBudget.usd * 1_000_000_000) / divisor) / 1_000_000_000),
    wallMin: Math.min(profile.nodeBudget.wallMin, divide(profile.goalBudget.wallMin)),
    providerTurns: Math.min(profile.nodeBudget.providerTurns, divide(profile.goalBudget.providerTurns)),
  };
  if (!Number.isSafeInteger(budget.tokens) || budget.tokens <= 0 || budget.usd <= 0
    || !Number.isSafeInteger(budget.wallMin) || budget.wallMin <= 0
    || !Number.isSafeInteger(budget.providerTurns) || budget.providerTurns <= 0) {
    throw applicationError('workflow team exceeds deployment-owned execution authority',
      'application_workflow_capacity');
  }
  return deepFreeze(budget);
}

function workflowRevisionBudget(profile, priorPlans, members, maxRounds) {
  if (!Array.isArray(priorPlans) || priorPlans.length === 0
    || !Number.isSafeInteger(maxRounds) || maxRounds < 2
    || priorPlans.length >= maxRounds) return null;
  const node = workflowNodeBudget(profile, members, maxRounds);
  const desired = {
    tokens: node.tokens * members,
    usd: Math.round(node.usd * 1_000_000_000) * members,
    wallMin: node.wallMin * members,
    providerTurns: node.providerTurns * members,
  };
  const allocated = priorPlans.reduce((sum, plan) => ({
    tokens: sum.tokens + plan.totals.tokens,
    usd: sum.usd + Math.round(plan.totals.usd * 1_000_000_000),
    wallMin: sum.wallMin + plan.totals.wallMin,
    providerTurns: sum.providerTurns + plan.totals.providerTurns,
  }), { tokens: 0, usd: 0, wallMin: 0, providerTurns: 0 });
  const ceiling = {
    tokens: profile.goalBudget.tokens,
    usd: Math.round(profile.goalBudget.usd * 1_000_000_000),
    wallMin: profile.goalBudget.wallMin,
    providerTurns: profile.goalBudget.providerTurns,
  };
  return Object.keys(ceiling).every((key) => allocated[key] + desired[key] <= ceiling[key])
    ? node : null;
}

function workflowDefinitionPolicy(definition) {
  if (!Object.hasOwn(definition, 'workflowPolicy')
    && !Object.hasOwn(definition, 'workflowPolicyDigest')) {
    return LEGACY_WORKFLOW_POLICY;
  }
  let policy;
  try { policy = normalizeWorkflowPolicy(definition.workflowPolicy); }
  catch {
    throw applicationError('Workflow definition policy is invalid', 'application_workflow_integrity');
  }
  if (definition.workflowPolicyDigest !== policy.policyDigest) {
    throw applicationError('Workflow definition policy digest changed', 'application_workflow_integrity');
  }
  return policy;
}

function workflowFeedbackBodySetDigest(packets) {
  return digest(packets.map((packet) => digest(packet.feedback)).sort());
}

function workflowEligibilityProjection(eligibility) {
  return deepFreeze({
    state: eligibility.state,
    reason: eligibility.reason,
    nextRound: eligibility.nextRound,
    maxRounds: eligibility.maxRounds,
    policyDigest: eligibility.policy.policyDigest,
    budget: {
      state: eligibility.budget ? 'available' : 'exhausted',
      mode: eligibility.policy.budgetMode,
    },
  });
}

function renderWorkflowRevisionObjective(role, objective, reason, packets) {
  const findings = packets.flatMap((packet) => packet.feedback.findings.map((finding) => {
    const anchor = finding.path === null ? ''
      : ` (${finding.path}${finding.line === null ? '' : `:${finding.line}`})`;
    return `- [${finding.severity}/${finding.kind}] ${finding.message}${anchor}`;
  }));
  const rendered = [
    `${role} revision attempt: ${objective}`,
    `Revision direction: ${reason}`,
    ...packets.map((packet) => `Feedback: ${packet.feedback.summary}`),
    ...findings,
  ].join('\n');
  if (!validText(rendered, 64 * 1024) || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(rendered))) {
    throw applicationError('Workflow revision instructions exceed their bounded safe context',
      'application_workflow_revision_invalid');
  }
  return rendered;
}

function applicationDefaults(rawDefaults, profiles) {
  if (rawDefaults === undefined) {
    if (profiles.size !== 1) return deepFreeze({ profile: null, route: null });
    const [profileName, profile] = profiles.entries().next().value;
    return deepFreeze({
      profile: profileName,
      route: profile.routes.length === 1 ? clone(profile.routes[0]) : null,
    });
  }
  exactObject(rawDefaults, ['profile', 'route'], 'application_config_invalid', 'application defaults');
  if (!validId(rawDefaults.profile) || !profiles.has(rawDefaults.profile)
    || (rawDefaults.route !== null
      && !profiles.get(rawDefaults.profile).routes.some((candidate) => routeEqual(candidate, normalizeRoute(rawDefaults.route))))) {
    throw applicationError('application defaults are unavailable', 'application_config_invalid');
  }
  return deepFreeze({
    profile: rawDefaults.profile,
    route: rawDefaults.route === null ? null : clone(normalizeRoute(rawDefaults.route)),
  });
}

function selectExactRouteCard(routeCards, route) {
  const matches = [...routeCards.entries()].filter(([name, card]) => {
    if (name !== route.harness && card?.harness !== route.harness) return false;
    const selection = card?.modelSelection;
    const modelAvailable = selection?.mode === 'exact'
      && (Array.isArray(selection.available)
        ? selection.available.includes(route.model)
        : selection.configuredDefault === route.model
          || selection.acceptedAliases?.includes(route.model) === true
          || selection.acceptedPrefixes?.some((prefix) => route.model.startsWith(prefix)) === true);
    const effortAvailable = Array.isArray(selection?.reasoningEffort)
      && selection.reasoningEffort.includes(route.effort);
    return modelAvailable && effortAvailable;
  });
  return matches.length === 1 ? { name: matches[0][0], card: matches[0][1] } : null;
}

export function validateApplicationCommandArgs(name, args) {
  const definition = APPLICATION_COMMAND_DEFINITIONS[name];
  if (!definition) throw applicationError(`unsupported application command ${name}`, 'application_command_unavailable');
  if (name === 'application.help') {
    const allowed = new Set(definition.args);
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some((key) => !allowed.has(key))
      || (args.topic !== undefined && !validId(args.topic))
      || (args.depth !== undefined && !APPLICATION_SEMANTIC_REGISTRY.depths.includes(args.depth))
      || (args.runId !== undefined && !validId(args.runId))) {
      throw applicationError('application help request is invalid', 'application_help_invalid');
    }
    return true;
  }
  if (name === 'runs.list') {
    exactObject(args, [], 'application_run_list_invalid', 'Run list');
    return true;
  }
  if (name === 'run.inspect') {
    const allowed = new Set(definition.args);
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some((key) => !allowed.has(key)) || !validId(args.runId)
      || (args.depth !== undefined && !APPLICATION_SEMANTIC_REGISTRY.depths.includes(args.depth))
      || (args.section !== undefined && !validId(args.section))
      || (args.item !== undefined && !validId(args.item))
      || (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0))
      || (args.pageCursor !== undefined && (typeof args.pageCursor !== 'string'
        || args.pageCursor.length < 1 || args.pageCursor.length > 4_096
        || !/^[A-Za-z0-9_-]+$/u.test(args.pageCursor)))
      || (args.recipient !== undefined && !validId(args.recipient))
      || (args.cursor !== undefined && (!Number.isSafeInteger(args.cursor) || args.cursor < 0))
      || (args.waitMs !== undefined && (!Number.isSafeInteger(args.waitMs) || args.waitMs <= 0))) {
      throw applicationError('Run inspection request is invalid', 'application_inspect_invalid');
    }
    if (args.waitMs !== undefined && args.cursor === undefined) {
      throw applicationError('Run inspection wait requires a cursor', 'application_inspect_cursor_wait_invalid');
    }
    const depthValue = args.depth ?? 'outline';
    if ((['section', 'item', 'content', 'evidence'].includes(depthValue)
      && args.section === undefined)
      || (['item', 'content', 'evidence'].includes(depthValue) && args.item === undefined)
      || (depthValue !== 'content' && args.offset !== undefined)
      || (depthValue !== 'content' && args.pageCursor !== undefined)
      || (args.recipient !== undefined && !(depthValue === 'content'
        && args.section === 'execution' && args.item === 'execution:output'))
      || (args.pageCursor !== undefined && !(args.section === 'execution'
        && ['execution:events', 'execution:output'].includes(args.item)))
      || (['outline', 'index'].includes(depthValue) && (args.section !== undefined || args.item !== undefined))) {
      throw applicationError('Run inspection selector is invalid', 'application_inspect_invalid');
    }
    return true;
  }
  if (name === 'run.act') {
    exactObject(args, definition.args, 'application_action_invalid', 'Run action');
    if (!validId(args.runId) || !validId(args.actionId) || !args.inputs
      || typeof args.inputs !== 'object' || Array.isArray(args.inputs)) {
      throw applicationError('Run action request is invalid', 'application_action_invalid');
    }
    return true;
  }
  exactObject(args, definition.args, 'application_command_invalid', name);
  if (name === 'run.start') normalizeIntent(args.intent);
  if (name === 'run.status' && !validId(args.runId)) {
    throw applicationError('run id is invalid', 'application_run_invalid');
  }
  if (name === 'run.follow' && (!validId(args.runId)
    || !Number.isSafeInteger(args.afterCursor) || args.afterCursor < 0
    || !Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw applicationError('Run follow request is invalid', 'application_follow_invalid');
  }
  if (name === 'run.approve' && (!validId(args.runId) || !/^[a-f0-9]{64}$/u.test(args.planDigest ?? ''))) {
    throw applicationError('plan approval target is invalid', 'application_approval_invalid');
  }
  if (name === 'run.wait' && (!validId(args.runId) || !Number.isSafeInteger(args.timeoutMs)
    || args.timeoutMs <= 0 || args.timeoutMs > 24 * 60 * 60 * 1000)) {
    throw applicationError('wait target or timeout is invalid', 'application_wait_invalid');
  }
  if (name === 'run.answer') {
    if (!validId(args.runId) || !validText(args.requestId, 4_096)) {
      throw applicationError('Run answer target is invalid', 'application_answer_invalid');
    }
    normalizeAnswer(args.answer);
  }
  if (name === 'run.feedback') {
    if (!validId(args.runId) || !validId(args.role)) {
      throw applicationError('Workflow feedback target is invalid',
        'application_workflow_feedback_invalid');
    }
    normalizeWorkflowFeedback(args.feedback);
  }
  if (name === 'run.steer') normalizeSteer(args);
  if (name === 'run.stop') normalizeStop(args);
  if (name === 'run.evidence' && !validId(args.runId)) {
    throw applicationError('Run evidence target is invalid', 'application_evidence_invalid');
  }
  if (name === 'run.adopt') normalizeAdopt(args);
  if (name === 'run.retry_verification') normalizeRetryVerification(args);
  if (name === 'run.resume_work') normalizeResumeWork(args);
  if (name === 'run.review') normalizeReviewRequest(args);
  if (name === 'run.integrate') normalizeIntegrationRequest(args);
  if (name === 'run.export' && (!validId(args.runId) || !/^[a-f0-9]{64}$/u.test(args.evidenceDigest ?? ''))) {
    throw applicationError('Run export target is invalid', 'application_export_invalid');
  }
  if (name === 'run.recover' && !validId(args.runId)) {
    throw applicationError('Run recovery target is invalid', 'application_recovery_invalid');
  }
  return true;
}

function authority(principal, repoId, runId, power, idempotencyKey) {
  return {
    actor: principal.actor,
    principalId: principal.principalId,
    sessionId: principal.sessionId,
    powers: [power],
    repoId,
    runId,
    idempotencyKey,
  };
}

function refs(goal, plan) {
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    throughSeq: null,
  };
}

function routeEqual(a, b) {
  return a.harness === b.harness && a.model === b.model && a.effort === b.effort;
}

function exactPlanRoutes(route) {
  return {
    schemaVersion: 2,
    allowed: [{ harness: route.harness, model: route.model, effort: route.effort }],
  };
}

function exactPlanNodeRoute(node, label = 'Plan node') {
  const route = planSingleExactRoute(node?.routes);
  if (!route) {
    throw applicationError(`${label} does not select one exact harness/model/effort route`,
      'application_plan_route_ambiguous');
  }
  return route;
}

function exactDispatchRoute(dispatch) {
  const route = dispatch?.route;
  if (!route || typeof route.vendor !== 'string' || typeof route.model !== 'string'
    || typeof route.effort !== 'string') return null;
  return { harness: route.vendor, model: route.model, effort: route.effort };
}

function requestedPlanNodeRoute(node, dispatch = null, label = 'Plan node') {
  return exactDispatchRoute(dispatch) ?? exactPlanNodeRoute(node, label);
}

function projectPlanRouteAuthority(routes) {
  const state = planRouteAuthorityState(routes);
  return {
    mode: state.mode,
    dispatchable: state.dispatchable,
    routeCount: Number.isSafeInteger(state.routeCount)
      ? state.routeCount : state.mode === 'legacy_ambiguous' ? null : state.allowed.length,
    allowed: clone(state.allowed),
    reason: state.reason,
  };
}

const ROUTE_AXES = Object.freeze(['harness', 'model', 'effort']);

export function projectRouteAttestation({ requested, resolved = null, resolvedHarnessVendor, observed = null, phase }) {
  const stopped = phase === 'stopped' || phase === 'stopping' || phase === 'cancelled';
  const terminal = PROVIDER_EXECUTION_SETTLED_PHASES.has(phase);
  const launchEnforcement = Object.fromEntries(ROUTE_AXES.map((axis) => {
    const resolvedValue = resolved?.[axis] ?? null;
    const comparableValue = axis === 'harness'
      ? resolvedHarnessVendor === undefined ? resolvedValue : resolvedHarnessVendor
      : resolvedValue;
    return [axis, {
      requested: requested[axis],
      resolved: resolvedValue,
      state: comparableValue == null ? 'pending'
        : comparableValue === requested[axis] ? 'matched' : 'mismatched',
    }];
  }));
  const providerAttestation = Object.fromEntries(ROUTE_AXES.map((axis) => {
    const observedValue = observed?.[axis] ?? null;
    return [axis, {
      observed: observedValue,
      state: observedValue != null
        ? observedValue === requested[axis] ? 'matched' : 'mismatched'
        : stopped ? 'not_observed_before_stop'
          : terminal ? 'unavailable' : 'pending',
    }];
  }));
  return deepFreeze({ launchEnforcement, providerAttestation });
}

function explicitRouteEvidence(source, { live = false } = {}) {
  if (!source) return { resolved: null, resolvedHarnessVendor: null, observed: null };
  const resolved = (source.harnessResolved != null || source.modelResolved != null || source.effortResolved != null) ? {
    harness: source.harnessResolved ?? null,
    model: source.modelResolved ?? null,
    effort: source.effortResolved ?? null,
  } : null;
  const observed = (source.harnessObserved != null || source.modelObserved != null || source.effortObserved != null) ? {
    harness: source.harnessObserved ?? null,
    model: source.modelObserved ?? null,
    effort: source.effortObserved ?? null,
  } : null;
  return {
    resolved,
    resolvedHarnessVendor: live
      ? source.harnessRequested ?? source.vendor ?? null
      : source.harnessVendor ?? source.harnessRequested ?? source.vendor ?? null,
    observed,
  };
}

export function projectRunRouteEvidence({ requested, liveHandle = null, terminalResult = null, phase }) {
  const evidence = explicitRouteEvidence(terminalResult ?? liveHandle, { live: terminalResult == null });
  if (terminalResult && evidence.resolvedHarnessVendor == null) {
    evidence.resolvedHarnessVendor = liveHandle?.vendor ?? null;
  }
  return deepFreeze({
    requested,
    resolved: evidence.resolved,
    observed: evidence.observed,
    ...projectRouteAttestation({ requested, ...evidence, phase }),
  });
}

function safeScopePath(value) {
  return validText(value) && !value.startsWith('/') && !value.includes('\\')
    && !value.split('/').includes('..');
}

function scopeEntryWithin(requested, allowed) {
  if (!safeScopePath(requested) || !safeScopePath(allowed)) return false;
  if (allowed === '**') return true;
  if (requested === allowed) return true;
  if (!allowed.endsWith('/**')) return false;
  const prefix = allowed.slice(0, -2);
  return requested.startsWith(prefix) && requested.length > prefix.length;
}

function profileConstraint(name, profile) {
  return `Baton deployment profile ${name}@${profile.digest}`;
}

function parseProfileConstraint(constraints) {
  const marker = constraints.find((item) => item.startsWith('Baton deployment profile '));
  if (!marker) return null;
  const value = marker.slice('Baton deployment profile '.length);
  const split = value.lastIndexOf('@');
  if (split <= 0) return null;
  return { name: value.slice(0, split), digest: value.slice(split + 1) };
}

function runNarrative(storyWorkers, runWorkerIds) {
  const rows = Object.entries(storyWorkers).filter(([id]) => runWorkerIds.has(id));
  if (rows.length === 0) return 'No workers active for this Run.';
  const active = rows.filter(([, worker]) => ['working', 'stopping', 'blocked', 'input_required'].includes(worker.status)).length;
  const interrupted = rows.filter(([, worker]) => worker.status === 'interrupted').length;
  const done = rows.filter(([, worker]) => worker.lastVerdict?.accept === true || (worker.status === 'exited' && worker.crashed !== true)).length;
  return `${active} worker(s) active${interrupted > 0 ? `, ${interrupted} interrupted and controllable` : ''}${done > 0 ? `, ${done} done` : ''}.`;
}

function terminalCauseNarrative(cause) {
  if (cause?.kind === 'budget_exceeded') {
    return `Run terminated: ${cause.code} (${cause.dimension} ${cause.used}/${cause.limit}, ratio ${cause.ratio}).`;
  }
  if (cause?.kind === 'provider_failure') return `Run terminated: ${cause.code}.`;
  if (cause?.kind === 'policy_failure') return `Run terminated: ${cause.code}.`;
  if (cause?.kind === 'operator_stop') return 'Run terminated: operator_stop.';
  return null;
}

function runProgress({ phase, approval, node, route, verification, reviewPolicyMode, semanticReview, result, integration, exportResult, resourcesSettled, stop }) {
  const stopped = stop?.state === 'stopped' || phase === 'stopped';
  const failed = ['planning_failed', 'failed', 'denied', 'cancelled'].includes(phase);
  const stage = (key, label, state, detail) => ({ key, label, state, detail });
  const stages = [
    stage('intent', 'Intent compiled', 'complete', 'Goal authority recorded'),
    stage('plan', 'Plan approval', approval?.disposition === 'approved' ? 'complete'
      : approval?.disposition === 'rejected' || phase === 'denied' ? 'failed'
        : phase === 'planning_failed' ? 'blocked' : 'active',
    approval?.disposition === 'approved' ? 'Exact Plan digest approved'
      : approval?.disposition === 'rejected' ? 'Plan rejected' : 'Awaiting distinct approval'),
    stage('dispatch', 'Worker dispatch', stopped && !node?.taskId ? 'stopped'
      : node?.taskId ? 'complete' : approval?.disposition === 'approved' ? 'active' : 'pending',
    node?.taskId ? 'Plan node claimed exactly once' : stopped ? 'Dispatch authority closed' : 'No worker admitted'),
    stage('provider', 'Provider turn', stopped ? 'stopped'
      : ['interrupted', 'interruption_uncertain'].includes(phase) ? 'blocked'
      : node?.state === 'accepted' ? 'complete'
        : node?.state === 'failed' ? 'failed'
          : node?.state === 'cancelled' ? 'stopped'
            : node?.taskId ? 'active' : 'pending',
    phase === 'interrupted' ? 'No provider turn is active; the exact session remains attached and controllable'
      : phase === 'interruption_uncertain'
        ? 'No provider turn is active, but reusable-session attachment is unproven; only whole-Run stop is safe'
      : route?.observed ? 'Provider identity observed'
      : route?.resolved ? 'Route resolved; provider identity pending'
        : node?.taskId ? 'Provider startup pending' : 'Provider not started'),
    stage('verification', 'Fresh verification', ['mechanically_verified', 'mechanically_verified_unstable'].includes(verification?.state) ? 'complete'
      : verification?.state === 'inconclusive' ? 'blocked'
        : verification?.state === 'failed' ? 'failed' : 'pending',
    verification?.state === 'mechanically_verified_unstable'
      ? 'Exact candidate confirmed after an original diagnostic failure; instability is retained.'
      : verification?.state === 'mechanically_verified' ? 'Pinned verification accepted'
      : verification?.state === 'inconclusive' ? 'Verification needs another attempt; the exact candidate is preserved.'
        : verification?.state === 'failed' ? 'Pinned verification failed' : 'No accepted verification yet'),
    stage('semantic_review', 'Independent semantic review', reviewPolicyMode === 'none' ? 'complete'
      : semanticReview?.state === 'semantic_reviewed' ? 'complete'
      : semanticReview?.state === 'revision_required' ? 'blocked'
        : semanticReview?.state === 'review_failed' ? 'failed'
          : ['work_completed', 'reviewing'].includes(phase) ? 'active' : 'pending',
    reviewPolicyMode === 'none' ? 'Review not required by selected profile'
      : semanticReview?.state === 'semantic_reviewed' ? 'Structured findings resolved'
      : semanticReview?.state === 'revision_required' ? 'Grounded correction required'
        : semanticReview?.state === 'review_failed' ? 'Review evidence failed closed validation'
          : semanticReview?.state === 'review_running' ? 'Independent reviewer is active'
            : 'Semantics remain explicitly unverified'),
    stage('result', 'Accepted result', ['adopted', 'integrated'].includes(result?.state) ? 'complete'
      : result?.state === 'accepted' ? 'active'
        : failed || stopped ? 'stopped' : 'pending',
    result?.state === 'integrated' ? 'Reviewed result integrated under explicit authority'
      : result?.state === 'adopted' ? 'Verified commit selected without checkout mutation'
      : result?.state === 'accepted' ? 'Verified commit preserved; adoption available'
        : 'No accepted result'),
    stage('integration', 'Repository integration', integration?.state === 'integrated' ? 'complete'
      : semanticReview?.state === 'revision_required' || semanticReview?.state === 'review_failed' ? 'blocked'
        : semanticReview?.state === 'semantic_reviewed' ? 'active' : 'pending',
    integration?.state === 'integrated' ? `Integrated with ${integration.strategy}`
      : semanticReview?.state === 'semantic_reviewed' ? 'Semantic gate passed; explicit integration available'
        : 'Integration remains gated'),
    stage('export', 'Accepted-result export', exportResult?.state === 'completed' ? 'complete'
      : exportResult?.state === 'pending' ? 'active'
        : exportResult?.state === 'cancelled' ? 'stopped'
        : result?.sha ? 'pending' : failed || stopped ? 'stopped' : 'pending',
    exportResult?.state === 'completed' ? 'Exact accepted Git tree materialized and reverified'
      : exportResult?.state === 'pending' ? 'Durable export admission is reconciling'
        : exportResult?.state === 'cancelled' ? 'Run stop cancelled the pending export authority'
        : result?.sha ? 'Materialized export remains an explicit action' : 'No accepted result to export'),
    stage('cleanup', 'Owned-resource cleanup', resourcesSettled || stop?.receipt?.remainingCount === 0 ? 'complete'
      : stopped ? 'blocked' : node?.taskId ? 'active' : 'pending',
    resourcesSettled || stop?.receipt?.remainingCount === 0 ? 'Processes and disposable resources settled'
      : stopped ? 'Stop admitted; cleanup not yet proven' : 'Lifecycle ownership remains visible'),
  ];
  const current = stages.find((item) => ['active', 'blocked', 'failed'].includes(item.state))
    ?? stages.find((item) => item.state === 'pending') ?? stages.at(-1);
  return {
    current: current.key,
    summary: `${current.label}: ${current.detail}`,
    stages,
  };
}

function projectedCleanupState(view) {
  return view.stop?.state
    ?? view.progress?.stages?.find((stage) => stage.key === 'cleanup')?.state
    ?? 'pending';
}

function runWorkerOwnership(driver, runId) {
  const workers = driver.coordinator.list()
    .filter((handle) => driver.coordination.task(handle.taskId)?.runId === runId);
  if (workers.length > MAX_RUN_VIEW_WORKERS) {
    throw applicationError('Run worker projection exceeds its bounded view ceiling', 'application_run_view_oversize');
  }
  const ownershipProjection = driver.coordinator.localResourceOwnership;
  const ownedWorkers = workers.filter((handle) => {
    // Compatibility with narrow test doubles is conservative: without the explicit authority
    // projection a visible handle remains owned. Production Coordinators never infer ownership
    // from replayed worktree/process coordinates.
    if (typeof ownershipProjection !== 'function') return true;
    const ownership = ownershipProjection.call(driver.coordinator, handle.id);
    if (!ownership || typeof ownership.owned !== 'boolean') {
      throw applicationError('Coordinator worker ownership projection is invalid', 'application_config_invalid');
    }
    return ownership.owned;
  });
  return { workers, ownedWorkers };
}

function sessionAttachmentUnproven(handle) {
  return Boolean(handle?.sessionRef)
    && handle.controllableAttached !== true
    && ['orphaned', 'exited', 'dead'].includes(handle.status)
    && (handle.status === 'orphaned' || handle.sessionPreservation?.state === 'preserved');
}

function publicArtifact(artifact) {
  const active = artifact.supersededBy === null && !Object.hasOwn(artifact, 'acceptanceInvalidation');
  return {
    id: artifact.id,
    digest: artifact.digest,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    accepted: artifact.accepted === true && active,
    state: !active ? (artifact.supersededBy ? 'superseded' : 'invalidated') : 'active',
    ...(artifact.stability === 'passed_after_candidate_failure'
      ? { stability: artifact.stability } : {}),
    provenance: (artifact.provenance ?? []).filter((ref) => Number.isSafeInteger(ref?.coordinationSeq))
      .map((ref) => ({ coordinationSeq: ref.coordinationSeq })).sort((a, b) => a.coordinationSeq - b.coordinationSeq),
  };
}

function adoptionState(adoption) {
  if (!adoption) return null;
  if (adoption.status === 'adopted' || adoption.state === 'adopted' || adoption.receipt?.state === 'adopted') return 'adopted';
  return 'adopting';
}

function semanticSourceSlice(text, source) {
  const fields = ['path', 'startLine', 'startColumn', 'endLine', 'endColumn', 'contentDigest'];
  exactObject(source, fields, 'application_review_report_invalid', 'semantic finding source');
  if (!safeScopePath(source.path) || !/^[a-f0-9]{64}$/u.test(source.contentDigest ?? '')
    || ![source.startLine, source.startColumn, source.endLine, source.endColumn]
      .every((value) => Number.isSafeInteger(value) && value > 0)
    || source.endLine < source.startLine
    || (source.endLine === source.startLine && source.endColumn < source.startColumn)) {
    throw applicationError('semantic finding source range is invalid', 'application_review_report_invalid');
  }
  const lines = text.split('\n');
  if (source.startLine > lines.length || source.endLine > lines.length) {
    throw applicationError('semantic finding source range is stale', 'application_review_anchor_stale');
  }
  const selected = [];
  for (let lineNumber = source.startLine; lineNumber <= source.endLine; lineNumber += 1) {
    const points = Array.from(lines[lineNumber - 1]);
    const start = lineNumber === source.startLine ? source.startColumn - 1 : 0;
    const end = lineNumber === source.endLine ? source.endColumn - 1 : points.length;
    if (start > points.length || end > points.length || end < start) {
      throw applicationError('semantic finding source columns are stale', 'application_review_anchor_stale');
    }
    selected.push(points.slice(start, end).join(''));
  }
  return selected.join('\n');
}

/**
 * One run-centric application facade over Baton's existing durable authorities.
 * It derives Goal/Plan coordinates and authoritative Briefs; it does not replace them.
 */
export class BatonApplication {
  constructor(options) {
    const optionalConfiguration = ['context', 'exportRoot', 'exportDeliveryChunkBytes', 'defaults', 'clock']
      .filter((field) => Object.hasOwn(options ?? {}, field));
    exactObject(options, ['driver', 'repoId', 'profiles', 'principals', 'authorize', ...optionalConfiguration],
    'application_config_invalid', 'application configuration');
    if (!options.driver?.coordinator || !options.driver?.coordination || !options.driver?.story
      || typeof options.driver.drainAndClose !== 'function' || !validId(options.repoId)
      || typeof options.authorize !== 'function') {
      throw applicationError('application driver configuration is invalid', 'application_config_invalid');
    }
    exactObject(options.principals, ['planner', 'dispatcher', 'observer'], 'application_config_invalid', 'application principals');
    if (!options.profiles || typeof options.profiles !== 'object' || Array.isArray(options.profiles)
      || Object.keys(options.profiles).length === 0 || Object.keys(options.profiles).length > MAX_PROFILES) {
      throw applicationError('application profiles are invalid', 'application_config_invalid');
    }
    this.driver = options.driver;
    this.repoId = options.repoId;
    this.authorize = options.authorize;
    this._clock = options.clock ?? (() => new Date().toISOString());
    if (typeof this._clock !== 'function') {
      throw applicationError('application clock is invalid', 'application_config_invalid');
    }
    this.context = null;
    if (options.context !== undefined) {
      exactObject(options.context, ['materializeCallResult', 'openSession', 'principal'], 'application_config_invalid',
        'application Context configuration');
      if (typeof options.context.openSession !== 'function'
        || typeof options.context.materializeCallResult !== 'function') {
        throw applicationError('application Context runtime is invalid', 'application_config_invalid');
      }
      this.context = deepFreeze({
        openSession: options.context.openSession,
        materializeCallResult: options.context.materializeCallResult,
        principal: normalizePrincipal(options.context.principal, 'Context service principal'),
      });
    }
    this.principals = deepFreeze({
      planner: normalizePrincipal(options.principals.planner, 'planner principal'),
      dispatcher: normalizePrincipal(options.principals.dispatcher, 'dispatcher principal'),
      observer: normalizePrincipal(options.principals.observer, 'observer principal'),
    });
    this.profiles = new Map(Object.entries(options.profiles).map(([name, profile]) => [name, normalizeProfile(name, profile, this.repoId)]));
    this._profileRegistry = new Map();
    this._profileRegistrySupported = typeof this.driver.coordination.events === 'function'
      && typeof this.driver.coordination.recordDriver === 'function';
    if (this._profileRegistrySupported) this._loadProfileRegistry();
    this.defaults = applicationDefaults(options.defaults, this.profiles);
    this.exportDeliveryChunkBytes = options.exportDeliveryChunkBytes ?? 64 * 1_024;
    if (!Number.isSafeInteger(this.exportDeliveryChunkBytes) || this.exportDeliveryChunkBytes <= 0) {
      throw applicationError('application export delivery chunk ceiling is invalid', 'application_config_invalid');
    }
    const exportEnabled = [...this.profiles.values()].some((profile) => profile.exportPolicy.mode === 'manual');
    if (exportEnabled) {
      if (typeof this.driver.coordinator.materializeAcceptedResult !== 'function') {
        throw applicationError('application driver lacks result-export authority', 'application_config_invalid');
      }
      for (const method of ['runResultExport', 'pendingRunResultExports', 'admitRunResultExport', 'completeRunResultExport']) {
        if (typeof this.driver.coordination[method] !== 'function') {
          throw applicationError(`application driver lacks ${method} authority`, 'application_config_invalid');
        }
      }
      try {
        const root = identifyResultExportRoot(options.exportRoot);
        this.exportRoot = root.root;
        this.exportRootDigest = root.identityDigest;
      }
      catch (cause) {
        throw Object.assign(applicationError('application result-export root is invalid', 'application_export_root_invalid'), { cause });
      }
    } else {
      if (options.exportRoot !== undefined) {
        try {
          const root = identifyResultExportRoot(options.exportRoot);
          this.exportRoot = root.root;
          this.exportRootDigest = root.identityDigest;
        }
        catch (cause) {
          throw Object.assign(applicationError('application result-export root is invalid', 'application_export_root_invalid'), { cause });
        }
      } else {
        this.exportRoot = null;
        this.exportRootDigest = null;
      }
    }
    if (typeof this.driver.coordinator.routeCards !== 'function') {
      throw applicationError('application driver lacks route-card projection', 'application_config_invalid');
    }
    const routeCards = new Map(this.driver.coordinator.routeCards().map((row) => [row.name, row.card]));
    this._routeCards = routeCards;
    for (const [profileName, profile] of this.profiles) {
      for (const route of [...profile.routes, ...profile.reviewPolicy.routes]) {
        if (!selectExactRouteCard(routeCards, route)) {
          throw applicationError(`profile ${profileName} contains an unavailable exact route`, 'application_profile_route_unavailable');
        }
      }
    }
    this.resultExportLifecycle = this.exportRoot ? new ResultExportLifecycle(this.exportRoot) : null;
    this._closed = null;
    this._closing = null;
    this._detached = false;
    this._runStopPromises = new Map();
    this._workflowMemberStopPromises = new Map();
    this._runAdoptionPromises = new Map();
    this._runExportPromises = new Map();
    this._runRetryPromises = new Map();
    this._runRetryControllers = new Map();
    this._contextControllers = new Map();
    this._runEffectChains = new Map();
    this._runDeliveryRegistrations = new Map();
    this._semanticReviewPromises = new Map();
    this._followControllers = new Set();
    this.ready = Promise.resolve().then(() => this._reconcileProfileRegistry())
      .then(() => this._reconcileRunStops())
      .then(() => this._reconcileRunControls())
      .then(() => this._reconcileWorkflowMemberStops())
      .then(() => this._reconcileResultExportLifecycle())
      .then(() => this._reconcileResultAdoptions())
      .then(() => this._reconcileRunVerificationRetries())
      .then(() => this._reconcileResultExports()).then(() => this._reconcileApprovedRuns())
      .then(() => this._reconcileSemanticReviews())
      .catch(async (cause) => {
        try { await this.resultExportLifecycle?.close(); } catch { /* readiness cause remains authoritative */ }
        throw cause;
      });
  }

  _loadProfileRegistry() {
    const records = this.driver.coordination.events().filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_PROFILE_RECORD_KIND);
    if (records.length > MAX_RUN_RECORDS) {
      throw applicationError('application profile registry exceeds its bounded lookup ceiling',
        'application_profile_registry_oversize');
    }
    for (const event of records) {
      const registered = normalizeProfileRegistryEvent(event);
      if (registered.repoId !== this.repoId) continue;
      const coordinate = profileRegistryCoordinate(registered.name, registered.profile.digest);
      const prior = this._profileRegistry.get(coordinate);
      if (prior && digest(profileDefinition(prior)) !== digest(profileDefinition(registered.profile))) {
        throw applicationError('application profile registry contains a conflicting definition',
          'application_profile_registry_invalid');
      }
      this._profileRegistry.set(coordinate, registered.profile);
    }
  }

  _reconcileProfileRegistry() {
    if (!this._profileRegistrySupported) {
      return deepFreeze({ schemaVersion: 1, state: 'unsupported', registeredProfiles: 0 });
    }
    let registeredProfiles = 0;
    for (const [name, profile] of this.profiles) {
      const coordinate = profileRegistryCoordinate(name, profile.digest);
      if (this._profileRegistry.has(coordinate)) continue;
      const payload = {
        schemaVersion: 1, repoId: this.repoId, name, profileDigest: profile.digest,
        profileDefinition: profileDefinition(profile),
      };
      const recorded = this.driver.coordination.recordDriver(APPLICATION_PROFILE_RECORD_KIND, payload, {
        actor: APPLICATION_PROFILE_RECORD_ACTOR,
        key: profileRegistryKey(this.repoId, name, profile.digest),
      });
      const normalized = normalizeProfileRegistryEvent(recorded.event);
      this._profileRegistry.set(coordinate, normalized.profile);
      registeredProfiles += 1;
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', registeredProfiles });
  }

  _withRunEffect(runId, operation) {
    this._assertOpen();
    const prior = this._runEffectChains.get(runId) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(operation);
    const settled = current.finally(() => {
      if (this._runEffectChains.get(runId) === settled) this._runEffectChains.delete(runId);
    });
    this._runEffectChains.set(runId, settled);
    return settled;
  }

  _semanticControlTargets(current) {
    const definition = this._isWorkflowRun(current) ? this._workflowDefinition(current) : null;
    const dispatches = definition
      ? (this.driver.coordination.snapshot().goalPlan?.dispatches ?? []) : [];
    const rows = this.driver.coordinator.list().filter((worker) => (
      worker.runId === current.goal.runId
      && Number.isSafeInteger(worker.fence)
      && ['working', 'blocked', 'interrupted'].includes(worker.status)
    )).map((worker) => {
      const task = this.driver.coordination.task(worker.taskId);
      const dispatch = dispatches.find((candidate) => candidate.taskId === worker.taskId);
      const nodeKey = dispatch?.binding?.nodeKey ?? null;
      const role = definition?.attempts.find((attempt) => attempt.nodeKey === nodeKey)?.role ?? null;
      return { worker, task, nodeKey, role };
    }).filter((row) => row.task?.runId === current.goal.runId);
    const recipientsFor = (eligible) => {
      const recipients = [...new Set(eligible.map((row) => row.role).filter(Boolean))].sort();
      const work = eligible.find((row) => row.role === 'work')
        ?? (eligible.length === 1 ? eligible[0] : null);
      if (work && !recipients.includes('work')) recipients.unshift('work');
      return { recipients, work };
    };
    const send = recipientsFor(rows);
    const interrupt = recipientsFor(rows.filter((row) => (
      ['working', 'blocked'].includes(row.worker.status)
      && row.worker.sessionPreservationCapable === true
    )));
    return {
      rows, recipients: send.recipients, work: send.work,
      sendRecipients: send.recipients, sendWork: send.work,
      interruptRecipients: interrupt.recipients, interruptWork: interrupt.work,
    };
  }

  _resolveSemanticControlTarget(current, recipient, operation) {
    const targets = this._semanticControlTargets(current);
    const eligible = operation === 'interrupt'
      ? targets.rows.filter((row) => ['working', 'blocked'].includes(row.worker.status)
        && row.worker.sessionPreservationCapable === true)
      : targets.rows;
    const row = recipient === 'work'
      ? (operation === 'interrupt' ? targets.interruptWork : targets.sendWork)
      : eligible.find((candidate) => candidate.role === recipient);
    if (!row) {
      throw applicationError(
        recipient === 'work' && eligible.length > 1
          ? 'Run work recipient is ambiguous; select an advertised workflow role'
          : 'Run control recipient is unavailable',
        recipient === 'work' && eligible.length > 1
          ? 'application_control_recipient_ambiguous'
          : 'application_control_recipient_unavailable',
      );
    }
    return {
      workerId: row.worker.id,
      taskId: row.task.id,
      fence: row.worker.fence,
      role: row.role,
      activeCount: targets.rows.length,
      turnEpoch: row.worker.turnEpoch,
      turnState: row.worker.status,
      sessionDigest: row.worker.semanticControlBinding?.sessionDigest ?? null,
      preservationReceiptDigest: row.worker.status === 'interrupted'
        ? row.worker.sessionPreservation?.receiptDigest ?? null : null,
      processGeneration: row.worker.semanticControlBinding?.processGeneration ?? 0,
      worktreeDigest: row.worker.semanticControlBinding?.worktreeDigest ?? digest(null),
      routeDigest: row.worker.semanticControlBinding?.routeDigest ?? digest(null),
      planBindingDigest: row.worker.semanticControlBinding?.planBindingDigest ?? digest(null),
      runAuthorityDigest: row.worker.semanticControlBinding?.runAuthorityDigest ?? digest(null),
    };
  }

  _runControls(runId = null) {
    if (runId === null) return this.driver.coordination.pendingRunControls(100_000);
    return this.driver.coordination.runControls(runId, 100_000);
  }

  _controlOperationalState(control) {
    const workerEvents = this.driver.log.read(control.target.workerId);
    const events = workerEvents.filter((event) => event.payload?.controlId === control.controlId);
    const confirmed = control.operation === 'send'
      ? events.find((event) => ['control.nudge', 'control.steer', 'control.send']
        .includes(event.kind)
        || (event.kind === 'lifecycle.turn_started' && event.payload?.followUp === true))
      : events.find((event) => event.kind === 'control.interrupt_confirmed');
    if (confirmed) {
      if (control.operation === 'interrupt' && control.turnDisposition === 'preserve_turn') {
        const preservation = confirmed.payload?.preservation ?? null;
        const handle = this.driver.coordinator.list().find((candidate) => (
          candidate.id === control.target.workerId
          && candidate.taskId === control.target.taskId
          && candidate.controllableAttached === true
          && candidate.sessionPreservation?.receiptDigest === preservation?.receiptDigest
        ));
        const closedAfter = workerEvents.some((event) => (
          event.seq > confirmed.seq && event.kind === 'lifecycle.process_closed'
        ));
        if (!preservation || !handle || closedAfter) {
          return {
            state: 'outcome_unknown', result: 'session_preservation_unproven',
            code: closedAfter ? 'transport_closed_after_interrupt'
              : 'session_reattachment_unproven',
          };
        }
        return {
          state: 'confirmed', result: 'confirmed', code: null,
          preservation,
        };
      }
      return {
        state: 'confirmed', result: 'confirmed', code: null,
        actualDelivery: control.operation === 'send'
          ? confirmed.payload?.continuation ? 'turn' : control.delivery : null,
        continuation: confirmed.payload?.continuation ?? null,
      };
    }
    const refused = events.find((event) => event.kind === 'control.delivery_refused'
      || (event.kind === 'control.stale_rejected' && event.payload?.phase === 'pre_delivery'));
    if (refused) {
      return {
        state: 'refused', result: refused.payload?.result ?? 'refused',
        code: refused.kind === 'control.stale_rejected' ? 'stale_fence' : null,
      };
    }
    const amended = events.find((event) => event.kind === 'control.delivery_amended'
      || (event.kind === 'control.stale_rejected' && event.payload?.phase === 'post_delivery'));
    if (amended) {
      return {
        state: 'outcome_unknown', result: 'delivered_despite_stale',
        code: 'stale_after_provider_boundary', deliveredDespiteStale: true,
      };
    }
    const boundary = events.find((event) => [
      'control.delivery_requested', 'control.follow_up_requested',
      'control.interrupt_requested',
    ].includes(event.kind));
    return boundary
      ? { state: 'outcome_unknown', result: 'provider_outcome_unknown', code: 'provider_boundary_observed' }
      : null;
  }

  _normalizeRunControlOutcome(outcome, schemaVersion = 2) {
    const base = {
      result: validText(outcome?.result, 256) ? outcome.result : 'provider_outcome_unknown',
      code: validText(outcome?.code, 256) ? outcome.code : null,
      emulated: outcome?.emulated === true,
      deliveredDespiteStale: outcome?.deliveredDespiteStale === true,
    };
    if (schemaVersion < 2) return base;
    return {
      ...base,
      actualDelivery: ['nudge', 'now', 'turn'].includes(outcome?.actualDelivery)
        ? outcome.actualDelivery : null,
      preservation: outcome?.preservation ? clone(outcome.preservation) : null,
      continuation: outcome?.continuation ? clone(outcome.continuation) : null,
    };
  }

  _beginRunControlEffect(control) {
    const providerRequestId = `provider-control:${digest({
      controlId: control.controlId,
      targetDigest: control.targetDigest,
      admittedEvent: control.admittedEvent,
    })}`;
    const core = {
      schemaVersion: control.schemaVersion, controlId: control.controlId,
      admissionDigest: control.admissionDigest,
      targetDigest: control.targetDigest,
      providerRequestId,
      ...(control.schemaVersion >= 2 ? { turnDisposition: control.turnDisposition } : {}),
    };
    return this.driver.coordination.beginRunControlEffect({
      ...core, effectDigest: digest(core),
    }, {
      actor: control.source.actor,
      key: `run.control.begin:${control.controlId}`,
    }).control;
  }

  _acknowledgeRunControl(control, state, outcome) {
    const normalized = this._normalizeRunControlOutcome(outcome, control.schemaVersion);
    const core = {
      schemaVersion: control.schemaVersion, controlId: control.controlId,
      effectDigest: control.effect.effectDigest,
      providerRequestId: control.effect.providerRequestId,
      state, outcome: normalized,
    };
    return this.driver.coordination.acknowledgeRunControl({
      ...core, ackDigest: digest(core),
    }, {
      actor: control.source.actor,
      key: `run.control.ack:${control.controlId}`,
    }).control;
  }

  _settleRunControl(control, state, outcome) {
    const existing = this._runControls(control.runId)
      .find((candidate) => candidate.controlId === control.controlId);
    if (!['admitted', 'provider_acked'].includes(existing?.status)) return existing;
    const normalized = this._normalizeRunControlOutcome(outcome, control.schemaVersion);
    const core = {
      schemaVersion: control.schemaVersion, repoId: control.repoId, runId: control.runId,
      controlId: control.controlId, operation: control.operation,
      admissionDigest: control.admissionDigest, state, outcome: normalized,
    };
    this.driver.coordination.settleRunControl({
      ...core, settlementDigest: digest(core),
    }, {
      actor: control.source.actor,
      key: `run.control.settle:${control.controlId}`,
    });
    return this._runControls(control.runId)
      .find((candidate) => candidate.controlId === control.controlId);
  }

  async _executeRunControl(control, { recovery = false } = {}) {
    let current = this._runControls(control.runId)
      .find((candidate) => candidate.controlId === control.controlId) ?? control;
    if (['confirmed', 'refused', 'outcome_unknown'].includes(current.status)) return current;
    if (current.status === 'provider_acked') {
      return this._settleRunControl(
        current, current.providerAck.state, current.providerAck.outcome,
      );
    }
    if (current.status === 'effect_started') {
      const observed = this._controlOperationalState(current) ?? {
        state: 'outcome_unknown', result: 'provider_outcome_unknown',
        code: 'effect_started_without_conclusive_provider_evidence',
      };
      current = this._acknowledgeRunControl(current, observed.state, observed);
      return this._settleRunControl(
        current, current.providerAck.state, current.providerAck.outcome,
      );
    }
    if (this.driver.coordination.runStop?.(current.runId)) {
      return this._settleRunControl(current, 'refused', {
        result: 'run_stopping', code: 'run_stopping',
      });
    }
    if (current.schemaVersion >= 2) {
      let liveTarget = null;
      try {
        liveTarget = this._resolveSemanticControlTarget(
          this._findRun(current.runId, { allowUnavailableProfile: true }),
          current.recipient, current.operation,
        );
      } catch { /* a disappeared recipient is target drift */ }
      if (!liveTarget || digest(liveTarget) !== current.targetDigest
        || digest(liveTarget) !== digest(current.target)) {
        return this._settleRunControl(current, 'refused', {
          result: 'semantic_target_drift', code: 'application_control_target_drift',
        });
      }
    }
    const handle = this.driver.coordinator.list().find((candidate) => (
      candidate.id === current.target.workerId && candidate.runId === current.runId
      && candidate.taskId === current.target.taskId && candidate.fence === current.target.fence
    ));
    if (!handle) {
      return this._settleRunControl(current, 'refused', {
        result: recovery ? 'recipient_not_attached' : 'recipient_replaced',
        code: recovery ? 'application_control_recipient_not_attached'
          : 'application_control_recipient_replaced',
      });
    }
    try {
      current = this._beginRunControlEffect(current);
    } catch (error) {
      if (error?.code === 'run_stopping') {
        return this._settleRunControl(current, 'refused', {
          result: 'run_stopping', code: 'run_stopping',
        });
      }
      throw error;
    }
    let result;
    try {
      result = current.operation === 'send'
        ? await this.driver.coordinator.send(
          current.target.workerId, current.message,
          current.delivery === 'now' ? 'steer' : current.delivery,
          {
            expectedFence: current.target.fence,
            actor: current.source.actor,
            controlId: current.controlId,
            resumePreservedTurn: current.target.turnState === 'interrupted',
            semanticTarget: current.schemaVersion >= 2 ? current.target : undefined,
            semanticTargetDigest: current.schemaVersion >= 2 ? current.targetDigest : undefined,
          },
        )
        : await this.driver.coordinator.interrupt(
          current.target.workerId, undefined, current.source.actor,
          {
            expectedFence: current.target.fence, controlId: current.controlId,
            preserveTurn: current.turnDisposition === 'preserve_turn',
            semanticTarget: current.schemaVersion >= 2 ? current.target : undefined,
            semanticTargetDigest: current.schemaVersion >= 2 ? current.targetDigest : undefined,
          },
        );
    } catch (error) {
      const after = this._controlOperationalState(current);
      const outcome = after ?? {
        state: 'outcome_unknown', result: 'provider_outcome_unknown',
        code: error?.code ?? 'provider_control_failed',
      };
      current = this._acknowledgeRunControl(current, outcome.state, outcome);
      return this._settleRunControl(
        current, current.providerAck.state, current.providerAck.outcome,
      );
    }
    const state = result?.ok === true
      && (current.operation === 'send' ? result.result === 'ok' : result.result === 'confirmed')
      ? 'confirmed'
      : result?.deliveredDespiteStale === true ? 'outcome_unknown' : 'refused';
    current = this._acknowledgeRunControl(current, state, {
      result: result?.result ?? (state === 'confirmed' ? 'confirmed' : 'refused'),
      code: result?.reason ?? null,
      emulated: result?.emulated === true,
      deliveredDespiteStale: result?.deliveredDespiteStale === true,
      actualDelivery: result?.actualDelivery
        ?? (current.operation === 'send' ? current.delivery : null),
      preservation: result?.preservation ?? null,
      continuation: result?.continuation ?? null,
    });
    return this._settleRunControl(
      current, current.providerAck.state, current.providerAck.outcome,
    );
  }

  async _reconcileRunControls() {
    const methods = [
      'runControl', 'runControls', 'pendingRunControls', 'admitRunControl',
      'beginRunControlEffect', 'acknowledgeRunControl', 'settleRunControl',
    ];
    const available = methods.filter((method) => (
      typeof this.driver.coordination[method] === 'function'
    ));
    // Compatibility-only deployments that have never admitted durable Run control do not
    // need to fabricate that authority just to expose read-only application/card surfaces.
    // Any partial authority, or any durable control history without its recovery methods,
    // still fails closed before application readiness.
    const hasControlHistory = typeof this.driver.coordination.events === 'function'
      && this.driver.coordination.events().some((event) => (
        typeof event?.kind === 'string' && event.kind.startsWith('run.control_')
      ));
    if (available.length === 0 && !hasControlHistory) {
      return deepFreeze({ schemaVersion: 1, state: 'not_configured', controls: 0 });
    }
    if (available.length !== methods.length) {
      throw applicationError('application driver lacks durable Run control authority',
        'application_config_invalid');
    }
    const pending = this._runControls();
    const failures = [];
    for (const control of pending) {
      try {
        await this._withRunEffect(control.runId,
          () => this._executeRunControl(control, { recovery: true }));
      } catch (error) {
        failures.push({ controlId: control.controlId, code: error?.code ?? 'application_control_incomplete' });
      }
    }
    if (failures.length > 0) {
      throw Object.assign(applicationError('Run control reconciliation is incomplete',
        'application_control_incomplete'), { failures });
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', controls: pending.length });
  }

  _runControlView(current, settled) {
    return this._buildView(current, this.principals.observer, {
      action: {
        command: `run.${settled.operation}`,
        recipient: settled.recipient,
        delivery: settled.delivery,
        result: settled.settlement.outcome.result,
        state: settled.status,
        emulated: settled.settlement.outcome.emulated,
        deliveredDespiteStale: settled.settlement.outcome.deliveredDespiteStale,
        actualDelivery: settled.settlement.outcome.actualDelivery,
        sessionPreserved: settled.settlement.outcome.preservation?.state === 'preserved',
        continuation: settled.settlement.outcome.continuation?.state ?? null,
        onlyActiveMember: settled.target.activeCount === 1,
        needsAttention: false,
      },
    });
  }

  async _replaySemanticControl(current, request, principal, context) {
    if (!context?.idempotencyKey) return null;
    const controlId = `control:${digest({
      repoId: this.repoId,
      runId: current.goal.runId,
      actionId: request.actionId,
      seed: { kind: 'request', value: context.idempotencyKey },
    })}`;
    const control = this._runControls(current.goal.runId)
      .find((candidate) => candidate.controlId === controlId);
    if (!control) return null;
    const definition = APPLICATION_SEMANTIC_REGISTRY.actions[control.operation];
    const semanticAuthority = semanticAuthorityForAction({
      actionId: request.actionId,
      kind: control.operation,
      effect: definition.effect,
      requiredCapabilities: definition.requiredCapabilities,
    });
    await this._authorizeSemanticAuthority(semanticAuthority, principal, request.runId, context);
    const recipient = request.inputs.recipient ?? definition.inputSchema.properties.recipient.default;
    const delivery = control.operation === 'send'
      ? (request.inputs.delivery ?? definition.inputSchema.properties.delivery.default) : null;
    const message = control.operation === 'send' ? request.inputs.message : null;
    const reason = control.operation === 'interrupt'
      ? (request.inputs.reason ?? definition.inputSchema.properties.reason.default)
      : 'Send Run guidance.';
    if (recipient !== control.recipient || delivery !== control.delivery
      || message !== control.message || digest(reason) !== control.reasonDigest
      || principal.actor !== control.source.actor
      || principal.principalId !== control.source.principalId
      || principal.sessionId !== control.source.sessionId) {
      throw applicationError('Run control replay conflicts with its durable admission',
        'application_control_conflict');
    }
    const settled = control.status === 'admitted'
      ? await this._withRunEffect(control.runId,
        () => this._executeRunControl(control, { recovery: true }))
      : control;
    return this._runControlView(current, settled);
  }

  async _performSemanticControl(current, action, inputs, principal, context) {
    const operation = action.kind;
    const recipient = inputs.recipient ?? action.inputSchema.properties.recipient.default;
    const delivery = operation === 'send'
      ? (inputs.delivery ?? action.inputSchema.properties.delivery.default) : null;
    const message = operation === 'send' ? inputs.message : null;
    const reason = operation === 'interrupt'
      ? (inputs.reason ?? action.inputSchema.properties.reason.default) : 'Send Run guidance.';
    if (!action.choices.includes(recipient)
      || (operation === 'send' && (!validText(message, 16_384)
        || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(message))
        || !['nudge', 'now', 'turn'].includes(delivery)))
      || !validText(reason, 1_024)) {
      throw applicationError('Run control inputs are invalid', 'application_action_input_invalid');
    }
    this._assertRunMutable(current.goal.runId);
    let target = this._resolveSemanticControlTarget(current, recipient, operation);
    if (operation === 'interrupt' && target.turnState === 'blocked') {
      const prepared = await this.driver.coordinator.prepareSemanticInterrupt(
        target.workerId, principal.actor,
      );
      if (prepared?.ok !== true) {
        throw applicationError('Blocked Run interaction could not be superseded for interrupt',
          'application_control_interaction_resolution_failed');
      }
      // Resolve the interaction first, then bind the semantic admission to the resulting exact
      // durable task generation. No provider interrupt effect has crossed yet.
      current = this._findRun(current.goal.runId, { allowUnavailableProfile: true });
      target = this._resolveSemanticControlTarget(current, recipient, operation);
    }
    const seed = context?.idempotencyKey
      ? { kind: 'request', value: context.idempotencyKey }
      : { kind: 'direct', value: randomUUID() };
    const controlId = `control:${digest({
      repoId: this.repoId, runId: current.goal.runId, actionId: action.actionId, seed,
    })}`;
    const source = {
      actor: principal.actor, principalId: principal.principalId, sessionId: principal.sessionId,
    };
    const core = {
      schemaVersion: 2, repoId: this.repoId, runId: current.goal.runId,
      controlId, actionId: action.actionId, operation, recipient, delivery, message,
      turnDisposition: operation === 'interrupt' ? 'preserve_turn' : null,
      messageDigest: message === null ? null : digest(message), reasonDigest: digest(reason),
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest, source, target,
      targetDigest: digest(target),
      requestDigest: digest({
        actionId: action.actionId, operation, recipient, delivery, message,
        turnDisposition: operation === 'interrupt' ? 'preserve_turn' : null,
        reasonDigest: digest(reason), source, target,
        registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      }),
    };
    let control = this._runControls(current.goal.runId)
      .find((candidate) => candidate.controlId === controlId);
    if (control && control.requestDigest !== core.requestDigest) {
      throw applicationError('Run control idempotency identity conflicts',
        'application_control_conflict');
    }
    if (!control) {
      this.driver.coordination.admitRunControl({
        ...core, admissionDigest: digest(core),
      }, {
        actor: principal.actor,
        key: `run.control.admit:${controlId}`,
      });
      control = this._runControls(current.goal.runId)
        .find((candidate) => candidate.controlId === controlId);
    }
    const settled = await this._executeRunControl(control);
    return this._runControlView(current, settled);
  }

  _profile(name) {
    const profile = this.profiles.get(name);
    if (!profile) throw applicationError(`unknown deployment profile ${name}`, 'application_profile_not_found');
    return profile;
  }

  _resolveIntent(rawIntent) {
    const requested = normalizeIntent(rawIntent);
    const profileName = requested.profile ?? this.defaults.profile;
    if (profileName === null) {
      throw applicationError('Run profile is ambiguous; inspect deployment defaults', 'application_profile_ambiguous');
    }
    const profile = this._profile(profileName);
    const selector = requested.route;
    let selectedRoute = null;
    if (selector === null) {
      if (requested.composition) selectedRoute = requested.composition.team[0].route;
      else if (profile.routes.length === 1) selectedRoute = profile.routes[0];
      if (selectedRoute === null) {
        throw applicationError('Run route is ambiguous; select model and effort or inspect advanced routing help', 'application_route_ambiguous');
      }
    } else {
      const matches = profile.routes.filter((candidate) => Object.entries(selector)
        .every(([axis, value]) => candidate[axis] === value));
      if (matches.length === 0) {
        throw applicationError('requested route is outside the deployment profile', 'application_route_not_allowed');
      }
      if (matches.length === 1) selectedRoute = matches[0];
      else {
        throw applicationError('Run route selector is ambiguous; inspect advanced routing help', 'application_route_ambiguous');
      }
    }
    let composition = requested.composition;
    if (composition) {
      for (const member of composition.team) {
        if (!profile.routes.some((candidate) => routeEqual(candidate, member.route))) {
          throw applicationError(`workflow role ${member.role} route is outside the deployment profile`,
            'application_route_not_allowed');
        }
      }
      composition = deepFreeze(clone(composition));
      selectedRoute = composition.team[0].route;
    }
    return deepFreeze({
      ...requested, profile: profileName, route: clone(selectedRoute), composition,
    });
  }

  _assertOpen() {
    if (this._closed) throw applicationError('application is closed', 'application_closed');
    if (this._closing) throw applicationError('application is closing', 'application_closing');
    if (this._detached) throw applicationError('application deployment is detached', 'application_detached');
  }

  async _authorize(command, principal, runId, subject = {}) {
    const allowed = await this.authorize(deepFreeze({
      command,
      principal: clone(principal),
      repoId: this.repoId,
      runId,
      subject: clone(subject),
    }));
    if (allowed !== true) throw applicationError('application command is not authorized', 'application_unauthorized');
  }

  async _authorizeSemanticAuthority(authority, principal, runId, context = null) {
    const normalized = normalizeSemanticAuthority(authority, 'application_action_authority_invalid');
    const definition = APPLICATION_SEMANTIC_REGISTRY.actions[normalized.kind];
    if (!definition || definition.effect !== normalized.effect
      || definition.requiredCapabilities.join('\0') !== normalized.requiredCapabilities.join('\0')) {
      throw applicationError('semantic action authority is outside the registry',
        'application_action_authority_invalid');
    }
    if (context?.capabilityAuthority) {
      if (!context.semanticAuthority
        || context.semanticAuthority.authorityDigest !== normalized.authorityDigest
        || !normalized.requiredCapabilities.every((capability) => context.capabilities.includes(capability))) {
        throw applicationError('semantic action is not authorized', 'application_unauthorized');
      }
    }
    await this._authorize('run.act', principal, runId, {
      actionId: normalized.actionId,
      kind: normalized.kind,
      effect: normalized.effect,
      requiredCapabilities: normalized.requiredCapabilities,
      authorityDigest: normalized.authorityDigest,
    });
    return normalized;
  }

  async _authorizeSemanticKind(kind, principal, runId) {
    const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
    if (!definition) {
      throw applicationError('semantic action kind is outside the registry',
        'application_action_authority_invalid');
    }
    return this._authorizeSemanticAuthority(semanticAuthorityForAction({
      actionId: `direct-${digest({
        schemaVersion: 1, repoId: this.repoId, runId, kind,
        principalId: principal.principalId, sessionId: principal.sessionId,
      })}`,
      kind,
      effect: definition.effect,
      requiredCapabilities: definition.requiredCapabilities,
    }), principal, runId);
  }

  async _resolveSemanticAction(request, principal) {
    const current = this._findRun(request.runId);
    const view = this._withContextProjection(
      current, await this._buildView(current, this.principals.observer),
    );
    const action = this._semanticActions(current, view, principal)
      .find((candidate) => candidate.actionId === request.actionId);
    return { current, view, action: action ?? null };
  }

  async actionAuthority(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    validateApplicationCommandArgs('run.act', rawRequest);
    const request = deepFreeze(clone(rawRequest));
    const principal = normalizePrincipal(rawPrincipal, 'action authority principal');
    await this._authorize('run.status', principal, request.runId, { operation: 'action_authority' });
    const { action } = await this._resolveSemanticAction(request, principal);
    if (!action) {
      throw applicationError('Run action is outside the current authority scope',
        'application_action_scope_mismatch');
    }
    return semanticAuthorityForAction(action);
  }

  async _recheckSemanticAction(current, expected, principal) {
    const view = this._withContextProjection(
      current, await this._buildView(current, this.principals.observer),
    );
    const action = this._semanticActions(current, view, principal)
      .find((candidate) => candidate.actionId === expected.actionId);
    if (!action
      || semanticAuthorityForAction(action).authorityDigest !== expected.authorityDigest) {
      throw applicationError('Run action authority changed before effect',
        'application_action_scope_mismatch');
    }
    return action;
  }

  async authorizeReplay(name, args, rawPrincipal, rawContext = null) {
    this._assertOpen();
    validateApplicationCommandArgs(name, args);
    const principal = normalizePrincipal(rawPrincipal, 'replay principal');
    const context = normalizeCommandContext(rawContext);
    if (context?.sessionAuthority && name === 'runs.list') {
      throw applicationError('recursive Run catalog access is forbidden',
        'run_orchestrator_command_forbidden');
    }
    if (context?.sessionAuthority && name !== 'run.start' && name !== 'application.help') {
      const recursiveCommand = ['run.status', 'run.inspect', 'run.wait', 'run.follow'].includes(name)
        ? 'run.status' : name;
      this._authorizeRecursiveCommand(recursiveCommand, args.runId, principal, context);
    }
    if (name === 'run.start') {
      const intent = this._resolveIntent(args.intent);
      const profile = this._profile(intent.profile);
      const scope = intent.scope ?? clone(profile.pathScope);
      const runId = intent.runId ?? `run-${digest({
        objective: intent.objective,
        profileDigest: profile.digest,
        route: intent.route,
        composition: intent.composition,
        scope,
        ownerPrincipalId: principal.principalId,
      }).slice(0, 32)}`;
      await this._authorize(name, principal, runId, {
        objectiveDigest: digest(intent.objective), profile: intent.profile, route: intent.route,
        compositionDigest: intent.composition ? digest(intent.composition) : null, scope,
      });
      this._authorizeRecursiveCommand('run.start', runId, principal, context);
      return true;
    }
    if (name === 'run.act') {
      const authority = context?.semanticAuthority
        ?? await this.actionAuthority(args, principal);
      if (authority.actionId !== args.actionId) {
        throw applicationError('semantic replay authority does not match action',
          'application_action_authority_invalid');
      }
      await this._authorizeSemanticAuthority(authority, principal, args.runId, context);
      return true;
    }
    if (name === 'run.approve') {
      await this._authorize(name, principal, args.runId, { planDigest: args.planDigest });
      return true;
    }
    if (name === 'run.answer') {
      const answer = normalizeAnswer(args.answer);
      await this._authorize(name, principal, args.runId, { requestId: args.requestId, answerKind: Object.keys(answer)[0] });
      return true;
    }
    if (name === 'run.steer') {
      const request = normalizeSteer(args);
      await this._authorize(name, principal, request.runId, {
        target: request.target,
        mode: request.mode,
        messageDigest: digest(request.message),
        reasonDigest: digest(request.reason),
      });
      return true;
    }
    if (name === 'run.stop') {
      const request = normalizeStop(args);
      await this._authorize(name, principal, request.runId, { reasonDigest: digest(request.reason) });
      return true;
    }
    if (name === 'run.adopt') {
      const request = normalizeAdopt(args);
      await this._authorize(name, principal, request.runId, {
        nodeKey: request.nodeKey, resultSha: request.resultSha,
        evidenceDigest: request.evidenceDigest, reasonDigest: digest(request.reason),
      });
      return true;
    }
    if (name === 'run.retry_verification') {
      const request = normalizeRetryVerification(args);
      await this._authorize(name, principal, request.runId, { reasonDigest: digest(request.reason) });
      return true;
    }
    if (name === 'run.resume_work') {
      const request = normalizeResumeWork(args);
      await this._authorize(name, principal, request.runId, { reasonDigest: digest(request.reason) });
      return true;
    }
    if (name === 'run.review') {
      const request = normalizeReviewRequest(args);
      await this._authorize(name, principal, request.runId, {
        route: request.route, reasonDigest: digest(request.reason),
      });
      return true;
    }
    if (name === 'run.integrate') {
      const request = normalizeIntegrationRequest(args);
      await this._authorize(name, principal, request.runId, {
        evidenceDigest: request.evidenceDigest, strategy: request.strategy, reasonDigest: digest(request.reason),
      });
      return true;
    }
    if (name === 'run.export') {
      await this._authorize(name, principal, args.runId, { evidenceDigest: args.evidenceDigest });
      return true;
    }
    if (name === 'run.recover') {
      await this._authorize(name, principal, args.runId, {});
      return true;
    }
    await this._authorize(name === 'run.wait' ? 'run.status' : name, principal, args.runId, {});
    return true;
  }

  _findRun(runId, { allowUnavailableProfile = false } = {}) {
    const snapshot = this.driver.coordination.snapshot();
    const goalPlan = snapshot.goalPlan;
    if (!goalPlan || goalPlan.goals.length > MAX_RUN_RECORDS || goalPlan.plans.length > MAX_RUN_RECORDS
      || goalPlan.approvals.length > MAX_RUN_RECORDS || goalPlan.dispatches.length > MAX_RUN_RECORDS) {
      throw applicationError('application run projection exceeds its bounded lookup ceiling', 'application_run_lookup_oversize');
    }
    const goals = goalPlan.goals.filter((goal) => goal.repoId === this.repoId && goal.runId === runId)
      .sort((a, b) => b.version - a.version);
    const goal = goals[0];
    if (!goal) throw applicationError(`unknown run ${runId}`, 'application_run_not_found');
    const plans = goalPlan.plans.filter((plan) => plan.repoId === this.repoId && plan.runId === runId
      && plan.goal.goalId === goal.goalId && plan.goal.version === goal.version && plan.goal.digest === goal.digest)
      .sort((a, b) => b.version - a.version);
    const plan = plans[0] ?? null;
    const profileRef = parseProfileConstraint(goal.constraints);
    const currentProfile = profileRef ? this.profiles.get(profileRef.name) : null;
    const profile = profileRef && currentProfile?.digest === profileRef.digest ? currentProfile
      : profileRef ? this._profileRegistry.get(profileRegistryCoordinate(profileRef.name, profileRef.digest)) ?? null
        : null;
    if (!profileRef || (!profile && !allowUnavailableProfile)) {
      throw applicationError(`run ${runId} deployment profile is unavailable`, 'application_profile_stale');
    }
    const approval = plan ? goalPlan.approvals.find((row) => row.plan.planId === plan.planId
      && row.plan.version === plan.version && row.plan.digest === plan.digest) ?? null : null;
    const dispatches = plan ? goalPlan.dispatches.filter((row) => row.binding?.planId === plan.planId
      && row.binding?.planVersion === plan.version && row.binding?.planDigest === plan.digest)
      .sort((left, right) => (left.binding.nodeKey < right.binding.nodeKey ? -1 : 1)) : [];
    const dispatch = dispatches[0] ?? null;
    return {
      goal, plan, approval, dispatch, dispatches, profile, profileName: profileRef.name,
      profileDigest: profileRef.digest,
      profileState: profile ? 'available' : 'historical_definition_unavailable',
    };
  }

  _isWorkflowRun(current) {
    if (!current.plan) return false;
    if (current.plan.nodes.length === 1 && current.plan.nodes[0]?.revision) return true;
    // Plan cardinality is not Workflow authority: later reduce/retry generations may have one
    // node, while ordinary recovery/refinement Plans may have several. The application-owned,
    // content-addressed definition event is the authority.
    if (typeof this.driver.coordination.events !== 'function') return false;
    return this.driver.coordination.events().some((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
      && event.payload?.repoId === this.repoId
      && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest
    ));
  }

  _runAtPlan(current, plan) {
    const snapshot = this.driver.coordination.snapshot();
    const goalPlan = snapshot.goalPlan;
    const approval = goalPlan.approvals.find((row) => row.plan.planId === plan.planId
      && row.plan.version === plan.version && row.plan.digest === plan.digest) ?? null;
    const dispatches = goalPlan.dispatches.filter((row) => row.binding?.planId === plan.planId
      && row.binding?.planVersion === plan.version && row.binding?.planDigest === plan.digest)
      .sort((left, right) => (left.binding.nodeKey < right.binding.nodeKey ? -1 : 1));
    return {
      ...current, plan, approval, dispatch: dispatches[0] ?? null, dispatches,
    };
  }

  _workflowPlanHistory(current) {
    if (!this._isWorkflowRun(current)) return [];
    const snapshot = this.driver.coordination.snapshot();
    const plans = snapshot.goalPlan?.plans ?? [];
    const chain = []; const seen = new Set();
    let cursor = current.plan;
    while (cursor) {
      const identity = `${cursor.planId}:${cursor.version}:${cursor.digest}`;
      if (seen.has(identity) || chain.length >= MAX_WORKFLOW_PLAN_HISTORY) {
        throw applicationError('Workflow Plan history is cyclic or exceeds its bounded ceiling',
          'application_workflow_integrity');
      }
      seen.add(identity); chain.push(this._runAtPlan(current, cursor));
      if (cursor.predecessor === null) break;
      const predecessor = plans.find((plan) => plan.repoId === this.repoId
        && plan.runId === current.goal.runId
        && plan.planId === cursor.predecessor.planId
        && plan.version === cursor.predecessor.version
        && plan.digest === cursor.predecessor.digest
        && plan.goal.goalId === current.goal.goalId
        && plan.goal.version === current.goal.version
        && plan.goal.digest === current.goal.digest);
      if (!predecessor) {
        throw applicationError('Workflow Plan predecessor is unavailable',
          'application_workflow_integrity');
      }
      cursor = predecessor;
    }
    return chain.reverse();
  }

  async _reconcileRunStops() {
    this._assertOpen();
    if (typeof this.driver.coordination.pendingRunStops !== 'function'
      || typeof this.driver.coordination.runStop !== 'function'
      || typeof this.driver.coordination.completeRunStop !== 'function'
      || typeof this.driver.coordinator.stopRunTargets !== 'function') {
      throw applicationError('application driver lacks Run stop/reap authority', 'application_config_invalid');
    }
    const pending = this.driver.coordination.pendingRunStops(MAX_RUN_RECORDS);
    const failures = [];
    for (const stop of pending) {
      try { await this._performRunStop(stop); }
      catch (error) { failures.push({ runId: stop.runId, code: error?.code ?? 'application_run_stop_incomplete' }); }
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedStops: pending.length, failures });
  }

  async _reconcileWorkflowMemberStops() {
    if (typeof this.driver.coordination.events !== 'function') {
      return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedStops: 0, failures: [] });
    }
    const runIds = [...new Set(this.driver.coordination.events().filter((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND
      && event.payload?.repoId === this.repoId
    )).map((event) => event.payload.runId))];
    const failures = [];
    let examinedStops = 0;
    for (const runId of runIds) {
      try {
        const current = this._findRun(runId);
        const definition = this._workflowDefinition(current);
        for (const stop of this._workflowMemberStops(current, definition)
          .filter((row) => row.status === 'stopping')) {
          examinedStops += 1;
          await this._performWorkflowMemberStop(current, definition, stop);
        }
      } catch (error) {
        failures.push({ runId, code: error?.code ?? 'application_workflow_member_stop_incomplete' });
      }
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedStops, failures });
  }

  async _reconcileResultAdoptions() {
    this._assertOpen();
    if (typeof this.driver.coordination.pendingRunResultAdoptions !== 'function'
      || typeof this.driver.coordination.runResultAdoption !== 'function'
      || typeof this.driver.coordination.completeRunResultAdoption !== 'function'
      || typeof this.driver.coordinator.preserveResult !== 'function') {
      throw applicationError('application driver lacks accepted-result adoption authority', 'application_config_invalid');
    }
    const pending = this.driver.coordination.pendingRunResultAdoptions(MAX_RUN_RECORDS);
    const failures = [];
    for (const adoption of pending) {
      try { await this._performResultAdoption(adoption); }
      catch (error) { failures.push({ runId: adoption.runId, nodeKey: adoption.nodeKey, code: error?.code ?? 'application_adoption_incomplete' }); }
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedAdoptions: pending.length, failures });
  }

  _reconcileResultExportLifecycle() {
    if (!this.exportRoot) return deepFreeze({ removed: [], quarantined: [] });
    const exports = (this.driver.coordination.snapshot().runResultExports ?? []).map((state) => ({
      exportId: state.exportId, status: state.status, stagingNonce: state.stagingNonce,
      ...(state.status === 'completed' ? { receipt: state.receipt } : {}),
    }));
    try { return this.resultExportLifecycle.reconcile(exports); }
    catch (cause) {
      throw Object.assign(applicationError('Run export staging reconciliation failed', 'application_export_reconciliation_failed'), { cause });
    }
  }

  _completedResultExport(coordinates) {
    if (!coordinates || typeof coordinates !== 'object' || Array.isArray(coordinates)
      || Object.keys(coordinates).sort().join(',') !== ['exportId', 'repoId', 'runId'].join(',')
      || coordinates.repoId !== this.repoId || !validId(coordinates.runId)
      || !/^[a-f0-9]{64}$/u.test(coordinates.exportId ?? '')
      || this.driver.coordination.runStop?.(coordinates.runId)) return null;
    let current;
    try { current = this._findRun(coordinates.runId); } catch { return null; }
    const nodeKey = current.plan?.nodes?.[0]?.key;
    if (!nodeKey || current.profile.exportPolicy.mode !== 'manual') return null;
    const state = this.driver.coordination.runResultExport(coordinates.runId, nodeKey);
    if (state?.status !== 'completed' || state.exportId !== coordinates.exportId
      || state.receipt?.state !== 'completed') return null;
    return { current, state, receipt: clone(state.receipt) };
  }

  async authorizeResultExportDelivery(coordinates, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const principal = normalizePrincipal(rawPrincipal, 'export delivery principal');
    const completed = this._completedResultExport(coordinates);
    if (!completed) return false;
    await this._authorize('run.export', principal, coordinates.runId, {
      exportId: coordinates.exportId, operation: 'download',
    });
    return this._completedResultExport(coordinates) !== null;
  }

  resolveCompletedResultExport(coordinates) {
    return this._completedResultExport(coordinates)?.receipt ?? null;
  }

  openResultExportArchive(coordinates) {
    const completed = this._completedResultExport(coordinates);
    if (!completed || !this.exportRoot) throw applicationError('Run export is not deliverable', 'application_export_unavailable');
    const archive = this.resultExportLifecycle.deriveArchive({
      receipt: completed.receipt,
      maxArchiveBytes: resultExportArchiveCeiling(completed.current.profile.exportPolicy),
    });
    const chunkBytes = this.exportDeliveryChunkBytes;
    return {
      descriptor: archive.descriptor,
      chunks: (async function* archiveChunks() {
        for (let offset = 0; offset < archive.bytes.length; offset += chunkBytes) {
          yield archive.bytes.subarray(offset, Math.min(offset + chunkBytes, archive.bytes.length));
        }
      }()),
    };
  }

  registerResultExportDelivery({ runId, exportId, signal, abort }) {
    const completed = this._completedResultExport({ repoId: this.repoId, runId, exportId });
    if (!completed || !(signal instanceof AbortSignal) || typeof abort !== 'function') {
      throw applicationError('Run export delivery registration is unavailable', 'application_export_unavailable');
    }
    const registrations = this._runDeliveryRegistrations.get(runId) ?? new Set();
    this._runDeliveryRegistrations.set(runId, registrations);
    let close;
    const closed = new Promise((resolveClosed) => { close = resolveClosed; });
    const registration = { exportId, abort, closed };
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      signal.removeEventListener('abort', release);
      registrations.delete(registration);
      if (registrations.size === 0) this._runDeliveryRegistrations.delete(runId);
      close();
      return true;
    };
    registration.release = release;
    registrations.add(registration);
    signal.addEventListener('abort', release, { once: true });
    return Object.freeze({ release });
  }

  async _abortResultExportDeliveries(runId = null) {
    const registrations = runId === null
      ? [...this._runDeliveryRegistrations.values()].flatMap((set) => [...set])
      : [...(this._runDeliveryRegistrations.get(runId) ?? [])];
    for (const registration of registrations) {
      try { registration.abort(); } catch { registration.release(); }
    }
    await Promise.all(registrations.map((registration) => registration.closed));
  }

  _performResultExport(state) {
    const existing = this._runExportPromises.get(state.exportId);
    if (existing) return existing;
    const operation = (async () => {
      const current = this._findRun(state.runId);
      const policy = current.profile.exportPolicy;
      if (policy.mode !== 'manual' || current.profile.digest !== state.profileDigest
        || digest(policy) !== state.exportPolicyDigest || this.exportRootDigest !== state.exportRootDigest
        || policy.format !== state.format || policy.maxFiles !== state.maxFiles || policy.maxBytes !== state.maxBytes) {
        throw applicationError('pending Run export deployment authority changed', 'application_export_policy_stale');
      }
      const task = this.driver.coordination.task(state.taskId);
      if (!task?.assignee || task.runId !== state.runId) {
        throw applicationError('pending Run export task authority is unavailable', 'application_export_unavailable');
      }
      let materialized;
      try {
        materialized = await this.resultExportLifecycle.materialize((exportRoot) =>
          this.driver.coordinator.materializeAcceptedResult(task.assignee, state.resultSha, {
          exportRoot,
          exportId: state.exportId,
          stagingNonce: state.stagingNonce,
          policy: clone(policy),
          manifestCore: {
            repoId: this.repoId,
            runId: state.runId,
            nodeKey: state.nodeKey,
            taskId: state.taskId,
            resultSha: state.resultSha,
            evidenceDigest: state.evidenceDigest,
            profileDigest: state.profileDigest,
            exportPolicyDigest: state.exportPolicyDigest,
            goal: clone(state.binding.accepted.goal),
            plan: {
              ...clone(state.binding.accepted.plan),
              approvalDigest: state.binding.accepted.approvalDigest,
            },
            adoptionReceiptDigest: state.adoptionReceiptDigest,
            semanticReviewReceiptDigest: state.semanticReviewReceiptDigest,
            integrationAfterSha: state.integrationAfterSha,
          },
        }));
      } catch (cause) {
        const codes = {
          result_export_root_invalid: 'application_export_root_invalid',
          result_export_tree_unsafe: 'application_export_tree_unsafe',
          result_export_tree_oversize: 'application_export_tree_oversize',
          result_export_source_unavailable: 'application_export_source_unavailable',
          result_export_output_mismatch: 'application_export_output_mismatch',
          result_export_invalid: 'application_export_invalid',
        };
        throw Object.assign(applicationError('Run result export did not materialize exactly', codes[cause?.code] ?? 'application_export_incomplete'), { cause });
      }
      const retained = await this.driver.coordinator.inspectPreservedResult(task.assignee, state.resultSha);
      if (retained.state !== 'pinned') {
        throw applicationError('accepted result changed during export', 'application_export_source_unavailable');
      }
      const core = {
        schemaVersion: 1,
        state: 'completed',
        format: state.format,
        runId: state.runId,
        nodeKey: state.nodeKey,
        resultSha: state.resultSha,
        evidenceDigest: state.evidenceDigest,
        exportId: state.exportId,
        locator: state.locator,
        treeOid: materialized.treeOid,
        manifestDigest: materialized.manifestDigest,
        fileCount: materialized.fileCount,
        byteCount: materialized.byteCount,
        checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: true },
        effects: { adopted: false, checkoutChanged: false, deployed: false, integrated: false, published: false },
      };
      const receipt = deepFreeze({ ...core, receiptDigest: digest(core) });
      const completed = this.driver.coordination.completeRunResultExport({
        schemaVersion: 1, exportId: state.exportId, receipt,
      }, { actor: state.actor, key: `run.result_export.complete:${state.exportId}` });
      return completed.export.receipt;
    })();
    this._runExportPromises.set(state.exportId, operation);
    operation.finally(() => {
      if (this._runExportPromises.get(state.exportId) === operation) this._runExportPromises.delete(state.exportId);
    }).catch(() => {});
    return operation;
  }

  async _reconcileResultExports() {
    if (!this.exportRoot) return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedExports: 0, failures: [] });
    const pending = this.driver.coordination.pendingRunResultExports(MAX_RUN_RECORDS);
    const failures = [];
    for (const state of pending) {
      try { await this._withRunEffect(state.runId, () => this._performResultExport(state)); }
      catch (error) { failures.push({ runId: state.runId, nodeKey: state.nodeKey, code: error?.code ?? 'application_export_incomplete' }); }
    }
    return deepFreeze({ schemaVersion: 1, state: 'reconciled', examinedExports: pending.length, failures });
  }

  _semanticTarget(current, view) {
    const node = view.nodes[0];
    if (!current.plan || !node?.taskId || !view.result?.sha
      || !view.result.commitArtifact || !view.result.verificationArtifact) return null;
    const task = this.driver.coordination.task(node.taskId);
    if (!task?.assignee || typeof this.driver.coordinator.inspectCapturedChanges !== 'function') return null;
    const changedPaths = this.driver.coordinator.inspectCapturedChanges(task.assignee, view.result.sha, 1_024);
    const core = {
      schemaVersion: 1,
      repoId: this.repoId,
      runId: current.goal.runId,
      nodeKey: current.plan.nodes[0].key,
      taskId: node.taskId,
      resultSha: view.result.sha,
      profileDigest: current.profile.digest,
      goalDigest: current.goal.digest,
      planDigest: current.plan.digest,
      approvalDigest: view.plan?.approval?.digest ?? null,
      commitArtifact: clone(view.result.commitArtifact),
      verificationArtifact: clone(view.result.verificationArtifact),
      changedPaths,
      evidenceRefs: [view.result.commitArtifact, view.result.verificationArtifact]
        .map((item) => ({ kind: 'artifact', id: item.id, digest: item.digest })),
    };
    return deepFreeze({ ...core, targetDigest: digest(core) });
  }

  _semanticTaskId(target) {
    return `run-semantic-${digest({ runId: target.runId, nodeKey: target.nodeKey, targetDigest: target.targetDigest }).slice(0, 48)}`;
  }

  _performSemanticReviewLifecycle(workerId, targetDigest) {
    const existing = this._semanticReviewPromises.get(workerId);
    if (existing) return existing;
    const operation = (async () => {
      for (;;) {
        const result = await this.driver.coordinator.result(workerId);
        if (result.ready) break;
        await this.driver.coordinator.wait(100);
      }
      try { this.driver.coordinator.inspectStructuredReview(workerId, targetDigest); }
      catch { /* the RunView preserves the typed invalid-report state after cleanup */ }
      const handle = this.driver.coordinator.list().find((candidate) => candidate.id === workerId);
      const released = handle && ['dead', 'stopped'].includes(handle.status)
        && handle.worktree === null && handle.runtimeScope?.active !== true
        && (!handle.processRef || handle.processRef.state === 'closed');
      if (handle && !released) await this.driver.coordinator.kill(workerId, 'application:semantic-review-cleanup');
      return { workerId, state: 'settled' };
    })();
    this._semanticReviewPromises.set(workerId, operation);
    operation.finally(() => {
      if (this._semanticReviewPromises.get(workerId) === operation) this._semanticReviewPromises.delete(workerId);
    }).catch(() => {});
    return operation;
  }

  async _reconcileSemanticReviews() {
    let examined = 0;
    const terminalCleanup = [];
    for (const handle of this.driver.coordinator.list()) {
      const task = this.driver.coordination.task(handle.taskId);
      const structured = task?.review?.structured;
      if (structured?.purpose !== 'run_semantic_review') continue;
      examined += 1;
      const operation = this._performSemanticReviewLifecycle(handle.id, structured.targetDigest);
      if (['completed', 'failed', 'cancelled'].includes(task.status) || handle.status === 'stopping') {
        terminalCleanup.push(operation);
      } else {
        operation.catch(() => {});
      }
    }
    const settled = await Promise.allSettled(terminalCleanup);
    return deepFreeze({
      schemaVersion: 1,
      state: 'reconciled',
      examinedReviews: examined,
      terminalCleanupFailures: settled.filter((result) => result.status === 'rejected').length,
    });
  }

  _validateSemanticEvidence(ref, target) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !validText(ref.kind, 64)) {
      throw applicationError('semantic finding evidence is invalid', 'application_review_evidence_invalid');
    }
    if (ref.kind === 'artifact') {
      exactObject(ref, ['kind', 'id', 'digest'], 'application_review_evidence_invalid', 'semantic artifact evidence');
      if (!validText(ref.id, 4_096) || !/^[a-f0-9]{64}$/u.test(ref.digest ?? '')) {
        throw applicationError('semantic artifact evidence is invalid', 'application_review_evidence_invalid');
      }
      const artifact = this.driver.coordination.artifact(ref.id);
      if (!artifact || artifact.digest !== ref.digest || artifact.accepted !== true
        || artifact.supersededBy !== null || Object.hasOwn(artifact, 'acceptanceInvalidation')
        || (artifact.taskId && artifact.taskId !== target.taskId)) {
        throw applicationError('semantic artifact evidence is stale or substituted', 'application_review_evidence_stale');
      }
      return clone(ref);
    }
    if (ref.kind === 'representation') {
      exactObject(ref, ['kind', 'identityDigest', 'graphDigest'], 'application_review_evidence_invalid', 'semantic Representation evidence');
      if (!/^[a-f0-9]{64}$/u.test(ref.identityDigest ?? '') || !/^[a-f0-9]{64}$/u.test(ref.graphDigest ?? '')) {
        throw applicationError('semantic Representation evidence is invalid', 'application_review_evidence_invalid');
      }
      const representation = this.driver.coordination.representationProduction?.(ref.identityDigest);
      if (!representation || representation.graphDigest !== ref.graphDigest
        || representation.identity?.repoId !== this.repoId || representation.identity?.runId !== target.runId
        || representation.identity?.environment?.treeSha !== target.resultSha) {
        throw applicationError('semantic Representation evidence is stale or substituted', 'application_review_evidence_stale');
      }
      return clone(ref);
    }
    throw applicationError('semantic finding evidence kind is unsupported', 'application_review_evidence_invalid');
  }

  _parseSemanticReview(inspection, current, target) {
    let report;
    try { report = JSON.parse(inspection.report.text); }
    catch { throw applicationError('semantic review report is not valid JSON', 'application_review_report_invalid'); }
    exactObject(report, ['schemaVersion', 'targetDigest', 'verdict', 'summary', 'findings'], 'application_review_report_invalid', 'semantic review report');
    const policy = current.profile.reviewPolicy;
    if (report.schemaVersion !== 1 || report.targetDigest !== target.targetDigest
      || !['approved', 'revision_required', 'unverifiable'].includes(report.verdict)
      || !validText(report.summary, 8_192) || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(report.summary))
      || !Array.isArray(report.findings) || report.findings.length > policy.maxFindings) {
      throw applicationError('semantic review report is invalid or targets different work', 'application_review_report_invalid');
    }
    const findingIds = new Set();
    const findings = report.findings.map((finding) => {
      exactObject(finding, ['id', 'severity', 'disposition', 'claim', 'source', 'evidence', 'requiredCorrection'], 'application_review_report_invalid', 'semantic finding');
      if (!validId(finding.id) || findingIds.has(finding.id) || !['P0', 'P1', 'P2', 'P3'].includes(finding.severity)
        || !['confirmed', 'contradicted', 'unverifiable'].includes(finding.disposition)
        || !validText(finding.claim, 8_192) || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(finding.claim))
        || !Array.isArray(finding.evidence) || finding.evidence.length === 0 || finding.evidence.length > 64
        || (finding.disposition === 'confirmed'
          ? !validText(finding.requiredCorrection, 8_192)
          : finding.requiredCorrection !== null)
        || (typeof finding.requiredCorrection === 'string'
          && SECRET_SHAPED_TEXT.some((pattern) => pattern.test(finding.requiredCorrection)))) {
        throw applicationError('semantic finding is invalid', 'application_review_report_invalid');
      }
      findingIds.add(finding.id);
      if (!current.profile.pathScope.some((allowed) => scopeEntryWithin(finding.source?.path, allowed))) {
        throw applicationError('semantic finding source is outside approved scope', 'application_review_scope_violation');
      }
      let source;
      try {
        source = this.driver.coordinator.inspectCapturedFile(
          inspection.parentWorkerId, target.resultSha, finding.source.path, MAX_REVIEW_SOURCE_BYTES,
        );
      } catch (cause) {
        throw Object.assign(applicationError('semantic finding source is unavailable', 'application_review_anchor_stale'), { cause });
      }
      const excerpt = semanticSourceSlice(source.text, finding.source);
      if (contentDigest(excerpt) !== finding.source.contentDigest) {
        throw applicationError('semantic finding source digest is stale', 'application_review_anchor_stale');
      }
      const evidence = finding.evidence.map((ref) => this._validateSemanticEvidence(ref, target));
      return deepFreeze({ ...clone(finding), evidence, excerptDigest: contentDigest(excerpt) });
    });
    const derivedVerdict = findings.some((finding) => finding.disposition === 'unverifiable') ? 'unverifiable'
      : findings.some((finding) => finding.disposition === 'confirmed') ? 'revision_required' : 'approved';
    if (report.verdict !== derivedVerdict) {
      throw applicationError('semantic review verdict disagrees with its findings', 'application_review_verdict_inconsistent');
    }
    const state = derivedVerdict === 'approved' ? 'semantic_reviewed'
      : derivedVerdict === 'revision_required' ? 'revision_required' : 'review_failed';
    const route = {
      requested: {
        harness: inspection.reviewer.harness,
        model: inspection.reviewer.modelRequested,
        effort: inspection.reviewer.effortRequested,
      },
      resolved: {
        harness: inspection.reviewer.harness,
        model: inspection.reviewer.modelResolved,
        effort: inspection.reviewer.effortResolved,
      },
      observed: inspection.reviewer.modelObserved != null || inspection.reviewer.effortObserved != null ? {
        harness: inspection.reviewer.harness,
        model: inspection.reviewer.modelObserved,
        effort: inspection.reviewer.effortObserved,
      } : null,
    };
    const core = {
      state, verdict: derivedVerdict, summary: report.summary, findings,
      independent: inspection.independent, route,
      workerId: inspection.workerId, taskId: inspection.taskId,
      targetDigest: inspection.targetDigest, report: {
        path: inspection.reportPath, sha: inspection.reportSha,
        digest: contentDigest(inspection.report.text), bytes: inspection.report.bytes,
      },
    };
    return deepFreeze({ ...core, receiptDigest: digest(core) });
  }

  async _semanticReview(current, baseView) {
    const target = this._semanticTarget(current, baseView);
    if (!target || current.profile.reviewPolicy.mode === 'none') return { state: 'semantics_unverified', findings: [] };
    const taskId = this._semanticTaskId(target);
    const task = this.driver.coordination.task(taskId);
    if (!task) return { state: 'semantics_unverified', findings: [], targetDigest: target.targetDigest };
    let handle = this.driver.coordinator.list().find((candidate) => candidate.taskId === taskId);
    if (!handle || task.review?.structured?.targetDigest !== target.targetDigest) {
      return { state: 'review_failed', findings: [], targetDigest: target.targetDigest, error: { code: 'application_review_target_conflict' } };
    }
    if (['pending', 'working', 'verifying'].includes(task.status)
      || ['pending', 'working', 'blocked', 'stopping'].includes(handle.status)) {
      return {
        state: 'review_running', findings: [], targetDigest: target.targetDigest,
        workerId: handle.id, taskId, route: {
          requested: { harness: handle.vendor, model: handle.modelRequested, effort: handle.effortRequested },
          resolved: handle.modelResolved ? { harness: handle.vendor, model: handle.modelResolved, effort: handle.effortResolved } : null,
          observed: handle.modelObserved || handle.effortObserved ? { harness: handle.vendor, model: handle.modelObserved, effort: handle.effortObserved } : null,
        },
      };
    }
    const reviewerReleased = (candidate) => ['dead', 'stopped'].includes(candidate?.status)
      && candidate.worktree === null && candidate.runtimeScope?.active !== true
      && (!candidate.processRef || candidate.processRef.state === 'closed');
    if (!reviewerReleased(handle)) {
      try {
        await this._performSemanticReviewLifecycle(handle.id, target.targetDigest);
      } catch {
        return {
          state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle.id, taskId,
          error: { code: 'application_review_cleanup_incomplete' },
        };
      }
      handle = this.driver.coordinator.list().find((candidate) => candidate.taskId === taskId);
      if (!reviewerReleased(handle)) {
        return {
          state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle?.id ?? null, taskId,
          error: { code: 'application_review_cleanup_incomplete' },
        };
      }
    }
    if (task.status !== 'completed') {
      return { state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle.id, taskId, error: { code: 'application_review_worker_failed' } };
    }
    try {
      const inspection = this.driver.coordinator.inspectStructuredReview(handle.id, target.targetDigest);
      return this._parseSemanticReview(inspection, current, target);
    } catch (error) {
      return {
        state: 'review_failed', findings: [], targetDigest: target.targetDigest, workerId: handle.id, taskId,
        error: { code: error?.code ?? 'application_review_report_invalid' },
      };
    }
  }

  _performResultAdoption(adoption) {
    const key = `${adoption.runId}\0${adoption.nodeKey}`;
    const existing = this._runAdoptionPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const current = this.driver.coordination.runResultAdoption(adoption.runId, adoption.nodeKey);
      if (!current) throw applicationError('Run result adoption admission is unavailable', 'application_adoption_incomplete');
      if (current.status === 'adopted') return current.receipt;
      const task = this.driver.coordination.task(current.taskId);
      if (!task?.assignee) throw applicationError('Run result adoption worker authority is unavailable', 'application_adoption_incomplete');
      const pinned = await this.driver.coordinator.preserveResult(task.assignee, current.resultSha);
      if (pinned.state !== 'pinned' || pinned.sha !== current.resultSha || pinned.ref !== current.retainedResultRef) {
        throw applicationError('Run result adoption ref verification failed', 'application_adoption_incomplete');
      }
      const core = {
        schemaVersion: 1,
        state: 'adopted',
        scope: 'run-result',
        repoId: current.repoId,
        runId: current.runId,
        nodeKey: current.nodeKey,
        taskId: current.taskId,
        binding: {
          admissionDigest: current.adoptionDigest,
          evidenceDigest: current.evidenceDigest,
          goalDigest: current.binding.goal.digest,
          planDigest: current.binding.plan.digest,
          approvalDigest: current.binding.approvalDigest,
          commitArtifactId: current.binding.commitArtifact.id,
          commitArtifactDigest: current.binding.commitArtifact.digest,
          verificationArtifactId: current.binding.verificationArtifact.id,
          verificationArtifactDigest: current.binding.verificationArtifact.digest,
        },
        result: { sha: current.resultSha, ref: pinned.ref },
        checks: {
          taskAccepted: true, verificationAccepted: true, refPinned: true,
          mainUnchanged: true, worktreeIndependent: true,
        },
        effects: {
          mainHeadChanged: false, indexChanged: false, workingTreeChanged: false, published: false,
        },
      };
      const receipt = deepFreeze({ ...core, receiptDigest: digest(core) });
      return this.driver.coordination.completeRunResultAdoption({
        schemaVersion: 1, runId: current.runId, nodeKey: current.nodeKey, receipt,
      }, { actor: current.actor, key: `run.result_adoption.complete:${current.runId}:${current.nodeKey}` }).adoption.receipt;
    })();
    this._runAdoptionPromises.set(key, operation);
    operation.finally(() => {
      if (this._runAdoptionPromises.get(key) === operation) this._runAdoptionPromises.delete(key);
    }).catch(() => {});
    return operation;
  }

  _performRunStop(stop) {
    const existing = this._runStopPromises.get(stop.runId);
    if (existing) return existing;
    const operation = (async () => {
      const current = this.driver.coordination.runStop(stop.runId);
      if (!current) throw applicationError('Run stop admission is unavailable', 'application_run_stop_incomplete');
      if (current.status === 'stopped') return current.receipt;
      const targetRunIds = current.targetRunIds ?? [stop.runId];
      const contextOperations = [];
      for (const targetRunId of targetRunIds) {
        await this._abortResultExportDeliveries(targetRunId);
        for (const operation of this._contextControllers?.get(targetRunId) ?? []) {
          operation.controller.abort();
          contextOperations.push(operation.settled);
        }
      }
      await Promise.allSettled(contextOperations);
      // VR6: stop cancels an in-flight verifier retry exactly and settles its durable admission.
      for (const targetRunId of targetRunIds) {
        for (const controller of this._runRetryControllers.get(targetRunId) ?? []) controller.abort();
      }
      if (typeof this.driver.coordination.pendingRunVerificationRetries === 'function') {
        for (const pending of this.driver.coordination.pendingRunVerificationRetries()
          .filter((row) => targetRunIds.includes(row.runId))) {
          try { this._cancelRunVerificationRetry(pending); }
          catch (error) {
            // The in-flight performer may have settled the same admission concurrently; a
            // deterministic identical cancellation replays, anything else already completed it.
            if (error?.code !== 'run_verification_retry_conflict') throw error;
          }
        }
      }
      const outcome = await this.driver.coordinator.stopRunTargets(current.targetWorkerIds, current.actor);
      if (outcome.targetCount !== current.targetWorkerIds.length
        || outcome.remainingCount !== 0
        || outcome.counts.pendingCancelled + outcome.counts.killConfirmed + outcome.counts.alreadyTerminal !== outcome.targetCount
        || outcome.counts.processesObserved !== outcome.counts.processesClosed
        || outcome.checks.interactionsResolved !== true || outcome.checks.runAuthorityReleased !== true) {
        throw applicationError('Run stop/reap result is incomplete', 'application_run_stop_incomplete');
      }
      const core = {
        schemaVersion: current.schemaVersion,
        state: 'stopped',
        scope: current.scope ?? 'run',
        repoId: current.repoId,
        runId: current.runId,
        targetCount: outcome.targetCount,
        remainingCount: 0,
        targetDigest: current.targetDigest,
        counts: clone(outcome.counts),
        checks: { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true },
        effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
        ...(current.schemaVersion >= 2 ? {
          context: {
            targetSessionCount: current.targetContextSessionIds.length,
            targetCellCount: current.targetContextCellIds.length,
            ...(current.schemaVersion >= 3 ? {
              targetCallCount: current.targetContextCallIds.length,
            } : {}),
            remainingSessionCount: current.targetContextSessionIds.filter((sessionId) => (
              this.driver.coordination.contextSession(sessionId)?.state !== 'stopped'
            )).length,
            remainingCellCount: current.targetContextCellIds.filter((cellId) => (
              this.driver.coordination.contextCell(cellId)?.state !== 'stopped'
            )).length,
            ...(current.schemaVersion >= 3 ? {
              remainingCallCount: current.targetContextCallIds.filter((callId) => (
                !['completed', 'failed', 'stopped'].includes(
                  this.driver.coordination.contextCall(callId)?.state,
                )
              )).length,
            } : {}),
          },
        } : {}),
      };
      const receipt = deepFreeze({ ...core, receiptDigest: digest(core) });
      const completed = this.driver.coordination.completeRunStop(current.runId, receipt, {
        actor: current.actor, key: `run.stop.complete:${current.runId}`,
      });
      return completed.stop.receipt;
    })();
    this._runStopPromises.set(stop.runId, operation);
    operation.catch(() => {
      if (this._runStopPromises.get(stop.runId) === operation) this._runStopPromises.delete(stop.runId);
    });
    return operation;
  }

  _assertRunMutable(runId) {
    const stop = this.driver.coordination.runStop?.(runId);
    if (stop) {
      const stopped = stop.status === 'stopped';
      throw applicationError(`run ${runId} is ${stopped ? 'stopped' : 'stopping'}`,
        stopped ? 'application_run_stopped' : 'application_run_stopping');
    }
  }

  async _reconcileApprovedRuns() {
    this._assertOpen();
    const snapshot = this.driver.coordination.snapshot();
    const runIds = [...new Set((snapshot.goalPlan?.goals ?? [])
      .filter((goal) => goal.repoId === this.repoId && goal.runId !== null)
      .map((goal) => goal.runId))].sort();
    if (runIds.length > MAX_RUN_RECORDS) {
      throw applicationError('application run scheduler exceeds its bounded lookup ceiling', 'application_run_lookup_oversize');
    }
    for (const runId of runIds) {
      if (this.driver.coordination.runStop?.(runId)) continue;
      let current = this._findRun(runId, { allowUnavailableProfile: true });
      if (!current.profile) {
        if (current.plan && current.approval?.disposition === 'approved' && !current.dispatch) {
          throw applicationError(`run ${runId} deployment profile is unavailable`, 'application_profile_stale');
        }
        continue;
      }
      if (await this._reconcileContextCalls(current)) {
        current = this._findRun(runId, { allowUnavailableProfile: true });
      }
      if (current.plan && current.approval?.disposition === 'approved'
        && current.dispatches.length < current.plan.nodes.length) {
        await this._dispatchCurrent(current);
      }
    }
    return deepFreeze({ schemaVersion: 1, state: 'ready', examinedRuns: runIds.length });
  }

  async _dispatchCurrent(current) {
    const refreshed = this._findRun(current.goal.runId);
    this._assertRunMutable(refreshed.goal.runId);
    if (!refreshed.plan || refreshed.approval?.disposition !== 'approved') return refreshed.dispatch;
    if (refreshed.plan.nodes.length === 1 && refreshed.plan.nodes[0]?.revision) {
      await this._validateWorkflowRevisionPlan(refreshed);
      if (refreshed.dispatch) return refreshed.dispatch;
      if (typeof this.driver.coordinator.spawnPlanRevision !== 'function') {
        throw applicationError('coordinator lacks durable Workflow revision authority',
          'application_workflow_revision_unavailable');
      }
      const node = refreshed.plan.nodes[0];
      const gate = {
        goalId: refreshed.goal.goalId, goalVersion: refreshed.goal.version,
        goalDigest: refreshed.goal.digest, planId: refreshed.plan.planId,
        planVersion: refreshed.plan.version, planDigest: refreshed.plan.digest,
        nodeKey: node.key, expectedDispatchVersion: 0,
        capabilities: clone(node.capabilities), effects: clone(node.effects),
        ...(Object.hasOwn(node, 'requiredEffects')
          ? { requiredEffects: clone(node.requiredEffects) } : {}),
      };
      const selectedRoute = exactPlanNodeRoute(node, 'Workflow revision Plan node');
      const route = {
        vendor: selectedRoute.harness, model: selectedRoute.model,
        effort: selectedRoute.effort,
      };
      const preview = this.driver.coordination.previewPlanRevision(gate, route);
      const { goalPlan: ignored, ...brief } = preview.brief;
      void ignored;
      const taskId = `baton-${digest({
        repoId: this.repoId, runId: refreshed.goal.runId,
        planDigest: refreshed.plan.digest, nodeKey: node.key, dispatchVersion: 1,
      }).slice(0, 24)}-${node.key.replaceAll(':', '-')}`;
      await this.driver.coordinator.spawnPlanRevision({
        vendor: route.vendor, model: route.model, effort: route.effort,
        brief, goalPlan: gate, runId: refreshed.goal.runId, taskId,
      }, {
        actor: this.principals.dispatcher.actor,
        principalId: this.principals.dispatcher.principalId,
        sessionId: this.principals.dispatcher.sessionId,
        powers: ['plan:dispatch'],
        idempotencyKey: `application:${refreshed.goal.runId}:revision:${refreshed.plan.digest}:v1`,
      });
      return this._findRun(refreshed.goal.runId).dispatch;
    }
    if (this._isWorkflowRun(refreshed) && refreshed.plan.nodes.length > 1) {
      const definition = this._workflowDefinition(refreshed);
      if (refreshed.dispatches.length === refreshed.plan.nodes.length) return refreshed.dispatches;
      if (refreshed.dispatches.length !== 0) {
        throw applicationError('workflow Plan wave is partially dispatched',
          'application_workflow_wave_incomplete');
      }
      if (typeof this.driver.coordinator.spawnPlanWave !== 'function') {
        throw applicationError('coordinator lacks durable workflow Wave authority',
          'application_workflow_unavailable');
      }
      const members = refreshed.plan.nodes.map((node) => {
        const gate = {
          goalId: refreshed.goal.goalId, goalVersion: refreshed.goal.version,
          goalDigest: refreshed.goal.digest, planId: refreshed.plan.planId,
          planVersion: refreshed.plan.version, planDigest: refreshed.plan.digest,
          nodeKey: node.key, expectedDispatchVersion: 0,
          capabilities: clone(node.capabilities), effects: clone(node.effects),
          ...(Object.hasOwn(node, 'requiredEffects')
            ? { requiredEffects: clone(node.requiredEffects) } : {}),
        };
        const attempt = definition.attempts.find((candidate) => candidate.nodeKey === node.key);
        const selectedRoute = attempt ? workflowAttemptRoute(definition, attempt) : null;
        if (!selectedRoute || !planRouteMatches(node.routes, selectedRoute)) {
          throw applicationError('Workflow Attempt route is outside its Plan node authority',
            'application_workflow_integrity');
        }
        const route = {
          vendor: selectedRoute.harness, model: selectedRoute.model,
          effort: selectedRoute.effort,
        };
        const preview = this.driver.coordination.previewPlanDispatch(gate, route);
        const { goalPlan: ignored, ...brief } = preview.brief;
        void ignored;
        const taskId = `baton-${digest({
          repoId: this.repoId, runId: refreshed.goal.runId,
          planDigest: refreshed.plan.digest, nodeKey: node.key, dispatchVersion: 1,
        }).slice(0, 24)}-${node.key.replaceAll(':', '-')}`;
        return {
          vendor: route.vendor, model: route.model, effort: route.effort,
          brief, goalPlan: gate, runId: refreshed.goal.runId, taskId,
        };
      });
      await this.driver.coordinator.spawnPlanWave(members, {
        actor: this.principals.dispatcher.actor,
        principalId: this.principals.dispatcher.principalId,
        sessionId: this.principals.dispatcher.sessionId,
        powers: ['plan:dispatch'],
        idempotencyKey: `application:${refreshed.goal.runId}:wave:${refreshed.plan.digest}:v1`,
      });
      return this._findRun(refreshed.goal.runId).dispatches;
    }
    if (refreshed.dispatch) return refreshed.dispatch;
    const node = refreshed.plan.nodes[0];
    const gate = {
      goalId: refreshed.goal.goalId,
      goalVersion: refreshed.goal.version,
      goalDigest: refreshed.goal.digest,
      planId: refreshed.plan.planId,
      planVersion: refreshed.plan.version,
      planDigest: refreshed.plan.digest,
      nodeKey: node.key,
      expectedDispatchVersion: 0,
      capabilities: clone(node.capabilities),
      effects: clone(node.effects),
      ...(Object.hasOwn(node, 'requiredEffects') ? { requiredEffects: clone(node.requiredEffects) } : {}),
    };
    const selectedRoute = exactPlanNodeRoute(node);
    const route = {
      vendor: selectedRoute.harness,
      model: selectedRoute.model,
      effort: selectedRoute.effort,
    };
    const preview = this.driver.coordination.previewPlanDispatch(gate, route);
    const { goalPlan: ignored, ...brief } = preview.brief;
    void ignored;
    const taskId = `baton-${digest({
      repoId: this.repoId,
      runId: refreshed.goal.runId,
      planDigest: refreshed.plan.digest,
      nodeKey: node.key,
      dispatchVersion: 1,
    }).slice(0, 24)}-work`;
    await this.driver.coordinator.spawn(route.vendor, brief, {
      taskId,
      runId: refreshed.goal.runId,
      model: route.model,
      effort: route.effort,
      goalPlan: gate,
      actor: this.principals.dispatcher.actor,
      principalId: this.principals.dispatcher.principalId,
      sessionId: this.principals.dispatcher.sessionId,
      powers: ['plan:dispatch'],
      idempotencyKey: `application:${refreshed.goal.runId}:dispatch:${refreshed.plan.digest}:${node.key}:v1`,
    });
    return this._findRun(refreshed.goal.runId).dispatch;
  }

  _recursiveLease(principal, context) {
    const sessionAuthority = context?.sessionAuthority ?? null;
    if (!sessionAuthority) return null;
    const coordination = this.driver.coordination;
    if (typeof coordination.runOrchestratorLease !== 'function'
      || typeof coordination.authorizeRunOrchestratorCommand !== 'function') {
      throw applicationError('recursive Run authority is unavailable', 'run_orchestrator_lease_not_found');
    }
    const lease = coordination.runOrchestratorLease(sessionAuthority.orchestratorLeaseId);
    if (!lease) throw applicationError('recursive Run lease is unavailable', 'run_orchestrator_lease_not_found');
    if (lease.repoId !== this.repoId || lease.session.principalId !== principal.principalId
      || lease.session.sessionId !== principal.sessionId
      || lease.session.authorityDigest !== sessionAuthority.authorityDigest
      || lease.session.expiresAt !== sessionAuthority.expiresAt) {
      throw applicationError('recursive Run session does not match its lease', 'run_orchestrator_session_mismatch');
    }
    return lease;
  }

  _recursiveAuth(principal, context, key) {
    const lease = this._recursiveLease(principal, context);
    if (!lease) return null;
    return {
      actor: principal.actor,
      key,
      principalId: principal.principalId,
      sessionId: principal.sessionId,
      sessionAuthorityDigest: context.sessionAuthority.authorityDigest,
      orchestratorLeaseId: lease.leaseId,
    };
  }

  _authorizeRecursiveCommand(command, runId, principal, context) {
    const auth = this._recursiveAuth(
      principal, context, `run.orchestrator.authorize:${context?.idempotencyKey ?? runId}:${command}`,
    );
    if (!auth) return null;
    return this.driver.coordination.authorizeRunOrchestratorCommand({
      schemaVersion: 1, command, repoId: this.repoId, runId,
    }, auth);
  }

  _admitRecursiveRun(intent, principal, context) {
    const auth = this._recursiveAuth(principal, context, `run.lineage:${intent.runId}`);
    if (!auth) return null;
    if (typeof this.driver.coordination.admitRunLineage !== 'function') {
      throw applicationError('recursive Run lineage authority is unavailable', 'run_orchestrator_lease_not_found');
    }
    const admitted = this.driver.coordination.admitRunLineage({
      schemaVersion: 1,
      repoId: this.repoId,
      childRunId: intent.runId,
      intentDigest: digest({
        objective: intent.objective, profile: intent.profile,
        route: intent.route, composition: intent.composition,
        scope: intent.scope, runId: intent.runId,
      }),
    }, auth);
    this._authorizeRecursiveCommand('run.start', intent.runId, principal, context);
    return admitted;
  }

  async start(rawIntent, rawOwner, rawContext = null) {
    this._assertOpen();
    await this.ready;
    const context = normalizeCommandContext(rawContext);
    const requestedIntent = this._resolveIntent(rawIntent);
    const owner = normalizePrincipal(rawOwner, 'goal owner');
    const profile = this._profile(requestedIntent.profile);
    const scope = requestedIntent.scope ?? clone(profile.pathScope);
    const runId = requestedIntent.runId ?? `run-${digest({
      objective: requestedIntent.objective,
      profileDigest: profile.digest,
      route: requestedIntent.route,
      composition: requestedIntent.composition,
      scope,
      ownerPrincipalId: owner.principalId,
    }).slice(0, 32)}`;
    const intent = deepFreeze({ ...requestedIntent, runId, scope });
    await this._authorize('run.start', owner, intent.runId, {
      objectiveDigest: digest(intent.objective), profile: intent.profile, route: intent.route,
      compositionDigest: intent.composition ? digest(intent.composition) : null, scope: intent.scope,
    });
    if (owner.principalId === this.principals.planner.principalId) {
      throw applicationError('goal owner and application planner must be distinct', 'application_authority_invalid');
    }
    if (!intent.scope.every((item) => profile.pathScope.some((allowed) => scopeEntryWithin(item, allowed)))) {
      throw applicationError('requested scope is outside the deployment profile', 'application_scope_not_allowed');
    }
    if (!profile.routes.some((route) => routeEqual(route, intent.route))) {
      throw applicationError('requested route is outside the deployment profile', 'application_route_not_allowed');
    }
    this._admitRecursiveRun(intent, owner, context);
    const constraint = profileConstraint(intent.profile, profile);
    const workflowConstraint = intent.composition
      ? `Baton workflow ${intent.composition.strategy}:${intent.composition.workspace}:${intent.composition.join}`
      : null;
    const goalFields = {
      objective: intent.objective,
      definitionOfDone: clone(profile.definitionOfDone),
      constraints: [...profile.constraints, constraint, ...(workflowConstraint ? [workflowConstraint] : [])],
      risk: profile.risk,
      budget: clone(profile.goalBudget),
      predecessor: null,
    };
    const singleNode = {
      key: 'work',
      objective: intent.objective,
      definitionOfDone: clone(profile.definitionOfDone),
      deps: [],
      pathScope: clone(intent.scope),
      ...(digest(intent.scope) === digest(profile.pathScope)
        ? {} : { contextScope: clone(profile.pathScope) }),
      risk: profile.risk,
      budget: clone(profile.nodeBudget),
      verification: clone(profile.verification),
      routes: exactPlanRoutes(intent.route),
      capabilities: clone(profile.capabilities),
      effects: clone(profile.effects),
      ...(profile.workerPolicy ? { workerPolicy: clone(profile.workerPolicy) } : {}),
      ...(Object.hasOwn(profile, 'requiredEffects') ? { requiredEffects: clone(profile.requiredEffects) } : {}),
    };
    const workflowPolicy = intent.composition
      ? normalizeWorkflowPolicy(this.driver.coordination.workflowPolicy()) : null;
    const nodeFields = intent.composition ? intent.composition.team.map((member) => ({
      ...clone(singleNode),
      key: `attempt:${member.role}`,
      objective: `${member.role} parallel attempt: ${intent.objective}`,
      // Divide one deployment-owned Goal envelope across the bounded recursive Plan chain.
      // Ordinary callers never manage this headroom or any numeric execution ceiling.
      budget: clone(workflowNodeBudget(
        profile, intent.composition.team.length, workflowPolicy.maxRounds,
      )),
      routes: exactPlanRoutes(member.route),
    })) : [singleNode];
    const goalPlanPolicy = this.driver.coordination.goalPlanPolicy();
    const normalizedGoal = normalizeGoalRequest(goalFields, goalPlanPolicy);
    const hypotheticalGoal = {
      ...normalizedGoal,
      goalId: `goal:${'0'.repeat(64)}`,
      version: 1,
      digest: '0'.repeat(64),
    };
    normalizePlanRequest({
      goal: { goalId: hypotheticalGoal.goalId, version: hypotheticalGoal.version, digest: hypotheticalGoal.digest },
      predecessor: null,
      nodes: nodeFields,
    }, goalPlanPolicy, hypotheticalGoal);
    const defined = await this.driver.coordinator.defineGoal(goalFields,
      authority(owner, this.repoId, intent.runId, 'goal:define', `application:${intent.runId}:goal:v1`));
    const goal = defined.goal;
    const normalizedPlan = normalizePlanRequest({
      goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
      predecessor: null,
      nodes: nodeFields,
    }, goalPlanPolicy, goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: this.repoId, runId: intent.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    // Commit Workflow meaning before its Plan can exist. A crash can leave a harmless prebinding
    // without a Plan, but never an approvable multi-node Plan whose strategy or roles are absent.
    if (intent.composition) {
      const roleCatalog = buildWorkflowRoleCatalog(intent.composition.team.map((member) => ({
        role: member.role,
        route: member.route,
        node: normalizedPlan.nodes.find((node) => node.key === `attempt:${member.role}`),
      })));
      const core = {
        schemaVersion: 3, repoId: this.repoId, runId: intent.runId,
        goalDigest: goal.digest, planDigest: expectedPlanDigest, profileDigest: profile.digest,
        workflowPolicy: clone(workflowPolicy),
        workflowPolicyDigest: workflowPolicy.policyDigest,
        strategy: intent.composition.strategy, workspace: intent.composition.workspace,
        join: intent.composition.join,
        workItem: {
          objective: goal.objective,
          definitionOfDone: clone(goal.definitionOfDone),
        },
        roleCatalog: clone(roleCatalog),
        lineage: {
          generation: 1, rootDefinitionDigest: null, parentDefinitionDigest: null,
        },
        attempts: intent.composition.team.map((member) => (
          workflowAttempt(member.role, member.role, `attempt:${member.role}`, roleCatalog)
        )).sort((left, right) => (
          left.role < right.role ? -1 : left.role > right.role ? 1 : 0
        )),
      };
      validateWorkflowDefinitionV3(core, { nodes: normalizedPlan.nodes });
      this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
        ...core, definitionDigest: digest(core),
      }, {
        actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
        key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${intent.runId}:${expectedPlanDigest}`,
      });
    }
    let proposed;
    try {
      proposed = await this.driver.coordinator.proposePlan({
        goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
        predecessor: null,
        nodes: nodeFields,
      }, authority(this.principals.planner, this.repoId, intent.runId, 'plan:propose', `application:${intent.runId}:plan:v1`));
    } catch (error) {
      return this._planningView(this._findRun(intent.runId), error);
    }
    if (proposed.plan.digest !== expectedPlanDigest) {
      throw applicationError('proposed Plan differs from its committed Workflow definition',
        'application_workflow_integrity');
    }
    return this._buildView(this._findRun(intent.runId), this.principals.observer, { expected: { goal, plan: proposed.plan } });
  }

  async approve(runId, planDigest, rawApprover) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId) || typeof planDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(planDigest)) {
      throw applicationError('plan approval target is invalid', 'application_approval_invalid');
    }
    const approver = normalizePrincipal(rawApprover, 'plan approver');
    await this._authorize('run.approve', approver, runId, { planDigest });
    const current = this._findRun(runId);
    this._assertRunMutable(runId);
    if (!current.plan) throw applicationError('run planning has not completed', 'application_run_incomplete');
    if (current.plan.digest !== planDigest) throw applicationError('displayed plan digest is stale', 'application_plan_stale');
    if (this._isWorkflowRun(current)) {
      this._workflowDefinition(current);
      if (current.plan.nodes.some((node) => node.revision)) {
        await this._validateWorkflowRevisionPlan(current);
      }
      if (current.plan.nodes.some((node) => node.contextCall)) {
        this._validateContextEffectPlan(current);
      }
    }
    if (current.approval === null) {
      await this.driver.coordinator.approvePlan({
        goal: { goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
        plan: { planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest },
        expectedDisposition: null,
        disposition: 'approved',
      }, authority(approver, this.repoId, runId, 'plan:approve', `application:${runId}:approval:${planDigest}`));
    } else if (current.approval.disposition !== 'approved') {
      throw applicationError('plan was already denied', 'application_plan_denied');
    }
    await this._dispatchCurrent(this._findRun(runId));
    return this._buildView(this._findRun(runId), this.principals.observer);
  }

  async _goalPlanStatus(current, observer) {
    return this.driver.coordinator.goalPlanStatus(
      refs(current.goal, current.plan),
      authority(observer, this.repoId, current.goal.runId, 'goal:observe', `application:${current.goal.runId}:status:${current.plan.digest}`),
    );
  }

  async status(runId, rawObserver, options = {}, rawContext = null) {
    this._assertOpen();
    await this.ready;
    const context = normalizeCommandContext(rawContext);
    if (!validId(runId)) throw applicationError('run id is invalid', 'application_run_invalid');
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const current = this._findRun(runId, { allowUnavailableProfile: true });
    this._authorizeRecursiveCommand('run.status', runId, observer, context);
    await this._authorize('run.status', observer, runId, {});
    return this._buildView(current, observer, options);
  }

  async recover(runId, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId)) throw applicationError('Run recovery target is invalid', 'application_recovery_invalid');
    const principal = normalizePrincipal(rawPrincipal, 'recovery principal');
    await this._authorize('run.recover', principal, runId, {});
    const current = this._findRun(runId);
    this._assertRunMutable(runId);
    if (!current.plan || current.approval?.disposition !== 'approved') {
      throw applicationError('Run recovery requires an approved current Plan', 'application_recovery_unavailable');
    }
    const policy = current.profile.recoveryPolicy;

    // A closed preservation receipt is already bound to the approved Plan task, exact route,
    // worktree, native session, and Run generation. Restart recovery therefore discovers its
    // target from durable Run state; accepting any of those coordinates from the caller would
    // weaken the receipt. Reattachment is attach-only and does not admit a provider turn.
    const preservedHandles = this.driver.coordinator.list().filter((handle) => (
      handle.runId === runId
      && handle.status === 'orphaned'
      && handle.sessionPreservation?.state === 'preserved'
      && handle.sessionPreservation?.transport === 'attached'
      && handle.sessionRef?.persistence === 'native'
      && validText(handle.sessionRef?.id, 4_096)
      && handle.sessionContext && typeof handle.sessionContext === 'object'
    ));
    if (preservedHandles.length > 1) {
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.recover', result: 'operator_required' },
        recovery: {
          state: 'operator_required', reason: 'multiple_preserved_members', attempt: 0,
          targetCount: preservedHandles.length, target: null, dispatchDisposition: null,
        },
      });
    }
    if (preservedHandles.length === 1) {
      const outcome = await this.driver.coordinator.recover(preservedHandles[0].id, {
        actor: principal.actor,
        ...(Number.isSafeInteger(policy.timeoutMs) && policy.timeoutMs > 0
          ? { timeoutMs: policy.timeoutMs } : {}),
      });
      const result = outcome?.result ?? 'recovery_failed';
      const recovery = outcome?.ok === true ? {
        state: 'interrupted', reattachment: 'confirmed', attempt: 1,
        targetCount: 1, target: null, dispatchDisposition: 'attach_only',
        cleanup: { state: 'owned' },
      } : {
        state: outcome?.reap === 'unconfirmed' ? 'attention' : 'failed',
        reason: result, attempt: 1, targetCount: 1, target: null,
        dispatchDisposition: 'attach_only', reap: outcome?.reap ?? 'unconfirmed',
      };
      return this._buildView(this._findRun(runId), this.principals.observer, {
        action: { command: 'run.recover', result }, recovery,
      });
    }

    if (policy.mode !== 'manual' || !policy.eligibleSessionModes.includes('resume')) {
      throw applicationError('Run recovery is unavailable for this deployment profile', 'application_recovery_unavailable');
    }

    const projection = await this._goalPlanStatus(current, this.principals.observer);
    const projectedByKey = new Map(projection.nodes.map((node) => [node.key, node]));
    const recoveryNodes = current.plan.nodes.filter((node) => {
      const projected = projectedByKey.get(node.key);
      return projected?.state === 'ready'
        && node.capabilities.includes('native_session_recovery')
        && node.effects.includes('provider_call')
        && node.deps.length > 0;
    });
    if (recoveryNodes.length > 1) {
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.recover', result: 'operator_required' },
        recovery: {
          state: 'operator_required', reason: 'multiple_eligible_plan_nodes', attempt: 0,
          targetCount: 0, target: null, dispatchDisposition: null,
        },
      });
    }
    const recoveryNode = recoveryNodes[0] ?? null;
    const predecessorTaskIds = new Set((recoveryNode?.deps ?? [])
      .map((key) => projectedByKey.get(key))
      .filter((node) => node?.state === 'accepted' && validText(node.taskId, 4_096))
      .map((node) => node.taskId));
    const handles = recoveryNode ? this.driver.coordinator.list().filter((handle) => (
      handle.runId === runId
      && predecessorTaskIds.has(handle.taskId)
      && handle.status === 'orphaned'
      && handle.sessionRef?.persistence === 'native'
      && validText(handle.sessionRef?.id, 4_096)
      && handle.sessionContext && typeof handle.sessionContext === 'object'
      && planRouteMatches(recoveryNode.routes, {
        vendor: handle.vendor, model: handle.modelResolved, effort: handle.effortResolved,
      })
    )) : [];
    if (handles.length === 0) {
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.recover', result: 'unavailable' },
        recovery: {
          state: 'unavailable', reason: 'no_eligible_target', attempt: 0,
          targetCount: 0, target: null, dispatchDisposition: null,
        },
      });
    }
    if (handles.length > 1) {
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.recover', result: 'operator_required' },
        recovery: {
          state: 'operator_required', reason: 'multiple_eligible_targets', attempt: 0,
          targetCount: handles.length, target: null, dispatchDisposition: null,
        },
      });
    }
    const selected = handles[0];

    const gate = {
      goalId: current.goal.goalId,
      goalVersion: current.goal.version,
      goalDigest: current.goal.digest,
      planId: current.plan.planId,
      planVersion: current.plan.version,
      planDigest: current.plan.digest,
      nodeKey: recoveryNode.key,
      expectedDispatchVersion: 0,
      capabilities: clone(recoveryNode.capabilities),
      effects: clone(recoveryNode.effects),
      ...(Object.hasOwn(recoveryNode, 'requiredEffects') ? { requiredEffects: clone(recoveryNode.requiredEffects) } : {}),
    };
    if (typeof this.driver.coordinator.recoverPlanBound !== 'function') {
      throw applicationError('application driver lacks Plan recovery authority', 'application_recovery_unavailable');
    }
    const outcome = await this.driver.coordinator.recoverPlanBound(selected.id, {
      actor: principal.actor,
      gate,
      maxAttempts: policy.maxAttempts,
      profileDigest: current.profile.digest,
      recoveryPolicyDigest: digest(policy),
      runId,
      timeoutMs: policy.timeoutMs,
    });
    const result = outcome?.result ?? 'recovery_failed';
    const recoveredHandle = outcome?.handle ?? null;
    const routeRequested = {
      harness: selected.vendor,
      model: selected.modelResolved,
      effort: selected.effortResolved,
    };
    const route = outcome?.route ?? {
      requested: routeRequested,
      resolved: recoveredHandle ? {
        harness: recoveredHandle.harnessResolved,
        model: recoveredHandle.modelResolved,
        effort: recoveredHandle.effortResolved,
      } : null,
      observed: recoveredHandle ? {
        harness: recoveredHandle.harnessResolved,
        model: recoveredHandle.modelObserved,
        effort: recoveredHandle.effortObserved,
      } : null,
    };
    const recovery = outcome?.ok === true ? {
      state: 'working',
      attempt: outcome.attempt ?? 0,
      target: { workerId: selected.id, taskId: outcome.taskId ?? recoveredHandle?.taskId ?? null },
      dispatchDisposition: outcome.dispatchDisposition
        ?? this.driver.coordination.recoveryDispatchState?.(selected.id)?.status ?? null,
      processGeneration: outcome.processGeneration ?? null,
      route: clone(route),
      cleanup: clone(outcome.cleanup ?? { state: 'owned' }),
    } : {
      state: result === 'dispatch_unknown' ? 'operator_required' : 'failed',
      reason: result,
      attempt: outcome?.attempt ?? 0,
      targetCount: 1,
      target: null,
      dispatchDisposition: result === 'dispatch_unknown' ? 'dispatch_unknown' : null,
    };
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.recover', result },
      recovery,
    });
  }

  async evidence(runId, rawObserver) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId)) throw applicationError('Run evidence target is invalid', 'application_evidence_invalid');
    const observer = normalizePrincipal(rawObserver, 'evidence observer');
    await this._authorize('run.evidence', observer, runId, {});
    const current = this._findRun(runId);
    return this._buildEvidence(current);
  }

  async _buildEvidence(current) {
    const runId = current.goal.runId;
    const view = await this._buildView(current, this.principals.observer);
    if (!PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase)) {
      throw applicationError('Run evidence is available only after a terminal outcome', 'application_run_not_terminal');
    }
    if (this._isWorkflowRun(current)) return this._buildWorkflowEvidence(current, view);
    const task = view.nodes[0]?.taskId ? this.driver.coordination.task(view.nodes[0].taskId) : null;
    const adoption = current.plan
      ? this.driver.coordination.runResultAdoption?.(runId, current.plan.nodes[0].key) ?? null
      : null;
    const reviewTask = view.semanticReview?.taskId ? this.driver.coordination.task(view.semanticReview.taskId) : null;
    const relevantSeqs = [task?.createdEvent, task?.claimedEvent, task?.terminalEvent,
      reviewTask?.createdEvent, reviewTask?.claimedEvent, reviewTask?.terminalEvent,
      ...(view.evidence ?? []).map((artifact) => this.driver.coordination.artifact(artifact.id)?.createdEvent),
      adoption?.admittedEvent, adoption?.completedEvent,
      this.driver.coordination.runStop?.(runId)?.admittedEvent,
      this.driver.coordination.runStop?.(runId)?.completedEvent].filter(Number.isSafeInteger);
    const core = {
      schemaVersion: 1,
      kind: 'baton.run.evidence',
      state: 'terminal',
      repoId: this.repoId,
      runId,
      observedThroughSeq: relevantSeqs.length > 0 ? Math.max(...relevantSeqs) : 0,
      bindings: {
        profileDigest: view.profile.digest,
        workerPolicy: clone(view.workerPolicy),
        goal: clone(view.goal),
        plan: view.plan ? {
          id: view.plan.id, version: view.plan.version, digest: view.plan.digest,
          approvalDigest: view.plan.approval?.digest ?? null,
        } : null,
      },
      phase: view.phase,
      progress: clone(view.progress),
      node: view.nodes[0] ? {
        key: current.plan.nodes[0].key,
        taskId: view.nodes[0].taskId,
        state: view.nodes[0].state,
        route: clone(view.route),
      } : null,
      result: clone(view.result),
      integration: clone(view.integration),
      verification: clone(view.verification),
      semanticReview: clone(view.semanticReview),
      integration: clone(view.integration),
      artifacts: clone(view.evidence),
      stop: view.stop ? {
        state: view.stop.state,
        targetDigest: view.stop.targetDigest,
        receiptDigest: view.stop.receipt?.receiptDigest ?? null,
      } : null,
      ownership: { runAuthorityReleased: view.stop?.receipt?.checks?.runAuthorityReleased === true },
      checks: {
        terminalPlanState: PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase),
        acceptedArtifactsReverified: view.result === null
          || (view.result.commitArtifact !== null && view.result.verificationArtifact !== null),
        resultRefReverified: view.result === null || ['pinned', 'integrated'].includes(view.result.preservation.state),
        semanticDispositionConsistent: view.semanticReview.state !== 'semantic_reviewed'
          || /^[a-f0-9]{64}$/u.test(view.semanticReview.receiptDigest ?? ''),
        integrationAuthoritative: view.integration === null || view.phase === 'completed',
      },
    };
    const manifest = deepFreeze({ ...core, manifestDigest: digest(core) });
    if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run evidence exceeds its deployment byte ceiling', 'application_evidence_oversize');
    }
    return manifest;
  }

  _buildWorkflowEvidence(current, view) {
    const runId = current.goal.runId;
    const roundPlanDigests = new Set((view.rounds ?? []).map((round) => round.plan.digest));
    const workflowKinds = new Set([
      APPLICATION_WORKFLOW_RECORD_KIND,
      APPLICATION_WORKFLOW_SELECTION_RECORD_KIND,
      APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND,
      APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND,
      APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND,
    ]);
    const workflowSeqs = this.driver.coordination.events().filter((event) => (
      event.kind === 'driver.recorded' && workflowKinds.has(event.payload?.kind)
      && event.payload?.repoId === this.repoId && event.payload?.runId === runId
      && roundPlanDigests.has(event.payload?.planDigest)
    )).map((event) => event.seq);
    const taskSeqs = view.nodes.flatMap((node) => {
      const task = node.taskId ? this.driver.coordination.task(node.taskId) : null;
      return task ? [task.createdEvent, task.claimedEvent, task.terminalEvent] : [];
    }).filter(Number.isSafeInteger);
    const artifactSeqs = view.candidates.flatMap((candidate) => (
      [candidate.evidence.commitArtifact.id, candidate.evidence.verificationArtifact.id]
        .map((artifactId) => this.driver.coordination.artifact(artifactId)?.createdEvent)
    )).filter(Number.isSafeInteger);
    const historicalArtifactSeqs = (view.rounds ?? []).flatMap((round) => (
      round.candidates.flatMap((candidate) => (
        [candidate.evidence.commitArtifact.id, candidate.evidence.verificationArtifact.id]
          .map((artifactId) => this.driver.coordination.artifact(artifactId)?.createdEvent)
      ))
    )).filter(Number.isSafeInteger);
    const runStop = this.driver.coordination.runStop?.(runId) ?? null;
    const relevantSeqs = [
      ...workflowSeqs, ...taskSeqs, ...artifactSeqs, ...historicalArtifactSeqs,
      runStop?.admittedEvent, runStop?.completedEvent,
    ].filter(Number.isSafeInteger);
    const core = {
      schemaVersion: 1,
      kind: 'baton.workflow.evidence',
      state: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase) ? 'terminal' : 'provider_settled',
      repoId: this.repoId,
      runId,
      observedThroughSeq: relevantSeqs.length > 0 ? Math.max(...relevantSeqs) : 0,
      bindings: {
        profileDigest: view.profile.digest,
        workerPolicy: clone(view.workerPolicy),
        goal: clone(view.goal),
        plan: {
          id: view.plan.id, version: view.plan.version, digest: view.plan.digest,
          approvalDigest: view.plan.approval?.digest ?? null,
        },
        workflow: clone(view.workflow),
      },
      phase: view.phase,
      progress: clone(view.progress),
      attempts: clone(view.attempts),
      candidates: clone(view.candidates),
      feedback: clone(view.feedback),
      memberStops: clone(view.memberStops),
      selection: clone(view.selection),
      rounds: clone(view.rounds ?? []),
      result: clone(view.result),
      verification: clone(view.verification),
      stop: view.stop ? {
        state: view.stop.state,
        targetDigest: view.stop.targetDigest,
        receiptDigest: view.stop.receipt?.receiptDigest ?? null,
      } : null,
      ownership: { runAuthorityReleased: view.stop?.receipt?.checks?.runAuthorityReleased === true },
      checks: {
        terminalPlanState: PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase),
        candidatesMechanicallyVerified: view.candidates.every((candidate) => (
          /^[a-f0-9]{40,64}$/u.test(candidate.resultSha)
          && /^[a-f0-9]{64}$/u.test(candidate.evidenceDigest)
          && /^[a-f0-9]{64}$/u.test(candidate.evidence.commitArtifact.digest)
          && /^[a-f0-9]{64}$/u.test(candidate.evidence.verificationArtifact.digest)
        )),
        candidatesRetained: view.candidates.every((candidate) => (
          candidate.retention?.state === 'pinned'
          && candidate.retainedResultRef === `refs/baton/results/${candidate.resultSha}`
        )),
        selectedResultRefReverified: view.result === null
          || view.result.state === 'selection_required'
          || ['pinned', 'integrated'].includes(view.result.preservation?.state),
        feedbackTargetsBound: view.feedback.every((packet) => view.candidates.some((candidate) => (
          candidate.candidateId === packet.target.candidateId
          && candidate.candidateDigest === packet.target.candidateDigest
        ))),
        selectionBound: view.selection === null || view.candidates.some((candidate) => (
          candidate.candidateId === view.selection.candidate.id
          && candidate.candidateDigest === view.selection.candidate.digest
        )),
        sharedMultiwriterAbsent: view.workflow.workspace === 'isolated',
        roundLineageComplete: (view.rounds ?? []).every((round, index, rounds) => (
          index === 0 ? round.plan.predecessor === null
            : round.plan.predecessor?.planId === rounds[index - 1].plan.id
              && round.plan.predecessor?.version === rounds[index - 1].plan.version
              && round.plan.predecessor?.digest === rounds[index - 1].plan.digest
        )),
        allRoundCandidatesRetained: (view.rounds ?? []).every((round) => (
          round.candidates.every((candidate) => candidate.retention?.state === 'pinned'
            && candidate.retainedResultRef === `refs/baton/results/${candidate.resultSha}`)
        )),
        revisionBasesBound: (view.rounds ?? []).every((round, index, rounds) => (
          index === 0 || (round.revision !== null
            && rounds[index - 1].candidates.some((candidate) => (
              candidate.candidateId === round.revision.parentCandidateId
              && candidate.resultSha === round.revision.parentResultSha
            )))
        )),
        providerExecutionSettled: PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase),
        applicationTerminal: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
        integrationAuthoritative: view.integration === null || view.phase === 'completed',
      },
    };
    const manifest = deepFreeze({ ...core, manifestDigest: digest(core) });
    if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Workflow evidence exceeds its deployment byte ceiling',
        'application_evidence_oversize');
    }
    return manifest;
  }

  async adopt(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeAdopt(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'adoption principal');
    await this._authorize('run.adopt', principal, request.runId, {
      nodeKey: request.nodeKey, resultSha: request.resultSha,
      evidenceDigest: request.evidenceDigest, reasonDigest: digest(request.reason),
    });
    const current = this._findRun(request.runId);
    const planNode = current.plan?.nodes.find((node) => node.key === request.nodeKey) ?? null;
    if (!current.plan || !planNode) {
      throw applicationError('Run adoption node is unavailable', 'application_adopt_invalid');
    }
    if (this._isWorkflowRun(current)) {
      const workflowView = await this._buildWorkflowView(current, this.principals.observer);
      if (!workflowView.selection || workflowView.result?.nodeKey !== request.nodeKey
        || workflowView.result?.sha !== request.resultSha) {
        throw applicationError('Workflow adoption requires its exact selected Candidate',
          'application_adopt_invalid');
      }
    }
    if (current.profile.resultPolicy.mode !== 'manual' || current.profile.resultPolicy.maxAdoptedResults !== 1) {
      throw applicationError('Run profile does not permit result adoption', 'application_adopt_forbidden');
    }
    const existing = this.driver.coordination.runResultAdoption(request.runId, request.nodeKey);
    if (existing) {
      if (existing.resultSha !== request.resultSha || existing.evidenceDigest !== request.evidenceDigest
        || existing.reasonDigest !== digest(request.reason)) {
        throw applicationError('Run adoption request differs from its durable admission', 'application_adopt_conflict');
      }
      const receipt = await this._performResultAdoption(existing);
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.adopt', result: 'adopted', receiptDigest: receipt.receiptDigest },
      });
    }
    const manifest = await this._buildEvidence(current);
    if (manifest.manifestDigest !== request.evidenceDigest || manifest.result?.sha !== request.resultSha
      || manifest.result?.nodeKey !== request.nodeKey || manifest.result?.preservation?.state !== 'pinned') {
      throw applicationError('Run adoption target differs from the displayed evidence', 'application_evidence_stale');
    }
    const taskId = manifest.node?.taskId ?? manifest.result?.taskId;
    if (!validText(taskId, 4_096)) throw applicationError('Run has no accepted task result', 'application_result_unavailable');
    const reasonDigest = digest(request.reason);
    const requestCore = {
      repoId: this.repoId, runId: request.runId, nodeKey: request.nodeKey, taskId,
      resultSha: request.resultSha, evidenceDigest: request.evidenceDigest, reasonDigest,
    };
    const admitted = this.driver.coordination.admitRunResultAdoption({
      schemaVersion: 1, ...requestCore, requestDigest: digest(requestCore),
    }, { actor: principal.actor, key: `run.result_adoption:${request.runId}:${request.nodeKey}` });
    const receipt = await this._performResultAdoption(admitted.adoption);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.adopt', result: 'adopted', receiptDigest: receipt.receiptDigest },
    });
  }

  _performRunVerificationRetry(admission) {
    const key = `${admission.runId}\0${admission.nodeKey}\0${admission.attempt}`;
    const existing = this._runRetryPromises.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const controllers = this._runRetryControllers.get(admission.runId) ?? new Set();
    controllers.add(controller);
    this._runRetryControllers.set(admission.runId, controllers);
    const operation = (async () => {
      const current = this.driver.coordination.runVerificationRetry(admission.runId, admission.nodeKey);
      if (!current || current.attempt !== admission.attempt) {
        throw applicationError('Run verification retry admission is unavailable', 'application_retry_incomplete');
      }
      if (current.status !== 'pending') return current.receipt;
      const task = this.driver.coordination.task(current.taskId);
      if (!task?.assignee) throw applicationError('Run verification retry worker authority is unavailable', 'application_retry_incomplete');
      try {
        return await this.driver.coordinator.retryVerification(task.assignee, {
          runId: current.runId, nodeKey: current.nodeKey, attempt: current.attempt, signal: controller.signal,
        });
      } catch (error) {
        if (error?.code === 'verification_retry_cancelled') {
          throw applicationError('Run verification retry was cancelled by stop authority', 'application_retry_cancelled');
        }
        throw error;
      }
    })();
    this._runRetryPromises.set(key, operation);
    operation.finally(() => {
      if (this._runRetryPromises.get(key) === operation) this._runRetryPromises.delete(key);
      controllers.delete(controller);
      if (controllers.size === 0 && this._runRetryControllers.get(admission.runId) === controllers) {
        this._runRetryControllers.delete(admission.runId);
      }
    }).catch(() => {});
    return operation;
  }

  _cancelRunVerificationRetry(pending) {
    const receiptCore = {
      schemaVersion: 1,
      scope: 'run-verification-retry',
      state: 'cancelled',
      repoId: pending.repoId,
      runId: pending.runId,
      nodeKey: pending.nodeKey,
      taskId: pending.taskId,
      attempt: pending.attempt,
      originOutcome: pending.originOutcome,
      admissionDigest: pending.admissionDigest,
      outcome: { disposition: { candidate: null, base: null }, runtimeDigest: null, verdictDigest: null },
      stability: null,
      evidence: null,
      result: null,
      checkpoint: {
        state: 'pinned', sha: pending.checkpointSha, originOutcome: pending.originOutcome,
      },
    };
    const receipt = { ...receiptCore, receiptDigest: digest(receiptCore) };
    return this.driver.coordination.completeRunVerificationRetry({
      schemaVersion: 1, runId: pending.runId, nodeKey: pending.nodeKey, attempt: pending.attempt, receipt, manifests: [],
    }, { actor: pending.actor, key: `run.verification_retry.complete:${pending.runId}:${pending.nodeKey}:${pending.attempt}` });
  }

  async _reconcileRunVerificationRetries() {
    this._assertOpen();
    if (typeof this.driver.coordination.pendingRunVerificationRetries !== 'function'
      || typeof this.driver.coordinator.retryVerification !== 'function') return;
    for (const pending of this.driver.coordination.pendingRunVerificationRetries()) {
      if (this.driver.coordination.runStop?.(pending.runId)) {
        this._cancelRunVerificationRetry(pending);
        continue;
      }
      try {
        await this._performRunVerificationRetry(pending);
      } catch (error) {
        if (['verification_retry_conflict', 'verification_retry_unavailable', 'application_retry_cancelled'].includes(error?.code)) {
          // The admission no longer matches current deployment authority (e.g. a corrected
          // verifier runtime after restart). Settle it as cancelled so the Run stays actionable
          // through a fresh admission instead of blocking readiness.
          if (this.driver.coordination.runVerificationRetry(pending.runId, pending.nodeKey)?.status === 'pending') {
            this._cancelRunVerificationRetry(pending);
          }
          continue;
        }
        throw error;
      }
    }
  }

  async retryVerification(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeRetryVerification(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'verification retry principal');
    await this._authorize('run.retry_verification', principal, request.runId, { reasonDigest: digest(request.reason) });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    if (!current.plan || current.plan.nodes.length !== 1 || current.approval?.disposition !== 'approved') {
      throw applicationError('Run verification retry requires one approved Plan node', 'application_retry_unavailable');
    }
    const nodeKey = current.plan.nodes[0].key;
    const existing = this.driver.coordination.runVerificationRetry?.(request.runId, nodeKey) ?? null;
    if (existing?.status === 'pending') {
      const receipt = await this._performRunVerificationRetry(existing);
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.retry_verification', result: receipt.state, receiptDigest: receipt.receiptDigest },
      });
    }
    if (existing?.originOutcome === 'candidate_failed' && existing.receipt) {
      return this._buildView(current, this.principals.observer, {
        action: {
          command: 'run.retry_verification', result: 'replayed',
          state: existing.receipt.state, receiptDigest: existing.receipt.receiptDigest,
        },
      });
    }
    const view = await this._buildView(current, this.principals.observer);
    const retry = view.verification?.retry;
    if (!retry) throw applicationError('Run has no retryable verification', 'application_retry_unavailable');
    if (!retry.available || !retry.candidatePreserved) {
      throw applicationError('Run verification retry authority is stale or unavailable', 'application_retry_stale');
    }
    const node = view.nodes[0];
    const task = node?.taskId ? this.driver.coordination.task(node.taskId) : null;
    if (!task?.assignee) throw applicationError('Run verification retry worker authority is unavailable', 'application_retry_unavailable');
    const terminalResult = await this.driver.coordinator.result(task.assignee);
    const diagnosticCheckpoint = terminalResult?.checkpoint;
    if (diagnosticCheckpoint?.state !== 'pinned'
      || diagnosticCheckpoint.sha !== retry.checkpointSha
      || !['inconclusive', 'candidate_failed'].includes(diagnosticCheckpoint.originOutcome)) {
      throw applicationError('Run verification retry diagnostic checkpoint is unavailable', 'application_retry_unavailable');
    }
    const artifacts = (task.artifactIds ?? []).map((id) => this.driver.coordination.artifact(id)).filter(Boolean);
    const priorArtifact = artifacts.filter((artifact) => artifact.kind === 'verification')
      .sort((left, right) => (left.createdEvent ?? 0) - (right.createdEvent ?? 0)).at(-1);
    const priorSeq = priorArtifact?.provenance
      ?.find((ref) => Number.isSafeInteger(ref?.coordinationSeq))?.coordinationSeq;
    if (!Number.isSafeInteger(priorSeq)) {
      throw applicationError('Run verification retry evidence is unavailable', 'application_retry_unavailable');
    }
    const runtimePolicyDigest = this.driver.coordinator.verificationRuntimeDigest?.();
    if (!/^[a-f0-9]{64}$/u.test(runtimePolicyDigest ?? '')) {
      throw applicationError('Run verification retry requires a deployment verifier runtime identity', 'application_retry_unavailable');
    }
    const requestCore = {
      attempt: retry.attempt,
      baseSha: terminalResult.sessionContext?.baseSha ?? null,
      checkpointRef: diagnosticCheckpoint.ref,
      checkpointSha: retry.checkpointSha,
      nodeKey,
      originOutcome: diagnosticCheckpoint.originOutcome,
      planDigest: current.plan.digest,
      priorEvidence: { coordinationSeq: priorSeq },
      reasonDigest: digest(request.reason),
      repoId: this.repoId,
      runId: request.runId,
      runtimePolicyDigest,
      schemaVersion: 1,
      taskId: task.id,
      toolchainDigest: digest(terminalResult.sessionContext?.toolchainProjection ?? null),
      verificationDigest: digest(current.plan.nodes[0].verification),
    };
    const admitted = this.driver.coordination.admitRunVerificationRetry({
      ...requestCore, requestDigest: digest(requestCore),
    }, { actor: principal.actor, key: `run.verification_retry:${request.runId}:${nodeKey}:${retry.attempt}` });
    const receipt = await this._performRunVerificationRetry(admitted.retry);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.retry_verification', result: receipt.state, receiptDigest: receipt.receiptDigest },
    });
  }

  // PS5: the preserved-work branch of the recovery cascade. Where run.recover reattaches an
  // attachable native session, resume_work restores a terminal preserved checkpoint into a fresh
  // owned task. The caller supplies only a bounded reason; every coordinate is server-derived
  // from the approved Plan, the pinned checkpoint, and the orchestrator-selected route policy.
  async resumeWork(rawRequest, rawPrincipal, internal = {}) {
    this._assertOpen();
    await this.ready;
    const request = normalizeResumeWork(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'resume principal');
    await this._authorize('run.resume_work', principal, request.runId, { reasonDigest: digest(request.reason) });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    if (!current.plan || current.approval?.disposition !== 'approved') {
      throw applicationError('Run resume requires an approved current Plan', 'application_resume_unavailable');
    }
    const view = await this._buildView(current, this.principals.observer);
    if (view.phase !== 'cancelled') {
      throw applicationError('Run resume requires a cancelled Run with preserved progress', 'application_resume_unavailable');
    }
    const node = view.nodes[0];
    const task = node?.taskId ? this.driver.coordination.task(node.taskId) : null;
    if (!task?.assignee) {
      throw applicationError('Run resume preserved worker is unavailable', 'application_resume_unavailable');
    }
    const workerId = task.assignee;
    let preservedResult;
    try { preservedResult = await this.driver.coordinator.result(workerId); }
    catch (error) { if (error?.code !== 'not_found') throw error; }
    const checkpoint = preservedResult?.checkpoint?.state === 'pinned' ? preservedResult.checkpoint : null;
    if (!checkpoint || !/^[a-f0-9]{40,64}$/u.test(checkpoint.sha ?? '') || typeof checkpoint.ref !== 'string') {
      throw applicationError('Run resume preserved checkpoint is unavailable', 'application_resume_unavailable');
    }
    if (typeof this.driver.coordinator.resumePreservedWork !== 'function') {
      throw applicationError('application driver lacks preserved resume authority', 'application_resume_unavailable');
    }
    // Resume the exact route durably selected for the cancelled dispatch. A singleton Plan route
    // is only the pre-dispatch fallback; Baton never invents a tuple from multi-route authority.
    const planNode = current.plan.nodes[0];
    const requestedRoute = requestedPlanNodeRoute(planNode, current.dispatch, 'Resume Plan node');
    const route = {
      vendor: requestedRoute.harness,
      model: requestedRoute.model,
      effort: requestedRoute.effort,
    };
    const gate = {
      goalId: current.goal.goalId, goalVersion: current.goal.version, goalDigest: current.goal.digest,
      planId: current.plan.planId, planVersion: current.plan.version, planDigest: current.plan.digest,
      nodeKey: planNode.key, expectedDispatchVersion: 0,
      capabilities: clone(planNode.capabilities), effects: clone(planNode.effects),
      ...(Object.hasOwn(planNode, 'requiredEffects') ? { requiredEffects: clone(planNode.requiredEffects) } : {}),
    };
    const resumeTaskId = `baton-${digest({
      repoId: this.repoId, runId: request.runId, planDigest: current.plan.digest,
      nodeKey: planNode.key, checkpointSha: checkpoint.sha, resume: true,
    }).slice(0, 24)}-resume`;
    const outcome = await this.driver.coordinator.resumePreservedWork(workerId, {
      actor: this.principals.dispatcher.actor,
      principalId: this.principals.dispatcher.principalId,
      sessionId: this.principals.dispatcher.sessionId,
      powers: ['plan:dispatch'],
      runId: request.runId,
      taskId: resumeTaskId,
      idempotencyKey: `application:${request.runId}:resume:${planNode.key}:${checkpoint.sha}`,
      reasonDigest: digest(request.reason),
      gate, route,
      checkpointSha: checkpoint.sha,
      checkpointRef: checkpoint.ref,
      semanticActionId: internal.actionId,
      semanticPrincipalScopeDigest: internal.principalScopeDigest,
    });
    const resume = outcome?.ok === true ? {
      state: 'working',
      preservedTaskId: outcome.preservedTaskId ?? null,
      target: { workerId: outcome.workerId ?? null, taskId: outcome.taskId ?? null },
      checkpoint: { state: 'pinned', sha: checkpoint.sha },
      route: clone(outcome.route ?? null),
      cleanup: clone(outcome.cleanup ?? { state: 'owned' }),
    } : {
      state: 'failed', reason: outcome?.result ?? 'resume_failed', target: null,
    };
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.resume_work', result: outcome?.ok === true ? 'resumed' : (outcome?.result ?? 'resume_failed') },
      resume,
    });
  }

  async review(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeReviewRequest(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'review principal');
    await this._authorize('run.review', principal, request.runId, {
      route: request.route, reasonDigest: digest(request.reason),
    });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    if (current.profile.reviewPolicy.mode !== 'required') {
      throw applicationError('Run profile does not permit semantic review', 'application_review_forbidden');
    }
    if (!current.profile.reviewPolicy.routes.some((route) => routeEqual(route, request.route))) {
      throw applicationError('semantic review route is outside deployment policy', 'application_review_route_forbidden');
    }
    const view = await this._buildView(current, this.principals.observer);
    if (!['work_completed', 'reviewing'].includes(view.phase) || !view.result?.sha) {
      throw applicationError('Run has no reviewable accepted result', 'application_review_unavailable');
    }
    const implementerRoute = selectExactRouteCard(this._routeCards, view.route.requested);
    const reviewerRoute = selectExactRouteCard(this._routeCards, request.route);
    if (!implementerRoute || !reviewerRoute || implementerRoute.name === reviewerRoute.name
      || implementerRoute.card.modelSelection?.family === reviewerRoute.card.modelSelection?.family) {
      throw applicationError('semantic review route is not independent from the implementer', 'application_review_not_independent');
    }
    const target = this._semanticTarget(current, view);
    if (!target) throw applicationError('semantic review target is unavailable', 'application_review_unavailable');
    const taskId = this._semanticTaskId(target);
    const existing = this.driver.coordination.task(taskId);
    if (existing) {
      const structured = existing.review?.structured;
      if (structured?.targetDigest !== target.targetDigest || structured.reportPath !== current.profile.reviewPolicy.reportPath
        || existing.vendorRequested !== request.route.harness || existing.modelRequested !== request.route.model
        || existing.effortRequested !== request.route.effort) {
        throw applicationError('semantic review durable identity conflicts with this request', 'application_review_conflict');
      }
      const handle = this.driver.coordinator.list().find((candidate) => candidate.taskId === taskId);
      if (handle) this._performSemanticReviewLifecycle(handle.id, target.targetDigest).catch(() => {});
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.review', result: 'replayed', taskId },
      });
    }
    const parentTask = this.driver.coordination.task(target.taskId);
    if (!parentTask?.assignee) throw applicationError('semantic review parent worker is unavailable', 'application_review_unavailable');
    const { targetDigest, ...targetCore } = target;
    const reportPath = current.profile.reviewPolicy.reportPath;
    const reportContract = {
      schemaVersion: 1,
      purpose: 'run_semantic_review',
      target: targetCore,
      targetDigest,
      reportPath,
      maxReportBytes: current.profile.reviewPolicy.maxReportBytes,
    };
    const outputFormat = [
      'Write one JSON object and no Markdown. An approval with no findings has this exact shape:',
      JSON.stringify({
        schemaVersion: 1,
        targetDigest,
        verdict: 'approved',
        summary: 'Bounded evidence-grounded summary.',
        findings: [],
      }),
      'Each optional finding must have exactly: id, severity (P0|P1|P2|P3), disposition (confirmed|contradicted|unverifiable), claim, source, evidence, requiredCorrection.',
      'source must have exactly: path, startLine, startColumn, endLine, endColumn, contentDigest. Coordinates are one-based Unicode scalars, start inclusive and end exclusive.',
      'evidence entries are either {"kind":"artifact","id":"...","digest":"..."} from the supplied target or {"kind":"representation","identityDigest":"...","graphDigest":"..."}.',
      'requiredCorrection is bounded text only for confirmed findings and null otherwise. The top-level verdict must be revision_required for any confirmed finding, unverifiable for any unverifiable finding, and approved otherwise.',
      'If the exact target satisfies the objective and you found no defect, use approved with findings: []. Do not invent a contradicted or ceremonial finding merely to demonstrate the schema.',
    ].join('\n');
    const reviewer = await this.driver.coordinator.spawnReview(parentTask.assignee, request.route.harness, {
      taskId,
      kind: 'review',
      model: request.route.model,
      effort: request.route.effort,
      actor: principal.actor,
      structured: reportContract,
      goal: `Independently review exact Run result ${target.resultSha} and emit the configured structured semantic report`,
      constraints: [
        `Write exactly one UTF-8 JSON report at ${reportPath}; modify no other path.`,
        `Bind targetDigest ${targetDigest} exactly.`,
        'Use the closed Phase 65 report schema. Treat every worker claim as untrusted and inspect immutable Git objects.',
        'Findings require exact one-based Unicode-scalar source ranges, content digests, evidence references, and conservative dispositions.',
        'Report an empty findings array when the target is sound; do not manufacture a finding solely to populate the schema.',
        `Inspect the exact changed paths first and keep review focused there: ${target.changedPaths.join(', ')}`,
        `Reason: ${request.reason}`,
      ],
      definitionOfDone: `Only ${reportPath} changes and contains one valid target-bound semantic review report`,
      outputFormat,
      verification: {
        command: '/bin/test', arguments: ['-s', reportPath], cwd: '.', envAllowlist: ['PATH'],
        expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000,
        maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
      },
      budget: {
        tokens: current.profile.nodeBudget.tokens,
        usd: current.profile.nodeBudget.usd,
        wallMin: current.profile.nodeBudget.wallMin,
      },
    });
    this._performSemanticReviewLifecycle(reviewer.id, targetDigest).catch(() => {});
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.review', result: 'started', taskId, workerId: reviewer.id },
    });
  }

  async integrate(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeIntegrationRequest(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'integration principal');
    return this._withRunEffect(request.runId, () => this._integrate(request, principal));
  }

  async _integrate(request, principal) {
    await this._authorize('run.integrate', principal, request.runId, {
      evidenceDigest: request.evidenceDigest, strategy: request.strategy, reasonDigest: digest(request.reason),
    });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    const policy = current.profile.integrationPolicy;
    if (policy.mode !== 'manual' || !policy.strategies.includes(request.strategy)) {
      throw applicationError('Run profile does not permit this integration strategy', 'application_integration_forbidden');
    }
    const before = await this._buildView(current, this.principals.observer);
    if (before.integration) {
      if (before.integration.strategy !== request.strategy) {
        throw applicationError('Run is already integrated with a different strategy', 'application_integration_conflict');
      }
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.integrate', result: 'replayed', strategy: request.strategy },
      });
    }
    if (policy.requireSemanticReview && before.semanticReview.state !== 'semantic_reviewed') {
      throw applicationError('Run integration requires a successful independent semantic review', 'application_semantic_review_required');
    }
    if (policy.requireAdoptedResult && before.result?.state !== 'adopted') {
      throw applicationError('Run integration requires explicit result adoption', 'application_result_adoption_required');
    }
    const manifest = await this._buildEvidence(current);
    if (manifest.manifestDigest !== request.evidenceDigest || manifest.result?.sha !== before.result?.sha
      || manifest.semanticReview?.receiptDigest !== before.semanticReview?.receiptDigest) {
      throw applicationError('Run integration target differs from the displayed evidence', 'application_evidence_stale');
    }
    const integrationTaskId = manifest.node?.taskId ?? manifest.result?.taskId;
    const task = validText(integrationTaskId, 4_096)
      ? this.driver.coordination.task(integrationTaskId) : null;
    if (!task?.assignee) throw applicationError('Run integration worker authority is unavailable', 'application_integration_unavailable');
    const outcome = await this.driver.coordinator.integrate(task.assignee, {
      strategy: request.strategy, actor: principal.actor,
    });
    if (outcome?.ok !== true || outcome?.result !== 'integrated') {
      throw applicationError('Run integration did not complete', 'application_integration_incomplete');
    }
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.integrate', result: 'integrated', strategy: request.strategy, reason: request.reason },
    });
  }

  async export(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    validateApplicationCommandArgs('run.export', rawRequest);
    const request = deepFreeze(clone(rawRequest));
    const principal = normalizePrincipal(rawPrincipal, 'export principal');
    return this._withRunEffect(request.runId, () => this._export(request, principal));
  }

  async _export(request, principal) {
    await this._authorize('run.export', principal, request.runId, { evidenceDigest: request.evidenceDigest });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    const policy = current.profile.exportPolicy;
    if (policy.mode !== 'manual' || !this.exportRoot) {
      throw applicationError('Run profile does not permit result export', 'application_export_forbidden');
    }
    const before = await this._buildView(current, this.principals.observer);
    if (policy.requireAdoptedResult && before.result?.state !== 'adopted') {
      throw applicationError('Run export requires explicit result adoption', 'application_result_adoption_required');
    }
    if (policy.requireSemanticReview && before.semanticReview?.state !== 'semantic_reviewed') {
      throw applicationError('Run export requires a successful independent semantic review', 'application_semantic_review_required');
    }
    if (policy.requireIntegration && before.integration?.state !== 'integrated') {
      throw applicationError('Run export requires an integrated result', 'application_integration_required');
    }
    const evidence = await this._buildEvidence(current);
    if (evidence.manifestDigest !== request.evidenceDigest
      || !evidence.result?.sha || evidence.result.sha !== before.result?.sha
      || evidence.result.nodeKey !== current.plan?.nodes[0]?.key) {
      throw applicationError('Run export target differs from the displayed evidence', 'application_evidence_stale');
    }
    const taskId = evidence.node?.taskId;
    const task = validText(taskId, 4_096) ? this.driver.coordination.task(taskId) : null;
    if (!task?.assignee) throw applicationError('Run export worker authority is unavailable', 'application_export_unavailable');
    const exportIdentity = {
      repoId: this.repoId,
      runId: request.runId,
      nodeKey: evidence.result.nodeKey,
      taskId,
      resultSha: evidence.result.sha,
      evidenceDigest: request.evidenceDigest,
      profileDigest: current.profile.digest,
      exportPolicyDigest: digest(policy),
      exportRootDigest: this.exportRootDigest,
      adoptionReceiptDigest: evidence.result.adoption?.receiptDigest ?? null,
      semanticReviewTaskId: evidence.semanticReview?.taskId ?? null,
      semanticReviewReceiptDigest: evidence.semanticReview?.receiptDigest ?? null,
      integrationAfterSha: evidence.integration?.afterSha ?? null,
      format: policy.format,
      maxFiles: policy.maxFiles,
      maxBytes: policy.maxBytes,
    };
    exportIdentity.stagingNonce = uuidFromDigest(digest({
      schemaVersion: 1, purpose: 'result_export_stage', exportIdentity,
    }));
    const exportId = digest(exportIdentity);
    let admitted;
    try {
      admitted = this.driver.coordination.admitRunResultExport({
        schemaVersion: 1,
        ...clone(exportIdentity),
        exportId,
        requestDigest: exportId,
      }, { actor: principal.actor, key: `run.result_export:${request.runId}:${evidence.result.nodeKey}` });
    } catch (cause) {
      const codes = {
        run_result_export_conflict: 'application_export_conflict',
        run_result_export_invalid: 'application_export_invalid',
        run_result_export_unavailable: 'application_export_unavailable',
        run_stopping: 'application_run_stopping',
      };
      throw Object.assign(applicationError('Run result export admission failed', codes[cause?.code] ?? 'application_export_incomplete'), { cause });
    }
    const receipt = await this._performResultExport(admitted.export);
    const delivery = this.resultExportLifecycle.deriveArchive({
      receipt,
      maxArchiveBytes: resultExportArchiveCeiling(policy),
    }).descriptor;
    const view = await this._buildView(current, this.principals.observer, {
      action: { command: 'run.export', result: admitted.result === 'replay' ? 'replayed' : 'completed', exportId },
    });
    const response = deepFreeze({ ...clone(view), export: receipt, delivery });
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run export response exceeds its deployment byte ceiling', 'application_export_oversize');
    }
    return response;
  }

  _planningView(current, cause = null) {
    const runStop = this.driver.coordination.runStop?.(current.goal.runId) ?? null;
    const stop = runStop ? {
      state: runStop.status, admittedAt: runStop.admittedAt, completedAt: runStop.completedAt,
      targetCount: runStop.targetWorkerIds.length, targetDigest: runStop.targetDigest, receipt: clone(runStop.receipt),
    } : null;
    const phase = runStop?.status === 'stopped' ? 'stopped' : runStop ? 'stopping' : (cause ? 'planning_failed' : 'planning');
    const semanticReview = { state: 'semantics_unverified', findings: [] };
    const progress = runProgress({
      phase, approval: null, node: null, route: null,
      verification: { state: 'pending' }, reviewPolicyMode: current.profile.reviewPolicy.mode, semanticReview, result: null,
      integration: null, exportResult: null, resourcesSettled: runStop?.receipt?.remainingCount === 0, stop,
    });
    const view = {
      schemaVersion: 1,
      runId: current.goal.runId,
      objective: current.goal.objective,
      profile: { name: current.profileName, digest: current.profile.digest },
      phase,
      cursor: this.driver.coordination.snapshot().lastSeq,
      nextActions: runStop?.status === 'stopped' ? [{ kind: 'evidence' }]
        : runStop ? [{ kind: 'wait' }, { kind: 'status' }] : [{ kind: 'retry_planning' }],
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: null,
      planPreview: null,
      nodes: [],
      route: null,
      budget: {
        allocated: clone(current.goal.budget), node: null,
        termination: projectTypedTerminalCause({ runStop }),
      },
      attention: [],
      attentionTruncated: false,
      verification: { state: 'pending', verdict: null },
      semanticReview,
      progress,
      result: null,
      integration: null,
      export: null,
      ownership: { workers: 0, workerIds: [], closed: false },
      evidence: [],
      narrative: runStop?.status === 'stopped' ? 'Run stopped; its dispatch authority is closed and its exact stop receipt is attached.'
        : runStop ? 'Run stop is durably admitted and physical ownership is converging.'
          : (cause ? 'Goal admitted; Plan proposal failed and is safe to retry.' : 'Goal admitted; planning is pending.'),
      lastError: cause ? { code: cause.code ?? cause.name ?? 'planning_failed' } : null,
      lastAction: null,
      recovery: null,
      terminalCause: projectTypedTerminalCause({ runStop }),
      stop,
      close: null,
    };
    if (Buffer.byteLength(JSON.stringify(view)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run view exceeds its deployment byte ceiling', 'application_run_view_oversize');
    }
    return deepFreeze(view);
  }

  async _historicalProfileView(current, observer, options = {}) {
    const runId = current.goal.runId;
    if (options.expected) {
      throw applicationError('historical Run policy is unavailable for mutation replay', 'application_profile_stale');
    }
    const projection = current.plan ? await this._goalPlanStatus(current, observer) : null;
    const node = projection?.nodes?.[0] ?? null;
    const task = node?.taskId ? this.driver.coordination.task(node.taskId) : null;
    const workerId = task?.assignee ?? null;
    let terminalResult = null;
    if (workerId) {
      try { terminalResult = await this.driver.coordinator.result(workerId); }
      catch (error) { if (error?.code !== 'not_found') throw error; }
    }
    let phase = !current.plan ? 'planning'
      : !projection?.approval ? 'awaiting_plan_approval'
        : projection.approval.disposition === 'rejected' ? 'denied'
          : node?.state === 'accepted' ? 'work_completed'
            : node?.state === 'failed' ? 'failed'
              : node?.state === 'cancelled' ? 'cancelled'
                : node?.taskId ? 'running' : 'approved';
    const runStop = this.driver.coordination.runStop?.(runId) ?? null;
    if (runStop?.status === 'stopped') phase = 'stopped';
    else if (runStop) phase = 'stopping';
    const { workers, ownedWorkers } = runWorkerOwnership(this.driver, runId);
    const ownedWorker = workerId ? workers.find((handle) => handle.id === workerId) ?? null : null;
    if (!runStop && phase === 'running' && ownedWorker?.status === 'interrupted'
      && ownedWorker.controllableAttached === true) phase = 'interrupted';
    else if (!runStop && phase === 'running' && sessionAttachmentUnproven(ownedWorker)) {
      phase = 'interruption_uncertain';
    }
    const requested = current.plan
      ? requestedPlanNodeRoute(current.plan.nodes[0], current.dispatch, 'Historical Plan node')
      : null;
    const route = requested ? projectRunRouteEvidence({
      requested, liveHandle: ownedWorker, terminalResult, phase,
    }) : null;
    const stop = runStop ? {
      state: runStop.status, admittedAt: runStop.admittedAt, completedAt: runStop.completedAt,
      targetCount: runStop.targetWorkerIds.length, targetDigest: runStop.targetDigest,
      receipt: clone(runStop.receipt),
    } : null;
    const resourcesSettled = ownedWorkers.length === 0;
    const semanticReview = { state: 'policy_unavailable', findings: [] };
    const verificationState = node?.state === 'accepted' ? 'mechanically_verified'
      : node?.state === 'failed' ? 'failed' : 'pending';
    const progress = runProgress({
      phase, approval: projection?.approval ?? null, node, route,
      verification: { state: verificationState }, reviewPolicyMode: 'unavailable', semanticReview,
      result: null, integration: null, exportResult: null, resourcesSettled, stop,
    });
    const terminalCause = projectTypedTerminalCause({ terminalResult, runStop });
    const planNode = current.plan?.nodes?.[0] ?? null;
    const view = {
      schemaVersion: 1,
      runId,
      objective: current.goal.objective,
      profile: {
        name: current.profileName, digest: current.profileDigest,
        state: 'historical_definition_unavailable',
      },
      policy: {
        state: 'unavailable', reason: 'historical_profile_definition_unavailable',
        currentProfileApplied: false, mutationAuthority: 'closed',
      },
      phase,
      cursor: projection?.coordinationUpperBound ?? this.driver.coordination.snapshot().lastSeq,
      nextActions: runStop || ownedWorkers.length === 0 ? [] : [{ kind: 'stop' }],
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: current.plan ? {
        id: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
        approval: projection?.approval ? {
          disposition: projection.approval.disposition, digest: projection.approval.digest,
        } : null,
      } : null,
      planPreview: planNode ? {
        objective: current.goal.objective,
        definitionOfDone: clone(current.goal.definitionOfDone), constraints: clone(current.goal.constraints),
        risk: current.goal.risk, goalBudget: clone(current.goal.budget),
        node: {
          key: planNode.key, objective: planNode.objective, pathScope: clone(planNode.pathScope),
          ...(planNode.contextScope ? { contextScope: clone(planNode.contextScope) } : {}),
          risk: planNode.risk, budget: clone(planNode.budget), verification: clone(planNode.verification),
          route: requested, capabilities: clone(planNode.capabilities), effects: clone(planNode.effects),
        },
        profileDigest: current.profileDigest, planDigest: current.plan.digest,
      } : null,
      nodes: clone(projection?.nodes ?? []),
      route: route ? {
        ...clone(route),
        rationale: {
          launchEnforcement: 'historical approved Plan route',
          providerAttestation: 'provider-native observation only',
        },
      } : null,
      workerPolicy: planNode?.workerPolicy
        ? { state: 'requested', request: clone(planNode.workerPolicy) }
        : { state: 'legacy_unattested' },
      budget: { allocated: clone(current.goal.budget), node: clone(node?.budget ?? null), termination: terminalCause },
      attention: phase === 'interruption_uncertain' ? [{
        kind: 'session_preservation', state: 'quarantined',
        reason: 'session_attachment_unproven',
        summary: 'Reusable provider-session attachment is unproven; whole-Run stop is the only safe action.',
      }] : [], attentionTruncated: false,
      verification: { state: verificationState, verdict: null },
      semanticReview,
      progress,
      result: null, integration: null, export: null,
      ownership: phase === 'stopped' ? { workers: 0, workerIds: [], closed: false }
        : { workers: ownedWorkers.length, workerIds: ownedWorkers.map((handle) => handle.id).sort(), closed: false },
      evidence: [],
      narrative: terminalCauseNarrative(terminalCause)
        ?? (phase === 'interruption_uncertain'
          ? 'Provider-session attachment is unproven and quarantined; stop is the only safe action.'
          : 'Historical Run remains observable, but its exact pre-registry deployment policy is unavailable; current policy was not substituted.'),
      lastError: { code: 'application_profile_stale' }, lastAction: options.action ? clone(options.action) : null,
      recovery: null, preservation: { state: 'unavailable', available: false, checkpointSha: null },
      resume: null, terminalCause, stop, close: null,
    };
    if (Buffer.byteLength(JSON.stringify(view)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('historical Run view exceeds its deployment byte ceiling', 'application_run_view_oversize');
    }
    return deepFreeze(view);
  }

  _workflowDefinitionAncestors(runId, excludeDigest = null, beforeSeq = Infinity) {
    return this.driver.coordination.events().filter((candidate) => (
      candidate.seq < beforeSeq && candidate.kind === 'driver.recorded'
        && candidate.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
        && candidate.payload?.repoId === this.repoId
        && candidate.payload?.runId === runId
        && candidate.payload?.definitionDigest !== excludeDigest
    )).map((candidate) => candidate.payload);
  }

  _workflowRoleCatalog(current, definition) {
    if (definition.schemaVersion === 3) return definition.roleCatalog;
    try {
      return buildWorkflowRoleCatalog(definition.attempts.map((attempt) => {
        const node = current.plan.nodes.find((candidate) => candidate.key === attempt.nodeKey);
        if (!node) throw new TypeError('Historical Workflow Attempt lost its exact Plan node');
        return { role: attempt.role, route: attempt.route, node };
      }));
    } catch (error) {
      throw applicationError(error.message, 'application_workflow_integrity');
    }
  }

  _workflowDefinition(current) {
    if (!this._isWorkflowRun(current)) return null;
    const records = this.driver.coordination.events().filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
      && event.payload?.repoId === this.repoId && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest);
    if (current.plan.nodes.length === 1 && current.plan.nodes[0]?.revision) {
      if (records.length > 1) {
        throw applicationError('workflow revision definition binding is ambiguous',
          'application_workflow_integrity');
      }
      return this._workflowRevisionDefinition(current, records[0] ?? null);
    }
    if (records.length !== 1) {
      throw applicationError('workflow definition binding is absent or ambiguous',
        'application_workflow_integrity');
    }
    const event = records[0];
    const { kind, definitionDigest, ...core } = event.payload;
    void kind;
    if (core.schemaVersion === 3) {
      const ancestors = this._workflowDefinitionAncestors(
        current.goal.runId, definitionDigest, event.seq,
      );
      let normalized;
      try {
        normalized = validateWorkflowDefinitionV3(event.payload, {
          nodes: current.plan.nodes, definitionDigest, ancestors,
        });
      } catch (error) {
        throw applicationError(error.message, 'application_workflow_integrity');
      }
      const workflowPolicy = workflowDefinitionPolicy(core);
      if (event.actor !== APPLICATION_WORKFLOW_RECORD_ACTOR
        || event.idempotencyKey
          !== `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${current.plan.digest}`
        || core.repoId !== this.repoId || core.runId !== current.goal.runId
        || core.goalDigest !== current.goal.digest || core.profileDigest !== current.profile.digest
        || core.planDigest !== current.plan.digest
        || core.workflowPolicyDigest !== workflowPolicy.policyDigest
        || core.workItem.objective !== current.goal.objective
        || digest(core.workItem.definitionOfDone) !== digest(current.goal.definitionOfDone)) {
        throw applicationError('workflow definition binding failed integrity validation',
          'application_workflow_integrity');
      }
      return deepFreeze({ kind: APPLICATION_WORKFLOW_RECORD_KIND, ...clone(normalized) });
    }
    const attempts = core.attempts;
    const legacyFields = [
      'attempts', 'goalDigest', 'join', 'planDigest', 'profileDigest', 'repoId', 'runId',
      'schemaVersion', 'strategy', 'workItem', 'workspace',
    ];
    const policyFields = [...legacyFields, 'workflowPolicy', 'workflowPolicyDigest'];
    const legacy = core.schemaVersion === 1;
    const coreFields = legacy ? legacyFields : policyFields;
    const workflowPolicy = workflowDefinitionPolicy(core);
    try {
      validateWorkflowDefinitionLegacy(event.payload, { nodes: current.plan.nodes });
    } catch (error) {
      throw applicationError(error.message, 'application_workflow_integrity');
    }
    if (event.actor !== APPLICATION_WORKFLOW_RECORD_ACTOR
      || event.idempotencyKey !== `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${current.plan.digest}`
      || Object.keys(core).sort().join(',') !== coreFields.sort().join(',')
      || definitionDigest !== digest(core) || ![1, 2].includes(core.schemaVersion)
      || (legacy && workflowPolicy.policyDigest !== LEGACY_WORKFLOW_POLICY.policyDigest)
      || (!legacy && core.workflowPolicyDigest !== workflowPolicy.policyDigest)
      || core.repoId !== this.repoId || core.runId !== current.goal.runId
      || core.goalDigest !== current.goal.digest || core.profileDigest !== current.profile.digest
      || core.planDigest !== current.plan.digest
      || core.strategy !== 'parallel_attempts' || core.workspace !== 'isolated'
      || core.join !== 'operator_selected' || !Array.isArray(attempts)
      || attempts.length !== current.plan.nodes.length
      || !core.workItem || typeof core.workItem !== 'object' || Array.isArray(core.workItem)
      || Object.keys(core.workItem).sort().join(',') !== ['definitionOfDone', 'objective'].sort().join(',')
      || core.workItem.objective !== current.goal.objective
      || digest(core.workItem.definitionOfDone) !== digest(current.goal.definitionOfDone)) {
      throw applicationError('workflow definition binding failed integrity validation',
        'application_workflow_integrity');
    }
    const nodes = new Map(current.plan.nodes.map((node) => [node.key, node]));
    const boundNodes = new Set(); const boundRoles = new Set();
    for (const attempt of attempts) {
      if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)
        || Object.keys(attempt).sort().join(',') !== ['nodeKey', 'role', 'route'].sort().join(',')) {
        throw applicationError('workflow Attempt binding shape is invalid',
          'application_workflow_integrity');
      }
      const node = nodes.get(attempt?.nodeKey);
      const requested = attempt?.route ?? null;
      if (!validId(attempt?.role) || attempt.nodeKey !== `attempt:${attempt.role}`
        || boundRoles.has(attempt.role) || boundNodes.has(attempt.nodeKey)
        || !node || !requested || !attempt.route || typeof attempt.route !== 'object' || Array.isArray(attempt.route)
        || Object.keys(attempt.route).sort().join(',') !== ['effort', 'harness', 'model'].sort().join(',')
        || !planRouteMatches(node.routes, requested)) {
        throw applicationError('workflow Attempt binding differs from its Plan node',
          'application_workflow_integrity');
      }
      boundRoles.add(attempt.role); boundNodes.add(attempt.nodeKey);
    }
    if (boundNodes.size !== nodes.size || [...nodes.keys()].some((nodeKey) => !boundNodes.has(nodeKey))) {
      throw applicationError('workflow Attempt binding does not cover the exact Plan',
        'application_workflow_integrity');
    }
    return deepFreeze(clone(event.payload));
  }

  _workflowSuccessorDefinitionCore({
    current, predecessorCurrent = current, planDigest, node, predecessorDefinition,
    revision, policy, targetSchemaVersion = 3,
  }) {
    const priorAttempt = predecessorDefinition.attempts.find((attempt) => (
      attempt.role === revision.parent.role
    ));
    const priorRoute = workflowAttemptRoute(predecessorDefinition, priorAttempt);
    if (revision.workflow.definitionDigest !== predecessorDefinition.definitionDigest
      || node.key !== `revision:${revision.round}:${revision.parent.role}`
      || !priorAttempt || !planRouteMatches(node.routes, priorRoute)) {
      throw applicationError('Workflow revision Plan differs from its predecessor route or round',
        'application_workflow_integrity');
    }
    if (![1, 2, 3].includes(targetSchemaVersion)
      || (predecessorDefinition.schemaVersion === 3 && targetSchemaVersion !== 3)) {
      throw applicationError('Workflow successor definition schema is unsupported',
        'application_workflow_integrity');
    }
    if (predecessorDefinition.schemaVersion === 3) {
      const logicalRole = workflowAttemptLogicalRole(predecessorDefinition, priorAttempt);
      const core = {
        schemaVersion: 3,
        repoId: this.repoId, runId: current.goal.runId,
        goalDigest: current.goal.digest, planDigest,
        profileDigest: current.profile.digest,
        workflowPolicy: clone(policy), workflowPolicyDigest: policy.policyDigest,
        strategy: 'candidate_feedback_revision', workspace: 'isolated',
        join: 'operator_selected', round: revision.round,
        predecessorDefinitionDigest: predecessorDefinition.definitionDigest,
        revisionDigest: revision.revisionDigest,
        workItem: {
          objective: current.goal.objective,
          definitionOfDone: clone(current.goal.definitionOfDone),
        },
        roleCatalog: clone(predecessorDefinition.roleCatalog),
        lineage: {
          generation: predecessorDefinition.lineage.generation + 1,
          rootDefinitionDigest: predecessorDefinition.lineage.generation === 1
            ? predecessorDefinition.definitionDigest
            : predecessorDefinition.lineage.rootDefinitionDigest,
          parentDefinitionDigest: predecessorDefinition.definitionDigest,
        },
        attempts: [workflowAttempt(
          revision.parent.role, logicalRole, node.key, predecessorDefinition.roleCatalog,
        )],
      };
      validateWorkflowDefinitionV3(core, {
        nodes: [node],
        ancestors: this._workflowDefinitionAncestors(current.goal.runId),
      });
      return core;
    }
    if (targetSchemaVersion === 3) {
      const roleCatalog = this._workflowRoleCatalog(predecessorCurrent, predecessorDefinition);
      const logicalRole = priorAttempt.role;
      const core = {
        schemaVersion: 3,
        repoId: this.repoId, runId: current.goal.runId,
        goalDigest: current.goal.digest, planDigest,
        profileDigest: current.profile.digest,
        workflowPolicy: clone(policy), workflowPolicyDigest: policy.policyDigest,
        strategy: 'candidate_feedback_revision', workspace: 'isolated',
        join: 'operator_selected', round: revision.round,
        predecessorDefinitionDigest: predecessorDefinition.definitionDigest,
        revisionDigest: revision.revisionDigest,
        workItem: {
          objective: current.goal.objective,
          definitionOfDone: clone(current.goal.definitionOfDone),
        },
        roleCatalog,
        lineage: {
          generation: 2,
          rootDefinitionDigest: predecessorDefinition.definitionDigest,
          parentDefinitionDigest: predecessorDefinition.definitionDigest,
        },
        attempts: [workflowAttempt(
          revision.parent.role, logicalRole, node.key, roleCatalog,
        )],
      };
      validateWorkflowDefinitionV3(core, {
        nodes: [node], ancestors: [predecessorDefinition],
      });
      return core;
    }
    return {
      schemaVersion: targetSchemaVersion,
      repoId: this.repoId, runId: current.goal.runId,
      goalDigest: current.goal.digest, planDigest,
      profileDigest: current.profile.digest,
      ...(targetSchemaVersion === 2 ? {
        workflowPolicy: clone(policy), workflowPolicyDigest: policy.policyDigest,
      } : {}),
      strategy: 'candidate_feedback_revision', workspace: 'isolated',
      join: 'operator_selected', round: revision.round,
      predecessorDefinitionDigest: predecessorDefinition.definitionDigest,
      revisionDigest: revision.revisionDigest,
      workItem: {
        objective: current.goal.objective,
        definitionOfDone: clone(current.goal.definitionOfDone),
      },
      attempts: [{ role: revision.parent.role, nodeKey: node.key, route: priorRoute }],
    };
  }

  _workflowRevisionDefinition(current, record = null) {
    const node = current.plan?.nodes[0];
    const revision = node?.revision ? normalizeWorkflowRevision(node.revision) : null;
    if (!revision || current.plan.predecessor === null
      || revision.predecessorPlan.planId !== current.plan.predecessor.planId
      || revision.predecessorPlan.version !== current.plan.predecessor.version
      || revision.predecessorPlan.digest !== current.plan.predecessor.digest) {
      throw applicationError('Workflow revision Plan lacks its exact predecessor authority',
        'application_workflow_integrity');
    }
    const history = this._workflowPlanHistory(current);
    if (history.length < 2 || history.at(-1).plan.digest !== current.plan.digest) {
      throw applicationError('Workflow revision history is incomplete',
        'application_workflow_integrity');
    }
    const predecessor = history.at(-2);
    const predecessorDefinition = this._workflowDefinition(predecessor);
    const policy = workflowDefinitionPolicy(predecessorDefinition);
    if (history.length > policy.maxRounds || revision.round !== history.length) {
      throw applicationError('Workflow revision round exceeds its bound recursive authority',
        'application_workflow_integrity');
    }
    const targetSchemaVersion = record?.payload?.schemaVersion ?? 1;
    if (record === null && policy.policyDigest !== LEGACY_WORKFLOW_POLICY.policyDigest) {
      throw applicationError('Workflow successor definition binding is absent',
        'application_workflow_integrity');
    }
    const core = this._workflowSuccessorDefinitionCore({
      current, predecessorCurrent: predecessor, planDigest: current.plan.digest,
      node, predecessorDefinition,
      revision, policy, targetSchemaVersion,
    });
    if (record === null) {
      return deepFreeze({
        kind: 'application.workflow_revision_derived',
        ...core, definitionDigest: digest(core),
      });
    }
    const { kind, definitionDigest, ...boundCore } = record.payload;
    void kind;
    if (record.actor !== APPLICATION_WORKFLOW_RECORD_ACTOR
      || record.idempotencyKey !== `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${current.plan.digest}`
      || digest(boundCore) !== definitionDigest || digest(boundCore) !== digest(core)) {
      throw applicationError('Workflow successor definition binding failed integrity validation',
        'application_workflow_integrity');
    }
    return deepFreeze(clone(record.payload));
  }

  _workflowCandidates(current, projection, definition) {
    const candidates = [];
    for (const binding of definition.attempts) {
      const node = projection.nodes.find((candidate) => candidate.key === binding.nodeKey);
      if (node?.state !== 'accepted') continue;
      const task = node.taskId ? this.driver.coordination.task(node.taskId) : null;
      if (!task) {
        throw applicationError('accepted Workflow Attempt has no durable task',
          'application_workflow_integrity');
      }
      const artifacts = (task.artifactIds ?? []).map((artifactId) => (
        this.driver.coordination.artifact(artifactId)
      )).filter(Boolean);
      const active = (artifact) => artifact.accepted === true && artifact.supersededBy === null
        && !Object.hasOwn(artifact, 'acceptanceInvalidation');
      const commit = artifacts.find((artifact) => active(artifact) && artifact.kind === 'commit');
      const verification = artifacts.find((artifact) => active(artifact)
        && artifact.kind === 'verification');
      if (!commit?.refs?.sha || !verification) {
        throw applicationError('accepted Workflow Attempt lacks immutable gate artifacts',
          'application_workflow_integrity');
      }
      const worker = verification.refs?.worker;
      const workerSeq = verification.refs?.workerSeq;
      const operational = validText(worker, 4_096) && Number.isSafeInteger(workerSeq)
        ? this.driver.log.read(worker).find((event) => event.seq === workerSeq
          && event.kind === 'verify.reverified') : null;
      if (!operational || operational.payload?.accept !== true
        || operational.payload?.capture?.sha !== commit.refs.sha
        || commit.refs.retainedResultRef !== `refs/baton/results/${commit.refs.sha}`
        || operational.payload?.capture?.retainedResultRef !== commit.refs.retainedResultRef) {
        throw applicationError('Workflow Candidate verification evidence is unavailable',
          'application_workflow_integrity');
      }
      const changedPaths = (operational.payload.capture.changedPaths ?? [])
        .filter((path) => safeScopePath(path)).sort();
      const evidenceCore = {
        commitArtifact: { id: commit.id, digest: commit.digest },
        verificationArtifact: { id: verification.id, digest: verification.digest },
        verification: {
          worker, workerSeq, verdictDigest: digest(operational.payload.verdict),
          changedPathsDigest: digest(changedPaths),
        },
      };
      const core = {
        schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
        planDigest: current.plan.digest, definitionDigest: definition.definitionDigest,
        role: binding.role, nodeKey: binding.nodeKey, taskId: task.id,
        resultSha: commit.refs.sha, changedPaths,
        evidence: evidenceCore, evidenceDigest: digest(evidenceCore),
      };
      candidates.push(deepFreeze({
        ...core,
        retainedResultRef: commit.refs.retainedResultRef,
        retention: {
          state: 'pinned', ref: commit.refs.retainedResultRef,
          refDigest: digest(commit.refs.retainedResultRef),
        },
        candidateId: `candidate:${digest(core)}`, candidateDigest: digest(core),
      }));
    }
    return deepFreeze(candidates.sort((left, right) => (
      left.role < right.role ? -1 : left.role > right.role ? 1 : 0
    )));
  }

  _workflowSelection(current, definition, candidates) {
    const records = this.driver.coordination.events().filter((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_SELECTION_RECORD_KIND
      && event.payload?.repoId === this.repoId && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest
    ));
    if (records.length === 0) return null;
    if (records.length !== 1) {
      throw applicationError('Workflow Candidate selection is ambiguous',
        'application_workflow_integrity');
    }
    const event = records[0]; const payload = event.payload;
    const { kind, selectionDigest, ...core } = payload;
    void kind;
    const fields = [
      'candidate', 'comparedCandidates', 'definitionDigest', 'planDigest', 'reason',
      'repoId', 'runId', 'schemaVersion', 'selectedBy',
    ];
    const selected = candidates.find((candidate) => candidate.candidateId === core.candidate?.id);
    const compared = candidates.map((candidate) => ({
      id: candidate.candidateId, digest: candidate.candidateDigest, role: candidate.role,
    }));
    if (Object.keys(core).sort().join(',') !== fields.sort().join(',')
      || core.schemaVersion !== 1 || core.repoId !== this.repoId
      || core.runId !== current.goal.runId || core.planDigest !== current.plan.digest
      || core.definitionDigest !== definition.definitionDigest
      || selectionDigest !== digest(core) || !selected
      || ![digest({
        id: selected.candidateId, digest: selected.candidateDigest, role: selected.role,
        nodeKey: selected.nodeKey, taskId: selected.taskId,
        resultSha: selected.resultSha, evidenceDigest: selected.evidenceDigest,
      }), digest({
        id: selected.candidateId, digest: selected.candidateDigest, role: selected.role,
        nodeKey: selected.nodeKey, taskId: selected.taskId,
        resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
        evidenceDigest: selected.evidenceDigest,
      })].includes(digest(core.candidate))
      || digest(core.comparedCandidates) !== digest(compared)
      || !core.reason || Object.keys(core.reason).sort().join(',') !== 'digest,text'
      || !validText(core.reason.text, 1_024) || core.reason.digest !== digest(core.reason.text)
      || !core.selectedBy || Object.keys(core.selectedBy).sort().join(',') !== 'actor,principalId,sessionId'
      || event.actor !== core.selectedBy.actor
      || event.idempotencyKey !== `${APPLICATION_WORKFLOW_SELECTION_RECORD_KIND}:${current.goal.runId}:${current.plan.digest}`) {
      throw applicationError('Workflow Candidate selection failed integrity validation',
        'application_workflow_integrity');
    }
    return deepFreeze(clone(payload));
  }

  _workflowFeedback(current, definition, candidates) {
    const records = this.driver.coordination.events().filter((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND
      && event.payload?.repoId === this.repoId && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest
    ));
    if (records.length > 64) {
      throw applicationError('Workflow feedback exceeds its deployment projection ceiling',
        'application_workflow_integrity');
    }
    return deepFreeze(records.map((event) => {
      const payload = event.payload; const { kind, feedbackDigest, ...core } = payload;
      void kind;
      const fields = [
        'definitionDigest', 'feedback', 'feedbackId', 'planDigest', 'prefix', 'repoId',
        'runId', 'schemaVersion', 'source', 'target',
      ];
      const candidate = candidates.find((entry) => entry.candidateId === core.target?.candidateId);
      const normalized = normalizeWorkflowFeedback(core.feedback);
      const legacyTarget = candidate ? {
        kind: 'candidate', role: candidate.role, candidateId: candidate.candidateId,
        candidateDigest: candidate.candidateDigest, nodeKey: candidate.nodeKey,
        taskId: candidate.taskId, resultSha: candidate.resultSha,
        changedPaths: candidate.changedPaths,
        changedPathsDigest: digest(candidate.changedPaths),
      } : null;
      const anchoredTarget = candidate ? {
        ...legacyTarget,
        retainedResultRef: candidate.retainedResultRef,
        treeIdentityDigest: digest({
          resultSha: candidate.resultSha, retainedResultRef: candidate.retainedResultRef,
        }),
      } : null;
      if (Object.keys(core).sort().join(',') !== fields.sort().join(',')
        || core.schemaVersion !== 1 || core.repoId !== this.repoId
        || core.runId !== current.goal.runId || core.planDigest !== current.plan.digest
        || core.definitionDigest !== definition.definitionDigest || feedbackDigest !== digest(core)
        || core.feedbackId !== `feedback:${digest({
          repoId: core.repoId, runId: core.runId, planDigest: core.planDigest,
          definitionDigest: core.definitionDigest, source: core.source,
          target: core.target, feedback: core.feedback,
        })}`
        || digest(normalized) !== digest(core.feedback) || !candidate
        || ![digest(legacyTarget), digest(anchoredTarget)].includes(digest(core.target))
        || !core.source || Object.keys(core.source).sort().join(',') !== 'actor,kind,principalId,sessionId'
        || core.source.kind !== 'authenticated_user' || event.actor !== core.source.actor
        || !core.prefix || Object.keys(core.prefix).sort().join(',') !== 'definitionDigest,goalDigest,planDigest,throughSeq'
        || core.prefix.goalDigest !== current.goal.digest
        || core.prefix.planDigest !== current.plan.digest
        || core.prefix.definitionDigest !== definition.definitionDigest
        || !Number.isSafeInteger(core.prefix.throughSeq) || core.prefix.throughSeq <= 0
        || core.prefix.throughSeq >= event.seq
        || event.idempotencyKey !== `${APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND}:${core.feedbackId}`) {
        throw applicationError('Workflow feedback failed integrity validation',
          'application_workflow_integrity');
      }
      assertWorkflowFeedbackAnchors(normalized, candidate);
      return clone(payload);
    }));
  }

  _workflowMemberStops(current, definition) {
    const events = this.driver.coordination.events().filter((event) => (
      event.kind === 'driver.recorded'
      && [APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND,
        APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND].includes(event.payload?.kind)
      && event.payload?.repoId === this.repoId && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest
    ));
    if (events.length > definition.attempts.length * 2) {
      throw applicationError('Workflow member stop projection is ambiguous',
        'application_workflow_integrity');
    }
    const rows = new Map();
    for (const event of events.filter((candidate) => (
      candidate.payload.kind === APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND
    ))) {
      const payload = event.payload; const { kind, admissionDigest, ...core } = payload;
      void kind;
      const fields = [
        'definitionDigest', 'goalDigest', 'nodeKey', 'planDigest', 'prefix', 'reasonDigest',
        'repoId', 'role', 'runId', 'schemaVersion', 'source', 'targetDigest', 'taskId', 'workerId',
      ];
      const binding = definition.attempts.find((attempt) => attempt.role === core.role);
      const task = core.taskId ? this.driver.coordination.task(core.taskId) : null;
      const target = {
        repoId: this.repoId, runId: current.goal.runId, planDigest: current.plan.digest,
        role: core.role, nodeKey: core.nodeKey, taskId: core.taskId, workerId: core.workerId,
      };
      if (Object.keys(core).sort().join(',') !== fields.sort().join(',')
        || core.schemaVersion !== 1 || core.repoId !== this.repoId
        || core.runId !== current.goal.runId || core.goalDigest !== current.goal.digest
        || core.planDigest !== current.plan.digest
        || core.definitionDigest !== definition.definitionDigest
        || !binding || binding.nodeKey !== core.nodeKey
        || !task || task.runId !== current.goal.runId || task.id !== core.taskId
        || task.assignee !== core.workerId || core.targetDigest !== digest(target)
        || !/^[a-f0-9]{64}$/u.test(core.reasonDigest ?? '')
        || !core.source || Object.keys(core.source).sort().join(',') !== 'actor,principalId,sessionId'
        || !validText(core.source.actor, 256) || !validId(core.source.principalId)
        || !validId(core.source.sessionId) || event.actor !== core.source.actor
        || !core.prefix || Object.keys(core.prefix).sort().join(',') !== 'definitionDigest,goalDigest,planDigest,throughSeq'
        || core.prefix.goalDigest !== current.goal.digest
        || core.prefix.planDigest !== current.plan.digest
        || core.prefix.definitionDigest !== definition.definitionDigest
        || !Number.isSafeInteger(core.prefix.throughSeq) || core.prefix.throughSeq <= 0
        || core.prefix.throughSeq >= event.seq || admissionDigest !== digest(core)
        || event.idempotencyKey !== `${APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND}:${current.goal.runId}:${current.plan.digest}:${core.role}`
        || rows.has(core.role)) {
        throw applicationError('Workflow member stop admission failed integrity validation',
          'application_workflow_integrity');
      }
      rows.set(core.role, {
        ...clone(payload), status: 'stopping', admittedEvent: event.seq,
        completedEvent: null, receipt: null,
      });
    }
    for (const event of events.filter((candidate) => (
      candidate.payload.kind === APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND
    ))) {
      const payload = event.payload; const { kind, completionDigest, ...core } = payload;
      void kind;
      const fields = [
        'admissionDigest', 'definitionDigest', 'nodeKey', 'outcome', 'planDigest', 'repoId',
        'role', 'runId', 'schemaVersion', 'state', 'targetDigest', 'taskId', 'workerId',
      ];
      const admitted = rows.get(core.role);
      const outcome = core.outcome;
      const counts = outcome?.counts;
      const checks = outcome?.checks;
      if (Object.keys(core).sort().join(',') !== fields.sort().join(',')
        || core.schemaVersion !== 1 || core.repoId !== this.repoId
        || core.runId !== current.goal.runId || core.planDigest !== current.plan.digest
        || core.definitionDigest !== definition.definitionDigest || core.state !== 'stopped'
        || !admitted || admitted.nodeKey !== core.nodeKey || admitted.taskId !== core.taskId
        || admitted.workerId !== core.workerId || admitted.targetDigest !== core.targetDigest
        || admitted.admissionDigest !== core.admissionDigest
        || !outcome || Object.keys(outcome).sort().join(',') !== 'checks,counts,remainingCount,targetCount'
        || outcome.targetCount !== 1 || outcome.remainingCount !== 0
        || !counts || Object.keys(counts).sort().join(',') !== 'alreadyTerminal,killConfirmed,pendingCancelled,processesClosed,processesObserved'
        || counts.pendingCancelled + counts.killConfirmed + counts.alreadyTerminal !== 1
        || counts.processesObserved !== counts.processesClosed
        || !checks || Object.keys(checks).sort().join(',') !== 'interactionsResolved,runAuthorityReleased'
        || checks.interactionsResolved !== true || checks.runAuthorityReleased !== true
        || completionDigest !== digest(core) || event.actor !== admitted.source.actor
        || event.idempotencyKey !== `${APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND}:${current.goal.runId}:${current.plan.digest}:${core.role}`
        || admitted.completedEvent !== null) {
        throw applicationError('Workflow member stop completion failed integrity validation',
          'application_workflow_integrity');
      }
      rows.set(core.role, {
        ...admitted, status: 'stopped', completedEvent: event.seq,
        receipt: clone(payload),
      });
    }
    return deepFreeze([...rows.values()].sort((left, right) => (
      left.role < right.role ? -1 : left.role > right.role ? 1 : 0
    )));
  }

  _performWorkflowMemberStop(current, definition, stop) {
    const key = `${current.goal.runId}\0${stop.role}`;
    const existing = this._workflowMemberStopPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const projected = this._workflowMemberStops(current, definition)
        .find((row) => row.role === stop.role);
      if (!projected) {
        throw applicationError('Workflow member stop admission is unavailable',
          'application_workflow_member_stop_incomplete');
      }
      if (projected.status === 'stopped') return projected.receipt;
      const outcome = await this.driver.coordinator.stopRunTargets(
        [projected.workerId], projected.source.actor,
      );
      if (outcome.targetCount !== 1 || outcome.remainingCount !== 0
        || outcome.counts.pendingCancelled + outcome.counts.killConfirmed
          + outcome.counts.alreadyTerminal !== 1
        || outcome.counts.processesObserved !== outcome.counts.processesClosed
        || outcome.checks.interactionsResolved !== true
        || outcome.checks.runAuthorityReleased !== true) {
        throw applicationError('Workflow member stop/reap result is incomplete',
          'application_workflow_member_stop_incomplete');
      }
      const core = {
        schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
        planDigest: current.plan.digest, definitionDigest: definition.definitionDigest,
        role: projected.role, nodeKey: projected.nodeKey, taskId: projected.taskId,
        workerId: projected.workerId, targetDigest: projected.targetDigest,
        admissionDigest: projected.admissionDigest, state: 'stopped',
        outcome: clone(outcome),
      };
      this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND, {
        ...core, completionDigest: digest(core),
      }, {
        actor: projected.source.actor,
        key: `${APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND}:${current.goal.runId}:${current.plan.digest}:${projected.role}`,
      });
      const completed = this._workflowMemberStops(current, definition)
        .find((row) => row.role === projected.role);
      if (completed?.status !== 'stopped') {
        throw applicationError('Workflow member stop completion is unavailable',
          'application_workflow_member_stop_incomplete');
      }
      return completed.receipt;
    })();
    this._workflowMemberStopPromises.set(key, operation);
    operation.finally(() => {
      if (this._workflowMemberStopPromises.get(key) === operation) {
        this._workflowMemberStopPromises.delete(key);
      }
    }).catch(() => {});
    return operation;
  }

  async stopWorkflowMember(rawRequest, rawPrincipal, semanticDispatch = null) {
    this._assertOpen();
    await this.ready;
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)
      || Object.keys(rawRequest).sort().join(',') !== ['reason', 'role', 'runId'].sort().join(',')
      || !validId(rawRequest.runId) || !validId(rawRequest.role)
      || !validText(rawRequest.reason, 1_024)
      || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(rawRequest.reason))) {
      throw applicationError('Workflow member stop is invalid',
        'application_workflow_member_stop_invalid');
    }
    const principal = normalizePrincipal(rawPrincipal, 'Workflow member stop principal');
    const reason = rawRequest.reason.normalize('NFKC').trim();
    return this._withRunEffect(rawRequest.runId, async () => {
      if (semanticDispatch !== SEMANTIC_ACTION_DISPATCH) {
        await this._authorizeSemanticKind('stop_member', principal, rawRequest.runId);
      }
      const current = this._findRun(rawRequest.runId);
      this._assertRunMutable(rawRequest.runId);
      if (!this._isWorkflowRun(current)) {
        throw applicationError('Run is not a member-addressable Workflow',
          'application_workflow_member_stop_unavailable');
      }
      const definition = this._workflowDefinition(current);
      const existing = this._workflowMemberStops(current, definition)
        .find((row) => row.role === rawRequest.role);
      if (existing) {
        if (existing.reasonDigest !== digest(reason)
          || existing.source.principalId !== principal.principalId
          || existing.source.sessionId !== principal.sessionId) {
          throw applicationError('Workflow member already has a different stop admission',
            'application_workflow_member_stop_conflict');
        }
        await this._performWorkflowMemberStop(current, definition, existing);
        return this._buildView(current, this.principals.observer, {
          action: { command: 'run.act', result: 'member_stopped', role: existing.role },
        });
      }
      const binding = definition.attempts.find((attempt) => attempt.role === rawRequest.role);
      const projection = await this._goalPlanStatus(current, this.principals.observer);
      const node = binding
        ? projection.nodes.find((candidate) => candidate.key === binding.nodeKey) : null;
      const task = node?.taskId ? this.driver.coordination.task(node.taskId) : null;
      const workerId = task?.assignee ?? null;
      if (!binding || !node || ['accepted', 'failed', 'cancelled'].includes(node.state)
        || !task || !validId(workerId)) {
        throw applicationError('Workflow member is not active or addressable',
          'application_workflow_member_stop_unavailable');
      }
      const source = {
        actor: principal.actor, principalId: principal.principalId, sessionId: principal.sessionId,
      };
      const target = {
        repoId: this.repoId, runId: current.goal.runId, planDigest: current.plan.digest,
        role: binding.role, nodeKey: binding.nodeKey, taskId: task.id, workerId,
      };
      const core = {
        schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
        goalDigest: current.goal.digest, planDigest: current.plan.digest,
        definitionDigest: definition.definitionDigest,
        role: binding.role, nodeKey: binding.nodeKey, taskId: task.id, workerId,
        targetDigest: digest(target), reasonDigest: digest(reason), source,
        prefix: {
          throughSeq: this.driver.coordination.snapshot().lastSeq,
          goalDigest: current.goal.digest, planDigest: current.plan.digest,
          definitionDigest: definition.definitionDigest,
        },
      };
      this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND, {
        ...core, admissionDigest: digest(core),
      }, {
        actor: principal.actor,
        key: `${APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND}:${current.goal.runId}:${current.plan.digest}:${binding.role}`,
      });
      const admitted = this._workflowMemberStops(current, definition)
        .find((row) => row.role === binding.role);
      await this._performWorkflowMemberStop(current, definition, admitted);
      return this._buildView(current, this.principals.observer, {
        action: { command: 'run.act', result: 'member_stopped', role: binding.role },
      });
    });
  }

  async selectWorkflowCandidate(rawRequest, rawPrincipal, semanticDispatch = null) {
    this._assertOpen();
    await this.ready;
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)
      || Object.keys(rawRequest).sort().join(',') !== ['reason', 'role', 'runId'].sort().join(',')
      || !validId(rawRequest.runId) || !validId(rawRequest.role)
      || !validText(rawRequest.reason, 1_024)
      || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(rawRequest.reason))) {
      throw applicationError('Workflow Candidate selection is invalid',
        'application_workflow_selection_invalid');
    }
    const principal = normalizePrincipal(rawPrincipal, 'Workflow Candidate selector');
    const reason = rawRequest.reason.normalize('NFKC').trim();
    if (semanticDispatch !== SEMANTIC_ACTION_DISPATCH) {
      await this._authorizeSemanticKind('select_candidate', principal, rawRequest.runId);
    }
    const current = this._findRun(rawRequest.runId);
    this._assertRunMutable(rawRequest.runId);
    if (!this._isWorkflowRun(current)) {
      throw applicationError('Run is not a selectable Workflow',
        'application_workflow_selection_unavailable');
    }
    const definition = this._workflowDefinition(current);
    const projection = await this._goalPlanStatus(current, this.principals.observer);
    const candidates = this._workflowCandidates(current, projection, definition);
    const allSettled = projection.nodes.every((node) => (
      ['accepted', 'failed', 'cancelled'].includes(node.state)
    ));
    const candidate = candidates.find((entry) => entry.role === rawRequest.role);
    if (!allSettled || !candidate) {
      throw applicationError('Workflow Candidate is not ready for selection',
        'application_workflow_selection_unavailable');
    }
    const existing = this._workflowSelection(current, definition, candidates);
    if (existing) {
      if (existing.candidate.id !== candidate.candidateId
        || existing.reason.digest !== digest(reason)
        || existing.selectedBy.principalId !== principal.principalId
        || existing.selectedBy.sessionId !== principal.sessionId) {
        throw applicationError('Workflow already has a different Candidate selection',
          'application_workflow_selection_conflict');
      }
      return this._buildView(current, this.principals.observer);
    }
    const core = {
      schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
      planDigest: current.plan.digest, definitionDigest: definition.definitionDigest,
      candidate: {
        id: candidate.candidateId, digest: candidate.candidateDigest, role: candidate.role,
        nodeKey: candidate.nodeKey, taskId: candidate.taskId,
        resultSha: candidate.resultSha, retainedResultRef: candidate.retainedResultRef,
        evidenceDigest: candidate.evidenceDigest,
      },
      comparedCandidates: candidates.map((entry) => ({
        id: entry.candidateId, digest: entry.candidateDigest, role: entry.role,
      })),
      reason: { text: reason, digest: digest(reason) },
      selectedBy: {
        actor: principal.actor, principalId: principal.principalId, sessionId: principal.sessionId,
      },
    };
    this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_SELECTION_RECORD_KIND, {
      ...core, selectionDigest: digest(core),
    }, {
      actor: principal.actor,
      key: `${APPLICATION_WORKFLOW_SELECTION_RECORD_KIND}:${current.goal.runId}:${current.plan.digest}`,
    });
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.act', result: 'candidate_selected', role: candidate.role },
    });
  }

  async sendWorkflowFeedback(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)
      || Object.keys(rawRequest).sort().join(',') !== ['feedback', 'role', 'runId'].sort().join(',')
      || !validId(rawRequest.runId) || !validId(rawRequest.role)) {
      throw applicationError('Workflow feedback target is invalid',
        'application_workflow_feedback_invalid');
    }
    const feedback = normalizeWorkflowFeedback(rawRequest.feedback);
    const principal = normalizePrincipal(rawPrincipal, 'Workflow feedback author');
    await this._authorize('run.feedback', principal, rawRequest.runId, {
      role: rawRequest.role, feedbackDigest: digest(feedback),
    });
    const current = this._findRun(rawRequest.runId);
    this._assertRunMutable(rawRequest.runId);
    if (!this._isWorkflowRun(current)) {
      throw applicationError('Run is not a feedback-capable Workflow',
        'application_workflow_feedback_unavailable');
    }
    const definition = this._workflowDefinition(current);
    const projection = await this._goalPlanStatus(current, this.principals.observer);
    const candidates = this._workflowCandidates(current, projection, definition);
    const candidate = candidates.find((entry) => entry.role === rawRequest.role);
    if (!candidate) {
      throw applicationError('Workflow feedback requires a verified Candidate',
        'application_workflow_feedback_unavailable');
    }
    assertWorkflowFeedbackAnchors(feedback, candidate);
    const source = {
      kind: 'authenticated_user', actor: principal.actor,
      principalId: principal.principalId, sessionId: principal.sessionId,
    };
    const target = {
      kind: 'candidate', role: candidate.role, candidateId: candidate.candidateId,
      candidateDigest: candidate.candidateDigest, nodeKey: candidate.nodeKey,
      taskId: candidate.taskId, resultSha: candidate.resultSha,
      changedPaths: clone(candidate.changedPaths),
      changedPathsDigest: digest(candidate.changedPaths),
      retainedResultRef: candidate.retainedResultRef,
      treeIdentityDigest: digest({
        resultSha: candidate.resultSha, retainedResultRef: candidate.retainedResultRef,
      }),
    };
    const feedbackId = `feedback:${digest({
      repoId: this.repoId, runId: current.goal.runId, planDigest: current.plan.digest,
      definitionDigest: definition.definitionDigest, source, target, feedback,
    })}`;
    const existing = this._workflowFeedback(current, definition, candidates)
      .find((packet) => packet.feedbackId === feedbackId);
    if (existing) return this._buildView(current, this.principals.observer);
    const core = {
      schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
      planDigest: current.plan.digest, definitionDigest: definition.definitionDigest,
      feedbackId, source, target, feedback: clone(feedback),
      prefix: {
        throughSeq: this.driver.coordination.snapshot().lastSeq,
        goalDigest: current.goal.digest, planDigest: current.plan.digest,
        definitionDigest: definition.definitionDigest,
      },
    };
    this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND, {
      ...core, feedbackDigest: digest(core),
    }, {
      actor: principal.actor,
      key: `${APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND}:${feedbackId}`,
    });
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.feedback', result: 'recorded', feedbackId },
    });
  }

  _workflowRevisionFeedbackRows(feedback, candidate) {
    const byId = new Map(this.driver.coordination.events().filter((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND
    )).map((event) => [event.payload.feedbackId, event]));
    return feedback.filter((packet) => packet.target.candidateId === candidate.candidateId)
      .map((packet) => {
        const event = byId.get(packet.feedbackId);
        if (!event) {
          throw applicationError('Workflow revision feedback event is unavailable',
            'application_workflow_integrity');
        }
        return {
          feedbackId: packet.feedbackId, feedbackDigest: packet.feedbackDigest,
          eventSeq: event.seq, feedback: clone(packet.feedback),
        };
      }).sort((left, right) => (left.feedbackId < right.feedbackId ? -1 : 1));
  }

  async _workflowRevisionEligibility(current, prepared = {}) {
    const history = this._workflowPlanHistory(current);
    const definition = prepared.definition ?? this._workflowDefinition(current);
    const policy = workflowDefinitionPolicy(definition);
    const projection = prepared.projection
      ?? await this._goalPlanStatus(current, this.principals.observer);
    const candidates = prepared.candidates
      ?? this._workflowCandidates(current, projection, definition);
    const selection = prepared.selection
      ?? this._workflowSelection(current, definition, candidates);
    const feedback = prepared.feedback
      ?? this._workflowFeedback(current, definition, candidates);
    const selected = selection
      ? candidates.find((candidate) => candidate.candidateId === selection.candidate.id) ?? null
      : null;
    const packets = selected ? this._workflowRevisionFeedbackRows(feedback, selected) : [];
    const sourceNode = selected
      ? current.plan.nodes.find((node) => node.key === selected.nodeKey) ?? null : null;
    const budget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), 1, policy.maxRounds,
    );
    const nextRound = history.length + 1;
    const result = (state, reason) => ({
      state, reason, nextRound, maxRounds: policy.maxRounds,
      policy, budget, history, definition, projection, candidates,
      selection, feedback, selected, packets, sourceNode,
    });
    if (history.length >= policy.maxRounds) return result('blocked', 'round_limit');
    if (!selected || !sourceNode) return result('blocked', 'selection_required');
    if (packets.length === 0) return result('blocked', 'feedback_required');
    const priorFeedbackCount = history.slice(1).reduce((sum, entry) => (
      sum + normalizeWorkflowRevision(entry.plan.nodes[0].revision).feedback.length
    ), 0);
    if (packets.length > policy.maxFeedbackPacketsPerRound
      || priorFeedbackCount + packets.length > policy.maxFeedbackPacketsTotal) {
      return result('blocked', 'feedback_limit');
    }
    const ancestorSelectedShas = new Set(history.slice(1).map((entry) => (
      normalizeWorkflowRevision(entry.plan.nodes[0].revision).parent.resultSha
    )));
    if (ancestorSelectedShas.has(selected.resultSha)) {
      return result('blocked', 'no_verified_progress');
    }
    const feedbackBodyDigest = workflowFeedbackBodySetDigest(packets);
    const priorFeedbackDigests = new Set(history.slice(1).map((entry) => (
      workflowFeedbackBodySetDigest(normalizeWorkflowRevision(
        entry.plan.nodes[0].revision,
      ).feedback)
    )));
    if (priorFeedbackDigests.has(feedbackBodyDigest)) {
      return result('blocked', 'repeated_feedback');
    }
    if (packets.some((packet) => packet.feedback.findings.some((finding) => (
      finding.kind === 'contradiction'
    )))) {
      return result('blocked', 'unresolved_contradiction');
    }
    if (!budget) return result('blocked', 'budget_exhausted');
    return result('eligible', 'ready');
  }

  async _validateWorkflowRevisionPlan(current) {
    const node = current.plan?.nodes[0];
    if (!node?.revision) return null;
    const definition = this._workflowDefinition(current);
    const history = this._workflowPlanHistory(current);
    if (history.length < 2) {
      throw applicationError('Workflow revision history is incomplete',
        'application_workflow_integrity');
    }
    const predecessor = history.at(-2);
    const predecessorDefinition = this._workflowDefinition(predecessor);
    const eligibility = await this._workflowRevisionEligibility(predecessor, {
      definition: predecessorDefinition,
    });
    const { selected, packets } = eligibility;
    const revision = normalizeWorkflowRevision(node.revision);
    const expectedParent = selected ? {
      role: selected.role, nodeKey: selected.nodeKey, taskId: selected.taskId,
      candidateId: selected.candidateId, candidateDigest: selected.candidateDigest,
      resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
      treeIdentityDigest: digest({
        resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
      }),
      changedPaths: clone(selected.changedPaths), changedPathsDigest: digest(selected.changedPaths),
      evidenceDigest: selected.evidenceDigest,
      commitArtifact: clone(selected.evidence.commitArtifact),
      verificationArtifact: clone(selected.evidence.verificationArtifact),
    } : null;
    if (eligibility.state !== 'eligible' || !selected || packets.length === 0 || !eligibility.budget
      || revision.round !== history.length
      || revision.workflow.definitionDigest !== predecessorDefinition.definitionDigest
      || revision.predecessorPlan.planId !== predecessor.plan.planId
      || revision.predecessorPlan.version !== predecessor.plan.version
      || revision.predecessorPlan.digest !== predecessor.plan.digest
      || digest(revision.parent) !== digest(expectedParent)
      || digest(revision.feedback) !== digest(packets)
      || digest(node.budget) !== digest(eligibility.budget)
      || definition.revisionDigest !== revision.revisionDigest
      || definition.workflowPolicyDigest !== eligibility.policy.policyDigest) {
      throw applicationError('Workflow revision Plan failed its immutable Candidate and feedback binding',
        'application_workflow_integrity');
    }
    return deepFreeze({
      predecessor, predecessorDefinition, selected, packets, revision,
      eligibility: workflowEligibilityProjection(eligibility),
    });
  }

  async reviseWorkflowCandidate(rawRequest, rawPrincipal, semanticDispatch = null) {
    this._assertOpen();
    await this.ready;
    const fields = ['actionId', 'principalScopeDigest', 'reason', 'runId'];
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)
      || Object.keys(rawRequest).sort().join(',') !== fields.sort().join(',')
      || !validId(rawRequest.runId) || !validText(rawRequest.actionId, 4_096)
      || !/^[a-f0-9]{64}$/u.test(rawRequest.principalScopeDigest ?? '')
      || !validText(rawRequest.reason, 1_024)
      || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(rawRequest.reason))) {
      throw applicationError('Workflow revision request is invalid',
        'application_workflow_revision_invalid');
    }
    const principal = normalizePrincipal(rawPrincipal, 'Workflow revision principal');
    const reason = rawRequest.reason.normalize('NFKC').trim();
    if (semanticDispatch !== SEMANTIC_ACTION_DISPATCH) {
      await this._authorizeSemanticKind('revise_candidate', principal, rawRequest.runId);
    }
    const current = this._findRun(rawRequest.runId);
    this._assertRunMutable(rawRequest.runId);
    if (!this._isWorkflowRun(current)) {
      throw applicationError('Run is not a recursively composable Workflow',
        'application_workflow_revision_unavailable');
    }
    const eligibility = await this._workflowRevisionEligibility(current);
    const {
      definition, selected, packets, sourceNode, budget, policy,
    } = eligibility;
    if (eligibility.state !== 'eligible') {
      const error = applicationError(`Workflow revision is blocked: ${eligibility.reason}`,
        'application_workflow_revision_unavailable');
      error.reason = eligibility.reason;
      throw error;
    }
    const revision = normalizeWorkflowRevision({
      schemaVersion: 1, kind: 'candidate_feedback_revision', round: eligibility.nextRound,
      workflow: { definitionDigest: definition.definitionDigest },
      predecessorPlan: {
        planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
      },
      parent: {
        role: selected.role, nodeKey: selected.nodeKey, taskId: selected.taskId,
        candidateId: selected.candidateId, candidateDigest: selected.candidateDigest,
        resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
        treeIdentityDigest: digest({
          resultSha: selected.resultSha, retainedResultRef: selected.retainedResultRef,
        }),
        changedPaths: clone(selected.changedPaths), changedPathsDigest: digest(selected.changedPaths),
        evidenceDigest: selected.evidenceDigest,
        commitArtifact: clone(selected.evidence.commitArtifact),
        verificationArtifact: clone(selected.evidence.verificationArtifact),
      },
      feedback: packets,
      decision: {
        actionId: rawRequest.actionId,
        principalScopeDigest: rawRequest.principalScopeDigest,
        reasonDigest: digest(reason),
      },
    });
    const node = {
      ...clone(sourceNode),
      key: `revision:${revision.round}:${selected.role}`,
      objective: renderWorkflowRevisionObjective(selected.role, current.goal.objective, reason, packets),
      budget: clone(budget),
      routes: exactPlanRoutes((() => {
        const sourceAttempt = definition.attempts.find((attempt) => (
          attempt.nodeKey === sourceNode.key || attempt.role === selected.role
        ));
        const selectedRoute = sourceAttempt ? workflowAttemptRoute(definition, sourceAttempt) : null;
        if (!selectedRoute || !planRouteMatches(sourceNode.routes, selectedRoute)) {
          throw applicationError('Workflow revision route is outside source Plan authority',
            'application_workflow_integrity');
        }
        return selectedRoute;
      })()),
      revision: clone(revision),
    };
    const request = {
      goal: {
        goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest,
      },
      predecessor: {
        planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
      },
      nodes: [node],
    };
    const normalized = normalizePlanRequest(request,
      this.driver.coordination.goalPlanPolicy(), current.goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
      goal: normalized.goal, predecessor: normalized.predecessor,
      nodes: normalized.nodes, totals: normalized.totals,
      policyDigest: this.driver.coordination.goalPlanPolicy().policyDigest,
    });
    let predecessorDefinition = definition;
    if (definition.kind === 'application.workflow_revision_derived') {
      const { kind, ...boundDefinition } = definition;
      void kind;
      this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, boundDefinition, {
        actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
        key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${current.plan.digest}`,
      });
      predecessorDefinition = {
        kind: APPLICATION_WORKFLOW_RECORD_KIND, ...clone(boundDefinition),
      };
    }
    const successorCore = this._workflowSuccessorDefinitionCore({
      current, planDigest: expectedPlanDigest, node,
      predecessorDefinition, revision, policy,
    });
    this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorCore, definitionDigest: digest(successorCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const proposed = await this.driver.coordinator.proposePlan(request,
      authority(this.principals.planner, this.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:revision-plan:${revision.revisionDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest) {
      throw applicationError('Workflow revision Plan differs from its semantic prebinding',
        'application_workflow_integrity');
    }
    const refreshed = this._findRun(current.goal.runId);
    await this._validateWorkflowRevisionPlan(refreshed);
    return this._buildView(refreshed, this.principals.observer, {
      action: {
        command: 'run.act', result: 'revision_plan_proposed',
        revisionId: revision.revisionId,
      },
    });
  }

  async _workflowRoundSummaries(current, observer) {
    const history = this._workflowPlanHistory(current);
    const summaries = [];
    for (let index = 0; index < history.length; index += 1) {
      const roundCurrent = history[index];
      const definition = this._workflowDefinition(roundCurrent);
      const projection = await this._goalPlanStatus(roundCurrent, observer);
      const candidates = this._workflowCandidates(roundCurrent, projection, definition);
      const selection = this._workflowSelection(roundCurrent, definition, candidates);
      const feedback = this._workflowFeedback(roundCurrent, definition, candidates);
      const memberStops = this._workflowMemberStops(roundCurrent, definition);
      const attempts = definition.attempts.map((attempt) => {
        const node = projection.nodes.find((candidate) => candidate.key === attempt.nodeKey);
        return {
          role: attempt.role, nodeKey: attempt.nodeKey, taskId: node?.taskId ?? null,
          state: node?.state ?? 'blocked', route: clone(workflowAttemptRoute(definition, attempt)),
          candidateId: candidates.find((candidate) => candidate.role === attempt.role)?.candidateId ?? null,
        };
      });
      const allSettled = attempts.every((attempt) => (
        ['accepted', 'failed', 'cancelled', 'stale'].includes(attempt.state)
      ));
      const state = !projection.approval ? 'awaiting_plan_approval'
        : projection.approval.disposition === 'rejected' ? 'denied'
          : selection ? 'candidate_selected'
            : allSettled && candidates.length > 0 ? 'selection_required'
              : allSettled ? 'failed' : 'running';
      const revision = roundCurrent.plan.nodes[0]?.revision
        ? normalizeWorkflowRevision(roundCurrent.plan.nodes[0].revision) : null;
      summaries.push(deepFreeze({
        round: index + 1, kind: revision ? 'revision' : 'parallel_attempts', state,
        plan: {
          id: roundCurrent.plan.planId, version: roundCurrent.plan.version,
          digest: roundCurrent.plan.digest,
          predecessor: clone(roundCurrent.plan.predecessor),
          approvalDigest: projection.approval?.digest ?? null,
        },
        workflow: {
          definitionDigest: definition.definitionDigest,
          strategy: definition.strategy, workspace: definition.workspace, join: definition.join,
        },
        revision: revision ? {
          id: revision.revisionId, digest: revision.revisionDigest,
          parentCandidateId: revision.parent.candidateId,
          parentResultSha: revision.parent.resultSha,
          feedbackIds: revision.feedback.map((packet) => packet.feedbackId),
        } : null,
        attempts, candidates: clone(candidates), feedback: clone(feedback),
        selection: clone(selection), memberStops: clone(memberStops),
      }));
    }
    return deepFreeze(summaries);
  }

  async _buildWorkflowView(current, observer, options = {}) {
    if (current.plan.nodes.some((node) => node.revision)) {
      await this._validateWorkflowRevisionPlan(current);
    }
    const definition = this._workflowDefinition(current);
    const projection = await this._goalPlanStatus(current, observer);
    const candidates = this._workflowCandidates(current, projection, definition);
    const selection = this._workflowSelection(current, definition, candidates);
    const feedback = this._workflowFeedback(current, definition, candidates);
    const memberStops = this._workflowMemberStops(current, definition);
    const revisionEligibility = await this._workflowRevisionEligibility(current, {
      definition, projection, candidates, selection, feedback,
    });
    const rounds = await this._workflowRoundSummaries(current, observer);
    const runId = current.goal.runId;
    const { workers, ownedWorkers } = runWorkerOwnership(this.driver, runId);
    const story = this.driver.story.snapshot();
    const handlesByTask = new Map(workers.map((handle) => [handle.taskId, handle]));
    const handlesById = new Map(workers.map((handle) => [handle.id, handle]));
    const attempts = [];
    const resultsByTask = new Map();
    for (const binding of definition.attempts) {
      const planNode = current.plan.nodes.find((node) => node.key === binding.nodeKey);
      const node = projection.nodes.find((candidate) => candidate.key === binding.nodeKey);
      const task = node?.taskId ? this.driver.coordination.task(node.taskId) : null;
      const handle = task ? handlesByTask.get(task.id) ?? null : null;
      const workerStory = handle ? story.workers[handle.id] ?? null : null;
      let terminalResult = null;
      if (handle) {
        try { terminalResult = await this.driver.coordinator.result(handle.id); }
        catch (error) { if (error?.code !== 'not_found') throw error; }
      }
      if (terminalResult && task) resultsByTask.set(task.id, terminalResult);
      const selectedDispatch = current.dispatches.find((dispatch) => (
        dispatch.binding?.nodeKey === binding.nodeKey
      )) ?? null;
      const requested = requestedPlanNodeRoute(
        planNode, selectedDispatch, `Workflow Plan node ${binding.nodeKey}`,
      );
      const route = projectRunRouteEvidence({
        requested, liveHandle: handle, terminalResult,
        phase: node?.state === 'accepted' ? 'work_completed'
          : ['failed', 'cancelled'].includes(node?.state) ? node.state : 'running',
      });
      attempts.push({
        role: binding.role, nodeKey: binding.nodeKey, taskId: node?.taskId ?? null,
        state: handle?.status === 'interrupted' && handle.controllableAttached === true
          ? 'interrupted'
          : sessionAttachmentUnproven(handle)
            ? 'interruption_uncertain' : node?.state ?? 'blocked', route,
        candidateId: candidates.find((candidate) => candidate.role === binding.role)?.candidateId ?? null,
        memberStop: (() => {
          const stop = memberStops.find((candidate) => candidate.role === binding.role);
          return stop ? {
            state: stop.status, targetDigest: stop.targetDigest,
            admittedEvent: stop.admittedEvent, completedEvent: stop.completedEvent,
            receiptDigest: stop.receipt?.completionDigest ?? null,
          } : null;
        })(),
        activity: workerStory ? {
          state: workerStory.status,
          lastEventAt: workerStory.lastEventTs || null,
          lastEventSeq: workerStory.lastEventSeq || null,
          turnCount: workerStory.turnCount,
          usage: clone(workerStory.budgetUsed),
          editedPaths: clone(workerStory.editedPaths),
          warnings: clone(workerStory.warnings),
        } : null,
        verification: node?.state === 'accepted' ? 'mechanically_verified'
          : node?.state === 'failed' ? 'failed' : 'pending',
        terminalCause: projectTypedTerminalCause({
          terminalResult, terminalOutcome: node?.terminalOutcome ?? null,
        }),
      });
    }
    const runStop = this.driver.coordination.runStop?.(runId) ?? null;
    const selectedCandidate = selection
      ? candidates.find((candidate) => candidate.candidateId === selection.candidate.id) ?? null
      : null;
    const selectedTask = selectedCandidate
      ? this.driver.coordination.task(selectedCandidate.taskId) : null;
    let selectedPreservation = null;
    if (selectedTask?.assignee && selectedCandidate
      && typeof this.driver.coordinator.inspectPreservedResult === 'function') {
      selectedPreservation = await this.driver.coordinator.inspectPreservedResult(
        selectedTask.assignee, selectedCandidate.resultSha,
      );
    }
    const selectedAdoption = selectedCandidate
      ? this.driver.coordination.runResultAdoption?.(runId, selectedCandidate.nodeKey) ?? null
      : null;
    const selectedIntegration = selectedCandidate
      ? resultsByTask.get(selectedCandidate.taskId)?.integration ?? null : null;
    const selectedAdopted = adoptionState(selectedAdoption) === 'adopted';
    const allSettled = attempts.every((attempt) => (
      ['accepted', 'failed', 'cancelled'].includes(attempt.state)
    ));
    const allAccepted = attempts.every((attempt) => attempt.state === 'accepted');
    const anyFailed = attempts.some((attempt) => ['failed', 'cancelled'].includes(attempt.state));
    const anyDispatched = attempts.some((attempt) => attempt.taskId !== null);
    const stoppableRoles = attempts.filter((attempt) => (
      attempt.taskId !== null && !['accepted', 'failed', 'cancelled'].includes(attempt.state)
      && attempt.memberStop === null
    )).map((attempt) => attempt.role);
    let phase = !projection.approval ? 'awaiting_plan_approval'
      : projection.approval.disposition === 'rejected' ? 'denied'
        : selection ? (selectedIntegration ? 'completed' : 'candidate_selected')
          : allSettled && candidates.length > 0 ? 'selection_required'
            : allSettled && anyFailed ? 'failed'
            : anyDispatched ? 'running' : 'approved';
    if (runStop?.status === 'stopped') phase = 'stopped';
    else if (runStop) phase = 'stopping';
    else if (phase === 'running'
      && attempts.some((attempt) => attempt.state === 'interrupted')
      && workers.every((handle) => handle.activeProviderTurns === 0)) phase = 'interrupted';
    else if (phase === 'running'
      && attempts.some((attempt) => attempt.state === 'interruption_uncertain')
      && workers.every((handle) => handle.activeProviderTurns === 0)) phase = 'interruption_uncertain';
    const currentRevision = current.plan.nodes[0]?.revision
      ? normalizeWorkflowRevision(current.plan.nodes[0].revision) : null;
    const currentRevisionAttempt = currentRevision
      ? attempts.find((attempt) => attempt.nodeKey === current.plan.nodes[0].key) ?? null : null;
    const currentRevisionTask = currentRevisionAttempt?.taskId
      ? this.driver.coordination.task(currentRevisionAttempt.taskId) : null;
    const recovery = phase === 'running' && currentRevision && currentRevisionTask
      && currentRevisionTask.assignee && ownedWorkers.length === 0
      ? {
        state: 'manual_intervention_required',
        reason: 'revision_worker_unconfirmed_after_restart',
        redelivery: 'forbidden',
        round: currentRevision.round,
        planDigest: current.plan.digest,
        nodeKey: current.plan.nodes[0].key,
        taskId: currentRevisionTask.id,
        workerId: currentRevisionTask.assignee,
      } : null;
    const canAdoptSelected = phase === 'candidate_selected' && selectedCandidate
      && selectedPreservation?.state === 'pinned'
      && current.profile.resultPolicy.mode === 'manual' && !selectedAdopted;
    const canIntegrateSelected = phase === 'candidate_selected' && selectedCandidate
      && selectedAdopted && !selectedIntegration
      && current.profile.integrationPolicy.mode === 'manual'
      && current.profile.integrationPolicy.requireSemanticReview === false;
    const canReviseSelected = phase === 'candidate_selected'
      && revisionEligibility.state === 'eligible';

    const runWorkerIds = new Set(workers.map((handle) => handle.id));
    const workerAttention = Object.entries(story.workers)
      .filter(([id]) => runWorkerIds.has(id))
      .flatMap(([id, worker]) => [
        ...worker.questionsPending.map((request) => ({
          kind: 'answer_question', workerId: id,
          requestId: request.msgId ?? handlesById.get(id)?.pendingQuestionId ?? null,
          question: boundedAttentionText(request.question),
        })),
        ...worker.approvalsPending.map((request) => ({
          kind: 'answer_approval', workerId: id, requestId: request.id ?? null,
          approvalKind: request.kind,
        })),
      ]);
    const selectionAttention = phase === 'selection_required' ? [{
      kind: 'candidate_selection', state: 'required',
      summary: 'Parallel Candidates are verified; operator selection is required.',
      roles: candidates.map((candidate) => candidate.role),
    }] : [];
    const revisionAttention = phase === 'candidate_selected'
      && revisionEligibility.state !== 'eligible'
      && !['feedback_required', 'selection_required'].includes(revisionEligibility.reason)
      ? [{
        kind: 'workflow_revision', state: 'blocked', reason: revisionEligibility.reason,
        summary: `Recursive Candidate revision paused: ${revisionEligibility.reason}.`,
      }] : [];
    const recoveryAttention = recovery ? [{
      kind: 'workflow_recovery', state: recovery.state, reason: recovery.reason,
      summary: 'Revision provider ownership is unconfirmed after restart; redelivery is forbidden.',
    }] : [];
    const preservationAttention = phase === 'interruption_uncertain' ? [{
      kind: 'session_preservation', state: 'quarantined',
      reason: 'session_attachment_unproven',
      summary: 'Reusable provider-session attachment is unproven; whole-Run stop is the only safe action.',
    }] : [];
    const attention = [
      ...workerAttention, ...selectionAttention, ...revisionAttention, ...recoveryAttention,
      ...preservationAttention,
    ].slice(0, MAX_ATTENTION);
    const terminalCause = attempts.find((attempt) => attempt.terminalCause)?.terminalCause ?? null;
    const verificationState = allAccepted ? 'mechanically_verified'
      : candidates.length > 0 && allSettled ? 'partially_verified'
        : anyFailed ? 'failed' : 'pending';
    const resourcesSettled = ownedWorkers.length === 0;
    const stages = [
      { key: 'intent', label: 'Workflow intent', state: 'complete', detail: 'Workflow definition bound to exact Goal and Plan.' },
      { key: 'plan', label: 'Workflow Plan', state: projection.approval?.disposition === 'approved' ? 'complete' : 'active', detail: `${attempts.length} attributable isolated Attempts.` },
      { key: 'wave', label: 'Parallel Wave', state: allSettled ? 'complete' : anyDispatched ? 'active' : 'pending', detail: `${attempts.filter((attempt) => ['accepted', 'failed', 'cancelled'].includes(attempt.state)).length}/${attempts.length} settled.` },
      { key: 'selection', label: 'Candidate selection', state: phase === 'selection_required' ? 'blocked' : selection ? 'complete' : 'pending', detail: phase === 'selection_required' ? 'Operator selection is required.' : selection ? `${selection.candidate.role} selected.` : 'Awaiting verified Candidates.' },
      { key: 'cleanup', label: 'Owned-resource cleanup', state: resourcesSettled ? 'complete' : 'active', detail: resourcesSettled ? 'Owned resources settled.' : 'Owned resources remain active.' },
    ];
    const currentStage = stages.find((stage) => ['active', 'blocked', 'failed'].includes(stage.state))
      ?? stages.find((stage) => stage.state === 'pending') ?? stages.at(-1);
    const planPreviewCore = {
      objective: current.goal.objective, strategy: definition.strategy,
      workspace: definition.workspace, join: definition.join,
      attempts: definition.attempts.map((attempt) => ({
        role: attempt.role, nodeKey: attempt.nodeKey,
        route: clone(workflowAttemptRoute(definition, attempt)),
      })),
      round: rounds.length,
      revision: current.plan.nodes[0]?.revision?.revisionId ?? null,
      profileDigest: current.profile.digest, planDigest: current.plan.digest,
    };
    const view = {
      schemaVersion: 1, runId, objective: current.goal.objective,
      profile: { name: current.profileName, digest: current.profile.digest },
      phase, cursor: projection.coordinationUpperBound,
      nextActions: phase === 'awaiting_plan_approval'
        ? [{ kind: 'approve_plan', planDigest: current.plan.digest }]
        : phase === 'selection_required'
          ? [
            { kind: 'send_feedback', roles: candidates.map((candidate) => candidate.role) },
            { kind: 'select_candidate', roles: candidates.map((candidate) => candidate.role) },
          ]
        : phase === 'interruption_uncertain' ? [{ kind: 'stop' }]
        : phase === 'interrupted' ? [
          { kind: 'send', roles: attempts.filter((attempt) => attempt.state === 'interrupted')
            .map((attempt) => attempt.role) },
          { kind: 'stop' }, { kind: 'wait' },
        ]
        : phase === 'running' ? [
          ...(stoppableRoles.length > 0 ? [{ kind: 'stop_member', roles: stoppableRoles }] : []),
          { kind: 'stop' }, { kind: 'wait' },
        ]
          : phase === 'stopping' ? [{ kind: 'stop' }, { kind: 'wait' }]
          : phase === 'candidate_selected' ? [
            { kind: 'send_feedback', roles: candidates.map((candidate) => candidate.role) },
            ...(canReviseSelected ? [{ kind: 'revise_candidate' }] : []),
            ...(canAdoptSelected ? [{
              kind: 'adopt_result', nodeKey: selectedCandidate.nodeKey,
              resultSha: selectedCandidate.resultSha,
            }] : []),
            ...(canIntegrateSelected ? [{
              kind: 'integrate', strategies: clone(current.profile.integrationPolicy.strategies),
            }] : []),
            { kind: 'evidence' },
          ] : [{ kind: 'evidence' }],
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: {
        id: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
        approval: projection.approval
          ? { disposition: projection.approval.disposition, digest: projection.approval.digest }
          : null,
      },
      workflow: {
        strategy: definition.strategy, workspace: definition.workspace, join: definition.join,
        definitionDigest: definition.definitionDigest,
        round: rounds.length, roundCount: rounds.length,
        revisionEligibility: workflowEligibilityProjection(revisionEligibility),
      },
      planPreview: { ...planPreviewCore, displayDigest: digest(planPreviewCore) },
      nodes: clone(projection.nodes),
      attempts: clone(attempts),
      candidates: clone(candidates),
      feedback: clone(feedback),
      memberStops: clone(memberStops),
      selection: clone(selection),
      rounds: clone(rounds),
      route: { state: 'multiple', attempts: attempts.map(({ role, route }) => ({ role, ...clone(route) })) },
      workerPolicy: { state: 'multiple', attempts: attempts.map(({ role }) => ({ role, request: clone(current.profile.workerPolicy) })) },
      budget: { allocated: clone(current.goal.budget), node: null, termination: terminalCause },
      attention, attentionTruncated: workerAttention.length + selectionAttention.length
        + revisionAttention.length + recoveryAttention.length + preservationAttention.length
        > attention.length,
      verification: {
        state: verificationState,
        verdict: candidates.length > 0 ? {
          accepted: candidates.length, attempted: attempts.length,
        } : null,
      },
      semanticReview: { state: 'not_started', findings: [] },
      progress: { current: currentStage.key, summary: `${currentStage.label}: ${currentStage.detail}`, stages },
      result: selection && selectedCandidate ? {
        state: selectedIntegration ? 'integrated' : selectedAdopted ? 'adopted' : 'selected',
        candidate: clone(selection.candidate),
        nodeKey: selectedCandidate.nodeKey,
        taskId: selectedCandidate.taskId,
        sha: selectedCandidate.resultSha,
        retainedResultRef: selectedCandidate.retainedResultRef,
        commitArtifact: clone(selectedCandidate.evidence.commitArtifact),
        verificationArtifact: clone(selectedCandidate.evidence.verificationArtifact),
        preservation: selectedIntegration ? { state: 'integrated' }
          : selectedPreservation ? { state: selectedPreservation.state }
            : { state: 'unavailable' },
        adoption: selectedAdoption ? {
          state: adoptionState(selectedAdoption),
          receiptDigest: selectedAdoption.receipt?.receiptDigest
            ?? selectedAdoption.receiptDigest ?? null,
        } : null,
      } : candidates.length > 0 ? {
        state: 'selection_required', candidateCount: candidates.length,
      } : null,
      integration: selectedIntegration ? {
        state: 'integrated', strategy: selectedIntegration.strategy,
        beforeSha: selectedIntegration.beforeSha,
        resultSha: selectedIntegration.resultSha,
        afterSha: selectedIntegration.afterSha,
      } : null,
      export: null,
      ownership: phase === 'stopped' ? { workers: 0, workerIds: [], closed: false }
        : { workers: ownedWorkers.length, workerIds: ownedWorkers.map((handle) => handle.id).sort(), closed: false },
      execution: {
        state: phase,
        activeProviderTurns: workers.filter((handle) => handle.activeProviderTurns === 1).length,
        controllableAttachedMembers: workers.filter((handle) => handle.controllableAttached === true).length,
        dispatchClosed: Boolean(runStop),
      },
      evidence: [],
      narrative: terminalCauseNarrative(terminalCause)
        ?? (phase === 'selection_required'
          ? `${candidates.length} mechanically verified Candidates await explicit selection.`
          : phase === 'interruption_uncertain'
            ? 'Provider-session attachment is unproven and quarantined; stop is the only safe action.'
          : selection ? `${selection.candidate.role} is the explicitly selected verified Candidate.`
          : `${attempts.filter((attempt) => attempt.state === 'accepted').length}/${attempts.length} Attempts verified.`),
      lastAction: options.action ? clone(options.action) : null,
      recovery: clone(recovery), preservation: { state: 'unavailable', available: false, checkpointSha: null },
      resume: null, terminalCause,
      stop: runStop ? {
        state: runStop.status, admittedAt: runStop.admittedAt, completedAt: runStop.completedAt,
        targetCount: runStop.targetWorkerIds.length, targetDigest: runStop.targetDigest,
        receipt: clone(runStop.receipt),
      } : null,
      close: null,
    };
    if (Buffer.byteLength(JSON.stringify(view)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Workflow view exceeds its deployment byte ceiling',
        'application_run_view_oversize');
    }
    return deepFreeze(view);
  }

  async _buildView(current, observer, options = {}) {
    if (await this._reconcileContextCalls(current)) {
      current = this._findRun(current.goal.runId);
    }
    if (!current.profile) return this._historicalProfileView(current, observer, options);
    if (this._isWorkflowRun(current)) return this._buildWorkflowView(current, observer, options);
    if (!current.plan) return this._planningView(current);
    const runId = current.goal.runId;
    if (options.expected && (options.expected.goal.digest !== current.goal.digest || options.expected.plan.digest !== current.plan.digest)) {
      throw applicationError('run projection differs from the compiled request', 'application_run_conflict');
    }
    const projection = await this._goalPlanStatus(current, observer);
    const node = projection.nodes[0];
    const task = node.taskId ? this.driver.coordination.task(node.taskId) : null;
    const workerId = task?.assignee ?? null;
    let result = null;
    if (workerId) {
      try { result = await this.driver.coordinator.result(workerId); }
      catch (error) { if (error?.code !== 'not_found') throw error; }
    }
    const artifacts = (task?.artifactIds ?? []).map((artifactId) => this.driver.coordination.artifact(artifactId))
      .filter(Boolean).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const activeAccepted = (artifact) => artifact.accepted === true && artifact.supersededBy === null
      && !Object.hasOwn(artifact, 'acceptanceInvalidation');
    const acceptedCommit = artifacts.find((artifact) => activeAccepted(artifact) && artifact.kind === 'commit') ?? null;
    const acceptedVerification = artifacts.find((artifact) => activeAccepted(artifact) && artifact.kind === 'verification') ?? null;
    const resultSha = acceptedCommit?.refs?.sha ?? null;
    const resultStability = acceptedVerification?.stability ?? result?.verificationStability ?? null;
    const adoption = this.driver.coordination.runResultAdoption?.(runId, node.key) ?? null;
    let preservation = null;
    if (workerId && resultSha && typeof this.driver.coordinator.inspectPreservedResult === 'function') {
      preservation = await this.driver.coordinator.inspectPreservedResult(workerId, resultSha);
    }
    let phase;
    if (!projection.approval) phase = 'awaiting_plan_approval';
    else if (projection.approval.disposition === 'rejected') phase = 'denied';
    else if (node.state === 'accepted') phase = 'work_completed';
    else if (node.state === 'failed') phase = 'failed';
    else if (node.state === 'cancelled') phase = 'cancelled';
    else if (node.taskId) phase = 'running';
    else phase = 'approved';
    const runStop = this.driver.coordination.runStop?.(runId) ?? null;
    if (runStop?.status === 'stopped') phase = 'stopped';
    else if (runStop) phase = 'stopping';

    // VR6/RV: inconclusive runtime repair remains repeatable while a candidate-owned diagnostic
    // checkpoint gets exactly one confirmation. The origin is pinned on the checkpoint so a later
    // inconclusive confirmation cannot be mistaken for a fresh runtime-repair allowance.
    const verdictOutcome = result?.verdict?.outcome ?? null;
    const durableRetry = this.driver.coordination.runVerificationRetry?.(runId, node.key) ?? null;
    let retryProjection = null;
    const originOutcome = result?.checkpoint?.originOutcome ?? verdictOutcome;
    const candidateConfirmationUnspent = originOutcome === 'candidate_failed' && durableRetry === null;
    const runtimeRepairable = originOutcome === 'inconclusive' && verdictOutcome === 'inconclusive';
    if ((candidateConfirmationUnspent || runtimeRepairable) && result?.checkpoint?.state === 'pinned') {
      let candidatePreserved = false;
      if (workerId && typeof this.driver.coordinator.inspectCheckpoint === 'function') {
        candidatePreserved = (await this.driver.coordinator.inspectCheckpoint(workerId)).state === 'pinned';
      }
      const attempt = originOutcome === 'candidate_failed' ? 1 : durableRetry
        ? (durableRetry.status === 'pending' ? durableRetry.attempt : durableRetry.attempt + 1)
        : 1;
      const available = candidatePreserved && !runStop
        && projection.approval?.disposition === 'approved'
        && typeof this.driver.coordinator.retryVerification === 'function'
        && typeof this.driver.coordination.admitRunVerificationRetry === 'function'
        && (originOutcome === 'candidate_failed' ? durableRetry === null
          : (!durableRetry || ['pending', 'inconclusive', 'cancelled'].includes(durableRetry.status)));
      retryProjection = {
        available, attempt, checkpointSha: result.checkpoint.sha, candidatePreserved, originOutcome,
      };
    }
    // PS5: while a cancelled Run's pinned checkpoint and approved Plan remain current, offer one
    // coordinate-free resume_work action. Preservation is not acceptance: the projection only
    // advertises the resume, never an adopted result.
    let resumeProjection = null;
    if (phase === 'cancelled' && result?.checkpoint?.state === 'pinned' && !runStop
      && projection.approval?.disposition === 'approved'
      && typeof this.driver.coordinator.resumePreservedWork === 'function') {
      let candidatePreserved = false;
      if (workerId && typeof this.driver.coordinator.inspectCheckpoint === 'function') {
        candidatePreserved = (await this.driver.coordinator.inspectCheckpoint(workerId)).state === 'pinned';
      }
      resumeProjection = {
        available: candidatePreserved && !!node.taskId,
        checkpointSha: result.checkpoint.sha,
        candidatePreserved,
      };
    }
    const terminalCause = projectTypedTerminalCause({ terminalResult: result, runStop });

    const { workers, ownedWorkers } = runWorkerOwnership(this.driver, runId);
    const ownedWorker = workerId ? workers.find((handle) => handle.id === workerId) ?? null : null;
    if (!runStop && phase === 'running' && ownedWorker?.status === 'interrupted'
      && ownedWorker.controllableAttached === true) phase = 'interrupted';
    else if (!runStop && phase === 'running' && sessionAttachmentUnproven(ownedWorker)) {
      phase = 'interruption_uncertain';
    }
    const requested = requestedPlanNodeRoute(
      current.plan.nodes[0], current.dispatch, 'Run Plan node',
    );
    const route = projectRunRouteEvidence({ requested, liveHandle: ownedWorker, terminalResult: result, phase });
    const { resolved, observed, launchEnforcement, providerAttestation } = route;
    const workerPolicy = ownedWorker?.workerPolicy
      ?? (current.plan.nodes[0].workerPolicy
        ? { state: 'requested', request: clone(current.plan.nodes[0].workerPolicy) }
        : { state: 'legacy_unattested' });
    const story = this.driver.story.snapshot();
    const handlesById = new Map(workers.map((handle) => [handle.id, handle]));
    const runWorkerIds = new Set(workers.map((handle) => handle.id));
    const allAttention = Object.entries(story.workers)
      .filter(([id]) => runWorkerIds.has(id))
      .flatMap(([id, worker]) => [
        ...worker.questionsPending.map((request) => ({
          kind: 'answer_question', workerId: id, requestId: request.msgId ?? handlesById.get(id)?.pendingQuestionId ?? null,
          question: boundedAttentionText(request.question),
        })),
        ...worker.approvalsPending.map((request) => ({
          kind: 'answer_approval', workerId: id, requestId: request.id ?? handlesById.get(id)?.pendingApprovalId ?? null,
          approvalKind: request.kind,
        })),
      ]);
    if (phase === 'interruption_uncertain') {
      allAttention.push({
        kind: 'session_preservation', state: 'quarantined',
        reason: 'session_attachment_unproven',
        summary: 'Reusable provider-session attachment is unproven; whole-Run stop is the only safe action.',
      });
    }
    const attention = allAttention.slice(0, MAX_ATTENTION);
    const attentionTruncated = allAttention.length > attention.length;
    const planNode = current.plan.nodes[0];
    const planPreviewCore = {
      objective: current.goal.objective,
      definitionOfDone: clone(current.goal.definitionOfDone),
      constraints: clone(current.goal.constraints),
      risk: current.goal.risk,
      goalBudget: clone(current.goal.budget),
      node: {
        key: planNode.key,
        objective: planNode.objective,
        pathScope: clone(planNode.pathScope),
        ...(planNode.contextScope ? { contextScope: clone(planNode.contextScope) } : {}),
        risk: planNode.risk,
        budget: clone(planNode.budget),
        verification: clone(planNode.verification),
        route: requested,
        capabilities: clone(planNode.capabilities),
        effects: clone(planNode.effects),
        ...(Object.hasOwn(planNode, 'requiredEffects') ? { requiredEffects: clone(planNode.requiredEffects) } : {}),
      },
      profileDigest: current.profile.digest,
      planDigest: current.plan.digest,
    };
    let publicResult = resultSha ? {
      state: result?.integration ? 'integrated' : adoptionState(adoption) === 'adopted' ? 'adopted' : 'accepted',
      nodeKey: node.key,
      sha: resultSha,
      commitArtifact: acceptedCommit ? { id: acceptedCommit.id, digest: acceptedCommit.digest } : null,
      verificationArtifact: acceptedVerification ? { id: acceptedVerification.id, digest: acceptedVerification.digest } : null,
      stability: resultStability,
      preservation: result?.integration ? { state: 'integrated' }
        : preservation ? { state: preservation.state } : { state: 'unavailable' },
      adoption: adoption ? {
        state: adoptionState(adoption),
        receiptDigest: adoption.receipt?.receiptDigest ?? adoption.receiptDigest ?? null,
      } : null,
    } : null;
    const semanticReview = await this._semanticReview(current, {
      nodes: [node], result: publicResult,
      plan: { approval: projection.approval ? { digest: projection.approval.digest } : null },
    });
    const integration = result?.integration ? deepFreeze({
      state: 'integrated', strategy: result.integration.strategy,
      beforeSha: result.integration.beforeSha, resultSha: result.integration.resultSha,
      afterSha: result.integration.afterSha,
      stability: result.integration.stability ?? resultStability,
    }) : null;
    const durableExport = this.driver.coordination.runResultExport?.(runId, node.key) ?? null;
    const exportResult = durableExport?.status === 'completed' ? clone(durableExport.receipt)
      : durableExport?.status === 'pending' ? {
        schemaVersion: 1,
        state: 'pending',
        format: durableExport.format,
        runId: durableExport.runId,
        nodeKey: durableExport.nodeKey,
        resultSha: durableExport.resultSha,
        evidenceDigest: durableExport.evidenceDigest,
        exportId: durableExport.exportId,
        locator: durableExport.locator,
        admittedAt: durableExport.admittedAt,
      } : durableExport?.status === 'cancelled' ? {
        schemaVersion: 1,
        state: 'cancelled',
        format: durableExport.format,
        runId: durableExport.runId,
        nodeKey: durableExport.nodeKey,
        resultSha: durableExport.resultSha,
        exportId: durableExport.exportId,
        cancellation: {
          kind: durableExport.cancellation?.kind ?? 'run_stop',
          cancellationDigest: durableExport.cancellation?.cancellationDigest ?? null,
        },
        cancelledAt: durableExport.cancelledAt ?? null,
      } : null;
    if (!runStop && node.state === 'accepted') {
      if (semanticReview.state === 'review_running') phase = 'reviewing';
      else if ((integration || durableExport?.status === 'completed')
        && (current.profile.reviewPolicy.mode === 'none' || semanticReview.state === 'semantic_reviewed')) phase = 'completed';
      else phase = 'work_completed';
    }
    const canAdopt = resultSha && preservation?.state === 'pinned'
      && current.profile.resultPolicy.mode === 'manual' && adoptionState(adoption) !== 'adopted';
    const canReview = current.profile.reviewPolicy.mode === 'required' && semanticReview.state === 'semantics_unverified';
    const canIntegrate = current.profile.integrationPolicy.mode === 'manual'
      && (!current.profile.integrationPolicy.requireSemanticReview
        || semanticReview.state === 'semantic_reviewed')
      && (!current.profile.integrationPolicy.requireAdoptedResult || adoptionState(adoption) === 'adopted')
      && !integration;
    const canExport = current.profile.exportPolicy.mode === 'manual' && this.exportRoot !== null
      && resultSha !== null && durableExport === null
      && (!current.profile.exportPolicy.requireAdoptedResult || adoptionState(adoption) === 'adopted')
      && (!current.profile.exportPolicy.requireSemanticReview || semanticReview.state === 'semantic_reviewed')
      && (!current.profile.exportPolicy.requireIntegration || integration?.state === 'integrated');
    const exportActions = durableExport?.status === 'completed' && !runStop
      ? [{ kind: 'download_export', exportId: durableExport.exportId }]
      : durableExport?.status === 'pending' ? [{ kind: 'wait' }, { kind: 'status' }]
        : canExport ? [{ kind: 'export_result' }] : [];
    const nextActions = phase === 'stopping' ? [{ kind: 'wait' }, { kind: 'status' }]
      : phase === 'awaiting_plan_approval'
        ? [{ kind: 'approve_plan', planDigest: current.plan.digest }]
        : phase === 'interrupted'
          ? [{ kind: 'send' }, { kind: 'stop' }, { kind: 'wait' }]
        : phase === 'interruption_uncertain' ? [{ kind: 'stop' }]
        : ['running', 'reviewing'].includes(phase) ? [{ kind: 'steer' }, { kind: 'stop' }, { kind: 'wait' }, ...attention]
          : phase === 'work_completed' ? [
            ...(canReview ? [{ kind: 'semantic_review', routes: clone(current.profile.reviewPolicy.routes) }] : []),
            ...(canIntegrate ? [{ kind: 'integrate', strategies: clone(current.profile.integrationPolicy.strategies) }] : []),
            ...exportActions,
            { kind: 'evidence' },
            ...(canAdopt ? [{ kind: 'adopt_result', nodeKey: node.key, resultSha }] : []),
          ]
            : APPLICATION_RUN_TERMINAL_PHASES.has(phase) ? [
              ...(retryProjection?.available ? [{ kind: 'retry_verification' }] : []),
              ...(resumeProjection?.available ? [{ kind: 'resume_work' }] : []),
              { kind: 'evidence' },
              ...exportActions,
              ...(canAdopt ? [{ kind: 'adopt_result', nodeKey: node.key, resultSha }] : [])]
              : [{ kind: 'status' }];
    const verificationState = ['work_completed', 'reviewing', 'completed'].includes(phase)
      ? resultStability === 'passed_after_candidate_failure' ? 'mechanically_verified_unstable' : 'mechanically_verified'
      : phase === 'failed' ? (retryProjection && verdictOutcome === 'inconclusive' ? 'inconclusive' : 'failed') : 'pending';
    const resourcesSettled = ownedWorkers.length === 0;
    const progress = runProgress({
      phase, approval: projection.approval, node,
      route,
      verification: { state: verificationState, stability: resultStability }, reviewPolicyMode: current.profile.reviewPolicy.mode, semanticReview,
      result: publicResult, integration, exportResult, resourcesSettled, stop: runStop ? {
        state: runStop.status, receipt: runStop.receipt,
      } : null,
    });
    const view = {
      schemaVersion: 1,
      runId,
      objective: current.goal.objective,
      profile: { name: current.profileName, digest: current.profile.digest },
      phase,
      cursor: projection.coordinationUpperBound,
      nextActions,
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: {
        id: current.plan.planId,
        version: current.plan.version,
        digest: current.plan.digest,
        approval: projection.approval ? { disposition: projection.approval.disposition, digest: projection.approval.digest } : null,
      },
      planPreview: { ...planPreviewCore, displayDigest: digest(planPreviewCore) },
      nodes: clone(projection.nodes),
      route: {
        requested, resolved, observed, launchEnforcement, providerAttestation,
        rationale: {
          launchEnforcement: 'exact deployment-profile route',
          providerAttestation: 'provider-native observation only',
        },
      },
      workerPolicy: clone(workerPolicy),
      budget: { allocated: clone(current.goal.budget), node: clone(node.budget), termination: terminalCause },
      attention,
      attentionTruncated,
      verification: {
        state: verificationState,
        stability: resultStability,
        verdict: this._closedVerdictProjection(result, planNode, phase, workerId),
        ...(retryProjection ? {
          retry: retryProjection,
          checkpoint: { sha: retryProjection.checkpointSha },
          dispositions: {
            candidate: result?.verdict?.execution?.state ?? null,
            base: result?.verdict?.baseExecution?.state ?? null,
          },
          runtimeDigest: result?.verdict?.runtimeDigest ?? null,
        } : {}),
      },
      semanticReview,
      progress,
      result: publicResult,
      integration,
      export: exportResult,
      ownership: phase === 'stopped' ? { workers: 0, workerIds: [], closed: false }
        : { workers: ownedWorkers.length, workerIds: ownedWorkers.map((handle) => handle.id).sort(), closed: false },
      execution: {
        state: phase,
        activeProviderTurns: workers.filter((handle) => handle.activeProviderTurns === 1).length,
        controllableAttachedMembers: workers.filter((handle) => handle.controllableAttached === true).length,
        dispatchClosed: Boolean(runStop),
      },
      evidence: artifacts.map(publicArtifact),
      narrative: terminalCauseNarrative(terminalCause) ?? (phase === 'stopped' ? 'Run stopped; its dispatch authority is closed and its exact stop receipt is attached.'
        : phase === 'stopping' ? 'Run stop is durably admitted and physical ownership is converging.'
          : phase === 'interrupted'
            ? 'Provider turn interrupted; the exact Plan member and native session remain attached for send or stop.'
            : phase === 'interruption_uncertain'
              ? 'Provider-session attachment is unproven and quarantined; stop is the only safe action.'
            : runNarrative(story.workers, runWorkerIds)),
      lastAction: options.action ? clone(options.action) : null,
      recovery: options.recovery ? clone(options.recovery) : null,
      preservation: resumeProjection ? {
        state: 'pinned', available: resumeProjection.available, checkpointSha: resumeProjection.checkpointSha,
      } : (result?.checkpoint?.state === 'pinned' ? { state: 'pinned', available: false, checkpointSha: result.checkpoint.sha } : { state: 'unavailable', available: false, checkpointSha: null }),
      resume: options.resume ? clone(options.resume) : null,
      terminalCause,
      stop: runStop ? {
        state: runStop.status, admittedAt: runStop.admittedAt, completedAt: runStop.completedAt,
        targetCount: runStop.targetWorkerIds.length, targetDigest: runStop.targetDigest, receipt: clone(runStop.receipt),
      } : null,
      close: null,
    };
    if (Buffer.byteLength(JSON.stringify(view)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run view exceeds its deployment byte ceiling', 'application_run_view_oversize');
    }
    return deepFreeze(view);
  }

  async wait(runId, rawObserver, options = {}, rawContext = null) {
    this._assertOpen();
    const context = normalizeCommandContext(rawContext);
    exactObject(options, ['timeoutMs'], 'application_wait_invalid', 'wait options');
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 24 * 60 * 60 * 1000) {
      throw applicationError('wait timeout is invalid', 'application_wait_invalid');
    }
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const deadline = Date.now() + options.timeoutMs;
    let view = await this.status(runId, observer, {}, context);
    while (!PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase) && Date.now() < deadline) {
      await this.driver.coordinator.wait(Math.min(100, Math.max(1, deadline - Date.now())));
      view = await this.status(runId, observer, {}, context);
    }
    return view;
  }

  _followCategory(event) {
    if (['goal.version_defined', 'plan.version_proposed', 'plan.approval_decided',
      'plan.node_dispatched', 'plan.node_budget_settled'].includes(event.kind)) return 'plan';
    if (['task.created', 'task.claimed', 'task.transitioned', 'task.acceptance_revoked'].includes(event.kind)) return 'execution';
    if (event.kind.startsWith('run.orchestrator_lease_') || event.kind.startsWith('run.lineage_')) return 'orchestration';
    if (event.kind.startsWith('context.')) return 'context';
    if (['artifact.registered', 'artifact.superseded', 'evidence.mapped'].includes(event.kind)) return 'evidence';
    if (event.kind.startsWith('run.result_')) return 'result';
    if (event.kind.startsWith('run.stop_')) return 'cleanup';
    if (event.kind === 'driver.recorded') {
      const driverKind = event.payload?.kind ?? '';
      if (driverKind.startsWith('integration.')) return 'integration';
      if (driverKind.startsWith('recovery.')) return 'recovery';
      if (driverKind.startsWith('verification.') || driverKind.startsWith('acceptance.')) return 'verification';
      if (driverKind === APPLICATION_WORKFLOW_SELECTION_RECORD_KIND) return 'result';
      if (driverKind === APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND) return 'evidence';
      if (driverKind.startsWith('result.')) return 'result';
      return 'execution';
    }
    return null;
  }

  _eventBelongsToRun(event, current) {
    const payload = event.payload ?? {};
    const runId = current.goal.runId;
    if (event.kind === 'evidence.mapped') {
      const operational = this.driver.log.read(payload.worker)
        .find((candidate) => candidate.seq === payload.workerSeq);
      if (!operational) return false;
      if (operational.runId !== null && operational.runId !== undefined) {
        return operational.runId === runId;
      }
      const taskId = typeof operational.taskId === 'string' ? operational.taskId : null;
      return taskId !== null && this.driver.coordination.task(taskId)?.runId === runId;
    }
    if (event.kind.startsWith('run.orchestrator_lease_')) return payload.parent?.runId === runId;
    if (event.kind.startsWith('run.lineage_')) {
      return payload.childRunId === runId || payload.parentRunId === runId
        || payload.rootRunId === runId || payload.ancestors?.includes(runId) === true;
    }
    if (event.kind.startsWith('run.stop_')) {
      return payload.runId === runId || payload.targetRunIds?.includes(runId) === true;
    }
    if (event.kind === 'context.session_admitted') return payload.session?.runId === runId;
    if (event.kind === 'context.cell_admitted') {
      return this.driver.coordination.contextSession(payload.cell?.sessionId)?.runId === runId;
    }
    if (event.kind === 'context.cell_settled') {
      const cell = this.driver.coordination.contextCell(payload.cellId);
      return this.driver.coordination.contextSession(cell?.sessionId)?.runId === runId;
    }
    const explicit = [payload.runId, payload.goal?.runId, payload.plan?.runId,
      payload.authority?.runId, payload.binding?.runId].filter((value) => value !== undefined && value !== null);
    if (explicit.some((value) => value !== runId)) return false;
    const taskId = typeof payload.taskId === 'string' ? payload.taskId
      : event.kind.startsWith('task.') && typeof payload.id === 'string' ? payload.id
        : typeof payload.target?.taskId === 'string' ? payload.target.taskId : null;
    if (taskId) return this.driver.coordination.task(taskId)?.runId === runId;
    if (explicit.length > 0) return true;
    const planRef = payload.approval?.plan ?? payload.planRef ?? null;
    if (planRef && current.plan) {
      return planRef.planId === current.plan.planId && planRef.version === current.plan.version
        && planRef.digest === current.plan.digest;
    }
    return false;
  }

  _progressTiming(current, view) {
    // Narrow projection test doubles created before Phase 89 sometimes instantiate the prototype
    // without running the constructor. Production applications always own `_clock`; the fallback
    // preserves those read-only doubles without changing deployment clock authority.
    const observedAt = typeof this._clock === 'function'
      ? this._clock() : new Date().toISOString();
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt
    ) {
      throw applicationError('application progress clock is invalid',
        'application_progress_clock_invalid');
    }
    const meaningful = this.driver.coordination.events().filter((event) => (
      typeof event.ts === 'string' && this._followCategory(event) !== null
      && this._eventBelongsToRun(event, current)
    ));
    const configuredStartMs = Date.parse(current.goal.definedAt);
    const firstEventMs = Date.parse(meaningful[0]?.ts);
    const startedMs = Number.isFinite(configuredStartMs) ? configuredStartMs
      : Number.isFinite(firstEventMs) ? firstEventMs : observedMs;
    const startedAt = new Date(startedMs).toISOString();
    const last = meaningful.at(-1) ?? { ts: startedAt };
    const lastMs = Date.parse(last.ts);
    if (!Number.isFinite(lastMs)) {
      throw applicationError('application progress timestamp is invalid',
        'application_progress_clock_invalid');
    }
    const terminal = APPLICATION_RUN_TERMINAL_PHASES.has(view.phase);
    const completedAt = terminal ? new Date(lastMs).toISOString() : null;
    const untilMs = terminal ? lastMs : observedMs;
    const boundedDuration = (end, start) => Math.min(
      Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(end - start)),
    );
    return deepFreeze({
      startedAt,
      observedAt,
      elapsedMs: boundedDuration(untilMs, startedMs),
      lastProgress: {
        at: new Date(lastMs).toISOString(),
        stage: view.progress?.current ?? null,
        summary: view.progress?.summary ?? 'Run progress is unavailable.',
      },
      silenceMs: terminal ? 0 : boundedDuration(observedMs, lastMs),
      completedAt,
    });
  }

  _followChange(event, category) {
    const summaries = {
      plan: 'Run Plan authority changed.',
      execution: 'Run execution state changed.',
      orchestration: 'Run orchestration authority or topology changed.',
      context: 'Run Context state changed.',
      verification: 'Run verification state changed.',
      evidence: 'Run evidence changed.',
      result: 'Run result selection changed.',
      integration: 'Run integration state changed.',
      recovery: 'Run recovery state changed.',
      cleanup: 'Run cleanup state changed.',
    };
    return deepFreeze({ seq: event.seq, category, kind: event.kind, summary: summaries[category] });
  }

  _followPage(current, view, afterCursor) {
    const policy = current.profile.followPolicy;
    const observedUpperBound = view.cursor;
    const inspected = this.driver.coordination.events(afterCursor + 1, policy.maxScanEvents)
      .filter((event) => event.seq <= observedUpperBound);
    const relevant = inspected.flatMap((event) => {
      const category = this._followCategory(event);
      return category && this._eventBelongsToRun(event, current) ? [this._followChange(event, category)] : [];
    });
    const changes = relevant.slice(0, policy.maxChanges);
    const pageFull = relevant.length > changes.length;
    const throughCursor = pageFull
      ? changes[changes.length - 1].seq
      : inspected[inspected.length - 1]?.seq ?? afterCursor;
    return {
      schemaVersion: 1,
      runId: current.goal.runId,
      afterCursor,
      throughCursor,
      observedUpperBound,
      hasMore: pageFull || throughCursor < observedUpperBound,
      timedOut: false,
      terminal: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
      changes,
    };
  }

  async follow(runId, rawObserver, options = {}, rawContext = null) {
    this._assertOpen();
    await this.ready;
    const context = normalizeCommandContext(rawContext);
    exactObject(options, ['afterCursor', 'timeoutMs'], 'application_follow_invalid', 'follow options');
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const current = this._findRun(runId);
    const policy = current.profile.followPolicy;
    if (policy.mode !== 'enabled') {
      throw applicationError('Run follow is not enabled by its deployment profile', 'application_follow_unavailable');
    }
    if (!Number.isSafeInteger(options.afterCursor) || options.afterCursor < 0
      || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0
      || options.timeoutMs > policy.maxWaitMs) {
      throw applicationError('Run follow request exceeds deployment policy', 'application_follow_invalid');
    }
    this._authorizeRecursiveCommand('run.status', runId, observer, context);
    await this._authorize('run.follow', observer, runId, { afterCursor: options.afterCursor });
    const deadline = Date.now() + options.timeoutMs;
    const controller = new AbortController();
    this._followControllers.add(controller);
    try {
      for (;;) {
        if (controller.signal.aborted) {
          throw applicationError('Run follow was cancelled', 'application_follow_cancelled');
        }
        let view;
        try { view = await this._buildView(current, this.principals.observer); }
        catch (error) {
          if (controller.signal.aborted) {
            throw applicationError('Run follow was cancelled', 'application_follow_cancelled');
          }
          throw error;
        }
        if (controller.signal.aborted) {
          throw applicationError('Run follow was cancelled', 'application_follow_cancelled');
        }
        if (options.afterCursor > view.cursor) {
          throw applicationError('Run follow cursor is ahead of durable authority', 'application_follow_cursor_ahead');
        }
        const page = this._followPage(current, view, options.afterCursor);
        if (page.changes.length > 0 || page.hasMore || page.terminal || Date.now() >= deadline) {
          const follow = Date.now() >= deadline && page.changes.length === 0 && !page.hasMore
            ? { ...page, timedOut: true } : page;
          if (controller.signal.aborted) {
            throw applicationError('Run follow was cancelled', 'application_follow_cancelled');
          }
          this._authorizeRecursiveCommand('run.status', runId, observer, context);
          await this._authorize('run.follow', observer, runId, { afterCursor: options.afterCursor });
          const result = deepFreeze({ ...clone(view), follow });
          if (Buffer.byteLength(JSON.stringify(result)) > policy.maxResponseBytes) {
            throw applicationError('Run follow response exceeds deployment policy', 'application_follow_oversize');
          }
          return result;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) continue;
        try {
          await this.driver.coordination.waitAfter(view.cursor, remaining, { signal: controller.signal });
        } catch (error) {
          if (error?.code === 'coordination_wait_aborted') {
            throw applicationError('Run follow was cancelled', 'application_follow_cancelled');
          }
          throw error;
        }
      }
    } finally {
      this._followControllers.delete(controller);
    }
  }

  _semanticActionId(current, view, principal, kind, target = null) {
    return digest({
      schemaVersion: 1,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      repoId: this.repoId,
      runId: current.goal.runId,
      principalScopeDigest: digest({ principalId: principal.principalId, sessionId: principal.sessionId }),
      profileDigest: current.profile.digest,
      planDigest: current.plan?.digest ?? null,
      viewDigest: semanticViewDigest(view),
      kind,
      target,
    });
  }

  _replaySemanticResumeAction(current, request, principal) {
    if (!request.inputs || Object.keys(request.inputs).sort().join(',') !== 'reason'
      || !validText(request.inputs.reason, 1_024)) return null;
    const principalScopeDigest = digest({ principalId: principal.principalId, sessionId: principal.sessionId });
    const reasonDigest = digest(request.inputs.reason);
    const workers = this.driver.coordinator.list().filter((handle) => handle.runId === request.runId);
    for (const handle of workers) {
      const replay = this.driver.log.read(handle.id).findLast?.((event) => event.kind === 'work.resumed'
        && event.payload?.runId === request.runId
        && event.payload?.semanticActionId === request.actionId
        && event.payload?.semanticPrincipalScopeDigest === principalScopeDigest
        && event.payload?.reasonDigest === reasonDigest);
      if (!replay) continue;
      const resumedTask = this.driver.coordination.task(replay.payload.resumedTaskId);
      if (resumedTask?.runId === request.runId && resumedTask.refines === replay.payload.preservedTaskId) {
        return replay.payload;
      }
    }
    return null;
  }

  _contextState(current) {
    const projected = typeof this.driver.coordination.snapshot === 'function'
      ? this.driver.coordination.snapshot().context : null;
    const sessions = (projected?.sessions ?? [])
      .filter((session) => session.repoId === this.repoId && session.runId === current.goal.runId)
      .sort((left, right) => left.admittedEvent - right.admittedEvent);
    const sessionIds = new Set(sessions.map((session) => session.sessionId));
    const cells = (projected?.cells ?? [])
      .filter((cell) => sessionIds.has(cell.sessionId))
      .sort((left, right) => left.admittedEvent - right.admittedEvent);
    const calls = (projected?.calls ?? [])
      .filter((call) => (
        (call.kind === 'baton.context_map_call' && call.source?.runId === current.goal.runId)
          || (call.kind === 'baton.context_effect_call'
            && call.authority?.contextPrincipal?.runId === current.goal.runId)
      ))
      .sort((left, right) => left.admittedEvent - right.admittedEvent);
    const currentSessions = sessions.filter((session) => (
      session.manifest?.workflow?.plan?.digest === current.plan?.digest
      && session.state === 'active'
    ));
    const currentSessionIds = new Set(currentSessions.map((session) => session.sessionId));
    const currentCells = cells.filter((cell) => currentSessionIds.has(cell.sessionId));
    const currentCalls = calls.filter((call) => (
      call.expectedPlanDigest === current.plan?.digest
        || (call.kind === 'baton.context_effect_call'
          ? call.authority.predecessorPlan.digest : call.source.predecessorPlan.digest)
          === current.plan?.digest
    ));
    const lastCell = currentCells.at(-1) ?? cells.at(-1) ?? null;
    const lastCall = currentCalls.at(-1) ?? calls.at(-1) ?? null;
    const branchCount = sessions.reduce(
      (sum, session) => sum + (session.manifest?.branches?.length ?? 0), 0,
    );
    const coverageRows = (currentSessions.length > 0 ? currentSessions : sessions)
      .flatMap((session) => session.sourceAttestations ?? [])
      .map((attestation) => attestation.coverage).filter(Boolean);
    const coverageCounts = coverageRows.reduce((counts, coverage) => ({
      includedFiles: counts.includedFiles + coverage.includedFiles,
      includedItems: counts.includedItems + coverage.includedItems,
      excludedEntries: counts.excludedEntries
        + coverage.excludedSensitivePaths + coverage.excludedUnsupportedTypes
        + coverage.excludedBinaryOrInvalidText + coverage.excludedOversizeFiles
        + coverage.excludedSensitiveContent,
    }), { includedFiles: 0, includedItems: 0, excludedEntries: 0 });
    const state = currentCalls.some((call) => call.state === 'failed')
      ? 'failed'
      : currentCalls.some((call) => call.state === 'awaiting_plan_approval')
      ? 'awaiting_plan_approval'
      : currentCalls.some((call) => ['approved', 'running', 'settlement_ready'].includes(call.state))
        ? 'working'
        : currentSessions.length === 0
      ? (sessions.length === 0 ? 'unavailable' : 'historical')
      : currentCells.some((cell) => cell.state === 'attention') ? 'attention'
        : currentCells.some((cell) => cell.state === 'admitted') ? 'working' : 'ready';
    return deepFreeze({
      sessions, cells, calls, currentSessions, currentCells, currentCalls,
      projection: {
        state,
        sessionCount: sessions.length,
        currentSessionCount: currentSessions.length,
        branchCount,
        cellCount: cells.length,
        callCount: calls.length,
        completedCellCount: cells.filter((cell) => cell.state === 'completed').length,
        pendingCellCount: cells.filter((cell) => cell.state === 'admitted').length,
        stoppedCellCount: cells.filter((cell) => cell.state === 'stopped').length,
        providerEffects: calls.reduce((count, call) => (
          count + (call.result?.providerEffects ?? call.executionUnitIds?.length
            ?? call.children?.length ?? 0)
        ), 0),
        sourceCoverage: {
          state: coverageRows.length === 0 ? 'unavailable'
            : coverageCounts.excludedEntries > 0 ? 'filtered' : 'complete',
          ...coverageCounts,
        },
        lastCell: lastCell ? {
          id: lastCell.cellId, ordinal: lastCell.ordinal, state: lastCell.state,
          operation: lastCell.program?.expression?.op ?? null,
        } : null,
        lastCall: lastCall ? {
          id: lastCall.callId, state: lastCall.state,
          operation: lastCall.operator ?? 'map',
          unitCount: lastCall.units?.length ?? lastCall.partitions?.length ?? 0,
          generation: lastCall.generation,
          executionUnitCount: lastCall.executionUnitIds?.length
            ?? lastCall.partitions?.length ?? 0,
          inheritedUnitCount: lastCall.inheritedChildren?.length ?? 0,
        } : null,
        summary: currentCalls.length > 0
          ? 'Provider-backed Context is compiled through a separately approved successor Plan.'
          : currentSessions.length > 0
          ? 'Immutable addressed Context is available through pure replayable cells.'
          : sessions.length > 0
            ? 'Historical Context is available; no session matches the current Plan.'
            : 'No Context session has been admitted for this Run.',
      },
    });
  }

  _withContextProjection(current, view) {
    return deepFreeze({ ...view, context: clone(this._contextState(current).projection) });
  }

  _contextTargets(current, view) {
    if (!this.context || !this._isWorkflowRun(current)
      || ['stopped', 'closed'].includes(view.phase)) return [];
    const dispatches = current.dispatches ?? (current.dispatch ? [current.dispatch] : []);
    return dispatches.map((dispatch) => {
      const task = this.driver.coordination.task(dispatch.taskId);
      const nodeKey = dispatch.binding?.nodeKey ?? dispatch.nodeKey ?? null;
      const attempt = (view.attempts ?? []).find((candidate) => candidate.nodeKey === nodeKey);
      return task?.status === 'working' ? {
        role: attempt?.role ?? nodeKey ?? 'context', nodeKey,
      } : null;
    }).filter(Boolean);
  }

  _contextSectionItems(current) {
    const context = this._contextState(current);
    const sessionItems = context.sessions.map((session) => ({
      id: session.sessionId,
      section: 'context',
      state: session.state,
      summary: session.manifest.workflow.plan.digest === current.plan?.digest
        ? 'Current immutable Context session.' : 'Historical immutable Context session.',
      value: {
        kind: 'session',
        treeSha: session.manifest.tree.sha,
        branchCount: session.manifest.branches.length,
        cellCount: context.cells.filter((cell) => cell.sessionId === session.sessionId).length,
        providerEffects: 0,
        sourceCoverage: (session.sourceAttestations ?? []).map((attestation) => ({
          branch: attestation.branch, ...clone(attestation.coverage),
        })),
      },
    }));
    const cellItems = context.cells.map((cell) => ({
      id: cell.cellId,
      section: 'context',
      state: cell.state,
      summary: `Pure Context ${cell.program?.expression?.op ?? 'cell'} is ${cell.state}.`,
      value: {
        kind: 'cell', ordinal: cell.ordinal, operation: cell.program?.expression?.op ?? null,
        providerEffects: cell.result?.providerEffects ?? 0,
        artifactState: cell.state === 'completed' ? 'reference_only' : 'none',
        ...(cell.result?.termination ? { termination: clone(cell.result.termination) } : {}),
      },
    }));
    const callItems = context.calls.map((call) => ({
      id: call.callId,
      section: 'context',
      state: call.state,
      summary: `Context ${call.operator ?? 'map'} over ${call.units?.length ?? call.partitions?.length ?? 0} immutable units is ${call.state}.`,
      value: {
        kind: 'call', operation: call.operator ?? 'map',
        inputId: call.kind === 'baton.context_effect_call' ? call.source.id : call.source.cellId,
        logicalRole: call.role,
        unitCount: call.units?.length ?? call.partitions?.length ?? 0,
        childCount: call.children?.length ?? 0,
        generation: call.generation,
        executionUnitCount: call.executionUnitIds?.length ?? call.partitions?.length ?? 0,
        inheritedUnitCount: call.inheritedChildren?.length ?? 0,
        providerEffects: call.result?.providerEffects ?? call.executionUnitIds?.length
          ?? call.children?.length ?? 0,
        ...(call.predecessorCall ? {
          predecessorCallId: call.predecessorCall.callId,
          retryDigest: call.predecessorCall.retryDigest,
        } : {}),
        ...(call.result?.termination ? { termination: clone(call.result.termination) } : {}),
        retry: clone(this.driver.coordination.contextRetryEligibility(call.callId)),
        plan: clone(call.plan), approval: clone(call.approval),
      },
    }));
    return [...sessionItems, ...cellItems, ...callItems];
  }

  _contextItemDetail(selected) {
    if (selected.value?.kind === 'call' && selected.state === 'completed') {
      const artifacts = this.driver.coordination.contextCallArtifacts(selected.id);
      return {
        ...selected,
        value: {
          ...clone(selected.value), artifactState: 'verified', output: clone(artifacts.output),
        },
      };
    }
    if (selected.value?.kind !== 'cell' || selected.state !== 'completed') return selected;
    const artifacts = this.driver.coordination.contextCellArtifacts(selected.id);
    return {
      ...selected,
      value: {
        ...clone(selected.value), artifactState: 'verified', output: clone(artifacts.output),
      },
    };
  }

  _contextItemContent(selected, offset, bounds) {
    if (selected.value?.kind !== 'call' || selected.state !== 'completed') {
      throw applicationError('Context content requires a completed effect call',
        'application_context_content_unavailable');
    }
    if (typeof this.driver.coordination.contextCallContents !== 'function') {
      throw applicationError('Context content projection is unavailable',
        'application_context_content_unavailable');
    }
    const projected = this.driver.coordination.contextCallContents(selected.id);
    const results = projected.results.map(({ source, ...result }) => ({
      ...clone(result), sourceItems: source.length,
    }));
    const chunks = projected.results.flatMap((result) => result.source.map((source, sourceIndex) => ({
      resultIndex: result.index, sourceIndex, unitId: result.unitId,
      capsuleId: result.capsuleId, ...clone(source),
    })));
    if (offset > chunks.length) {
      throw applicationError('Context content offset is beyond the verified result',
        'application_context_content_invalid');
    }
    const fixed = {
      schemaVersion: 1, kind: 'baton.context_call_content', callId: selected.id,
      resultCount: projected.resultCount, results, totalItems: chunks.length, offset,
    };
    const fixedBytes = Buffer.byteLength(JSON.stringify(fixed));
    const contentBudget = Math.max(1, bounds.maxBytes - fixedBytes - 16 * 1024);
    const items = [];
    let itemBytes = 0;
    for (let index = offset; index < chunks.length && items.length < bounds.maxItems; index += 1) {
      const candidateBytes = Buffer.byteLength(JSON.stringify(chunks[index]));
      if (items.length > 0 && itemBytes + candidateBytes > contentBudget) break;
      if (candidateBytes > contentBudget) {
        throw applicationError('One Context content item exceeds deployment policy',
          'application_inspect_oversize');
      }
      items.push(chunks[index]);
      itemBytes += candidateBytes;
    }
    const nextOffset = offset + items.length < chunks.length ? offset + items.length : null;
    return {
      ...fixed, items, nextOffset, truncated: nextOffset !== null,
    };
  }

  _contextItemEvidence(current, selected) {
    const state = this._contextState(current);
    const session = state.sessions.find((candidate) => candidate.sessionId === selected.id);
    if (session) return [{
      kind: 'context_manifest', digest: session.manifest.digest,
      provenance: 'durable Context session admission', value: clone(session.manifest),
    }];
    const call = state.calls.find((candidate) => candidate.callId === selected.id);
    if (call) {
      const settlementEvidence = ['completed', 'failed'].includes(call.state)
        ? this.driver.coordination.contextCallArtifacts(call.callId).evidence : null;
      const failureEvidence = call.state === 'failed' ? settlementEvidence : null;
      return [
      {
        kind: 'context_call_admission', digest: call.admissionDigest,
        provenance: 'durable Context call and successor Plan prebinding',
        value: {
          call: call.kind === 'baton.context_effect_call' ? clone({
            callId: call.callId, callDigest: call.callDigest,
            requestId: call.requestId, requestDigest: call.requestDigest,
            generation: call.generation, operator: call.operator,
            predecessorCall: call.predecessorCall,
            executionUnitIds: call.executionUnitIds,
            inheritedChildren: call.inheritedChildren,
            source: call.source, role: call.role, units: call.units,
          }) : clone({
            callId: call.callId, callDigest: call.callDigest,
            programDigest: call.programDigest, generation: call.generation,
            source: call.source, role: call.role, partitions: call.partitions,
          }),
          expectedPlanDigest: call.expectedPlanDigest,
        },
      },
      ...(call.plan ? [{
        kind: 'context_successor_plan', digest: call.plan.digest,
        provenance: 'ordinary append-only Goal/Plan authority', value: clone(call.plan),
      }] : []),
      ...(['completed', 'failed'].includes(call.state) && call.result?.cleanup ? [{
        kind: 'context_call_cleanup', digest: call.result.cleanup.cleanupDigest,
        provenance: 'restart-aware descendant stop and zero-ownership receipt',
        value: clone(call.result.cleanup),
      }] : []),
      ...(failureEvidence ? [{
        kind: 'context_call_failure', digest: call.result.evidenceRef.digest,
        provenance: 'terminal failed or cancelled child Attempts', value: failureEvidence,
      }] : []),
      ...(settlementEvidence ? [{
        kind: 'context_call_evidence', digest: call.result.evidenceRef.digest,
        provenance: 'terminal child attachment and aggregate Context settlement',
        value: clone(settlementEvidence),
      }] : []),
      ];
    }
    const cell = state.cells.find((candidate) => candidate.cellId === selected.id);
    if (!cell) throw applicationError('Context item is unavailable', 'application_inspect_item_invalid');
    const evidence = cell.state === 'completed'
      ? this.driver.coordination.contextCellArtifacts(cell.cellId).evidence : null;
    return [
      {
        kind: 'context_program', digest: cell.programDigest,
        provenance: 'durable Context cell admission', value: clone(cell.program),
      },
      ...(evidence ? [{
        kind: 'context_evidence', digest: cell.result.evidenceRef.digest,
        provenance: 'source-grounded immutable Context evidence', value: clone(evidence),
      }] : []),
    ];
  }

  _validateContextMapPlan(current) {
    const bindings = current.plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
    if (bindings.length === 0) return null;
    if (bindings.length !== current.plan.nodes.length
      || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
      throw applicationError('Context map Plan bindings are incomplete or ambiguous',
        'application_context_map_integrity');
    }
    const call = this.driver.coordination.contextCall?.(bindings[0].callId);
    if (!call || call.expectedPlanDigest !== current.plan.digest
      || call.source.runId !== current.goal.runId
      || call.source.predecessorPlan.digest !== current.plan.predecessor?.digest
      || call.partitions.length !== bindings.length
      || bindings.some((binding) => (
        binding.callDigest !== call.callDigest
        || !call.partitions.some((partition) => (
          partition.partitionId === binding.partition.partitionId
        ))
      ))) {
      throw applicationError('Context map Plan differs from its durable call admission',
        'application_context_map_integrity');
    }
    return deepFreeze(call);
  }

  _validateContextEffectPlan(current) {
    const bindings = current.plan?.nodes?.map((node) => node.contextCall).filter(Boolean) ?? [];
    if (bindings.length === 0) return null;
    if (bindings.length !== current.plan.nodes.length
      || new Set(bindings.map((binding) => binding.callId)).size !== 1) {
      throw applicationError('Context effect Plan bindings are incomplete or ambiguous',
        'application_context_call_integrity');
    }
    if (bindings[0].kind === 'context_map_child') return this._validateContextMapPlan(current);
    const call = this.driver.coordination.contextCall?.(bindings[0].callId);
    const predecessor = call?.authority?.predecessorPlan;
    const unitIds = new Set(call?.executionUnitIds ?? []);
    const bindingUnitIds = new Set(bindings.map((binding) => binding.unit?.unitId));
    const callCore = call ? {
      schemaVersion: call.schemaVersion, kind: call.kind, operator: call.operator,
      requestId: call.requestId, requestDigest: call.requestDigest,
      generation: call.generation, predecessorCall: clone(call.predecessorCall),
      executionUnitIds: clone(call.executionUnitIds),
      inheritedChildren: clone(call.inheritedChildren), authority: clone(call.authority),
      source: clone(call.source), role: call.role, instruction: call.instruction,
      units: clone(call.units), callId: call.callId, callDigest: call.callDigest,
    } : null;
    if (!call || call.kind !== 'baton.context_effect_call'
      || call.expectedPlanDigest !== current.plan.digest
      || call.authority.contextPrincipal.runId !== current.goal.runId
      || predecessor?.digest !== current.plan.predecessor?.digest
      || bindings.length !== call.executionUnitIds.length
      || bindingUnitIds.size !== bindings.length
      || bindings.some((binding) => (
        binding.kind !== 'context_effect_child'
        || binding.callDigest !== call.callDigest
        || binding.requestId !== call.requestId
        || binding.requestDigest !== call.requestDigest
        || binding.operator !== call.operator
        || !unitIds.has(binding.unit?.unitId)
        || digest(binding) !== digest(contextEffectNodeBinding(
          callCore, call.units.find((unit) => unit.unitId === binding.unit?.unitId),
        ))
      ))) {
      throw applicationError('Context effect Plan differs from its durable call admission',
        'application_context_call_integrity');
    }
    return deepFreeze(call);
  }

  _contextCallCore(call) {
    if (call.kind === 'baton.context_effect_call') {
      return {
        schemaVersion: call.schemaVersion, kind: call.kind, operator: call.operator,
        requestId: call.requestId, requestDigest: call.requestDigest,
        generation: call.generation, predecessorCall: clone(call.predecessorCall),
        executionUnitIds: clone(call.executionUnitIds),
        inheritedChildren: clone(call.inheritedChildren), authority: clone(call.authority),
        source: clone(call.source), role: call.role, instruction: call.instruction,
        units: clone(call.units), callId: call.callId, callDigest: call.callDigest,
      };
    }
    return {
      schemaVersion: call.schemaVersion, kind: call.kind, generation: call.generation,
      source: clone(call.source), role: call.role, instruction: call.instruction,
      partitions: clone(call.partitions), programDigest: call.programDigest,
      callId: call.callId, callDigest: call.callDigest,
    };
  }

  _contextProviderResultRequests(call, children, cleanup) {
    const generic = call.kind === 'baton.context_effect_call';
    const plan = call.plan ? this.driver.coordination.planVersion(
      call.plan.planId, call.plan.version,
    ) : null;
    if (!plan || plan.digest !== call.expectedPlanDigest) {
      throw applicationError('Context result projection lost its exact successor Plan',
        'application_context_map_integrity');
    }
    return children.filter((child) => (
      child.origin === 'inherited' || child.state === 'accepted'
    )).map((child) => {
      if (generic && child.origin === 'inherited') {
        const predecessor = this.driver.coordination.contextCall(call.predecessorCall.callId);
        const origin = predecessor?.result?.children?.find((candidate) => (
          candidate.unitId === child.unitId
            && candidate.childDigest === child.originChildDigest
        ));
        const providerResult = predecessor?.result?.providerResults?.find((candidate) => (
          candidate.unitId === child.unitId
        ));
        if (!origin || !providerResult || child.originCallId !== predecessor.callId
          || digest(providerResult) !== child.resultRefDigest) {
          throw applicationError('Context inherited result projection authority changed',
            'application_context_call_integrity');
        }
        return { providerResult: clone(providerResult) };
      }
      const node = plan.nodes.find((candidate) => (
        candidate.key === child.nodeKey
          && candidate.contextCall?.callId === call.callId
          && (generic
            ? candidate.contextCall?.unit?.unitId === child.unitId
            : candidate.contextCall?.partition?.partitionId === child.partitionId)
      ));
      const commits = child.artifacts.filter((artifact) => artifact.kind === 'commit');
      const commit = commits.length === 1 ? commits[0] : null;
      if (!node || digest(node) !== child.nodeDigest || !commit
        || commit.refs?.sha !== child.resultSha
        || commit.refs?.retainedResultRef !== `refs/baton/results/${child.resultSha}`
        || child.cleanupDigest !== cleanup.cleanupDigest
        || child.resourceRelease?.releaseDigest !== cleanup.targets.find((target) => (
          generic ? target.unitId === child.unitId : target.partitionId === child.partitionId
        ))?.releaseDigest) {
        throw applicationError(
          'Context result projection lacks one canonical accepted child authority',
          'application_context_map_integrity',
        );
      }
      return {
        callId: call.callId, unitId: generic ? child.unitId : child.partitionId,
        taskId: child.taskId, taskVersion: child.taskVersion,
        terminalEvent: child.terminalEvent, childDigest: child.childDigest,
        route: clone(child.route), artifactDigest: child.artifactDigest,
        cleanupDigest: cleanup.cleanupDigest,
        baseSha: generic ? call.authority.treeSha : call.source.treeSha,
        resultSha: child.resultSha,
        retainedResultRef: commit.refs.retainedResultRef,
        pathScope: clone(node.pathScope),
      };
    });
  }

  async _reconcileContextCalls(current) {
    if (!this.context || this._closing) return;
    const calls = (this.driver.coordination.contextCalls?.({ runId: current.goal.runId }) ?? [])
      .filter((call) => ['baton.context_map_call', 'baton.context_effect_call'].includes(call.kind));
    let planChanged = false;
    for (const call of calls) {
      if (call.state === 'plan_pending' && call.plan === null) {
        const predecessor = call.kind === 'baton.context_effect_call'
          ? call.authority.predecessorPlan : call.source.predecessorPlan;
        if (current.plan?.digest !== predecessor.digest) {
          throw applicationError('Context call pending Plan lost its predecessor head',
            'application_context_call_recovery_conflict');
        }
        const proposed = await this.driver.coordinator.proposePlan({
          goal: call.planRequest.goal,
          predecessor: call.planRequest.predecessor,
          nodes: call.planRequest.nodes,
        },
          authority(this.principals.planner, this.repoId, current.goal.runId, 'plan:propose',
            `application:${current.goal.runId}:context-call:${call.callDigest}`));
        if (proposed.plan.digest !== call.expectedPlanDigest) {
          throw applicationError('Context call recovered Plan differs from its durable admission',
            'application_context_call_integrity');
        }
        planChanged = true;
        continue;
      }
      if (call.state !== 'settlement_ready') continue;
      const generic = call.kind === 'baton.context_effect_call';
      const children = this.driver.coordination.contextCallSettlementChildren(call.callId);
      const cleanupChildren = generic
        ? children.filter((child) => child.origin !== 'inherited') : children;
      const targetWorkerIds = cleanupChildren.map((child) => child.workerId).sort();
      if (targetWorkerIds.some((workerId) => typeof workerId !== 'string')
        || new Set(targetWorkerIds).size !== targetWorkerIds.length) {
        throw applicationError('Context call child cleanup lacks an exact descendant union',
          generic ? 'application_context_call_cleanup_incomplete'
            : 'application_context_map_cleanup_incomplete');
      }
      const releases = await Promise.all(cleanupChildren.map((child) => (
        this.driver.coordinator.releaseTerminalTaskResources(
          child.taskId, child.workerId, generic
            ? 'application:context-effect-settlement'
            : 'application:context-map-settlement',
        )
      )));
      const targets = cleanupChildren.map((child, index) => ({
        ...(generic ? { unitId: child.unitId } : { partitionId: child.partitionId }),
        taskId: child.taskId, workerId: child.workerId,
        releaseEvent: releases[index].releaseEvent,
        releaseDigest: releases[index].releaseDigest,
        evidence: clone(releases[index].evidence),
      }));
      const cleanupCore = {
        schemaVersion: generic ? 2 : 1,
        callId: call.callId, admissionDigest: call.admissionDigest,
        targets, targetDigest: digest(targets), targetCount: targets.length,
        remainingCount: 0,
      };
      const cleanup = deepFreeze({ ...cleanupCore, cleanupDigest: digest(cleanupCore) });
      const settledChildren = this.driver.coordination.contextCallSettlementChildren(
        call.callId, cleanup,
      );
      const providerResultRequests = this._contextProviderResultRequests(
        call, settledChildren, cleanup,
      );
      const failed = settledChildren.some((child) => (
        child.origin !== 'inherited' && child.state !== 'accepted'
      ));
      const termination = failed ? {
        code: 'context_child_failed', retryable: true,
        summary: `One or more Context ${generic ? call.operator : 'map'} children failed before acceptance.`,
      } : null;
      const materialized = failed
        ? this.context.materializeCallResult({
          call: this._contextCallCore(call), children: settledChildren,
          cleanup, providerResultRequests, termination,
        })
        : this.context.materializeCallResult({
          call: this._contextCallCore(call), children: settledChildren,
          cleanup, planDigest: call.expectedPlanDigest, providerResultRequests,
        });
      const principal = this.context.principal;
      this.driver.coordination[generic
        ? 'settleContextEffectCall' : 'settleContextMapCall']({
        callId: call.callId, expectedVersion: call.version,
        cleanup,
        result: {
          outputRef: materialized.outputRef, evidenceRef: materialized.evidenceRef,
          providerResults: materialized.providerResults,
          providerResultDigest: materialized.providerResultDigest,
          ...(termination ? { termination } : {}),
        },
      }, {
        actor: principal.actor, principalId: principal.principalId,
        repoId: this.repoId, runId: current.goal.runId,
        sessionDigest: digest(principal),
        key: `context.call.settle:${call.callId}:${call.admissionDigest}`,
      });
    }
    return planChanged;
  }

  async _proposeContextMap(current, inputs, caller) {
    if (!this._isWorkflowRun(current) || !current.profile) {
      throw applicationError('Context map requires a current recursively composable Workflow',
        'application_context_map_unavailable');
    }
    const sourceCell = this.driver.coordination.contextCell(inputs.cellId);
    const sourceSession = sourceCell
      ? this.driver.coordination.contextSession(sourceCell.sessionId) : null;
    if (!sourceCell || sourceCell.state !== 'completed' || !sourceCell.result || !sourceSession
      || sourceSession.runId !== current.goal.runId || sourceSession.state !== 'active'
      || sourceSession.manifest.workflow.plan.digest !== current.plan.digest) {
      throw applicationError('Context map input is not a completed current-session cell',
        'application_context_map_source_invalid');
    }
    let artifacts;
    try { artifacts = this.driver.coordination.contextCellArtifacts(sourceCell.cellId); }
    catch (error) {
      throw applicationError(error?.message ?? 'Context map input artifacts are unavailable',
        error?.code ?? 'application_context_map_source_invalid');
    }
    const items = artifacts.output?.items;
    const outputLineages = artifacts.evidence?.outputLineages;
    if (artifacts.evidence?.schemaVersion !== 2
      || !Array.isArray(outputLineages) || outputLineages.length !== items?.length
      || !/^[a-f0-9]{64}$/u.test(artifacts.evidence.outputLineageDigest ?? '')
      || outputLineages.some((lineage, index) => (
        lineage?.index !== index || lineage.itemDigest !== digest(items[index])
        || !/^[a-f0-9]{64}$/u.test(lineage.coordinateDigest ?? '')
        || !/^[a-f0-9]{64}$/u.test(lineage.lineageDigest ?? '')
      ))) {
      throw applicationError(
        'Context map requires exact per-output lineage; evaluate the source under the current Context runtime.',
        'context_output_lineage_required',
      );
    }
    const goalPlanPolicy = this.driver.coordination.goalPlanPolicy();
    if (!Array.isArray(items) || items.length < 2) {
      throw applicationError('Context map is parallel and needs at least two immutable items; inspect this cell or use one ordinary Run/review for singleton input',
        'context_map_not_parallel');
    }
    if (items.length > goalPlanPolicy.limits.maxNodes) {
      throw applicationError('Context map partitions exceed the successor Plan authority',
        'application_context_map_capacity');
    }
    const definition = this._workflowDefinition(current);
    const roleCatalog = this._workflowRoleCatalog(current, definition);
    const roleAttempt = definition.attempts.find((attempt) => attempt.role === inputs.role);
    const catalogRole = roleCatalog.roles.find((role) => role.role === inputs.role) ?? null;
    const catalogRoleAuthorized = definition.schemaVersion === 3 ? catalogRole : null;
    const logicalRole = catalogRoleAuthorized?.role
      ?? (roleAttempt ? workflowAttemptLogicalRole(definition, roleAttempt) : null);
    const sourceNode = roleAttempt
      ? current.plan.nodes.find((node) => node.key === roleAttempt.nodeKey) : null;
    if ((!catalogRoleAuthorized && (!roleAttempt || !sourceNode)) || !catalogRole || !logicalRole) {
      throw applicationError('Context map role is outside the approved Workflow definition',
        'application_context_map_role_invalid');
    }
    const history = this._workflowPlanHistory(current);
    const workflowPolicy = workflowDefinitionPolicy(definition);
    const nodeBudget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), items.length,
      workflowPolicy.maxRounds,
    );
    if (!nodeBudget) {
      throw applicationError('Context map has no remaining cumulative Workflow budget authority',
        'application_context_map_capacity');
    }
    const contextPrincipal = this.context.principal;
    const contextAuthority = {
      actor: contextPrincipal.actor, principalId: contextPrincipal.principalId,
      repoId: this.repoId, runId: current.goal.runId,
    };
    const call = contextEffectCallIdentity({
      schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'map',
      generation: 1, predecessorCall: null, inheritedChildren: [],
      authority: {
        contextPrincipal: clone(contextAuthority),
        requester: { principalId: caller.principalId, sessionId: caller.sessionId },
        sessionId: sourceSession.sessionId, manifestDigest: sourceSession.manifestDigest,
        treeSha: sourceSession.manifest.tree.sha,
        environmentDigest: sourceSession.environmentDigest,
        policyDigest: sourceSession.policyDigest,
        definitionDigest: definition.definitionDigest,
        roleCatalogDigest: roleCatalog.catalogDigest,
        profileDigest: current.profile.digest,
        predecessorPlan: {
          planId: current.plan.planId, version: current.plan.version,
          digest: current.plan.digest,
        },
      },
      source: {
        kind: 'cell', id: sourceCell.cellId,
        admissionDigest: sourceCell.admissionDigest,
        settlementDigest: sourceCell.settlementDigest,
        coordinateDigest: sourceCell.result.coordinateDigest,
        outputLineageDigest: artifacts.evidence.outputLineageDigest,
        outputRef: clone(sourceCell.result.outputRef),
        evidenceRef: clone(sourceCell.result.evidenceRef),
        itemCount: items.length,
      },
      role: inputs.role, instruction: inputs.instruction,
      units: outputLineages.map((lineage) => ({
        index: lineage.index,
        inputs: [{
          index: lineage.index, itemDigest: lineage.itemDigest,
          lineageDigest: lineage.lineageDigest,
        }],
        coordinateDigest: lineage.coordinateDigest,
      })),
    });
    const nodes = call.units.map((unit, index) => {
      const memberRole = `${call.role}:${String(index + 1).padStart(4, '0')}`;
      const template = catalogRole.nodeTemplate;
      return {
        ...(template ? {
          definitionOfDone: clone(template.definitionOfDone),
          pathScope: clone(template.pathScope),
          contextScope: clone(template.contextScope),
          risk: template.risk,
          verification: clone(template.verification),
          capabilities: clone(template.capabilities),
          effects: clone(template.effects),
          requiredEffects: clone(template.requiredEffects),
          ...(template.workerPolicy ? { workerPolicy: clone(template.workerPolicy) } : {}),
        } : clone(sourceNode)),
        routes: exactPlanRoutes(catalogRole.route),
        key: `attempt:${memberRole}`,
        objective: `${call.role} Context map unit ${index + 1}/${call.units.length}: ${call.instruction}\nImmutable unit: ${unit.unitId}`,
        deps: [],
        budget: clone(nodeBudget),
        contextCall: contextEffectNodeBinding(call, unit),
      };
    });
    const planRequest = {
      goal: {
        goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest,
      },
      predecessor: {
        planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
      },
      nodes,
    };
    const normalizedPlan = normalizePlanRequest(planRequest, goalPlanPolicy, current.goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    const successorDefinitionCore = {
      schemaVersion: 3, repoId: this.repoId, runId: current.goal.runId,
      goalDigest: current.goal.digest, planDigest: expectedPlanDigest,
      profileDigest: current.profile.digest,
      workflowPolicy: clone(workflowPolicy), workflowPolicyDigest: workflowPolicy.policyDigest,
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      workItem: {
        objective: current.goal.objective,
        definitionOfDone: clone(current.goal.definitionOfDone),
      },
      roleCatalog: clone(roleCatalog),
      lineage: {
        generation: definition.schemaVersion === 3 ? definition.lineage.generation + 1 : 2,
        rootDefinitionDigest: definition.schemaVersion === 3 && definition.lineage.generation > 1
          ? definition.lineage.rootDefinitionDigest : definition.definitionDigest,
        parentDefinitionDigest: definition.definitionDigest,
      },
      attempts: call.units.map((unit, index) => workflowAttempt(
        `${call.role}:${String(index + 1).padStart(4, '0')}`,
        logicalRole, nodes[index].key, roleCatalog,
      )),
    };
    validateWorkflowDefinitionV3(successorDefinitionCore, {
      nodes: normalizedPlan.nodes,
      ancestors: this._workflowDefinitionAncestors(current.goal.runId),
    });
    this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorDefinitionCore, definitionDigest: digest(successorDefinitionCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const admitted = this.driver.coordination.admitContextEffectCall({
      call, planRequest, expectedPlanDigest,
    }, {
      actor: contextPrincipal.actor, principalId: contextPrincipal.principalId,
      repoId: this.repoId, runId: current.goal.runId,
      requesterPrincipalId: caller.principalId, requesterSessionId: caller.sessionId,
      key: `context.call:${call.callId}`,
    });
    const proposed = await this.driver.coordinator.proposePlan(planRequest,
      authority(this.principals.planner, this.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:context-map:${call.callDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest
      || admitted.call.expectedPlanDigest !== expectedPlanDigest) {
      throw applicationError('Context map successor Plan differs from its durable prebinding',
        'application_context_map_integrity');
    }
    const refreshed = this._findRun(current.goal.runId);
    this._workflowDefinition(refreshed);
    return this._validateContextEffectPlan(refreshed);
  }

  async _proposeContextReduce(current, inputs, caller) {
    if (!this._isWorkflowRun(current) || !current.profile) {
      throw applicationError('Context reduce requires a current recursively composable Workflow',
        'application_context_reduce_unavailable');
    }
    const sourceCall = this.driver.coordination.contextCall(inputs.callId);
    if (!sourceCall || sourceCall.state !== 'completed') {
      throw applicationError('Context reduce input is not a completed call',
        'application_context_reduce_source_invalid');
    }
    const genericMap = sourceCall.kind === 'baton.context_effect_call'
      && sourceCall.operator === 'map';
    if (sourceCall.kind !== 'baton.context_map_call' && !genericMap) {
      throw applicationError(
        'Context composition after one reduce is closed; retry remains the next recursive edge.',
        'application_context_reduce_depth_closed',
      );
    }
    let source; let artifacts;
    try {
      ({ source, artifacts }
        = this.driver.coordination.contextCompletedCallSourceAndArtifacts(sourceCall.callId));
    } catch (error) {
      throw applicationError(error?.message ?? 'Context reduce source is unavailable',
        error?.code ?? 'application_context_reduce_source_invalid');
    }
    const definition = this._workflowDefinition(current);
    if (definition.schemaVersion !== 3) {
      throw applicationError('Context reduce requires a self-describing Workflow role catalog',
        'application_context_reduce_unavailable');
    }
    const roleCatalog = definition.roleCatalog;
    const catalogRole = workflowCatalogRole(definition, inputs.role);
    if (!catalogRole) {
      throw applicationError('Context reduce role is outside the approved Workflow definition',
        'application_context_reduce_role_invalid');
    }
    const sourceSessionId = sourceCall.kind === 'baton.context_effect_call'
      ? sourceCall.authority.sessionId : sourceCall.source.sessionId;
    const session = this.driver.coordination.contextSession(sourceSessionId);
    const principal = this.context.principal;
    const contextAuthority = {
      actor: principal.actor, principalId: principal.principalId,
      repoId: this.repoId, runId: current.goal.runId,
    };
    if (!session || session.state !== 'active' || session.runId !== current.goal.runId
      || digest(session.authority) !== digest(contextAuthority)) {
      throw applicationError('Context reduce session authority is unavailable or stale',
        'application_context_reduce_source_invalid');
    }
    const lineages = artifacts.evidence?.outputLineages;
    const sourceEvidenceVersion = genericMap ? 4 : 3;
    if (artifacts.evidence?.schemaVersion !== sourceEvidenceVersion || !Array.isArray(lineages)
      || lineages.length !== source.itemCount || artifacts.output?.items?.length !== source.itemCount) {
      throw applicationError('Context reduce requires exact per-output call lineage',
        'context_output_lineage_required');
    }
    const workflowPolicy = workflowDefinitionPolicy(definition);
    const history = this._workflowPlanHistory(current);
    const nodeBudget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), 1, workflowPolicy.maxRounds,
    );
    if (!nodeBudget) {
      throw applicationError('Context reduce has no remaining cumulative Workflow budget authority',
        'application_context_reduce_capacity');
    }
    const call = contextEffectCallIdentity({
      schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'reduce',
      generation: 1, predecessorCall: null, inheritedChildren: [],
      authority: {
        contextPrincipal: clone(contextAuthority),
        requester: { principalId: caller.principalId, sessionId: caller.sessionId },
        sessionId: session.sessionId, manifestDigest: session.manifestDigest,
        treeSha: session.manifest.tree.sha, environmentDigest: session.environmentDigest,
        policyDigest: session.policyDigest, definitionDigest: definition.definitionDigest,
        roleCatalogDigest: roleCatalog.catalogDigest, profileDigest: definition.profileDigest,
        predecessorPlan: {
          planId: current.plan.planId, version: current.plan.version,
          digest: current.plan.digest,
        },
      },
      source, role: inputs.role, instruction: inputs.instruction,
      units: [{
        index: 0,
        inputs: lineages.map((lineage) => ({
          index: lineage.index, itemDigest: lineage.itemDigest,
          lineageDigest: lineage.lineageDigest,
        })),
        coordinateDigest: source.coordinateDigest,
      }],
    });
    const unit = call.units[0];
    const template = catalogRole.nodeTemplate;
    const memberRole = `${call.role}:0001`;
    const node = {
      definitionOfDone: clone(template.definitionOfDone),
      pathScope: clone(template.pathScope), contextScope: clone(template.contextScope),
      risk: template.risk, verification: clone(template.verification),
      routes: exactPlanRoutes(catalogRole.route),
      capabilities: clone(template.capabilities), effects: clone(template.effects),
      requiredEffects: clone(template.requiredEffects),
      ...(template.workerPolicy ? { workerPolicy: clone(template.workerPolicy) } : {}),
      key: `attempt:${memberRole}`,
      objective: `${call.role} Context reduce over ${source.itemCount} exact results: ${call.instruction}`,
      deps: [], budget: clone(nodeBudget), contextCall: contextEffectNodeBinding(call, unit),
    };
    const planRequest = {
      goal: {
        goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest,
      },
      predecessor: {
        planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
      },
      nodes: [node],
    };
    const goalPlanPolicy = this.driver.coordination.goalPlanPolicy();
    const normalizedPlan = normalizePlanRequest(planRequest, goalPlanPolicy, current.goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    const successorDefinitionCore = {
      schemaVersion: 3, repoId: this.repoId, runId: current.goal.runId,
      goalDigest: current.goal.digest, planDigest: expectedPlanDigest,
      profileDigest: current.profile.digest,
      workflowPolicy: clone(workflowPolicy), workflowPolicyDigest: workflowPolicy.policyDigest,
      strategy: definition.strategy, workspace: definition.workspace, join: definition.join,
      workItem: clone(definition.workItem), roleCatalog: clone(roleCatalog),
      lineage: {
        generation: definition.lineage.generation + 1,
        rootDefinitionDigest: definition.lineage.generation > 1
          ? definition.lineage.rootDefinitionDigest : definition.definitionDigest,
        parentDefinitionDigest: definition.definitionDigest,
      },
      attempts: [workflowAttempt(memberRole, call.role, node.key, roleCatalog)],
    };
    validateWorkflowDefinitionV3(successorDefinitionCore, {
      nodes: normalizedPlan.nodes,
      ancestors: this._workflowDefinitionAncestors(current.goal.runId),
    });
    this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorDefinitionCore, definitionDigest: digest(successorDefinitionCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const admitted = this.driver.coordination.admitContextEffectCall({
      call, planRequest, expectedPlanDigest,
    }, {
      actor: principal.actor, principalId: principal.principalId,
      repoId: this.repoId, runId: current.goal.runId,
      requesterPrincipalId: caller.principalId, requesterSessionId: caller.sessionId,
      key: `context.call:${call.callId}`,
    });
    const proposed = await this.driver.coordinator.proposePlan(planRequest,
      authority(this.principals.planner, this.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:context-call:${call.callDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest
      || admitted.call.expectedPlanDigest !== expectedPlanDigest) {
      throw applicationError('Context reduce successor Plan differs from its durable prebinding',
        'application_context_call_integrity');
    }
    const refreshed = this._findRun(current.goal.runId);
    this._workflowDefinition(refreshed);
    return this._validateContextEffectPlan(refreshed);
  }

  async _proposeContextRetry(current, inputs, caller) {
    if (!this._isWorkflowRun(current) || !current.profile) {
      throw applicationError('Context retry requires a current recursively composable Workflow',
        'application_context_retry_unavailable');
    }
    const predecessor = this.driver.coordination.contextCall(inputs.callId);
    const selection = this.driver.coordination.contextRetryEligibility(inputs.callId);
    if (!predecessor || predecessor.kind !== 'baton.context_effect_call'
      || selection.eligible !== true
      || predecessor.expectedPlanDigest !== current.plan.digest) {
      throw applicationError(selection.summary ?? 'Context call is not retryable at this Plan head',
        selection.code ?? 'application_context_retry_source_invalid');
    }
    const definition = this._workflowDefinition(current);
    if (definition.schemaVersion !== 3) {
      throw applicationError('Context retry requires a self-describing Workflow role catalog',
        'application_context_retry_unavailable');
    }
    const catalogRole = workflowCatalogRole(definition, predecessor.role);
    if (!catalogRole) {
      throw applicationError('Context retry role is outside the current Workflow authority',
        'application_context_retry_role_invalid');
    }
    const session = this.driver.coordination.contextSession(predecessor.authority.sessionId);
    const principal = this.context.principal;
    const contextAuthority = {
      actor: principal.actor, principalId: principal.principalId,
      repoId: this.repoId, runId: current.goal.runId,
    };
    if (!session || session.state !== 'active'
      || digest(session.authority) !== digest(contextAuthority)) {
      throw applicationError('Context retry session authority is unavailable or stale',
        'application_context_retry_source_invalid');
    }
    const workflowPolicy = workflowDefinitionPolicy(definition);
    const history = this._workflowPlanHistory(current);
    const nodeBudget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), selection.retryUnitIds.length,
      workflowPolicy.maxRounds,
    );
    if (!nodeBudget) {
      throw applicationError('Context retry has no remaining cumulative Workflow budget authority',
        'application_context_retry_capacity');
    }
    const call = contextEffectRetryCallIdentity(this._contextCallCore(predecessor), {
      settlementDigest: selection.settlementDigest,
      inheritedChildren: selection.inheritedChildren,
      retryUnitIds: selection.retryUnitIds,
      authority: {
        contextPrincipal: clone(contextAuthority),
        requester: {
          principalId: predecessor.authority.requester.principalId,
          sessionId: predecessor.authority.requester.sessionId,
        },
        sessionId: session.sessionId, manifestDigest: session.manifestDigest,
        treeSha: session.manifest.tree.sha, environmentDigest: session.environmentDigest,
        policyDigest: session.policyDigest, definitionDigest: definition.definitionDigest,
        roleCatalogDigest: definition.roleCatalog.catalogDigest,
        profileDigest: definition.profileDigest,
        predecessorPlan: {
          planId: current.plan.planId, version: current.plan.version,
          digest: current.plan.digest,
        },
      },
    });
    const executionUnits = call.executionUnitIds.map((unitId) => (
      call.units.find((unit) => unit.unitId === unitId)
    ));
    const template = catalogRole.nodeTemplate;
    const nodes = executionUnits.map((unit) => {
      const memberRole = `${call.role}:${String(unit.index + 1).padStart(4, '0')}`;
      return {
        definitionOfDone: clone(template.definitionOfDone),
        pathScope: clone(template.pathScope), contextScope: clone(template.contextScope),
        risk: template.risk, verification: clone(template.verification),
        routes: exactPlanRoutes(catalogRole.route),
        capabilities: clone(template.capabilities), effects: clone(template.effects),
        requiredEffects: clone(template.requiredEffects),
        ...(template.workerPolicy ? { workerPolicy: clone(template.workerPolicy) } : {}),
        key: `attempt:${memberRole}`,
        objective: `${call.role} Context ${call.operator} retry generation ${call.generation}, unit ${unit.index + 1}/${call.units.length}: ${call.instruction}\nImmutable retry unit: ${unit.unitId}`,
        deps: [], budget: clone(nodeBudget), contextCall: contextEffectNodeBinding(call, unit),
      };
    });
    const planRequest = {
      goal: {
        goalId: current.goal.goalId, version: current.goal.version, digest: current.goal.digest,
      },
      predecessor: {
        planId: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
      },
      nodes,
    };
    const goalPlanPolicy = this.driver.coordination.goalPlanPolicy();
    const normalizedPlan = normalizePlanRequest(planRequest, goalPlanPolicy, current.goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: this.repoId, runId: current.goal.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    const successorDefinitionCore = {
      schemaVersion: 3, repoId: this.repoId, runId: current.goal.runId,
      goalDigest: current.goal.digest, planDigest: expectedPlanDigest,
      profileDigest: current.profile.digest,
      workflowPolicy: clone(workflowPolicy), workflowPolicyDigest: workflowPolicy.policyDigest,
      strategy: definition.strategy, workspace: definition.workspace, join: definition.join,
      workItem: clone(definition.workItem), roleCatalog: clone(definition.roleCatalog),
      lineage: {
        generation: definition.lineage.generation + 1,
        rootDefinitionDigest: definition.lineage.generation > 1
          ? definition.lineage.rootDefinitionDigest : definition.definitionDigest,
        parentDefinitionDigest: definition.definitionDigest,
      },
      attempts: executionUnits.map((unit) => {
        const memberRole = `${call.role}:${String(unit.index + 1).padStart(4, '0')}`;
        return workflowAttempt(memberRole, call.role, `attempt:${memberRole}`,
          definition.roleCatalog);
      }),
    };
    validateWorkflowDefinitionV3(successorDefinitionCore, {
      nodes: normalizedPlan.nodes,
      ancestors: this._workflowDefinitionAncestors(current.goal.runId),
    });
    this.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorDefinitionCore, definitionDigest: digest(successorDefinitionCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const admitted = this.driver.coordination.admitContextEffectCall({
      call, planRequest, expectedPlanDigest,
    }, {
      actor: principal.actor, principalId: principal.principalId,
      repoId: this.repoId, runId: current.goal.runId,
      requesterPrincipalId: call.authority.requester.principalId,
      requesterSessionId: call.authority.requester.sessionId,
      key: `context.call:${call.callId}`,
    });
    const proposed = await this.driver.coordinator.proposePlan(planRequest,
      authority(this.principals.planner, this.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:context-retry:${call.callDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest
      || admitted.call.expectedPlanDigest !== expectedPlanDigest) {
      throw applicationError('Context retry successor Plan differs from its durable prebinding',
        'application_context_retry_integrity');
    }
    const refreshed = this._findRun(current.goal.runId);
    this._workflowDefinition(refreshed);
    return this._validateContextEffectPlan(refreshed);
  }

  async _performContextAction(current, action, inputs, caller, signal = null) {
    if (!this.context) {
      throw applicationError('Context runtime is unavailable', 'application_context_unavailable');
    }
    if (action.kind === 'context_retry') {
      return this._proposeContextRetry(current, inputs, caller);
    }
    if (['context_map', 'context_reduce'].includes(action.kind)) {
      const definition = this._workflowDefinition(current);
      const roles = definition.schemaVersion === 3
        ? definition.roleCatalog.roles.map((entry) => entry.role)
        : [...new Set(definition.attempts.map((attempt) => attempt.role))];
      const selectedRole = inputs.role ?? (roles.length === 1 ? roles[0] : null);
      if (!selectedRole || !roles.includes(selectedRole)) {
        throw applicationError('Context effect requires one eligible approved Workflow role',
          'application_context_call_role_invalid');
      }
      const resolvedInputs = { ...inputs, role: selectedRole };
      return action.kind === 'context_map'
        ? this._proposeContextMap(current, resolvedInputs, caller)
        : this.driver.coordination.withContextArtifactVerification(
          () => this._proposeContextReduce(current, resolvedInputs, caller),
        );
    }
    const targets = this._contextTargets(
      current, this._withContextProjection(current, await this._buildView(
        current, this.principals.observer,
      )),
    );
    const role = targets.length === 1 ? targets[0].role : inputs.role;
    const target = targets.find((candidate) => candidate.role === role);
    if (!target) {
      throw applicationError('Context role is outside current Workflow authority',
        'application_action_input_invalid');
    }
    let program;
    try {
      const expression = action.kind === 'context_eval' ? inputs.program : {
        schemaVersion: 1, kind: 'baton.context_program', expression:
          action.kind === 'context_search' ? {
            op: 'search', input: { op: 'source', branch: inputs.branch ?? 'repository' },
            query: inputs.query, mode: inputs.mode ?? 'case_insensitive',
          } : action.kind === 'context_chunk' ? {
            op: 'chunk', input: { op: 'source', branch: inputs.branch ?? 'repository' },
            by: inputs.by ?? 'item',
          } : {
            op: 'coverage', input: { op: 'source', branch: inputs.branch ?? 'repository' },
          },
      };
      program = normalizeContextProgram(expression,
        this.driver.coordination.contextProgramPolicy());
      if (!contextProgramIsPure(program, this.driver.coordination.contextProgramPolicy())) {
        throw applicationError('Context evaluation contains a provider effect',
          'application_context_effect_forbidden');
      }
    } catch (error) {
      if (error?.code === 'application_context_effect_forbidden') throw error;
      throw applicationError(error.message, 'application_action_input_invalid');
    }
    const session = await this.context.openSession({
      authority: { current, role, nodeKey: target.nodeKey },
      principal: this.context.principal,
      signal,
    });
    if (!session || typeof session.evaluate !== 'function') {
      throw applicationError('Context runtime returned an invalid session',
        'application_context_unavailable');
    }
    const cell = await session.evaluate(program);
    if (!/^cell:[a-f0-9]{64}$/u.test(cell?.cellId ?? '')) {
      throw applicationError('Context runtime returned an invalid cell',
        'application_context_result_invalid');
    }
    return cell;
  }

  _semanticActions(current, view, principal) {
    const candidates = [];
    if (view.phase === 'awaiting_plan_approval') candidates.push({ kind: 'approve_plan', source: null, target: null });
    for (const candidate of view.nextActions ?? []) {
      if (['adopt_result', 'select_candidate', 'send_feedback', 'revise_candidate', 'stop_member', 'semantic_review', 'integrate', 'export_result', 'retry_verification', 'resume_work'].includes(candidate.kind)
        && !candidates.some((entry) => entry.kind === candidate.kind)) {
        candidates.push({ kind: candidate.kind, source: candidate, target: null });
      }
    }
    for (const attention of view.attention ?? []) {
      if (!['answer_approval', 'answer_question'].includes(attention.kind)
        || !validText(attention.requestId, 4_096)) continue;
      const target = {
        kind: attention.kind,
        workerId: attention.workerId ?? null,
        requestId: attention.requestId,
        ...(attention.kind === 'answer_approval'
          ? { approvalKind: attention.approvalKind ?? null }
          : { question: attention.question ?? null }),
      };
      candidates.push({ kind: attention.kind, source: attention, target });
    }
    if (!this.driver.coordination.runStop?.(current.goal.runId)) {
      const controls = this._semanticControlTargets(current);
      for (const kind of ['send', 'interrupt']) {
        const recipients = kind === 'send'
          ? controls.sendRecipients : controls.interruptRecipients;
        if (recipients.length === 0) continue;
        const authorityTarget = {
          recipients,
          generationDigest: digest(controls.rows.filter((row) => (
            kind === 'send' || (['working', 'blocked'].includes(row.worker.status)
              && row.worker.sessionPreservationCapable === true)
          )).map((row) => ({
            workerId: row.worker.id, taskId: row.task.id, fence: row.worker.fence,
            turnEpoch: row.worker.turnEpoch, turnState: row.worker.status, role: row.role,
            preservationReceiptDigest: row.worker.sessionPreservation?.receiptDigest ?? null,
            binding: row.worker.semanticControlBinding,
          }))),
        };
        candidates.push({
          kind, source: { recipients },
          target: { recipients }, authorityTarget,
        });
      }
    }
    const contextTargets = this._contextTargets(current, view);
    if (contextTargets.length > 0) {
      const roles = contextTargets.map((target) => target.role);
      candidates.push({ kind: 'context_eval', source: { roles }, target: { roles } });
    }
    if (this._contextState(current).currentCells.some((cell) => cell.state === 'completed')) {
      const definition = this._workflowDefinition(current);
      const roles = definition.schemaVersion === 3
        ? definition.roleCatalog.roles.map((entry) => entry.role)
        : definition.attempts.map((attempt) => attempt.role);
      if (roles.length > 0) {
        candidates.push({ kind: 'context_map', source: { roles }, target: { roles } });
      }
    }
    if (this._contextState(current).currentCalls.some((call) => (
      call.state === 'completed' && (
        call.kind === 'baton.context_map_call'
          || (call.kind === 'baton.context_effect_call' && call.operator === 'map')
      )
    ))) {
      const definition = this._workflowDefinition(current);
      const roles = definition.schemaVersion === 3
        ? definition.roleCatalog.roles.map((entry) => entry.role)
        : [];
      if (roles.length > 0) {
        candidates.push({ kind: 'context_reduce', source: { roles }, target: { roles } });
      }
    }
    for (const call of this._contextState(current).currentCalls) {
      if (call.kind !== 'baton.context_effect_call' || call.state !== 'failed') continue;
      const eligibility = this.driver.coordination.contextRetryEligibility(call.callId);
      if (eligibility.eligible === true) {
        candidates.push({
          kind: 'context_retry', source: eligibility, target: { callId: call.callId },
        });
      }
    }
    const stopClosesOpenDispatchAuthority = [
      'planning', 'planning_failed', 'awaiting_plan_approval', 'approved', 'running', 'reviewing',
    ].includes(view.phase);
    if (!['stopped', 'closed'].includes(view.phase)
      && (stopClosesOpenDispatchAuthority || (view.ownership?.workers ?? 0) > 0)) {
      candidates.push({ kind: 'stop', source: null, target: null });
    }
    return candidates.map(({ kind, source, target, authorityTarget = target }) => {
      const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
      const viewDigest = semanticViewDigest(view);
      const inputSchema = clone(definition.inputSchema);
      if (kind === 'integrate' && source?.strategies) {
        inputSchema.properties.strategy.enum = clone(source.strategies);
        inputSchema.properties.strategy.default = source.strategies.includes('ff-only')
          ? 'ff-only' : source.strategies[0];
      }
      if (['select_candidate', 'send_feedback', 'stop_member'].includes(kind)
        && Array.isArray(source?.roles)) {
        inputSchema.properties.role.enum = clone(source.roles);
      }
      if (kind.startsWith('context_') && Array.isArray(source?.roles)) {
        if (source.roles.length === 1) {
          delete inputSchema.properties.role;
          inputSchema.required = inputSchema.required.filter((field) => field !== 'role');
        } else {
          inputSchema.properties.role.enum = clone(source.roles);
          if (!inputSchema.required.includes('role')) inputSchema.required.push('role');
        }
      }
      if (['send', 'interrupt'].includes(kind) && Array.isArray(source?.recipients)) {
        inputSchema.properties.recipient.enum = clone(source.recipients);
        if (source.recipients.includes('work')) {
          inputSchema.properties.recipient.default = 'work';
        } else {
          delete inputSchema.properties.recipient.default;
          if (!inputSchema.required.includes('recipient')) inputSchema.required.push('recipient');
        }
      }
      return deepFreeze({
        actionId: this._semanticActionId(current, view, principal, kind, authorityTarget),
        kind,
        label: definition.label,
        summary: definition.summary,
        inputSchema,
        serverDerived: clone(definition.serverDerived),
        effect: definition.effect,
        requiredCapabilities: clone(definition.requiredCapabilities),
        destructive: definition.destructive,
        irreversible: definition.irreversible,
        idempotent: definition.idempotent,
        priority: definition.priority,
        choices: kind === 'semantic_review' ? clone(source?.routes ?? [])
          : kind === 'integrate' ? clone(source?.strategies ?? [])
            : ['send', 'interrupt'].includes(kind) ? clone(source?.recipients ?? [])
            : (['select_candidate', 'send_feedback', 'stop_member'].includes(kind)
              || kind.startsWith('context_'))
              ? clone(source?.roles ?? []) : [],
        ...(target ? { target: clone(target) } : {}),
        freshness: {
          registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
          viewDigest,
          profileDigest: current.profile.digest,
          planDigest: current.plan?.digest ?? null,
        },
        help: { topic: definition.helpTopic, depth: 'outline' },
      });
    });
  }

  _semanticBounds(current) {
    return deepFreeze({
      maxItems: Math.min(current.profile.followPolicy.maxChanges, MAX_ATTENTION),
      maxBytes: current.profile.followPolicy.maxResponseBytes,
      maxWaitMs: current.profile.followPolicy.maxWaitMs,
    });
  }

  _finalizeSemanticInspection(response, bounds) {
    const finalized = deepFreeze(response);
    if (Buffer.byteLength(JSON.stringify(finalized)) > bounds.maxBytes) {
      throw applicationError('Run inspection response exceeds deployment policy',
        'application_inspect_oversize');
    }
    return finalized;
  }

  _semanticEnvelope(current, view, request, change = {}) {
    const depth = request.depth;
    const terminal = APPLICATION_RUN_TERMINAL_PHASES.has(view.phase);
    const metadata = APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].continuation;
    const continuationArguments = { runId: current.goal.runId, depth };
    for (const argument of metadata.selectorArguments) {
      if (request[argument] !== undefined) continuationArguments[argument] = request[argument];
    }
    if (request.offset !== undefined) continuationArguments.offset = request.offset;
    continuationArguments[metadata.cursorArgument] = view.cursor;
    const changeAware = current.profile.followPolicy.mode === 'enabled';
    return {
      schemaVersion: 1,
      runId: current.goal.runId,
      depth,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      viewDigest: semanticViewDigest(view),
      cursor: view.cursor,
      changed: change.changed ?? false,
      timedOut: change.timedOut ?? false,
      terminal,
      truncated: false,
      help: [{ topic: depth === 'outline' ? 'run.inspect' : `run.inspect.${depth}`, depth: 'outline' }],
      ...(terminal || !changeAware
        ? {} : { continuation: { operation: metadata.operation, arguments: continuationArguments } }),
    };
  }

  // AX2d: a singleton section summary address binds to the authoritative Goal/Plan version,
  // never to the coordination cursor. It stays stable across a coordination-only cursor advance
  // (transport noise, audit churn) and becomes stale — failing closed — after an authoritative
  // Goal/Plan version change. The cursor remains response state, not item identity.
  _singletonSummaryItemId(sectionId, current) {
    const goalVersion = current?.goal?.version ?? 0;
    const planVersion = current?.plan?.version ?? 0;
    return `section-summary:${sectionId}:g${goalVersion}:p${planVersion}`;
  }

  // VR9/RV: the durable referee verdict is already a closed receipt. This projection validates its
  // enums, bounds, byte count, and digest without ever reading command output or free-form text.
  _closedVerdictProjection(result, planNode, phase, workerId) {
    const verdict = result?.verdict ?? null;
    if (!verdict) return null;
    let verifierAttempts = 0;
    if (workerId && result?.checkpoint?.sha && typeof this.driver?.log?.read === 'function') {
      verifierAttempts = this.driver.log.read(workerId).filter((event) => event.kind === 'verify.reverified'
        && event.payload?.capture?.checkpoint?.sha === result.checkpoint.sha).length;
    }
    const projectExecution = (exec) => (exec && typeof exec === 'object' ? {
      state: closedEnum(exec.state, VERIFIER_EXECUTION_STATES),
      code: closedEnum(exec.code, VERIFIER_EXECUTION_CODES),
    } : null);
    const observedExit = Number.isSafeInteger(verdict.observedExit) ? verdict.observedExit : null;
    const expectedExit = Number.isSafeInteger(planNode?.verification?.expectExit)
      ? planNode.verification.expectExit : null;
    const durationMs = Number.isFinite(verdict.durationMs) && verdict.durationMs >= 0
      && verdict.durationMs <= VERIFIER_DURATION_BOUND_MS ? Math.trunc(verdict.durationMs) : null;
    const capturedOutputBytes = Number.isSafeInteger(verdict.capturedOutputBytes)
      && verdict.capturedOutputBytes >= 0 ? verdict.capturedOutputBytes : null;
    return deepFreeze({
      accepted: ['work_completed', 'reviewing', 'completed'].includes(phase),
      digest: sanitizeHex64(digest(verdict)),
      outcome: closedEnum(verdict.outcome, VERIFIER_OUTCOMES),
      failureOwnership: verdict.failureOwnership == null
        ? null : closedEnum(verdict.failureOwnership, VERIFIER_OWNERSHIPS),
      expectedExit,
      observedExit,
      execution: projectExecution(verdict.execution),
      baseExecution: projectExecution(verdict.baseExecution),
      outputExceeded: verdict.outputExceeded === true,
      capturedOutputBytes,
      capturedOutputDigest: sanitizeHex64(verdict.capturedOutputDigest),
      diagnosticCode: closedEnum(verdict.diagnosticCode, VERIFIER_DIAGNOSTIC_CODES),
      durationMs,
      runtimeDigest: sanitizeHex64(verdict.runtimeDigest),
      attemptOrdinal: Math.max(1, verifierAttempts),
    });
  }

  _semanticSectionItems(current, view, sectionId) {
    if (sectionId === 'context') return this._contextSectionItems(current);
    if (sectionId === 'plan') {
      const projected = new Map((view.nodes ?? []).map((node) => [node.key, node]));
      return (current.plan?.nodes ?? []).map((node) => ({
        id: `plan-node:${node.key}:v${current.plan.version}`,
        section: 'plan',
        state: projected.get(node.key)?.state ?? (view.phase === 'awaiting_plan_approval' ? 'proposed' : 'pending'),
        summary: node.objective,
        value: {
          objective: node.objective,
          definitionOfDone: node.definitionOfDone,
          risk: node.risk,
          route: node.routes ? planSingleExactRoute(node.routes) : null,
          routeAuthority: node.routes ? projectPlanRouteAuthority(node.routes) : null,
          ...(view.attempts?.find((attempt) => attempt.nodeKey === node.key)?.role
            ? { role: view.attempts.find((attempt) => attempt.nodeKey === node.key).role } : {}),
        },
      }));
    }
    if (sectionId === 'attention') {
      return (view.attention ?? []).map((entry, index) => ({
        id: `attention:${entry.requestId ?? `slot${index + 1}`}`, section: 'attention', state: entry.state,
        summary: entry.question || entry.approvalKind || entry.kind || 'Run attention is required.',
        value: clone(entry),
      }));
    }
    if (sectionId === 'candidates') {
      return (view.candidates ?? []).map((candidate) => ({
        id: candidate.candidateId, section: 'candidates', state: 'verified',
        summary: `${candidate.role} produced an immutable verified Candidate.`,
        value: clone(candidate),
      }));
    }
    if (sectionId === 'feedback') {
      return (view.feedback ?? []).map((packet) => ({
        id: packet.feedbackId, section: 'feedback', state: 'recorded',
        summary: packet.feedback.summary,
        value: clone(packet),
      }));
    }
    if (sectionId === 'rounds') {
      return (view.rounds ?? []).map((round) => ({
        id: `workflow-round:${round.round}:${round.plan.digest}`,
        section: 'rounds', state: round.state,
        summary: round.kind === 'revision'
          ? `Round ${round.round} revises one immutable selected Candidate.`
          : `Round ${round.round} produced parallel attributable Candidates.`,
        value: clone(round),
      }));
    }
    const single = {
      execution: {
        state: view.phase, terminalCause: view.terminalCause ?? null,
        ...(view.attempts ? { attempts: clone(view.attempts) } : {}),
      },
      orchestration: this.driver.coordination.runOrchestrationView?.(current.goal.runId) ?? null,
      route: view.route,
      budget: view.budget,
      verification: view.verification,
      semantic_review: view.semanticReview,
      result: view.result,
      delivery: view.export ?? view.integration,
      cleanup: {
        state: projectedCleanupState(view),
        terminalCause: view.terminalCause ?? null,
        preservation: view.preservation ?? null,
        memberStops: clone(view.memberStops ?? []),
      },
    }[sectionId];
    if (single == null) return [];
    const summaryItem = {
      id: this._singletonSummaryItemId(sectionId, current), section: sectionId,
      state: single.state ?? view.phase, summary: `${sectionId.replaceAll('_', ' ')} state for this Run.`,
      value: clone(single),
    };
    if (sectionId !== 'execution') return [summaryItem];
    return [summaryItem,
      {
        id: 'execution:progress', section: 'execution', state: view.phase,
        summary: 'Current concise Run progress with change-aware continuation.',
        value: {
          phase: view.phase, stage: view.progress?.current ?? null,
          summary: view.progress?.summary ?? view.narrative,
          attention: (view.attention ?? []).length > 0 ? 'required' : 'clear',
          terminal: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
        },
      },
      {
        id: 'execution:events', section: 'execution', state: view.phase,
        summary: 'Run-scoped normalized mechanical facts; provider payloads are excluded.',
        value: {
          channel: 'events', occurrenceTrust: 'authoritative', contentTrust: 'excluded',
        },
      },
      {
        id: 'execution:output', section: 'execution', state: view.phase,
        summary: 'Opt-in Run-scoped provider output, explicitly labeled untrusted.',
        value: {
          channel: 'output', occurrenceTrust: 'authoritative', contentTrust: 'untrusted_provider',
        },
      },
    ];
  }

  _runTimelineContent(current, request, bounds) {
    const includeOutput = request.item === 'execution:output';
    try {
      return projectRunTimelinePage({
        runId: current.goal.runId,
        events: this.driver.coordination.events(),
        snapshot: this.driver.coordination.snapshot(),
        cursor: request.pageCursor ?? null,
        limit: bounds.maxItems,
        maxBytes: Math.max(1_024, bounds.maxBytes - 8_192),
        includeOutput,
        recipient: request.recipient ?? null,
        maxFragmentBytes: Math.max(256, Math.min(4_096, bounds.maxBytes - 16_384)),
        resolveOperational: ({ worker, workerSeq }) => this.driver.log.read(worker)
          .find((event) => event.seq === workerSeq) ?? null,
      });
    } catch (error) {
      if (error?.code?.startsWith('run_timeline_')) {
        throw applicationError(error.message, error.code);
      }
      throw error;
    }
  }

  _runProgressContent(current, view) {
    const timing = this._progressTiming(current, view);
    return deepFreeze({
      schemaVersion: 1, kind: 'baton.run_progress', runId: current.goal.runId,
      phase: view.phase, stage: view.progress?.current ?? null,
      summary: view.progress?.summary ?? view.narrative,
      attention: {
        state: (view.attention ?? []).length > 0 ? 'required' : 'clear',
        count: (view.attention ?? []).length,
      },
      terminal: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
      terminalCause: clone(view.terminalCause ?? null),
      resources: {
        state: projectedCleanupState(view), ownedCount: view.ownership?.workers ?? 0,
      },
      timing,
    });
  }

  _historicalProfileInspection(current, view, request) {
    if (request.cursor !== undefined || request.waitMs !== undefined) {
      throw applicationError('historical Run waiting requires its unavailable deployment profile',
        'application_profile_stale');
    }
    const terminal = APPLICATION_RUN_TERMINAL_PHASES.has(view.phase);
    const bounds = { maxItems: MAX_ATTENTION, maxBytes: MAX_RUN_VIEW_BYTES, maxWaitMs: 0 };
    const base = {
      schemaVersion: 1, runId: current.goal.runId, depth: request.depth,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      viewDigest: semanticViewDigest(view), cursor: view.cursor,
      changed: false, timedOut: false, terminal,
      truncated: false,
      help: [{ topic: request.depth === 'outline' ? 'run.inspect' : `run.inspect.${request.depth}`, depth: 'outline' }],
      policy: clone(view.policy),
    };
    if (request.depth === 'outline') {
      const timing = this._progressTiming(current, view);
      return this._finalizeSemanticInspection({
        ...base, expansions: [{ depth: 'index' }],
        outline: {
          objective: current.goal.objective,
          phase: view.phase, narrative: view.narrative, risk: current.goal.risk,
          stage: view.progress?.current ?? null,
          ...timing,
          progress: clone(view.progress),
          attention: { count: 0, state: 'clear', summary: 'No historical attention is projected.' },
          route: clone(view.route), workerPolicy: clone(view.workerPolicy),
          context: clone(this._contextState(current).projection),
          terminalCause: clone(view.terminalCause),
          resources: {
            state: projectedCleanupState(view),
            ownedCount: view.ownership?.workers ?? 0,
            cleanupState: projectedCleanupState(view),
            terminalCause: clone(view.terminalCause),
          },
          preservation: {
            state: 'unavailable', resumeAvailable: false,
            summary: 'Historical preservation policy is unavailable and was not inferred.',
          },
          policy: clone(view.policy), actions: [],
        },
      }, bounds);
    }
    if (request.depth === 'index') {
      const sections = APPLICATION_SEMANTIC_REGISTRY.sections.map((definition) => {
        const items = this._semanticSectionItems(current, view, definition.id);
        return {
          id: definition.id, state: items[0]?.state ?? 'empty', summary: definition.summary,
          itemCount: items.length, truncated: items.length > MAX_ATTENTION, authorized: true,
          expand: { depth: 'section', section: definition.id },
        };
      });
      return this._finalizeSemanticInspection({
        ...base, expansions: sections.map((row) => row.expand), sections,
      }, bounds);
    }
    const definition = APPLICATION_SEMANTIC_REGISTRY.sections.find((entry) => entry.id === request.section);
    if (!definition) throw applicationError('Run inspection section is unavailable', 'application_inspect_section_invalid');
    const allItems = this._semanticSectionItems(current, view, request.section);
    const items = allItems.slice(0, MAX_ATTENTION);
    if (request.depth === 'section') {
      return this._finalizeSemanticInspection({
        ...base, truncated: allItems.length > items.length,
        expansions: items.map((entry) => ({ depth: 'item', section: request.section, item: entry.id })),
        section: {
          id: request.section, state: items[0]?.state ?? 'empty', summary: definition.summary,
          itemCount: allItems.length, truncated: allItems.length > items.length, items,
        },
      }, bounds);
    }
    const selected = items.find((entry) => entry.id === request.item);
    if (!selected) throw applicationError('Run inspection item is unavailable', 'application_inspect_item_invalid');
    if (request.depth === 'item') {
      const hasContent = request.section === 'context'
        || (request.section === 'execution'
          && ['execution:progress', 'execution:events', 'execution:output'].includes(request.item));
      return this._finalizeSemanticInspection({
        ...base, expansions: [
          ...(hasContent ? [{ depth: 'content', section: request.section, item: request.item }] : []),
          { depth: 'evidence', section: request.section, item: request.item },
        ],
        item: request.section === 'context' ? this._contextItemDetail(selected) : selected,
      }, bounds);
    }
    if (request.depth === 'content') {
      if (request.section === 'execution'
        && ['execution:progress', 'execution:events', 'execution:output'].includes(request.item)) {
        const content = request.item === 'execution:progress'
          ? this._runProgressContent(current, view)
          : this._runTimelineContent(current, request, bounds);
        const hasMore = content.kind === 'baton.run_timeline.page' && content.hasMore;
        return this._finalizeSemanticInspection({
          ...base, truncated: hasMore,
          expansions: [
            ...(hasMore ? [{
              depth: 'content', section: 'execution', item: request.item,
              pageCursor: content.cursor,
              ...(request.recipient ? { recipient: request.recipient } : {}),
            }] : []),
            { depth: 'evidence', section: 'execution', item: request.item },
          ],
          ...(hasMore ? {
            continuation: {
              operation: 'run.inspect', arguments: {
                runId: current.goal.runId, depth: 'content', section: 'execution',
                item: request.item, pageCursor: content.cursor,
                ...(request.recipient ? { recipient: request.recipient } : {}),
              },
            },
          } : {}),
          item: { id: selected.id, section: selected.section }, content,
        }, bounds);
      }
      if (request.section !== 'context') {
        throw applicationError('Content depth is only available for Context results',
          'application_context_content_unavailable');
      }
      const content = this._contextItemContent(selected, request.offset ?? 0, bounds);
      return this._finalizeSemanticInspection({
        ...base, truncated: content.truncated,
        expansions: [
          ...(content.nextOffset === null ? [] : [{
            depth: 'content', section: request.section, item: request.item,
            offset: content.nextOffset,
          }]),
          { depth: 'evidence', section: request.section, item: request.item },
        ],
        item: { id: selected.id, section: selected.section }, content,
      }, bounds);
    }
    const evidence = [
      { kind: 'goal', digest: current.goal.digest, provenance: 'durable Goal authority' },
      ...(current.plan ? [{ kind: 'plan', digest: current.plan.digest, provenance: 'durable Plan authority' }] : []),
      ...(current.approval ? [{ kind: 'approval', digest: current.approval.digest, provenance: 'durable Plan approval authority' }] : []),
      ...(request.section === 'context' ? this._contextItemEvidence(current, selected) : []),
    ];
    return this._finalizeSemanticInspection({
      ...base, expansions: [], item: { id: selected.id, section: selected.section }, evidence,
    }, bounds);
  }

  async inspect(rawRequest, rawPrincipal, rawContext = null) {
    this._assertOpen();
    await this.ready;
    const context = normalizeCommandContext(rawContext);
    validateApplicationCommandArgs('run.inspect', rawRequest);
    const request = deepFreeze({ depth: 'outline', ...clone(rawRequest) });
    const principal = normalizePrincipal(rawPrincipal, 'inspection principal');
    const authorizationSubject = {
      depth: request.depth, section: request.section ?? null, item: request.item ?? null,
    };
    this._authorizeRecursiveCommand('run.status', request.runId, principal, context);
    await this._authorize('run.status', principal, request.runId, authorizationSubject);
    const current = this._findRun(request.runId, { allowUnavailableProfile: true });
    if (!current.profile) {
      const view = this._withContextProjection(
        current, await this._buildView(current, this.principals.observer),
      );
      return this._historicalProfileInspection(current, view, request);
    }
    const policy = current.profile.followPolicy;
    if (request.cursor !== undefined && policy.mode !== 'enabled') {
      throw applicationError('Run inspection waiting is disabled by deployment policy',
        'application_inspect_policy_violation');
    }
    if (request.waitMs !== undefined && request.waitMs > policy.maxWaitMs) {
      throw applicationError('Run inspection wait exceeds deployment policy', 'application_inspect_policy_violation');
    }
    const effectiveWaitMs = request.cursor === undefined
      ? undefined : (request.waitMs ?? policy.maxWaitMs);
    const bounds = this._semanticBounds(current);
    let view = this._withContextProjection(
      current, await this._buildView(current, this.principals.observer),
    );
    if (request.cursor !== undefined && request.cursor > view.cursor) {
      throw applicationError('Run inspection cursor is ahead of durable authority', 'application_inspect_cursor_ahead');
    }
    let relevantChange = false;
    let timedOut = false;
    if (request.cursor !== undefined && !APPLICATION_RUN_TERMINAL_PHASES.has(view.phase)) {
      const deadline = Date.now() + effectiveWaitMs;
      let scanCursor = request.cursor;
      const controller = new AbortController();
      this._followControllers.add(controller);
      try {
        for (;;) {
          while (scanCursor < view.cursor) {
            const page = this._followPage(current, view, scanCursor);
            if (page.changes.length > 0) {
              relevantChange = true;
              break;
            }
            if (page.throughCursor <= scanCursor) break;
            scanCursor = page.throughCursor;
            if (!page.hasMore) break;
          }
          if (relevantChange || APPLICATION_RUN_TERMINAL_PHASES.has(view.phase)) break;
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            timedOut = true;
            break;
          }
          const notification = await this.driver.coordination.waitAfter(view.cursor, remaining, { signal: controller.signal });
          if (controller.signal.aborted) {
            throw applicationError('Run inspection was cancelled', 'application_inspect_cancelled');
          }
          this._authorizeRecursiveCommand('run.status', request.runId, principal, context);
          view = this._withContextProjection(
            current, await this._buildView(current, this.principals.observer),
          );
          await this._authorize('run.status', principal, request.runId, authorizationSubject);
          if (notification?.advanced === false && !APPLICATION_RUN_TERMINAL_PHASES.has(view.phase)) {
            timedOut = true;
            break;
          }
        }
      } catch (error) {
        if (controller.signal.aborted || error?.code === 'coordination_wait_aborted') {
          throw applicationError('Run inspection was cancelled', 'application_inspect_cancelled');
        }
        throw error;
      } finally {
        this._followControllers.delete(controller);
      }
    }
    this._authorizeRecursiveCommand('run.status', request.runId, principal, context);
    const changed = request.cursor !== undefined && relevantChange;
    const base = this._semanticEnvelope(current, view, request, {
      changed,
      timedOut: timedOut && !changed && !APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
    });
    if (request.depth === 'outline') {
      const attention = view.attention ?? [];
      const timing = this._progressTiming(current, view);
      const orchestration = this.driver.coordination.runOrchestrationView?.(current.goal.runId) ?? null;
      const outline = {
        objective: current.goal.objective,
        phase: view.phase,
        stage: view.progress?.current ?? null,
        ...timing,
        narrative: view.narrative,
        risk: view.planPreview?.risk ?? current.profile.risk,
        progress: clone(view.progress),
        attention: {
          count: attention.length,
          state: attention.length > 0 ? 'required' : 'clear',
          summary: attention.length > 0 ? 'Run attention is required; expand the attention section.' : 'No operator attention is pending.',
        },
        route: clone(view.route),
        workerPolicy: clone(view.workerPolicy),
        terminalCause: clone(view.terminalCause ?? null),
        resources: {
          state: projectedCleanupState(view),
          ownedCount: view.ownership?.workers ?? 0,
          cleanupState: projectedCleanupState(view),
          terminalCause: clone(view.terminalCause ?? null),
        },
        ...(orchestration ? { orchestration: clone(orchestration) } : {}),
        ...(view.workflow ? { workflow: clone(view.workflow) } : {}),
        context: clone(this._contextState(current).projection),
        // PS3/PS7: outline depth says plainly whether work was preserved, the stop reason, the
        // cleanup state, and the next semantic action — never the checkpoint ref/SHA or a path.
        preservation: {
          state: view.preservation?.state ?? 'unavailable',
          resumeAvailable: view.preservation?.available === true,
          summary: view.preservation?.state === 'pinned' ? 'Work preserved; resume available after fresh verification.'
            : 'No preserved work is advertised.',
        },
        actions: this._semanticActions(current, view, principal),
      };
      return this._finalizeSemanticInspection({
        ...base,
        expansions: [{ depth: 'index' }],
        outline,
      }, bounds);
    }
    if (request.depth === 'index') {
      const sections = APPLICATION_SEMANTIC_REGISTRY.sections.map((definition) => {
        const items = this._semanticSectionItems(current, view, definition.id);
        return {
          id: definition.id,
          state: items[0]?.state ?? 'empty',
          summary: definition.summary,
          itemCount: items.length,
          truncated: items.length > bounds.maxItems,
          authorized: true,
          expand: { depth: 'section', section: definition.id },
        };
      });
      return this._finalizeSemanticInspection({
        ...base, expansions: sections.map((row) => row.expand), sections,
      }, bounds);
    }
    const sectionDefinition = APPLICATION_SEMANTIC_REGISTRY.sections.find((entry) => entry.id === request.section);
    if (!sectionDefinition) throw applicationError('Run inspection section is unavailable', 'application_inspect_section_invalid');
    const allItems = this._semanticSectionItems(current, view, request.section);
    const items = allItems.slice(0, bounds.maxItems);
    if (request.depth === 'section') {
      return this._finalizeSemanticInspection({
        ...base,
        truncated: allItems.length > items.length,
        expansions: items.map((entry) => ({ depth: 'item', section: request.section, item: entry.id })),
        section: {
          id: request.section, state: items[0]?.state ?? 'empty', summary: sectionDefinition.summary,
          itemCount: allItems.length, truncated: allItems.length > items.length, items,
        },
      }, bounds);
    }
    const selected = items.find((entry) => entry.id === request.item);
    if (!selected) throw applicationError('Run inspection item is unavailable', 'application_inspect_item_invalid');
    if (request.depth === 'item') {
      const hasContent = request.section === 'context'
        || (request.section === 'execution'
          && ['execution:progress', 'execution:events', 'execution:output'].includes(request.item));
      return this._finalizeSemanticInspection({
        ...base, expansions: [
          ...(hasContent ? [{ depth: 'content', section: request.section, item: request.item }] : []),
          { depth: 'evidence', section: request.section, item: request.item },
        ],
        item: request.section === 'context' ? this._contextItemDetail(selected) : selected,
      }, bounds);
    }
    if (request.depth === 'content') {
      if (request.section === 'execution'
        && ['execution:progress', 'execution:events', 'execution:output'].includes(request.item)) {
        const content = request.item === 'execution:progress'
          ? this._runProgressContent(current, view)
          : this._runTimelineContent(current, request, bounds);
        const hasMore = content.kind === 'baton.run_timeline.page' && content.hasMore;
        const continuation = content.kind === 'baton.run_timeline.page'
          ? (hasMore || !base.terminal ? {
            operation: 'run.inspect',
            arguments: {
              runId: current.goal.runId, depth: 'content', section: 'execution',
              item: request.item, pageCursor: content.cursor,
              ...(request.recipient ? { recipient: request.recipient } : {}),
              ...(!hasMore && !base.terminal ? { cursor: view.cursor } : {}),
            },
          } : null)
          : base.continuation;
        return this._finalizeSemanticInspection({
          ...base, truncated: hasMore,
          expansions: [
            ...(hasMore ? [{
              depth: 'content', section: 'execution', item: request.item,
              pageCursor: content.cursor,
              ...(request.recipient ? { recipient: request.recipient } : {}),
            }] : []),
            { depth: 'evidence', section: 'execution', item: request.item },
          ],
          ...(continuation ? { continuation } : {}),
          item: { id: selected.id, section: selected.section }, content,
        }, bounds);
      }
      if (request.section !== 'context') {
        throw applicationError('Content depth is only available for Context results',
          'application_context_content_unavailable');
      }
      const content = this._contextItemContent(selected, request.offset ?? 0, bounds);
      return this._finalizeSemanticInspection({
        ...base, truncated: content.truncated,
        expansions: [
          ...(content.nextOffset === null ? [] : [{
            depth: 'content', section: request.section, item: request.item,
            offset: content.nextOffset,
          }]),
          { depth: 'evidence', section: request.section, item: request.item },
        ],
        item: { id: selected.id, section: selected.section }, content,
      }, bounds);
    }
    const evidence = [
      { kind: 'goal', digest: current.goal.digest, provenance: 'durable Goal authority' },
      ...(current.plan ? [{ kind: 'plan', digest: current.plan.digest, provenance: 'durable Plan authority' }] : []),
      ...(current.approval ? [{ kind: 'approval', digest: current.approval.digest, provenance: 'durable Plan approval authority' }] : []),
      ...(request.section === 'context' ? this._contextItemEvidence(current, selected) : []),
    ];
    return this._finalizeSemanticInspection({
      ...base, expansions: [], item: { id: selected.id, section: selected.section }, evidence,
    }, bounds);
  }

  async listRuns(rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const principal = normalizePrincipal(rawPrincipal, 'Run list principal');
    await this._authorize('runs.list', principal, null, { operation: 'runs.list' });
    const goalPlan = this.driver.coordination.snapshot().goalPlan;
    if (!goalPlan || goalPlan.goals.length > MAX_RUN_RECORDS) {
      throw applicationError('Run list exceeds its bounded lookup ceiling',
        'application_run_list_oversize');
    }
    const latest = new Map();
    for (const goal of goalPlan.goals) {
      if (goal.repoId !== this.repoId || goal.runId === null) continue;
      const prior = latest.get(goal.runId);
      if (!prior || goal.version > prior.version) latest.set(goal.runId, goal);
    }
    const ordered = [...latest.values()].sort((left, right) => (
      left.definedEvent === right.definedEvent
        ? (left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0)
        : right.definedEvent - left.definedEvent
    ));
    const authorized = [];
    for (const goal of ordered) {
      try {
        await this._authorize('run.status', principal, goal.runId, { operation: 'runs.list' });
      } catch (error) {
        if (error?.code === 'application_unauthorized') continue;
        throw error;
      }
      authorized.push(goal);
    }
    if (authorized.length > MAX_RUN_LIST_ITEMS) {
      throw applicationError('Run list requires bounded continuation support',
        'application_run_list_continuation_required');
    }
    const items = [];
    for (const goal of authorized) {
      const current = this._findRun(goal.runId, { allowUnavailableProfile: true });
      const view = this._withContextProjection(
        current, await this._buildView(current, this.principals.observer),
      );
      const actions = current.profile
        ? this._semanticActions(current, view, principal).map((action) => action.kind)
        : [];
      const attention = view.attention ?? [];
      const timing = this._progressTiming(current, view);
      items.push(deepFreeze({
        id: goal.runId,
        objective: goal.objective,
        phase: view.phase,
        stage: view.progress?.current ?? null,
        ...timing,
        terminal: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
        attention: attention.length > 0 ? 'required' : 'clear',
        route: clone(view.route),
        resources: {
          state: projectedCleanupState(view),
          ownedCount: view.ownership?.workers ?? 0,
        },
        actions: deepFreeze(actions),
      }));
    }
    const result = deepFreeze({
      schemaVersion: 1,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      items: deepFreeze(items),
      continuation: null,
    });
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RUN_VIEW_BYTES) {
      throw applicationError('Run list response exceeds its byte ceiling',
        'application_run_list_oversize');
    }
    return result;
  }

  async help(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    validateApplicationCommandArgs('application.help', rawRequest);
    const request = { topic: 'application', depth: 'outline', ...clone(rawRequest) };
    const principal = normalizePrincipal(rawPrincipal, 'help principal');
    await this._authorize('application.help', principal, request.runId ?? null, {
      topic: request.topic, depth: request.depth,
    });
    if (request.runId !== undefined) this._findRun(request.runId);
    const section = APPLICATION_SEMANTIC_REGISTRY.sections.find((entry) => request.topic.endsWith(`.${entry.id}`));
    const workerPolicyTopic = request.topic === 'worker-policy' || request.topic.endsWith('.worker-policy');
    return deepFreeze({
      schemaVersion: 1,
      topic: request.topic,
      depth: request.depth,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      title: workerPolicyTopic ? 'worker permission policy' : section ? `${section.id.replaceAll('_', ' ')} inspection` : request.topic,
      summary: workerPolicyTopic
        ? 'Worker policy separates approval autonomy, full-versus-workspace harness access, and independently attested containment. The default is unattended full access; a worktree and private runtime do not prove host containment.'
        : section?.summary ?? 'Start or open a Run, inspect only the depth needed, then perform a currently offered action. For a nonterminal response, call its continuation descriptor to wait for the next relevant change; this is the preferred change-aware workflow.',
      examples: workerPolicyTopic && request.runId
        ? [{ operation: 'run.inspect', arguments: { runId: request.runId, depth: 'outline' }, resultField: 'outline.workerPolicy' }]
        : section && request.runId
        ? [{ operation: 'run.inspect', arguments: { runId: request.runId, depth: 'section', section: section.id } }]
        : [{ operation: 'run.inspect', arguments: { runId: 'RUN_ID', depth: 'outline' } }],
      links: [
        { topic: 'run.inspect', depth: 'outline' },
        { topic: 'run.act', depth: 'outline' },
        { topic: 'worker-policy', depth: 'outline' },
        { topic: 'advanced', depth: 'outline' },
      ],
    });
  }

  async act(rawRequest, rawPrincipal, rawContext = null) {
    this._assertOpen();
    await this.ready;
    const context = normalizeCommandContext(rawContext);
    validateApplicationCommandArgs('run.act', rawRequest);
    const request = deepFreeze(clone(rawRequest));
    const principal = normalizePrincipal(rawPrincipal, 'action principal');
    await this._authorize('run.status', principal, request.runId, { operation: 'act' });
    this._assertOpen();
    const { current, action } = await this._resolveSemanticAction(request, principal);
    if (!action) {
      const controlReplay = await this._replaySemanticControl(
        current, request, principal, context,
      );
      if (controlReplay) return controlReplay;
      const replay = this._replaySemanticResumeAction(current, request, principal);
      if (replay) {
        const definition = APPLICATION_SEMANTIC_REGISTRY.actions.resume_work;
        const authority = context?.semanticAuthority ?? semanticAuthorityForAction({
          actionId: request.actionId,
          kind: 'resume_work',
          effect: definition.effect,
          requiredCapabilities: definition.requiredCapabilities,
        });
        await this._authorizeSemanticAuthority(authority, principal, request.runId, context);
        return this.inspect({ runId: request.runId, depth: 'outline' }, principal);
      }
      throw applicationError('Run action is outside the current authority scope', 'application_action_scope_mismatch');
    }
    const semanticAuthority = semanticAuthorityForAction(action);
    await this._authorizeSemanticAuthority(semanticAuthority, principal, request.runId, context);
    if (context?.sessionAuthority) {
      if (!action.kind.startsWith('context_')) {
        throw applicationError('recursive Run command is forbidden',
          'run_orchestrator_command_forbidden');
      }
      this._authorizeRecursiveCommand('run.context', request.runId, principal, context);
    }
    const supplied = Object.keys(request.inputs).sort();
    const allowed = Object.keys(action.inputSchema.properties).sort();
    const required = [...(action.inputSchema.required ?? [])].sort();
    if (supplied.some((field) => !allowed.includes(field)) || required.some((field) => !supplied.includes(field))) {
      throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
    }
    await this._recheckSemanticAction(current, semanticAuthority, principal);
    if (['send', 'interrupt'].includes(action.kind)) {
      return this._withRunEffect(request.runId, async () => {
        await this._recheckSemanticAction(current, semanticAuthority, principal);
        return this._performSemanticControl(
          current, action, request.inputs, principal, context,
        );
      });
    }
    if (action.kind.startsWith('context_')) {
      return this.driver.coordination.withContextArtifactVerification(async () => {
      if ((action.kind === 'context_search'
        && (!validText(request.inputs.query, 4_096)
          || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(request.inputs.query))))
        || (action.kind === 'context_map'
          && (!/^cell:[a-f0-9]{64}$/u.test(request.inputs.cellId ?? '')
            || !validText(request.inputs.instruction, 16_384)
            || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(request.inputs.instruction))))
        || (action.kind === 'context_reduce'
          && (!/^context-call:[a-f0-9]{64}$/u.test(request.inputs.callId ?? '')
            || !validText(request.inputs.instruction, 16_384)
            || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(request.inputs.instruction))))
        || (action.kind === 'context_retry'
          && (!/^context-call:[a-f0-9]{64}$/u.test(request.inputs.callId ?? '')
            || request.inputs.callId !== action.target?.callId))
        || (request.inputs.branch !== undefined && !validText(request.inputs.branch, 256))
        || (request.inputs.by !== undefined && !validText(request.inputs.by, 256))
        || (request.inputs.role !== undefined && !action.choices.includes(request.inputs.role))
        || (request.inputs.mode !== undefined
          && !['literal', 'case_insensitive'].includes(request.inputs.mode))) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      // Authorization and view construction may yield. Recheck the deployment gate at the
      // synchronous registration boundary so shutdown cannot miss a late Context admission.
      this._assertOpen();
      await this._recheckSemanticAction(current, semanticAuthority, principal);
      const controller = new AbortController();
      const controllers = this._contextControllers.get(request.runId) ?? new Set();
      const operation = {
        controller,
        settled: this._withRunEffect(request.runId,
          () => this._performContextAction(
            current, action, request.inputs, principal, controller.signal,
          )),
      };
      controllers.add(operation);
      this._contextControllers.set(request.runId, controllers);
      let result;
      try {
        result = await operation.settled;
      } finally {
        controllers.delete(operation);
        if (controllers.size === 0 && this._contextControllers.get(request.runId) === controllers) {
          this._contextControllers.delete(request.runId);
        }
      }
      const contextItemId = result?.callId ?? result?.cellId;
      if (!/^(?:cell|context-call):[a-f0-9]{64}$/u.test(contextItemId ?? '')) {
        throw applicationError('Context action returned an invalid addressed result',
          'application_context_result_invalid');
      }
      return this.inspect({
        runId: request.runId, depth: 'item', section: 'context', item: contextItemId,
      }, principal, context);
      });
    }
    if (action.kind === 'approve_plan') {
      await this.approve(request.runId, current.plan.digest, principal);
    } else if (action.kind === 'answer_approval') {
      if (!['allow', 'deny', 'cancel'].includes(request.inputs.decision)
        || !validText(action.target?.requestId, 4_096)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.answer(request.runId, action.target.requestId, { decision: request.inputs.decision }, principal);
    } else if (action.kind === 'answer_question') {
      if (!validText(request.inputs.text, MAX_ATTENTION_TEXT_BYTES)
        || SECRET_SHAPED_TEXT.some((pattern) => pattern.test(request.inputs.text))
        || !validText(action.target?.requestId, 4_096)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.answer(request.runId, action.target.requestId, { text: request.inputs.text }, principal);
    } else if (action.kind === 'select_candidate') {
      if (!action.choices.includes(request.inputs.role)
        || !validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.selectWorkflowCandidate({
        runId: request.runId, role: request.inputs.role, reason: request.inputs.reason,
      }, principal, SEMANTIC_ACTION_DISPATCH);
    } else if (action.kind === 'send_feedback') {
      if (!action.choices.includes(request.inputs.role)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.sendWorkflowFeedback({
        runId: request.runId, role: request.inputs.role, feedback: request.inputs.feedback,
      }, principal);
    } else if (action.kind === 'revise_candidate') {
      if (!validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.reviseWorkflowCandidate({
        runId: request.runId, reason: request.inputs.reason,
        actionId: action.actionId,
        principalScopeDigest: digest({
          principalId: principal.principalId, sessionId: principal.sessionId,
        }),
      }, principal, SEMANTIC_ACTION_DISPATCH);
    } else if (action.kind === 'stop_member') {
      if (!action.choices.includes(request.inputs.role)
        || !validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.stopWorkflowMember({
        runId: request.runId, role: request.inputs.role, reason: request.inputs.reason,
      }, principal, SEMANTIC_ACTION_DISPATCH);
    } else if (action.kind === 'adopt_result') {
      if (!validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      const evidence = await this._buildEvidence(current);
      await this._recheckSemanticAction(current, semanticAuthority, principal);
      await this.adopt({
        runId: request.runId,
        nodeKey: evidence.result?.nodeKey,
        resultSha: evidence.result?.sha,
        evidenceDigest: evidence.manifestDigest,
        reason: request.inputs.reason,
      }, principal);
    } else if (action.kind === 'retry_verification') {
      if (!validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.retryVerification({ runId: request.runId, reason: request.inputs.reason }, principal);
    } else if (action.kind === 'resume_work') {
      if (!validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      await this.resumeWork(
        { runId: request.runId, reason: request.inputs.reason },
        principal,
        {
          actionId: action.actionId,
          principalScopeDigest: digest({ principalId: principal.principalId, sessionId: principal.sessionId }),
        },
      );
    } else if (action.kind === 'semantic_review') {
      if (!Number.isSafeInteger(request.inputs.routeIndex) || request.inputs.routeIndex < 0
        || !validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      const route = action.choices[request.inputs.routeIndex];
      if (!route) throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      await this.review({ runId: request.runId, route, reason: request.inputs.reason }, principal);
    } else if (action.kind === 'integrate') {
      if (!action.choices.includes(request.inputs.strategy) || !validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      const evidence = await this._buildEvidence(current);
      await this._recheckSemanticAction(current, semanticAuthority, principal);
      await this.integrate({
        runId: request.runId,
        evidenceDigest: evidence.manifestDigest,
        strategy: request.inputs.strategy,
        reason: request.inputs.reason,
      }, principal);
    } else if (action.kind === 'export_result') {
      const evidence = await this._buildEvidence(current);
      await this._recheckSemanticAction(current, semanticAuthority, principal);
      await this.export({ runId: request.runId, evidenceDigest: evidence.manifestDigest }, principal);
    } else if (action.kind === 'stop') {
      normalizeStop({ runId: request.runId, reason: request.inputs.reason });
      await this.stop(request.runId, request.inputs.reason, principal);
    } else {
      throw applicationError('Run action is unavailable', 'application_action_unavailable');
    }
    return this.inspect({ runId: request.runId, depth: 'outline' }, principal, context);
  }

  card() {
    return deepFreeze({
      schemaVersion: 1,
      repoId: this.repoId,
      commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
      agentExperience: {
        registryVersion: APPLICATION_SEMANTIC_REGISTRY.version,
        registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
        defaultOperations: clone(APPLICATION_SEMANTIC_REGISTRY.defaultOperations),
        projections: Object.fromEntries(['direct', 'cli', 'web', 'mcp', 'browser'].map((surface) => [surface, {
          operations: clone(APPLICATION_SEMANTIC_REGISTRY.defaultOperations),
        }])),
      },
      defaults: clone(this.defaults),
      profiles: [...this.profiles.entries()].map(([name, profile]) => ({
        name,
        digest: profile.digest,
        routes: clone(profile.routes),
        pathScope: clone(profile.pathScope),
        resultPolicy: {
          mode: profile.resultPolicy.mode, locator: profile.resultPolicy.locator,
        },
        reviewPolicy: {
          mode: profile.reviewPolicy.mode, routes: clone(profile.reviewPolicy.routes),
          reportPath: profile.reviewPolicy.reportPath,
        },
        integrationPolicy: clone(profile.integrationPolicy),
        followPolicy: { mode: profile.followPolicy.mode },
        exportPolicy: {
          mode: profile.exportPolicy.mode, format: profile.exportPolicy.format,
          requireAdoptedResult: profile.exportPolicy.requireAdoptedResult,
          requireSemanticReview: profile.exportPolicy.requireSemanticReview,
          requireIntegration: profile.exportPolicy.requireIntegration,
        },
        recoveryPolicy: {
          mode: profile.recoveryPolicy.mode,
          eligibleSessionModes: clone(profile.recoveryPolicy.eligibleSessionModes),
          ambiguousDispatch: profile.recoveryPolicy.ambiguousDispatch,
        },
        workerPolicy: profile.workerPolicy ? clone(profile.workerPolicy) : null,
      })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    });
  }

  async command(name, args, rawPrincipal, rawContext = null) {
    if (!validText(name, 64)) throw applicationError('application command is invalid', 'application_command_invalid');
    const principal = normalizePrincipal(rawPrincipal, 'command principal');
    const context = normalizeCommandContext(rawContext);
    validateApplicationCommandArgs(name, args);
    const recursiveReadCommands = new Set(['application.help', 'run.inspect', 'run.status', 'run.follow', 'run.wait']);
    const recursiveEffectCommands = new Set(['run.start', 'run.stop']);
    if (context?.sessionAuthority && name !== 'run.act'
      && !recursiveReadCommands.has(name) && !recursiveEffectCommands.has(name)) {
      const runId = args?.runId ?? args?.intent?.runId ?? null;
      if (validId(runId)) this._authorizeRecursiveCommand(name, runId, principal, context);
      throw applicationError('recursive Run command is forbidden', 'run_orchestrator_command_forbidden');
    }
    if (name === 'application.help') {
      return this.help(args, principal);
    }
    if (name === 'runs.list') {
      return this.listRuns(principal);
    }
    if (name === 'run.start') {
      return this.start(args.intent, principal, context);
    }
    if (name === 'run.inspect') {
      return this.inspect(args, principal, context);
    }
    if (name === 'run.act') {
      return this.act(args, principal, context);
    }
    if (name === 'run.status') {
      return this.status(args.runId, principal, {}, context);
    }
    if (name === 'run.follow') {
      return this.follow(args.runId, principal, { afterCursor: args.afterCursor, timeoutMs: args.timeoutMs }, context);
    }
    if (name === 'run.approve') {
      return this.approve(args.runId, args.planDigest, principal);
    }
    if (name === 'run.wait') {
      return this.wait(args.runId, principal, { timeoutMs: args.timeoutMs }, context);
    }
    if (name === 'run.answer') {
      return this.answer(args.runId, args.requestId, args.answer, principal);
    }
    if (name === 'run.feedback') {
      return this.sendWorkflowFeedback(args, principal);
    }
    if (name === 'run.steer') {
      return this.steer(args, principal);
    }
    if (name === 'run.stop') {
      return this.stop(args.runId, args.reason, principal, context);
    }
    if (name === 'run.evidence') {
      return this.evidence(args.runId, principal);
    }
    if (name === 'run.adopt') {
      return this.adopt(args, principal);
    }
    if (name === 'run.retry_verification') {
      return this.retryVerification(args, principal);
    }
    if (name === 'run.resume_work') {
      return this.resumeWork(args, principal);
    }
    if (name === 'run.review') {
      return this.review(args, principal);
    }
    if (name === 'run.integrate') {
      return this.integrate(args, principal);
    }
    if (name === 'run.export') {
      return this.export(args, principal);
    }
    if (name === 'run.recover') {
      return this.recover(args.runId, principal);
    }
    if (name === 'application.shutdown') {
      return this.shutdown(principal);
    }
    throw applicationError(`unsupported application command ${name}`, 'application_command_unavailable');
  }

  async answer(runId, requestId, rawAnswer, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId) || !validText(requestId, 4_096)) {
      throw applicationError('Run answer target is invalid', 'application_answer_invalid');
    }
    const principal = normalizePrincipal(rawPrincipal, 'answer principal');
    const answer = normalizeAnswer(rawAnswer);
    await this._authorize('run.answer', principal, runId, { requestId, answerKind: Object.keys(answer)[0] });
    this._assertRunMutable(runId);
    const interaction = this.driver.coordinator.interactionStatus(requestId);
    if (!interaction || interaction.runId !== runId) {
      throw applicationError('Run interaction is unavailable', 'application_interaction_not_found');
    }
    const outcome = await this.driver.coordinator.respond(requestId, answer, principal.actor);
    const current = this._findRun(runId);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.answer', requestId, result: outcome.result },
    });
  }

  async steer(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeSteer(rawRequest);
    const principal = normalizePrincipal(rawPrincipal, 'steer principal');
    await this._authorize('run.steer', principal, request.runId, {
      target: request.target,
      mode: request.mode,
      messageDigest: digest(request.message),
      reasonDigest: digest(request.reason),
    });
    this._assertRunMutable(request.runId);
    const current = this._findRun(request.runId);
    const target = this.driver.coordinator.list().find((worker) => worker.id === request.target && worker.runId === request.runId);
    if (!target) throw applicationError('Run steering target is unavailable', 'application_worker_not_found');
    if (!Number.isSafeInteger(target.fence)) {
      throw applicationError('Run steering target has no current fence', 'application_worker_not_controllable');
    }
    const mode = request.mode === 'now' ? 'steer' : request.mode;
    const outcome = await this.driver.coordinator.send(target.id, request.message, mode, {
      expectedFence: target.fence,
      actor: principal.actor,
    });
    return this._buildView(current, this.principals.observer, {
      action: {
        command: 'run.steer', target: target.id, mode: request.mode, reason: request.reason,
        result: outcome.result, emulated: outcome.emulated === true,
      },
    });
  }

  async stop(runId, rawReason, rawPrincipal, rawContext = null) {
    this._assertOpen();
    await this.ready;
    const context = normalizeCommandContext(rawContext);
    const request = normalizeStop({ runId, reason: rawReason });
    const principal = normalizePrincipal(rawPrincipal, 'stop principal');
    return this._stop(request, principal, context);
  }

  async _stop(request, principal, context = null) {
    this._authorizeRecursiveCommand('run.stop', request.runId, principal, context);
    await this._authorize('run.stop', principal, request.runId, { reasonDigest: digest(request.reason) });
    const current = this._findRun(request.runId, { allowUnavailableProfile: true });
    let stop = this.driver.coordination.runStop(request.runId);
    if (!stop) {
      const reasonDigest = digest(request.reason);
      const admitted = this.driver.coordination.admitRunStop({
        schemaVersion: 1,
        repoId: this.repoId,
        runId: request.runId,
        reasonDigest,
        requestDigest: digest({ repoId: this.repoId, runId: request.runId, reasonDigest }),
      }, { actor: principal.actor, key: `run.stop:${request.runId}` });
      stop = admitted.stop;
    }
    await this._performRunStop(stop);
    return this._buildView(current, this.principals.observer, {
      action: { command: 'run.stop', reason: request.reason, result: 'stopped' },
    });
  }

  async detach() {
    if (this._closed) throw applicationError('closed application cannot detach', 'application_closed');
    if (this._detached) return deepFreeze({ schemaVersion: 1, state: 'detached' });
    await this.ready;
    for (const controller of this._followControllers) controller.abort();
    if (this._runDeliveryRegistrations.size > 0) {
      throw applicationError('application has active result deliveries; use deployment shutdown', 'application_detach_active');
    }
    if (this.driver.coordinator.list().length !== 0 || this._contextControllers.size !== 0) {
      throw applicationError('application has admitted workers; use deployment shutdown for exact fleet drain', 'application_detach_active');
    }
    await this.resultExportLifecycle?.close();
    await this.driver.closeAsync();
    this._detached = true;
    return deepFreeze({ schemaVersion: 1, state: 'detached' });
  }

  async shutdown(rawPrincipal) {
    const principal = normalizePrincipal(rawPrincipal, 'shutdown principal');
    await this._authorize('application.shutdown', principal, null, {});
    if (this._closed) return this._closed;
    if (this._detached) throw applicationError('detached application cannot close deployment authority', 'application_detached');
    await this.ready;
    if (this._closed) return this._closed;
    if (this._closing) return this._closing;
    const closing = this._shutdownAuthorized(principal);
    this._closing = closing;
    try {
      return await closing;
    } catch (cause) {
      if (this._closing === closing && this._closed === null) this._closing = null;
      throw cause;
    }
  }

  async _shutdownAuthorized(principal) {
    for (const controller of this._followControllers) controller.abort();
    for (const controllers of this._contextControllers?.values() ?? []) {
      for (const operation of controllers) operation.controller.abort();
    }
    await Promise.allSettled([...(this._runEffectChains?.values() ?? [])]);
    await this._abortResultExportDeliveries();
    await this.resultExportLifecycle?.close();
    const receipt = await this.driver.drainAndClose(principal.actor);
    const closed = deepFreeze({
      schemaVersion: 1,
      state: 'closed',
      ownership: { workers: 0, workerIds: [], closed: true },
      receipt: clone(receipt),
    });
    this._closed = closed;
    return closed;
  }
}
