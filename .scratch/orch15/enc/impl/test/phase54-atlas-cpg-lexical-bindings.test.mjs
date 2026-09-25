import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtlasCpgDelta, AtlasCpgSlice, AtlasCpgTaint, CapabilityRegistry } from '../src/index.mjs';

const MODEL = 'atlas-js-lexical-bindings-v1';
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase54-${name}-`));
const limits = Object.freeze({
  maxSourceBytes: 64 * 1024,
  maxArtifactBytes: 512 * 1024,
  maxReachDefPairs: 4096,
  maxScopes: 64,
  maxScopeDepth: 16,
  maxBindings: 128,
  maxBindingOccurrences: 1024,
});

function sourceFixture(source, overrides = {}) {
  const sourceRoot = root('source'); const artifactRoot = root('artifacts');
  writeFileSync(join(sourceRoot, 'subject.mjs'), source);
  const cpg = new AtlasCpgSlice({ artifactRoot, ...limits, ...overrides });
  return { sourceRoot, artifactRoot, cpg, args: { path: 'subject.mjs' }, ctx: { root: sourceRoot, budgetTokens: 100_000 } };
}

function taintFixture(source, overrides = {}) {
  const sourceRoot = root('taint-source'); const artifactRoot = root('taint-artifacts');
  writeFileSync(join(sourceRoot, 'subject.mjs'), source);
  const { maxArtifactBytes: maxGraphBytes, ...common } = { ...limits, ...overrides };
  const taint = new AtlasCpgTaint({ artifactRoot, maxGraphBytes, maxResultBytes: 512 * 1024, maxDepth: 24, maxPaths: 64, ...common });
  const invoke = (sinkNames = ['send'], extra = {}) => taint.invoke('cpg.taint', {
    path: 'subject.mjs', sourceNames: ['readInput'], sinkNames, sanitizerNames: [], ...extra,
  }, { root: sourceRoot, budgetTokens: 100_000 });
  return { sourceRoot, artifactRoot, taint, invoke };
}

function graphOf(result) { return JSON.parse(readFileSync(result.refs.find((ref) => ref.kind === 'cpg_slice').path, 'utf8')); }
function publish(rootPath, value, kind) {
  const bytes = `${JSON.stringify(value)}\n`; const digest = createHash('sha256').update(bytes).digest('hex'); const path = join(rootPath, `${digest}.json`); writeFileSync(path, bytes);
  return { handle: `art:sha256:${digest}`, kind, digest, bytes: Buffer.byteLength(bytes), path };
}

test('LB1/LB8/LB10: cards and constructors expose one bounded advisory binding model without new authority', () => {
  const f = sourceFixture('function run(value) { return value }\n'); const card = f.cpg.card();
  assert.equal(card.bindingModel, MODEL); assert.equal(card.graphSchemaVersion, 3);
  assert.deepEqual(Object.fromEntries(['maxScopes', 'maxScopeDepth', 'maxBindings', 'maxBindingOccurrences'].map((key) => [key, card.ceilings[key]])), {
    maxScopes: limits.maxScopes, maxScopeDepth: limits.maxScopeDepth,
    maxBindings: limits.maxBindings, maxBindingOccurrences: limits.maxBindingOccurrences,
  });
  assert.deepEqual(Object.keys(card.ops), ['cpg.build']);
  assert.equal(card.limitations.some((item) => item.includes('no shadowing-aware bindings')), false);
  assert.equal(card.limitations.some((item) => item.includes('closure')), true);
  const missing = { ...limits }; delete missing.maxScopes;
  assert.throws(() => new AtlasCpgSlice({ artifactRoot: root('missing-bound'), ...missing }), /maxScopes/);
});

test('LB2/LB3/LB4: deterministic scopes and bindings distinguish block lexical identity and merge parameter plus var', async () => {
  const source = `function run(value) {\n  var value\n  let item = value\n  if (item) { const value = item; use(value) }\n  use(item)\n}\n`;
  const first = sourceFixture(source); const graph = graphOf(await first.cpg.invoke('cpg.build', first.args, first.ctx));
  assert.equal(graph.schemaVersion, 3); assert.equal(graph.bindingModel, MODEL);
  const scopes = graph.nodes.filter((node) => node.type === 'scope'); const bindings = graph.nodes.filter((node) => node.type === 'binding');
  assert.deepEqual(scopes.map((node) => node.scopeKind).sort(), ['block', 'function']);
  assert.equal(bindings.filter((node) => node.name === 'value' && node.bindingKind === 'function_value').length, 1);
  assert.equal(bindings.filter((node) => node.name === 'value' && node.bindingKind === 'block_lexical').length, 1);
  assert.equal(graph.edges.filter((edge) => edge.type === 'DECLARES').length, bindings.length);
  const bound = graph.nodes.filter((node) => node.type === 'identifier' && node.bindingResolution === 'resolved');
  assert.ok(bound.length > 0); assert.equal(bound.every((node) => node.bindingId && node.bindingKey && node.scopeId && node.scopeKey), true);
  assert.equal(graph.edges.filter((edge) => edge.type === 'BINDS').length, bound.length);

  const formatted = sourceFixture(`function run ( value ) { /*same*/ var value; let item=value; if(item){const value=item;use(value)} use(item) }\n`);
  const formattedGraph = graphOf(await formatted.cpg.invoke('cpg.build', formatted.args, formatted.ctx));
  assert.deepEqual(
    formattedGraph.nodes.filter((node) => node.type === 'scope').map((node) => node.scopeKey).sort(),
    scopes.map((node) => node.scopeKey).sort(),
  );
  assert.deepEqual(
    formattedGraph.nodes.filter((node) => node.type === 'binding').map((node) => node.bindingKey).sort(),
    bindings.map((node) => node.bindingKey).sort(),
  );
});

test('LB5/LB6: a block-shadowed source reaches only the inner sink and never the outer sink', async () => {
  const f = taintFixture(`function readInput(){} function safe(){} function consume(v){} function send(v){}\nfunction run(flag){ let value=safe(); if(flag){ let value=readInput(); consume(value) } send(value) }\n`);
  const result = await f.invoke(['consume', 'send']);
  assert.deepEqual(result.payload.map((path) => path.sinkName), ['consume']);
  assert.equal(result.payload[0].nodes.filter((node) => node.type === 'identifier').every((node) => node.bindingKey && node.bindingResolution === 'resolved'), true);
  assert.equal(result.provenance.meaning, 'cfg_binding_aware_may_reach_value_graph_not_safety_proof');
});

test('LB4-LB6: outer flow survives an inner shadow, var remains function scoped, and assignment chooses the nearest binding', async () => {
  const outer = taintFixture(`function readInput(){} function safe(){} function consume(v){} function send(v){}\nfunction run(flag){ let value=readInput(); if(flag){ let value=safe(); consume(value) } send(value) }\n`);
  assert.deepEqual((await outer.invoke(['consume', 'send'])).payload.map((path) => path.sinkName), ['send']);

  const byVar = taintFixture(`function readInput(){} function send(v){}\nfunction run(flag){ if(flag){ var value=readInput() } send(value) }\n`);
  assert.deepEqual((await byVar.invoke()).payload.map((path) => path.sinkName), ['send']);
  const byLet = taintFixture(`function readInput(){} function send(v){}\nfunction run(flag){ if(flag){ let value=readInput() } send(value) }\n`);
  assert.deepEqual((await byLet.invoke()).payload, []);

  const assigned = taintFixture(`function readInput(){} function safe(){} function consume(v){} function send(v){}\nfunction run(flag){ let value=safe(); if(flag){ let value=safe(); value=readInput(); consume(value) } send(value) }\n`);
  assert.deepEqual((await assigned.invoke(['consume', 'send'])).payload.map((path) => path.sinkName), ['consume']);
});

test('LB4/LB11: closures and destructuring stay explicit unsupported boundaries and fabricate no flow', async () => {
  const closure = taintFixture(`function readInput(){} function send(v){}\nfunction outer(){ let value=readInput(); function inner(){ send(value) } inner() }\n`);
  assert.deepEqual((await closure.invoke()).payload, []);
  const closureGraph = graphOf(await closure.taint.cpg.invoke('cpg.build', { path: 'subject.mjs' }, { root: closure.sourceRoot, budgetTokens: 100_000 }));
  const captured = closureGraph.nodes.find((node) => node.type === 'identifier' && node.name === 'value' && node.role === 'reference');
  assert.equal(captured.bindingResolution, 'unresolved'); assert.equal(captured.bindingId, null);

  const destructured = taintFixture(`function readInput(){} function send(v){}\nfunction run(){ let {value}=readInput(); send(value) }\n`);
  assert.deepEqual((await destructured.invoke()).payload, []);
  const destructuredGraph = graphOf(await destructured.taint.cpg.invoke('cpg.build', { path: 'subject.mjs' }, { root: destructured.sourceRoot, budgetTokens: 100_000 }));
  assert.equal(destructuredGraph.nodes.some((node) => node.type === 'identifier' && node.name === 'value' && node.bindingResolution === 'unsupported'), true);

  const caught = taintFixture(`function readInput(){} function send(v){}\nfunction run(){ let value=readInput(); try {} catch(value) { send(value) } }\n`);
  assert.deepEqual((await caught.invoke()).payload, []);
  const caughtGraph = graphOf(await caught.taint.cpg.invoke('cpg.build', { path: 'subject.mjs' }, { root: caught.sourceRoot, budgetTokens: 100_000 }));
  assert.equal(caughtGraph.nodes.some((node) => node.type === 'identifier' && node.name === 'value' && node.bindingResolution === 'unsupported'), true);
});

test('LB8: scope, depth, binding, occurrence, and reaching-definition ceilings refuse independently before artifact publication', async () => {
  const cases = [
    ['scope_too_large', { maxScopes: 1 }, 'function run(){ let a=1; { let b=2 } }\n'],
    ['scope_depth_exceeded', { maxScopeDepth: 1 }, 'function run(){ { { let a=1 } } }\n'],
    ['binding_too_large', { maxBindings: 1 }, 'function run(){ let a=1; let b=2 }\n'],
    ['binding_occurrences_too_large', { maxBindingOccurrences: 1 }, 'function run(){ let a=1; use(a) }\n'],
    ['reachdef_too_large', { maxReachDefPairs: 1 }, 'function run(a){ let b=a; use(a); use(b) }\n'],
  ];
  for (const [code, overrides, source] of cases) {
    const f = sourceFixture(source, overrides);
    await assert.rejects(f.cpg.invoke('cpg.build', f.args, f.ctx), (error) => error.code === code, code);
    assert.deepEqual(readdirSync(f.artifactRoot), [], code);
  }
});

test('LB7/LB9: binding-aware delta exposes scope/value changes and pins new schemas and model', async () => {
  const beforeRoot = root('delta-before'); const afterRoot = root('delta-after'); const artifactRoot = root('delta-artifacts');
  writeFileSync(join(beforeRoot, 'subject.mjs'), 'function run(flag){ let value=1; if(flag){ let value=2; use(value) } use(value) }\n');
  writeFileSync(join(afterRoot, 'subject.mjs'), 'function run(flag){ var value=1; if(flag){ value=2; use(value) } use(value) }\n');
  const { maxArtifactBytes: maxGraphBytes, ...common } = limits;
  const delta = new AtlasCpgDelta({ artifactRoot, maxGraphBytes, maxDeltaBytes: 512 * 1024, maxImpactDepth: 8, ...common });
  const args = { beforePath: 'subject.mjs', afterPath: 'subject.mjs', impactDepth: 4 };
  const ctx = { beforeRoot, afterRoot, budgetTokens: 100_000 };
  const result = await delta.invoke('cpg.delta', args, ctx); const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.equal(artifact.schemaVersion, 2); assert.equal(artifact.bindingModel, MODEL);
  assert.equal(result.provenance.bindingModel, MODEL);
  assert.equal(result.provenance.impactMeaning, 'binding_aware_seed_graph_reachability_not_behavioral_proof');
  assert.equal([...artifact.nodeChanges, ...artifact.edgeChanges].some((row) => JSON.stringify(row).includes('binding')), true);
  assert.equal((await delta.reverify(result, 'cpg.delta', args, ctx)).ok, true);
});

test('LB9/LB10/LB12: complete binding artifacts resume/reverify, reject tamper, and traverse the generic ACI unchanged', async () => {
  const f = sourceFixture(`function run(input){ let value=input; use(value); use(value); use(value) }\n`);
  const result = await f.cpg.invoke('cpg.build', f.args, { ...f.ctx, budgetTokens: 1 });
  assert.equal(result.status, 'needs_resume'); const graph = graphOf(result);
  assert.equal(graph.schemaVersion, 3); assert.equal(graph.bindingModel, MODEL);
  assert.ok(result.provenance.scopeCount > 0); assert.ok(result.provenance.bindingCount > 0); assert.ok(result.provenance.resolvedBindingOccurrences > 0);
  assert.equal((await f.cpg.reverify(result, 'cpg.build', f.args, { ...f.ctx, budgetTokens: 100_000 })).ok, true);
  const resumed = await f.cpg.resume(result.refs[0], result.cursor, { budgetTokens: 100_000 }); assert.ok(resumed.payload.length > 0);
  writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')} `);
  await assert.rejects(f.cpg.resume(result.refs[0], result.cursor, { budgetTokens: 100_000 }), (error) => error.code === 'artifact_integrity');

  const clean = sourceFixture('function run(value){ use(value) }\n');
  const registry = new CapabilityRegistry({ capabilities: { 'atlas-cpg-slice': clean.cpg }, maxBudgetTokens: 100_000, maxEnvelopeBytes: 1024 * 1024, root: clean.sourceRoot, record: () => {} });
  const claim = await registry.invoke('atlas-cpg-slice', 'cpg.build', { path: 'subject.mjs' }, { actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'phase54-aci', budgetTokens: 100_000 });
  assert.equal(claim.provenance.scope, 'single_file_intraprocedural_cfg_binding_aware_may_reach_seed');
  assert.equal(claim.provenance.bindingModel, MODEL);
  for (const authority of ['editAuthority', 'verificationAuthority', 'mergeAuthority', 'approvalAuthority', 'publicationAuthority', 'routingMutationAuthority', 'proofAuthority']) assert.notEqual(claim.provenance[authority], true);

  const old = `${JSON.stringify({ schemaVersion: 2, op: 'cpg.build', nodes: [], edges: [] })}\n`; const digest = createHash('sha256').update(old).digest('hex'); const path = join(clean.artifactRoot, `${digest}.json`); writeFileSync(path, old);
  await assert.rejects(clean.cpg.resume({ digest, path }, `atlas-cpg:${digest}:0`, { budgetTokens: 100 }), (error) => error.code === 'artifact_integrity');
});

test('LB7/LB9: self-consistent forgeries with duplicate graph identities or substituted derived children fail closed', async () => {
  const f = sourceFixture('function run(value){ let item=value; use(item) }\n');
  const result = await f.cpg.invoke('cpg.build', f.args, { ...f.ctx, budgetTokens: 1 }); const graph = graphOf(result);
  for (const forgedGraph of [
    { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
    { ...graph, edges: [...graph.edges, graph.edges[0]] },
    { ...graph, nodes: graph.nodes.map((node) => node.type === 'binding' ? { ...node, bindingKey: 'malformed' } : node) },
  ]) {
    const forged = publish(f.artifactRoot, forgedGraph, 'cpg_slice');
    await assert.rejects(f.cpg.resume(forged, `atlas-cpg:${forged.digest}:0`, { budgetTokens: 100_000 }), (error) => error.code === 'artifact_integrity');
  }

  const taint = taintFixture('function readInput(){} function send(v){} function run(){ let value=readInput(); send(value) }\n');
  const taintClaim = await taint.taint.invoke('cpg.taint', { path: 'subject.mjs', sourceNames: ['readInput'], sinkNames: ['send'], sanitizerNames: [] }, { root: taint.sourceRoot, budgetTokens: 1 });
  writeFileSync(join(taint.sourceRoot, 'other.mjs'), 'function other(value){ use(value) }\n');
  const otherGraph = await taint.taint.cpg.invoke('cpg.build', { path: 'other.mjs' }, { root: taint.sourceRoot, budgetTokens: 100_000 });
  const taintArtifact = JSON.parse(readFileSync(taintClaim.refs.find((ref) => ref.kind === 'cpg_taint').path, 'utf8')); taintArtifact.graphDigest = otherGraph.refs[0].digest;
  const forgedTaint = publish(taint.artifactRoot, taintArtifact, 'cpg_taint');
  await assert.rejects(taint.taint.resume(forgedTaint, `atlas-cpg-taint:${forgedTaint.digest}:0`, { budgetTokens: 100_000 }), (error) => error.code === 'artifact_integrity');

  const beforeRoot = root('sub-before'); const afterRoot = root('sub-after'); const artifactRoot = root('sub-delta');
  writeFileSync(join(beforeRoot, 'subject.mjs'), 'function run(){ let value=1; use(value) }\n'); writeFileSync(join(afterRoot, 'subject.mjs'), 'function run(){ let value=2; use(value) }\n'); writeFileSync(join(beforeRoot, 'other.mjs'), 'function other(value){ use(value) }\n');
  const { maxArtifactBytes: maxGraphBytes, ...common } = limits; const delta = new AtlasCpgDelta({ artifactRoot, maxGraphBytes, maxDeltaBytes: 512 * 1024, maxImpactDepth: 8, ...common });
  const deltaArgs = { beforePath: 'subject.mjs', afterPath: 'subject.mjs', impactDepth: 4 }; const deltaCtx = { beforeRoot, afterRoot, budgetTokens: 1 };
  const deltaClaim = await delta.invoke('cpg.delta', deltaArgs, deltaCtx); const substitutedGraph = await delta.cpg.invoke('cpg.build', { path: 'other.mjs' }, { root: beforeRoot, budgetTokens: 100_000 });
  const deltaArtifact = JSON.parse(readFileSync(deltaClaim.refs.find((ref) => ref.kind === 'cpg_delta').path, 'utf8')); deltaArtifact.before.graphDigest = substitutedGraph.refs[0].digest;
  const forgedDelta = publish(artifactRoot, deltaArtifact, 'cpg_delta');
  await assert.rejects(delta.resume(forgedDelta, `atlas-cpg-delta:${forgedDelta.digest}:0`, { budgetTokens: 100_000 }), (error) => error.code === 'artifact_integrity');
});
