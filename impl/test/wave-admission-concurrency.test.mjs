import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWave } from '../src/index.mjs';

// ADMISSION-CONCURRENCY: createWave admits independent members concurrently. The historical
// for-of loop awaited each member's runs.start AND approve before touching the next, so a slow
// provider/admission on member 1 left unrelated members unstarted — head-of-line blocking inside
// the wave facade (the coordinator's own dispatch already parallelizes workers; only this
// admission loop was serial). These pins hold the PUBLIC createWave boundary with
// deferred-promise facades, so each claim is about ordering, never wall-clock timing:
//   1. a blocked first admission does not prevent a sibling's start+approve from finishing;
//   2. a member whose start throws never aborts its siblings (typed startError on the entry);
//   3. the returned roster is the declared member order, not the completion order.
// Determinism: every await is on an explicit deferred resolved by the test or by a facade hook —
// no sleeps, no timer races.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const member = (role) => ({ role, objective: `${role} objective`, scope: [`${role}.mjs`] });

// The minimal live-run handle createWave touches during admission (start → approve).
function memberHandle(role, calls, approved) {
  return {
    id: `run-${role}`,
    approve: async () => { calls.push(`approve:${role}`); approved?.resolve(); },
    status: async () => ({ view: { phase: 'working' } }),
    complete: async () => {},
    stop: async () => ({}),
  };
}

test('WAVE-ADMISSION: a blocked first admission does not gate an unrelated sibling', async () => {
  const calls = [];
  const alphaGate = deferred();
  const betaApproved = deferred();
  const facade = {
    runs: {
      start: async (objective, options) => {
        const role = options.waveRole;
        calls.push(`start:${role}`);
        // alpha's provider/admission never settles until the test releases it.
        if (role === 'alpha') await alphaGate.promise;
        return memberHandle(role, calls, role === 'beta' ? betaApproved : null);
      },
    },
  };

  let settled = false;
  const wavePromise = createWave(facade, { members: [member('alpha'), member('beta')] });
  wavePromise.then(() => { settled = true; }, () => { settled = true; });

  // Admission starts all independent members before waiting for any one provider.
  assert.deepEqual(calls, ['start:alpha', 'start:beta'], 'both admissions must be initiated');
  // beta's start AND approve land while alpha's start is still pending.
  await betaApproved.promise;
  assert.deepEqual(calls, ['start:alpha', 'start:beta', 'approve:beta'],
    'beta must finish its whole admission while alpha is blocked');
  assert.equal(settled, false, 'createWave must not resolve while alpha is still blocked');

  alphaGate.resolve();
  const wave = await wavePromise;
  assert.deepEqual([...wave.runs.keys()], ['alpha', 'beta'],
    'the returned roster is the declared member order');
});

test('WAVE-ADMISSION: one member start failure never aborts a sibling', async () => {
  const calls = [];
  const refusal = Object.assign(new Error('no capacity for the requested route'), { code: 'route_unavailable' });
  const facade = {
    runs: {
      start: async (objective, options) => {
        const role = options.waveRole;
        calls.push(`start:${role}`);
        if (role === 'broken') throw refusal;
        return memberHandle(role, calls, null);
      },
    },
  };

  const wave = await createWave(facade, { members: [member('broken'), member('healthy')] });

  assert.deepEqual(calls, ['start:broken', 'start:healthy', 'approve:healthy'],
    'the sibling admits normally after a peer start throws');
  assert.deepEqual([...wave.runs.keys()], ['healthy'], 'only the failed member is withheld from runs');

  const snapshot = await wave.progress();
  assert.deepEqual(snapshot.members.map(({ role }) => role), ['broken', 'healthy'],
    'progress keeps the declared member order');
  const [broken, healthy] = snapshot.members;
  assert.equal(broken.phase, 'failed');
  assert.equal(broken.terminalCause, 'start');
  assert.equal(broken.terminal, true);
  assert.equal(broken.error.code, 'route_unavailable');
  assert.equal(healthy.phase, 'working', 'the sibling is live, not collateral');
});

test('WAVE-ADMISSION: roster order is stable when completion order is reversed', async () => {
  const gates = { alpha: deferred(), beta: deferred(), gamma: deferred() };
  const approved = { alpha: deferred(), beta: deferred(), gamma: deferred() };
  const completed = [];
  const facade = {
    runs: {
      start: async (objective, options) => {
        const role = options.waveRole;
        await gates[role].promise;
        completed.push(role);
        return memberHandle(role, [], approved[role]);
      },
    },
  };

  const wavePromise = createWave(facade, { members: [member('alpha'), member('beta'), member('gamma')] });
  for (const role of ['gamma', 'beta', 'alpha']) {
    gates[role].resolve();
    await approved[role].promise;
  }
  const wave = await wavePromise;

  assert.deepEqual(completed, ['gamma', 'beta', 'alpha'], 'members completed out of roster order');
  assert.deepEqual([...wave.runs.keys()], ['alpha', 'beta', 'gamma'],
    'the returned roster is the declared order, not the completion order');
  const snapshot = await wave.progress();
  assert.deepEqual(snapshot.members.map(({ role }) => role), ['alpha', 'beta', 'gamma'],
    'progress is deterministic under reversed completion');
});
