import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationIntegrityError, CoordinationStore, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name = 'root') => mkdtempSync(join(tmpdir(), `baton-phase49-${name}-`));
const task = (id) => ({ id, brief: { goal: `SECRET brief ${id}` }, deps: [], refines: null, taskType: 'promotion', reservedWorkerId: `w-${id}` });
const auditPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxStateRows: 1024, maxNodes: 256, maxEdges: 512, maxEvidenceRefs: 1024, maxAuditSamples: 128, maxTraceDepth: 8, maxTraceRows: 512, maxArtifactBytes: 256 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const promotionPolicy = (overrides = {}) => ({ repoId: 'repo-a', minScratchReaders: 2, maxScanEvents: 1024, maxCandidates: 128, maxCandidateBytes: 256 * 1024, maxEvidenceRefs: 1024, maxBatchBytes: 512 * 1024, maxResultBytes: 128 * 1024, ...overrides });
const ctx = (overrides = {}) => ({ actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'phase49:direct', budgetTokens: 16_000, ...overrides });
function clock(start = '2026-07-13T08:00:00.000Z') { let now = Date.parse(start); return () => new Date(now++).toISOString(); }
function cairn(store, promotionOverrides = {}, auditOverrides = {}) { return new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('artifacts'), knowledgeAuditPolicy: auditPolicy(auditOverrides), knowledgePromotionPolicy: promotionPolicy(promotionOverrides) }); }

function completed(store, id, actor = 'orchestrator') {
  const created = store.createTask(task(id), { actor, key: `task:${id}` });
  store.claimTask(id, `w-${id}`, 1, { actor: 'orchestrator', key: `claim:${id}` });
  store.transitionTask(id, 'completed', 2, { actor: 'policy', key: `complete:${id}` });
  const outcome = store.promoteKnowledgeNode({ id: `outcome:${id}`, taskId: id, type: 'Finding', grounding: 'verified', body: `Task ${id} passed its hub verification`, evidence: [{ coordinationSeq: created.event.seq }] }, { kind: 'Finding', trigger: 'verified_task_outcome' }, { actor: 'policy', key: `outcome:${id}` });
  return { created, outcome };
}

function mixed(store) {
  const a = completed(store, 'a'); const b = completed(store, 'b', 'operator:bob');
  const fact = store.postScratchFact({ namespace: 'tests', key: 'fact:retry', value: 'SECRET scratch value /Users/alice/private', grounding: 'observed', envRef: { repoId: 'repo-a', treeSha: 'cafe1234' }, ownerTask: 'a' }, { actor: 'w-a', key: 'scratch:observed' });
  store.readScratch('fact:retry', { repoId: 'repo-a', treeSha: 'cafe1234' }, { readerActor: 'worker', readerWorker: 'w-a', taskId: 'a' }, { actor: 'worker:a', key: 'read:a' });
  store.readScratch('fact:retry', { repoId: 'repo-a', treeSha: 'cafe1234' }, { readerActor: 'worker', readerWorker: 'w-b', taskId: 'b' }, { actor: 'worker:b', key: 'read:b' });
  const derived = store.postScratchFact({ namespace: 'tests', key: 'fact:derived', value: 'SECRET derived', grounding: 'derived', envRef: { repoId: 'repo-a', treeSha: 'cafe1234' } }, { actor: 'w-a', key: 'scratch:derived' });
  const cross = store.postScratchFact({ namespace: 'tests', key: 'fact:cross', value: 'SECRET cross', grounding: 'observed', envRef: { repoId: 'repo-b', treeSha: 'cafe1234' } }, { actor: 'w-a', key: 'scratch:cross' });
  store.recordDriver('control.stop_requested', { taskId: 'a', reason: 'SECRET prompt', path: '/Users/alice/private' }, { actor: 'operator:alice', key: 'driver:stop' });
  store.recordDriver('integration.refused', { taskId: 'b', reason: 'SECRET merge failure' }, { actor: 'policy', key: 'driver:failure' });
  store.recordDriver('input.requested', { taskId: 'a', prompt: 'SECRET input' }, { actor: 'operator:alice', key: 'driver:excluded' });
  return { a, b, fact, derived, cross };
}

test('SP1-SP9: a pinned mixed prefix promotes one safe deterministic atomic batch and reverifies after restart', async () => {
  const dir = root('mixed-store'); const store = new CoordinationStore(dir, { clock: clock() }); mixed(store); const capability = cairn(store); const observedSeq = store.snapshot().lastSeq;
  assert.equal(capability.card().ops['causal.promote'].preflight_output, true);
  const result = await capability.invoke('causal.promote', { observedSeq }, ctx()); const document = result.payload[0];
  assert.equal(document.candidateCount, 5); assert.deepEqual(document.candidates.map((row) => row.type), ['Decision', 'Decision', 'Finding', 'Decision', 'Counterexample']);
  assert.deepEqual(document.candidates.map((row) => row.sourceSeq), [...document.candidates.map((row) => row.sourceSeq)].sort((a, b) => a - b));
  assert.equal(store.snapshot().lastSeq, observedSeq + 1); const receipt = store.events(document.receipt.eventSeq, 1)[0]; assert.equal(receipt.kind, 'knowledge.promotion_batch');
  const durable = JSON.stringify(receipt); for (const secret of ['SECRET', '/Users/alice/private', 'fact:retry', '"value"', '"brief"', '"reason"', '"path"', '"prompt"']) assert.equal(durable.includes(secret), false, secret);
  assert.equal(receipt.payload.nodes.length, 6, 'the cited fact adds one metadata-only ScratchFact source'); assert.equal(receipt.payload.edges.length, 7);
  assert.deepEqual(new Set(receipt.payload.edges.map((edge) => edge.type)), new Set(['Informed', 'ObservedIn', 'DerivedFrom', 'VerifiedBy']));
  assert.equal((await capability.reverify(result, 'causal.promote', { observedSeq }, ctx())).ok, true);
  assert.deepEqual(await capability.invoke('causal.promote', { observedSeq }, ctx()), result);
  const nextBoundary = store.snapshot().lastSeq; const noOp = await capability.invoke('causal.promote', { observedSeq: nextBoundary }, ctx({ idempotencyKey: 'phase49:no-op' })); assert.equal(noOp.payload[0].noOp, true); assert.equal(store.snapshot().lastSeq, nextBoundary);
  assert.equal((await capability.reverify(noOp, 'causal.promote', { observedSeq: nextBoundary }, ctx({ idempotencyKey: 'phase49:no-op' }))).ok, true);
  store.releaseWriterLease(); const replay = new CoordinationStore(dir); assert.deepEqual(new Set(replay.queryKnowledge({ observedSeq: replay.snapshot().lastSeq }).filter((node) => node.id.startsWith('promotion:')).map((node) => node.id)), new Set(receipt.payload.candidates.map((row) => row.nodeId)));
  assert.equal((await cairn(replay).reverify(result, 'causal.promote', { observedSeq }, ctx())).ok, true);
});

test('SP3/SP4: derived, cross-repo, expired, under-cited, stale-grounding, policy-authored, and arbitrary sources remain quarantined', async () => {
  const store = new CoordinationStore(root('excluded'), { clock: clock() }); const a = completed(store, 'a'); const b = completed(store, 'b');
  const under = store.postScratchFact({ namespace: 'x', key: 'under', value: 'never copied', grounding: 'observed', envRef: { repoId: 'repo-a', treeSha: 'cafe1234' } }, { actor: 'w-a', key: 'under' });
  store.readScratch('under', { repoId: 'repo-a', treeSha: 'cafe1234' }, { taskId: 'a' }, { actor: 'w-a', key: 'under:read' });
  const expired = store.postScratchFact({ namespace: 'x', key: 'expired', value: 'never copied', grounding: 'observed', envRef: { repoId: 'repo-a', treeSha: 'cafe1234' } }, { actor: 'w-a', key: 'expired' }); store.expireScratchFact(expired.fact.id, { actor: 'policy', key: 'expired:expire' });
  store.recordDriver('publication.authorized', { taskId: 'a' }, { actor: 'policy', key: 'policy:positive' });
  store.recordDriver('integration.refused', { taskId: 'a' }, { actor: 'worker:forged', key: 'worker:failure' });
  store.recordDriver('route.observed', { taskId: 'a' }, { actor: 'operator:alice', key: 'arbitrary' });
  const stale = store.postScratchFact({ namespace: 'x', key: 'stale-grounding', value: 'never copied', grounding: 'observed', envRef: { repoId: 'repo-a', treeSha: 'cafe1234' } }, { actor: 'w-a', key: 'stale' });
  store.readScratch('stale-grounding', { repoId: 'repo-a', treeSha: 'cafe1234' }, { taskId: 'a' }, { actor: 'w-a', key: 'stale:read:a' });
  store.readScratch('stale-grounding', { repoId: 'repo-a', treeSha: 'cafe1234' }, { taskId: 'b' }, { actor: 'w-b', key: 'stale:read:b' });
  store.invalidateKnowledge(b.outcome.node.id, 1, 'Independent verification was withdrawn.', { actor: 'operator:alice', key: 'stale:invalidate' });
  const observedSeq = store.snapshot().lastSeq; const result = await cairn(store, { minScratchReaders: 2 }).invoke('causal.promote', { observedSeq }, ctx());
  assert.deepEqual(result.payload[0].candidates.map((row) => row.trigger), ['coordination.spawn', 'coordination.spawn']);
  assert.equal(result.payload[0].candidates.some((row) => [under.event.seq, expired.event.seq, stale.event.seq].includes(row.sourceSeq)), false); void a;
});

test('SP6/SP8: scan, candidate, byte, evidence, batch, result, cancellation, and append failures leave no effect', async () => {
  const make = () => { const store = new CoordinationStore(root('ceiling'), { clock: clock() }); completed(store, 'a'); completed(store, 'b'); return store; };
  for (const [overrides, code = 'causal_promotion_oversize'] of [
    [{ maxScanEvents: 1 }], [{ maxCandidates: 1 }], [{ maxCandidateBytes: 1 }], [{ maxEvidenceRefs: 1 }], [{ maxBatchBytes: 64 }], [{ maxResultBytes: 64 }],
  ]) { const store = make(); const before = store.snapshot().lastSeq; await assert.rejects(cairn(store, overrides).invoke('causal.promote', { observedSeq: before }, ctx()), (error) => error.code === code); assert.equal(store.snapshot().lastSeq, before); }
  const cancelled = make(); const abort = new AbortController(); abort.abort(); const cancelBefore = cancelled.snapshot().lastSeq; await assert.rejects(cairn(cancelled).invoke('causal.promote', { observedSeq: cancelBefore }, ctx({ signal: abort.signal })), (error) => error.code === 'cancelled'); assert.equal(cancelled.snapshot().lastSeq, cancelBefore);
  const failed = make(); const failedBefore = failed.snapshot().lastSeq; failed._appendFile = () => { throw new Error('disk full'); }; await assert.rejects(cairn(failed).invoke('causal.promote', { observedSeq: failedBefore }, ctx()), /disk full/); assert.equal(failed.snapshot().lastSeq, failedBefore);
});

test('SP7/SP9: idempotency and durable receipt tampering fail closed', async () => {
  const dir = root('tamper'); const store = new CoordinationStore(dir, { clock: clock() }); completed(store, 'a'); const observedSeq = store.snapshot().lastSeq; const capability = cairn(store); const result = await capability.invoke('causal.promote', { observedSeq }, ctx());
  await assert.rejects(capability.invoke('causal.promote', { observedSeq: observedSeq - 1 }, ctx()), (error) => error.code === 'causal_promotion_conflict');
  for (const mutate of [(row) => { row.payload.nodes[0].body = 'substituted'; }, (row) => { row.payload.requestDigest = '0'.repeat(64); }, (row) => { row.payload.receiptDigest = '0'.repeat(64); }]) {
    const file = join(dir, 'events.jsonl'); const original = readFileSync(file, 'utf8'); const rows = original.trimEnd().split('\n').map(JSON.parse); mutate(rows.find((row) => row.kind === 'knowledge.promotion_batch')); writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`); store.releaseWriterLease(); assert.throws(() => new CoordinationStore(dir), (error) => error instanceof CoordinationIntegrityError); writeFileSync(file, original); new CoordinationStore(dir).releaseWriterLease();
  }
  const tampered = structuredClone(result); tampered.payload[0].candidateCount += 1; assert.equal((await capability.reverify(tampered, 'causal.promote', { observedSeq }, ctx())).ok, false);
});

test('SP1/SP8/SP9: direct, authenticated web, and MCP routes share exact promotion and reverify authority', async () => {
  const repo = root('repo'); execFileSync('git', ['init', '-q'], { cwd: repo }); const logDir = root('driver-log');
  const driver = createDriver({ repoRoot: repo, repoId: 'repo-a', logDir, adapters: {}, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root('driver-artifacts'), knowledgeAuditPolicy: auditPolicy(), knowledgePromotionPolicy: promotionPolicy() }) }, maxCapabilityBudgetTokens: 32_000, maxCapabilityEnvelopeBytes: 256 * 1024 });
  completed(driver.coordination, 'a'); const observedSeq = driver.coordination.snapshot().lastSeq; const args = { observedSeq };
  const direct = await driver.coordinator.invokeCapability('cairn', 'causal.promote', args, ctx({ idempotencyKey: 'direct' }));
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.promote', args, ctx({ actor: 'orchestrator', transport: 'web', idempotencyKey: 'orchestrator-web-smuggle' })), (error) => error.code === 'causal_promotion_forbidden');
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.promote', args, ctx({ actor: 'web:forged:session', idempotencyKey: 'direct-web-smuggle' })), (error) => error.code === 'causal_promotion_forbidden');
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.promote', args, ctx({ actor: 'web:forged:session', transport: 'mcp', idempotencyKey: 'mismatched-transport' })), (error) => error.code === 'causal_promotion_forbidden');
  completed(driver.coordination, 'b'); const webBoundary = driver.coordination.snapshot().lastSeq;
  const origin = 'https://cairn.test'; const principal = { userId: 'alice', sessionId: 'web', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'promote-web', idempotencyKey: 'promote-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.promote', action: 'invoke', args: { observedSeq: webBoundary }, budgetTokens: 16_000 } }); assert.equal(webResult.status, 200, JSON.stringify(webResult.body)); assert.equal(webResult.body.result.payload[0].noOp, false); assert.equal(driver.coordination.events(webResult.body.result.payload[0].receipt.eventSeq, 1)[0].actor, 'operator:web:alice:web');
  const webArgs = { observedSeq: webResult.body.result.payload[0].coordinationUpperBound }; const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', remoteAddress: '127.0.0.1', transport: 'https' }, { schemaVersion: 1, commandId: 'promote-web-verify', idempotencyKey: 'promote-web-verify', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.promote', action: 'reverify', claim: webResult.body.result, args: webArgs, budgetTokens: 16_000 } }); assert.equal(webVerify.status, 200); assert.equal(webVerify.body.result.payload[0].ok, true);
  completed(driver.coordination, 'c');
  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1_000, maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }) }); await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase49', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpArgs = { observedSeq: driver.coordination.snapshot().lastSeq }; const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'promote-mcp', name: 'cairn', op: 'causal.promote', action: 'invoke', args: mcpArgs, budgetTokens: 16_000 } } }); assert.equal(mcpResult.result.isError, false); assert.equal(mcpResult.result.structuredContent.payload[0].noOp, false); assert.equal(driver.coordination.events(mcpResult.result.structuredContent.payload[0].receipt.eventSeq, 1)[0].actor, 'operator:mcp:bob:mcp');
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'promote-mcp-verify', name: 'cairn', op: 'causal.promote', action: 'reverify', claim: mcpResult.result.structuredContent, args: mcpArgs, budgetTokens: 16_000 } } }); assert.equal(mcpVerify.result.isError, false); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true);
  assert.equal(direct.payload[0].candidateCount, 1); driver.close();
});

test('SP1: promotion configuration is exact, same-repository, and optional', () => {
  const store = new CoordinationStore(root('config'));
  assert.equal(new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('audit-only'), knowledgeAuditPolicy: auditPolicy() }).card().ops['causal.promote'], undefined);
  assert.throws(() => new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('promotion-only'), knowledgePromotionPolicy: promotionPolicy() }), /promotion configuration is invalid/);
  assert.throws(() => cairn(store, { repoId: 'repo-b' }), /promotion configuration is invalid/);
  assert.throws(() => cairn(store, { surprise: 1 }), /promotion configuration is invalid/);
});

test('SP8: ACI budget refusal happens before any promotion batch effect', async () => {
  const repo = root('aci-repo'); execFileSync('git', ['init', '-q'], { cwd: repo });
  const driver = createDriver({ repoRoot: repo, repoId: 'repo-a', logDir: root('aci-log'), adapters: {}, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root('aci-artifacts'), knowledgeAuditPolicy: auditPolicy(), knowledgePromotionPolicy: promotionPolicy() }) }, maxCapabilityBudgetTokens: 32_000, maxCapabilityEnvelopeBytes: 256 * 1024 });
  completed(driver.coordination, 'a'); const observedSeq = driver.coordination.snapshot().lastSeq;
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.promote', { observedSeq }, ctx({ idempotencyKey: 'aci:small', budgetTokens: 1 })), (error) => error.code === 'capability_result_oversize');
  assert.equal(driver.coordination.events().some((event) => event.kind === 'knowledge.promotion_batch'), false); assert.equal(driver.coordination.queryKnowledge().some((node) => node.id.startsWith('promotion:')), false); driver.close();
});

test('SP2/SP8: a critical audit failure or cancellation after audit leaves no promotion residue', async () => {
  const bad = new CoordinationStore(root('audit-bad'), { clock: clock() }); const created = bad.createTask(task('a'), { actor: 'orchestrator', key: 'task:a' }); bad.addKnowledgeNode({ id: 'finding:orphan', type: 'Finding', grounding: 'verified', body: 'orphan', evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: 'orphan' }); const before = bad.snapshot().lastSeq;
  await assert.rejects(cairn(bad).invoke('causal.promote', { observedSeq: before }, ctx()), (error) => error.code === 'causal_promotion_audit_failed'); assert.equal(bad.snapshot().lastSeq, before);
  const cancelled = new CoordinationStore(root('cancel-after-audit'), { clock: clock() }); completed(cancelled, 'a'); const abort = new AbortController(); const audit = cancelled.auditKnowledge.bind(cancelled); cancelled.auditKnowledge = (...args) => { const result = audit(...args); abort.abort(); return result; }; const cancelBefore = cancelled.snapshot().lastSeq;
  await assert.rejects(cairn(cancelled).invoke('causal.promote', { observedSeq: cancelBefore }, ctx({ signal: abort.signal })), (error) => error.code === 'cancelled'); assert.equal(cancelled.snapshot().lastSeq, cancelBefore);

  const raced = new CoordinationStore(root('post-audit-append'), { clock: clock() }); completed(raced, 'a'); const pinned = raced.snapshot().lastSeq; const racedAudit = raced.auditKnowledge.bind(raced); let injected = false;
  raced.auditKnowledge = (...args) => { const result = racedAudit(...args); if (!injected) { injected = true; completed(raced, 'b'); } return result; };
  const racedResult = await cairn(raced).invoke('causal.promote', { observedSeq: pinned }, ctx({ idempotencyKey: 'post-audit-append' }));
  assert.equal(racedResult.payload[0].candidateCount, 1); assert.equal(racedResult.payload[0].candidates.every((row) => row.sourceSeq <= pinned), true);
});
