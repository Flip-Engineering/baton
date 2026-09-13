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

function validOptionalPositiveInt(value, fieldName, errorFn) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    errorFn(`${fieldName} must be a positive integer if present`, 'invalid_payload');
  }
}

// ── initial state ─────────────────────────────────────────────────────────────

function emptySwarm(swarmId, purpose) {
  return Object.freeze({
    swarmId,
    purpose,
    status: 'open',
    closedReason: null,
    participants: Object.freeze({}),
    groups: Object.freeze({}),
    work: Object.freeze({}),
    assignments: Object.freeze({}),
    context: Object.freeze({}),
    contributions: Object.freeze({}),
    reviews: Object.freeze({}),
  });
}

// Replace one nested plain-object collection in a frozen swarm row.
function replaceField(swarm, field, map) {
  const obj = Object.create(null);
  for (const [k, v] of map) obj[k] = v;
  return Object.freeze({ ...swarm, [field]: Object.freeze(obj) });
}

// Deep-freeze a body value (plain text or JSON object). Strings pass through.
function freezeBody(body) {
  if (body === null || body === undefined) return body;
  if (typeof body !== 'object') return body;
  return Object.freeze(JSON.parse(JSON.stringify(body)));
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
    validOptionalPositiveInt(p.expectedVersion, 'group expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.work_updated') {
    if (!isNonEmptyString(p.workId)) refuse('swarm.work_updated requires workId', 'invalid_payload');
    if (!isNonEmptyString(p.objective)) refuse('swarm.work_updated requires a non-empty objective', 'invalid_payload');
    if (p.status !== undefined && !SWARM_WORK_STATUSES.includes(p.status)) {
      refuse(`work status must be one of: ${SWARM_WORK_STATUSES.join(', ')}`, 'invalid_payload');
    }
    validOptionalPositiveInt(p.expectedVersion, 'work expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.assignment_updated') {
    if (!isNonEmptyString(p.assignmentId)) refuse('swarm.assignment_updated requires assignmentId', 'invalid_payload');
    if (!isNonEmptyString(p.participantId)) refuse('swarm.assignment_updated requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workId)) refuse('swarm.assignment_updated requires workId', 'invalid_payload');
    if (!SWARM_ASSIGNMENT_STATUSES.includes(p.status)) {
      refuse(`assignment status must be one of: ${SWARM_ASSIGNMENT_STATUSES.join(', ')}`, 'invalid_payload');
    }
    validOptionalPositiveInt(p.expectedVersion, 'assignment expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.context_updated') {
    if (!isNonEmptyString(p.key)) refuse('swarm.context_updated requires a non-empty key', 'invalid_payload');
    if (p.body === undefined || p.body === null) refuse('swarm.context_updated requires body', 'invalid_payload');
    validOptionalNonEmptyString(p.groupId, 'context groupId', refuse);
    validOptionalPositiveInt(p.expectedVersion, 'context expectedVersion', refuse);
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
// folds to the same projection. Validates the event shape and referential integrity,
// then mutates the outer swarms Map with a frozen replacement row.
// Throws SwarmIntegrityError on any unfolderable event.
//
// event: { kind, payload, actor?, seq?, ts? }

export function foldSwarmEvent(swarms, event) {
  const { kind, payload: p } = event;

  if (!SWARM_EVENT_KINDS.has(kind)) {
    integrity(`unsupported swarm event kind: ${kind}`, 'unsupported_event_kind');
  }
  if (!p || typeof p !== 'object' || Array.isArray(p) || !isNonEmptyString(p.swarmId)) {
    integrity('swarm event payload must be a plain object with a non-empty swarmId', 'invalid_payload');
  }

  if (kind === 'swarm.created') {
    if (!isNonEmptyString(p.purpose)) integrity('swarm.created requires a non-empty purpose', 'invalid_payload');
    if (swarms.has(p.swarmId)) integrity(`swarm ${p.swarmId} is already created`, 'swarm_duplicate');
    swarms.set(p.swarmId, emptySwarm(p.swarmId, p.purpose));
    return;
  }

  const swarm = swarms.get(p.swarmId);
  if (!swarm) integrity(`swarm ${p.swarmId} not found`, 'swarm_not_found');

  if (kind === 'swarm.participant_joined') {
    if (!isNonEmptyString(p.participantId)) integrity('swarm.participant_joined requires participantId', 'invalid_payload');
    if (swarm.participants[p.participantId]) {
      integrity(`participant ${p.participantId} already exists in swarm ${p.swarmId}`, 'participant_duplicate');
    }
    if (isNonEmptyString(p.parentId) && !swarm.participants[p.parentId]) {
      integrity(`parentId ${p.parentId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    const participant = Object.freeze({
      participantId: p.participantId,
      role: p.role ?? null,
      parentId: p.parentId ?? null,
      runId: p.runId ?? null,
      permissions: p.permissions ? Object.freeze([...p.permissions]) : null,
      status: 'active',
      leftReason: null,
      bindings: Object.freeze([]),
    });
    const participants = new Map(Object.entries(swarm.participants));
    participants.set(p.participantId, participant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', participants));
    return;
  }

  if (kind === 'swarm.participant_bound') {
    if (!isNonEmptyString(p.participantId)) integrity('swarm.participant_bound requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workerId)) integrity('swarm.participant_bound requires workerId', 'invalid_payload');
    if (!isNonEmptyString(p.taskId)) integrity('swarm.participant_bound requires taskId', 'invalid_payload');
    const participant = swarm.participants[p.participantId];
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const binding = Object.freeze({
      workerId: p.workerId,
      taskId: p.taskId,
      sessionId: p.sessionId ?? null,
      seq: event.seq ?? null,
    });
    const updatedParticipant = Object.freeze({
      ...participant,
      bindings: Object.freeze([...participant.bindings, binding]),
    });
    const participants = new Map(Object.entries(swarm.participants));
    participants.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', participants));
    return;
  }

  if (kind === 'swarm.participant_left') {
    if (!isNonEmptyString(p.participantId)) integrity('swarm.participant_left requires participantId', 'invalid_payload');
    const participant = swarm.participants[p.participantId];
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant,
      status: 'left',
      leftReason: p.reason ?? null,
    });
    const participants = new Map(Object.entries(swarm.participants));
    participants.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', participants));
    return;
  }

  if (kind === 'swarm.group_updated') {
    if (!isNonEmptyString(p.groupId)) integrity('swarm.group_updated requires groupId', 'invalid_payload');
    if (!Array.isArray(p.members)) integrity('swarm.group_updated requires a members array', 'invalid_payload');
    // Members must be participants that have joined this swarm (any status).
    for (const memberId of p.members) {
      if (!swarm.participants[memberId]) {
        integrity(`group member ${memberId} not found in swarm ${p.swarmId}`, 'participant_not_found');
      }
    }
    const existingGroup = swarm.groups[p.groupId] ?? null;
    const currentVersion = existingGroup?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(
        `swarm group ${p.groupId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`,
        'version_conflict',
      );
    }
    const nextVersion = currentVersion + 1;
    const updatedGroup = Object.freeze({
      groupId: p.groupId,
      purpose: p.purpose !== undefined ? p.purpose : (existingGroup?.purpose ?? null),
      members: Object.freeze([...p.members]),
      version: nextVersion,
    });
    const groups = new Map(Object.entries(swarm.groups));
    groups.set(p.groupId, updatedGroup);
    swarms.set(p.swarmId, replaceField(swarm, 'groups', groups));
    return;
  }

  if (kind === 'swarm.work_updated') {
    if (!isNonEmptyString(p.workId)) integrity('swarm.work_updated requires workId', 'invalid_payload');
    if (!isNonEmptyString(p.objective)) integrity('swarm.work_updated requires a non-empty objective', 'invalid_payload');
    if (p.status !== undefined && !SWARM_WORK_STATUSES.includes(p.status)) {
      integrity(`work status must be one of: ${SWARM_WORK_STATUSES.join(', ')}`, 'invalid_payload');
    }
    const existingWork = swarm.work[p.workId] ?? null;
    const currentVersion = existingWork?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(
        `swarm work ${p.workId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`,
        'version_conflict',
      );
    }
    const updatedWork = Object.freeze({
      workId: p.workId,
      objective: p.objective,
      status: p.status !== undefined ? p.status : (existingWork?.status ?? null),
      version: currentVersion + 1,
    });
    const work = new Map(Object.entries(swarm.work));
    work.set(p.workId, updatedWork);
    swarms.set(p.swarmId, replaceField(swarm, 'work', work));
    return;
  }

  if (kind === 'swarm.assignment_updated') {
    if (!isNonEmptyString(p.assignmentId)) integrity('swarm.assignment_updated requires assignmentId', 'invalid_payload');
    if (!isNonEmptyString(p.participantId)) integrity('swarm.assignment_updated requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workId)) integrity('swarm.assignment_updated requires workId', 'invalid_payload');
    if (!SWARM_ASSIGNMENT_STATUSES.includes(p.status)) {
      integrity(`assignment status must be one of: ${SWARM_ASSIGNMENT_STATUSES.join(', ')}`, 'invalid_payload');
    }
    if (!swarm.participants[p.participantId]) {
      integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    if (!swarm.work[p.workId]) {
      integrity(`work ${p.workId} not found in swarm ${p.swarmId}`, 'work_not_found');
    }
    const existingAssignment = swarm.assignments[p.assignmentId] ?? null;
    const currentVersion = existingAssignment?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(
        `swarm assignment ${p.assignmentId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`,
        'version_conflict',
      );
    }
    const updatedAssignment = Object.freeze({
      assignmentId: p.assignmentId,
      participantId: p.participantId,
      workId: p.workId,
      status: p.status,
      version: currentVersion + 1,
    });
    const assignments = new Map(Object.entries(swarm.assignments));
    assignments.set(p.assignmentId, updatedAssignment);
    swarms.set(p.swarmId, replaceField(swarm, 'assignments', assignments));
    return;
  }

  if (kind === 'swarm.context_updated') {
    if (!isNonEmptyString(p.key)) integrity('swarm.context_updated requires a non-empty key', 'invalid_payload');
    if (p.body === undefined || p.body === null) integrity('swarm.context_updated requires body', 'invalid_payload');
    if (isNonEmptyString(p.groupId) && !swarm.groups[p.groupId]) {
      integrity(`context groupId ${p.groupId} not found in swarm ${p.swarmId}`, 'group_not_found');
    }
    const existingContext = swarm.context[p.key] ?? null;
    const currentVersion = existingContext?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(
        `swarm context key '${p.key}' version conflict: expected ${p.expectedVersion}, current ${currentVersion}`,
        'version_conflict',
      );
    }
    const updatedContext = Object.freeze({
      key: p.key,
      body: freezeBody(p.body),
      groupId: p.groupId ?? null,
      version: currentVersion + 1,
      actor: event.actor ?? null,
      seq: event.seq ?? null,
    });
    const context = new Map(Object.entries(swarm.context));
    context.set(p.key, updatedContext);
    swarms.set(p.swarmId, replaceField(swarm, 'context', context));
    return;
  }

  if (kind === 'swarm.contribution_recorded') {
    if (!isNonEmptyString(p.contributionId)) integrity('swarm.contribution_recorded requires contributionId', 'invalid_payload');
    if (!isNonEmptyString(p.participantId)) integrity('swarm.contribution_recorded requires participantId', 'invalid_payload');
    if (!swarm.participants[p.participantId]) {
      integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    if (isNonEmptyString(p.workId) && !swarm.work[p.workId]) {
      integrity(`work ${p.workId} not found in swarm ${p.swarmId}`, 'work_not_found');
    }
    if (swarm.contributions[p.contributionId]) {
      integrity(`contribution ${p.contributionId} already exists in swarm ${p.swarmId}`, 'contribution_duplicate');
    }
    const contribution = Object.freeze({
      contributionId: p.contributionId,
      participantId: p.participantId,
      workId: p.workId ?? null,
      body: p.body !== undefined ? freezeBody(p.body) : null,
      refs: p.refs ? Object.freeze([...p.refs]) : null,
    });
    const contributions = new Map(Object.entries(swarm.contributions));
    contributions.set(p.contributionId, contribution);
    swarms.set(p.swarmId, replaceField(swarm, 'contributions', contributions));
    return;
  }

  if (kind === 'swarm.contribution_reviewed') {
    if (!isNonEmptyString(p.contributionId)) integrity('swarm.contribution_reviewed requires contributionId', 'invalid_payload');
    if (!SWARM_REVIEW_DECISIONS.includes(p.decision)) {
      integrity(`review decision must be one of: ${SWARM_REVIEW_DECISIONS.join(', ')}`, 'invalid_payload');
    }
    if (!swarm.contributions[p.contributionId]) {
      integrity(`contribution ${p.contributionId} not found in swarm ${p.swarmId}`, 'contribution_not_found');
    }
    const review = Object.freeze({
      reviewerId: p.reviewerId ?? null,
      decision: p.decision,
      reason: p.reason ?? null,
      seq: event.seq ?? null,
    });
    // Append review — never erase prior reviews; opposing reviews are retained.
    const existingReviews = swarm.reviews[p.contributionId] ?? [];
    const updatedReviews = Object.freeze([...existingReviews, review]);
    const reviews = new Map(Object.entries(swarm.reviews));
    reviews.set(p.contributionId, updatedReviews);
    swarms.set(p.swarmId, replaceField(swarm, 'reviews', reviews));
    return;
  }

  if (kind === 'swarm.closed') {
    if (swarm.status === 'closed') {
      integrity(`swarm ${p.swarmId} is already closed`, 'swarm_already_closed');
    }
    swarms.set(p.swarmId, Object.freeze({
      ...swarm,
      status: 'closed',
      closedReason: p.reason ?? null,
    }));
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
// Deterministic serializable projection of all swarms. Keys sorted for
// byte-identical replay; live and post-replay snapshots deep-equal.

export function swarmSnapshot(swarms) {
  const swarmList = [...swarms.keys()].sort().map((swarmId) => {
    const s = swarms.get(swarmId);

    const participants = Object.fromEntries(
      Object.keys(s.participants).sort().map((pid) => {
        const p = s.participants[pid];
        return [pid, {
          participantId: p.participantId,
          role: p.role,
          parentId: p.parentId,
          runId: p.runId,
          permissions: p.permissions ? [...p.permissions] : null,
          status: p.status,
          leftReason: p.leftReason,
          bindings: p.bindings.map((b) => ({ ...b })),
        }];
      }),
    );

    const groups = Object.fromEntries(
      Object.keys(s.groups).sort().map((gid) => {
        const g = s.groups[gid];
        return [gid, { groupId: g.groupId, purpose: g.purpose, members: [...g.members], version: g.version }];
      }),
    );

    const work = Object.fromEntries(
      Object.keys(s.work).sort().map((wid) => {
        const w = s.work[wid];
        return [wid, { workId: w.workId, objective: w.objective, status: w.status, version: w.version }];
      }),
    );

    const assignments = Object.fromEntries(
      Object.keys(s.assignments).sort().map((aid) => {
        const a = s.assignments[aid];
        return [aid, {
          assignmentId: a.assignmentId,
          participantId: a.participantId,
          workId: a.workId,
          status: a.status,
          version: a.version,
        }];
      }),
    );

    const context = Object.fromEntries(
      Object.keys(s.context).sort().map((key) => {
        const c = s.context[key];
        return [key, {
          key: c.key,
          body: typeof c.body === 'object' && c.body !== null ? JSON.parse(JSON.stringify(c.body)) : c.body,
          groupId: c.groupId,
          version: c.version,
          actor: c.actor,
          seq: c.seq,
        }];
      }),
    );

    const contributions = Object.fromEntries(
      Object.keys(s.contributions).sort().map((cid) => {
        const c = s.contributions[cid];
        return [cid, {
          contributionId: c.contributionId,
          participantId: c.participantId,
          workId: c.workId,
          body: typeof c.body === 'object' && c.body !== null ? JSON.parse(JSON.stringify(c.body)) : c.body,
          refs: c.refs ? [...c.refs] : null,
        }];
      }),
    );

    const reviews = Object.fromEntries(
      Object.keys(s.reviews).sort().map((cid) => {
        return [cid, s.reviews[cid].map((r) => ({ ...r }))];
      }),
    );

    return {
      swarmId: s.swarmId,
      purpose: s.purpose,
      status: s.status,
      closedReason: s.closedReason,
      participants,
      groups,
      work,
      assignments,
      context,
      contributions,
      reviews,
    };
  });

  return { swarms: swarmList };
}
