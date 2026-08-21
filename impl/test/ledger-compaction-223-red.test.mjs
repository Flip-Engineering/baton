import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import { CoordinationStore } from '../src/coordination-store.mjs';

// #223 red pin — the ledger compaction/archival seam (row: row-compaction).
//
// Contract (issue #223 + the #229 chain evidence): terminal waves' event prefixes are
// archived into content-addressed segments (segment = the event range [fromSeq, throughSeq]
// + sha256; the ledger keeps a compact index of segments). The live replay window is the
// active set (open waves' events + a bounded recent tail); the live events.jsonl and the
// projection checkpoint hold the window only. The full ledger stays recoverable: segments
// reassemble deterministically with the window — the event-sourcing law holds, nothing is
// destroyed.
//
// The seam is the operator verb `compact({ beforeSeq })` on CoordinationStore. This row
// lands the MECHANISM + the integrity law, not the cadence policy (a later row decides
// which waves are terminal and picks the cut). The pin, red at HEAD (no compaction):
//
//   (a) THE INTEGRITY LAW — after compact({ beforeSeq }), a fresh store over the compacted
//       directory replays byte-identically to a fresh store over the untouched ledger
//       (segment+window reassembly ≡ full replay; the projection state is identical).
//   (b) the live events.jsonl contains ONLY the window's events (bounded bytes; the first
//       live line carries seq === beforeSeq).
//   (c) the projection checkpoint serializes the window only (throughSeq === window count,
//       prefixBytes === window bytes, parsed cache `_events` === window events, while the
//       idempotency map `_byKey` still covers the FULL history).
//
// Additionally the pin fixes the seam's mechanics: content-addressed segment files under
// state/coordination/segments/ with the index recording [fromSeq, throughSeq] + digest;
// and appends AFTER compaction continue the global sequence (seq === total + 1) and replay.

const TERMINAL_TASKS = 4;   // each: created + claimed + transitioned(completed) = 3 events
const LIVE_TASKS = 3;       // each: created + claimed = 2 events
const TERMINAL_EVENTS = TERMINAL_TASKS * 3;
const LIVE_EVENTS = LIVE_TASKS * 2;
const CUT = TERMINAL_EVENTS + 1; // beforeSeq — archives the terminal prefix, keeps the live window

const fields = (id) => ({
  id, brief: { goal: id }, deps: [], refines: null, taskType: 'test',
  reservedWorkerId: `w-${id}`,
});

function freshDir(t, label) {
  const dir = mkdtempSync(join(tmpdir(), `bt223-${label}-`));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* cleanup is best-effort */ } });
  return dir;
}

/** N terminal tasks (completed) + M live tasks (claimed/working) — the seam fixture. */
function seed(store) {
  for (let i = 0; i < TERMINAL_TASKS; i += 1) {
    const id = `done-${i}`;
    store.createTask(fields(id), { actor: 'orchestrator', key: `create-${id}` });
    store.claimTask(id, `w-${id}`, 1, { actor: 'orchestrator', key: `claim-${id}` });
    store.transitionTask(id, 'completed', 2, { actor: 'policy', key: `complete-${id}` }, { verification: 1 });
  }
  for (let i = 0; i < LIVE_TASKS; i += 1) {
    const id = `live-${i}`;
    store.createTask(fields(id), { actor: 'orchestrator', key: `create-${id}` });
    store.claimTask(id, `w-${id}`, 1, { actor: 'orchestrator', key: `claim-${id}` });
  }
}

test('LEDGER COMPACTION (#223): segment+window reassembly replays identically to the full ledger', (t) => {
  const dir = freshDir(t, 'law');
  const store = new CoordinationStore(dir, { checkpointInterval: 100_000 });
  seed(store);

  const fullEvents = store.events(1);
  const fullTasks = [...Array(TERMINAL_TASKS + LIVE_TASKS)].map((_, i) => store.task(i < TERMINAL_TASKS ? `done-${i}` : `live-${i - TERMINAL_TASKS}`));
  const cursor = store.eventCursor();
  assert.equal(cursor, TERMINAL_EVENTS + LIVE_EVENTS);

  // Control: a fresh store replaying the UNTOUCHED ledger bytes — the "full replay" reference.
  const controlDir = freshDir(t, 'control');
  copyFileSync(join(dir, 'events.jsonl'), join(controlDir, 'events.jsonl'));
  const control = new CoordinationStore(controlDir);
  assert.deepEqual(control.events(1), fullEvents, 'the untouched ledger replays the seeded history');
  assert.deepEqual(control.snapshot().tasks, fullTasks, 'the untouched ledger replays the task projection');

  // The seam: archive the terminal prefix.
  const receipt = store.compact({ beforeSeq: CUT });
  assert.ok(receipt, 'compact returns a receipt');
  assert.equal(receipt.archivedThroughSeq, TERMINAL_EVENTS);

  // (b) the live ledger file holds ONLY the window's events.
  const originalBytes = readFileSync(join(controlDir, 'events.jsonl'));
  const ledgerBytes = readFileSync(join(dir, 'events.jsonl'));
  const lines = ledgerBytes.toString('utf8').trimEnd().split('\n');
  assert.equal(lines.length, LIVE_EVENTS, 'the live ledger holds exactly the window events');
  assert.equal(JSON.parse(lines[0]).seq, CUT, 'the live ledger begins at the compaction cut');
  assert.ok(ledgerBytes.byteLength < originalBytes.byteLength, 'the live ledger is strictly smaller (bounded bytes)');
  assert.equal(JSON.parse(lines.at(-1)).seq, TERMINAL_EVENTS + LIVE_EVENTS, 'the live ledger still ends at the global tail');

  // The archived prefix lives in one content-addressed segment under segments/, indexed.
  const segmentNames = readdirSync(join(dir, 'segments')).sort();
  assert.deepEqual(segmentNames, ['index.json', `${receipt.segment.digest}.jsonl`].sort(), 'segments/ holds the index plus one content-addressed segment');
  const index = JSON.parse(readFileSync(join(dir, 'segments', 'index.json'), 'utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.archivedThroughSeq, TERMINAL_EVENTS);
  assert.equal(index.segments.length, 1);
  assert.equal(index.segments[0].fromSeq, 1);
  assert.equal(index.segments[0].throughSeq, TERMINAL_EVENTS);
  assert.equal(index.segments[0].digest, receipt.segment.digest);
  const segmentBytes = readFileSync(join(dir, 'segments', `${index.segments[0].digest}.jsonl`));
  assert.equal(createHash('sha256').update(segmentBytes).digest('hex'), index.segments[0].digest, 'the segment file is content-addressed');
  assert.equal(JSON.parse(segmentBytes.toString('utf8').trimEnd().split('\n').at(-1)).seq, TERMINAL_EVENTS, 'the segment covers [1..TERMINAL_EVENTS]');

  // (c) the checkpoint serializes the window only — parsed cache = window; idempotency = full.
  const envelope = deserialize(readFileSync(join(dir, 'projection.checkpoint')));
  assert.equal(envelope.throughSeq, LIVE_EVENTS, 'checkpoint throughSeq is the window count');
  assert.equal(envelope.prefixBytes, ledgerBytes.byteLength, 'checkpoint prefix is the window bytes');
  const projection = deserialize(envelope.projectionBytes);
  assert.equal(projection._events.length, LIVE_EVENTS, 'the parsed-event cache holds the window only');
  assert.equal(projection._events[0].seq, CUT, 'the parsed cache begins at the cut');
  assert.equal(projection._byKey.size, TERMINAL_EVENTS + LIVE_EVENTS, 'the idempotency map still covers the full history');

  // (a) THE INTEGRITY LAW — reopen: segments + window reassemble ≡ full replay.
  const reopened = new CoordinationStore(dir);
  assert.deepEqual(reopened.events(1), fullEvents, 'segment+window replay is byte-identical to full replay');
  assert.deepEqual(reopened.snapshot().tasks, fullTasks, 'the task projection is identical');
  assert.deepEqual(reopened.snapshot().lastSeq, cursor, 'the projection cursor is continuous');
  assert.equal(reopened.startupStatus().state, 'ready');
  assert.equal(reopened.startupStatus().checkpoint, 'valid', 'the window checkpoint restores');
  assert.equal(reopened.startupStatus().totalEvents, cursor);

  // Appends AFTER compaction continue the global sequence and replay across the seam.
  const after = store.createTask(fields('after'), { actor: 'orchestrator', key: 'create-after' });
  assert.equal(after.event.seq, cursor + 1, 'post-compaction appends continue the global sequence');
  const reopened2 = new CoordinationStore(dir);
  assert.equal(reopened2.eventCursor(), cursor + 1);
  assert.deepEqual(reopened2.events(1), [...fullEvents, ...store.events(1).filter((event) => event.seq === cursor + 1)],
    'the post-compaction append replays after the reassembled history');
});

test('LEDGER COMPACTION (#223): crash windows reconcile — nothing is destroyed, the verb is idempotent', (t) => {
  // Window A — the segment index committed but the events.jsonl rewrite never landed
  // (a crash between the index write and the ledger rename). The ledger still starts at
  // seq 1, so it IS the complete history: load replays it, the stale window checkpoint is
  // refused, and the operator's re-run of the verb re-archives the same content-addressed
  // bytes idempotently.
  const adir = freshDir(t, 'crasha');
  const a = new CoordinationStore(adir, { checkpointInterval: 100_000 });
  seed(a);
  const fullLedgerBytes = readFileSync(join(adir, 'events.jsonl'));
  const fullEventsA = a.events(1);
  a.compact({ beforeSeq: CUT });
  writeFileSync(join(adir, 'events.jsonl'), fullLedgerBytes, { mode: 0o600 }); // the ledger rewrite "did not land"
  a.releaseWriterLease({ requireOwned: true }); // clear the lease so a successor may write
  const reopenedA = new CoordinationStore(adir);
  assert.deepEqual(reopenedA.events(1), fullEventsA, 'a committed index with an untruncated ledger replays the full history');
  assert.equal(reopenedA.startupStatus().source, 'ledger_fallback', 'the stale window checkpoint is refused and the ledger is authoritative');
  const redo = reopenedA.compact({ beforeSeq: CUT });
  assert.equal(redo.archivedThroughSeq, TERMINAL_EVENTS, 're-running the verb re-archives the same prefix');
  assert.equal(reopenedA.compact({ beforeSeq: CUT }), null, 'a repeat cut is an idempotent no-op');
  assert.deepEqual(new CoordinationStore(adir).events(1), fullEventsA, 're-compaction preserves the integrity law');

  // Window B — a SECOND compaction's ledger rewrite committed but its index write never
  // did. The segment files on disk are the durable archive; load rebuilds the index by
  // scanning them (content-addressed, verified) and reassembles segments + window.
  const bdir = freshDir(t, 'crashb');
  const b = new CoordinationStore(bdir, { checkpointInterval: 100_000 });
  seed(b);
  const fullEventsB = b.events(1);
  b.compact({ beforeSeq: CUT }); // archives [1..12], live [13..18]
  const secondCut = 15;
  const windowLedger = readFileSync(join(bdir, 'events.jsonl'), 'utf8').trimEnd().split('\n');
  assert.equal(windowLedger.length, LIVE_EVENTS);
  // The in-flight compaction's segment for [13..14] was written before its ledger truncate…
  const orphanBytes = Buffer.from(`${windowLedger.slice(0, secondCut - CUT).join('\n')}\n`, 'utf8');
  const orphanDigest = createHash('sha256').update(orphanBytes).digest('hex');
  writeFileSync(join(bdir, 'segments', `${orphanDigest}.jsonl`), orphanBytes, { mode: 0o600 });
  // …and its ledger rewrite landed [15..18], but the index still records [1..12].
  writeFileSync(join(bdir, 'events.jsonl'), Buffer.from(`${windowLedger.slice(secondCut - CUT).join('\n')}\n`, 'utf8'), { mode: 0o600 });
  b.releaseWriterLease({ requireOwned: true });
  const reopenedB = new CoordinationStore(bdir);
  assert.equal(reopenedB.startupStatus().source, 'segments_ledger_fallback', 'the stale checkpoint is refused; segments + window replay');
  assert.deepEqual(reopenedB.events(1), fullEventsB, 'scan-rebuilt segments + window reassemble the full history');
  const rebuilt = JSON.parse(readFileSync(join(bdir, 'segments', 'index.json'), 'utf8'));
  assert.equal(rebuilt.archivedThroughSeq, TERMINAL_EVENTS, 'the stale index is NOT trusted over the segment files');
  // A subsequent cut continues from the rebuilt coverage — [15..16] archives, [17..18] live.
  reopenedB.compact({ beforeSeq: 17 });
  const final = JSON.parse(readFileSync(join(bdir, 'segments', 'index.json'), 'utf8'));
  assert.equal(final.segments.length, 3);
  assert.deepEqual(final.segments.map((segment) => [segment.fromSeq, segment.throughSeq]), [[1, 12], [13, 14], [15, 16]]);
  assert.deepEqual(new CoordinationStore(bdir).events(1), fullEventsB, 'incremental cuts preserve the integrity law');

  // Window C — the segment index file itself is corrupt: the index is a cache over the
  // immutable segment files, so load must rebuild coverage by scanning instead of failing.
  const cdir = freshDir(t, 'crashc');
  const c = new CoordinationStore(cdir, { checkpointInterval: 100_000 });
  seed(c);
  const fullEventsC = c.events(1);
  c.compact({ beforeSeq: CUT });
  writeFileSync(join(cdir, 'segments', 'index.json'), 'not an index', { mode: 0o600 });
  c.releaseWriterLease({ requireOwned: true });
  const reopenedC = new CoordinationStore(cdir);
  assert.deepEqual(reopenedC.events(1), fullEventsC, 'a corrupt segment index is rebuilt from the segment files');
  assert.equal(reopenedC.compact({ beforeSeq: CUT }), null, 'the rebuilt coverage matches the requested cut (idempotent)');
});
