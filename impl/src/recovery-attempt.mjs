import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,4096}$/u;
const STATES = new Set(['not_started', 'attached', 'closed', 'unknown']);

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function closed(value, fields) {
  return record(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}
function validDigest(value) { return typeof value === 'string' && DIGEST.test(value); }
function invalid(message) { throw Object.assign(new TypeError(message), { code: 'recovery_attempt_invalid' }); }

function normalizePriorTask(value) {
  if (!closed(value, ['id', 'version', 'terminalEvent']) || !ID.test(value.id ?? '')
    || !Number.isSafeInteger(value.version) || value.version <= 0
    || !Number.isSafeInteger(value.terminalEvent) || value.terminalEvent <= 0) invalid('recovery prior task binding is invalid');
  return { id: value.id, version: value.version, terminalEvent: value.terminalEvent };
}

function normalizeVerifiedOwner(value) {
  if (!closed(value, ['workerId', 'evidence']) || !ID.test(value.workerId ?? '')
    || !closed(value.evidence, ['coordinationSeq'])
    || !Number.isSafeInteger(value.evidence.coordinationSeq) || value.evidence.coordinationSeq <= 0) {
    invalid('recovery verified owner binding is invalid');
  }
  return { workerId: value.workerId, evidence: { coordinationSeq: value.evidence.coordinationSeq } };
}

function normalizeSession(value) {
  if (!closed(value, ['idDigest', 'contextDigest', 'nextProcessGeneration'])
    || !validDigest(value.idDigest) || !validDigest(value.contextDigest)
    || !Number.isSafeInteger(value.nextProcessGeneration) || value.nextProcessGeneration <= 0) {
    invalid('recovery session binding is invalid');
  }
  return clone(value);
}

function normalizeRoute(value) {
  if (!closed(value, ['tupleKey', 'adapterCardDigest', 'modelPolicyDigest'])
    || typeof value.tupleKey !== 'string' || value.tupleKey.length === 0 || Buffer.byteLength(value.tupleKey) > 4096
    || !validDigest(value.adapterCardDigest) || !validDigest(value.modelPolicyDigest)) {
    invalid('recovery route binding is invalid');
  }
  return clone(value);
}

function normalizeWorkerPolicy(value) {
  if (value === null) return null;
  if (!closed(value, ['requestDigest', 'resolutionDigest', 'adapterCardDigest'])
    || !validDigest(value.requestDigest) || !validDigest(value.resolutionDigest)
    || !validDigest(value.adapterCardDigest)) invalid('recovery worker policy binding is invalid');
  return clone(value);
}

function normalizeAuthority(value) {
  if (!closed(value, ['gateDigest', 'profileDigest', 'recoveryPolicyDigest'])
    || !validDigest(value.gateDigest) || !validDigest(value.profileDigest)
    || !validDigest(value.recoveryPolicyDigest)) invalid('recovery authority binding is invalid');
  return clone(value);
}

export function recoveryAttemptSeriesId(fields) {
  return `recovery-series:${digest({
    schemaVersion: 1,
    repoId: fields.repoId,
    runId: fields.runId ?? null,
    priorTaskId: fields.priorTask.id,
    workerId: fields.verifiedOwner.workerId,
    sessionIdDigest: fields.session.idDigest,
    sessionContextDigest: fields.session.contextDigest,
  })}`;
}

export function normalizeRecoveryAttemptAdmission(value) {
  const fields = [
    'schemaVersion', 'scope', 'repoId', 'runId', 'seriesId', 'attemptId', 'attempt', 'maxAttempts',
    'expectedAttemptHeadEvent', 'priorTask', 'recoveryTaskId', 'verifiedOwner', 'session', 'route',
    'workerPolicy', 'authority', 'requestDigest', 'admissionDigest',
  ];
  if (!closed(value, fields) || value.schemaVersion !== 1 || value.scope !== 'session_recovery'
    || !ID.test(value.repoId ?? '') || (value.runId !== null && !ID.test(value.runId ?? ''))
    || !Number.isSafeInteger(value.attempt) || value.attempt <= 0
    || !Number.isSafeInteger(value.maxAttempts) || value.maxAttempts <= 0 || value.maxAttempts > 1_000_000
    || (value.expectedAttemptHeadEvent !== null
      && (!Number.isSafeInteger(value.expectedAttemptHeadEvent) || value.expectedAttemptHeadEvent <= 0))) {
    invalid('recovery attempt admission is invalid');
  }
  const core = {
    schemaVersion: 1,
    scope: value.scope,
    repoId: value.repoId,
    runId: value.runId,
    attempt: value.attempt,
    maxAttempts: value.maxAttempts,
    expectedAttemptHeadEvent: value.expectedAttemptHeadEvent,
    priorTask: normalizePriorTask(value.priorTask),
    verifiedOwner: normalizeVerifiedOwner(value.verifiedOwner),
    session: normalizeSession(value.session),
    route: normalizeRoute(value.route),
    workerPolicy: normalizeWorkerPolicy(value.workerPolicy),
    authority: normalizeAuthority(value.authority),
  };
  const seriesId = recoveryAttemptSeriesId(core);
  const recoveryTaskId = `recovery:${digest({
    seriesId,
    attempt: core.attempt,
    priorTask: core.priorTask,
    verifiedOwner: core.verifiedOwner,
    session: core.session,
    route: core.route,
    workerPolicy: core.workerPolicy,
    authority: core.authority,
  })}`;
  const attemptId = `recovery-attempt:${digest({ seriesId, attempt: core.attempt, recoveryTaskId })}`;
  const requestCore = { ...core, seriesId, attemptId, recoveryTaskId };
  const requestDigest = digest(requestCore);
  const normalized = { ...requestCore, requestDigest };
  const admissionDigest = digest(normalized);
  if (value.seriesId !== seriesId || value.recoveryTaskId !== recoveryTaskId || value.attemptId !== attemptId
    || value.requestDigest !== requestDigest || value.admissionDigest !== admissionDigest) {
    invalid('recovery attempt derived identity is invalid');
  }
  return Object.freeze({ ...normalized, admissionDigest });
}

export function createRecoveryAttemptAdmission(fields) {
  const core = {
    schemaVersion: 1,
    scope: 'session_recovery',
    repoId: fields.repoId,
    runId: fields.runId ?? null,
    attempt: fields.attempt,
    maxAttempts: fields.maxAttempts,
    expectedAttemptHeadEvent: fields.expectedAttemptHeadEvent ?? null,
    priorTask: clone(fields.priorTask),
    verifiedOwner: clone(fields.verifiedOwner),
    session: clone(fields.session),
    route: clone(fields.route),
    workerPolicy: clone(fields.workerPolicy ?? null),
    authority: clone(fields.authority),
  };
  const seriesId = recoveryAttemptSeriesId(core);
  const recoveryTaskId = `recovery:${digest({
    seriesId, attempt: core.attempt, priorTask: core.priorTask, verifiedOwner: core.verifiedOwner,
    session: core.session, route: core.route, workerPolicy: core.workerPolicy, authority: core.authority,
  })}`;
  const attemptId = `recovery-attempt:${digest({ seriesId, attempt: core.attempt, recoveryTaskId })}`;
  const requestCore = { ...core, seriesId, attemptId, recoveryTaskId };
  const requestDigest = digest(requestCore);
  const normalized = { ...requestCore, requestDigest };
  return normalizeRecoveryAttemptAdmission({ ...normalized, admissionDigest: digest(normalized) });
}

export function normalizeRecoveryAttemptCompletion(value) {
  if (!closed(value, ['schemaVersion', 'attemptId', 'admissionDigest', 'state', 'receipt', 'receiptDigest'])
    || value.schemaVersion !== 1 || !/^recovery-attempt:[a-f0-9]{64}$/u.test(value.attemptId ?? '')
    || !validDigest(value.admissionDigest) || !STATES.has(value.state)
    || !closed(value.receipt, ['schemaVersion', 'effectStarted', 'transportDisposition'])
    || value.receipt.schemaVersion !== 1 || typeof value.receipt.effectStarted !== 'boolean'
    || !['not_started', 'attached', 'closed', 'unknown'].includes(value.receipt.transportDisposition)
    || value.receipt.effectStarted !== (value.state !== 'not_started')
    || value.receipt.transportDisposition !== value.state
    || !validDigest(value.receiptDigest)) invalid('recovery attempt completion is invalid');
  const core = {
    schemaVersion: 1,
    attemptId: value.attemptId,
    admissionDigest: value.admissionDigest,
    state: value.state,
    receipt: clone(value.receipt),
  };
  if (value.receiptDigest !== digest(core.receipt)) invalid('recovery attempt completion receipt digest is invalid');
  return Object.freeze({ ...core, receiptDigest: value.receiptDigest });
}

export function createRecoveryAttemptCompletion(fields) {
  const core = {
    schemaVersion: 1,
    attemptId: fields.attemptId,
    admissionDigest: fields.admissionDigest,
    state: fields.state,
    receipt: clone(fields.receipt),
  };
  return normalizeRecoveryAttemptCompletion({ ...core, receiptDigest: digest(core.receipt) });
}
