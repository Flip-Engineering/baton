import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('canonical names outrank compatibility aliases and live alias corrections have one owner', () => {
  const closure = assertSurfaceCapabilityNameClosure();
  assert.deepEqual(closure.unresolved, []);
  assert.equal(resolveSurfaceCapability('run.episode').id, 'run.episode');
  assert.equal(resolveSurfaceCapability('run.status').id, 'run.status');
  assert.equal(resolveSurfaceCapability('run.wait').id, 'run.wait');
  assert.equal(resolveSurfaceCapability('runs.list').id, 'runs.list');
  assert.equal(resolveSurfaceCapability('baton_decision_list').id, 'decision.list');
  assert.ok(closure.shadowed.some((row) => row.name === 'run.episode'
    && row.owner === 'run.episode' && row.shadowedOwner === 'run.view'));
});
