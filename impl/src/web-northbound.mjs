import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { WebEventStream } from './web-stream.mjs';
import { WebResultExportDelivery } from './web-result-export-delivery.mjs';
import { WebEdgePolicy, WebReadinessAuthority } from './web-edge.mjs';
import { OidcBrowserFlow, csrfCookie } from './web-oidc.mjs';
import { operatorAsset } from './web-operator.mjs';
import { northboundCapabilityToken } from './northbound-capability-authority.mjs';
import { sanitizeGoalPlanProjection } from './goal-plan.mjs';
import { APPLICATION_COMMAND_DEFINITIONS, validateApplicationCommandArgs } from './application.mjs';

const WEB_APPLICATION_ENTRIES = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.web)
  .map(([name, definition]) => [name.replaceAll('.', '_'), name, definition]);

const COMMAND_CAPABILITY = Object.freeze({
  spawn: 'control', scratch_oracle: 'control', send: 'control', interrupt: 'control', kill: 'emergency_stop', drain: 'emergency_stop', respond: 'approve',
  list: 'observe', result: 'observe', wait: 'observe', capabilities: 'observe', provider_status: 'observe', capability_invoke: 'control', reuse_decide: 'control', reuse_recheck: 'control',
  goal_define: 'goal:define', plan_propose: 'plan:propose', plan_approve: 'plan:approve', goal_plan_status: 'goal:observe',
  ...Object.fromEntries(WEB_APPLICATION_ENTRIES.map(([transport, , definition]) => [transport, definition.capabilities])),
});
const FENCE_REQUIRED = new Set(['send', 'interrupt', 'kill']);
const RECONCILABLE = new Set(['goal_define', 'plan_propose', 'plan_approve',
  ...WEB_APPLICATION_ENTRIES.filter(([, , definition]) => definition.reconcilable).map(([transport]) => transport)]);
const GOAL_PLAN_MUTATIONS = new Set(['goal_define', 'plan_propose', 'plan_approve']);
const TOP_LEVEL = new Set(['schemaVersion', 'commandId', 'idempotencyKey', 'command', 'args', 'repoId', 'runId', 'expectedFence', 'origin', 'clientObservedCursor']);
const ARG_FIELDS = Object.freeze({
  spawn: new Set(['harness', 'model', 'effort', 'modelPolicy', 'brief', 'taskId', 'deps', 'taskType', 'session', 'refines', 'goalPlan']),
  scratch_oracle: new Set(['scratchFactId', 'harness', 'model', 'effort', 'modelPolicy', 'verification', 'budget', 'constraints', 'goal', 'definitionOfDone', 'taskId']),
  send: new Set(['workerId', 'message', 'mode']),
  interrupt: new Set(['workerId', 'then']),
  kill: new Set(['workerId']),
  drain: new Set(),
  respond: new Set(['requestId', 'answer']),
  list: new Set(),
  result: new Set(['workerId']),
  wait: new Set(['timeoutMs']),
  capabilities: new Set(),
  provider_status: new Set(['providerId', 'after', 'limit']),
  capability_invoke: new Set(['name', 'op', 'action', 'args', 'budgetTokens', 'ref', 'cursor', 'claim', 'workerId', 'note']),
  reuse_decide: new Set(['need', 'choice', 'rationale', 'dossier', 'sbom', 'supersedes', 'budgetTokens']),
  reuse_recheck: new Set(['decisionId', 'expectedValidityVersion', 'trigger', 'budgetTokens']),
  goal_define: new Set(['objective', 'definitionOfDone', 'constraints', 'risk', 'budget', 'predecessor']),
  plan_propose: new Set(['goal', 'predecessor', 'nodes']),
  plan_approve: new Set(['goal', 'plan', 'expectedDisposition', 'disposition']),
  goal_plan_status: new Set(['goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'throughSeq']),
  ...Object.fromEntries(WEB_APPLICATION_ENTRIES.map(([transport, , definition]) => [transport, new Set(definition.args)])),
});
const APPLICATION_COMMAND = Object.freeze(Object.fromEntries(
  WEB_APPLICATION_ENTRIES.map(([transport, name]) => [transport, name]),
));
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization)$/i;
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const VERIFICATION_FIELDS = new Set(['command', 'expectExit', 'timeoutMs', 'coverageCommand', 'mutationCommand']);
const BUDGET_FIELDS = new Set(['tokens', 'usd', 'wallMin']);
const GOAL_PLAN_BUDGET_FIELDS = new Set(['tokens', 'usd', 'wallMin', 'providerTurns']);
const GOAL_REF_FIELDS = new Set(['goalId', 'version', 'digest']);
const PLAN_REF_FIELDS = new Set(['planId', 'version', 'digest']);
const PLAN_NODE_FIELDS = new Set(['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects']);
const PLAN_ROUTE_FIELDS = new Set(['harnesses', 'models', 'efforts']);
const PLAN_VERIFICATION_FIELDS = new Set(['command', 'arguments', 'cwd', 'envAllowlist', 'expectExit', 'expectResult', 'timeoutMs', 'maxOutputBytes', 'requiredPredecessorEvidence']);
const PLAN_GATE_FIELDS = new Set(['goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'nodeKey', 'expectedDispatchVersion', 'capabilities', 'effects']);
const PLAN_BRIEF_FIELDS = new Set(['goal', 'constraints', 'pathScope', 'tools', 'outputFormat', 'definitionOfDone', 'verification', 'budget', 'providerTurns', 'capabilities', 'effects']);
const AUTH_PATHS = new Set(['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout']);
const OIDC_START_PATH = '/v1/auth/oidc/start';
const OIDC_CALLBACK_PATH = '/v1/auth/oidc/callback';

function json(value) { return JSON.parse(JSON.stringify(value)); }
function transportCapability(value) {
  const copy = json(value);
  if (copy && typeof copy === 'object' && !Array.isArray(copy) && Array.isArray(copy.refs)) copy.refs = copy.refs.map(({ path: _path, ...ref }) => ref);
  return copy;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function tokenHash(value) { return createHash('sha256').update(value).digest('hex'); }
function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function actor(principal) { return `web:${principal.userId}:${principal.sessionId}`; }
function result(status, body) { return Object.freeze({ status, body: Object.freeze(body) }); }
function error(status, code, message = code) { return result(status, { ok: false, error: { code, message } }); }
function dispatchFailure(cause) {
  const goalPlanCode = cause?.code;
  if (goalPlanCode === 'application_unauthorized') return { httpStatus: 403, body: { ok: false, error: { code: goalPlanCode, message: 'application command forbidden' } } };
  if (goalPlanCode === 'application_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: goalPlanCode, message: 'run application unavailable' } } };
  if (['application_run_lookup_oversize', 'application_run_view_oversize'].includes(goalPlanCode)) return { httpStatus: 503, body: { ok: false, error: { code: 'temporarily_unavailable', message: 'run application projection unavailable' } } };
  if (['application_run_not_found', 'application_interaction_not_found', 'application_profile_not_found', 'application_worker_not_found'].includes(goalPlanCode)) return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'application resource not found' } } };
  if (typeof goalPlanCode === 'string' && goalPlanCode.startsWith('application_')) {
    const conflict = ['application_plan_stale', 'application_plan_denied', 'application_run_conflict', 'application_run_incomplete', 'application_profile_stale',
      'application_closed', 'application_detached'].includes(goalPlanCode);
    return { httpStatus: conflict ? 409 : 400, body: { ok: false, error: { code: goalPlanCode, message: conflict ? 'application state conflict' : 'application precondition failed' } } };
  }
  if (goalPlanCode === 'goal_plan_unauthorized') return { httpStatus: 403, body: { ok: false, error: { code: goalPlanCode, message: 'goal/plan authority forbidden' } } };
  if (goalPlanCode === 'goal_plan_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: goalPlanCode, message: 'goal/plan authority unavailable' } } };
  if (goalPlanCode === 'not_found' || goalPlanCode === 'plan_node_not_found') return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'resource not found' } } };
  if (['goal_plan_invalid', 'goal_plan_secret_rejected', 'goal_plan_status_invalid', 'goal_reference_invalid', 'plan_reference_invalid', 'goal_too_large',
    'plan_approval_invalid', 'plan_budget_exceeded', 'plan_cycle', 'plan_dangling_dependency', 'plan_duplicate_node',
    'plan_effect_invalid', 'plan_goal_mismatch', 'plan_node_invalid', 'plan_node_limit', 'plan_risk_mismatch', 'plan_scope_invalid',
    'plan_too_large', 'plan_verification_invalid', 'plan_dispatch_invalid'].includes(goalPlanCode)) {
    return { httpStatus: 400, body: { ok: false, error: { code: goalPlanCode, message: 'goal/plan precondition failed' } } };
  }
  if (['goal_conflict', 'goal_predecessor_required', 'goal_stale', 'goal_version_limit', 'goal_weakened',
    'plan_approval_conflict', 'plan_approval_expired', 'plan_approval_stale', 'plan_brief_mismatch', 'plan_conflict',
    'plan_dependency_incomplete', 'plan_dependency_mismatch', 'plan_dispatch_conflict', 'plan_dispatch_stale',
    'plan_effect_mismatch', 'plan_not_approved', 'plan_predecessor_required', 'plan_route_mismatch', 'plan_self_approval',
    'plan_stale', 'plan_version_limit', 'goal_plan_required'].includes(goalPlanCode)) {
    return { httpStatus: 409, body: { ok: false, error: { code: goalPlanCode, message: 'goal/plan state conflict' } } };
  }
  if (['ModelSelectionError', 'SessionSelectionError', 'DuplicateTaskIdError', 'UnknownVendorError', 'DependencyCycleError', 'TypeError'].includes(cause?.name)) {
    return { httpStatus: 400, body: { ok: false, error: { code: 'invalid_command', message: 'command precondition failed' } } };
  }
  if (cause?.code === 'capability_not_found') return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'resource not found' } } };
  if (['capability_op_unavailable', 'capability_resume_unavailable', 'capability_reverify_unavailable', 'capability_task_requires_task_plane', 'capability_args_invalid',
    'capability_resume_invalid', 'capability_reverify_invalid', 'capability_budget_invalid', 'capability_actor_invalid', 'capability_repo_invalid', 'capability_idempotency_invalid'].includes(cause?.code)) {
    return { httpStatus: 400, body: { ok: false, error: { code: 'invalid_command', message: 'command precondition failed' } } };
  }
  if (['capability_result_invalid', 'capability_result_oversize', 'capability_authority_forbidden', 'orientation_not_deliverable'].includes(cause?.code)) {
    return { httpStatus: 502, body: { ok: false, error: { code: 'capability_refused', message: 'capability result refused by policy' } } };
  }
  if (['invalid_proposal', 'invalid_sbom_path', 'proposal_context_required'].includes(cause?.code)) return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'proposal precondition failed' } } };
  if (['invalid_advisory_request', 'advisory_context_required', 'invalid_package_identity'].includes(cause?.code)) return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'advisory precondition failed' } } };
  if (['proposal_receipt_invalid', 'proposal_schema_invalid', 'proposal_policy_violation', 'proposal_network_violation', 'proposal_root_changed', 'proposal_coordinate_mismatch', 'proposal_oversize', 'proposal_timeout', 'proposal_resolver_failed', 'proposal_cleanup_failed', 'proposal_supervisor_busy', 'proposal_reconcile_failed', 'sbom_schema_invalid', 'sbom_oversize', 'sbom_source_changed', 'sbom_unavailable', 'artifact_integrity'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'provenance evidence refused' } } };
  if (['advisory_plan_diverged', 'advisory_policy_changed', 'advisory_scan_coordinate_mismatch', 'advisory_scan_schema_invalid', 'advisory_scan_incomplete', 'advisory_source_changed', 'advisory_atlas_integrity', 'advisory_projection_oversize', 'oracle_response_oversize', 'oracle_schema_invalid', 'oracle_coordinate_mismatch', 'oracle_incomplete', 'oracle_source_integrity', 'oracle_clock_invalid'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'advisory evidence refused' } } };
  if (['oracle_unavailable', 'oracle_timeout'].includes(cause?.code)) return { httpStatus: 503, body: { ok: false, error: { code: cause.code, message: 'advisory source unavailable' } } };
  if (cause?.code === 'cancelled') return { httpStatus: 409, body: { ok: false, error: { code: 'cancelled', message: 'capability invocation cancelled' } } };
  if (['scratch_oracle_invalid', 'scratch_oracle_target_ineligible', 'scratch_oracle_route_unavailable', 'scratch_oracle_not_independent', 'scratch_oracle_oversize', 'explicit_vendor_required', 'verification_required'].includes(cause?.code)) return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'Scratch oracle precondition failed' } } };
  if (cause?.code === 'scratch_oracle_forbidden') return { httpStatus: 403, body: { ok: false, error: { code: cause.code, message: 'Scratch oracle authority forbidden' } } };
  if (cause?.code === 'scratch_oracle_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: cause.code, message: 'Scratch oracle unavailable' } } };
  if (cause?.code === 'scratch_oracle_integrity') return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'Scratch oracle evidence refused' } } };
  if (['run_sealed', 'run_not_terminal', 'run_membership_changed', 'run_prefix_changed'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'run state conflict' } } };
  if (['invalid_run_id', 'run_not_found'].includes(cause?.code)) return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'run precondition failed' } } };
  if (['causal_request_invalid', 'causal_context_invalid', 'causal_audit_invalid', 'causal_trace_invalid', 'causal_recall_invalid', 'causal_promotion_invalid', 'causal_correction_invalid', 'causal_contradiction_invalid'].includes(cause?.code)) return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'causal operation precondition failed' } } };
  if (['causal_repo_mismatch', 'causal_promotion_forbidden', 'causal_correction_forbidden', 'causal_contradiction_forbidden'].includes(cause?.code)) return { httpStatus: 403, body: { ok: false, error: { code: cause.code, message: 'causal repository authority forbidden' } } };
  if (['causal_audit_oversize', 'causal_trace_oversize', 'causal_audit_integrity', 'causal_recall_oversize', 'causal_recall_audit_failed', 'knowledge_recall_conflict', 'knowledge_recall_integrity', 'causal_promotion_oversize', 'causal_promotion_audit_failed', 'causal_promotion_conflict', 'causal_promotion_integrity', 'causal_correction_oversize', 'causal_correction_conflict', 'causal_correction_integrity', 'causal_contradiction_oversize', 'causal_contradiction_audit_failed', 'causal_contradiction_conflict', 'causal_contradiction_integrity', 'unresolved_contradiction'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'causal evidence refused' } } };
  if (['invalid_reuse_decision', 'reuse_evidence_invalid'].includes(cause?.code)) return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'reuse decision precondition failed' } } };
  if (['reuse_decision_forbidden', 'reuse_repo_mismatch'].includes(cause?.code)) return { httpStatus: 403, body: { ok: false, error: { code: cause.code, message: 'reuse decision authority forbidden' } } };
  if (['reuse_decision_conflict', 'reuse_decision_exists', 'reuse_borrow_blocked', 'reuse_evidence_diverged', 'reuse_evidence_stale', 'reuse_environment_mismatch', 'reuse_tree_dirty', 'reuse_namespace_conflict', 'stale_version'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'reuse decision conflict' } } };
  if (cause?.code === 'invalid_reuse_recheck') return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'reuse recheck precondition failed' } } };
  if (cause?.code === 'reuse_recheck_forbidden') return { httpStatus: 403, body: { ok: false, error: { code: cause.code, message: 'reuse recheck authority forbidden' } } };
  if (['reuse_risk_conflict', 'reuse_ttl_conflict', 'reuse_risk_guarded', 'reuse_risk_stale', 'reuse_not_expired', 'reuse_decision_not_found'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'reuse recheck conflict' } } };
  if (cause?.code === 'reuse_recheck_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: cause.code, message: 'reuse recheck unavailable' } } };
  if (cause?.code === 'reuse_decision_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: cause.code, message: 'reuse decision unavailable' } } };
  if (cause?.code === 'provider_read_invalid') return { httpStatus: 400, body: { ok: false, error: { code: cause.code, message: 'provider read precondition failed' } } };
  if (cause?.code === 'provider_read_oversize') return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'provider read exceeded deployment ceiling' } } };
  if (cause?.code === 'provider_read_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: cause.code, message: 'provider read unavailable' } } };
  if (cause?.name === 'WorkerNotFoundError') return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'resource not found' } } };
  if (['coordinator_drain_capacity', 'coordinator_drain_incomplete', 'coordinator_draining', 'coordinator_closed'].includes(cause?.code)) return { httpStatus: 409, body: { ok: false, error: { code: cause.code, message: 'coordinator lifecycle conflict' } } };
  return { httpStatus: 503, body: { ok: false, error: { code: 'temporarily_unavailable', message: 'command dispatch failed' } } };
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function containsForbiddenKey(value) {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(child));
}
function string(value) { return typeof value === 'string' && value.length > 0; }
function exactRecord(value, fields) {
  return isRecord(value) && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}
function stringList(value) {
  return Array.isArray(value) && value.every(string) && new Set(value).size === value.length;
}
function goalPlanBudget(value) {
  return exactRecord(value, GOAL_PLAN_BUDGET_FIELDS)
    && Number.isSafeInteger(value.tokens) && value.tokens > 0
    && Number.isFinite(value.usd) && value.usd >= 0
    && Number.isSafeInteger(value.wallMin) && value.wallMin > 0
    && Number.isSafeInteger(value.providerTurns) && value.providerTurns > 0;
}
function goalPlanRef(value, kind) {
  const fields = kind === 'goal' ? GOAL_REF_FIELDS : PLAN_REF_FIELDS;
  const id = value?.[`${kind}Id`];
  return exactRecord(value, fields) && new RegExp(`^${kind}:[a-f0-9]{64}$`).test(id ?? '')
    && Number.isSafeInteger(value.version) && value.version > 0 && /^[a-f0-9]{64}$/.test(value.digest ?? '');
}
function planVerification(value) {
  return exactRecord(value, PLAN_VERIFICATION_FIELDS) && string(value.command)
    && Array.isArray(value.arguments) && value.arguments.every((argument) => typeof argument === 'string')
    && string(value.cwd) && stringList(value.envAllowlist) && value.expectResult === 'exit_code'
    && Number.isSafeInteger(value.expectExit) && value.expectExit >= 0 && value.expectExit <= 255
    && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0
    && Number.isSafeInteger(value.maxOutputBytes) && value.maxOutputBytes > 0
    && stringList(value.requiredPredecessorEvidence);
}
function planNode(value) {
  return exactRecord(value, PLAN_NODE_FIELDS) && string(value.key) && string(value.objective)
    && stringList(value.definitionOfDone) && stringList(value.deps) && stringList(value.pathScope)
    && string(value.risk) && goalPlanBudget(value.budget) && planVerification(value.verification)
    && value.pathScope.length > 0
    && exactRecord(value.routes, PLAN_ROUTE_FIELDS) && stringList(value.routes.harnesses) && value.routes.harnesses.length > 0
    && stringList(value.routes.models) && value.routes.models.length > 0
    && stringList(value.routes.efforts) && value.routes.efforts.length > 0
    && stringList(value.capabilities) && stringList(value.effects);
}
function planGate(value) {
  return exactRecord(value, PLAN_GATE_FIELDS)
    && /^goal:[a-f0-9]{64}$/.test(value.goalId ?? '') && Number.isSafeInteger(value.goalVersion) && value.goalVersion > 0
    && /^[a-f0-9]{64}$/.test(value.goalDigest ?? '')
    && /^plan:[a-f0-9]{64}$/.test(value.planId ?? '') && Number.isSafeInteger(value.planVersion) && value.planVersion > 0
    && /^[a-f0-9]{64}$/.test(value.planDigest ?? '') && string(value.nodeKey)
    && value.expectedDispatchVersion === 0
    && stringList(value.capabilities) && stringList(value.effects);
}
function planBrief(value) {
  return exactRecord(value, PLAN_BRIEF_FIELDS) && string(value.goal)
    && stringList(value.constraints) && stringList(value.pathScope) && stringList(value.tools)
    && typeof value.outputFormat === 'string' && typeof value.definitionOfDone === 'string'
    && planVerification(value.verification) && exactRecord(value.budget, BUDGET_FIELDS)
    && Number.isSafeInteger(value.budget.tokens) && value.budget.tokens > 0
    && Number.isFinite(value.budget.usd) && value.budget.usd >= 0
    && Number.isSafeInteger(value.budget.wallMin) && value.budget.wallMin > 0
    && Number.isSafeInteger(value.providerTurns) && value.providerTurns > 0
    && stringList(value.capabilities) && stringList(value.effects);
}
function validProviderClaims(value) {
  if (!isRecord(value)) return false;
  const allowed = new Set(['userId', 'authMethod', 'capabilities', 'repoIds', 'ttlMs']);
  return !Object.keys(value).some((key) => !allowed.has(key))
    && string(value.userId) && ['cookie', 'bearer'].includes(value.authMethod)
    && Array.isArray(value.capabilities) && value.capabilities.length > 0 && value.capabilities.every(string)
    && Array.isArray(value.repoIds) && value.repoIds.length > 0 && value.repoIds.every(string)
    && Number.isSafeInteger(value.ttlMs) && value.ttlMs > 0;
}

function validateEnvelope(envelope) {
  if (!isRecord(envelope)) return 'command envelope must be an object';
  const unknown = Object.keys(envelope).find((key) => !TOP_LEVEL.has(key));
  if (unknown) return 'unknown_top_level_field';
  if (envelope.schemaVersion !== 1) return 'unsupported schemaVersion';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.commandId ?? '')
    || !/^[A-Za-z0-9._:-]{1,256}$/.test(envelope.idempotencyKey ?? '')
    || !string(envelope.command) || !string(envelope.repoId) || !string(envelope.origin)) return 'command identity, idempotencyKey, repoId, and origin are required';
  if (!Object.hasOwn(COMMAND_CAPABILITY, envelope.command)) return 'unsupported command';
  if (Object.hasOwn(envelope, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(envelope.runId ?? '')) return 'invalid_run_id';
  if (!isRecord(envelope.args)) return 'args must be an object';
  const allowed = ARG_FIELDS[envelope.command];
  const unknownArg = Object.keys(envelope.args).find((key) => !allowed.has(key));
  if (unknownArg) return 'unknown_argument_field';
  if (containsForbiddenKey(envelope.args)) return 'credential-bearing command fields are forbidden';
  if (APPLICATION_COMMAND[envelope.command]) {
    try { validateApplicationCommandArgs(APPLICATION_COMMAND[envelope.command], envelope.args); }
    catch { return 'application_command_arguments_invalid'; }
    if (envelope.command === 'run_wait' && envelope.args.timeoutMs > 30_000) return 'application_wait_timeout_exceeds_web_ceiling';
    if (Object.hasOwn(envelope, 'expectedFence')) return 'application_command_does_not_accept_fence';
    const applicationRunId = envelope.command === 'run_start'
      ? envelope.args.intent.runId ?? null
      : envelope.args.runId;
    if (Object.hasOwn(envelope, 'runId') && envelope.runId !== applicationRunId) {
      return 'application_run_id_mismatch';
    }
  }
  if (FENCE_REQUIRED.has(envelope.command) && !Number.isInteger(envelope.expectedFence)) return `${envelope.command} requires expectedFence`;
  if (envelope.command === 'spawn') {
    if (!string(envelope.args.harness) || !isRecord(envelope.args.brief)) return 'spawn requires harness and brief';
    if (Object.hasOwn(envelope.args, 'model') && !string(envelope.args.model)) return 'model must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'effort') && !string(envelope.args.effort)) return 'effort must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'modelPolicy') && !isRecord(envelope.args.modelPolicy)) return 'modelPolicy must be an object';
    if (isRecord(envelope.args.modelPolicy)) {
      const unknownPolicy = Object.keys(envelope.args.modelPolicy).find((key) => !MODEL_POLICY_FIELDS.has(key));
      if (unknownPolicy) return 'unknown_model_policy_field';
    }
    if (Object.hasOwn(envelope.args, 'goalPlan') && (!planGate(envelope.args.goalPlan) || !planBrief(envelope.args.brief))) return 'plan-gated spawn fields are invalid';
  }
  if (envelope.command === 'goal_define') {
    if (!exactRecord(envelope.args, ARG_FIELDS.goal_define) || !string(envelope.args.objective)
      || !stringList(envelope.args.definitionOfDone) || envelope.args.definitionOfDone.length === 0
      || !stringList(envelope.args.constraints) || !string(envelope.args.risk) || !goalPlanBudget(envelope.args.budget)
      || !(envelope.args.predecessor === null || goalPlanRef(envelope.args.predecessor, 'goal'))) return 'goal_define requires one closed goal version';
  }
  if (envelope.command === 'plan_propose') {
    if (!exactRecord(envelope.args, ARG_FIELDS.plan_propose) || !goalPlanRef(envelope.args.goal, 'goal')
      || !(envelope.args.predecessor === null || goalPlanRef(envelope.args.predecessor, 'plan'))
      || !Array.isArray(envelope.args.nodes) || envelope.args.nodes.length === 0 || !envelope.args.nodes.every(planNode)) return 'plan_propose requires one closed plan DAG';
  }
  if (envelope.command === 'plan_approve') {
    if (!exactRecord(envelope.args, ARG_FIELDS.plan_approve) || !goalPlanRef(envelope.args.goal, 'goal')
      || !goalPlanRef(envelope.args.plan, 'plan') || envelope.args.expectedDisposition !== null
      || !['approved', 'rejected'].includes(envelope.args.disposition)) return 'plan_approve requires exact undecided goal and plan coordinates';
  }
  if (envelope.command === 'goal_plan_status') {
    if (!exactRecord(envelope.args, ARG_FIELDS.goal_plan_status) || !/^goal:[a-f0-9]{64}$/.test(envelope.args.goalId ?? '')
      || !Number.isSafeInteger(envelope.args.goalVersion) || envelope.args.goalVersion <= 0 || !/^[a-f0-9]{64}$/.test(envelope.args.goalDigest ?? '')
      || !/^plan:[a-f0-9]{64}$/.test(envelope.args.planId ?? '')
      || !Number.isSafeInteger(envelope.args.planVersion) || envelope.args.planVersion <= 0 || !/^[a-f0-9]{64}$/.test(envelope.args.planDigest ?? '')
      || !(envelope.args.throughSeq === null || (Number.isSafeInteger(envelope.args.throughSeq) && envelope.args.throughSeq >= 0))) return 'goal_plan_status requires exact bounded coordinates';
  }
  if (envelope.command === 'scratch_oracle') {
    if (!string(envelope.args.scratchFactId) || !string(envelope.args.harness) || !isRecord(envelope.args.verification)
      || !string(envelope.args.verification.command) || typeof envelope.args.verification.expectExit !== 'number'
      || Object.keys(envelope.args.verification).some((key) => !VERIFICATION_FIELDS.has(key))) return 'scratch_oracle requires fact, explicit harness, and pinned verification';
    if (Object.hasOwn(envelope.args, 'model') && !string(envelope.args.model)) return 'model must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'effort') && !string(envelope.args.effort)) return 'effort must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'modelPolicy') && (!isRecord(envelope.args.modelPolicy) || Object.keys(envelope.args.modelPolicy).some((key) => !MODEL_POLICY_FIELDS.has(key)))) return 'modelPolicy must be a closed object';
    if (Object.hasOwn(envelope.args, 'budget') && (!isRecord(envelope.args.budget) || Object.keys(envelope.args.budget).some((key) => !BUDGET_FIELDS.has(key)))) return 'budget must be a closed object';
    if (Object.hasOwn(envelope.args, 'constraints') && (!Array.isArray(envelope.args.constraints) || !envelope.args.constraints.every(string))) return 'constraints must be non-empty strings';
  }
  if (['send', 'interrupt', 'kill', 'result'].includes(envelope.command) && !string(envelope.args.workerId)) return `${envelope.command} requires workerId`;
  if (envelope.command === 'provider_status' && ((Object.hasOwn(envelope.args, 'providerId') && !/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.args.providerId ?? ''))
    || (Object.hasOwn(envelope.args, 'after') && !/^provider-processing:[a-f0-9]{64}$/.test(envelope.args.after ?? ''))
    || (Object.hasOwn(envelope.args, 'limit') && (!Number.isSafeInteger(envelope.args.limit) || envelope.args.limit <= 0)))) return 'provider_status requires bounded provider, cursor, and limit';
  if (envelope.command === 'send' && (!string(envelope.args.message) || !['turn', 'steer', 'nudge'].includes(envelope.args.mode))) return 'send requires message and a valid mode';
  if (envelope.command === 'respond' && (!string(envelope.args.requestId) || !Object.hasOwn(envelope.args, 'answer'))) return 'respond requires requestId and answer';
  if (envelope.command === 'reuse_decide' && (!string(envelope.args.need) || !['borrow', 'build'].includes(envelope.args.choice)
    || !string(envelope.args.rationale) || !isRecord(envelope.args.dossier) || !isRecord(envelope.args.sbom)
    || !Number.isSafeInteger(envelope.args.budgetTokens) || envelope.args.budgetTokens <= 0
    || Object.keys(envelope.args.dossier ?? {}).some((key) => !['claim', 'args'].includes(key)) || Object.keys(envelope.args.sbom ?? {}).some((key) => !['claim', 'args'].includes(key))
    || (Object.hasOwn(envelope.args, 'supersedes') && (!isRecord(envelope.args.supersedes)
      || Object.keys(envelope.args.supersedes).some((key) => !['decisionId', 'expectedValidityVersion'].includes(key))
      || !string(envelope.args.supersedes.decisionId) || !Number.isSafeInteger(envelope.args.supersedes.expectedValidityVersion) || envelope.args.supersedes.expectedValidityVersion <= 0)))) return 'reuse_decide requires bounded decision and exact evidence inputs';
  if (envelope.command === 'reuse_recheck' && (!string(envelope.args.decisionId)
    || !Number.isSafeInteger(envelope.args.expectedValidityVersion) || envelope.args.expectedValidityVersion <= 0
    || !['advisory_refresh', 'ttl_expired'].includes(envelope.args.trigger)
    || !Number.isSafeInteger(envelope.args.budgetTokens) || envelope.args.budgetTokens <= 0)) return 'reuse_recheck requires an exact decision, trigger, version, and budget';
  if (envelope.command === 'capability_invoke') {
    if (!Object.hasOwn(envelope.args, 'action')) return 'capability_invoke requires an explicit action';
    const action = envelope.args.action;
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.args.name ?? '')
      || typeof envelope.args.op !== 'string' || envelope.args.op.length === 0 || envelope.args.op.length > 256) return 'capability_invoke requires a valid name and op';
    if (!['invoke', 'resume', 'reverify', 'push'].includes(action)) return 'capability_invoke requires a valid action';
    if (!Number.isSafeInteger(envelope.args.budgetTokens) || envelope.args.budgetTokens <= 0) return 'capability_invoke requires a positive budgetTokens';
    if (action === 'invoke') {
      if (!isRecord(envelope.args.args)) return 'capability invoke requires args';
      if (['ref', 'cursor', 'claim', 'workerId', 'note'].some((key) => Object.hasOwn(envelope.args, key))) return 'capability invoke received action-inapplicable fields';
    }
    if (action === 'resume') {
      if (!isRecord(envelope.args.ref) || !string(envelope.args.cursor) || envelope.args.cursor.length > 4_096) return 'capability resume requires ref and cursor';
      if (['args', 'claim', 'workerId', 'note'].some((key) => Object.hasOwn(envelope.args, key))) return 'capability resume received action-inapplicable fields';
    }
    if (action === 'reverify') {
      if (!isRecord(envelope.args.claim) || !isRecord(envelope.args.args)) return 'capability reverify requires claim and args';
      if (['ref', 'cursor', 'workerId', 'note'].some((key) => Object.hasOwn(envelope.args, key))) return 'capability reverify received action-inapplicable fields';
    }
    if (action === 'push') {
      if (envelope.args.name !== 'cartographer-quartermaster' || envelope.args.op !== 'orientation.slice'
        || !isRecord(envelope.args.args) || !string(envelope.args.workerId) || !string(envelope.args.note)
        || Buffer.byteLength(envelope.args.note) > 2_048 || !Number.isSafeInteger(envelope.expectedFence)) return 'capability push requires exact orientation target, worker, note, args, and expectedFence';
      if (Object.hasOwn(envelope.args, 'ref') || Object.hasOwn(envelope.args, 'cursor') || Object.hasOwn(envelope.args, 'claim')) return 'capability push received action-inapplicable fields';
    }
  }
  return null;
}

function canonicalRequest(envelope) {
  const { commandId: _commandId, clientObservedCursor: _cursor, ...semantic } = envelope;
  return semantic;
}

function admittedRunId(envelope) {
  if (!APPLICATION_COMMAND[envelope.command]) return envelope.runId ?? null;
  if (envelope.command === 'run_start') return envelope.args.intent.runId ?? null;
  return envelope.args.runId;
}

export class WebNorthbound {
  constructor(opts) {
    if (!opts?.coordinator || !opts?.coordination) throw new TypeError('web northbound requires coordinator and coordination authority');
    for (const method of ['admitWebCommand', 'completeWebCommand', 'failWebCommand', 'recordWebAudit', 'webCommand']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`coordination authority is missing ${method}()`);
    }
    this.coordinator = opts.coordinator;
    this.coordination = opts.coordination;
    this.application = opts.application ?? null;
    if (this.application !== null && (typeof this.application.command !== 'function' || typeof this.application.card !== 'function'
      || typeof this.application.authorizeReplay !== 'function')) {
      throw new TypeError('web application facade is invalid');
    }
    this.allowedOrigins = new Set(opts.allowedOrigins ?? []);
    this.repoIds = new Set(opts.repoIds ?? []);
    if (this.repoIds.size > 1) throw new TypeError('one web northbound authority may serve at most one repository');
    if (this.application !== null) {
      const [servedRepoId] = this.repoIds;
      const applicationCard = this.application.card();
      if (this.repoIds.size !== 1 || this.application.repoId !== servedRepoId
        || applicationCard?.repoId !== servedRepoId || !Array.isArray(applicationCard.commands)
        || WEB_APPLICATION_ENTRIES.some(([, name]) => !applicationCard.commands.includes(name))) {
        throw new TypeError('web application facade does not match the served repository or command contract');
      }
    }
    this.now = opts.now ?? Date.now;
    this.authenticate = opts.authenticate ?? null;
    this.sessions = opts.sessions ?? opts.sessionStore ?? null;
    this.identityProvider = opts.identityProvider ?? opts.provider ?? null;
    this.oidc = opts.oidc ?? opts.oidcFlow ?? null;
    if (this.oidc !== null && !(this.oidc instanceof OidcBrowserFlow)) throw new TypeError('oidc must be an OidcBrowserFlow');
    if (this.oidc && (!this.allowedOrigins.has(this.oidc.redirectUri.origin)
      || this.oidc.redirectUri.pathname !== OIDC_CALLBACK_PATH)) {
      throw new TypeError('OIDC redirectUri must match the served allowed origin and callback path');
    }
    if (!this.authenticate && this.sessions) this.authenticate = this.sessions.authenticator();
    this.isPrincipalActive = opts.isPrincipalActive ?? this.authenticate?.isPrincipalActive ?? null;
    this.exportDelivery = opts.exportDelivery ?? (this.application?.exportRoot ? new WebResultExportDelivery({
      coordination: this.coordination,
      allowedOrigins: [...this.allowedOrigins],
      repoIds: [...this.repoIds],
      now: this.now,
      ticketTtlMs: opts.exportTicketTtlMs,
      maxTickets: opts.maxExportTickets,
      isPrincipalActive: this.isPrincipalActive ?? (() => true),
      authorizeExport: (candidate, coordinates) => this.application.authorizeResultExportDelivery(coordinates, {
        actor: actor(candidate), principalId: candidate.userId, sessionId: candidate.sessionId,
      }),
      resolveCompletedExport: (coordinates) => this.application.resolveCompletedResultExport(coordinates),
      openArchive: (coordinates) => this.application.openResultExportArchive(coordinates),
      registerDelivery: (registration) => this.application.registerResultExportDelivery(registration),
    }) : null);
    if (this.exportDelivery !== null && (typeof this.exportDelivery.authorizeIssue !== 'function'
      || typeof this.exportDelivery.issue !== 'function' || typeof this.exportDelivery.open !== 'function')) {
      throw new TypeError('web result export delivery authority is invalid');
    }
    this.maxBodyBytes = opts.maxBodyBytes ?? 64 * 1024;
    this._drainDispatches = new Map();
    this._applicationDispatches = new Map();
    this.edge = opts.edge ?? (opts.edgePolicy ? new WebEdgePolicy(opts.edgePolicy) : null);
    this.admitting = true;
    this.readinessChecks = opts.readinessChecks ?? [];
    this.readinessAuthority = opts.readinessAuthority ?? (this.sessions && this.authenticate?.isPrincipalActive
      ? new WebReadinessAuthority({ coordination: this.coordination, sessions: this.sessions, authenticate: this.authenticate, checks: this.readinessChecks }) : null);
    this.stream = opts.stream ?? new WebEventStream({
      ...opts, coordination: this.coordination,
      allowedOrigins: [...this.allowedOrigins], repoIds: [...this.repoIds],
      isPrincipalActive: this.isPrincipalActive,
      acquireConnection: this.edge ? (principal) => this.edge.acquireConnection(principal.credentialId) : null,
      releaseConnection: this.edge ? (principal) => this.edge.releaseConnection(principal.credentialId) : null,
      credentialDigest: this.edge ? (credentialId) => this.edge.digest(`credential:${credentialId}`) : null,
    });
  }

  _audit(kind, ctx, details = {}) {
    const principal = ctx?.principal;
    const auditActor = principal ? actor(principal) : 'web:anonymous';
    return this.coordination.recordWebAudit({
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialDigest: principal?.credentialId && this.edge ? this.edge.digest(`credential:${principal.credentialId}`) : null,
      originClass: ctx?.origin == null ? 'missing' : this.allowedOrigins.has(ctx.origin) ? 'allowed' : 'disallowed',
      remoteAddressClass: ctx?.remoteAddress ? 'present' : 'absent', addressDigest: ctx?.addressDigest ?? null, ...json(details),
    }, { actor: auditActor, key: `web.audit:${randomUUID()}` });
  }

  _authenticate(ctx) {
    const principal = ctx?.principal;
    if (!principal || !string(principal.userId) || !string(principal.sessionId) || !string(principal.credentialId)) return error(401, 'unauthenticated');
    const expiresAt = Date.parse(principal.expiresAt);
    if (principal.revoked === true || !string(principal.expiresAt) || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return error(401, 'unauthenticated');
    if (ctx.transport !== 'https') return error(503, 'temporarily_unavailable', 'secure transport required');
    return null;
  }

  _isReady() {
    if (!this.admitting || (this.edge && !this.edge.admitting)) return false;
    try {
      return this.readinessAuthority?.check() === true;
    } catch { return false; }
  }

  _readinessResponse(ctx) {
    const ready = this._isReady();
    try {
      this._audit('readiness_probe', ctx, { ready });
      if (this._lastReady !== ready) {
        this._audit('readiness_transition', ctx, { ready });
        this._lastReady = ready;
      }
    } catch { return result(503, { ready: false }); }
    return ready ? result(200, { ready: true }) : result(503, { ready: false });
  }

  _admissionOpen() { return this.admitting && (!this.edge || this.edge.admitting); }

  _authorize(ctx, envelope) {
    const principal = ctx.principal;
    if (!this.allowedOrigins.has(ctx.origin) || envelope.origin !== ctx.origin) return error(403, 'forbidden');
    if (principal.authMethod === 'cookie') {
      const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
        ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
        : ctx.csrfToken === principal.csrfToken);
      if (!csrfValid) return error(403, 'forbidden');
    }
    if (!this.repoIds.has(envelope.repoId) || !Array.isArray(principal.repoIds) || !principal.repoIds.includes(envelope.repoId)) return error(403, 'forbidden');
    if (this.isPrincipalActive && !this.isPrincipalActive(principal, { repoId: envelope.repoId })) return error(401, 'unauthenticated');
    const requiredCapabilities = Array.isArray(COMMAND_CAPABILITY[envelope.command])
      ? COMMAND_CAPABILITY[envelope.command]
      : [COMMAND_CAPABILITY[envelope.command]];
    if (!Array.isArray(principal.capabilities)
      || !requiredCapabilities.every((capability) => principal.capabilities.includes(capability))) return error(403, 'forbidden');
    return null;
  }

  _postWaitAuthorization(ctx, envelope) {
    if (!['run_follow', 'run_wait'].includes(envelope.command)) return null;
    return this._authenticate(ctx) ?? this._authorize(ctx, envelope);
  }

  async execute(ctx, envelope) {
    if (!this._admissionOpen()) return error(503, 'temporarily_unavailable');
    const authFailure = this._authenticate(ctx);
    if (authFailure) {
      try { this._audit('authentication_refused', ctx); } catch { return error(503, 'temporarily_unavailable'); }
      return authFailure;
    }
    const validation = validateEnvelope(envelope);
    if (validation) {
      try { this._audit('command_invalid', ctx, { reason: validation }); } catch { return error(503, 'temporarily_unavailable'); }
      return error(400, 'invalid_command', validation);
    }
    const authorizationFailure = this._authorize(ctx, envelope);
    if (authorizationFailure) {
      try { this._audit('authorization_refused', ctx, { command: envelope.command, repoId: envelope.repoId }); } catch { return error(503, 'temporarily_unavailable'); }
      return authorizationFailure;
    }
    if (APPLICATION_COMMAND[envelope.command] && !this.application) {
      try { this._audit('application_unavailable', ctx, { command: envelope.command, repoId: envelope.repoId }); }
      catch { return error(503, 'temporarily_unavailable'); }
      return error(503, 'application_unavailable', 'run application unavailable');
    }
    if (this.edge) {
      const key = ctx.principal.credentialId;
      const commandCost = envelope.command === 'reuse_recheck' ? (envelope.args.trigger === 'advisory_refresh' ? 20 : 2)
        : ({ spawn: 10, capability_invoke: 10, reuse_decide: 20, drain: 10, send: 2, interrupt: 2, kill: 2, respond: 2 }[envelope.command] ?? 1);
      const quota = this.edge.takeCommand(key, commandCost);
      if (!quota.ok) {
        try { this._audit('quota_refused', ctx, { quota: quota.quota }); } catch { return error(503, 'temporarily_unavailable'); }
        return { ...error(429, 'rate_limited'), headers: { 'retry-after': String(quota.retryAfter) } };
      }
    }

    const webActor = actor(ctx.principal);
    const scopeKey = hash({ userId: ctx.principal.userId, command: envelope.command, repoId: envelope.repoId, idempotencyKey: envelope.idempotencyKey });
    const requestDigest = hash(canonicalRequest(envelope));
    let admission;
    try {
      admission = this.coordination.admitWebCommand({
        commandId: envelope.commandId, scopeKey, requestDigest, command: envelope.command,
        repoId: envelope.repoId, runId: admittedRunId(envelope),
        userId: ctx.principal.userId, sessionId: ctx.principal.sessionId, credentialId: ctx.principal.credentialId,
        origin: envelope.origin, expectedFence: envelope.expectedFence ?? null,
      }, { actor: webActor, key: `web.admit:${scopeKey}` });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
    if (!admission.ok) {
      try { this._audit('idempotency_refused', ctx, { command: envelope.command, repoId: envelope.repoId, reason: admission.result }); } catch { return error(503, 'temporarily_unavailable'); }
      return error(409, admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_command');
    }
    if (admission.result === 'replay') {
      try { this._audit('command_replayed', ctx, { command: envelope.command, repoId: envelope.repoId, commandId: admission.command.commandId }); } catch { return error(503, 'temporarily_unavailable'); }
      if (admission.command.status === 'admitted' && envelope.command === 'drain') {
        const commandId = admission.command.commandId;
        const admittedActor = actor({ userId: admission.command.userId, sessionId: admission.command.sessionId });
        let replayed;
        try {
          replayed = await this._dispatchDrain(envelope, admittedActor, commandId, ctx.principal);
        } catch (cause) {
          const failure = dispatchFailure(cause);
          try { this.coordination.failWebCommand(commandId, failure, { actor: admittedActor, key: `web.fail:${commandId}` }); } catch { /* no success is returned */ }
          if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
          return result(failure.httpStatus, { ...failure.body, replayed: true });
        }
        const outcome = { httpStatus: replayed.status, body: replayed.body };
        try { this.coordination.completeWebCommand(commandId, outcome, { actor: admittedActor, key: `web.complete:${commandId}` }); }
        catch {
          if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
          return error(503, 'temporarily_unavailable');
        }
        if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
        return { ...replayed, body: { ...replayed.body, replayed: true } };
      }
      if (admission.command.status === 'admitted' && (RECONCILABLE.has(envelope.command)
        || (envelope.command === 'spawn' && envelope.args.goalPlan))) {
        const commandId = admission.command.commandId;
        const admittedActor = actor({ userId: admission.command.userId, sessionId: admission.command.sessionId });
        const admittedPrincipal = { ...ctx.principal, userId: admission.command.userId, sessionId: admission.command.sessionId };
        const admittedEnvelope = commandId === envelope.commandId ? envelope : { ...envelope, commandId };
        let replayed;
        try {
          replayed = APPLICATION_COMMAND[envelope.command]
            ? await this._dispatchApplicationOnce(admittedEnvelope, admittedActor, commandId, admittedPrincipal)
            : await this._dispatch(admittedEnvelope, admittedActor, admittedPrincipal);
        } catch (cause) {
          const failure = dispatchFailure(cause);
          try { this.coordination.failWebCommand(commandId, failure, { actor: admittedActor, key: `web.fail:${commandId}` }); } catch { /* no success is returned */ }
          if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
          return result(failure.httpStatus, { ...failure.body, replayed: true });
        }
        const postAuthorizationFailure = this._postWaitAuthorization(ctx, envelope);
        if (postAuthorizationFailure) {
          const outcome = { httpStatus: postAuthorizationFailure.status, body: postAuthorizationFailure.body };
          try { this.coordination.failWebCommand(commandId, outcome, { actor: admittedActor, key: `web.fail:${commandId}` }); }
          catch { return error(503, 'temporarily_unavailable'); }
          if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
          return postAuthorizationFailure;
        }
        const outcome = { httpStatus: replayed.status, body: replayed.body };
        try { this.coordination.completeWebCommand(commandId, outcome, { actor: admittedActor, key: `web.complete:${commandId}` }); }
        catch {
          if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
          return error(503, 'temporarily_unavailable');
        }
        if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(commandId);
        return { ...replayed, body: { ...replayed.body, replayed: true } };
      }
      if (admission.command.status === 'admitted') return result(202, { ok: true, commandId: admission.command.commandId, status: 'admitted', replayed: true });
      if (admission.command.status === 'completed' && ['reuse_decide', 'reuse_recheck'].includes(envelope.command)) {
        try { const refreshed = await this._dispatch(envelope, webActor, ctx.principal); return { ...refreshed, body: { ...refreshed.body, replayed: true } }; } catch { return error(503, 'temporarily_unavailable'); }
      }
      if (admission.command.status === 'completed' && APPLICATION_COMMAND[envelope.command]) {
        try {
          await this.application.authorizeReplay(APPLICATION_COMMAND[envelope.command], envelope.args, {
            actor: webActor, principalId: ctx.principal.userId, sessionId: ctx.principal.sessionId,
          });
        } catch (cause) {
          const failure = dispatchFailure(cause);
          return result(failure.httpStatus, failure.body);
        }
      }
      const replayBody = GOAL_PLAN_MUTATIONS.has(envelope.command)
        ? sanitizeGoalPlanProjection(admission.command.outcome.body)
        : json(admission.command.outcome.body);
      return result(admission.command.outcome.httpStatus, { ...replayBody, replayed: true });
    }

    let response;
    try {
      response = envelope.command === 'drain'
        ? await this._dispatchDrain(envelope, webActor, envelope.commandId, ctx.principal)
        : APPLICATION_COMMAND[envelope.command]
          ? await this._dispatchApplicationOnce(envelope, webActor, envelope.commandId, ctx.principal)
          : await this._dispatch(envelope, webActor, ctx.principal);
    } catch (cause) {
      const failure = dispatchFailure(cause);
      try { this.coordination.failWebCommand(envelope.commandId, failure, { actor: webActor, key: `web.fail:${envelope.commandId}` }); } catch { /* no success is returned */ }
      if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(envelope.commandId);
      void cause;
      return result(failure.httpStatus, failure.body);
    }

    const postAuthorizationFailure = this._postWaitAuthorization(ctx, envelope);
    if (postAuthorizationFailure) {
      const outcome = { httpStatus: postAuthorizationFailure.status, body: postAuthorizationFailure.body };
      try { this.coordination.failWebCommand(envelope.commandId, outcome, { actor: webActor, key: `web.fail:${envelope.commandId}` }); }
      catch { return error(503, 'temporarily_unavailable'); }
      if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(envelope.commandId);
      return postAuthorizationFailure;
    }

    const outcome = { httpStatus: response.status, body: response.body };
    try {
      this.coordination.completeWebCommand(envelope.commandId, outcome, { actor: webActor, key: `web.complete:${envelope.commandId}` });
    } catch {
      if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(envelope.commandId);
      return error(503, 'temporarily_unavailable');
    }
    if (APPLICATION_COMMAND[envelope.command]) this._applicationDispatches.delete(envelope.commandId);
    return response;
  }

  _dispatchDrain(envelope, webActor, commandId, principal) {
    const existing = this._drainDispatches.get(commandId);
    if (existing) return existing;
    const admittedEnvelope = commandId === envelope.commandId ? envelope : { ...envelope, commandId };
    const pending = Promise.resolve().then(() => this._dispatch(admittedEnvelope, webActor, principal));
    this._drainDispatches.set(commandId, pending);
    void pending.then(
      () => { if (this._drainDispatches.get(commandId) === pending) this._drainDispatches.delete(commandId); },
      () => { if (this._drainDispatches.get(commandId) === pending) this._drainDispatches.delete(commandId); },
    );
    return pending;
  }

  _dispatchApplicationOnce(envelope, webActor, commandId, principal) {
    const existing = this._applicationDispatches.get(commandId);
    if (existing) return existing;
    const admittedEnvelope = commandId === envelope.commandId ? envelope : { ...envelope, commandId };
    const pending = Promise.resolve().then(() => this._dispatch(admittedEnvelope, webActor, principal));
    this._applicationDispatches.set(commandId, pending);
    return pending;
  }

  async _dispatch(envelope, webActor, principal) {
    const a = envelope.args;
    const needsGoalPlanPrincipal = ['goal_define', 'plan_propose', 'plan_approve', 'goal_plan_status'].includes(envelope.command)
      || (envelope.command === 'spawn' && Boolean(a.goalPlan));
    if (needsGoalPlanPrincipal && !principal) throw new TypeError('Goal/Plan web dispatch requires its authenticated principal');
    const goalPlanCtx = principal ? {
      actor: webActor, principalId: principal.userId, sessionId: principal.sessionId,
      powers: [...principal.capabilities], repoId: envelope.repoId, runId: envelope.runId ?? null,
      idempotencyKey: `web.command:${envelope.commandId}`,
    } : null;
    let value;
    if (APPLICATION_COMMAND[envelope.command]) {
      if (!this.application) throw Object.assign(new Error('Run application is unavailable'), { code: 'application_unavailable' });
      value = await this.application.command(APPLICATION_COMMAND[envelope.command], a, {
        actor: webActor,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      });
    } else if (envelope.command === 'spawn') {
      const goalPlan = a.goalPlan ? json(a.goalPlan) : undefined;
      value = await this.coordinator.spawn(a.harness, a.brief, {
        model: a.model, effort: a.effort, modelPolicy: a.modelPolicy, taskId: a.taskId ?? `web-${envelope.commandId}`,
        deps: a.deps, taskType: a.taskType, session: a.session, refines: a.refines,
        runId: envelope.runId ?? null,
        actor: webActor,
        ...(goalPlan ? {
          principalId: principal.userId, sessionId: principal.sessionId, powers: [...principal.capabilities],
          goalPlan, capabilities: goalPlan.capabilities, effects: goalPlan.effects,
        } : {}),
        idempotencyKey: `web.command:${envelope.commandId}`,
      });
    } else if (envelope.command === 'goal_define') {
      value = await this.coordinator.defineGoal(a, goalPlanCtx);
    } else if (envelope.command === 'plan_propose') {
      value = await this.coordinator.proposePlan(a, goalPlanCtx);
    } else if (envelope.command === 'plan_approve') {
      value = await this.coordinator.approvePlan(a, goalPlanCtx);
    } else if (envelope.command === 'goal_plan_status') {
      value = await this.coordinator.goalPlanStatus(a, goalPlanCtx);
    } else if (envelope.command === 'scratch_oracle') {
      value = await this.coordinator.spawnScratchOracle(a.scratchFactId, a.harness, {
        model: a.model, effort: a.effort, modelPolicy: a.modelPolicy, verification: a.verification,
        budget: a.budget, constraints: a.constraints, goal: a.goal, definitionOfDone: a.definitionOfDone,
        taskId: a.taskId ?? `web-${envelope.commandId}`, runId: envelope.runId ?? null,
        actor: `operator:${webActor}`, idempotencyKey: `web.command:${envelope.commandId}`,
      });
    } else if (envelope.command === 'send') {
      value = await this.coordinator.send(a.workerId, a.message, a.mode, { expectedFence: envelope.expectedFence, actor: webActor });
    } else if (envelope.command === 'interrupt') {
      value = await this.coordinator.interrupt(a.workerId, a.then, webActor, { expectedFence: envelope.expectedFence });
    } else if (envelope.command === 'kill') {
      value = await this.coordinator.kill(a.workerId, webActor, { expectedFence: envelope.expectedFence });
    } else if (envelope.command === 'drain') {
      value = await this.coordinator.drain({ actor: webActor, repoId: envelope.repoId, idempotencyKey: `web.command:${envelope.commandId}` });
    } else if (envelope.command === 'respond') {
      value = await this.coordinator.respond(a.requestId, a.answer, webActor);
    } else if (envelope.command === 'list') {
      value = this.coordinator.list();
    } else if (envelope.command === 'result') {
      value = await this.coordinator.result(a.workerId);
    } else if (envelope.command === 'wait') {
      value = await this.coordinator.wait(Math.min(Number(a.timeoutMs ?? 25000), 30000));
    } else if (envelope.command === 'capabilities') {
      value = this.coordinator.capabilityCards();
    } else if (envelope.command === 'provider_status') {
      value = this.coordinator.readProviderStatus(a, { repoId: envelope.repoId });
    } else if (envelope.command === 'capability_invoke') {
      const capabilityCtx = {
        budgetTokens: a.budgetTokens, actor: webActor, repoId: envelope.repoId,
        idempotencyKey: `web.command:${envelope.commandId}`, transport: 'web',
      };
      const action = a.action;
      if (action === 'invoke') value = typeof this.coordinator.invokeCapabilityNorthbound === 'function' ? await this.coordinator.invokeCapabilityNorthbound('web', northboundCapabilityToken('web'), a.name, a.op, a.args, capabilityCtx) : await this.coordinator.invokeCapability(a.name, a.op, a.args, capabilityCtx);
      else if (action === 'resume') value = typeof this.coordinator.resumeCapabilityNorthbound === 'function' ? await this.coordinator.resumeCapabilityNorthbound('web', northboundCapabilityToken('web'), a.name, a.op, a.ref, a.cursor, capabilityCtx) : await this.coordinator.resumeCapability(a.name, a.op, a.ref, a.cursor, capabilityCtx);
      else if (action === 'reverify') value = typeof this.coordinator.reverifyCapabilityNorthbound === 'function' ? await this.coordinator.reverifyCapabilityNorthbound('web', northboundCapabilityToken('web'), a.name, a.op, a.claim, a.args, capabilityCtx) : await this.coordinator.reverifyCapability(a.name, a.op, a.claim, a.args, capabilityCtx);
      else value = await this.coordinator.orientWorker(a.workerId, a.args, a.note, { ...capabilityCtx, expectedFence: envelope.expectedFence });
      value = transportCapability(value);
    } else if (envelope.command === 'reuse_decide') {
      value = await this.coordinator.decideReuse(a, { actor: webActor, repoId: envelope.repoId, budgetTokens: a.budgetTokens, idempotencyKey: `web.command:${envelope.commandId}` });
    } else if (envelope.command === 'reuse_recheck') {
      value = await this.coordinator.recheckReuseDecision(a, { actor: webActor, repoId: envelope.repoId, budgetTokens: a.budgetTokens, idempotencyKey: `web.command:${envelope.commandId}` });
    }
    if (value?.result === 'stale_fence') return error(409, 'stale_fence');
    const projected = GOAL_PLAN_MUTATIONS.has(envelope.command) ? sanitizeGoalPlanProjection(value) : json(value);
    return result(200, { ok: true, commandId: envelope.commandId, result: projected });
  }

  async handle(req, res) {
    const origin = req.headers?.origin ?? null;
    if (this.edge) {
      let peerDigest = null;
      try { peerDigest = this.edge.peerDigest(req); } catch { /* bounded invalid-peer audit below */ }
      let identity;
      try { identity = this.edge.resolve(req); } catch {
        let peerQuota;
        try { peerQuota = this.edge.take('peer', peerDigest ?? this.edge.digest('peer:invalid')); }
        catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        if (!peerQuota.ok) return this._write(res, { ...error(429, 'rate_limited'), headers: { 'retry-after': String(peerQuota.retryAfter) } });
        try { this._audit('proxy_refused', { origin, remoteAddress: peerDigest ? 'canonical' : null, addressDigest: peerDigest }, { reason: peerDigest ? 'invalid_forwarding' : 'invalid_peer' }); } catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        return this._write(res, error(400, 'invalid_forwarding'));
      }
      req.edgeIdentity = identity;
      req.edgeAddressDigest = this.edge.digest(identity.address);
    }
    const takeEdgeQuota = (name) => {
      if (!this.edge) return null;
      const quota = this.edge.take(name, req.edgeAddressDigest);
      if (quota.ok) return null;
      try { this._audit('quota_refused', { origin }, { quota: name, addressDigest: req.edgeAddressDigest }); }
      catch { return error(503, 'temporarily_unavailable'); }
      return { ...error(429, 'rate_limited'), headers: { 'retry-after': String(quota.retryAfter) } };
    };
    let url;
    try {
      if (typeof req.url !== 'string' || req.url.length === 0 || req.url.length > 4_096
        || !req.url.startsWith('/') || req.url.startsWith('//') || /[\u0000-\u001f\u007f]/.test(req.url)
        || /%(?![0-9a-f]{2})/i.test(req.url)) throw new TypeError('invalid request target');
      url = new URL(req.url, 'https://baton.invalid');
      if (url.origin !== 'https://baton.invalid' || url.hash) throw new TypeError('invalid request target');
    } catch {
      const quotaRefusal = takeEdgeQuota('address');
      if (quotaRefusal) return this._write(res, quotaRefusal);
      try { this._audit('request_refused', { origin: this.allowedOrigins.has(origin) ? origin : null }, { reason: 'invalid_target' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(400, 'invalid_request'));
    }
    if (this.edge) {
      const name = url.pathname === '/readyz' ? 'readiness' : url.pathname === '/healthz' ? 'health' : 'address';
      const quotaRefusal = takeEdgeQuota(name);
      if (quotaRefusal) return this._write(res, quotaRefusal, origin);
      if (req.edgeIdentity.transport !== 'https') {
        try { this._audit('transport_refused', { origin, remoteAddress: 'canonical', addressDigest: req.edgeAddressDigest }, { reason: 'secure_transport_required' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        return this._write(res, error(503, 'temporarily_unavailable'));
      }
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return this._write(res, result(200, { ok: true }));
    if (req.method === 'GET' && url.pathname === '/readyz') return this._write(res, this._readinessResponse({ origin, remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null), addressDigest: req.edgeAddressDigest ?? null }));
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'));
    if (req.method === 'GET' && url.pathname === OIDC_START_PATH) {
      return this._handleOidcStart(req, res, url, origin);
    }
    if (req.method === 'GET' && url.pathname === OIDC_CALLBACK_PATH) {
      return this._handleOidcCallback(req, res, url, origin);
    }
    if (req.method === 'GET' && (['/v1/session', '/v1/application-card'].includes(url.pathname) || operatorAsset(url.pathname))) {
      return this._handleOperatorRead(req, res, url.pathname, origin);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/commands/')) {
      return this._handleCommandStatus(req, res, url, origin);
    }
    if (req.method === 'POST' && AUTH_PATHS.has(url.pathname)) {
      return this._handleLifecycle(req, res, url.pathname, origin);
    }
    const exportArchivePreflight = /^\/v1\/exports\/[a-f0-9]{64}\/archive$/u.test(url.pathname);
    if (req.method === 'OPTIONS' && !url.search
      && (url.pathname === '/v1/export-downloads' || exportArchivePreflight)) {
      if (!this.allowedOrigins.has(origin)) return this._write(res, error(403, 'forbidden'));
      const archive = exportArchivePreflight;
      res.writeHead(204, {
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-methods': archive ? 'GET' : 'POST',
        'access-control-allow-headers': archive ? 'x-baton-export-ticket' : 'content-type,x-baton-csrf',
        'access-control-max-age': '300', vary: 'Origin', 'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/export-downloads') {
      if (url.search || req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return this._write(res, error(400, 'invalid_request'), origin);
      }
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      const ctx = {
        principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null,
        transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
      };
      const authFailure = this._authenticate(ctx);
      if (authFailure) return this._write(res, authFailure, origin);
      if (!this.exportDelivery || !this.allowedOrigins.has(origin)
        || !Array.isArray(principal.repoIds) || !Array.isArray(principal.capabilities)
        || !principal.capabilities.includes('observe') || !principal.capabilities.includes('export_result')) {
        return this._write(res, error(403, 'forbidden'), origin);
      }
      if (principal.authMethod === 'cookie') {
        const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
          ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
          : ctx.csrfToken === principal.csrfToken);
        if (!csrfValid) return this._write(res, error(403, 'forbidden'), origin);
      }
      let body;
      try { body = await this._readBody(req); } catch { return this._write(res, error(400, 'invalid_request'), origin); }
      const coordinates = body && typeof body === 'object' && !Array.isArray(body)
        && Object.keys(body).sort().join(',') === ['exportId', 'repoId', 'runId'].join(',')
        && /^[a-f0-9]{64}$/u.test(body.exportId ?? '') && string(body.repoId) && string(body.runId)
        ? body : null;
      if (!coordinates || !this.repoIds.has(coordinates.repoId) || !principal.repoIds.includes(coordinates.repoId)
        || !await this.exportDelivery.authorizeIssue(principal, origin, coordinates)) {
        return this._write(res, error(coordinates ? 403 : 400, coordinates ? 'forbidden' : 'invalid_request'), origin);
      }
      return this._write(res, await this.exportDelivery.issue(principal, origin, coordinates), origin);
    }
    const archiveMatch = /^\/v1\/exports\/([a-f0-9]{64})\/archive$/u.exec(url.pathname);
    if (req.method === 'GET' && archiveMatch) {
      if (url.search || req.headers.range != null || req.headers['x-baton-filename'] != null
        || !string(req.headers['x-baton-export-ticket'])) {
        return this._write(res, error(400, 'invalid_request'), origin);
      }
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      const authFailure = this._authenticate({
        principal, origin,
        transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
      });
      if (authFailure) return this._write(res, authFailure, origin);
      if (!this.exportDelivery || !this.allowedOrigins.has(origin)) return this._write(res, error(403, 'forbidden'), origin);
      const opened = await this.exportDelivery.open({
        ticket: req.headers['x-baton-export-ticket'], principal, origin,
        requestHeaders: req.headers, exportId: archiveMatch[1],
      }, res);
      if (opened) return this._write(res, opened, origin);
      return;
    }
    if (req.method === 'OPTIONS' && (['/v1/commands', '/v1/stream-tickets'].includes(url.pathname) || AUTH_PATHS.has(url.pathname))) {
      if (!this.allowedOrigins.has(origin)) return this._write(res, error(403, 'forbidden'));
      res.writeHead(204, {
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type,x-baton-csrf',
        'access-control-max-age': '300', vary: 'Origin', 'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/stream-tickets') {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return this._write(res, error(400, 'invalid_command', 'application/json required'), origin);
      }
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      let body;
      try { body = await this._readBody(req); } catch { return this._write(res, error(400, 'invalid_command'), origin); }
      if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
      const ctx = { principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null, addressDigest: req.edgeAddressDigest ?? null, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') };
      const authFailure = this._authenticate(ctx);
      if (authFailure) return this._write(res, authFailure, origin);
      if (principal.authMethod === 'cookie') {
        const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
          ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
          : ctx.csrfToken === principal.csrfToken);
        if (!csrfValid) return this._write(res, error(403, 'forbidden'), origin);
      }
      if (typeof this.stream.authorizeIssue !== 'function') return this._write(res, error(503, 'temporarily_unavailable'), origin);
      if (!this.stream.authorizeIssue(principal, origin, body?.repoId)) {
        try { this._audit('stream_ticket_refused', { principal, origin, addressDigest: req.edgeAddressDigest ?? null }, { reason: 'forbidden' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        return this._write(res, error(403, 'forbidden'), origin);
      }
      if (this.edge) {
        const ticketQuota = this.edge.reserve('ticket', principal.credentialId);
        if (!ticketQuota.ok) {
          try { this._audit('quota_refused', { principal, origin, addressDigest: req.edgeAddressDigest ?? null }, { quota: 'ticket' }); }
          catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
          return this._write(res, error(429, 'rate_limited'), origin, { 'retry-after': String(ticketQuota.retryAfter) });
        }
        let issuance;
        try {
          if (typeof this.stream.beginIssue !== 'function') throw new TypeError('transactional ticket issuance required');
          issuance = this.stream.beginIssue(principal, origin, body?.repoId);
        }
        catch { ticketQuota.rollback(); return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        const issued = issuance?.response ?? error(503, 'temporarily_unavailable');
        if (issued.status !== 201) {
          issuance?.rollback?.(); ticketQuota.rollback();
          return this._write(res, issued, origin);
        }
        try { this._write(res, issued, origin); }
        catch { issuance.rollback(); ticketQuota.rollback(); return; }
        issuance.commit(); ticketQuota.commit();
        return;
      }
      return this._write(res, this.stream.issue(principal, origin, body?.repoId), origin);
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
      const authFailure = this._authenticate({ principal, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') });
      if (authFailure) return this._write(res, authFailure, origin);
      const responseValue = this.stream.open({
        ticket: url.searchParams.get('ticket'), principal, origin,
        cursor: req.headers['last-event-id'] ?? url.searchParams.get('cursor'),
      }, res);
      if (responseValue) return this._write(res, responseValue, origin);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/commands') return this._write(res, error(404, 'not_found'));
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return this._write(res, error(400, 'invalid_command', 'application/json required'), origin);
    let principal;
    try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    let envelope;
    try { envelope = await this._readBody(req); } catch (cause) {
      try { this._audit('command_body_refused', { principal, origin, remoteAddress: req.socket?.remoteAddress ?? null }, { reason: cause?.code ?? 'invalid_json' }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(cause?.code === 'body_too_large' ? 413 : 400, 'invalid_command'), origin);
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    const response = await this.execute({
      principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null,
      remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null), addressDigest: req.edgeAddressDigest ?? null, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
    }, envelope);
    return this._write(res, response, origin);
  }

  _oidcContext(req, origin) {
    return {
      origin,
      remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null),
      addressDigest: req.edgeAddressDigest ?? null,
      transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
    };
  }

  async _handleOperatorRead(req, res, pathname, origin) {
    const ctx = this._oidcContext(req, origin);
    let principal;
    try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    const authFailure = this._authenticate({ principal, transport: ctx.transport });
    if (authFailure) {
      try { this._audit('operator_read_refused', { ...ctx, principal }, { reason: 'unauthenticated' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, authFailure);
    }
    const repoId = [...this.repoIds][0];
    const sameSite = ['same-origin', 'none'].includes(req.headers?.['sec-fetch-site']);
    if (!sameSite || !principal.capabilities?.includes('observe') || !principal.repoIds?.includes(repoId)
      || (this.isPrincipalActive && !this.isPrincipalActive(principal, { repoId }))) {
      try { this._audit('operator_read_refused', { ...ctx, principal }, { reason: 'forbidden' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(403, 'forbidden'));
    }
    try {
      this._audit('operator_read_authorized', { ...ctx, principal }, {
        resourceClass: pathname === '/v1/session' ? 'session' : pathname === '/v1/application-card' ? 'application_card' : 'asset',
      });
    }
    catch { return this._write(res, error(503, 'temporarily_unavailable')); }
    if (pathname === '/v1/session') {
      return this._write(res, result(200, {
        ok: true,
        identity: { userId: principal.userId, capabilities: [...principal.capabilities], repoIds: [...principal.repoIds] },
        expiresAt: principal.expiresAt,
      }));
    }
    if (pathname === '/v1/application-card') {
      if (!this.application) return this._write(res, error(503, 'application_unavailable', 'run application unavailable'));
      const card = this.application.card();
      return this._write(res, result(200, {
        ok: true,
        application: { ...card, commands: WEB_APPLICATION_ENTRIES.map(([, name]) => name) },
      }));
    }
    const asset = operatorAsset(pathname);
    const body = asset.body;
    const headers = {
      'content-type': asset.type, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    };
    res.writeHead(200, headers);
    res.end(body);
  }

  async _handleCommandStatus(req, res, url, origin) {
    const ctx = this._oidcContext(req, origin);
    let principal;
    try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    const authFailure = this._authenticate({ principal, transport: ctx.transport });
    if (authFailure) {
      try { this._audit('command_status_refused', { ...ctx, principal }, { reason: 'unauthenticated' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, authFailure);
    }
    const sameSite = principal.authMethod !== 'cookie' || ['same-origin', 'none'].includes(req.headers?.['sec-fetch-site']);
    const servedRepo = [...this.repoIds][0];
    if (!sameSite || !principal.capabilities?.includes('observe') || !principal.repoIds?.includes(servedRepo)
      || (this.isPrincipalActive && !this.isPrincipalActive(principal, { repoId: servedRepo }))) {
      try { this._audit('command_status_refused', { ...ctx, principal }, { reason: 'forbidden' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(403, 'forbidden'));
    }
    const encoded = url.pathname.slice('/v1/commands/'.length);
    const commandId = /^[A-Za-z0-9._:-]{1,128}$/.test(encoded) && url.search === '' ? encoded : null;
    const command = commandId ? this.coordination.webCommand(commandId) : null;
    const owned = command && string(command.userId) && command.userId === principal.userId
      && command.repoId === servedRepo;
    if (!owned) {
      try { this._audit('command_status_refused', { ...ctx, principal }, { reason: 'not_found_or_forbidden' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(404, 'not_found'));
    }
    try { this._audit('command_status_authorized', { ...ctx, principal }, { commandDigest: hash(command.commandId), status: command.status }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable')); }
    return this._write(res, result(200, { ok: true, command: {
      commandId: command.commandId, command: command.command, repoId: command.repoId,
      runId: command.runId ?? null, expectedFence: command.expectedFence ?? null,
      status: command.status, admittedAt: command.admittedAt, completedAt: command.completedAt ?? null,
      outcome: command.outcome == null ? null : json(command.outcome),
    } }));
  }

  _validOidcNavigation(req, origin, callback = false) {
    if (req.headers?.['sec-fetch-mode'] !== 'navigate') return false;
    if (req.headers?.['sec-fetch-dest'] !== 'document') return false;
    const site = req.headers?.['sec-fetch-site'];
    const allowedSites = callback ? new Set(['cross-site', 'same-origin', 'none']) : new Set(['same-origin', 'none']);
    if (!allowedSites.has(site)) return false;
    if (callback) return origin == null;
    return origin == null || this.allowedOrigins.has(origin);
  }

  _writeRedirect(res, status, location, setCookie) {
    const headers = {
      location, 'content-length': '0', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      ...(setCookie ? { 'set-cookie': setCookie } : {}),
    };
    res.writeHead(status, headers);
    res.end();
  }

  _handleOidcStart(req, res, url, origin) {
    const ctx = this._oidcContext(req, origin);
    if (!this.oidc) return this._write(res, error(404, 'not_found'));
    if (ctx.transport !== 'https' || url.search !== '' || !this._validOidcNavigation(req, origin, false)) {
      try { this._audit('oidc_start_refused', ctx, { reason: 'request_policy' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(ctx.transport === 'https' ? 403 : 503, ctx.transport === 'https' ? 'forbidden' : 'temporarily_unavailable'));
    }
    if (this.edge) {
      const quota = this.edge.take('login', ctx.addressDigest);
      if (!quota.ok) {
        try { this._audit('quota_refused', ctx, { quota: 'login' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        return this._write(res, error(429, 'rate_limited'), null, { 'retry-after': String(quota.retryAfter) });
      }
    }
    try { this._audit('oidc_start_requested', ctx, { providerClass: 'oidc' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable')); }
    let started;
    try { started = this.oidc.begin(); }
    catch (cause) {
      return this._write(res, error(cause?.code === 'flow_capacity' ? 429 : 503, cause?.code === 'flow_capacity' ? 'rate_limited' : 'temporarily_unavailable'));
    }
    try {
      this._writeRedirect(res, 302, started.location, started.setCookie);
      started.commit();
    } catch (cause) {
      started.rollback();
      throw cause;
    }
  }

  async _handleOidcCallback(req, res, url, origin) {
    const ctx = this._oidcContext(req, origin);
    const clearCookie = this.oidc?.clearCookie?.();
    const refuse = (status, code, reason) => {
      try { this._audit('oidc_callback_refused', ctx, { reason }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), null, clearCookie ? { 'set-cookie': clearCookie } : {}); }
      return this._write(res, error(status, code), null, clearCookie ? { 'set-cookie': clearCookie } : {});
    };
    if (!this.oidc) return this._write(res, error(404, 'not_found'));
    if (ctx.transport !== 'https' || !this._validOidcNavigation(req, origin, true)) {
      return refuse(ctx.transport === 'https' ? 403 : 503, ctx.transport === 'https' ? 'forbidden' : 'temporarily_unavailable', 'request_policy');
    }
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => !['code', 'state'].includes(key))
      || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1) {
      return refuse(400, 'invalid_request', 'invalid_callback');
    }
    let claims;
    try {
      claims = await this.oidc.complete({
        code: url.searchParams.get('code'), state: url.searchParams.get('state'),
        cookieHeader: req.headers?.cookie,
      });
    } catch (cause) {
      return refuse(cause?.code === 'provider_refused' || cause?.code === 'identity_mismatch' || cause?.code === 'claims_refused' ? 401 : 400,
        cause?.code === 'provider_refused' || cause?.code === 'identity_mismatch' || cause?.code === 'claims_refused' ? 'unauthenticated' : 'invalid_request',
        cause?.code ?? 'invalid_flow');
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), null, { 'set-cookie': clearCookie });
    if (!this.sessions || !this.sessions.validateIssue?.(claims)) return refuse(401, 'unauthenticated', 'claims_refused');
    try {
      this._audit('oidc_callback_authorized', {
        ...ctx, principal: { userId: claims.userId, sessionId: 'pending', credentialId: 'pending' },
      }, { authMethod: 'cookie', providerClass: 'oidc' });
    } catch {
      return this._write(res, error(503, 'temporarily_unavailable'), null, { 'set-cookie': clearCookie });
    }
    let issued;
    try { issued = this.sessions.issue(claims, { actor: `web:${claims.userId}:oidc` }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), null, { 'set-cookie': clearCookie }); }
    const maxAge = Math.max(1, Math.floor((Date.parse(issued.expiresAt) - this.now()) / 1000));
    const cookies = [issued.setCookie, csrfCookie(issued.csrfToken, maxAge), clearCookie];
    try {
      this._writeRedirect(res, 303, '/control', cookies);
    } catch (cause) {
      try { this.sessions.revoke(issued.sessionId, { actor: `web:${claims.userId}:oidc`, reason: 'delivery_failed' }); } catch { /* durable issue remains visible */ }
      try { this._audit('oidc_callback_delivery_failed', ctx, { reason: 'response_delivery' }); } catch { /* transport already failed */ }
      throw cause;
    }
  }

  async _handleLifecycle(req, res, pathname, origin) {
    const ctx = { origin, remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null), addressDigest: req.edgeAddressDigest ?? null, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') };
    const audit = (kind, principal = null, details = {}) => this._audit(kind, { ...ctx, principal }, details);
    if (ctx.transport !== 'https' || !this.allowedOrigins.has(origin)) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'request_policy' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(ctx.transport !== 'https' ? 503 : 403, ctx.transport !== 'https' ? 'temporarily_unavailable' : 'forbidden'), origin);
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'content_type' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(415, 'unsupported_media_type'), origin);
    }
    let principal = null;
    if (pathname !== '/v1/auth/login') {
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    let body;
    try { body = await this._readBody(req); }
    catch (cause) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: cause?.code ?? 'invalid_json' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(cause?.code === 'body_too_large' ? 413 : 400, 'invalid_request'), origin);
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    if (!isRecord(body)) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: 'invalid_body' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(400, 'invalid_request'), origin);
    }
    if (pathname === '/v1/auth/login') return this._login(res, body, ctx);
    if (!principal) {
      try { audit(pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'unauthenticated' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(401, 'unauthenticated'), origin);
    }
    if (principal.authMethod === 'cookie') {
      const supplied = req.headers['x-baton-csrf'];
      if (!string(supplied) || !principal.csrfTokenDigest || !equalDigest(tokenHash(supplied), principal.csrfTokenDigest)) {
        try { audit(pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: 'csrf' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        return this._write(res, error(403, 'forbidden'), origin);
      }
    }
    if (Object.keys(body).length !== 0) {
      try { audit(pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: 'invalid_body' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(400, 'invalid_request'), origin);
    }
    return pathname === '/v1/auth/refresh' ? this._refresh(res, principal, origin) : this._logout(res, principal, origin);
  }

  async _login(res, body, ctx) {
    const refused = async () => {
      try { this._audit('login_refused', ctx, { reason: 'unauthenticated' }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
      return this._write(res, error(401, 'unauthenticated'), ctx.origin);
    };
    if (!this.sessions || typeof this.identityProvider !== 'function') return refused();
    if (this.edge) {
      const login = this.edge.take('login', ctx.addressDigest);
      if (!login.ok) {
        try { this._audit('quota_refused', ctx, { quota: 'login' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
        return this._write(res, error(429, 'rate_limited'), ctx.origin, { 'retry-after': String(login.retryAfter) });
      }
    }
    let claims;
    try { claims = await this.identityProvider(json(body), Object.freeze({ origin: ctx.origin, transport: 'https' })); } catch { return refused(); }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin);
    if (!claims || !validProviderClaims(claims) || !this.sessions.validateIssue?.(claims)) return refused();
    try { this._audit('login_authorized', { ...ctx, principal: { userId: claims.userId, sessionId: 'pending', credentialId: 'pending' } }, { authMethod: claims.authMethod }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
    let issued;
    try { issued = this.sessions.issue(claims, { actor: `web:${claims.userId}:login` }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
    return this._credentialResponse(res, claims, issued, ctx.origin, 201);
  }

  _refresh(res, principal, origin) {
    if (!this.sessions) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    try { this._audit('refresh_authorized', { principal, origin }, { authMethod: principal.authMethod }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    let issued;
    try { issued = this.sessions?.rotate(principal.sessionId, { actor: actor(principal) }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    if (!issued) return this._write(res, error(401, 'unauthenticated'), origin);
    return this._credentialResponse(res, principal, issued, origin, 200);
  }

  _logout(res, principal, origin) {
    if (!this.sessions) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    try { this._audit('logout_authorized', { principal, origin }, { authMethod: principal.authMethod }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    try { this.sessions?.revoke(principal.sessionId, { actor: actor(principal), reason: 'logout' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    const headers = principal.authMethod === 'cookie' ? { 'set-cookie': [
      '__Host-baton_session=; Max-Age=0; Secure; HttpOnly; SameSite=Strict; Path=/',
      '__Host-baton_csrf=; Max-Age=0; Secure; SameSite=Strict; Path=/',
    ] } : {};
    return this._write(res, result(200, { ok: true }), origin, headers);
  }

  _credentialResponse(res, identity, issued, origin, status) {
    const body = { ok: true, identity: { userId: identity.userId, capabilities: [...identity.capabilities], repoIds: [...identity.repoIds] }, expiresAt: issued.expiresAt };
    const headers = {};
    if (identity.authMethod === 'cookie') {
      body.csrfToken = issued.csrfToken;
      const maxAge = Math.max(1, Math.floor((Date.parse(issued.expiresAt) - this.now()) / 1000));
      headers['set-cookie'] = [issued.setCookie, csrfCookie(issued.csrfToken, maxAge)];
    }
    else body.token = issued.token;
    return this._write(res, result(status, body), origin, headers);
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.maxBodyBytes) { const cause = new Error('body too large'); cause.code = 'body_too_large'; reject(cause); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (cause) { reject(cause); } });
      req.on('error', reject);
    });
  }

  _write(res, response, origin = null, extraHeaders = {}) {
    const body = JSON.stringify(response.body);
    const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(response.headers ?? {}), ...extraHeaders };
    if (origin && this.allowedOrigins.has(origin)) Object.assign(headers, { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' });
    res.writeHead(response.status, headers);
    res.end(body);
  }

  shutdown({ server, drainMs = 5_000 } = {}) {
    if (this._shutdown) return this._shutdown;
    if (!Number.isSafeInteger(drainMs) || drainMs <= 0) throw new TypeError('drainMs must be a positive safe integer');
    this.admitting = false; this.edge?.closeAdmission();
    this._shutdown = (async () => {
      let auditOk = true;
      try { this._audit('shutdown_started', {}); } catch { auditOk = false; }
      let streamOk = true;
      try { this.stream.shutdown?.(); } catch { streamOk = false; }
      let exportDeliveryOk = true;
      try { this.exportDelivery?.shutdown?.(); } catch { exportDeliveryOk = false; }
      let closed = !server?.close;
      const closePromise = new Promise((resolve) => {
        if (!server?.close) return resolve(true);
        try { server.close(() => { closed = true; resolve(true); }); } catch { resolve(false); }
      });
      const timedOut = await Promise.race([closePromise.then(() => false), new Promise((resolve) => setTimeout(() => resolve(true), drainMs))]);
      if (timedOut && !closed) {
        try { server.closeIdleConnections?.(); } catch {}
        try { server.closeAllConnections?.(); } catch {}
        await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, Math.min(1_000, drainMs)))]);
      }
      const outcome = closed ? 'shutdown_completed' : 'shutdown_timed_out';
      try { this._audit(outcome, {}, { streamShutdownOk: streamOk, exportDeliveryShutdownOk: exportDeliveryOk }); } catch { auditOk = false; }
      return {
        ok: closed && auditOk && streamOk && exportDeliveryOk,
        result: !closed ? 'timed_out' : !auditOk || !streamOk || !exportDeliveryOk ? 'closed_degraded' : 'closed',
      };
    })();
    return this._shutdown;
  }
}

export function createAuthenticatedWebServer(northbound, opts = {}) {
  if (!(northbound instanceof WebNorthbound)) throw new TypeError('WebNorthbound required');
  if (typeof northbound.authenticate !== 'function') throw new TypeError('an authenticator is required');
  const requireReadiness = () => {
    if (!(northbound.readinessAuthority instanceof WebReadinessAuthority)
      || northbound.readinessAuthority.coordination !== northbound.coordination
      || northbound.readinessAuthority.sessions !== northbound.sessions
      || northbound.readinessAuthority.authenticate !== northbound.authenticate) {
      throw new TypeError('production web server requires a WebReadinessAuthority bound to its coordination, session, and authentication authorities');
    }
  };
  const proxyCleartext = opts.proxy?.cleartextBackend === true;
  let server;
  if (proxyCleartext) {
    if (!(northbound.edge instanceof WebEdgePolicy) || !northbound.edge.proxyMode || northbound.edge.trustedProxies.length === 0) throw new TypeError('cleartext proxy backend requires an explicit trusted-proxy edge policy');
    requireReadiness();
    if (opts.tls?.key || opts.tls?.cert) throw new TypeError('choose direct TLS or cleartext trusted-proxy backend, not both');
    server = createHttpServer((req, res) => northbound.handle(req, res));
  } else {
    if (!opts.tls?.key || !opts.tls?.cert) throw new TypeError('TLS key and certificate are required');
    if (!(northbound.edge instanceof WebEdgePolicy)) throw new TypeError('production web server requires a WebEdgePolicy');
    requireReadiness();
    if (northbound.edge.proxyMode) throw new TypeError('direct TLS requires a direct-mode edge policy');
    server = createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert, minVersion: 'TLSv1.2' }, (req, res) => northbound.handle(req, res));
  }
  server.batonShutdown = (shutdownOpts = {}) => northbound.shutdown({ ...shutdownOpts, server });
  return server;
}

export { validateEnvelope as validateWebCommandEnvelope };
