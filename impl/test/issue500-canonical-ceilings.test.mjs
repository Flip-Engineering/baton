import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson, normalizeCanonicalOrderPolicy, sortCanonicalStrings,
} from '../src/canonical-order.mjs';

// Issue #500 declared the canonical-order implementation ceilings; #530 removed them, and the
// numbers a deployment declared in the policy left with them. What the policy carries now is the
// declaration itself: declaring the object turns canonical ordering on, and the object holds no
// size or count. A JSON helper that serializes whatever structure it is given, at any depth,
// replaced the bounded one.

test('500-canonical: the policy is the mode declaration, and an unknown key refuses', () => {
  const declaration = normalizeCanonicalOrderPolicy({});
  assert.deepEqual(declaration, {});
  assert.equal(Object.isFrozen(declaration), true);
  assert.throws(() => normalizeCanonicalOrderPolicy({ maxEvents: 1_000 }), TypeError,
    '#530: a declared size or count is not part of the declaration');
  assert.throws(() => normalizeCanonicalOrderPolicy(null), TypeError);
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
