import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadSelectedFrontendPackage, validateInvocation } from './native-provider.mjs';

function invocation(overrides = {}) {
  return {
    version: 2,
    query: 'q-1',
    owner: 'owner-1',
    moduleBinding: {
      id: 'bend2', revision: 'development', declarationDigest: 'd'.repeat(64),
      protocolVersion: '2', operation: 'sourceAnalysis', artifactIdentities: [], schemaIdentities: [],
    },
    request: { subject: { kind: 'program', path: 'src/main.bend' }, cwd: '/repo' },
    inputIdentities: [],
    operationPlan: [],
    role: '',
    incarnation: '',
    ...overrides,
  };
}

test('selected provider accepts the exact v2 invocation value and retains empty direct role fields', () => {
  const frame = invocation();
  const result = validateInvocation(frame);
  assert.equal(result.status, 'accepted');
  assert.equal(result.invocation, frame);
  assert.equal(result.invocation.role, '');
  assert.equal(result.invocation.incarnation, '');
});

test('selected provider refuses malformed and incomplete invocation frames', () => {
  assert.deepEqual(validateInvocation(invocation({ version: 1 })), { status: 'refused', reason: 'invocationVersion', detail: null });
  assert.deepEqual(validateInvocation(invocation({ moduleBinding: '{"id":"bend2"}' })), { status: 'refused', reason: 'moduleBindingKind', detail: null });
  const missing = invocation();
  delete missing.inputIdentities;
  assert.deepEqual(validateInvocation(missing), { status: 'refused', reason: 'invocationShape', detail: null });
  assert.deepEqual(validateInvocation(invocation({ owner: '' })), { status: 'refused', reason: 'invocationIdentityMissing', detail: null });
});

test('provider package loading refuses the source checkout without a staged artifact manifest', () => {
  const result = loadSelectedFrontendPackage();
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'packageManifestUnavailable');
});
