// swarm-client.mjs — the agent-facing SDK for living swarms (docs/39-swarm-runtime.md).
//
// The SDK is a thin, honest facade over the swarm command port. It mints one idempotency key per
// effectful invocation (never per retry loop), validates each request against the SAME closed
// contract the runtime enforces (swarm-surface.mjs `validateSwarmCommand`), and returns the
// runtime's JSON unmodified: a cancel is the operation that happened, a capture is the exact
// immutable revision that was captured, a check is an observation about identified work under
// identified conditions — never a "task complete" verdict, and never a permission the client
// computed for itself. `inspect()` (and every mutation's returned view) carries the authoritative
// `caller` authority and `availableActions`; read those.
//
// Handles are coordinates, not sessions: `swarms.create()`/`swarms.open()` give a Swarm whose id
// plus inspect/recruit/guide/capture/check/stop work without the caller ever handling a worker id,
// a turn coordinate, or a fence.

import { randomUUID } from 'node:crypto';
import { validateSwarmCommand } from './swarm-surface.mjs';

function clientError(message, code = 'application_client_invalid') {
  return Object.assign(new Error(message), { code });
}

function exactOptions(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))) {
    throw clientError(`${label} options are invalid`);
  }
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

function idempotencyOf(options) {
  return options.idempotencyKey ?? randomUUID();
}

/** swarm.create's result must name the swarm it created; a caller-supplied identity is the
 * authoritative one and a divergent answer is a protocol violation, not something to paper over. */
function swarmIdFrom(result, requested) {
  const returned = result?.swarmId ?? result?.swarm?.swarmId ?? null;
  if (requested !== undefined && returned !== null && returned !== requested) {
    throw clientError('Swarm create returned a different swarm identity', 'swarm_protocol_invalid');
  }
  const swarmId = requested ?? returned;
  if (!isText(swarmId)) {
    throw clientError('Swarm create response did not name the swarm', 'swarm_protocol_invalid');
  }
  return swarmId;
}

export class Swarm {
  #port;
  #last;

  constructor(port, swarmId, last = null) {
    if (!port || typeof port.command !== 'function' || !isText(swarmId)) {
      throw clientError('Swarm handle authority is invalid');
    }
    this.#port = port;
    this.#last = last;
    this.id = swarmId;
    Object.freeze(this);
  }

  /** The most recent JSON result this handle saw (create response or the last verb's view). */
  get last() { return this.#last; }

  /** The coordination cursor of the last view, when it carried one. */
  get cursor() {
    const cursor = this.#last?.cursor;
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
  }

  async _send(name, args) {
    validateSwarmCommand(name, args);
    this.#last = await this.#port.command(name, args);
    return this.#last;
  }

  /** Read the authoritative swarm view: purpose, status, participants with their runtime state,
   * groups, work, assignments, context, contributions, reviews, `caller` authority,
   * `availableActions`, recent `updates`, and `cursor`. */
  inspect() {
    return this._send('swarm.inspect', { swarmId: this.id });
  }

  /**
   * Event-driven observation: await the next coordination append past `afterSeq` and return the
   * refreshed inspect view. `afterSeq` defaults to the cursor of the last view this handle saw, so
   * a plain `await swarm.watch({ timeoutMs })` waits for "something new since I last looked".
   * One call, one await — the caller owns any loop, and a timeout returns the refreshed view
   * rather than being mistaken for progress.
   */
  watch(options = {}) {
    exactOptions(options, new Set(['afterSeq', 'timeoutMs']), 'Swarm watch');
    const afterSeq = options.afterSeq ?? this.cursor ?? undefined;
    return this._send('swarm.watch', {
      swarmId: this.id,
      ...(afterSeq === undefined ? {} : { afterSeq }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  /**
   * Recruit one participant. `options.options` is the Run start selection ({exact, scope,
   * profile}); `options.permissions` is the requested grant set. The runtime resolves the native
   * Run identity, admits it under the caller's authority, and starts it; the caller never handles
   * a worker id or a fence.
   */
  recruit(participantId, objective, options = {}) {
    exactOptions(options, new Set(['options', 'permissions', 'idempotencyKey']), 'Swarm recruit');
    return this._send('swarm.recruit', {
      swarmId: this.id,
      participantId,
      objective,
      ...(options.options === undefined ? {} : { options: options.options }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
      idempotencyKey: idempotencyOf(options),
    });
  }

  /** Send guidance to one participant, active or paused. */
  guide(participantId, message, options = {}) {
    exactOptions(options, new Set(['idempotencyKey']), 'Swarm guide');
    return this._send('swarm.guide', {
      swarmId: this.id, participantId, message, idempotencyKey: idempotencyOf(options),
    });
  }

  /** Capture the immutable code for one contribution at its turn boundary. The author's session
   * stays available; a repeated call replays the same capture. */
  capture(participantId, contributionId) {
    return this._send('swarm.capture', {
      swarmId: this.id, participantId, contributionId,
    });
  }

  /** Record one independent check of a captured contribution. Returns the check's JSON — an
   * observation about the captured revision, not a statement about the author's task. */
  check(participantId, contributionId, checkId) {
    return this._send('swarm.check', {
      swarmId: this.id, participantId, contributionId, checkId,
    });
  }

  /** Stop one participant explicitly and account for the resources it owns. The swarm stays open. */
  stop(participantId, reason, options = {}) {
    exactOptions(options, new Set(['idempotencyKey']), 'Swarm stop');
    return this._send('swarm.stop', {
      swarmId: this.id, participantId, reason, idempotencyKey: idempotencyOf(options),
    });
  }

  /** Apply one domain update. `payload` is the effect kind's ordinary JSON object, or a plain
   * text body for findings and discussion. */
  update(event, payload, options = {}) {
    exactOptions(options, new Set(['idempotencyKey']), 'Swarm update');
    return this._send('swarm.update', {
      swarmId: this.id,
      event,
      ...(payload === undefined ? {} : { payload }),
      idempotencyKey: idempotencyOf(options),
    });
  }

  group(payload, options) { return this.update('swarm.group_updated', payload, options); }

  work(payload, options) { return this.update('swarm.work_updated', payload, options); }

  assign(payload, options) { return this.update('swarm.assignment_updated', payload, options); }

  context(payload, options) { return this.update('swarm.context_updated', payload, options); }

  contribute(payload, options) { return this.update('swarm.contribution_recorded', payload, options); }

  review(payload, options) { return this.update('swarm.contribution_reviewed', payload, options); }

  leave(payload, options) { return this.update('swarm.participant_left', payload, options); }

  close(payload, options) { return this.update('swarm.closed', payload, options); }
}

async function createSwarm(commandPort, purpose, options) {
  exactOptions(options, new Set(['swarmId', 'idempotencyKey']), 'Swarm create');
  const args = {
    purpose,
    ...(options.swarmId === undefined ? {} : { swarmId: options.swarmId }),
    idempotencyKey: idempotencyOf(options),
  };
  validateSwarmCommand('swarm.create', args);
  const result = await commandPort.command('swarm.create', args);
  return new Swarm(commandPort, swarmIdFrom(result, options.swarmId), result);
}

/**
 * Bind the swarm facade to a Baton command port (a BatonApplication, a bound client port, or any
 * `{ command(name, args) }` object). The facade is the whole SDK surface: create/open/list, then
 * the Swarm handle's verbs.
 */
export function createSwarms(commandPort) {
  if (!commandPort || typeof commandPort.command !== 'function') {
    throw clientError('Swarm command port is invalid');
  }
  return Object.freeze({
    create: (purpose, options = {}) => createSwarm(commandPort, purpose, options),
    open: (swarmId) => new Swarm(commandPort, swarmId),
    list: () => commandPort.command('swarm.list', {}),
  });
}
