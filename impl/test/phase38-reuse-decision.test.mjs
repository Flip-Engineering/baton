import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster, CoordinationStore, McpFleetServer, PublicSupplyChainOracle, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-reuse-decision-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
const response = (value) => { const raw = Buffer.from(JSON.stringify(value)); return { ok: true, status: 200, arrayBuffer: async () => raw }; };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

async function fixture({ blocked = false } = {}) {
  const repoRoot = root('repo'); const atlasRoot = root('atlas'); const artifactRoot = root('artifacts'); const oracleRoot = root('oracle'); const logDir = root('log');
  write(repoRoot, 'src/main.js', "import pkg from '@scope/safe-pkg'\nexport default pkg\n");
  write(repoRoot, 'package-lock.json', `${JSON.stringify({
    name: 'reuse-app', version: '1.0.0', lockfileVersion: 3,
    packages: { '': { name: 'reuse-app', version: '1.0.0', dependencies: { '@scope/safe-pkg': '1.2.3' } }, 'node_modules/@scope/safe-pkg': { version: '1.2.3', integrity: 'sha512-safe' } },
  })}\n`);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot });
  const built = await atlas.invoke('index.build', {}, { baseRoot: repoRoot, budgetTokens: 10_000 });
  const deps = {
    versionKey: { system: 'NPM', name: '@scope/safe-pkg', version: '1.2.3' }, publishedAt: '2026-01-01T00:00:00Z', isDeprecated: false,
    licenses: ['MIT'], advisoryKeys: [], attestations: [{ verified: true, type: 'https://slsa.dev/provenance/v1' }],
    relatedProjects: [{ projectKey: { id: 'github.com/example/safe-pkg' }, relationType: 'SOURCE_REPO', relationProvenance: 'SLSA_ATTESTATION' }],
  };
  const osv = { vulns: blocked ? [{ id: 'GHSA-aaaa-bbbb-cccc', modified: '2026-07-01T00:00:00Z' }] : [] };
  const project = { scorecard: { date: '2026-01-02T00:00:00Z', overallScore: 8.4, checks: [] } };
  const fetch = async (url) => response(String(url).includes('/projects/') ? project : String(url).includes('api.osv.dev') ? osv : deps);
  const now = () => Date.parse('2026-07-12T12:00:10Z');
  const oracle = new PublicSupplyChainOracle({ fetch, artifactRoot: oracleRoot, timeoutMs: 1_000, maxResponseBytes: 64 * 1024, maxAdvisories: 32 });
  const capability = new CartographerQuartermaster({
    atlas, artifactRoot, externalOracle: oracle, now,
    vetPolicy: { ttlMs: 60_000, licenseAllow: ['MIT'], licenseDeny: [], minScorecard: 7, requireProviderVerifiedProvenance: true, blockDeprecated: true },
    sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 },
  });
  const driver = createDriver({
    repoRoot, repoId: 'repo-a', logDir, adapters: {}, now,
    capabilityFactories: { 'cartographer-quartermaster': () => capability },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repoRoot } },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
    reuseDecisionPolicy: { authorize: ({ actor }) => /^(?:operator|web|mcp):/.test(actor), maxNeedBytes: 2_048, maxRationaleBytes: 8_192 },
  });
  const dossierArgs = { indexEpoch: built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const sbomArgs = { lockfilePath: 'package-lock.json' };
  const ctx = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'reuse:first' };
  const dossierClaim = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, ctx);
  const sbomClaim = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'provenance.sbom', sbomArgs, ctx);
  const request = { need: 'safe package capability', choice: 'borrow', rationale: 'Use the exact policy-green candidate.', dossier: { claim: dossierClaim, args: dossierArgs }, sbom: { claim: sbomClaim, args: sbomArgs } };
  return { ...driver, repoRoot, logDir, request, ctx };
}

test('RD1-RD5: green evidence records immutable fleet artifacts, derived Findings, Decision, and Informed edges', async () => {
  const f = await fixture(); const result = await f.coordinator.decideReuse(f.request, f.ctx);
  assert.equal(result.result, 'recorded'); assert.equal(result.decision.choice, 'borrow');
  assert.deepEqual(result.decision.artifacts.map((artifact) => artifact.owner.kind), ['capability-evidence', 'capability-evidence', 'decision']);
  assert.equal(result.decision.artifacts[2].content.installAuthority, false); assert.equal(result.decision.artifacts[2].digest, hash(result.decision.artifacts[2].content));
  const snapshot = f.coordination.snapshot();
  assert.equal(snapshot.reuseDecisions.length, 1); assert.equal(snapshot.artifacts.length, 3);
  const decision = snapshot.knowledge.nodes.find((node) => node.id === result.decision.nodeId);
  assert.equal(decision.type, 'Decision'); assert.equal(decision.grounding, 'observed'); assert.equal(decision.informedBy.length, 2);
  assert.equal(decision.informedBy.every((id) => snapshot.knowledge.nodes.find((node) => node.id === id)?.grounding === 'derived'), true);
  assert.equal(snapshot.knowledge.edges.filter((edge) => edge.type === 'Informed' && edge.from === decision.id).length, 2);
  assert.equal(f.log.read('hub-capability').some((event) => event.kind === 'knowledge.reuse_evidence_reverified' && event.actor === f.ctx.actor), true);
});

test('RD2/RD4: blocked evidence can justify build but can never authorize borrow', async () => {
  const f = await fixture({ blocked: true }); const before = f.coordination.snapshot().reuseDecisions.length;
  await assert.rejects(f.coordinator.decideReuse(f.request, f.ctx), (error) => error.code === 'reuse_borrow_blocked');
  assert.equal(f.coordination.snapshot().reuseDecisions.length, before);
  const built = await f.coordinator.decideReuse({ ...f.request, choice: 'build', rationale: 'Build locally because the exact package is blocked.' }, { ...f.ctx, idempotencyKey: 'reuse:build' });
  assert.equal(built.decision.choice, 'build');
});

test('RD6-RD9: replay/idempotency/conflict/supersession preserve one live subject with contamination', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  const beforeRetry = f.log.read('hub-capability').length;
  const retry = await f.coordinator.decideReuse(f.request, f.ctx); assert.equal(retry.result, 'idempotent'); assert.equal(retry.decision.id, first.decision.id);
  assert.equal(f.log.read('hub-capability').length, beforeRetry, 'preflight retry performs no reverify or durable prelude');
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, rationale: 'Different bytes.' }, f.ctx), (error) => error.code === 'reuse_decision_conflict');
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, choice: 'build', rationale: 'Changed without supersession.' }, { ...f.ctx, idempotencyKey: 'reuse:no-supersede' }), (error) => error.code === 'reuse_decision_exists');
  f.coordination.readKnowledge({ types: ['Decision'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'reuse:read' });
  const second = await f.coordinator.decideReuse({ ...f.request, choice: 'build', rationale: 'Supersede after an explicit operator review.', supersedes: { decisionId: first.decision.id, expectedValidityVersion: 1 } }, { ...f.ctx, idempotencyKey: 'reuse:supersede' });
  const snapshot = f.coordination.snapshot(); const old = snapshot.knowledge.nodes.find((node) => node.id === first.decision.nodeId);
  assert.equal(old.validityVersion, 2); assert.ok(old.validTo); assert.equal(snapshot.knowledge.edges.some((edge) => edge.type === 'Supersedes' && edge.from === second.decision.nodeId && edge.to === old.id), true);
  assert.equal(snapshot.knowledge.contamination.some((row) => row.nodeId === old.id && row.affectedReadEvents.length === 1), true);
  const replay = new CoordinationStore(join(f.logDir, 'coordination'), { operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  assert.deepEqual(replay.snapshot().reuseDecisions, snapshot.reuseDecisions); assert.deepEqual(replay.snapshot().knowledge, snapshot.knowledge);
});

test('RD1/RD4: authority, actor injection, unsupported internal choice, and changed SBOM fail closed', async () => {
  const f = await fixture();
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, actor: 'operator:alice' }, f.ctx), (error) => error.code === 'invalid_reuse_decision');
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, choice: 'internal' }, f.ctx), (error) => error.code === 'invalid_reuse_decision');
  await assert.rejects(f.coordinator.decideReuse(f.request, { ...f.ctx, actor: 'worker:w-1' }), (error) => error.code === 'reuse_decision_forbidden');
  await assert.rejects(f.coordinator.decideReuse(f.request, { ...f.ctx, repoId: 'repo-b', idempotencyKey: 'reuse:repo-b' }), (error) => error.code === 'reuse_repo_mismatch');
  write(f.repoRoot, 'package-lock.json', `${JSON.stringify({ name: 'changed', lockfileVersion: 3, packages: {} })}\n`);
  await assert.rejects(f.coordinator.decideReuse(f.request, { ...f.ctx, idempotencyKey: 'reuse:changed' }), (error) => error.code === 'reuse_evidence_diverged');
  assert.equal(f.coordination.snapshot().reuseDecisions.length, 0);
});

test('RD3/RD4: ref-only claims work, but epoch splicing and bounded-text violations refuse', async () => {
  const f = await fixture();
  const refOnly = { ...f.request, dossier: { ...f.request.dossier, claim: { ...f.request.dossier.claim, status: 'partial', payload: [] } }, sbom: { ...f.request.sbom, claim: { ...f.request.sbom.claim, status: 'partial', payload: [] } } };
  const decided = await f.coordinator.decideReuse(refOnly, f.ctx); assert.equal(decided.decision.choice, 'borrow');
  const otherEpoch = 'f'.repeat(64);
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, dossier: { ...f.request.dossier, args: { ...f.request.dossier.args, indexEpoch: otherEpoch } } }, { ...f.ctx, idempotencyKey: 'reuse:splice' }), (error) => error.code === 'reuse_evidence_diverged');
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, need: 'bad\0need' }, { ...f.ctx, idempotencyKey: 'reuse:nul' }), (error) => error.code === 'invalid_reuse_decision');
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, rationale: 'x'.repeat(8_193) }, { ...f.ctx, idempotencyKey: 'reuse:oversize' }), (error) => error.code === 'invalid_reuse_decision');
});

test('RD5/RD11: decision append failure exposes no artifact, Decision, Finding, or allowlist projection', async () => {
  const f = await fixture(); const append = f.coordination._appendFile;
  f.coordination._appendFile = (...args) => {
    if (String(args[1]).includes('"kind":"knowledge.reuse_decided"')) throw new Error('decision disk unavailable');
    return append(...args);
  };
  await assert.rejects(f.coordinator.decideReuse(f.request, f.ctx), (error) => error.code === 'coordination_write_unavailable');
  const snapshot = f.coordination.snapshot();
  assert.equal(snapshot.reuseDecisions.length, 0); assert.equal(snapshot.artifacts.length, 0);
  assert.equal(snapshot.knowledge.nodes.some((node) => ['Decision', 'Finding'].includes(node.type)), false);
  assert.equal(snapshot.knowledge.edges.some((edge) => ['Informed', 'Supersedes'].includes(edge.type)), false);
});

test('RD5/RD12: replay validates immutable decision bytes instead of trusting the event kind', async () => {
  const f = await fixture(); await f.coordinator.decideReuse(f.request, f.ctx);
  const path = join(f.logDir, 'coordination', 'events.jsonl');
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n'); const last = JSON.parse(lines.at(-1));
  assert.equal(last.kind, 'knowledge.reuse_decided'); last.payload.dossierSnapshot.policy.blocked.push('forged'); lines[lines.length - 1] = JSON.stringify(last); writeFileSync(path, `${lines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(f.logDir, 'coordination'), { operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null }), (error) => error.code === 'reuse_decision_integrity');
});

test('RD3/RD4: dirty trees and reserved knowledge namespace squatting refuse before Decision projection', async () => {
  const dirty = await fixture(); write(dirty.repoRoot, 'README.untracked.md', 'dirty\n');
  await assert.rejects(dirty.coordinator.decideReuse(dirty.request, dirty.ctx), (error) => error.code === 'reuse_tree_dirty');
  assert.equal(dirty.coordination.snapshot().reuseDecisions.length, 0);

  const squat = await fixture(); const findingId = `finding:dependency-dossier:${squat.request.dossier.claim.refs[0].digest}`;
  squat.coordination.addKnowledgeNode({ id: findingId, type: 'Finding', grounding: 'derived', body: 'squat', evidence: [] }, { actor: 'test', key: 'squat:finding' });
  await assert.rejects(squat.coordinator.decideReuse(squat.request, squat.ctx), (error) => error.code === 'reuse_namespace_conflict');
  assert.equal(squat.coordination.snapshot().reuseDecisions.length, 0);

  const artifactSquat = await fixture(); const ref = artifactSquat.request.dossier.claim.refs[0]; const artifactId = `capability-evidence:${ref.digest}`;
  artifactSquat.coordination.createTask({ id: 'squat-task', deps: [], reservedWorkerId: 'squat-worker' }, { actor: 'test', key: 'squat:task' });
  artifactSquat.coordination.registerArtifact({ id: artifactId, taskId: 'squat-task', kind: ref.kind, mediaType: ref.mediaType, digest: ref.digest, refs: [{ kind: ref.kind, handle: ref.handle, digest: ref.digest, bytes: ref.bytes, mediaType: ref.mediaType }], accepted: false }, { actor: 'test', key: 'squat:artifact' });
  await assert.rejects(artifactSquat.coordinator.decideReuse(artifactSquat.request, artifactSquat.ctx), (error) => error.code === 'reuse_namespace_conflict');
  assert.equal(artifactSquat.coordination.snapshot().reuseDecisions.length, 0);
});

test('RD8: concurrent supersession CAS admits exactly one replacement', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  const replacement = (rationale) => ({ ...f.request, choice: 'build', rationale, supersedes: { decisionId: first.decision.id, expectedValidityVersion: 1 } });
  const outcomes = await Promise.allSettled([
    f.coordinator.decideReuse(replacement('First concurrent replacement.'), { ...f.ctx, idempotencyKey: 'reuse:race-a' }),
    f.coordinator.decideReuse(replacement('Second concurrent replacement.'), { ...f.ctx, idempotencyKey: 'reuse:race-b' }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason?.code === 'stale_version').length, 1);
  assert.equal(f.coordination.snapshot().reuseDecisions.length, 2);
});

test('RD8/RD12: externally invalidated current decision can be explicitly replaced without double invalidation', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  f.coordination.readKnowledge({ types: ['Decision'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'reuse:invalidate-read' });
  f.coordination.invalidateKnowledge(first.decision.nodeId, 1, 'new advisory observation', { actor: 'policy', key: 'reuse:invalidate' });
  const afterInvalidation = f.coordination.snapshot(); assert.equal(afterInvalidation.knowledge.contamination.length, 1);
  const replacement = await f.coordinator.decideReuse({ ...f.request, choice: 'build', rationale: 'Replace the invalid decision after new risk evidence.', supersedes: { decisionId: first.decision.id, expectedValidityVersion: 2 } }, { ...f.ctx, idempotencyKey: 'reuse:after-invalidation' });
  const snapshot = f.coordination.snapshot(); const old = snapshot.knowledge.nodes.find((node) => node.id === first.decision.nodeId);
  assert.equal(old.validityVersion, 2); assert.equal(snapshot.knowledge.contamination.length, 1, 'replacement does not re-invalidate or duplicate contamination');
  assert.equal(snapshot.knowledge.edges.some((edge) => edge.type === 'Supersedes' && edge.from === replacement.decision.nodeId && edge.to === old.id), true);
  assert.equal(f.coordination.currentReuseDecision(first.decision.subjectDigest).id, replacement.decision.id);
});

test('RD10: real authenticated web and MCP northbounds preserve authority into immutable decisions', async () => {
  const webFixture = await fixture(); const web = new WebNorthbound({ coordinator: webFixture.coordinator, coordination: webFixture.coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => Date.parse('2026-07-12T12:00:10Z') });
  const webPrincipal = { userId: 'alice', sessionId: 'web-session', credentialId: 'cred-a', authMethod: 'cookie', csrfToken: 'csrf-a', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] };
  const webResponse = await web.execute({ principal: webPrincipal, origin: 'https://control.example.test', csrfToken: 'csrf-a', remoteAddress: '127.0.0.1', transport: 'https' }, {
    schemaVersion: 1, commandId: 'real-web-reuse', idempotencyKey: 'real-web-reuse', command: 'reuse_decide', repoId: 'repo-a', origin: 'https://control.example.test', args: { ...webFixture.request, budgetTokens: 10_000 },
  });
  assert.equal(webResponse.status, 200); assert.equal(webResponse.body.result.decision.actor, 'web:alice:web-session');

  const mcpFixture = await fixture(); const mcp = new McpFleetServer({
    coordinator: mcpFixture.coordinator, coordination: mcpFixture.coordination,
    principal: { userId: 'bob', sessionId: 'mcp-session', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false },
    repoIds: ['repo-a'], now: () => Date.parse('2026-07-12T12:00:10Z'), maxWaitMs: 25_000, maxMessageBytes: 512 * 1024, takeToolQuota: async () => ({ ok: true }),
  });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase38', version: '1' } } });
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResponse = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_reuse_decide', arguments: { repoId: 'repo-a', idempotencyKey: 'real-mcp-reuse', ...mcpFixture.request, budgetTokens: 10_000 } } });
  assert.equal(mcpResponse.result.isError, false); assert.equal(mcpResponse.result.structuredContent.decision.actor, 'mcp:bob:mcp-session');
});
