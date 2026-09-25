// Issue #532: exactObject accepts unknown fields for forward compatibility.
//
// The closed-field check refused objects carrying fields beyond the declared set.
// Both implementations (goal-plan.mjs, application-observation.mjs) now check only
// that all required fields are present; unknown fields pass through silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactObject } from '../src/application-observation.mjs';

test('exactObject accepts an object with all required fields plus extra unknown fields', () => {
  assert.doesNotThrow(() => exactObject(
    { a: 1, b: 2, extra: 'hello', another: true },
    ['a', 'b'],
    'test_code',
    'test object',
  ));
});

test('exactObject accepts an object with exactly the required fields', () => {
  assert.doesNotThrow(() => exactObject(
    { a: 1, b: 2 },
    ['a', 'b'],
    'test_code',
    'test object',
  ));
});

test('exactObject refuses an object missing a required field', () => {
  assert.throws(
    () => exactObject({ a: 1 }, ['a', 'b'], 'test_code', 'test object'),
    (err) => err.code === 'test_code' && /missing required field/.test(err.message),
  );
});

test('exactObject refuses null', () => {
  assert.throws(
    () => exactObject(null, ['a'], 'test_code', 'test object'),
    (err) => err.code === 'test_code',
  );
});

test('exactObject refuses an array', () => {
  assert.throws(
    () => exactObject([1, 2], ['a'], 'test_code', 'test object'),
    (err) => err.code === 'test_code',
  );
});

test('exactObject refuses a primitive', () => {
  assert.throws(
    () => exactObject('hello', ['a'], 'test_code', 'test object'),
    (err) => err.code === 'test_code',
  );
});

// Issue #536: the strict read is explicit per call. An authorization boundary keeps the closed
// shape (#535's rule) — the session-authority envelope and the semantic action authority are
// grants, so an undeclared field is a claim the grantor never vouched, never an extension.
import { normalizeCommandContext, normalizeSemanticAuthority } from '../src/application-observation.mjs';

test('exactObject rejects unknown fields only when the caller passes rejectUnknown', () => {
  assert.throws(
    () => exactObject({ a: 1, b: 2, extra: 'hello' }, ['a', 'b'], 'test_code', 'test object',
      { rejectUnknown: true }),
    (err) => err.code === 'test_code' && /undeclared field extra/.test(err.message),
  );
  assert.doesNotThrow(() => exactObject(
    { a: 1, b: 2, extra: 'hello' }, ['a', 'b'], 'test_code', 'test object',
  ));
});

test('a session authority envelope carrying an undeclared field refuses at the context boundary', () => {
  const base = {
    transport: 'mcp', requestId: 'req-1', idempotencyKey: 'key-1',
    sessionAuthority: {
      schemaVersion: 1, authorityDigest: 'a'.repeat(64),
      expiresAt: '2026-09-21T00:00:00.000Z', orchestratorLeaseId: 'lease:1',
    },
  };
  assert.doesNotThrow(() => normalizeCommandContext(base));
  assert.throws(
    () => normalizeCommandContext({
      ...base,
      sessionAuthority: { ...base.sessionAuthority, sessionToken: 'forged' },
    }),
    (err) => err.code === 'application_context_invalid'
      && /undeclared field sessionToken/.test(err.message),
  );
});

test('a semantic action authority carrying an undeclared field refuses at the context boundary', () => {
  const base = {
    schemaVersion: 1, actionId: 'action:1', kind: 'deploy', effect: 'write',
    requiredCapabilities: ['baton_deploy'], authorityDigest: 'a'.repeat(64),
  };
  assert.throws(
    () => normalizeSemanticAuthority({ ...base, orchestratorLeaseId: 'lease:1' }),
    (err) => err.code === 'application_context_invalid'
      && /undeclared field orchestratorLeaseId/.test(err.message),
  );
});
