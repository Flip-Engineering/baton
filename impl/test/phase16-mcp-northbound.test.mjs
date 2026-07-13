import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { CoordinationStore, McpFleetServer, serveMcpStdio } from '../src/index.mjs';

const NOW = Date.parse('2026-07-11T21:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-mcp-'));
const principal = (overrides = {}) => ({
  userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
  repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
});
function setup(overrides = {}) {
  const calls = [];
  const coordinator = {
    async spawn(harness, brief, opts) { calls.push(['spawn', harness, brief, opts]); return { id: 'worker-1', fence: 1 }; },
    async send(workerId, message, mode, opts) { calls.push(['send', workerId, message, mode, opts]); return { result: 'sent' }; },
    async wait(timeoutMs) { calls.push(['wait', timeoutMs]); return { events: [], cursor: 4, more: false }; },
    async respond(requestId, answer, actor) { calls.push(['respond', requestId, answer, actor]); return { result: 'responded' }; },
    async interrupt(workerId, then, actor, opts) { calls.push(['interrupt', workerId, then, actor, opts]); return { result: 'interrupted' }; },
    async result(workerId) { calls.push(['result', workerId]); return { id: workerId, state: 'working' }; },
    list() { calls.push(['list']); return [{ id: 'worker-1' }]; },
    capabilityCards() { calls.push(['capabilityCards']); return [{ name: 'atlas', ops: { 'atlas.inspect': {} } }]; },
    async invokeCapability(name, op, args, ctx) { calls.push(['invokeCapability', name, op, args, ctx]); return { op, status: 'ok', summary: 'invoked' }; },
    async resumeCapability(name, op, ref, cursor, ctx) { calls.push(['resumeCapability', name, op, ref, cursor, ctx]); return { op, status: 'ok', summary: 'resumed' }; },
    async reverifyCapability(name, op, claim, args, ctx) { calls.push(['reverifyCapability', name, op, claim, args, ctx]); return { op, status: 'ok', summary: 'reverified' }; },
    async orientWorker(workerId, args, note, ctx) { calls.push(['orientWorker', workerId, args, note, ctx]); return { ok: true, result: 'ok', sliceDigest: 'a'.repeat(64) }; },
    async decideReuse(decision, ctx) { calls.push(['decideReuse', decision, ctx]); return { ok: true, result: 'recorded', decision: { id: 'reuse-decision:test' } }; },
    async recheckReuseDecision(recheck, ctx) { calls.push(['recheckReuseDecision', recheck, ctx]); return { ok: true, result: 'guarded', targets: [] }; },
    async kill(workerId, actor, opts) { calls.push(['kill', workerId, actor, opts]); return { result: 'killed' }; },
    ...overrides.coordinator,
  };
  const directory = overrides.directory ?? root();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const server = new McpFleetServer({ coordinator, coordination, principal: overrides.principal ?? principal(), repoIds: ['repo-a'], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024, takeToolQuota: overrides.takeToolQuota ?? (() => ({ ok: true })) });
  return { calls, coordinator, coordination, directory, server };
}
const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

test('MN1/MN4/CI6/PF7: handshake and deterministic closed fifteen-tool inventory', async () => {
  const { server } = setup(); await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  assert.deepEqual(response.result.tools.map((tool) => tool.name), ['fleet_spawn', 'fleet_scratch_oracle', 'fleet_send', 'fleet_wait', 'fleet_respond', 'fleet_interrupt', 'fleet_result', 'fleet_list', 'fleet_capabilities', 'fleet_provider_status', 'fleet_capability_invoke', 'fleet_reuse_decide', 'fleet_reuse_recheck', 'fleet_kill', 'fleet_drain']);
  assert.equal(response.result.tools.every((tool) => tool.inputSchema.additionalProperties === false), true);
  assert.equal(response.result.tools.every((tool) => tool.execution.taskSupport === 'forbidden'), true);
  assert.equal(response.result.tools[0].inputSchema.properties.modelPolicy.additionalProperties, false);
  assert.equal(response.result.tools[0].inputSchema.properties.session.additionalProperties, false);
  assert.equal(response.result.tools[0].inputSchema.properties.runId.maxLength, 256);
  const capabilitySchema = response.result.tools.find((tool) => tool.name === 'fleet_capability_invoke').inputSchema;
  assert.equal(capabilitySchema.oneOf.length, 4);
  assert.deepEqual(capabilitySchema.oneOf.map((branch) => branch.properties.action.const), ['invoke', 'resume', 'reverify', 'push']);
  const duplicate = await request(server, 3, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(duplicate.error.code, -32600);
});

test('CI6: capability cards are observed and invoke, resume, and reverify preserve actor and budget', async () => {
  const s = setup(); await initialized(s.server);
  const cards = await request(s.server, 2, 'tools/call', { name: 'fleet_capabilities', arguments: { repoId: 'repo-a' } });
  assert.deepEqual(cards.result.structuredContent, { result: [{ name: 'atlas', ops: { 'atlas.inspect': {} } }] });
  const common = { repoId: 'repo-a', name: 'atlas', op: 'atlas.inspect', budgetTokens: 1200 };
  const invokeArgs = { ...common, idempotencyKey: 'cap-invoke', action: 'invoke', args: { path: 'src' } };
  const invoked = await request(s.server, 3, 'tools/call', { name: 'fleet_capability_invoke', arguments: invokeArgs });
  const resumed = await request(s.server, 4, 'tools/call', { name: 'fleet_capability_invoke', arguments: { ...common, idempotencyKey: 'cap-resume', action: 'resume', ref: { digest: 'abc' }, cursor: 'next' } });
  const reverified = await request(s.server, 5, 'tools/call', { name: 'fleet_capability_invoke', arguments: { ...common, idempotencyKey: 'cap-reverify', action: 'reverify', claim: { digest: 'def' }, args: { strict: true } } });
  const replayed = await request(s.server, 6, 'tools/call', { name: 'fleet_capability_invoke', arguments: invokeArgs });
  assert.equal(invoked.result.isError, false); assert.equal(resumed.result.isError, false); assert.equal(reverified.result.isError, false);
  assert.deepEqual(replayed.result, invoked.result);
  assert.deepEqual(s.calls.map((call) => call[0]), ['capabilityCards', 'invokeCapability', 'resumeCapability', 'reverifyCapability']);
  assert.deepEqual(s.calls[1].slice(1, -1), ['atlas', 'atlas.inspect', { path: 'src' }]);
  assert.deepEqual(s.calls[2].slice(1, -1), ['atlas', 'atlas.inspect', { digest: 'abc' }, 'next']);
  assert.deepEqual(s.calls[3].slice(1, -1), ['atlas', 'atlas.inspect', { digest: 'def' }, { strict: true }]);
  const contexts = s.calls.slice(1).map((call) => call.at(-1));
  for (const ctx of contexts) {
    assert.equal(ctx.budgetTokens, 1200); assert.equal(ctx.actor, 'mcp:operator-a:stdio-a'); assert.equal(ctx.repoId, 'repo-a'); assert.equal(ctx.transport, 'mcp');
    assert.match(ctx.idempotencyKey, /^mcp\.call:[0-9a-f-]+$/);
  }
  assert.equal(new Set(contexts.map((ctx) => ctx.idempotencyKey)).size, 3);
});

test('RD10: authenticated MCP reuse decision preserves principal actor, repo, budget, and durable call identity', async () => {
  const { server, calls } = setup(); await initialized(server);
  const args = { repoId: 'repo-a', idempotencyKey: 'reuse-mcp', need: 'JWT verification', choice: 'borrow', rationale: 'Exact green evidence.', dossier: { claim: {}, args: {} }, sbom: { claim: {}, args: {} }, budgetTokens: 4_000 };
  const response = await request(server, 2, 'tools/call', { name: 'fleet_reuse_decide', arguments: args });
  assert.equal(response.result.isError, false); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['decideReuse', { need: args.need, choice: args.choice, rationale: args.rationale, dossier: args.dossier, sbom: args.sbom }]);
  assert.equal(calls[0][2].actor, 'mcp:operator-a:stdio-a'); assert.equal(calls[0][2].repoId, 'repo-a'); assert.equal(calls[0][2].budgetTokens, 4_000); assert.match(calls[0][2].idempotencyKey, /^mcp\.call:[0-9a-f-]+$/);
});

test('RI10: authenticated MCP reuse recheck preserves principal authority and rejects forged evidence fields', async () => {
  const { server, calls } = setup(); await initialized(server);
  const args = { repoId: 'repo-a', idempotencyKey: 'recheck-mcp', decisionId: 'reuse-decision:test', expectedValidityVersion: 2, trigger: 'ttl_expired', budgetTokens: 4_000 };
  const response = await request(server, 2, 'tools/call', { name: 'fleet_reuse_recheck', arguments: args });
  assert.equal(response.result.isError, false);
  assert.deepEqual(calls[0][0], 'recheckReuseDecision'); assert.deepEqual(calls[0][1], { decisionId: args.decisionId, expectedValidityVersion: 2, trigger: 'ttl_expired', budgetTokens: 4_000 });
  assert.equal(calls[0][2].actor, 'mcp:operator-a:stdio-a'); assert.equal(calls[0][2].repoId, 'repo-a');
  const forged = await request(server, 3, 'tools/call', { name: 'fleet_reuse_recheck', arguments: { ...args, idempotencyKey: 'recheck-forged', advisoryIds: ['forged'] } });
  assert.equal(forged.result.isError, true); assert.equal(calls.length, 1);
});

test('OR9: authenticated MCP capability push is fenced and preserves the injected actor', async () => {
  const s = setup(); await initialized(s.server);
  const common = { repoId: 'repo-a', idempotencyKey: 'orient-1', name: 'cartographer-quartermaster', op: 'orientation.slice', action: 'push', workerId: 'worker-1', note: 'Stay in auth.', expectedFence: 4, budgetTokens: 900, args: { indexEpoch: 'epoch', focus: 'auth', shape: 'brief' } };
  const pushed = await request(s.server, 2, 'tools/call', { name: 'fleet_capability_invoke', arguments: common });
  assert.equal(pushed.result.isError, false);
  assert.deepEqual(s.calls[0].slice(0, -1), ['orientWorker', 'worker-1', { indexEpoch: 'epoch', focus: 'auth', shape: 'brief' }, 'Stay in auth.']);
  assert.equal(s.calls[0].at(-1).budgetTokens, 900); assert.equal(s.calls[0].at(-1).actor, 'mcp:operator-a:stdio-a');
  assert.equal(s.calls[0].at(-1).repoId, 'repo-a'); assert.equal(s.calls[0].at(-1).transport, 'mcp'); assert.match(s.calls[0].at(-1).idempotencyKey, /^mcp\.call:[0-9a-f-]+$/);
  assert.equal(s.calls[0].at(-1).expectedFence, 4);
  const missingFence = await request(s.server, 3, 'tools/call', { name: 'fleet_capability_invoke', arguments: { ...common, idempotencyKey: 'orient-2', expectedFence: undefined } });
  assert.equal(missingFence.result.isError, true); assert.equal(s.calls.length, 1);
});

test('CI6: capability invocation validation and control authority fail closed before dispatch', async () => {
  const s = setup({ principal: principal({ capabilities: ['observe'] }) }); await initialized(s.server);
  const invalid = [
    { repoId: 'repo-a', idempotencyKey: 'bad-1', name: 'atlas', op: 'atlas.inspect', budgetTokens: 0, args: {} },
    { repoId: 'repo-a', idempotencyKey: 'bad-2', name: 'atlas', op: 'atlas.inspect', budgetTokens: 5, action: 'resume', ref: {}, cursor: '' },
    { repoId: 'repo-a', idempotencyKey: 'bad-3', name: 'atlas', op: 'atlas.inspect', budgetTokens: 5, action: 'reverify', claim: {}, args: [], },
    { repoId: 'repo-a', idempotencyKey: 'bad-4', name: 'atlas', op: 'atlas.inspect', budgetTokens: 5, args: {}, claim: {} },
    { repoId: 'repo-a', idempotencyKey: 'bad-5', name: 'atlas', op: 'atlas.inspect', budgetTokens: 5, args: {} },
  ];
  for (let i = 0; i < invalid.length; i += 1) {
    const response = await request(s.server, 10 + i, 'tools/call', { name: 'fleet_capability_invoke', arguments: invalid[i] });
    assert.equal(response.result.isError, true); assert.match(response.result.content[0].text, /invalid_capability_invocation/);
  }
  const forbidden = await request(s.server, 20, 'tools/call', { name: 'fleet_capability_invoke', arguments: {
    repoId: 'repo-a', idempotencyKey: 'forbidden', name: 'atlas', op: 'atlas.inspect', budgetTokens: 5, action: 'invoke', args: {},
  } });
  assert.equal(forbidden.result.isError, true); assert.match(forbidden.result.content[0].text, /forbidden/);
  assert.deepEqual(s.calls, []);
});

test('MN3/MN5/MN6: spawn preserves exact harness/model/effort under injected authority', async () => {
  const { server, calls } = setup(); await initialized(server);
  const response = await request(server, 2, 'tools/call', { name: 'fleet_spawn', arguments: {
    repoId: 'repo-a', idempotencyKey: 'spawn-1', runId: 'run-mcp-a', harness: 'CodexAppServerCli', model: 'gpt-5.6-sol', effort: 'low', brief: { task: 'review MCP' },
  } });
  assert.equal(response.result.isError, false);
  assert.deepEqual(calls[0].slice(0, 3), ['spawn', 'CodexAppServerCli', { task: 'review MCP' }]);
  assert.equal(calls[0][3].model, 'gpt-5.6-sol'); assert.equal(calls[0][3].effort, 'low');
  assert.equal(calls[0][3].runId, 'run-mcp-a');
  assert.match(calls[0][3].actor, /^mcp:operator-a:stdio-a$/);
  assert.equal(JSON.stringify(calls[0]).includes('idempotencyKey":"spawn-1'), false);
});

test('MN7/MN9: terminal replay survives restart and never duplicates an effect', async () => {
  const s = setup(); await initialized(s.server);
  const args = { repoId: 'repo-a', idempotencyKey: 'kill-1', workerId: 'worker-1', expectedFence: 3 };
  const first = await request(s.server, 2, 'tools/call', { name: 'fleet_kill', arguments: args });
  const restarted = setup({ directory: s.directory, coordinator: s.coordinator }); await initialized(restarted.server);
  const replay = await request(restarted.server, 3, 'tools/call', { name: 'fleet_kill', arguments: args });
  assert.deepEqual(replay.result, first.result);
  assert.equal(s.calls.filter(([kind]) => kind === 'kill').length, 1);
  const raw = JSON.stringify(restarted.coordination.events());
  assert.equal(raw.includes('kill-1'), false);
});

test('MN7: conflicting and admitted replay are fail-closed without a second dispatch', async () => {
  const s = setup(); await initialized(s.server);
  const common = { repoId: 'repo-a', idempotencyKey: 'send-1', workerId: 'worker-1', message: 'one', mode: 'nudge', expectedFence: 1 };
  await request(s.server, 2, 'tools/call', { name: 'fleet_send', arguments: common });
  assert.deepEqual(s.calls[0][4], { expectedFence: 1, actor: 'mcp:operator-a:stdio-a' });
  const conflict = await request(s.server, 3, 'tools/call', { name: 'fleet_send', arguments: { ...common, message: 'two' } });
  assert.equal(conflict.result.isError, true); assert.match(conflict.result.content[0].text, /idempotency_conflict/);
  const held = setup(); await initialized(held.server);
  held.coordination.admitMcpCall({ callId: 'held-1', scopeKey: held.server.callScope('fleet_send', common), requestDigest: held.server.callDigest(common), tool: 'fleet_send', repoId: 'repo-a', userId: 'operator-a' }, { actor: 'test', key: 'held' });
  const pending = await request(held.server, 4, 'tools/call', { name: 'fleet_send', arguments: common });
  assert.equal(pending.result.isError, true); assert.match(pending.result.content[0].text, /call_admitted/);
  assert.equal(held.calls.length, 0);
});

test('MN7: a lost completion append never reports success and retry never repeats the effect', async () => {
  const s = setup(); await initialized(s.server);
  const complete = s.coordination.completeMcpCall.bind(s.coordination);
  s.coordination.completeMcpCall = () => { throw new Error('disk unavailable'); };
  const args = { repoId: 'repo-a', idempotencyKey: 'interrupt-1', workerId: 'worker-1', expectedFence: 2, then: 'stop here' };
  const first = await request(s.server, 2, 'tools/call', { name: 'fleet_interrupt', arguments: args });
  assert.equal(first.result.isError, true); assert.match(first.result.content[0].text, /temporarily_unavailable/);
  s.coordination.completeMcpCall = complete;
  const retry = await request(s.server, 3, 'tools/call', { name: 'fleet_interrupt', arguments: args });
  assert.equal(retry.result.isError, true); assert.match(retry.result.content[0].text, /call_admitted/);
  assert.equal(s.calls.filter(([kind]) => kind === 'interrupt').length, 1);
});

test('MN7/MN8: state failures distinguish safe stale fences from ambiguous outcomes without leaking causes', async () => {
  const stale = setup({ coordinator: { async kill() { return { result: 'stale_fence' }; } } }); await initialized(stale.server);
  const args = { repoId: 'repo-a', idempotencyKey: 'kill-stale', workerId: 'worker-1', expectedFence: 8 };
  const staleResult = await request(stale.server, 2, 'tools/call', { name: 'fleet_kill', arguments: args });
  assert.match(staleResult.result.content[0].text, /stale_fence/);
  const unknown = setup({ coordinator: { async interrupt() { throw new Error('private after-effect detail'); } } }); await initialized(unknown.server);
  const failed = await request(unknown.server, 3, 'tools/call', { name: 'fleet_interrupt', arguments: { ...args, idempotencyKey: 'interrupt-unknown' } });
  assert.match(failed.result.content[0].text, /command_outcome_unknown/);
  assert.equal(failed.result.content[0].text.includes('private after-effect detail'), false);
});

test('MN3/MN4/MN6: scope, capability, fence, unknown fields, and credential fields are rejected before dispatch', async () => {
  const s = setup({ principal: principal({ capabilities: ['observe'] }) }); await initialized(s.server);
  const cases = [
    { name: 'fleet_spawn', arguments: { repoId: 'repo-a', idempotencyKey: 'a', harness: 'x', brief: {} } },
    { name: 'fleet_spawn', arguments: { repoId: 'repo-a', idempotencyKey: 'bad-run', runId: '../escape', harness: 'x', brief: {} } },
    { name: 'fleet_kill', arguments: { repoId: 'repo-b', idempotencyKey: 'b', workerId: 'w', expectedFence: 1 } },
    { name: 'fleet_send', arguments: { repoId: 'repo-a', idempotencyKey: 'c', workerId: 'w', message: 'x', mode: 'nudge' } },
    { name: 'fleet_list', arguments: { repoId: 'repo-a', token: 'secret' } },
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const response = await request(s.server, 10 + i, 'tools/call', cases[i]);
    assert.equal(response.result.isError, true);
  }
  assert.deepEqual(s.calls, []);
});

test('MN3/MN8: injected quota and durable audit fail closed before dispatch', async () => {
  const limited = setup({ takeToolQuota: async () => ({ ok: false }) }); await initialized(limited.server);
  const response = await request(limited.server, 2, 'tools/call', { name: 'fleet_list', arguments: { repoId: 'repo-a' } });
  assert.equal(response.result.isError, true); assert.match(response.result.content[0].text, /rate_limited/);
  assert.equal(limited.coordination.events().at(-1).payload.kind, 'tool_rate_limited');
  assert.deepEqual(limited.calls, []);
  const unavailable = setup(); await initialized(unavailable.server);
  unavailable.coordination.recordMcpAudit = () => { throw new Error('audit unavailable'); };
  const failed = await request(unavailable.server, 3, 'tools/call', { name: 'fleet_list', arguments: { repoId: 'repo-a' } });
  assert.equal(failed.result.isError, true); assert.match(failed.result.content[0].text, /temporarily_unavailable/);
  assert.deepEqual(unavailable.calls, [['list']]);
});

test('MN8: reads return structured content and wait is bounded by the configured host-safe ceiling', async () => {
  const s = setup(); await initialized(s.server);
  const response = await request(s.server, 2, 'tools/call', { name: 'fleet_wait', arguments: { repoId: 'repo-a', timeoutMs: 90_000 } });
  assert.deepEqual(response.result.structuredContent, { events: [], cursor: 4, more: false });
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
  assert.deepEqual(s.calls, [['wait', 25_000]]);
  const listed = await request(s.server, 3, 'tools/call', { name: 'fleet_list', arguments: { repoId: 'repo-a' } });
  assert.deepEqual(listed.result.structuredContent, { result: [{ id: 'worker-1' }] });
});

test('MN1/MN8: protocol faults stay JSON-RPC errors while coordinator faults are tool errors', async () => {
  const s = setup({ coordinator: { async result() { throw new Error('private provider detail'); } } });
  const beforeInit = await request(s.server, 1, 'tools/list', {}); assert.equal(beforeInit.error.code, -32002);
  await initialized(s.server);
  const unknownMethod = await request(s.server, 2, 'unknown', {}); assert.equal(unknownMethod.error.code, -32601);
  const unknownTool = await request(s.server, 3, 'tools/call', { name: 'fleet_nope', arguments: {} }); assert.equal(unknownTool.error.code, -32602);
  const failed = await request(s.server, 4, 'tools/call', { name: 'fleet_result', arguments: { repoId: 'repo-a', workerId: 'w' } });
  assert.equal(failed.result.isError, true); assert.equal(failed.result.content[0].text.includes('private provider detail'), false);
});

test('MN2: stdio is newline JSON-RPC, ordered, drains on EOF, and rejects malformed/oversize frames', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough(); const error = new PassThrough();
  let wire = ''; output.on('data', (chunk) => { wire += chunk; });
  const serving = serveMcpStdio(s.server, { input, output, error, maxLineBytes: 256 });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
  input.write('{bad json}\n'); input.write(`${'x'.repeat(300)}\n`); input.end(); await serving;
  const frames = wire.trim().split('\n').map(JSON.parse);
  assert.equal(frames[0].id, 1); assert.deepEqual(frames.slice(1).map((frame) => frame.error.code), [-32700, -32700]);
  assert.equal(s.calls.length, 0); assert.equal(error.read()?.toString() ?? '', '');
});

test('MN2: an oversize frame split across chunks is discarded without losing the following frame', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough();
  let wire = ''; output.on('data', (chunk) => { wire += chunk; });
  const serving = serveMcpStdio(s.server, { input, output, maxLineBytes: 64 });
  input.write('x'.repeat(40)); input.write(`${'y'.repeat(40)}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`); input.end(); await serving;
  const frames = wire.trim().split('\n').map(JSON.parse);
  assert.equal(frames[0].error.code, -32700); assert.deepEqual(frames[1], { jsonrpc: '2.0', id: 2, result: {} });
});

test('MN2/MN9: invalid UTF-8 is a parse error and output failure rejects the transport', async () => {
  const s = setup(); const input = new PassThrough(); const output = new PassThrough();
  let wire = ''; output.on('data', (chunk) => { wire += chunk; });
  const serving = serveMcpStdio(s.server, { input, output });
  input.end(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0x0a]));
  await serving; assert.equal(JSON.parse(wire).error.code, -32700);
  const badInput = new PassThrough();
  const badOutput = new PassThrough();
  badOutput.on('error', () => {});
  badOutput._write = (_chunk, _encoding, callback) => callback(new Error('wire closed'));
  const failed = serveMcpStdio(setup().server, { input: badInput, output: badOutput });
  badInput.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  await assert.rejects(failed, /wire closed/);
});

test('MN2/MN3: the packaged subprocess entry runs a configured MCP handshake with stdout frame purity', () => {
  const directory = root(); const configPath = join(directory, 'mcp-config.mjs');
  const indexUrl = new URL('../src/index.mjs', import.meta.url).href;
  writeFileSync(configPath, `
    import { CoordinationStore } from ${JSON.stringify(indexUrl)};
    export default () => ({
      coordinator: { list() { return []; } },
      coordination: new CoordinationStore(${JSON.stringify(join(directory, 'coordination'))}),
      principal: { userId: 'cli-user', sessionId: 'cli-session', capabilities: ['observe'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false },
      repoIds: ['repo-a'], maxMessageBytes: 65536, takeToolQuota: async () => ({ ok: true }),
    });
  `);
  const frames = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wire-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];
  const stdout = execFileSync(process.execPath, ['scripts/mcp-stdio.mjs', configPath], { cwd: new URL('..', import.meta.url), input: `${frames.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8' });
  const responses = stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(responses.map((response) => response.id), [1, 2]);
  assert.equal(responses[1].result.tools.length, 15);
});
