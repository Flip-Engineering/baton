// surface-conformance-red.test.mjs — issue #582 reduction: the hand-maintained divergence
// ledger is gone, so the ledger-discipline rows are gone with it. What remains are the
// registry-derived derivations this file always pinned: one mechanical name derivation and the
// registry-pinned serialization order.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_OPERATIONS,
  canonicalizeSerialization,
  deriveSurfaceNames,
  serializationOrderViolations,
} from '../scripts/surface-conformance.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

test('SC3: surface names have one mechanical derivation', () => {
  assert.deepEqual(deriveSurfaceNames('run.member.stop'), {
    cli: 'baton run member stop',
    mcp: 'baton_run_member_stop',
    web: 'run_member_stop',
    embedded: 'run.member(role).stop()',
  });
  for (const operation of CANONICAL_OPERATIONS) {
    assert.deepEqual(operation.names, deriveSurfaceNames(operation.key));
  }
});

test('SC8 (C8): the registry-pinned serialization order normalizes and catches a scrambled emitter', () => {
  const order = APPLICATION_SEMANTIC_REGISTRY.serializationOrder;
  assert.ok(Array.isArray(order.envelope) && order.envelope[0] === 'schemaVersion');
  // The normalization emits the pinned keys leading, in pinned order, trailing keys after.
  const scrambled = {
    origin: 'https://c.test', args: {}, command: 'run_do', schemaVersion: 1,
    repoId: 'repo-a', idempotencyKey: 'k', commandId: 'c', runId: 'r', extra: 1,
  };
  const normalized = canonicalizeSerialization(order.envelope, scrambled);
  assert.deepEqual(Object.keys(normalized), [
    'schemaVersion', 'commandId', 'idempotencyKey', 'command', 'args', 'repoId', 'runId', 'origin', 'extra',
  ]);
  // Parsers stay order-insensitive: reordering changes no value, only key order.
  assert.deepEqual(normalized, scrambled);
  // The checker passes the normalized emit and CATCHES the scrambled one.
  assert.deepEqual(serializationOrderViolations(order.envelope, normalized), []);
  const violations = serializationOrderViolations(order.envelope, scrambled);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].actual[0], 'origin');
  // The registry-owned nested `do` block and its `{kind, actionId}` coordinate pin likewise.
  assert.deepEqual(
    Object.keys(canonicalizeSerialization(order.do, { inputs: {}, action: {} })),
    ['action', 'inputs'],
  );
  assert.equal(serializationOrderViolations(order.action, { actionId: 'a', kind: 'approve_plan' }).length, 1);
});
