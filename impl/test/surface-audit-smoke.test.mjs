// Issue #43 / docs/35: the surface-audit generator is the audit's table of record — these
// contracts pin that it keeps extracting every inventory dimension the unified-grammar work
// depends on. They deliberately assert presence and shape, not exact counts, so ordinary surface
// evolution does not break them while a broken extractor (empty section, lost dialect) does.
import assert from 'node:assert/strict';
import test from 'node:test';

import { collectSurfaceInventory, renderSurfaceAudit } from '../scripts/surface-audit.mjs';

test('SA1: every inventory dimension extracts non-empty', () => {
  const inventory = collectSurfaceInventory();
  for (const key of ['registryOperations', 'registryActions', 'commandDefinitions', 'webCommands',
    'cliCommands', 'mcpFleetTools', 'mcpBatonTools', 'embeddedMethods',
    'mcpWebBridgeCommands', 'phaseLiterals', 'behaviorDivergences']) {
    assert.ok(Array.isArray(inventory[key]) && inventory[key].length > 0, `${key} extracts non-empty`);
  }
  assert.ok(Object.keys(inventory.synonymDensity).length >= 4, 'synonym density covers the seat-concept names');
});

test('SA2: known anchors from each dialect are present', () => {
  const inventory = collectSurfaceInventory();
  assert.ok(inventory.registryOperations.includes('run.start'));
  assert.ok(inventory.registryActions.includes('approve_plan'));
  assert.ok(inventory.commandDefinitions.includes('run.approve'));
  assert.ok(inventory.webCommands.includes('run_start'), 'web derivation (dots to underscores) holds');
  for (const command of ['spawn', 'scratch_oracle', 'provider_status', 'goal_define',
    'plan_propose', 'plan_approve', 'goal_plan_status']) {
    assert.ok(inventory.webCommands.includes(command), `full Web admitted set includes ${command}`);
  }
  assert.ok(inventory.mcpFleetTools.includes('fleet_run_start'));
  assert.ok(inventory.mcpBatonTools.includes('baton_run_start'));
  assert.deepEqual(inventory.mcpWebBridgeCommands,
    ['application.help', 'run.act', 'run.inspect', 'run.start', 'run.stop']);
  assert.ok(inventory.embeddedMethods.some((name) => name.startsWith('BatonRun.')));
  for (const phase of ['awaiting_plan_approval', 'selection_required', 'candidate_selected',
    'input_required', 'planning_failed']) {
    assert.ok(inventory.phaseLiterals.includes(phase), `live phase ${phase} is extracted`);
  }
});

test('SA3: the renderer emits every section as markdown', () => {
  const rendered = renderSurfaceAudit();
  for (const heading of ['Semantic registry operations', 'Semantic registry actions',
    'Application command definitions', 'Web bus admitted command names', 'CLI verb rows',
    'MCP fleet_* dialect', 'MCP baton_* dialect', 'MCP-over-Web bridge subset',
    'Embedded client methods',
    'Run phase string literals', 'Synonym density']) {
    assert.ok(rendered.includes(`### ${heading}`), `section ${heading} renders`);
  }
});
