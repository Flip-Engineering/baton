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
  'swarm.coupling_updated',
  'swarm.context_updated',
  'swarm.contribution_recorded',
  'swarm.contribution_revision_attached',
  'swarm.contribution_reviewed',
  'swarm.closed',
]));

// The declared coupling records (docs/39 §Loose and tight orchestration; issue #263 item 2).
// Coupling is something participants and organizers DECLARE and the swarm keeps honest — never
// something the runtime imposes. A dependency between units of work is declared on the work
// itself (`swarm.work_updated` `dependsOn`); the group-scoped choices — a synchronization point
// a group arrives at and is released from, an exclusive writer over a shared checkout, and a
// group failure policy — are declared through `swarm.coupling_updated` records below.
export const SWARM_COUPLINGS = Object.freeze(['synchronization', 'writer', 'failure']);
export const SWARM_COUPLING_ACTIONS = Object.freeze(['declare', 'arrive', 'release']);
export const SWARM_FAILURE_POLICIES = Object.freeze(['independent']);

export const SWARM_WORK_STATUSES = Object.freeze(['open', 'completed', 'cancelled']);
export const SWARM_ASSIGNMENT_STATUSES = Object.freeze(['active', 'released']);
export const SWARM_REVIEW_DECISIONS = Object.freeze(['accept', 'reject', 'comment']);

// One physical workspace identity (`ws-…`): the checkout a participant works in, as recorded at
// recruitment and at binding. The writer coupling's exclusivity is exactly this identity, so the
// shape is named once here rather than re-spelled at each site that carries it.
const WORKSPACE_ID = /^ws-[a-f0-9]{32}$/u;

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

function emptySwarm(swarmId, purpose, meta) {
  return Object.freeze({
    swarmId, purpose, status: 'open', closedReason: null, ...meta,
    participants: nullDict(), groups: nullDict(), work: nullDict(),
    assignments: nullDict(), couplings: nullDict(), context: nullDict(), contributions: nullDict(), reviews: nullDict(),
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
    // The physical checkout this participant deliberately shares with others, when it was
    // recruited into one. A durable organizational record, never custody: whether the checkout
    // may close is decided by the controller's live handles, not by swarm membership.
    if (p.workspaceId !== undefined && !WORKSPACE_ID.test(p.workspaceId)) {
      refuse('participant workspaceId must be one physical workspace identity', 'invalid_payload');
    }
    validOptionalNonEmptyString(p.runId, 'participant runId', refuse);
    // The route and the scope the participant was RECRUITED under (issue #283): durable facts of
    // the join, recorded once with the seat, never re-derived from a live worker that may have
    // moved on. A route names the harness, model and effort the Run was admitted with; the scope
    // is the path set that Run was admitted over.
    if (p.route !== undefined && p.route !== null) {
      if (typeof p.route !== 'object' || Array.isArray(p.route)
        || !isNonEmptyString(p.route.harness) || !isNonEmptyString(p.route.model)
        || !(p.route.effort === null || p.route.effort === undefined || isNonEmptyString(p.route.effort))
        || Object.keys(p.route).some((field) => !['harness', 'model', 'effort'].includes(field))) {
        refuse('participant route must name harness, model and effort', 'invalid_payload');
      }
    }
    if (p.scope !== undefined && p.scope !== null) {
      if (!Array.isArray(p.scope) || !p.scope.every(isNonEmptyString)) {
        refuse('participant scope must be an array of paths', 'invalid_payload');
      }
    }
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
    // The checkout this binding observed for the participant's worker. The first recruit into a
    // checkout is armed here: without it the exclusive-writer guarantee had nothing to compare.
    if (p.workspaceId !== undefined && !WORKSPACE_ID.test(p.workspaceId)) {
      refuse('participant binding workspaceId must be one physical workspace identity', 'invalid_payload');
    }
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
    // Completion evidence cited by the runtime's completion rule (issue #263). Shape-only here:
    // the fold ignores `basis` (the accepted-contribution records stay the durable evidence), so
    // logs written before the field existed replay identically.
    if (p.basis !== undefined) {
      if (!p.basis || typeof p.basis !== 'object' || Array.isArray(p.basis)) {
        refuse('work basis must be an object when present', 'invalid_payload');
      }
      if (!Array.isArray(p.basis.contributionIds) || !p.basis.contributionIds.every(isNonEmptyString)) {
        refuse('work basis must cite contributionIds as non-empty strings', 'invalid_payload');
      }
    }
    // Declared dependencies (issue #263 item 2): entries name exactly one target — a work item
    // whose accepted contribution settles the wait, or a named artifact an accepted contribution
    // must reference. Declaring a dependency is a record, never a gate: nothing here stops work.
    if (p.dependsOn !== undefined) {
      if (!Array.isArray(p.dependsOn)) {
        refuse('work dependsOn must be an array of dependency entries', 'invalid_payload');
      }
      for (const entry of p.dependsOn) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          refuse('each dependsOn entry must be an object naming workId or artifact', 'invalid_payload');
        }
        if (isNonEmptyString(entry.workId) === isNonEmptyString(entry.artifact)) {
          refuse('each dependsOn entry names exactly one target: workId or artifact', 'invalid_payload');
        }
        // Issue #304: payload-only rules belong to the shape lane, where both admission and
        // replay run the SAME predicate — a work item that depends on itself refuses here,
        // before any state read, instead of as a fold-only integrity code.
        if (entry.workId === p.workId) {
          refuse(`work ${p.workId} cannot depend on itself`, 'work_dependency_self');
        }
      }
    }
    return;
  }
  if (kind === 'swarm.coupling_updated') {
    if (!isNonEmptyString(p.couplingId)) refuse('swarm.coupling_updated requires couplingId', 'invalid_payload');
    if (!SWARM_COUPLINGS.includes(p.coupling)) {
      refuse(`coupling must be one of: ${SWARM_COUPLINGS.join(', ')}`, 'invalid_payload');
    }
    if (!SWARM_COUPLING_ACTIONS.includes(p.action)) {
      refuse(`coupling action must be one of: ${SWARM_COUPLING_ACTIONS.join(', ')}`, 'invalid_payload');
    }
    validOptionalNonEmptyString(p.groupId, 'coupling groupId', refuse);
    validOptionalNonEmptyString(p.name, 'coupling name', refuse);
    validOptionalNonEmptyString(p.participantId, 'coupling participantId', refuse);
    validOptionalNonEmptyString(p.reason, 'coupling reason', refuse);
    // Who RELEASED the record, when the runtime derived it from the acting identity. The record's
    // `participantId` names the seat the request is about (the arriver, the writer's holder, the
    // seat a release hands back); the actor is never inferred from it.
    validOptionalNonEmptyString(p.releasedBy, 'coupling releasedBy', refuse);
    validOptionalNonNegativeInt(p.expectedVersion, 'coupling expectedVersion', refuse);
    if (p.policy !== undefined && !SWARM_FAILURE_POLICIES.includes(p.policy)) {
      refuse(`failure policy must be one of: ${SWARM_FAILURE_POLICIES.join(', ')}`, 'invalid_payload');
    }
    if (p.action === 'declare') {
      if (p.coupling === 'synchronization' && !(isNonEmptyString(p.groupId) && isNonEmptyString(p.name))) {
        refuse('a synchronization point declares groupId and name', 'invalid_payload');
      }
      if (p.coupling === 'failure' && !(isNonEmptyString(p.groupId) && p.policy !== undefined)) {
        refuse('a failure policy declares groupId and policy', 'invalid_payload');
      }
    }
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
    if (p.body === undefined) refuse('swarm.context_updated requires body', 'invalid_payload');
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
  if (kind === 'swarm.contribution_revision_attached') {
    if (!isNonEmptyString(p.contributionId) || !isNonEmptyString(p.participantId)
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(p.sha ?? '')
      || !isNonEmptyString(p.ref)) {
      refuse('A contribution revision requires its author, contribution identity, SHA and retained ref', 'invalid_payload');
    }
    // Honest shared-checkout metadata: which physical checkout the revision was observed in, and
    // the HEAD that checkout showed before the capture. Both are checkout observations, never an
    // authorship claim; `sha`/`ref` alone stay the retained revision.
    if (p.workspaceId !== undefined && !WORKSPACE_ID.test(p.workspaceId)) {
      refuse('A contribution revision workspace must be one physical workspace identity', 'invalid_payload');
    }
    if (p.observedHead !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(p.observedHead)) {
      refuse('A contribution revision observedHead must be an exact commit', 'invalid_payload');
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
// folds to the same projection. Calls validateSwarmEvent first (converting SwarmRefusal
// to SwarmIntegrityError), then applies stateful checks (referential integrity,
// version CAS) and mutates the outer swarms Map with a frozen replacement row.
//
// event: { kind, payload, actor?, seq?, ts? }

// An attribution identity (who reviewed, who released) is honest when it names a participant of
// this swarm, or when it IS the acting principal of the very event that records it — an external
// orchestrator has no participant row, and a record attributed to nobody is not an answer. The
// caller-named seat is never a substitute: the actor is the fact.
function assertAttribution(swarm, identity, meta, field) {
  if (identity === null || identity === undefined) return;
  if (ownGet(swarm.participants, identity)) return;
  if (isNonEmptyString(meta.actor) && identity === meta.actor) return;
  integrity(`${field} ${identity} names neither a participant of swarm ${swarm.swarmId} nor the actor of the event that records it`
    + `${isNonEmptyString(meta.actor) ? ` (the actor is ${meta.actor})` : ' (the event carries no actor)'}`,
  'participant_not_found');
}

// `admission` marks a prospective row being judged BEFORE it is written; rows read back from the
// ledger fold without it. Rules that tighten what may be admitted (audit #292's writer-workspace
// guard) apply only there: a resident must never refuse its own recorded history at startup.
export function foldSwarmEvent(swarms, event, { admission = false } = {}) {
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
    swarms.set(p.swarmId, emptySwarm(p.swarmId, p.purpose, meta));
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
      workspaceId: p.workspaceId ?? null,
      // The route and scope this seat was RECRUITED under, carried by the join itself: the view
      // projects them, so an orchestrator reading a member knows what it was started as without
      // consulting a live worker that may since have been rebound or stopped.
      route: p.route === undefined || p.route === null ? null
        : Object.freeze({ harness: p.route.harness, model: p.route.model, effort: p.route.effort ?? null }),
      scope: p.scope === undefined || p.scope === null ? null : Object.freeze([...p.scope]),
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
      ...participant,
      // The checkout the binding observed, recorded when the participant carries none yet: the
      // first recruit into a checkout is armed here — recruitment without `shareWorkspaceWith`
      // recorded nothing, which left the exclusive-writer guard with no identity to compare.
      workspaceId: participant.workspaceId ?? p.workspaceId ?? null,
      bindings: Object.freeze([...participant.bindings, binding]),
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
    // Members must be currently active participants (not left). The refusal names the group
    // and the seat (#290): a release batch trial-folds through here, and "participant_not_active"
    // without a group/seat left the operator no repairable coordinate.
    for (const memberId of p.members) {
      const member = ownGet(swarm.participants, memberId);
      if (!member) integrity(`group member ${memberId} not found in swarm ${p.swarmId} (group ${p.groupId}, seat ${memberId})`, 'participant_not_found');
      if (member.status !== 'active') integrity(`group member ${memberId} is not active in swarm ${p.swarmId} (group ${p.groupId}, seat ${memberId})`, 'participant_not_active');
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
    // Declared dependencies are stored on the work row when declared and preserved by later
    // updates that omit them (the same keep-the-record rule as the objective). Rows written
    // before the field existed carry no key, so old logs replay byte-identically.
    const dependsOn = p.dependsOn !== undefined ? p.dependsOn : existingWork?.dependsOn;
    if (dependsOn !== undefined && dependsOn.length > 0) {
      for (const entry of dependsOn) {
        if (entry.workId === undefined) continue;
        // The self-dependency rule is a shape refusal (issue #304): validateSwarmEvent raises
        // work_dependency_self above, so this loop only owes the stateful half — the target
        // must exist in this swarm's projection.
        if (!ownGet(swarm.work, entry.workId)) {
          integrity(`dependency target work ${entry.workId} not found in swarm ${p.swarmId}`, 'work_not_found');
        }
      }
      // A new cycle can only pass through this work: walk its dependency targets and refuse a
      // declaration that would make a ring of works wait on itself forever.
      const targetsOf = (workId) => (workId === p.workId
        ? dependsOn.filter((entry) => entry.workId !== undefined).map((entry) => entry.workId)
        : (ownGet(swarm.work, workId)?.dependsOn ?? []).filter((entry) => entry.workId !== undefined).map((entry) => entry.workId));
      const cameFrom = new Map();
      const queue = targetsOf(p.workId).map((target) => [target, p.workId]);
      let cycleAt = null;
      while (queue.length && cycleAt === null) {
        const [current, parent] = queue.shift();
        if (current === p.workId) { cycleAt = parent; break; }
        if (cameFrom.has(current)) continue;
        cameFrom.set(current, parent);
        for (const target of targetsOf(current)) queue.push([target, current]);
      }
      if (cycleAt !== null) {
        const ring = [p.workId];
        for (let at = cycleAt; at !== p.workId; at = cameFrom.get(at)) ring.splice(1, 0, at);
        integrity(`these dependencies make work ${p.workId} wait on itself through the ring ${[...ring, p.workId].join(' -> ')}`, 'work_dependency_cycle');
      }
    }
    const updatedWork = Object.freeze({
      workId: p.workId, objective: p.objective,
      // Default status is 'open' for new items; preserve existing status if not specified.
      status: p.status !== undefined ? p.status : (existingWork?.status ?? 'open'),
      version: currentVersion + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
      ...(dependsOn !== undefined ? { dependsOn: deepFreezeBody(dependsOn) } : {}),
    });
    const work = new Map(Object.entries(swarm.work));
    work.set(p.workId, updatedWork);
    swarms.set(p.swarmId, replaceField(swarm, 'work', work));
    return;
  }

  if (kind === 'swarm.coupling_updated') {
    const existingCoupling = ownGet(swarm.couplings, p.couplingId) ?? null;
    const currentVersion = existingCoupling?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm coupling ${p.couplingId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    if (existingCoupling && p.coupling !== existingCoupling.coupling) {
      integrity(`coupling ${p.couplingId} is a ${existingCoupling.coupling} record, not a ${p.coupling}`, 'invalid_payload');
    }
    let record;
    if (p.action === 'declare') {
      if (p.coupling === 'synchronization' || p.coupling === 'failure') {
        if (!ownGet(swarm.groups, p.groupId)) {
          integrity(`coupling group ${p.groupId} not found in swarm ${p.swarmId}`, 'group_not_found');
        }
      }
      if (p.coupling === 'failure') {
        const conflict = Object.values(swarm.couplings).find((row) => row.coupling === 'failure' && !row.released
          && row.groupId === p.groupId && row.couplingId !== p.couplingId);
        if (conflict) {
          integrity(`group ${p.groupId} already carries the unreleased failure policy ${conflict.couplingId}`, 'swarm_coupling_conflict');
        }
      }
      let writer = null;
      let workspaceId = null;
      let members = null;
      // A declare REPLACES the record's parameters. It never discards what the members already
      // reported: the arrivals the point holds are carried forward, and `carriedArrivals` names
      // them on the new record, so a re-declare can never wipe a barrier silently (audit #292).
      const arrivals = existingCoupling?.coupling === 'synchronization'
        ? Object.freeze([...(existingCoupling.arrivals ?? [])]) : Object.freeze([]);
      const carriedArrivals = p.coupling === 'synchronization' && existingCoupling !== null
        ? Object.freeze(arrivals.map((arrival) => arrival.participantId)) : null;
      if (p.coupling === 'synchronization') {
        // The group roster the point was declared over: seats that later leave the group (by
        // release or regroup) stay named on the record instead of vanishing from it.
        members = [...(ownGet(swarm.groups, p.groupId)?.members ?? [])];
      }
      if (p.coupling === 'writer') {
        if (!isNonEmptyString(p.participantId)) {
          integrity('an exclusive writer claim must name participantId — the writer whose turn over the checkout it is', 'invalid_payload');
        }
        const holder = ownGet(swarm.participants, p.participantId);
        if (!holder) integrity(`writer participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
        if (holder.status !== 'active') integrity(`writer participant ${p.participantId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
        // Exclusivity is a fact about ONE recorded checkout. A claim over a participant with no
        // recorded checkout would name no resource at all, and the one-writer guarantee would be
        // inert exactly where it is promised (docs/39 §Declared coupling) — so at admission it
        // refuses and names the remedy. A row already in the ledger was admitted under the rules
        // of its day and replays as recorded (workspaceId null), never as a startup refusal.
        if (admission && !WORKSPACE_ID.test(holder.workspaceId ?? '')) {
          integrity(`participant ${p.participantId} has no recorded checkout, so an exclusive writer claim over it could not be enforced; record the checkout its participant works in (a participant is recorded in its checkout when it is recruited into one) before claiming it`, 'swarm_writer_workspace_unrecorded');
        }
        workspaceId = holder.workspaceId;
        const conflict = Object.values(swarm.couplings).find((row) => row.coupling === 'writer' && !row.released
          && row.workspaceId === workspaceId && row.writer !== p.participantId);
        if (conflict) {
          integrity(`checkout ${workspaceId} already names the exclusive writer ${conflict.writer} (${conflict.couplingId}); release that record first`, 'swarm_writer_conflict');
        }
        writer = p.participantId;
      }
      record = {
        couplingId: p.couplingId, coupling: p.coupling,
        groupId: p.groupId ?? null, name: p.name ?? null, policy: p.policy ?? null,
        members, writer, workspaceId, arrivals, carriedArrivals,
        released: false, releasedBy: null, releaseReason: null,
      };
    } else {
      if (!existingCoupling) {
        integrity(`coupling ${p.couplingId} not found in swarm ${p.swarmId}`, 'coupling_not_found');
      }
      if (existingCoupling.released) {
        integrity(`coupling ${p.couplingId} is already released`, 'swarm_coupling_released');
      }
      if (p.action === 'arrive') {
        if (!isNonEmptyString(p.participantId)) {
          integrity('an arrival must name participantId — the participant who arrived', 'invalid_payload');
        }
        const arriver = ownGet(swarm.participants, p.participantId);
        if (!arriver) integrity(`arriving participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
        if (arriver.status !== 'active') integrity(`arriving participant ${p.participantId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
        const members = ownGet(swarm.groups, existingCoupling.groupId)?.members ?? [];
        if (!members.includes(p.participantId)) {
          integrity(`participant ${p.participantId} is not a member of group ${existingCoupling.groupId}`, 'swarm_not_a_member');
        }
        if (existingCoupling.arrivals.some((arrival) => arrival.participantId === p.participantId)) {
          integrity(`participant ${p.participantId} has already arrived at ${p.couplingId}`, 'swarm_already_arrived');
        }
        // An arrival is a seat's own report: it carries WHEN it was made and which identity made
        // it, so "all reports in" is answerable from the artifact rather than from a watch log.
        record = { ...existingCoupling, arrivals: Object.freeze([...existingCoupling.arrivals,
          Object.freeze({ participantId: p.participantId, actor: meta.actor, seq: meta.seq, ts: meta.ts })]) };
      } else {
        const releasedBy = p.releasedBy ?? p.participantId ?? null;
        assertAttribution(swarm, releasedBy, meta, 'releasedBy');
        record = { ...existingCoupling, released: true, releasedBy, releaseReason: p.reason ?? null };
      }
    }
    const couplings = new Map(Object.entries(swarm.couplings));
    couplings.set(p.couplingId, Object.freeze({
      ...record, version: currentVersion + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    }));
    swarms.set(p.swarmId, replaceField(swarm, 'couplings', couplings));
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

  if (kind === 'swarm.contribution_revision_attached') {
    const contribution = ownGet(swarm.contributions, p.contributionId);
    if (!contribution) integrity('Contribution is unavailable', 'contribution_not_found');
    if (contribution.participantId !== p.participantId) integrity('Revision author differs from contribution author', 'contribution_author_mismatch');
    if (contribution.revision && (contribution.revision.sha !== p.sha || contribution.revision.ref !== p.ref)) {
      integrity('Contribution already identifies another revision', 'contribution_revision_conflict');
    }
    const contributions = new Map(Object.entries(swarm.contributions));
    contributions.set(p.contributionId, Object.freeze({
      ...contribution,
      refs: Object.freeze([...new Set([...(contribution.refs ?? []), p.ref])]),
      // The revision also names the checkout it was observed in and the HEAD that checkout showed
      // before the capture — shared-checkout facts that are never an authorship claim over `sha`.
      revision: Object.freeze({
        sha: p.sha, ref: p.ref,
        workspaceId: p.workspaceId ?? null, observedHead: p.observedHead ?? null,
        ...meta,
      }),
    }));
    swarms.set(p.swarmId, replaceField(swarm, 'contributions', contributions));
    return;
  }

  if (kind === 'swarm.contribution_reviewed') {
    if (!ownGet(swarm.contributions, p.contributionId)) {
      integrity(`contribution ${p.contributionId} not found in swarm ${p.swarmId}`, 'contribution_not_found');
    }
    // Who reviewed is the ACTOR: a participant of this swarm, or the acting principal of this very
    // event when an external orchestrator names no seat. A name that is neither is a misattribution.
    assertAttribution(swarm, p.reviewerId, meta, 'reviewerId');
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
