// Issue #285, G-13 (red pin): the operational log has no archival — `log.mjs` accumulates
// one JSONL file per worker forever and every construction reads all of them in full, so
// startup cost grows without bound in the number of workers ever spawned.
//
// Contract: `archiveWorker(worker)` moves a terminal worker's live JSONL file into the
// log's archive with a manifest receipt; `workers()` then excludes it (so construction
// replay never reads its bytes again); reads of an archived worker refuse typed with the
// graceful path; `restoreWorker(worker)` brings it back byte-identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Log } from '../src/log.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-log-archival-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function partial(worker, n = 0) {
  return {
    worker,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.nudge',
    actor: 'orchestrator',
    payload: { text: `event-${n}` },
  };
}

test('G-13: archiveWorker moves the worker file out of the live dir and workers() excludes it', () => {
  const log = new Log(tmpDir());
  for (let i = 0; i < 5; i += 1) log.append(partial('retired', i));
  for (let i = 0; i < 3; i += 1) log.append(partial('live', i));
  assert.deepEqual(log.workers().sort(), ['live', 'retired']);

  const receipt = log.archiveWorker('retired');
  assert.equal(receipt.worker, 'retired');
  assert.equal(receipt.events, 5);
  assert.ok(receipt.bytes > 0);
  assert.match(receipt.digest, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(receipt));

  assert.deepEqual(log.workers(), ['live']);
  assert.ok(!existsSync(join(log.dir, 'retired.jsonl')));
});

test('G-13: a fresh Log over the dir never reads archived bytes at construction', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 5; i += 1) log.append(partial('retired', i));
  for (let i = 0; i < 3; i += 1) log.append(partial('live', i));
  log.archiveWorker('retired');

  const fresh = new Log(dir);
  assert.deepEqual(fresh.workers(), ['live']);
  assert.equal(fresh.tail('live'), 3);
  const stats = fresh.readStats();
  assert.equal(stats.parsedEvents, 3);
});

test('G-13: reads of an archived worker refuse typed with the graceful path', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  log.append(partial('retired'));
  log.archiveWorker('retired');

  for (const fn of [
    () => log.read('retired'),
    () => log.tail('retired'),
    () => log.at('retired', 1),
    () => log.byKind('retired', 'control.nudge'),
  ]) {
    assert.throws(fn, (error) => {
      assert.equal(error.code, 'operational_log_archived');
      assert.equal(error.worker, 'retired');
      assert.match(error.gracefulPath, /restoreWorker/u);
      return true;
    });
  }
});

test('G-13: restoreWorker brings the worker back byte-identical', () => {
  const dir = tmpDir();
  const log = new Log(dir);
  for (let i = 0; i < 4; i += 1) log.append(partial('retired', i));
  const before = readFileSync(join(dir, 'retired.jsonl'));
  log.archiveWorker('retired');
  assert.deepEqual(log.workers(), []);

  const restored = log.restoreWorker('retired');
  assert.equal(restored.worker, 'retired');
  assert.equal(restored.events, 4);
  assert.deepEqual(log.workers(), ['retired']);
  assert.deepEqual(readFileSync(join(dir, 'retired.jsonl')), before);
  assert.equal(log.tail('retired'), 4);
  assert.equal(log.at('retired', 2).payload.text, 'event-1');
});

test('G-13: archiving a missing worker refuses; archiving twice refuses as archived', () => {
  const log = new Log(tmpDir());
  assert.throws(() => log.archiveWorker('ghost'), (error) => {
    assert.equal(error.code, 'operational_log_archive_missing');
    return true;
  });
  log.append(partial('retired'));
  log.archiveWorker('retired');
  assert.throws(() => log.archiveWorker('retired'), (error) => {
    assert.equal(error.code, 'operational_log_archived');
    return true;
  });
  assert.throws(() => log.restoreWorker('ghost'), (error) => {
    assert.equal(error.code, 'operational_log_archive_missing');
    return true;
  });
});

test('G-13: archivedWorkers lists the archive with event counts; live appends are untouched', () => {
  const log = new Log(tmpDir());
  for (let i = 0; i < 5; i += 1) log.append(partial('retired', i));
  log.append(partial('live'));
  log.archiveWorker('retired');

  const archived = log.archivedWorkers();
  assert.equal(archived.length, 1);
  assert.equal(archived[0].worker, 'retired');
  assert.equal(archived[0].events, 5);

  const next = log.append(partial('live', 1));
  assert.equal(next.seq, 2);
  assert.equal(log.tail('live'), 2);
});
