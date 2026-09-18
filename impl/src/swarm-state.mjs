// Durable domain state for living Baton swarms.
//
// Extracted deterministic event fold compatible with CoordinationStore transaction
// snapshots/replay. Mirrors the orchestrator-plan.mjs coordination lane pattern:
// a mutable Map of swarm rows is the projection surface; fold functions produce
// frozen immutable replacement rows; no external effects in replay.
//
// Root hooks validateSwarmEvent and foldSwarmEvent to the same durable coordination
// log, not a parallel journal. Consumers own the log; this module owns the fold.

// Issue #430: every code `refuse`/`integrity` raise draws from the family's ONE closed refusal
// set; minting a code outside it is a construction-time error.
import { assertSwarmRefusalCode } from './swarm-refusals.mjs';

export const SWARM_EVENT_KINDS = Object.freeze(new Set([
  'swarm.created',
  'swarm.participant_joined',
  'swarm.participant_bound',
  'swarm.participant_left',
  'swarm.group_updated',
  'swarm.work_updated',
  'swarm.assignment_updated',
  'swarm.coupling_updated',
  // Issues #422/#423 (docs/45-open-coordination.md): the joint-coupling, claim and proposal
  // families — `swarm.claim_updated` is a hold a seat takes for itself on work or a path set,
  // `swarm.proposal_updated` is a work split the seats it names accept by arriving.
  'swarm.claim_updated',
  'swarm.proposal_updated',
  // Issue #425: the runtime-recorded bypass of a live exclusive writer coupling — observed
  // at the seat's projected git wrapper, composed by the runtime, never caller-submittable.
  'swarm.coupling_writer_bypassed',
  // Issue #364: the runtime-recorded restart reconciliation — a seat whose worker is absent
  // from the fleet THIS incarnation recovered. Composed by the swarm runtime from the
  // coordinator's own fleet capture, never caller-submittable.
  'swarm.participant_runtime_lost',
  // Issue #442: the runtime-recorded provider fault — a seat whose worker ended under a
  // provider-fault kill. Composed by the swarm runtime from the coordinator's own death seam,
  // never caller-submittable.
  'swarm.participant_faulted',
  'swarm.context_updated',
  'swarm.contribution_recorded',
  'swarm.contribution_revision_attached',
  'swarm.contribution_reviewed',
  // Issue #296: the landing receipt — the runtime's own record of one contribution squashed onto a
  // target. Composed by `swarm.integrate` from the git it actually ran (the base it resolved, the
  // commit it made, the gates it ran, the conflicts it resolved), never caller-submittable: a
  // fabricated landing receipt would be a lie in the durable record.
  'swarm.contribution_integrated',
  'swarm.closed',
]));

// The declared coupling records (docs/39 §Loose and tight orchestration; issue #263 item 2).
// Coupling is something participants and organizers DECLARE and the swarm keeps honest — never
// something the runtime imposes. A dependency between units of work is declared on the work
// itself (`swarm.work_updated` `dependsOn`); the group-scoped choices — a synchronization point
// a group arrives at and is released from, an exclusive writer over a shared checkout, and a
// group failure policy — are declared through `swarm.coupling_updated` records below.
export const SWARM_COUPLINGS = Object.freeze(['synchronization', 'writer', 'failure']);
// The joint coupling set (docs/45 §4): declare and arrive and release as before; `propose` is a
// coupling any member may put to its named consent set, and `take`/`yield` are the rotating
// writer lease's own acts — meaningless on records written before the design and never present
// in one (docs/45 §11).
export const SWARM_COUPLING_ACTIONS = Object.freeze(['declare', 'propose', 'arrive', 'take', 'yield', 'release']);
/** The work-proposal actions (docs/45 §3): the shared verb spellings with the coupling actions are
 * deliberate — one name per concept — so `propose | arrive | release` mean the same thing here. */
export const SWARM_PROPOSAL_ACTIONS = Object.freeze(['propose', 'arrive', 'release']);
export const SWARM_FAILURE_POLICIES = Object.freeze(['independent']);

export const SWARM_WORK_STATUSES = Object.freeze(['open', 'completed', 'cancelled']);
export const SWARM_ASSIGNMENT_STATUSES = Object.freeze(['active', 'released']);
export const SWARM_REVIEW_DECISIONS = Object.freeze(['accept', 'reject', 'comment']);

// The remedy note a departed-seat group refusal carries (#395). A named constant, not an inline
// literal: the fold-admission audit classifies an integrity(...) call by its LAST literal
// argument, so the refusal's detail keeps to references and the code literal stays last.
const DEPARTED_SEAT_REMEDY_NOTE = 'resend exactly these members — the current active set of this group';

// The coordinates a claim refusal carries (docs/45 §2, §2.2). Named constants, not inline
// literals: the fold-admission audit classifies an integrity(...) call by its LAST literal
// argument, so a refusal's detail keeps to references and the code literal stays last.
const CLAIM_MOVE_COORDINATES = Object.freeze({ field: 'participantId', rule: 'claim-holder-or-organize' });
const CLAIM_PATHS_COORDINATES = Object.freeze({ field: 'paths', rule: 'claimed-paths' });

// One physical workspace identity (`ws-…`): the checkout a participant works in, as recorded at
// recruitment and at binding. The writer coupling's exclusivity is exactly this identity, so the
// shape is named once here rather than re-spelled at each site that carries it.
const WORKSPACE_ID = /^ws-[a-f0-9]{32}$/u;

// Issue #296: one exact commit id — sha1 or sha256, never abbreviated. The landing receipt's whole
// value is that the root can re-run `git show <sha>` against it, so an abbreviated or invented id
// must refuse at admission rather than land as a receipt nobody can verify.
const SWARM_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export class SwarmRefusal extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'SwarmRefusal';
    this.code = code;
    this.detail = detail === null ? null : Object.freeze({ ...detail });
  }
}

export class SwarmIntegrityError extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'SwarmIntegrityError';
    this.code = code;
    // Repairable coordinates when the fold can name them (#395): the group, the seat, the
    // settled status and the exact roster to resend. Null when the error needs no coordinate.
    this.detail = detail === null ? null : Object.freeze({ ...detail });
  }
}

function refuse(message, code, detail = null) {
  assertSwarmRefusalCode(code, 'swarm-state.refuse');
  throw new SwarmRefusal(message, code, detail);
}

function integrity(message, code, detail = null) {
  assertSwarmRefusalCode(code, 'swarm-state.integrity');
  throw new SwarmIntegrityError(message, code, detail);
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

// A path claim's entries are repo-relative and `/`-separated, and name no `..` or leading `./`
// (docs/45 §2). The rule is a shape rule: it describes a claim, never a record, so it runs on
// admission and on replay alike without ever refusing recorded history.
function validClaimPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    refuse('a path claim names a non-empty paths array', 'invalid_payload');
  }
  for (const entry of paths) {
    if (!isNonEmptyString(entry)) refuse('claim paths must be non-empty strings', 'invalid_payload');
    if (entry.startsWith('/') || entry.startsWith('./') || entry.split('/').includes('..')) {
      refuse(`claim path '${entry}' must be repo-relative and name no .. or leading ./`, 'invalid_payload');
    }
  }
}

// The plan a work proposal carries (docs/45 §3): the work items the split creates and the claims
// that hold them. Shape only: existence, activity and conflicts are the fold's stateful half.
function validProposalPlan(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    refuse('a proposal carries a plan object: { work: [...], claims: [...] }', 'invalid_payload');
  }
  const unknown = Object.keys(plan).find((field) => field !== 'work' && field !== 'claims');
  if (unknown !== undefined) {
    refuse(`a proposal plan carries work and claims only; ${unknown} is not a plan field`, 'invalid_payload');
  }
  const workIds = new Set();
  for (const entry of plan.work ?? []) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || !isNonEmptyString(entry.workId) || !isNonEmptyString(entry.objective)) {
      refuse('each plan.work entry names a workId and an objective', 'invalid_payload');
    }
    if (workIds.has(entry.workId)) {
      refuse(`plan.work names ${entry.workId} twice — a plan creates each work item once`, 'invalid_payload');
    }
    workIds.add(entry.workId);
  }
  for (const entry of plan.claims ?? []) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !isNonEmptyString(entry.participantId)) {
      refuse('each plan.claims entry names the participant that holds the claim', 'invalid_payload');
    }
    if (isNonEmptyString(entry.workId) === (entry.paths !== undefined)) {
      refuse('each plan.claims entry names exactly one target: workId or paths', 'invalid_payload');
    }
    if (entry.paths !== undefined) validClaimPaths(entry.paths);
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
    // Issues #422/#423: the holds seats take for themselves (`claims`, an assignment-shaped hold
    // with self-authority, docs/45 §2) and the work splits proposed and accepted by arrival
    // (`proposals`, docs/45 §3). Both are keyed collections beside `assignments`, so every
    // collection rule — create-or-replace, CAS, deterministic replay — reads the same way.
    claims: nullDict(), proposals: nullDict(),
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
    // The commit the swarm started from (#318): the reference the situation projection derives
    // "commits landed since the base" FROM — a stored REFERENCE, never a stored count. Absent
    // when the deployment has no git authority to ask.
    validOptionalNonEmptyString(p.baseCommit, 'swarm baseCommit', refuse);
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
    if (p.resumeFrom !== undefined && p.resumeFrom !== null) {
      validOptionalNonEmptyString(p.resumeFrom, 'participant resumeFrom', refuse);
    }
    // The composed brief the seat was recruited with (#318): the objective plus the swarm
    // situation and inheritance the runtime derived — the durable record of what this ONE seat
    // was told, so a successor's inheritance and the RESUME NOTE are derivable, never retyped.
    validOptionalNonEmptyString(p.brief, 'participant brief', refuse);
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
    // The typed code the runtime rolled a recruitment back with (issue #308): the join's own
    // admission refusal, carried on the leave so the durable log explains WHY the seat vanished.
    validOptionalNonEmptyString(p.code, 'left code', refuse);
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
    // The joint-coupling fields (docs/45 §4): `members` is the consent set a proposal puts its
    // parameters to, `quorum` is the synchronization point's release threshold, and a writer
    // record declares either an exclusive writer (`participantId`) or a rotating lease
    // (`groupId`) — the XOR is checked in the declare arm below.
    if (p.members !== undefined) {
      if (!Array.isArray(p.members) || p.members.length === 0 || !p.members.every(isNonEmptyString)) {
        refuse('coupling members must be a non-empty array of participant identities', 'invalid_payload');
      }
      if (new Set(p.members).size !== p.members.length) {
        refuse('coupling members must be distinct', 'invalid_payload');
      }
      if (p.action !== 'propose') {
        refuse('a coupling names its members when it is proposed; a declare takes its roster from the group', 'invalid_payload');
      }
    }
    if (p.quorum !== undefined) {
      if (!Number.isSafeInteger(p.quorum) || p.quorum < 1) {
        refuse('coupling quorum must be a positive integer when present', 'invalid_payload');
      }
      if (p.coupling !== 'synchronization') {
        refuse('only a synchronization point declares a quorum', 'invalid_payload');
      }
    }
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
      if (p.coupling === 'writer' && isNonEmptyString(p.participantId) === isNonEmptyString(p.groupId)) {
        refuse('a writer coupling declares over exactly one of participantId (an exclusive writer) or groupId (a rotating lease)', 'invalid_payload');
      }
    }
    if (p.action === 'propose') {
      // A failure policy names what happens when OTHER members die — not a consent set's to give
      // (docs/45 §4.5) — so it is declared, never proposed.
      if (p.coupling === 'failure') refuse('a failure policy is declared, never proposed', 'invalid_payload');
      if (p.members === undefined) refuse('a coupling proposal names the members whose arrival is their consent', 'invalid_payload');
    }
    if (p.action === 'take' || p.action === 'yield') {
      if (!isNonEmptyString(p.participantId)) {
        refuse(`a lease ${p.action} names participantId — the seat taking or yielding the write turn`, 'invalid_payload');
      }
      if (isNonEmptyString(p.groupId) || p.members !== undefined || p.quorum !== undefined) {
        refuse(`a lease ${p.action} carries no coupling parameters`, 'invalid_payload');
      }
    }
    return;
  }
  if (kind === 'swarm.coupling_writer_bypassed') {
    if (!isNonEmptyString(p.couplingId)) refuse('swarm.coupling_writer_bypassed requires couplingId', 'invalid_payload');
    // The checkout the bypass happened in: the coupling record's own identity, so the row can
    // never describe a different resource than the writer record it lands on.
    if (typeof p.workspaceId !== 'string' || !WORKSPACE_ID.test(p.workspaceId)) {
      refuse('swarm.coupling_writer_bypassed requires one physical workspace identity', 'invalid_payload');
    }
    if (!isNonEmptyString(p.writer)) refuse('swarm.coupling_writer_bypassed requires writer', 'invalid_payload');
    if (!isNonEmptyString(p.by)) refuse('swarm.coupling_writer_bypassed requires by — the seat that committed', 'invalid_payload');
    if (p.sha !== null && !isNonEmptyString(p.sha)) refuse('coupling_writer_bypassed sha must be a sha string or null', 'invalid_payload');
    if (!isNonEmptyString(p.at)) refuse('swarm.coupling_writer_bypassed requires at — when the commit was observed', 'invalid_payload');
    return;
  }

  if (kind === 'swarm.participant_runtime_lost') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.participant_runtime_lost requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workerId)) refuse('swarm.participant_runtime_lost requires workerId', 'invalid_payload');
    // The worker process generation the restart lost. 0 is the honest reading for a handle
    // whose ledger recorded no generation at all — never a fabricated one.
    if (!Number.isSafeInteger(p.incarnation) || p.incarnation < 0) {
      refuse('swarm.participant_runtime_lost requires incarnation — the lost worker process generation', 'invalid_payload');
    }
    if (!isNonEmptyString(p.at)) refuse('swarm.participant_runtime_lost requires at — when the loss was reconciled', 'invalid_payload');
    return;
  }
  if (kind === 'swarm.claim_updated') {
    if (!isNonEmptyString(p.claimId)) refuse('swarm.claim_updated requires claimId', 'invalid_payload');
    // The seat that HOLDS the claim: the runtime derives it from the request identity (docs/45 §2
    // autoFilled), and the fold requires it — a hold attributed to nobody is not an answer.
    if (!isNonEmptyString(p.participantId)) {
      refuse('swarm.claim_updated requires participantId — the seat that holds the claim', 'invalid_payload');
    }
    if (p.workId !== undefined && p.paths !== undefined) {
      refuse('a claim names exactly one target: workId or paths', 'invalid_payload');
    }
    if (p.workId !== undefined) validOptionalNonEmptyString(p.workId, 'claim workId', refuse);
    if (p.paths !== undefined) validClaimPaths(p.paths);
    if (p.status !== undefined && !SWARM_ASSIGNMENT_STATUSES.includes(p.status)) {
      refuse(`claim status must be one of: ${SWARM_ASSIGNMENT_STATUSES.join(', ')}`, 'invalid_payload');
    }
    validOptionalNonEmptyString(p.handoffTo, 'claim handoffTo', refuse);
    validOptionalNonEmptyString(p.reason, 'claim reason', refuse);
    validOptionalNonNegativeInt(p.expectedVersion, 'claim expectedVersion', refuse);
    return;
  }
  if (kind === 'swarm.proposal_updated') {
    if (!isNonEmptyString(p.proposalId)) refuse('swarm.proposal_updated requires proposalId', 'invalid_payload');
    if (!SWARM_PROPOSAL_ACTIONS.includes(p.action)) {
      refuse(`proposal action must be one of: ${SWARM_PROPOSAL_ACTIONS.join(', ')}`, 'invalid_payload');
    }
    // The acting seat: the proposer consenting by proposing, the member consenting by arriving,
    // or the proposer withdrawing. Runtime-derived (docs/45 §3 autoFilled) and required by the
    // fold for the two consent-carrying actions; a withdrawal may name only releasedBy, the same
    // shape a coupling release has always had.
    if (p.action !== 'release' && !isNonEmptyString(p.participantId)) {
      refuse('swarm.proposal_updated requires participantId — the seat proposing or consenting', 'invalid_payload');
    }
    if (p.action === 'propose') {
      if (!Array.isArray(p.members) || p.members.length === 0 || !p.members.every(isNonEmptyString)) {
        refuse('a proposal names its members — the consent set — as a non-empty array', 'invalid_payload');
      }
      if (new Set(p.members).size !== p.members.length) {
        refuse('proposal members must be distinct', 'invalid_payload');
      }
      validProposalPlan(p.plan);
    }
    validOptionalNonEmptyString(p.reason, 'proposal reason', refuse);
    validOptionalNonNegativeInt(p.expectedVersion, 'proposal expectedVersion', refuse);
    return;
  }

  if (kind === 'swarm.participant_faulted') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.participant_faulted requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.workerId)) refuse('swarm.participant_faulted requires workerId', 'invalid_payload');
    // The typed provider fault class (#295): the runtime reads it off the coordinator's death
    // cert, so a fault row can never be minted from prose or from a class this family invented.
    if (!isNonEmptyString(p.code)) refuse('swarm.participant_faulted requires code — the typed provider fault class', 'invalid_payload');
    // The exact route the fault is a fact about. Harness and model always name one (a fault row
    // without them would be a fault about nothing); effort is absent on a route that has none.
    const route = p.route;
    if (!route || typeof route !== 'object' || Array.isArray(route)
      || !isNonEmptyString(route.harness) || !isNonEmptyString(route.model)) {
      refuse('swarm.participant_faulted requires route {harness, model, effort}', 'invalid_payload');
    }
    if (route.effort !== null && route.effort !== undefined && !isNonEmptyString(route.effort)) {
      refuse('swarm.participant_faulted route effort must be a non-empty string or null', 'invalid_payload');
    }
    // #442 item 4: the instant is either the provider's ZONE-QUALIFIED one or absent — a
    // zone-less answer keeps its own text (`resetAtText`) and derives no instant, never a
    // UTC reading nobody stated.
    if (p.resetAt !== null && p.resetAt !== undefined
      && !(isNonEmptyString(p.resetAt) && Number.isFinite(Date.parse(p.resetAt)))) {
      refuse('swarm.participant_faulted resetAt must be an ISO-8601 instant or null', 'invalid_payload');
    }
    validOptionalNonEmptyString(p.resetAtText, 'fault resetAtText', refuse);
    if (p.snapshotSha !== null && p.snapshotSha !== undefined && !isNonEmptyString(p.snapshotSha)) {
      refuse('swarm.participant_faulted snapshotSha must be a sha string or null', 'invalid_payload');
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
    validOptionalNonEmptyString(p.reason, 'assignment reason', refuse);
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
    // authorship claim; `sha`/`ref` alone stay the retained revision. `mergeBase` is the commit
    // the captured revision and the deployment's target branch descend from (issue #301), so the
    // row answers "integrate from where" without re-deriving git topology at read time.
    if (p.workspaceId !== undefined && !WORKSPACE_ID.test(p.workspaceId)) {
      refuse('A contribution revision workspace must be one physical workspace identity', 'invalid_payload');
    }
    if (p.observedHead !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(p.observedHead)) {
      refuse('A contribution revision observedHead must be an exact commit', 'invalid_payload');
    }
    if (p.mergeBase !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(p.mergeBase)) {
      refuse('A contribution revision mergeBase must be an exact commit', 'invalid_payload');
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
  if (kind === 'swarm.contribution_integrated') {
    if (!isNonEmptyString(p.contributionId)) refuse('swarm.contribution_integrated requires contributionId', 'invalid_payload');
    // The seat whose contribution was landed — the contract's own author identity, never the actor
    // of the landing: the root that ran the verb lands SOMEBODY ELSE's work, and the receipt names
    // the author so `swarm.view` can hand the row back to the seat it belongs to.
    if (!isNonEmptyString(p.participantId)) refuse('swarm.contribution_integrated requires participantId', 'invalid_payload');
    if (!SWARM_COMMIT.test(p.base ?? '') || !SWARM_COMMIT.test(p.targetHeadBefore ?? '')
      || !SWARM_COMMIT.test(p.squashSha ?? '')) {
      refuse('swarm.contribution_integrated requires exact commit ids for base, targetHeadBefore and squashSha', 'invalid_payload');
    }
    // `targetHeadAfter` is null on a dry run: the target did not move, and absence is the fact —
    // never a copy of targetHeadBefore, which would read as a landing that happened.
    if (p.targetHeadAfter !== null && !SWARM_COMMIT.test(p.targetHeadAfter ?? '')) {
      refuse('swarm.contribution_integrated targetHeadAfter must be an exact commit or null', 'invalid_payload');
    }
    if (!isNonEmptyString(p.target)) refuse('swarm.contribution_integrated requires the target branch it landed onto', 'invalid_payload');
    if (!Array.isArray(p.changedPaths) || p.changedPaths.some((path) => !isNonEmptyString(path))) {
      refuse('swarm.contribution_integrated requires changedPaths as an array of paths', 'invalid_payload');
    }
    if (p.gates !== undefined) {
      if (p.gates === null || typeof p.gates !== 'object' || Array.isArray(p.gates)) {
        refuse('swarm.contribution_integrated gates must be one object', 'invalid_payload');
      }
      if (p.gates.files !== undefined && (!Array.isArray(p.gates.files) || p.gates.files.some((path) => !isNonEmptyString(path)))) {
        refuse('swarm.contribution_integrated gates.files must be an array of test paths', 'invalid_payload');
      }
      if (p.gates.verdictLine !== undefined && p.gates.verdictLine !== null && !isNonEmptyString(p.gates.verdictLine)) {
        refuse('swarm.contribution_integrated gates.verdictLine must be text or null', 'invalid_payload');
      }
      if (p.gates.unexpected !== undefined && !Array.isArray(p.gates.unexpected)) {
        refuse('swarm.contribution_integrated gates.unexpected must be an array of rows', 'invalid_payload');
      }
    }
    for (const field of ['regenerated', 'conflicts']) {
      if (p[field] !== undefined && !Array.isArray(p[field])) {
        refuse(`swarm.contribution_integrated ${field} must be an array`, 'invalid_payload');
      }
    }
    if (p.issue !== undefined && p.issue !== null
      && !(Number.isSafeInteger(p.issue) && p.issue > 0)) {
      refuse('swarm.contribution_integrated issue must be a positive integer or null', 'invalid_payload');
    }
    if (p.dryRun !== undefined && typeof p.dryRun !== 'boolean') {
      refuse('swarm.contribution_integrated dryRun must be a boolean', 'invalid_payload');
    }
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

// ── joint couplings, claims and work proposals (issues #422/#423, docs/45) ────
//
// The helpers below are the stateful half of the design's §2–§4: what a record COVERS, who a
// rotation's roster is, and which holds overlap. They read the fold's own rows only — a record's
// authority (who may take, yield, hand off or consent) is the runtime's derivation (docs/45 §4.6),
// and the fold never reads runtime liveness (§4.2): membership is the only liveness it knows.

/** The recorded checkouts one writer record covers: an exclusive record covers the single
 * checkout its writer was recorded in; a rotating lease covers its members' recorded checkouts
 * (docs/45 §4.1). No other coupling kind covers a checkout. */
function writerCheckouts(record) {
  if (record.coupling !== 'writer') return [];
  if (Array.isArray(record.workspaces)) return record.workspaces;
  return WORKSPACE_ID.test(record.workspaceId ?? '') ? [record.workspaceId] : [];
}

/** The live roster a rotating lease reads for eligibility to take (docs/45 §4.1): the group's
 * CURRENT members when the lease was declared over a group, else the consent set the declaration
 * named — a members-only lease has no group to re-read. */
function leaseRoster(swarm, record) {
  if (record.groupId !== null && record.groupId !== undefined) {
    return [...(ownGet(swarm.groups, record.groupId)?.members ?? [])];
  }
  return [...(record.members ?? [])];
}

/** Two repo-relative paths overlap when they are string-equal or one is a prefix of the other at
 * a `/` boundary (docs/45 §2): `impl/src` and `impl/src/a.mjs` overlap, `impl/src/x` and
 * `impl/src/y` do not. */
function claimPathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/** The first ACTIVE claim on the same recorded checkout whose paths overlap `paths`, or null.
 * A claim on another checkout never conflicts (the lane model is per-worktree by construction)
 * and a null workspace conflicts with nothing; one seat's own holds never conflict with each
 * other (docs/45 §2). `rows` is the claim rows to judge — the swarm's own, or those plus the
 * rows one admission is minting. */
function claimConflictFor(rows, { claimId, participantId, workspaceId, paths }) {
  if (workspaceId === null || !Array.isArray(paths) || paths.length === 0) return null;
  for (const row of rows) {
    if (row.status !== 'active' || row.claimId === claimId || row.participantId === participantId) continue;
    if (row.workspaceId !== workspaceId || !Array.isArray(row.paths)) continue;
    const overlapping = paths.filter((path) => row.paths.some((held) => claimPathsOverlap(path, held)));
    if (overlapping.length > 0) return { holder: row.participantId, claimId: row.claimId, paths: overlapping };
  }
  return null;
}

/** The claim row one `swarm.claim_updated` records. `workspaceId` is never caller-supplied: a
 * fresh claim binds the holder's RECORDED checkout, a hold that moves between seats keeps the
 * checkout it was taken in, and a seat with no recorded checkout claims with null — absence,
 * not a guess (docs/45 §2). */
function claimRow(p, existingClaim, meta, { participantId, workspaceId, workId, paths, status }) {
  return Object.freeze({
    claimId: p.claimId, participantId, workId, paths, workspaceId, status,
    ...(p.reason !== undefined ? { releaseReason: p.reason } : {}),
    version: (existingClaim?.version ?? 0) + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
  });
}

/** One coupling record's shape after a declare or a propose (docs/45 §4.1/§4.5). Fields the
 * declaration does not carry stay ABSENT rather than null — an old record's key set is history,
 * and a replayed log must fold byte-identically (docs/45 §11). */
function couplingRecord(p, shape) {
  const { members, writer, workspaceId, workspaces, holder, holds, arrivals, carriedArrivals,
    consents, carriedConsents, proposed } = shape;
  return {
    couplingId: p.couplingId, coupling: p.coupling,
    groupId: p.groupId ?? null, name: p.name ?? null, policy: p.policy ?? null,
    members, writer, workspaceId, arrivals, carriedArrivals,
    // Issue #425: the bypasses observed against this writer record — appended by the fold,
    // carried as history, never rewritten by a re-declare.
    ...(p.coupling === 'writer' ? { bypasses: Object.freeze([]) } : {}),
    // A synchronization point's release threshold (docs/45 §4.3): absent means the point
    // releases explicitly, exactly as every point declared before this design does.
    ...(p.coupling === 'synchronization' && p.quorum !== undefined ? { quorum: p.quorum } : {}),
    // The joint fields exist only where the design names them: a lease carries the checkouts it
    // covers, the live hold and the hold history; a proposal carries its consent set until the
    // declaration flips it (docs/45 §4.1, §4.5). Absent on every record written before them.
    ...(workspaces !== undefined ? { workspaces } : {}),
    ...(holder !== undefined ? { holder, holds } : {}),
    ...(proposed !== undefined ? { proposed, consents } : {}),
    ...(carriedConsents !== undefined && carriedConsents !== null ? { carriedConsents } : {}),
    released: false, releasedBy: null, releaseReason: null,
  };
}

/** The distinct recorded checkouts a set of seats works in, sorted — the coverage a rotating
 * lease declares over (docs/45 §4.1). A seat with no recorded checkout contributes none. */
function recordedCheckouts(swarm, memberIds) {
  const covered = new Set();
  for (const memberId of memberIds) {
    const workspaceId = ownGet(swarm.participants, memberId)?.workspaceId;
    if (WORKSPACE_ID.test(workspaceId ?? '')) covered.add(workspaceId);
  }
  return [...covered].sort();
}

/** The unreleased writer record whose coverage overlaps a declaration's, or null: the one-writer
 * guarantee is per checkout across BOTH record families (docs/45 §4.1). The fold calls this and
 * raises `swarm_writer_conflict` itself, so the refusal stays inside the audited fold body. The
 * exemption is the pre-design one — an exclusive record re-declared by the SAME writer over the
 * same checkout is that seat's own refresh, not a second writer (its own couplingId never
 * conflicts, excluded before the scan). */
function conflictingWriterRecord(swarm, couplingId, covered, exclusiveWriter) {
  for (const row of Object.values(swarm.couplings ?? {})) {
    if (row.coupling !== 'writer' || row.released || row.couplingId === couplingId) continue;
    const shared = writerCheckouts(row).filter((workspaceId) => covered.includes(workspaceId));
    if (shared.length === 0) continue;
    if (exclusiveWriter !== null && row.writer === exclusiveWriter && shared.includes(row.workspaceId)) continue;
    return { record: row, workspaceId: shared[0] };
  }
  return null;
}

/** The claims a conflict scan reads: the swarm's own rows, plus — inside one admission — the rows
 * this same fold is minting, so a plan cannot claim the same paths twice (docs/45 §3). */
function* swarmClaims(swarm, minting = null) {
  yield* Object.values(swarm.claims ?? {});
  if (minting !== null) yield* minting.values();
}

/** Expand an accepted plan into the rows it names (docs/45 §3): one work item per `plan.work`
 * entry and one claim per `plan.claims` entry, with the deterministic `${proposalId}-claim-${index}`
 * identity. Every row is judged BEFORE any is written — a conflict refuses the whole acceptance
 * and records nothing — so a replay folds exactly what a hand-written sequence would have
 * produced. */
function proposalPlanRows(swarm, proposal, meta, admission) {
  const work = new Map(Object.entries(swarm.work ?? {}));
  const claims = new Map(Object.entries(swarm.claims ?? {}));
  for (const entry of proposal.plan.work ?? []) {
    if (admission && work.has(entry.workId)) {
      integrity(`the accepted plan creates work ${entry.workId}, which swarm ${swarm.swarmId} already holds`, 'swarm_work_exists', {
        field: 'plan.work', workId: entry.workId, proposalId: proposal.proposalId,
      });
    }
    work.set(entry.workId, Object.freeze({
      workId: entry.workId, objective: entry.objective, status: 'open',
      version: (work.get(entry.workId)?.version ?? 0) + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    }));
  }
  (proposal.plan.claims ?? []).forEach((entry, index) => {
    const claimId = `${proposal.proposalId}-claim-${index}`;
    const holder = ownGet(swarm.participants, entry.participantId);
    if (!holder) {
      integrity(`plan claim ${claimId} names participant ${entry.participantId}, which swarm ${swarm.swarmId} does not hold`, 'participant_not_found', {
        field: 'plan.claims', claimId, participantId: entry.participantId,
      });
    }
    if (holder.status !== 'active') {
      integrity(`plan claim ${claimId} names participant ${entry.participantId}, which is not active in swarm ${swarm.swarmId}`, 'participant_not_active', {
        field: 'plan.claims', claimId, participantId: entry.participantId,
      });
    }
    if (entry.workId !== undefined && !work.has(entry.workId)) {
      integrity(`plan claim ${claimId} names work ${entry.workId}, which swarm ${swarm.swarmId} does not hold`, 'work_not_found', {
        field: 'plan.claims', claimId, workId: entry.workId,
      });
    }
    const paths = entry.paths !== undefined ? Object.freeze([...entry.paths]) : null;
    const workspaceId = holder.workspaceId ?? null;
    if (admission && paths !== null) {
      const conflict = claimConflictFor(swarmClaims(swarm, claims),
        { claimId, participantId: entry.participantId, workspaceId, paths });
      if (conflict) {
        integrity(`plan claim ${claimId} claims ${conflict.paths.join(', ')} on checkout ${workspaceId}, where ${conflict.holder} holds ${conflict.claimId}; name disjoint paths, or have that hold released or handed off, then re-arrive`, 'swarm_claim_conflict', {
          field: 'plan.claims', claimId, participantId: entry.participantId,
          holder: conflict.holder, holdingClaimId: conflict.claimId, paths: conflict.paths, workspaceId,
        });
      }
    }
    claims.set(claimId, Object.freeze({
      claimId, participantId: entry.participantId, workId: entry.workId ?? null, paths, workspaceId, status: 'active',
      version: 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    }));
  });
  return { work, claims };
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
    const row = swarms.get(p.swarmId);
    swarms.set(p.swarmId, Object.freeze(p.baseCommit === undefined ? row : { ...row, baseCommit: p.baseCommit }));
    return;
  }

  const swarm = swarms.get(p.swarmId);
  if (!swarm) integrity(`swarm ${p.swarmId} not found`, 'swarm_not_found');

  if (kind === 'swarm.participant_joined') {
    const existing = ownGet(swarm.participants, p.participantId) ?? null;
    if (existing) {
      // A seat the runtime itself rolled back after a refused admission (issue #308: a
      // `recruit_refused` leave) is the ONE existing row a join may re-activate: the repeated
      // recruit of the same id RESUMES that join instead of being refused by a row the runtime
      // had already withdrawn. Any other existing row stays a duplicate.
      if (!(existing.status === 'left' && existing.leftReason === 'recruit_refused')) {
        integrity(`participant ${p.participantId} already exists in swarm ${p.swarmId}`, 'participant_duplicate');
      }
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
      resumeFrom: p.resumeFrom ?? null,
      brief: p.brief ?? null,
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
      // The typed admission code a recruit rollback carries (issue #308). Conditional on the
      // payload, so logs written before the field existed replay byte-identically.
      ...(p.code !== undefined ? { leftCode: p.code } : {}),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    // Issue #395, on #350's settled-status seam: the leave evicts the seat from every group it
    // is a member of, so a group's `members` always lists seats that can act — the same rule
    // the roster follows. The eviction is recorded on the group row (`departed`:
    // [{participantId, at, seq}], ONE shape, appended — history, never rewritten) and bumps the
    // group version, so a concurrent caller's expectedVersion collides honestly with the roster
    // change instead of rewriting over an eviction it never saw. A later group_updated naming
    // the seat is still refused (participant_not_active, with the repair coordinates) — the
    // fold never silently rewrites a caller's roster for them.
    let groups = null;
    for (const [groupId, group] of Object.entries(swarm.groups)) {
      if (!group.members.includes(p.participantId)) continue;
      const updatedGroup = Object.freeze({
        ...group,
        members: Object.freeze(group.members.filter((memberId) => memberId !== p.participantId)),
        departed: Object.freeze([...(group.departed ?? []),
          Object.freeze({ participantId: p.participantId, at: meta.ts, seq: meta.seq })]),
        version: group.version + 1,
        actor: meta.actor, seq: meta.seq, ts: meta.ts,
      });
      groups = groups ?? new Map(Object.entries(swarm.groups));
      groups.set(groupId, updatedGroup);
    }
    swarms.set(p.swarmId, groups === null
      ? replaceField(swarm, 'participants', parts)
      : replaceField(replaceField(swarm, 'participants', parts), 'groups', groups));
    return;
  }

  if (kind === 'swarm.group_updated') {
    const existingGroup = ownGet(swarm.groups, p.groupId) ?? null;
    // Members must be currently active participants (not left). The refusal names the group
    // and the seat (#290): a release batch trial-folds through here, and "participant_not_active"
    // without a group/seat left the operator no repairable coordinate. Since the leave fold
    // evicts a departed seat itself (#395), a roster that still names one is a stale resend:
    // the refusal carries the seat's settled status, the log position it departed at, and a
    // remedy naming the exact members array to resend — the current active set. No silent
    // rewrite by the fold: the caller repairs, the fold refuses.
    for (const memberId of p.members) {
      const member = ownGet(swarm.participants, memberId);
      if (!member) integrity(`group member ${memberId} not found in swarm ${p.swarmId} (group ${p.groupId}, seat ${memberId})`, 'participant_not_found');
      if (member.status !== 'active') {
        const activeSet = existingGroup?.members ?? [];
        integrity(`group member ${memberId} is not active in swarm ${p.swarmId} (group ${p.groupId}, seat ${memberId}); `
          + `the seat is departed since seq ${member.seq ?? null} — resend exactly ${JSON.stringify(activeSet)}`,
          'participant_not_active', {
            groupId: p.groupId,
            participantId: memberId,
            status: member.status,
            sinceSeq: member.seq ?? null,
            remedy: { members: [...activeSet], note: DEPARTED_SEAT_REMEDY_NOTE },
          });
      }
    }
    const currentVersion = existingGroup?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm group ${p.groupId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    const updatedGroup = Object.freeze({
      groupId: p.groupId,
      purpose: p.purpose !== undefined ? p.purpose : (existingGroup?.purpose ?? null),
      members: Object.freeze([...p.members]), version: currentVersion + 1,
      // The evictions this roster has recorded ride every rewrite (#395): who a group lost is
      // history, and a departed seat can never be named again without the refusal above.
      departed: Object.freeze([...(existingGroup?.departed ?? [])]),
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
    if (p.action === 'declare' || p.action === 'propose') {
      const proposed = p.action === 'propose';
      // A proposed coupling is put to its consent set; the proposer consents by proposing, and an
      // amendment carries the consents already given forward (docs/45 §4.5). `declared` is true
      // for every ordinary declare, and for a proposal once every named member has consented.
      let consents = null;
      let carriedConsents = null;
      let declared = true;
      if (proposed) {
        for (const memberId of p.members) {
          const member = ownGet(swarm.participants, memberId);
          if (!member) integrity(`proposal member ${memberId} not found in swarm ${p.swarmId}`, 'participant_not_found');
          if (member.status !== 'active') integrity(`proposal member ${memberId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
        }
        if (!p.members.includes(p.participantId)) {
          integrity(`the proposer ${p.participantId} is one of the members it names — the proposer consents by proposing`, 'invalid_payload');
        }
        consents = Object.freeze([...new Set([p.participantId, ...(existingCoupling?.consents ?? [])])]
          .filter((seat) => p.members.includes(seat)));
        const carried = consents.filter((seat) => seat !== p.participantId);
        carriedConsents = carried.length > 0 ? Object.freeze(carried) : null;
        declared = p.members.every((seat) => consents.includes(seat));
      } else if (p.coupling === 'synchronization' || p.coupling === 'failure') {
        if (!ownGet(swarm.groups, p.groupId)) {
          integrity(`coupling group ${p.groupId} not found in swarm ${p.swarmId}`, 'group_not_found');
        }
      }
      if (!proposed && p.coupling === 'failure') {
        const conflict = Object.values(swarm.couplings).find((row) => row.coupling === 'failure' && !row.released
          && row.groupId === p.groupId && row.couplingId !== p.couplingId);
        if (conflict) {
          integrity(`group ${p.groupId} already carries the unreleased failure policy ${conflict.couplingId}`, 'swarm_coupling_conflict');
        }
      }
      let writer = null;
      let workspaceId = null;
      let workspaces;
      let holder;
      let holds;
      let members = null;
      // The exclusivity decision: a declaration whose coverage an unreleased writer record
      // already covers refuses, naming that record (raised below, in this audited fold body).
      let conflicting = null;
      let exclusiveWriter = null;
      // A declare REPLACES the record's parameters. It never discards what the members already
      // reported: the arrivals the point holds are carried forward, and `carriedArrivals` names
      // them on the new record, so a re-declare can never wipe a barrier silently (audit #292).
      const arrivals = existingCoupling?.coupling === 'synchronization'
        ? Object.freeze([...(existingCoupling.arrivals ?? [])]) : Object.freeze([]);
      const carriedArrivals = p.coupling === 'synchronization' && existingCoupling !== null
        ? Object.freeze(arrivals.map((arrival) => arrival.participantId)) : null;
      if (p.coupling === 'synchronization') {
        // The group roster the point was declared over: seats that later leave the group (by
        // release or regroup) stay named on the record instead of vanishing from it. A proposed
        // point's roster is the consent set it was put to.
        members = proposed ? [...p.members] : [...(ownGet(swarm.groups, p.groupId)?.members ?? [])];
      }
      if (p.coupling === 'writer' && (proposed || isNonEmptyString(p.groupId))) {
        // A rotating writer lease (docs/45 §4.1, §4.5): the group — or, for a proposal, the
        // consent set the last arrival turns into the member roster — holds the write turn over
        // its members' recorded checkouts, and any member may take it and yield it.
        if (proposed && !declared) {
          members = [...p.members];
        } else {
          if (proposed) {
            members = [...consents];
          } else {
            const group = ownGet(swarm.groups, p.groupId);
            if (!group) integrity(`coupling group ${p.groupId} not found in swarm ${p.swarmId}`, 'group_not_found');
            members = [...group.members];
          }
          workspaces = Object.freeze(recordedCheckouts(swarm, members));
          if (admission && workspaces.length === 0) {
            integrity(`the members of ${proposed ? 'the consent set' : `group ${p.groupId}`} record no checkout, so a rotating writer lease over them could not be enforced; record the checkout a member works in (a participant is recorded in its checkout when it is recruited into one) before declaring the lease`, 'swarm_writer_workspace_unrecorded');
          }
          conflicting = conflictingWriterRecord(swarm, p.couplingId, workspaces, null);
        }
        // A re-declare of the SAME lease keeps its hold history and its live hold — a hold is
        // never dropped silently; a lease declared over another group starts unheld.
        const carriedHolds = !proposed && existingCoupling !== null
          && existingCoupling.coupling === 'writer' && existingCoupling.groupId === p.groupId ? existingCoupling : null;
        holder = carriedHolds?.holder ?? null;
        holds = Object.freeze([...(carriedHolds?.holds ?? [])]);
      }
      if (p.coupling === 'writer' && !proposed && !isNonEmptyString(p.groupId)) {
        if (!isNonEmptyString(p.participantId)) {
          integrity('an exclusive writer claim must name participantId — the writer whose turn over the checkout it is', 'invalid_payload');
        }
        const writerRow = ownGet(swarm.participants, p.participantId);
        if (!writerRow) integrity(`writer participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
        if (writerRow.status !== 'active') integrity(`writer participant ${p.participantId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
        // Exclusivity is a fact about ONE recorded checkout. A claim over a participant with no
        // recorded checkout would name no resource at all, and the one-writer guarantee would be
        // inert exactly where it is promised (docs/39 §Declared coupling) — so at admission it
        // refuses and names the remedy. A row already in the ledger was admitted under the rules
        // of its day and replays as recorded (workspaceId null), never as a startup refusal.
        if (admission && !WORKSPACE_ID.test(writerRow.workspaceId ?? '')) {
          integrity(`participant ${p.participantId} has no recorded checkout, so an exclusive writer claim over it could not be enforced; record the checkout its participant works in (a participant is recorded in its checkout when it is recruited into one) before claiming it`, 'swarm_writer_workspace_unrecorded');
        }
        workspaceId = writerRow.workspaceId;
        exclusiveWriter = p.participantId;
        writer = p.participantId;
      }
      // Exclusivity is per checkout across BOTH record families (docs/45 §4.1) — the one-writer
      // guarantee cannot depend on which spelling declared it.
      if (conflicting === null && p.coupling === 'writer') {
        const coverage = workspaces ?? (WORKSPACE_ID.test(workspaceId ?? '') ? [workspaceId] : []);
        conflicting = conflictingWriterRecord(swarm, p.couplingId, coverage, exclusiveWriter);
      }
      if (conflicting !== null) {
        integrity(`checkout ${conflicting.workspaceId} already names the writer ${conflicting.record.writer ?? conflicting.record.holder ?? conflicting.record.couplingId} (${conflicting.record.couplingId}); release that record first`, 'swarm_writer_conflict');
      }
      record = couplingRecord(p, {
        members, writer, workspaceId, workspaces, holder, holds, arrivals, carriedArrivals,
        ...(proposed ? { proposed: !declared, consents, carriedConsents } : {}),
      });
    } else {
      if (!existingCoupling) {
        integrity(`coupling ${p.couplingId} not found in swarm ${p.swarmId}`, 'coupling_not_found');
      }
      if (existingCoupling.released) {
        integrity(`coupling ${p.couplingId} is already released`, 'swarm_coupling_released');
      }
      // A writer record is a LEASE when it carries no exclusive writer: declared over a group
      // (groupId) or by a consent set (docs/45 §4.1, §4.5). Both rotate; both are taken/yielded.
      const lease = existingCoupling.coupling === 'writer' && existingCoupling.writer === null;
      if (p.action === 'take' || p.action === 'yield') {
        if (!lease) {
          integrity(`coupling ${p.couplingId} is not a rotating writer lease, so it has no write turn to ${p.action}`, 'invalid_payload');
        }
        if (existingCoupling.proposed === true) {
          integrity(`lease ${p.couplingId} is proposed, not declared: its members have not all consented yet`, 'invalid_payload');
        }
      }
      if (p.action === 'take') {
        // The fold reads membership, never runtime liveness (docs/45 §4.2): a take is admitted
        // when the lease is unheld or the holder's membership has ended, and the runtime's
        // liveness-admitted yield is what ends a live-runtime holder's hold.
        const taker = ownGet(swarm.participants, p.participantId);
        if (!taker) integrity(`taking participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
        if (taker.status !== 'active') integrity(`taking participant ${p.participantId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
        if (!leaseRoster(swarm, existingCoupling).includes(p.participantId)) {
          integrity(`participant ${p.participantId} is not a member of the group that holds lease ${p.couplingId}`, 'swarm_not_a_member');
        }
        if (existingCoupling.holder !== null && existingCoupling.holder !== undefined) {
          const heldBy = ownGet(swarm.participants, existingCoupling.holder);
          if (heldBy && heldBy.status === 'active') {
            integrity(`lease ${p.couplingId} is held by ${existingCoupling.holder}; that seat yields it, or a member takes over once its membership has ended`, 'swarm_writer_lease_held', {
              couplingId: p.couplingId, holder: existingCoupling.holder,
            });
          }
        }
        record = { ...existingCoupling, holder: p.participantId,
          holds: Object.freeze([...(existingCoupling.holds ?? []),
            Object.freeze({ participantId: p.participantId, actor: meta.actor, seq: meta.seq, ts: meta.ts, yieldedBy: null, yieldReason: null })]) };
      } else if (p.action === 'yield') {
        if (existingCoupling.holder === null || existingCoupling.holder === undefined) {
          integrity(`lease ${p.couplingId} holds no live hold, so there is nothing to yield`, 'swarm_writer_lease_unheld');
        }
        if (p.participantId !== existingCoupling.holder) {
          integrity(`lease ${p.couplingId} is held by ${existingCoupling.holder}, not ${p.participantId}; the holder yields its own hold — a group member may yield a hold whose runtime is gone, which the runtime admits (§4.2)`, 'swarm_writer_lease_held', {
            couplingId: p.couplingId, holder: existingCoupling.holder,
          });
        }
        const yieldedBy = p.releasedBy ?? p.participantId;
        assertAttribution(swarm, yieldedBy, meta, 'releasedBy');
        const holds = [...(existingCoupling.holds ?? [])];
        for (let at = holds.length - 1; at >= 0; at -= 1) {
          if (holds[at].participantId === p.participantId && holds[at].yieldedBy === null) {
            holds[at] = Object.freeze({ ...holds[at], yieldedBy,
              ...(p.reason !== undefined ? { yieldReason: p.reason } : {}) });
            break;
          }
        }
        record = { ...existingCoupling, holder: null, holds: Object.freeze(holds) };
      } else if (p.action === 'arrive') {
        if (!isNonEmptyString(p.participantId)) {
          integrity('an arrival must name participantId — the participant who arrived', 'invalid_payload');
        }
        const arriver = ownGet(swarm.participants, p.participantId);
        if (!arriver) integrity(`arriving participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
        if (arriver.status !== 'active') integrity(`arriving participant ${p.participantId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
        if (existingCoupling.proposed === true) {
          // Arrival at a PROPOSED coupling is consent to it (docs/45 §4.5): the consent set is
          // the record's own `members`, and the last consent declares the record.
          if (!(existingCoupling.members ?? []).includes(p.participantId)) {
            integrity(`participant ${p.participantId} is not in the consent set ${JSON.stringify([...(existingCoupling.members ?? [])])} of ${p.couplingId}`, 'swarm_not_a_member');
          }
          if ((existingCoupling.consents ?? []).includes(p.participantId)) {
            integrity(`participant ${p.participantId} has already consented to ${p.couplingId}`, 'swarm_already_arrived');
          }
          const nextConsents = Object.freeze([...(existingCoupling.consents ?? []), p.participantId]);
          const agreed = (existingCoupling.members ?? []).every((seat) => nextConsents.includes(seat));
          if (!agreed) {
            record = { ...existingCoupling, consents: nextConsents };
          } else if (existingCoupling.coupling === 'writer') {
            // The consent set becomes the member roster and coverage is derived from it; the
            // declared lease starts unheld.
            const covered = Object.freeze(recordedCheckouts(swarm, [...nextConsents]));
            if (admission && covered.length === 0) {
              integrity('the consenting members record no checkout, so a rotating writer lease over them could not be enforced; record the checkout a member works in (a participant is recorded in its checkout when it is recruited into one) before declaring the lease', 'swarm_writer_workspace_unrecorded');
            }
            const conflictingWriter = conflictingWriterRecord(swarm, p.couplingId, covered, null);
            if (conflictingWriter !== null) {
              integrity(`checkout ${conflictingWriter.workspaceId} already names the writer ${conflictingWriter.record.writer ?? conflictingWriter.record.holder ?? conflictingWriter.record.couplingId} (${conflictingWriter.record.couplingId}); release that record first`, 'swarm_writer_conflict');
            }
            record = { ...existingCoupling, members: [...nextConsents], consents: nextConsents,
              proposed: false, workspaces: covered, holder: null, holds: Object.freeze([]) };
          } else {
            // A synchronization point declared by consent: arrivals start EMPTY — consent to the
            // point's existence is not arrival at the point (docs/45 §4.5).
            record = { ...existingCoupling, members: [...nextConsents], consents: nextConsents,
              proposed: false, arrivals: Object.freeze([]) };
          }
        } else if (existingCoupling.coupling === 'synchronization') {
          const members = ownGet(swarm.groups, existingCoupling.groupId)?.members ?? [];
          if (!members.includes(p.participantId)) {
            integrity(`participant ${p.participantId} is not a member of group ${existingCoupling.groupId}`, 'swarm_not_a_member');
          }
          if (existingCoupling.arrivals.some((arrival) => arrival.participantId === p.participantId)) {
            integrity(`participant ${p.participantId} has already arrived at ${p.couplingId}`, 'swarm_already_arrived');
          }
          // An arrival is a seat's own report: it carries WHEN it was made and which identity
          // made it, so "all reports in" is answerable from the artifact, not from a watch log.
          const nextArrivals = Object.freeze([...existingCoupling.arrivals,
            Object.freeze({ participantId: p.participantId, actor: meta.actor, seq: meta.seq, ts: meta.ts })]);
          // Quorum (docs/45 §4.3): the satisfying arrival RELEASES the point in the same fold,
          // attributed to the arriving seat — never to a lead who notices it completed. A roster
          // shrunk below the quorum by departures is released by its LAST arrival, because the
          // threshold is min(quorum, live members); a point declared without a quorum releases
          // exactly as it always has (explicitly, docs/45 §11).
          const live = members.filter((memberId) => ownGet(swarm.participants, memberId)?.status === 'active');
          const arrivedSeats = new Set(nextArrivals.map((arrival) => arrival.participantId));
          const arrivedCount = live.filter((seat) => arrivedSeats.has(seat)).length;
          const satisfied = existingCoupling.quorum !== undefined && nextArrivals.length > 0
            && arrivedCount >= Math.min(existingCoupling.quorum, live.length);
          record = satisfied
            ? { ...existingCoupling, arrivals: nextArrivals, released: true, releasedBy: p.participantId, releaseReason: 'quorum reached' }
            : { ...existingCoupling, arrivals: nextArrivals };
        } else {
          integrity(`coupling ${p.couplingId} is a ${existingCoupling.coupling} record; only a synchronization point accepts arrivals`, 'invalid_payload');
        }
      } else {
        const releasedBy = p.releasedBy ?? p.participantId ?? null;
        assertAttribution(swarm, releasedBy, meta, 'releasedBy');
        // Releasing a PENDING proposal withdraws it (docs/45 §4.5): a withdrawn proposal never
        // expands, and it reads released so the withdrawal is never confused with a declaration.
        record = { ...existingCoupling, released: true, releasedBy, releaseReason: p.reason ?? null,
          ...(existingCoupling.proposed === true ? { proposed: false } : {}) };
      }
    }
    const couplings = new Map(Object.entries(swarm.couplings));
    couplings.set(p.couplingId, Object.freeze({
      ...record, version: currentVersion + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    }));
    swarms.set(p.swarmId, replaceField(swarm, 'couplings', couplings));
    return;
  }

  if (kind === 'swarm.coupling_writer_bypassed') {
    // Issue #425: a peer committed in the checkout while this writer coupling was live. The
    // runtime composes the row from the projected wrapper's own observation, so the fold
    // appends it as history on the record it names — the act is recorded, never refused,
    // and the view pages both seats from it. The workspace must be the record's own: a row
    // naming a different checkout would describe a resource the coupling never covered.
    const coupling = ownGet(swarm.couplings, p.couplingId) ?? null;
    if (!coupling || coupling.coupling !== 'writer') {
      integrity(`coupling ${p.couplingId} is not a writer record in swarm ${p.swarmId}`, 'coupling_not_found');
    }
    // A lease covers its members' checkouts; an exclusive record the single checkout its writer
    // was recorded in. Either way the bypass must name a checkout this record really covers.
    if (!writerCheckouts(coupling).includes(p.workspaceId)) {
      integrity(`bypass names checkout ${p.workspaceId}, but coupling ${p.couplingId} covers ${JSON.stringify(writerCheckouts(coupling))}`, 'invalid_payload');
    }
    const couplings = new Map(Object.entries(swarm.couplings));
    couplings.set(p.couplingId, Object.freeze({
      ...coupling,
      bypasses: Object.freeze([...(coupling.bypasses ?? []),
        Object.freeze({ by: p.by, sha: p.sha, at: p.at, seq: meta.seq, ts: meta.ts })]),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    }));
    swarms.set(p.swarmId, replaceField(swarm, 'couplings', couplings));
    return;
  }
  if (kind === 'swarm.participant_runtime_lost') {
    // Issue #364: the resident restarted and this seat's worker is absent from the fleet it
    // recovered. The row is HISTORY on the participant (the newest fact about its runtime), never
    // a membership settle: the seat's status is untouched, and a LATER `swarm.participant_bound`
    // (a resume) supersedes it — the projection reads the newest of the two.
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant,
      runtimeLost: Object.freeze({
        workerId: p.workerId, incarnation: p.incarnation, at: p.at, seq: meta.seq, ts: meta.ts,
      }),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.claim_updated') {
    // A claim is an assignment-shaped hold with self-authority (docs/45 §2): create-or-replace
    // with CAS, like every collection, and a handoff rewrites the holder in ONE row so there is
    // no free window a third seat could take.
    const existingClaim = ownGet(swarm.claims, p.claimId) ?? null;
    const currentVersion = existingClaim?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm claim ${p.claimId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    if (!ownGet(swarm.participants, p.participantId)) {
      integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    if (existingClaim === null && (p.handoffTo !== undefined || p.status === 'released')) {
      integrity(`claim ${p.claimId} not found in swarm ${p.swarmId}, so it can neither be handed off nor released`, 'swarm_claim_not_found');
    }
    if (existingClaim === null && p.workId === undefined && p.paths === undefined) {
      integrity(`claim ${p.claimId} is new, so it names its target: workId or paths`, 'invalid_payload');
    }
    // What only the runtime can decide is WHO may name a seat (docs/45 §4.6); what the fold
    // refuses is a row that would silently move somebody else's live hold.
    if (existingClaim !== null && existingClaim.status === 'active' && p.participantId !== existingClaim.participantId) {
      integrity(`${p.claimId} is held by ${existingClaim.participantId}: a claim moves only from its holder — release or hand off your own claim, or an organizer moves any`, 'swarm_permission_required', {
        ...CLAIM_MOVE_COORDINATES, claimId: p.claimId, holder: existingClaim.participantId,
      });
    }
    if (p.workId !== undefined && !ownGet(swarm.work, p.workId)) {
      integrity(`work ${p.workId} not found in swarm ${p.swarmId}`, 'work_not_found');
    }
    let handoffTo = null;
    if (p.handoffTo !== undefined) {
      const receiver = ownGet(swarm.participants, p.handoffTo);
      if (!receiver) integrity(`participant ${p.handoffTo} not found in swarm ${p.swarmId}`, 'participant_not_found');
      if (receiver.status !== 'active') integrity(`participant ${p.handoffTo} is not active in swarm ${p.swarmId}`, 'participant_not_active');
      if (p.status === 'released') {
        integrity('a handoff keeps the claim active — release is its own act', 'invalid_payload');
      }
      handoffTo = p.handoffTo;
    }
    const participantId = handoffTo ?? p.participantId;
    // The target is replaced whole when re-named, and kept otherwise (the work-objective rule):
    // naming one side clears the other, so a claim never carries two targets.
    const namesWork = p.workId !== undefined;
    const workId = namesWork ? p.workId : (p.paths !== undefined ? null : (existingClaim?.workId ?? null));
    const paths = p.paths !== undefined ? Object.freeze([...p.paths]) : (namesWork ? null : (existingClaim?.paths ?? null));
    // A hold that MOVES between seats keeps the checkout it was taken in; a fresh claim binds the
    // claimant's recorded checkout (docs/45 §2).
    const movesHold = existingClaim !== null && existingClaim.status === 'active' && participantId !== existingClaim.participantId;
    const workspaceId = movesHold
      ? (existingClaim.workspaceId ?? null)
      : (ownGet(swarm.participants, participantId)?.workspaceId ?? null);
    if (admission && Array.isArray(paths)) {
      // Admission-only (#304): a path claim that conflicts refuses BEFORE it is written, and a
      // resident never refuses its own recorded history at startup.
      const conflict = claimConflictFor(swarmClaims(swarm), { claimId: p.claimId, participantId, workspaceId, paths });
      if (conflict) {
        integrity(`claim ${p.claimId} claims ${conflict.paths.join(', ')} on checkout ${workspaceId}, where ${conflict.holder} holds ${conflict.claimId}; name your own disjoint paths, or ask the holder to release or hand off that hold`, 'swarm_claim_conflict', {
          ...CLAIM_PATHS_COORDINATES, claimId: p.claimId, participantId,
          holder: conflict.holder, holdingClaimId: conflict.claimId, paths: conflict.paths, workspaceId,
        });
      }
    }
    const claims = new Map(Object.entries(swarm.claims ?? {}));
    claims.set(p.claimId, claimRow(p, existingClaim, meta, {
      participantId, workspaceId, workId, paths,
      status: p.status ?? existingClaim?.status ?? 'active',
    }));
    swarms.set(p.swarmId, replaceField(swarm, 'claims', claims));
    return;
  }

  if (kind === 'swarm.proposal_updated') {
    // A work split peers accept by arriving (docs/45 §3): the proposer consents by proposing, a
    // named member's arrival IS its consent, and the last consent expands the plan into the rows
    // it names — never a side effect, always the rows a hand-written sequence would have written.
    const existingProposal = ownGet(swarm.proposals, p.proposalId) ?? null;
    const currentVersion = existingProposal?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm proposal ${p.proposalId} version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    if (p.participantId !== undefined && !ownGet(swarm.participants, p.participantId)) {
      integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    }
    if (existingProposal === null && p.action !== 'propose') {
      integrity(`proposal ${p.proposalId} not found in swarm ${p.swarmId}`, 'swarm_proposal_not_found');
    }
    if (existingProposal?.released === true && p.action !== 'propose') {
      integrity(`proposal ${p.proposalId} is withdrawn, so it accepts no consent and never expands`, 'swarm_proposal_released');
    }
    let proposal;
    if (p.action === 'propose') {
      for (const memberId of p.members) {
        const member = ownGet(swarm.participants, memberId);
        if (!member) integrity(`proposal member ${memberId} not found in swarm ${p.swarmId}`, 'participant_not_found');
        if (member.status !== 'active') integrity(`proposal member ${memberId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
      }
      if (!p.members.includes(p.participantId)) {
        integrity(`the proposer ${p.participantId} is one of the members it names — the proposer consents by proposing`, 'invalid_payload');
      }
      // An amendment CARRIES the consents already given forward, naming them in
      // `carriedConsents` (the carried-arrivals rule): re-proposing never wipes consent silently.
      const consents = Object.freeze([...new Set([p.participantId, ...(existingProposal?.consents ?? [])])]
        .filter((seat) => p.members.includes(seat)));
      const carried = consents.filter((seat) => seat !== p.participantId);
      proposal = {
        proposalId: p.proposalId, members: Object.freeze([...p.members]), plan: deepFreezeBody(p.plan), consents,
        ...(carried.length > 0 ? { carriedConsents: Object.freeze(carried) } : {}),
        proposed: !p.members.every((seat) => consents.includes(seat)),
        released: false, releasedBy: null, releaseReason: null,
      };
    } else if (p.action === 'arrive') {
      const arriver = ownGet(swarm.participants, p.participantId);
      if (arriver.status !== 'active') integrity(`consenting participant ${p.participantId} is not active in swarm ${p.swarmId}`, 'participant_not_active');
      if (!existingProposal.members.includes(p.participantId)) {
        integrity(`participant ${p.participantId} is not in the consent set ${JSON.stringify([...existingProposal.members])} of ${p.proposalId}`, 'swarm_not_a_member');
      }
      if (existingProposal.consents.includes(p.participantId)) {
        integrity(`participant ${p.participantId} has already consented to ${p.proposalId}`, 'swarm_already_arrived');
      }
      const consents = Object.freeze([...existingProposal.consents, p.participantId]);
      proposal = { ...existingProposal, consents,
        proposed: !existingProposal.members.every((seat) => consents.includes(seat)) };
    } else {
      const releasedBy = p.releasedBy ?? p.participantId ?? null;
      assertAttribution(swarm, releasedBy, meta, 'releasedBy');
      proposal = { ...existingProposal, released: true, releasedBy, releaseReason: p.reason ?? null, proposed: false };
    }
    // Acceptance IS the expansion — the arrival that completes consent, or a proposal whose
    // consent set was already complete when it was written.
    const completes = proposal.proposed === false && proposal.released !== true
      && (existingProposal === null || existingProposal.proposed === true);
    const expanded = completes ? proposalPlanRows(swarm, proposal, meta, admission) : null;
    const proposals = new Map(Object.entries(swarm.proposals ?? {}));
    proposals.set(p.proposalId, Object.freeze({
      ...proposal, version: currentVersion + 1, actor: meta.actor, seq: meta.seq, ts: meta.ts,
    }));
    let next = replaceField(swarm, 'proposals', proposals);
    if (expanded !== null) {
      next = replaceField(replaceField(next, 'work', expanded.work), 'claims', expanded.claims);
    }
    swarms.set(p.swarmId, next);
    return;
  }

  if (kind === 'swarm.participant_faulted') {
    // Issue #442: the seat's worker ended under a provider-fault kill. Like the #364 loss, the row
    // is HISTORY on the participant — the newest fact about its runtime, folded so the view, the
    // brief and the wake feed read one derivation — never a second membership settle (the #350
    // settle stays the `swarm.participant_left` fold the runtime writes beside this row).
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant,
      fault: Object.freeze({
        workerId: p.workerId,
        code: p.code,
        route: Object.freeze({
          harness: p.route.harness, model: p.route.model, effort: p.route.effort ?? null,
        }),
        resetAt: p.resetAt ?? null,
        resetAtText: p.resetAtText ?? null,
        snapshotSha: p.snapshotSha ?? null,
        seq: meta.seq, ts: meta.ts,
      }),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
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
      status: p.status,
      // The WHY of a release (a holder release batch, issues #263/#308): durable on the domain
      // event itself, because the in-flight operation row carries no request body.
      ...(p.reason !== undefined ? { releaseReason: p.reason } : {}),
      version: currentVersion + 1,
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
      // The revision also names the checkout it was observed in, the HEAD that checkout showed
      // before the capture, and — when the runtime derived it (issue #301) — the commit the
      // revision and the deployment's target descend from. Shared-checkout facts, never an
      // authorship claim over `sha`.
      revision: Object.freeze({
        sha: p.sha, ref: p.ref,
        workspaceId: p.workspaceId ?? null, observedHead: p.observedHead ?? null,
        ...(p.mergeBase !== undefined ? { mergeBase: p.mergeBase } : {}),
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
  if (kind === 'swarm.contribution_integrated') {
    const contribution = ownGet(swarm.contributions, p.contributionId);
    if (!contribution) integrity('contribution not found in swarm', 'contribution_not_found', { contributionId: p.contributionId });
    // The seat named on the receipt must be the contribution's own author. The landing is the
    // ROOT's act (its actor rides `meta.actor`), so the author identity can never be inferred from
    // the event — and a receipt that names somebody else would hand one seat's landing to another.
    if (contribution.participantId !== p.participantId) {
      integrity('Landing receipt author differs from contribution author', 'contribution_author_mismatch');
    }
    // A contribution lands once. Re-landing is a new contribution (or an explicit revert), never a
    // silent second receipt that leaves the first one describing a commit the target no longer
    // descends from.
    if (contribution.integration) {
      integrity(`contribution ${p.contributionId} is already integrated`, 'contribution_duplicate');
    }
    const integration = Object.freeze({
      base: p.base, target: p.target,
      targetHeadBefore: p.targetHeadBefore, targetHeadAfter: p.targetHeadAfter ?? null,
      squashSha: p.squashSha,
      changedPaths: Object.freeze([...p.changedPaths]),
      gates: Object.freeze({
        files: Object.freeze([...(p.gates?.files ?? [])]),
        verdictLine: p.gates?.verdictLine ?? null,
        unexpected: Object.freeze([...(p.gates?.unexpected ?? [])].map((row) => deepFreezeBody(row))),
      }),
      regenerated: Object.freeze([...(p.regenerated ?? [])]),
      conflicts: Object.freeze([...(p.conflicts ?? [])].map((row) => deepFreezeBody(row))),
      issue: p.issue ?? null,
      dryRun: p.dryRun === true,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const contributions = new Map(Object.entries(swarm.contributions));
    contributions.set(p.contributionId, Object.freeze({ ...contribution, integration }));
    swarms.set(p.swarmId, replaceField(swarm, 'contributions', contributions));
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
