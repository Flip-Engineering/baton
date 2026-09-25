import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { AtlasCodeIndex } from '../src/atlas-index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase61-scip-${name}-`));
const sha = (value) => createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function write(base, path, content) { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); }
function fixture(name, source = 'export function value(input) { return input + 1 }\n') {
  const base = root(`${name}-base`); const artifacts = root(`${name}-artifacts`);
  write(base, 'src/value.js', source);
  const atlas = new AtlasCodeIndex({ artifactRoot: artifacts, now: () => 100 });
  return { atlas, base, artifacts };
}
async function build(f) {
  const result = await f.atlas.invoke('index.build', {}, { baseRoot: f.base, budgetTokens: 10_000 });
  return result.provenance.index_epoch;
}

test('GR2/GR8: SCIP export reports parse-error completeness as partial and reverifies one exact primary projection', async () => {
  const f = fixture('partial', 'export function broken( {\n'); const indexEpoch = await build(f); const args = { indexEpoch }; const ctx = { budgetTokens: 10_000 };
  const claim = await f.atlas.invoke('scip.export', args, ctx);

  assert.equal(claim.status, 'partial');
  assert.equal(Object.hasOwn(claim, 'cursor'), false);
  assert.ok(claim.provenance.parseErrors.total > 0);
  assert.equal(claim.provenance.parseErrors.files, 1);
  const primaries = claim.refs.filter((ref) => ref.kind === 'scip_json');
  assert.equal(primaries.length, 1);
  assert.deepEqual(claim.provenance.primaryRef, Object.fromEntries(Object.entries(primaries[0]).filter(([key]) => key !== 'path')));

  const checked = await f.atlas.reverify(claim, 'scip.export', args, ctx);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.primaryRef, claim.provenance.primaryRef);
  assert.equal(Object.hasOwn(checked.resultProjection.cost, 'wall_ms'), false);
  assert.equal(checked.resultProjection.status, 'partial');
  assert.equal(checked.resultProjectionDigest, sha(stable(checked.resultProjection)));
  assert.equal(checked.observedDigest, claim.provenance.artifactDigest, 'legacy wrapper digest remains available');
});

test('GR2/GR8: SCIP reverify rejects ambiguous and substituted primary refs even when substituted bytes are valid', async () => {
  const f = fixture('binding'); const indexEpoch = await build(f); const args = { indexEpoch }; const ctx = { budgetTokens: 10_000 };
  const claim = await f.atlas.invoke('scip.export', args, ctx); const primary = claim.refs.find((ref) => ref.kind === 'scip_json');
  await assert.rejects(f.atlas.reverify({ ...claim, refs: [...claim.refs, { ...primary }] }, 'scip.export', args, ctx), (error) => error.code === 'scip_primary_ref_invalid');

  const overlay = root('binding-overlay'); cpSync(f.base, overlay, { recursive: true }); write(overlay, 'src/other.js', 'export const other = 2\n');
  const other = await f.atlas.invoke('scip.export', args, { ...ctx, worktreeRoot: overlay }); const otherPrimary = other.refs.find((ref) => ref.kind === 'scip_json');
  const substituted = { ...claim, refs: claim.refs.map((ref) => ref.kind === 'scip_json' ? otherPrimary : ref) };
  const checked = await f.atlas.reverify(substituted, 'scip.export', args, ctx);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.primaryRef, claim.provenance.primaryRef);
});

test('GR2/GR8: occupied SCIP content addresses and digest-valid malformed SCIP artifacts fail closed', async () => {
  const f = fixture('tamper'); const indexEpoch = await build(f); const args = { indexEpoch }; const ctx = { budgetTokens: 10_000 };
  const claim = await f.atlas.invoke('scip.export', args, ctx); const primary = claim.refs.find((ref) => ref.kind === 'scip_json');
  chmodSync(primary.path, 0o644);
  await assert.rejects(f.atlas.invoke('scip.export', args, ctx), (error) => error.code === 'artifact_integrity');
  chmodSync(primary.path, 0o600);
  writeFileSync(primary.path, `${readFileSync(primary.path, 'utf8')} `);
  await assert.rejects(f.atlas.invoke('scip.export', args, ctx), (error) => error.code === 'artifact_integrity');

  const malformed = `${stable({ metadata: { version: 0 }, documents: 'not-an-array', externalSymbols: [] })}\n`; const digest = sha(malformed); const path = join(f.artifacts, 'results', `${digest}.json`);
  writeFileSync(path, malformed, { mode: 0o600 });
  const malformedRef = { handle: `art:sha256:${digest}`, kind: 'scip_json', digest, bytes: Buffer.byteLength(malformed), mediaType: 'application/scip+json', path };
  const malformedClaim = { ...claim, refs: claim.refs.map((ref) => ref.kind === 'scip_json' ? malformedRef : ref) };
  await assert.rejects(f.atlas.reverify(malformedClaim, 'scip.export', args, ctx), (error) => error.code === 'artifact_integrity');
});
