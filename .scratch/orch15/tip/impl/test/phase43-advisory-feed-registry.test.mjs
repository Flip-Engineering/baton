import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { AdvisoryFeedRegistry } from '../src/index.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = sha('phase43-test-key');
const card = (overrides = {}) => ({
  schemaVersion: 1, providerId: 'fixture.osv', adapterId: 'fixture-hmac-v1', version: '1', modes: ['poll', 'webhook'], ecosystem: 'npm', semantics: 'authenticated_hint',
  auth: { scheme: 'injected-test', keyFingerprints: [fingerprint] }, ceilings: { maxDeliveryBytes: 1024, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256 },
  poll: { origin: 'https://fixture.invalid', operation: '/v1/full', cursorKind: 'sequence', initialSequence: 1, redirects: 'deny', maxPages: 2, maxItems: 4, maxPageBytes: 1024, maxTotalBytes: 2048, maxWallMs: 1000, maxBackoffMs: 1000, maxClockSkewMs: 300_000 }, ...overrides,
});
const receipt = (raw, overrides = {}) => ({
  schemaVersion: 1, providerId: 'fixture.osv', deliveryId: 'delivery-1', rawDigest: sha(raw), rawBytes: raw.length,
  authReceiptDigest: sha('authenticated-receipt'), keyFingerprint: fingerprint, occurredAt: '2026-07-13T02:00:00.000Z', sequence: 1,
  coordinates: [{ ecosystem: 'npm', package: '@scope/pkg', version: '1.2.3' }], advisoryIds: ['OSV-2026-1'],
  source: { handle: `art:sha256:${sha(raw)}`, digest: sha(raw), bytes: raw.length, mediaType: 'application/json' }, ...overrides,
});
function source(overrides = {}) {
  const calls = [];
  return { calls, card: () => card(overrides.card), async verifyDelivery(input, ctx) { calls.push({ input, ctx }); return receipt(input.raw, overrides.receipt); }, async pollFull(ctx) { calls.push({ poll: true, ctx }); return overrides.poll; }, reverifyPollSync(proof) { calls.push({ reverifyPoll: true, proof }); return proof; } };
}

test('AF1/AF2: registry pins a closed source card and returns only a secret-free authenticated-hint receipt', async () => {
  const adapter = source(); const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': adapter } }); const raw = Buffer.from('{"event":"candidate"}');
  const verified = await registry.verify('fixture.osv', { mode: 'webhook', raw }); const cards = registry.cards();
  assert.equal(cards.length, 1); assert.equal(cards[0].providerId, 'fixture.osv'); assert.match(cards[0].cardDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(cards[0]), true); assert.equal(Object.isFrozen(cards[0].auth), true); assert.equal(Object.isFrozen(cards[0].auth.keyFingerprints), true); assert.equal(Object.isFrozen(cards[0].ceilings), true);
  assert.equal(verified.sourceEpoch, cards[0].cardDigest); assert.equal(verified.cardDigest, cards[0].cardDigest); assert.equal(verified.rawDigest, sha(raw)); assert.match(verified.contentDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(verified).sort(), ['advisoryIds', 'authReceiptDigest', 'cardDigest', 'contentDigest', 'coordinates', 'deliveryId', 'keyFingerprint', 'mode', 'occurredAt', 'providerId', 'rawBytes', 'rawDigest', 'schemaVersion', 'sequence', 'source', 'sourceEpoch'].sort());
  assert.equal(JSON.stringify(verified).includes(raw.toString()), false); assert.equal(JSON.stringify(verified).includes('secret'), false);
  assert.equal(adapter.calls.length, 1); assert.notEqual(adapter.calls[0].input.raw, raw, 'adapter receives an isolated copy, not caller-owned bytes');
});

test('AF2: an adapter cannot rewrite the preserved authenticated wire bytes before registry cross-check', async () => {
  const raw = Buffer.from('{"event":"candidate"}'); const originalDigest = sha(raw); const adapter = source();
  adapter.verifyDelivery = async (input, ctx) => {
    adapter.calls.push({ input, ctx }); input.raw.fill(0x20);
    return receipt(input.raw);
  };
  const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': adapter } });
  await assert.rejects(registry.verify('fixture.osv', { mode: 'webhook', raw }), (error) => error.code === 'provider_receipt_invalid');
  assert.equal(sha(raw), originalDigest, 'caller bytes remain unchanged too');
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

test('PF1/PF2: a bounded full poll returns only a sanitized authenticated proof and ordinary verified receipts', async () => {
  const items = [1, 2, 3].map((sequence) => Buffer.from(JSON.stringify({ sequence }))); const pageRaw = Buffer.from('{"window":"1-3"}'); const adapter = source();
  adapter.pollFull = async (ctx) => ({ schemaVersion: 1, providerId: 'fixture.osv', pollId: 'poll-1', observedAt: '2026-07-13T04:00:00.000Z', window: { fromSequence: 1, toSequence: 3 }, finalSequence: 3, cursorDigest: sha('opaque-cursor-3'), authReceiptDigest: sha('poll-auth'), keyFingerprint: fingerprint, pages: [{ raw: pageRaw, items }] });
  adapter.verifyDelivery = async ({ raw }) => { const { sequence } = JSON.parse(raw); return receipt(raw, { deliveryId: `delivery-${sequence}`, sequence, advisoryIds: [] }); };
  const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': adapter } }); const result = await registry.pollFull('fixture.osv');
  assert.deepEqual(result.receipts.map((row) => row.sequence), [1, 2, 3]); assert.equal(result.proof.finalSequence, 3); assert.equal(result.proof.pageDigests[0].digest, sha(pageRaw)); assert.deepEqual(result.proof.itemDigests, items.map(sha)); assert.match(result.proof.proofDigest, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(result); assert.equal(serialized.includes(pageRaw.toString()), false); assert.equal(items.some((raw) => serialized.includes(raw.toString())), false); assert.equal(serialized.includes('opaque-cursor-3'), false); assert.equal(registry.reverifyPollSync(result.proof).proofDigest, result.proof.proofDigest);
});

test('PF1/PF2: missing poll authority and page/item max+1 fail before exposing a partial proof', async () => {
  assert.throws(() => new AdvisoryFeedRegistry({ sources: { 'fixture.osv': { card: () => card(), verifyDelivery: async () => null } } }), /poll/);
  for (const pages of [
    [{ raw: Buffer.alloc(1025), items: [Buffer.from('{}')] }],
    [{ raw: Buffer.from('{}'), items: Array.from({ length: 5 }, () => Buffer.from('{}')) }],
    [{ raw: Buffer.alloc(1024), items: [Buffer.alloc(1024)] }, { raw: Buffer.alloc(1024), items: [Buffer.alloc(1)] }],
  ]) {
    const adapter = source({ poll: { schemaVersion: 1, providerId: 'fixture.osv', pollId: 'poll-over', observedAt: '2026-07-13T04:00:00.000Z', window: { fromSequence: 1, toSequence: 1 }, finalSequence: 1, cursorDigest: sha('cursor'), authReceiptDigest: sha('poll-auth'), keyFingerprint: fingerprint, pages } }); const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.osv': adapter } });
    await assert.rejects(registry.pollFull('fixture.osv'), (error) => error.code === 'provider_poll_oversize');
  }
});
