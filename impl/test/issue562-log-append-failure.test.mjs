// issue562-log-append-failure.test.mjs — issue #562, second half.
//
// The observed failure: one failed operational-log append left the resident poisoned permanently
// while it kept serving, and every swarm view then failed (the reads the views ride went through
// the same fatal gate, runtime-admission.mjs `_assertReadable`).
//
// The repair pinned here: an append failure fails the ONE act that attempted it, with a typed
// error carrying the cause and the worker whose log refused it. The coordinator is not poisoned —
// every other act keeps working, the reads the views ride included, and the next append is
// attempted normally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { MockAdapter } from '../src/index.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const brief = (goal) => ({
  goal, constraints: [], pathScope: [], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 },
});

/**
 * A coordinator whose operational-log append refuses while `state.failing` holds, then behaves —
 * the ONE seam the failure reaches, so the act under test is the only thing that can fail.
 *
 * Every directory this fixture makes is reaped with the test (the suite's fixture containment
 * law), and only after the coordinator's own workers are quiesced: the mock adapter's turn still
 * appends, and a reap that raced it would surface as an unhandled rejection.
 */
function fixture(t) {
  const made = [];
  const dir = () => { const value = mkdtempSync(join(tmpdir(), 'baton-issue562-')); made.push(value); return value; };

  const rawLog = new Log(dir());
  const append = rawLog.append.bind(rawLog);
  const state = { failing: true, refused: 0 };
  rawLog.append = (event) => {
    if (state.failing && event.kind === 'lifecycle.spawned') {
      state.refused += 1;
      throw new Error('disk full');
    }
    return append(event);
  };
  const coordination = new CoordinationStore(dir());
  const coordinator = new Coordinator({
    log: rawLog,
    fences: new FenceTable(),
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed' } }) },
    coordination,
    worktrees: { create: async () => ({ path: dir() }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => 'mock',
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; the watchdog never fires in this window
  });
  t.after(async () => {
    await Promise.allSettled([...coordinator._workers.values()].map((handle) => (
      coordinator._emergencyKillUnlogged(handle))));
    for (const value of made) rmSync(value, { recursive: true, force: true });
  });
  return { coordinator, state, coordination };
}

test('S562-A: a failed append fails that one act with the typed error naming its cause', async (t) => {
  const f = fixture(t);
  const failure = await f.coordinator
    .spawn('mock', brief('first'), { taskId: 'append-fails' })
    .then(() => null, (error) => error);

  assert.ok(failure, 'the act fails');
  assert.equal(failure.code, 'operational_log_unavailable', 'the typed code is unchanged for callers');
  assert.equal(failure.name, 'OperationalLogIntegrityError');
  assert.match(failure.message, /append failed: disk full/u, 'the message names the cause');
  assert.equal(failure.cause?.message, 'disk full', 'the cause rides the error');
  assert.equal(f.state.refused, 1, 'exactly the one append this act attempted was refused');
});

test('S562-B: the failed append does not poison the coordinator — every other act keeps working', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.coordinator.spawn('mock', brief('first'), { taskId: 'append-fails' }),
    (error) => error.code === 'operational_log_unavailable');

  assert.equal(f.coordinator._fatalError, null, 'no fatal error is recorded');
  assert.equal(Array.isArray(f.coordinator.list()), true,
    'the list read answers — this is the read every swarm view fails on when the coordinator is poisoned');
  assert.equal(f.coordinator._appendFailures, 1, 'the failure is tallied, never fatal');

  // The next append is attempted normally: the failure belonged to that act, not to the log.
  f.state.failing = false;
  const handle = await f.coordinator.spawn('mock', brief('second'), { taskId: 'append-succeeds' });
  assert.equal(f.coordinator.list().some((row) => row.id === handle.id), true,
    'the second act published its handle');
  assert.equal(f.coordination.task('append-succeeds')?.status, 'working',
    'and its durable claim landed');
  assert.equal(f.state.refused, 1, 'no further append was refused');
});

test('S562-C: a log that keeps refusing fails each act alike and the coordinator still serves reads', async (t) => {
  const f = fixture(t);
  for (const taskId of ['append-fails-1', 'append-fails-2']) {
    await assert.rejects(
      f.coordinator.spawn('mock', brief(taskId), { taskId }),
      (error) => error.code === 'operational_log_unavailable' && error.cause?.message === 'disk full');
  }
  assert.equal(f.coordinator._fatalError, null, 'two refused appends are still not a poison');
  assert.equal(Array.isArray(f.coordinator.list()), true, 'reads keep answering');
  assert.equal(f.coordinator._appendFailures, 2, 'both failures are tallied');
});
