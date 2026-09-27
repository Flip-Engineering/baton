// Phase 92 RED contracts for the measured replay hot path. These fixtures prove bounded parsing
// and request-ledger behavior only; they are not live-provider or PID-liveness evidence.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { BatonApplication } from '../src/application.mjs';

const root = (t, label) => {
  const value = mkdtempSync(join(tmpdir(), `baton-phase92-${label}-`));
  t.after(() => rmSync(value, { recursive: true, force: true }));
  return value;
};

test('P92-LR1: one worker JSONL is parsed once and exact/range reads use the in-memory index', (t) => {
  const directory = root(t, 'indexed-log');
  const writer = new Log(directory);
  for (let index = 1; index <= 1_000; index += 1) {
    writer.append({
      worker: 'worker-a', harness: 'fixture', turnEpoch: 1,
      kind: 'progress', actor: 'worker', payload: { index },
    });
  }

  const replay = new Log(directory);
  for (let index = 1; index <= 1_000; index += 1) {
    assert.equal(replay.at('worker-a', index).seq, index);
  }
  assert.equal(replay.range('worker-a', 500).length, 500);
  assert.equal(replay.read('worker-a', 999).length, 2);
  assert.deepEqual(replay.readStats(), {
    schemaVersion: 1, parsedWorkers: 1, parsePasses: 1, parsedEvents: 1_000,
  });
});

test('P92-LR1b: an indexed reader incrementally sees another Log instance append without reparsing its prefix', (t) => {
  const directory = root(t, 'append-aware-log');
  const writer = new Log(directory);
  const event = (index) => ({
    worker: 'worker-a', harness: 'fixture', turnEpoch: 1,
    kind: 'progress', actor: 'worker', payload: { index },
  });
  writer.append(event(1));
  const reader = new Log(directory);
  assert.equal(reader.at('worker-a', 1).payload.index, 1);
  writer.append(event(2));
  assert.equal(reader.at('worker-a', 2).payload.index, 2);
  assert.equal(reader.read('worker-a').length, 2);
  assert.deepEqual(reader.readStats(), {
    schemaVersion: 1, parsedWorkers: 1, parsePasses: 2, parsedEvents: 2,
  });
});

test('P92-LR2: claiming writer authority after construction does not fold coordination twice', (t) => {
  const directory = root(t, 'single-fold');
  let loads = 0;
  class CountingStore extends CoordinationStore {
    _load() { loads += 1; return super._load(); }
  }
  const store = new CountingStore(directory);
  store.recordDriver('phase92.single.fold', { ok: true }, {
    actor: 'test:phase92', key: 'phase92:single-fold',
  });
  assert.equal(loads, 1);
  store.releaseWriterLease({ requireOwned: true });
});

test('P92-LR3: approved-Run reconciliation uses a narrow Run index without cloning the full snapshot per Run', async () => {
  let fullSnapshots = 0;
  let indexedLists = 0;
  let indexedReads = 0;
  const application = {
    repoId: 'repo-phase92',
    driver: { coordination: {
      snapshot() { fullSnapshots += 1; throw new Error('full snapshot is forbidden'); },
      goalPlanRunIds(repoId) {
        indexedLists += 1;
        assert.equal(repoId, 'repo-phase92');
        return Array.from({ length: 1_000 }, (_, index) => `run-${index}`);
      },
      goalPlanRun(repoId, runId) {
        indexedReads += 1;
        return {
          goal: { repoId, runId, constraints: ['Baton deployment profile phase92@digest-phase92'] },
          plan: null, approval: null,
          dispatch: null, dispatches: [],
        };
      },
      runStop() { return null; },
    } },
    profiles: new Map(), _profileRegistry: new Map(),
    _assertOpen() {}, _reconcileContextCalls: async () => false,
    _dispatchCurrent: async () => { throw new Error('unplanned Run must not dispatch'); },
  };
  application._findRun = BatonApplication.prototype._findRun.bind(application);
  // Issue #89 Decision 4 item 4: _findRun resolves spilled objectives at the projection seam —
  // a passthrough for non-spilled goals (this stub's records carry none), orthogonal to the pin's
  // law (narrow index, zero full snapshots) which remains what this row measures.
  application._resolveSpillObjective = BatonApplication.prototype._resolveSpillObjective.bind(application);

  const result = await BatonApplication.prototype._reconcileApprovedRuns.call(application);
  assert.equal(result.examinedRuns, 1_000);
  assert.equal(indexedLists, 1);
  assert.equal(indexedReads, 1_000);
  assert.equal(fullSnapshots, 0);
});
