import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWave } from '../src/index.mjs';

// OBSERVATION-CONCURRENCY: the wave handle's observation and stop-admission paths are concurrent
// over independent members. progress(), settle(), and close() historically awaited each member's
// run.status()/run.stop() SEQUENTIALLY, so one slow (or failing) participant head-of-line blocked
// every later peer's observation, pump arming, or stop — the same defect class the admission loop
// below this handle already shed. These pins hold the PUBLIC handle boundary with deferred-promise
// facades, so each claim is about ordering and per-member truth, never wall-clock timing:
//   1. progress(): a blocked status read does not gate a sibling's observation, and the snapshot
//      still resolves in DECLARED roster order;
//   2. progress(): an unreadable member carries its own typed observation error — phase unknown,
//      never terminal, never a start failure — and never blocks a healthy peer;
//   3. settle(): a blocked status read does not gate a sibling's observation or its pump arming;
//   4. settle(): a per-member observation failure is refreshed on the next call (never replayed
//      stale), and the observation budget never stops a member;
//   5. close(): every member stop is initiated without waiting for an unrelated slow stop; the
//      receipt stays roster-ordered with per-member residue/error truth.
// Determinism: every await is on an explicit deferred resolved by the test or a facade hook — no
// sleeps and no timer races. The one budgeted wait (a settle whose member is deliberately
// unreadable) asserts per-member error truth, never elapsed time.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const member = (role) => ({ role, objective: `${role} objective`, scope: [`${role}.mjs`] });

// The minimal live-run handle the wave handle touches. Each hook appends to `calls` so the tests
// can read initiation ORDER, which is the whole point of the concurrency claims.
function memberHandle(role, calls, hooks = {}) {
  return {
    id: `run-${role}`,
    approve: async () => {},
    status: async () => {
      calls.push(`status:${role}`);
      return hooks.status ? hooks.status() : { view: { phase: 'working' } };
    },
    complete: async () => { calls.push(`pump:${role}`); hooks.pumped?.resolve(); },
    stop: async (reason) => {
      calls.push(`stop:${role}:${reason}`);
      return hooks.stop ? hooks.stop() : {};
    },
  };
}

function facadeFor(calls, hooksByRole = {}) {
  return {
    runs: {
      start: async (objective, options) => memberHandle(options.waveRole, calls, hooksByRole[options.waveRole] ?? {}),
    },
  };
}

test('WAVE-OBSERVATION: a blocked status read does not gate a sibling progress observation', async () => {
  const calls = [];
  const alphaGate = deferred();
  const betaObserved = deferred();
  const facade = facadeFor(calls, {
    alpha: { status: async () => { await alphaGate.promise; return { view: { phase: 'completed' } }; } },
    beta: { status: async () => { betaObserved.resolve(); return { view: { phase: 'working' } }; } },
  });

  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });
  let resolved = false;
  const snapshotPromise = wave.progress().then((snapshot) => { resolved = true; return snapshot; });

  // beta's whole observation lands while alpha's status read is still outstanding.
  await betaObserved.promise;
  assert.deepEqual(calls, ['status:alpha', 'status:beta'],
    'both status reads are initiated before either completes — never one-at-a-time');
  assert.equal(resolved, false, 'progress does not resolve while one member read is outstanding');

  alphaGate.resolve();
  const snapshot = await snapshotPromise;
  assert.deepEqual(snapshot.members.map(({ role }) => role), ['alpha', 'beta'],
    'the snapshot is roster-ordered, not completion-ordered');
  assert.equal(snapshot.members[0].phase, 'completed');
  assert.equal(snapshot.members[1].phase, 'working');
});

test('WAVE-OBSERVATION: an unreadable member carries its own failure and never blocks a healthy peer', async () => {
  const calls = [];
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => {
        throw Object.assign(new Error('status transport died'), { code: 'transport_closed' });
      },
    },
  });

  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });
  const snapshot = await wave.progress();

  assert.deepEqual(snapshot.members.map(({ role }) => role), ['alpha', 'beta'],
    'roster order survives an unreadable member');
  const [alpha, beta] = snapshot.members;
  assert.deepEqual(alpha.error, { code: 'transport_closed', message: 'status transport died' });
  assert.equal(alpha.phase, null, 'an unreadable member is given no phase it did not report');
  assert.equal(alpha.terminal, false, 'an observation failure never invents terminality');
  assert.equal(Object.hasOwn(alpha, 'terminalCause'), false,
    'an observation failure is never reported as a start failure');
  assert.equal(beta.phase, 'working', 'the healthy peer is observed, not collateral');
  assert.equal(beta.terminal, false);
  assert.equal(Object.hasOwn(beta, 'error'), false, 'a healthy row carries no observation error');
});

test('WAVE-OBSERVATION: a blocked status read does not gate a sibling settle observation or its pump', async () => {
  const calls = [];
  const alphaGate = deferred();
  const betaPumped = deferred();
  const phases = { alpha: 'working', beta: 'working' };
  const facade = facadeFor(calls, {
    alpha: { status: async () => { await alphaGate.promise; return { view: { phase: phases.alpha } }; } },
    beta: {
      status: async () => ({ view: { phase: phases.beta } }),
      pumped: betaPumped,
    },
  });

  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });
  let resolved = false;
  const settlePromise = wave.settle({ timeoutMs: 5_000 });
  settlePromise.then(() => { resolved = true; }, () => { resolved = true; });

  // beta is observed AND pumped while alpha's status read is still outstanding.
  await betaPumped.promise;
  assert.deepEqual(calls, ['status:alpha', 'status:beta', 'pump:beta'],
    'beta is observed and its pump armed while alpha is blocked');
  assert.equal(resolved, false, 'settle does not resolve while a member read is outstanding');

  // Flip both members terminal; the loop then exits on member terminality, never on a timer.
  phases.alpha = 'completed';
  phases.beta = 'completed';
  alphaGate.resolve();
  const outcomes = await settlePromise;

  assert.deepEqual(outcomes.map((outcome) => outcome.role), ['alpha', 'beta'],
    'the outcome roster is the declared order, not the observation order');
  assert.equal(outcomes[0].phase, 'completed');
  assert.equal(outcomes[0].terminal, true);
  assert.equal(outcomes[1].phase, 'completed');
  assert.equal(outcomes[1].terminal, true);
  assert.equal(calls.filter((call) => call === 'pump:beta').length, 1, 'a member is pumped once, never per round');
  assert.equal(wave.pumpQuiescent, true, 'no pump outlives the settle call');
});

test('WAVE-SETTLE: an observation failure is refreshed, never replayed stale, and never stops a member', async () => {
  const calls = [];
  let unreadable = true;
  const facade = facadeFor(calls, {
    alpha: {
      status: async () => {
        if (unreadable) throw Object.assign(new Error('status transport died'), { code: 'transport_closed' });
        return { view: { phase: 'completed', narrative: 'reported' } };
      },
    },
    beta: { status: async () => ({ view: { phase: 'completed' } }) },
  });

  const wave = await createWave(facade, { members: [member('alpha'), member('beta')] });
  const first = await wave.settle({ timeoutMs: 80 });

  assert.deepEqual(first.map((outcome) => outcome.role), ['alpha', 'beta'],
    'the failed member never withholds its peer');
  assert.equal(first[0].phase, 'outcome_error');
  assert.equal(first[0].terminal, false, 'a failed observation is never terminality');
  assert.deepEqual(first[0].error, { code: 'transport_closed', message: 'status transport died' });
  assert.equal(first[1].phase, 'completed', 'the healthy peer settles on its observed phase');
  assert.equal(first[1].terminal, true);
  assert.equal(calls.some((call) => call.startsWith('stop:')), false,
    'the settle observation budget is never authority to stop a member');

  unreadable = false;
  const second = await wave.settle({ timeoutMs: 5_000 });
  assert.notEqual(second[0], first[0], 'a repeated settle returns a fresh outcome object');
  assert.equal(second[0].phase, 'completed', 'the refreshed observation replaces the earlier failure');
  assert.equal(second[0].terminal, true);
  assert.equal(second[0].narrative, 'reported');
  assert.equal(second[0].error, undefined, 'the refreshed outcome carries no stale error');
  assert.equal(wave.evidence().outcomes[0].phase, 'completed', 'the handle ledger holds the refreshed outcome');
});

test('WAVE-CLOSE: every stop is initiated without waiting for an unrelated slow stop', async () => {
  const calls = [];
  const alphaGate = deferred();
  const betaStopping = deferred();
  const stopped = () => ({
    stop: 'stopped',
    outline: { resources: { state: 'closed', cleanupState: 'clean', ownedCount: 2 } },
  });
  const facade = facadeFor(calls, {
    alpha: { stop: async () => { await alphaGate.promise; return stopped(); } },
    beta: { stop: async () => { betaStopping.resolve(); return stopped(); } },
    gamma: {
      stop: async () => {
        throw Object.assign(new Error('stop transport died'), { code: 'transport_closed' });
      },
    },
  });

  const wave = await createWave(facade, { members: [member('alpha'), member('beta'), member('gamma')] });
  let resolved = false;
  const closePromise = wave.close({ reason: 'observation concurrency' });
  closePromise.then(() => { resolved = true; }, () => { resolved = true; });

  await betaStopping.promise;
  assert.deepEqual(calls, [
    'stop:alpha:observation concurrency',
    'stop:beta:observation concurrency',
    'stop:gamma:observation concurrency',
  ], 'every member stop begins while alpha\'s stop is still blocked');
  assert.equal(resolved, false, 'close does not resolve while a member stop is outstanding');

  alphaGate.resolve();
  const receipt = await closePromise;

  assert.equal(receipt.reason, 'observation concurrency');
  assert.deepEqual(receipt.stops.map((entry) => entry.role), ['alpha', 'beta', 'gamma'],
    'the stop receipt is roster-ordered, not admission-ordered');
  assert.equal(receipt.stops[0].ownedCount, 2);
  assert.equal(receipt.stops[1].ownedCount, 2);
  assert.deepEqual(receipt.stops[2], {
    role: 'gamma',
    ownedCount: null,
    error: { code: 'transport_closed', message: 'stop transport died' },
  }, 'a refused stop is reported as that member\'s typed error, never as a clean stop');
  assert.equal(receipt.remainingCount, 5, 'two owned residues plus one unknown stop');
  assert.equal(receipt.residueUnknown, true, 'an unreadable stop is unknown residue, never coalesced to zero');
});
