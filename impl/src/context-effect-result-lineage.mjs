import {
  canonicalContextCoordinates, contextLineageDigest, validatePureContextOutputLineage,
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
const GENERIC_SOURCE_EVIDENCE_FIELDS = Object.freeze([
  'call', 'childDigest', 'children', 'cleanup', 'coordinateDigest', 'kind',
  'outputLineageDigest', 'outputLineages', 'outputRef', 'providerEffects',
  'providerResultDigest', 'providerResults', 'schemaVersion', 'sourceCoordinates',
]);
const CELL_SOURCE_EVIDENCE_FIELDS = Object.freeze([
  'cellId', 'coordinateDigest', 'environmentDigest', 'kind', 'manifestDigest',
  'outputLineageDigest', 'outputLineages', 'outputRef', 'policyDigest', 'programDigest',
  'providerEffects', 'schemaVersion', 'selectedSourceItems', 'sourceBranches',
  'sourceCoordinates', 'sourceItems',
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
const EXECUTED_ACCEPTED_CHILD_FIELDS = Object.freeze([
  ...ACCEPTED_CHILD_FIELDS, 'origin',
]);
const INHERITED_CHILD_FIELDS = Object.freeze([
  'childDigest', 'index', 'origin', 'originCallId', 'originChildDigest',
  'resultRefDigest', 'schemaVersion', 'unitDigest', 'unitId',
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
  const generic = sourceEvidenceValue?.schemaVersion === 4;
  exact(sourceEvidenceValue, generic ? GENERIC_SOURCE_EVIDENCE_FIELDS : SOURCE_EVIDENCE_FIELDS,
    'Context reduce source evidence');
  const sourceOutput = canonical(sourceOutputValue);
  const sourceEvidence = canonical(sourceEvidenceValue);
  let sourceCall = null;
  if (generic) {
    try { sourceCall = normalizeContextEffectCall(sourceEvidence.call); }
    catch (cause) { throw resultLineageError('Context reduce generic source call changed', cause); }
  }
  if (sourceOutput.schemaVersion !== 1 || sourceOutput.kind !== 'baton.context_value'
    || !Array.isArray(sourceOutput.items)
    || ![3, 4].includes(sourceEvidence.schemaVersion)
    || sourceEvidence.kind !== 'baton.context_call_evidence'
    || (generic
      ? sourceCall.callId !== call.source.id
        || sourceCall.callDigest !== call.source.callDigest
        || sourceCall.generation !== call.source.generation
        || sourceCall.operator !== 'map'
      : sourceEvidence.callId !== call.source.id
        || sourceEvidence.callDigest !== call.source.callDigest
        || sourceEvidence.generation !== call.source.generation)
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

function cellSourceArtifacts(call, sourceOutputValue, sourceEvidenceValue) {
  exact(sourceOutputValue, OUTPUT_FIELDS, 'Context map source output');
  exact(sourceEvidenceValue, CELL_SOURCE_EVIDENCE_FIELDS, 'Context map source evidence');
  const sourceOutput = canonical(sourceOutputValue);
  const sourceEvidence = canonical(sourceEvidenceValue);
  if (sourceOutput.schemaVersion !== 1 || sourceOutput.kind !== 'baton.context_value'
    || !Array.isArray(sourceOutput.items) || sourceOutput.items.length !== call.source.itemCount
    || sourceEvidence.schemaVersion !== 2
    || sourceEvidence.kind !== 'baton.context_cell_evidence'
    || sourceEvidence.cellId !== call.source.id
    || sourceEvidence.providerEffects !== 0
    || sourceEvidence.outputLineageDigest !== call.source.outputLineageDigest
    || sourceEvidence.coordinateDigest !== call.source.coordinateDigest) {
    throw resultLineageError('Context map source artifacts are invalid');
  }
  const outputRef = artifactRef(
    call.source.outputRef, 'context_value', 'application/vnd.baton.context-value+json',
    sourceOutput, 'Context map source output ref',
  );
  const evidenceRef = artifactRef(
    call.source.evidenceRef, 'context_evidence',
    'application/vnd.baton.context-cell-evidence+json', sourceEvidence,
    'Context map source evidence ref',
  );
  if (stable(sourceEvidence.outputRef) !== stable(outputRef)) {
    throw resultLineageError('Context map source authority changed');
  }
  const lineage = validatePureContextOutputLineage({
    items: sourceOutput.items, outputLineages: sourceEvidence.outputLineages,
    outputLineageDigest: sourceEvidence.outputLineageDigest,
    sourceCoordinates: sourceEvidence.sourceCoordinates,
    coordinateDigest: sourceEvidence.coordinateDigest,
  });
  if (lineage.outputLineages.length !== call.units.length
    || call.units.some((unit, index) => {
      const input = unit.inputs[0]; const source = lineage.outputLineages[index];
      return unit.index !== index || input.index !== index
        || input.itemDigest !== contextLineageDigest(sourceOutput.items[index])
        || input.itemDigest !== source.itemDigest
        || input.lineageDigest !== source.lineageDigest
        || unit.coordinateDigest !== source.coordinateDigest;
    })) {
    throw resultLineageError('Context map source unit binding changed');
  }
  return { sourceOutput, sourceEvidence, evidenceRef };
}

function acceptedChild(value, unit, cleanupDigest) {
  const retried = value?.schemaVersion === 3;
  exact(value, retried ? EXECUTED_ACCEPTED_CHILD_FIELDS : ACCEPTED_CHILD_FIELDS,
    'Context reduce accepted child');
  exact(value.route, ROUTE_FIELDS, 'Context reduce accepted child route');
  if (![2, 3].includes(value.schemaVersion) || (retried && value.origin !== 'executed')
    || value.state !== 'accepted'
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

function inheritedChild(value, unit, call, providerResult, capsule) {
  exact(value, INHERITED_CHILD_FIELDS, 'Context inherited accepted child');
  const binding = call.inheritedChildren.find((candidate) => candidate.unitId === unit.unitId);
  const core = Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'childDigest'));
  if (value.schemaVersion !== 3 || value.origin !== 'inherited'
    || value.unitId !== unit.unitId || value.unitDigest !== unit.unitDigest
    || value.index !== unit.index || value.originCallId !== call.predecessorCall?.callId
    || binding?.originCallId !== value.originCallId
    || binding?.childDigest !== value.originChildDigest
    || value.resultRefDigest !== contextLineageDigest(providerResult)
    || value.childDigest !== contextLineageDigest(core)
    || providerResult.unitId !== unit.unitId
    || providerResult.capsuleId !== capsule.capsuleId
    || providerResult.capsuleDigest !== capsule.capsuleDigest
    || providerResult.resultSourceDigest !== capsule.resultSourceDigest
    || capsule.unitId !== unit.unitId) {
    throw resultLineageError('Context inherited accepted child authority changed');
  }
  return canonical(value);
}

function buildMap(value, call) {
  const { sourceOutput, sourceEvidence, evidenceRef } = cellSourceArtifacts(
    call, value.sourceOutput, value.sourceEvidence,
  );
  if (!Array.isArray(value.children) || !Array.isArray(value.providerResults)
    || !Array.isArray(value.capsules) || value.children.length !== call.units.length
    || value.providerResults.length !== call.units.length
    || value.capsules.length !== call.units.length) {
    throw resultLineageError('Context map result lineage set is incomplete');
  }
  const outputLineages = call.units.map((unit, index) => {
    const source = sourceEvidence.outputLineages[index];
    const capsule = validateContextProviderResultCapsule(value.capsules[index]);
    const providerResult = validateContextProviderResultReference(
      value.providerResults[index], capsule,
    );
    const inherited = value.children[index]?.origin === 'inherited';
    const child = inherited
      ? inheritedChild(value.children[index], unit, call, providerResult, capsule)
      : acceptedChild(value.children[index], unit, value.cleanupDigest);
    if (!inherited && (providerResult.unitId !== unit.unitId
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
      || capsule.result.retainedResultRef !== `refs/baton/results/${child.resultSha}`)) {
      throw resultLineageError('Context map result derivation authority changed');
    }
    const sourceCoordinates = canonicalContextCoordinates(source.sourceCoordinates);
    const itemDigest = contextLineageDigest(providerResult);
    const coordinateDigest = contextLineageDigest(sourceCoordinates);
    const parents = canonical([{
      sourceKind: 'cell_output', sourceId: call.source.id,
      sourceSettlementDigest: call.source.settlementDigest,
      outputIndex: index, itemDigest: source.itemDigest,
      lineageDigest: source.lineageDigest, evidenceRef,
    }]);
    const parentDigest = contextLineageDigest(parents);
    const derivations = canonical([inherited ? {
      kind: 'inherited_provider_result', callId: call.callId, unitId: child.unitId,
      generation: call.generation, retryDigest: call.predecessorCall.retryDigest,
      predecessorCallId: child.originCallId,
      predecessorSettlementDigest: call.predecessorCall.settlementDigest,
      originChildDigest: child.originChildDigest,
      originProviderCallId: capsule.callId,
      resultCapsuleId: capsule.capsuleId, resultCapsuleDigest: capsule.capsuleDigest,
      resultSourceDigest: capsule.resultSourceDigest,
      originCleanupDigest: capsule.cleanupDigest, childDigest: child.childDigest,
    } : {
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
    sourceCoordinates, coordinateDigest: contextLineageDigest(sourceCoordinates),
  });
}

function build(value) {
  exact(value, BUILD_FIELDS, 'Context reduce result lineage input');
  if (!DIGEST.test(value.planDigest ?? '') || !DIGEST.test(value.cleanupDigest ?? '')) {
    throw resultLineageError('Context reduce result lineage authority is invalid');
  }
  const call = normalizeContextEffectCall(value.call);
  if (stable(call) !== stable(value.call)
    || !['map', 'reduce'].includes(call.operator)) {
    throw resultLineageError('Context reduce result lineage call is invalid');
  }
  if (call.operator === 'map') {
    if (call.source.kind !== 'cell') {
      throw resultLineageError('Context map result lineage call is invalid');
    }
    return buildMap(value, call);
  }
  if (call.source.kind !== 'call') {
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
