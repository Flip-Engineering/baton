import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, NORMALIZER_CEILING, normalizeContextProgramPolicy,
} from '../src/context-program-policy.mjs';

test('Issue #500: NORMALIZER_CEILING is frozen and covers every integer policy field', () => {
  assert.equal(Object.isFrozen(NORMALIZER_CEILING), true);
  const integerFields = Object.keys(DEFAULT_CONTEXT_PROGRAM_POLICY)
    .filter((f) => f.startsWith('max'));
  for (const field of integerFields) {
    assert.ok(Object.hasOwn(NORMALIZER_CEILING, field),
      `NORMALIZER_CEILING is missing field ${field}`);
    assert.equal(typeof NORMALIZER_CEILING[field], 'number');
    assert.ok(Number.isSafeInteger(NORMALIZER_CEILING[field]),
      `NORMALIZER_CEILING.${field} is not a safe integer`);
    assert.ok(NORMALIZER_CEILING[field] > 0,
      `NORMALIZER_CEILING.${field} must be positive`);
  }
});

test('Issue #500: a policy at the ceiling values passes normalization', () => {
  const { policyDigest: _, ...body } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  const atCeiling = normalizeContextProgramPolicy({ ...body, ...NORMALIZER_CEILING });
  for (const field of Object.keys(NORMALIZER_CEILING)) {
    assert.equal(atCeiling[field], NORMALIZER_CEILING[field],
      `field ${field} differs after normalization at ceiling`);
  }
});

test('Issue #500: a policy one above any ceiling field is rejected', () => {
  const { policyDigest: _, ...body } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  for (const field of Object.keys(NORMALIZER_CEILING)) {
    assert.throws(
      () => normalizeContextProgramPolicy({ ...body, ...NORMALIZER_CEILING, [field]: NORMALIZER_CEILING[field] + 1 }),
      { code: 'context_policy_invalid' },
      `ceiling for ${field} was not enforced`,
    );
  }
});

test('Issue #500: CONTEXT_REFERENCE_READ_POLICY fields match the ceiling table', () => {
  const { policyDigest: __, ...refBody } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  const referencePolicy = normalizeContextProgramPolicy({ ...refBody, ...NORMALIZER_CEILING });
  for (const field of Object.keys(NORMALIZER_CEILING)) {
    assert.equal(referencePolicy[field], NORMALIZER_CEILING[field],
      `CONTEXT_REFERENCE_READ_POLICY.${field} drifted from NORMALIZER_CEILING`);
  }
});
