// limits.mjs — the frame-economics registry (issue #89, contract v1.2). ONE declared module for
// every per-lane frame bound: admission limits (byte-measured, coaching refusals at admission),
// substrate resource guards (the scanner windows / wire frame / credential file — never policy),
// and view ceilings (shed-flagged degradation). Pure data + one refusal-text composer; imports
// only node:crypto. Every consumer (coordinator, application, coordination-store, messages,
// claude-session, wave-driver, the schema/northbound layers, doctor projections) imports this
// module — the registry is the only source, per Decision 8's no-re-declare law.

import { createHash } from 'node:crypto';

/** Recursive key-sorted canonical serialization (the canonicalDigest derivation, coordinator.mjs:312).
 * The digest is computed over the DECLARED rows ONLY — deployment-injected effective values ride
 * a separate channel and never enter it (Decision 7, blocker 5). */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const key of Object.keys(o)) deepFreeze(o[key]);
  }
  return o;
}

/** The path phrase a coaching refusal appends. Graceful lanes name the spill path; hard lanes name
 * the retry bound. Composed here so payload.gracefulPath === the message's path phrase everywhere. */
function refusalPath(row, cap) {
  return row.graceful === 'spill-digest-citation'
    ? 'over-cap bodies spill to a durable artifact — resend with a digest-citable head'
    : `resend within the ${cap}-byte cap`;
}

/** The ONE refusal-text composer (Decision 9). Every size refusal's human message is this helper's
 * output for the lane row — never a hand-typed string. */
export function composeFrameLimitRefusal(row, actual, cap = row?.value) {
  return `${row.lane} is ${actual} ${row.unit} (cap ${cap}); ${refusalPath(row, cap)}`;
}

/** The lane-emission contract's path phrase (Decision 9): used as the payload's gracefulPath. */
export function frameLimitRefusalPath(row, cap = row?.value) {
  return refusalPath(row, cap);
}

// ---------------------------------------------------------------------------
// The declared registry. Rows are frozen; the object is keyed by lane name.
// ---------------------------------------------------------------------------

// The ledger's ceiling on one durable spilled body — declared ONCE and read by every lane that
// is bounded by it (the substrate row below, and the objective lanes, which carry no head cap of
// their own: operator ruling 2026-09-18, #358 — a 4096-byte objective cap silently cut the tail
// off every lane brief of the day and no seat could read the spill it minted).
const SPILL_BODY_BYTES = 1048576;

const ADMISSION = Object.freeze({
  'message.send.body': { lane: 'message.send.body', class: 'admission', value: 2048, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'coordinator.sendMessage', refusalCode: 'spill_body_exceeded' },
  'message.reply.body': { lane: 'message.reply.body', class: 'admission', value: 2048, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'coordinator message.send reply admission', refusalCode: 'spill_body_exceeded' },
  // #207 (row-admission-align): the workflow interpreter's BY-REFERENCE admission enforces this
  // cap at compile/admit (workflow-interpreter.mjs assertObjectiveAdmissible) — a brief whose
  // rendered objective exceeds the cap refuses workflow_spec_invalid naming both byte counts. The
  // spill-aware advisory PASS (OQ5) is the INLINE path's semantics (application start mints the
  // durable spill artifact); the by-reference lane renders the full brief into the member objective
  // and does not split, so the cap is the admission bound there. No value change — this row's
  // declared bytes and the FRAME_LIMITS_DIGEST are untouched.
  // #358: an objective is whatever the recruiter needs to say — bounded by the substrate row
  // alone (SPILL_BODY_BYTES), never by a head cap that spills the brief's tail into an artifact
  // the seat cannot read.
  'run.objective': { lane: 'run.objective', class: 'admission', value: SPILL_BODY_BYTES, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application run.start admission', refusalCode: 'spill_body_exceeded' },
  'wave.member.objective': { lane: 'wave.member.objective', class: 'admission', value: SPILL_BODY_BYTES, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application startWave/attachWave member admission', refusalCode: 'spill_body_exceeded' },
  'wave.run.spec_path': { lane: 'wave.run.spec_path', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'waves.run admission (the semantic-registry input schema; the interpreter containment re-checks)', refusalCode: 'workflow_spec_invalid' },
  'decision.question': { lane: 'decision.question', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionRequest / coordinator decision seam', refusalCode: 'decision_question_exceeded' },
  'decision.need': { lane: 'decision.need', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.recordReuseDecision', refusalCode: 'decision_need_exceeded' },
  'decision.rationale': { lane: 'decision.rationale', class: 'admission', value: 8192, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.recordReuseDecision', refusalCode: 'decision_rationale_exceeded' },
  'orientation.note': { lane: 'orientation.note', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'coordinator.orientWorker', refusalCode: 'orientation_note_exceeded' },
  'steering.focus': { lane: 'steering.focus', class: 'admission', value: 2048, unit: 'bytes', graceful: null, enforcedAt: 'coordinator steering policy injection', refusalCode: 'steering_focus_exceeded' },
  'board.title': { lane: 'board.title', class: 'admission', value: 160, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.postBoardItem', refusalCode: 'board_title_exceeded' },
  'board.detail': { lane: 'board.detail', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.postBoardItem', refusalCode: 'board_detail_exceeded' },
  'board.report.body': { lane: 'board.report.body', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.submitBoardReport', refusalCode: 'board_report_exceeded' },
  'run.legacy_send.body': { lane: 'run.legacy_send.body', class: 'admission', value: 16384, unit: 'bytes', graceful: null, enforcedAt: 'application run.workstream.notify / run.act send / coordination-store run control', refusalCode: 'run_legacy_send_exceeded' },
  'decision.option.label': { lane: 'decision.option.label', class: 'admission', value: 160, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionRequest option label', refusalCode: 'decision_option_label_exceeded' },
  'decision.option.summary': { lane: 'decision.option.summary', class: 'admission', value: 512, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionRequest option summary', refusalCode: 'decision_option_summary_exceeded' },
  'decision.text': { lane: 'decision.text', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'messages.createDecisionAnswer text', refusalCode: 'decision_text_exceeded' },
  'scratchpad.entry.body': { lane: 'scratchpad.entry.body', class: 'admission', value: 8192, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.writeScratchpad', refusalCode: 'scratchpad_entry_exceeded' },
  // Issue #294: one wake-filter token (a class/swarm/participant name) admitted into a subscribe
  // or since request — the same admission-class bound every other named-token lane uses.
  'wake.filter_token': { lane: 'wake.filter_token', class: 'admission', value: 4096, unit: 'bytes', graceful: null, enforcedAt: 'wake-stream.mjs parseWakeFilter', refusalCode: 'invalid_wake_filter' },
  // Issue #366 (with #286 G-41): the ONE bound a run-stop target set is judged against at
  // ADMISSION, and its derivation is the ledger itself. A run stop's target set is a projection of
  // the ledger — every target is a task/worker the ledger already holds, and each such row costs
  // the ledger at least one event — so the physical bound is the ledger's own event count: ONE
  // target per event. The 100_000 literal this replaces refused rows the ledger had already
  // accepted (the #286 G-41 sin): on replay it re-judged a recorded run stop and made a large
  // recorded run's own ledger unloadable. It is judged at admission only, by the ONE helper that
  // reads it (coordination-store.mjs assertTargetSetAdmissible). A FLEET DRAIN's target set is not
  // a projection of the ledger (it is the local controller's live fleet), so no bound is derived
  // for that admission — its bound is the deployment's own drain policy, per #286 G-41.
  'target_set.per_ledger_event': { lane: 'target_set.per_ledger_event', class: 'admission', value: 1, unit: 'targets_per_event', graceful: null, enforcedAt: 'coordination-store run stop target-set admission', refusalCode: 'target_set_capacity' },
});

// #429: the measured model-profile catalog's refresh window, derived from the provider's OWN
// published request budget rather than from a preference: Artificial Analysis limits its free tier
// to 1,000 requests per day, so one request's share of that budget is a day / 1,000 — the smallest
// cache window whose refresh cadence cannot outrun the budget it draws on. Declared ONCE and read
// by the substrate row below; the reader in model-profile.mjs imports THAT row, never this constant
// and never a literal of its own.
const MODEL_PROFILE_REFRESH_MS = 86_400_000 / 1000;

const SUBSTRATE = Object.freeze({
  'scanner.window.decision': { lane: 'scanner.window.decision', class: 'substrate', value: 8192, unit: 'bytes', graceful: null },
  'scanner.window.scratchpad': { lane: 'scanner.window.scratchpad', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.context_read': { lane: 'scanner.window.context_read', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.message_send': { lane: 'scanner.window.message_send', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'stream.omp.flush': { lane: 'stream.omp.flush', class: 'substrate', value: 4096, unit: 'bytes', graceful: null },
  'scanner.window.board_claim': { lane: 'scanner.window.board_claim', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.board_report': { lane: 'scanner.window.board_report', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'wire.frame': { lane: 'wire.frame', class: 'substrate', value: 1048576, unit: 'bytes', graceful: null },
  'credential.file': { lane: 'credential.file', class: 'substrate', value: 16384, unit: 'bytes', graceful: null },
  'context_pack.body': { lane: 'context_pack.body', class: 'substrate', value: 8192, unit: 'bytes', graceful: null },
  // spill.body is the ONE substrate row that mints a refusal (blocker 3): a substrate ceiling
  // enforced AT ADMISSION — it is a resource ceiling on a durable write, not a scanner window.
  'spill.body': { lane: 'spill.body', class: 'substrate', value: SPILL_BODY_BYTES, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.mintSpill / admission spill seam', refusalCode: 'spill_body_exceeded' },
  // #375: the liveness probe's two resource guards (§4.1.2), declared ONCE here like every other
  // substrate bound — the capture a probe verdict is judged over, and the deadline after which a
  // probe settles UNKNOWN (a timer adjudicates no claim: a probe that outlived its bound says
  // nothing about the provider, so it never blocks the route).
  'route.probe_capture': { lane: 'route.probe_capture', class: 'substrate', value: 2048, unit: 'bytes', graceful: null },
  'route.probe_deadline_ms': { lane: 'route.probe_deadline_ms', class: 'substrate', value: 120_000, unit: 'ms', graceful: null },
  // Issue #394: the web transport's wait ceiling — ONE row for the bound BOTH wait arms draw
  // (the application `run.wait` arm, which refused above it, and the legacy coordinator `wait`
  // arm, which silently clamped to it). The derivation is the transport's own default per-command
  // request deadline: 30 s is what `scripts/baton.mjs` sends as BATON_COMMAND_TIMEOUT_MS and what
  // `application-deployment.mjs` gives the resident's command client (commandTimeoutMs), so an
  // answer that settles past this bound is written to a request the caller has already abandoned.
  // The resident therefore refuses a longer wait instead of shortening it, and the DEFAULT wait
  // derives from this row (WEB_WAIT_DEFAULT_MS below) — never a second literal. The row mints no
  // cataloged coaching refusalCode: the ceiling refusal is a request-shape refusal, not a byte
  // lane, so its code rode the ONE `webWaitCeilingRefusalCode` derivation beside this row.
  'web.wait_ceiling_ms': { lane: 'web.wait_ceiling_ms', class: 'substrate', value: 30_000, unit: 'ms', graceful: null, enforcedAt: 'web-northbound.mjs validateEnvelope (the application run.wait arm and the legacy coordinator wait arm)' },
  // Issue #429: the measured model-profile catalog's staleness bound — the window a cached
  // Artificial Analysis catalog stays admissible before the reader refetches. The derivation is the
  // PROVIDER'S OWN published request budget, never a preference of ours (its free tier is limited
  // to 1,000 requests per day): see MODEL_PROFILE_REFRESH_MS above. A response that declares its own
  // freshness (`cache-control: max-age` minus `age`) overrides this fallback with the window the
  // provider itself stated; this row is what a response that declares nothing is judged against,
  // and what the read publishes as `boundMs`.
  'model_profile.catalog_staleness_ms': { lane: 'model_profile.catalog_staleness_ms', class: 'substrate', value: MODEL_PROFILE_REFRESH_MS, unit: 'ms', graceful: null, enforcedAt: 'model-profile.mjs readCachedCatalog (the deployment profile reader)' },
});

const VIEW = Object.freeze({
  'view.board.bytes': { lane: 'view.board.bytes', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'view.board.items': { lane: 'view.board.items', class: 'view', value: 512, unit: 'items', graceful: 'shed-flagged' },
  'view.repl.bytes': { lane: 'view.repl.bytes', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'view.scratchpad.bytes': { lane: 'view.scratchpad.bytes', class: 'view', value: 32768, unit: 'bytes', graceful: 'shed-flagged' },
  'view.scratchpad.items': { lane: 'view.scratchpad.items', class: 'view', value: 64, unit: 'items', graceful: 'shed-flagged' },
  'view.scratchpad.cache_keys': { lane: 'view.scratchpad.cache_keys', class: 'view', value: 256, unit: 'items', graceful: 'shed-flagged' },
  'view.profile.bytes': { lane: 'view.profile.bytes', class: 'view', value: 262144, unit: 'bytes', graceful: 'shed-flagged' },
  'view.run.bytes': { lane: 'view.run.bytes', class: 'view', value: 524288, unit: 'bytes', graceful: 'shed-flagged' },
  'view.review_source.bytes': { lane: 'view.review_source.bytes', class: 'view', value: 4194304, unit: 'bytes', graceful: 'shed-flagged' },
  'view.attention_text.bytes': { lane: 'view.attention_text.bytes', class: 'view', value: 4096, unit: 'bytes', graceful: 'shed-flagged' },
  // OMP's historical final-message slice counts JavaScript string units, not UTF-8 bytes.
  'view.omp.final_summary': { lane: 'view.omp.final_summary', class: 'view', value: 4096, unit: 'code_units', graceful: null },
  // Issue #79 (D2): the worker-delivery push bounds. The ITEM count is the wire bound (8 = the
  // knowledge-slice precedent); overflow is a digest-cited spill, never a truncation. The BYTE
  // row is a RENDER-side shed flag (OQ1), never a wire cap.
  'view.attention_push.items': { lane: 'view.attention_push.items', class: 'view', value: 8, unit: 'items', graceful: 'spill-digest-citation' },
  'view.attention_push.bytes': { lane: 'view.attention_push.bytes', class: 'view', value: 4096, unit: 'bytes', graceful: 'shed-flagged' },
  'view.blocked_interaction_summary.bytes': { lane: 'view.blocked_interaction_summary.bytes', class: 'view', value: 160, unit: 'bytes', graceful: 'shed-flagged' },
  'view.knowledge_slice.items': { lane: 'view.knowledge_slice.items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.knowledge_slice.bytes': { lane: 'view.knowledge_slice.bytes', class: 'view', value: 2048, unit: 'bytes', graceful: 'shed-flagged' },
  'view.context_read.knowledge_items': { lane: 'view.context_read.knowledge_items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.context_read.items': { lane: 'view.context_read.items', class: 'view', value: 64, unit: 'items', graceful: 'shed-flagged' },
  'view.inspect_captured_file.bytes': { lane: 'view.inspect_captured_file.bytes', class: 'view', value: 4194304, unit: 'bytes', graceful: 'shed-flagged' },
  // Issue #294: the wake stream's pull-form and lag replay bound (rows, not bytes) — beyond it a
  // consumer is shed the same way every other view row sheds: a typed marker
  // (baton.wake_stream_lagged / a bounded page), never a silent truncation.
  'view.wake_replay.items': { lane: 'view.wake_replay.items', class: 'view', value: 4096, unit: 'items', graceful: 'shed-flagged' },
  // Issue #313: the run-record read bound (the ceiling application.mjs judged every run-record
  // listing against) declared in the ONE registry instead of a private constant — the same
  // derivation the view.run.bytes row serves for the run-view byte bound.
  'view.run.records': { lane: 'view.run.records', class: 'view', value: 100_000, unit: 'items', graceful: 'shed-flagged' },
});

// Issue #441 (the reading half): the two bounds a recruited ContextPackage draws. A branch
// carries ONE document the root pulled at recruit time (the issue, or a doc it cites), so the
// per-branch ceiling is the durable spilled-body ceiling — the same substrate bound every other
// durable text write in the ledger uses. The brief's rendered slice is a VIEW bound (a
// shed-flagged read, never a write): the brief-time knowledge slice KG-3 already injects, times
// four, because a brief's context slice must carry an issue's opening — its title and first
// paragraphs — where a knowledge snippet carries one fact.
const CONTEXT_PACKAGE_SOURCE_BYTES = SPILL_BODY_BYTES;
const CONTEXT_PACKAGE_BRIEF_BYTES = VIEW['view.knowledge_slice.bytes'].value * 4;
const CONTEXT_PACKAGE = Object.freeze({
  'context_package.source_bytes': { lane: 'context_package.source_bytes', class: 'substrate', value: CONTEXT_PACKAGE_SOURCE_BYTES, unit: 'bytes', graceful: null, enforcedAt: 'web-northbound.mjs context package admit port (one branch document) and application-cli.mjs (the root-side reader)' },
  'context_package.brief_bytes': { lane: 'context_package.brief_bytes', class: 'view', value: CONTEXT_PACKAGE_BRIEF_BYTES, unit: 'bytes', graceful: 'shed-flagged', enforcedAt: 'swarm-runtime.mjs _composeRecruitBrief (the rendered slice per branch)' },
});

/** One deep-frozen registry keyed by lane name (Decision 1). Every row: {lane, class, value, unit,
 * graceful, enforcedAt?, refusalCode?}. */
export const FRAME_LIMITS = deepFreeze({ ...ADMISSION, ...SUBSTRATE, ...VIEW, ...CONTEXT_PACKAGE });

export const FRAME_LIMITS_VERSION = '1.2.0';

/** Issue #105 (D1/B-3): the closed conversational depth ceiling for reply chains — a per-branch
 * depth cap (never per-subtree), declared per send, default 1. The derivation: the scanner's
 * MAX_MESSAGE_SEND_GRAMMAR_SCAN_BYTES window bounds one frame scan, and 8 is the smallest power
 * of two whose per-branch hop ceiling composes with the per-frame invariant; it is a COUNT,
 * never a clock (the campaign control law). */
export const MAX_MESSAGE_DEPTH_BUDGET = 8;

/** Named-export `code` (a string) so the suite's `assertLimitsModule` helper — which reads
 * `module?.code ?? module` when stringifying its red-stage message — is safe once the module
 * actually loads: an ESM namespace object has a null prototype and would otherwise throw
 * "Cannot convert object to primitive value" inside the template literal. */
export const code = 'limits-module';

/** sha256 of the canonical serialization of the DECLARED rows ONLY (Decision 7). A deployment
 * override of decision.need/decision.rationale rides the doctor projection's per-lane `effective`
 * channel and never changes this digest — the CLI handshake stays green between identical code. */
export const FRAME_LIMITS_DIGEST = createHash('sha256')
  .update(JSON.stringify(canonical(FRAME_LIMITS))).digest('hex');

/** Issue #394: the web wait ceiling, read from the ONE registry row above — the bound both wait
 * arms of web-northbound.mjs compare against. Never re-declared by a consumer. */
export const WEB_WAIT_CEILING_ROW = FRAME_LIMITS['web.wait_ceiling_ms'];

/** Issue #429: the measured-profile catalog's staleness bound, read from the ONE registry row above
 * — the window model-profile.mjs judges a cached Artificial Analysis catalog against (and the
 * `boundMs` it publishes), overridden only by a freshness window the provider's own response
 * declares. Never re-declared by a consumer. */
export const MODEL_PROFILE_STALENESS_ROW = FRAME_LIMITS['model_profile.catalog_staleness_ms'];

/** The web wait DEFAULT: the resident's own choice of how much of the transport deadline to keep
 * for serializing and delivering the answer — a stated FRACTION of the ceiling (5/6: 25 s of the
 * 30 s request deadline), so a ceiling change moves the default with it and no second literal
 * survives in the transport. */
const WEB_WAIT_DEFAULT_FRACTION = 5 / 6;
export const WEB_WAIT_DEFAULT_MS = Math.round(WEB_WAIT_CEILING_ROW.value * WEB_WAIT_DEFAULT_FRACTION);

/** Issue #394: the ONE derivation of the web wait-ceiling refusal code, scoped by the arm that
 * draws it — 'application' for the application `run.wait` arm (whose token is pinned
 * byte-identical by the blind-waits suite) and 'coordinator' for the legacy coordinator `wait`
 * arm. One family, one ceiling: a caller branches on the suffix and neither arm may re-spell it. */
export function webWaitCeilingRefusalCode(scope) {
  return `${scope}_wait_timeout_exceeds_web_ceiling`;
}

/** The ONE web wait-ceiling refusal text: the field, the ceiling it draws on, and the remedy. */
export function composeWebWaitCeilingRefusal(actual, row = WEB_WAIT_CEILING_ROW) {
  return `timeoutMs ${actual} exceeds the web wait ceiling (${row.lane} = ${row.value} ms); resend with timeoutMs ≤ ${row.value} or poll`;
}

// Issue #74 (D2/A5) — the coordinator authority boundary. The ONE new refusal code this rung
// introduces, plus the graceful escalation path it coaches. A coordinator-seat principal (a
// worker seat, principalId `worker:<id>` — the G9 seat class that never holds `approve`) reaching
// a wave/steering authority verb draws `coordinator_authority_forbidden` with {attempted,
// gracefulPath}, where gracefulPath names the DECISION_REQUEST escalation lane (the human answers
// via run.answer). The underlying denial stays application_unauthorized at the facade; this is
// the coordinator-facing coaching wrapper (the #12 Decision-5 split). Byte literals live HERE
// (Decision 8 no-re-declare law); the application dispatch seam consumes them by import.
export const COORDINATOR_AUTHORITY_FORBIDDEN = 'coordinator_authority_forbidden';
export const COORDINATOR_AUTHORITY_GRACEFUL_PATH = 'DECISION_REQUEST';
