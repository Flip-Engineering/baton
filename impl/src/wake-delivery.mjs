// wake-delivery.mjs — root wake delivery into operator-owned harness sessions.

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';

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

/** Discover one live Claude Code session and write one cross-session NDJSON frame to its socket. */
export async function deliverClaudeSessionWake({
  sessionId,
  body,
  from,
  messageId = randomUUID(),
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

  const socket = claudeSessionSocketPath(discovered.pid);
  const frame = claudeCrossSessionFrame({ sessionId, from, body, messageId });
  const line = `${JSON.stringify(frame)}\n`;
  try {
    await transport({ socket, line, frame });
  } catch (cause) {
    throw refusal(`Claude session socket delivery failed for ${socket}`, 'claude_session_transport_failed', cause);
  }
  return Object.freeze({ delivered: true, pid: discovered.pid, socket });
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

function sameIdentity(payload, frame) {
  return (payload?.kind === 'wake.root_delivered' || payload?.kind === 'wake.root_undelivered')
    && payload.seq === frame.seq
    && payload.wakeClass === frame.wakeClass
    && payload.swarmId === frame.swarmId;
}

function alreadyRecorded(store, frame) {
  return storedEvents(store).some((row) => sameIdentity(deliveryPayload(row), frame));
}

function validateIdentity(frame) {
  if (!Number.isSafeInteger(frame?.seq) || frame.seq <= 0
    || typeof frame?.wakeClass !== 'string' || frame.wakeClass.length === 0
    || typeof frame?.swarmId !== 'string' || frame.swarmId.length === 0) {
    throw refusal('wake frame identity requires seq, wakeClass, and swarmId', 'wake_frame_identity_invalid');
  }
}

function recordDelivery(store, kind, payload, identity) {
  if (typeof store?.recordDriver !== 'function') {
    throw refusal('wake delivery store has no runtime driver writer', 'wake_delivery_store_invalid');
  }
  const key = `wake-root-delivery:${JSON.stringify(identity)}`;
  return store.recordDriver(kind, payload, { actor: 'policy', key });
}

function typedFailure(error) {
  if (typeof error?.code === 'string' && error.code.length > 0) return error;
  return refusal(error?.message ?? 'root wake delivery failed', 'wake_delivery_failed', error);
}

const inFlightByStore = new WeakMap();

/** Deliver and durably mark one root wake identity at most once in this runtime. */
export async function deliverRootWakeOnce({ store, frame, target, deliver }) {
  validateIdentity(frame);
  if (store === null || (typeof store !== 'object' && typeof store !== 'function')) {
    throw refusal('wake delivery store is required', 'wake_delivery_store_invalid');
  }
  const identity = [frame.swarmId, frame.wakeClass, frame.seq];
  const identityKey = JSON.stringify(identity);
  if (alreadyRecorded(store, frame)) return Object.freeze({ delivered: false, duplicate: true });

  let storeFlights = inFlightByStore.get(store);
  if (!storeFlights) {
    storeFlights = new Map();
    inFlightByStore.set(store, storeFlights);
  }
  const priorFlight = storeFlights.get(identityKey);
  if (priorFlight) {
    try { await priorFlight; } catch { /* the first attempt records its typed failure */ }
    if (alreadyRecorded(store, frame)) return Object.freeze({ delivered: false, duplicate: true });
  }

  const attempt = (async () => {
    const harness = target?.harness;
    const wakeCapability = harnessWakeCapability(harness);
    const mechanism = wakeCapability?.mechanism ?? 'none';
    const base = {
      seq: frame.seq, wakeClass: frame.wakeClass, swarmId: frame.swarmId,
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
      recordDelivery(store, 'wake.root_delivered', payload, identity);
      return Object.freeze({ delivered: true, ...payload });
    } catch (cause) {
      const error = typedFailure(cause);
      const payload = { ...base, code: error.code, at: new Date().toISOString() };
      if (!alreadyRecorded(store, frame)) {
        recordDelivery(store, 'wake.root_undelivered', payload, identity);
      }
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
