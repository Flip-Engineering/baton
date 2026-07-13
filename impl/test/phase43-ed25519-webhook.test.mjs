import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { AdvisoryFeedRegistry, Ed25519AdvisoryWebhookSource, signEd25519AdvisoryWebhookForTest } from '../src/index.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const keys = generateKeyPairSync('ed25519'); const other = generateKeyPairSync('ed25519');
const occurredAt = '2026-07-13T05:00:00.000Z'; const now = () => Date.parse('2026-07-13T05:00:01.000Z');
const body = Buffer.from('{"advisoryIds":["OSV-2026-ED"],"coordinates":[{"ecosystem":"npm","package":"@scope/ed","version":"2.0.0"}],"schemaVersion":1}');
function cas() { const values = new Map(); return { storeId: 'ed-cas-v1', values, async put(raw) { const digest = sha(raw); values.set(digest, Buffer.from(raw)); return { storeId: 'ed-cas-v1', digest, bytes: raw.length }; }, async get(digest) { return Buffer.from(values.get(digest)); }, getSync(digest) { return Buffer.from(values.get(digest)); } }; }
function source(publicKey = keys.publicKey, extra = {}) { return new Ed25519AdvisoryWebhookSource({ providerId: 'fixture.ed', adapterId: 'baton-ed25519-json-v1', version: '1', publicKey,
  callback: { method: 'POST', path: '/machine/providers/fixture.ed' }, privateCas: extra.privateCas ?? cas(), now,
  ceilings: { maxDeliveryBytes: 1024, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 128, maxHeaderCount: 8, maxHeaderBytes: 1024, maxClockSkewMs: 60_000 }, ...(extra.keyFingerprint ? { keyFingerprint: extra.keyFingerprint } : {}) }); }
function request(overrides = {}) { const raw = overrides.raw ?? body; const method = 'POST'; const path = '/machine/providers/fixture.ed'; const deliveryId = 'delivery-ed';
  const signature = overrides.signature ?? signEd25519AdvisoryWebhookForTest(overrides.privateKey ?? keys.privateKey, { method, path, occurredAt, deliveryId, raw: overrides.signedRaw ?? raw });
  return { method, path, raw, rawHeaders: [['content-type', 'application/json'], ['content-encoding', 'identity'], ['x-baton-signature', signature], ['x-baton-delivery-id', deliveryId], ['x-baton-timestamp', occurredAt], ['x-baton-sequence', '7']] }; }

test('AF1/AF2: Ed25519 card derives the pinned SPKI fingerprint and exact wire receipt replays from CAS', async () => {
  const configured = source(); const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.ed': configured } }); const card = registry.cards()[0];
  const expected = sha(keys.publicKey.export({ type: 'spki', format: 'der' })); assert.equal(card.auth.scheme, 'ed25519'); assert.equal(card.auth.signatureEncoding, 'base64'); assert.deepEqual(card.auth.keyFingerprints, [expected]);
  assert.equal(JSON.stringify(card).includes('PRIVATE KEY'), false);
  const receipt = await registry.verifyWebhook('fixture.ed', request()); assert.equal(receipt.keyFingerprint, expected); assert.equal(receipt.rawDigest, sha(body));
  assert.equal((await registry.reverifyReceipt(receipt)).contentDigest, receipt.contentDigest);
});

test('AF2: wrong key, body substitution, malformed/noncanonical signature, and fingerprint disagreement fail closed', async () => {
  const valid = request().rawHeaders[2][1];
  for (const input of [
    request({ privateKey: other.privateKey }),
    request({ raw: Buffer.from(`${body} `), signedRaw: body }),
    request({ signature: Buffer.alloc(64).toString('base64').replace(/=$/, '') }),
    request({ signature: `${valid}=` }),
    request({ signature: valid.slice(0, -2) }),
    request({ signature: `${valid}\n` }),
    request({ signature: `-${valid.slice(1)}` }),
    request({ signature: 'not-base64!' }),
  ]) { const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.ed': source() } }); await assert.rejects(registry.verifyWebhook('fixture.ed', input), (error) => ['provider_auth_invalid', 'provider_delivery_invalid'].includes(error.code)); }
  assert.throws(() => source(keys.publicKey, { keyFingerprint: '0'.repeat(64) }), /fingerprint disagrees/);
});

test('AF2: source epoch/key rotation cannot authenticate an old-key delivery under the new public key', async () => {
  const privateCas = cas(); const oldRegistry = new AdvisoryFeedRegistry({ sources: { 'fixture.ed': source(keys.publicKey, { privateCas }) } }); const old = await oldRegistry.verifyWebhook('fixture.ed', request());
  const rotated = new AdvisoryFeedRegistry({ sources: { 'fixture.ed': source(other.publicKey, { privateCas }) } }); assert.notEqual(rotated.cards()[0].cardDigest, old.cardDigest);
  await assert.rejects(rotated.verifyWebhook('fixture.ed', request()), (error) => error.code === 'provider_auth_invalid');
  await assert.rejects(rotated.reverifyReceipt(old), (error) => ['provider_auth_receipt_invalid', 'provider_receipt_invalid'].includes(error.code));
});
