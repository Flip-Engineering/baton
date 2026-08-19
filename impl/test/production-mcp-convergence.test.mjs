import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionConvergenceRuntime } from '../src/production-convergence.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';

function fakeServer() {
  return { calls: [], async handle(message) { this.calls.push(message); return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { ok: true } } }; } };
}
function eventTypes(runtime, command) { return runtime.journal.events().filter((event) => event.data?.command === command).map((event) => event.type); }

test('MCP convergence derives application effect ownership from the canonical registry', async () => {
  const raw = fakeServer(); const runtime = new ProductionConvergenceRuntime(); const server = wrapProductionMcpServer(raw, { runtime });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'baton_run_message_send', arguments: { repoId: 'repo', runId: 'run:a', kind: 'inform', body: 'hello' } } });
  assert.deepEqual(eventTypes(runtime, 'run.message.send'), ['command.admitted', 'effect.requested', 'effect.succeeded']);
});

test('MCP convergence preserves native fleet/kernel effects instead of narrowing to application tools', async () => {
  const raw = fakeServer(); const runtime = new ProductionConvergenceRuntime(); const server = wrapProductionMcpServer(raw, { runtime });
  await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_spawn', arguments: { repoId: 'repo', harness: 'x', brief: {} } } });
  assert.deepEqual(eventTypes(runtime, 'fleet_spawn'), ['command.admitted', 'effect.requested', 'effect.succeeded']);
});

test('MCP convergence also preserves MCP-only board/reflex mutation surfaces', async () => {
  const raw = fakeServer(); const runtime = new ProductionConvergenceRuntime(); const server = wrapProductionMcpServer(raw, { runtime });
  await server.handle({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'baton_board_post', arguments: { repoId: 'repo', runId: 'run:a', board: 'b', title: 'x' } } });
  assert.deepEqual(eventTypes(runtime, 'board.post'), ['command.admitted', 'effect.requested', 'effect.succeeded']);
});

test('MCP convergence leaves observation tools transparent and unledgered as effects', async () => {
  const raw = fakeServer(); const runtime = new ProductionConvergenceRuntime(); const server = wrapProductionMcpServer(raw, { runtime });
  await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_list', arguments: { repoId: 'repo' } } });
  assert.deepEqual(eventTypes(runtime, 'fleet_list'), []); assert.equal(raw.calls.length, 1);
});

test('documented MCP operator attention uses existing Run authorization then server-derived viewer authority', async () => {
  const seen = [];
  const application = {
    async authorizeReplay(command, args, principal, context) {
      seen.push({ stage: 'authorize', command, args, principal, context });
      assert.equal(principal.principalId, 'operator');
      assert.equal(args.runId, 'run:a');
    },
    async attentionWatch(args, principal) {
      seen.push({ stage: 'attention', args, principal });
      if (principal.principalId !== 'wave-owner') {
        return { schemaVersion: 1, runId: args.runId, afterCursor: 0, throughCursor: 0, reasons: [] };
      }
      return {
        schemaVersion: 1, runId: args.runId, afterCursor: args.cursor,
        throughCursor: 12, reasons: [{ kind: 'answer_decision', requiredAction: 'answer' }],
      };
    },
    async command(name, args, principal, context) {
      assert.equal(name, 'run.attention.watch');
      return this.attentionWatch(args, principal, context);
    },
  };
  const raw = {
    application,
    principal: {
      userId: 'operator', sessionId: 'session:operator',
      capabilities: ['control', 'observe'], repoIds: ['repo'],
    },
    async handle(message) {
      const args = message.params.arguments;
      const value = await this.application.command('run.attention.watch', args, {
        actor: 'mcp:operator:session:operator',
        principalId: 'operator',
        sessionId: 'session:operator',
      }, { transport: 'mcp', requestId: String(message.id), idempotencyKey: `mcp:${message.id}` });
      return { jsonrpc: '2.0', id: message.id, result: { structuredContent: value } };
    },
  };
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await server.handle({
    jsonrpc: '2.0', id: 30, method: 'tools/call',
    params: { name: 'baton_run_attention_watch', arguments: { repoId: 'repo', runId: 'run:a', cursor: 7 } },
  });
  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.throughCursor, 12);
  assert.deepEqual(response.result.structuredContent.reasons, [
    { kind: 'answer_decision', requiredAction: 'answer' },
  ]);
  assert.deepEqual(seen.map((entry) => entry.stage), ['authorize', 'attention']);
  assert.equal(seen[1].principal.principalId, 'wave-owner');
});

test('MCP attention watch refuses a silent cursor rewind instead of fabricating an empty page', async () => {
  const raw = { async handle(message) { return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { schemaVersion: 1, runId: 'run:a', afterCursor: 0, throughCursor: 0, reasons: [] } } }; } };
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const response = await server.handle({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'baton_run_attention_watch', arguments: { repoId: 'repo', runId: 'run:a', cursor: 7 } } });
  assert.equal(response.result.isError, true); assert.equal(response.result.structuredContent.error.code, 'attention_scope_forbidden');
  assert.deepEqual(response.result.structuredContent.error.detail, { requestedCursor: 7, throughCursor: 0 });
});

test('MCP REPL citation checks run authorization before resolving caller-supplied runId', async () => {
  let dispatched = false;
  const raw = {
    principal: { userId: 'worker:a', sessionId: 'session:a' },
    application: {
      async authorizeReplay(_command, args) {
        if (args.runId !== 'run:owned') throw Object.assign(new Error('application command forbidden'), { code: 'application_unauthorized' });
      },
    },
    async handle(message) { dispatched = true; return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { citation: 'x' } } }; },
  };
  const server = wrapProductionMcpServer(raw, { runtime: new ProductionConvergenceRuntime() });
  const refused = await server.handle({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'baton_repl_cite', arguments: { repoId: 'repo', runId: 'run:foreign', kernelId: 'k', cellId: 'c' } } });
  assert.equal(refused.result.isError, true); assert.equal(refused.result.structuredContent.error.code, 'application_unauthorized'); assert.equal(dispatched, false);
  const allowed = await server.handle({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'baton_repl_cite', arguments: { repoId: 'repo', runId: 'run:owned', kernelId: 'k', cellId: 'c' } } });
  assert.equal(allowed.result.isError, undefined); assert.equal(dispatched, true);
});

test('MCP convergence records structured tool-error outcomes as failed durable effects', async () => {
  const raw = { async handle(message) { return { jsonrpc: '2.0', id: message.id, result: { isError: true, structuredContent: { error: { code: 'refused', message: 'no' } } } }; } };
  const runtime = new ProductionConvergenceRuntime(); const server = wrapProductionMcpServer(raw, { runtime });
  await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fleet_kill', arguments: { repoId: 'repo', workerId: 'w' } } });
  assert.deepEqual(eventTypes(runtime, 'fleet_kill'), ['command.admitted', 'effect.requested', 'effect.failed']);
});
