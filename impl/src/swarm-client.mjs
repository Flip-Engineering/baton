// swarm-client.mjs — the agent-facing SDK for living swarms (docs/39-swarm-runtime.md).
//
// The SDK is a thin, honest facade over the swarm command port. It mints one idempotency key per
// effectful invocation (never per retry loop), validates each request against the SAME closed
// contract the runtime enforces (swarm-surface.mjs `validateSwarmCommand`), and returns the
// runtime's JSON unmodified: a cancel is the operation that happened, a capture is the exact
// immutable revision that was captured, a check is an observation about identified work under
// identified conditions — never a "task complete" verdict, and never a permission the client
// computed for itself. `view()` (and every mutation's returned view) carries the authoritative
// `caller` authority and `availableActions`; read those.
//
// Handles are coordinates, not sessions: `swarms.create()`/`swarms.open()` give a Swarm whose id
// plus view/recruit/guide/capture/check/stop work without the caller ever handling a worker id,
// a turn coordinate, or a fence.

import { randomUUID } from 'node:crypto';
import { validateSwarmCommand, swarmKnowledgeCommand } from './swarm-surface.mjs';
import { validateSwarmKnowledgeCommand } from './swarm-runtime.mjs';

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
  #cursor = null;

  constructor(port, swarmId, last = null) {
    if (!port || typeof port.command !== 'function' || !isText(swarmId)) {
      throw clientError('Swarm handle authority is invalid');
    }
    this.#port = port;
    this.#last = last;
    if (Number.isSafeInteger(last?.cursor) && last.cursor >= 0) this.#cursor = last.cursor;
    this.id = swarmId;
    Object.freeze(this);
  }

  /** The most recent JSON result this handle saw (create response or the last verb's view). */
  get last() { return this.#last; }

  /** The coordination cursor of the last view, when it carried one. */
  get cursor() {
    return this.#cursor;
  }

  async _send(name, args) {
    validateSwarmCommand(name, args);
    const result = await this.#port.command(name, args);
    this.#last = result;
    if (Number.isSafeInteger(result?.cursor) && result.cursor >= 0) {
      this.#cursor = Math.max(this.#cursor ?? 0, result.cursor);
    }
    return result;
  }

  /** Read the authoritative swarm view: purpose, status, participants with their runtime state,
   * groups, work (with its derived completion `evidence`), assignments, context, contributions,
   * reviews, `caller` authority, `availableActions`, recent `updates`, and `cursor`.
   * `options.participantId` scopes the read to that participant's delegation: its subtree, the
   * work assigned within, their contributions and reviews, and the delegation completion. */
  view(options = {}) {
    exactOptions(options, new Set(['participantId']), 'Swarm view');
    return this._send('swarm.view', {
      swarmId: this.id,
      ...(options.participantId === undefined ? {} : { participantId: options.participantId }),
    });
  }

  /**
   * Event-driven observation: await the next coordination append past `afterSeq` and return the
   * refreshed view. `afterSeq` defaults to the cursor of the last view this handle saw, so
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
   * Recruit one participant using the same route/scope options as Baton Run startup.
   * `permissions` is the requested grant set. The runtime resolves the native
   * Run identity, admits it under the caller's authority, and starts it; the caller never handles
   * a worker id or a fence.
   */
  recruit(participantId, objective, options = {}) {
    const selectionFields = ['exact', 'harness', 'model', 'effort', 'scope', 'profile', 'resultIntent'];
    exactOptions(options, new Set(['options', 'permissions', 'idempotencyKey', 'shareWorkspaceWith',
      'resumeFrom', ...selectionFields]), 'Swarm recruit');
    const selection = Object.fromEntries(selectionFields.filter((field) => options[field] !== undefined)
      .map((field) => [field, options[field]]));
    if (options.options !== undefined && Object.keys(selection).length) {
      throw clientError('Recruitment must use one route selection, not both nested and direct options');
    }
    const runOptions = options.options ?? (Object.keys(selection).length ? selection : undefined);
    return this._send('swarm.recruit', {
      swarmId: this.id,
      participantId,
      objective,
      ...(runOptions === undefined ? {} : { options: runOptions }),
      ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
      ...(options.shareWorkspaceWith === undefined ? {} : { shareWorkspaceWith: options.shareWorkspaceWith }),
      ...(options.resumeFrom === undefined ? {} : { resumeFrom: options.resumeFrom }),
      idempotencyKey: idempotencyOf(options),
    });
  }
  // ── the participant knowledge verbs (#318) ─────────────────────────────────────────────────
  // One admission (the shared knowledge contract), one dispatch (the swarm port). The runtime
  // binds the seat's run — and, for the elevate lane, its task — server-side, so no caller ever
  // names a runId here.

  async _sendKnowledge(name, args) {
    validateSwarmKnowledgeCommand(name, args);
    const result = await this.#port.command(name, args);
    this.#last = result;
    if (Number.isSafeInteger(result?.cursor) && result.cursor >= 0) {
      this.#cursor = Math.max(this.#cursor ?? 0, result.cursor);
    }
    return result;
  }

  /** Any knowledge verb from the shared table (`run.knowledge.seed`, `run.board.post`,
   * `run.board.read`, `run.scratchpad.append`, `run.scratchpad.read`, `run.scratchpad.elevate`,
   * `evidence.search`), with the swarm identity this handle carries. */
  knowledge(command, args = {}) {
    if (!swarmKnowledgeCommand(command)) throw clientError(`Unknown swarm knowledge command ${command}`);
    return this._sendKnowledge(command, { swarmId: this.id, ...args });
  }

  /** Pin one durable fact — typed, grounded, evidence-linked — that every peer can retrieve
   * (#318 deliverable 2, the exchange mechanism). The same fact lands on the wake stream as a
   * `knowledge` row and on `swarm.view` as a knowledge row attributed to this seat. */
  seedFact({ type = 'Finding', grounding = 'observed', body, evidence } = {}, options = {}) {
    exactOptions(options, new Set([]), 'Swarm seedFact');
    if (!isText(body)) throw clientError('seedFact needs a non-empty body');
    return this.knowledge('run.knowledge.seed', { type, grounding, body, ...(evidence === undefined ? {} : { evidence }) });
  }

  /** Search what the swarm exchanged: by free text, participant or knowledge kind. Rows carry
   * their seq/ts; `cursor` is the ledger seq to resume from — never a page count. */
  evidenceSearch({ query, participantId, kind, afterSeq } = {}) {
    return this.knowledge('evidence.search', {
      ...(query === undefined ? {} : { query }),
      ...(participantId === undefined ? {} : { participantId }),
      ...(kind === undefined ? {} : { kind }),
      ...(afterSeq === undefined ? {} : { afterSeq }),
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

  /** Declare, arrive at, or release one coupling record: a synchronization point a group arrives
   * at and is released from, an exclusive writer over a shared checkout, or a group failure
   * policy. Declared coupling is informed, never imposed — nothing here stops a worker. */
  couple(payload, options) { return this.update('swarm.coupling_updated', payload, options); }
  context(payload, options) { return this.update('swarm.context_updated', payload, options); }

  contribute(payload, options) { return this.update('swarm.contribution_recorded', payload, options); }

  review(payload, options) { return this.update('swarm.contribution_reviewed', payload, options); }

  leave(payload, options) { return this.update('swarm.participant_left', payload, options); }

  /** Release one gone holder's seats in one durable batch: every active assignment it holds is
   * released and it leaves every group, recorded as the individual durable events. Refuses for a
   * live active participant (`swarm_holder_live`); stopping it stays the explicit separate act. */
  holderRelease(participantId, reason, options = {}) {
    exactOptions(options, new Set(['idempotencyKey']), 'Swarm holder release');
    return this.update('swarm.holder_released',
      { participantId, ...(reason === undefined ? {} : { reason }) }, options);
  }

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
