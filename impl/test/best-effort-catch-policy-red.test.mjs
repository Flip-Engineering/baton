// 2026-09-14 audit G-46: "Seventy-seven silent-catch sites in coordinator.mjs encode two very
// different policies with one syntax."
//
// Most are genuine best-effort audit writes — the comment says so. But `.catch(noop)` on
// `_runTrustGate`, on `_beginStop` and on `_cleanupClosedTransport` discards the outcome of the
// operation ITSELF, not an observation about it, and there was no typed distinction between the
// two: indistinguishable to a reader, to a grep, and to any future refactor.
//
// The split this suite pins:
//   * `bestEffort(promise, reason)` / `_bestEffortSync(run, reason)` — OBSERVATIONAL. The rejection
//     is recorded under its reason and never touches the operation it observed.
//   * `_recordOperationFailure(...)` — OPERATIONAL. The rejection IS the outcome, so it lands as a
//     typed event on the worker's own stream.
//   * Zero `.catch(noop)` remains in coordinator.mjs: the count of the dangerous class is zero, and
//     the count of the observational class is the count of the named helper.
//
// Red-first: every RED row fails at a NAMED stage against the PRE-implementation tree. Hermetic:
// mock adapters, tmp dirs, test.after cleanup, microtask drains only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const COORDINATOR_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/coordinator.mjs', import.meta.url)), 'utf8',
);
const SHA = 'a'.repeat(40);

async function flush(times = 60) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function fixture(t, { story = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-besteffort-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  let emit = null;
  const prompts = [];
  const adapter = {
    card: () => ({ harness: 'mock', version: '1.0.0', concurrencyCeiling: null, maxContext: 100000 }),
    onEvent(callback) { emit = callback; },
    async spawn() { return { ok: true }; },
    async prompt(worker, content, mode) { prompts.push({ worker, content, mode }); return { ok: true }; },
    async kill() { return { ok: true }; },
  };
  const log = new Log(join(directory, 'log'));
  const worktrees = {
    async create(id) { return { path: `/owned/${id}`, baseSha: SHA, branch: `baton/${id}` }; },
    async capture() { return { sha: SHA, baseSha: SHA, changedPaths: [] }; },
    async createVerifyWorktree(id) { return { path: `/check/${id}` }; },
    async removeVerifyWorktree() {},
    async remove() {},
    async reconcile() {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: async () => ({ reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' }),
    route: () => 'mock',
    now: () => 0,
    ...(story ? { story } : {}),
  });
  return { coordinator, log, prompts, adapter, emit: (event) => emit(event) };
}

function spawnBrief() {
  return {
    goal: 'Prove the catch policy split', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the receipts say what happened',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
  };
}

// ===========================================================================
// The split is countable at the source level — the audit's own complaint
// ===========================================================================

test('G-46 (RED): no silent `.catch(noop)` remains in coordinator.mjs', () => {
  const matches = COORDINATOR_SOURCE.match(/\.catch\(noop\)/gu) ?? [];
  const inComments = (COORDINATOR_SOURCE.match(/^\s*\*.*\.catch\(noop\)/gmu) ?? []).length;
  assert.equal(matches.length, inComments,
    'stage[operational-catch-silenced]: every occurrence is documentation — no live call site swallows an outcome');
});

test('G-46 (RED): the three operational families route through a receipting wrapper', () => {
  for (const wrapper of ['_stopInBackground', '_cleanupTransportInBackground', '_recordTrustGateEscape']) {
    assert.ok(COORDINATOR_SOURCE.includes(wrapper),
      `stage[operational-receipt-missing]: ${wrapper} exists`);
  }
  // A bare fire-and-forget stop is exactly what the receipting wrapper replaced.
  assert.equal(/this\._beginStop\([^)]*\)\.catch\(/u.test(COORDINATOR_SOURCE), false,
    'stage[operational-catch-silenced]: no fire-and-forget `_beginStop(...).catch(...)` call site is left');
  assert.equal(/this\._cleanupClosedTransport\([^)]*\)\.catch\(/u.test(COORDINATOR_SOURCE), false,
    'stage[operational-catch-silenced]: no fire-and-forget transport cleanup is left');
  assert.ok(COORDINATOR_SOURCE.includes("this._runTrustGate(handle, wr))")
    && COORDINATOR_SOURCE.includes('this._recordTrustGateEscape(handle, error)'),
  'stage[operational-catch-silenced]: the trust gate call site names its escape handler');
});

// ===========================================================================
// bestEffort — observational, recorded, and never an outcome
// ===========================================================================

test('G-46 (RED): an observational rejection is recorded under its reason and changes nothing', async (t) => {
  const f = fixture(t);
  assert.deepEqual(f.coordinator.recordedFailures(), [],
    'stage[failure-registry-missing]: nothing recorded before anything fails');
  const value = await f.coordinator._bestEffort(
    Promise.reject(Object.assign(new Error('audit lane refused'), { code: 'audit_lane_refused' })),
    'lane_delivery_audit',
  );
  assert.equal(value, undefined, 'the observational catch resolves — a caller never sees the rejection');
  assert.deepEqual(f.coordinator.recordedFailures(), [{
    reason: 'lane_delivery_audit', count: 1, lastCode: 'audit_lane_refused', lastMessage: 'audit lane refused',
  }], 'the reason, the code and the message are all recorded');

  // The sync twin behaves identically for the audit writes that are not promises.
  const syncValue = f.coordinator._bestEffortSync(() => {
    throw Object.assign(new Error('grant refused'), { code: 'grant_refused' });
  }, 'context_pack_grant_audit');
  assert.equal(syncValue, undefined);
  const rows = f.coordinator.recordedFailures();
  assert.equal(rows.find((row) => row.reason === 'context_pack_grant_audit')?.lastCode, 'grant_refused');

  // ...and an observational failure never moves the operation it observed.
  const ok = await f.coordinator._bestEffort(Promise.resolve('delivered'), 'lane_delivery_audit');
  assert.equal(ok, 'delivered', 'a healthy observation passes its own value through untouched');
});

test('G-46 (RED): a broken story sink is recorded, and the append it observed still lands', async (t) => {
  const f = fixture(t, { story: { record() { throw new Error('the sink is broken'); } } });
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  assert.ok(handle.id, 'the spawn completed with a broken story sink attached');
  const failures = f.coordinator.recordedFailures().filter((row) => row.reason === 'story_sink');
  assert.equal(failures.length, 1,
    'stage[story-sink-silenced]: the broken sink is a named fact, not a silent no-op');
  assert.equal(failures[0].lastMessage, 'the sink is broken');
  assert.ok(f.log.read(handle.id).length > 0, 'the operational log still recorded the events the sink observed');
});

// ===========================================================================
// The operational catches carry durable receipts
// ===========================================================================

test('G-46 (RED): a rejected trust gate becomes a typed task event, never silence', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  // The gate's own final statement deliberately rethrows a verification-cleanup error; anything
  // else that escapes it (a poisoned write, a bug in the body) is the same class of fact.
  const escaped = Object.assign(new Error('verification cleanup failed for 1 owned sandbox'), {
    code: 'worktree_cleanup_failed',
  });
  f.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: {
      status: 'completed', progress: 1, summary: 'done', artifacts: { commits: [], files: [] },
      verification: { command: 'true', claimedExit: 0 }, budgetUsed: { tokens: 1, usd: 0 },
    },
  });
  await flush();
  // Drive the exact call site the audit names, after the gate has already run once.
  f.coordinator._recordTrustGateEscape(handle, escaped);
  const escapes = f.log.read(handle.id).filter((event) => event.payload?.reason === 'trust_gate_escape');
  assert.equal(escapes.length, 1,
    'stage[trust-gate-escape-silenced]: the escape is a durable typed event');
  assert.equal(escapes[0].kind, 'error', 'it stays in the error family the gate itself uses');
  assert.equal(escapes[0].payload.code, 'worktree_cleanup_failed', 'the typed cause survives');
  assert.equal(escapes[0].payload.phase, 'trust_gate', 'the gate owns it — the phase names the path');
  assert.match(escapes[0].payload.outcome, /did not reach its own terminal handling/u);
  assert.equal(escapes[0].payload.message, escaped.message, 'the refusal message is carried, not paraphrased');
});

test('G-46 (RED): a rejected fire-and-forget stop is a typed event naming what failed', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  // A poisoned stop state machine: the in-memory transport is fine, the durable write is not.
  const stop = f.coordinator._beginStop;
  f.coordinator._beginStop = async () => {
    throw Object.assign(new Error('coordination write refused'), { code: 'coordination_unavailable' });
  };
  await f.coordinator._stopInBackground(handle);
  f.coordinator._beginStop = stop;
  await flush();
  const receipts = f.log.read(handle.id).filter((event) => event.kind === 'control.stop_unavailable');
  assert.equal(receipts.length, 1,
    'stage[stop-failure-silenced]: a stop that never started is a durable fact');
  assert.equal(receipts[0].payload.code, 'coordination_unavailable', 'the cause is named');
  assert.equal(receipts[0].payload.reason, 'stop_unavailable', 'and so is the policy reason');
  assert.equal(receipts[0].payload.mode, 'kill', 'and what was attempted');
  // The operational failure never lands in the observational registry — the split is real.
  assert.equal(f.coordinator.recordedFailures().some((row) => row.reason === 'stop_unavailable'), false,
    'the operational receipt is durable; it is not an observational counter');
});

test('G-46 (RED): a rejected transport cleanup is a typed event naming the stop it belonged to', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  const task = f.coordinator._tasks.get(handle.taskId);
  const stopEvent = { seq: 7 };
  f.coordinator._cleanupClosedTransport = async () => {
    throw Object.assign(new Error('runtime cleanup failed'), { code: 'runtime_cleanup_failed' });
  };
  await f.coordinator._cleanupTransportInBackground(handle, task, stopEvent);
  await flush();
  const receipts = f.log.read(handle.id).filter((event) => event.kind === 'control.transport_cleanup_unavailable');
  assert.equal(receipts.length, 1,
    'stage[cleanup-failure-silenced]: a cleanup that never ran is a durable fact');
  assert.equal(receipts[0].payload.code, 'runtime_cleanup_failed');
  assert.equal(receipts[0].payload.stopSeq, 7, 'the receipt names the stop whose cleanup this was');
});

test('G-46 (RED): a receipt the log itself refuses is still named, and never thrown', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  const append = f.coordinator._log.append;
  f.coordinator._log.append = () => { throw new Error('the log is gone'); };
  await f.coordinator._stopInBackground(handle); // the stop itself fails too (its first append throws)
  f.coordinator._log.append = append;
  const rows = f.coordinator.recordedFailures();
  assert.ok(rows.some((row) => row.reason === 'control.stop_unavailable:append_refused'),
    'stage[receipt-loss-silenced]: a receipt that could not be written is still a named reason');
  assert.ok(rows.some((row) => row.reason === 'stop_unavailable'));
  assert.equal(rows.find((row) => row.reason === 'control.stop_unavailable:append_refused')?.count, 1);
});
