import { spawnSync } from 'node:child_process';
import { SWARM_EVENT_KINDS, SWARM_BRIDGE_REFUSAL_COMMAND, SWARM_VIEW_DEFAULT_PROJECTION,
  projectSwarmView, swarmChangedRow, swarmCommandDefinition, swarmReceiptNext,
  validateSwarmCommand } from './swarm-contract.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-order.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_EVENT_EXAMPLES } from './swarm-event-schemas.mjs';
import { foldSwarmEvent, SwarmIntegrityError } from './swarm-state.mjs';
import { workspaceCustodyRecord } from './shared-workspace-custody.mjs';

const clone = (value) => structuredClone(value);
/** JSON-plain content with absent members dropped. An undefined value means "not sent" to the
 * command contract (the validator skips it), so it must not be a canonical-identity error either:
 * the same request hashes the same whether a caller spells an omitted field or leaves it out. */
const definedJson = (value) => {
  // An array's members are positional, so an absent one becomes an explicit null (arity is the
  // contract); an object's members are named, so an absent one simply is not there.
  if (Array.isArray(value)) return value.map((member) => definedJson(member) ?? null);
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined)
    .map(([key, member]) => [key, definedJson(member)]));
};
const hash = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(definedJson(value)))).digest('hex');
const refuse = (message, code, detail = {}) => { throw Object.assign(new Error(message), { code, detail }); };
const childrenByParent = (swarm) => {
  const childrenOf = new Map();
  for (const participant of Object.values(swarm.participants)) {
    if (!participant.parentId) continue;
    if (!childrenOf.has(participant.parentId)) childrenOf.set(participant.parentId, []);
    childrenOf.get(participant.parentId).push(participant.participantId);
  }
  return childrenOf;
};
/** One harness/model/effort route, or null when the value does not name one. Used to record the
 * route a seat was recruited under: an incomplete selector is not a route, and is never padded
 * into one. */
const swarmRouteShape = (value) => (value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.harness === 'string' && value.harness.length > 0
  && typeof value.model === 'string' && value.model.length > 0)
  ? Object.freeze({ harness: value.harness, model: value.model,
    effort: typeof value.effort === 'string' && value.effort.length > 0 ? value.effort : null })
  : null;
// ── repository reads (issue #301) ────────────────────────────────────────────────────────────────
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
/** One read-only git query over a checkout the deployment itself owns, or null when it cannot be
 * answered (no checkout, detached state the query cannot name, git absent). Never mutates, never
 * invents: a null is "observed nothing", which the derivations below surface as absence. */
const gitRead = (args, cwd) => {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  try {
    const ran = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (ran.status !== 0 || typeof ran.stdout !== 'string') return null;
    const out = ran.stdout.trim();
    return out.length > 0 ? out : null;
  } catch { return null; }
};
/** The checkout facts one worker's session context names: the worktree its process runs in and
 * the repository that worktree was created from. A worker without a recorded checkout reads
 * null — absence, never a guess about where its files live. */
const checkoutOf = (worker) => {
  const worktree = worker?.sessionContext?.worktree;
  if (typeof worktree !== 'string' || worktree.length === 0) return null;
  const repoRoot = typeof worker.sessionContext.repoRoot === 'string'
    && worker.sessionContext.repoRoot.length > 0
    ? worker.sessionContext.repoRoot : worktree;
  return { worktree, repoRoot };
};
/** The deployment's target revision name: the branch its own checkout has current — the branch
 * every Baton worktree forks from — or the checkout's own HEAD commit when it is detached. */
const targetRefOf = (repoRoot) => {
  const branch = gitRead(['symbolic-ref', '--short', 'HEAD'], repoRoot);
  return branch ?? 'HEAD';
};
/** A participant's base, derived from the repository at read time (issue #301): the commit its
 * checkout shows, the deployment target that checkout is measured against, and how many target
 * commits the checkout lacks — so drift is visible BEFORE a capture, not discovered after one.
 * Unobservable seats (unbound, no checkout recorded) carry `base: null`. */
const participantBase = (worker) => {
  const checkout = checkoutOf(worker);
  if (!checkout) return null;
  const observedHead = gitRead(['rev-parse', 'HEAD'], checkout.worktree);
  if (!observedHead || !GIT_SHA.test(observedHead)) return null;
  const targetRef = targetRefOf(checkout.repoRoot);
  const targetCommit = gitRead(['rev-parse', targetRef], checkout.repoRoot);
  if (!targetCommit || !GIT_SHA.test(targetCommit)) return null;
  const behind = gitRead(['rev-list', '--count', `${observedHead}..${targetRef}`], checkout.repoRoot);
  return {
    observedHead,
    target: targetRef === 'HEAD' ? targetCommit : targetRef,
    behind: behind === null || !/^\d+$/u.test(behind) ? null : Number(behind),
  };
};
/** The base facts a CAPTURE pins (issue #301): everything `participantBase` reads, plus the
 * merge-base of the observed HEAD with the target — the commit an integration would descend
 * from, recorded on the capture row so it never has to be re-derived later. */
const captureBase = (worker) => {
  const checkout = checkoutOf(worker);
  if (!checkout) return null;
  const observedHead = gitRead(['rev-parse', 'HEAD'], checkout.worktree);
  if (!observedHead || !GIT_SHA.test(observedHead)) return null;
  const targetRef = targetRefOf(checkout.repoRoot);
  const targetCommit = gitRead(['rev-parse', targetRef], checkout.repoRoot);
  if (!targetCommit || !GIT_SHA.test(targetCommit)) {
    return { observedHead, target: null, mergeBase: null };
  }
  const mergeBase = gitRead(['merge-base', observedHead, targetRef], checkout.repoRoot);
  return { observedHead, target: targetRef === 'HEAD' ? targetCommit : targetRef, mergeBase };
};
const _mutationView = (args) => args.view === true || args.view === 'true';
export const SWARM_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute', 'review', 'organize', 'recruit', 'stop']);
const DEFAULT_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute']);
const UPDATE_PERMISSIONS = Object.freeze({
  'swarm.group_updated': 'organize', 'swarm.work_updated': 'organize',
  'swarm.assignment_updated': 'organize', 'swarm.coupling_updated': 'organize',
  'swarm.holder_released': 'organize',
  'swarm.context_updated': 'communicate',
  'swarm.contribution_recorded': 'contribute', 'swarm.contribution_reviewed': 'review',
  'swarm.participant_left': 'organize', 'swarm.closed': 'organize',
});
// The update table is a third parallel table over the closed event vocabulary; the contract
// asserts the other two agree at load, and so must this one — otherwise a new kind is admitted
// by validation and refused here as `swarm_command_unavailable` (2026-09-14 audit S-E10).
if (Object.keys(UPDATE_PERMISSIONS).sort().join('\0') !== [...SWARM_EVENT_KINDS].sort().join('\0')) {
  throw new Error('swarm update permissions disagree with the public swarm.update event set');
}
const COMMAND_PERMISSIONS = Object.freeze({
  'swarm.view': 'read', 'swarm.watch': 'read', 'swarm.recruit': 'recruit',
  'swarm.guide': 'communicate', 'swarm.capture': 'contribute',
  'swarm.check': 'review', 'swarm.stop': 'stop',
});

// ── liveness ─────────────────────────────────────────────────────────────────────────────────────
/** The ONE participant liveness derivation every surface reads (2026-09-14 audit S-F5). A worker
 * status is live or it is not, and "gone" is the COMPLEMENT of that one list — never a second
 * list that can drift from it — while the turn classification hangs off the same predicate. The
 * view derives its `runtime` rows here, the wake feed carries those rows, and the bridge carries
 * them verbatim: one record, one classification, three surfaces that cannot disagree. Exported so
 * a consumer that needs the question answered directly (rather than projected) asks this and not
 * a local copy of the state list. */
export const SWARM_LIVE_RUNTIME_STATES = Object.freeze(['pending', 'working', 'blocked', 'idle', 'stopping']);
/** The state a participant with no current worker binding is in — not a coordinator status. */
export const SWARM_UNBOUND_RUNTIME_STATE = 'unbound';

export function swarmParticipantLiveness(worker, pausedTurns = 0) {
  const state = worker?.status ?? SWARM_UNBOUND_RUNTIME_STATE;
  const live = SWARM_LIVE_RUNTIME_STATES.includes(state);
  // A turn is paused only while the worker that paused it is alive: a dead or exited worker's
  // leftover pause record is history, not a turn a guide could resume.
  return { state, live, turn: live && pausedTurns > 0 ? 'paused' : state === 'working' ? 'running' : null };
}

/** Living collaboration over the existing Run, worker, and coordination authorities.
 * This service owns organization and the user-facing operations. It never infers work
 * completion from a process/turn ending, or session closure from accepting a contribution. */
export class SwarmRuntime {
  constructor({ store, coordinator, authorize, prepareRun = (request) => request, startRun, stopRun }) {
    Object.assign(this, { store, coordinator, authorize, prepareRun, startRun, stopRun });
    this.pending = new Map();
    this.watchController = new AbortController();
  }

  _swarm(id) {
    const swarm = this.store.swarm(id);
    if (!swarm) refuse('Swarm is unavailable', 'swarm_not_found');
    return swarm;
  }

  /** The active participant this principal's worker/run identity names, or null; `scoped` says
   * whether the principal claimed a participant identity at all — an external orchestrator claims
   * none, and its absence is not an error. The ONE resolution authority and refusal attribution
   * share, so "who is this" means the same thing to a permission check and to a refusal row. */
  _memberOf(swarm, principal, context) {
    const workerId = principal.principalId?.startsWith('worker:')
      ? principal.principalId.slice('worker:'.length) : null;
    if (!workerId && !context?.runId) return { scoped: false, participant: null };
    const workerRun = workerId ? this.coordinator.list().find((row) => row.id === workerId)?.runId : null;
    const participant = Object.values(swarm.participants).find((row) => row.status === 'active'
      && ((workerId && row.bindings.at(-1)?.workerId === workerId)
        || (workerRun && row.runId === workerRun)
        || (context?.runId && row.runId === context.runId))) ?? null;
    return { scoped: true, participant };
  }

  _caller(swarm, principal, context) {
    if (context?.swarmId && context.swarmId !== swarm.swarmId) {
      refuse('Native participant authority belongs to another swarm', 'swarm_membership_required');
    }
    const { scoped, participant } = this._memberOf(swarm, principal, context);
    if (scoped && !participant) refuse('This agent has no active membership in the swarm', 'swarm_membership_required');
    return participant;
  }

  _permit(swarm, principal, context, permission) {
    const member = this._caller(swarm, principal, context);
    if (member && !(member.permissions ?? DEFAULT_PERMISSIONS).includes(permission)) {
      refuse(`This swarm has not granted ${permission} authority to this participant`, 'swarm_permission_required', {
        permission, participantId: member.participantId,
      });
    }
    return member;
  }

  /** The permission one swarm.update request requires of THIS caller — the ONE derivation the
   * dispatch check and the view's `updates` rows share, so what a view advertises can never
   * disagree with what dispatch enforces (2026-09-14 audit S-F1). A member's own leave and its
   * own arrival at a declared synchronization point are honest self-reports, and read authority
   * admits them; naming another seat stays an organizing act. With no payload (the view's
   * question: "which kinds may this caller send at all?") the self-scoped reading applies, which
   * is exactly the permission a member's own leave or arrival needs. */
  _updatePermission(event, caller, payload = null) {
    const permission = UPDATE_PERMISSIONS[event] ?? null;
    if (!caller) return permission;
    const own = !payload?.participantId || payload.participantId === caller.participantId;
    if (event === 'swarm.participant_left' && own) return 'read';
    if (event === 'swarm.coupling_updated' && payload?.action === 'arrive' && own) return 'read';
    return permission;
  }

  _participant(swarm, id) {
    const row = Object.hasOwn(swarm.participants, id) ? swarm.participants[id] : null;
    if (!row) refuse('Participant is unavailable in this swarm', 'swarm_participant_not_found');
    return row;
  }

  _worker(participant) {
    const binding = participant.bindings.at(-1);
    const worker = this.coordinator.list().find((row) => row.id === binding?.workerId
      && row.runId === participant.runId);
    if (!worker) refuse('Participant has no current worker binding', 'swarm_participant_unbound', {
      participantId: participant.participantId, runId: participant.runId,
    });
    return worker;
  }

  /** Resolve one participant's live shared checkout, under this swarm's own authority.
   * The named participant is a swarm member — an organizational fact that proves nothing about a
   * process — so the checkout comes from the controller's LIVE attachment for that participant's
   * current worker. An absent, departed, unbound, closing, or log-disagreeing source refuses with
   * a typed code and a reason, and never hands out a checkout by guesswork. */
  _sharedWorkspace(swarm, sourceParticipantId, participantId) {
    const unavailable = (reason, detail = {}) => refuse(
      'The shared checkout is unavailable', 'swarm_workspace_unavailable',
      { reason, participantId: sourceParticipantId, ...detail },
    );
    if (sourceParticipantId === participantId) unavailable('self');
    const source = Object.hasOwn(swarm.participants, sourceParticipantId)
      ? swarm.participants[sourceParticipantId] : null;
    if (!source) unavailable('source_absent');
    if (source.status !== 'active') unavailable('source_left');
    const worker = this.coordinator.list().find(
      (row) => row.id === source.bindings.at(-1)?.workerId && row.runId === source.runId,
    );
    const attachment = worker ? this.coordinator.workspaceAttachment(worker.id) : null;
    if (!attachment) unavailable('holder_not_live');
    // A source that was itself recruited into a workspace must still be in THAT workspace: the
    // recorded workspace is durable organizational memory, and disagreement with the live handle
    // is a refusal rather than a silent hand-off to whatever checkout it moved to.
    if (source.workspaceId && source.workspaceId !== attachment.workspaceId) {
      unavailable('workspace_changed', { recordedWorkspaceId: source.workspaceId });
    }
    return attachment;
  }
  /** Who is acting, in the identity vocabulary of the record: the member's own participant name
   * when a member acts, otherwise the acting principal's label — an external orchestrator has no
   * participant row, and its acts must not land as null (issue #292). One derivation for every
   * attribution the runtime writes (reviewerId, releasedBy), so they can never disagree. */
  _actorOf(caller, principal) {
    return caller?.participantId ?? principal.actor;
  }

  _write(kind, payload, principal, key) {
    return this.store.recordSwarm(kind, payload, { actor: principal.actor, key });
  }
  /** The receipt envelope every mutation answers with (issue #302): the FIRST event this attempt
   * recorded — {kind, seq, ts, actor} — the swarm rows it changed, and `next`, the step that
   * follows. The whole refreshed view rides the answer only when the caller asked for it
   * (`view: true`; the CLI's flag grammar spells it `--view true`). A `_once` command replays the
   * recorded result, whose writes carry the ORIGINAL events, so a replayed receipt is the receipt
   * the first attempt answered with — idempotency holds for the answer, not only the effect. */
  _mutationResult(command, args, writes, principal, context, extra = {}) {
    const recorded = writes.filter((write) => write && typeof write.seq === 'number');
    if (recorded.length === 0) {
      // A mutation whose effect wrote no swarm event of its own (a stop, a guide that never
      // reached the receipted lane) still has one durable row that proves it: the operation
      // terminal row the lane recorded for this exact attempt.
      const completed = this.store.priorCoordinationEvent(`${this._operationKey(command, args, principal)}:completed`);
      if (completed) {
        recorded.push({ kind: completed.payload?.kind ?? 'swarm.operation_completed',
          seq: completed.seq, ts: completed.ts, actor: completed.actor });
      }
    }
    const first = recorded[0] ?? null;
    const changed = new Map();
    for (const write of recorded) {
      const row = swarmChangedRow(write.kind, write.payload ?? {});
      if (!row || row.id === null || row.id === undefined) continue;
      // Same row written twice by one mutation (a join followed by its binding): the LAST write
      // is the state the row carries now.
      changed.set(`${row.collection}\0${row.id}`, { ...row, seq: write.seq, ts: write.ts });
    }
    const envelope = {
      receipt: {
        command,
        event: first ? { kind: first.kind, seq: first.seq, ts: first.ts, actor: first.actor } : null,
        changed: [...changed.values()].sort((a, b) => a.collection.localeCompare(b.collection)
          || String(a.id).localeCompare(String(b.id))),
      },
      next: swarmReceiptNext(command, args),
      ...extra,
    };
    if (_mutationView(args)) envelope.view = this.inspect(this._swarm(args.swarmId), principal, context);
    return envelope;
  }

  /** The advisory scope-overlap rows one requested scope raises (issue #301): every ACTIVE
    * participant across the repository's swarms whose declared scope shares paths with the
    * requested one, named with its swarm and the overlapping paths. Advisory — a row informs the
    * recruiter, it never refuses; two seats may share a scope on purpose. */
  _scopeOverlap(requestedScope) {
    const requested = new Set(requestedScope);
    const rows = [];
    for (const swarm of this.store.swarms()) {
      for (const participant of Object.values(swarm.participants)) {
        if (participant.status !== 'active' || !Array.isArray(participant.scope)) continue;
        const paths = [...new Set(participant.scope.filter((path) => requested.has(path)))].sort();
        if (paths.length > 0) {
          rows.push({ swarmId: swarm.swarmId, participantId: participant.participantId, paths });
        }
      }
    }
    return rows.sort((a, b) => a.swarmId.localeCompare(b.swarmId)
      || a.participantId.localeCompare(b.participantId));
  }

  _operationKey(command, args, principal) {
    return `swarm-operation:${hash([command, args.swarmId, principal.principalId, args.idempotencyKey])}`;
  }

  async _once(command, args, principal, effect, { replaySafe = false, basis = null, context = null } = {}) {
    const key = this._operationKey(command, args, principal);
    const requestDigest = hash(args);
    // The seat every row this operation writes belongs to, resolved through the same authority the
    // command uses (issue #283): a refusal row and the terminal row that clears it must agree on
    // WHOSE operation it was, or "my last refusal was cleared" could never be derived.
    const participantId = this._attributedParticipant(args.swarmId, principal, context);
    const requested = this.store.priorCoordinationEvent(key);
    if (requested && requested.payload.requestDigest !== requestDigest) {
      refuse('Swarm operation identity already names another request', 'swarm_replay_conflict');
    }
    const completed = this.store.priorCoordinationEvent(`${key}:completed`);
    if (completed) return clone(completed.payload.result);
    if (this.pending.has(key)) return this.pending.get(key);
    if (requested && !replaySafe) {
      refuse('This operation was already attempted and its outcome is unconfirmed: repeating it under the SAME idempotencyKey needs reconciliation, and only swarm.recruit and swarm.holder_released replay under their key — make a NEW attempt under a NEW idempotencyKey',
        'swarm_operation_unconfirmed', {
          command, operationKey: key,
        });
    }
    // The request rides its digest, never its body (issue #308): an in-flight operation row names
    // the command, the seat and the digest, so the text of somebody's private guide or the
    // objective of a refused recruit is not durable attention content.
    if (!requested) this.store.recordDriver('swarm.operation_requested', {
      swarmId: args.swarmId, command, requestDigest, basis: clone(basis), participantId,
    }, { actor: principal.actor, key });
    const operation = Promise.resolve().then(() => effect(clone(requested?.payload.basis ?? basis))).then((result) => {
      this.store.recordDriver('swarm.operation_completed', {
        swarmId: args.swarmId, command, operationKey: key, participantId, result: clone(result),
      }, { actor: principal.actor, key: `${key}:completed` });
      return result;
    }).catch((error) => {
      this.store.recordDriver('swarm.operation_unavailable', {
        swarmId: args.swarmId, command, operationKey: key, participantId,
        code: error.code ?? 'swarm_operation_unavailable',
      }, { actor: principal.actor, key: `${key}:unavailable` });
      throw error;
    });
    this.pending.set(key, operation);
    try { return await operation; }
    finally { this.pending.delete(key); }
  }

  /** The participant's current worker, or null when unbound — the ONE lookup inspect and the
   * holder-release eligibility check share, so "gone" means the same thing everywhere. */
  _workerFor(participant, workers) {
    return workers.find((row) => row.runId === participant.runId
      && (!participant.bindings.length || row.id === participant.bindings.at(-1)?.workerId)) ?? null;
  }

  /** One contribution is accepted evidence when a review accepts it and no LATER review on the
   * same contribution rejects it: reviews append in log order, so append order is review order. */
  _acceptedContribution(swarm, contributionId) {
    const reviews = swarm.reviews?.[contributionId] ?? [];
    const lastIndex = (decision) => reviews.map((review) => review.decision).lastIndexOf(decision);
    const accept = lastIndex('accept');
    return accept >= 0 && accept > lastIndex('reject');
  }

  /** Evidence per work item (issue #263 item 1): the contributions that reference the work via
   * workId, the subset carrying an unrevoked accept, and whether completion derives from them. */
  _workEvidence(swarm) {
    const byWork = new Map();
    for (const contribution of Object.values(swarm.contributions ?? {})) {
      if (!contribution.workId) continue;
      if (!byWork.has(contribution.workId)) byWork.set(contribution.workId, []);
      byWork.get(contribution.workId).push(contribution.contributionId);
    }
    return (workId) => {
      const contributions = (byWork.get(workId) ?? []).sort();
      const accepted = contributions.filter((id) => this._acceptedContribution(swarm, id));
      return { contributions, accepted, derivedComplete: accepted.length > 0 };
    };
  }

  /** The participant plus every descendant transitively by parentId — the scope one name covers. */
  _subtreeOf(swarm, rootId) {
    const childrenOf = childrenByParent(swarm);
    const children = (id) => (childrenOf.get(id) ?? []).sort();
    const seen = new Set();
    const queue = children(rootId);
    while (queue.length) {
      const current = queue.shift();
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...children(current));
    }
    return [rootId, ...[...seen].sort()];
  }

  /** Delegation truth per participant (issue #263 item 1): the direct children, the work actively
   * assigned within the participant's subtree, and whether that delegation is complete — every
   * assigned work item completed, and every still-active child either done (it holds no active
   * assignment) or departed (its membership ended). A live child still holding a seat keeps the
   * delegation open; releasing its seats (swarm.holder_released) is what closes it.
   *
   * `complete` is derived only where work exists (2026-09-14 audit, swarm-b/lead.md finding 9):
   * with nothing assigned in the subtree the `every` predicates were vacuously true, so an idle
   * participant read as a completed delegation. An empty delegation is underived — null — and only
   * an assignment with a completion observation may close it. */
  _delegations(swarm) {
    const childrenOf = childrenByParent(swarm);
    const children = (id) => (childrenOf.get(id) ?? []).sort();
    const activeWorkByHolder = new Map();
    for (const assignment of Object.values(swarm.assignments ?? {})) {
      if (assignment.status !== 'active') continue;
      if (!activeWorkByHolder.has(assignment.participantId)) activeWorkByHolder.set(assignment.participantId, new Set());
      activeWorkByHolder.get(assignment.participantId).add(assignment.workId);
    }
    const delegations = new Map();
    for (const participant of Object.values(swarm.participants)) {
      const subtree = this._subtreeOf(swarm, participant.participantId);
      const work = [...new Set(subtree.flatMap((id) => [...(activeWorkByHolder.get(id) ?? [])]))].sort();
      const directs = children(participant.participantId);
      delegations.set(participant.participantId, {
        children: directs,
        work,
        complete: work.length === 0 ? null
          : work.every((workId) => swarm.work?.[workId]?.status === 'completed')
            && directs.every((childId) => swarm.participants[childId].status !== 'active'
              || !activeWorkByHolder.has(childId)),
      });
    }
    return delegations;
  }

  inspect(swarm, principal, context, scopeId = null, projection = SWARM_VIEW_DEFAULT_PROJECTION) {
    const caller = this._permit(swarm, principal, context, 'read');
    // An optional participantId scopes the read to that participant's delegation (issue #263
    // item 3): its subtree, the work actively assigned within, their contributions and reviews.
    // A scoped view is the swarm AS THAT PARTICIPANT SEES IT (issue #283): its own brief and no
    // other participant's, the records whose roster intersects its subtree, and the attention rows
    // its subtree can act on.
    const scope = scopeId ? this._participant(swarm, scopeId) : null;
    const scopeSubtree = scope ? this._subtreeOf(swarm, scope.participantId) : null;
    const scopeWorkIds = scope ? new Set(Object.values(swarm.assignments ?? {})
      .filter((assignment) => assignment.status === 'active' && scopeSubtree.includes(assignment.participantId))
      .map((assignment) => assignment.workId)) : null;
    const permissions = caller?.permissions ?? (caller ? DEFAULT_PERMISSIONS : SWARM_PERMISSIONS);
    const workers = this.coordinator.list();
    const ledger = this.store.eventsView();
    const delegations = this._delegations(swarm);
    const evidenceFor = this._workEvidence(swarm);
    // Guidance projection: the nudges addressed to each worker, read from the message.sent
    // lane receipts the delivery path already records. The view mints nothing of its own.
    const guidanceByWorker = new Map();
    for (const event of ledger) {
      if (event.kind !== 'message.sent' || event.payload?.kind !== 'nudge') continue;
      const workerId = event.payload?.to?.workerId;
      if (!workerId) continue;
      if (!guidanceByWorker.has(workerId)) guidanceByWorker.set(workerId, []);
      guidanceByWorker.get(workerId).push({
        seq: event.seq, ts: event.ts, from: event.payload.from ?? null, messageId: event.payload.messageId ?? null,
      });
    }
    // The participant's last refusal the operation lane has not cleared (issue #283 root comment
    // 2): the LATEST refusal naming this seat, unless a later operation of the SAME command by the
    // same seat COMPLETED. Both facts are read from the one durable lane the runtime writes.
    const refusals = new Map();
    const completions = new Map();
    for (const event of ledger) {
      const payload = event.kind === 'driver.recorded' ? event.payload : null;
      if (payload?.swarmId !== swarm.swarmId || typeof payload.participantId !== 'string') continue;
      if (payload.kind === 'swarm.operation_refused') {
        refusals.set(payload.participantId, {
          seq: event.seq, command: payload.command ?? null, code: payload.code ?? null, field: payload.field ?? null,
        });
      } else if (payload.kind === 'swarm.operation_completed') {
        if (!completions.has(payload.participantId)) completions.set(payload.participantId, new Map());
        const perSeat = completions.get(payload.participantId);
        perSeat.set(payload.command, Math.max(perSeat.get(payload.command) ?? 0, event.seq));
      }
    }
    const lastRefusal = (participantId) => {
      const refusal = refusals.get(participantId);
      if (!refusal) return null;
      return (completions.get(participantId)?.get(refusal.command) ?? 0) > refusal.seq ? null : refusal;
    };
    const participants = Object.values(swarm.participants).map((participant) => {
      const worker = this._workerFor(participant, workers);
      const paused = worker ? this.coordinator.pausedTurns({ workerId: worker.id }) : [];
      // The ONE liveness derivation (swarmParticipantLiveness): state, turn and "is this seat
      // alive at all" come from it, so the view, the wake feed and the bridge agree by
      // construction rather than by three copies of a status list.
      const liveness = swarmParticipantLiveness(worker, paused.length);
      const alive = liveness.live;
      // The participant's live checkout, projected exactly as capture projects its custody:
      // the physical owner named by the live worker's session context and the coordinator's
      // live holder count for it. An unbound or departed worker carries workspace: null.
      const physicalOwnerId = alive ? worker.sessionContext?.ownerTaskId ?? null : null;
      return { ...clone(participant), delegation: delegations.get(participant.participantId) ?? null,
        // Absence is labelled as absence (2026-09-14 audit, swarm-b/lead.md finding 9): an unbound
        // participant, or a coordinator that cannot answer for native observations at all, has
        // observed nothing. The old shape published `observed_only` beside empty arrays — a claim
        // that Baton looked and found no native collaboration. The arrays stay for a stable row
        // shape; `coverage` carries the truth, and only a real observation may claim it.
        native: worker && this.coordinator.observedNativeSubagents
        ? this.coordinator.observedNativeSubagents(worker.id)
        : { coverage: 'unobserved', agents: [], invocations: [], unidentified: [] },
        runtime: { workerId: worker?.id ?? null, state: liveness.state, turn: liveness.turn, live: liveness.live },
        guidance: worker ? (guidanceByWorker.get(worker.id) ?? []) : [],
        workspace: physicalOwnerId !== null
          ? workspaceCustodyRecord(physicalOwnerId, this.coordinator.liveWorkspaceHolders(physicalOwnerId).length)
          : null,
        // Drift before capture (issue #301): the base this seat's checkout shows against the
        // deployment's target, derived from the repository at read time. A seat with no checkout
        // to observe carries base: null — absence, never a guess.
        base: participantBase(worker),
        lastRefusal: lastRefusal(participant.participantId) };
    });
    // Organization truth an orchestrator would otherwise assemble by hand: members whose process
    // is gone, sessions that outlived their membership, delegations whose parent is gone, work
    // still assigned to a participant who cannot do it, and a closed swarm that still runs.
    // A row naming a recoverable holder carries the release operation as its next step.
    const organization = [];
    // "Gone" is the COMPLEMENT of the one liveness predicate, never a second list: a membership
    // that ended, or a runtime that is not live, is gone — including a session that is stopping,
    // which is still a session somebody owns (2026-09-14 audit S-F5).
    const gone = (row) => row.status !== 'active' || !row.runtime.live;
    // Session ownership after a member leaves (issue #263 item 3): a still-running session
    // belongs to its recruiter — the nearest LIVING ancestor by parentId — and otherwise to the
    // swarm's creator. The attention row names that party and the operation that reclaims the
    // session, so "member left, session live" always says who must act.
    const participantsById = new Map(participants.map((row) => [row.participantId, row]));
    const responsibleFor = (row) => {
      let candidate = row.parentId ? participantsById.get(row.parentId) : null;
      while (candidate) {
        if (candidate.status === 'active') {
          return { responsibleParticipant: candidate.participantId, responsibleActor: null };
        }
        candidate = candidate.parentId ? participantsById.get(candidate.parentId) : null;
      }
      return { responsibleParticipant: null, responsibleActor: swarm.actor ?? null };
    };
    for (const row of participants) {
      // A worker that exists and is not live is dead or exited. A seat with NO worker at all is
      // unbound — between its join and its first binding, or after a restart — which is absence,
      // not a dead runtime, and never raises this row.
      if (row.status === 'active' && !row.runtime.live && row.runtime.workerId !== null) {
        organization.push({ kind: 'participant_runtime_dead', participantId: row.participantId, state: row.runtime.state });
      }
      if (row.status !== 'active' && row.runtime.live) {
        organization.push({ kind: 'member_left_session_live', participantId: row.participantId, workerId: row.runtime.workerId,
          ...responsibleFor(row),
          next: { command: 'swarm.stop', swarmId: swarm.swarmId, participantId: row.participantId } });
      }
      if (row.parentId && row.status === 'active') {
        const parent = participants.find((candidate) => candidate.participantId === row.parentId);
        if (!parent || gone(parent)) {
          organization.push({ kind: 'delegation_orphaned', participantId: row.participantId, parentId: row.parentId,
            next: { event: 'swarm.holder_released', participantId: row.parentId } });
        }
      }
    }
    for (const assignment of Object.values(swarm.assignments ?? {})) {
      if (assignment.status !== 'active') continue;
      const holder = participants.find((row) => row.participantId === assignment.participantId);
      if (!holder || gone(holder)) {
        organization.push({ kind: 'assignment_holder_gone', assignmentId: assignment.assignmentId,
          participantId: assignment.participantId, workId: assignment.workId,
          next: { event: 'swarm.holder_released', participantId: assignment.participantId } });
      }
    }
    // Declared coupling kept honest (issue #263 item 2): a declared group failure policy turns a
    // member's death into a row that tells the dependents — the works declared on the gone
    // member's work — while independent peers continue; an exclusive writer whose runtime is
    // gone names the release that frees the checkout. Coupling is never imposed, so these rows
    // exist only where the coupling was declared.
    for (const record of Object.values(swarm.couplings ?? {})) {
      if (record.released) continue;
      if (record.coupling === 'failure') {
        for (const memberId of (swarm.groups?.[record.groupId]?.members ?? [])) {
          const memberRow = participantsById.get(memberId);
          if (!memberRow || !gone(memberRow)) continue;
          const heldWork = new Set(Object.values(swarm.assignments ?? {})
            .filter((assignment) => assignment.status === 'active' && assignment.participantId === memberId)
            .map((assignment) => assignment.workId));
          const dependentWork = Object.entries(swarm.work ?? {})
            .filter(([, work]) => (work.dependsOn ?? []).some((entry) => entry.workId !== undefined && heldWork.has(entry.workId)))
            .map(([workId]) => workId).sort();
          organization.push({ kind: 'group_member_gone', couplingId: record.couplingId, groupId: record.groupId,
            participantId: memberId, policy: record.policy, dependentWork });
        }
      }
      if (record.coupling === 'writer') {
        const writerRow = participantsById.get(record.writer);
        if (!writerRow || gone(writerRow)) {
          organization.push({ kind: 'coupling_writer_gone', couplingId: record.couplingId, participantId: record.writer,
            workspaceId: record.workspaceId,
            next: { event: 'swarm.coupling_updated', couplingId: record.couplingId, action: 'release' } });
        }
      }
    }
    if (swarm.status !== 'open' && participants.some((row) => row.status === 'active' && !gone(row))) {
      organization.push({ kind: 'closed_with_live_participants', participantIds: participants.filter((row) => row.status === 'active' && !gone(row)).map((row) => row.participantId) });
    }
    const operations = ledger.filter((event) => event.kind === 'driver.recorded'
      && event.payload.swarmId === swarm.swarmId && event.payload.kind === 'swarm.operation_requested');
    const attention = [
      ...operations.flatMap((event) => {
        if (this.store.priorCoordinationEvent(`${event.idempotencyKey}:completed`)) return [];
        // A refused operation SETTLES its row (issue #308): the operation lane's unavailable row
        // is the outcome, so the row reads as a refusal with its code instead of staying
        // `operation_unconfirmed` forever. Only the genuine unknown — neither completed nor
        // refused, usually a crash window — remains unconfirmed.
        const unavailable = this.store.priorCoordinationEvent(`${event.idempotencyKey}:unavailable`);
        if (unavailable) {
          return [{ kind: 'operation_refused', command: event.payload.command, state: 'refused',
            participantId: event.payload.participantId ?? null, operationKey: event.idempotencyKey,
            code: unavailable.payload.code ?? null }];
        }
        return [{ kind: 'operation_unconfirmed', command: event.payload.command,
          participantId: event.payload.participantId ?? null, operationKey: event.idempotencyKey,
          state: this.pending.has(event.idempotencyKey) ? 'in_progress' : 'unconfirmed',
          code: null }];
      }),
      ...organization,
    ];
    const scopedAttention = !scope ? attention : attention.flatMap((row) => {
      if (row.kind === 'closed_with_live_participants') {
        const within = row.participantIds.filter((id) => scopeSubtree.includes(id));
        return within.length ? [{ ...row, participantIds: within }] : [];
      }
      return typeof row.participantId === 'string' && scopeSubtree.includes(row.participantId) ? [row] : [];
    });
    const availableActions = Object.entries(COMMAND_PERMISSIONS)
      .filter(([, permission]) => permissions.includes(permission)).map(([command]) => command);
    if (permissions.includes('contribute') && !availableActions.includes('swarm.check')) availableActions.push('swarm.check');
    if (permissions.includes('review') && !availableActions.includes('swarm.capture')) availableActions.push('swarm.capture');
    // The update kinds this caller may send NOW, each with the permission that admits it — derived
    // by the SAME function the dispatch check uses (`_updatePermission`), never a second list: a
    // view can no more overstate an authority than dispatch can overlook one (2026-09-14 audit
    // S-F1). The rows sit beside availableActions, and `swarm.update` is offered exactly when
    // there is at least one kind to send.
    const updates = Object.keys(UPDATE_PERMISSIONS)
      .map((event) => ({ event, permission: this._updatePermission(event, caller) }))
      .filter((row) => permissions.includes(row.permission));
    if (updates.length) availableActions.push('swarm.update');
    const contributionTargets = permissions.includes('review') ? participants.map((row) => row.participantId)
      : permissions.includes('contribute') && caller ? [caller.participantId] : [];
    // Work rows carry their derived evidence, plus the declared dependencies as INFORMED waits —
    // each wait shows whether it has settled and the accepted contributions that settled it.
    // Nothing here gates: a participant may proceed against an unsettled dependency, visibly.
    const acceptedByArtifact = (artifact) => Object.entries(swarm.contributions ?? {})
      .filter(([, contribution]) => this._acceptedContribution(swarm, contribution.contributionId)
        && (contribution.refs ?? []).includes(artifact))
      .map(([contributionId]) => contributionId).sort();
    const waitsFor = (row) => (row.dependsOn ?? []).map((entry) => {
      if (entry.workId !== undefined) {
        const evidence = evidenceFor(entry.workId);
        return { workId: entry.workId, settled: evidence.derivedComplete, evidence: evidence.accepted };
      }
      const evidence = acceptedByArtifact(entry.artifact);
      return { artifact: entry.artifact, settled: evidence.length > 0, evidence };
    });
    const workEntries = Object.entries(swarm.work ?? {})
      .map(([workId, row]) => [workId, { ...clone(row), evidence: evidenceFor(workId),
        ...(((row.dependsOn ?? []).length > 0) ? { waitsOn: waitsFor(row) } : {}) }]);
    // A group at a synchronization point sees who has arrived and who has not. `awaiting` counts
    // only current live members — a departed member's seat never holds the point open (released
    // seats are what a barrier must consume) — `departed` names the seats that no longer count,
    // and `arrived` derives from the recorded arrivals; it is never asserted.
    const couplingEntries = Object.entries(swarm.couplings ?? {}).map(([couplingId, record]) => {
      const row = clone(record);
      if (record.coupling === 'synchronization') {
        const currentMembers = swarm.groups?.[record.groupId]?.members ?? [];
        row.awaiting = currentMembers.filter((memberId) => {
          const memberRow = participantsById.get(memberId);
          return memberRow && memberRow.status === 'active' && !gone(memberRow)
            && !record.arrivals.some((arrival) => arrival.participantId === memberId);
        });
        // Departed seats come from the roster the point was declared over: a member that left
        // the swarm, lost its runtime, or was released from the group is named, never counted.
        const declared = record.members ?? currentMembers;
        row.departed = declared.filter((memberId) => {
          const memberRow = participantsById.get(memberId);
          const stillLiveMember = currentMembers.includes(memberId)
            && memberRow && memberRow.status === 'active' && !gone(memberRow);
          return !stillLiveMember;
        });
        row.arrived = row.awaiting.length === 0 && record.arrivals.length > 0;
      }
      return [couplingId, row];
    });
    const contributionEntries = Object.entries(swarm.contributions ?? {});
    const scopedContributionIds = scope ? new Set(contributionEntries
      .filter(([, contribution]) => contribution.workId && scopeWorkIds.has(contribution.workId))
      .map(([contributionId]) => contributionId)) : null;
    const keep = (entries, predicate) => Object.fromEntries(scope ? entries.filter(predicate) : entries);
    const rowsOf = (entries, predicate) => (scope ? entries.filter(predicate) : entries).map(([, row]) => row);
    // The participant rows a scoped view carries: the scope's subtree, with the brief text of
    // every seat but the scope's own withheld (2026-09-14 audit S-F3). A brief is what a recruiter
    // told ONE seat; the scoped view is that seat's own reading of the swarm, so another
    // participant's instructions are not in it — `briefWithheld` says the text was withheld rather
    // than never written, and the unscoped organizer view still carries every brief.
    const scopedParticipants = scope
      ? participants.filter((row) => scopeSubtree.includes(row.participantId))
        .map((row) => (row.participantId === scope.participantId ? row : { ...row, role: null, briefWithheld: true }))
      : participants;
    const view = {
      ...clone(swarm),
      participants: scopedParticipants,
      work: keep(workEntries, ([workId]) => scopeWorkIds.has(workId)),
      assignments: keep(Object.entries(swarm.assignments ?? {}), ([, assignment]) => scopeSubtree.includes(assignment.participantId)
        || scopeWorkIds.has(assignment.workId)),
      // ONE collection shape on the view (issue #302): participants, contributions, couplings,
      // groups and attention are ARRAYS of rows — the collections a caller iterates — while the
      // identity-addressed families (work, assignments, reviews, context) stay keyed objects.
      // Every read path (view, watch, bridge, MCP) carries these rows through unchanged.
      contributions: rowsOf(contributionEntries, ([, contribution]) => Boolean(contribution.workId)
        && scopeWorkIds.has(contribution.workId)),
      reviews: keep(Object.entries(swarm.reviews ?? {}), ([contributionId]) => scopedContributionIds.has(contributionId)),
      // A group is a roster: a scoped view carries the groups its subtree is ON, by the same
      // roster-intersection rule the couplings below use. A group with no member in scope is not
      // this participant's business — and an emptied roster (a released holder) is therefore
      // carried by nobody, instead of by everybody (`[].every(...)` is vacuous).
      groups: rowsOf(Object.entries(swarm.groups ?? {}), ([, group]) =>
        group.members.some((member) => scopeSubtree.includes(member))),
      // A member sees the couplings its subtree can act on. Writer records follow the writer's
      // subtree; a synchronization point or group failure policy follows its group — every member
      // whose roster intersects the subtree sees it, so a seat listed in `awaiting` can always
      // read the point it is expected to arrive at (docs/39 §Declared coupling).
      couplings: rowsOf(couplingEntries, ([, record]) => {
        if (record.coupling === 'writer') return scopeSubtree.includes(record.writer);
        const roster = swarm.groups?.[record.groupId]?.members ?? record.members ?? [];
        return roster.some((member) => scopeSubtree.includes(member));
      }),
      // The shared context every participant is recruited with is swarm-wide by construction, so a
      // scoped view carries it; an entry written for ONE group follows that group's roster, and is
      // visible to the members who can read the group it belongs to (2026-09-14 audit S-G5).
      context: keep(Object.entries(swarm.context ?? {}), ([, entry]) => entry.groupId === null
        || entry.groupId === undefined
        || (swarm.groups?.[entry.groupId]?.members ?? []).some((member) => scopeSubtree.includes(member))),
      // The caller's own standing refusal rides the FRAME, so it is answered whatever projection
      // was asked for — and so the entry can tell that a successful read just retired one.
      caller: { participantId: caller?.participantId ?? null, permissions: [...permissions],
        lastRefusal: caller ? lastRefusal(caller.participantId) : null },
      availableActions, attention: scopedAttention,
      actionTargets: {
        'swarm.capture': { participantIds: contributionTargets },
        'swarm.check': { participantIds: contributionTargets },
      },
      updates,
      updatePayloads: Object.fromEntries(updates.map(({ event }) => [event, {
        ...clone(SWARM_EVENT_PAYLOAD_SCHEMAS[event]), example: clone(SWARM_EVENT_EXAMPLES[event]),
      }])),
      cursor: this.store.ledgerHeadSeq(),
    };
    // The projection is applied HERE, at the one place a view is built, by the ONE slicer the
    // bridge also measures with (swarm-contract): the default answers with the whole record, so a
    // caller that names no projection sees exactly what it always saw.
    return projectSwarmView(view, projection ?? SWARM_VIEW_DEFAULT_PROJECTION);
  }

  close() {
    this.watchController.abort();
  }

  async _watch(args, principal, context) {
    const afterSeq = args.afterSeq ?? this.store.ledgerHeadSeq();
    let cursor = afterSeq;
    if (cursor > this.store.ledgerHeadSeq()) refuse('Swarm cursor is ahead of this deployment', 'swarm_cursor_invalid');
    const deadline = performance.now() + (args.timeoutMs ?? 30000);
    for (;;) {
      const swarm = this._swarm(args.swarmId);
      this._permit(swarm, principal, context, 'read');
      const members = Object.values(swarm.participants);
      const runIds = new Set(members.map((member) => member.runId).filter(Boolean));
      const bindings = members.flatMap((member) => member.bindings);
      const taskIds = new Set(bindings.map((binding) => binding.taskId));
      const workerIds = new Set(bindings.map((binding) => binding.workerId));
      // seq is 1-based and `cursor` counts the events already seen, so the store's own cursor
      // form reads exactly the tail — `eventsView()` with no argument copies the whole ledger
      // per watch iteration (the store calls that the #210 class; 2026-09-14 audit S-E3).
      const events = this.store.eventsView(cursor + 1);
      const relevant = events.find(({ kind, payload }) => {
        // A watch call is itself a native tool call. Waking on tool/usage telemetry makes
        // the observer generate the next wake indefinitely, even when every peer is paused.
        if (['evidence.mapped', 'driver.recorded'].includes(kind)
          && (payload?.kind === 'content.tool_call' || payload?.kind === 'route.observed'
            || payload?.kind?.startsWith('resource.'))) return false;
        return payload?.swarmId === args.swarmId
          || (payload?.runId && runIds.has(payload.runId))
          || (payload?.taskId && taskIds.has(payload.taskId))
          || (payload?.worker && workerIds.has(payload.worker));
      });
      // What a recruitment wake names about the seat it recruited: read from the folded record,
      // which carries what the join recorded — never from the live worker (issue #283).
      const recruited = (event) => {
        if (event.kind !== 'swarm.participant_joined') return {};
        const row = swarm.participants[event.payload?.participantId];
        return row ? { participantId: row.participantId, route: row.route ?? null, scope: row.scope ?? null } : {};
      };
      if (relevant || performance.now() >= deadline) return {
        ...this.inspect(swarm, principal, context, null, args.projection),
        watch: {
          reason: relevant ? 'event' : 'timeout', afterSeq, matchedSeq: relevant?.seq ?? null,
          // The wake names what woke it, so a follower can act without re-reading the log; a wake
          // that IS a recruitment also names the route and scope the seat was started under
          // (issue #283 root comment 1), projected from the durable join like everything else.
          event: relevant ? { seq: relevant.seq, kind: relevant.kind,
            payloadKind: relevant.payload?.kind ?? null, ...recruited(relevant) } : null,
        },
      };
      cursor = this.store.ledgerHeadSeq();
      await this.store.waitAfter(cursor, Math.max(1, Math.ceil(deadline - performance.now())), {
        signal: this.watchController.signal,
      });
    }
  }

  /** Completion is derived from evidence (docs/39 §Claims; issue #263 item 1). An organizer may
   * set status completed when the derivation already holds — an accepted contribution references
   * the work — or when the update cites its basis: contributionIds naming accepted contributions
   * that reference the work (by workId or refs). Anything else refuses, naming what is missing. */
  _requireCompletionEvidence(swarm, payload) {
    const evidence = this._workEvidence(swarm)(payload.workId);
    if (evidence.derivedComplete) return;
    const cited = payload.basis?.contributionIds;
    if (!Array.isArray(cited) || cited.length === 0) {
      refuse('Work completion is unproven: no accepted contribution references this work. Record an accept review on a contribution that names it, or cite accepted contributions with basis.contributionIds.',
        'swarm_completion_unproven', { workId: payload.workId, accepted: evidence.accepted });
    }
    const problems = cited.map((contributionId) => {
      const contribution = Object.hasOwn(swarm.contributions ?? {}, contributionId)
        ? swarm.contributions[contributionId] : null;
      if (!contribution) return { contributionId, problem: 'unknown contribution' };
      if (contribution.workId !== payload.workId && !(contribution.refs ?? []).includes(payload.workId)) {
        return { contributionId, problem: 'does not reference this work' };
      }
      if (!this._acceptedContribution(swarm, contributionId)) return { contributionId, problem: 'no unrevoked accept review' };
      return null;
    }).filter(Boolean);
    if (problems.length) {
      refuse('Work completion is unproven: the cited basis does not evidence this work',
        'swarm_completion_unproven', { workId: payload.workId, problems });
    }
  }

  /** Issue #263 item 2 — the organizer release operation. A participant whose runtime is dead or
   * exited, or whose status is left, keeps its active assignments and group seats; this operation
   * releases them in ONE durable batch: the individual swarm.assignment_updated and
   * swarm.group_updated events are what lands in the log, so replay stays byte-identical to the
   * hand-written sequence (the request itself, reason included, rides swarm.operation_requested).
   * A live active participant refuses with swarm_holder_live — stopping it stays the explicit
   * separate act. */
  async _holderRelease(swarm, payload, args, principal, context) {
    const holder = this._participant(swarm, payload.participantId);
    const state = this._workerFor(holder, this.coordinator.list())?.status ?? 'unbound';
    if (holder.status === 'active' && !['dead', 'exited', 'unbound'].includes(state)) {
      refuse('The holder is still live: stop it or record its leave before releasing its seats',
        'swarm_holder_live', { participantId: holder.participantId, runtimeState: state });
    }
    return this._once('swarm.update', args, principal, async () => {
      this._permit(this._swarm(args.swarmId), principal, context, 'organize');
      const current = this._swarm(args.swarmId);
      const releases = Object.values(current.assignments ?? {})
        .filter((assignment) => assignment.status === 'active' && assignment.participantId === holder.participantId);
      const groupLeaves = Object.values(current.groups ?? {})
        .filter((group) => group.members.includes(holder.participantId));
      const planned = [
        ...releases.map((assignment) => ({
          kind: 'swarm.assignment_updated',
          payload: { swarmId: current.swarmId, assignmentId: assignment.assignmentId,
            participantId: assignment.participantId, workId: assignment.workId, status: 'released',
            ...(payload.reason ? { reason: payload.reason } : {}) },
          key: `assignment:${assignment.assignmentId}`,
        })),
        // Issue #290: the roster rewrite retains only currently active members. A leave never
        // evicts group seats, so the roster the holder departs from usually still names other
        // departed members — and the fold requires every named member to be active, which made
        // the release operation bricked by the most common preceding event.
        ...groupLeaves.map((group) => {
          const members = group.members.filter((member) => member !== holder.participantId
            && (Object.hasOwn(current.participants, member) && current.participants[member].status === 'active'));
          return {
            kind: 'swarm.group_updated',
            payload: { swarmId: current.swarmId, groupId: group.groupId, members },
            key: `group:${group.groupId}`,
          };
        }),
      ];
      // Prove the whole batch folds before the first write: a batch that cannot land whole
      // refuses with nothing recorded. The prune above removes the seats the fold would refuse
      // (a departed member); any residual refusal surfaces TYPED, naming the group and seats
      // the batch planned (#290) — never a raw integrity error wearing no coordinate.
      const trial = new Map([[current.swarmId, current]]);
      for (const event of planned) {
        try { foldSwarmEvent(trial, { kind: event.kind, payload: event.payload }); }
        catch (error) {
          if (error instanceof SwarmIntegrityError) {
            refuse('the holder release batch does not fold, so nothing was recorded; the refusal names the group and seats to repair',
              'swarm_holder_release_refused', {
                groupId: event.payload.groupId ?? null,
                assignmentId: event.payload.assignmentId ?? null,
                seats: Array.isArray(event.payload.members) ? [...event.payload.members] : null,
                cause: error.code,
                causeMessage: error.message,
              });
          }
          throw error;
        }
      }
      const operationKey = this._operationKey('swarm.update', args, principal);
      const writes = planned.map((event) => this._write(event.kind, event.payload, principal, `${operationKey}:${event.key}`));
      return { participantId: holder.participantId, released: {
        assignments: releases.map((assignment) => assignment.assignmentId),
        groups: groupLeaves.map((group) => group.groupId),
      }, writes };
    }, { replaySafe: true, context });
  }

  /** The public command entry: a refused MUTATION leaves a durable, wake-capable trace, and the
   * refusal itself is then thrown unchanged — the caller sees its own refusal, never a recording
   * failure wearing its name. A SUCCESSFUL mutation leaves its terminal row where the mutation is
   * applied (inside `_dispatch`, through `_recordOperationCompleted`), so the view a mutation
   * answers with can already contain it: a bookkeeping row minted after the caller's own view
   * would wake that caller's next watch with no change to report.
   *
   * A READ writes its terminal row only when it actually retires one of its own refusals. Reads
   * leave no trace by design, so recording every successful one would put a row per `swarm.view`
   * on the ledger and wake every watcher for it; recording the ONE that clears the caller's own
   * standing refusal for the same command is the only one that is read by anybody. Every view
   * answers with `caller.lastRefusal` whatever projection was asked for, so the clearing question
   * does not depend on the slice. */
  async command(command, args, principal, context = null) {
    let result;
    try {
      result = await this._dispatch(command, args, principal, context);
    } catch (error) {
      this._recordRefusal(command, args, principal, context, error);
      throw error;
    }
    if (result?.caller?.lastRefusal?.command === command) {
      this._settleOperation(command, args, principal, context);
    }
    return result;
  }

  /** Record one refused mutation (issue #271 work W2) as the runtime's own durable
   * `swarm.operation_refused` driver row — {swarmId, command, event, code, field, rule,
   * participantId} — so a watcher parked on swarm.watch wakes even though no swarm state changed
   * and the fold never saw a thing. Only mutations are recorded: a refused READ is the caller's
   * own business. The refusal names the RULE that refused it (issue #283) so a watcher learns
   * what to change, not merely that something was refused.
   * The identity derives from the request and the refusal (never a clock, counter, or random id),
   * so replaying the ledger reproduces these rows byte-identically and an identical retried refusal
   * records exactly once. A refusal with no typed code is an internal fault, not a refusal, and is
   * never dressed up as one. */
  _recordRefusal(command, args, principal, context, error) {
    if (this.watchController.signal.aborted) return;   // a closed runtime refuses; it does not record
    const definition = swarmCommandDefinition(command);
    const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : null;
    if (code === null || definition === null) return;
    // The registry decides what a mutation is: any capability beyond observing.
    if (!definition.capabilities.some((capability) => capability !== 'observe')) return;
    const swarmId = typeof args?.swarmId === 'string' ? args.swarmId : null;
    const row = {
      swarmId, command,
      event: typeof args?.event === 'string' ? args.event : null,
      code,
      field: typeof error?.detail?.field === 'string' ? error.detail.field : null,
      rule: typeof error?.detail?.rule === 'string' ? error.detail.rule : null,
      // The refusal's own named participant wins; when it names nobody (contract and state
      // refusals), the resolved caller is the participant whose mutation was refused.
      participantId: typeof error?.detail?.participantId === 'string'
        ? error.detail.participantId : this._attributedParticipant(swarmId, principal, context),
    };
    this.store.recordDriver('swarm.operation_refused', row, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-refusal:${hash([command, args ?? null, principal?.principalId ?? null, code, row.field, row.event])}`,
    });
  }

  /** The terminal row for a successful MUTATION that the operation lane did not already record:
   * `_once` writes its own (under the operation key, carrying the result a replay returns), and
   * everything else — a plain `swarm.update`, a capture, a check, a create — is recorded HERE, so
   * "a later operation of the same command succeeded" is one question the ledger answers the same
   * way for every command. Only mutations come through this door: a successful READ is recorded
   * solely when it retires the caller's own standing refusal (`command`), because a read that
   * changed nothing and cleared nothing is not an operation anybody reads. */
  _recordOperationCompleted(command, args, principal, context) {
    const definition = swarmCommandDefinition(command);
    if (definition === null || !definition.capabilities.some((capability) => capability !== 'observe')) return;
    this._settleOperation(command, args, principal, context);
  }

  /** Write the one terminal row for an operation whose success the lane has not recorded yet. The
   * row's identity is the whole attempt (the request, not a clock), so re-issuing one request
   * never mints a second row; no result is carried, because a command that does not replay under
   * its key has no replayed receipt and its own durable effect is its evidence. */
  _settleOperation(command, args, principal, context) {
    if (this.watchController.signal.aborted) return;
    const operationKey = this._operationKey(command, args, principal);
    if (this.store.priorCoordinationEvent(`${operationKey}:completed`)) return;
    this.store.recordDriver('swarm.operation_completed', {
      swarmId: typeof args?.swarmId === 'string' ? args.swarmId : null,
      command, operationKey, result: null,
      participantId: this._attributedParticipant(typeof args?.swarmId === 'string' ? args.swarmId : null, principal, context),
    }, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-terminal:${hash([command, args ?? null, principal?.principalId ?? null])}`,
    });
  }

  /** Best-effort participant attribution for the runtime's own durable rows (a refusal, an
   * operation receipt), resolved through the same authority the command used (_caller): identity
   * enrichment must never replace the outcome itself, so a resolution that refuses (a cross-swarm
   * context, a claimed identity this swarm does not carry) yields null instead of a refusal of its
   * own. ONE resolution, so a refusal row and the terminal row that clears it name the same seat. */
  _attributedParticipant(swarmId, principal, context) {
    try {
      const swarm = swarmId === null ? null : this.store.swarm(swarmId);
      return swarm ? this._caller(swarm, principal, context)?.participantId ?? null : null;
    } catch { return null; }
  }

  /** Record one refusal the NATIVE BRIDGE raised before dispatch (issue #283 root comment 2) as
   * the same durable `swarm.operation_refused` row a refused mutation leaves — the bridge's own
   * admission (an over-cap frame, a request the closed argument vocabulary refuses) is a refusal a
   * participant must be able to learn about, and the swarm's refusal lane is where it is legible.
   * The report is the bridge's, so every field is validated here: a malformed report is refused
   * rather than recorded as if it were a refusal, and an absent command or participant is null on
   * the row, never invented. */
  _recordBridgeRefusal(report, principal) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
    const text = (value) => (typeof value === 'string' && value.length > 0 ? value : null);
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      refuse('Swarm bridge refusal report must be one JSON object', 'swarm_command_invalid',
        { rule: 'bridge-report-shape' });
    }
    if (text(report.code) === null) {
      refuse('Swarm bridge refusal report must name the refusal code', 'swarm_command_invalid',
        { field: 'code', rule: 'bridge-report-shape' });
    }
    const row = {
      swarmId: text(report.swarmId), command: text(report.command), event: text(report.event),
      code: text(report.code), field: text(report.field), rule: text(report.rule),
      participantId: text(report.participantId),
    };
    // The bridge's own refusal identity is its own report, and the seat is named by the report
    // (its token table), so the same refused request records exactly once however often it retries.
    this.store.recordDriver('swarm.operation_refused', row, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-refusal:${hash([row.command, row.swarmId, row.participantId, row.code, row.field, row.rule, row.event])}`,
    });
    return { recorded: true, code: row.code, participantId: row.participantId, command: row.command };
  }

  async _dispatch(command, args, principal, context = null) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
    // The native bridge's refusal report (issue #283). It reaches the runtime through `dispatch`
    // because that is the bridge's ONLY channel, and it is admitted only from a bridge report: the
    // verb is not a swarm command (swarm-contract asserts it never becomes one), so no surface can
    // submit it, and the report is validated before anything is recorded.
    if (command === SWARM_BRIDGE_REFUSAL_COMMAND) {
      return this._recordBridgeRefusal(args, principal);
    }
    validateSwarmCommand(command, args);
    await this.authorize(command, args, principal);
    if (command === 'swarm.list') {
      return this.store.swarms().filter((swarm) => {
        try { this._permit(swarm, principal, context, 'read'); return true; } catch { return false; }
      }).map((swarm) => ({ swarmId: swarm.swarmId, purpose: swarm.purpose, status: swarm.status }));
    }
    if (command === 'swarm.create') {
      if (principal.principalId?.startsWith('worker:') || context?.runId) {
        refuse('Recruit and organize within your granted swarm', 'swarm_membership_required');
      }
      const swarmId = args.swarmId ?? `swarm-${hash([principal.principalId, args.idempotencyKey]).slice(0, 32)}`;
      const recorded = this._write('swarm.created', { swarmId, purpose: args.purpose }, principal,
        this._operationKey(command, { ...args, swarmId }, principal));
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, { ...args, swarmId }, [recorded], principal, context, { swarmId });
    }
    let swarm = this._swarm(args.swarmId);
    if (command === 'swarm.view') {
      const scope = args.participantId ? this._participant(swarm, args.participantId) : null;
      return this.inspect(swarm, principal, context, scope?.participantId ?? null, args.projection);
    }
    if (command === 'swarm.watch') {
      this._permit(swarm, principal, context, 'read');
      return this._watch(args, principal, context);
    }
    // The caller is resolved ONCE, and the permission their request needs is derived from it in
    // ONE place (_updatePermission), so the grant this check enforces and the kinds the view
    // advertises are the same derivation (2026-09-14 audit S-F1).
    const member = this._caller(swarm, principal, context);
    let permission = command === 'swarm.update'
      ? this._updatePermission(args.event, member, args.payload)
      : COMMAND_PERMISSIONS[command];
    if (command === 'swarm.check' || command === 'swarm.capture') {
      permission = member?.participantId === args.participantId ? 'contribute' : 'review';
    }
    if (!permission) refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
    const caller = this._permit(swarm, principal, context, permission);
    if (command === 'swarm.update') {
      if (typeof args.payload === 'string' && args.event !== 'swarm.contribution_recorded') {
        refuse('This update needs its target fields; conversation text belongs in body', 'swarm_payload_invalid');
      }
      const payload = { ...(typeof args.payload === 'string' ? { body: args.payload } : clone(args.payload ?? {})), swarmId: args.swarmId };
      let externalJoin = null;
      if (args.event === 'swarm.contribution_recorded') {
        if (!payload.participantId && !caller) {
          const participantId = `external-${hash([args.swarmId, principal.principalId]).slice(0, 32)}`;
          if (!Object.hasOwn(swarm.participants, participantId)) {
            externalJoin = this._write('swarm.participant_joined', {
              swarmId: args.swarmId, participantId, role: 'External orchestrator', permissions: [...SWARM_PERMISSIONS],
            }, principal, `swarm-external:${hash([args.swarmId, principal.principalId])}`);
          }
          payload.participantId = participantId;
        }
        payload.participantId ??= caller?.participantId;
        payload.contributionId ??= `contribution-${hash([principal.principalId, args.idempotencyKey]).slice(0, 32)}`;
      }
      if (args.event === 'swarm.participant_left' && caller) payload.participantId ??= caller.participantId;
      // Arrivals, releases, and writer claims default the participant they NAME to the caller's
      // own seat; naming another participant stays possible (organize authority — checked above)
      // and stays recorded. A release carries no such default: who released is the ACTOR, never a
      // seat the request happens to name.
      if (args.event === 'swarm.coupling_updated' && payload.participantId === undefined
        && payload.action !== 'release' && caller) {
        payload.participantId = caller.participantId;
      }
      if (args.event === 'swarm.work_updated' && payload.objective === undefined) {
        const existing = Object.hasOwn(swarm.work, payload.workId) ? swarm.work[payload.workId] : null;
        if (!existing) refuse('New work needs an objective; a status-only update is for work that already exists', 'swarm_payload_invalid', { field: 'payload.objective', workId: payload.workId });
        payload.objective = existing.objective;
      }
      if (args.event === 'swarm.work_updated' && payload.status === 'completed') {
        this._requireCompletionEvidence(swarm, payload);
      }
      if (args.event === 'swarm.holder_released') {
        const released = await this._holderRelease(swarm, payload, args, principal, context);
        return this._mutationResult(command, args, released.writes, principal, context,
          { participantId: released.participantId, released: released.released });
      }
      if (caller && args.event === 'swarm.contribution_recorded' && payload.participantId !== caller.participantId) {
        refuse('Contributions must name their actual author', 'swarm_author_mismatch');
      }
      // Reviews and releases are attributed to their ACTOR: a member's own participant name, or
      // the acting principal's label when an external orchestrator acts. A caller-named identity
      // that is not the actor is a misattribution and refuses — an organizer's act never lands as
      // the seat it touched, and the root's acts never land as null (issue #292).
      if (args.event === 'swarm.contribution_reviewed') {
        const actor = this._actorOf(caller, principal);
        if (payload.reviewerId && payload.reviewerId !== actor) refuse('Review author does not match caller', 'swarm_author_mismatch');
        payload.reviewerId = actor;
      }
      if (args.event === 'swarm.coupling_updated' && payload.action === 'release') {
        const actor = this._actorOf(caller, principal);
        if (payload.releasedBy !== undefined && payload.releasedBy !== actor) {
          refuse('A release is attributed to the participant that released it', 'swarm_author_mismatch', { releasedBy: actor });
        }
        payload.releasedBy = actor;
      }
      const recorded = this._write(args.event, payload, principal, this._operationKey(command, args, principal));
      this._recordOperationCompleted(command, args, principal, context);
      if (caller && args.event === 'swarm.participant_left' && payload.participantId === caller.participantId) {
        return this._mutationResult(command, args, [recorded], principal, context,
          { swarmId: args.swarmId, participantId: caller.participantId, state: 'left', sessionStopped: false });
      }
      return this._mutationResult(command, args, [externalJoin, recorded].filter(Boolean), principal, context);
    }
    if (swarm.status !== 'open' && command === 'swarm.recruit') refuse('Swarm recruitment is closed', 'swarm_closed');
    if (command === 'swarm.recruit') {
      const permissions = args.permissions ?? DEFAULT_PERMISSIONS;
      if (!Array.isArray(permissions) || permissions.some((permission) => !SWARM_PERMISSIONS.includes(permission))) {
        refuse('Unknown swarm permission', 'swarm_permissions_invalid');
      }
      if (caller && permissions.some((permission) => !(caller.permissions ?? DEFAULT_PERMISSIONS).includes(permission))) {
        refuse('Delegation cannot grant authority the caller does not hold', 'swarm_permission_required');
      }
      const runId = `run-${hash([args.swarmId, args.participantId]).slice(0, 32)}`;
      // The route and scope this seat is recruited under (issue #283 root comment 1): the
      // deployment's own resolution when it makes one (prepareRun answers with the admitted
      // intent), otherwise the selection the caller named. They ride the membership write, so the
      // view projects what the seat was started as from the durable join — never from a live
      // worker that may since have been rebound, stopped, or restarted.
      const intent = await this.prepareRun({ runId, objective: args.objective, options: args.options ?? {} }, principal);
      const recruitedRoute = swarmRouteShape(intent?.route) ?? swarmRouteShape(args.options?.exact);
      const recruitedScope = Array.isArray(intent?.scope) ? [...intent.scope]
        : Array.isArray(args.options?.scope) ? [...args.options.scope] : null;
      const result = await this._once(command, args, principal, async (sharedContext) => {
        this._permit(this._swarm(args.swarmId), principal, context, 'recruit');
        // Re-read the swarm INSIDE the effect: a rolled-back seat from an earlier attempt must be
        // seen as it is now, not as the dispatch entry snapshot had it.
        const current = this._swarm(args.swarmId);
        // The deliberate shared checkout is resolved inside the effect, before any membership is
        // written: an absent, departed, or process-less source refuses with nothing recorded, so
        // a refused attachment never leaks a holder into the swarm.
        const workspace = args.shareWorkspaceWith
          ? this._sharedWorkspace(current, args.shareWorkspaceWith, args.participantId)
          : null;
        // Anything that is not a rolled-back residue or a replay and names an existing row is
        // refused by name (`swarm_participant_exists`, retryable: false — the identity is taken).
        // A row the runtime itself withdrew after a refused admission (issue #308:
        // `recruit_refused`) is the ONE existing row this join may resume.
        const existing = Object.hasOwn(current.participants, args.participantId)
          ? current.participants[args.participantId] : null;
        const resuming = existing !== null && existing.status === 'left'
          && existing.leftReason === 'recruit_refused';
        if (existing && !resuming) {
          refuse('Swarm participant already exists', 'swarm_participant_exists', {
            participantId: args.participantId, status: existing.status,
          });
        }
        // Advisory, never a refusal (issue #301): the requested scope is compared with every
        // ACTIVE participant's scope across the repository's swarms, BEFORE the join writes the
        // new seat, so the row never names the recruit against itself.
        const scopeOverlap = recruitedScope === null ? [] : this._scopeOverlap(recruitedScope);
        // Membership precedes dispatch, so even a fast first native turn has the continuing
        // participant protocol. The underlying Run remains the existing execution authority.
        // A resumed seat re-joins under the RESUME request's own key: the original join key
        // belongs to the first attempt, and the store would serve that prior event without
        // folding, leaving the withdrawn row withdrawn.
        const writes = [this._write('swarm.participant_joined', {
          swarmId: args.swarmId, participantId: args.participantId, role: args.objective,
          runId, permissions, ...(caller ? { parentId: caller.participantId } : {}),
          ...(recruitedRoute ? { route: recruitedRoute } : {}),
          ...(recruitedScope ? { scope: recruitedScope } : {}),
          ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
        }, principal, resuming
          ? `swarm-participant-resume:${this._operationKey(command, args, principal)}`
          : `swarm-participant:${hash([args.swarmId, args.participantId])}`)];
        // A recruit whose run admission refuses rolls its join back (issue #308): the seat is
        // withdrawn durably — `swarm.participant_left {reason: 'recruit_refused', code}` carries
        // the typed admission code — so the swarm never keeps a phantom member, and a repeated
        // recruit of the same id RESUMES instead of hitting an eternal exists-refusal. The
        // caller still sees the original refusal, unchanged.
        try {
          await this.startRun({ runId, objective: args.objective, options: args.options ?? {},
            swarmId: args.swarmId, participantId: args.participantId, sharedContext,
            ...(workspace ? { workspace } : {}) }, principal, context);
        } catch (error) {
          writes.push(this._write('swarm.participant_left', {
            swarmId: args.swarmId, participantId: args.participantId, reason: 'recruit_refused',
            ...(typeof error?.code === 'string' && error.code.length > 0 ? { code: error.code } : {}),
          }, principal, `swarm-recruit-rollback:${this._operationKey(command, args, principal)}`));
          throw error;
        }
        const worker = this.coordinator.list().find((row) => row.runId === runId);
        if (!worker) refuse('Recruitment admitted but worker binding is not yet available', 'swarm_participant_unbound', { runId });
        // The checkout this binding observed is recorded with the seat: the first recruit into a
        // checkout is armed here (an adopted checkout already carries its workspace from the join),
        // so the exclusive-writer guard has an identity to compare on every later claim.
        const checkout = typeof this.coordinator.workspaceAttachment === 'function'
          ? this.coordinator.workspaceAttachment(worker.id) : null;
        writes.push(this._write('swarm.participant_bound', {
          swarmId: args.swarmId, participantId: args.participantId, workerId: worker.id, taskId: worker.taskId,
          ...(checkout ? { workspaceId: checkout.workspaceId } : {}),
        }, principal, `swarm-binding:${hash([args.swarmId, args.participantId, worker.id])}`));
        return { participantId: args.participantId, runId, swarmId: args.swarmId, scopeOverlap, writes };
      }, { replaySafe: true, basis: Object.values(swarm.context), context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, runId: result.runId, swarmId: result.swarmId,
          scopeOverlap: result.scopeOverlap ?? [] });
    }
    const participant = this._participant(swarm, args.participantId);
    if (caller && command === 'swarm.capture' && caller.participantId !== participant.participantId
      && !(caller.permissions ?? []).includes('review')) {
      refuse('Capturing another participant requires review authority', 'swarm_permission_required');
    }
    const worker = this._worker(participant);
    if (command === 'swarm.capture') {
      const existing = swarm.contributions[args.contributionId];
      if (existing && existing.participantId !== participant.participantId) {
        refuse('Contribution identity already belongs to another author', 'swarm_replay_conflict');
      }
      const capture = await this.coordinator.captureContribution(worker.id, { contributionId: args.contributionId });
      // The base the captured revision sits on (issue #301): derived from the author's own
      // checkout at capture time, and refused TYPED when its history cannot reach the deployment
      // target — a revision that shares no common ancestor with the target could never integrate,
      // so it is never pinned and NOTHING is recorded. A checkout that cannot be observed at all
      // records no base facts: absence is honest, an unreachable base is not.
      const base = captureBase(worker);
      if (base && base.target !== null && base.mergeBase === null) {
        refuse('The captured revision is unreachable from the deployment target: its checkout and the target share no common ancestor, so it could never integrate',
          'swarm_capture_base_unreachable', { participantId: participant.participantId,
            observedHead: base.observedHead, target: base.target });
      }
      const writes = [];
      if (!this._swarm(args.swarmId).contributions[args.contributionId]) {
        writes.push(this._write('swarm.contribution_recorded', {
          swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
        }, principal, `swarm-capture:${hash([args.swarmId, participant.participantId, args.contributionId])}`));
      }
      // The revision record carries the checkout it was observed in, so a shared capture is
      // honest without reading a worker log: the swarm can tell which physical workspace the
      // revision came from, which HEAD it showed before the capture, and the merge-base with the
      // target an integration would descend from.
      writes.push(this._write('swarm.contribution_revision_attached', {
        swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
        sha: capture.sha, ref: capture.ref,
        ...(capture.workspace?.physicalOwnerId ? { workspaceId: capture.workspace.physicalOwnerId } : {}),
        ...(capture.observedHead ? { observedHead: capture.observedHead } : {}),
        ...(base?.mergeBase ? { mergeBase: base.mergeBase } : {}),
      }, principal, `swarm-capture-revision:${hash([args.swarmId, participant.participantId, args.contributionId])}`));
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, args, writes, principal, context, {
        ...clone(capture), participantId: participant.participantId,
        ...(base?.mergeBase ? { mergeBase: base.mergeBase } : {}),
      });
    }
    if (command === 'swarm.check') {
      const checked = await this.coordinator.checkContribution(worker.id, {
        contributionId: args.contributionId, checkId: args.checkId,
      });
      const key = `swarm-check:${hash([args.swarmId, participant.participantId, args.contributionId, args.checkId])}`;
      const writes = [];
      if (!this.store.priorCoordinationEvent(key)) {
        writes.push(this._write('swarm.contribution_reviewed', {
          swarmId: args.swarmId, contributionId: args.contributionId,
          reviewerId: this._actorOf(caller, principal), decision: 'comment',
          reason: `Check ${args.checkId}: ${checked.passed ? 'passed' : 'failed'} for ${checked.sha}; cleanup ${checked.attempt?.cleanup?.state ?? 'unknown'}.`,
        }, principal, key));
      }
      this._recordOperationCompleted(command, args, principal, context);
      return this._mutationResult(command, args, writes, principal, context, { ...clone(checked) });
    }
    if (command === 'swarm.guide') {
      const result = await this._once(command, args, principal, async () => {
        const cursor = this.store.ledgerHeadSeq();
        const guided = await this.coordinator.guideParticipant(worker.id, args.message, { actor: principal.actor });
        // The lane receipt is durable coordination log, not process state: deliveries are
        // serialized per worker, so the newest nudge row for this binding past the pre-call
        // cursor is the row THIS guide wrote — read back and returned as its receipt.
        const sent = this.store.eventsView().filter((event) => event.kind === 'message.sent'
          && event.payload?.kind === 'nudge' && event.payload?.to?.workerId === worker.id
          && event.seq > cursor).at(-1);
        return { participantId: participant.participantId, result: guided,
          guide: sent ? { seq: sent.seq, ts: sent.ts, messageId: sent.payload.messageId ?? null } : null,
          writes: sent ? [{ kind: sent.kind, payload: sent.payload, seq: sent.seq, ts: sent.ts, actor: sent.actor }] : [] };
      }, { context });
      return this._mutationResult(command, args, result.writes ?? [], principal, context,
        { participantId: result.participantId, result: result.result, guide: result.guide });
    }
    if (command === 'swarm.stop') {
      const result = await this._once(command, args, principal, async () => {
        const stopped = await this.stopRun(participant.runId, args.reason, principal);
        return { participantId: participant.participantId, result: stopped };
      }, { context });
      // A stop writes no swarm fold row: the receipt's event is the operation terminal row the
      // lane recorded for this exact attempt (_mutationResult's fallback).
      return this._mutationResult(command, args, [], principal, context,
        { participantId: result.participantId, result: result.result });
    }
    refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
  }
}
