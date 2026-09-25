import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  BatonControlError,
  DeploymentContinuity,
  EventJournal,
  IsolationAuthority,
  MemberSupervisor,
  NotificationBus,
  ProjectionStore,
  ReadinessResolver,
  UnifiedCommandRegistry,
  crashSafeWriteJson,
  digestValue,
  preregisterEvaluation,
  reapEligibleArtifacts,
  replayProjection,
} from './holistic-runtime.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const clone = (value) => value == null ? value : structuredClone(value);
const effectLane = (key) => {
  if (key === 'deployment.close' || key === 'run.stop' || key === 'run.interrupt') return 'emergency_control';
  if (key.startsWith('deployment.') || key.startsWith('member.recover')) return 'lifecycle_effects';
  if (key.startsWith('reconcile.')) return 'background_reconcile';
  if (key.startsWith('evidence.') || key.startsWith('evaluation.')) return 'bulk_evidence';
  return 'interactive_control';
};
const LANES = Object.freeze([
  'emergency_control', 'interactive_control', 'lifecycle_effects', 'background_reconcile', 'bulk_evidence',
]);

/**
 * Production scheduler with reserved capacity per lane. A blocked reconcile or bulk operation can
 * consume only its own lane, so emergency and interactive control cannot be starved by unrelated
 * externally-controlled work. Each lane serializes its own authority while independent lanes run
 * concurrently.
 */
export class ReservedLaneScheduler {
  #queues = new Map(LANES.map((lane) => [lane, []]));
  #active = new Map(LANES.map((lane) => [lane, null]));
  enqueue(lane, task, metadata = {}) {
    if (!this.#queues.has(lane)) throw new BatonControlError('lane_unknown', `unknown lane ${lane}`);
    if (typeof task !== 'function') throw new TypeError('task must be a function');
    return new Promise((resolvePromise, rejectPromise) => {
      this.#queues.get(lane).push({ task, metadata: clone(metadata), resolvePromise, rejectPromise });
      this.#pump(lane);
    });
  }
  #pump(lane) {
    if (this.#active.get(lane) !== null) return;
    const next = this.#queues.get(lane).shift();
    if (!next) return;
    const token = freeze({ lane, metadata: clone(next.metadata) });
    this.#active.set(lane, token);
    Promise.resolve().then(next.task).then(next.resolvePromise, next.rejectPromise).finally(() => {
      this.#active.set(lane, null);
      this.#pump(lane);
    });
  }
  state() {
    return freeze({
      active: LANES.flatMap((lane) => this.#active.get(lane) ? [clone(this.#active.get(lane))] : []),
      queued: Object.fromEntries(LANES.map((lane) => [lane, this.#queues.get(lane).length])),
    });
  }
  async drain() {
    while (LANES.some((lane) => this.#active.get(lane) !== null || this.#queues.get(lane).length > 0)) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 0));
    }
  }
}

export const PRODUCTION_CONVERGENCE_COMMANDS = freeze([
  { key: 'run.start', capabilities: ['control'], mode: 'effect' },
  { key: 'run.start_many', capabilities: ['control'], mode: 'effect' },
  { key: 'run.workflow', capabilities: ['control'], mode: 'effect' },
  { key: 'run.explore', capabilities: ['control'], mode: 'effect' },
  { key: 'run.review', capabilities: ['control'], mode: 'effect' },
  { key: 'run.interrupt', capabilities: ['control', 'emergency_stop'], mode: 'effect' },
  { key: 'run.stop', capabilities: ['control', 'emergency_stop'], mode: 'effect' },
  { key: 'wave.start', capabilities: ['control'], mode: 'effect' },
  { key: 'deployment.close', capabilities: ['emergency_stop'], mode: 'effect' },
  { key: 'deployment.readiness', capabilities: ['observe'], mode: 'query' },
  { key: 'run.attention.watch', capabilities: ['observe'], mode: 'query', notification: true },
  { key: 'run.attention.ack', capabilities: ['control', 'observe'], mode: 'effect', notification: true },
  { key: 'run.message.send', capabilities: ['control', 'observe'], mode: 'effect', notification: true },
  { key: 'run.message.receipt', capabilities: ['observe'], mode: 'query', notification: true },
  { key: 'run.decision.answer', capabilities: ['approve', 'control'], mode: 'effect', notification: true },
  { key: 'member.recover', capabilities: ['control'], mode: 'effect' },
  { key: 'state.checkpoint', capabilities: ['observe'], mode: 'effect' },
  { key: 'state.reap', capabilities: ['control'], mode: 'effect' },
  { key: 'evaluation.record', capabilities: ['observe'], mode: 'effect' },
].map((row) => ({ ...row, lane: effectLane(row.key) })));

export function createProductionCommandRegistry() {
  const registry = new UnifiedCommandRegistry();
  for (const row of PRODUCTION_CONVERGENCE_COMMANDS) registry.register(row);
  return registry;
}

const productionProjectors = () => [
  {
    name: 'commandFates', initial: {}, reducer: (state, event) => {
      if (event.type === 'command.admitted') state[event.data.commandId] = 'admitted';
      if (event.type === 'effect.succeeded') state[event.data.commandId] = 'succeeded';
      if (event.type === 'effect.failed') state[event.data.commandId] = 'failed';
      return state;
    },
  },
  {
    name: 'attentionOpen', initial: 0, reducer: (state, event) => {
      if (event.type === 'attention.created') return state + 1;
      if (event.type === 'attention.resolved') return Math.max(0, state - 1);
      return state;
    },
  },
];

function projectJournal(journal, snapshot = null) {
  return replayProjection({ events: journal.events(), projectors: productionProjectors(), snapshot });
}

export class ProductionConvergenceRuntime {
  #outcomes = new Map();
  #pending = new Map();
  #deployment = null;
  #readiness;
  #terminalPins = new Set();
  #retryBudget;
  #projectionUnsubscribe = null;
  constructor({
    deployment = null,
    repoRoot = process.cwd(),
    worktreeRoot = resolve(process.cwd(), '.baton', 'worktrees'),
    concurrency: _concurrency = 8,
    retryBudget = 2,
    resolveRoute = null,
    journal = null,
  } = {}) {
    this.registry = createProductionCommandRegistry();
    this.journal = journal ?? new EventJournal();
    this.scheduler = new ReservedLaneScheduler();
    this.notifications = new NotificationBus(this.journal);
    this.#retryBudget = retryBudget;
    this.members = new MemberSupervisor(this.journal, { retryBudget });
    this.projections = projectJournal(this.journal);
    this.#bindProjectionUpdates();
    this.isolation = new IsolationAuthority({ repoRoot, worktreeRoot });
    this.#deployment = deployment;
    const routeResolver = resolveRoute ?? ((selector, { dryRun = false } = {}) => {
      if (!this.#deployment || typeof this.#deployment.doctorReadiness !== 'function') {
        return { route: selector, predicates: { processLive: true, busResponsive: true, dryRun } };
      }
      const readiness = this.#deployment.doctorReadiness();
      const routes = readiness?.routes ?? [];
      const exact = selector && typeof selector === 'object' ? selector : { route: selector };
      const match = routes.find((row) => ['harness', 'model', 'effort'].every((field) => exact[field] === undefined || exact[field] === row[field]));
      if (!match || match.state !== 'ready') {
        throw new BatonControlError(match?.code ?? 'route_unavailable', match?.summary ?? 'route is not dispatchable', {
          retryable: true, action: 'inspect_readiness',
        });
      }
      return {
        route: match,
        predicates: {
          processLive: match.liveness?.state !== 'dead',
          busResponsive: true,
          authenticated: match.runtime?.authentication?.state !== 'invalid',
          dryRun,
        },
      };
    });
    this.#readiness = new ReadinessResolver(routeResolver);
  }

  #bindProjectionUpdates() {
    this.#projectionUnsubscribe?.();
    this.#projectionUnsubscribe = this.journal.subscribe((event) => this.projections.apply(event));
  }

  attach(deployment) { this.#deployment = deployment; return this; }
  readiness(selector, context = {}) { return this.#readiness.evaluate(selector, context); }
  assertDispatchEquivalent(selector, context = {}) { return this.#readiness.assertEquivalent(selector, context); }

  async invoke(commandName, args, effect, context = {}) {
    const definition = this.registry.resolve(commandName);
    if (definition.mode === 'query') return effect();
    const commandId = context.commandId ?? `cmd:${randomUUID()}`;
    const admission = this.journal.append('command.admitted', {
      commandId, command: definition.key, args: clone(args), principalId: context.principalId ?? null,
    });
    const receipt = freeze({ commandId, command: definition.key, admittedSeq: admission.seq, state: 'admitted' });
    this.#outcomes.set(commandId, receipt);
    const promise = this.scheduler.enqueue(definition.lane, async () => {
      this.journal.assertExternalAwaitAllowed();
      this.journal.append('effect.requested', { commandId, command: definition.key });
      try {
        const value = await effect();
        const terminal = this.journal.append('effect.succeeded', {
          commandId, command: definition.key, resultDigest: digestValue(value ?? null),
        });
        const settled = freeze({ ...receipt, state: 'succeeded', terminalSeq: terminal.seq, result: value });
        this.#outcomes.set(commandId, settled);
        this.#terminalPins.add(commandId);
        return value;
      } catch (error) {
        const typed = BatonControlError.from(error);
        const terminal = this.journal.append('effect.failed', { commandId, command: definition.key, error: typed.envelope().error });
        this.#outcomes.set(commandId, freeze({ ...receipt, state: 'failed', terminalSeq: terminal.seq, error: typed.envelope().error }));
        this.#terminalPins.add(commandId);
        throw error;
      } finally {
        this.#pending.delete(commandId);
      }
    }, { commandId, command: definition.key });
    this.#pending.set(commandId, promise);
    return promise;
  }

  receipt(commandId) {
    const value = this.#outcomes.get(commandId);
    if (!value) throw new BatonControlError('command_unknown', `unknown command ${commandId}`);
    return value;
  }
  pending() { return freeze([...this.#pending.keys()]); }
  async drain() { await this.scheduler.drain(); }

  createAttention(input) { return this.notifications.publishAttention(input); }
  acknowledgeAttention(id, principalId) { return this.notifications.acknowledgeAttention(id, principalId); }
  resolveAttention(id, principalId) { return this.notifications.resolveAttention(id, principalId); }
  sendMessage(input) { return this.notifications.sendMessage(input); }
  classifyMessage(id, fate, detail = null) { return this.notifications.messageFate(id, fate, detail); }
  requestDecision(input) { return this.notifications.requestDecision(input); }
  settleDecision(id, settlement) { return this.notifications.settleDecision(id, settlement); }
  subscribe(input) { return this.notifications.subscribe(input); }
  poll(subscriptionId, options = {}) { return this.notifications.poll(subscriptionId, options); }
  acknowledgeCursor(subscriptionId, cursor) { return this.notifications.acknowledgeCursor(subscriptionId, cursor); }
  collaborationCensus() { return this.notifications.census(); }

  addMember(member) { return this.members.addMember(member); }
  startAttempt(memberId, allocation) { return this.members.startAttempt(memberId, allocation); }
  classifyDeath(memberId, classification) { return this.members.classifyDeath(memberId, classification); }
  recoverMember(memberId, evidence = {}) {
    const outcome = this.members.recover(memberId, evidence);
    if (outcome.action === 'attention_required') {
      this.createAttention({ runId: evidence.runId ?? memberId, kind: 'workflow_recovery', detail: outcome });
    }
    return outcome;
  }

  authorizeWrite(input) { return this.isolation.authorizeWrite(input); }
  authorizeRun(principal, runId) { return this.isolation.authorizeRun(principal, runId); }

  checkpoint({ active = [], subscriptions = [] } = {}) {
    // Snapshot authority is rebuilt synchronously from the exact journal boundary. The live
    // incremental projection is intentionally not trusted here because EventJournal publishes
    // subscriber updates on a microtask after append; persisting seq N with a projection at N-1
    // would make snapshot+suffix replay skip event N.
    const authoritative = projectJournal(this.journal);
    const continuity = new DeploymentContinuity({
      journal: this.journal, projections: authoritative, notifications: this.notifications,
    });
    return continuity.checkpoint({ active, subscriptions });
  }

  restore(checkpoint) {
    const restoredJournal = new EventJournal().restore(this.journal.snapshot());
    const restoredProjections = projectJournal(restoredJournal, checkpoint.projection);
    const restoredNotifications = new NotificationBus(restoredJournal);
    for (const subscription of checkpoint.subscriptions ?? []) {
      restoredNotifications.restoreSubscription(subscription);
    }
    const restored = freeze({
      active: clone(checkpoint.active ?? []),
      subscriptions: clone(checkpoint.subscriptions ?? []),
      seq: checkpoint.seq,
    });
    this.#projectionUnsubscribe?.();
    this.journal = restoredJournal;
    this.projections = restoredProjections;
    this.notifications = restoredNotifications;
    this.members = new MemberSupervisor(restoredJournal, { retryBudget: this.#retryBudget });
    this.#bindProjectionUpdates();
    return restored;
  }

  compact(path, checkpoint, options = {}) { return crashSafeWriteJson(path, checkpoint, options); }
  reap(artifacts, options = {}) {
    return reapEligibleArtifacts(artifacts, {
      terminalPins: options.terminalPins ?? this.#terminalPins,
      maxBytes: options.maxBytes,
    });
  }
  evaluation(cases) { return preregisterEvaluation(cases); }

  audit() {
    return freeze({
      schemaVersion: 1,
      registryDigest: this.registry.digest(),
      journalDigest: this.journal.digest(),
      projectionDigest: this.projections.digest(),
      scheduler: this.scheduler.state(),
      collaboration: this.notifications.census(),
      pending: [...this.#pending.keys()],
    });
  }
}

const wrapMethod = (runtime, target, key, command) => async (...args) => runtime.invoke(command, args, () => target[key](...args));

/**
 * Production facade preserving the public deployment API while routing the effectful top-level
 * lifecycle through the convergence scheduler/journal. The original deployment remains the
 * execution authority; this layer owns admission, fate, recovery/attention, and replay metadata.
 */
export function wrapProductionDeployment(deployment, options = {}) {
  if (!deployment || typeof deployment !== 'object') throw new TypeError('deployment is required');
  const runtime = options.runtime ?? new ProductionConvergenceRuntime({ deployment, ...options });
  runtime.attach(deployment);
  const wrappers = new Map([
    ['run', wrapMethod(runtime, deployment, 'run', 'run.start')],
    ['startMany', wrapMethod(runtime, deployment, 'startMany', 'run.start_many')],
    ['workflow', wrapMethod(runtime, deployment, 'workflow', 'run.workflow')],
    ['explore', wrapMethod(runtime, deployment, 'explore', 'run.explore')],
    ['review', wrapMethod(runtime, deployment, 'review', 'run.review')],
    ['close', wrapMethod(runtime, deployment, 'close', 'deployment.close')],
  ]);
  return new Proxy(deployment, {
    get(target, key, receiver) {
      if (key === 'convergence') return runtime;
      if (wrappers.has(key)) return wrappers.get(key);
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, key) { return key === 'convergence' || Reflect.has(target, key); },
  });
}

/** Add the same admission/fate plane to an arbitrary surface client without requiring a second
 * command registry. Methods not listed remain byte-for-byte transparent. */
export function wrapProductionClient(client, { runtime = new ProductionConvergenceRuntime(), commands = {} } = {}) {
  const defaults = {
    run: 'run.start', start: 'run.start', startMany: 'run.start_many', workflow: 'run.workflow',
    explore: 'run.explore', review: 'run.review', interrupt: 'run.interrupt', stop: 'run.stop',
    close: 'deployment.close',
  };
  const map = { ...defaults, ...commands };
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'convergence') return runtime;
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      const command = map[key];
      if (!command || !runtime.registry.rows().some((row) => row.key === command)) return value.bind(target);
      return (...args) => runtime.invoke(command, args, () => value.apply(target, args));
    },
    has(target, key) { return key === 'convergence' || Reflect.has(target, key); },
  });
}
