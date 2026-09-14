// The resident MCP bridge (baton-mcp-web) advertises the registry's tools but used to forward only
// a hand-kept list of run.* commands: every other advertised tool — the whole swarm family — came
// back as a bare `forbidden` (found by the 2026-09-14 suborchestrated-swarm communication audit).
// #227 named the resident's wire card as the authority; these tests pin that the facade admits
// what the card advertises, refuses what it does not by NAME, and that the MCP server's own
// refusals name the field or the missing capability instead of a bare code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { BatonWebClient } from '../src/application-cli.mjs';
import { BatonWebApplicationFacade } from '../src/mcp-web-bridge.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';

const REPO_ID = 'repo-bridge-admission';
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: { userId: 'bridge-user', sessionId: 'bridge-session', capabilities: ['observe', 'control'], repoIds: [REPO_ID] },
  expiresAt: '2099-01-01T00:00:00.000Z',
});
const PRINCIPAL = Object.freeze({ actor: 'mcp:bridge-user:bridge-session', principalId: 'bridge-user', sessionId: 'bridge-session' });
const CONTEXT = Object.freeze({ transport: 'mcp', requestId: '1', idempotencyKey: 'mcp.call:1' });
// The wire card as the resident composes it: the web-admitted command names (the same export the
// wire-card coverage pin reads) plus the swarm family the resident admits.
const WIRE_CARD = Object.freeze([...new Set([...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS)])]);

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

test('the bridge forwards every command the wire card advertises, the swarm family included', async () => {
  const swarmCommands = Object.keys(SWARM_COMMAND_DEFINITIONS);
  assert.ok(swarmCommands.includes('swarm.list') && swarmCommands.includes('swarm.guide'), 'the swarm family is a registry family');
  assert.ok(swarmCommands.every((command) => WIRE_CARD.includes(command)), 'the resident wire card advertises the swarm family');
  const { facade, forwarded } = facadeWith(WIRE_CARD);
  const listed = await facade.command('swarm.list', {}, PRINCIPAL, CONTEXT);
  assert.deepEqual(listed, { ok: true, command: 'swarm.list' });
  await facade.command('swarm.guide', { swarmId: 's', participantId: 'p', message: 'go' }, PRINCIPAL, { ...CONTEXT, requestId: '2', idempotencyKey: 'mcp.call:2' });
  assert.deepEqual(forwarded.map((row) => row.name), ['swarm.list', 'swarm.guide']);
  assert.notEqual(forwarded[0].key, forwarded[1].key, 'each bridged call carries its own derived idempotency key');
});

test('a command the wire card does not advertise is refused by name, never as a bare forbidden', async () => {
  const { facade, forwarded } = facadeWith(WIRE_CARD.filter((command) => !command.startsWith('swarm.')));
  await assert.rejects(facade.command('swarm.list', {}, PRINCIPAL, CONTEXT), (error) => {
    assert.equal(error.code, 'application_unauthorized');
    assert.match(error.message, /swarm\.list is not admitted by the resident wire card/u);
    assert.deepEqual(error.detail, { command: 'swarm.list', admitted: false });
    return true;
  });
  await assert.rejects(facade.command('application.shutdown', {}, PRINCIPAL, CONTEXT), (error) => {
    assert.equal(error.code, 'application_unauthorized');
    assert.match(error.message, /application\.shutdown is not admitted/u, 'shutdown is host-side lifecycle and is never proxied');
    return true;
  });
  assert.equal(forwarded.length, 0, 'a refused command never reaches the wire');
});

function server(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-bridge-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const NOW = Date.parse('2026-09-14T00:00:00.000Z');
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async actionAuthority() { return { schemaVersion: 1, actionId: 'a', kind: 'stop', effect: 'run_stop', requiredCapabilities: ['emergency_stop'], authorityDigest: 'x' }; },
    async command(name) { return { schemaVersion: 1, command: name }; },
    async contextEval() { throw new Error('unused'); },
    async decisionList() { return { decisions: [] }; },
  };
  return new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
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

test('a server given an admission predicate advertises only the tools whose command it admits', async (t) => {
  const mcp = server(t, { admitsCommand: (command) => command !== 'scratchpad.elevate' });
  await ready(mcp);
  const listed = await request(mcp, 'l1', 'tools/list', {});
  const names = listed.result.tools.map((tool) => tool.name);
  assert.equal(names.includes('baton_scratchpad_elevate'), false, 'the tool whose command is refused is not advertised');
  assert.ok(names.includes('baton_swarm_view'), 'admitted tools stay advertised');
  const everything = server(t);
  await ready(everything);
  assert.ok((await request(everything, 'l2', 'tools/list', {})).result.tools.map((tool) => tool.name).includes('baton_scratchpad_elevate'), 'without a predicate the surface inventory is unchanged');
});

test('the resident wire card keeps the host-local settlement tools off the bridge, by their own commands', () => {
  const { facade } = facadeWith(WIRE_CARD);
  for (const command of ['scratchpad.elevate', 'scratchpad.settle', 'knowledge.settlement_lease']) {
    assert.equal(facade._admits(command), false, `${command} is host-local`);
  }
  assert.equal(facade._admits('swarm.recruit'), true);
});

test('on a bound surface a supplied idempotencyKey is refused by field name, not as a bare invalid_arguments', async (t) => {
  const mcp = server(t, { bindApplicationContext: true });
  await ready(mcp);
  const response = await request(mcp, 'c1', 'tools/call', { name: 'baton_swarm_view', arguments: { swarmId: 's', idempotencyKey: 'k' } });
  const error = response.result.structuredContent.error;
  assert.equal(error.code, 'invalid_arguments');
  assert.equal(error.field, 'idempotencyKey');
  assert.match(error.message, /idempotencyKey is bound by the server on this surface and must not be supplied/u);
  assert.deepEqual(error.detail, { boundFields: ['idempotencyKey'] });
});

// U-F2/U-I12 (issue #288): a refusal that crosses the resident bridge arrives through the CLI
// client's typed-error path (cliError marks its COMPOSED text wireSafe; the wire error rides as
// detail, its field is lifted), so laneCraftedToolError keeps the whole refusal on the MCP wire
// instead of flattening it to a bare code. Before the flag, BOTH cases below arrived as
// `{code}` only — the forbidden one as `command_outcome_unknown`.
function bridgeServer(t, fetchImpl) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-bridge-refusal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const NOW = Date.parse('2026-09-14T00:00:00.000Z');
  const card = { repoId: REPO_ID, commands: [...webAdmittedCommandNames()] };
  const client = new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: 'https://baton.local/', repoId: REPO_ID, token: 'bridge-refusals-token',
    commandTimeoutMs: 5_000, pollMs: 10, fetchImpl, clock: () => NOW, sleep: async () => {},
  });
  const facade = new BatonWebApplicationFacade(client, card, SESSION);
  return new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application: facade, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'bridge-user', sessionId: 'bridge-session', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
    admitsCommand: (command) => command !== 'application.shutdown' && card.commands.includes(command),
  });
}
const sessionDocument = () => new Response(
  JSON.stringify({ ok: true, expiresAt: SESSION.expiresAt, identity: SESSION.identity }),
  { status: 200 },
  );

test('a resident refusal that flattens to command_outcome_unknown still carries its message and detail over the bridge', async (t) => {
  const wireError = { code: 'forbidden', message: 'this principal lacks the emergency_stop capability the action requires' };
  let sessionServed = false;
  const mcp = bridgeServer(t, async (url) => (
    String(url).endsWith('/v1/session') && !sessionServed && (sessionServed = true)
  ) ? sessionDocument() : new Response(JSON.stringify({ ok: false, error: wireError }), { status: 403 }));
  await ready(mcp);
  const response = await request(mcp, 'f1', 'tools/call', { name: 'baton_runs', arguments: { repoId: REPO_ID } });
  const error = response.result.structuredContent.error;
  assert.equal(error.code, 'command_outcome_unknown', '`forbidden` is outside the stateFailureCode ladder — the CODE flattens, the refusal must not');
  assert.match(error.message, /Baton Web request was refused \(POST \/v1\/commands, HTTP 403\)/u);
  assert.match(error.message, /this principal lacks the emergency_stop capability the action requires/u, 'the resident message rides the bridge');
  assert.deepEqual(error.detail, wireError, 'the full parsed wire error rides as detail');
  assert.match(response.result.content[0].text, /emergency_stop/u, 'the refusal is readable in the text content an agent sees');
});

test('a typed resident refusal keeps its own code and lifted field over the bridge', async (t) => {
  const wireError = { code: 'application_inspect_oversize', message: 'the view exceeds its byte ceiling', field: 'depth' };
  let sessionServed = false;
  const mcp = bridgeServer(t, async (url) => (
    String(url).endsWith('/v1/session') && !sessionServed && (sessionServed = true)
  ) ? sessionDocument() : new Response(JSON.stringify({ ok: false, error: wireError }), { status: 413 }));
  await ready(mcp);
  const response = await request(mcp, 'f2', 'tools/call', { name: 'baton_run_view', arguments: { repoId: REPO_ID, runId: 'run:bridge' } });
  const error = response.result.structuredContent.error;
  assert.equal(error.code, 'application_inspect_oversize');
  assert.match(error.message, /the view exceeds its byte ceiling/u);
  assert.equal(error.field, 'depth', 'the resident-composed field is lifted onto the wire error');
  assert.deepEqual(error.detail, wireError);
});
