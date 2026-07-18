import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const CALL_ID = /^context-call:[a-f0-9]{64}$/u;
const UNIT_ID = /^context-partition:[a-f0-9]{64}$/u;
const SOURCE_REF = /^ctx:sha256:([a-f0-9]{64})$/u;
const CAPSULE_ID = /^context-result:([a-f0-9]{64})$/u;
const CAPSULE_FIELDS = Object.freeze([
  'artifactDigest', 'callId', 'capsuleDigest', 'capsuleId', 'cleanupDigest', 'kind',
  'result', 'resultSourceDigest', 'route', 'schemaVersion', 'sourceRef', 'taskId',
  'taskVersion', 'terminalEvent', 'unitId',
]);
const CAPSULE_INPUT_FIELDS = Object.freeze([
  'artifactDigest', 'callId', 'cleanupDigest', 'result', 'route', 'sourceRef', 'taskId',
  'taskVersion', 'terminalEvent', 'unitId',
]);
const RESULT_FIELDS = Object.freeze([
  'baseSha', 'changedPaths', 'kind', 'projectionDigest', 'resultSha', 'retainedResultRef',
]);
const SOURCE_FIELDS = Object.freeze(['digest', 'itemCount', 'kind', 'mediaType', 'ref']);

function resultError(message) {
  return Object.assign(new TypeError(message), { code: 'context_result_integrity' });
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw resultError(`${label} is malformed`);
  }
}

function json(value, active = new Set()) {
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
    normalized = value.map((entry) => json(entry, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw resultError('Context result contains a non-JSON object');
    }
    normalized = Object.fromEntries(Object.keys(value).sort().map((key) => [
      key, json(value[key], active),
    ]));
  }
  active.delete(value);
  return normalized;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(json(value))).digest('hex');
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

function projectionCore(value, sourceDigest) {
  return {
    kind: 'retained_commit_projection',
    baseSha: value.baseSha,
    resultSha: value.resultSha,
    retainedResultRef: value.retainedResultRef,
    changedPaths: value.changedPaths,
    sourceDigest,
  };
}

function normalizeResult(value, sourceDigest) {
  exact(value, RESULT_FIELDS, 'Context retained result projection');
  if (value.kind !== 'retained_commit_projection'
    || !GIT_SHA.test(value.baseSha ?? '') || !GIT_SHA.test(value.resultSha ?? '')
    || value.baseSha === value.resultSha
    || value.retainedResultRef !== `refs/baton/results/${value.resultSha}`
    || !Array.isArray(value.changedPaths) || value.changedPaths.length === 0
    || value.changedPaths.length > 100_000) {
    throw resultError('Context retained result identity is invalid');
  }
  const changedPaths = value.changedPaths.map(safePath);
  const sorted = [...changedPaths].sort();
  if (new Set(changedPaths).size !== changedPaths.length
    || changedPaths.some((path, index) => path !== sorted[index])) {
    throw resultError('Context retained result changed paths are not canonical');
  }
  const normalized = {
    kind: value.kind, baseSha: value.baseSha, resultSha: value.resultSha,
    retainedResultRef: value.retainedResultRef, changedPaths,
    projectionDigest: value.projectionDigest,
  };
  if (value.projectionDigest !== digest(projectionCore(normalized, sourceDigest))) {
    throw resultError('Context retained result projection digest changed');
  }
  return normalized;
}

function normalizeRoute(value) {
  exact(value, ['effort', 'harness', 'model'], 'Context result route');
  for (const field of ['harness', 'model', 'effort']) bounded(value[field], `Context route ${field}`, 256);
  return { harness: value.harness, model: value.model, effort: value.effort };
}

function capsuleCore(value) {
  if (!CALL_ID.test(value.callId ?? '') || !UNIT_ID.test(value.unitId ?? '')
    || !/^[A-Za-z0-9._:-]{1,512}$/u.test(value.taskId ?? '')
    || !Number.isSafeInteger(value.taskVersion) || value.taskVersion <= 0
    || !Number.isSafeInteger(value.terminalEvent) || value.terminalEvent <= 0
    || !DIGEST.test(value.artifactDigest ?? '') || !DIGEST.test(value.cleanupDigest ?? '')) {
    throw resultError('Context result authority is invalid');
  }
  const sourceRef = normalizeSourceRef(value.sourceRef);
  if (value.resultSourceDigest !== undefined && value.resultSourceDigest !== sourceRef.digest) {
    throw resultError('Context result source digest changed');
  }
  return {
    schemaVersion: 1,
    kind: 'baton.context_provider_result',
    callId: value.callId,
    unitId: value.unitId,
    taskId: value.taskId,
    taskVersion: value.taskVersion,
    terminalEvent: value.terminalEvent,
    route: normalizeRoute(value.route),
    artifactDigest: value.artifactDigest,
    cleanupDigest: value.cleanupDigest,
    result: normalizeResult(value.result, sourceRef.digest),
    resultSourceDigest: sourceRef.digest,
    sourceRef,
  };
}

export function contextRetainedCommitProjection({
  baseSha, resultSha, retainedResultRef, changedPaths, sourceRef,
}) {
  const normalizedSource = normalizeSourceRef(sourceRef);
  const partial = {
    kind: 'retained_commit_projection', baseSha, resultSha, retainedResultRef, changedPaths,
  };
  const projectionDigest = digest(projectionCore(partial, normalizedSource.digest));
  return deepFreeze(normalizeResult({ ...partial, projectionDigest }, normalizedSource.digest));
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
  if (value.capsuleDigest !== rebuilt.capsuleDigest || value.capsuleId !== rebuilt.capsuleId
    || digest(value) !== digest(rebuilt)) {
    throw resultError('Context provider result capsule identity changed');
  }
  return rebuilt;
}
