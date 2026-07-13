import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { AdvisoryFeedRegistry, HttpsHmacAdvisoryFeedSource, signHmacAdvisoryPollPageForTest } from '../src/index.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const stable = (value) => JSON.stringify(canonical(value));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const secret = Buffer.alloc(32, 43); const keyFingerprint = sha(Buffer.from('phase43-https-poll-key')); const occurredAt = '2026-07-13T08:00:00.000Z';
const coordinate = { ecosystem: 'npm', package: '@scope/https-poll', version: '1.2.3' };

function source(overrides = {}) {
  const bytes = new Map(); const privateCas = { storeId: 'https-poll-private-cas', async put(raw, expected) { bytes.set(expected.digest, Buffer.from(raw)); return { storeId: this.storeId, digest: expected.digest, bytes: raw.length }; }, async get(digest) { return bytes.get(digest); }, getSync(digest) { return bytes.get(digest); } };
  return new HttpsHmacAdvisoryFeedSource({
    providerId: 'fixture.https', adapterId: 'fixture-https-v1', version: '1', secret, keyFingerprint,
    callback: { method: 'POST', path: '/v1/webhook' }, privateCas, authorization: 'Bearer private-fixture-token',
    ceilings: { maxDeliveryBytes: 4096, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256, maxHeaderCount: 32, maxHeaderBytes: 8192, maxClockSkewMs: 300_000 },
    poll: { origin: 'https://provider.example', operation: '/v1/full', initialSequence: 1, maxPages: 2, maxItems: 4, maxPageBytes: 4096, maxTotalBytes: 16_384, maxWallMs: 1000, maxBackoffMs: 1000, maxClockSkewMs: 300_000 },
    now: () => Date.parse('2026-07-13T08:00:01.000Z'), ...overrides,
  });
}

function wire(options = {}) {
  let calls = 0;
  const hint = Buffer.from(stable({ schemaVersion: 1, coordinates: [coordinate], advisoryIds: ['OSV-HTTPS-1'] }));
  const request = async (url, init) => {
    assert.equal(String(url), 'https://provider.example/v1/full'); assert.equal(init.headers.authorization, 'Bearer private-fixture-token'); assert.equal(init.headers.accept, 'application/json');
    const pageIndex = calls++; const requestCursor = pageIndex === 0 ? '1' : 'request-cursor-2'; assert.equal(init.headers['x-baton-cursor'], requestCursor); assert.equal(init.headers['x-baton-page-index'], String(pageIndex));
    if (options.redirect) return { status: 302, rawHeaders: [], raw: Buffer.from('redirect') };
    const rows = pageIndex === 0 ? [1, 2] : [3]; const items = rows.map((sequence) => ({ deliveryId: `delivery-${sequence}`, occurredAt, sequence, raw: hint.toString('base64') })); const raw = Buffer.from(stable({ schemaVersion: 1, items }));
    const cursor = pageIndex === 0 ? 'cursor-page-1' : 'cursor-final'; const nextCursor = pageIndex === 0 ? 'request-cursor-2' : null;
    const fields = { operation: '/v1/full', pollId: 'poll-live-1', observedAt: occurredAt, pageIndex, finalSequence: 3, requestCursorDigest: sha(requestCursor), cursorDigest: sha(cursor), nextCursorDigest: nextCursor === null ? null : sha(nextCursor), raw };
    const signature = options.badSignature ? '0'.repeat(64) : signHmacAdvisoryPollPageForTest(secret, fields);
    const rawHeaders = [['content-type', 'application/json'], ['content-encoding', 'identity'], ['x-baton-poll-id', 'poll-live-1'], ['x-baton-observed-at', occurredAt], ['x-baton-final-sequence', '3'], ['x-baton-cursor', cursor], ['x-baton-poll-signature', signature], ...(nextCursor ? [['x-baton-next-cursor', nextCursor]] : [])];
    return { status: 200, rawHeaders, raw };
  };
  return { request, hint, calls: () => calls };
}

test('PF8: fixed HTTPS HMAC paging yields ordinary dedupable receipts and zero-network replay', async () => {
  const transport = wire(); const feed = source({ request: transport.request }); const registry = new AdvisoryFeedRegistry({ sources: { 'fixture.https': feed } }); const card = registry.cards()[0];
  const result = await registry.pollFull('fixture.https'); assert.equal(transport.calls(), 2); assert.equal(result.receipts.length, 3); assert.deepEqual(result.receipts.map((row) => row.sequence), [1, 2, 3]); assert.equal(new Set(result.receipts.map((row) => row.rawDigest)).size, 1, 'the same webhook hint bytes remain byte-identical across poll deliveries');
  assert.equal(result.proof.pageDigests.length, 2); assert.equal(result.proof.finalSequence, 3); assert.equal(result.proof.cursorDigest, sha('cursor-final')); assert.deepEqual(registry.reverifyPollSync(result.proof), result.proof); assert.equal(transport.calls(), 2, 'proof replay is zero-network');
  for (const receipt of result.receipts) assert.deepEqual(registry.reverifyReceiptSync(receipt), receipt);
  const publicBytes = JSON.stringify({ card, result }); for (const forbidden of ['private-fixture-token', 'request-cursor-2', 'cursor-final', secret.toString('hex'), 'x-baton-poll-signature']) assert.equal(publicBytes.includes(forbidden), false, forbidden);
  await assert.rejects(registry.verify('fixture.https', { mode: 'poll', raw: transport.hint }), (error) => error.code === 'provider_auth_invalid', 'poll item authority is one-call private and cannot be replayed through machine ingress');
});

test('PF8: redirects and page-authentication substitution fail before any receipt is exposed', async () => {
  const redirected = wire({ redirect: true }); const redirectRegistry = new AdvisoryFeedRegistry({ sources: { 'fixture.https': source({ request: redirected.request }) } }); await assert.rejects(redirectRegistry.pollFull('fixture.https'), (error) => error.code === 'provider_poll_redirect');
  const bad = wire({ badSignature: true }); const badRegistry = new AdvisoryFeedRegistry({ sources: { 'fixture.https': source({ request: bad.request }) } }); await assert.rejects(badRegistry.pollFull('fixture.https'), (error) => error.code === 'provider_auth_invalid');
});
