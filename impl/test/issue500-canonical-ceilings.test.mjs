import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson, normalizeCanonicalOrderPolicy, sortCanonicalStrings,
} from '../src/canonical-order.mjs';

// Issue #500 declared the canonical-order implementation ceilings; #530 removed them. This file
// now pins what replaced them: the policy's own coherence rule (an event bound may not exceed its
// ledger bound) and a JSON helper that serializes whatever structure it is given, at any depth.

const GIB = 1024 * 1024 * 1024;
const MIB16 = 16 * 1024 * 1024;
const MIB1 = 1024 * 1024;

const policy = (fields) => ({
  maxLedgerBytes: GIB, maxEventBytes: MIB16, maxEvents: 1_000_000, maxReceiptBytes: MIB1, ...fields,
});

test('500-canonical: the policy accepts any positive bounds and keeps its own coherence rule', () => {
  assert.deepEqual(normalizeCanonicalOrderPolicy(policy({})), policy({}));
  assert.deepEqual(normalizeCanonicalOrderPolicy(policy({ maxLedgerBytes: GIB * 64, maxEventBytes: MIB16 * 4, maxReceiptBytes: MIB1 * 8 })),
    policy({ maxLedgerBytes: GIB * 64, maxEventBytes: MIB16 * 4, maxReceiptBytes: MIB1 * 8 }),
    '#530: no implementation ceiling refuses a deployment a larger bound');
  assert.throws(() => normalizeCanonicalOrderPolicy(policy({ maxEventBytes: GIB + 1 })), TypeError,
    'an event bound over the ledger bound refuses — the policy must be coherent with itself');
});

test('500-canonical: canonicalJson serializes any depth and refuses only a non-JSON shape', () => {
  assert.equal(canonicalJson({ a: 1 }).a, 1);
  let deep = { leaf: true };
  for (let index = 0; index < 2_000; index += 1) deep = { next: deep };
  let cursor = canonicalJson(deep);
  for (let index = 0; index < 2_000; index += 1) cursor = cursor.next;
  assert.equal(cursor.leaf, true, '#530: a deep structure is serialized whole');
  assert.throws(() => canonicalJson({ a: undefined }), TypeError, 'a non-JSON value still refuses');
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), TypeError, 'a cycle still refuses');
});
