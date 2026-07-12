import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AtlasRepresentationCeiling } from '../src/index.mjs';

const artifactRoot = () => mkdtempSync(join(tmpdir(), 'baton-representation-ceiling-'));
const make = (opts = {}) => new AtlasRepresentationCeiling({ artifactRoot: artifactRoot(), maxArtifactBytes: 64 * 1024, ...opts });
const ctx = { budgetTokens: 1000 };

test('RG1/RG2: the card and all JS/TS-family extensions stop honestly at R3', async () => {
  const atlas = make(); const card = atlas.card();
  assert.equal(card.name, 'atlas-representation-ceiling');
  assert.equal(card.ops['representation.ceiling'].deterministic, true);
  assert.ok(card.limitations.includes('produces no compiler IR'));
  for (const extension of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) {
    const result = await atlas.invoke('representation.ceiling', { path: `src/a.${extension}` }, ctx);
    assert.equal(result.payload[0].maximumRung, 'R3');
    assert.equal(result.payload[0].languageFamily, 'javascript-typescript');
  }
});

test('RG2/RG6: false compiler-IR and translation-validation operations fail typed without CPG relabeling', async () => {
  const atlas = make();
  for (const op of ['ir.build', 'ir.delta', 'tv.validate']) {
    await assert.rejects(atlas.invoke(op, { path: 'impl/src/coordinator.mjs' }, ctx), (error) => {
      assert.equal(error.code, 'rung_ceiling'); assert.equal(error.maximumRung, 'R3');
      assert.equal(error.decisionId, 'phase24-js-ts-r3-ceiling'); return true;
    });
  }
});

test('RG3/RG6: the ACI result and artifact identify a policy decision, never compiler IR', async () => {
  const atlas = make(); const result = await atlas.invoke('representation.ceiling', { path: 'impl/src/coordinator.mjs' }, ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.op, 'representation.ceiling'); assert.equal(result.refs[0].kind, 'representation_policy');
  assert.match(result.refs[0].mediaType, /policy/); assert.doesNotMatch(JSON.stringify(result), /compiler_ir|llvm|mlir|mir_module/);
  assert.equal(result.provenance.semanticDeltaMeaning, 'structural_and_cpg_delta_are_review_signals_not_translation_validation');
  const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8')); assert.equal(artifact.schemaVersion, 1); assert.equal(artifact.decisionId, 'phase24-js-ts-r3-ceiling');
});

test('RG4: deployment bounds, cancellation, confinement, and language scope fail typed', async () => {
  assert.throws(() => new AtlasRepresentationCeiling({ artifactRoot: artifactRoot() }), /maxArtifactBytes/);
  const atlas = make({ maxArtifactBytes: 32 });
  await assert.rejects(atlas.invoke('representation.ceiling', { path: 'src/a.js' }, ctx), (error) => error.code === 'artifact_too_large');
  const normal = make(); const abort = new AbortController(); abort.abort();
  await assert.rejects(normal.invoke('representation.ceiling', { path: 'src/a.js' }, { ...ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
  await assert.rejects(normal.invoke('representation.ceiling', { path: '../a.js' }, ctx), (error) => error.code === 'path_escape');
  await assert.rejects(normal.invoke('representation.ceiling', { path: 'src/a.rs' }, ctx), (error) => error.code === 'unsupported_language');
});

test('RG5: bounded policy results resume, reject tamper, and reverify deterministically', async () => {
  const atlas = make(); const args = { path: 'impl/src/coordinator.mjs' };
  const bounded = await atlas.invoke('representation.ceiling', args, { budgetTokens: 1 }); assert.equal(bounded.status, 'needs_resume'); assert.deepEqual(bounded.payload, []);
  const resumed = await atlas.resume(bounded.refs[0], bounded.cursor, ctx); assert.equal(resumed.status, 'ok'); assert.equal(resumed.payload[0].maximumRung, 'R3');
  assert.equal((await atlas.reverify(bounded, 'representation.ceiling', args, ctx)).ok, true);
  writeFileSync(bounded.refs[0].path, `${readFileSync(bounded.refs[0].path, 'utf8')} `);
  await assert.rejects(atlas.resume(bounded.refs[0], bounded.cursor, ctx), (error) => error.code === 'artifact_integrity');
});
