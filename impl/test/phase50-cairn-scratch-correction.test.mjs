import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationIntegrityError, McpFleetServer, ReviewSelectionError, WebNorthbound, createDriver } from '../src/index.mjs';
import { MockAdapter } from '../src/adapter.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase50-${name}-`));
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function repo() {
  const dir = root('repo'); git(['init', '-q'], dir); git(['config', 'user.email', 'baton@example.test'], dir); git(['config', 'user.name', 'Baton'], dir);
  git(['commit', '--allow-empty', '-q', '-m', 'base'], dir); return dir;
}
function routedAdapter(harness, family, models, scenario = { outcome: 'blocked', blocker: 'hold' }) {
  const adapter = new MockAdapter({ harness, version: '1.0.0', concurrencyCeiling: 8, scenario }); const card = adapter.card.bind(adapter);
  adapter.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: models[0], available: models, family, acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low', 'medium', 'high'], serviceTier: null } });
  return adapter;
}
const brief = { goal: 'produce one derived claim', constraints: [], pathScope: ['src/**'], definitionOfDone: 'claim posted', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10_000, usd: 1, wallMin: 2 } };
const oraclePolicy = (overrides = {}) => ({ repoId: 'repo-a', maxTargetBytes: 16 * 1024, maxConstraints: 8, maxConstraintBytes: 1024, ...overrides });
const auditPolicy = (overrides = {}) => ({ repoId: 'repo-a', maxStateRows: 4096, maxNodes: 1024, maxEdges: 2048, maxEvidenceRefs: 8192, maxAuditSamples: 256, maxTraceDepth: 8, maxTraceRows: 1024, maxArtifactBytes: 256 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const promotionPolicy = (overrides = {}) => ({ repoId: 'repo-a', minScratchReaders: 2, maxScanEvents: 4096, maxCandidates: 512, maxCandidateBytes: 512 * 1024, maxEvidenceRefs: 8192, maxBatchBytes: 1024 * 1024, maxResultBytes: 256 * 1024, ...overrides });
const correctionPolicy = (overrides = {}) => ({ repoId: 'repo-a', minScratchReaders: 2, maxScanEvents: 4096, maxAffectedReads: 1024, maxEvidenceRefs: 8192, maxBatchBytes: 1024 * 1024, maxResultBytes: 256 * 1024, ...overrides });
async function until(fn, timeoutMs = 5000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('condition not met'); }
async function reap(driver) { await until(() => driver.coordinator.list().every((worker) => !['pending', 'working'].includes(worker.status))); for (const worker of driver.coordinator.list()) await driver.coordinator.kill(worker.id, 'test'); await until(() => driver.coordinator.list().every((worker) => ['dead', 'exited'].includes(worker.status))); }

async function fixture() {
  const repoRoot = repo(); const logDir = root('log');
  const driver = createDriver({ repoRoot, repoId: 'repo-a', logDir, scratchOraclePolicy: oraclePolicy(), adapters: {
    producer: routedAdapter('producer-harness', 'producer-family', ['producer-model']),
    reviewer: routedAdapter('reviewer-harness', 'reviewer-family', ['reviewer-model']),
    sameHarness: routedAdapter('producer-harness', 'other-family', ['same-harness-model']),
    sameFamily: routedAdapter('other-harness', 'producer-family', ['same-family-model']),
  }, watchdog: { stallMs: 0 } });
  const producer = await driver.coordinator.spawn('producer', brief, { taskId: 'producer-task', model: 'producer-model', effort: 'low', modelPolicy: { allow: ['producer-model'], allowFamilies: ['producer-family'], reasoningEffort: 'low' } });
  const posted = driver.coordinator.postScratchFact(producer.id, { namespace: 'analysis', key: 'derived-claim', value: 'SECRET assertion /Users/alice/private', grounding: 'derived', envRef: { repoId: 'repo-a', treeSha: git(['rev-parse', 'HEAD'], repoRoot) } }, { expectedFence: producer.fence, idempotencyKey: 'fact:derived' });
  return { ...driver, repoRoot, logDir, producer, fact: posted.fact };
}

async function correctionFixture({ correctionOverrides = {}, maxCapabilityBudgetTokens = 64_000, maxCapabilityEnvelopeBytes = 1024 * 1024 } = {}) {
  const repoRoot = repo(); const logDir = root('correction-log'); const artifactRoot = root('cairn-artifacts');
  const driver = createDriver({ repoRoot, repoId: 'repo-a', logDir, scratchOraclePolicy: oraclePolicy(), adapters: {
    producer: routedAdapter('producer-harness', 'producer-family', ['producer-model']),
    reviewer: routedAdapter('reviewer-harness', 'reviewer-family', ['reviewer-model'], { outcome: 'completed' }),
    reader: routedAdapter('reader-harness', 'reader-family', ['reader-model'], { outcome: 'completed' }),
  }, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot, knowledgeAuditPolicy: auditPolicy(), knowledgePromotionPolicy: promotionPolicy(), knowledgeScratchCorrectionPolicy: correctionPolicy(correctionOverrides) }) }, maxCapabilityBudgetTokens, maxCapabilityEnvelopeBytes, watchdog: { stallMs: 0 } });
  const producer = await driver.coordinator.spawn('producer', brief, { taskId: 'producer-task', model: 'producer-model', effort: 'low', modelPolicy: { allow: ['producer-model'], allowFamilies: ['producer-family'], reasoningEffort: 'low' } });
  const post = (key, value, grounding = 'derived') => driver.coordinator.postScratchFact(producer.id, { namespace: 'analysis', key, value, grounding, envRef: { repoId: 'repo-a', treeSha: git(['rev-parse', 'HEAD'], repoRoot) } }, { expectedFence: driver.coordinator.list().find((row) => row.id === producer.id).fence, idempotencyKey: `fact:${key}` }).fact;
  return { ...driver, repoRoot, logDir, artifactRoot, producer, post };
}

function reopenCorrection(previous, correctionOverrides = {}) {
  return createDriver({ repoRoot: previous.repoRoot, repoId: 'repo-a', logDir: previous.logDir, scratchOraclePolicy: oraclePolicy(), adapters: {
    producer: routedAdapter('producer-harness', 'producer-family', ['producer-model']),
    reviewer: routedAdapter('reviewer-harness', 'reviewer-family', ['reviewer-model'], { outcome: 'completed' }),
    reader: routedAdapter('reader-harness', 'reader-family', ['reader-model'], { outcome: 'completed' }),
  }, capabilityFactories: { cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot: previous.artifactRoot, knowledgeAuditPolicy: auditPolicy(), knowledgePromotionPolicy: promotionPolicy(), knowledgeScratchCorrectionPolicy: correctionPolicy(correctionOverrides) }) }, maxCapabilityBudgetTokens: 64_000, maxCapabilityEnvelopeBytes: 1024 * 1024, watchdog: { stallMs: 0 } });
}

function completedReader(store, id) {
  const created = store.createTask({ id, brief: { goal: `verify ${id}` }, deps: [], refines: null, taskType: 'oracle', reservedWorkerId: `w-${id}` }, { actor: 'orchestrator', key: `task:${id}` });
  store.claimTask(id, `w-${id}`, 1, { actor: 'orchestrator', key: `claim:${id}` });
  store.transitionTask(id, 'completed', 2, { actor: 'policy', key: `complete:${id}` });
  const outcome = store.promoteKnowledgeNode({ id: `outcome:${id}`, taskId: id, type: 'Finding', grounding: 'verified', body: `Task ${id} passed its hub verification`, evidence: [{ coordinationSeq: created.event.seq }] }, { kind: 'Finding', trigger: 'verified_task_outcome' }, { actor: 'policy', key: `outcome:${id}` });
  return { created, outcome };
}

function qualifiedObservedFact(driver, prefix) {
  const a = completedReader(driver.coordination, `${prefix}-a`); const b = completedReader(driver.coordination, `${prefix}-b`);
  const envRef = { repoId: 'repo-a', treeSha: git(['rev-parse', 'HEAD'], driver.repoRoot) };
  const posted = driver.coordination.postScratchFact({ namespace: 'analysis', key: `${prefix}-fact`, value: `SECRET ${prefix} /Users/alice/private`, grounding: 'observed', envRef, ownerTask: `${prefix}-a` }, { actor: `worker:${prefix}-a`, key: `scratch:${prefix}` });
  driver.coordination.readScratch(`${prefix}-fact`, envRef, { readerActor: 'worker', readerWorker: `w-${prefix}-a`, taskId: `${prefix}-a` }, { actor: `worker:${prefix}-a`, key: `scratch-read:${prefix}:a` });
  driver.coordination.readScratch(`${prefix}-fact`, envRef, { readerActor: 'worker', readerWorker: `w-${prefix}-b`, taskId: `${prefix}-b` }, { actor: `worker:${prefix}-b`, key: `scratch-read:${prefix}:b` });
  return { fact: posted.fact, event: posted.event, a, b };
}

async function promotedObservedTarget(driver, prefix) {
  const qualified = qualifiedObservedFact(driver, prefix); const observedSeq = driver.coordination.snapshot().lastSeq;
  const result = await driver.coordinator.invokeCapability('cairn', 'causal.promote', { observedSeq }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: `promote:${prefix}`, budgetTokens: 32_000 });
  const candidate = result.payload[0].candidates.find((row) => row.trigger === 'scratch.cited_observed' && row.sourceSeq === qualified.event.seq);
  assert.ok(candidate, JSON.stringify(result.payload[0].candidates));
  return { ...qualified, nodeId: candidate.nodeId, node: driver.coordination.queryKnowledge({ ids: [candidate.nodeId] })[0] };
}

async function oracleForFact(driver, fact, prefix, verification = { command: 'true', expectExit: 0 }) {
  const taskId = `${prefix}-oracle`;
  const oracle = await driver.coordinator.spawnScratchOracle(fact.id, 'reviewer', { taskId, model: 'reviewer-model', effort: 'low', modelPolicy: { allow: ['reviewer-model'], allowFamilies: ['reviewer-family'], reasoningEffort: 'low' }, verification });
  await until(async () => (await driver.coordinator.result(oracle.id)).ready);
  return { fact, oracle, taskId, result: await driver.coordinator.result(oracle.id) };
}
async function oracledFact(driver, prefix, verification = { command: 'true', expectExit: 0 }) { return oracleForFact(driver, driver.post(prefix, `SECRET ${prefix} /Users/alice/private`), prefix, verification); }

test('SC1-SC4: direct Scratch oracle binds a private fact snapshot and preserves exact independent route across restart', async () => {
  const driver = await fixture(); const before = driver.coordinator.list().length;
  await assert.rejects(driver.coordinator.spawnScratchOracle(driver.fact.id, 'sameHarness', { verification: { command: 'true', expectExit: 0 }, model: 'same-harness-model', effort: 'low' }), (error) => error instanceof ReviewSelectionError && error.code === 'scratch_oracle_not_independent');
  await assert.rejects(driver.coordinator.spawnScratchOracle(driver.fact.id, 'sameFamily', { verification: { command: 'true', expectExit: 0 }, model: 'same-family-model', effort: 'low' }), (error) => error instanceof ReviewSelectionError && error.code === 'scratch_oracle_not_independent');
  assert.equal(driver.coordinator.list().length, before, 'independence refusal occurs before allocation');

  const oracle = await driver.coordinator.spawnScratchOracle(driver.fact.id, 'reviewer', {
    taskId: 'oracle-task', model: 'reviewer-model', effort: 'low', modelPolicy: { allow: ['reviewer-model'], allowFamilies: ['reviewer-family'], reasoningEffort: 'low' },
    verification: { command: 'true', expectExit: 0 }, constraints: ['Use a behavioral oracle.'],
  });
  assert.equal(oracle.harnessRequested, 'reviewer'); assert.equal(oracle.harnessResolved, 'reviewer-harness@1.0.0');
  assert.equal(oracle.modelRequested, 'reviewer-model'); assert.equal(oracle.modelResolved, 'reviewer-model');
  assert.equal(oracle.effortRequested, 'low'); assert.equal(oracle.effortResolved, 'low'); assert.equal(oracle.review.independent, true);
  const durable = driver.coordination.task('oracle-task');
  assert.equal(durable.review.knowledgeTarget.scratchFactId, driver.fact.id); assert.equal(durable.review.knowledgeTarget.producerHarness, 'producer-harness');
  assert.equal(durable.review.knowledgeTarget.reviewerFamily, 'reviewer-family'); assert.equal(durable.brief.reviewTarget.assertion.value, 'SECRET assertion /Users/alice/private');
  assert.equal(JSON.stringify(oracle).includes('SECRET assertion'), false, 'public worker handle omits the private assertion');

  await reap(driver);
  driver.close();
  const replay = createDriver({ repoRoot: driver.repoRoot, repoId: 'repo-a', logDir: driver.logDir, scratchOraclePolicy: oraclePolicy(), adapters: {
    producer: routedAdapter('producer-harness', 'producer-family', ['producer-model']), reviewer: routedAdapter('reviewer-harness', 'reviewer-family', ['reviewer-model']),
  }, watchdog: { stallMs: 0 } });
  assert.equal(replay.coordinator.list().find((row) => row.taskId === 'oracle-task').review.knowledgeTarget.scratchFactDigest, durable.review.knowledgeTarget.scratchFactDigest);
  replay.close();
});

test('SC2/SC11: authenticated web and MCP Scratch oracle routes share exact harness/model/effort selection without disclosing the fact', async () => {
  const driver = await fixture(); const origin = 'https://baton.test';
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const principal = { userId: 'alice', sessionId: 'web', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'oracle-web', idempotencyKey: 'oracle-web', command: 'scratch_oracle', repoId: 'repo-a', runId: 'phase50', origin, args: { scratchFactId: driver.fact.id, harness: 'reviewer', model: 'reviewer-model', effort: 'low', modelPolicy: { allow: ['reviewer-model'], allowFamilies: ['reviewer-family'], reasoningEffort: 'low' }, verification: { command: 'true', expectExit: 0 }, taskId: 'oracle-web-task' } });
  assert.equal(webResult.status, 200, JSON.stringify(webResult.body)); assert.equal(webResult.body.result.modelResolved, 'reviewer-model'); assert.equal(webResult.body.result.effortResolved, 'low');
  assert.equal(JSON.stringify(webResult).includes('SECRET assertion'), false); assert.equal(driver.coordination.task('oracle-web-task').review.knowledgeTarget.scratchFactId, driver.fact.id);

  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1000, maxMessageBytes: 128 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase50', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_scratch_oracle', arguments: { repoId: 'repo-a', idempotencyKey: 'oracle-mcp', scratchFactId: driver.fact.id, harness: 'reviewer', model: 'reviewer-model', effort: 'low', modelPolicy: { allow: ['reviewer-model'], allowFamilies: ['reviewer-family'], reasoningEffort: 'low' }, verification: { command: 'true', expectExit: 0 }, taskId: 'oracle-mcp-task' } } });
  assert.equal(mcpResult.result.isError, false, JSON.stringify(mcpResult)); assert.equal(mcpResult.result.structuredContent.modelResolved, 'reviewer-model'); assert.equal(mcpResult.result.structuredContent.effortResolved, 'low');
  assert.equal(JSON.stringify(mcpResult).includes('SECRET assertion'), false); assert.equal(driver.coordination.task('oracle-mcp-task').review.knowledgeTarget.scratchFactId, driver.fact.id);
  await reap(driver); driver.close();
});

test('SC1/SC2: oracle policy is exact and oversized facts refuse before worker allocation', async () => {
  const repoRoot = repo();
  assert.throws(() => createDriver({ repoRoot, repoId: 'repo-a', logDir: root('bad-policy'), adapters: {}, scratchOraclePolicy: { ...oraclePolicy(), surprise: 1 } }), /exact bounded deployment authority/);
  const driver = await fixture(); const posted = driver.coordinator.postScratchFact(driver.producer.id, { namespace: 'analysis', key: 'large', value: 'x'.repeat(32 * 1024), grounding: 'derived', envRef: { repoId: 'repo-a', treeSha: git(['rev-parse', 'HEAD'], driver.repoRoot) } }, { expectedFence: driver.coordinator.list().find((row) => row.id === driver.producer.id).fence, idempotencyKey: 'fact:large' });
  const before = driver.coordinator.list().length;
  await assert.rejects(driver.coordinator.spawnScratchOracle(posted.fact.id, 'reviewer', { verification: { command: 'true', expectExit: 0 }, model: 'reviewer-model', effort: 'low' }), (error) => error.code === 'scratch_oracle_oversize');
  assert.equal(driver.coordinator.list().length, before);
  await reap(driver); driver.close();
});

test('SC2/SC4: an oracle worktree and verification stay pinned to the fact tree after repository HEAD advances', async () => {
  const driver = await correctionFixture(); const fact = driver.post('pinned-tree', 'SECRET pinned tree /Users/alice/private'); const factTree = git(['rev-parse', 'HEAD'], driver.repoRoot);
  writeFileSync(join(driver.repoRoot, 'advanced.txt'), 'later repository state\n'); git(['add', 'advanced.txt'], driver.repoRoot); git(['commit', '-q', '-m', 'advance after fact'], driver.repoRoot); assert.notEqual(git(['rev-parse', 'HEAD'], driver.repoRoot), factTree);
  const bound = await oracleForFact(driver, fact, 'pinned-tree'); assert.equal(bound.result.status, 'completed');
  const durable = driver.coordination.task(bound.taskId); assert.equal(durable.worktreeBaseSha, factTree); assert.equal(durable.review.baseSha, factTree);
  const verified = driver.log.read(bound.oracle.id).find((event) => event.kind === 'verify.reverified'); assert.equal(verified.payload.capture.baseSha, factTree);
  const result = await driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: fact.id, oracleTaskId: bound.taskId, observedSeq: driver.coordination.snapshot().lastSeq }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'pinned-tree:release', budgetTokens: 32_000 }); assert.equal(result.payload[0].replacementGrounding, 'verified');
  await reap(driver); driver.close();
});

test('SC5-SC10: an accepted fact-bound independent oracle atomically releases and exactly reverifies one derived Finding', async () => {
  const driver = await correctionFixture(); const fact = driver.post('derived-release', 'SECRET derived release /Users/alice/private');
  const oracle = await driver.coordinator.spawnScratchOracle(fact.id, 'reviewer', { taskId: 'release-oracle', model: 'reviewer-model', effort: 'low', modelPolicy: { allow: ['reviewer-model'], allowFamilies: ['reviewer-family'], reasoningEffort: 'low' }, verification: { command: 'true', expectExit: 0 } });
  await until(async () => (await driver.coordinator.result(oracle.id)).ready); assert.equal((await driver.coordinator.result(oracle.id)).status, 'completed');
  await assert.rejects(driver.coordinator.integrate(oracle.id), (error) => error.code === 'scratch_oracle_not_integrable');
  const observedSeq = driver.coordination.snapshot().lastSeq; const args = { action: 'release', scratchFactId: fact.id, oracleTaskId: 'release-oracle', observedSeq }; const context = { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'release:direct', budgetTokens: 32_000 };
  const result = await driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', args, context); const document = result.payload[0];
  assert.deepEqual(Object.keys(document).sort(), ['action', 'affectedReadCount', 'eventSeq', 'observedSeq', 'oracleTaskId', 'policyDigest', 'projectionDigest', 'receiptDigest', 'replacementGrounding', 'replacementNodeId', 'repoId', 'requestDigest'].sort());
  assert.equal(document.action, 'release'); assert.equal(document.replacementGrounding, 'verified'); assert.equal(document.oracleTaskId, 'release-oracle'); assert.equal(document.affectedReadCount, 0);
  assert.equal(JSON.stringify(result).includes('SECRET'), false); assert.equal(JSON.stringify(result).includes('/Users/alice/private'), false);
  const event = driver.coordination.events(document.eventSeq, 1)[0]; assert.equal(event.kind, 'knowledge.scratch_corrected'); assert.equal(event.payload.nodes.some((node) => node.body.includes('SECRET')), false);
  const finding = driver.coordination.queryKnowledge({ ids: [document.replacementNodeId] })[0]; assert.equal(finding.grounding, 'verified');
  assert.deepEqual(new Set(driver.coordination.queryKnowledgeEdges().filter((edge) => edge.from === finding.id).map((edge) => edge.type)), new Set(['DerivedFrom', 'VerifiedBy']));
  const verified = await driver.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', result, args, { ...context, idempotencyKey: 'release:verify' }); assert.equal(verified.payload[0].ok, true, JSON.stringify(verified));
  for (const changed of [
    { ...args, scratchFactId: 'scratch-fact:substituted' },
    { ...args, oracleTaskId: 'substituted-oracle' },
    { action: 'retract', targetNodeId: finding.id, expectedValidityVersion: 1, reason: 'operator_correction', observedSeq },
  ]) assert.equal((await driver.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', result, changed, { ...context, idempotencyKey: `release:verify:${changed.action}:${changed.oracleTaskId ?? changed.targetNodeId}` })).payload[0].ok, false);
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { ...args, observedSeq: driver.coordination.snapshot().lastSeq }, { ...context, idempotencyKey: 'release:duplicate' }), (error) => error.code === 'causal_correction_conflict');
  await reap(driver); driver.close();
});

test('SC4: an oracle cannot borrow same-worker verification provenance from another task', async () => {
  const driver = await correctionFixture(); const bound = await oracledFact(driver, 'borrowed-verification'); const oracleA = bound.taskId; const oracleB = `${oracleA}-substitute`;
  const events = driver.coordination.events(); const createdA = events.find((event) => event.kind === 'task.created' && event.payload.id === oracleA); const claimedA = events.find((event) => event.kind === 'task.claimed' && event.payload.id === oracleA);
  driver.coordination.createTask({ ...createdA.payload, id: oracleB }, { actor: 'orchestrator', key: `task:${oracleB}` });
  const attribution = Object.fromEntries(Object.entries(claimedA.payload).filter(([key]) => !['id', 'worker', 'expectedVersion', 'newVersion'].includes(key)));
  driver.coordination.claimTask(oracleB, claimedA.payload.worker, 1, { actor: 'orchestrator', key: `claim:${oracleB}` }, attribution);
  driver.coordination.transitionTask(oracleB, 'completed', 2, { actor: 'policy', key: `complete:${oracleB}` });
  for (const artifact of events.filter((event) => event.kind === 'artifact.registered' && event.payload.taskId === oracleA && ['commit', 'review'].includes(event.payload.kind))) {
    const fields = { taskId: oracleB, kind: artifact.payload.kind, refs: artifact.payload.refs, mediaType: artifact.payload.mediaType, accepted: true, provenance: artifact.payload.provenance };
    if (artifact.payload.review) fields.review = artifact.payload.review;
    driver.coordination.registerArtifact(fields, { actor: 'policy', key: `artifact:${oracleB}:${artifact.payload.kind}` });
  }
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: bound.fact.id, oracleTaskId: oracleB, observedSeq: driver.coordination.snapshot().lastSeq }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'borrowed-verification', budgetTokens: 32_000 }), (error) => error.code === 'causal_correction_conflict');
  await reap(driver); driver.close();
});

test('SC4: a superseded accepted oracle artifact cannot release knowledge', async () => {
  const driver = await correctionFixture(); const bound = await oracledFact(driver, 'withdrawn-oracle'); const task = driver.coordination.task(bound.taskId);
  const accepted = task.artifactIds.map((id) => driver.coordination.artifact(id)).find((artifact) => artifact.kind === 'review' && artifact.accepted === true);
  const replacement = driver.coordination.registerArtifact({ taskId: bound.taskId, kind: 'review', refs: accepted.refs, mediaType: accepted.mediaType, accepted: false, provenance: [], review: accepted.review }, { actor: 'policy', key: 'withdrawn-oracle:replacement' });
  driver.coordination.supersedeArtifact(accepted.id, replacement.artifact.id, 1, { actor: 'policy', key: 'withdrawn-oracle:supersede' });
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: bound.fact.id, oracleTaskId: bound.taskId, observedSeq: driver.coordination.snapshot().lastSeq }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'withdrawn-oracle:release', budgetTokens: 32_000 }), (error) => error.code === 'causal_correction_conflict');
  assert.equal(driver.coordination.events().some((event) => event.kind === 'knowledge.scratch_corrected'), false);
  await reap(driver); driver.close();
});

test('SC5-SC8: a qualified observed replacement supersedes and retracts with exact contamination', async () => {
  const driver = await correctionFixture(); const target = await promotedObservedTarget(driver, 'target-observed'); const replacement = qualifiedObservedFact(driver, 'replacement-observed');
  const targetRead = driver.coordination.readKnowledge({ ids: [target.nodeId] }, { readerActor: 'operator:alice', taskId: 'consumer-a' }, { actor: 'operator:alice', key: 'knowledge-read:target' });
  const observedSeq = driver.coordination.snapshot().lastSeq; const args = { action: 'supersede', targetNodeId: target.nodeId, expectedValidityVersion: 1, replacementScratchFactId: replacement.fact.id, observedSeq };
  const context = { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'correct:observed', budgetTokens: 32_000 };
  const result = await driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', args, context); const document = result.payload[0];
  assert.equal(document.action, 'supersede'); assert.equal(document.replacementGrounding, 'observed'); assert.equal(document.affectedReadCount, 1);
  const receipt = driver.coordination.events(document.eventSeq, 1)[0]; assert.deepEqual(receipt.payload.affectedReadEvents, [targetRead.event.seq]);
  assert.equal(driver.coordination.queryKnowledge({ ids: [target.nodeId] }).length, 0); assert.equal(driver.coordination.queryKnowledge({ ids: [document.replacementNodeId] })[0].validityVersion, 1);
  assert.equal(driver.coordination.queryKnowledgeEdges().some((edge) => edge.type === 'Supersedes' && edge.from === document.replacementNodeId && edge.to === target.nodeId), true);
  assert.equal((await driver.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', result, args, { ...context, idempotencyKey: 'correct:observed:verify' })).payload[0].ok, true);

  const replacementRead = driver.coordination.readKnowledge({ ids: [document.replacementNodeId] }, { readerActor: 'operator:bob', taskId: 'consumer-b' }, { actor: 'operator:bob', key: 'knowledge-read:replacement' });
  const retractArgs = { action: 'retract', targetNodeId: document.replacementNodeId, expectedValidityVersion: 1, reason: 'operator_correction', observedSeq: driver.coordination.snapshot().lastSeq };
  const retracted = await driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', retractArgs, { ...context, idempotencyKey: 'correct:retract' }); const retractDocument = retracted.payload[0];
  assert.deepEqual(Object.keys(retractDocument).sort(), ['action', 'affectedReadCount', 'eventSeq', 'observedSeq', 'policyDigest', 'projectionDigest', 'receiptDigest', 'repoId', 'requestDigest', 'targetNodeId', 'targetValidityVersion'].sort()); assert.equal(retractDocument.affectedReadCount, 1);
  assert.deepEqual(driver.coordination.events(retractDocument.eventSeq, 1)[0].payload.affectedReadEvents, [replacementRead.event.seq]);
  assert.equal(driver.coordination.queryKnowledge({ ids: [document.replacementNodeId] }).length, 0);
  assert.equal((await driver.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', retracted, retractArgs, { ...context, idempotencyKey: 'correct:retract:verify' })).payload[0].ok, true);
  assert.equal(JSON.stringify([result, retracted, receipt]).includes('SECRET'), false); assert.equal(JSON.stringify([result, retracted, receipt]).includes('/Users/alice/private'), false);
  await reap(driver); driver.close();
});

test('SC5-SC11: authenticated web supersedes with an independently-oracled fact and MCP retracts it', async () => {
  const driver = await correctionFixture(); const fact = driver.post('transport-derived', 'SECRET transport replacement /Users/alice/private'); const target = await promotedObservedTarget(driver, 'transport-target');
  const oracle = await driver.coordinator.spawnScratchOracle(fact.id, 'reviewer', { taskId: 'transport-oracle', model: 'reviewer-model', effort: 'low', modelPolicy: { allow: ['reviewer-model'], allowFamilies: ['reviewer-family'], reasoningEffort: 'low' }, verification: { command: 'true', expectExit: 0 } });
  await until(async () => (await driver.coordinator.result(oracle.id)).ready); assert.equal((await driver.coordinator.result(oracle.id)).status, 'completed');
  const origin = 'https://baton.test'; const principal = { userId: 'alice', sessionId: 'web-correct', credentialId: 'cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const webArgs = { action: 'supersede', targetNodeId: target.nodeId, expectedValidityVersion: 1, replacementScratchFactId: fact.id, oracleTaskId: 'transport-oracle', observedSeq: driver.coordination.snapshot().lastSeq };
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'correct-web', idempotencyKey: 'correct-web', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.correct_scratch', action: 'invoke', args: webArgs, budgetTokens: 32_000 } });
  assert.equal(webResult.status, 200, JSON.stringify(webResult.body)); assert.equal(webResult.body.result.payload[0].replacementGrounding, 'verified');
  const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'correct-web-verify', idempotencyKey: 'correct-web-verify', command: 'capability_invoke', repoId: 'repo-a', origin, args: { name: 'cairn', op: 'causal.correct_scratch', action: 'reverify', claim: webResult.body.result, args: webArgs, budgetTokens: 32_000 } });
  assert.equal(webVerify.status, 200); assert.equal(webVerify.body.result.payload[0].ok, true);
  const forgedDirect = await driver.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', webResult.body.result, webArgs, { actor: 'operator:web:alice:web-correct', repoId: 'repo-a', idempotencyKey: 'correct-web-forged-direct', budgetTokens: 32_000 }); assert.equal(forgedDirect.payload[0].ok, false);
  await assert.rejects(driver.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', webResult.body.result, webArgs, { actor: 'web:alice:web-correct', transport: 'web', repoId: 'repo-a', idempotencyKey: 'correct-web-forged-transport', budgetTokens: 32_000 }), (error) => error.code === 'capability_transport_forbidden');

  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp-correct', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], maxWaitMs: 1000, maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase50', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const replacementId = webResult.body.result.payload[0].replacementNodeId; const mcpArgs = { action: 'retract', targetNodeId: replacementId, expectedValidityVersion: 1, reason: 'oracle_withdrawn', observedSeq: driver.coordination.snapshot().lastSeq };
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'correct-mcp', name: 'cairn', op: 'causal.correct_scratch', action: 'invoke', args: mcpArgs, budgetTokens: 32_000 } } });
  assert.equal(mcpResult.result.isError, false, JSON.stringify(mcpResult)); assert.equal(mcpResult.result.structuredContent.payload[0].action, 'retract');
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-a', idempotencyKey: 'correct-mcp-verify', name: 'cairn', op: 'causal.correct_scratch', action: 'reverify', claim: mcpResult.result.structuredContent, args: mcpArgs, budgetTokens: 32_000 } } });
  assert.equal(mcpVerify.result.isError, false); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true);
  assert.equal(JSON.stringify([webResult, mcpResult]).includes('SECRET'), false); assert.equal(JSON.stringify([webResult, mcpResult]).includes('/Users/alice/private'), false);
  await reap(driver); driver.close();
});

test('SC4-SC9: observed, generic, failed, unbound, post-boundary, and stale-tail evidence cannot release', async () => {
  const driver = await correctionFixture(); const acceptedFact = driver.post('accepted-source', 'SECRET accepted'); const unbound = driver.post('unbound-source', 'SECRET unbound'); const failedFact = driver.post('failed-source', 'SECRET failed');
  const accepted = await oracleForFact(driver, acceptedFact, 'accepted-source'); assert.equal(accepted.result.status, 'completed');
  const failed = await oracleForFact(driver, failedFact, 'failed-source', { command: 'false', expectExit: 0 }); assert.equal(failed.result.status, 'failed');
  const generic = completedReader(driver.coordination, 'generic-review'); const observed = qualifiedObservedFact(driver, 'observed-release'); void generic;
  const context = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 32_000 }; const boundary = driver.coordination.snapshot().lastSeq;
  for (const [name, args] of [
    ['unbound', { action: 'release', scratchFactId: unbound.id, oracleTaskId: accepted.taskId, observedSeq: boundary }],
    ['failed', { action: 'release', scratchFactId: failed.fact.id, oracleTaskId: failed.taskId, observedSeq: boundary }],
    ['generic', { action: 'release', scratchFactId: accepted.fact.id, oracleTaskId: 'generic-review', observedSeq: boundary }],
    ['observed', { action: 'release', scratchFactId: observed.fact.id, oracleTaskId: accepted.taskId, observedSeq: boundary }],
  ]) await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', args, { ...context, idempotencyKey: `exclude:${name}` }), (error) => error.code === 'causal_correction_conflict');

  const postBoundary = driver.coordination.postScratchFact({ namespace: 'analysis', key: 'post-boundary-source', value: 'SECRET post boundary', grounding: 'derived', envRef: { repoId: 'repo-a', treeSha: git(['rev-parse', 'HEAD'], driver.repoRoot) }, ownerTask: driver.producer.taskId }, { actor: 'operator:alice', key: 'scratch:post-boundary-source' }).fact; assert.ok(postBoundary);
  await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: accepted.fact.id, oracleTaskId: accepted.taskId, observedSeq: boundary }, { ...context, idempotencyKey: 'exclude:stale-tail' }), (error) => error.code === 'causal_correction_conflict');
  assert.equal(driver.coordination.events().some((event) => event.kind === 'knowledge.scratch_corrected'), false);
  await reap(driver); driver.close();
});

test('SC1-SC3: route admission, policy shape, producer-route integrity, and hub-derived Scratch IDs fail closed', async () => {
  const driver = await fixture(); const before = driver.coordinator.list().length;
  for (const [vendor, opts, code] of [
    ['auto', { model: 'reviewer-model', effort: 'low' }, 'explicit_vendor_required'],
    ['reviewer', { model: 'missing-model', effort: 'low' }, 'model_unavailable'],
    ['reviewer', { model: 'reviewer-model', effort: 'extreme' }, 'reasoning_effort_unsupported'],
  ]) await assert.rejects(driver.coordinator.spawnScratchOracle(driver.fact.id, vendor, { ...opts, verification: { command: 'true', expectExit: 0 } }), (error) => error.code === code);
  assert.equal(driver.coordinator.list().length, before);
  assert.throws(() => driver.coordination.postScratchFact({ id: 'SECRET /Users/alice/private', namespace: 'analysis', key: 'unsafe', value: 'safe', grounding: 'derived', envRef: { repoId: 'repo-a', treeSha: git(['rev-parse', 'HEAD'], driver.repoRoot) }, ownerTask: driver.producer.taskId }, { actor: 'operator:alice', key: 'unsafe-id' }), (error) => error.code === 'invalid_scratch_id');
  assert.throws(() => new CairnRunScorecard({ coordination: driver.coordination, readOperational: () => [], artifactRoot: root('bad-correction'), knowledgeAuditPolicy: auditPolicy(), knowledgePromotionPolicy: promotionPolicy(), knowledgeScratchCorrectionPolicy: correctionPolicy({ surprise: 1 }) }), /configuration is invalid/);
  assert.throws(() => new CairnRunScorecard({ coordination: driver.coordination, readOperational: () => [], artifactRoot: root('bad-repo'), knowledgeAuditPolicy: auditPolicy(), knowledgePromotionPolicy: promotionPolicy(), knowledgeScratchCorrectionPolicy: correctionPolicy({ repoId: 'repo-b' }) }), /configuration is invalid/);
  await reap(driver); driver.close();

  const rows = readFileSync(join(driver.logDir, 'coordination', 'events.jsonl'), 'utf8').trimEnd().split('\n').map(JSON.parse); const claim = rows.find((row) => row.kind === 'task.claimed' && row.payload.id === driver.producer.taskId); claim.payload.routeKey = 'malformed'; writeFileSync(join(driver.logDir, 'coordination', 'events.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
  const replay = createDriver({ repoRoot: driver.repoRoot, repoId: 'repo-a', logDir: driver.logDir, scratchOraclePolicy: oraclePolicy(), adapters: { producer: routedAdapter('producer-harness', 'producer-family', ['producer-model']), reviewer: routedAdapter('reviewer-harness', 'reviewer-family', ['reviewer-model']) }, watchdog: { stallMs: 0 } });
  await assert.rejects(replay.coordinator.spawnScratchOracle(driver.fact.id, 'reviewer', { model: 'reviewer-model', effort: 'low', verification: { command: 'true', expectExit: 0 } }), (error) => error.code === 'scratch_oracle_route_unavailable'); replay.close();
});

test('SC8-SC9: scan/read/evidence/batch/result ceilings, cancellation, ACI preflight, and append failure leave no correction', async () => {
  for (const overrides of [{ maxScanEvents: 1 }, { maxEvidenceRefs: 1 }, { maxBatchBytes: 64 }, { maxResultBytes: 64 }]) {
    const driver = await correctionFixture({ correctionOverrides: overrides }); const bound = await oracledFact(driver, `ceiling-${Object.keys(overrides)[0]}`); assert.equal(bound.result.status, 'completed'); const before = driver.coordination.snapshot().lastSeq;
    await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: bound.fact.id, oracleTaskId: bound.taskId, observedSeq: before }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: `ceiling:${Object.keys(overrides)[0]}`, budgetTokens: 32_000 }), (error) => error.code === 'causal_correction_oversize');
    assert.equal(driver.coordination.events().some((event) => event.kind === 'knowledge.scratch_corrected'), false); await reap(driver); driver.close();
  }

  const reads = await correctionFixture({ correctionOverrides: { maxAffectedReads: 1 } }); const target = await promotedObservedTarget(reads, 'read-ceiling-target');
  reads.coordination.readKnowledge({ ids: [target.nodeId] }, { readerActor: 'operator:a' }, { actor: 'operator:a', key: 'read-ceiling:a' }); reads.coordination.readKnowledge({ ids: [target.nodeId] }, { readerActor: 'operator:b' }, { actor: 'operator:b', key: 'read-ceiling:b' }); const readBefore = reads.coordination.snapshot().lastSeq;
  await assert.rejects(reads.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'retract', targetNodeId: target.nodeId, expectedValidityVersion: 1, reason: 'operator_correction', observedSeq: readBefore }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'ceiling:reads', budgetTokens: 32_000 }), (error) => error.code === 'causal_correction_oversize'); assert.equal(reads.coordination.queryKnowledge({ ids: [target.nodeId] }).length, 1); await reap(reads); reads.close();

  const budget = await correctionFixture(); const budgetBound = await oracledFact(budget, 'aci-budget'); const budgetBefore = budget.coordination.snapshot().lastSeq;
  await assert.rejects(budget.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: budgetBound.fact.id, oracleTaskId: budgetBound.taskId, observedSeq: budgetBefore }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'aci-budget', budgetTokens: 1 }), (error) => error.code === 'capability_result_oversize'); assert.equal(budget.coordination.events().some((event) => event.kind === 'knowledge.scratch_corrected'), false); await reap(budget); budget.close();

  for (const phase of ['before', 'after-audit', 'before-write']) {
    const driver = await correctionFixture(); const bound = await oracledFact(driver, `cancel-${phase}`); const abort = new AbortController(); const before = driver.coordination.snapshot().lastSeq;
    if (phase === 'before') abort.abort();
    if (phase === 'after-audit') { const audit = driver.coordination.auditKnowledge.bind(driver.coordination); driver.coordination.auditKnowledge = (...args) => { const result = audit(...args); abort.abort(); return result; }; }
    if (phase === 'before-write') { const validate = driver.coordination._validateScratchCorrectionPayload.bind(driver.coordination); let armed = true; driver.coordination._validateScratchCorrectionPayload = (...args) => { const result = validate(...args); if (armed && args[2] === false) { armed = false; abort.abort(); } return result; }; }
    await assert.rejects(driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: bound.fact.id, oracleTaskId: bound.taskId, observedSeq: before }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: `cancel:${phase}`, budgetTokens: 32_000, signal: abort.signal }), (error) => error.code === 'cancelled'); assert.equal(driver.coordination.events().some((event) => event.kind === 'knowledge.scratch_corrected'), false); await reap(driver); driver.close();
  }

  const failed = await correctionFixture(); const failedBound = await oracledFact(failed, 'append-failure'); const append = failed.coordination._appendFile; failed.coordination._appendFile = (path, data, encoding) => { if (data.includes('"knowledge.scratch_corrected"')) throw new Error('disk full'); return append(path, data, encoding); }; const failedBefore = failed.coordination.snapshot().lastSeq;
  await assert.rejects(failed.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'release', scratchFactId: failedBound.fact.id, oracleTaskId: failedBound.taskId, observedSeq: failedBefore }, { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'append-failure', budgetTokens: 32_000 }), /disk full/); assert.equal(failed.coordination.events().some((event) => event.kind === 'knowledge.scratch_corrected'), false); failed.coordination._appendFile = append; await reap(failed); failed.close();
});

test('SC6/SC9: stale CAS, unresolved contradiction, and same-source correction refuse without mutation', async () => {
  const stale = await correctionFixture(); const target = await promotedObservedTarget(stale, 'cas-target'); const replacement = qualifiedObservedFact(stale, 'cas-replacement'); const boundary = stale.coordination.snapshot().lastSeq; const context = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 32_000 };
  await assert.rejects(stale.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'supersede', targetNodeId: target.nodeId, expectedValidityVersion: 2, replacementScratchFactId: replacement.fact.id, observedSeq: boundary }, { ...context, idempotencyKey: 'stale-cas' }), (error) => error.code === 'causal_correction_conflict');
  await assert.rejects(stale.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'supersede', targetNodeId: target.nodeId, expectedValidityVersion: 1, replacementScratchFactId: target.fact.id, observedSeq: boundary }, { ...context, idempotencyKey: 'same-source' }), (error) => error.code === 'causal_correction_conflict');
  const other = stale.coordination.addKnowledgeNode({ id: 'finding:contradiction-peer', type: 'Finding', grounding: 'observed', body: 'peer', evidence: [{ coordinationSeq: target.node.observedSeq }] }, { actor: 'policy', key: 'contradiction-peer' }); stale.coordination.addKnowledgeEdge({ type: 'Contradicts', from: target.nodeId, to: other.node.id, evidence: [{ coordinationSeq: other.event.seq }] }, { actor: 'operator:alice', key: 'contradiction-open' });
  await assert.rejects(stale.coordinator.invokeCapability('cairn', 'causal.correct_scratch', { action: 'retract', targetNodeId: target.nodeId, expectedValidityVersion: 1, reason: 'operator_correction', observedSeq: stale.coordination.snapshot().lastSeq }, { ...context, idempotencyKey: 'contradiction-retract' }), (error) => error.code === 'unresolved_contradiction'); assert.equal(stale.coordination.queryKnowledge({ ids: [target.nodeId] }).length, 1); await reap(stale); stale.close();
});

test('SC4/SC9/SC10: correction restart and route, artifact, row, and contamination tampering fail replay', async () => {
  const driver = await correctionFixture(); const bound = await oracledFact(driver, 'replay-release'); const observedSeq = driver.coordination.snapshot().lastSeq; const args = { action: 'release', scratchFactId: bound.fact.id, oracleTaskId: bound.taskId, observedSeq }; const context = { actor: 'operator:alice', repoId: 'repo-a', idempotencyKey: 'replay-release', budgetTokens: 32_000 };
  const claim = await driver.coordinator.invokeCapability('cairn', 'causal.correct_scratch', args, context); await reap(driver); driver.close();
  const replay = reopenCorrection(driver); assert.equal((await replay.coordinator.reverifyCapability('cairn', 'causal.correct_scratch', claim, args, { ...context, idempotencyKey: 'replay-release:verify' })).payload[0].ok, true); replay.close();
  const file = join(driver.logDir, 'coordination', 'events.jsonl'); const original = readFileSync(file, 'utf8');
  for (const mutate of [
    (rows) => { rows.find((row) => row.kind === 'knowledge.scratch_corrected').payload.nodes[0].body = 'substituted'; },
    (rows) => { const row = rows.find((event) => event.kind === 'task.claimed' && event.payload.id === bound.taskId); const tuple = JSON.parse(row.payload.routeKey); tuple[2] = 'substituted-model'; row.payload.routeKey = JSON.stringify(tuple); },
    (rows) => { rows.find((row) => row.kind === 'artifact.registered' && row.payload.taskId === bound.taskId && row.payload.kind === 'review').payload.refs.sha = '0'.repeat(40); },
    (rows) => { rows.find((row) => row.kind === 'knowledge.scratch_corrected').payload.affectedReadEvents = [1]; },
  ]) {
    const rows = original.trimEnd().split('\n').map(JSON.parse); mutate(rows); writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`); assert.throws(() => reopenCorrection(driver), (error) => error instanceof CoordinationIntegrityError); writeFileSync(file, original);
  }
});
