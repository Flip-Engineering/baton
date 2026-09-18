// Issue #396: wave settle and stall are adjudicated PER MEMBER RELATIONSHIP — never on
// one shared roster clock. A member's stall clock starts at its OWN last observed progress
// (its checkpoint/tool activity rows); an independent member is never read as stalled
// because a sibling is slow; a member behind a real dependency reads waiting-on with the
// dependency named, not stalled.
//
// Harness idiom mirrors issue10-waiting-vocabulary-red.test.mjs:504-572 (the fake-wave
// facade): scripted FakeRun status programs drive the REAL driver, so each row observes
// the adjudication directly with short relative timeouts on the real clock (no time-bombs).

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWave, createWaveDriver } from '../src/index.mjs';

function fakeView(overrides = {}) {
  return {
    schemaVersion: 1, phase: 'working', terminal: false, cursor: 0,
    viewDigest: 'f'.repeat(64), attention: [], decisionSettled: [], ...overrides,
  };
}

// A canonical waitingOn value (the issue10 D3 since-stamp shape).
function WAIT(kind, detail) {
  return { kind, since: { eventSeq: 4, turnEpoch: null }, detail };
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
function cancelledFollow() {
  return Object.assign(new Error('followOnce was cancelled'), { code: 'application_follow_cancelled' });
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
    return this._program.status(this._poll, this);
  }
  async act(action, inputs = {}) {
    this.actCalls.push({ action, inputs });
    if (typeof this._program.act === 'function') return this._program.act(action, inputs, this);
    return { ok: true };
  }
  async followOnce(options) {
    await delay(options.timeoutMs, options.signal);
    if (options.signal?.aborted) throw cancelledFollow();
    return { follow: { afterCursor: options.afterCursor, throughCursor: options.afterCursor, changes: [], hasMore: false, terminal: false, timedOut: true } };
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

const POLICY = Object.freeze({
  preflight: false, steering: 'none',
  pollIntervalMs: 15, stallTimeoutMs: 250, settleTimeoutMs: 1_500,
  finalization: 'none', unproductiveNudgeBudget: 1, saltObjectives: false, settlement: 'none',
});

// A member that progresses for `livePolls` polls (its cursor-stripped marker moves every
// poll) and then rests terminal; records the instant it rested.
function liveThenResting(progessLog, livePolls) {
  return {
    status: (poll) => {
      if (poll < livePolls) return fakeView({ narrative: `alpha turn ${poll}` });
      progessLog.settledAt ??= Date.now();
      return fakeView({ phase: 'result_ready', terminal: true, narrative: 'alpha done' });
    },
  };
}

test('(a) two independent members, one progressing: only the silent one reads stalled, with its own instant', async () => {
  const log = {};
  const wave = fakeWave({
    alpha: liveThenResting(log, 6),
    beta: { status: () => fakeView({ narrative: 'beta parked' }) },
  });
  const receipt = await createWaveDriver(wave.baton, { ...POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall');
  assert.ok(Array.isArray(receipt.stalls), 'the stall is attributed per member, never roster-wide');
  assert.equal(receipt.stalls.length, 1, `only the silent member reads stalled: ${JSON.stringify(receipt.stalls)}`);
  assert.equal(receipt.stalls[0].role, 'beta');
  assert.equal(typeof receipt.stalls[0].lastProgressAt, 'string', 'the row carries its own last-progress instant');
  const betaInstant = Date.parse(receipt.stalls[0].lastProgressAt);
  assert.ok(Number.isSafeInteger(betaInstant), 'the instant parses');
  assert.ok(betaInstant < log.settledAt,
    "beta's clock was never reset by alpha's progress — its last progress predates alpha resting");
  assert.equal(receipt.stalls[0].dependsOn, null, 'an independent member depends on nothing');
  assert.deepEqual(receipt.waiting, [], 'nobody waits behind a dependency here');
});

test('(b) a member behind a real dependency reads waiting-on with the dependency named, not stalled', async () => {
  const detail = { vendor: 'mock', ceiling: 1, inFlight: 1 };
  const log = {};
  const wave = fakeWave({
    alpha: liveThenResting(log, 6),
    beta: { status: () => fakeView({ narrative: 'beta queued', waitingOn: WAIT('capacity_ceiling', detail) }) },
  });
  const receipt = await createWaveDriver(wave.baton, { ...POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'a fully quiet wave still ends stall (the CC-STRIP pin)');
  assert.deepEqual(receipt.stalls, [], 'the waiting member is never read as stalled');
  assert.equal(receipt.waiting.length, 1);
  assert.equal(receipt.waiting[0].role, 'beta');
  assert.equal(receipt.waiting[0].waitingOn.kind, 'capacity_ceiling', 'the row names the dependency');
  assert.deepEqual(receipt.waiting[0].waitingOn.detail, detail, 'the row carries what it waits on');
  assert.equal(typeof receipt.waiting[0].lastProgressAt, 'string');
});

test('(d) settle keeps each member’s own wait: a waiting member settles with its dependency named while its sibling settles clean', async () => {
  const detail = { vendor: 'mock', ceiling: 1, inFlight: 1 };
  const wait = WAIT('capacity_ceiling', detail);
  const views = {
    alpha: { view: { phase: 'completed' } },
    beta: { view: { phase: 'working', waitingOn: wait } },
  };
  const facade = {
    runs: {
      start: async (objective, options) => ({
        id: `run-${options.waveRole}`,
        approve: async () => {},
        status: async () => views[options.waveRole],
        complete: async () => {},
        stop: async () => ({}),
      }),
    },
  };
  const smember = (role) => ({ role, objective: `${role} objective`, scope: [`${role}.mjs`] });
  const wave = await createWave(facade, { members: [smember('alpha'), smember('beta')] });
  const outcomes = await wave.settle({ timeoutMs: 300 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  const beta = outcomes.find((outcome) => outcome.role === 'beta');
  assert.equal(alpha.terminal, true, 'the independent sibling settles on its own terminality');
  assert.equal(Object.hasOwn(alpha, 'waitingOn'), false, 'a member with no wait carries no key (additive-only)');
  assert.equal(beta.terminal, false);
  assert.equal(beta.waitingOn?.kind, 'capacity_ceiling', 'the waiting member settles with its dependency named');
  assert.deepEqual(beta.waitingOn?.detail, detail);
  await wave.close({ reason: '396d cleanup.' });
});

test('(c) no roster-wide clock: the wave ends on the members’ own clocks, not a shared start', async () => {
  const log = {};
  // Alpha progresses well past the stall timeout while beta is silent from the start; the
  // wave must end on beta's own long-quiet clock promptly after alpha rests — never a full
  // shared stallTimeoutMs after the last roster movement.
  const wave = fakeWave({
    alpha: liveThenResting(log, 40),
    beta: { status: () => fakeView({ narrative: 'beta parked' }) },
  });
  const receipt = await createWaveDriver(wave.baton, { ...POLICY, stallTimeoutMs: 600 }).run({ members: wave.members });
  const returnedAt = Date.now();
  assert.equal(receipt.basis, 'stall');
  assert.equal(receipt.stalls.length, 1);
  assert.equal(receipt.stalls[0].role, 'beta');
  assert.ok(returnedAt - log.settledAt < 300,
    `no shared start adjudicates: exited ${returnedAt - log.settledAt}ms after the last settler, not a full stallTimeoutMs later`);
});
