import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CapabilityRegistry, CartographerQuartermaster, PublicSupplyChainOracle, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-qv-${name}-`));
const write = (base, path, content) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); };
const response = (value, status = 200) => {
  const raw = Buffer.from(JSON.stringify(value));
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => raw };
};
function transport(state) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body, redirect: init.redirect });
    if (state.fail) return response({}, 503);
    if (String(url).includes('/projects/')) return response(state.project);
    if (String(url).includes('api.osv.dev')) return response(state.osv);
    return response(state.deps);
  };
  return { fetch, calls };
}
function greenState() {
  return {
    deps: {
      versionKey: { system: 'NPM', name: '@scope/safe-pkg', version: '1.2.3' }, publishedAt: '2026-01-01T00:00:00Z', isDeprecated: false,
      licenses: ['MIT'], advisoryKeys: [], attestations: [{ verified: true, type: 'https://slsa.dev/provenance/v1' }],
      relatedProjects: [{ projectKey: { id: 'github.com/example/safe-pkg' }, relationType: 'SOURCE_REPO', relationProvenance: 'SLSA_ATTESTATION' }],
    },
    osv: { vulns: [] },
    project: { scorecard: { date: '2026-01-02T00:00:00Z', overallScore: 8.4, checks: [{ name: 'Pinned-Dependencies', score: 8, reason: 'untrusted prose' }] } },
  };
}
async function fixture(state = greenState()) {
  const base = root('repo'); const atlasRoot = root('atlas'); const outputRoot = root('output'); const oracleRoot = root('oracle');
  write(base, 'src/main.js', `import pkg from '@scope/safe-pkg/subpath'\nexport const value = pkg\n`);
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot });
  const built = await atlas.invoke('index.build', {}, { baseRoot: base, budgetTokens: 10_000 });
  const wire = transport(state); let now = Date.parse('2026-07-12T12:00:00Z');
  const oracle = new PublicSupplyChainOracle({ fetch: wire.fetch, artifactRoot: oracleRoot, timeoutMs: 1_000, maxResponseBytes: 64 * 1024, maxAdvisories: 32 });
  const capability = new CartographerQuartermaster({
    atlas, artifactRoot: outputRoot, externalOracle: oracle, now: () => now,
    vetPolicy: { ttlMs: 60_000, licenseAllow: ['MIT', 'Apache-2.0'], licenseDeny: ['GPL-3.0-only'], minScorecard: 7, requireProviderVerifiedProvenance: true, blockDeprecated: true },
  });
  const registry = new CapabilityRegistry({ capabilities: { 'cartographer-quartermaster': capability }, contexts: { 'cartographer-quartermaster': { worktreeRoot: base } }, maxBudgetTokens: 10_000, maxEnvelopeBytes: 256 * 1024, root: base, record: () => {} });
  return { base, built, wire, state, oracle, oracleRoot, capability, registry, setNow: (value) => { now = value; } };
}

test('QV1: external vet is advertised only with an injected oracle and complete deployment policy', async () => {
  const f = await fixture();
  assert.ok(f.capability.card().ops['reuse.vet']);
  const plain = new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('plain') });
  assert.equal(plain.card().ops['reuse.vet'], undefined);
  assert.throws(() => new CartographerQuartermaster({ atlas: f.capability.atlas, artifactRoot: root('bad'), externalOracle: f.oracle }), /external vet requires deployment/);
});

test('QV2-QV5: exact healthy npm evidence yields a bounded candidate with honest import observation', async () => {
  const f = await fixture(); const args = { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const result = await f.registry.invoke('cartographer-quartermaster', 'reuse.vet', args, { actor: 'orchestrator', budgetTokens: 4_000 });
  assert.equal(result.status, 'ok'); assert.equal(result.payload[0].recommendation, 'borrow_candidate');
  assert.equal(result.payload[0].usage.status, 'import_observed'); assert.equal(result.payload[0].usage.claim, 'repository_import_observation_only');
  assert.equal(result.payload[0].policy.license, 'allow'); assert.deepEqual(result.payload[0].policy.blocked, []); assert.deepEqual(result.payload[0].policy.unknown, []);
  assert.equal(result.refs[0].kind, 'dependency-dossier'); assert.equal(result.refs.filter((ref) => ref.kind === 'supply-chain-source').length, 3); assert.equal(result.provenance.externalLookup, true); assert.equal(result.provenance.deterministic, false);
  assert.equal(JSON.stringify(result).includes('untrusted prose'), false);
  assert.equal(result.payload[0].sources.every((source) => existsSync(join(f.oracleRoot, `${source.digest}.json`))), true);
  assert.equal(f.wire.calls.every((call) => call.redirect === 'error'), true);
  assert.equal(f.wire.calls[0].url.includes('%40scope%2Fsafe-pkg'), true); assert.equal(f.wire.calls.some((call) => call.method === 'POST' && call.body.includes('"ecosystem":"npm"')), true);
});

test('QV4/QV5: a known advisory blocks even when the package import is not observed', async () => {
  const state = greenState(); state.deps.versionKey.name = 'vulnerable-pkg'; state.deps.relatedProjects = []; state.deps.attestations = [{ verified: true }];
  state.osv = { vulns: [{ id: 'GHSA-aaaa-bbbb-cccc', modified: '2026-07-01T00:00:00Z' }] };
  const f = await fixture(state); const result = await f.capability.invoke('reuse.vet', { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: 'vulnerable-pkg', version: '1.2.3' }, { budgetTokens: 4_000 });
  assert.equal(result.payload[0].usage.status, 'not_observed'); assert.equal(result.payload[0].recommendation, 'block');
  assert.equal(result.payload[0].policy.blocked.includes('known_vulnerability'), true);
});

test('QV3/QV4: missing license, Scorecard, and required provenance fail pending without prose', async () => {
  const state = greenState(); state.deps.licenses = []; state.deps.attestations = []; state.deps.relatedProjects = [];
  const f = await fixture(state); const result = await f.capability.invoke('reuse.vet', { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' }, { budgetTokens: 4_000 });
  assert.equal(result.payload[0].recommendation, 'blocked_pending_vet');
  assert.deepEqual(result.payload[0].policy.unknown.sort(), ['license_unknown', 'provider_verified_provenance_missing', 'scorecard_unknown']);
});

test('QV2: outage, pagination, and response ceilings fail closed with typed reasons', async () => {
  const state = greenState(); const wire = transport(state);
  const unavailable = new PublicSupplyChainOracle({ fetch: transport({ ...state, fail: true }).fetch, artifactRoot: root('oracle-unavailable'), timeoutMs: 100, maxResponseBytes: 1024, maxAdvisories: 4 });
  await assert.rejects(() => unavailable.vet({ ecosystem: 'npm', package: 'x', version: '1.0.0' }), (error) => error.code === 'oracle_unavailable');
  state.osv = { vulns: [], next_page_token: 'more' };
  const paged = new PublicSupplyChainOracle({ fetch: wire.fetch, artifactRoot: root('oracle-paged'), timeoutMs: 100, maxResponseBytes: 64 * 1024, maxAdvisories: 4 });
  await assert.rejects(() => paged.vet({ ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' }), (error) => error.code === 'oracle_incomplete');
  const huge = new PublicSupplyChainOracle({ fetch: async () => response({ pad: 'x'.repeat(2_000) }), artifactRoot: root('oracle-huge'), timeoutMs: 100, maxResponseBytes: 100, maxAdvisories: 4 });
  await assert.rejects(() => huge.vet({ ecosystem: 'npm', package: 'x', version: '1.0.0' }), (error) => error.code === 'oracle_response_oversize');
  await assert.rejects(() => paged.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '^1.2.3' }), (error) => error.code === 'invalid_package_identity');
  await assert.rejects(() => paged.vet({ ecosystem: 'pypi', package: 'safe-pkg', version: '1.2.3' }), (error) => error.code === 'unsupported_ecosystem');
  const mismatchState = greenState(); mismatchState.deps.versionKey.name = 'different-package';
  const mismatch = new PublicSupplyChainOracle({ fetch: transport(mismatchState).fetch, artifactRoot: root('oracle-mismatch'), timeoutMs: 100, maxResponseBytes: 64 * 1024, maxAdvisories: 4 });
  await assert.rejects(() => mismatch.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' }), (error) => error.code === 'oracle_coordinate_mismatch');
  const abortingFetch = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(new Error('aborted')); else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const timeout = new PublicSupplyChainOracle({ fetch: abortingFetch, artifactRoot: root('oracle-timeout'), timeoutMs: 5, maxResponseBytes: 1024, maxAdvisories: 4 });
  await assert.rejects(() => timeout.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' }), (error) => error.code === 'oracle_timeout');
  const cancelled = new AbortController(); cancelled.abort('stop');
  await assert.rejects(() => timeout.vet({ ecosystem: 'npm', package: 'safe-pkg', version: '1.2.3' }, { signal: cancelled.signal }), (error) => error.code === 'cancelled');
});

test('QV6: cache and snapshot reverify avoid network; expiry blocks until explicit refresh', async () => {
  const f = await fixture(); const args = { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const claim = await f.capability.invoke('reuse.vet', args, { budgetTokens: 4_000 });
  const calls = f.wire.calls.length;
  f.setNow(Date.parse('2026-07-12T12:00:01Z'));
  const cached = await f.capability.invoke('reuse.vet', args, { budgetTokens: 4_000 }); assert.equal(cached.refs[0].digest, claim.refs[0].digest); assert.equal(cached.provenance.cache, 'hit');
  const same = await f.capability.reverify(claim, 'reuse.vet', args, { budgetTokens: 4_000 }); assert.equal(same.ok, true); assert.equal(f.wire.calls.length, calls);
  f.state.osv.vulns = [{ id: 'MAL-2026-9999', modified: '2026-07-12T00:00:00Z' }];
  f.setNow(Date.parse('2026-07-12T12:02:00Z'));
  const expired = await f.capability.reverify(claim, 'reuse.vet', args, { budgetTokens: 4_000 }); assert.deepEqual(expired, { ok: false, reason: 'evidence_expired' });
  const stale = await f.capability.invoke('reuse.vet', args, { budgetTokens: 4_000 }); assert.equal(stale.payload[0].recommendation, 'blocked_pending_vet'); assert.equal(stale.provenance.cache, 'stale'); assert.equal(f.wire.calls.length, calls);
  const refreshed = await f.capability.invoke('reuse.vet', { ...args, refresh: true }, { budgetTokens: 4_000 }); assert.equal(refreshed.payload[0].recommendation, 'block'); assert.notEqual(refreshed.refs[0].digest, claim.refs[0].digest); assert.ok(f.wire.calls.length > calls);
});

test('QV3/QV6: malicious package signal blocks and dossier substitution/tamper refuses', async () => {
  const state = greenState(); state.osv.vulns = [{ id: 'MAL-2026-1234', modified: '2026-07-12T00:00:00Z' }];
  const f = await fixture(state); const args = { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const claim = await f.capability.invoke('reuse.vet', args, { budgetTokens: 4_000 });
  assert.equal(claim.payload[0].policy.blocked.includes('known_malicious_package'), true);
  const wrong = { ...claim, refs: [{ ...claim.refs[0], path: join(f.base, 'other.json') }] };
  const verified = await f.capability.reverify(wrong, 'reuse.vet', args, { budgetTokens: 4_000 }); assert.equal(verified.ok, false); assert.equal(verified.reason, 'artifact_integrity');
  const source = claim.payload[0].sources[0]; writeFileSync(join(f.oracleRoot, `${source.digest}.json`), 'tampered');
  const sourceCheck = await f.capability.reverify(claim, 'reuse.vet', args, { budgetTokens: 4_000 }); assert.equal(sourceCheck.ok, false); assert.equal(sourceCheck.reason, 'source_digest_mismatch');
});

test('QV3: a tiny context budget returns an honest ref-only partial without an infinite cursor', async () => {
  const f = await fixture(); const args = { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const result = await f.capability.invoke('reuse.vet', args, { budgetTokens: 1 });
  assert.equal(result.status, 'partial'); assert.deepEqual(result.payload, []); assert.equal(result.cursor, undefined); assert.equal(result.refs[0].kind, 'dependency-dossier');
  await assert.rejects(() => f.capability.resume(result.refs[0], `orientation:${result.refs[0].digest}:0`, { budgetTokens: 100 }), (error) => error.code === 'capability_resume_unavailable');
});

test('QV1/QV7: the public driver exposes external vet through the sole audited ACI plane', async () => {
  const f = await fixture(); execFileSync('git', ['init', '-q'], { cwd: f.base });
  const driver = createDriver({
    repoRoot: f.base, logDir: root('driver-log'), adapters: {},
    capabilityFactories: { 'cartographer-quartermaster': () => f.capability },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: f.base } },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 256 * 1024,
  });
  const card = driver.coordinator.capabilityCards().find((item) => item.name === 'cartographer-quartermaster');
  assert.equal(card.ops['reuse.vet'].latency_class, 'bounded_batch'); assert.equal(card.northbound.inlineOps.includes('reuse.vet'), true);
  const args = { indexEpoch: f.built.provenance.index_epoch, ecosystem: 'npm', package: '@scope/safe-pkg', version: '1.2.3' };
  const result = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.vet', args, { actor: 'operator:test', budgetTokens: 4_000 });
  assert.equal(result.payload[0].recommendation, 'borrow_candidate');
  const verified = await driver.coordinator.reverifyCapability('cartographer-quartermaster', 'reuse.vet', result, args, { actor: 'operator:test', budgetTokens: 4_000 });
  assert.equal(verified.status, 'ok');
  assert.deepEqual(driver.log.read('hub-capability').map((event) => event.actor), ['operator:test', 'operator:test', 'operator:test', 'operator:test']);
});
