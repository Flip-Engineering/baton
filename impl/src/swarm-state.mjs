// Durable domain state for living Baton swarms.
//
// Extracted deterministic event fold compatible with CoordinationStore transaction
// snapshots/replay. Mirrors the orchestrator-plan.mjs coordination lane pattern:
// a mutable Map of swarm rows is the projection surface; fold functions produce
// frozen immutable replacement rows; no external effects in replay.
//
// Root hooks validateSwarmEvent and foldSwarmEvent to the same durable coordination
// log, not a parallel journal. Consumers own the log; this module owns the fold.

export const SWARM_EVENT_KINDS = Object.freeze(new Set([
  'swarm.created',
  'swarm.participant_joined',
  'swarm.participant_bound',
  'swarm.participant_left',
  'swarm.group_updated',
  'swarm.work_updated',
  'swarm.assignment_updated',
  'swarm.context_updated',
  'swarm.contribution_recorded',
  'swarm.contribution_reviewed',
  'swarm.closed',
]));

export const SWARM_WORK_STATUSES = Object.freeze(['open', 'completed', 'cancelled']);
export const SWARM_ASSIGNMENT_STATUSES = Object.freeze(['active', 'released']);
export const SWARM_REVIEW_DECISIONS = Object.freeze(['accept', 'reject', 'comment']);

export class SwarmRefusal extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'SwarmRefusal';
    this.code = code;
    this.detail = detail === null ? null : Object.freeze({ ...detail });
  }
}

export class SwarmIntegrityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SwarmIntegrityError';
    this.code = code;
  }
}

function refuse(message, code, detail = null) {
  throw new SwarmRefusal(message, code, detail);
}

function integrity(message, code) {
  throw new SwarmIntegrityError(message, code);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// ── shape helpers ─────────────────────────────────────────────────────────────

function validOptionalNonEmptyString(value, fieldName, errorFn) {
  if (value !== undefined && !isNonEmptyString(value)) {
    errorFn(`${fieldName} must be a non-empty string if present`, 'invalid_payload');
  }
}

// 0 is valid: callers use expectedVersion:0 for create-if-absent CAS.
function validOptionalNonNegativeInt(value, fieldName, errorFn) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    errorFn(`${fieldName} must be a non-negative integer if present`, 'invalid_payload');
  }
}

// Own-property lookup — safe with null-prototype dicts and prototype-named keys.
function ownGet(dict, key) {
  return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;
}

// Validate that value is JSON-compatible. Throws SwarmRefusal.
function validateBody(value, seen = new Set()) {
  if (value === null) return;
  if (value === undefined) refuse('undefined is not a valid body value', 'invalid_body');
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return;
  if (t === 'number') {
    if (!Number.isFinite(value)) refuse(`non-finite number in body: ${value}`, 'invalid_body');
    return;
  }
  if (t !== 'object') refuse(`non-JSON type ${t} in body`, 'invalid_body');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== null && proto !== Object.prototype) {
    refuse('non-JSON object instance in body (e.g. Date, Map, Set, RegExp)', 'invalid_body');
  }
  if (seen.has(value)) refuse('circular reference in body', 'invalid_body');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateBody(item, seen);
  } else {
    for (const k of Object.keys(value)) validateBody(value[k], seen);
  }
  seen.delete(value);
}

// Composite key for context entries: same named key can exist in different group scopes.
export function swarmContextKey(key, groupId = null) {
  return JSON.stringify([groupId ?? null, key]);
}

// Recursive deep-copy + freeze for body values. Assumes validateBody already called.
// Uses Object.fromEntries so __proto__ and other prototype-named keys survive as own properties.
function deepFreezeBody(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeBody));
  return Object.freeze(
    Object.fromEntries(Object.keys(value).map((k) => [k, deepFreezeBody(value[k])]))
  );
}

// Extract event metadata for attribution on every row.
function eventMeta(event) {
  return {
    actor: isNonEmptyString(event.actor) ? event.actor : null,
    seq: Number.isSafeInteger(event.seq) ? event.seq : null,
    ts: event.ts ?? null,
  };
}

// ── initial state ─────────────────────────────────────────────────────────────

// Null-prototype frozen dictionary. Safe for prototype-named keys.
function nullDict(entries = []) {
  const d = Object.create(null);
  for (const [k, v] of entries) d[k] = v;
  return Object.freeze(d);
}

function emptySwarm(swarmId, purpose) {
  return Object.freeze({
    swarmId, purpose, status: 'open', closedReason: null,
    participants: nullDict(), groups: nullDict(), work: nullDict(),
    assignments: nullDict(), context: nullDict(), contributions: nullDict(), reviews: nullDict(),
  });
}

// Replace one nested collection in a frozen swarm row with a null-prototype dict.
function replaceField(swarm, field, map) {
  return Object.freeze({ ...swarm, [field]: nullDict(map) });
}

// Generic recursive clone with sorted object keys — deterministic across replay.
// Uses Object.fromEntries so __proto__ and other prototype-named keys survive as own properties.
function canonicalClone(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalClone);
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalClone(value[k])]));
}

// ── validateSwarmEvent ────────────────────────────────────────────────────────
//
// Shape-only validation before committing an event to the durable log.
// No state access; referential integrity is enforced by foldSwarmEvent.
// Throws SwarmRefusal on invalid input.

export function validateSwarmEvent(kind, payload) {
  if (!SWARM_EVENT_KINDS.has(kind)) {
    refuse(`unknown swarm event kind: ${kind}`, 'unknown_event_kind');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    refuse('swarm event payload must be a plain object', 'invalid_payload');
  }
  const p = payload;
  if (!isNonEmptyString(p.swarmId)) {
    refuse('swarm event payload must include a non-empty swarmId', 'invalid_payload');
  }

  if (kind === 'swarm.created') {
    if (!isNonEmptyString(p.purpose)) refuse('swarm.created requires a non-empty purpose', 'invalid_payload');
    return;
  }
  if (kind === 'swarm.participant_joined') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.participant_joined requires participantId', 'invalid_payload');
    validOptionalNonEmptyString(p.role, 'participant role', refuse);
    validOptionalNonEmptyString(p.parentId, 'participant parentId', refuse);
    validOptionalNonEmptyString(p.runId, 'participant runId', refuse);
    if (p.permissions !== undefined) {
      if (!Array.isArray(p.permissions)) refuse('participant permissions must be an array if present', 'invalid_payload');
      if (!p.permissions.every(isNonEmptyString)) refuse('participant permissions must be non-empty strings', 'invalid_payload');
    }
    return;
  }
  if (kind === 'swarm.participant_bound') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.participant_bound requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workerId)) refuse('swarm.participant_bound requires workerId', 'invalid_payload');
    if (!isNonEmptyString(p.taskId)) refuse('swarm.participant_bound requires taskId', 'invalid_payload');
    validOptionalNonEmptyString(p.sessionId, 'participant sessionId', refuse);
    return;
  }
  if (kind === 'swarm.participant_left') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.participant_left requires participantId', 'invalid_payload');
    validOptionalNonEmptyString(p.reason, 'left reason', refuse);
    return;
  }
  if (kind === 'swarm.group_updated') {
    if (!isNonEmptyString(p.groupId)) refuse('swarm.group_updated requires groupId', 'invalid_payload');
    if (!Array.isArray(p.members)) refuse('swarm.group_updated requires a members array', 'invalid_payload');
    if (!p.members.every(isNonEmptyString)) refuse('group members must be non-empty strings', 'invalid_payload');
    if (new Set(p.members).size !== p.members.length) refuse('group members must be distinct', 'invalid_payload');
    validOptionalNonEmptyString(p.purpose, 'group purpose', refuse);
    validOptionalNonNegativeInt(p.expectedVersion, 'group expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.work_updated') {
    if (!isNonEmptyString(p.workId)) refuse('swarm.work_updated requires workId', 'invalid_payload');
    if (!isNonEmptyString(p.objective)) refuse('swarm.work_updated requires a non-empty objective', 'invalid_payload');
    if (p.status !== undefined && !SWARM_WORK_STATUSES.includes(p.status)) {
      refuse(`work status must be one of: ${SWARM_WORK_STATUSES.join(', ')}`, 'invalid_payload');
    }
    validOptionalNonNegativeInt(p.expectedVersion, 'work expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.assignment_updated') {
    if (!isNonEmptyString(p.assignmentId)) refuse('swarm.assignment_updated requires assignmentId', 'invalid_payload');
    if (!isNonEmptyString(p.participantId)) refuse('swarm.assignment_updated requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workId)) refuse('swarm.assignment_updated requires workId', 'invalid_payload');
    if (!SWARM_ASSIGNMENT_STATUSES.includes(p.status)) {
      refuse(`assignment status must be one of: ${SWARM_ASSIGNMENT_STATUSES.join(', ')}`, 'invalid_payload');
    }
    validOptionalNonNegativeInt(p.expectedVersion, 'assignment expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.context_updated') {
    if (!isNonEmptyString(p.key)) refuse('swarm.context_updated requires a non-empty key', 'invalid_payload');
    if (p.body === undefined || p.body === null) refuse('swarm.context_updated requires body', 'invalid_payload');
    validateBody(p.body);
    validOptionalNonEmptyString(p.groupId, 'context groupId', refuse);
    validOptionalNonNegativeInt(p.expectedVersion, 'context expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.contribution_recorded') {
    if (!isNonEmptyString(p.contributionId)) refuse('swarm.contribution_recorded requires contributionId', 'invalid_payload');
    if (!isNonEmptyString(p.participantId)) refuse('swarm.contribution_recorded requires participantId', 'invalid_payload');
    validOptionalNonEmptyString(p.workId, 'contribution workId', refuse);
    if (p.refs !== undefined) {
      if (!Array.isArray(p.refs)) refuse('contribution refs must be an array if present', 'invalid_payload');
      if (!p.refs.every(isNonEmptyString)) refuse('contribution refs must be non-empty strings', 'invalid_payload');
    }
    if (p.body !== undefined && p.body !== null) validateBody(p.body);
    return;
  }
  if (kind === 'swarm.contribution_reviewed') {
    if (!isNonEmptyString(p.contributionId)) refuse('swarm.contribution_reviewed requires contributionId', 'invalid_payload');
    if (!SWARM_REVIEW_DECISIONS.includes(p.decision)) {
      refuse(`review decision must be one of: ${SWARM_REVIEW_DECISIONS.join(', ')}`, 'invalid_payload');
    }
    validOptionalNonEmptyString(p.reviewerId, 'reviewerId', refuse);
    validOptionalNonEmptyString(p.reason, 'review reason', refuse);
    return;
  }
  if (kind === 'swarm.closed') {
    validOptionalNonEmptyString(p.reason, 'closed reason', refuse);
    return;
  }
}

// ── foldSwarmEvent ────────────────────────────────────────────────────────────
//
// Pure over (swarms: Map<swarmId, SwarmState>, event): the same log sequence always
// folds to the same projection. Calls validateSwarmEvent first (converting SwarmRefusal
// to SwarmIntegrityError), then applies stateful checks (referential integrity,
// version CAS) and mutates the outer swarms Map with a frozen replacement row.
//
// event: { kind, payload, actor?, seq?, ts? }

export function foldSwarmEvent(swarms, event) {
  const { kind, payload: p } = event;

  // Shape validation — same logic as the write lane; converts to integrity errors.
  try {
    validateSwarmEvent(kind, p);
  } catch (err) {
    if (err instanceof SwarmRefusal) throw new SwarmIntegrityError(err.message, err.code ?? 'invalid_payload');
    throw err;
  }

  const meta = eventMeta(event);

  if (kind === 'swarm.created') {
    if (swarms.has(p.swarmId)) integrity(`swarm ${p.swarmId} is already created`, 'swarm_duplicate');
    swarms.set(p.swarmId, emptySwarm(p.swarmId, p.purpose));
    return;
  }

  const swarm = swarms.get(p.swarmId);
  if (!swarm) integrity(`swarm ${p.swarmId} not found`, 'swarm_not_found');

  if (kind === 'swarm.participant_joined') {
    if (ownGet(swarm.participants, p.participantId)) {
      integrity(`participant ${p.participantId} already exists in swarm ${p.swarmId}`, 'participant_duplicate');
    }
    if (isNonEmptyString(p.parentId) && !ownGet(swarm.participants, p.parentId)) {
      integrity(`parentId ${p.parentId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    const participant = Object.freeze({
      participantId: p.participantId, role: p.role ?? null, parentId: p.parentId ?? null,
      runId: p.runId ?? null, permissions: p.permissions ? Object.freeze([...p.permissions]) : null,
      status: 'active', leftReason: null, bindings: Object.freeze([]),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, participant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.participant_bound') {
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const binding = Object.freeze({
      workerId: p.workerId, taskId: p.taskId, sessionId: p.sessionId ?? null,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const updatedParticipant = Object.freeze({
      ...participant, bindings: Object.freeze([...participant.bindings, binding]),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.participant_left') {
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant, status: 'left', leftReason: p.reason ?? null,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.group_updated') {
    // Members must be currently active participants (not left).
    for (const memberId of p.members) {
      const member = ownGet(swarm.participants, memberId);
      if (!member) integrity(`group member ${memberId} not found in swarm ${p.swarmId}`, 'participant_not_found');
      if (member.status !== 'active') integrity(`group member ${memberId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
    }
    const existingGroup = ownGet(swarm.groups, p.groupId) ?? null;
    const currentVersion = existingGroup?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm group ${p.groupId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    const updatedGroup = Object.freeze({
      groupId: p.groupId,
      purpose: p.purpose !== undefined ? p.purpose : (existingGroup?.purpose ?? null),
      members: Object.freeze([...p.members]), version: currentVersion + 1,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const groups = new Map(Object.entries(swarm.groups));
    groups.set(p.groupId, updatedGroup);
    swarms.set(p.swarmId, replaceField(swarm, 'groups', groups));
    return;
  }

  if (kind === 'swarm.work_updated') {
    const existingWork = ownGet(swarm.work, p.workId) ?? null;
    const currentVersion = existingWork?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm work ${p.workId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    const updatedWork = Object.freeze({
      workId: p.workId, objective: p.objective,
      // Default status is 'open' for new items; preserve existing status if not specified.
      status: p.status !== undefined ? p.status : (existingWork?.status ?? 'open'),
      version: currentVersion + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const work = new Map(Object.entries(swarm.work));
    work.set(p.workId, updatedWork);
    swarms.set(p.swarmId, replaceField(swarm, 'work', work));
    return;
  }

  if (kind === 'swarm.assignment_updated') {
    if (!ownGet(swarm.participants, p.participantId)) {
      integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    if (!ownGet(swarm.work, p.workId)) {
      integrity(`work ${p.workId} not found in swarm ${p.swarmId}`, 'work_not_found');
    }
    const existingAssignment = ownGet(swarm.assignments, p.assignmentId) ?? null;
    const currentVersion = existingAssignment?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(
        `swarm assignment ${p.assignmentId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`,
        'version_conflict',
      );
    }
    const updatedAssignment = Object.freeze({
      assignmentId: p.assignmentId, participantId: p.participantId, workId: p.workId,
      status: p.status, version: currentVersion + 1,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const assignments = new Map(Object.entries(swarm.assignments));
    assignments.set(p.assignmentId, updatedAssignment);
    swarms.set(p.swarmId, replaceField(swarm, 'assignments', assignments));
    return;
  }

  if (kind === 'swarm.context_updated') {
    // groupId referential integrity (stateful — not in shape validator).
    if (isNonEmptyString(p.groupId) && !ownGet(swarm.groups, p.groupId)) {
      integrity(`context groupId ${p.groupId} not found in swarm ${p.swarmId}`, 'group_not_found');
    }
    // Composite key: same named key may exist independently in global vs. group scope.
    const ctxKey = swarmContextKey(p.key, p.groupId ?? null);
    const existingContext = ownGet(swarm.context, ctxKey) ?? null;
    const currentVersion = existingContext?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm context '${ctxKey}' version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    const updatedContext = Object.freeze({
      key: p.key, body: deepFreezeBody(p.body), groupId: p.groupId ?? null,
      version: currentVersion + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const context = new Map(Object.entries(swarm.context));
    context.set(ctxKey, updatedContext);
    swarms.set(p.swarmId, replaceField(swarm, 'context', context));
    return;
  }

  if (kind === 'swarm.contribution_recorded') {
    if (!ownGet(swarm.participants, p.participantId)) {
      integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    if (isNonEmptyString(p.workId) && !ownGet(swarm.work, p.workId)) {
      integrity(`work ${p.workId} not found in swarm ${p.swarmId}`, 'work_not_found');
    }
    if (ownGet(swarm.contributions, p.contributionId)) {
      integrity(`contribution ${p.contributionId} already exists in swarm ${p.swarmId}`, 'contribution_duplicate');
    }
    const contribution = Object.freeze({
      contributionId: p.contributionId, participantId: p.participantId, workId: p.workId ?? null,
      body: p.body !== undefined ? deepFreezeBody(p.body) : null,
      refs: p.refs ? Object.freeze([...p.refs]) : null,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const contributions = new Map(Object.entries(swarm.contributions));
    contributions.set(p.contributionId, contribution);
    swarms.set(p.swarmId, replaceField(swarm, 'contributions', contributions));
    return;
  }

  if (kind === 'swarm.contribution_reviewed') {
    if (!ownGet(swarm.contributions, p.contributionId)) {
      integrity(`contribution ${p.contributionId} not found in swarm ${p.swarmId}`, 'contribution_not_found');
    }
    // reviewerId referential integrity: if given, must be a known participant.
    if (isNonEmptyString(p.reviewerId) && !ownGet(swarm.participants, p.reviewerId)) {
      integrity(`reviewerId ${p.reviewerId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    // Append — never erase prior reviews; opposing reviews are both retained.
    const review = Object.freeze({
      reviewerId: p.reviewerId ?? null, decision: p.decision, reason: p.reason ?? null,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const existing = ownGet(swarm.reviews, p.contributionId) ?? [];
    const updatedReviews = Object.freeze([...existing, review]);
    const reviews = new Map(Object.entries(swarm.reviews));
    reviews.set(p.contributionId, updatedReviews);
    swarms.set(p.swarmId, replaceField(swarm, 'reviews', reviews));
    return;
  }

  if (kind === 'swarm.closed') {
    if (swarm.status === 'closed') integrity(`swarm ${p.swarmId} is already closed`, 'swarm_already_closed');
    swarms.set(p.swarmId, Object.freeze({ ...swarm, status: 'closed', closedReason: p.reason ?? null }));
    return;
  }

  integrity(`unsupported swarm event kind: ${kind}`, 'unsupported_event_kind');
}

// ── readSwarm ─────────────────────────────────────────────────────────────────
//
// Returns the live swarm row. Throws SwarmRefusal if the swarm is not found.

export function readSwarm(swarms, id) {
  const swarm = swarms.get(id);
  if (!swarm) refuse(`swarm ${id} not found`, 'swarm_not_found', { swarmId: id });
  return swarm;
}

// ── swarmSnapshot ─────────────────────────────────────────────────────────────
//
// Deterministic serializable projection of all swarms. Uses canonicalClone so
// new fields on rows appear automatically; no manual field enumeration.
// Live and replay snapshots produce byte-identical JSON.stringify output.

export function swarmSnapshot(swarms) {
  const swarmList = [...swarms.keys()].sort().map((swarmId) => {
    const s = swarms.get(swarmId);
    // canonicalClone recurses with sorted keys; handles null-prototype dicts and frozen arrays.
    return canonicalClone(s);
  });

  return { swarms: swarmList };
}
