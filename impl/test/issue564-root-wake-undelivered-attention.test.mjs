// Historical delivery receipts remain visible until the source obligation is resolved.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
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
    .find((row) => row.kind === 'root_attention_owed' && row.seq === seq) ?? null;
  return { directory, store, runtime, call, attentionRows, rootWakeRow,
    record: (kind, payload) => store.recordDriver(kind, payload, { actor: owner.actor, key: `root-wake-${++key}` }) };
}

test('564-u1: an owed root wake with no delivery record is reported as attention', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'root-addressed wake attention (#564)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  const owed = f.record('swarm.root_attention_owed', {
    swarmId: 'baton', participantId: 'lead', contributionId: 'c1', owed: 'review_owed',
    next: { command: 'swarm.view', swarmId: 'baton' },
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
    { command: 'swarm.view', swarmId: 'baton' },
    'the row carries the owed row own next act, so a reader can settle the item from the attention row');
});

test('564-u2: a historical transport receipt retains the obligation and names its evidence', async (t) => {
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
  assert.deepEqual((await f.rootWakeRow(first.event.seq)).delivery,
    { state: 'transport_reported', code: null });
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

