// Issue #290 deliverable 5 (audit swarm-a lead finding 10 / swarm-b lead finding 4): releasing a
// gone holder prunes group rosters to currently active members, and a release batch the trial
// fold cannot prove refuses typed (naming the group and seat) instead of dying as a raw
// SwarmIntegrityError. The group fold's own refusal names the group it refused. Regression:
// two departed members in one group, then release one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { foldSwarmEvent } from '../src/swarm-state.mjs';
const principal = { actor: 'direct:issue290-root', principalId: 'issue290-root', sessionId: 'issue290-root' };

async function runtime(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue290-holder-'));
  const store = new CoordinationStore(directory);
  const swarmRuntime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
  });
  t.after(() => {
    swarmRuntime.close();
    try { store.releaseWriterLease({ requireOwned: true }); }
    catch { /* the root may already be gone on a mid-test failure; the tmpdir is swept below */ }
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, store, swarmRuntime };
}

async function joined(handle, swarmId, participantId) {
  await handle.store.recordSwarm('swarm.participant_joined', {
    swarmId, participantId, role: 'builder',
  }, { actor: principal.actor, key: `issue290:join:${participantId}` });
}

test('I290-H1: the group fold refusal names the group and the seat it refused', () => {
  const swarms = new Map();
  foldSwarmEvent(swarms, { kind: 'swarm.created', payload: { swarmId: 's1', purpose: 'p' } });
  foldSwarmEvent(swarms, { kind: 'swarm.participant_joined', payload: { swarmId: 's1', participantId: 'gone' } });
  foldSwarmEvent(swarms, { kind: 'swarm.participant_left', payload: { swarmId: 's1', participantId: 'gone' } });
  assert.throws(() => foldSwarmEvent(swarms, {
    kind: 'swarm.group_updated', payload: { swarmId: 's1', groupId: 'g1', members: ['gone'] },
  }), (error) => error?.code === 'participant_not_active'
    && error.message.includes('g1') && error.message.includes('gone'),
  'the fold refusal must name the group and the seat, not just the swarm');
});

test('I290-H2: releasing a gone holder prunes two departed seats; the batch lands whole', async (t) => {
  const handle = await runtime(t);
  const { store, swarmRuntime } = handle;
  await swarmRuntime.command('swarm.create', {
    swarmId: 's-release', purpose: 'release regression', idempotencyKey: 'issue290:create:release',
  }, principal);
  for (const participantId of ['alpha', 'beta', 'gamma']) await joined(handle, 's-release', participantId);
  await swarmRuntime.command('swarm.update', {
    swarmId: 's-release', event: 'swarm.group_updated',
    payload: { groupId: 'impl', members: ['alpha', 'beta', 'gamma'], purpose: 'builders' },
    idempotencyKey: 'issue290:group:impl',
  }, principal);
  // Two members depart; the group roster still names them (leave never evicts group seats).
  for (const departed of ['beta', 'gamma']) {
    await swarmRuntime.command('swarm.update', {
      swarmId: 's-release', event: 'swarm.participant_left',
      payload: { participantId: departed, reason: 'runtime gone' },
      idempotencyKey: `issue290:left:${departed}`,
    }, principal);
  }

  // Release alpha: the batch prunes the two departed seats and folds whole. Pre-fix this died
  // as a raw SwarmIntegrityError (participant_not_active) from the trial fold.
  const before = store.ledgerHeadSeq();
  const view = await swarmRuntime.command('swarm.update', {
    swarmId: 's-release', event: 'swarm.holder_released',
    payload: { participantId: 'alpha', reason: 'runtime is gone; seats released' },
    idempotencyKey: 'issue290:release:alpha',
  }, principal);
  assert.deepEqual(view.groups.impl.members, [],
    'the roster retains only currently active members (all of them departed here)');
  const batch = store.eventsView().slice(before);
  assert.deepEqual(batch.filter((event) => event.kind.startsWith('swarm.')).map((event) => event.kind),
    ['swarm.group_updated'], 'the release lands as the hand-written event sequence');
  const groupEvent = batch.find((event) => event.kind === 'swarm.group_updated');
  assert.deepEqual(groupEvent.payload.members, [],
    'the durable group rewrite is the pruned roster, not the raw one');
});

test('I290-H3: an active member survives the prune; the released holder loses only their own seat', async (t) => {
  const handle = await runtime(t);
  const { swarmRuntime } = handle;
  await swarmRuntime.command('swarm.create', {
    swarmId: 's-retain', purpose: 'retention regression', idempotencyKey: 'issue290:create:retain',
  }, principal);
  for (const participantId of ['holder', 'keeper', 'gone-a', 'gone-b']) {
    await joined(handle, 's-retain', participantId);
  }
  await swarmRuntime.command('swarm.update', {
    swarmId: 's-retain', event: 'swarm.group_updated',
    payload: { groupId: 'g', members: ['holder', 'keeper', 'gone-a', 'gone-b'] },
    idempotencyKey: 'issue290:group:retain',
  }, principal);
  for (const departed of ['gone-a', 'gone-b']) {
    await swarmRuntime.command('swarm.update', {
      swarmId: 's-retain', event: 'swarm.participant_left',
      payload: { participantId: departed, reason: 'runtime gone' },
      idempotencyKey: `issue290:left:${departed}`,
    }, principal);
  }
  const view = await swarmRuntime.command('swarm.update', {
    swarmId: 's-retain', event: 'swarm.holder_released',
    payload: { participantId: 'holder', reason: 'runtime is gone' },
    idempotencyKey: 'issue290:release:retain-holder',
  }, principal);
  assert.deepEqual(view.groups.g.members, ['keeper'],
    'the roster keeps the currently active member and drops the holder with the departed');
});
