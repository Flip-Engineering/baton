import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { AdvisoryFeedRegistry, CoordinationStore, createDriver } from '../src/index.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const sha = (value) => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const fingerprint = sha(Buffer.from('phase43-provider-key'));
const coordinate = Object.freeze({ ecosystem: 'npm', package: '@scope/pkg', version: '1.2.3' });

function feedSource() {
  const card = Object.freeze({
    schemaVersion: 1, providerId: 'fixture.osv', adapterId: 'fixture-v1', version: '1', modes: ['webhook'], ecosystem: 'npm', semantics: 'authenticated_hint',
    auth: { scheme: 'injected-test', keyFingerprints: [fingerprint] }, ceilings: { maxDeliveryBytes: 4096, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256 },
  });
  return {
    card: () => card,
    async verifyDelivery({ raw }) {
      const body = JSON.parse(raw); const rawDigest = sha(raw);
      return {
        schemaVersion: 1, providerId: 'fixture.osv', deliveryId: body.deliveryId, rawDigest, rawBytes: raw.length,
        authReceiptDigest: sha(Buffer.from(`auth:${body.deliveryId}`)), keyFingerprint: fingerprint, occurredAt: body.occurredAt, sequence: body.sequence,
        coordinates: [coordinate], advisoryIds: ['OSV-2026-43'], source: { handle: `art:sha256:${rawDigest}`, digest: rawDigest, bytes: raw.length, mediaType: 'application/json' },
      };
    },
  };
}
function registry() { return new AdvisoryFeedRegistry({ sources: { 'fixture.osv': feedSource() } }); }

async function verified(feeds, deliveryId, sequence, marker = deliveryId) {
  const raw = Buffer.from(JSON.stringify({ deliveryId, occurredAt: '2026-07-13T03:00:00.000Z', sequence, marker }));
  return feeds.verify('fixture.osv', { mode: 'webhook', raw });
}

test('AF3/AF4/AF6: receipt append atomically creates a sanitized Source and repo-scoped pending fence', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-receipt-'));
  const store = new CoordinationStore(root, { advisoryFeedCards: feeds.cards(), clock: () => '2026-07-13T03:00:01.000Z' });
  const receipt = await verified(feeds, 'delivery-1', 1);
  const result = store.recordProviderDelivery({ repoId: 'repo-a', receipt }, { actor: 'provider:fixture.osv', key: 'provider:delivery-1' });
  assert.equal(result.result, 'recorded'); assert.equal(result.processing.status, 'pending');
  assert.deepEqual(store.pendingProviderReconciliation('repo-a', coordinate).map((row) => row.id), [result.processing.id]);
  assert.deepEqual(store.pendingProviderReconciliation('repo-b', coordinate), []);
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.provider, { receiptCount: 1, processingCount: 1, pendingCoordinateCount: 1 });
  const source = snapshot.knowledge.nodes.find((node) => node.id === result.receipt.nodeId);
  assert.equal(source.type, 'Source'); assert.equal(source.grounding, 'observed'); assert.equal(source.promotion.trigger, 'provider.delivery');
  assert.equal(JSON.stringify({ result, snapshot }).includes(receipt.source.handle), false, 'public projection must not expose the provider-private source handle');
  store.releaseWriterLease();
});

test('AF3/AF6: exact delivery retries are zero-append, conflicting bytes refuse, and semantic aliases share one pending work root', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-dedupe-'));
  const store = new CoordinationStore(root, { advisoryFeedCards: feeds.cards(), clock: () => '2026-07-13T03:00:01.000Z' });
  const first = await verified(feeds, 'delivery-1', 1); const admitted = store.recordProviderDelivery({ repoId: 'repo-a', receipt: first }, { actor: 'provider:fixture.osv', key: 'provider:first' });
  const seq = store.snapshot().lastSeq;
  const duplicate = store.recordProviderDelivery({ repoId: 'repo-a', receipt: first }, { actor: 'provider:fixture.osv', key: 'provider:retry' });
  assert.equal(duplicate.result, 'duplicate'); assert.equal(duplicate.receipt.id, admitted.receipt.id); assert.equal(store.snapshot().lastSeq, seq);
  const conflict = await verified(feeds, 'delivery-1', 1, 'different-authenticated-bytes');
  assert.throws(() => store.recordProviderDelivery({ repoId: 'repo-a', receipt: conflict }, { actor: 'provider:fixture.osv', key: 'provider:conflict' }), (error) => error.code === 'provider_delivery_conflict');
  const alias = await verified(feeds, 'delivery-2', 2, 'another-envelope');
  const aliased = store.recordProviderDelivery({ repoId: 'repo-a', receipt: alias }, { actor: 'provider:fixture.osv', key: 'provider:alias' });
  assert.equal(aliased.result, 'aliased'); assert.equal(aliased.processing.id, admitted.processing.id);
  assert.deepEqual(aliased.processing.receiptIds, [admitted.receipt.id, aliased.receipt.id]);
  assert.equal(store.snapshot().provider.pendingCoordinateCount, 1);
  store.releaseWriterLease();
});

test('AF3/AF6/AF7: replay requires the pinned source card and reconstructs receipt, pending, and causal projections', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-replay-'));
  const first = new CoordinationStore(root, { advisoryFeedCards: feeds.cards(), clock: () => '2026-07-13T03:00:01.000Z' });
  const admitted = first.recordProviderDelivery({ repoId: 'repo-a', receipt: await verified(feeds, 'delivery-1', 1) }, { actor: 'provider:fixture.osv', key: 'provider:first' });
  first.releaseWriterLease();
  const replay = new CoordinationStore(root, { advisoryFeedCards: feeds.cards(), clock: () => '2026-07-13T03:00:02.000Z' });
  assert.equal(replay.providerReceipt(admitted.receipt.id).id, admitted.receipt.id);
  assert.equal(replay.providerProcessing(admitted.processing.id).status, 'pending');
  assert.equal(replay.pendingProviderReconciliation('repo-a', coordinate).length, 1);
  replay.releaseWriterLease();
  assert.throws(() => new CoordinationStore(root), (error) => error.code === 'provider_card_required');
});

test('AF3/AF5: pending admission is serialized inside decision append validation for borrow and build', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-fence-'));
  const store = new CoordinationStore(root, { advisoryFeedCards: feeds.cards(), clock: () => '2026-07-13T03:00:01.000Z' });
  store.recordProviderDelivery({ repoId: 'repo-a', receipt: await verified(feeds, 'delivery-1', 1) }, { actor: 'provider:fixture.osv', key: 'provider:first' });
  for (const choice of ['borrow', 'build']) {
    assert.throws(() => store.recordReuseDecision({
      schemaVersion: 1, envRef: { repoId: 'repo-a', treeSha: 'aaaa', indexEpoch: '0'.repeat(64), lockfileDigest: '1'.repeat(64), overlayDigest: '2'.repeat(64) },
      choice, need: 'provider-fenced capability', rationale: 'must wait for official refresh', coordinate, affectedReadEvents: [],
    }, { actor: 'operator:alice', key: `reuse:${choice}` }), (error) => error.code === 'reuse_provider_pending');
  }
  assert.equal(store.snapshot().lastSeq, 1, 'refused decisions never append');
  store.releaseWriterLease();
});

test('AF2/AF3: Coordinator owns fixed-route machine ingress and acknowledges only after durable admission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-provider-driver-')); const repoRoot = join(root, 'repo'); mkdirSync(repoRoot);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  const driver = createDriver({ repoRoot, repoId: 'repo-a', logDir: join(root, 'log'), adapters: {}, now: () => Date.parse('2026-07-13T03:00:01.000Z'), advisoryFeedSources: { 'fixture.osv': feedSource() } });
  assert.equal(driver.coordinator.advisoryFeedCards()[0].providerId, 'fixture.osv');
  const raw = Buffer.from(JSON.stringify({ deliveryId: 'delivery-1', occurredAt: '2026-07-13T03:00:00.000Z', sequence: 1, marker: 'driver' }));
  await assert.rejects(driver.coordinator.receiveProviderDelivery('fixture.osv', { mode: 'webhook', raw }, { actor: 'operator:alice' }), (error) => error.code === 'provider_delivery_invalid');
  const admitted = await driver.coordinator.receiveProviderDelivery('fixture.osv', { mode: 'webhook', raw });
  assert.equal(admitted.result, 'recorded'); assert.equal(driver.coordination.snapshot().lastSeq, 1); assert.equal(driver.coordination.pendingProviderReconciliation('repo-a', coordinate).length, 1);
  const retry = await driver.coordinator.receiveProviderDelivery('fixture.osv', { mode: 'webhook', raw }); assert.equal(retry.result, 'idempotent'); assert.equal(driver.coordination.snapshot().lastSeq, 1);
  driver.close();
});

test('AF3/AF10: append failure exposes neither an acknowledged receipt nor a partial pending projection', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-append-failure-'));
  const store = new CoordinationStore(root, { advisoryFeedCards: feeds.cards(), clock: () => '2026-07-13T03:00:01.000Z', appendFile: () => { throw new Error('provider ledger unavailable'); } });
  const receipt = await verified(feeds, 'delivery-1', 1);
  assert.throws(() => store.recordProviderDelivery({ repoId: 'repo-a', receipt }, { actor: 'provider:fixture.osv', key: 'provider:first' }), /provider ledger unavailable/);
  assert.deepEqual(store.snapshot().provider, { receiptCount: 0, processingCount: 0, pendingCoordinateCount: 0 }); assert.equal(store.snapshot().lastSeq, 0);
  store.releaseWriterLease();
});
