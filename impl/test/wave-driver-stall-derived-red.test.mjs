// #163 law (row-stall-break, wave-f 2026-08-18): the wave-level stall window is DERIVED from the
// wave's own observed marker-advance cadence — max(2x maxObservedGapMs, 8x pollIntervalMs), the
// SAME derivation the quiescence quiet window uses (workflow-interpreter.mjs
// QUIESCENCE_MIN_SILENT_POLLS = 8, A2: the roster's cadence, never a bare clock). The old fixed
// production default (DEFAULT_POLICY.stallTimeoutMs = 20 min) is replaced by the derivation; an
// explicitly PINNED stallTimeoutMs stays honored verbatim (back-compat — the sibling suites rely
// on pinned values).
//
// Red-first: every RED row fails at a NAMED stage against the PRE-change head (fixed 20-min
// default) and goes green on the derived default ONLY; the PIN rows (R4/R6) stay green at both
// heads and kill a plausible WRONG implementation (pin list: R3 kills an impl that drops the
// 2x-cadence term; R4/R6 kill an impl that ignores or de-validates the back-compat pin).
//
// Harness: a lightweight scripted baton facade (waves.start → scripted run handles) — the driver
// poll/steer/settle loop is the unit under test; the coordinator/wave plumbing is exercised by the
// sibling suites (wave-driver-red, wave-driver-policy-red). Clocks: short REAL poll intervals
// (25 ms) drive the polls; the slow-cadence row scales the 20-min default boundary into test time
// by mocking ONLY Date (t.mock.timers { apis: ['Date'] }) while real timers keep the poll cadence
// — the driver's marker gaps read the mocked clock, so the observed 25-min cadence and the
// 20-min old-default boundary are EXACT, not statistical (no wall-clock assertions on the fleet).
// All other rows are pure relative-timeout rows (fixture-clock-lint clean — no date literals).

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWaveDriver } from '../src/index.mjs';

const POLL_MS = 25; // the wave's poll cadence in every row (real timers).
const OLD_FIXED_DEFAULT_MS = 20 * 60_000; // the retired fixed production default (pre-change head).

// L5: a cursor-stripped parked status view carrying a turn_checkpoint — the driver's wave-level
// marker moves when changedPathsDigest changes; the store-global cursor/waitingOn are stripped by
// stallMarker exactly as semanticViewDigest strips them. cursor stays null so waitForWake takes
// the plain real-sleep path (the follow/followOnce machinery is the sibling suites' domain — the
// row under test here is the stall-window derivation, not the follow wake laws).
function parkedView(digest, requestId = 'ck-1') {
  return {
    phase: 'paused',
    terminal: false,
    cursor: null,
    attention: [{ kind: 'turn_checkpoint', requestId, changedPathsDigest: digest }],
    waitingOn: null,
  };
}

const terminalView = () => ({ phase: 'result_ready', terminal: true, cursor: null });

function scriptedRun(initialView) {
  const handle = {
    id: `run-${Math.random().toString(36).slice(2)}`,
    view: initialView,
    actCalls: [],
    polls: 0,
    async status() {
      handle.polls += 1;
      return handle.view;
    },
    async act(action, payload) {
      handle.actCalls.push({ action, payload });
      return { ok: true };
    },
    async followOnce() {
      return { follow: { throughCursor: 1, changes: [] } };
    },
    async answer() {
      return { lastAction: { result: 'applied' } };
    },
  };
  return handle;
}

function scriptedBaton(handlesByRole) {
  return {
    waves: {
      async start(options) {
        const runs = new Map();
        for (const m of options.members) {
          const handle = handlesByRole[m.role];
          if (!handle) throw new Error(`no scripted handle for role ${m.role}`);
          runs.set(m.role, handle);
        }
        return {
          waveId: 'wave-stall-derived',
          runs,
          async settle() { return []; },
          async close() { return { remainingCount: 0, residueUnknown: false }; },
          evidence() { return { stops: [] }; },
        };
      },
    },
  };
}

const member = (role, objective) => ({
  role,
  objective,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
});

// The unpinned base policy: every timing parameter is a short RELATIVE timeout; NO stallTimeoutMs
// so the DEFAULT_POLICY path is the unit under test.
function basePolicy(extra = {}) {
  return {
    steering: 'none',
    finalization: 'none',
    pollIntervalMs: POLL_MS,
    settleTimeoutMs: 100,
    settlement: 'none',
    preflight: false,
    saltObjectives: false,
    ...extra,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the driver, then waits up to `ms` of real time for it to settle. Returns the receipt (or
// the thrown error); aborts the run if it is still in flight so a RED row never strands a 20-min
// poll loop. The abort signal rides the policy's signal seam — the driver's guaranteed close.
async function settleWithin(running, ms, signal, label) {
  let receipt = null;
  let runError = null;
  running.then((r) => { receipt = r; }).catch((e) => { runError = e; });
  await sleep(ms);
  if (receipt === null && runError === null) {
    signal.abort();
    await running.catch(() => {});
  }
  return { receipt, runError };
}

test('R1 [RED]: a slow-cadence wave (25-min marker gaps) survives the old 20-min fixed default — the derived window follows the observed cadence', async (t) => {
  // Mock ONLY Date: the driver's poll timers stay REAL (25 ms) while the wave's clock reads the
  // mocked Date — the observed 25-min marker-advance gaps and the 20-min old-default boundary are
  // exact fake-time distances, scaled into test time.
  t.mock.timers.enable({ apis: ['Date'] });
  const ac = new AbortController();
  t.after(() => { ac.abort(); t.mock.timers.reset(); });

  const handle = scriptedRun(parkedView('digest-A'));
  const running = createWaveDriver(scriptedBaton({ w: handle }), basePolicy({ signal: ac.signal }))
    .run({ members: [member('w', 'write the slow report')] });
  let outcome = null;
  let runError = null;
  running.then((receipt) => { outcome = receipt; }).catch((error) => { runError = error; });

  // Poll 1 moves the marker ('' → digest-A); the wave's clock is the mocked Date (fake T0).
  await sleep(80);
  assert.equal(outcome, null, 'the wave is alive after its first poll');

  // The member advances its marker on a 25-minute cadence — SLOWER than the old fixed default.
  t.mock.timers.tick(25 * 60_000); // fake T0 + 25 min: the first observed marker-advance gap
  handle.view = parkedView('digest-B');
  await sleep(80); // the next poll records the 25-min gap (maxObservedGapMs = 25 min)
  assert.equal(outcome, null);

  // 19 minutes of marker stability — still inside the old 20-min default.
  t.mock.timers.tick(19 * 60_000);
  await sleep(80);
  assert.equal(outcome, null);

  // 21 minutes of stability: PAST the old fixed default boundary. The derived window
  // (max(2 x 25 min, 8 x 25 ms) = 50 min) must NOT break the wave here — the old fixed default
  // would (20 min < 25-min cadence => the stall fires inside every gap).
  t.mock.timers.tick(2 * 60_000);
  await sleep(250);
  assert.equal(runError, null, String(runError ?? ''));
  assert.equal(
    outcome, null,
    '[RED at pre-change head] stage[slow-cadence-breaks-at-old-default]: a wave whose marker '
    + 'advances on a 25-min cadence must NOT break at the fixed 20-min default — the derived '
    + 'window follows the observed cadence (max(2x maxObservedGapMs, 8x pollIntervalMs))',
  );

  // The member terminates; the wave settles on completion, never on the stall clock.
  handle.view = terminalView();
  await running;
  assert.equal(runError, null, String(runError ?? ''));
  assert.equal(outcome.basis, 'completed', 'the slow-cadence wave completes on member terminality');
  assert.equal(outcome.salt, null, 'saltObjectives:false rides through (no receipt drift)');
});

test('R2 [RED]: an unpinned frozen wave stalls on the DERIVED floor (8x pollIntervalMs), never the fixed 20-min default', async (t) => {
  const ac = new AbortController();
  t.after(() => ac.abort());
  const handle = scriptedRun(parkedView('digest-static'));
  const running = createWaveDriver(scriptedBaton({ w: handle }), basePolicy({ signal: ac.signal }))
    .run({ members: [member('w', 'one frozen report')] });
  const { receipt, runError } = await settleWithin(running, 2_000, ac, 'unpinned frozen wave');
  assert.equal(runError, null, String(runError ?? ''));
  assert.ok(
    receipt !== null,
    '[RED at pre-change head] stage[frozen-wave-never-derives]: an unpinned frozen wave must stall '
    + `on the DERIVED floor (8 x ${POLL_MS} ms) — the fixed 20-min default never fires in test time`,
  );
  assert.equal(receipt.basis, 'stall', 'a frozen view yields basis stall (the only abnormal exit left)');
  assert.equal(receipt.claims.length, 0, 'finalization none: no claims at the stall');
});

test('R3 [RED]: the observed cadence EXTENDS the derived window past the 8x-poll floor — max(2x maxObservedGapMs, 8x pollIntervalMs)', async (t) => {
  const ac = new AbortController();
  t.after(() => ac.abort());
  const handle = scriptedRun(parkedView('digest-0'));
  // The member advances its marker every 25 polls: observed gaps ≈ 25 x 25 ms = 625 ms. The
  // derived window is max(2 x ~625 ms, 8 x 25 ms = 200 ms) ≈ 1250 ms — the CADENCE term dominates.
  handle.status = async function status() {
    handle.polls += 1;
    handle.view = parkedView(`digest-${Math.floor(handle.polls / 25)}`);
    return handle.view;
  };
  const running = createWaveDriver(scriptedBaton({ w: handle }), basePolicy({ signal: ac.signal }))
    .run({ members: [member('w', 'slow cadence report')] });
  // Cadence phase: let several 625-ms gaps land and be observed, then FREEZE the marker.
  await sleep(2_000);
  const frozenAt = Date.now();
  handle.status = async function status() {
    handle.polls += 1;
    return handle.view;
  };
  const { receipt, runError } = await settleWithin(running, 3_000, ac, 'cadence-extended wave');
  const elapsedMs = Date.now() - frozenAt;
  assert.equal(runError, null, String(runError ?? ''));
  assert.ok(
    receipt !== null,
    '[RED at pre-change head] stage[cadence-window-never-derives]: the wave must stall on the '
    + 'cadence-extended window — the fixed 20-min default never fires in test time',
  );
  assert.equal(receipt.basis, 'stall');
  assert.ok(
    elapsedMs >= 550,
    `the stall must wait for the cadence-extended window (2x ~625 ms ≈ 1250 ms), not the 200-ms `
    + `floor — stalled after ${elapsedMs} ms (kills an impl that drops the 2x-cadence term)`,
  );
});

test('R4 [PIN]: an explicitly PINNED stallTimeoutMs is honored verbatim — the derivation replaces only the default', async (t) => {
  const ac = new AbortController();
  t.after(() => ac.abort());
  const handle = scriptedRun(parkedView('digest-pinned'));
  // Derived would be max(2 x ~20 ms, 8 x 20 ms) = 160 ms; the pin must hold at 500 ms instead.
  const startedAt = Date.now();
  const running = createWaveDriver(
    scriptedBaton({ w: handle }),
    basePolicy({ pollIntervalMs: 20, stallTimeoutMs: 500, signal: ac.signal }),
  ).run({ members: [member('w', 'pinned report')] });
  const { receipt, runError } = await settleWithin(running, 2_500, ac, 'pinned stall timeout');
  const elapsedMs = Date.now() - startedAt;
  assert.equal(runError, null, String(runError ?? ''));
  assert.ok(receipt !== null, 'the pinned stallTimeoutMs must still settle the frozen wave');
  assert.equal(receipt.basis, 'stall');
  assert.ok(
    elapsedMs >= 350,
    `the PINNED 500-ms window must fire, not the derived 160-ms floor — stalled after ${elapsedMs} `
    + 'ms (kills an impl that ignores the back-compat pin)',
  );
});

test('R5 [RED]: the DERIVED window feeds the claim-on-stall fan-out — same terminal semantics, no new basis', async (t) => {
  const ac = new AbortController();
  t.after(() => ac.abort());
  const handle = scriptedRun(parkedView('digest-claim'));
  const running = createWaveDriver(
    scriptedBaton({ w: handle }),
    basePolicy({ finalization: 'claim-on-stall', signal: ac.signal }),
  ).run({ members: [member('w', 'claim me')] });
  const { receipt, runError } = await settleWithin(running, 2_000, ac, 'claim-on-stall derived window');
  assert.equal(runError, null, String(runError ?? ''));
  assert.ok(
    receipt !== null,
    '[RED at pre-change head] stage[claim-fan-out-never-derives]: the unpinned claim-on-stall wave '
    + 'must reach its fan-out on the DERIVED window — the fixed 20-min default never fires in test time',
  );
  assert.equal(receipt.basis, 'completed', 'the claim resolves the parked member — same claim-on-stall semantics as the pinned suites');
  assert.equal(receipt.claims.length, 1, 'exactly one claim at the stall fan-out');
  assert.equal(receipt.claims[0].code, 'claimed');
  assert.deepEqual(handle.actCalls.map((call) => call.action), ['claim_turn']);
});

test('R6 [PIN]: stall-timeout validation stays closed — a pinned value must be a positive integer', () => {
  const baton = scriptedBaton({ w: scriptedRun(parkedView('d')) });
  for (const bad of [0, -1, 1.5, '800', {}]) {
    assert.throws(
      () => createWaveDriver(baton, basePolicy({ stallTimeoutMs: bad })),
      (error) => error?.code === 'wave_driver_policy_invalid' && /stallTimeoutMs/u.test(error?.message ?? ''),
      `stallTimeoutMs ${JSON.stringify(bad)} must refuse (kills an impl that de-validates the pin)`,
    );
  }
});

test('R7 [RED]: an EXPLICIT stallTimeoutMs null opts into the derived window — the sentinel is accepted, never the fixed default', async (t) => {
  const ac = new AbortController();
  t.after(() => ac.abort());
  const handle = scriptedRun(parkedView('digest-null'));
  const running = createWaveDriver(
    scriptedBaton({ w: handle }),
    basePolicy({ stallTimeoutMs: null, signal: ac.signal }),
  ).run({ members: [member('w', 'explicit null report')] });
  const { receipt, runError } = await settleWithin(running, 2_000, ac, 'explicit null stall timeout');
  assert.equal(runError, null, String(runError ?? ''));
  assert.ok(
    receipt !== null,
    '[RED at pre-change head] stage[null-sentinel-refused]: an explicit stallTimeoutMs null must '
    + 'be accepted as the derived sentinel (pre-change the closed-set validation refused it)',
  );
  assert.equal(receipt.basis, 'stall', 'the derived window fires for the explicit null sentinel');
});
