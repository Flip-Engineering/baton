// Issue #285, G-14 (red pin): segment compaction does not reduce startup work —
// `coordination-replay.mjs` reads each archived segment file, verifies its sha256, parses
// every line and FOLDS every archived row into the projection even when the adopted
// projection checkpoint already carries the archived prefix's state.
//
// Contract: on an open whose checkpoint is valid and adopted, archived segment rows are
// read back (digest verified, `_events`/`_byKey` rebuilt — the event-sourcing law holds)
// but NOT re-folded; the adopted projection is the archived prefix's state. On the cold
// path (no adoptable checkpoint) every row folds exactly once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/coordination-store.mjs';

const TERMINAL_TASKS = 4; // 3 events each
const LIVE_TASKS = 3;     // 2 events each
const TOTAL = TERMINAL_TASKS * 3 + LIVE_TASKS * 2;
const CUT = TERMINAL_TASKS * 3 + 1;

const fields = (id) => ({
  id, brief: { goal: id }, deps: [], refines: null, taskType: 'test',
  reservedWorkerId: `w-${id}`,
});

const dirs = [];
function tmpDir(label) {
  const d = mkdtempSync(join(tmpdir(), `baton-g14-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

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

/** Open a store over `dir` counting `_apply` (fold) calls. Restores the prototype after. */
function openCounting(dir) {
  let folds = 0;
  const proto = CoordinationStore.prototype;
  const orig = proto._apply;
  proto._apply = function countedApply(event) {
    folds += 1;
    return orig.call(this, event);
  };
  try {
    const store = new CoordinationStore(dir, { checkpointInterval: 100_000 });
    return { store, folds };
  } finally {
    proto._apply = orig;
  }
}

test('G-14: an adopted reopen folds the live window only, never the archived prefix', () => {
  const dir = tmpDir('adopted');
  const store = new CoordinationStore(dir, { checkpointInterval: 100_000 });
  seed(store);
  const beforeEvents = store.events(1).length;
  assert.equal(beforeEvents, TOTAL);
  store.compact({ beforeSeq: CUT });
  // A tail past the checkpoint's coverage: the only rows any adopted open must fold.
  store.createTask(fields('tail'), { actor: 'orchestrator', key: 'create-tail' });
  store.claimTask('tail', 'w-tail', 1, { actor: 'orchestrator', key: 'claim-tail' });
  const beforeTasks = JSON.stringify(store.snapshot().tasks);

  const { store: reopened, folds } = openCounting(dir);
  assert.equal(reopened.startupStatus().checkpoint, 'valid');
  // Only the two tail rows fold; the archived prefix (and the covered window) never do.
  assert.equal(folds, 2);
  // The event-sourcing law still holds: full history rebuilt, identical projection.
  assert.equal(reopened.events(1).length, TOTAL + 2);
  assert.equal(JSON.stringify(reopened.snapshot().tasks), beforeTasks);
});

test('G-14: the cold path (no checkpoint) folds every row exactly once', () => {
  const dir = tmpDir('cold');
  const store = new CoordinationStore(dir, { checkpointInterval: 100_000 });
  seed(store);
  const beforeTasks = JSON.stringify(store.snapshot().tasks);
  store.compact({ beforeSeq: CUT });
  const ckpt = join(dir, 'projection.checkpoint');
  assert.ok(existsSync(ckpt));
  unlinkSync(ckpt);

  const { store: reopened, folds } = openCounting(dir);
  assert.equal(reopened.startupStatus().checkpoint, 'absent');
  assert.equal(folds, TOTAL);
  assert.equal(reopened.events(1).length, TOTAL);
  assert.equal(JSON.stringify(reopened.snapshot().tasks), beforeTasks);
});

test('G-14: the integrity boundary holds — a corrupted segment still refuses startup', () => {
  const dir = tmpDir('integrity');
  const store = new CoordinationStore(dir, { checkpointInterval: 100_000 });
  seed(store);
  const receipt = store.compact({ beforeSeq: CUT });
  const segFile = join(dir, 'segments', `${receipt.segment.digest}.jsonl`);
  assert.ok(existsSync(segFile));
  const bytes = readFileSync(segFile);
  const corrupted = Buffer.from(bytes);
  corrupted[corrupted.length - 2] = corrupted[corrupted.length - 2] === 0x41 ? 0x42 : 0x41;
  writeFileSync(segFile, corrupted);
  assert.throws(() => new CoordinationStore(dir, { checkpointInterval: 100_000 }), (error) => {
    assert.match(error.code ?? error.message, /segment|integrity|digest/u);
    return true;
  });
});
