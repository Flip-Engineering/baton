import { SWARM_EVENT_KINDS, validateSwarmCommand, swarmCommandDefinition } from './swarm-contract.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-order.mjs';
import { SWARM_EVENT_PAYLOAD_SCHEMAS, SWARM_EVENT_EXAMPLES } from './swarm-event-schemas.mjs';
import { foldSwarmEvent, SwarmIntegrityError } from './swarm-state.mjs';
import { workspaceCustodyRecord } from './shared-workspace-custody.mjs';

const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
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

  _operationKey(command, args, principal) {
    return `swarm-operation:${hash([command, args.swarmId, principal.principalId, args.idempotencyKey])}`;
  }

  async _once(command, args, principal, effect, { replaySafe = false, basis = null } = {}) {
    const key = this._operationKey(command, args, principal);
    const requestDigest = hash(args);
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
          command, request: clone(requested.payload.request), operationKey: key,
        });
    }
    if (!requested) this.store.recordDriver('swarm.operation_requested', {
      swarmId: args.swarmId, command, requestDigest, request: clone(args), basis: clone(basis),
    }, { actor: principal.actor, key });
    const operation = Promise.resolve().then(() => effect(clone(requested?.payload.basis ?? basis))).then((result) => {
      this.store.recordDriver('swarm.operation_completed', {
        swarmId: args.swarmId, command, operationKey: key, result: clone(result),
      }, { actor: principal.actor, key: `${key}:completed` });
      return result;
    }).catch((error) => {
      this.store.recordDriver('swarm.operation_unavailable', {
        swarmId: args.swarmId, command, operationKey: key,
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

  inspect(swarm, principal, context, scopeId = null) {
    const caller = this._permit(swarm, principal, context, 'read');
    // An optional participantId scopes the read to that participant's delegation (issue #263
    // item 3): its subtree, the work actively assigned within, their contributions and reviews.
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
    const participants = Object.values(swarm.participants).map((participant) => {
      const worker = this._workerFor(participant, workers);
      const paused = worker ? this.coordinator.pausedTurns({ workerId: worker.id }) : [];
      // A turn is paused only while the worker that paused it is alive: a dead or exited
      // worker's leftover pause record is history, not a turn a guide could resume.
      const alive = worker && ['working', 'blocked', 'pending', 'idle', 'stopping'].includes(worker.status);
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
        : { coverage: 'unobserved', agents: [], invocations: [], unidentified: [] }, runtime: {
        workerId: worker?.id ?? null, state: worker?.status ?? 'unbound',
        turn: alive && paused.length ? 'paused' : worker?.status === 'working' ? 'running' : null,
      }, guidance: worker ? (guidanceByWorker.get(worker.id) ?? []) : [],
        workspace: physicalOwnerId !== null
          ? workspaceCustodyRecord(physicalOwnerId, this.coordinator.liveWorkspaceHolders(physicalOwnerId).length)
          : null };
    });
    // Organization truth an orchestrator would otherwise assemble by hand: members whose process
    // is gone, sessions that outlived their membership, delegations whose parent is gone, work
    // still assigned to a participant who cannot do it, and a closed swarm that still runs.
    // A row naming a recoverable holder carries the release operation as its next step.
    const organization = [];
    const gone = (row) => row.status !== 'active' || ['dead', 'exited', 'unbound'].includes(row.runtime.state);
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
      if (row.status === 'active' && ['dead', 'exited'].includes(row.runtime.state)) {
        organization.push({ kind: 'participant_runtime_dead', participantId: row.participantId, state: row.runtime.state });
      }
      if (row.status !== 'active' && ['working', 'blocked', 'pending', 'idle'].includes(row.runtime.state)) {
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
      ...operations.filter((event) => !this.store.priorCoordinationEvent(`${event.idempotencyKey}:completed`))
        .map((event) => ({ kind: 'operation_unconfirmed', command: event.payload.command, request: clone(event.payload.request),
          state: this.pending.has(event.idempotencyKey) ? 'in_progress' : 'unconfirmed',
          code: this.store.priorCoordinationEvent(`${event.idempotencyKey}:unavailable`)?.payload.code ?? null,
        })),
      ...organization,
    ];
    // A scoped view reports only the rows its subtree can act on.
    const scopedAttention = !scope ? attention : attention.flatMap((row) => {
      if (row.kind === 'operation_unconfirmed') return [row];
      if (row.kind === 'closed_with_live_participants') {
        const within = row.participantIds.filter((id) => scopeSubtree.includes(id));
        return within.length ? [{ ...row, participantIds: within }] : [];
      }
      return scopeSubtree.includes(row.participantId) ? [row] : [];
    });
    const availableActions = Object.entries(COMMAND_PERMISSIONS)
      .filter(([, permission]) => permissions.includes(permission)).map(([command]) => command);
    if (permissions.includes('contribute') && !availableActions.includes('swarm.check')) availableActions.push('swarm.check');
    if (permissions.includes('review') && !availableActions.includes('swarm.capture')) availableActions.push('swarm.capture');
    const updates = Object.entries(UPDATE_PERMISSIONS)
      .filter(([, permission]) => permissions.includes(permission)).map(([event]) => event);
    if (caller && !updates.includes('swarm.participant_left')) updates.push('swarm.participant_left');
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
    return {
      ...clone(swarm),
      participants: scope ? participants.filter((row) => scopeSubtree.includes(row.participantId)) : participants,
      work: keep(workEntries, ([workId]) => scopeWorkIds.has(workId)),
      assignments: keep(Object.entries(swarm.assignments ?? {}), ([, assignment]) => scopeSubtree.includes(assignment.participantId)
        || scopeWorkIds.has(assignment.workId)),
      contributions: keep(contributionEntries, ([, contribution]) => Boolean(contribution.workId)
        && scopeWorkIds.has(contribution.workId)),
      reviews: keep(Object.entries(swarm.reviews ?? {}), ([contributionId]) => scopedContributionIds.has(contributionId)),
      groups: keep(Object.entries(swarm.groups ?? {}), ([, group]) => group.members.every((member) => scopeSubtree.includes(member))),
      // A member sees the couplings its subtree can act on. Writer records follow the writer's
      // subtree; a synchronization point or group failure policy follows its group — every member
      // whose roster intersects the subtree sees it, so a seat listed in `awaiting` can always
      // read the point it is expected to arrive at (docs/39 §Declared coupling).
      couplings: keep(couplingEntries, ([, record]) => {
        if (record.coupling === 'writer') return scopeSubtree.includes(record.writer);
        const roster = swarm.groups?.[record.groupId]?.members ?? record.members ?? [];
        return roster.some((member) => scopeSubtree.includes(member));
      }),
      caller: { participantId: caller?.participantId ?? null, permissions: [...permissions] },
      availableActions, attention: scopedAttention,
      actionTargets: {
        'swarm.capture': { participantIds: contributionTargets },
        'swarm.check': { participantIds: contributionTargets },
      },
      updates,
      updatePayloads: Object.fromEntries(updates.map((kind) => [kind, {
        ...clone(SWARM_EVENT_PAYLOAD_SCHEMAS[kind]), example: clone(SWARM_EVENT_EXAMPLES[kind]),
      }])),
      cursor: this.store.ledgerHeadSeq(),
    };
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
      if (relevant || performance.now() >= deadline) return {
        ...this.inspect(swarm, principal, context),
        watch: {
          reason: relevant ? 'event' : 'timeout', afterSeq, matchedSeq: relevant?.seq ?? null,
          // The wake names what woke it, so a follower can act without re-reading the log.
          event: relevant ? { seq: relevant.seq, kind: relevant.kind, payloadKind: relevant.payload?.kind ?? null } : null,
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
            participantId: assignment.participantId, workId: assignment.workId, status: 'released' },
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
      for (const event of planned) this._write(event.kind, event.payload, principal, `${operationKey}:${event.key}`);
      return { participantId: holder.participantId, released: {
        assignments: releases.map((assignment) => assignment.assignmentId),
        groups: groupLeaves.map((group) => group.groupId),
      } };
    }, { replaySafe: true });
  }

  /** The public command entry: a refused MUTATION leaves a durable, wake-capable trace, and the
   * refusal itself is then thrown unchanged — the caller sees its own refusal, never a recording
   * failure wearing its name. */
  async command(command, args, principal, context = null) {
    try {
      return await this._dispatch(command, args, principal, context);
    } catch (error) {
      this._recordRefusal(command, args, principal, context, error);
      throw error;
    }
  }

  /** Record one refused mutation (issue #271 work W2) as the runtime's own durable
   * `swarm.operation_refused` driver row — {swarmId, command, event, code, field, participantId} —
   * so a watcher parked on swarm.watch wakes even though no swarm state changed and the fold never
   * saw a thing. Only mutations are recorded: a refused READ is the caller's own business.
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
      // The refusal's own named participant wins; when it names nobody (contract and state
      // refusals), the resolved caller is the participant whose mutation was refused.
      participantId: typeof error?.detail?.participantId === 'string'
        ? error.detail.participantId : this._refusalMember(swarmId, principal, context),
    };
    this.store.recordDriver('swarm.operation_refused', row, {
      actor: principal?.actor ?? 'swarm',
      key: `swarm-refusal:${hash([command, args ?? null, principal?.principalId ?? null, code, row.field, row.event])}`,
    });
  }

  /** Best-effort participant attribution for a refusal row, resolved through the same authority
   * the command used (_caller): identity enrichment must never replace the refusal itself, so a
   * resolution that refuses (a cross-swarm context, a claimed identity this swarm does not carry)
   * yields null instead of a refusal of its own. */
  _refusalMember(swarmId, principal, context) {
    try {
      const swarm = swarmId === null ? null : this.store.swarm(swarmId);
      return swarm ? this._caller(swarm, principal, context)?.participantId ?? null : null;
    } catch { return null; }
  }

  async _dispatch(command, args, principal, context = null) {
    if (this.watchController.signal.aborted) refuse('Swarm runtime is closed', 'swarm_runtime_closed');
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
      this._write('swarm.created', { swarmId, purpose: args.purpose }, principal,
        this._operationKey(command, { ...args, swarmId }, principal));
      return this.inspect(this._swarm(swarmId), principal, context);
    }
    let swarm = this._swarm(args.swarmId);
    if (command === 'swarm.view') {
      const scope = args.participantId ? this._participant(swarm, args.participantId) : null;
      return this.inspect(swarm, principal, context, scope?.participantId ?? null);
    }
    if (command === 'swarm.watch') {
      this._permit(swarm, principal, context, 'read');
      return this._watch(args, principal, context);
    }
    let permission = command === 'swarm.update' ? UPDATE_PERMISSIONS[args.event] : COMMAND_PERMISSIONS[command];
    if (!permission) refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
    if (command === 'swarm.check' || command === 'swarm.capture') {
      const author = this._caller(swarm, principal, context);
      permission = author?.participantId === args.participantId ? 'contribute' : 'review';
    }
    if (command === 'swarm.update' && args.event === 'swarm.participant_left') {
      const member = this._caller(swarm, principal, context);
      if (member && (!args.payload?.participantId || args.payload.participantId === member.participantId)) permission = 'read';
    }
    // Arriving at a declared synchronization point is a member's own honest report, not an
    // organizing act — when the arrival is (or defaults to) the caller, read authority suffices.
    if (command === 'swarm.update' && args.event === 'swarm.coupling_updated' && args.payload?.action === 'arrive') {
      const member = this._caller(swarm, principal, context);
      if (member && (!args.payload?.participantId || args.payload.participantId === member.participantId)) permission = 'read';
    }
    const caller = this._permit(swarm, principal, context, permission);
    if (command === 'swarm.update') {
      if (typeof args.payload === 'string' && args.event !== 'swarm.contribution_recorded') {
        refuse('This update needs its target fields; conversation text belongs in body', 'swarm_payload_invalid');
      }
      const payload = { ...(typeof args.payload === 'string' ? { body: args.payload } : clone(args.payload ?? {})), swarmId: args.swarmId };
      if (args.event === 'swarm.contribution_recorded') {
        if (!payload.participantId && !caller) {
          const participantId = `external-${hash([args.swarmId, principal.principalId]).slice(0, 32)}`;
          if (!Object.hasOwn(swarm.participants, participantId)) this._write('swarm.participant_joined', {
            swarmId: args.swarmId, participantId, role: 'External orchestrator', permissions: [...SWARM_PERMISSIONS],
          }, principal, `swarm-external:${hash([args.swarmId, principal.principalId])}`);
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
        await this._holderRelease(swarm, payload, args, principal, context);
        return this.inspect(this._swarm(args.swarmId), principal, context);
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
      this._write(args.event, payload, principal, this._operationKey(command, args, principal));
      if (caller && args.event === 'swarm.participant_left' && payload.participantId === caller.participantId) {
        return { swarmId: args.swarmId, participantId: caller.participantId, state: 'left', sessionStopped: false };
      }
      return this.inspect(this._swarm(args.swarmId), principal, context);
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
      await this.prepareRun({ runId, objective: args.objective, options: args.options ?? {} }, principal);
      // A request under a known operation key is the replay authority's to adjudicate (recovery of
      // an admitted-but-unbound recruit rides that path); decided before `_once` records this
      // request, because inside the effect every request is "known".
      const replaying = Boolean(this.store.priorCoordinationEvent(this._operationKey(command, args, principal)));
      return this._once(command, args, principal, async (sharedContext) => {
        this._permit(this._swarm(args.swarmId), principal, context, 'recruit');
        // The deliberate shared checkout is resolved inside the effect, before any membership is
        // written: an absent, departed, or process-less source refuses with nothing recorded, so
        // a refused attachment never leaks a holder into the swarm.
        const workspace = args.shareWorkspaceWith
          ? this._sharedWorkspace(swarm, args.shareWorkspaceWith, args.participantId)
          : null;
        // The membership write is keyed on (swarmId, participantId), so a NEW request recruiting a
        // name that already exists used to be served from the prior event without folding (an
        // identical payload: a success receipt for an operation that did not happen — the fold's
        // own `participant_duplicate` guard is unreachable through this path) or refused as a
        // REPLAY conflict (a different payload), naming an idempotency problem the caller does not
        // have. Anything that is not a replay and names an existing row is refused by name, naming
        // the row; the request's own shape (a self-referencing checkout, an unknown permission) is
        // judged first, as everywhere else (2026-09-14 audit S-E1/S-E2/S-N2).
        if (!replaying && Object.hasOwn(swarm.participants, args.participantId)) {
          refuse('Swarm participant already exists', 'swarm_participant_exists', {
            participantId: args.participantId, status: swarm.participants[args.participantId].status,
          });
        }
        // Membership precedes dispatch, so even a fast first native turn has the continuing
        // participant protocol. The underlying Run remains the existing execution authority.
        this._write('swarm.participant_joined', {
          swarmId: args.swarmId, participantId: args.participantId, role: args.objective,
          runId, permissions, ...(caller ? { parentId: caller.participantId } : {}),
          ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
        }, principal, `swarm-participant:${hash([args.swarmId, args.participantId])}`);
        await this.startRun({ runId, objective: args.objective, options: args.options ?? {},
          swarmId: args.swarmId, participantId: args.participantId, sharedContext,
          ...(workspace ? { workspace } : {}) }, principal, context);
        const worker = this.coordinator.list().find((row) => row.runId === runId);
        if (!worker) refuse('Recruitment admitted but worker binding is not yet available', 'swarm_participant_unbound', { runId });
        // The checkout this binding observed is recorded with the seat: the first recruit into a
        // checkout is armed here (an adopted checkout already carries its workspace from the join),
        // so the exclusive-writer guard has an identity to compare on every later claim.
        const checkout = typeof this.coordinator.workspaceAttachment === 'function'
          ? this.coordinator.workspaceAttachment(worker.id) : null;
        this._write('swarm.participant_bound', {
          swarmId: args.swarmId, participantId: args.participantId, workerId: worker.id, taskId: worker.taskId,
          ...(checkout ? { workspaceId: checkout.workspaceId } : {}),
        }, principal, `swarm-binding:${hash([args.swarmId, args.participantId, worker.id])}`);
        return { participantId: args.participantId, runId, swarmId: args.swarmId };
      }, { replaySafe: true, basis: Object.values(swarm.context) });
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
      if (!this._swarm(args.swarmId).contributions[args.contributionId]) this._write('swarm.contribution_recorded', {
        swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
      }, principal, `swarm-capture:${hash([args.swarmId, participant.participantId, args.contributionId])}`);
      // The revision record carries the checkout it was observed in, so a shared capture is
      // honest without reading a worker log: the swarm can tell which physical workspace the
      // revision came from and which HEAD it showed before the capture.
      this._write('swarm.contribution_revision_attached', {
        swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
        sha: capture.sha, ref: capture.ref,
        ...(capture.workspace?.physicalOwnerId ? { workspaceId: capture.workspace.physicalOwnerId } : {}),
        ...(capture.observedHead ? { observedHead: capture.observedHead } : {}),
      }, principal, `swarm-capture-revision:${hash([args.swarmId, participant.participantId, args.contributionId])}`);
      return capture;
    }
    if (command === 'swarm.check') {
      const checked = await this.coordinator.checkContribution(worker.id, {
        contributionId: args.contributionId, checkId: args.checkId,
      });
      const key = `swarm-check:${hash([args.swarmId, participant.participantId, args.contributionId, args.checkId])}`;
      if (!this.store.priorCoordinationEvent(key)) this._write('swarm.contribution_reviewed', {
        swarmId: args.swarmId, contributionId: args.contributionId,
        reviewerId: this._actorOf(caller, principal), decision: 'comment',
        reason: `Check ${args.checkId}: ${checked.passed ? 'passed' : 'failed'} for ${checked.sha}; cleanup ${checked.attempt?.cleanup?.state ?? 'unknown'}.`,
      }, principal, key);
      return checked;
    }
    if (command === 'swarm.guide') {
      return this._once(command, args, principal, async () => {
        const cursor = this.store.ledgerHeadSeq();
        const result = await this.coordinator.guideParticipant(worker.id, args.message, { actor: principal.actor });
        // The lane receipt is durable coordination log, not process state: deliveries are
        // serialized per worker, so the newest nudge row for this binding past the pre-call
        // cursor is the row THIS guide wrote — read back and returned as its receipt.
        const sent = this.store.eventsView().filter((event) => event.kind === 'message.sent'
          && event.payload?.kind === 'nudge' && event.payload?.to?.workerId === worker.id
          && event.seq > cursor).at(-1);
        return { participantId: participant.participantId, result,
          guide: sent ? { seq: sent.seq, ts: sent.ts, messageId: sent.payload.messageId ?? null } : null };
      });
    }
    if (command === 'swarm.stop') {
      return this._once(command, args, principal, async () => {
        const result = await this.stopRun(participant.runId, args.reason, principal);
        return { participantId: participant.participantId, result };
      });
    }
    refuse('Swarm operation is unavailable', 'swarm_command_unavailable');
  }
}
