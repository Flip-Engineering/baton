import assert from 'node:assert/strict';
import test from 'node:test';

import * as contextCall from '../src/context-call.mjs';

// Issue #499 — CONTEXT_EFFECT_CALL_LIMITS was an exported constant that no module
// imported.  It exposed internal limits (maxItems, maxTextBytes) that the validation
// helpers already enforce; a public constant duplicated them without adding a consumer.
// These rows pin that the dead export stays removed.

test('499-d: CONTEXT_EFFECT_CALL_LIMITS is not a named export of context-call', () => {
  assert.equal(Object.hasOwn(contextCall, 'CONTEXT_EFFECT_CALL_LIMITS'), false,
    'the module must not export CONTEXT_EFFECT_CALL_LIMITS');
});

test('499-e: the module still exports its live symbols', () => {
  const expected = [
    'CONTEXT_CALL_STATES',
    'CONTEXT_CALL_STOP_RECEIPT_KIND',
    'contextEffectCallIdentity',
    'contextEffectNodeBinding',
    'contextEffectRetryCallIdentity',
    'contextEffectUnitIdentity',
    'contextMapCallToEffectCall',
    'materializeContextCallBrief',
    'normalizeContextEffectCall',
    'normalizeContextEffectNodeBinding',
    'normalizeContextEffectSource',
    'projectContextCallState',
    'projectContextCallStopState',
  ];
  for (const name of expected) {
    assert.ok(Object.hasOwn(contextCall, name), `expected export ${name} is present`);
  }
});
