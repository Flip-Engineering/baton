#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_WEB_COMMANDS } from '../src/application-cli.mjs';
import '../src/production-cli-extensions.mjs';
import {
  UNIFIED_SURFACE_CATEGORIES,
  assertUnifiedCapabilityCoverage,
} from '../src/surface-capability-catalog.mjs';
import {
  assertSurfaceCapabilityNameClosure,
  completeUnifiedCapabilityCatalog,
  resolveSurfaceCapability,
} from '../src/surface-capability-resolution.mjs';
import { PRODUCTION_WORKFLOW_WEB_PORTS } from '../src/production-web-workflow-ports.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const implRoot = resolve(here, '..');
const repoRoot = resolve(implRoot, '..');
const pkg = JSON.parse(readFileSync(resolve(implRoot, 'package.json'), 'utf8'));
const expected = JSON.parse(readFileSync(resolve(here, 'expected-red.json'), 'utf8'));
const shipped = JSON.parse(readFileSync(resolve(here, 'shipped-holistic-contracts.json'), 'utf8'));
const outputArg = process.argv.indexOf('--output');
const output = outputArg >= 0 ? resolve(process.cwd(), process.argv[outputArg + 1]) : resolve(repoRoot, 'baton-status.json');
const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();

const families = Object.fromEntries([...new Set([...shipped.contracts, ...expected.contracts].map((row) => row.id.split('-')[0]))]
  .sort().map((family) => {
    const outstanding = expected.contracts.filter((row) => row.id.startsWith(`${family}-`));
    return [family, outstanding.length === 0 ? 'shipped' : 'contract_only'];
  }));
const baseCoverage = assertUnifiedCapabilityCoverage();
const nameClosure = assertSurfaceCapabilityNameClosure();
const completeRows = completeUnifiedCapabilityCatalog();
const completeCategories = Object.fromEntries(UNIFIED_SURFACE_CATEGORIES.map((category) => {
  const rows = completeRows.filter((row) => row.categories.includes(category));
  const operatorRows = rows.filter((row) => row.operatorFacing === true || row.kind === 'surface_meta');
  return [category, {
    total: rows.length,
    operator: operatorRows.length,
    cli: operatorRows.filter((row) => row.surfaces.cli?.reachable === true).length,
    mcp: operatorRows.filter((row) => row.surfaces.mcp?.reachable === true).length,
  }];
}));
const liveWeb = new Set(webAdmittedCommandNames());
const workflowPorts = new Set(Object.keys(PRODUCTION_WORKFLOW_WEB_PORTS));
const missingCliWeb = [...CLI_WEB_COMMANDS].filter((command) => {
  const capability = resolveSurfaceCapability(command);
  const candidates = new Set([
    command,
    command.replaceAll('.', '_'),
    capability.names?.web,
    capability.id,
    capability.id?.replaceAll('.', '_'),
  ].filter(Boolean));
  return ![...candidates].some((name) => liveWeb.has(name) || workflowPorts.has(name));
}).sort();
const completeSurface = baseCoverage.missingCli.length === 0
  && baseCoverage.missingMcp.length === 0
  && baseCoverage.unrepresentedMcpTools.length === 0
  && nameClosure.unresolved.length === 0
  && missingCliWeb.length === 0
  && Object.values(completeCategories).every((row) => row.operator === row.cli && row.operator === row.mcp);

const status = {
  schemaVersion: 3,
  commit,
  packageVersion: pkg.version,
  node: process.version,
  releaseGate: process.env.BATON_RELEASE_GATE || 'unknown',
  contractGate: process.env.BATON_CONTRACT_GATE || 'unknown',
  holistic: {
    state: expected.contracts.length === 0 ? 'shipped' : 'converging',
    shippedContracts: shipped.contracts.length,
    outstandingContracts: expected.contracts.length,
    families,
  },
  surfaces: {
    state: completeSurface ? 'unified' : 'incomplete',
    categories: completeCategories,
    totalCapabilities: completeRows.length,
    applicationOperations: baseCoverage.applicationOperations,
    operatorApplicationOperations: baseCoverage.operatorApplicationOperations,
    embeddedOnlyApplicationOperations: baseCoverage.embeddedOnlyApplicationOperations,
    mcpNative: baseCoverage.mcpNative,
    cliNative: baseCoverage.cliNative,
    metaOperations: completeRows.filter((row) => row.kind === 'surface_meta').length,
    notificationWatch: completeRows.some((row) => row.id === 'surface.watch'
      && row.surfaces.cli?.reachable === true && row.surfaces.mcp?.reachable === true),
    missingCli: baseCoverage.missingCli,
    missingMcp: baseCoverage.missingMcp,
    unrepresentedMcpTools: baseCoverage.unrepresentedMcpTools,
    connectedCliCommands: CLI_WEB_COMMANDS.size,
    productionConnectedCliExtensions: ['run.debug'],
    missingCliWeb,
    names: nameClosure.names,
    unresolvedNames: nameClosure.unresolved,
    shadowedCompatibilityNames: nameClosure.shadowed,
    digest: baseCoverage.digest,
  },
  shipped: shipped.contracts.map(({ id, owner, status: contractStatus }) => ({ id, owner, status: contractStatus })),
  expectedRed: expected.contracts,
};

writeFileSync(output, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
process.stdout.write(`${output}\n`);
