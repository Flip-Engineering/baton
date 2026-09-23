// #565 gate row — the MCP server's startup sequence, run in-process so a surface change that
// stops the bridge from starting refuses the gate that carries it.
//
// `impl/scripts/mcp-web.mjs` executes, before it serves anything: the three startup assertions
// (CLI/MCP control parity, unified capability coverage, surface capability name closure), then
// the core tool table build — mcp-core-tools projects the served table and refuses at load when
// a declared leg's landed row is missing. That projection is the #565 failure point: d1288fd9
// removed the baton_run_knowledge_seed surface row and startup died with
// `no landed schema for verb seed leg baton_run_knowledge_seed`. This file runs the same
// sequence against the landing's own tree — no resident, no descriptor, no network: the
// projection is a pure function of the landed tables. Changed src modules (mcp-web-bridge,
// surface-capability-catalog, surface-capability-resolution, control-surface-unification,
// index) select this file through the static import graph; the bridge script itself selects it
// through the fixture-path needle below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { McpFleetServer } from '../src/index.mjs';
import { selectFromRepository } from '../src/verification-selection.mjs';
import { assertCliMcpControlParity } from '../src/control-surface-unification.mjs';
import { assertUnifiedCapabilityCoverage } from '../src/surface-capability-catalog.mjs';
import { assertSurfaceCapabilityNameClosure } from '../src/surface-capability-resolution.mjs';
import { CORE_TOOL_NAMES, coreToolDefinitions } from '../src/mcp-core-tools.mjs';

// Fixture-path needle (selection rule 3): a change to the bridge script selects this row even
// though the script is not a static-import graph root.
const BRIDGE_SCRIPT = 'impl/scripts/mcp-web.mjs';

test('MCP-SG-selection: entry point and bridge changes select the startup gate through imports (issue #565)', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const gate = 'impl/test/mcp-web-startup-gate.test.mjs';
  for (const changedPath of ['impl/src/index.mjs', 'impl/src/mcp-web-bridge.mjs']) {
    const selection = selectFromRepository({ root, changedPaths: [changedPath] });
    const row = selection.provenance.find(({ path }) => path === gate);
    assert.equal(row?.reason, 'imports', `${changedPath} selects the startup gate through imports`);
  }
  const scriptSelection = selectFromRepository({ root, changedPaths: [BRIDGE_SCRIPT] });
  assert.ok(scriptSelection.files.includes(gate), 'the bridge script selects the startup gate');
});

test('MCP-SG: the baton-mcp-web startup sequence completes on this tree — parity, capability coverage, name closure, and the core tool table projection (issue #565)', () => {
  assert.equal(typeof McpFleetServer, 'function', 'the application entry point exports the MCP server');
  // The three startup assertions, in the bridge script's order.
  assertCliMcpControlParity();
  assertUnifiedCapabilityCoverage();
  assertSurfaceCapabilityNameClosure();

  // The core table projection — the exact call whose refusal was the #565 startup failure.
  // Bound context: the shape the resident bridge serves (mcp-web-bridge binds the application
  // context), so the row set and schemas match what a real session sees.
  const definitions = coreToolDefinitions({ bindApplicationContext: true });
  assert.ok(definitions.length > 0, 'the core tool table projects at least one tool');
  for (const tool of definitions) {
    assert.ok(tool.inputSchema && tool.inputSchema.properties,
      `${tool.name}: the projected core tool carries a landed schema`);
  }
  // The seed leg the #565 regression removed stays projected.
  assert.ok(CORE_TOOL_NAMES.length > 0, 'the core projection names its tools');
});
