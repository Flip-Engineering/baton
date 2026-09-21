// Issue #529 (docs/54 §4) — MCP auto-subscription: a session receives the deployment wake stream
// as notifications/baton/wake from the moment it connects, with no tool call. The seat's filter is
// the swarm the deployment published its bridge under (swarm-native-bridge.mjs SWARM_BRIDGE_ENV_KEYS);
// a session without those coordinates carries every swarm. The explicit subscribe/unsubscribe/since
// tools keep working beside it, and the auto-subscription is removable by the id the greeting names.
//
// Rows:
//   (a)  a seat session auto-subscribes at initialize: the greeting names the subscription and its
//        swarm, the frame of that swarm arrives as notifications/baton/wake, and no tool call
//        reached the resident;
//   (b)  a root session (no seat coordinates) receives every swarm's frames;
//   (c)  the seat's session carries only its own swarm's frames;
//   (d)  the explicit tools still work: a narrower subscription adds beside the auto-subscription,
//        and unsubscribing the auto-subscription releases the session's one attachment;
//   (e)  wakeAutoSubscription(env) derives the filter from the seat's bridge environment, its
//        published narrowing (§4.1) included;
//   (f)  a connection that serves no wake stream completes the handshake and says so;
//   (g)  a session without `observe` takes no auto-subscription and the greeting says nothing;
//   (h)  the auto-delivered frame reaches the MCP client on the wire, through the stdio transport.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { McpFleetServer, serveMcpStdio } from '../src/mcp-northbound.mjs';
import { createBatonWebMcpServer, wakeAutoSubscription } from '../src/mcp-web-bridge.mjs';
import { SWARM_BRIDGE_ENV_KEYS } from '../src/swarm-native-bridge.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { startWakeResident, wakeFrame } from './wake-resident-double.mjs';

const REPO_ID = 'repo-529-wake';
const TOKEN = 'wake-529-token';
const BASE_URL = 'https://baton.local';
const SEAT_SWARM = 'swarm-wake-529';
const SEAT = 'wake-lead';
const NOW = Date.parse('2026-09-21T00:00:00.000Z');
const CARD = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  commands: Object.freeze([...new Set([
    ...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS),
  ])]),
  readiness: Object.freeze({ schemaVersion: 1, routes: Object.freeze([]) }),
});
const sessionDocument = (capabilities = ['observe', 'control']) => Object.freeze({
  schemaVersion: 1,
  identity: Object.freeze({
    userId: 'operator', sessionId: 'session-529-wake',
    capabilities: Object.freeze([...capabilities]), repoIds: Object.freeze([REPO_ID]),
  }),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});
// The seat's bridge environment: the ONE key table the deployment publishes a seat's bridge under.
const SEAT_ENV = Object.freeze({
  [SWARM_BRIDGE_ENV_KEYS.url]: 'http://127.0.0.1:9/',
  [SWARM_BRIDGE_ENV_KEYS.token]: 'seat-token',
  [SWARM_BRIDGE_ENV_KEYS.swarmId]: SEAT_SWARM,
  [SWARM_BRIDGE_ENV_KEYS.participantId]: SEAT,
  [SWARM_BRIDGE_ENV_KEYS.runId]: 'run-529',
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

// The production session: a real BatonWebClient over the resident double's owner-only socket, the
// real facade, and the real server a harness spawns. The autoWake configuration is the one the
// entry derives from its environment, so the derivation under test is the shipped one.
async function fixture(t, { frames = [], env = {}, capabilities = ['observe', 'control'] } = {}) {
  const resident = await startWakeResident({
    token: TOKEN, frames, card: CARD, session: sessionDocument(capabilities),
  });
  t.after(() => resident.close());
  const directory = mkdtempSync(join(tmpdir(), 'baton-529-wake-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = await createBatonWebMcpServer({
    connection: {
      baseUrl: BASE_URL, origin: BASE_URL, repoId: REPO_ID, token: TOKEN,
      socketPath: resident.socketPath, transport: 'local',
    },
    coordination: new CoordinationStore(join(directory, 'coordination')),
    pollMs: 25,
    commandTimeoutMs: 30_000,
    autoWake: wakeAutoSubscription(env),
  });
  const delivered = [];
  server.attachNotificationSink((frame) => { delivered.push(frame); });
  let key = 1;
  const call = (name, args = {}) => server.handle({
    jsonrpc: '2.0', id: key++, method: 'tools/call', params: { name, arguments: args },
  });
  const initialize = async () => {
    const greeting = await server.handle({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'wake-529', version: '1' },
      },
    });
    await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return greeting;
  };
  return { resident, server, delivered, call, initialize };
}

const frameOf = (response) => response?.result?.structuredContent;
const wakeRequests = (resident) => resident.requests.filter((request) => request.path === '/v1/wakes');

// The embedded path: the server a descriptor/module entry constructs directly, over a stub
// application that serves no wake stream. It is how a session that is not the resident bridge is
// built, and it is where the capability gate is observable without the client's own session check.
function embeddedServer(t, { autoWake, capabilities = ['observe', 'control'] }) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-529-embedded-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination')),
    application: {
      repoId: REPO_ID,
      card: () => ({
        schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
      }),
      async authorizeReplay() { return true; },
      async command(name) { return { schemaVersion: 1, command: name }; },
    },
    shutdownPrincipal: { actor: 'mcp-host:529', principalId: 'mcp-host', sessionId: 'mcp-host-529' },
    surface: 'application',
    autoWake,
    principal: {
      userId: 'operator-b', sessionId: 'entry-529', capabilities: [...capabilities],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  const delivered = [];
  server.attachNotificationSink((frame) => { delivered.push(frame); });
  const initialize = () => server.handle({
    jsonrpc: '2.0', id: 'init', method: 'initialize',
    params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: '529-embedded', version: '1' },
    },
  });
  return { server, delivered, initialize };
}

// ── (a) a seat session auto-subscribes to its own swarm ─────────────────────

test('529-mcp-a: a seat session subscribes itself to its swarm and receives frames with no tool call', async (t) => {
  const f = await fixture(t, { env: SEAT_ENV });
  const greeting = await f.initialize();

  assert.match(greeting.result.instructions,
    new RegExp(`Auto-subscribed to the wake stream for swarm ${SEAT_SWARM} as wake-sub:`, 'u'),
    'the greeting names the auto-subscription and the swarm it carries');
  assert.equal(f.server.autoWakeReceipt.kinds, null, 'every class is admitted by default');
  assert.deepEqual([...f.server.autoWakeReceipt.swarms], [SEAT_SWARM]);
  assert.equal(f.server.autoWakeReceipt.participants, null,
    'every participant of the seat\'s swarm rides the subscription');

  await f.resident.waitForAttachment();
  assert.deepEqual(f.resident.requests.map((request) => request.path), ['/v1/wakes'],
    'the session attached the stream and called no tool');
  assert.equal(wakeRequests(f.resident).length, 1,
    'the session holds ONE attachment, opened by the auto-subscription');

  f.resident.push(wakeFrame({
    seq: 91, wakeClass: 'contribution_recorded', swarmId: SEAT_SWARM, participantId: SEAT,
  }));
  const seen = await waitFor(() => f.delivered,
    (frames) => frames.some((frame) => frame.params?.seq === 91), { label: 'the auto-delivered wake' });
  const notification = seen.find((frame) => frame.params?.seq === 91);
  assert.equal(notification.jsonrpc, '2.0');
  assert.equal(notification.method, 'notifications/baton/wake');
  assert.equal(Object.hasOwn(notification, 'id'), false, 'a notification carries no id');
  assert.equal(notification.params.kind, 'baton.wake', 'params IS the stream frame');
  assert.equal(notification.params.wakeClass, 'contribution_recorded');
});

// ── (b) a root session carries every swarm ──────────────────────────────────

test('529-mcp-b: a root session receives every swarm\'s frames', async (t) => {
  const f = await fixture(t, { env: {} });
  const greeting = await f.initialize();

  assert.match(greeting.result.instructions, /Auto-subscribed to the wake stream as wake-sub:/u,
    'a session without seat coordinates is told it carries the deployment stream');
  assert.equal(f.server.autoWakeReceipt.swarms, null, 'no swarm axis narrows the root session');
  await f.resident.waitForAttachment();
  assert.equal(wakeRequests(f.resident).length, 1,
    'the root session holds ONE attachment, opened by the auto-subscription');

  f.resident.push(wakeFrame({ seq: 95, wakeClass: 'dead', swarmId: 'swarm-a', participantId: 'a1' }));
  f.resident.push(wakeFrame({ seq: 96, wakeClass: 'dead', swarmId: 'swarm-b', participantId: 'b1' }));
  const seen = await waitFor(() => f.delivered,
    (frames) => frames.some((frame) => frame.params?.seq === 96), { label: 'the second swarm' });
  for (const seq of [95, 96]) {
    assert.equal(seen.filter((frame) => frame.params?.seq === seq).length, 1, `seq ${seq} arrived once`);
  }
});

// ── (c) the seat's session carries only its own swarm ───────────────────────

test('529-mcp-c: a seat session carries only its own swarm\'s frames', async (t) => {
  const f = await fixture(t, { env: SEAT_ENV });
  await f.initialize();
  await f.resident.waitForAttachment();

  f.resident.push(wakeFrame({ seq: 97, wakeClass: 'dead', swarmId: SEAT_SWARM, participantId: SEAT }));
  f.resident.push(wakeFrame({ seq: 98, wakeClass: 'dead', swarmId: 'swarm-other', participantId: 'other' }));
  const seen = await waitFor(() => f.delivered,
    (frames) => frames.some((frame) => frame.params?.seq === 97), { label: 'the seat swarm frame' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seen.some((frame) => frame.params?.seq === 98), false,
    'a sibling swarm\'s row is not this seat\'s wake');
});

// ── (d) the explicit tools still work, and the auto-subscription is removable ─

test('529-mcp-d: the greeting\'s id removes the auto-subscription and the explicit tools still work', async (t) => {
  const f = await fixture(t, { env: SEAT_ENV });
  const greeting = await f.initialize();
  const autoId = / as (wake-sub:[0-9a-f-]{36});/u.exec(greeting.result.instructions)?.[1] ?? null;
  assert.ok(autoId, 'the greeting names the subscription id the session can stop');

  const narrower = frameOf(await f.call('baton_wakes_subscribe', { kinds: ['dead'] }));
  assert.notEqual(narrower.subscriptionId, autoId, 'the explicit verb opens its own subscription');
  assert.equal(narrower.attachments, 1, 'a subscription is a filter over the session\'s ONE attachment');

  const stopped = frameOf(await f.call('baton_wakes_unsubscribe', { subscriptionId: autoId }));
  assert.equal(stopped.subscriptionId, autoId);
  assert.equal(stopped.subscriptions, 1, 'the explicit subscription is untouched');

  // The narrow subscription still delivers, on the attachment the auto-subscription opened.
  f.resident.push(wakeFrame({ seq: 93, wakeClass: 'dead', swarmId: SEAT_SWARM, participantId: SEAT }));
  const seen = await waitFor(() => f.delivered,
    (frames) => frames.some((frame) => frame.params?.seq === 93), { label: 'the narrowed wake' });
  assert.equal(seen.filter((frame) => frame.params?.seq === 93).length, 1);

  const last = frameOf(await f.call('baton_wakes_unsubscribe', { subscriptionId: narrower.subscriptionId }));
  assert.equal(last.subscriptions, 0);
  await waitFor(() => f.resident.attachmentCount(), (count) => count === 0,
    { label: 'the released attachment' });
});

// ── (e) the derivation reads the seat's bridge environment ──────────────────

test('529-mcp-e: the derivation reads the seat\'s bridge environment', () => {
  assert.deepEqual({ ...wakeAutoSubscription(SEAT_ENV) },
    { kinds: null, swarms: [SEAT_SWARM], participants: null });
  assert.deepEqual({ ...wakeAutoSubscription({}) },
    { kinds: null, swarms: null, participants: null },
    'a session without a seat bridge carries the deployment stream');
  assert.deepEqual({ ...wakeAutoSubscription({ [SWARM_BRIDGE_ENV_KEYS.swarmId]: '   ' }) },
    { kinds: null, swarms: null, participants: null },
    'a blank seat id names no swarm');
  assert.deepEqual({ ...wakeAutoSubscription({ ...SEAT_ENV,
    [SWARM_BRIDGE_ENV_KEYS.autoWake]: `{"kinds":["dead","left"],"participants":["${SEAT}"]}` }) },
  { kinds: ['dead', 'left'], swarms: [SEAT_SWARM], participants: [SEAT] },
  'the narrowing the seat was recruited with narrows the axes it names and no others');
  assert.deepEqual({ ...wakeAutoSubscription({ ...SEAT_ENV,
    [SWARM_BRIDGE_ENV_KEYS.autoWake]: '{"kinds":["no-such-class"]}' }) },
  { kinds: null, swarms: [SEAT_SWARM], participants: null },
  'a corrupted declaration leaves the axes whole rather than narrowing a session to nothing');
});

// ── (f) a connection that serves no wake stream says so ─────────────────────

test('529-mcp-f: a connection with no wake stream completes the handshake and names the state', async (t) => {
  const { server, delivered, initialize } = embeddedServer(t, {
    autoWake: { kinds: null, swarms: null, participants: null },
  });
  const greeting = await initialize();
  assert.equal(typeof greeting.result.protocolVersion, 'string', 'the handshake still answers');
  assert.equal(greeting.result.serverInfo.name, 'baton');
  assert.match(greeting.result.instructions,
    /Auto wake subscription unavailable: this connection serves no wake stream\./u);
  assert.equal(server.autoWakeReceipt, null, 'no subscription was recorded');
  assert.deepEqual(delivered, []);
});

// ── (g) a session without `observe` takes no auto-subscription ──────────────

test('529-mcp-g: a session without observe takes no auto-subscription', async (t) => {
  const { server, delivered, initialize } = embeddedServer(t, {
    autoWake: { kinds: null, swarms: [SEAT_SWARM], participants: null },
    capabilities: ['control'],
  });
  const greeting = await initialize();

  // The subscription is the observe verb's own authority: a session that could not read the stream
  // is told nothing about one, rather than being told a stream it may not use is unavailable.
  assert.doesNotMatch(greeting.result.instructions, /Auto-subscribed|Auto wake subscription/u,
    'the greeting says nothing about a stream this session may not read');
  assert.equal(server.autoWakeReceipt, null, 'no subscription was recorded');
  assert.deepEqual(delivered, []);
});

// ── (h) the auto-delivered frame reaches the client on the wire ─────────────

test('529-mcp-h: the auto-delivered frame reaches the MCP client through the stdio transport', async (t) => {
  const f = await fixture(t, { env: SEAT_ENV });
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
  const serving = serveMcpStdio(f.server, { input, output });
  t.after(async () => { input.end(); await serving.catch(() => {}); });

  input.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'wake-529-wire', version: '1' },
    },
  })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await waitFor(() => frames, (seen) => seen.some((frame) => frame.id === 1), { label: 'the greeting' });

  await f.resident.waitForAttachment();
  f.resident.push(wakeFrame({
    seq: 71, wakeClass: 'contribution_recorded', swarmId: SEAT_SWARM, participantId: SEAT,
  }));
  const wire = await waitFor(() => frames,
    (seen) => seen.some((frame) => frame.method === 'notifications/baton/wake'),
    { label: 'the wire notification' });
  const notification = wire.find((frame) => frame.method === 'notifications/baton/wake');
  assert.equal(Object.hasOwn(notification, 'id'), false, 'a notification carries no id');
  assert.equal(notification.params.seq, 71);
  assert.equal(notification.params.wakeClass, 'contribution_recorded');
  assert.equal(wire.filter((frame) => frame.id !== undefined).length, 1,
    'the session sent one request — the initialize — and no tool call');
});
