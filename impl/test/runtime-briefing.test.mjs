// runtime-briefing.test.mjs — issue #259 slice 3. The brief seam's own focused suite.
//
// The move put the provider-facing brief composition in runtime-briefing.mjs and left a
// same-name, same-arity delegate on the class. Two claims are load-bearing, and each is one a
// later edit can break silently:
//
//   1. PORT — the delegate still exists with its original arity, and the module function it
//      delegates to exists with the ports the move gave it. A delegate whose module call loses a
//      port (the receiver, the digest) fails here rather than at a provider edge nobody exercised.
//   2. PURITY — the seam composes a new value. The admitted brief is never written to, and the
//      provider's own answer rides the returned value alone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import * as runtimeBriefing from '../src/runtime-briefing.mjs';

const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('RB1: the delegate keeps its name and arity, and the module exports the ports it calls', () => {
  const coordinator = Coordinator.prototype._providerBrief;
  assert.equal(typeof coordinator, 'function', 'Coordinator.prototype._providerBrief must stay a member');
  assert.equal(coordinator.length, 1, 'the delegate keeps the brief seam\'s own arity');
  assert.equal(typeof runtimeBriefing.providerBrief, 'function');
  assert.equal(runtimeBriefing.providerBrief.length, 2,
    'providerBrief takes (coordinator, brief, workerId = null, digest): the two required parameters, and the digest port after them');
});

test('RB2: the moved body exists once, in the module that owns the seam', () => {
  const coordinatorSource = source('../src/coordinator.mjs');
  assert.equal(coordinatorSource.split('  _providerBrief(brief, workerId = null) {').length - 1, 1,
    'the coordinator declares the delegate exactly once and holds no second copy of the composition');
});

test('RB3: the seam composes a new value — the admitted brief is never written to', () => {
  const admitted = { goal: 'prove the seam', definitionOfDone: 'the brief stays whole', constraints: [] };
  const snapshot = JSON.stringify(admitted);
  const briefing = Object.freeze({ text: 'finding:alpha (Finding): signal', provenance: 'hub-derived', untrusted: true });

  const withProvider = Coordinator.prototype._providerBrief.call(
    { _knowledgeBriefingProvider: () => briefing }, admitted,
  );
  assert.notEqual(withProvider, admitted, 'a briefing is attached to a new value');
  assert.deepEqual(withProvider.briefing, briefing, 'the provider\'s answer rides the provider-facing value');
  assert.equal(Object.hasOwn(admitted, 'briefing'), false, 'the admitted brief never carries the block');

  const without = Coordinator.prototype._providerBrief.call(
    { _knowledgeBriefingProvider: null }, admitted,
  );
  assert.equal(without, admitted, 'an unwired seam returns the admitted brief itself');
  assert.equal(JSON.stringify(admitted), snapshot, 'no arm of the seam writes to the admitted brief');

  // A provider that refuses (throws) is a null answer, never a dispatch blocker: KG-3 rule 8 makes
  // the briefing best-effort, and the coordinator owns that policy at this seam.
  const refusing = Coordinator.prototype._providerBrief.call(
    { _knowledgeBriefingProvider: () => { throw new Error('preview unavailable'); } }, admitted,
  );
  assert.equal(refusing, admitted, 'a refusing provider leaves the brief as the provider sees it today');
  assert.equal(JSON.stringify(admitted), snapshot, 'the refusal path writes nothing either');
});
