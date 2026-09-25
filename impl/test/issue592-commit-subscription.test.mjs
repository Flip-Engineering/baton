import assert from 'node:assert/strict';
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CoordinationStore } from '../src/coordination-store.mjs';

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-592-commit-'));
  const store = new CoordinationStore(root, options);
  store.claimWriterLease();
  t.after(() => { store.releaseWriterLease(); rmSync(root, { recursive: true, force: true }); });
  let key = 0;
  const append = () => store.recordDriver('attention.test_source', { value: ++key }, {
    actor: 'test', key: `source-${key}`,
  }).event;
  return { store, append, root };
}

test('commit subscriptions observe fsync after append and retain rows between subscriptions without timers', async (t) => {
  let syncs = 0;
  const f = fixture(t, { syncFile(path) {
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); syncs++; } finally { closeSync(fd); }
  } });
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('commit wait installed a timer'); });
  t.mock.method(globalThis, 'setInterval', () => { throw new Error('commit wait installed an interval'); });
  let observed = false;
  const first = f.store.waitForCommit(0).then((result) => { observed = true; return result; });
  const source = f.append();
  await Promise.resolve();
  assert.equal(observed, false, 'append visibility is not a commit receipt');
  assert.equal(syncs, 0);
  assert.deepEqual(await first, { upperBound: source.seq });
  assert.equal(syncs, 1);
  const second = f.append();
  const third = f.append();
  assert.deepEqual(await f.store.waitForCommit(source.seq), { upperBound: third.seq });
  assert.equal(syncs, 2, 'the group commit covers both new source rows');
  assert.equal(second.seq + 1, third.seq);
  assert.deepEqual(await f.store.waitForCommit(second.seq), { upperBound: third.seq });
  assert.equal(syncs, 2, 'an established committed cursor needs no additional sync');
});

test('a failed sync rejects pending and future commit waits with debt still in source state', async (t) => {
  const f = fixture(t, { syncFile() { throw Object.assign(new Error('injected sync failure'), { code: 'EIO' }); } });
  const failed = assert.rejects(f.store.waitForCommit(0), {
    code: 'coordination_ledger_unsynced', causeCode: 'EIO',
  });
  const source = f.append();
  await failed;
  assert.equal(f.store.eventsView().at(-1).seq, source.seq);
  await assert.rejects(f.store.waitForCommit(0), { code: 'coordination_ledger_unsynced' });
});

test('abort cancels only its wait and an independent subscriber receives the committed source', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const aborted = assert.rejects(f.store.waitForCommit(0, { signal: controller.signal }), {
    code: 'coordination_commit_aborted',
  });
  const active = f.store.waitForCommit(0);
  controller.abort();
  await aborted;
  const source = f.append();
  assert.deepEqual(await active, { upperBound: source.seq });
});

test('a subscriber joining after group sync receives the durable tail', async (t) => {
  const f = fixture(t);
  const source = f.append();
  // Register after the scheduled group sync has run.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await f.store.waitForCommit(0), { upperBound: source.seq });
});

test('a replaced writer cannot publish a commit cursor to an existing subscriber', async (t) => {
  const f = fixture(t);
  const path = join(f.root, 'writer.lease');
  const original = readFileSync(path, 'utf8');
  const rejected = assert.rejects(f.store.waitForCommit(0), { code: 'coordination_writer_lost' });
  f.append();
  writeFileSync(path, JSON.stringify({ ...JSON.parse(original), token: 'replacement-owner' }));
  try {
    await rejected;
    await assert.rejects(f.store.waitForCommit(0), { code: 'coordination_writer_lost' });
  } finally { writeFileSync(path, original); }
});

test('a projection failure rejects a subscribed consumer even if the source bytes synced', async (t) => {
  const f = fixture(t);
  const rejected = assert.rejects(f.store.waitForCommit(0), { code: 'coordination_projection_poisoned' });
  t.mock.method(f.store, '_apply', () => { throw new Error('injected projection failure'); });
  assert.throws(() => f.append(), { code: 'coordination_projection_poisoned' });
  await rejected;
});

test('writer release closes pending subscriptions and a new owner verifies replayed rows', async (t) => {
  const f = fixture(t);
  const source = f.append();
  await f.store.waitForCommit(0);
  const closed = assert.rejects(f.store.waitForCommit(source.seq), { code: 'coordination_commit_closed' });
  f.store.releaseWriterLease();
  await closed;
  await assert.rejects(f.store.waitForCommit(0), { code: 'coordination_writer_lost' });
  let syncs = 0;
  const reopened = new CoordinationStore(f.root, { syncFile(path) {
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); syncs++; } finally { closeSync(fd); }
  } });
  reopened.claimWriterLease();
  try {
    assert.deepEqual(await reopened.waitForCommit(0), { upperBound: source.seq });
    assert.equal(syncs, 1, 'replay alone is not a verified fsync boundary');
  } finally { reopened.releaseWriterLease(); }
});
