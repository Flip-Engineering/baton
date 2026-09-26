// issue564-root-wake-undelivered-attention.test.mjs — issue #564's reporting half: a
// root-addressed wake that reached no session is attention the swarm view reports.
//
// The addressing half records a durable owed row when work waits on the root
// (`swarm.root_attention_owed`, with `owed: 'review_owed' | 'needs_root'`). The delivery half
// records what became of the attempt (`wake.root_delivered` / `wake.root_undelivered`) against the
// SAME wake identity: the ledger seq of the row the frame came from. This projection joins the
// two row sets, so a delivered wake clears on the next read and an undelivered or failed one stays
// visible with the code it failed under. Nothing is stored here and nothing is retracted: the
// durable rows stay the one source, exactly as the `unreviewed_contribution` row already works.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { deliverRootWakeOnce } from '../src/wake-delivery.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

/** The light harness issue433-contributions-projection.test.mjs uses for the rows that need no
 * transport: a real CoordinationStore behind a real SwarmRuntime, no adapter, no git, no run. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue564-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const attentionRows = async () => {
    const view = await call('view', { projection: 'attention' });
    return Array.isArray(view.attention) ? view.attention : view.attention?.rows ?? [];
  };
  const rootWakeRow = async (seq) => (await attentionRows())
    .find((row) => row.kind === 'root_wake_undelivered' && row.seq === seq) ?? null;
  return { directory, store, runtime, call, attentionRows, rootWakeRow,
    record: (kind, payload) => store.recordDriver(kind, payload, { actor: owner.actor, key: `root-wake-${++key}` }) };
}

test('564-u1: an owed root wake with no delivery record is reported as attention', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'root-addressed wake attention (#564)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const owed = f.record('swarm.root_attention_owed', {
    swarmId: 'baton', participantId: 'lead', contributionId: 'c1', owed: 'review_owed',
    next: { command: 'swarm.check', swarmId: 'baton', participantId: 'lead', contributionId: 'c1' },
  });
  const owedSeq = owed.event.seq;

  const row = await f.rootWakeRow(owedSeq);
  assert.ok(row,
    'an owed root wake with no delivery record must be reported as attention, so the deployment view says what the wake never reached');
  assert.equal(row.participantId, 'lead', 'the row keeps the seat the owed item belongs to');
  assert.equal(row.contributionId, 'c1', 'the row keeps the contribution the owed item names');
  assert.equal(row.owed, 'review_owed', 'the row keeps the trigger the owed row recorded');
  assert.deepEqual(row.delivery, { state: 'none', code: null },
    'no delivery attempt yet is a named state, never silence');
  assert.deepEqual(row.next,
    { command: 'swarm.check', swarmId: 'baton', participantId: 'lead', contributionId: 'c1' },
    'the row carries the owed row own next act, so a reader can settle the item from the attention row');
});

test('564-u2: a durable delivery record for the same wake identity clears the row, and only for that identity', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'root-addressed wake attention (#564)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const first = f.record('swarm.root_attention_owed', {
    swarmId: 'baton', participantId: 'lead', contributionId: 'c1', owed: 'review_owed',
  });
  const second = f.record('swarm.root_attention_owed', {
    swarmId: 'baton', participantId: 'lead', contributionId: 'c2', owed: 'needs_root',
    ask: 'the root: land the queue',
  });
  assert.ok(await f.rootWakeRow(first.event.seq), 'the first owed wake is reported while nothing delivered it');
  assert.ok(await f.rootWakeRow(second.event.seq), 'the second owed wake is reported too');

  f.record('wake.root_delivered', {
    seq: first.event.seq, swarmId: 'baton', wakeClass: 'root_owed',
    harness: 'claude-code', mechanism: 'session-socket', sessionId: 'session-1',
  });
  assert.equal(await f.rootWakeRow(first.event.seq), null,
    'a durable delivery record for the wake own seq clears the row on the next read — nothing is retracted');
  assert.ok(await f.rootWakeRow(second.event.seq),
    'a delivery record for another wake never clears this one: the identity is the wake own ledger seq');
});

test('564-u3: a failed delivery keeps the row and names the code the attempt failed under', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'root-addressed wake attention (#564)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const owed = f.record('swarm.root_attention_owed', {
    swarmId: 'baton', participantId: 'lead', contributionId: 'c3', owed: 'needs_root',
    ask: 'the root: restart the serving process',
  });
  f.record('wake.root_undelivered', {
    seq: owed.event.seq, swarmId: 'baton', wakeClass: 'root_owed',
    harness: 'codex', mechanism: 'none', code: 'wake_delivery_unsupported',
  });
  const row = await f.rootWakeRow(owed.event.seq);
  assert.ok(row, 'a wake whose delivery failed is still owed: the row stays');
  assert.deepEqual(row.delivery, { state: 'failed', code: 'wake_delivery_unsupported' },
    'the row names the state and the typed code, so the deployment view reports an undelivered root wake as attention with its reason');
  assert.equal(row.ask, 'the root: restart the serving process', 'the owed ask rides the row');
});

test('564-u4: only this swarm owed rows are reported', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'root-addressed wake attention (#564)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const foreign = f.record('swarm.root_attention_owed', {
    swarmId: 'another-swarm', participantId: 'lead', contributionId: 'c9', owed: 'review_owed',
  });
  assert.equal(await f.rootWakeRow(foreign.event.seq), null,
    'another swarm owed wake never rides this swarm attention projection');
});

test('564-u5: a later successful attempt clears the attention left by a transient failure', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'retry root-addressed wake attention (#564)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const owed = f.record('swarm.root_attention_owed', {
    swarmId: 'baton', participantId: 'lead', contributionId: 'c-retry', owed: 'needs_root',
    ask: 'the root: inspect the recovered delivery',
  });
  const frame = { seq: owed.event.seq, wakeClass: 'root_owed', swarmId: 'baton' };
  const target = { harness: 'claude-code', sessionId: 'session-root' };
  let sends = 0;
  const deliver = async () => {
    sends += 1;
    if (sends === 1) throw Object.assign(new Error('socket refused'), { code: 'claude_session_transport_failed' });
    return { delivered: true };
  };

  await assert.rejects(deliverRootWakeOnce({ store: f.store, frame, target, deliver }),
    (error) => error?.code === 'claude_session_transport_failed');
  assert.deepEqual((await f.rootWakeRow(owed.event.seq))?.delivery,
    { state: 'failed', code: 'claude_session_transport_failed' });

  const recovered = await deliverRootWakeOnce({ store: f.store, frame, target, deliver });
  assert.equal(recovered.delivered, true);
  assert.equal(recovered.attempt, 2);
  assert.equal(await f.rootWakeRow(owed.event.seq), null);
  assert.equal(sends, 2);
});
