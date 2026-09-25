// Issue #294 — the MCP notification source's own tests.
//
// The deployment wake stream is the resident's (impl/src/wake-stream.mjs + its `GET /v1/wakes`
// mount); what these tests pin is the CONSUMER half: `baton_wakes_subscribe` opens a filter over the
// session's ONE upstream attachment and every matching row then arrives as a
// `notifications/baton/wake` frame for as long as the session lives, `baton_wakes_unsubscribe`
// stops one subscription (the last one releasing the attachment), and `baton_wakes_since` is the
// same stream as ONE bounded page with a typed continuation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { createBatonWebMcpServer } from '../src/mcp-web-bridge.mjs';
import { serveMcpStdio } from '../src/mcp-northbound.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { startWakeResident, wakeFrame } from './wake-resident-double.mjs';

const REPO_ID = 'repo-wake-mcp';
const TOKEN = 'wake-consumer-token';
const BASE_URL = 'https://baton.local';
// The wire card a real resident publishes: the union the surface gate also builds its bridge facade
// from, so the bridge's ordinary floor (its ORDINARY_COMMANDS) is admitted by the served card.
const CARD = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  commands: Object.freeze([...new Set([
    ...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS),
  ])]),
  readiness: Object.freeze({ schemaVersion: 1, routes: Object.freeze([]) }),
});
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: Object.freeze({
    userId: 'operator', sessionId: 'session-wake',
    capabilities: Object.freeze(['observe', 'control']), repoIds: Object.freeze([REPO_ID]),
  }),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});

function waitFor(read, predicate, { timeoutMs = 10_000, label = 'frames' } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const value = read();
      if (predicate(value)) return resolve(value);
      if (Date.now() > deadline) {
        return reject(new Error(`timed out waiting for ${label}; saw ${JSON.stringify(value).slice(0, 600)}`));
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

async function fixture(t, { frames = [], maxMessageBytes = null } = {}) {
  const resident = await startWakeResident({ token: TOKEN, frames, card: CARD, session: SESSION });
  t.after(() => resident.close());
  const directory = mkdtempSync(join(tmpdir(), 'baton-wake-mcp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // The production bridge: a real BatonWebClient over the resident's owner-only socket, the real
  // facade, and the real server the harness spawns. Only the resident is a double.
  const server = await createBatonWebMcpServer({
    connection: {
      baseUrl: BASE_URL,
      origin: BASE_URL,
      repoId: REPO_ID,
      token: TOKEN,
      socketPath: resident.socketPath,
      transport: 'local',
    },
    coordination: new CoordinationStore(join(directory, 'coordination')),
    pollMs: 25,
    commandTimeoutMs: 30_000,
    ...(maxMessageBytes === null ? {} : { maxMessageBytes }),
  });
  const delivered = [];
  server.attachNotificationSink((frame) => { delivered.push(frame); });
  await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wake-test', version: '1' } },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (id, name, args = {}) => server.handle({
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
  });
  return { resident, server, delivered, call };
}

const frameOf = (response) => response?.result?.structuredContent;
const errorCode = (response) => frameOf(response)?.error?.code ?? null;

test('the wake tools are advertised on the MCP surface with closed schemas', async (t) => {
  const { server } = await fixture(t);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = new Map(listed.result.tools.map((tool) => [tool.name, tool]));
  for (const name of ['baton_wakes_subscribe', 'baton_wakes_unsubscribe', 'baton_wakes_since']) {
    const tool = tools.get(name);
    assert.ok(tool, `${name} is advertised`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${name} schema is closed`);
    assert.equal(tool._meta['baton/registryDigest'], APPLICATION_SEMANTIC_REGISTRY.digest,
      `${name} carries the registry digest it was derived from`);
    assert.equal(tool.execution.taskSupport, 'forbidden', `${name} is not a task-plane tool`);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'repoId'), false,
      `${name} omits the coordinate the bound surface derives`);
  }
  // The surface gate admits an advertised tool by resolving its NAME to a canonical operation
  // (impl/src/application-semantics.mjs) — a tool name that resolves to nothing is a novel
  // divergence, which the divergence ledger may not absorb.
  const keys = new Set(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map((row) => row.key));
  for (const key of ['wakes.subscribe', 'wakes.unsubscribe', 'wakes.since']) {
    assert.ok(keys.has(key), `${key} is a registered canonical operation`);
  }
});

test('a subscription returns its receipt and every matching row arrives as a wake notification', async (t) => {
  const { resident, call, delivered } = await fixture(t, {
    frames: [wakeFrame({ seq: 4, wakeClass: 'recruited', swarmId: 'swarm-a' })],
  });
  const receipt = frameOf(await call(3, 'baton_wakes_subscribe', { kinds: ['recruited', 'dead'] }));
  assert.equal(typeof receipt.subscriptionId, 'string', 'the receipt names the subscription');
  assert.equal(receipt.attachments, 1, 'the receipt names the one attachment it rides');
  resident.push(wakeFrame({ seq: 5, wakeClass: 'dead', swarmId: 'swarm-a', participantId: 'builder' }));
  resident.push(wakeFrame({ seq: 6, wakeClass: 'reviewed', swarmId: 'swarm-a' }));
  const notifications = await waitFor(() => delivered, (frames) => (
    frames.some((frame) => frame.params?.seq === 5)
  ), { label: 'the dead wake' });
  const wake = notifications.find((frame) => frame.params?.seq === 5);
  assert.equal(wake.jsonrpc, '2.0');
  assert.equal(wake.method, 'notifications/baton/wake');
  assert.equal(wake.params.kind, 'baton.wake', 'params IS the stream frame');
  assert.equal(wake.params.wakeClass, 'dead');
  assert.equal(wake.params.swarmId, 'swarm-a');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(delivered.some((frame) => frame.params?.seq === 6), false,
    'a class the subscription did not name is not delivered');
  assert.equal(delivered.some((frame) => frame.params?.seq === 4), false,
    'a subscription without `since` starts from now, never from the deployment history');
});

test('N subscriptions ride ONE upstream attachment, each filtered by its own subscription', async (t) => {
  const { resident, call, delivered } = await fixture(t);
  const first = frameOf(await call(3, 'baton_wakes_subscribe', { kinds: ['dead'] }));
  const second = frameOf(await call(4, 'baton_wakes_subscribe', { swarms: ['swarm-b'] }));
  assert.notEqual(first.subscriptionId, second.subscriptionId);
  resident.push(wakeFrame({ seq: 11, wakeClass: 'dead', swarmId: 'swarm-a', participantId: 'a1' }));
  resident.push(wakeFrame({ seq: 12, wakeClass: 'paused', swarmId: 'swarm-b', participantId: 'b1' }));
  await waitFor(() => delivered, (frames) => frames.some((frame) => frame.params?.seq === 12), { label: 'seq 12' });
  assert.equal(resident.attachmentCount(), 1, 'a subscription is a filter, not a connection');
  assert.equal(resident.requests.filter((request) => request.path === '/v1/wakes').length, 1,
    'exactly one wake request reached the resident');
  assert.equal(delivered.filter((frame) => frame.params?.seq === 11).length, 1,
    'the class filter delivered seq 11 once');
  assert.equal(delivered.filter((frame) => frame.params?.seq === 12).length, 1,
    'the swarm filter delivered seq 12 once');
});

test('unsubscribe stops one subscription, and the last one releases the attachment', async (t) => {
  const { resident, call, delivered } = await fixture(t);
  const first = frameOf(await call(3, 'baton_wakes_subscribe', { kinds: ['dead'] }));
  const second = frameOf(await call(4, 'baton_wakes_subscribe', {}));
  const stopped = frameOf(await call(5, 'baton_wakes_unsubscribe', { subscriptionId: first.subscriptionId }));
  assert.equal(stopped.subscriptionId, first.subscriptionId);
  assert.equal(stopped.subscriptions, 1, 'the other subscription is untouched');
  resident.push(wakeFrame({ seq: 21, wakeClass: 'dead', swarmId: 'swarm-a' }));
  await waitFor(() => delivered, (frames) => frames.some((frame) => frame.params?.seq === 21), { label: 'seq 21' });
  assert.equal(delivered.filter((frame) => frame.params?.seq === 21).length, 1,
    'the stopped subscription no longer receives; the open one still does');
  assert.equal(errorCode(await call(6, 'baton_wakes_unsubscribe', { subscriptionId: 'wake-sub:nope' })),
    'wake_subscription_not_found');
  const last = frameOf(await call(7, 'baton_wakes_unsubscribe', { subscriptionId: second.subscriptionId }));
  assert.equal(last.subscriptions, 0);
  await waitFor(() => resident.attachmentCount(), (count) => count === 0, { label: 'the released attachment' });
});

test('a dropped attachment reconnects from the last delivered seq, with no gap and no duplicate', async (t) => {
  const { resident, call, delivered } = await fixture(t);
  frameOf(await call(3, 'baton_wakes_subscribe', {}));
  resident.push(wakeFrame({ seq: 31, wakeClass: 'paused', swarmId: 'swarm-a' }));
  await waitFor(() => delivered, (frames) => frames.some((frame) => frame.params?.seq === 31), { label: 'seq 31' });
  resident.drop();
  await waitFor(() => resident.attachmentCount(), (count) => count === 1, { label: 'the reattachment' });
  const resumed = resident.requests.filter((request) => request.path === '/v1/wakes');
  assert.equal(resumed.length, 2, 'the consumer reattached');
  assert.equal(resumed[1].lastEventId, '31',
    'the reconnect resumes from the last seq this session actually delivered');
  resident.push(wakeFrame({ seq: 32, wakeClass: 'paused', swarmId: 'swarm-a' }));
  await waitFor(() => delivered, (frames) => frames.some((frame) => frame.params?.seq === 32), { label: 'seq 32' });
  assert.equal(delivered.filter((frame) => frame.params?.seq === 31).length, 1,
    'the resumed stream does not re-deliver what was already delivered');
});

test('a lagging stream tells the subscriber how much it lost, in the stream\'s own typed frame', async (t) => {
  const { resident, call, delivered } = await fixture(t);
  frameOf(await call(3, 'baton_wakes_subscribe', {}));
  resident.lag({
    schemaVersion: 1, kind: 'baton.wake_stream_lagged', dropped: 12, fromSeq: 40, toSeq: 51, cursor: 51,
  });
  const notifications = await waitFor(() => delivered, (frames) => (
    frames.some((frame) => frame.params?.kind === 'baton.wake_stream_lagged')
  ), { label: 'the lag frame' });
  const lagged = notifications.find((frame) => frame.params?.kind === 'baton.wake_stream_lagged');
  assert.equal(lagged.method, 'notifications/baton/wake');
  assert.equal(lagged.params.dropped, 12, 'the marker names exactly how many rows were lost');
  assert.equal(lagged.params.cursor, 51);
});

test('baton_wakes_since is the pull form: rows after the cursor, the new cursor, and a typed continuation', async (t) => {
  const { call } = await fixture(t, {
    frames: [
      wakeFrame({ seq: 1, wakeClass: 'recruited', swarmId: 'swarm-a' }),
      wakeFrame({ seq: 2, wakeClass: 'dead', swarmId: 'swarm-a' }),
      wakeFrame({ seq: 3, wakeClass: 'paused', swarmId: 'swarm-b' }),
      wakeFrame({ seq: 4, wakeClass: 'closed', swarmId: 'swarm-a' }),
    ],
  });
  const page = frameOf(await call(3, 'baton_wakes_since', { since: 1, kinds: ['dead', 'paused'] }));
  assert.equal(page.kind, 'baton.wake_page');
  assert.deepEqual(page.frames.map((frame) => frame.seq), [2, 3], 'rows after the cursor, filtered by class');
  assert.equal(page.cursor, 4, 'the new cursor is where the deployment actually stopped');
  assert.equal(page.continuation, null, 'a page that fit the ceiling carries no continuation');
  const rest = frameOf(await call(4, 'baton_wakes_since', { since: page.cursor }));
  assert.deepEqual(rest.frames, [], 'resuming from the returned cursor repeats nothing');
  assert.equal(rest.cursor, 4);
});

test('the pull page is bounded by the transport frame ceiling, never by a row count', async (t) => {
  // The ceiling is the server's own deployment-derived bound (the resident bridge passes 256 KiB);
  // this fixture makes it small enough that the whole ledger cannot fit, so the typed continuation —
  // not a constant page size — is what tells the caller how to fetch the rest.
  const frames = Array.from({ length: 6 }, (_, index) => wakeFrame({
    seq: index + 1, wakeClass: 'paused', swarmId: 'swarm-a', participantId: `participant-${index}`,
  }));
  const { call } = await fixture(t, { frames, maxMessageBytes: 1_024 });
  const page = frameOf(await call(3, 'baton_wakes_since', { since: 0 }));
  assert.ok(page.frames.length > 0 && page.frames.length < frames.length,
    `a partial page under a ${1_024}-byte ceiling (got ${page.frames.length} rows)`);
  assert.equal(page.continuation.kind, 'baton.wakes_continuation', 'the continuation is typed');
  assert.equal(page.continuation.reason, 'frame_ceiling');
  assert.equal(page.continuation.nextSince, page.frames.at(-1).seq,
    'the continuation resumes exactly after the last row returned');
  assert.equal(page.continuation.remaining, frames.length - page.frames.length);
  assert.equal(page.cursor, page.continuation.nextSince, 'the cursor IS the continuation cursor');
  const next = frameOf(await call(4, 'baton_wakes_since', { since: page.cursor }));
  assert.equal(next.frames[0].seq, page.frames.at(-1).seq + 1, 'the next page continues without a gap');
});

test('an unknown wake class refuses with the closed set, and no attachment is opened', async (t) => {
  const { resident, call } = await fixture(t);
  const refusal = await call(3, 'baton_wakes_subscribe', { kinds: ['not_a_class'] });
  assert.equal(errorCode(refusal), 'invalid_wake_filter');
  const message = frameOf(refusal).error.message;
  assert.match(message, /unknown wake class\(es\): not_a_class/u);
  for (const wakeClass of ['recruited', 'contribution_recorded', 'capacity_pressure']) {
    assert.match(message, new RegExp(`\\b${wakeClass}\\b`, 'u'), `${wakeClass} is named in the closed set`);
  }
  assert.equal(resident.requests.length, 0, 'a refused subscription never touches the resident');
});

test('the notification reaches the MCP client on the wire, through the stdio transport', async (t) => {
  const { server, resident } = await fixture(t);
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  let buffered = '';
  output.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim().length > 0) frames.push(JSON.parse(line));
    }
  });
  const serving = serveMcpStdio(server, { input, output });
  t.after(async () => { input.end(); await serving.catch(() => {}); });
  const send = (frame) => input.write(`${JSON.stringify(frame)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wake-wire', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'baton_wakes_subscribe', arguments: { kinds: ['dead'] } } });
  await waitFor(() => frames, (seen) => seen.some((frame) => frame.id === 2), { label: 'the subscription receipt' });
  resident.push(wakeFrame({ seq: 71, wakeClass: 'dead', swarmId: 'swarm-a', participantId: 'builder' }));
  const wire = await waitFor(() => frames, (seen) => (
    seen.some((frame) => frame.method === 'notifications/baton/wake')
  ), { label: 'the wire notification' });
  const notification = wire.find((frame) => frame.method === 'notifications/baton/wake');
  assert.equal(notification.jsonrpc, '2.0');
  assert.equal(Object.hasOwn(notification, 'id'), false, 'a notification carries no id');
  assert.equal(notification.params.seq, 71);
  assert.equal(notification.params.wakeClass, 'dead');
});
