// Issue #397 (audit C18, with GitHub #361's root diagnosis): a rejected projection checkpoint
// used to report only the word 'corrupt' — a bare catch discarded WHICH invariant failed, so
// every restart after an authority-digest change (repoId, advisory feed cards, or any of the
// provider-attempt / canonical-order / route / representation / goal-plan policies landing)
// read 'checkpoint corrupt' and replayed the whole ledger with no code, field or remedy.
//
// The restore proof now names the failed invariant: reason from the closed set
//   path_invalid | envelope_shape | authority_digest | prefix_digest | projection_digest
//   | projection_shape | tail_anchor
// beside the compared values (digests abbreviated), and a checkpoint whose bytes are PROVEN
// intact under a different authority digest is its own state — 'stale_authority' — and is
// REUSED: its cached events replay under the current cards/policies exactly as a valid
// checkpoint's are, so only a real corruption falls back to the full ledger.
//
// The startup report's ENUMERABLE shape is byte-identical to the contract pinned by
// phase92-replay-verifier-red (P92-RP1/RP2) and coordination-internals (CI5); the reason and
// detail ride beside it as non-enumerable own properties of startupStatus().
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import * as coordinationReplay from '../src/coordination-replay.mjs';

const actor = 'test:issue397';
const CHECKPOINT = 'projection.checkpoint';

function root(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue397-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function appendRecords(store, count) {
  for (let index = 1; index <= count; index += 1) {
    store.recordDriver('issue397.fixture', { index }, { actor, key: `issue397:row:${index}` });
  }
}

/** Append valid driver rows directly to the ledger beyond the checkpoint prefix — the tail a
 * REUSED checkpoint must still replay (the full-replay fallback would fold these too, so the
 * startup counters tell the two apart). Rows mirror the phase92 fixture template. */
function appendTailRows(directory, fromSeq, count) {
  for (let offset = 0; offset < count; offset += 1) {
    const seq = fromSeq + offset;
    appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify({
      schemaVersion: 1, seq, ts: new Date().toISOString(), kind: 'driver.recorded',
      actor, idempotencyKey: `issue397:tail:${seq}`,
      payload: { kind: 'issue397.fixture', index: seq },
    })}\n`);
  }
}

/** Read the checkpoint envelope. v8's deserialize loses Buffer-ness, so the cached projection
 * bytes are re-copied into a Buffer the way the writer stored them. */
function readEnvelope(directory) {
  const envelope = deserialize(readFileSync(join(directory, CHECKPOINT)));
  envelope.projectionBytes = Buffer.from(envelope.projectionBytes);
  return envelope;
}

const abbrev = (value) => `${String(value).slice(0, 12)}…`;

test('I397-A: a proven checkpoint under a changed authority digest reads stale_authority and is reused', (t) => {
  const directory = root(t, 'stale-authority');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });
  appendTailRows(directory, 17, 3);

  // GitHub #361: the envelope is otherwise intact — only the authority digest it was written
  // under no longer matches the store's current cards/policies.
  const envelope = readEnvelope(directory);
  assert.equal(envelope.throughSeq, 16);
  envelope.authorityDigest = 'f'.repeat(64);
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'stale_authority',
    'a proven-intact checkpoint under a different authority digest is its own state, never corrupt');
  assert.equal(status.source, 'checkpoint_tail', 'the cached window accelerates the replay');
  assert.equal(status.checkpointEvents, 16);
  assert.equal(status.replayedEvents, 3, 'REUSE: only the tail beyond throughSeq replays, not the ledger');
  assert.equal(status.totalEvents, 19);
  assert.equal(reopened.snapshot().lastSeq, 19);

  assert.equal(status.checkpointReason, 'authority_digest');
  assert.deepEqual(status.checkpointDetail, {
    expected: abbrev(reopened._checkpointAuthorityDigest),
    actual: abbrev('f'.repeat(64)),
  });

  // The restore report itself carries reused: true and the parsed events for the replay.
  const report = coordinationReplay._restoreProjectionCheckpoint(
    reopened, readFileSync(join(directory, 'events.jsonl')), 0);
  assert.equal(report.state, 'stale_authority');
  assert.equal(report.reused, true);
  assert.equal(report.reason, 'authority_digest');
  assert.equal(report.events.length, 16);
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-B: a flipped ledger prefix byte reads corrupt/prefix_digest with the compared digests', (t) => {
  const directory = root(t, 'prefix-digest');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });
  appendTailRows(directory, 17, 2);

  const ledger = join(directory, 'events.jsonl');
  const original = readFileSync(ledger, 'utf8');
  const tampered = original.replace('"index":1}', '"index":9}');
  assert.notEqual(tampered, original);
  assert.equal(tampered.length, original.length, 'the prefix byte flips without reshaping the line');
  writeFileSync(ledger, tampered);

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt');
  assert.equal(status.source, 'ledger_fallback', 'a real corruption falls back to the full ledger');
  assert.equal(status.checkpointEvents, 0);
  assert.equal(status.replayedEvents, 18);
  assert.equal(reopened.snapshot().lastSeq, 18);

  assert.equal(status.checkpointReason, 'prefix_digest');
  const envelope = readEnvelope(directory);
  const derived = createHash('sha256')
    .update(readFileSync(ledger).subarray(0, envelope.prefixBytes)).digest('hex');
  assert.deepEqual(status.checkpointDetail, {
    recorded: abbrev(envelope.prefixDigest),
    derived: abbrev(derived),
    prefixBytes: envelope.prefixBytes,
  });
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-C: a truncated projection payload reads projection_shape', (t) => {
  const directory = root(t, 'projection-shape');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });

  // Digest-consistent truncation: the projection digest is re-derived over the cut bytes, so
  // the invariant that fails is the payload's SHAPE (it no longer deserializes), not a digest.
  const envelope = readEnvelope(directory);
  envelope.projectionBytes = envelope.projectionBytes.subarray(
    0, Math.floor(envelope.projectionBytes.byteLength / 2));
  envelope.projectionDigest = createHash('sha256').update(envelope.projectionBytes).digest('hex');
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt');
  assert.equal(status.source, 'ledger_fallback');
  assert.equal(status.replayedEvents, 16);
  assert.equal(status.checkpointReason, 'projection_shape');
  assert.equal(status.checkpointDetail.field, 'deserialize');
  assert.equal(typeof status.checkpointDetail.error, 'string');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-D: the startup report carries the reason and detail; the pinned enumerable shape holds', (t) => {
  const directory = root(t, 'startup-report');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 8);
  first.releaseWriterLease({ requireOwned: true });
  writeFileSync(join(directory, CHECKPOINT), Buffer.from('not a checkpoint'), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.deepEqual({ ...status }, {
    schemaVersion: 1, state: 'ready', source: 'ledger_fallback',
    totalEvents: 8, checkpointEvents: 0, replayedEvents: 8,
    checkpoint: 'corrupt', failure: null, poison: null, quarantined: [],
  }, 'the enumerable startup shape is byte-identical to the pinned contract (P92-RP2/CI5)');
  assert.equal(status.checkpointReason, 'envelope_shape');
  assert.equal(status.checkpointDetail.field, 'deserialize');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-E: corruption dominates a stale authority — only proven bytes are reused', (t) => {
  const directory = root(t, 'dominance');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });

  const envelope = readEnvelope(directory);
  envelope.authorityDigest = 'f'.repeat(64);
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });
  const ledger = join(directory, 'events.jsonl');
  const original = readFileSync(ledger, 'utf8');
  writeFileSync(ledger, original.replace('"index":1}', '"index":9}'));

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt', 'an unproven checkpoint is never stale_authority');
  assert.equal(status.source, 'ledger_fallback');
  assert.equal(status.checkpointReason, 'prefix_digest', 'the real corruption names the reason');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-F: a drifted last ledger line reads tail_anchor with the compared bytes', (t) => {
  const directory = root(t, 'tail-anchor');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });

  // The #229 deferred-write hazard: the ledger prefix moved under a re-stamped envelope. The
  // prefix digest is made to match the drifted bytes, so the anchor that fails is the LAST
  // cached row's re-serialization against the prefix's final line.
  const ledger = join(directory, 'events.jsonl');
  const original = readFileSync(ledger, 'utf8');
  writeFileSync(ledger, original.replace('"index":16}', '"index":17}'));
  const envelope = readEnvelope(directory);
  envelope.prefixDigest = createHash('sha256')
    .update(readFileSync(ledger).subarray(0, envelope.prefixBytes)).digest('hex');
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt');
  assert.equal(status.source, 'ledger_fallback');
  assert.equal(status.checkpointReason, 'tail_anchor');
  assert.equal(status.checkpointDetail.field, 'last_line');
  assert.equal(status.checkpointDetail.lastEventSeq, 16);
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-G: a symlinked checkpoint path reads path_invalid', (t) => {
  const directory = root(t, 'path-invalid');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });

  const checkpointPath = join(directory, CHECKPOINT);
  const real = readFileSync(checkpointPath);
  rmSync(checkpointPath);
  writeFileSync(join(directory, 'checkpoint.sidecar'), real, { mode: 0o600 });
  symlinkSync('checkpoint.sidecar', checkpointPath);

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt');
  assert.equal(status.source, 'ledger_fallback');
  assert.equal(status.checkpointReason, 'path_invalid');
  assert.equal(status.checkpointDetail.symbolicLink, true);
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I397-H: projection bytes that no longer match their digest read projection_digest', (t) => {
  const directory = root(t, 'projection-digest');
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(first, 16);
  first.releaseWriterLease({ requireOwned: true });

  const envelope = readEnvelope(directory);
  envelope.projectionBytes[0] ^= 0xff;
  writeFileSync(join(directory, CHECKPOINT), serialize(envelope), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt');
  assert.equal(status.source, 'ledger_fallback');
  assert.equal(status.checkpointReason, 'projection_digest');
  assert.deepEqual(status.checkpointDetail, {
    recorded: abbrev(envelope.projectionDigest),
    derived: abbrev(createHash('sha256').update(envelope.projectionBytes).digest('hex')),
    projectionBytes: envelope.projectionBytes.byteLength,
  });
  reopened.releaseWriterLease({ requireOwned: true });
});
