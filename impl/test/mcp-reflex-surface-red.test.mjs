// MCP reflex surface red suite (Slice 1), binding contract: docs/reference/evidence/
// mcp-reflex-live-2026-07-22/mcp-reflex-surface-decisions.md (v2 FINAL, de68345).
//
// Slice 1 scope (Part J): registration machinery (Parts A, F) + baton_context_eval (Part B) +
// baton_decision_list/baton_decision_answer (Part C) + inventory/error tests (Part H). Board
// (Part D) and package (Part E) tools are Slice 2, a separate seat binding coordination-store.mjs
// methods this task's file scope does not include.
//
// This file tests the MCP-northbound wiring (registration, dispatch routing, typed-error reach,
// the answer-shape guard, and the Web-bridge boundary) against a mocked `application` facade —
// the same style phase16-mcp-northbound.test.mjs and reflex1-decision-requests-red.test.mjs use
// for the ordinary `fleet_run_*`/`baton_run_*` tools. The underlying semantic behavior of
// `application.contextEval` itself is exhaustively covered by
// impl/test/reflex4-context-eval-red.test.mjs; this file does not re-derive it.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, McpFleetServer } from '../src/index.mjs';

const NOW = Date.parse('2026-07-22T00:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-mcp-reflex-'));
const REPO_ID = 'repo-reflex';

const runApplicationCard = () => ({
  schemaVersion: 1,
  repoId: REPO_ID,
  commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
});

function principal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
  };
}

function mockApplication(overrides = {}) {
  const commandCalls = [];
  const contextEvalCalls = [];
  const decisionListCalls = [];
  const application = {
    repoId: REPO_ID,
    card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      commandCalls.push({ name, args, principal: appPrincipal, context });
      if (overrides.command) return overrides.command(name, args, appPrincipal, context);
      return { schemaVersion: 1, runId: args.runId, phase: 'running' };
    },
    async contextEval(request, appPrincipal, context) {
      contextEvalCalls.push({ request, principal: appPrincipal, context });
      if (overrides.contextEval) return overrides.contextEval(request, appPrincipal, context);
      if ((request.runId === undefined) === (request.manifestDigest === undefined)) {
        throw Object.assign(new Error('Context evaluation request is invalid'), { code: 'application_context_eval_invalid' });
      }
      return { item: { id: `cell:${'a'.repeat(64)}`, value: { kind: 'cell' } } };
    },
    async decisionList(request, appPrincipal, context) {
      decisionListCalls.push({ request, principal: appPrincipal, context });
      if (overrides.decisionList) return overrides.decisionList(request, appPrincipal, context);
      return { decisions: [] };
    },
  };
  return { application, commandCalls, contextEvalCalls, decisionListCalls };
}

function setup(overrides = {}) {
  const directory = overrides.directory ?? root();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const { application, commandCalls, contextEvalCalls, decisionListCalls } = overrides.applicationBundle ?? mockApplication(overrides.applicationOverrides ?? {});
  const server = new McpFleetServer({
    coordinator: overrides.coordinator ?? {},
    coordination,
    application,
    surface: overrides.surface ?? 'combined',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: overrides.principal ?? principal(),
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (async () => ({ ok: true })),
  });
  return { server, coordination, application, commandCalls, contextEvalCalls, decisionListCalls, directory };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

// ---------------------------------------------------------------------------------------------
// Part A / Part H "Registration": every reflex tool resolves a non-undefined CAPABILITY entry;
// STATEFUL tools take the admitMcpCall path; read-only tools take the observe path.
// ---------------------------------------------------------------------------------------------

test('Registration: baton_context_eval and baton_decision_answer resolve real capability entries (an unregistered tool would refuse forbidden regardless of held capabilities)', async () => {
  const { server } = setup({ principal: principal({ capabilities: ['observe'] }) });
  await initialized(server);
  const evalResponse = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-1', runId: 'run-a', program: { schemaVersion: 1 } },
  });
  assert.equal(evalResponse.result.isError, false, 'observe alone must satisfy baton_context_eval\'s registered capability');

  const listResponse = await request(server, 3, 'tools/call', {
    name: 'baton_decision_list', arguments: { repoId: REPO_ID, runId: 'run-a' },
  });
  assert.equal(listResponse.result.isError, false, 'observe alone must satisfy baton_decision_list\'s registered capability');

  // baton_decision_answer requires ['approve', 'observe'] per the Part A table: observe alone
  // is forbidden, proving the capability entry is the real two-element array, not undefined
  // (which would refuse every principal, including one holding both).
  const forbidden = await request(server, 4, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-1', runId: 'run-a', requestId: 'req-1', answer: { optionId: 'opt-a' } },
  });
  assert.equal(forbidden.result.isError, true);
  assert.match(forbidden.result.content[0].text, /forbidden/);

  const authorized = setup({ principal: principal({ capabilities: ['observe', 'approve'] }) });
  await initialized(authorized.server);
  const answered = await request(authorized.server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-2', runId: 'run-a', requestId: 'req-1', answer: { optionId: 'opt-a' } },
  });
  assert.equal(answered.result.isError, false);
});

test('Registration: STATEFUL reflex tools admit through the ledger and replay the admitted outcome (R2)', async () => {
  const { server, coordination, contextEvalCalls } = setup();
  await initialized(server);
  const args = { repoId: REPO_ID, idempotencyKey: 'ctx-replay', runId: 'run-a', program: { schemaVersion: 1 } };
  const first = await request(server, 2, 'tools/call', { name: 'baton_context_eval', arguments: args });
  assert.equal(first.result.isError, false);
  const admitted = coordination.events().filter((event) => event.kind === 'mcp.call_admitted');
  assert.deepEqual(admitted.map((event) => [event.payload.tool, event.payload.runId]), [['baton_context_eval', 'run-a']]);
  const replay = await request(server, 3, 'tools/call', { name: 'baton_context_eval', arguments: args });
  assert.deepEqual(replay.result, first.result);
  assert.equal(contextEvalCalls.length, 1, 'replay must never re-dispatch to application.contextEval');
});

test('Registration: read-only baton_decision_list takes the observe path — no ledger admission event', async () => {
  const { server, coordination } = setup();
  await initialized(server);
  const before = coordination.events().filter((event) => event.kind === 'mcp.call_admitted').length;
  const response = await request(server, 2, 'tools/call', { name: 'baton_decision_list', arguments: { repoId: REPO_ID, runId: 'run-a' } });
  assert.equal(response.result.isError, false);
  const after = coordination.events().filter((event) => event.kind === 'mcp.call_admitted').length;
  assert.equal(after, before, 'observe path must never admit an mcp.call ledger event');
});

// ---------------------------------------------------------------------------------------------
// Part H "Inventory": phase16 counts extended in the same commit — asserted here too, against
// the live tool table shape (names verbatim, taskSupport forbidden, additionalProperties false,
// _meta present on reflex tools). phase67 ordinary-surface and phase72 bridge assertions unchanged.
// ---------------------------------------------------------------------------------------------

test('Inventory: the combined surface adds the derived S-3 reflex tools, frozen and _meta-stamped like the ordinary table', async () => {
  const { server } = setup();
  await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  const names = response.result.tools.map((tool) => tool.name);
  // MCP-W1/W2 (v1.0.1 adjudication): the ordinary surface gains the wave ergonomics, doctor,
  // decision.answer, and the four settlement tools (10 additions); decision.answer moves OUT of
  // the reflex inventory, and the three settlement rows leave the S-3 matrix (ordinary tools).
  assert.equal(names.length, 78, '64 ordinary/advanced tools + 14 legacy-and-S-3 reflex tools');
  const reflexNames = [
    'baton_context_eval', 'baton_decision_list',
    'baton_board_post', 'baton_board_retitle', 'baton_board_reorder', 'baton_board_close', 'baton_board_drop', 'baton_board_read',
    'baton_package_admit', 'baton_package_attach', 'baton_package_read',
    'baton_repl_cite', 'baton_knowledge_recall', 'baton_knowledge_horizon',
  ];
  for (const name of reflexNames) assert.ok(names.includes(name), `${name} must be listed`);
  const reflexTools = response.result.tools.filter((tool) => reflexNames.includes(tool.name));
  assert.equal(reflexTools.length, 14);
  for (const tool of reflexTools) {
    assert.equal(tool.execution.taskSupport, 'forbidden', `${tool.name} taskSupport`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} additionalProperties`);
    assert.ok(tool.name.startsWith('baton_'), `${tool.name} is baton_*-named`);
    assert.ok(tool._meta && typeof tool._meta['baton/registryDigest'] === 'string', `${tool.name} carries _meta.baton/registryDigest`);
  }
  assert.equal(response.result.tools.every((tool) => tool.inputSchema.additionalProperties === false), true, 'the combined list stays _meta-consistent across every tool (R11)');
});

test('Inventory: the ordinary (Web-bridge) surface admits exactly the MCP-W1/W2 members — no other reflex tool crosses', async () => {
  const { server } = setup({ surface: 'application' });
  await initialized(server);
  const response = await request(server, 2, 'tools/list', {});
  // MCP-W1/W2 (v1.0.1 adjudication): waves.start/progress/send/stop, deployment.doctor,
  // decision.answer, and the four settlement tools join the ordinary surface; no other reflex
  // tool crosses. M4b: the canonical grammar tools render beside the retained legacy tools.
  assert.equal(response.result.tools.length, 27);
  assert.deepEqual(response.result.tools.map((tool) => tool.name), [
    'baton_help', 'baton_runs', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
    'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
    'baton_run_act', 'baton_run_stop', 'baton_waves_attach',
    'baton_waves_start', 'baton_waves_progress', 'baton_waves_send', 'baton_waves_stop',
    'baton_deployment_doctor', 'baton_decision_answer',
    'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote', 'baton_knowledge_settlement_lease',
    'baton_run_do', 'baton_run_view', 'baton_run_member_view', 'baton_run_member_send',
    'baton_run_member_stop', 'baton_application_help',
  ]);
});

test('Inventory: the advanced-only surface (no application facade) is unaffected by the reflex table', () => {
  const directory = root();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const server = new McpFleetServer({
    coordinator: {}, coordination, principal: principal(), repoIds: [REPO_ID], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 64 * 1024, takeToolQuota: async () => ({ ok: true }),
  });
  assert.equal(server.surface, 'advanced');
  assert.equal(server.toolDefinitions.length, 19);
  assert.equal(server.toolDefinitions.some((tool) => tool.name.startsWith('baton_')), false);
});

// ---------------------------------------------------------------------------------------------
// Part B: baton_context_eval — strip repoId/idempotencyKey, exactly-one-of, pure refusal typed,
// projection returned, cell citable cell:<digest>.
// ---------------------------------------------------------------------------------------------

test('context_eval: repoId and idempotencyKey never reach application.contextEval\'s request', async () => {
  const { server, contextEvalCalls } = setup();
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-strip', runId: 'run-a', role: 'critic', program: { schemaVersion: 1 } },
  });
  assert.equal(response.result.isError, false);
  assert.equal(contextEvalCalls.length, 1);
  const { request: forwarded } = contextEvalCalls[0];
  assert.deepEqual(Object.keys(forwarded).sort(), ['program', 'role', 'runId']);
  assert.equal(Object.hasOwn(forwarded, 'repoId'), false);
  assert.equal(Object.hasOwn(forwarded, 'idempotencyKey'), false);
  assert.deepEqual(forwarded, { runId: 'run-a', role: 'critic', program: { schemaVersion: 1 } });
});

test('context_eval: manifestDigest alone is forwarded exactly as given, with no runId key at all', async () => {
  const { server, contextEvalCalls } = setup();
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-manifest', manifestDigest: 'a'.repeat(64), program: { schemaVersion: 1 } },
  });
  assert.equal(response.result.isError, false);
  const { request: forwarded } = contextEvalCalls[0];
  assert.equal(Object.hasOwn(forwarded, 'runId'), false);
  assert.deepEqual(forwarded, { manifestDigest: 'a'.repeat(64), program: { schemaVersion: 1 } });
});

test('context_eval: exactly-one-of runId/manifestDigest is enforced by the method and surfaces as the typed application_context_eval_invalid code (never command_outcome_unknown)', async () => {
  const { server } = setup();
  await initialized(server);
  const neither = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-neither', program: { schemaVersion: 1 } },
  });
  assert.equal(neither.result.isError, true);
  assert.match(neither.result.content[0].text, /application_context_eval_invalid/);
  assert.equal(neither.result.content[0].text.includes('command_outcome_unknown'), false);
});

test('context_eval: a pure-refusal error (application_context_effect_forbidden) reaches the caller typed, never as command_outcome_unknown', async () => {
  const { server } = setup({
    applicationOverrides: {
      contextEval() { throw Object.assign(new Error('effect forbidden'), { code: 'application_context_effect_forbidden' }); },
    },
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-effect', runId: 'run-a', program: { schemaVersion: 1 } },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /application_context_effect_forbidden/);
});

test('context_eval: the method\'s projection is returned unchanged and its cell is citable by cell:<digest>', async () => {
  const cellId = `cell:${'b'.repeat(64)}`;
  const { server } = setup({
    applicationOverrides: {
      contextEval() { return { item: { id: cellId, value: { kind: 'cell', output: { items: [] } } } }; },
    },
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-cell', runId: 'run-a', program: { schemaVersion: 1 } },
  });
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.item.id, cellId);
  assert.match(response.result.structuredContent.item.id, /^cell:[a-f0-9]{64}$/u);
});

test('context_eval: unregistered tool identity would refuse forbidden even for a fully-capable principal — negative control proving the CAPABILITY table above is load-bearing', async () => {
  const { server } = setup({ principal: principal({ capabilities: [] }) });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_context_eval',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ctx-noauth', runId: 'run-a', program: { schemaVersion: 1 } },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /forbidden/);
});

// ---------------------------------------------------------------------------------------------
// Part C: baton_decision_list / baton_decision_answer.
// ---------------------------------------------------------------------------------------------

test('decision_list: a pending decision is returned sanitized and bounded; no runId match means empty, not an error', async () => {
  const decision = {
    kind: 'answer_decision', workerId: 'worker-1', requestId: 'decision-1',
    question: 'which section should this cover?',
    options: [{ id: 'opt-a', label: 'Option A', summary: null }],
    allowFreeResponse: true, recommended: null,
  };
  const { server, decisionListCalls } = setup({
    applicationOverrides: { decisionList(req) { return { decisions: req.runId === 'run-a' ? [decision] : [] }; } },
  });
  await initialized(server);
  const withPending = await request(server, 2, 'tools/call', { name: 'baton_decision_list', arguments: { repoId: REPO_ID, runId: 'run-a' } });
  assert.equal(withPending.result.isError, false);
  assert.deepEqual(withPending.result.structuredContent.decisions, [decision]);
  const empty = await request(server, 3, 'tools/call', { name: 'baton_decision_list', arguments: { repoId: REPO_ID, runId: 'run-b' } });
  assert.deepEqual(empty.result.structuredContent.decisions, []);
  assert.deepEqual(decisionListCalls.map((call) => call.request), [{ runId: 'run-a' }, { runId: 'run-b' }]);
});

test('decision_answer: {optionId} is dispatched to run.answer unchanged and can settle', async () => {
  const { server, commandCalls } = setup({
    applicationOverrides: {
      command(name, args) { return { schemaVersion: 1, runId: args.runId, phase: 'running', action: { command: 'run.answer', result: 'decision.settled' } }; },
    },
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-option', runId: 'run-a', requestId: 'decision-1', answer: { optionId: 'opt-a' } },
  });
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.action.result, 'decision.settled');
  assert.equal(commandCalls.at(-1).name, 'run.answer');
  assert.deepEqual(commandCalls.at(-1).args, { runId: 'run-a', requestId: 'decision-1', answer: { optionId: 'opt-a' } });
});

test('decision_answer: {text} free-response is also dispatched to run.answer unchanged', async () => {
  const { server, commandCalls } = setup();
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-text', runId: 'run-a', requestId: 'decision-1', answer: { text: 'a free-response answer' } },
  });
  assert.equal(response.result.isError, false);
  assert.deepEqual(commandCalls.at(-1).args.answer, { text: 'a free-response answer' });
});

test('decision_answer: {decision:"allow"} is refused invalid_arguments BEFORE hub dispatch — application.command is never called (R6)', async () => {
  const { server, commandCalls } = setup();
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-decision', runId: 'run-a', requestId: 'decision-1', answer: { decision: 'allow' } },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /invalid_arguments/);
  assert.equal(commandCalls.length, 0, 'the pre-dispatch guard must refuse before application.command is ever reached');
});

test('decision_answer: an unrecognized or multi-key answer shape is refused invalid_arguments the same way', async () => {
  const { server, commandCalls } = setup();
  await initialized(server);
  const cases = [{}, { optionId: 'opt-a', text: 'both' }, { unknownKey: 'x' }];
  for (const [index, answer] of cases.entries()) {
    const response = await request(server, 2, 'tools/call', {
      name: 'baton_decision_answer',
      arguments: { repoId: REPO_ID, idempotencyKey: `ans-bad-${index}`, runId: 'run-a', requestId: 'decision-1', answer },
    });
    assert.equal(response.result.isError, true, JSON.stringify(answer));
    assert.match(response.result.content[0].text, /invalid_arguments/);
  }
  assert.equal(commandCalls.length, 0);
});

test('decision_answer: {optionId} against a question-kind interaction stays pending — application_answer_kind_mismatch reaches the caller typed, never settled', async () => {
  const { server } = setup({
    applicationOverrides: {
      command() { throw Object.assign(new Error('kind mismatch'), { code: 'application_answer_kind_mismatch' }); },
    },
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-mismatch', runId: 'run-a', requestId: 'question-1', answer: { optionId: 'opt-a' } },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /application_answer_kind_mismatch/);
});

test('decision_answer: idempotent replay never re-dispatches to run.answer (R2)', async () => {
  const { server, commandCalls } = setup();
  await initialized(server);
  const args = { repoId: REPO_ID, idempotencyKey: 'ans-replay', runId: 'run-a', requestId: 'decision-1', answer: { optionId: 'opt-a' } };
  const first = await request(server, 2, 'tools/call', { name: 'baton_decision_answer', arguments: args });
  const replay = await request(server, 3, 'tools/call', { name: 'baton_decision_answer', arguments: args });
  assert.deepEqual(replay.result, first.result);
  assert.equal(commandCalls.length, 1);
});

test('decision_answer: the generic run.answer branch\'s lease/sessionAuthority passthrough is reused verbatim — capabilityAuthority and capabilities always accompany the context', async () => {
  const { server, commandCalls } = setup();
  await initialized(server);
  await request(server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: { repoId: REPO_ID, idempotencyKey: 'ans-context', runId: 'run-a', requestId: 'decision-1', answer: { optionId: 'opt-a' } },
  });
  const { context } = commandCalls.at(-1);
  assert.equal(context.transport, 'mcp');
  assert.match(context.idempotencyKey, /^mcp\.call:[0-9a-f-]+$/);
  assert.ok(context.capabilityAuthority);
  assert.deepEqual(context.capabilities, principal().capabilities);
  assert.equal(Object.hasOwn(context, 'sessionAuthority'), false, 'no lease exists for this session, so no sessionAuthority is fabricated');
});

// ---------------------------------------------------------------------------------------------
// Part G / Part H "bridge": no reflex tools on the Web bridge; ordinary names still served.
// ---------------------------------------------------------------------------------------------

test('bridge boundary: an ordinary-surface (Web-bridge shaped) server refuses every reflex-only tool name at -32602, while ordinary names still resolve', async () => {
  const { server } = setup({ surface: 'application' });
  await initialized(server);
  // baton_decision_answer is now an ADMITTED ordinary member (MCP-W1); the reflex-only names
  // that must not cross are context_eval + the matrix reflex rows.
  for (const name of ['baton_context_eval', 'baton_decision_list']) {
    const response = await request(server, 2, 'tools/call', { name, arguments: { repoId: REPO_ID } });
    assert.equal(response.error?.code, -32602, `${name} must be an unknown tool on the ordinary surface`);
  }
  const ordinary = await request(server, 3, 'tools/call', { name: 'baton_help', arguments: { repoId: REPO_ID } });
  assert.equal(ordinary.error, undefined);
  assert.equal(ordinary.result.isError, false, 'ordinary names must still resolve on the same surface');
});
