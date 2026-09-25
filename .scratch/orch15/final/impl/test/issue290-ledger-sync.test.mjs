// Issue #290 deliverable 3 (audit swarm-b giants E5/N2, lead finding 8): the authoritative ledger
// append is group-committed so the housekeeping artifacts (checkpoint, segments, receipts — all
// fsynced) are not more durable than the truth they accelerate. The accepted loss window — the
// events appended since the last drain tick — is documented beside the truncated_tail refusal in
// coordination-replay.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/index.mjs';

const actor = 'test:issue290-sync';
const tick = () => new Promise((resolve) => setImmediate(resolve));

function root(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue290-sync-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('I290-S1: ledger appends group-commit through one coalesced sync per drain tick', async (t) => {
  const directory = root(t);
  const syncs = [];
  const store = new CoordinationStore(directory, { syncFile: (file) => syncs.push(file) });
  store.recordDriver('sync.probe', { n: 1 }, { actor, key: 'issue290:sync:1' });
  store.recordDriver('sync.probe', { n: 2 }, { actor, key: 'issue290:sync:2' });
  assert.equal(syncs.length, 0, 'the group commit is scheduled, not synchronous with the append');
  await tick();
  assert.equal(syncs.length, 1, 'appends within one drain tick commit as one group');
  assert.equal(syncs[0], join(directory, 'events.jsonl'));
  store.recordDriver('sync.probe', { n: 3 }, { actor, key: 'issue290:sync:3' });
  await tick();
  assert.equal(syncs.length, 2, 'the next tick commits its own group');
  store.releaseWriterLease({ requireOwned: true });
});

test('I290-S2: a clean release flushes the pending sync before dropping the lease', (t) => {
  const directory = root(t);
  const syncs = [];
  const store = new CoordinationStore(directory, { syncFile: (file) => syncs.push(file) });
  store.recordDriver('sync.probe', { n: 1 }, { actor, key: 'issue290:sync:r1' });
  store.releaseWriterLease({ requireOwned: true });
  assert.equal(syncs.length, 1, 'release must not drop the lease with an un-synced tail');
});

test('I290-S3: a failed ledger sync refuses further writes typed instead of silently continuing', async (t) => {
  const directory = root(t);
  const store = new CoordinationStore(directory, {
    syncFile: () => { throw Object.assign(new Error('simulated EIO'), { code: 'EIO' }); },
  });
  store.recordDriver('sync.probe', { n: 1 }, { actor, key: 'issue290:sync:f1' });
  await tick();
  assert.throws(() => store.recordDriver('sync.probe', { n: 2 }, { actor, key: 'issue290:sync:f2' }),
    (error) => error?.code === 'coordination_ledger_unsynced',
    'after an unconfirmed sync the store must not hand out more durable authority');
  store.releaseWriterLease({ requireOwned: true });
});
