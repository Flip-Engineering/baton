// [attempt: 61ae1180-6c7a-48e9-b097-7fc212ec5f3e row-stall-break]
// #163 law (row-stall-break): the wave-level stall window derives from the wave's OWN observed
// marker-advance cadence — max(2 * maxObservedGapMs, 8 * pollIntervalMs), the same derivation the
// quiescence quiet window uses (workflow-interpreter.mjs QUIESCENCE_MIN_SILENT_POLLS = 8, A2: the
// roster's cadence, never a bare wall clock). The fixed 20-minute production DEFAULT
// (DEFAULT_POLICY.stallTimeoutMs = 20 * 60_000) is replaced by the derivation; an explicitly
// PINNED stallTimeoutMs stays honored verbatim (back-compat — the sibling suites rely on pins).
//
// Authority: the row brief (docs/reference/evidence/no-clock-followons-2026-08-15/wave-g/
// row-stall-break-brief.md), the #163 law (operator ruling 2026-08-14 — clock-based kill caps are
// retired), and the landed quiescence precedent (quiet window max(2x maxObservedGapMs, 8x
// pollIntervalMs)).
//
// Stage: stage[stall-window-derived] — RED at pre-change head. At pre-change head the UNPINNED
// default stall window is the FIXED 20 minutes (1.2M real ms), which never fires inside a bounded
// test window: every RED row's run is terminated by the suite's own AbortSignal, so `basis` reads
// 'aborted' (or the run throws at validation) and the basis/claim assertions fail. GREEN after the
// derivation lands (the derived window fires the stall inside the bound).
//
// The "25 min scaled into test time via poll overrides" fixture: the marker-advance cadence is
// expressed in POLL COUNTS (the cursor-stripped status view advances every `advanceEvery` polls)
// and scaled into test time by the short poll override (pollIntervalMs 15). With `advanceEvery`
// 7 the observed marker gaps are ≈ 105 ms — call that "25 min" (scale ≈ 4.2 ms/min, arbitrary).
// The OLD fixed default's equivalent is "20 min" ≈ 84 ms ≈ 5.6 polls: the slow-cadence wave
// (7 polls) is SLOWER than the old default assumed, so it must NOT break at the
// old-default-equivalent point. The derived window = max(2 * 105, 8 * 15) = 210 ms = "50 min" —
// the wave survives past the old-default-equivalent and stalls only on its own frozen marker at
// ≈ 2x its cadence.
//
// The floor's cold-start law (the quiescence derivation's own shape): the window is 8 * poll
// interval until the wave's first full marker gap is observed, so the observed cadence must
// complete one gap inside that initial window (G < 8P) and still bind (2G > 8P ⇔ G > 4P) — the
// slow scenario sits at G = 7 polls, the fast control at G = 2 polls (floor-bound, 8P wins).
//
// Fixture idiom: the claim-preflight / issue10 fake-wave facade (no coordinator, no fs, no
// providers) — the status view per poll is fully scripted, so the observed cadence is exact.
// Clocks: real short relative timeouts only (the turn-checkpoints-31b5 idiom); no fake now(), no
// hardcoded dates (fixture-clock-lint clean). One bounded run per row: the suite's AbortSignal
// terminates the pre-change hang; the post-change stall always wins the race inside the bound.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createWaveDriver } from '../src/index.mjs';

// Static source pins. wave-driver.mjs is NUL-free; read whole for the byte-string anchors.
const WAVE_DRIVER_SRC = readFileSync(new URL('../src/wave-driver.mjs', import.meta.url), 'utf8');

const POLL_MS = 15; // the wave's poll cadence in every row (short REAL relative timeout).

// ---------------------------------------------------------------------------
// Fake-wave facade (claim-preflight / issue10 idiom): scripted status views per
// poll, no live machinery. `cursor` stays null so waitForWake takes the plain
// real-sleep path — the follow/followOnce wake laws are the sibling suites'
// domain; the row under test is the stall-window derivation.
// ---------------------------------------------------------------------------

function fakeView(overrides = {}) {
  return {
    schemaVersion: 1, phase: 'paused', terminal: false, cursor: null,
    attention: [], ...overrides,
  };
}

const cpAtt = (requestId, overrides = {}) => ({
  kind: 'turn_checkpoint', workerId: 'wk', taskId: 't', turnEpoch: 1,
  changedPathsDigest: 'd0', requestId, ...overrides,
});

const CLAIM_READY = { claim: { status: 'completed', summary: null } };

class FakeRun {
  constructor(id, program) {
    this.id = id;
    this._program = program;
    this._poll = -1;
    this.actCalls = [];
  }

  async status() {
    this._poll += 1;
    return this._program.status(this._poll, this);
  }

  async act(action, inputs = {}) {
    this.actCalls.push({ action, inputs });
    if (typeof this._program.act === 'function') return this._program.act(action, inputs, this);
    return { ok: true };
  }

  async followOnce() {
    return { follow: { afterCursor: 0, throughCursor: 0, changes: [], hasMore: false, terminal: false, timedOut: true } };
  }

  async answer() {
    return { lastAction: { result: 'applied' } };
  }
}

function fakeBaton(runs) {
  const wave = {
    runs,
    settle: async () => [...runs.keys()].map((role) => ({ role, outcome: 'settled' })),
    close: async () => ({ remainingCount: 0, residueUnknown: false }),
    evidence: () => ({ schemaVersion: 1, waveId: 'fake-wave', stops: [], outcomes: [], pumpDrained: true }),
  };
  return { waves: { start: async () => wave }, doctor: async () => ({ routes: [] }) };
}

function fakeWave(programsByRole) {
  const runs = new Map(Object.entries(programsByRole).map(([role, program]) => [role, new FakeRun(`run-${role}`, program)]));
  const members = [...runs.keys()].map((role) => ({
    role, objective: `do the work (marker:${role})`,
    harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'], report: `reports/${role}.md`,
  }));
  return { baton: fakeBaton(runs), runs, members };
}

// The unpinned base policy: every timing parameter is a short RELATIVE timeout; NO stallTimeoutMs
// so the DEFAULT_POLICY path (the derived window) is the unit under test.
function basePolicy(extra = {}) {
  return {
    preflight: false,
    steering: 'nudge-on-checkpoint',
    pollIntervalMs: POLL_MS,
    settleTimeoutMs: 300,
    finalization: 'none',
    unproductiveNudgeBudget: 0,
    saltObjectives: false,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The cadence program (the "25 min scaled" fixture): the cursor-stripped status
// view advances every `advanceEvery` polls (a fresh checkpoint requestId +
// changedPathsDigest), then freezes at digest `d<advances>`. With pollIntervalMs
// 15 the observed marker gaps are advanceEvery * 15 ms.
// ---------------------------------------------------------------------------

function cadenceProgram({ advanceEvery, advances = 3 }) {
  return {
    status: (poll) => {
      const step = Math.min(Math.floor(poll / advanceEvery), advances);
      return fakeView({
        attention: [cpAtt(`req-${step}`, { changedPathsDigest: `d${step}`, ...CLAIM_READY })],
      });
    },
    act: () => ({ ok: true }),
  };
}

// One bounded derived-window run. The stall delay is measured from the onProgress
// line stream: the freeze point is the last poll whose marker line CHANGED (the
// last observed advance); the run's final poll is the stall (or abort) poll. The
// silence between them is what tripped the check — the effective window. Both
// synchronous (policy validation) and asynchronous (run loop) failures land on
// `runError`, so a RED row at pre-change head fails the assertion cleanly instead
// of throwing out of the harness.
async function runCadence({ advanceEvery, advances = 3, policy = {}, boundMs = 4_000 }) {
  const wave = fakeWave({ w: cadenceProgram({ advanceEvery, advances }) });
  const progress = [];
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), boundMs);
  const startedAt = Date.now();
  let receipt = null;
  let runError = null;
  let running = null;
  try {
    running = createWaveDriver(wave.baton, basePolicy({
      onProgress: (line) => progress.push({ at: Date.now(), line }),
      signal: controller.signal,
      ...policy,
    })).run({ members: wave.members });
  } catch (error) {
    runError = error;
  }
  if (running !== null) {
    try {
      receipt = await running;
    } catch (error) {
      runError = error;
    }
  }
  clearTimeout(abortTimer);
  const elapsedMs = Date.now() - startedAt;
  let freezeAt = startedAt;
  for (let i = 1; i < progress.length; i += 1) {
    if (progress[i].line !== progress[i - 1].line) freezeAt = progress[i].at;
  }
  const stallDelayMs = progress.length > 0 ? progress.at(-1).at - freezeAt : 0;
  return { receipt, runError, elapsedMs, stallDelayMs, progress };
}

// ---------------------------------------------------------------------------
// S1 — the contract's core. A wave whose marker advances on a cadence SLOWER than
// the old fixed default's equivalent (7-poll gaps = "25 min" vs the old default's
// 5.6-poll "20 min") must NOT break at the old fixed default: the derived window is
// 2x the observed cadence (210 ms = "50 min"), so the wave survives the
// old-default-equivalent point and stalls only on its own frozen marker.
// RED at pre-change head: the fixed 20-minute default never fires inside the bound
// → the run aborts → basis 'aborted' ≠ 'stall'.
// ---------------------------------------------------------------------------

test('S1: a slow-cadence wave is not broken at the old fixed default — the stall window derives from the observed cadence', async () => {
  const slow = await runCadence({ advanceEvery: 7 });
  assert.equal(slow.runError, null, String(slow.runError ?? ''));
  assert.equal(slow.receipt.basis, 'stall',
    'stage[stall-window-derived]: the frozen marker still ends the wave on the stall basis (the derived window fires inside the bound)');
  assert.ok(slow.stallDelayMs >= 150,
    `stage[stall-window-derived]: the slow-cadence wave (7-poll "25 min" gaps) is NOT broken at the old-default-equivalent point ("20 min" ≈ 84 ms) — it stalls only at ~2x its own cadence (got ${slow.stallDelayMs} ms)`);

  const fast = await runCadence({ advanceEvery: 2 });
  assert.equal(fast.runError, null, String(fast.runError ?? ''));
  assert.equal(fast.receipt.basis, 'stall',
    'stage[stall-window-derived]: a fast-cadence frozen wave also stalls (the floor 8 * pollIntervalMs fires)');
  assert.ok(fast.stallDelayMs >= 70 && fast.stallDelayMs <= 250,
    `stage[stall-window-derived]: the fast-cadence window is floor-bound (~8 polls), never the slow cadence's window (got ${fast.stallDelayMs} ms)`);

  assert.ok(slow.stallDelayMs - fast.stallDelayMs >= 60,
    `stage[stall-window-derived]: the window SCALES with the observed cadence — a bare constant cannot satisfy both scenarios (slow ${slow.stallDelayMs} ms vs fast ${fast.stallDelayMs} ms)`);
});

// ---------------------------------------------------------------------------
// S2 — back-compat preservation guardrail (green at BOTH heads): an explicit
// pinned stallTimeoutMs still wins over the derivation — the same 7-poll cadence
// wave stalls at the pinned 150 ms, not the derived 210 ms. Kills an impl that
// silently ignores the pin.
// ---------------------------------------------------------------------------

test('S2: an explicit pinned stallTimeoutMs still wins over the derived window (back-compat)', async () => {
  const pinned = await runCadence({ advanceEvery: 7, policy: { stallTimeoutMs: 150 } });
  assert.equal(pinned.runError, null, String(pinned.runError ?? ''));
  assert.equal(pinned.receipt.basis, 'stall');
  assert.ok(pinned.stallDelayMs >= 110 && pinned.stallDelayMs <= 200,
    `stage[stall-window-derived]: the pinned 150 ms window fires at ~150 ms, not the derived 210 ms (got ${pinned.stallDelayMs} ms)`);
});

// ---------------------------------------------------------------------------
// S3 — terminal semantics byte-stable at the DERIVED window: with finalization
// 'claim-on-stall' the stall fan-out still claims every paused member exactly once
// and the wave completes — the D9 semantics, fired by the derived floor window.
// RED at pre-change head: never stalls inside the bound → aborted ≠ completed.
// ---------------------------------------------------------------------------

test('S3: the claim-on-stall fan-out fires at the derived window with the same terminal semantics', async () => {
  const wave = fakeWave({
    w: {
      status: () => fakeView({ attention: [cpAtt('req-0', { changedPathsDigest: 'd0', ...CLAIM_READY })] }),
      act: () => ({ ok: true }),
    },
  });
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 4_000);
  let receipt = null;
  let runError = null;
  try {
    receipt = await createWaveDriver(wave.baton, basePolicy({
      steering: 'none', finalization: 'claim-on-stall', unproductiveNudgeBudget: 1,
      signal: controller.signal,
    })).run({ members: wave.members });
  } catch (error) {
    runError = error;
  }
  clearTimeout(abortTimer);
  assert.equal(runError, null, String(runError ?? ''));
  assert.equal(receipt.basis, 'completed',
    'stage[stall-window-derived]: the derived-window stall fan-out claims the paused member and recovers — D9 semantics unchanged');
  assert.equal(receipt.claims.length, 1, 'stage[stall-window-derived]: exactly one claim at the derived stall');
  assert.equal(receipt.claims[0].code, 'claimed', 'stage[stall-window-derived]: the claim is the same receipted code');
});

// ---------------------------------------------------------------------------
// S4 — PIN (green at BOTH heads): stall-timeout validation stays closed — a
// pinned value must be a positive safe integer. Kills an impl that de-validates
// the back-compat pin.
// ---------------------------------------------------------------------------

test('S4: stall-timeout validation stays closed — a pinned value must be a positive integer', () => {
  const baton = fakeWave({ w: cadenceProgram({ advanceEvery: 7 }) }).baton;
  for (const bad of [0, -1, 1.5, '800', {}]) {
    assert.throws(
      () => createWaveDriver(baton, basePolicy({ stallTimeoutMs: bad })),
      (error) => error?.code === 'wave_driver_policy_invalid' && /stallTimeoutMs/u.test(error?.message ?? ''),
      `stallTimeoutMs ${JSON.stringify(bad)} must refuse (kills an impl that de-validates the pin)`,
    );
  }
});

// ---------------------------------------------------------------------------
// S5 — an EXPLICIT stallTimeoutMs null opts into the derived window (the sentinel
// the DEFAULT carries; the value domain of the closed field extends by "no fixed
// window"). RED at pre-change head: the old closed-set validation refused null →
// the run throws at policy freeze.
// ---------------------------------------------------------------------------

test('S5: an explicit stallTimeoutMs null opts into the derived window — the sentinel is accepted, never the fixed default', async () => {
  const wave = fakeWave({
    w: {
      status: () => fakeView({ attention: [cpAtt('req-0', { changedPathsDigest: 'd0', ...CLAIM_READY })] }),
      act: () => ({ ok: true }),
    },
  });
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 4_000);
  let receipt = null;
  let runError = null;
  try {
    receipt = await createWaveDriver(wave.baton, basePolicy({
      steering: 'none', stallTimeoutMs: null, signal: controller.signal,
    })).run({ members: wave.members });
  } catch (error) {
    runError = error;
  }
  clearTimeout(abortTimer);
  assert.equal(runError, null,
    'stage[stall-window-derived]: an explicit stallTimeoutMs null must be accepted as the derived sentinel (pre-change the closed-set validation refused it)');
  assert.equal(receipt.basis, 'stall', 'stage[stall-window-derived]: the derived window fires for the explicit null sentinel');
});

// ---------------------------------------------------------------------------
// Static pins — the derivation vocabulary replaces the fixed production DEFAULT
// (RED at pre-change head: maxObservedGapMs / the named floor are absent and the
// fixed literal is present).
// ---------------------------------------------------------------------------

test('static: the fixed production stall default is replaced by the cadence derivation', () => {
  assert.ok(!WAVE_DRIVER_SRC.includes('stallTimeoutMs: 20 * 60_000'),
    'stage[stall-window-derived]: the fixed 20-minute production DEFAULT stall window is gone');
  assert.ok(WAVE_DRIVER_SRC.includes('maxObservedGapMs'),
    'stage[stall-window-derived]: the wave\'s own observed marker-advance cadence term exists (the L5 marker gaps)');
  assert.ok(WAVE_DRIVER_SRC.includes('STALL_WINDOW_MIN_SILENT_POLLS * policy.pollIntervalMs'),
    'stage[stall-window-derived]: the derived window is max(2 * maxObservedGapMs, 8 * pollIntervalMs) — the quiescence derivation shape');
  assert.ok(WAVE_DRIVER_SRC.includes('policy.stallTimeoutMs'),
    'stage[stall-window-derived]: an explicit pinned stallTimeoutMs still wins over the derivation (back-compat)');
});
