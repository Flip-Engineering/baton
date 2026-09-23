// Issue #564 — resident wiring for root-addressed wake delivery.
//
// Red-before on 203cb1f59ff96cdf77cc0b266ad3bedb7e12df0e:
//
//   SyntaxError: The requested module '../src/wake-delivery.mjs' does not provide an export
//   named 'deliverRootWakeFrame'
//
// These rows pin the deployment-open configuration boundary and the resident's existing
// WakeStream attachment. A durable root_owed frame reaches the configured Claude session once,
// a replay is a durable duplicate, and a transport refusal remains visible in swarm attention.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { WebNorthbound } from '../src/web-northbound.mjs';
import { deliverRootWakeFrame, harnessWakeCapabilityRows } from '../src/wake-delivery.mjs';
import { deriveWakeFrame } from '../src/wake-stream.mjs';

const OWNER = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
const TARGET = Object.freeze({ harness: 'claude-code', sessionId: 'root-session', from: 'baton-root' });

function waitFor(read, predicate, { timeoutMs = 5_000, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const value = read();
      if (predicate(value)) return resolve(value);
      if (Date.now() > deadline) {
        return reject(new Error(`timed out waiting for ${label}; saw ${JSON.stringify(value).slice(0, 800)}`));
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

function fixture(t, rootWakeDelivery) {
  const directory = mkdtempSync('/tmp/baton-564-wiring-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(join(directory, 'coordination'));
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
      }
    },
    stopRun: async (runId) => {
      const worker = workers.find((row) => row.runId === runId);
      if (worker) worker.status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    swarmId: 'swarm-564',
    ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
    ...args,
  }, OWNER);
  const web = new WebNorthbound({
    coordinator, coordination: store, allowedOrigins: [], repoIds: [],
    pollMs: 5, rootWakeDelivery,
  });
  t.after(async () => { await web.shutdown({ drainMs: 50 }); });
  const recordOwed = (fields) => store.recordDriver('swarm.root_attention_owed', {
    swarmId: 'swarm-564', participantId: 'lead', contributionId: 'contribution-564',
    owed: 'needs_root', ask: 'the root: inspect contribution-564',
    next: { command: 'swarm.view', swarmId: 'swarm-564' },
    ...fields,
  }, { actor: 'baton-runtime', key: `owed-${++key}` });
  const recordTurnOwed = () => store.recordDriver('swarm.root_attention_owed', {
    swarmId: 'swarm-564', participantId: 'lead', owed: 'turn_reported', ask: null,
    next: { command: 'swarm.view', swarmId: 'swarm-564' },
  }, { actor: 'baton-runtime', key: `owed-${++key}` });
  return { directory, store, runtime, web, call, recordOwed, recordTurnOwed };
}

async function listen(server, path) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
}

test('564-w1: a resident root_owed attachment writes one Claude turn frame and a replay sends nothing', async (t) => {
  const socketDirectory = mkdtempSync('/tmp/baton-564-root-session-');
  const socketPath = join(socketDirectory, 'claude.sock');
  const received = [];
  const server = createServer((connection) => {
    const chunks = [];
    connection.on('data', (chunk) => chunks.push(chunk));
    connection.on('end', () => received.push(Buffer.concat(chunks).toString('utf8')));
  });
  await listen(server, socketPath);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(socketDirectory, { recursive: true, force: true });
  });

  const discovery = async () => JSON.stringify([{ sessionId: TARGET.sessionId, pid: 564 }]);
  const transport = async ({ socket, line }) => {
    assert.equal(socket, '/tmp/cc-socks/564.sock', 'discovery selects the operator session socket');
    await new Promise((resolve, reject) => {
      const client = createConnection(socketPath);
      client.once('error', reject);
      client.once('close', resolve);
      client.end(line);
    });
  };
  const f = fixture(t, { target: TARGET, discovery, transport });
  const owed = f.recordOwed({});
  const owedSeq = owed.event.seq;
  const delivered = await waitFor(
    () => f.store.eventsView().filter((event) => event.payload?.kind === 'wake.root_delivered'),
    (rows) => rows.some((event) => event.payload.seq === owedSeq),
    { label: 'wake.root_delivered' },
  );
  await waitFor(() => received, (rows) => rows.length === 1, { label: 'Claude socket frame' });

  assert.equal(delivered.length, 1, 'one durable delivery row records the turn-starting send');
  assert.equal(received.length, 1, 'one socket frame reached the operator session');
  assert.equal(received[0].endsWith('\n'), true, 'the bridge frame is newline terminated');
  const message = JSON.parse(received[0]);
  assert.equal(message.session_id, TARGET.sessionId);
  assert.equal(message.priority, 'next');
  assert.match(message.message.content, /swarm-564/u);
  assert.match(message.message.content, /contribution-564/u);
  assert.match(message.message.content, /the root: inspect contribution-564/u);

  const source = f.store.eventsView(owedSeq, 1)[0];
  const replay = await deliverRootWakeFrame({
    store: f.store, frame: deriveWakeFrame(source), target: TARGET, discovery, transport,
  });
  assert.deepEqual(replay, { delivered: false, duplicate: true },
    'a second consumer pass reads the durable identity and sends nothing');
  assert.equal(received.length, 1, 'the replay wrote no second socket frame');
  assert.equal(f.store.eventsView().filter((event) => event.payload?.kind === 'wake.root_delivered').length, 1,
    'the replay wrote no second delivery row');
});

test('564-w4: a contribution-less turn_reported row crosses the resident attachment exactly once', async (t) => {
  const socketDirectory = mkdtempSync('/tmp/baton-564-turn-reported-');
  const socketPath = join(socketDirectory, 'claude.sock');
  const received = [];
  const server = createServer((connection) => {
    const chunks = [];
    connection.on('data', (chunk) => chunks.push(chunk));
    connection.on('end', () => received.push(Buffer.concat(chunks).toString('utf8')));
  });
  await listen(server, socketPath);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(socketDirectory, { recursive: true, force: true });
  });

  const discovery = async () => JSON.stringify([{ sessionId: TARGET.sessionId, pid: 572 }]);
  const transport = async ({ socket, line }) => {
    assert.equal(socket, '/tmp/cc-socks/572.sock');
    await new Promise((resolve, reject) => {
      const client = createConnection(socketPath);
      client.once('error', reject);
      client.once('close', resolve);
      client.end(line);
    });
  };
  const f = fixture(t, { target: TARGET, discovery, transport });
  const owed = f.recordTurnOwed();
  const owedSeq = owed.event.seq;
  const outcome = await waitFor(
    () => f.store.eventsView().filter((event) => ['wake.root_delivered', 'wake.root_undelivered']
      .includes(event.payload?.kind) && event.payload.seq === owedSeq),
    (rows) => rows.length > 0,
    { label: 'turn_reported delivery outcome' },
  );

  assert.equal(outcome[0].payload.kind, 'wake.root_delivered');
  await waitFor(() => received, (rows) => rows.length === 1, { label: 'turn_reported socket frame' });
  const message = JSON.parse(received[0]);
  assert.match(message.message.content, /"owed": "turn_reported"/u);
  assert.match(message.message.content, /"participantId": "lead"/u);
  assert.doesNotMatch(message.message.content, /contributionId/u);

  const source = f.store.eventsView(owedSeq, 1)[0];
  const replay = await deliverRootWakeFrame({
    store: f.store, frame: deriveWakeFrame(source), target: TARGET, discovery, transport,
  });
  assert.deepEqual(replay, { delivered: false, duplicate: true });
  assert.equal(received.length, 1, 'the replay wrote no second socket frame');
  assert.equal(f.store.eventsView().filter((event) => event.payload?.kind === 'wake.root_delivered'
    && event.payload.seq === owedSeq).length, 1, 'the turn_reported identity has one delivery row');
});

test('564-w2: a failed resident delivery records its typed code and remains swarm attention', async (t) => {
  const f = fixture(t, {
    target: TARGET,
    discovery: async () => JSON.stringify([{ sessionId: TARGET.sessionId, pid: 565 }]),
    transport: async () => { throw Object.assign(new Error('session socket closed'), { code: 'ECONNREFUSED' }); },
  });
  await f.call('create', { purpose: 'issue 564 root wake delivery' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const owed = f.recordOwed({ contributionId: 'contribution-failed' });
  const owedSeq = owed.event.seq;

  const failures = await waitFor(
    () => f.store.eventsView().filter((event) => event.payload?.kind === 'wake.root_undelivered'),
    (rows) => rows.some((event) => event.payload.seq === owedSeq),
    { label: 'wake.root_undelivered' },
  );
  const failed = failures.find((event) => event.payload.seq === owedSeq);
  assert.equal(failed.payload.code, 'claude_session_transport_failed');
  assert.equal(f.store.eventsView().some((event) => event.payload?.kind === 'wake.root_delivered'
    && event.payload.seq === owedSeq), false, 'the failed identity has no delivered row');

  const view = await f.call('view', { projection: 'attention' });
  const attention = (Array.isArray(view.attention) ? view.attention : view.attention?.rows ?? [])
    .find((row) => row.kind === 'root_wake_undelivered' && row.seq === owedSeq);
  assert.ok(attention, 'the failed root wake remains visible in swarm attention');
  assert.deepEqual(attention.delivery,
    { state: 'failed', code: 'claude_session_transport_failed' });
});

test('564-w3: deployment open refuses every configured harness that cannot start an idle turn', async (t) => {
  const repo = mkdtempSync('/tmp/baton-564-config-');
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 564'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue564@example.invalid'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'base'], { cwd: repo });
  let created = false;
  for (const row of harnessWakeCapabilityRows().filter((capability) => !capability.canStartTurn)) {
    await assert.rejects(openBatonDeployment({
      repo,
      advanced: { rootWake: { harness: row.harness, sessionId: `operator-${row.harness}` } },
    }, () => { created = true; throw new Error('driver creation must not run'); }), (error) => (
      error?.code === 'wake_delivery_unavailable' && error.message.includes(row.harness)
    ), `${row.harness} refuses at deployment open`);
  }
  assert.equal(created, false, 'the invalid target refuses before driver construction');
});

test('572-w4: a real parentless turn report reaches the resident root transport once', async (t) => {
  const sent = [];
  const f = fixture(t, {
    target: TARGET,
    discovery: async () => JSON.stringify([{ sessionId: TARGET.sessionId, pid: 564 }]),
    transport: async ({ frame }) => { sent.push(frame); },
  });
  await f.call('create', { purpose: 'Deliver turn reports to root' });
  await f.call('recruit', { participantId: 'lead', objective: 'Complete assigned work' });
  const report = { swarmId: 'swarm-564', participantId: 'lead', workerId: 'w-1',
    turnSeq: 572, turnEpoch: 1, report: { status: 'completed', summary: 'Ready for the next assignment' } };
  await f.runtime.reportTurnEnd(report);
  const deliveries = () => f.store.eventsView().filter((row) =>
    ['wake.root_delivered', 'wake.root_undelivered'].includes(row.payload?.kind));
  await waitFor(deliveries, (rows) => rows.length > 0, { label: 'root delivery result' });
  assert.equal(deliveries()[0].payload.kind, 'wake.root_delivered',
    JSON.stringify(deliveries()[0].payload));
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.content, /Ready for the next assignment/);
  await f.runtime.reportTurnEnd(report);
  assert.equal(deliveries().length, 1);
  assert.equal(sent.length, 1);
});

for (const runId of ['run-plain', null]) {
  test(`572-w5: a non-swarm turn report reaches root once (run ${runId})`, async (t) => {
    const sent = [];
    const discovery = async () => JSON.stringify([{ sessionId: TARGET.sessionId, pid: 572 }]);
    const transport = async ({ frame }) => { sent.push(frame); };
    const f = fixture(t, { target: TARGET, discovery, transport });
    const source = f.store.recordDriver('worker.turn_reported', {
      runId, worker: 'w-plain', taskId: 'task-plain', turnSeq: 12, turnEpoch: 2,
      assignmentDone: false, report: { status: 'completed', summary: 'Inspect the changed files' },
    }, { actor: 'baton-runtime', key: 'plain-turn' }).event;
    const outcomes = () => f.store.eventsView().filter((row) => row.payload?.seq === source.seq
      && ['wake.root_delivered', 'wake.root_undelivered'].includes(row.payload?.kind));
    await waitFor(outcomes, (rows) => rows.length > 0, { label: 'non-swarm root delivery' });
    assert.equal(outcomes()[0].payload.kind, 'wake.root_delivered', JSON.stringify(outcomes()));
    assert.equal(sent.length, 1);
    assert.match(sent[0].message.content, /Inspect the changed files/);
    assert.match(sent[0].message.content, /"assignmentDone": false/);
    assert.match(sent[0].message.content, /"workerId": "w-plain"/);
    assert.equal(outcomes()[0].payload.swarmId, null);
    const replay = await deliverRootWakeFrame({
      store: f.store, frame: deriveWakeFrame(source), target: TARGET, discovery, transport,
    });
    assert.deepEqual(replay, { delivered: false, duplicate: true });
    assert.equal(sent.length, 1);
  });
}

test('572-w6: a failed root send retries without a new report and preserves message identity', async (t) => {
  const attempts = [];
  const discovery = async () => JSON.stringify([{ sessionId: TARGET.sessionId, pid: 572 }]);
  const transport = async ({ frame }) => {
    attempts.push(frame);
    if (attempts.length === 1) throw new Error('temporary socket failure');
  };
  const f = fixture(t, { target: TARGET, discovery, transport, retryDelayMs: 1 });
  const source = f.recordTurnOwed().event;
  const outcomes = () => f.store.eventsView().filter((row) => row.payload?.seq === source.seq
    && ['wake.root_delivered', 'wake.root_undelivered'].includes(row.payload?.kind));
  await waitFor(outcomes, (rows) => rows.some((row) => row.payload.kind === 'wake.root_delivered'),
    { label: 'retry delivery' });
  assert.deepEqual(outcomes().map((row) => row.payload.kind),
    ['wake.root_undelivered', 'wake.root_delivered']);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].msg_id, attempts[1].msg_id);
  const replay = await deliverRootWakeFrame({
    store: f.store, frame: deriveWakeFrame(source), target: TARGET, discovery, transport,
  });
  assert.deepEqual(replay, { delivered: false, duplicate: true });
  assert.equal(attempts.length, 2);
});
