import assert from 'node:assert/strict';
import { test } from 'node:test';

import { unavailableEvent, validateInvocation } from './native-provider.mjs';

function invocation(overrides = {}) {
  return {
    version: 2,
    query: 'q-1',
    owner: 'owner-1',
    moduleBinding: { id: 'bend2', operation: 'sourceAnalysis' },
    request: { subject: { kind: 'definition' } },
    inputIdentities: [{ path: '/repo/src/main.bend' }],
    operationPlan: [{ common: 'sourceAnalysis' }],
    role: 'worker',
    incarnation: 'inc-1',
    ...overrides,
  };
}

test('selected provider preserves admitted invocation identities in a v2 unavailable event', () => {
  const frame = invocation({ query: null, role: null });
  const result = unavailableEvent(frame);
  assert.deepEqual(result, {
    version: 2,
    query: null,
    owner: 'owner-1',
    moduleBinding: frame.moduleBinding,
    runtime: null,
    role: null,
    incarnation: 'inc-1',
    sequence: '1',
    type: 'event',
    payload: { status: 'unavailable', reason: 'selectedFrontendInvocationUnavailable' },
  });
});

test('selected provider refuses malformed and incomplete invocation frames', () => {
  assert.deepEqual(validateInvocation(invocation({ version: 1 })), { status: 'refused', reason: 'invocationVersion' });
  assert.deepEqual(validateInvocation(invocation({ moduleBinding: '{"id":"bend2"}' })), { status: 'refused', reason: 'moduleBindingKind' });
  const missing = invocation();
  delete missing.inputIdentities;
  assert.deepEqual(validateInvocation(missing), { status: 'refused', reason: 'invocationShape' });
});
