import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationIntegrityError, CoordinationRefusal, CoordinationStore } from '../src/coordination-store.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'baton-acceptance-revocation-'));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const taskFields = (id = 'accepted-task') => ({ id, brief: { goal: id }, deps: [], refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });

function fixture(options = {}) {
  const root = options.root ?? dir(); const operational = new Map();
  const store = new CoordinationStore(root, {
    operationalRead: (worker, seq) => operational.get(`${worker}:${seq}`) ?? null,
    ...(options.appendFile ? { appendFile: options.appendFile } : {}),
  });
  store.createTask(taskFields(), { actor: 'orchestrator', key: 'create-task' });
  store.claimTask('accepted-task', 'w-accepted-task', 1, { actor: 'orchestrator', key: 'claim-task' });
  const verify = { worker: 'w-accepted-task', seq: 1, ts: '2026-07-13T00:00:00.000Z', kind: 'verify.reverified', payload: { accept: true } };
  operational.set('w-accepted-task:1', verify);
  const mappedVerify = store.mapOperationalEvent(verify, { actor: 'policy', key: 'map-verify' });
  store.transitionTask('accepted-task', 'completed', 2, { actor: 'policy', key: 'complete-task' }, mappedVerify.evidence);
  for (const id of ['accepted-a', 'accepted-b']) store.registerArtifact({
    id, taskId: 'accepted-task', kind: 'commit', refs: { id }, accepted: true, provenance: [mappedVerify.evidence],
  }, { actor: 'policy', key: `register-${id}` });
  store.registerArtifact({ id: 'unaccepted', taskId: 'accepted-task', kind: 'report', refs: {}, accepted: false, provenance: [] }, { actor: 'policy', key: 'register-unaccepted' });
  store.addKnowledgeNode({ type: 'Artifact', id: 'artifact-view', body: 'second live representation', grounding: 'verified', evidence: [{ artifactId: 'accepted-a' }] }, { actor: 'policy', key: 'artifact-view' });
  const read = store.readKnowledge({ types: ['Artifact'] }, { readerActor: 'orchestrator', taskId: 'accepted-task', runId: 'run' }, { actor: 'orchestrator', key: 'read-artifacts' });
  const adverse = { worker: 'w-accepted-task', seq: 2, ts: '2026-07-13T00:00:01.000Z', kind: 'resource.provider_governance_exceeded', payload: { code: 'provider_call_after_terminal' } };
  operational.set('w-accepted-task:2', adverse);
  const mappedAdverse = store.mapOperationalEvent(adverse, { actor: 'policy', key: 'map-adverse' });
  return { root, store, operational, read, mappedAdverse };
}

const request = (coordinationSeq, expectedTaskVersion = 3) => ({
  schemaVersion: 1, taskId: 'accepted-task', expectedTaskVersion, evidence: { coordinationSeq },
});

test('acceptance revocation atomically fails the completed task, rejects every accepted artifact, and invalidates every live Artifact representation', () => {
  const f = fixture();
  assert.throws(() => f.store.transitionTask('accepted-task', 'failed', 3, { actor: 'policy', key: 'ordinary-reopen' }), (error) => error.code === 'terminal');
  const result = f.store.revokeTaskAcceptance(request(f.mappedAdverse.evidence.coordinationSeq), { actor: 'orchestrator', key: 'revoke-acceptance' });

  assert.equal(result.result, 'revoked');
  assert.equal(result.event.kind, 'task.acceptance_revoked');
  assert.equal(result.task.status, 'failed');
  assert.equal(result.task.version, 4);
  assert.deepEqual(result.task.acceptanceRevocation.evidence, [{ coordinationSeq: f.mappedAdverse.evidence.coordinationSeq }]);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.id), ['accepted-a', 'accepted-b']);
  for (const artifact of result.artifacts) {
    assert.equal(artifact.accepted, false);
    assert.equal(artifact.version, 2);
    assert.deepEqual(artifact.acceptanceInvalidation, {
      schemaVersion: 1, version: 1, eventSeq: result.event.seq, taskId: 'accepted-task', evidence: [{ coordinationSeq: f.mappedAdverse.evidence.coordinationSeq }],
    });
  }
  assert.equal(f.store.artifact('unaccepted').acceptanceInvalidation, undefined);
  assert.deepEqual(result.knowledgeNodes.map((node) => node.id), ['artifact-view', 'artifact:accepted-a', 'artifact:accepted-b']);
  for (const node of result.knowledgeNodes) {
    assert.equal(node.validTo, result.event.ts);
    assert.equal(node.validityVersion, 2);
    assert.equal(node.invalidatedBy, result.event.seq);
    assert.deepEqual(node.acceptanceInvalidation.evidence, [{ coordinationSeq: f.mappedAdverse.evidence.coordinationSeq }]);
  }
  assert.equal(f.store.traceKnowledge('artifact:unaccepted').node.validTo, null);
  const contamination = f.store.snapshot().knowledge.contamination.filter((row) => row.invalidationEvent === result.event.seq);
  assert.equal(contamination.length, 3);
  assert.equal(contamination.every((row) => row.affectedReadEvents.includes(f.read.event.seq)), true);
  assert.throws(() => f.store.transitionTask('accepted-task', 'completed', 4, { actor: 'policy', key: 'transition-after-revocation' }), (error) => error.code === 'terminal');

  const replayed = f.store.revokeTaskAcceptance(request(f.mappedAdverse.evidence.coordinationSeq), { actor: 'orchestrator', key: 'revoke-acceptance' });
  assert.equal(replayed.result, 'idempotent');
  assert.equal(replayed.event.seq, result.event.seq);
  const restored = new CoordinationStore(f.root, { operationalRead: (worker, seq) => f.operational.get(`${worker}:${seq}`) ?? null });
  assert.deepEqual(restored.snapshot(), f.store.snapshot());
});

test('acceptance revocation has a closed request, exact authority/idempotency, CAS, and task-bound later provider evidence', () => {
  const f = fixture(); const evidenceSeq = f.mappedAdverse.evidence.coordinationSeq; const before = f.store.events().length;
  assert.throws(() => f.store.revokeTaskAcceptance({ ...request(evidenceSeq), extra: true }, { actor: 'orchestrator', key: 'extra' }), (error) => error.code === 'acceptance_revocation_invalid');
  assert.throws(() => f.store.revokeTaskAcceptance(request(evidenceSeq), { actor: 'worker', key: 'worker' }), (error) => error.code === 'acceptance_revocation_unauthorized');
  assert.throws(() => f.store.revokeTaskAcceptance(request(evidenceSeq, 2), { actor: 'orchestrator', key: 'stale' }), (error) => error.code === 'stale_version');

  const unrelated = { worker: 'w-accepted-task', seq: 3, ts: '2026-07-13T00:00:02.000Z', kind: 'review.completed', payload: { accepted: false } };
  f.operational.set('w-accepted-task:3', unrelated);
  const mappedUnrelated = f.store.mapOperationalEvent(unrelated, { actor: 'policy', key: 'map-unrelated' });
  assert.throws(() => f.store.revokeTaskAcceptance(request(mappedUnrelated.evidence.coordinationSeq), { actor: 'orchestrator', key: 'unrelated' }), (error) => error.code === 'acceptance_revocation_evidence_invalid');
  const wrongWorker = { worker: 'w-other', seq: 1, ts: '2026-07-13T00:00:03.000Z', kind: 'resource.provider_telemetry_invalid', payload: { code: 'usage_after_terminal' } };
  f.operational.set('w-other:1', wrongWorker);
  const mappedWrongWorker = f.store.mapOperationalEvent(wrongWorker, { actor: 'policy', key: 'map-wrong-worker' });
  assert.throws(() => f.store.revokeTaskAcceptance(request(mappedWrongWorker.evidence.coordinationSeq), { actor: 'orchestrator', key: 'wrong-worker' }), (error) => error.code === 'acceptance_revocation_evidence_invalid');
  assert.equal(f.store.task('accepted-task').status, 'completed');
  assert.equal(f.store.events().length, before + 2, 'only the separately mapped negative-test evidence was appended');

  f.store.revokeTaskAcceptance(request(evidenceSeq), { actor: 'orchestrator', key: 'exact-key' });
  assert.throws(() => f.store.revokeTaskAcceptance(request(mappedWrongWorker.evidence.coordinationSeq), { actor: 'orchestrator', key: 'exact-key' }), (error) => error.code === 'acceptance_revocation_conflict');

  const telemetryFixture = fixture();
  const telemetry = { worker: 'w-accepted-task', seq: 3, ts: '2026-07-13T00:00:04.000Z', kind: 'resource.provider_telemetry_invalid', payload: { code: 'usage_after_terminal' } };
  telemetryFixture.operational.set('w-accepted-task:3', telemetry);
  const mappedTelemetry = telemetryFixture.store.mapOperationalEvent(telemetry, { actor: 'policy', key: 'map-telemetry' });
  const telemetryRevocation = telemetryFixture.store.revokeTaskAcceptance(request(mappedTelemetry.evidence.coordinationSeq), { actor: 'operator:alice', key: 'telemetry-revocation' });
  assert.equal(telemetryRevocation.event.payload.evidence.kind, 'resource.provider_telemetry_invalid');
  assert.equal(telemetryRevocation.event.payload.evidence.providerCode, 'usage_after_terminal');
});

test('acceptance revocation publishes no partial projection when its single durable append fails', () => {
  let fail = false; const root = dir();
  const f = fixture({ root, appendFile: (...args) => { if (fail) throw new Error('revocation disk full'); return appendFileSync(...args); } });
  const before = f.store.snapshot(); fail = true;
  assert.throws(() => f.store.revokeTaskAcceptance(request(f.mappedAdverse.evidence.coordinationSeq), { actor: 'orchestrator', key: 'failed-revocation' }), /revocation disk full/);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(f.store.events().some((event) => event.kind === 'task.acceptance_revoked'), false);
});

test('acceptance revocation replay rejects a receipt whose target version set was rewritten even with a recomputed receipt digest', () => {
  const f = fixture();
  f.store.revokeTaskAcceptance(request(f.mappedAdverse.evidence.coordinationSeq), { actor: 'orchestrator', key: 'tamper-targets' });
  f.store.releaseWriterLease();
  const path = join(f.root, 'events.jsonl'); const events = readFileSync(path, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const event = events.find((row) => row.kind === 'task.acceptance_revoked');
  event.payload.artifactTargets[0].expectedVersion = 99;
  const { receiptDigest: _old, ...core } = event.payload; event.payload.receiptDigest = digest(core);
  writeFileSync(path, `${events.map((row) => JSON.stringify(row)).join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(f.root, { operationalRead: (worker, seq) => f.operational.get(`${worker}:${seq}`) ?? null }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'acceptance_revocation_target_changed',
  );
});
