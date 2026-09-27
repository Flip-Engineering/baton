// Durable domain state for living Baton swarms.
//
// Extracted deterministic event fold compatible with CoordinationStore transaction
// snapshots/replay. Mirrors the coordination lane's deterministic-fold pattern:
// a mutable Map of swarm rows is the projection surface; fold functions produce
// frozen immutable replacement rows; no external effects in replay.
//
// Root hooks validateSwarmEvent and foldSwarmEvent to the same durable coordination
// log, not a parallel journal. Consumers own the log; this module owns the fold.

// Issue #430: every code `refuse`/`integrity` raise draws from the family's ONE closed refusal
// set; minting a code outside it is a construction-time error.
import { assertSwarmRefusalCode } from './swarm-refusals.mjs';
// Issue #464: the participant row's role line is bounded by the ONE `view.role.head` registry row
// (limits.mjs derives it from the frame a roster must fit) — never a second constant here.
import { FRAME_LIMITS } from './limits.mjs';
// Issue #286 G-36: the physical-workspace-id shape has ONE definition (shared-workspace-custody.mjs);
// every workspace id this fold admits or compares asks that predicate.
import { isPhysicalWorkspaceId } from './shared-workspace-custody.mjs';

export const SWARM_EVENT_KINDS = Object.freeze(new Set([
  'swarm.created',
  'swarm.participant_joined',
  'swarm.participant_bound',
  'swarm.participant_left',
  'swarm.work_updated',
  'swarm.assignment_updated',
  'swarm.claim_updated',
  // Issue #364: the runtime-recorded restart reconciliation — a seat whose worker is absent
  // from the fleet THIS incarnation recovered. Composed by the swarm runtime from the
  // coordinator's own fleet capture, never caller-submittable.
  'swarm.participant_runtime_lost',
  // Issue #442: the runtime-recorded provider fault — a seat whose worker ended under a
  // provider-fault kill. Composed by the swarm runtime from the coordinator's own death seam,
  // never caller-submittable.
  'swarm.participant_faulted',
  // Issue #385: the runtime-recorded workspace carry — a resume-from successor inherits the
  // predecessor's workspace (same checkout or changes applied from a snapshot).
  'workspace.carried_from',
  // Issue #443: the re-route DECISION the provider-fault observation records — the candidates the
  // deployment's own route rows offer, ranked by the comparison a recruit performs, with what the
  // death left to carry. Composed by the swarm runtime from the coordinator's death seam and its
  // route rows, never caller-submittable: a fabricated proposal would name candidates nobody ranked.
  'swarm.reroute_proposed',
  // Issue #443: the PERFORMED re-route — the successor an `auto` swarm bound on the first
  // candidate, recorded by the runtime from the recruit it really ran, never caller-submittable.
  'swarm.rerouted',
  // Issue #525's resume-continuation decision is GONE (#572): a resume-from recruit performs the
  // full recovery and continuation in the one command, so nothing asks an orchestrator whether to
  // continue a recovered seat and nothing parks one. The two kinds stay in the fold because the
  // ledgers of deployments that ran the mechanism still hold their rows; no writer emits them.
  'swarm.resume_decision_requested',
  'swarm.resume_decision_answered',
  'swarm.context_updated',
  'swarm.contribution_recorded',
  'swarm.contribution_revision_attached',
  'swarm.contribution_reviewed',
  // Issue #296: the landing receipt — the runtime's own record of one contribution squashed onto a
  // target. Composed by `swarm.integrate` from the git it actually ran (the base it resolved, the
  // commit it made, the gates it ran, the conflicts it resolved), never caller-submittable: a
  // fabricated landing receipt would be a lie in the durable record.
  'swarm.contribution_integrated',
]));

export const SWARM_WORK_STATUSES = Object.freeze(['open', 'completed', 'cancelled']);
export const SWARM_ASSIGNMENT_STATUSES = Object.freeze(['active', 'released']);
export const SWARM_REVIEW_DECISIONS = Object.freeze(['accept', 'reject', 'comment']);

// Issue #443: the closed sets the re-route lane declares. The policy's modes are the ONE
// decision axis a swarm owns (a proposal for a human orchestrator, or the runtime performing the
// resume itself); the reason vocabulary is what each candidate row says about WHY it ranked, and
// the exclusion reasons are the ways a route leaves the decision without being a candidate: a
// closed window, or the operator's declared routing rule (#574).
export const SWARM_REROUTE_MODES = Object.freeze(['manual', 'auto']);
export const SWARM_REROUTE_CANDIDATE_REASONS = Object.freeze(['subscription_headroom', 'api_fallback']);
export const SWARM_REROUTE_EXCLUDED_REASONS = Object.freeze(['excluded_window_closed', 'excluded_by_operator']);
/** The billing bases a route's own profile publishes (#429): `api` pays per token, `subscription`
 * is a flat plan. A route whose deployment publishes no measured profile carries none — absence is
 * never a guessed basis. */
export const SWARM_ROUTE_BILLING_BASES = Object.freeze(['api', 'subscription']);
/** The fields the initial provider-fault policy may carry — the closed vocabulary a misspelled policy
 * field refuses against, so a policy nobody reads never lands in the durable record. */
export const SWARM_POLICY_FIELDS = Object.freeze(['rerouteOnProviderFault', 'reroutePreferApi']);

// The coordinates a claim refusal carries (docs/45 §2, §2.2). Named constants, not inline
// literals: the fold-admission audit classifies an integrity(...) call by its LAST literal
// argument, so a refusal's detail keeps to references and the code literal stays last.
const CLAIM_MOVE_COORDINATES = Object.freeze({ field: 'participantId', rule: 'claim-holder-or-organize' });
const CLAIM_PATHS_COORDINATES = Object.freeze({ field: 'paths', rule: 'claimed-paths' });

// docs/47 §5 (#441 item 3): the claim id a seat's DECLARED recruit scope is recorded under, at
// bind, by the runtime's recruit effect. ONE derivation — the runtime writes `scopeClaimId(seat)`
// and the fold reads the same spelling to know which rows are scope claims — so the two halves of
// the rule cannot drift. The `scope:` namespace is reserved to that row; the shape half below
// refuses a hand-written claim id wearing it.
const SCOPE_CLAIM_PREFIX = 'scope:';
export const scopeClaimId = (participantId) => `${SCOPE_CLAIM_PREFIX}${participantId}`;
const isScopeClaimId = (claimId) => typeof claimId === 'string' && claimId.startsWith(SCOPE_CLAIM_PREFIX);

// Issue #453: the closed set of outcomes a `resume-from` workspace carry records — `bound` (the
// successor works in the predecessor's own checkout), `applied` (the checkout was gone and the
// snapshot's changes were applied to the successor's new one) and `skipped` (nothing was carried,
// and the row says why). A row recorded before #453 carries none of the three and folds as null.
export const SWARM_CARRY_HOW = Object.freeze(['bound', 'applied', 'skipped']);

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
    // Coordinates identify the event payload that failed validation.
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

// Issue #443: one exact route as every re-route row spells it — harness and model always name one
// (a fact about a route without them is a fact about nothing), effort is absent on a route that
// has none. Shared by the proposal, its candidates and the performed re-route, so the four rows
// can never disagree about what a route is.
function validRerouteRoute(route, fieldName) {
  if (route === null || typeof route !== 'object' || Array.isArray(route)
    || !isNonEmptyString(route.harness) || !isNonEmptyString(route.model)) {
    refuse(`${fieldName} must name {harness, model, effort}`, 'invalid_payload');
  }
  if (route.effort !== null && route.effort !== undefined && !isNonEmptyString(route.effort)) {
    refuse(`${fieldName} effort must be a non-empty string or null`, 'invalid_payload');
  }
}

/** One candidate/excluded row of a re-route decision: the exact route, the billing basis its own
 * measured profile publishes (null when this deployment publishes none — absence, never a guess)
 * and the reason it ranked or was kept out, drawn from the closed set the row is FOR. */
function validRerouteRow(row, fieldName, reasons) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    refuse(`${fieldName} must be one row per route`, 'invalid_payload');
  }
  validRerouteRoute(row, fieldName);
  if (!(row.billing === null || row.billing === undefined || SWARM_ROUTE_BILLING_BASES.includes(row.billing))) {
    refuse(`${fieldName} billing must be one of: ${SWARM_ROUTE_BILLING_BASES.join(', ')}`, 'invalid_payload');
  }
  if (!reasons.includes(row.reason)) {
    refuse(`${fieldName} reason must be one of: ${reasons.join(', ')}`, 'invalid_payload');
  }
}

/** The `carry` a re-route decision publishes: what the death left for the successor — the snapshot
 * the coordinator preserved and the predecessor's last pinned checkpoint, either of which may be
 * absent (absence is never invented). */
function validRerouteCarry(carry) {
  if (carry === null || typeof carry !== 'object' || Array.isArray(carry)) {
    refuse('swarm.reroute_proposed requires carry {snapshotSha, checkpoint}', 'invalid_payload');
  }
  if (carry.snapshotSha !== null && carry.snapshotSha !== undefined && !isNonEmptyString(carry.snapshotSha)) {
    refuse('carry snapshotSha must be a non-empty string or null', 'invalid_payload');
  }
  const checkpoint = carry.checkpoint ?? null;
  if (checkpoint !== null) {
    if (typeof checkpoint !== 'object' || Array.isArray(checkpoint) || !isNonEmptyString(checkpoint.sha)) {
      refuse('carry checkpoint must be null or {sha, ref}', 'invalid_payload');
    }
    validOptionalNonEmptyString(checkpoint.ref, 'carry checkpoint ref', refuse);
  }
}

/** One candidate/excluded row as the FOLD keeps it: the exact route, the billing basis the route's
 * own measured profile publishes (null when this deployment publishes none), the reason it ranked
 * or was kept out, the live state and reset the decision read, and the measured profile it was
 * ranked on — the same facts the decision was made from, so a reader audits the ranking instead of
 * trusting it. */
function rerouteRowShape(row) {
  return Object.freeze({
    harness: row.harness, model: row.model, effort: row.effort ?? null,
    billing: row.billing ?? null,
    reason: row.reason,
    state: row.state ?? null,
    resetAt: row.resetAt ?? null,
    profile: row.profile === undefined || row.profile === null ? null : Object.freeze({ ...row.profile }),
  });
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

// Preserve the durable key format for swarm-wide context.
export function swarmContextKey(key) {
  return JSON.stringify([null, key]);
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
    swarmId, purpose, status: 'open', ...meta,
    participants: nullDict(), work: nullDict(),
    assignments: nullDict(), context: nullDict(), contributions: nullDict(), reviews: nullDict(),
    claims: nullDict(),
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
    if (p.policy !== undefined) {
      if (p.policy === null || typeof p.policy !== 'object' || Array.isArray(p.policy)
        || Object.keys(p.policy).some((field) => !SWARM_POLICY_FIELDS.includes(field))) {
        refuse('swarm.created policy must name the provider-fault policy fields', 'invalid_payload');
      }
      if (p.policy.rerouteOnProviderFault !== undefined && !SWARM_REROUTE_MODES.includes(p.policy.rerouteOnProviderFault)) {
        refuse(`rerouteOnProviderFault must be one of: ${SWARM_REROUTE_MODES.join(', ')}`, 'invalid_payload');
      }
      if (p.policy.reroutePreferApi !== undefined && typeof p.policy.reroutePreferApi !== 'boolean') {
        refuse('reroutePreferApi must be a boolean', 'invalid_payload');
      }
    }
    return;
  }
  if (kind === 'swarm.participant_joined') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.participant_joined requires participantId', 'invalid_payload');
    validOptionalNonEmptyString(p.role, 'participant role', refuse);
    validOptionalNonEmptyString(p.parentId, 'participant parentId', refuse);
    // The physical checkout this participant deliberately shares with others, when it was
    // recruited into one. A durable organizational record, never custody: whether the checkout
    // may close is decided by the controller's live handles, not by swarm membership.
    if (p.workspaceId !== undefined && !isPhysicalWorkspaceId(p.workspaceId)) {
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
    if (p.workspaceId !== undefined && !isPhysicalWorkspaceId(p.workspaceId)) {
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
    // Issue #490: the Run the leave SETTLES, when the seat is being withdrawn rather than reported
    // gone. Optional, so every leave recorded before the field existed folds identically.
    validOptionalNonEmptyString(p.runId, 'left runId', refuse);
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
    // docs/47 §5 (#441): the `scope:` namespace belongs to the claim one seat's declared recruit
    // scope is recorded under — spelled `scope:<the seat that holds it>`, written by the recruit
    // effect when the seat binds, never by hand. An id in the namespace naming anybody else could
    // never be admitted: the fold reads the namespace to know the scope claim, the one row the
    // conflict rule exempts, so a hand-written hold must not wear the exemption.
    if (isScopeClaimId(p.claimId) && p.claimId !== scopeClaimId(p.participantId)) {
      refuse(`claim id '${p.claimId}' is in the reserved scope-claim namespace: a scope claim is spelled ${scopeClaimId(p.participantId)}, held by the seat it names — written by the recruit effect, never by hand`, 'invalid_payload');
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

  if (kind === 'workspace.carried_from') {
    if (!isNonEmptyString(p.participantId)) refuse('workspace.carried_from requires participantId', 'invalid_payload');
    if (!isPhysicalWorkspaceId(p.workspaceId)) refuse('workspace.carried_from requires a valid workspaceId', 'invalid_payload');
    if (!isNonEmptyString(p.predecessor)) refuse('workspace.carried_from requires predecessor', 'invalid_payload');

    // Issue #453: a carry is a FACT or a REFUSAL. `how` is the closed outcome (SWARM_CARRY_HOW),
    // absent only on a row recorded before #453 (it folds as null — "not recorded", never an
    // invented fact); a `skipped` carry must say why, and a carry that happened carries no reason.
    if (p.how !== undefined && p.how !== null && !SWARM_CARRY_HOW.includes(p.how)) {
      refuse(`workspace.carried_from how must be one of ${SWARM_CARRY_HOW.join(', ')}`, 'invalid_payload');
    }
    const reason = p.reason ?? null;
    if (p.how === 'skipped') {
      if (reason === null || typeof reason !== 'object' || Array.isArray(reason)) {
        refuse('workspace.carried_from requires a reason for a skipped carry', 'invalid_payload');
      }
      if (Array.isArray(reason.missing)) {
        if (reason.missing.length === 0 || !reason.missing.every(isNonEmptyString)
          || reason.error !== undefined) {
          refuse('workspace.carried_from reason {missing} must name the inputs the carry lacked',
            'invalid_payload');
        }
      } else if (!isNonEmptyString(reason.error)) {
        refuse('workspace.carried_from reason must be {missing: [...]} or {error: <text>}',
          'invalid_payload');
      }
    } else if (reason !== null && reason !== undefined) {
      refuse('workspace.carried_from reason belongs to a skipped carry only', 'invalid_payload');
    }
    if (!Array.isArray(p.paths) || !p.paths.every(isNonEmptyString)) {
      refuse('workspace.carried_from requires paths as an array of non-empty strings', 'invalid_payload');
    }
    if (p.snapshotSha !== undefined && p.snapshotSha !== null && !isNonEmptyString(p.snapshotSha)) {
      refuse('workspace.carried_from snapshotSha must be a non-empty string or null', 'invalid_payload');
    }
    return;
  }

  if (kind === 'swarm.reroute_proposed') {
    // Issue #443: the decision the provider-fault observation records. Shape only — who may WRITE
    // it is the command surface's business (the kind is not in the caller-submittable set), while
    // everything a reader acts on is judged here: the seat, the route the fault took down, the
    // ranked candidates, the routes kept out with their reason, and what the death left to carry.
    if (!isNonEmptyString(p.participantId)) {
      refuse('swarm.reroute_proposed requires participantId — the seat whose work must move', 'invalid_payload');
    }
    if (!isNonEmptyString(p.workerId)) {
      refuse('swarm.reroute_proposed requires workerId — the worker its provider killed', 'invalid_payload');
    }
    validRerouteRoute(p.from, 'swarm.reroute_proposed from');
    if (!isNonEmptyString(p.code)) {
      refuse('swarm.reroute_proposed requires code — the typed provider fault class', 'invalid_payload');
    }
    if (p.resetAt !== null && p.resetAt !== undefined
      && !(isNonEmptyString(p.resetAt) && Number.isFinite(Date.parse(p.resetAt)))) {
      refuse('swarm.reroute_proposed resetAt must be an ISO-8601 instant or null', 'invalid_payload');
    }
    validOptionalNonEmptyString(p.resetAtText, 'reroute resetAtText', refuse);
    if (!SWARM_REROUTE_MODES.includes(p.policy)) {
      refuse(`swarm.reroute_proposed policy must be one of: ${SWARM_REROUTE_MODES.join(', ')}`, 'invalid_payload');
    }
    if (!Array.isArray(p.candidates)) {
      refuse('swarm.reroute_proposed requires candidates as an array (empty is a decision)', 'invalid_payload');
    }
    for (const row of p.candidates) {
      validRerouteRow(row, 'reroute candidate', SWARM_REROUTE_CANDIDATE_REASONS);
    }
    if (p.excluded !== undefined) {
      if (!Array.isArray(p.excluded)) refuse('reroute excluded rows must be an array', 'invalid_payload');
      for (const row of p.excluded) {
        validRerouteRow(row, 'reroute excluded row', SWARM_REROUTE_EXCLUDED_REASONS);
        if (row.resetAt !== null && row.resetAt !== undefined
          && !(isNonEmptyString(row.resetAt) && Number.isFinite(Date.parse(row.resetAt)))) {
          refuse('reroute excluded row resetAt must be an ISO-8601 instant or null', 'invalid_payload');
        }
      }
    }
    validRerouteCarry(p.carry);
    return;
  }

  if (kind === 'swarm.rerouted') {
    // Issue #443: the performed re-route. It names the successor it bound, the predecessor it
    // continues, both routes, and the proposal it answers (the fold checks that the predecessor
    // really carries that proposal).
    for (const field of ['successor', 'carriedFrom']) {
      if (!isNonEmptyString(p[field])) {
        refuse(`swarm.rerouted requires ${field}`, 'invalid_payload');
      }
    }
    validRerouteRoute(p.from, 'swarm.rerouted from');
    validRerouteRoute(p.to, 'swarm.rerouted to');
    if (!Number.isSafeInteger(p.proposalSeq) || p.proposalSeq < 0) {
      refuse('swarm.rerouted requires proposalSeq — the seq of the proposal it answers', 'invalid_payload');
    }
    return;
  }

  if (kind === 'swarm.resume_decision_requested') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.resume_decision_requested requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.predecessor)) refuse('swarm.resume_decision_requested requires predecessor', 'invalid_payload');
    if (p.carry === undefined || p.carry === null || typeof p.carry !== 'object' || Array.isArray(p.carry)) {
      refuse('swarm.resume_decision_requested requires carry', 'invalid_payload');
    }
    // Issue #525 D3: the deferred half of the recruit — the run's admitted options and the
    // context package the successor was recruited with — is recorded WITH the question, because
    // the answer performs the start long after the recruit's own arguments are gone. Absent on a
    // row recorded before this field existed, and the deferred start then runs on the defaults.
    if (p.plan !== undefined && p.plan !== null) {
      if (typeof p.plan !== 'object' || Array.isArray(p.plan)) {
        refuse('swarm.resume_decision_requested plan must be an object or null', 'invalid_payload');
      }
      if (p.plan.options !== undefined && p.plan.options !== null
        && (typeof p.plan.options !== 'object' || Array.isArray(p.plan.options))) {
        refuse('swarm.resume_decision_requested plan.options must be an object or null', 'invalid_payload');
      }
      const contextPackage = p.plan.contextPackage ?? null;
      if (contextPackage !== null
        && (typeof contextPackage !== 'object' || Array.isArray(contextPackage)
          || !isNonEmptyString(contextPackage.digest))) {
        refuse('swarm.resume_decision_requested plan.contextPackage must name a digest', 'invalid_payload');
      }
    }
    return;
  }

  if (kind === 'swarm.resume_decision_answered') {
    if (!isNonEmptyString(p.participantId)) refuse('swarm.resume_decision_answered requires participantId', 'invalid_payload');
    if (!isNonEmptyString(p.predecessor)) refuse('swarm.resume_decision_answered requires predecessor', 'invalid_payload');
    if (p.guidance === undefined || p.guidance === null || typeof p.guidance !== 'object') {
      refuse('swarm.resume_decision_answered requires guidance', 'invalid_payload');
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
    if (p.workspaceId !== undefined && !isPhysicalWorkspaceId(p.workspaceId)) {
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
    // Issue #562: the paths the landing took out of the squash because the lane's base — the
    // deployment's own effective-tree snapshot — carried them. Optional: a landing that excluded
    // nothing writes no field, so every receipt recorded before this reads byte-identically.
    if (p.inherited !== undefined
      && (!Array.isArray(p.inherited) || p.inherited.some((path) => !isNonEmptyString(path)))) {
      refuse('swarm.contribution_integrated inherited must be an array of paths', 'invalid_payload');
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
 * rows one admission is minting.
 *
 * docs/47 §5 (#441 item 3): a SCOPE claim — the claim one seat's declared recruit scope is
 * recorded under — is the ground the root recruited that seat onto, not a hold the seat took to
 * fence a peer out. Scopes overlap LEGALLY (docs/45 §2), so a scope claim is neither judged by
 * this rule nor a conflict source for another seat's hold: a recruit whose scope meets an active
 * claim is admitted and its brief names the overlap instead (the `## Claims` block), and a peer's
 * claim inside the scope is admitted the same way. The refusal stays for the holds two seats
 * actually take. */
function claimConflictFor(rows, { claimId, participantId, workspaceId, paths }) {
  if (workspaceId === null || !Array.isArray(paths) || paths.length === 0) return null;
  if (claimId === scopeClaimId(participantId)) return null;
  for (const row of rows) {
    if (row.status !== 'active' || row.claimId === claimId || row.participantId === participantId) continue;
    if (row.claimId === scopeClaimId(row.participantId)) continue;
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

/** Issue #464: the participant row's role budget. A row carries the objective's FIRST LINE, never
 * the objective itself: the whole text stays on the `swarm.participant_joined` row this fold
 * consumed, so the row NAMES it (`roleRef`) and reports the length a reader did not get
 * (`roleBytes`). ONE derivation for every surface — the view row, `run.peers.read`, the recruit
 * brief's situation line (`_composeRecruitBrief` renders each peer's role) and the checkpoint all
 * read THIS row — which is what bounds the quadratic cost the issue measured: every later seat's
 * brief carries each peer's role line, so a 36-seat roster costs 36 × 35 role lines and the
 * `view.role.head` row is derived from exactly that composition. */
function participantRole(role, seq) {
  if (typeof role !== 'string' || role.length === 0) return { role: null, roleBytes: 0, roleRef: null };
  const newline = role.indexOf('\n');
  const line = newline === -1 ? role : role.slice(0, newline);
  return {
    role: headBytes(line, FRAME_LIMITS['view.role.head'].value),
    roleBytes: Buffer.byteLength(role, 'utf8'),
    roleRef: Object.freeze({ kind: 'swarm.participant_joined', seq }),
  };
}

/** Issue #464 (the THIRD half of the issue — the brief's reach): the caller-INDEPENDENT half of a
 * participant row's brief reach, minted once at the join that wrote the text. `briefBytes` is the
 * composed brief's length and `briefRef` names the `swarm.participant_joined` row that holds the
 * text — the same pair of facts `roleBytes`/`roleRef` carry for the objective's first line above,
 * in the same spelling, so a projection that carries the reach and not the text NAMES where the
 * text is. The reach's other half — the CALLER's exposure class — is a fact of the READER, never
 * of the seat: it is derived at projection time (swarm-runtime.mjs `_briefExposure`) and composed
 * onto these facts there, so the two make ONE reach and no surface mints a second one. A join that
 * carried no text reads bytes 0 / ref null — recorded absence, never a pointer at a row that holds
 * nothing. */
function participantBriefReach(brief, seq) {
  if (typeof brief !== 'string' || brief.length === 0) return { briefBytes: 0, briefRef: null };
  return { briefBytes: Buffer.byteLength(brief, 'utf8'), briefRef: Object.freeze({ kind: 'swarm.participant_joined', seq }) };
}

/** The largest prefix of `text` that is at most `cap` UTF-8 bytes, cut on a code-point boundary:
 * a role line is never a broken code point (the discipline the bridge's bounded text keeps). */
function headBytes(text, cap) {
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  const bytes = Buffer.from(text, 'utf8');
  let end = cap;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

// `admission` marks a prospective row being judged BEFORE it is written; rows read back from the
// ledger fold without it. State-dependent claim admission uses the current recorded checkout.
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
    swarms.set(p.swarmId, Object.freeze({ ...row,
      ...(p.baseCommit === undefined ? {} : { baseCommit: p.baseCommit }),
      ...(p.policy === undefined ? {} : { policy: Object.freeze({ ...p.policy }) }),
    }));
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
      participantId: p.participantId, ...participantRole(p.role, meta.seq), parentId: p.parentId ?? null,
      runId: p.runId ?? null, permissions: p.permissions ? Object.freeze([...p.permissions]) : null,
      workspaceId: p.workspaceId ?? null,
      // The route and scope this seat was RECRUITED under, carried by the join itself: the view
      // projects them, so an orchestrator reading a member knows what it was started as without
      // consulting a live worker that may since have been rebound or stopped.
      route: p.route === undefined || p.route === null ? null
        : Object.freeze({ harness: p.route.harness, model: p.route.model, effort: p.route.effort ?? null }),
      scope: p.scope === undefined || p.scope === null ? null : Object.freeze([...p.scope]),
      resumeFrom: p.resumeFrom ?? null,
      // Issue #529 (docs/54 §4.1): the wake narrowing the seat was recruited with. It rides the
      // join (validated against the wake stream's closed class set before the row was written) and
      // is read at bridge-issue time, where the session's auto-subscription is configured. A join
      // that declared none writes no field, exactly as the #373 mode does — every recorded join
      // that predates the narrowing reads identically, so a replay of old history folds to the
      // same projection it did before.
      ...(p.autoWake === undefined || p.autoWake === null ? {} : {
        autoWake: Object.freeze({
          kinds: p.autoWake.kinds === undefined || p.autoWake.kinds === null
            ? null : Object.freeze([...p.autoWake.kinds]),
          participants: p.autoWake.participants === undefined || p.autoWake.participants === null
            ? null : Object.freeze([...p.autoWake.participants]),
        }),
      }),
      brief: p.brief ?? null,
      // Issue #464: the brief's caller-independent reach (see participantBriefReach above) — the
      // length and the ledger row, never the text again.
      ...participantBriefReach(p.brief, meta.seq),
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
      ...(p.brief !== undefined && p.brief !== null ? {
        brief: p.brief,
        ...participantBriefReach(p.brief, meta.seq),
      } : {}),
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
    // Issue #490: a leave that names the Run it settles is the recruit rollback's OWN settlement —
    // the withdrawn attempt's Run stops with this refusal as its terminal cause, and the seat's
    // projection carries it (`settledRun {runId, terminalCause {code, at}}`), so a reader sees
    // WHICH Run was closed, why, and when, without a second cleanup row. One derivation: this fold,
    // which #350 already settles membership in.
    const updatedParticipant = Object.freeze({
      ...participant, status: 'left', leftReason: p.reason ?? null,
      // The typed admission code a recruit rollback carries (issue #308). Conditional on the
      // payload, so logs written before the field existed replay byte-identically.
      ...(p.code !== undefined ? { leftCode: p.code } : {}),
      ...(p.runId !== undefined ? {
        settledRun: Object.freeze({
          runId: p.runId,
          terminalCause: Object.freeze({ code: p.code ?? null, at: meta.ts }),
        }),
      } : {}),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
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

  if (kind === 'workspace.carried_from') {
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant,
      carriedFrom: Object.freeze({
        workspaceId: p.workspaceId, predecessor: p.predecessor,
        paths: Object.freeze([...p.paths]),
        snapshotSha: p.snapshotSha ?? null,
        // #453: the outcome and, for a skip, why — a pre-#453 row folds null/null, never a guess.
        how: p.how ?? null,
        reason: p.reason === undefined || p.reason === null ? null
          : Object.freeze(Array.isArray(p.reason.missing)
            ? { missing: Object.freeze([...p.reason.missing]) }
            : { error: p.reason.error }),
        seq: meta.seq, ts: meta.ts,
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
      const conflict = claimConflictFor(Object.values(swarm.claims ?? {}), { claimId: p.claimId, participantId, workspaceId, paths });
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

  if (kind === 'swarm.reroute_proposed') {
    // Issue #443: the re-route decision, folded onto the seat whose work must move — the newest
    // fact about its runtime, exactly as #442 folded the fault above it. A later death (a
    // successor that faults too) replaces the row; the ledger keeps every one of them.
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant,
      reroute: Object.freeze({
        workerId: p.workerId,
        from: Object.freeze({
          harness: p.from.harness, model: p.from.model, effort: p.from.effort ?? null,
        }),
        code: p.code,
        resetAt: p.resetAt ?? null,
        resetAtText: p.resetAtText ?? null,
        candidates: Object.freeze(p.candidates.map(rerouteRowShape)),
        excluded: Object.freeze((p.excluded ?? []).map(rerouteRowShape)),
        carry: Object.freeze({
          snapshotSha: p.carry.snapshotSha ?? null,
          checkpoint: p.carry.checkpoint === null || p.carry.checkpoint === undefined
            ? null : Object.freeze({ sha: p.carry.checkpoint.sha, ref: p.carry.checkpoint.ref ?? null }),
        }),
        policy: p.policy,
        // Nothing is decided by the recorded proposal itself: `swarm.rerouted` is what a performed
        // resume folds here, so a pending decision reads null rather than a hopeful guess.
        decision: null,
        // The instant the decision was RECORDED, under the name every surface reads it by (the
        // row's own `ts` stays beside it, exactly as the fault row carries both).
        proposedAt: meta.ts,
        seq: meta.seq, ts: meta.ts,
      }),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.rerouted') {
    // the seat says both what was proposed for it and what the runtime did about it.
    const predecessor = ownGet(swarm.participants, p.carriedFrom);
    if (!predecessor) integrity(`participant ${p.carriedFrom} not found in swarm ${p.swarmId}`, 'participant_not_found');
    // The row answers ONE proposal, and admission re-derives that against the projection the
    // ledger itself reconstructed (the proposal row always precedes it, written in the same
    // observation) — so the rule runs on the APPEND, and a replay of a ledger that carries the
    // performed re-route without its proposal reads the row as the corrupt history it is rather
    // than refusing a resident its own record. Replay never fabricates the missing proposal: the
    // seat keeps the decision its own record carries, and the row still reads on the ledger.
    const answered = predecessor.reroute ?? null;
    if (admission && answered?.seq !== p.proposalSeq) {
      integrity(`swarm.rerouted answers proposal ${p.proposalSeq}, which ${p.carriedFrom} does not carry`,
        'reroute_proposal_mismatch');
    }
    const updatedParticipant = Object.freeze({
      ...predecessor,
      ...(answered === null ? {} : { reroute: Object.freeze({
        ...answered,
        decision: Object.freeze({
          policy: 'auto', successor: p.successor, proposalSeq: p.proposalSeq,
          to: Object.freeze({ harness: p.to.harness, model: p.to.model, effort: p.to.effort ?? null }),
          seq: meta.seq, ts: meta.ts,
        }),
      }) }),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.carriedFrom, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.resume_decision_requested') {
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const updatedParticipant = Object.freeze({
      ...participant,
      resumeDecision: Object.freeze({
        requested: Object.freeze({
          predecessor: p.predecessor,
          carry: Object.freeze({ how: p.carry.how ?? null, workspaceId: p.carry.workspaceId ?? null, snapshotSha: p.carry.snapshotSha ?? null }),
          plan: p.plan === undefined || p.plan === null ? null : Object.freeze({
            options: Object.freeze({ ...(p.plan.options ?? {}) }),
            contextPackage: p.plan.contextPackage === undefined || p.plan.contextPackage === null
              ? null
              : Object.freeze({ digest: p.plan.contextPackage.digest,
                docs: Object.freeze([...(p.plan.contextPackage.docs ?? [])]) }),
          }),
          at: p.at ?? meta.ts,
          seq: meta.seq, ts: meta.ts,
        }),
        answered: null,
      }),
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const parts = new Map(Object.entries(swarm.participants));
    parts.set(p.participantId, updatedParticipant);
    swarms.set(p.swarmId, replaceField(swarm, 'participants', parts));
    return;
  }

  if (kind === 'swarm.resume_decision_answered') {
    const participant = ownGet(swarm.participants, p.participantId);
    if (!participant) integrity(`participant ${p.participantId} not found in swarm ${p.swarmId}`, 'participant_not_found');
    const existing = participant.resumeDecision ?? null;
    const updatedParticipant = Object.freeze({
      ...participant,
      resumeDecision: existing === null ? null : Object.freeze({
        ...existing,
        answered: Object.freeze({
          guidance: Object.freeze({ seq: p.guidance.seq, messageId: p.guidance.messageId ?? null }),
          at: p.at ?? meta.ts,
          seq: meta.seq, ts: meta.ts,
        }),
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
    const ctxKey = swarmContextKey(p.key);
    const existingContext = ownGet(swarm.context, ctxKey) ?? null;
    const currentVersion = existingContext?.version ?? 0;
    if (p.expectedVersion !== undefined && p.expectedVersion !== currentVersion) {
      integrity(`swarm context '${ctxKey}' version conflict: expected ${p.expectedVersion}, current ${currentVersion}`, 'version_conflict');
    }
    const updatedContext = Object.freeze({
      key: p.key, body: deepFreezeBody(p.body), groupId: null,
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
    // descends from. What makes a receipt a LANDING is the commit it records the target holding
    // AFTER it: a rehearsal moves no ref, so its `targetHeadAfter` is null and the real landing that
    // follows supersedes it. `dryRun` is never read here — it is the writer's own claim about the
    // same act, and the schema above admits `dryRun: false` beside a null `targetHeadAfter`, so a
    // receipt the target never moved for must not be able to refuse the landing that moves it.
    // Refusing that landing would make the rehearsal the only receipt the contribution could ever
    // carry, and the target would never receive the change the gate already passed.
    if ((contribution.integration?.targetHeadAfter ?? null) !== null) {
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
      // Issue #562: the paths the landing dropped because the lane's base carried them, kept on the
      // receipt so the exclusion is never a silent one. Absent when the landing excluded nothing.
      ...(Array.isArray(p.inherited) && p.inherited.length > 0
        ? { inherited: Object.freeze([...p.inherited]) } : {}),
      // Issue #254: the ignored additions the landing dropped, kept on the receipt so the
      // exclusion is never a silent one. Absent when the landing filtered nothing.
      ...(Array.isArray(p.debris) && p.debris.length > 0
        ? { debris: Object.freeze([...p.debris]) } : {}),
      issue: p.issue ?? null,
      dryRun: p.dryRun === true,
      actor: meta.actor, seq: meta.seq, ts: meta.ts,
    });
    const contributions = new Map(Object.entries(swarm.contributions));
    contributions.set(p.contributionId, Object.freeze({ ...contribution, integration }));
    swarms.set(p.swarmId, replaceField(swarm, 'contributions', contributions));
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
