import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationIntegrityError, CoordinationStore, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name = 'root') => mkdtempSync(join(tmpdir(), `baton-phase48-${name}-`));
const task = (id, runId = null) => ({ id, brief: { goal: id }, deps: [], refines: null, taskType: 'causal-recall', reservedWorkerId: `w-${id}`, ...(runId ? { runId } : {}) });
const auditPolicy = (overrides = {}) => ({
  repoId: 'repo-a', maxStateRows: 512, maxNodes: 128, maxEdges: 256, maxEvidenceRefs: 512,
  maxAuditSamples: 64, maxTraceDepth: 8, maxTraceRows: 256, maxArtifactBytes: 128 * 1024,
  maxResultBytes: 128 * 1024, ...overrides,
});
const recallPolicy = (overrides = {}) => ({
  repoId: 'repo-a', maxQueryBytes: 4_096, maxQueryTerms: 64, maxCandidates: 128,
  maxCandidateBytes: 256 * 1024, maxResults: 16, maxGraphDepth: 8, maxGraphRows: 256,
  maxSnippetBytes: 64, maxReceiptBytes: 64 * 1024, maxResultBytes: 128 * 1024,
  ...overrides,
});
const ctx = (overrides = {}) => ({ actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'phase48:direct', budgetTokens: 16_000, ...overrides });
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');

function clock(start = '2026-07-12T23:00:00.000Z') {
  let now = Date.parse(start);
  return () => new Date(now++).toISOString();
}

function graph(store, { contradiction = false } = {}) {
  const created = store.createTask(task('source'), { actor: 'orchestrator', key: 'task:source' });
  const left = store.addKnowledgeNode({ id: 'finding:left', type: 'Finding', grounding: 'verified', body: 'The retry is idempotent and safe.', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'finding:left' });
  store.addKnowledgeEdge({ type: 'VerifiedBy', from: left.node.id, to: 'task:source', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'finding:left:verified' });
  const decision = store.addKnowledgeNode({ id: 'decision:retry', type: 'Decision', grounding: 'observed', body: 'Retain the retry.', evidence: [{ coordinationSeq: left.event.seq }], informedBy: [left.node.id] }, { actor: 'operator:alice', key: 'decision:retry' });
  const unrelated = store.addKnowledgeNode({ id: 'hypothesis:unrelated', type: 'Hypothesis', grounding: 'asserted', body: 'Unrelated scheduler conjecture.', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'unrelated' });
  if (!contradiction) return { created, left, decision, unrelated };
  const right = store.addKnowledgeNode({ id: 'finding:right', type: 'Finding', grounding: 'observed', body: 'The retry duplicates side effects.', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'finding:right' });
  const conflict = store.addKnowledgeEdge({ type: 'Contradicts', from: left.node.id, to: right.node.id, evidence: [{ coordinationSeq: right.event.seq }] }, { actor: 'operator:alice', key: 'contradiction:create' });
  return { created, left, right, conflict, decision, unrelated };
}

function cairn(store, recallOverrides = {}, auditOverrides = {}) {
  return new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('artifacts'), knowledgeAuditPolicy: auditPolicy(auditOverrides), knowledgeRecallPolicy: recallPolicy(recallOverrides) });
}

test('BR1/BR3/BR4/BR6/BR8: deterministic bounded pull recall appends one compact receipt before content', async () => {
  const store = new CoordinationStore(root('basic-store'), { clock: clock() }); graph(store); const capability = cairn(store); const observedSeq = store.snapshot().lastSeq;
  assert.equal(capability.card().ops['causal.recall'].side_effects.includes('coordination.append'), true);
  assert.equal(store.previewKnowledgeRecallBounded, undefined, 'there is no public unreceipted preview oracle');
  const result = await capability.invoke('causal.recall', { text: 'retry', limit: 2, observedSeq, types: ['Finding', 'Decision'], reader: { taskId: 'source' } }, ctx());
  const document = result.payload[0];
  assert.equal(result.status, 'ok'); assert.match(document.frame, /^UNTRUSTED_RECALLED_MEMORY/); assert.equal(document.coordinationUpperBound, observedSeq);
  assert.deepEqual(document.nodes.map((node) => node.id), ['decision:retry', 'finding:left']);
  assert.deepEqual(document.nodes.map((node) => ({ id: node.id, score: node.score, reason: node.reason })), [
    { id: 'decision:retry', score: 140, reason: { idExact: false, idMatches: 1, typeMatches: 0, bodyMatches: 1, graphDistance: 0, graphScore: 30, selected: true, contradictionPeer: false } },
    { id: 'finding:left', score: 40, reason: { idExact: false, idMatches: 0, typeMatches: 0, bodyMatches: 1, graphDistance: 0, graphScore: 30, selected: true, contradictionPeer: false } },
  ]);
  assert.equal(document.nodes.every((node) => Number.isSafeInteger(node.score) && Buffer.byteLength(node.snippet) <= recallPolicy().maxSnippetBytes), true);
  assert.equal(result.provenance.readOnly, false); assert.equal(result.provenance.coordinationEffect, 'knowledge.read_receipt');
  for (const field of ['workerAuthority', 'editAuthority', 'verificationAuthority', 'mergeAuthority', 'approvalAuthority', 'publicationAuthority', 'routingMutationAuthority', 'proofAuthority', 'noteAuthority', 'policyAuthoringAuthority']) assert.equal(result.provenance[field], false);
  const receipt = store.events(document.receipt.eventSeq, 1)[0]; assert.equal(receipt.kind, 'knowledge.recall'); assert.equal(receipt.actor, 'operator:alice');
  const receiptText = JSON.stringify(receipt); for (const secret of ['Retain the retry.', 'The retry is idempotent', '"text":"retry"', 'snippet']) assert.equal(receiptText.includes(secret), false);
  assert.deepEqual(receipt.payload.nodeIds, document.nodes.map((node) => node.id)); assert.equal(receipt.payload.receiptDigest, document.receipt.digest);
  assert.equal(store.snapshot().knowledge.reads.at(-1).eventSeq, receipt.seq);
  assert.equal(store.queryKnowledgeEdges({ observedSeq: store.snapshot().lastSeq }).filter((edge) => edge.type === 'ReadBy' && edge.to === 'task:source').length, 2);
  assert.equal(store.snapshot().lastSeq, observedSeq + 1, 'the operation appends exactly one receipt event');
});

test('BR2/BR5: audit failures refuse and unresolved contradictions are returned only as complete bundles', async () => {
  const store = new CoordinationStore(root('contradiction-store'), { clock: clock() }); const g = graph(store, { contradiction: true }); const capability = cairn(store); const observedSeq = store.snapshot().lastSeq;
  await assert.rejects(capability.invoke('causal.recall', { text: 'duplicates', limit: 1, observedSeq, reader: {} }, ctx({ idempotencyKey: 'bundle:too-small' })), (error) => error.code === 'causal_recall_oversize');
  const result = await capability.invoke('causal.recall', { text: 'duplicates', limit: 2, observedSeq, reader: {} }, ctx({ idempotencyKey: 'bundle:complete' }));
  assert.deepEqual(new Set(result.payload[0].nodes.map((node) => node.id)), new Set([g.left.node.id, g.right.node.id]));
  assert.deepEqual(result.payload[0].contradictions, [{ edgeId: g.conflict.edge.id, from: g.left.node.id, to: g.right.node.id, status: 'unresolved' }]);
  const resolved = store.resolveKnowledgeContradiction({ edgeId: g.conflict.edge.id, winnerId: g.left.node.id, loserId: g.right.node.id, expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Verified idempotency wins.' }, { actor: 'operator:alice', key: 'resolve' });
  const historical = await capability.invoke('causal.recall', { text: 'duplicates', limit: 2, observedSeq, reader: {} }, ctx({ idempotencyKey: 'bundle:historical' })); assert.deepEqual(historical.payload[0].contradictions, result.payload[0].contradictions);
  const current = await capability.invoke('causal.recall', { text: 'duplicates', limit: 2, observedSeq: resolved.contamination.seq, reader: {} }, ctx({ idempotencyKey: 'bundle:current' })); assert.deepEqual(current.payload[0].nodes, []); assert.deepEqual(current.payload[0].contradictions, []);

  const bad = new CoordinationStore(root('bad-audit'), { clock: clock() }); const created = bad.createTask(task('source'), { actor: 'orchestrator', key: 'task' }); bad.addKnowledgeNode({ id: 'finding:orphan', type: 'Finding', grounding: 'verified', body: 'orphan', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'orphan' }); const before = bad.snapshot().lastSeq;
  await assert.rejects(cairn(bad).invoke('causal.recall', { text: 'orphan', limit: 1, observedSeq: before, reader: {} }, ctx({ idempotencyKey: 'audit:fail' })), (error) => error.code === 'causal_recall_audit_failed'); assert.equal(bad.snapshot().lastSeq, before);
});

test('BR3/BR4/BR6/BR8: closed requests and every deployment ceiling fail closed at max+1', async () => {
  const store = new CoordinationStore(root('limits-store'), { clock: clock() }); graph(store); const observedSeq = store.snapshot().lastSeq;
  const invoke = (capability, args, key) => capability.invoke('causal.recall', { text: 'retry', limit: 1, observedSeq, reader: {}, ...args }, ctx({ idempotencyKey: key }));
  await assert.rejects(invoke(cairn(store), { extra: true }, 'bad:field'), (error) => error.code === 'causal_recall_invalid');
  await assert.rejects(invoke(cairn(store), { text: 'retry\0hidden' }, 'bad:nul'), (error) => error.code === 'causal_recall_invalid');
  await assert.rejects(invoke(cairn(store), { text: '\uD800 retry' }, 'bad:unicode'), (error) => error.code === 'causal_recall_invalid');
  await assert.rejects(invoke(cairn(store, { maxQueryBytes: 4 }), { text: '12345' }, 'bad:bytes'), (error) => error.code === 'causal_recall_oversize');
  await assert.rejects(invoke(cairn(store, { maxQueryTerms: 1 }), { text: 'retry second' }, 'bad:terms'), (error) => error.code === 'causal_recall_oversize');
  await assert.rejects(invoke(cairn(store, { maxCandidates: 3 }), {}, 'bad:candidates'), (error) => error.code === 'causal_recall_oversize');
  await assert.rejects(invoke(cairn(store, { maxCandidateBytes: 1 }), {}, 'bad:candidate-bytes'), (error) => error.code === 'causal_recall_oversize');
  await assert.rejects(invoke(cairn(store, { maxResults: 1 }), { limit: 2 }, 'bad:results'), (error) => error.code === 'causal_recall_invalid');
  await assert.rejects(invoke(cairn(store, { maxGraphRows: 1 }), {}, 'bad:graph'), (error) => error.code === 'causal_recall_oversize');
  await assert.rejects(invoke(cairn(store, { maxReceiptBytes: 1 }), {}, 'bad:receipt'), (error) => error.code === 'causal_recall_oversize');
  await assert.rejects(invoke(cairn(store, { maxResultBytes: 1 }), {}, 'bad:result'), (error) => error.code === 'causal_recall_oversize');
  assert.equal(store.snapshot().knowledge.reads.length, 0);
});

test('BR6/BR7/BR9: receipt, ReadBy, contamination, replay, and read-only reverify are exact', async () => {
  const dir = root('replay-store'); const store = new CoordinationStore(dir, { clock: clock() }); const g = graph(store); const capability = cairn(store); const observedSeq = store.snapshot().lastSeq; const args = { text: 'idempotent', limit: 1, observedSeq, reader: { taskId: 'source' } };
  const claim = await capability.invoke('causal.recall', args, ctx({ idempotencyKey: 'replay:invoke' })); const afterInvoke = store.snapshot().lastSeq;
  assert.equal((await capability.reverify(claim, 'causal.recall', args, ctx({ idempotencyKey: 'replay:verify' }))).ok, true); assert.equal(store.snapshot().lastSeq, afterInvoke, 'reverify is read-only');
  store.claimTask('source', 'w-source', 1, { actor: 'orchestrator', key: 'claim:after-read' });
  assert.equal((await capability.reverify(claim, 'causal.recall', args, ctx({ idempotencyKey: 'replay:verify-after-claim' }))).ok, true, 'later task assignment cannot rewrite historical reader identity');
  const afterClaim = store.snapshot().lastSeq; const duplicate = await capability.invoke('causal.recall', args, ctx({ idempotencyKey: 'replay:invoke' })); assert.deepEqual(duplicate, claim); assert.equal(store.snapshot().lastSeq, afterClaim);
  await assert.rejects(capability.invoke('causal.recall', { ...args, text: 'changed' }, ctx({ idempotencyKey: 'replay:invoke' })), (error) => error.code === 'knowledge_recall_conflict');
  const invalidated = store.invalidateKnowledge(g.left.node.id, 1, 'New evidence.', { actor: 'operator:alice', key: 'invalidate' }); assert.deepEqual(invalidated.contamination.payload.affectedReadEvents, [claim.payload[0].receipt.eventSeq]); assert.equal(store.affectedReaders(g.left.node.id)[0].taskStatus, 'working'); assert.equal(store.affectedReaders(g.left.node.id)[0].readerWorker, null, 'receipt retains the worker identity at read time');
  store.releaseWriterLease(); const replay = new CoordinationStore(dir); const restarted = cairn(replay); assert.equal((await restarted.reverify(claim, 'causal.recall', args, ctx())).ok, true); assert.deepEqual(replay.affectedReaders(g.left.node.id), store.affectedReaders(g.left.node.id));

  const file = join(dir, 'events.jsonl'); const original = readFileSync(file, 'utf8'); const rows = original.trimEnd().split('\n').map(JSON.parse); rows.find((event) => event.kind === 'knowledge.recall').payload.nodeIds = ['finding:substituted']; writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError && error.code === 'knowledge_recall_integrity'); writeFileSync(file, original);

  const requestRows = original.trimEnd().split('\n').map(JSON.parse); const requestReceipt = requestRows.find((event) => event.kind === 'knowledge.recall'); requestReceipt.payload.requestDigest = 'f'.repeat(64);
  const { receiptDigest: _receiptDigest, ...requestCore } = requestReceipt.payload; requestReceipt.payload.receiptDigest = digest(requestCore); writeFileSync(file, `${requestRows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError && error.code === 'knowledge_recall_integrity', 'restart recomputes compact request identity rather than trusting a self-consistent opaque digest'); writeFileSync(file, original);
});

test('BR6: a worker claimed before recall is bound into the historical reader receipt', async () => {
  const dir = root('reader-worker-store'); const store = new CoordinationStore(dir, { clock: clock() }); graph(store); store.claimTask('source', 'w-source', 1, { actor: 'orchestrator', key: 'claim:before-read' });
  const observedSeq = store.snapshot().lastSeq; const args = { text: 'idempotent', limit: 1, observedSeq, reader: { taskId: 'source' } }; const capability = cairn(store);
  const claim = await capability.invoke('causal.recall', args, ctx({ idempotencyKey: 'worker:invoke' })); const receipt = store.events(claim.payload[0].receipt.eventSeq, 1)[0]; assert.equal(receipt.payload.readerWorker, 'w-source');
  assert.equal((await capability.reverify(claim, 'causal.recall', args, ctx({ idempotencyKey: 'worker:verify' }))).ok, true);
  store.releaseWriterLease(); const restarted = new CoordinationStore(dir); assert.equal(restarted.events(claim.payload[0].receipt.eventSeq, 1)[0].payload.readerWorker, 'w-source'); restarted.releaseWriterLease();
});

test('BR2/BR6: cancellation and receipt append failure publish no recalled content', async () => {
  const store = new CoordinationStore(root('failure-store'), { clock: clock() }); graph(store); const observedSeq = store.snapshot().lastSeq; const before = store.snapshot().lastSeq;
  const abort = new AbortController(); const audit = store.auditKnowledge.bind(store); store.auditKnowledge = (...args) => { const result = audit(...args); abort.abort(); return result; };
  await assert.rejects(cairn(store).invoke('causal.recall', { text: 'retry', limit: 1, observedSeq, reader: {} }, ctx({ idempotencyKey: 'cancel', signal: abort.signal })), (error) => error.code === 'cancelled'); assert.equal(store.snapshot().lastSeq, before);
  store.auditKnowledge = audit; store._appendFile = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  await assert.rejects(cairn(store).invoke('causal.recall', { text: 'retry', limit: 1, observedSeq, reader: {} }, ctx({ idempotencyKey: 'append:fail' })), /disk full/); assert.equal(store.snapshot().lastSeq, before);
});

test('BR1/BR9: direct, authenticated web, and authenticated MCP use the same repository-bound operation', async () => {
  const repo = root('repo'); execFileSync('git', ['init', '-q'], { cwd: repo });
  const driver = createDriver({ repoRoot: repo, repoId: 'repo-a', logDir: root('driver-log'), adapters: {},
    capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root('driver-artifacts'), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy() }) },
    maxCapabilityBudgetTokens: 32_000, maxCapabilityEnvelopeBytes: 256 * 1024,
  });
  graph(driver.coordination); const observedSeq = driver.coordination.snapshot().lastSeq; const args = { text: 'idempotent', limit: 1, observedSeq, reader: {} };
  const direct = await driver.coordinator.invokeCapability('cairn', 'causal.recall', args, ctx({ idempotencyKey: 'direct' }));
  const origin = 'https://cairn.test'; const principal = { userId: 'alice', sessionId: 'web', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'recall-web', idempotencyKey: 'recall-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.recall', action: 'invoke', args, budgetTokens: 16_000 } }); assert.equal(webResult.status, 200); assert.deepEqual(webResult.body.result.payload[0].nodes, direct.payload[0].nodes);
  const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'recall-web-verify', idempotencyKey: 'recall-web-verify', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.recall', action: 'reverify', claim: webResult.body.result, args, budgetTokens: 16_000 } }); assert.equal(webVerify.status, 200); assert.equal(webVerify.body.result.payload[0].ok, true);
  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1_000, maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase48', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'recall-mcp', name: 'cairn', op: 'causal.recall', action: 'invoke', args, budgetTokens: 16_000 } } }); assert.equal(mcpResult.result.isError, false); assert.deepEqual(mcpResult.result.structuredContent.payload[0].nodes, direct.payload[0].nodes);
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'recall-mcp-verify', name: 'cairn', op: 'causal.recall', action: 'reverify', claim: mcpResult.result.structuredContent, args, budgetTokens: 16_000 } } }); assert.equal(mcpVerify.result.isError, false); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true);
  assert.equal(driver.close(), true);
});

test('BR6/BR9: ACI budget and envelope refusals occur before any recall or ReadBy effect', async () => {
  const buildDriver = (name, maxCapabilityEnvelopeBytes) => {
    const repo = root(`${name}-repo`); execFileSync('git', ['init', '-q'], { cwd: repo });
    return createDriver({ repoRoot: repo, repoId: 'repo-a', logDir: root(`${name}-log`), adapters: {},
      capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root(`${name}-artifacts`), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy() }) },
      maxCapabilityBudgetTokens: 32_000, maxCapabilityEnvelopeBytes,
    });
  };
  const budgetDriver = buildDriver('budget-preflight', 256 * 1024); graph(budgetDriver.coordination); const budgetObservedSeq = budgetDriver.coordination.snapshot().lastSeq; const budgetReads = budgetDriver.coordination.snapshot().knowledge.reads.length;
  await assert.rejects(budgetDriver.coordinator.invokeCapability('cairn', 'causal.recall', { text: 'retry', limit: 2, observedSeq: budgetObservedSeq, reader: {} }, ctx({ idempotencyKey: 'budget:refuse', budgetTokens: 1 })), (error) => error.code === 'capability_result_oversize');
  assert.equal(budgetDriver.coordination.snapshot().knowledge.reads.length, budgetReads); assert.equal(budgetDriver.coordination.events(1, budgetDriver.coordination.snapshot().lastSeq).some((event) => event.kind === 'knowledge.recall'), false); budgetDriver.close();

  const envelopeDriver = buildDriver('envelope-preflight', 4 * 1024); graph(envelopeDriver.coordination);
  const taskEvent = envelopeDriver.coordination.events(1, 1)[0]; for (let index = 0; index < 12; index += 1) envelopeDriver.coordination.addKnowledgeNode({ id: `finding:bulk-${index}`, type: 'Finding', grounding: 'observed', body: `bulk ${'x'.repeat(512)} ${index}`, evidence: [{ coordinationSeq: taskEvent.seq }] }, { actor: 'policy', key: `bulk:${index}` });
  const envelopeObservedSeq = envelopeDriver.coordination.snapshot().lastSeq; const envelopeReads = envelopeDriver.coordination.snapshot().knowledge.reads.length;
  await assert.rejects(envelopeDriver.coordinator.invokeCapability('cairn', 'causal.recall', { text: 'bulk', limit: 12, observedSeq: envelopeObservedSeq, reader: {} }, ctx({ idempotencyKey: 'envelope:refuse', budgetTokens: 32_000 })), (error) => error.code === 'capability_result_oversize');
  assert.equal(envelopeDriver.coordination.snapshot().knowledge.reads.length, envelopeReads); assert.equal(envelopeDriver.coordination.events(1, envelopeDriver.coordination.snapshot().lastSeq).some((event) => event.kind === 'knowledge.recall'), false); envelopeDriver.close();
});

test('BR1: recall configuration is exact, same-repository, and optional without changing Phase 47', () => {
  const store = new CoordinationStore(root('config-store'));
  assert.equal(new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('audit-only'), knowledgeAuditPolicy: auditPolicy() }).card().ops['causal.recall'], undefined);
  assert.throws(() => new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('recall-only'), knowledgeRecallPolicy: recallPolicy() }), /recall configuration is invalid/);
  assert.throws(() => new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('mismatch'), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy({ repoId: 'repo-b' }) }), /recall configuration is invalid/);
  assert.throws(() => cairn(store, { surprise: 1 }), /recall configuration is invalid/);
});
