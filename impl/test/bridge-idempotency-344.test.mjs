// Issue #344 — bridge idempotency keys: reads carry none, keyed verbs derive over every axis.
//
// (1) Read-only bridge verbs (swarm.view, swarm.watch, evidence.search, board/scratchpad
// reads) carry and send NO idempotencyKey: the advertised read schemas never name the field,
// and the resident admits a keyless read envelope.
// (2) Every keyed (effectful) verb derives its idempotency key over EVERY argument axis: a
// changed axis means a fresh key, an identical request replays the admitted one — two
// different intents can never share one key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';
import { webAdmittedCommandNames, webCardCommandNames } from '../src/web-northbound.mjs';
import { BatonWebApplicationFacade } from '../src/mcp-web-bridge.mjs';
import { CoordinationStore, McpFleetServer, WebNorthbound } from '../src/index.mjs';

const REPO_ID = 'repo-bridge-idempotency-344';
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: { userId: 'bridge-user', sessionId: 'bridge-session', capabilities: ['observe', 'control'], repoIds: [REPO_ID] },
  expiresAt: '2099-01-01T00:00:00.000Z',
});
const PRINCIPAL = Object.freeze({ actor: 'mcp:bridge-user:bridge-session', principalId: 'bridge-user', sessionId: 'bridge-session' });
const CONTEXT = Object.freeze({ transport: 'mcp', requestId: '7', idempotencyKey: 'mcp.call:7' });
const WIRE_CARD = Object.freeze([...new Set([...webAdmittedCommandNames(), ...webCardCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS)])]);

function facadeWith(commands) {
  const forwarded = [];
  const card = { repoId: REPO_ID, commands, agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest } };
  const client = {
    repoId: REPO_ID,
    async session() { return SESSION; },
    async doctor() { return { ready: true, application: card }; },
    async command(name, args, key) { forwarded.push({ name, args, key }); return { ok: true, command: name }; },
  };
  return { facade: new BatonWebApplicationFacade(client, card, SESSION), forwarded };
}

test('344: keyed bridge verbs derive over every argument axis', async () => {
  const { facade, forwarded } = facadeWith(WIRE_CARD);
  // One caller key, three intents: two different swarm.update axes and an identical repeat.
  await facade.command('swarm.update', { swarmId: 's', event: 'first' }, PRINCIPAL, CONTEXT);
  await facade.command('swarm.update', { swarmId: 's', event: 'second' }, PRINCIPAL, CONTEXT);
  await facade.command('swarm.update', { swarmId: 's', event: 'first' }, PRINCIPAL, CONTEXT);
  const [first, second, repeat] = forwarded.map((row) => row.key);
  assert.notEqual(second, first, 'a changed axis means a fresh key');
  assert.equal(repeat, first, 'an identical request replays the admitted one');
  // The same law holds for the other keyed swarm verbs, not just one of them.
  const before = forwarded.length;
  await facade.command('swarm.guide', { swarmId: 's', participantId: 'p', message: 'a' }, PRINCIPAL, CONTEXT);
  await facade.command('swarm.guide', { swarmId: 's', participantId: 'p', message: 'b' }, PRINCIPAL, CONTEXT);
  assert.notEqual(forwarded[before + 1].key, forwarded[before].key, 'swarm.guide derives over every axis too');
  // And the legacy keyed verbs keep deriving over their args (no regression; run.answer
  // has no post-command outline fetch, unlike run.start/run.stop).
  await facade.command('run.answer', { runId: 'run:1', requestId: 'q-1', answer: 'a' }, PRINCIPAL, CONTEXT);
  await facade.command('run.answer', { runId: 'run:1', requestId: 'q-1', answer: 'b' }, PRINCIPAL, CONTEXT);
  assert.notEqual(forwarded[before + 3].key, forwarded[before + 2].key, 'run.answer still derives over its args');
});

// ---------------------------------------------------------------------------
// The resident half: read-only envelopes admit with NO idempotencyKey, keyed
// verbs still require one.
// ---------------------------------------------------------------------------

const webPrincipal = (overrides = {}) => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
  csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID],
  ...overrides,
});
const webContext = (overrides = {}) => ({
  principal: webPrincipal(), origin: 'https://control.example.test', csrfToken: 'csrf-1',
  remoteAddress: '127.0.0.1', transport: 'https', ...overrides,
});
const webEnvelope = (overrides = {}) => ({
  schemaVersion: 1,
  commandId: 'cmd-344',
  command: 'list',
  args: {},
  repoId: REPO_ID,
  origin: 'https://control.example.test',
  ...overrides,
});

function webFixture({ application = null, coordinatorOverrides = {} } = {}) {
  const calls = [];
  const coordinator = {
    list() { calls.push({ op: 'list' }); return [{ id: 'w-1', fence: 1, status: 'working' }]; },
    async result(workerId) { calls.push({ op: 'result', workerId }); return { ready: false, status: 'working' }; },
    ...coordinatorOverrides,
  };
  const directory = mkdtempSync(join(tmpdir(), 'baton-344-web-'));
  const coordination = new CoordinationStore(directory);
  const web = new WebNorthbound({
    coordinator, coordination, repoIds: [REPO_ID], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-07-11T12:00:00.000Z'),
    ...(application === null ? {} : { application }),
  });
  return { web, calls, directory };
}

test('344: read-only web envelopes admit without an idempotencyKey', async (t) => {
  const { web, directory } = webFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { idempotencyKey: _dropped, ...keyless } = webEnvelope();
  assert.equal(Object.hasOwn(keyless, 'idempotencyKey'), false, 'the read envelope carries no key');
  const read = await web.execute(webContext(), keyless);
  assert.equal(read.status, 200, `a keyless read admits: ${JSON.stringify(read.body)}`);
  // A keyed verb without its key still refuses — the requirement moved, it did not vanish.
  const { idempotencyKey: _alsoDropped, ...keylessSpawn } = webEnvelope({
    commandId: 'cmd-344-spawn', command: 'spawn',
    args: {
      harness: 'mock', brief: { goal: 'g', constraints: [], pathScope: ['x'], definitionOfDone: 'd', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 0, wallMin: 1 } },
    },
  });
  const refused = await web.execute(webContext(), keylessSpawn);
  assert.equal(refused.status, 400, 'a keyless mutation still refuses');
});

test('344: identical keyless reads replay, differing keyless reads stay fresh', async (t) => {
  const { web, directory } = webFixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const read = (commandId, args) => {
    const envelope = webEnvelope({ commandId, command: 'result', args });
    delete envelope.idempotencyKey;
    return web.execute(webContext(), envelope);
  };
  const first = await read('cmd-344-a', { workerId: 'w-1' });
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed ?? false, false, 'the first read executes');
  const repeat = await read('cmd-344-b', { workerId: 'w-1' });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.replayed, true, 'the identical keyless read replays the admitted one');
  const other = await read('cmd-344-c', { workerId: 'w-2' });
  assert.equal(other.status, 200);
  assert.equal(other.body.replayed ?? false, false, 'a changed axis reads fresh, never conflicts');
});

function readingApplication() {
  const commands = [];
  return {
    application: {
      repoId: REPO_ID,
      card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: webCardCommandNames() }),
      async authorizeReplay() { return true; },
      async command(name, args) { commands.push({ name, args }); return { schemaVersion: 1, command: name }; },
    },
    commands,
  };
}

test('344: board and scratchpad reads are resident reads', async (t) => {
  const { application, commands } = readingApplication();
  const { web, directory } = webFixture({ application });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const read = (commandId, command) => {
    const envelope = webEnvelope({ commandId, command, args: {} });
    delete envelope.idempotencyKey;
    return web.execute(webContext(), envelope);
  };
  for (const command of ['run_board_read', 'run_scratchpad_read']) {
    const first = await read(`cmd-344-${command}-1`, command);
    assert.equal(first.status, 200, `keyless ${command} admits: ${JSON.stringify(first.body)}`);
    const repeat = await read(`cmd-344-${command}-2`, command);
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.replayed, true, `the identical keyless ${command} replays`);
  }
  assert.deepEqual(commands.map((row) => row.name), ['run.board.read', 'run.scratchpad.read'],
    'each read dispatched exactly once — the repeat replayed');
});

// ---------------------------------------------------------------------------
// The bound MCP surface: the server-minted key derives over every argument
// axis, so an identical retry replays and a changed axis mints fresh.
// ---------------------------------------------------------------------------

function boundServer(t, application) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-344-bound-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const NOW = Date.parse('2026-09-16T00:00:00.000Z');
  const mcp = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application, surface: 'application', bindApplicationContext: true,
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a',
      capabilities: ['control', 'observe', 'emergency_stop'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
  });
  return mcp;
}

const mcpRequest = (mcp, id, method, params) => mcp.handle({ jsonrpc: '2.0', id, method, params });

async function boundReady(mcp) {
  await mcpRequest(mcp, 'init', 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
}

test('344: bound keys derive over every argument axis', async (t) => {
  const effects = [];
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: webCardCommandNames() }),
    async authorizeReplay() { return true; },
    async command(name, args) { effects.push({ name, args }); return { schemaVersion: 1, command: name }; },
  };
  const mcp = boundServer(t, application);
  await boundReady(mcp);
  const stop = (id, reason) => mcpRequest(mcp, id, 'tools/call', {
    name: 'baton_run_stop', arguments: { runId: 'run:1', reason },
  });
  const first = await stop('b1', 'first');
  assert.equal(first.result.isError ?? false, false, `the keyed call admits: ${JSON.stringify(first.result)}`);
  // An identical request under a NEW transport id replays the admitted effect, not a second one.
  const replay = await stop('b2', 'first');
  assert.equal(replay.result.isError ?? false, false, `the identical retry admits: ${JSON.stringify(replay.result)}`);
  assert.equal(effects.length, 1, 'the identical request replays the admitted one — no second effect');
  assert.deepEqual(replay.result.structuredContent, first.result.structuredContent, 'the replay answers the admitted outcome');
  // A changed axis mints a fresh key: a new effect, never a conflict.
  const changed = await stop('b3', 'second');
  assert.equal(changed.result.isError ?? false, false, `the changed-axis call admits: ${JSON.stringify(changed.result)}`);
  assert.equal(effects.length, 2, 'a changed axis means a fresh key and a fresh effect');
});

// ---------------------------------------------------------------------------
// (1), the schema half: read-only tools never carry idempotencyKey.
// ---------------------------------------------------------------------------

test('344: read tools carry no idempotencyKey', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-344-schemas-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const NOW = Date.parse('2026-09-16T00:00:00.000Z');
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: webCardCommandNames() }),
    async authorizeReplay() { return true; },
    async command(name) { return { schemaVersion: 1, command: name }; },
  };
  const mcp = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
  });
  await boundReady(mcp);
  const listed = await mcpRequest(mcp, 'l1', 'tools/list', {});
  const byName = new Map(listed.result.tools.map((tool) => [tool.name, tool]));
  // Board reads ride the web resident and the swarm knowledge verbs (no baton_run_board_read
  // MCP tool exists); every MCP read tool below is on this surface.
  for (const name of [
    'baton_swarm_view',
    'baton_swarm_watch',
    'baton_evidence_search',
    'baton_run_scratchpad_read',
    'baton_run_message_receipt',
    'baton_run_attention_watch',
  ]) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} is advertised`);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'idempotencyKey'), false, `${name} carries no idempotencyKey`);
    assert.equal(tool.inputSchema.required.includes('idempotencyKey'), false, `${name} requires no idempotencyKey`);
  }
});
