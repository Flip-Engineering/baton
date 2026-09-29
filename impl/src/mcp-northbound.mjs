import { createHash, randomUUID } from 'node:crypto';
import { flipFace } from './brand.mjs';
import { FRAME_LIMITS, composeFrameLimitRefusal, frameLimitRefusalPath } from './limits.mjs';
import { northboundCapabilityToken } from './northbound-capability-authority.mjs';
import { sanitizeGoalPlanProjection } from './goal-plan.mjs';
import { APPLICATION_COMMAND_DEFINITIONS, validateApplicationCommandArgs } from './application.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY,
  SURFACING_MATRIX_KEYS,
  canonicalAndTransportNames,
  canonicalOperationForCommand,
  deriveSurfaceNames,
} from './application-semantics.mjs';
import { SWARM_MCP_TOOL_DEFINITIONS } from './swarm-surface.mjs';
import { EVIDENCE_SEARCH_INPUT_SCHEMA } from './evidence-search.mjs';
import { SERVICES_LIST_INPUT_SCHEMA } from './provider-services.mjs';

// Issue #233 (canonical naming unification): every mcp-flagged application definition is
// admitted under BOTH spellings, derived through the ONE canonicalAndTransportNames seam — the
// canonical dot-name (the definition key, the durable identity) beside its derived fleet_*
// transport. Both spellings map to the SAME application command, so capability, stateful,
// reconcilability, and argument validation derive identically for the pair.
const MCP_APPLICATION_ENTRIES = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  // The swarm family (docs/39) has no retained legacy transport: its tools are the ordinary
  // baton_swarm_* rows (swarmApplicationToolDefinitions) plus their canonical dot twins, so no
  // fleet_swarm_* twin is minted here — that spelling would exist only as an unadvertised alias.
  .filter(([name, definition]) => definition.mcp && !name.startsWith('swarm.')
    // evidence.search (#318) rides the ordinary baton_* transport like the swarm family — the
    // fleet_* twin would exist only as an unadvertised alias.
    && name !== 'evidence.search'
    // services.list (#317, docs/50): the same posture — the ordinary baton_services_list row is
    // the only flat spelling; a fleet_* twin would exist only as an unadvertised alias.
    && name !== 'services.list')
  .flatMap(([name, definition]) => {
    const { canonical, mcp } = canonicalAndTransportNames(name);
    return [[mcp, name, definition], [canonical, name, definition]];
  });
// docs/36 §9 M4 (M4b — the transport flip) — the canonical grammar tools rendered beside the
// retained legacy baton_* ordinary tools. Each pairs a §6 operation key with its legacy sibling
// tool and the application command both dispatch to: the canonical tool's NAME comes from the ONE
// shared deriveSurfaceNames, and it inherits the sibling's exact wire schema, annotations, and
// dispatch, so both spellings reach one operation (M4B-3). The fleet_* kernel and reflex tables
// are untouched.
const CANONICAL_ORDINARY_SIBLINGS = Object.freeze([
  ['run.view', 'baton_run_inspect', 'run.inspect'],
  ['run.member.view', 'baton_run_workstreams', 'run.workstreams'],
  ['application.help', 'baton_help', 'application.help'],
].map(([key, legacyTool, command]) => Object.freeze({
  key, legacyTool, command, tool: deriveSurfaceNames(key).mcp,
})));
// The retained legacy ordinary tools, as [tool, command] rows — the dot-name twins below derive
// from these rows through the ONE seam, never a second hand-kept list.
const LEGACY_ORDINARY_APPLICATION_ROWS = Object.freeze([
  ['baton_help', 'application.help'],
  ['baton_runs', 'runs.list'],
  ['baton_run_start', 'run.start'],
  ['baton_run_inspect', 'run.inspect'],
  ['baton_run_episode', 'run.episode'],
  ['baton_run_workstreams', 'run.workstreams'],
  ['baton_run_stop', 'run.stop'],
  ['baton_run_send', 'run.send'],
  ['baton_run_interrupt', 'run.interrupt'],
  ['baton_run_select', 'run.select'],
]);
// ── D1 step 2 (issue #156): the pre-spread gap snapshot and the lifecycle sibling table ────────
//
// The bus side of the parity law: the same admission map the web bus derives from. The sibling
// table is DERIVED from the two admission maps at module load, never a hand list (the #159
// doctrine): uncoveredCommands() snapshots the hand-rows-only served set BEFORE the LIFECYCLE
// spread, so the snapshot is exactly the contract's §3 closed literal — the 14 run-lifecycle ops
// (the evidence.search/services.list ordinary rows join the served set here, beside their baton_*
// tool rows below; the swarm family rides its own entries) — and the siblings are created by
// .map over that snapshot.
const LIFECYCLE_WEB_COMMANDS = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.web)
  .map(([name]) => name);
const PRE_SPREAD_ORDINARY_ENTRIES = Object.freeze([
  ...LEGACY_ORDINARY_APPLICATION_ROWS.map(([tool, command]) => [
    tool, command, APPLICATION_COMMAND_DEFINITIONS[command],
  ]),
  ['baton_evidence_search', 'evidence.search', APPLICATION_COMMAND_DEFINITIONS['evidence.search']],
  ['baton_services_list', 'services.list', APPLICATION_COMMAND_DEFINITIONS['services.list']],
  ...CANONICAL_ORDINARY_SIBLINGS.map((sibling) => (
    [sibling.tool, sibling.command, APPLICATION_COMMAND_DEFINITIONS[sibling.command]]
  )),
  ...SWARM_MCP_TOOL_DEFINITIONS.flatMap((tool) => [
    [tool.name, tool.command, APPLICATION_COMMAND_DEFINITIONS[tool.command]],
    [tool.command, tool.command, APPLICATION_COMMAND_DEFINITIONS[tool.command]],
  ]),
]);
const PRE_SPREAD_SERVED_COMMANDS = new Set(PRE_SPREAD_ORDINARY_ENTRIES.map(([, command]) => command));
export function uncoveredCommands() {
  return LIFECYCLE_WEB_COMMANDS.filter((command) => !PRE_SPREAD_SERVED_COMMANDS.has(command));
}
const LIFECYCLE_ORDINARY_SIBLINGS = Object.freeze(uncoveredCommands().map((command) => Object.freeze({
  key: command,
  tool: deriveSurfaceNames(command).mcp,
  source: `fleet_${command.replaceAll('.', '_')}`,
})));
export const APPLICATION_TOOL = Object.freeze(Object.fromEntries(
  [...MCP_APPLICATION_ENTRIES,
    ['baton_help', 'application.help'],
    ['baton_runs', 'runs.list'],
    ['baton_run_start', 'run.start'],
    ['baton_run_inspect', 'run.inspect'],
    ['baton_run_episode', 'run.episode'],
    ['baton_run_workstreams', 'run.workstreams'],
    ['baton_run_stop', 'run.stop'],
    ['baton_run_send', 'run.send'],
    ['baton_run_interrupt', 'run.interrupt'],
    ['baton_run_select', 'run.select'],
    ['baton_evidence_search', 'evidence.search'],
    ['evidence.search', 'evidence.search'],
    ['baton_services_list', 'services.list'],
    ['services.list', 'services.list'],
    ...CANONICAL_ORDINARY_SIBLINGS.map((sibling) => [sibling.tool, sibling.command]),
    ...SWARM_MCP_TOOL_DEFINITIONS.flatMap((tool) => [[tool.name, tool.command], [tool.command, tool.command]]),
  ].map(([tool, name]) => [tool, name]),
));
const ORDINARY_APPLICATION_ENTRIES = Object.freeze([
  // The hand-rows-only served set (the pre-spread snapshot's source, above) …
  ...PRE_SPREAD_ORDINARY_ENTRIES,
]);

export const SURFACING_MATRIX_MCP_ROWS = Object.freeze(
  APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.filter((operation) => (
    SURFACING_MATRIX_KEYS.includes(operation.key) && operation.surfaces.includes('mcp')
  )),
);

const PROTOCOL_VERSION = '2025-11-25';
const CAPABILITY = Object.freeze({
  fleet_spawn: 'control', fleet_send: 'control', fleet_wait: 'observe', fleet_respond: 'approve',
  fleet_interrupt: 'control', fleet_result: 'observe', fleet_list: 'observe', fleet_capabilities: 'observe',
  fleet_provider_status: 'observe',
  fleet_goal_define: 'goal:define', fleet_plan_propose: 'plan:propose', fleet_plan_approve: 'plan:approve', fleet_goal_plan_status: 'goal:observe',
  fleet_capability_invoke: 'control', fleet_kill: 'emergency_stop', fleet_drain: 'emergency_stop',
  ...Object.fromEntries(MCP_APPLICATION_ENTRIES.map(([tool, , definition]) => [tool, definition.capabilities])),
  ...Object.fromEntries(ORDINARY_APPLICATION_ENTRIES.map(([tool, , definition]) => [tool, definition.capabilities])),
  // Reflex surface contract Part A (docs/reference/evidence/mcp-reflex-live-2026-07-22/
  // mcp-reflex-surface-decisions.md, table): reflex tools are in NEITHER derivation set above —
  // every reflex tool MUST be registered explicitly here, or `_authority` computes
  // `[undefined]` and refuses with `forbidden`.
  // Issue #338: the deployment evidence search is advertised from its own tool table (evidence.search
  // is deliberately excluded from MCP_APPLICATION_ENTRIES above, so no derived row reaches it) —
  // register BOTH its spellings from the canonical operation's own capability classes, or
  // `_authority` computes `[undefined]` and refuses a fully-capable principal with `forbidden`.
  ...Object.fromEntries([deriveSurfaceNames('evidence.search').mcp, 'evidence.search']
    .map((tool) => [tool, canonicalOperationForCommand('evidence.search').capabilities])),
  // Issue #317 (docs/50): services.list is advertised from its own tool row (like evidence.search
  // above — excluded from MCP_APPLICATION_ENTRIES, so no derived row reaches it); register BOTH
  // spellings from the canonical operation's capability classes.
  ...Object.fromEntries([deriveSurfaceNames('services.list').mcp, 'services.list']
    .map((tool) => [tool, canonicalOperationForCommand('services.list').capabilities])),
  baton_decision_answer: ['approve', 'observe'],
  // MCP-W1/W2/W3 (mcp-packaging-decisions v1.0): the ordinary-surface doctor and settlement tools.
  // These ride explicit `_dispatch` branches (never APPLICATION_COMMAND_DEFINITIONS keys), so their
  // capability classes are registered here like the reflex tools. The settlement lease requires the
  // explicit settlement capability class (single-orchestrator posture — never a default).
  baton_deployment_doctor: ['observe'],
  // Issue #294: the deployment wake stream's consumers. A wake read is observation; a subscription
  // is a filter over the session's own ONE attachment, never a second authority (which is why the
  // pair is observe-class while the attachment itself is opened by the bridge's connection).
  baton_wakes_subscribe: ['observe'],
  baton_wakes_unsubscribe: ['observe'],
  baton_wakes_since: ['observe'],
  baton_scratchpad_elevate: ['control', 'observe'],
  baton_scratchpad_settle: ['control', 'observe'],
  baton_knowledge_settlement_lease: ['settlement'],
  // Issue #99/#179: observe admits the read projection; the effectful harvest demands control.
  baton_run_resultpin: ['observe'],
  // Facade-projection epic (#87+#48): the six ordinary workflow-surface tools (Decision 10's
  // "Who may drive what" — send/elevate/seed require the control class, the reads only observe).
  baton_run_message_send: ['control', 'observe'],
  baton_run_message_receipt: ['observe'],
  baton_run_attention_watch: ['observe'],
  baton_run_scratchpad_read: ['observe'],
  baton_run_scratchpad_elevate: ['control', 'observe'],
  baton_run_scratchpad_append: ['control', 'observe'],
  baton_run_knowledge_seed: ['control', 'observe'],
  // Matrix mutations keep the existing transported posture: observe admits the tool call, while
  // the run-orchestrator lease resolved inside S-2 is the control authority.
  ...Object.fromEntries(SURFACING_MATRIX_MCP_ROWS.map((operation) => [operation.names.mcp, ['observe']])),
});
// Reflex surface contract Part A: the tool names bound by explicit `_dispatch` branches below
// (never APPLICATION_COMMAND_DEFINITIONS keys — Part A.2). The read-only subset
// (REFLEX_READ_ONLY_TOOLS, below near the reflex table) extends the observe-path error gate.
const REFLEX_TOOL_NAMES = new Set([
  'baton_decision_answer',
  ...SURFACING_MATRIX_MCP_ROWS.map((operation) => operation.names.mcp),
]);
const STATEFUL = new Set(['fleet_spawn', 'fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_send', 'fleet_respond', 'fleet_interrupt', 'fleet_capability_invoke', 'fleet_kill', 'fleet_drain',
  'baton_decision_answer',
  ...SURFACING_MATRIX_MCP_ROWS.filter((operation) => operation.effect === 'control')
    .map((operation) => operation.names.mcp),
  'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_settlement_lease',
  ...MCP_APPLICATION_ENTRIES.filter(([, , definition]) => definition.mcpStateful).map(([tool]) => tool)]);
for (const [tool, , definition] of ORDINARY_APPLICATION_ENTRIES) if (definition.mcpStateful) STATEFUL.add(tool);
const RECONCILABLE = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'baton_decision_answer',
  ...SURFACING_MATRIX_MCP_ROWS.filter((operation) => operation.effect === 'control')
    .map((operation) => operation.names.mcp),
  'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_settlement_lease',
  ...MCP_APPLICATION_ENTRIES.filter(([, , definition]) => definition.mcpStateful && definition.reconcilable).map(([tool]) => tool)]);
for (const [tool, , definition] of ORDINARY_APPLICATION_ENTRIES) if (definition.mcpStateful && definition.reconcilable) RECONCILABLE.add(tool);
const GOAL_PLAN_MUTATIONS = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve']);
const BOUNDED_OBSERVATION_AUDITS = new Set(['tool_completed']);
const FENCED = new Set(['fleet_send', 'fleet_interrupt', 'fleet_kill']);
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const SESSION_FIELDS = new Set(['mode', 'id', 'lastTurnId', 'context']);
const SESSION_CONTEXT_FIELDS = new Set(['worktree', 'repoRoot', 'baseSha', 'branch', 'ownerTaskId']);
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
// U-F3 (issue #288): a tool refusal states its transience verdict (`retryable`) and its remedy
// (`action`) beside the code — the same two keys the undocumented surface family and
// BatonControlError already carry. Both are additive: a refusal that states neither keeps the
// byte-stable {code, message?, detail?, field?} shape every existing pin reads.
function toolError(code, message = null, detail = null, field = null, options = {}) {
  const retryable = options?.retryable ?? null;
  const action = options?.action ?? null;
  return toolResult({ ok: false, error: {
    code, ...(message == null ? {} : { message }), ...(detail == null ? {} : { detail }), ...(field == null ? {} : { field }),
    ...(retryable == null ? {} : { retryable: retryable === true }), ...(action == null ? {} : { action }),
  } }, true);
}
// U-F3 (issue #288): the fallthrough rows this surface mints state their own transience. A cause
// that IS a permanent deployment condition is refused typed with retryable:false and its remedy
// (the web ladder's identical three, web-northbound.mjs PERMANENT_DISPATCH_CAUSES); the
// unclassified fallthrough is the TRANSIENT row, so an agent retries it instead of guessing.
const PERMANENT_TOOL_CAUSES = Object.freeze({
  application_unavailable: Object.freeze({
    message: 'this resident serves no Run application',
    remedy: 'restart the resident from a deployment that wires the Run application (`baton serve` on the resident host); no retry can succeed against this one',
  }),
  // Issue #343: the swarm view tool keeps its OWN oversize row — its narrowing axes are the
  // swarm's (participantId, projection, cursor), never the Run-view selectors.
  application_swarm_view_oversize: Object.freeze({
    message: 'the swarm view answer exceeds this deployment\'s wire frame',
    remedy: 'narrow the read (a `participantId`, a `projection`, or walk the pages with `cursor` — each page names page {cursor, next, total, served, ceiling}); the same read refuses for the same reason',
  }),
  // Issue #202 / D5 (contract-launch 2026-08-14/redrive3): the doctor lane produced a NON-RECORD
  // readiness — an upstream shape fault, minted at _sanitizeDoctorReadiness. Replaying the call
  // against this resident replays the same producer shape, so the refusal states its permanent
  // verdict and the repair — never the transient fallthrough a retry cannot satisfy.
  deployment_readiness_invalid: Object.freeze({
    message: 'the doctor lane produced a readiness that is not a record',
    remedy: 'the readiness producer behind this deployment (a doctorReadiness hook or the application facade\'s doctor) returned a bare value; repair or remove the producer and restart the resident — no retry can succeed against this one',
  }),
});
const TRANSIENT_FALLTHROUGH_ACTION = 'retry once; a refusal that repeats is a resident defect rather than a request fault — inspect the resident (`baton doctor --check`) and report the refusal code';
// #160 R2 (error-actionability-2026-08-13/contract-fold.md §2 D4 R2): the coaching size family —
// every cataloged byte-lane refusalCode from limits.mjs except the `workflow_*` lane (which the
// workflow_* arm handles). Derived from the closed catalog so a new lane's refusalCode is
// automatically covered (additive-only).
const COACHING_REFUSAL_CODES = new Set(
  Object.values(FRAME_LIMITS)
    .map((row) => row?.refusalCode)
    .filter((code) => typeof code === 'string' && !code.startsWith('workflow_')),
);

// Issue #99/#179 (harvest-accessor contract Decision 4): the accessor's COMPLETE wire vocabulary
// — every refusal the two ports can throw, surfaced verbatim by stateFailureCode — plus the
// structured-integration kernel codes the resolver-free harvest lane can hit, each translated
// onto its ONE harvest-vocabulary code (never a degradation to command_outcome_unknown).
const HARVEST_VOCABULARY = new Set([
  'result_not_ready', 'pin_not_found', 'pin_unverifiable', 'pin_mismatch', 'pin_base_mismatch',
  'result_delta_oversize', 'harvest_conflict', 'harvest_onto_dirty', 'harvest_onto_invalid',
  'harvest_onto_advanced', 'harvest_base_diverged', 'harvest_apply_failed',
]);
const HARVEST_CODE_TRANSLATIONS = Object.freeze({
  structured_main_dirty: 'harvest_onto_dirty',
  structured_main_advanced: 'harvest_onto_advanced',
  structured_tool_unavailable: 'harvest_conflict',
  structured_merge_failed: 'harvest_apply_failed',
  captured_change_oversize: 'result_delta_oversize',
});

// #160 R2: the centralized LANE_CRAFTED decision used at ALL six MCP error sinks. The wire code is
// stateFailureCode(cause); the message + detail ride ONLY for the lane-crafted families (coaching,
// wave_member_invalid, wave_not_found, workflow_*). Coaching refusals put the triple on the Error
// ROOT (coachingApplicationError application.mjs:247-252 / coachingValidationError messages.mjs:228-235),
// so `cause.detail` is null — the detail object is CONSTRUCTED from the root fields. Lane-authored
// wave/workflow refusals carry a prebuilt detail object and pass it through verbatim.
// Facade-projection epic (#87+#48, Decision 12 / #89): the message-send body cap is the ONE
// cataloged size lane whose oversize refusal reuses the lane's closed-shape invalid code
// (application.mjs _normalizeMessageSend composes cap+actual into its own text). Because that code
// is not a lane-crafted family, the generic wire mapping would strip it to a bare code — so the
// projection MARKS the throw at its own dispatch seam with the SAFE triple re-derived from the
// SAME FRAME_LIMITS row and the caller's measured body bytes (never by parsing or forwarding the
// exception text). A closed-shape violation (bad kind, unknown key) never satisfies the byte
// predicate, so it stays unmarked and the MN1/MN8 sanitization law is untouched.
function markedMessageSendSizeRefusal(cause, body) {
  const row = FRAME_LIMITS['message.send.body'];
  if (cause?.code !== 'application_message_send_invalid' || typeof body !== 'string') return cause;
  const actual = Buffer.byteLength(body);
  if (actual <= row.value) return cause;
  return Object.assign(cause, { cap: row.value, actual, unit: row.unit, gracefulPath: frameLimitRefusalPath(row, row.value) });
}

function laneCraftedToolError(cause) {
  const stateCode = stateFailureCode(cause);
  // U-F3 (issue #288): the two fallthrough rows state their own transience — a permanent
  // deployment condition is retryable:false with its remedy, and the unclassified fallthrough is
  // the TRANSIENT row (retry, then diagnose), never a bare code an agent has to interpret. A
  // wire-safe refusal keeps its own composed message under either verdict.
  const carried = cause?.wireSafe === true
    ? {
      message: typeof cause.message === 'string' ? cause.message : null,
      detail: cause.detail ?? null,
      field: typeof cause.field === 'string' ? cause.field : null,
    }
    : { message: null, detail: null, field: null };
  const permanent = PERMANENT_TOOL_CAUSES[stateCode] ?? null;
  if (permanent !== null) {
    return toolError(stateCode, carried.message ?? permanent.message, carried.detail, carried.field,
      { retryable: false, action: permanent.remedy });
  }
  const fallthrough = stateCode === 'command_outcome_unknown'
    ? { retryable: true, action: TRANSIENT_FALLTHROUGH_ACTION }
    : {};
  // #89 / Decision 12: the MARKED message-send size refusal rides its SAFE {cap, actual, unit,
  // gracefulPath} triple and a message RE-COMPOSED from the catalog row — the exception's own text
  // never reaches the wire. An unmarked application_message_send_invalid stays code-only.
  if (cause?.code === 'application_message_send_invalid'
    && Number.isSafeInteger(cause?.cap) && Number.isSafeInteger(cause?.actual)) {
    const row = FRAME_LIMITS['message.send.body'];
    return toolError(stateCode, composeFrameLimitRefusal(row, cause.actual, cause.cap), {
      cap: cause.cap, actual: cause.actual, unit: row.unit, gracefulPath: frameLimitRefusalPath(row, cause.cap),
    });
  }
  const LANE_CRAFTED = typeof cause?.code === 'string'
    && (COACHING_REFUSAL_CODES.has(cause.code) || cause.code === 'wave_member_invalid' || cause.code === 'wave_not_found' || cause.code.startsWith('workflow_'));
  // A refusal COMPOSED for the wire (`wireSafe: true` — the bridge's own admission and session
  // refusals) keeps its message, detail and field so the caller can act on it without reading
  // logs (#160). Every other unmarked refusal stays code-only: exception text is not a composed
  // refusal and never reaches the wire (MN1/MN8, RC-03/RC-04).
  if (!LANE_CRAFTED) {
    return cause?.wireSafe === true
      ? toolError(stateCode, carried.message, carried.detail, carried.field, fallthrough)
      : toolError(stateCode, null, null, null, fallthrough);
  }
  // Coaching refusals put the triple on the Error ROOT (coachingApplicationError application.mjs /
  // coachingValidationError messages.mjs) — construct the detail object from those root fields.
  // The constructed gracefulPath makes the refusal actionable regardless of which surface renders it.
  if (COACHING_REFUSAL_CODES.has(cause?.code)) {
    return toolError(stateCode, cause?.message ?? null, {
      ...(cause?.field != null ? { field: cause.field } : {}),
      ...(cause?.cap != null ? { cap: cause.cap } : {}),
      ...(cause?.actual != null ? { actual: cause.actual } : {}),
      unit: cause?.unit ?? 'bytes',
      gracefulPath: cause?.gracefulPath ?? null,
    });
  }
  // Wave refusals carry their OWN prebuilt {actual, cap, cause, role} detail; the lane's message
  // rides BOTH at the error root (W6/F4) and INSIDE the detail so the actionability triple resolves
  // on every surface (M4 — the observe path renders the same payload as the stateful path). The
  // per-field assertions in wave-observability A6-1/A6-2/A6-3 never deepEqual the whole detail.
  if (cause?.code === 'wave_member_invalid' || cause?.code === 'wave_not_found') {
    const laneDetail = cause?.detail && typeof cause.detail === 'object' && !Array.isArray(cause.detail)
      ? { ...cause.detail, ...(typeof cause?.message === 'string' ? { message: cause.message } : {}) }
      : (typeof cause?.message === 'string' ? { message: cause.message } : null);
    return toolError(stateCode, cause?.message ?? null, laneDetail);
  }
  // workflow_* (B3): the LANE_CRAFTED arm forwards cause?.detail VERBATIM (workflow-dsl PIN-E pin —
  // error.detail deepEquals {line, field, expected}), never augmented.
  return toolError(stateCode, cause?.message ?? null, cause?.detail ?? null);
}

function stateFailureCode(cause) {
  if (cause?.mcpCode === 'stale_fence') return 'stale_fence';
  if (cause?.code === 'application_unauthorized') return 'forbidden';
  if (['application_run_not_found', 'application_interaction_not_found', 'application_profile_not_found', 'application_worker_not_found'].includes(cause?.code)) return 'not_found';
  // U-F3 (issue #288): a permanent deployment condition keeps its OWN code — re-spelling these as
  // `temporarily_unavailable` told an agent to retry a deployment fact that cannot change. The
  // transience verdict now rides the refusal itself (PERMANENT_TOOL_CAUSES, below).
  if (Object.hasOwn(PERMANENT_TOOL_CAUSES, cause?.code)) return cause.code;
  if (typeof cause?.code === 'string' && cause.code.startsWith('application_')) return cause.code;
  if (typeof cause?.code === 'string' && cause.code.startsWith('worker_policy_')) return cause.code;
  if (typeof cause?.code === 'string' && cause.code.startsWith('run_orchestrator_')) return cause.code;
  // Issue #99/#179 (harvest-accessor contract Decision 4): the result-materialization
  // vocabulary reaches the wire AS ITSELF — never command_outcome_unknown — and the
  // structured-integration kernel codes the harvest lane can hit translate onto the harvest
  // vocabulary row-by-row (structured_main_dirty → harvest_onto_dirty, structured_main_advanced
  // → harvest_onto_advanced, structured_tool_unavailable → harvest_conflict,
  // structured_merge_failed → harvest_apply_failed, captured_change_oversize →
  // result_delta_oversize).
  if (typeof cause?.code === 'string' && HARVEST_VOCABULARY.has(cause.code)) return cause.code;
  if (typeof cause?.code === 'string' && Object.hasOwn(HARVEST_CODE_TRANSLATIONS, cause.code)) {
    return HARVEST_CODE_TRANSLATIONS[cause.code];
  }
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
  // Issue #294: the deployment wake stream's own refusals surface typed — an unknown wake class
  // names the closed set, and an unattachable stream is a state, not an unknown outcome.
  if (['invalid_wake_filter', 'wake_stream_unavailable', 'wake_stream_closed', 'wake_stream_refused',
    'wake_subscription_not_found', 'wake_notifications_unavailable', 'wake_page_invalid'].includes(cause?.code)) return cause.code;
  if (cause?.code === 'run_stopping') return cause.code;
  // #105 D3 (reply-chains-2026-08-06): the message lane's budget refusal is the ONE new
  // allowlisted message_* code — the orchestrator's send-side refusal surfaces typed on the
  // wire. The worker-stream codes (message_depth_exceeded / message_target_not_member /
  // message_parent_not_found) deliberately stay stream-only, never MCP tool errors.
  if (cause?.code === 'message_budget_invalid') return cause.code;
  if (['capability_not_found', 'capability_op_unavailable', 'capability_budget_invalid', 'cancelled',
    'capability_result_invalid', 'capability_result_oversize', 'capability_authority_forbidden', 'capability_args_invalid',
    'capability_resume_invalid', 'capability_reverify_invalid', 'capability_actor_invalid', 'capability_repo_invalid', 'capability_idempotency_invalid',
    'capability_context_invalid', 'capability_context_forbidden', 'capability_record_unavailable',
    'invalid_proposal', 'invalid_sbom_path', 'proposal_context_required', 'proposal_receipt_invalid', 'proposal_schema_invalid',
    'proposal_policy_violation', 'proposal_network_violation', 'proposal_root_changed', 'proposal_coordinate_mismatch', 'proposal_oversize', 'proposal_timeout', 'proposal_resolver_failed', 'proposal_cleanup_failed', 'proposal_supervisor_busy', 'proposal_reconcile_failed', 'sbom_schema_invalid', 'sbom_oversize', 'sbom_source_changed', 'sbom_unavailable', 'artifact_integrity',
    'invalid_advisory_request', 'advisory_context_required', 'invalid_package_identity', 'advisory_plan_diverged', 'advisory_policy_changed', 'advisory_scan_coordinate_mismatch', 'advisory_scan_schema_invalid', 'advisory_scan_incomplete', 'advisory_source_changed', 'advisory_atlas_integrity', 'advisory_projection_oversize',
    'oracle_unavailable', 'oracle_timeout', 'oracle_response_oversize', 'oracle_schema_invalid', 'oracle_coordinate_mismatch', 'oracle_incomplete', 'oracle_source_integrity', 'oracle_clock_invalid',
    'capability_resume_unavailable', 'capability_reverify_unavailable', 'capability_task_requires_task_plane',
    'explicit_vendor_required', 'verification_required',
    'invalid_run_id',
    'causal_request_invalid', 'causal_context_invalid', 'causal_repo_mismatch', 'causal_audit_invalid', 'causal_trace_invalid', 'causal_recall_invalid', 'causal_audit_oversize', 'causal_trace_oversize', 'causal_audit_integrity', 'causal_recall_oversize', 'causal_recall_audit_failed', 'knowledge_recall_conflict', 'knowledge_recall_integrity',
    'causal_correction_invalid', 'causal_correction_forbidden', 'causal_correction_oversize', 'causal_correction_conflict', 'causal_correction_integrity',
    'causal_contradiction_invalid', 'causal_contradiction_forbidden', 'causal_contradiction_oversize', 'causal_contradiction_audit_failed', 'causal_contradiction_conflict', 'causal_contradiction_integrity', 'unresolved_contradiction',
    'stale_version',
    'goal_plan_invalid', 'goal_plan_unauthorized', 'goal_plan_unavailable', 'goal_plan_required', 'goal_plan_status_invalid', 'not_found', 'duplicate_task',
    'goal_conflict', 'goal_predecessor_required', 'goal_stale', 'goal_weakened',
    'plan_approval_conflict', 'plan_approval_expired', 'plan_approval_invalid', 'plan_approval_stale', 'plan_brief_mismatch', 'plan_budget_exceeded',
    'plan_conflict', 'plan_cycle', 'plan_dangling_dependency', 'plan_dependency_incomplete', 'plan_dependency_mismatch', 'plan_dispatch_conflict',
    'plan_dispatch_invalid', 'plan_dispatch_stale', 'plan_duplicate_node', 'plan_effect_invalid', 'plan_effect_mismatch', 'plan_goal_mismatch',
    'plan_node_invalid', 'plan_node_limit', 'plan_node_not_found', 'plan_not_approved', 'plan_predecessor_required', 'plan_risk_mismatch', 'plan_route_mismatch',
    'plan_route_invalid', 'plan_route_authority_legacy_ambiguous',
    'plan_scope_invalid', 'plan_self_approval', 'plan_stale', 'plan_verification_invalid',
    'coordinator_drain_incomplete', 'coordinator_draining', 'coordinator_closed'].includes(cause?.code)) return cause.code;

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
  if (['ModelSelectionError', 'SessionSelectionError', 'DuplicateTaskIdError', 'UnknownVendorError', 'DependencyCycleError', 'TypeError'].includes(cause?.name)) return 'invalid_command';
  if (cause?.name === 'WorkerNotFoundError') return 'not_found';
  // #160 R2 (error-actionability-2026-08-13/contract-fold.md §2 D4 R2): the coaching size family
  // (every byte-lane refusalCode from limits.mjs except workflow_*). Checked right before the
  // fallthrough so a coaching throw never degrades to command_outcome_unknown — the refusal rides
  // with its {cap, actual, unit, gracefulPath} triple (constructed by laneCraftedToolError).
  if (COACHING_REFUSAL_CODES.has(cause?.code)) return cause.code;
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
  objective: { type: 'string', minLength: 1 },
  resultIntent: { type: 'string', enum: ['change', 'read_only_evidence'], default: 'change' },
  profile: runId,
  route: applicationRouteSchema,
  // Issue #499: the intent scope is the same 64-path wave/scope payload class the wavefile
  // grammar bounds with one ceiling (the wave scope IS the member default scope there).
  scope: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
}, ['objective']);
const applicationAnswerSchema = {
  oneOf: [
    schema({ text: { type: 'string', minLength: 1 } }, ['text']),
    // Part B (issue #16): the typed decision-channel answer form — the closed set is exactly
    // {optionId, text} (R3/R9, row-conformance-core): the retired decision branch was an extra
    // advertised form both baton_decision_answer and fleet_run_answer shared (G10), so a renamed
    // branch would be advertised to both consumers.
    schema({ optionId: { type: 'string', minLength: 1 } }, ['optionId']),
  ],
};
const applicationFeedbackFindingSchema = schema({
  kind: { type: 'string', enum: ['defect', 'risk', 'suggestion', 'question', 'observation'] },
  severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
  message: { type: 'string', minLength: 1 },
  path: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
  line: { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
}, ['kind', 'severity', 'message', 'path', 'line']);
const applicationFeedbackSchema = {
  oneOf: [
    { type: 'string', minLength: 1 },
    schema({
      summary: { type: 'string', minLength: 1 },
      findings: { type: 'array', minItems: 1, items: applicationFeedbackFindingSchema },
    }, ['summary', 'findings']),
  ],
};
const APPLICATION_TOOL_DEFINITIONS = Object.freeze([
  { name: 'fleet_run_start', description: 'Start one Baton Run from a concise objective, explicit change or read-only evidence result intent, deployment profile, and exact harness/model/effort route; returns a readable Plan awaiting approval.', inputSchema: schema({ ...repo, ...idem, intent: applicationIntentSchema }, ['repoId', 'idempotencyKey', 'intent']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_status', description: 'Read the fresh bounded authoritative RunView for one Run.', inputSchema: schema({ ...repo, runId }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_follow', description: 'Resume one Run-specific bounded at-least-once change page after an acknowledged coordination cursor (omit afterCursor to resume from the stream start).', inputSchema: schema({ ...repo, runId, afterCursor: { type: 'integer', minimum: 0 }, timeoutMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId', 'timeoutMs']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_approve', description: 'Approve the exact displayed Plan digest and let the resident Baton application dispatch it once.', inputSchema: schema({ ...repo, ...idem, runId, planDigest: digest }, ['repoId', 'idempotencyKey', 'runId', 'planDigest']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_wait', description: 'Wait a bounded deployment-approved interval and return a fresh authoritative RunView.', inputSchema: schema({ ...repo, runId, timeoutMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId', 'timeoutMs']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_answer', description: 'Answer one Run-owned pending question or approval exactly once.', inputSchema: schema({ ...repo, ...idem, runId, requestId: { type: 'string', minLength: 1 }, answer: applicationAnswerSchema }, ['repoId', 'idempotencyKey', 'runId', 'requestId', 'answer']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_stop', description: 'Durably close one Run to new effects, then kill and reap only its exact workers and return its stop receipt.', inputSchema: schema({ ...repo, ...idem, runId, reason: { type: 'string', minLength: 1 } }, ['repoId', 'idempotencyKey', 'runId', 'reason']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_evidence', description: 'Return one bounded content-addressed terminal evidence manifest for a Run.', inputSchema: schema({ ...repo, runId }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_episode', description: 'Read one progressively addressed Episode chapter without inspect selectors.', inputSchema: schema({ ...repo, runId, topic: runId, detail: { type: 'string', enum: ['item', 'content', 'evidence'] }, role: runId, generation: { type: 'integer', minimum: 1 }, pageCursor: { type: 'string', minLength: 1 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_run_workstreams', description: 'List or open durable semantic workstream generations.', inputSchema: schema({ ...repo, runId, role: runId, generation: { type: 'integer', minimum: 1 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
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
      pageCursor: { type: 'string', minLength: 1 }, recipient: runId,
      waitMs: { type: 'integer', minimum: 1 },
    }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_episode',
    description: 'Read one Episode chapter with direct topic, role, generation, and continuation coordinates.',
    inputSchema: schema({ ...repo, runId, topic: runId, detail: { type: 'string', enum: ['item', 'content', 'evidence'] }, role: runId, generation: { type: 'integer', minimum: 1 }, pageCursor: { type: 'string', minLength: 1 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_workstreams',
    description: 'List or open one durable role/generation workstream without worker coordinates.',
    inputSchema: schema({ ...repo, runId, role: runId, generation: { type: 'integer', minimum: 1 }, cursor: { type: 'integer', minimum: 0 }, waitMs: { type: 'integer', minimum: 1 } }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_send',
    description: 'Send guidance to a current Run recipient.',
    inputSchema: schema({ ...repo, ...idem, runId, message: { type: 'string', minLength: 1 }, recipient: runId, delivery: { type: 'string', enum: ['nudge', 'now', 'turn'] } }, ['repoId', 'idempotencyKey', 'runId', 'message']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_interrupt',
    description: 'Interrupt a current Run recipient while preserving its reusable session.',
    inputSchema: schema({ ...repo, ...idem, runId, recipient: runId, reason: { type: 'string', minLength: 1 } }, ['repoId', 'idempotencyKey', 'runId']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_select',
    description: 'Select a verified Workflow candidate by role.',
    inputSchema: schema({ ...repo, ...idem, runId, role: runId, reason: { type: 'string', minLength: 1 } }, ['repoId', 'idempotencyKey', 'runId', 'role', 'reason']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_run_stop',
    description: 'Immediately stop and reap one exact Run without enumerating workers.',
    inputSchema: schema({ ...repo, ...idem, runId, reason: { type: 'string', minLength: 1 } }, ['repoId', 'idempotencyKey', 'runId', 'reason']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  // MCP-W3 (mcp-packaging-decisions v1.0): deployment.doctor — quota-free, per-call FRESH
  // readiness; credential posture as metadata only (source kind, expiry class), never secret
  // material. It is the route-picking prerequisite, so charging quota would blind callers exactly
  // when they need it.
  {
    name: 'baton_deployment_doctor',
    description: 'Read fresh deployment readiness (routes with state, workspace capacity, credential posture as metadata ONLY — never token material). Quota-free and rebuilt on every call. Pass the served repoId the initialize greeting states, verbatim; a deployment that derives the coordinate itself omits it from every tool schema.',
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
      ...repo, ...idem, runId, requestId: { type: 'string', minLength: 1 }, answer: applicationAnswerSchema,
    }, ['repoId', 'idempotencyKey', 'runId', 'requestId', 'answer']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // MCP-W2 (mcp-packaging-decisions v1.0): the settlement ops become MCP tools behind the
  // S-2 sessionAuthority envelope. The envelope is the authenticated connection's proof (never a
  // caller field); knowledge.settlement_lease requires
  // an explicit settlement capability class on the MCP principal (single-orchestrator posture).
  {
    name: 'baton_scratchpad_elevate',
    description: 'Elevate one terminal task\'s scratchpad entries into candidate Findings (S-2 settlement lane).',
    inputSchema: schema({
      ...repo, ...idem, runId, taskId: runId, workerId: runId,
      expectedScratchpadFence: { type: 'integer', minimum: 0 },
      entryIds: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^scratchpad-entry:[a-f0-9]{64}$' } },
    }, ['repoId', 'idempotencyKey', 'runId', 'taskId', 'workerId', 'expectedScratchpadFence', 'entryIds']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_scratchpad_settle',
    description: 'Settle one workflow\'s shared scratchpad partition with explicit skips (S-2 settlement lane).',
    inputSchema: schema({
      ...repo, ...idem, runId, expectedScratchpadFence: { type: 'integer', minimum: 0 },
      skips: { type: 'array', items: { type: 'object' } },
    }, ['repoId', 'idempotencyKey', 'runId', 'expectedScratchpadFence', 'skips']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {

    name: 'baton_knowledge_settlement_lease',
    description: 'Mint the wave settlement lease + candidacy bundle from the host\'s fixed principal. ENABLED ONLY for a descriptor principal carrying an explicit settlement capability class (single-orchestrator posture); the session is derived from the host, never tool arguments.',
    inputSchema: schema({
      ...repo, ...idem, waveId: runId, members: { type: 'array', items: runId },
    }, ['repoId', 'idempotencyKey', 'waveId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Issue #206: the message lane's ordinary tools (restored per the final-landing ruling).
  {
    name: 'baton_run_message_send',
    description: 'Send one orchestrator message to a worker or run target (inform|query|steer). The target is exactly {workerId} or {runId}; the body rides the message frame lane (message.send.body). budget is optional (default 1). Returns the lane outcome verbatim.',
    inputSchema: schema({
      ...repo, runId, workerId: runId, kind: { type: 'string', enum: ['inform', 'query', 'steer'] },
      body: { type: 'string', minLength: 1 },
      budget: { type: 'integer', minimum: 1 },
    }, ['repoId', 'kind', 'body']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'baton_run_message_receipt',
    description: "Read the honest receipt state machine for one message: {delivered, read, actedOn, reply} - the lane's exact shape, resolve-then-authorized (an unknown id refuses identically to a foreign one).",
    inputSchema: schema({ ...repo, messageId: { type: 'string', pattern: '^message:[a-f0-9]{64}$' } }, ['repoId', 'messageId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Issue #566 (d1288fd9 regression): the facade six's remaining four plus the scratchpad and
  // knowledge-seed ordinary rows return — the dispatch chain, shape guards, capability classes,
  // and explicit-tool sets never left, so only these definition rows were cut.
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
      entryIds: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^scratchpad-entry:[a-f0-9]{64}$' } },
    }, ['repoId', 'runId', 'taskId', 'entryIds']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'baton_run_scratchpad_append',
    description: "Append one entry to a run scratchpad scope (shared or worker:<id>) as a direct EPHEMERAL write (issue #158). Returns the store receipt verbatim {ok, result:'written'|'idempotent', entryId, entryDigest, scope, scratchpadFence, eventSeq}. The entry's author is server-bound to the caller identity; an exact retry under the same idempotencyKey replays the prior receipt.",
    inputSchema: schema({
      ...repo, runId,
      scope: { type: 'string', pattern: '^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$' },
      kind: { type: 'string', enum: ['note', 'plan', 'doubt', 'link'] },
      body: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'object' }, { type: 'array' }] },
      idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' },
    }, ['repoId', 'runId', 'scope']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  // Issue #555: the seed leg is a #314 core-table projection source — baton_knowledge
  // {verb: 'seed'} projects THIS row's schema, so the ordinary table carries it.
  {
    name: 'baton_run_knowledge_seed',
    description: "Seed one content-addressed knowledge node inside a run's horizon. An exact retry replays idempotent under the server-derived key; distinct content seeds a distinct node, never a silent overwrite.",
    inputSchema: schema({
      ...repo, runId,
      type: { type: 'string', enum: ['Run', 'Task', 'Artifact', 'Phase', 'Experiment', 'Finding', 'Question', 'Hypothesis', 'Principle', 'Constraint', 'Literature', 'Research', 'RouteStat', 'Skill', 'Counterexample', 'Representation', 'ScratchFact', 'Source'] },
      grounding: { type: 'string', enum: ['verified', 'observed', 'derived', 'asserted'] },
      body: { type: 'string', minLength: 1 },
      evidence: { type: 'array', items: { type: 'object' } },
    }, ['repoId', 'runId', 'type', 'grounding', 'body']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  // Issue #99/#179 (harvest-accessor contract Decision 4): the accessor's ordinary tool.
  {
    name: 'baton_run_resultpin',
    description: "Read one run's preserved result projection: the accepted pin sha, the RECORDED capture base, and the bounded changed-path/file delta (recorded-base diff, never HEAD, never pin^). Read-only.",
    inputSchema: schema({ ...repo, runId }, ['repoId', 'runId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
].map((tool) => Object.freeze({
  ...tool,
  _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
  execution: Object.freeze({ taskSupport: 'forbidden' }),
})));

// Issue #294: the deployment-scope wake stream's MCP consumers, beside the swarm family above.
//
// The stream itself lives on the resident (`GET /v1/wakes`, impl/src/wake-stream.mjs) and owns the
// ONE filter vocabulary — the closed wake-class table, `swarms`/`participants` id filters and the
// cursor rule (a cursor IS a coordination ledger seq; `since=<seq>` resumes exactly after it).
// Nothing is restated here: an unknown class refuses with the closed set the stream publishes, and
// the pull form's page bound is the transport's own frame ceiling, never a row count.
//
// `baton_wakes_subscribe` is a FILTER, not a connection: the session holds ONE upstream attachment
// however many subscriptions it opens, and each subscription's frames arrive as
// `notifications/baton/wake` frames for as long as the session lives.
const WAKE_NOTIFICATION_METHOD = 'notifications/baton/wake';
const WAKE_FILTER_TOKEN = Object.freeze({ type: 'string', minLength: 1 });
const WAKE_TOKEN_LIST = Object.freeze({
  oneOf: [
    { type: 'string', minLength: 1 },
    { type: 'array', items: WAKE_FILTER_TOKEN },
  ],
});

const WAKE_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'baton_wakes_subscribe',
    description: 'Subscribe this MCP session to the deployment wake stream: every matching row then arrives as a notifications/baton/wake frame for as long as the session lives. The session holds ONE upstream attachment whatever the subscription count — a subscription is a filter, never a connection. kinds names wake classes from the closed table (an unknown class is refused with that set); swarms and participants narrow by id; since is the coordination cursor to resume after (omit it to start from now). Returns {subscriptionId, since}.',
    inputSchema: schema({
      ...repo, kinds: WAKE_TOKEN_LIST, swarms: WAKE_TOKEN_LIST, participants: WAKE_TOKEN_LIST,
      since: { type: 'integer', minimum: 0 },
    }, ['repoId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'baton_wakes_unsubscribe',
    description: 'Stop one wake subscription opened by baton_wakes_subscribe. The last subscription releases this session\'s upstream attachment; the deployment stream every other consumer reads is untouched.',
    inputSchema: schema({
      ...repo, subscriptionId: { type: 'string', minLength: 1 },
    }, ['repoId', 'subscriptionId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'baton_wakes_since',
    description: 'Read the deployment wake rows after a cursor — the pull form, for a caller that cannot hold an attachment. Returns the rows, the cursor to resume after, and, when the transport frame ceiling cut the page, a typed baton.wakes_continuation naming the cursor that continues exactly after the last row returned. The page is bounded by that ceiling, never by a constant row count.',
    inputSchema: schema({
      ...repo, kinds: WAKE_TOKEN_LIST, swarms: WAKE_TOKEN_LIST, participants: WAKE_TOKEN_LIST,
      since: { type: 'integer', minimum: 0 },
    }, ['repoId']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
].map((tool) => Object.freeze({
  ...tool,
  _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
  execution: Object.freeze({ taskSupport: 'forbidden' }),
})));

const WAKE_TOOL_NAMES = new Set(WAKE_TOOL_DEFINITIONS.map((tool) => tool.name));

function wakeStreamUnavailable(verb) {
  return Object.assign(
    new Error(`this deployment cannot ${verb} the wake stream: the connection carries no wake authority`),
    { code: 'wake_stream_unavailable', wireSafe: true },
  );
}

/** The SHAPE of a wake filter, validated here; its VOCABULARY (the closed class set) is the
 * stream's own and is refused by the authority that owns it, never restated in this table. */
function validateWakeArguments(name, args) {
  for (const field of ['kinds', 'swarms', 'participants']) {
    if (!Object.hasOwn(args, field) || args[field] === null || args[field] === undefined) continue;
    const value = args[field];
    const tokens = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
    if (tokens === null || tokens.some((token) => typeof token !== 'string'
      || token.trim().length === 0 || token.trim().length > 256)) {
      return {
        code: 'invalid_wake_filter', field,
        message: `${field} must be a comma-separated string or an array of bounded tokens`,
      };
    }
  }
  if (Object.hasOwn(args, 'since') && (!Number.isSafeInteger(args.since) || args.since < 0)) {
    return {
      code: 'invalid_wake_filter', field: 'since',
      message: 'since must be a non-negative safe integer cursor; omit it to start from now',
    };
  }
  if (name === 'baton_wakes_unsubscribe' && !SAFE_ID.test(args.subscriptionId ?? '')) {
    return {
      code: 'invalid_wake_filter', field: 'subscriptionId',
      message: 'subscriptionId must be the id a subscription receipt returned',
    };
  }
  return null;
}
// The ordinary table = retained legacy tools + the canonical grammar tools rendered from the
// registry (M4b). A canonical tool is its legacy sibling under the derived canonical name; the wire
// schema and annotations (from idempotent/destructive) are the sibling's, so a caller reaches one
// operation under either spelling.
// Swarm family (docs/39-swarm-runtime.md): the ordinary-surface tools for the living-swarm verbs.
// Registration-gated — a row is advertised exactly when the shared command registry carries its
// command (root spreads SWARM_COMMAND_DEFINITIONS into APPLICATION_COMMAND_DEFINITIONS), which is
// also the spread that puts the tool name into APPLICATION_TOOL/CAPABILITY/STATEFUL/RECONCILABLE
// above. Envelope fields follow the registry row's own flags: repoId always, idempotencyKey only
// for the stateful verbs (capture/check are identity-keyed, like the wave member lanes). Each
// tool's dot-spelling twin derives from this table through CANONICAL_DOT_TOOL_DEFINITIONS.
// Exported (not just module-internal) so the activation is verifiable against a registry map that
// carries the family — the integration seam root lands — without re-deriving the schema by hand.
export function swarmApplicationToolDefinitions(definitions = APPLICATION_COMMAND_DEFINITIONS) {
  return SWARM_MCP_TOOL_DEFINITIONS
    .filter((tool) => Object.hasOwn(definitions, tool.command))
    .map((tool) => {
      const definition = definitions[tool.command];
      return Object.freeze({
        name: tool.name,
        _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
        execution: Object.freeze({ taskSupport: 'forbidden' }),
        description: tool.description,
        inputSchema: schema({
          ...repo,
          ...(definition.mcpStateful === true ? idem : {}),
          ...tool.properties,
        }, [
          'repoId',
          ...(definition.mcpStateful === true ? ['idempotencyKey'] : []),
          ...tool.required,
        ]),
        annotations: Object.freeze({
          readOnlyHint: tool.readOnlyHint,
          destructiveHint: tool.destructiveHint,
          idempotentHint: true,
          openWorldHint: false,
        }),
      });
    });
}

const SWARM_APPLICATION_TOOL_DEFINITIONS = Object.freeze(swarmApplicationToolDefinitions());
// Issue #318 (retrieval, #312): the deployment evidence search as an ordinary tool. ONE
// schema — the canonical operation's own (evidence-search.mjs) — so the advertised wire shape
// can never drift from the operation every surface serves; the swarm filter is optional because
// absent names the whole deployment. The canonical dot twin derives below like every other tool.
const EVIDENCE_SEARCH_TOOL_DEFINITIONS = Object.freeze([Object.freeze((() => ({
  name: deriveSurfaceNames('evidence.search').mcp,
  _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
  execution: Object.freeze({ taskSupport: 'forbidden' }),
  description: 'Search the evidence and contributions a deployment\u2019s swarms exchanged — by swarm, participant, kind, path or free text — with a cursor derived from the coordination ledger seq (never a page cap).',
  inputSchema: schema({ ...repo, ...EVIDENCE_SEARCH_INPUT_SCHEMA.properties }, ['repoId']),
  annotations: Object.freeze({
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  }),
}))())]);

// Issue #317 (docs/50): the provider-services read as an ordinary tool. ONE schema — the
// canonical operation's own (provider-services.mjs) — so the advertised wire shape can never
// drift from the operation every surface serves. The canonical dot twin derives below like
// every other tool.
const SERVICES_LIST_TOOL_DEFINITIONS = Object.freeze([Object.freeze((() => ({
  name: deriveSurfaceNames('services.list').mcp,
  _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
  execution: Object.freeze({ taskSupport: 'forbidden' }),
  description: 'List the deployment’s configured provider services: the models each offers (pulled live from the service’s model-list endpoint where one answers, else the declaration), the routes derived from them, and subscription-window usage with its reset instant where declared or observed.',
  inputSchema: schema({ ...repo, ...SERVICES_LIST_INPUT_SCHEMA.properties }, ['repoId']),
  annotations: Object.freeze({
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  }),
}))())]);

// 2026-09-14 audit (U-F7): an alias pair carries DISTINCT descriptions, so a model can tell the
// canonical spelling from the retained one instead of seeing two identically-described tools. The
// note derives from the sibling table (one declaration), never retyped per tool.
const SIBLING_DOT_NAMES = new Map(CANONICAL_ORDINARY_SIBLINGS.map((sibling) => [sibling.legacyTool, sibling.tool]));
const SIBLING_LEGACY_NAMES = new Map(CANONICAL_ORDINARY_SIBLINGS.map((sibling) => [sibling.tool, sibling.legacyTool]));
function withSpellingNote(tool) {
  const canonical = SIBLING_DOT_NAMES.get(tool.name);
  if (canonical !== undefined) {
    return Object.freeze({
      ...tool,
      description: `${tool.description} Retained legacy spelling of the same operation; the canonical name is ${canonical}.`,
    });
  }
  const legacy = SIBLING_LEGACY_NAMES.get(tool.name);
  if (legacy !== undefined) {
    return Object.freeze({
      ...tool,
      description: `${tool.description} Canonical spelling of ${legacy} — one operation, reachable under either name.`,
    });
  }
  return tool;
}
export const ORDINARY_APPLICATION_TOOL_DEFINITIONS = Object.freeze([
  ...LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS.map(withSpellingNote),
  ...SWARM_APPLICATION_TOOL_DEFINITIONS,
  ...EVIDENCE_SEARCH_TOOL_DEFINITIONS,
  ...SERVICES_LIST_TOOL_DEFINITIONS,
  // Issue #294 (final-landing ruling): the wake family's registry rows claim the mcp surface.
  ...WAKE_TOOL_DEFINITIONS,
  // Issue #233: the canonical dot-name twins of the retained ordinary tools — each dot name is
  // the command itself (canonicalAndTransportNames(command).canonical), admitted beside its
  // legacy baton_* spelling with the same definition row. Cut by d1288fd9, restored by #566.
  ...CANONICAL_ORDINARY_SIBLINGS.map((sibling) => {
    const base = LEGACY_ORDINARY_APPLICATION_TOOL_DEFINITIONS.find((tool) => tool.name === sibling.legacyTool);
    return withSpellingNote(Object.freeze({ ...base, name: sibling.tool }));
  }),
]);

// ── the core mutation answer (docs/49 §5; issues #302, #294) ─────────────────────────────────────
//
// Law (d): every mutation verb answers a RECEIPT, and no core verb blocks. The shape is the landed
// #302 one — `{receipt: {command, event, changed}, next}` — and this is the ONE composer for it, so
// the resident bridge and any other caller of the same table cannot disagree about what a mutation
// answered.
//
// Two sources, in this order:
//
//   * an answer that ALREADY carries a receipt (every swarm mutation: the runtime's own
//     _mutationResult) rides through UNTOUCHED — the receipt derivation stays exactly where #302
//     put it (swarmChangedRow/swarmReceiptNext, swarm-contract.mjs), never re-derived here;
//   * the run and waves families answer their projection today (application.mjs _buildView): the
//     receipt is derived from that projection's own facts — the row the answer's identity names and
//     the outcome the projection itself carries (its `lastAction`, or its `stop` receipt) — and the
//     projection never rides the answer unless the caller asked (`args.view`, the same opt-in
//     spelling the swarm family already reads).
//
// `event` is the recorded row the answer carries, and null when it carries none — the landed #302
// rule for an effect whose answer names no event of its own (swarm-runtime.mjs _mutationResult).

export const CORE_ANSWER_SCHEMA_VERSION = 1;

/** Whether an answer is a Run projection (the view application.mjs _buildView mints): a runId
 * beside a phase. A small outcome (the message lane's own row, a wave start's wave and members,
 * the knowledge seed's node) is not one, and rides the receipt as the operation's own outcome. */
function runProjection(value) {
  return record(value) && nonempty(value.runId) && typeof value.phase === 'string';
}

/** The row(s) a landed run answer names, in the #302 `changed` spelling — `{collection, id}`
 * under the collection names the views themselves use. The identity the answer carries IS the row:
 * a Run for the run family and for a member lane. An answer naming no identity changed no row:
 * the receipt says so with []. */
function landedChangedRows(args, result) {
  const rows = [];
  const push = (collection, id) => { if (nonempty(id)) rows.push({ collection, id }); };
  const runId = nonempty(result?.runId) ? result.runId
    : nonempty(args?.runId) ? args.runId
      : nonempty(args?.intent?.runId) ? args.intent.runId : null;
  push('runs', runId);
  return rows;
}

/** The operation's own outcome: the projection's own action row (a settlement, an action's result)
 * or its stop receipt, and — for an answer that is not a projection at all — the answer verbatim
 * (the message lane's row, the knowledge seed's node). The whole view is never an outcome;
 * `view: true` is how a caller asks for that. */
function landedOutcome(result) {
  if (!record(result)) return result === undefined ? null : result;
  if (record(result.lastAction)) return result.lastAction;
  if (record(result.stop)) return result.stop;
  return runProjection(result) ? null : result;
}

/** The step that follows one run mutation — the twin of swarmReceiptNext
 * (swarm-contract.mjs): the read that continues from the row the receipt changed, with the
 * identity the caller already holds. Null when the answer named no row to read. */
function landedReceiptNext(args, result) {
  const rows = landedChangedRows(args, result);
  const run = rows.find((row) => row.collection === 'runs') ?? null;
  return run === null ? null : { command: 'run.view', args: { runId: run.id } };
}

/** The receipt for an answer that does not already carry one: the #302 triple, with the
 * operation's own outcome beside the rows it changed — what happened, which rows moved, and (on
 * the envelope) what to do next. */
export function coreDerivedReceipt(command, args, result) {
  const outcome = landedOutcome(result);
  return {
    command,
    event: null,
    changed: landedChangedRows(args, result),
    ...(outcome === null || outcome === undefined ? {} : { outcome }),
  };
}

/** The answer a core mutation sends (docs/49 §5): `{schemaVersion, command, receipt, next, ...}`,
 * plus the wake handoff composed for a long verb and the whole view only when the caller asked
 * for it. `wake` is the handoff `coreWakeHandoff` composed, or null for every other verb. */
export function coreMutationAnswer({ command, args, result, wake = null }) {
  // The landed answer's own objects ride through by reference: their producer owns them (the swarm
  // runtime's receipt, the application's deep-frozen view), and the envelope only wraps them.
  const body = record(result?.receipt)
    ? result
    : {
      receipt: coreDerivedReceipt(command, args, result),
      next: landedReceiptNext(args, result),
      ...(args?.view === true && result !== undefined && result !== null ? { view: result } : {}),
    };
  return Object.freeze({
    schemaVersion: CORE_ANSWER_SCHEMA_VERSION,
    command,
    ...body,
    ...(wake === null ? {} : { wake }),
  });
}

/** The filter a long verb's handoff subscription opens under (docs/49 §2's third column): the
 * classes the core row declares, narrowed by the operation's own subject where the row names those
 * axes. The swarm and the participant ARE filter axes; the run and waves families name none — the
 * #294 filter carries no run axis, so their frames correlate client-side (docs/49 §12 Q2). */
export function coreWakeHandoffFilter(facts, args) {
  const filter = { kinds: [...facts.wake.kinds] };
  if (facts.wake.scope.includes('swarmId') && nonempty(args?.swarmId)) filter.swarms = [args.swarmId];
  if (facts.wake.scope.includes('participantId') && nonempty(args?.participantId)) {
    filter.participants = [args.participantId];
  }
  return filter;
}

/** The handoff the answer carries: the landed subscription receipt verbatim — its own filter echo
 * and cursor — plus the `settleOn` subset whose frame settles THIS operation's follow-up. */
export function coreWakeHandoff(subscription, facts) {
  return { ...subscription, settleOn: [...facts.wake.settleOn] };
}
// Issue #233: the canonical dot-name twins of every advertised application tool. A dot twin is
// its base tool under the dot spelling of the application command APPLICATION_TOOL routes it to
// (canonicalAndTransportNames(command).canonical), inheriting the base's exact wire schema,
// annotations, _meta, and dispatch — the same clone pattern the M4b siblings above use, so a
// caller reaches one operation under either spelling. Derived ONLY from advertised tables: the
// unadvertised dispatch-map ghosts keep the advertised inventory's existing shape.
const CANONICAL_DOT_TOOL_DEFINITIONS = Object.freeze([...new Map(
  [...ORDINARY_APPLICATION_TOOL_DEFINITIONS, ...APPLICATION_TOOL_DEFINITIONS]
    .map((tool) => [APPLICATION_TOOL[tool.name], tool])
    // tools whose name carries no APPLICATION_COMMAND mapping (reflex/special tools admitted
    // beside the application tables) have NO dot twin — a literal undefined key would collapse
    // them into one broken inventory entry (the conformance 'served but undocumented: undefined'
    // class, caught live 2026-08-15).
    .filter(([command]) => typeof command === 'string'),
).entries()].map(([dotName, tool]) => Object.freeze({ ...tool, name: dotName })));
const ADVANCED_TOOL_DEFINITIONS = Object.freeze([
  { name: 'fleet_spawn', description: 'Spawn one Baton worker with independently selected harness, model, effort, run, and approved Goal/Plan node.', inputSchema: fleetSpawnSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },

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
    workerId: text, note: { type: 'string', minLength: 1 }, expectedFence: { type: 'integer' },
    }, ['repoId', 'idempotencyKey', 'name', 'op', 'action', 'budgetTokens']),
    oneOf: [
      actionShape('invoke', ['args'], ['ref', 'cursor', 'claim', 'workerId', 'note', 'expectedFence']),
      actionShape('resume', ['ref', 'cursor'], ['args', 'claim', 'workerId', 'note', 'expectedFence']),
      actionShape('reverify', ['claim', 'args'], ['ref', 'cursor', 'workerId', 'note', 'expectedFence']),
      actionShape('push', ['args', 'workerId', 'note', 'expectedFence'], ['ref', 'cursor', 'claim']),
    ],
  }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },

  { name: 'fleet_kill', description: 'Kill and reap one fenced worker.', inputSchema: schema({ ...repo, ...idem, ...fence, workerId: text }, ['repoId', 'idempotencyKey', 'expectedFence', 'workerId']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fleet_drain', description: 'Drain and reap the coordinator-owned local fleet while retaining transport and writer authority.', inputSchema: schema({ ...repo, ...idem }, ['repoId', 'idempotencyKey']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
].map((tool) => Object.freeze({ ...tool, execution: Object.freeze({ taskSupport: 'forbidden' }) })));
const SURFACING_MATRIX_DESCRIPTIONS = Object.freeze({
  'decision.list': 'List one Run\'s pending decision requests awaiting an answer, sanitized and bounded.',
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
      readOnlyHint: !mutation, destructiveHint: false,
      idempotentHint: true, openWorldHint: false,
    }),
    _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
    execution: Object.freeze({ taskSupport: 'forbidden' }),
  });
}));
// The combined reflex table = the full matrix projection.
const REFLEX_TOOL_DEFINITIONS = Object.freeze([...MATRIX_REFLEX_TOOL_DEFINITIONS]);
// Read-only reflex tool names needing typed-error reach through the observe-path error gate
// (Part F rule 12) — merged across both slices.
const REFLEX_READ_ONLY_TOOLS = new Set(SURFACING_MATRIX_MCP_ROWS
  .filter((operation) => operation.effect === 'observe').map((operation) => operation.names.mcp));
// MCP-W1/W2/W3: the ordinary-surface explicit-dispatch tools (never APPLICATION_COMMAND_DEFINITIONS
// keys, so the generic application branch never maps their failures) — every one of them must
// reach the typed stateFailureCode lane, never the generic 'command_failed'.
const ORDINARY_EXPLICIT_TOOLS = new Set([
  'baton_deployment_doctor',
  'baton_scratchpad_elevate', 'baton_scratchpad_settle',
  'baton_knowledge_settlement_lease',
  'baton_run_message_send', 'baton_run_message_receipt', 'baton_run_attention_watch',
  'baton_run_scratchpad_read', 'baton_run_scratchpad_elevate', 'baton_run_scratchpad_append',
  'baton_run_knowledge_seed',
  'baton_wakes_subscribe', 'baton_wakes_unsubscribe', 'baton_wakes_since',
  // Issue #99/#179: the accessor's explicit-dispatch tool.
  'baton_run_resultpin',
]);
// The application command each explicit-dispatch tool reaches (the same knowledge the handle()
// branches encode); deployment.doctor is a direct method, not a bridged string command.
const EXPLICIT_TOOL_COMMANDS = Object.freeze({
  baton_scratchpad_elevate: 'scratchpad.elevate', baton_scratchpad_settle: 'scratchpad.settle',
  baton_knowledge_settlement_lease: 'knowledge.settlement_lease',
  baton_run_message_send: 'run.message.send', baton_run_message_receipt: 'run.message.receipt',
  baton_run_attention_watch: 'run.attention.watch', baton_run_scratchpad_read: 'run.scratchpad.read',
  baton_run_scratchpad_elevate: 'run.scratchpad.elevate', baton_run_scratchpad_append: 'run.scratchpad.append',
  baton_run_knowledge_seed: 'run.knowledge.seed',
  baton_run_resultpin: 'run.resultpin',
});
/** The application command an ordinary tool dispatches, or null for tools that reach a direct
 * method (doctor) or the kernel. One lookup serves the host's advertisement filter and the gate. */
export function commandForTool(name) {
  return APPLICATION_TOOL[name] ?? EXPLICIT_TOOL_COMMANDS[name] ?? null;
}
/** The advertised-tool → dispatched-command pairs (the ordinary table's derived names, the
 * explicit direct-port tools, and the canonical dot twins): the surface-resolution witness for
 * a registry row that claims the mcp surface (surface-resolution.mjs). */
export function mcpToolCommandPairs() {
  return Object.freeze([...new Set([
    ...Object.entries(APPLICATION_TOOL),
    ...Object.entries(EXPLICIT_TOOL_COMMANDS),
  ].map(([tool, command]) => `${tool}\0${command}`))].map((row) => {
    const [tool, command] = row.split('\0');
    return Object.freeze({ tool, command });
  }));
}
const TOOL_DEFINITIONS = Object.freeze([...ORDINARY_APPLICATION_TOOL_DEFINITIONS, ...APPLICATION_TOOL_DEFINITIONS, ...CANONICAL_DOT_TOOL_DEFINITIONS, ...ADVANCED_TOOL_DEFINITIONS, ...REFLEX_TOOL_DEFINITIONS]);

// #233 regression (2026-08-15, caught live by the fleet-drive): the canonical-naming fold
// dropped this map while its consumer survived — every tools/call argument validation
// ('TOOL_BY_NAME is not defined'). Restored: dot twins resolve FIRST (a caller may address
// either spelling), legacy spellings fall through to their base tool.
const TOOL_BY_NAME = new Map([
  ...TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
  ...CANONICAL_DOT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
]);
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
  const projected = Object.fromEntries(fields
    .filter((field) => Object.hasOwn(args, field))
    .map((field) => [field, args[field]]));
  // Issue #156 D1 item 4: a bounded follow without an explicit cursor resumes from the stream
  // start. The wait/follow siblings inherit fleet_run_follow's schema (cursor now optional), and
  // the bounded-wait bound and the observe-path authority gate still run on the dispatched call.
  if (command === 'run.follow' && !Object.hasOwn(projected, 'afterCursor')) projected.afterCursor = 0;
  return projected;
}

function applicationRunId(name, args) {
  const command = APPLICATION_TOOL[name];
  if (!command) return args.runId ?? null;
  // #233: command-level (not tool-level) so both admitted spellings derive the runId the
  // same way — the dot twin inherits its transport's rule.
  return command === 'run.start' ? args.intent.runId ?? null : args.runId;
}

function transportHiddenFields(commandName) {
  const definition = APPLICATION_COMMAND_DEFINITIONS[commandName];
  const fromDefinition = definition?.transportHidden ? [...definition.transportHidden] : [];
  const fromRegistry = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => (
      operation.key === commandName
      || (commandName === 'run.inspect' && operation.key === 'run.view')
    ))
    .flatMap((operation) => operation.transportHidden ?? []);
  return new Set([...fromDefinition, ...fromRegistry]);
}

// U-F4 (issue #288): an unknown tool name must say so — the nearest advertised tool in the
// message, the full advertised set in the refusal data — instead of a bare "Invalid params".
// The distance is the same Damerau-Levenshtein shape the CLI's run-verb typo refusal uses
// (application-cli.mjs damerauLevenshteinDistance); kept local because the MCP server module
// must not pull the CLI module graph. The nearest match is a deterministic argmin over the
// sorted names (first name at the smallest distance) — no distance threshold, no size caps.
function damerauLevenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, (_, i) => new Array(cols).fill(0).map((_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

export function nearestToolName(requested, names) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const name of [...names].sort()) {
    const distance = damerauLevenshtein(requested, name);
    if (distance < nearestDistance) {
      nearest = name;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function validateArguments(name, args, maxWaitMs = null) {
  if (!record(args)) return { code: 'invalid_arguments', message: 'arguments must be a JSON object' };
  const schemaDefinition = TOOL_BY_NAME.get(name).inputSchema;
  // S-1 v2 R-WG-3: advertised schema excludes transportHidden fields, but the validator still
  // accepts them when a caller supplies a declared-hidden side-channel argument.
  const hidden = APPLICATION_TOOL[name] ? transportHiddenFields(APPLICATION_TOOL[name]) : new Set();
  // U-F1/U-I1 (issue #288): every validator refusal names the offending or missing key — the
  // structured {code, message, field} shape the render at handle() already composes for the wire.
  const unknownField = Object.keys(args).find((key) => (
    !Object.hasOwn(schemaDefinition.properties, key) && !hidden.has(key)
  ));
  if (unknownField !== undefined) {
    return {
      code: 'unknown_argument_field',
      message: `unknown argument field ${JSON.stringify(unknownField)}; this tool accepts only its declared schema fields`,
      field: unknownField,
    };
  }
  // A stateful tool's idempotencyKey is checked BEFORE the generic missing-field sweep: a
  // missing OR malformed key refuses with the lane's own typed invalid_idempotency_key (the
  // contract's §4 refusal table), never the generic missing_argument.
  if (STATEFUL.has(name) && !SAFE_ID.test(args.idempotencyKey ?? '')) {
    return { code: 'invalid_idempotency_key', message: 'idempotencyKey must be 1-256 characters of [A-Za-z0-9._:-]', field: 'idempotencyKey' };
  }
  if (name === 'fleet_capability_invoke' && !Object.hasOwn(args, 'action')) return 'invalid_capability_invocation';
  const missingField = schemaDefinition.required.find((key) => !Object.hasOwn(args, key));
  if (missingField !== undefined) {
    return { code: 'missing_argument', message: `missing required argument ${JSON.stringify(missingField)}`, field: missingField };
  }
  if (containsForbidden(args, [], { planGatedBrief: name === 'fleet_spawn' && record(args.goalPlan) })) return 'credential_fields_forbidden';
  if (!nonempty(args.repoId)) {
    return { code: 'invalid_repo', message: 'repoId must be a non-empty string naming the repository this call acts on', field: 'repoId' };
  }
  if (FENCED.has(name) && !Number.isSafeInteger(args.expectedFence)) {
    return { code: 'expected_fence_required', message: 'expectedFence must be a safe integer carrying the fence this fenced tool was admitted with', field: 'expectedFence' };
  }
  if (WAKE_TOOL_NAMES.has(name)) {
    const wakeRefusal = validateWakeArguments(name, args);
    if (wakeRefusal !== null) return wakeRefusal;
  }
  // Reflex surface contract Part C.7 (R6): the advertised `answer` `oneOf` is never evaluated
  // server-side (hand-rolled validation stays the discipline, Part I), so the answer-shape guard
  // must reject any key other than `optionId`/`text` BEFORE hub dispatch — `{decision}` (or a
  // renamed form like `{resolution}`) would otherwise reach `run.answer` and settle an APPROVAL
  // through this decision-only lane. R3/R9 (row-conformance-core) extend the guard across BOTH
  // consumers of the shared applicationAnswerSchema (G10): baton_decision_answer AND
  // fleet_run_answer — a schema-only rename or a permissive guard on either tool leaves the
  // renamed form accepted (or refused by the wrong, non-guard path). The guard runs ahead of the
  // APPLICATION_TOOL validator below, so the refusal is the answer-shape guard's
  // invalid_arguments, never the generic invalid_run_command the application validator would
  // collapse a bad shape into. Kind-matching against the pending interaction stays hub-side.
  if (name === 'baton_decision_answer' || name === 'fleet_run_answer') {
    const answerKeys = record(args.answer) ? Object.keys(args.answer) : [];
    if (answerKeys.length !== 1 || !['optionId', 'text'].includes(answerKeys[0])) {
      return { code: 'invalid_arguments', message: 'answer must carry exactly one of optionId or text', field: 'answer' };
    }
  }
  if (APPLICATION_TOOL[name]) {
    try {
      const command = APPLICATION_TOOL[name];
      const commandArgs = applicationArgs(name, args);
      validateApplicationCommandArgs(command, commandArgs);
    }
    catch (cause) {
      // #160 R1 (error-actionability-2026-08-13/contract-fold.md §2 D4 R1): a NAMED coaching
      // refusal thrown by the application VALIDATOR (a byte-lane oversize such as the legacy-alias
      // run.legacy_send.body → run_legacy_send_exceeded at application.mjs) passes through as a
      // structured refusal so it stays actionable on the MCP wire — but a shape/route error
      // (application_route_invalid, application_intent_invalid, ...) still collapses to the generic
      // invalid_run_command the pre-#160 surface asserted (phase16 UA5 pin). The coaching family
      // never reaches this catch from run.start's objective (that byte law lives at the start()
      // admission seam, handled by the stateful sink's laneCraftedToolError).
      if (typeof cause?.code === 'string' && COACHING_REFUSAL_CODES.has(cause.code)) {
        return {
          code: cause.code, message: typeof cause?.message === 'string' ? cause.message : cause.code,
          // Issue #150: carry the coaching triple so the dispatch site can construct the detail.
          ...(cause?.cap != null ? { cap: cause.cap } : {}),
          ...(cause?.actual != null ? { actual: cause.actual } : {}),
          unit: cause?.unit ?? 'bytes',
          gracefulPath: cause?.gracefulPath ?? null,
          ...(cause?.field != null ? { field: cause.field } : {}),
        };
      }
      return { code: 'invalid_run_command', message: 'arguments do not satisfy the command contract for this tool' };
    }
    // The bounded-wait bound covers the fleet spellings of the wait/follow operations (the
    // minted baton_run_* lifecycle siblings left with the #566 composition restore; the
    // canonical dot spellings share the fleet definitions and never re-enter this guard).
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
      || !record(args.args) || !nonempty(args.workerId) || !nonempty(args.note)
      || !Number.isSafeInteger(args.expectedFence) || Object.hasOwn(args, 'ref') || Object.hasOwn(args, 'cursor') || Object.hasOwn(args, 'claim'))) return 'invalid_capability_invocation';
  }


  if (name === 'baton_knowledge_recall' && (!record(args.query)
    || (Object.hasOwn(args, 'reader') && !record(args.reader))
    || (Object.hasOwn(args, 'options') && !record(args.options)))) return 'invalid_knowledge_recall';
  if (name === 'baton_knowledge_horizon' && (!['task', 'workflow', 'project'].includes(args.kind)
    || !nonempty(args.id))) {
    return 'invalid_knowledge_horizon';
  }
  // MCP-W1/W2/W3 (mcp-packaging-decisions v1.0): hand-rolled shape guards for the ordinary-surface
  // doctor and settlement tools (the reflex discipline — Part I: no schema evaluator, hand-rolled
  // validation stays the authority). These tools are explicit `_dispatch` branches, so their args
  // never pass through validateApplicationCommandArgs.
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
  if (name === 'baton_run_scratchpad_append') {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId ?? '')
      || typeof args.scope !== 'string' || !/^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$/.test(args.scope)
      || (Object.hasOwn(args, 'kind') && !['note', 'plan', 'doubt', 'link'].includes(args.kind))
      || !Object.hasOwn(args, 'body') || args.body === null || args.body === undefined
      || (typeof args.body !== 'string' && typeof args.body !== 'object')
      || (Object.hasOwn(args, 'idempotencyKey')
        && (typeof args.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(args.idempotencyKey)))) {
      return 'invalid_scratchpad_append';
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
  // Issue #99/#179: the accessor's shape guards - the resultSha XOR runId law is not
  // expressible in the schema() idiom; v1 is sha1-only.
  if (name === 'baton_run_resultpin'
    && (typeof args.runId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(args.runId))) {
    return 'invalid_run_resultpin';
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
    if (!Number.isSafeInteger(this.maxWaitMs) || this.maxWaitMs <= 0) throw new TypeError('maxWaitMs must be a positive safe integer');
    // Issue #294: server-initiated frames ride the SAME transport as responses. A server whose
    // driver attached no sink refuses a wake subscription instead of accepting one it could never
    // deliver; the stdio driver and the resident bridge both attach theirs.
    this.notificationSink = null;
    if (opts.notificationSink !== undefined && opts.notificationSink !== null) {
      this.attachNotificationSink(opts.notificationSink);
    }
    // Issue #314 (docs/49 §5, §10): a long verb's answer hands back a wake subscription, and that
    // subscription delivers through THIS session's transport — the same `notify` an explicit
    // `baton_wakes subscribe` delivers through. An application that admits a session delivery sink
    // (the resident bridge facade) is handed it here, late-bound to whatever sink the driver
    // attaches, so the handoff and the explicit verb share ONE session sink.
    if (typeof this.application?.attachWakeDelivery === 'function') {
      this.application.attachWakeDelivery((frame) => this._wakeNotificationSink(frame));
    }
    // Issue #529 (docs/54 §4): the wake subscription this session takes from its own bridge
    // configuration. The deployment declares that configuration as part of the seat's bridge
    // environment and the entry that knows the session's environment passes what it read; the
    // server itself reads no global. Null means this session takes no auto-subscription.
    this.autoWake = opts.autoWake === undefined || opts.autoWake === null ? null : clone(opts.autoWake);
    if (this.autoWake !== null && !record(this.autoWake)) {
      throw new TypeError('MCP auto wake configuration must be an object');
    }
    this.autoWakeReceipt = null;
    this.lifecycle = 'new';
    const surfaceTools = this.surface === 'application' ? ORDINARY_APPLICATION_TOOL_DEFINITIONS
      : this.surface === 'advanced' ? ADVANCED_TOOL_DEFINITIONS : TOOL_DEFINITIONS;
    // A host that cannot dispatch a command (the resident bridge, whose authority is the wire
    // card) never advertises the tool that would dispatch it: an agent is shown exactly the tools
    // it can call (#270). Kernel tools carry no application command and are not filtered here.
    if (opts.admitsCommand !== undefined && opts.admitsCommand !== null && typeof opts.admitsCommand !== 'function') {
      throw new TypeError('admitsCommand must be a function when supplied');
    }
    this.admitsCommand = opts.admitsCommand ?? null;
    const selectedTools = this.admitsCommand
      ? surfaceTools.filter((tool) => { const command = commandForTool(tool.name); return !command || this.admitsCommand(command); })
      : surfaceTools;
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
  }

  async close() {
    if (this._closePromise) return this._closePromise;
    const closing = Promise.resolve().then(async () => {
      this.lifecycle = 'closed';
      // The session is over: whatever upstream wake attachment it held is released here, for an
      // unowned bridge application exactly as for an owned one (the connection is the session's).
      try { this.application?.closeWakes?.(); }
      catch { /* the transport is closing; the attachment dies with the process either way */ }
      // Issue #529 (docs/54 §4): the auto-subscription lives on that same plane, so the session's
      // close releases it with everything else the plane held.
      this.autoWakeReceipt = null;
      if (this.application === null || !this.applicationOwned) {
        return Object.freeze({ schemaVersion: 1, state: 'transport_closed', applicationOwned: false });
      }
      return this.application.shutdown(this.shutdownPrincipal);
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

  /** Issue #294: hand one frame to the client this session serves. The MCP transport owns the
   * write; the wake plane owns the attachment, so this is the only seam between them. */
  notify(method, params) {
    if (this.notificationSink === null) {
      throw Object.assign(
        new Error('this MCP transport cannot deliver server notifications'),
        { code: 'wake_notifications_unavailable', wireSafe: true },
      );
    }
    return this.notificationSink({ jsonrpc: '2.0', method, params: normalized(params) });
  }

  attachNotificationSink(sink) {
    if (sink !== null && typeof sink !== 'function') throw new TypeError('MCP notification sink must be a function');
    this.notificationSink = sink;
  }

  /** Issue #294/#529: the ONE sink a wake frame reaches this session's client through — an
   * explicit subscription, a long verb's handoff, and the auto-subscription all deliver here. */
  _wakeNotificationSink(frame) {
    return this.notify(WAKE_NOTIFICATION_METHOD, frame);
  }

  /** Issue #529 (docs/54 §4): the auto-subscription is taken at the connection, through the same
   * facade entry the explicit `baton_wakes_subscribe` verb calls — opened by the server instead of
   * the model, so matching frames arrive with no tool call. Only a session that holds `observe`
   * reads the stream (the verb's own authority), and a stream that cannot be attached never costs
   * the session its handshake: the greeting names the state instead. Returns the greeting sentence
   * this session's initialize carries, empty when the session takes no auto-subscription. */
  async _autoSubscribeWake() {
    if (this.autoWake === null) return '';
    if (!Array.isArray(this.principal.capabilities)
      || !this.principal.capabilities.includes('observe')) return '';
    if (this.notificationSink === null) {
      return ' Auto wake subscription unavailable: this transport cannot deliver server notifications.';
    }
    if (typeof this.application?.wakeSubscribe !== 'function') {
      return ' Auto wake subscription unavailable: this connection serves no wake stream.';
    }
    let receipt;
    try {
      receipt = await this.application.wakeSubscribe(
        clone(this.autoWake), (frame) => this._wakeNotificationSink(frame));
    } catch (cause) {
      const code = typeof cause?.code === 'string' && cause.code.length > 0
        ? cause.code : 'wake_stream_unavailable';
      return ` Auto wake subscription unavailable: ${code}.`;
    }
    this.autoWakeReceipt = receipt;
    const swarms = Array.isArray(receipt?.swarms) ? receipt.swarms : [];
    return ` Auto-subscribed to the wake stream${swarms.length === 0 ? '' : ` for swarm ${swarms.join(', ')}`}`
      + ` as ${receipt.subscriptionId}; every matching row arrives as a notification.`
      + ' Narrow it with baton_wakes_subscribe, or stop it with baton_wakes_unsubscribe.';
  }

  _authority(name, args) {
    const p = this.principal;
    // U-E1 (#287, 2026-09-14 audit): `expiresAt: null` is the explicit PROCESS-LIFETIME
    // principal — the process IS the session, so its validity is the running process (close()
    // ends what it serves), never a hardcoded duration. Every other absent, malformed, or
    // elapsed expiry still refuses.
    const expiresAt = p.expiresAt === null ? null : Date.parse(p.expiresAt);
    if (!nonempty(p.userId) || !nonempty(p.sessionId) || p.revoked === true
      || (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= this.now()))) return 'unauthenticated';
    const requiredCapabilities = Array.isArray(CAPABILITY[name]) ? CAPABILITY[name] : [CAPABILITY[name]];
    if (!Array.isArray(p.capabilities)
      || !requiredCapabilities.every((capability) => p.capabilities.includes(capability))) return 'forbidden';
    // U-E11/U-I2 (issue #288): the repo axis is its OWN refusal (`repo_not_served`), never a
    // bare `forbidden` — an agent must be able to tell "you lack a capability" from "you named
    // a repository this deployment does not serve". _authorityRefusal composes the wire shape.
    if (!this.repoIds.has(args.repoId) || !Array.isArray(p.repoIds) || !p.repoIds.includes(args.repoId)) return 'repo_not_served';
    if (this.isPrincipalActive && !this.isPrincipalActive(p, { tool: name, repoId: args.repoId })) return 'unauthenticated';
    return null;
  }

  /** The wire shape for an _authority refusal (U-E11/U-I2): a capability shortfall reuses the
   * exact {required, held, missing} sentence shape the action gate composes; a repo refusal
   * names the requested repoId and the served set. Bare-string refusals (unauthenticated) keep
   * the code-only envelope. Strings stay the _authority contract: surface-mcp-authority.mjs
   * consumes the seam directly. */
  _authorityRefusal(code, name, args) {
    if (code === 'forbidden') {
      const requiredCapabilities = Array.isArray(CAPABILITY[name]) ? CAPABILITY[name] : [CAPABILITY[name]];
      const required = [...requiredCapabilities].sort();
      const held = Array.isArray(this.principal.capabilities) ? [...this.principal.capabilities].sort() : [];
      const missing = required.filter((capability) => !held.includes(capability));
      return toolError('forbidden', `this principal lacks the ${missing.join(', ')} capability the tool requires`, { required, held, missing });
    }
    if (code === 'repo_not_served') {
      const served = [...this.repoIds].sort();
      const servedList = served.map((repoId) => JSON.stringify(repoId)).join(', ');
      // Mirror the gate's own order: the deployment-routing truth outranks the principal-scoping
      // truth (both can hold for one call; the deployment answer is the one an agent retries on).
      if (!this.repoIds.has(args.repoId)) {
        return toolError('repo_not_served',
          `this deployment does not serve repoId ${JSON.stringify(args.repoId)}; it serves ${servedList}`,
          { repoId: args.repoId ?? null, served });
      }
      return toolError('repo_not_served',
        `this principal is not scoped to repoId ${JSON.stringify(args.repoId)}; this deployment serves ${servedList}`,
        { repoId: args.repoId ?? null, served });
    }
    return toolError(code);
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
      // Issue #529 (docs/54 §4): the session's auto-subscription is taken HERE — at the connection,
      // before the greeting is composed — so the greeting can name what it opened beside the escape
      // hatch. The handshake stays a success whatever the stream answers.
      const wakeSentence = await this._autoSubscribeWake();
      // U-G10 (#287): the greeting states the served repoId — the one value every tool call
      // takes — so a client learns the coordinate from the server instead of guessing it. A
      // connection that BINDS the coordinate (the resident bridge) derives it per call and
      // refuses a supplied one, so the sentence states that instead. A multi-repo server says
      // nothing rather than naming one of many.
      const servedRepoId = this.repoIds.size === 1 ? [...this.repoIds][0] : null;
      const repoSentence = servedRepoId === null ? ''
        : this.bindApplicationContext
          ? ` Served repoId: ${servedRepoId} — this connection is bound to that repository and the server derives the coordinate itself, so never pass repoId.`
          : ` Served repoId: ${servedRepoId} — pass this exact value as repoId on every tool call.`;
      return protocolResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'baton', version: '0.1.0' },
        instructions: `${flipFace('smile')} baton — reflexive multi-agent orchestration. Waves are the primary surface (start/attach/steer); settlement lanes arrive through the envelope tools. See MCP.md.${repoSentence}${wakeSentence}`,
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
    if (id === undefined || !record(params) || !nonempty(params.name)) return protocolError(id, -32602, 'Invalid params');
    if (!this.toolNames.has(params.name)) {
      // U-F4 (issue #288): the protocol-level code stays -32602 (the MCP tools/call contract for
      // an unknown tool) but the refusal is TYPED: the message names the requested name and the
      // nearest advertised tool, and the data carries the {code, requested, nearest, tools}
      // refusal so the caller can retry against the real surface without a tools/list round trip.
      const tools = [...this.toolNames].sort();
      const nearest = nearestToolName(params.name, tools);
      return protocolError(id, -32602,
        nearest === null
          ? `unknown tool ${params.name}; this surface advertises no tools`
          : `unknown tool ${params.name}; the nearest advertised tool is ${nearest}`,
        { code: 'unknown_tool', requested: params.name, nearest, tools });
    }
    const suppliedArgs = params.arguments ?? {};
    if (this.bindApplicationContext && record(suppliedArgs)
      && (Object.hasOwn(suppliedArgs, 'repoId') || Object.hasOwn(suppliedArgs, 'idempotencyKey'))) {
      try { this._audit('tool_invalid', params.name, {}, 'invalid_arguments'); }
      catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      // The refusal names the field and the rule: on a bound surface the server derives these.
      const bound = ['repoId', 'idempotencyKey'].filter((field) => Object.hasOwn(suppliedArgs, field));
      return protocolResult(id, toolError('invalid_arguments',
        `${bound.join(' and ')} ${bound.length === 1 ? 'is' : 'are'} bound by the server on this surface and must not be supplied`,
        { boundFields: bound }, bound[0]));
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
          request: suppliedArgs,
        })}`,
      } : {}),
    } : suppliedArgs;
    const invalid = validateArguments(params.name, args, this.maxWaitMs);
    if (invalid) {
      // #160 R1/M3: validateArguments may return a STRUCTURED refusal ({code, field, message}) when
      // a named application-validator refusal or a wave-member pointer must ride the wire.
      const refusalCode = typeof invalid === 'string' ? invalid : invalid.code;
      try { this._audit('tool_invalid', params.name, args, refusalCode); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      // Issue #150: when the structured refusal carries coaching fields (cap, actual, unit,
      // gracefulPath), construct the detail so the coaching payload survives the MCP wire.
      if (typeof invalid !== 'string' && COACHING_REFUSAL_CODES.has(invalid.code)) {
        return protocolResult(id, toolError(invalid.code, invalid.message, {
          ...(invalid.field != null ? { field: invalid.field } : {}),
          ...(invalid.cap != null ? { cap: invalid.cap } : {}),
          ...(invalid.actual != null ? { actual: invalid.actual } : {}),
          unit: invalid.unit ?? 'bytes',
          gracefulPath: invalid.gracefulPath ?? null,
        }));
      }
      return protocolResult(id, typeof invalid === 'string'
        ? toolError(invalid)
        : toolError(invalid.code, invalid.message, null, invalid.field));
    }
    const refused = this._authority(params.name, args);
    if (refused) {
      try { this._audit('tool_refused', params.name, args, refused); } catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, this._authorityRefusal(refused, params.name, args));
    }
    if (APPLICATION_TOOL[params.name] && !this.application) {
      try { this._audit('application_unavailable', params.name, args); }
      catch { return protocolResult(id, toolError('temporarily_unavailable')); }
      return protocolResult(id, toolError('application_unavailable'));
    }
    // MCP-W3 (mcp-packaging-decisions v1.0): deployment.doctor is quota-free — it is the
    // route-picking prerequisite, and charging quota would blind callers exactly when they need
    // it (glm #6).
    let quota = { ok: true };
    if (params.name !== 'baton_deployment_doctor') {
      const debitCount = 1;
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
    return protocolResult(id, await this._callTool(params.name, args, id));
  }

  async _callTool(name, args, requestId) {
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
        const refused = ['run.follow', 'run.wait'].includes(APPLICATION_TOOL[name]) ? this._authority(name, args) : null;
        if (refused) {
          this._audit('tool_refused_after_wait', name, args, refused);
          return this._authorityRefusal(refused, name, args);
        }
        const outcome = toolResult(value);
        this._audit('tool_completed', name, args);
        return outcome;
      } catch (cause) {
        try { this._audit('tool_failed', name, args, 'command_failed'); }
        catch { return toolError('temporarily_unavailable'); }
        // Part F: read-only reflex tools (not APPLICATION_TOOL-registered — Part A.2) map typed
        // codes too, never the generic 'command_failed'.
        if (name !== 'fleet_goal_plan_status' && !APPLICATION_TOOL[name]
          && !REFLEX_READ_ONLY_TOOLS.has(name) && !ORDINARY_EXPLICIT_TOOLS.has(name)) {
          return toolError('command_failed', typeof cause?.code === 'string' ? (cause?.message ?? null) : null);
        }
        // The two message-elevation verbs surface their ONE typed code verbatim (application_
        // unauthorized), never the generic 'forbidden' mapping.
        if ((name === 'baton_run_message_receipt' || name === 'baton_run_scratchpad_elevate')
          && cause?.code === 'application_unauthorized') {
          return toolError('application_unauthorized', cause?.message ?? null);
        }
        // #160 R2 (error-actionability-2026-08-13/contract-fold.md §2 D4 R2): the LANE-CRAFTED
        // families ride their message + constructed detail on this observe path too (M4 — a
        // baton_waves_progress wave_member_invalid must carry {actual, cap, cause, role}); an
        // untyped internal throw keeps the MN1/MN8 sanitization law — never a private provider
        // detail in a tool error.
        return laneCraftedToolError(cause);
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
      }, { actor, key: `mcp.admit:${scopeKey}` });
    } catch { return toolError('temporarily_unavailable'); }
    if (!admission.ok) return toolError(admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_call');
    if (admission.result === 'replay') {
      if (admission.call.status === 'admitted' && name === 'fleet_drain') {
        const callId = admission.call.callId;
        const admittedActor = `mcp:${admission.call.userId}:${admission.call.sessionId ?? this.principal.sessionId}`;
        let outcome;
        try { outcome = toolResult(await this._dispatchDrain(args, admittedActor, callId)); }
        catch (cause) {
          outcome = laneCraftedToolError(cause);
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
        try {
          outcome = toolResult(await (APPLICATION_TOOL[name]
            ? this._dispatchApplicationOnce(
              name, args, admittedActor, admittedCallId, admittedPrincipal,
            )
            : this._dispatch(name, args, admittedActor, admittedCallId, admittedPrincipal)));
        }
        catch (cause) {
          outcome = laneCraftedToolError(cause);
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
            ...(sessionAuthority ? { sessionAuthority: clone(sessionAuthority) } : {}),
          });
        } catch (cause) { return laneCraftedToolError(cause); }
      }
      if (GOAL_PLAN_MUTATIONS.has(name)) {
        const prior = admission.call.outcome;
        if (!record(prior?.structuredContent)) {
          // U-F3 (issue #288): the admitted record cannot be read back, and a retry replays the same
          // unreadable record — so this refusal states the permanent verdict and the one way forward.
          return toolError('command_outcome_unknown', null, null, null, {
            retryable: false,
            action: 'the admitted call\'s recorded outcome is unreadable and replaying it cannot repair it: re-issue the command with a fresh idempotencyKey',
          });
        }
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
          )
          : this._dispatch(name, args, actor, callId)));
    }
    catch (cause) {
      // #132 D5.2 + #160 R2 (error-actionability-2026-08-13/contract-fold.md §2 D4 R2): a TYPED
      // lane refusal carries the lane's OWN message byte-identically plus the constructed detail —
      // {actual, cap, cause, role} for wave_member_invalid / wave_not_found (W6/F4), a root-field
      // coaching triple {cap, actual, unit, gracefulPath} for the coaching family, the lane's own
      // detail for workflow_* (B3). An untyped internal throw keeps the MN1/MN8 sanitization law —
      // code-only, never a private provider detail in a tool error (the GP7/GP8 pin — an arbitrary
      // typed throw's message is NOT safe).
      outcome = laneCraftedToolError(cause);
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

  _dispatchApplicationOnce(name, args, actor, callId, principal) {
    const existing = this._applicationDispatches.get(callId);
    if (existing) return existing;
    const pending = Promise.resolve().then(
      () => this._dispatch(name, args, actor, callId, principal),
    );
    this._applicationDispatches.set(callId, pending);
    return pending;
  }


  async _dispatch(name, args, actor, callId, principal = this.principal) {
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
        },
      );
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
    // MCP-W3: deployment.doctor — quota-free (handle), per-call FRESH doctorReadiness, secret
    // material stripped at the surface (canary-pinned by MP10).
    else if (name === 'baton_deployment_doctor') {
      value = await this._freshDoctorReadiness();
    }
    // Issue #99/#179: the accessor's dispatch branches - the CONNECTION-derived principal;
    // repoId is the transport's scope echo, never a facade arg.
    else if (name === 'baton_run_resultpin') {
      value = await this.application.command('run.resultpin', {
        runId: args.runId,
      }, {
        actor: actor ?? `mcp:` + principal.userId + `:` + principal.sessionId,
        principalId: principal.userId,
        sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    // MCP-W2: the settlement tools via the S-2 sessionAuthority envelope. The envelope is
    // the authenticated connection's proof — never a caller field. The settlement lease requires
    // the settlement capability class (already enforced by _authority).
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
      try {
        value = await this.application.command('run.message.send', {
          ...(Object.hasOwn(args, 'runId') ? { runId: args.runId } : {}),
          ...(Object.hasOwn(args, 'workerId') ? { workerId: args.workerId } : {}),
          kind: args.kind, body: args.body,
          ...(Object.hasOwn(args, 'budget') ? { budget: args.budget } : {}),
        }, {
          actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
          principalId: principal.userId, sessionId: principal.sessionId,
        }, this._applicationDispatchContext(args, callId, principal));
      } catch (cause) { throw markedMessageSendSizeRefusal(cause, args.body); }
    }
    else if (name === 'baton_run_message_receipt') {
      value = await this.application.command('run.message.receipt', { messageId: args.messageId }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
    }
    else if (name === 'baton_run_attention_watch') {
      // Ruling on #108: a cursor-0 caller gets the SAME refusal as one at cursor > 0, so the
      // fabricated empty page is gone. The lane's authority is principal-shaped and its refusal is
      // typed; converting `attention_scope_forbidden` into `{afterCursor: 0, throughCursor: 0,
      // reasons: []}` answered \"no news\" to a caller whose scope was refused AND rewound the
      // requested cursor to 0 — the rewind the surface-watch leg already refuses by name
      // ('refusing silent empty fallback', production-mcp-convergence.mjs). A refusal crosses as
      // itself, and an authorized scope still pages through the lane untouched.
      value = await this.application.command('run.attention.watch', {
        runId: args.runId,
        ...(Object.hasOwn(args, 'kind') ? { kind: args.kind } : {}),
        ...(Object.hasOwn(args, 'cursor') ? { cursor: args.cursor } : {}),
      }, {
        actor: actor ?? `mcp:${principal.userId}:${principal.sessionId}`,
        principalId: principal.userId, sessionId: principal.sessionId,
      }, this._applicationDispatchContext(args, callId, principal));
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
    else if (name === 'baton_run_scratchpad_append') {
      value = await this.application.command('run.scratchpad.append', {
        runId: args.runId, scope: args.scope,
        ...(Object.hasOwn(args, 'kind') ? { kind: args.kind } : {}),
        body: clone(args.body),
        ...(Object.hasOwn(args, 'idempotencyKey') ? { idempotencyKey: args.idempotencyKey } : {}),
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
    else if (name === 'fleet_kill') value = await this.coordinator.kill(args.workerId, actor, { expectedFence: args.expectedFence });
    else if (name === 'fleet_drain') value = await this.coordinator.drain({ actor, repoId: args.repoId, idempotencyKey: `mcp.call:${callId}` });

    else if (name === 'baton_knowledge_recall') {
      value = this.coordinator.recallKnowledge(args.query, args.reader ?? {}, {
        ...(args.options ?? {}), actor, idempotencyKey: `mcp.call:${callId}`,
      });
    }
    else if (name === 'baton_knowledge_horizon') {
      if (args.kind === 'task') value = this.coordinator.taskHorizon(args.id);
      else if (args.kind === 'workflow') {
        value = this.coordinator.workflowHorizon(args.id, { viewer: 'orchestrator' });
      } else value = this.coordinator.projectHorizon(args.repoId);
    }
    // Issue #294: the wake tool family's direct ports. None of them is a bridged application
    // command (the resident's wire card admits commands, and a wake attachment is not one), so each
    // reaches its facade method exactly as deployment.doctor does. The subscription's delivery sink
    // is THIS server's transport, so a frame reaches the client that opened the subscription.
    else if (name === 'baton_wakes_subscribe') {
      if (typeof this.application?.wakeSubscribe !== 'function') throw wakeStreamUnavailable('subscribe to');
      // The session's one delivery sink carries every wake row this session's subscriptions admit,
      // under the ONE wake notification method.
      value = await this.application.wakeSubscribe(clone(args), (frame) => this._wakeNotificationSink(frame));
    }
    else if (name === 'baton_wakes_unsubscribe') {
      if (typeof this.application?.wakeUnsubscribe !== 'function') throw wakeStreamUnavailable('stop');
      value = this.application.wakeUnsubscribe(clone(args));
    }
    else if (name === 'baton_wakes_since') {
      if (typeof this.application?.wakeSince !== 'function') throw wakeStreamUnavailable('read');
      value = await this.application.wakeSince(clone(args));
    }
    if (value?.result === 'stale_fence') throw Object.assign(new Error('stale fence'), { mcpCode: 'stale_fence' });
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


  // The proof comes from the authenticated connection. This adapter never reconstructs it from
  // caller-named principal/session identifiers or from the lease's own stored digest.
  _sessionAuthorityContext(principal) {
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
    // D5 (contract-launch 2026-08-14/redrive3): a NON-RECORD readiness REFUSES typed at this seam —
    // the #202 class. A verbatim pass-through would serialize as the `{result: <text>}` envelope
    // (GT-L10); the closed refusal shape is `{actual: typeof}` (contract §3). wireSafe carries the
    // composed message + detail through the observe-path mapping, and the PERMANENT_TOOL_CAUSES row
    // states the verdict: the producer is broken, and no retry repairs it.
    if (!record(value)) {
      throw Object.assign(
        new Error(`deployment_readiness_invalid: the doctor lane produced a ${typeof value} readiness where a record is required`),
        { code: 'deployment_readiness_invalid', wireSafe: true, detail: { actual: typeof value } },
      );
    }
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
  // Issue #294: the wake subscriptions this session holds deliver through this exact output.
  server.attachNotificationSink((frame) => writeFrame(output, frame));
  let buffered = Buffer.alloc(0);
  const processLine = async (line) => {
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
        if (newline === -1) {
          const tail = bytes.subarray(offset);
          buffered = Buffer.concat([buffered, tail]);
          break;
        }
        const segment = bytes.subarray(offset, newline);
        let line = buffered.length === 0 ? segment : Buffer.concat([buffered, segment]);
        if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
        await processLine(line);
        buffered = Buffer.alloc(0);
        offset = newline + 1;
      }
    }
    if (buffered.length > 0) await processLine(buffered);
  } finally {
    await server.close();
  }
}

// CS-1/CS-2: executable MCP profile inventories (never regex extraction alone).
export function mcpApplicationToolNames() {
  return ORDINARY_APPLICATION_TOOL_DEFINITIONS.map((tool) => tool.name).sort();
}
/** Issue #156 D1 step 1 / D3: the served-command set of the default application profile — the
 * unique commands the ordinary entries route, sorted. The red suite's parity derivation reads
 * this (never a hand list) and checks the D3 law: every web-bus command is served. */
export function mcpApplicationCommandNames() {
  return [...new Set(ORDINARY_APPLICATION_ENTRIES.map(([, command]) => command))].sort();
}
/** Issue #156 D1 step 1 / D3: the frozen ordinary dispatch map (tool → command). The red suite's
 * dispatch-binding pin reads it: every uncovered op's sibling tool routes through APPLICATION_TOOL. */
export function mcpApplicationDispatch() {
  return APPLICATION_TOOL;
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
