// Cluster 1 (Core) — log.mjs test suite.
// Covers Log (gap-free/crash-durable seq stamping, hub-stamped ts, per-worker files,
// read/tail/workers) and Cursor (at-least-once read position: floor semantics,
// monotonic ack, restart-durability). Behaviors 1-10 of spec/IMPLEMENTATION.md
// (CLUSTER 1 — CORE, section 5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Log, Cursor } from '../src/log.mjs';

// ---------- helpers ----------

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-log-test-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A minimal, valid Omit<BatonEvent,'seq'|'ts'> for a given worker. */
function partial(worker, overrides = {}) {
  return {
    worker,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.nudge',
    actor: 'orchestrator',
    payload: { text: 'hello' },
    ...overrides,
  };
}

// ============================================================
// Log — append() seq/ts stamping (behaviors 1, 2, 5)
// ============================================================

test('append() assigns gap-free 1-based seq per worker; a second worker starts its own sequence at 1', () => {
  const log = new Log(tmpDir());
  const e1 = log.append(partial('w1'));
  const e2 = log.append(partial('w1'));
  const e3 = log.append(partial('w1'));
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(e3.seq, 3);

  const f1 = log.append(partial('w2'));
  assert.equal(f1.seq, 1, 'a different worker must start its own sequence at 1');
});

test('append() rejects a caller-supplied seq or ts with a TypeError', () => {
  const log = new Log(tmpDir());
  assert.throws(() => log.append(partial('w1', { seq: 1 })), TypeError);
  assert.throws(() => log.append(partial('w1', { ts: new Date().toISOString() })), TypeError);
  // Neither rejected call should have consumed a seq slot.
  const first = log.append(partial('w1'));
  assert.equal(first.seq, 1);
});

test('append() stamps ts from the injectable clock, never trusting a caller-supplied value', () => {
  const fixedTs = '2020-01-01T00:00:00.000Z';
  const log = new Log(tmpDir(), () => fixedTs);
  const e = log.append(partial('w1'));
  assert.equal(e.ts, fixedTs);
});

test('50 synchronous back-to-back append() calls produce 50 well-formed, non-corrupted lines with seqs 1..50', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  const returned = [];
  for (let i = 0; i < 50; i++) {
    returned.push(log.append(partial('w1', { payload: { i } })));
  }
  assert.deepEqual(returned.map((e) => e.seq), Array.from({ length: 50 }, (_, i) => i + 1));

  const raw = readFileSync(join(dir, 'w1.jsonl'), 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 50);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepEqual(parsed.map((e) => e.seq), Array.from({ length: 50 }, (_, i) => i + 1));
  for (let i = 0; i < 50; i++) {
    assert.equal(parsed[i].payload.i, i);
  }
});

// ============================================================
// Log — crash-recovery of the seq counter (behavior 3)
// ============================================================

test('a fresh Log instance recovers the next seq from an existing worker file on disk', () => {
  const dir = tmpDir();
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let seq = 1; seq <= 7; seq++) {
    lines.push(
      JSON.stringify({
        seq,
        ts: `2020-01-01T00:00:0${seq}.000Z`,
        worker: 'w1',
        harness: 'mock@1.0.0',
        turnEpoch: 1,
        kind: 'control.nudge',
        actor: 'orchestrator',
        payload: {},
      })
    );
  }
  writeFileSync(join(dir, 'w1.jsonl'), lines.join('\n') + '\n');

  const log = new Log(dir);
  const next = log.append(partial('w1'));
  assert.equal(next.seq, 8, 'crash-recovery must continue at seq 8, not restart at 1');
});

// ============================================================
// Log — read() / tail() / workers() (behavior 4)
// ============================================================

test('read(worker, fromSeq) returns only seq >= fromSeq, in order; unknown worker returns []', () => {
  const log = new Log(tmpDir());
  for (let i = 0; i < 5; i++) log.append(partial('w1'));

  const all = log.read('w1');
  assert.equal(all.length, 5);
  assert.deepEqual(all.map((e) => e.seq), [1, 2, 3, 4, 5]);

  const fromThree = log.read('w1', 3);
  assert.deepEqual(fromThree.map((e) => e.seq), [3, 4, 5]);

  const none = log.read('nonexistent-worker');
  assert.deepEqual(none, []);
});

test('tail(worker) returns the last appended seq, or 0 for a worker with no history', () => {
  const log = new Log(tmpDir());
  assert.equal(log.tail('w1'), 0);
  log.append(partial('w1'));
  log.append(partial('w1'));
  assert.equal(log.tail('w1'), 2);
});

test('workers() lists every worker id that has at least one event on disk', () => {
  const log = new Log(tmpDir());
  log.append(partial('w1'));
  log.append(partial('w2'));
  const ids = log.workers().sort();
  assert.deepEqual(ids, ['w1', 'w2']);
});

// ============================================================
// Cursor — at-least-once read position (behaviors 6-10)
// ============================================================

test('Cursor.next() before any ack() returns everything from seq 1', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 5; i++) log.append(partial('w1'));

  const cursor = new Cursor(join(dir, 'cursor.json'));
  const page = cursor.next(log, 'w1');
  assert.deepEqual(page.map((e) => e.seq), [1, 2, 3, 4, 5]);
});

test('ack(5) then next() returns only seq > 5', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 10; i++) log.append(partial('w1'));

  const cursor = new Cursor(join(dir, 'cursor.json'));
  cursor.ack(5);
  const page = cursor.next(log, 'w1');
  assert.deepEqual(page.map((e) => e.seq), [6, 7, 8, 9, 10]);
});

test('ack() is monotonic: ack(3) after ack(5) leaves the floor at 5, never regressing', () => {
  const dir = tmpDir();
  const cursor = new Cursor(join(dir, 'cursor.json'));
  cursor.ack(5);
  assert.equal(cursor.floor(), 5);
  cursor.ack(3);
  assert.equal(cursor.floor(), 5, 'ack() must never regress the floor');
  cursor.ack(5);
  assert.equal(cursor.floor(), 5, 'ack() with the same value is idempotent');
});

test('at-least-once across restart: next() without ack() re-serves the same page from a fresh Cursor', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 3; i++) log.append(partial('w1'));
  const stateFile = join(dir, 'cursor.json');

  const cursorA = new Cursor(stateFile);
  const firstPage = cursorA.next(log, 'w1');
  assert.deepEqual(firstPage.map((e) => e.seq), [1, 2, 3]);
  // Deliberately do NOT ack() — simulates a crash before the caller durably processed the page.

  const cursorB = new Cursor(stateFile); // brand-new instance, same on-disk state file
  const secondPage = cursorB.next(log, 'w1');
  assert.deepEqual(
    secondPage.map((e) => e.seq),
    [1, 2, 3],
    'a crash before ack() must re-serve the same unacked events, never drop them'
  );
});

test('ack()\'s effect is durable and visible to a brand-new Cursor pointed at the same stateFile', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 4; i++) log.append(partial('w1'));
  const stateFile = join(dir, 'cursor.json');

  const cursorA = new Cursor(stateFile);
  cursorA.next(log, 'w1');
  cursorA.ack(4);

  const cursorB = new Cursor(stateFile);
  assert.equal(cursorB.floor(), 4, 'ack() must persist to disk, not just in-memory');
  assert.deepEqual(cursorB.next(log, 'w1'), []);
});

// ============================================================
// G-34 — a corrupt cursor floor is a typed fact, never a silent replay from 0
// ============================================================

test('G-34: an unparseable floor file refuses by name instead of replaying the whole worker log', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 4; i++) log.append(partial('w1'));
  const stateFile = join(dir, 'cursor.json');
  writeFileSync(stateFile, '{"floor": 3', 'utf8'); // torn write: no closing brace

  const cursor = new Cursor(stateFile);
  const integrity = cursor.floorIntegrity();
  assert.equal(integrity?.code, 'cursor_floor_corrupt', 'the unreadable floor is a typed signal');
  assert.equal(integrity?.path, stateFile);
  assert.equal(integrity?.reason, 'invalid_json', 'the reason names what was observed, not a guess');
  assert.throws(() => cursor.next(log, 'w1'), (error) => {
    assert.equal(error.code, 'cursor_floor_corrupt');
    assert.match(error.gracefulPath, /repair\(\)/u, 'the refusal names the graceful path');
    return true;
  }, 'an unknown at-least-once position is never served as if it were floor 0');
});

test('G-34: a well-formed file whose floor is not a non-negative integer is refused, never coerced', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 30; i++) log.append(partial('w1'));

  for (const [raw, reason] of [
    ['{"floor": "5"}', 'invalid_floor'], // "5" + 1 would silently resume at seq "51"
    ['{"floor": -1}', 'invalid_floor'],
    ['{"floor": 2.5}', 'invalid_floor'],
    ['{"other": 2}', 'invalid_floor'],
    ['null', 'invalid_floor'],
  ]) {
    const stateFile = join(dir, `cursor-${reason}-${raw.length}.json`);
    writeFileSync(stateFile, raw, 'utf8');
    const cursor = new Cursor(stateFile);
    assert.equal(cursor.floorIntegrity()?.reason, reason, `${raw}: the floor shape is validated, not coerced`);
    assert.throws(() => cursor.next(log, 'w1'), { code: 'cursor_floor_corrupt' }, `${raw} never replays from 0`);
  }
});

test('G-34: repair() is the explicit fresh start — and the only way past an unreadable floor', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 3; i++) log.append(partial('w1'));
  const stateFile = join(dir, 'cursor.json');
  writeFileSync(stateFile, 'not json at all', 'utf8');

  const cursor = new Cursor(stateFile);
  const repaired = cursor.repair();
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.reason, 'invalid_json');
  assert.equal(cursor.floorIntegrity(), null, 'the typed fact clears only through the explicit act');
  assert.deepEqual(cursor.next(log, 'w1').map((e) => e.seq), [1, 2, 3],
    'the explicit fresh start serves the whole log — that is the replay the caller accepted');

  cursor.ack(2);
  const reopened = new Cursor(stateFile);
  assert.equal(reopened.floorIntegrity(), null, 'the repaired file is a readable floor again');
  assert.equal(reopened.floor(), 2, 'ack() after repair() persists like any other floor');
});
