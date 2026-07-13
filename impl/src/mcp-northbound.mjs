import { createHash, randomUUID } from 'node:crypto';
import { northboundCapabilityToken } from './northbound-capability-authority.mjs';
import { sanitizeGoalPlanProjection } from './goal-plan.mjs';

const PROTOCOL_VERSION = '2025-11-25';
const CAPABILITY = Object.freeze({
  fleet_spawn: 'control', fleet_scratch_oracle: 'control', fleet_send: 'control', fleet_wait: 'observe', fleet_respond: 'approve',
  fleet_interrupt: 'control', fleet_result: 'observe', fleet_list: 'observe', fleet_capabilities: 'observe',
  fleet_provider_status: 'observe',
  fleet_goal_define: 'goal:define', fleet_plan_propose: 'plan:propose', fleet_plan_approve: 'plan:approve', fleet_goal_plan_status: 'goal:observe',
  fleet_capability_invoke: 'control', fleet_reuse_decide: 'control', fleet_reuse_recheck: 'control', fleet_kill: 'emergency_stop', fleet_drain: 'emergency_stop',
});
const STATEFUL = new Set(['fleet_spawn', 'fleet_scratch_oracle', 'fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_send', 'fleet_respond', 'fleet_interrupt', 'fleet_capability_invoke', 'fleet_reuse_decide', 'fleet_reuse_recheck', 'fleet_kill', 'fleet_drain']);
const RECONCILABLE = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve']);
const GOAL_PLAN_MUTATIONS = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve']);
const FENCED = new Set(['fleet_send', 'fleet_interrupt', 'fleet_kill']);
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const SESSION_FIELDS = new Set(['mode', 'id', 'lastTurnId', 'context']);
const SESSION_CONTEXT_FIELDS = new Set(['worktree', 'repoRoot', 'baseSha', 'branch', 'ownerTaskId']);
const VERIFICATION_FIELDS = new Set(['command', 'expectExit', 'timeoutMs', 'coverageCommand', 'mutationCommand']);
const BUDGET_FIELDS = new Set(['tokens', 'usd', 'wallMin']);
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization|actor|userId|sessionId|capabilities|repoIds)$/i;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function containsForbidden(value, path = []) {
  if (Array.isArray(value)) return value.some((child) => containsForbidden(child, path));
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const planCapabilityField = key === 'capabilities' && ['goalPlan', 'nodes'].includes(path.at(-1));
    return (FORBIDDEN_KEY.test(key) && !planCapabilityField) || containsForbidden(child, [...path, key]);
  });
}
function normalized(value) { return value === undefined ? null : clone(value); }
function transportCapability(value) {
  const copy = normalized(value);
  if (record(copy) && Array.isArray(copy.refs)) copy.refs = copy.refs.map(({ path: _path, ...ref }) => ref);
  return copy;
}
function toolResult(value, isError = false) {
  const normalizedValue = normalized(value);
  const structuredContent = record(normalizedValue) ? normalizedValue : { result: normalizedValue };
  return Object.freeze({ content: Object.freeze([{ type: 'text', text: JSON.stringify(structuredContent) }]), structuredContent: Object.freeze(structuredContent), isError });
}
function toolError(code) { return toolResult({ ok: false, error: { code } }, true); }
function stateFailureCode(cause) {
  if (cause?.mcpCode === 'stale_fence') return 'stale_fence';
  if (['capability_not_found', 'capability_op_unavailable', 'capability_budget_invalid', 'cancelled',
    'capability_result_invalid', 'capability_result_oversize', 'capability_authority_forbidden', 'capability_args_invalid',
    'capability_resume_invalid', 'capability_reverify_invalid', 'capability_actor_invalid', 'capability_repo_invalid', 'capability_idempotency_invalid',
    'capability_context_invalid', 'capability_context_forbidden', 'capability_record_unavailable',
    'invalid_proposal', 'invalid_sbom_path', 'proposal_context_required', 'proposal_receipt_invalid', 'proposal_schema_invalid',
    'proposal_policy_violation', 'proposal_network_violation', 'proposal_root_changed', 'proposal_coordinate_mismatch', 'proposal_oversize', 'proposal_timeout', 'proposal_resolver_failed', 'proposal_cleanup_failed', 'proposal_supervisor_busy', 'proposal_reconcile_failed', 'sbom_schema_invalid', 'sbom_oversize', 'sbom_source_changed', 'sbom_unavailable', 'artifact_integrity',
    'invalid_advisory_request', 'advisory_context_required', 'invalid_package_identity', 'advisory_plan_diverged', 'advisory_policy_changed', 'advisory_scan_coordinate_mismatch', 'advisory_scan_schema_invalid', 'advisory_scan_incomplete', 'advisory_source_changed', 'advisory_atlas_integrity', 'advisory_projection_oversize',
    'oracle_unavailable', 'oracle_timeout', 'oracle_response_oversize', 'oracle_schema_invalid', 'oracle_coordinate_mismatch', 'oracle_incomplete', 'oracle_source_integrity', 'oracle_clock_invalid',
    'capability_resume_unavailable', 'capability_reverify_unavailable', 'capability_task_requires_task_plane',
    'scratch_oracle_invalid', 'scratch_oracle_target_ineligible', 'scratch_oracle_route_unavailable', 'scratch_oracle_not_independent', 'scratch_oracle_oversize', 'scratch_oracle_forbidden', 'scratch_oracle_unavailable', 'scratch_oracle_integrity', 'explicit_vendor_required', 'verification_required',
    'run_sealed', 'run_not_terminal', 'run_not_found', 'invalid_run_id', 'run_membership_changed', 'run_prefix_changed',
    'causal_request_invalid', 'causal_context_invalid', 'causal_repo_mismatch', 'causal_audit_invalid', 'causal_trace_invalid', 'causal_recall_invalid', 'causal_audit_oversize', 'causal_trace_oversize', 'causal_audit_integrity', 'causal_recall_oversize', 'causal_recall_audit_failed', 'knowledge_recall_conflict', 'knowledge_recall_integrity',
    'causal_promotion_invalid', 'causal_promotion_forbidden', 'causal_promotion_oversize', 'causal_promotion_audit_failed', 'causal_promotion_conflict', 'causal_promotion_integrity',
    'causal_correction_invalid', 'causal_correction_forbidden', 'causal_correction_oversize', 'causal_correction_conflict', 'causal_correction_integrity',
    'causal_contradiction_invalid', 'causal_contradiction_forbidden', 'causal_contradiction_oversize', 'causal_contradiction_audit_failed', 'causal_contradiction_conflict', 'causal_contradiction_integrity', 'unresolved_contradiction',
    'reuse_decision_unavailable', 'reuse_decision_forbidden', 'invalid_reuse_decision', 'reuse_evidence_invalid', 'reuse_evidence_diverged',
    'reuse_evidence_stale', 'reuse_environment_mismatch', 'reuse_tree_dirty', 'reuse_repo_mismatch', 'reuse_namespace_conflict',
    'reuse_borrow_blocked', 'reuse_decision_conflict', 'reuse_decision_exists', 'reuse_recheck_unavailable', 'reuse_recheck_forbidden',
    'invalid_reuse_recheck', 'reuse_risk_conflict', 'reuse_ttl_conflict', 'reuse_risk_guarded', 'reuse_risk_stale', 'reuse_not_expired', 'reuse_decision_not_found', 'stale_version',
    'goal_plan_invalid', 'goal_plan_unauthorized', 'goal_plan_unavailable', 'goal_plan_required', 'goal_plan_status_invalid', 'goal_plan_status_oversize', 'not_found', 'duplicate_task',
    'goal_conflict', 'goal_predecessor_required', 'goal_stale', 'goal_too_large', 'goal_version_limit', 'goal_weakened',
    'plan_approval_conflict', 'plan_approval_expired', 'plan_approval_invalid', 'plan_approval_stale', 'plan_brief_mismatch', 'plan_budget_exceeded',
    'plan_conflict', 'plan_cycle', 'plan_dangling_dependency', 'plan_dependency_incomplete', 'plan_dependency_mismatch', 'plan_dispatch_conflict',
    'plan_dispatch_invalid', 'plan_dispatch_stale', 'plan_duplicate_node', 'plan_effect_invalid', 'plan_effect_mismatch', 'plan_goal_mismatch',
    'plan_node_invalid', 'plan_node_limit', 'plan_node_not_found', 'plan_not_approved', 'plan_predecessor_required', 'plan_route_mismatch',
    'plan_scope_invalid', 'plan_self_approval', 'plan_stale', 'plan_too_large', 'plan_verification_invalid', 'plan_version_limit',
    'coordinator_drain_capacity', 'coordinator_drain_incomplete', 'coordinator_draining', 'coordinator_closed'].includes(cause?.code)) return cause.code;
  if (['ModelSelectionError', 'SessionSelectionError', 'DuplicateTaskIdError', 'UnknownVendorError', 'DependencyCycleError', 'TypeError'].includes(cause?.name)) return 'invalid_command';
  if (cause?.name === 'WorkerNotFoundError') return 'not_found';
  return 'command_outcome_unknown';
}
function protocolResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function protocolError(id, code, message, data) {
  if (id === undefined) return null;
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}
function actionShape(action, required, forbidden) {
  return {
    properties: { action: { const: action } }, required: ['action', ...required],
    not: { anyOf: forbidden.map((key) => ({ required: [key] })) },
  };
}
const text = { type: 'string', minLength: 1 };
const textArray = { type: 'array', items: text };
const runId = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const repo = { repoId: text };
const idem = { idempotencyKey: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$' } };
const fence = { expectedFence: { type: 'integer' } };
const goalRefSchema = schema({ goalId: { type: 'string', pattern: '^goal:[a-f0-9]{64}$' }, version: { type: 'integer', minimum: 1 }, digest }, ['goalId', 'version', 'digest']);
const planRefSchema = schema({ planId: { type: 'string', pattern: '^plan:[a-f0-9]{64}$' }, version: { type: 'integer', minimum: 1 }, digest }, ['planId', 'version', 'digest']);
const goalPlanBudgetSchema = schema({
  tokens: { type: 'integer', minimum: 1 }, usd: { type: 'number', minimum: 0 },
  wallMin: { type: 'integer', minimum: 1 }, providerTurns: { type: 'integer', minimum: 1 },
}, ['tokens', 'usd', 'wallMin', 'providerTurns']);
const goalPlanVerificationSchema = schema({
  command: text, arguments: { type: 'array', items: { type: 'string' } }, cwd: text,
  envAllowlist: textArray, expectExit: { type: 'integer', minimum: 0, maximum: 255 },
  expectResult: { type: 'string', enum: ['exit_code'] }, timeoutMs: { type: 'integer', minimum: 1 },
  maxOutputBytes: { type: 'integer', minimum: 1 }, requiredPredecessorEvidence: textArray,
}, ['command', 'arguments', 'cwd', 'envAllowlist', 'expectExit', 'expectResult', 'timeoutMs', 'maxOutputBytes', 'requiredPredecessorEvidence']);
const goalPlanRoutesSchema = schema({ harnesses: textArray, models: textArray, efforts: textArray }, ['harnesses', 'models', 'efforts']);
const goalPlanNodeSchema = schema({
  key: text, objective: text, definitionOfDone: textArray, deps: textArray, pathScope: textArray, risk: text,
  budget: goalPlanBudgetSchema, verification: goalPlanVerificationSchema, routes: goalPlanRoutesSchema,
  capabilities: textArray, effects: textArray,
}, ['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects']);
const spawnGoalPlanSchema = schema({
  goalId: { type: 'string', pattern: '^goal:[a-f0-9]{64}$' }, goalVersion: { type: 'integer', minimum: 1 }, goalDigest: digest,
  planId: { type: 'string', pattern: '^plan:[a-f0-9]{64}$' }, planVersion: { type: 'integer', minimum: 1 }, planDigest: digest,
  nodeKey: text, expectedDispatchVersion: { type: 'integer', minimum: 0 }, capabilities: textArray, effects: textArray,
}, ['goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'nodeKey', 'expectedDispatchVersion', 'capabilities', 'effects']);
const TOOL_DEFINITIONS = Object.freeze([
  { name: 'fleet_spawn', description: 'Spawn one Baton worker with independently selected harness, model, effort, run, and approved Goal/Plan node.', inputSchema: schema({ ...repo, ...idem, runId, harness: text, model: text, effort: text, modelPolicy: schema({ allow: textArray, deny: textArray, prefer: textArray, allowFamilies: textArray, denyFamilies: textArray, reasoningEffort: text, serviceTier: text }), brief: { type: 'object' }, taskId: text, deps: textArray, taskType: text, session: schema({ mode: { type: 'string', enum: ['new', 'resume', 'fork'] }, id: text, lastTurnId: text, context: schema({ worktree: text, repoRoot: text, baseSha: text, branch: text, ownerTaskId: text }, ['worktree']) }), refines: text, goalPlan: spawnGoalPlanSchema }, ['repoId', 'idempotencyKey', 'harness', 'brief']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_scratch_oracle', description: 'Spawn an explicitly routed independent oracle over one immutable derived Scratch fact.', inputSchema: schema({ ...repo, ...idem, runId, scratchFactId: text, harness: text, model: text, effort: text, modelPolicy: schema({ allow: textArray, deny: textArray, prefer: textArray, allowFamilies: textArray, denyFamilies: textArray, reasoningEffort: text, serviceTier: text }), verification: { type: 'object' }, budget: { type: 'object' }, constraints: textArray, goal: text, definitionOfDone: text, taskId: text }, ['repoId', 'idempotencyKey', 'scratchFactId', 'harness', 'verification']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_goal_define', description: 'Define one immutable bounded Goal version under the injected repository principal.', inputSchema: schema({
    ...repo, ...idem, runId, objective: text, definitionOfDone: textArray, constraints: textArray, risk: text,
    budget: goalPlanBudgetSchema, predecessor: { oneOf: [goalRefSchema, { type: 'null' }] },
  }, ['repoId', 'idempotencyKey', 'objective', 'definitionOfDone', 'constraints', 'risk', 'budget', 'predecessor']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_plan_propose', description: 'Propose one immutable bounded Plan DAG against an exact Goal version.', inputSchema: schema({
    ...repo, ...idem, runId, goal: goalRefSchema, predecessor: { oneOf: [planRefSchema, { type: 'null' }] },
    nodes: { type: 'array', minItems: 1, items: goalPlanNodeSchema },
  }, ['repoId', 'idempotencyKey', 'goal', 'predecessor', 'nodes']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_plan_approve', description: 'Record one distinct-principal disposition over an exact Plan digest.', inputSchema: schema({
    ...repo, ...idem, runId, goal: goalRefSchema, plan: planRefSchema,
    expectedDisposition: { type: 'null' }, disposition: { type: 'string', enum: ['approved', 'rejected'] },
  }, ['repoId', 'idempotencyKey', 'goal', 'plan', 'expectedDisposition', 'disposition']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_goal_plan_status', description: 'Read a bounded replay-validated Goal/Plan projection at an exact event boundary.', inputSchema: schema({
    ...repo, runId, goalId: { type: 'string', pattern: '^goal:[a-f0-9]{64}$' }, planId: { type: 'string', pattern: '^plan:[a-f0-9]{64}$' },
    throughSeq: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  }, ['repoId', 'goalId', 'planId', 'throughSeq']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_send', description: 'Send a turn, steer, or nudge to a fenced worker.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text, message: text, mode: { type: 'string', enum: ['turn', 'steer', 'nudge'] } }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId', 'message', 'mode']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_wait', description: 'Wait for fleet events for at most the host-safe bounded interval.', inputSchema: schema({ ...repo, timeoutMs: { type: 'integer', minimum: 0 } }, ['repoId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_respond', description: 'Answer one pending approval or question.', inputSchema: schema({ ...repo, ...idem, requestId: text, answer: {} }, ['repoId', 'idempotencyKey', 'requestId', 'answer']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_interrupt', description: 'Interrupt a fenced worker, optionally with a follow-up instruction.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text, then: text }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_result', description: 'Read the current or terminal result for one worker.', inputSchema: schema({ ...repo, workerId: text }, ['repoId', 'workerId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_list', description: 'List workers visible to the injected repository authority.', inputSchema: schema({ ...repo }, ['repoId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_capabilities', description: 'List capability cards visible through the coordinator-owned registry.', inputSchema: schema({ ...repo }, ['repoId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_provider_status', description: 'Read bounded sanitized provider health and processing summaries for the authenticated repository.', inputSchema: schema({ ...repo, providerId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }, after: { type: 'string', pattern: '^provider-processing:[a-f0-9]{64}$' }, limit: { type: 'integer', minimum: 1 } }, ['repoId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_capability_invoke', description: 'Invoke, resume, reverify, or push one coordinator-owned fleet capability.', inputSchema: {
    ...schema({
    ...repo, ...idem, name: text, op: text, action: { type: 'string', enum: ['invoke', 'resume', 'reverify', 'push'] },
    args: { type: 'object' }, budgetTokens: { type: 'integer', minimum: 1 }, ref: { type: 'object' }, cursor: text, claim: { type: 'object' },
    workerId: text, note: { type: 'string', minLength: 1, maxLength: 2_048 }, expectedFence: { type: 'integer' },
    }, ['repoId', 'idempotencyKey', 'name', 'op', 'action', 'budgetTokens']),
    oneOf: [
      actionShape('invoke', ['args'], ['ref', 'cursor', 'claim', 'workerId', 'note', 'expectedFence']),
      actionShape('resume', ['ref', 'cursor'], ['args', 'claim', 'workerId', 'note', 'expectedFence']),
      actionShape('reverify', ['claim', 'args'], ['ref', 'cursor', 'workerId', 'note', 'expectedFence']),
      actionShape('push', ['args', 'workerId', 'note', 'expectedFence'], ['ref', 'cursor', 'claim']),
    ],
  }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_reuse_decide', description: 'Record one immutable build-or-borrow decision from freshly reverified dossier and actual-lockfile SBOM evidence.', inputSchema: schema({
    ...repo, ...idem, need: text, choice: { type: 'string', enum: ['borrow', 'build'] }, rationale: text,
    dossier: { type: 'object' }, sbom: { type: 'object' }, supersedes: { type: 'object' }, budgetTokens: { type: 'integer', minimum: 1 },
  }, ['repoId', 'idempotencyKey', 'need', 'choice', 'rationale', 'dossier', 'sbom', 'budgetTokens']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_reuse_recheck', description: 'Expire one reuse Decision or force an official advisory refresh and atomically guard every matching live subject.', inputSchema: schema({
    ...repo, ...idem, decisionId: text, expectedValidityVersion: { type: 'integer', minimum: 1 },
    trigger: { type: 'string', enum: ['advisory_refresh', 'ttl_expired'] }, budgetTokens: { type: 'integer', minimum: 1 },
  }, ['repoId', 'idempotencyKey', 'decisionId', 'expectedValidityVersion', 'trigger', 'budgetTokens']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } },
  { name: 'fleet_kill', description: 'Kill and reap one fenced worker.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_drain', description: 'Drain and reap the coordinator-owned local fleet while retaining transport and writer authority.', inputSchema: schema({ ...repo, ...idem }, ['repoId', 'idempotencyKey']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
].map((tool) => Object.freeze({ ...tool, execution: Object.freeze({ taskSupport: 'forbidden' }) })));
const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

function closedRecord(value, fields) {
  return record(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}
function validTextArray(value, { empty = true } = {}) {
  return Array.isArray(value) && (empty || value.length > 0) && value.every(nonempty);
}
function validGoalRef(value) {
  return closedRecord(value, ['goalId', 'version', 'digest']) && /^goal:[a-f0-9]{64}$/.test(value.goalId ?? '')
    && Number.isSafeInteger(value.version) && value.version > 0 && /^[a-f0-9]{64}$/.test(value.digest ?? '');
}
function validPlanRef(value) {
  return closedRecord(value, ['planId', 'version', 'digest']) && /^plan:[a-f0-9]{64}$/.test(value.planId ?? '')
    && Number.isSafeInteger(value.version) && value.version > 0 && /^[a-f0-9]{64}$/.test(value.digest ?? '');
}
function validGoalPlanBudget(value) {
  return closedRecord(value, ['tokens', 'usd', 'wallMin', 'providerTurns'])
    && Number.isSafeInteger(value.tokens) && value.tokens > 0 && Number.isFinite(value.usd) && value.usd >= 0
    && Number.isSafeInteger(value.wallMin) && value.wallMin > 0 && Number.isSafeInteger(value.providerTurns) && value.providerTurns > 0;
}
function validGoalPlanVerification(value) {
  return closedRecord(value, ['command', 'arguments', 'cwd', 'envAllowlist', 'expectExit', 'expectResult', 'timeoutMs', 'maxOutputBytes', 'requiredPredecessorEvidence']) && nonempty(value.command)
    && Array.isArray(value.arguments) && value.arguments.every((argument) => typeof argument === 'string')
    && nonempty(value.cwd) && validTextArray(value.envAllowlist) && value.expectResult === 'exit_code'
    && Number.isSafeInteger(value.expectExit) && value.expectExit >= 0 && value.expectExit <= 255
    && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0
    && Number.isSafeInteger(value.maxOutputBytes) && value.maxOutputBytes > 0
    && validTextArray(value.requiredPredecessorEvidence);
}
function validGoalPlanRoutes(value) {
  return closedRecord(value, ['harnesses', 'models', 'efforts'])
    && validTextArray(value.harnesses, { empty: false })
    && validTextArray(value.models, { empty: false })
    && validTextArray(value.efforts, { empty: false });
}
function validGoalPlanNode(value) {
  return closedRecord(value, ['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects'])
    && nonempty(value.key) && nonempty(value.objective) && validTextArray(value.definitionOfDone) && validTextArray(value.deps)
    && validTextArray(value.pathScope, { empty: false }) && nonempty(value.risk) && validGoalPlanBudget(value.budget)
    && validGoalPlanVerification(value.verification) && validGoalPlanRoutes(value.routes)
    && validTextArray(value.capabilities) && validTextArray(value.effects);
}
function validSpawnGoalPlan(value) {
  return closedRecord(value, ['goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'nodeKey', 'expectedDispatchVersion', 'capabilities', 'effects'])
    && /^goal:[a-f0-9]{64}$/.test(value.goalId ?? '') && Number.isSafeInteger(value.goalVersion) && value.goalVersion > 0
    && /^[a-f0-9]{64}$/.test(value.goalDigest ?? '') && /^plan:[a-f0-9]{64}$/.test(value.planId ?? '')
    && Number.isSafeInteger(value.planVersion) && value.planVersion > 0 && /^[a-f0-9]{64}$/.test(value.planDigest ?? '')
    && nonempty(value.nodeKey) && value.expectedDispatchVersion === 0
    && validTextArray(value.capabilities) && validTextArray(value.effects);
}

function validateArguments(name, args) {
  if (!record(args)) return 'invalid_arguments';
  const schemaDefinition = TOOL_BY_NAME.get(name).inputSchema;
  if (Object.keys(args).some((key) => !Object.hasOwn(schemaDefinition.properties, key))) return 'unknown_argument_field';
  if (name === 'fleet_capability_invoke' && !Object.hasOwn(args, 'action')) return 'invalid_capability_invocation';
  if (schemaDefinition.required.some((key) => !Object.hasOwn(args, key))) return 'missing_argument';
  if (containsForbidden(args)) return 'credential_fields_forbidden';
  if (!nonempty(args.repoId)) return 'invalid_repo';
  if (STATEFUL.has(name) && !SAFE_ID.test(args.idempotencyKey ?? '')) return 'invalid_idempotency_key';
  if (FENCED.has(name) && !Number.isSafeInteger(args.expectedFence)) return 'expected_fence_required';
  if (name === 'fleet_spawn') {
    if (!nonempty(args.harness) || !record(args.brief)) return 'invalid_spawn';
    if (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')) return 'invalid_run_id';
    if (Object.hasOwn(args, 'model') && !nonempty(args.model)) return 'invalid_model';
    if (Object.hasOwn(args, 'effort') && !nonempty(args.effort)) return 'invalid_effort';
    if (Object.hasOwn(args, 'modelPolicy') && !record(args.modelPolicy)) return 'invalid_model_policy';
    if (record(args.modelPolicy)) {
      if (Object.keys(args.modelPolicy).some((key) => !MODEL_POLICY_FIELDS.has(key))) return 'invalid_model_policy';
      for (const key of ['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies']) {
        if (Object.hasOwn(args.modelPolicy, key) && (!Array.isArray(args.modelPolicy[key]) || !args.modelPolicy[key].every(nonempty))) return 'invalid_model_policy';
      }
      for (const key of ['reasoningEffort', 'serviceTier']) if (Object.hasOwn(args.modelPolicy, key) && !nonempty(args.modelPolicy[key])) return 'invalid_model_policy';
    }
    if (Object.hasOwn(args, 'deps') && (!Array.isArray(args.deps) || !args.deps.every(nonempty))) return 'invalid_dependencies';
    if (Object.hasOwn(args, 'goalPlan') && !validSpawnGoalPlan(args.goalPlan)) return 'invalid_goal_plan';
    if (Object.hasOwn(args, 'session')) {
      if (!record(args.session) || Object.keys(args.session).some((key) => !SESSION_FIELDS.has(key))) return 'invalid_session';
      const mode = args.session.mode ?? 'new';
      if (!['new', 'resume', 'fork'].includes(mode) || (mode !== 'new' && !nonempty(args.session.id))) return 'invalid_session';
      if (Object.hasOwn(args.session, 'lastTurnId') && (mode !== 'fork' || !nonempty(args.session.lastTurnId))) return 'invalid_session';
      if (Object.hasOwn(args.session, 'context') && (!record(args.session.context)
        || Object.keys(args.session.context).some((key) => !SESSION_CONTEXT_FIELDS.has(key))
        || !nonempty(args.session.context.worktree))) return 'invalid_session';
    }
  }
  if (name === 'fleet_goal_define' && (!nonempty(args.objective) || !validTextArray(args.definitionOfDone, { empty: false })
    || !validTextArray(args.constraints) || !nonempty(args.risk) || !validGoalPlanBudget(args.budget)
    || (args.predecessor !== null && !validGoalRef(args.predecessor))
    || (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')))) return 'invalid_goal';
  if (name === 'fleet_plan_propose' && (!validGoalRef(args.goal) || (args.predecessor !== null && !validPlanRef(args.predecessor))
    || !Array.isArray(args.nodes) || args.nodes.length === 0 || !args.nodes.every(validGoalPlanNode)
    || (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')))) return 'invalid_plan';
  if (name === 'fleet_plan_approve' && (!validGoalRef(args.goal) || !validPlanRef(args.plan) || args.expectedDisposition !== null
    || !['approved', 'rejected'].includes(args.disposition)
    || (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')))) return 'invalid_plan_approval';
  if (name === 'fleet_goal_plan_status' && (!/^goal:[a-f0-9]{64}$/.test(args.goalId ?? '') || !/^plan:[a-f0-9]{64}$/.test(args.planId ?? '')
    || (args.throughSeq !== null && (!Number.isSafeInteger(args.throughSeq) || args.throughSeq < 0))
    || (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')))) return 'invalid_goal_plan_status';
  if (name === 'fleet_scratch_oracle') {
    if (!nonempty(args.scratchFactId) || !nonempty(args.harness) || !record(args.verification) || !nonempty(args.verification.command)
      || typeof args.verification.expectExit !== 'number' || Object.keys(args.verification).some((key) => !VERIFICATION_FIELDS.has(key))) return 'invalid_scratch_oracle';
    if (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')) return 'invalid_run_id';
    if (Object.hasOwn(args, 'model') && !nonempty(args.model)) return 'invalid_model';
    if (Object.hasOwn(args, 'effort') && !nonempty(args.effort)) return 'invalid_effort';
    if (Object.hasOwn(args, 'modelPolicy') && (!record(args.modelPolicy) || Object.keys(args.modelPolicy).some((key) => !MODEL_POLICY_FIELDS.has(key)))) return 'invalid_model_policy';
    if (Object.hasOwn(args, 'budget') && (!record(args.budget) || Object.keys(args.budget).some((key) => !BUDGET_FIELDS.has(key)))) return 'invalid_budget';
    if (Object.hasOwn(args, 'constraints') && (!Array.isArray(args.constraints) || !args.constraints.every(nonempty))) return 'invalid_constraints';
  }
  if (['fleet_send', 'fleet_interrupt', 'fleet_result', 'fleet_kill'].includes(name) && !nonempty(args.workerId)) return 'invalid_worker';
  if (name === 'fleet_provider_status' && ((Object.hasOwn(args, 'providerId') && !/^[A-Za-z0-9._:-]{1,128}$/.test(args.providerId ?? ''))
    || (Object.hasOwn(args, 'after') && !/^provider-processing:[a-f0-9]{64}$/.test(args.after ?? ''))
    || (Object.hasOwn(args, 'limit') && (!Number.isSafeInteger(args.limit) || args.limit <= 0)))) return 'invalid_provider_read';
  if (name === 'fleet_send' && (!nonempty(args.message) || !['turn', 'steer', 'nudge'].includes(args.mode))) return 'invalid_send';
  if (name === 'fleet_respond' && !nonempty(args.requestId)) return 'invalid_request';
  if (name === 'fleet_wait' && Object.hasOwn(args, 'timeoutMs') && (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 0)) return 'invalid_timeout';
  if (name === 'fleet_capability_invoke') {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(args.name ?? '') || !nonempty(args.op) || args.op.length > 256
      || !Number.isSafeInteger(args.budgetTokens) || args.budgetTokens <= 0) return 'invalid_capability_invocation';
    if (!Object.hasOwn(args, 'action')) return 'invalid_capability_invocation';
    const action = args.action;
    if (!['invoke', 'resume', 'reverify', 'push'].includes(action)) return 'invalid_capability_invocation';
    if (action === 'invoke' && (!record(args.args) || ['ref', 'cursor', 'claim', 'workerId', 'note', 'expectedFence'].some((key) => Object.hasOwn(args, key)))) return 'invalid_capability_invocation';
    if (action === 'resume' && (!record(args.ref) || !nonempty(args.cursor) || args.cursor.length > 4_096 || ['args', 'claim', 'workerId', 'note', 'expectedFence'].some((key) => Object.hasOwn(args, key)))) return 'invalid_capability_invocation';
    if (action === 'reverify' && (!record(args.claim) || !record(args.args) || ['ref', 'cursor', 'workerId', 'note', 'expectedFence'].some((key) => Object.hasOwn(args, key)))) return 'invalid_capability_invocation';
    if (action === 'push' && (args.name !== 'cartographer-quartermaster' || args.op !== 'orientation.slice'
      || !record(args.args) || !nonempty(args.workerId) || !nonempty(args.note) || Buffer.byteLength(args.note) > 2_048
      || !Number.isSafeInteger(args.expectedFence) || Object.hasOwn(args, 'ref') || Object.hasOwn(args, 'cursor') || Object.hasOwn(args, 'claim'))) return 'invalid_capability_invocation';
  }
  if (name === 'fleet_reuse_decide' && (!nonempty(args.need) || !['borrow', 'build'].includes(args.choice) || !nonempty(args.rationale)
    || !record(args.dossier) || !record(args.sbom) || !Number.isSafeInteger(args.budgetTokens) || args.budgetTokens <= 0
    || Object.keys(args.dossier ?? {}).some((key) => !['claim', 'args'].includes(key)) || Object.keys(args.sbom ?? {}).some((key) => !['claim', 'args'].includes(key))
    || (Object.hasOwn(args, 'supersedes') && (!record(args.supersedes)
      || Object.keys(args.supersedes).some((key) => !['decisionId', 'expectedValidityVersion'].includes(key))
      || !nonempty(args.supersedes.decisionId) || !Number.isSafeInteger(args.supersedes.expectedValidityVersion) || args.supersedes.expectedValidityVersion <= 0)))) return 'invalid_reuse_decision';
  if (name === 'fleet_reuse_recheck' && (!nonempty(args.decisionId) || !Number.isSafeInteger(args.expectedValidityVersion) || args.expectedValidityVersion <= 0
    || !['advisory_refresh', 'ttl_expired'].includes(args.trigger) || !Number.isSafeInteger(args.budgetTokens) || args.budgetTokens <= 0)) return 'invalid_reuse_recheck';
  return null;
}

export class McpFleetServer {
  constructor(opts) {
    if (!opts?.coordinator || !opts?.coordination || !record(opts.principal)) throw new TypeError('MCP northbound requires coordinator, coordination, and injected principal');
    for (const method of ['admitMcpCall', 'completeMcpCall', 'failMcpCall', 'mcpCall', 'recordMcpAudit']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`coordination authority is missing ${method}()`);
    }
    if (typeof opts.takeToolQuota !== 'function') throw new TypeError('MCP northbound requires an injected tool quota authority');
    this.coordinator = opts.coordinator;
    this.coordination = opts.coordination;
    this.principal = Object.freeze(clone(opts.principal));
    this.repoIds = new Set(opts.repoIds ?? []);
    this.now = opts.now ?? Date.now;
    this.maxWaitMs = opts.maxWaitMs ?? 25_000;
    this.maxMessageBytes = opts.maxMessageBytes;
    this.takeToolQuota = opts.takeToolQuota;
    if (!Number.isSafeInteger(this.maxWaitMs) || this.maxWaitMs <= 0) throw new TypeError('maxWaitMs must be a positive safe integer');
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes <= 0) throw new TypeError('maxMessageBytes must be a deployment-derived positive safe integer');
    this.lifecycle = 'new';
    this._drainDispatches = new Map();
  }

  callScope(tool, args) {
    return hash({ channel: 'mcp', userId: this.principal.userId, tool, repoId: args.repoId, idempotencyKey: args.idempotencyKey });
  }

  callDigest(args) {
    const { idempotencyKey: _key, ...semantic } = args;
    return hash(semantic);
  }

  _authority(name, args) {
    const p = this.principal;
    const expiresAt = Date.parse(p.expiresAt);
    if (!nonempty(p.userId) || !nonempty(p.sessionId) || p.revoked === true || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return 'unauthenticated';
    if (!Array.isArray(p.capabilities) || !p.capabilities.includes(CAPABILITY[name])) return 'forbidden';
    if (!this.repoIds.has(args.repoId) || !Array.isArray(p.repoIds) || !p.repoIds.includes(args.repoId)) return 'forbidden';
    return null;
  }

  _audit(kind, tool, args, detail = null) {
    return this.coordination.recordMcpAudit({
      kind, tool, userId: this.principal.userId, sessionId: this.principal.sessionId,
      repoId: nonempty(args?.repoId) ? args.repoId : null, detail,
    }, { actor: `mcp:${this.principal.userId}:${this.principal.sessionId}`, key: `mcp.audit:${randomUUID()}` });
  }

  async handle(message) {
    if (!record(message) || message.jsonrpc !== '2.0' || !nonempty(message.method)) return protocolError(message?.id ?? null, -32600, 'Invalid Request');
    const { id, method, params } = message;
    if (method === 'initialize') {
      if (this.lifecycle !== 'new') return protocolError(id, -32600, 'Invalid Request');
      if (id === undefined || !record(params) || !nonempty(params.protocolVersion) || !record(params.capabilities)
        || !record(params.clientInfo) || !nonempty(params.clientInfo.name) || !nonempty(params.clientInfo.version)) return protocolError(id, -32602, 'Invalid params');
      this.lifecycle = 'initializing';
      return protocolResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'baton', version: '0.1.0' } });
    }
    if (method === 'notifications/initialized') {
      if (id !== undefined) return protocolError(id, -32600, 'Invalid Request');
      if (this.lifecycle === 'initializing') this.lifecycle = 'ready';
      return null;
    }
    if (method === 'ping') return id === undefined ? null : protocolResult(id, {});
    if (this.lifecycle !== 'ready') return protocolError(id, -32002, 'Server not initialized');
    if (method === 'tools/list') return id === undefined ? null : protocolResult(id, { tools: TOOL_DEFINITIONS.map(clone) });
    if (method !== 'tools/call') return protocolError(id, -32601, 'Method not found');
    if (id === undefined || !record(params) || !nonempty(params.name) || !TOOL_BY_NAME.has(params.name)) return protocolError(id, -32602, 'Invalid params');
    const args = params.arguments ?? {};
    const invalid = validateArguments(params.name, args);
    if (invalid) {
      try { this._audit('tool_invalid', params.name, args, invalid); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError(invalid));
    }
    const refused = this._authority(params.name, args);
    if (refused) {
      try { this._audit('tool_refused', params.name, args, refused); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError(refused));
    }
    let quota;
    try { quota = await this.takeToolQuota({ userId: this.principal.userId, sessionId: this.principal.sessionId, tool: params.name, repoId: args.repoId }); }
    catch { return protocolResult(id, toolError('temporarily_unavailable')); }
    if (!quota?.ok) {
      try { this._audit('tool_rate_limited', params.name, args); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError('rate_limited'));
    }
    return protocolResult(id, await this._callTool(params.name, args));
  }

  async _callTool(name, args) {
    if (!STATEFUL.has(name)) {
      try {
        const outcome = toolResult(await this._dispatch(name, args));
        this._audit('tool_completed', name, args);
        return outcome;
      } catch (cause) {
        try { this._audit('tool_failed', name, args, 'command_failed'); }
        catch { return toolError('temporarily_unavailable'); }
        return toolError(name === 'fleet_goal_plan_status' ? stateFailureCode(cause) : 'command_failed');
      }
    }
    const callId = randomUUID();
    const scopeKey = this.callScope(name, args);
    const actor = `mcp:${this.principal.userId}:${this.principal.sessionId}`;
    let admission;
    try {
      admission = this.coordination.admitMcpCall({ callId, scopeKey, requestDigest: this.callDigest(args), tool: name, repoId: args.repoId, userId: this.principal.userId, sessionId: this.principal.sessionId }, { actor, key: `mcp.admit:${scopeKey}` });
    } catch { return toolError('temporarily_unavailable'); }
    if (!admission.ok) return toolError(admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_call');
    if (admission.result === 'replay') {
      if (admission.call.status === 'admitted' && name === 'fleet_drain') {
        const callId = admission.call.callId;
        const admittedActor = `mcp:${admission.call.userId}:${admission.call.sessionId ?? this.principal.sessionId}`;
        let outcome;
        try { outcome = toolResult(await this._dispatchDrain(args, admittedActor, callId)); }
        catch (cause) {
          outcome = toolError(stateFailureCode(cause));
          try { this.coordination.failMcpCall(callId, outcome, { actor: admittedActor, key: `mcp.fail:${callId}` }); }
          catch { return toolError('temporarily_unavailable'); }
          return outcome;
        }
        try { this.coordination.completeMcpCall(callId, outcome, { actor: admittedActor, key: `mcp.complete:${callId}` }); }
        catch { return toolError('temporarily_unavailable'); }
        return outcome;
      }
      if (admission.call.status === 'admitted' && (RECONCILABLE.has(name) || (name === 'fleet_spawn' && args.goalPlan))) {
        const admittedCallId = admission.call.callId;
        const admittedActor = `mcp:${admission.call.userId}:${admission.call.sessionId ?? this.principal.sessionId}`;
        const admittedPrincipal = {
          ...this.principal,
          userId: admission.call.userId,
          sessionId: admission.call.sessionId ?? this.principal.sessionId,
        };
        let outcome;
        try { outcome = toolResult(await this._dispatch(name, args, admittedActor, admittedCallId, admittedPrincipal)); }
        catch (cause) {
          outcome = toolError(stateFailureCode(cause));
          try { this.coordination.failMcpCall(admittedCallId, outcome, { actor: admittedActor, key: `mcp.fail:${admittedCallId}` }); }
          catch { return toolError('temporarily_unavailable'); }
          return outcome;
        }
        try { this.coordination.completeMcpCall(admittedCallId, outcome, { actor: admittedActor, key: `mcp.complete:${admittedCallId}` }); }
        catch { return toolError('temporarily_unavailable'); }
        return outcome;
      }
      if (admission.call.status === 'admitted') return toolError('call_admitted');
      if (admission.call.status === 'completed' && ['fleet_reuse_decide', 'fleet_reuse_recheck'].includes(name)) {
        try { return toolResult(await this._dispatch(name, args, actor, admission.call.callId)); } catch { return toolError('temporarily_unavailable'); }
      }
      if (GOAL_PLAN_MUTATIONS.has(name)) {
        const prior = admission.call.outcome;
        if (!record(prior?.structuredContent)) return toolError('command_outcome_unknown');
        return toolResult(sanitizeGoalPlanProjection(prior.structuredContent), prior.isError === true);
      }
      return clone(admission.call.outcome);
    }
    let outcome;
    try { outcome = toolResult(await (name === 'fleet_drain' ? this._dispatchDrain(args, actor, callId) : this._dispatch(name, args, actor, callId))); }
    catch (cause) {
      outcome = toolError(stateFailureCode(cause));
      try { this.coordination.failMcpCall(callId, outcome, { actor, key: `mcp.fail:${callId}` }); }
      catch { return toolError('temporarily_unavailable'); }
      return outcome;
    }
    try { this.coordination.completeMcpCall(callId, outcome, { actor, key: `mcp.complete:${callId}` }); }
    catch { return toolError('temporarily_unavailable'); }
    return outcome;
  }

  _dispatchDrain(args, actor, callId) {
    const existing = this._drainDispatches.get(callId);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => this._dispatch('fleet_drain', args, actor, callId));
    this._drainDispatches.set(callId, pending);
    void pending.then(
      () => { if (this._drainDispatches.get(callId) === pending) this._drainDispatches.delete(callId); },
      () => { if (this._drainDispatches.get(callId) === pending) this._drainDispatches.delete(callId); },
    );
    return pending;
  }

  async _dispatch(name, args, actor, callId, principal = this.principal) {
    let value;
    if (name === 'fleet_spawn') value = await this.coordinator.spawn(args.harness, args.brief, {
      model: args.model, effort: args.effort, modelPolicy: args.modelPolicy, taskId: args.taskId ?? `mcp-${callId}`,
      deps: args.deps, taskType: args.taskType, session: args.session, refines: args.refines,
      runId: args.runId ?? null,
      goalPlan: args.goalPlan,
      actor, principalId: principal.userId, sessionId: principal.sessionId, powers: clone(principal.capabilities),
      idempotencyKey: `mcp.call:${callId}`,
    });
    else if (name === 'fleet_scratch_oracle') value = await this.coordinator.spawnScratchOracle(args.scratchFactId, args.harness, {
      model: args.model, effort: args.effort, modelPolicy: args.modelPolicy, verification: args.verification,
      budget: args.budget, constraints: args.constraints, goal: args.goal, definitionOfDone: args.definitionOfDone,
      taskId: args.taskId ?? `mcp-${callId}`, runId: args.runId ?? null,
      actor: `operator:${actor}`, idempotencyKey: `mcp.call:${callId}`,
    });
    else if (name === 'fleet_goal_define') value = await this.coordinator.defineGoal({
      objective: args.objective, definitionOfDone: args.definitionOfDone, constraints: args.constraints,
      risk: args.risk, budget: args.budget, predecessor: args.predecessor,
    }, this._goalPlanContext(name, args, actor, callId, principal));
    else if (name === 'fleet_plan_propose') value = await this.coordinator.proposePlan({
      goal: args.goal, predecessor: args.predecessor, nodes: args.nodes,
    }, this._goalPlanContext(name, args, actor, callId, principal));
    else if (name === 'fleet_plan_approve') value = await this.coordinator.approvePlan({
      goal: args.goal, plan: args.plan, expectedDisposition: args.expectedDisposition, disposition: args.disposition,
    }, this._goalPlanContext(name, args, actor, callId, principal));
    else if (name === 'fleet_goal_plan_status') value = await this.coordinator.goalPlanStatus({
      goalId: args.goalId, planId: args.planId, throughSeq: args.throughSeq,
    }, this._goalPlanContext(name, args, actor, callId, principal));
    else if (name === 'fleet_send') value = await this.coordinator.send(args.workerId, args.message, args.mode, { expectedFence: args.expectedFence, actor });
    else if (name === 'fleet_wait') value = await this.coordinator.wait(Math.min(args.timeoutMs ?? this.maxWaitMs, this.maxWaitMs));
    else if (name === 'fleet_respond') value = await this.coordinator.respond(args.requestId, args.answer, actor);
    else if (name === 'fleet_interrupt') value = await this.coordinator.interrupt(args.workerId, args.then, actor, { expectedFence: args.expectedFence });
    else if (name === 'fleet_result') value = await this.coordinator.result(args.workerId);
    else if (name === 'fleet_list') value = this.coordinator.list();
    else if (name === 'fleet_capabilities') value = this.coordinator.capabilityCards();
    else if (name === 'fleet_provider_status') value = this.coordinator.readProviderStatus(Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'repoId')), { repoId: args.repoId });
    else if (name === 'fleet_capability_invoke') {
      const context = { budgetTokens: args.budgetTokens, actor, repoId: args.repoId, idempotencyKey: `mcp.call:${callId}`, transport: 'mcp' };
      const action = args.action;
      if (action === 'invoke') value = typeof this.coordinator.invokeCapabilityNorthbound === 'function' ? await this.coordinator.invokeCapabilityNorthbound('mcp', northboundCapabilityToken('mcp'), args.name, args.op, args.args, context) : await this.coordinator.invokeCapability(args.name, args.op, args.args, context);
      else if (action === 'resume') value = typeof this.coordinator.resumeCapabilityNorthbound === 'function' ? await this.coordinator.resumeCapabilityNorthbound('mcp', northboundCapabilityToken('mcp'), args.name, args.op, args.ref, args.cursor, context) : await this.coordinator.resumeCapability(args.name, args.op, args.ref, args.cursor, context);
      else if (action === 'reverify') value = typeof this.coordinator.reverifyCapabilityNorthbound === 'function' ? await this.coordinator.reverifyCapabilityNorthbound('mcp', northboundCapabilityToken('mcp'), args.name, args.op, args.claim, args.args, context) : await this.coordinator.reverifyCapability(args.name, args.op, args.claim, args.args, context);
      else value = await this.coordinator.orientWorker(args.workerId, args.args, args.note, { ...context, expectedFence: args.expectedFence });
      value = transportCapability(value);
    }
    else if (name === 'fleet_reuse_decide') value = await this.coordinator.decideReuse({ need: args.need, choice: args.choice, rationale: args.rationale, dossier: args.dossier, sbom: args.sbom, ...(args.supersedes ? { supersedes: args.supersedes } : {}) }, { actor, repoId: args.repoId, budgetTokens: args.budgetTokens, idempotencyKey: `mcp.call:${callId}` });
    else if (name === 'fleet_reuse_recheck') value = await this.coordinator.recheckReuseDecision({ decisionId: args.decisionId, expectedValidityVersion: args.expectedValidityVersion, trigger: args.trigger, budgetTokens: args.budgetTokens }, { actor, repoId: args.repoId, budgetTokens: args.budgetTokens, idempotencyKey: `mcp.call:${callId}` });
    else if (name === 'fleet_kill') value = await this.coordinator.kill(args.workerId, actor, { expectedFence: args.expectedFence });
    else if (name === 'fleet_drain') value = await this.coordinator.drain({ actor, repoId: args.repoId, idempotencyKey: `mcp.call:${callId}` });
    if (value?.result === 'stale_fence') throw Object.assign(new Error('stale fence'), { mcpCode: 'stale_fence' });
    return normalized(GOAL_PLAN_MUTATIONS.has(name) ? sanitizeGoalPlanProjection(value) : value);
  }

  _goalPlanContext(name, args, actor, callId, principal = this.principal) {
    return {
      actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
      principalId: principal.userId, sessionId: principal.sessionId,
      powers: clone(principal.capabilities), repoId: args.repoId, runId: args.runId ?? null,
      idempotencyKey: callId ? `mcp.call:${callId}` : `mcp.observe:${hash({ name, args, userId: principal.userId })}`,
    };
  }
}

async function writeFrame(output, frame) {
  if (frame === null) return;
  await new Promise((resolveWrite, rejectWrite) => {
    output.write(`${JSON.stringify(frame)}\n`, (error) => error ? rejectWrite(error) : resolveWrite());
  });
}

export async function serveMcpStdio(server, opts = {}) {
  if (!(server instanceof McpFleetServer)) throw new TypeError('serveMcpStdio requires McpFleetServer');
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const maxLineBytes = opts.maxLineBytes ?? server.maxMessageBytes;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) throw new TypeError('maxLineBytes must be a positive safe integer');
  let buffered = Buffer.alloc(0);
  let discardingOversize = false;
  const processLine = async (line, oversized = false) => {
    if (oversized || line.length > maxLineBytes) return writeFrame(output, protocolError(null, -32700, 'Parse error'));
    let message;
    try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
    catch { return writeFrame(output, protocolError(null, -32700, 'Parse error')); }
    if (Array.isArray(message)) return writeFrame(output, protocolError(null, -32600, 'Invalid Request'));
    return writeFrame(output, await server.handle(message));
  };
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset);
      if (discardingOversize) {
        if (newline === -1) break;
        await processLine(Buffer.alloc(0), true);
        discardingOversize = false;
        offset = newline + 1;
        continue;
      }
      if (newline === -1) {
        const tail = bytes.subarray(offset);
        if (buffered.length + tail.length > maxLineBytes) {
          buffered = Buffer.alloc(0);
          discardingOversize = true;
        } else buffered = Buffer.concat([buffered, tail]);
        break;
      }
      const segment = bytes.subarray(offset, newline);
      if (buffered.length + segment.length > maxLineBytes) await processLine(Buffer.alloc(0), true);
      else {
        let line = buffered.length === 0 ? segment : Buffer.concat([buffered, segment]);
        if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
        await processLine(line);
      }
      buffered = Buffer.alloc(0);
      offset = newline + 1;
    }
  }
  if (discardingOversize) await processLine(Buffer.alloc(0), true);
  if (buffered.length > 0) await processLine(buffered);
}
