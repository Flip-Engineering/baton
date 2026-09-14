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
