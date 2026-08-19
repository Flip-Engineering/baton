#!/usr/bin/env node

import { parseUnifiedSurfaceCli } from '../src/surface-cli.mjs';
import {
  UNIFIED_SURFACE_CATEGORIES,
  assertUnifiedCapabilityCoverage,
} from '../src/surface-capability-catalog.mjs';
import {
  COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS,
  assertSurfaceCapabilityNameClosure,
  completeUnifiedCapabilityCatalog,
  resolveSurfaceCapability,
} from '../src/surface-capability-resolution.mjs';

const report = assertUnifiedCapabilityCoverage();
const nameClosure = assertSurfaceCapabilityNameClosure();
const metaNames = COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS.map((tool) => tool.name).sort();
const expectedMeta = [
  'baton_surface_catalog',
  'baton_surface_describe',
  'baton_surface_invoke',
  'baton_surface_snapshot',
  'baton_surface_watch',
];
if (JSON.stringify(metaNames) !== JSON.stringify(expectedMeta)) {
  throw new Error(`unified-capability-audit: MCP meta surface drifted: ${JSON.stringify(metaNames)}`);
}

const cliCases = [
  ['surface', 'catalog', '--category', 'telemetry'],
  ['surface', 'catalog', '--category', 'knowledge', '--mcp-config', 'deployment.mjs'],
  ['surface', 'describe', 'run.message.send'],
  ['surface', 'describe', 'fleet_spawn', '--mcp-config', 'deployment.mjs'],
  ['surface', 'invoke', 'run.message.send', '--args', '{"runId":"run:a","kind":"inform","body":"x"}'],
  ['surface', 'snapshot', '--run-id', 'run:a'],
  ['surface', 'watch', 'run:a', '--after-cursor', '0', '--attention-cursor', '0'],
];
for (const argv of cliCases) {
  if (parseUnifiedSurfaceCli(argv) === null) {
    throw new Error(`unified-capability-audit: CLI meta grammar did not admit ${argv.join(' ')}`);
  }
}

for (const category of UNIFIED_SURFACE_CATEGORIES) {
  const counts = report.categories[category];
  if (!counts || counts.operator === 0 || counts.cli !== counts.operator || counts.mcp !== counts.operator) {
    throw new Error(`unified-capability-audit: ${category} operator coverage diverged: ${JSON.stringify(counts)}`);
  }
  const complete = completeUnifiedCapabilityCatalog({ category });
  if (!complete.some((row) => row.surfaces.cli?.reachable)
    || !complete.some((row) => row.surfaces.mcp?.reachable)) {
    throw new Error(`unified-capability-audit: ${category} lacks complete CLI/MCP reachability`);
  }
}

const application = completeUnifiedCapabilityCatalog({ owner: 'application' });
const unreachableOperators = application.filter((row) => row.operatorFacing
  && (!row.surfaces.cli.reachable || !row.surfaces.mcp.reachable));
if (unreachableOperators.length > 0) {
  throw new Error(`unified-capability-audit: operator capabilities lack dual reachability: ${unreachableOperators.map((row) => row.id).join(', ')}`);
}
const promotedInternals = application.filter((row) => !row.operatorFacing && !row.hostLocal
  && (row.surfaces.cli.reachable || row.surfaces.mcp.reachable));
if (promotedInternals.length > 0) {
  throw new Error(`unified-capability-audit: embedded/worker authority was promoted into operator surfaces: ${promotedInternals.map((row) => row.id).join(', ')}`);
}
if (report.unrepresentedMcpTools.length > 0) {
  throw new Error(`unified-capability-audit: live MCP tools lack catalogue ownership: ${report.unrepresentedMcpTools.join(', ')}`);
}
if (nameClosure.unresolved.length > 0) {
  throw new Error(`unified-capability-audit: unresolved capability names: ${JSON.stringify(nameClosure.unresolved)}`);
}
for (const [name, owner] of [
  ['run.episode', 'run.episode'],
  ['run.status', 'run.status'],
  ['run.wait', 'run.wait'],
  ['runs.list', 'runs.list'],
  ['baton_decision_list', 'decision.list'],
  ['surface.watch', 'surface.watch'],
]) {
  const resolved = resolveSurfaceCapability(name);
  if (resolved.id !== owner) {
    throw new Error(`unified-capability-audit: ${name} resolved to ${resolved.id}, expected ${owner}`);
  }
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 3,
  ...report,
  nameClosure,
  completeCapabilityCount: completeUnifiedCapabilityCatalog().length,
  metaNames,
  cliMetaCases: cliCases.length,
}, null, 2)}\n`);
