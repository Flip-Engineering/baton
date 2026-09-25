import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson, normalizeCanonicalOrderPolicy, sortCanonicalStrings,
} from '../src/canonical-order.mjs';

// Issue #500: pin the canonical-order implementation ceilings. The five bounds in
// impl/src/canonical-order.mjs are operator-declared (no file derives them); this test locks
// their live values at every enforcement face so a retune is a deliberate change, never drift.

const GIB = 1024 * 1024 * 1024;
const MIB16 = 16 * 1024 * 1024;
const MIB1 = 1024 * 1024;

const policy = (fields) => ({
  maxLedgerBytes: GIB, maxEventBytes: MIB16, maxEvents: 1_000_000, maxReceiptBytes: MIB1, ...fields,
});

test('500-canonical: the policy ceilings accept their bound and refuse bound + 1', () => {
  assert.deepEqual(normalizeCanonicalOrderPolicy(policy({})), policy({}));
  for (const [field, bound] of [
    ['maxLedgerBytes', GIB], ['maxEventBytes', MIB16],
    ['maxEvents', 1_000_000], ['maxReceiptBytes', MIB1],
  ]) {
    assert.throws(() => normalizeCanonicalOrderPolicy(policy({ [field]: bound + 1 })), TypeError,
      `${field} refuses above its ceiling`);
  }
  assert.throws(() => normalizeCanonicalOrderPolicy(policy({ maxEventBytes: GIB + 1 })), TypeError,
    'an event over the ledger ceiling refuses');
});

test('500-canonical: sortCanonicalStrings judges maxItems against the 1M item ceiling', () => {
  assert.deepEqual(sortCanonicalStrings(['b', 'a'], { maxItems: 1_000_000 }), ['a', 'b']);
  assert.throws(() => sortCanonicalStrings(['a'], { maxItems: 1_000_001 }), RangeError,
    'maxItems above the ceiling is invalid');
  assert.throws(() => sortCanonicalStrings(['a', 'b'], { maxItems: 1 }), RangeError,
    'over-bound input refuses');
});

test('500-canonical: canonicalJson judges depth against the 256 ceiling', () => {
  assert.equal(canonicalJson({ a: 1 }, { maxDepth: 256, maxNodes: 1_000_000 }).a, 1);
  assert.throws(() => canonicalJson({ a: 1 }, { maxDepth: 257, maxNodes: 1_000_000 }), RangeError,
    'maxDepth above the ceiling is invalid');
  assert.throws(() => canonicalJson({ a: 1 }, { maxDepth: 128, maxNodes: 1_000_001 }), RangeError,
    'maxNodes above the ceiling is invalid');
  let deep = { leaf: true };
  for (let index = 0; index < 256; index += 1) deep = { next: deep };
  assert.throws(() => canonicalJson(deep), RangeError, 'past the default depth refuses');
});
