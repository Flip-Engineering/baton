// wake-delivery.mjs — root wake delivery into operator-owned harness sessions.

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';

// Issue #585 (stage 3): the root wake message is a human message, so it is composed through the
// ONE mark rule rather than spelled here (brand.mjs).
import { flipHumanLine } from './brand.mjs';

const execFileAsync = promisify(execFile);

const capability = (mechanism, canStartTurn, note) => Object.freeze({
  mechanism, canStartTurn, note,
});

/** The closed operator-session wake capability table for every deployed harness family. */
export const HARNESS_WAKE_DELIVERY = Object.freeze({
  'claude-code': capability(
    'session-socket',
    true,
    'a cross-session message to /tmp/cc-socks/<pid>.sock starts a turn in the session claude agents --json names',
  ),
  codex: capability(
    'none',
    false,
    'an idle codex session does not process its inbox in the background',
  ),
  grok: capability(
    'none',
    false,
    "grok agent stdio belongs to Baton's spawned child process and cannot reach an operator grok session",
  ),
  'kimi-code': capability(
    'none',
    false,
    "Kimi ACP stdio belongs to Baton's spawned child process and cannot reach an operator kimi-code session",
  ),
  muse: capability(
    'none',
    false,
    "muse exec stdio belongs to Baton's spawned child process and cannot reach an operator muse session",
  ),
  omp: capability(
    'none',
    false,
    "omp RPC stdio belongs to Baton's spawned child process and cannot reach an operator omp session",
  ),
});

export function harnessWakeCapability(harness) {
  return typeof harness === 'string' && Object.hasOwn(HARNESS_WAKE_DELIVERY, harness)
    ? HARNESS_WAKE_DELIVERY[harness]
    : null;
}

export function harnessWakeCapabilityRows() {
  return Object.freeze(Object.keys(HARNESS_WAKE_DELIVERY).sort().map((harness) => Object.freeze({
    harness,
    ...HARNESS_WAKE_DELIVERY[harness],
  })));
}

/** One wake may be observed again after a failed transport. Durable attempt rows bound those
 * retries across resident restarts; a successful row closes the identity at any ordinal. */
export const ROOT_WAKE_DELIVERY_ATTEMPT_CAP = 3;

/** Issue #564: the capability rows of exactly the harnesses a deployment can run, for the doctor
 * and the deployment view. A harness the table does not know is reported as a row with no
 * turn-starting channel, never omitted: a root that can run an unwakeable harness is told so where
 * it recruits instead of discovering it by silence. Sorted by harness, duplicates collapsed. */
export function harnessWakeCapabilityForHarnesses(harnesses) {
  const names = [...new Set((Array.isArray(harnesses) ? harnesses : [])
    .filter((harness) => typeof harness === 'string' && harness.length > 0))].sort();
  return Object.freeze(names.map((harness) => Object.freeze({
    harness,
    ...(harnessWakeCapability(harness) ?? {
      mechanism: 'unknown', canStartTurn: false,
      note: 'no wake-delivery row names this harness; an idle session of it cannot be started',
    }),
  })));
}

function refusal(message, code, cause = undefined) {
  const error = Object.assign(new Error(message), { name: 'WakeDeliveryRefusal', code });
  if (cause !== undefined) error.cause = cause;
  return error;
}

function nonempty(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw refusal(`${field} must be non-empty text`, 'wake_delivery_invalid');
  }
  return value;
}

/** Issue #564: the operator session one resident is configured to wake. The declaration is
 * validated at deployment open. A named harness must have a turn-starting channel in the closed
 * capability table, so a resident cannot start with a configured target it cannot reach. A
 * session-socket harness may name the `pid` that owns the session's socket, which is how an
 * interactive operator session the session registry does not list is addressed. */
export function normalizeRootWakeTarget(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw refusal('advanced rootWake must be an object', 'wake_delivery_invalid');
  }
  const unknown = Object.keys(value).find((field) => !['harness', 'sessionId', 'from', 'pid'].includes(field));
  if (unknown !== undefined) {
    throw refusal(`advanced rootWake contains unsupported field ${unknown}`, 'wake_delivery_invalid');
  }
  const harness = nonempty(value.harness, 'advanced rootWake harness');
  const sessionId = nonempty(value.sessionId, 'advanced rootWake sessionId');
  const from = value.from === undefined ? 'baton' : nonempty(value.from, 'advanced rootWake from');
  if (sessionId.length > 256 || /[\0\r\n]/u.test(sessionId)
    || from.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(from)) {
    throw refusal('advanced rootWake sessionId or from is invalid', 'wake_delivery_invalid');
  }
  const row = harnessWakeCapability(harness);
  if (row === null) {
    throw refusal(`wake delivery harness ${harness} is unknown`, 'wake_harness_unknown');
  }
  if (!row.canStartTurn) {
    throw refusal(`${harness} cannot start a turn in an idle operator session`, 'wake_delivery_unavailable');
  }
  // Issue #564: a session-socket harness may be addressed by the pid that owns its socket. The
  // session registry (`claude agents --json`) lists background agents only, so an interactive
  // operator session has no other id-to-pid source, and this is what the operator declares.
  if (value.pid !== undefined && (row.mechanism !== 'session-socket'
    || !Number.isSafeInteger(value.pid) || value.pid <= 0)) {
    throw refusal('advanced rootWake pid must be the positive process id of a session-socket harness',
      'wake_delivery_invalid');
  }
  return Object.freeze({
    harness, sessionId, from, ...(value.pid === undefined ? {} : { pid: value.pid }),
  });
}

export function claudeSessionSocketPath(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw refusal('Claude session pid must be a positive safe integer', 'claude_session_pid_invalid');
  }
  return `/tmp/cc-socks/${pid}.sock`;
}

/** Parse the public identity pair emitted by `claude agents --json`. */
export function parseClaudeAgents(stdout, sessionId) {
  let agents;
  try { agents = JSON.parse(stdout); } catch { return null; }
  if (!Array.isArray(agents)) return null;
  const matches = agents.filter((agent) => agent?.sessionId === sessionId
    && Number.isSafeInteger(agent.pid) && agent.pid > 0);
  return matches.length === 1 ? Object.freeze({ pid: matches[0].pid }) : null;
}

export function claudeCrossSessionFrame({ sessionId, from, body, messageId }) {
  nonempty(sessionId, 'sessionId');
  nonempty(from, 'from');
  if (typeof body !== 'string' || body.length === 0) {
    throw refusal('body must be non-empty text', 'wake_delivery_invalid');
  }
  nonempty(messageId, 'messageId');
  return Object.freeze({
    msgV: 1,
    msg_id: messageId,
    type: 'user',
    message: Object.freeze({
      role: 'user',
      content: `<cross-session-message from="${from}" from-name="${from}" from-mode="bypass">\n${body}\n</cross-session-message>`,
    }),
    priority: 'next',
    session_id: sessionId,
    from,
  });
}

async function defaultClaudeDiscovery() {
  return execFileAsync('claude', ['agents', '--json'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
}

async function defaultClaudeTransport({ socket, line }) {
  await new Promise((resolve, reject) => {
    const client = createConnection(socket);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(error);
    };
    client.once('error', fail);
    client.once('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    client.once('connect', () => client.end(line));
  });
}

/** Discover one live Claude Code session and write one cross-session NDJSON frame to its socket.
 * A caller that already knows the pid (`pid`) skips discovery: the socket path is derived from it
 * directly, which is how an interactive operator session the registry does not list is reached. */
export async function deliverClaudeSessionWake({
  sessionId,
  body,
  from,
  messageId = randomUUID(),
  pid = null,
  discovery = defaultClaudeDiscovery,
  transport = defaultClaudeTransport,
}) {
  nonempty(sessionId, 'sessionId');
  nonempty(from, 'from');
  if (typeof body !== 'string' || body.length === 0) {
    throw refusal('body must be non-empty text', 'wake_delivery_invalid');
  }
  if (typeof discovery !== 'function' || typeof transport !== 'function') {
    throw refusal('Claude wake discovery and transport must be functions', 'wake_delivery_invalid');
  }

  let targetPid = pid;
  if (targetPid === null) {
    let discovered;
    try {
      const result = await discovery({ sessionId });
      const stdout = typeof result === 'string' ? result : result?.stdout;
      discovered = typeof stdout === 'string' ? parseClaudeAgents(stdout, sessionId) : null;
    } catch (cause) {
      throw refusal('Claude session discovery failed', 'claude_session_discovery_failed', cause);
    }
    if (discovered === null) {
      throw refusal(`Claude session ${sessionId} is not a unique live agent`, 'claude_session_not_found');
    }
    targetPid = discovered.pid;
  } else if (!Number.isSafeInteger(targetPid) || targetPid <= 0) {
    throw refusal('Claude session pid must be a positive safe integer', 'claude_session_pid_invalid');
  }

  const socket = claudeSessionSocketPath(targetPid);
  const frame = claudeCrossSessionFrame({ sessionId, from, body, messageId });
  const line = `${JSON.stringify(frame)}\n`;
  try {
    await transport({ socket, line, frame });
  } catch (cause) {
    throw refusal(`Claude session socket delivery failed for ${socket}`, 'claude_session_transport_failed', cause);
  }
  return Object.freeze({ delivered: true, pid: targetPid, socket });
}

function deliveryPayload(row) {
  if (row?.kind === 'driver.recorded') return row.payload ?? null;
  if (row?.kind === 'wake.root_delivered' || row?.kind === 'wake.root_undelivered') return row;
  return null;
}

function storedEvents(store) {
  if (typeof store?.eventsView === 'function') return store.eventsView();
  if (typeof store?.events === 'function') return store.events();
  if (Array.isArray(store?.rows)) return store.rows;
  throw refusal('wake delivery store has no event reader', 'wake_delivery_store_invalid');
}

function frameAddress(frame) {
  const swarmId = typeof frame?.swarmId === 'string' && frame.swarmId.length > 0
    ? frame.swarmId : null;
  const runId = typeof frame?.runId === 'string' && frame.runId.length > 0
    ? frame.runId : null;
  const workerId = typeof frame?.workerId === 'string' && frame.workerId.length > 0
    ? frame.workerId : null;
  if (swarmId !== null) return Object.freeze({ swarmId });
  if (runId !== null) return Object.freeze({ swarmId: null, runId });
  if (workerId !== null) return Object.freeze({ swarmId: null, workerId });
  throw refusal('wake frame identity requires swarmId, runId, or workerId', 'wake_frame_identity_invalid');
}

function sameIdentity(payload, frame) {
  let address;
  try { address = frameAddress(frame); } catch { return false; }
  return (payload?.kind === 'wake.root_delivered' || payload?.kind === 'wake.root_undelivered')
    && payload.seq === frame.seq
    && payload.wakeClass === frame.wakeClass
    && payload.swarmId === address.swarmId
    && (address.runId === undefined || payload.runId === address.runId)
    && (address.workerId === undefined || payload.workerId === address.workerId);
}

function deliveryReceipts(store, frame) {
  return storedEvents(store).map(deliveryPayload).filter((payload) => sameIdentity(payload, frame));
}

function deliveryState(store, frame) {
  const receipts = deliveryReceipts(store, frame);
  const delivered = receipts.find((payload) => payload.kind === 'wake.root_delivered') ?? null;
  const failures = receipts.filter((payload) => payload.kind === 'wake.root_undelivered');
  const lastFailure = failures.at(-1) ?? null;
  const recordedOrdinals = receipts.map((payload, index) => (
    Number.isSafeInteger(payload.attempt) && payload.attempt > 0 ? payload.attempt : index + 1
  ));
  return Object.freeze({
    delivered,
    failures: Object.freeze(failures),
    nextAttempt: (recordedOrdinals.length === 0 ? 0 : Math.max(...recordedOrdinals)) + 1,
    lastCode: lastFailure?.code ?? null,
  });
}

function validateIdentity(frame) {
  if (!Number.isSafeInteger(frame?.seq) || frame.seq <= 0
    || typeof frame?.wakeClass !== 'string' || frame.wakeClass.length === 0) {
    throw refusal('wake frame identity requires seq and wakeClass', 'wake_frame_identity_invalid');
  }
  return frameAddress(frame);
}

function recordDelivery(store, kind, payload, identity, attempt) {
  if (typeof store?.recordDriver !== 'function') {
    throw refusal('wake delivery store has no runtime driver writer', 'wake_delivery_store_invalid');
  }
  const key = `wake-root-delivery:${JSON.stringify({ ...identity, attempt })}`;
  return store.recordDriver(kind, payload, { actor: 'policy', key });
}

function typedFailure(error) {
  if (typeof error?.code === 'string' && error.code.length > 0) return error;
  return refusal(error?.message ?? 'root wake delivery failed', 'wake_delivery_failed', error);
}

const inFlightByStore = new WeakMap();

/** Deliver one root wake. A delivered receipt is final; a failed receipt advances the durable
 * attempt ordinal on a later observation until the per-wake cap is reached. */
export async function deliverRootWakeOnce({ store, frame, target, deliver }) {
  const address = validateIdentity(frame);
  if (store === null || (typeof store !== 'object' && typeof store !== 'function')) {
    throw refusal('wake delivery store is required', 'wake_delivery_store_invalid');
  }
  const identity = { seq: frame.seq, wakeClass: frame.wakeClass, ...address };
  const identityKey = JSON.stringify(identity);
  const recorded = deliveryState(store, frame);
  if (recorded.delivered !== null) return Object.freeze({ delivered: false, duplicate: true });
  if (recorded.failures.length >= ROOT_WAKE_DELIVERY_ATTEMPT_CAP) {
    return Object.freeze({
      delivered: false, exhausted: true, attempts: recorded.failures.length,
      code: recorded.lastCode,
    });
  }

  let storeFlights = inFlightByStore.get(store);
  if (!storeFlights) {
    storeFlights = new Map();
    inFlightByStore.set(store, storeFlights);
  }
  const priorFlight = storeFlights.get(identityKey);
  if (priorFlight) {
    await priorFlight;
    return Object.freeze({ delivered: false, duplicate: true });
  }

  const attemptOrdinal = recorded.nextAttempt;
  const attempt = (async () => {
    const harness = target?.harness;
    const wakeCapability = harnessWakeCapability(harness);
    const mechanism = wakeCapability?.mechanism ?? 'none';
    const base = {
      seq: frame.seq, wakeClass: frame.wakeClass, ...address,
      attempt: attemptOrdinal,
      harness: typeof harness === 'string' && harness.length > 0 ? harness : 'unknown',
      mechanism,
    };
    try {
      if (wakeCapability === null) {
        throw refusal(`wake delivery harness ${String(harness)} is unknown`, 'wake_harness_unknown');
      }
      if (!wakeCapability.canStartTurn) {
        throw refusal(`${harness} cannot start a turn in an idle operator session`, 'wake_delivery_unavailable');
      }
      if (typeof target?.sessionId !== 'string' || target.sessionId.length === 0) {
        throw refusal('root wake target requires a sessionId', 'wake_session_id_required');
      }
      if (typeof deliver !== 'function') {
        throw refusal('root wake target has no delivery function', 'wake_delivery_invalid');
      }
      const result = await deliver({ frame, target, capability: wakeCapability });
      if (result?.delivered !== true) {
        const error = refusal('root wake transport did not confirm delivery', result?.code ?? 'wake_delivery_failed');
        if (result !== undefined) error.detail = result;
        throw error;
      }
      const payload = { ...base, sessionId: target.sessionId, at: new Date().toISOString() };
      recordDelivery(store, 'wake.root_delivered', payload, identity, attemptOrdinal);
      return Object.freeze({ delivered: true, ...payload });
    } catch (cause) {
      const error = typedFailure(cause);
      const payload = { ...base, code: error.code, at: new Date().toISOString() };
      recordDelivery(store, 'wake.root_undelivered', payload, identity, attemptOrdinal);
      throw error;
    }
  })();
  storeFlights.set(identityKey, attempt);
  try {
    return await attempt;
  } finally {
    if (storeFlights.get(identityKey) === attempt) storeFlights.delete(identityKey);
    if (storeFlights.size === 0) inFlightByStore.delete(store);
  }
}

function rootAttentionPayload(store, frame) {
  const events = typeof store?.eventsView === 'function'
    ? store.eventsView(frame.seq, 1)
    : storedEvents(store);
  const source = events.find((event) => event?.seq === frame.seq) ?? null;
  const payload = source?.kind === 'driver.recorded' ? source.payload : null;
  const contributionRequired = payload?.owed === 'review_owed' || payload?.owed === 'needs_root';
  const contributionValid = contributionRequired
    ? typeof payload.contributionId === 'string' && payload.contributionId.length > 0
    : payload?.owed === 'turn_reported' && (payload.contributionId === undefined
      || (typeof payload.contributionId === 'string' && payload.contributionId.length > 0));
  if (payload?.kind !== 'swarm.root_attention_owed'
    || payload.swarmId !== frame.swarmId
    || typeof payload.participantId !== 'string' || payload.participantId.length === 0
    || !contributionValid
    || (payload.ask !== null && payload.ask !== undefined && typeof payload.ask !== 'string')
    || payload.next === null || typeof payload.next !== 'object' || Array.isArray(payload.next)) {
    throw refusal('root_owed frame does not resolve to a swarm.root_attention_owed row',
      'root_wake_source_invalid');
  }
  return Object.freeze({
    swarmId: payload.swarmId,
    participantId: payload.participantId,
    ...(payload.contributionId === undefined ? {} : { contributionId: payload.contributionId }),
    owed: payload.owed,
    ask: payload.ask ?? null,
    next: Object.freeze({ ...payload.next }),
  });
}

function rootTurnReportedPayload(store, frame) {
  const events = typeof store?.eventsView === 'function'
    ? store.eventsView(frame.seq, 1)
    : storedEvents(store);
  const source = events.find((event) => event?.seq === frame.seq) ?? null;
  const payload = source?.kind === 'driver.recorded'
    ? source.payload
    : source?.kind === 'worker.turn_reported'
      ? { kind: source.kind, ...(source.payload ?? {}) }
      : null;
  const sourceRunId = typeof payload?.runId === 'string' && payload.runId.length > 0
    ? payload.runId : null;
  const sourceWorkerId = typeof payload?.worker === 'string' && payload.worker.length > 0
    ? payload.worker : null;
  const sourceMatches = typeof frame.runId === 'string' && frame.runId.length > 0
    ? sourceRunId === frame.runId
    : typeof frame.workerId === 'string' && frame.workerId.length > 0
      && sourceRunId === null && sourceWorkerId === frame.workerId;
  if (payload?.kind !== 'worker.turn_reported' || !sourceMatches) {
    throw refusal('root_turn_reported frame does not resolve to a worker.turn_reported row',
      'root_wake_source_invalid');
  }
  return Object.freeze({ ...payload });
}

// The root wake message is what a person reads inside their own harness session, so it is
// composed by the ONE mark rule (brand.mjs flipHumanLine) and carries no JSON: the facts the
// root needs to act, one line each, every interpolated value bounded and the whole body bounded.

/** The bound one rendered value carries; a longer value ends in `…`. */
const ROOT_WAKE_VALUE_CHARS = 200;
/** The bound the whole composed message carries. */
const ROOT_WAKE_BODY_CHARS = 2000;

function boundedRootValue(value) {
  const text = typeof value === 'string' ? value : `${value ?? ''}`;
  return text.length <= ROOT_WAKE_VALUE_CHARS ? text : `${text.slice(0, ROOT_WAKE_VALUE_CHARS)}…`;
}

/** Apply the message bound to one composed body. */
function boundRootWakeBody(body) {
  return body.length <= ROOT_WAKE_BODY_CHARS ? body
    : `${body.slice(0, ROOT_WAKE_BODY_CHARS - 1)}…`;
}

/** The identity arguments a next command renders, taken from the payload's own `next` object with
 * the payload's validated fields as the fallback. Null when one is missing: a command with a hole
 * in it is not a command the root can run. */
function rootNextIdentity(payload, names) {
  const next = payload.next;
  if (next === null || typeof next !== 'object' || Array.isArray(next)) return null;
  const values = names.map((name) => (typeof next[name] === 'string' && next[name].length > 0
    ? next[name] : payload[name]));
  return values.every((entry) => typeof entry === 'string' && entry.length > 0) ? values : null;
}

/** The command a root_owed row asks for, in the CLI spelling the seat guidance teaches. The
 * caller supplies CHECK_ID itself, so the check command names the placeholder rather than a
 * check id it would have to invent. */
function rootOwedNextCommand(payload) {
  const command = payload.next?.command;
  if (command === 'swarm.check') {
    const identity = rootNextIdentity(payload, ['swarmId', 'participantId', 'contributionId']);
    return identity === null ? null : `baton swarm check ${identity.map(boundedRootValue).join(' ')} CHECK_ID`;
  }
  if (command === 'swarm.view') {
    const identity = rootNextIdentity(payload, ['swarmId']);
    return identity === null ? null : `baton swarm view ${boundedRootValue(identity[0])}`;
  }
  return null;
}

/** The message a swarm.root_attention_owed row owes the root. */
function rootOwedBody(payload, wakeClass) {
  const lines = [flipHumanLine(
    `root owed: ${boundedRootValue(payload.owed)} in ${boundedRootValue(payload.swarmId)}`,
    { statusClass: wakeClass })];
  const seat = [payload.participantId, payload.contributionId]
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .map(boundedRootValue).join(' · ');
  if (seat.length > 0) lines.push(`  seat: ${seat}`);
  if (typeof payload.ask === 'string' && payload.ask.length > 0) {
    lines.push(`  ask: ${boundedRootValue(payload.ask)}`);
  }
  const command = rootOwedNextCommand(payload);
  if (command !== null) lines.push(`  next: ${command}`);
  return boundRootWakeBody(lines.join('\n'));
}

/** The message a worker.turn_reported row owes the root. The result status is the row's own
 * `resultStatus`, or the status its `report` carries; the run view command is the class's own
 * next action, and a report with no run has none. */
function rootTurnReportedBody(payload, wakeClass) {
  const resultStatus = typeof payload.resultStatus === 'string' && payload.resultStatus.length > 0
    ? payload.resultStatus
    : payload.report?.status;
  const subject = [resultStatus, payload.worker]
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .map(boundedRootValue).join(' · ');
  const lines = [flipHumanLine(`turn reported: ${subject}`, { statusClass: wakeClass })];
  if (typeof payload.runId === 'string' && payload.runId.length > 0) {
    lines.push(`  run: ${boundedRootValue(payload.runId)}`);
    lines.push(`  next: baton run view ${boundedRootValue(payload.runId)}`);
  }
  return boundRootWakeBody(lines.join('\n'));
}

/** The message the frame's class asks the root to read: the owed attention, or the turn report. */
function rootWakeBody(payload, wakeClass) {
  return wakeClass === 'root_turn_reported'
    ? rootTurnReportedBody(payload, wakeClass)
    : rootOwedBody(payload, wakeClass);
}

/** Consume one root-addressed frame. The frame resolves only through its public source row kind
 * and payload. A delivered receipt closes its subject identity; failed attempts remain retryable
 * under their durable ordinals. */
export async function deliverRootWakeFrame({
  store,
  frame,
  target,
  deliver = null,
  discovery,
  transport,
}) {
  if (!['root_owed', 'root_turn_reported'].includes(frame?.wakeClass)) {
    return Object.freeze({ delivered: false, ignored: true });
  }
  const normalizedTarget = normalizeRootWakeTarget(target);
  return deliverRootWakeOnce({
    store,
    frame,
    target: normalizedTarget,
    deliver: async (context) => {
      const payload = frame.wakeClass === 'root_turn_reported'
        ? rootTurnReportedPayload(store, frame)
        : rootAttentionPayload(store, frame);
      const body = rootWakeBody(payload, frame.wakeClass);
      if (deliver !== null) {
        if (typeof deliver !== 'function') {
          throw refusal('root wake delivery override must be a function', 'wake_delivery_invalid');
        }
        return deliver({ ...context, body, payload, discovery, transport });
      }
      if (normalizedTarget.harness === 'claude-code') {
        return deliverClaudeSessionWake({
          sessionId: normalizedTarget.sessionId,
          from: normalizedTarget.from,
          body,
          ...(normalizedTarget.pid === undefined ? {} : { pid: normalizedTarget.pid }),
          ...(discovery === undefined ? {} : { discovery }),
          ...(transport === undefined ? {} : { transport }),
        });
      }
      throw refusal(`no root wake transport is implemented for ${normalizedTarget.harness}`,
        'wake_delivery_unavailable');
    },
  });
}

/** Attach one resident-owned root delivery consumer to the existing deployment wake stream. The
 * stream waits on the coordination store's append notification. Each frame failure is recorded by
 * deliverRootWakeOnce and consumed here so the attachment continues to later root_owed rows. */
export function attachRootWakeDelivery({
  stream,
  store,
  target,
  deliver = null,
  discovery,
  transport,
  since = 0,
  signal = null,
  onResult = null,
  onError = null,
}) {
  if (typeof stream?.watch !== 'function') {
    throw refusal('root wake delivery requires a wake stream', 'wake_delivery_stream_invalid');
  }
  const normalizedTarget = normalizeRootWakeTarget(target);
  if (since !== null && (!Number.isSafeInteger(since) || since < 0)) {
    throw refusal('root wake delivery cursor must be a non-negative safe integer',
      'wake_delivery_cursor_invalid');
  }
  if (onResult !== null && typeof onResult !== 'function') {
    throw refusal('root wake delivery onResult must be a function', 'wake_delivery_invalid');
  }
  if (onError !== null && typeof onError !== 'function') {
    throw refusal('root wake delivery onError must be a function', 'wake_delivery_invalid');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener?.('abort', abort, { once: true });
  const consume = (frame) => deliverRootWakeFrame({
    store, frame, target: normalizedTarget, deliver, discovery, transport,
  });
  const done = stream.watch(Object.freeze({
    kinds: new Set(['root_owed', 'root_turn_reported']), swarms: null, participants: null, since,
  }), {
    signal: controller.signal,
    onFrame: async (frame) => {
      try {
        const result = await consume(frame);
        try { onResult?.(result, frame); } catch { /* delivery remains authoritative */ }
      } catch (error) {
        try { onError?.(error, frame); } catch { /* the next frame still runs */ }
      }
    },
  }).catch((error) => {
    try { onError?.(error, null); } catch { /* the attachment is already settled */ }
  }).finally(() => signal?.removeEventListener?.('abort', abort));
  return Object.freeze({
    target: normalizedTarget,
    consume,
    done,
    close: () => controller.abort(),
  });
}
