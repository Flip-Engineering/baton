import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY, deriveSurfaceNames } from '../src/application-semantics.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';
import * as mcpNorthbound from '../src/mcp-northbound.mjs';
import { CORE_TOOL_NAMES, ORDINARY_TOOL_NAMES } from '../src/mcp-core-tools.mjs';
import { renderMcpToolInventory } from '../scripts/render-surface-docs.mjs';
import { mockApplicationCard } from '../scripts/surface-truth.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const conformanceScript = fileURLToPath(
  new URL('../scripts/surface-conformance.mjs', import.meta.url),
);

// The fleet spelling of a bus command (D1 step 2 source derivation; D2 definition names).
const fleetName = (command) => `fleet_${command.replaceAll('.', '_')}`;

// The bus side of the parity law: the same admission map the web bus derives from (D3). The
// served side is the new mcpApplicationCommandNames() export — never a hand list. webCommands
// preserves APPLICATION_COMMAND_DEFINITIONS iteration order (the contract's `webCommands` at
// mcp-profile-parity-contract.md:110-113), so the derived uncovered set — and therefore the
// LIFECYCLE_ORDINARY_SIBLINGS order — is definition order, not sorted.
const webCommands = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.web)
  .map(([name]) => name);

// The non-canonical ops (D4 item 1): web-bus commands that are NOT canonicalOperations keys (the
// G11 9/5 split), so the rows alone cannot resolve them.
const NON_CANONICAL_OPS = ['run.status', 'run.follow', 'run.wait'];

const NOW = Date.parse('2026-08-13T00:00:00.000Z');
const REPO_ID = 'repo-profile-parity';
const MAX_WAIT_MS = 25_000;
const dirs = [];
function fixtureDir() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-profile-parity-'));
  dirs.push(directory);
  return directory;
}
test.after(() => { for (const directory of dirs) rmSync(directory, { recursive: true, force: true }); });

// The card's commands derive from the command table (surface-truth.mjs) — the McpFleetServer
// constructor validates the facade against the served entries.
const runApplicationCard = () => mockApplicationCard(REPO_ID);

function principal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a',
    capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
  };
}

function mockApplication(overrides = {}) {
  const commandCalls = [];
  const application = {
    repoId: REPO_ID,
    card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      commandCalls.push({ name, args, principal: appPrincipal, context });
      if (overrides.command) return overrides.command(name, args, appPrincipal, context);
      return { schemaVersion: 1, runId: args?.runId ?? null, phase: 'running' };
    },
  };
  return { application, commandCalls };
}

function setup(overrides = {}) {
  const directory = overrides.directory ?? fixtureDir();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const { application, commandCalls } = overrides.applicationBundle
    ?? mockApplication(overrides.applicationOverrides ?? {});
  const server = new McpFleetServer({
    coordinator: overrides.coordinator ?? {},
    coordination,
    application,
    surface: overrides.surface ?? 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: overrides.principal ?? principal(),
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: MAX_WAIT_MS,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (async () => ({ ok: true })),
  });
  return { server, coordination, application, commandCalls, directory };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

// Set equality in ACTUAL sorted order (localeCompare banned, per the suite law). The pinned test
// sites and the live tools/list are in the definition order; mcpApplicationToolNames() is sorted.
const sortedSet = (list) => [...new Set(list)].sort();

// ── RG-01 — the two exports land (D1 step 1 / D3) ─────────────────────────────────────────────

test('RG-01 RED: mcpApplicationCommandNames and mcpApplicationDispatch are exported (stage: served-set export)', () => {
  assert.equal(typeof mcpNorthbound.mcpApplicationCommandNames, 'function',
    'mcpApplicationCommandNames export exists (stage: served-set export)');
  assert.equal(typeof mcpNorthbound.mcpApplicationDispatch, 'function',
    'mcpApplicationDispatch export exists (stage: dispatch-map export)');
  const served = mcpNorthbound.mcpApplicationCommandNames();
  assert.deepEqual(served, [...served].sort(), 'served command set is ACTUAL sorted order');
  assert.deepEqual(served, [...new Set(served)], 'served command set is duplicate-free');
  // Fold (blue-team #2 on RG-01 — SHALLOW): the served-set CONTENT is pinned — every web-bus
  // command is a served application command (the one-directional D3 superset law). A wrong impl
  // returning any sorted dedup set that omits a web command now fails. (The one-directional law
  // legitimately admits MCP-only extras — bus ⊆ application, never equality — so "garbage extras"
  // remain in the law's shadow, recorded as a judgment call in the fold notes.)
  // Issue #566 composition: the lifecycle commands reach the bus through the DISPATCH MAP's
  // canonical spellings (fleet dot twins), not minted ordinary rows — coverage is read from the
  // map (keys ∪ values), never from the ordinary table alone.
  const dispatch = mcpNorthbound.mcpApplicationDispatch();
  const reachable = new Set([...served, ...Object.keys(dispatch), ...Object.values(dispatch)]);
  const missing = webCommands.filter((command) => !reachable.has(command));
  assert.deepEqual(missing, [], 'served command set covers every web-bus command (stage: served-set-covers-web)');
  assert.equal(Object.isFrozen(dispatch), true, 'dispatch map is frozen');
});

// ── RG-02 — the application profile tools/list closure (D1) ───────────────────────────────────

test('RG-02 RED: application tools/list is the served ordinary table and includes every pre-spread-uncovered sibling (stage: application-tools-count-49)', async () => {
  const { server } = setup({ surface: 'application' });
  await initialized(server);
  const names = (await request(server, 2, 'tools/list', {})).result.tools.map((tool) => tool.name);
  assert.equal(names.length, 51, 'application tools/list count 51 (stage: application-tools-count-49)'); // composition (#566 restore): the served ordinary table over the #317-pin ordinary rows, the #99/#179 harvest pair and the #233 canonical dot twins
  // Fold (blue-team #2/#4 — SHALLOW/vacuity): the count ties to the restored composition, so a
  // bare count of arbitrary self-consistent names cannot pass: the #233 canonical dot twins of the
  // retained legacy tools are advertised (the twin closure), and the registry-operation direct
  // ports (the harvest pair) ride beside them.
  assert.equal(typeof mcpNorthbound.uncoveredCommands, 'function',
    'uncoveredCommands export exists (stage: uncovered-set-export)');
  const twinTools = ['baton_run_do', 'baton_run_view', 'baton_run_member_view', 'baton_application_help'];
  const missingTwins = twinTools.filter((tool) => !names.includes(tool));
  assert.deepEqual(missingTwins, [],
    'every #233 canonical dot twin of the retained legacy tools is advertised (stage: application-tools-include-canonical-twins)');
  assert.deepEqual(sortedSet(names), mcpNorthbound.mcpApplicationToolNames(),
    'tools/list set equals mcpApplicationToolNames() (ACTUAL sorted order)');
});

// ── RG-03 — the D3 parity derivation, per op, no hand list (D3) ────────────────────────────────

test('RG-03 RE-DERIVED (#566): the D3 parity derivation reports no uncovered web-bus command (stage: uncovered-set-empty)', () => {
  assert.equal(typeof mcpNorthbound.mcpApplicationCommandNames, 'function',
    'mcpApplicationCommandNames export exists (stage: served-set export)');
  // Issue #566 composition: the lifecycle commands are covered by the DISPATCH MAP's canonical
  // spellings (fleet dot twins), never by minted ordinary rows — the D3 law reads the map.
  const dispatch = mcpNorthbound.mcpApplicationDispatch();
  const reachable = new Set([...Object.keys(dispatch), ...Object.values(dispatch)]);
  const uncovered = webCommands.filter((command) => !reachable.has(command));
  assert.deepEqual(uncovered, [], 'every web-bus command is a served application command (stage: uncovered-set-empty)');

});

// ── RG-05 — the dispatch binding (D1 step 1 / D3 third pin) ────────────────────────────────────
test('RG-05 RE-DERIVED (#566): every uncovered bus command is bound by its canonical spelling in the dispatch map (stage: dispatch-binds-siblings)', () => {
  assert.equal(typeof mcpNorthbound.mcpApplicationDispatch, 'function',
    'mcpApplicationDispatch export exists (stage: dispatch-map export)');
  const dispatch = mcpNorthbound.mcpApplicationDispatch();
  assert.equal(Object.isFrozen(dispatch), true, 'dispatch map is frozen');
  // Fold (blue-team #2 — vacuity): the binding force derives from the pre-spread
  // uncoveredCommands() export. #566: the binding spelling is the CANONICAL command name (the
  // fleet dot twin), not a minted baton_run_* sibling — the map binds command → command.
  assert.equal(typeof mcpNorthbound.uncoveredCommands, 'function',
    'uncoveredCommands export exists (stage: uncovered-set-export)');
  const uncovered = mcpNorthbound.uncoveredCommands();
  const unbound = uncovered.filter((command) => dispatch[command] !== command);
  assert.deepEqual(unbound, [],
    'each uncovered lifecycle op\'s canonical spelling dispatches to its bus command through APPLICATION_TOOL (stage: dispatch-binds-siblings)');
});

// ── RG-06 — the schema-inheritance claim (M4b, D1 registration spread 3) ───────────────────────

test('RG-06 RE-DERIVED (#566): the #233 canonical dot twins byte-inherit their legacy source\u2019s wire schema and carry the spelling note (stage: sibling-schema-inherits-source)', async () => {
  const { server } = setup({ surface: 'combined' });
  await initialized(server);
  const tools = (await request(server, 2, 'tools/list', {})).result.tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  // Issue #566 composition: the schema-inheritance claim moves from the retired mint to the
  // #233 canonical dot twins — each twin spreads its legacy tool's definition through the ONE
  // seam (withSpellingNote), so the wire schema and annotations byte-equal the source row.
  const pairs = [
    ['baton_run_do', 'baton_run_act'],
    ['baton_run_view', 'baton_run_inspect'],
    ['baton_run_member_view', 'baton_run_workstreams'],
    ['baton_application_help', 'baton_help'],
  ];
  const missingSource = pairs.filter(([, legacy]) => !byName.has(legacy));
  assert.deepEqual(missingSource, [],
    'every legacy source row is served on the combined surface (stage: inherited-source-set)');
  for (const [twin, legacy] of pairs) {
    const sibling = byName.get(twin);
    const source = byName.get(legacy);
    assert.ok(sibling, `${twin} is advertised on the combined surface`);
    assert.deepEqual(sibling.inputSchema, source.inputSchema, `${twin} wire schema byte-equals ${legacy}'s`);
    assert.deepEqual(sibling.annotations, source.annotations, `${twin} annotations inherit ${legacy}'s`);
    assert.equal(sibling.execution.taskSupport, 'forbidden', `${twin} execution.taskSupport is forbidden`);
    assert.equal(typeof sibling._meta?.['baton/registryDigest'], 'string', `${twin} carries _meta['baton/registryDigest']`);
  }
});

// ── RG-07 — the wait/follow sibling bound (D1 item 4) ──────────────────────────────────────────

test('RG-07 RED: the wait/follow sibling list admits the siblings and invalid_run_wait bounds (stage: wait-follow-lists-admit-siblings)', async () => {
  // Gate A — validateArguments bound (D1 item 4, :954-955): the sibling spelling is a registered
  // tool and inherits the maxWaitMs bound.
  const gateA = setup({ surface: 'combined' });
  await initialized(gateA.server);
  const overBound = await request(gateA.server, 2, 'tools/call', {
    name: 'fleet_run_wait',
    arguments: { repoId: REPO_ID, runId: 'run-a', timeoutMs: MAX_WAIT_MS + 1 },
  });
  assert.ok(!overBound.error || overBound.error.code !== -32602,
    'fleet_run_wait is a registered tool (stage: wait-follow-sibling-registered)');
  assert.equal(overBound.result.isError, true, 'fleet_run_wait over the maxWaitMs bound is refused');
  assert.match(overBound.result.content[0].text, /invalid_run_wait/, 'the typed code is invalid_run_wait');

  // Gate B — observe-path post-dispatch _authority gate (D1 item 4, :1510): baton_run_follow is
  // registered AND the gate admits it, so a principal without the follow capability is refused with
  // forbidden AFTER dispatch (the observe path never bypasses the bounded-wait semantics).
  const gateB = setup({ surface: 'combined', principal: principal({ capabilities: ['control'] }) });
  await initialized(gateB.server);
  const noFollow = await request(gateB.server, 2, 'tools/call', {
    name: 'fleet_run_follow',
    arguments: { repoId: REPO_ID, runId: 'run-a', timeoutMs: 1_000 },
  });
  assert.ok(!noFollow.error || noFollow.error.code !== -32602,
    'fleet_run_follow is a registered tool (stage: wait-follow-sibling-registered)');
  assert.equal(noFollow.result?.isError, true,
    'the observe-path gate admits fleet_run_follow and refuses a principal without the follow capability');
  assert.match(noFollow.result?.content?.[0]?.text ?? '', /forbidden/,
    'the observe-path gate refuses with forbidden');
});

// ── RG-09 — the combined profile closure (D1 + D2) ─────────────────────────────────────────────

test('RG-09 RE-DERIVED (#566): combined tools/list is the served combined table over the restored composition (stage: combined-102-includes-siblings)', async () => {
  const { server } = setup({ surface: 'combined' });
  await initialized(server);
  const names = (await request(server, 2, 'tools/list', {})).result.tools.map((tool) => tool.name);
  // Issue #566 composition: the combined surface carries the restored ordinary table (55 + the
  // harvest pair) plus the fleet/advanced/reflex families and the #233 canonical dot twins — the
  // 14 minted baton_run_* lifecycle siblings left with the regression restore.

  assert.equal(typeof mcpNorthbound.uncoveredCommands, 'function',
    'uncoveredCommands export exists (stage: uncovered-set-export)');
  assert.deepEqual(sortedSet(names), mcpNorthbound.mcpCombinedToolNames(),
    'tools/list set equals mcpCombinedToolNames() (ACTUAL sorted order)');
});

// ── RG-10a — the non-canonical alias rows (#566: retired) ───────────────────────────────────────

test('RG-10a RE-DERIVED (#566): the non-canonical ops carry no mcp.baton alias row — their spelling is the fleet transport (stage: alias-rows-registered)', () => {
  const aliases = APPLICATION_SEMANTIC_REGISTRY.surfaceAliases;
  const minted = NON_CANONICAL_OPS.filter((command) => aliases.some((row) => (
    row.surface === 'mcp.baton' && row.canonical === command
  )));
  assert.deepEqual(minted, [],
    'no non-canonical op keeps a [canonical, mcp.baton, minted-sibling] surfaceAlias row — the mint retired (#566)');
});

// ── RG-10b — the renderer canonical-miss fallback (#566: retired) ──────────────────────────────

test('RG-10b RE-DERIVED (#566): no minted baton_run_* sibling of the non-canonical ops is advertised on the combined surface (stage: mint-not-advertised)', () => {
  const combined = new Set(mcpNorthbound.mcpCombinedToolNames());
  const minted = NON_CANONICAL_OPS
    .map((command) => deriveSurfaceNames(command).mcp)
    .filter((tool) => combined.has(tool));
  assert.deepEqual(minted, [],
    'no minted lifecycle sibling spelling is advertised (the mint retired, #566)');
});

// ── RG-10c — the doc half end-to-end (#566: fleet spellings) ───────────────────────────────────

test('RG-10c RE-DERIVED (#566): the non-canonical ops derive to their fleet tools end-to-end through the registry (stage: non-canonical-ops-render-operation-keys)', () => {
  const combined = new Set(mcpNorthbound.mcpCombinedToolNames());
  for (const command of NON_CANONICAL_OPS) {
    const alias = APPLICATION_SEMANTIC_REGISTRY.surfaceAliases
      .find((row) => row.surface === 'mcp.fleet' && row.canonical === command);
    // The fleet row is keyed by the op where one exists; the rest resolve through their family's
    // row (run.view/run.watch) — the derived fleetName spelling is the same tool either way.
    const tool = alias ? alias.name : fleetName(command);
    assert.equal(fleetName(command), tool,
      `${command}'s derived mcp name is the fleet-advertised tool`);
    assert.ok(combined.has(tool),
      `${tool} is advertised on the combined surface the alias resolves into`);
    assert.ok(!combined.has(deriveSurfaceNames(command).mcp),
      `no minted ${deriveSurfaceNames(command).mcp} spelling is advertised (#566)`);
  }
});

// ── RG-P1 (PIN) — the conformance gate stays a citizen ──────────────────────────────────────────

test('RG-P1 PIN: surface-conformance.mjs executable main is green (stage: conformance-main-green)', () => {
  const result = execFileSync(process.execPath, [conformanceScript], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(String(result), /surface-conformance: ok/,
    'surface-conformance main is green (stage: conformance-main-green)');
});
