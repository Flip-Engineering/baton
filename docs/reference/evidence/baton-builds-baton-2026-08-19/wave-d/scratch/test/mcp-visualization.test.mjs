import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProductionConvergenceRuntime } from '../src/production-convergence.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';

function rawServer() {
  const story = {
    narrative: () => 'The existing story compiler sees one worker making steady progress.',
    signals: () => [],
    memberStates: () => [{ workerId: 'worker:a', taskId: 'task:a', state: 'working' }],
  };
  return {
    lifecycle: 'ready',
    repoIds: new Set(['repo']),
    principal: { userId: 'operator', sessionId: 'session:operator', capabilities: ['observe'], repoIds: ['repo'] },
    maxWaitMs: 30_000,
    toolDefinitions: [],
    toolNames: new Set(),
    _authority() { return null; },
    _audit() {},
    async takeToolQuota() { return { ok: true }; },
    application: {
      card() { return { schemaVersion: 1, repoId: 'repo', resident: { state: 'ready' } }; },
      async command(name, args) {
        if (name === 'deployment.doctor') return { ready: true, routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high', state: 'ready' }] };
        if (name === 'run.inspect') return {
          runId: args.runId, phase: 'working', objective: 'Visualize the fleet',
          narrative: 'One worker is implementing the visual surface.',
          workstreams: [{ workerId: 'worker:a', role: 'implementer', state: 'working', route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' } }],
        };
        if (name === 'run.follow') return { runId: args.runId, cursor: 4, events: [{ seq: 4, kind: 'verify.reverified', actor: 'baton', summary: 'Tests passed.' }] };
        if (name === 'run.attention.watch') return { runId: args.runId, throughCursor: args.cursor, reasons: [] };
        if (name === 'waves.progress') return { waveId: args.waveId, state: 'working' };
        throw new Error(`unexpected command ${name}`);
      },
      async decisionList() { return { items: [] }; },
    },
    coordinator: {
      _story: story,
      list() { return [{ workerId: 'worker:a', state: 'working' }]; },
      capabilityCards() { return []; },
      readProviderStatus() { return { providers: [] }; },
    },
    async handle(message) {
      if (message.method === 'initialize') return { jsonrpc: '2.0', id: message.id, result: { instructions: 'baton', capabilities: { tools: {} }, serverInfo: { name: 'baton', version: '0.1.0' } } };
      if (message.method === 'tools/list') return { jsonrpc: '2.0', id: message.id, result: { tools: [] } };
      return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { ok: true } } };
    },
  };
}

test('MCP visualization is advertised and composes the existing snapshot/watch meta authorities', async () => {
  const server = wrapProductionMcpServer(rawServer(), { runtime: new ProductionConvergenceRuntime() });
  const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(listed.result.tools.some((tool) => tool.name === 'baton_surface_visualize'));
  const response = await server.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'baton_surface_visualize', arguments: {
      view: 'overview', runId: 'run:a', follow: true, width: 88,
      afterCursor: 0, attentionCursor: 0, timeoutMs: 5,
    } },
  });
  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.kind, 'baton.surface_visualization');
  assert.equal(response.result.structuredContent.model.run.runId, 'run:a');
  assert.equal(response.result.structuredContent.presentation.refresh.tool, 'baton_surface_visualize');
  assert.match(response.result.content[0].text, /baton top/u);
  assert.equal(response.result.content[0].text.includes('\u001b'), false);
});

test('MCP visualization rejects follow without a Run instead of inventing global watch authority', async () => {
  const server = wrapProductionMcpServer(rawServer(), { runtime: new ProductionConvergenceRuntime() });
  const response = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'baton_surface_visualize', arguments: { follow: true } },
  });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, 'surface_visualization_invalid');
});
