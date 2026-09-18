// Issue #367 — context.read admission reads a replay-derived per-attempt counter fold.
//
// The O-2 receipt ceiling admission (`_assertOrientationReceiptCeiling`) filtered the WHOLE
// ledger (`this._events.filter(...)`) and re-serialized every prior receipt
// (`canonicalBytes(event.payload)` per row) on EVERY admitted read, on the resident main
// loop — the #351 class of O(ledger) work per call. The sibling #286 G-45 folds
// (`_contextReadHeads`/`_contextReadLatest`) already keep replay-derived per-key state; this
// issue adds the same ONE shape for the ceiling: `{count, bytes}` per attempt key, built by
// the context.read arm of the fold (so append and replay maintain it), carried by the
// projection checkpoint like every other per-key fold, and read by admission with a single
// `canonicalBytes(payload)` for the incoming row.
//
// Rows:
//   #367.a  admission never scans the ledger (no `_events.filter` during recordContextRead);
//   #367.b  the count and byte ceilings refuse at the SAME boundary with the SAME code and
//           message as today (pinned at HEAD before the fold landed);
//   #367.c  a restored checkpoint judges the same ceiling — the counter rides the
//           projection checkpoint and the restored fold equals the append-maintained fold;
//   #367.d  the counter fold survives the projection reset (reset + replay rebuilds it);
//   #367.e  replay equivalence: append-maintained fold, full ledger replay hold the SAME
//           counters under the SAME attempt-key identity admission uses.
//
// Suite law: hermetic (mkdtemp fixture, no network) · fixed clock · no timing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { _reloadProjection } from '../src/coordination-replay.mjs';
import { canonicalBytes } from '../src/coordination-internals.mjs';

const REPO = 'repo-367';
const RUN = 'run-367';
const TASK = 'task-367';
const FIXED_TS = '2026-09-17T00:00:00.000Z';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const auth = (key) => ({ actor: 'worker:w-367', key });

// Every receipt row below canonicalizes to the SAME byte count (fixed-width digests only),
// so the byte-ceiling boundary is an exact multiple of one row's canonical bytes.
const tuple = (n, over = {}) => ({
  repoId: REPO, runId: RUN, taskId: TASK, taskVersion: 1, workerId: 'w-367',
  op: 'code.orient.map', normalizedQueryDigest: digest({ n }),
  packDigest: String(n).padStart(64, '0'), freshnessDigest: 'f'.repeat(64),
  ...over,
});
const RB = canonicalBytes(tuple(1));

const ceilings = (count, bytes) => ({
  maxReceiptsPerAttempt: count, maxReceiptBytesPerAttempt: bytes, maxProposalsPerAttempt: 1_000,
});

const storeOptions = (rows) => ({
  repoId: REPO,
  clock: () => FIXED_TS,
  orientationReceiptCeilings: rows,
});

function freshRoot(t, label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue367-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'coordination');
}

function quietRelease(store) {
  try { store.releaseWriterLease({ requireOwned: true }); } catch { /* red-state teardown */ }
}

const refusalOf = (thunk) => {
  try { thunk(); } catch (error) { return error; }
  return null;
};

const attemptKey = (p) => `${p?.repoId ?? ''}\0${p?.runId ?? ''}\0${p?.taskId ?? ''}\0${p?.taskVersion ?? ''}`;
const foldSnapshot = (store) => JSON.parse(JSON.stringify([...store._contextReadAttemptCounters]));

test('#367.a admission of the next read reads the counter — the ledger is never scanned', (t) => {
  const store = new CoordinationStore(freshRoot(t, 'a'), storeOptions(ceilings(8, 1_000_000)));
  for (let n = 1; n <= 5; n += 1) store.recordContextRead(tuple(n), auth(`a${n}`));

  // The ONE observable that proves O(1): the old admission's pipeline begins with
  // `_events.filter` — admission of the next row must never touch it.
  const events = store._events;
  let ledgerScans = 0;
  store._events = new Proxy(events, {
    get(target, prop, receiver) {
      if (prop === 'filter') ledgerScans += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  let admitted = null;
  let failure = null;
  try { admitted = store.recordContextRead(tuple(6), auth('a6')); }
  catch (error) { failure = error; }
  finally { store._events = events; }

  assert.ifError(failure);
  assert.equal(admitted?.result, 'recorded', 'the next read is admitted on the counter fold');
  assert.equal(ledgerScans, 0,
    'admission must read the per-attempt counter, never scan/re-serialize prior receipt rows');
  quietRelease(store);
});

test('#367.b the count and byte ceilings refuse at the same boundary with the same code and message', (t) => {
  // Count leg: 3 receipts on one attempt key admit, the 4th refuses before append.
  const countStore = new CoordinationStore(freshRoot(t, 'b-count'), storeOptions(ceilings(3, 1_000_000)));
  for (let n = 1; n <= 3; n += 1) {
    assert.equal(countStore.recordContextRead(tuple(n), auth(`bc${n}`)).result, 'recorded');
  }
  const beforeCount = countStore.snapshot().lastSeq;
  const countRefusal = refusalOf(() => countStore.recordContextRead(tuple(4), auth('bc4')));
  assert.ok(countRefusal, 'the per-attempt count ceiling refuses');
  assert.equal(countRefusal.message, 'orientation receipt count ceiling exceeded');
  assert.equal(countRefusal.code, 'orientation_receipt_ceiling');
  assert.equal(countStore.snapshot().lastSeq, beforeCount, 'no event is appended past the count ceiling');
  quietRelease(countStore);

  // Byte leg, exact boundary: B = 3·RB admits exactly three rows, the 4th refuses.
  const byteStore = new CoordinationStore(freshRoot(t, 'b-byte'), storeOptions(ceilings(1_000, 3 * RB)));
  for (let n = 1; n <= 3; n += 1) {
    assert.equal(byteStore.recordContextRead(tuple(n), auth(`bb${n}`)).result, 'recorded');
  }
  const beforeByte = byteStore.snapshot().lastSeq;
  const byteRefusal = refusalOf(() => byteStore.recordContextRead(tuple(4), auth('bb4')));
  assert.ok(byteRefusal, 'the per-attempt byte ceiling refuses');
  assert.equal(byteRefusal.message, 'orientation receipt byte ceiling exceeded');
  assert.equal(byteRefusal.code, 'orientation_receipt_ceiling');
  assert.equal(byteStore.snapshot().lastSeq, beforeByte, 'no event is appended past the byte ceiling');
  quietRelease(byteStore);

  // Boundary exactness: one row-width of headroom admits the 4th — the fold must not shift it.
  const snugStore = new CoordinationStore(freshRoot(t, 'b-snug'), storeOptions(ceilings(1_000, 4 * RB)));
  for (let n = 1; n <= 4; n += 1) {
    assert.equal(snugStore.recordContextRead(tuple(n), auth(`bs${n}`)).result, 'recorded',
      `the 4th row fits B = 4·RB exactly (row ${n})`);
  }
  quietRelease(snugStore);
});

test('#367.c a restored checkpoint judges the same ceiling — the counter rides the projection checkpoint', (t) => {
  const directory = freshRoot(t, 'c');
  const rows = ceilings(1_000, 3 * RB);
  const store = new CoordinationStore(directory, storeOptions(rows));
  for (let n = 1; n <= 3; n += 1) store.recordContextRead(tuple(n), auth(`c${n}`));
  const appended = foldSnapshot(store);
  store.releaseWriterLease({ requireOwned: true });

  const reopened = new CoordinationStore(directory, storeOptions(rows));
  try {
    assert.equal(reopened.startupStatus().checkpoint, 'valid',
      'the checkpoint carrying the counter field validates from its recorded shape');
    assert.deepEqual(foldSnapshot(reopened), appended,
      'the restored fold equals the append-maintained fold');

    // Same boundary as the live store: the 4th row refuses, identical message and code.
    const refusal = refusalOf(() => reopened.recordContextRead(tuple(4), auth('c4')));
    assert.ok(refusal, 'the restored fold refuses at the same byte boundary');
    assert.equal(refusal.message, 'orientation receipt byte ceiling exceeded');
    assert.equal(refusal.code, 'orientation_receipt_ceiling');

    // The boundary is not shifted: a fresh attempt key still admits through the restored fold.
    assert.equal(reopened.recordContextRead(tuple(1, { taskId: 'task-367-other' }), auth('c-other')).result,
      'recorded', 'a fresh attempt key admits through the restored fold');
  } finally { quietRelease(reopened); }
});

test('#367.d the counter fold survives the projection reset', (t) => {
  const store = new CoordinationStore(freshRoot(t, 'd'), storeOptions(ceilings(1_000, 100 * RB)));
  for (let n = 1; n <= 2; n += 1) store.recordContextRead(tuple(n), auth(`d${n}`));
  const before = foldSnapshot(store);

  assert.ok(store._contextReadAttemptCounters instanceof Map,
    'the per-attempt counter fold is a projection map');
  _reloadProjection(store);
  assert.deepEqual(foldSnapshot(store), before,
    'reset + ledger replay rebuilds the identical counter fold');
  quietRelease(store);
});

test('#367.e replay equivalence: the append-maintained fold and the full ledger replay hold the same counters', (t) => {
  const directory = freshRoot(t, 'e');
  const store = new CoordinationStore(directory, storeOptions(ceilings(1_000, 100 * RB)));
  // Two attempt keys, uneven counts — the fold is per key, never global.
  for (let n = 1; n <= 3; n += 1) store.recordContextRead(tuple(n), auth(`e1-${n}`));
  store.recordContextRead(tuple(1, { taskVersion: 2 }), auth('e2-1'));
  const appended = foldSnapshot(store);
  assert.equal(appended.length, 2, 'one counter row per attempt key');
  store.releaseWriterLease({ requireOwned: true });

  // The fold key is the admission's attempt key, byte-joined in field order — ONE shape.
  const keys = new Set(appended.map(([key]) => key));
  assert.ok(keys.has(attemptKey(tuple(1))), 'the fold key matches the admission attempt key');
  assert.ok(keys.has(attemptKey(tuple(1, { taskVersion: 2 }))), 'taskVersion partitions attempt keys');

  // Full replay from the ledger alone (checkpoint removed) rebuilds the identical fold.
  rmSync(join(directory, 'projection.checkpoint'), { force: true });
  const replayed = new CoordinationStore(directory, storeOptions(ceilings(1_000, 100 * RB)));
  try {
    assert.equal(replayed.startupStatus().source, 'ledger', 'the row replays from the ledger, not a checkpoint');
    assert.deepEqual(foldSnapshot(replayed), appended,
      'full replay and append-maintained fold produce the same counters');
  } finally { quietRelease(replayed); }
});
