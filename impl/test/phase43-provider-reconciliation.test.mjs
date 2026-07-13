import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDriver } from '../src/index.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const sha = (value) => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const coordinate = Object.freeze({ ecosystem: 'npm', package: '@scope/provider-green', version: '1.2.3' }); const fingerprint = sha(Buffer.from('provider-green-key')); const indexEpoch = 'a'.repeat(64); const atlasCardDigest = 'b'.repeat(64);
const policyProjection = Object.freeze({ licenseAllow: ['MIT'], licenseDeny: [], minScorecard: null, requireProviderVerifiedProvenance: false, blockDeprecated: true, ttlMs: 60_000 }); const policyHash = sha(policyProjection);
const reconcileLimits = { maxDecisionTargets: 100, maxGuardTargets: 100, maxAffectedReads: 100, maxStateRows: 1000, maxObservedPolicyHashes: 16, maxEventBytes: 256 * 1024 };

function feedSource() { return { card: () => ({ schemaVersion: 1, providerId: 'fixture.green', adapterId: 'fixture-green-v1', version: '1', modes: ['webhook'], ecosystem: 'npm', semantics: 'authenticated_hint', auth: { scheme: 'injected-test', keyFingerprints: [fingerprint] }, ceilings: { maxDeliveryBytes: 4096, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256 } }),
  async verifyDelivery({ raw }) { const parsed = JSON.parse(raw); const digest = sha(raw); return { schemaVersion: 1, providerId: 'fixture.green', deliveryId: parsed.deliveryId, rawDigest: digest, rawBytes: raw.length, authReceiptDigest: sha(Buffer.from(`auth:${parsed.deliveryId}`)), keyFingerprint: fingerprint, occurredAt: parsed.occurredAt, sequence: parsed.sequence, coordinates: parsed.coordinates, advisoryIds: [], source: { handle: `art:sha256:${digest}`, digest, bytes: raw.length, mediaType: 'application/json' } }; } }; }

function quartermaster(state) {
  const snapshotFor = (value) => ({ identity: value, recommendation: state.adverse ? 'block' : 'borrow_candidate', policyHash, policy: { hash: policyHash, license: 'allow', blocked: state.adverse ? ['known_vulnerability'] : [], unknown: [] }, factDigest: sha({ coordinate: value, adverse: state.adverse }), asOf: '2026-07-13T06:00:00.000Z', expiresAt: '2026-07-13T06:01:00.000Z', indexEpoch, overlayDigest: 'c'.repeat(64) });
  return { vetPolicy: policyProjection, vetPolicyHash: policyHash,
    card: () => ({ name: 'cartographer-quartermaster', version: 'fixture', underlying: ['fixture'], ops: { 'reuse.vet': { latency_class: 'bounded_batch', deterministic: false, side_effects: [], reverifiable: 'fresh_observation' } }, reusePolicy: { schemaVersion: 1, policyId: 'quartermaster-vet-policy-v1', hash: policyHash, projection: policyProjection } }),
    async invoke(op, args) { assert.equal(op, 'reuse.vet'); state.invokes += 1; const identity = { ecosystem: args.ecosystem, package: args.package, version: args.version }; const snapshot = snapshotFor(identity); const dossier = { ...snapshot, advisories: state.adverse ? [{ id: 'OSV-adverse', malicious: false }] : [], advisoryIds: state.adverse ? ['OSV-adverse'] : [] }; const digest = sha(dossier); return { op, status: 'ok', summary: 'fixture official observation', payload: [dossier], refs: [{ kind: 'dependency-dossier', mediaType: 'application/vnd.baton.dependency-dossier+json', handle: `art:sha256:${digest}`, digest, bytes: 100 }], cost: { tokens_out: 10, wall_ms: 1, usd: 0, underlying: 'fixture' }, provenance: { mergeAuthority: false, verificationAuthority: false } }; },
    async reverify(claim, op, args) { state.reverifies += 1; const identity = { ecosystem: args.ecosystem, package: args.package, version: args.version }; return { ok: true, observedDigest: claim.refs[0].digest, snapshot: snapshotFor(identity) }; } };
}

async function world(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-provider-reconcile-')); const repoRoot = join(root, 'repo'); mkdirSync(repoRoot); execFileSync('git', ['init', '-q'], { cwd: repoRoot }); const logDir = join(root, 'log'); const state = { invokes: 0, reverifies: 0, adverse: overrides.adverse ?? false, currentCalls: 0 };
  const authority = { card: () => ({ schemaVersion: 1, authorityId: 'fixture-index-authority', repoId: 'repo-a', atlasCardDigest }), async current() { state.currentCalls += 1; return { schemaVersion: 1, repoId: 'repo-a', treeSha: state.currentCalls > 1 && overrides.changeIndex ? 'ffff' : 'abcd', indexEpoch, atlasCardDigest }; }, async reverify() { return { ok: true }; } };
  const options = { repoRoot, repoId: 'repo-a', logDir, adapters: {}, now: () => Date.parse('2026-07-13T06:00:01.000Z'), advisoryFeedSources: { 'fixture.green': feedSource() }, capabilities: { 'cartographer-quartermaster': quartermaster(state) }, maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
    reuseDecisionPolicy: { authorize: async () => true, authorizeRecheck: async () => true, maxNeedBytes: 2048, maxRationaleBytes: 8192, policyReconcile: reconcileLimits }, providerReconciliation: { budgetTokens: 10_000, indexAuthority: authority } };
  const driver = createDriver(options); const raw = Buffer.from(JSON.stringify({ deliveryId: 'delivery-green', occurredAt: '2026-07-13T06:00:00.000Z', sequence: 1, coordinates: overrides.coordinates ?? [coordinate] })); const admitted = await driver.coordinator.receiveProviderDelivery('fixture.green', { mode: 'webhook', raw });
  return { driver, options, state, admitted };
}

test('AF3/AF4/AF8/AF9: seedless official green refresh atomically resolves pending and creates only verified Source lineage', async () => {
  const w = await world(); const before = w.driver.coordination.snapshot(); const result = await w.driver.coordinator.reconcileProviderProcessing(w.admitted.processing.id);
  assert.equal(result.result, 'ignored_non_adverse'); assert.equal(result.processing.status, 'ignored_non_adverse'); assert.equal(w.driver.coordination.pendingProviderReconciliation('repo-a', coordinate).length, 0);
  assert.equal(w.driver.coordination.snapshot().reuseRiskGuards.length, 0); assert.equal(w.driver.coordination.snapshot().knowledge.nodes.filter((node) => node.type === 'Finding').length, before.knowledge.nodes.filter((node) => node.type === 'Finding').length);
  const official = w.driver.coordination.snapshot().knowledge.nodes.find((node) => node.promotion?.trigger === 'provider.official'); assert.equal(official.type, 'Source'); assert.equal(official.grounding, 'verified'); assert.ok(w.driver.coordination.snapshot().knowledge.edges.some((edge) => edge.type === 'DerivedFrom' && edge.from === official.id && edge.to === w.admitted.receipt.nodeId));
  const counts = { invokes: w.state.invokes, reverifies: w.state.reverifies }; const retry = await w.driver.coordinator.reconcileProviderProcessing(w.admitted.processing.id); assert.equal(retry.result, 'idempotent'); assert.deepEqual({ invokes: w.state.invokes, reverifies: w.state.reverifies }, counts); w.driver.close();
  const replay = createDriver(w.options); assert.equal(replay.coordination.providerProcessing(w.admitted.processing.id).status, 'ignored_non_adverse'); assert.equal(replay.coordination.pendingProviderReconciliation('repo-a', coordinate).length, 0); replay.close();
});

test('AF3/AF6: multi-coordinate green processing completes as one root and exposes no pending prefix', async () => {
  const second = { ecosystem: 'npm', package: '@scope/provider-green-two', version: '2.0.0' }; const key = (value) => `${value.ecosystem}\0${value.package}\0${value.version}`; const coordinates = [coordinate, second].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0); const w = await world({ coordinates });
  const result = await w.driver.coordinator.reconcileProviderProcessing(w.admitted.processing.id); assert.equal(result.processing.observations.length, 2); assert.equal(w.state.invokes, 2); assert.equal(w.state.reverifies, 2);
  assert.equal(coordinates.every((value) => w.driver.coordination.pendingProviderReconciliation('repo-a', value).length === 0), true); assert.equal(w.driver.coordination.events().filter((event) => event.kind === 'provider.processing_checked').length, 1); w.driver.close();
});

test('AF4/AF6: index change or adverse result leaves the complete processing root pending and unfenced from false green', async () => {
  for (const options of [{ changeIndex: true }, { adverse: true }]) { const w = await world(options); await assert.rejects(w.driver.coordinator.reconcileProviderProcessing(w.admitted.processing.id), (error) => error.code === (options.changeIndex ? 'provider_index_changed' : 'provider_adverse_pending')); assert.equal(w.driver.coordination.providerProcessing(w.admitted.processing.id).status, 'pending'); assert.equal(w.driver.coordination.pendingProviderReconciliation('repo-a', coordinate).length, 1); assert.equal(w.driver.coordination.events().some((event) => event.kind === 'provider.processing_checked'), false, 'audit evidence may append, but no completion or guard may partially append'); w.driver.close(); }
});
