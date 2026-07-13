import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function feedSource(state = {}) {
  const card = Object.freeze({
    schemaVersion: 1, providerId: 'fixture.osv', adapterId: 'fixture-v1', version: '1', modes: ['poll', 'webhook'], ecosystem: 'npm', semantics: 'authenticated_hint',
    auth: { scheme: 'injected-test', keyFingerprints: [fingerprint] }, ceilings: { maxDeliveryBytes: 4096, maxCoordinates: 4, maxAdvisoryIds: 8, maxIdentityBytes: 256 },
    poll: { origin: 'https://fixture.invalid', operation: '/v1/full', cursorKind: 'sequence', initialSequence: 1, redirects: 'deny', maxPages: 2, maxItems: 8, maxPageBytes: 4096, maxTotalBytes: 16384, maxWallMs: 1000, maxBackoffMs: 1000, maxClockSkewMs: 300_000 },
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
    }, async pollFull() { if (!state.poll) throw Object.assign(new Error('poll fixture absent'), { code: 'fixture_poll_absent' }); return state.poll; }, reverifyPollSync(proof) { return proof; },
  };
}
function registry(state) { return new AdvisoryFeedRegistry({ sources: { 'fixture.osv': feedSource(state) } }); }

async function verified(feeds, deliveryId, sequence, marker = deliveryId) {
  const raw = Buffer.from(JSON.stringify({ deliveryId, occurredAt: '2026-07-13T03:00:00.000Z', sequence, marker }));
  return feeds.verify('fixture.osv', { mode: 'webhook', raw });
}

async function pollWorld() {
  const raw = (sequence) => Buffer.from(JSON.stringify({ deliveryId: `delivery-${sequence}`, occurredAt: '2026-07-13T03:00:00.000Z', sequence, marker: `delivery-${sequence}` })); const state = {}; const feeds = registry(state); const cards = feeds.cards(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-poll-world-'));
  const store = new CoordinationStore(root, { advisoryFeedCards: cards, advisoryPollReverify: (proof) => feeds.reverifyPollSync(proof), clock: () => '2026-07-13T04:00:01.000Z' });
  for (const sequence of [1, 3]) store.recordProviderDelivery({ repoId: 'repo-a', receipt: await feeds.verify('fixture.osv', { mode: 'webhook', raw: raw(sequence) }) }, { actor: 'provider:fixture.osv', key: `provider:pre:${sequence}` });
  const itemBytes = [1, 2, 3].map(raw); state.poll = { schemaVersion: 1, providerId: 'fixture.osv', pollId: 'full-1', observedAt: '2026-07-13T04:00:00.000Z', window: { fromSequence: 1, toSequence: 3 }, finalSequence: 3, cursorDigest: sha('cursor-3'), authReceiptDigest: sha('poll-auth'), keyFingerprint: fingerprint, pages: [{ raw: Buffer.from('{"page":1}'), items: itemBytes }] };
  const polled = await feeds.pollFull('fixture.osv'); for (const receipt of polled.receipts) store.recordProviderDelivery({ repoId: 'repo-a', receipt }, { actor: 'provider:fixture.osv', key: `provider:poll:${receipt.sequence}` });
  return { raw, state, feeds, cards, root, store, polled };
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

test('AF7: sequence gaps and late unseen deliveries remain admitted but health stays reconciliation-required', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-sequence-')); const cards = feeds.cards();
  const store = new CoordinationStore(root, { advisoryFeedCards: cards, clock: () => '2026-07-13T03:00:01.000Z' });
  store.recordProviderDelivery({ repoId: 'repo-a', receipt: await verified(feeds, 'delivery-1', 1) }, { actor: 'provider:fixture.osv', key: 'provider:seq:1' });
  store.recordProviderDelivery({ repoId: 'repo-a', receipt: await verified(feeds, 'delivery-3', 3) }, { actor: 'provider:fixture.osv', key: 'provider:seq:3' });
  assert.deepEqual(store.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest), { repoId: 'repo-a', providerId: 'fixture.osv', sourceEpoch: cards[0].cardDigest, status: 'reconciliation_required', highSequence: 3, firstGap: { from: 2, to: 2 }, lastEvent: 2 });
  store.recordProviderDelivery({ repoId: 'repo-a', receipt: await verified(feeds, 'delivery-2', 2) }, { actor: 'provider:fixture.osv', key: 'provider:seq:2' });
  assert.equal(store.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest).status, 'reconciliation_required', 'late fill cannot silently assert source health');
  store.releaseWriterLease();
  const replay = new CoordinationStore(root, { advisoryFeedCards: cards, clock: () => '2026-07-13T03:00:02.000Z' }); assert.equal(replay.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest).highSequence, 3); replay.releaseWriterLease();
});

test('AF7: one provider sequence cannot be rebound to different authenticated bytes', async () => {
  const feeds = registry(); const root = mkdtempSync(join(tmpdir(), 'baton-provider-sequence-conflict-')); const cards = feeds.cards();
  const store = new CoordinationStore(root, { advisoryFeedCards: cards, clock: () => '2026-07-13T03:00:01.000Z' });
  store.recordProviderDelivery({ repoId: 'repo-a', receipt: await verified(feeds, 'delivery-1', 1, 'first') }, { actor: 'provider:fixture.osv', key: 'provider:first' });
  const sequenceConflict = await verified(feeds, 'delivery-other', 1, 'different-authenticated-content');
  assert.throws(() => store.recordProviderDelivery({ repoId: 'repo-a', receipt: sequenceConflict }, { actor: 'provider:fixture.osv', key: 'provider:conflict' }), (error) => error.code === 'provider_sequence_conflict');
  assert.equal(store.snapshot().lastSeq, 1);
  store.releaseWriterLease();
});

test('PF3-PF5: only an explicit replayable full-poll transaction restores degraded source health', async () => {
  const { raw, feeds, cards, root, store, polled } = await pollWorld(); assert.equal(store.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest).status, 'reconciliation_required');
  const expectedHealthEvent = store.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest).lastEvent; const completed = store.recordProviderSourceReconciliation({ repoId: 'repo-a', proof: polled.proof, expectedHealthEvent }, { actor: 'provider-poller:fixture.osv', key: `provider-poll:${polled.proof.proofDigest}` });
  assert.equal(completed.result, 'healthy'); assert.equal(completed.health.status, 'healthy'); assert.equal(completed.health.cursorDigest, polled.proof.cursorDigest); assert.equal(completed.health.firstGap, null); assert.equal(store.pendingProviderReconciliation('repo-a', coordinate).length > 0, true, 'source completeness cannot clear official-processing work');
  const seq = store.snapshot().lastSeq; assert.equal(store.recordProviderSourceReconciliation({ repoId: 'repo-a', proof: polled.proof, expectedHealthEvent }, { actor: 'provider-poller:fixture.osv', key: `provider-poll:${polled.proof.proofDigest}` }).result, 'idempotent'); assert.equal(store.snapshot().lastSeq, seq); store.releaseWriterLease();
  const replay = new CoordinationStore(root, { advisoryFeedCards: cards, advisoryPollReverify: (proof) => feeds.reverifyPollSync(proof), clock: () => '2026-07-13T04:00:02.000Z' }); assert.equal(replay.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest).status, 'healthy');
  replay.recordProviderDelivery({ repoId: 'repo-a', receipt: await feeds.verify('fixture.osv', { mode: 'webhook', raw: raw(5) }) }, { actor: 'provider:fixture.osv', key: 'provider:after:5' }); assert.equal(replay.providerSourceHealth('repo-a', 'fixture.osv', cards[0].cardDigest).status, 'reconciliation_required'); replay.releaseWriterLease();
});

test('PF3-PF5: a newer receipt CAS or completion append failure cannot expose healthy state', async () => {
  const stale = await pollWorld(); const expected = stale.store.providerSourceHealth('repo-a', 'fixture.osv', stale.cards[0].cardDigest).lastEvent; stale.store.recordProviderDelivery({ repoId: 'repo-a', receipt: await stale.feeds.verify('fixture.osv', { mode: 'webhook', raw: stale.raw(4) }) }, { actor: 'provider:fixture.osv', key: 'provider:race:4' }); assert.throws(() => stale.store.recordProviderSourceReconciliation({ repoId: 'repo-a', proof: stale.polled.proof, expectedHealthEvent: expected }, { actor: 'provider-poller:fixture.osv', key: 'provider-poll:stale' }), (error) => error.code === 'provider_reconciliation_stale'); assert.equal(stale.store.providerSourceHealth('repo-a', 'fixture.osv', stale.cards[0].cardDigest).status, 'reconciliation_required'); stale.store.releaseWriterLease();
  const failed = await pollWorld(); const append = failed.store._appendFile; failed.store._appendFile = (...args) => { if (String(args[1]).includes('provider.reconciliation_completed')) throw new Error('poll ledger unavailable'); return append(...args); }; const failedExpected = failed.store.providerSourceHealth('repo-a', 'fixture.osv', failed.cards[0].cardDigest).lastEvent; assert.throws(() => failed.store.recordProviderSourceReconciliation({ repoId: 'repo-a', proof: failed.polled.proof, expectedHealthEvent: failedExpected }, { actor: 'provider-poller:fixture.osv', key: 'provider-poll:append-fail' }), /poll ledger unavailable/); assert.equal(failed.store.providerSourceHealth('repo-a', 'fixture.osv', failed.cards[0].cardDigest).status, 'reconciliation_required'); failed.store._appendFile = append; failed.store.releaseWriterLease();
});

test('PF4/PF5: a poll observed before the degraded-health event cannot restore source health', async () => {
  const w = await pollWorld();
  const expectedHealthEvent = w.store.providerSourceHealth('repo-a', 'fixture.osv', w.cards[0].cardDigest).lastEvent;
  const core = { ...w.polled.proof, observedAt: '2026-07-13T02:00:00.000Z' }; delete core.proofDigest;
  const staleProof = { ...core, proofDigest: sha(core) };
  assert.throws(
    () => w.store.recordProviderSourceReconciliation(
      { repoId: 'repo-a', proof: staleProof, expectedHealthEvent },
      { actor: 'provider-poller:fixture.osv', key: 'provider-poll:predates-gap' },
    ),
    (error) => error.code === 'provider_reconciliation_stale',
  );
  assert.equal(w.store.providerSourceHealth('repo-a', 'fixture.osv', w.cards[0].cardDigest).status, 'reconciliation_required');
  w.store.releaseWriterLease();
});

test('PF5: zero-network replay rejects poll proof/cursor mutation and requires poll reverify authority', async () => {
  const w = await pollWorld(); const expected = w.store.providerSourceHealth('repo-a', 'fixture.osv', w.cards[0].cardDigest).lastEvent; w.store.recordProviderSourceReconciliation({ repoId: 'repo-a', proof: w.polled.proof, expectedHealthEvent: expected }, { actor: 'provider-poller:fixture.osv', key: 'provider-poll:complete' }); w.store.releaseWriterLease();
  assert.throws(() => new CoordinationStore(w.root, { advisoryFeedCards: w.cards, clock: () => '2026-07-13T04:00:02.000Z' }), (error) => error.code === 'provider_poll_replay_required'); const path = join(w.root, 'events.jsonl'); const events = readFileSync(path, 'utf8').trimEnd().split('\n').map(JSON.parse); events.find((event) => event.kind === 'provider.reconciliation_completed').payload.proof.cursorDigest = 'f'.repeat(64); writeFileSync(path, `${events.map(JSON.stringify).join('\n')}\n`); assert.throws(() => new CoordinationStore(w.root, { advisoryFeedCards: w.cards, advisoryPollReverify: (proof) => w.feeds.reverifyPollSync(proof), clock: () => '2026-07-13T04:00:02.000Z' }), (error) => ['provider_reconciliation_integrity', 'provider_poll_invalid'].includes(error.code));
});
