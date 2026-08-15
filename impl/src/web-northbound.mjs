import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { FRAME_LIMITS } from './limits.mjs';
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
import { APPLICATION_SEMANTIC_REGISTRY, applicationOperationAliasMap, canonicalAndTransportNames } from './application-semantics.mjs';

// Issue #233 (canonical naming unification): every web-flagged application definition is
// admitted under BOTH spellings, derived through the ONE canonicalAndTransportNames seam — the
// canonical dot-name (the definition key, the durable identity the wire card already
// advertises) beside its derived underscore transport. Both spellings route to the SAME
// definition, so capability, argument, reconcilability, and read-only class derivation below
// admit the pair identically; the caller's chosen spelling stays the admitted identity
// (M4B-1 — the scope key records envelope.command verbatim, never resolved away).
const WEB_APPLICATION_ENTRIES = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.web)
  .flatMap(([name, definition]) => {
    const { canonical, web } = canonicalAndTransportNames(name);
    return [[web, name, definition], [canonical, name, definition]];
  });
// docs/36 §9 M4 (M4b — the transport flip) — the canonical grammar transport names admitted beside
// the retained legacy names. Each canonical transport is a first-class admitted command that maps
// to the SAME application command as its legacy sibling (the registry alias map), so both spellings
// reach one operation. Because the durable admission scope key records `envelope.command` verbatim
// (never resolved away), the caller's chosen spelling is the admitted identity (M4B-1); the legacy
// transports stay byte-identical, so a reconcilable envelope parked pre-flip under a legacy name
// keeps matching its stored scope key and reconciles across the boundary (M4B-2, R-KM-8).
const CANONICAL_WEB_ENTRIES = Object.entries(applicationOperationAliasMap())
  .filter(([, legacy]) => Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, legacy)
    && APPLICATION_COMMAND_DEFINITIONS[legacy].web)
  .map(([canonical, legacy]) => [canonical.replaceAll('.', '_'), legacy, APPLICATION_COMMAND_DEFINITIONS[legacy]]);

// D1 (wave-observability-2026-08-06/contract.md §D1): the wave lane's web reflex slice — the
// web-surface analogue of the MCP reflex table (mcp-northbound.mjs:97-100). The five wave verbs
// stay direct ports (the byte-stable command-table key set pinned by grammar-m3-red must not
// change), so they are admitted WITHOUT touching APPLICATION_COMMAND_DEFINITIONS. Each entry is
// [transport, dot-spelled name, capability classes]; the third element is the capability array
// directly (not a definition object), so COMMAND_CAPABILITY/APPLICATION_COMMAND spreads read it
// like the entry-set spreads below. Per-verb capability classes are pinned in the contract.
const WAVE_WEB_ENTRIES = Object.freeze([
  ['waves_start', 'waves.start', Object.freeze(['control', 'observe'])],
  ['waves_progress', 'waves.progress', Object.freeze(['observe'])],
  ['waves_send', 'waves.send', Object.freeze(['control', 'observe'])],
  ['waves_stop', 'waves.stop', Object.freeze(['emergency_stop', 'observe'])],
  ['waves_list', 'waves.list', Object.freeze(['observe'])],
  // #153 repair (dogfood launch, 2026-08-13): the #114 interpreter verb rides the
  // same direct-port admission — runWorkflow's own closed validation (spec|specPath,
  // workflow_* refusals) is the argument authority, exactly like the five sibling verbs.
  ['waves_run', 'waves.run', Object.freeze(['control', 'observe'])],
  ['waves_compile', 'waves.compile', Object.freeze(['observe'])],
  // #158 (scratchpad-write-2026-08-13/contract-fold.md H2.1): the folded scratchpad WRITE direct
  // port. WEB_DIRECT_PORT_COMMANDS is derived from THIS array, so validateEnvelope skips
  // validateApplicationCommandArgs and the append's own closed normalizer (the kernel fold,
  // coordination-store.mjs appendScratchpad) is the argument authority — the same direct-port
  // admission the five wave verbs ride. Capability classes match the MCP capability map.
  ['run_scratchpad_append', 'run.scratchpad.append', Object.freeze(['control', 'observe'])],
]);
// D1.2/D1.3 — the wave transports are DIRECT PORTS: validateEnvelope skips
// validateApplicationCommandArgs for them (WEB_DIRECT_PORT_COMMANDS below) and their argument
// authority is the port's own closed normalizer (_normalizeWaveStart/_normalizeWaveProgress/
// _normalizeWaveMemberAction, application.mjs:11692-11774) which the dispatch already runs.
// ARG_FIELDS per transport is that closed accepted-field set; waves_stop → {reason, runId} is the
// pinned narrowing (F2) — the web surface never admits the send-lane fields on the stop lane.
const WAVE_ARG_FIELDS = Object.freeze({
  waves_start: new Set(['idempotencyKey', 'members']),
  waves_progress: new Set(['cursor', 'waveId']),
  waves_send: new Set(['claimGrant', 'delivery', 'message', 'runId']),
  waves_stop: new Set(['reason', 'runId']),
  waves_list: new Set(['cursor', 'waveId']),
  // #232: detach (boolean, default true) is admitted on the run lane so the synchronous settle
  // path — the seven-key receipt carrying each member's typed startError — is client-reachable.
  waves_run: new Set(['detach', 'idempotencyKey', 'spec', 'specPath', 'specDsl']),
  waves_compile: new Set(['idempotencyKey', 'spec', 'specPath', 'specDsl']),
});
// Issue #233: each pinned direct-port row admits BOTH spellings — the row's canonical dot-name
// beside its byte-stable underscore transport (the pinned key set above is untouched; the dot
// rows are additions beside it, the same alias pattern CANONICAL_WEB_ENTRIES demonstrates).
// ARG_FIELDS follow the rows: the dot spelling accepts exactly its transport's closed set.
const WAVE_DOT_WEB_ENTRIES = Object.freeze(WAVE_WEB_ENTRIES
  .map(([transport, name, capabilities]) => [name, name, capabilities]));
const WAVE_DOT_ARG_FIELDS = Object.freeze(Object.fromEntries(
  WAVE_WEB_ENTRIES.map(([transport, name]) => [name, WAVE_ARG_FIELDS[transport]]),
));
// Issue #233: deployment.doctor on the web lane — the measured surface split (MCP admitted it
// as baton_deployment_doctor; the web wire 404'd). Both spellings derive through the ONE seam
// and ride the direct-port admission: the application dispatch layer already routes
// command('deployment.doctor') to the fresh readiness read (application.mjs), and the port's
// argument authority is the closed empty set — the envelope's top-level repoId is the
// deployment scope, exactly as the MCP tool's repoId argument is transport-bound there.
const DEPLOYMENT_WEB_ENTRIES = Object.freeze(
  [canonicalAndTransportNames('deployment.doctor').web, canonicalAndTransportNames('deployment.doctor').canonical]
    .map((transport) => [transport, 'deployment.doctor', Object.freeze(['observe'])]),
);
const DEPLOYMENT_ARG_FIELDS = Object.freeze(Object.fromEntries(
  DEPLOYMENT_WEB_ENTRIES.map(([transport]) => [transport, new Set()]),
));
const WEB_DIRECT_PORT_COMMANDS = new Set([
  ...WAVE_WEB_ENTRIES.flatMap(([transport, name]) => [transport, name]),
  ...DEPLOYMENT_WEB_ENTRIES.map(([transport]) => transport),
]);

// S-1 v2 R-WG-3: advertised web ARG_FIELDS exclude transportHidden fields; the validator still
// accepts them (acceptance set = advertised ∪ transportHidden).
function transportHiddenFor(commandName) {
  const definition = APPLICATION_COMMAND_DEFINITIONS[commandName];
  const fromDefinition = definition?.transportHidden ? [...definition.transportHidden] : [];
  const fromRegistry = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => {
      if (operation.key === commandName) return true;
      // run.view owns the run.inspect side-channel.
      if (commandName === 'run.inspect' && operation.key === 'run.view') return true;
      return false;
    })
    .flatMap((operation) => operation.transportHidden ?? []);
  return new Set([...fromDefinition, ...fromRegistry]);
}
function advertisedArgs(definition, commandName) {
  const hidden = transportHiddenFor(commandName);
  return new Set((definition.args ?? []).filter((field) => !hidden.has(field)));
}
function acceptedArgs(definition, commandName) {
  return new Set([...(definition.args ?? []), ...transportHiddenFor(commandName)]);
}

const COMMAND_CAPABILITY = Object.freeze({
  spawn: 'control', scratch_oracle: 'control', send: 'control', interrupt: 'control', kill: 'emergency_stop', drain: 'emergency_stop', respond: 'approve',
  list: 'observe', result: 'observe', wait: 'observe', capabilities: 'observe', provider_status: 'observe', capability_invoke: 'control', reuse_decide: 'control', reuse_recheck: 'control',
  goal_define: 'goal:define', plan_propose: 'plan:propose', plan_approve: 'plan:approve', goal_plan_status: 'goal:observe',
  // #158 (H2.1): the scratchpad WRITE direct port's capability classes (matches the MCP capability map).
  run_scratchpad_append: ['control', 'observe'],
  ...Object.fromEntries(WEB_APPLICATION_ENTRIES.map(([transport, , definition]) => [transport, definition.capabilities])),
  ...Object.fromEntries(CANONICAL_WEB_ENTRIES.map(([transport, , definition]) => [transport, definition.capabilities])),
  ...Object.fromEntries(WAVE_WEB_ENTRIES.map(([transport, , capabilities]) => [transport, capabilities])),
  ...Object.fromEntries(WAVE_DOT_WEB_ENTRIES.map(([transport, , capabilities]) => [transport, capabilities])),
  ...Object.fromEntries(DEPLOYMENT_WEB_ENTRIES.map(([transport, , capabilities]) => [transport, capabilities])),
});
const FENCE_REQUIRED = new Set(['send', 'interrupt', 'kill']);
const RECONCILABLE = new Set(['goal_define', 'plan_propose', 'plan_approve',
  ...[...WEB_APPLICATION_ENTRIES, ...CANONICAL_WEB_ENTRIES]
    .filter(([, , definition]) => definition.reconcilable).map(([transport]) => transport)]);
const GOAL_PLAN_MUTATIONS = new Set(['goal_define', 'plan_propose', 'plan_approve']);
const READ_ONLY_COMMANDS = new Set([
  'list', 'result', 'wait', 'capabilities', 'provider_status', 'goal_plan_status',
  ...[...WEB_APPLICATION_ENTRIES, ...CANONICAL_WEB_ENTRIES]
    .filter(([, , definition]) => definition.mcpStateful === false)
    .map(([transport]) => transport),
]);
const BOUNDED_OBSERVATION_AUDITS = new Set([
  'command_replayed', 'action_authority_read', 'operator_read_authorized',
]);
const TOP_LEVEL = new Set(['schemaVersion', 'commandId', 'idempotencyKey', 'command', 'args', 'repoId', 'runId', 'expectedFence', 'origin', 'clientObservedCursor']);
// Advertised schema (ARG_FIELDS) excludes transportHidden. Acceptance during validateEnvelope
// uses ARG_FIELDS ∪ transportHidden (see acceptedWebArgFields below).
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
  // #158 (H2.1): the closed {runId, scope, kind, body, idempotencyKey} accepted set — the D2.1
  // verb closure, exactly the fields the folded append verb admits on every surface.
  run_scratchpad_append: new Set(['runId', 'scope', 'kind', 'body', 'idempotencyKey']),
  ...Object.fromEntries(WEB_APPLICATION_ENTRIES.map(([transport, name, definition]) => [
    transport, advertisedArgs(definition, name),
  ])),
  ...Object.fromEntries(CANONICAL_WEB_ENTRIES.map(([transport, name, definition]) => [
    transport, advertisedArgs(definition, name),
  ])),
  ...Object.fromEntries(Object.entries(WAVE_ARG_FIELDS)),
  ...Object.fromEntries(Object.entries(WAVE_DOT_ARG_FIELDS)),
  ...Object.fromEntries(Object.entries(DEPLOYMENT_ARG_FIELDS)),
});
const ACCEPTED_ARG_FIELDS = Object.freeze({
  ...Object.fromEntries(Object.entries(ARG_FIELDS).map(([transport, fields]) => [transport, fields])),
  ...Object.fromEntries(WEB_APPLICATION_ENTRIES.map(([transport, name, definition]) => [
    transport, acceptedArgs(definition, name),
  ])),
  ...Object.fromEntries(CANONICAL_WEB_ENTRIES.map(([transport, name, definition]) => [
    transport, acceptedArgs(definition, name),
  ])),
});
const APPLICATION_COMMAND = Object.freeze({
  ...Object.fromEntries(
    [...WEB_APPLICATION_ENTRIES, ...CANONICAL_WEB_ENTRIES, ...WAVE_WEB_ENTRIES].map(([transport, name]) => [transport, name]),
  ),
  // #158 (H2.1): the scratchpad WRITE direct port routes to the folded application verb. The
  // WAVE_WEB_ENTRIES spread above already derives it; the literal pins the routing beside the table.
  run_scratchpad_append: 'run.scratchpad.append',
});
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization)$/i;
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const VERIFICATION_FIELDS = new Set(['command', 'expectExit', 'timeoutMs', 'coverageCommand', 'mutationCommand']);
const BUDGET_FIELDS = new Set(['tokens', 'usd', 'wallMin']);
const GOAL_PLAN_BUDGET_FIELDS = new Set(['tokens', 'usd', 'wallMin', 'providerTurns']);
const GOAL_REF_FIELDS = new Set(['goalId', 'version', 'digest']);
const PLAN_REF_FIELDS = new Set(['planId', 'version', 'digest']);
const PLAN_NODE_FIELDS = new Set(['key', 'objective', 'definitionOfDone', 'deps', 'pathScope', 'risk', 'budget', 'verification', 'routes', 'capabilities', 'effects']);
const PLAN_ROUTE_FIELDS_V2 = new Set(['schemaVersion', 'allowed']);
const PLAN_ROUTE_TUPLE_FIELDS = new Set(['harness', 'model', 'effort']);
const LEGACY_PLAN_ROUTE_FIELDS = new Set(['harnesses', 'models', 'efforts']);
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
function error(status, code, message = code, field = null) { return result(status, { ok: false, error: { code, message, ...(field == null ? {} : { field }) } }); }
function dispatchFailure(cause) {
  const goalPlanCode = cause?.code;
  if (typeof goalPlanCode === 'string' && goalPlanCode.startsWith('worker_policy_')) {
    const invalid = ['worker_policy_invalid', 'worker_policy_observation_invalid'].includes(goalPlanCode);
    return { httpStatus: invalid ? 400 : 409, body: { ok: false, error: {
      code: goalPlanCode, message: invalid ? 'worker policy precondition failed' : 'worker policy unavailable or conflicted',
    } } };
  }
  if ((typeof goalPlanCode === 'string' && goalPlanCode.startsWith('run_orchestrator_'))
    || goalPlanCode === 'run_stopping') {
    return { httpStatus: 409, body: { ok: false, error: {
      code: goalPlanCode, message: 'recursive Run authority is no longer active',
    } } };
  }
  if (goalPlanCode === 'application_unauthorized') return { httpStatus: 403, body: { ok: false, error: { code: goalPlanCode, message: 'application command forbidden' } } };
  if (goalPlanCode === 'application_unavailable') return { httpStatus: 503, body: { ok: false, error: { code: goalPlanCode, message: 'run application unavailable' } } };
  if (['application_run_lookup_oversize', 'application_run_view_oversize'].includes(goalPlanCode)) return { httpStatus: 503, body: { ok: false, error: { code: 'temporarily_unavailable', message: 'run application projection unavailable' } } };
  // A missing profile is deployment configuration the authenticated caller can read and fix;
  // naming it is not an enumeration surface the way run/worker identifiers are (issue #41).
  if (goalPlanCode === 'application_profile_not_found') return { httpStatus: 404, body: { ok: false, error: { code: goalPlanCode, message: 'requested Run profile is not defined by this deployment' } } };
  if (['application_run_not_found', 'application_interaction_not_found', 'application_worker_not_found'].includes(goalPlanCode)) return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'application resource not found' } } };
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
    'plan_too_large', 'plan_verification_invalid', 'plan_dispatch_invalid', 'plan_route_invalid',
    'plan_route_authority_legacy_ambiguous'].includes(goalPlanCode)) {
    return { httpStatus: 400, body: { ok: false, error: { code: goalPlanCode, message: 'goal/plan precondition failed' } } };
  }
  if (['goal_conflict', 'goal_predecessor_required', 'goal_stale', 'goal_version_limit', 'goal_weakened',
    'plan_approval_conflict', 'plan_approval_expired', 'plan_approval_stale', 'plan_brief_mismatch', 'plan_conflict',
    'plan_dependency_incomplete', 'plan_dependency_mismatch', 'plan_dispatch_conflict', 'plan_dispatch_stale',
    'plan_effect_mismatch', 'plan_not_approved', 'plan_predecessor_required', 'plan_route_mismatch', 'plan_self_approval',
    'plan_stale', 'plan_version_limit', 'goal_plan_required'].includes(goalPlanCode)) {
    return { httpStatus: 409, body: { ok: false, error: { code: goalPlanCode, message: 'goal/plan state conflict' } } };
  }
  // #160 R3 (the #170 P10 dependency): the pre-TypeError workflow_* arm — a bare workflow_* throw
  // preserves its typed code + the {line, field, expected} detail instead of degrading to
  // invalid_command at the TypeError-name arm below.
  if (typeof cause?.code === 'string' && cause.code.startsWith('workflow_')) {
    return { httpStatus: 400, body: { ok: false, error: {
      code: cause.code,
      message: cause?.message ?? 'workflow precondition failed',
      ...(cause?.detail ? { detail: cause.detail } : {}),
    } } };
  }
  // #160 R3 (error-actionability-2026-08-13/contract-fold.md §2 D4 R3 / OQ2): the coaching arm —
  // a byte-lane refusal (spill_body_exceeded, decision_text_exceeded, ...) carries its typed code
  // + the {field (lane), cap, actual, unit, gracefulPath} triple instead of degrading to the 503
  // fallback. 413 for pure size refusals (OQ2; W4 accepts 400/413). Keyed off cause.code, never
  // cause.name (an untyped TypeError still hits the name arm below and stays invalid_command).
  if (COACHING_REFUSAL_CODES.has(cause?.code)) {
    const field = coachingWireField(cause);
    return { httpStatus: 413, body: { ok: false, error: {
      code: cause.code,
      message: cause?.message ?? 'size limit exceeded',
      ...(field == null ? {} : { field }),
      cap: cause?.cap,
      actual: cause?.actual,
      unit: cause?.unit ?? 'bytes',
      gracefulPath: cause?.gracefulPath ?? null,
    } } };
  }
  if (['ModelSelectionError', 'SessionSelectionError', 'DuplicateTaskIdError', 'UnknownVendorError', 'DependencyCycleError', 'TypeError'].includes(cause?.name)) {
    return { httpStatus: 400, body: { ok: false, error: { code: 'invalid_command', message: 'command precondition failed' } } };
  }
  // #105 D3 (reply-chains-2026-08-06): the message lane's budget refusal maps to the same
  // "command precondition failed" class as the capability_*_invalid family — a declared budget
  // outside [1, MAX_MESSAGE_DEPTH_BUDGET] is a send-side precondition violation (400).
  if (cause?.code === 'message_budget_invalid') return { httpStatus: 400, body: { ok: false, error: { code: 'invalid_command', message: 'command precondition failed' } } };
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
  if (['worktree_capacity_exceeded', 'worktree_capacity_unavailable'].includes(cause?.code)) return { httpStatus: 503, body: { ok: false, error: { code: cause.code, message: 'workspace capacity refused this dispatch; free repository volume space or raise the deployment capacity floors, then retry' } } };
  // D5 (wave-observability-2026-08-06/contract.md §D5.1/§D5.2): the wave lane's typed refusals
  // carry the lane's OWN message byte-identically (W6/F4) plus the {actual, cap, cause, role}
  // payload — never the fixed mapping strings below, so the web surface mirrors the direct port.
  if (goalPlanCode === 'wave_member_invalid') return { httpStatus: 409, body: { ok: false, error: {
    code: goalPlanCode, message: typeof cause?.message === 'string' ? cause.message : 'wave member admission refused',
    ...(cause?.detail != null ? { detail: cause.detail } : {}),
  } } };
  if (goalPlanCode === 'wave_not_found') return { httpStatus: 404, body: { ok: false, error: {
    code: goalPlanCode, message: typeof cause?.message === 'string' ? cause.message : 'wave not found',
    ...(cause?.detail != null ? { detail: cause.detail } : {}),
  } } };
  return { httpStatus: 503, body: { ok: false, error: { code: 'temporarily_unavailable', message: 'command dispatch failed' } } };
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function containsForbiddenKey(value) {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(child));
}
function string(value) { return typeof value === 'string' && value.length > 0; }
// #160 R4 (error-actionability-2026-08-13/contract-fold.md §2 D4 R4): the offending key is named
// in `field` ONLY when it is a safe bounded identifier (the #41 posture — naming the KEY, never
// the VALUE; and never echoing a client-supplied 60KB marker back at the caller). The regex is
// the same identifier pattern the envelope itself requires (web-northbound.mjs:414-415), so a
// field name that passed admission is always safe to name on a refusal.
function safeFieldName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : null;
}
// #160 R4 (W3): the offending ARG key for an application-command validator refusal — the first
// required arg the caller omitted, or the first extra arg outside the closed schema. Named only
// when safe (an identifier, never content).
function applicationArgField(appCommand, args) {
  const definition = APPLICATION_COMMAND_DEFINITIONS[appCommand];
  if (!definition || !Array.isArray(definition.args)) return null;
  const present = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  for (const key of definition.args) {
    if (!Object.hasOwn(present, key)) return safeFieldName(key);
  }
  const allowed = new Set(definition.args);
  const extra = Object.keys(present).find((key) => !allowed.has(key));
  return extra ? safeFieldName(extra) : null;
}
// The coaching size family (contract §3): every cataloged byte-lane refusalCode from limits.mjs
// except the `workflow_*` lane (wave.run.spec_path carries refusalCode workflow_spec_invalid,
// which the workflow_* arm handles BEFORE this arm). Derived from the closed catalog so a new
// lane's refusalCode is automatically covered (additive-only).
const COACHING_REFUSAL_CODES = new Set(
  Object.values(FRAME_LIMITS)
    .map((row) => row?.refusalCode)
    .filter((code) => typeof code === 'string' && !code.startsWith('workflow_')),
);
// The wire `field` for each byte lane. The web arm reads the cause's `field` (the lane, when the
// throwing helper carries it) and maps it through this table; `run.objective` names the run_start
// envelope arg `objective` (W4), while `decision.text` keeps the compound lane name (W7-B). When
// the cause carries no lane, the code-level table supplies the default field.
const COACHING_LANE_FIELD = Object.freeze({
  'message.send.body': 'body',
  'message.reply.body': 'body',
  'run.objective': 'objective',
  'wave.member.objective': 'objective',
  'decision.question': 'question',
  'decision.need': 'need',
  'decision.rationale': 'rationale',
  'orientation.note': 'note',
  'steering.focus': 'focus',
  'board.title': 'title',
  'board.detail': 'detail',
  'board.report.body': 'body',
  'run.legacy_send.body': 'body',
  'decision.option.label': 'label',
  'decision.option.summary': 'summary',
  'decision.text': 'decision.text',
  'scratchpad.entry.body': 'body',
});
const COACHING_CODE_FIELD = Object.freeze({
  spill_body_exceeded: 'objective',
  decision_question_exceeded: 'question',
  decision_need_exceeded: 'need',
  decision_rationale_exceeded: 'rationale',
  orientation_note_exceeded: 'note',
  steering_focus_exceeded: 'focus',
  board_title_exceeded: 'title',
  board_detail_exceeded: 'detail',
  board_report_exceeded: 'body',
  run_legacy_send_exceeded: 'body',
  decision_option_label_exceeded: 'label',
  decision_option_summary_exceeded: 'summary',
  decision_text_exceeded: 'decision.text',
  scratchpad_entry_exceeded: 'body',
});
function coachingWireField(cause) {
  const lane = typeof cause?.field === 'string' ? cause.field : null;
  if (lane && COACHING_LANE_FIELD[lane]) return COACHING_LANE_FIELD[lane];
  return COACHING_CODE_FIELD[cause?.code] ?? null;
}
function exactRecord(value, fields) {
  return isRecord(value) && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}
function requiredEffectFields(fields, value) {
  return Object.hasOwn(value ?? {}, 'requiredEffects') ? new Set([...fields, 'requiredEffects']) : fields;
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
function planRoutes(value) {
  if (exactRecord(value, PLAN_ROUTE_FIELDS_V2)) {
    const identities = Array.isArray(value.allowed) ? value.allowed.map((route) => (
      exactRecord(route, PLAN_ROUTE_TUPLE_FIELDS)
        ? `${route.harness}\0${route.model}\0${route.effort}` : null
    )) : [];
    return value.schemaVersion === 2 && Array.isArray(value.allowed) && value.allowed.length > 0
      && value.allowed.every((route) => exactRecord(route, PLAN_ROUTE_TUPLE_FIELDS)
        && string(route.harness) && string(route.model) && string(route.effort))
      && identities.every((identity) => identity !== null)
      && new Set(identities).size === identities.length;
  }
  return exactRecord(value, LEGACY_PLAN_ROUTE_FIELDS)
    && stringList(value.harnesses) && value.harnesses.length === 1
    && stringList(value.models) && value.models.length === 1
    && stringList(value.efforts) && value.efforts.length === 1;
}
function planNode(value) {
  return exactRecord(value, requiredEffectFields(PLAN_NODE_FIELDS, value)) && string(value.key) && string(value.objective)
    && stringList(value.definitionOfDone) && stringList(value.deps) && stringList(value.pathScope)
    && string(value.risk) && goalPlanBudget(value.budget) && planVerification(value.verification)
    && value.pathScope.length > 0
    && planRoutes(value.routes)
    && stringList(value.capabilities) && stringList(value.effects)
    && (!Object.hasOwn(value, 'requiredEffects') || stringList(value.requiredEffects));
}
function planGate(value) {
  return exactRecord(value, requiredEffectFields(PLAN_GATE_FIELDS, value))
    && /^goal:[a-f0-9]{64}$/.test(value.goalId ?? '') && Number.isSafeInteger(value.goalVersion) && value.goalVersion > 0
    && /^[a-f0-9]{64}$/.test(value.goalDigest ?? '')
    && /^plan:[a-f0-9]{64}$/.test(value.planId ?? '') && Number.isSafeInteger(value.planVersion) && value.planVersion > 0
    && /^[a-f0-9]{64}$/.test(value.planDigest ?? '') && string(value.nodeKey)
    && value.expectedDispatchVersion === 0
    && stringList(value.capabilities) && stringList(value.effects)
    && (!Object.hasOwn(value, 'requiredEffects') || stringList(value.requiredEffects));
}
function planBrief(value) {
  return exactRecord(value, requiredEffectFields(PLAN_BRIEF_FIELDS, value)) && string(value.goal)
    && stringList(value.constraints) && stringList(value.pathScope) && stringList(value.tools)
    && typeof value.outputFormat === 'string' && typeof value.definitionOfDone === 'string'
    && planVerification(value.verification) && exactRecord(value.budget, BUDGET_FIELDS)
    && Number.isSafeInteger(value.budget.tokens) && value.budget.tokens > 0
    && Number.isFinite(value.budget.usd) && value.budget.usd >= 0
    && Number.isSafeInteger(value.budget.wallMin) && value.budget.wallMin > 0
    && Number.isSafeInteger(value.providerTurns) && value.providerTurns > 0
    && stringList(value.capabilities) && stringList(value.effects)
    && (!Object.hasOwn(value, 'requiredEffects') || stringList(value.requiredEffects));
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

function resolveWebCommandEnvelope(envelope) {
  // docs/36 §9 M3/M4 — the Episode fold. A `run_view` envelope carrying a chapter topic resolves to
  // the legacy Episode transport handler; without a topic `run_view` is admitted as a first-class
  // canonical transport (the ordinary inspect read). Every other canonical transport is likewise
  // first-class post-M4b (in COMMAND_CAPABILITY/APPLICATION_COMMAND above) and is NOT resolved away,
  // so the admitted scope key records the caller's spelling verbatim (M4B-1). run_episode itself
  // stays an admitted legacy transport until M5.
  if (envelope?.command === 'run_view'
    && isRecord(envelope.args) && Object.hasOwn(envelope.args, 'topic')) {
    return { ...envelope, command: 'run_episode' };
  }
  return envelope;
}

function validateEnvelope(envelope) {
  envelope = resolveWebCommandEnvelope(envelope);
  if (!isRecord(envelope)) return 'command envelope must be an object';
  const unknown = Object.keys(envelope).find((key) => !TOP_LEVEL.has(key));
  if (unknown) {
    // #160 R4: name the offending KEY in `field` (W1). The field is only named when it is a safe
    // bounded identifier — a 60KB client-supplied marker is never echoed (phase12 :516-532 pins).
    const field = safeFieldName(unknown);
    return field ? { code: 'unknown_top_level_field', field, message: 'unknown_top_level_field' } : 'unknown_top_level_field';
  }
  if (envelope.schemaVersion !== 1) return 'unsupported schemaVersion';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.commandId ?? '')
    || !/^[A-Za-z0-9._:-]{1,256}$/.test(envelope.idempotencyKey ?? '')
    || !string(envelope.command) || !string(envelope.repoId) || !string(envelope.origin)) return 'command identity, idempotencyKey, repoId, and origin are required';
  if (!Object.hasOwn(COMMAND_CAPABILITY, envelope.command)) return 'unsupported command';
  if (Object.hasOwn(envelope, 'runId') && !/^[A-Za-z0-9._:-]{1,256}$/.test(envelope.runId ?? '')) return 'invalid_run_id';
  if (!isRecord(envelope.args)) return 'args must be an object';
  // S-1 v2: acceptance = advertised ∪ transportHidden; advertised schema (ARG_FIELDS) excludes
  // declared-hidden fields so they do not appear in web-admitted argument inventories.
  const allowed = ACCEPTED_ARG_FIELDS[envelope.command] ?? ARG_FIELDS[envelope.command];
  const unknownArg = Object.keys(envelope.args).find((key) => !allowed.has(key));
  if (unknownArg) {
    // #160 R4: name the offending ARG key in `field` (W2); unsafe markers stay route-shape.
    const field = safeFieldName(unknownArg);
    return field ? { code: 'unknown_argument_field', field, message: 'unknown_argument_field' } : 'unknown_argument_field';
  }
  if (containsForbiddenKey(envelope.args)) return 'credential-bearing command fields are forbidden';
  if (APPLICATION_COMMAND[envelope.command] && !WEB_DIRECT_PORT_COMMANDS.has(envelope.command)) {
    try { validateApplicationCommandArgs(APPLICATION_COMMAND[envelope.command], envelope.args); }
    catch (cause) {
      // #160 R4 (contract-fold.md §2 D4 R4; W3/W8-2): a NAMED validator refusal — the application
      // validator throws applicationError with a typed code — passes through its code + message
      // instead of the anonymous application_command_arguments_invalid collapse. An untyped
      // route-shape ValidationError (no code) keeps the collapse (W8-1; phase12 :196/:510 pins).
      if (typeof cause?.code === 'string') {
        const field = applicationArgField(APPLICATION_COMMAND[envelope.command], envelope.args);
        return {
          code: cause.code,
          message: typeof cause?.message === 'string' ? cause.message : cause.code,
          ...(field == null ? {} : { field }),
        };
      }
      return 'application_command_arguments_invalid';
    }
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
      if (unknownPolicy) {
        // #160 R4: the unknown model-policy key is named in `field` when safe (phase12 :522 keeps
        // the marker case route-shape — the response must stay under 512 bytes, never echo it).
        const field = safeFieldName(unknownPolicy);
        return field ? { code: 'unknown_model_policy_field', field, message: 'unknown_model_policy_field' } : 'unknown_model_policy_field';
      }
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
        || Buffer.byteLength(envelope.args.note) > FRAME_LIMITS['orientation.note'].value || !Number.isSafeInteger(envelope.expectedFence)) return 'capability push requires exact orientation target, worker, note, args, and expectedFence';
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
    this.maxObservationCommands = opts.maxObservationCommands ?? 1_024;
    this.maxObservationAudits = opts.maxObservationAudits ?? 512;
    if (!Number.isSafeInteger(this.maxObservationCommands) || this.maxObservationCommands <= 0
      || !Number.isSafeInteger(this.maxObservationAudits) || this.maxObservationAudits <= 0) {
      throw new TypeError('Web observation bounds must be positive safe integers');
    }
    this._observationCommands = new Map();
    this._observationAudits = [];
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
    const entry = {
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialDigest: principal?.credentialId && this.edge ? this.edge.digest(`credential:${principal.credentialId}`) : null,
      originClass: ctx?.origin == null ? 'missing' : this.allowedOrigins.has(ctx.origin) ? 'allowed' : 'disallowed',
      remoteAddressClass: ctx?.remoteAddress ? 'present' : 'absent', addressDigest: ctx?.addressDigest ?? null, ...json(details),
    };
    if (BOUNDED_OBSERVATION_AUDITS.has(kind)) {
      this._observationAudits.push(Object.freeze({ ...entry, actor: auditActor }));
      if (this._observationAudits.length > this.maxObservationAudits) this._observationAudits.shift();
      return Object.freeze({ schemaVersion: 1, storage: 'bounded_memory' });
    }
    return this.coordination.recordWebAudit(entry, {
      actor: auditActor, key: `web.audit:${randomUUID()}`,
    });
  }

  _authenticate(ctx) {
    const principal = ctx?.principal;
    if (!principal || !string(principal.userId) || !string(principal.sessionId) || !string(principal.credentialId)) return error(401, 'unauthenticated');
    const expiresAt = Date.parse(principal.expiresAt);
    if (principal.revoked === true || !string(principal.expiresAt) || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return error(401, 'unauthenticated');
    // `local` is stamped only by createLocalAuthenticatedWebServer after accepting an
    // owner-permissioned Unix-domain-socket connection. It is not a caller header and never
    // represents cleartext TCP. Treat that OS-local boundary as a secure transport while keeping
    // every network path HTTPS-only.
    if (!['https', 'local'].includes(ctx.transport)) {
      return error(503, 'temporarily_unavailable', 'secure transport required');
    }
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
    // #160 R5 (error-actionability-2026-08-13/contract-fold.md §2 D4 R5): each distinct
    // precondition denial names ITS precondition class in `field` (origin | csrf | repoId |
    // capability) and the command class in `message`, so the four collapses are distinguishable
    // on the wire (W6). The `field` values are the closed F3 set the conformance shape-check pins.
    const commandClass = APPLICATION_COMMAND[envelope.command] ?? envelope.command;
    if (!this.allowedOrigins.has(ctx.origin) || envelope.origin !== ctx.origin) {
      return error(403, 'forbidden', `forbidden: ${commandClass} refused by the origin precondition`, 'origin');
    }
    if (principal.authMethod === 'cookie') {
      const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
        ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
        : ctx.csrfToken === principal.csrfToken);
      if (!csrfValid) return error(403, 'forbidden', `forbidden: ${commandClass} refused by the csrf precondition`, 'csrf');
    }
    if (!this.repoIds.has(envelope.repoId) || !Array.isArray(principal.repoIds) || !principal.repoIds.includes(envelope.repoId)) {
      return error(403, 'forbidden', `forbidden: ${commandClass} refused by the repoId precondition`, 'repoId');
    }
    if (this.isPrincipalActive && !this.isPrincipalActive(principal, { repoId: envelope.repoId })) return error(401, 'unauthenticated');
    const requiredCapabilities = Array.isArray(COMMAND_CAPABILITY[envelope.command])
      ? COMMAND_CAPABILITY[envelope.command]
      : [COMMAND_CAPABILITY[envelope.command]];
    if (!Array.isArray(principal.capabilities)
      || !requiredCapabilities.every((capability) => principal.capabilities.includes(capability))) {
      return error(403, 'forbidden', `forbidden: ${commandClass} refused by the capability precondition`, 'capability');
    }
    return null;
  }

  _postWaitAuthorization(ctx, envelope) {
    // Post-wait reauthorization applies by operation, so the canonical `run_watch` transport gets
    // it exactly like the legacy `run_follow` it resolves to (both dispatch run.follow).
    if (!['run.follow', 'run.wait'].includes(APPLICATION_COMMAND[envelope.command])) return null;
    return this._authenticate(ctx) ?? this._authorize(ctx, envelope);
  }

  _rememberObservation(scopeKey, entry) {
    if (!this._observationCommands.has(scopeKey)
      && this._observationCommands.size >= this.maxObservationCommands) {
      this._observationCommands.delete(this._observationCommands.keys().next().value);
    }
    this._observationCommands.set(scopeKey, entry);
  }

  async _authorizeObservationReplay(ctx, envelope, webActor) {
    if (!APPLICATION_COMMAND[envelope.command]) return null;
    try {
      await this.application.authorizeReplay(APPLICATION_COMMAND[envelope.command], envelope.args, {
        actor: webActor, principalId: ctx.principal.userId, sessionId: ctx.principal.sessionId,
      }, {
        transport: 'web', requestId: String(envelope.commandId),
        idempotencyKey: `web.observation:${envelope.commandId}`,
      });
      return null;
    } catch (cause) {
      const failure = dispatchFailure(cause);
      return result(failure.httpStatus, failure.body);
    }
  }

  async _executeObservation(ctx, envelope, webActor, scopeKey, requestDigest) {
    let observation = this._observationCommands.get(scopeKey) ?? null;
    const replay = observation !== null;
    if (observation && observation.requestDigest !== requestDigest) {
      try {
        this._audit('idempotency_refused', ctx, {
          command: envelope.command, repoId: envelope.repoId, reason: 'idempotency_conflict',
        });
      } catch { return error(503, 'temporarily_unavailable'); }
      return error(409, 'idempotency_conflict');
    }
    if (!observation) {
      const pending = Promise.resolve().then(() => this._dispatch(
        envelope, webActor, ctx.principal,
      ));
      observation = { requestDigest, pending, response: null };
      this._rememberObservation(scopeKey, observation);
      void pending.then(
        (response) => { observation.response = response; },
        () => { if (this._observationCommands.get(scopeKey) === observation) this._observationCommands.delete(scopeKey); },
      );
    } else if (observation.response !== null) {
      const replayFailure = await this._authorizeObservationReplay(ctx, envelope, webActor);
      if (replayFailure) return replayFailure;
    }
    let response;
    try { response = observation.response ?? await observation.pending; }
    catch (cause) {
      const failure = dispatchFailure(cause);
      return result(failure.httpStatus, failure.body);
    }
    const postAuthorizationFailure = this._postWaitAuthorization(ctx, envelope);
    if (postAuthorizationFailure) return postAuthorizationFailure;
    return replay ? { ...response, body: { ...response.body, replayed: true } } : response;
  }

  async execute(ctx, envelope) {
    envelope = resolveWebCommandEnvelope(envelope);
    if (!this._admissionOpen()) return error(503, 'temporarily_unavailable');
    const authFailure = this._authenticate(ctx);
    if (authFailure) {
      try { this._audit('authentication_refused', ctx); } catch { return error(503, 'temporarily_unavailable'); }
      return authFailure;
    }
    const validation = validateEnvelope(envelope);
    if (validation) {
      // #160 R4 (contract-fold.md §2 D4 R4): a structured validator refusal carries its typed
      // code + field and passes through at 400; a route-shape string keeps invalid_command (W8-1,
      // the phase12 :196/:465/:510/:554/:590 pins). The audit reason is always the code string —
      // never the offending key, so a client-supplied marker never leaks into the audit either.
      if (typeof validation === 'string') {
        try { this._audit('command_invalid', ctx, { reason: validation }); } catch { return error(503, 'temporarily_unavailable'); }
        return error(400, 'invalid_command', validation);
      }
      const { code, field, message } = validation;
      try { this._audit('command_invalid', ctx, { reason: code }); } catch { return error(503, 'temporarily_unavailable'); }
      return error(400, code, message, field);
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
    const webActor = actor(ctx.principal);
    const scopeKey = hash({ userId: ctx.principal.userId, command: envelope.command, repoId: envelope.repoId, idempotencyKey: envelope.idempotencyKey });
    const requestDigest = hash(canonicalRequest(envelope));
    let semanticAuthority = null;
    if (APPLICATION_COMMAND[envelope.command] === 'run.act') {
      const prior = this.coordination.webCommandByScope?.(scopeKey) ?? null;
      if (prior && prior.requestDigest !== requestDigest) {
        try { this._audit('idempotency_refused', ctx, { command: envelope.command, repoId: envelope.repoId, reason: 'idempotency_conflict' }); }
        catch { return error(503, 'temporarily_unavailable'); }
        return error(409, 'idempotency_conflict');
      }
      try {
        semanticAuthority = prior?.semanticAuthority ?? await this.application.actionAuthority(
          envelope.args,
          { actor: webActor, principalId: ctx.principal.userId, sessionId: ctx.principal.sessionId },
          {
            transport: 'web', requestId: String(envelope.commandId),
            idempotencyKey: `web.command:${envelope.commandId}`,
            capabilityAuthority: northboundCapabilityToken('web'),
            capabilities: [...ctx.principal.capabilities],
          },
        );
      } catch (cause) {
        const failure = dispatchFailure(cause);
        try { this._audit('authorization_refused', ctx, { command: envelope.command, repoId: envelope.repoId }); }
        catch { return error(503, 'temporarily_unavailable'); }
        return result(failure.httpStatus, failure.body);
      }
      if (!Array.isArray(semanticAuthority?.requiredCapabilities)
        || !semanticAuthority.requiredCapabilities.every(
          (capability) => ctx.principal.capabilities.includes(capability),
        )) {
        try { this._audit('authorization_refused', ctx, { command: envelope.command, repoId: envelope.repoId }); }
        catch { return error(503, 'temporarily_unavailable'); }
        return error(403, 'forbidden');
      }
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

    if (READ_ONLY_COMMANDS.has(envelope.command)) {
      return this._executeObservation(ctx, envelope, webActor, scopeKey, requestDigest);
    }

    let admission;
    try {
      admission = this.coordination.admitWebCommand({
        commandId: envelope.commandId, scopeKey, requestDigest, command: envelope.command,
        repoId: envelope.repoId, runId: admittedRunId(envelope),
        userId: ctx.principal.userId, sessionId: ctx.principal.sessionId, credentialId: ctx.principal.credentialId,
        origin: envelope.origin, expectedFence: envelope.expectedFence ?? null,
        ...(semanticAuthority ? { semanticAuthority } : {}),
      }, { actor: webActor, key: `web.admit:${scopeKey}` });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
    if (!admission.ok) {
      try { this._audit('idempotency_refused', ctx, { command: envelope.command, repoId: envelope.repoId, reason: admission.result }); } catch { return error(503, 'temporarily_unavailable'); }
      return error(409, admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_command');
    }
    if (APPLICATION_COMMAND[envelope.command] === 'run.act'
      && admission.command.semanticAuthority?.authorityDigest !== semanticAuthority?.authorityDigest) {
      try { this._audit('authorization_refused', ctx, { command: envelope.command, repoId: envelope.repoId }); }
      catch { return error(503, 'temporarily_unavailable'); }
      return error(409, 'application_action_authority_invalid');
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
        if (APPLICATION_COMMAND[envelope.command] === 'run.act'
          && admission.command.sessionId !== ctx.principal.sessionId) {
          return error(403, 'forbidden');
        }
        const commandId = admission.command.commandId;
        const admittedActor = actor({ userId: admission.command.userId, sessionId: admission.command.sessionId });
        const admittedPrincipal = { ...ctx.principal, userId: admission.command.userId, sessionId: admission.command.sessionId };
        const admittedEnvelope = commandId === envelope.commandId ? envelope : { ...envelope, commandId };
        let replayed;
        try {
          replayed = APPLICATION_COMMAND[envelope.command]
            ? await this._dispatchApplicationOnce(
              admittedEnvelope, admittedActor, commandId, admittedPrincipal,
              admission.command.semanticAuthority ?? null,
            )
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
          const lease = typeof this.coordination.activeRunOrchestratorLeaseForSession === 'function'
            ? this.coordination.activeRunOrchestratorLeaseForSession({
              repoId: envelope.repoId,
              principalId: ctx.principal.userId,
              sessionId: ctx.principal.sessionId,
              expiresAt: ctx.principal.expiresAt,
            }) : null;
          await this.application.authorizeReplay(APPLICATION_COMMAND[envelope.command], envelope.args, {
            actor: webActor, principalId: ctx.principal.userId, sessionId: ctx.principal.sessionId,
          }, {
            transport: 'web', requestId: String(envelope.commandId),
            idempotencyKey: `web.command:${envelope.commandId}`,
            capabilityAuthority: northboundCapabilityToken('web'),
            capabilities: [...ctx.principal.capabilities],
            ...(APPLICATION_COMMAND[envelope.command] === 'run.act' ? {
              semanticAuthority: admission.command.semanticAuthority,
            } : {}),
            ...(lease ? { sessionAuthority: {
              schemaVersion: 1,
              authorityDigest: lease.session.authorityDigest,
              expiresAt: lease.session.expiresAt,
              orchestratorLeaseId: lease.leaseId,
            } } : {}),
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
          ? await this._dispatchApplicationOnce(
            envelope, webActor, envelope.commandId, ctx.principal,
            admission.command.semanticAuthority ?? null,
          )
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

  _dispatchApplicationOnce(envelope, webActor, commandId, principal, semanticAuthority = null) {
    const existing = this._applicationDispatches.get(commandId);
    if (existing) return existing;
    const admittedEnvelope = commandId === envelope.commandId ? envelope : { ...envelope, commandId };
    const pending = Promise.resolve().then(
      () => this._dispatch(admittedEnvelope, webActor, principal, semanticAuthority),
    );
    this._applicationDispatches.set(commandId, pending);
    return pending;
  }

  async _dispatch(envelope, webActor, principal, semanticAuthority = null) {
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
      const lease = typeof this.coordination.activeRunOrchestratorLeaseForSession === 'function'
        ? this.coordination.activeRunOrchestratorLeaseForSession({
          repoId: envelope.repoId,
          principalId: principal.userId,
          sessionId: principal.sessionId,
          expiresAt: principal.expiresAt,
        }) : null;
      value = await this.application.command(APPLICATION_COMMAND[envelope.command], a, {
        actor: webActor,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, {
        transport: 'web', requestId: String(envelope.commandId),
        idempotencyKey: `web.command:${envelope.commandId}`,
        capabilityAuthority: northboundCapabilityToken('web'),
        capabilities: [...principal.capabilities],
        ...(APPLICATION_COMMAND[envelope.command] === 'run.act' ? {
          semanticAuthority,
        } : {}),
        ...(lease ? { sessionAuthority: {
          schemaVersion: 1,
          authorityDigest: lease.session.authorityDigest,
          expiresAt: lease.session.expiresAt,
          orchestratorLeaseId: lease.leaseId,
        } } : {}),
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
        taskId: a.taskId ?? `web-${envelope.commandId}`,
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
    if (req.method === 'OPTIONS' && (['/v1/commands', '/v1/stream-tickets', '/v1/action-authority'].includes(url.pathname) || AUTH_PATHS.has(url.pathname))) {
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
      const legacyScope = isRecord(body) && Object.keys(body).length === 1 && string(body.repoId);
      const runScope = isRecord(body)
        && Object.keys(body).every((key) => ['repoId', 'runId', 'channel', 'recipient', 'cursor'].includes(key))
        && string(body.repoId) && string(body.runId)
        && ['progress', 'events', 'output'].includes(body.channel)
        && (body.recipient === undefined || (string(body.recipient) && body.recipient.length <= 256))
        && (body.channel === 'output' || body.recipient === undefined)
        && (body.cursor === undefined || (body.channel === 'progress'
          ? Number.isSafeInteger(body.cursor) && body.cursor >= 0
          : typeof body.cursor === 'string' && body.cursor.length >= 1
            && body.cursor.length <= 4_096 && /^[A-Za-z0-9_-]+$/u.test(body.cursor)));
      if (!legacyScope && !runScope) return this._write(res, error(400, 'invalid_command'), origin);
      if (runScope && !this.application) return this._write(res, error(503, 'application_unavailable'), origin);
      let streamScope = body.repoId;
      if (runScope) streamScope = { ...body };
      if (typeof this.stream.authorizeIssue !== 'function') return this._write(res, error(503, 'temporarily_unavailable'), origin);
      if (!await this.stream.authorizeIssue(principal, origin, streamScope)) {
        try { this._audit('stream_ticket_refused', { principal, origin, addressDigest: req.edgeAddressDigest ?? null }, { reason: 'forbidden' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        return this._write(res, error(403, 'forbidden'), origin);
      }
      let ticketQuota = null;
      if (this.edge) {
        ticketQuota = this.edge.reserve('ticket', principal.credentialId);
        if (!ticketQuota.ok) {
          try { this._audit('quota_refused', { principal, origin, addressDigest: req.edgeAddressDigest ?? null }, { quota: 'ticket' }); }
          catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
          return this._write(res, error(429, 'rate_limited'), origin, { 'retry-after': String(ticketQuota.retryAfter) });
        }
      }
      if (runScope) {
        let snapshot;
        try {
          snapshot = await this.application.command('run.inspect', {
            runId: body.runId, depth: 'outline',
          }, {
            actor: actor(principal), principalId: principal.userId, sessionId: principal.sessionId,
          }, { transport: 'web-stream', requestId: randomUUID() });
        } catch (cause) {
          ticketQuota?.rollback();
          const failure = dispatchFailure(cause);
          return this._write(res, result(failure.httpStatus, failure.body), origin);
        }
        if (!snapshot || snapshot.runId !== body.runId || snapshot.depth !== 'outline'
          || !Number.isSafeInteger(snapshot.cursor) || !isRecord(snapshot.outline)) {
          ticketQuota?.rollback();
          return this._write(res, error(503, 'temporarily_unavailable'), origin);
        }
        streamScope = { ...body, snapshot };
      }
      if (this.edge) {
        let issuance;
        try {
          if (typeof this.stream.beginIssue !== 'function') throw new TypeError('transactional ticket issuance required');
          issuance = await this.stream.beginIssue(principal, origin, streamScope);
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
      return this._write(res, await this.stream.issue(principal, origin, streamScope), origin);
    }
    if (req.method === 'POST' && url.pathname === '/v1/action-authority') {
      if (url.search || req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return this._write(res, error(400, 'invalid_command'), origin);
      }
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      let body;
      try { body = await this._readBody(req); }
      catch { return this._write(res, error(400, 'invalid_command'), origin); }
      const ctx = {
        principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null,
        remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null),
        addressDigest: req.edgeAddressDigest ?? null,
        transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
      };
      const authFailure = this._authenticate(ctx);
      if (authFailure) return this._write(res, authFailure, origin);
      if (!isRecord(body)
        || Object.keys(body).sort().join(',') !== ['args', 'idempotencyKey', 'repoId', 'schemaVersion'].join(',')
        || body.schemaVersion !== 1) {
        return this._write(res, error(400, 'invalid_command'), origin);
      }
      const envelope = {
        schemaVersion: 1,
        commandId: 'action-authority-preflight',
        idempotencyKey: body.idempotencyKey,
        command: 'run_act',
        args: body.args,
        repoId: body.repoId,
        runId: body.args?.runId,
        origin,
      };
      if (validateEnvelope(envelope)
        || !Array.isArray(principal.capabilities) || !principal.capabilities.includes('observe')) {
        return this._write(res, error(403, 'forbidden'), origin);
      }
      const authorizationFailure = this._authorize(ctx, envelope);
      if (authorizationFailure) return this._write(res, authorizationFailure, origin);
      if (!this.application) return this._write(res, error(503, 'application_unavailable'), origin);
      const scopeKey = hash({
        userId: principal.userId, command: envelope.command,
        repoId: envelope.repoId, idempotencyKey: envelope.idempotencyKey,
      });
      const requestDigest = hash(canonicalRequest(envelope));
      const prior = this.coordination.webCommandByScope?.(scopeKey) ?? null;
      if (prior && prior.requestDigest !== requestDigest) {
        return this._write(res, error(409, 'idempotency_conflict'), origin);
      }
      let semanticAuthority;
      try {
        semanticAuthority = prior?.semanticAuthority ?? await this.application.actionAuthority(
          envelope.args,
          {
            actor: actor(principal), principalId: principal.userId,
            sessionId: principal.sessionId,
          },
          {
            transport: 'web', requestId: String(envelope.commandId),
            idempotencyKey: `web.command:${envelope.commandId}`,
            capabilityAuthority: northboundCapabilityToken('web'),
            capabilities: [...principal.capabilities],
          },
        );
      } catch (cause) {
        const failure = dispatchFailure(cause);
        return this._write(res, result(failure.httpStatus, failure.body), origin);
      }
      if (!Array.isArray(semanticAuthority?.requiredCapabilities)) {
        return this._write(res, error(409, 'application_action_authority_invalid'), origin);
      }
      try { this._audit('action_authority_read', ctx, { repoId: envelope.repoId }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, result(200, { ok: true, semanticAuthority }), origin);
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
      const authFailure = this._authenticate({ principal, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') });
      if (authFailure) return this._write(res, authFailure, origin);
      const responseValue = await this.stream.open({
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
        identity: {
          userId: principal.userId, sessionId: principal.sessionId,
          capabilities: [...principal.capabilities], repoIds: [...principal.repoIds],
        },
        expiresAt: principal.expiresAt,
      }));
    }
    if (pathname === '/v1/application-card') {
      if (!this.application) return this._write(res, error(503, 'application_unavailable', 'run application unavailable'));
      const card = this.application.card();
      // Epic #103 (D6c): the web card is the reading consumer's TRANSPORT — the CLI is a child
      // process that reads the doctor sibling by property access AFTER an HTTP JSON round-trip,
      // and non-enumerable properties do not survive JSON.stringify. So the route reads the
      // non-enumerable sibling itself and adds the ONE named additive field to the served shape.
      const readiness = card?.readiness && typeof card.readiness === 'object' && !Array.isArray(card.readiness)
        ? { ...card.readiness, briefing: card.readiness.briefing ?? null }
        : (card?.readiness ?? null);
      return this._write(res, result(200, {
        ok: true,
        // D1.4/F1 — the card advertises the admitted lane BY DERIVATION from the same transport
        // tables that admit the web verbs (the `([, name]) => name` map over the entry sets), so a
        // dishonest impl cannot special-case the card. The card lists the DOT-spelled names
        // (waves.start, ...) beside the existing WEB_APPLICATION_ENTRIES names — never the
        // underscore transports.
        application: { ...card, readiness, commands: [...WEB_APPLICATION_ENTRIES, ...WAVE_WEB_ENTRIES].map(([, name]) => name) },
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

/** Owner-local authenticated Web transport. The synthetic transport identity is assigned by the
 * server closure, never parsed from request headers. The caller must bind the returned server to
 * one owner-only Unix-domain socket; this factory deliberately exposes no TCP listen default. */
export function createLocalAuthenticatedWebServer(northbound) {
  if (!(northbound instanceof WebNorthbound)) throw new TypeError('WebNorthbound required');
  if (typeof northbound.authenticate !== 'function') throw new TypeError('an authenticator is required');
  if (!(northbound.readinessAuthority instanceof WebReadinessAuthority)
    || northbound.readinessAuthority.coordination !== northbound.coordination
    || northbound.readinessAuthority.sessions !== northbound.sessions
    || northbound.readinessAuthority.authenticate !== northbound.authenticate) {
    throw new TypeError('local web server requires a readiness authority bound to its coordination, session, and authentication authorities');
  }
  const server = createHttpServer((req, res) => {
    req.edgeIdentity = Object.freeze({ transport: 'local', address: 'owner-local-socket' });
    northbound.handle(req, res);
  });
  server.batonShutdown = (shutdownOpts = {}) => northbound.shutdown({ ...shutdownOpts, server });
  return server;
}

export { validateEnvelope as validateWebCommandEnvelope };
