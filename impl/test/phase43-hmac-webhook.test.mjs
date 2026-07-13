import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AdvisoryFeedRegistry, HmacAdvisoryWebhookSource, createDriver, signHmacAdvisoryWebhookForTest } from '../src/index.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const secret = Buffer.alloc(32, 0x43); const keyFingerprint = sha(Buffer.from('phase43-hmac-key-id'));
const occurredAt = '2026-07-13T04:00:00.000Z'; const now = () => Date.parse('2026-07-13T04:00:01.000Z');
const body = Buffer.from('{"advisoryIds":["OSV-2026-43"],"coordinates":[{"ecosystem":"npm","package":"@scope/pkg","version":"1.2.3"}],"schemaVersion":1}');

function cas(overrides = {}) {
  const values = new Map(); const calls = [];
  return { storeId: 'provider-cas-v1', calls, values,
    async put(raw, expected) { calls.push({ kind: 'put', expected }); const digest = sha(raw); values.set(digest, Buffer.from(raw)); return { storeId: 'provider-cas-v1', digest, bytes: raw.length, ...(overrides.put ?? {}) }; },
    async get(digest) { calls.push({ kind: 'get', digest }); return overrides.get ?? Buffer.from(values.get(digest)); },
  };
}
function sourceFixture(overrides = {}) {
  const privateCas = overrides.privateCas ?? cas();
  const source = new HmacAdvisoryWebhookSource({ providerId: 'fixture.secure', adapterId: 'baton-hmac-json-v1', version: '1', secret, keyFingerprint,
    callback: { method: 'POST', path: '/machine/providers/fixture.secure' }, privateCas, now,
    ceilings: { maxDeliveryBytes: 1024, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 128, maxHeaderCount: 8, maxHeaderBytes: 1024, maxClockSkewMs: 60_000 } });
  return { privateCas, source };
}
function fixture(overrides = {}) { const built = sourceFixture(overrides); return { ...built, registry: new AdvisoryFeedRegistry({ sources: { 'fixture.secure': built.source } }) }; }
function request(overrides = {}) {
  const raw = overrides.raw ?? body; const method = overrides.method ?? 'POST'; const path = overrides.path ?? '/machine/providers/fixture.secure';
  const deliveryId = overrides.deliveryId ?? 'delivery-43'; const timestamp = overrides.timestamp ?? occurredAt;
  const signature = overrides.signature ?? signHmacAdvisoryWebhookForTest(secret, { method, path, occurredAt: timestamp, deliveryId, raw });
  const rawHeaders = overrides.rawHeaders ?? [['content-type', 'application/json'], ['content-encoding', 'identity'], ['x-baton-signature', signature], ['x-baton-delivery-id', deliveryId], ['x-baton-timestamp', timestamp], ['x-baton-sequence', '43']];
  return { method, path, rawHeaders, raw };
}

test('AF1/AF2: native HMAC card pins callback/domain/headers/CAS and exact wire receipt reverifies from private CAS', async () => {
  const { registry, privateCas } = fixture(); const cards = registry.cards(); assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].webhook, { method: 'POST', path: '/machine/providers/fixture.secure', contentType: 'application/json', contentEncoding: 'identity' });
  assert.equal(cards[0].auth.domain, 'baton-provider-webhook-v1'); assert.equal(cards[0].privateCas.storeId, 'provider-cas-v1');
  assert.equal(JSON.stringify(cards).includes(secret.toString('hex')), false);
  const receipt = await registry.verifyWebhook('fixture.secure', request()); assert.equal(receipt.deliveryId, 'delivery-43'); assert.equal(receipt.sequence, 43); assert.equal(receipt.rawDigest, sha(body));
  assert.equal(privateCas.calls.filter((call) => call.kind === 'put').length, 1);
  const replay = await registry.reverifyReceipt(receipt); assert.equal(replay.contentDigest, receipt.contentDigest); assert.equal(privateCas.calls.filter((call) => call.kind === 'get').length, 1);
});

test('AF2: body, method, path, delivery, timestamp, signature, or sensitive-header multiplicity mutation fails before CAS', async () => {
  const mutations = [
    () => ({ ...request(), raw: Buffer.from(`${body} `) }),
    () => ({ ...request(), method: 'PUT' }),
    () => ({ ...request(), path: '/machine/providers/other' }),
    () => request({ deliveryId: 'other', signature: request().rawHeaders[2][1] }),
    () => request({ timestamp: '2026-07-13T03:00:00.000Z' }),
    () => request({ timestamp: '2026-07-13T04:00:02.000Z' }),
    () => request({ timestamp: 'not-a-time' }),
    () => request({ signature: '0'.repeat(64) }),
    () => { const value = request(); return { ...value, rawHeaders: [...value.rawHeaders, ['x-baton-signature', value.rawHeaders[2][1]] ] }; },
    () => { const value = request(); return { ...value, rawHeaders: [...value.rawHeaders, ['content-length', String(body.length)]] }; },
  ];
  for (const mutate of mutations) { const { registry, privateCas } = fixture(); await assert.rejects(registry.verifyWebhook('fixture.secure', mutate())); assert.equal(privateCas.calls.length, 0); }
});

test('AF2/AF10: noncanonical or authority-bearing hints and lying private CAS fail closed', async () => {
  for (const raw of [
    Buffer.from('{"schemaVersion":1,"coordinates":[],"advisoryIds":[]}'),
    Buffer.from('{"advisoryIds":[],"coordinates":[{"ecosystem":"npm","package":"pkg","version":"latest"}],"schemaVersion":1}'),
    Buffer.from('{"adverse":true,"advisoryIds":[],"coordinates":[{"ecosystem":"npm","package":"pkg","version":"1.0.0"}],"schemaVersion":1}'),
    Buffer.from('{ "advisoryIds":[],"coordinates":[{"ecosystem":"npm","package":"pkg","version":"1.0.0"}],"schemaVersion":1}'),
  ]) { const { registry, privateCas } = fixture(); await assert.rejects(registry.verifyWebhook('fixture.secure', request({ raw })), (error) => error.code === 'provider_hint_invalid'); assert.equal(privateCas.calls.length, 0); }
  const privateCas = cas({ put: { digest: '0'.repeat(64) } }); const { registry } = fixture({ privateCas });
  await assert.rejects(registry.verifyWebhook('fixture.secure', request()), (error) => error.code === 'provider_cas_invalid');
});

test('AF2/AF10: private CAS byte substitution is detected during zero-network receipt replay', async () => {
  const privateCas = cas(); const { registry } = fixture({ privateCas }); const receipt = await registry.verifyWebhook('fixture.secure', request());
  privateCas.values.set(receipt.rawDigest, Buffer.from('substituted'));
  await assert.rejects(registry.reverifyReceipt(receipt), (error) => error.code === 'provider_cas_invalid');
});

test('AF2/AF3: Coordinator native webhook ingress durably fences before acknowledging and exact retry is zero-append', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-native-webhook-')); const repoRoot = join(root, 'repo'); mkdirSync(repoRoot); execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  const { source } = sourceFixture(); const driver = createDriver({ repoRoot, repoId: 'repo-a', logDir: join(root, 'log'), adapters: {}, now, advisoryFeedSources: { 'fixture.secure': source } });
  await assert.rejects(driver.coordinator.receiveProviderWebhook('fixture.secure', request(), { actor: 'operator:alice' }), (error) => error.code === 'provider_delivery_invalid');
  const admitted = await driver.coordinator.receiveProviderWebhook('fixture.secure', request()); assert.equal(admitted.result, 'recorded'); assert.equal(driver.coordination.snapshot().provider.pendingCoordinateCount, 1);
  const retry = await driver.coordinator.receiveProviderWebhook('fixture.secure', request()); assert.equal(retry.result, 'idempotent'); assert.equal(driver.coordination.snapshot().lastSeq, 1);
  driver.close();
});
