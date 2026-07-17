import { createHash } from 'node:crypto';
import { normalizeGoalRequest, normalizePlanRequest } from './goal-plan.mjs';
import {
  identifyResultExportRoot, ResultExportLifecycle,
} from './result-export.mjs';
import { APPLICATION_SEMANTIC_REGISTRY, projectTypedTerminalCause } from './application-semantics.mjs';

export { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';

const MAX_PROFILES = 256;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_RUN_RECORDS = 100_000;
const MAX_RUN_VIEW_BYTES = 512 * 1024;
const MAX_RUN_VIEW_WORKERS = 1_024;
const MAX_ATTENTION = 64;
const MAX_ATTENTION_TEXT_BYTES = 4_096;
const MAX_REVIEW_SOURCE_BYTES = 4 * 1024 * 1024;
// Provider execution can settle while the application Run remains open for
// result finalization. These closed sets intentionally model separate lifecycles.
export const PROVIDER_EXECUTION_SETTLED_PHASES = new Set([
  'work_completed', 'completed', 'failed', 'cancelled', 'denied', 'stopped', 'closed',
]);
export const APPLICATION_RUN_TERMINAL_PHASES = new Set([
  'completed', 'failed', 'cancelled', 'denied', 'stopped', 'closed',
]);

export const APPLICATION_COMMAND_DEFINITIONS = Object.freeze({
  'application.help': Object.freeze({ args: Object.freeze(['topic', 'depth', 'runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.start': Object.freeze({ args: Object.freeze(['intent']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.inspect': Object.freeze({ args: Object.freeze(['runId', 'depth', 'section', 'item', 'cursor', 'waitMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.act': Object.freeze({ args: Object.freeze(['runId', 'actionId', 'inputs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.status': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.follow': Object.freeze({ args: Object.freeze(['runId', 'afterCursor', 'timeoutMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.approve': Object.freeze({ args: Object.freeze(['runId', 'planDigest']), capabilities: Object.freeze(['approve', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.wait': Object.freeze({ args: Object.freeze(['runId', 'timeoutMs']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.answer': Object.freeze({ args: Object.freeze(['runId', 'requestId', 'answer']), capabilities: Object.freeze(['approve', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.steer': Object.freeze({ args: Object.freeze(['runId', 'target', 'mode', 'message', 'reason']), capabilities: Object.freeze(['control', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: false }),
  'run.stop': Object.freeze({ args: Object.freeze(['runId', 'reason']), capabilities: Object.freeze(['emergency_stop', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.evidence': Object.freeze({ args: Object.freeze(['runId']), capabilities: Object.freeze(['observe']), web: true, mcp: true, mcpStateful: false, reconcilable: true }),
  'run.adopt': Object.freeze({ args: Object.freeze(['runId', 'nodeKey', 'resultSha', 'evidenceDigest', 'reason']), capabilities: Object.freeze(['adopt_result', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
  'run.retry_verification': Object.freeze({ args: Object.freeze(['runId', 'reason']), capabilities: Object.freeze(['retry_verification', 'observe']), web: true, mcp: true, mcpStateful: true, reconcilable: true }),
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
    mode: 'none', maxWaitMs: 0, maxChanges: 0, maxResponseBytes: 0, maxScanEvents: 0,
  });
  exactObject(value, ['mode', 'maxWaitMs', 'maxChanges', 'maxResponseBytes', 'maxScanEvents'],
    'application_profile_invalid', 'profile followPolicy');
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
  const requiredFields = [
    'schemaVersion', 'repoId', 'definitionOfDone', 'constraints', 'risk', 'goalBudget',
    'nodeBudget', 'pathScope', 'verification', 'routes', 'capabilities', 'effects', 'resultPolicy',
  ];
  const allowedFields = new Set([...requiredFields, 'reviewPolicy', 'integrationPolicy', 'followPolicy', 'exportPolicy', 'recoveryPolicy']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || requiredFields.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw applicationError(`profile ${name} has unknown or missing fields`, 'application_profile_invalid');
  }
  if (!validId(name) || value.schemaVersion !== 1 || value.repoId !== repoId || !validText(value.risk, 64)) {
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
    schemaVersion: 1,
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

function normalizeIntent(value) {
  const allowed = new Set(['runId', 'objective', 'profile', 'route', 'scope']);
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
  });
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
  if (name === 'run.inspect') {
    const allowed = new Set(definition.args);
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some((key) => !allowed.has(key)) || !validId(args.runId)
      || (args.depth !== undefined && !APPLICATION_SEMANTIC_REGISTRY.depths.includes(args.depth))
      || (args.section !== undefined && !validId(args.section))
      || (args.item !== undefined && !validId(args.item))
      || (args.cursor !== undefined && (!Number.isSafeInteger(args.cursor) || args.cursor < 0))
      || (args.waitMs !== undefined && (!Number.isSafeInteger(args.waitMs) || args.waitMs <= 0))) {
      throw applicationError('Run inspection request is invalid', 'application_inspect_invalid');
    }
    if ((args.cursor === undefined) !== (args.waitMs === undefined)) {
      throw applicationError('Run inspection cursor and wait must be supplied together', 'application_inspect_cursor_wait_invalid');
    }
    const depthValue = args.depth ?? 'outline';
    if ((['section', 'item', 'evidence'].includes(depthValue) && args.section === undefined)
      || (['item', 'evidence'].includes(depthValue) && args.item === undefined)
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
  if (name === 'run.steer') normalizeSteer(args);
  if (name === 'run.stop') normalizeStop(args);
  if (name === 'run.evidence' && !validId(args.runId)) {
    throw applicationError('Run evidence target is invalid', 'application_evidence_invalid');
  }
  if (name === 'run.adopt') normalizeAdopt(args);
  if (name === 'run.retry_verification') normalizeRetryVerification(args);
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
    resolvedHarnessVendor: live ? source.vendor ?? null : source.harnessVendor ?? source.vendor ?? null,
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
  const done = rows.filter(([, worker]) => worker.lastVerdict?.accept === true || (worker.status === 'exited' && worker.crashed !== true)).length;
  return `${active} worker(s) active${done > 0 ? `, ${done} done` : ''}.`;
}

function terminalCauseNarrative(cause) {
  if (cause?.kind === 'budget_exceeded') {
    return `Run terminated: ${cause.code} (${cause.dimension} ${cause.used}/${cause.limit}, ratio ${cause.ratio}).`;
  }
  if (cause?.kind === 'provider_failure') return `Run terminated: ${cause.code}.`;
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
      : node?.state === 'accepted' ? 'complete'
        : node?.state === 'failed' ? 'failed'
          : node?.state === 'cancelled' ? 'stopped'
            : node?.taskId ? 'active' : 'pending',
    route?.observed ? 'Provider identity observed'
      : route?.resolved ? 'Route resolved; provider identity pending'
        : node?.taskId ? 'Provider startup pending' : 'Provider not started'),
    stage('verification', 'Fresh verification', verification?.state === 'mechanically_verified' ? 'complete'
      : verification?.state === 'inconclusive' ? 'blocked'
        : verification?.state === 'failed' ? 'failed' : 'pending',
    verification?.state === 'mechanically_verified' ? 'Pinned verification accepted'
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

function publicArtifact(artifact) {
  const active = artifact.supersededBy === null && !Object.hasOwn(artifact, 'acceptanceInvalidation');
  return {
    id: artifact.id,
    digest: artifact.digest,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    accepted: artifact.accepted === true && active,
    state: !active ? (artifact.supersededBy ? 'superseded' : 'invalidated') : 'active',
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
    const optionalConfiguration = ['exportRoot', 'exportDeliveryChunkBytes', 'defaults']
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
    this.principals = deepFreeze({
      planner: normalizePrincipal(options.principals.planner, 'planner principal'),
      dispatcher: normalizePrincipal(options.principals.dispatcher, 'dispatcher principal'),
      observer: normalizePrincipal(options.principals.observer, 'observer principal'),
    });
    this.profiles = new Map(Object.entries(options.profiles).map(([name, profile]) => [name, normalizeProfile(name, profile, this.repoId)]));
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
        const card = routeCards.get(route.harness);
        const selection = card?.modelSelection;
        const modelAvailable = selection?.mode === 'exact'
          && (!Array.isArray(selection.available) || selection.available.includes(route.model));
        const effortAvailable = Array.isArray(selection?.reasoningEffort)
          && selection.reasoningEffort.includes(route.effort);
        if (!card || !modelAvailable || !effortAvailable) {
          throw applicationError(`profile ${profileName} contains an unavailable exact route`, 'application_profile_route_unavailable');
        }
      }
    }
    this.resultExportLifecycle = this.exportRoot ? new ResultExportLifecycle(this.exportRoot) : null;
    this._closed = null;
    this._detached = false;
    this._runStopPromises = new Map();
    this._runAdoptionPromises = new Map();
    this._runExportPromises = new Map();
    this._runRetryPromises = new Map();
    this._runRetryControllers = new Map();
    this._runEffectChains = new Map();
    this._runDeliveryRegistrations = new Map();
    this._semanticReviewPromises = new Map();
    this._followControllers = new Set();
    this.ready = Promise.resolve().then(() => this._reconcileRunStops())
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

  _withRunEffect(runId, operation) {
    const prior = this._runEffectChains.get(runId) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(operation);
    const settled = current.finally(() => {
      if (this._runEffectChains.get(runId) === settled) this._runEffectChains.delete(runId);
    });
    this._runEffectChains.set(runId, settled);
    return settled;
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
      if (profile.routes.length === 1) selectedRoute = profile.routes[0];
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
    return deepFreeze({ ...requested, profile: profileName, route: clone(selectedRoute) });
  }

  _assertOpen() {
    if (this._closed) throw applicationError('application is closed', 'application_closed');
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

  async authorizeReplay(name, args, rawPrincipal) {
    this._assertOpen();
    validateApplicationCommandArgs(name, args);
    const principal = normalizePrincipal(rawPrincipal, 'replay principal');
    if (name === 'run.start') {
      const intent = this._resolveIntent(args.intent);
      const profile = this._profile(intent.profile);
      const scope = intent.scope ?? clone(profile.pathScope);
      const runId = intent.runId ?? `run-${digest({
        objective: intent.objective,
        profileDigest: profile.digest,
        route: intent.route,
        scope,
        ownerPrincipalId: principal.principalId,
      }).slice(0, 32)}`;
      await this._authorize(name, principal, runId, {
        objectiveDigest: digest(intent.objective), profile: intent.profile, route: intent.route, scope,
      });
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

  _findRun(runId) {
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
    const profile = profileRef ? this.profiles.get(profileRef.name) : null;
    if (!profileRef || !profile || profile.digest !== profileRef.digest) {
      throw applicationError(`run ${runId} deployment profile is unavailable`, 'application_profile_stale');
    }
    const approval = plan ? goalPlan.approvals.find((row) => row.plan.planId === plan.planId
      && row.plan.version === plan.version && row.plan.digest === plan.digest) ?? null : null;
    const dispatch = plan ? goalPlan.dispatches.find((row) => row.binding?.planId === plan.planId
      && row.binding?.planVersion === plan.version && row.binding?.planDigest === plan.digest) ?? null : null;
    return { goal, plan, approval, dispatch, profile, profileName: profileRef.name };
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
      await this._abortResultExportDeliveries(stop.runId);
      // VR6: stop cancels an in-flight verifier retry exactly and settles its durable admission.
      for (const controller of this._runRetryControllers.get(stop.runId) ?? []) controller.abort();
      if (typeof this.driver.coordination.pendingRunVerificationRetries === 'function') {
        for (const pending of this.driver.coordination.pendingRunVerificationRetries()
          .filter((row) => row.runId === stop.runId)) {
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
        || outcome.counts.pendingCancelled + outcome.counts.killConfirmed + outcome.counts.alreadyTerminal !== outcome.targetCount
        || outcome.checks.interactionsResolved !== true || outcome.checks.runAuthorityReleased !== true) {
        throw applicationError('Run stop/reap result is incomplete', 'application_run_stop_incomplete');
      }
      const core = {
        schemaVersion: 1,
        state: 'stopped',
        scope: 'run',
        repoId: current.repoId,
        runId: current.runId,
        targetCount: outcome.targetCount,
        remainingCount: 0,
        targetDigest: current.targetDigest,
        counts: clone(outcome.counts),
        checks: { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true },
        effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
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
      const current = this._findRun(runId);
      if (current.plan && current.approval?.disposition === 'approved' && !current.dispatch) {
        await this._dispatchCurrent(current);
      }
    }
    return deepFreeze({ schemaVersion: 1, state: 'ready', examinedRuns: runIds.length });
  }

  async _dispatchCurrent(current) {
    const refreshed = this._findRun(current.goal.runId);
    this._assertRunMutable(refreshed.goal.runId);
    if (!refreshed.plan || refreshed.approval?.disposition !== 'approved' || refreshed.dispatch) return refreshed.dispatch;
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
    };
    const route = {
      vendor: node.routes.harnesses[0],
      model: node.routes.models[0],
      effort: node.routes.efforts[0],
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
      idempotencyKey: `application:${refreshed.goal.runId}:dispatch:${node.key}:v1`,
    });
    return this._findRun(refreshed.goal.runId).dispatch;
  }

  async start(rawIntent, rawOwner) {
    this._assertOpen();
    await this.ready;
    const requestedIntent = this._resolveIntent(rawIntent);
    const owner = normalizePrincipal(rawOwner, 'goal owner');
    const profile = this._profile(requestedIntent.profile);
    const scope = requestedIntent.scope ?? clone(profile.pathScope);
    const runId = requestedIntent.runId ?? `run-${digest({
      objective: requestedIntent.objective,
      profileDigest: profile.digest,
      route: requestedIntent.route,
      scope,
      ownerPrincipalId: owner.principalId,
    }).slice(0, 32)}`;
    const intent = deepFreeze({ ...requestedIntent, runId, scope });
    await this._authorize('run.start', owner, intent.runId, {
      objectiveDigest: digest(intent.objective), profile: intent.profile, route: intent.route, scope: intent.scope,
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
    const constraint = profileConstraint(intent.profile, profile);
    const goalFields = {
      objective: intent.objective,
      definitionOfDone: clone(profile.definitionOfDone),
      constraints: [...profile.constraints, constraint],
      risk: profile.risk,
      budget: clone(profile.goalBudget),
      predecessor: null,
    };
    const nodeFields = {
      key: 'work',
      objective: intent.objective,
      definitionOfDone: clone(profile.definitionOfDone),
      deps: [],
      pathScope: clone(intent.scope),
      risk: profile.risk,
      budget: clone(profile.nodeBudget),
      verification: clone(profile.verification),
      routes: { harnesses: [intent.route.harness], models: [intent.route.model], efforts: [intent.route.effort] },
      capabilities: clone(profile.capabilities),
      effects: clone(profile.effects),
    };
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
      nodes: [nodeFields],
    }, goalPlanPolicy, hypotheticalGoal);
    const defined = await this.driver.coordinator.defineGoal(goalFields,
      authority(owner, this.repoId, intent.runId, 'goal:define', `application:${intent.runId}:goal:v1`));
    const goal = defined.goal;
    let proposed;
    try {
      proposed = await this.driver.coordinator.proposePlan({
        goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
        predecessor: null,
        nodes: [nodeFields],
      }, authority(this.principals.planner, this.repoId, intent.runId, 'plan:propose', `application:${intent.runId}:plan:v1`));
    } catch (error) {
      return this._planningView(this._findRun(intent.runId), error);
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

  async status(runId, rawObserver, options = {}) {
    this._assertOpen();
    await this.ready;
    if (!validId(runId)) throw applicationError('run id is invalid', 'application_run_invalid');
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const current = this._findRun(runId);
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
    const policy = current.profile.recoveryPolicy;
    if (policy.mode !== 'manual' || !policy.eligibleSessionModes.includes('resume')) {
      throw applicationError('Run recovery is unavailable for this deployment profile', 'application_recovery_unavailable');
    }
    if (!current.plan || current.approval?.disposition !== 'approved') {
      throw applicationError('Run recovery requires an approved current Plan', 'application_recovery_unavailable');
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
      && recoveryNode.routes.harnesses.includes(handle.vendor)
      && recoveryNode.routes.models.includes(handle.modelResolved)
      && recoveryNode.routes.efforts.includes(handle.effortResolved)
    )) : [];
    const attempt = recoveryNode ? 1 : 0;
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
          state: 'operator_required', reason: 'multiple_eligible_targets', attempt,
          targetCount: handles.length, target: null, dispatchDisposition: null,
        },
      });
    }
    if (attempt > policy.maxAttempts) {
      throw applicationError('Run recovery attempt ceiling is exhausted', 'application_recovery_exhausted');
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
    };
    if (typeof this.driver.coordinator.recoverPlanBound !== 'function') {
      throw applicationError('application driver lacks Plan recovery authority', 'application_recovery_unavailable');
    }
    const outcome = await this.driver.coordinator.recoverPlanBound(selected.id, {
      actor: principal.actor,
      attempt,
      gate,
      profileDigest: current.profile.digest,
      recoveryPolicyDigest: digest(policy),
      runId,
      timeoutMs: policy.timeoutMs,
    });
    const result = outcome?.result ?? 'recovery_failed';
    const recoveredHandle = outcome?.handle ?? null;
    const routeRequested = {
      harness: recoveryNode.routes.harnesses[0],
      model: recoveryNode.routes.models[0],
      effort: recoveryNode.routes.efforts[0],
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
      attempt: outcome.attempt ?? attempt,
      target: { workerId: selected.id, taskId: outcome.taskId ?? recoveredHandle?.taskId ?? null },
      dispatchDisposition: outcome.dispatchDisposition
        ?? this.driver.coordination.recoveryDispatchState?.(selected.id)?.status ?? null,
      processGeneration: outcome.processGeneration ?? null,
      route: clone(route),
      cleanup: clone(outcome.cleanup ?? { state: 'owned' }),
    } : {
      state: result === 'dispatch_unknown' ? 'operator_required' : 'failed',
      reason: result,
      attempt,
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
    if (!current.plan || current.plan.nodes.length !== 1 || current.plan.nodes[0].key !== request.nodeKey) {
      throw applicationError('Run adoption node is unavailable', 'application_adopt_invalid');
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
    const taskId = manifest.node?.taskId;
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
      admissionDigest: pending.admissionDigest,
      outcome: { disposition: { candidate: null, base: null }, runtimeDigest: null, verdictDigest: null },
      evidence: null,
      result: null,
      checkpoint: { state: 'pinned', sha: pending.checkpointSha },
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
    const view = await this._buildView(current, this.principals.observer);
    const retry = view.verification?.retry;
    if (!retry) throw applicationError('Run has no retryable verification', 'application_retry_unavailable');
    if (!retry.available || !retry.candidatePreserved) {
      throw applicationError('Run verification retry authority is stale or unavailable', 'application_retry_stale');
    }
    const node = view.nodes[0];
    const task = node?.taskId ? this.driver.coordination.task(node.taskId) : null;
    if (!task?.assignee) throw applicationError('Run verification retry worker authority is unavailable', 'application_retry_unavailable');
    const artifacts = (task.artifactIds ?? []).map((id) => this.driver.coordination.artifact(id)).filter(Boolean);
    const priorSeq = artifacts.filter((artifact) => artifact.kind === 'verification').at(-1)
      ?.provenance?.find((ref) => Number.isSafeInteger(ref?.coordinationSeq))?.coordinationSeq;
    if (!Number.isSafeInteger(priorSeq)) {
      throw applicationError('Run verification retry evidence is unavailable', 'application_retry_unavailable');
    }
    const runtimePolicyDigest = this.driver.coordinator.verificationRuntimeDigest?.();
    if (!/^[a-f0-9]{64}$/u.test(runtimePolicyDigest ?? '')) {
      throw applicationError('Run verification retry requires a deployment verifier runtime identity', 'application_retry_unavailable');
    }
    const requestCore = {
      attempt: retry.attempt,
      checkpointSha: retry.checkpointSha,
      nodeKey,
      planDigest: current.plan.digest,
      priorEvidence: { coordinationSeq: priorSeq },
      reasonDigest: digest(request.reason),
      repoId: this.repoId,
      runId: request.runId,
      runtimePolicyDigest,
      schemaVersion: 1,
      taskId: task.id,
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
    const implementerCard = this._routeCards.get(view.route.requested.harness);
    const reviewerCard = this._routeCards.get(request.route.harness);
    if (!implementerCard || !reviewerCard || view.route.requested.harness === request.route.harness
      || implementerCard.modelSelection?.family === reviewerCard.modelSelection?.family) {
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
    const task = this.driver.coordination.task(manifest.node?.taskId);
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

  async _buildView(current, observer, options = {}) {
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

    // VR6/VR7: an inconclusive verifier outcome is distinguished from a candidate-owned loss
    // and, while its exact checkpoint and approved Plan remain current, offers one retry.
    const verdictOutcome = result?.verdict?.outcome ?? null;
    const durableRetry = this.driver.coordination.runVerificationRetry?.(runId, node.key) ?? null;
    let retryProjection = null;
    if (verdictOutcome === 'inconclusive' && result?.checkpoint?.state === 'pinned') {
      let candidatePreserved = false;
      if (workerId && typeof this.driver.coordinator.inspectCheckpoint === 'function') {
        candidatePreserved = (await this.driver.coordinator.inspectCheckpoint(workerId)).state === 'pinned';
      }
      const attempt = durableRetry
        ? (durableRetry.status === 'pending' ? durableRetry.attempt : durableRetry.attempt + 1)
        : 1;
      const available = candidatePreserved && !runStop
        && projection.approval?.disposition === 'approved'
        && typeof this.driver.coordinator.retryVerification === 'function'
        && typeof this.driver.coordination.admitRunVerificationRetry === 'function'
        && (!durableRetry || ['pending', 'inconclusive', 'cancelled'].includes(durableRetry.status));
      retryProjection = {
        available, attempt, checkpointSha: result.checkpoint.sha, candidatePreserved,
      };
    }
    const terminalCause = projectTypedTerminalCause({ terminalResult: result, runStop });

    const workers = this.driver.coordinator.list()
      .filter((handle) => this.driver.coordination.task(handle.taskId)?.runId === runId);
    const ownedWorker = workerId ? workers.find((handle) => handle.id === workerId) ?? null : null;
    const requested = {
      harness: current.plan.nodes[0].routes.harnesses[0],
      model: current.plan.nodes[0].routes.models[0],
      effort: current.plan.nodes[0].routes.efforts[0],
    };
    const route = projectRunRouteEvidence({ requested, liveHandle: ownedWorker, terminalResult: result, phase });
    const { resolved, observed, launchEnforcement, providerAttestation } = route;
    const story = this.driver.story.snapshot();
    const handlesById = new Map(workers.map((handle) => [handle.id, handle]));
    const runWorkerIds = new Set(workers.map((handle) => handle.id));
    if (runWorkerIds.size > MAX_RUN_VIEW_WORKERS) {
      throw applicationError('Run worker projection exceeds its bounded view ceiling', 'application_run_view_oversize');
    }
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
        risk: planNode.risk,
        budget: clone(planNode.budget),
        verification: clone(planNode.verification),
        route: requested,
        capabilities: clone(planNode.capabilities),
        effects: clone(planNode.effects),
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
      else if (integration && (current.profile.reviewPolicy.mode === 'none' || semanticReview.state === 'semantic_reviewed')) phase = 'completed';
      else phase = 'work_completed';
    }
    const canAdopt = resultSha && preservation?.state === 'pinned'
      && current.profile.resultPolicy.mode === 'manual' && adoptionState(adoption) !== 'adopted';
    const canReview = current.profile.reviewPolicy.mode === 'required' && semanticReview.state === 'semantics_unverified';
    const canIntegrate = current.profile.integrationPolicy.mode === 'manual'
      && semanticReview.state === 'semantic_reviewed'
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
              { kind: 'evidence' },
              ...exportActions,
              ...(canAdopt ? [{ kind: 'adopt_result', nodeKey: node.key, resultSha }] : [])]
              : [{ kind: 'status' }];
    const verificationState = ['work_completed', 'reviewing', 'completed'].includes(phase) ? 'mechanically_verified'
      : phase === 'failed' ? (retryProjection ? 'inconclusive' : 'failed') : 'pending';
    const resourcesSettled = workers.every((handle) => handle.worktree === null
      && handle.runtimeScope === null && (!handle.processRef || handle.processRef.state === 'closed'));
    const progress = runProgress({
      phase, approval: projection.approval, node,
      route,
      verification: { state: verificationState }, reviewPolicyMode: current.profile.reviewPolicy.mode, semanticReview,
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
      budget: { allocated: clone(current.goal.budget), node: clone(node.budget), termination: terminalCause },
      attention,
      attentionTruncated,
      verification: {
        state: verificationState,
        verdict: result?.verdict ? { accepted: ['work_completed', 'reviewing', 'completed'].includes(phase), digest: digest(result.verdict) } : null,
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
        : { workers: workers.length, workerIds: workers.map((handle) => handle.id).sort(), closed: false },
      evidence: artifacts.map(publicArtifact),
      narrative: terminalCauseNarrative(terminalCause) ?? (phase === 'stopped' ? 'Run stopped; its dispatch authority is closed and its exact stop receipt is attached.'
        : phase === 'stopping' ? 'Run stop is durably admitted and physical ownership is converging.'
          : runNarrative(story.workers, runWorkerIds)),
      lastAction: options.action ? clone(options.action) : null,
      recovery: options.recovery ? clone(options.recovery) : null,
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

  async wait(runId, rawObserver, options = {}) {
    this._assertOpen();
    exactObject(options, ['timeoutMs'], 'application_wait_invalid', 'wait options');
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 24 * 60 * 60 * 1000) {
      throw applicationError('wait timeout is invalid', 'application_wait_invalid');
    }
    const observer = normalizePrincipal(rawObserver, 'run observer');
    const deadline = Date.now() + options.timeoutMs;
    let view = await this.status(runId, observer);
    while (!PROVIDER_EXECUTION_SETTLED_PHASES.has(view.phase) && Date.now() < deadline) {
      await this.driver.coordinator.wait(Math.min(100, Math.max(1, deadline - Date.now())));
      view = await this.status(runId, observer);
    }
    return view;
  }

  _followCategory(event) {
    if (['goal.version_defined', 'plan.version_proposed', 'plan.approval_decided',
      'plan.node_dispatched', 'plan.node_budget_settled'].includes(event.kind)) return 'plan';
    if (['task.created', 'task.claimed', 'task.transitioned', 'task.acceptance_revoked'].includes(event.kind)) return 'execution';
    if (['artifact.registered', 'artifact.superseded', 'evidence.mapped'].includes(event.kind)) return 'evidence';
    if (event.kind.startsWith('run.result_')) return 'result';
    if (event.kind.startsWith('run.stop_')) return 'cleanup';
    if (event.kind === 'driver.recorded') {
      const driverKind = event.payload?.kind ?? '';
      if (driverKind.startsWith('integration.')) return 'integration';
      if (driverKind.startsWith('recovery.')) return 'recovery';
      if (driverKind.startsWith('verification.') || driverKind.startsWith('acceptance.')) return 'verification';
      if (driverKind.startsWith('result.')) return 'result';
      return 'execution';
    }
    return null;
  }

  _eventBelongsToRun(event, current) {
    const payload = event.payload ?? {};
    const runId = current.goal.runId;
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

  _followChange(event, category) {
    const summaries = {
      plan: 'Run Plan authority changed.',
      execution: 'Run execution state changed.',
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

  async follow(runId, rawObserver, options = {}) {
    this._assertOpen();
    await this.ready;
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

  _semanticActionId(current, view, principal, kind) {
    return digest({
      schemaVersion: 1,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      repoId: this.repoId,
      runId: current.goal.runId,
      principalScopeDigest: digest({ principalId: principal.principalId, sessionId: principal.sessionId }),
      profileDigest: current.profile.digest,
      planDigest: current.plan?.digest ?? null,
      viewDigest: digest(view),
      kind,
    });
  }

  _semanticActions(current, view, principal) {
    const kinds = [];
    if (view.phase === 'awaiting_plan_approval') kinds.push('approve_plan');
    for (const candidate of view.nextActions ?? []) {
      if (['adopt_result', 'semantic_review', 'integrate', 'export_result', 'retry_verification'].includes(candidate.kind)
        && !kinds.includes(candidate.kind)) kinds.push(candidate.kind);
    }
    if (!['stopped', 'closed'].includes(view.phase)) kinds.push('stop');
    return kinds.map((kind) => {
      const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
      const viewDigest = digest(view);
      const inputSchema = clone(definition.inputSchema);
      const source = (view.nextActions ?? []).find((candidate) => candidate.kind === kind) ?? null;
      if (kind === 'integrate' && source?.strategies) {
        inputSchema.properties.strategy.enum = clone(source.strategies);
      }
      return deepFreeze({
        actionId: this._semanticActionId(current, view, principal, kind),
        kind,
        label: definition.label,
        summary: definition.summary,
        inputSchema,
        serverDerived: clone(definition.serverDerived),
        effect: definition.effect,
        destructive: definition.destructive,
        irreversible: definition.irreversible,
        idempotent: definition.idempotent,
        priority: definition.priority,
        choices: kind === 'semantic_review' ? clone(source?.routes ?? [])
          : kind === 'integrate' ? clone(source?.strategies ?? []) : [],
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
      maxItems: current.profile.followPolicy.maxChanges,
      maxBytes: current.profile.followPolicy.maxResponseBytes,
      maxWaitMs: current.profile.followPolicy.maxWaitMs,
    });
  }

  _semanticEnvelope(current, view, request, change = {}) {
    const depth = request.depth;
    const terminal = APPLICATION_RUN_TERMINAL_PHASES.has(view.phase);
    const metadata = APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].continuation;
    const continuationArguments = { runId: current.goal.runId, depth };
    for (const argument of metadata.selectorArguments) {
      if (request[argument] !== undefined) continuationArguments[argument] = request[argument];
    }
    continuationArguments[metadata.cursorArgument] = view.cursor;
    continuationArguments[metadata.waitArgument] = current.profile.followPolicy.maxWaitMs;
    return {
      schemaVersion: 1,
      runId: current.goal.runId,
      depth,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      viewDigest: digest(view),
      cursor: view.cursor,
      changed: change.changed ?? false,
      timedOut: change.timedOut ?? false,
      terminal,
      bounds: this._semanticBounds(current),
      truncated: false,
      help: [{ topic: depth === 'outline' ? 'run.inspect' : `run.inspect.${depth}`, depth: 'outline' }],
      ...(terminal ? {} : { continuation: { operation: metadata.operation, arguments: continuationArguments } }),
    };
  }

  _semanticSectionItems(current, view, sectionId) {
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
          route: clone(node.routes?.[0] ?? null),
        },
      }));
    }
    if (sectionId === 'attention') {
      return (view.attention ?? []).map((entry, index) => ({
        id: `attention:${index + 1}:c${view.cursor}`, section: 'attention', state: entry.state,
        summary: entry.prompt || entry.kind || 'Run attention is required.',
      }));
    }
    const single = {
      execution: { state: view.phase, terminalCause: view.terminalCause ?? null },
      route: view.route,
      budget: view.budget,
      verification: view.verification,
      semantic_review: view.semanticReview,
      result: view.result,
      delivery: view.export ?? view.integration,
      cleanup: {
        state: view.stop?.state ?? (view.progress?.resources?.state ?? 'pending'),
        terminalCause: view.terminalCause ?? null,
      },
    }[sectionId];
    return single == null ? [] : [{
      id: `${sectionId}:summary:c${view.cursor}`, section: sectionId,
      state: single.state ?? view.phase, summary: `${sectionId.replaceAll('_', ' ')} state for this Run.`,
      value: clone(single),
    }];
  }

  async inspect(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    validateApplicationCommandArgs('run.inspect', rawRequest);
    const request = deepFreeze({ depth: 'outline', ...clone(rawRequest) });
    const principal = normalizePrincipal(rawPrincipal, 'inspection principal');
    const authorizationSubject = {
      depth: request.depth, section: request.section ?? null, item: request.item ?? null,
    };
    await this._authorize('run.status', principal, request.runId, authorizationSubject);
    const current = this._findRun(request.runId);
    const policy = current.profile.followPolicy;
    if (request.waitMs !== undefined && (policy.mode !== 'enabled' || request.waitMs > policy.maxWaitMs)) {
      throw applicationError('Run inspection wait exceeds deployment policy', 'application_inspect_policy_violation');
    }
    let view = await this._buildView(current, this.principals.observer);
    if (request.cursor !== undefined && request.cursor > view.cursor) {
      throw applicationError('Run inspection cursor is ahead of durable authority', 'application_inspect_cursor_ahead');
    }
    let relevantChange = false;
    let timedOut = false;
    if (request.cursor !== undefined && !APPLICATION_RUN_TERMINAL_PHASES.has(view.phase)) {
      const deadline = Date.now() + request.waitMs;
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
          view = await this._buildView(current, this.principals.observer);
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
    const changed = request.cursor !== undefined && relevantChange;
    const base = this._semanticEnvelope(current, view, request, {
      changed,
      timedOut: timedOut && !changed && !APPLICATION_RUN_TERMINAL_PHASES.has(view.phase),
    });
    if (request.depth === 'outline') {
      const attention = view.attention ?? [];
      const outline = {
        phase: view.phase,
        narrative: view.narrative,
        risk: view.planPreview?.risk ?? current.profile.risk,
        progress: clone(view.progress),
        attention: {
          count: attention.length,
          state: attention.length > 0 ? 'required' : 'clear',
          summary: attention.length > 0 ? 'Run attention is required; expand the attention section.' : 'No operator attention is pending.',
        },
        route: clone(view.route),
        terminalCause: clone(view.terminalCause ?? null),
        budget: clone(view.budget),
        resources: {
          state: view.progress?.resources?.state ?? 'pending',
          ownedCount: view.ownership?.workers ?? 0,
          cleanupState: view.stop?.state ?? (view.progress?.resources?.state ?? 'pending'),
          terminalCause: clone(view.terminalCause ?? null),
        },
        actions: this._semanticActions(current, view, principal),
      };
      const response = deepFreeze({
        ...base,
        expansions: [{ depth: 'index' }],
        outline,
      });
      if (Buffer.byteLength(JSON.stringify(response)) > base.bounds.maxBytes) {
        throw applicationError('Run outline exceeds deployment policy', 'application_inspect_oversize');
      }
      return response;
    }
    if (request.depth === 'index') {
      const sections = APPLICATION_SEMANTIC_REGISTRY.sections.map((definition) => {
        const items = this._semanticSectionItems(current, view, definition.id);
        return {
          id: definition.id,
          state: items[0]?.state ?? 'empty',
          summary: definition.summary,
          itemCount: items.length,
          truncated: items.length > base.bounds.maxItems,
          authorized: true,
          expand: { depth: 'section', section: definition.id },
        };
      });
      return deepFreeze({ ...base, expansions: sections.map((row) => row.expand), sections });
    }
    const sectionDefinition = APPLICATION_SEMANTIC_REGISTRY.sections.find((entry) => entry.id === request.section);
    if (!sectionDefinition) throw applicationError('Run inspection section is unavailable', 'application_inspect_section_invalid');
    const allItems = this._semanticSectionItems(current, view, request.section);
    const items = allItems.slice(0, base.bounds.maxItems);
    if (request.depth === 'section') {
      return deepFreeze({
        ...base,
        truncated: allItems.length > items.length,
        expansions: items.map((entry) => ({ depth: 'item', section: request.section, item: entry.id })),
        section: {
          id: request.section, state: items[0]?.state ?? 'empty', summary: sectionDefinition.summary,
          itemCount: allItems.length, truncated: allItems.length > items.length, items,
        },
      });
    }
    const selected = items.find((entry) => entry.id === request.item);
    if (!selected) throw applicationError('Run inspection item is unavailable', 'application_inspect_item_invalid');
    if (request.depth === 'item') {
      return deepFreeze({
        ...base,
        expansions: [{ depth: 'evidence', section: request.section, item: request.item }],
        item: selected,
      });
    }
    const evidence = [
      { kind: 'goal', digest: current.goal.digest, provenance: 'durable Goal authority' },
      ...(current.plan ? [{ kind: 'plan', digest: current.plan.digest, provenance: 'durable Plan authority' }] : []),
      ...(current.approval ? [{ kind: 'approval', digest: current.approval.digest, provenance: 'durable Plan approval authority' }] : []),
    ];
    return deepFreeze({ ...base, expansions: [], item: { id: selected.id, section: selected.section }, evidence });
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
    return deepFreeze({
      schemaVersion: 1,
      topic: request.topic,
      depth: request.depth,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      title: section ? `${section.id.replaceAll('_', ' ')} inspection` : request.topic,
      summary: section?.summary ?? 'Start or open a Run, inspect only the depth needed, then perform a currently offered action. For a nonterminal response, call its continuation descriptor to wait for the next relevant change; this is the preferred change-aware workflow.',
      examples: section && request.runId
        ? [{ operation: 'run.inspect', arguments: { runId: request.runId, depth: 'section', section: section.id } }]
        : [{ operation: 'run.inspect', arguments: { runId: 'RUN_ID', depth: 'outline' } }],
      links: [
        { topic: 'run.inspect', depth: 'outline' },
        { topic: 'run.act', depth: 'outline' },
        { topic: 'advanced', depth: 'outline' },
      ],
    });
  }

  async act(rawRequest, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    validateApplicationCommandArgs('run.act', rawRequest);
    const request = deepFreeze(clone(rawRequest));
    const principal = normalizePrincipal(rawPrincipal, 'action principal');
    await this._authorize('run.status', principal, request.runId, { operation: 'act' });
    const current = this._findRun(request.runId);
    const view = await this._buildView(current, this.principals.observer);
    const action = this._semanticActions(current, view, principal)
      .find((candidate) => candidate.actionId === request.actionId);
    if (!action) throw applicationError('Run action is outside the current authority scope', 'application_action_scope_mismatch');
    const supplied = Object.keys(request.inputs).sort();
    const allowed = Object.keys(action.inputSchema.properties).sort();
    const required = [...(action.inputSchema.required ?? [])].sort();
    if (supplied.some((field) => !allowed.includes(field)) || required.some((field) => !supplied.includes(field))) {
      throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
    }
    if (action.kind === 'approve_plan') {
      await this.approve(request.runId, current.plan.digest, principal);
    } else if (action.kind === 'adopt_result') {
      if (!validText(request.inputs.reason, 1_024)) {
        throw applicationError('Run action inputs are invalid', 'application_action_input_invalid');
      }
      const evidence = await this._buildEvidence(current);
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
      await this.integrate({
        runId: request.runId,
        evidenceDigest: evidence.manifestDigest,
        strategy: request.inputs.strategy,
        reason: request.inputs.reason,
      }, principal);
    } else if (action.kind === 'export_result') {
      const evidence = await this._buildEvidence(current);
      await this.export({ runId: request.runId, evidenceDigest: evidence.manifestDigest }, principal);
    } else if (action.kind === 'stop') {
      normalizeStop({ runId: request.runId, reason: request.inputs.reason });
      await this.stop(request.runId, request.inputs.reason, principal);
    } else {
      throw applicationError('Run action is unavailable', 'application_action_unavailable');
    }
    return this.inspect({ runId: request.runId, depth: 'outline' }, principal);
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
        resultPolicy: clone(profile.resultPolicy),
        reviewPolicy: clone(profile.reviewPolicy),
        integrationPolicy: clone(profile.integrationPolicy),
        followPolicy: clone(profile.followPolicy),
        exportPolicy: clone(profile.exportPolicy),
        recoveryPolicy: clone(profile.recoveryPolicy),
      })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    });
  }

  async command(name, args, rawPrincipal) {
    if (!validText(name, 64)) throw applicationError('application command is invalid', 'application_command_invalid');
    const principal = normalizePrincipal(rawPrincipal, 'command principal');
    validateApplicationCommandArgs(name, args);
    if (name === 'application.help') {
      return this.help(args, principal);
    }
    if (name === 'run.start') {
      return this.start(args.intent, principal);
    }
    if (name === 'run.inspect') {
      return this.inspect(args, principal);
    }
    if (name === 'run.act') {
      return this.act(args, principal);
    }
    if (name === 'run.status') {
      return this.status(args.runId, principal);
    }
    if (name === 'run.follow') {
      return this.follow(args.runId, principal, { afterCursor: args.afterCursor, timeoutMs: args.timeoutMs });
    }
    if (name === 'run.approve') {
      return this.approve(args.runId, args.planDigest, principal);
    }
    if (name === 'run.wait') {
      return this.wait(args.runId, principal, { timeoutMs: args.timeoutMs });
    }
    if (name === 'run.answer') {
      return this.answer(args.runId, args.requestId, args.answer, principal);
    }
    if (name === 'run.steer') {
      return this.steer(args, principal);
    }
    if (name === 'run.stop') {
      return this.stop(args.runId, args.reason, principal);
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

  async stop(runId, rawReason, rawPrincipal) {
    this._assertOpen();
    await this.ready;
    const request = normalizeStop({ runId, reason: rawReason });
    const principal = normalizePrincipal(rawPrincipal, 'stop principal');
    return this._withRunEffect(request.runId, () => this._stop(request, principal));
  }

  async _stop(request, principal) {
    await this._authorize('run.stop', principal, request.runId, { reasonDigest: digest(request.reason) });
    const current = this._findRun(request.runId);
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
    if (this.driver.coordinator.list().length !== 0) {
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
    for (const controller of this._followControllers) controller.abort();
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
