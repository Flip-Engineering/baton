// #313 (the #289 registry-truth leftover): MAX_RUN_RECORDS was the last hardcoded ceiling of the
// run-view constant family — a private `const 100_000` in application.mjs while its sibling
// bounds (view.run.bytes, view.attention_text.bytes, …) derive from the ONE limits registry.
// The ceiling is now the declared view.run.records row, and this pin holds it to the store's
// own validated scan bound, so the two layers can never drift apart silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { goalPlanRunIds } from '../src/coordination-internals.mjs';

test('the run-record read bound is a declared limits-registry row, not a private constant', () => {
  const row = FRAME_LIMITS['view.run.records'];
  assert.ok(row, 'FRAME_LIMITS declares view.run.records (stage: run-records-registry-row-missing)');
  assert.equal(row.class, 'view');
  assert.equal(row.unit, 'items');
  assert.equal(row.value, 100_000, 'the declared bound is unchanged — only the derivation moved');
  assert.equal(row.graceful, 'shed-flagged');
});

test('the derived ceiling stays inside the store scan bound the run-record reads ride', () => {
  // goalPlanRunIds validates its limit against the store's own ceiling before scanning; the
  // application passes the registry-derived MAX_RUN_RECORDS into exactly this family of reads.
  assert.doesNotThrow(() => goalPlanRunIds(new Map(), 'repo:ceiling', FRAME_LIMITS['view.run.records'].value));
  assert.throws(() => goalPlanRunIds(new Map(), 'repo:ceiling', 100_001),
    (error) => error instanceof TypeError, 'the store bound is real, so the pin bites');
});
