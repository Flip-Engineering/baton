// #598: the advisory provider ingress leaves the tree, and the checkpoint authority digest it fed
// changes with it. A build that still had the feed cards, the two private-CAS reverify seams and the
// provider attempt policy derived those four inputs into its authority digest; every checkpoint it
// wrote therefore records a digest this build does not derive. That mismatch is recorded history,
// never corruption: the envelope is proven intact from its own bytes, the ledger replays in full,
// and the open refreshes the cache under this build's authority.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { canonicalDigest } from '../src/coordination-internals.mjs';

const actor = 'test:issue598-provider';
const CHECKPOINT = 'projection.checkpoint';

/** The four authority inputs the pre-#598 build derived beside the policies that remain
 * (`coordination-ledger-writes.mjs`). A build without them derives a different digest. */
const REMOVED_AUTHORITY_INPUTS = Object.freeze({
  advisoryFeedCards: [], advisoryReceiptReverify: false, advisoryPollReverify: false, providerAttemptPolicy: null,
});

/** The authority digest the pre-#598 build recorded, rebuilt from the store's own policy state. */
function pre598AuthorityDigest(store) {
  return canonicalDigest({
    schemaVersion: 1,
    repoId: store._repoId,
    ...REMOVED_AUTHORITY_INPUTS,
    canonicalOrderPolicy: store._canonicalOrderPolicy,
    routePolicy: store._routePolicy,
    representationPolicy: store._representationPolicy,
    goalPlanPolicy: store._goalPlanPolicy,
    workflowPolicy: store._workflowPolicy,
    taskTopologyPolicy: store._taskTopologyPolicy,
    runLineagePolicy: store._runLineagePolicy,
    deploymentBaseSha: store._deploymentBaseSha,
  });
}

/** Read the checkpoint envelope. v8's deserialize loses Buffer-ness, so the cached projection bytes
 * are re-copied into a Buffer the way the writer stored them. */
function readEnvelope(directory) {
  const envelope = deserialize(readFileSync(join(directory, CHECKPOINT)));
  envelope.projectionBytes = Buffer.from(envelope.projectionBytes);
  return envelope;
}

test('P598-CP1: a checkpoint written with the feed-card input replays under the build without it', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue598-checkpoint-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  for (let index = 1; index <= 16; index += 1) {
    first.recordDriver('issue598.fixture', { index }, { actor, key: `issue598:row:${index}` });
  }
  first.releaseWriterLease({ requireOwned: true });

  const removedDigest = pre598AuthorityDigest(first);
  assert.notEqual(removedDigest, first._checkpointAuthorityDigest,
    'the feed cards, the reverify seams and the provider attempt policy left the authority digest');

  // Plant the digest the pre-#598 build recorded. Every other byte of the envelope is untouched, so
  // the restore still has to prove the prefix, projection and tail anchor before it judges the
  // authority at all.
  const envelope = readEnvelope(directory);
  assert.equal(envelope.coversSeq, 16, 'the checkpoint claims the 16 rows it covers');
  envelope.authorityDigest = removedDigest;
  const planted = serialize(envelope);
  writeFileSync(join(directory, CHECKPOINT), planted, { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'stale_authority',
    'a proven checkpoint under the pre-#598 authority digest is its own state, never corrupt');
  assert.equal(status.source, 'ledger_fallback', 'the ledger is authoritative for the full replay');
  assert.equal(status.checkpointReason, 'authority_digest');
  assert.equal(status.checkpointEvents, 0, 'nothing is adopted from the other build\'s fold');
  assert.equal(status.replayedEvents, 16, 'every retained row replays and folds');
  assert.equal(reopened.snapshot().lastSeq, 16);

  // The open rewrites the cache under this build's authority, so the next open is valid again.
  assert.equal(status.checkpointRewrite?.state, 'written');
  assert.equal(status.checkpointRewrite?.reason, 'stale_authority_rewrite');
  const again = new CoordinationStore(directory);
  assert.equal(again.startupStatus().checkpoint, 'valid',
    'the refreshed cache carries this build\'s authority digest');
  assert.equal(again.snapshot().lastSeq, 16);
  again.releaseWriterLease({ requireOwned: true });

  // A cold replay of the same ledger serves exactly the state the fallback served: the retained
  // records are read back, not lost with the cache.
  rmSync(join(directory, CHECKPOINT), { force: true });
  const cold = new CoordinationStore(directory);
  assert.deepEqual(reopened.snapshot(), cold.snapshot(),
    'the fallback replays the ledger to the state a cold open derives');
  reopened.releaseWriterLease({ requireOwned: true });
  cold.releaseWriterLease({ requireOwned: true });
});
