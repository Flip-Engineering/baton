// runtime-redrive.mjs — issue #59, the re-drive continuity seam of the coordinator.
//
// A wave member re-driven after its predecessor's death can carry the dead attempt's closed state
// into the fresh attempt's provider-facing brief: the terminal cause, the refusal evidence, the
// scratchpad projection, and the checkpoint-pin digest list. The carry is OPT-IN — the orchestrator
// names both the source attempt and the scopes on the re-drive call — and it is evidence for the
// fresh attempt to verify, never authority: nothing here writes the dead attempt's rows into the
// fresh run's store, re-arms a gate, or satisfies a verification. The dead attempt's evidence never
// answers anything on the fresh attempt's behalf either; the checkpoint this member parks on is
// answered by the fresh attempt's OWN distinct evidence (the TG2 law at the end of this module).
//
// Two surfaces, one seam. `redriveContinuity` is the ADMISSION: it admits the closed
// `{sourceRunId, scopes}` option, resolves the source attempt from the store's own records,
// validates the role and wave-chain relation the store recorded, gathers the named scopes, and
// refuses typed (never silently) when any of that fails. `composeContinuity` is the closed
// SERIALIZER: it orders the carried members, refuses a body that cannot be rendered under the
// section's own frame, applies the item/byte bounds with the digest-cited spill, and stashes the
// composed block for the provider-facing brief. The renderer that emits the section lives in
// messages.mjs (renderContinuitySection), so the frame literal and the per-item frames have ONE
// owner.
//
// The module takes `(coordinator, recorder, ...)` — the convention every carved-out runtime module
// uses — so the coordinator's members are thin delegates and the store reads ride the recorder's
// coordination port.

import { createHash } from 'node:crypto';

import { FRAME_LIMITS, composeFrameLimitRefusal, frameLimitRefusalPath } from './limits.mjs';
import { carriedBodyCollidesWithFrame, carriedItemLine, orderContinuityItems } from './messages.mjs';
import { TERMINAL_TASK_STATUSES } from './runtime-recovery.mjs';

/** The closed four-member content set (D1). ACTUAL source order — the order the contract lists
 * the members in, which is also the order the admission walks them. */
export const REDRIVE_SCOPES = Object.freeze(['scratchpad', 'pins', 'terminal', 'refusals']);

/** The `redrive_carry_*` refusal family (D3/D1). Frozen surface constant: every refusal this seam
 * mints carries one of these codes, and each entry is the sentence the code means. Sorted order
 * (no < not < opt < ove < rol < sco < spi < unf < unk < wav). */
export const REDRIVE_REFUSAL_CODES = Object.freeze({
  redrive_carry_no_evidence: 'a named scope is empty on the source attempt — the section renders its absence-on-empty',
  redrive_carry_not_terminal: 'the source attempt is still live / not terminalized',
  redrive_carry_option_invalid: 'carryForward is not {sourceRunId, scopes} with a non-empty scopes subset',
  redrive_carry_oversized: 'the composed block exceeds the carry bound AND the spill lane is unavailable',
  redrive_carry_role_mismatch: 'the source attempt\'s role does not match the re-driven member\'s role',
  redrive_carry_scope_invalid: 'scopes contains a value outside the closed four-member set',
  redrive_carry_spill_unavailable: 'the block overflow needs a digest-cited spill but the spill lane refuses',
  redrive_carry_unframable: 'a carried body cannot be framed/neutralized at the render seam',
  redrive_carry_unknown_source: 'carryForward.sourceRunId cannot be resolved to a terminalized attempt',
  redrive_carry_wave_unrelated: 'the source attempt\'s wave is unrelated to this wave chain',
});

/** The scope → carried-entry id prefix (the #59 contract's `terminal:run:dead:1` shape). The
 * scratchpad member keeps the store's OWN entryId instead: its rows are already content-addressed
 * there, and re-labelling them would break the fresh attempt's ability to match them. */
const SCOPE_ENTRY_PREFIX = Object.freeze({ terminal: 'terminal', refusals: 'refusal', pins: 'pin' });

const CONTINUITY_ITEMS_ROW = () => FRAME_LIMITS['view.continuity.items'];
const CONTINUITY_BYTES_ROW = () => FRAME_LIMITS['view.continuity.bytes'];

function refusal(code, detail) {
  return Object.assign(new Error(`${REDRIVE_REFUSAL_CODES[code]} — ${detail}`), {
    name: 'CoordinationRefusal', code,
  });
}

/** A frame-economics refusal: the #89 ONE composer owns the human message, and the row's cap,
 * actual count and graceful path ride the payload beside it. */
function boundRefusal(code, detail, actual, cap) {
  const row = CONTINUITY_ITEMS_ROW();
  return Object.assign(new Error(`${REDRIVE_REFUSAL_CODES[code]} — ${detail}; ${composeFrameLimitRefusal(row, actual, cap)}`), {
    name: 'CoordinationRefusal', code, cap, actual, unit: row.unit,
    gracefulPath: frameLimitRefusalPath(row, cap),
  });
}

function digestOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** The closed `{sourceRunId, scopes}` option (D3). Every malformed shape refuses with the option's
 * own code — never silently, and never by falling back to a default source. */
function admitCarryForwardOption(carryForward) {
  if (!carryForward || typeof carryForward !== 'object' || Array.isArray(carryForward)) {
    throw refusal('redrive_carry_option_invalid', `carryForward is ${describe(carryForward)}`);
  }
  const keys = Object.keys(carryForward).sort();
  if (keys.join(',') !== 'scopes,sourceRunId') {
    throw refusal('redrive_carry_option_invalid', `carryForward keys are {${keys.join(', ')}}`);
  }
  if (typeof carryForward.sourceRunId !== 'string' || carryForward.sourceRunId.length === 0) {
    throw refusal('redrive_carry_option_invalid', 'carryForward.sourceRunId is not a non-empty string');
  }
  const scopes = carryForward.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0
    || scopes.some((scope) => typeof scope !== 'string' || scope.length === 0)) {
    throw refusal('redrive_carry_option_invalid', 'carryForward.scopes is not a non-empty array of scope names');
  }
  const outside = scopes.find((scope) => !REDRIVE_SCOPES.includes(scope));
  if (outside !== undefined) {
    throw refusal('redrive_carry_scope_invalid',
      `scope "${outside}" is outside {${REDRIVE_SCOPES.join(', ')}}`);
  }
  return Object.freeze({ sourceRunId: carryForward.sourceRunId, scopes: Object.freeze([...new Set(scopes)]) });
}

/** The run's recorded wave-member descriptors (the store's own records — a dead attempt's
 * model-authored content cannot mutate them, so a caller-asserted relation is never the input). */
function memberDescriptors(events, runId) {
  return events.filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'wave.member.admission' && event.payload?.runId === runId);
}

function latestMemberDescriptor(events, runId) {
  const rows = memberDescriptors(events, runId);
  return rows.length === 0 ? null : rows[rows.length - 1].payload;
}

function latestTerminalTransition(events, taskId) {
  const rows = events.filter((event) => event.kind === 'task.transitioned'
    && event.payload?.id === taskId && TERMINAL_TASK_STATUSES.has(event.payload?.to));
  return rows.length === 0 ? null : rows[rows.length - 1];
}

function checkpointRecords(events, runId) {
  return events.filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'wave.member.checkpoint' && event.payload?.runId === runId);
}

function carriedItem(runId, scope, ordinal, text) {
  return Object.freeze({
    scope,
    entryId: `${SCOPE_ENTRY_PREFIX[scope] ?? scope}:${runId}:${ordinal}`,
    digest: digestOf(text),
    text,
  });
}

/** Why the predecessor died, from the closed terminal-cause kinds the coordinator projects
 * (application-semantics.mjs projectTypedTerminalCause): the dead handle's own typed cause when the
 * attempt is still in memory, else the crash code its operational log carries, else the terminal
 * state the store recorded. */
function terminalCauseOf(coordinator, sourceTask) {
  const live = coordinator._workers?.get(sourceTask.assignee)?.terminalCause;
  if (live && typeof live.kind === 'string' && live.kind.length > 0) return { ...live };
  const crashes = typeof coordinator._log?.byKind === 'function'
    ? coordinator._log.byKind(sourceTask.assignee, 'lifecycle.crashed') : [];
  const code = crashes.at(-1)?.payload?.code;
  if (typeof code === 'string' && code.length > 0) return { kind: 'provider_failure', code };
  if (sourceTask.status === 'cancelled') return { kind: 'operator_stop', code: 'operator_stop' };
  return { kind: 'policy_failure', code: 'policy_failure_unclassified' };
}

/** The `terminal` member: the state the attempt died in and the transition that recorded it. */
function terminalItems(events, sourceTask, cause) {
  const transition = latestTerminalTransition(events, sourceTask.id);
  const from = transition?.payload?.from ?? 'unknown';
  const to = transition?.payload?.to ?? sourceTask.status;
  const seq = transition ? ` at coordination seq ${transition.seq}` : '';
  return [carriedItem(sourceTask.runId, 'terminal', 1,
    `terminal ${sourceTask.status} (${from} → ${to}${seq}); cause ${cause.kind}:${cause.code}`)];
}

/** The `refusals` member: the dead attempt's own gate verdict (the sanitized debugGateRefusal
 * projection) plus the provider-turn refusals it accumulated. */
function refusalItems(coordinator, sourceTask) {
  const workerId = sourceTask.assignee;
  if (typeof workerId !== 'string' || workerId.length === 0) return [];
  const lines = [];
  if (typeof coordinator._gateVerdictItemForWorker === 'function') {
    const verdict = coordinator._gateVerdictItemForWorker(workerId, {
      errors: coordinator._log.byKind(workerId, 'error'),
      reverified: coordinator._log.byKind(workerId, 'verify.reverified'),
    });
    if (verdict) {
      lines.push(`gate ${verdict.gate ?? 'unknown'}${verdict.code ? ` ${verdict.code}` : ''}`
        + `${verdict.message ? ` — ${verdict.message}` : ''}`);
    }
  }
  for (const event of coordinator._log.byKind(workerId, 'resource.provider_turn_refused')) {
    const code = event.payload?.code;
    if (typeof code === 'string' && code.length > 0) lines.push(`provider_turn_refused ${code}`);
  }
  return lines.map((text, index) => carriedItem(sourceTask.runId, 'refusals', index + 1, text));
}

/** The `scratchpad` member: the dead run's own projection snapshot, each row cited by the digest
 * the store already minted for it (never re-derived, never re-written). */
function scratchpadItems(recorder, sourceTask) {
  const store = recorder.coordination;
  if (!store || typeof store.scratchpadSnapshotBatch !== 'function') return [];
  const scopes = [];
  if (typeof sourceTask.assignee === 'string' && sourceTask.assignee.length > 0) {
    scopes.push(`worker:${sourceTask.assignee}`);
  }
  scopes.push('shared');
  let capture;
  try {
    capture = store.scratchpadSnapshotBatch(sourceTask.runId, scopes);
  } catch {
    return [];
  }
  const entries = (capture?.slices ?? []).flatMap((slice) => slice.entries ?? []);
  return entries.map((entry) => Object.freeze({
    scope: 'scratchpad',
    entryId: entry.entryId,
    digest: entry.contentDigest ?? null,
    text: `${entry.kind ?? 'entry'}: ${scratchpadEntryText(entry)}`,
  }));
}

function scratchpadEntryText(entry) {
  const content = entry?.content;
  if (typeof content?.text === 'string') return content.text;
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

/** The `pins` member: the dead member's checkpoint history as `resolveResultPin` disambiguates it
 * (wave.mjs) — per `{report, startedAtMs, excludeShas}`, within the member's own start window, and
 * attributed to THIS run alone. The re-resolution inputs ride alongside the shas so the fresh
 * attempt can re-run the salvage path with the same disambiguation, and the shas are directly
 * citable. Never a raw ref scan: another member's pin in the same window is not carried. */
function pinItems(events, sourceRunId) {
  return checkpointRecords(events, sourceRunId).map((event, index) => {
    const record = event.payload;
    const shas = Array.isArray(record.shas) ? record.shas.filter((sha) => typeof sha === 'string') : [];
    const excludeShas = Array.isArray(record.excludeShas)
      ? record.excludeShas.filter((sha) => typeof sha === 'string') : [];
    const text = `resolveResultPin {report: ${record.report}, startedAtMs: ${record.startedAtMs}, `
      + `excludeShas: ${JSON.stringify(excludeShas)}} → ${shas.length} sha(s): ${shas.join(' ')}`;
    return carriedItem(sourceRunId, 'pins', index + 1, text);
  });
}

/** The carry admission surface `_redriveContinuity(memberId, carryForward)`. Returns null when no
 * carry was declared (the opt-in posture: a same-role dead source is never carried by default),
 * otherwise the admitted `{memberId, sourceRunId, scopes, continuity}` block. Every refusal is
 * typed and fires BEFORE any side effect — nothing is composed, stashed or written on the way out.
 */
export function redriveContinuity(coordinator, recorder, memberId, carryForward) {
  if (carryForward === null || carryForward === undefined) return null;
  const option = admitCarryForwardOption(carryForward);
  const handle = coordinator._workers?.get(memberId);
  const memberTask = handle ? coordinator._tasks?.get(handle.taskId) : null;
  const memberRunId = memberTask?.runId ?? null;
  if (typeof memberRunId !== 'string' || memberRunId.length === 0) {
    throw refusal('redrive_carry_option_invalid', `member ${String(memberId)} is not a live member of any run`);
  }
  const events = recorder.coordination.events();
  const memberDescriptor = latestMemberDescriptor(events, memberRunId);
  if (!memberDescriptor) {
    throw refusal('redrive_carry_option_invalid', `run ${memberRunId} records no wave member descriptor`);
  }
  const sourceTask = recorder.coordination._taskByRun(option.sourceRunId);
  if (!sourceTask) {
    throw refusal('redrive_carry_unknown_source', `run ${option.sourceRunId} hosts no attempt`);
  }
  if (!TERMINAL_TASK_STATUSES.has(sourceTask.status)) {
    throw refusal('redrive_carry_not_terminal', `attempt ${option.sourceRunId} is ${sourceTask.status}`);
  }
  const sourceDescriptor = latestMemberDescriptor(events, sourceTask.runId);
  if (!sourceDescriptor || sourceDescriptor.role !== memberDescriptor.role) {
    throw refusal('redrive_carry_role_mismatch',
      `role ${sourceDescriptor?.role ?? 'unrecorded'} cannot feed a re-drive of role ${memberDescriptor.role}`);
  }
  const related = sourceDescriptor.waveId === memberDescriptor.waveId
    || (memberDescriptor.predecessorWaveId != null
      && sourceDescriptor.waveId === memberDescriptor.predecessorWaveId);
  if (!related) {
    throw refusal('redrive_carry_wave_unrelated',
      `wave ${sourceDescriptor.waveId} is unrelated to wave ${memberDescriptor.waveId}`);
  }

  const cause = terminalCauseOf(coordinator, sourceTask);
  const items = [];
  for (const scope of REDRIVE_SCOPES) {
    if (!option.scopes.includes(scope)) continue;
    if (scope === 'terminal') items.push(...terminalItems(events, sourceTask, cause));
    else if (scope === 'refusals') items.push(...refusalItems(coordinator, sourceTask));
    else if (scope === 'scratchpad') items.push(...scratchpadItems(recorder, sourceTask));
    else if (scope === 'pins') items.push(...pinItems(events, sourceTask.runId));
  }
  if (items.length === 0) {
    throw refusal('redrive_carry_no_evidence',
      `scope${option.scopes.length > 1 ? 's' : ''} ${option.scopes.join(', ')} hold no carried content on ${sourceTask.runId}`);
  }

  const continuity = coordinator._composeContinuity(memberId, {
    source: {
      runId: sourceTask.runId, role: sourceDescriptor.role,
      waveId: sourceDescriptor.waveId, terminalCause: cause,
    },
    items,
  });
  return Object.freeze({
    memberId, sourceRunId: sourceTask.runId, scopes: option.scopes, continuity,
  });
}

/** The closed serializer `_composeContinuity(memberId, continuity)`. It owns the within-block
 * order (terminal → refusals → scratchpad → pins), the refusal of a body that cannot be rendered
 * under the section's own frame, and the block's bounds: the head is served in full up to
 * `view.continuity.items`, and everything beyond it — or beyond the `view.continuity.bytes` render
 * bound — rides a digest-cited spill, never a truncation. The composed block is what the
 * provider-facing brief carries, and the admitted `task.brief` is never touched. */
export function composeContinuity(coordinator, recorder, memberId, continuity) {
  const items = orderContinuityItems(continuity?.items);
  if (items.length === 0) return null;
  for (const item of items) {
    if (carriedBodyCollidesWithFrame(item?.text)) {
      throw refusal('redrive_carry_unframable',
        `the carried body for scope ${String(item?.scope)} carries the section's own frame marker`);
    }
  }

  const itemCap = CONTINUITY_ITEMS_ROW().value;
  const byteCap = CONTINUITY_BYTES_ROW().value;
  const rendered = items.map((item) => carriedItemLine(item));
  const totalBytes = rendered.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);

  const head = [];
  const overflow = [];
  if (items.length <= itemCap && totalBytes <= byteCap) {
    head.push(...items);
  } else {
    // The block's last slot belongs to the spill citation, so the in-block head is one item
    // shorter than the item bound whenever anything overflows.
    const slots = itemCap - 1;
    let bytes = 0;
    for (let index = 0; index < items.length; index += 1) {
      const lineBytes = Buffer.byteLength(rendered[index]) + 1;
      if (head.length >= slots || (head.length > 0 && bytes + lineBytes > byteCap)) {
        overflow.push(...items.slice(index));
        break;
      }
      head.push(items[index]);
      bytes += lineBytes;
    }
  }

  const truncated = overflow.length > 0;
  let spillEntry = null;
  if (truncated) {
    const body = overflow.map((item) => carriedItemLine(item)).join('\n');
    let minted = null;
    let failure = null;
    try {
      minted = recorder.coordination.mintSpill(
        { body, lane: CONTINUITY_ITEMS_ROW().lane },
        { actor: 'hub', key: `redrive.continuity.spill:${digestOf(body)}` },
      );
    } catch (error) {
      failure = error;
    }
    const spillId = minted?.spill?.spillId;
    if (typeof spillId !== 'string' || spillId.length === 0) {
      // The item-count overflow degrades to a digest-cited spill; a block that also crosses the
      // byte bound has no bounded head to serve at all, so it refuses the carry outright.
      const detail = failure?.message ? `spill lane refused: ${failure.message}` : 'no spill artifact was minted';
      throw totalBytes > byteCap
        ? boundRefusal('redrive_carry_oversized', detail, items.length, itemCap)
        : refusal('redrive_carry_spill_unavailable', detail);
    }
    spillEntry = Object.freeze({
      scope: 'spill',
      entryId: spillId,
      digest: minted.spill.digest ?? null,
      text: `${overflow.length} carried member(s) beyond the block bound — resend this citation`,
      bytes: minted.spill.bytes ?? null,
    });
  }

  const composed = Object.freeze({
    source: continuity?.source ?? null,
    items: Object.freeze([...head, ...(spillEntry ? [spillEntry] : [])]),
    truncated,
  });
  coordinator._continuityByMember ??= new Map();
  coordinator._continuityByMember.set(memberId, composed);
  // A checkpoint this member already parked becomes the carry's verification cycle too — the carry
  // may arrive after the park, and the same own-evidence law answers it either way.
  armSteeringCycles(coordinator, memberId);
  return composed;
}

/** The composed block a member's admission stashed, or null when this member carries nothing.
 * The provider-facing brief reads it here so the renderer needs no seam logic of its own. */
export function continuityForMember(coordinator, memberId) {
  if (typeof memberId !== 'string' || memberId.length === 0) return null;
  return coordinator._continuityByMember?.get(memberId) ?? null;
}

// ---------------------------------------------------------------------------
// The TG2 evidence law for a carried checkpoint (D4/GT8). A member whose re-drive carried a dead
// attempt's state must answer that carry with evidence of its OWN: the checkpoint it parks on
// observes the attempt's scratchpad receipts, the set collects only THIS attempt's distinct
// content digests, and the carried (dead) digests are never among them — they are structurally
// ineligible, because the fresh run's own store never holds them. A member that carried nothing
// arms nothing: its checkpoint keeps the shipped park semantics, where the autonomous
// orchestrator's explicit act is the only thing that resolves it.
// ---------------------------------------------------------------------------

/** Arm one checkpoint record that belongs to a member carrying continuity. */
export function armSteeringCycle(coordinator, workerId, record) {
  if (!record || typeof workerId !== 'string' || workerId.length === 0) return;
  if (!continuityForMember(coordinator, workerId)) return;
  if (record.steering) return;
  record.steering = { answered: false, digestSet: new Set() };
}

/** Arm every still-pending checkpoint of a member that has just carried continuity (the carry may
 * arrive after the checkpoint was already parked). */
export function armSteeringCycles(coordinator, workerId) {
  const records = coordinator._pausedTurns;
  if (!records || typeof records.values !== 'function') return;
  for (const record of records.values()) {
    if (record?.worker === workerId && record.state === 'pending') {
      armSteeringCycle(coordinator, workerId, record);
    }
  }
}

/** Observe one scratchpad receipt against the member's unanswered carried checkpoints. The receipt
 * answers when its content digest is THIS attempt's own and distinct — a digest the cycle already
 * holds is evidence it has already seen, and a carried digest can never be the receipt's own. */
export function observeSteeringEvidence(coordinator, workerId, digest) {
  if (typeof digest !== 'string' || digest.length === 0) return;
  const records = coordinator._pausedTurns;
  if (!records || typeof records.entries !== 'function') return;
  for (const [pauseId, record] of records.entries()) {
    const steering = record?.steering;
    if (!steering || steering.answered === true || record.worker !== workerId) continue;
    if (steering.digestSet.has(digest)) continue;
    steering.digestSet.add(digest);
    steering.answered = true;
    record.resolution = { kind: 'scratchpad_evidence', digest };
    coordinator._resolvePauseAuthority(pauseId, record, 'steering_evidence');
  }
}
