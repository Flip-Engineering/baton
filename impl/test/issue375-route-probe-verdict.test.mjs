// issue #375 — the route liveness probe's VERDICT.
//
// At HEAD a route's ready/blocked verdict is `captured === expectedLine` over a truncated 2 KiB
// slice (route-liveness.mjs:19 `PROBE_CAPTURE_MAX_BYTES = 2048`, :240-244) and a literal 120 s
// timer (:16, :222) adjudicates the rest: a healthy provider whose turn carries a banner, pads the
// line, or answers at length reads `probe_content_mismatch` and BLOCKS the route, and a probe that
// outlives the timer reads `provider_unreachable`/blocked — a verdict no evidence supports.
//
// The contract this file pins (#375, docs/43's registry law, the P1/P5 rulings):
//   1. the verdict is OCCURRENCE of the expected line as a whole line inside the captured turn,
//      never equality against a slice; the capture bound is a FRAME_LIMITS row
//      (`route.probe_capture`) and a capture that hit it is marked `truncated: true`;
//   2. the deadline is a registry row too (`route.probe_deadline_ms`); a probe that exceeds it
//      settles the route UNKNOWN (`code: probe_timed_out`, observed/required) — never blocked, and
//      the gate admits on the honest absence;
//   3. a `probe_content_mismatch` row names what was expected, a bounded REDACTED head of what was
//      captured, and whether the capture was truncated.
//
// Rows 375-a..375-e are the issue's red-before rows; 375-f1..375-h guard the registry sourcing and
// the cut-is-marked-as-a-cut reading (the A-Lcap law: a pin beyond the bound never verifies).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RouteLiveness } from '../src/route-liveness.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const MODEL = 'muse/muse-spark-1.3-probe';
const ROUTE = { harness: 'muse', model: MODEL, effort: 'high' };
const EXPECTED = `${MODEL}-probe ok`;
const HEAD_BOUND = 200;

// Read LAZILY: at HEAD neither registry row exists, and a module-level read would abort the file
// before its rows ran (a load error is not red-before evidence for a named stage).
const captureBound = () => FRAME_LIMITS['route.probe_capture']?.value ?? 2048;
const deadlineRow = () => FRAME_LIMITS['route.probe_deadline_ms']?.value;

// A scriptable probe adapter: the probe tier reaches the provider through the single `spawn` seam,
// so each mode scripts the terminal wire a real adapter would emit after the probe prompt.
class ProbeAdapter {
  constructor({ route = ROUTE, mode = 'exact', output = null, deadlineMs = 5_000 } = {}) {
    this._route = route;
    this.mode = mode;
    this.output = output;
    this.deadlineMs = deadlineMs;
    this.calls = [];
    this.events = [];
    this._onEvent = null;
  }

  card() {
    return {
      harness: this._route.harness,
      version: '1.0.0',
      authPosture: 'subscription',
      concurrencyCeiling: 4,
      modelSelection: {
        mode: 'exact', configuredDefault: this._route.model, available: [this._route.model],
        family: 'muse', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low', 'high'], serviceTier: null,
        provenance: 'issue375', refreshedAt: null,
      },
      providerCompatibility: { credentialState: 'available' },
      permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
      verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native' },
      decision: 'native',
      turnCompletion: 'pausable',
    };
  }

  onEvent(cb) { this._onEvent = cb; }

  emit(event) {
    this.events.push(event);
    if (this._onEvent) this._onEvent(event);
  }

  _emitFor(worker, kind, payload) {
    this.emit({
      worker, harness: `${this._route.harness}@1.0.0`, turnEpoch: 1, kind, actor: 'worker', payload,
    });
  }

  _turnText() {
    if (this.output !== null) return this.output;
    switch (this.mode) {
      case 'banner':
        return `Welcome to the provider.\nSigned in as probe.\n${EXPECTED}\n`;
      case 'trailing':
        return `answer follows\n${EXPECTED} \t \n`;
      case 'indented':
        return `answer follows\n    ${EXPECTED}\t\n`;
      case 'overBound':
        return `${'x'.repeat(captureBound() - 400)}\n${EXPECTED}\n${'y'.repeat(1200)}`;
      case 'beyondBound':
        return `${'x'.repeat(3072)}\n${EXPECTED}`;
      case 'wrong':
        return 'this is not the content-verified line';
      case 'secret':
        return 'not the pin\napi_key: sk-livesecret1234567890abcdef\n';
      default:
        return EXPECTED;
    }
  }

  async spawn(worker, brief) {
    this.calls.push({ worker, brief });
    const text = JSON.stringify(brief ?? {});
    if (!/probe/iu.test(text)) return { ok: true };
    setTimeout(() => {
      this._emitFor(worker, 'lifecycle.spawned', {});
      if (this.mode === 'hang') return; // the provider call starts and never completes
      this._emitFor(worker, 'resource.provider_call', { callId: `probe-${worker}`, phase: 'completed' });
      this._emitFor(worker, 'lifecycle.turn_completed', { status: 'completed', output: this._turnText() });
    }, 0);
    return { ok: true };
  }

  async prompt() { return { ok: true }; }
}

function fixture(adapter, { probeTimeoutMs = 5_000 } = {}) {
  const appended = [];
  const log = { append: (row) => { appended.push(row); return { ...row, seq: appended.length }; } };
  const liveness = new RouteLiveness({
    adapters: { muse: adapter }, now: Date.now, probeTimeoutMs, log,
  });
  return { liveness, appended };
}

function probeRecords(appended, kind) {
  return appended.filter((row) => row.kind === kind);
}

// ── 375-a / 375-b: a healthy turn that PREFIXES or PADS the expected line verifies ───────────────
test('375-a: a completed turn that carries a banner before the expected line reads verified', async () => {
  const adapter = new ProbeAdapter({ mode: 'banner' });
  const { liveness } = fixture(adapter);
  await liveness.ensure(ROUTE);
  const row = liveness.project(ROUTE);
  assert.equal(row.state, 'verified',
    'the expected line occurs inside the captured turn — a banner before it is not a mismatch');
  assert.ok(adapter.calls.length === 1, 'the verdict came from exactly one bounded probe');
});

test('375-b: a padded line — trailing whitespace or indentation — reads verified', async () => {
  for (const mode of ['trailing', 'indented']) {
    const adapter = new ProbeAdapter({ mode });
    const { liveness } = fixture(adapter);
    await liveness.ensure(ROUTE);
    const row = liveness.project(ROUTE);
    assert.equal(row.state, 'verified',
      `${mode}: the expected line is the line — its surrounding whitespace is not content`);
  }
});

// ── 375-c: the cut is a cut — a capture over the bound is marked and still judged by occurrence ──
test('375-c: a capture that hit the registry bound is marked truncated and still judged by occurrence', async () => {
  const adapter = new ProbeAdapter({ mode: 'overBound' });
  const { liveness, appended } = fixture(adapter);
  const output = adapter._turnText();
  assert.ok(Buffer.byteLength(output, 'utf8') > captureBound(),
    'the fixture turn is longer than the capture bound (the row is not vacuous)');
  await liveness.ensure(ROUTE);
  const row = liveness.project(ROUTE);
  assert.equal(row.state, 'verified', 'the expected line inside the bounded capture is an occurrence');
  assert.equal(row.truncated, true, 'the capture bound removed bytes, so the row says so');
  assert.equal(probeRecords(appended, 'readiness.probe_verified').length, 1,
    'the verified verdict rides the same evidence path');
});

// ── 375-d: the deadline settles UNKNOWN, never blocked ───────────────────────────────────────────
test('375-d: a probe that exceeds the deadline reads unknown with observed/required and never refuses admission', async () => {
  const adapter = new ProbeAdapter({ mode: 'hang' });
  const { liveness, appended } = fixture(adapter, { probeTimeoutMs: 30 });
  // The probe watchdog is unref'd (the tier must never hold the event loop open), so this row owns
  // a live handle of its own: without it node drains the loop, cancels the row, and the file's
  // later rows read as cancelled rather than failing at their own stage.
  const keepAlive = setTimeout(() => {}, 5_000);
  const row = await liveness.ensure(ROUTE).then(
    (resolved) => resolved,
    (error) => ({ refused: error }),
  ).finally(() => clearTimeout(keepAlive));
  assert.equal(row?.refused ?? null, null,
    'a timed-out probe never refuses admission — a timer adjudicates no claim');
  const projected = liveness.project(ROUTE);
  assert.equal(projected.state, 'unknown', 'the deadline settles the route unknown, not blocked');
  assert.equal(projected.code, 'probe_timed_out', 'the outcome names what was observed');
  assert.ok(Number.isFinite(projected.observed) && projected.observed >= 25,
    `observed carries the elapsed milliseconds (${projected.observed})`);
  assert.equal(projected.required, 30, 'required carries the deadline that was exceeded');
  assert.equal(probeRecords(appended, 'readiness.probe_failed').length, 1,
    'the unknown verdict is recorded on the same evidence path as every other probe verdict');
  const receipt = probeRecords(appended, 'readiness.probe_failed').at(-1);
  assert.equal(receipt.payload?.code, 'probe_timed_out', 'the receipt names the outcome');
  assert.equal(receipt.payload?.required, 30, 'the receipt carries the deadline and the elapsed ms');
  assert.equal(adapter.calls.length, 1, 'a timed-out probe is exactly one provider call');
});

// ── 375-e: the mismatch row names expected, a bounded redacted head, and the cut ─────────────────
test('375-e: a probe_content_mismatch row carries expected, the bounded redacted captured head, and truncated', async () => {
  const adapter = new ProbeAdapter({ mode: 'wrong' });
  const { liveness, appended } = fixture(adapter);
  const error = await liveness.ensure(ROUTE).then(() => null, (caught) => caught);
  assert.equal(error?.code ?? null, 'probe_content_mismatch', 'the mismatch still refuses the spawn');
  const row = liveness.project(ROUTE);
  assert.equal(row.state, 'failed');
  assert.equal(row.expected, EXPECTED, 'the row names the line it was looking for');
  assert.equal(typeof row.capturedHead, 'string', 'the row names what was captured');
  assert.ok(row.capturedHead.includes('this is not the content-verified line'),
    'the head is the captured turn\'s own first bytes');
  assert.ok(Buffer.byteLength(row.capturedHead, 'utf8') <= HEAD_BOUND,
    'the head is bounded (a row never publishes a whole turn)');
  assert.equal(row.truncated, false, 'this capture sat inside the bound, and the row says so');
  assert.equal(row.captureBytes <= captureBound(), true, 'the judged capture names its own byte size');
  const receipt = probeRecords(appended, 'readiness.probe_failed').at(-1);
  assert.equal(receipt.payload?.expected, EXPECTED, 'the receipt carries the same detail as the row');
  assert.equal(receipt.payload?.capturedHead, row.capturedHead);
});

test('375-e2: a token-shaped value in the captured turn never crosses on the mismatch row', async () => {
  const adapter = new ProbeAdapter({ mode: 'secret' });
  const { liveness } = fixture(adapter);
  await liveness.ensure(ROUTE).catch(() => {});
  const row = liveness.project(ROUTE);
  assert.equal(row.code, 'probe_content_mismatch');
  assert.equal(/(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/u.test(row.capturedHead ?? ''), false,
    'the #299 redaction runs before the head is published');
  assert.ok(String(row.capturedHead ?? '').includes('[credential-shaped content redacted]'),
    'the redaction is visible, never a silent gap');
});

// ── 375-f: the bounds are registry rows, and no module re-declares them ─────────────────────────
test('375-f1: the probe capture bound and deadline are declared in the ONE registry and read from it', () => {
  const capture = FRAME_LIMITS['route.probe_capture'];
  assert.equal(capture?.value, 2048, 'the capture row declares the §4.1.2 ≤2KiB bound');
  assert.equal(capture?.unit, 'bytes');
  assert.equal(capture?.class, 'substrate', 'a resource guard, never policy');
  const deadline = FRAME_LIMITS['route.probe_deadline_ms'];
  assert.equal(deadline?.value, 120_000, 'the deadline row declares the §4.1.2 ≤120s bound');
  assert.equal(deadline?.unit, 'ms');
  assert.equal(deadline?.class, 'substrate');

  // Resolved from THIS file, never the runner's cwd (run-suite runs from impl/, a seat may not).
  const source = readFileSync(fileURLToPath(new URL('../src/route-liveness.mjs', import.meta.url)), 'utf8');
  assert.match(source, /FRAME_LIMITS\['route\.probe_capture'\]\.value/u,
    'route-liveness reads the capture bound from the registry');
  assert.match(source, /FRAME_LIMITS\['route\.probe_deadline_ms'\]\.value/u,
    'route-liveness reads the deadline from the registry');
  assert.equal(/=\s*(?:2048|2_048)\b/u.test(source), false,
    'no module re-declares the cataloged capture literal (Decision 8)');
});

test('375-f2: the default probe deadline IS the registry row', () => {
  const adapter = new ProbeAdapter({ mode: 'exact' });
  const liveness = new RouteLiveness({ adapters: { muse: adapter }, now: Date.now });
  assert.equal(liveness.probeTimeoutMs, deadlineRow(),
    'an unwired deployment probes against the declared row, never a second literal');
});

// ── 375-h: a pin beyond the bound still never verifies (the A-Lcap law, kept) ────────────────────
test('375-h: a pin that sits beyond the bounded capture never verifies, and the row marks the cut', async () => {
  const adapter = new ProbeAdapter({ mode: 'beyondBound' });
  const { liveness } = fixture(adapter);
  await liveness.ensure(ROUTE).catch(() => {});
  const row = liveness.project(ROUTE);
  assert.equal(row.state, 'failed',
    'occurrence is judged over the bounded capture — a turn whose pin the cut removed is not evidence');
  assert.equal(row.code, 'probe_content_mismatch');
  assert.equal(row.truncated, true, 'the cut is marked on the refusal row too');
});
