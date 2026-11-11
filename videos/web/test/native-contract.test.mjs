import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT, BACKEND, canonical, digest, validatePreparedRender, preflight } from '../native/contract.mjs';
import { verifyArtifacts } from '../native/artifacts.mjs';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = 'a'.repeat(64);
const ref = { path: 'artifacts/data.bin', sha256: sha, bytes: 4 };
function fixture() {
  const job = {
    schema: CONTRACT, jobId: 'contract-unit-fixture', source: { commit: 'b'.repeat(40), closure: ref },
    runtime: ref, inputs: ref, prepared: { ...ref, schema: 'test-person/v1' }, simulation: { ...ref, schema: 'test-motion/v1' },
    quality: { width: 1920, height: 1080, frameCount: 120, samples: 64, fps: { numerator: 30000, denominator: 1001 }, seed: 1,
      color: { working: 'linear-rec709' }, alpha: { mode: 'opaque' }, timing: { origin: 0 }, temporal: { mode: 'sequential' },
      encoder: { codec: 'libx264', args: ['-crf', '18'] }, audio: { mode: 'none' } },
    requirements: [{ id: 'person.skin', contractSha256: sha }],
  };
  const backend = { schema: 'acp.backend-capabilities/v1', id: BACKEND, sourceCommit: 'c'.repeat(40), execution: 'vulkan-shared-wgpu',
    preparedSchemas: ['test-person/v1'], simulationSchemas: ['test-motion/v1'],
    capabilities: [{ ...job.requirements[0], status: 'qualified', evidenceSha256: sha }] };
  return { job, backend };
}

test('source compatibility retains a separate admission requirement', () => {
  const { job, backend } = fixture();
  assert.deepEqual(preflight(job, structuredClone(job), backend), {
    schema: 'acp.preflight/v1', jobId: job.jobId, jobSha256: digest(job), backendSha256: digest(backend), status: 'source-compatible', admissionRequired: true,
  });
});
test('every assigned field is immutable, including samples, audio and timing', () => {
  const { job, backend } = fixture();
  for (const change of [j => j.quality.samples--, j => j.quality.audio.mode = 'replacement', j => j.quality.timing.origin++, j => j.inputs.sha256 = 'd'.repeat(64)]) {
    const changed = structuredClone(job); change(changed);
    assert.throws(() => preflight(changed, job, backend), /immutable assigned contract/);
  }
});
test('unimplemented, unqualified, unknown and wrong-source capabilities all fail', () => {
  const { job, backend } = fixture();
  for (const capabilities of [[], [{ ...backend.capabilities[0], status: 'implemented' }], [{ ...backend.capabilities[0], contractSha256: 'd'.repeat(64) }], [{ ...backend.capabilities[0], evidenceSha256: null }]]) {
    assert.throws(() => preflight(job, job, { ...backend, capabilities }), /capability.person.skin/);
  }
});
test('asset traversal, fallback backend and unversioned simulation are rejected', () => {
  const { job, backend } = fixture();
  for (const path of ['../person.bin', '/tmp/person.bin', 'assets/../person.bin', 'a\\b', './person.bin']) {
    assert.throws(() => validatePreparedRender({ ...job, prepared: { ...job.prepared, path } }), /relative artifact path/);
  }
  assert.throws(() => preflight(job, job, { ...backend, execution: 'cpu' }), /same-device/);
  assert.throws(() => preflight(job, job, { ...backend, simulationSchemas: [] }), /unsupported schema/);
});
test('canonical identities reject non-finite data and ignore object key order', () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  for (const bad of [NaN, Infinity, undefined, { x: undefined }]) assert.throws(() => canonical(bad), /finite JSON/);
  const cyclic = {}; cyclic.self = cyclic;
  const accessor = { get x() { throw new Error('must not invoke getter'); } };
  const extra = []; extra.x = 1;
  for (const bad of [Array(1), [1, , 2], cyclic, accessor, extra, { [Symbol('ignored')]: 1 }]) {
    assert.throws(() => canonical(bad), /finite JSON/);
  }
  const shared = { a: 1 };
  assert.equal(canonical([shared, shared]), '[{"a":1},{"a":1}]');
});

test('artifact identities reject corruption, missing files and symlink escape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-contract-'));
  try {
    const { job } = fixture();
    await mkdir(join(dir, 'artifacts'));
    const data = Buffer.from('test');
    ref.sha256 = createHash('sha256').update(data).digest('hex');
    job.prepared.sha256 = job.simulation.sha256 = ref.sha256;
    await writeFile(join(dir, ref.path), data);
    await verifyArtifacts(job, dir);
    await writeFile(join(dir, ref.path), 'fail');
    await assert.rejects(verifyArtifacts(job, dir), /SHA-256 mismatch/);
    await rm(join(dir, ref.path));
    await assert.rejects(verifyArtifacts(job, dir), /ENOENT/);
    await symlink('/etc/hostname', join(dir, ref.path));
    await assert.rejects(verifyArtifacts(job, dir), /outside the immutable directory/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
