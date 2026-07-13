import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationIntegrityError, CoordinationStore, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name = 'root') => mkdtempSync(join(tmpdir(), `baton-phase47-${name}-`));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const task = (id) => ({ id, brief: { goal: id }, deps: [], refines: null, taskType: 'causal-audit', reservedWorkerId: `w-${id}` });
const limits = (overrides = {}) => ({
  repoId: 'repo-a', maxStateRows: 256, maxNodes: 64, maxEdges: 128, maxEvidenceRefs: 256,
  maxAuditSamples: 32, maxTraceDepth: 8, maxTraceRows: 128, maxArtifactBytes: 128 * 1024,
  maxResultBytes: 128 * 1024, ...overrides,
});
const ctx = (overrides = {}) => ({ actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'phase47:direct', budgetTokens: 16_000, ...overrides });

function clock(start = '2026-07-12T20:00:00.000Z') {
  let now = Date.parse(start);
  return () => new Date(now++).toISOString();
}

function graph(store, { contradiction = false } = {}) {
  const created = store.createTask(task('source'), { actor: 'orchestrator', key: 'task:source' });
  const left = store.addKnowledgeNode({ id: 'finding:left', type: 'Finding', grounding: 'verified', body: 'The retry is idempotent.', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'finding:left' });
  store.addKnowledgeEdge({ type: 'VerifiedBy', from: left.node.id, to: 'task:source', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'finding:left:verified' });
  const decision = store.addKnowledgeNode({ id: 'decision:retry', type: 'Decision', grounding: 'observed', body: 'Retain the retry.', evidence: [{ coordinationSeq: left.event.seq }], informedBy: [left.node.id] }, { actor: 'operator:alice', key: 'decision:retry' });
  if (!contradiction) return { created, left, decision };
  const right = store.addKnowledgeNode({ id: 'finding:right', type: 'Finding', grounding: 'observed', body: 'The retry duplicates side effects.', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'finding:right' });
  const conflict = store.addKnowledgeEdge({ type: 'Contradicts', from: left.node.id, to: right.node.id, evidence: [{ coordinationSeq: right.event.seq }] }, { actor: 'operator:alice', key: 'contradiction:create' });
  return { created, left, right, conflict, decision };
}

function cairn(store, overrides = {}) {
  return new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('artifacts'), knowledgeAuditPolicy: limits(overrides) });
}

test('CA2: generic edge evidence, validity, and replay tamper fail closed', () => {
  const dir = root('integrity'); const store = new CoordinationStore(dir, { clock: clock() }); const g = graph(store);
  assert.throws(() => store.addKnowledgeEdge({ type: 'Supports', from: g.left.node.id, to: g.decision.node.id, evidence: [{ coordinationSeq: 9_999 }] }, { actor: 'policy', key: 'future-edge' }), (error) => error.code === 'temporal_incoherence');
  assert.throws(() => store.addKnowledgeEdge({ type: 'Supports', from: g.left.node.id, to: g.decision.node.id, validFrom: '2026-07-13T00:00:00.000Z', validTo: '2026-07-12T00:00:00.000Z' }, { actor: 'policy', key: 'invalid-interval' }), (error) => error.code === 'invalid_valid_time');
  const edge = store.addKnowledgeEdge({ type: 'Supports', from: g.left.node.id, to: g.decision.node.id, evidence: [{ coordinationSeq: g.left.event.seq }] }, { actor: 'policy', key: 'valid-edge' });
  store.releaseWriterLease();
  const file = join(dir, 'events.jsonl'); const original = readFileSync(file, 'utf8'); let rows = original.trimEnd().split('\n').map(JSON.parse);
  rows.find((row) => row.seq === edge.event.seq).payload.evidence = [{ coordinationSeq: edge.event.seq + 10 }]; writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError && error.code === 'knowledge_content_integrity');
  rows = original.trimEnd().split('\n').map(JSON.parse); rows.find((row) => row.payload?.id === g.left.node.id).payload.body = 'SUBSTITUTED'; writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError && error.code === 'knowledge_content_integrity');
});

test('CA2: final promotion validation and request-bound idempotency fail before append', () => {
  const dir = root('promotion-preflight'); const store = new CoordinationStore(dir, { clock: clock() }); const created = store.createTask(task('source'), { actor: 'orchestrator', key: 'task' }); const before = readFileSync(join(dir, 'events.jsonl'), 'utf8');
  assert.throws(() => store.promoteKnowledgeNode({ id: 'outcome:bad', type: 'Finding', grounding: 'verified', body: 'bad', evidence: [{ coordinationSeq: created.event.seq }] }, { kind: 'Finding', trigger: 'verified_task_outcome' }, { actor: 'policy', key: 'bad-promotion' }), (error) => error.code === 'missing_endpoint');
  assert.equal(store.snapshot().lastSeq, 1); assert.equal(readFileSync(join(dir, 'events.jsonl'), 'utf8'), before);
  const first = store.addKnowledgeNode({ id: 'finding:bound', type: 'Finding', grounding: 'observed', body: 'first', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'bound-node' });
  assert.throws(() => store.addKnowledgeNode({ id: 'finding:bound', type: 'Finding', grounding: 'observed', body: 'changed', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'bound-node' }), (error) => error.code === 'knowledge_node_conflict');
  assert.equal(store.addKnowledgeNode({ id: 'finding:bound', type: 'Finding', grounding: 'observed', body: 'first', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'bound-node' }).event.seq, first.event.seq);
  const replay = new CoordinationStore(dir); assert.deepEqual(replay.snapshot(), store.snapshot());
});

test('CA3/CA5: supersession is typed, acyclic, CAS-bound, and truly bitemporal', () => {
  const store = new CoordinationStore(root('bitemporal'), { clock: clock() }); const created = store.createTask(task('source'), { actor: 'orchestrator', key: 'task' });
  const old = store.addKnowledgeNode({ id: 'finding:old', type: 'Finding', grounding: 'observed', body: 'old', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'old' });
  const newer = store.addKnowledgeNode({ id: 'finding:new', type: 'Finding', grounding: 'verified', body: 'new', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'new' });
  const before = store.snapshot().lastSeq;
  assert.throws(() => store.addKnowledgeEdge({ type: 'Supersedes', from: old.node.id, to: old.node.id, expectedValidityVersion: 1, evidence: [{ coordinationSeq: old.event.seq }] }, { actor: 'policy', key: 'self' }), (error) => error.code === 'invalid_supersession');
  assert.throws(() => store.addKnowledgeEdge({ type: 'Supersedes', from: newer.node.id, to: old.node.id, expectedValidityVersion: 2, evidence: [{ coordinationSeq: newer.event.seq }] }, { actor: 'policy', key: 'stale' }), (error) => error.code === 'stale_version');
  const superseded = store.addKnowledgeEdge({ type: 'Supersedes', from: newer.node.id, to: old.node.id, expectedValidityVersion: 1, evidence: [{ coordinationSeq: newer.event.seq }] }, { actor: 'policy', key: 'supersede' });
  assert.deepEqual(store.queryKnowledge({ observedSeq: before }).map((node) => node.id).sort(), ['finding:new', 'finding:old', 'task:source']);
  assert.deepEqual(store.queryKnowledge({ observedSeq: superseded.event.seq }).map((node) => node.id).sort(), ['finding:new', 'task:source']);
  assert.equal(store.queryKnowledgeEdges({ observedSeq: before }).some((edge) => edge.type === 'Supersedes'), false);
  assert.equal(store.queryKnowledgeEdges({ observedSeq: superseded.event.seq }).some((edge) => edge.type === 'Supersedes'), true);
  assert.throws(() => store.addKnowledgeEdge({ type: 'Supersedes', from: old.node.id, to: newer.node.id, expectedValidityVersion: 1, evidence: [{ coordinationSeq: newer.event.seq }] }, { actor: 'policy', key: 'cycle' }), (error) => ['invalid_supersession', 'stale_version'].includes(error.code));
});

test('CA3: an observation boundary pins valid time instead of consulting the moving wall clock', () => {
  let now = Date.parse('2026-07-12T20:00:00.000Z'); const store = new CoordinationStore(root('valid-time'), { clock: () => new Date(now).toISOString() });
  const created = store.createTask(task('source'), { actor: 'orchestrator', key: 'task' });
  const left = store.addKnowledgeNode({ id: 'finding:left', type: 'Finding', grounding: 'observed', body: 'left', evidence: [{ coordinationSeq: created.event.seq }], validTo: '2026-07-12T21:00:00.000Z' }, { actor: 'policy', key: 'left' });
  const right = store.addKnowledgeNode({ id: 'finding:right', type: 'Finding', grounding: 'observed', body: 'right', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'right' });
  const edge = store.addKnowledgeEdge({ type: 'Supports', from: left.node.id, to: right.node.id, evidence: [{ coordinationSeq: left.event.seq }], validTo: '2026-07-12T21:00:00.000Z' }, { actor: 'policy', key: 'supports' });
  const observedSeq = edge.event.seq; assert.equal(store.observationTime(observedSeq), '2026-07-12T20:00:00.000Z');
  now = Date.parse('2026-07-12T22:00:00.000Z');
  assert.equal(store.queryKnowledge({ observedSeq, ids: [left.node.id] }).length, 1);
  assert.equal(store.queryKnowledgeEdges({ observedSeq, types: ['Supports'] }).length, 1);
  const read = store.readKnowledge({ observedSeq, ids: [left.node.id] }, { readerActor: 'orchestrator' }, { actor: 'orchestrator', key: 'historical-read' }); assert.equal(read.nodes.length, 1); assert.equal(read.asOf, store.observationTime(observedSeq));
  assert.equal(store.queryKnowledge({ ids: [left.node.id] }).length, 0);
  assert.equal(store.queryKnowledgeEdges({ types: ['Supports'] }).length, 0);
});

test('CA5: supersession effective time and append atomicity fail closed', () => {
  const future = new CoordinationStore(root('future-supersession'), { clock: () => '2026-07-12T20:00:00.000Z' }); const created = future.createTask(task('source'), { actor: 'orchestrator', key: 'task' });
  for (const id of ['old', 'new']) future.addKnowledgeNode({ id: `finding:${id}`, type: 'Finding', grounding: 'observed', body: id, evidence: [{ coordinationSeq: created.event.seq }], validFrom: '2099-01-01T00:00:00.000Z' }, { actor: 'policy', key: id });
  assert.throws(() => future.addKnowledgeEdge({ type: 'Supersedes', from: 'finding:new', to: 'finding:old', expectedValidityVersion: 1, evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'future-supersede' }), (error) => error.code === 'invalid_supersession');
  let fail = false; const dir = root('supersession-atomic'); const store = new CoordinationStore(dir, { clock: clock(), appendFile: (...args) => { if (fail) throw new Error('supersession disk unavailable'); appendFileSync(...args); } }); const g = graph(store); const replacement = store.addKnowledgeNode({ id: 'finding:replacement', type: 'Finding', grounding: 'observed', body: 'replacement', evidence: [{ coordinationSeq: g.created.event.seq }] }, { actor: 'policy', key: 'replacement' }); const before = store.snapshot(); fail = true;
  assert.throws(() => store.addKnowledgeEdge({ type: 'Supersedes', from: replacement.node.id, to: g.left.node.id, expectedValidityVersion: 1, evidence: [{ coordinationSeq: replacement.event.seq }] }, { actor: 'policy', key: 'atomic-supersede' }), /supersession disk unavailable/); assert.deepEqual(store.snapshot(), before);
});

test('CA6: contradiction creation and resolution are canonical, explicit, atomic, and contaminating', () => {
  let fail = false; const dir = root('contradiction'); const store = new CoordinationStore(dir, { clock: clock(), appendFile: (...args) => { if (fail) throw new Error('resolution disk unavailable'); appendFileSync(...args); } }); const g = graph(store, { contradiction: true });
  assert.throws(() => store.addKnowledgeEdge({ type: 'Contradicts', from: g.right.node.id, to: g.left.node.id, evidence: [{ coordinationSeq: g.right.event.seq }] }, { actor: 'policy', key: 'contradiction:reverse' }), (error) => error.code === 'duplicate_contradiction');
  const clean = new CoordinationStore(root('preclosed'), { clock: clock() }); const cg = graph(clean);
  assert.throws(() => clean.addKnowledgeEdge({ type: 'Contradicts', from: cg.left.node.id, to: cg.decision.node.id, evidence: [{ coordinationSeq: cg.left.event.seq }], validTo: '2026-07-13T00:00:00.000Z', resolvedBy: 777, winnerId: cg.left.node.id, loserId: cg.decision.node.id }, { actor: 'operator:alice', key: 'preclosed' }), (error) => ['reserved_knowledge_field', 'invalid_contradiction'].includes(error.code));
  assert.throws(() => store.invalidateKnowledge(g.right.node.id, 1, 'bypass resolution', { actor: 'operator:alice', key: 'bypass' }), (error) => error.code === 'unresolved_contradiction');
  assert.throws(() => store.resolveKnowledgeContradiction({ edgeId: g.conflict.edge.id, winnerId: g.left.node.id, loserId: g.right.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Worker chose.' }, { actor: 'worker:evil', key: 'resolve:worker' }), (error) => error.code === 'knowledge_resolution_unauthorized');
  const read = store.readKnowledge({ ids: [g.right.node.id] }, { readerActor: 'orchestrator', taskId: 'source' }, { actor: 'orchestrator', key: 'read:right' });
  const before = store.snapshot(); fail = true;
  assert.throws(() => store.resolveKnowledgeContradiction({ edgeId: g.conflict.edge.id, winnerId: g.left.node.id, loserId: g.right.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Independent replay verified the left finding.' }, { actor: 'operator:alice', key: 'resolve' }), /resolution disk unavailable/);
  assert.deepEqual(store.snapshot(), before); fail = false;
  const resolved = store.resolveKnowledgeContradiction({ edgeId: g.conflict.edge.id, winnerId: g.left.node.id, loserId: g.right.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Independent replay verified the left finding.' }, { actor: 'operator:alice', key: 'resolve' });
  assert.deepEqual(resolved.contamination.payload.affectedReadEvents, [read.event.seq]);
  assert.equal(store.queryKnowledge({}).some((node) => node.id === g.right.node.id), false);
  assert.equal(store.queryKnowledge({ observedSeq: before.lastSeq }).some((node) => node.id === g.right.node.id), true);
  assert.throws(() => store.resolveKnowledgeContradiction({ edgeId: g.conflict.edge.id, winnerId: g.right.node.id, loserId: g.left.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Reverse it.' }, { actor: 'operator:bob', key: 'resolve:race' }), (error) => ['stale_version', 'contradiction_resolved'].includes(error.code));
  store.releaseWriterLease(); const replay = new CoordinationStore(dir); assert.deepEqual(replay.snapshot(), store.snapshot());
});

test('CA5/CA6: invalidation and contamination lifecycle rows reject replay substitution', () => {
  for (const kind of ['invalidation', 'contradiction', 'supersession']) {
    const dir = root(`contamination-${kind}`); const store = new CoordinationStore(dir, { clock: clock() }); const g = graph(store, { contradiction: kind === 'contradiction' });
    const target = kind === 'contradiction' ? g.right.node.id : g.left.node.id; store.readKnowledge({ ids: [target] }, { readerActor: 'orchestrator' }, { actor: 'orchestrator', key: `read:${kind}` });
    if (kind === 'contradiction') store.resolveKnowledgeContradiction({ edgeId: g.conflict.edge.id, winnerId: g.left.node.id, loserId: g.right.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Operator resolution.' }, { actor: 'operator:alice', key: `close:${kind}` });
    else if (kind === 'supersession') { const replacement = store.addKnowledgeNode({ id: 'finding:replacement', type: 'Finding', grounding: 'observed', body: 'replacement', evidence: [{ coordinationSeq: g.created.event.seq }] }, { actor: 'policy', key: 'replacement' }); store.addKnowledgeEdge({ type: 'Supersedes', from: replacement.node.id, to: target, expectedValidityVersion: 1, evidence: [{ coordinationSeq: replacement.event.seq }] }, { actor: 'operator:alice', key: `close:${kind}` }); }
    else store.invalidateKnowledge(target, 1, 'Operator invalidation.', { actor: 'operator:alice', key: `close:${kind}` });
    const file = join(dir, 'events.jsonl'); const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse); const contamination = rows.find((row) => row.kind === 'knowledge.contamination_record'); contamination.payload.affectedReadEvents = []; contamination.payload.invalidationEvent = 1; writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
    assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError && error.code === 'contamination_integrity');
  }
  const dir = root('invalidation-shape'); const store = new CoordinationStore(dir, { clock: clock() }); const g = graph(store); store.invalidateKnowledge(g.left.node.id, 1, 'Invalidate.', { actor: 'operator:alice', key: 'invalidate' }); const file = join(dir, 'events.jsonl'); const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse); rows.find((row) => row.kind === 'knowledge.invalidated').payload.validTo = 'not-a-time'; writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`); assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError && error.code === 'invalid_invalidation');
});

test('CA4/CA7: bounded audit distinguishes causal, temporal, contradiction, recall, and contamination axes', async () => {
  const store = new CoordinationStore(root('audit'), { clock: clock() }); const g = graph(store, { contradiction: true });
  const capability = cairn(store); const result = await capability.invoke('causal.audit', {}, ctx());
  assert.equal(result.status, 'ok'); assert.equal(result.payload[0].repoId, 'repo-a');
  assert.equal(result.payload[0].metrics.causalCompleteness.decisions.complete, 1);
  assert.equal(result.payload[0].metrics.groundingLineage.verifiedFindings.complete, 1);
  assert.equal(result.payload[0].metrics.contradictions.unresolved, 1);
  assert.equal(result.payload[0].retainedScope.capabilityIds.includes('atlas-search-ast-cst-symbol-scip-cpg-ir-semantic-delta'), true); assert.equal(result.payload[0].retainedScope.capabilityIds.includes('audit-gated-bounded-lexical-graph-recall'), true); assert.equal(result.payload[0].retainedScope.capabilityIds.includes('deployment-neutral-export-no-external-project-manager-or-homelab-runtime'), true);
  assert.equal(result.payload[0].disposition.status, 'pass');
  assert.equal(statSync(result.refs[0].path).mode & 0o777, 0o600);
  assert.equal(digest(readFileSync(result.refs[0].path)), result.refs[0].digest);
  const auditArgs = { observedSeq: result.payload[0].coordinationUpperBound };
  const check = await capability.reverify(result, 'causal.audit', auditArgs, ctx()); assert.equal(check.ok, true);
  for (const mutate of [
    (claim) => { claim.payload[0].metrics.contradictions.unresolved = 0; }, (claim) => { claim.status = 'partial'; }, (claim) => { claim.summary = 'substituted'; },
    (claim) => { claim.refs[0].digest = '0'.repeat(64); }, (claim) => { claim.refs[0].path = join(root('wrong'), 'packet.json'); }, (claim) => { claim.cost.tokens_out += 1; }, (claim) => { claim.provenance.workerAuthority = true; },
  ]) { const tampered = structuredClone(result); mutate(tampered); assert.equal((await capability.reverify(tampered, 'causal.audit', auditArgs, ctx())).ok, false); }
  const noPath = structuredClone(result); delete noPath.refs[0].path; assert.equal((await capability.reverify(noPath, 'causal.audit', auditArgs, ctx())).ok, false);
  chmodSync(result.refs[0].path, 0o644); assert.equal((await capability.reverify(result, 'causal.audit', auditArgs, ctx())).ok, false); chmodSync(result.refs[0].path, 0o600);
  rmSync(result.refs[0].path); assert.equal((await capability.reverify(result, 'causal.audit', auditArgs, ctx())).ok, false); assert.equal(existsSync(result.refs[0].path), false);
  await assert.rejects(cairn(store, { maxNodes: 2 }).invoke('causal.audit', {}, ctx()), (error) => error.code === 'causal_audit_oversize');
  await assert.rejects(cairn(store, { maxEdges: 2 }).invoke('causal.audit', {}, ctx()), (error) => error.code === 'causal_audit_oversize');
  await assert.rejects(cairn(store, { maxEvidenceRefs: 2 }).invoke('causal.audit', {}, ctx()), (error) => error.code === 'causal_audit_oversize');
  await assert.rejects(cairn(store, { maxStateRows: 6, maxNodes: 6, maxEdges: 6, maxAuditSamples: 6, maxTraceRows: 6 }).invoke('causal.audit', {}, ctx()), (error) => error.code === 'causal_audit_oversize');
  await assert.rejects(cairn(store, { maxArtifactBytes: 64 }).invoke('causal.audit', {}, ctx()), (error) => error.code === 'causal_audit_oversize');
  const refusedArtifactRoot = root('refused-result-artifacts'); const refusedResult = new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: refusedArtifactRoot, knowledgeAuditPolicy: limits({ maxResultBytes: 128 }) });
  await assert.rejects(refusedResult.invoke('causal.audit', {}, ctx()), (error) => error.code === 'causal_audit_oversize'); assert.deepEqual(readdirSync(refusedArtifactRoot), []);
  assert.throws(() => cairn(store, { maxEvidenceRefs: 1_000_001 }), /configuration is invalid/);
  const cancelRoot = root('cancelled-artifacts'); const abort = new AbortController(); const cancelStore = new CoordinationStore(root('cancel-store'), { clock: clock() }); graph(cancelStore); const audit = cancelStore.auditKnowledge.bind(cancelStore); cancelStore.auditKnowledge = (...args) => { const metrics = audit(...args); abort.abort(); return metrics; }; const cancelled = new CairnRunScorecard({ coordination: cancelStore, readOperational: () => [], artifactRoot: cancelRoot, knowledgeAuditPolicy: limits() }); await assert.rejects(cancelled.invoke('causal.audit', {}, ctx({ signal: abort.signal })), (error) => error.code === 'cancelled'); assert.deepEqual(readdirSync(cancelRoot), []);
  const bad = new CoordinationStore(root('audit-samples'), { clock: clock() }); const bg = graph(bad); for (const id of ['unlined-a', 'unlined-b']) bad.addKnowledgeNode({ id: `finding:${id}`, type: 'Finding', grounding: 'verified', body: id, evidence: [{ coordinationSeq: bg.created.event.seq }] }, { actor: 'policy', key: `finding:${id}` });
  const sampled = await cairn(bad, { maxAuditSamples: 1 }).invoke('causal.audit', {}, ctx()); assert.equal(sampled.payload[0].metrics.violations.samples.length, 1); assert.equal(sampled.payload[0].metrics.violations.omittedSamples > 0, true); assert.equal(sampled.payload[0].disposition.status, 'fail');
  void g;
});

test('CA4: dead and ill-typed lineage is critical instead of false green', async () => {
  const store = new CoordinationStore(root('lineage'), { clock: clock() }); const g = graph(store); store.invalidateKnowledge(g.left.node.id, 1, 'Source invalidated.', { actor: 'operator:alice', key: 'invalidate-source' });
  const derived = store.addKnowledgeNode({ id: 'finding:derived', type: 'Finding', grounding: 'verified', body: 'derived', evidence: [{ coordinationSeq: g.created.event.seq }] }, { actor: 'policy', key: 'derived' }); const hypothesis = store.addKnowledgeNode({ id: 'hypothesis:late', type: 'Hypothesis', grounding: 'asserted', body: 'late', evidence: [{ coordinationSeq: g.created.event.seq }] }, { actor: 'policy', key: 'late' }); store.addKnowledgeEdge({ type: 'DerivedFrom', from: derived.node.id, to: hypothesis.node.id, evidence: [{ coordinationSeq: hypothesis.event.seq }] }, { actor: 'policy', key: 'derived:late' });
  const route = store.addKnowledgeNode({ id: 'route:fake', type: 'RouteStat', grounding: 'verified', body: 'fake', evidence: [] }, { actor: 'policy', key: 'route:fake' }); store.addKnowledgeEdge({ type: 'ObservedIn', from: route.node.id, to: hypothesis.node.id, evidence: [{ coordinationSeq: hypothesis.event.seq }] }, { actor: 'policy', key: 'route:fake:edge' });
  const result = await cairn(store).invoke('causal.audit', {}, ctx()); const metrics = result.payload[0].metrics;
  assert.equal(metrics.causalCompleteness.decisions.complete, 0); assert.equal(metrics.groundingLineage.verifiedFindings.complete, 0); assert.equal(metrics.groundingLineage.routeStats.complete, 0); assert.equal(metrics.violations.critical >= 3, true); assert.equal(result.payload[0].disposition.status, 'fail');
  assert.throws(() => store.addKnowledgeNode({ id: 'decision:dead', type: 'Decision', grounding: 'observed', body: 'dead', evidence: [{ coordinationSeq: g.left.event.seq }], informedBy: [g.left.node.id] }, { actor: 'operator:alice', key: 'decision:dead' }), (error) => error.code === 'missing_endpoint');
});

test('CA8/CA9: trace is cycle-safe, bounded, repo-bound, and fully reverifiable', async () => {
  const store = new CoordinationStore(root('trace'), { clock: clock() }); const g = graph(store);
  store.addKnowledgeEdge({ type: 'Supports', from: g.left.node.id, to: g.decision.node.id, evidence: [{ coordinationSeq: g.left.event.seq }] }, { actor: 'policy', key: 'supports:forward' });
  store.addKnowledgeEdge({ type: 'Refines', from: g.decision.node.id, to: g.left.node.id, evidence: [{ coordinationSeq: g.decision.event.seq }] }, { actor: 'policy', key: 'refines:cycle' });
  const capability = cairn(store); const result = await capability.invoke('causal.trace', { nodeId: g.decision.node.id }, ctx({ idempotencyKey: 'trace' })); const traceArgs = { nodeId: g.decision.node.id, observedSeq: result.payload[0].observedSeq };
  assert.equal(result.payload[0].nodes.filter((node) => node.id === g.decision.node.id).length, 1);
  assert.equal(new Set(result.payload[0].nodes.map((node) => node.id)).size, result.payload[0].nodes.length);
  assert.equal(result.payload[0].complete, true); for (const field of ['workerAuthority', 'editAuthority', 'verificationAuthority', 'mergeAuthority', 'approvalAuthority', 'publicationAuthority', 'routingMutationAuthority', 'proofAuthority', 'noteAuthority', 'policyAuthoringAuthority']) assert.equal(result.provenance[field], false);
  assert.equal((await capability.reverify(result, 'causal.trace', traceArgs, ctx())).ok, true);
  const partial = await cairn(store, { maxTraceDepth: 1 }).invoke('causal.trace', { nodeId: g.decision.node.id }, ctx()); assert.equal(partial.status, 'partial'); assert.equal(partial.payload[0].complete, false); assert.equal(partial.payload[0].frontier.length > 0, true);
  const abort = new AbortController(); abort.abort(); await assert.rejects(capability.invoke('causal.trace', { nodeId: g.decision.node.id }, ctx({ signal: abort.signal })), (error) => error.code === 'cancelled');
  await assert.rejects(capability.invoke('causal.trace', { nodeId: g.decision.node.id }, ctx({ repoId: 'repo-b' })), (error) => error.code === 'causal_repo_mismatch');
  await assert.rejects(cairn(store, { maxTraceRows: 1 }).invoke('causal.trace', { nodeId: g.decision.node.id }, ctx()), (error) => error.code === 'causal_trace_oversize');
  await assert.rejects(cairn(store, { maxEvidenceRefs: 1 }).invoke('causal.trace', { nodeId: g.decision.node.id }, ctx()), (error) => error.code === 'causal_trace_oversize');
  await assert.rejects(cairn(store, { maxNodes: 2 }).invoke('causal.trace', { nodeId: g.decision.node.id }, ctx()), (error) => error.code === 'causal_trace_oversize');
  const resolvedStore = new CoordinationStore(root('trace-resolved'), { clock: clock() }); const rg = graph(resolvedStore, { contradiction: true }); resolvedStore.resolveKnowledgeContradiction({ edgeId: rg.conflict.edge.id, winnerId: rg.left.node.id, loserId: rg.right.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Resolved.' }, { actor: 'operator:alice', key: 'trace:resolve' }); const liveTrace = await cairn(resolvedStore).invoke('causal.trace', { nodeId: rg.left.node.id }, ctx()); assert.equal(liveTrace.payload[0].nodes.some((node) => node.id === rg.right.node.id), false); assert.equal(liveTrace.payload[0].edges.some((edge) => edge.type === 'Contradicts'), false);
});

test('CA8: frontier accounting is exact for cross-edges and refuses width overflow', async () => {
  const triangle = new CoordinationStore(root('triangle'), { clock: clock() }); for (const id of ['a', 'b', 'c']) triangle.createTask(task(id), { actor: 'orchestrator', key: `task:${id}` }); for (const [from, to] of [['a', 'b'], ['a', 'c'], ['b', 'c']]) triangle.addKnowledgeEdge({ type: 'Supports', from: `task:${from}`, to: `task:${to}`, evidence: [{ coordinationSeq: 1 }] }, { actor: 'policy', key: `edge:${from}:${to}` });
  const triangleTrace = await cairn(triangle, { maxTraceDepth: 1 }).invoke('causal.trace', { nodeId: 'task:a' }, ctx()); assert.equal(triangleTrace.status, 'ok'); assert.deepEqual(triangleTrace.payload[0].frontier, []);
  const wide = new CoordinationStore(root('wide'), { clock: clock() }); for (const id of ['root', 'mid', ...Array.from({ length: 20 }, (_, index) => `leaf-${index}`)]) wide.createTask(task(id), { actor: 'orchestrator', key: `task:${id}` }); wide.addKnowledgeEdge({ type: 'Supports', from: 'task:root', to: 'task:mid', evidence: [{ coordinationSeq: 1 }] }, { actor: 'policy', key: 'root:mid' }); for (let index = 0; index < 20; index += 1) wide.addKnowledgeEdge({ type: 'Supports', from: 'task:mid', to: `task:leaf-${index}`, evidence: [{ coordinationSeq: 1 }] }, { actor: 'policy', key: `mid:${index}` });
  await assert.rejects(cairn(wide, { maxTraceDepth: 1, maxTraceRows: 10 }).invoke('causal.trace', { nodeId: 'task:root' }, ctx()), (error) => error.code === 'causal_trace_oversize');
});

test('CA1/CA9: authenticated direct, web, and MCP paths preserve repo and idempotency authority', async () => {
  const repo = root('repo'); execFileSync('git', ['init', '-q'], { cwd: repo });
  assert.throws(() => createDriver({ repoRoot: repo, repoId: 'repo-b', logDir: root('mismatched-driver'), adapters: {}, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root('mismatched-artifacts'), knowledgeAuditPolicy: limits() }) }, maxCapabilityBudgetTokens: 32_000, maxCapabilityEnvelopeBytes: 256 * 1024 }), /capability deployment repository mismatch/);
  const driver = createDriver({ repoRoot: repo, repoId: 'repo-a', logDir: root('driver-log'), adapters: {},
    capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root('driver-artifacts'), knowledgeAuditPolicy: limits() }) },
    maxCapabilityBudgetTokens: 32_000, maxCapabilityEnvelopeBytes: 256 * 1024,
  });
  graph(driver.coordination); const observedSeq = driver.coordination.snapshot().lastSeq; const args = { observedSeq };
  const direct = await driver.coordinator.invokeCapability('cairn', 'causal.audit', args, ctx({ idempotencyKey: 'direct:audit' }));
  const origin = 'https://cairn.test'; const principal = { userId: 'alice', sessionId: 'web', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'audit-web', idempotencyKey: 'audit-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.audit', action: 'invoke', args, budgetTokens: 16_000 } });
  assert.equal(webResult.status, 200); assert.equal(webResult.body.result.refs[0].digest, direct.refs[0].digest);
  const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'audit-web-verify', idempotencyKey: 'audit-web-verify', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.audit', action: 'reverify', claim: webResult.body.result, args, budgetTokens: 16_000 } });
  assert.equal(webVerify.status, 200); assert.equal(webVerify.body.result.payload[0].ok, true);
  const webWrongRepo = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'audit-web-wrong', idempotencyKey: 'audit-web-wrong', command: 'capability_invoke', repoId: 'repo-b', origin, args: { name: 'cairn', op: 'causal.audit', action: 'invoke', args, budgetTokens: 16_000 } }); assert.equal(webWrongRepo.status, 403);
  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1_000, maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase47', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'audit-mcp', name: 'cairn', op: 'causal.audit', action: 'invoke', args, budgetTokens: 16_000 } } });
  assert.equal(mcpResult.result.isError, false); assert.equal(mcpResult.result.structuredContent.refs[0].digest, direct.refs[0].digest);
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'audit-mcp-verify', name: 'cairn', op: 'causal.audit', action: 'reverify', claim: mcpResult.result.structuredContent, args, budgetTokens: 16_000 } } });
  assert.equal(mcpVerify.result.isError, false); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true);
  const mcpWrongRepo = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-b', idempotencyKey: 'audit-mcp-wrong', name: 'cairn', op: 'causal.audit', action: 'invoke', args, budgetTokens: 16_000 } } }); assert.equal(mcpWrongRepo.result.isError, true);
  assert.equal(driver.close(), true);
});

test('CA3/CA9/CA10: pinned audit and live trace replay byte-identically after store restart', async () => {
  const dir = root('restart-store'); const artifacts = root('restart-artifacts'); const store = new CoordinationStore(dir, { clock: clock() }); const g = graph(store, { contradiction: true }); const observedSeq = store.snapshot().lastSeq; const first = new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: artifacts, knowledgeAuditPolicy: limits() });
  const auditArgs = { observedSeq }; const traceArgs = { nodeId: g.left.node.id, observedSeq }; const audit = await first.invoke('causal.audit', auditArgs, ctx({ idempotencyKey: 'restart:audit:one' })); const trace = await first.invoke('causal.trace', traceArgs, ctx({ idempotencyKey: 'restart:trace:one' }));
  const replay = new CoordinationStore(dir); const second = new CairnRunScorecard({ coordination: replay, readOperational: () => [], artifactRoot: artifacts, knowledgeAuditPolicy: limits() }); assert.deepEqual(await second.invoke('causal.audit', auditArgs, ctx({ idempotencyKey: 'restart:audit:two' })), audit); assert.deepEqual(await second.invoke('causal.trace', traceArgs, ctx({ idempotencyKey: 'restart:trace:two' })), trace); assert.equal((await second.reverify(audit, 'causal.audit', auditArgs, ctx())).ok, true); assert.equal((await second.reverify(trace, 'causal.trace', traceArgs, ctx())).ok, true);
});
