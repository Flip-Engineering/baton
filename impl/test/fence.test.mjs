// Cluster 1 (Core) — fence.mjs test suite.
// Covers FenceTable: registration idempotency, stamp issuance, staleness checks,
// bumpTurn vs bumpHuman semantics, and the unknown-worker failure mode. Behaviors
// 11-18 of spec/IMPLEMENTATION.md (CLUSTER 1 — CORE, section 5). Pure in-memory
// bookkeeping — no disk, no clocks, no async.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FenceTable } from '../src/fence.mjs';

// ============================================================
// issue() / register() — behavior 11, 18
// ============================================================

test('issue() on an unregistered worker throws RangeError', () => {
  const fences = new FenceTable();
  assert.throws(() => fences.issue('ghost'), RangeError);
});

test('register() then issue() returns {fence:1, turnEpoch:1}', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const stamp = fences.issue('w1');
  assert.deepEqual(stamp, { fence: 1, turnEpoch: 1 });
});

test('register() called twice for the same worker is idempotent and does not reset its fence', () => {
  const fences = new FenceTable();
  fences.register('w1');
  fences.bumpTurn('w1');
  fences.bumpTurn('w1');
  const before = fences.issue('w1');
  assert.deepEqual(before, { fence: 3, turnEpoch: 3 });

  fences.register('w1'); // re-register: must be a no-op
  const after = fences.issue('w1');
  assert.deepEqual(after, before, 're-registering must not reset the fence/turnEpoch');
});

// ============================================================
// check() — behaviors 12, 13, 17
// ============================================================

test('check() reports ok:true when the stamp\'s fence equals the current fence', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const stamp = fences.issue('w1');
  const result = fences.check('w1', stamp);
  assert.deepEqual(result, { ok: true, result: 'ok', current: 1, currentTurnEpoch: 1 });
});

test('check() reports stale_fence when the stamp\'s fence is behind the current fence', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const staleStamp = fences.issue('w1');
  fences.bumpTurn('w1'); // advances current fence to 2

  const result = fences.check('w1', staleStamp);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stale_fence');
  assert.equal(result.current, 2);
});

test('check() on a never-registered worker returns unknown_worker without throwing', () => {
  const fences = new FenceTable();
  const result = fences.check('ghost', { fence: 1, turnEpoch: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'unknown_worker');
  assert.equal(result.current, undefined, 'unknown_worker must not report a current fence');
});

// ============================================================
// bumpTurn() / bumpHuman() — behaviors 14, 15, 16
// ============================================================

test('bumpTurn() increments both fence and turnEpoch; a pre-bump stamp fails check()', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const before = fences.issue('w1');

  const bumped = fences.bumpTurn('w1');
  assert.deepEqual(bumped, { fence: 2, turnEpoch: 2 });

  const result = fences.check('w1', before);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stale_fence');
});

test('bumpHuman() increments fence only; turnEpoch is unchanged, and a pre-bump stamp fails check()', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const before = fences.issue('w1');

  const bumped = fences.bumpHuman('w1');
  assert.deepEqual(bumped, { fence: 2, turnEpoch: 1 });

  const result = fences.check('w1', before);
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stale_fence');
});

test('bumpHuman() does not advance turnEpoch across repeated calls within the same turn', () => {
  const fences = new FenceTable();
  fences.register('w1');
  fences.bumpHuman('w1');
  fences.bumpHuman('w1');
  const stamp = fences.issue('w1');
  assert.deepEqual(stamp, { fence: 3, turnEpoch: 1 });
});

test('two issue() calls in a row with no bump between produce identical stamps that both still pass check()', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const a = fences.issue('w1');
  const b = fences.issue('w1');
  assert.deepEqual(a, b, 'issuing alone must never mutate/advance the fence');

  assert.equal(fences.check('w1', a).ok, true);
  assert.equal(fences.check('w1', b).ok, true);
});

// ============================================================
// current() — supporting read for list()/logging
// ============================================================

test('current() returns the worker\'s stamp without consuming or checking anything', () => {
  const fences = new FenceTable();
  fences.register('w1');
  fences.bumpTurn('w1');
  const snapshot1 = fences.current('w1');
  const snapshot2 = fences.current('w1');
  assert.deepEqual(snapshot1, snapshot2);
  assert.deepEqual(snapshot1, { fence: 2, turnEpoch: 2 });
});

// ============================================================
// F1 — fence never reused/reset across a worker's lifetime
// ============================================================

test('fence only ever increases for the lifetime of a worker id (never reused/reset)', () => {
  const fences = new FenceTable();
  fences.register('w1');
  const seen = [fences.current('w1').fence];
  fences.bumpTurn('w1');
  seen.push(fences.current('w1').fence);
  fences.bumpHuman('w1');
  seen.push(fences.current('w1').fence);
  fences.bumpTurn('w1');
  seen.push(fences.current('w1').fence);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] > seen[i - 1], `fence must strictly increase: ${seen}`);
  }
});
