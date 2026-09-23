import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mcpCombinedToolNames } from '../src/mcp-northbound.mjs';
import {
  UNIFIED_SURFACE_CATEGORIES,
  assertUnifiedCapabilityCoverage,
  prepareApplicationSurfaceInvocation,
  resolveUnifiedCapability,
  unifiedCapabilityCatalog,
} from '../src/surface-capability-catalog.mjs';
import {
  assertSurfaceCapabilityNameClosure,
  completeUnifiedCapabilityCatalog,
  resolveSurfaceCapability,
} from '../src/surface-capability-resolution.mjs';

test('all operator-facing system categories are reachable on CLI and MCP', () => {
  const report = assertUnifiedCapabilityCoverage();
  assert.equal(report.missingCli.length, 0);
  assert.equal(report.missingMcp.length, 0);
  assert.equal(report.unrepresentedMcpTools.length, 0);
  assert.ok(report.source.liveMcpToolCount > 0);
  assert.ok(report.source.liveWebCommandCount > 0);
  for (const category of UNIFIED_SURFACE_CATEGORIES) {
    assert.ok(report.categories[category].operator > 0, `${category} has no operator capability`);
    assert.equal(report.categories[category].cli, report.categories[category].operator,
      `${category} incomplete on CLI`);
    assert.equal(report.categories[category].mcp, report.categories[category].operator,
      `${category} incomplete on MCP`);
  }
});

test('the catalog preserves application, live MCP-native, CLI-native and embedded-only bodies', () => {
  const rows = unifiedCapabilityCatalog();
  assert.ok(rows.some((row) => row.kind === 'application_operation'));
  assert.ok(rows.some((row) => row.kind === 'mcp_native'));
  assert.ok(rows.some((row) => row.kind === 'cli_native'));
  assert.ok(rows.some((row) => row.kind === 'surface_meta'));

  const fleetSpawn = resolveUnifiedCapability('fleet_spawn');
  assert.equal(fleetSpawn.surfaces.mcp.direct, true);
  assert.equal(fleetSpawn.surfaces.cli.reachable, true);
  assert.ok(fleetSpawn.surfaces.cli.via.includes('mcp_descriptor'));

  const workerClaim = resolveUnifiedCapability('board.claim');
  assert.equal(workerClaim.remotePosture, 'worker_internal');
  assert.equal(workerClaim.operatorFacing, false);
  assert.equal(workerClaim.surfaces.cli.reachable, false);
  assert.equal(workerClaim.surfaces.mcp.reachable, false);
  assert.equal(workerClaim.surfaces.embedded.reachable, true);
});

test('action-dispatched operations use the existing run.do authority and require action coordinates', () => {
  const contextMap = resolveUnifiedCapability('context.map');
  assert.equal(contextMap.surfaces.cli.direct, false);
  assert.equal(contextMap.surfaces.mcp.direct, false);
  assert.throws(
    () => prepareApplicationSurfaceInvocation(contextMap, {
      runId: 'run:a', branch: 'source', program: { op: 'source' },
    }, { surface: 'cli' }),
    (error) => error.code === 'surface_action_id_required',
  );
  const prepared = prepareApplicationSurfaceInvocation(contextMap, {
    runId: 'run:a', actionId: 'action:map', branch: 'source', program: { op: 'source' },
  }, { surface: 'cli' });
  assert.equal(prepared.command, 'run.act');
  assert.equal(prepared.args.runId, 'run:a');
  assert.equal(prepared.args.actionId, 'action:map');
  assert.deepEqual(prepared.args.inputs, { branch: 'source', program: { op: 'source' } });
});

test('direct and generic reachability reflect existing live transports rather than declarations alone', () => {
  const debug = resolveUnifiedCapability('run.debug');
  assert.equal(debug.surfaces.cli.direct, true);
  assert.equal(debug.surfaces.web.direct, false);
  assert.equal(debug.surfaces.mcp.direct, false);
  assert.equal(debug.surfaces.mcp.reachable, true);
  assert.ok(debug.surfaces.mcp.via.includes('baton_surface_invoke'));

  const notifications = completeUnifiedCapabilityCatalog({ category: 'notifications' });
  assert.ok(notifications.some((row) => row.id === 'run.attention.watch'));
  assert.ok(notifications.some((row) => row.id === 'run.message.send'));
  assert.ok(notifications.some((row) => row.id === 'surface.watch'));
  const diagnostics = completeUnifiedCapabilityCatalog({ category: 'diagnostics', surface: 'cli' });
  assert.ok(diagnostics.some((row) => row.id === 'deployment.doctor'));
});

test('canonical names outrank compatibility aliases and preserve each live command identity', () => {
  const closure = assertSurfaceCapabilityNameClosure();
  assert.deepEqual(closure.unresolved, []);
  const liveNames = new Set(mcpCombinedToolNames());
  for (const row of closure.shadowed) {
    assert.ok(liveNames.has(row.name), `${row.name} is an advertised command`);
    assert.equal(row.ownerKind, 'canonical');
    assert.equal(row.shadowedKind, 'alias');
    assert.equal(resolveSurfaceCapability(row.name).id, row.owner);
  }
  assert.equal(resolveSurfaceCapability('run.view').id, 'run.view',
    'the fold operation keeps its own canonical identity');
  const viewAliases = resolveSurfaceCapability('run.view').aliases.mcp;
  for (const name of ['run.episode', 'run.inspect', 'run.status', 'run.wait']) {
    assert.ok(viewAliases.includes(name), `${name} remains part of the run.view fold`);
  }
  for (const name of ['run.episode', 'run.status', 'runs.list']) {
    assert.equal(resolveSurfaceCapability(name).id, name,
      'the advertised command keeps its exact identity');
  }
  assert.equal(resolveSurfaceCapability('baton_decision_list').id, 'decision.list',
    'the registered alias correction keeps its decision.list owner');
});

test('every served combined tool resolves to a catalog identity with an honest mode', () => {
  const liveExecutableNames = mcpCombinedToolNames();
  assert.ok(liveExecutableNames.length > 0);
  for (const name of liveExecutableNames) {
    let row;
    try {
      row = resolveUnifiedCapability(name);
    } catch (error) {
      assert.fail(`${name} lost its catalog identity (${error.code})`);
    }
    assert.ok(row.mode === 'query' || row.mode === 'effect', `${name} carries an honest mode`);
  }
  for (const name of ['baton_run_episode', 'baton_run_inspect', 'fleet_run_status', 'fleet_run_wait', 'baton_knowledge_recall', 'baton_help', 'baton_runs']) {
    assert.equal(resolveUnifiedCapability(name).mode, 'query', `${name} lost its read-only mode`);
  }
});
