// Issue #285, G-7 (red pin): a startup failure reports the counts it had already reached, and the
// replay reports progress for every fold stretch — the archived prefix included.
//
// Two facts, each red on the pre-fix source:
//  (a) the failure report pinned `totalEvents`/`checkpointEvents`/`replayedEvents` to 0 even when
//      the fold had processed every row but the one that refused, so the one durable row an
//      operator gets from a failed open discarded what the open already knew;
//  (b) progress reports came only from the live-window fold loop, so a replay that folded an
//      archived prefix reported nothing — `replayedEvents` read 0 for the entire prefix, which is
//      exactly the stretch whose cost the segments exist to bound.
//
// Row (c) pins the accounting the fix must preserve (issue #449/#465(4)): `replayedEvents` counts
// the rows whose FOLD ran, `checkpointEvents` counts the rows a used checkpoint's carried
// projection covers, and neither is served by re-reading a row that was never folded.
//
// The fixture sizes are DERIVED from the registry row the replay's chunk bound is taken from
// (#351 lane 2, #258: no new numeric constants): the archived prefix is one chunk plus a
// remainder, and the live window is shorter than one chunk, so any mid-prefix report proves the
// prefix itself reported rather than the window.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const actor = 'test:issue285-g7';
const CHUNK = FRAME_LIMITS['view.wake_replay.items'].value;
const ARCHIVED = CHUNK + 64; // the prefix: one chunk boundary falls strictly inside it
const WINDOW = 8; // shorter than one chunk: the window alone can never trip a report

const dirs = [];
function root(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-285-g7-${label}-`));
  dirs.push(directory);
  t.after(() => { if (dirs.includes(directory)) rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
test.after(() => { for (const directory of dirs) rmSync(directory, { recursive: true, force: true }); });

/** One `driver.recorded` row — the row template every replay-report fixture in this repository
 * writes (issue449's `appendTailRows`); it folds as a plain recorded row. */
function recordedRow(seq) {
  return {
    schemaVersion: 1, seq, ts: new Date().toISOString(), kind: 'driver.recorded', actor,
    idempotencyKey: `issue285:row:${seq}`,
    payload: { kind: 'issue285.fixture', index: seq },
  };
}

function writeLedger(directory, rows) {
  writeFileSync(join(directory, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

/** A ledger whose LAST row cannot fold: the #304 shape — a contribution naming a participant the
 * swarm never recorded. The fold refuses it typed, naming its seq, so the failure report is the
 * one surface that has to carry what the open already counted. */
function writePoisonedLedger(directory, rows) {
  const poison = {
    schemaVersion: 1, seq: rows, ts: new Date().toISOString(), kind: 'swarm.contribution_recorded',
    actor, idempotencyKey: 'issue285:poison',
    payload: { swarmId: 'sw-285', contributionId: 'c-285-ghost', participantId: 'ghost', body: 'no such participant' },
  };
  const swarm = {
    schemaVersion: 1, seq: 1, ts: new Date().toISOString(), kind: 'swarm.created', actor,
    idempotencyKey: 'issue285:swarm', payload: { swarmId: 'sw-285', purpose: 'g-7 failure-report fixture' },
  };
  writeLedger(directory, [
    swarm,
    ...Array.from({ length: rows - 2 }, (_, index) => recordedRow(index + 2)),
    poison,
  ]);
}

/** Open `directory`, capturing every startup report the open publishes (the issue290-quarantine
 * fixture's shape), and answer the reports it published. */
function openCapturing(directory) {
  const progress = [];
  let store = null; let failure = null;
  try { store = new CoordinationStore(directory, { startupProgress: (entry) => progress.push(entry) }); }
  catch (error) { failure = error; }
  return { store, failure, progress };
}

test('G-7a: a failed open reports the counts it reached, and still names the row that refused', (t) => {
  const directory = root(t, 'poisoned');
  const rows = 6;
  writePoisonedLedger(directory, rows);

  const { store, failure, progress } = openCapturing(directory);
  assert.equal(store, null, 'the poisoned ledger refuses the open');
  assert.equal(failure?.coordinationSeq, rows, 'the refusal names the row that could not fold');
  const failed = progress.at(-1);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.totalEvents, rows, 'the failure report keeps the total the plan knew');
  assert.equal(failed.checkpointEvents, 0, 'no checkpoint covered any row');
  assert.equal(failed.replayedEvents, rows - 1,
    'the report counts the rows the fold processed before the refusal, not zero');
  assert.equal(failed.failure.code, 'participant_not_found');
  assert.equal(failed.failure.seq, rows, 'and the failure still names the refusing row');
});

test('G-7b: folding an archived prefix reports progress inside the prefix', (t) => {
  const directory = root(t, 'archived-prefix');
  const rows = ARCHIVED + WINDOW;
  writeLedger(directory, Array.from({ length: rows }, (_, index) => recordedRow(index + 1)));

  // Archive 1..ARCHIVED into one segment, leaving the window live. Compaction writes the
  // checkpoint; the fixture refuses it (a corrupt cache is the fallback the ledger answers), so
  // the reopen must fold the archived prefix rather than adopt the carried projection.
  const seed = new CoordinationStore(directory, { checkpointInterval: 100_000 });
  const receipt = seed.compact({ beforeSeq: ARCHIVED + 1 });
  assert.equal(receipt?.archivedThroughSeq, ARCHIVED, 'the fixture archived the prefix');
  writeFileSync(join(directory, 'projection.checkpoint'), Buffer.from('not a checkpoint'), { mode: 0o600 });

  const { store, failure, progress } = openCapturing(directory);
  assert.equal(failure, null, 'the fallback replays from the ledger');
  const ready = progress.at(-1);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.source, 'segments_ledger_fallback', 'segments + window are the sources');
  assert.equal(ready.totalEvents, rows, 'the whole history is accounted for');
  assert.equal(ready.replayedEvents, rows, 'every row folds on the fallback path');
  assert.ok(
    progress.some((entry) => entry.state === 'replaying'
      && entry.replayedEvents > 0 && entry.replayedEvents < ARCHIVED),
    `no progress was reported while the archived prefix folded (${JSON.stringify(progress)})`,
  );
  assert.equal(store.snapshot().lastSeq, rows, 'and the fold reassembles the full history');
});

test('G-7c: an adopted checkpoint reports its carried rows as checkpointEvents, never replayed', (t) => {
  const directory = root(t, 'adopted');
  const rows = 24;
  const first = new CoordinationStore(directory, { checkpointInterval: 16 });
  for (let index = 1; index <= rows; index += 1) {
    first.recordDriver('issue285.fixture', { index }, { actor, key: `issue285:row:${index}` });
  }
  first.releaseWriterLease({ requireOwned: true });

  const progress = [];
  const reopened = new CoordinationStore(directory, { startupProgress: (entry) => progress.push(entry) });
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'valid', 'the release checkpoint restores');
  assert.equal(status.totalEvents, rows);
  assert.equal(status.checkpointEvents, rows, 'the carried rows are served, not folded');
  assert.equal(status.replayedEvents, 0, 'and nothing has to be folded again');
  assert.equal(progress.at(-1).state, 'ready');
  reopened.releaseWriterLease({ requireOwned: true });
});
