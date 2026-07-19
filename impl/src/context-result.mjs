import { createHash } from 'node:crypto';

import { pathScopeRegex } from './path-scope.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const CALL_ID = /^context-call:[a-f0-9]{64}$/u;
const UNIT_ID = /^context-(?:partition|unit):[a-f0-9]{64}$/u;
const SOURCE_REF = /^ctx:sha256:([a-f0-9]{64})$/u;
const CAPSULE_ID = /^context-result:([a-f0-9]{64})$/u;
const ARTIFACT_HANDLE = /^art:sha256:([a-f0-9]{64})$/u;
const CAPSULE_FIELDS = Object.freeze([
  'artifactDigest', 'callId', 'capsuleDigest', 'capsuleId', 'childDigest', 'cleanupDigest',
  'kind', 'result', 'resultSourceDigest', 'route', 'routeDigest', 'schemaVersion',
  'sourceRef', 'taskId', 'taskVersion', 'terminalEvent', 'unitId',
]);
const CAPSULE_INPUT_FIELDS = Object.freeze([
  'artifactDigest', 'callId', 'childDigest', 'cleanupDigest', 'result', 'route', 'sourceRef',
  'taskId', 'taskVersion', 'terminalEvent', 'unitId',
]);
const RESULT_FIELDS = Object.freeze([
  'baseSha', 'changedPaths', 'kind', 'pathScope', 'pathScopeDigest', 'projectionDigest',
  'resultSha', 'retainedResultRef', 'sourcePolicyDigest',
]);
const SOURCE_FIELDS = Object.freeze(['digest', 'itemCount', 'kind', 'mediaType', 'ref']);
const RESULT_REF_FIELDS = Object.freeze([
  'capsuleDigest', 'capsuleId', 'capsuleRef', 'childDigest', 'kind', 'resultRefDigest',
  'resultSourceDigest', 'schemaVersion', 'unitId',
]);
const ARTIFACT_REF_FIELDS = Object.freeze(['bytes', 'digest', 'handle', 'kind', 'mediaType']);

function resultError(message) {
  return Object.assign(new TypeError(message), { code: 'context_result_integrity' });
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw resultError(`${label} is malformed`);
  }
}

function canonical(value, active = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw resultError('Context result contains a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object' || active.has(value)) {
    throw resultError('Context result must contain finite JSON data');
  }
  active.add(value);
  let normalized;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/u.test(key)
      || Number(key) >= value.length)
      || Array.from({ length: value.length }, (_, index) => index)
        .some((index) => !Object.hasOwn(value, index))) {
      throw resultError('Context result contains a sparse or decorated array');
    }
    normalized = value.map((entry) => canonical(entry, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw resultError('Context result contains a non-JSON object');
    }
    normalized = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, canonical(value[key], active),
    ]));
  }
  active.delete(value);
  return normalized;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function bounded(value, label, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || Buffer.byteLength(value) > maximum) throw resultError(`${label} is invalid`);
  return value;
}

function safePath(value) {
  bounded(value, 'Context result changed path', 4_096);
  if (/[\u0000-\u001f\u007f]/u.test(value) || value.startsWith('/') || value.includes('\\')
    || value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw resultError('Context result changed path is invalid');
  }
  return value;
}

export function normalizeContextResultPathScope(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_024) {
    throw resultError('Context result path scope is invalid');
  }
  const scopes = value.map((scope) => {
    bounded(scope, 'Context result path scope', 4_096);
    try { pathScopeRegex(scope); }
    catch { throw resultError('Context result path scope is invalid'); }
    return scope;
  });
  return deepFreeze([...new Set(scopes)].sort());
}

function pathScopeDigest(pathScope) {
  return digest({ schemaVersion: 1, kind: 'baton.context_result_path_scope', scopes: pathScope });
}

function normalizeSourceRef(value) {
  exact(value, SOURCE_FIELDS, 'Context result source ref');
  const match = SOURCE_REF.exec(value.ref ?? '');
  if (value.kind !== 'context_source' || value.mediaType !== 'application/json'
    || !DIGEST.test(value.digest ?? '') || !match || match[1] !== value.digest
    || !Number.isSafeInteger(value.itemCount) || value.itemCount <= 0
    || value.itemCount > 1_000_000) {
    throw resultError('Context result source ref is invalid');
  }
  return { ...value };
}

function projectionCore(value, resultSourceDigest) {
  return {
    kind: 'retained_commit_projection', baseSha: value.baseSha, resultSha: value.resultSha,
    retainedResultRef: value.retainedResultRef, changedPaths: value.changedPaths,
    pathScope: value.pathScope, pathScopeDigest: value.pathScopeDigest,
    sourcePolicyDigest: value.sourcePolicyDigest, resultSourceDigest,
  };
}

function normalizeResult(value, resultSourceDigest) {
  exact(value, RESULT_FIELDS, 'Context retained result projection');
  if (value.kind !== 'retained_commit_projection'
    || !GIT_SHA.test(value.baseSha ?? '') || !GIT_SHA.test(value.resultSha ?? '')
    || value.baseSha === value.resultSha
    || value.retainedResultRef !== `refs/baton/results/${value.resultSha}`
    || !Array.isArray(value.changedPaths) || value.changedPaths.length === 0
    || value.changedPaths.length > 100_000 || !DIGEST.test(value.sourcePolicyDigest ?? '')) {
    throw resultError('Context retained result identity is invalid');
  }
  const changedPaths = value.changedPaths.map(safePath);
  const sortedPaths = [...changedPaths].sort();
  if (new Set(changedPaths).size !== changedPaths.length
    || changedPaths.some((path, index) => path !== sortedPaths[index])) {
    throw resultError('Context retained result changed paths are not canonical');
  }
  const pathScope = normalizeContextResultPathScope(value.pathScope);
  const normalized = {
    kind: value.kind, baseSha: value.baseSha, resultSha: value.resultSha,
    retainedResultRef: value.retainedResultRef, changedPaths,
    pathScope, pathScopeDigest: value.pathScopeDigest,
    sourcePolicyDigest: value.sourcePolicyDigest, projectionDigest: value.projectionDigest,
  };
  if (value.pathScopeDigest !== pathScopeDigest(pathScope)
    || value.projectionDigest !== digest(projectionCore(normalized, resultSourceDigest))) {
    throw resultError('Context retained result projection digest changed');
  }
  return normalized;
}

function normalizeRoute(value) {
  exact(value, ['effort', 'harness', 'model'], 'Context result route');
  for (const field of ['harness', 'model', 'effort']) {
    bounded(value[field], `Context route ${field}`, 256);
  }
  return { harness: value.harness, model: value.model, effort: value.effort };
}

function capsuleCore(value) {
  if (!CALL_ID.test(value.callId ?? '') || !UNIT_ID.test(value.unitId ?? '')
    || !/^[A-Za-z0-9._:-]{1,512}$/u.test(value.taskId ?? '')
    || !Number.isSafeInteger(value.taskVersion) || value.taskVersion <= 0
    || !Number.isSafeInteger(value.terminalEvent) || value.terminalEvent <= 0
    || !DIGEST.test(value.childDigest ?? '') || !DIGEST.test(value.artifactDigest ?? '')
    || !DIGEST.test(value.cleanupDigest ?? '')) {
    throw resultError('Context result authority is invalid');
  }
  const sourceRef = normalizeSourceRef(value.sourceRef);
  const resultSourceDigest = digest(sourceRef);
  if (value.resultSourceDigest !== undefined && value.resultSourceDigest !== resultSourceDigest) {
    throw resultError('Context result source digest changed');
  }
  const route = normalizeRoute(value.route);
  const routeDigest = digest(route);
  if (value.routeDigest !== undefined && value.routeDigest !== routeDigest) {
    throw resultError('Context result route digest changed');
  }
  return {
    schemaVersion: 1, kind: 'baton.context_provider_result', callId: value.callId,
    unitId: value.unitId, taskId: value.taskId, taskVersion: value.taskVersion,
    terminalEvent: value.terminalEvent, childDigest: value.childDigest, route, routeDigest,
    artifactDigest: value.artifactDigest, cleanupDigest: value.cleanupDigest,
    result: normalizeResult(value.result, resultSourceDigest), resultSourceDigest, sourceRef,
  };
}

export function contextRetainedCommitProjection({
  baseSha, resultSha, retainedResultRef, changedPaths, pathScope, sourcePolicyDigest, sourceRef,
}) {
  const normalizedSource = normalizeSourceRef(sourceRef);
  const resultSourceDigest = digest(normalizedSource);
  const normalizedScope = normalizeContextResultPathScope(pathScope);
  const partial = {
    kind: 'retained_commit_projection', baseSha, resultSha, retainedResultRef, changedPaths,
    pathScope: normalizedScope, pathScopeDigest: pathScopeDigest(normalizedScope),
    sourcePolicyDigest,
  };
  const projectionDigest = digest(projectionCore(partial, resultSourceDigest));
  return deepFreeze(normalizeResult({ ...partial, projectionDigest }, resultSourceDigest));
}

export function contextProviderResultCapsule(value) {
  exact(value, CAPSULE_INPUT_FIELDS, 'Context provider result input');
  const core = capsuleCore(value);
  const capsuleDigest = digest(core);
  return deepFreeze({ ...core, capsuleId: `context-result:${capsuleDigest}`, capsuleDigest });
}

export function validateContextProviderResultCapsule(value) {
  exact(value, CAPSULE_FIELDS, 'Context provider result capsule');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.context_provider_result'
    || !DIGEST.test(value.capsuleDigest ?? '') || !CAPSULE_ID.test(value.capsuleId ?? '')) {
    throw resultError('Context provider result capsule header is invalid');
  }
  const rebuilt = contextProviderResultCapsule(Object.fromEntries(
    CAPSULE_INPUT_FIELDS.map((field) => [field, value[field]]),
  ));
  if (value.routeDigest !== rebuilt.routeDigest
    || value.resultSourceDigest !== rebuilt.resultSourceDigest
    || value.capsuleDigest !== rebuilt.capsuleDigest || value.capsuleId !== rebuilt.capsuleId
    || digest(value) !== digest(rebuilt)) {
    throw resultError('Context provider result capsule identity changed');
  }
  return rebuilt;
}

function normalizeCapsuleArtifactRef(value, capsule) {
  exact(value, ARTIFACT_REF_FIELDS, 'Context provider result artifact ref');
  const match = ARTIFACT_HANDLE.exec(value.handle ?? '');
  if (value.kind !== 'context_provider_result'
    || value.mediaType !== 'application/vnd.baton.context-provider-result+json'
    || !DIGEST.test(value.digest ?? '') || !match || match[1] !== value.digest
    || !Number.isSafeInteger(value.bytes) || value.bytes <= 0
    || value.digest !== digest(capsule)) {
    throw resultError('Context provider result artifact ref is invalid');
  }
  return { ...value };
}

export function contextProviderResultReference(capsuleValue, capsuleRefValue) {
  const capsule = validateContextProviderResultCapsule(capsuleValue);
  const capsuleRef = normalizeCapsuleArtifactRef(capsuleRefValue, capsule);
  const core = {
    schemaVersion: 1,
    kind: 'baton.context_provider_result_ref',
    unitId: capsule.unitId,
    childDigest: capsule.childDigest,
    capsuleId: capsule.capsuleId,
    capsuleDigest: capsule.capsuleDigest,
    resultSourceDigest: capsule.resultSourceDigest,
    capsuleRef,
  };
  return deepFreeze({ ...core, resultRefDigest: digest(core) });
}

export function validateContextProviderResultReference(value, capsuleValue) {
  exact(value, RESULT_REF_FIELDS, 'Context provider result ref');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.context_provider_result_ref'
    || !UNIT_ID.test(value.unitId ?? '') || !DIGEST.test(value.childDigest ?? '')
    || !CAPSULE_ID.test(value.capsuleId ?? '') || !DIGEST.test(value.capsuleDigest ?? '')
    || !DIGEST.test(value.resultSourceDigest ?? '') || !DIGEST.test(value.resultRefDigest ?? '')) {
    throw resultError('Context provider result ref header is invalid');
  }
  const capsule = validateContextProviderResultCapsule(capsuleValue);
  const rebuilt = contextProviderResultReference(capsule, value.capsuleRef);
  if (value.unitId !== capsule.unitId || value.childDigest !== capsule.childDigest
    || value.capsuleId !== capsule.capsuleId || value.capsuleDigest !== capsule.capsuleDigest
    || value.resultSourceDigest !== capsule.resultSourceDigest
    || value.resultRefDigest !== rebuilt.resultRefDigest
    || digest(value) !== digest(rebuilt)) {
    throw resultError('Context provider result ref identity changed');
  }
  return rebuilt;
}
