import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationIntegrityError, CoordinationStore } from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase60-coordination-'));
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const coordination = new CoordinationStore(root, { operationalRead });
  const workerId = 'w-recovery';
  const brief = { goal: 'retain exact verified work', budget: { tokens: 1_000, usd: 1, wallMin: 5 } };
  const priorFields = {
    id: 'prior', brief, deps: [], refines: null, runId: null, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'stub', modelRequested: 'model-a', modelPolicy: null,
    effortRequested: 'low', effortResolved: null, effortObserved: null, routeKey: null,
    sessionRequest: { mode: 'new' }, worktreeBaseSha: 'base-sha', review: { kind: 'review', parentTaskId: 'parent' },
  };
  coordination.createTask(priorFields, { actor: 'orchestrator', key: 'task.created:prior' });
  coordination.claimTask('prior', workerId, 1, { actor: 'orchestrator', key: 'task.claimed:prior' }, {
    harnessRequested: 'stub', harnessResolved: 'stub@1', modelRequested: 'model-a', modelResolved: 'model-a',
    modelObserved: 'model-a', effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["stub","1","model-a","low"]',
  });
  const verified = {
    worker: workerId, seq: 1, ts: '2026-07-13T00:00:00.000Z', kind: 'verify.reverified', actor: 'policy',
    taskId: 'prior', payload: { accept: true, verdict: { ok: true } },
  };
  operational.set(`${workerId}:1`, verified);
  const verificationEvidence = coordination.mapOperationalEvent(verified, {
    actor: 'policy', key: 'evidence:prior:verified',
  }).evidence;
  coordination.transitionTask('prior', 'completed', 2, {
    actor: 'policy', key: 'task.completed:prior',
  }, verificationEvidence);

  const context = { worktree: '/tmp/baton-phase60-worktree', ownerTaskId: 'prior', baseSha: 'base-sha' };
  const recoveryFields = {
    id: 'recovery', brief, deps: [], refines: 'prior', taskType: 'general', runId: null,
    reservedWorkerId: workerId, vendorRequested: 'stub', modelRequested: 'model-a', modelPolicy: null,
    effortRequested: 'low', sessionRequest: { mode: 'resume', id: 'native-session', context }, relation: 'recovery',
  };
  const attribution = {
    harnessRequested: 'stub', harnessResolved: 'stub@1', modelRequested: 'model-a', modelResolved: 'model-a',
    modelObserved: 'model-a', effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["stub","1","model-a","low"]',
  };

  const createRecovery = () => coordination.createAndClaimRecoveryRefinement(
    recoveryFields, attribution, { actor: 'orchestrator', key: 'task.created:recovery' },
  );
  const continuation = () => {
    const task = coordination.task('recovery');
    const adapterCardDigest = canonicalDigest({ harness: 'stub', version: '1' });
    const routeDigest = canonicalDigest({
      harness: task.harnessResolved, model: task.modelResolved, effort: task.effortResolved,
      serviceTier: task.modelPolicy?.serviceTier ?? null, routeKey: task.routeKey, adapterCardDigest,
    });
    return {
      schemaVersion: 1, taskId: 'recovery', priorTaskId: 'prior', workerId,
      sessionId: 'native-session', processGeneration: 1, briefDigest: canonicalDigest(brief),
      contextDigest: canonicalDigest(context), routeDigest, adapterCardDigest,
    };
  };
  const recordIntent = () => coordination.recordRecoveryContinuationIntent(continuation(), {
    actor: 'orchestrator', key: 'driver.recovery.intent:recovery:1',
  });
  const refusalProof = (intentSeq, overrides = {}) => ({
    worker: workerId, seq: 2, ts: '2026-07-13T00:00:01.000Z', kind: 'control.recovery_dispatch_refused',
    actor: 'policy', taskId: 'prior', payload: {
      schemaVersion: 1, code: 'not_sent', taskId: 'recovery', priorTaskId: 'prior', workerId,
      sessionId: 'native-session', processGeneration: 1, routeDigest: continuation().routeDigest,
      briefDigest: continuation().briefDigest, contextDigest: continuation().contextDigest,
      adapterCardDigest: continuation().adapterCardDigest, intentSeq, observedDispatchFacts: [],
      action: 'kill_untrusted_transport',
    },
    ...overrides,
  });
  const completeRefusal = (source) => {
    operational.set(`${source.worker}:${source.seq}`, source);
    const evidence = coordination.mapOperationalEvent(source, {
      actor: 'policy', key: `evidence:${source.worker}:${source.seq}`,
    }).evidence;
    const state = coordination.recoveryDispatchState(workerId);
    return coordination.completeRecoveryDispatch({
      disposition: 'refused', ...continuation(), intentSeq: state.intentSeq, code: 'not_sent', evidence,
    }, { actor: 'policy', key: 'driver.recovery.refused:recovery:1' });
  };
  return {
    root, operational, operationalRead, coordination, workerId, brief, priorFields,
    context, recoveryFields, attribution, createRecovery, continuation, recordIntent, refusalProof, completeRefusal,
  };
}

function removeLastEvent(root) {
  const file = join(root, 'events.jsonl');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  const removed = JSON.parse(lines.pop());
  writeFileSync(file, `${lines.join('\n')}\n`);
  return removed;
}

test('Phase 60 store: recovery refinement is closed, derived, and bound to a completed verified same-worker prior', () => {
  const f = fixture();
  const before = f.coordination.events().length;
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, brief: { goal: 'substituted' } }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:changed-brief' },
  ), (error) => error.code === 'recovery_refinement_conflict');
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, id: 'wrong-worker', reservedWorkerId: 'w-other' }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:wrong-worker' },
  ), (error) => error.code === 'recovery_refinement_conflict');
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, extraAuthority: true }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:open-shape' },
  ), (error) => error.code === 'recovery_refinement_invalid');
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, sessionRequest: {
      ...f.recoveryFields.sessionRequest,
      context: { ...f.context, ownerTaskId: 'substituted-owner' },
    } }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:changed-owner' },
  ), (error) => error.code === 'recovery_refinement_conflict');
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, sessionRequest: {
      ...f.recoveryFields.sessionRequest,
      context: { ...f.context, baseSha: 'substituted-base' },
    } }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:changed-base' },
  ), (error) => error.code === 'recovery_refinement_conflict');
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, sessionRequest: {
      ...f.recoveryFields.sessionRequest,
      context: { ...f.context, extraAuthority: true },
    } }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:open-context' },
  ), (error) => error.code === 'recovery_refinement_invalid');
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement(
    { ...f.recoveryFields, sessionRequest: {
      ...f.recoveryFields.sessionRequest,
      context: { ...f.context, worktree: `/${'w'.repeat(32_768)}` },
    } }, f.attribution,
    { actor: 'orchestrator', key: 'task.created:max-plus-one-context' },
  ), (error) => error.code === 'recovery_refinement_invalid');
  assert.equal(f.coordination.events().length, before, 'all lineage conflicts refuse before append');

  const created = f.createRecovery();
  assert.equal(created.task.status, 'working');
  assert.equal(created.task.assignee, f.workerId);
  assert.deepEqual(created.task.brief, f.brief);
  assert.equal(created.task.worktreeBaseSha, f.priorFields.worktreeBaseSha);
  assert.deepEqual(created.task.review, f.priorFields.review);
  assert.equal(created.createdEvent.batch.kind, 'recovery_refinement_create_claim');
  assert.equal(created.claimedEvent.batch.id, created.createdEvent.batch.id);
  assert.equal(created.claimedEvent.seq, created.createdEvent.seq + 1);
  assert.equal(created.claimedEvent.ts, created.createdEvent.ts);
  assert.equal(f.createRecovery().result, 'idempotent');
});

test('Phase 60 store: pending/unverified prior and generic recovery create/claim bypasses are refused', () => {
  const f = fixture();
  f.coordination.createTask({
    ...f.priorFields, id: 'pending', reservedWorkerId: 'w-pending', brief: { goal: 'not verified' },
  }, { actor: 'orchestrator', key: 'task.created:pending' });
  assert.throws(() => f.coordination.createAndClaimRecoveryRefinement({
    ...f.recoveryFields, id: 'from-pending', refines: 'pending', reservedWorkerId: 'w-pending',
    brief: { goal: 'not verified' }, sessionRequest: { ...f.recoveryFields.sessionRequest, id: 'other-native' },
  }, { ...f.attribution }, { actor: 'orchestrator', key: 'task.created:from-pending' }),
  (error) => error.code === 'recovery_refinement_unverified');

  assert.throws(() => f.coordination.createTask(f.recoveryFields, {
    actor: 'orchestrator', key: 'generic.task.created:recovery',
  }), (error) => error.code === 'recovery_refinement_api_required');
  f.createRecovery();
  assert.throws(() => f.coordination.claimTask('recovery', f.workerId, 2, {
    actor: 'orchestrator', key: 'generic.task.claimed:recovery',
  }), (error) => error.code === 'recovery_refinement_api_required');
});

test('Phase 60 store: continuation intent requires the dedicated atomic recovery pair', () => {
  const f = fixture();
  f.createRecovery();
  const intent = f.recordIntent();
  assert.equal(intent.dispatch.status, 'dispatch_unknown');
  assert.equal(intent.dispatch.taskId, 'recovery');
  assert.equal(f.recordIntent().result, 'idempotent');
});

test('Phase 60 store: unrelated or contradictory operational evidence cannot prove not-sent', () => {
  const f = fixture();
  f.createRecovery();
  const intent = f.recordIntent();
  const unrelated = {
    worker: f.workerId, seq: 2, ts: '2026-07-13T00:00:01.000Z', kind: 'content.message', actor: 'worker',
    taskId: 'recovery', payload: { text: 'provider work already happened' },
  };
  f.operational.set(`${f.workerId}:2`, unrelated);
  const evidence = f.coordination.mapOperationalEvent(unrelated, {
    actor: 'policy', key: 'evidence:unrelated-provider-fact',
  }).evidence;
  assert.throws(() => f.coordination.completeRecoveryDispatch({
    disposition: 'refused', ...f.continuation(), intentSeq: intent.event.seq, code: 'not_sent', evidence,
  }, { actor: 'policy', key: 'driver.recovery.false-refusal' }),
  (error) => error.code === 'recovery_dispatch_integrity');
  assert.equal(f.coordination.recoveryDispatchState(f.workerId).status, 'dispatch_unknown');
  assert.equal(f.coordination.task('recovery').status, 'working');
});

test('Phase 60 store: exact zero-fact refusal proof atomically closes the refinement', () => {
  const f = fixture();
  f.createRecovery();
  const intent = f.recordIntent();
  const closed = f.completeRefusal(f.refusalProof(intent.event.seq));
  assert.equal(closed.dispatch.status, 'dispatch_refused');
  assert.equal(closed.task.status, 'failed');
  assert.equal(closed.event.batch.kind, 'recovery_dispatch_refusal');
  assert.equal(closed.taskEvent.batch.id, closed.event.batch.id);
  assert.equal(closed.taskEvent.seq, closed.event.seq + 1);
  assert.equal(closed.taskEvent.ts, closed.event.ts);
  const { kind: _kind, ...sameReceipt } = closed.event.payload;
  assert.equal(f.coordination.completeRecoveryDispatch({ disposition: 'refused', ...sameReceipt }, {
    actor: 'policy', key: 'driver.recovery.refused:recovery:1',
  }).result, 'idempotent');
});

test('Phase 60 replay: newline-complete torn recovery create/claim fails closed', () => {
  const f = fixture();
  f.createRecovery();
  f.coordination.releaseWriterLease();
  const removed = removeLastEvent(f.root);
  assert.equal(removed.kind, 'task.claimed');
  assert.throws(() => new CoordinationStore(f.root, { operationalRead: f.operationalRead }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'recovery_batch_integrity');
});

test('Phase 60 replay: newline-complete torn refusal/transition fails closed', () => {
  const f = fixture();
  f.createRecovery();
  const intent = f.recordIntent();
  f.completeRefusal(f.refusalProof(intent.event.seq));
  f.coordination.releaseWriterLease();
  const removed = removeLastEvent(f.root);
  assert.equal(removed.kind, 'task.transitioned');
  assert.throws(() => new CoordinationStore(f.root, { operationalRead: f.operationalRead }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'recovery_batch_integrity');
});
