// Issue #366 — the run-stop and fleet-drain target-set ceilings (100_000 literals) were re-judged
// on replay, so a large recorded run made its own ledger unloadable.
//
// The class is #286 G-41's, restated for target sets: the ledger IS the physical resource, and a
// second literal ceiling on top of it refuses operations the ledger had already accepted. Here the
// ceiling sat on a run stop's target set — a view of the ledger, re-derived on EVERY fold, so a
// ledger whose recorded target set outgrew 100_000 rows could no longer be opened by the resident
// that wrote it — and on a fleet drain's target set, whose targets are NOT rows of this ledger at
// all (the local controller's live fleet is; phase56's DC6 admits two of them onto an empty store),
// so the store derives no bound for that admission and the deployment's own drain policy does.
// The same rows were refused a second time through the projection checkpoint, whose restore
// re-applies every cached row under the current fold.
//
// Rows (the brief's (a)-(d)):
//   (a) a ledger holding a recorded oversize run.stop / fleet.drain row REPLAYS: the store reopens
//       with no refusal and the projection is intact;
//   (b) the surviving bound is DERIVED from the ledger, judged at admission only, and its refusal
//       names the field, the observed count and the bound instead of one opaque sentence; the
//       fleet-drain admission, whose target set this ledger cannot bound, keeps none;
//   (c) the literals are gone from the three sites, and the ONE registry row is read by ONE helper
//       that only the admission calls — the fold judges no target-set size at all;
//   (d) restore from the projection checkpoint agrees with a full replay of the same ledger.
//
// Suite law: hermetic (mkdtemp fixture, fixed clock, no network). The oversize ledgers are written
// directly, the way the #304 fixtures seed refused rows — the fold is the thing under test, not the
// admission verb that would have written them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { memberSource, STORE_MODULE_FILES } from './seam-member-source.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const REPO_ID = 'repo-366-target-set';
const RUN_ID = 'run-366-target-set';
const CLOCK_ISO = '2026-07-18T08:00:00.000Z';
const ACTOR = 'operator:issue366';
// The literal this issue removed, named here so the fixtures are oversize BY THAT MEASURE.
const OLD_CEILING = 100_000;
const OVERSIZE = OLD_CEILING + 1;

const TARGET_SET_ROW = FRAME_LIMITS['target_set.per_ledger_event'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const temporaryRoots = [];
function temporaryRoot(label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue366-${label}-`));
  temporaryRoots.push(directory);
  return directory;
}
test.after(() => { for (const directory of temporaryRoots) rmSync(directory, { recursive: true, force: true }); });

const taskId = (index) => `task-${String(index).padStart(6, '0')}`;
const workerId = (index) => `worker-${String(index).padStart(6, '0')}`;

/** One durable task row of the run under test, exactly as createTask would write it. */
function taskRow(seq, index) {
  const id = taskId(index);
  return {
    schemaVersion: 1, seq, ts: CLOCK_ISO, kind: 'task.created',
    actor: 'orchestrator', idempotencyKey: `task.created:${id}`,
    payload: {
      id,
      brief: { objective: `Own ${RUN_ID} unit ${index}`, capabilities: ['baton_orchestrator'] },
      deps: [], refines: null, relation: 'root', runId: RUN_ID, taskType: 'general',
      reservedWorkerId: workerId(index),
      vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3', modelPolicy: null,
      effortRequested: 'max', sessionRequest: { mode: 'new' },
    },
  };
}

/** The recorded run stop, digest-bound exactly as admitRunStop binds it (schemaVersion 1). */
function runStopRow(seq, targetTaskIds, targetWorkerIds) {
  const reasonDigest = digest('stop the run and everything it owns');
  const tasks = [...targetTaskIds].sort();
  const workers = [...new Set(targetWorkerIds)].sort();
  return {
    schemaVersion: 1, seq, ts: CLOCK_ISO, kind: 'run.stop_admitted',
    actor: ACTOR, idempotencyKey: `run.stop:${RUN_ID}`,
    payload: {
      schemaVersion: 1, repoId: REPO_ID, runId: RUN_ID, reasonDigest,
      requestDigest: digest({ repoId: REPO_ID, runId: RUN_ID, reasonDigest }),
      targetTaskIds: tasks, targetWorkerIds: workers,
      targetDigest: digest({ targetTaskIds: tasks, targetWorkerIds: workers }),
    },
  };
}

/** The recorded fleet drain admission, digest-bound exactly as admitFleetDrain binds it. */
function fleetDrainRow(seq, targetWorkerIds) {
  const idempotencyKey = 'fleet-366';
  const requestDigest = digest({ repoId: REPO_ID, idempotencyKey });
  const workers = [...targetWorkerIds].sort();
  return {
    schemaVersion: 1, seq, ts: CLOCK_ISO, kind: 'fleet.drain_admitted',
    actor: ACTOR, idempotencyKey: `fleet.drain:${idempotencyKey}`,
    payload: {
      schemaVersion: 1, drainId: `fleet-drain:${requestDigest}`, repoId: REPO_ID,
      requestDigest, targetWorkerIds: workers, targetDigest: digest(workers),
    },
  };
}

function drainIdOf(row) { return row.payload.drainId; }

function writeLedger(directory, rows) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

const openOptions = () => ({ repoId: REPO_ID, clock: () => CLOCK_ISO });

/** The big run: OVERSIZE tasks plus the recorded stop that names every one of them. Built once and
 * copied per test — a 100_001-row ledger is the issue's own shape, not a decoration. */
let bigLedgerSource = null;
function bigRunLedger() {
  if (bigLedgerSource === null) {
    const source = temporaryRoot('big-source');
    const rows = [];
    const tasks = [];
    const workers = [];
    for (let index = 0; index < OVERSIZE; index += 1) {
      rows.push(taskRow(index + 1, index));
      tasks.push(taskId(index));
      workers.push(workerId(index));
    }
    rows.push(runStopRow(rows.length + 1, tasks, workers));
    writeLedger(source, rows);
    bigLedgerSource = { directory: source, stopSeq: rows.length };
  }
  const copy = temporaryRoot('big-copy');
  cpSync(bigLedgerSource.directory, copy, { recursive: true });
  return { directory: copy, stopSeq: bigLedgerSource.stopSeq };
}

/** The small ledger whose ONE recorded row is already over the old literal: a fleet drain that
 * names more workers than the old ceiling allowed. */
function oversizeDrainLedger(label) {
  const directory = temporaryRoot(label);
  const rows = [taskRow(1, 0), fleetDrainRow(2, Array.from({ length: OVERSIZE }, (_, index) => workerId(index)))];
  writeLedger(directory, rows);
  return { directory, drainId: drainIdOf(rows[1]) };
}

// ===========================================================================
// (a) a recorded oversize target set REPLAYS
// ===========================================================================

test('a recorded run stop whose target set exceeds the old literal replays: the store reopens and the projection is intact', () => {
  const ledger = bigRunLedger();
  const store = new CoordinationStore(ledger.directory, openOptions());
  try {
    const status = store.startupStatus();
    assert.equal(status.state, 'ready', 'the fold does not refuse the recorded stop');
    assert.equal(status.failure ?? null, null, 'no replay failure is reported');
    assert.equal(store.snapshot().lastSeq, ledger.stopSeq, 'every recorded row folded');
    assert.equal(store.snapshot().tasks.length, OVERSIZE, 'every recorded task is projected');

    const stop = store.runStop(RUN_ID);
    assert.ok(stop, 'the recorded run stop is projected');
    assert.equal(stop.status, 'stopping');
    assert.equal(stop.admittedEvent, ledger.stopSeq);
    assert.equal(stop.targetTaskIds.length, OVERSIZE,
      'the target set over the old literal survives replay whole — nothing is clamped');
    assert.equal(stop.targetWorkerIds.length, OVERSIZE);
    assert.equal(stop.targetTaskIds[0], taskId(0));
    assert.equal(stop.targetTaskIds.at(-1), taskId(OVERSIZE - 1));
    assert.equal(stop.targetWorkerIds.at(-1), workerId(OVERSIZE - 1));
    assert.equal(stop.targetDigest, digest({ targetTaskIds: stop.targetTaskIds, targetWorkerIds: stop.targetWorkerIds }),
      'the digest-binding the admission wrote is re-derived, not loosened');
  } finally {
    store.releaseWriterLease();
  }
});

test('a recorded fleet drain whose target set exceeds the old literal replays: the store reopens and the projection is intact', () => {
  const ledger = oversizeDrainLedger('drain-replay');
  const store = new CoordinationStore(ledger.directory, openOptions());
  try {
    assert.equal(store.startupStatus().state, 'ready', 'the fold does not re-judge the recorded drain for size');
    const drain = store.fleetDrain(ledger.drainId);
    assert.ok(drain, 'the recorded drain is projected');
    assert.equal(drain.status, 'admitted');
    assert.equal(drain.admittedEvent, 2);
    assert.equal(drain.targetWorkerIds.length, OVERSIZE, 'the whole recorded target set survives replay');
    assert.equal(drain.targetDigest, digest(drain.targetWorkerIds));
  } finally {
    store.releaseWriterLease();
  }
});

// ===========================================================================
// (b) the surviving bound is DERIVED, judged at admission, and its refusal is typed
// ===========================================================================

test('a run stop whose target set exceeds the ledger that holds it refuses naming the field, the count and the bound', () => {
  const directory = temporaryRoot('run-stop-admission');
  writeLedger(directory, [taskRow(1, 0), taskRow(2, 1)]);
  const store = new CoordinationStore(directory, openOptions());
  try {
    const reasonDigest = digest('stop every unit of the run');
    const requestDigest = digest({ repoId: REPO_ID, runId: RUN_ID, reasonDigest });
    const base = { schemaVersion: 1, repoId: REPO_ID, runId: RUN_ID, reasonDigest, requestDigest };
    const preview = (payload) => ({
      seq: store.snapshot().lastSeq + 1, actor: ACTOR, idempotencyKey: `run.stop:${RUN_ID}`, payload,
    });
    const bound = TARGET_SET_ROW.value * 2; // two ledger events hold at most two targets
    const oversize = {
      ...base,
      targetTaskIds: [taskId(0), taskId(1), 'task-extra-366'],
      targetWorkerIds: [workerId(0), workerId(1), 'worker-extra-366'],
    };
    oversize.targetDigest = digest({ targetTaskIds: oversize.targetTaskIds, targetWorkerIds: oversize.targetWorkerIds });
    assert.throws(() => store._validateRunStopAdmission(oversize, preview(oversize)), (error) => {
      assert.equal(error.code, TARGET_SET_ROW.refusalCode, 'the refusal carries the row\'s own code');
      assert.equal(error.field, 'targetTaskIds', 'it names the judged field');
      assert.equal(error.actual, 3, 'it names the observed count');
      assert.equal(error.bound, bound, 'it names the bound it was judged against');
      assert.deepEqual(error.detail, { lane: TARGET_SET_ROW.lane, field: 'targetTaskIds', actual: 3, bound });
      assert.match(error.message, /targetTaskIds is 3 targets/u);
      assert.match(error.message, new RegExp(`bound ${bound}\\b`, 'u'));
      return true;
    });
    // The bound is real, not decorative: the target set the ledger actually holds is admitted, and
    // the ordinary stop verb still records it.
    const fitting = {
      ...base,
      targetTaskIds: [taskId(0), taskId(1)],
      targetWorkerIds: [workerId(0), workerId(1)],
    };
    fitting.targetDigest = digest({ targetTaskIds: fitting.targetTaskIds, targetWorkerIds: fitting.targetWorkerIds });
    assert.doesNotThrow(() => store._validateRunStopAdmission(fitting, preview(fitting)));
    assert.equal(store.admitRunStop(base, { actor: ACTOR, key: `run.stop:${RUN_ID}` }).result, 'admitted');
    assert.deepEqual(store.runStop(RUN_ID).targetTaskIds, fitting.targetTaskIds);
  } finally {
    store.releaseWriterLease();
  }
});

test('a fleet drain target set is not a projection of this ledger: the store keeps no ceiling and the deployment owns the bound', () => {
  const directory = temporaryRoot('drain-admission');
  writeLedger(directory, [taskRow(1, 0)]);
  const store = new CoordinationStore(directory, openOptions());
  try {
    // The drain names the local controller's fleet, not rows of this ledger (phase56 DC6 admits a
    // drain onto an empty store), so a ledger-derived bound would refuse real drains.
    const idempotencyKey = 'fleet-oversize';
    const requestDigest = digest({ repoId: REPO_ID, idempotencyKey });
    const targetWorkerIds = Array.from({ length: OVERSIZE }, (_, index) => workerId(index));
    const fields = {
      schemaVersion: 1, drainId: `fleet-drain:${requestDigest}`, repoId: REPO_ID, requestDigest,
      targetWorkerIds, targetDigest: digest(targetWorkerIds),
    };
    assert.equal(store.admitFleetDrain(fields, { actor: ACTOR, key: `fleet.drain:${idempotencyKey}` }).result,
      'admitted', 'the store judges no target-set size of its own');
    assert.equal(store.fleetDrain(fields.drainId).targetWorkerIds.length, OVERSIZE);
    store.releaseWriterLease({ requireOwned: true });
    const replay = new CoordinationStore(directory, openOptions());
    assert.equal(replay.startupStatus().state, 'ready', 'and the row it wrote replays untouched');
    assert.equal(replay.fleetDrain(fields.drainId).targetWorkerIds.length, OVERSIZE);
    replay.releaseWriterLease();
  } finally {
    store.releaseWriterLease();
  }
});

// ===========================================================================
// (c) the literals are gone, and ONE helper reads ONE registry row
// ===========================================================================

/** The source of one site. A site named by its member resolves through the live seam map — the class
 * delegate and, for a member the split moved, the body in the module that holds it (issue #259
 * slices 4-5 moved the run-stop target helpers and the target-set helper out of the class). A site
 * named by a literal header reads the file of the store's module scope that carries it. */
function siteSource(open, next) {
  if (!open.includes('(')) {
    const source = memberSource(open);
    assert.notEqual(source, '', `the live map still carries the member ${open}`);
    return source;
  }
  for (const file of STORE_MODULE_FILES) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const start = source.indexOf(open);
    if (start === -1) continue;
    if (next === undefined) return source.slice(start);
    const end = source.indexOf(next, start + open.length);
    assert.ok(end > start, `the site bounded by ${next} is intact`);
    return source.slice(start, end);
  }
  return assert.fail(`no store module still carries ${open}`);
}

// The three sites the brief names: the fleet-drain admission, the run-stop target helpers
// (`_runStopContextTargets` + `_runStopTargets`), and the run-stop admission — by member name, so a
// moved member's text is read where it lives.
const SITES = ['_validateFleetDrainAdmission', '_runStopContextTargets', '_validateRunStopAdmission'];

test('the target-set literals are gone from the three sites, and the ONE helper is judged at admission only', () => {
  for (const name of SITES) {
    const source = siteSource(name);
    assert.equal(source.includes('100_000'), false,
      `${name} still carries a literal target-set ceiling: the ledger is the physical resource`);
  }
  const fleetDrain = siteSource(SITES[0]);
  const runStop = siteSource(SITES[2]);
  assert.match(runStop, /if \(!integrity\) \{?\s*\n?\s*assertTargetSetAdmissible\(/u,
    'the run-stop admission judges its target set through the ONE helper, under `!integrity`: the '
    + 'fold applies no ceiling, so a recorded row is never re-judged for size on replay');
  assert.equal(fleetDrain.includes('assertTargetSetAdmissible('), false,
    'the fleet-drain admission derives no ledger bound: its target set is the local controller\'s '
    + 'live fleet, not a projection of this ledger');
  assert.match(fleetDrain, /_drainPolicy\.maxWorkers/u,
    'and the site names the bound that does apply to a drain (the deployment\'s own drain policy)');
  // The fold path itself: the target helpers state why they carry no ceiling at all — both of them,
  // the window this pin always read (from `_runStopContextTargets` through `_runStopTargets`).
  const targetHelpers = [siteSource('_runStopContextTargets'), siteSource('_runStopTargets')].join('\n');
  assert.equal(/run stop target set exceeds capacity|run stop Context target set exceeds capacity/u
    .test(targetHelpers), false,
  'the helpers reached from the fold carry no capacity refusal');
  assert.match(targetHelpers, /projection of the ledger/u, 'they state the derivation instead');
  assert.match(targetHelpers, /returns? from the FOLD|reached from the FOLD/u,
    'and they say why the fold may not judge one');
});

test('the surviving bound is ONE declared registry row whose derivation is the ledger itself', () => {
  const row = TARGET_SET_ROW;
  assert.ok(row, 'the registry declares the target-set bound (stage: target-set-registry-row-missing)');
  assert.equal(row.class, 'admission');
  assert.equal(row.unit, 'targets_per_event', 'the row is a multiplier over the ledger, not a byte count');
  assert.equal(row.value, 1, 'one target per ledger event: every target costs the ledger a row');
  assert.equal(row.graceful ?? null, null);
  assert.equal(row.refusalCode, 'target_set_capacity');
  assert.equal(typeof row.enforcedAt, 'string', 'the row names its enforcement seam');
  // The helper is a module-scope function of the store's module scope, so the live map carries it by
  // name — the same lookup the member sites above use (issue #259 slice 5 moved it with the bucket).
  const helper = siteSource('assertTargetSetAdmissible');
  assert.match(helper, /FRAME_LIMITS\['target_set\.per_ledger_event'\]/u,
    'the helper reads the row by name — the store re-declares no bound of its own');
  assert.equal(helper.includes('100_000'), false, 'the helper carries no literal bound');
});

// ===========================================================================
// (d) checkpoint restore agrees with full replay
// ===========================================================================

test('restoring the projection checkpoint of an oversize-drain ledger agrees with a full replay', () => {
  const ledger = oversizeDrainLedger('drain-checkpoint');
  const writer = new CoordinationStore(ledger.directory, openOptions());
  writer.claimWriterLease();
  writer.releaseWriterLease({ requireOwned: true });
  const release = writer.checkpointReleaseState();
  assert.equal(release?.state, 'written', 'the clean release wrote the checkpoint');

  const restored = new CoordinationStore(ledger.directory, openOptions());
  const status = restored.startupStatus();
  assert.equal(status.checkpoint, 'valid', 'the checkpoint validates from its own recorded shape');
  assert.notEqual(status.source, 'ledger_fallback', 'the oversize row was applied from the checkpoint cache');
  const restoredDrain = restored.fleetDrain(ledger.drainId);
  assert.equal(restoredDrain.targetWorkerIds.length, OVERSIZE);
  assert.equal(restored.snapshot().lastSeq, 2);
  restored.releaseWriterLease();

  // The same ledger replayed in full: delete the cache and reopen.
  rmSync(join(ledger.directory, 'projection.checkpoint'), { force: true });
  const full = new CoordinationStore(ledger.directory, openOptions());
  assert.equal(full.startupStatus().source, 'ledger', 'the second open replays the ledger itself');
  assert.deepEqual(full.fleetDrain(ledger.drainId), restoredDrain,
    'the restored projection and the full replay project the same drain');
  assert.equal(full.snapshot().lastSeq, restored.snapshot().lastSeq);
  full.releaseWriterLease();
});

test('restoring the projection checkpoint of a large recorded run agrees with the replay that wrote it', () => {
  const ledger = bigRunLedger();
  const full = new CoordinationStore(ledger.directory, openOptions());
  const replayed = full.runStop(RUN_ID);
  assert.equal(replayed.targetTaskIds.length, OVERSIZE);
  full.claimWriterLease();
  // compact() is the operator verb that writes the checkpoint unconditionally; the release write
  // is bounded (#351) and skips a ledger this large — which is why the archived prefix is the
  // interesting restore here: the stop row is then applied from the checkpoint's parsed cache.
  const compacted = full.compact({ beforeSeq: ledger.stopSeq });
  assert.equal(compacted.archivedThroughSeq, ledger.stopSeq - 1);
  assert.equal(compacted.windowEvents, 1);
  full.releaseWriterLease({ requireOwned: true });

  const restored = new CoordinationStore(ledger.directory, openOptions());
  const status = restored.startupStatus();
  assert.equal(status.checkpoint, 'valid', 'the compacted ledger restores its own checkpoint');
  assert.equal(status.source, 'segments_checkpoint', 'the archived prefix plus the cached window');
  assert.deepEqual(restored.runStop(RUN_ID), replayed,
    'the restored projection projects the very stop the full replay did');
  assert.equal(restored.snapshot().tasks.length, OVERSIZE);
  assert.equal(restored.snapshot().lastSeq, ledger.stopSeq);
  restored.releaseWriterLease();
});
