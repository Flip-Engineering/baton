// Issue #449 (residual, lane 2) — the release checkpoint's bound is a fact about the PROJECTION the
// write would encode, never about the ledger a replay would read.
//
// OBSERVED LIVE (2026-09-18, both residents on lane 1's build): every stop narrated
//   `projection checkpoint skipped: release_checkpoint_unbounded; <ledger bytes>; cost bound
//    16777216 bytes; replay frame bound 4096 rows`
// and every open replayed the rows past the surviving cache (`checkpoint stale_authority
// (authority_digest {expected: …, actual: …})`). Lane 1 replaced the pre-#449 row-count gate with a
// cost ceiling, but kept the window's LEDGER bytes as an O(1) early-out — and the ledger is bigger
// than the projection on a real ledger, so the bigger the history the LESS likely the checkpoint:
// the same inversion, one layer down. The open also never wrote the cache it had just folded.
//
// What this file pins, on real CoordinationStore bytes:
//  (a) a window whose own ledger bytes are PAST the cost ceiling but whose serialized projection is
//      inside it writes the release checkpoint (#449's red-before: at HEAD the release recorded
//      `release_checkpoint_unbounded` with `bytes: null` and wrote nothing);
//  (b) a projection past the ceiling skips the release write naming the bytes it MEASURED (not a
//      ledger-size guess) and leaves no cache, the next open replays the ledger and writes the
//      cache it just folded — the write the stop could not pay — and the open after that is served
//      from it: at most ONE replay follows a skipped release;
//  (c) an open served by a `stale_authority` cache refreshes it (`refreshed: true`, the bytes), so
//      the following open reports `checkpoint used` rather than the other authority's digest;
//  (d) the deferred housekeeping write on the resident's own loop never pays a second serialize of
//      a window it has already measured past the ceiling, and still lands while the projection fits.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const actor = 'test:issue449b';
const CHECKPOINT = 'projection.checkpoint';
const SERVED_COMMIT = 'b'.repeat(40);
// The two declared rows this file derives from — the replay frame's row ceiling the outcome still
// names, and the checkpoint's OWN cost ceiling the decision is made on.
const FRAME = FRAME_LIMITS['view.wake_replay.items'];
const COST = FRAME_LIMITS['checkpoint.projection_bytes'];

function root(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue449b-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A store's own rows, one ledger event each — the fixture every row below is written through. */
function appendRows(store, count, { from = 1, payload = (index) => ({ index }) } = {}) {
  for (let index = from; index < from + count; index += 1) {
    store.recordDriver('issue449b.fixture', payload(index), { actor, key: `issue449b:row:${index}` });
  }
}

/** Read the checkpoint envelope. v8's deserialize loses Buffer-ness, so the cached projection bytes
 * are re-copied into a Buffer the way the writer stored them. */
function readEnvelope(directory) {
  const envelope = deserialize(readFileSync(join(directory, CHECKPOINT)));
  envelope.projectionBytes = Buffer.from(envelope.projectionBytes);
  return envelope;
}

function writeEnvelope(directory, envelope) {
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });
}

/** One macrotask drain — the seam the deferred checkpoint write lands on (coordination-store.mjs
 * `_append` schedules it with setImmediate, one pending write at a time). */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('449b-a: a ledger past the cost ceiling whose projection fits still checkpoints on release', (t) => {
  const directory = root(t, 'ledger-over-projection-under');
  const store = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  // 800 rows × 8 000 CJK characters: three bytes per character in the ledger's UTF-8, two in the
  // serialized projection (a V8 two-byte string), so the ledger alone is past the cost ceiling while
  // the projection the write would encode is not — exactly the pair the ledger-bytes gate inverted.
  const body = '汉'.repeat(8_000);
  appendRows(store, 800, { payload: (index) => ({ index, body }) });
  const ledgerBytes = store._loadedLedgerIdentity.bytes;
  assert.ok(ledgerBytes > COST.value,
    `the fixture ledger (${ledgerBytes} bytes) must exceed the cost ceiling (${COST.value} bytes)`);
  store.releaseWriterLease({ requireOwned: true });

  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'written',
    'the release bounds the write by the checkpoint\u2019s OWN cost, never by the ledger\u2019s size');
  assert.equal(release.reason, null);
  assert.ok(Number.isSafeInteger(release.bytes) && release.bytes <= COST.value,
    `the measured projection (${release.bytes}) is inside the cost ceiling (${COST.value})`);
  assert.equal(release.ledgerBytes, ledgerBytes,
    'the ledger\u2019s bytes are evidence on the row — never the gate that refused the write');
  assert.equal(release.bound, FRAME.value, 'the replay frame\u2019s row ceiling is still named');
  assert.equal(release.costBound, COST.value, 'beside the checkpoint\u2019s own cost ceiling in bytes');
  assert.equal(release.rows, 800);
  assert.ok(existsSync(join(directory, CHECKPOINT)), 'and the checkpoint is on disk');

  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.startupStatus().checkpoint, 'valid', 'the next open serves itself from it');
  assert.equal(reopened.startupStatus().replayedEvents, 0);
  reopened.releaseWriterLease({ requireOwned: true });
});

test('449b-b: a projection past the ceiling skips the release naming its measured bytes, and the next open writes the cache', (t) => {
  const directory = root(t, 'projection-over');
  const store = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  store.recordDriver('issue449b.fixture', { blob: 'x'.repeat(COST.value + 4_096) },
    { actor, key: 'issue449b:oversize' });
  store.releaseWriterLease({ requireOwned: true });

  const release = store.checkpointReleaseState();
  assert.equal(release?.state, 'skipped', 'a projection past the ceiling is still not re-encoded on a stop');
  assert.equal(release.reason, 'release_checkpoint_unbounded');
  assert.ok(Number.isSafeInteger(release.bytes) && release.bytes > COST.value,
    `the row names the projection it MEASURED (${release.bytes}), not a ledger-size guess`);
  assert.equal(release.ledgerBytes, store._loadedLedgerIdentity.bytes, 'with the ledger\u2019s own bytes as evidence');
  assert.equal(existsSync(join(directory, CHECKPOINT)), false, 'and no cache was written');

  // The open that follows replays the ledger once and writes the cache it just folded: the write the
  // stop could not pay costs no stop's deadline, and it is the only thing that bounds the NEXT open.
  const second = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  const secondStatus = second.startupStatus();
  assert.equal(secondStatus.checkpoint, 'absent', 'there is no cache to serve this open');
  assert.equal(secondStatus.source, 'ledger', 'so the ledger is replayed');
  assert.equal(secondStatus.replayedEvents, 1);
  assert.equal(secondStatus.checkpointRewrite?.state, 'written',
    'the open owes the next open the cache the release skipped');
  assert.equal(secondStatus.checkpointRewrite?.refreshed, true);
  assert.equal(secondStatus.checkpointRewrite?.reason, 'absent_rewrite');
  assert.ok(secondStatus.checkpointRewrite?.bytes > COST.value,
    'an open write is bounded by the replay it follows, never by the housewriting ceiling');
  second.releaseWriterLease({ requireOwned: true });

  const third = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  const thirdStatus = third.startupStatus();
  assert.equal(thirdStatus.checkpoint, 'valid', 'the open wrote the cache the next open needs');
  assert.equal(thirdStatus.source, 'checkpoint', 'the whole window is served from it');
  assert.equal(thirdStatus.replayedEvents, 0, 'at most ONE replay follows a skipped release');
  assert.equal(thirdStatus.checkpointRewrite ?? null, null, 'a used checkpoint is not rewritten');
});

test('449b-c: an open served by a stale-authority cache refreshes it, and the next open uses it', (t) => {
  const directory = root(t, 'stale-authority');
  const first = new CoordinationStore(directory, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  appendRows(first, 24);
  first.releaseWriterLease({ requireOwned: true });
  assert.ok(existsSync(join(directory, CHECKPOINT)), 'the fixture wrote its checkpoint');

  // Another resident wrote it: proven bytes under a different authority digest — the live case, where
  // the cache was folded under other cards/policies and the resident then served for hours.
  const envelope = readEnvelope(directory);
  envelope.authorityDigest = 'c'.repeat(64);
  writeEnvelope(directory, envelope);

  const second = new CoordinationStore(directory, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  const secondStatus = second.startupStatus();
  assert.equal(secondStatus.checkpoint, 'stale_authority',
    'a proven checkpoint under another authority digest is its own state');
  assert.equal(secondStatus.source, 'checkpoint', 'its cached window is reused');
  assert.equal(secondStatus.checkpointEvents, 24);
  assert.equal(secondStatus.replayedEvents, 0);
  assert.equal(secondStatus.checkpointRewrite?.state, 'written',
    'the open that had to fall back to another authority\u2019s cache refreshes it');
  assert.equal(secondStatus.checkpointRewrite?.refreshed, true);
  assert.equal(secondStatus.checkpointRewrite?.reason, 'stale_authority_rewrite');
  assert.ok(Number.isSafeInteger(secondStatus.checkpointRewrite?.bytes) && secondStatus.checkpointRewrite.bytes > 0,
    'naming the bytes it wrote');
  assert.equal(readEnvelope(directory).authorityDigest, second._checkpointAuthorityDigest,
    'the cache now carries this build\u2019s authority');
  second.releaseWriterLease({ requireOwned: true });

  const third = new CoordinationStore(directory, { checkpointInterval: 16, deploymentBaseSha: SERVED_COMMIT });
  const thirdStatus = third.startupStatus();
  assert.equal(thirdStatus.checkpoint, 'valid', 'the following open reports the checkpoint USED');
  assert.equal(thirdStatus.source, 'checkpoint');
  assert.equal(thirdStatus.replayedEvents, 0, 'and replays nothing');
  assert.equal(thirdStatus.checkpointRewrite ?? null, null, 'only the open that fell back refreshed it');
});

test('449b-d: the deferred housekeeping write re-measures only a window it has not already judged', async (t) => {
  const directory = root(t, 'deferred-verdict');
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  // The measurement IS the serialize: count the one writer the deferred path calls, so the row below
  // proves the loop did not pay a second full `v8.serialize` of the same projection (#229).
  let measurements = 0;
  const measure = store._writeProjectionCheckpoint.bind(store);
  store._writeProjectionCheckpoint = (options) => { measurements += 1; return measure(options); };

  appendRows(store, 16, { payload: (index) => (index === 1
    ? { blob: 'x'.repeat(COST.value + 4_096) } : { index }) });
  await settle();
  assert.equal(measurements, 1, 'the first deferred fire measured the projection and refused it');
  assert.equal(existsSync(join(directory, CHECKPOINT)), false, 'the ceiling still refuses that write');
  assert.equal(store._checkpointCostVerdict?.rows, 16, 'the verdict names the window it measured');
  assert.ok(store._checkpointCostVerdict?.bytes > COST.value);

  appendRows(store, 16, { from: 17 });
  await settle();
  assert.equal(measurements, 1,
    'a window that has only grown since a measurement past the ceiling is still past it — no second serialize');
  assert.equal(existsSync(join(directory, CHECKPOINT)), false, 'and the write stays refused');
});

test('449b-e: the deferred housekeeping write still lands while the projection fits the ceiling', async (t) => {
  const directory = root(t, 'deferred-write');
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRows(store, 16);
  await settle();
  assert.ok(existsSync(join(directory, CHECKPOINT)), 'a bounded projection is still cached on the loop');
  const envelope = readEnvelope(directory);
  assert.equal(envelope.throughSeq, 16);
  assert.ok(store._checkpointCostVerdict?.bytes <= COST.value, 'and the verdict is this window\u2019s own measurement');
  store.releaseWriterLease({ requireOwned: true });
});
