// Issue #561: the fleet's measured weights land on the leases that hold them.
//
// The measured-admission law (issue561-measured-admission.test.mjs) made a worker's budget weight
// the MEASURED mean of the measured worker leases; `observeWorkerBytes` is how a measurement lands
// on an admitted lease. This file pins the measurement loop that feeds it:
//
//   probe         `hostProcessGroupBytes` reads ONE `ps` table and answers a Map of process-group
//                 id to the group's resident-set sum (the seat's own process plus every child it
//                 spawned); a table that cannot be read answers an empty Map and never throws
//   landing       the loop lands each live worker's measured bytes on ITS lease (holder + nonce)
//                 through the authority's `observeWorkerBytes`, and a recruited seat's lease is
//                 wired into the loop the same way a guided one is
//   laggard       a worker whose group reads nothing keeps its lease unmeasured (a missed sample
//                 is a lag, never a fabricated zero and never an eviction)
//   liveness      a holder that left the live set has its token pruned by the same pass
//   honesty       a probe that answers no Map is ignored whole — no landing, no pruning
//   once          concurrent measurement collapses onto one probe pass
//   lifecycle     the loop starts with the first admitted worker lease and close() clears it
//
// Every test drives the probe through deferred releases, so the recruit's own reconciliation pass
// is observed deterministically instead of raced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { hostProcessGroupBytes } from '../src/host-capacity.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const M = 1024 ** 2;
const GROUP = 4242;
const OWNER = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const HOLDER = 'participant:baton:builder';

/** The light SwarmRuntime harness: a real store on a temp dir, a stub coordinator whose one
 * worker runs in process group GROUP, and a stub authority that records every measurement.
 * The probe is the test's; the recruit rides the real admission path, so the lease-token
 * wiring under test is the production wiring. */
function fixture(t, { probe, shedPollMs = 3_600_000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue561-bytes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workers = [];
  const observed = [];
  const store = new CoordinationStore(directory);
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
  };
  const hostCapacity = {
    shedPollMs,
    releaseWorkersExcept: async () => {},
    acquire: async () => ({ token: { nonce: 'n1' } }),
    observeWorkerBytes: async (holder, nonce, bytes) => { observed.push({ holder, nonce, bytes }); },
  };
  const runtime = new SwarmRuntime({
    store, coordinator,
    authorize: async () => {},
    prepareRun: (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', vendor: 'mock-session', processRef: { processGroupId: GROUP } });
    },
    stopRun: async () => ({}),
    hostCapacity,
    ...(probe ? { workerBytesProbe: probe } : {}),
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', idempotencyKey: `request-${++key}`, ...args }, OWNER);
  t.after(() => runtime.close());
  return { runtime, workers, observed, call };
}

/** A deferred probe: every invocation parks its answer in `releases`, in call order, so the test
 * decides exactly when each pass reads its table. */
function deferredProbe() {
  const releases = [];
  const probe = () => new Promise((resolve) => releases.push(() => resolve(new Map([[GROUP, 5 * M]]))));
  return { probe, releases };
}

/** The in-flight pass ran to completion — the landing loop's own microtasks included. */
async function passSettled(runtime) {
  for (let i = 0; i < 200 && runtime._workerMeasureRunning; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(runtime._workerMeasureRunning, false, 'the pass settles');
}

/** A swarm with one recruited, running seat — the state every loop row starts from. The
 * recruit's own reconciliation pass is IN FLIGHT when this returns; `releases[0]` lands it. */
async function recruited(t) {
  const { probe, releases } = deferredProbe();
  const f = fixture(t, { probe });
  await f.call('create', { purpose: 'Measured worker weights (#561)' });
  await f.call('recruit', { participantId: 'builder', objective: 'Hold a measured lease' });
  assert.equal(releases.length, 1, 'admission started the fleet’s measurement');
  return { ...f, releases };
}

test('#561: hostProcessGroupBytes sums each process group from one ps table', () => {
  const table = [
    '  101    700    2048',
    '  102    700     512',
    '  103    701      10',
    'ps: not a number column',
    '',
  ].join('\n');
  const groups = hostProcessGroupBytes({ ps: () => table });
  assert.equal(groups.get(700), 2560 * 1024, 'a group weighs the SUM of its members (the seat plus every child it spawned)');
  assert.equal(groups.get(701), 10 * 1024);
  assert.equal(groups.size, 2);
});

test('#561: a table that cannot be read measures nothing and never throws', () => {
  const releases = [];
  const f = fixture(t, { probe: () => new Promise((resolve) => releases.push(() => resolve(new Map([[999, 5 * M]])))) });
  await f.call('create', { purpose: 'Measured worker weights (#561)' });
});

test('#561: an admitted worker lease receives its group’s measured bytes', async (t) => {
  const f = await recruited(t);
  assert.deepEqual([...f.runtime._workerLeaseTokens.keys()], [HOLDER],
    'the RECRUIT admission recorded the seat’s lease for the loop, not only the guide path');
  f.releases[0]();
  await passSettled(f.runtime);
  assert.deepEqual(f.observed, [{ holder: HOLDER, nonce: 'n1', bytes: 5 * M }]);
});

test('#561: a worker whose group reads nothing keeps its lease unmeasured', async (t) => {
  const { probe, releases } = deferredProbe();
  const f = fixture(t, { probe: () => probe().then((rows) => new Map([...rows].filter(([id]) => id !== GROUP))) });
  await f.call('create', { purpose: 'Measured worker weights (#561)' });
  await f.call('recruit', { participantId: 'builder', objective: 'Hold a measured lease' });
  releases[0]();
  await passSettled(f.runtime);
  assert.deepEqual(f.observed, [], 'no reading means no landing — never a zero written over the lease');
  assert.ok(f.runtime._workerLeaseTokens.has(HOLDER), 'an unmeasured pass evicts nothing');
});

test('#561: a holder that left the live set has its token pruned by the same pass', async (t) => {
  const f = await recruited(t);
  f.workers.length = 0;
  f.releases[0]();
  await passSettled(f.runtime);
  assert.ok(!f.runtime._workerLeaseTokens.has(HOLDER),
    'the gone seat’s token is pruned; the lease itself is the reconciliation’s to release');
  assert.deepEqual(f.observed, [], 'a pruned holder lands nothing');
});

test('#561: a probe that answers no Map is ignored whole', async (t) => {
  const releases = [];
  const f = fixture(t, { probe: () => new Promise((resolve) => releases.push(() => resolve(42))) });
  await f.call('create', { purpose: 'Measured worker weights (#561)' });
  await f.call('recruit', { participantId: 'builder', objective: 'Hold a measured lease' });
  releases[0]();
  await passSettled(f.runtime);
  assert.deepEqual(f.observed, [], 'a non-Map answer lands nothing');
  assert.ok(f.runtime._workerLeaseTokens.has(HOLDER), 'a missed sample prunes nothing');
});

test('#561: concurrent measurements collapse onto one probe pass', async (t) => {
  const f = await recruited(t);
  const joined = f.runtime._measureWorkerBytes();
  assert.equal(f.releases.length, 1, 'a pass in flight is the pass');
  f.releases[0]();
  await passSettled(f.runtime);
  await joined;
  assert.deepEqual(f.observed, [{ holder: HOLDER, nonce: 'n1', bytes: 5 * M }]);
  const again = f.runtime._measureWorkerBytes();
  assert.equal(f.releases.length, 2, 'the guard reset when the pass ended, so the next reconciliation measures again');
  f.releases[1]();
  await again;
  assert.equal(f.observed.length, 2, 'the second pass lands its own reading');
});

test('#561: the loop starts with the first admitted lease and close() clears it', async (t) => {
  const f = await recruited(t);
  const timer = f.runtime._workerMeasureTimer;
  assert.ok(timer !== null, 'the loop runs once a worker lease exists');
  f.runtime._ensureWorkerMeasureLoop();
  assert.equal(f.runtime._workerMeasureTimer, timer, 'a second start never doubles the loop');
  f.runtime.close();
  assert.equal(f.runtime._workerMeasureTimer, null, 'a closed runtime measures nothing');
});
