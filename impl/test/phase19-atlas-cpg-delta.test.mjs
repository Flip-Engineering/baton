import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { AtlasCpgDelta } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
function write(root, path, content) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
function fixture(before, after, opts = {}) {
  const beforeRoot = dir('cpg-before'); const afterRoot = dir('cpg-after'); const artifacts = dir('cpg-delta-artifacts');
  write(beforeRoot, 'src/a.js', before); write(afterRoot, 'src/a.js', after);
  const atlas = new AtlasCpgDelta({ artifactRoot: artifacts, maxSourceBytes: 64 * 1024, maxGraphBytes: 512 * 1024, maxDeltaBytes: 512 * 1024, maxImpactDepth: 8, maxReachDefPairs: 4096, maxScopes: 128, maxScopeDepth: 32, maxBindings: 512, maxBindingOccurrences: 4096, ...opts });
  return { beforeRoot, afterRoot, artifacts, atlas, args: { beforePath: 'src/a.js', afterPath: 'src/a.js', impactDepth: 4 }, ctx: { beforeRoot, afterRoot, budgetTokens: 10000 } };
}

test('CD1/CD2: identical semantics with moved formatting produces an empty delta', async () => {
  const f = fixture(`function helper(x){return x}\n`, `function helper ( x ) {\n  return x\n}\n`);
  const result = await f.atlas.invoke('cpg.delta', f.args, f.ctx);
  assert.equal(result.status, 'ok'); assert.deepEqual(result.provenance.counts, { nodesAdded: 0, nodesRemoved: 0, nodesModified: 0, edgesAdded: 0, edgesRemoved: 0, impacted: 0 });
});

test('CD3/CD4: syntax and call changes classify and propagate impact to callers', async () => {
  const before = `function helper(x) { return x }\nfunction run(v) { let out = helper(v); return out }\n`;
  const after = `function helper(x) { let y = x + 1; return y }\nfunction run(v) { let out = helper(v); return out }\n`;
  const f = fixture(before, after); const result = await f.atlas.invoke('cpg.delta', f.args, f.ctx); const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.ok(result.provenance.counts.nodesModified > 0); assert.ok(result.provenance.counts.nodesAdded > 0);
  assert.equal(artifact.impact.some((item) => item.nodeKey.includes('function:helper')), true);
  assert.equal(artifact.impact.some((item) => item.nodeKey.includes('function:run') && item.reason === 'caller'), true);
  assert.equal(artifact.nodeChanges.some((item) => item.change === 'modified' && item.after?.type === 'statement'), true);
});

test('CD2/CD5: rename is remove/add and unresolved calls do not fabricate caller impact', async () => {
  const f = fixture(`function helper(x) { return x }\nfunction run(v) { return helper(v) }\n`, `function assist(x) { return x }\nfunction run(v) { return dynamic(v) }\n`);
  const result = await f.atlas.invoke('cpg.delta', f.args, f.ctx); const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.equal(artifact.nodeChanges.some((item) => item.change === 'removed' && item.before?.name === 'helper'), true);
  assert.equal(artifact.nodeChanges.some((item) => item.change === 'added' && item.after?.name === 'assist'), true);
  assert.equal(artifact.impact.some((item) => item.reason === 'caller' && item.nodeKey.includes('dynamic')), false);
});

test('CD4/CD6: impact depth, cancellation, and parse health are enforced', async () => {
  const f = fixture(`function a(){return 1}\n`, `function a(){return 2}\n`);
  await assert.rejects(f.atlas.invoke('cpg.delta', { ...f.args, impactDepth: 9 }, f.ctx), (error) => error.code === 'impact_depth_exceeded');
  const abort = new AbortController(); abort.abort(); await assert.rejects(f.atlas.invoke('cpg.delta', f.args, { ...f.ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
  const broken = fixture(`function a(){return 1}\n`, `function a( { return 2 }`); const partial = await broken.atlas.invoke('cpg.delta', broken.args, broken.ctx); assert.equal(partial.status, 'partial');
});

test('CD7: bounded delta resumes, detects tamper, and reverifies', async () => {
  const f = fixture(`function a(x){return x}\n`, `function a(x){let y=x+1; return y}\n`);
  const result = await f.atlas.invoke('cpg.delta', f.args, { ...f.ctx, budgetTokens: 1 }); assert.equal(result.status, 'needs_resume');
  const resumed = await f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }); assert.ok(resumed.payload.length > 0);
  assert.equal((await f.atlas.reverify(result, 'cpg.delta', f.args, f.ctx)).ok, true);
  writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')} `); await assert.rejects(f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
  const forged = '{}\n'; const digest = createHash('sha256').update(forged).digest('hex'); const path = join(f.artifacts, `${digest}.json`); writeFileSync(path, forged);
  await assert.rejects(f.atlas.resume({ digest, path }, `atlas-cpg-delta:${digest}:0`, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
});

test('CD6: delta artifact ceiling is deployment-bound', async () => {
  const f = fixture(`function a(){return 1}\n`, `function a(){let x=1; return x}\n`, { maxDeltaBytes: 64 });
  await assert.rejects(f.atlas.invoke('cpg.delta', f.args, f.ctx), (error) => error.code === 'delta_too_large');
});

test('CD3/CD4/PS7: literal branch pruning surfaces CFG and reaching-definition edge changes', async () => {
  const before = `function readInput(){} function safe(){} function send(v){}\nfunction run(flag){ let value; if(flag){ value=readInput() } else { value=safe() } send(value) }\n`;
  const after = `function readInput(){} function safe(){} function send(v){}\nfunction run(flag){ let value; if(false){ value=readInput() } else { value=safe() } send(value) }\n`;
  const f = fixture(before, after); const result = await f.atlas.invoke('cpg.delta', f.args, f.ctx); const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.equal(artifact.edgeChanges.some((item) => item.change === 'removed' && item.type === 'CFG_TRUE'), true);
  assert.equal(artifact.edgeChanges.some((item) => item.change === 'removed' && item.type === 'REACHING_DEF'), true);
  assert.equal(artifact.impact.some((item) => item.reason === 'changed' && item.nodeKey.includes('identifier')), true);
  assert.equal(result.provenance.impactMeaning, 'binding_aware_seed_graph_reachability_not_behavioral_proof');
});
