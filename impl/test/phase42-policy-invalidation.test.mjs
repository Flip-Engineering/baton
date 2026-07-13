import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster, CoordinationStore, McpFleetServer, PublicSupplyChainOracle, WebNorthbound, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-policy-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
const response = (value) => { const raw = Buffer.from(JSON.stringify(value)); return { ok: true, headers: { get: () => null }, arrayBuffer: async () => raw }; };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const reconcileLimits = { maxDecisionTargets: 64, maxGuardTargets: 64, maxAffectedReads: 256, maxStateRows: 10_000, maxObservedPolicyHashes: 64, maxEventBytes: 512 * 1024 };
const policyA = { ttlMs: 60_000, licenseAllow: ['MIT'], licenseDeny: [], minScorecard: 7, requireProviderVerifiedProvenance: true, blockDeprecated: true };
const policyB = { ...policyA, minScorecard: 8 };
const policyC = { ...policyA, minScorecard: 9 };
const writerFiles = (directory) => existsSync(directory) ? readdirSync(directory).filter((name) => name === 'writer.lease' || name.startsWith('writer.claim.')) : [];

async function world() {
  const repoRoot = root('repo'); const logDir = root('log'); let nowMs = Date.parse('2026-07-12T15:00:00Z'); let advisories = []; let fetchCalls = 0;
  write(repoRoot, 'src/main.js', "import pkg from '@scope/safe-pkg'\nimport other from '@scope/other-pkg'\nexport default [pkg, other]\n");
  write(repoRoot, 'package-lock.json', `${JSON.stringify({ name: 'policy-app', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'policy-app', version: '1.0.0', dependencies: { '@scope/safe-pkg': '1.2.3', '@scope/other-pkg': '2.0.0' } }, 'node_modules/@scope/safe-pkg': { version: '1.2.3', integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` }, 'node_modules/@scope/other-pkg': { version: '2.0.0', integrity: `sha512-${Buffer.alloc(64, 2).toString('base64')}` } } })}\n`);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot }); execFileSync('git', ['add', '.'], { cwd: repoRoot }); execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'base'], { cwd: repoRoot });
  const now = () => nowMs;
  const deploy = async (vetPolicy, extra = {}) => {
    const atlas = new AtlasCodeIndex({ artifactRoot: root('atlas') }); const built = await atlas.invoke('index.build', {}, { baseRoot: repoRoot, budgetTokens: 10_000 });
    const fetch = async (url) => { fetchCalls += 1; const other = String(url).includes('other-pkg'); return response(String(url).includes('/projects/') ? { scorecard: { date: '2026-01-02T00:00:00Z', overallScore: 8.4, checks: [] } } : String(url).includes('api.osv.dev') ? { vulns: advisories } : { versionKey: { system: 'NPM', name: other ? '@scope/other-pkg' : '@scope/safe-pkg', version: other ? '2.0.0' : '1.2.3' }, publishedAt: '2026-01-01T00:00:00Z', isDeprecated: false, licenses: ['MIT'], advisoryKeys: advisories.map((item) => ({ id: item.id })), attestations: [{ verified: true }], relatedProjects: [{ projectKey: { id: other ? 'github.com/example/other-pkg' : 'github.com/example/safe-pkg' }, relationType: 'SOURCE_REPO' }] }); };
    const oracle = new PublicSupplyChainOracle({ fetch, artifactRoot: root('oracle'), timeoutMs: 1_000, maxResponseBytes: 64 * 1024, maxAdvisories: 32 });
    const capability = new CartographerQuartermaster({ atlas, artifactRoot: root('quartermaster'), externalOracle: oracle, now, vetPolicy, sbomPolicy: { maxLockfileBytes: 64 * 1024, maxComponents: 32 } });
    if (extra.cardTransform) { const baseCard = capability.card(); capability.card = () => extra.cardTransform(baseCard); }
    const driver = createDriver({ repoRoot, repoId: 'repo-a', logDir, adapters: {}, now, coordination: extra.coordination,
      capabilityFactories: { 'cartographer-quartermaster': () => capability }, capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: repoRoot } }, maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
      reuseDecisionPolicy: { authorize: ({ actor }) => /^(?:operator|web|mcp):/.test(actor), authorizeRecheck: ({ actor }) => /^(?:operator|web|mcp):/.test(actor), maxNeedBytes: 2_048, maxRationaleBytes: 8_192, policyReconcile: extra.limits ?? reconcileLimits },
    });
    return { ...driver, capability, indexEpoch: built.provenance.index_epoch, policy: capability.card().reusePolicy };
  };
  const requestFor = async (deployment, actor = 'operator:alice', overrides = {}) => {
    const ctx = { actor, repoId: 'repo-a', budgetTokens: 10_000 };
    const dossierArgs = { indexEpoch: deployment.indexEpoch, ecosystem: 'npm', package: overrides.package ?? '@scope/safe-pkg', version: overrides.version ?? '1.2.3', ...(overrides.refresh ? { refresh: true } : {}) };
    const sbomArgs = { lockfilePath: 'package-lock.json' };
    const dossierClaim = overrides.dossier ?? await deployment.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', dossierArgs, ctx);
    const sbomClaim = await deployment.coordinator.invokeCapability('cartographer-quartermaster', 'provenance.sbom', sbomArgs, ctx);
    const request = { need: overrides.need ?? 'safe package capability', choice: overrides.choice ?? 'borrow', rationale: overrides.rationale ?? 'Use the exact policy-green candidate.', dossier: { claim: dossierClaim, args: dossierArgs }, sbom: { claim: sbomClaim, args: sbomArgs } };
    return request;
  };
  const decide = async (deployment, key = 'reuse:first', overrides = {}) => {
    const ctx = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: key };
    const request = await requestFor(deployment, ctx.actor, overrides);
    const result = await deployment.coordinator.decideReuse(request, ctx);
    return Object.freeze({ ...result, request, requestCtx: ctx });
  };
  return { repoRoot, logDir, now, deploy, decide, requestFor, advance: (ms) => { nowMs += ms; }, setAdvisories: (value) => { advisories = value; }, fetchCalls: () => fetchCalls };
}

test('PI1/PI2/PI7: card-derived baseline is durable, same-policy restart is a no-op, and A→B→A advances monotonically', async () => {
  const w = await world(); const a = await w.deploy(policyA); const first = a.coordination.reusePolicyState('repo-a');
  assert.equal(first.version, 1); assert.equal(first.policyHash, a.policy.hash); assert.equal(hash(a.policy.projection), a.policy.hash); assert.equal(a.coordinator.capabilityCards()[0].reusePolicy.hash, a.policy.hash);
  const before = a.coordination.snapshot().lastSeq; a.close(); const same = await w.deploy(policyA); assert.equal(same.coordination.snapshot().lastSeq, before); same.close();
  w.advance(1_000); const b = await w.deploy(policyB); assert.equal(b.coordination.reusePolicyState('repo-a').version, 2); b.close();
  w.advance(1_000); const again = await w.deploy(policyA); assert.equal(again.coordination.reusePolicyState('repo-a').version, 3); assert.equal(again.coordination.reusePolicyState('repo-a').policyHash, a.policy.hash); again.close();
});

test('PI2/PI3/PI5/PI6: changed policy atomically closes every live Decision and dossier Finding with exact contamination and causal edges', async () => {
  const w = await world(); const a = await w.deploy(policyA); const one = await w.decide(a, 'reuse:one'); const two = await w.decide(a, 'reuse:two', { need: 'second package need' }); const artifacts = a.coordination.snapshot().artifacts;
  a.coordination.readKnowledge({ types: ['Decision'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'policy:decision-read' });
  a.coordination.readKnowledge({ types: ['Finding'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'policy:finding-read' });
  a.coordination.readKnowledge({ types: ['Constraint'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'policy:constraint-read' });
  a.close(); const calls = w.fetchCalls(); w.advance(1_000); const b = await w.deploy(policyB); assert.equal(w.fetchCalls(), calls, 'startup policy reconciliation is zero-network');
  for (const row of [one, two]) { assert.equal(b.coordination.currentReuseDecision(row.decision.subjectDigest), null); const node = b.coordination.snapshot().knowledge.nodes.find((item) => item.id === row.decision.nodeId); assert.equal(node.validityVersion, 2); assert.ok(node.validTo); }
  const snapshot = b.coordination.snapshot(); assert.deepEqual(snapshot.artifacts, artifacts); assert.ok(snapshot.knowledge.nodes.some((node) => node.type === 'Constraint' && node.promotion?.trigger === 'reuse.policy'));
  assert.equal(snapshot.knowledge.edges.filter((edge) => edge.type === 'Affects' && edge.from.startsWith('constraint:reuse-policy:') && edge.to.startsWith('decision:reuse:')).length, 2);
  assert.equal(snapshot.knowledge.edges.filter((edge) => edge.type === 'Affects' && edge.from.startsWith('constraint:reuse-policy:') && edge.to.startsWith('finding:dependency-dossier:')).length, 1);
  assert.ok(snapshot.knowledge.edges.some((edge) => edge.type === 'Supersedes' && edge.from === snapshot.reusePolicy.heads[0].constraintId && edge.to === snapshot.reusePolicy.transitions.at(-1).priorConstraintTarget.nodeId));
  assert.deepEqual(snapshot.knowledge.contamination.find((row) => row.nodeId === snapshot.reusePolicy.transitions.at(-1).priorConstraintTarget.nodeId)?.affectedReadEvents.length, 1);
  assert.equal(snapshot.knowledge.contamination.filter((row) => [one.decision.nodeId, two.decision.nodeId].includes(row.nodeId)).every((row) => row.affectedReadEvents.length === 1), true);
  assert.equal(snapshot.reusePolicy.transitions.at(-1).decisionTargets.length, 2);
  assert.equal(b.coordination.queryKnowledge({ types: ['Decision', 'Finding'] }).some((node) => node.repoId === 'repo-a' && node.policyHash === a.policy.hash), false, 'old-policy causal rows are not currently recallable');
  const oldEvent = b.coordination.events().find((event) => event.kind === 'knowledge.reuse_decided');
  assert.throws(() => b.coordination._validateReuseDecisionPayload(oldEvent.payload, { seq: snapshot.lastSeq + 1, ts: new Date(Date.parse(oldEvent.ts) + 5_000).toISOString(), actor: oldEvent.actor }, false), (error) => error.code === 'reuse_policy_reconciliation_required');
  const beforeRetry = w.fetchCalls(); const historical = await b.coordinator.decideReuse(one.request, one.requestCtx);
  assert.equal(historical.result, 'historical'); assert.equal(historical.current, false); assert.equal(historical.historical, true); assert.equal(historical.decision.id, one.decision.id); assert.equal(w.fetchCalls(), beforeRetry, 'exact historical retry is zero-network'); b.close();
});

test('PI4/PI5: old adverse guard becomes policy-stale but blocking; current-policy green refresh permits build, never borrow', async () => {
  const w = await world(); const a = await w.deploy(policyA); const borrowed = await w.decide(a); w.setAdvisories([{ id: 'GHSA-policy-change', modified: '2026-07-12T15:00:01Z' }]); w.advance(1_000);
  const riskRequest = { decisionId: borrowed.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }; const riskCtx = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'risk:a' };
  const guarded = await a.coordinator.recheckReuseDecision(riskRequest, riskCtx);
  const immediate = await a.coordinator.recheckReuseDecision(riskRequest, riskCtx); assert.equal(immediate.current, true); assert.equal(immediate.historical, false); assert.equal(immediate.guard.guardDigest, guarded.guard.guardDigest);
  const builtA = await w.decide(a, 'reuse:build-a', { need: 'guarded build', choice: 'build', rationale: 'Build under the adverse guard.', refresh: true, dossier: guarded.dossier }); a.close();
  w.advance(1_000); const firstB = await w.deploy(policyB); const stale = firstB.coordination.reuseRiskGuard(builtA.decision.coordinate); assert.equal(stale.blocked, true); assert.equal(stale.policyStale, true); assert.equal(stale.requiredPolicyHash, firstB.policy.hash);
  const historical = await firstB.coordinator.recheckReuseDecision(riskRequest, riskCtx); assert.equal(historical.current, false); assert.equal(historical.historical, true); assert.equal(historical.guard.guardDigest, guarded.guard.guardDigest);
  firstB.close(); w.advance(1_000); const cycledA = await w.deploy(policyA); const cycled = cycledA.coordination.reuseRiskGuard(builtA.decision.coordinate); assert.equal(cycled.policyStale, true); assert.equal(cycled.requiredPolicyHash, cycledA.policy.hash); assert.equal(cycled.inheritedFromGuardDigest, guarded.guard.guardDigest); cycledA.close();
  w.advance(1_000); const b = await w.deploy(policyB); w.setAdvisories([]); w.advance(1_000); const checked = await b.coordinator.recheckReuseDecision({ decisionId: builtA.decision.id, expectedValidityVersion: 2, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'risk:b-green' });
  assert.equal(checked.guard.blocked, true); assert.equal(checked.guard.policyStale, false); assert.equal(checked.guard.inheritedAdverse, true); assert.equal(checked.guard.policyHash, b.policy.hash);
  assert.equal(checked.guard.inheritedFromGuardDigest, guarded.guard.guardDigest); assert.deepEqual(checked.guard.inheritedAdvisoryIds, ['GHSA-policy-change']);
  assert.ok(b.coordination.snapshot().knowledge.edges.some((edge) => edge.type === 'DerivedFrom' && edge.from === `finding:reuse-risk:${checked.guard.guardDigest}` && edge.to === `finding:reuse-risk:${guarded.guard.guardDigest}`));
  const buildB = await w.decide(b, 'reuse:build-b', { need: 'current policy guarded build', choice: 'build', rationale: 'Build with current-policy evidence.', refresh: true, dossier: checked.dossier }); assert.equal(buildB.decision.choice, 'build');
  await assert.rejects(w.decide(b, 'reuse:borrow-b', { need: 'cannot clear by policy', refresh: true, dossier: checked.dossier }), (error) => error.code === 'reuse_risk_guarded'); b.close();
});

test('PI4/PI7: green review without an adverse predecessor retries as guard-null current then historical', async () => {
  const w = await world(); const a = await w.deploy(policyA); const decision = await w.decide(a, 'green-only:decision'); w.advance(1_000);
  const request = { decisionId: decision.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }; const ctx = { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'green-only:risk' };
  const checked = await a.coordinator.recheckReuseDecision(request, ctx); assert.equal(checked.result, 'checked'); assert.equal(checked.guard, null);
  const immediate = await a.coordinator.recheckReuseDecision(request, ctx); assert.equal(immediate.current, true); assert.equal(immediate.historical, false); assert.equal(immediate.guard, null); a.close(); w.advance(1_000);
  const b = await w.deploy(policyB); const historical = await b.coordinator.recheckReuseDecision(request, ctx); assert.equal(historical.current, false); assert.equal(historical.historical, true); assert.equal(historical.guard, null); b.close();
});

test('PI4/PI6: fresh current-policy adverse evidence supersedes the stale guard with causal lineage', async () => {
  const w = await world(); const a = await w.deploy(policyA); const borrowed = await w.decide(a, 'adverse-lineage:borrow'); w.setAdvisories([{ id: 'GHSA-old-policy', modified: '2026-07-12T15:00:01Z' }]); w.advance(1_000);
  const old = await a.coordinator.recheckReuseDecision({ decisionId: borrowed.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'adverse-lineage:a' });
  const built = await w.decide(a, 'adverse-lineage:build', { choice: 'build', need: 'lineage build', rationale: 'Retain a build path under the adverse fence.', refresh: true, dossier: old.dossier }); a.close(); w.advance(1_000);
  const b = await w.deploy(policyB); w.setAdvisories([{ id: 'GHSA-current-policy', modified: '2026-07-12T15:00:03Z' }]); w.advance(1_000);
  const current = await b.coordinator.recheckReuseDecision({ decisionId: built.decision.id, expectedValidityVersion: 2, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'adverse-lineage:b' });
  assert.equal(current.guard.supersedesGuardDigest, old.guard.guardDigest); assert.equal(current.guard.inheritedAdverse, false);
  assert.ok(b.coordination.snapshot().knowledge.edges.some((edge) => edge.type === 'Supersedes' && edge.from === `finding:reuse-risk:${current.guard.guardDigest}` && edge.to === `finding:reuse-risk:${old.guard.guardDigest}`)); b.close();
});

test('PI2/PI8: exclusive policy writer ownership refuses overlapping drivers and append failure exposes no partial policy projection', async () => {
  const w = await world(); const a = await w.deploy(policyA); await assert.rejects(w.deploy(policyB), (error) => error.code === 'coordination_writer_busy');
  await assert.rejects(w.deploy(policyB, { coordination: a.coordination }), (error) => error.code === 'coordination_writer_busy');
  const leasePath = join(w.logDir, 'coordination', 'writer.lease'); const ownedLease = readFileSync(leasePath, 'utf8'); writeFileSync(leasePath, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'replacement', acquiredAt: new Date().toISOString() })}\n`);
  assert.throws(() => a.coordination.recordDriver('lost', {}, { actor: 'operator:alice', key: 'lost:writer' }), (error) => error.code === 'coordination_writer_lost'); writeFileSync(leasePath, ownedLease);
  writeFileSync(leasePath, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'replacement', acquiredAt: new Date().toISOString() })}\n`); assert.throws(() => a.coordination.activateReusePolicy({ repoId: 'repo-a', policy: a.policy, policyCardDigest: hash(a.policy), ceilings: reconcileLimits }, { actor: 'policy:deployment', key: 'lost:same-policy' }), (error) => error.code === 'coordination_writer_lost'); writeFileSync(leasePath, ownedLease);
  const before = a.coordination.snapshot(); const beforeCalls = w.fetchCalls(); a.close(); await assert.rejects(w.decide(a, 'reuse:after-close'), (error) => error.code === 'coordinator_closed'); assert.equal(w.fetchCalls(), beforeCalls);
  const append = a.coordination._appendFile; a.coordination._appendFile = (...args) => { if (String(args[1]).includes('knowledge.reuse_policy_reconciled')) throw new Error('policy disk unavailable'); return append(...args); };
  await assert.rejects(w.deploy(policyB, { coordination: a.coordination }), /policy disk unavailable|coordination/); const after = a.coordination.snapshot(); assert.deepEqual(after.reusePolicy, before.reusePolicy); assert.deepEqual(after.knowledge, before.knowledge); a.coordination._appendFile = append;
});

test('PI2/PI7/PI8: stale stores reload under lease and a squatted activation key cannot expose authority', async () => {
  const w = await world(); const stale = new CoordinationStore(join(w.logDir, 'coordination')); const a = await w.deploy(policyA); a.close(); w.advance(1_000);
  const b = await w.deploy(policyB, { coordination: stale }); assert.equal(b.coordination.reusePolicyState('repo-a').version, 2); b.close();
  const other = await world(); const squatted = new CoordinationStore(join(other.logDir, 'coordination')); const policyHash = hash(policyA);
  squatted.recordDriver('squat', {}, { actor: 'operator:mallory', key: `reuse-policy:repo-a:0:${policyHash}` });
  squatted.releaseWriterLease();
  await assert.rejects(other.deploy(policyA, { coordination: squatted }), (error) => error.code === 'reuse_policy_conflict'); assert.equal(squatted.reusePolicyState('repo-a'), null); assert.equal(squatted.snapshot().lastSeq, 1);
  const dead = await world(); mkdirSync(join(dead.logDir, 'coordination'), { recursive: true }); writeFileSync(join(dead.logDir, 'coordination', 'writer.lease'), `${JSON.stringify({ schemaVersion: 1, pid: 2_147_483_647, token: 'dead-owner', acquiredAt: '2026-07-12T00:00:00.000Z' })}\n`);
  const recovered = await dead.deploy(policyA); assert.equal(recovered.coordination.reusePolicyState('repo-a').version, 1); recovered.close();
  const deadClaim = await world(); const deadClaimRoot = join(deadClaim.logDir, 'coordination'); mkdirSync(deadClaimRoot, { recursive: true }); writeFileSync(join(deadClaimRoot, 'writer.claim.dead-claim'), `${JSON.stringify({ schemaVersion: 1, pid: 2_147_483_647, token: 'dead-claim', acquiredAt: '2026-07-12T00:00:00.000Z' })}\n`);
  const claimRecovered = await deadClaim.deploy(policyA); assert.equal(readdirSync(deadClaimRoot).some((name) => name.startsWith('writer.claim.')), false); claimRecovered.close();
  const blocked = await world(); const blockedRoot = join(blocked.logDir, 'coordination'); mkdirSync(blockedRoot, { recursive: true }); const liveClaim = join(blockedRoot, 'writer.claim.live-claim'); writeFileSync(liveClaim, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'live-claim', acquiredAt: '2026-07-12T00:00:00.000Z' })}\n`); await assert.rejects(blocked.deploy(policyA), (error) => error.code === 'coordination_writer_busy'); unlinkSync(liveClaim);
  const malformedClaim = join(blockedRoot, 'writer.claim.malformed'); writeFileSync(malformedClaim, '{'); await assert.rejects(blocked.deploy(policyA), (error) => error.code === 'coordination_writer_busy'); unlinkSync(malformedClaim);
});

test('PI1/PI8/PI10: forged cards and max+1 deployment ceilings fail closed before policy state changes', async () => {
  const w = await world();
  await assert.rejects(w.deploy(policyA, { cardTransform: (card) => ({ ...card, reusePolicy: { ...card.reusePolicy, hash: '0'.repeat(64) } }) }), /valid Quartermaster policy card/);
  await assert.rejects(w.deploy(policyA, { cardTransform: (card) => { const projection = canonical(policyB); return { ...card, reusePolicy: { ...card.reusePolicy, projection, hash: hash(projection) } }; } }), /disagrees with its immutable runtime policy/);
  await assert.rejects(w.deploy(policyA, { cardTransform: (card) => { const { reusePolicy, ...withoutPolicy } = card; return withoutPolicy; } }), /valid Quartermaster policy card/);
  assert.deepEqual(writerFiles(join(w.logDir, 'coordination')), [], 'card refusal cannot strand writer authority');
  const a = await w.deploy(policyA); const one = await w.decide(a, 'reuse:ceiling-one'); await w.decide(a, 'reuse:ceiling-two', { need: 'second ceiling target' });
  a.coordination.readKnowledge({ types: ['Decision'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'policy:ceiling-read-1' });
  a.coordination.readKnowledge({ types: ['Decision'] }, { readerActor: 'operator:alice' }, { actor: 'operator:alice', key: 'policy:ceiling-read-2' });
  const before = a.coordination.snapshot(); a.close();
  for (const limits of [
    { ...reconcileLimits, maxDecisionTargets: 1 },
    { ...reconcileLimits, maxAffectedReads: 3 },
    { ...reconcileLimits, maxStateRows: 1 },
    { ...reconcileLimits, maxEventBytes: 128 },
  ]) {
    await assert.rejects(w.deploy(policyB, { coordination: a.coordination, limits }), (error) => error.code === 'reuse_policy_oversize');
    assert.deepEqual(a.coordination.snapshot().reusePolicy, before.reusePolicy); assert.equal(a.coordination.currentReuseDecision(one.decision.subjectDigest)?.id, one.decision.id);
    assert.deepEqual(writerFiles(join(w.logDir, 'coordination')), [], 'failed reconciliation releases lease and claim authority');
  }
});

test('PI3/PI10: maxObservedPolicyHashes+1 refuses a mixed legacy guard set before append', async () => {
  const w = await world(); const a = await w.deploy(policyA); const first = await w.decide(a, 'hash-ceiling:a');
  w.setAdvisories([{ id: 'GHSA-hash-a', modified: '2026-07-12T15:00:01Z' }]); w.advance(1_000);
  await a.coordinator.recheckReuseDecision({ decisionId: first.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'hash-ceiling:risk-a' });
  a.close(); w.advance(1_000); const b = await w.deploy(policyB, { coordination: a.coordination }); w.setAdvisories([]); w.advance(1_000);
  const second = await w.decide(b, 'hash-ceiling:b', { package: '@scope/other-pkg', version: '2.0.0', need: 'second policy hash guard' });
  w.setAdvisories([{ id: 'GHSA-hash-b', modified: '2026-07-12T15:00:03Z' }]); w.advance(1_000);
  await b.coordinator.recheckReuseDecision({ decisionId: second.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'hash-ceiling:risk-b' });
  const before = b.coordination.snapshot(); b.close();
  await assert.rejects(w.deploy(policyC, { coordination: b.coordination, limits: { ...reconcileLimits, maxObservedPolicyHashes: 1 } }), (error) => error.code === 'reuse_policy_oversize');
  assert.deepEqual(b.coordination.snapshot().reusePolicy, before.reusePolicy); assert.deepEqual(b.coordination.snapshot().reuseRiskGuards, before.reuseRiskGuards);
  assert.deepEqual(writerFiles(join(w.logDir, 'coordination')), []);
});

test('PI3/PI10: maxGuardTargets+1 refuses before append and preserves both adverse fences', async () => {
  const w = await world(); const a = await w.deploy(policyA); const one = await w.decide(a, 'reuse:guard-one'); const two = await w.decide(a, 'reuse:guard-two', { package: '@scope/other-pkg', version: '2.0.0', need: 'other guarded coordinate' });
  w.setAdvisories([{ id: 'GHSA-two-guards', modified: '2026-07-12T15:00:01Z' }]); w.advance(1_000);
  await a.coordinator.recheckReuseDecision({ decisionId: one.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'risk:guard-one' });
  w.advance(1_000); await a.coordinator.recheckReuseDecision({ decisionId: two.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'risk:guard-two' });
  const before = a.coordination.snapshot(); a.close();
  await assert.rejects(w.deploy(policyB, { coordination: a.coordination, limits: { ...reconcileLimits, maxGuardTargets: 1 } }), (error) => error.code === 'reuse_policy_oversize');
  assert.deepEqual(a.coordination.snapshot().reuseRiskGuards, before.reuseRiskGuards); assert.deepEqual(a.coordination.snapshot().reusePolicy, before.reusePolicy);
});

test('PI9/PI10: maxEventBytes accounts for the exact persisted JSONL envelope', async () => {
  const measured = await world(); const baseline = await measured.deploy(policyA, { limits: { ...reconcileLimits, maxEventBytes: 9_999 } }); baseline.close(); const bytes = readFileSync(join(measured.logDir, 'coordination', 'events.jsonl')).length;
  const exact = await world(); const accepted = await exact.deploy(policyA, { limits: { ...reconcileLimits, maxEventBytes: bytes } }); assert.equal(readFileSync(join(exact.logDir, 'coordination', 'events.jsonl')).length, bytes); accepted.close();
  const tooSmall = await world(); await assert.rejects(tooSmall.deploy(policyA, { limits: { ...reconcileLimits, maxEventBytes: bytes - 1 } }), (error) => error.code === 'reuse_policy_oversize');
  const empty = new CoordinationStore(join(tooSmall.logDir, 'coordination')); assert.equal(empty.snapshot().lastSeq, 0);
});

test('PI2/PI3/PI7: first baseline reconciles genuine pre-policy-head Decisions, guards, and legacy hashes', async () => {
  const matching = await world(); const oldA = await matching.deploy(policyA); oldA.coordination._resetProjection(); writeFileSync(join(matching.logDir, 'coordination', 'events.jsonl'), '');
  const currentDecision = await matching.decide(oldA, 'legacy:matching'); oldA.close(); const same = await matching.deploy(policyA, { coordination: oldA.coordination });
  assert.equal(same.coordination.reusePolicyState('repo-a').version, 1); assert.equal(same.coordination.currentReuseDecision(currentDecision.decision.subjectDigest)?.id, currentDecision.decision.id); assert.deepEqual(same.coordination.snapshot().reusePolicy.transitions[0].observedPolicyHashes, [same.policy.hash]);
  assert.ok(same.coordination.snapshot().knowledge.edges.some((edge) => edge.type === 'Informed' && edge.from === currentDecision.decision.nodeId && edge.to === same.coordination.reusePolicyState('repo-a').constraintId)); same.close();

  const mismatching = await world(); const legacyA = await mismatching.deploy(policyA); legacyA.coordination._resetProjection(); writeFileSync(join(mismatching.logDir, 'coordination', 'events.jsonl'), '');
  const seed = await mismatching.decide(legacyA, 'legacy:seed'); mismatching.setAdvisories([{ id: 'GHSA-legacy', modified: '2026-07-12T15:00:01Z' }]); mismatching.advance(1_000);
  const adverse = await legacyA.coordinator.recheckReuseDecision({ decisionId: seed.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'legacy:risk' });
  const liveBuild = await mismatching.decide(legacyA, 'legacy:build', { choice: 'build', need: 'legacy guarded build', rationale: 'Build while the inherited adverse fence remains active.', refresh: true, dossier: adverse.dossier }); legacyA.close();
  mismatching.advance(1_000); const migrated = await mismatching.deploy(policyB, { coordination: legacyA.coordination }); const head = migrated.coordination.reusePolicyState('repo-a'); const transition = migrated.coordination.snapshot().reusePolicy.transitions[0];
  assert.equal(head.version, 1); assert.deepEqual(transition.observedPolicyHashes, [legacyA.policy.hash]); assert.equal(migrated.coordination.currentReuseDecision(liveBuild.decision.subjectDigest), null);
  const guard = migrated.coordination.reuseRiskGuard(liveBuild.decision.coordinate); assert.equal(guard.policyStale, true); assert.equal(guard.requiredPolicyHash, migrated.policy.hash); migrated.close();
});

test('PI3/PI7/PI10: replay rejects decision, guard, card, constraint, and temporal transition tampering', async () => {
  const w = await world(); const a = await w.deploy(policyA); const guarded = await w.decide(a, 'replay:guarded'); await w.decide(a, 'replay:live', { package: '@scope/other-pkg', version: '2.0.0', need: 'live replay target' });
  w.setAdvisories([{ id: 'GHSA-replay-guard', modified: '2026-07-12T15:00:01Z' }]); w.advance(1_000); await a.coordinator.recheckReuseDecision({ decisionId: guarded.decision.id, expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 10_000 }, { actor: 'operator:alice', repoId: 'repo-a', budgetTokens: 10_000, idempotencyKey: 'risk:replay-guard' });
  a.close(); w.advance(1_000); const b = await w.deploy(policyB); const expected = b.coordination.snapshot(); b.close();
  const replay = new CoordinationStore(join(w.logDir, 'coordination'), { operationalRead: (worker, seq) => b.log.read(worker, seq).find((event) => event.seq === seq) ?? null }); assert.deepEqual(replay.snapshot().reusePolicy, expected.reusePolicy);
  const path = join(w.logDir, 'coordination', 'events.jsonl'); const original = readFileSync(path, 'utf8');
  const mutate = (change) => { const lines = original.trimEnd().split('\n'); const event = JSON.parse(lines.at(-1)); change(event); event.payload.targetSetDigest = hash({ decisionTargets: event.payload.decisionTargets, bindingTargets: event.payload.bindingTargets, findingTargets: event.payload.findingTargets, guardTargets: event.payload.guardTargets, priorConstraintTarget: event.payload.priorConstraintTarget, observedPolicyHashes: event.payload.observedPolicyHashes, examinedStateRows: event.payload.examinedStateRows, derivationOverflow: event.payload.derivationOverflow }); event.payload.transitionDigest = hash(Object.fromEntries(Object.entries(event.payload).filter(([key]) => key !== 'transitionDigest'))); lines[lines.length - 1] = JSON.stringify(event); writeFileSync(path, `${lines.join('\n')}\n`); };
  for (const change of [
    (event) => { event.payload.decisionTargets = []; },
    (event) => { event.payload.guardTargets = []; },
    (event) => { event.payload.policyCardDigest = '0'.repeat(64); },
    (event) => { event.payload.policy.projection.licenseAllow = ['MIT', 'MIT']; event.payload.policy.hash = hash(event.payload.policy.projection); event.payload.policyCardDigest = hash(event.payload.policy); },
    (event) => { event.payload.constraintId = `constraint:reuse-policy:${'0'.repeat(64)}`; },
    (event) => { event.ts = '2020-01-01T00:00:00.000Z'; event.payload.effectiveAt = event.ts; },
    (event) => { event.actor = 'x'.repeat(257); },
    (event) => { event.idempotencyKey = 'invalid key'; },
  ]) {
    mutate(change); assert.throws(() => new CoordinationStore(join(w.logDir, 'coordination'), { operationalRead: (worker, seq) => b.log.read(worker, seq).find((item) => item.seq === seq) ?? null }), (error) => error.code === 'reuse_policy_integrity' || error.code === 'reuse_namespace_conflict');
  }
  writeFileSync(path, original);
});

test('PI9/PI11: policy identity is observable but no caller-controlled reconciliation command or authority exists', async () => {
  const w = await world(); const a = await w.deploy(policyA); const card = a.coordinator.capabilityCards()[0]; assert.deepEqual(Object.keys(card.reusePolicy).sort(), ['hash', 'policyId', 'projection', 'schemaVersion']);
  assert.equal(Object.keys(card.ops).includes('reuse.policy.reconcile'), false); assert.equal(typeof a.coordinator.reconcileReusePolicy, 'undefined');
  assert.equal(a.coordination.snapshot().knowledge.nodes.some((node) => /clear|safe|waiv/i.test(node.body) && node.promotion?.trigger === 'reuse.policy'), false); a.close();
});

test('PI9/PI11: authenticated web and MCP expose the same sanitized commitment and no reconciliation command', async () => {
  const w = await world(); const a = await w.deploy(policyA); const transitions = a.coordination.snapshot().reusePolicy.transitions.length;
  const web = new WebNorthbound({ coordinator: a.coordinator, coordination: a.coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => Date.parse('2026-07-12T15:00:10Z') });
  const principal = { userId: 'alice', sessionId: 'policy-web', credentialId: 'cred-policy', authMethod: 'cookie', csrfToken: 'csrf-policy', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['observe'], repoIds: ['repo-a'] };
  const context = { principal, origin: 'https://control.example.test', csrfToken: 'csrf-policy', remoteAddress: '127.0.0.1', transport: 'https' };
  const envelope = { schemaVersion: 1, commandId: 'policy-cards', idempotencyKey: 'policy-cards', command: 'capabilities', repoId: 'repo-a', origin: 'https://control.example.test', args: {} };
  const webCards = await web.execute(context, envelope); assert.equal(webCards.status, 200); const webPolicy = webCards.body.result.find((card) => card.name === 'cartographer-quartermaster').reusePolicy;
  const unauthenticated = await web.execute({ ...context, principal: null }, { ...envelope, commandId: 'policy-no-auth', idempotencyKey: 'policy-no-auth' }); assert.equal(unauthenticated.status, 401);
  const forgedWeb = await web.execute(context, { ...envelope, commandId: 'policy-forged', idempotencyKey: 'policy-forged', args: { policyHash: '0'.repeat(64) } }); assert.equal(forgedWeb.status, 400);

  const mcp = new McpFleetServer({ coordinator: a.coordinator, coordination: a.coordination, principal: { userId: 'bob', sessionId: 'policy-mcp', capabilities: ['observe'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, repoIds: ['repo-a'], now: () => Date.parse('2026-07-12T15:00:10Z'), maxWaitMs: 25_000, maxMessageBytes: 512 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase42', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const tools = await mcp.handle({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} }); assert.equal(tools.result.tools.some((tool) => /policy.*reconcil/i.test(tool.name)), false);
  const mcpCards = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_capabilities', arguments: { repoId: 'repo-a' } } }); const mcpPolicy = mcpCards.result.structuredContent.result.find((card) => card.name === 'cartographer-quartermaster').reusePolicy;
  assert.deepEqual(mcpPolicy, webPolicy); assert.deepEqual(Object.keys(webPolicy.projection).sort(), ['blockDeprecated', 'licenseAllow', 'licenseDeny', 'minScorecard', 'requireProviderVerifiedProvenance', 'ttlMs']); assert.equal(/token|credential|secret|path|https?:|prose/i.test(JSON.stringify(webPolicy)), false);
  const forgedMcp = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_capabilities', arguments: { repoId: 'repo-a', policyHash: '0'.repeat(64) } } }); assert.equal(Boolean(forgedMcp.result?.isError || forgedMcp.error), true);
  assert.equal(a.coordination.snapshot().reusePolicy.transitions.length, transitions, 'northbound observations cannot reconcile policy'); a.close();
});

test('PI5/PI7/PI9: web and MCP outer idempotency replay refreshes old policy results as historical', async () => {
  const webWorld = await world(); const webA = await webWorld.deploy(policyA); const origin = 'https://control.example.test'; const webActor = 'web:alice:policy-replay'; const webRequest = await webWorld.requestFor(webA, webActor);
  const webPrincipal = { userId: 'alice', sessionId: 'policy-replay', credentialId: 'cred-replay', authMethod: 'cookie', csrfToken: 'csrf-replay', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['control'], repoIds: ['repo-a'] }; const webContext = { principal: webPrincipal, origin, csrfToken: 'csrf-replay', remoteAddress: '127.0.0.1', transport: 'https' };
  const webEnvelope = { schemaVersion: 1, commandId: 'policy-replay-decision', idempotencyKey: 'policy-replay-decision', command: 'reuse_decide', repoId: 'repo-a', origin, args: { ...webRequest, budgetTokens: 10_000 } };
  const webOne = await new WebNorthbound({ coordinator: webA.coordinator, coordination: webA.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] }).execute(webContext, webEnvelope); assert.equal(webOne.body.result.result, 'recorded'); webA.close(); webWorld.advance(1_000);
  const webB = await webWorld.deploy(policyB); const webReplay = await new WebNorthbound({ coordinator: webB.coordinator, coordination: webB.coordination, repoIds: ['repo-a'], allowedOrigins: [origin] }).execute(webContext, webEnvelope);
  assert.equal(webReplay.body.result.result, 'historical'); assert.equal(webReplay.body.result.current, false); assert.equal(webReplay.body.result.historical, true); assert.equal(webReplay.body.replayed, true); webB.close();

  const mcpWorld = await world(); const mcpA = await mcpWorld.deploy(policyA); const mcpActor = 'mcp:bob:policy-replay'; const mcpRequest = await mcpWorld.requestFor(mcpA, mcpActor); const principal = { userId: 'bob', sessionId: 'policy-replay', capabilities: ['control'], repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false };
  const server = (driver) => new McpFleetServer({ coordinator: driver.coordinator, coordination: driver.coordination, principal, repoIds: ['repo-a'], maxWaitMs: 25_000, maxMessageBytes: 512 * 1024, takeToolQuota: async () => ({ ok: true }) });
  const call = async (mcp, id) => { await mcp.handle({ jsonrpc: '2.0', id: `${id}:init`, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase42-replay', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }); return mcp.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'fleet_reuse_decide', arguments: { repoId: 'repo-a', idempotencyKey: 'policy-replay-mcp', ...mcpRequest, budgetTokens: 10_000 } } }); };
  const mcpOne = await call(server(mcpA), 1); assert.equal(mcpOne.result.structuredContent.result, 'recorded'); mcpA.close(); mcpWorld.advance(1_000); const mcpB = await mcpWorld.deploy(policyB); const mcpReplay = await call(server(mcpB), 2);
  assert.equal(mcpReplay.result.structuredContent.result, 'historical'); assert.equal(mcpReplay.result.structuredContent.current, false); assert.equal(mcpReplay.result.structuredContent.historical, true); mcpB.close();
});
