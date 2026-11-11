import fs from 'node:fs';

// Opt-in CDP main-thread profiles for an existing Chromium page. Profiles are
// summarized at bounded intervals; retained state is sized from a byte budget.
const integer = (raw, fallback, minimum) => {
  const value = raw == null || raw === '' ? fallback : Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
};

export function cpuProfileOptions(env = process.env) {
  if (env.ACP_CPU_PROFILE !== '1') return null;
  const samplingIntervalUs = integer(env.ACP_CPU_PROFILE_INTERVAL_US, 20000, 1000);
  const requestedWindowMs = integer(env.ACP_CPU_PROFILE_WINDOW_MS, 15000, 100);
  const reportBudgetBytes = integer(env.ACP_CPU_PROFILE_REPORT_BUDGET_BYTES, 262144, 8192);
  // The CDP profile tree is transient. Bound each tree by an estimated sample
  // allowance derived from the same operator-selected byte budget, then discard
  // it after merging its summary. The bound is an estimate, not a V8 heap cap.
  const maxSamplesPerWindow = Math.max(16, Math.floor(reportBudgetBytes / 1024));
  const windowMs = Math.min(requestedWindowMs,
    Math.max(samplingIntervalUs / 1000, maxSamplesPerWindow * samplingIntervalUs / 1000));
  const maxFunctions = Math.max(1, Math.floor(Math.max(1024, reportBudgetBytes - 4096) / 512));
  const maxPhases = Math.max(2, Math.floor(Math.max(4096, reportBudgetBytes - 4096) / 4096));
  return {
    samplingIntervalUs,
    requestedWindowMs,
    windowMs,
    reportBudgetBytes,
    maxSamplesPerWindow,
    maxFunctions,
    maxPhases,
  };
}

const clip = (value, n = 240) => String(value ?? '').replace(/^https?:\/\/127\.0\.0\.1:\d+/, '').slice(0, n);

export function writeCpuProfileReceipt(file, scene, workerLabel, report, pid = process.pid, when = new Date().toISOString()) {
  const tmp = `${file}.tmp-${pid}`;
  try {
    let receipt = { schema: 1, kind: 'chromium-cpu-profile', scene, worker: { label: workerLabel } };
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('existing renderer receipt is not an object');
      receipt = existing;
    }
    receipt.cpuProfile = { when, ...report };
    fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    throw error;
  }
}

export async function runWithCleanup(operation, cleanup) {
  let operationError = null;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (!operationError) throw cleanupError;
    }
  }
}

export function summarizeProfile(profile) {
  const nodes = new Map((profile?.nodes || []).map(node => [node.id, node]));
  const totals = new Map();
  const samples = profile?.samples || [];
  const deltas = profile?.timeDeltas || [];
  const inferredDelta = samples.length
    ? Math.max(0, (Number(profile.endTime) - Number(profile.startTime)) / samples.length)
    : 0;
  for (let i = 0; i < samples.length; i++) {
    const node = nodes.get(samples[i]);
    if (!node) continue;
    const frame = node.callFrame || {};
    const key = [frame.url || '', frame.functionName || '(anonymous)', frame.lineNumber ?? -1,
      frame.columnNumber ?? -1].join('\0');
    const entry = totals.get(key) || {
      function: clip(frame.functionName || '(anonymous)', 96),
      url: clip(frame.url || '', 200),
      line: Number.isInteger(frame.lineNumber) ? frame.lineNumber + 1 : null,
      column: Number.isInteger(frame.columnNumber) ? frame.columnNumber + 1 : null,
      samples: 0,
      selfMs: 0,
    };
    entry.samples++;
    entry.selfMs += Math.max(0, Number(deltas[i] ?? inferredDelta)) / 1000;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.selfMs - a.selfMs || b.samples - a.samples || a.url.localeCompare(b.url));
}

// Weighted Space-Saving summary. Its retained entry count is derived from the
// report budget; errorMs records the maximum amount hidden by replacement.
// Per-window summarizeProfile still builds a temporary map and sort array whose
// size scales with unique sampled functions; this is not a strict heap bound.
function addBounded(entries, key, value, limit) {
  if (!(value.selfMs > 0)) return;
  const present = entries.get(key);
  if (present) {
    present.samples += value.samples;
    present.selfMs += value.selfMs;
    return;
  }
  if (entries.size < limit) {
    entries.set(key, { ...value, errorMs: 0, errorSamples: 0 });
    return;
  }
  let minKey, minimum = Infinity, minimumSamples = 0;
  for (const [candidate, item] of entries) {
    if (item.selfMs < minimum) { minKey = candidate; minimum = item.selfMs; minimumSamples = item.samples; }
  }
  entries.delete(minKey);
  entries.set(key, { ...value, samples: minimumSamples + value.samples, selfMs: minimum + value.selfMs,
    errorMs: minimum, errorSamples: minimumSamples });
}

export class CpuProfileCapture {
  constructor(cdp, options, phase = () => 'unknown', onUpdate = () => {}) {
    this.cdp = cdp;
    this.options = options;
    this.phase = phase;
    this.onUpdate = onUpdate;
    this.active = false;
    this.stopping = false;
    this.available = true;
    this.error = null;
    this.pumpPromise = null;
    this.wake = null;
    this.detached = false;
    this.detachPromise = null;
    this.windowsCaptured = 0;
    this.samplesCaptured = 0;
    this.mixedWindows = 0;
    this.phaseStats = new Map();
    this.functions = new Map();
  }

  async start() {
    if (!this.options) return false;
    try {
      await this.send('Profiler.enable');
      await this.startWindow();
      if (!this.active) return false;
      this.pumpPromise = this.pump();
      return true;
    } catch (error) {
      this.recordError(error);
      return false;
    }
  }

  async startWindow() {
    if (this.stopping || !this.available) return;
    try {
      await this.send('Profiler.setSamplingInterval', { interval: this.options.samplingIntervalUs });
      this.phaseStart = this.phaseName(this.phase());
      this.wallStart = Date.now();
      await this.send('Profiler.start');
      this.active = true;
    } catch (error) {
      this.recordError(error);
    }
  }

  async send(method, params) {
    if (this.detached) throw new Error('CDP session detached after profile timeout');
    let timer;
    try {
      return await Promise.race([
        this.cdp.send(method, params),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(method + ' timed out');
            error.code = 'CPU_PROFILE_CDP_TIMEOUT';
            reject(error);
          }, this.options.commandTimeoutMs ?? 5000);
        }),
      ]);
    } catch (error) {
      if (error?.code === 'CPU_PROFILE_CDP_TIMEOUT') await this.detachOwnedSession();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async detachOwnedSession() {
    if (this.detached) return;
    this.detached = true;
    this.stopping = true;
    this.active = false;
    this.available = false;
    this.wake?.();
    this.detachPromise = Promise.resolve().then(() => this.cdp.detach()).catch(() => {});
    let timer;
    try {
      await Promise.race([this.detachPromise, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
    } finally {
      clearTimeout(timer);
    }
  }

  async pump() {
    while (this.active && !this.stopping && this.available) {
      const reason = await new Promise(resolve => {
        const timer = setTimeout(() => resolve('window'), this.options.windowMs);
        this.wake = () => { clearTimeout(timer); resolve('stop'); };
      });
      this.wake = null;
      if (reason === 'stop' || this.stopping) break;
      await this.finishWindow();
      if (!this.stopping && this.available) await this.startWindow();
    }
  }

  async finishWindow() {
    if (!this.active) return;
    this.active = false;
    try {
      const result = await this.send('Profiler.stop');
      const profile = result?.profile;
      if (!profile) throw new Error('Profiler.stop returned no profile');
      const phaseEnd = this.phaseName(this.phase());
      const phase = this.storedPhase(this.phaseStart);
      const stats = this.phaseStats.get(phase) || { windows: 0, mixedWindows: 0, samples: 0, elapsedMs: 0 };
      const sampleCount = Array.isArray(profile.samples) ? profile.samples.length : 0;
      stats.windows++;
      stats.samples += sampleCount;
      stats.elapsedMs += Math.max(0, Date.now() - this.wallStart);
      if (phaseEnd !== this.phaseStart) { stats.mixedWindows++; this.mixedWindows++; }
      this.phaseStats.set(phase, stats);
      this.windowsCaptured++;
      this.samplesCaptured += sampleCount;
      for (const entry of summarizeProfile(profile)) {
        const key = [phase, entry.url, entry.function, entry.line, entry.column].join('\0');
        addBounded(this.functions, key, { phase, ...entry }, this.options.maxFunctions);
      }
      // Drop the only reference to the complete CDP tree before the next window.
      try { this.onUpdate(this.report()); } catch (error) { this.recordError(error); }
    } catch (error) {
      this.recordError(error);
    }
  }

  recordError(error) {
    this.available = false;
    this.error ||= clip(error?.message || error, 500);
  }

  phaseName(value) { return clip(value, 48) || 'unknown'; }

  storedPhase(name) {
    if (this.phaseStats.has(name)) return name;
    if (this.phaseStats.size < this.options.maxPhases - 1) return name;
    return 'other';
  }

  async stop() {
    if (!this.options) return this.report();
    this.stopping = true;
    this.wake?.();
    try {
      if (this.pumpPromise) await this.pumpPromise;
      await this.finishWindow();
      try { await this.send('Profiler.disable'); } catch (error) { this.recordError(error); }
    } catch (error) {
      this.recordError(error);
    }
    return this.report();
  }

  report() {
    if (!this.options) return { enabled: false };
    const report = {
      schema: 2,
      enabled: true,
      status: this.windowsCaptured ? (this.available ? 'complete' : 'partial') : this.error ? 'unavailable' : 'empty',
      scope: 'Chromium page main-thread JavaScript; excludes browser compositor, GPU, Node and FFmpeg work',
      aggregation: 'bounded weighted Space-Saving summaries; errorMs is the replacement error bound',
      transientAggregation: 'per-window unique-function map and sorted rows scale with the sampled profile; not strictly bounded',
      samplingIntervalUs: this.options.samplingIntervalUs,
      windowMs: this.options.windowMs,
      requestedWindowMs: this.options.requestedWindowMs,
      reportBudgetBytes: this.options.reportBudgetBytes,
      maxSamplesPerWindowEstimate: this.options.maxSamplesPerWindow,
      windowsCaptured: this.windowsCaptured,
      samplesCaptured: this.samplesCaptured,
      mixedWindows: this.mixedWindows,
      phases: [...this.phaseStats.entries()].map(([name, stats]) => ({ phase: name, ...stats })),
      topFunctions: [...this.functions.values()]
        .sort((a, b) => b.selfMs - b.errorMs - (a.selfMs - a.errorMs) || b.samples - a.samples || a.url.localeCompare(b.url))
        .map(entry => ({ ...entry, selfMs: +entry.selfMs.toFixed(3), errorMs: +entry.errorMs.toFixed(3) })),
      ...(this.error ? { error: this.error } : {}),
    };
    // Keep the serialized artifact within the configured budget. Trimming only
    // removes lowest-ranked summary rows and never changes render behavior.
    while (Buffer.byteLength(JSON.stringify(report), 'utf8') > this.options.reportBudgetBytes && report.topFunctions.length)
      report.topFunctions.pop();
    return report;
  }
}

// Profiling owns a separate page CDP session. A timeout can detach this
// session without affecting the renderer's screenshot and page-control CDP
// session. The default-off path does not allocate another CDP session.
export async function createCpuProfileCapture(options, createSession, phase, onUpdate, onError = () => {}) {
  if (!options) return null;
  try {
    return new CpuProfileCapture(await createSession(), options, phase, onUpdate);
  } catch (error) {
    try { onError(error); } catch (_) { /* profiling setup cannot fail a render */ }
    return null;
  }
}
