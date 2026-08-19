// [attempt: 65fd1578-0c44-4f81-a2e2-2701900a3ec8 row-stall-break]
// row-stall-break (#163 follow-on): the wave-level stall window DERIVES from the wave's own
// observed marker-advance cadence — max(2x maxObservedGapMs, 8x pollIntervalMs), the same
// derivation the quiescence quiet window uses (workflow-interpreter.mjs QUIESCENCE_MIN_SILENT_POLLS).
// A policy that pins an explicit stallTimeoutMs stays authoritative (back-compat); the DERIVED
// value replaces only the fixed production DEFAULT (the retired 20-minute constant).
//
// Red-first: R1 fails at pre-change head — the derived stall window does not exist, so a wave
// that must stall on it (a wave whose markers advance on a slow cadence — the brief's 25-min
// gaps, scaled into test time by the poll override, then freeze) NEVER stalls: the fixed 20-min
// default is unreachable inside a test, and the run only ends via the observation-window abort
// (basis 'aborted', never 'stall'). GREEN after the change: the wave stalls on max(2x its own
// observed cadence, 8x pollIntervalMs) — never before 2x the cadence, and bounded. P1 pins the
// back-compat clause: an explicit pin stays authoritative and is never overridden by the
// derivation.
//
// Clock discipline (judgment call, recorded): the derivation mixes the driver's OWN wall clock
// (the poll-to-poll gaps between lastMarkerAt moves) with the policy constant `8 x pollIntervalMs`
// — the same unit only in REAL time. A compressed/decoupled clock double (the quiescence suite's
// idiom) is impossible here: the floor term would fire spuriously after one poll, preempting the
// cadence ramp. So this suite drives the driver's real clock and scales the wave's cadence into
// test time via the poll override (a 5-poll cadence at a 20 ms poll = the brief's slow-cadence
// shape scaled 1000x; the old 20-min default remains unreachable, which IS the pre-change bug:
// the stall basis cannot fire). No wall-clock control: every assertion is a ratio or bound in
// real milliseconds, measured on the same clock the driver uses, so load stretches both sides
// together.
//
// Hermetic: the deterministic fake wave facade (instrumented status, no live providers) from
// claim-preflight-red.test.mjs §F. No network, no spawns, no mkdtemp, no NUL bytes, no
// localeCompare.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWaveDriver } from '../src/wave-driver.mjs';

function fakeView(overrides = {}) {
  // cursor: null keeps the member off the follow path (plain-sleep wait cycles — hermetic).
  return {
    schemaVersion: 1, phase: 'working', terminal: false, cursor: null,
    viewDigest: 'f'.repeat(64), attention: [], decisionSettled: [], ...overrides,
  };
}

// A status program whose marker (viewDigest — a non-stripped stall-marker field) advances every
// `cadencePolls` polls — the wave's observed marker-advance cadence — and freezes after
// `freezeAfterPoll`, so the subsequent silence exercises the stall window. advanceAt records the
// wall time of each advance on the same Date.now() scale the driver measures its gaps with.
function cadenceProgram({ cadencePolls = 5, freezeAfterPoll = 21 }) {
  let digest = 'd0';
  let advance = 0;
  const advanceAt = [];
  return {
    advanceAt,
    view: (poll) => {
      if (poll >= 1 && poll <= freezeAfterPoll && poll % cadencePolls === 1) {
        advance += 1;
        digest = `d${advance}`;
        advanceAt.push(Date.now());
      }
      return fakeView({ viewDigest: digest });
    },
  };
}

class FakeRun {
  constructor(id, program) {
    this.id = id;
    this._program = program;
    this._poll = -1;
    this.actCalls = [];
  }
  async status() {
    this._poll += 1;
    return this._program.view(this._poll);
  }
  async act(action, inputs = {}) {
    this.actCalls.push({ action, inputs });
    return { ok: true };
  }
}

function fakeWave(program) {
  const runs = new Map([['w', new FakeRun('run-w', program)]]);
  const wave = {
    runs,
    settle: async () => [...runs.keys()].map((role) => ({ role, outcome: 'settled' })),
    close: async () => ({ remainingCount: 0, residueUnknown: false }),
    evidence: () => ({ schemaVersion: 1, waveId: 'fake-wave', stops: [], outcomes: [], pumpDrained: true }),
  };
  const members = [{
    role: 'w', objective: 'do the work (marker:w)',
    harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'], report: 'reports/w.md',
  }];
  return { baton: { waves: { start: async () => wave }, doctor: async () => ({ routes: [] }) }, runs, members };
}

// The shared fast lane. NO stallTimeoutMs — R1 exercises the DERIVED production default. The poll
// override (20 ms) scales the brief's slow cadence into test time: the marker advances every 5
// polls (a ~100 ms observed gap), then freezes.
const BASE_POLICY = {
  preflight: false, steering: 'nudge-on-checkpoint',
  pollIntervalMs: 20, settleTimeoutMs: 500, finalization: 'none',
  unproductiveNudgeBudget: 1, saltObjectives: false, settlement: 'none',
};

test('R1 (RED at pre-change head): a wave whose markers advance on a cadence SLOWER than 20 min is not broken at the old fixed default — the stall window derives from the observed cadence', { timeout: 20_000 }, async () => {
  const program = cadenceProgram({});
  const wave = fakeWave(program);
  const controller = new AbortController();
  let timerHandle;
  const observationWindow = new Promise((resolve) => {
    timerHandle = setTimeout(() => { controller.abort(); resolve('observation-window'); }, 6_000);
  });
  const runPromise = createWaveDriver(wave.baton, {
    ...BASE_POLICY, signal: controller.signal,
  }).run({ members: wave.members });
  const first = await Promise.race([runPromise, observationWindow]);
  clearTimeout(timerHandle);
  let receipt;
  if (first === 'observation-window') {
    receipt = await runPromise; // the abort resolves the run promptly
    assert.equal(receipt.basis, 'stall',
      `stage[derived-window-missing]: the run did not resolve with a stall basis inside the observation window — at pre-change head the fixed 20-min default cannot deliver the derived stall (aborted basis "${receipt.basis}")`);
  } else {
    receipt = first;
  }
  const { advanceAt } = program;
  // The wave's observed cadence: the first inter-advance gap, on the driver's own clock.
  const cadence = advanceAt[1] - advanceAt[0];
  const silence = Date.now() - advanceAt[advanceAt.length - 1];

  assert.equal(receipt.basis, 'stall',
    'terminal semantics byte-stable: the wave ends on the stall basis (same bases, no new event kinds)');
  assert.ok(advanceAt.length >= 5,
    `the wave's markers advanced on their full slow cadence (${advanceAt.length}/5 advances observed) — the stall did not break the wave mid-cadence`);
  assert.ok(silence >= 2 * cadence,
    `stage[derived-window-missing]: the fatal window derived from the observed cadence (silence ${silence}ms >= 2x cadence ${2 * cadence}ms) — a fixed 20-min default can never fire here`);
  assert.ok(silence < 6 * cadence,
    'the derived window still fires: the wave did stall (bounded, no hang)');
  assert.equal(receipt.claims.length, 0, 'finalization none: no claim fan-out');
  assert.equal(receipt.nudges.length, 0, 'no checkpoints: no nudges');
});

test('P1 (PIN): an explicitly pinned stallTimeoutMs stays authoritative — the derivation never overrides a pin', { timeout: 20_000 }, async () => {
  const program = cadenceProgram({});
  const wave = fakeWave(program);
  // A 140 ms pin: below the derived 2x-cadence window (~200 ms), so a derive-always impl is
  // caught; the pin REPLACES the whole derived expression (floor included) and is green at both
  // heads (back-compat).
  const receipt = await createWaveDriver(wave.baton, {
    ...BASE_POLICY, stallTimeoutMs: 140,
  }).run({ members: wave.members });
  const { advanceAt } = program;
  const cadence = advanceAt[1] - advanceAt[0];
  const silence = Date.now() - advanceAt[advanceAt.length - 1];

  assert.equal(receipt.basis, 'stall', 'the pinned wave still ends on the stall basis');
  assert.ok(silence >= 140,
    'the pinned window fired (silence >= the 140 ms pin)');
  assert.ok(silence < 2 * cadence,
    'the pin is authoritative: the wave stalled at the pinned window, before the derived 2x-cadence window would');
});
