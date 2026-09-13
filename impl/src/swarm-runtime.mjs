import { validateSwarmCommand } from './swarm-contract.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-order.mjs';

const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
const refuse = (message, code, detail = {}) => { throw Object.assign(new Error(message), { code, detail }); };
export const SWARM_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute', 'review', 'organize', 'recruit', 'stop']);
const DEFAULT_PERMISSIONS = Object.freeze(['read', 'communicate', 'contribute']);
const UPDATE_PERMISSIONS = Object.freeze({
  'swarm.group_updated': 'organize', 'swarm.work_updated': 'organize',
  'swarm.assignment_updated': 'organize', 'swarm.context_updated': 'communicate',
  'swarm.contribution_recorded': 'contribute', 'swarm.contribution_reviewed': 'review',
  'swarm.participant_left': 'organize', 'swarm.closed': 'organize',
});
const COMMAND_PERMISSIONS = Object.freeze({
  'swarm.inspect': 'read', 'swarm.watch': 'read', 'swarm.recruit': 'recruit',
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

  _caller(swarm, principal, context) {
    if (context?.swarmId && context.swarmId !== swarm.swarmId) {
      refuse('Native participant authority belongs to another swarm', 'swarm_membership_required');
    }
    const workerId = principal.principalId?.startsWith('worker:')
      ? principal.principalId.slice('worker:'.length) : null;
    if (!workerId && !context?.runId) return null;
    const workerRun = workerId ? this.coordinator.list().find((row) => row.id === workerId)?.runId : null;
    const participant = Object.values(swarm.participants).find((row) => row.status === 'active'
      && ((workerId && row.bindings.at(-1)?.workerId === workerId)
        || (workerRun && row.runId === workerRun)
        || (context?.runId && row.runId === context.runId)));
    if (!participant) refuse('This agent has no active membership in the swarm', 'swarm_membership_required');
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
      refuse('The prior operation needs reconciliation before its effects can be repeated', 'swarm_operation_unconfirmed', {
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

  inspect(swarm, principal, context) {
    const caller = this._permit(swarm, principal, context, 'read');
    const permissions = caller?.permissions ?? (caller ? DEFAULT_PERMISSIONS : SWARM_PERMISSIONS);
    const workers = this.coordinator.list();
    const participants = Object.values(swarm.participants).map((participant) => {
      const worker = workers.find((row) => row.runId === participant.runId
        && (!participant.bindings.length || row.id === participant.bindings.at(-1)?.workerId));
      const paused = worker ? this.coordinator.pausedTurns({ workerId: worker.id }) : [];
      return { ...clone(participant), native: worker && this.coordinator.observedNativeSubagents
        ? this.coordinator.observedNativeSubagents(worker.id)
        : { coverage: 'observed_only', agents: [], invocations: [], unidentified: [] }, runtime: {
        workerId: worker?.id ?? null, state: worker?.status ?? 'unbound',
        turn: paused.length ? 'paused' : worker?.status === 'working' ? 'running' : null,
      } };
    });
    const operations = this.store.eventsView().filter((event) => event.kind === 'driver.recorded'
      && event.payload.swarmId === swarm.swarmId && event.payload.kind === 'swarm.operation_requested');
    const attention = operations.filter((event) => !this.store.priorCoordinationEvent(`${event.idempotencyKey}:completed`))
      .map((event) => ({ command: event.payload.command, request: clone(event.payload.request),
        state: this.pending.has(event.idempotencyKey) ? 'in_progress' : 'unconfirmed',
        code: this.store.priorCoordinationEvent(`${event.idempotencyKey}:unavailable`)?.payload.code ?? null,
      }));
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
    return {
      ...clone(swarm), participants,
      caller: { participantId: caller?.participantId ?? null, permissions: [...permissions] },
      availableActions, attention,
      actionTargets: {
        'swarm.capture': { participantIds: contributionTargets },
        'swarm.check': { participantIds: contributionTargets },
      },
      updates,
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
      const events = this.store.eventsView().slice(cursor);
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
        watch: { reason: relevant ? 'event' : 'timeout', afterSeq, matchedSeq: relevant?.seq ?? null },
      };
      cursor = this.store.ledgerHeadSeq();
      await this.store.waitAfter(cursor, Math.max(1, Math.ceil(deadline - performance.now())), {
        signal: this.watchController.signal,
      });
    }
  }

  async command(command, args, principal, context = null) {
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
    if (command === 'swarm.inspect') return this.inspect(swarm, principal, context);
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
      if (caller && args.event === 'swarm.contribution_recorded' && payload.participantId !== caller.participantId) {
        refuse('Contributions must name their actual author', 'swarm_author_mismatch');
      }
      if (caller && args.event === 'swarm.contribution_reviewed') {
        if (payload.reviewerId && payload.reviewerId !== caller.participantId) refuse('Review author does not match caller', 'swarm_author_mismatch');
        payload.reviewerId = caller.participantId;
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
      return this._once(command, args, principal, async (sharedContext) => {
        // Membership precedes dispatch, so even a fast first native turn has the continuing
        // participant protocol. The underlying Run remains the existing execution authority.
        this._permit(this._swarm(args.swarmId), principal, context, 'recruit');
        this._write('swarm.participant_joined', {
          swarmId: args.swarmId, participantId: args.participantId, role: args.objective,
          runId, permissions, ...(caller ? { parentId: caller.participantId } : {}),
        }, principal, `swarm-participant:${hash([args.swarmId, args.participantId])}`);
        await this.startRun({ runId, objective: args.objective, options: args.options ?? {},
          swarmId: args.swarmId, participantId: args.participantId, sharedContext }, principal, context);
        const worker = this.coordinator.list().find((row) => row.runId === runId);
        if (!worker) refuse('Recruitment admitted but worker binding is not yet available', 'swarm_participant_unbound', { runId });
        this._write('swarm.participant_bound', {
          swarmId: args.swarmId, participantId: args.participantId, workerId: worker.id, taskId: worker.taskId,
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
      this._write('swarm.contribution_revision_attached', {
        swarmId: args.swarmId, participantId: participant.participantId, contributionId: args.contributionId,
        sha: capture.sha, ref: capture.ref,
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
        ...(caller ? { reviewerId: caller.participantId } : {}), decision: 'comment',
        reason: `Check ${args.checkId}: ${checked.passed ? 'passed' : 'failed'} for ${checked.sha}; cleanup ${checked.attempt?.cleanup?.state ?? 'unknown'}.`,
      }, principal, key);
      return checked;
    }
    if (command === 'swarm.guide') {
      return this._once(command, args, principal, async () => {
        const result = await this.coordinator.guideParticipant(worker.id, args.message, { actor: principal.actor });
        return { participantId: participant.participantId, result };
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
