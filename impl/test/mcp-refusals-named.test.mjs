// U-F1/U-I1, U-E11/U-I2 and U-F4 of the 2026-09-14 surfaces audit (issue #288): the MCP
// validator refusals name the offending or missing field, the authority gate splits the bare
// `forbidden` into a capability refusal ({required, held, missing} + sentence) and a distinct
// `repo_not_served` refusal naming the served repoId, and an unknown tool name answers a typed
// refusal (nearest advertised tool in the message, the full advertised set in the data) instead
// of a bare `-32602 Invalid params`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';

const REPO_ID = 'repo-refusals-named';
const NOW = Date.parse('2026-09-14T00:00:00.000Z');

const application = {
  repoId: REPO_ID,
  card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
  async authorizeReplay() { return true; },
  async command(name) { return { schemaVersion: 1, command: name }; },
  async decisionList() { return { decisions: [] }; },
};

function server(t, { principal = {}, surface, options = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-refusals-named-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application: surface === 'advanced' ? null : application,
    surface,
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
      ...principal,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
    ...options,
  });
}
const request = (mcp, id, method, params) => mcp.handle({ jsonrpc: '2.0', id, method, params });
async function ready(mcp) {
  await request(mcp, 'init', 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
}
const toolErrorOf = (response) => response.result.structuredContent.error;

// --- U-F1/U-I1: validateArguments refusals carry {code, message, field} ---

test('an unknown argument field is named by the refusal, not left as a bare code', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 1, 'tools/call', { name: 'baton_runs', arguments: { repoId: REPO_ID, bogus: 1 } }));
  assert.equal(error.code, 'unknown_argument_field');
  assert.equal(error.field, 'bogus');
  assert.match(error.message, /unknown argument field "bogus"/u);
});

test('a missing required argument is named by the refusal', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 2, 'tools/call', { name: 'baton_run_view', arguments: { repoId: REPO_ID } }));
  assert.equal(error.code, 'missing_argument');
  assert.equal(error.field, 'runId');
  assert.match(error.message, /missing required argument "runId"/u);
});

test('the repo and idempotency-key refusals name their field and rule', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const repoError = toolErrorOf(await request(mcp, 3, 'tools/call', { name: 'baton_runs', arguments: { repoId: 42 } }));
  assert.equal(repoError.code, 'invalid_repo');
  assert.equal(repoError.field, 'repoId');
  assert.match(repoError.message, /repoId/u);
  const keyError = toolErrorOf(await request(mcp, 4, 'tools/call', { name: 'baton_run_act', arguments: {
    repoId: REPO_ID, runId: 'run:named-refusals', actionId: 'act:named-refusals', inputs: {}, idempotencyKey: 'bad key!',
  } }));
  assert.equal(keyError.code, 'invalid_idempotency_key');
  assert.equal(keyError.field, 'idempotencyKey');
  assert.match(keyError.message, /idempotencyKey/u);
});

test('a command-contract refusal (invalid_run_command) states the rule instead of a bare code', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 5, 'tools/call', { name: 'baton_run_start', arguments: {
    repoId: REPO_ID, idempotencyKey: 'start-named-refusals',
    intent: { runId: 'run:named-refusals', objective: 'work', profile: 'standard', route: { harness: '', model: '', effort: 'high' } },
  } }));
  assert.equal(error.code, 'invalid_run_command');
  assert.match(error.message, /command contract/u);
});

test('non-object arguments refuse invalid_arguments with a rule message', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 6, 'tools/call', { name: 'baton_runs', arguments: 'nope' }));
  assert.equal(error.code, 'invalid_arguments');
  assert.match(error.message, /JSON object/u);
});

test('the answer-shape guard names the answer field and the one-of rule', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 7, 'tools/call', { name: 'baton_decision_answer', arguments: {
    repoId: REPO_ID, idempotencyKey: 'answer-named-refusals', runId: 'run:named-refusals', requestId: 'request:1',
    answer: { decision: 'allow' },
  } }));
  assert.equal(error.code, 'invalid_arguments');
  assert.equal(error.field, 'answer');
  assert.match(error.message, /optionId or text/u);
});

test('a fenced tool refusal names expectedFence', async (t) => {
  const mcp = server(t, { surface: 'advanced' });
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 8, 'tools/call', { name: 'fleet_send', arguments: {
    repoId: REPO_ID, idempotencyKey: 'fence-named-refusals', expectedFence: 'soon', workerId: 'worker:1', message: 'hi', mode: 'turn',
  } }));
  assert.equal(error.code, 'expected_fence_required');
  assert.equal(error.field, 'expectedFence');
  assert.match(error.message, /expectedFence/u);
});

// --- U-E11/U-I2: the authority gate splits capability shortfall from repo mismatch ---

test('a capability shortfall composes the required/held/missing sentence, not a bare forbidden', async (t) => {
  const mcp = server(t, { principal: { capabilities: ['control'] } });
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 9, 'tools/call', { name: 'baton_runs', arguments: { repoId: REPO_ID } }));
  assert.equal(error.code, 'forbidden');
  assert.match(error.message, /this principal lacks the observe capability the tool requires/u);
  assert.deepEqual(error.detail, { required: ['observe'], held: ['control'], missing: ['observe'] });
});

test('a repo the deployment does not serve refuses repo_not_served naming the served repoId', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 10, 'tools/call', { name: 'baton_runs', arguments: { repoId: 'repo-elsewhere' } }));
  assert.equal(error.code, 'repo_not_served');
  assert.match(error.message, /does not serve repoId "repo-elsewhere"/u);
  assert.match(error.message, new RegExp(`serves "${REPO_ID}"`, 'u'));
  assert.deepEqual(error.detail, { repoId: 'repo-elsewhere', served: [REPO_ID] });
});

test('a principal not scoped to a served repo refuses repo_not_served with the scoping sentence', async (t) => {
  const mcp = server(t, { principal: { repoIds: ['repo-principal-scope'] } });
  await ready(mcp);
  const error = toolErrorOf(await request(mcp, 11, 'tools/call', { name: 'baton_runs', arguments: { repoId: REPO_ID } }));
  assert.equal(error.code, 'repo_not_served');
  assert.match(error.message, /not scoped to repoId/u);
  assert.deepEqual(error.detail, { repoId: REPO_ID, served: [REPO_ID] });
});

// --- U-F4: an unknown tool name is a typed refusal, not a bare Invalid params ---

test('an unknown tool name answers with the nearest advertised tool and the full tool set', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const response = await request(mcp, 12, 'tools/call', { name: 'baton_run_approve', arguments: { repoId: REPO_ID } });
  assert.equal(response.error.code, -32602, 'the protocol-level code stays the tools/call unknown-tool contract');
  assert.match(response.error.message, /unknown tool baton_run_approve/u);
  assert.match(response.error.message, /nearest advertised tool is /u);
  const data = response.error.data;
  assert.equal(data.code, 'unknown_tool');
  assert.equal(data.requested, 'baton_run_approve');
  assert.ok(typeof data.nearest === 'string' && data.tools.includes(data.nearest), 'the nearest match is itself an advertised tool');
  assert.deepEqual(data.tools, [...data.tools].sort(), 'the advertised set rides sorted');
  assert.ok(data.tools.includes('baton_run_act') && data.tools.includes('baton_runs'), 'the advertised set names the tools an agent most naturally reaches for');
});

test('a near-miss tool name resolves its transposition to the real tool', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const response = await request(mcp, 13, 'tools/call', { name: 'baton_run_acty', arguments: { repoId: REPO_ID } });
  assert.equal(response.error.data.nearest, 'baton_run_act');
  assert.match(response.error.message, /nearest advertised tool is baton_run_act/u);
});

test('malformed tools/call frames keep the bare protocol refusal', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const noName = await request(mcp, 14, 'tools/call', { arguments: {} });
  assert.equal(noName.error.code, -32602);
  assert.equal(noName.error.data, undefined, 'a malformed frame is a protocol refusal, not a tool-set refusal');
});
