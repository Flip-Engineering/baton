import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cpuProfileOptions, summarizeProfile, CpuProfileCapture, createCpuProfileCapture,
  writeCpuProfileReceipt, runWithCleanup } from './cpu_profile.mjs';

function profile() {
  return {
    startTime: 1,
    endTime: 1.006,
    nodes: [
      { id: 1, callFrame: { functionName: 'personBuild', url: 'http://127.0.0.1:31415/web/lib/fx/person/build.js', lineNumber: 8, columnNumber: 1 } },
      { id: 2, callFrame: { functionName: 'bakeTrack', url: 'http://127.0.0.1:31415/web/lib/fx/motion/bake7.js', lineNumber: 28, columnNumber: 4 } },
    ],
    samples: [1, 2, 1],
    timeDeltas: [1000, 4000, 1000],
  };
}

class MockCdp {
  constructor(fail = null, profileData = profile()) {
    this.calls = []; this.fail = fail; this.profileData = profileData; this.detaches = 0;
    this.browserAlive = true; this.pendingResolve = null; this.hang = null;
  }
  async send(method, params) {
    this.calls.push({ method, params });
    if (method === this.fail) throw new Error('mock CDP failure');
    if (method === this.hang) return new Promise(resolve => { this.pendingResolve = resolve; });
    if (method === 'Profiler.stop') return { profile: this.profileData };
    return {};
  }
  async detach() { this.detaches++; }
}

assert.equal(cpuProfileOptions({}), null);
let defaultSessionCreations = 0;
assert.equal(await createCpuProfileCapture(null, async () => { defaultSessionCreations++; }), null);
assert.equal(defaultSessionCreations, 0, 'profiling disabled by default creates no CDP session');
const options = cpuProfileOptions({
  ACP_CPU_PROFILE: '1',
  ACP_CPU_PROFILE_INTERVAL_US: '1000',
  ACP_CPU_PROFILE_WINDOW_MS: '60000',
  ACP_CPU_PROFILE_REPORT_BUDGET_BYTES: '8192',
});
assert.equal(options.samplingIntervalUs, 1000);
assert.equal(options.windowMs, 16, 'window length derives from report budget and sampling interval');
assert.equal(options.maxSamplesPerWindow, 16);
assert.equal(options.reportBudgetBytes, 8192);
assert.equal(cpuProfileOptions({ ACP_CPU_PROFILE: '1', ACP_CPU_PROFILE_INTERVAL_US: 'bad' }).samplingIntervalUs, 20000);

const top = summarizeProfile(profile());
assert.equal(top[0].function, 'bakeTrack');
assert.equal(top[0].selfMs, 4);
assert.equal(top[0].url, '/web/lib/fx/motion/bake7.js', 'ephemeral local server origin is removed');
assert.equal(top[1].selfMs, 2);

const cdp = new MockCdp();
let phase = 'scene-ready-wait';
const updates = [];
const capture = new CpuProfileCapture(cdp, {
  samplingIntervalUs: 1000,
  windowMs: 6,
  reportBudgetBytes: 8192,
  maxSamplesPerWindow: 16,
  maxFunctions: 4,
  maxPhases: 3,
}, () => phase, report => updates.push(report));
assert.equal(await capture.start(), true);
await new Promise(resolve => setTimeout(resolve, 2));
phase = 'clip-frame-loop';
await new Promise(resolve => setTimeout(resolve, 28));
const report = await capture.stop();
assert(report.windowsCaptured >= 2, 'profiling continues over successive bounded windows');
assert.equal(report.status, 'complete');
assert(report.phases.some(row => row.phase === 'scene-ready-wait'));
assert(report.phases.some(row => row.phase === 'clip-frame-loop' || row.phase === 'other'));
assert(report.mixedWindows >= 1, 'phase boundaries within a sampling window are counted');
assert(updates.length >= 1, 'completed windows publish partial reports for failure recovery');
assert(Buffer.byteLength(JSON.stringify(report), 'utf8') <= 8192);
assert(report.topFunctions.length <= 4, 'retained function summaries stay within the configured entry bound');
assert(cdp.calls.some(call => call.method === 'Profiler.setSamplingInterval' && call.params.interval === 1000));
assert.equal(cdp.calls.filter(call => call.method === 'Profiler.start').length, report.windowsCaptured);
assert.equal(cdp.calls.filter(call => call.method === 'Profiler.stop').length, report.windowsCaptured);
assert(cdp.calls.some(call => call.method === 'Profiler.disable'));

const failing = new CpuProfileCapture(new MockCdp('Profiler.start'), { samplingIntervalUs: 1000, windowMs: 10,
  reportBudgetBytes: 8192, maxSamplesPerWindow: 16, maxFunctions: 4, maxPhases: 3 });
assert.equal(await failing.start(), false);
const failedReport = await failing.stop();
assert.equal(failedReport.status, 'unavailable');
assert.match(failedReport.error, /mock CDP failure/);

const stuckCdp = new MockCdp();
stuckCdp.hang = 'Profiler.start';
const stuckCapture = new CpuProfileCapture(stuckCdp, { samplingIntervalUs: 1000, windowMs: 10,
  commandTimeoutMs: 5, reportBudgetBytes: 8192, maxSamplesPerWindow: 16, maxFunctions: 4, maxPhases: 2 });
assert.equal(await stuckCapture.start(), false, 'a never-settling CDP command times out the profiler');
assert.equal(stuckCdp.detaches, 1, 'the profiler detaches its own page CDP session on timeout');
assert.equal(stuckCdp.browserAlive, true, 'detaching the page CDP session leaves the browser alive');
const beforeLateResolution = stuckCdp.calls.length;
stuckCdp.pendingResolve({});
await new Promise(resolve => setImmediate(resolve));
const stuckReport = await stuckCapture.stop();
assert.equal(stuckReport.status, 'unavailable');
assert.equal(stuckCdp.calls.length, beforeLateResolution, 'late command resolution does not send more CDP commands');

const screenshotCdp = new MockCdp();
const profileOnlyCdp = new MockCdp();
profileOnlyCdp.hang = 'Profiler.start';
let enabledSessionCreations = 0;
const isolatedCapture = await createCpuProfileCapture({ samplingIntervalUs: 1000, windowMs: 10,
  commandTimeoutMs: 5, reportBudgetBytes: 8192, maxSamplesPerWindow: 16, maxFunctions: 4, maxPhases: 2 },
  async () => { enabledSessionCreations++; return profileOnlyCdp; });
assert.equal(enabledSessionCreations, 1, 'enabled profiling creates its owned CDP session');
assert.equal(await isolatedCapture.start(), false, 'profile-session timeout disables profiling');
assert.equal(profileOnlyCdp.detaches, 1, 'timeout detaches only the owned profiling session');
assert.deepEqual(await screenshotCdp.send('Page.captureScreenshot'), {},
  'renderer screenshot session remains usable after profiler timeout');
assert.equal(screenshotCdp.detaches, 0, 'profiling timeout never detaches renderer screenshot session');

for (const stage of ['goto', 'readiness', 'frame', 'audit', 'encode']) {
  const trace = [];
  const renderError = new Error(`${stage} failed`);
  await assert.rejects(runWithCleanup(async () => { trace.push(stage); throw renderError; }, async () => {
    try { trace.push('stop-profiler'); throw new Error('profile shutdown failure'); } catch (_) { /* render cleanup continues */ }
    try { trace.push('close-browser'); } finally { trace.push('close-server'); }
  }), error => error === renderError, 'render-stage failure remains the primary error');
  assert.deepEqual(trace, [stage, 'stop-profiler', 'close-browser', 'close-server']);
}
await assert.rejects(runWithCleanup(async () => 'done', async () => { throw new Error('cleanup-only failure'); }), /cleanup-only failure/);

const manyNodes = Array.from({ length: 20 }, (_, i) => ({ id: i + 1,
  callFrame: { functionName: `fn${i}`, url: `/bundle/${i}.js`, lineNumber: i, columnNumber: 0 } }));
const boundedCapture = new CpuProfileCapture(new MockCdp(null, {
  nodes: manyNodes,
  samples: manyNodes.map(node => node.id),
  timeDeltas: manyNodes.map(() => 1000),
}), { samplingIntervalUs: 1000, windowMs: 10000, reportBudgetBytes: 8192,
  maxSamplesPerWindow: 16, maxFunctions: 2, maxPhases: 2 });
assert.equal(await boundedCapture.start(), true);
const boundedReport = await boundedCapture.stop();
assert.equal(boundedReport.windowsCaptured, 1);
assert.equal(boundedReport.topFunctions.length, 2, 'Space-Saving aggregation retains only the configured number of functions');
assert(boundedReport.topFunctions.every(entry => Number.isFinite(entry.errorMs) && Number.isFinite(entry.errorSamples)));
assert(Buffer.byteLength(JSON.stringify(boundedReport), 'utf8') <= 8192);

const renderer = fs.readFileSync(new URL('./render.mjs', import.meta.url), 'utf8');
assert(renderer.indexOf('await cpuProfile.start()') < renderer.indexOf('await page.goto('), 'profiling starts before scene navigation/readiness');
assert.equal((renderer.match(/const cdp = await page\.context\(\)\.newCDPSession\(page\)/g) || []).length, 1,
  'renderer retains its dedicated screenshot CDP session');
assert.match(renderer, /createCpuProfileCapture\(profileOptions,[\s\S]*?newCDPSession\(page\)/,
  'enabled profiling creates a separate page CDP session');
assert.match(renderer, /await runWithCleanup\(async \(\) => \{/);
assert.match(renderer, /homelab-\$\{profileWorkerLabel\}-renderer\.json/);
assert.match(renderer, /writeCpuProfileReceipt\(profileFile/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-profile-test-'));
try {
  const receiptPath = path.join(temp, 'homelab-gpu0-renderer.json');
  fs.writeFileSync(receiptPath, JSON.stringify({ gpu: { renderer: 'pinned hardware receipt' }, scene: 'sample' }));
  writeCpuProfileReceipt(receiptPath, 'sample', 'gpu0', report, 123, '2026-10-16T00:00:00.000Z');
  const saved = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(saved.gpu.renderer, 'pinned hardware receipt', 'CPU profile update preserves the existing GPU receipt');
  assert.equal(saved.cpuProfile.when, '2026-10-16T00:00:00.000Z');
  assert.equal(saved.cpuProfile.samplesCaptured, report.samplesCaptured);

  const corruptPath = path.join(temp, 'corrupt.json');
  fs.writeFileSync(corruptPath, '{broken');
  assert.throws(() => writeCpuProfileReceipt(corruptPath, 'sample', 'gpu0', report, 456), /JSON/);
  assert.equal(fs.readFileSync(corruptPath, 'utf8'), '{broken', 'malformed receipt is preserved on write failure');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('CPU profiler mock tests passed');
