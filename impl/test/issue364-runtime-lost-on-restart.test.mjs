// Issue #364 — after a resident restart every seat whose worker died with the OLD resident kept
// reading runtime {state: idle, live: true, turn: paused} on swarm.view until a root stopped it by
// hand (observed 2026-09-18 on the audit resident and again 05:55Z on the clone: 42 seats read
// active, 2 had a working runtime, and the other 40 rode into every new recruit brief's Peers
// section).
//
// The repair: the resident reconciles its participant runtime rows against the workers it actually
// owns — captured once by the startup reconstruction (`coordinator.startupWorkerFleet()`) — and the
// swarm runtime folds ONE durable `swarm.participant_runtime_lost {swarmId, participantId,
// workerId, incarnation, at}` row per seat whose worker is absent from that fleet (the #425
// runtime-recorded pattern: registered in swarm-state's own SWARM_EVENT_KINDS, never
// caller-submittable). The participant row then reads live:false / state:dead with a
// `worker_lost_on_restart` attention row naming the two commands that settle it; the brief's Peers
// section, scopeOverlap and the host-capacity holders read that settled liveness (#350's rule).
//
// Every row here is written against a REAL reopened driver (createDriver over the same repo and
// logDir — the restart #383/#434 describe), never a hand-built projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_EVENT_KINDS, foldSwarmEvent, swarmSnapshot } from '../src/swarm-state.mjs';

const roots = [];
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue364-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'issue364@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'issue364']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  const logDir = join(root, 'deployment');
  mkdirSync(logDir, { recursive: true });
  return { root, repo, logDir };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });
const seatBrief = (label) => createBrief({
  goal: label, constraints: [], pathScope: ['**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
  budget: { tokens: 1_000, usd: 1, wallMin: 1 },
});

/** ONE incarnation: a real driver over the shared repository + deployment root, and the swarm
 * runtime the deployment builds over it (the `_swarmRuntime` wiring in application.mjs). The
 * seats' runs are spawned through the coordinator itself, so the replayed worker handles a second
 * incarnation sees are the ones this incarnation really created. */
function incarnation(f, { holders = [], label = 'i' } = {}) {
  const driver = createDriver({
    repoRoot: f.repo, repoId: 'issue364-repo', logDir: f.logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] } }) },
  });
  const runtime = new SwarmRuntime({
    store: driver.coordination,
    coordinator: driver.coordinator,
    authorize: async () => {},
    prepareRun: async () => ({}),
    lastCrash: () => null,
    hostCapacity: {
      acquire: async () => ({ token: 'host-lease-token' }),
      releaseWorkersExcept: async (keep) => { holders.push([...keep]); return { released: [] }; },
    },
    startRun: async (request) => {
      const handle = await driver.coordinator.spawn('mock', seatBrief(request.participantId), {
        taskId: request.runId, runId: request.runId,
      });
      return { runId: request.runId, workerId: handle.id };
    },
  });
  let keys = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'view' ? {} : { idempotencyKey: `${label}-${command}-${++keys}` }),
    ...args,
  }, owner);
  return { driver, runtime, call, holders };
}

const close = async (incarnationRow) => {
  try { await incarnationRow.driver.drainAndClose('issue364:test'); }
  catch { try { incarnationRow.driver.coordination.releaseWriterLease(); } catch { /* best effort */ } }
};

const participantRow = (view, participantId) =>
  view.participants.find((row) => row.participantId === participantId) ?? null;
const lostRows = (store) => store.eventsView().filter((event) => event.kind === 'swarm.participant_runtime_lost');
const attentionKinds = (view) => view.attention.map((row) => row.kind);

test('364-a: a seat whose worker died with the old incarnation reads live:false/state:dead, with the worker_lost_on_restart attention row', async (t) => {
  const f = world('a');
  const first = incarnation(f, { label: 'a1' });
  await first.call('create', { swarmId: 'sw', purpose: 'Restart truth' });
  await first.call('recruit', { swarmId: 'sw', participantId: 'alpha', objective: 'work alpha' });
  const bound = first.driver.coordination.swarm('sw').participants.alpha;
  assert.equal(bound.status, 'active', 'the seat is a live member of the first incarnation');
  await close(first);

  const second = incarnation(f, { label: 'a2' });
  t.after(() => close(second));
  const replayed = second.driver.coordinator.list().find((row) => row.id === bound.bindings.at(-1).workerId);
  assert.ok(replayed, 'the restart replays the seat\'s worker handle');
  assert.ok(['idle', 'working', 'blocked'].includes(replayed.status),
    `the replayed handle still reads live-bearing status ${replayed.status} (the reported bug)`);

  const view = await second.call('view', { swarmId: 'sw' });
  const alpha = participantRow(view, 'alpha');
  assert.equal(alpha.status, 'active', 'membership is untouched: the restart does not settle it');
  assert.deepEqual(alpha.runtime, { workerId: bound.bindings.at(-1).workerId, state: 'dead', turn: null, live: false },
    'a worker absent from the recovered fleet reads dead, not live');

  const rows = lostRows(second.driver.coordination);
  assert.equal(rows.length, 1, 'ONE reconciliation row per lost seat');
  assert.equal(rows[0].payload.participantId, 'alpha');
  assert.equal(rows[0].payload.workerId, bound.bindings.at(-1).workerId);
  assert.ok(Number.isSafeInteger(rows[0].payload.incarnation) && rows[0].payload.incarnation >= 0,
    'the row names the lost worker incarnation');
  assert.equal(typeof rows[0].payload.at, 'string', 'the row is stamped when the loss was reconciled');

  const attention = view.attention.filter((row) => row.kind === 'worker_lost_on_restart');
  assert.equal(attention.length, 1, 'the lost seat pages');
  assert.equal(attention[0].participantId, 'alpha');
  assert.equal(attention[0].workerId, bound.bindings.at(-1).workerId);
  assert.deepEqual(attention[0].next, { resume: 'swarm.recruit --resume-from', stop: 'swarm.stop' },
    'the row names both commands that settle the seat');
});

test('364-b: the lost seat is not presented as a peer in a later recruit brief', async (t) => {
  const f = world('b');
  const first = incarnation(f, { label: 'b1' });
  await first.call('create', { swarmId: 'sw', purpose: 'Peers read settled liveness' });
  await first.call('recruit', { swarmId: 'sw', participantId: 'alpha', objective: 'work alpha' });
  await close(first);

  const second = incarnation(f, { label: 'b2' });
  t.after(() => close(second));
  await second.call('recruit', { swarmId: 'sw', participantId: 'beta', objective: 'work beta' });
  await second.call('recruit', { swarmId: 'sw', participantId: 'probe', objective: 'work probe' });
  const brief = second.driver.coordination.swarm('sw').participants.probe.brief;
  const situation = brief.split('## Swarm situation')[1] ?? '';
  assert.equal(situation.includes('- alpha'), false, 'a seat whose worker died with the old incarnation is not a peer');
  assert.ok(situation.includes('- beta'), 'a seat recruited by THIS incarnation still is');
});

test('364-c: a seat recruited by the recovering incarnation is untouched', async (t) => {
  const f = world('c');
  const first = incarnation(f, { label: 'c1' });
  await first.call('create', { swarmId: 'sw', purpose: 'Live seats are not lost' });
  await first.call('recruit', { swarmId: 'sw', participantId: 'alpha', objective: 'work alpha' });
  await close(first);

  const second = incarnation(f, { label: 'c2' });
  t.after(() => close(second));
  await second.call('recruit', { swarmId: 'sw', participantId: 'beta', objective: 'work beta' });
  const view = await second.call('view', { swarmId: 'sw' });
  const beta = participantRow(view, 'beta');
  assert.equal(beta.runtime.state, 'working', 'the recovering incarnation\'s own seat is untouched');
  assert.equal(beta.runtime.live, true);
  assert.equal(beta.runtimeLost ?? null, null, 'no reconciliation row lands on a seat this incarnation owns');
  assert.equal(lostRows(second.driver.coordination).filter((row) => row.payload.participantId === 'beta').length, 0);
  assert.deepEqual(view.attention.filter((row) => row.kind === 'worker_lost_on_restart'
    && row.participantId === 'beta'), [],
  'and it pages nobody');
});

test('364-d: replay parity — the reconciled row is a durable fold row, and a third incarnation reads it identically', async (t) => {
  const f = world('d');
  const first = incarnation(f, { label: 'd1' });
  await first.call('create', { swarmId: 'sw', purpose: 'Replay parity' });
  await first.call('recruit', { swarmId: 'sw', participantId: 'alpha', objective: 'work alpha' });
  await close(first);

  const second = incarnation(f, { label: 'd2' });
  const firstView = await second.call('view', { swarmId: 'sw' });
  const reconciled = participantRow(firstView, 'alpha').runtime;
  await close(second);

  // The row is a fold row, not runtime-local state: replaying the ledger from an empty projection
  // through the same fold the store replays yields the seat's reading.
  const swarms = new Map();
  for (const event of second.driver.coordination.eventsView()) {
    if (SWARM_EVENT_KINDS.has(event.kind)) foldSwarmEvent(swarms, event);
  }
  const replayedParticipant = swarmSnapshot(swarms).swarms[0].participants.alpha;
  assert.equal(replayedParticipant.runtimeLost?.workerId, reconciled.workerId,
    'a replayed projection carries the same lost worker');

  const third = incarnation(f, { label: 'd3' });
  t.after(() => close(third));
  const thirdView = await third.call('view', { swarmId: 'sw' });
  assert.deepEqual(participantRow(thirdView, 'alpha').runtime, reconciled,
    'every later incarnation reads the same settled liveness');
  assert.equal(lostRows(third.driver.coordination).length, 1,
    'a later incarnation never mints a second reconciliation row for the same seat');
});

test('364-e: a dead seat holds no host-capacity reservation, and scopeOverlap does not name it', async (t) => {
  const f = world('e');
  const holders = [];
  const first = incarnation(f, { label: 'e1' });
  await first.call('create', { swarmId: 'sw', purpose: 'Dead seats hold nothing' });
  await first.call('recruit', {
    swarmId: 'sw', participantId: 'alpha', objective: 'work alpha', options: { scope: ['impl/a'] },
  });
  await close(first);

  const second = incarnation(f, { holders, label: 'e2' });
  t.after(() => close(second));
  const probe = await second.call('recruit', {
    swarmId: 'sw', participantId: 'probe', objective: 'work probe', options: { scope: ['impl/a'] },
  });
  assert.deepEqual(probe.scopeOverlap, [],
    'the lost seat is not a live scope holder for the recruit advisory');
  // The reconciliation released the lost seat's reservation: no holder set the resident computed
  // after it ever names alpha, and the seat this incarnation owns was admitted on the host.
  const named = holders.flat().filter((holder) => holder.includes('alpha'));
  assert.deepEqual(named, [], `the lost seat holds no worker lease (holders: ${JSON.stringify(holders)})`);
  assert.ok(holders.length >= 1, 'the reconciliation computed a holder set at all');
  assert.equal(probe.admission?.state, 'admitted', 'the seat this incarnation owns is admitted');
  assert.equal(probe.admission?.authority, 'host', 'and it holds the host lease the resident admitted it on');
  const view = await second.call('view', { swarmId: 'sw' });
  assert.deepEqual(view.attention.filter((row) => row.kind === 'worker_lost_on_restart')
    .map((row) => row.participantId), ['alpha']);
});

test('364-f: a binding recorded AFTER the loss supersedes it — a rebound seat can act again', async (t) => {
  // The reconciliation is history, not a permanent sentence: the seat reads its runtime from the
  // NEWEST fact about it (the #350/#332 rule). A stub coordinator (the issue350 pattern) pins the
  // runtime's own reading; the durable rows are the real fold's.
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue364-f-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [{ id: 'w-1', taskId: 't-1', runId: 'run-1', status: 'idle', paused: false }];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      startupWorkerFleet: () => ({
        owned: [], recovered: [],
        lost: [{ workerId: 'w-1', incarnation: 3, taskId: 't-1', runId: 'run-1' }],
      }),
    },
    authorize: async () => {},
    lastCrash: () => null,
  });
  const owner = { actor: 'owner', principalId: 'owner' };
  let keys = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'view' ? {} : { idempotencyKey: `f-${command}-${++keys}` }), ...args,
  }, owner);
  const write = (kind, payload, key) => store.recordSwarm(kind, payload, { actor: 'owner', key });

  await call('create', { swarmId: 'sw', purpose: 'A rebound seat acts again' });
  write('swarm.participant_joined', { swarmId: 'sw', participantId: 'alpha', runId: 'run-1' }, 'f-join');
  write('swarm.participant_bound', { swarmId: 'sw', participantId: 'alpha', workerId: 'w-1', taskId: 't-1' }, 'f-bind-1');

  const lost = await call('view', { swarmId: 'sw' });
  const lostRow = participantRow(lost, 'alpha');
  assert.equal(lostRow.runtime.state, 'dead', 'the replayed worker is outside the recovered fleet');
  assert.equal(lostRows(store).length, 1);

  // A later binding is a newer fact about the SAME seat: it is armed again.
  write('swarm.participant_bound', { swarmId: 'sw', participantId: 'alpha', workerId: 'w-1', taskId: 't-1' }, 'f-bind-2');
  const rebound = await call('view', { swarmId: 'sw' });
  const reboundRow = participantRow(rebound, 'alpha');
  assert.equal(reboundRow.runtime.state, 'idle', 'the newer binding is what the seat reads');
  assert.equal(reboundRow.runtime.live, true);
  assert.deepEqual(rebound.attention.filter((row) => row.kind === 'worker_lost_on_restart'), [],
    'and the loss stops paging');

  // The row is runtime-recorded, never caller-submittable: swarm.update's closed set is the
  // contract's, and this fold-only kind is not in it (the #425 pattern).
  await assert.rejects(call('update', {
    swarmId: 'sw', event: 'swarm.participant_runtime_lost',
    payload: { swarmId: 'sw', participantId: 'alpha', workerId: 'w-1', incarnation: 3, at: '2026-09-18T00:00:00.000Z' },
  }), (error) => {
    assert.equal(error.detail?.field, 'event', 'the refusal names the event field');
    assert.equal(String(error.detail?.admitted ?? '').includes('swarm.participant_runtime_lost'), false,
      'and the admitted set does not contain the runtime-recorded kind');
    return true;
  });
  assert.equal(lostRows(store).length, 1, 'the history row is never rewritten away');
});
