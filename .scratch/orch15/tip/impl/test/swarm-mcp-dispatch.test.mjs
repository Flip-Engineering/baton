// The ordinary baton_swarm_* MCP tools (and their canonical dot twins) dispatch the swarm.*
// application commands: an advertised swarm tool that tools/call could not resolve would be a
// surface lie. Mock application, real McpFleetServer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';
import { SWARM_MCP_TOOL_DEFINITIONS } from '../src/swarm-surface.mjs';

const NOW = Date.parse('2026-09-13T00:00:00.000Z');
const REPO_ID = 'repo-swarm-dispatch';

function fixture(t, surface = 'application') {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-mcp-dispatch-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commandCalls = [];
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      commandCalls.push({ name, args, principal, context });
      return { schemaVersion: 1, command: name, swarms: [] };
    },
    async contextEval() { throw new Error('unused'); },
    async decisionList() { return { decisions: [] }; },
  };
  const server = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application,
    surface,
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  return { server, commandCalls };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, params });

async function ready(server) {
  await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return (await request(server, 2, 'tools/list', {})).result.tools;
}

async function dispatches(t, surface, spellingOf) {
  const { server, commandCalls } = fixture(t, surface);
  const tools = await ready(server);
  let id = 3;
  for (const tool of SWARM_MCP_TOOL_DEFINITIONS) {
    const spelling = spellingOf(tool);
    const row = tools.find((entry) => entry.name === spelling);
    assert.ok(row, `${spelling} is advertised on the ${surface} surface`);
    const args = { repoId: REPO_ID, swarmId: 'swarm-1', participantId: 'reviewer', objective: 'Review the change',
      message: 'Focus on the tests', reason: 'Work complete', event: 'swarm.contribution_recorded',
      contributionId: 'contribution-1', checkId: 'check-1', purpose: 'Ship the release', idempotencyKey: `key-${id}`,
      // #296: swarm.integrate names the branch it lands onto.
      target: 'master' };
    // Only the arguments the closed tool schema declares are sent.
    const sent = Object.fromEntries(Object.entries(args).filter(([key]) => Object.hasOwn(row.inputSchema.properties, key)));
    const before = commandCalls.length;
    const response = await request(server, id++, 'tools/call', { name: spelling, arguments: sent });
    assert.equal(response.error, undefined, `${spelling}: ${JSON.stringify(response.error)}`);
    assert.notEqual(response.result.isError, true, `${spelling} refused: ${JSON.stringify(response.result.content).slice(0, 300)}`);
    assert.equal(commandCalls.length, before + 1, `${spelling} reached the application`);
    assert.equal(commandCalls.at(-1).name, tool.command, `${spelling} dispatches ${tool.command}`);
  }
}

test('every ordinary baton_swarm_* tool dispatches the swarm command it names', async (t) => {
  await dispatches(t, 'application', (tool) => tool.name);
});

test('every canonical swarm.* dot twin dispatches on the combined surface', async (t) => {
  await dispatches(t, 'combined', (tool) => tool.command);
});
