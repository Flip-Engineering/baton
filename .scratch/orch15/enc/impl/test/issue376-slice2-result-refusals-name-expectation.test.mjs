// issue376-slice2-result-refusals-name-expectation.test.mjs — #376 slice 2
// (SYSTEMIC P3): the refusal-teaching pattern from slice 1 (context-call.mjs,
// context-map.mjs) extended to the sibling Context result normalizers:
// context-result.mjs and context-result-lineage.mjs. Every refusal below
// previously ended in a bare "${label} is invalid" with no rule, pattern, byte
// bound, or admitted set. Each pin asserts the refusal states what the field
// "must be" so the caller can fix what it cannot otherwise identify.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContextMapResultLineage,
} from '../src/context-result-lineage.mjs';
import {
  contextProviderResultCapsule, contextProviderResultReference,
  contextRetainedCommitProjection, normalizeContextResultPathScope,
  validateContextProviderResultCapsule, validateContextProviderResultReference,
} from '../src/context-result.mjs';
import {
  buildPureContextOutputLineage,
} from '../src/context-lineage.mjs';
import { contextMapCallIdentity } from '../src/context-map.mjs';
import { contextValueDigest } from '../src/context-program.mjs';

const sha = (character) => character.repeat(64);
const gitSha = (character) => character.repeat(40);

function refusalOf(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error('expected a refusal but none was thrown');
}

function sourceRef(digestChar = 'd') {
  const digest = sha(digestChar);
  return {
    kind: 'context_source', ref: `ctx:sha256:${digest}`, digest,
    mediaType: 'application/json', itemCount: 1,
  };
}

function projection(overrides = {}) {
  return contextRetainedCommitProjection({
    baseSha: gitSha('a'), resultSha: gitSha('b'),
    retainedResultRef: `refs/baton/results/${gitSha('b')}`,
    changedPaths: ['reviews/0.md'], pathScope: ['reviews/**'],
    sourcePolicyDigest: sha('c'), sourceRef: sourceRef(),
    ...overrides,
  });
}

function capsuleInput(overrides = {}) {
  return {
    callId: `context-call:${sha('a')}`, unitId: `context-partition:${sha('b')}`,
    taskId: 'baton-376-slice2-task', taskVersion: 4, terminalEvent: 85,
    childDigest: sha('3'),
    route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    result: projection(), sourceRef: sourceRef(),
    artifactDigest: sha('e'), cleanupDigest: sha('f'),
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// R-a: bounded() refusal on a non-string names the type expectation
// --------------------------------------------------------------------------
test('R-a: path-scope bounded() refusal on non-string names the expectation', () => {
  const error = refusalOf(() => normalizeContextResultPathScope([42]));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must be a string/iu,
    `the refusal must state the type expectation; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-b: bounded() refusal on an over-cap value names the byte bound
// --------------------------------------------------------------------------
test('R-b: path-scope bounded() refusal on over-cap value names the byte bound', () => {
  const error = refusalOf(() => normalizeContextResultPathScope(['x'.repeat(5_000)]));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /at most 4096 bytes/iu,
    `the refusal must name the byte bound; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-c: safePath() refusal on an absolute path names the relative-path rule
// --------------------------------------------------------------------------
test('R-c: changed-path refusal on absolute path names the relative-path rule', () => {
  const error = refusalOf(() => projection({ changedPaths: ['/abs/path.md'] }));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must be a relative path/iu,
    `the refusal must state the relative-path rule; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-d: source-ref refusal names the required shape
// --------------------------------------------------------------------------
test('R-d: source-ref refusal names the required shape', () => {
  const bad = sourceRef();
  bad.digest = sha('e');
  const error = refusalOf(() => projection({ sourceRef: bad }));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must have/iu,
    `the refusal must state what the source ref must have; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-e: capsule authority refusal names the required identity fields
// --------------------------------------------------------------------------
test('R-e: capsule authority refusal names the required identity fields', () => {
  const error = refusalOf(() => contextProviderResultCapsule(
    capsuleInput({ taskVersion: 0 }),
  ));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must have/iu,
    `the refusal must state the required identity; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-f: capsule header refusal names the required header
// --------------------------------------------------------------------------
test('R-f: capsule header refusal names the required header', () => {
  const capsule = contextProviderResultCapsule(capsuleInput());
  const error = refusalOf(() => validateContextProviderResultCapsule({
    ...capsule, kind: 'baton.wrong_kind',
  }));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must have/iu,
    `the refusal must state the required header; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-g: capsule artifact-ref refusal names the required ref shape
// --------------------------------------------------------------------------
test('R-g: capsule artifact-ref refusal names the required ref shape', () => {
  const capsule = contextProviderResultCapsule(capsuleInput());
  const error = refusalOf(() => contextProviderResultReference(capsule, {
    kind: 'wrong_ref', mediaType: 'application/vnd.baton.context-provider-result+json',
    handle: `art:sha256:${capsule.capsuleDigest}`, digest: capsule.capsuleDigest, bytes: 8,
  }));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must have/iu,
    `the refusal must state the required ref shape; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// R-h: provider-result ref header refusal names the required header
// --------------------------------------------------------------------------
test('R-h: provider-result ref header refusal names the required header', () => {
  const capsule = contextProviderResultCapsule(capsuleInput());
  const error = refusalOf(() => validateContextProviderResultReference({
    schemaVersion: 99, kind: 'baton.context_provider_result_ref',
    unitId: capsule.unitId, childDigest: capsule.childDigest,
    capsuleId: capsule.capsuleId, capsuleDigest: capsule.capsuleDigest,
    resultSourceDigest: capsule.resultSourceDigest,
    resultRefDigest: sha('0'), capsuleRef: {},
  }, capsule));
  assert.equal(error.code, 'context_result_integrity');
  assert.match(error.message, /must have/iu,
    `the refusal must state the required header; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// Lineage fixture (one valid build; each pin mutates one branch)
// --------------------------------------------------------------------------
function artifactRef(kind, mediaType, value) {
  const digest = contextValueDigest(value);
  return {
    kind, mediaType, handle: `art:sha256:${digest}`, digest,
    bytes: Buffer.byteLength(JSON.stringify(value)),
  };
}

function lineageFixture() {
  const planDigest = sha('9');
  const cleanupDigest = sha('8');
  const sourceItems = [{ partition: 'alpha' }, { partition: 'beta' }];
  const coordinates = sourceItems.map((item, index) => [{
    branch: 'repository', sourceRef: `ctx:sha256:${sha('1')}`,
    sourceDigest: sha('1'), itemIndex: index, itemDigest: contextValueDigest(item),
  }]);
  const sourceLineage = buildPureContextOutputLineage(sourceItems, coordinates);
  const sourceOutput = {
    schemaVersion: 1, kind: 'baton.context_value', items: sourceItems,
    sourceBranches: ['repository'], sourceItems: 2, selectedSourceItems: 2, chunks: 2,
  };
  const sourceOutputRef = artifactRef(
    'context_value', 'application/vnd.baton.context-value+json', sourceOutput,
  );
  const sourceEvidence = {
    schemaVersion: 2, kind: 'baton.context_cell_evidence',
    cellId: `cell:${sha('2')}`, manifestDigest: sha('3'), programDigest: sha('4'),
    environmentDigest: sha('5'), policyDigest: sha('6'), providerEffects: 0,
    outputRef: sourceOutputRef, sourceBranches: ['repository'], sourceItems: 2,
    selectedSourceItems: 2, ...sourceLineage,
  };
  const sourceEvidenceRef = artifactRef(
    'context_evidence', 'application/vnd.baton.context-cell-evidence+json', sourceEvidence,
  );
  const call = contextMapCallIdentity({
    schemaVersion: 2, kind: 'baton.context_map_call', generation: 1,
    source: {
      repoId: 'repo-376-slice2', runId: 'run-376-slice2',
      sessionId: `context-session:${sha('7')}`, cellId: sourceEvidence.cellId,
      cellAdmissionDigest: sha('a'), cellSettlementDigest: sha('b'),
      manifestDigest: sourceEvidence.manifestDigest,
      sourceProgramDigest: sourceEvidence.programDigest,
      coordinateDigest: sourceLineage.coordinateDigest,
      outputLineageDigest: sourceLineage.outputLineageDigest,
      outputRef: sourceOutputRef, evidenceRef: sourceEvidenceRef,
      predecessorPlan: { planId: `plan:${sha('c')}`, version: 2, digest: sha('d') },
      definitionDigest: sha('e'), profileDigest: sha('f'), treeSha: gitSha('1'),
      environmentDigest: sourceEvidence.environmentDigest,
      policyDigest: sourceEvidence.policyDigest,
    },
    role: 'critic', instruction: 'Produce one grounded report for this partition.',
    partitions: sourceLineage.outputLineages.map((lineage) => ({
      index: lineage.index, itemDigest: lineage.itemDigest,
      coordinateDigest: lineage.coordinateDigest, lineageDigest: lineage.lineageDigest,
    })),
  });
  const children = call.partitions.map((partition, index) => {
    const core = {
      schemaVersion: 1, partitionId: partition.partitionId,
      partitionDigest: partition.partitionDigest, index, nodeKey: `attempt:critic:${index + 1}`,
      nodeDigest: sha(index === 0 ? '2' : '3'), taskId: `task-376-slice2-${index}`,
      taskVersion: 4, workerId: `worker-376-slice2-${index}`, state: 'accepted',
      terminalEvent: 100 + index,
      route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      resultSha: gitSha(index === 0 ? '2' : '3'), artifactDigest: sha(index === 0 ? '4' : '5'),
      artifacts: [], cleanupDigest,
      resourceRelease: { releaseDigest: sha(index === 0 ? '6' : '7') },
    };
    return { ...core, childDigest: contextValueDigest(core) };
  });
  const capsules = children.map((child, index) => {
    const resultSource = [{ report: index === 0 ? 'alpha finding' : 'beta finding' }];
    const resultSourceDigest = contextValueDigest(resultSource);
    const childSourceRef = {
      kind: 'context_source', ref: `ctx:sha256:${resultSourceDigest}`,
      digest: resultSourceDigest, mediaType: 'application/json', itemCount: 1,
    };
    const result = contextRetainedCommitProjection({
      baseSha: call.source.treeSha, resultSha: child.resultSha,
      retainedResultRef: `refs/baton/results/${child.resultSha}`,
      changedPaths: [`reviews/${index}.md`], pathScope: ['reviews/**'],
      sourcePolicyDigest: sha('0'), sourceRef: childSourceRef,
    });
    return contextProviderResultCapsule({
      callId: call.callId, unitId: child.partitionId,
      taskId: child.taskId, taskVersion: child.taskVersion,
      terminalEvent: child.terminalEvent, childDigest: child.childDigest,
      route: child.route, artifactDigest: child.artifactDigest, cleanupDigest,
      result, sourceRef: childSourceRef,
    });
  });
  const providerResults = capsules.map((capsule) => contextProviderResultReference(
    capsule,
    artifactRef(
      'context_provider_result',
      'application/vnd.baton.context-provider-result+json',
      capsule,
    ),
  ));
  return {
    call, children, providerResults, capsules, sourceOutput, sourceEvidence,
    planDigest, cleanupDigest,
  };
}

// --------------------------------------------------------------------------
// L-a: lineage bounded() refusal on an empty id names the expectation
// --------------------------------------------------------------------------
test('L-a: lineage bounded() refusal on empty child id names the expectation', () => {
  const f = lineageFixture();
  const children = structuredClone(f.children);
  children[0].nodeKey = '';
  const error = refusalOf(() => buildContextMapResultLineage({ ...f, children }));
  assert.equal(error.code, 'context_result_lineage_invalid');
  assert.match(error.message, /must be non-empty/iu,
    `the refusal must state the non-empty expectation; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// L-b: source-artifact refusal names the required schema contract
// --------------------------------------------------------------------------
test('L-b: source-artifact refusal names the required schema contract', () => {
  const f = lineageFixture();
  const error = refusalOf(() => buildContextMapResultLineage({
    ...f, sourceOutput: { ...f.sourceOutput, schemaVersion: 99 },
  }));
  assert.equal(error.code, 'context_result_lineage_invalid');
  assert.match(error.message, /must have/iu,
    `the refusal must state the required schema contract; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// L-c: accepted-child refusal names the required child shape
// --------------------------------------------------------------------------
test('L-c: accepted-child refusal names the required child shape', () => {
  const f = lineageFixture();
  const children = structuredClone(f.children);
  children[0].state = 'rejected';
  const error = refusalOf(() => buildContextMapResultLineage({ ...f, children }));
  assert.equal(error.code, 'context_result_lineage_invalid');
  assert.match(error.message, /must have/iu,
    `the refusal must state the required child shape; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// L-d: lineage authority refusal names the digest expectation
// --------------------------------------------------------------------------
test('L-d: lineage authority refusal names the digest expectation', () => {
  const f = lineageFixture();
  const error = refusalOf(() => buildContextMapResultLineage({
    ...f, planDigest: 'not-a-digest',
  }));
  assert.equal(error.code, 'context_result_lineage_invalid');
  assert.match(error.message, /must carry 64-hex/iu,
    `the refusal must state the digest expectation; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// L-e: lineage call refusal names the schemaVersion 2 self-normalizing rule
// --------------------------------------------------------------------------
test('L-e: lineage call refusal names the schemaVersion 2 rule', () => {
  const f = lineageFixture();
  const mapSource = {
    repoId: 'repo-376', runId: 'run-376',
    sessionId: `context-session:${sha('c')}`,
    cellId: `cell:${sha('7')}`,
    cellAdmissionDigest: sha('8'), cellSettlementDigest: sha('9'),
    coordinateDigest: sha('c'),
    manifestDigest: sha('d'), treeSha: gitSha('e'), environmentDigest: sha('f'),
    policyDigest: sha('1'), definitionDigest: sha('2'),
    profileDigest: sha('4'), sourceProgramDigest: sha('5'),
    outputRef: artifactRef('context_value', 'application/vnd.baton.context-value+json', 'a'),
    evidenceRef: artifactRef(
      'context_evidence', 'application/vnd.baton.context-cell-evidence+json', 'b',
    ),
    predecessorPlan: { planId: `plan:${sha('5')}`, version: 1, digest: sha('6') },
  };
  const error = refusalOf(() => buildContextMapResultLineage({
    ...f,
    call: {
      schemaVersion: 1, kind: 'baton.context_map_call', generation: 1,
      source: mapSource, role: 'critic', instruction: 'Review this input.',
      partitions: [
        { index: 0, itemDigest: sha('a'), coordinateDigest: sha('b') },
        { index: 1, itemDigest: sha('c'), coordinateDigest: sha('d') },
      ],
    },
  }));
  assert.equal(error.code, 'context_result_lineage_invalid');
  assert.match(error.message, /schemaVersion 2/iu,
    `the refusal must state the schemaVersion 2 rule; got: ${error.message}`);
});
