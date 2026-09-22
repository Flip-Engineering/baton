// Issue #403 — the reap and drain windows ride the injectable clock, never the host's.
//
// Audit finding C30 (umbrella #382): `wait()` and `reapRunScratchpads` keyed their windows on host
// `Date.now()`, so tests and replay could not drive those deadlines while every sibling
// convergence window (the coordinator's `_sweepDeadlines`, the stall cycles) read the injectable
// clock the replay doctrine declares authoritative. Two sites carry the class:
//
//   * `runtime-recovery.mjs reapRunScratchpads(coordinator, recorder, runId)` — its deadline and
//     its per-pass check, and the store pass it drives (which now hands its own reading in);
//   * `runtime-observation.mjs drain(...)` — the fleet-drain deadline and the interaction-window
//     check inside it.
//
// Both rows here drive a clock the host cannot move and assert the window closes on it. The store
// lane's own pass reads the STORE's clock when no caller supplies one, so the same row shape works
// one level down.
//
// Suite law: hermetic (mkdtemp fixture, injected clock, no network, no processes).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { reapRunScratchpads } from '../src/runtime-recovery.mjs';

const RUN_ID = 'run-403-clock';
// The store clock is deliberately AHEAD of the host clock: only a window read through the store's
// own clock can be closed while the host's clock has not reached it.
const CLOCK_ISO = '2027-01-01T00:00:00.000Z';

test('the coordinator reap window expires on the injected clock, not the host clock (#403)', async () => {
  let nowMs = 1_000_000;
  let calls = 0;
  const coordinator = {
    _drainPolicy: { timeoutMs: 1_000, pollMs: 1, maxWorkers: 8, maxInteractions: 8 },
    _now: () => nowMs,
    _sleep: async () => { nowMs += 400; },
    tick() {},
  };
  const recorder = {
    coordination: {
      // A reap that keeps making progress for far longer than one window: only the deadline can
      // end it, and the host clock cannot reach it inside this test's lifetime.
      reapRunScratchpads: () => {
        calls += 1;
        return calls >= 6 ? { result: 'complete' }
          : { result: 'partial', remainingPartitions: 6 - calls, remainingEntries: 6 - calls };
      },
    },
  };
  await assert.rejects(reapRunScratchpads(coordinator, recorder, RUN_ID), (error) => {
    assert.equal(error.code, 'coordinator_scratchpad_reap_incomplete');
    assert.match(error.message, /did not converge before its deadline/u);
    return true;
  });
  assert.ok(nowMs >= 1_001_000, 'the window closed on the injected clock');
  assert.ok(calls < 6, 'the host clock never let the stub run to completion');
});

test('the store reap window reads the store own clock when the caller supplies none (#403)', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue403-'));
  try {
    const store = new CoordinationStore(root, { clock: () => CLOCK_ISO });
    store._runStopByTarget.set(RUN_ID, RUN_ID);
    const seed = (ordinal, taskId, workerId) => {
      const scope = `worker:${workerId}`;
      const entryId = `scratchpad-entry:${String(ordinal).repeat(64).slice(0, 64)}`;
      store._scratchpadEntries.set(entryId, {
        entryId, entryDigest: 'a'.repeat(64), runId: RUN_ID, taskId, workerId, scope,
        ordinal, kind: 'note', contentDigest: 'b'.repeat(64), content: { kind: 'note', text: 'held' },
        createdEvent: ordinal, createdAt: CLOCK_ISO, source: null, scratchFactId: null,
      });
      store._scratchpadEntriesByScope.set(JSON.stringify([RUN_ID, scope]), [entryId]);
    };
    seed(1, 'task-403-a', 'worker-403-a');
    seed(2, 'task-403-b', 'worker-403-b');

    const pass = store.reapRunScratchpads(RUN_ID, { deadlineAt: Date.parse(CLOCK_ISO) });
    assert.equal(pass.result, 'partial', 'the window is already closed on the store own clock');
    assert.equal(pass.remainingPartitions, 1, 'the pass takes exactly one partition and advances');
    assert.equal(pass.reaped.length, 1);
    const rest = store.reapRunScratchpads(RUN_ID, { deadlineAt: null });
    assert.equal(rest.result, 'complete', 'a null deadline still reaps every partition');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
