// Issue #221 residual — a seat-ceiling deferral NAMES its reason, and the ceiling stays.
//
// The #221 ruling killed the invented seat-ceiling pre-cap and the silent skip it produced. What
// survived is the operator-facing policy the audit restaged (docs/audits/2026-09-13-runtime-policy/
// admission.md): a CONFIGURED ceiling is enforced on exact and auto routes alike, and the wait is a
// durable `task.dispatch_deferred` receipt. This suite pins the residual: that receipt, and the wait
// it projects, carry the deferral's REASON — read from the same seat-ceiling predicate the pre-cap
// applies, never a number re-derived by a second scan — while the declared `concurrencyCeiling`
// field itself stays.
//
// RED at HEAD: the receipt carries {taskId, vendor, ceiling, inFlight, taskCreatedSeq} with no
// reason, and the projected `capacity_ceiling` wait carries none either.
//
// Rows:
//   DR-0  the deferral reason vocabulary is exported and derives from the seat-ceiling predicate
//         (RED: reason-vocabulary-missing)
//   DR-1  the exact-route deferral receipt names the reason (RED: deferral-reason-missing)
//   DR-2  the auto-route pre-cap deferral names the SAME reason (RED: deferral-reason-missing)
//   DR-3  the pre-cap advice row and the durable deferral name one reason word
//         (RED: reason-vocabulary-missing)
//   DR-4  PIN: the declared ceiling and the frozen in-flight observation stay on the receipt
//   DR-5  an omitted reason is recorded as null, never an absent key or a fabricated word
//         (RED: deferral-reason-missing)
//   DR-6  a reason outside the closed vocabulary refuses — telemetry is never unreadable prose
//         (RED: reason-vocabulary-unvalidated)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
// Absence-proof access (the suite's own convention): the module is imported as a namespace so a
// missing export reports the named stage on its ROW instead of killing the file at load.
import * as concurrencyPolicy from '../src/concurrency-policy.mjs';
import { AdaptiveRouter as Router } from '../src/router.mjs';

const dirs = [];
function tmpDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// The closed reason vocabulary this suite pins — one word with the router's own advice row
// (`AdaptiveRouter.advice` labels a gated candidate `concurrency_saturated`).
const REASON = 'concurrency_saturated';

function makeBrief(overrides = {}) {
  return {
    goal: 'do the thing', constraints: [], pathScope: ['.'], definitionOfDone: 'ok',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, ...overrides,
  };
}

/** The minimal adapter double with a real modelSelection, so the auto path can select it. */
class ScriptableAdapter {
  constructor({ harness = 'mock', concurrencyCeiling = null } = {}) {
    this._card = {
      harness, version: '1.0.0', authPosture: 'api_key', concurrencyCeiling, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'claim',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null,
        provenance: 'issue221-test', refreshedAt: null,
      },
    };
    this.calls = { spawn: [] };
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

class SpyWorktreeManager {
  constructor() { this.calls = { create: [], reconcile: [] }; }
  async create(taskId) { this.calls.create.push({ taskId }); return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; }
  async capture() { return { sha: 'sha-result' }; }
  async createVerifyWorktree(taskId) { return { path: `/tmp/verify/${taskId}` }; }
  async removeVerifyWorktree() {}
  async remove() {}
  async reconcile() { this.calls.reconcile.push({}); }
  worktreeAvailable() { return true; }
}

function setup({ adapters, route }) {
  const log = new Log(join(tmpDir('baton-221-log-'), 'log'));
  const coordination = coordinationForLog(log);
  const worktrees = new SpyWorktreeManager();
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters, worktrees,
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route, now: () => 0,
  });
  return { coordinator, coordination, worktrees };
}

const deferredReceipts = (coordination) => coordination.events(1)
  .filter((event) => event.kind === 'task.dispatch_deferred');

/** One ceiling-skipped task: the first holds the only configured seat, the second is deferred. */
async function deferredExactTask() {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  const { coordinator, coordination } = setup({ adapters: { mock: adapter }, route: () => 'mock' });
  const first = await coordinator.spawn('mock', makeBrief(), { taskId: 'exact-a' });
  assert.equal(first.status, 'working', 'fixture: the first task holds the only configured seat');
  const second = await coordinator.spawn('mock', makeBrief(), { taskId: 'exact-b' });
  assert.equal(second.status, 'pending', 'fixture: the configured ceiling defers the second task');
  return { coordinator, coordination, second };
}

test('DR-0 (RED): the deferral reason vocabulary is exported and derives from the seat-ceiling predicate', () => {
  assert.equal(typeof concurrencyPolicy.SEAT_CEILING_REASON, 'string',
    'stage[reason-vocabulary-missing]: the deferral reason is one exported word');
  assert.equal(concurrencyPolicy.SEAT_CEILING_REASON, REASON,
    'stage[reason-vocabulary-missing]: one vocabulary with the router advice row');
  assert.equal(typeof concurrencyPolicy.seatCeilingReason, 'function',
    'stage[reason-vocabulary-missing]: the reason is read from the seat-ceiling predicate');
  assert.equal(concurrencyPolicy.seatCeilingReason(1, 0), null, 'a free configured seat is not a reason');
  assert.equal(concurrencyPolicy.seatCeilingReason(1, 1), REASON, 'a full configured seat is the reason');
  assert.equal(concurrencyPolicy.seatCeilingReason(null, 99), null, 'an unbounded card is never gated');
});

test('DR-1 (RED): the exact-route ceiling deferral receipt names its reason', async () => {
  const { coordination } = await deferredExactTask();
  const receipt = deferredReceipts(coordination)[0];
  assert.ok(receipt, 'fixture: the wait is ledgered');
  assert.equal(receipt.payload.reason, REASON,
    'stage[deferral-reason-missing]: the durable deferral names the gate that produced it');
});

test('DR-2 (RED): the auto-route pre-cap deferral names the same reason', async () => {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  // A router that ignores the in-flight counts it is handed: the pre-cap in route() is what
  // actually excludes the saturated candidate, so the receipt must name that gate.
  const { coordinator, coordination } = setup({ adapters: { mock: adapter }, route: () => 'mock' });
  const first = await coordinator.spawn('auto', makeBrief(), { taskId: 'auto-a', model: 'mock-model', effort: 'low' });
  assert.equal(first.status, 'working', 'fixture: the auto route resolved and dispatched the first task');
  const second = await coordinator.spawn('auto', makeBrief(), { taskId: 'auto-b', model: 'mock-model', effort: 'low' });
  assert.equal(second.status, 'pending', 'fixture: the second auto task waits at the configured ceiling');
  const receipt = deferredReceipts(coordination).find((event) => event.payload.taskId === 'auto-b');
  assert.ok(receipt, 'fixture: the auto deferral is ledgered');
  assert.equal(receipt.payload.reason, REASON,
    'stage[deferral-reason-missing]: the pre-cap deferral names the same gate as the exact-route one');
});

test('DR-3 (RED): the pre-cap advice row and the durable deferral name ONE reason word', async () => {
  // The router's own read-only advice surface already labels a gated candidate. The deferral's
  // reason is that same word, read from the one exported vocabulary — a reader never has to map
  // two spellings of one fact.
  const router = new Router({ mode: 'round-robin' });
  const advice = router.advice({ taskType: 'general' }, [
    { modelVersion: 'm', family: 'f', concurrencyCeiling: 2, inFlight: 2 },
  ]);
  assert.equal(advice.rows[0].eligible, false, 'fixture: the candidate is at its configured ceiling');
  assert.equal(advice.rows[0].reason, REASON, 'the advice row names the saturated seat');
  assert.equal(advice.rows[0].reason, concurrencyPolicy.SEAT_CEILING_REASON,
    'stage[reason-vocabulary-missing]: the advice word IS the exported deferral reason vocabulary');

  const { coordination } = await deferredExactTask();
  assert.equal(deferredReceipts(coordination)[0].payload.reason, advice.rows[0].reason,
    'stage[reason-vocabulary-missing]: the durable deferral and the advice row read one vocabulary');
});

test('DR-4 (PIN): the declared ceiling and the frozen in-flight observation stay on the receipt', async () => {
  const { coordination, second } = await deferredExactTask();
  const receipt = deferredReceipts(coordination)[0];
  assert.equal(receipt.payload.vendor, 'mock');
  assert.equal(receipt.payload.ceiling, 1, 'PIN: the configured ceiling field is never removed');
  assert.equal(receipt.payload.inFlight, 1, 'PIN: the mint-time in-flight observation stays');
  assert.equal(receipt.payload.taskId, second.taskId);
  assert.ok(Number.isSafeInteger(receipt.payload.taskCreatedSeq), 'PIN: the idempotency anchor stays');
});

test('DR-5 (RED): an omitted reason is recorded as null — a reader never sees an absent key or an invented word', () => {
  const log = new Log(join(tmpDir('baton-221-legacy-log-'), 'log'));
  const coordination = coordinationForLog(log);
  const appended = coordination.deferTaskDispatch({
    taskId: 'legacy-1', vendor: 'mock', ceiling: 1, inFlight: 1, taskCreatedSeq: 1,
  }, { actor: 'orchestrator', key: 'task.dispatch_deferred:legacy-1:1' });
  assert.equal(appended.ok, true, 'fixture: the receipt appends');
  const row = deferredReceipts(coordination)[0];
  assert.equal(Object.hasOwn(row.payload, 'reason'), true,
    'stage[deferral-reason-missing]: the field is always present on a deferral receipt');
  assert.equal(row.payload.reason, null,
    'a deferral that recorded no gate reads an honest null — never a fabricated word');
});

test('DR-6 (RED): a reason outside the closed vocabulary refuses the receipt', () => {
  const log = new Log(join(tmpDir('baton-221-bad-log-'), 'log'));
  const coordination = coordinationForLog(log);
  assert.throws(
    () => coordination.deferTaskDispatch({
      taskId: 'bad-1', vendor: 'mock', ceiling: 1, inFlight: 1, reason: 'provider_rate_limited', taskCreatedSeq: 1,
    }, { actor: 'orchestrator', key: 'task.dispatch_deferred:bad-1:1' }),
    (error) => error.code === 'dispatch_deferral_invalid',
    'a deferral reason outside the closed vocabulary refuses rather than landing unreadable telemetry',
  );
  assert.equal(deferredReceipts(coordination).length, 0, 'the refused deferral appended nothing');
});
