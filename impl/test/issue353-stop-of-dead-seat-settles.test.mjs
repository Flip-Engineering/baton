// Issue #353 — swarm.stop of a seat whose runtime is already gone does not converge
// within the CLI request bound (cli_command_pending twice), and the pending receipt
// names `baton doctor --check` instead of the seat row.
//
// The repair, pinned here:
// (a) a stop of a seat whose worker exited skips the run drain entirely and settles
//     membership at once (participant_left, reason stopped) — the receipt's event is
//     that row;
// (b) a stop of an unbound seat (joined, never bound) settles the same way instead of
//     refusing swarm_participant_unbound;
// (c) a stop of a live seat still drains (existing behaviour, pinned);
// (d) when a stop DOES wait, the cli_command_pending observation names the seat's own
//     row (`baton swarm view <swarm> --participant-id <seat>`), never doctor --check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { BatonWebClient, commandObservation } from '../src/application-cli.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

// The deployment's drain wait: stopping a live run takes DRAIN_MS, longer than the
// caller's request bound. A stop that skips the drain settles inside the bound; one
// that drains outlives it.
const DRAIN_MS = 1500;
const REQUEST_BOUND_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue353-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const drainCalls = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: 'a'.repeat(40), ref: `refs/baton/checkpoints/${'a'.repeat(40)}` }),
    checkContribution: async () => ({ passed: true, sha: 'a'.repeat(40), attempt: { cleanup: { state: 'closed' } } }),
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => {
      drainCalls.push(runId);
      await sleep(DRAIN_MS);
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'settle' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `settle-${++key}` }),
      ...args }, caller);
  const recruit = (participantId, options = {}) => call('recruit', {
    participantId, objective: `Work as ${participantId}`,
    ...(Object.keys(options).length ? { options } : {}),
  });
  // A stop raced against the caller's request bound: settled wins, a drain loses.
  const stopBounded = async (participantId, reason) => {
    const pending = call('stop', { participantId, reason });
    // Attach a late rejection guard so a losing stop cannot fail the run after the bound fires.
    pending.then(null, () => {});
    const outcome = await Promise.race([
      pending.then((result) => ({ timedOut: false, result })),
      sleep(REQUEST_BOUND_MS).then(() => ({ timedOut: true, result: null })),
    ]);
    if (!outcome.timedOut) return outcome;
    // The bound fired first: await the drain so its late writes land in THIS test's store.
    await pending.then(
      (result) => ({ timedOut: true, result }),
      (error) => ({ timedOut: true, result: null, error }),
    ).then((late) => Object.assign(outcome, late));
    return outcome;
  };
  const rowOf = (view, participantId) => view.participants.find((entry) => entry.participantId === participantId);
  // The swarm-seat-completion fixture's clean-exit helper: the process exited with no
  // crash row and no recorded failure cause.
  const cleanExit = (worker, status = 'exited') => {
    worker.status = status;
    worker.terminalCause = null;
  };
  const workerOf = (participantId) => workers.find((row) => row.runId === store.swarm('settle').participants[participantId].runId);
  return { store, workers, drainCalls, runtime, call, recruit, stopBounded, rowOf, cleanExit, workerOf };
}

test('353a: a stop of a seat whose worker exited settles within the request bound', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Stop dead seats at once' });
  await f.recruit('alpha');
  f.cleanExit(f.workerOf('alpha'), 'exited');

  const before = f.rowOf(await f.call('view', { projection: 'participants' }), 'alpha');
  assert.equal(before.runtime.live, false, 'the seat has no live runtime to drain');

  const outcome = await f.stopBounded('alpha', 'Session no longer needed');
  assert.equal(outcome.timedOut, false, 'the stop settles inside the request bound — nothing drains');
  assert.deepEqual(f.drainCalls, [], 'no live runtime means no drain call');
  assert.equal(outcome.result?.receipt?.event?.kind, 'swarm.participant_left',
    "the receipt's event is the membership row");
  assert.equal(outcome.result?.leftReason, 'stopped');

  const left = f.store.eventsView().filter((event) => event.kind === 'swarm.participant_left'
    && event.payload?.participantId === 'alpha');
  assert.equal(left.length, 1, 'one stop writes one membership row');
  assert.equal(left[0].payload.reason, 'stopped');
  const row = f.rowOf(await f.call('view', { projection: 'participants' }), 'alpha');
  assert.equal(row.status, 'left');
  assert.equal(row.leftReason, 'stopped');
});

test('353b: a stop of an unbound seat (joined, never bound) settles the same way', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Stop unbound seats at once' });
  f.store.recordSwarm('swarm.participant_joined', {
    swarmId: 'settle', participantId: 'ghost', role: 'Never started', runId: 'run-ghost',
  }, { actor: owner.actor, key: 'issue353-join-ghost' });

  const outcome = await f.stopBounded('ghost', 'Session no longer needed');
  assert.equal(outcome.timedOut, false, 'an unbound seat settles inside the request bound');
  assert.deepEqual(f.drainCalls, [], 'no binding means no drain call');
  assert.equal(outcome.result?.receipt?.event?.kind, 'swarm.participant_left',
    "the receipt's event is the membership row");
  const row = f.rowOf(await f.call('view', { projection: 'participants' }), 'ghost');
  assert.equal(row.status, 'left');
  assert.equal(row.leftReason, 'stopped');
});

test('353c: a stop of a live seat still drains (existing behaviour)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Live stops still drain' });
  await f.recruit('alpha');

  const runId = f.store.swarm('settle').participants.alpha.runId;
  const settled = await f.call('stop', { participantId: 'alpha', reason: 'Session no longer needed' });
  assert.deepEqual(f.drainCalls, [runId], 'a live worker drains through the run');
  assert.equal(settled?.receipt?.event?.kind, 'swarm.participant_left');
  const row = f.rowOf(await f.call('view', { projection: 'participants' }), 'alpha');
  assert.equal(row.status, 'left');
  assert.equal(row.leftReason, 'stopped');
});

const OBSERVE_SWARM = 'swarm-353';
const OBSERVE_SEAT = 'seat-353';

test('353d: the pending observation for swarm.stop names the seat row, never doctor --check', () => {
  const observe = commandObservation('swarm.stop',
    { swarmId: OBSERVE_SWARM, participantId: OBSERVE_SEAT, reason: 'no longer needed' }, 'command-353');
  assert.equal(observe.command, `baton swarm view ${OBSERVE_SWARM} --participant-id ${OBSERVE_SEAT}`);
  assert.equal(observe.row, `participants.${OBSERVE_SEAT} — status left with leftReason stopped when the stop lands`);
  assert.equal(observe.command.includes('doctor'), false);
});

test('353d2: a swarm.stop that outlives the request bound answers cli_command_pending on the seat row', async () => {
  const requested = [];
  const web = new BatonWebClient({
    baseUrl: 'https://resident.baton.test', origin: 'https://control.example.test', repoId: 'repo-issue353',
    token: 'private-bearer', commandTimeoutMs: 60, pollMs: 10, clock: Date.now, sleep: async () => {},
    fetchImpl: async (url, options) => {
      requested.push(String(url));
      if (String(url).endsWith('/healthz')) {
        return { ok: true, headers: { get: () => null }, async text() { return JSON.stringify({ ok: true }); } };
      }
      // The command POST outlives the caller's own bound: the abort fires and the fetch rejects.
      await new Promise((resolve) => { options.signal.addEventListener('abort', resolve, { once: true }); });
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    },
  });
  const error = await web.command('swarm.stop', {
    swarmId: OBSERVE_SWARM, participantId: OBSERVE_SEAT, reason: 'no longer needed',
  }, 'operation-key-353').then(() => null, (refusal) => refusal);
  assert.equal(error?.code, 'cli_command_pending', 'the peer is alive: this is a receipt, not a transport fault');
  assert.equal(error.detail.command, 'swarm.stop');
  assert.equal(error.detail.observe.command, `baton swarm view ${OBSERVE_SWARM} --participant-id ${OBSERVE_SEAT}`);
  assert.match(error.detail.observe.row, /seat-353/u);
  assert.equal(error.detail.observe.command.includes('doctor'), false,
    'a stop is observed on its seat, never via doctor --check');
  assert.deepEqual(requested, [
    'https://resident.baton.test/v1/commands',
    'https://resident.baton.test/healthz',
  ], 'liveness is probed once, and only after the bound elapsed');
});
