import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationIntegrityError, CoordinationStore, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase53-${name}-`));
const auditPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxStateRows: 2048, maxNodes: 512, maxEdges: 1024, maxEvidenceRefs: 4096, maxAuditSamples: 128, maxTraceDepth: 8, maxTraceRows: 1024, maxArtifactBytes: 256 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const contradictionPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxScanEvents: 4096, maxScanEdges: 1024, maxItems: 32, maxSnippetBytes: 48, maxEvidenceRefs: 512, maxAffectedReads: 512, maxReasonBytes: 1024, maxBatchBytes: 256 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const context = (overrides = {}) => ({ actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'phase53:direct', budgetTokens: 32_000, ...overrides });

function clock() { let now = Date.parse('2026-07-13T13:00:00.000Z'); return () => new Date(now++).toISOString(); }
function repo() { const dir = root('repo'); execFileSync('git', ['init', '-q'], { cwd: dir }); execFileSync('git', ['-c', 'user.name=Baton', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir }); return dir; }
function task(id) { return { id, brief: { goal: id }, deps: [], refines: null, taskType: 'contradiction', reservedWorkerId: `w-${id}` }; }
function capability(store, overrides = {}, audit = {}) {
  return new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('artifacts'), knowledgeAuditPolicy: auditPolicy(audit), knowledgeContradictionPolicy: contradictionPolicy(overrides) });
}

function graph(store, count = 1) {
  const created = store.createTask(task('source'), { actor: 'orchestrator', key: 'task:source' }); const pairs = [];
  for (let index = 0; index < count; index += 1) {
    const left = store.addKnowledgeNode({ id: `finding:${index}:left`, type: 'Finding', grounding: 'observed', body: `Left claim ${index} — αβγδεζηθ repeated repeated repeated`, evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: `left:${index}` });
    const right = store.addKnowledgeNode({ id: `finding:${index}:right`, type: 'Finding', grounding: 'observed', body: `Right claim ${index} — contradiction repeated repeated repeated`, evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: `right:${index}` });
    const edge = store.addKnowledgeEdge({ type: 'Contradicts', from: left.node.id, to: right.node.id, evidence: [{ coordinationSeq: right.event.seq }] }, { actor: 'operator:alice', key: `edge:${index}` });
    pairs.push({ left, right, edge });
  }
  return { created, pairs };
}

const listArgs = (store, overrides = {}) => ({ observedSeq: store.snapshot().lastSeq, afterEdgeId: null, limit: 32, ...overrides });
const resolveArgs = (item, observedSeq, winner = item.endpoints[0].id) => {
  const loser = item.endpoints.find((endpoint) => endpoint.id !== winner).id;
  return {
    observedSeq, edgeId: item.edgeId, winnerId: winner, loserId: loser,
    expectedEdgeValidityVersion: item.edgeValidityVersion,
    expectedWinnerValidityVersion: item.endpoints.find((endpoint) => endpoint.id === winner).validityVersion,
    expectedLoserValidityVersion: item.endpoints.find((endpoint) => endpoint.id === loser).validityVersion,
    reason: 'Independent operator evidence selected the winner.',
  };
};

test('CX1/CX2/CX6: policy-gated list is bounded, stable, safe, paged, and exactly reverifiable', async () => {
  const empty = new CoordinationStore(root('empty'), { clock: clock() }); const emptyCapability = capability(empty);
  assert.equal(emptyCapability.card().ops['causal.contradictions'].reverifiable, true);
  assert.equal(emptyCapability.card().ops['causal.resolve_contradiction'].preflight_output, true);
  const emptyResult = await emptyCapability.invoke('causal.contradictions', listArgs(empty, { limit: 1 }), context({ idempotencyKey: 'empty' })); assert.equal(emptyResult.payload[0].totalUnresolved, 0); assert.deepEqual(emptyResult.payload[0].items, []);

  const store = new CoordinationStore(root('list'), { clock: clock() }); graph(store, 3); const cairn = capability(store); const observedSeq = store.snapshot().lastSeq;
  const seen = []; let afterEdgeId = null;
  for (let page = 0; page < 3; page += 1) {
    const args = { observedSeq, afterEdgeId, limit: 1 }; const result = await cairn.invoke('causal.contradictions', args, context({ idempotencyKey: `page:${page}` })); const document = result.payload[0];
    assert.equal(document.totalUnresolved, 3); assert.equal(document.items.length, 1); assert.equal(document.frame.startsWith('UNTRUSTED_'), true); seen.push(document.items[0].edgeId);
    assert.deepEqual(document.items[0].endpoints.map((row) => row.id), [...document.items[0].endpoints.map((row) => row.id)].sort());
    for (const endpoint of document.items[0].endpoints) { assert.equal(Buffer.byteLength(endpoint.snippet) <= 48, true); assert.match(endpoint.contentDigest, /^[a-f0-9]{64}$/); assert.match(endpoint.evidenceDigest, /^[a-f0-9]{64}$/); }
    for (const forbidden of ['/Users/', 'credential', 'readerActor', 'artifactPath']) assert.equal(JSON.stringify(result).includes(forbidden), false);
    assert.equal((await cairn.reverify(result, 'causal.contradictions', args, context({ idempotencyKey: `verify:${page}` }))).ok, true);
    afterEdgeId = document.nextAfterEdgeId;
  }
  assert.deepEqual(seen, [...seen].sort()); assert.equal(new Set(seen).size, 3); assert.equal(afterEdgeId, null);
  await assert.rejects(cairn.invoke('causal.contradictions', { observedSeq, afterEdgeId: 'missing', limit: 1 }, context({ idempotencyKey: 'bad-cursor' })), (error) => error.code === 'causal_contradiction_invalid');
});

test('CX3/CX4/CX6: one public resolution preserves history, invalidates only loser, and records bounded contamination', async () => {
  const store = new CoordinationStore(root('resolve'), { clock: clock() }); const { pairs } = graph(store); const cairn = capability(store); const before = store.snapshot().lastSeq;
  const listed = await cairn.invoke('causal.contradictions', { observedSeq: before, afterEdgeId: null, limit: 1 }, context({ idempotencyKey: 'list' })); const item = listed.payload[0].items[0]; const loserId = item.endpoints[1].id;
  const read = store.readKnowledge({ ids: [loserId] }, { readerActor: 'orchestrator', taskId: 'source' }, { actor: 'orchestrator', key: 'read:loser' }); const observedSeq = store.snapshot().lastSeq; const args = resolveArgs(item, observedSeq, item.endpoints[0].id);
  const result = await cairn.invoke('causal.resolve_contradiction', args, context({ idempotencyKey: 'resolve' })); const document = result.payload[0];
  assert.equal(document.winnerId, args.winnerId); assert.equal(document.loserId, args.loserId); assert.equal(document.affectedReadCount, 1); assert.equal(document.edgeValidityVersion, 2); assert.equal(document.winnerValidityVersion, 1); assert.equal(document.loserValidityVersion, 2);
  assert.equal(JSON.stringify(result).includes(args.reason), false); assert.equal(store.events(document.eventSeq, 1)[0].kind, 'knowledge.contradiction_resolved'); assert.equal(store.events(document.eventSeq, 1)[0].payload.schemaVersion, 2);
  assert.deepEqual(store.snapshot().knowledge.contamination.at(-1).affectedReadEvents, [read.event.seq]); assert.equal(store.snapshot().knowledge.contamination.at(-1).eventSeq, document.eventSeq);
  assert.equal(store.queryKnowledge({ ids: [args.winnerId] }).length, 1); assert.equal(store.queryKnowledge({ ids: [args.loserId] }).length, 0); assert.equal(store.queryKnowledgeEdges({ types: ['Contradicts'] }).length, 0);
  assert.equal(store.queryKnowledge({ observedSeq, ids: [args.loserId] }).length, 1); assert.equal(store.queryKnowledgeEdges({ observedSeq, types: ['Contradicts'] }).length, 1);
  assert.deepEqual((await cairn.invoke('causal.contradictions', { observedSeq, afterEdgeId: null, limit: 1 }, context({ idempotencyKey: 'historical' }))).payload[0].items, listed.payload[0].items);
  assert.equal((await cairn.reverify(result, 'causal.resolve_contradiction', args, context({ idempotencyKey: 'resolve:verify' }))).ok, true);
  assert.equal((await cairn.invoke('causal.contradictions', listArgs(store, { limit: 1 }), context({ idempotencyKey: 'current' }))).payload[0].totalUnresolved, 0);
  void pairs;
});

test('CX3/CX5/CX6: authority, request shape, idempotency, stale versions, and concurrent races fail closed', async () => {
  const store = new CoordinationStore(root('authority'), { clock: clock() }); graph(store, 2); const cairn = capability(store); const listed = await cairn.invoke('causal.contradictions', listArgs(store), context({ idempotencyKey: 'list' })); const first = listed.payload[0].items[0]; const second = listed.payload[0].items[1];
  for (const actor of ['worker:evil', 'policy', 'web:forged', 'operator:web:forged', 'operator:mcp:forged']) await assert.rejects(cairn.invoke('causal.contradictions', listArgs(store), context({ actor, idempotencyKey: `list:${actor}` })), (error) => error.code === 'causal_contradiction_forbidden');
  await assert.rejects(cairn.invoke('causal.contradictions', { ...listArgs(store), extra: true }, context({ idempotencyKey: 'extra' })), (error) => error.code === 'causal_contradiction_invalid');
  const observedSeq = store.snapshot().lastSeq; const args = resolveArgs(first, observedSeq);
  for (const actor of ['worker:evil', 'policy', 'operator:web:forged']) await assert.rejects(cairn.invoke('causal.resolve_contradiction', args, context({ actor, idempotencyKey: `resolve:${actor}` })), (error) => error.code === 'causal_contradiction_forbidden');
  const resolved = await cairn.invoke('causal.resolve_contradiction', args, context({ idempotencyKey: 'same' })); assert.deepEqual(await cairn.invoke('causal.resolve_contradiction', args, context({ idempotencyKey: 'same' })), resolved);
  await assert.rejects(cairn.invoke('causal.resolve_contradiction', { ...args, reason: 'changed' }, context({ idempotencyKey: 'same' })), (error) => error.code === 'causal_contradiction_conflict');
  await assert.rejects(cairn.invoke('causal.resolve_contradiction', { ...args, winnerId: args.loserId, loserId: args.winnerId }, context({ idempotencyKey: 'reverse' })), (error) => ['causal_contradiction_conflict', 'contradiction_resolved'].includes(error.code));

  const secondArgs = resolveArgs(second, store.snapshot().lastSeq); const raced = await Promise.allSettled([
    cairn.invoke('causal.resolve_contradiction', secondArgs, context({ idempotencyKey: 'race:a' })),
    cairn.invoke('causal.resolve_contradiction', secondArgs, context({ idempotencyKey: 'race:b' })),
  ]); assert.equal(raced.filter((row) => row.status === 'fulfilled').length, 1); assert.equal(raced.filter((row) => row.status === 'rejected').length, 1);
});

test('CX4/CX6: restart/reverify is exact and event or claim substitution fails', async () => {
  const directory = root('replay'); const store = new CoordinationStore(directory, { clock: clock() }); graph(store); const cairn = capability(store); const listed = await cairn.invoke('causal.contradictions', listArgs(store), context({ idempotencyKey: 'list' })); const args = resolveArgs(listed.payload[0].items[0], store.snapshot().lastSeq); const claim = await cairn.invoke('causal.resolve_contradiction', args, context({ idempotencyKey: 'resolve' }));
  const tamperedClaim = structuredClone(claim); tamperedClaim.payload[0].affectedReadCount += 1; assert.equal((await cairn.reverify(tamperedClaim, 'causal.resolve_contradiction', args, context())).ok, false);
  store.releaseWriterLease(); const replay = new CoordinationStore(directory); const restarted = capability(replay); assert.equal((await restarted.reverify(claim, 'causal.resolve_contradiction', args, context())).ok, true); assert.equal(replay.queryKnowledge({ ids: [args.loserId] }).length, 0); replay.releaseWriterLease();
  const file = join(directory, 'events.jsonl'); const original = readFileSync(file, 'utf8'); const rows = original.trimEnd().split('\n').map(JSON.parse); rows.find((row) => row.kind === 'knowledge.contradiction_resolved' && row.payload.schemaVersion === 2).payload.affectedReadEvents.push(1); writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(directory), (error) => error instanceof CoordinationIntegrityError && error.code === 'causal_contradiction_integrity'); writeFileSync(file, original);
});

test('CX1/CX2/CX3/CX7: every independent bound refuses without resolution residue', async () => {
  const configured = new CoordinationStore(root('config'), { clock: clock() }); assert.throws(() => capability(configured, { surprise: 1 }), /contradiction configuration is invalid/); assert.throws(() => capability(configured, { repoId: 'repo-b' }), /contradiction configuration is invalid/);
  assert.equal(new CairnRunScorecard({ coordination: configured, readOperational: () => [], artifactRoot: root('audit-only'), knowledgeAuditPolicy: auditPolicy() }).card().ops['causal.contradictions'], undefined);

  for (const [field, value] of [['maxScanEvents', 1], ['maxScanEdges', 1], ['maxEvidenceRefs', 1], ['maxResultBytes', 1]]) {
    const store = new CoordinationStore(root(`list-${field}`), { clock: clock() }); graph(store, 2); const before = store.snapshot().lastSeq;
    await assert.rejects(capability(store, { [field]: value }).invoke('causal.contradictions', { observedSeq: before, afterEdgeId: null, limit: 2 }, context({ idempotencyKey: `list:${field}` })), (error) => error.code === 'causal_contradiction_oversize'); assert.equal(store.snapshot().lastSeq, before);
  }
  const page = new CoordinationStore(root('page'), { clock: clock() }); graph(page, 2); await assert.rejects(capability(page, { maxItems: 1 }).invoke('causal.contradictions', listArgs(page, { limit: 2 }), context({ idempotencyKey: 'page' })), (error) => error.code === 'causal_contradiction_oversize');

  for (const [field, value, reads] of [['maxAffectedReads', 1, 2], ['maxReasonBytes', 8, 0], ['maxBatchBytes', 1, 0]]) {
    const store = new CoordinationStore(root(`resolve-${field}`), { clock: clock() }); graph(store); const normal = capability(store); const listed = await normal.invoke('causal.contradictions', listArgs(store), context({ idempotencyKey: `list:${field}` })); const item = listed.payload[0].items[0]; const loser = item.endpoints[1].id;
    for (let index = 0; index < reads; index += 1) store.readKnowledge({ ids: [loser] }, { readerActor: 'orchestrator' }, { actor: 'orchestrator', key: `read:${index}` }); const before = store.snapshot(); const args = resolveArgs(item, store.snapshot().lastSeq);
    await assert.rejects(capability(store, { [field]: value }).invoke('causal.resolve_contradiction', args, context({ idempotencyKey: `resolve:${field}` })), (error) => ['causal_contradiction_invalid', 'causal_contradiction_oversize'].includes(error.code)); assert.deepEqual(store.snapshot(), before);
  }
});

test('CX3/CX7: audit failure, cancellation, preflight mutation, and append failure are effect-free', async () => {
  const bad = new CoordinationStore(root('audit-bad'), { clock: clock() }); const bg = graph(bad); bad.addKnowledgeNode({ id: 'finding:orphan', type: 'Finding', grounding: 'verified', body: 'orphan', evidence: [{ coordinationSeq: bg.created.event.seq }] }, { actor: 'policy', key: 'orphan' }); const badBefore = bad.snapshot().lastSeq;
  await assert.rejects(capability(bad).invoke('causal.contradictions', { observedSeq: badBefore, afterEdgeId: null, limit: 1 }, context({ idempotencyKey: 'audit' })), (error) => error.code === 'causal_contradiction_audit_failed'); assert.equal(bad.snapshot().lastSeq, badBefore);

  const cancelled = new CoordinationStore(root('cancelled'), { clock: clock() }); graph(cancelled); const cancelledCairn = capability(cancelled); const listed = await cancelledCairn.invoke('causal.contradictions', listArgs(cancelled), context({ idempotencyKey: 'list:cancel' })); const abort = new AbortController(); const audit = cancelled.auditKnowledge.bind(cancelled); cancelled.auditKnowledge = (...args) => { const value = audit(...args); abort.abort(); return value; }; const cancelBefore = cancelled.snapshot();
  await assert.rejects(cancelledCairn.invoke('causal.resolve_contradiction', resolveArgs(listed.payload[0].items[0], cancelled.snapshot().lastSeq), context({ idempotencyKey: 'cancel', signal: abort.signal })), (error) => error.code === 'cancelled'); assert.deepEqual(cancelled.snapshot(), cancelBefore);

  const failed = new CoordinationStore(root('failed'), { clock: clock(), appendFile: appendFileSync }); graph(failed); const failedCairn = capability(failed); const failedList = await failedCairn.invoke('causal.contradictions', listArgs(failed), context({ idempotencyKey: 'list:failed' })); const failedBefore = failed.snapshot(); failed._appendFile = () => { throw new Error('disk full'); };
  await assert.rejects(failedCairn.invoke('causal.resolve_contradiction', resolveArgs(failedList.payload[0].items[0], failed.snapshot().lastSeq), context({ idempotencyKey: 'failed' })), /disk full/); assert.deepEqual(failed.snapshot(), failedBefore);
});

function driverFor(store, name, maxCapabilityEnvelopeBytes = 512 * 1024) {
  store.releaseWriterLease();
  return createDriver({ repoRoot: repo(), repoId: 'repo-a', logDir: root(`${name}-log`), coordination: store, adapters: {}, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root(`${name}-artifacts`), knowledgeAuditPolicy: auditPolicy(), knowledgeContradictionPolicy: contradictionPolicy() }) }, maxCapabilityBudgetTokens: 64_000, maxCapabilityEnvelopeBytes });
}

test('CX5/CX6: authenticated HTTPS and MCP invoke/reverify share one effectful authority', async () => {
  const store = new CoordinationStore(root('transports'), { clock: clock() }); graph(store, 2); const driver = driverFor(store, 'transports'); const origin = 'https://cairn.test'; const principal = { userId: 'alice', sessionId: 'web', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] }; const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const webListArgs = { observedSeq: store.snapshot().lastSeq, afterEdgeId: null, limit: 1 }; const webList = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'web-list', idempotencyKey: 'web-list', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.contradictions', action: 'invoke', args: webListArgs, budgetTokens: 32_000 } }); assert.equal(webList.status, 200, JSON.stringify(webList.body));
  const webArgs = resolveArgs(webList.body.result.payload[0].items[0], store.snapshot().lastSeq); const webResolve = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'web-resolve', idempotencyKey: 'web-resolve', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.resolve_contradiction', action: 'invoke', args: webArgs, budgetTokens: 32_000 } }); assert.equal(webResolve.status, 200, JSON.stringify(webResolve.body)); assert.equal(store.events(webResolve.body.result.payload[0].eventSeq, 1)[0].actor, 'operator:web:alice:web');
  const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'web-verify', idempotencyKey: 'web-verify', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.resolve_contradiction', action: 'reverify', claim: webResolve.body.result, args: webArgs, budgetTokens: 32_000 } }); assert.equal(webVerify.status, 200); assert.equal(webVerify.body.result.payload[0].ok, true);

  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1000, maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }) }); await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase53', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpListArgs = { observedSeq: store.snapshot().lastSeq, afterEdgeId: null, limit: 1 }; const mcpList = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'mcp-list', name: 'cairn', op: 'causal.contradictions', action: 'invoke', args: mcpListArgs, budgetTokens: 32_000 } } }); assert.equal(mcpList.result.isError, false);
  const mcpArgs = resolveArgs(mcpList.result.structuredContent.payload[0].items[0], store.snapshot().lastSeq); const mcpResolve = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'mcp-resolve', name: 'cairn', op: 'causal.resolve_contradiction', action: 'invoke', args: mcpArgs, budgetTokens: 32_000 } } }); assert.equal(mcpResolve.result.isError, false); assert.equal(store.events(mcpResolve.result.structuredContent.payload[0].eventSeq, 1)[0].actor, 'operator:mcp:bob:mcp');
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'mcp-verify', name: 'cairn', op: 'causal.resolve_contradiction', action: 'reverify', claim: mcpResolve.result.structuredContent, args: mcpArgs, budgetTokens: 32_000 } } }); assert.equal(mcpVerify.result.isError, false); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true); assert.equal(driver.close(), true);
});

test('CX7: ACI output refusal happens before contradiction resolution', async () => {
  const store = new CoordinationStore(root('aci'), { clock: clock() }); graph(store); const direct = capability(store); const listed = await direct.invoke('causal.contradictions', listArgs(store), context({ idempotencyKey: 'list' })); const args = resolveArgs(listed.payload[0].items[0], store.snapshot().lastSeq); const driver = driverFor(store, 'aci', 1024); const before = store.snapshot();
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.resolve_contradiction', args, context({ idempotencyKey: 'aci', budgetTokens: 1 })), (error) => error.code === 'capability_result_oversize'); assert.deepEqual(store.snapshot(), before); driver.close();
});
