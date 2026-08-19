import { resolve } from 'node:path';

import {
  installProductionApplicationConvergence,
  registerProductionApplicationRuntime,
  unregisterProductionApplicationRuntime,
} from './production-application-convergence.mjs';
import {
  ProductionConvergenceRuntime,
  createProductionCommandRegistry,
  wrapProductionClient,
  wrapProductionDeployment as wrapBaseProductionDeployment,
} from './production-convergence.mjs';
import {
  AutomaticRecoveryController,
  DurableEventJournal,
  DurableMemberSupervisor,
  DurableNotificationBus,
  readConvergenceState,
  resolveConvergenceStateRoot,
  writeConvergenceState,
} from './production-convergence-state.mjs';
import { digestValue, replayProjection } from './holistic-runtime.mjs';

const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const durableProjectors = () => [
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

/**
 * Durable form of the additive convergence runtime. The existing Baton deployment remains the
 * execution and authorization authority; this class persists only convergence receipts,
 * subscriptions, member-attempt metadata and recovery bookkeeping.
 */
export class DurableProductionConvergenceRuntime extends ProductionConvergenceRuntime {
  #persisting = false;
  #persistedSeq = 0;
  #stateDigest = null;
  #terminalPins;
  #evaluation;
  #closed = false;

  constructor(options = {}) {
    const repoRoot = resolve(options.repoRoot ?? process.cwd());
    const stateRoot = resolve(options.stateRoot ?? resolveConvergenceStateRoot({
      repoRoot,
      deploymentRoot: options.deploymentRoot ?? null,
    }));
    const stored = readConvergenceState(stateRoot);
    const journal = new DurableEventJournal(stored?.events ?? []);
    super({ ...options, repoRoot, journal });

    this.repoRoot = repoRoot;
    this.stateRoot = stateRoot;
    this.notifications = new DurableNotificationBus(this.journal, stored?.subscriptions ?? []);
    this.members = new DurableMemberSupervisor(this.journal, {
      retryBudget: options.retryBudget ?? 2,
      members: stored?.members ?? [],
    });
    this.supervisor = this.members;
    this.recovery = new AutomaticRecoveryController({
      records: stored?.recovery ?? {},
      retryBudget: options.retryBudget ?? 2,
    });
    this.#terminalPins = new Set(stored?.terminalPins ?? []);
    this.#evaluation = clone(stored?.evaluation ?? {});
    this.#persistedSeq = stored?.events?.at(-1)?.seq ?? 0;
    this.#stateDigest = stored ? digestValue(stored) : null;

    this.journal.setMutationHook(() => this.persist());
    this.journal.append('deployment.opened', {
      reopened: stored !== null,
      stateRootDigest: digestValue(stateRoot),
      registryDigest: this.registry.digest(),
    });
  }

  #state() {
    const events = this.journal.snapshot();
    const seq = events.at(-1)?.seq ?? 0;
    return {
      schemaVersion: 1,
      repoRootDigest: digestValue(this.repoRoot),
      registryDigest: this.registry.digest(),
      events,
      // Reopen folds the full journal through production projectors. This coordinate is audit
      // metadata rather than a competing projection authority.
      projection: {
        schemaVersion: 1,
        seq,
        digest: this.projections.digest(),
      },
      subscriptions: typeof this.notifications.snapshotSubscriptions === 'function'
        ? this.notifications.snapshotSubscriptions() : [],
      members: typeof this.members.snapshot === 'function' ? this.members.snapshot() : [],
      recovery: this.recovery.snapshot(),
      terminalPins: [...this.#terminalPins].sort(),
      evaluation: clone(this.#evaluation),
    };
  }

  persist() {
    if (this.#persisting) return this.stateRoot;
    this.#persisting = true;
    try {
      const state = this.#state();
      writeConvergenceState(this.stateRoot, state);
      this.#persistedSeq = state.events.at(-1)?.seq ?? 0;
      this.#stateDigest = digestValue(state);
      return this.stateRoot;
    } finally {
      this.#persisting = false;
    }
  }

  observeApplicationCommand(input) {
    const scheduled = this.recovery.consider({ ...input, runtime: this });
    this.persist();
    return scheduled;
  }

  registerTerminalPin(pin) {
    if (typeof pin !== 'string' || pin.length === 0) throw new TypeError('terminal pin is required');
    if (!this.#terminalPins.has(pin)) {
      this.#terminalPins.add(pin);
      this.journal.append('terminal_pin.registered', { pin });
    }
    return pin;
  }

  get terminalPins() {
    return new Set(this.#terminalPins);
  }

  recordEvaluation(metrics) {
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
      throw new TypeError('evaluation metrics must be an object');
    }
    this.#evaluation = clone(metrics);
    this.journal.append('evaluation.recorded', {
      metrics: clone(metrics),
      metricsDigest: digestValue(metrics),
    });
    return freeze(clone(metrics));
  }

  replayDigest({ snapshot = null } = {}) {
    return replayProjection({
      events: this.journal.events(),
      projectors: durableProjectors(),
      snapshot,
    }).digest();
  }

  async close() {
    if (this.#closed) return freeze({ schemaVersion: 1, state: 'closed' });
    await this.drain();
    this.journal.append('convergence.closed', {});
    this.#closed = true;
    this.persist();
    return freeze({ schemaVersion: 1, state: 'closed' });
  }

  audit() {
    const base = super.audit();
    return freeze({
      ...clone(base),
      storage: {
        stateRoot: this.stateRoot,
        persistedSeq: this.#persistedSeq,
        stateDigest: this.#stateDigest,
      },
      recovery: this.recovery.snapshot(),
      evaluation: clone(this.#evaluation),
      terminalPins: [...this.#terminalPins].sort(),
    });
  }
}

function wrapCommandClient(client, runtime) {
  const direct = wrapProductionClient(client, { runtime });
  if (typeof direct.command !== 'function') return direct;
  return new Proxy(direct, {
    get(target, key, receiver) {
      if (key === 'command') {
        return async (name, args, ...rest) => {
          const registered = runtime.registry.rows().some((row) => row.key === name);
          if (!registered) return target.command(name, args, ...rest);
          return runtime.invoke(name, args, () => target.command(name, args, ...rest));
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Explicit deployment decorator. It composes over the public facade and, when a deployment offers
 * the internal testing/client seam, gives every client the same durable convergence runtime.
 */
export function wrapProductionDeployment(deployment, options = {}) {
  if (!deployment || typeof deployment !== 'object') throw new TypeError('deployment is required');
  const runtime = options.runtime ?? new DurableProductionConvergenceRuntime({
    deployment,
    ...options,
  });
  runtime.attach(deployment);

  if (deployment.application) {
    installProductionApplicationConvergence();
    registerProductionApplicationRuntime(deployment.application, runtime);
  }

  const wrapped = wrapBaseProductionDeployment(deployment, { ...options, runtime });
  let closed = false;
  return new Proxy(wrapped, {
    get(target, key, receiver) {
      if (key === 'convergence') return runtime;
      if (key === 'client' && typeof target.client === 'function') {
        return (...args) => wrapCommandClient(target.client(...args), runtime);
      }
      if (key === 'host' && typeof target.host === 'function') {
        return async (...args) => {
          const result = await target.host(...args);
          runtime.journal.append('deployment.hosted', {
            resultDigest: digestValue(result ?? null),
          });
          return result;
        };
      }
      if (key === 'close' && typeof target.close === 'function') {
        return async (...args) => {
          if (closed) return target.close(...args);
          try {
            const result = await target.close(...args);
            runtime.journal.append('deployment.closed', {
              resultDigest: digestValue(result ?? null),
            });
            closed = true;
            return result;
          } catch (error) {
            runtime.journal.append('deployment.close_failed', {
              code: error?.code ?? 'deployment_close_failed',
            });
            throw error;
          } finally {
            unregisterProductionApplicationRuntime(deployment.application, runtime);
            runtime.persist();
          }
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, key) {
      return key === 'convergence' || Reflect.has(target, key);
    },
  });
}

export {
  ProductionConvergenceRuntime,
  createProductionCommandRegistry,
  wrapProductionClient,
};
