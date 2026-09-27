import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  contextEffectCallIdentity, normalizeContextEffectCall,
} from '../src/context-call.mjs';

const sha = (character) => character.repeat(64);
const tree = (character) => character.repeat(40);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');

function artifact(kind, mediaType, character) {
  const artifactDigest = sha(character);
  return {
    kind, mediaType, handle: `art:sha256:${artifactDigest}`,
    digest: artifactDigest, bytes: 128,
  };
}

function authority(overrides = {}) {
  return {
    contextPrincipal: {
      actor: 'deployment:context', principalId: 'service-context-generation',
      repoId: 'repo-phase85-generation', runId: 'run-phase85-generation',
    },
    requester: {
      principalId: 'local-owner', sessionId: 'local-owner-session',
    },
    sessionId: `context-session:${sha('a')}`,
    manifestDigest: sha('b'), treeSha: tree('c'), environmentDigest: sha('d'),
    policyDigest: sha('e'), definitionDigest: sha('f'), roleCatalogDigest: sha('1'),
    profileDigest: sha('2'),
    predecessorPlan: { planId: `plan:${sha('3')}`, version: 1, digest: sha('4') },
    ...overrides,
  };
}

function cellSource(overrides = {}) {
  return {
    kind: 'cell', id: `cell:${sha('5')}`,
    admissionDigest: sha('6'), settlementDigest: sha('7'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', '8'),
    evidenceRef: artifact(
      'context_evidence', 'application/vnd.baton.context-cell-evidence+json', '9',
    ),
    itemCount: 4, coordinateDigest: sha('a'), outputLineageDigest: sha('b'),
    ...overrides,
  };
}

const ITEM_DIGESTS = Object.freeze(['c', 'd', 'e', 'f']);
const COORDINATE_DIGESTS = Object.freeze(['1', '2', '3', '4']);
const CHILD_DIGESTS = Object.freeze(['5', '6', '7', '8']);

function unit(index) {
  return {
    index,
    inputs: [{
      index, itemDigest: sha(ITEM_DIGESTS[index]), lineageDigest: sha('9'),
    }],
    coordinateDigest: sha(COORDINATE_DIGESTS[index]),
  };
}

function generationOneRequest(overrides = {}) {
  return {
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'map',
    generation: 1, predecessorCall: null, inheritedChildren: [],
    authority: authority(), source: cellSource(), role: 'critic',
    instruction: 'Review this exact immutable input.',
    units: [unit(0), unit(1), unit(2), unit(3)],
    ...overrides,
  };
}

function inheritedChild(first, index, originCallId = first.callId) {
  return {
    unitId: first.units[index].unitId,
    originCallId,
    childDigest: sha(CHILD_DIGESTS[index]),
  };
}

function retryRequest(first, {
  generation = 2,
  predecessorGeneration = 1,
  inheritedIndexes = [0, 3],
  retryIndexes = [1, 2],
  originCallId = first.callId,
} = {}) {
  const inheritedChildren = inheritedIndexes.map((index) => (
    inheritedChild(first, index, originCallId)
  ));
  const predecessorCore = {
    callId: first.callId,
    callDigest: first.callDigest,
    generation: predecessorGeneration,
    settlementDigest: sha('a'),
    inheritedChildren,
    retryUnitIds: retryIndexes.map((index) => first.units[index].unitId),
  };
  return generationOneRequest({
    generation,
    inheritedChildren,
    predecessorCall: { ...predecessorCore, retryDigest: digest(predecessorCore) },
    authority: authority({
      predecessorPlan: { planId: `plan:${sha('b')}`, version: 2, digest: sha('c') },
    }),
  });
}

function refreshRetryDigest(request) {
  const predecessorCore = structuredClone(request.predecessorCall);
  delete predecessorCore.retryDigest;
  request.predecessorCall.retryDigest = digest(predecessorCore);
}

test('CC85-GEN-1: generation one retains byte-stable normalization and identities', () => {
  const raw = generationOneRequest();
  const first = contextEffectCallIdentity(raw);
  const repeated = contextEffectCallIdentity(structuredClone(raw));
  const normalized = normalizeContextEffectCall(first);

  assert.equal(JSON.stringify(normalized), JSON.stringify(first));
  assert.equal(JSON.stringify(repeated), JSON.stringify(first));
  assert.equal(repeated.requestId, first.requestId);
  assert.equal(repeated.callId, first.callId);
  assert.equal(first.generation, 1);
  assert.equal(first.predecessorCall, null);
  assert.deepEqual(first.inheritedChildren, []);
  assert.deepEqual(first.executionUnitIds, first.units.map((entry) => entry.unitId));
});

test('CC85-GEN-2: retry generation preserves request identity but has a distinct call identity', () => {
  const first = contextEffectCallIdentity(generationOneRequest());
  const retry = contextEffectCallIdentity(retryRequest(first));

  assert.equal(retry.generation, 2);
  assert.equal(retry.requestDigest, first.requestDigest);
  assert.equal(retry.requestId, first.requestId);
  assert.notEqual(retry.callDigest, first.callDigest);
  assert.notEqual(retry.callId, first.callId);
  assert.deepEqual(normalizeContextEffectCall(retry), retry);
});

test('CC85-GEN-3: inherited and execution units form one exact canonical partition', () => {
  const first = contextEffectCallIdentity(generationOneRequest());
  const retry = contextEffectCallIdentity(retryRequest(first));
  const inheritedIds = retry.inheritedChildren.map((child) => child.unitId);

  assert.deepEqual(inheritedIds, [first.units[0].unitId, first.units[3].unitId]);
  assert.deepEqual(retry.executionUnitIds, [first.units[1].unitId, first.units[2].unitId]);
  assert.deepEqual(
    first.units.map((entry) => entry.unitId),
    first.units
      .filter((entry) => inheritedIds.includes(entry.unitId)
        || retry.executionUnitIds.includes(entry.unitId))
      .map((entry) => entry.unitId),
  );
  assert.equal(
    inheritedIds.some((unitId) => retry.executionUnitIds.includes(unitId)),
    false,
  );

  assert.throws(() => contextEffectCallIdentity(retryRequest(first, {
    inheritedIndexes: [3, 0],
  })), /inherit|canonical/u);
  assert.throws(() => contextEffectCallIdentity(retryRequest(first, {
    retryIndexes: [2, 1],
  })), /inherit|canonical/u);

  const changed = structuredClone(retry);
  changed.executionUnitIds.reverse();
  assert.throws(() => normalizeContextEffectCall(changed), (error) => (
    error?.code?.startsWith('context_call_')
  ));
});

test('CC85-GEN-4: generation gaps and nested versus top-level divergence fail closed', () => {
  const first = contextEffectCallIdentity(generationOneRequest());
  assert.throws(() => contextEffectCallIdentity(retryRequest(first, {
    generation: 3,
    predecessorGeneration: 1,
  })), /predecessor|generation/u);

  const retry = contextEffectCallIdentity(retryRequest(first));
  const nestedChanged = structuredClone(retry);
  nestedChanged.predecessorCall.inheritedChildren[0].childDigest = sha('d');
  refreshRetryDigest(nestedChanged);
  assert.throws(() => normalizeContextEffectCall(nestedChanged), /inherit/u);

  const topChanged = structuredClone(retry);
  topChanged.inheritedChildren[0].childDigest = sha('d');
  assert.throws(() => normalizeContextEffectCall(topChanged), /inherit/u);
});

test('CC85-GEN-5: overlap, omission, and false inherited origin fail closed', () => {
  const first = contextEffectCallIdentity(generationOneRequest());

  assert.throws(() => contextEffectCallIdentity(retryRequest(first, {
    inheritedIndexes: [0, 3],
    retryIndexes: [0, 1, 2],
  })), /inherit/u);
  assert.throws(() => contextEffectCallIdentity(retryRequest(first, {
    inheritedIndexes: [0],
    retryIndexes: [1, 2],
  })), /inherit/u);
  assert.throws(() => contextEffectCallIdentity(retryRequest(first, {
    originCallId: `context-call:${sha('f')}`,
  })), /inherit|origin/u);
});

test('CC85-GEN-6: retryDigest binds the complete predecessor retry authority', () => {
  const first = contextEffectCallIdentity(generationOneRequest());
  const retry = contextEffectCallIdentity(retryRequest(first));
  const changed = structuredClone(retry);
  changed.predecessorCall.retryDigest = sha('e');

  assert.throws(() => normalizeContextEffectCall(changed), (error) => (
    error?.code === 'context_call_integrity'
      && /predecessor digest/u.test(error.message)
  ));
});
