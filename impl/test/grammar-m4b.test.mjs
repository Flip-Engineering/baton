import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY,
  CoordinationStore,
  McpFleetServer,
} from '../src/index.mjs';
import { collectSurfaceInventory } from '../scripts/surface-audit.mjs';
import {
  KERNEL_AUTHORING_WEB_LITERALS,
  canonicalizeSerialization,
  checkWebNameDisjoint,
  deriveSurfaceNames,
  serializationOrderViolations,
} from '../scripts/surface-conformance.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

// docs/36 §9 M4 second slice (M4b — the transport flip). These are the M4b acceptance contracts:
// the last breaking-surface phase renders the Web and MCP transports from registry v2,
// admits canonical names beside the retained legacy names (both reaching one operation, the
// admitted identity being the spelling used), and cuts the C8 serialization pin — all at a fixed
// clock.

const NOW = Date.parse('2026-07-24T12:00:00.000Z');
const REGISTRY = APPLICATION_SEMANTIC_REGISTRY;

// ── MCP transport harness ────────────────────────────────────────────────────────────────────
function mcpFixture() {
  const applicationCalls = [];
  const application = {
    repoId: 'repo-a',
    card: () => ({ schemaVersion: 1, repoId: 'repo-a', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args) {
      applicationCalls.push({ name, args });
      return { schemaVersion: 1, operation: name, arguments: args };
    },
  };
  const coordination = new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-m4b-mcp-')), 'c'), {
    clock: () => new Date(NOW).toISOString(),
  });
  const server = new McpFleetServer({
    coordinator: { async wait() { return { events: [], cursor: 0, more: false }; } },
    coordination, application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: ['repo-a'], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  return { server, applicationCalls };
}
const mcpRequest = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function mcpInitialized(server) {
  await mcpRequest(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

test('M4B-3: a canonical MCP tool executes beside the legacy tool, reaching one operation', async () => {
  const { server, applicationCalls } = mcpFixture();
  await mcpInitialized(server);
  const listed = await mcpRequest(server, 2, 'tools/list', {});
  const names = listed.result.tools.map((tool) => tool.name);
  // Canonical appears BESIDE the retained legacy tool.
  assert.ok(names.includes('baton_run_view'), 'canonical baton_run_view listed');
  assert.ok(names.includes('baton_run_inspect'), 'legacy baton_run_inspect retained');
  assert.equal(deriveSurfaceNames('run.view').mcp, 'baton_run_view');

  const args = { repoId: 'repo-a', runId: 'run-mcp-a', depth: 'outline' };
  const canonical = await mcpRequest(server, 3, 'tools/call', { name: 'baton_run_view', arguments: args });
  const legacy = await mcpRequest(server, 4, 'tools/call', { name: 'baton_run_inspect', arguments: args });
  assert.equal(canonical.result.isError, false);
  assert.equal(legacy.result.isError, false);
  // Both spellings reach the one application command run.inspect with identical args.
  assert.deepEqual(applicationCalls.map((call) => call.name), ['run.inspect', 'run.inspect']);
  assert.deepEqual(applicationCalls[0].args, applicationCalls[1].args);
});

test('M4B-4: the C8 canonical serialization order holds and a scrambled emitter is caught', () => {
  const order = REGISTRY.serializationOrder;
  const scrambled = {
    origin: 'https://c.test', command: 'run_do', args: {}, schemaVersion: 1,
    repoId: 'repo-a', idempotencyKey: 'k', commandId: 'c', runId: 'r',
  };
  const normalized = canonicalizeSerialization(order.envelope, scrambled);
  // The normalization emits the pinned keys leading, in the registry-pinned order.
  assert.deepEqual(Object.keys(normalized).slice(0, 4), ['schemaVersion', 'commandId', 'idempotencyKey', 'command']);
  // Presentation only: the values (a parser's view) are byte-identical after reordering.
  assert.deepEqual(normalized, scrambled);
  // The pin HOLDS for the normalized emit; the scrambled emitter is CAUGHT.
  assert.deepEqual(serializationOrderViolations(order.envelope, normalized), []);
  assert.equal(serializationOrderViolations(order.envelope, scrambled).length, 1);
  // The registry-owned nested `do`/action coordinate pins likewise; a scrambled coordinate is caught.
  assert.equal(serializationOrderViolations(order.action, { actionId: 'a', kind: 'approve_plan' }).length, 1);
  assert.deepEqual(serializationOrderViolations(order.action, { kind: 'approve_plan', actionId: 'a' }), []);
});

test('M4B-6: the canonical transport names are present, mechanically derived from the registry', () => {
  // The new canonical names are present: every canonical operation's mechanically derived
  // transport names are live registry data, and the web set stays disjoint from kernel/authoring.
  for (const key of ['run.do', 'run.view', 'run.member.view']) {
    const operation = REGISTRY.canonicalOperations.find((entry) => entry.key === key);
    assert.deepEqual(operation.names, deriveSurfaceNames(key));
  }
  assert.deepEqual(checkWebNameDisjoint(), []);
});

test('M4B-7: the kernel and authoring surface tables are byte-unchanged (C9 stays green)', async () => {
  const inventory = collectSurfaceInventory();
  // The fleet_* kernel tool table is exactly the closed nineteen (unchanged by the ordinary flip).
  const { server } = mcpFixture();
  const advanced = new McpFleetServer({
    coordinator: { async wait() { return { events: [], cursor: 0, more: false }; } },
    coordination: new CoordinationStore(join(mkdtempSync(join(tmpdir(), 'baton-m4b-adv-')), 'c'), {
      clock: () => new Date(NOW).toISOString(),
    }),
    surface: 'advanced',
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: ['repo-a'], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  await mcpInitialized(server);
  await mcpInitialized(advanced);
  const fleetTools = (await mcpRequest(advanced, 2, 'tools/list', {})).result.tools.map((tool) => tool.name);
  assert.deepEqual(fleetTools, [
    'fleet_spawn', 'fleet_scratch_oracle', 'fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve',
    'fleet_goal_plan_status', 'fleet_send', 'fleet_wait', 'fleet_respond', 'fleet_interrupt', 'fleet_result',
    'fleet_list', 'fleet_capabilities', 'fleet_provider_status', 'fleet_capability_invoke', 'fleet_reuse_decide',
    'fleet_reuse_recheck', 'fleet_kill', 'fleet_drain',
  ]);

  // The kernel/authoring Web literals stay admitted, unchanged, on the Web bus.
  for (const literal of KERNEL_AUTHORING_WEB_LITERALS) {
    assert.ok(inventory.webCommands.includes(literal), `web literal ${literal} unchanged`);
  }
  // C9: no derived grammar web name collides with a kernel/authoring literal.
  assert.deepEqual(checkWebNameDisjoint(), []);
});
