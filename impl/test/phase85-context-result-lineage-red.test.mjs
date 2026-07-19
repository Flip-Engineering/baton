import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContextMapResultLineage, validateContextMapResultLineage,
} from '../src/context-result-lineage.mjs';
import {
  buildPureContextOutputLineage,
} from '../src/context-lineage.mjs';
import { contextMapCallIdentity } from '../src/context-map.mjs';
import {
  contextProviderResultCapsule, contextProviderResultReference,
  contextRetainedCommitProjection,
} from '../src/context-result.mjs';
import { contextValueDigest } from '../src/context-program.mjs';

const sha = (character) => character.repeat(64);
const gitSha = (character) => character.repeat(40);
const planDigest = sha('9');
const cleanupDigest = sha('8');

function artifact(kind, mediaType, value) {
  const digest = contextValueDigest(value);
  return {
    kind, mediaType, handle: `art:sha256:${digest}`, digest,
    bytes: Buffer.byteLength(JSON.stringify(value)),
  };
}

function fixture() {
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
  const sourceOutputRef = artifact(
    'context_value', 'application/vnd.baton.context-value+json', sourceOutput,
  );
  const sourceEvidence = {
    schemaVersion: 2, kind: 'baton.context_cell_evidence',
    cellId: `cell:${sha('2')}`, manifestDigest: sha('3'), programDigest: sha('4'),
    environmentDigest: sha('5'), policyDigest: sha('6'), providerEffects: 0,
    outputRef: sourceOutputRef, sourceBranches: ['repository'], sourceItems: 2,
    selectedSourceItems: 2, ...sourceLineage,
  };
  const sourceEvidenceRef = artifact(
    'context_evidence', 'application/vnd.baton.context-cell-evidence+json', sourceEvidence,
  );
  const call = contextMapCallIdentity({
    schemaVersion: 2, kind: 'baton.context_map_call', generation: 1,
    source: {
      repoId: 'repo-phase85-result-lineage', runId: 'run-phase85-result-lineage',
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
      nodeDigest: sha(index === 0 ? '2' : '3'), taskId: `task-result-lineage-${index}`,
      taskVersion: 4, workerId: `worker-result-lineage-${index}`, state: 'accepted',
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
    const sourceRef = {
      kind: 'context_source', ref: `ctx:sha256:${resultSourceDigest}`,
      digest: resultSourceDigest, mediaType: 'application/json', itemCount: 1,
    };
    const result = contextRetainedCommitProjection({
      baseSha: call.source.treeSha, resultSha: child.resultSha,
      retainedResultRef: `refs/baton/results/${child.resultSha}`,
      changedPaths: [`reviews/${index}.md`], pathScope: ['reviews/**'],
      sourcePolicyDigest: sha('0'), sourceRef,
    });
    return contextProviderResultCapsule({
      callId: call.callId, unitId: child.partitionId,
      taskId: child.taskId, taskVersion: child.taskVersion,
      terminalEvent: child.terminalEvent, childDigest: child.childDigest,
      route: child.route, artifactDigest: child.artifactDigest, cleanupDigest,
      result, sourceRef,
    });
  });
  const providerResults = capsules.map((capsule) => contextProviderResultReference(
    capsule,
    artifact(
      'context_provider_result',
      'application/vnd.baton.context-provider-result+json',
      capsule,
    ),
  ));
  return {
    call, children, providerResults, capsules, sourceOutput, sourceEvidence,
  };
}

test('CRL85-1: map outputs bind exact source parents and provider derivations', () => {
  const f = fixture();
  const lineage = buildContextMapResultLineage({
    ...f, planDigest, cleanupDigest,
  });
  assert.equal(lineage.outputLineages.length, 2);
  assert.deepEqual(lineage.sourceCoordinates, f.sourceEvidence.sourceCoordinates);
  assert.equal(lineage.coordinateDigest, f.sourceEvidence.coordinateDigest);
  for (const [index, output] of lineage.outputLineages.entries()) {
    const source = f.sourceEvidence.outputLineages[index];
    const child = f.children[index];
    const capsule = f.capsules[index];
    assert.equal(output.index, index);
    assert.equal(output.itemDigest, contextValueDigest(f.providerResults[index]));
    assert.deepEqual(output.sourceCoordinates, source.sourceCoordinates);
    assert.deepEqual(output.parents, [{
      sourceKind: 'cell_output', sourceId: f.call.source.cellId,
      sourceSettlementDigest: f.call.source.cellSettlementDigest,
      outputIndex: index, itemDigest: source.itemDigest,
      lineageDigest: source.lineageDigest, evidenceRef: f.call.source.evidenceRef,
    }]);
    assert.deepEqual(output.derivations, [{
      kind: 'provider_attempt', callId: f.call.callId, unitId: child.partitionId,
      planDigest, nodeDigest: child.nodeDigest, taskId: child.taskId,
      taskVersion: child.taskVersion, terminalEvent: child.terminalEvent,
      routeDigest: contextValueDigest(child.route), artifactDigest: child.artifactDigest,
      resultCapsuleId: capsule.capsuleId, resultCapsuleDigest: capsule.capsuleDigest,
      resultSourceDigest: capsule.resultSourceDigest, cleanupDigest,
      childDigest: child.childDigest,
    }]);
  }
  assert.deepEqual(validateContextMapResultLineage({
    ...f, ...lineage, planDigest, cleanupDigest,
  }), lineage);
});

test('CRL85-2: source, child, capsule, parent, derivation, and order substitution fail', () => {
  const f = fixture();
  const lineage = buildContextMapResultLineage({
    ...f, planDigest, cleanupDigest,
  });
  const mutations = [
    (value) => { value.outputLineages[0].itemDigest = sha('0'); },
    (value) => { value.outputLineages[0].sourceCoordinates[0].itemIndex = 1; },
    (value) => { value.outputLineages[0].parents[0].sourceSettlementDigest = sha('0'); },
    (value) => { value.outputLineages[0].derivations[0].planDigest = sha('0'); },
    (value) => { value.outputLineages[0].derivations[0].resultCapsuleDigest = sha('0'); },
    (value) => { value.outputLineages.reverse(); },
    (value) => { value.outputLineages[0].unknown = true; },
    (value) => { value.outputLineageDigest = sha('0'); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(lineage);
    mutate(changed);
    assert.throws(() => validateContextMapResultLineage({
      ...f, ...changed, planDigest, cleanupDigest,
    }), (error) => error?.code === 'context_result_lineage_invalid');
  }
});
