// Native backend adapter tests (farm-adapter owner). No rendering, no GPU,
// no farm network: fakes stand in for the renderer CLI and ffmpeg, while
// admission, receipts and verdicts run against the REAL lead contract.
// Run: node --test test/native-farm-adapter.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  admit, buildRenderDescriptor, checkAllocation, checkAssignedMedia, checkRendererReceipt, encodeMedia, heldForBackend, holdNote,
  launchRender, mapRenderExit, normalizeUuid, parseSpan, probeMaster, releaseHold, resolveClaimActor,
  runFinishRender, runMakeAudio,
} from '../native/adapter.mjs';
import { BACKEND_ID, HELD_EXIT, FAILED_EXIT, JOB_ID_RE, RECIPE, SCENE_RE, buildJob, deliverableNames, postArgs } from '../native/recipe.mjs';
import {
  failureReceipt, finalize, holdReceipt, openReceipts, readHolds,
  REQUIRED_STAGES, TIMING_KEYS, UnfinishedError,
} from '../native/receipts.mjs';
import { mockBackend } from '../native/mock.mjs';

const run = promisify(execFile);
const HERE = new URL('.', import.meta.url).pathname;
const NATIVE = path.join(HERE, '..', 'native');
const U1 = 'GPU-AAAAAAAA-0000-4000-8000-000000000001';
const U1LOW = 'GPU-aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'GPU-BBBBBBBB-0000-4000-8000-000000000002';
const ALLOC1 = { wantGpus: 1, requireGpu: true, env: { CUDA_VISIBLE_DEVICES: U1 } };
const CAP = { id: 'std.material.pbr/v1', contractSha256: '0'.repeat(64) };

function writeAsset(root, name, body) {
  const data = Buffer.from(body);
  fs.writeFileSync(path.join(root, name), data);
  return { path: name, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
}

// A fully valid prepared-render job plus matching backend: admission runs
// the real contract, not a stub.
function fullFixture(jobId = 'job-1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-assets-'));
  const job = {
    schema: 'acp.prepared-render/v1', jobId,
    source: { commit: 'b'.repeat(40), closure: writeAsset(root, 'closure.bin', `closure ${jobId}`) },
    runtime: writeAsset(root, 'runtime.bin', `runtime ${jobId}`),
    inputs: writeAsset(root, 'inputs.bin', `inputs ${jobId}`),
    prepared: { ...writeAsset(root, 'prepared.bin', `prepared ${jobId}`), schema: 'acp.prepared-person/v1' },
    simulation: { ...writeAsset(root, 'sim.bin', `sim ${jobId}`), schema: 'acp.simulation/v1' },
    quality: { width: 1920, height: 1080, frameCount: 48, samples: 64, fps: { numerator: 60, denominator: 1 }, seed: 7,
      color: { working: 'linear-rec709' }, alpha: { mode: 'opaque' }, timing: { origin: 0 }, temporal: { mode: 'sequential' },
      encoder: { codec: 'libx264', args: ['-crf', '16'] }, audio: { mode: 'finished-once' } },
    requirements: [{ ...CAP }],
  };
  return { root, job, assigned: structuredClone(job), backend: mockBackend() };
}

function contractError(issues) {
  const error = new Error(issues.map((i) => `${i.path}: ${i.reason}`).join('\n'));
  error.issues = issues;
  return error;
}

await test('composed admission runs the real contract and binds digests', async () => {
  const { root, job, assigned, backend } = fullFixture();
  const verdict = await admit({ job, assigned, backend, assetRoot: root, allocation: ALLOC1, attemptId: 'a1' });
  assert.equal(verdict.verdict, 'admitted');
  assert.match(verdict.preflight.jobSha256, /^[a-f0-9]{64}$/);
  assert.match(verdict.preflight.backendSha256, /^[a-f0-9]{64}$/);
  assert.equal(verdict.preflight.attemptId, 'a1');
  assert.deepEqual(verdict.allocation.uuids, [normalizeUuid(U1)]);
});

await test('composed unknown capability holds; tampered assignment fails', async () => {
  const { root, job, assigned, backend } = fullFixture();
  const unknown = structuredClone(backend);
  unknown.capabilities = [];
  const held = await admit({ job, assigned, backend: unknown, assetRoot: root, allocation: ALLOC1 });
  assert.equal(held.verdict, 'held');
  const tampered = structuredClone(assigned);
  tampered.quality.samples = 32;
  const failed = await admit({ job, assigned: tampered, backend, assetRoot: root, allocation: ALLOC1 });
  assert.equal(failed.verdict, 'failed');
});

await test('mixed capability gap plus bad backend descriptor fails, not holds', async () => {
  const { root, job, assigned, backend } = fullFixture();
  const bad = structuredClone(backend);
  bad.capabilities = [];
  bad.execution = 'cpu';
  const verdict = await admit({ job, assigned, backend: bad, assetRoot: root, allocation: ALLOC1 });
  assert.equal(verdict.verdict, 'failed');
  assert.ok(verdict.reasons.some((r) => r.path === 'backend.execution'));
});

await test('corrupt asset bytes fail before preflight runs', async () => {
  const { root, job, assigned, backend } = fullFixture();
  fs.writeFileSync(path.join(root, 'prepared.bin'), Buffer.from('corrupt'));
  let called = false;
  const verdict = await admit({
    job, assigned, backend, assetRoot: root, allocation: ALLOC1,
    preflightFn: async (...a) => { called = true; return a; },
  });
  assert.equal(verdict.verdict, 'failed');
  assert.equal(verdict.stage, 'assets');
  assert.equal(called, false);
});

await test('allocation requires canonical UUIDs, rejects indexes/prefixes/dups', () => {
  const env = (v, n = 1) => ({ wantGpus: n, requireGpu: true, env: { CUDA_VISIBLE_DEVICES: v } });
  for (const bad of ['0,1', 'GPU-deadbeef', 'GPU---------', `${U1},${U1LOW}`, U1]) {
    const r = checkAllocation(env(bad, bad === U1 ? 2 : 1));
    assert.equal(r.ok, false, bad);
  }
  assert.match(checkAllocation(env('0')).reason, /canonical GPU UUID/);
  const lower = checkAllocation(env(U1LOW));
  assert.equal(lower.ok, true);
  assert.deepEqual(lower.uuids, [normalizeUuid(U1)]);
  assert.equal(checkAllocation({ wantGpus: 1, requireGpu: true, env: { CUDA_VISIBLE_DEVICES: '' } }).ok, false);
});

await test('already-held backend digest short-circuits re-admission', async () => {
  const { root, job, assigned, backend } = fullFixture();
  let called = false;
  const first = await admit({
    job, assigned, backend, assetRoot: root, allocation: ALLOC1,
    preflightFn: async () => { called = true; throw contractError([{ path: 'capability.x', reason: 'no' }]); },
  });
  assert.equal(first.verdict, 'held');
  const holds = [{ jobSha256: first.jobSha256, backendSha256: first.backendSha256, attemptId: 'a1' }];
  called = false;
  const second = await admit({ job, assigned, backend, assetRoot: root, allocation: ALLOC1, priorHolds: holds });
  assert.equal(second.verdict, 'held');
  assert.match(second.reasons[0].reason, /already held/);
  assert.equal(called, false);
  assert.equal(heldForBackend([{ event: holdNote({ backendSha256: first.backendSha256, attemptId: 'a1', reasons: first.reasons }) }], first.backendSha256), true);
  assert.equal(heldForBackend([], first.backendSha256), false);
});

await test('releaseHold touches history then releases, in order', async () => {
  const calls = [];
  await releaseHold({ farmPy: 'farm.py', jobId: 'j1', by: 'w', note: 'n', runFn: async (...a) => { calls.push(a); } });
  assert.deepEqual(calls.map((c) => c[1].slice(0, 3)), [['farm.py', 'touch', 'j1'], ['farm.py', 'release', 'j1']]);
  assert.ok(calls[0][1].includes('n'));
});

await test('descriptor unions runtime fields with adapter binding fields', async () => {
  const { root, job } = fullFixture('d1');
  const descriptor = buildRenderDescriptor({
    job, assetRoot: root,
    paths: { job: '/o/job.json', assigned: '/o/assigned.json', backend: '/o/backend.json' },
    jobSha256: 'a'.repeat(64), backendSha256: 'b'.repeat(64), attemptId: 'a1',
    range: { start: 0, end: 48 }, masterOut: '/d/w.mp4', uuid: U1,
    admissionReceipt: 'adm-1',
  });
  assert.equal(descriptor.schema, 'acp.render-descriptor/v1');
  assert.equal(descriptor.job_id, 'd1');
  assert.equal(descriptor.source_commit, 'b'.repeat(40));
  assert.deepEqual(descriptor.range, { start: 0, end: 48 });
  assert.equal(descriptor.renderer, 'gpu');
  assert.equal(descriptor.encoder.name, 'libx264');
  assert.equal(descriptor.encoder.crf, 16);
  assert.deepEqual(descriptor.encoder_args_exact, ['-crf', '16']);
  assert.deepEqual(descriptor.resolution, [1920, 1080]);
  assert.equal(descriptor.fps, 60);
  assert.equal(descriptor.samples, 64);
  assert.deepEqual(descriptor.effects, ['std.material.pbr/v1']);
  assert.equal(descriptor.device_uuid, U1);
  assert.equal(descriptor.admission_receipt, 'adm-1');
  assert.equal(descriptor.job_sha256, 'a'.repeat(64));
  assert.equal(descriptor.attempt_id, 'a1');
  assert.equal(descriptor.job_path, '/o/job.json');
  assert.equal(descriptor.assets_root, root);
});

await test('launchRender invokes one descriptor by path with the runtime env', async () => {
  let seen = null;
  const res = await launchRender({
    cli: ['fframes-native'], descriptorPath: '/o/descriptor.json', uuid: U1,
    runFn: async (...a) => { seen = a; return { stdout: '{}' }; },
  });
  assert.equal(res.code, 0);
  assert.deepEqual(seen[1], ['--job', '/o/descriptor.json', '--emit-receipt']);
  assert.equal(seen[2].env.FFRAMES_REQUIRE_GPU, '1');
  assert.equal(seen[2].env.FFRAMES_REQUIRE_SAME_DEVICE, '1');
  assert.equal(seen[2].env.FFRAMES_VULKAN_UUID, U1);
  assert.equal(seen[2].env.FFRAMES_ENCODER, 'libx264');
  assert.equal(seen[2].env.VK_ICD_FILENAMES, '/usr/share/vulkan/icd.d/nvidia_icd.json');
  const failed = await launchRender({
    cli: ['fframes-native'], descriptorPath: '/o/d.json', uuid: U1,
    runFn: async () => { const e = new Error('nope'); e.code = 3; e.stdout = ''; return Promise.reject(e); },
  });
  assert.equal(failed.code, 3);
});

await test('exit codes map to held/failed/rendered without silence', () => {
  assert.equal(mapRenderExit({ code: 0, stdout: '{"a":1}' }).verdict, 'rendered');
  assert.equal(mapRenderExit({ code: 0, stdout: 'not json' }).verdict, 'failed');
  assert.equal(mapRenderExit({ code: 3, stdout: '' }).verdict, 'held');
  assert.equal(mapRenderExit({ code: 4, stdout: '' }).verdict, 'held');
  assert.equal(mapRenderExit({ code: 5, stdout: '' }).verdict, 'failed');
  assert.equal(mapRenderExit({ code: 2, stdout: '' }).verdict, 'failed');
});

const PROBE_48S = 'Duration: 00:00:00.80, start: 0.000000, bitrate: 1 kb/s\nStream #0:0: Video: h264\nStream #0:1: Audio: aac';

await test('encodeMedia stream-copies share audio and returns a real probe', async () => {
  const calls = [];
  const runFn = async (bin, argv) => {
    calls.push([bin, argv]);
    if (argv.includes('-hide_banner')) {
      const e = new Error('probe done');
      e.code = 1;
      e.stderr = PROBE_48S;
      throw e;
    }
    return { stdout: '' };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-enc-'));
  const res = await encodeMedia({ master: '/m.mp4', deliverDir: dir, id: 'w', frameCount: 48, fps: 60, runFn });
  assert.equal(res.probe.hasAudio, true);
  assert.equal(res.probe.durationS, 0.8);
  const shareArgv = calls[0][1].join(' ');
  assert.ok(shareArgv.includes('-c:v') && shareArgv.includes('libx264') && shareArgv.includes('bt709'));
  assert.ok(shareArgv.includes('-c:a copy'), 'share audio must be stream-copied, never transcoded');
  assert.ok(calls[1][1].join(' ').includes('tile=16x1'));
  await assert.rejects(encodeMedia({
    master: '/m.mp4', deliverDir: dir, id: 'w', frameCount: 48, fps: 60,
    runFn: async () => { const e = new Error('no ffmpeg'); e.code = 127; throw e; },
  }), /share encode failed/);
});

await test('probeMaster parses streams and duration; assigned check rejects mismatch', async () => {
  const probe = async (stderr) => probeMaster({
    master: '/m.mp4',
    runFn: async () => { const e = new Error('probe done'); e.code = 1; e.stderr = stderr; throw e; },
  });
  const good = await probe(PROBE_48S);
  assert.deepEqual(checkAssignedMedia({ probe: good, frameCount: 48, fps: 60 }), []);
  const wrongLength = await probe(PROBE_48S);
  assert.match(checkAssignedMedia({ probe: wrongLength, frameCount: 480, fps: 60 }).join(), /duration/);
  const silent = await probe('Duration: 00:00:00.80\nStream #0:0: Video: h264\n');
  assert.match(checkAssignedMedia({ probe: silent, frameCount: 48, fps: 60 }).join(), /audio/);
  const novideo = await probe('Duration: 00:00:00.80\nStream #0:1: Audio: aac\n');
  assert.match(checkAssignedMedia({ probe: novideo, frameCount: 48, fps: 60 }).join(), /video/);
  const nodur = await probe('Stream #0:0: Video: h264\nStream #0:1: Audio: aac\n');
  assert.match(checkAssignedMedia({ probe: nodur, frameCount: 48, fps: 60 }).join(), /unreadable/);
  const nan = { ...(await probe(PROBE_48S)), durationS: NaN };
  assert.match(checkAssignedMedia({ probe: nan, frameCount: 48, fps: 60 }).join(), /unreadable/);
});

await test('audio flow reuses the pipeline steps with explicit paths', async () => {
  const calls = [];
  const runFn = async (...a) => { calls.push(a); return {}; };
  const { wav } = await runMakeAudio({ pythonBin: 'python3', makeAudioPy: '/v/web/audio/make_audio.py', scene: 'closer', videosDir: '/v', runFn });
  assert.equal(wav, path.join('/v', 'out', '.closer.wav'));
  assert.deepEqual(calls[0].slice(0, 2), ['python3', ['/v/web/audio/make_audio.py', 'closer', '--quiet']]);
  assert.equal(calls[0][2].cwd, '/v');
  const fin = await runFinishRender({
    pythonBin: 'python3', scene: 'closer', wav: '/v/out/.closer.wav', lockS: 0.8, toS: 0.8,
    videoIn: '/f/w.video.mp4', masterOut: '/d/w.mp4', reportOut: '/d/w.finish.json', cwd: '/v', runFn,
  });
  const argv = fin.argv.join(' ');
  for (const flag of ['-m engine.finish render', '--scene closer', '--wav /v/out/.closer.wav', '--lock 0.8', '--from 0', '--to 0.8',
    '--video /f/w.video.mp4', '-o /d/w.mp4', '--report /d/w.finish.json']) {
    assert.ok(argv.includes(flag), flag);
  }
});

await test('runMakeAudio rejects a resolved nonzero exit instead of ignoring it', async () => {
  await assert.rejects(runMakeAudio({
    pythonBin: 'python3', makeAudioPy: '/v/web/audio/make_audio.py', scene: 'closer', videosDir: '/v',
    runFn: async () => ({ code: 3, stderr: 'audio: closer: REFUSED: nothing written' }),
  }), /make_audio failed for scene closer/);
  const ok = await runMakeAudio({
    pythonBin: 'python3', makeAudioPy: '/v/web/audio/make_audio.py', scene: 'closer', videosDir: '/v',
    runFn: async () => ({ code: 0 }),
  });
  assert.equal(ok.wav, path.join('/v', 'out', '.closer.wav'));
});

await test('span defaults to the full job and rejects bad bounds', () => {
  assert.deepEqual(parseSpan(undefined, 48), { start: 0, end: 48 });
  assert.deepEqual(parseSpan('0-24', 48), { start: 0, end: 24 });
  for (const bad of ['24', '0-', '-1-10', '10-10', '0-49', 'a-b', '0-24-48']) {
    assert.throws(() => parseSpan(bad, 48), /span|START-END/, bad);
  }
});

await test('deliverable names are pinned id-named files', () => {
  assert.deepEqual(deliverableNames('n1'), ['n1.mp4', 'n1_share.mp4', 'n1_sheet.jpg', 'n1.finish.json', 'receipt.json']);
  const job = buildJob({ id: 'n1', scene: 'closer', end: 45 });
  assert.deepEqual(job.outputs, deliverableNames('n1').map((n) => `videos/out/native/n1/deliver/${n}`));
});

await test('claim actor resolves from the queue record, never a poster value', async () => {
  const show = (doc) => async () => ({ stdout: JSON.stringify(doc) });
  assert.equal(await resolveClaimActor({ farmPy: 'farm.py', qid: 'q1', runFn: show({ claim: { by: 'worker-3' } }) }), 'worker-3');
  await assert.rejects(resolveClaimActor({ farmPy: 'farm.py', qid: 'q1', runFn: show({ state: 'open', claim: null }) }), /no claimant/);
  await assert.rejects(resolveClaimActor({ farmPy: 'farm.py', qid: 'q1', runFn: async () => ({ stdout: 'not json' }) }), /did not return job JSON/);
  await assert.rejects(resolveClaimActor({
    farmPy: 'farm.py', qid: 'q1',
    runFn: async () => { const e = new Error('gone'); e.stderr = 'no such job'; throw e; },
  }), /cannot read queue job/);
});

await test('id and scene grammars refuse shell-unsafe text', () => {
  for (const bad of ['', '../x', 'a/b', 'a b', 'a$b', 'x'.repeat(97)]) assert.equal(JOB_ID_RE.test(bad), false, bad);
  assert.equal(JOB_ID_RE.test('n1-closer_45.mp4'.replace('.mp4', '')), true);
  for (const bad of ['', '../x', 'a-b', 'a b']) assert.equal(SCENE_RE.test(bad), false, bad);
  assert.equal(SCENE_RE.test('closer'), true);
  assert.throws(() => buildJob({ id: '../x', scene: 'closer', end: 45 }), /unsafe id/);
  assert.throws(() => buildJob({ id: 'n1', scene: 'a-b', end: 45 }), /unsafe scene/);
});

function fullReceipt(framesDir, identity, overrides = {}) {
  fs.mkdirSync(framesDir, { recursive: true });
  fs.writeFileSync(path.join(framesDir, 'renderer-receipt.json'), JSON.stringify({
    schema: 'acp.renderer-receipt/v1', status: 'ok', execution: 'vulkan-shared-wgpu',
    jobSha256: identity.jobSha256, backendSha256: identity.backendSha256,
    attemptId: identity.attemptId, uuids: identity.uuids, ...overrides,
  }));
}

const IDENT = () => ({ jobSha256: 'a'.repeat(64), backendSha256: 'b'.repeat(64), attemptId: 'a1', uuids: [U1] });

await test('renderer receipt binding rejects stale, foreign, failed and CPU receipts', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
  const ident = IDENT();
  let d = dir();
  assert.equal(checkRendererReceipt(d, ident).ok, false);
  const cases = [
    [{ schema: 'wrong' }, /wrong receipt schema/],
    [{ status: 'failed' }, /not ok/],
    [{ execution: 'cpu' }, /same-device/],
    [{ jobSha256: '0'.repeat(64) }, /job digest/],
    [{ backendSha256: '0'.repeat(64) }, /backend digest/],
    [{ attemptId: 'old' }, /attempt mismatch/],
    [{ uuids: [U2] }, /admitted/],
  ];
  for (const [overrides, pattern] of cases) {
    d = dir();
    fullReceipt(d, ident, overrides);
    const r = checkRendererReceipt(d, ident);
    assert.equal(r.ok, false, JSON.stringify(overrides));
    assert.match(r.reason, pattern);
  }
  d = dir();
  fullReceipt(d, ident, { peakMemoryBytes: 123 });
  const ok = checkRendererReceipt(d, ident);
  assert.equal(ok.ok, true);
  assert.equal(ok.peakMemoryBytes, 123);
});

await test('receipt accepts the contract singular uuid and binds admission receipt', () => {
  const ident = IDENT();
  let d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
  fullReceipt(d, ident, { uuids: undefined, uuid: U1 });
  assert.equal(checkRendererReceipt(d, ident).ok, true);
  d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
  fullReceipt(d, ident, { uuids: undefined, uuid: U2 });
  assert.match(checkRendererReceipt(d, ident).reason, /admitted/);
  d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
  fullReceipt(d, ident, { admission_receipt: 'adm-1' });
  assert.equal(checkRendererReceipt(d, { ...ident, admissionReceipt: 'adm-1' }).ok, true);
  assert.match(checkRendererReceipt(d, { ...ident, admissionReceipt: 'adm-2' }).reason, /admission receipt mismatch/);
  assert.equal(checkRendererReceipt(d, ident).ok, true, 'absent expectation means no check');
});

await test('malformed UUID entries are rejected, never filtered away', () => {
  const ident = IDENT();
  for (const uuids of [[U1, 'not-a-GPU'], [U1, 42], [U1, 'GPU-deadbeef'], [U1, null]]) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
    fullReceipt(d, ident, { uuids });
    const r = checkRendererReceipt(d, ident);
    assert.equal(r.ok, false, JSON.stringify(uuids));
    assert.match(r.reason, /malformed/);
  }
});

await test('contradictory uuid/uuids aliases are rejected, agreeing pair passes', () => {
  const ident = IDENT();
  let d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
  fullReceipt(d, ident, { uuid: U1 });
  assert.equal(checkRendererReceipt(d, ident).ok, true, 'agreeing aliases pass');
  d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
  fullReceipt(d, ident, { uuid: U1LOW });
  assert.equal(checkRendererReceipt(d, ident).ok, true, 'case-only difference still agrees');
  for (const overrides of [{ uuid: U2 }, { uuid: U1, uuids: [U1, U2] }, { uuid: 'not-a-GPU' }]) {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'native-frames-'));
    fullReceipt(d, ident, overrides);
    const r = checkRendererReceipt(d, ident);
    assert.equal(r.ok, false, JSON.stringify(overrides));
    assert.match(r.reason, /contradictory/);
  }
});

function stagedOut(jobId, attemptId, stages) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-out-'));
  const receipts = openReceipts(out, { jobId, attemptId });
  for (const [name, status, detail] of stages) receipts.stage(name, status, detail ?? {});
  return { out, receipts };
}

function admission() {
  return { jobSha256: 'a'.repeat(64), backendSha256: 'b'.repeat(64), status: 'source-compatible' };
}

function deliverWith(out, names) {
  const deliver = path.join(out, 'deliver');
  fs.mkdirSync(deliver, { recursive: true });
  return names.map((name) => {
    const body = Buffer.from(`${name}\n`);
    fs.writeFileSync(path.join(deliver, name), body);
    return { name, bytes: body.length };
  });
}

await test('stale ok stages from an earlier attempt never satisfy a rerun', () => {
  const { out, receipts } = stagedOut('j', 'attempt-1', [['admit', 'ok'], ['render', 'ok'], ['encode', 'ok'], ['final-check', 'ok']]);
  const expected = deliverWith(out, ['s.mp4']);
  assert.throws(() => finalize({
    receipts, attemptId: 'attempt-2', outDir: out, deliverDir: path.join(out, 'deliver'), expectedFiles: expected,
    encoderArgs: ['-c:v', 'libx264'], audioOk: true, admission: admission(), versions: { jobId: 'j' },
  }), /attempt/);
});

await test('old-job stages and forged identity detail never satisfy this job', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-out-'));
  fs.writeFileSync(path.join(out, 'stages.jsonl'),
    ['admit', 'render', 'encode', 'final-check'].map((s) => JSON.stringify({ at: 't', jobId: 'old-job', attemptId: 'a', stage: s, status: 'ok' })).join('\n') + '\n');
  const receipts = openReceipts(out, { jobId: 'j', attemptId: 'a' });
  receipts.stage('admit', 'ok', { attemptId: 'evil', jobId: 'evil', status: 'evil', stage: 'evil' });
  const latest = receipts.latest('a');
  assert.equal(latest.get('admit'), 'ok');
  assert.equal(receipts.read().filter((e) => e.jobId === 'old-job').length, 0);
  const expected = deliverWith(out, ['s.mp4']);
  assert.throws(() => finalize({
    receipts, attemptId: 'a', outDir: out, deliverDir: path.join(out, 'deliver'), expectedFiles: expected,
    encoderArgs: ['-c:v', 'libx264'], audioOk: true, admission: admission(), versions: { jobId: 'new-job' },
  }), /jobId/);
});

await test('a failure recorded in this attempt still fails a repeated finalize', () => {
  const { out, receipts } = stagedOut('j', 'a', [['admit', 'ok'], ['render', 'failed']]);
  const expected = deliverWith(out, ['s.mp4']);
  const fargs = {
    receipts, attemptId: 'a', outDir: out, deliverDir: path.join(out, 'deliver'), expectedFiles: expected,
    encoderArgs: ['-c:v', 'libx264'], audioOk: true, admission: admission(), versions: { jobId: 'j' },
  };
  assert.throws(() => finalize(fargs), UnfinishedError);
  assert.throws(() => finalize(fargs), UnfinishedError);
});

await test('finalize requires admission identity, nonempty outputs and emits timing shape', () => {
  const { out, receipts } = stagedOut('j', 'a', [['admit', 'ok'], ['render', 'ok'], ['encode', 'ok'], ['final-check', 'ok']]);
  const expected = deliverWith(out, ['s.mp4']);
  const base = {
    receipts, attemptId: 'a', outDir: out, deliverDir: path.join(out, 'deliver'),
    encoderArgs: ['-c:v', 'libx264'], audioOk: true, versions: { jobId: 'j', allocation: { uuids: [U1] } },
  };
  assert.throws(() => finalize({ ...base, expectedFiles: expected, admission: null }), /admission/);
  assert.throws(() => finalize({ ...base, expectedFiles: [], admission: admission() }), /nonempty/);
  const receipt = finalize({ ...base, expectedFiles: expected, admission: admission(), timings: { drawMs: 5 } });
  assert.equal(receipt.status, 'ok');
  assert.equal(receipt.span, null);
  const spanned = finalize({
    ...base, expectedFiles: expected, admission: admission(), timings: {},
    versions: { jobId: 'j', allocation: { uuids: [U1] }, span: { start: 0, end: 24 } },
  });
  assert.deepEqual(spanned.span, { start: 0, end: 24 });
  assert.deepEqual(Object.keys(receipt.timings).sort(), [...TIMING_KEYS].sort());
  assert.equal(receipt.timings.simulationMs, null);
  assert.equal(receipt.timingsSchema, 'acp.stage-timing/v1');
  assert.equal(receipt.admission.attemptId, 'a');
  assert.deepEqual(receipt.allocation, { uuids: [U1], evidenceRef: 'stages.jsonl' });
});

await test('failure and hold receipts preserve retry lineage', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-out-'));
  const failed = failureReceipt({ outDir: out, jobId: 'j', attemptId: 'a', recipe: RECIPE, backend: BACKEND_ID, stage: 'encode', why: 'x', retryOf: 'q0' });
  assert.equal(failed.retryOf, 'q0');
  const held = holdReceipt({ outDir: out, jobId: 'j', attemptId: 'a', recipe: RECIPE, backend: BACKEND_ID, jobSha256: 'a'.repeat(64), backendSha256: 'b'.repeat(64), reasons: [{ path: 'capability.x', reason: 'no' }] });
  assert.equal(held.status, 'held');
  assert.deepEqual(readHolds(out).map((h) => h.attemptId), ['a']);
});

await test('recipe pins backend, qid, id-named outputs and retry lineage', () => {
  const job = buildJob({ id: 'n1', scene: 'closer', end: 45, retryOf: 'q0', extraArgs: ['--job-sha x'] });
  assert.equal(job.recipe, RECIPE);
  assert.equal(job.backend, BACKEND_ID);
  assert.equal(job.status, 'disabled-pending-canary');
  assert.ok(job.encoderArgs.includes('libx264') && job.encoderArgs.join(' ').includes('bt709'));
  assert.ok(job.run[0].includes('--qid {id}') && job.run[0].includes('--job-sha x') && job.run[0].includes('--scene closer'));
  assert.ok(job.outputs.filter((o) => !o.endsWith('receipt.json')).every((o) => o.includes('/n1/deliver/n1')));
  assert.ok(job.outputs.some((o) => o.endsWith('deliver/receipt.json')));
  const argv = postArgs(job, { by: 'studio', commit: 'b'.repeat(40) });
  assert.ok(argv.includes('--retry-of') && argv.includes('q0'));
});

function writeDocs(dir, job, assigned, backend) {
  const p = {};
  for (const [k, v] of Object.entries({ job, assigned, backend })) {
    p[k] = path.join(dir, `${k}.json`);
    fs.writeFileSync(p[k], JSON.stringify(v));
  }
  return p;
}

await test('mock worker run ends OK with admission identity and timing shape', async () => {
  const { root, job, assigned } = fullFixture('w1');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-worker-'));
  const p = writeDocs(dir, job, assigned, { mock: 'auto' });
  const out = path.join(dir, 'out');
  const env = { ...process.env, ACP_NATIVE_MOCK: '1', CUDA_VISIBLE_DEVICES: U1 };
  const { stdout } = await run('node', [path.join(NATIVE, 'worker.mjs'),
    '--job', p.job, '--assigned', p.assigned, '--backend', p.backend,
    '--assets', root, '--out', out, '--id', 'w1', '--scene', 'closer', '--attempt', 'w1a1', '--span', '0-24'], { env });
  assert.equal(stdout.trim().split('\n').at(-1), 'NATIVE_JOB OK w1');
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'receipt.json'), 'utf8'));
  assert.equal(receipt.mock, true);
  assert.equal(receipt.status, 'ok');
  assert.deepEqual(receipt.span, { start: 0, end: 24 });
  assert.match(receipt.admission.jobSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.allocation.uuids, [normalizeUuid(U1)]);
  assert.deepEqual(Object.keys(receipt.timings).sort(), [...TIMING_KEYS].sort());
  assert.equal(fs.existsSync(path.join(out, 'deliver', 'receipt.json')), true);
  const stages = fs.readFileSync(path.join(out, 'stages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(stages.every((s) => s.attemptId === 'w1a1'));
  for (const name of REQUIRED_STAGES) assert.ok(stages.some((s) => s.stage === name && s.status === 'ok'));
});

await test('span START>0 is explicitly rejected until history and audio offset exist', async () => {
  const { root, job, assigned } = fullFixture('w8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-span-'));
  const p = writeDocs(dir, job, assigned, { mock: 'auto' });
  const out = path.join(dir, 'out');
  const env = { ...process.env, ACP_NATIVE_MOCK: '1', CUDA_VISIBLE_DEVICES: U1 };
  const res = await run('node', [path.join(NATIVE, 'worker.mjs'),
    '--job', p.job, '--assigned', p.assigned, '--backend', p.backend,
    '--assets', root, '--out', out, '--id', 'w8', '--scene', 'closer', '--attempt', 'w8a1', '--span', '10-24'], { env }).then(
      (r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code, out: e.stdout ?? '', err: e.stderr ?? '' }));
  assert.equal(res.code, FAILED_EXIT);
  assert.match(res.out.trim().split('\n').at(-1), /NATIVE_JOB FAILED w8/);
  assert.match(res.err, /span START>0/);
  assert.match(JSON.stringify(JSON.parse(fs.readFileSync(path.join(out, 'receipt.json'), 'utf8'))), /history\/checkpoint and audio offset/);
  assert.equal(fs.existsSync(path.join(out, 'deliver', 'w8.mp4')), false, 'nothing shipped');
});

await test('worker held path exits 3 with hold lineage and no re-admission', async () => {
  const { root, job, assigned, backend } = fullFixture('w2');
  backend.capabilities = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-held-'));
  const p = writeDocs(dir, job, assigned, backend);
  const out = path.join(dir, 'out');
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: U1 };
  const cli = [path.join(NATIVE, 'worker.mjs'), '--job', p.job, '--assigned', p.assigned, '--backend', p.backend,
    '--assets', root, '--out', out, '--id', 'w2', '--scene', 'closer'];
  const first = await run('node', [...cli, '--attempt', 'h1'], { env }).then(
    () => ({ code: 0 }), (e) => ({ code: e.code, out: e.stdout }));
  assert.equal(first.code, HELD_EXIT);
  assert.match(first.out.trim().split('\n').at(-1), /NATIVE_JOB HELD w2/);
  assert.equal(readHolds(out).length, 1);
  const second = await run('node', [...cli, '--attempt', 'h2'], { env }).then(
    () => ({ code: 0, out: '' }), (e) => ({ code: e.code, out: e.stdout }));
  assert.equal(second.code, HELD_EXIT);
  assert.match(JSON.parse(fs.readFileSync(path.join(out, 'receipt.json'), 'utf8')).why.join(), /already held/);
});

await test('staged doc substitution is refused before render', async () => {
  const { root, job, assigned, backend } = fullFixture('w5');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sha-'));
  const p = writeDocs(dir, job, assigned, backend);
  const out = path.join(dir, 'out');
  const env = { ...process.env, ACP_NATIVE_MOCK: '1', CUDA_VISIBLE_DEVICES: U1 };
  const cli = ['node', path.join(NATIVE, 'worker.mjs'), '--job', p.job, '--assigned', p.assigned,
    '--backend', p.backend, '--assets', root, '--out', out, '--id', 'w5', '--scene', 'closer', '--attempt', 's1',
    '--job-sha', '0'.repeat(64), '--backend-sha', 'f'.repeat(64)];
  const res = await run(cli[0], cli.slice(1), { env }).then(
    (r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') }));
  assert.equal(res.code, FAILED_EXIT);
  assert.match(res.out, /NATIVE_JOB FAILED w5/);
  assert.equal(fs.existsSync(path.join(out, 'deliver', 'w5.mp4')), false);
});

// Nonmock prerequisites fail closed before launch: the units above are stub
// contract tests; these worker tests prove each missing piece stops the run
// with no side effects. The full stub end-to-end proves payload and bindings
// only — it claims no real media.
async function gateRun(dir, { extraArgv = [], env = {}, attempt = 'g1', id = 'g1' }) {
  const { root, job, assigned, backend } = fullFixture(id);
  const p = writeDocs(dir, job, assigned, backend);
  const out = path.join(dir, 'out');
  const res = await run('node', [path.join(NATIVE, 'worker.mjs'), '--job', p.job, '--assigned', p.assigned,
    '--backend', p.backend, '--assets', root, '--out', out, '--id', id, '--scene', 'closer',
    '--attempt', attempt, ...extraArgv], { env: { ...process.env, CUDA_VISIBLE_DEVICES: U1, ...env } }).then(
      (r) => ({ code: 0, out: r.stdout, err: r.stderr }),
      (e) => ({ code: e.code, out: e.stdout ?? '', err: e.stderr ?? '' }));
  return { ...res, out, last: res.out.trim().split('\n').at(-1) };
}

// SYNTHETIC GATE PROOF: this worker-level run carries a stub CLI only to
// prove the unconditional gate fires anyway. It asserts refusal, never media.
await test('unconditional nonmock gate fires before any side effect', async () => {
  const { digest } = await import('../native/contract.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-gate-'));
  const sentinel = path.join(dir, 'renderer-was-here');
  const fake = path.join(dir, 'fake-fframes-native.sh');
  fs.writeFileSync(fake, `#!/bin/sh\ntouch ${sentinel}\n`);
  fs.chmodSync(fake, 0o755);
  const adm = path.join(dir, 'admission.txt');
  fs.writeFileSync(adm, 'root-admission');
  // Every bypass present at once: pinned CLI, admission receipt, audio/finish
  // stubs, ffmpeg stub, span, matching staged digests. The gate still fires
  // with the identical reason — no env/flag/file may pass it.
  const { root, job, assigned, backend } = fullFixture('g1');
  const p = writeDocs(dir, job, assigned, backend);
  const out = path.join(dir, 'out');
  const res = await run('node', [path.join(NATIVE, 'worker.mjs'), '--job', p.job, '--assigned', p.assigned,
    '--backend', p.backend, '--assets', root, '--out', out, '--id', 'g1', '--scene', 'closer',
    '--attempt', 'g1', '--admission-receipt', adm, '--span', '0-24',
    '--job-sha', digest(job), '--backend-sha', digest(backend)], {
    env: {
      ...process.env, CUDA_VISIBLE_DEVICES: U1,
      NATIVE_RENDER_CLI: fake,
      ACP_PYTHON_BIN: 'sh', ACP_MAKE_AUDIO_PY: fake, ACP_FINISH_PY: fake, FFMPEG_BIN: fake,
    },
  }).then(
    (r) => ({ code: 0, out: r.stdout }),
    (e) => ({ code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') }));
  assert.equal(res.code, FAILED_EXIT);
  assert.match(res.out.trim().split('\n').at(-1), /NATIVE_JOB FAILED g1/);
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'receipt.json'), 'utf8'));
  assert.match(JSON.stringify(receipt), /disabled-pending-canary/);
  assert.equal(fs.existsSync(sentinel), false, 'renderer never launched');
  assert.equal(fs.existsSync(path.join(out, 'deliver', 'g1.mp4')), false, 'nothing shipped');
  assert.equal(fs.existsSync(path.join(out, 'frames', 'descriptor.json')), false, 'no descriptor written');
  // And with nothing set, the reason is identical: the gate is unconditional.
  const bare = await gateRun(fs.mkdtempSync(path.join(os.tmpdir(), 'native-gate-bare-')), { id: 'g2', attempt: 'g2' });
  assert.equal(bare.code, FAILED_EXIT);
  assert.match(bare.last, /NATIVE_JOB FAILED g2/);
  assert.match(JSON.stringify(JSON.parse(fs.readFileSync(path.join(bare.out, 'receipt.json'), 'utf8'))), /disabled-pending-canary/);
});

// Worker-level stub end-to-end runs were removed: the nonmock gate is
// unconditional, so no stub CLI may drive the worker past refusal.
// Invocation coverage lives in the injected-runFn helper unit tests
// above (launchRender, mapRenderExit, encodeMedia, probeMaster, audio
// flow, descriptor); those prove payload shape without claiming media.

await test('unsafe --id/--qid/--scene are refused before any work', async () => {
  const { root, job, assigned, backend } = fullFixture('w7');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-unsafe-'));
  const p = writeDocs(dir, job, assigned, backend);
  const out = path.join(dir, 'out');
  const env = { ...process.env, ACP_NATIVE_MOCK: '1', CUDA_VISIBLE_DEVICES: U1 };
  for (const extra of [['--id', '../x'], ['--qid', 'a;b'], ['--scene', 'a-b']]) {
    const res = await run('node', [path.join(NATIVE, 'worker.mjs'), '--job', p.job, '--assigned', p.assigned,
      '--backend', p.backend, '--assets', root, '--out', out, '--id', 'w7', '--scene', 'closer', '--attempt', 'u1', ...extra], { env }).then(
        (r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code, out: (e.stdout ?? '') + (e.stderr ?? '') }));
    assert.equal(res.code, FAILED_EXIT, extra.join(' '));
    assert.match(res.out, /refusing unsafe/);
  }
});

await test('admit CLI reports attempt identity with real preflight', async () => {
  const { root, job, assigned, backend } = fullFixture('w6');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-admit-'));
  const p = writeDocs(dir, job, assigned, backend);
  const out = path.join(dir, 'out');
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: U1 };
  const { stdout } = await run('node', [path.join(NATIVE, 'admit.mjs'),
    p.job, p.assigned, p.backend, '--assets', root, '--out', out, '--attempt', 'cli1'], { env });
  const verdict = JSON.parse(stdout);
  assert.equal(verdict.status, 'admitted');
  assert.equal(verdict.attemptId, 'cli1');
  backend.capabilities = [];
  fs.writeFileSync(p.backend, JSON.stringify(backend));
  const held = await run('node', [path.join(NATIVE, 'admit.mjs'),
    p.job, p.assigned, p.backend, '--assets', root, '--out', out, '--attempt', 'cli2'], { env }).then(
      (r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code, out: e.stdout }));
  assert.equal(held.code, HELD_EXIT);
  assert.equal(JSON.parse(held.out).status, 'held');
});
