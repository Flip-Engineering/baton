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
  userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
  repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
});
const runApplicationCard = () => ({
  schemaVersion: 1,
  repoId: 'repo-a',
  commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
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
  const server = new McpFleetServer({
    coordinator, coordination, application: overrides.application,
    applicationOwned: overrides.applicationOwned,
    surface: overrides.surface ?? (overrides.application ? 'combined' : undefined),
    shutdownPrincipal: overrides.application ? (overrides.shutdownPrincipal ?? {
      actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session',
    }) : undefined,
    isPrincipalActive: overrides.isPrincipalActive,
    principal: overrides.principal ?? principal(), repoIds: ['repo-a'], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (() => ({ ok: true })),
  });
  return { calls, coordinator, coordination, directory, server };
}
const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

test('MN1/MN4/CI6/PF7: handshake and deterministic closed nineteen-tool inventory', async () => {
  const { server } = setup(); await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  assert.deepEqual(response.result.tools.map((tool) => tool.name), ['fleet_spawn', 'fleet_scratch_oracle', 'fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_goal_plan_status', 'fleet_send', 'fleet_wait', 'fleet_respond', 'fleet_interrupt', 'fleet_result', 'fleet_list', 'fleet_capabilities', 'fleet_provider_status', 'fleet_capability_invoke', 'fleet_reuse_decide', 'fleet_reuse_recheck', 'fleet_kill', 'fleet_drain']);
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

test('UA5/MN1: an application-backed MCP server exposes the semantic ordinary surface and keeps compatibility explicit', async () => {
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; }, async command() { return {}; },
  };
  const { server } = setup({ application, surface: 'application' }); await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  // M4b: the canonical grammar tools render beside the retained legacy tools (docs/36 §9 M4).
  // MCP-W1/W2 (v1.0.1): waves.*/doctor/decision.answer/settlement join the ordinary surface.
  // Facade-projection epic (#87+#48): the six workflow-surface tools join between the settlement
  // family and the view verbs (message×2, attention.watch, scratchpad.read/elevate, knowledge.seed).
  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    'baton_help', 'baton_runs', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
    'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
    'baton_run_act', 'baton_run_stop', 'baton_waves_attach',
    'baton_waves_start', 'baton_waves_progress', 'baton_waves_send', 'baton_waves_stop',
    'baton_deployment_doctor', 'baton_decision_answer',
    'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote', 'baton_knowledge_settlement_lease',
    'baton_run_message_send', 'baton_run_message_receipt', 'baton_run_attention_watch',
    'baton_run_scratchpad_read', 'baton_run_scratchpad_elevate', 'baton_run_knowledge_seed',
    'baton_run_do', 'baton_run_view', 'baton_run_member_view', 'baton_run_member_send',
    'baton_run_member_stop', 'baton_application_help',
  ]);
  const inspectSchema = response.result.tools.find((tool) => tool.name === 'baton_run_inspect').inputSchema;
  for (const field of ['offset', 'pageCursor', 'recipient']) {
    assert.equal(Object.hasOwn(inspectSchema.properties, field), true, field);
  }
  assert.equal(response.result.tools.some((tool) => /shutdown|close|drain/.test(tool.name)), false);
  const advanced = setup({ application, surface: 'combined' }); await initialized(advanced.server);
  const combined = await request(advanced.server, 3, 'tools/list', {});
  // S-3 extends the derived combined reflex projection with board.drop, REPL citation, and
  // knowledge recall/horizon while leaving the ordinary application surface unchanged.
  // names verbatim, taskSupport forbidden, additionalProperties false, and _meta present on the
  // reflex tools like the ordinary table.
  const reflexNames = [
    'baton_context_eval', 'baton_decision_list',
    'baton_board_post', 'baton_board_retitle', 'baton_board_reorder', 'baton_board_close', 'baton_board_drop', 'baton_board_read',
    'baton_package_admit', 'baton_package_attach', 'baton_package_read',
    'baton_repl_cite', 'baton_knowledge_recall', 'baton_knowledge_horizon',
  ];
  assert.equal(combined.result.tools.length, 84); // 64 ordinary/advanced + 6 workflow-surface (#87+#48) + 14 S-3 reflex (decision.answer + settlement rows are ordinary at MCP-W1/W2)
  assert.deepEqual(combined.result.tools.slice(0, response.result.tools.length).map((tool) => tool.name), response.result.tools.map((tool) => tool.name), 'the combined inventory preserves the ordinary application surface verbatim as its prefix');
  assert.deepEqual(combined.result.tools.map((tool) => tool.name).filter((name) => reflexNames.includes(name)), reflexNames);
  assert.equal(combined.result.tools.every((tool) => tool.inputSchema.additionalProperties === false), true);
  assert.equal(combined.result.tools.every((tool) => tool.execution.taskSupport === 'forbidden'), true);
  for (const name of reflexNames) {
    const tool = combined.result.tools.find((candidate) => candidate.name === name);
    assert.ok(tool._meta && typeof tool._meta['baton/registryDigest'] === 'string', `${name} carries _meta.baton/registryDigest`);
  }
});

test('P92/MN: Episode continuation and exact workstream generation round-trip through MCP', async () => {
  const applicationCalls = [];
  const application = {
    repoId: 'repo-a', card: runApplicationCard, async authorizeReplay() { return true; },
    async command(name, args) {
      applicationCalls.push({ name, args });
      return { schemaVersion: 1, operation: name, arguments: args, continuation: {
        operation: name, arguments: { ...args, pageCursor: 'next_page' },
      } };
    },
  };
  const { server } = setup({ application, surface: 'application' }); await initialized(server);
  const episodeArgs = {
    repoId: 'repo-a', runId: 'run-mcp-episode', topic: 'output', detail: 'content',
    role: 'reviewer', generation: 2, pageCursor: 'page_1', cursor: 9, waitMs: 5,
  };
  const episode = await request(server, 2, 'tools/call', {
    name: 'baton_run_episode', arguments: episodeArgs,
  });
  assert.equal(episode.result.isError, false);
  assert.deepEqual(applicationCalls.at(-1), {
    name: 'run.episode', args: {
      runId: 'run-mcp-episode', topic: 'output', detail: 'content', role: 'reviewer',
      generation: 2, pageCursor: 'page_1', cursor: 9, waitMs: 5,
    },
  });
  assert.equal(episode.result.structuredContent.continuation.arguments.pageCursor, 'next_page');
  const workstream = await request(server, 3, 'tools/call', {
    name: 'baton_run_workstreams', arguments: {
      repoId: 'repo-a', runId: 'run-mcp-episode', role: 'reviewer', generation: 2,
    },
  });
  assert.equal(workstream.result.isError, false);
  assert.equal(applicationCalls.at(-1).args.generation, 2);
});

test('KC6/KC7: a remote application facade is transport-owned and MCP close cannot shut Baton down', async () => {
  const calls = [];
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name) { calls.push(name); return {}; },
  };
  const { server } = setup({
    application, surface: 'application',
    applicationOwned: false, shutdownPrincipal: undefined,
  });
  assert.deepEqual(await server.close(), {
    schemaVersion: 1, state: 'transport_closed', applicationOwned: false,
  });
  assert.deepEqual(calls, []);
});

test('UA5/MN: Run tools map exactly to the application bus and keep status/wait fresh', async () => {
  const applicationCalls = [];
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal) {
      applicationCalls.push({ name, args, principal: appPrincipal });
      return { schemaVersion: 1, runId: args.runId ?? args.intent?.runId, phase: 'running' };
    },
  };
  const { server, coordination } = setup({ application }); await initialized(server);
  const calls = [
    ['fleet_run_start', { repoId: 'repo-a', idempotencyKey: 'run-start', intent: { runId: 'run-mcp-a', objective: 'Ship integrated MCP', profile: 'standard', route: { harness: 'grok', model: 'grok-4-code', effort: 'high' }, scope: ['impl/**'] } }, 'run.start'],
    ['fleet_run_status', { repoId: 'repo-a', runId: 'run-mcp-a' }, 'run.status'],
    ['fleet_run_follow', { repoId: 'repo-a', runId: 'run-mcp-a', afterCursor: 3, timeoutMs: 25_000 }, 'run.follow'],
    ['fleet_run_approve', { repoId: 'repo-a', idempotencyKey: 'run-approve', runId: 'run-mcp-a', planDigest: 'a'.repeat(64) }, 'run.approve'],
    ['fleet_run_wait', { repoId: 'repo-a', runId: 'run-mcp-a', timeoutMs: 25_000 }, 'run.wait'],
    ['fleet_run_answer', { repoId: 'repo-a', idempotencyKey: 'run-answer', runId: 'run-mcp-a', requestId: 'question-1', answer: { decision: 'allow' } }, 'run.answer'],
    ['fleet_run_feedback', { repoId: 'repo-a', idempotencyKey: 'run-feedback', runId: 'run-mcp-a', role: 'builder', feedback: 'Preserve the exact route evidence.' }, 'run.feedback'],
    ['fleet_run_stop', { repoId: 'repo-a', idempotencyKey: 'run-stop', runId: 'run-mcp-a', reason: 'Operator cancelled this Run.' }, 'run.stop'],
    ['fleet_run_evidence', { repoId: 'repo-a', runId: 'run-mcp-a' }, 'run.evidence'],
    ['fleet_run_adopt', { repoId: 'repo-a', idempotencyKey: 'run-adopt', runId: 'run-mcp-a', nodeKey: 'work', resultSha: 'b'.repeat(40), evidenceDigest: 'c'.repeat(64), reason: 'Select the verified result.' }, 'run.adopt'],
    ['fleet_run_review', { repoId: 'repo-a', idempotencyKey: 'run-review', runId: 'run-mcp-a', route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Independent semantic review.' }, 'run.review'],
    ['fleet_run_integrate', { repoId: 'repo-a', idempotencyKey: 'run-integrate', runId: 'run-mcp-a', evidenceDigest: 'd'.repeat(64), strategy: 'ff-only', reason: 'Integrate the reviewed result.' }, 'run.integrate'],
  ];
  for (const [index, [name, args, expected]] of calls.entries()) {
    const response = await request(server, 10 + index, 'tools/call', { name, arguments: args });
    assert.equal(response.result.isError, false);
    assert.equal(applicationCalls.at(-1).name, expected);
  }
  assert.deepEqual(applicationCalls.map((call) => call.principal), Array(12).fill({
    actor: 'mcp:operator-a:stdio-a', principalId: 'operator-a', sessionId: 'stdio-a',
  }));
  assert.equal(applicationCalls.some((call) => Object.hasOwn(call.args, 'repoId') || Object.hasOwn(call.args, 'idempotencyKey')), false);
  assert.deepEqual(coordination.events().filter((event) => event.kind === 'mcp.call_admitted')
    .map((event) => [event.payload.tool, event.payload.runId]), [
      ['fleet_run_start', 'run-mcp-a'], ['fleet_run_approve', 'run-mcp-a'], ['fleet_run_answer', 'run-mcp-a'], ['fleet_run_feedback', 'run-mcp-a'], ['fleet_run_stop', 'run-mcp-a'], ['fleet_run_adopt', 'run-mcp-a'], ['fleet_run_review', 'run-mcp-a'], ['fleet_run_integrate', 'run-mcp-a'],
    ]);
  await request(server, 20, 'tools/call', { name: 'fleet_run_status', arguments: { repoId: 'repo-a', runId: 'run-mcp-a' } });
  assert.equal(applicationCalls.filter((call) => call.name === 'run.status').length, 2, 'read-only status is fresh rather than a cached call replay');
});

test('CE5/MN: a Run follow cannot return after its injected MCP principal authority is revoked', async () => {
  let active = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const dispatched = new Promise((resolve) => { entered = resolve; });
  const application = {
    repoId: 'repo-a', card: runApplicationCard, async authorizeReplay() { return true; },
    async command() { entered(); await blocked; return { schemaVersion: 1, runId: 'run-mcp-a', phase: 'running', follow: { throughCursor: 3 } }; },
  };
  const s = setup({ application, isPrincipalActive: () => active });
  await initialized(s.server);
  const pending = request(s.server, 3, 'tools/call', { name: 'fleet_run_follow', arguments: {
    repoId: 'repo-a', runId: 'run-mcp-a', afterCursor: 2, timeoutMs: 25_000,
  } });
  await dispatched;
  active = false;
  release();
  const response = await pending;
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /unauthenticated/);
});

test('UA5/MN: malformed Run calls and missing observe authority refuse before application dispatch', async () => {
  const applicationCalls = [];
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(...args) { applicationCalls.push(args); return {}; },
  };
  const malformed = setup({ application }); await initialized(malformed.server);
  const bad = await request(malformed.server, 2, 'tools/call', { name: 'fleet_run_start', arguments: {
    repoId: 'repo-a', idempotencyKey: 'bad-run',
    intent: { runId: 'run-mcp-a', objective: 'work', profile: 'standard', route: { harness: 'grok', model: 'grok-4-code' } },
  } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /invalid_run_command/);
  assert.equal(malformed.coordination.events().some((event) => event.kind === 'mcp.call_admitted'), false);

  const forbidden = setup({ application, principal: principal({ capabilities: ['control'] }) }); await initialized(forbidden.server);
  const denied = await request(forbidden.server, 3, 'tools/call', { name: 'fleet_run_start', arguments: {
    repoId: 'repo-a', idempotencyKey: 'forbidden-run',
    intent: { runId: 'run-mcp-a', objective: 'work', profile: 'standard', route: { harness: 'grok', model: 'grok-4-code', effort: 'high' } },
  } });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /forbidden/);
  assert.deepEqual(applicationCalls, []);
});

test('UA5/MN: application/card repository drift fails construction and remote shutdown tools stay invalid', async () => {
  assert.throws(() => setup({ application: {
    repoId: 'repo-b', card: () => ({ ...runApplicationCard(), repoId: 'repo-b' }),
    async authorizeReplay() { return true; }, async command() {},
  } }), /does not match/);
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; }, async command() {},
  };
  const { server } = setup({ application, surface: 'application' }); await initialized(server);
  for (const name of ['application_shutdown', 'run_close', 'fleet_drain']) {
    const response = await request(server, 10, 'tools/call', { name, arguments: { repoId: 'repo-a' } });
    assert.equal(response.error.code, -32602);
  }
  assert.throws(() => setup({ application, shutdownPrincipal: { actor: 'missing identity' } }), /shutdownPrincipal/);
});

test('UA5/MN: concurrent mutation retries singleflight and completed replay reauthorizes without redispatch', async () => {
  let dispatches = 0;
  let replayAllowed = true;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() {
      if (!replayAllowed) throw Object.assign(new Error('private replay policy'), { code: 'application_unauthorized' });
      return true;
    },
    async command() { dispatches += 1; await blocked; return { schemaVersion: 1, runId: 'run-mcp-a', phase: 'awaiting_plan_approval' }; },
  };
  const { server } = setup({ application }); await initialized(server);
  const args = {
    repoId: 'repo-a', idempotencyKey: 'run-singleflight',
    intent: { runId: 'run-mcp-a', objective: 'work', profile: 'standard', route: { harness: 'grok', model: 'grok-4-code', effort: 'high' } },
  };
  const first = request(server, 2, 'tools/call', { name: 'fleet_run_start', arguments: args });
  const second = request(server, 3, 'tools/call', { name: 'fleet_run_start', arguments: args });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dispatches, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.every((response) => response.result.isError === false), true);
  assert.equal(dispatches, 1);
  replayAllowed = false;
  const denied = await request(server, 4, 'tools/call', { name: 'fleet_run_start', arguments: args });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /forbidden/);
  assert.equal(dispatches, 1);
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
  const forged = setup({ principal: principal({ capabilities: ['control'] }) }); await initialized(forged.server);
  const forgedCapability = await request(forged.server, 20, 'tools/call', {
    name: 'fleet_spawn', arguments: { repoId: 'repo-a', idempotencyKey: 'forged-capability', harness: 'x', brief: { capabilities: ['emergency_stop'] } },
  });
  assert.equal(forgedCapability.result.isError, true);
  assert.match(forgedCapability.result.content[0].text, /credential_fields_forbidden/);
  assert.deepEqual(forged.calls, []);
});

test('MN3/MN8: injected quota fails closed while successful read observations stay off-ledger', async () => {
  const limited = setup({ takeToolQuota: async () => ({ ok: false }) }); await initialized(limited.server);
  const response = await request(limited.server, 2, 'tools/call', { name: 'fleet_list', arguments: { repoId: 'repo-a' } });
  assert.equal(response.result.isError, true); assert.match(response.result.content[0].text, /rate_limited/);
  assert.equal(limited.coordination.events().at(-1).payload.kind, 'tool_rate_limited');
  assert.deepEqual(limited.calls, []);
  const unavailable = setup(); await initialized(unavailable.server);
  const before = unavailable.coordination.events().length;
  unavailable.coordination.recordMcpAudit = () => { throw new Error('audit unavailable'); };
  const observed = await request(unavailable.server, 3, 'tools/call', { name: 'fleet_list', arguments: { repoId: 'repo-a' } });
  assert.equal(observed.result.isError, false);
  assert.equal(unavailable.coordination.events().length, before);
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

test('UA6/MN2: application-backed stdio EOF invokes host-only deployment shutdown exactly once', async () => {
  const applicationCalls = [];
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal) {
      applicationCalls.push({ name, args, principal: appPrincipal });
      return { schemaVersion: 1, state: 'closed', ownership: { workers: 0, workerIds: [], closed: true } };
    },
  };
  const s = setup({ application });
  const input = new PassThrough(); const output = new PassThrough();
  const serving = serveMcpStdio(s.server, { input, output });
  input.end();
  const receipt = await serving;
  assert.equal(receipt, undefined);
  assert.deepEqual(applicationCalls, [{
    name: 'application.shutdown', args: {},
    principal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
  }]);
  await s.server.close();
  assert.equal(applicationCalls.length, 1, 'transport and host finalizers share one shutdown promise');
  const afterClose = await request(s.server, 2, 'ping');
  assert.equal(afterClose.error.code, -32002);
});

test('UA6/MN2: failed host shutdown is visible and retryable without exposing a remote tool', async () => {
  let attempts = 0;
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name) {
      assert.equal(name, 'application.shutdown');
      attempts += 1;
      if (attempts === 1) throw new Error('close refused');
      return { state: 'closed' };
    },
  };
  const s = setup({ application });
  await assert.rejects(s.server.close(), /close refused/);
  assert.deepEqual(await s.server.close(), { state: 'closed' });
  assert.equal(attempts, 2);
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
  assert.equal(responses[1].result.tools.length, 19);
});
