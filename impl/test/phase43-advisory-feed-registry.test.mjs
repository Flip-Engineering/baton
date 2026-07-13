import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { AdvisoryFeedRegistry } from '../src/index.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = sha('phase43-test-key');
const card = (overrides = {}) => ({
  schemaVersion: 1, providerId: 'fixture.osv', adapterId: 'fixture-hmac-v1', version: '1', modes: ['poll', 'webhook'], ecosystem: 'npm', semantics: 'authenticated_hint',
  auth: { scheme: 'injected-test', keyFingerprints: [fingerprint] }, ceilings: { maxDeliveryBytes: 1024, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256 }, ...overrides,
});
const receipt = (raw, overrides = {}) => ({
  schemaVersion: 1, providerId: 'fixture.osv', deliveryId: 'delivery-1', rawDigest: sha(raw), rawBytes: raw.length,
  authReceiptDigest: sha('authenticated-receipt'), keyFingerprint: fingerprint, occurredAt: '2026-07-13T02:00:00.000Z', sequence: 1,
  coordinates: [{ ecosystem: 'npm', package: '@scope/pkg', version: '1.2.3' }], advisoryIds: ['OSV-2026-1'],
  source: { handle: `art:sha256:${sha(raw)}`, digest: sha(raw), bytes: raw.length, mediaType: 'application/json' }, ...overrides,
});
function source(overrides = {}) {
  const calls = [];
  return { calls, card: () => card(overrides.card), async verifyDelivery(input, ctx) { calls.push({ input, ctx }); return receipt(input.raw, overrides.receipt); } };
}

test('AF1/AF2: registry pins a closed source card and returns only a secret-free authenticated-hint receipt', async () => {
  const adapter = source(); const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': adapter } }); const raw = Buffer.from('{"event":"candidate"}');
  const verified = await registry.verify('fixture.osv', { mode: 'webhook', raw }); const cards = registry.cards();
  assert.equal(cards.length, 1); assert.equal(cards[0].providerId, 'fixture.osv'); assert.match(cards[0].cardDigest, /^[a-f0-9]{64}$/);
  assert.equal(verified.sourceEpoch, cards[0].cardDigest); assert.equal(verified.cardDigest, cards[0].cardDigest); assert.equal(verified.rawDigest, sha(raw)); assert.match(verified.contentDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(verified).sort(), ['advisoryIds', 'authReceiptDigest', 'cardDigest', 'contentDigest', 'coordinates', 'deliveryId', 'keyFingerprint', 'mode', 'occurredAt', 'providerId', 'rawBytes', 'rawDigest', 'schemaVersion', 'sequence', 'source', 'sourceEpoch'].sort());
  assert.equal(JSON.stringify(verified).includes(raw.toString()), false); assert.equal(JSON.stringify(verified).includes('secret'), false);
  assert.equal(adapter.calls.length, 1); assert.notEqual(adapter.calls[0].input.raw, raw, 'adapter receives an immutable copy, not caller-owned bytes');
});

test('AF1/AF2: malformed deployment cards fail before source authority exists', () => {
  for (const invalid of [
    { modes: ['webhook', 'webhook'] },
    { semantics: 'adverse_verdict' },
    { auth: { scheme: 'body-selected-jwk', keyFingerprints: [fingerprint] } },
    { auth: { scheme: 'hmac-sha256', keyFingerprints: ['secret'] } },
    { ceilings: { maxDeliveryBytes: 0, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256 } },
  ]) assert.throws(() => new AdvisoryFeedRegistry({ sources: { 'fixture.osv': source({ card: invalid }) } }), /invalid advisory feed card/);
});

test('AF2/AF10: envelope ceilings and unknown providers refuse before adapter authentication work', async () => {
  const adapter = source(); const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': adapter } });
  await assert.rejects(registry.verify('missing', { mode: 'webhook', raw: Buffer.from('{}') }), (error) => error.code === 'provider_not_configured');
  await assert.rejects(registry.verify('fixture.osv', { mode: 'webhook', raw: Buffer.alloc(1025) }), (error) => error.code === 'provider_delivery_invalid');
  await assert.rejects(registry.verify('fixture.osv', { mode: 'push', raw: Buffer.from('{}') }), (error) => error.code === 'provider_delivery_invalid');
  assert.equal(adapter.calls.length, 0);
});

test('AF2/AF7/AF10: adapter output cannot forge source bytes, key identity, coordinate order, or advisory identity', async () => {
  const raw = Buffer.from('{"event":"candidate"}');
  const cases = [
    { rawDigest: '0'.repeat(64) },
    { keyFingerprint: sha('other-key') },
    { coordinates: [{ ecosystem: 'npm', package: '@scope/pkg', version: 'latest' }] },
    { coordinates: [{ ecosystem: 'npm', package: 'z', version: '1.0.0' }, { ecosystem: 'npm', package: 'a', version: '1.0.0' }] },
    { advisoryIds: ['OSV-2', 'OSV-1'] },
    { source: { handle: `art:sha256:${sha(raw)}`, digest: sha(raw), bytes: raw.length, mediaType: 'text/plain' } },
  ];
  for (const forged of cases) {
    const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': source({ receipt: forged }) } });
    await assert.rejects(registry.verify('fixture.osv', { mode: 'webhook', raw }), (error) => error.code === 'provider_receipt_invalid');
  }
});
