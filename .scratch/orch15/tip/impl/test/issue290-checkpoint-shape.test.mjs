// Issue #290 deliverable 4 (audit swarm-a giants E13): the checkpoint reader's size heuristic —
// which rejected compact()'s own valid checkpoint whenever the archived window shrank below the
// full-history idempotency map — is replaced by a derivation from the checkpoint's own recorded
// shape (its digests and seq counts). A size is never compared against a number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/index.mjs';

const actor = 'test:issue290-checkpoint';

function root(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue290-checkpoint-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const BLOB = 'x'.repeat(100 * 1024);

test('I290-C1: a compacted store restores its own checkpoint regardless of window size', (t) => {
  const directory = root(t);
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  for (let index = 0; index < 200; index += 1) {
    store.recordMcpAudit({ entry: index, blob: BLOB }, { actor, key: `issue290:cp:${index}` });
  }
  // Archive events 1..199: the ledger window keeps one event while the checkpoint's
  // idempotency map spans the full history. Pre-fix, the reader sized the checkpoint against
  // the shrunken window bytes and called exactly this state 'corrupt'.
  store.compact({ beforeSeq: 200 });
  store.releaseWriterLease({ requireOwned: true });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'valid',
    'the checkpoint validates from its own recorded shape: digests, prefix bytes, and seq counts');
  assert.equal(status.source, 'segments_checkpoint');
  assert.equal(reopened.snapshot().lastSeq, 200);
  reopened.releaseWriterLease({ requireOwned: true });

  // And a second restart from the restored checkpoint keeps deriving the same truth.
  const again = new CoordinationStore(directory);
  assert.equal(again.startupStatus().checkpoint, 'valid');
  again.releaseWriterLease({ requireOwned: true });
});

test('I290-C2: genuinely corrupt checkpoint bytes still fall back to the ledger', (t) => {
  const directory = root(t);
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  store.recordMcpAudit({ entry: 0 }, { actor, key: 'issue290:cp2:0' });
  store.releaseWriterLease({ requireOwned: true });
  writeFileSync(join(directory, 'projection.checkpoint'), Buffer.from('not a checkpoint'), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.startupStatus().checkpoint, 'corrupt');
  assert.equal(reopened.startupStatus().source, 'ledger_fallback');
  assert.equal(reopened.snapshot().lastSeq, 1);
  const projection = JSON.stringify(reopened.snapshot());
  assert.equal(createHash('sha256').update(projection).digest('hex').length, 64);
  reopened.releaseWriterLease({ requireOwned: true });
});
