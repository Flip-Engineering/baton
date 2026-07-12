import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster, CoordinationStore, PublicSupplyChainOracle, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-reuse-invalidation-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
const response = (value) => { const raw = Buffer.from(JSON.stringify(value)); return { ok: true, status: 200, arrayBuffer: async () => raw }; };
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

async function fixture() {
  const repoRoot = root('repo'); const atlasRoot = root('atlas'); const artifactRoot = root('artifacts'); const oracleRoot = root('oracle'); const logDir = root('log');
  write(repoRoot, 'src/main.js', "import pkg from '@scope/safe-pkg'\nexport default pkg\n");
  write(repoRoot, 'package-lock.json', `${JSON.stringify({
    name: 'reuse-app', version: '1.0.0', lockfileVersion: 3,
    packages: { '': { name: 'reuse-app', version: '1.0.0', dependencies: { '@scope/safe-pkg': '1.2.3' } }, 'node_modules/@scope/safe-pkg': { version: '1.2.3', integrity: 'sha512-safe' } },
  })}\n`);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot }); execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
  let nowMs = Date.parse('2026-07-12T12:00:10Z'); let advisories = []; let fetchCalls = 0; let fetchHook = null;
  const now = () => nowMs;
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot }); const built = await atlas.invoke('index.build', {}, { baseRoot: repoRoot, budgetTokens: 10_000 });
  const deps = { versionKey: { system: 'NPM', name: '@scope/safe-pkg', version: '1.2.3' }, publishedAt: '2026-01-01T00:00:00Z', isDeprecated: false, licenses: ['MIT'], advisoryKeys: [], attestations: [{ verified: true, type: 'https://slsa.dev/provenance/v1' }], relatedProjects: [{ projectKey: { id: 'github.com/example/safe-pkg' }, relationType: 'SOURCE_REPO', relationProvenance: 'SLSA_ATTESTATION' }] };
  const project = { scorecard: { date: '2026-01-02T00:00:00Z', overallScore: 8.4, checks: [] } };
  const fetch = async (url) => { fetchCalls += 1; if (fetchHook) await fetchHook(url); return response(String(url).includes('/projects/') ? project : String(url).includes('api.osv.dev') ? { vulns: advisories } : { ...deps, advisoryKeys: advisories.map((item) => ({ id: item.id })) }); };
  const oracle = new PublicSupplyChainOracle({ fetch, artifactRoot: oracleRoot, timeoutMs: 1_000, maxResponseBytes: 64 * 1024, maxAdvisories: 32 });
  const capability = new CartographerQuartermaster({ atlas, artifactRoot, externalOracle: oracle, now, vetPolicy: { ttlMs: 60_000, licenseAllow: ['MIT'], licenseDeny: [], minScorecard: 7, requireProviderVerifiedProvenance: true, blockDeprecated: true }, sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 } });
  const driver = createDriver({ repoRoot, repoId: 'repo-a', logDir, adapters: {}, now,
    capabilityFactories: { 'cartographer-quartermaster': () => capability }, capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repoRoot } },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
    reuseDecisionPolicy: { authorize: ({ actor }) => /^operator:/.test(actor), authorizeRecheck: ({ actor }) => /^operator:/.test(actor), maxNeedBytes: 2_048, maxRationaleBytes: 8_192 },
  });
  const dossierArgs = { indexEpoch: built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const sbomArgs = { lockfilePath: 'package-lock.json' }; const ctx = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'reuse:first' };
  const dossierClaim = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, ctx);
  const sbomClaim = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'provenance.sbom', sbomArgs, ctx);
  const request = { need: 'safe package capability', choice: 'borrow', rationale: 'Use the exact policy-green candidate.', dossier: { claim: dossierClaim, args: dossierArgs }, sbom: { claim: sbomClaim, args: sbomArgs } };
  return { ...driver, repoRoot, logDir, request, ctx, advance: (ms) => { nowMs += ms; }, setNow: (ms) => { nowMs = ms; }, setAdvisories: (value) => { advisories = value; }, setFetchHook: (value) => { fetchHook = value; }, fetchCalls: () => fetchCalls };
}

test('RI5: expiry hides current Decisions exactly at TTL while preserving historical recall', async () => {
  const f = await fixture(); const recorded = await f.coordinator.decideReuse(f.request, f.ctx); const expiry = Date.parse(recorded.decision.dossierSnapshot.expiresAt);
  assert.equal(f.coordination.currentReuseDecision(recorded.decision.subjectDigest).id, recorded.decision.id);
  f.setNow(expiry);
  assert.equal(f.coordination.currentReuseDecision(recorded.decision.subjectDigest), null);
  assert.equal(f.coordination.queryKnowledge({ types: ['Decision'] }).length, 0);
  assert.equal(f.coordination.queryKnowledge({ types: ['Decision'], asOf: new Date(expiry - 1).toISOString() }).length, 1);
  assert.throws(() => f.coordination.queryKnowledge({ types: ['Decision'], asOf: 'not-a-time' }), (error) => error.code === 'invalid_query');
});

test('RI5/RI8: exact read retry returns its immutable historical snapshot after expiry', async () => {
  const f = await fixture(); const recorded = await f.coordinator.decideReuse(f.request, f.ctx);
  const query = { types: ['Decision'] }; const reader = { readerActor: 'operator:alice' }; const auth = { actor: 'operator:alice', key: 'read:historical-retry' };
  const first = f.coordination.readKnowledge(query, reader, auth);
  assert.equal(first.replayed, false); assert.equal(first.nodes.length, 1); assert.equal(first.nodes[0].id, recorded.decision.nodeId);
  f.setNow(Date.parse(recorded.decision.dossierSnapshot.expiresAt));
  assert.equal(f.coordination.queryKnowledge(query).length, 0);
  const replay = f.coordination.readKnowledge(query, reader, auth);
  assert.equal(replay.replayed, true); assert.match(replay.frame, /immutable historical replay/);
  assert.deepEqual(replay.nodes, first.nodes); assert.equal(replay.asOf, first.asOf); assert.equal(replay.nodes[0].validityVersion, 1);
  assert.throws(() => f.coordination.readKnowledge({ types: ['Finding'] }, reader, auth), (error) => error.code === 'knowledge_read_conflict');
});

test('RI7: generic prior invalidation cannot leak through current subject lookup', async () => {
  const f = await fixture(); const recorded = await f.coordinator.decideReuse(f.request, f.ctx);
  f.coordination.invalidateKnowledge(recorded.decision.nodeId, 1, 'external policy observation', { actor: 'policy', key: 'generic:invalidate' });
  assert.equal(f.coordination.currentReuseDecision(recorded.decision.subjectDigest), null);
  assert.equal(f.coordination.reuseSubjectHead(recorded.decision.subjectDigest).id, recorded.decision.id);
});

test('RI5-RI7: exact TTL recheck durably invalidates Decision and dossier Finding without deleting artifacts', async () => {
  const f = await fixture(); const recorded = await f.coordinator.decideReuse(f.request, f.ctx); const before = f.coordination.snapshot(); const fetchCalls = f.fetchCalls();
  f.coordination.readKnowledge({ types: ['Decision'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'ttl:read' });
  await assert.rejects(f.coordinator.recheckReuseDecision({ decisionId: recorded.decision.id, expectedValidityVersion: 1, trigger: 'ttl_expired', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'ttl:early' }), (error) => error.code === 'reuse_not_expired');
  f.setNow(Date.parse(recorded.decision.dossierSnapshot.expiresAt));
  const result = await f.coordinator.recheckReuseDecision({ decisionId: recorded.decision.id, expectedValidityVersion: 1, trigger: 'ttl_expired', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'ttl:expire' });
  assert.equal(result.result, 'invalidated'); const after = f.coordination.snapshot();
  const decision = after.knowledge.nodes.find((node) => node.id === recorded.decision.nodeId); const finding = after.knowledge.nodes.find((node) => node.id === `finding:dependency-dossier:${recorded.decision.dossierRef.digest}`);
  assert.equal(decision.validTo, recorded.decision.dossierSnapshot.expiresAt); assert.equal(decision.validityVersion, 2);
  assert.equal(finding.validTo, recorded.decision.dossierSnapshot.expiresAt); assert.deepEqual(after.artifacts, before.artifacts);
  assert.equal(after.knowledge.contamination.some((row) => row.nodeId === decision.id && row.affectedReadEvents.length === 1), true);
  assert.equal(f.coordination.reuseSubjectHead(recorded.decision.subjectDigest).id, recorded.decision.id); assert.equal(f.coordination.currentReuseDecision(recorded.decision.subjectDigest), null);
  assert.equal(f.fetchCalls(), fetchCalls, 'TTL path never calls the external oracle');
});

test('RI2-RI4: forced official adverse refresh fences coordinate and atomically invalidates every matching live subject', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  const second = await f.coordinator.decideReuse({ ...f.request, need: 'second safe capability', rationale: 'Use the same exact package for another need.' }, { ...f.ctx, idempotencyKey: 'reuse:second' });
  f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc', modified: '2026-07-12T12:00:11Z' }]); f.advance(1_000);
  const guarded = await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:refresh' });
  assert.equal(guarded.result, 'guarded'); assert.equal(guarded.targets.length, 2); assert.equal(guarded.guard.blocked, true);
  const snapshot = f.coordination.snapshot();
  assert.equal([first, second].every((row) => snapshot.knowledge.nodes.find((node) => node.id === row.decision.nodeId).validityVersion === 2), true);
  const riskFinding = snapshot.knowledge.nodes.find((node) => node.promotion?.trigger === 'reuse.risk');
  assert.equal(riskFinding.grounding, 'derived'); assert.equal(snapshot.knowledge.edges.filter((edge) => edge.type === 'Affects' && edge.from === riskFinding.id).length, 2);
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, need: 'stale green third need' }, { ...f.ctx, idempotencyKey: 'reuse:stale-after-risk' }), (error) => error.code === 'reuse_risk_guarded');
  const blockedBuild = await f.coordinator.decideReuse({ ...f.request, need: 'safe local replacement', choice: 'build', rationale: 'Build locally after the exact advisory.', dossier: { claim: guarded.dossier, args: { ...f.request.dossier.args, refresh: true } } }, { ...f.ctx, idempotencyKey: 'reuse:build-after-risk' });
  assert.equal(blockedBuild.decision.choice, 'build');
});

test('RI3/RI7: a later green refresh is checked but never clears the adverse fence or resurrects Decisions', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000);
  const guarded = await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:block' });
  const built = await f.coordinator.decideReuse({ ...f.request, need: 'local guarded replacement', choice: 'build', rationale: 'Build locally under the active guard.', dossier: { claim: guarded.dossier, args: { ...f.request.dossier.args, refresh: true } } }, { ...f.ctx, idempotencyKey: 'risk:build' });
  assert.equal(f.coordination.currentReuseDecision(built.decision.subjectDigest).id, built.decision.id, 'an exact guarded build remains current');
  f.setAdvisories([]); f.advance(1_000);
  const checked = await f.coordinator.recheckReuseDecision({ decisionId: built.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:green' });
  assert.equal(checked.result, 'checked'); assert.equal(checked.targets.length, 0);
  assert.equal(f.coordination.reuseRiskGuard(first.decision.coordinate).blocked, true);
  assert.equal(f.coordination.snapshot().knowledge.nodes.find((node) => node.id === first.decision.nodeId).validityVersion, 2);
  await assert.rejects(f.coordinator.decideReuse({ ...f.request, need: 'green cannot auto-clear', dossier: { claim: checked.dossier, args: { ...f.request.dossier.args, refresh: true } } }, { ...f.ctx, idempotencyKey: 'risk:borrow-after-green' }), (error) => error.code === 'reuse_risk_guarded');
});

test('RI4/RI8: an adverse refresh invalidates a same-subject replacement admitted while the oracle was in flight', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); f.advance(1_000);
  let release; let enteredResolve; let gateOnce = true;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  f.setFetchHook(async (url) => {
    if (gateOnce && String(url).includes('api.osv.dev')) { gateOnce = false; enteredResolve(); await gate; }
  });
  const guarding = f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:in-flight' });
  await entered;
  const replacement = await f.coordinator.decideReuse({ ...f.request, rationale: 'Replace the still-green immutable judgment.', supersedes: { decisionId: first.decision.id, expectedValidityVersion: 1 } }, { ...f.ctx, idempotencyKey: 'reuse:in-flight-replacement' });
  f.setAdvisories([{ id: 'GHSA-race-race-race', modified: '2026-07-12T12:00:11Z' }]); release();
  const result = await guarding;
  assert.equal(result.result, 'guarded'); assert.equal(result.targets.some((target) => target.decisionId === replacement.decision.id), true);
  const node = f.coordination.snapshot().knowledge.nodes.find((item) => item.id === replacement.decision.nodeId);
  assert.equal(node.validityVersion, 2); assert.equal(Date.parse(node.validTo) >= Date.parse(node.validFrom), true);
  assert.equal(f.coordination.currentReuseDecision(replacement.decision.subjectDigest), null);
});

test('RI8: exact advisory retry performs no fetch and same-key changed trigger conflicts before work', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000);
  const req = { decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 };
  await f.coordinator.recheckReuseDecision(req, { ...f.ctx, idempotencyKey: 'risk:retry' }); const calls = f.fetchCalls();
  const replay = await f.coordinator.recheckReuseDecision(req, { ...f.ctx, idempotencyKey: 'risk:retry' }); assert.equal(replay.result, 'idempotent'); assert.equal(f.fetchCalls(), calls);
  await assert.rejects(f.coordinator.recheckReuseDecision({ ...req, trigger: 'ttl_expired' }, { ...f.ctx, idempotencyKey: 'risk:retry' }), (error) => error.code === 'reuse_ttl_conflict');
});

test('RI3/RI8: a non-monotonic refresh cannot overwrite a newer active coordinate guard', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000);
  await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:monotonic:first' });
  const before = f.coordination.reuseRiskGuard(first.decision.coordinate);
  await assert.rejects(f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:monotonic:stale' }), (error) => error.code === 'reuse_risk_stale');
  assert.deepEqual(f.coordination.reuseRiskGuard(first.decision.coordinate), before);
});

test('RI3/RI4: repeated adverse same-fact refresh keeps an exact build graph-current', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000);
  const guarded = await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:same-fact:first' });
  const built = await f.coordinator.decideReuse({ ...f.request, need: 'same-fact local replacement', choice: 'build', rationale: 'Build locally under the exact adverse fact.', dossier: { claim: guarded.dossier, args: { ...f.request.dossier.args, refresh: true } } }, { ...f.ctx, idempotencyKey: 'risk:same-fact:build' });
  const before = f.coordination.snapshot(); const firstGuard = f.coordination.reuseRiskGuard(first.decision.coordinate); f.advance(1_000);
  const repeated = await f.coordinator.recheckReuseDecision({ decisionId: built.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:same-fact:second' });
  const secondGuard = f.coordination.reuseRiskGuard(first.decision.coordinate); const after = f.coordination.snapshot();
  assert.equal(repeated.result, 'guarded'); assert.equal(repeated.targets.length, 0);
  assert.equal(secondGuard.factDigest, firstGuard.factDigest); assert.notEqual(secondGuard.dossierDigest, firstGuard.dossierDigest);
  assert.equal(f.coordination.currentReuseDecision(built.decision.subjectDigest).id, built.decision.id);
  assert.equal(after.knowledge.nodes.find((node) => node.id === built.decision.nodeId).validTo, null);
  assert.equal(after.knowledge.nodes.filter((node) => node.type === 'Decision' && !node.validTo).some((node) => node.id === built.decision.nodeId), true);
  assert.equal(after.knowledge.contamination.length, before.knowledge.contamination.length);
});

test('RI8: a second exact decision key is durably aliased so later retry skips reverification', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  const secondCtx = { ...f.ctx, idempotencyKey: 'reuse:alias' };
  const aliased = await f.coordinator.decideReuse(f.request, secondCtx); assert.equal(aliased.decision.id, first.decision.id);
  assert.equal(aliased.event.kind, 'reuse.decision_request_bound'); const before = f.log.read('hub-capability').length;
  const retry = await f.coordinator.decideReuse(f.request, secondCtx); assert.equal(retry.decision.id, first.decision.id);
  assert.equal(f.log.read('hub-capability').length, before);
  const replay = new CoordinationStore(join(f.logDir, 'coordination'), { operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  assert.equal(replay.reuseDecisionAdmission('reuse:alias', aliased.event.payload.requestDigest).decision.id, first.decision.id);
});

test('RI9: replay reproduces risk fence/validity and rejects target tampering', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000);
  await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:replay' });
  const replay = new CoordinationStore(join(f.logDir, 'coordination'), { clock: () => new Date(Date.parse('2026-07-12T12:00:11Z')).toISOString(), operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  assert.deepEqual(replay.snapshot().reuseRiskGuards, f.coordination.snapshot().reuseRiskGuards);
  const path = join(f.logDir, 'coordination', 'events.jsonl'); const lines = readFileSync(path, 'utf8').trimEnd().split('\n'); const last = JSON.parse(lines.at(-1));
  last.payload.targets = []; lines[lines.length - 1] = JSON.stringify(last); writeFileSync(path, `${lines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(f.logDir, 'coordination'), { operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null }), (error) => error.code === 'reuse_risk_integrity');
});

test('RI9: replay binds the full refreshed dossier projection to authoritative operational evidence', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000);
  await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:projection-replay' });
  const path = join(f.logDir, 'coordination', 'events.jsonl'); const lines = readFileSync(path, 'utf8').trimEnd().split('\n'); const last = JSON.parse(lines.at(-1));
  last.payload.dossierSnapshot._tamperedProjection = true;
  const p = last.payload;
  p.guardDigest = hash({ requestDigest: p.requestDigest, seedDecisionId: p.seedDecisionId, seedExpectedValidityVersion: p.seedExpectedValidityVersion, coordinate: p.coordinate, dossierRef: p.dossierRef, dossierSnapshot: p.dossierSnapshot, advisoryIds: p.advisoryIds, maliciousAdvisoryIds: p.maliciousAdvisoryIds, reverifyEvidence: p.reverifyEvidence, adverse: p.adverse, effectiveAt: p.effectiveAt, targetSetDigest: p.targetSetDigest });
  lines[lines.length - 1] = JSON.stringify(last); writeFileSync(path, `${lines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(f.logDir, 'coordination'), { operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null }), (error) => error.code === 'reuse_evidence_invalid');
});

test('RI9: replay refuses a TTL event whose authoritative event time was corrupted', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx);
  f.setNow(Date.parse(first.decision.dossierSnapshot.expiresAt));
  await f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'ttl_expired', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'ttl:time-replay' });
  const path = join(f.logDir, 'coordination', 'events.jsonl'); const lines = readFileSync(path, 'utf8').trimEnd().split('\n'); const last = JSON.parse(lines.at(-1));
  last.ts = 'not-a-time'; lines[lines.length - 1] = JSON.stringify(last); writeFileSync(path, `${lines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(f.logDir, 'coordination'), { operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null }), (error) => error.code === 'reuse_not_expired');
});

test('RI9: replay binds risk CAS and TTL request identities instead of trusting recomputed event digests', async () => {
  const risk = await fixture(); const first = await risk.coordinator.decideReuse(risk.request, risk.ctx); risk.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); risk.advance(1_000);
  await risk.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...risk.ctx, idempotencyKey: 'risk:request-replay' });
  const riskPath = join(risk.logDir, 'coordination', 'events.jsonl'); const riskLines = readFileSync(riskPath, 'utf8').trimEnd().split('\n'); const riskEvent = JSON.parse(riskLines.at(-1)); const rp = riskEvent.payload;
  rp.seedExpectedValidityVersion = 2;
  rp.requestDigest = hash({ actor: riskEvent.actor, repoId: first.decision.envRef.repoId, decisionId: rp.seedDecisionId, expectedValidityVersion: 2, trigger: 'advisory_refresh' });
  rp.guardDigest = hash({ requestDigest: rp.requestDigest, seedDecisionId: rp.seedDecisionId, seedExpectedValidityVersion: rp.seedExpectedValidityVersion, coordinate: rp.coordinate, dossierRef: rp.dossierRef, dossierSnapshot: rp.dossierSnapshot, advisoryIds: rp.advisoryIds, maliciousAdvisoryIds: rp.maliciousAdvisoryIds, reverifyEvidence: rp.reverifyEvidence, adverse: rp.adverse, effectiveAt: rp.effectiveAt, targetSetDigest: rp.targetSetDigest });
  riskLines[riskLines.length - 1] = JSON.stringify(riskEvent); writeFileSync(riskPath, `${riskLines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(risk.logDir, 'coordination'), { operationalRead: (worker, seq) => risk.log.read(worker, seq).find((event) => event.seq === seq) ?? null }), (error) => ['stale_version', 'reuse_evidence_invalid'].includes(error.code));

  const ttl = await fixture(); const ttlDecision = await ttl.coordinator.decideReuse(ttl.request, ttl.ctx); ttl.setNow(Date.parse(ttlDecision.decision.dossierSnapshot.expiresAt));
  await ttl.coordinator.recheckReuseDecision({ decisionId: ttlDecision.decision.id, expectedValidityVersion: 1, trigger: 'ttl_expired', budgetTokens: 10_000 }, { ...ttl.ctx, idempotencyKey: 'ttl:request-replay' });
  const ttlPath = join(ttl.logDir, 'coordination', 'events.jsonl'); const ttlLines = readFileSync(ttlPath, 'utf8').trimEnd().split('\n'); const ttlEvent = JSON.parse(ttlLines.at(-1));
  ttlEvent.payload.requestDigest = '0'.repeat(64);
  const tp = ttlEvent.payload; tp.invalidationDigest = hash({ requestDigest: tp.requestDigest, decisionId: tp.decisionId, expectedValidityVersion: tp.expectedValidityVersion, effectiveAt: tp.effectiveAt, actor: tp.actor, repoId: tp.repoId, trigger: tp.trigger, target: tp.target });
  ttlLines[ttlLines.length - 1] = JSON.stringify(ttlEvent); writeFileSync(ttlPath, `${ttlLines.join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(ttl.logDir, 'coordination'), { operationalRead: (worker, seq) => ttl.log.read(worker, seq).find((event) => event.seq === seq) ?? null }), (error) => error.code === 'reuse_ttl_integrity');
});

test('RI1/RI9/RI12: forged inputs and final append failure expose no risk or validity projection', async () => {
  const f = await fixture(); const first = await f.coordinator.decideReuse(f.request, f.ctx); const calls = f.fetchCalls();
  await assert.rejects(f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000, advisoryIds: ['forged'] }, { ...f.ctx, idempotencyKey: 'risk:forged' }), (error) => error.code === 'invalid_reuse_recheck');
  await assert.rejects(f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 9_999 }, { ...f.ctx, idempotencyKey: 'risk:budget-mismatch' }), (error) => error.code === 'invalid_reuse_recheck');
  await assert.rejects(f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, actor: 'worker:w-1', idempotencyKey: 'risk:worker' }), (error) => error.code === 'reuse_recheck_forbidden');
  assert.equal(f.fetchCalls(), calls);
  f.setAdvisories([{ id: 'GHSA-aaaa-bbbb-cccc' }]); f.advance(1_000); const append = f.coordination._appendFile;
  f.coordination._appendFile = (...args) => {
    if (String(args[1]).includes('"kind":"knowledge.reuse_risk_guarded"')) throw new Error('risk disk unavailable');
    return append(...args);
  };
  await assert.rejects(f.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { ...f.ctx, idempotencyKey: 'risk:append-fail' }), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(f.coordination.reuseRiskGuard(first.decision.coordinate), null);
  assert.equal(f.coordination.snapshot().knowledge.nodes.find((node) => node.id === first.decision.nodeId).validTo, null);
});
