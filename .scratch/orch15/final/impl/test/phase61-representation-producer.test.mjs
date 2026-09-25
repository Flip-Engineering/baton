import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, AtlasCpgDelta, AtlasRepresentationProducer, AtlasStructuralDelta, CapabilityRegistry, McpFleetServer, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase61-${name}-`));
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const canonicalSha = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const result = (op = 'source.op') => ({
  op, status: 'ok', summary: 'complete source result', payload: [{ ok: true }], refs: [],
  cost: { tokens_out: 1, wall_ms: 0, usd: 0, underlying: 'fixture' },
  provenance: { deterministic: true, verificationAuthority: false, mergeAuthority: false },
});
function sink() {
  let seq = 0;
  return (event) => {
    seq += 1;
    return { evidence: { coordinationSeq: seq, kind: event.kind, worker: 'hub-capability', workerSeq: seq, digest: sha(event), ts: `2026-07-13T00:00:${String(seq).padStart(2, '0')}.000Z` } };
  };
}
const ctx = (key) => ({ actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: key, budgetTokens: 1_000 });

test('GR2: internal attested ACI calls return exact mapped start/terminal coordinates without changing public results', async () => {
  const capability = { card: () => ({ name: 'source', version: '1', ops: { 'source.op': { latency_class: 'interactive', deterministic: true, reverifiable: true } } }), invoke: async () => result() };
  const registry = new CapabilityRegistry({ capabilities: { source: capability }, maxBudgetTokens: 2_000, maxEnvelopeBytes: 64 * 1024, idempotencyRoot: root('attested'), record: sink() });
  const publicResult = await registry.invoke('source', 'source.op', {}, ctx('public'));
  assert.deepEqual(publicResult, result());
  const attested = await registry.invokeAttested('source', 'source.op', {}, ctx('attested'));
  assert.deepEqual(attested.result, result());
  assert.deepEqual(attested.evidence.map((row) => row.kind), ['capability.op.started', 'capability.op.completed']);
  assert.equal(attested.evidence.every((row) => Number.isSafeInteger(row.coordinationSeq) && /^[a-f0-9]{64}$/u.test(row.digest)), true);
  assert.equal(Object.hasOwn(publicResult, 'evidence'), false);
});

test('GR2/GR6: attested replay reconstructs terminal completion evidence after the child completion-map gap without repeating the source', async () => {
  const idempotencyRoot = root('attested-recovery'); let effects = 0; let seq = 0;
  const capability = { card: () => ({ name: 'source', version: '1', ops: { 'source.op': { latency_class: 'interactive', deterministic: true, reverifiable: true } } }), invoke: async () => { effects += 1; return result(); } };
  const failingRecord = (event) => { if (event.kind === 'capability.op.completed') throw new Error('simulated completion-map loss'); seq += 1; return { evidence: { coordinationSeq: seq, kind: event.kind, worker: 'hub-capability', workerSeq: seq, digest: sha(event), ts: `2026-07-13T00:01:${String(seq).padStart(2, '0')}.000Z` } }; };
  const first = new CapabilityRegistry({ capabilities: { source: capability }, maxBudgetTokens: 2_000, maxEnvelopeBytes: 64 * 1024, idempotencyRoot, record: failingRecord });
  await assert.rejects(first.invokeAttested('source', 'source.op', {}, ctx('attested-recovery')), (error) => error.code === 'capability_record_unavailable');
  assert.equal(effects, 1);
  const restarted = new CapabilityRegistry({ capabilities: { source: capability }, maxBudgetTokens: 2_000, maxEnvelopeBytes: 64 * 1024, idempotencyRoot, record: sink() });
  const recovered = await restarted.invokeAttested('source', 'source.op', {}, ctx('attested-recovery'));
  assert.equal(effects, 1); assert.deepEqual(recovered.result, result());
  assert.deepEqual(recovered.evidence.map((row) => row.kind), ['capability.op.completed', 'capability.op.replayed']);
});

test('GR6: a capability-specific durable reconciliation closes an outer pending ACI record without repeating its effect', async () => {
  const idempotencyRoot = root('pending'); let effects = 0; const card = () => ({ name: 'source', version: '1', ops: { 'source.op': { latency_class: 'interactive', deterministic: true, reverifiable: true } } });
  const first = new CapabilityRegistry({ capabilities: { source: { card, invoke: async () => { effects += 1; throw Object.assign(new Error('completion write lost after durable effect'), { code: 'capability_record_unavailable' }); } } }, maxBudgetTokens: 2_000, maxEnvelopeBytes: 64 * 1024, idempotencyRoot, record: sink() });
  await assert.rejects(first.invoke('source', 'source.op', { exact: true }, ctx('pending')), (error) => error.code === 'capability_record_unavailable');
  assert.equal(effects, 1);
  let reconciliations = 0;
  const restarted = new CapabilityRegistry({ capabilities: { source: { card, invoke: async () => { effects += 1; return result(); }, reconcile: async (_op, args) => { reconciliations += 1; assert.deepEqual(args, { exact: true }); return result(); } } }, maxBudgetTokens: 2_000, maxEnvelopeBytes: 64 * 1024, idempotencyRoot, record: sink() });
  assert.deepEqual(await restarted.invoke('source', 'source.op', { exact: true }, ctx('pending')), result());
  assert.equal(effects, 1); assert.equal(reconciliations, 1);
  assert.deepEqual(await restarted.invoke('source', 'source.op', { exact: true }, ctx('pending')), result());
  assert.equal(effects, 1); assert.equal(reconciliations, 1);
});

test('GR3/GR4: producer output preflight refuses an oversized outer ACI result before receipt or graph effects', async () => {
  const repo = root('preflight-repo'); execFileSync('git', ['init', '-q'], { cwd: repo });
  const artifact = { handle: `art:sha256:${'a'.repeat(64)}`, kind: 'structural_delta', digest: 'a'.repeat(64), bytes: 32, mediaType: 'application/vnd.baton.atlas-structural+json' };
  const sourceResult = { op: 'diff.structural', status: 'ok', summary: 'tiny', payload: [], refs: [artifact], cost: { tokens_out: 1, wall_ms: 0, usd: 0, underlying: 'fixture' }, provenance: { deterministic: true, artifactDigest: artifact.digest } };
  const projection = { ...sourceResult, refs: [artifact], cost: { tokens_out: 1, usd: 0, underlying: 'fixture' } };
  const source = {
    card: () => ({ name: 'atlas-structural', version: '0.1.0', ops: { 'diff.structural': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true } } }),
    invoke: async () => sourceResult,
    resume: async () => sourceResult,
    reverify: async () => ({ ok: true, primaryRef: artifact, resultProjection: projection, resultProjectionDigest: canonicalSha(projection), observedDigest: artifact.digest }),
  };
  const policy = { schemaVersion: 1, repoId: 'repo-phase61', maxArgumentBytes: 64 * 1024, maxSourceRefs: 4, maxSourceRefBytes: 16 * 1024, maxEvidenceRefs: 2, maxReceiptBytes: 64 * 1024, maxGraphBatchBytes: 256 * 1024, maxResultItems: 1, maxResultRefs: 1, maxResultBytes: 64 * 1024 };
  const driver = createDriver({ repoRoot: repo, repoId: 'repo-phase61', logDir: root('preflight-log'), adapters: {}, capabilities: { 'atlas-structural': source }, representationProduction: { policy, artifactRoot: root('preflight-receipts'), authorize: async () => true, resolveEnvironment: async () => ({ schemaVersion: 1, kind: 'tree_delta', repoId: 'repo-phase61', beforeTreeSha: 'a'.repeat(40), beforeOverlayDigest: 'b'.repeat(64), afterTreeSha: 'c'.repeat(40), afterOverlayDigest: 'd'.repeat(64) }) }, maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 1024 * 1024 });
  const taskId = `preflight-${'x'.repeat(246)}`;
  driver.coordination.createTask({ id: taskId, deps: [], reservedWorkerId: 'preflight-worker' }, { actor: 'orchestrator', key: 'task:create:preflight' });
  driver.coordination.claimTask(taskId, 'preflight-worker', 1, { actor: 'orchestrator', key: 'task:claim:preflight' });
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { producerKind: 'structural_delta', taskId, sourceArgs: { beforePath: 'a.mjs', afterPath: 'b.mjs', language: 'javascript' } }, { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: 'representation:preflight', budgetTokens: 250 }),
    (error) => error.code === 'capability_result_oversize' && /admitted ACI output envelope/.test(error.message));
  assert.equal(driver.coordination.events().some((event) => event.kind === 'knowledge.representation_produced'), false);
  driver.close();
});

test('GR1/GR2/GR8: initial source-card substitution, dishonest resume, and a symlinked receipt root fail closed', async () => {
  const policy = { schemaVersion: 1, repoId: 'repo-phase61', maxArgumentBytes: 64 * 1024, maxSourceRefs: 4, maxSourceRefBytes: 16 * 1024, maxEvidenceRefs: 2, maxReceiptBytes: 64 * 1024, maxGraphBatchBytes: 256 * 1024, maxResultItems: 1, maxResultRefs: 1, maxResultBytes: 64 * 1024 };
  const target = root('symlink-target'); const parent = root('symlink-parent'); const link = join(parent, 'receipt-link'); symlinkSync(target, link, 'dir');
  const coordination = Object.fromEntries(['representationProductionAdmission', 'prepareRepresentationProduction', 'recordRepresentationProduction', 'representationProduction', 'representationProductionByRequest', 'reverifyRepresentationProduction'].map((name) => [name, () => null]));
  assert.throws(() => new AtlasRepresentationProducer({ coordination, policy, artifactRoot: link, authorize: async () => true, resolveEnvironment: async () => ({}) }), /must not be a symlink/);

  const makeDriver = (source, name) => {
    const repo = root(`${name}-repo`); execFileSync('git', ['init', '-q'], { cwd: repo });
    const beforeRoot = root(`${name}-before`); const afterRoot = root(`${name}-after`);
    writeFileSync(join(beforeRoot, 'sample.mjs'), `${Array.from({ length: 80 }, (_, index) => `export function before${index}() { return ${index}; }`).join('\n')}\n`);
    writeFileSync(join(afterRoot, 'sample.mjs'), `${Array.from({ length: 80 }, (_, index) => `export function after${index}() { return ${index + 1}; }`).join('\n')}\n`);
    const driver = createDriver({ repoRoot: repo, repoId: 'repo-phase61', logDir: root(`${name}-log`), adapters: {}, capabilities: { 'atlas-structural': source }, capabilityContexts: { 'atlas-structural': { beforeRoot, afterRoot } }, representationProduction: { policy, artifactRoot: root(`${name}-receipts`), authorize: async () => true, resolveEnvironment: async () => ({ schemaVersion: 1, kind: 'tree_delta', repoId: 'repo-phase61', beforeTreeSha: 'a'.repeat(40), beforeOverlayDigest: 'b'.repeat(64), afterTreeSha: 'c'.repeat(40), afterOverlayDigest: 'd'.repeat(64) }) }, maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 1024 * 1024 });
    driver.coordination.createTask({ id: `${name}-task`, deps: [], reservedWorkerId: `${name}-worker` }, { actor: 'orchestrator', key: `task:create:${name}` });
    driver.coordination.claimTask(`${name}-task`, `${name}-worker`, 1, { actor: 'orchestrator', key: `task:claim:${name}` });
    return driver;
  };

  const cardSource = new AtlasStructuralDelta({ artifactRoot: root('bad-card-source') }); let cardInvokes = 0;
  const cardInvoke = cardSource.invoke.bind(cardSource); cardSource.invoke = async (...args) => { cardInvokes += 1; return cardInvoke(...args); };
  const honestCard = cardSource.card.bind(cardSource); cardSource.card = () => { const card = honestCard(); return { ...card, ops: { 'diff.structural': { ...card.ops['diff.structural'], deterministic: false } } }; };
  const cardDriver = makeDriver(cardSource, 'bad-card');
  await assert.rejects(cardDriver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { producerKind: 'structural_delta', taskId: 'bad-card-task', sourceArgs: { beforePath: 'sample.mjs', afterPath: 'sample.mjs', language: 'javascript' } }, { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: 'bad-card', budgetTokens: 1_600 }), (error) => error.code === 'representation_source_card_mismatch');
  assert.equal(cardInvokes, 0); cardDriver.close();

  const resumeSource = new AtlasStructuralDelta({ artifactRoot: root('bad-resume-source') }); let resumeCalls = 0;
  resumeSource.resume = async () => { resumeCalls += 1; throw Object.assign(new Error('dishonest resume'), { code: 'dishonest_resume' }); };
  const resumeDriver = makeDriver(resumeSource, 'bad-resume');
  await assert.rejects(resumeDriver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { producerKind: 'structural_delta', taskId: 'bad-resume-task', sourceArgs: { beforePath: 'sample.mjs', afterPath: 'sample.mjs', language: 'javascript' } }, { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: 'bad-resume', budgetTokens: 1_600 }), (error) => error.code === 'dishonest_resume');
  assert.equal(resumeCalls, 1); assert.equal(resumeDriver.coordination.events().some((event) => event.kind === 'knowledge.representation_produced'), false); resumeDriver.close();
});

test('GR1-GR7: createDriver produces and reverifies one graph-backed structural Representation through the shared ACI plane', async () => {
  const repo = root('producer-repo'); execFileSync('git', ['init', '-q'], { cwd: repo });
  const beforeRoot = root('producer-before'); const afterRoot = root('producer-after');
  writeFileSync(join(beforeRoot, 'sample.mjs'), `${Array.from({ length: 80 }, (_, index) => `export function value${index}() { return 1; }`).join('\n')}\n`);
  writeFileSync(join(afterRoot, 'sample.mjs'), `${Array.from({ length: 80 }, (_, index) => `export function value${index}() { return 2; }`).join('\n')}\n`);
  const sourceArtifacts = root('producer-source-artifacts'); const receiptRoot = root('producer-receipts');
  mkdirSync(sourceArtifacts, { recursive: true });
  let sourceClockCalls = 0; let sourceClock = 0; const structural = new AtlasStructuralDelta({ artifactRoot: sourceArtifacts, now: () => { sourceClockCalls += 1; sourceClock += sourceClockCalls; return sourceClock; } });
  const representationPolicy = {
    schemaVersion: 1, repoId: 'repo-phase61', maxArgumentBytes: 64 * 1024,
    maxSourceRefs: 8, maxSourceRefBytes: 16 * 1024, maxEvidenceRefs: 2, maxReceiptBytes: 64 * 1024,
    maxGraphBatchBytes: 256 * 1024, maxResultItems: 1, maxResultRefs: 1, maxResultBytes: 64 * 1024,
  };
  let authorizationEnabled = true; let resolverCalls = 0; let driftOnConfirm = false;
  const treeEnvironment = { schemaVersion: 1, kind: 'tree_delta', repoId: 'repo-phase61', beforeTreeSha: 'a'.repeat(40), beforeOverlayDigest: 'b'.repeat(64), afterTreeSha: 'c'.repeat(40), afterOverlayDigest: 'd'.repeat(64) };
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-phase61', logDir: root('producer-log'), adapters: {},
    capabilities: { 'atlas-structural': structural },
    capabilityContexts: { 'atlas-structural': { beforeRoot, afterRoot } },
    representationProduction: {
      policy: representationPolicy, artifactRoot: receiptRoot,
      authorize: async ({ actor, repoId }) => authorizationEnabled && repoId === 'repo-phase61' && (actor === 'orchestrator' || actor.startsWith('web:') || actor.startsWith('mcp:')),
      resolveEnvironment: async ({ action }) => { resolverCalls += 1; return driftOnConfirm && action === 'confirm' ? { ...treeEnvironment, afterOverlayDigest: 'e'.repeat(64) } : treeEnvironment; },
    },
    maxCapabilityBudgetTokens: 64_000, maxCapabilityEnvelopeBytes: 1024 * 1024,
  });
  const addTask = (taskId) => {
    driver.coordination.createTask({ id: taskId, deps: [], reservedWorkerId: `${taskId}-worker` }, { actor: 'orchestrator', key: `task:create:${taskId}` });
    driver.coordination.claimTask(taskId, `${taskId}-worker`, 1, { actor: 'orchestrator', key: `task:claim:${taskId}` });
  };
  addTask('representation-task');
  const args = { producerKind: 'structural_delta', taskId: 'representation-task', sourceArgs: { beforePath: 'sample.mjs', afterPath: 'sample.mjs', language: 'javascript' } };
  const invokeCtx = { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: 'representation:direct', budgetTokens: 32_000 };
  const produced = await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, invokeCtx);
  assert.equal(produced.status, 'ok'); assert.equal(produced.payload[0].grounding, 'derived'); assert.equal(produced.payload[0].rung, 'R1');
  assert.equal(produced.payload[0].authority.policyAuthoring, false); assert.equal(produced.provenance.policyAuthoringAuthority, false);
  const representation = driver.coordination.representationProduction(produced.payload[0].identityDigest);
  assert.equal(representation.node.type, 'Representation'); assert.equal(representation.node.grounding, 'derived');
  assert.deepEqual(representation.edges.map((edge) => edge.type).sort(), ['DerivedFrom', 'ObservedIn', 'ProducedBy']);
  const receiptPath = join(receiptRoot, `${produced.payload[0].receiptDigest}.json`); const receipt = readFileSync(receiptPath, 'utf8');
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
  for (const forbidden of ['sample.mjs', beforeRoot, afterRoot, 'return 1', 'return 2', 'verificationAuthority']) assert.equal(receipt.includes(forbidden), false, forbidden);
  const checked = await driver.coordinator.reverifyCapability('atlas-representation-producer', 'representation.produce', produced, args, { ...invokeCtx, idempotencyKey: 'representation:direct:reverify' });
  assert.equal(checked.status, 'ok', JSON.stringify(checked)); assert.equal(checked.payload[0].ok, true);
  const sourceBeforeForgeries = driver.log.read('hub-capability').filter((event) => event.payload?.capability === 'atlas-structural' && event.payload?.action === 'invoke').length;
  const forgedClaims = [
    { ...produced, op: 'forged.op' }, { ...produced, status: 'partial' }, { ...produced, summary: 'forged summary' },
    { ...produced, refs: [] }, { ...produced, cost: { ...produced.cost, usd: 999 } },
    { ...produced, provenance: { ...produced.provenance, verificationAuthority: true } },
  ];
  for (const [index, forged] of forgedClaims.entries()) {
    const refused = await driver.coordinator.reverifyCapability('atlas-representation-producer', 'representation.produce', forged, args, { ...invokeCtx, idempotencyKey: `representation:forged:${index}` });
    assert.equal(refused.status, 'diverged'); assert.equal(refused.payload[0].code, 'representation_claim_invalid');
  }
  assert.equal(driver.log.read('hub-capability').filter((event) => event.payload?.capability === 'atlas-structural' && event.payload?.action === 'invoke').length, sourceBeforeForgeries, 'forged outer claims refuse before source work');
  assert.deepEqual(await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, invokeCtx), produced);

  writeFileSync(receiptPath, `${receipt} `);
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, invokeCtx), (error) => error.code === 'representation_receipt_integrity');
  writeFileSync(receiptPath, receipt); chmodSync(receiptPath, 0o600);
  const sourceArtifactPath = join(sourceArtifacts, `${representation.source.artifact.digest}.json`); const sourceArtifact = readFileSync(sourceArtifactPath);
  writeFileSync(sourceArtifactPath, Buffer.concat([sourceArtifact, Buffer.from(' ')]));
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, invokeCtx), (error) => error.code === 'artifact_integrity');
  writeFileSync(sourceArtifactPath, sourceArtifact); chmodSync(sourceArtifactPath, 0o600);
  assert.deepEqual(await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, invokeCtx), produced);

  addTask('representation-forbidden'); const resolverBeforeRefusals = resolverCalls;
  authorizationEnabled = false;
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { ...args, taskId: 'representation-forbidden' }, { ...invokeCtx, idempotencyKey: 'representation:forbidden' }), (error) => error.code === 'representation_forbidden');
  authorizationEnabled = true;
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { ...args, taskId: 'representation-forbidden', sourceArgs: { ...args.sourceArgs, unknown: true } }, { ...invokeCtx, idempotencyKey: 'representation:malformed' }), (error) => error.code === 'representation_request_invalid');
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { ...args, taskId: 'representation-forbidden', sourceArgs: { ...args.sourceArgs, language: 'x'.repeat(70 * 1024) } }, { ...invokeCtx, idempotencyKey: 'representation:oversize' }), (error) => error.code === 'representation_oversize');
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { ...args, taskId: 'representation-forbidden' }, { ...invokeCtx, repoId: 'repo-other', idempotencyKey: 'representation:cross-repo' }), (error) => error.code === 'representation_context_invalid');
  assert.equal(resolverCalls, resolverBeforeRefusals, 'refused requests cannot trigger environment resolution');

  addTask('representation-environment-race'); const graphBeforeDrift = driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length;
  driftOnConfirm = true;
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { ...args, taskId: 'representation-environment-race' }, { ...invokeCtx, idempotencyKey: 'representation:environment-race' }), (error) => error.code === 'representation_environment_changed');
  driftOnConfirm = false;
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length, graphBeforeDrift);

  addTask('representation-resumable'); const resumableArgs = { ...args, taskId: 'representation-resumable' };
  const resumable = await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', resumableArgs, { ...invokeCtx, idempotencyKey: 'representation:resumable', budgetTokens: 1_600 });
  assert.equal(resumable.status, 'ok');
  const resumableSource = driver.log.read('hub-capability').filter((event) => event.payload?.capability === 'atlas-structural' && event.payload?.action === 'invoke').at(-1);
  assert.equal(resumableSource.payload.status, 'needs_resume', 'a complete source artifact may be promoted despite honest inline truncation only when resume is advertised');

  addTask('representation-concurrent'); const concurrentArgs = { ...args, taskId: 'representation-concurrent' };
  const producedBeforeConcurrent = driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length;
  const boundBeforeConcurrent = driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_request_bound').length;
  const concurrent = await Promise.all(['a', 'b'].map((suffix) => driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', concurrentArgs, { ...invokeCtx, idempotencyKey: `representation:concurrent:${suffix}` })));
  assert.deepEqual(concurrent[0], concurrent[1]);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length, producedBeforeConcurrent + 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_request_bound').length, boundBeforeConcurrent + 1);

  addTask('representation-web'); const origin = 'https://representation.test';
  const principal = { userId: 'alice', sessionId: 'web-session', credentialId: 'web-cred', authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-phase61'] };
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-phase61'], allowedOrigins: [origin] });
  const webArgs = { ...args, taskId: 'representation-web' };
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'representation-web', idempotencyKey: 'representation-web', command: 'capability_invoke', repoId: 'repo-phase61', origin, args: { name: 'atlas-representation-producer', op: 'representation.produce', action: 'invoke', args: webArgs, budgetTokens: 32_000 } });
  assert.equal(webResult.status, 200, JSON.stringify(webResult.body)); assert.equal(webResult.body.result.payload[0].rung, 'R1');
  const webVerify = await web.execute({ principal, origin, csrfToken: 'csrf', transport: 'https' }, { schemaVersion: 1, commandId: 'representation-web-verify', idempotencyKey: 'representation-web-verify', command: 'capability_invoke', repoId: 'repo-phase61', origin, args: { name: 'atlas-representation-producer', op: 'representation.produce', action: 'reverify', claim: webResult.body.result, args: webArgs, budgetTokens: 32_000 } });
  assert.equal(webVerify.status, 200, JSON.stringify(webVerify.body)); assert.equal(webVerify.body.result.payload[0].ok, true);

  addTask('representation-mcp');
  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'bob', sessionId: 'mcp-session', capabilities: ['control'], repoIds: ['repo-phase61'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-phase61'], maxWaitMs: 1_000, maxMessageBytes: 1024 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase61', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpArgs = { ...args, taskId: 'representation-mcp' };
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-phase61', idempotencyKey: 'representation-mcp', name: 'atlas-representation-producer', op: 'representation.produce', action: 'invoke', args: mcpArgs, budgetTokens: 32_000 } } });
  assert.equal(mcpResult.result.isError, false, JSON.stringify(mcpResult)); assert.equal(mcpResult.result.structuredContent.payload[0].rung, 'R1');
  const mcpVerify = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-phase61', idempotencyKey: 'representation-mcp-verify', name: 'atlas-representation-producer', op: 'representation.produce', action: 'reverify', claim: mcpResult.result.structuredContent, args: mcpArgs, budgetTokens: 32_000 } } });
  assert.equal(mcpVerify.result.isError, false, JSON.stringify(mcpVerify)); assert.equal(mcpVerify.result.structuredContent.payload[0].ok, true);

  addTask('representation-reconcile'); const reconcileArgs = { ...args, taskId: 'representation-reconcile' }; const registry = driver.coordinator._capabilityRegistry();
  const persist = registry._persistIdempotency.bind(registry); let lostCompletion = false;
  registry._persistIdempotency = (binding, fields, options) => {
    if (!lostCompletion && binding.capability === 'atlas-representation-producer' && fields.state === 'completed') {
      lostCompletion = true; throw Object.assign(new Error('simulated outer ACI completion loss'), { code: 'capability_idempotency_unavailable' });
    }
    return persist(binding, fields, options);
  };
  const reconcileCtx = { ...invokeCtx, idempotencyKey: 'representation:outer-reconcile' };
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', reconcileArgs, reconcileCtx), (error) => error.code === 'capability_idempotency_unavailable');
  registry._persistIdempotency = persist;
  const productionCount = driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length;
  const sourceEntry = registry.entries.get('atlas-structural'); const currentSourceCard = sourceEntry.card;
  registry.entries.set('atlas-structural', { ...sourceEntry, card: Object.freeze({ ...currentSourceCard, simulatedCardChange: true }) });
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', reconcileArgs, reconcileCtx), (error) => error.code === 'representation_source_card_mismatch');
  registry.entries.set('atlas-structural', { ...sourceEntry, card: currentSourceCard });
  const reconciled = await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', reconcileArgs, reconcileCtx);
  assert.equal(reconciled.status, 'ok'); assert.equal(driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length, productionCount);
  driver.close();
});

test('GR1-GR6: real SCIP and bounded CPG producers preserve their exact R2/R3 source meaning', async () => {
  const repo = root('multi-repo'); execFileSync('git', ['init', '-q'], { cwd: repo });
  const indexRoot = root('multi-index-source'); mkdirSync(join(indexRoot, 'src'), { recursive: true });
  writeFileSync(join(indexRoot, 'src', 'index.mjs'), 'export function greet(name) { return name }\n');
  const index = new AtlasCodeIndex({ artifactRoot: root('multi-index-artifacts') });
  const built = await index.invoke('index.build', {}, { baseRoot: indexRoot, budgetTokens: 32_000 });
  const indexEpoch = built.provenance.index_epoch;
  const scipPreview = await index.invoke('scip.export', { indexEpoch }, { worktreeRoot: indexRoot, budgetTokens: 32_000 });
  const overlayDigest = scipPreview.provenance.overlay_digest;

  const beforeRoot = root('multi-cpg-before'); const afterRoot = root('multi-cpg-after');
  mkdirSync(join(beforeRoot, 'src'), { recursive: true }); mkdirSync(join(afterRoot, 'src'), { recursive: true });
  writeFileSync(join(beforeRoot, 'src', 'change.mjs'), 'export function value(x) { return x }\n');
  writeFileSync(join(afterRoot, 'src', 'change.mjs'), 'export function value(x) { const y = x + 1; return y }\n');
  const cpg = new AtlasCpgDelta({ artifactRoot: root('multi-cpg-artifacts'), maxSourceBytes: 64 * 1024, maxGraphBytes: 512 * 1024, maxDeltaBytes: 512 * 1024, maxImpactDepth: 8, maxReachDefPairs: 4096, maxScopes: 128, maxScopeDepth: 32, maxBindings: 512, maxBindingOccurrences: 4096 });
  const representationPolicy = { schemaVersion: 1, repoId: 'repo-phase61', maxArgumentBytes: 64 * 1024, maxSourceRefs: 8, maxSourceRefBytes: 16 * 1024, maxEvidenceRefs: 2, maxReceiptBytes: 64 * 1024, maxGraphBatchBytes: 256 * 1024, maxResultItems: 1, maxResultRefs: 1, maxResultBytes: 64 * 1024 };
  let environmentIndexEpoch = indexEpoch; let environmentOverlayDigest = overlayDigest;
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-phase61', logDir: root('multi-log'), adapters: {},
    capabilities: { 'atlas-index': index, 'atlas-cpg-delta': cpg },
    capabilityContexts: { 'atlas-index': { worktreeRoot: indexRoot }, 'atlas-cpg-delta': { beforeRoot, afterRoot } },
    representationProduction: {
      policy: representationPolicy, artifactRoot: root('multi-receipts'), authorize: async () => true,
      resolveEnvironment: async ({ producerKind }) => producerKind === 'symbol_snapshot'
        ? { schemaVersion: 1, kind: 'index_snapshot', repoId: 'repo-phase61', treeSha: 'e'.repeat(40), indexEpoch: environmentIndexEpoch, overlayDigest: environmentOverlayDigest }
        : { schemaVersion: 1, kind: 'tree_delta', repoId: 'repo-phase61', beforeTreeSha: 'a'.repeat(40), beforeOverlayDigest: 'b'.repeat(64), afterTreeSha: 'c'.repeat(40), afterOverlayDigest: 'd'.repeat(64) },
    },
    maxCapabilityBudgetTokens: 64_000, maxCapabilityEnvelopeBytes: 2 * 1024 * 1024,
  });
  const addTask = (taskId) => {
    driver.coordination.createTask({ id: taskId, deps: [], reservedWorkerId: `${taskId}-worker` }, { actor: 'orchestrator', key: `task:create:${taskId}` });
    driver.coordination.claimTask(taskId, `${taskId}-worker`, 1, { actor: 'orchestrator', key: `task:claim:${taskId}` });
  };
  const produce = async (taskId, producerKind, sourceArgs, idempotencyKey) => {
    addTask(taskId);
    const args = { taskId, producerKind, sourceArgs }; const callCtx = { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey, budgetTokens: 48_000 };
    const claim = await driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', args, callCtx);
    const checked = await driver.coordinator.reverifyCapability('atlas-representation-producer', 'representation.produce', claim, args, { ...callCtx, idempotencyKey: `${idempotencyKey}:verify` });
    assert.equal(checked.status, 'ok', JSON.stringify(checked)); return claim;
  };
  const scip = await produce('representation-scip', 'symbol_snapshot', { indexEpoch }, 'representation:scip');
  const cpgClaim = await produce('representation-cpg', 'cpg_semantic_delta', { beforePath: 'src/change.mjs', afterPath: 'src/change.mjs', impactDepth: 4 }, 'representation:cpg');
  assert.equal(scip.payload[0].rung, 'R2'); assert.equal(scip.payload[0].representationType, 'scip_symbol_snapshot');
  assert.equal(cpgClaim.payload[0].rung, 'R3'); assert.equal(cpgClaim.payload[0].representationType, 'bounded_cpg_semantic_delta');
  const scipDurable = driver.coordination.representationProduction(scip.payload[0].identityDigest); const cpgDurable = driver.coordination.representationProduction(cpgClaim.payload[0].identityDigest);
  assert.equal(scipDurable.source.artifact.kind, 'scip_json'); assert.equal(cpgDurable.source.artifact.kind, 'cpg_delta');
  assert.match(cpgDurable.node.body, /bounded binding-aware reachability/i);

  addTask('representation-scip-epoch-mismatch'); const indexInvokesBeforeEpoch = driver.log.read('hub-capability').filter((event) => event.payload?.capability === 'atlas-index' && event.payload?.action === 'invoke').length;
  environmentIndexEpoch = 'f'.repeat(64);
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { taskId: 'representation-scip-epoch-mismatch', producerKind: 'symbol_snapshot', sourceArgs: { indexEpoch } }, { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: 'representation:scip-epoch-mismatch', budgetTokens: 48_000 }), (error) => error.code === 'representation_environment_changed');
  assert.equal(driver.log.read('hub-capability').filter((event) => event.payload?.capability === 'atlas-index' && event.payload?.action === 'invoke').length, indexInvokesBeforeEpoch);
  environmentIndexEpoch = indexEpoch;

  addTask('representation-scip-overlay-mismatch'); const graphBeforeOverlay = driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length;
  environmentOverlayDigest = 'f'.repeat(64);
  await assert.rejects(driver.coordinator.invokeCapability('atlas-representation-producer', 'representation.produce', { taskId: 'representation-scip-overlay-mismatch', producerKind: 'symbol_snapshot', sourceArgs: { indexEpoch } }, { actor: 'orchestrator', repoId: 'repo-phase61', idempotencyKey: 'representation:scip-overlay-mismatch', budgetTokens: 48_000 }), (error) => error.code === 'representation_environment_changed');
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'knowledge.representation_produced').length, graphBeforeOverlay); environmentOverlayDigest = overlayDigest;

  const origin = 'https://representation-multi.test';
  const principal = { userId: 'multi-web', sessionId: 'multi-web-session', credentialId: 'multi-web-cred', authMethod: 'cookie', csrfToken: 'multi-csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-phase61'] };
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: ['repo-phase61'], allowedOrigins: [origin] });
  const cases = [
    ['scip', 'symbol_snapshot', { indexEpoch }, 'R2'],
    ['cpg', 'cpg_semantic_delta', { beforePath: 'src/change.mjs', afterPath: 'src/change.mjs', impactDepth: 4 }, 'R3'],
  ];
  for (const [label, producerKind, sourceArgs, rung] of cases) {
    const taskId = `representation-web-${label}`; addTask(taskId); const args = { taskId, producerKind, sourceArgs };
    const invoked = await web.execute({ principal, origin, csrfToken: 'multi-csrf', transport: 'https' }, { schemaVersion: 1, commandId: `representation-web-${label}`, idempotencyKey: `representation-web-${label}`, command: 'capability_invoke', repoId: 'repo-phase61', origin, args: { name: 'atlas-representation-producer', op: 'representation.produce', action: 'invoke', args, budgetTokens: 48_000 } });
    assert.equal(invoked.status, 200, JSON.stringify(invoked.body)); assert.equal(invoked.body.result.payload[0].rung, rung);
    const verified = await web.execute({ principal, origin, csrfToken: 'multi-csrf', transport: 'https' }, { schemaVersion: 1, commandId: `representation-web-${label}-verify`, idempotencyKey: `representation-web-${label}-verify`, command: 'capability_invoke', repoId: 'repo-phase61', origin, args: { name: 'atlas-representation-producer', op: 'representation.produce', action: 'reverify', claim: invoked.body.result, args, budgetTokens: 48_000 } });
    assert.equal(verified.status, 200, JSON.stringify(verified.body)); assert.equal(verified.body.result.payload[0].ok, true);
  }

  const mcp = new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal: { userId: 'multi-mcp', sessionId: 'multi-mcp-session', capabilities: ['control'], repoIds: ['repo-phase61'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-phase61'], maxWaitMs: 1_000, maxMessageBytes: 2 * 1024 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase61-multi', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let rpcId = 2;
  for (const [label, producerKind, sourceArgs, rung] of cases) {
    const taskId = `representation-mcp-${label}`; addTask(taskId); const args = { taskId, producerKind, sourceArgs };
    const invoked = await mcp.handle({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-phase61', idempotencyKey: `representation-mcp-${label}`, name: 'atlas-representation-producer', op: 'representation.produce', action: 'invoke', args, budgetTokens: 48_000 } } });
    assert.equal(invoked.result.isError, false, JSON.stringify(invoked)); assert.equal(invoked.result.structuredContent.payload[0].rung, rung);
    const verified = await mcp.handle({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: 'fleet_capability_invoke', arguments: { repoId: 'repo-phase61', idempotencyKey: `representation-mcp-${label}-verify`, name: 'atlas-representation-producer', op: 'representation.produce', action: 'reverify', claim: invoked.result.structuredContent, args, budgetTokens: 48_000 } } });
    assert.equal(verified.result.isError, false, JSON.stringify(verified)); assert.equal(verified.result.structuredContent.payload[0].ok, true);
  }
  driver.close();
});
