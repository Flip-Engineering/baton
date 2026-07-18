import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  contextMapCallIdentity,
  contextMapNodeBinding,
  materializeContextMapBrief,
  normalizeContextMapCall,
  normalizeContextMapNodeBinding,
} from '../src/context-map.mjs';
import { renderBrief } from '../src/adapter.mjs';
import { renderPrompt } from '../src/cli-adapters.mjs';

const sha = (character) => character.repeat(64);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function source() {
  return {
    repoId: 'repo-phase84',
    runId: 'run-phase84',
    sessionId: `context-session:${sha('1')}`,
    cellId: `cell:${sha('2')}`,
    cellAdmissionDigest: sha('3'),
    cellSettlementDigest: sha('4'),
    manifestDigest: sha('5'),
    sourceProgramDigest: sha('6'),
    coordinateDigest: sha('7'),
    outputRef: {
      kind: 'context_value',
      mediaType: 'application/vnd.baton.context-value+json',
      handle: `art:sha256:${sha('8')}`,
      digest: sha('8'),
      bytes: 512,
    },
    evidenceRef: {
      kind: 'context_evidence',
      mediaType: 'application/vnd.baton.context-cell-evidence+json',
      handle: `art:sha256:${sha('9')}`,
      digest: sha('9'),
      bytes: 768,
    },
    predecessorPlan: {
      planId: `plan:${sha('a')}`,
      version: 1,
      digest: sha('b'),
    },
    definitionDigest: sha('c'),
    profileDigest: sha('d'),
    treeSha: 'e'.repeat(40),
    environmentDigest: sha('e'),
    policyDigest: sha('f'),
  };
}

function request() {
  return {
    schemaVersion: 1,
    kind: 'baton.context_map_call',
    generation: 1,
    source: source(),
    role: 'critic',
    instruction: 'Find replay, authority, and lifecycle gaps in this exact partition.',
    partitions: [
      { index: 0, itemDigest: sha('0'), coordinateDigest: sha('1') },
      { index: 1, itemDigest: sha('2'), coordinateDigest: sha('3') },
    ],
  };
}

test('CM84-S1: map call is closed, content addressed, canonical, and contains no route knobs', () => {
  const normalized = normalizeContextMapCall(request());
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.kind, 'baton.context_map_call');
  assert.match(normalized.callId, /^context-call:[a-f0-9]{64}$/u);
  assert.match(normalized.callDigest, /^[a-f0-9]{64}$/u);
  assert.match(normalized.programDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(normalized.partitions.map(({ index }) => index), [0, 1]);
  assert.equal(normalized.partitions.every(({ partitionId }) => (
    /^context-partition:[a-f0-9]{64}$/u.test(partitionId)
  )), true);
  assert.equal(JSON.stringify(normalized).includes('harness'), false);
  assert.equal(JSON.stringify(normalized).includes('model'), false);
  assert.equal(JSON.stringify(normalized).includes('effort'), false);
  assert.equal(JSON.stringify(normalized).includes('budget'), false);
  assert.deepEqual(contextMapCallIdentity(request()), normalized);

  const reordered = request();
  reordered.partitions.reverse();
  assert.deepEqual(normalizeContextMapCall(reordered), normalized,
    'caller ordering must not alter canonical partition identity');
});

test('CM84-S2: map call rejects singleton/empty batches, gaps, duplicates, and caller route authority', () => {
  for (const partitions of [
    [],
    [{ index: 0, itemDigest: sha('0'), coordinateDigest: sha('1') }],
    [
      { index: 0, itemDigest: sha('0'), coordinateDigest: sha('1') },
      { index: 0, itemDigest: sha('2'), coordinateDigest: sha('3') },
    ],
    [
      { index: 0, itemDigest: sha('0'), coordinateDigest: sha('1') },
      { index: 2, itemDigest: sha('2'), coordinateDigest: sha('3') },
    ],
  ]) {
    assert.throws(() => normalizeContextMapCall({ ...request(), partitions }), (error) => (
      error?.code === 'context_map_invalid'
    ));
  }
  for (const [field, value] of [
    ['harness', 'codex'], ['model', 'gpt-5.6-sol'], ['effort', 'xhigh'],
    ['workerPolicy', { access: 'full' }], ['budget', { tokens: 1 }],
    ['concurrency', 99], ['credential', 'secret'],
  ]) {
    assert.throws(() => normalizeContextMapCall({ ...request(), [field]: value }), (error) => (
      error?.code === 'context_map_invalid'
    ));
  }
});

test('CM84-S3: every source and partition substitution changes identity or fails closed', () => {
  const baseline = normalizeContextMapCall(request());
  const mutations = [
    (value) => { value.source.cellId = `cell:${sha('a')}`; },
    (value) => { value.source.outputRef.digest = sha('a'); value.source.outputRef.handle = `art:sha256:${sha('a')}`; },
    (value) => { value.source.evidenceRef.digest = sha('a'); value.source.evidenceRef.handle = `art:sha256:${sha('a')}`; },
    (value) => { value.source.predecessorPlan.digest = sha('a'); },
    (value) => { value.source.definitionDigest = sha('a'); },
    (value) => { value.source.treeSha = 'a'.repeat(40); },
    (value) => { value.role = 'reviewer'; },
    (value) => { value.instruction = 'A different exact instruction.'; },
    (value) => { value.partitions[0].itemDigest = sha('a'); },
    (value) => { value.partitions[1].coordinateDigest = sha('a'); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(request());
    mutate(changed);
    assert.notEqual(normalizeContextMapCall(changed).callId, baseline.callId);
  }

  const badHandle = request();
  badHandle.source.outputRef.handle = `art:sha256:${sha('a')}`;
  assert.throws(() => normalizeContextMapCall(badHandle), (error) => (
    error?.code === 'context_map_invalid'
  ));
});

test('CM84-S4: closed Plan-node binding selects one partition and cannot manufacture route authority', () => {
  const call = normalizeContextMapCall(request());
  const binding = contextMapNodeBinding(call, call.partitions[1]);
  assert.deepEqual(normalizeContextMapNodeBinding(binding), binding);
  assert.deepEqual(Object.keys(binding).sort(), [
    'callDigest', 'callId', 'generation', 'instructionDigest', 'kind', 'logicalRole',
    'partition', 'programDigest', 'schemaVersion', 'source',
  ].sort());
  assert.equal(binding.kind, 'context_map_child');
  assert.equal(binding.logicalRole, 'critic');
  assert.equal(binding.partition.partitionId, call.partitions[1].partitionId);
  assert.equal(binding.instructionDigest, digest(call.instruction));

  for (const mutation of [
    { ...binding, model: 'gpt-5.6-sol' },
    { ...binding, effort: 'xhigh' },
    { ...binding, logicalRole: 'builder' },
    { ...binding, callDigest: sha('a') },
    { ...binding, partition: { ...binding.partition, itemDigest: sha('a') } },
  ]) {
    assert.throws(() => normalizeContextMapNodeBinding(mutation), (error) => (
      error?.code === 'context_map_binding_invalid'
    ));
  }
});

test('CM84-S5: one private CAS partition materializes only into the physical provider Brief', () => {
  const values = ['first immutable partition', 'second immutable partition'];
  const input = request();
  input.partitions = values.map((value, index) => ({
    index, itemDigest: digest(value), coordinateDigest: sha(String(index + 1)),
  }));
  const call = contextMapCallIdentity(input);
  const contextCall = contextMapNodeBinding(call, call.partitions[1]);
  const brief = {
    goal: 'Review one partition', constraints: [], pathScope: [], tools: [], outputFormat: '',
    definitionOfDone: 'write a report',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1, usd: 0, wallMin: 1 }, providerTurns: 1,
    capabilities: [], effects: [], contextCall,
  };
  const physical = materializeContextMapBrief(brief, (ref) => {
    assert.deepEqual(ref, call.source.outputRef);
    return {
      schemaVersion: 1, kind: 'baton.context_value', items: values,
      sourceBranches: ['repository'], sourceItems: 2, selectedSourceItems: 2, chunks: 0,
    };
  }, 16_384);
  assert.equal(Object.hasOwn(brief, 'contextInput'), false,
    'durable authoritative Brief must remain reference-only');
  assert.equal(physical.contextInput.value, values[1]);
  assert.equal(physical.contextInput.partitionId, call.partitions[1].partitionId);
  assert.match(physical.contextInput.attachmentDigest, /^[a-f0-9]{64}$/u);
  assert.match(renderBrief(physical, 'codex-v2'), /second immutable partition/u);
  assert.match(renderPrompt(physical), /second immutable partition/u);

  assert.throws(() => materializeContextMapBrief(brief, () => ({
    schemaVersion: 1, kind: 'baton.context_value', items: [values[0], 'substituted'],
  }), 16_384), (error) => error?.code === 'context_map_attachment_integrity');
  assert.throws(() => materializeContextMapBrief(brief, () => ({
    schemaVersion: 1, kind: 'baton.context_value', items: values,
  }), 64), (error) => error?.code === 'context_map_attachment_oversize');
});
