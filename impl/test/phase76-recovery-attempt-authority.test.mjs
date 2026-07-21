// Phase 76 — durable, two-phase recovery-attempt authority.
//
// Recovery is an external effect. Before a harness is asked to attach, the CoordinationStore
// must durably admit one exact attempt against the verified prior owner and the current Run,
// route, session, and deployment authority. A second durable event closes the effect as one of
// four deliberately small states. This suite keeps provider behavior out of the fixture: it is a
// contract for the authority which must exist before any provider call is allowed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationIntegrityError,
  CoordinationStore,
} from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase76-recovery-attempt-${label}-`));
const repoId = 'repo-phase76-recovery-attempt';
const runId = 'run-phase76-recovery-attempt';
const workerId = 'worker-phase76-recovery-attempt';
const priorTaskId = 'prior-phase76-recovery-attempt';
const sessionIdDigest = digest({ nativeSession: 'fixture-session' });
const sessionContextDigest = digest({ worktree: '/redacted/worktree', ownerTaskId: priorTaskId });

const admissionPayloadFields = Object.freeze([
  'admissionDigest', 'attempt', 'attemptId', 'authority', 'expectedAttemptHeadEvent',
  'maxAttempts', 'priorTask', 'recoveryTaskId', 'repoId', 'requestDigest', 'route',
  'runId', 'schemaVersion', 'scope', 'seriesId', 'session', 'verifiedOwner', 'workerPolicy',
].sort());

const completionPayloadFields = Object.freeze([
  'admissionDigest', 'attemptId', 'receipt', 'receiptDigest', 'schemaVersion', 'state',
].sort());

function authFor(request, actor = 'orchestrator') {
  return { actor, key: `recovery.attempt:${request.attemptId}` };
}

function completionAuthFor(request, actor = 'orchestrator') {
  return { actor, key: `recovery.attempt.complete:${request.attemptId}` };
}

function fixture(label) {
  const directory = root(label);
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const store = new CoordinationStore(directory, { operationalRead });
  store.createTask({
    id: priorTaskId,
    brief: { objective: 'Produce a hub-verified result before session recovery' },
    deps: [],
    refines: null,
    relation: 'root',
    runId,
    taskType: 'general',
    reservedWorkerId: workerId,
    vendorRequested: 'claude-code',
    modelRequested: 'kimi-k3',
    modelPolicy: null,
    effortRequested: 'high',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${priorTaskId}` });
  store.claimTask(priorTaskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${priorTaskId}`,
  }, {
    harnessRequested: 'claude-code', harnessResolved: 'claude-code@fixture',
    modelRequested: 'kimi-k3', modelResolved: 'kimi-k3', modelObserved: 'kimi-k3',
    effortRequested: 'high', effortResolved: 'high', effortObserved: 'high',
    routeKey: '["claude-code","fixture","kimi-k3","high"]',
  });
  const verified = {
    worker: workerId,
    seq: 1,
    ts: '2026-07-17T12:00:00.000Z',
    kind: 'verify.reverified',
    actor: 'policy',
    taskId: priorTaskId,
    payload: { accept: true, verdict: { ok: true } },
  };
  operational.set(`${workerId}:1`, verified);
  const mapped = store.mapOperationalEvent(verified, {
    actor: 'policy', key: `evidence:${priorTaskId}:verified`,
  }).evidence;
  store.transitionTask(priorTaskId, 'completed', 2, {
    actor: 'policy', key: `task.completed:${priorTaskId}`,
  }, mapped);
  const priorTask = store.task(priorTaskId);
  return {
    directory, mapped, operational, operationalRead, priorTask, store,
  };
}

function requestFor(f, overrides = {}) {
  const selectedRunId = overrides.runId ?? runId;
  const selectedWorkerId = overrides.workerId ?? workerId;
  const selectedSession = {
    idDigest: overrides.sessionIdDigest ?? sessionIdDigest,
    contextDigest: overrides.sessionContextDigest ?? sessionContextDigest,
    nextProcessGeneration: overrides.nextProcessGeneration ?? 2,
  };
  const seriesCore = {
    schemaVersion: 1,
    repoId: overrides.repoId ?? repoId,
    runId: selectedRunId,
    priorTaskId: overrides.priorTaskId ?? priorTaskId,
    workerId: selectedWorkerId,
    sessionIdDigest: selectedSession.idDigest,
    sessionContextDigest: selectedSession.contextDigest,
  };
  const seriesId = overrides.seriesId ?? `recovery-series:${digest(seriesCore)}`;
  const attempt = overrides.attempt ?? 1;
  const priorTask = {
    id: overrides.priorTaskId ?? priorTaskId,
    version: overrides.priorTaskVersion ?? f.priorTask.version,
    terminalEvent: overrides.priorTaskTerminalEvent ?? f.priorTask.terminalEvent,
  };
  const verifiedOwner = {
    workerId: selectedWorkerId,
    evidence: { coordinationSeq: overrides.verifiedEvidenceSeq ?? f.mapped.coordinationSeq },
  };
  const route = overrides.route ?? {
    tupleKey: '["claude-code","fixture","kimi-k3","high"]',
    adapterCardDigest: digest({ harness: 'claude-code', version: 'fixture' }),
    modelPolicyDigest: digest({ mode: 'exact', model: 'kimi-k3', effort: 'high' }),
  };
  const workerPolicy = Object.hasOwn(overrides, 'workerPolicy') ? overrides.workerPolicy : {
    requestDigest: digest({ permissionMode: 'full', sandbox: 'danger-full-access' }),
    resolutionDigest: digest({ permissionMode: 'full', sandbox: 'danger-full-access', source: 'deployment' }),
    adapterCardDigest: route.adapterCardDigest,
  };
  const authority = overrides.authority ?? {
    gateDigest: digest({ plan: 'phase76', node: 'recover' }),
    profileDigest: digest({ profile: 'phase76-recoverable' }),
    recoveryPolicyDigest: digest({ mode: 'manual', maxAttempts: overrides.maxAttempts ?? 4 }),
  };
  const recoveryTaskId = overrides.recoveryTaskId ?? `recovery:${digest({
    seriesId, attempt, priorTask, verifiedOwner, session: selectedSession,
    route, workerPolicy, authority,
  })}`;
  const attemptId = overrides.attemptId ?? `recovery-attempt:${digest({
    seriesId, attempt, recoveryTaskId,
  })}`;
  const requestCore = {
    schemaVersion: 1,
    scope: overrides.scope ?? 'session_recovery',
    repoId: overrides.repoId ?? repoId,
    runId: selectedRunId,
    seriesId,
    attemptId,
    attempt,
    maxAttempts: overrides.maxAttempts ?? 4,
    expectedAttemptHeadEvent: Object.hasOwn(overrides, 'expectedAttemptHeadEvent')
      ? overrides.expectedAttemptHeadEvent : null,
    priorTask,
    recoveryTaskId,
    verifiedOwner,
    session: selectedSession,
    route,
    workerPolicy,
    authority,
  };
  const requestDigest = overrides.requestDigest ?? digest(requestCore);
  const admissionDigest = overrides.admissionDigest ?? digest({ ...requestCore, requestDigest });
  return { ...requestCore, requestDigest, admissionDigest };
}

function receiptFor(state) {
  const disposition = {
    not_started: { effectStarted: false, transportDisposition: 'not_started' },
    attached: { effectStarted: true, transportDisposition: 'attached' },
    closed: { effectStarted: true, transportDisposition: 'closed' },
    unknown: { effectStarted: true, transportDisposition: 'unknown' },
  }[state];
  if (!disposition) throw new TypeError(`unknown fixture recovery state ${state}`);
  return { schemaVersion: 1, ...disposition };
}

function completionFor(request, state, overrides = {}) {
  const receipt = overrides.receipt ?? receiptFor(state);
  return {
    schemaVersion: 1,
    attemptId: request.attemptId,
    admissionDigest: request.admissionDigest,
    state,
    receipt,
    receiptDigest: overrides.receiptDigest ?? digest(receipt),
  };
}

function nextRequestFor(f, prior, overrides = {}) {
  return requestFor(f, {
    attempt: prior.attempt + 1,
    maxAttempts: prior.maxAttempts,
    seriesId: prior.seriesId,
    expectedAttemptHeadEvent: prior.completedEvent,
    sessionIdDigest: prior.session.idDigest,
    sessionContextDigest: prior.session.contextDigest,
    nextProcessGeneration: prior.session.nextProcessGeneration,
    route: prior.route,
    workerPolicy: prior.workerPolicy,
    authority: prior.authority,
    ...overrides,
  });
}

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

test('RA1: admission is a closed, digest-bound authority record and projects one pending attempt', () => {
  const f = fixture('closed-admission');
  for (const method of [
    'admitRecoveryAttempt', 'completeRecoveryAttempt', 'recoveryAttempt',
    'recoveryAttemptHead', 'pendingRecoveryAttempts',
  ]) assert.equal(typeof f.store[method], 'function', `${method} is part of the store contract`);

  const request = requestFor(f);
  const admitted = f.store.admitRecoveryAttempt(structuredClone(request), authFor(request));
  assert.equal(admitted.result, 'admitted');
  assert.equal(admitted.event.kind, 'recovery.attempt_admitted');
  assert.deepEqual(Object.keys(admitted.event.payload).sort(), admissionPayloadFields);
  assert.deepEqual(admitted.event.payload, request);
  assert.equal(admitted.attempt.state, 'pending');
  assert.equal(admitted.attempt.admittedEvent, admitted.event.seq);
  assert.equal(admitted.attempt.completedEvent, null);
  assert.deepEqual(f.store.recoveryAttempt(request.attemptId), admitted.attempt);
  assert.deepEqual(f.store.recoveryAttemptHead(request.seriesId), admitted.attempt);
  assert.deepEqual(f.store.pendingRecoveryAttempts(), [admitted.attempt]);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.attempt.authority), true);

  for (const malformed of [
    { ...request, extra: true },
    { ...request, requestDigest: '0'.repeat(64) },
    { ...request, admissionDigest: '0'.repeat(64) },
    { ...request, workerPolicy: { ...request.workerPolicy, extra: true } },
    Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'workerPolicy')),
    { ...request, verifiedOwner: { ...request.verifiedOwner, evidence: { coordinationSeq: 0 } } },
  ]) {
    assert.equal(
      refusalCode(() => f.store.admitRecoveryAttempt(malformed, authFor(request))),
      'recovery_attempt_invalid',
    );
  }
  f.store.releaseWriterLease();
});

test('RA2: exact admission/completion retries replay; same key or identity with changed meaning conflicts without appending', () => {
  const f = fixture('idempotency');
  const request = requestFor(f);
  const admitted = f.store.admitRecoveryAttempt(request, authFor(request));
  const replay = f.store.admitRecoveryAttempt(structuredClone(request), authFor(request));
  assert.equal(replay.result, 'replay');
  assert.equal(replay.event.seq, admitted.event.seq);
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(request, authFor(request, 'operator:other'))),
    'recovery_attempt_conflict',
    'idempotency never changes the authority actor',
  );

  const beforeConflict = f.store.snapshot().lastSeq;
  const changedCore = { ...request, maxAttempts: request.maxAttempts + 1 };
  const changed = {
    ...changedCore,
    requestDigest: digest(Object.fromEntries(Object.entries(changedCore)
      .filter(([key]) => !['requestDigest', 'admissionDigest'].includes(key)))),
  };
  changed.admissionDigest = digest(Object.fromEntries(Object.entries(changed)
    .filter(([key]) => key !== 'admissionDigest')));
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(changed, authFor(request))),
    'recovery_attempt_conflict',
  );
  assert.equal(f.store.snapshot().lastSeq, beforeConflict);

  const completion = completionFor(request, 'not_started');
  const completed = f.store.completeRecoveryAttempt(completion, completionAuthFor(request));
  assert.equal(completed.result, 'completed');
  assert.deepEqual(Object.keys(completed.event.payload).sort(), completionPayloadFields);
  const completionReplay = f.store.completeRecoveryAttempt(
    structuredClone(completion), completionAuthFor(request),
  );
  assert.equal(completionReplay.result, 'replay');
  assert.equal(completionReplay.event.seq, completed.event.seq);
  assert.equal(
    refusalCode(() => f.store.completeRecoveryAttempt(
      completion, completionAuthFor(request, 'operator:other'),
    )),
    'recovery_attempt_conflict',
    'completion preserves the admitting actor',
  );

  assert.equal(
    refusalCode(() => f.store.completeRecoveryAttempt(
      completionFor(request, 'closed'), completionAuthFor(request),
    )),
    'recovery_attempt_conflict',
  );
  f.store.releaseWriterLease();
});

test('RA3: admission CAS binds the exact Run, task version/terminal event, and mapped verified owner', () => {
  const cases = [
    ['wrong Run', { runId: 'run-phase76-other' }, 'recovery_attempt_run_mismatch'],
    ['stale task version', { priorTaskVersion: 2 }, 'recovery_attempt_stale'],
    ['stale terminal event', { priorTaskTerminalEvent: 1 }, 'recovery_attempt_stale'],
    ['different worker', { workerId: 'worker-phase76-other' }, 'recovery_attempt_owner_mismatch'],
    ['different verification evidence', { verifiedEvidenceSeq: 1 }, 'recovery_attempt_owner_unverified'],
  ];
  for (const [label, override, code] of cases) {
    const f = fixture(label.replaceAll(' ', '-'));
    const request = requestFor(f, override);
    assert.equal(refusalCode(() => f.store.admitRecoveryAttempt(request, authFor(request))), code, label);
    assert.equal(f.store.pendingRecoveryAttempts().length, 0, label);
    f.store.releaseWriterLease();
  }
});

test('RA4: one unresolved admission blocks parallel or skipped attempts and the exact head is a CAS input', () => {
  const f = fixture('sequential');
  const firstRequest = requestFor(f);
  const first = f.store.admitRecoveryAttempt(firstRequest, authFor(firstRequest)).attempt;

  const parallel = nextRequestFor(f, first, { expectedAttemptHeadEvent: first.admittedEvent });
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(parallel, authFor(parallel))),
    'recovery_attempt_unresolved',
  );
  const changedSeries = requestFor(f, {
    sessionIdDigest: digest({ nativeSession: 'attempted-series-bypass' }),
  });
  assert.notEqual(changedSeries.seriesId, first.seriesId);
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(changedSeries, authFor(changedSeries))),
    'recovery_attempt_unresolved',
    'changing a series coordinate cannot fork one prior task/owner while an effect is unresolved',
  );

  f.store.completeRecoveryAttempt(
    completionFor(firstRequest, 'not_started'), completionAuthFor(firstRequest),
  );
  const settledFirst = f.store.recoveryAttempt(firstRequest.attemptId);
  const skipped = nextRequestFor(f, settledFirst, { attempt: 3 });
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(skipped, authFor(skipped))),
    'recovery_attempt_sequence',
  );
  const staleHead = nextRequestFor(f, settledFirst, {
    expectedAttemptHeadEvent: settledFirst.admittedEvent,
  });
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(staleHead, authFor(staleHead))),
    'recovery_attempt_stale',
  );

  const second = nextRequestFor(f, settledFirst);
  assert.equal(f.store.admitRecoveryAttempt(second, authFor(second)).attempt.attempt, 2);
  f.store.releaseWriterLease();
});

for (const state of ['not_started', 'closed', 'attached', 'unknown']) {
  test(`RA5: completion state ${state} is exact and ${['not_started', 'closed'].includes(state) ? 'permits' : 'fences'} the next same-series attempt`, () => {
    const f = fixture(`state-${state}`);
    const request = requestFor(f);
    f.store.admitRecoveryAttempt(request, authFor(request));
    const completed = f.store.completeRecoveryAttempt(
      completionFor(request, state), completionAuthFor(request),
    ).attempt;
    assert.equal(completed.state, state);
    assert.equal(completed.receiptDigest, digest(receiptFor(state)));
    assert.deepEqual(f.store.pendingRecoveryAttempts(), []);
    const next = nextRequestFor(f, completed);
    if (['not_started', 'closed'].includes(state)) {
      assert.equal(f.store.admitRecoveryAttempt(next, authFor(next)).attempt.attempt, 2);
    } else {
      assert.equal(
        refusalCode(() => f.store.admitRecoveryAttempt(next, authFor(next))),
        'recovery_attempt_continuation_forbidden',
      );
    }
    f.store.releaseWriterLease();
  });
}

test('RA6: the completion state and minimal receipt are closed and semantically inseparable', () => {
  const f = fixture('completion-schema');
  const request = requestFor(f);
  f.store.admitRecoveryAttempt(request, authFor(request));
  for (const completion of [
    { ...completionFor(request, 'not_started'), extra: true },
    { ...completionFor(request, 'closed'), state: 'failed' },
    completionFor(request, 'closed', { receipt: receiptFor('attached') }),
    completionFor(request, 'closed', { receipt: { ...receiptFor('closed'), extra: true } }),
    completionFor(request, 'closed', { receiptDigest: '0'.repeat(64) }),
    { ...completionFor(request, 'closed'), admissionDigest: '0'.repeat(64) },
  ]) {
    assert.equal(
      refusalCode(() => f.store.completeRecoveryAttempt(completion, completionAuthFor(request))),
      'recovery_attempt_completion_invalid',
    );
  }
  assert.equal(f.store.recoveryAttempt(request.attemptId).state, 'pending');
  f.store.releaseWriterLease();
});

test('RA7: maxAttempts is immutable within a series and is an effective exact ceiling', () => {
  const f = fixture('maximum');
  const firstRequest = requestFor(f, { maxAttempts: 2 });
  f.store.admitRecoveryAttempt(firstRequest, authFor(firstRequest));
  f.store.completeRecoveryAttempt(
    completionFor(firstRequest, 'not_started'), completionAuthFor(firstRequest),
  );
  const first = f.store.recoveryAttempt(firstRequest.attemptId);

  const changedCeiling = nextRequestFor(f, first, { maxAttempts: 3 });
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(changedCeiling, authFor(changedCeiling))),
    'recovery_attempt_authority_changed',
  );

  const secondRequest = nextRequestFor(f, first);
  f.store.admitRecoveryAttempt(secondRequest, authFor(secondRequest));
  f.store.completeRecoveryAttempt(
    completionFor(secondRequest, 'closed'), completionAuthFor(secondRequest),
  );
  const second = f.store.recoveryAttempt(secondRequest.attemptId);
  const exhausted = nextRequestFor(f, second);
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(exhausted, authFor(exhausted))),
    'recovery_attempt_exhausted',
  );
  f.store.releaseWriterLease();
});

test('RA8: an admitted Run stop fences recovery authority before an attempt can be recorded', () => {
  const f = fixture('run-stop');
  const reasonDigest = digest({ reason: 'operator stopped the Run' });
  f.store.admitRunStop({
    schemaVersion: 1,
    repoId,
    runId,
    reasonDigest,
    requestDigest: digest({ repoId, runId, reasonDigest }),
  }, { actor: 'operator:phase76', key: `run.stop:${runId}` });
  const request = requestFor(f);
  const before = f.store.snapshot().lastSeq;
  assert.equal(
    refusalCode(() => f.store.admitRecoveryAttempt(request, authFor(request))),
    'run_stopping',
  );
  assert.equal(f.store.snapshot().lastSeq, before);
  assert.equal(f.store.recoveryAttemptHead(request.seriesId), null);
  f.store.releaseWriterLease();
});

test('RA9: attempt and recovery task IDs are deterministic and forged physical identities refuse', () => {
  const f = fixture('deterministic-ids');
  const first = requestFor(f);
  assert.deepEqual(requestFor(f), first);
  assert.match(first.seriesId, /^recovery-series:[a-f0-9]{64}$/u);
  assert.match(first.attemptId, /^recovery-attempt:[a-f0-9]{64}$/u);
  assert.match(first.recoveryTaskId, /^recovery:[a-f0-9]{64}$/u);

  for (const forged of [
    requestFor(f, { attemptId: `recovery-attempt:${'0'.repeat(64)}` }),
    requestFor(f, { recoveryTaskId: `recovery:${'0'.repeat(64)}` }),
    requestFor(f, { seriesId: `recovery-series:${'0'.repeat(64)}` }),
  ]) {
    assert.equal(
      refusalCode(() => f.store.admitRecoveryAttempt(forged, authFor(forged))),
      'recovery_attempt_invalid',
    );
  }
  const deploymentDefaultWorkerPolicy = requestFor(f, { workerPolicy: null });
  assert.equal(
    f.store.admitRecoveryAttempt(
      deploymentDefaultWorkerPolicy, authFor(deploymentDefaultWorkerPolicy),
    ).attempt.workerPolicy,
    null,
    'a null worker policy explicitly means the deployment default; omission is never accepted',
  );
  f.store.releaseWriterLease();
});

test('RA10: replay reconstructs attempt/head/pending truth and rejects admission or completion tampering', () => {
  const replay = fixture('replay');
  const request = requestFor(replay);
  replay.store.admitRecoveryAttempt(request, authFor(request));
  replay.store.completeRecoveryAttempt(
    completionFor(request, 'closed'), completionAuthFor(request),
  );
  const expected = replay.store.recoveryAttempt(request.attemptId);
  replay.store.releaseWriterLease();

  const reopened = new CoordinationStore(replay.directory, { operationalRead: replay.operationalRead });
  assert.deepEqual(reopened.recoveryAttempt(request.attemptId), expected);
  assert.deepEqual(reopened.recoveryAttemptHead(request.seriesId), expected);
  assert.deepEqual(reopened.pendingRecoveryAttempts(), []);
  reopened.releaseWriterLease();

  const admissionTamper = fixture('admission-tamper');
  const admissionRequest = requestFor(admissionTamper);
  admissionTamper.store.admitRecoveryAttempt(admissionRequest, authFor(admissionRequest));
  admissionTamper.store.releaseWriterLease();
  const admissionFile = join(admissionTamper.directory, 'events.jsonl');
  const admissionRows = readFileSync(admissionFile, 'utf8').trimEnd().split('\n').map(JSON.parse);
  admissionRows.find((event) => event.kind === 'recovery.attempt_admitted')
    .payload.authority.gateDigest = '0'.repeat(64);
  writeFileSync(admissionFile, `${admissionRows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(admissionTamper.directory, { operationalRead: admissionTamper.operationalRead }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'recovery_attempt_integrity',
  );

  const completionTamper = fixture('completion-tamper');
  const completionRequest = requestFor(completionTamper);
  completionTamper.store.admitRecoveryAttempt(completionRequest, authFor(completionRequest));
  completionTamper.store.completeRecoveryAttempt(
    completionFor(completionRequest, 'closed'), completionAuthFor(completionRequest),
  );
  completionTamper.store.releaseWriterLease();
  const completionFile = join(completionTamper.directory, 'events.jsonl');
  const completionRows = readFileSync(completionFile, 'utf8').trimEnd().split('\n').map(JSON.parse);
  completionRows.find((event) => event.kind === 'recovery.attempt_completed').payload.state = 'attached';
  writeFileSync(completionFile, `${completionRows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(completionTamper.directory, { operationalRead: completionTamper.operationalRead }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'recovery_attempt_integrity',
  );
});
