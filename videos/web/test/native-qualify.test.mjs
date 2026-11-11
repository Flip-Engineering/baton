// CPU-only tests for the qualification harness (quality owner). No renderer,
// browser or GPU. ffmpeg/ffprobe tests skip with an explicit diagnostic when
// the tools are absent; everything else always runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, decodePngRgba, encodePng, crc32, PngError } from '../native/qualify/png.mjs';
import { compareFrames, checkTemporal, CompareError } from '../native/qualify/compare.mjs';
import { defaultCriteria, validateCriteria, qualificationDecision, CriteriaError } from '../native/qualify/criteria.mjs';
import { fixtureFrames, fixtureWav, fixtureVideo, fixtureExr, sha256 } from '../native/qualify/fixtures.mjs';
import { validateTiming, aggregateBacklog, throughputComparison, timingFromReceipt, TimingError } from '../native/qualify/timing.mjs';
import { verifyRecovery, crashedRunEvidence } from '../native/qualify/recovery.mjs';
import { backlogJob, fixedFrameCommands, fullVideoCommands, backlogPlan, FIXED_BACKLOG } from '../native/qualify/backlog.mjs';
import { validateFinalVideo, decodeSampleFrames, tools } from '../native/qualify/video.mjs';
import { probeExr, readExrFloat, compareExrLinear } from '../native/qualify/exr.mjs';
import {
  qualifyReuse, frameEvalModel, prepSaving, assertDisjointClaims, ReuseError, FRAME_EVAL_DEFINITION,
} from '../native/qualify/reuse.mjs';
import { verifyRenderEvidence } from '../native/qualify/evidence.mjs';

const haveFfmpeg = tools().ffmpeg && tools().ffprobe;
const H64 = 'a'.repeat(64);
const C40 = 'b'.repeat(40);

test('png encode/decode roundtrip is byte-exact on pixels', () => {
  for (const f of fixtureFrames({ seed: 7, count: 3, width: 32, height: 24 })) {
    const decoded = decodePngRgba(encodePng(f));
    assert.equal(decoded.width, f.width);
    assert.equal(decoded.height, f.height);
    assert.ok(decoded.data.equals(f.data));
  }
});

test('png fixtures are deterministic', () => {
  const a = fixtureFrames({ seed: 42, count: 4 }).map(f => sha256(encodePng(f)));
  const b = fixtureFrames({ seed: 42, count: 4 }).map(f => sha256(encodePng(f)));
  assert.deepEqual(a, b);
  assert.notEqual(a[0], a[1]);
});

test('png decoder rejects palette and 16-bit inputs explicitly', () => {
  const good = encodePng(fixtureFrames({ count: 1, width: 4, height: 4 })[0]);
  const palette = Buffer.from(good);
  palette[25] = 3; // IHDR color type
  // fix the IHDR crc so only the color-type check fires
  const ihdrBody = palette.subarray(16, 29);
  palette.writeUInt32BE(crc32(Buffer.concat([Buffer.from('IHDR'), ihdrBody])), 29);
  assert.throws(() => decodePng(palette), PngError);
  const deep = Buffer.from(good);
  deep[24] = 16;
  deep.writeUInt32BE(crc32(Buffer.concat([Buffer.from('IHDR'), deep.subarray(16, 29)])), 29);
  assert.throws(() => decodePng(deep), /bit depth/);
});

test('compareFrames passes identical frames in exact mode', () => {
  const [f] = fixtureFrames({ count: 1 });
  const criteria = { ...defaultCriteria('t'), mode: 'exact' };
  const v = compareFrames(f, { ...f, data: Buffer.from(f.data) }, criteria);
  assert.equal(v.passed, true);
  assert.equal(v.full.exact, true);
  assert.equal(v.full.psnrDb, Infinity);
  assert.equal(v.provenanceVerified, false); // synthetic fixtures never qualify
});

test('compareFrames detects a single-pixel delta', () => {
  const [a, b] = fixtureFrames({ count: 2, width: 32, height: 32 });
  const criteria = { ...defaultCriteria('t'), mode: 'exact' };
  const v = compareFrames(a, b, criteria);
  assert.equal(v.passed, false);
  assert.ok(v.full.mismatchedPixels > 0);
});

test('equivalent gate tolerates sub-threshold noise and rejects gross divergence', () => {
  const [f] = fixtureFrames({ count: 1, width: 64, height: 64 });
  const near = { width: f.width, height: f.height, data: Buffer.from(f.data) };
  for (let i = 0; i < near.data.length; i += 4) {
    near.data[i] = Math.max(0, near.data[i] - 1); // delta 1 on red, alpha untouched
  }
  const criteria = defaultCriteria('t');
  assert.equal(compareFrames(f, near, criteria).passed, true);
  const far = { width: f.width, height: f.height, data: Buffer.from(f.data) };
  far.data.fill(255, 0, far.data.length / 2);
  assert.equal(compareFrames(f, far, criteria).passed, false);
});

test('alpha drift fails the default gate even when RGB matches', () => {
  const [f] = fixtureFrames({ count: 1, width: 16, height: 16 });
  const b = { width: f.width, height: f.height, data: Buffer.from(f.data) };
  for (let i = 3; i < b.data.length; i += 4) b.data[i] = 0;
  const v = compareFrames(f, b, defaultCriteria('t'));
  assert.equal(v.passed, false);
  assert.ok(v.issues.some(i => i.path.includes('alpha') || i.reason.includes('alpha')));
});

test('seam regions get their own verdicts', () => {
  const [a, b] = fixtureFrames({ count: 2, width: 32, height: 32 });
  const criteria = defaultCriteria('t');
  criteria.seams.spatialRegions = [{ name: 'joint', x: 0, y: 0, w: 8, h: 8 }];
  const v = compareFrames(a, b, criteria);
  assert.equal(v.regions.length, 1);
  assert.equal(v.regions[0].name, 'joint');
  assert.equal(v.passed, false);
});

test('dimension mismatch is an explicit error, not a fail verdict', () => {
  const [a] = fixtureFrames({ count: 1, width: 16, height: 16 });
  const [b] = fixtureFrames({ count: 1, width: 8, height: 8 });
  assert.throws(() => compareFrames(a, b, defaultCriteria('t')), CompareError);
});

test('temporal provenance requires exact digests, not schema-only claims', () => {
  const criteria = defaultCriteria('t');
  assert.equal(checkTemporal(criteria, { historyFrom: 0, historyDigest: H64 }).passed, true);
  assert.equal(checkTemporal(criteria, { historyFrom: 0 }).passed, false); // no digest
  assert.equal(checkTemporal(criteria, { historyFrom: 12, historyDigest: H64 }).passed, false);
  assert.equal(checkTemporal(criteria, {}).passed, false);
  criteria.temporal.allowedCheckpointSchemas = ['acp.sim-checkpoint/v1'];
  assert.equal(checkTemporal(criteria, { checkpointSchema: 'acp.sim-checkpoint/v1' }).passed, false); // no digest
  assert.equal(
    checkTemporal(criteria, { checkpointSchema: 'acp.sim-checkpoint/v1', checkpointDigest: H64 }).passed, true);
});

test('baked acp.simulation/v1 history satisfies temporal provenance with a payload digest', () => {
  const criteria = defaultCriteria('t');
  // simulation 486b8c6: baked tracks make frame evaluation a pure function of track+t
  const baked = { history: { mode: 'baked', from: 0, to: 1121 }, simulationSha256: H64 };
  assert.equal(checkTemporal(criteria, baked).passed, true);
  // from != 0 rejects even when baked
  assert.equal(checkTemporal(criteria, {
    history: { mode: 'baked', from: 12, to: 1121 }, simulationSha256: H64,
  }).passed, false);
  // baked without the exact payload digest rejects (schema-only claim)
  assert.equal(checkTemporal(criteria, { history: { mode: 'baked', from: 0, to: 1121 } }).passed, false);
  // unknown modes reject
  assert.equal(checkTemporal(criteria, {
    history: { mode: 'streamed', from: 0, to: 1121 }, simulationSha256: H64,
  }).passed, false);
});

test('criteria validator rejects missing sections and unqualified approval', () => {
  assert.throws(() => validateCriteria({}), CriteriaError);
  assert.throws(() => validateCriteria({ ...defaultCriteria('t'), mode: 'fuzzy' }), CriteriaError);
  const c = defaultCriteria('t');
  c.equivalent.psnrMinDb = 5;
  assert.throws(() => validateCriteria(c), /psnrMinDb/);
  const noApproval = defaultCriteria('t');
  delete noApproval.approval;
  assert.throws(() => validateCriteria(noApproval), /approval/);
  const approved = defaultCriteria('t');
  approved.approval = { status: 'approved' }; // missing approvedBy/evidenceRef
  assert.throws(() => validateCriteria(approved), /approval/);
});

test('wav fixture has a valid RIFF header and deterministic bytes', () => {
  const a = fixtureWav({ seconds: 0.25 });
  assert.equal(a.toString('ascii', 0, 4), 'RIFF');
  assert.equal(a.toString('ascii', 8, 12), 'WAVE');
  assert.equal(sha256(a), sha256(fixtureWav({ seconds: 0.25 })));
});

test('timing validation requires every stage field; overlap is legal', () => {
  const good = {
    preparationMs: 1, simulationMs: 2, drawMs: 3, transferMs: 1, encodeMs: 2,
    totalElapsedMs: 10, peakMemoryBytes: 1024,
  };
  assert.deepEqual(validateTiming({ ...good }), good);
  assert.throws(() => validateTiming({ ...good, drawMs: undefined }), TimingError);
  assert.throws(() => validateTiming({ ...good, drawMs: null }), TimingError); // unmeasured stage
  // stages may overlap by design: sum 9 > total 5 is attribution, not an error
  assert.deepEqual(validateTiming({ ...good, totalElapsedMs: 5 }).totalElapsedMs, 5);
});

test('timingFromReceipt mirrors acp.native-receipt/v1 and refuses mock/failed', () => {
  const base = {
    schema: 'acp.native-receipt/v1', jobId: 'j', attemptId: 'a1', status: 'ok',
    timingsSchema: 'acp.stage-timing/v1',
    timings: {
      preparationMs: 1, simulationMs: 1, drawMs: 1, transferMs: 1,
      encodeMs: 1, totalElapsedMs: 6, peakMemoryBytes: 1,
    },
  };
  assert.equal(timingFromReceipt(base).jobId, 'j');
  assert.throws(() => timingFromReceipt({ ...base, mock: true }), /mock/);
  assert.throws(() => timingFromReceipt({ ...base, status: 'failed' }), TimingError);
  const legacy = { ...base };
  delete legacy.status;
  assert.throws(() => timingFromReceipt(legacy), /explicit status ok/);
  assert.throws(() => timingFromReceipt({ ...base, timingsSchema: 'other' }), TimingError);
  assert.throws(() => timingFromReceipt({ jobId: 'j', timings: {} }), TimingError);
});

test('backlog aggregation rejects duplicates and exact-set mismatches', () => {
  const rec = id => ({
    jobId: id, preparationMs: 100, simulationMs: 100, drawMs: 100,
    transferMs: 50, encodeMs: 100, totalElapsedMs: 500, peakMemoryBytes: 1,
  });
  const ids = ['a', 'b'];
  const agg = aggregateBacklog({
    backend: 'x', records: ids.map(rec), wallWindowMs: 3_600_000, expectedJobs: ids,
  });
  assert.equal(agg.completedVideos, 2);
  assert.equal(agg.videosPerHour, 2);
  assert.throws(() => aggregateBacklog({
    backend: 'x', records: [rec('a'), rec('a'), rec('b')], wallWindowMs: 1000, expectedJobs: ids,
  }), /duplicate/);
  assert.throws(() => aggregateBacklog({
    backend: 'x', records: [rec('a')], wallWindowMs: 1000, expectedJobs: ids,
  }), /missing completed jobs/);
  assert.throws(() => aggregateBacklog({
    backend: 'x', records: [...ids.map(rec), rec('zzz')], wallWindowMs: 1000, expectedJobs: ids,
  }), /outside the fixed backlog/);
});

const IDENTITY = {
  jobId: 'oneshot_b', sourceCommit: C40, criteriaSha256: H64,
  qualitySha256: H64, backendSha256: H64, attemptId: 'att-1',
};
const evidence = (schema, extra = {}) => ({
  schema, passed: true, provenanceVerified: true, identity: IDENTITY, ...extra,
});
const throughputOk = {
  schema: 'acp.throughput-comparison/v1',
  baselineComplete: true, candidateComplete: true, sameBacklog: true,
  baselineVideosPerHour: 2, candidateVideosPerHour: 5,
};
const approvalOk = {
  status: 'approved', approvedBy: 'independent-review', evidenceRef: H64, criteriaSha256: H64,
};

test('qualification decision stays unqualified until the composed verifier is wired, preserving metrics', () => {
  const d = qualificationDecision({
    fixedFrame: evidence('acp.frame-comparison/v1'),
    fullVideo: evidence('acp.video-verdict/v1'),
    recovery: evidence('acp.recovery-verdict/v1'),
    throughput: throughputOk,
    criteriaApproval: approvalOk,
  });
  // even perfect evidence does not qualify while the real verified artifact
  // pipeline is unwired — but metrics and refusals remain visible
  assert.equal(d.qualified, false);
  assert.equal(d.experimental, true);
  assert.equal(d.throughputRatio, 2.5);
  assert.ok(d.refusals.some(r => r.includes('composed-verifier-required')));
  // no OTHER refusals when evidence is strict and consistent
  assert.equal(d.refusals.length, 1);
});

test('qualification decision refuses truthy, unverified, mismatched or toy evidence', () => {
  const good = {
    fixedFrame: evidence('acp.frame-comparison/v1'),
    fullVideo: evidence('acp.video-verdict/v1'),
    recovery: evidence('acp.recovery-verdict/v1'),
    throughput: throughputOk,
    criteriaApproval: approvalOk,
  };
  const refusals = d => d.refusals.filter(r => !r.includes('composed-verifier-required'));
  // truthy but not strict
  assert.ok(refusals(qualificationDecision({ ...good, fixedFrame: { passed: 1 } })).length > 0);
  // synthetic fixture provenance
  assert.ok(refusals(qualificationDecision({
    ...good, fixedFrame: evidence('acp.frame-comparison/v1', { provenanceVerified: false }),
  })).some(r => r.includes('provenance')));
  // identity mismatch across evidence
  assert.ok(refusals(qualificationDecision({
    ...good, recovery: evidence('acp.recovery-verdict/v1', { identity: { ...IDENTITY, attemptId: 'att-2' } }),
  })).some(r => r.includes('identity mismatch')));
  // proposed criteria gate
  assert.ok(refusals(qualificationDecision({
    ...good, criteriaApproval: { status: 'proposed' },
  })).some(r => r.includes('not approved')));
  // approval bound to a different gate digest
  assert.ok(refusals(qualificationDecision({
    ...good, criteriaApproval: { ...approvalOk, criteriaSha256: 'f'.repeat(64) },
  })).some(r => r.includes('does not match')));
  // unversioned throughput
  assert.ok(refusals(qualificationDecision({
    ...good, throughput: { ...throughputOk, schema: undefined },
  })).some(r => r.includes('acp.throughput-comparison/v1')));
  // non-finite throughput rate
  assert.ok(refusals(qualificationDecision({
    ...good, throughput: { ...throughputOk, candidateVideosPerHour: Infinity },
  })).some(r => r.includes('finite positive')));
  // stage-only gains
  assert.ok(refusals(qualificationDecision({
    ...good, throughput: { ...throughputOk, stageOnly: true },
  })).some(r => r.includes('stage-only')));
  // missing throughput entirely
  assert.ok(refusals(qualificationDecision({ ...good, throughput: {} })).length > 0);
});

test('recovery mirrors acp.native-receipt/v1 with attempt binding', () => {
  const stages = (attempt, list) => list.map(([stage, status]) => JSON.stringify({
    jobId: 'j', attemptId: attempt, stage, status, at: '2026-10-16T00:00:00Z',
  })).join('\n');
  const okStages = stages('a1', [
    ['admit', 'ok'], ['render', 'ok'], ['encode', 'ok'], ['final-check', 'ok'],
  ]);
  const successReceipt = {
    schema: 'acp.native-receipt/v1', jobId: 'j', attemptId: 'a1', status: 'ok',
    admission: { jobSha256: H64, backendSha256: H64, status: 'source-compatible', attemptId: 'a1' },
    timingsSchema: 'acp.stage-timing/v1', timings: {},
    files: [{ name: 'j.mp4', size: 128, sha256: H64 }],
  };
  const ok = verifyRecovery({ stagesText: okStages, receipt: successReceipt, exitCode: 0 });
  assert.equal(ok.passed, true);
  // legacy status-less success receipts can no longer qualify (pre-de93073)
  const legacy = { ...successReceipt };
  delete legacy.status;
  const legacyVerdict = verifyRecovery({ stagesText: okStages, receipt: legacy, exitCode: 0 });
  assert.equal(legacyVerdict.passed, false);
  assert.ok(legacyVerdict.problems.some(p => p.includes('explicit status ok')));
  // unknown exit code is NOT success
  assert.equal(verifyRecovery({ stagesText: okStages, receipt: successReceipt }).passed, false);
  // unknown receipt status is never a success
  assert.equal(verifyRecovery({
    stagesText: okStages, receipt: { ...successReceipt, status: 'okish' }, exitCode: 0,
  }).passed, false);
  // no validated output files
  assert.equal(verifyRecovery({
    stagesText: okStages, receipt: { ...successReceipt, files: [] }, exitCode: 0,
  }).passed, false);
  assert.equal(verifyRecovery({
    stagesText: okStages, receipt: { ...successReceipt, files: [{ name: 'j.mp4' }] }, exitCode: 0,
  }).passed, false);
  // receipt={} with zero stages refuses
  assert.equal(verifyRecovery({ stagesText: '', receipt: {}, exitCode: 0 }).passed, false);
  // missing stage in THIS attempt refuses
  assert.equal(verifyRecovery({
    stagesText: stages('a1', [['admit', 'ok'], ['render', 'ok']]),
    receipt: successReceipt, exitCode: 0,
  }).passed, false);
  // stale ok from an old attempt cannot satisfy a rerun
  const stale = `${stages('a0', [['admit', 'ok'], ['render', 'ok'], ['encode', 'ok'], ['final-check', 'ok']])}\n${stages('a1', [['admit', 'ok'], ['render', 'ok']])}`;
  assert.equal(verifyRecovery({ stagesText: stale, receipt: successReceipt, exitCode: 0 }).passed, false);
  // a later failure in the same attempt invalidates completion
  const failedLate = `${okStages}\n${JSON.stringify({ jobId: 'j', attemptId: 'a1', stage: 'encode', status: 'failed', at: '2026-10-16T00:01:00Z' })}`;
  assert.equal(verifyRecovery({ stagesText: failedLate, receipt: successReceipt, exitCode: 0 }).passed, false);
  // nonzero exit contradicts a success receipt
  assert.equal(verifyRecovery({ stagesText: okStages, receipt: successReceipt, exitCode: 1 }).passed, false);
  // mock evidence never qualifies
  assert.equal(verifyRecovery({
    stagesText: okStages, receipt: { ...successReceipt, mock: true }, exitCode: 0,
  }).passed, false);
  // failure receipts: why is an array; retry lineage checked
  const failure = {
    schema: 'acp.native-receipt/v1', jobId: 'j', attemptId: 'a1', status: 'failed',
    stage: 'render', why: ['material.skin: no qualified implementation'], retryOf: 'orig-j',
  };
  assert.equal(verifyRecovery({
    stagesText: stages('a1', [['admit', 'ok'], ['render', 'failed']]), receipt: failure, exitCode: 4,
  }).passed, true);
  assert.equal(verifyRecovery({
    stagesText: stages('a1', [['render', 'failed']]),
    receipt: { ...failure, why: 'string not array' }, exitCode: 4,
  }).passed, false);
  assert.equal(verifyRecovery({
    stagesText: stages('a1', [['render', 'failed']]),
    receipt: { ...failure, why: [] }, exitCode: 4,
  }).passed, false);
  // exit 0 with a failure receipt contradicts
  assert.equal(verifyRecovery({
    stagesText: stages('a1', [['render', 'failed']]), receipt: failure, exitCode: 0,
  }).passed, false);
  // crashed worker: no receipt at all
  const crashed = verifyRecovery(crashedRunEvidence([
    { jobId: 'j', attemptId: 'a1', stage: 'admit', status: 'ok', at: '2026-10-16T00:00:00Z' },
  ]));
  assert.equal(crashed.passed, false);
  assert.ok(crashed.problems.some(p => p.includes('unfinished')));
  // held: digest lineage required
  const held = {
    schema: 'acp.native-receipt/v1', jobId: 'j', attemptId: 'a1', status: 'held',
    stage: 'admit', jobSha256: H64, backendSha256: H64, why: ['backend.x: unsupported'], retryOf: null,
  };
  assert.equal(verifyRecovery({
    stagesText: stages('a1', [['admit', 'held']]), receipt: held, exitCode: 3,
  }).passed, true);
});

// Real receipt parser fixtures generated by the integrated farm-adapter
// receipts.mjs at lead d1c6c36 (no shapes re-invented here).
const RECEIPT_FIXTURES = fileURLToPath(new URL('../native/qualify/fixtures/receipts/', import.meta.url));

test('real farm-adapter success receipt fixture verifies and parses timings', () => {
  const stagesText = fs.readFileSync(path.join(RECEIPT_FIXTURES, 'success-stages.jsonl'), 'utf8');
  const receipt = JSON.parse(fs.readFileSync(path.join(RECEIPT_FIXTURES, 'success-receipt.json'), 'utf8'));
  const verdict = verifyRecovery({ stagesText, receipt, exitCode: 0 });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.jobId, 'oneshot_b');
  const timing = timingFromReceipt(receipt);
  assert.equal(timing.drawMs, 30);
  assert.equal(timing.peakMemoryBytes, 4096);
  const agg = aggregateBacklog({
    backend: 'fframes-native/v1', records: [timing], wallWindowMs: 60_000, expectedJobs: ['oneshot_b'],
  });
  assert.equal(agg.videosPerHour, 60);
});

test('real farm-adapter failure and held receipt fixtures verify', () => {
  const failure = JSON.parse(fs.readFileSync(path.join(RECEIPT_FIXTURES, 'failure-receipt.json'), 'utf8'));
  // failure at render after admit; stage evidence matches the attempt
  const stagesText = [
    { jobId: 'oneshot_b', attemptId: 'att-1', stage: 'admit', status: 'ok', at: '2026-10-17T00:21:00Z' },
    { jobId: 'oneshot_b', attemptId: 'att-1', stage: 'render', status: 'failed', at: '2026-10-17T00:21:25Z' },
  ].map(e => JSON.stringify(e)).join('\n');
  const fv = verifyRecovery({ stagesText, receipt: failure, exitCode: 4 });
  assert.equal(fv.passed, true);
  assert.equal(fv.outcome, 'failed');
  // failure receipts may also stand alone (crash before stages opened)
  assert.equal(verifyRecovery({ stagesText: '', receipt: failure, exitCode: 4 }).passed, true);
  const heldReceipt = JSON.parse(fs.readFileSync(path.join(RECEIPT_FIXTURES, 'held-receipt.json'), 'utf8'));
  const hv = verifyRecovery({
    stagesText: JSON.stringify({ jobId: 'oneshot_b', attemptId: 'att-1', stage: 'admit', status: 'held', at: '2026-10-17T00:21:25Z' }),
    receipt: heldReceipt, exitCode: 3,
  });
  assert.equal(hv.passed, true);
  assert.equal(hv.outcome, 'held');
});

test('backlog pins match the source cohort audit and labels are honest', () => {
  assert.equal(FIXED_BACKLOG.jobs.length, 4);
  assert.equal(backlogJob('oneshot_b').seed, 2015);
  assert.equal(backlogJob('oneshot_c').seed, 2019);
  assert.equal(backlogJob('the_chasm').commit, 'e67fd169c16f6c6e499d4b3f2c58d63c9e42844e');
  // d08eef... is the dependency manifest hash; the capsule manifest is unresolved
  assert.equal(FIXED_BACKLOG.dependencyManifestSha256.startsWith('d08eef61'), true);
  assert.equal(FIXED_BACKLOG.capsuleManifestSha256, null);
});

const QUALITY = {
  width: 1080, height: 1920, frameCount: 1122, samples: 1, seed: 2015,
  fps: { numerator: 30, denominator: 1 }, endSeconds: 37.4,
  color: { transfer: 'bt709' }, alpha: { mode: 'opaque' }, timing: { frameAccurate: true },
  temporal: { history: 'full' }, encoder: { codec: 'libx264', args: ['-crf', '16'] },
  audio: { mode: 'required' },
};

test('command specs carry the assigned contract and stay unresolved', () => {
  const spec = fixedFrameCommands({
    jobId: 'oneshot_b', frameSeconds: 12.5, quality: QUALITY, checkoutDir: '/immutable/co', outDir: '/tmp/q',
  });
  assert.equal(spec.requiresAdmission, true);
  assert.equal(spec.runnable, false);
  assert.ok(spec.blockedOn.length >= 3);
  assert.equal(spec.provenance.frameIndex, 375);
  assert.equal(spec.provenance.quality.seed, 2015);
  assert.match(spec.comparedFrame.selector, /frame index 375/);
  const full = fullVideoCommands({ jobId: 'the_chasm', quality: QUALITY, checkoutDir: '/c', outDir: '/tmp/q' });
  assert.equal(full.provenance.quality.frameCount, 1122);
  assert.equal(full.runnable, false);
  // no hardcoded quality: a different assigned contract flows through
  const other = fullVideoCommands({
    jobId: 'the_chasm', quality: { ...QUALITY, width: 720, height: 1280, seed: 7 }, checkoutDir: '/c', outDir: '/o',
  });
  assert.equal(other.provenance.quality.width, 720);
  assert.throws(() => fixedFrameCommands({
    jobId: 'oneshot_b', frameSeconds: 99, quality: QUALITY, checkoutDir: '/c', outDir: '/o',
  }), /frameSeconds/);
  assert.throws(() => backlogPlan({ qualityByJob: { oneshot_b: QUALITY }, checkoutDir: '/c', outDir: '/o' }),
    /assigned contract incomplete/);
});

test('fixture video validates against the final-file contract', { skip: !haveFfmpeg && 'ffmpeg/ffprobe required for decoder fixtures' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualify-'));
  const fx = fixtureVideo(dir, { seed: 5, frameCount: 12, fps: 30 });
  const verdict = validateFinalVideo(fx.file, {
    width: 64, height: 64, fps: { numerator: 30, denominator: 1 }, frameCount: 12,
    color: { tags: ['bt709', 'bt709', 'bt709'], range: 'tv' },
    audio: { mode: 'required', maxStreamDeltaSeconds: 0.2 },
    durationToleranceFrames: 2,
  });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.passed, true);
  const sampled = decodeSampleFrames(fx.file, [0, 11], path.join(dir, 'samples'), {});
  assert.equal(sampled.length, 2);
  for (const p of sampled) {
    const decoded = decodePng(fs.readFileSync(p));
    assert.equal(decoded.width, 64);
  }
});

test('final-video validation catches missing audio and wrong frame count', { skip: !haveFfmpeg && 'ffmpeg/ffprobe required' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualify-'));
  const fx = fixtureVideo(dir, { seed: 6, frameCount: 10, fps: 30, withAudio: false });
  const verdict = validateFinalVideo(fx.file, {
    width: 64, height: 64, fps: { numerator: 30, denominator: 1 }, frameCount: 11,
    color: { tags: ['bt709', 'bt709', 'bt709'], range: 'tv' },
    audio: { mode: 'required', maxStreamDeltaSeconds: 0.2 },
    durationToleranceFrames: 2,
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.problems.some(p => p.includes('audio')));
  assert.ok(verdict.problems.some(p => p.includes('frame count')));
});

test('EXR fixture probes as float32 and compares in linear space', { skip: !haveFfmpeg && 'ffmpeg/ffprobe required' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualify-exr-'));
  const fx = fixtureExr(dir, { seed: 9, width: 32, height: 32 });
  const info = probeExr(fx.file);
  assert.equal(info.width, 32);
  assert.equal(info.channels, 4);
  const a = readExrFloat(fx.file);
  assert.equal(a.data.length, 32 * 32 * 4);
  // identical decode passes with zero deltas
  const same = compareExrLinear(a, readExrFloat(fx.file));
  assert.equal(same.passed, true);
  assert.equal(same.maxAbsDelta, 0);
  // small perturbation within tolerances passes
  const near = { width: a.width, height: a.height, data: Float32Array.from(a.data) };
  for (let i = 0; i < near.data.length; i += 4) near.data[i] += 1e-5;
  assert.equal(compareExrLinear(a, near).passed, true);
  // gross divergence fails
  const far = { width: a.width, height: a.height, data: Float32Array.from(a.data) };
  for (let i = 0; i < far.data.length; i++) far.data[i] *= 2;
  assert.equal(compareExrLinear(a, far).passed, false);
});

// ---- reuse gate -----------------------------------------------------------

const REUSE_KEY = { schema: 'acp.prepared-key/v1', keySha256: H64, preparedSchema: 'acp.prepared/v1' };
const reuseHit = (extra = {}) => ({
  status: 'hit',
  keySha256: H64,
  bytesVerified: true,
  identityOk: true,
  inventoryOk: true,
  preparedSchema: 'acp.prepared/v1',
  artifacts: [
    { path: 'person/posed.bin', sha256: H64, bytes: 4096 },
    { path: 'person/materials.json', sha256: H64, bytes: 128 },
  ],
  evidenceSha256: H64,
  ...extra,
});

test('reuse hit qualifies by digest re-verification of the complete closure', () => {
  const v = qualifyReuse({ key: REUSE_KEY, hit: reuseHit() });
  assert.equal(v.preparationReusable, true);
  assert.equal(v.outputQualified, true);
  assert.equal(v.frameHarnessUnchanged, true);
  assert.equal(v.sampledOutputChecksRequired, false);
  assert.ok(v.evidenceRequired.includes('bytesVerified closure re-hash'));
});

test('reuse gate refuses key mismatch, unverified bytes and missing output evidence', () => {
  assert.throws(() => qualifyReuse({ key: REUSE_KEY, hit: reuseHit({ keySha256: 'b'.repeat(64) }) }), /key mismatch/);
  assert.throws(() => qualifyReuse({ key: REUSE_KEY, hit: reuseHit({ bytesVerified: false }) }), /bytesVerified/);
  assert.throws(() => qualifyReuse({ key: REUSE_KEY, hit: reuseHit({ evidenceSha256: null }) }), /output-qualification evidence/);
  assert.throws(() => qualifyReuse({ key: REUSE_KEY, hit: reuseHit({ identityOk: false }) }), /identity/);
  assert.throws(() => qualifyReuse({ key: REUSE_KEY, hit: reuseHit({ inventoryOk: false }) }), /inventory/);
  assert.throws(() => qualifyReuse({
    key: REUSE_KEY, hit: reuseHit({ artifacts: [{ path: '../escape.bin', sha256: H64, bytes: 1 }] }),
  }), /traversal/);
  assert.throws(() => qualifyReuse({ key: REUSE_KEY, hit: reuseHit({ preparedSchema: 'acp.prepared/v2' }) }),
    /schema must equal/);
});

test('reuse miss does not claim reuse and keeps the normal qualification path', () => {
  const v = qualifyReuse({ key: REUSE_KEY, hit: { status: 'miss', keySha256: H64 } });
  assert.equal(v.preparationReusable, false);
  assert.equal(v.outputQualified, false);
  assert.match(v.evidenceRequired[0], /normal fixed-frame qualification/);
  const q = qualifyReuse({ key: REUSE_KEY, hit: { status: 'quarantined', keySha256: H64 } });
  assert.equal(q.preparationReusable, false);
});

// ---- accounting models ----------------------------------------------------

test('frame-evaluation model restates the staged cohort exactly and stays a work count', () => {
  const m = frameEvalModel();
  assert.equal(m.baselineFrameEvaluations, 23654);
  assert.equal(m.candidateFrameEvaluations, 7781);
  assert.equal(m.removedBrowserInitializations, 19);
  assert.equal(m.reductionPercent.toFixed(1), '67.1');
  assert.equal(m.workRatio.toFixed(2), '3.04');
  assert.equal(m.measuredElapsed, false);
  assert.equal(m.unit, 'frame evaluations');
  assert.throws(() => frameEvalModel({ unit: 'seconds' }), ReuseError);
});

test('prep saving is seconds and percent-of-prep only', () => {
  const p = prepSaving({ secondsRemoved: 660, baselinePrepSeconds: 2103.4, jobId: 'oneshot_b' });
  assert.equal(p.unit, 'seconds of preparation');
  assert.equal(p.percentOfPrepPhase.toFixed(1), '31.4');
  assert.match(p.attribution, /never added to or subtracted from frame-evaluation/i);
  assert.throws(() => prepSaving({ secondsRemoved: -1, baselinePrepSeconds: 10 }), ReuseError);
});

test('disjointness check keeps frame, prep and elapsed claims separate', () => {
  const m = frameEvalModel();
  const p = prepSaving({ secondsRemoved: 660, baselinePrepSeconds: 2103.4 });
  const separate = assertDisjointClaims({ frameModel: m, prepSavings: [p] });
  assert.equal(separate.passed, true);
  // combined ratio across models refuses
  assert.equal(assertDisjointClaims({ frameModel: m, prepSavings: [p], elapsedClaim: { combinedRatio: 4 } }).passed, false);
  // deriving elapsed from a work-count model refuses
  assert.equal(assertDisjointClaims({ frameModel: m, elapsedClaim: { derivedFrom: 'frame-evals' } }).passed, false);
  // crediting removed browser initializations twice refuses
  assert.equal(assertDisjointClaims({
    frameModel: m, prepSavings: [{ ...p, includesBrowserInitializations: true }],
  }).passed, false);
  // throughput must be measured, not derived
  assert.equal(assertDisjointClaims({ frameModel: m, throughput: { derivedFrom: 'frame-evals' } }).passed, false);
  assert.equal(assertDisjointClaims({ frameModel: m, throughput: { schema: 'acp.throughput-comparison/v1' } }).passed, true);
});

// ---- intended GPU path evidence -------------------------------------------

const GPU_A = 'GPU-12345678-1234-1234-1234-123456789abc';
const GPU_B = 'GPU-ABCDEF01-2345-6789-ABCD-EF0123456789';
const evidencePair = () => ({
  receipt: {
    schema: 'acp.native-receipt/v1', jobId: 'oneshot_b', attemptId: 'att-1', status: 'ok',
    admission: { jobSha256: H64, backendSha256: H64, status: 'source-compatible', attemptId: 'att-1' },
    allocation: { uuids: [GPU_A], evidenceRef: 'stages.jsonl' },
    timingsSchema: 'acp.stage-timing/v1',
    timings: { preparationMs: 1, simulationMs: 1, drawMs: 1, transferMs: 1, encodeMs: 1, totalElapsedMs: 6, peakMemoryBytes: 2048 },
    files: [{ name: 'oneshot_b.mp4', size: 1, sha256: H64 }],
  },
  rendererReceipt: {
    schema: 'acp.renderer-receipt/v1', status: 'ok', execution: 'vulkan-shared-wgpu',
    jobSha256: H64, backendSha256: H64, attemptId: 'att-1',
    uuid: GPU_A, uuids: [GPU_A], peakMemoryBytes: 2048, fallback: false,
  },
  expected: { jobSha256: H64, backendSha256: H64, attemptId: 'att-1' },
});

test('intended GPU path evidence verifies from completed artifacts', () => {
  const v = verifyRenderEvidence(evidencePair());
  assert.equal(v.passed, true);
  assert.deepEqual(v.gpuUuids, [GPU_A.toUpperCase().replace('GPU-','GPU-')]); // farm-normalized case
  assert.equal(v.peakMemoryBytes.renderer, 2048);
  assert.equal(v.peakMemoryBytes.receipt, 2048);
});

test('evidence refuses fallback, foreign receipts and malformed UUIDs', () => {
  const base = evidencePair();
  const refused = patch => !verifyRenderEvidence({ ...base, ...patch }).passed;
  // CPU fallback or other execution path
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, execution: 'cpu' } }), true);
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, fallback: true } }), true);
  // stale/foreign receipts
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, attemptId: 'att-0' } }), true);
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, jobSha256: 'c'.repeat(64) } }), true);
  assert.equal(refused({ receipt: { ...base.receipt, admission: { ...base.receipt.admission, status: 'held' } } }), true);
  // wrong device
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, uuid: GPU_B, uuids: [GPU_B] } }), true);
  // malformed entries are rejected, never filtered
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, uuid: '0', uuids: ['0'] } }), true);
  // contradictory aliases
  assert.equal(refused({ rendererReceipt: { ...base.rendererReceipt, uuid: GPU_B } }), true);
  // no renderer receipt at all
  assert.equal(verifyRenderEvidence({ ...base, rendererReceipt: null }).passed, false);
  // duplicate admitted cards
  assert.equal(refused({ receipt: { ...base.receipt, allocation: { ...base.receipt.allocation, uuids: [GPU_A, GPU_A] } } }), true);
});
