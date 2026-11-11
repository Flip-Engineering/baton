// Synthetic descriptor/byte tests only. No person construction or rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, CONTRACT } from '../native/contract.mjs';
import { exportPrepared } from '../native/prepared.mjs';
import { encodePreparedPayload } from '../native/prepared-container.mjs';
import { RENDER_PLAN, capturedComponents, inventoryDigest, validatePreparedBinding } from '../native/prepared-binding.mjs';
import { verifyArtifacts } from '../native/artifacts.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ref = (path, bytes) => ({ path, sha256: sha(bytes), bytes: bytes.length });
const f32 = (...v) => new Float32Array(v);
const buf = (typed, itemSize) => ({ typed, type: typed.constructor.name, length: typed.length, itemSize });
const identityMatrix = () => f32(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
function fixture() {
  const files = new Map(['closure', 'runtime', 'inputs', 'simulation'].map(n => [n, Buffer.from(n)]));
  const r = n => ref(n, files.get(n));
  const job = { schema: CONTRACT, jobId: 'binding-fixture',
    source: { commit: 'a'.repeat(40), closure: r('closure') }, runtime: r('runtime'), inputs: r('inputs'),
    simulation: { ...r('simulation'), schema: 'synthetic-motion/v1' },
    quality: { width: 1920, height: 1080, frameCount: 48, samples: 64, fps: { numerator: 24, denominator: 1 }, seed: 2015,
      color: { working: 'linear-rec709' }, alpha: { mode: 'opaque' }, timing: { origin: 0 }, temporal: { mode: 'sequential' },
      encoder: { codec: 'libx264', args: ['-crf', '18'] }, audio: { mode: 'none' } },
  };
  const { manifest, buffers } = exportPrepared({
    identity: { sourceCommit: job.source.commit, runtime: { three: 'synthetic' }, runtimeSha256: job.runtime.sha256,
      inputsSha256: job.inputs.sha256, closureSha256: job.source.closure.sha256 },
    persons: [{ name: 'byte-fixture',
      joints: { names: ['root'], parents: [-1], bindHeads: f32(0, 0, 0), bindLocal: f32(0, 0, 0), bindLocalSource: 'bindPos', groupScale: 1, inverseBinds: identityMatrix() },
      meshes: [{ name: 'fixture', kind: 'other', vertexCount: 3, indexWidth: 32, matrix: identityMatrix(),
        attributes: { position: buf(f32(0, 0, 0, 1, 0, 0, 0, 1, 0), 3), index: buf(new Uint32Array([0, 1, 2]), 1) },
        material: { kind: 'physical', params: {}, textures: [], shader: { key: 'fixture', glslSha256: 'd'.repeat(64), defines: [] } } }],
      channels: { cloth: [], hair: [], eyes: null, face: ['synthetic'] },
    }],
  });
  const plan = { schema: RENDER_PLAN, quality: structuredClone(job.quality), simulation: structuredClone(job.simulation),
    inventorySha256: inventoryDigest(manifest), components: [
      ...capturedComponents(manifest).map((c, i) => ({ ...structuredClone(c), id: `captured.${i}` })),
      { id: 'effects.none', kind: 'effect', contract: { mode: 'none', source: 'synthetic-only' } },
      { id: 'output.exact', kind: 'output', contract: structuredClone(job.quality) },
    ] };
  manifest.renderPlan = plan;
  job.renderPlanSha256 = digest(plan);
  job.requirements = plan.components.map(c => ({ id: c.id, contractSha256: digest(c.contract) }));
  const encoded = encodePreparedPayload(manifest, buffers, 'payload.bin');
  files.set('prepared.json', Buffer.from(encoded.json)); files.set('payload.bin', encoded.bin);
  job.prepared = { ...r('prepared.json'), schema: 'acp.prepared/v1' };
  return { job, document: encoded.document, files };
}

test('prepared contents bind exact assignment but retain source-completeness and admission gates', () => {
  const { job, document } = fixture();
  assert.deepEqual(validatePreparedBinding(job, document), { schema: 'acp.prepared-binding/v1', status: 'content-bound',
    renderPlanSha256: job.renderPlanSha256, sourceCompletenessRequired: true, admissionRequired: true });
});

test('source, runtime, input and closure mismatches fail even when job hashes the supplied document', () => {
  for (const key of ['sourceCommit', 'runtimeSha256', 'inputsSha256', 'closureSha256']) {
    const { job, document } = fixture(); document.identity[key] = 'f'.repeat(key === 'sourceCommit' ? 40 : 64);
    assert.throws(() => validatePreparedBinding(job, document), new RegExp(key));
  }
});

test('omitted, duplicated and invented requirements cannot cover captured materials', () => {
  for (const mutate of [
    (j, p) => { p.components = p.components.filter(c => c.kind !== 'material'); j.requirements = j.requirements.filter(c => c.id !== 'captured.2'); },
    (j, p) => { p.components.push(structuredClone(p.components[2])); },
    (j, p) => { p.components[2].target = 'persons[99].meshes[99].material'; },
    (j, p) => { p.components[2].contract.params.color = 'wrong'; j.requirements[2].contractSha256 = digest(p.components[2].contract); },
    (j, p) => { p.components = p.components.filter(c => c.kind !== 'effect'); j.requirements = j.requirements.filter(c => c.id !== 'effects.none'); },
  ]) {
    const { job, document } = fixture(); mutate(job, document.renderPlan); job.renderPlanSha256 = digest(document.renderPlan);
    assert.throws(() => validatePreparedBinding(job, document));
  }
});

test('render plan cannot lower quality, replace simulation, or omit captured meshes', () => {
  for (const mutate of [
    d => { d.renderPlan.quality.samples = 1; },
    d => { d.renderPlan.simulation.sha256 = 'f'.repeat(64); },
    d => { d.persons[0].meshes.pop(); },
    d => { delete d.renderPlan; },
  ]) {
    const { job, document } = fixture(); mutate(document);
    if (document.renderPlan) job.renderPlanSha256 = digest(document.renderPlan);
    assert.throws(() => validatePreparedBinding(job, document));
  }
});

test('real prepared schema verifies transitive payload and material texture containment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prepared-binding-'));
  try {
    const { job, document, files } = fixture();
    for (const [name, bytes] of files) await writeFile(join(root, name), bytes);
    await verifyArtifacts(job, root);
    const payload = Buffer.from(files.get('payload.bin')); payload[0] ^= 1;
    await writeFile(join(root, 'payload.bin'), payload);
    await assert.rejects(verifyArtifacts(job, root), /SHA-256/);
    await rm(join(root, 'payload.bin')); await symlink('/etc/hostname', join(root, 'payload.bin'));
    await assert.rejects(verifyArtifacts(job, root), /outside/);
    await rm(join(root, 'payload.bin')); await writeFile(join(root, 'payload.bin'), files.get('payload.bin'));
    const texture = { slot: 'base', colorSpace: 'srgb', path: 'texture.bin', bytes: 3, sha256: sha('tex') };
    document.persons[0].meshes[0].material.textures.push(texture);
    document.renderPlan.components[2].contract = structuredClone(document.persons[0].meshes[0].material);
    document.renderPlan.inventorySha256 = inventoryDigest(document);
    job.requirements[2].contractSha256 = digest(document.renderPlan.components[2].contract);
    job.renderPlanSha256 = digest(document.renderPlan);
    const bytes = Buffer.from(JSON.stringify(document)); job.prepared = { ...ref('prepared.json', bytes), schema: 'acp.prepared/v1' };
    await writeFile(join(root, 'prepared.json'), bytes);
    await assert.rejects(verifyArtifacts(job, root), /ENOENT/);
    await symlink('/etc/hostname', join(root, 'texture.bin'));
    await assert.rejects(verifyArtifacts(job, root), /outside/);
    await rm(join(root, 'texture.bin')); await writeFile(join(root, 'texture.bin'), 'tex');
    await verifyArtifacts(job, root);
  } finally { await rm(root, { recursive: true, force: true }); }
});
