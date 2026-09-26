// application-observation.mjs — issue #259 slice 15: the application's observation bucket.
//
// The 80 observation members of BatonApplication — the run, workflow, context and episode
// projections with the projection helpers they compose — move here verbatim under the bare
// `application` receiver: the slice-3 precedent (application-briefing.mjs) extended by slice
// 13's authority-free runtime-API module. BatonApplication owns no log, no coordination
// field and no recorder; its members reach durable state through the driver's faces
// (`application.driver.coordination`, `application.driver.coordinator`), so no port rides
// along and no recording reroutes — each read reaches the same store face in the same order.
//
// The module-scope helper closure the moved bodies read (142 declarations)
// relocates with them in source order; the 31 import bindings they
// share re-import from their original modules. The host imports back exactly the helpers its
// staying code still reads and re-exports the ones its CLI/MCP/Web consumers import from it.
// One-way at the file level: this module imports neither application.mjs nor coordinator.mjs.
//
// Moved verbatim from application.mjs: same names, same parameter lists, same arities; the
// class keeps same-name delegates, so the command dispatch table and every caller are untouched.
import { APPLICATION_SEMANTIC_REGISTRY, PROGRESS_SILENCE_THRESHOLD_MS, projectTypedTerminalCause } from './application-semantics.mjs';
import { compareCanonicalStrings } from './canonical-order.mjs';
import { contextProgramIsPure } from './context-authority.mjs';
import { contextEffectCallIdentity, contextEffectNodeBinding, contextEffectRetryCallIdentity } from './context-call.mjs';
import { normalizeContextProgram } from './context-program.mjs';
import { goalPlanPage, normalizePlanRequest, planRouteAuthorityState, planRouteMatches, planSingleExactRoute } from './goal-plan.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { SECRET_SHAPED_TEXT, wrapProse } from './messages.mjs';
import { hasNorthboundCapabilityAuthority } from './northbound-capability-authority.mjs';
import { projectRunTimelinePage } from './run-timeline.mjs';
import { normalizeVerifierFailureCapsule, sanitizeVerifierDiagnosticText } from './verifier-diagnostics.mjs';
import { normalizeWorkerPolicyRequest } from './worker-policy.mjs';
import { validateWorkflowDefinitionLegacy, validateWorkflowDefinitionV3, workflowAttempt, workflowAttemptLogicalRole, workflowAttemptRoute, workflowCatalogRole } from './workflow-definition.mjs';
import { LEGACY_WORKFLOW_POLICY, normalizeWorkflowPolicy } from './workflow-policy.mjs';
import { normalizeWorkflowRevision } from './workflow-revision.mjs';
import { createHash } from 'node:crypto';

// View ceilings imported from the registry (Decision 8: the registry is the only source; no
// module re-declares a cataloged lane's byte literal).
const MAX_PROFILE_BYTES = FRAME_LIMITS['view.profile.bytes'].value;
export const APPLICATION_PROFILE_RECORD_KIND = 'application.profile_registered';
export const APPLICATION_PROFILE_RECORD_ACTOR = 'application:profile-registry';
export const APPLICATION_WORKFLOW_RECORD_KIND = 'application.workflow_definition_bound';
export const APPLICATION_WORKFLOW_RECORD_ACTOR = 'application:workflow-registry';
export const APPLICATION_WORKFLOW_SELECTION_RECORD_KIND = 'application.workflow_candidate_selected';
export const APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND = 'application.workflow_feedback_recorded';
export const APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND = 'application.workflow_member_stop_admitted';
export const APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND = 'application.workflow_member_stop_completed';
// #313: the last hardcoded ceiling of the run-view family — derived from the ONE limits
// registry exactly like the byte bound beside it (Decision 8's no-re-declare law).
export const MAX_RUN_RECORDS = FRAME_LIMITS['view.run.records'].value;
export const MAX_RUN_VIEW_BYTES = FRAME_LIMITS['view.run.bytes'].value;
export const MAX_ATTENTION = 64;
// The displayed attention/child-row page budget: a quarter of the view byte ceiling, so the rows
// plus the rest of the view stay inside the bound the response is finalized against. Derived from
// the deployment ceiling, never a row count (2026-09-14 audit, U-E10). The remainder is always
// reachable through the section's own cursor — a page is a view, never a limit.
export const ATTENTION_PAGE_BYTES = Math.floor(MAX_RUN_VIEW_BYTES / 4);
export const MAX_ATTENTION_TEXT_BYTES = FRAME_LIMITS['view.attention_text.bytes'].value;
const MAX_BLOCKED_INTERACTION_SUMMARY_BYTES = FRAME_LIMITS['view.blocked_interaction_summary.bytes'].value;
// Issue #489: the Run view's SHED ladder — the sections a NARROWED read drops, in order, each
// with the depth read that serves it. `view.run.bytes` is the registry's shed-flagged row, and
// the incident was that the refusal fired BEFORE any narrowing: every `baton run show --depth
// outline` refused for the very run the refusal told the operator to narrow, and every
// `recruit --issue` refused because the participant's own start built a view nobody read. The
// ladder is judged only for a caller that asked for a narrowing (`narrow: true`): a step whose
// section is absent, empty or already a reference is skipped, and a step that did not pay is
// rolled back — a shed section is never a silent loss, it is named with its bytes and the read
// that answers it (the view's own `narrowed` record).
export const RUN_VIEW_SHED_STEPS = Object.freeze([
  // The knowledge slice: a projection of the run's seeded facts, re-readable as the outline's
  // candidates count plus the run's own knowledge rows.
  { section: 'knowledge', read: '--depth outline (knowledge.candidatesAwaitingAdmission)',
    shed: (view) => (view.knowledge === null || view.knowledge === undefined ? null
      : { knowledge: null, knowledgeRef: { digest: view.knowledgeDigest ?? null } }) },
  // The activity rows: the bounded worker summaries the execution section carries.
  { section: 'activity', read: '--depth section --section execution',
    shed: (view) => (view.activity === null || view.activity === undefined ? null : { activity: null }) },
  // The evidence rows: the artifacts the episode/verification sections carry.
  { section: 'evidence', read: '--depth section --section verification',
    shed: (view) => (Array.isArray(view.evidence) && view.evidence.length > 0 ? { evidence: [] } : null) },
  // The worker's scratchpad: a Context read of its own, never the view's point.
  { section: 'scratchpad', read: '--depth section --section context',
    shed: (view) => (view.scratchpad === null || view.scratchpad === undefined ? null : { scratchpad: null }) },
  // The Plan subjects the preview and the node rows carry (the plan section serves them whole).
  { section: 'planPreview', read: '--depth section --section plan',
    shed: (view) => (view.planPreview === null || view.planPreview === undefined ? null
      : { planPreview: { planDigest: view.planPreview.planDigest ?? null,
        displayDigest: view.planPreview.displayDigest ?? null } }) },
  { section: 'nodes', read: '--depth section --section plan',
    shed: (view) => (Array.isArray(view.nodes) && view.nodes.length > 0
      ? { nodes: view.nodes.map((node) => ({ key: node.key, state: node.state ?? null,
        taskId: node.taskId ?? null })) } : null) },
  // The objective LAST: it is what the view exists to carry, and the outline serves the goal's own
  // text verbatim — so the text is shed only when carrying it is what makes the view unreadable.
  { section: 'objective', read: '--depth outline',
    shed: (view) => (typeof view.objective !== 'string' ? null
      : { objective: view.objectiveRef ?? { ref: 'goal.objective',
        bytes: view.objectiveBytes ?? Buffer.byteLength(view.objective, 'utf8') } }) },
]);
/** The ONE narrowing an oversize Run view prescribes (issue #489): the depth ladder's first rung.
 * It answers for every run — the outline carries the goal's own text and none of the sections the
 * shed ladder drops — so the remedy the refusal teaches is one the deployment really serves. */
export function runViewNarrowedRead(runId) {
  return typeof runId === 'string' && runId.length > 0
    ? `baton run show ${runId} --depth outline` : '--depth outline';
}
/** Issue #489: the ONE budgeted line a Run view carries in place of the objective's whole text —
 * the objective's FIRST LINE, cut by the ONE `view.role.head` row budget #464 derives for the
 * participant row's `role`. ONE derivation for every Run-view builder, the swarm's participant
 * row and the #469 operation receipt: three surfaces, one cut, so none can disagree about how
 * much of an objective a summary line carries. */
export function objectiveFirstLine(text) {
  const whole = typeof text === 'string' ? text : '';
  const newline = whole.indexOf('\n');
  return capBytesToScalar(newline === -1 ? whole : whole.slice(0, newline),
    FRAME_LIMITS['view.role.head'].value);
}
/** The reach a summary line carries beside it (issue #489): the pointer that names WHERE the
 * whole text lives — the view's own `objective`, the goal's objective — and the byte length a
 * reader did not get. The #464/#469 pair, spelled once for the Run view. */
export function objectiveReach(bytes) {
  return Object.freeze({ ref: 'goal.objective', bytes });
}
/** Issue #489: the Plan-node rows a view carries — each with the objective's REACH in place of a
 * second copy of its text, so a hundred-node run costs a hundred lines, never a hundred briefs. */
export function boundedPlanNodes(nodes, objectiveLine, objectiveBytes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => Object.freeze({
    ...clone(node), objective: objectiveLine, objectiveRef: objectiveReach(objectiveBytes),
  }));
}
export const MAX_SCRATCHPAD_VIEW_BYTES = FRAME_LIMITS['view.scratchpad.bytes'].value;
export const MAX_SCRATCHPAD_VIEW_ITEMS = FRAME_LIMITS['view.scratchpad.items'].value;
export const MAX_SCRATCHPAD_VIEW_CACHE_KEYS = FRAME_LIMITS['view.scratchpad.cache_keys'].value;
// AX-1 rule 3 (issue #10): these operational kinds are real-time provider narration/tool-use
// telemetry — repeated bursts of them are not distinct forward-progress milestones the way a
// committed file edit or a lifecycle/control/verification fact is, so an `evidence.mapped`
// ledger coordinate wrapping one of them must not count as meaningful Run progress.
export const NOISE_TELEMETRY_OPERATIONAL_KINDS = new Set(['content.tool_call', 'content.message']);
// VR9/RV closed verifier projection bounds. Durable verdicts carry exact captured-byte metadata,
// closed enums, and at most one sanitized bounded failure tail. A malformed duration or capsule is
// dropped rather than passed through.
export const VERIFIER_DURATION_BOUND_MS = 7 * 24 * 60 * 60 * 1_000;
const HEX64 = /^[a-f0-9]{64}$/u;
export const VERIFIER_OUTCOMES = Object.freeze(new Set(['passed', 'candidate_failed', 'inconclusive']));
export const VERIFIER_OWNERSHIPS = Object.freeze(new Set(['candidate', 'verifier', 'baseline_or_environment']));
export const VERIFIER_EXECUTION_STATES = Object.freeze(new Set(['completed', 'timed_out', 'output_exceeded', 'unavailable']));
export const VERIFIER_EXECUTION_CODES = Object.freeze(new Set([
  'verification_completed', 'verification_timed_out', 'verification_output_exceeded', 'verification_spawn_unavailable',
]));
// #593: the comparison procedure's own failure — the run wrote no verdict to compare.
export const VERIFIER_DIAGNOSTIC_CODES = Object.freeze(new Set([
  'verification_output_exceeded', 'verification_timed_out', 'verification_spawn_unavailable',
  'verification_claim_diverged', 'verification_red_green_failed', 'verification_coverage_failed',
  'verification_mutation_failed', 'verification_coverage_unavailable', 'verification_mutation_unavailable',
  'verification_passed', 'verification_exit_mismatch', 'verification_not_required',
  'verification_unjudged',
]));
export function sanitizeHex64(value) {
  return typeof value === 'string' && HEX64.test(value) ? value : null;
}
export function closedEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}
export const RESULT_POLICY_CONSTRAINT_PREFIX = 'Baton objective/result policy ';
// The unqualified marker predates explicit resultIntent and must remain replayable as
// compatibility evidence. New explicit requests use a distinct reserved namespace so
// recomputed historical manifests retain their schema-v1 identity.
const LEGACY_READ_ONLY_RESULT_CONSTRAINT = `${RESULT_POLICY_CONSTRAINT_PREFIX}read_only_evidence_v1`;
export const EXPLICIT_RESULT_CONSTRAINTS = Object.freeze({
  change: `${RESULT_POLICY_CONSTRAINT_PREFIX}explicit change_v1`,
  read_only_evidence: `${RESULT_POLICY_CONSTRAINT_PREFIX}explicit read_only_evidence_v1`,
});
// The durable marker kind proving a run has a live steering driver. Rides the generic
// `driver.recorded` envelope; no dedicated projection map (docs/35 §2.2 rule 4: "stays an
// event log"). Its ONLY consumer in 31-a is the degenerate-auto-settle liveness scan.
export const APPLICATION_STEERING_REGISTERED_KIND = 'steering.registered';
export const APPLICATION_WAVE_DRIVER_DETACHED_KIND = 'wave.driver_detached';
// The `action.do` envelope fields each kind pre-fills (2026-09-14 audit, U-E5). They are
// SERVER-DERIVED — `requestId` is the resolved action target's own identity and `response` is the
// payload shape the action consumes — so act() accepts them beside the schema's own properties.
// A kind absent from this table pre-fills nothing and accepts nothing extra.
export const ACTION_INPUT_ENVELOPE = Object.freeze({
  approve_plan: Object.freeze(['planDigest']),
  answer_approval: Object.freeze(['requestId', 'response']),
  answer_question: Object.freeze(['requestId', 'response']),
  answer_decision: Object.freeze(['requestId', 'response']),
  nudge_turn: Object.freeze(['requestId', 'response']),
  wait_turn: Object.freeze(['requestId', 'response']),
  claim_turn: Object.freeze(['requestId', 'response']),
});
// The turn kinds' pre-filled response discriminator (the coordinator's own vocabulary).
export const ACTION_TURN_RESPONSE_KIND = Object.freeze({
  nudge_turn: 'continue', wait_turn: 'wait', claim_turn: 'settle',
});
export const READ_ONLY_RESULT_DEFINITION = Object.freeze([
  'A bounded evidence-backed textual/result capsule answers the declared read-only objective.',
  'Sources, derivations, contradictions, verification, and cleanup remain inspectable.',
]);
export const EPISODE_TOPICS = Object.freeze([
  'outline', 'output', 'sources', 'derivations', 'contradictions', 'trace', 'route',
  'verification', 'result', 'cleanup', 'help',
]);
// Provider execution can settle while the application Run remains open for result finalization.
// These closed sets intentionally model separate lifecycles. They record the still-legacy state
// machine's phase literals verbatim (so `.has(view.phase)` resolves unchanged, preserving every
// admission and terminality decision per §2); `closed` is deleted as a dead string (docs/36 §7.1,
// M2). The registry L4 predicates (providerSettled/applicationTerminal) own the canonical
// vocabulary; the outward-facing surfaces resolve through them.
export const PROVIDER_EXECUTION_SETTLED_PHASES = new Set([
  'work_completed', 'selection_required', 'candidate_selected', 'completed', 'failed', 'inconclusive', 'cancelled', 'denied', 'stopped',
  // #102 Decision 6: a quorum-reached partial cell rest is settled provider truth.
  'degraded',
]);
export const APPLICATION_RUN_TERMINAL_PHASES = new Set([
  'completed', 'failed', 'inconclusive', 'cancelled', 'denied', 'stopped',
  // #102 Decision 6: the degraded quorum terminal joins the closed terminal set.
  'degraded',
]);
/**
 * The `action.do` block the served view mints for one action kind (2026-09-14 audit, U-E5/U-I7).
 * It is built from the SAME envelope table act() admits, so the ready-to-send block is accepted by
 * construction:
 *   - approve_plan carries the displayed planDigest (verified against the target);
 *   - the answer and turn kinds carry the exact target identity (`requestId`), never a caller-made
 *     one, plus the response payload in the action's own vocabulary. The answer kinds' payload
 *     starts as the schema's own declared defaults, so a caller fills only what the schema leaves
 *     open; the turn kinds carry their coordinator response kind (`continue`/`wait`/`settle`).
 */
export function actionDoInputs(kind, target, inputSchema) {
  const envelope = ACTION_INPUT_ENVELOPE[kind] ?? [];
  if (envelope.includes('planDigest')) return { planDigest: target?.planDigest ?? null };
  if (!envelope.includes('requestId')) return {};
  const turnKind = ACTION_TURN_RESPONSE_KIND[kind] ?? null;
  const defaults = Object.fromEntries(Object.entries(inputSchema?.properties ?? {})
    .filter(([, schema]) => schema !== null && typeof schema === 'object' && schema.default !== undefined)
    .map(([field, schema]) => [field, clone(schema.default)]));
  return {
    requestId: turnKind === null ? (target?.requestId ?? null) : (target?.pauseId ?? null),
    response: turnKind === null ? defaults : { kind: turnKind, ...defaults },
  };
}
/**
 * The largest prefix of `rows` whose serialized size stays inside `budgetBytes`, plus the offset
 * the next page starts at (null when the page is the whole list). The boundary is derived from the
 * deployment byte ceiling — the same bound the enclosing response is finalized against — never a
 * row count (2026-09-14 audit, U-E10/U-I9). One row is always admitted so a single oversized row
 * cannot wedge the caller: it pages by the caller's own finer cursor (offset/pageCursor) instead.
 */
export function byteBoundedPage(rows, budgetBytes) {
  const page = [];
  let bytes = 0;
  for (const [index, row] of rows.entries()) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (page.length > 0 && bytes + rowBytes > budgetBytes) return { page, nextOffset: index };
    bytes += rowBytes;
    page.push(row);
  }
  return { page, nextOffset: null };
}
export function applicationError(message, code, detail = null) {
  return Object.assign(new Error(message), { code, ...(detail == null ? {} : { detail }) });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
// Transport admission, audit, and completion events advance the global cursor without changing
// a Run's semantic authority. Keep those events observable through `cursor`, but never let them
// invalidate an action Baton just offered to an authenticated caller.
export function semanticViewDigest(view) {
  // progressClass/requiredAction are DERIVED from the underlying fields below them (phase,
  // attention, timing cadence, terminalCause), so they never carry independent authority:
  // excluding them keeps the actionId token stable across the actionId's own derivation
  // (P1-C view-digest-dependent token) without weakening freshness.
  const { cursor: _transportCursor, progressClass: _derivedProgress, requiredAction: _derivedAction, ...semanticView } = view;
  return digest(semanticView);
}
export function resultExportArchiveCeiling(policy) {
  const value = policy.maxBytes + MAX_RUN_VIEW_BYTES + ((policy.maxFiles + 1) * 1_024);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw applicationError('profile export archive ceiling is invalid', 'application_export_policy_stale');
  }
  return value;
}
export function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
/** The ONE closed-shape read (#532, #535). Issue #532 loosened the unknown-field half for
 * forward compatibility: a calling seam that validates a structure it may extend accepts fields it
 * does not declare, and only the declared fields are required. That loosening belongs to
 * DATA-SHAPE validation. A validator on an AUTHORIZATION boundary is the opposite: an undeclared
 * field there is not an extension, it is an attempt to grant authority the caller does not hold
 * (#176: a forged principal carrying `orchestratorLeaseId` refused `application_authority_invalid`).
 * Those callers ask for the closed read explicitly with `{rejectUnknown: true}`; the default stays
 * #532's forward-compatible behaviour, so no data-shape caller changes.
 * The strict refusal names the field, the rule and the expectation, the #376 shape. */
export function exactObject(value, fields, code, label, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw applicationError(`${label} has missing required field(s)`, code);
  }
  const keys = Object.keys(value);
  for (const f of fields) {
    if (!keys.includes(f)) throw applicationError(`${label} has missing required field(s)`, code);
  }
  if (options.rejectUnknown !== true) return;
  const declared = new Set(fields);
  for (const key of keys) {
    if (declared.has(key)) continue;
    throw applicationError(`${label} carries undeclared field ${key}`, code, {
      field: key, rule: 'unknown-field', expectation: `one of ${fields.join(', ')}`,
    });
  }
}
export function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value); }
export function validText(value, maxBytes = FRAME_LIMITS['run.objective'].value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= maxBytes;
}
/** Cap a string at maxBytes on a UTF-8 scalar boundary (the capBytes helper, messages.mjs). */
export function capBytesToScalar(text, maxBytes) {
  let out = '';
  let bytes = 0;
  for (const ch of String(text)) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > maxBytes) return out;
    out += ch;
    bytes += size;
  }
  return out;
}
export function boundedAttentionText(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim();
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) return '[credential-shaped content redacted]';
  return normalized;
}
// REFLEX-3 (docs/32 §3.3 Part D, issue #18; red-team F14): a context package branch's resolved
// content is untrusted input to every reader (a worker or a prior package can shape it). Every
// non-null slice routes through the same `boundedAttentionText`/`SECRET_SHAPED_TEXT` discipline as
// worker prose elsewhere in this file, and the projection carries an explicit untrusted-prose
// provenance marker rather than hub-styled visual weight.
export function projectContextPackageBranch(resolved) {
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw applicationError('context package branch is invalid', 'application_context_package_branch_invalid');
  }
  const projectSlice = (value) => (value === null || value === undefined ? null : boundedAttentionText(
    typeof value === 'string' ? value : JSON.stringify(value),
  ));
  return deepFreeze({
    name: resolved.name,
    schema: resolved.schema ? clone(resolved.schema) : null,
    provenance: 'untrusted',
    source: projectSlice(resolved.source),
    artifact: projectSlice(resolved.artifact),
    valueRef: projectSlice(resolved.valueRef),
  });
}
// issue #10 / docs/32 §5 (AX-1): a bounded (160 bytes with the ellipsis included), NFC-normalized,
// credential-sanitized projection of a pending worker request's own text — never worker prose
// beyond the request text itself.
export function boundedBlockedInteractionSummary(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  const normalized = value.normalize('NFC').trim();
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(normalized))) return '[credential-shaped content redacted]';
  const bytes = Buffer.from(normalized);
  if (bytes.length <= MAX_BLOCKED_INTERACTION_SUMMARY_BYTES) return normalized;
  const ellipsisBytes = Buffer.byteLength('…');
  return `${bytes.subarray(0, MAX_BLOCKED_INTERACTION_SUMMARY_BYTES - ellipsisBytes).toString('utf8')}…`;
}
// AX-1 rule 1/2: the single projection helper for `blockedInteraction`, consumed identically
// by the single-attempt view, the workflow view, and (through those) `runs.list` and the CLI
// outline. issue #16: `kind:'decision'` (AX-1's blocked_interaction:decision projection).
export function projectBlockedInteraction(phase, attention) {
  if (phase === 'awaiting_plan_approval') return { kind: 'approve_plan' };
  if (phase === 'selection_required') return { kind: 'select_candidate' };
  const pending = (attention ?? []).find((entry) => (
    entry?.kind === 'answer_question' || entry?.kind === 'answer_approval' || entry?.kind === 'answer_decision'
  ));
  if (!pending) return null;
  if (pending.kind === 'answer_decision') return { kind: 'decision', summary: boundedBlockedInteractionSummary(pending.question) };
  const text = pending.kind === 'answer_question' ? pending.question : pending.approvalKind;
  return { kind: 'answer_question', summary: boundedBlockedInteractionSummary(text) };
}
// issue #140: the waitingOn lookups read the ledger for the LAST matching event, and
// `events(1)` deep-clones the whole log to find it — O(ledger) per read on the observability
// hot path (waves.progress polls the projection per member per cycle). The exact bounded read:
// walk backwards from the eventCursor() tail in eventsView windows — clone-free frozen
// references — until the predicate matches or seq 1 is reached, so a read's cost tracks the
// distance from the tail to the match, not the ledger length. A coordination face without the
// cursor/view pair keeps the full read it always served.
// issue #492: the single numeric constant is the window size, 256 events. It bounds each
// read's allocation to one window of frozen references, and the exact walk costs
// ⌈distance/256⌉ windows; a smaller window multiplies per-read call overhead on the poll
// path, a larger one re-grows the per-read allocation this helper exists to bound.
export const WAITING_ON_TAIL_SCAN_CHUNK = 256;

export function lastCoordinationEvent(driver, predicate) {
  const coordination = driver?.coordination;
  if (typeof coordination?.eventCursor !== 'function' || typeof coordination?.eventsView !== 'function') {
    return typeof coordination?.events === 'function'
      ? coordination.events(1).findLast(predicate) ?? null
      : null;
  }
  let high = coordination.eventCursor();
  while (high >= 1) {
    const fromSeq = Math.max(1, high - WAITING_ON_TAIL_SCAN_CHUNK + 1);
    const window = coordination.eventsView(fromSeq, high - fromSeq + 1);
    for (let index = window.length - 1; index >= 0; index -= 1) {
      if (predicate(window[index])) return window[index];
    }
    high = fromSeq - 1;
  }
  return null;
}

// issue #10 / docs/32 §5 (waiting-vocabulary): the single waitingOn projection, consumed
// identically by the run view, the workflow view, and (through those) `runs.list` and the CLI
// outline. The five kinds are closed (WAITING_ON_KINDS) and ride event-epoch `since` stamps —
// never wall time. Precedence: plan_approval (a pure fold of the phase, coexisting with the
// approve_plan interaction) > blocked (the interaction owns the member) > spawning > a pending
// task (receipt ? capacity_ceiling : dispatch_pending) > provider_stalled > honest null.
export function projectWaitingOn(driver, current, phase, task, workers, blocked) {
  if (phase === 'awaiting_plan_approval') {
    const planId = current?.plan?.planId ?? null;
    const proposal = lastCoordinationEvent(driver, planId
      ? (event) => event.kind === 'plan.version_proposed' && event.payload?.plan?.planId === planId
      : (event) => event.kind === 'plan.version_proposed');
    if (!proposal) return null;
    return {
      kind: 'plan_approval',
      since: { eventSeq: proposal.seq, turnEpoch: null },
      detail: {
        planVersion: proposal.payload?.plan?.version ?? current.plan?.version ?? null,
        proposalSeq: proposal.seq,
      },
    };
  }
  if (blocked) return null;
  const handles = workers ?? [];
  const spawnHandle = handles.find((handle) => handle.spawnPending === true) ?? null;
  if (spawnHandle) {
    const spawnTask = task ?? (spawnHandle.taskId
      ? driver?.coordination?.task(spawnHandle.taskId) ?? null : null);
    return {
      kind: 'spawning',
      since: { eventSeq: spawnTask?.claimedEvent ?? spawnTask?.createdEvent ?? null, turnEpoch: null },
      detail: {
        workerId: spawnHandle.id,
        taskId: spawnHandle.taskId ?? spawnTask?.id ?? null,
        vendor: spawnHandle.vendor ?? spawnTask?.vendorRequested ?? null,
        window: spawnHandle.spawnWindow ?? null,
      },
    };
  }
  const candidates = task ? [task] : handles
    .map((handle) => (handle.taskId ? driver?.coordination?.task(handle.taskId) ?? null : null))
    .filter(Boolean);
  const pendingTask = candidates.find((candidate) => candidate.status === 'pending');
  if (pendingTask) {
    // The deferral receipt is idempotency-keyed per task (`task.dispatch_deferred:<taskId>:
    // <taskCreatedSeq>`, re-skips never re-mint), so the last match is the only match.
    const receipt = lastCoordinationEvent(driver, (event) => event.kind === 'task.dispatch_deferred'
      && event.payload?.taskId === pendingTask.id);
    if (receipt) {
      return {
        kind: 'capacity_ceiling',
        since: { eventSeq: receipt.seq, turnEpoch: null },
        detail: {
          vendor: receipt.payload?.vendor ?? pendingTask.vendorRequested ?? null,
          ceiling: receipt.payload?.ceiling ?? null,
          inFlight: receipt.payload?.inFlight ?? null,
        },
      };
    }
    return {
      kind: 'dispatch_pending',
      since: { eventSeq: pendingTask.createdEvent ?? null, turnEpoch: null },
      detail: { vendorRequested: pendingTask.vendorRequested ?? null, reason: 'pre-dispatch' },
    };
  }
  const workingTask = task && task.status === 'working' ? task
    : candidates.find((candidate) => candidate.status === 'working');
  if (workingTask?.assignee && typeof driver?.log?.read === 'function') {
    const workerEvents = driver.log.read(workingTask.assignee);
    const suspicion = workerEvents.findLast((event) => event.kind === 'health.stall_suspected') ?? null;
    if (suspicion && !workerEvents.some((event) => event.seq > suspicion.seq && event.actor === 'worker')) {
      return {
        kind: 'provider_stalled',
        since: { eventSeq: suspicion.seq, turnEpoch: suspicion.turnEpoch ?? null },
        detail: {
          workerId: workingTask.assignee,
          taskId: workingTask.id,
          action: suspicion.payload?.action ?? 'none',
        },
      };
    }
  }
  return null;
}
// v2 P1-C (docs/reference/evidence/semantic-progress-2026-07-31/semantic-progress-decisions.md
// rules 1-3): the semantic-progress additions are ONE named total reducer over the run view's
// existing projections, plus the resolving-action projection. `rate_limited` is CUT in v2
// (R-SP-2) — no provider taxonomy row classifies a limit receipt honestly, so the enum never
// prose-guesses a member.
function progressBlockedDetail(phase, attention) {
  if (phase === 'awaiting_plan_approval') return 'approve_plan';
  if (phase === 'selection_required') return 'select_candidate';
  const pending = (attention ?? []).find((entry) => (
    entry?.kind === 'answer_question' || entry?.kind === 'answer_approval' || entry?.kind === 'answer_decision'
  ));
  if (pending) return 'answer_required';
  if ((attention ?? []).some((entry) => entry?.kind === 'turn_checkpoint')) return 'turn_checkpoint';
  return null;
}
// Rule 1: closed enum, total reducer, pinned precedence. Basis fields {silenceMs,
// meaningfulEventAt} ride along — never a bare label.
export function projectProgressClass({ phase, attention, timing, terminalCause }) {
  const silenceMs = Number.isSafeInteger(timing?.silenceMs) ? timing.silenceMs : 0;
  const meaningfulEventAt = timing?.lastProgress?.at ?? null;
  if (APPLICATION_RUN_TERMINAL_PHASES.has(phase)) {
    const cause = terminalCause?.kind ?? terminalCause?.code ?? phase;
    return deepFreeze({ class: `terminal:${cause}`, silenceMs, meaningfulEventAt });
  }
  const detail = progressBlockedDetail(phase, attention);
  if (detail !== null) {
    return deepFreeze({ class: `blocked_interaction:${detail}`, silenceMs, meaningfulEventAt });
  }
  if (silenceMs >= PROGRESS_SILENCE_THRESHOLD_MS) {
    return deepFreeze({ class: 'silent', silenceMs, meaningfulEventAt });
  }
  return deepFreeze({ class: 'progressing', silenceMs, meaningfulEventAt });
}
// Part B (issue #16): project every worker's pending decision request (if any) into the
// same sanitized/bounded/provenance-marked shape the question/approval attention entries
// use. `recommended` is worker-authored content nudging the human toward an option — it is
// wrapped as untrusted prose (never hub-styled), per F14.
export function projectDecisionAttention(coordinator, workers) {
  const entries = [];
  for (const handle of workers) {
    if (!handle.pendingDecisionId) continue;
    const interaction = coordinator.interactionStatus(handle.pendingDecisionId);
    if (!interaction || interaction.kind !== 'decision' || interaction.state !== 'pending') continue;
    entries.push({
      kind: 'answer_decision',
      workerId: handle.id,
      requestId: handle.pendingDecisionId,
      question: boundedAttentionText(interaction.question),
      options: (interaction.options ?? []).map((opt) => ({
        id: opt.id,
        label: boundedAttentionText(opt.label),
        summary: opt.summary != null ? boundedAttentionText(opt.summary) : null,
      })),
      allowFreeResponse: interaction.allowFreeResponse === true,
      recommended: interaction.recommended ? wrapProse(handle.id, interaction.recommended) : null,
      // Bidirectional v2 rule 3/5 surface: deadline is recorded at admission and swept; project it
      // so an orchestrator can prioritize urgency without consulting a local clock for expiry.
      deadlineAt: interaction.deadlineAt ?? null,
    });
  }
  return entries;
}
function scratchpadProse(workerId, text) {
  return wrapProse(workerId, boundedAttentionText(text));
}
function projectScratchpadContent(row) {
  const content = row.content;
  const worker = row.workerId;
  if (row.kind === 'note' && content?.kind === 'note') {
    return { kind: 'note', text: scratchpadProse(worker, content.text) };
  }
  if (row.kind === 'plan' && content?.kind === 'plan' && Array.isArray(content.steps)) {
    return {
      kind: 'plan', objective: scratchpadProse(worker, content.objective),
      steps: content.steps.map((step) => ({
        text: scratchpadProse(worker, step.text), state: step.state,
      })),
      supersedes: content.supersedes === null ? null : clone(content.supersedes),
    };
  }
  if (row.kind === 'doubt' && content?.kind === 'doubt') {
    return {
      kind: 'doubt', question: scratchpadProse(worker, content.question),
      context: content.context === null ? null : scratchpadProse(worker, content.context),
    };
  }
  if (row.kind === 'link' && content?.kind === 'link') {
    let target;
    if (content.target?.type === 'url') {
      target = { type: 'url', url: scratchpadProse(worker, content.target.url) };
    } else if (content.target?.type === 'repo_path') {
      target = { type: 'repo_path', path: scratchpadProse(worker, content.target.path) };
    } else if (content.target?.type === 'entry') {
      target = {
        type: 'entry', entryId: content.target.entryId, entryDigest: content.target.entryDigest,
      };
    } else {
      throw applicationError('stored scratchpad link is invalid', 'scratchpad_entry_integrity');
    }
    return {
      kind: 'link', label: scratchpadProse(worker, content.label),
      relation: content.relation, target,
    };
  }
  throw applicationError('stored scratchpad entry is invalid', 'scratchpad_entry_integrity');
}
/**
 * Pure, bounded driver-facing scratchpad projection. Authorization precedes pagination and
 * byte accounting, and the cache key binds the exact authorized fence tuple.
 */
export function projectScratchpadView(snapshot, viewer = {}, cache = null) {
  const runId = snapshot?.runId ?? null;
  const role = viewer.role === 'orchestrator' ? 'orchestrator' : 'worker';
  const workerId = role === 'worker' ? (viewer.workerId ?? null) : null;
  const requestedWorkerId = viewer.requestedWorkerId ?? null;
  const allowed = role === 'orchestrator'
    ? new Set((snapshot?.slices ?? []).map((slice) => slice.scope))
    : new Set([`worker:${workerId}`, 'shared']);
  if (role === 'orchestrator' && requestedWorkerId) {
    allowed.clear(); allowed.add(`worker:${requestedWorkerId}`); allowed.add('shared');
  }
  const slices = (snapshot?.slices ?? []).filter((slice) => allowed.has(slice.scope));
  const scopes = slices.map((slice) => slice.scope);
  if (role === 'worker') {
    scopes.sort((left, right) => {
      if (left === `worker:${workerId}`) return -1;
      if (right === `worker:${workerId}`) return 1;
      return compareCanonicalStrings(left, right);
    });
  } else scopes.sort(compareCanonicalStrings);
  const fenceByScope = new Map(snapshot?.fenceTuple ?? []);
  const fenceTuple = scopes.map((scope) => [scope, fenceByScope.get(scope) ?? 0]);
  const before = viewer.before ?? null;
  const sliceIdentity = `${runId}\0${role}\0${workerId ?? ''}\0${requestedWorkerId ?? ''}`;
  const cacheKey = `${sliceIdentity}\0${before?.createdEvent ?? ''}\0${before?.entryId ?? ''}\0${JSON.stringify(fenceTuple)}`;
  if (cache?.has(cacheKey)) {
    const value = cache.get(cacheKey);
    cache.delete(cacheKey); cache.set(cacheKey, value);
    return value;
  }
  let rows = slices.flatMap((slice) => slice.entries ?? [])
    .sort((left, right) => right.createdEvent - left.createdEvent
      || compareCanonicalStrings(left.entryId, right.entryId));
  if (before) {
    rows = rows.filter((row) => row.createdEvent < before.createdEvent
      || (row.createdEvent === before.createdEvent
        && compareCanonicalStrings(row.entryId, before.entryId) > 0));
  }
  let scratchpadViewTruncated = rows.length > MAX_SCRATCHPAD_VIEW_ITEMS;
  let projected = rows.slice(0, MAX_SCRATCHPAD_VIEW_ITEMS).map((row) => ({
    schemaVersion: 1, entryId: row.entryId, entryDigest: row.entryDigest,
    contentDigest: row.contentDigest, runId: row.runId, scope: row.scope,
    authorWorkerId: row.workerId, authorTaskId: row.taskId, ordinal: row.ordinal,
    kind: row.kind, createdEvent: row.createdEvent, createdAt: row.createdAt,
    candidateState: 'candidate',
    source: row.source === null ? null : clone(row.source),
    content: projectScratchpadContent(row),
  }));
  const build = () => {
    const last = projected.at(-1);
    return deepFreeze({
      runId, workerId: requestedWorkerId ?? workerId, scopes: clone(scopes),
      fenceTuple: clone(fenceTuple), entries: projected,
      scratchpadViewTruncated,
      nextBefore: scratchpadViewTruncated && last
        ? { createdEvent: last.createdEvent, entryId: last.entryId } : null,
    });
  };
  let view = build();
  while (Buffer.byteLength(JSON.stringify(view)) > MAX_SCRATCHPAD_VIEW_BYTES && projected.length > 0) {
    projected = projected.slice(0, -1); scratchpadViewTruncated = true; view = build();
  }
  if (cache) {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${sliceIdentity}\0`) && !key.endsWith(`\0${JSON.stringify(fenceTuple)}`)) {
        cache.delete(key);
      }
    }
    cache.set(cacheKey, view);
    while (cache.size > MAX_SCRATCHPAD_VIEW_CACHE_KEYS) cache.delete(cache.keys().next().value);
  }
  return view;
}
// REFLEX-4 slice A (docs/32 §3.4, issue #19): `application.context_eval`'s own request shape
// check. Kept as a standalone function (not a validateApplicationCommandArgs branch) because
// `contextEval` is not registered in APPLICATION_COMMAND_DEFINITIONS — see the note above that
// table for why.
const CONTEXT_EVAL_ARGS = Object.freeze(['runId', 'manifestDigest', 'role', 'program']);
export function validateContextEvalArgs(args) {
  const allowed = new Set(CONTEXT_EVAL_ARGS);
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some((key) => !allowed.has(key))
    || (args.runId !== undefined && !validId(args.runId))
    || (args.manifestDigest !== undefined && !HEX64.test(args.manifestDigest))
    || (args.runId === undefined) === (args.manifestDigest === undefined)
    || (args.role !== undefined && !validId(args.role))
    || !args.program || typeof args.program !== 'object' || Array.isArray(args.program)) {
    throw applicationError('Context evaluation request is invalid', 'application_context_eval_invalid');
  }
  return true;
}
// Mirrors coordinator.mjs's own typedTerminalCode: a durable, payload-recomputed terminal code
// (never handle.terminalCause, which is in-memory only — issue53-decisions.md v2 rule 2).
export function debugTerminalCode(value, fallback) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && /^[a-z0-9][a-z0-9._-]*$/iu.test(value) ? value : fallback;
}
// Diagnostics DG-1 (DIAG-2): live trust-gate / verifier codes → closed gate enum. Unknown is the
// honest fallback (diagnostics-decisions.md v2 rule 3). worker_path_scope_violation serializes
// as `scope`; digests-only pathScopeEvidence is never reopened into path strings.
const DEBUG_GATE_CODES = Object.freeze(new Set([
  'scope', 'red_green', 'coverage', 'route_mismatch', 'forbidden_effect', 'unknown',
]));
export function debugGateFromLiveCode(code) {
  if (code === 'worker_path_scope_violation') return 'scope';
  if (code === 'forbidden_effect_observed') return 'forbidden_effect';
  if (code === 'verification_red_green_failed') return 'red_green';
  if (code === 'verification_coverage_failed') return 'coverage';
  if (code === 'plan_route_mismatch' || code === 'recovery_route_mismatch') return 'route_mismatch';
  return 'unknown';
}
function debugGateDetail(gate, event) {
  if (gate === 'scope') {
    const evidence = event.payload?.pathScopeEvidence && typeof event.payload.pathScopeEvidence === 'object'
      ? event.payload.pathScopeEvidence : {};
    // Digests + counts only — never path strings (coordinator.mjs pathScopeEvidence mint).
    return {
      digests: {
        changedPathsDigest: typeof evidence.changedPathsDigest === 'string' ? evidence.changedPathsDigest : null,
        inScopeChangedPathsDigest: typeof evidence.inScopeChangedPathsDigest === 'string'
          ? evidence.inScopeChangedPathsDigest : null,
        outOfScopeChangedPathsDigest: typeof evidence.outOfScopeChangedPathsDigest === 'string'
          ? evidence.outOfScopeChangedPathsDigest : null,
      },
      counts: {
        changedPathCount: Number.isSafeInteger(evidence.changedPathCount) ? evidence.changedPathCount : 0,
        inScopeChangedPathCount: Number.isSafeInteger(evidence.inScopeChangedPathCount)
          ? evidence.inScopeChangedPathCount : 0,
        outOfScopeChangedPathCount: Number.isSafeInteger(evidence.outOfScopeChangedPathCount)
          ? evidence.outOfScopeChangedPathCount : 0,
      },
    };
  }
  if (gate === 'red_green' || gate === 'coverage') {
    const raw = typeof event.payload?.verdict?.failureCapsule?.text === 'string'
      ? event.payload.verdict.failureCapsule.text
      : typeof event.payload?.verdict?.output === 'string' ? event.payload.verdict.output : '';
    // Sanitizer reused verbatim (verifier-diagnostics.mjs) — no parallel redaction path.
    return { tail: sanitizeVerifierDiagnosticText(raw).text };
  }
  return {};
}
// Diagnostics DG-1: project the latest trust-gate / verifier refusal into {gate, detail}.
// Source events only: error with payload.phase trust_gate, and verify.reverified{accept:false}.
// Bracket access avoids surface-audit treating a `phase === '…'` literal as a runPhase enum.
export function debugGateRefusal(events) {
  const candidates = events.filter((event) => {
    if (event.kind === 'error' && event.payload?.['phase'] === 'trust_gate') return true;
    if (event.kind === 'verify.reverified' && event.payload?.accept === false) return true;
    return false;
  });
  const event = candidates.at(-1);
  if (!event) return null;
  const liveCode = event.kind === 'verify.reverified'
    ? (typeof event.payload?.verdict?.diagnosticCode === 'string'
      ? event.payload.verdict.diagnosticCode : 'trust_gate_failed')
    : (typeof event.payload?.code === 'string' ? event.payload.code : 'trust_gate_failed');
  const gate = debugGateFromLiveCode(liveCode);
  const message = typeof event.payload?.message === 'string' && event.payload.message.length > 0
    ? boundedAttentionText(event.payload.message) : null;
  return {
    kind: event.kind,
    code: debugTerminalCode(liveCode, 'trust_gate_failed'),
    message,
    gate,
    detail: debugGateDetail(gate, event),
  };
}
// Issue #61 D1 (fold v1.1) — WHAT was checked is a CLOSED domain: the whitelisted trust
// phases for error-kind refusals, the closed verifier diagnosticCode for verify.reverified
// refusals — everything else escalates to null so a raw gate-internal phase name never
// crosses to the worker (#73's class).
const VERDICT_CHECK_PHASES = Object.freeze(new Set([
  'path_scope', 'forbidden_effect', 'required_effect',
]));
// Issue #61 D1 + OQ1 — the hub-minted corrective-class table, keyed by terminal CODE
// (never the coarse gate: required_effect_absent degrades to gate unknown but keeps its
// corrective). Frozen so a caller cannot rewrite a corrective (#73). A code absent from
// the table carries corrective null — honest absence, escalate to the orchestrator.
export const VERDICT_CORRECTIVE_TABLE = Object.freeze({
  worker_path_scope_violation: 'in_scope_revision',
  forbidden_effect_observed: 'forbidden_effect_retraction',
  required_effect_absent: 'in_scope_edit',
  verification_red_green_failed: 'failing_check_fix',
  verification_coverage_failed: 'coverage_completion',
  verification_output_exceeded: null,
  verification_timed_out: null,
  verification_spawn_unavailable: null,
  verification_claim_diverged: null,
  verification_mutation_failed: null,
  verification_coverage_unavailable: null,
  verification_mutation_unavailable: null,
  verification_exit_mismatch: null,
  verification_unjudged: null,
});
// Issue #61 refusal vocabulary — a caller-authored corrective riding a durable event is
// a forged corrective. The surface degrades PER-RECORD (the #73 B5 precedent): the
// malformed record is excluded from the projection, never a map-wide throw.
const VERDICT_SURFACE_CORRECTIVE_FORCED = 'verdict_surface_corrective_forced';
function verdictForgedCorrectiveReason(event) {
  if (event?.payload && typeof event.payload === 'object'
    && Object.hasOwn(event.payload, 'corrective')) {
    return VERDICT_SURFACE_CORRECTIVE_FORCED;
  }
  return null;
}
function verdictLiveCode(event) {
  return event.kind === 'verify.reverified'
    ? (typeof event.payload?.verdict?.diagnosticCode === 'string'
      ? event.payload.verdict.diagnosticCode : 'trust_gate_failed')
    : (typeof event.payload?.code === 'string' ? event.payload.code : 'trust_gate_failed');
}
function verdictSurfaceCheck(event, liveCode) {
  if (event.kind === 'verify.reverified') {
    return VERIFIER_DIAGNOSTIC_CODES.has(liveCode) ? liveCode : null;
  }
  const trustPhase = typeof event.payload?.trustPhase === 'string' ? event.payload.trustPhase : null;
  return trustPhase !== null && VERDICT_CHECK_PHASES.has(trustPhase) ? trustPhase : null;
}
// Issue #61 D1 (fold Minor 1) — the detail evidence CLASS. Scope and red_green/coverage
// reuse debugGateDetail verbatim (digests+counts, sanitizer tail — never paths, never the
// raw capsule); required_effect_absent carries the digest/count subset of
// requiredEffectEvidence; every other gate carries {}.
function verdictSurfaceDetail(gate, liveCode, event) {
  if (liveCode === 'required_effect_absent') {
    const evidence = event.payload?.requiredEffectEvidence && typeof event.payload.requiredEffectEvidence === 'object'
      ? event.payload.requiredEffectEvidence : {};
    return {
      changedPathCount: Number.isSafeInteger(evidence.changedPathCount) ? evidence.changedPathCount : 0,
      changedPathsDigest: typeof evidence.changedPathsDigest === 'string' ? evidence.changedPathsDigest : null,
      inScopeChangedPathCount: Number.isSafeInteger(evidence.inScopeChangedPathCount)
        ? evidence.inScopeChangedPathCount : 0,
      inScopeChangedPathsDigest: typeof evidence.inScopeChangedPathsDigest === 'string'
        ? evidence.inScopeChangedPathsDigest : null,
    };
  }
  return debugGateDetail(gate, event);
}
function isVerdictCandidate(event) {
  if (event.kind === 'error' && event.payload?.['phase'] === 'trust_gate') return true;
  if (event.kind === 'verify.reverified' && event.payload?.accept === false) return true;
  return false;
}
// Issue #61 D1/R4 — the worker-facing verdict surface: a pure replay-derived projection
// over the worker-scoped event stream into {gate, code, check, detail, corrective}.
// Latest evidence supersedes (.at(-1)); cross-worker isolation is the caller's filter
// (the same worker-scoped set the #79 push derives); forged-corrective records are
// excluded per-record, so a malformed-only stream projects null.
export function projectVerdictSurface(events) {
  if (!Array.isArray(events)) return null;
  const event = events.filter(isVerdictCandidate)
    .filter((candidate) => verdictForgedCorrectiveReason(candidate) === null)
    .at(-1);
  if (!event) return null;
  const liveCode = verdictLiveCode(event);
  const gate = debugGateFromLiveCode(liveCode);
  return {
    gate,
    code: debugTerminalCode(liveCode, 'trust_gate_failed'),
    check: verdictSurfaceCheck(event, liveCode),
    detail: verdictSurfaceDetail(gate, liveCode, event),
    corrective: Object.hasOwn(VERDICT_CORRECTIVE_TABLE, liveCode)
      ? VERDICT_CORRECTIVE_TABLE[liveCode] : null,
  };
}
// Diagnostics DG-1a (DIAG-3 / #28 deferral): one aggregated wire.frame_degraded summary
// (counts + last code), never raw frames — #53 writeReceipts whitelist amendment.
export function debugFrameDegradedSummary(events) {
  const degraded = events.filter((event) => event.kind === 'wire.frame_degraded');
  if (degraded.length === 0) return null;
  const last = degraded.at(-1);
  return {
    kind: 'wire.frame_degraded',
    result: 'degraded',
    code: 'frame_degraded',
    at: last.ts,
    count: degraded.length,
    lastCode: 'frame_degraded',
  };
}
export function normalizePrincipal(value, label) {
  // Issue #535: the principal is an AUTHORIZATION boundary, so its shape stays closed — an
  // undeclared field is a forged grant, never a forward-compatible extension.
  exactObject(value, ['actor', 'principalId', 'sessionId'], 'application_authority_invalid', label,
    { rejectUnknown: true });
  if (!validText(value.actor, 256) || !validId(value.principalId) || !validId(value.sessionId)) {
    throw applicationError(`${label} is invalid`, 'application_authority_invalid');
  }
  return deepFreeze(clone(value));
}
export function semanticAuthorityPayload(value) {
  return {
    schemaVersion: 1,
    actionId: value.actionId,
    kind: value.kind,
    effect: value.effect,
    requiredCapabilities: [...value.requiredCapabilities].sort(),
  };
}
export function normalizeSemanticAuthority(value, code = 'application_context_invalid') {
  // Issue #536: a command context carries AUTHORITY GRANTS, and a grant keeps the closed shape —
  // an undeclared field in a grant is an attempt to claim authority the grantor never vouched
  // (#535's rule, one level down). The durable seam already demands the exact S-2 envelope
  // (mintBoardGrant's proofFields), so a looser read here accepts what the ledger then refuses,
  // and projects the undeclared keys into the frozen context other consumers read verbatim.
  exactObject(value,
    ['schemaVersion', 'actionId', 'kind', 'effect', 'requiredCapabilities', 'authorityDigest'],
    code, 'semantic action authority', { rejectUnknown: true });
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
export function capabilityEligibleSemanticActions(candidates, context) {
  if (!context?.capabilityAuthority) return candidates;
  return candidates.filter(({ kind }) => (
    APPLICATION_SEMANTIC_REGISTRY.actions[kind].requiredCapabilities.every(
      (capability) => context.capabilities.includes(capability),
    )
  ));
}
export function normalizeCommandContext(value) {
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
    // The context object itself stays #532-forward-compatible: unknown context keys are dropped
    // by the closed construction below and carry no authority.
    exactObject(value.sessionAuthority,
      ['schemaVersion', 'authorityDigest', 'expiresAt', 'orchestratorLeaseId'],
      'application_context_invalid', 'application session authority', { rejectUnknown: true });
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
export function normalizeRoute(value, code = 'application_route_invalid') {
  exactObject(value, ['harness', 'model', 'effort'], code, 'route');
  if (![value.harness, value.model, value.effort].every((item) => validText(item, 256))) {
    throw applicationError('route is invalid', code);
  }
  return deepFreeze({ harness: value.harness, model: value.model, effort: value.effort });
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
  // The profile's export policy is an authority boundary: the export root is the deployment's
  // decision, so an undeclared field here is a smuggled path grant rather than a
  // forward-compatible extension (#535's authorization-boundary rule).
  exactObject(value, [
    'mode', 'format', 'maxFiles', 'maxBytes',
    'requireAdoptedResult', 'requireSemanticReview', 'requireIntegration',
  ], 'application_profile_invalid', 'profile exportPolicy', { rejectUnknown: true });
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
export function normalizeProfile(name, value, repoId) {
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
export function profileDefinition(profile) {
  const { digest: ignored, ...definition } = clone(profile);
  void ignored;
  return definition;
}
export function profileRegistryCoordinate(name, profileDigest) { return `${name}\0${profileDigest}`; }
export function profileRegistryKey(repoId, name, profileDigest) { return `${APPLICATION_PROFILE_RECORD_KIND}:${digest({ repoId, name, profileDigest })}`; }
export function normalizeProfileRegistryEvent(event) {
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
function normalizeGateCauseFeedback(value) {
  // Diagnostics DG-1b / R-DG-6: run.feedback structured inputs accept the same {gate, detail}
  // payload the run.debug failure leg projects — no new seam.
  // Issue #538: this payload is a caller-authored claim about hub-owned gate state, so its
  // shape stays closed — `derived` and `gateEventSeq` are hub-set only (the validated-or-replaced
  // verdict law), and a caller-authored key here is an attempt to author that state, never a
  // forward-compatible extension. The #532 loosening stays for data-shape callers.
  exactObject(value, ['gate', 'detail'], 'application_workflow_feedback_invalid',
    'gate diagnosis feedback', { rejectUnknown: true });
  if (!DEBUG_GATE_CODES.has(value.gate)
    || !value.detail || typeof value.detail !== 'object' || Array.isArray(value.detail)) {
    throw applicationError('workflow feedback is invalid', 'application_workflow_feedback_invalid');
  }
  if (value.gate === 'scope') {
    exactObject(value.detail, ['digests', 'counts'], 'application_workflow_feedback_invalid',
      'scope gate detail');
    exactObject(value.detail.digests, [
      'changedPathsDigest', 'inScopeChangedPathsDigest', 'outOfScopeChangedPathsDigest',
    ], 'application_workflow_feedback_invalid', 'scope digests');
    exactObject(value.detail.counts, [
      'changedPathCount', 'inScopeChangedPathCount', 'outOfScopeChangedPathCount',
    ], 'application_workflow_feedback_invalid', 'scope counts');
    for (const key of Object.keys(value.detail.digests)) {
      const digestValue = value.detail.digests[key];
      if (digestValue !== null && !HEX64.test(digestValue ?? '')) {
        throw applicationError('workflow feedback is invalid', 'application_workflow_feedback_invalid');
      }
    }
    for (const key of Object.keys(value.detail.counts)) {
      if (!Number.isSafeInteger(value.detail.counts[key]) || value.detail.counts[key] < 0) {
        throw applicationError('workflow feedback is invalid', 'application_workflow_feedback_invalid');
      }
    }
    return deepFreeze({
      gate: 'scope',
      detail: {
        digests: { ...value.detail.digests },
        counts: { ...value.detail.counts },
      },
    });
  }
  if (value.gate === 'red_green' || value.gate === 'coverage') {
    exactObject(value.detail, ['tail'], 'application_workflow_feedback_invalid',
      'verifier gate detail');
    if (typeof value.detail.tail !== 'string') {
      throw applicationError('workflow feedback is invalid', 'application_workflow_feedback_invalid');
    }
    // Re-sanitize so secrets never ride the worker-facing channel.
    const tail = sanitizeVerifierDiagnosticText(value.detail.tail).text;
    return deepFreeze({ gate: value.gate, detail: { tail } });
  }
  // route_mismatch / forbidden_effect / unknown — detail is a closed empty object (or ignored keys).
  return deepFreeze({ gate: value.gate, detail: {} });
}
export function normalizeWorkflowFeedback(value) {
  // Gate-cause form first (diagnostics DG-1b): {gate, detail} — same payload as run.debug failure.
  if (value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.gate === 'string') {
    return normalizeGateCauseFeedback(value);
  }
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
export function assertWorkflowFeedbackAnchors(feedback, candidate) {
  // Gate-cause feedback has no path anchors (digests-only / sanitized tail).
  if (feedback.gate !== undefined) return true;
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
export function workflowNodeBudget(profile, members, rounds = 1) {
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
export function workflowRevisionBudget(profile, priorPlans, members, maxRounds) {
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
export function workflowDefinitionPolicy(definition) {
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
export function workflowEligibilityProjection(eligibility) {
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
/** ONE paged store read (#391). A modern store answers the page contract itself; a coordination
 * object that predates it — a hand-built harness, a foreign store — answers the bare array the
 * accessors returned before this change, which the ONE page derivation cuts here; a store without
 * the accessor at all answers the empty page. */
export const goalPlanStorePage = (coordination, accessor, args, limit, cursor) => {
  // The page size is the CALLER's contract, so it is refused before the store is asked for
  // anything (a store's own argument bound is a different refusal). The shared derivation below
  // cuts the page and refuses the same way, so the two boundaries can never disagree.
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw applicationError('goal/plan page size is invalid', 'application_goal_plan_page_invalid');
  }
  const read = coordination?.[accessor];
  if (typeof read !== 'function') return goalPlanPage([], limit, cursor);
  const answer = read.call(coordination, ...args, limit, cursor);
  return Array.isArray(answer) ? goalPlanPage(answer, limit, cursor) : answer;
};
/** One paged read per store accessor (#391): the caller's `limit` is the page size and `cursor`
 * resumes past the page's last row. */
export const goalPlanRunPlansPage = (coordination, repoId, runId, limit, cursor = 0) => (
  goalPlanStorePage(coordination, 'goalPlanRunPlans', [repoId, runId], limit, cursor));
export const goalPlanDispatchesPage = (coordination, repoId, runId, limit, cursor = 0) => (
  goalPlanStorePage(coordination, 'goalPlanDispatches', [repoId, runId], limit, cursor));
/** Walk pages to the whole bounded set — what the bounded readsites need, answered page by page
 * so no application goal-plan read ever rides a refusal threshold (#391). */
export function goalPlanReadAll(readPage) {
  const rows = [];
  let cursor = 0;
  for (;;) {
    const page = readPage(cursor);
    rows.push(...page.rows);
    if (!page.truncated) return rows;
    cursor = page.nextCursor;
  }
}
export function authority(principal, repoId, runId, power, idempotencyKey) {
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
export function refs(goal, plan) {
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    throughSeq: null,
  };
}
export function exactPlanRoutes(route) {
  return {
    schemaVersion: 2,
    allowed: [{ harness: route.harness, model: route.model, effort: route.effort }],
  };
}
export function exactPlanNodeRoute(node, label = 'Plan node') {
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
export function requestedPlanNodeRoute(node, dispatch = null, label = 'Plan node') {
  return exactDispatchRoute(dispatch) ?? exactPlanNodeRoute(node, label);
}
export function projectPlanRouteAuthority(routes) {
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
export function safeScopePath(value) {
  return validText(value) && !value.startsWith('/') && !value.includes('\\')
    && !value.split('/').includes('..');
}
export function scopeEntryWithin(requested, allowed) {
  if (!safeScopePath(requested) || !safeScopePath(allowed)) return false;
  if (allowed === '**') return true;
  if (requested === allowed) return true;
  if (!allowed.endsWith('/**')) return false;
  const prefix = allowed.slice(0, -2);
  return requested.startsWith(prefix) && requested.length > prefix.length;
}
export function parseProfileConstraint(constraints) {
  const marker = constraints.find((item) => item.startsWith('Baton deployment profile '));
  if (!marker) return null;
  const value = marker.slice('Baton deployment profile '.length);
  const split = value.lastIndexOf('@');
  if (split <= 0) return null;
  return { name: value.slice(0, split), digest: value.slice(split + 1) };
}
export function resultIntentConstraint(constraints = []) {
  const markers = constraints.filter((constraint) => (
    constraint.startsWith(RESULT_POLICY_CONSTRAINT_PREFIX)
  ));
  if (markers.length === 0) {
    return deepFreeze({ resultIntent: 'change', explicit: false, marker: null });
  }
  if (markers.length !== 1) {
    throw applicationError('Goal has inconsistent result-policy constraints',
      'application_goal_invalid');
  }
  const marker = markers[0];
  if (marker === LEGACY_READ_ONLY_RESULT_CONSTRAINT) {
    return deepFreeze({ resultIntent: 'read_only_evidence', explicit: false, marker });
  }
  const explicit = Object.entries(EXPLICIT_RESULT_CONSTRAINTS)
    .find(([, candidate]) => candidate === marker);
  if (!explicit) {
    throw applicationError('Goal has an unsupported result-policy constraint',
      'application_goal_invalid');
  }
  return deepFreeze({ resultIntent: explicit[0], explicit: true, marker });
}
export function resultIntentFromConstraints(constraints = []) {
  return resultIntentConstraint(constraints).resultIntent;
}
export function assertResultIntentCoherence(goal, plans) {
  const identity = resultIntentConstraint(goal.constraints);
  if (identity.resultIntent !== 'read_only_evidence') return identity;
  const definitionMatches = digest(goal.definitionOfDone) === digest(READ_ONLY_RESULT_DEFINITION);
  const mutatingNode = plans.flatMap((candidate) => candidate.nodes ?? []).find((node) => (
    node.effects?.includes('repository_edit')
      || node.requiredEffects?.includes('repository_edit')
  ));
  if (!definitionMatches || mutatingNode) {
    throw applicationError('read-only Goal and Plan authority are inconsistent',
      'application_goal_invalid');
  }
  return identity;
}
export function objectiveResultPolicy(resultIntent) {
  return deepFreeze(resultIntent === 'read_only_evidence' ? {
    mode: 'read_only_evidence', repositoryMutation: 'forbidden',
    acceptance: 'verified_textual_result_capsule',
  } : {
    mode: 'change', repositoryMutation: 'required_when_declared',
    acceptance: 'verified_effect_result',
  });
}
export function terminalCauseNarrative(cause) {
  if (cause?.kind === 'budget_exceeded') {
    return `Run terminated: ${cause.code} (${cause.dimension} ${cause.used}/${cause.limit}, ratio ${cause.ratio}).`;
  }
  if (cause?.kind === 'provider_failure') return `Run terminated: ${cause.code}.`;
  if (cause?.kind === 'policy_failure') return `Run terminated: ${cause.code}.`;
  if (cause?.kind === 'dispatch_refused') return `Run refused at dispatch: ${cause.code}. ${cause.remediation ?? ''}`.trimEnd();
  if (cause?.kind === 'operator_stop') return 'Run terminated: operator_stop.';
  return null;
}
export function runProgress({ phase, approval, node, route, verification, reviewPolicyMode, semanticReview, result, integration, exportResult, resourcesSettled, stop }) {
  const stopped = stop?.state === 'stopped' || phase === 'stopped';
  // Issue #334: 'inconclusive' is terminal with no accepted result, so the result/export
  // stages read stopped exactly like the other terminal-without-result phases.
  const failed = ['planning_failed', 'failed', 'inconclusive', 'denied', 'cancelled'].includes(phase);
  // Issue #334: a baseline-owned inconclusive names its ownership on the progress summary —
  // the base is red and the candidate is not to blame.
  const baselineInconclusive = verification?.state === 'inconclusive'
    && verification?.failureOwnership === 'baseline_or_environment';
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
      : baselineInconclusive && node?.state === 'failed'
        ? 'Provider turn ended; acceptance is inconclusive — the base is red (baseline_or_environment) and the candidate is not to blame'
      : route?.observed ? 'Provider identity observed'
      : route?.resolved ? 'Route resolved; provider identity pending'
        : node?.taskId ? 'Provider startup pending' : 'Provider not started'),
    stage('verification', 'Fresh verification', ['mechanically_verified', 'mechanically_verified_unstable'].includes(verification?.state) ? 'complete'
      : verification?.state === 'inconclusive' ? 'blocked'
        : verification?.state === 'failed' ? 'failed' : 'pending',
    verification?.state === 'mechanically_verified_unstable'
      ? 'Exact candidate confirmed after an original diagnostic failure; instability is retained.'
      : verification?.state === 'mechanically_verified' ? 'Pinned verification accepted'
      : verification?.state === 'inconclusive'
        ? `Verification needs another attempt; the exact candidate is preserved.${baselineInconclusive ? ' The base is red — the candidate is not to blame (baseline_or_environment).' : ''}`
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
export function projectedCleanupState(view) {
  return view.stop?.state
    ?? view.progress?.stages?.find((stage) => stage.key === 'cleanup')?.state
    ?? 'pending';
}
/** #268: the run's activity and cost, one row per worker plus totals, from the coordinator's
 * per-worker fold. Absent (null) on coordinators that do not expose the fold (narrow doubles). */
export function runActivity(driver, workers) {
  const fold = driver.coordinator?.workerActivity;
  if (typeof fold !== 'function') return null;
  const rows = workers.map((handle) => fold.call(driver.coordinator, handle.id)).filter(Boolean);
  const totals = rows.reduce((sum, row) => ({
    events: sum.events + row.events, toolCalls: sum.toolCalls + row.toolCalls, messages: sum.messages + row.messages,
    tokens: sum.tokens + row.usage.tokens, usd: sum.usd + row.usage.usd,
    lastEventAt: [sum.lastEventAt, row.lastEventAt].filter(Boolean).sort().at(-1) ?? null,
  }), { events: 0, toolCalls: 0, messages: 0, tokens: 0, usd: 0, lastEventAt: null });
  return {
    workers: rows, lastEventAt: totals.lastEventAt, events: totals.events, toolCalls: totals.toolCalls, messages: totals.messages,
    usage: { tokens: totals.tokens, usd: totals.usd, priced: rows.length === 0 || rows.every((row) => row.usage.priced) },
  };
}
export function runWorkerOwnership(driver, runId) {
  const workers = driver.coordinator.list()
    .filter((handle) => driver.coordination.task(handle.taskId)?.runId === runId);
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
export function sessionAttachmentUnproven(handle) {
  return Boolean(handle?.sessionRef)
    && handle.controllableAttached !== true
    && ['orphaned', 'exited', 'dead'].includes(handle.status)
    && (handle.status === 'orphaned' || handle.sessionPreservation?.state === 'preserved');
}
export function adoptionState(adoption) {
  if (!adoption) return null;
  if (adoption.status === 'adopted' || adoption.state === 'adopted' || adoption.receipt?.state === 'adopted') return 'adopted';
  return 'adopting';
}
export function _loadProfileRegistry(application) {
    const records = application.driver.coordination.eventsView().filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_PROFILE_RECORD_KIND);
    if (records.length > MAX_RUN_RECORDS) {
      throw applicationError('application profile registry exceeds its bounded lookup ceiling',
        'application_profile_registry_oversize');
    }
    for (const event of records) {
      const registered = normalizeProfileRegistryEvent(event);
      if (registered.repoId !== application.repoId) continue;
      const coordinate = profileRegistryCoordinate(registered.name, registered.profile.digest);
      const prior = application._profileRegistry.get(coordinate);
      if (prior && digest(profileDefinition(prior)) !== digest(profileDefinition(registered.profile))) {
        throw applicationError('application profile registry contains a conflicting definition',
          'application_profile_registry_invalid');
      }
      application._profileRegistry.set(coordinate, registered.profile);
    }
  }
export function _semanticControlTargets(application, current) {
    const definition = application._isWorkflowRun(current) ? application._workflowDefinition(current) : null;
    // #210: the narrow read serves the run's own dispatches (bounded clones of only those
    // rows); the full-store snapshot goalPlan deep clone is gone from this path, and #391 pages
    // what remains instead of refusing past a count.
    const dispatches = definition
      ? goalPlanReadAll(
        (cursor) => goalPlanDispatchesPage(application.driver.coordination, application.repoId,
          current.goal.runId, MAX_RUN_RECORDS, cursor),
      ) : [];
    const rows = application.driver.coordinator.list().filter((worker) => (
      worker.runId === current.goal.runId
      && Number.isSafeInteger(worker.fence)
      && ['working', 'blocked', 'interrupted'].includes(worker.status)
    )).map((worker) => {
      const task = application.driver.coordination.task(worker.taskId);
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
export function _runControls(application, runId = null) {
    if (runId === null) return application.driver.coordination.pendingRunControls(100_000);
    return application.driver.coordination.runControls(runId, 100_000);
  }
export function _controlOperationalState(application, control) {
    const workerEvents = application.driver.log.read(control.target.workerId);
    const events = workerEvents.filter((event) => event.payload?.controlId === control.controlId);
    const confirmed = control.operation === 'send'
      ? events.find((event) => ['control.nudge', 'control.steer', 'control.send']
        .includes(event.kind)
        || (event.kind === 'lifecycle.turn_started' && event.payload?.followUp === true))
      : events.find((event) => event.kind === 'control.interrupt_confirmed');
    if (confirmed) {
      if (control.operation === 'interrupt' && control.turnDisposition === 'preserve_turn') {
        const preservation = confirmed.payload?.preservation ?? null;
        const handle = application.driver.coordinator.list().find((candidate) => (
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
export function _beginRunControlEffect(application, control) {
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
    return application.driver.coordination.beginRunControlEffect({
      ...core, effectDigest: digest(core),
    }, {
      actor: control.source.actor,
      key: `run.control.begin:${control.controlId}`,
    }).control;
  }
export function _acknowledgeRunControl(application, control, state, outcome) {
    const normalized = application._normalizeRunControlOutcome(outcome, control.schemaVersion);
    const core = {
      schemaVersion: control.schemaVersion, controlId: control.controlId,
      effectDigest: control.effect.effectDigest,
      providerRequestId: control.effect.providerRequestId,
      state, outcome: normalized,
    };
    return application.driver.coordination.acknowledgeRunControl({
      ...core, ackDigest: digest(core),
    }, {
      actor: control.source.actor,
      key: `run.control.ack:${control.controlId}`,
    }).control;
  }
export function _settleRunControl(application, control, state, outcome) {
    const existing = application._runControls(control.runId)
      .find((candidate) => candidate.controlId === control.controlId);
    if (!['admitted', 'provider_acked'].includes(existing?.status)) return existing;
    const normalized = application._normalizeRunControlOutcome(outcome, control.schemaVersion);
    const core = {
      schemaVersion: control.schemaVersion, repoId: control.repoId, runId: control.runId,
      controlId: control.controlId, operation: control.operation,
      admissionDigest: control.admissionDigest, state, outcome: normalized,
    };
    application.driver.coordination.settleRunControl({
      ...core, settlementDigest: digest(core),
    }, {
      actor: control.source.actor,
      key: `run.control.settle:${control.controlId}`,
    });
    return application._runControls(control.runId)
      .find((candidate) => candidate.controlId === control.controlId);
  }
export function _runControlView(application, current, settled) {
    return application._buildView(current, application.principals.observer, {
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
export function _findRun(application, runId, { allowUnavailableProfile = false } = {}) {
    const indexed = typeof application.driver.coordination.goalPlanRun === 'function'
      ? application.driver.coordination.goalPlanRun(application.repoId, runId) : null;
    let goal; let plan; let approval; let dispatches; let dispatch;
    if (indexed) {
      ({ goal, plan, approval, dispatches, dispatch } = indexed);
    } else if (typeof application.driver.coordination.goalPlanRun !== 'function') {
      // #229 (measured 2026-08-20): on a modern store the narrow read is AUTHORITATIVE —
      // a miss means no goal/plan state exists for this run (same key dimensions the
      // snapshot filter would scan). The snapshot() fallback deep-clones the ENTIRE store
      // per member read — the 139s waves_list loop-block, healthz starved the whole way.
      // The fallback stays only for legacy stores without the narrow accessor.
      const snapshot = application.driver.coordination.snapshot();
      const goalPlan = snapshot.goalPlan;
      if (!goalPlan || goalPlan.goals.length > MAX_RUN_RECORDS || goalPlan.plans.length > MAX_RUN_RECORDS
        || goalPlan.approvals.length > MAX_RUN_RECORDS || goalPlan.dispatches.length > MAX_RUN_RECORDS) {
        throw applicationError('application run projection exceeds its bounded lookup ceiling', 'application_run_lookup_oversize');
      }
      const goals = goalPlan.goals.filter((row) => row.repoId === application.repoId && row.runId === runId)
        .sort((a, b) => b.version - a.version);
      [goal] = goals;
      const plans = goal ? goalPlan.plans.filter((row) => row.repoId === application.repoId && row.runId === runId
        && row.goal.goalId === goal.goalId && row.goal.version === goal.version && row.goal.digest === goal.digest)
        .sort((a, b) => b.version - a.version) : [];
      [plan] = plans;
      plan ??= null;
      approval = plan ? goalPlan.approvals.find((row) => row.plan.planId === plan.planId
        && row.plan.version === plan.version && row.plan.digest === plan.digest) ?? null : null;
      dispatches = plan ? goalPlan.dispatches.filter((row) => row.binding?.planId === plan.planId
        && row.binding?.planVersion === plan.version && row.binding?.planDigest === plan.digest)
        .sort((left, right) => (left.binding.nodeKey < right.binding.nodeKey ? -1 : 1)) : [];
      [dispatch] = dispatches;
      dispatch ??= null;
    }
    if (!goal) throw applicationError(`unknown run ${runId}`, 'application_run_not_found');
    const resultIdentity = resultIntentConstraint(goal.constraints);
    let relevantPlans = [];
    if (resultIdentity.resultIntent === 'read_only_evidence') {
      if (typeof application.driver.coordination.goalPlanRunPlans === 'function') {
        // #391: no read here refuses for having more rows — the walk resumes through the page
        // cursor to the whole bounded set, so only an unreadable store reads as unavailable.
        try {
          relevantPlans = goalPlanReadAll(
            (cursor) => goalPlanRunPlansPage(application.driver.coordination, application.repoId, runId,
              MAX_RUN_RECORDS, cursor),
          );
        } catch {
          throw applicationError('read-only Run Plan history is unavailable',
            'application_run_history_unavailable');
        }
      } else if (typeof application.driver.coordination.snapshot === 'function') {
        let goalPlan;
        try {
          ({ goalPlan } = application.driver.coordination.snapshot());
        } catch {
          throw applicationError('read-only Run Plan history is unavailable',
            'application_run_history_unavailable');
        }
        if (!Array.isArray(goalPlan?.plans)) {
          throw applicationError('read-only Run Plan history is unavailable',
            'application_run_history_unavailable');
        }
        if (goalPlan.plans.length > MAX_RUN_RECORDS) {
          throw applicationError('application run projection exceeds its bounded lookup ceiling',
            'application_run_lookup_oversize');
        }
        relevantPlans = goalPlan.plans.filter((candidate) => (
          candidate.repoId === application.repoId && candidate.runId === runId
          && candidate.goal.goalId === goal.goalId && candidate.goal.version === goal.version
          && candidate.goal.digest === goal.digest
        ));
      } else {
        throw applicationError('read-only Run Plan history is unavailable',
          'application_run_history_unavailable');
      }
      if (!Array.isArray(relevantPlans)) {
        throw applicationError('read-only Run Plan history is unavailable',
          'application_run_history_unavailable');
      }
      if (relevantPlans.length > MAX_RUN_RECORDS) {
        throw applicationError('application run projection exceeds its bounded lookup ceiling',
          'application_run_lookup_oversize');
      }
    }
    assertResultIntentCoherence(goal, relevantPlans);
    const profileRef = parseProfileConstraint(goal.constraints);
    const currentProfile = profileRef ? application.profiles.get(profileRef.name) : null;
    const profile = profileRef && currentProfile?.digest === profileRef.digest ? currentProfile
      : profileRef ? application._profileRegistry.get(profileRegistryCoordinate(profileRef.name, profileRef.digest)) ?? null
        : null;
    if (!profileRef || (!profile && !allowUnavailableProfile)) {
      throw applicationError(`run ${runId} deployment profile is unavailable`, 'application_profile_stale');
    }
    // Decision 4 item 4: readers resolve a spilled objective's citation transparently — the goal
    // record's stored head+citation becomes the full body at every projection seam (a routine
    // reader never sees the citation). Non-spilled goals pass through unchanged.
    const resolved = application._resolveSpillObjective(goal.objective);
    const resolvedGoal = resolved === goal.objective ? goal : { ...goal, objective: resolved };
    return {
      goal: resolvedGoal, plan, approval, dispatch, dispatches, profile, profileName: profileRef.name,
      profileDigest: profileRef.digest,
      profileState: profile ? 'available' : 'historical_definition_unavailable',
    };
  }
// #407 (audit C34): the Plan history ceiling is the workflow policy's own maxRounds —
// never a second literal. The bound definition record is read straight from events (never
// _workflowDefinition: it re-enters this walk for revision plans), then the deployment's
// live policy, then the legacy policy. Every source is policy-owned.
export function _workflowPlanHistoryPolicyBound(application, current) {
    try {
      if (typeof application.driver.coordination.eventsView === 'function') {
        const records = application.driver.coordination.eventsView().filter((event) => (
          event.kind === 'driver.recorded'
          && event.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
          && event.payload?.repoId === application.repoId
          && event.payload?.runId === current.goal.runId
          && event.payload?.planDigest === current.plan.digest
        ));
        if (records.length === 1) {
          const bound = workflowDefinitionPolicy(records[0].payload).maxRounds;
          if (Number.isSafeInteger(bound) && bound >= 2) return bound;
        }
      }
    } catch { /* the live deployment policy below is the fallback */ }
    try {
      const live = typeof application.driver.coordination.workflowPolicy === 'function'
        ? application.driver.coordination.workflowPolicy() : null;
      if (Number.isSafeInteger(live?.maxRounds) && live.maxRounds >= 2) return live.maxRounds;
    } catch { /* the legacy policy below is the fallback */ }
    return LEGACY_WORKFLOW_POLICY.maxRounds;
  }
export function _workflowPlanHistory(application, current) {
    if (!application._isWorkflowRun(current)) return [];
    // #210: the bounded Run Plan history (goalPlanRunPlans) serves this walk; the full-store
    // snapshot goalPlan deep clone is gone from this path (legacy stores without the narrow
    // accessor keep the snapshot fallback), and #391 pages the walk instead of refusing.
    let plans = [];
    if (typeof application.driver.coordination.goalPlanRunPlans === 'function') {
      plans = goalPlanReadAll(
        (cursor) => goalPlanRunPlansPage(application.driver.coordination, application.repoId,
          current.goal.runId, MAX_RUN_RECORDS, cursor),
      );
    } else if (typeof application.driver.coordination.snapshot === 'function') {
      const snapshot = application.driver.coordination.snapshot();
      plans = snapshot.goalPlan?.plans ?? [];
    }
    // #407 (audit C34): a proven cycle (a plan id seen twice) and a merely deep chain refuse
    // apart — the cycle names the repeated planId, the depth names the policy bound it met.
    const bound = application._workflowPlanHistoryPolicyBound(current);
    const chain = []; const seen = new Set();
    let cursor = current.plan;
    while (cursor) {
      const identity = `${cursor.planId}:${cursor.version}:${cursor.digest}`;
      if (seen.has(identity)) {
        throw applicationError('Workflow Plan history contains a repeated Plan',
          'workflow_plan_cycle', {
            planId: cursor.planId, chain: chain.map((entry) => entry.plan.planId),
          });
      }
      if (chain.length >= bound) {
        throw applicationError('Workflow Plan history exceeds its workflow policy bound',
          'workflow_plan_history_exceeds_policy', {
            bound, observed: chain.length, next: cursor.planId,
          });
      }
      seen.add(identity); chain.push(application._runAtPlan(current, cursor));
      if (cursor.predecessor === null) break;
      const predecessor = plans.find((plan) => plan.repoId === application.repoId
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
export function _completedResultExport(application, coordinates) {
    if (!coordinates || typeof coordinates !== 'object' || Array.isArray(coordinates)
      || Object.keys(coordinates).sort().join(',') !== ['exportId', 'repoId', 'runId'].join(',')
      || coordinates.repoId !== application.repoId || !validId(coordinates.runId)
      || !/^[a-f0-9]{64}$/u.test(coordinates.exportId ?? '')
      || application.driver.coordination.runStop?.(coordinates.runId)) return null;
    let current;
    try { current = application._findRun(coordinates.runId); } catch { return null; }
    const nodeKey = current.plan?.nodes?.[0]?.key;
    if (!nodeKey || current.profile.exportPolicy.mode !== 'manual') return null;
    const state = application.driver.coordination.runResultExport(coordinates.runId, nodeKey);
    if (state?.status !== 'completed' || state.exportId !== coordinates.exportId
      || state.receipt?.state !== 'completed') return null;
    return { current, state, receipt: clone(state.receipt) };
  }
export function openResultExportArchive(application, coordinates) {
    const completed = application._completedResultExport(coordinates);
    if (!completed || !application.exportRoot) throw applicationError('Run export is not deliverable', 'application_export_unavailable');
    const archive = application.resultExportLifecycle.deriveArchive({
      receipt: completed.receipt,
      maxArchiveBytes: resultExportArchiveCeiling(completed.current.profile.exportPolicy),
    });
    const chunkBytes = application.exportDeliveryChunkBytes;
    return {
      descriptor: archive.descriptor,
      chunks: (async function* archiveChunks() {
        for (let offset = 0; offset < archive.bytes.length; offset += chunkBytes) {
          yield archive.bytes.subarray(offset, Math.min(offset + chunkBytes, archive.bytes.length));
        }
      }()),
    };
  }
export function registerResultExportDelivery(application, { runId, exportId, signal, abort }) {
    const completed = application._completedResultExport({ repoId: application.repoId, runId, exportId });
    if (!completed || !(signal instanceof AbortSignal) || typeof abort !== 'function') {
      throw applicationError('Run export delivery registration is unavailable', 'application_export_unavailable');
    }
    const registrations = application._runDeliveryRegistrations.get(runId) ?? new Set();
    application._runDeliveryRegistrations.set(runId, registrations);
    let close;
    const closed = new Promise((resolveClosed) => { close = resolveClosed; });
    const registration = { exportId, abort, closed };
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      signal.removeEventListener('abort', release);
      registrations.delete(registration);
      if (registrations.size === 0) application._runDeliveryRegistrations.delete(runId);
      close();
      return true;
    };
    registration.release = release;
    registrations.add(registration);
    signal.addEventListener('abort', release, { once: true });
    return Object.freeze({ release });
  }
export function _performResultExport(application, state) {
    const existing = application._runExportPromises.get(state.exportId);
    if (existing) return existing;
    const operation = (async () => {
      const current = application._findRun(state.runId);
      const policy = current.profile.exportPolicy;
      if (policy.mode !== 'manual' || current.profile.digest !== state.profileDigest
        || digest(policy) !== state.exportPolicyDigest || application.exportRootDigest !== state.exportRootDigest
        || policy.format !== state.format || policy.maxFiles !== state.maxFiles || policy.maxBytes !== state.maxBytes) {
        throw applicationError('pending Run export deployment authority changed', 'application_export_policy_stale');
      }
      const task = application.driver.coordination.task(state.taskId);
      if (!task?.assignee || task.runId !== state.runId) {
        throw applicationError('pending Run export task authority is unavailable', 'application_export_unavailable');
      }
      let materialized;
      try {
        materialized = await application.resultExportLifecycle.materialize((exportRoot) =>
          application.driver.coordinator.materializeAcceptedResult(task.assignee, state.resultSha, {
          exportRoot,
          exportId: state.exportId,
          stagingNonce: state.stagingNonce,
          policy: clone(policy),
          manifestCore: {
            repoId: application.repoId,
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
      const retained = await application.driver.coordinator.inspectPreservedResult(task.assignee, state.resultSha);
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
      const completed = application.driver.coordination.completeRunResultExport({
        schemaVersion: 1, exportId: state.exportId, receipt,
      }, { actor: state.actor, key: `run.result_export.complete:${state.exportId}` });
      return completed.export.receipt;
    })();
    application._runExportPromises.set(state.exportId, operation);
    operation.finally(() => {
      if (application._runExportPromises.get(state.exportId) === operation) application._runExportPromises.delete(state.exportId);
    }).catch(() => {});
    return operation;
  }
export function _semanticTarget(application, current, view) {
    const node = view.nodes[0];
    if (!current.plan || !node?.taskId || !view.result?.sha
      || !view.result.commitArtifact || !view.result.verificationArtifact) return null;
    const task = application.driver.coordination.task(node.taskId);
    if (!task?.assignee || typeof application.driver.coordinator.inspectCapturedChanges !== 'function') return null;
    const changedPaths = application.driver.coordinator.inspectCapturedChanges(task.assignee, view.result.sha, 1_024);
    const core = {
      schemaVersion: 1,
      repoId: application.repoId,
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
export function _performResultAdoption(application, adoption) {
    const key = `${adoption.runId}\0${adoption.nodeKey}`;
    const existing = application._runAdoptionPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const current = application.driver.coordination.runResultAdoption(adoption.runId, adoption.nodeKey);
      if (!current) throw applicationError('Run result adoption admission is unavailable', 'application_adoption_incomplete');
      if (current.status === 'adopted') return current.receipt;
      const task = application.driver.coordination.task(current.taskId);
      if (!task?.assignee) throw applicationError('Run result adoption worker authority is unavailable', 'application_adoption_incomplete');
      const pinned = await application.driver.coordinator.preserveResult(task.assignee, current.resultSha);
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
      return application.driver.coordination.completeRunResultAdoption({
        schemaVersion: 1, runId: current.runId, nodeKey: current.nodeKey, receipt,
      }, { actor: current.actor, key: `run.result_adoption.complete:${current.runId}:${current.nodeKey}` }).adoption.receipt;
    })();
    application._runAdoptionPromises.set(key, operation);
    operation.finally(() => {
      if (application._runAdoptionPromises.get(key) === operation) application._runAdoptionPromises.delete(key);
    }).catch(() => {});
    return operation;
  }
export function _performRunStop(application, stop) {
    const existing = application._runStopPromises.get(stop.runId);
    if (existing) return existing;
    const operation = (async () => {
      const current = application.driver.coordination.runStop(stop.runId);
      if (!current) throw applicationError('Run stop admission is unavailable', 'application_run_stop_incomplete');
      if (current.status === 'stopped') return current.receipt;
      const targetRunIds = current.targetRunIds ?? [stop.runId];
      const contextOperations = [];
      for (const targetRunId of targetRunIds) {
        await application._abortResultExportDeliveries(targetRunId);
        for (const operation of application._contextControllers?.get(targetRunId) ?? []) {
          operation.controller.abort();
          contextOperations.push(operation.settled);
        }
      }
      await Promise.allSettled(contextOperations);
      // VR6: stop cancels an in-flight verifier retry exactly and settles its durable admission.
      for (const targetRunId of targetRunIds) {
        for (const controller of application._runRetryControllers.get(targetRunId) ?? []) controller.abort();
      }
      if (typeof application.driver.coordination.pendingRunVerificationRetries === 'function') {
        for (const pending of application.driver.coordination.pendingRunVerificationRetries()
          .filter((row) => targetRunIds.includes(row.runId))) {
          try { application._cancelRunVerificationRetry(pending); }
          catch (error) {
            // The in-flight performer may have settled the same admission concurrently; a
            // deterministic identical cancellation replays, anything else already completed it.
            if (error?.code !== 'run_verification_retry_conflict') throw error;
          }
        }
      }
      const outcome = await application.driver.coordinator.stopRunTargets(current.targetWorkerIds, current.actor);
      if (outcome.targetCount !== current.targetWorkerIds.length
        || outcome.remainingCount !== 0
        || outcome.counts.pendingCancelled + outcome.counts.killConfirmed + outcome.counts.alreadyTerminal !== outcome.targetCount
        || outcome.counts.processesObserved !== outcome.counts.processesClosed
        || outcome.checks.interactionsResolved !== true || outcome.checks.runAuthorityReleased !== true) {
        throw applicationError('Run stop/reap result is incomplete', 'application_run_stop_incomplete', { outcome });
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
              application.driver.coordination.contextSession(sessionId)?.state !== 'stopped'
            )).length,
            remainingCellCount: current.targetContextCellIds.filter((cellId) => (
              application.driver.coordination.contextCell(cellId)?.state !== 'stopped'
            )).length,
            ...(current.schemaVersion >= 3 ? {
              // #390: a call that reads `stopping` is waiting on exactly the run.stop_completed
              // receipt this receipt IS, so it counts as ended here — never as remaining.
              remainingCallCount: current.targetContextCallIds.filter((callId) => (
                !['completed', 'failed', 'stopped', 'stopping'].includes(
                  application.driver.coordination.contextCall(callId)?.state,
                )
              )).length,
            } : {}),
          },
        } : {}),
      };
      const receipt = deepFreeze({ ...core, receiptDigest: digest(core) });
      const completed = application.driver.coordination.completeRunStop(current.runId, receipt, {
        actor: current.actor, key: `run.stop.complete:${current.runId}`,
      });
      return completed.stop.receipt;
    })();
    application._runStopPromises.set(stop.runId, operation);
    operation.catch(() => {
      if (application._runStopPromises.get(stop.runId) === operation) application._runStopPromises.delete(stop.runId);
    });
    return operation;
  }
export function _recursiveLease(application, principal, context) {
    const sessionAuthority = context?.sessionAuthority ?? null;
    if (!sessionAuthority) return null;
    const coordination = application.driver.coordination;
    if (typeof coordination.runOrchestratorLease !== 'function'
      || typeof coordination.authorizeRunOrchestratorCommand !== 'function') {
      throw applicationError('recursive Run authority is unavailable', 'run_orchestrator_lease_not_found');
    }
    const lease = coordination.runOrchestratorLease(sessionAuthority.orchestratorLeaseId);
    if (!lease) throw applicationError('recursive Run lease is unavailable', 'run_orchestrator_lease_not_found');
    if (lease.repoId !== application.repoId || lease.session.principalId !== principal.principalId
      || lease.session.sessionId !== principal.sessionId
      || lease.session.authorityDigest !== sessionAuthority.authorityDigest
      || lease.session.expiresAt !== sessionAuthority.expiresAt) {
      throw applicationError('recursive Run session does not match its lease', 'run_orchestrator_session_mismatch');
    }
    return lease;
  }
export function _recursiveAuth(application, principal, context, key) {
    const lease = application._recursiveLease(principal, context);
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
export async function _goalPlanStatus(application, current, observer) {
    return application.driver.coordinator.goalPlanStatus(
      refs(current.goal, current.plan),
      authority(observer, application.repoId, current.goal.runId, 'goal:observe', `application:${current.goal.runId}:status:${current.plan.digest}`),
    );
  }
export function _buildWorkflowEvidence(application, current, view) {
    const runId = current.goal.runId;
    const resultIdentity = resultIntentConstraint(current.goal.constraints);
    const roundPlanDigests = new Set((view.rounds ?? []).map((round) => round.plan.digest));
    const workflowKinds = new Set([
      APPLICATION_WORKFLOW_RECORD_KIND,
      APPLICATION_WORKFLOW_SELECTION_RECORD_KIND,
      APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND,
      APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND,
      APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND,
    ]);
    const workflowSeqs = application.driver.coordination.eventsView().filter((event) => (
      event.kind === 'driver.recorded' && workflowKinds.has(event.payload?.kind)
      && event.payload?.repoId === application.repoId && event.payload?.runId === runId
      && roundPlanDigests.has(event.payload?.planDigest)
    )).map((event) => event.seq);
    const taskSeqs = view.nodes.flatMap((node) => {
      const task = node.taskId ? application.driver.coordination.task(node.taskId) : null;
      return task ? [task.createdEvent, task.claimedEvent, task.terminalEvent] : [];
    }).filter(Number.isSafeInteger);
    const artifactSeqs = view.candidates.flatMap((candidate) => (
      [candidate.evidence.commitArtifact.id, candidate.evidence.verificationArtifact.id]
        .map((artifactId) => application.driver.coordination.artifact(artifactId)?.createdEvent)
    )).filter(Number.isSafeInteger);
    const historicalArtifactSeqs = (view.rounds ?? []).flatMap((round) => (
      round.candidates.flatMap((candidate) => (
        [candidate.evidence.commitArtifact.id, candidate.evidence.verificationArtifact.id]
          .map((artifactId) => application.driver.coordination.artifact(artifactId)?.createdEvent)
      ))
    )).filter(Number.isSafeInteger);
    const runStop = application.driver.coordination.runStop?.(runId) ?? null;
    const relevantSeqs = [
      ...workflowSeqs, ...taskSeqs, ...artifactSeqs, ...historicalArtifactSeqs,
      runStop?.admittedEvent, runStop?.completedEvent,
    ].filter(Number.isSafeInteger);
    const core = {
      schemaVersion: resultIdentity.explicit ? 2 : 1,
      kind: 'baton.workflow.evidence',
      state: APPLICATION_RUN_TERMINAL_PHASES.has(view.phase) ? 'terminal' : 'provider_settled',
      repoId: application.repoId,
      runId,
      ...(resultIdentity.explicit ? { resultIntent: resultIdentity.resultIntent } : {}),
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
export function _performRunVerificationRetry(application, admission) {
    const key = `${admission.runId}\0${admission.nodeKey}\0${admission.attempt}`;
    const existing = application._runRetryPromises.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const controllers = application._runRetryControllers.get(admission.runId) ?? new Set();
    controllers.add(controller);
    application._runRetryControllers.set(admission.runId, controllers);
    const operation = (async () => {
      const current = application.driver.coordination.runVerificationRetry(admission.runId, admission.nodeKey);
      if (!current || current.attempt !== admission.attempt) {
        throw applicationError('Run verification retry admission is unavailable', 'application_retry_incomplete');
      }
      if (current.status !== 'pending') return current.receipt;
      const task = application.driver.coordination.task(current.taskId);
      if (!task?.assignee) throw applicationError('Run verification retry worker authority is unavailable', 'application_retry_incomplete');
      try {
        return await application.driver.coordinator.retryVerification(task.assignee, {
          runId: current.runId, nodeKey: current.nodeKey, attempt: current.attempt, signal: controller.signal,
        });
      } catch (error) {
        if (error?.code === 'verification_retry_cancelled') {
          throw applicationError('Run verification retry was cancelled by stop authority', 'application_retry_cancelled');
        }
        throw error;
      }
    })();
    application._runRetryPromises.set(key, operation);
    operation.finally(() => {
      if (application._runRetryPromises.get(key) === operation) application._runRetryPromises.delete(key);
      controllers.delete(controller);
      if (controllers.size === 0 && application._runRetryControllers.get(admission.runId) === controllers) {
        application._runRetryControllers.delete(admission.runId);
      }
    }).catch(() => {});
    return operation;
  }
export function _cancelRunVerificationRetry(application, pending) {
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
    return application.driver.coordination.completeRunVerificationRetry({
      schemaVersion: 1, runId: pending.runId, nodeKey: pending.nodeKey, attempt: pending.attempt, receipt, manifests: [],
    }, { actor: pending.actor, key: `run.verification_retry.complete:${pending.runId}:${pending.nodeKey}:${pending.attempt}` });
  }
/**
   * Issue #489: judge a composed Run view against the deployment's projection ceiling — AFTER
   * narrowing. `view.run.bytes` is the registry's `shed-flagged` row, and the incident was that
   * the refusal fired BEFORE any narrowing ran: `run show <run> --depth outline` refused for the
   * very run the refusal prescribed narrowing for, and every `recruit --issue` refused because the
   * participant's own start built a view nobody reads. A caller that asked for a narrowing
   * (`options.narrow`, set by the `run.inspect` ladder and by the participant's start) gets the
   * SHED view: the sections the ladder names are replaced by their references, one at a time,
   * until the view fits — and the view SAYS what it shed, what each cost and the read that serves
   * it. A caller that asked for the whole view keeps the typed refusal, now naming the section
   * that dominates the view and the narrowing that actually works.
   */
export function _finalizeRunView(application, current, view, options = {}) {
    const runId = current?.goal?.runId ?? null;
    const observed = Buffer.byteLength(JSON.stringify(view), 'utf8');
    if (observed <= MAX_RUN_VIEW_BYTES) return deepFreeze(view);
    if (options.narrow !== true) throw application._runViewOversizeRefusal(runId, view, observed, []);
    const shed = [];
    let narrowed = view;
    for (const step of RUN_VIEW_SHED_STEPS) {
      const before = Buffer.byteLength(JSON.stringify(narrowed), 'utf8');
      if (before <= MAX_RUN_VIEW_BYTES) break;
      const replacement = step.shed(narrowed);
      if (replacement === null) continue;
      const candidate = { ...narrowed, ...replacement };
      const after = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
      // A step that did not PAY is rolled back: a reference that costs as much as the value it
      // replaced is not a narrowing, and the section stays whole.
      if (after >= before) continue;
      narrowed = candidate;
      shed.push(Object.freeze({ section: step.section, bytes: before - after, read: step.read }));
    }
    const remaining = Buffer.byteLength(JSON.stringify(narrowed), 'utf8');
    if (remaining > MAX_RUN_VIEW_BYTES) throw application._runViewOversizeRefusal(runId, narrowed, remaining, shed);
    return deepFreeze({ ...narrowed, narrowed: Object.freeze({
      ceiling: MAX_RUN_VIEW_BYTES, sections: Object.freeze(shed), read: runViewNarrowedRead(runId),
    }) });
  }
export function _planningView(application, current, cause = null, principal = application.principals.observer, options = {}) {
    const resultIdentity = resultIntentConstraint(current.goal.constraints);
    const resultIntent = resultIdentity.resultIntent;
    const runStop = application.driver.coordination.runStop?.(current.goal.runId) ?? null;
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
      // Issue #489: the goal's objective rides ONCE, with the byte length a reader can compare
      // against — the plan preview and the node rows that follow carry only its reach.
      objective: current.goal.objective,
      objectiveBytes: Buffer.byteLength(current.goal.objective, 'utf8'),
      resultIntent,
      profile: { name: current.profileName, digest: current.profile.digest },
      phase,
      cursor: application.driver.coordination.eventCursor(),
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
      blockedInteraction: projectBlockedInteraction(phase, []),
      waitingOn: null,
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
    const semanticProgress = application._semanticProgressProjection(current, view, principal);
    view.progressClass = semanticProgress.progressClass;
    if (semanticProgress.requiredAction) view.requiredAction = semanticProgress.requiredAction;
    return application._finalizeRunView(current, view, options);
  }
export async function _historicalProfileView(application, current, observer, options = {}) {
    const runId = current.goal.runId;
    const resultIntent = resultIntentFromConstraints(current.goal.constraints);
    if (options.expected) {
      throw applicationError('historical Run policy is unavailable for mutation replay', 'application_profile_stale');
    }
    const projection = current.plan ? await application._goalPlanStatus(current, observer) : null;
    const node = projection?.nodes?.[0] ?? null;
    const task = node?.taskId ? application.driver.coordination.task(node.taskId) : null;
    const workerId = task?.assignee ?? null;
    const scratchpad = workerId && typeof application.driver.coordination.scratchpadSnapshotBatch === 'function'
      ? projectScratchpadView(application.driver.coordination.scratchpadSnapshotBatch(
        runId, [`worker:${workerId}`, 'shared'],
      ), { role: 'orchestrator', requestedWorkerId: workerId }, application._scratchpadViewCache)
      : null;
    let terminalResult = null;
    if (workerId) {
      try { terminalResult = await application.driver.coordinator.result(workerId); }
      catch (error) { if (error?.code !== 'not_found') throw error; }
    }
    let phase = !current.plan ? 'planning'
      : !projection?.approval ? 'awaiting_plan_approval'
        : projection.approval.disposition === 'rejected' ? 'denied'
          : node?.state === 'accepted' ? 'work_completed'
            : node?.state === 'failed' ? 'failed'
              : node?.state === 'cancelled' ? 'cancelled'
                // Issue #31 §2.1(3): a parked turn is neither finished nor merely 'running'.
                // Rendering it 'running' is the dishonest projection the spec forbids.
                : node?.state === 'paused' ? 'paused'
                  : node?.taskId ? 'running' : 'approved';
    const runStop = application.driver.coordination.runStop?.(runId) ?? null;
    if (runStop?.status === 'stopped') phase = 'stopped';
    else if (runStop) phase = 'stopping';
    const { workers, ownedWorkers } = runWorkerOwnership(application.driver, runId);
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
    const historicalAttention = phase === 'interruption_uncertain' ? [{
      kind: 'session_preservation', state: 'quarantined',
      reason: 'session_attachment_unproven',
      summary: 'Reusable provider-session attachment is unproven; whole-Run stop is the only safe action.',
    }] : [];
    // Issue #489: the goal's objective rides ONCE (below), and the preview and the node rows carry
    // only its reach — the bounded first line plus the byte length a reader did not get.
    const objectiveBytes = Buffer.byteLength(current.goal.objective, 'utf8');
    const objectiveLine = objectiveFirstLine(current.goal.objective);
    const view = {
      schemaVersion: 1,
      runId,
      objective: current.goal.objective,
      objectiveBytes,
      resultIntent,
      profile: {
        name: current.profileName, digest: current.profileDigest,
        state: 'historical_definition_unavailable',
      },
      policy: {
        state: 'unavailable', reason: 'historical_profile_definition_unavailable',
        currentProfileApplied: false, mutationAuthority: 'closed',
      },
      phase,
      cursor: projection?.coordinationUpperBound ?? application.driver.coordination.eventCursor(),
      nextActions: runStop || ownedWorkers.length === 0 ? [] : [{ kind: 'stop' }],
      goal: { id: current.goal.goalId, version: current.goal.version, digest: current.goal.digest },
      plan: current.plan ? {
        id: current.plan.planId, version: current.plan.version, digest: current.plan.digest,
        approval: projection?.approval ? {
          disposition: projection.approval.disposition, digest: projection.approval.digest,
        } : null,
      } : null,
      planPreview: planNode ? {
        objective: objectiveLine,
        objectiveRef: objectiveReach(objectiveBytes),
        definitionOfDone: clone(current.goal.definitionOfDone), constraints: clone(current.goal.constraints),
        risk: current.goal.risk, goalBudget: clone(current.goal.budget),
        node: {
          key: planNode.key, objectiveRef: objectiveReach(objectiveBytes),
          pathScope: clone(planNode.pathScope),
          ...(planNode.contextScope ? { contextScope: clone(planNode.contextScope) } : {}),
          risk: planNode.risk, budget: clone(planNode.budget), verification: clone(planNode.verification),
          route: requested, capabilities: clone(planNode.capabilities), effects: clone(planNode.effects),
        },
        profileDigest: current.profileDigest, planDigest: current.plan.digest,
        resultIntent,
      } : null,
      nodes: boundedPlanNodes(projection?.nodes, objectiveLine, objectiveBytes),
      scratchpad,
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
      attention: historicalAttention, attentionTruncated: false,
      blockedInteraction: projectBlockedInteraction(phase, historicalAttention),
      waitingOn: null,
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
    const semanticProgress = application._semanticProgressProjection(current, view, observer);
    view.progressClass = semanticProgress.progressClass;
    if (semanticProgress.requiredAction) view.requiredAction = semanticProgress.requiredAction;
    return application._finalizeRunView(current, view, options);
  }
export function _workflowDefinitionAncestors(application, runId, excludeDigest = null, beforeSeq = Infinity) {
    return application.driver.coordination.eventsView().filter((candidate) => (
      candidate.seq < beforeSeq && candidate.kind === 'driver.recorded'
        && candidate.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
        && candidate.payload?.repoId === application.repoId
        && candidate.payload?.runId === runId
        && candidate.payload?.definitionDigest !== excludeDigest
    )).map((candidate) => candidate.payload);
  }
export function _workflowDefinition(application, current) {
    if (!application._isWorkflowRun(current)) return null;
    const records = application.driver.coordination.eventsView().filter((event) => event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_RECORD_KIND
      && event.payload?.repoId === application.repoId && event.payload?.runId === current.goal.runId
      && event.payload?.planDigest === current.plan.digest);
    if (current.plan.nodes.length === 1 && current.plan.nodes[0]?.revision) {
      if (records.length > 1) {
        throw applicationError('workflow revision definition binding is ambiguous',
          'application_workflow_integrity');
      }
      return application._workflowRevisionDefinition(current, records[0] ?? null);
    }
    if (records.length !== 1) {
      throw applicationError('workflow definition binding is absent or ambiguous',
        'application_workflow_integrity');
    }
    const event = records[0];
    const { kind, definitionDigest, ...core } = event.payload;
    void kind;
    if (core.schemaVersion === 3) {
      const ancestors = application._workflowDefinitionAncestors(
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
        || core.repoId !== application.repoId || core.runId !== current.goal.runId
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
      || core.repoId !== application.repoId || core.runId !== current.goal.runId
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
export function _workflowSuccessorDefinitionCore(application, {
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
        repoId: application.repoId, runId: current.goal.runId,
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
        ancestors: application._workflowDefinitionAncestors(current.goal.runId),
      });
      return core;
    }
    if (targetSchemaVersion === 3) {
      const roleCatalog = application._workflowRoleCatalog(predecessorCurrent, predecessorDefinition);
      const logicalRole = priorAttempt.role;
      const core = {
        schemaVersion: 3,
        repoId: application.repoId, runId: current.goal.runId,
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
      repoId: application.repoId, runId: current.goal.runId,
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
export function _workflowRevisionDefinition(application, current, record = null) {
    const node = current.plan?.nodes[0];
    const revision = node?.revision ? normalizeWorkflowRevision(node.revision) : null;
    if (!revision || current.plan.predecessor === null
      || revision.predecessorPlan.planId !== current.plan.predecessor.planId
      || revision.predecessorPlan.version !== current.plan.predecessor.version
      || revision.predecessorPlan.digest !== current.plan.predecessor.digest) {
      throw applicationError('Workflow revision Plan lacks its exact predecessor authority',
        'application_workflow_integrity');
    }
    const history = application._workflowPlanHistory(current);
    if (history.length < 2 || history.at(-1).plan.digest !== current.plan.digest) {
      throw applicationError('Workflow revision history is incomplete',
        'application_workflow_integrity');
    }
    const predecessor = history.at(-2);
    const predecessorDefinition = application._workflowDefinition(predecessor);
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
    const core = application._workflowSuccessorDefinitionCore({
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
export function _workflowCandidates(application, current, projection, definition) {
    const candidates = [];
    for (const binding of definition.attempts) {
      const node = projection.nodes.find((candidate) => candidate.key === binding.nodeKey);
      if (node?.state !== 'accepted') continue;
      const task = node.taskId ? application.driver.coordination.task(node.taskId) : null;
      if (!task) {
        throw applicationError('accepted Workflow Attempt has no durable task',
          'application_workflow_integrity');
      }
      const artifacts = (task.artifactIds ?? []).map((artifactId) => (
        application.driver.coordination.artifact(artifactId)
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
        ? application.driver.log.read(worker).find((event) => event.seq === workerSeq
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
        schemaVersion: 1, repoId: application.repoId, runId: current.goal.runId,
        planDigest: current.plan.digest, definitionDigest: definition.definitionDigest,
        role: binding.role, nodeKey: binding.nodeKey, taskId: task.id,
        resultSha: commit.refs.sha, changedPaths,
        evidence: evidenceCore, evidenceDigest: digest(evidenceCore),
      };
      candidates.push(deepFreeze({
        ...core,
        verification: application._closedVerdictProjection(
          operational.payload,
          current.plan.nodes.find((candidate) => candidate.key === binding.nodeKey),
          'completed', worker,
        ),
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
export function _workflowSelection(application, current, definition, candidates) {
    const records = application.driver.coordination.eventsView().filter((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_SELECTION_RECORD_KIND
      && event.payload?.repoId === application.repoId && event.payload?.runId === current.goal.runId
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
      || core.schemaVersion !== 1 || core.repoId !== application.repoId
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
export function _workflowFeedback(application, current, definition, candidates) {
    const records = application.driver.coordination.eventsView().filter((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND
      && event.payload?.repoId === application.repoId && event.payload?.runId === current.goal.runId
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
        || core.schemaVersion !== 1 || core.repoId !== application.repoId
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
export function _workflowMemberStops(application, current, definition) {
    const events = application.driver.coordination.eventsView().filter((event) => (
      event.kind === 'driver.recorded'
      && [APPLICATION_WORKFLOW_MEMBER_STOP_ADMITTED_KIND,
        APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND].includes(event.payload?.kind)
      && event.payload?.repoId === application.repoId && event.payload?.runId === current.goal.runId
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
      const task = core.taskId ? application.driver.coordination.task(core.taskId) : null;
      const target = {
        repoId: application.repoId, runId: current.goal.runId, planDigest: current.plan.digest,
        role: core.role, nodeKey: core.nodeKey, taskId: core.taskId, workerId: core.workerId,
      };
      if (Object.keys(core).sort().join(',') !== fields.sort().join(',')
        || core.schemaVersion !== 1 || core.repoId !== application.repoId
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
        || core.schemaVersion !== 1 || core.repoId !== application.repoId
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
export function _performWorkflowMemberStop(application, current, definition, stop) {
    const key = `${current.goal.runId}\0${stop.role}`;
    const existing = application._workflowMemberStopPromises.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const projected = application._workflowMemberStops(current, definition)
        .find((row) => row.role === stop.role);
      if (!projected) {
        throw applicationError('Workflow member stop admission is unavailable',
          'application_workflow_member_stop_incomplete');
      }
      if (projected.status === 'stopped') return projected.receipt;
      const outcome = await application.driver.coordinator.stopRunTargets(
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
        schemaVersion: 1, repoId: application.repoId, runId: current.goal.runId,
        planDigest: current.plan.digest, definitionDigest: definition.definitionDigest,
        role: projected.role, nodeKey: projected.nodeKey, taskId: projected.taskId,
        workerId: projected.workerId, targetDigest: projected.targetDigest,
        admissionDigest: projected.admissionDigest, state: 'stopped',
        outcome: clone(outcome),
      };
      application.driver.coordination.recordDriver(APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND, {
        ...core, completionDigest: digest(core),
      }, {
        actor: projected.source.actor,
        key: `${APPLICATION_WORKFLOW_MEMBER_STOP_COMPLETED_KIND}:${current.goal.runId}:${current.plan.digest}:${projected.role}`,
      });
      const completed = application._workflowMemberStops(current, definition)
        .find((row) => row.role === projected.role);
      if (completed?.status !== 'stopped') {
        throw applicationError('Workflow member stop completion is unavailable',
          'application_workflow_member_stop_incomplete');
      }
      return completed.receipt;
    })();
    application._workflowMemberStopPromises.set(key, operation);
    operation.finally(() => {
      if (application._workflowMemberStopPromises.get(key) === operation) {
        application._workflowMemberStopPromises.delete(key);
      }
    }).catch(() => {});
    return operation;
  }
export function _workflowRevisionFeedbackRows(application, feedback, candidate) {
    const byId = new Map(application.driver.coordination.eventsView().filter((event) => (
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
export async function _workflowRoundSummaries(application, current, observer) {
    const history = application._workflowPlanHistory(current);
    const summaries = [];
    for (let index = 0; index < history.length; index += 1) {
      const roundCurrent = history[index];
      const definition = application._workflowDefinition(roundCurrent);
      const projection = await application._goalPlanStatus(roundCurrent, observer);
      const candidates = application._workflowCandidates(roundCurrent, projection, definition);
      const selection = application._workflowSelection(roundCurrent, definition, candidates);
      const feedback = application._workflowFeedback(roundCurrent, definition, candidates);
      const memberStops = application._workflowMemberStops(roundCurrent, definition);
      const attempts = definition.attempts.map((attempt) => {
        const node = projection.nodes.find((candidate) => candidate.key === attempt.nodeKey);
        const candidate = candidates.find((entry) => entry.role === attempt.role) ?? null;
        return {
          role: attempt.role, nodeKey: attempt.nodeKey, taskId: node?.taskId ?? null,
          state: node?.state ?? 'blocked', route: clone(workflowAttemptRoute(definition, attempt)),
          candidateId: candidate?.candidateId ?? null,
          verification: clone(candidate?.verification ?? null),
        };
      });
      const allSettled = attempts.every((attempt) => (
        ['accepted', 'failed', 'cancelled', 'stale'].includes(attempt.state)
      ));
      const readOnlyResult = resultIntentFromConstraints(current.goal.constraints)
        === 'read_only_evidence';
      const state = !projection.approval ? 'awaiting_plan_approval'
        : projection.approval.disposition === 'rejected' ? 'denied'
          : selection ? 'candidate_selected'
            : readOnlyResult && allSettled && candidates.length > 0 ? 'completed'
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
export async function _buildWorkflowView(application, current, observer, options = {}) {
    if (current.plan.nodes.some((node) => node.revision)) {
      await application._validateWorkflowRevisionPlan(current);
    }
    const definition = application._workflowDefinition(current);
    const projection = await application._goalPlanStatus(current, observer);
    const candidates = application._workflowCandidates(current, projection, definition);
    const selection = application._workflowSelection(current, definition, candidates);
    const feedback = application._workflowFeedback(current, definition, candidates);
    const memberStops = application._workflowMemberStops(current, definition);
    const revisionEligibility = await application._workflowRevisionEligibility(current, {
      definition, projection, candidates, selection, feedback,
    });
    const rounds = await application._workflowRoundSummaries(current, observer);
    const runId = current.goal.runId;
    const { workers, ownedWorkers } = runWorkerOwnership(application.driver, runId);
    const story = application.driver.story.snapshot();
    const handlesByTask = new Map(workers.map((handle) => [handle.taskId, handle]));
    const handlesById = new Map(workers.map((handle) => [handle.id, handle]));
    const attempts = [];
    const resultsByTask = new Map();
    for (const binding of definition.attempts) {
      const planNode = current.plan.nodes.find((node) => node.key === binding.nodeKey);
      const node = projection.nodes.find((candidate) => candidate.key === binding.nodeKey);
      const task = node?.taskId ? application.driver.coordination.task(node.taskId) : null;
      const handle = task ? handlesByTask.get(task.id) ?? null : null;
      const workerStory = handle ? story.workers[handle.id] ?? null : null;
      let terminalResult = null;
      if (handle) {
        try { terminalResult = await application.driver.coordinator.result(handle.id); }
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
      const attemptVerification = application._closedVerdictProjection(
        terminalResult, planNode, node?.state ?? 'blocked', handle?.id ?? null,
      ) ?? {
        state: node?.state === 'accepted' ? 'mechanically_verified'
          : node?.state === 'failed' ? 'failed' : 'pending',
        accepted: node?.state === 'accepted',
      };
      const scratchpadRef = task?.assignee
        && typeof application.driver.coordination.scratchpadSnapshotBatch === 'function'
        ? {
          workerId: task.assignee, taskId: task.id,
          fenceTuple: application.driver.coordination.scratchpadSnapshotBatch(
            runId, [`worker:${task.assignee}`, 'shared'],
          ).fenceTuple,
        } : null;
      attempts.push({
        role: binding.role, nodeKey: binding.nodeKey, taskId: node?.taskId ?? null,
        scratchpadRef,
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
        verification: attemptVerification,
        terminalCause: projectTypedTerminalCause({
          terminalResult, terminalOutcome: node?.terminalOutcome ?? null,
        }),
      });
    }
    const runStop = application.driver.coordination.runStop?.(runId) ?? null;
    const selectedCandidate = selection
      ? candidates.find((candidate) => candidate.candidateId === selection.candidate.id) ?? null
      : null;
    const selectedTask = selectedCandidate
      ? application.driver.coordination.task(selectedCandidate.taskId) : null;
    let selectedPreservation = null;
    if (selectedTask?.assignee && selectedCandidate) {
      // #216 (row-git-batch): consume the page-level batched resolution when the selected
      // candidate's (assignee, resultSha) was pre-resolved; otherwise fall back to the
      // single-ref inspection (one process for this one view).
      const preserved = options?.preservedResults;
      if (preserved instanceof Map && preserved.has(`${selectedTask.assignee}\0${selectedCandidate.resultSha}`)) {
        selectedPreservation = preserved.get(`${selectedTask.assignee}\0${selectedCandidate.resultSha}`);
      } else if (typeof application.driver.coordinator.inspectPreservedResult === 'function') {
        selectedPreservation = await application.driver.coordinator.inspectPreservedResult(
          selectedTask.assignee, selectedCandidate.resultSha,
        );
      }
    }
    const selectedAdoption = selectedCandidate
      ? application.driver.coordination.runResultAdoption?.(runId, selectedCandidate.nodeKey) ?? null
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
    const resultIdentity = resultIntentConstraint(current.goal.constraints);
    const resultIntent = resultIdentity.resultIntent;
    const objectivePolicy = objectiveResultPolicy(resultIntent);
    const readOnlyResult = objectivePolicy.mode === 'read_only_evidence';
    let phase = !projection.approval ? 'awaiting_plan_approval'
      : projection.approval.disposition === 'rejected' ? 'denied'
        : selection ? (selectedIntegration ? 'completed' : 'candidate_selected')
          : readOnlyResult && allAccepted && candidates.length > 0 ? 'completed'
          : allSettled && candidates.length > 0 ? 'selection_required'
            : allSettled && anyFailed ? 'failed'
            // Issue #31 §2.1(3), 31-b Part F rule 14: a parked attempt is neither finished nor
            // merely 'running'. Checked BEFORE the `anyDispatched` fallback it would otherwise
            // fall through to, and left subordinate to the runStop precedence below.
            : attempts.some((attempt) => attempt.state === 'paused') ? 'paused'
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
      ? application.driver.coordination.task(currentRevisionAttempt.taskId) : null;
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
    const decisionAttention = projectDecisionAttention(application.driver.coordinator, workers);
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
    // 2026-09-14 audit (U-E10): the page derives from the deployment byte budget, never a row
    // count, and the required-action projection below still reads EVERY row (a truncated display
    // may never hide a required operator action).
    const allWorkflowAttention = [
      ...workerAttention, ...decisionAttention, ...selectionAttention, ...revisionAttention,
      ...recoveryAttention, ...preservationAttention,
    ];
    const attention = byteBoundedPage(allWorkflowAttention, ATTENTION_PAGE_BYTES).page;
    const blockedInteraction = projectBlockedInteraction(phase, attention);
    // issue #10 / docs/32 §5: the workflow view carries the same additive waitingOn projection;
    // the primary candidate task is the first member with durable dispatch authority.
    const workflowCandidateTask = definition.attempts
      .map((binding) => projection.nodes.find((candidate) => candidate.key === binding.nodeKey))
      .map((node) => (node?.taskId ? application.driver.coordination.task(node.taskId) : null))
      .find(Boolean) ?? null;
    const waitingOn = projectWaitingOn(application.driver, current, phase, workflowCandidateTask, workers, blockedInteraction);
    const decisionSettled = typeof application.driver.coordinator.decisionSettledProjection === 'function'
      ? application.driver.coordinator.decisionSettledProjection(workers.map((handle) => handle.id))
      : [];
    const terminalCause = attempts.find((attempt) => attempt.terminalCause)?.terminalCause ?? null;
    const verificationState = allAccepted ? 'mechanically_verified'
      : candidates.length > 0 && allSettled ? 'partially_verified'
        : anyFailed ? 'failed' : 'pending';
    const resourcesSettled = ownedWorkers.length === 0;
    const stages = [
      { key: 'intent', label: 'Workflow intent', state: 'complete', detail: 'Workflow definition bound to exact Goal and Plan.' },
      { key: 'plan', label: 'Workflow Plan', state: projection.approval?.disposition === 'approved' ? 'complete' : 'active', detail: `${attempts.length} attributable isolated Attempts.` },
      { key: 'wave', label: 'Parallel Wave', state: allSettled ? 'complete' : anyDispatched ? 'active' : 'pending', detail: `${attempts.filter((attempt) => ['accepted', 'failed', 'cancelled'].includes(attempt.state)).length}/${attempts.length} settled.` },
      { key: 'selection', label: readOnlyResult ? 'Evidence result set' : 'Candidate selection',
        state: phase === 'selection_required' ? 'blocked'
          : selection || (readOnlyResult && phase === 'completed') ? 'complete' : 'pending',
        detail: phase === 'selection_required' ? 'Operator selection is required.'
          : selection ? `${selection.candidate.role} selected.`
            : readOnlyResult && phase === 'completed'
              ? `${candidates.length} verified evidence result(s) accepted without repository selection.`
              : 'Awaiting verified Candidates.' },
      { key: 'cleanup', label: 'Owned-resource cleanup', state: resourcesSettled ? 'complete' : 'active', detail: resourcesSettled ? 'Owned resources settled.' : 'Owned resources remain active.' },
    ];
    const currentStage = stages.find((stage) => ['active', 'blocked', 'failed'].includes(stage.state))
      ?? stages.find((stage) => stage.state === 'pending') ?? stages.at(-1);
    // Issue #489: the goal's objective rides ONCE (below), and the preview and the node rows carry
    // only its reach — the bounded first line plus the byte length a reader did not get.
    const objectiveBytes = Buffer.byteLength(current.goal.objective, 'utf8');
    const objectiveLine = objectiveFirstLine(current.goal.objective);
    const planPreviewCore = {
      objective: objectiveLine, objectiveRef: objectiveReach(objectiveBytes),
      strategy: definition.strategy,
      workspace: definition.workspace, join: definition.join,
      attempts: definition.attempts.map((attempt) => ({
        role: attempt.role, nodeKey: attempt.nodeKey,
        route: clone(workflowAttemptRoute(definition, attempt)),
      })),
      round: rounds.length,
      revision: current.plan.nodes[0]?.revision?.revisionId ?? null,
      profileDigest: current.profile.digest, planDigest: current.plan.digest,
      ...(resultIdentity.explicit ? { resultIntent } : {}),
    };
    const knowledgeProjection = application._knowledgeProjection(runId);
    const view = {
      schemaVersion: 1, runId, objective: current.goal.objective, objectiveBytes,
      resultIntent,
      objectiveResultPolicy: clone(objectivePolicy),
      profile: { name: current.profileName, digest: current.profile.digest },
      phase, cursor: projection.coordinationUpperBound,
      knowledge: knowledgeProjection.knowledge,
      knowledgeDigest: knowledgeProjection.knowledgeDigest,
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
      nodes: boundedPlanNodes(projection.nodes, objectiveLine, objectiveBytes),
      scratchpad: null,
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
      blockedInteraction,
      waitingOn,
      decisionSettled,
      watchdog: typeof application.driver.coordinator?.watchdogConfig === 'function'
        ? application.driver.coordinator.watchdogConfig() : null,
      verification: {
        state: verificationState,
        verdict: candidates.length > 0 ? {
          accepted: candidates.length, attempted: attempts.length,
        } : null,
      },
      semanticReview: { state: 'not_started', findings: [] },
      progress: { current: currentStage.key, summary: `${currentStage.label}: ${currentStage.detail}`, stages, activity: runActivity(application.driver, workers) },
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
      } : readOnlyResult && phase === 'completed' ? {
        state: 'accepted_evidence_set', candidateCount: candidates.length,
        candidates: candidates.map((candidate) => ({
          role: candidate.role, candidateId: candidate.candidateId,
          taskId: candidate.taskId, resultSha: candidate.resultSha,
          evidenceDigest: candidate.evidenceDigest,
        })),
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
    const semanticProgress = application._semanticProgressProjection(current, view, observer);
    view.progressClass = semanticProgress.progressClass;
    if (semanticProgress.requiredAction) view.requiredAction = semanticProgress.requiredAction;
    return application._finalizeRunView(current, view, options);
  }
export function _eventBelongsToRun(application, event, current) {
    const payload = event.payload ?? {};
    const runId = current.goal.runId;
    if (event.kind === 'evidence.mapped') {
      const operational = typeof application.driver.log?.at === 'function'
        ? application.driver.log.at(payload.worker, payload.workerSeq)
        : typeof application.driver.log?.read === 'function'
          ? application.driver.log.read(payload.worker, payload.workerSeq)
            .find((candidate) => candidate.seq === payload.workerSeq)
          : null;
      if (!operational) return false;
      if (operational.runId !== null && operational.runId !== undefined) {
        return operational.runId === runId;
      }
      const taskId = typeof operational.taskId === 'string' ? operational.taskId : null;
      return taskId !== null && application.driver.coordination.task(taskId)?.runId === runId;
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
      return application.driver.coordination.contextSession(payload.cell?.sessionId)?.runId === runId;
    }
    if (event.kind === 'context.cell_settled') {
      const cell = application.driver.coordination.contextCell(payload.cellId);
      return application.driver.coordination.contextSession(cell?.sessionId)?.runId === runId;
    }
    const explicit = [payload.runId, payload.goal?.runId, payload.plan?.runId,
      payload.authority?.runId, payload.binding?.runId].filter((value) => value !== undefined && value !== null);
    if (explicit.some((value) => value !== runId)) return false;
    const taskId = typeof payload.taskId === 'string' ? payload.taskId
      : event.kind.startsWith('task.') && typeof payload.id === 'string' ? payload.id
        : typeof payload.target?.taskId === 'string' ? payload.target.taskId : null;
    if (taskId) return application.driver.coordination.task(taskId)?.runId === runId;
    if (explicit.length > 0) return true;
    const planRef = payload.approval?.plan ?? payload.planRef ?? null;
    if (planRef && current.plan) {
      return planRef.planId === current.plan.planId && planRef.version === current.plan.version
        && planRef.digest === current.plan.digest;
    }
    return false;
  }
// Issue #55: mid-turn liveness. resource.provider_call/resource.tokens events land per
// provider call in the worker OPERATIONAL log (driver.log) but are noise-filtered OUT of
// 'meaningful' progress — so without this projection the single-run view is byte-static
// across one long turn and the wave driver's stall clock (sha of the cursor-stripped view)
// kills productive workers mid-turn. Counts + last-activity timestamp only, never
// payloads: honest activity, zero prose.
/** KG activation rules 3/4: the run view surfaces the candidacy ritual counts (knowledge) and the
   * workflow horizon's knowledge digest. Additive projection only — reads the store/coordinator, never
   * mutates; the admit gate stays the only promotion path. Fails open to a zero block so a view is
   * never blocked on a knowledge read, and the wave close receipt / progress rows inherit the block. */
export function _knowledgeProjection(application, runId) {
    try {
      const ritual = application.driver.coordination.knowledgeRitual(runId, {});
      let knowledgeDigest = null;
      try { knowledgeDigest = application.driver.coordinator.workflowHorizon(runId).knowledgeDigest ?? null; } catch { knowledgeDigest = null; }
      return {
        knowledge: { candidates: ritual.candidates ?? 0, admittedThisRun: ritual.admittedThisRun ?? 0 },
        knowledgeDigest,
      };
    } catch {
      return { knowledge: { candidates: 0, admittedThisRun: 0 }, knowledgeDigest: null };
    }
  }
export function _activityProjection(application, current, workers = []) {
    let providerCalls = 0;
    let tokens = 0;
    let lastActivityAt = null;
    let contentEvents = 0;
    for (const handle of workers) {
      const workerId = typeof handle === 'string' ? handle : handle?.id;
      if (typeof workerId !== 'string' || typeof application.driver.log?.read !== 'function') continue;
      for (const event of application.driver.log.read(workerId)) {
        if (event?.kind === 'resource.provider_call') {
          providerCalls += 1;
        } else if (event?.kind === 'resource.tokens' && Number.isSafeInteger(event.payload?.tokens)) {
          tokens += event.payload.tokens;
        } else if (event?.kind === 'content.message' || event?.kind === 'content.tool_call') {
          // The universal liveness signal: every adapter emits content events mid-turn
          // (grok emits no resource.* events at all — the BD-A3 wave stall-died on exactly
          // that gap). 'Noise' for progress-meaning, exactly right for liveness.
          contentEvents += 1;
        } else {
          continue;
        }
        if (typeof event.ts === 'string' && (lastActivityAt === null || event.ts > lastActivityAt)) {
          lastActivityAt = event.ts;
        }
      }
    }
    return deepFreeze({ providerCalls, tokens, contentEvents, lastActivityAt });
  }
export function _progressTiming(application, current, view) {
    // Narrow projection test doubles created before Phase 89 sometimes instantiate the prototype
    // without running the constructor. Production applications always own `_clock`; the fallback
    // preserves those read-only doubles without changing deployment clock authority.
    const observedAt = typeof application._clock === 'function'
      ? application._clock() : new Date().toISOString();
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt
    ) {
      throw applicationError('application progress clock is invalid',
        'application_progress_clock_invalid');
    }
    // #236 (quiescence murder, 2026-08-19): content evidence (tool_call/message mapped into
    // the ledger) is NOISE for semantic-progress display but IS liveness — the interpreter's
    // quiescence predicate reads lastProgress.at as its silence reset, and its contract note
    // (workflow-interpreter QUIESCENCE_REARM_KINDS) asserts content evidence counts. A member
    // executing a 7-minute tool call must never read as silent. Timing therefore takes the
    // semantic-meaningful stream UNION the run's content-liveness evidence; display projections
    // that need semantics-only keep using _followCategory directly.
    const meaningful = application.driver.coordination.eventsView().filter((event) => (
      typeof event.ts === 'string' && application._eventBelongsToRun(event, current)
      && (application._followCategory(event) !== null
        || (event.kind === 'evidence.mapped'
          && NOISE_TELEMETRY_OPERATIONAL_KINDS.has(event.payload?.kind)))
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
// v2 P1-C: the run-view semantic-progress projection. progressClass is always present (the
// reducer is total over phase/attention/timing/terminalCause); requiredAction rides ONLY when
// the rule-2 blocking predicate holds. `principal` scopes the advertised actionId to the view
// consumer so the token it carries is the one the same principal can act on. The actionId is
// computed against the CONTEXT-PROJECTED view — the exact view shape `_resolveSemanticAction`
// and the inspect outline use — so a token offered by `status()` is the token `run.act`
// resolves (the view digest is otherwise stable across the projection).
export function _semanticProgressProjection(application, current, view, principal) {
    const semanticView = application._withContextProjection(current, view);
    let timing;
    try {
      timing = application._progressTiming(current, semanticView);
    } catch (error) {
      // RA9: a malformed application clock fails TYPED at the explicit timing-projection sites
      // (run.inspect outline / runs.list items); a run VIEW still builds with an honest
      // unmeasured progressClass rather than making the whole control surface unusable.
      if (error?.code !== 'application_progress_clock_invalid') throw error;
      timing = deepFreeze({ silenceMs: 0, lastProgress: { at: null } });
    }
    const attention = semanticView.attention ?? [];
    const progressClass = projectProgressClass({
      phase: semanticView.phase,
      attention,
      timing,
      terminalCause: semanticView.terminalCause ?? null,
    });
    const requiredAction = application._semanticRequiredAction(current, semanticView, principal);
    return deepFreeze({ progressClass, requiredAction });
  }
export function _followPage(application, current, view, afterCursor) {
    const policy = current.profile.followPolicy;
    const observedUpperBound = view.cursor;
    const inspected = application.driver.coordination.events(afterCursor + 1, policy.maxScanEvents)
      .filter((event) => event.seq <= observedUpperBound);
    const relevant = inspected.flatMap((event) => {
      const category = application._followCategory(event);
      return category && application._eventBelongsToRun(event, current) ? [application._followChange(event, category)] : [];
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
export function _contextState(application, current) {
    const projected = typeof application.driver.coordination.snapshot === 'function'
      ? application.driver.coordination.snapshot().context : null;
    const sessions = (projected?.sessions ?? [])
      .filter((session) => session.repoId === application.repoId && session.runId === current.goal.runId)
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
export function _withContextProjection(application, current, view) {
    return deepFreeze({ ...view, context: clone(application._contextState(current).projection) });
  }
export function _contextTargets(application, current, view) {
    if (!application.context || !application._isWorkflowRun(current)
      || ['stopped', 'closed'].includes(view.phase)) return [];
    const dispatches = current.dispatches ?? (current.dispatch ? [current.dispatch] : []);
    return dispatches.map((dispatch) => {
      const task = application.driver.coordination.task(dispatch.taskId);
      const nodeKey = dispatch.binding?.nodeKey ?? dispatch.nodeKey ?? null;
      const attempt = (view.attempts ?? []).find((candidate) => candidate.nodeKey === nodeKey);
      return task?.status === 'working' ? {
        role: attempt?.role ?? nodeKey ?? 'context', nodeKey,
      } : null;
    }).filter(Boolean);
  }
// REFLEX-4 slice A (docs/32 §3.4, issue #19): the sole relaxation `application.context_eval`
// makes versus `_contextTargets` above — no `_isWorkflowRun` gate, so a caller need not hold
// the target role's own dispatch to evaluate a pure program against it. Everything else
// (`this.context`, phase, live 'working' task) is identical, and `this.context.openSession`
// still enforces its own Workflow-definition/dispatch authority beneath this, unchanged.
export function _contextEvalTargets(application, current, view) {
    if (!application.context || ['stopped', 'closed'].includes(view.phase)) return [];
    const dispatches = current.dispatches ?? (current.dispatch ? [current.dispatch] : []);
    return dispatches.map((dispatch) => {
      const task = application.driver.coordination.task(dispatch.taskId);
      const nodeKey = dispatch.binding?.nodeKey ?? dispatch.nodeKey ?? null;
      const attempt = (view.attempts ?? []).find((candidate) => candidate.nodeKey === nodeKey);
      return task?.status === 'working' ? {
        role: attempt?.role ?? nodeKey ?? 'context', nodeKey,
      } : null;
    }).filter(Boolean);
  }
export function _contextSectionItems(application, current) {
    const context = application._contextState(current);
    // REPL-1 rule 13a: REPL sessions ride the same session list but carry no `workflow`
    // coordinate; they are not Workflow eval targets, so skip them in this Workflow-shaped view.
    const sessionItems = context.sessions
      .filter((session) => session.manifest.kind === 'baton.context_manifest')
      .map((session) => ({
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
        retry: clone(application.driver.coordination.contextRetryEligibility(call.callId)),
        plan: clone(call.plan), approval: clone(call.approval),
      },
    }));
    return [...sessionItems, ...cellItems, ...callItems];
  }
export function _contextItemDetail(application, selected) {
    if (selected.value?.kind === 'call' && selected.state === 'completed') {
      const artifacts = application.driver.coordination.contextCallArtifacts(selected.id);
      return {
        ...selected,
        value: {
          ...clone(selected.value), artifactState: 'verified', output: clone(artifacts.output),
        },
      };
    }
    if (selected.value?.kind !== 'cell' || selected.state !== 'completed') return selected;
    const artifacts = application.driver.coordination.contextCellArtifacts(selected.id);
    return {
      ...selected,
      value: {
        ...clone(selected.value), artifactState: 'verified', output: clone(artifacts.output),
      },
    };
  }
export function _contextItemContent(application, selected, offset, bounds) {
    if (selected.value?.kind !== 'call' || selected.state !== 'completed') {
      throw applicationError('Context content requires a completed effect call',
        'application_context_content_unavailable');
    }
    if (typeof application.driver.coordination.contextCallContents !== 'function') {
      throw applicationError('Context content projection is unavailable',
        'application_context_content_unavailable');
    }
    const projected = application.driver.coordination.contextCallContents(selected.id);
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
export function _contextItemEvidence(application, current, selected) {
    const state = application._contextState(current);
    const session = state.sessions.find((candidate) => candidate.sessionId === selected.id);
    if (session) return [{
      kind: 'context_manifest', digest: session.manifest.digest,
      provenance: 'durable Context session admission', value: clone(session.manifest),
    }];
    const call = state.calls.find((candidate) => candidate.callId === selected.id);
    if (call) {
      const settlementEvidence = ['completed', 'failed'].includes(call.state)
        ? application.driver.coordination.contextCallArtifacts(call.callId).evidence : null;
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
      ? application.driver.coordination.contextCellArtifacts(cell.cellId).evidence : null;
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
export function _contextProviderResultRequests(application, call, children, cleanup) {
    const generic = call.kind === 'baton.context_effect_call';
    const plan = call.plan ? application.driver.coordination.planVersion(
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
        const predecessor = application.driver.coordination.contextCall(call.predecessorCall.callId);
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
export async function _proposeContextMap(application, current, inputs, caller) {
    if (!application._isWorkflowRun(current) || !current.profile) {
      throw applicationError('Context map requires a current recursively composable Workflow',
        'application_context_map_unavailable');
    }
    const sourceCell = application.driver.coordination.contextCell(inputs.cellId);
    const sourceSession = sourceCell
      ? application.driver.coordination.contextSession(sourceCell.sessionId) : null;
    if (!sourceCell || sourceCell.state !== 'completed' || !sourceCell.result || !sourceSession
      || sourceSession.runId !== current.goal.runId || sourceSession.state !== 'active'
      || sourceSession.manifest.workflow.plan.digest !== current.plan.digest) {
      throw applicationError('Context map input is not a completed current-session cell',
        'application_context_map_source_invalid');
    }
    let artifacts;
    try { artifacts = application.driver.coordination.contextCellArtifacts(sourceCell.cellId); }
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
    const goalPlanPolicy = application.driver.coordination.goalPlanPolicy();
    if (!Array.isArray(items) || items.length < 2) {
      throw applicationError('Context map is parallel and needs at least two immutable items; inspect this cell or use one ordinary Run/review for singleton input',
        'context_map_not_parallel');
    }
    if (items.length > goalPlanPolicy.limits.maxNodes) {
      throw applicationError('Context map partitions exceed the successor Plan authority',
        'application_context_map_capacity');
    }
    const definition = application._workflowDefinition(current);
    const roleCatalog = application._workflowRoleCatalog(current, definition);
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
    const history = application._workflowPlanHistory(current);
    const workflowPolicy = workflowDefinitionPolicy(definition);
    const nodeBudget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), items.length,
      workflowPolicy.maxRounds,
    );
    if (!nodeBudget) {
      throw applicationError('Context map has no remaining cumulative Workflow budget authority',
        'application_context_map_capacity');
    }
    const contextPrincipal = application.context.principal;
    const contextAuthority = {
      actor: contextPrincipal.actor, principalId: contextPrincipal.principalId,
      repoId: application.repoId, runId: current.goal.runId,
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
      schemaVersion: 1, repoId: application.repoId, runId: current.goal.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    const successorDefinitionCore = {
      schemaVersion: 3, repoId: application.repoId, runId: current.goal.runId,
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
      ancestors: application._workflowDefinitionAncestors(current.goal.runId),
    });
    application.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorDefinitionCore, definitionDigest: digest(successorDefinitionCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const admitted = application.driver.coordination.admitContextEffectCall({
      call, planRequest, expectedPlanDigest,
    }, {
      actor: contextPrincipal.actor, principalId: contextPrincipal.principalId,
      repoId: application.repoId, runId: current.goal.runId,
      requesterPrincipalId: caller.principalId, requesterSessionId: caller.sessionId,
      key: `context.call:${call.callId}`,
    });
    const proposed = await application.driver.coordinator.proposePlan(planRequest,
      authority(application.principals.planner, application.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:context-map:${call.callDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest
      || admitted.call.expectedPlanDigest !== expectedPlanDigest) {
      throw applicationError('Context map successor Plan differs from its durable prebinding',
        'application_context_map_integrity');
    }
    const refreshed = application._findRun(current.goal.runId);
    application._workflowDefinition(refreshed);
    return application._validateContextEffectPlan(refreshed);
  }
export async function _proposeContextReduce(application, current, inputs, caller) {
    if (!application._isWorkflowRun(current) || !current.profile) {
      throw applicationError('Context reduce requires a current recursively composable Workflow',
        'application_context_reduce_unavailable');
    }
    const sourceCall = application.driver.coordination.contextCall(inputs.callId);
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
        = application.driver.coordination.contextCompletedCallSourceAndArtifacts(sourceCall.callId));
    } catch (error) {
      throw applicationError(error?.message ?? 'Context reduce source is unavailable',
        error?.code ?? 'application_context_reduce_source_invalid');
    }
    const definition = application._workflowDefinition(current);
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
    const session = application.driver.coordination.contextSession(sourceSessionId);
    const principal = application.context.principal;
    const contextAuthority = {
      actor: principal.actor, principalId: principal.principalId,
      repoId: application.repoId, runId: current.goal.runId,
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
    const history = application._workflowPlanHistory(current);
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
    const goalPlanPolicy = application.driver.coordination.goalPlanPolicy();
    const normalizedPlan = normalizePlanRequest(planRequest, goalPlanPolicy, current.goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: application.repoId, runId: current.goal.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    const successorDefinitionCore = {
      schemaVersion: 3, repoId: application.repoId, runId: current.goal.runId,
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
      ancestors: application._workflowDefinitionAncestors(current.goal.runId),
    });
    application.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorDefinitionCore, definitionDigest: digest(successorDefinitionCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const admitted = application.driver.coordination.admitContextEffectCall({
      call, planRequest, expectedPlanDigest,
    }, {
      actor: principal.actor, principalId: principal.principalId,
      repoId: application.repoId, runId: current.goal.runId,
      requesterPrincipalId: caller.principalId, requesterSessionId: caller.sessionId,
      key: `context.call:${call.callId}`,
    });
    const proposed = await application.driver.coordinator.proposePlan(planRequest,
      authority(application.principals.planner, application.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:context-call:${call.callDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest
      || admitted.call.expectedPlanDigest !== expectedPlanDigest) {
      throw applicationError('Context reduce successor Plan differs from its durable prebinding',
        'application_context_call_integrity');
    }
    const refreshed = application._findRun(current.goal.runId);
    application._workflowDefinition(refreshed);
    return application._validateContextEffectPlan(refreshed);
  }
export async function _proposeContextRetry(application, current, inputs, caller) {
    if (!application._isWorkflowRun(current) || !current.profile) {
      throw applicationError('Context retry requires a current recursively composable Workflow',
        'application_context_retry_unavailable');
    }
    const predecessor = application.driver.coordination.contextCall(inputs.callId);
    const selection = application.driver.coordination.contextRetryEligibility(inputs.callId);
    if (!predecessor || predecessor.kind !== 'baton.context_effect_call'
      || selection.eligible !== true
      || predecessor.expectedPlanDigest !== current.plan.digest) {
      throw applicationError(selection.summary ?? 'Context call is not retryable at this Plan head',
        selection.code ?? 'application_context_retry_source_invalid');
    }
    const definition = application._workflowDefinition(current);
    if (definition.schemaVersion !== 3) {
      throw applicationError('Context retry requires a self-describing Workflow role catalog',
        'application_context_retry_unavailable');
    }
    const catalogRole = workflowCatalogRole(definition, predecessor.role);
    if (!catalogRole) {
      throw applicationError('Context retry role is outside the current Workflow authority',
        'application_context_retry_role_invalid');
    }
    const session = application.driver.coordination.contextSession(predecessor.authority.sessionId);
    const principal = application.context.principal;
    const contextAuthority = {
      actor: principal.actor, principalId: principal.principalId,
      repoId: application.repoId, runId: current.goal.runId,
    };
    if (!session || session.state !== 'active'
      || digest(session.authority) !== digest(contextAuthority)) {
      throw applicationError('Context retry session authority is unavailable or stale',
        'application_context_retry_source_invalid');
    }
    const workflowPolicy = workflowDefinitionPolicy(definition);
    const history = application._workflowPlanHistory(current);
    const nodeBudget = workflowRevisionBudget(
      current.profile, history.map((entry) => entry.plan), selection.retryUnitIds.length,
      workflowPolicy.maxRounds,
    );
    if (!nodeBudget) {
      throw applicationError('Context retry has no remaining cumulative Workflow budget authority',
        'application_context_retry_capacity');
    }
    const call = contextEffectRetryCallIdentity(application._contextCallCore(predecessor), {
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
    const goalPlanPolicy = application.driver.coordination.goalPlanPolicy();
    const normalizedPlan = normalizePlanRequest(planRequest, goalPlanPolicy, current.goal);
    const expectedPlanDigest = digest({
      schemaVersion: 1, repoId: application.repoId, runId: current.goal.runId,
      goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
      nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
      policyDigest: goalPlanPolicy.policyDigest,
    });
    const successorDefinitionCore = {
      schemaVersion: 3, repoId: application.repoId, runId: current.goal.runId,
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
      ancestors: application._workflowDefinitionAncestors(current.goal.runId),
    });
    application.driver.coordination.recordDriver(APPLICATION_WORKFLOW_RECORD_KIND, {
      ...successorDefinitionCore, definitionDigest: digest(successorDefinitionCore),
    }, {
      actor: APPLICATION_WORKFLOW_RECORD_ACTOR,
      key: `${APPLICATION_WORKFLOW_RECORD_KIND}:${current.goal.runId}:${expectedPlanDigest}`,
    });
    const admitted = application.driver.coordination.admitContextEffectCall({
      call, planRequest, expectedPlanDigest,
    }, {
      actor: principal.actor, principalId: principal.principalId,
      repoId: application.repoId, runId: current.goal.runId,
      requesterPrincipalId: call.authority.requester.principalId,
      requesterSessionId: call.authority.requester.sessionId,
      key: `context.call:${call.callId}`,
    });
    const proposed = await application.driver.coordinator.proposePlan(planRequest,
      authority(application.principals.planner, application.repoId, current.goal.runId, 'plan:propose',
        `application:${current.goal.runId}:context-retry:${call.callDigest}`));
    if (proposed.plan.digest !== expectedPlanDigest
      || admitted.call.expectedPlanDigest !== expectedPlanDigest) {
      throw applicationError('Context retry successor Plan differs from its durable prebinding',
        'application_context_retry_integrity');
    }
    const refreshed = application._findRun(current.goal.runId);
    application._workflowDefinition(refreshed);
    return application._validateContextEffectPlan(refreshed);
  }
// REFLEX-4 slice A (docs/32 §3.4, issue #19; red-team F12, docs/reference/evidence/
// reflex-wave-live-2026-07-21/reflex-redteam.md): application.context_eval is the pure-only
// Bench surface without a Workflow run/action gate. Named explicitly, per the F12 refinement:
//
// Transport: this is a public method, not an APPLICATION_COMMAND_DEFINITIONS entry — see the
// note above that table (near CONTEXT_EVAL_ARGS/validateContextEvalArgs) for why: any new key
// there, under any `.web`/`.mcp` flag combination, breaks a fixed-mock `application.card()`
// assertion in a test file outside this task's scope. Calling `application.contextEval(...)`
// directly is Rule 3's "direct command port" transport; Web, MCP, and generic
// `application.command('application.context_eval', ...)` string dispatch are real, documented
// gaps pending a change that can update those fixtures.
//
// Non-Workflow manifest-admission authority = NONE is created here. This command never admits
// a new ContextManifest and never opens a session against a synthesized authority. It only
// resolves to an EXISTING durably-admitted session — one previously admitted through the same
// dispatch-bound `this.context.openSession` the Workflow `context_eval` action above uses
// (`_resolveContextEvalRunTarget`/`_resolveContextEvalManifestTarget`) — and re-opens that
// identical session (idempotently, by construction: same manifest, same dispatch, same
// `this.context.principal`) to evaluate a new pure program against it. The only authority this
// surface relaxes versus the Workflow action is `_contextEvalTargets`: the caller need not hold
// the target role's own dispatch. `this.context.openSession` still requires a live 'working'
// Plan-node dispatch and its Workflow-definition ledger record underneath, unchanged; a Run
// that never went through that path (a genuinely Workflow-free "plain" Run) has no manifest
// reachable here and this command refuses. So this widens *who* may evaluate, never *what* may
// be evaluated against, and creates no new Workflow, Plan, dispatch, or effect authority.
//
// ManifestRef simplification: spec/phase93-closed-program-ir.md's ManifestRef is the exact
// 4-tuple {kind, manifestId, manifestDigest, treeSha, environmentDigest}. The CLI surface named
// in this slice's contract (`baton context eval --manifest DIGEST ...`) carries only a digest,
// and a manifestDigest already uniquely resolves one durably-admitted session (it is content-
// addressed over the manifest, which itself embeds runId/plan/node/task/tree/branches — see
// context-program.mjs normalizeContextManifest). So `manifestDigest` alone is the addressing
// key here; `_resolveContextEvalManifestTarget` still cross-checks the reopened session's own
// manifest digest before evaluating, which is what catches a stale or tampered reference.
//
// Durable admission (red-team F12 refinement, second half): every cell this surface returns
// is produced by the identical `DurableContextSession.evaluate()` -> coordination
// admitContextCell/settleContextCell path as the Workflow surface (via `this.context.openSession`
// -> `session.evaluate(program)`). `StatelessContextBench` is never constructed or touched
// directly in application.mjs. A cell returned here is therefore always durably admitted and
// citable by digest exactly like a Workflow-produced cell — never a stateless-computed-only cell.
export async function contextEval(application, rawRequest, rawPrincipal, rawContext = null) {
    application._assertOpen();
    await application.ready;
    const context = normalizeCommandContext(rawContext);
    validateContextEvalArgs(rawRequest);
    const request = deepFreeze(clone(rawRequest));
    const principal = normalizePrincipal(rawPrincipal, 'context eval principal');
    if (!application.context) {
      throw applicationError('Context runtime is unavailable', 'application_context_unavailable');
    }
    await application._authorize('application.context_eval', principal, request.runId ?? null, {
      manifestDigest: request.manifestDigest ?? null,
    });
    application._assertOpen();
    return application.driver.coordination.withContextArtifactVerification(async () => {
      let program;
      try {
        program = normalizeContextProgram(
          request.program, application.driver.coordination.contextProgramPolicy(),
        );
        if (!contextProgramIsPure(program, application.driver.coordination.contextProgramPolicy())) {
          throw applicationError('Context evaluation contains a provider effect',
            'application_context_effect_forbidden');
        }
      } catch (error) {
        if (error?.code === 'application_context_effect_forbidden') throw error;
        throw applicationError(error.message, 'application_action_input_invalid');
      }
      application._assertOpen();
      const { current, target } = request.manifestDigest !== undefined
        ? await application._resolveContextEvalManifestTarget(request.manifestDigest)
        : await application._resolveContextEvalRunTarget(request.runId, request.role ?? null);
      const session = await application.context.openSession({
        authority: { current, role: target.role, nodeKey: target.nodeKey },
        principal: application.context.principal, signal: null,
      });
      if (!session || typeof session.evaluate !== 'function') {
        throw applicationError('Context runtime returned an invalid session',
          'application_context_unavailable');
      }
      if (request.manifestDigest !== undefined && session.manifest.digest !== request.manifestDigest) {
        throw applicationError('Context manifest is not durably admitted',
          'application_context_eval_manifest_unavailable');
      }
      const cell = await session.evaluate(program);
      if (!/^cell:[a-f0-9]{64}$/u.test(cell?.cellId ?? '')) {
        throw applicationError('Context runtime returned an invalid cell',
          'application_context_result_invalid');
      }
      return application.inspect({
        runId: current.goal.runId, depth: 'item', section: 'context', item: cell.cellId,
      }, principal, context);
    });
  }
export async function contextPackageBranch(application, packageDigest, branchName, rawPrincipal, rawContext = null) {
    application._assertOpen();
    await application.ready;
    normalizeCommandContext(rawContext);
    const principal = normalizePrincipal(rawPrincipal, 'context package principal');
    await application._authorize('application.context_package_branch', principal, null, {
      packageDigest, branchName,
    });
    application._assertOpen();
    const resolved = application.driver.coordination.withContextArtifactVerification(
      () => application.driver.coordination.resolveContextPackageBranch(packageDigest, branchName),
    );
    return projectContextPackageBranch(resolved);
  }
export function _semanticActions(application, current, view, principal, context = null) {
    const candidates = [];
    if (view.phase === 'awaiting_plan_approval') {
      candidates.push({
        kind: 'approve_plan',
        source: view.nextActions?.find((action) => action.kind === 'approve_plan') ?? null,
        target: { planDigest: current.plan.digest },
      });
    }
    for (const candidate of view.nextActions ?? []) {
      if (['adopt_result', 'select_candidate', 'send_feedback', 'revise_candidate', 'stop_member', 'semantic_review', 'integrate', 'export_result', 'retry_verification', 'resume_work'].includes(candidate.kind)
        && !candidates.some((entry) => entry.kind === candidate.kind)) {
        candidates.push({ kind: candidate.kind, source: candidate, target: null });
      }
    }
    for (const attention of view.attention ?? []) {
      if (!['answer_approval', 'answer_question', 'answer_decision'].includes(attention.kind)
        || !validText(attention.requestId, 4_096)) continue;
      const target = {
        kind: attention.kind,
        workerId: attention.workerId ?? null,
        requestId: attention.requestId,
        ...(attention.kind === 'answer_approval'
          ? { approvalKind: attention.approvalKind ?? null }
          : attention.kind === 'answer_decision'
            ? {
              question: attention.question ?? null,
              options: attention.options ?? [],
              allowFreeResponse: attention.allowFreeResponse === true,
              deadlineAt: attention.deadlineAt ?? null,
            }
            : { question: attention.question ?? null }),
      };
      candidates.push({ kind: attention.kind, source: attention, target });
    }
    // Issue #31 §2.2(6), 31-b Part F rule 13: the three steering acts are the ONLY entry points
    // onto a `turn_checkpoint` attention entry — same guard shape as the interaction loop above,
    // reusing `attention.requestId` (the pause record's own id) as `target.pauseId`.
    for (const attention of view.attention ?? []) {
      if (attention.kind !== 'turn_checkpoint' || !validText(attention.requestId, 4_096)) continue;
      const target = {
        workerId: attention.workerId ?? null,
        taskId: attention.taskId ?? null,
        turnEpoch: attention.turnEpoch ?? null,
        pauseId: attention.requestId,
      };
      for (const kind of ['nudge_turn', 'wait_turn', 'claim_turn']) {
        candidates.push({ kind, source: attention, target });
      }
    }
    if (!application.driver.coordination.runStop?.(current.goal.runId)) {
      const controls = application._semanticControlTargets(current);
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
    const contextTargets = application._contextTargets(current, view);
    if (contextTargets.length > 0) {
      const roles = contextTargets.map((target) => target.role);
      candidates.push({ kind: 'context_eval', source: { roles }, target: { roles } });
    }
    if (application._contextState(current).currentCells.some((cell) => cell.state === 'completed')) {
      const definition = application._workflowDefinition(current);
      const roles = definition.schemaVersion === 3
        ? definition.roleCatalog.roles.map((entry) => entry.role)
        : definition.attempts.map((attempt) => attempt.role);
      if (roles.length > 0) {
        candidates.push({ kind: 'context_map', source: { roles }, target: { roles } });
      }
    }
    if (application._contextState(current).currentCalls.some((call) => (
      call.state === 'completed' && (
        call.kind === 'baton.context_map_call'
          || (call.kind === 'baton.context_effect_call' && call.operator === 'map')
      )
    ))) {
      const definition = application._workflowDefinition(current);
      const roles = definition.schemaVersion === 3
        ? definition.roleCatalog.roles.map((entry) => entry.role)
        : [];
      if (roles.length > 0) {
        candidates.push({ kind: 'context_reduce', source: { roles }, target: { roles } });
      }
    }
    for (const call of application._contextState(current).currentCalls) {
      if (call.kind !== 'baton.context_effect_call' || call.state !== 'failed') continue;
      const eligibility = application.driver.coordination.contextRetryEligibility(call.callId);
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
    const eligible = capabilityEligibleSemanticActions(candidates, context);
    // The view digest is invariant across every candidate (one view → one freshness token);
    // hoisting it keeps the hot status/act path from re-hashing the whole view per action.
    const viewDigest = semanticViewDigest(view);
    return eligible.map(({ kind, source, target, authorityTarget = target }) => {
      const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
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
      const actionId = application._semanticActionId(current, view, principal, kind, authorityTarget, viewDigest);
      const doInputs = actionDoInputs(kind, target, inputSchema);
      return deepFreeze({
        actionId,
        kind,
        do: { action: { kind, actionId }, inputs: doInputs },
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
export function _episodeContext(application, current, view) {
    const bindings = application._episodeBindings(current, view);
    return {
      snapshot: application.driver.coordination.snapshot(), bindings,
      streams: application._episodeWorkstreams(current, view, bindings),
    };
  }
export function _episodeGraph(application, current, view, role = null, episodeContext = null, generation = null) {
    const context = episodeContext ?? application._episodeContext(current, view);
    const selectedBindings = role === null ? context.bindings
      : [application._episodeBinding(context, role, generation)].filter(Boolean);
    const selectedKeys = new Set(selectedBindings.map((binding) => `${binding.role}\0${binding.generation}`));
    const streams = context.streams.filter((stream) => selectedKeys.has(
      `${stream.value.role}\0${stream.value.generation}`,
    ));
    const taskIds = new Set(selectedBindings.map((binding) => binding.taskId).filter(Boolean));
    const snapshot = context.snapshot;
    const artifacts = (snapshot.artifacts ?? []).filter((artifact) => taskIds.has(artifact.taskId));
    const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
    const representations = (snapshot.representations ?? [])
      .filter((representation) => taskIds.has(representation.taskId));
    const knowledgeNodes = (snapshot.knowledge?.nodes ?? []).filter((node) => (
      node.id === `run:${current.goal.runId}` || taskIds.has(node.taskId)
      || (node.evidence ?? []).some((ref) => artifactIds.has(ref.artifactId))
    ));
    const knowledgeNodeIds = new Set(knowledgeNodes.map((node) => node.id));
    const representationNodeIds = new Set(representations.flatMap((representation) => [
      representation.representationId, representation.node?.id, representation.sourceNode?.id,
    ].filter(Boolean)));
    const knowledgeEdges = (snapshot.knowledge?.edges ?? []).filter((candidate) => (
      knowledgeNodeIds.has(candidate.from) || knowledgeNodeIds.has(candidate.to)
      || representationNodeIds.has(candidate.from) || representationNodeIds.has(candidate.to)
    ));
    const temporal = (source) => {
      const value = {};
      for (const field of ['observedSeq', 'observedAt', 'validFrom', 'validTo', 'validityVersion',
        'derivedFromEvent', 'recordedEvent', 'recordedAt']) {
        if (source?.[field] !== undefined) value[field] = clone(source[field]);
      }
      return value;
    };
    const makeEdge = (type, from, to, authority, source = {}) => ({
      id: `episode-edge:${digest({ type, from, to, authority, sourceId: source.id ?? null,
        evidence: source.evidence ?? [] })}`,
      type, from, to, immutable: true, readOnly: true, authority,
      ...(source.id ? { sourceEdgeId: source.id } : {}),
      ...(source.type ? { sourceEdgeType: source.type } : {}),
      evidence: clone(source.evidence ?? []), temporal: temporal(source),
      sourceCoordinates: (source.evidence ?? []).map((ref) => clone(ref)),
    });
    const edgeMap = new Map();
    const addEdge = (value) => edgeMap.set(value.id, value);
    for (const binding of selectedBindings) {
      const stream = streams.find((candidate) => candidate.value.role === binding.role
        && candidate.value.generation === binding.generation);
      if (!stream) continue;
      addEdge(makeEdge('covers', `plan:${binding.planDigest ?? current.goal.digest}`, stream.id,
        'durable_plan_generation', {
          evidence: [{ planDigest: binding.planDigest, generation: binding.generation }],
        }));
      for (const path of binding.activity?.editedPaths ?? []) {
        addEdge(makeEdge('modified', stream.id, `source:${path}`,
          'provider_activity_observation', {
            observedSeq: binding.activity?.lastEventSeq,
            observedAt: binding.activity?.lastEventAt,
            evidence: binding.activity?.lastEventSeq
              ? [{ coordinationSeq: binding.activity.lastEventSeq }] : [],
          }));
      }
      const receipt = binding.memberStop?.receipt ?? null;
      if (receipt) addEdge(makeEdge('releases', stream.id,
        `cleanup:${receipt.receiptDigest ?? receipt.completionDigest ?? digest(receipt)}`,
        'durable_workstream_stop_receipt', {
          id: receipt.completionDigest ?? null,
          evidence: [{ completionDigest: receipt.completionDigest ?? digest(receipt),
            generation: binding.generation, role: binding.role }],
        }));
    }
    for (const artifact of artifacts) {
      const binding = selectedBindings.find((candidate) => candidate.taskId === artifact.taskId);
      const stream = binding && streams.find((candidate) => candidate.value.role === binding.role
        && candidate.value.generation === binding.generation);
      if (stream) addEdge(makeEdge('produced', stream.id, `artifact:${artifact.id}`,
        'durable_artifact_manifest', artifact));
    }
    for (const representation of representations) {
      const atlasEdges = Array.isArray(representation.edges) && representation.edges.length > 0
        ? representation.edges : [{
          type: 'DerivedFrom', from: representation.representationId,
          to: representation.sourceNode?.id ?? representation.sourceNodeId,
          evidence: representation.evidence ?? [], recordedEvent: representation.recordedEvent,
          recordedAt: representation.recordedAt,
        }];
      for (const existing of atlasEdges) {
        if (!existing.from || !existing.to) continue;
        const mapping = existing.type === 'ProducedBy'
          ? ['produced', existing.to, existing.from]
          : existing.type === 'VerifiedBy'
            ? ['verified_by', existing.from, existing.to]
            : existing.type === 'Contains'
              ? ['covers', existing.from, existing.to]
              : existing.type === 'Contradicts'
                ? ['contradicted_by', existing.to, existing.from]
                : existing.type === 'DerivedFrom'
                  ? ['derived_from', existing.from, existing.to]
                  : ['grounded_in', existing.from, existing.to];
        addEdge(makeEdge(...mapping, 'atlas_structural_lineage', existing));
      }
    }
    for (const node of knowledgeNodes) {
      for (const ref of node.evidence ?? []) {
        const coordinate = ref.artifactId ? `artifact:${ref.artifactId}`
          : Number.isInteger(ref.coordinationSeq) ? `coordination:${ref.coordinationSeq}` : null;
        if (coordinate) addEdge(makeEdge('grounded_in', node.id, coordinate,
          'cairn_grounding_evidence', { ...node, evidence: [ref] }));
      }
    }
    for (const existing of knowledgeEdges) {
      const mapping = existing.type === 'Contradicts'
        ? ['contradicted_by', existing.to, existing.from]
        : existing.type === 'ProducedBy'
          ? ['produced', existing.to, existing.from]
          : existing.type === 'VerifiedBy'
            ? ['verified_by', existing.from, existing.to]
            : existing.type === 'Contains'
              ? ['covers', existing.from, existing.to]
              : existing.type === 'DerivedFrom'
                ? ['derived_from', existing.from, existing.to]
                : ['grounded_in', existing.from, existing.to];
      addEdge(makeEdge(...mapping, `cairn:${existing.id}`, existing));
    }
    for (const commit of artifacts.filter((artifact) => artifact.kind === 'commit')) {
      const verification = artifacts.find((artifact) => artifact.kind === 'verification'
        && artifact.taskId === commit.taskId);
      if (verification) addEdge(makeEdge('verified_by', `artifact:${commit.id}`,
        `artifact:${verification.id}`, 'durable_verification_manifest', verification));
    }
    const stop = snapshot.runStops?.find((candidate) => candidate.runId === current.goal.runId);
    if (role === null && stop?.receipt) {
      for (const stream of streams) addEdge(makeEdge('releases', stream.id,
        `cleanup:${stop.receipt.receiptDigest ?? stop.receipt.completionDigest ?? digest(stop.receipt)}`,
        'durable_run_stop_receipt', stop.receipt));
    }
    return {
      streams, selectedBindings, taskIds, artifacts, representations, knowledgeNodes,
      knowledgeEdges, edges: [...edgeMap.values()].sort((left, right) => compareCanonicalStrings(left.id, right.id)),
      stop, context,
    };
  }
export function _episodeItem(application, current, view, topic, role = null, episodeContext = null, generation = null) {
    const graph = application._episodeGraph(current, view, role, episodeContext, generation);
    if (role !== null && graph.selectedBindings.length !== 1) return null;
    const binding = graph.selectedBindings[0] ?? null;
    const resolvedGeneration = binding?.generation ?? generation;
    const id = `episode:${topic}${role === null ? '' : `:${role}:g${resolvedGeneration}`}`;
    const authoritativeResult = role === null ? view.result : binding?.candidate ?? null;
    const result = authoritativeResult ? {
      state: authoritativeResult.state ?? 'verified',
      role, generation: resolvedGeneration ?? null,
      nodeKey: authoritativeResult.nodeKey ?? null,
      sha: authoritativeResult.sha ?? authoritativeResult.resultSha ?? null,
      resultSha: authoritativeResult.sha ?? authoritativeResult.resultSha ?? null,
      candidateId: authoritativeResult.candidateId ?? authoritativeResult.candidate?.id ?? null,
      commitArtifact: clone(authoritativeResult.commitArtifact
        ?? authoritativeResult.evidence?.commitArtifact ?? null),
      verificationArtifact: clone(authoritativeResult.verificationArtifact
        ?? authoritativeResult.evidence?.verificationArtifact ?? null),
      stability: authoritativeResult.stability ?? null,
      integration: clone(role === null ? view.integration ?? null : null),
      export: clone(role === null ? view.export ?? null : null),
    } : null;
    const contradictions = graph.edges.filter((candidate) => candidate.type === 'contradicted_by');
    const derivations = graph.edges.filter((candidate) => (
      ['produced', 'modified', 'derived_from', 'grounded_in', 'verified_by', 'covers']
        .includes(candidate.type)
    ));
    const chapterArguments = (chapter) => ({
      runId: current.goal.runId, topic: chapter,
      detail: chapter === 'output' ? 'content' : 'item',
      ...(role === null ? {} : { role, generation: resolvedGeneration }),
    });
    const values = {
      outline: {
        authority: 'replaceable_non_authoritative_summary',
        objective: current.goal.objective, resultIntent: view.resultIntent,
        phase: view.phase,
        summary: view.progress?.summary ?? view.narrative, workstream: role,
        generation: resolvedGeneration ?? null,
        chapters: EPISODE_TOPICS.map((chapter) => ({
          topic: chapter, summary: `${chapter.replaceAll('_', ' ')} Episode chapter.`,
          command: { operation: 'run.episode', arguments: chapterArguments(chapter) },
        })),
      },
      output: {
        authority: 'untrusted_provider_content', occurrenceAuthority: 'durable_event_mapping',
        paginated: true, workstream: role,
      },
      sources: {
        authority: 'authoritative_coordinates_at_evidence_depth',
        artifacts: graph.artifacts.length, representations: graph.representations.length,
        knowledgeNodes: graph.knowledgeNodes.length, workstream: role,
      },
      derivations: { authority: 'immutable_lineage_projection', edges: derivations },
      contradictions: {
        authority: 'immutable_cairn_contradiction_projection',
        state: contradictions.length > 0 ? 'present' : 'clear', edges: contradictions,
      },
      trace: {
        authority: 'immutable_structural_temporal_join',
        edgeVocabulary: ['produced', 'modified', 'derived_from', 'grounded_in',
          'contradicted_by', 'verified_by', 'covers', 'releases'],
        edges: graph.edges,
      },
      route: { authority: 'exact_route_authority', value: clone(role === null
        ? view.route : binding?.route ?? null) },
      verification: { authority: 'durable_verifier_authority', value: clone(role === null
        ? view.verification : binding?.verification ?? null) },
      result: { authority: 'exact_result_capsule', value: clone(result) },
      cleanup: {
        authority: 'durable_cleanup_authority',
        state: role === null ? projectedCleanupState(view)
          : binding?.memberStop?.status === 'stopped' || binding?.memberStop?.state === 'stopped'
            ? 'reaped' : 'active',
        terminalCause: clone(role === null ? view.terminalCause ?? null
          : binding?.terminalCause ?? null),
        released: graph.edges.filter((candidate) => candidate.type === 'releases'),
      },
      help: {
        authority: 'semantic_registry', topic: 'run.episode',
        command: { operation: 'application.help', arguments: {
          topic: 'run.episode', depth: 'content', runId: current.goal.runId,
        } },
      },
    };
    if (!Object.hasOwn(values, topic)) return null;
    const resultSettled = result !== null || (role === null
      ? APPLICATION_RUN_TERMINAL_PHASES.has(view.phase)
      : ['accepted', 'failed', 'cancelled', 'stale', 'stopped'].includes(binding?.state)
        || binding?.memberStop?.status === 'stopped' || binding?.memberStop?.state === 'stopped');
    return {
      id, section: 'episode', state: topic === 'contradictions'
        ? values[topic].state : topic === 'result'
          ? result === null ? resultSettled ? 'unavailable' : 'pending' : 'completed' : view.phase,
      summary: topic === 'outline'
        ? 'Replaceable Episode summary; expand authoritative fields as needed.'
        : `${topic.replaceAll('_', ' ')} projection for this Episode.`,
      value: values[topic],
    };
  }
export function _episodeEvidence(application, current, view, selected, episodeContext = null) {
    const raw = selected.id.slice('episode:'.length);
    const topic = EPISODE_TOPICS
      .find((candidate) => raw === candidate || raw.startsWith(`${candidate}:`));
    const coordinate = topic && raw !== topic ? raw.slice(topic.length + 1) : '';
    const generationMatch = /:g([1-9][0-9]*)$/u.exec(coordinate);
    const generation = generationMatch ? Number(generationMatch[1]) : null;
    const role = generationMatch ? coordinate.slice(0, generationMatch.index) : coordinate || null;
    const graph = application._episodeGraph(current, view, role, episodeContext, generation);
    const base = [{
      kind: 'episode-authority', readOnly: true,
      summaryAuthority: 'replaceable_non_authoritative',
      authoritative: ['result_capsule', 'source_coordinates', 'route', 'lineage',
        'verification', 'cleanup'],
    }];
    if (['sources', 'derivations', 'contradictions', 'trace'].includes(topic)) {
      base.push({
        kind: 'source-coordinates',
        artifacts: graph.artifacts.map((artifact) => ({
          id: artifact.id, digest: artifact.digest, kind: artifact.kind,
        })),
        representations: graph.representations.map((representation) => ({
          id: representation.representationId, source: representation.sourceNode?.id ?? null,
          eventSeq: representation.eventSeq ?? representation.producedEvent ?? null,
        })),
        knowledge: graph.knowledgeNodes.map((node) => ({
          id: node.id, evidence: clone(node.evidence ?? []), observedSeq: node.observedSeq,
        })),
        edges: clone(graph.edges),
      });
    }
    if (topic === 'route') base.push({ kind: 'exact-route', value: clone(selected.value.value) });
    if (topic === 'verification') base.push({
      kind: 'verification', value: clone(selected.value.value),
    });
    if (topic === 'result') base.push({ kind: 'result-capsule', value: clone(selected.value.value) });
    if (topic === 'cleanup') base.push({
      kind: 'cleanup', value: clone(role === null ? graph.stop?.receipt ?? null
        : graph.selectedBindings[0]?.memberStop?.receipt ?? null),
    });
    return base;
  }
// VR9/RV: the durable referee verdict is already a closed receipt. This projection validates its
// enums, bounds, byte count, and digest without ever reading command output or free-form text.
export function _closedVerdictProjection(application, result, planNode, phase, workerId) {
    const verdict = result?.verdict ?? null;
    if (!verdict) return null;
    let verifierAttempts = 0;
    if (workerId && result?.checkpoint?.sha && typeof application.driver?.log?.read === 'function') {
      verifierAttempts = application.driver.log.read(workerId).filter((event) => event.kind === 'verify.reverified'
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
    const capturedOutputDigest = sanitizeHex64(verdict.capturedOutputDigest);
    const failureCapsule = capturedOutputBytes === null || capturedOutputDigest === null
      ? null : normalizeVerifierFailureCapsule(verdict.failureCapsule, {
        capturedOutputBytes, capturedOutputDigest,
      });
    const acceptance = result?.verificationAcceptance ?? null;
    const requirements = {
      requireRedGreen: acceptance?.requireRedGreen === true,
      requireCoverage: acceptance?.requireCoverage === true,
      requireMutation: acceptance?.requireMutation === true,
    };
    const verdictSatisfiesPolicy = verdict.reverified === true && verdict.passed === true
      && (!requirements.requireRedGreen || verdict.redGreen === true)
      && (!requirements.requireCoverage || verdict.coverageOfChange === true)
      && (!requirements.requireMutation || verdict.mutationPassed === true)
      && verdict.diagnosticCode !== 'verification_red_green_failed';
    const accepted = acceptance
      ? acceptance.accepted === true && verdictSatisfiesPolicy
      : ['work_completed', 'reviewing', 'completed'].includes(phase)
        && verdictSatisfiesPolicy;
    const policyMode = ['pass_only', 'red_green_required', 'pass_plus_hardening']
      .includes(acceptance?.policy) ? acceptance.policy
      : requirements.requireRedGreen ? 'red_green_required'
        : requirements.requireCoverage || requirements.requireMutation
          ? 'pass_plus_hardening' : 'pass_only';
    return deepFreeze({
      accepted,
      acceptancePolicy: { mode: policyMode, ...requirements },
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
      capturedOutputDigest,
      ...(failureCapsule ? { failureCapsule } : {}),
      diagnosticCode: closedEnum(verdict.diagnosticCode, VERIFIER_DIAGNOSTIC_CODES),
      durationMs,
      runtimeDigest: sanitizeHex64(verdict.runtimeDigest),
      attemptOrdinal: Math.max(1, verifierAttempts),
    });
  }
export function _semanticSectionItems(application, current, view, sectionId, episodeContext = null) {
    if (sectionId === 'context') return application._contextSectionItems(current);
    if (sectionId === 'workstreams') return episodeContext?.streams
      ?? application._episodeWorkstreams(current, view);
    if (sectionId === 'episode') {
      const context = episodeContext ?? application._episodeContext(current, view);
      return EPISODE_TOPICS
        .map((topic) => application._episodeItem(current, view, topic, null, context)).filter(Boolean);
    }
    if (sectionId === 'plan') {
      const projected = new Map((view.nodes ?? []).map((node) => [node.key, node]));
      return (current.plan?.nodes ?? []).map((node) => {
        // Issue #489: a Plan node's objective IS the goal's objective — the single-node plan copies
        // it verbatim — so the item carries the SAME reach the view's node rows carry (the bounded
        // first line plus the pointer, #464/#469's pair); the outline keeps serving the whole text.
        // Without this a 360 KB recruit brief made the plan section 891 KB and `--depth section`
        // refused, which is the narrowing the full view's refusal prescribes.
        const nodeBytes = Buffer.byteLength(node.objective, 'utf8');
        const nodeLine = objectiveFirstLine(node.objective);
        return {
          id: `plan-node:${node.key}:v${current.plan.version}`,
          section: 'plan',
          state: projected.get(node.key)?.state ?? (view.phase === 'awaiting_plan_approval' ? 'proposed' : 'pending'),
          summary: nodeLine,
          value: {
            objective: nodeLine,
            objectiveRef: objectiveReach(nodeBytes),
            definitionOfDone: node.definitionOfDone,
            risk: node.risk,
            route: node.routes ? planSingleExactRoute(node.routes) : null,
            routeAuthority: node.routes ? projectPlanRouteAuthority(node.routes) : null,
            ...(view.attempts?.find((attempt) => attempt.nodeKey === node.key)?.role
              ? { role: view.attempts.find((attempt) => attempt.nodeKey === node.key).role } : {}),
          },
        };
      });
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
      orchestration: application.driver.coordination.runOrchestrationView?.(current.goal.runId) ?? null,
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
      id: application._singletonSummaryItemId(sectionId, current), section: sectionId,
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
          activity: view.progress?.activity ?? null,
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
export function _runTimelineContent(application, current, request, bounds, snapshot = null, taskIds = null) {
    const includeOutput = request.item === 'execution:output';
    try {
      return projectRunTimelinePage({
        runId: current.goal.runId,
        events: application.driver.coordination.eventsView(),
        snapshot: snapshot ?? application.driver.coordination.snapshot(),
        cursor: request.pageCursor ?? null,
        limit: bounds.maxItems,
        maxBytes: Math.max(1_024, bounds.maxBytes - 8_192),
        includeOutput,
        recipient: request.recipient ?? null,
        taskIds,
        maxFragmentBytes: Math.max(256, Math.min(4_096, bounds.maxBytes - 16_384)),
        resolveOperational: ({ worker, workerSeq }) => typeof application.driver.log.at === 'function'
          ? application.driver.log.at(worker, workerSeq)
          : application.driver.log.read(worker, workerSeq)
            .find((event) => event.seq === workerSeq) ?? null,
      });
    } catch (error) {
      if (error?.code?.startsWith('run_timeline_')) {
        throw applicationError(error.message, error.code);
      }
      throw error;
    }
  }
export function _episodeOutputContent(application, current, request, bounds, episodeContext = null) {
    const raw = request.item.slice('episode:output'.length);
    const coordinate = raw.startsWith(':') ? raw.slice(1) : '';
    const generationMatch = /:g([1-9][0-9]*)$/u.exec(coordinate);
    const generation = generationMatch ? Number(generationMatch[1]) : null;
    const role = generationMatch ? coordinate.slice(0, generationMatch.index) : coordinate || null;
    const context = episodeContext;
    const binding = role === null ? null
      : context ? application._episodeBinding(context, role, generation) : null;
    if (role !== null && !binding) {
      throw applicationError('Episode output workstream is unavailable',
        'application_inspect_item_invalid');
    }
    const page = application._runTimelineContent(current, {
      ...request, item: 'execution:output',
      ...(role ? { recipient: role } : {}),
    }, bounds, context?.snapshot ?? null, binding?.taskId ? [binding.taskId] : null);
    return deepFreeze({
      ...page,
      kind: 'baton.episode.output',
      authority: 'untrusted_provider_content',
      occurrenceAuthority: 'durable_event_mapping',
      workstream: role, generation: binding?.generation ?? null,
    });
  }
export function _runProgressContent(application, current, view) {
    const timing = application._progressTiming(current, view);
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
export function _historicalProfileInspection(application, current, view, request) {
    if (request.cursor !== undefined || request.waitMs !== undefined) {
      throw applicationError('historical Run waiting requires its unavailable deployment profile',
        'application_profile_stale');
    }
    const terminal = APPLICATION_RUN_TERMINAL_PHASES.has(view.phase);
    const bounds = { maxItems: Number.MAX_SAFE_INTEGER, maxBytes: MAX_RUN_VIEW_BYTES, maxWaitMs: 0 };
    const base = {
      schemaVersion: 1, runId: current.goal.runId, depth: request.depth,
      registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest,
      viewDigest: semanticViewDigest(view), cursor: view.cursor,
      changed: false, timedOut: false, terminal,
      truncated: false,
      help: [{ topic: 'run.inspect', depth: 'outline' }],
      policy: clone(view.policy),
    };
    const episodeContext = request.depth === 'index'
      || ['episode', 'workstreams'].includes(request.section)
      ? application._episodeContext(current, view) : null;
    if (request.depth === 'outline') {
      const timing = application._progressTiming(current, view);
      return application._finalizeSemanticInspection({
        ...base, expansions: [{ depth: 'index' }],
        outline: {
          objective: current.goal.objective,
          resultIntent: view.resultIntent,
          phase: view.phase, narrative: view.narrative, risk: current.goal.risk,
          stage: view.progress?.current ?? null,
          ...timing,
          progress: clone(view.progress),
          progressClass: clone(view.progressClass ?? null),
          // issue #10 / docs/32 §5: the outline carries the additive waitingOn projection.
          waitingOn: clone(view.waitingOn ?? null),
          // KG activation rule 4 / settlement D3: the candidacy ritual count rides the terminal
          // outline so an orchestrator reviewing after the driver exits sees the queue depth. Only
          // `candidatesAwaitingAdmission` is surfaced (never `candidates`), so the raw wave close
          // receipt's `knowledge.candidates` projection is unchanged (kg-activation A3/A4).
          knowledge: { candidatesAwaitingAdmission: view.knowledge?.candidates ?? 0 },
          ...(view.requiredAction ? { requiredAction: clone(view.requiredAction) } : {}),
          attention: { count: 0, state: 'clear', summary: 'No historical attention is projected.' },
          route: clone(view.route), workerPolicy: clone(view.workerPolicy),
          context: clone(application._contextState(current).projection),
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
        const allSectionItems = application._semanticSectionItems(current, view, definition.id, episodeContext);
        const items = byteBoundedPage(allSectionItems, ATTENTION_PAGE_BYTES).page;
        return {
          id: definition.id, state: items[0]?.state ?? 'empty', summary: definition.summary,
          itemCount: items.length, truncated: items.length < allSectionItems.length, authorized: true,
          expand: { depth: 'section', section: definition.id },
        };
      });
      return application._finalizeSemanticInspection({
        ...base, expansions: sections.map((row) => row.expand), sections,
      }, bounds);
    }
    const definition = APPLICATION_SEMANTIC_REGISTRY.sections.find((entry) => entry.id === request.section);
    if (!definition) {
      // 2026-09-14 audit (U-F5): name the valid set — the sections closed set is the registry's own
      // declaration, and guessing a section was the cascade's most common dead end.
      throw applicationError('Run inspection section is unavailable', 'application_inspect_section_invalid', {
        field: 'section',
        valid: APPLICATION_SEMANTIC_REGISTRY.sections.map((entry) => entry.id),
      });
    }
    const allItems = application._semanticSectionItems(current, view, request.section, episodeContext);
    const itemPage = byteBoundedPage(allItems, ATTENTION_PAGE_BYTES);
    const items = itemPage.page;
    if (request.depth === 'section') {
      return application._finalizeSemanticInspection({
        ...base, truncated: allItems.length > items.length,
        expansions: items.map((entry) => ({ depth: 'item', section: request.section, item: entry.id })),
        section: {
          id: request.section, state: items[0]?.state ?? 'empty', summary: definition.summary,
          itemCount: allItems.length, truncated: allItems.length > items.length, items,
        },
      }, bounds);
    }
    const selected = application._selectedSemanticItem(
      current, view, request.section, request.item, items, episodeContext,
    );
    if (!selected) {
      throw applicationError('Run inspection item is unavailable', 'application_inspect_item_invalid', {
        field: 'item',
        valid: allItems.map((entry) => entry.id).slice(0, 256),
        itemCount: allItems.length,
      });
    }
    if (request.depth === 'item') {
      const hasContent = request.section === 'context'
        || (request.section === 'episode' && request.item.startsWith('episode:output'))
        || (request.section === 'execution'
          && ['execution:progress', 'execution:events', 'execution:output'].includes(request.item));
      return application._finalizeSemanticInspection({
        ...base, expansions: [
          ...(hasContent ? [{ depth: 'content', section: request.section, item: request.item }] : []),
          { depth: 'evidence', section: request.section, item: request.item },
        ],
        item: request.section === 'context' ? application._contextItemDetail(selected) : selected,
      }, bounds);
    }
    if (request.depth === 'content') {
      if (request.section === 'episode' && request.item.startsWith('episode:output')) {
        const content = application._episodeOutputContent(current, request, bounds, episodeContext);
        const hasMore = content.hasMore === true;
        return application._finalizeSemanticInspection({
          ...base, truncated: hasMore,
          expansions: [
            ...(hasMore ? [{
              depth: 'content', section: 'episode', item: request.item,
              pageCursor: content.cursor,
            }] : []),
            { depth: 'evidence', section: 'episode', item: request.item },
          ],
          ...(hasMore ? { continuation: {
            operation: 'run.inspect', arguments: {
              runId: current.goal.runId, depth: 'content', section: 'episode',
              item: request.item, pageCursor: content.cursor,
            },
          } } : {}),
          item: { id: selected.id, section: selected.section }, content,
        }, bounds);
      }
      if (request.section === 'execution'
        && ['execution:progress', 'execution:events', 'execution:output'].includes(request.item)) {
        const content = request.item === 'execution:progress'
          ? application._runProgressContent(current, view)
          : application._runTimelineContent(current, request, bounds);
        const hasMore = content.kind === 'baton.run_timeline.page' && content.hasMore;
        return application._finalizeSemanticInspection({
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
      const content = application._contextItemContent(selected, request.offset ?? 0, bounds);
      return application._finalizeSemanticInspection({
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
      ...(request.section === 'context' ? application._contextItemEvidence(current, selected) : []),
      ...(request.section === 'episode'
        ? application._episodeEvidence(current, view, selected, episodeContext) : []),
    ];
    return application._finalizeSemanticInspection({
      ...base, expansions: [],
      item: { id: selected.id, section: selected.section, state: selected.state }, evidence,
    }, bounds);
  }
export function _debugMember(application, dispatch, runId, limit) {
    const task = application.driver.coordination.task(dispatch.taskId);
    const workerId = task?.assignee ?? null;
    const events = workerId
      ? application.driver.log.read(workerId).filter((event) => (
        event.runId === runId && event.taskId === dispatch.taskId
      ))
      : [];
    const lastMessages = events
      .filter((event) => event.kind === 'content.message')
      .slice(-limit)
      .map((event) => ({ at: event.ts, text: boundedAttentionText(event.payload?.text) }));
    // #53 writeReceipts whitelist + DIAG-3 amendment: scratchpad/authority receipts, then at most
    // one aggregated wire.frame_degraded summary (counts + last code — never raw frames).
    const writeReceipts = events
      .filter((event) => event.kind === 'scratchpad.write_result' || event.kind === 'authority.rejected')
      .map((event) => application._debugReceipt(event));
    const frameDegraded = debugFrameDegradedSummary(events);
    if (frameDegraded) writeReceipts.push(frameDegraded);
    // #53 failure + DIAG-2 amendment: gate refusal wins when present (structured {gate, detail});
    // otherwise stream-death/crash (lifecycle.crashed) as the #53 closed {kind, code, message}.
    const gateRefusal = debugGateRefusal(events);
    // Issue #61 D1/R4 — the shared projection rides the run.debug failure leg: the SAME
    // check + corrective the worker-facing surface carries (GT1/GT3). A forged-only
    // stream projects no surface and keeps the legacy gate shape (never a throw).
    const verdictSurface = gateRefusal ? projectVerdictSurface(events) : null;
    const crashEvent = events.findLast((event) => event.kind === 'lifecycle.crashed');
    const failure = verdictSurface ? {
      kind: gateRefusal.kind,
      code: gateRefusal.code,
      message: gateRefusal.message,
      gate: verdictSurface.gate,
      check: verdictSurface.check,
      detail: verdictSurface.detail,
      corrective: verdictSurface.corrective,
    } : (gateRefusal ?? (crashEvent ? {
      kind: crashEvent.kind,
      code: debugTerminalCode(crashEvent.payload?.code, 'provider_crashed'),
      message: typeof crashEvent.payload?.error === 'string' && crashEvent.payload.error.length > 0
        ? boundedAttentionText(crashEvent.payload.error) : null,
      // Issue #326: the redacted stderr tail the CLI died with rides beside the exit error.
      // Already bounded and redacted at the adapter's emit boundary (the #299 derivation),
      // so the debug leg carries it verbatim like the lastToolRows precedent.
      ...(typeof crashEvent.payload?.stderrTail === 'string' && crashEvent.payload.stderrTail.length > 0
        ? { stderrTail: crashEvent.payload.stderrTail } : {}),
    } : null));
    return {
      role: dispatch.binding.nodeKey, workerId, phase: task?.status ?? null,
      lastMessages, writeReceipts, failure,
    };
  }
// Rule 2: `code` = `result` for scratchpad receipts, and the `authority.rejected` reason for
// interaction rejections. Raw receipt payloads carry banned internals (scratchpadFence,
// eventSeq, current, evidence); this is a field whitelist, never a passthrough.
// DIAG-3 also admits wire.frame_degraded only via debugFrameDegradedSummary (aggregated).
export function _debugReceipt(application, event) {
    if (event.kind === 'scratchpad.write_result') {
      const result = event.payload?.result ?? null;
      return { kind: event.kind, result, code: result, at: event.ts };
    }
    return {
      kind: event.kind, result: event.payload?.kind ?? null,
      code: event.payload?.reason ?? null, at: event.ts,
    };
  }
export async function _activeWorkstream(application, rawRequest, principal) {
    const current = application._findRun(rawRequest.runId);
    const view = application._withContextProjection(
      current, await application._buildView(current, application.principals.observer),
    );
    const bindings = application._episodeBindings(current, view);
    const binding = application._episodeBinding({ bindings }, rawRequest.role,
      rawRequest.generation ?? null);
    if (!binding || binding.current !== true) {
      throw applicationError('Workstream generation is not current effect authority',
        'application_workstream_generation_unavailable');
    }
    await application._authorize('run.status', principal, rawRequest.runId, {
      operation: 'workstream', role: binding.role, generation: binding.generation,
    });
    return { current, view, binding };
  }
export function _waveDriverDetached(application, waveId) {
    const events = application.driver.coordination.eventsView();
    return events.some((event) => (
      event.kind === 'driver.recorded'
      && event.payload?.kind === APPLICATION_WAVE_DRIVER_DETACHED_KIND
      && event.payload?.waveId === waveId
    ));
  }
// WLS-1: single-pass steering-registered index for the roster projections. ONE eventsView()
// read builds (a) runId → {waveId, waveRole, route, cell} and (b) (waveId,waveRole) → runId, so
// waves.list / waves.progress serve every member from the maps instead of rescanning the log
// per member (the 87k-event × member-count furnace that times out the bus command budget).
// Per-invocation only — never cached across calls (event-log-derived honesty, no staleness).
// First-match-wins preserves the per-record iteration order of _runWaveId/_runWaveRole/
// _runWaveRoute/_runIdForWaveMember exactly.
export function _runWaveIndex(application) {
    // #229 (live capture 2026-08-20): waves.list/progress rebuilt this index with a FULL
    // 140k-event scan per call, on the resident's single event loop — multi-second bursts
    // starved the HTTP parser (the 'TCP accepts, never answers' wedge; sample: main thread
    // 100% inside one eventsView scan). Memoize on the #227 O(1) eventCursor: only events
    // PAST the last-seen cursor re-scan. The store is append-only in-process, so the cursor
    // is a valid revision key.
    const revision = application.driver.coordination.eventCursor();
    const memo = application._runWaveIndexMemo;
    if (memo && memo.revision === revision) {
      return { byRunId: memo.byRunId, byWaveRole: memo.byWaveRole };
    }
    const events = application.driver.coordination.eventsView(memo ? memo.cursor + 1 : 1);
    const byRunId = memo ? memo.byRunId : new Map();
    const byWaveRole = memo ? memo.byWaveRole : new Map();
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.kind !== 'driver.recorded'
        || event.payload?.kind !== APPLICATION_STEERING_REGISTERED_KIND) continue;
      const p = event.payload;
      if (p?.runId !== undefined && !byRunId.has(p.runId)) {
        byRunId.set(p.runId, { waveId: p.waveId, waveRole: p.waveRole, route: p.route, cell: p.cell });
      }
      if (p?.waveId !== undefined && p?.waveRole !== undefined) {
        let roles = byWaveRole.get(p.waveId);
        if (!roles) { roles = new Map(); byWaveRole.set(p.waveId, roles); }
        if (!roles.has(p.waveRole)) roles.set(p.waveRole, p.runId);
      }
    }
    application._runWaveIndexMemo = { revision, cursor: revision, byRunId, byWaveRole };
    return { byRunId, byWaveRole };
  }
// 93B: the durable referent for "this run belongs to waveId" is its own steering.registered
// record — no separate per-run projection map, same event-log-only discipline as the liveness
// scan this mirrors (coordinator.mjs's `hasDriver` check).
export function _runWaveId(application, runId, index = null) {
    if (index !== null) {
      const entry = index.byRunId.get(runId);
      return entry !== undefined && entry.waveId !== undefined ? entry.waveId : null;
    }
    const events = application.driver.coordination.eventsView();
    for (const event of events) {
      if (event.kind === 'driver.recorded' && event.payload?.kind === APPLICATION_STEERING_REGISTERED_KIND
        && event.payload?.runId === runId && event.payload?.waveId !== undefined) {
        return event.payload.waveId;
      }
    }
    return null;
  }
// The wave member's role is the steering-registered `waveRole` (93B) — the durable referent,
// same event-log-only discipline as _runWaveId.
export function _runWaveRole(application, runId, index = null) {
    if (index !== null) {
      const entry = index.byRunId.get(runId);
      return entry !== undefined && entry.waveRole !== undefined ? entry.waveRole : null;
    }
    const events = application.driver.coordination.eventsView();
    for (const event of events) {
      if (event.kind === 'driver.recorded' && event.payload?.kind === APPLICATION_STEERING_REGISTERED_KIND
        && event.payload?.runId === runId && event.payload?.waveRole !== undefined) {
        return event.payload.waveRole;
      }
    }
    return null;
  }
// Issue #74 (D3/A6): the member's EXACT route — the steering-registered `route` (minted by
// start(), same event-log-only discipline as _runWaveId/_runWaveRole). This is how waves.list
// recovers the seat map for interpreter-seam waves whose registry roster is a role-only string.
export function _runWaveRoute(application, runId, index = null) {
    if (index !== null) {
      const entry = index.byRunId.get(runId);
      return entry !== undefined && entry.route !== undefined ? clone(entry.route) : null;
    }
    const events = application.driver.coordination.eventsView();
    for (const event of events) {
      if (event.kind === 'driver.recorded' && event.payload?.kind === APPLICATION_STEERING_REGISTERED_KIND
        && event.payload?.runId === runId && event.payload?.route !== undefined) {
        return clone(event.payload.route);
      }
    }
    return null;
  }
// #102 Decision 6: the run's cell declaration — the steering-registered `cell` (minted by
// start(), same event-log-only discipline as _runWaveId/_runWaveRole/_runWaveRoute). It reads
// through the memoized wave index, so this adds no durable read of its own (the AO3 census
// stays pinned). The shape is re-validated on read, so a foreign or legacy record never
// parses as a cell.
export function _runCellDeclaration(application, runId, index = null) {
    const resolved = index ?? _runWaveIndex(application);
    const raw = resolved.byRunId.get(runId)?.cell ?? null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!Number.isSafeInteger(raw.size) || raw.size < 2) return null;
    if (!Number.isSafeInteger(raw.quorum) || raw.quorum < 1 || raw.quorum > raw.size) return null;
    if (typeof raw.strict !== 'boolean') return null;
    return clone(raw);
  }
/** #216 (row-git-batch): pre-resolve every completed member's preserved-result ref on the
   * page in ONE coordinator batch (one worktrees.resolveResults → one git process). Returns a
   * Map<`${workerId}\0${expectedSha}`, inspection> the view builds consume, or null when the
   * page has no resolvable member or the coordinator lacks the batch seam. Purely memory/log
   * reads per member (the coordinator's own task authority) — never a git spawn. */
export async function _pagePreservedInspections(application, page, waveIndex) {
    if (typeof application.driver.coordinator.inspectPreservedResults !== 'function') return null;
    if (typeof application.driver.coordinator.result !== 'function') return null;
    const workers = application.driver.coordinator.list();
    const entries = [];
    for (const row of page) {
      for (const member of row.roster ?? []) {
        const role = typeof member === 'string' ? member : member?.role ?? null;
        const runId = application._runIdForWaveMember(row.waveId, role, waveIndex);
        if (runId === null) continue;
        const worker = workers.find((candidate) => candidate.runId === runId);
        if (!worker?.id) continue;
        let memberResult;
        try { memberResult = await application.driver.coordinator.result(worker.id); }
        catch { continue; }
        if (memberResult?.status === 'completed' && typeof memberResult.capturedSha === 'string'
          && memberResult.retainedResultRef) {
          entries.push({ workerId: worker.id, expectedSha: memberResult.capturedSha });
        }
      }
    }
    if (entries.length === 0) return null;
    const inspected = await application.driver.coordinator.inspectPreservedResults(entries);
    const map = new Map();
    for (let index = 0; index < entries.length; index += 1) {
      map.set(`${entries[index].workerId}\0${entries[index].expectedSha}`, inspected[index]);
    }
    return map;
  }
// The member's run is the steering-registered runId for (waveId, waveRole) — the durable
// referent, same event-log-only discipline as _runWaveId/_runWaveRole.
export function _runIdForWaveMember(application, waveId, waveRole, index = null) {
    if (waveId == null || waveRole == null) return null;
    if (index !== null) {
      const roles = index.byWaveRole.get(waveId);
      const runId = roles?.get(waveRole);
      return runId !== undefined ? runId : null;
    }
    const events = application.driver.coordination.eventsView();
    for (const event of events) {
      if (event.kind === 'driver.recorded' && event.payload?.kind === APPLICATION_STEERING_REGISTERED_KIND
        && event.payload?.waveId === waveId && event.payload?.waveRole === waveRole) {
        return event.payload.runId;
      }
    }
    return null;
  }
