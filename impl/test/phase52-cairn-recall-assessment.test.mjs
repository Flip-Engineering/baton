import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationIntegrityError, CoordinationStore, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase52-${name}-`));
const auditPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxStateRows: 2048, maxNodes: 256, maxEdges: 1024, maxEvidenceRefs: 4096, maxAuditSamples: 128, maxTraceDepth: 8, maxTraceRows: 1024, maxArtifactBytes: 256 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const recallPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxQueryBytes: 4096, maxQueryTerms: 64, maxCandidates: 256, maxCandidateBytes: 512 * 1024, maxResults: 32, maxGraphDepth: 8, maxGraphRows: 1024, maxSnippetBytes: 128, maxReceiptBytes: 128 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const assessmentPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxScanEvents: 4096, maxReceipts: 256, maxNodeRefs: 4096, maxEvidenceRefs: 1024, maxBatchBytes: 512 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const context = (overrides = {}) => ({ actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'phase52:assess', budgetTokens: 32_000, ...overrides });
const route = Object.freeze({ harnessRequested: 'mock', harnessResolved: 'mock@1.0.0', modelRequested: 'mock-model', modelResolved: 'mock-model', effortRequested: 'low', effortResolved: 'low', routeKey: '["mock","1.0.0","mock-model","low","mock-family","test"]' });

function clock() { let now = Date.parse('2026-07-13T08:00:00.000Z'); return () => new Date(now++).toISOString(); }
function repo() { const dir = root('repo'); execFileSync('git', ['init', '-q'], { cwd: dir }); execFileSync('git', ['-c', 'user.name=Baton', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir }); return dir; }
function task(id, runId = `run-${id}`) { return { id, runId, brief: { goal: `SECRET brief /Users/alice/${id}` }, deps: [], refines: null, taskType: 'test', reservedWorkerId: `w-${id}` }; }
function capability(store, overrides = {}) {
  return new CairnRunScorecard({ coordination: store, readOperational: () => [], artifactRoot: root('artifacts'), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy(), knowledgeRecallAssessmentPolicy: assessmentPolicy(overrides) });
}

async function fixture({ id = 'task-a', accept = true, terminal = accept ? 'completed' : 'failed', scope = 'task', addOutcome = true, policy = {}, recallCount = 1 } = {}) {
  const operational = new Map(); const directory = root(id); const store = new CoordinationStore(directory, { clock: clock(), operationalRead: (worker, seq) => operational.get(`${worker}:${seq}`) ?? null });
  const created = store.createTask(task(id), { actor: 'orchestrator', key: `create:${id}` });
  const claimed = store.claimTask(id, `w-${id}`, 1, { actor: 'orchestrator', key: `claim:${id}` }, route);
  const finding = store.addKnowledgeNode({ id: `finding:${id}`, type: 'Finding', grounding: 'observed', body: `SECRET recalled body /Users/alice/${id}`, evidence: [{ coordinationSeq: created.event.seq }] }, { actor: 'policy', key: `finding:${id}` });
  const cairn = capability(store, policy); const recallBoundary = store.snapshot().lastSeq;
  const reader = scope === 'task' ? { taskId: id } : scope === 'run' ? { runId: `run-${id}` } : {};
  const recallArgs = { text: id, limit: 1, observedSeq: recallBoundary, reader };
  const recalls = []; for (let index = 0; index < recallCount; index += 1) recalls.push(await cairn.invoke('causal.recall', recallArgs, context({ idempotencyKey: `recall:${id}:${index}` }))); const recall = recalls[0];
  let mapped = null; let terminalEvent = null;
  if (addOutcome) {
    const verification = { worker: `w-${id}`, seq: 1, ts: '2026-07-13T08:00:01.000Z', actor: 'policy', kind: 'verify.reverified', taskId: id, runId: `run-${id}`, harness: route.harnessResolved, modelResolved: route.modelResolved, effortResolved: route.effortResolved, routeKey: route.routeKey, payload: { accept, summary: `SECRET verification /Users/alice/${id}` } };
    operational.set(`${verification.worker}:${verification.seq}`, verification);
    mapped = store.mapOperationalEvent(verification, { actor: 'policy', key: `map:${id}` });
    terminalEvent = store.transitionTask(id, terminal, claimed.task.version, { actor: 'policy', key: `terminal:${id}` }, mapped.evidence);
  }
  return { directory, operational, store, cairn, created, claimed, finding, recall, recalls, recallArgs, mapped, terminalEvent };
}

test('RA1-RA8: verified pass and failure produce exact non-causal historical assessments and honest audit metrics', async () => {
  for (const [id, accept, expected] of [['pass', true, 'verified_pass_after_recall'], ['fail', false, 'verified_fail_after_recall']]) {
    const f = await fixture({ id, accept }); const observedSeq = f.store.snapshot().lastSeq;
    assert.equal(f.cairn.card().ops['causal.assess_recall'].preflight_output, true);
    const beforeNodes = f.store.queryKnowledge({ observedSeq }).map((node) => [node.id, node.validityVersion, node.grounding]);
    const result = await f.cairn.invoke('causal.assess_recall', { observedSeq }, context({ idempotencyKey: `assess:${id}` }));
    const document = result.payload[0]; assert.equal(document.noOp, false); assert.equal(document.causationClaimed, false); assert.equal(document.assessments.length, 1);
    assert.equal(document.assessments[0].outcome, expected); assert.equal(document.assessments[0].recallEventSeq, f.recall.payload[0].receipt.eventSeq); assert.equal(document.assessments[0].taskId, id);
    const event = f.store.events(document.receipt.eventSeq, 1)[0]; assert.equal(event.kind, 'knowledge.recall_assessment_batch'); assert.equal(event.payload.assessments[0].outcome, expected);
    for (const forbidden of ['SECRET', '/Users/alice', 'snippet', 'brief', 'helped', 'harmed']) assert.equal(JSON.stringify({ event, result }).includes(forbidden), false, forbidden);
    assert.deepEqual(f.store.queryKnowledge({ observedSeq: f.store.snapshot().lastSeq }).map((node) => [node.id, node.validityVersion, node.grounding]), beforeNodes);
    const metrics = f.store.auditKnowledge({ observedSeq: f.store.snapshot().lastSeq }).recallUtility;
    assert.equal(metrics.taskScopedReceipts, 1); assert.equal(metrics.eligibleVerifiedOutcomes, 1); assert.equal(metrics.assessed, 1); assert.equal(metrics.unassessedEligible, 0);
    assert.equal(metrics[accept ? 'verifiedPassAfterRecall' : 'verifiedFailAfterRecall'], 1); assert.deepEqual(metrics.assessmentCoverage, { numerator: 1, denominator: 1 });
  }
});

test('RA2/RA3: Baton selects only task-scoped receipt-before-verification-before-terminal associations', async () => {
  for (const [name, options] of [['actor', { scope: 'actor' }], ['asserted', { addOutcome: false }], ['cancelled', { accept: false, terminal: 'cancelled' }]]) {
    const f = await fixture({ id: name, ...options }); const before = f.store.snapshot().lastSeq;
    const result = await f.cairn.invoke('causal.assess_recall', { observedSeq: before }, context({ idempotencyKey: `exclude:${name}` }));
    assert.equal(result.payload[0].noOp, true, name); assert.equal(f.store.snapshot().lastSeq, before, name);
  }

  const runScoped = await fixture({ id: 'run-scope', scope: 'actor' }); const runDigest = 'a'.repeat(64); const runPrefix = runScoped.store.snapshot().lastSeq;
  runScoped.store.sealRunScorecard({ runId: 'run-run-scope', coordinationUpperBound: runPrefix, operationalTails: [{ taskId: 'run-scope', worker: 'w-run-scope', tail: 1 }], taskIds: ['run-scope'], scorecardDigest: runDigest, scorecard: { runId: 'run-run-scope' }, artifact: { path: '/tmp/phase52-run-scorecard', digest: runDigest, bytes: 1 }, evidence: [{ coordinationSeq: runScoped.terminalEvent.event.seq }] }, { actor: 'orchestrator', key: 'run-scope:seal' });
  await runScoped.cairn.invoke('causal.recall', { text: 'run-scope', limit: 1, observedSeq: runScoped.store.snapshot().lastSeq, reader: { runId: 'run-run-scope' } }, context({ idempotencyKey: 'run-scope:recall' })); const runBefore = runScoped.store.snapshot().lastSeq;
  assert.equal((await runScoped.cairn.invoke('causal.assess_recall', { observedSeq: runBefore }, context({ idempotencyKey: 'run-scope:assess' }))).payload[0].noOp, true); assert.equal(runScoped.store.snapshot().lastSeq, runBefore);

  const after = await fixture({ id: 'after-terminal', addOutcome: false, scope: 'actor' });
  const verification = { worker: 'w-after-terminal', seq: 1, ts: '2026-07-13T08:00:01.000Z', actor: 'policy', kind: 'verify.reverified', taskId: 'after-terminal', runId: 'run-after-terminal', harness: route.harnessResolved, modelResolved: route.modelResolved, effortResolved: route.effortResolved, routeKey: route.routeKey, payload: { accept: true } };
  after.operational.set(`${verification.worker}:1`, verification); const mapped = after.store.mapOperationalEvent(verification, { actor: 'policy', key: 'after:map' }); after.store.transitionTask('after-terminal', 'completed', 2, { actor: 'policy', key: 'after:terminal' }, mapped.evidence);
  const post = await after.cairn.invoke('causal.recall', { text: 'after-terminal', limit: 1, observedSeq: after.store.snapshot().lastSeq, reader: { taskId: 'after-terminal' } }, context({ idempotencyKey: 'after:recall' })); assert.ok(post.payload[0].receipt.eventSeq > after.store.task('after-terminal').terminalEvent);
  const result = await after.cairn.invoke('causal.assess_recall', { observedSeq: after.store.snapshot().lastSeq }, context({ idempotencyKey: 'after:assess' })); assert.equal(result.payload[0].noOp, true);
});

test('RA1/RA2/RA5: policy, request, authority, idempotency, and no-op surfaces are closed', async () => {
  const f = await fixture({ id: 'closed' }); const observedSeq = f.store.snapshot().lastSeq;
  assert.equal(new CairnRunScorecard({ coordination: f.store, readOperational: () => [], artifactRoot: root('audit-only'), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy() }).card().ops['causal.assess_recall'], undefined);
  assert.throws(() => new CairnRunScorecard({ coordination: f.store, readOperational: () => [], artifactRoot: root('mismatch'), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy(), knowledgeRecallAssessmentPolicy: assessmentPolicy({ repoId: 'repo-b' }) }), /assessment configuration is invalid/);
  assert.throws(() => capability(f.store, { surprise: 1 }), /assessment configuration is invalid/);
  await assert.rejects(f.cairn.invoke('causal.assess_recall', { observedSeq, receiptEventSeq: f.recall.payload[0].receipt.eventSeq }, context({ idempotencyKey: 'smuggle' })), (error) => error.code === 'causal_assessment_invalid');
  for (const actor of ['worker:evil', 'policy', 'web:forged:session', 'operator:web:forged']) await assert.rejects(f.cairn.invoke('causal.assess_recall', { observedSeq }, context({ actor, idempotencyKey: `actor:${actor}` })), (error) => error.code === 'causal_assessment_forbidden');
  const first = await f.cairn.invoke('causal.assess_recall', { observedSeq }, context()); const after = f.store.snapshot().lastSeq;
  assert.deepEqual(await f.cairn.invoke('causal.assess_recall', { observedSeq }, context()), first); assert.equal(f.store.snapshot().lastSeq, after);
  await assert.rejects(f.cairn.invoke('causal.assess_recall', { observedSeq: observedSeq - 1 }, context()), (error) => error.code === 'causal_assessment_conflict');
  const noOp = await f.cairn.invoke('causal.assess_recall', { observedSeq: after }, context({ idempotencyKey: 'no-op' })); assert.equal(noOp.payload[0].noOp, true); assert.equal(f.store.snapshot().lastSeq, after);
});

test('RA3/RA4/RA7: borrowed operational evidence and durable assessment tamper fail replay', async () => {
  const f = await fixture({ id: 'replay' }); const observedSeq = f.store.snapshot().lastSeq; const claim = await f.cairn.invoke('causal.assess_recall', { observedSeq }, context({ idempotencyKey: 'replay:assess' }));
  assert.equal((await f.cairn.reverify(claim, 'causal.assess_recall', { observedSeq }, context({ idempotencyKey: 'replay:verify' }))).ok, true);
  f.store.releaseWriterLease(); const replay = new CoordinationStore(f.directory, { operationalRead: (worker, seq) => f.operational.get(`${worker}:${seq}`) ?? null }); const restarted = capability(replay);
  assert.deepEqual(replay.snapshot().knowledge.assessments, f.store.snapshot().knowledge.assessments); assert.equal((await restarted.reverify(claim, 'causal.assess_recall', { observedSeq }, context())).ok, true); replay.releaseWriterLease();
  const file = join(f.directory, 'events.jsonl'); const original = readFileSync(file, 'utf8'); const rows = original.trimEnd().split('\n').map(JSON.parse); const event = rows.find((row) => row.kind === 'knowledge.recall_assessment_batch'); event.payload.assessments[0].taskId = 'borrowed'; writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(f.directory, { operationalRead: (worker, seq) => f.operational.get(`${worker}:${seq}`) ?? null }), (error) => error instanceof CoordinationIntegrityError && error.code === 'knowledge_recall_assessment_integrity'); writeFileSync(file, original);
});

test('RA3/RA5/RA8: borrowed task, worker, and route evidence is excluded; races record one association; later contamination remains historical', async () => {
  const borrowed = await fixture({ id: 'borrowed-a', addOutcome: false }); const other = borrowed.store.createTask(task('borrowed-b'), { actor: 'orchestrator', key: 'borrowed:create:b' });
  const claimed = borrowed.store.claimTask('borrowed-b', 'w-borrowed-b', other.task.version, { actor: 'orchestrator', key: 'borrowed:claim:b' }, route);
  const verification = { worker: 'w-borrowed-b', seq: 1, ts: '2026-07-13T08:00:01.000Z', actor: 'policy', kind: 'verify.reverified', taskId: 'borrowed-b', runId: 'run-borrowed-b', harness: route.harnessResolved, modelResolved: route.modelResolved, effortResolved: route.effortResolved, routeKey: route.routeKey, payload: { accept: true } };
  borrowed.operational.set('w-borrowed-b:1', verification); const mapped = borrowed.store.mapOperationalEvent(verification, { actor: 'policy', key: 'borrowed:map:b' });
  borrowed.store.transitionTask('borrowed-a', 'completed', borrowed.claimed.task.version, { actor: 'policy', key: 'borrowed:terminal:a' }, mapped.evidence);
  borrowed.store.transitionTask('borrowed-b', 'completed', claimed.task.version, { actor: 'policy', key: 'borrowed:terminal:b' }, mapped.evidence);
  const borrowedBefore = borrowed.store.snapshot().lastSeq; assert.equal((await borrowed.cairn.invoke('causal.assess_recall', { observedSeq: borrowedBefore }, context({ idempotencyKey: 'borrowed:assess' }))).payload[0].noOp, true); assert.equal(borrowed.store.snapshot().lastSeq, borrowedBefore);

  const raced = await fixture({ id: 'raced' }); const boundary = raced.store.snapshot().lastSeq;
  const [one, two] = await Promise.all([
    raced.cairn.invoke('causal.assess_recall', { observedSeq: boundary }, context({ idempotencyKey: 'race:one' })),
    raced.cairn.invoke('causal.assess_recall', { observedSeq: boundary }, context({ idempotencyKey: 'race:two' })),
  ]);
  assert.deepEqual([one.payload[0].noOp, two.payload[0].noOp].sort(), [false, true]); assert.equal(raced.store.events().filter((event) => event.kind === 'knowledge.recall_assessment_batch').length, 1);
  raced.store.invalidateKnowledge(raced.finding.node.id, 1, 'independent correction', { actor: 'operator:alice', key: 'race:invalidate' }); const metrics = raced.store.auditKnowledge({ observedSeq: raced.store.snapshot().lastSeq }).recallUtility;
  assert.equal(metrics.contaminatedAssessments, 1); assert.equal(raced.store.recallAssessments({ nodeId: raced.finding.node.id })[0].outcome, 'verified_pass_after_recall');
});

test('RA2/RA5/RA9: audit failure and cancellation after the audit gate leave no assessment residue', async () => {
  const bad = await fixture({ id: 'audit-bad' }); bad.store.addKnowledgeNode({ id: 'finding:audit-orphan', type: 'Finding', grounding: 'verified', body: 'orphan', evidence: [{ coordinationSeq: bad.created.event.seq }] }, { actor: 'policy', key: 'audit:orphan' }); const badBefore = bad.store.snapshot().lastSeq;
  await assert.rejects(bad.cairn.invoke('causal.assess_recall', { observedSeq: badBefore }, context({ idempotencyKey: 'audit:fail' })), (error) => error.code === 'causal_assessment_audit_failed'); assert.equal((bad.store.snapshot().knowledge.assessments ?? []).length, 0); assert.equal(bad.store.snapshot().lastSeq, badBefore);

  const cancelled = await fixture({ id: 'cancel-after-audit' }); const abort = new AbortController(); const audit = cancelled.store.auditKnowledge.bind(cancelled.store); cancelled.store.auditKnowledge = (...args) => { const value = audit(...args); abort.abort(); return value; }; const before = cancelled.store.snapshot().lastSeq;
  await assert.rejects(cancelled.cairn.invoke('causal.assess_recall', { observedSeq: before }, context({ idempotencyKey: 'cancel:after-audit', signal: abort.signal })), (error) => error.code === 'cancelled'); assert.equal((cancelled.store.snapshot().knowledge.assessments ?? []).length, 0); assert.equal(cancelled.store.snapshot().lastSeq, before);
});

test('RA5/RA6/RA9: every independent ceiling, cancellation, preflight, and append failure leaves no assessment', async () => {
  for (const [field, value] of [['maxScanEvents', 1], ['maxEvidenceRefs', 1], ['maxBatchBytes', 1], ['maxResultBytes', 1]]) {
    const overrides = { [field]: value };
    const f = await fixture({ id: `limit-${field}`, policy: overrides }); const before = f.store.snapshot().lastSeq;
    await assert.rejects(f.cairn.invoke('causal.assess_recall', { observedSeq: before }, context({ idempotencyKey: `limit:${field}` })), (error) => ['causal_assessment_oversize', 'capability_result_oversize'].includes(error.code));
    assert.equal((f.store.snapshot().knowledge.assessments ?? []).length, 0); assert.equal(f.store.snapshot().lastSeq, before);
  }
  for (const field of ['maxReceipts', 'maxNodeRefs']) {
    const f = await fixture({ id: `limit-${field}`, recallCount: 2, policy: { [field]: 1 } }); const before = f.store.snapshot().lastSeq;
    await assert.rejects(f.cairn.invoke('causal.assess_recall', { observedSeq: before }, context({ idempotencyKey: `limit:${field}` })), (error) => error.code === 'causal_assessment_oversize'); assert.equal((f.store.snapshot().knowledge.assessments ?? []).length, 0); assert.equal(f.store.snapshot().lastSeq, before);
  }
  const cancelled = await fixture({ id: 'cancel' }); const abort = new AbortController(); abort.abort(); const cancelBefore = cancelled.store.snapshot().lastSeq;
  await assert.rejects(cancelled.cairn.invoke('causal.assess_recall', { observedSeq: cancelBefore }, context({ idempotencyKey: 'cancelled', signal: abort.signal })), (error) => error.code === 'cancelled'); assert.equal(cancelled.store.snapshot().lastSeq, cancelBefore);
  const failed = await fixture({ id: 'disk' }); const failedBefore = failed.store.snapshot().lastSeq; failed.store._appendFile = () => { throw new Error('disk full'); };
  await assert.rejects(failed.cairn.invoke('causal.assess_recall', { observedSeq: failedBefore }, context({ idempotencyKey: 'disk' })), /disk full/); assert.equal(failed.store.snapshot().lastSeq, failedBefore); assert.deepEqual(failed.store.snapshot().knowledge.assessments ?? [], []);
});

function driverFor(f, name, maxCapabilityEnvelopeBytes = 512 * 1024) {
  f.store.releaseWriterLease();
  const driver = createDriver({ repoRoot: repo(), repoId: 'repo-a', logDir: root(`${name}-log`), coordination: f.store, adapters: {}, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: root(`${name}-artifacts`), knowledgeAuditPolicy: auditPolicy(), knowledgeRecallPolicy: recallPolicy(), knowledgeRecallAssessmentPolicy: assessmentPolicy() }) }, maxCapabilityBudgetTokens: 64_000, maxCapabilityEnvelopeBytes });
  f.store._operationalRead = (worker, seq) => f.operational.get(`${worker}:${seq}`) ?? driver.log.read(worker).find((event) => event.seq === seq) ?? null;
  return driver;
}

test('RA1/RA6/RA7: direct, authenticated HTTPS, and authenticated MCP invoke and reverify share one ACI', async () => {
  const directFixture = await fixture({ id: 'direct' }); const directDriver = driverFor(directFixture, 'direct'); const directArgs = { observedSeq: directFixture.store.snapshot().lastSeq };
  const direct = await directDriver.coordinator.invokeCapability('cairn', 'causal.assess_recall', directArgs, context({ idempotencyKey: 'direct' })); assert.equal(direct.payload[0].noOp, false); directDriver.close();

  const webFixture = await fixture({ id: 'web' }); const webDriver = driverFor(webFixture, 'web'); const webArgs = { observedSeq: webFixture.store.snapshot().lastSeq }; const origin = 'https://cairn.test';
  const web = new WebNorthbound({ coordinator: webDriver.coordinator, coordination: webDriver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] }); const principal = { userId: 'alice', sessionId: 'web', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'assess-web', idempotencyKey: 'assess-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.assess_recall', action: 'invoke', args: webArgs, budgetTokens: 32_000 } }); assert.equal(webResult.status, 200); assert.equal(webResult.body.result.payload[0].noOp, false);
  const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'assess-web-verify', idempotencyKey: 'assess-web-verify', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.assess_recall', action: 'reverify', claim: webResult.body.result, args: webArgs, budgetTokens: 32_000 } }); assert.equal(webVerify.status, 200); assert.equal(webVerify.body.result.payload[0].ok, true); webDriver.close();

  const mcpFixture = await fixture({ id: 'mcp' }); const mcpDriver = driverFor(mcpFixture, 'mcp'); const mcpArgs = { observedSeq: mcpFixture.store.snapshot().lastSeq };
  const mcp = new McpFleetServer({ coordinator: mcpDriver.coordinator, coordination: mcpDriver.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1000, maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase52', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'assess-mcp', name: 'cairn', op: 'causal.assess_recall', action: 'invoke', args: mcpArgs, budgetTokens: 32_000 } } }); assert.equal(mcpResult.result.isError, false); assert.equal(mcpResult.result.structuredContent.payload[0].noOp, false);
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'assess-mcp-verify', name: 'cairn', op: 'causal.assess_recall', action: 'reverify', claim: mcpResult.result.structuredContent, args: mcpArgs, budgetTokens: 32_000 } } }); assert.equal(mcpVerify.result.isError, false); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true); mcpDriver.close();
});

test('RA6: ACI output refusal occurs before the assessment append', async () => {
  const f = await fixture({ id: 'aci' }); const driver = driverFor(f, 'aci', 1024); const before = f.store.snapshot().lastSeq;
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.assess_recall', { observedSeq: before }, context({ idempotencyKey: 'aci', budgetTokens: 1 })), (error) => error.code === 'capability_result_oversize');
  assert.equal(f.store.events().some((event) => event.kind === 'knowledge.recall_assessment_batch'), false); assert.deepEqual(f.store.snapshot().knowledge.assessments ?? [], []); driver.close();
});
