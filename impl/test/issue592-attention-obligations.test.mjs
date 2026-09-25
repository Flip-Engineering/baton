import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { rootAttentionObligations } from '../src/attention-obligations.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const swarmId = 'attention-test';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-attention-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  let ordinal = 0;
  const record = (kind, payload) => store.recordSwarm(kind, { swarmId, ...payload }, {
    actor: 'owner', key: `test-${++ordinal}`,
  });
  const driver = (kind, payload) => store.recordDriver(kind, { swarmId, ...payload }, {
    actor: 'owner', key: `test-${++ordinal}`,
  }).event;
  record('swarm.created', { purpose: 'durable attention' });
  record('swarm.participant_joined', { participantId: 'author', permissions: ['contribute'] });
  const contribute = (contributionId, needsFromOthers = []) => record('swarm.contribution_recorded', {
    contributionId, participantId: 'author', body: { needsFromOthers },
  });
  const read = (options) => rootAttentionObligations(store.swarm(swarmId), store.eventsView(), options);
  const review = (contributionId, decision) => record('swarm.contribution_reviewed', {
    contributionId, decision, reviewerId: 'owner',
  });
  return { directory, store, record, driver, contribute, review, read };
}

test('source contributions remain owed when a crash prevented secondary wake materialization', (t) => {
  const f = fixture(t);
  const source = f.contribute('c1');
  const [owed] = f.read();
  assert.equal(owed.owed, 'review_owed');
  assert.deepEqual(owed.source, { kind: 'swarm.contribution_recorded', seq: source.seq });
  assert.deepEqual(owed.delivery, { state: 'none', code: null });
  assert.deepEqual(owed.recipient, { kind: 'root' });
  assert.deepEqual(owed.next, { command: 'swarm.check', swarmId, participantId: 'author', contributionId: 'c1' });
  const reopened = new CoordinationStore(f.directory);
  assert.deepEqual(rootAttentionObligations(reopened.swarm(swarmId), reopened.eventsView()), f.read());
});

test('review closes only its source review debt; comments and transport receipts preserve it', (t) => {
  const f = fixture(t);
  f.contribute('c1', ['Root: decide which rollout to use']);
  f.contribute('c2');
  const initial = f.read();
  const old = f.driver('swarm.root_attention_owed', {
    participantId: 'author', contributionId: 'c1', owed: 'review_owed', ask: null,
  });
  f.driver('wake.root_delivered', { seq: old.seq, wakeClass: 'root_owed' });
  const delivered = f.read().find((row) => row.contributionId === 'c1' && row.owed === 'review_owed');
  assert.equal(delivered.obligationId, initial.find((row) => row.contributionId === 'c1' && row.owed === 'review_owed').obligationId);
  assert.equal(delivered.delivery.state, 'transport_reported');
  f.review('c1', 'comment');
  assert.ok(f.read().some((row) => row.obligationId === delivered.obligationId));
  f.review('c1', 'accept');
  assert.equal(f.read().some((row) => row.obligationId === delivered.obligationId), false);
  assert.deepEqual(f.read().map((row) => [row.contributionId, row.owed]), [
    ['c1', 'needs_root'], ['c2', 'review_owed'],
  ]);
});

test('reviewer departure derives root debt without a new materialized wake', (t) => {
  const f = fixture(t);
  f.record('swarm.participant_joined', { participantId: 'reviewer', permissions: ['review'] });
  f.contribute('c1');
  assert.deepEqual(f.read(), []);
  f.record('swarm.participant_left', { participantId: 'reviewer', reason: 'stopped' });
  const [owed] = f.read();
  assert.equal(owed.owed, 'review_owed');
  f.record('swarm.participant_joined', { participantId: 'successor', permissions: ['review'] });
  assert.deepEqual(f.read(), [], 'a live reviewer now owns the review route');
  f.record('swarm.participant_left', { participantId: 'successor', reason: 'stopped' });
  assert.equal(f.read()[0].obligationId, owed.obligationId);
});

test('distinct full asks keep distinct identities when presentation has the same prefix', (t) => {
  const f = fixture(t);
  const prefix = 'Root: ' + 'x'.repeat(200);
  f.contribute('c1', [prefix + 'first', prefix + 'second', prefix + 'first', 'root cause: ignored']);
  const options = { renderAsk: (text) => text.slice(0, 40) };
  const asks = f.read(options).filter((row) => row.owed === 'needs_root');
  assert.equal(asks.length, 2);
  assert.equal(asks[0].ask, asks[1].ask);
  assert.notEqual(asks[0].obligationId, asks[1].obligationId);
  f.driver('swarm.root_attention_owed', {
    participantId: 'author', contributionId: 'c1', owed: 'needs_root', ask: prefix.slice(0, 40),
  });
  const later = f.read(options).filter((row) => row.owed === 'needs_root');
  assert.deepEqual(new Set(later.map((row) => row.obligationId)), new Set(asks.map((row) => row.obligationId)));
  assert.equal(later.length, 2);
});

test('historical source rows and failures remain scoped to their swarm and wake class', (t) => {
  const f = fixture(t);
  const owed = f.driver('swarm.root_attention_owed', {
    participantId: 'author', contributionId: 'missing-source', owed: 'needs_root', ask: 'Root: inspect legacy state',
  });
  f.driver('wake.root_undelivered', { seq: owed.seq, wakeClass: 'root_owed', code: 'transport_closed' });
  f.driver('wake.root_delivered', { seq: owed.seq, wakeClass: 'another_class' });
  f.driver('wake.root_delivered', { swarmId: 'another-swarm', seq: owed.seq, wakeClass: 'root_owed' });
  assert.deepEqual(f.read()[0].delivery, { state: 'failed', code: 'transport_closed' });
  f.driver('wake.root_delivered', { seq: owed.seq, wakeClass: 'root_owed' });
  assert.equal(f.read()[0].delivery.state, 'transport_reported');
  assert.equal(f.read()[0].source.kind, 'swarm.root_attention_owed');
});

test('the real swarm attention projection keeps source debt after delivery and removes it after review', async (t) => {
  const f = fixture(t);
  f.contribute('c1');
  const runtime = new SwarmRuntime({
    store: f.store, authorize: async () => {},
    coordinator: { list: () => [], pausedTurns: () => [], routeCards: () => [] },
  });
  const principal = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  const attention = async () => {
    const result = await runtime.command('swarm.view', { swarmId, projection: 'attention' }, principal);
    const rows = Array.isArray(result.attention) ? result.attention : result.attention?.rows ?? [];
    return rows.filter((row) => row.kind === 'root_attention_owed');
  };
  assert.equal((await attention()).filter((row) => row.contributionId === 'c1').length, 1);
  const owed = f.driver('swarm.root_attention_owed', {
    participantId: 'author', contributionId: 'c1', owed: 'review_owed', ask: null,
  });
  f.driver('wake.root_delivered', { seq: owed.seq, wakeClass: 'root_owed' });
  assert.equal((await attention()).find((row) => row.contributionId === 'c1').delivery.state, 'transport_reported');
  f.review('c1', 'reject');
  assert.deepEqual(await attention(), []);
});

async function processFixture(t, directory) {
  const child = fork(new URL('./fixtures/issue592-attention-process.mjs', import.meta.url), [directory], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const pending = new Map();
  let requestId = 0;
  let ready;
  const opened = new Promise((resolve, reject) => { ready = { resolve, reject }; });
  child.on('message', (message) => {
    if (message.ready) return ready.resolve();
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else waiter?.resolve(message.result);
  });
  child.on('error', (error) => {
    ready.reject(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const exited = once(child, 'exit');
  child.on('exit', (code, signal) => {
    const error = new Error(`attention process exited: ${code ?? signal}; ${stderr}`);
    ready.reject(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  });
  await opened;
  return {
    call(action, kind, payload) {
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.send({ id, action, kind, payload, key: `process-${process.pid}-${child.pid}-${id}` }, (error) => {
          if (error) { pending.delete(id); reject(error); }
        });
      });
    },
    async crash() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    },
  };
}

test('a source commit survives abrupt process loss before materialization, delivery, and business resolution', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-attention-process-'));
  // Cleanup hooks run in registration order, so release children before removing their store.
  let first, second, third;
  t.after(async () => {
    await first?.crash(); await second?.crash(); await third?.crash();
    rmSync(directory, { recursive: true, force: true });
  });
  first = await processFixture(t, directory);
  await first.call('swarm', 'swarm.created', { swarmId, purpose: 'crash recovery' });
  await first.call('swarm', 'swarm.participant_joined', { swarmId, participantId: 'author', permissions: ['contribute'] });
  const source = await first.call('swarm', 'swarm.contribution_recorded', {
    swarmId, participantId: 'author', contributionId: 'c1', body: 'review the recorded change',
  });
  await first.crash();
  second = await processFixture(t, directory);
  const [recovered] = await second.call('read');
  assert.equal(recovered.source.seq, source.event.seq);
  const owed = await second.call('driver', 'swarm.root_attention_owed', {
    swarmId, participantId: 'author', contributionId: 'c1', owed: 'review_owed', ask: null,
  });
  await second.call('driver', 'wake.root_delivered', { swarmId, seq: owed.event.seq, wakeClass: 'root_owed' });
  await second.crash();
  third = await processFixture(t, directory);
  const [stillOwed] = await third.call('read');
  assert.equal(stillOwed.obligationId, recovered.obligationId);
  assert.equal(stillOwed.delivery.state, 'transport_reported');
  await third.call('swarm', 'swarm.contribution_reviewed', {
    swarmId, contributionId: 'c1', reviewerId: 'owner', decision: 'reject',
  });
  assert.deepEqual(await third.call('read'), []);
  await third.crash();
  const reopened = new CoordinationStore(directory);
  assert.deepEqual(rootAttentionObligations(reopened.swarm(swarmId), reopened.eventsView()), []);
});
