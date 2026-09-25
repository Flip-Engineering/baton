#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtlasCpgSlice } from '../../../../impl/src/index.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(HERE, '../../../..'); const artifacts = mkdtempSync(join(tmpdir(), 'baton-cpg-live-')); const events = [];
const atlas = new AtlasCpgSlice({ artifactRoot: artifacts, maxSourceBytes: 1024 * 1024, maxArtifactBytes: 16 * 1024 * 1024, maxReachDefPairs: 100_000, record: (event) => events.push(event) });
const args = { path: 'impl/src/mcp-northbound.mjs' }; const ctx = { root: REPO, budgetTokens: 500_000, actor: 'orchestrator' };
let result; let reverified; let fatal = null;
try { result = await atlas.invoke('cpg.build', args, ctx); reverified = await atlas.reverify(result, 'cpg.build', args, ctx); } catch (error) { fatal = String(error?.stack ?? error); }
const graph = result ? JSON.parse(readFileSync(result.refs[0].path, 'utf8')) : { nodes: [], edges: [] }; const edgeTypes = new Set(graph.edges.map((edge) => edge.type));
const checks = { noError: fatal === null, complete: result?.status === 'ok', substantial: graph.nodes.length > 100 && graph.edges.length > 100, containment: edgeTypes.has('CONTAINS'), cfg: edgeTypes.has('CFG_NEXT') && edgeTypes.has('CFG_TRUE') && edgeTypes.has('CFG_FALSE'), defUse: edgeTypes.has('REACHING_DEF'), localCalls: edgeTypes.has('CALLS'), reverified: reverified?.ok === true, auditPairs: events.length === 4 };
const summary = { at: new Date().toISOString(), path: args.path, result: result ? { status: result.status, summary: result.summary, provenance: result.provenance } : null, edgeTypes: [...edgeTypes].sort(), checks, fatal, pass: Object.values(checks).every(Boolean) };
writeFileSync(join(HERE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`); rmSync(artifacts, { recursive: true, force: true }); console.log(JSON.stringify({ pass: summary.pass, checks, fatal }, null, 2)); if (!summary.pass) process.exitCode = 1;
