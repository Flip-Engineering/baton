import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { AtlasCpgSlice } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
function fixture(source, opts = {}) {
  const root = dir('cpg-root'); const artifacts = dir('cpg-artifacts');
  mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src/a.js'), source);
  const atlas = new AtlasCpgSlice({ artifactRoot: artifacts, maxSourceBytes: 64 * 1024, maxArtifactBytes: 512 * 1024, maxReachDefPairs: 4096, maxScopes: 128, maxScopeDepth: 32, maxBindings: 512, maxBindingOccurrences: 4096, ...opts });
  return { root, artifacts, atlas, args: { path: 'src/a.js' }, ctx: { root, budgetTokens: 10000 } };
}

test('CG1/CG2: card and deterministic graph identity are honest', async () => {
  const f = fixture(`function helper(x) { return x }\nfunction run(v) { let out = helper(v); return out }\n`);
  const card = f.atlas.card(); assert.equal(card.ops['cpg.build'].deterministic, true); assert.ok(card.limitations.some((item) => item.includes('not SSA/must-def/full PDG')));
  const one = await f.atlas.invoke('cpg.build', f.args, f.ctx); const two = await f.atlas.invoke('cpg.build', f.args, f.ctx);
  assert.equal(one.provenance.graphDigest, two.provenance.graphDigest);
  assert.deepEqual(one.payload, two.payload);
  assert.equal(one.payload.filter((item) => item.recordType === 'node').every((item) => item.id.includes(one.provenance.sourceDigest)), true);
});

test('CG3/CG4/CG5: graph has containment, control, lexical def-use, and local call edges', async () => {
  const f = fixture(`function helper(x) { return x }\nfunction run(v) { let out = helper(v); if (out) { out = helper(out) } return out }\n`);
  const result = await f.atlas.invoke('cpg.build', f.args, f.ctx); const graph = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  const types = new Set(graph.edges.map((edge) => edge.type));
  for (const type of ['CONTAINS', 'CFG_ENTRY', 'CFG_NEXT', 'CFG_TRUE', 'CFG_FALSE', 'REACHING_DEF', 'CALLS']) assert.equal(types.has(type), true, type);
  assert.equal(graph.nodes.some((node) => node.type === 'function' && node.name === 'run'), true);
  assert.equal(graph.nodes.some((node) => node.type === 'call' && node.calleeName === 'helper' && node.resolved), true);
  const returnNode = graph.nodes.find((node) => node.type === 'statement' && node.kind === 'return_statement' && node.range.start.line === 2);
  assert.equal(graph.edges.some((edge) => edge.type === 'CFG_NEXT' && edge.from === returnNode.id), false);
});

test('CG5: duplicate and dynamic callees remain unresolved with candidates', async () => {
  const f = fixture(`function same() {}\nconst same = () => 1\nfunction run(fn) { same(); fn() }\n`);
  const result = await f.atlas.invoke('cpg.build', f.args, f.ctx); const graph = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  const same = graph.nodes.find((node) => node.type === 'call' && node.calleeName === 'same');
  const dynamic = graph.nodes.find((node) => node.type === 'call' && node.calleeName === 'fn');
  assert.equal(same.resolved, null); assert.ok(same.candidates.length > 1); assert.equal(dynamic.resolved, null);
});

test('CG2/CG5: parameterized arrow functions use their binding name, not their first parameter', async () => {
  const f = fixture(`const helper = (value) => value\nfunction run(v) { return helper(v) }\n`);
  const result = await f.atlas.invoke('cpg.build', f.args, f.ctx); const graph = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.equal(graph.nodes.some((node) => node.type === 'function' && node.name === 'helper'), true);
  assert.equal(graph.nodes.some((node) => node.type === 'function' && node.name === 'value'), false);
  assert.equal(graph.nodes.find((node) => node.type === 'call' && node.calleeName === 'helper').resolved !== null, true);
});

test('CG4: assignments and direct call arguments produce explicit value-flow edges', async () => {
  const f = fixture(`function source() { return 'x' }\nfunction sink(value) {}\nfunction run() { let value = source(); sink(value); sink(source()) }\n`);
  const result = await f.atlas.invoke('cpg.build', f.args, f.ctx); const graph = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.equal(graph.edges.some((edge) => edge.type === 'ASSIGNED_FROM'), true);
  assert.equal(graph.edges.some((edge) => edge.type === 'ARGUMENT_TO' && graph.nodes.find((node) => node.id === edge.from)?.type === 'identifier'), true);
  assert.equal(graph.edges.some((edge) => edge.type === 'ARGUMENT_TO' && graph.nodes.find((node) => node.id === edge.from)?.type === 'call'), true);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length);
});

test('CG6: parse errors are partial and cancellation/unsupported language fail typed', async () => {
  const broken = fixture(`function bad( { return 1 }`); const result = await broken.atlas.invoke('cpg.build', broken.args, broken.ctx);
  assert.equal(result.status, 'partial'); assert.ok(result.provenance.parseErrors > 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(broken.atlas.invoke('cpg.build', broken.args, { ...broken.ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
  writeFileSync(join(broken.root, 'src/a.txt'), 'x');
  await assert.rejects(broken.atlas.invoke('cpg.build', { path: 'src/a.txt' }, broken.ctx), (error) => error.code === 'unsupported_language');
});

test('CG7: bounded result resumes, detects tamper, and reverifies', async () => {
  const f = fixture(`function helper(x) { return x }\nfunction run(v) { let out = helper(v); return out }\n`);
  const result = await f.atlas.invoke('cpg.build', f.args, { ...f.ctx, budgetTokens: 1 });
  assert.equal(result.status, 'needs_resume');
  const resumed = await f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }); assert.ok(resumed.payload.length > 0);
  assert.equal((await f.atlas.reverify(result, 'cpg.build', f.args, f.ctx)).ok, true);
  writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')} `);
  await assert.rejects(f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
  const forged = '{}\n'; const digest = createHash('sha256').update(forged).digest('hex'); const path = join(f.artifacts, `${digest}.json`); writeFileSync(path, forged);
  await assert.rejects(f.atlas.resume({ digest, path }, `atlas-cpg:${digest}:0`, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
});

test('CG6: source and graph deployment ceilings fail typed', async () => {
  const source = fixture(`function run() { return 1 }`, { maxSourceBytes: 4 });
  await assert.rejects(source.atlas.invoke('cpg.build', source.args, source.ctx), (error) => error.code === 'invalid_source');
  const graph = fixture(`function run(value) { let x = value; return x }`, { maxArtifactBytes: 64 });
  await assert.rejects(graph.atlas.invoke('cpg.build', graph.args, graph.ctx), (error) => error.code === 'graph_too_large');
});
