import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex, CartographerQuartermaster, CapabilityRegistry, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-orientation-${name}-`));
function write(base, path, content) { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), content); }
async function fixture() {
  const base = root('repo'); const atlasRoot = root('atlas'); const outputRoot = root('output');
  write(base, 'src/auth/token.js', `export function verifyJwt(token) { return token.length > 10 }\nexport function refreshToken(token) { return verifyJwt(token) }\n`);
  write(base, 'src/api/session.js', `import { refreshToken } from '../auth/token.js'\nexport const session = (token) => refreshToken(token)\n`);
  write(base, 'src/billing/invoice.js', `export function createInvoice() { return true }\n`);
  write(base, 'src/unrelated/import-heavy.js', `${Array.from({ length: 10 }, (_, i) => `import value${i} from './dep-${i}.js'`).join('\n')}\nexport const unrelated = true\n`);
  const atlas = new AtlasCodeIndex({ artifactRoot: atlasRoot });
  const built = await atlas.invoke('index.build', {}, { baseRoot: base, budgetTokens: 10_000 });
  const capability = new CartographerQuartermaster({ atlas, artifactRoot: outputRoot });
  const registry = new CapabilityRegistry({ capabilities: { 'cartographer-quartermaster': capability }, contexts: { 'cartographer-quartermaster': { worktreeRoot: base } }, maxBudgetTokens: 10_000, maxEnvelopeBytes: 128 * 1024, root: base, record: () => {} });
  return { base, atlas, built, capability, registry };
}

test('OR1/OR2/OR4: focused brief reuses an exact Atlas epoch through the ACI registry', async () => {
  const f = await fixture(); const args = { indexEpoch: f.built.provenance.index_epoch, focus: 'auth token refresh', shape: 'brief' };
  const result = await f.registry.invoke('cartographer-quartermaster', 'orientation.slice', args, { actor: 'orchestrator', budgetTokens: 2_000 });
  assert.equal(result.status, 'ok'); assert.equal(result.op, 'orientation.slice');
  assert.equal(result.payload[0].path, 'src/auth/token.js');
  assert.equal(result.payload.some((item) => item.path === 'src/billing/invoice.js'), false);
  assert.equal(result.provenance.index_epoch, args.indexEpoch); assert.equal(result.provenance.mergeAuthority, false); assert.equal(result.provenance.verificationAuthority, false);
  assert.match(result.refs[0].digest, /^[a-f0-9]{64}$/);
  const reverified = await f.registry.reverify('cartographer-quartermaster', 'orientation.slice', result, args, { actor: 'orchestrator', budgetTokens: 2_000 });
  assert.equal(reverified.status, 'ok'); assert.equal(reverified.payload[0].ok, true);
});

test('OR2/OR3: map stays typed and internal reuse never invents an external package', async () => {
  const f = await fixture(); const epoch = f.built.provenance.index_epoch;
  const map = await f.capability.invoke('orientation.slice', { indexEpoch: epoch, focus: 'src/auth', shape: 'map' }, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: f.base });
  assert.equal(map.payload.some((item) => item.path === 'src/auth/token.js'), true);
  assert.equal(map.payload.some((item) => item.path === 'src/billing/invoice.js'), false, 'path focus must not broaden through generic path segments');
  const hit = await f.capability.invoke('reuse.internal', { indexEpoch: epoch, need: 'JWT verification' }, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: f.base });
  assert.equal(hit.payload[0].recommendation, 'internal'); assert.equal(hit.payload[0].candidates.some((item) => item.path === 'src/auth/token.js'), true);
  const miss = await f.capability.invoke('reuse.internal', { indexEpoch: epoch, need: 'PDF rasterization' }, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: f.base });
  assert.deepEqual(miss.payload, [{ need: 'PDF rasterization', recommendation: 'external_vet_required', candidates: [] }]);
  assert.equal(miss.payload[0].candidates.some((item) => item.path === 'src/unrelated/import-heavy.js'), false, 'import-count ranking prior is not match evidence');
  assert.equal(JSON.stringify(miss).includes('package'), false);
});

test('OR4/OR6/OR8: bounded resume and tamper-safe reverify preserve exact operation identity', async () => {
  const f = await fixture(); const args = { indexEpoch: f.built.provenance.index_epoch, focus: 'src', shape: 'map' };
  const result = await f.capability.invoke('orientation.slice', args, { actor: 'orchestrator', budgetTokens: 1, worktreeRoot: f.base });
  assert.equal(result.status, 'needs_resume'); assert.match(result.cursor, /^orientation:[a-f0-9]{64}:\d+$/);
  const resumed = await f.capability.resume(result.refs[0], result.cursor, { actor: 'orchestrator', budgetTokens: 2_000 });
  assert.equal(resumed.op, 'orientation.slice'); assert.ok(resumed.payload.length > 0);
  const wrong = await f.capability.reverify(result, 'reuse.internal', args, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: f.base });
  assert.equal(wrong.ok, false);
  writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')}tamper\n`);
  await assert.rejects(f.capability.resume(result.refs[0], result.cursor, { actor: 'orchestrator', budgetTokens: 2_000 }), (error) => error.code === 'artifact_integrity');
  const tampered = await f.capability.reverify(result, 'orientation.slice', args, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: f.base });
  assert.equal(tampered.ok, false); assert.equal(tampered.reason, 'artifact_integrity');
});

test('OR1/OR5/OR6: a worktree overlay changes exact identity without mutating the base epoch', async () => {
  const f = await fixture(); const args = { indexEpoch: f.built.provenance.index_epoch, focus: 'oauth auth', shape: 'brief' };
  const base = await f.capability.invoke('orientation.slice', args, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: f.base });
  const overlay = root('overlay'); cpSync(f.base, overlay, { recursive: true });
  write(overlay, 'src/auth/oauth.js', 'export function exchangeOauthCode(code) { return code }\n');
  const changed = await f.capability.invoke('orientation.slice', args, { actor: 'orchestrator', budgetTokens: 2_000, worktreeRoot: overlay });
  assert.equal(changed.provenance.index_epoch, base.provenance.index_epoch);
  assert.notEqual(changed.provenance.overlay_digest, base.provenance.overlay_digest);
  assert.notEqual(changed.refs[0].digest, base.refs[0].digest);
  assert.equal(changed.payload.some((item) => item.path === 'src/auth/oauth.js'), true);
  assert.equal(base.payload.some((item) => item.path === 'src/auth/oauth.js'), false);
});

test('OR4/OR8: createDriver factory exposes invoke/resume/reverify through the sole ACI plane', async () => {
  const f = await fixture(); const logDir = root('driver-log');
  execFileSync('git', ['init', '-q'], { cwd: f.base });
  const driver = createDriver({
    repoRoot: f.base, logDir, adapters: {},
    capabilityFactories: { 'cartographer-quartermaster': () => f.capability },
    capabilityContexts: { 'cartographer-quartermaster': { worktreeRoot: f.base } },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 128 * 1024,
  });
  const card = driver.coordinator.capabilityCards().find((item) => item.name === 'cartographer-quartermaster');
  assert.deepEqual(card.actions, { invoke: true, resume: true, reverify: true, cancel: false });
  const args = { indexEpoch: f.built.provenance.index_epoch, need: 'JWT verification' };
  const result = await driver.coordinator.invokeCapability('cartographer-quartermaster', 'reuse.internal', args, { actor: 'orchestrator', budgetTokens: 2_000 });
  assert.equal(result.payload[0].recommendation, 'internal');
  const verified = await driver.coordinator.reverifyCapability('cartographer-quartermaster', 'reuse.internal', result, args, { actor: 'orchestrator', budgetTokens: 2_000 });
  assert.equal(verified.status, 'ok');
  assert.deepEqual(driver.log.read('hub-capability').map((event) => event.kind), ['capability.op.started', 'capability.op.completed', 'capability.op.started', 'capability.op.completed']);
});

test('OR5: a substituted Atlas result artifact is refused even when Atlas returns its old digest', async () => {
  const f = await fixture(); const epoch = f.built.provenance.index_epoch;
  const source = await f.atlas.invoke('code.seed', { indexEpoch: epoch, terms: ['jwt'] }, { budgetTokens: 2_000, worktreeRoot: f.base });
  writeFileSync(source.refs[0].path, 'substituted\n');
  await assert.rejects(f.capability.invoke('reuse.internal', { indexEpoch: epoch, need: 'JWT' }, { budgetTokens: 2_000, worktreeRoot: f.base }), (error) => error.code === 'orientation_source_integrity');
});

test('OR5/OR7: invalid focus/shape and cancellation refuse without external fallbacks', async () => {
  const f = await fixture(); const epoch = f.built.provenance.index_epoch;
  await assert.rejects(f.capability.invoke('orientation.slice', { indexEpoch: epoch, focus: '', shape: 'brief' }, { budgetTokens: 100, worktreeRoot: f.base }), (error) => error.code === 'invalid_orientation');
  await assert.rejects(f.capability.invoke('orientation.slice', { indexEpoch: epoch, focus: 'auth', shape: 'semantic_whole_repo' }, { budgetTokens: 100, worktreeRoot: f.base }), (error) => error.code === 'invalid_orientation');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.capability.invoke('reuse.internal', { indexEpoch: epoch, need: 'JWT' }, { budgetTokens: 100, worktreeRoot: f.base, signal: abort.signal }), (error) => error.code === 'cancelled');
});
