import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasStructuralDelta } from '../src/atlas-structural.mjs';
import { AtlasCpgDelta } from '../src/atlas-cpg-delta.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase61-${name}-`));
const write = (base, path, source) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), source); };
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));

function structural(before, after) {
  const beforeRoot = root('structural-before'); const afterRoot = root('structural-after'); const artifactRoot = root('structural-artifacts');
  write(beforeRoot, 'subject.mjs', before); write(afterRoot, 'subject.mjs', after);
  return {
    atlas: new AtlasStructuralDelta({ artifactRoot, maxSourceBytes: 64 * 1024 }), artifactRoot,
    args: { beforePath: 'subject.mjs', afterPath: 'subject.mjs' },
    ctx: { beforeRoot, afterRoot, budgetTokens: 100_000 },
  };
}

function cpg(before, after) {
  const beforeRoot = root('cpg-before'); const afterRoot = root('cpg-after'); const artifactRoot = root('cpg-artifacts');
  write(beforeRoot, 'subject.mjs', before); write(afterRoot, 'subject.mjs', after);
  return {
    atlas: new AtlasCpgDelta({
      artifactRoot, maxSourceBytes: 64 * 1024, maxGraphBytes: 512 * 1024, maxDeltaBytes: 512 * 1024,
      maxImpactDepth: 8, maxReachDefPairs: 4096, maxScopes: 128, maxScopeDepth: 32,
      maxBindings: 512, maxBindingOccurrences: 4096,
    }), artifactRoot,
    args: { beforePath: 'subject.mjs', afterPath: 'subject.mjs', impactDepth: 4 },
    ctx: { beforeRoot, afterRoot, budgetTokens: 100_000 },
  };
}

function assertStableVerification(verification, claim, primaryKind) {
  assert.equal(verification.ok, true);
  assert.deepEqual(Object.keys(verification.primaryRef).sort(), ['bytes', 'digest', 'handle', 'kind', 'mediaType']);
  assert.equal(verification.primaryRef.kind, primaryKind);
  assert.equal(Object.hasOwn(verification.primaryRef, 'path'), false);
  assert.equal(Object.hasOwn(verification.resultProjection.cost, 'wall_ms'), false);
  assert.equal(verification.resultProjection.cost.tokens_out, claim.cost.tokens_out);
  assert.equal(verification.resultProjection.cost.usd, claim.cost.usd);
  assert.equal(verification.resultProjection.cost.underlying, claim.cost.underlying);
  assert.equal(verification.resultProjection.refs.every((ref) => !Object.hasOwn(ref, 'path')), true);
  assert.equal(verification.resultProjectionDigest, digest(stable(verification.resultProjection)));
}

test('GR2/GR8: structural delta reloads existing artifacts and refuses digest or schema substitution', async () => {
  const f = structural('function a(){return 1}\n', 'function a(){return 2}\n');
  const claim = await f.atlas.invoke('diff.structural', f.args, f.ctx);
  writeFileSync(claim.refs[0].path, '{}\n');
  await assert.rejects(f.atlas.invoke('diff.structural', f.args, f.ctx), (error) => error.code === 'artifact_integrity');

  const malformed = '{}\n'; const malformedDigest = digest(malformed); const malformedPath = join(f.artifactRoot, `${malformedDigest}.json`);
  writeFileSync(malformedPath, malformed);
  const ref = { handle: `art:sha256:${malformedDigest}`, kind: 'structural_delta', digest: malformedDigest, bytes: Buffer.byteLength(malformed), mediaType: 'application/vnd.baton.atlas-structural+json', path: malformedPath };
  await assert.rejects(f.atlas.resume(ref, `atlas:${malformedDigest}:0`, { budgetTokens: 100 }), (error) => error.code === 'artifact_integrity');
});

test('GR2/GR8: structural truncation is executable, while parse errors remain partial', async () => {
  const before = Array.from({ length: 16 }, (_, i) => `function f${i}(){return ${i}}`).join('\n');
  const after = Array.from({ length: 16 }, (_, i) => `function f${i}(){return ${i + 1}}`).join('\n');
  const f = structural(before, after); const truncated = await f.atlas.invoke('diff.structural', f.args, { ...f.ctx, budgetTokens: 1 });
  assert.equal(truncated.status, 'needs_resume'); assert.equal(typeof f.atlas.resume, 'function');
  const resumed = await f.atlas.resume(truncated.refs[0], truncated.cursor, { budgetTokens: 100_000 });
  assert.equal(resumed.status, 'ok'); assert.ok(resumed.payload.length > 0);

  const broken = structural('function f(){return 1}', 'function f( { return 2 }');
  const partial = await broken.atlas.invoke('diff.structural', broken.args, { ...broken.ctx, budgetTokens: 1 });
  assert.equal(partial.status, 'partial'); assert.equal(Object.hasOwn(partial, 'cursor'), false);
});

test('GR2/GR8: structural reverify binds one stable primary ref and volatility-free result projection', async () => {
  const f = structural('function a(){return 1}\n', 'function a(){return 2}\n');
  const claim = await f.atlas.invoke('diff.structural', f.args, f.ctx);
  const verified = await f.atlas.reverify(claim, 'diff.structural', f.args, f.ctx);
  assertStableVerification(verified, claim, 'structural_delta');

  const volatile = clone(claim); volatile.cost.wall_ms += 123_456;
  assert.equal((await f.atlas.reverify(volatile, 'diff.structural', f.args, f.ctx)).ok, true, 'wall time is not semantic authority');
  const duplicate = clone(claim); duplicate.refs.push(clone(claim.refs[0]));
  assert.equal((await f.atlas.reverify(duplicate, 'diff.structural', f.args, f.ctx)).ok, false, 'primary selection must be unique');
  const missing = clone(claim); missing.refs = [];
  assert.equal((await f.atlas.reverify(missing, 'diff.structural', f.args, f.ctx)).ok, false, 'a primary ref is mandatory');
  const substituted = clone(claim); substituted.refs[0].bytes += 1;
  assert.equal((await f.atlas.reverify(substituted, 'diff.structural', f.args, f.ctx)).ok, false, 'the exact primary projection is bound');
});

test('GR2/GR8: CPG delta reloads existing artifacts and refuses digest or schema substitution', async () => {
  const f = cpg('function a(){return 1}\n', 'function a(){return 2}\n');
  const claim = await f.atlas.invoke('cpg.delta', f.args, f.ctx);
  writeFileSync(claim.refs[0].path, `${readFileSync(claim.refs[0].path, 'utf8')} `);
  await assert.rejects(f.atlas.invoke('cpg.delta', f.args, f.ctx), (error) => error.code === 'artifact_integrity');

  const malformed = '{}\n'; const malformedDigest = digest(malformed); const malformedPath = join(f.artifactRoot, `${malformedDigest}.json`);
  writeFileSync(malformedPath, malformed);
  const ref = { handle: `art:sha256:${malformedDigest}`, kind: 'cpg_delta', digest: malformedDigest, bytes: Buffer.byteLength(malformed), mediaType: 'application/vnd.baton.atlas-cpg-delta+json', path: malformedPath };
  await assert.rejects(f.atlas.resume(ref, `atlas-cpg-delta:${malformedDigest}:0`, { budgetTokens: 100 }), (error) => error.code === 'artifact_integrity');
});

test('GR2/GR8: CPG parse errors remain partial even when inline records exceed budget', async () => {
  const f = cpg('function a(){return 1}\n', 'function a( { let x=2; return x }');
  const partial = await f.atlas.invoke('cpg.delta', f.args, { ...f.ctx, budgetTokens: 1 });
  assert.equal(partial.status, 'partial'); assert.equal(Object.hasOwn(partial, 'cursor'), false);
  assert.ok(partial.provenance.parseErrors.after > 0);
});

test('GR2/GR8: CPG reverify binds one stable primary ref and volatility-free result projection', async () => {
  const f = cpg('function a(x){return x}\n', 'function a(x){let y=x+1; return y}\n');
  const claim = await f.atlas.invoke('cpg.delta', f.args, { ...f.ctx, budgetTokens: 1 });
  const verified = await f.atlas.reverify(claim, 'cpg.delta', f.args, f.ctx);
  assertStableVerification(verified, claim, 'cpg_delta');
  assert.equal(verified.resultProjection.refs.length, 3, 'stable projection retains the primary and both graph refs');

  const volatile = clone(claim); volatile.cost.wall_ms += 987_654;
  assert.equal((await f.atlas.reverify(volatile, 'cpg.delta', f.args, f.ctx)).ok, true);
  const duplicate = clone(claim); duplicate.refs.push(clone(claim.refs[0]));
  assert.equal((await f.atlas.reverify(duplicate, 'cpg.delta', f.args, f.ctx)).ok, false);
  const missing = clone(claim); missing.refs = claim.refs.filter((ref) => ref.kind !== 'cpg_delta');
  assert.equal((await f.atlas.reverify(missing, 'cpg.delta', f.args, f.ctx)).ok, false);
  const substituted = clone(claim); substituted.refs[0].mediaType = 'application/json';
  assert.equal((await f.atlas.reverify(substituted, 'cpg.delta', f.args, f.ctx)).ok, false);
});
