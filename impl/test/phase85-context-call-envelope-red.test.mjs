import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  contextEffectCallIdentity, contextEffectNodeBinding, contextMapCallToEffectCall,
  normalizeContextEffectCall, normalizeContextEffectNodeBinding,
} from '../src/context-call.mjs';
import { contextMapCallIdentity } from '../src/context-map.mjs';

const sha = (character) => character.repeat(64);
const tree = (character) => character.repeat(40);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');

function artifact(kind, mediaType, character) {
  const digest = sha(character);
  return { kind, mediaType, handle: `art:sha256:${digest}`, digest, bytes: 128 };
}

function authority(overrides = {}) {
  return {
    contextPrincipal: {
      actor: 'deployment:context', principalId: 'service-context',
      repoId: 'repo-phase85-call', runId: 'run-phase85-call',
    },
    requester: {
      principalId: 'local-owner', sessionId: 'local-owner-session',
    },
    sessionId: `context-session:${sha('c')}`,
    manifestDigest: sha('d'), treeSha: tree('e'), environmentDigest: sha('f'),
    policyDigest: sha('1'), definitionDigest: sha('2'), roleCatalogDigest: sha('3'),
    profileDigest: sha('4'),
    predecessorPlan: { planId: `plan:${sha('5')}`, version: 1, digest: sha('6') },
    ...overrides,
  };
}

function cellSource(overrides = {}) {
  return {
    kind: 'cell', id: `cell:${sha('7')}`,
    admissionDigest: sha('8'), settlementDigest: sha('9'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', 'a'),
    evidenceRef: artifact(
      'context_evidence', 'application/vnd.baton.context-cell-evidence+json', 'b',
    ),
    itemCount: 2, coordinateDigest: sha('c'), outputLineageDigest: sha('d'),
    ...overrides,
  };
}

function unit(index, overrides = {}) {
  return {
    index,
    inputs: [{ index, itemDigest: sha(index === 0 ? 'e' : 'f'), lineageDigest: sha('1') }],
    coordinateDigest: sha(index === 0 ? '2' : '3'),
    ...overrides,
  };
}

function mapRequest(overrides = {}) {
  return {
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'map',
    generation: 1, predecessorCall: null, inheritedChildren: [],
    authority: authority(), source: cellSource(), role: 'critic',
    instruction: 'Review this exact immutable input.', units: [unit(0), unit(1)],
    ...overrides,
  };
}

test('CC85-1: map identity separates logical request, execution generation, and exact units', () => {
  const call = contextEffectCallIdentity(mapRequest());
  assert.equal(call.schemaVersion, 1);
  assert.equal(call.kind, 'baton.context_effect_call');
  assert.equal(call.operator, 'map');
  assert.match(call.requestId, /^context-request:[a-f0-9]{64}$/u);
  assert.match(call.callId, /^context-call:[a-f0-9]{64}$/u);
  assert.equal(call.units.length, 2);
  assert.deepEqual(call.executionUnitIds, call.units.map((entry) => entry.unitId));
  assert.equal(call.units.every((entry) => (
    entry.unitId === `context-unit:${entry.unitDigest}`
      && /^[a-f0-9]{64}$/u.test(entry.inputSetDigest)
  )), true);
  assert.notEqual(call.units[0].lineageDigest, call.units[0].unitDigest);
  assert.equal(call.authority.requester.commandDigest, call.requestDigest);
  assert.match(call.authority.requester.authorizationDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(normalizeContextEffectCall(call), call);

  const differentRequester = contextEffectCallIdentity(mapRequest({
    authority: authority({
      requester: { principalId: 'other-owner', sessionId: 'other-owner-session' },
    }),
  }));
  assert.equal(differentRequester.requestId, call.requestId);
  assert.deepEqual(differentRequester.units.map((entry) => entry.unitId),
    call.units.map((entry) => entry.unitId));
  assert.notEqual(differentRequester.callId, call.callId);

  const singleton = contextEffectCallIdentity(mapRequest({
    source: cellSource({ itemCount: 1 }), units: [unit(0)],
  }));
  assert.equal(singleton.units.length, 1,
    'the generic authority permits singleton composition even though live map proof requires parallelism');
});

test('CC85-2: reduce is one unit selecting every completed-call output in canonical order', () => {
  const parent = contextEffectCallIdentity(mapRequest());
  const source = {
    kind: 'call', id: parent.callId, callDigest: parent.callDigest, generation: 1,
    settlementDigest: sha('6'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', '7'),
    evidenceRef: artifact(
      'context_call_evidence', 'application/vnd.baton.context-call-evidence+json', '8',
    ),
    itemCount: 2, coordinateDigest: sha('9'), outputLineageDigest: sha('a'),
  };
  const reduce = contextEffectCallIdentity(mapRequest({
    operator: 'reduce', source, role: 'synthesizer',
    instruction: 'Synthesize every exact child result.',
    units: [unit(0, {
      inputs: [
        { index: 0, itemDigest: sha('b'), lineageDigest: sha('c') },
        { index: 1, itemDigest: sha('d'), lineageDigest: sha('e') },
      ],
      coordinateDigest: sha('f'),
    })],
  }));
  assert.equal(reduce.operator, 'reduce');
  assert.equal(reduce.units.length, 1);
  assert.deepEqual(reduce.units[0].inputs.map((entry) => entry.index), [0, 1]);
  assert.equal(reduce.source.id, parent.callId);
});

test('CC85-3: closed identities reject authority, source, grouping, and derived-field substitution', () => {
  const call = contextEffectCallIdentity(mapRequest());
  const mutations = [
    (value) => { value.authority.requester.principalId = 'substituted-owner'; },
    (value) => { value.authority.roleCatalogDigest = sha('f'); },
    (value) => { value.authority.predecessorPlan.digest = sha('e'); },
    (value) => { value.source.outputLineageDigest = sha('c'); },
    (value) => { value.units[0].inputs[0].itemDigest = sha('b'); },
    (value) => { value.units[0].coordinateDigest = sha('a'); },
    (value) => { value.executionUnitIds.reverse(); },
    (value) => { value.requestDigest = sha('9'); },
    (value) => { value.callDigest = sha('8'); },
    (value) => { value.unknown = true; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(call);
    mutate(changed);
    assert.throws(() => normalizeContextEffectCall(changed), (error) => (
      error?.code?.startsWith('context_call_')
    ), `substitution ${index} must fail closed`);
  }

  assert.throws(() => contextEffectCallIdentity(mapRequest({
    units: [unit(0), unit(1, { index: 0 })],
  })), /canonical/u);
  assert.throws(() => contextEffectCallIdentity(mapRequest({ units: [unit(0)] })),
    /canonical cell projection/u);
  assert.throws(() => contextEffectCallIdentity(mapRequest({
    source: { ...cellSource(), callDigest: sha('a') },
  })), /malformed/u);
  assert.throws(() => contextEffectCallIdentity(mapRequest({
    authority: authority({ model: 'gpt-5.6-sol' }),
  })), /malformed/u);
  assert.throws(() => contextEffectCallIdentity(mapRequest({
    generation: 2, predecessorCall: call.callId,
  })), /predecessor|generation/u);
  assert.throws(() => contextEffectCallIdentity(mapRequest({
    operator: 'reduce', units: [unit(0)],
  })), /completed call source/u);

  const callSource = {
    kind: 'call', id: call.callId, callDigest: call.callDigest, generation: 1,
    settlementDigest: sha('6'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', '7'),
    evidenceRef: artifact(
      'context_call_evidence', 'application/vnd.baton.context-call-evidence+json', '8',
    ),
    itemCount: 2, coordinateDigest: sha('9'), outputLineageDigest: sha('a'),
  };
  assert.throws(() => contextEffectCallIdentity(mapRequest({
    operator: 'reduce', source: callSource,
    units: [unit(0, { inputs: [unit(0).inputs[0]] })],
  })), /canonical/u);
  assert.throws(() => contextEffectCallIdentity(mapRequest({
    operator: 'reduce', source: callSource,
    units: [unit(0, { inputs: [
      { index: 1, itemDigest: sha('d'), lineageDigest: sha('e') },
      { index: 0, itemDigest: sha('b'), lineageDigest: sha('c') },
    ] })],
  })), /canonical/u);
});

test('CC85-G1: retry keeps one logical request while executing only retryable units', () => {
  const first = contextEffectCallIdentity(mapRequest());
  const inheritedChildren = [{
    unitId: first.units[0].unitId,
    originCallId: first.callId,
    childDigest: sha('7'),
  }];
  const predecessorCore = {
    callId: first.callId, callDigest: first.callDigest, generation: 1,
    settlementDigest: sha('8'), inheritedChildren,
    retryUnitIds: [first.units[1].unitId],
  };
  const retry = contextEffectCallIdentity(mapRequest({
    generation: 2, inheritedChildren,
    predecessorCall: { ...predecessorCore, retryDigest: digest(predecessorCore) },
    authority: authority({
      predecessorPlan: { planId: `plan:${sha('9')}`, version: 2, digest: sha('a') },
    }),
  }));
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.requestDigest, first.requestDigest);
  assert.notEqual(retry.callId, first.callId);
  assert.equal(retry.generation, 2);
  assert.deepEqual(retry.executionUnitIds, [first.units[1].unitId]);
  assert.deepEqual(retry.inheritedChildren, inheritedChildren);
  assert.equal(contextEffectNodeBinding(retry, retry.units[1]).generation, 2);
  assert.deepEqual(normalizeContextEffectCall(retry), retry);

  for (const mutate of [
    (value) => { value.predecessorCall.retryDigest = sha('f'); },
    (value) => { value.predecessorCall.generation = 0; },
    (value) => { value.predecessorCall.retryUnitIds = [value.units[0].unitId]; },
    (value) => { value.inheritedChildren[0].childDigest = sha('e'); },
    (value) => { value.executionUnitIds = value.units.map((unitValue) => unitValue.unitId); },
  ]) {
    const changed = structuredClone(retry);
    mutate(changed);
    assert.throws(() => normalizeContextEffectCall(changed), (error) => (
      error?.code?.startsWith('context_call_')
    ));
  }
});

test('CC85-4: the Phase 84 map adapter projects into the generic envelope without identity loss', () => {
  const rawMap = {
    schemaVersion: 2, kind: 'baton.context_map_call', generation: 1,
    source: {
      repoId: 'repo-phase85-call', runId: 'run-phase85-call',
      sessionId: `context-session:${sha('c')}`, cellId: `cell:${sha('7')}`,
      cellAdmissionDigest: sha('8'), cellSettlementDigest: sha('9'),
      manifestDigest: sha('d'), sourceProgramDigest: sha('e'), coordinateDigest: sha('c'),
      outputLineageDigest: sha('d'),
      outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', 'a'),
      evidenceRef: artifact(
        'context_evidence', 'application/vnd.baton.context-cell-evidence+json', 'b',
      ),
      predecessorPlan: authority().predecessorPlan,
      definitionDigest: sha('2'), profileDigest: sha('4'), treeSha: tree('e'),
      environmentDigest: sha('f'), policyDigest: sha('1'),
    },
    role: 'critic', instruction: 'Review this exact immutable input.',
    partitions: [
      { index: 0, itemDigest: sha('e'), coordinateDigest: sha('2'), lineageDigest: sha('4') },
      { index: 1, itemDigest: sha('f'), coordinateDigest: sha('3'), lineageDigest: sha('5') },
    ],
  };
  const map = contextMapCallIdentity(rawMap);
  const projected = contextMapCallToEffectCall(map, authority());
  assert.equal(projected.operator, 'map');
  assert.equal(projected.source.id, map.source.cellId);
  assert.equal(projected.source.itemCount, map.partitions.length);
  assert.deepEqual(projected.units.map((entry) => entry.inputs[0].itemDigest),
    map.partitions.map((entry) => entry.itemDigest));
  assert.equal(projected.authority.definitionDigest, map.source.definitionDigest);
  assert.equal(projected.authority.predecessorPlan.digest, map.source.predecessorPlan.digest);

  const legacyRaw = structuredClone(rawMap);
  legacyRaw.schemaVersion = 1;
  delete legacyRaw.source.outputLineageDigest;
  for (const partition of legacyRaw.partitions) delete partition.lineageDigest;
  const legacy = contextMapCallIdentity(legacyRaw);
  assert.throws(() => contextMapCallToEffectCall(legacy, authority()), (error) => (
    error?.code === 'context_call_invalid' && /exact-lineage/u.test(error.message)
  ));
});

test('CC85-5: one closed Plan-node binding selects an exact generic map or reduce unit', () => {
  const parent = contextEffectCallIdentity(mapRequest());
  const source = {
    kind: 'call', id: parent.callId, callDigest: parent.callDigest, generation: 1,
    settlementDigest: sha('6'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', '7'),
    evidenceRef: artifact(
      'context_call_evidence', 'application/vnd.baton.context-call-evidence+json', '8',
    ),
    itemCount: 2, coordinateDigest: sha('9'), outputLineageDigest: sha('a'),
  };
  const reduce = contextEffectCallIdentity(mapRequest({
    operator: 'reduce', source, role: 'synthesizer',
    instruction: 'Synthesize every exact child result.',
    units: [unit(0, {
      inputs: [
        { index: 0, itemDigest: sha('b'), lineageDigest: sha('c') },
        { index: 1, itemDigest: sha('d'), lineageDigest: sha('e') },
      ],
      coordinateDigest: sha('f'),
    })],
  }));
  const binding = contextEffectNodeBinding(reduce, reduce.units[0]);
  assert.equal(binding.schemaVersion, 1);
  assert.equal(binding.kind, 'context_effect_child');
  assert.equal(binding.operator, 'reduce');
  assert.equal(binding.callId, reduce.callId);
  assert.equal(binding.requestId, reduce.requestId);
  assert.equal(binding.logicalRole, 'synthesizer');
  assert.equal(binding.unit.unitId, reduce.units[0].unitId);
  assert.match(binding.bindingDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(normalizeContextEffectNodeBinding(binding), binding);

  for (const mutate of [
    (value) => { value.source.outputLineageDigest = sha('0'); },
    (value) => { value.unit.inputs[0].lineageDigest = sha('0'); },
    (value) => { value.logicalRole = 'critic'; },
    (value) => { value.instructionDigest = sha('0'); },
    (value) => { value.callDigest = sha('0'); },
    (value) => { value.bindingDigest = sha('0'); },
    (value) => { value.unknown = true; },
  ]) {
    const changed = structuredClone(binding);
    mutate(changed);
    assert.throws(() => normalizeContextEffectNodeBinding(changed), (error) => (
      error?.code?.startsWith('context_call_')
    ));
  }
  assert.throws(() => contextEffectNodeBinding(reduce, parent.units[0]), /outside the call/u);
});
