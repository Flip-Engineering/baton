import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProductionConvergenceRuntime } from '../src/production-convergence.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-convergence.mjs';

function baseServer(overrides = {}) {
  const applicationCalls = [];
  const audits = [];
  const quotaCalls = [];
  return {
    surface: 'combined',
    lifecycle: 'ready',
    maxWaitMs: 25_000,
    toolNames: new Set(['fleet_spawn']),
    toolDefinitions: [{
      name: 'fleet_spawn',
      description: 'Existing provider worker allocation tool',
      inputSchema: {
        type: 'object',
        properties: { repoId: {}, idempotencyKey: {}, harness: {}, brief: {} },
        required: ['repoId', 'harness', 'brief'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    }],
    repoIds: new Set(['repo']),
    principal: {
      userId: 'operator', sessionId: 'session:1', expiresAt: '2099-01-01T00:00:00.000Z',
      capabilities: ['control', 'observe', 'approve', 'emergency_stop'], repoIds: ['repo'],
    },
    coordinator: {
      list: () => [{ workerId: 'worker:1' }],
      capabilityCards: () => [{ harness: 'fake', concurrencyCeiling: 2 }],
      readProviderStatus: () => ({ providers: [] }),
    },
    coordination: {},
    applicationCalls,
    audits,
    quotaCalls,
    _authority(name, args) {
      if (name !== 'fleet_list' || args.repoId !== 'repo') return 'forbidden';
      if (!this.principal.capabilities.includes('observe')) return 'forbidden';
      return null;
    },
    _audit(kind, tool, args, detail = null) {
      audits.push({ kind, tool, args, detail });
      return { ok: true };
    },
    async takeToolQuota(input) {
      quotaCalls.push(input);
      return { ok: true };
    },
    application: {
      card: () => ({ repoId: 'repo', commands: [] }),
      authorizeReplay: async () => true,
      async decisionList({ runId }) {
        applicationCalls.push({ name: 'decision.list', args: { runId } });
        return { runId, decisions: [{ requestId: 'request:1', state: 'pending' }] };
      },
      async command(name, args) {
        applicationCalls.push({ name, args });
        if (name === 'run.follow') return {
          runId: args.runId, cursor: args.afterCursor + 1, events: [],
        };
        if (name === 'run.attention.watch') return {
          runId: args.runId, afterCursor: args.cursor,
          throughCursor: args.cursor + 2,
          reasons: [{ kind: 'answer_decision', requiredAction: 'answer' }],
        };
        if (name === 'run.inspect') return { runId: args.runId, phase: 'working' };
        if (name === 'waves.progress') return { waveId: args.waveId, phase: 'working' };
        return { name, args };
      },
    },
    async handle(message) {
      if (message.method === 'initialize') {
        return { jsonrpc: '2.0', id: message.id, result: { instructions: 'baton', capabilities: {}, serverInfo: {} } };
      }
      if (message.method === 'tools/list') {
        return { jsonrpc: '2.0', id: message.id, result: { tools: this.toolDefinitions } };
      }
      if (message.method === 'tools/call' && message.params.name === 'fleet_spawn') {
        return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { spawned: true, args: message.params.arguments } } };
      }
      return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { ok: true } } };
    },
    ...overrides,
  };
}

function call(server, name, args = {}, id = 1) {
  return server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

test('tools/list and initialize disclose the additive unified surface without replacing direct tools', async () => {
  const server = wrapProductionMcpServer(baseServer(), { runtime: new ProductionConvergenceRuntime() });
  const initialized = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  });
  assert.match(initialized.result.instructions, /existing control, observation, telemetry, communication/);
  assert.match(initialized.result.instructions, /baton_surface_watch/);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = new Set(listed.result.tools.map((tool) => tool.name));
  assert.ok(names.has('fleet_spawn'));
  for (const name of [
    'baton_surface_catalog', 'baton_surface_describe', 'baton_surface_invoke',
    'baton_surface_snapshot', 'baton_surface_watch',
  ]) assert.ok(names.has(name), `${name} missing`);
});

test('configured MCP catalog spans every requested system category and projects live tool schemas', async () => {
  const raw = baseServer();
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await call(server, 'baton_surface_catalog', { surface: 'mcp' });
  const body = response.result.structuredContent;
  assert.equal(body.schemaVersion, 3);
  assert.equal(body.source, 'configured_existing_mcp_authority');
  assert.deepEqual(body.nameClosure.unresolved, []);
  const categories = new Set(body.capabilities.flatMap((row) => row.categories));
  for (const category of [
    'control', 'observation', 'telemetry', 'communication', 'task_management',
    'knowledge', 'diagnostics', 'notifications',
  ]) assert.ok(categories.has(category), `${category} missing`);

  const fleetSpawn = body.capabilities.find((row) => row.id === 'fleet_spawn');
  assert.equal(fleetSpawn.liveMcp.source, 'existing_mcp_tool_definition');
  assert.equal(fleetSpawn.liveMcp.toolName, 'fleet_spawn');
  assert.equal(fleetSpawn.liveMcp.description, 'Existing provider worker allocation tool');
  assert.deepEqual(fleetSpawn.liveMcp.inputSchema.required, ['repoId', 'harness', 'brief']);

  const debug = body.capabilities.find((row) => row.id === 'run.debug');
  assert.equal(debug.liveMcp.available, true);
  assert.equal(debug.liveMcp.direct, false);
  assert.equal(debug.liveMcp.source, 'existing_application_command');
  const watch = body.capabilities.find((row) => row.id === 'surface.watch');
  assert.equal(watch.liveMcp.available, true);
  assert.equal(watch.liveMcp.source, 'unified_meta_adapter');
  assert.equal(raw.quotaCalls.length, 1);
  assert.ok(raw.audits.some((entry) => entry.kind === 'tool_completed'
    && entry.tool === 'baton_surface_catalog'));
});

test('configured describe resolves canonical names and corrected live aliases deterministically', async () => {
  const raw = baseServer();
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const exact = await call(server, 'baton_surface_describe', { name: 'run.status' }, 20);
  assert.equal(exact.result.structuredContent.capability.id, 'run.status');
  const corrected = await call(server, 'baton_surface_describe', { name: 'baton_decision_list' }, 21);
  assert.equal(corrected.result.structuredContent.capability.id, 'decision.list');
});

test('configured describe reports embedded-only capability without promoting it', async () => {
  const raw = baseServer();
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await call(server, 'baton_surface_describe', { name: 'board.claim' }, 22);
  const capability = response.result.structuredContent.capability;
  assert.equal(capability.remotePosture, 'worker_internal');
  assert.equal(capability.operatorFacing, false);
  assert.equal(capability.liveMcp.available, false);
  assert.equal(capability.liveMcp.source, 'not_available_in_profile');
});

test('generic MCP invoke dispatches native and operator application capabilities through existing authority', async () => {
  const raw = baseServer();
  const runtime = new ProductionConvergenceRuntime();
  const server = wrapProductionMcpServer(raw, { runtime });
  const native = await call(server, 'baton_surface_invoke', {
    name: 'fleet_spawn', args: { harness: 'fake', brief: {} }, idempotencyKey: 'native:1',
  }, 3);
  assert.equal(native.result.structuredContent.spawned, true);
  assert.equal(native.result.structuredContent.args.repoId, 'repo');

  const application = await call(server, 'baton_surface_invoke', {
    name: 'run.debug', args: { runId: 'run:a' }, idempotencyKey: 'app:1',
  }, 4);
  assert.equal(application.result.structuredContent.capability, 'run.debug');
  assert.equal(application.result.structuredContent.result.name, 'run.debug');
  assert.deepEqual(raw.applicationCalls.at(-1), { name: 'run.debug', args: { runId: 'run:a' } });
  assert.equal(raw.quotaCalls.filter((row) => row.tool === 'baton_surface_invoke').length, 1);
});

test('generic MCP invoke refuses embedded worker authority and requires action coordinates', async () => {
  const raw = baseServer();
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const embedded = await call(server, 'baton_surface_invoke', {
    name: 'board.claim', args: { grantId: 'grant:a' }, idempotencyKey: 'embedded:1',
  }, 31);
  assert.equal(embedded.result.isError, true);
  assert.equal(embedded.result.structuredContent.error.code, 'surface_embedded_only');

  const missingAction = await call(server, 'baton_surface_invoke', {
    name: 'context.map', args: { runId: 'run:a', branch: 'source' }, idempotencyKey: 'action:1',
  }, 32);
  assert.equal(missingAction.result.isError, true);
  assert.equal(missingAction.result.structuredContent.error.code, 'surface_action_id_required');

  const action = await call(server, 'baton_surface_invoke', {
    name: 'context.map',
    args: { runId: 'run:a', actionId: 'action:map', branch: 'source' },
    idempotencyKey: 'action:2',
  }, 33);
  assert.equal(action.result.structuredContent.result.name, 'run.act');
  assert.deepEqual(action.result.structuredContent.result.args, {
    runId: 'run:a', actionId: 'action:map', inputs: { branch: 'source' },
  });
});

test('meta tools fail closed through existing MCP principal authority', async () => {
  const raw = baseServer();
  raw.principal.capabilities = ['control'];
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await call(server, 'baton_surface_catalog', {}, 41);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'forbidden');
  assert.equal(raw.quotaCalls.length, 0);
  assert.ok(raw.audits.some((entry) => entry.kind === 'tool_refused'));
});

test('surface snapshot combines existing readiness, workers, routes, telemetry and convergence state', async () => {
  const raw = baseServer();
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await call(server, 'baton_surface_snapshot', { runId: 'run:a' }, 5);
  const snapshot = response.result.structuredContent;
  assert.equal(snapshot.schemaVersion, 2);
  assert.deepEqual(snapshot.nameClosure.unresolved, []);
  assert.equal(snapshot.workers.ok, true);
  assert.equal(snapshot.routeCapabilities.ok, true);
  assert.equal(snapshot.providerTelemetry.ok, true);
  assert.equal(snapshot.run.ok, true);
  assert.ok(snapshot.coverage.categories.notifications.mcp > 0);
});

test('surface watch composes existing follow, attention, decisions and Wave progress with monotonic cursors', async () => {
  const raw = baseServer();
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await call(server, 'baton_surface_watch', {
    runId: 'run:a', waveId: 'wave:a', afterCursor: 4, attentionCursor: 7,
    kind: 'answer_decision', timeoutMs: 1000,
  }, 51);
  const page = response.result.structuredContent;
  assert.equal(page.kind, 'baton.surface_watch');
  assert.equal(page.nextAfterCursor, 5);
  assert.equal(page.nextAttentionCursor, 9);
  assert.equal(page.decisions.decisions[0].state, 'pending');
  assert.equal(page.wave.waveId, 'wave:a');
  assert.deepEqual(raw.applicationCalls.map((entry) => entry.name), [
    'run.follow', 'run.attention.watch', 'decision.list', 'waves.progress',
  ]);
});

test('surface watch refuses cursor rewind instead of returning an empty success page', async () => {
  const raw = baseServer();
  const original = raw.application.command;
  raw.application.command = async function command(name, args) {
    if (name === 'run.attention.watch') return {
      runId: args.runId, afterCursor: 0, throughCursor: 0, reasons: [],
    };
    return original.call(this, name, args);
  };
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await call(server, 'baton_surface_watch', {
    runId: 'run:a', attentionCursor: 8, timeoutMs: 1000,
  }, 52);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'attention_scope_forbidden');
  assert.deepEqual(response.result.structuredContent.error.detail, {
    requestedCursor: 8, throughCursor: 0,
  });
});
