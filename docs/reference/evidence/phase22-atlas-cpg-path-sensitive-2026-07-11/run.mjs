#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtlasCpgSlice, AtlasCpgTaint } from '../../../../impl/src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(HERE, '../../../..');
const artifacts = mkdtempSync(join(tmpdir(), 'baton-cpg-path-live-')); const fixture = mkdtempSync(join(tmpdir(), 'baton-cpg-path-fixture-')); const events = [];
const common = { maxSourceBytes: 2 * 1024 * 1024, maxReachDefPairs: 250_000, record: (event) => events.push(event) };
const cpg = new AtlasCpgSlice({ artifactRoot: join(artifacts, 'cpg'), maxArtifactBytes: 48 * 1024 * 1024, ...common });
const taint = new AtlasCpgTaint({ artifactRoot: join(artifacts, 'taint'), maxGraphBytes: 48 * 1024 * 1024, maxResultBytes: 8 * 1024 * 1024, maxDepth: 32, maxPaths: 256, ...common });
let batonGraphResult; let batonTaintResult; let fixtureResult; let reverified; let fatal = null;
try {
  batonGraphResult = await cpg.invoke('cpg.build', { path: 'impl/src/atlas-cpg.mjs' }, { root: REPO, budgetTokens: 2_000_000, actor: 'orchestrator' });
  batonTaintResult = await taint.invoke('cpg.taint', { path: 'impl/src/mcp-northbound.mjs', sourceNames: ['parse'], sinkNames: ['handle'], depth: 20 }, { root: REPO, budgetTokens: 100_000, actor: 'orchestrator' });
  mkdirSync(join(fixture, 'src'), { recursive: true });
  writeFileSync(join(fixture, 'src/path.js'), `function readInput(){} function safe(){} function sanitize(v){return v} function send(v){}\nfunction run(flag){ let value=readInput(); if(flag){ value=safe() } let copy=value; send(copy); if(false){send(readInput())}; let clean=sanitize(readInput()); send(clean) }\n`);
  fixtureResult = await taint.invoke('cpg.taint', { path: 'src/path.js', sourceNames: ['readInput'], sinkNames: ['send'], sanitizerNames: ['sanitize'], depth: 24 }, { root: fixture, budgetTokens: 100_000, actor: 'orchestrator' });
  reverified = await taint.reverify(fixtureResult, { path: 'src/path.js', sourceNames: ['readInput'], sinkNames: ['send'], sanitizerNames: ['sanitize'], depth: 24 }, { root: fixture, budgetTokens: 100_000, actor: 'orchestrator' });
} catch (error) { fatal = String(error?.stack ?? error); }
const graph = batonGraphResult ? JSON.parse(readFileSync(batonGraphResult.refs[0].path, 'utf8')) : { nodes: [], edges: [] }; const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
const actualWitness = batonTaintResult?.payload?.[0] ?? null; const fixturePaths = fixtureResult?.payload ?? [];
const checks = {
  noError: fatal === null,
  actualGraphComplete: batonGraphResult?.status === 'ok' && graph.schemaVersion === 2 && graph.nodes.length > 100 && graph.edges.length > 100,
  actualCfgAndMayDefs: ['CFG_TRUE', 'CFG_FALSE', 'REACHING_DEF'].every((type) => graph.edges.some((edge) => edge.type === type)) && batonGraphResult?.provenance?.reachDefPairs > 0,
  actualIdentifierCopies: graph.edges.some((edge) => edge.type === 'ASSIGNED_FROM' && nodeById.get(edge.from)?.type === 'identifier' && nodeById.get(edge.to)?.type === 'identifier'),
  actualMcpTaintPreserved: batonTaintResult?.status === 'ok' && actualWitness?.sourceName === 'parse' && actualWitness?.sinkName === 'handle',
  fixtureMayPathPreserved: fixturePaths.some((path) => path.edgeTypes.filter((type) => type === 'ASSIGNED_FROM').length >= 2),
  fixtureLiteralDeadAndSanitizerCut: fixturePaths.length === 1,
  meaningTruthful: fixtureResult?.provenance?.meaning === 'cfg_may_reach_value_graph_not_safety_proof',
  reverified: reverified?.ok === true,
  auditBalanced: events.filter((event) => event.kind === 'capability.op.started').length === events.filter((event) => event.kind === 'capability.op.completed').length,
};
const summary = { at: new Date().toISOString(), actualPaths: { graph: 'impl/src/atlas-cpg.mjs', taint: 'impl/src/mcp-northbound.mjs' }, graph: batonGraphResult ? { status: batonGraphResult.status, summary: batonGraphResult.summary, provenance: batonGraphResult.provenance } : null, actualWitness: actualWitness ? { sourceName: actualWitness.sourceName, sinkName: actualWitness.sinkName, edgeTypes: actualWitness.edgeTypes } : null, fixturePaths: fixturePaths.map((path) => ({ sourceName: path.sourceName, sinkName: path.sinkName, edgeTypes: path.edgeTypes })), checks, fatal, pass: Object.values(checks).every(Boolean) };
mkdirSync(HERE, { recursive: true }); writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const root of [artifacts, fixture]) rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2)); if (!summary.pass) process.exitCode = 1;
