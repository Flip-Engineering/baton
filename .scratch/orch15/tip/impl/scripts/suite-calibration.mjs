// The load-aware suite calibration (issue #77; contract
// docs/reference/evidence/suite-resource-governance-2026-08-12/suite-resource-governance-contract.md
// v1.1, folded per contract-fold.md and suite-fold-2.md).
//
// One measurement answers how much slower this host is right now than its recorded idle
// baseline: an event-loop-gap probe sampled K=5 times sequentially (D1.1), the host's load
// average, and the baseline probe value from a recorded receipt (D1.5). The ratio — the factor
// — scales deadline-bound rows (RG-04) and sheds file-level test concurrency under load (D3.1).
// The runner prints the record once on stderr and hands it verbatim to every test child as
// BATON_SUITE_CALIBRATION (RG-01/RG-02), so a flake report can cite the load context its row
// ran under (RG-07).
//
// Every vocabulary here is a closed set (§3): the record key set, the cause classes, the
// refusal codes, the load-aware markers, and the G4 membership table are frozen, and every
// literal array is its own .sort() result — ACTUAL order, localeCompare banned.
//
// Refusals are typed and fail-closed (D4): a probe or load read that cannot measure refuses
// with suite_calibration_unavailable naming the measurement that failed; a record that cannot
// be parsed, or a cause class outside the closed set, refuses with suite_calibration_invalid.
// A refusal is never a silent factor 1.

import { readFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';

const SCHEMA_VERSION = 1;

// The module-missing harness stage stringifies the namespace into its own failure message, so
// the namespace carries a string code the way impl/src/limits.mjs does for the same pattern.
export const code = 'suite-calibration-module';

// D1.1/blocker B5: exactly K sequential samples with non-overlapping cadence windows; the
// median sample is the record's probeMs.
const PROBE_SAMPLES = 5;
const PROBE_WINDOW_MS = 20;

// D1.4/blocker B2: the closed, decidable G4 membership table. A member marked `scale` derives
// its bound by the factor; `absolute-timing` and `floor-raw` rows are excluded from derivation —
// a floor-raw row scaling would weaken the regression detector, and an absolute-timing row names
// a product constant, not a margin. Any rowId outside the table derives by default: the flake
// cluster is the load-aware default (D4).
export const G4_MEMBERSHIP = Object.freeze({
  'deployment-settle-deadline': 'scale',
  'request-timeout-wait': 'absolute-timing',
  'poll-interval-wake': 'absolute-timing',
  'sigkill-window-upper': 'scale',
  'sigkill-window-lower': 'floor-raw',
  'kill-grace-floor': 'floor-raw',
});

// D2.2 (§3): the closed cause-class vocabulary. `timer_coalescing` is merged into
// `event_loop_gap` (v1.1) and is refused.
export const CAUSE_CLASSES = Object.freeze([
  'drain_deadline', 'event_loop_gap', 'margin_window', 'poll_floor', 'start_latency',
]);

// D4 (§3): the two typed refusal codes.
export const REFUSAL_CODES = Object.freeze(['suite_calibration_invalid', 'suite_calibration_unavailable']);

// D4 (§3): the load-aware markers a row can carry.
export const MARKERS = Object.freeze(['absolute-timing', 'floor-raw', 'load-aware']);

// D1.5 (§3): whether the record's baseline comes from a recorded receipt or none was recorded.
export const BASELINE_BASIS = Object.freeze(['recorded', 'unrecorded']);

/** The typed refusal every calibration failure carries; `.code` is a REFUSAL_CODES member. */
export class CalibrationRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CalibrationRefusal';
    this.code = code;
  }
}

/**
 * One calibration record (D1.3's closed key set, in ACTUAL order).
 *
 * Overrides are the test-double seam (RG-04/RG-06): `load` replaces the os.loadavg() read,
 * `probeMs` replaces the sampled measurement, `baselineProbeMs` replaces the recorded baseline,
 * `probe` injects an async sampler (called exactly K=5 times, sequentially), and
 * `baselineReceiptPath` names the baseline receipt JSON the baseline is read from — a present
 * receipt records baselineProbeMs, an absent receipt yields the honest null. Absent overrides
 * measure the real host.
 */
export async function measureCalibration({
  load, probeMs, baselineProbeMs, probe, baselineReceiptPath,
} = {}) {
  const cores = availableParallelism();
  const observedLoad = readLoad(load);
  const measuredProbeMs = typeof probeMs === 'number' && Number.isFinite(probeMs)
    ? probeMs
    : await sampleProbe(probe);
  const baseline = resolveBaseline({ baselineProbeMs, baselineReceiptPath });
  const factor = baseline.baselineProbeMs === null
    ? 1
    : Math.max(1, measuredProbeMs / baseline.baselineProbeMs);
  return {
    baselineBasis: baseline.basis,
    baselineProbeMs: baseline.baselineProbeMs,
    cores,
    factor,
    load: observedLoad,
    measuredAt: new Date().toISOString(),
    probeMs: measuredProbeMs,
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * The parsed BATON_SUITE_CALIBRATION record, or null when the env is absent. A value that
 * cannot be parsed as a record object refuses with suite_calibration_invalid naming the parse
 * error (D4, open question 3) — never a silent factor 1.
 */
export function readCalibration() {
  const raw = process.env.BATON_SUITE_CALIBRATION;
  if (raw === undefined || raw === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CalibrationRefusal('suite_calibration_invalid',
      `BATON_SUITE_CALIBRATION could not be parsed as JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CalibrationRefusal('suite_calibration_invalid',
      'BATON_SUITE_CALIBRATION does not carry a calibration record object');
  }
  return parsed;
}

/** The factor a record carries, or the idle 1 — a record without a finite factor is idle. */
function factorOf(record) {
  const factor = record === null || record === undefined ? undefined : record.factor;
  return typeof factor === 'number' && Number.isFinite(factor) && factor >= 1 ? factor : 1;
}

/** The load-aware deadline: base scaled by the record's factor; no record is the static bound. */
export function scaledTimeout(base, record = readCalibration()) {
  return base * factorOf(record);
}

/**
 * D3.1/blocker B4: the file-level concurrency the gate derives — factor 1 preserves node's
 * idle default os.availableParallelism() - 1, a loaded host sheds instead of amplifying, and
 * the floor of 1 keeps a calibration from forking a bomb.
 */
export function deriveTestConcurrency(cores, factor) {
  return Math.max(1, Math.ceil((cores - 1) / factor));
}

/** D3.2: the stop-path grace scales by the factor — a loaded machine gets more grace. */
export function deriveStopGrace(baseGraceMs, factor) {
  return baseGraceMs * factor;
}

/**
 * D2's decision procedure (the D2.1 discipline plus the outcome-correctness gate, B1/RG-13):
 * a row that fails isolated is never recalibrated (regardless of the load leg); a row that
 * passes under load is a transient blip; a load-flake whose extended bound never landed the
 * awaited condition is a REAL BUG and gets no class; a confirmed load-flake classifies into the
 * closed set — and neither classifies without its calibration record (D2.4) or outside the
 * closed vocabulary, both of which refuse with suite_calibration_invalid.
 */
export function classifyCause(receipt, row) {
  const reruns = receipt?.reruns;
  if (reruns?.isolated?.failed === true) return null;
  if (reruns?.load?.failed !== true) return null;
  if (receipt?.outcome?.confirmed !== true) return null;
  if (receipt?.calibration === null || typeof receipt?.calibration !== 'object') {
    throw new CalibrationRefusal('suite_calibration_invalid',
      `row ${row} names a cause class with no calibration record in its receipt — a flake report never classifies without its load context (D2.4)`);
  }
  if (!CAUSE_CLASSES.includes(receipt.cause)) {
    throw new CalibrationRefusal('suite_calibration_invalid',
      `row ${row} names cause ${JSON.stringify(receipt.cause)} — not a member of the closed cause classes (${CAUSE_CLASSES.join(', ')})`);
  }
  return receipt.cause;
}

/**
 * D1.4/RG-12: the bound one row gets under a record. A closed G4 member marked
 * `absolute-timing` or `floor-raw` keeps its base; a `scale` member and any unmarked rowId
 * derive by the factor — the unmarked default is derivation because the flake cluster is the
 * load-aware default (D4).
 */
export function deriveRowBound(rowId, base, record) {
  const marker = G4_MEMBERSHIP[rowId];
  if (marker === 'absolute-timing' || marker === 'floor-raw') return base;
  return base * factorOf(record);
}

/**
 * D1.4/blocker B6: the re-arm-on-progress liveness bound. Any observe() re-arms the deadline;
 * expired() is "no new event since the last tick" — liveness evidence, not elapsed-time
 * scaling. `now` is the injected clock seam.
 */
export function createProgressDeadline({ timeoutMs, now = Date.now } = {}) {
  let lastEvent = now();
  return {
    observe() { lastEvent = now(); },
    expired() { return now() - lastEvent >= timeoutMs; },
  };
}

/** The load read: the override object or os.loadavg(), normalized to the closed key order. */
function readLoad(override) {
  try {
    const raw = override ?? loadavg();
    const named = Array.isArray(raw) ? { one: raw[0], five: raw[1], fifteen: raw[2] } : raw;
    const fifteen = named.fifteen;
    const five = named.five;
    const one = named.one;
    if (![fifteen, five, one].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new CalibrationRefusal('suite_calibration_unavailable',
        'the loadavg read returned a non-numeric load average');
    }
    return { fifteen, five, one };
  } catch (error) {
    if (error instanceof CalibrationRefusal) throw error;
    throw new CalibrationRefusal('suite_calibration_unavailable',
      `the loadavg read failed: ${error.message}`);
  }
}

/** One event-loop-gap sample: how far past its window a timer landed. */
async function eventLoopGap(windowMs) {
  const start = performance.now();
  await new Promise((resolveTimer) => setTimeout(resolveTimer, windowMs));
  return Math.max(0, performance.now() - start - windowMs);
}

/** K sequential samples (injected sampler or the real gap probe); the median is probeMs. */
async function sampleProbe(injected) {
  const samples = [];
  for (let index = 0; index < PROBE_SAMPLES; index += 1) {
    try {
      const gap = injected ? await injected() : await eventLoopGap(PROBE_WINDOW_MS);
      if (typeof gap !== 'number' || !Number.isFinite(gap)) {
        throw new Error('the sample was not a finite number');
      }
      samples.push(gap);
    } catch (error) {
      throw new CalibrationRefusal('suite_calibration_unavailable',
        `the event-loop-gap probe failed on sample ${samples.length + 1} of ${PROBE_SAMPLES}: ${error.message}`);
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(PROBE_SAMPLES / 2)];
}

/** The baseline: an explicit value, a recorded receipt, or the honest null (D1.5/B3). */
function resolveBaseline({ baselineProbeMs, baselineReceiptPath }) {
  if (typeof baselineProbeMs === 'number' && Number.isFinite(baselineProbeMs)) {
    return { basis: 'recorded', baselineProbeMs };
  }
  if (baselineReceiptPath !== undefined && baselineReceiptPath !== null) {
    let raw;
    try {
      raw = readFileSync(baselineReceiptPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { basis: 'unrecorded', baselineProbeMs: null };
      throw new CalibrationRefusal('suite_calibration_unavailable',
        `the baseline receipt at ${baselineReceiptPath} could not be read: ${error.message}`);
    }
    let receipt;
    try {
      receipt = JSON.parse(raw);
    } catch (error) {
      throw new CalibrationRefusal('suite_calibration_invalid',
        `the baseline receipt at ${baselineReceiptPath} could not be parsed as JSON: ${error.message}`);
    }
    if (typeof receipt?.baselineProbeMs !== 'number' || !Number.isFinite(receipt.baselineProbeMs)) {
      throw new CalibrationRefusal('suite_calibration_invalid',
        `the baseline receipt at ${baselineReceiptPath} names no numeric baselineProbeMs`);
    }
    return { basis: 'recorded', baselineProbeMs: receipt.baselineProbeMs };
  }
  return { basis: 'unrecorded', baselineProbeMs: null };
}
