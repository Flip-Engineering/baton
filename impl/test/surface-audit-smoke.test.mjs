// Issue #43 / docs/35: the surface-audit generator is the audit's table of record — these
// contracts pin that it keeps extracting every inventory dimension the unified-grammar work
// depends on. They deliberately assert presence and shape, not exact counts, so ordinary surface
// evolution does not break them while a broken extractor (empty section, lost dialect) does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { collectSurfaceInventory, renderSurfaceAudit } from '../scripts/surface-audit.mjs';
import { ORDINARY_COMMANDS } from '../src/mcp-web-bridge.mjs';

const AUDIT_SCRIPT = new URL('../scripts/control-surface-audit.mjs', import.meta.url);

test('SA1: every inventory dimension extracts non-empty', () => {
  const inventory = collectSurfaceInventory();
  for (const key of ['registryOperations', 'registryActions', 'commandDefinitions', 'webCommands',
    'cliCommands', 'mcpFleetTools', 'mcpBatonTools', 'embeddedMethods',
    'mcpWebBridgeCommands', 'phaseLiterals']) {
    assert.ok(Array.isArray(inventory[key]) && inventory[key].length > 0, `${key} extracts non-empty`);
  }
  // docs/36 §9 M5 — the divergence ledger retired to empty; the extractor keeps the behavior
  // dimension as an array so a re-emerging divergence is still observed (and would be novel),
  // never silently dropped.
  assert.ok(Array.isArray(inventory.behaviorDivergences), 'behaviorDivergences stays an array');
  assert.deepEqual(inventory.behaviorDivergences, [], 'M5 retires the last behavior divergence');
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
  // Issue #533: the bridge row IS the bridge's exported ORDINARY_COMMANDS (sorted) — the one
  // table the bridge admits by — never a hand-kept copy of it; and every entry stays a
  // namespaced application command, so a drifted or invented entry fails here.
  assert.deepEqual(inventory.mcpWebBridgeCommands, [...ORDINARY_COMMANDS].sort());
  for (const command of inventory.mcpWebBridgeCommands) {
    assert.match(command, /^(?:application|runs|run|waves)\.[a-z][a-z0-9_.]+$/u,
      `the bridge row carries a namespaced application command, never a stray literal: ${command}`);
  }
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

// Issue #519: `npm run test:surfaces` runs control-surface-audit.mjs as its second step, and that
// step was red at HEAD — the `registryCliExceptions` table had drifted from the live registry in
// both directions (eight rows whose semantic row had stopped declaring `cli` at all, and one row
// whose operation the CLI dispatches through a transport the WIRE CARD omits). The audit is the
// contract, so the row drives it rather than re-deriving its three checks here.
test('SA4: the control-surface audit passes (issue #519)', () => {
  const result = spawnSync(process.execPath, [AUDIT_SCRIPT.pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, `control-surface-audit refused:\n${result.stderr}`);
  assert.match(result.stdout, /cliSurfaceExceptions/, 'the audit renders its own exception table');
});
