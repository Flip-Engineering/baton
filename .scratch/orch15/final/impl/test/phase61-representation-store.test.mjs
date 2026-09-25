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
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const policy = (overrides = {}) => ({
  schemaVersion: 1, repoId: 'repo-phase61', maxArgumentBytes: 64 * 1024,
  maxSourceRefs: 8, maxSourceRefBytes: 16 * 1024, maxEvidenceRefs: 2, maxReceiptBytes: 64 * 1024,
  maxGraphBatchBytes: 256 * 1024, maxResultItems: 1, maxResultRefs: 1, maxResultBytes: 64 * 1024, ...overrides,
});

function fixture({ taskId = 'representation-task', runId = null, policy: configuredPolicy = policy(), producerKind = 'structural_delta', supportingRefs = [], duplicatePrimary = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase61-representation-'));
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const coordination = new CoordinationStore(root, { operationalRead, representationPolicy: configuredPolicy });
  coordination.createTask({ id: taskId, runId, deps: [], reservedWorkerId: 'w-representation' }, {
    actor: 'orchestrator', key: `task.created:${taskId}`,
  });
  coordination.claimTask(taskId, 'w-representation', 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  });
  const mapping = producerKind === 'symbol_snapshot'
    ? { capability: 'atlas-index', operation: 'scip.export', kind: 'scip_json', mediaType: 'application/scip+json' }
    : producerKind === 'cpg_semantic_delta'
      ? { capability: 'atlas-cpg-delta', operation: 'cpg.delta', kind: 'cpg_delta', mediaType: 'application/vnd.baton.atlas-cpg-delta+json' }
      : { capability: 'atlas-structural', operation: 'diff.structural', kind: 'structural_delta', mediaType: 'application/vnd.baton.atlas-structural+json' };
  const environment = producerKind === 'symbol_snapshot' ? {
    schemaVersion: 1, kind: 'index_snapshot', repoId: configuredPolicy.repoId,
    treeSha: 'a'.repeat(40), indexEpoch: 'b'.repeat(64), overlayDigest: 'c'.repeat(64),
  } : {
    schemaVersion: 1, kind: 'tree_delta', repoId: configuredPolicy.repoId,
    beforeTreeSha: 'a'.repeat(40), beforeOverlayDigest: 'b'.repeat(64),
    afterTreeSha: 'c'.repeat(40), afterOverlayDigest: 'd'.repeat(64),
  };
  const request = {
    schemaVersion: 1, repoId: configuredPolicy.repoId, taskId, runId,
    producerKind, sourceArguments: { digest: sha({ args: { beforePath: 'a.mjs', afterPath: 'b.mjs' } }), bytes: 48 },
    environment,
  };
  const auth = { actor: 'orchestrator', key: `representation.produce:${taskId}` };
  const source = {
    capability: { name: mapping.capability, version: '0.1.0', cardDigest: '1'.repeat(64) },
    operation: mapping.operation,
    artifact: {
      kind: mapping.kind, mediaType: mapping.mediaType,
      handle: `art:sha256:${'2'.repeat(64)}`, digest: '2'.repeat(64), bytes: 512,
    },
    resultDigest: '3'.repeat(64), resultProjectionDigest: '4'.repeat(64), reverifyResultDigest: '5'.repeat(64),
  };

  const attest = (requestDigest, seq, action, resultDigest, overrides = {}) => {
    const idempotencyKey = `representation:${action}:${sha({ requestDigest })}`;
    const inputDigest = action === 'invoke' ? request.sourceArguments.digest : '6'.repeat(64);
    const identityDigest = sha({ repoId: request.repoId, actor: auth.actor, idempotencyKey });
    const capabilityRequestDigest = sha({
      schemaVersion: 1, repoId: request.repoId, actor: auth.actor, idempotencyKey,
      action, capability: source.capability.name, op: source.operation, inputDigest, budgetTokens: 1_000,
    });
    const event = {
      worker: 'hub-capability', seq, ts: `2026-07-13T00:00:0${seq}.000Z`,
      kind: 'capability.op.completed', actor: auth.actor,
      payload: {
        invocationId: `invocation-${seq}`, action, capability: source.capability.name,
        op: source.operation, status: 'ok', cost: { tokens_out: 1, wall_ms: 1, usd: 0, underlying: 'atlas' },
        refs: action === 'invoke' ? [{
          kind: source.artifact.kind, handle: source.artifact.handle,
          digest: source.artifact.digest, bytes: source.artifact.bytes,
        }, ...(duplicatePrimary ? [{
          kind: source.artifact.kind, handle: source.artifact.handle,
          digest: source.artifact.digest, bytes: source.artifact.bytes,
        }] : []), ...supportingRefs] : [],
        digests: action === 'invoke' ? [source.artifact.digest, ...(duplicatePrimary ? [source.artifact.digest] : []), ...supportingRefs.map((ref) => ref.digest)] : [], resultDigest,
        repoId: request.repoId, idempotencyKey, identityDigest,
        requestDigest: capabilityRequestDigest, inputDigest, budgetTokens: 1_000,
        ...overrides,
      },
    };
    operational.set(`${event.worker}:${event.seq}`, event);
    return coordination.mapOperationalEvent(event, {
      actor: auth.actor, key: `evidence:${event.worker}:${event.seq}`,
    }).evidence;
  };

  const admission = coordination.representationProductionAdmission(request, auth);
  const invoke = attest(admission.requestDigest, 1, 'invoke', source.resultDigest);
  const reverify = attest(admission.requestDigest, 2, 'reverify', source.reverifyResultDigest);
  const fields = { request, requestDigest: admission.requestDigest, source, evidence: { invoke, reverify } };
  const prepare = () => coordination.prepareRepresentationProduction(fields, auth);
  const record = (key = auth.key) => {
    const prepared = prepare();
    return coordination.recordRepresentationProduction(fields, prepared.receiptRef, { ...auth, key });
  };
  return { root, coordination, operational, operationalRead, configuredPolicy, taskId, request, auth, source, fields, prepare, record, attest };
}

test('GR3-GR5: one atomic event derives fixed Representation lineage and both manifests without caller authority', () => {
  const f = fixture();
  for (const extra of [
    { grounding: 'verified' }, { body: 'caller prose' }, { representationId: 'caller-id' }, { edgeIds: [] },
  ]) {
    assert.throws(() => f.coordination.prepareRepresentationProduction({ ...f.fields, ...extra }, f.auth),
      (error) => error.code === 'representation_invalid');
  }
  assert.throws(() => f.coordination.prepareRepresentationProduction({
    ...f.fields, source: { ...f.source, capability: { ...f.source.capability, version: 'caller-version' } },
  }, f.auth), (error) => error.code === 'representation_invalid');
  assert.throws(() => f.coordination.prepareRepresentationProduction({
    ...f.fields, source: { ...f.source, artifact: { ...f.source.artifact, kind: 'caller-kind' } },
  }, f.auth), (error) => error.code === 'representation_invalid');
  const prepared = f.prepare();
  assert.equal(prepared.receipt.grounding, 'derived');
  assert.equal(prepared.receipt.producer.rung, 'R1');
  assert.equal(prepared.receipt.producer.representationType, 'ast_cst_structural_delta');
  assert.equal(prepared.receipt.authority.proof, false);
  assert.equal(prepared.receipt.authority.edit, false);
  assert.equal(prepared.receiptRef.bytes, Buffer.byteLength(JSON.stringify(prepared.receipt)));
  assert.equal(prepared.receiptRef.digest, sha(prepared.receiptSerialized));

  const before = f.coordination.events().length;
  const recorded = f.record();
  assert.equal(f.coordination.events().length, before + 1);
  assert.equal(recorded.event.kind, 'knowledge.representation_produced');
  assert.equal(recorded.representation.identityDigest, prepared.identityDigest);
  assert.equal(recorded.representation.node.grounding, 'derived');
  assert.equal(recorded.representation.node.type, 'Representation');
  assert.equal(recorded.representation.node.body, 'Derived Atlas structural delta representation');
  assert.deepEqual(recorded.representation.edges.map((edge) => edge.type).sort(), ['DerivedFrom', 'ObservedIn', 'ProducedBy']);
  assert.equal(recorded.representation.sourceArtifact.digest, f.source.artifact.digest);
  assert.equal(recorded.representation.receiptArtifact.digest, prepared.receiptRef.digest);
  assert.deepEqual(f.coordination.representationProduction(prepared.identityDigest), recorded.representation);
  assert.equal(f.coordination.representationProductionByRequest(f.fields.requestDigest).identityDigest, prepared.identityDigest);
  assert.equal(f.coordination.snapshot().representations.length, 1);
});

test('GR3: all fixed producer mappings accept one primary among bounded supporting refs and reject ambiguity', () => {
  const cases = [
    ['structural_delta', 'R1', 'ast_cst_structural_delta'],
    ['symbol_snapshot', 'R2', 'scip_symbol_snapshot'],
    ['cpg_semantic_delta', 'R3', 'bounded_cpg_semantic_delta'],
  ];
  for (const [producerKind, rung, representationType] of cases) {
    const supportingRefs = producerKind === 'structural_delta' ? [] : [{
      kind: producerKind === 'symbol_snapshot' ? 'atlas_results' : 'cpg_slice',
      handle: `art:sha256:${'a'.repeat(64)}`, digest: 'a'.repeat(64), bytes: 64,
    }];
    const f = fixture({ taskId: `mapping-${producerKind}`, producerKind, supportingRefs });
    const prepared = f.prepare();
    assert.equal(prepared.receipt.producer.rung, rung);
    assert.equal(prepared.receipt.producer.representationType, representationType);
    assert.equal(f.record().representation.node.grounding, 'derived');
  }
  const ambiguous = fixture({ taskId: 'mapping-ambiguous', producerKind: 'symbol_snapshot', duplicatePrimary: true });
  assert.throws(() => ambiguous.prepare(), (error) => error.code === 'representation_evidence_invalid');
});

test('GR3/GR4: admission is closed, repository/task/run scoped, and requires an exact live task', () => {
  const f = fixture({ runId: 'run-phase61' });
  const base = f.request;
  assert.throws(() => f.coordination.representationProductionAdmission({ ...base, extra: true }, f.auth),
    (error) => error.code === 'representation_invalid');
  assert.throws(() => f.coordination.representationProductionAdmission({ ...base, repoId: 'repo-other', environment: { ...base.environment, repoId: 'repo-other' } }, f.auth),
    (error) => error.code === 'representation_scope_mismatch');
  assert.throws(() => f.coordination.representationProductionAdmission({ ...base, taskId: 'missing' }, f.auth),
    (error) => error.code === 'representation_task_unavailable');
  assert.throws(() => f.coordination.representationProductionAdmission({ ...base, runId: null }, f.auth),
    (error) => error.code === 'representation_scope_mismatch');
  assert.throws(() => f.coordination.representationProductionAdmission({ ...base, producerKind: 'caller_selected' }, f.auth),
    (error) => error.code === 'representation_invalid');
  const task = f.coordination.task(f.taskId);
  f.coordination.transitionTask(f.taskId, 'failed', task.version, { actor: 'policy', key: 'task.failed:representation' });
  assert.throws(() => f.coordination.representationProductionAdmission(base, { ...f.auth, key: 'terminal-task' }),
    (error) => error.code === 'representation_task_unavailable');
});

test('GR3: arguments, source refs, evidence, receipt, graph batch, and results fail at max+1', () => {
  const argumentsMax = fixture({ policy: policy({ maxArgumentBytes: 48 }) });
  assert.throws(() => argumentsMax.coordination.representationProductionAdmission({
    ...argumentsMax.request, sourceArguments: { ...argumentsMax.request.sourceArguments, bytes: 49 },
  }, { ...argumentsMax.auth, key: 'representation.produce:max-plus-one-arguments' }),
    (error) => error.code === 'representation_oversize');

  const sourceMax = fixture({ policy: policy({ maxSourceRefBytes: 32 }) });
  assert.throws(() => sourceMax.prepare(), (error) => error.code === 'representation_oversize');

  const sourceCountMax = fixture({ producerKind: 'cpg_semantic_delta', policy: policy({ maxSourceRefs: 2 }), supportingRefs: [
    { kind: 'cpg_slice', handle: `art:sha256:${'a'.repeat(64)}`, digest: 'a'.repeat(64), bytes: 64 },
    { kind: 'cpg_slice', handle: `art:sha256:${'b'.repeat(64)}`, digest: 'b'.repeat(64), bytes: 64 },
  ] });
  assert.throws(() => sourceCountMax.prepare(), (error) => error.code === 'representation_oversize');

  const evidenceMax = fixture({ policy: policy({ maxEvidenceRefs: 1 }) });
  assert.throws(() => evidenceMax.prepare(), (error) => error.code === 'representation_oversize');

  const prepared = fixture(); const exact = prepared.prepare();
  const receiptMax = fixture({ policy: policy({ maxReceiptBytes: exact.receiptRef.bytes - 1 }) });
  assert.throws(() => receiptMax.prepare(), (error) => error.code === 'representation_oversize');

  const graphMax = fixture({ policy: policy({ maxGraphBatchBytes: 128 }) });
  assert.throws(() => graphMax.prepare(), (error) => error.code === 'representation_oversize');

  const resultMax = fixture({ policy: policy({ maxResultBytes: 128 }) });
  assert.throws(() => resultMax.prepare(), (error) => error.code === 'representation_oversize');
});

test('GR4/GR6: exact retry is zero-append, changed same-key input conflicts, and same identity coalesces', () => {
  const f = fixture();
  const first = f.record(); const after = f.coordination.events().length;
  const retry = f.record();
  assert.equal(retry.result, 'idempotent');
  assert.equal(f.coordination.events().length, after);
  assert.equal(retry.representation.identityDigest, first.representation.identityDigest);

  assert.throws(() => f.coordination.recordRepresentationProduction({
    ...f.fields, source: { ...f.source, resultProjectionDigest: '8'.repeat(64) },
  }, f.prepare().receiptRef, f.auth), (error) => error.code === 'representation_conflict');

  const aliasAuth = { ...f.auth, key: 'representation.produce:coalesced' };
  const aliasAdmission = f.coordination.representationProductionAdmission(f.request, aliasAuth);
  const reboundFields = { ...f.fields, requestDigest: aliasAdmission.requestDigest };
  assert.throws(() => f.coordination.prepareRepresentationProduction(reboundFields, aliasAuth),
    (error) => error.code === 'representation_evidence_invalid', 'old child evidence cannot be rebound to a new request identity');
  const aliasInvoke = f.attest(aliasAdmission.requestDigest, 3, 'invoke', f.source.resultDigest);
  const aliasReverify = f.attest(aliasAdmission.requestDigest, 4, 'reverify', f.source.reverifyResultDigest);
  const aliasFields = { ...reboundFields, evidence: { invoke: aliasInvoke, reverify: aliasReverify } };
  const aliasPrepared = f.coordination.prepareRepresentationProduction(aliasFields, aliasAuth);
  const alias = f.coordination.recordRepresentationProduction(aliasFields, aliasPrepared.receiptRef, aliasAuth);
  assert.equal(alias.result, 'coalesced');
  assert.equal(alias.representation.identityDigest, first.representation.identityDigest);
  assert.equal(f.coordination.events().at(-1).kind, 'knowledge.representation_request_bound');
  assert.equal(f.coordination.recordRepresentationProduction(aliasFields, aliasPrepared.receiptRef, aliasAuth).result, 'idempotent');
});

test('GR3/GR6: stable-identity coalescing keeps the first canonical receipt when only full result timing changes', () => {
  const f = fixture(); const first = f.record();
  const auth = { ...f.auth, key: 'representation.produce:volatile-result' };
  const admission = f.coordination.representationProductionAdmission(f.request, auth);
  const source = { ...f.source, resultDigest: 'e'.repeat(64) };
  const invoke = f.attest(admission.requestDigest, 3, 'invoke', source.resultDigest);
  const reverify = f.attest(admission.requestDigest, 4, 'reverify', source.reverifyResultDigest);
  const fields = { ...f.fields, requestDigest: admission.requestDigest, source, evidence: { invoke, reverify } };
  const candidate = f.coordination.prepareRepresentationProduction(fields, auth);
  assert.notEqual(candidate.receiptRef.digest, first.representation.receiptRef.digest);
  const coalesced = f.coordination.recordRepresentationProduction(fields, candidate.receiptRef, auth);
  assert.equal(coalesced.result, 'coalesced');
  assert.equal(coalesced.representation.identityDigest, first.representation.identityDigest);
  assert.deepEqual(coalesced.representation.receiptRef, first.representation.receiptRef);
  assert.deepEqual(f.coordination.events().at(-1).payload.receiptRef, first.representation.receiptRef);
  assert.equal(f.coordination.recordRepresentationProduction(fields, candidate.receiptRef, auth).result, 'idempotent');
});

test('GR4: append loss exposes no manifests, node, edge, or positive result', () => {
  const f = fixture(); const prepared = f.prepare(); const before = f.coordination.snapshot();
  const append = f.coordination._appendFile;
  f.coordination._appendFile = () => { throw new Error('representation disk unavailable'); };
  assert.throws(() => f.coordination.recordRepresentationProduction(f.fields, prepared.receiptRef, f.auth), /disk unavailable/);
  f.coordination._appendFile = append;
  const after = f.coordination.snapshot();
  assert.deepEqual(after.artifacts, before.artifacts);
  assert.deepEqual(after.knowledge, before.knowledge);
  assert.deepEqual(after.representations, before.representations);
});

test('GR4/GR6: source Artifact exact-reuses only live repository-identical representation material', () => {
  const first = fixture(); const one = first.record(); const firstArtifactCount = first.coordination.snapshot().artifacts.length;
  const secondTask = 'representation-task-two';
  first.coordination.createTask({ id: secondTask, deps: [], reservedWorkerId: 'w-two' }, { actor: 'orchestrator', key: 'task.created:two' });
  first.coordination.claimTask(secondTask, 'w-two', 1, { actor: 'orchestrator', key: 'task.claimed:two' });
  const request = { ...first.request, taskId: secondTask };
  const auth = { actor: 'orchestrator', key: 'representation.produce:two' };
  const admission = first.coordination.representationProductionAdmission(request, auth);
  const invoke = first.attest(admission.requestDigest, 3, 'invoke', first.source.resultDigest);
  const reverify = first.attest(admission.requestDigest, 4, 'reverify', first.source.reverifyResultDigest);
  const fields = { ...first.fields, request, requestDigest: admission.requestDigest, evidence: { invoke, reverify } };
  const prepared = first.coordination.prepareRepresentationProduction(fields, auth);
  const two = first.coordination.recordRepresentationProduction(fields, prepared.receiptRef, auth);
  assert.equal(two.representation.sourceArtifact.id, one.representation.sourceArtifact.id);
  assert.equal(first.coordination.snapshot().artifacts.length, firstArtifactCount + 1, 'only the new receipt manifest is added');

  const squat = fixture(); const projected = squat.prepare();
  const sourceId = projected.projection.sourceArtifact.id;
  squat.coordination.registerArtifact({ id: sourceId, taskId: squat.taskId, kind: 'squatted', refs: [], accepted: false }, {
    actor: 'orchestrator', key: 'artifact.squat',
  });
  assert.throws(() => squat.record(), (error) => error.code === 'representation_namespace_conflict');
});

test('GR4/GR6: evidence and causal endpoints are exact, prior, mapped capability invoke/reverify facts', () => {
  const f = fixture();
  const swapped = { ...f.fields, evidence: { invoke: f.fields.evidence.reverify, reverify: f.fields.evidence.invoke } };
  assert.throws(() => f.coordination.prepareRepresentationProduction(swapped, f.auth),
    (error) => error.code === 'representation_evidence_invalid');
  assert.throws(() => f.coordination.prepareRepresentationProduction({
    ...f.fields, source: { ...f.source, artifact: { ...f.source.artifact, digest: '9'.repeat(64), handle: `art:sha256:${'9'.repeat(64)}` } },
  }, f.auth), (error) => error.code === 'representation_evidence_invalid');
  assert.throws(() => f.coordination.prepareRepresentationProduction({
    ...f.fields, evidence: { ...f.fields.evidence, reverify: { ...f.fields.evidence.reverify, coordinationSeq: f.coordination.events().length + 1 } },
  }, f.auth), (error) => error.code === 'representation_evidence_invalid');
});

test('GR6: replay and read-only reverify detect receipt/graph/source drift without upgrading grounding', () => {
  const f = fixture(); const recorded = f.record();
  const verified = f.coordination.reverifyRepresentationProduction(recorded.representation.identityDigest, f.source);
  assert.equal(verified.ok, true);
  assert.equal(verified.projection.node.grounding, 'derived');
  assert.equal(f.coordination.reverifyRepresentationProduction(recorded.representation.identityDigest, {
    ...f.source, resultDigest: 'e'.repeat(64),
  }).ok, true, 'volatile complete-envelope cost may change while its stable source projection remains exact');
  assert.throws(() => f.coordination.reverifyRepresentationProduction(recorded.representation.identityDigest, {
    ...f.source, reverifyResultDigest: 'f'.repeat(64),
  }), (error) => error.code === 'representation_reverify_diverged');
  const taskNodeId = `task:${f.taskId}`; const taskNode = f.coordination._knowledgeNodes.get(taskNodeId);
  f.coordination._knowledgeNodes.delete(taskNodeId);
  assert.throws(() => f.coordination.reverifyRepresentationProduction(recorded.representation.identityDigest, f.source),
    (error) => error.code === 'representation_integrity');
  f.coordination._knowledgeNodes.set(taskNodeId, taskNode);

  const file = join(f.root, 'events.jsonl'); const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  const event = JSON.parse(lines.at(-1)); event.payload.nodes[0].grounding = 'verified';
  lines[lines.length - 1] = JSON.stringify(event); writeFileSync(file, `${lines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(f.root, {
    operationalRead: f.operationalRead, representationPolicy: f.configuredPolicy,
  }), (error) => error instanceof CoordinationIntegrityError && error.code === 'representation_integrity');
});
