// Issue #564 — a root-addressed wake must have an honest, turn-starting delivery path.
//
// Red-before on 1a1918203ec79d44ed74a23db18383de90ce501e (the lane's effective-tree
// snapshot over 65c913f0df143ec8d01f999047ca5cfdf6f03a51):
//
//   ERR_MODULE_NOT_FOUND: Cannot find module 'impl/src/wake-delivery.mjs'
//
// The rows below pin the Claude Code session socket frame, the complete route-harness
// capability table, typed refusals for harnesses without an operator-session channel, and
// durable delivery attempts, and the final delivered receipt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  HARNESS_WAKE_DELIVERY,
  claudeCrossSessionFrame,
  deliverClaudeSessionWake,
  deliverRootWakeOnce,
  harnessWakeCapability,
  harnessWakeCapabilityRows,
  parseClaudeAgents,
} from '../src/wake-delivery.mjs';
import { SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS } from '../src/swarm-event-schemas.mjs';

function memoryStore() {
  const rows = [];
  return {
    rows,
    eventsView() { return rows; },
    recordDriver(kind, payload, auth) {
      const event = Object.freeze({
        schemaVersion: 1, seq: rows.length + 1, ts: payload.at, kind: 'driver.recorded',
        actor: auth.actor, idempotencyKey: auth.key,
        payload: Object.freeze({ kind, ...payload }),
      });
      rows.push(event);
      return { ok: true, event };
    },
  };
}

async function listen(server, path) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('Claude delivery writes exactly one newline-terminated cross-session frame', async (t) => {
  // AF_UNIX paths are short on macOS. The suite runner's isolated TMPDIR is nested deeply
  // under the repository, so use the stable system socket directory for this fixture.
  const directory = mkdtempSync('/tmp/baton-issue564-');
  const socketPath = join(directory, 'claude.sock');
  const received = [];
  let settle;
  const complete = new Promise((resolve) => { settle = resolve; });
  const server = createServer((connection) => {
    const chunks = [];
    connection.on('data', (chunk) => chunks.push(chunk));
    connection.on('end', () => {
      received.push(Buffer.concat(chunks).toString('utf8'));
      settle();
    });
  });
  await listen(server, socketPath);
  t.after(async () => { await close(server); rmSync(directory, { recursive: true, force: true }); });

  const sessionId = 'session-root';
  const result = await deliverClaudeSessionWake({
    sessionId,
    body: 'Continue the root turn.',
    from: 'baton-root',
    messageId: 'wake-message-1',
    discovery: async () => JSON.stringify([
      { sessionId: 'another-session', pid: 101 },
      { sessionId, pid: 4242 },
    ]),
    transport: async ({ socket, line }) => {
      assert.equal(socket, '/tmp/cc-socks/4242.sock');
      await new Promise((resolve, reject) => {
        const client = createConnection(socketPath);
        client.once('error', reject);
        client.once('close', resolve);
        client.end(line);
      });
    },
  });
  await complete;

  assert.deepEqual(result, {
    delivered: true, pid: 4242, socket: '/tmp/cc-socks/4242.sock',
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].endsWith('\n'), true);
  assert.equal(received[0].slice(0, -1).includes('\n'), false, 'one NDJSON frame is written');
  assert.deepEqual(JSON.parse(received[0]), claudeCrossSessionFrame({
    sessionId, from: 'baton-root', body: 'Continue the root turn.', messageId: 'wake-message-1',
  }));
  const frame = JSON.parse(received[0]);
  assert.equal(frame.msgV, 1);
  assert.equal(frame.msg_id, 'wake-message-1');
  assert.equal(frame.type, 'user');
  assert.equal(frame.priority, 'next');
  assert.equal(frame.session_id, sessionId);
  assert.equal(frame.message.role, 'user');
  assert.match(frame.message.content,
    /^<cross-session-message from="baton-root" from-name="baton-root" from-mode="bypass">\nContinue the root turn\.\n<\/cross-session-message>$/);
});

test('Claude agent discovery selects the requested live session', () => {
  const stdout = JSON.stringify([
    { sessionId: 'session-a', pid: 123 },
    { sessionId: 'session-b', pid: 456 },
  ]);
  assert.deepEqual(parseClaudeAgents(stdout, 'session-b'), { pid: 456 });
  assert.equal(parseClaudeAgents(stdout, 'session-missing'), null);
});

test('Claude discovery and socket failures refuse with their own typed codes', async () => {
  await assert.rejects(deliverClaudeSessionWake({
    sessionId: 'session-missing', body: 'wake', from: 'baton-root',
    discovery: async () => '[]',
    transport: async () => assert.fail('a missing session reaches no transport'),
  }), (error) => error?.code === 'claude_session_not_found');

  await assert.rejects(deliverClaudeSessionWake({
    sessionId: 'session-root', body: 'wake', from: 'baton-root',
    discovery: async () => '[{"sessionId":"session-root","pid":4242}]',
    transport: async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); },
  }), (error) => error?.code === 'claude_session_transport_failed'
    && error?.cause?.code === 'ECONNREFUSED');
});

test('wake capability table is closed, sorted, coherent, and covers route harnesses', () => {
  const deployment = readFileSync(new URL('../src/application-deployment.mjs', import.meta.url), 'utf8');
  const start = deployment.indexOf('export function routeReadinessContract');
  const end = deployment.indexOf('\n}', start) + 2;
  const routeHarnesses = [...deployment.slice(start, end).matchAll(/case '([^']+)'/gu)]
    .map((match) => match[1]).sort();
  const rows = harnessWakeCapabilityRows();

  assert.deepEqual(rows.map((row) => row.harness), routeHarnesses);
  assert.deepEqual(Object.keys(HARNESS_WAKE_DELIVERY).sort(), routeHarnesses);
  assert.deepEqual(rows.map((row) => row.harness), [...rows.map((row) => row.harness)].sort());
  for (const row of rows) {
    assert.equal(row.canStartTurn, row.mechanism !== 'none');
    assert.deepEqual(harnessWakeCapability(row.harness), HARNESS_WAKE_DELIVERY[row.harness]);
    assert.equal(Object.isFrozen(HARNESS_WAKE_DELIVERY[row.harness]), true);
  }
  assert.equal(Object.isFrozen(HARNESS_WAKE_DELIVERY), true);
  assert.equal(harnessWakeCapability('unknown-harness'), null);
});

test('root wake delivery sends and records once per frame identity', async () => {
  const store = memoryStore();
  const frame = { seq: 91, wakeClass: 'attention', swarmId: 'swarm-a' };
  const target = { harness: 'claude-code', sessionId: 'session-root' };
  let sends = 0;
  const deliver = async () => { sends += 1; return { delivered: true }; };

  const first = await deliverRootWakeOnce({ store, frame, target, deliver });
  const second = await deliverRootWakeOnce({ store, frame, target, deliver });

  assert.equal(first.delivered, true);
  assert.deepEqual(second, { delivered: false, duplicate: true });
  assert.equal(sends, 1);
  assert.equal(store.rows.length, 1);
  assert.deepEqual(store.rows[0].payload, {
    kind: 'wake.root_delivered', seq: 91, wakeClass: 'attention', swarmId: 'swarm-a',
    attempt: 1,
    harness: 'claude-code', mechanism: 'session-socket', sessionId: 'session-root',
    at: store.rows[0].payload.at,
  });
  assert.match(store.rows[0].payload.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('concurrent delivery calls share the one in-flight attempt', async () => {
  const store = memoryStore();
  const frame = { seq: 93, wakeClass: 'attention', swarmId: 'swarm-a' };
  const target = { harness: 'claude-code', sessionId: 'session-root' };
  let sends = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const deliver = async () => { sends += 1; await blocked; return { delivered: true }; };

  const first = deliverRootWakeOnce({ store, frame, target, deliver });
  await new Promise((resolve) => setImmediate(resolve));
  const second = deliverRootWakeOnce({ store, frame, target, deliver });
  release();
  const results = await Promise.all([first, second]);

  assert.equal(results[0].delivered, true);
  assert.deepEqual(results[1], { delivered: false, duplicate: true });
  assert.equal(sends, 1);
  assert.equal(store.rows.length, 1);
});

test('concurrent observers share one failed attempt and a later observer advances it', async () => {
  const store = memoryStore();
  const frame = { seq: 96, wakeClass: 'attention', swarmId: 'swarm-a' };
  const target = { harness: 'claude-code', sessionId: 'session-root' };
  let sends = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const deliver = async () => {
    sends += 1;
    if (sends === 1) {
      await blocked;
      throw Object.assign(new Error('socket refused'), { code: 'claude_session_transport_failed' });
    }
    return { delivered: true };
  };

  const first = deliverRootWakeOnce({ store, frame, target, deliver });
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = deliverRootWakeOnce({ store, frame, target, deliver });
  release();
  const settled = await Promise.allSettled([first, concurrent]);

  assert.deepEqual(settled.map((result) => result.status), ['rejected', 'rejected']);
  assert.deepEqual(settled.map((result) => result.reason?.code),
    ['claude_session_transport_failed', 'claude_session_transport_failed']);
  assert.equal(sends, 1);
  assert.deepEqual(store.rows.map((row) => row.payload.attempt), [1]);

  const recovered = await deliverRootWakeOnce({ store, frame, target, deliver });
  assert.equal(recovered.attempt, 2);
  assert.equal(sends, 2);
});

test('root wake delivery records a typed failure and no delivered row', async () => {
  const store = memoryStore();
  const frame = { seq: 92, wakeClass: 'attention', swarmId: 'swarm-a' };
  const failure = Object.assign(new Error('socket refused'), { code: 'claude_session_transport_failed' });

  await assert.rejects(deliverRootWakeOnce({
    store,
    frame,
    target: { harness: 'claude-code', sessionId: 'session-root' },
    deliver: async () => { throw failure; },
  }), (error) => error === failure);

  assert.equal(store.rows.filter((row) => row.payload.kind === 'wake.root_delivered').length, 0);
  assert.deepEqual(store.rows[0].payload, {
    kind: 'wake.root_undelivered', seq: 92, wakeClass: 'attention', swarmId: 'swarm-a',
    attempt: 1,
    harness: 'claude-code', mechanism: 'session-socket', code: 'claude_session_transport_failed',
    at: store.rows[0].payload.at,
  });
});

test('a transient root wake failure retries on a later pass and delivery is final', async () => {
  const store = memoryStore();
  const frame = { seq: 94, wakeClass: 'attention', swarmId: 'swarm-a' };
  const target = { harness: 'claude-code', sessionId: 'session-root' };
  let sends = 0;
  const deliver = async () => {
    sends += 1;
    if (sends === 1) {
      throw Object.assign(new Error('socket refused'), { code: 'claude_session_transport_failed' });
    }
    return { delivered: true };
  };

  await assert.rejects(deliverRootWakeOnce({ store, frame, target, deliver }),
    (error) => error?.code === 'claude_session_transport_failed');
  const recovered = await deliverRootWakeOnce({ store, frame, target, deliver });
  const replay = await deliverRootWakeOnce({ store, frame, target, deliver });

  assert.equal(recovered.delivered, true);
  assert.equal(recovered.attempt, 2);
  assert.deepEqual(replay, { delivered: false, duplicate: true });
  assert.equal(sends, 2);
  assert.deepEqual(store.rows.map((row) => [row.payload.kind, row.payload.attempt]), [
    ['wake.root_undelivered', 1], ['wake.root_delivered', 2],
  ]);
});

test('a permanent root wake failure stops at the durable attempt cap', async () => {
  const store = memoryStore();
  const frame = { seq: 95, wakeClass: 'attention', swarmId: 'swarm-a' };
  const target = { harness: 'claude-code', sessionId: 'session-root' };
  let sends = 0;
  const deliver = async () => {
    sends += 1;
    throw Object.assign(new Error('socket refused'), { code: 'claude_session_transport_failed' });
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await assert.rejects(deliverRootWakeOnce({ store, frame, target, deliver }),
      (error) => error?.code === 'claude_session_transport_failed');
  }
  const exhausted = await deliverRootWakeOnce({ store, frame, target, deliver });

  assert.deepEqual(exhausted, {
    delivered: false, exhausted: true, attempts: 3, code: 'claude_session_transport_failed',
  });
  assert.equal(sends, 3);
  assert.deepEqual(store.rows.map((row) => row.payload.attempt), [1, 2, 3]);
  assert.deepEqual(new Set(store.rows.map((row) => row.idempotencyKey)).size, 3);
});

test('root delivery receipt schemas are discoverable runtime driver rows', () => {
  assert.deepEqual(Object.keys(SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS['wake.root_delivered'].fields), [
    'seq', 'wakeClass', 'swarmId', 'runId', 'workerId', 'attempt', 'harness', 'mechanism', 'sessionId', 'at',
  ]);
  assert.deepEqual(Object.keys(SWARM_DRIVER_EVENT_PAYLOAD_SCHEMAS['wake.root_undelivered'].fields), [
    'seq', 'wakeClass', 'swarmId', 'runId', 'workerId', 'attempt', 'harness', 'mechanism', 'code', 'at',
  ]);
});

test('every harness with no operator-session delivery channel refuses typed', async () => {
  for (const capability of harnessWakeCapabilityRows().filter((row) => row.mechanism === 'none')) {
    const store = memoryStore();
    let sends = 0;
    await assert.rejects(deliverRootWakeOnce({
      store,
      frame: { seq: 100, wakeClass: 'attention', swarmId: `swarm-${capability.harness}` },
      target: { harness: capability.harness, sessionId: `session-${capability.harness}` },
      deliver: async () => { sends += 1; return { delivered: true }; },
    }), (error) => error?.code === 'wake_delivery_unavailable');
    assert.equal(sends, 0);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].payload.kind, 'wake.root_undelivered');
    assert.equal(store.rows[0].payload.code, 'wake_delivery_unavailable');
  }
});
