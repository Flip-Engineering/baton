import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CoordinationStore, WebEdgePolicy, WebNorthbound, WebSessionStore,
  connectBatonWebApplication, createAuthenticatedWebServer, createBatonWebMcpServer,
  kimiBatonAcpMcpServer, kimiBatonMcpEntry,
} from '../src/index.mjs';

const NOW = Date.parse('2026-07-17T23:30:00.000Z');
const commands = [
  'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams',
  'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow',
  'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop',
  'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review',
  'run.integrate', 'run.export', 'application.shutdown',
];
const card = (registryDigest = 'a'.repeat(64)) => ({
  schemaVersion: 1, repoId: 'repo-kimi-orchestrator', commands,
  agentExperience: { registryDigest },
});
const connection = {
  baseUrl: 'https://baton.example', origin: 'https://operator.example',
  repoId: 'repo-kimi-orchestrator', token: 'private-web-token',
};
const remoteSession = Object.freeze({
  ok: true,
  identity: Object.freeze({
    userId: 'remote-kimi-user', sessionId: 'remote-kimi-session',
    capabilities: Object.freeze(['control', 'observe', 'emergency_stop']),
    repoIds: Object.freeze([connection.repoId]),
  }),
  expiresAt: '2026-07-18T01:30:00.000Z',
});
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  async json() { return structuredClone(body); },
});

function wire(overrides = {}) {
  const calls = [];
  let applicationCard = card();
  let session = structuredClone(overrides.session ?? remoteSession);
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/readyz')) return response({ ready: true });
    if (url.endsWith('/v1/application-card')) return response({ application: applicationCard });
    if (url.endsWith('/v1/session')) return response(session);
    if (url.endsWith('/v1/commands') && options.method === 'POST') {
      const envelope = JSON.parse(options.body);
      if (envelope.command === 'run_start') {
        return response({
          status: 'completed',
          result: {
            schemaVersion: 1, runId: overrides.startRunId ?? envelope.args.intent.runId,
            phase: 'awaiting_plan_approval', internalStartRecord: 'must-not-cross-mcp',
          },
        });
      }
      if (envelope.command === 'run_inspect') {
        return response({
          status: 'completed',
          result: overrides.outline ?? {
            schemaVersion: 1, runId: envelope.args.runId,
            depth: 'outline',
            outline: {
              phase: 'awaiting_plan_approval',
              actions: [{ kind: 'approve_plan', actionId: 'approve-plan-1' }],
            },
          },
        });
      }
      if (envelope.command === 'run_stop') {
        return response({
          status: 'completed',
          result: {
            schemaVersion: 1, runId: envelope.args.runId,
            phase: 'stopped', internalStopRecord: 'must-not-cross-mcp',
          },
        });
      }
      return response({
        status: 'completed',
        result: { schemaVersion: 1, runId: envelope.args.intent?.runId ?? envelope.args.runId, command: envelope.command },
      });
    }
    return response({ error: { code: 'not_found' } }, 404);
  };
  return {
    calls,
    fetchImpl,
    setCard(value) { applicationCard = value; },
    setSession(value) { session = structuredClone(value); },
  };
}

function exactRemotePrincipal(session = remoteSession) {
  return {
    actor: `mcp:${session.identity.userId}:${session.identity.sessionId}`,
    principalId: session.identity.userId,
    sessionId: session.identity.sessionId,
  };
}

async function initialize(server) {
  const initialized = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Kimi Code CLI', version: '0.27.0' } },
  });
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

function startToolCall(id, runId = 'run-remote-session') {
  return {
    jsonrpc: '2.0', id, method: 'tools/call', params: {
      name: 'baton_run_start',
      arguments: {
        intent: {
          runId, objective: 'Prove remote authenticated session binding',
          route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
        },
      },
    },
  };
}

test('KC6: Web MCP derives its exact principal and lifetime from the authenticated remote session', async () => {
  const remote = wire();
  const coordination = new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-remote-principal-')), 'coordination'));
  const server = await createBatonWebMcpServer({
    coordination, connection, fetchImpl: remote.fetchImpl, now: () => NOW, sleep: async () => {},
  });
  assert.deepEqual(server.principal, {
    userId: remoteSession.identity.userId,
    sessionId: remoteSession.identity.sessionId,
    capabilities: [...remoteSession.identity.capabilities],
    repoIds: [...remoteSession.identity.repoIds],
    expiresAt: remoteSession.expiresAt,
    revoked: false,
  });
  assert.equal(remote.calls.some(({ url }) => url.endsWith('/v1/session')), true);
  assert.equal(JSON.stringify(server).includes(connection.token), false);
});

test('KC6: Web MCP rejects every local identity and lifetime override', async () => {
  for (const override of [
    { principalId: 'local-principal' },
    { sessionId: 'local-session' },
    { sessionTtlMs: 60_000 },
  ]) {
    const remote = wire();
    const coordination = new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-override-')), 'coordination'));
    await assert.rejects(
      createBatonWebMcpServer({
        coordination, connection, fetchImpl: remote.fetchImpl, now: () => NOW,
        sleep: async () => {}, ...override,
      }),
      (error) => error instanceof TypeError && /remote-authenticated|override/u.test(error.message),
    );
    assert.equal(remote.calls.length, 0);
  }
});

test('KC6: an observe-only remote session refuses mutation locally before any Web command', async () => {
  const observeOnly = structuredClone(remoteSession);
  observeOnly.identity.capabilities = ['observe'];
  const remote = wire({ session: observeOnly });
  const coordination = new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-observe-only-')), 'coordination'));
  const server = await createBatonWebMcpServer({
    coordination, connection, fetchImpl: remote.fetchImpl, now: () => NOW, sleep: async () => {},
  });
  await initialize(server);
  const called = await server.handle(startToolCall(2, 'run-observe-only'));
  assert.equal(called.result.isError, true);
  assert.match(called.result.content[0].text, /forbidden/u);
  assert.equal(remote.calls.filter(({ url }) => url.endsWith('/v1/commands')).length, 0);
});

test('KC6/KC7: independent bridges sharing one remote session derive one stable mutation key', async () => {
  const remote = wire();
  const first = await createBatonWebMcpServer({
    coordination: new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-stable-a-')), 'coordination')),
    connection, fetchImpl: remote.fetchImpl, now: () => NOW, sleep: async () => {},
  });
  const second = await createBatonWebMcpServer({
    coordination: new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-stable-b-')), 'coordination')),
    connection, fetchImpl: remote.fetchImpl, now: () => NOW, sleep: async () => {},
  });
  await initialize(first);
  await initialize(second);
  assert.equal((await first.handle(startToolCall(11, 'run-stable-session'))).result.isError, false);
  assert.equal((await second.handle(startToolCall(99, 'run-stable-session'))).result.isError, false);
  const starts = remote.calls
    .filter(({ url }) => url.endsWith('/v1/commands'))
    .map(({ options }) => JSON.parse(options.body))
    .filter(({ command }) => command === 'run_start');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].idempotencyKey, starts[1].idempotencyKey);
  assert.match(starts[0].idempotencyKey, /^mcp-web-[a-f0-9]{64}$/u);
});

test('KC6/KC7: session identity, capability, repository, and expiry drift fail replay and commands closed', async (t) => {
  const cases = [
    ['identity', (session) => { session.identity.sessionId = 'rotated-remote-session'; }],
    ['capability', (session) => { session.identity.capabilities = ['observe', 'emergency_stop']; }],
    ['repository', (session) => { session.identity.repoIds = ['repo-other']; }],
    ['expiry', (session) => { session.expiresAt = new Date(NOW).toISOString(); }],
  ];
  const args = {
    intent: {
      runId: 'run-session-drift', objective: 'Refuse stale remote authority',
      route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
    },
  };
  const context = { transport: 'mcp', callId: 'drift-call', idempotencyKey: 'mcp.call:drift-call' };
  for (const [kind, mutate] of cases) {
    await t.test(`${kind} drift`, async () => {
      for (const operation of ['authorizeReplay', 'command']) {
        const remote = wire();
        const facade = await connectBatonWebApplication({
          connection, fetchImpl: remote.fetchImpl, clock: () => NOW, sleep: async () => {},
        });
        const changed = structuredClone(remoteSession);
        mutate(changed);
        remote.setSession(changed);
        await assert.rejects(
          operation === 'authorizeReplay'
            ? facade.authorizeReplay('run.start', args, exactRemotePrincipal(), context)
            : facade.command('run.start', args, exactRemotePrincipal(), context),
          (error) => ['application_unauthorized', 'cli_protocol_failed'].includes(error.code),
        );
        assert.equal(remote.calls.filter(({ url }) => url.endsWith('/v1/commands')).length, 0);
      }
    });
  }
});

test('KC6: malformed and expired authenticated session documents are refused without credential disclosure', async (t) => {
  const cases = [
    ['missing sessionId', (session) => { delete session.identity.sessionId; }],
    ['malformed capabilities', (session) => { session.identity.capabilities = 'control'; }],
    ['wrong repository', (session) => { session.identity.repoIds = ['repo-other']; }],
    ['expired', (session) => { session.expiresAt = new Date(NOW - 1).toISOString(); }],
  ];
  for (const [kind, mutate] of cases) {
    await t.test(kind, async () => {
      const session = structuredClone(remoteSession);
      mutate(session);
      const remote = wire({ session });
      let rejected;
      try {
        await connectBatonWebApplication({
          connection, fetchImpl: remote.fetchImpl, clock: () => NOW, sleep: async () => {},
        });
      } catch (error) { rejected = error; }
      assert.ok(rejected);
      assert.equal(rejected.code, 'cli_protocol_failed');
      assert.equal(JSON.stringify(rejected).includes(connection.token), false);
      assert.equal(remote.calls.filter(({ url }) => url.endsWith('/v1/commands')).length, 0);
    });
  }
});

test('KC8: remote Web credentials are not serialized through facade or MCP state', async () => {
  const remote = wire();
  const facade = await connectBatonWebApplication({
    connection, fetchImpl: remote.fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  const server = await createBatonWebMcpServer({
    coordination: new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-token-state-')), 'coordination')),
    connection, fetchImpl: remote.fetchImpl, now: () => NOW, sleep: async () => {},
  });
  assert.equal(JSON.stringify(facade).includes(connection.token), false);
  assert.equal(JSON.stringify(server).includes(connection.token), false);
  assert.equal(JSON.stringify(facade.card()).includes(connection.token), false);
  assert.equal(JSON.stringify(facade.principal()).includes(connection.token), false);
});

test('KC6/KC7/KC8: Kimi MCP bridges only the compact application surface over authenticated Web', async () => {
  const remote = wire();
  const coordination = new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-kimi-orchestrator-')), 'coordination'));
  const server = await createBatonWebMcpServer({
    coordination, connection, fetchImpl: remote.fetchImpl, now: () => NOW,
    sleep: async () => {},
  });
  await initialize(server);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
    'baton_help', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
    'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
    'baton_run_act', 'baton_run_stop',
  ]);
  for (const tool of listed.result.tools) {
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'repoId'), false);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'idempotencyKey'), false);
  }
  const inspectTool = listed.result.tools.find((tool) => tool.name === 'baton_run_inspect');
  assert.deepEqual(inspectTool.inputSchema.properties.cursor, { type: 'integer', minimum: 0 });
  const startTool = listed.result.tools.find((tool) => tool.name === 'baton_run_start');
  assert.deepEqual(startTool.inputSchema.properties.intent.required, ['objective']);
  assert.equal(JSON.stringify(listed).includes(connection.token), false);
  assert.equal(listed.result.tools.some((tool) => /shutdown|fleet_|worker|budget|worktree/u.test(tool.name)), false);

  const call = {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'baton_run_start',
      arguments: {
        intent: {
          runId: 'run-kimi-orchestrator', objective: 'Start a bounded Baton Run',
          route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
        },
      },
    },
  };
  const called = await server.handle(call);
  assert.equal(called.result.isError, false);
  const commandCalls = remote.calls.filter((entry) => entry.url.endsWith('/v1/commands'));
  assert.equal(commandCalls.length, 2);
  const envelopes = commandCalls.map((entry) => JSON.parse(entry.options.body));
  assert.deepEqual(envelopes.map(({ command }) => command), ['run_start', 'run_inspect']);
  assert.deepEqual(envelopes[1].args, { runId: 'run-kimi-orchestrator', depth: 'outline' });
  assert.match(envelopes[0].idempotencyKey, /^mcp-web-[a-f0-9]{64}$/u);
  assert.match(envelopes[1].idempotencyKey, /^mcp-web-[a-f0-9]{64}$/u);
  assert.notEqual(envelopes[0].idempotencyKey, envelopes[1].idempotencyKey);
  for (const command of commandCalls) {
    assert.equal(command.options.headers.authorization, `Bearer ${connection.token}`);
    assert.equal(command.options.headers.origin, connection.origin);
  }
  assert.equal(JSON.stringify(envelopes).includes(connection.token), false);
  assert.deepEqual(called.result.structuredContent, {
    schemaVersion: 1, runId: 'run-kimi-orchestrator', depth: 'outline',
    outline: {
      phase: 'awaiting_plan_approval',
      actions: [{ kind: 'approve_plan', actionId: 'approve-plan-1' }],
    },
  });
  assert.equal(JSON.stringify(called).includes('internalStartRecord'), false);
  assert.equal((await server.handle(call)).result.isError, false);
  const inspected = await server.handle({
    jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
      name: 'baton_run_inspect', arguments: { runId: 'run-kimi-orchestrator', depth: 'outline' },
    },
  });
  assert.equal(inspected.result.isError, false);
  const helped = await server.handle({
    jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
      name: 'baton_help', arguments: { topic: 'run.act.approve_plan', depth: 'outline' },
    },
  });
  assert.equal(helped.result.isError, false);
  const stopped = await server.handle({
    jsonrpc: '2.0', id: 7, method: 'tools/call', params: {
      name: 'baton_run_stop', arguments: {
        runId: 'run-kimi-orchestrator', reason: 'Prove the compact stop cascade',
      },
    },
  });
  assert.equal(stopped.result.isError, false);
  assert.equal(JSON.stringify(stopped).includes('internalStopRecord'), false);
  const forged = await server.handle({
    ...call, id: 4, params: {
      ...call.params,
      arguments: { ...call.params.arguments, repoId: connection.repoId },
    },
  });
  assert.equal(forged.result.isError, true);
  assert.match(forged.result.content[0].text, /invalid_arguments/u);
  assert.deepEqual(await server.close(), {
    schemaVersion: 1, state: 'transport_closed', applicationOwned: false,
  });
  const finalCommands = remote.calls
    .filter((entry) => entry.url.endsWith('/v1/commands'))
    .map((entry) => JSON.parse(entry.options.body).command);
  assert.deepEqual(finalCommands, [
    'run_start', 'run_inspect', 'run_inspect', 'application_help', 'run_stop', 'run_inspect',
  ]);
});

test('KC6/KC7: semantic mutation replay is stable while mismatched identity and malformed outlines fail closed', async () => {
  const principal = exactRemotePrincipal();
  const args = {
    intent: {
      runId: 'run-semantic-replay', objective: 'Prove semantic Web replay', profile: 'standard',
      route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
    },
  };
  const replayRemote = wire();
  const facade = await connectBatonWebApplication({
    connection, fetchImpl: replayRemote.fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  await facade.command('run.start', args, principal, {
    transport: 'mcp', callId: 'first-call', idempotencyKey: 'mcp.call:first-call',
  });
  await facade.command('run.start', args, principal, {
    transport: 'mcp', callId: 'recovery-call', idempotencyKey: 'mcp.call:recovery-call',
  });
  const replayEnvelopes = replayRemote.calls
    .filter((entry) => entry.url.endsWith('/v1/commands'))
    .map((entry) => JSON.parse(entry.options.body));
  const starts = replayEnvelopes.filter(({ command }) => command === 'run_start');
  const inspections = replayEnvelopes.filter(({ command }) => command === 'run_inspect');
  assert.equal(starts.length, 2);
  assert.equal(starts[0].idempotencyKey, starts[1].idempotencyKey);
  assert.notEqual(inspections[0].idempotencyKey, inspections[1].idempotencyKey);

  const mismatched = wire({ startRunId: 'wrong-run' });
  const mismatchedFacade = await connectBatonWebApplication({
    connection, fetchImpl: mismatched.fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  await assert.rejects(
    mismatchedFacade.command('run.start', args, principal, {
      transport: 'mcp', callId: 'mismatch', idempotencyKey: 'mcp.call:mismatch',
    }),
    (error) => error.code === 'application_unavailable' && /mismatched Run identity/u.test(error.message),
  );

  const malformed = wire({
    outline: { schemaVersion: 1, runId: 'run-semantic-replay', depth: 'outline', outline: {} },
  });
  const malformedFacade = await connectBatonWebApplication({
    connection, fetchImpl: malformed.fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  await assert.rejects(
    malformedFacade.command('run.start', args, principal, {
      transport: 'mcp', callId: 'malformed', idempotencyKey: 'mcp.call:malformed',
    }),
    (error) => error.code === 'application_unavailable' && /invalid Run outline/u.test(error.message),
  );
  assert.equal(
    malformed.calls.filter((entry) => entry.url.endsWith('/v1/commands')
      && JSON.parse(entry.options.body).command === 'run_inspect').length,
    3,
  );
});

test('KC6/KC7: replay rechecks Web auth/card truth and refuses registry drift', async () => {
  const remote = wire();
  const facade = await connectBatonWebApplication({
    connection, fetchImpl: remote.fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  const context = { transport: 'mcp', callId: 'call-one', idempotencyKey: 'mcp.call:call-one' };
  assert.equal(await facade.authorizeReplay('run.inspect', {}, exactRemotePrincipal(), context), true);
  remote.setCard(card('b'.repeat(64)));
  await assert.rejects(
    facade.authorizeReplay('run.inspect', {}, exactRemotePrincipal(), context),
    (error) => error.code === 'application_unavailable',
  );
  await assert.rejects(
    facade.command('application.shutdown', {}, exactRemotePrincipal(), context),
    (error) => error.code === 'application_unauthorized',
  );
});

test('KC8: project Kimi MCP entry contains no credential and allowlists only semantic Run tools', () => {
  const entry = kimiBatonMcpEntry({
    projectRoot: '/repo', nodePath: '/node', bridgePath: '/repo/impl/scripts/mcp-web.mjs',
  });
  assert.deepEqual(entry, {
    command: '/node', args: ['/repo/impl/scripts/mcp-web.mjs'], cwd: '/repo', enabled: true,
    startupTimeoutMs: 30_000, toolTimeoutMs: 180_000,
    enabledTools: ['baton_help', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
      'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
      'baton_run_act', 'baton_run_stop'],
  });
  assert.equal(Object.hasOwn(entry, 'env'), false);
  assert.equal(JSON.stringify(entry).includes('token'), false);

  const acp = kimiBatonAcpMcpServer({
    projectRoot: '/repo', nodePath: '/node', bridgePath: '/repo/impl/scripts/mcp-web.mjs',
  });
  assert.deepEqual(acp, {
    name: 'baton', command: '/node', args: ['/repo/impl/scripts/mcp-web.mjs'], env: [],
  });
  assert.equal(Object.isFrozen(acp), true);
  assert.equal(Object.isFrozen(acp.args), true);
  assert.equal(Object.isFrozen(acp.env), true);
  assert.equal(JSON.stringify(acp).includes('token'), false);
});

test('KC6/KC7/KC8: packaged Kimi MCP entry crosses a real authenticated Web listener with pure stdio', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-kimi-orchestrator-packaged-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordination = new CoordinationStore(join(directory, 'web-coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const credential = sessions.issue({
    userId: 'kimi-orchestrator', authMethod: 'bearer',
    capabilities: ['control', 'observe', 'emergency_stop'],
    repoIds: [connection.repoId], ttlMs: 60_000,
  }, { actor: 'test-bootstrap' });
  const applicationCalls = [];
  const application = {
    repoId: connection.repoId,
    card,
    async authorizeReplay() { return true; },
    async command(name, args, principal) {
      applicationCalls.push({ name, args, principal });
      if (name === 'run.start') {
        return {
          schemaVersion: 1, runId: args.intent.runId,
          phase: 'awaiting_plan_approval', internalStartRecord: 'must-not-cross-mcp',
        };
      }
      if (name === 'run.inspect') {
        return {
          schemaVersion: 1, runId: args.runId, depth: 'outline',
          outline: {
            phase: 'awaiting_plan_approval',
            actions: [{ kind: 'approve_plan', actionId: 'approve-plan-1' }],
          },
        };
      }
      return {
        schemaVersion: 1, runId: args.intent?.runId ?? args.runId,
        phase: 'planning', command: name,
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: { list() { return []; } }, coordination, sessions, application,
    edge: new WebEdgePolicy({
      addressKey: 'packaged-kimi-test-address-key', proxyMode: true,
      trustedProxies: ['127.0.0.1'],
    }),
    allowedOrigins: [connection.origin], repoIds: [connection.repoId],
  });
  const listener = createAuthenticatedWebServer(web, { proxy: { cleartextBackend: true } });
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });

  const preloadPath = join(directory, 'trusted-proxy-fetch.mjs');
  writeFileSync(preloadPath, `
    const fetchImpl = globalThis.fetch;
    const port = ${JSON.stringify(listener.address().port)};
    globalThis.fetch = (input, options = {}) => {
      const source = new URL(typeof input === 'string' ? input : input.url);
      if (source.origin !== 'https://baton.example') throw new Error('unexpected Web authority');
      source.protocol = 'http:';
      source.hostname = '127.0.0.1';
      source.port = String(port);
      const headers = new Headers(options.headers ?? {});
      headers.set('forwarded', 'for=198.51.100.23;proto=https');
      return fetchImpl(source, { ...options, headers });
    };
  `);
  const projectRoot = join(directory, 'project');
  const configRoot = join(directory, 'config');
  const connectionRoot = join(configRoot, 'baton', 'connections');
  mkdirSync(join(projectRoot, '.git', 'baton'), { recursive: true });
  mkdirSync(connectionRoot, { recursive: true });
  writeFileSync(join(projectRoot, '.git', 'baton', 'connection.json'), JSON.stringify({
    schemaVersion: 1, profile: 'packaged-kimi', repoId: connection.repoId,
  }));
  const tokenPath = join(connectionRoot, 'packaged-kimi.token');
  writeFileSync(tokenPath, `${credential.token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  const profilePath = join(connectionRoot, 'packaged-kimi.json');
  writeFileSync(profilePath, JSON.stringify({
    schemaVersion: 1, url: connection.baseUrl, origin: connection.origin,
    tokenFile: 'packaged-kimi.token',
  }), { mode: 0o600 });
  chmodSync(profilePath, 0o600);
  const frames = [
    {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'Kimi Code CLI', version: '0.27.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'baton_run_start',
        arguments: {
          intent: {
            runId: 'run-packaged-kimi', objective: 'Prove the packaged Kimi orchestrator bridge',
            profile: 'standard',
            route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
          },
        },
      },
    },
  ];
  let stdout = '';
  let stderr = '';
  try {
    const bridgePath = fileURLToPath(new URL('../scripts/mcp-web.mjs', import.meta.url));
    const child = spawn(process.execPath, ['--import', preloadPath, bridgePath], {
      cwd: projectRoot,
      env: { XDG_CONFIG_HOME: configRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.stdin.end(`${frames.map(JSON.stringify).join('\n')}\n`);
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }

  const responses = stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(responses.map((entry) => entry.id), [1, 2, 3]);
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name), [
    'baton_help', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
    'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
    'baton_run_act', 'baton_run_stop',
  ]);
  assert.equal(responses[2].result.isError, false);
  assert.match(responses[2].result.content[0].text, /run-packaged-kimi/u);
  assert.equal(responses[2].result.content[0].text.includes('internalStartRecord'), false);
  assert.match(responses[2].result.content[0].text, /approve-plan-1/u);
  assert.deepEqual(applicationCalls.map(({ name }) => name), ['run.start', 'run.inspect']);
  assert.deepEqual(applicationCalls[1].args, { runId: 'run-packaged-kimi', depth: 'outline' });
  assert.equal(JSON.stringify(applicationCalls).includes(credential.token), false);
  assert.equal(stdout.includes(credential.token), false);
  assert.equal(stderr.includes(credential.token), false);
  assert.equal(stderr, '');
});
