import {
  canonicalContextCoordinates, contextLineageDigest, validatePureContextOutputLineage,
} from './context-lineage.mjs';
import { normalizeContextMapCall } from './context-map.mjs';
import {
  validateContextProviderResultCapsule, validateContextProviderResultReference,
} from './context-result.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const BUILD_FIELDS = Object.freeze([
  'call', 'capsules', 'children', 'cleanupDigest', 'planDigest', 'providerResults',
  'sourceEvidence', 'sourceOutput',
]);
const VALIDATE_FIELDS = Object.freeze([
  ...BUILD_FIELDS, 'coordinateDigest', 'outputLineageDigest', 'outputLineages',
  'sourceCoordinates',
]);
const OUTPUT_FIELDS = Object.freeze([
  'chunks', 'items', 'kind', 'schemaVersion', 'selectedSourceItems', 'sourceBranches',
  'sourceItems',
]);
const SOURCE_EVIDENCE_FIELDS = Object.freeze([
  'cellId', 'coordinateDigest', 'environmentDigest', 'kind', 'manifestDigest',
  'outputLineageDigest', 'outputLineages', 'outputRef', 'policyDigest', 'programDigest',
  'providerEffects', 'schemaVersion', 'selectedSourceItems', 'sourceBranches',
  'sourceCoordinates', 'sourceItems',
]);
const ARTIFACT_FIELDS = Object.freeze(['bytes', 'digest', 'handle', 'kind', 'mediaType']);
const ACCEPTED_CHILD_FIELDS = Object.freeze([
  'artifactDigest', 'artifacts', 'childDigest', 'cleanupDigest', 'index', 'nodeDigest',
  'nodeKey', 'partitionDigest', 'partitionId', 'resourceRelease', 'resultSha', 'route',
  'schemaVersion', 'state', 'taskId', 'taskVersion', 'terminalEvent', 'workerId',
]);
const ROUTE_FIELDS = Object.freeze(['effort', 'harness', 'model']);

function resultLineageError(message, cause = undefined) {
  return Object.assign(new TypeError(message), {
    code: 'context_result_lineage_invalid',
    ...(cause === undefined ? {} : { cause }),
  });
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw resultLineageError(`${label} is malformed`);
  }
}

function canonical(value, active = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw resultLineageError('Context result lineage is not JSON');
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object' || active.has(value)) {
    throw resultLineageError('Context result lineage is not JSON');
  }
  active.add(value);
  let normalized;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/u.test(key)
      || Number(key) >= value.length)
      || Array.from({ length: value.length }, (_, index) => index)
        .some((index) => !Object.hasOwn(value, index))) {
      throw resultLineageError('Context result lineage contains a sparse or decorated array');
    }
    normalized = value.map((entry) => canonical(entry, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw resultLineageError('Context result lineage contains a non-JSON object');
    }
    normalized = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, canonical(value[key], active),
    ]));
  }
  active.delete(value);
  return normalized;
}

function stable(value) { return JSON.stringify(canonical(value)); }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function bounded(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || Buffer.byteLength(value) > 512) {
    throw resultLineageError(`${label} is invalid`);
  }
  return value;
}

function artifactRef(value, expectedKind, expectedMediaType, content, label) {
  exact(value, ARTIFACT_FIELDS, label);
  const digest = contextLineageDigest(content);
  if (value.kind !== expectedKind || value.mediaType !== expectedMediaType
    || value.digest !== digest || value.handle !== `art:sha256:${digest}`
    || value.bytes !== Buffer.byteLength(stable(content)) || value.bytes <= 0) {
    throw resultLineageError(`${label} differs from its content`);
  }
  return canonical(value);
}

function sourceArtifacts(call, sourceOutputValue, sourceEvidenceValue) {
  exact(sourceOutputValue, OUTPUT_FIELDS, 'Context map source output');
  exact(sourceEvidenceValue, SOURCE_EVIDENCE_FIELDS, 'Context map source evidence');
  const sourceOutput = canonical(sourceOutputValue);
  const sourceEvidence = canonical(sourceEvidenceValue);
  if (sourceOutput.schemaVersion !== 1 || sourceOutput.kind !== 'baton.context_value'
    || !Array.isArray(sourceOutput.items) || !Array.isArray(sourceOutput.sourceBranches)
    || !Number.isSafeInteger(sourceOutput.sourceItems) || sourceOutput.sourceItems < 0
    || !Number.isSafeInteger(sourceOutput.selectedSourceItems)
    || sourceOutput.selectedSourceItems < 0
    || !Number.isSafeInteger(sourceOutput.chunks) || sourceOutput.chunks < 0
    || sourceEvidence.schemaVersion !== 2
    || sourceEvidence.kind !== 'baton.context_cell_evidence'
    || sourceEvidence.cellId !== call.source.cellId
    || sourceEvidence.manifestDigest !== call.source.manifestDigest
    || sourceEvidence.programDigest !== call.source.sourceProgramDigest
    || sourceEvidence.environmentDigest !== call.source.environmentDigest
    || sourceEvidence.policyDigest !== call.source.policyDigest
    || sourceEvidence.providerEffects !== 0
    || stable(sourceEvidence.sourceBranches) !== stable(sourceOutput.sourceBranches)
    || sourceEvidence.sourceItems !== sourceOutput.sourceItems
    || sourceEvidence.selectedSourceItems !== sourceOutput.selectedSourceItems) {
    throw resultLineageError('Context map source artifacts are invalid');
  }
  const outputRef = artifactRef(
    call.source.outputRef, 'context_value',
    'application/vnd.baton.context-value+json', sourceOutput, 'Context map source output ref',
  );
  const evidenceRef = artifactRef(
    call.source.evidenceRef, 'context_evidence',
    'application/vnd.baton.context-cell-evidence+json', sourceEvidence,
    'Context map source evidence ref',
  );
  if (stable(sourceEvidence.outputRef) !== stable(outputRef)
    || sourceEvidence.coordinateDigest !== call.source.coordinateDigest
    || sourceEvidence.outputLineageDigest !== call.source.outputLineageDigest) {
    throw resultLineageError('Context map source authority changed');
  }
  const lineage = validatePureContextOutputLineage({
    items: sourceOutput.items,
    outputLineages: sourceEvidence.outputLineages,
    outputLineageDigest: sourceEvidence.outputLineageDigest,
    sourceCoordinates: sourceEvidence.sourceCoordinates,
    coordinateDigest: sourceEvidence.coordinateDigest,
  });
  if (sourceOutput.items.length !== call.partitions.length
    || lineage.outputLineages.length !== call.partitions.length
    || call.partitions.some((partition, index) => (
      partition.index !== index
      || partition.itemDigest !== contextLineageDigest(sourceOutput.items[index])
      || partition.itemDigest !== lineage.outputLineages[index].itemDigest
      || partition.coordinateDigest !== lineage.outputLineages[index].coordinateDigest
      || partition.lineageDigest !== lineage.outputLineages[index].lineageDigest
    ))) {
    throw resultLineageError('Context map source partition binding changed');
  }
  return { sourceOutput, sourceEvidence, evidenceRef };
}

function acceptedChild(value, partition, cleanupDigest) {
  exact(value, ACCEPTED_CHILD_FIELDS, 'Context map accepted child');
  exact(value.route, ROUTE_FIELDS, 'Context map accepted child route');
  if (value.schemaVersion !== 1 || value.state !== 'accepted'
    || value.partitionId !== partition.partitionId
    || value.partitionDigest !== partition.partitionDigest || value.index !== partition.index
    || !DIGEST.test(value.nodeDigest ?? '') || !DIGEST.test(value.artifactDigest ?? '')
    || value.cleanupDigest !== cleanupDigest || !DIGEST.test(value.cleanupDigest ?? '')
    || !GIT_SHA.test(value.resultSha ?? '')
    || !Number.isSafeInteger(value.taskVersion) || value.taskVersion <= 0
    || !Number.isSafeInteger(value.terminalEvent) || value.terminalEvent <= 0
    || !Array.isArray(value.artifacts) || !value.resourceRelease
    || typeof value.resourceRelease !== 'object' || Array.isArray(value.resourceRelease)
    || !DIGEST.test(value.resourceRelease.releaseDigest ?? '')) {
    throw resultLineageError('Context map accepted child is invalid');
  }
  for (const [candidate, label] of [
    [value.nodeKey, 'Context map child node'], [value.taskId, 'Context map child task'],
    [value.workerId, 'Context map child worker'],
  ]) bounded(candidate, label);
  for (const field of ROUTE_FIELDS) bounded(value.route[field], `Context map route ${field}`);
  const core = Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'childDigest'));
  if (value.childDigest !== contextLineageDigest(core)) {
    throw resultLineageError('Context map accepted child identity changed');
  }
  return canonical(value);
}

function build(value) {
  exact(value, BUILD_FIELDS, 'Context map result lineage input');
  if (!DIGEST.test(value.planDigest ?? '') || !DIGEST.test(value.cleanupDigest ?? '')) {
    throw resultLineageError('Context map result lineage authority is invalid');
  }
  const call = normalizeContextMapCall(value.call);
  if (call.schemaVersion !== 2 || stable(call) !== stable(value.call)) {
    throw resultLineageError('Context map result lineage call is invalid');
  }
  const { sourceOutput, sourceEvidence, evidenceRef } = sourceArtifacts(
    call, value.sourceOutput, value.sourceEvidence,
  );
  if (!Array.isArray(value.children) || !Array.isArray(value.providerResults)
    || !Array.isArray(value.capsules)
    || value.children.length !== call.partitions.length
    || value.providerResults.length !== call.partitions.length
    || value.capsules.length !== call.partitions.length) {
    throw resultLineageError('Context map result lineage set is incomplete');
  }

  const outputLineages = call.partitions.map((partition, index) => {
    const source = sourceEvidence.outputLineages[index];
    const child = acceptedChild(value.children[index], partition, value.cleanupDigest);
    const capsule = validateContextProviderResultCapsule(value.capsules[index]);
    const providerResult = validateContextProviderResultReference(
      value.providerResults[index], capsule,
    );
    if (providerResult.unitId !== partition.partitionId
      || providerResult.childDigest !== child.childDigest
      || providerResult.capsuleId !== capsule.capsuleId
      || providerResult.capsuleDigest !== capsule.capsuleDigest
      || providerResult.resultSourceDigest !== capsule.resultSourceDigest
      || capsule.callId !== call.callId || capsule.unitId !== partition.partitionId
      || capsule.taskId !== child.taskId || capsule.taskVersion !== child.taskVersion
      || capsule.terminalEvent !== child.terminalEvent
      || capsule.childDigest !== child.childDigest
      || stable(capsule.route) !== stable(child.route)
      || capsule.artifactDigest !== child.artifactDigest
      || capsule.cleanupDigest !== value.cleanupDigest
      || capsule.result.baseSha !== call.source.treeSha
      || capsule.result.resultSha !== child.resultSha
      || capsule.result.retainedResultRef !== `refs/baton/results/${child.resultSha}`) {
      throw resultLineageError('Context map result lineage derivation authority changed');
    }
    const sourceCoordinates = canonicalContextCoordinates(source.sourceCoordinates);
    const itemDigest = contextLineageDigest(providerResult);
    const coordinateDigest = contextLineageDigest(sourceCoordinates);
    const parents = canonical([{
      sourceKind: 'cell_output', sourceId: call.source.cellId,
      sourceSettlementDigest: call.source.cellSettlementDigest,
      outputIndex: index, itemDigest: source.itemDigest,
      lineageDigest: source.lineageDigest, evidenceRef,
    }]);
    const parentDigest = contextLineageDigest(parents);
    const derivations = canonical([{
      kind: 'provider_attempt', callId: call.callId, unitId: child.partitionId,
      planDigest: value.planDigest, nodeDigest: child.nodeDigest,
      taskId: child.taskId, taskVersion: child.taskVersion,
      terminalEvent: child.terminalEvent,
      routeDigest: contextLineageDigest(child.route), artifactDigest: child.artifactDigest,
      resultCapsuleId: capsule.capsuleId, resultCapsuleDigest: capsule.capsuleDigest,
      resultSourceDigest: capsule.resultSourceDigest, cleanupDigest: value.cleanupDigest,
      childDigest: child.childDigest,
    }]);
    const derivationDigest = contextLineageDigest(derivations);
    const lineageDigest = contextLineageDigest({
      schemaVersion: 1, itemDigest, coordinateDigest, parentDigest, derivationDigest,
    });
    return {
      index, itemDigest, sourceCoordinates, coordinateDigest,
      parents, parentDigest, derivations, derivationDigest, lineageDigest,
    };
  });
  const sourceCoordinates = canonicalContextCoordinates(
    outputLineages.flatMap((lineage) => lineage.sourceCoordinates),
  );
  if (contextLineageDigest(sourceCoordinates) !== call.source.coordinateDigest) {
    throw resultLineageError('Context map result coordinate union changed');
  }
  return deepFreeze({
    outputLineages: canonical(outputLineages),
    outputLineageDigest: contextLineageDigest(outputLineages.map((lineage) => ({
      index: lineage.index, itemDigest: lineage.itemDigest, lineageDigest: lineage.lineageDigest,
    }))),
    sourceCoordinates,
    coordinateDigest: contextLineageDigest(sourceCoordinates),
  });
}

export function buildContextMapResultLineage(value) {
  try { return build(value); }
  catch (cause) {
    if (cause?.code === 'context_result_lineage_invalid') throw cause;
    throw resultLineageError(cause?.message ?? 'Context map result lineage is invalid', cause);
  }
}

export function validateContextMapResultLineage(value) {
  try {
    exact(value, VALIDATE_FIELDS, 'Context map result lineage');
    const base = Object.fromEntries(BUILD_FIELDS.map((field) => [field, value[field]]));
    const expected = build(base);
    const supplied = Object.fromEntries([
      'outputLineages', 'outputLineageDigest', 'sourceCoordinates', 'coordinateDigest',
    ].map((field) => [field, value[field]]));
    if (stable(supplied) !== stable(expected)) {
      throw resultLineageError('Context map result lineage changed');
    }
    return expected;
  } catch (cause) {
    if (cause?.code === 'context_result_lineage_invalid') throw cause;
    throw resultLineageError(cause?.message ?? 'Context map result lineage is invalid', cause);
  }
}
