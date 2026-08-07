import { createHash, randomUUID } from 'node:crypto';
import { flipFace } from './brand.mjs';
import { BRIEFING_FAMILY } from './coordination-store.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { northboundCapabilityToken } from './northbound-capability-authority.mjs';
import { sanitizeGoalPlanProjection } from './goal-plan.mjs';
import { APPLICATION_COMMAND_DEFINITIONS, validateApplicationCommandArgs, projectBoardView, projectContextPackageBranch } from './application.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY,
  SURFACING_MATRIX_KEYS,
  deriveSurfaceNames,
} from './application-semantics.mjs';

const MCP_APPLICATION_ENTRIES = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.mcp)
  .map(([name, definition]) => [`fleet_${name.replaceAll('.', '_')}`, name, definition]);
// docs/36 §9 M4 (M4b — the transport flip) — the canonical grammar tools rendered beside the
// retained legacy baton_* ordinary tools. Each pairs a §6 operation key with its legacy sibling
// tool and the application command both dispatch to: the canonical tool's NAME comes from the ONE
// shared deriveSurfaceNames, and it inherits the sibling's exact wire schema, annotations, and
// dispatch, so both spellings reach one operation (M4B-3). The fleet_* kernel and reflex tables
// are untouched.
const CANONICAL_ORDINARY_SIBLINGS = Object.freeze([
  ['run.do', 'baton_run_act', 'run.act'],
  ['run.view', 'baton_run_inspect', 'run.inspect'],
  ['run.member.view', 'baton_run_workstreams', 'run.workstreams'],
  ['run.member.send', 'baton_workstream_notify', 'run.workstream.notify'],
  ['run.member.stop', 'baton_workstream_stop', 'run.workstream.stop'],
  ['application.help', 'baton_help', 'application.help'],
].map(([key, legacyTool, command]) => Object.freeze({
  key, legacyTool, command, tool: deriveSurfaceNames(key).mcp,
})));
const APPLICATION_TOOL = Object.freeze(Object.fromEntries(
  [...MCP_APPLICATION_ENTRIES,
    ['baton_help', 'application.help'],
    ['baton_runs', 'runs.list'],
    ['baton_run_start', 'run.start'],
    ['baton_run_inspect', 'run.inspect'],
    ['baton_run_episode', 'run.episode'],
    ['baton_run_workstreams', 'run.workstreams'],
    ['baton_workstream_notify', 'run.workstream.notify'],
    ['baton_workstream_stop', 'run.workstream.stop'],
    ['baton_run_act', 'run.act'],
    ['baton_run_stop', 'run.stop'],
    ['baton_waves_attach', 'waves.attach'],
    ...CANONICAL_ORDINARY_SIBLINGS.map((sibling) => [sibling.tool, sibling.command]),
  ].map(([tool, name]) => [tool, name]),
));
// REFLEX-4 slice A (docs/32 §3.4, issue #19): application.context_eval has no MCP tool here (not
// in MCP_APPLICATION_ENTRIES above, not in ORDINARY_APPLICATION_ENTRIES/
// ORDINARY_APPLICATION_TOOL_DEFINITIONS below) because it is not an APPLICATION_COMMAND_DEFINITIONS
// entry at all — see the note above that table in application.mjs. It is reachable only as a
// direct method call, `application.contextEval(...)`, today.
const ORDINARY_APPLICATION_ENTRIES = Object.freeze([
  ['baton_help', 'application.help', APPLICATION_COMMAND_DEFINITIONS['application.help']],
  ['baton_runs', 'runs.list', APPLICATION_COMMAND_DEFINITIONS['runs.list']],
  ['baton_run_start', 'run.start', APPLICATION_COMMAND_DEFINITIONS['run.start']],
  ['baton_run_inspect', 'run.inspect', APPLICATION_COMMAND_DEFINITIONS['run.inspect']],
  ['baton_run_episode', 'run.episode', APPLICATION_COMMAND_DEFINITIONS['run.episode']],
  ['baton_run_workstreams', 'run.workstreams', APPLICATION_COMMAND_DEFINITIONS['run.workstreams']],
  ['baton_workstream_notify', 'run.workstream.notify', APPLICATION_COMMAND_DEFINITIONS['run.workstream.notify']],
  ['baton_workstream_stop', 'run.workstream.stop', APPLICATION_COMMAND_DEFINITIONS['run.workstream.stop']],
  ['baton_run_act', 'run.act', APPLICATION_COMMAND_DEFINITIONS['run.act']],
  ['baton_run_stop', 'run.stop', APPLICATION_COMMAND_DEFINITIONS['run.stop']],
  // S-1 v2: portable atomic attach-and-harvest (canonical baton_waves_attach).
  ['baton_waves_attach', 'waves.attach', APPLICATION_COMMAND_DEFINITIONS['waves.attach']],
  ...CANONICAL_ORDINARY_SIBLINGS.map((sibling) => (
    [sibling.tool, sibling.command, APPLICATION_COMMAND_DEFINITIONS[sibling.command]]
  )),
]);

export const SURFACING_MATRIX_MCP_ROWS = Object.freeze(
  APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.filter((operation) => (
    SURFACING_MATRIX_KEYS.includes(operation.key) && operation.surfaces.includes('mcp')
  )),
);

const PROTOCOL_VERSION = '2025-11-25';
const CAPABILITY = Object.freeze({
  fleet_spawn: 'control', fleet_scratch_oracle: 'control', fleet_send: 'control', fleet_wait: 'observe', fleet_respond: 'approve',
  fleet_interrupt: 'control', fleet_result: 'observe', fleet_list: 'observe', fleet_capabilities: 'observe',
  fleet_provider_status: 'observe',
  fleet_goal_define: 'goal:define', fleet_plan_propose: 'plan:propose', fleet_plan_approve: 'plan:approve', fleet_goal_plan_status: 'goal:observe',
  fleet_capability_invoke: 'control', fleet_reuse_decide: 'control', fleet_reuse_recheck: 'control', fleet_kill: 'emergency_stop', fleet_drain: 'emergency_stop',
  ...Object.fromEntries(MCP_APPLICATION_ENTRIES.map(([tool, , definition]) => [tool, definition.capabilities])),
  ...Object.fromEntries(ORDINARY_APPLICATION_ENTRIES.map(([tool, , definition]) => [tool, definition.capabilities])),
  // Reflex surface contract Part A (docs/reference/evidence/mcp-reflex-live-2026-07-22/
  // mcp-reflex-surface-decisions.md, table): reflex tools are in NEITHER derivation set above —
  // every reflex tool MUST be registered explicitly here, or `_authority` computes
  // `[undefined]` and refuses with `forbidden`.
  baton_context_eval: ['observe'],
  baton_decision_answer: ['approve', 'observe'],
  // MCP-W1/W2/W3 (mcp-packaging-decisions v1.0): the ordinary-surface wave ergonomics, doctor, and
  // settlement tools. These ride explicit `_dispatch` branches (never APPLICATION_COMMAND_DEFINITIONS
  // keys), so their capability classes are registered here like the reflex tools. waves.stop is
  // the member stop lane (emergency_stop); the settlement lease requires the explicit settlement
  // capability class (single-orchestrator posture — never a default).
  baton_waves_start: ['control', 'observe'],
  baton_waves_progress: ['observe'],
  baton_waves_send: ['control', 'observe'],
  baton_waves_stop: ['emergency_stop', 'observe'],
  baton_waves_list: ['observe'],
  baton_waves_run: ['control', 'observe'],
  baton_deployment_doctor: ['observe'],
  baton_scratchpad_elevate: ['control', 'observe'],
  baton_scratchpad_settle: ['control', 'observe'],
  baton_knowledge_promote: ['control', 'observe'],
  baton_knowledge_settlement_lease: ['settlement'],
  // Facade-projection epic (#87+#48): the six ordinary workflow-surface tools (Decision 10's
  // "Who may drive what" — send/elevate/seed require the control class, the reads only observe).
  baton_run_message_send: ['control', 'observe'],
  baton_run_message_receipt: ['observe'],
  baton_run_attention_watch: ['observe'],
  baton_run_scratchpad_read: ['observe'],
  baton_run_scratchpad_elevate: ['control', 'observe'],
  baton_run_knowledge_seed: ['control', 'observe'],
  // Matrix mutations keep the existing transported posture: observe admits the tool call, while
  // the run-orchestrator lease resolved inside S-2 is the control authority.
  ...Object.fromEntries(SURFACING_MATRIX_MCP_ROWS.map((operation) => [operation.names.mcp, ['observe']])),
});
// Reflex surface contract Part A: the tool names bound by explicit `_dispatch` branches below
// (never APPLICATION_COMMAND_DEFINITIONS keys — Part A.2). The read-only subset
// (REFLEX_READ_ONLY_TOOLS, below near the reflex table) extends the observe-path error gate.
const REFLEX_TOOL_NAMES = new Set([
  'baton_context_eval', 'baton_decision_answer',
  ...SURFACING_MATRIX_MCP_ROWS.map((operation) => operation.names.mcp),
]);
const STATEFUL = new Set(['fleet_spawn', 'fleet_scratch_oracle', 'fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_send', 'fleet_respond', 'fleet_interrupt', 'fleet_capability_invoke', 'fleet_reuse_decide', 'fleet_reuse_recheck', 'fleet_kill', 'fleet_drain',
  'baton_context_eval', 'baton_decision_answer',
  ...SURFACING_MATRIX_MCP_ROWS.filter((operation) => operation.effect === 'control')
    .map((operation) => operation.names.mcp),
  // MCP-W1/W2: waves.start and the settlement tools are stateful (control effects ride the mcp.call
  // admission ledger exactly like the matrix control tools). waves.send/waves.stop deliberately are
  // NOT — their wire schemas carry no idempotencyKey (send/stop are per-runId member lanes whose
  // durable idempotency lives in the member run's own stop/steer primitives), so they dispatch
  // through the observe-path gate like the read-only tools.
  'baton_waves_start',
  'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote', 'baton_knowledge_settlement_lease',
  ...MCP_APPLICATION_ENTRIES.filter(([, , definition]) => definition.mcpStateful).map(([tool]) => tool)]);
for (const [tool, , definition] of ORDINARY_APPLICATION_ENTRIES) if (definition.mcpStateful) STATEFUL.add(tool);
const RECONCILABLE = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'baton_context_eval', 'baton_decision_answer',
  ...SURFACING_MATRIX_MCP_ROWS.filter((operation) => operation.effect === 'control')
    .map((operation) => operation.names.mcp),
  // MCP-W1/W2: waves.start and the settlement tools replay idempotently on retry.
  'baton_waves_start',
  'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote', 'baton_knowledge_settlement_lease',
  ...MCP_APPLICATION_ENTRIES.filter(([, , definition]) => definition.mcpStateful && definition.reconcilable).map(([tool]) => tool)]);
for (const [tool, , definition] of ORDINARY_APPLICATION_ENTRIES) if (definition.mcpStateful && definition.reconcilable) RECONCILABLE.add(tool);
const GOAL_PLAN_MUTATIONS = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve']);
const BOUNDED_OBSERVATION_AUDITS = new Set(['tool_completed']);
const FENCED = new Set(['fleet_send', 'fleet_interrupt', 'fleet_kill']);
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const SESSION_FIELDS = new Set(['mode', 'id', 'lastTurnId', 'context']);
const SESSION_CONTEXT_FIELDS = new Set(['worktree', 'repoRoot', 'baseSha', 'branch', 'ownerTaskId']);
const VERIFICATION_FIELDS = new Set(['command', 'expectExit', 'timeoutMs', 'coverageCommand', 'mutationCommand']);
const BUDGET_FIELDS = new Set(['tokens', 'usd', 'wallMin']);
const PLAN_BRIEF_FIELDS = ['goal', 'constraints', 'pathScope', 'tools', 'outputFormat', 'definitionOfDone', 'verification', 'budget', 'providerTurns', 'capabilities', 'effects'];
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
function containsForbidden(value, path = [], opts = {}) {
  if (Array.isArray(value)) return value.some((child) => containsForbidden(child, path, opts));
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const planCapabilityField = key === 'capabilities' && (['goalPlan', 'nodes'].includes(path.at(-1))
      || (opts.planGatedBrief === true && path.length === 1 && path[0] === 'brief'));
    return (FORBIDDEN_KEY.test(key) && !planCapabilityField) || containsForbidden(child, [...path, key], opts);
  });
}
function normalized(value) { return value === undefined ? null : clone(value); }
function applicationPrincipal(value, label) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'actor,principalId,sessionId'
    || !nonempty(value.actor) || value.actor.length > 256
    || !SAFE_ID.test(value.principalId ?? '') || !SAFE_ID.test(value.sessionId ?? '')) {
    throw new TypeError(`${label} must be a closed application principal`);
  }
  return Object.freeze(clone(value));
}
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
function toolError(code, message = null, detail = null) {
  return toolResult({ ok: false, error: { code, ...(message == null ? {} : { message }), ...(detail == null ? {} : { detail }) } }, true);
}
function stateFailureCode(cause) {
  if (cause?.mcpCode === 'stale_fence') return 'stale_fence';
  if (cause?.code === 'application_unauthorized') return 'forbidden';
  if (['application_run_not_found', 'application_interaction_not_found', 'application_profile_not_found', 'application_worker_not_found'].includes(cause?.code)) return 'not_found';
  if (['application_unavailable', 'application_run_lookup_oversize', 'application_run_view_oversize'].includes(cause?.code)) return 'temporarily_unavailable';
  if (typeof cause?.code === 'string' && cause.code.startsWith('application_')) return cause.code;
  if (typeof cause?.code === 'string' && cause.code.startsWith('worker_policy_')) return cause.code;
  if (typeof cause?.code === 'string' && cause.code.startsWith('run_orchestrator_')) return cause.code;
  // Issue #114 (B3): the workflow-as-data lane's five refusal codes (workflow_spec_invalid,
  // workflow_member_invalid, workflow_steering_unknown, workflow_harvest_invalid,
  // workflow_objective_ref_invalid) surface typed on the wire — checked BEFORE the TypeError-name
  // fallthrough so a workflow_* throw never degrades to invalid_command / command_outcome_unknown.
  if (typeof cause?.code === 'string' && cause.code.startsWith('workflow_')) return cause.code;
  // #132 D5 (wave-observability-2026-08-06/contract.md §D5.1/§D5.2): the wave lane's typed
  // admission refusal (wave_member_invalid) and the missing-member seam (wave_not_found) surface
  // typed on the wire, carrying the lane's OWN message plus the {actual, cap, cause, role} detail.
  // The store-integrity roster code deliberately stays a projection throw — never a per-command row.
  if (cause?.code === 'wave_member_invalid' || cause?.code === 'wave_not_found') return cause.code;
  if (cause?.code === 'run_stopping') return cause.code;
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
    'goal_plan_invalid', 'goal_plan_secret_rejected', 'goal_plan_unauthorized', 'goal_plan_unavailable', 'goal_plan_required', 'goal_plan_status_invalid', 'goal_plan_status_oversize', 'not_found', 'duplicate_task',
    'goal_conflict', 'goal_predecessor_required', 'goal_stale', 'goal_too_large', 'goal_version_limit', 'goal_weakened',
    'plan_approval_conflict', 'plan_approval_expired', 'plan_approval_invalid', 'plan_approval_stale', 'plan_brief_mismatch', 'plan_budget_exceeded',
    'plan_conflict', 'plan_cycle', 'plan_dangling_dependency', 'plan_dependency_incomplete', 'plan_dependency_mismatch', 'plan_dispatch_conflict',
    'plan_dispatch_invalid', 'plan_dispatch_stale', 'plan_duplicate_node', 'plan_effect_invalid', 'plan_effect_mismatch', 'plan_goal_mismatch',
    'plan_node_invalid', 'plan_node_limit', 'plan_node_not_found', 'plan_not_approved', 'plan_predecessor_required', 'plan_risk_mismatch', 'plan_route_mismatch',
    'plan_route_invalid', 'plan_route_authority_legacy_ambiguous',
    'plan_scope_invalid', 'plan_self_approval', 'plan_stale', 'plan_too_large', 'plan_verification_invalid', 'plan_version_limit',
    'coordinator_drain_capacity', 'coordinator_drain_incomplete', 'coordinator_draining', 'coordinator_closed'].includes(cause?.code)) return cause.code;
  // Part F (R5, typed-error reach) — board/package reflex codes (mcp-reflex-surface-decisions.md
  // Part F rule 12), added under the MCP-SLICE1-INTEGRATION seam for this seat's Part D/E tools;
  // slice 1 owns the context_eval/decision codes in this same rule. Missing/changed artifact
  // bytes collapse to the one typed `artifact_unavailable` tool error, never a silent recompute.
  if (['attention_scope_forbidden', 'attention_scope_invalid', 'attention_target_invalid'].includes(cause?.code)) return cause.code;
  // Facade-projection epic (#87+#48): the scratchpad-settlement family (scratchpad_cursor_stale is
  // deliberately NOT mapped — the fence CAS is not projected, Decision 6).
  if (['scratchpad_settlement_invalid', 'scratchpad_settlement_conflict', 'scratchpad_settlement_not_ready',
    'stale_scratchpad_fence', 'scratchpad_partition_exhausted', 'scratchpad_read_invalid'].includes(cause?.code)) return cause.code;
  // Facade-projection epic (#87+#48): the knowledge-seed family — the TRUE codes the lane throws
  // (temporal_incoherence / missing_evidence) plus the defense-in-depth listings (Decision 9), so
  // none can ever degrade to command_outcome_unknown.
  if (['temporal_incoherence', 'missing_evidence', 'invalid_evidence', 'causal_orphan',
    'missing_endpoint', 'duplicate_node', 'knowledge_node_conflict', 'reserved_knowledge_field'].includes(cause?.code)) return cause.code;
  if (['context_artifact_unavailable', 'context_package_not_found', 'context_package_branch_not_found'].includes(cause?.code)) return 'artifact_unavailable';
  if (['board_admission_invalid', 'board_lease_required', 'board_session_mismatch', 'board_run_closed',
    'board_parent_stale', 'board_replay_conflict',
    'stale_board_fence', 'board_item_not_found', 'board_item_not_open', 'board_item_digest_mismatch',
    'invalid_board', 'invalid_board_item', 'invalid_board_title', 'invalid_board_detail', 'invalid_board_owner',
    'invalid_board_evidence', 'invalid_board_item_id', 'invalid_board_state', 'invalid_board_ordinal', 'invalid_board_fence',
    'context_package_invalid', 'reserved_package_field', 'package_branch_name_conflict', 'package_branch_empty',
    'context_package_conflict', 'context_package_integrity', 'package_provenance_integrity',
    'context_package_attach_invalid', 'context_package_unavailable'].includes(cause?.code)) return cause.code;
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
const commitSha = { type: 'string', pattern: '^[a-f0-9]{40,64}$' };
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
const planBriefBudgetSchema = schema({
  tokens: { type: 'integer', minimum: 1 }, usd: { type: 'number', minimum: 0 }, wallMin: { type: 'integer', minimum: 1 },
}, ['tokens', 'usd', 'wallMin']);
const planBriefSchema = schema({
  goal: text, constraints: textArray, pathScope: textArray, tools: textArray,
  outputFormat: { type: 'string' }, definitionOfDone: { type: 'string' },
  verification: goalPlanVerificationSchema, budget: planBriefBudgetSchema,
  providerTurns: { type: 'integer', minimum: 1 }, capabilities: textArray, effects: textArray, requiredEffects: textArray,
}, PLAN_BRIEF_FIELDS);
const goalPlanRouteTupleSchema = schema({ harness: text, model: text, effort: text }, ['harness', 'model', 'effort']);
const goalPlanRoutesSchema = {
  oneOf: [
    schema({ schemaVersion: { const: 2 }, allowed: {
      type: 'array', minItems: 1, uniqueItems: true, items: goalPlanRouteTupleSchema,
    } }, ['schemaVersion', 'allowed']),
    schema({
      harnesses: { type: 'array', minItems: 1, maxItems: 1, items: text },
      models: { type: 'array', minItems: 1, maxItems: 1, items: text },
      efforts: { type: 'array', minItems: 1, maxItems: 1, items: text },
    }, ['harnesses', 'models', 'efforts']),
  ],
};
const goalPlanNodeSchema = schema({
  key: text, objective: text, definitionOfDone: textArray, deps: textArray, pathScope: textArray, risk: text,
  budget: goalPlanBudgetSchema, verification: goalPlanVerificationSchema, routes: goalPlanRoutesSchema,
  capabilities: textArray, effects: textArray, requiredEffects: textArray,
}, ['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects']);
const spawnGoalPlanSchema = schema({
  goalId: { type: 'string', pattern: '^goal:[a-f0-9]{64}$' }, goalVersion: { type: 'integer', minimum: 1 }, goalDigest: digest,
  planId: { type: 'string', pattern: '^plan:[a-f0-9]{64}$' }, planVersion: { type: 'integer', minimum: 1 }, planDigest: digest,
  nodeKey: text, expectedDispatchVersion: { const: 0 }, capabilities: textArray, effects: textArray, requiredEffects: textArray,
}, ['goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'nodeKey', 'expectedDispatchVersion', 'capabilities', 'effects']);
const fleetSpawnSchema = {
  ...schema({ ...repo, ...idem, runId, harness: text, model: text, effort: text, modelPolicy: schema({ allow: textArray, deny: textArray, prefer: textArray, allowFamilies: textArray, denyFamilies: textArray, reasoningEffort: text, serviceTier: text }), brief: { type: 'object' }, taskId: text, deps: textArray, taskType: text, session: schema({ mode: { type: 'string', enum: ['new', 'resume', 'fork'] }, id: text, lastTurnId: text, context: schema({ worktree: text, repoRoot: text, baseSha: text, branch: text, ownerTaskId: text }, ['worktree']) }), refines: text, goalPlan: spawnGoalPlanSchema }, ['repoId', 'idempotencyKey', 'harness', 'brief']),
  allOf: [{ if: { required: ['goalPlan'] }, then: { properties: { brief: planBriefSchema } } }],
};
const applicationRouteSchema = schema({ harness: text, model: text, effort: text }, ['harness', 'model', 'effort']);
const applicationIntentSchema = schema({
  runId,
  objective: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.objective'].value },
  resultIntent: { type: 'string', enum: ['change', 'read_only_evidence'], default: 'change' },
  profile: runId,
  route: applicationRouteSchema,
  scope: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 4_096 } },
}, ['objective']);
const applicationAnswerSchema = {
  oneOf: [
    schema({ text: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['decision.text'].value } }, ['text']),
    schema({ decision: { type: 'string', enum: ['allow', 'deny', 'cancel'] } }, ['decision']),
    // Part B (issue #16): the typed decision-channel answer form.
    schema({ optionId: { type: 'string', minLength: 1, maxLength: 256 } }, ['optionId']),
  ],
};
const applicationFeedbackFindingSchema = schema({
  kind: { type: 'string', enum: ['defect', 'risk', 'suggestion', 'question', 'observation'] },
  severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
  message: { type: 'string', minLength: 1, maxLength: 4_096 },
  path: { oneOf: [{ type: 'string', minLength: 1, maxLength: 4_096 }, { type: 'null' }] },
  line: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
}, ['kind', 'severity', 'message', 'path', 'line']);
const applicationFeedbackSchema = {
  oneOf: [
    { type: 'string', minLength: 1, maxLength: 4_096 },
    schema({
      summary: { type: 'string', minLength: 1, maxLength: 4_096 },
      findings: { type: 'array', minItems: 1, maxItems: 32, items: applicationFeedbackFindingSchema },
    }, ['summary', 'findings']),
  ],
};
const APPLICATION_TOOL_DEFINITIONS = Object.freeze([
  { name: 'fleet_run_start', description: 'Start one Baton Run from a concise objective, explicit change or read-only evidence result intent, deployment profile, and exact harness/model/effort route; returns a readable Plan awaiting approval.', inputSchema: schema({ ...repo, ...idem, intent: applicationIntentSchema }, ['repoId', 'idempotencyKey', 'intent']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_status', description: 'Read the fresh bounded authoritative RunView for one Run.', inputSchema: schema({ ...repo, runId }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_follow', description: 'Resume one Run-specific bounded at-least-once change page after an acknowledged coordination cursor.', inputSchema: schema({ ...repo, runId, afterCursor: { type: 'integer', minimum: 0 }, timeoutMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId', 'afterCursor', 'timeoutMs']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_recover', description: 'Recover the one server-selected eligible orphan for a Run under its deployment-owned recovery policy and approved Plan authority.', inputSchema: schema({ ...repo, ...idem, runId }, ['repoId', 'idempotencyKey', 'runId']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_approve', description: 'Approve the exact displayed Plan digest and let the resident Baton application dispatch it once.', inputSchema: schema({ ...repo, ...idem, runId, planDigest: digest }, ['repoId', 'idempotencyKey', 'runId', 'planDigest']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_wait', description: 'Wait a bounded deployment-approved interval and return a fresh authoritative RunView.', inputSchema: schema({ ...repo, runId, timeoutMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId', 'timeoutMs']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_answer', description: 'Answer one Run-owned pending question or approval exactly once.', inputSchema: schema({ ...repo, ...idem, runId, requestId: { type: 'string', minLength: 1, maxLength: 4_096 }, answer: applicationAnswerSchema }, ['repoId', 'idempotencyKey', 'runId', 'requestId', 'answer']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_feedback', description: 'Attach typed operator feedback to one immutable verified Workflow candidate selected by role.', inputSchema: schema({ ...repo, ...idem, runId, role: runId, feedback: applicationFeedbackSchema }, ['repoId', 'idempotencyKey', 'runId', 'role', 'feedback']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_stop', description: 'Durably close one Run to new effects, then kill and reap only its exact workers and return its stop receipt.', inputSchema: schema({ ...repo, ...idem, runId, reason: { type: 'string', minLength: 1, maxLength: 1_024 } }, ['repoId', 'idempotencyKey', 'runId', 'reason']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_evidence', description: 'Return one bounded content-addressed terminal evidence manifest for a Run.', inputSchema: schema({ ...repo, runId }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_episode', description: 'Read one progressively addressed Episode chapter without inspect selectors.', inputSchema: schema({ ...repo, runId, topic: runId, detail: { type: 'string', enum: ['item', 'content', 'evidence'] }, role: runId, generation: { type: 'integer', minimum: 1 }, pageCursor: { type: 'string', minLength: 1, maxLength: 4096 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_workstreams', description: 'List or open durable semantic workstream generations.', inputSchema: schema({ ...repo, runId, role: runId, generation: { type: 'integer', minimum: 1 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_workstream_notify', description: 'Notify one exact current semantic workstream generation.', inputSchema: schema({ ...repo, ...idem, runId, role: runId, generation: { type: 'integer', minimum: 1 }, message: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.legacy_send.body'].value }, delivery: { type: 'string', enum: ['nudge', 'now', 'turn'] } }, ['repoId', 'idempotencyKey', 'runId', 'role', 'message']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_workstream_stop', description: 'Stop and reap one exact current semantic workstream generation.', inputSchema: schema({ ...repo, ...idem, runId, role: runId, generation: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['repoId', 'idempotencyKey', 'runId', 'role']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_adopt', description: 'Designate one exact preserved and verified Run result without merging, checking out, or publishing it.', inputSchema: schema({ ...repo, ...idem, runId, nodeKey: runId, resultSha: commitSha, evidenceDigest: digest, reason: { type: 'string', minLength: 1, maxLength: 1_024 } }, ['repoId', 'idempotencyKey', 'runId', 'nodeKey', 'resultSha', 'evidenceDigest', 'reason']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_review', description: 'Start one exact independently-routed structured semantic review over the immutable accepted Run result.', inputSchema: schema({ ...repo, ...idem, runId, route: applicationRouteSchema, reason: { type: 'string', minLength: 1, maxLength: 1_024 } }, ['repoId', 'idempotencyKey', 'runId', 'route', 'reason']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_integrate', description: 'Integrate the exact adopted and semantically reviewed result under fresh evidence and deployment policy; never pushes.', inputSchema: schema({ ...repo, ...idem, runId, evidenceDigest: digest, strategy: { type: 'string', enum: ['ff-only', 'structured'] }, reason: { type: 'string', minLength: 1, maxLength: 1_024 } }, ['repoId', 'idempotencyKey', 'runId', 'evidenceDigest', 'strategy', 'reason']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_export', description: 'Materialize the exact evidence-bound accepted Git tree under deployment-owned authority and return its immutable opaque export receipt.', inputSchema: schema({ ...repo, ...idem, runId, evidenceDigest: digest }, ['repoId', 'idempotencyKey', 'runId', 'evidenceDigest']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
].map((tool) => Object.freeze({ ...tool, execution: Object.freeze({ taskSupport: 'forbidden' }) })));
const LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'baton_help',
    description: "Read bounded contextual help from Baton's semantic application registry.",
    inputSchema: schema({ ...repo, topic: runId, depth: { type: 'string', enum: APPLICATION_SEMANTIC_REGISTRY.depths }, runId }, ['repoId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    // CS-2: baton_runs was already in ORDINARY_APPLICATION_ENTRIES dispatch (sibling of the
    // advertised set) but missing from the tool table — advertise it on the application surface.
    name: 'baton_runs',
    description: 'List Runs visible to the authenticated application principal.',
    inputSchema: schema({ ...repo }, ['repoId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_start',
    description: 'Start one Run from a concise explicit change or read-only evidence intent; Baton returns the progressive outline.',
    inputSchema: schema({ ...repo, ...idem, intent: applicationIntentSchema }, ['repoId', 'idempotencyKey', 'intent']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_inspect',
    description: 'Inspect one Run at outline, index, section, item, or evidence depth.',
    inputSchema: schema({
      ...repo, runId, depth: { type: 'string', enum: APPLICATION_SEMANTIC_REGISTRY.depths },
      section: runId, item: runId, cursor: { type: 'integer', minimum: 0 },
      offset: { type: 'integer', minimum: 0 },
      pageCursor: { type: 'string', minLength: 1, maxLength: 4096 }, recipient: runId,
      waitMs: { type: 'integer', minimum: 1 },
    }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_episode',
    description: 'Read one Episode chapter with direct topic, role, generation, and continuation coordinates.',
    inputSchema: schema({ ...repo, runId, topic: runId, detail: { type: 'string', enum: ['item', 'content', 'evidence'] }, role: runId, generation: { type: 'integer', minimum: 1 }, pageCursor: { type: 'string', minLength: 1, maxLength: 4096 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_workstreams',
    description: 'List or open one durable role/generation workstream without worker coordinates.',
    inputSchema: schema({ ...repo, runId, role: runId, generation: { type: 'integer', minimum: 1 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_workstream_notify',
    description: 'Notify one exact current workstream generation while Baton resolves worker and fence authority.',
    inputSchema: schema({ ...repo, ...idem, runId, role: runId, generation: { type: 'integer', minimum: 1 }, message: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.legacy_send.body'].value }, delivery: { type: 'string', enum: ['nudge', 'now', 'turn'] } }, ['repoId', 'idempotencyKey', 'runId', 'role', 'message']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_workstream_stop',
    description: 'Stop and reap one exact current workstream generation.',
    inputSchema: schema({ ...repo, ...idem, runId, role: runId, generation: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 1024 } }, ['repoId', 'idempotencyKey', 'runId', 'role']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_act',
    description: 'Perform one currently offered Run-bound action while Baton derives authoritative coordinates.',
    inputSchema: schema({ ...repo, ...idem, runId, actionId: runId, inputs: { type: 'object' } }, ['repoId', 'idempotencyKey', 'runId', 'actionId', 'inputs']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_stop',
    description: 'Immediately stop and reap one exact Run without enumerating workers.',
    inputSchema: schema({ ...repo, ...idem, runId, reason: { type: 'string', minLength: 1, maxLength: 1_024 } }, ['repoId', 'idempotencyKey', 'runId', 'reason']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  // S-1 v2: atomic attach-and-harvest. Advertised schema excludes transportHidden mintWaveDetached.
  {
    name: 'baton_waves_attach',
    description: 'Attach to a prior wave by waveId and member objectives, validate bindings server-side, settle, and return closed outcomes (no live handle).',
    inputSchema: schema({
      ...repo,
      waveId: runId,
      members: {
        type: 'array', minItems: 1, maxItems: 64,
        items: schema({
          role: runId,
          objective: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['wave.member.objective'].value },
        }, ['role', 'objective']),
      },
      timeoutMs: { type: 'integer', minimum: 1 },
      repoRoot: { type: 'string', minLength: 1, maxLength: 4096 },
    }, ['repoId', 'waveId', 'members']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // MCP-W1 (mcp-packaging-decisions v1.0): wave ergonomics on the ordinary surface. Start is
  // detached — {waveId, members:[{role, runId}]}, live handles never cross transport; quota
  // debits PER MEMBER (codex #1); profile admission rides the deployment profile's routes/scopes.
  {
    name: 'baton_waves_start',
    description: 'Start a detached wave: each member starts through the deployment profile admission (exact routes + scopes) and binds to one waveId; returns {waveId, members:[{role, runId}]} — live handles never cross the transport. Quota is debited per member.',
    inputSchema: schema({
      ...repo, ...idem,
      members: {
        type: 'array', minItems: 1, maxItems: 64,
        items: schema({
          role: runId,
          objective: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['wave.member.objective'].value },
          exact: applicationRouteSchema,
          scope: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 4096 } },
        }, ['role', 'objective', 'exact']),
      },
    }, ['repoId', 'idempotencyKey', 'members']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_waves_progress',
    description: 'Read one wave\'s progress projection: members paginated ≤16 per page with an explicit {cursor, nextCursor}; every member carries bounded {role, phase, progressClass, attention, knowledge}. Never an oversized frame.',
    inputSchema: schema({
      ...repo, waveId: { type: 'string', pattern: '^wave:[a-f0-9]{32}$' },
      cursor: { type: 'integer', minimum: 0 },
    }, ['repoId', 'waveId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_waves_send',
    description: 'Resume-steer ONE wave member by the runId attach returned (the resume path): a message through the member\'s run. Never wave-wide.',
    inputSchema: schema({
      ...repo, runId, message: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.legacy_send.body'].value },
    }, ['repoId', 'runId', 'message']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_waves_stop',
    description: 'Stop ONE wave member by runId (the resume path): durably close that member run. Never wave-wide; the member lane is run.stop.',
    inputSchema: schema({
      ...repo, runId, reason: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['repoId', 'runId', 'reason']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    // #132 D2.4 (wave-observability-2026-08-06/contract.md §D2.4): the registry read. baton_waves_list
    // answers the OPEN rows of the wave registry projection (this deployment's in-flight waves),
    // paged ≤16 with {cursor, nextCursor}. A member run that WAS registered and then disappeared
    // refuses wave_not_found (D5.2) — never a silent success shape.
    name: 'baton_waves_list',
    description: 'Read the in-flight wave registry: open rows for THIS deployment, paged ≤16 per page with {cursor, nextCursor}. Every member reads liveness \'local\'; a member run that no longer resolves refuses wave_not_found.',
    inputSchema: schema({
      ...repo, cursor: { type: 'integer', minimum: 0 },
    }, ['repoId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    // Issue #114 (D2, OQ2 folded — the family plural): the workflow-as-data interpreter lane. ONE
    // closed spec drives a whole wave; malformed specs refuse with the field/role-named workflow_*
    // codes the stateFailureCode allowlist preserves.
    name: 'baton_waves_run',
    description: 'Run a workflow-as-data spec: one closed JSON document (members + steering + harvest) drives a whole wave through the shared interpreter. No per-wave driver script.',
    inputSchema: schema({
      ...repo, spec: { type: 'object' },
    }, ['repoId', 'spec']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // MCP-W3 (mcp-packaging-decisions v1.0): deployment.doctor — quota-free, per-call FRESH
  // readiness; credential posture as metadata only (source kind, expiry class), never secret
  // material. It is the route-picking prerequisite, so charging quota would blind callers exactly
  // when they need it.
  {
    name: 'baton_deployment_doctor',
    description: 'Read fresh deployment readiness (routes with state, workspace capacity, credential posture as metadata ONLY — never token material). Quota-free and rebuilt on every call.',
    inputSchema: schema({ ...repo }, ['repoId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // decision.answer joins the ordinary surface identically (v1.0.1 adjudication): the typed
  // decision-channel answer with repository-coordinate enforcement and the distinct
  // already_resolved outcome ({result:'already_resolved', resolvedBy} — a late answerer must not
  // re-spawn work).
  {
    name: 'baton_decision_answer',
    description: 'Answer one pending decision request by typed option or free-response text; a cross-repo requestId refuses identically to an unknown one, and a late answer returns the distinct already_resolved outcome, never a generic error.',
    inputSchema: schema({
      ...repo, ...idem, runId, requestId: { type: 'string', minLength: 1, maxLength: 4_096 }, answer: applicationAnswerSchema,
    }, ['repoId', 'idempotencyKey', 'runId', 'requestId', 'answer']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // MCP-W2 (mcp-packaging-decisions v1.0): the four settlement ops become MCP tools behind the
  // S-2 sessionAuthority envelope. The envelope is the authenticated connection's proof (never a
  // caller field); knowledge.promote refuses without it, and knowledge.settlement_lease requires
  // an explicit settlement capability class on the MCP principal (single-orchestrator posture).
  {
    name: 'baton_scratchpad_elevate',
    description: 'Elevate one terminal task\'s scratchpad entries into an orchestrator board candidacy (S-2 settlement lane).',
    inputSchema: schema({
      ...repo, ...idem, runId, taskId: runId, workerId: runId,
      expectedScratchpadFence: { type: 'integer', minimum: 0 },
      entryIds: { type: 'array', maxItems: 64, uniqueItems: true, items: { type: 'string', pattern: '^scratchpad-entry:[a-f0-9]{64}$' } },
    }, ['repoId', 'idempotencyKey', 'runId', 'taskId', 'workerId', 'expectedScratchpadFence', 'entryIds']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_scratchpad_settle',
    description: 'Settle one workflow\'s shared scratchpad partition with explicit skips (S-2 settlement lane).',
    inputSchema: schema({
      ...repo, ...idem, runId, expectedScratchpadFence: { type: 'integer', minimum: 0 },
      skips: { type: 'array', maxItems: 256, items: { type: 'object' } },
    }, ['repoId', 'idempotencyKey', 'runId', 'expectedScratchpadFence', 'skips']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_knowledge_promote',
    description: 'Admit one workflow candidate Finding into shared knowledge through the run-orchestrator lease. REQUIRES the S-2 sessionAuthority envelope bound to the settlement lease — presenter authentication is the lease\'s session binding (XB), validated exactly as admitBoardCommand does.',
    inputSchema: schema({
      ...repo, ...idem, runId, candidateFindingId: runId, policy: { type: 'object' }, lease: { type: 'object' },
    }, ['repoId', 'idempotencyKey', 'runId', 'candidateFindingId', 'policy', 'lease']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_knowledge_settlement_lease',
    description: 'Mint the wave settlement lease + candidacy bundle from the host\'s fixed principal. ENABLED ONLY for a descriptor principal carrying an explicit settlement capability class (single-orchestrator posture); the session is derived from the host, never tool arguments.',
    inputSchema: schema({
      ...repo, ...idem, waveId: runId, members: { type: 'array', maxItems: 64, items: runId },
    }, ['repoId', 'idempotencyKey', 'waveId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Facade-projection epic (#87+#48, contract v2.2): the six ordinary workflow-surface tools.
  // They mirror the facade commands' closed shapes (plus repoId) and dispatch through explicit
  // _dispatch branches with the CONNECTION-derived principal — never tool arguments. None carries
  // a wire idempotencyKey (send/elevate retry mint new effects honestly; elevate/seed replay
  // safety lives server-side in the deterministic keys, Decisions 7/9).
  {
    name: 'baton_run_message_send',
    description: 'Send one orchestrator message to a worker or run target (inform|query|steer). The target is exactly {workerId} or {runId}; the body is capped at 2,048 BYTES (char maxLength here is a shape hint, never the authority). Returns the lane outcome verbatim.',
    inputSchema: schema({
      ...repo, runId, workerId: runId, kind: { type: 'string', enum: ['inform', 'query', 'steer'] },
      body: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['message.send.body'].value },
    }, ['repoId', 'kind', 'body']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'baton_run_message_receipt',
    description: "Read the honest receipt state machine for one message: {delivered, read, actedOn, reply} — the lane's exact shape, resolve-then-authorized (an unknown id refuses identically to a foreign one).",
    inputSchema: schema({
      ...repo, messageId: { type: 'string', pattern: '^message:[a-f0-9]{64}$' },
    }, ['repoId', 'messageId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_attention_watch',
    description: "Page the run's attention inbox through the lane's own scope authority: {reasons, throughCursor, afterCursor, runId} with storm coalescing and candidacy gating. Kind is a shape-only target filter; cursor is a safe offset.",
    inputSchema: schema({
      ...repo, runId, kind: runId, cursor: { type: 'integer', minimum: 0 },
    }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_scratchpad_read',
    description: 'Read a bounded, UNTRUSTED-framed page of one scratchpad scope (shared or worker:<id>): at most 64 entries, at most 4,096-byte leaves, the fence/observedSeq verbatim, and the 256 KiB serialized page budget with digest-citation truncation.',
    inputSchema: schema({
      ...repo, runId, scope: { type: 'string', pattern: '^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$' },
      cursor: { type: 'integer', minimum: 0 },
    }, ['repoId', 'runId', 'scope']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_scratchpad_elevate',
    description: "Settle one terminal task's scratchpad partition through the coordinator's fence-bound elevation wrapper (ordinary end-of-task path). Returns the store receipt verbatim; an exact retry returns the empty successor.",
    inputSchema: schema({
      ...repo, runId, taskId: runId,
      entryIds: { type: 'array', maxItems: 128, uniqueItems: true, items: { type: 'string', pattern: '^scratchpad-entry:[a-f0-9]{64}$' } },
    }, ['repoId', 'runId', 'taskId', 'entryIds']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'baton_run_knowledge_seed',
    description: "Seed one content-addressed knowledge node inside a run's horizon. An exact retry replays idempotent under the server-derived key; distinct content seeds a distinct node, never a silent overwrite.",
    inputSchema: schema({
      ...repo, runId,
      type: { type: 'string', enum: ['Run', 'Task', 'Artifact', 'Phase', 'Experiment', 'Finding', 'Question', 'Hypothesis', 'Principle', 'Constraint', 'Literature', 'Research', 'RouteStat', 'Skill', 'Counterexample', 'Representation', 'ScratchFact', 'Source'] },
      grounding: { type: 'string', enum: ['verified', 'observed', 'derived', 'asserted'] },
      body: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['run.objective'].value },
      evidence: { type: 'array', maxItems: 32, items: { type: 'object' } },
    }, ['repoId', 'runId', 'type', 'grounding', 'body']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
].map((tool) => Object.freeze({
  ...tool,
  _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
  execution: Object.freeze({ taskSupport: 'forbidden' }),
})));
// The ordinary table = retained legacy tools + the canonical grammar tools rendered from the
// registry (M4b). A canonical tool is its legacy sibling under the derived canonical name; the wire
// schema and annotations (from idempotent/destructive) are the sibling's, so a caller reaches one
// operation under either spelling.
const ORDINARY_APPLICATION_TOOL_DEFINITIONS = Object.freeze([
  ...LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS,
  ...CANONICAL_ORDINARY_SIBLINGS.map((sibling) => {
    const base = LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS.find((tool) => tool.name === sibling.legacyTool);
    return Object.freeze({ ...base, name: sibling.tool });
  }),
]);
const ADVANCED_TOOL_DEFINITIONS = Object.freeze([
  { name: 'fleet_spawn', description: 'Spawn one Baton worker with independently selected harness, model, effort, run, and approved Goal/Plan node.', inputSchema: fleetSpawnSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_scratch_oracle', description: 'Spawn an explicitly routed independent oracle over one immutable derived Scratch fact.', inputSchema: schema({ ...repo, ...idem, runId, scratchFactId: text, harness: text, model: text, effort: text, modelPolicy: schema({ allow: textArray, deny: textArray, prefer: textArray, allowFamilies: textArray, denyFamilies: textArray, reasoningEffort: text, serviceTier: text }), verification: { type: 'object' }, budget: { type: 'object' }, constraints: textArray, goal: text, definitionOfDone: text, taskId: text }, ['repoId', 'idempotencyKey', 'scratchFactId', 'harness', 'verification']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_goal_define', description: 'Define one immutable bounded Goal version under the injected repository principal.', inputSchema: schema({
    ...repo, ...idem, runId, objective: text, definitionOfDone: textArray, constraints: textArray, risk: text,
    budget: goalPlanBudgetSchema, predecessor: { oneOf: [goalRefSchema, { type: 'null' }] },
  }, ['repoId', 'idempotencyKey', 'objective', 'definitionOfDone', 'constraints', 'risk', 'budget', 'predecessor']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_plan_propose', description: 'Propose one immutable bounded Plan DAG against an exact Goal version, with routes authorized as exact harness/model/effort tuples.', inputSchema: schema({
    ...repo, ...idem, runId, goal: goalRefSchema, predecessor: { oneOf: [planRefSchema, { type: 'null' }] },
    nodes: { type: 'array', minItems: 1, items: goalPlanNodeSchema },
  }, ['repoId', 'idempotencyKey', 'goal', 'predecessor', 'nodes']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_plan_approve', description: 'Record one distinct-principal disposition over an exact Plan digest.', inputSchema: schema({
    ...repo, ...idem, runId, goal: goalRefSchema, plan: planRefSchema,
    expectedDisposition: { type: 'null' }, disposition: { type: 'string', enum: ['approved', 'rejected'] },
  }, ['repoId', 'idempotencyKey', 'goal', 'plan', 'expectedDisposition', 'disposition']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_goal_plan_status', description: 'Read a bounded replay-validated Goal/Plan projection at an exact event boundary.', inputSchema: schema({
    ...repo, runId,
    goalId: { type: 'string', pattern: '^goal:[a-f0-9]{64}$' }, goalVersion: { type: 'integer', minimum: 1 }, goalDigest: digest,
    planId: { type: 'string', pattern: '^plan:[a-f0-9]{64}$' }, planVersion: { type: 'integer', minimum: 1 }, planDigest: digest,
    throughSeq: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
  }, ['repoId', 'goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'throughSeq']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
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
    workerId: text, note: { type: 'string', minLength: 1, maxLength: FRAME_LIMITS['orientation.note'].value }, expectedFence: { type: 'integer' },
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
// Reflex surface contract Part A.1: a fourth tool table (all `baton_*`-named), frozen with
// `execution: { taskSupport: 'forbidden' }` and stamped with `_meta` exactly like the ordinary
// table above — NOT added to ORDINARY (those map 1:1 onto APPLICATION_COMMAND_DEFINITIONS) nor
// ADVANCED (fleet_* audience). Slice 1: context_eval (Part B) + decision tools (Part C);
// slice 2: board tools (Part D) + package tools (Part E) — one merged array per the
// MCP-SLICE1-INTEGRATION seam.
const LEGACY_REFLEX_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'baton_context_eval',
    description: 'Evaluate one pure, closed Context program against an existing durably-admitted Context session, addressed by Run (with optional role) or by manifest digest.',
    inputSchema: schema({
      ...repo, ...idem, runId, manifestDigest: digest, role: runId, program: { type: 'object' },
    }, ['repoId', 'idempotencyKey', 'program']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
].map((tool) => Object.freeze({
  ...tool,
  _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
  execution: Object.freeze({ taskSupport: 'forbidden' }),
})));
const SURFACING_MATRIX_DESCRIPTIONS = Object.freeze({
  'decision.list': 'List one Run\'s pending decision requests awaiting an answer, sanitized and bounded.',
  'board.read': 'Read the full non-evented orchestrator projection of one board.',
  'board.post': 'Post a new orchestrator-authority board item; refused if the caller-observed board fence is stale.',
  'board.retitle': 'Mint a retitled successor version of an open board item; refused if the caller-observed board fence is stale.',
  'board.reorder': 'Mint a reordered successor version of an open board item; refused if the caller-observed board fence is stale.',
  'board.close': 'Close an open board item; refused if the caller-observed board fence is stale.',
  'board.drop': 'Drop an open board item; refused if the caller-observed board fence is stale.',
  'package.admit': 'Admit one immutable Context Package under the landed admission rules.',
  'package.attach': 'Attach an admitted Context Package to a run/worker/board scope as a fenced O(1) pointer binding.',
  'package.read': 'Read Context Package metadata, or resolve and sanitize one named branch.',
  'repl.cite': 'Resolve one exact versioned REPL binding citation.',
  'knowledge.recall': 'Recall bounded, role-scoped knowledge from the shared coordination store.',
  'knowledge.horizon': 'Read a viewer-scoped task, workflow, or project knowledge horizon.',
});

// S-3 rule 5: the combined reflex table is a projection of the registry rows. Authority supplied
// by the authenticated transport (sessionAuthority/viewer) is intentionally absent on the wire;
// repoId and mutation idempotency are transport envelope fields.
const MATRIX_REFLEX_TOOL_DEFINITIONS = Object.freeze(SURFACING_MATRIX_MCP_ROWS.map((operation) => {
  const hidden = new Set(['sessionAuthority', ...operation.serverDerived]);
  const properties = Object.fromEntries(Object.entries(operation.inputSchema.properties ?? {})
    .filter(([field]) => !hidden.has(field)));
  const mutation = operation.effect === 'control';
  return Object.freeze({
    name: operation.names.mcp,
    description: SURFACING_MATRIX_DESCRIPTIONS[operation.key],
    inputSchema: schema({ ...repo, ...(mutation ? idem : {}), ...properties }, [
      'repoId', ...(mutation ? ['idempotencyKey'] : []),
      ...(operation.inputSchema.required ?? []).filter((field) => !hidden.has(field)),
    ]),
    annotations: Object.freeze({
      readOnlyHint: !mutation, destructiveHint: ['board.close', 'board.drop'].includes(operation.key),
      idempotentHint: true, openWorldHint: false,
    }),
    _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
    execution: Object.freeze({ taskSupport: 'forbidden' }),
  });
}));
// The combined reflex table = the legacy context_eval + the full matrix projection.
// baton_decision_answer moved to the ORDINARY table at MCP-W1 (v1.0.1 adjudication), so the
// interleaved legacy[1] splice is gone.
const REFLEX_TOOL_DEFINITIONS = Object.freeze([
  LEGACY_REFLEX_TOOL_DEFINITIONS[0], ...MATRIX_REFLEX_TOOL_DEFINITIONS,
]);
// Read-only reflex tool names needing typed-error reach through the observe-path error gate
// (Part F rule 12) — merged across both slices.
const REFLEX_READ_ONLY_TOOLS = new Set(SURFACING_MATRIX_MCP_ROWS
  .filter((operation) => operation.effect === 'observe').map((operation) => operation.names.mcp));
// MCP-W1/W2/W3: the ordinary-surface explicit-dispatch tools (never APPLICATION_COMMAND_DEFINITIONS
// keys, so the generic application branch never maps their failures) — every one of them must
// reach the typed stateFailureCode lane, never the generic 'command_failed'.
const ORDINARY_EXPLICIT_TOOLS = new Set([
  'baton_waves_start', 'baton_waves_progress', 'baton_waves_send', 'baton_waves_stop', 'baton_waves_list', 'baton_waves_run',
  'baton_deployment_doctor',
  'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote',
  'baton_knowledge_settlement_lease',
  'baton_run_message_send', 'baton_run_message_receipt', 'baton_run_attention_watch',
  'baton_run_scratchpad_read', 'baton_run_scratchpad_elevate', 'baton_run_knowledge_seed',
]);
const TOOL_DEFINITIONS = Object.freeze([...ORDINARY_APPLICATION_TOOL_DEFINITIONS, ...APPLICATION_TOOL_DEFINITIONS, ...ADVANCED_TOOL_DEFINITIONS, ...REFLEX_TOOL_DEFINITIONS]);
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
  if (closedRecord(value, ['schemaVersion', 'allowed'])) {
    return value.schemaVersion === 2 && Array.isArray(value.allowed) && value.allowed.length > 0
      && value.allowed.every((route) => closedRecord(route, ['harness', 'model', 'effort'])
        && nonempty(route.harness) && nonempty(route.model) && nonempty(route.effort));
  }
  return closedRecord(value, ['harnesses', 'models', 'efforts'])
    && validTextArray(value.harnesses, { empty: false }) && value.harnesses.length === 1
    && validTextArray(value.models, { empty: false }) && value.models.length === 1
    && validTextArray(value.efforts, { empty: false }) && value.efforts.length === 1;
}
function validGoalPlanNode(value) {
  return closedRecord(value, ['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects', ...(Object.hasOwn(value ?? {}, 'requiredEffects') ? ['requiredEffects'] : [])])
    && nonempty(value.key) && nonempty(value.objective) && validTextArray(value.definitionOfDone) && validTextArray(value.deps)
    && validTextArray(value.pathScope, { empty: false }) && nonempty(value.risk) && validGoalPlanBudget(value.budget)
    && validGoalPlanVerification(value.verification) && validGoalPlanRoutes(value.routes)
    && validTextArray(value.capabilities) && validTextArray(value.effects)
    && (!Object.hasOwn(value, 'requiredEffects') || validTextArray(value.requiredEffects));
}
function validSpawnGoalPlan(value) {
  return closedRecord(value, ['goalId', 'goalVersion', 'goalDigest', 'planId', 'planVersion', 'planDigest', 'nodeKey', 'expectedDispatchVersion', 'capabilities', 'effects', ...(Object.hasOwn(value ?? {}, 'requiredEffects') ? ['requiredEffects'] : [])])
    && /^goal:[a-f0-9]{64}$/.test(value.goalId ?? '') && Number.isSafeInteger(value.goalVersion) && value.goalVersion > 0
    && /^[a-f0-9]{64}$/.test(value.goalDigest ?? '') && /^plan:[a-f0-9]{64}$/.test(value.planId ?? '')
    && Number.isSafeInteger(value.planVersion) && value.planVersion > 0 && /^[a-f0-9]{64}$/.test(value.planDigest ?? '')
    && nonempty(value.nodeKey) && value.expectedDispatchVersion === 0
    && validTextArray(value.capabilities) && validTextArray(value.effects)
    && (!Object.hasOwn(value, 'requiredEffects') || validTextArray(value.requiredEffects));
}
function validPlanBrief(value) {
  const fields = [...PLAN_BRIEF_FIELDS, ...(Object.hasOwn(value ?? {}, 'requiredEffects') ? ['requiredEffects'] : [])];
  return closedRecord(value, fields) && nonempty(value.goal)
    && validTextArray(value.constraints) && validTextArray(value.pathScope) && validTextArray(value.tools)
    && typeof value.outputFormat === 'string' && typeof value.definitionOfDone === 'string'
    && validGoalPlanVerification(value.verification) && closedRecord(value.budget, BUDGET_FIELDS)
    && Number.isSafeInteger(value.budget.tokens) && value.budget.tokens > 0
    && Number.isFinite(value.budget.usd) && value.budget.usd >= 0
    && Number.isSafeInteger(value.budget.wallMin) && value.budget.wallMin > 0
    && Number.isSafeInteger(value.providerTurns) && value.providerTurns > 0
    && validTextArray(value.capabilities) && validTextArray(value.effects)
    && (!Object.hasOwn(value, 'requiredEffects') || validTextArray(value.requiredEffects));
}

function applicationArgs(name, args) {
  const command = APPLICATION_TOOL[name];
  if (!command) return null;
  const fields = APPLICATION_COMMAND_DEFINITIONS[command]?.args ?? [];
  // Only project fields that were actually supplied (plus omit undefined) so hidden
  // side-channel fields are not force-injected as undefined into the command validator.
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(args, field))
    .map((field) => [field, args[field]]));
}

function applicationRunId(name, args) {
  if (!APPLICATION_TOOL[name]) return args.runId ?? null;
  return ['fleet_run_start', 'baton_run_start'].includes(name) ? args.intent.runId ?? null : args.runId;
}

function transportHiddenFields(commandName) {
  const definition = APPLICATION_COMMAND_DEFINITIONS[commandName];
  const fromDefinition = definition?.transportHidden ? [...definition.transportHidden] : [];
  const fromRegistry = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => (
      operation.key === commandName
      || (commandName === 'run.inspect' && operation.key === 'run.view')
      || (commandName === 'waves.attach' && operation.key === 'waves.attach')
    ))
    .flatMap((operation) => operation.transportHidden ?? []);
  return new Set([...fromDefinition, ...fromRegistry]);
}

function validateArguments(name, args, maxWaitMs = null) {
  if (!record(args)) return 'invalid_arguments';
  const schemaDefinition = TOOL_BY_NAME.get(name).inputSchema;
  // S-1 v2 R-WG-3: advertised schema excludes transportHidden fields, but the validator still
  // accepts them when a caller supplies a declared-hidden side-channel argument.
  const hidden = APPLICATION_TOOL[name] ? transportHiddenFields(APPLICATION_TOOL[name]) : new Set();
  if (Object.keys(args).some((key) => (
    !Object.hasOwn(schemaDefinition.properties, key) && !hidden.has(key)
  ))) return 'unknown_argument_field';
  if (name === 'fleet_capability_invoke' && !Object.hasOwn(args, 'action')) return 'invalid_capability_invocation';
  if (schemaDefinition.required.some((key) => !Object.hasOwn(args, key))) return 'missing_argument';
  if (containsForbidden(args, [], { planGatedBrief: name === 'fleet_spawn' && record(args.goalPlan) })) return 'credential_fields_forbidden';
  if (!nonempty(args.repoId)) return 'invalid_repo';
  if (STATEFUL.has(name) && !SAFE_ID.test(args.idempotencyKey ?? '')) return 'invalid_idempotency_key';
  if (FENCED.has(name) && !Number.isSafeInteger(args.expectedFence)) return 'expected_fence_required';
  if (APPLICATION_TOOL[name]) {
    try {
      const command = APPLICATION_TOOL[name];
      const commandArgs = applicationArgs(name, args);
      validateApplicationCommandArgs(command, commandArgs);
    }
    catch { return 'invalid_run_command'; }
    if (['fleet_run_wait', 'fleet_run_follow'].includes(name)
      && (!Number.isSafeInteger(maxWaitMs) || args.timeoutMs > maxWaitMs)) return 'invalid_run_wait';
  }
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
    if (Object.hasOwn(args, 'goalPlan') && !validPlanBrief(args.brief)) return 'invalid_plan_brief';
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
  if (name === 'fleet_goal_plan_status' && (!/^goal:[a-f0-9]{64}$/.test(args.goalId ?? '')
    || !Number.isSafeInteger(args.goalVersion) || args.goalVersion <= 0 || !/^[a-f0-9]{64}$/.test(args.goalDigest ?? '')
    || !/^plan:[a-f0-9]{64}$/.test(args.planId ?? '')
    || !Number.isSafeInteger(args.planVersion) || args.planVersion <= 0 || !/^[a-f0-9]{64}$/.test(args.planDigest ?? '')
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
  // Reflex surface contract Part C.7 (R6): the advertised `answer` `oneOf` is never evaluated
  // server-side (hand-rolled validation stays the discipline, Part I), so this tool's own
  // answer-shape guard must reject any key other than `optionId`/`text` BEFORE hub dispatch —
  // `{decision}` would otherwise reach `run.answer` and settle an APPROVAL through this
  // decision-only tool. Kind-matching against the pending interaction stays hub-side.
  if (name === 'baton_decision_answer') {
    const answerKeys = record(args.answer) ? Object.keys(args.answer) : [];
    if (answerKeys.length !== 1 || !['optionId', 'text'].includes(answerKeys[0])) return 'invalid_arguments';
  }
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
      || !record(args.args) || !nonempty(args.workerId) || !nonempty(args.note) || Buffer.byteLength(args.note) > FRAME_LIMITS['orientation.note'].value
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
  // Part D (board tools): a bounded, hand-rolled shape check ahead of hub dispatch — the hub's own
  // exact()-style checks (SAFE_BOARD_ID, MAX_STORE_BOARD_TITLE_BYTES, ...) are the durable
  // authority; this only rejects obviously-malformed calls before an orchestrator-lease lookup.
  if (name === 'baton_board_post') {
    if (!nonempty(args.board) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(args.board)) return 'invalid_board';
    if (!nonempty(args.title) || Buffer.byteLength(args.title) > 160) return 'invalid_board_title';
    if (Object.hasOwn(args, 'detail') && args.detail !== null && (!nonempty(args.detail) || Buffer.byteLength(args.detail) > FRAME_LIMITS['board.detail'].value)) return 'invalid_board_detail';
    if (Object.hasOwn(args, 'owner') && args.owner !== null && !/^[A-Za-z0-9_.:-]{1,128}$/.test(args.owner ?? '')) return 'invalid_board_owner';
    if (Object.hasOwn(args, 'evidence') && (!Array.isArray(args.evidence) || args.evidence.length > 8)) return 'invalid_board_evidence';
    if (!Number.isSafeInteger(args.expectedBoardFence) || args.expectedBoardFence < 0) return 'invalid_board_fence';
  }
  if (name === 'baton_board_retitle') {
    if (!nonempty(args.itemId)) return 'invalid_board_item_id';
    if (!nonempty(args.title) || Buffer.byteLength(args.title) > 160) return 'invalid_board_title';
    if (Object.hasOwn(args, 'detail') && args.detail !== null && (!nonempty(args.detail) || Buffer.byteLength(args.detail) > FRAME_LIMITS['board.detail'].value)) return 'invalid_board_detail';
    if (!Number.isSafeInteger(args.expectedBoardFence) || args.expectedBoardFence < 0) return 'invalid_board_fence';
  }
  if (name === 'baton_board_reorder') {
    if (!nonempty(args.itemId)) return 'invalid_board_item_id';
    if (!Number.isSafeInteger(args.ordinal) || args.ordinal <= 0) return 'invalid_board_ordinal';
    if (!Number.isSafeInteger(args.expectedBoardFence) || args.expectedBoardFence < 0) return 'invalid_board_fence';
  }
  if (name === 'baton_board_close' && (!nonempty(args.itemId)
    || !Number.isSafeInteger(args.expectedBoardFence) || args.expectedBoardFence < 0)) {
    return !nonempty(args.itemId) ? 'invalid_board_item_id' : 'invalid_board_fence';
  }
  if (name === 'baton_board_drop' && (!nonempty(args.itemId)
    || !Number.isSafeInteger(args.expectedBoardFence) || args.expectedBoardFence < 0)) {
    return !nonempty(args.itemId) ? 'invalid_board_item_id' : 'invalid_board_fence';
  }
  if (name === 'baton_board_read' && !nonempty(args.board)) return 'invalid_board';
  // Part E (package tools): the branch payload's deep shape (unique names, source/artifact/
  // valueRef mold, provenance) is exhaustively validated by the hub's own
  // `_normalizeContextPackage` — never re-implemented here (Part I: no schema-evaluated
  // validation, no hub implementation changes).
  if (name === 'baton_package_admit' && !record(args.package)) return 'invalid_context_package';
  if (name === 'baton_package_attach') {
    if (!/^[a-f0-9]{64}$/.test(args.packageDigest ?? '')) return 'invalid_context_package_digest';
    if (!nonempty(args.runId)) return 'invalid_run_id';
    if (!nonempty(args.scope)) return 'invalid_context_package_scope';
  }
  if (name === 'baton_package_read') {
    if (!/^[a-f0-9]{64}$/.test(args.packageDigest ?? '')) return 'invalid_context_package_digest';
    if (Object.hasOwn(args, 'branchName') && !nonempty(args.branchName)) return 'invalid_context_package_branch';
  }
  if (name === 'baton_repl_cite' && (!nonempty(args.runId) || !nonempty(args.citation))) {
    return 'invalid_repl_citation';
  }
  if (name === 'baton_knowledge_recall' && (!record(args.query)
    || (Object.hasOwn(args, 'reader') && !record(args.reader))
    || (Object.hasOwn(args, 'options') && !record(args.options)))) return 'invalid_knowledge_recall';
  if (name === 'baton_knowledge_horizon' && (!['task', 'workflow', 'project'].includes(args.kind)
    || !nonempty(args.id) || (Object.hasOwn(args, 'board') && !nonempty(args.board)))) {
    return 'invalid_knowledge_horizon';
  }
  // MCP-W1/W2/W3 (mcp-packaging-decisions v1.0): hand-rolled shape guards for the ordinary-surface
  // wave ergonomics, doctor, and settlement tools (the reflex discipline — Part I: no schema
  // evaluator, hand-rolled validation stays the authority). These tools are explicit `_dispatch`
  // branches, so their args never pass through validateApplicationCommandArgs.
  if (name === 'baton_waves_start') {
    if (!Array.isArray(args.members) || args.members.length === 0 || args.members.length > 64) return 'invalid_wave_start';
    const roles = new Set();
    for (const member of args.members) {
      if (!record(member) || !nonempty(member.role) || !nonempty(member.objective)
        || !record(member.exact) || !nonempty(member.exact.harness)
        || !nonempty(member.exact.model) || !nonempty(member.exact.effort)
        || (Object.hasOwn(member, 'scope')
          && (!Array.isArray(member.scope) || member.scope.length === 0 || member.scope.length > 64
            || member.scope.some((item) => !nonempty(item))))) return 'invalid_wave_start';
      if (roles.has(member.role)) return 'invalid_wave_start';
      roles.add(member.role);
    }
  }
  if (name === 'baton_waves_progress' && (typeof args.waveId !== 'string' || !/^wave:[a-f0-9]{32}$/u.test(args.waveId)
    || (Object.hasOwn(args, 'cursor') && !Number.isSafeInteger(args.cursor)))) {
    return 'invalid_wave_progress';
  }
  if (name === 'baton_waves_send' && (!nonempty(args.runId) || !nonempty(args.message))) {
    return 'invalid_wave_send';
  }
  if (name === 'baton_waves_run' && (!args.spec || typeof args.spec !== 'object' || Array.isArray(args.spec))) {
    return 'invalid_workflow_run';
  }
  if (name === 'baton_waves_stop' && !nonempty(args.runId)) {
    return 'invalid_wave_stop';
  }
  if (name === 'baton_waves_list' && (Object.hasOwn(args, 'cursor') && !Number.isSafeInteger(args.cursor))) {
    return 'invalid_wave_list';
  }
  if (name === 'baton_scratchpad_elevate' && (!nonempty(args.runId) || !nonempty(args.taskId)
    || !nonempty(args.workerId) || !Number.isSafeInteger(args.expectedScratchpadFence)
    || args.expectedScratchpadFence < 0 || !Array.isArray(args.entryIds))) {
    return 'invalid_scratchpad_elevate';
  }
  if (name === 'baton_scratchpad_settle' && (!nonempty(args.runId)
    || !Number.isSafeInteger(args.expectedScratchpadFence) || args.expectedScratchpadFence < 0
    || (Object.hasOwn(args, 'skips') && !Array.isArray(args.skips)))) {
    return 'invalid_scratchpad_settle';
  }
  if (name === 'baton_knowledge_promote' && (!nonempty(args.runId) || !nonempty(args.candidateFindingId)
    || !record(args.policy) || !record(args.lease))) {
    return 'invalid_knowledge_promote';
  }
  if (name === 'baton_knowledge_settlement_lease' && !nonempty(args.waveId)) {
    return 'invalid_settlement_lease';
  }
  // Facade-projection epic (#87+#48, Decision 10): the six ordinary workflow-surface tools'
  // hand-rolled shape guards (the wave-tools idiom — the guards are the authority, never a
  // schema evaluator). A malformed DECLARED field earns the tool's own invalid_* code; a forged
  // UNDECLARED field dies earlier at the generic key-closure (unknown_argument_field). The
  // ordinary baton_run_scratchpad_elevate SHARES the invalid_scratchpad_elevate string the
  // existing settlement guard returns (lawful same-class reuse, v2.2 blue-team D3).
  if (name === 'baton_run_message_send') {
    if (!['inform', 'query', 'steer'].includes(args.kind)
      || typeof args.body !== 'string' || args.body.length === 0
      || (Object.hasOwn(args, 'runId') === Object.hasOwn(args, 'workerId'))
      || (Object.hasOwn(args, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? ''))
      || (Object.hasOwn(args, 'workerId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(args.workerId ?? ''))) {
      return 'invalid_message_send';
    }
  }
  if (name === 'baton_run_message_receipt'
    && (typeof args.messageId !== 'string' || !/^message:[a-f0-9]{64}$/.test(args.messageId))) {
    return 'invalid_message_receipt';
  }
  if (name === 'baton_run_attention_watch') {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')
      || (Object.hasOwn(args, 'kind') && (typeof args.kind !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(args.kind)))
      || (Object.hasOwn(args, 'cursor') && (!Number.isSafeInteger(args.cursor) || args.cursor < 0))) {
      return 'invalid_attention_watch';
    }
  }
  if (name === 'baton_run_scratchpad_read') {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')
      || typeof args.scope !== 'string' || !/^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/.test(args.scope)
      || (Object.hasOwn(args, 'cursor') && (!Number.isSafeInteger(args.cursor) || args.cursor < 0))) {
      return 'invalid_scratchpad_read';
    }
  }
  if (name === 'baton_run_scratchpad_elevate') {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')
      || !/^[A-Za-z0-9._:-]{1,256}$/.test(args.taskId ?? '')
      || !Array.isArray(args.entryIds) || args.entryIds.length > 128
      || new Set(args.entryIds).size !== args.entryIds.length
      || args.entryIds.some((id) => typeof id !== 'string' || !/^scratchpad-entry:[a-f0-9]{64}$/.test(id))) {
      return 'invalid_scratchpad_elevate';
    }
  }
  if (name === 'baton_run_knowledge_seed') {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')
      || !['Run', 'Task', 'Artifact', 'Phase', 'Experiment', 'Finding', 'Question', 'Hypothesis',
        'Principle', 'Constraint', 'Literature', 'Research', 'RouteStat', 'Skill', 'Counterexample',
        'Representation', 'ScratchFact', 'Source'].includes(args.type)
      || !['verified', 'observed', 'derived', 'asserted'].includes(args.grounding)
      || typeof args.body !== 'string' || args.body.length === 0
      || (Object.hasOwn(args, 'evidence') && !Array.isArray(args.evidence))) {
      return 'invalid_knowledge_seed';
    }
  }
  return null;
}

export class McpFleetServer {
  constructor(opts) {
    if (!opts?.coordinator || !opts?.coordination || !record(opts.principal)) throw new TypeError('MCP northbound requires coordinator, coordination, and injected principal');
    for (const method of ['admitMcpCall', 'completeMcpCall', 'failMcpCall', 'mcpCall', 'recordMcpAudit']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`coordination authority is missing ${method}()`);
    }
    // The quota authority is optional: an embedding host injects it to enforce deployment
    // account/seat/request budgets, but a server without one degrades to a permissive no-op
    // (the MP18 stdio factory and the descriptor-driven path both rely on this posture).
    this.takeToolQuota = typeof opts.takeToolQuota === 'function' ? opts.takeToolQuota : async () => ({ ok: true });
    this.coordinator = opts.coordinator;
    this.coordination = opts.coordination;
    this.application = opts.application ?? null;
    if (this.application !== null && (typeof this.application.command !== 'function'
      || typeof this.application.card !== 'function' || typeof this.application.authorizeReplay !== 'function')) {
      throw new TypeError('MCP application facade is invalid');
    }
    this.applicationOwned = opts.applicationOwned ?? this.application !== null;
    if (typeof this.applicationOwned !== 'boolean' || (this.application === null && this.applicationOwned)) {
      throw new TypeError('MCP application ownership is invalid');
    }
    this.shutdownPrincipal = this.application === null || !this.applicationOwned
      ? null
      : applicationPrincipal(opts.shutdownPrincipal, 'MCP shutdownPrincipal');
    this.principal = Object.freeze(clone(opts.principal));
    this.isPrincipalActive = opts.isPrincipalActive ?? null;
    if (this.isPrincipalActive !== null && typeof this.isPrincipalActive !== 'function') {
      throw new TypeError('MCP isPrincipalActive authority must be a function');
    }
    this.repoIds = new Set(opts.repoIds ?? []);
    this.surface = opts.surface ?? (this.application ? 'application' : 'advanced');
    if (!['application', 'advanced', 'combined'].includes(this.surface)
      || (this.surface !== 'advanced' && !this.application)) {
      throw new TypeError('MCP surface requires an available application or an explicit advanced surface');
    }
    if (this.application !== null) {
      const [servedRepoId] = this.repoIds;
      const applicationCard = this.application.card();
      const requiredEntries = this.surface === 'application' ? ORDINARY_APPLICATION_ENTRIES
        : this.surface === 'combined' ? [...ORDINARY_APPLICATION_ENTRIES, ...MCP_APPLICATION_ENTRIES] : [];
      if (this.repoIds.size !== 1 || this.application.repoId !== servedRepoId
        || applicationCard?.repoId !== servedRepoId || !Array.isArray(applicationCard.commands)
        || requiredEntries.some(([, name]) => !applicationCard.commands.includes(name))) {
        throw new TypeError('MCP application facade does not match the served repository or command contract');
      }
    }
    this.bindApplicationContext = opts.bindApplicationContext ?? false;
    if (typeof this.bindApplicationContext !== 'boolean'
      || (this.bindApplicationContext && this.surface !== 'application')) {
      throw new TypeError('MCP bound application context requires the ordinary application surface');
    }
    this.boundRepoId = this.bindApplicationContext ? [...this.repoIds][0] : null;
    this.now = opts.now ?? Date.now;
    this.maxWaitMs = opts.maxWaitMs ?? 25_000;
    // A deployment-derived frame ceiling is normally injected; a server without one degrades to
    // the documented 256 KiB default (the MP18 stdio factory and the descriptor-driven path rely
    // on this posture).
    this.maxMessageBytes = opts.maxMessageBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(this.maxWaitMs) || this.maxWaitMs <= 0) throw new TypeError('maxWaitMs must be a positive safe integer');
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes <= 0) throw new TypeError('maxMessageBytes must be a deployment-derived positive safe integer');
    this.lifecycle = 'new';
    const selectedTools = this.surface === 'application' ? ORDINARY_APPLICATION_TOOL_DEFINITIONS
      : this.surface === 'advanced' ? ADVANCED_TOOL_DEFINITIONS : TOOL_DEFINITIONS;
    this.toolDefinitions = selectedTools.map((tool) => {
      const copy = clone(tool);
      // docs/36 §8.4 (M5) — the per-deployment schema mutation retired: the advertised schema is
      // deployment-independent, and the deployment bound is enforced at validation time
      // (validateArguments rejects timeoutMs > this.maxWaitMs with invalid_run_wait).
      if (this.bindApplicationContext) {
        delete copy.inputSchema.properties.repoId;
        delete copy.inputSchema.properties.idempotencyKey;
        copy.inputSchema.required = copy.inputSchema.required
          .filter((field) => field !== 'repoId' && field !== 'idempotencyKey');
      }
      return Object.freeze(copy);
    });
    this.toolNames = new Set(this.toolDefinitions.map((tool) => tool.name));
    this._drainDispatches = new Map();
    this._applicationDispatches = new Map();
    this.maxObservationAudits = opts.maxObservationAudits ?? 512;
    if (!Number.isSafeInteger(this.maxObservationAudits) || this.maxObservationAudits <= 0) {
      throw new TypeError('MCP observation audit bound must be a positive safe integer');
    }
    this._observationAudits = [];
    this._closePromise = null;
    // Part D rule 10: process-local, non-evented board view cache — rebuilt from an empty Map on
    // every restart (a fresh McpFleetServer instance), never a durable/ledger-backed cache.
    this._boardViewCache = new Map();
  }

  async close() {
    if (this._closePromise) return this._closePromise;
    const closing = Promise.resolve().then(async () => {
      this.lifecycle = 'closed';
      if (this.application === null || !this.applicationOwned) {
        return Object.freeze({ schemaVersion: 1, state: 'transport_closed', applicationOwned: false });
      }
      return this.application.command('application.shutdown', {}, this.shutdownPrincipal);
    });
    this._closePromise = closing;
    try {
      return await closing;
    } catch (cause) {
      if (this._closePromise === closing) this._closePromise = null;
      throw cause;
    }
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
    const requiredCapabilities = Array.isArray(CAPABILITY[name]) ? CAPABILITY[name] : [CAPABILITY[name]];
    if (!Array.isArray(p.capabilities)
      || !requiredCapabilities.every((capability) => p.capabilities.includes(capability))) return 'forbidden';
    if (!this.repoIds.has(args.repoId) || !Array.isArray(p.repoIds) || !p.repoIds.includes(args.repoId)) return 'forbidden';
    if (this.isPrincipalActive && !this.isPrincipalActive(p, { tool: name, repoId: args.repoId })) return 'unauthenticated';
    return null;
  }

  _audit(kind, tool, args, detail = null) {
    const entry = {
      kind, tool, userId: this.principal.userId, sessionId: this.principal.sessionId,
      repoId: nonempty(args?.repoId) ? args.repoId : null, detail,
    };
    if (BOUNDED_OBSERVATION_AUDITS.has(kind)) {
      this._observationAudits.push(Object.freeze(entry));
      if (this._observationAudits.length > this.maxObservationAudits) this._observationAudits.shift();
      return Object.freeze({ schemaVersion: 1, storage: 'bounded_memory' });
    }
    return this.coordination.recordMcpAudit(entry, {
      actor: `mcp:${this.principal.userId}:${this.principal.sessionId}`,
      key: `mcp.audit:${randomUUID()}`,
    });
  }

  async handle(message) {
    if (!record(message) || message.jsonrpc !== '2.0' || !nonempty(message.method)) return protocolError(message?.id ?? null, -32600, 'Invalid Request');
    const { id, method, params } = message;
    if (this.lifecycle === 'closed') return protocolError(id, -32002, 'Server closed');
    if (method === 'initialize') {
      if (this.lifecycle !== 'new') return protocolError(id, -32600, 'Invalid Request');
      if (id === undefined || !record(params) || !nonempty(params.protocolVersion) || !record(params.capabilities)
        || !record(params.clientInfo) || !nonempty(params.clientInfo.name) || !nonempty(params.clientInfo.version)) return protocolError(id, -32602, 'Invalid params');
      this.lifecycle = 'initializing';
      // Epic #103 (D6a): one bounded trailing sentence composed per initialize from the family
      // head — the pack is data, not a gate (initialize succeeds identically with or without it),
      // and an absent pack degrades to the honest-empty line, never a fabricated digest (D5b).
      const briefingHead = this.coordination?.contextPackHead?.(BRIEFING_FAMILY) ?? null;
      const briefingSentence = briefingHead
        ? `Briefing pack ${briefingHead.packId} minted at event ${briefingHead.observedSeq} (ledger at ${this.coordination.ledgerHeadSeq()}, Δ=${this.coordination.ledgerHeadSeq() - briefingHead.observedSeq}); resolve via the orchestrator's embedded context.briefing command.`
        : 'No orchestrator briefing pack minted yet.';
      return protocolResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'baton', version: '0.1.0' },
        instructions: `${flipFace('smile')} baton — reflexive multi-agent orchestration. Waves are the primary surface (start/attach/steer); settlement lanes arrive through the envelope tools. See MCP.md. ${briefingSentence}`,
      });
    }
    if (method === 'notifications/initialized') {
      // A notification carries no id and returns no frame. The stdio smoke driver writes this
      // step with an injected id (its request/response driver conflates notifications with
      // requests); a tolerant server answers the id-bearing initialization notification with the
      // ready inventory so the packed-install handshake observes the advertised tools in one
      // round trip. Id-less notifications keep the spec behavior: transition + no frame.
      if (this.lifecycle === 'initializing') this.lifecycle = 'ready';
      if (id !== undefined) return protocolResult(id, { tools: this.toolDefinitions.map(clone) });
      return null;
    }
    if (method === 'ping') return id === undefined ? null : protocolResult(id, {});
    if (this.lifecycle !== 'ready') return protocolError(id, -32002, 'Server not initialized');
    if (method === 'tools/list') return id === undefined ? null : protocolResult(id, { tools: this.toolDefinitions.map(clone) });
    if (method !== 'tools/call') return protocolError(id, -32601, 'Method not found');
    if (id === undefined || !record(params) || !nonempty(params.name) || !this.toolNames.has(params.name)) return protocolError(id, -32602, 'Invalid params');
    const suppliedArgs = params.arguments ?? {};
    if (this.bindApplicationContext && record(suppliedArgs)
      && (Object.hasOwn(suppliedArgs, 'repoId') || Object.hasOwn(suppliedArgs, 'idempotencyKey'))) {
      try { this._audit('tool_invalid', params.name, {}, 'invalid_arguments'); }
      catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError('invalid_arguments'));
    }
    if (this.bindApplicationContext
      && !(typeof id === 'string' && id.length > 0 && Buffer.byteLength(id) <= 256)
      && !(Number.isSafeInteger(id) && id >= 0)) {
      return protocolError(id, -32600, 'Invalid Request');
    }
    const args = this.bindApplicationContext ? {
      ...suppliedArgs,
      repoId: this.boundRepoId,
      ...(STATEFUL.has(params.name) ? {
        idempotencyKey: `bound:${hash({
          repoId: this.boundRepoId,
          userId: this.principal.userId,
          sessionId: this.principal.sessionId,
          tool: params.name,
          ...(APPLICATION_TOOL[params.name] === 'run.act'
            ? { semanticRequest: suppliedArgs }
            : { requestId: id }),
        })}`,
      } : {}),
    } : suppliedArgs;
    const invalid = validateArguments(params.name, args, this.maxWaitMs);
    if (invalid) {
      try { this._audit('tool_invalid', params.name, args, invalid); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError(invalid));
    }
    const refused = this._authority(params.name, args);
    if (refused) {
      try { this._audit('tool_refused', params.name, args, refused); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError(refused));
    }
    if (APPLICATION_TOOL[params.name] && !this.application) {
      try { this._audit('application_unavailable', params.name, args); }
      catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError('application_unavailable'));
    }
    let semanticAuthority = null;
    if (APPLICATION_TOOL[params.name] === 'run.act') {
      if (typeof this.application.actionAuthority !== 'function') {
        return protocolResult(id, toolError('application_unavailable'));
      }
      const scopeKey = this.callScope(params.name, args);
      const requestDigest = this.callDigest(args);
      const prior = this.coordination.mcpCallByScope?.(scopeKey) ?? null;
      if (prior && prior.requestDigest !== requestDigest) {
        try { this._audit('tool_refused', params.name, args, 'idempotency_conflict'); }
        catch { return protocolResult(id, toolError('temporarily_unavailable')); }
        return protocolResult(id, toolError('idempotency_conflict'));
      }
      try {
        semanticAuthority = prior?.semanticAuthority ?? await this.application.actionAuthority(
          applicationArgs(params.name, args),
          {
            actor: `mcp:${this.principal.userId}:${this.principal.sessionId}`,
            principalId: this.principal.userId,
            sessionId: this.principal.sessionId,
          },
          {
            transport: 'mcp', requestId: String(id), idempotencyKey: `mcp.call:${id}`,
            capabilityAuthority: northboundCapabilityToken('mcp'),
            capabilities: [...this.principal.capabilities],
          },
        );
      } catch (cause) {
        try { this._audit('tool_refused', params.name, args, stateFailureCode(cause)); }
        catch { return protocolResult(id, toolError('temporarily_unavailable')); }
        return protocolResult(id, toolError(stateFailureCode(cause)));
      }
      if (!Array.isArray(semanticAuthority?.requiredCapabilities)
        || !semanticAuthority.requiredCapabilities.every(
          (capability) => this.principal.capabilities.includes(capability),
        )) {
        try { this._audit('tool_refused', params.name, args, 'forbidden'); }
        catch { return protocolResult(id, toolError('temporarily_unavailable')); }
        return protocolResult(id, toolError('forbidden'));
      }
    }
    // MCP-W3 (mcp-packaging-decisions v1.0): deployment.doctor is quota-free — it is the
    // route-picking prerequisite, and charging quota would blind callers exactly when they need
    // it (glm #6). MCP-W1 (codex #1): waves.start debits quota PER MEMBER, never once per call —
    // one debit must not fan out to 64 starts.
    let quota = { ok: true };
    if (params.name !== 'baton_deployment_doctor') {
      const debitCount = params.name === 'baton_waves_start' && Array.isArray(args.members)
        ? args.members.length : 1;
      try {
        for (let index = 0; index < debitCount; index += 1) {
          const debit = await this.takeToolQuota({
            userId: this.principal.userId, sessionId: this.principal.sessionId,
            tool: params.name, repoId: args.repoId, ...(debitCount > 1 ? { memberIndex: index, memberCount: debitCount } : {}),
          });
          if (debit?.ok !== true) { quota = { ok: false }; break; }
        }
      } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
    }
    if (!quota?.ok) {
      try { this._audit('tool_rate_limited', params.name, args); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError('rate_limited'));
    }
    return protocolResult(id, await this._callTool(params.name, args, id, semanticAuthority));
  }

  async _callTool(name, args, requestId, semanticAuthority = null) {
    if (!STATEFUL.has(name)) {
      try {
        const observeCallId = `observe-${hash({
          repoId: args.repoId,
          userId: this.principal.userId,
          sessionId: this.principal.sessionId,
          tool: name,
          requestId,
        })}`;
        const value = await this._dispatch(name, args, null, observeCallId, this.principal);
        const refused = ['fleet_run_follow', 'fleet_run_wait'].includes(name) ? this._authority(name, args) : null;
        if (refused) {
          this._audit('tool_refused_after_wait', name, args, refused);
          return toolError(refused);
        }
        const outcome = toolResult(value);
        this._audit('tool_completed', name, args);
        return outcome;
      } catch (cause) {
        try { this._audit('tool_failed', name, args, 'command_failed'); }
        catch { return toolError('temporarily_unavailable'); }
        // Part F: read-only reflex tools (not APPLICATION_TOOL-registered — Part A.2) map typed
        // codes too, never the generic 'command_failed'.
        const code = (name === 'baton_run_message_receipt' || name === 'baton_run_scratchpad_elevate')
          && cause?.code === 'application_unauthorized'
          ? 'application_unauthorized' : stateFailureCode(cause);
        // The coaching message rides ONLY typed lane refusals (their messages are the lane's own
        // sanitized compositions — FP-15's cap+actual naming); an untyped internal throw keeps the
        // MN1/MN8 sanitization law — never a private provider detail in a tool error.
        return toolError(name === 'fleet_goal_plan_status' || APPLICATION_TOOL[name]
          || REFLEX_READ_ONLY_TOOLS.has(name) || ORDINARY_EXPLICIT_TOOLS.has(name)
          ? code : 'command_failed', typeof cause?.code === 'string' ? (cause?.message ?? null) : null);
      }
    }
    const callId = randomUUID();
    const scopeKey = this.callScope(name, args);
    const actor = `mcp:${this.principal.userId}:${this.principal.sessionId}`;
    let admission;
    try {
      admission = this.coordination.admitMcpCall({
        callId, scopeKey, requestDigest: this.callDigest(args), tool: name, repoId: args.repoId,
        runId: applicationRunId(name, args), userId: this.principal.userId, sessionId: this.principal.sessionId,
        ...(semanticAuthority ? { semanticAuthority } : {}),
      }, { actor, key: `mcp.admit:${scopeKey}` });
    } catch { return toolError('temporarily_unavailable'); }
    if (!admission.ok) return toolError(admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_call');
    if (APPLICATION_TOOL[name] === 'run.act'
      && admission.call.semanticAuthority?.authorityDigest !== semanticAuthority?.authorityDigest) {
      return toolError('application_action_authority_invalid');
    }
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
        if (APPLICATION_TOOL[name] === 'run.act'
          && admission.call.sessionId !== this.principal.sessionId) {
          return toolError('forbidden');
        }
        const admittedCallId = admission.call.callId;
        const admittedActor = `mcp:${admission.call.userId}:${admission.call.sessionId ?? this.principal.sessionId}`;
        const admittedPrincipal = {
          ...this.principal,
          userId: admission.call.userId,
          sessionId: admission.call.sessionId ?? this.principal.sessionId,
        };
        let outcome;
        try {
          outcome = toolResult(await (APPLICATION_TOOL[name]
            ? this._dispatchApplicationOnce(
              name, args, admittedActor, admittedCallId, admittedPrincipal,
              admission.call.semanticAuthority ?? null,
            )
            : this._dispatch(name, args, admittedActor, admittedCallId, admittedPrincipal)));
        }
        catch (cause) {
          outcome = toolError(stateFailureCode(cause));
          try { this.coordination.failMcpCall(admittedCallId, outcome, { actor: admittedActor, key: `mcp.fail:${admittedCallId}` }); }
          catch { return toolError('temporarily_unavailable'); }
          if (APPLICATION_TOOL[name]) this._applicationDispatches.delete(admittedCallId);
          return outcome;
        }
        try { this.coordination.completeMcpCall(admittedCallId, outcome, { actor: admittedActor, key: `mcp.complete:${admittedCallId}` }); }
        catch {
          if (APPLICATION_TOOL[name]) this._applicationDispatches.delete(admittedCallId);
          return toolError('temporarily_unavailable');
        }
        if (APPLICATION_TOOL[name]) this._applicationDispatches.delete(admittedCallId);
        return outcome;
      }
      if (admission.call.status === 'admitted') return toolError('call_admitted');
      if (admission.call.status === 'completed' && ['fleet_reuse_decide', 'fleet_reuse_recheck'].includes(name)) {
        try { return toolResult(await this._dispatch(name, args, actor, admission.call.callId)); } catch { return toolError('temporarily_unavailable'); }
      }
      if (admission.call.status === 'completed' && APPLICATION_TOOL[name]) {
        try {
          const sessionAuthority = this.principal.sessionAuthority ?? null;
          await this.application.authorizeReplay(APPLICATION_TOOL[name], applicationArgs(name, args), {
            actor, principalId: this.principal.userId, sessionId: this.principal.sessionId,
          }, {
            transport: 'mcp', requestId: String(admission.call.callId),
            idempotencyKey: `mcp.call:${admission.call.callId}`,
            capabilityAuthority: northboundCapabilityToken('mcp'),
            capabilities: [...this.principal.capabilities],
            ...(APPLICATION_TOOL[name] === 'run.act' ? {
              semanticAuthority: admission.call.semanticAuthority,
            } : {}),
            ...(sessionAuthority ? { sessionAuthority: clone(sessionAuthority) } : {}),
          });
        } catch (cause) { return toolError(stateFailureCode(cause)); }
      }
      if (GOAL_PLAN_MUTATIONS.has(name)) {
        const prior = admission.call.outcome;
        if (!record(prior?.structuredContent)) return toolError('command_outcome_unknown');
        return toolResult(sanitizeGoalPlanProjection(prior.structuredContent), prior.isError === true);
      }
      return clone(admission.call.outcome);
    }
    let outcome;
    try {
      outcome = toolResult(await (name === 'fleet_drain'
        ? this._dispatchDrain(args, actor, callId)
        : APPLICATION_TOOL[name]
          ? this._dispatchApplicationOnce(
            name, args, actor, callId, this.principal,
            admission.call.semanticAuthority ?? null,
          )
          : this._dispatch(name, args, actor, callId)));
    }
    catch (cause) {
      // #132 D5.2 (wave-observability-2026-08-06/contract.md §D5.1/§D5.2): a TYPED lane refusal
      // (wave_member_invalid / wave_not_found) carries the lane's OWN message byte-identically plus
      // the {actual, cap, cause, role} detail (W6/F4). An untyped internal throw keeps the MN1/MN8
      // sanitization law — code-only, never a private provider detail in a tool error.
      const stateCode = stateFailureCode(cause);
      // The message/detail payload rides ONLY for the lane-crafted codes (wave_member_invalid /
      // wave_not_found / workflow_*) whose messages are authored by the lane itself (W6/F4).
      // Any other typed error keeps the MN1/MN8 sanitization law: code-only, never a private
      // provider/detail leak (the GP7/GP8 pin — an arbitrary typed throw's message is NOT safe).
      const LANE_CRAFTED = typeof cause?.code === 'string'
        && (cause.code === 'wave_member_invalid' || cause.code === 'wave_not_found' || cause.code.startsWith('workflow_'));
      outcome = LANE_CRAFTED
        ? toolError(stateCode, cause?.message ?? null, cause?.detail ?? null)
        : toolError(stateCode);
      try { this.coordination.failMcpCall(callId, outcome, { actor, key: `mcp.fail:${callId}` }); }
      catch { return toolError('temporarily_unavailable'); }
      if (APPLICATION_TOOL[name]) this._applicationDispatches.delete(callId);
      return outcome;
    }
    try { this.coordination.completeMcpCall(callId, outcome, { actor, key: `mcp.complete:${callId}` }); }
    catch {
      if (APPLICATION_TOOL[name]) this._applicationDispatches.delete(callId);
      return toolError('temporarily_unavailable');
    }
    if (APPLICATION_TOOL[name]) this._applicationDispatches.delete(callId);
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

  _dispatchApplicationOnce(name, args, actor, callId, principal, semanticAuthority = null) {
    const existing = this._applicationDispatches.get(callId);
    if (existing) return existing;
    const pending = Promise.resolve().then(
      () => this._dispatch(name, args, actor, callId, principal, semanticAuthority),
    );
    this._applicationDispatches.set(callId, pending);
    return pending;
  }

  async _dispatch(name, args, actor, callId, principal = this.principal, semanticAuthority = null) {
    let value;
    if (APPLICATION_TOOL[name]) {
      value = await this.application.command(
        APPLICATION_TOOL[name],
        applicationArgs(name, args),
        {
          actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
          principalId: principal.userId,
          sessionId: principal.sessionId,
        },
        {
          ...this._applicationDispatchContext(args, callId, principal),
          ...(APPLICATION_TOOL[name] === 'run.act' ? { semanticAuthority } : {}),
        },
      );
    }
    // Reflex surface contract Part B: an explicit branch (never an APPLICATION_COMMAND_DEFINITIONS
    // key — Part A.2) calling the direct command port `application.contextEval(...)`. The branch
    // STRIPS repoId/idempotencyKey before the call; `validateContextEvalArgs` refuses unknown
    // keys, so everything else in `args` (runId/manifestDigest/role/program) passes through
    // unchanged for the method's own exactly-one-of enforcement.
    else if (name === 'baton_context_eval') {
      const { repoId: _repoId, idempotencyKey: _idempotencyKey, ...request } = args;
      value = await this.application.contextEval(request, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // Reflex surface contract Part C.6: a read-only direct command port reading
    // `projectDecisionAttention` for the Run's own workers — never a ledger event.
    else if (name === 'baton_decision_list') {
      value = await this.application.decisionList({ runId: args.runId }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, { transport: 'mcp', requestId: String(callId), idempotencyKey: `mcp.call:${callId}` });
    }
    // Reflex surface contract Part C.7: the generic `run.answer` branch's lease/sessionAuthority
    // passthrough, reused verbatim via `_applicationDispatchContext` — the answer-shape guard
    // (R6) already ran in `validateArguments` before dispatch ever reaches here.
    else if (name === 'baton_decision_answer') {
      value = await this.application.command('run.answer', {
        runId: args.runId, requestId: args.requestId, answer: args.answer,
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // MCP-W1 (mcp-packaging-decisions v1.0): the wave ergonomics direct ports. All four dispatch
    // to application.command('waves.*', ...) — the per-member quota already ran in `handle`, the
    // profile/route admission lives in the application's ordinary run.start path.
    else if (name === 'baton_waves_start') {
      value = await this.application.command('waves.start', {
        idempotencyKey: args.idempotencyKey, members: clone(args.members),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_waves_progress') {
      value = await this.application.command('waves.progress', {
        waveId: args.waveId, ...(Object.hasOwn(args, 'cursor') ? { cursor: args.cursor } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_waves_send') {
      value = await this.application.command('waves.send', {
        runId: args.runId, message: args.message,
        ...(Object.hasOwn(args, 'delivery') ? { delivery: args.delivery } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_waves_stop') {
      value = await this.application.command('waves.stop', {
        runId: args.runId, ...(Object.hasOwn(args, 'reason') ? { reason: args.reason } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // #132 D2.4: the registry read — cursor only, never repoId (the application scopes the registry
    // to THIS deployment by construction).
    else if (name === 'baton_waves_list') {
      value = await this.application.command('waves.list', {
        ...(Object.hasOwn(args, 'cursor') ? { cursor: args.cursor } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // Issue #114 (D2): the workflow-as-data lane — the spec object drives a whole wave via waves.run.
    else if (name === 'baton_waves_run') {
      value = await this.application.command('waves.run', {
        spec: clone(args.spec),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // MCP-W3: deployment.doctor — quota-free (handle), per-call FRESH doctorReadiness, secret
    // material stripped at the surface (canary-pinned by MP10).
    else if (name === 'baton_deployment_doctor') {
      value = await this._freshDoctorReadiness();
    }
    // MCP-W2: the four settlement tools via the S-2 sessionAuthority envelope. The envelope is
    // the authenticated connection's proof — never a caller field. knowledge.promote REQUIRES it
    // (validated exactly as S-2 made it for board commands); the settlement lease requires the
    // settlement capability class (already enforced by _authority).
    else if (name === 'baton_scratchpad_elevate') {
      value = await this.application.command('scratchpad.elevate', {
        runId: args.runId, taskId: args.taskId, workerId: args.workerId,
        expectedScratchpadFence: args.expectedScratchpadFence, entryIds: clone(args.entryIds),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_scratchpad_settle') {
      value = await this.application.command('scratchpad.settle', {
        runId: args.runId, expectedScratchpadFence: args.expectedScratchpadFence,
        ...(Object.hasOwn(args, 'skips') ? { skips: clone(args.skips) } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_knowledge_promote') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      if (sessionAuthority == null) {
        throw Object.assign(new Error('an active settlement lease is required'), { code: 'board_lease_required' });
      }
      value = await this.application.command('knowledge.promote', {
        runId: args.runId, candidateFindingId: args.candidateFindingId,
        policy: clone(args.policy), lease: clone(args.lease),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_knowledge_settlement_lease') {
      value = await this.application.command('knowledge.settlement_lease', {
        waveId: args.waveId, ...(Object.hasOwn(args, 'members') ? { members: clone(args.members) } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // Facade-projection epic (#87+#48, Decision 10): the six ordinary workflow-surface tools
    // dispatch their facade commands with the CONNECTION-derived principal (never tool args) and
    // the application context (transport mcp + capability authority). None carries a wire
    // idempotencyKey; replay safety lives server-side in the deterministic keys.
    else if (name === 'baton_run_message_send') {
      value = await this.application.command('run.message.send', {
        ...(Object.hasOwn(args, 'runId') ? { runId: args.runId } : {}),
        ...(Object.hasOwn(args, 'workerId') ? { workerId: args.workerId } : {}),
        kind: args.kind, body: args.body,
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_run_message_receipt') {
      value = await this.application.command('run.message.receipt', { messageId: args.messageId }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_run_attention_watch') {
      try {
        value = await this.application.command('run.attention.watch', {
          runId: args.runId,
          ...(Object.hasOwn(args, 'kind') ? { kind: args.kind } : {}),
          ...(Object.hasOwn(args, 'cursor') ? { cursor: args.cursor } : {}),
        }, {
          actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
          principalId: principal.userId, sessionId: principal.sessionId,
        }, this._applicationDispatchContext(args, callId, principal));
      } catch (cause) {
        // Decision 5's transport authority: a control-capable connection principal is the
        // deployment orchestrator the lane recognizes — page the run (empty for unknown/unauthorized
        // scopes) instead of surfacing attention_scope_forbidden. Observe-only principals keep the
        // lane's refusal byte-identically (FP-15 pins that wire).
        if (cause?.code === 'attention_scope_forbidden' && Array.isArray(principal.capabilities)
          && principal.capabilities.includes('control')) {
          value = { schemaVersion: 1, runId: args.runId, afterCursor: 0, throughCursor: 0, reasons: [] };
        } else {
          throw cause;
        }
      }
    }
    else if (name === 'baton_run_scratchpad_read') {
      value = await this.application.command('run.scratchpad.read', {
        runId: args.runId, scope: args.scope,
        ...(Object.hasOwn(args, 'cursor') ? { cursor: args.cursor } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_run_scratchpad_elevate') {
      value = await this.application.command('run.scratchpad.elevate', {
        runId: args.runId, taskId: args.taskId, entryIds: clone(args.entryIds),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_run_knowledge_seed') {
      value = await this.application.command('run.knowledge.seed', {
        runId: args.runId, type: args.type, grounding: args.grounding, body: args.body,
        ...(Object.hasOwn(args, 'evidence') ? { evidence: clone(args.evidence) } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'fleet_spawn') value = await this.coordinator.spawn(args.harness, args.brief, {
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
      taskId: args.taskId ?? `mcp-${callId}`,
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
      goalId: args.goalId, goalVersion: args.goalVersion, goalDigest: args.goalDigest,
      planId: args.planId, planVersion: args.planVersion, planDigest: args.planDigest, throughSeq: args.throughSeq,
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
    // S-2 v2 board tools are thin translations into the closed admission envelope. Lease proof,
    // Run binding, existence, fence/parent CAS, and replay all live in the serialized store path.
    else if (name === 'baton_board_post') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this._admitBoardEnvelope({
        sessionAuthority, runId: args.runId, board: args.board, item: null,
        mutation: { kind: 'post', title: args.title, detail: args.detail ?? null,
          owner: args.owner ?? null, evidence: args.evidence ?? [] },
        expectedBoardFence: args.expectedBoardFence, idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_board_retitle') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this._admitBoardEnvelope({
        sessionAuthority, runId: args.runId, board: args.board,
        item: { itemId: args.itemId, itemVersion: args.itemVersion },
        mutation: { kind: 'retitle', title: args.title, detail: args.detail ?? null },
        expectedBoardFence: args.expectedBoardFence, idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_board_reorder') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this._admitBoardEnvelope({
        sessionAuthority, runId: args.runId, board: args.board,
        item: { itemId: args.itemId, itemVersion: args.itemVersion },
        mutation: { kind: 'reorder', ordinal: args.ordinal },
        expectedBoardFence: args.expectedBoardFence, idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_board_close') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this._admitBoardEnvelope({
        sessionAuthority, runId: args.runId, board: args.board,
        item: { itemId: args.itemId, itemVersion: args.itemVersion },
        mutation: { kind: 'close' }, expectedBoardFence: args.expectedBoardFence,
        idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_board_drop') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this._admitBoardEnvelope({
        sessionAuthority, runId: args.runId, board: args.board,
        item: { itemId: args.itemId, itemVersion: args.itemVersion },
        mutation: { kind: 'drop' }, expectedBoardFence: args.expectedBoardFence,
        idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_board_read') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      const admitted = this._admitBoardEnvelope({
        sessionAuthority, runId: args.runId, board: args.board, item: null,
        mutation: { kind: 'read' }, expectedBoardFence: null,
        idempotencyKey: `mcp.observe:${hash({ name, args, callId })}`,
      });
      value = projectBoardView(admitted.snapshot, { role: 'orchestrator', workerId: null }, this._boardViewCache);
    }
    // Part E — package tools: bound directly to the landed coordination-store hub methods (no
    // Coordinator wrapper exists for these, matching the contract's coordination-store.mjs line
    // citations). Admit/attach require an active run-orchestrator lease; attach's auth.key is the
    // exact `package.attach:<digest>:<runId>:<scope>` string the hub itself validates (the fenced
    // O(1) pointer binding — never a re-read of branch bytes).
    else if (name === 'baton_package_admit') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this.coordination.admitPackageCommand({
        sessionAuthority, runId: args.runId,
        package: args.package, mutation: { kind: 'admit' }, idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_package_attach') {
      const { sessionAuthority } = this._boardAuthorityContext(principal);
      value = this.coordination.admitPackageCommand({
        sessionAuthority, runId: args.runId, package: args.packageDigest,
        mutation: { kind: 'attach', scope: args.scope },
        idempotencyKey: `package.attach:${args.packageDigest}:${args.runId}:${args.scope}`,
      });
    }
    else if (name === 'baton_package_read') {
      value = args.branchName
        ? projectContextPackageBranch(this.coordination.withContextArtifactVerification(
          () => this.coordination.resolveContextPackageBranch(args.packageDigest, args.branchName),
        ))
        : this._readContextPackage(args.packageDigest);
    }
    else if (name === 'baton_repl_cite') {
      value = this.coordinator.resolveReplCitation(args.runId, args.citation);
    }
    else if (name === 'baton_knowledge_recall') {
      value = this.coordinator.recallKnowledge(args.query, args.reader ?? {}, {
        ...(args.options ?? {}), actor, idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_knowledge_horizon') {
      if (args.kind === 'task') value = this.coordinator.taskHorizon(args.id, { board: args.board ?? null });
      else if (args.kind === 'workflow') {
        value = this.coordinator.workflowHorizon(args.id, { viewer: 'orchestrator' });
      } else value = this.coordinator.projectHorizon(args.repoId);
    }
    if (value?.result === 'stale_fence') throw Object.assign(new Error('stale fence'), { mcpCode: 'stale_fence' });
    if (APPLICATION_TOOL[name] && Buffer.byteLength(JSON.stringify(toolResult(value))) > this.maxMessageBytes) {
      throw Object.assign(new Error('RunView exceeds the MCP response ceiling'), { code: 'application_run_view_oversize' });
    }
    return normalized(GOAL_PLAN_MUTATIONS.has(name) ? sanitizeGoalPlanProjection(value) : value);
  }

  // Shared by the generic APPLICATION_TOOL branch and the explicit reflex branches (Part B/C.7):
  // transport/requestId/idempotencyKey/capabilityAuthority/capabilities, plus sessionAuthority
  // only when a live run-orchestrator lease exists for this session.
  _applicationDispatchContext(args, callId, principal = this.principal) {
    const sessionAuthority = principal.sessionAuthority ?? null;
    return {
      transport: 'mcp', requestId: String(callId), idempotencyKey: `mcp.call:${callId}`,
      capabilityAuthority: northboundCapabilityToken('mcp'),
      capabilities: [...principal.capabilities],
      ...(sessionAuthority ? { sessionAuthority: clone(sessionAuthority) } : {}),
    };
  }

  _goalPlanContext(name, args, actor, callId, principal = this.principal) {
    return {
      actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
      principalId: principal.userId, sessionId: principal.sessionId,
      powers: clone(principal.capabilities), repoId: args.repoId, runId: args.runId ?? null,
      idempotencyKey: callId ? `mcp.call:${callId}` : `mcp.observe:${hash({ name, args, userId: principal.userId })}`,
    };
  }

  _admitBoardEnvelope(envelope) {
    return typeof this.coordinator.admitBoardCommand === 'function'
      ? this.coordinator.admitBoardCommand(envelope)
      : this.coordination.admitBoardCommand(envelope);
  }

  // The proof comes from the authenticated connection. This adapter never reconstructs it from
  // caller-named principal/session identifiers or from the lease's own stored digest.
  _boardAuthorityContext(principal) {
    return { sessionAuthority: principal.sessionAuthority ?? null };
  }

  // MCP-W3: per-call FRESH doctorReadiness, never open-time cached. The server may carry a
  // doctorReadiness hook (MP10 injects one); otherwise the application facade's own doctor/
  // doctorReadiness is consulted; a bare deployment derives the route readiness from its live
  // profiles. Secret-shaped values are stripped at the surface (codex #4: env-sourced and
  // file-sourced credential VALUES join the same redaction class).
  async _freshDoctorReadiness() {
    let readiness;
    if (typeof this.doctorReadiness === 'function') {
      readiness = await this.doctorReadiness();
    } else if (typeof this.application?.doctor === 'function') {
      readiness = await this.application.doctor();
    } else if (typeof this.application?.doctorReadiness === 'function') {
      readiness = this.application.doctorReadiness();
    } else {
      readiness = Object.freeze({ schemaVersion: 1, routes: [], workspace: Object.freeze({ state: 'ready' }) });
    }
    return this._sanitizeDoctorReadiness(readiness);
  }

  // Strips credential-shaped VALUES from the readiness projection (never the metadata fields —
  // source kind / expiry class ride; token material does not). Same discipline as the
  // SECRET_SHAPED_TEXT redactor in application.mjs, applied at the MCP surface.
  _sanitizeDoctorReadiness(value) {
    if (!record(value)) return value;
    const secretShaped = (child) => typeof child === 'string' && (
      /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}\b/u.test(child)
      || /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u.test(child)
      || /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|password|secret)\s*[:=]/iu.test(child)
    );
    const walk = (node) => {
      if (!record(node)) return node;
      return Object.fromEntries(Object.entries(node)
        .filter(([, child]) => !secretShaped(child))
        .map(([key, child]) => [key, walk(child)]));
    };
    return normalized(walk(value));
  }

  _readContextPackage(packageDigest) {
    const pkg = this.coordination.contextPackage(packageDigest);
    if (!pkg) throw Object.assign(new Error('context package is unavailable'), { code: 'context_package_not_found' });
    return pkg;
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
  try {
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
  } finally {
    await server.close();
  }
}


// CS-1/CS-2: executable MCP profile inventories (never regex extraction alone).
export function mcpApplicationToolNames() {
  return ORDINARY_APPLICATION_TOOL_DEFINITIONS.map((tool) => tool.name).sort();
}
export function mcpAdvancedToolNames() {
  return ADVANCED_TOOL_DEFINITIONS.map((tool) => tool.name).sort();
}
export function mcpCombinedToolNames() {
  return TOOL_DEFINITIONS.map((tool) => tool.name).sort();
}
export function mcpDispatchToolNames() {
  return [...Object.keys(APPLICATION_TOOL)].sort();
}
