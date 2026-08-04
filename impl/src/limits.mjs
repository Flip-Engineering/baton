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

const ADMISSION = Object.freeze({
  'message.send.body': { lane: 'message.send.body', class: 'admission', value: 2048, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'coordinator.sendMessage', refusalCode: 'spill_body_exceeded' },
  'message.reply.body': { lane: 'message.reply.body', class: 'admission', value: 2048, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'coordinator message.send reply admission', refusalCode: 'spill_body_exceeded' },
  'run.objective': { lane: 'run.objective', class: 'admission', value: 4096, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application run.start admission', refusalCode: 'spill_body_exceeded' },
  'wave.member.objective': { lane: 'wave.member.objective', class: 'admission', value: 4096, unit: 'bytes', graceful: 'spill-digest-citation', enforcedAt: 'application startWave/attachWave member admission', refusalCode: 'spill_body_exceeded' },
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
});

const SUBSTRATE = Object.freeze({
  'scanner.window.decision': { lane: 'scanner.window.decision', class: 'substrate', value: 8192, unit: 'bytes', graceful: null },
  'scanner.window.scratchpad': { lane: 'scanner.window.scratchpad', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.context_read': { lane: 'scanner.window.context_read', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.message_send': { lane: 'scanner.window.message_send', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.board_claim': { lane: 'scanner.window.board_claim', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'scanner.window.board_report': { lane: 'scanner.window.board_report', class: 'substrate', value: 20480, unit: 'bytes', graceful: null },
  'wire.frame': { lane: 'wire.frame', class: 'substrate', value: 1048576, unit: 'bytes', graceful: null },
  'credential.file': { lane: 'credential.file', class: 'substrate', value: 16384, unit: 'bytes', graceful: null },
  'context_pack.body': { lane: 'context_pack.body', class: 'substrate', value: 8192, unit: 'bytes', graceful: null },
  // spill.body is the ONE substrate row that mints a refusal (blocker 3): a substrate ceiling
  // enforced AT ADMISSION — it is a resource ceiling on a durable write, not a scanner window.
  'spill.body': { lane: 'spill.body', class: 'substrate', value: 1048576, unit: 'bytes', graceful: null, enforcedAt: 'coordination-store.mintSpill / admission spill seam', refusalCode: 'spill_body_exceeded' },
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
  'view.blocked_interaction_summary.bytes': { lane: 'view.blocked_interaction_summary.bytes', class: 'view', value: 160, unit: 'bytes', graceful: 'shed-flagged' },
  'view.knowledge_slice.items': { lane: 'view.knowledge_slice.items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.knowledge_slice.bytes': { lane: 'view.knowledge_slice.bytes', class: 'view', value: 2048, unit: 'bytes', graceful: 'shed-flagged' },
  'view.context_read.knowledge_items': { lane: 'view.context_read.knowledge_items', class: 'view', value: 8, unit: 'items', graceful: 'shed-flagged' },
  'view.context_read.items': { lane: 'view.context_read.items', class: 'view', value: 64, unit: 'items', graceful: 'shed-flagged' },
  'view.inspect_captured_file.bytes': { lane: 'view.inspect_captured_file.bytes', class: 'view', value: 4194304, unit: 'bytes', graceful: 'shed-flagged' },
});

/** One deep-frozen registry keyed by lane name (Decision 1). Every row: {lane, class, value, unit,
 * graceful, enforcedAt?, refusalCode?}. */
export const FRAME_LIMITS = deepFreeze({ ...ADMISSION, ...SUBSTRATE, ...VIEW });

export const FRAME_LIMITS_VERSION = '1.2.0';

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
