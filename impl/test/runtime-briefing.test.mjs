// runtime-briefing.test.mjs — issue #259 slice 3. The brief seam's own focused suite.
//
// The move put the provider-facing brief composition in runtime-briefing.mjs and the campaign
// briefing surface in application-briefing.mjs, and left same-name, same-arity delegates on the
// two classes. Three claims are load-bearing, and each is one a later edit can break silently:
//
//   1. PORT — every delegate still exists with its original arity, and the module function it
//      delegates to exists with the ports the move gave it. A delegate whose module call loses a
//      port (the receiver, the digest, the refusal constructor) fails here rather than at a
//      provider edge nobody exercised.
//   2. SINGLE SOURCE — the composition bodies live in the modules and nowhere else. A half move
//      that leaves a copy behind is what makes a later fix land in the wrong file.
//   3. PURITY — the seam composes a new value. The admitted brief is never written to, and the
//      provider's own answer rides the returned value alone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import * as applicationBriefing from '../src/application-briefing.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import * as runtimeBriefing from '../src/runtime-briefing.mjs';

const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('RB1: the delegates keep their names and arity, and the modules export the ports they call', () => {
  const coordinator = Coordinator.prototype._providerBrief;
  assert.equal(typeof coordinator, 'function', 'Coordinator.prototype._providerBrief must stay a member');
  assert.equal(coordinator.length, 1, 'the delegate keeps the brief seam\'s own arity');
  assert.equal(typeof runtimeBriefing.providerBrief, 'function');
  assert.equal(runtimeBriefing.providerBrief.length, 2,
    'providerBrief takes (coordinator, brief, workerId = null, digest): the two required parameters, and the digest port after them');

  const resolve = BatonApplication.prototype.resolveBriefing;
  assert.equal(typeof resolve, 'function');
  assert.equal(resolve.length, 2, 'resolveBriefing keeps (args, principal)');
  assert.equal(typeof applicationBriefing.resolveBriefing, 'function');
  assert.equal(applicationBriefing.resolveBriefing.length, 4,
    'resolveBriefing takes (application, args, principal, applicationError)');

  const mint = BatonApplication.prototype.mintCampaignBriefingInternal;
  assert.equal(typeof mint, 'function');
  assert.equal(mint.length, 2, 'mintCampaignBriefingInternal keeps (args, principal)');
  assert.equal(typeof applicationBriefing.mintCampaignBriefingInternal, 'function');
  assert.equal(applicationBriefing.mintCampaignBriefingInternal.length, 3,
    'mintCampaignBriefingInternal takes (application, args, principal)');
});

test('RB2: the moved bodies exist once, in the module that owns the seam', () => {
  const coordinatorSource = source('../src/coordinator.mjs');
  assert.equal(coordinatorSource.split('  _providerBrief(brief, workerId = null) {').length - 1, 1,
    'the coordinator declares the delegate exactly once and holds no second copy of the composition');
  assert.equal(coordinatorSource.includes('UNTRUSTED_CONTEXT_PACK — '), false,
    'the context-pack framing literal lives in runtime-briefing.mjs after the move');
  const applicationSource = source('../src/application.mjs');
  assert.equal(applicationSource.includes('UNTRUSTED_CAMPAIGN_BRIEFING — '), false,
    'the campaign briefing frame literal lives in application-briefing.mjs after the move');
  assert.equal(applicationSource.includes('contextPackHead'), false,
    'the serve lane reads the family head in application-briefing.mjs, not in the class');
  assert.equal(source('../src/application-briefing.mjs').includes('UNTRUSTED_CAMPAIGN_BRIEFING — '), true,
    'the frame the serve lane pairs with the Δ lives with the serve lane');
});

test('RB3: the seam composes a new value — the admitted brief is never written to', () => {
  const admitted = { goal: 'prove the seam', definitionOfDone: 'the brief stays whole', constraints: [] };
  const snapshot = JSON.stringify(admitted);
  const briefing = Object.freeze({ text: 'finding:alpha (Finding): signal', provenance: 'hub-derived', untrusted: true });

  const withProvider = Coordinator.prototype._providerBrief.call(
    { _contextBriefMaterializer: null, _knowledgeBriefingProvider: () => briefing }, admitted,
  );
  assert.notEqual(withProvider, admitted, 'a briefing is attached to a new value');
  assert.deepEqual(withProvider.briefing, briefing, 'the provider\'s answer rides the provider-facing value');
  assert.equal(Object.hasOwn(admitted, 'briefing'), false, 'the admitted brief never carries the block');

  const without = Coordinator.prototype._providerBrief.call(
    { _contextBriefMaterializer: null, _knowledgeBriefingProvider: null }, admitted,
  );
  assert.equal(without, admitted, 'an unwired seam returns the admitted brief itself');
  assert.equal(JSON.stringify(admitted), snapshot, 'no arm of the seam writes to the admitted brief');

  // A provider that refuses (throws) is a null answer, never a dispatch blocker: KG-3 rule 8 makes
  // the briefing best-effort, and the coordinator owns that policy at this seam.
  const refusing = Coordinator.prototype._providerBrief.call(
    { _contextBriefMaterializer: null, _knowledgeBriefingProvider: () => { throw new Error('preview unavailable'); } }, admitted,
  );
  assert.equal(refusing, admitted, 'a refusing provider leaves the brief as the provider sees it today');
  assert.equal(JSON.stringify(admitted), snapshot, 'the refusal path writes nothing either');
});
