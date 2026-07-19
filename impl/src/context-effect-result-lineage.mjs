import {
  canonicalContextCoordinates, contextLineageDigest,
} from './context-lineage.mjs';
import { normalizeContextEffectCall } from './context-call.mjs';
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
  'callDigest', 'callId', 'childDigest', 'children', 'cleanup', 'coordinateDigest',
  'generation', 'kind', 'outputLineageDigest', 'outputLineages', 'outputRef', 'partitions',
  'programDigest', 'providerEffects', 'providerResultDigest', 'providerResults',
  'schemaVersion', 'source', 'sourceCoordinates',
]);
const ARTIFACT_FIELDS = Object.freeze(['bytes', 'digest', 'handle', 'kind', 'mediaType']);
const LINEAGE_FIELDS = Object.freeze([
  'coordinateDigest', 'derivationDigest', 'derivations', 'index', 'itemDigest',
  'lineageDigest', 'parentDigest', 'parents', 'sourceCoordinates',
]);
const ACCEPTED_CHILD_FIELDS = Object.freeze([
  'artifactDigest', 'artifacts', 'childDigest', 'cleanupDigest', 'index', 'nodeDigest',
  'nodeKey', 'resourceRelease', 'resultSha', 'route', 'schemaVersion', 'state', 'taskId',
  'taskVersion', 'terminalEvent', 'unitDigest', 'unitId', 'workerId',
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
  exact(sourceOutputValue, OUTPUT_FIELDS, 'Context reduce source output');
  exact(sourceEvidenceValue, SOURCE_EVIDENCE_FIELDS, 'Context reduce source evidence');
  const sourceOutput = canonical(sourceOutputValue);
  const sourceEvidence = canonical(sourceEvidenceValue);
  if (sourceOutput.schemaVersion !== 1 || sourceOutput.kind !== 'baton.context_value'
    || !Array.isArray(sourceOutput.items)
    || sourceEvidence.schemaVersion !== 3
    || sourceEvidence.kind !== 'baton.context_call_evidence'
    || sourceEvidence.callId !== call.source.id
    || sourceEvidence.callDigest !== call.source.callDigest
    || sourceEvidence.generation !== call.source.generation
    || !Array.isArray(sourceEvidence.outputLineages)
    || sourceOutput.items.length !== call.source.itemCount
    || sourceEvidence.outputLineages.length !== call.source.itemCount) {
    throw resultLineageError('Context reduce source artifacts are invalid');
  }
  const outputRef = artifactRef(
    call.source.outputRef, 'context_value', 'application/vnd.baton.context-value+json',
    sourceOutput, 'Context reduce source output ref',
  );
  const evidenceRef = artifactRef(
    call.source.evidenceRef, 'context_call_evidence',
    'application/vnd.baton.context-call-evidence+json', sourceEvidence,
    'Context reduce source evidence ref',
  );
  if (stable(sourceEvidence.outputRef) !== stable(outputRef)
    || sourceEvidence.coordinateDigest !== call.source.coordinateDigest
    || sourceEvidence.outputLineageDigest !== call.source.outputLineageDigest) {
    throw resultLineageError('Context reduce source authority changed');
  }
  for (const [index, lineage] of sourceEvidence.outputLineages.entries()) {
    exact(lineage, LINEAGE_FIELDS, 'Context reduce parent lineage');
    const coordinates = canonicalContextCoordinates(lineage.sourceCoordinates);
    if (lineage.index !== index
      || lineage.itemDigest !== contextLineageDigest(sourceOutput.items[index])
      || stable(coordinates) !== stable(lineage.sourceCoordinates)
      || lineage.coordinateDigest !== contextLineageDigest(coordinates)
      || lineage.parentDigest !== contextLineageDigest(lineage.parents)
      || lineage.derivationDigest !== contextLineageDigest(lineage.derivations)
      || lineage.lineageDigest !== contextLineageDigest({
        schemaVersion: 1, itemDigest: lineage.itemDigest,
        coordinateDigest: lineage.coordinateDigest,
        parentDigest: lineage.parentDigest, derivationDigest: lineage.derivationDigest,
      })) {
      throw resultLineageError('Context reduce parent lineage changed');
    }
  }
  const outputLineageDigest = contextLineageDigest(sourceEvidence.outputLineages.map((lineage) => ({
    index: lineage.index, itemDigest: lineage.itemDigest, lineageDigest: lineage.lineageDigest,
  })));
  const sourceCoordinates = canonicalContextCoordinates(
    sourceEvidence.outputLineages.flatMap((lineage) => lineage.sourceCoordinates),
  );
  if (sourceEvidence.outputLineageDigest !== outputLineageDigest
    || stable(sourceEvidence.sourceCoordinates) !== stable(sourceCoordinates)
    || sourceEvidence.coordinateDigest !== contextLineageDigest(sourceCoordinates)) {
    throw resultLineageError('Context reduce aggregate parent lineage changed');
  }
  return { sourceOutput, sourceEvidence, evidenceRef };
}

function acceptedChild(value, unit, cleanupDigest) {
  exact(value, ACCEPTED_CHILD_FIELDS, 'Context reduce accepted child');
  exact(value.route, ROUTE_FIELDS, 'Context reduce accepted child route');
  if (value.schemaVersion !== 2 || value.state !== 'accepted'
    || value.unitId !== unit.unitId || value.unitDigest !== unit.unitDigest
    || value.index !== unit.index || !DIGEST.test(value.nodeDigest ?? '')
    || !DIGEST.test(value.artifactDigest ?? '') || value.cleanupDigest !== cleanupDigest
    || !DIGEST.test(value.cleanupDigest ?? '') || !GIT_SHA.test(value.resultSha ?? '')
    || !Number.isSafeInteger(value.taskVersion) || value.taskVersion <= 0
    || !Number.isSafeInteger(value.terminalEvent) || value.terminalEvent <= 0
    || !Array.isArray(value.artifacts) || !value.resourceRelease
    || typeof value.resourceRelease !== 'object' || Array.isArray(value.resourceRelease)
    || !DIGEST.test(value.resourceRelease.releaseDigest ?? '')) {
    throw resultLineageError('Context reduce accepted child is invalid');
  }
  for (const [candidate, label] of [
    [value.nodeKey, 'Context reduce child node'], [value.taskId, 'Context reduce child task'],
    [value.workerId, 'Context reduce child worker'],
  ]) bounded(candidate, label);
  for (const field of ROUTE_FIELDS) bounded(value.route[field], `Context reduce route ${field}`);
  const core = Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'childDigest'));
  if (value.childDigest !== contextLineageDigest(core)) {
    throw resultLineageError('Context reduce accepted child identity changed');
  }
  return canonical(value);
}

function build(value) {
  exact(value, BUILD_FIELDS, 'Context reduce result lineage input');
  if (!DIGEST.test(value.planDigest ?? '') || !DIGEST.test(value.cleanupDigest ?? '')) {
    throw resultLineageError('Context reduce result lineage authority is invalid');
  }
  const call = normalizeContextEffectCall(value.call);
  if (call.operator !== 'reduce' || call.source.kind !== 'call'
    || stable(call) !== stable(value.call)) {
    throw resultLineageError('Context reduce result lineage call is invalid');
  }
  const { sourceOutput, sourceEvidence, evidenceRef } = sourceArtifacts(
    call, value.sourceOutput, value.sourceEvidence,
  );
  if (!Array.isArray(value.children) || value.children.length !== 1
    || !Array.isArray(value.providerResults) || value.providerResults.length !== 1
    || !Array.isArray(value.capsules) || value.capsules.length !== 1) {
    throw resultLineageError('Context reduce result lineage set is incomplete');
  }
  const unit = call.units[0];
  const child = acceptedChild(value.children[0], unit, value.cleanupDigest);
  const capsule = validateContextProviderResultCapsule(value.capsules[0]);
  const providerResult = validateContextProviderResultReference(value.providerResults[0], capsule);
  if (providerResult.unitId !== unit.unitId
    || providerResult.childDigest !== child.childDigest
    || providerResult.capsuleId !== capsule.capsuleId
    || providerResult.capsuleDigest !== capsule.capsuleDigest
    || providerResult.resultSourceDigest !== capsule.resultSourceDigest
    || capsule.callId !== call.callId || capsule.unitId !== unit.unitId
    || capsule.taskId !== child.taskId || capsule.taskVersion !== child.taskVersion
    || capsule.terminalEvent !== child.terminalEvent
    || capsule.childDigest !== child.childDigest
    || stable(capsule.route) !== stable(child.route)
    || capsule.artifactDigest !== child.artifactDigest
    || capsule.cleanupDigest !== value.cleanupDigest
    || capsule.result.baseSha !== call.authority.treeSha
    || capsule.result.resultSha !== child.resultSha
    || capsule.result.retainedResultRef !== `refs/baton/results/${child.resultSha}`) {
    throw resultLineageError('Context reduce result derivation authority changed');
  }
  const selected = unit.inputs.map((input) => sourceEvidence.outputLineages[input.index]);
  if (unit.inputs.some((input, index) => (
    input.itemDigest !== sourceEvidence.outputLineages[input.index]?.itemDigest
      || input.lineageDigest !== sourceEvidence.outputLineages[input.index]?.lineageDigest
      || input.index !== index
  ))) {
    throw resultLineageError('Context reduce unit differs from its parent lineage set');
  }
  const sourceCoordinates = canonicalContextCoordinates(
    selected.flatMap((lineage) => lineage.sourceCoordinates),
  );
  const coordinateDigest = contextLineageDigest(sourceCoordinates);
  if (coordinateDigest !== unit.coordinateDigest
    || coordinateDigest !== call.source.coordinateDigest) {
    throw resultLineageError('Context reduce coordinate union changed');
  }
  const parents = canonical(selected.map((lineage, index) => ({
    sourceKind: 'call_output', sourceId: call.source.id,
    sourceCallDigest: call.source.callDigest,
    sourceSettlementDigest: call.source.settlementDigest,
    outputIndex: index, itemDigest: lineage.itemDigest,
    lineageDigest: lineage.lineageDigest, evidenceRef,
  })));
  const parentDigest = contextLineageDigest(parents);
  const derivations = canonical([{
    kind: 'provider_attempt', callId: call.callId, unitId: child.unitId,
    planDigest: value.planDigest, nodeDigest: child.nodeDigest,
    taskId: child.taskId, taskVersion: child.taskVersion,
    terminalEvent: child.terminalEvent,
    routeDigest: contextLineageDigest(child.route), artifactDigest: child.artifactDigest,
    resultCapsuleId: capsule.capsuleId, resultCapsuleDigest: capsule.capsuleDigest,
    resultSourceDigest: capsule.resultSourceDigest, cleanupDigest: value.cleanupDigest,
    childDigest: child.childDigest,
  }]);
  const derivationDigest = contextLineageDigest(derivations);
  const itemDigest = contextLineageDigest(providerResult);
  const lineageDigest = contextLineageDigest({
    schemaVersion: 1, itemDigest, coordinateDigest, parentDigest, derivationDigest,
  });
  const outputLineages = canonical([{
    index: 0, itemDigest, sourceCoordinates, coordinateDigest,
    parents, parentDigest, derivations, derivationDigest, lineageDigest,
  }]);
  return deepFreeze({
    outputLineages,
    outputLineageDigest: contextLineageDigest(outputLineages.map((lineage) => ({
      index: lineage.index, itemDigest: lineage.itemDigest, lineageDigest: lineage.lineageDigest,
    }))),
    sourceCoordinates, coordinateDigest,
  });
}

export function buildContextEffectResultLineage(value) {
  try { return build(value); }
  catch (cause) {
    if (cause?.code === 'context_result_lineage_invalid') throw cause;
    throw resultLineageError(cause?.message ?? 'Context reduce result lineage is invalid', cause);
  }
}

export function validateContextEffectResultLineage(value) {
  try {
    exact(value, VALIDATE_FIELDS, 'Context reduce result lineage');
    const base = Object.fromEntries(BUILD_FIELDS.map((field) => [field, value[field]]));
    const expected = build(base);
    const supplied = Object.fromEntries([
      'outputLineages', 'outputLineageDigest', 'sourceCoordinates', 'coordinateDigest',
    ].map((field) => [field, value[field]]));
    if (stable(supplied) !== stable(expected)) {
      throw resultLineageError('Context reduce result lineage changed');
    }
    return expected;
  } catch (cause) {
    if (cause?.code === 'context_result_lineage_invalid') throw cause;
    throw resultLineageError(cause?.message ?? 'Context reduce result lineage is invalid', cause);
  }
}
