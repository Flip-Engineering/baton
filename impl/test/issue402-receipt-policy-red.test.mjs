// Issue #402 (audit C29, umbrella #382; principles P3): two failure paths bypassed the G-46
// receipt policy — the `contextRead` audit write and the `recordWorkerGeneration` store write.
// Both were bare catches: the first swallowed an audit rejection outright, the second returned
// `null` so a lost durable generation binding left no trace anywhere.
//
// The two policies G-46 names decide which writer each belongs to:
//   * the context-read audit is OBSERVATIONAL — the read itself stands, so the rejection is
//     recorded under its reason and never touches the read the worker asked for;
//   * the generation binding is OPERATIONAL — the write that failed IS the outcome, so it lands
//     as a typed event on the worker's own stream.
// The sites live in runtime-observation.mjs (the module the coordinator split moved them to);
// both are reached through the coordinator's own public members.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const SHA = 'a'.repeat(40);

async function flush(times = 60) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue402-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  let emit = null;
  const adapter = {
    card: () => ({ harness: 'mock', version: '1.0.0', concurrencyCeiling: null, maxContext: 100000 }),
    onEvent(callback) { emit = callback; },
    async spawn() { return { ok: true }; },
    async prompt() { return { ok: true }; },
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
  });
  return { coordinator, log, coordination: coordinator._recorder.coordination };
}

function spawnBrief() {
  return {
    goal: 'Prove a lost generation binding leaves a trace', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the receipts say what happened',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
  };
}

// The observational half: the audit rejection is named (never silenced) and the read it observed
// still answers the worker.
test('#402 (RED): a refused context-read audit is recorded under its reason, and the read still answers', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  const original = f.coordination.recordContextRead;
  assert.equal(typeof original, 'function', 'stage[audit-seam-missing]: the audit writer exists');
  f.coordination.recordContextRead = () => {
    throw Object.assign(new Error('coordination audit refused'), { code: 'coordination_unavailable' });
  };
  const read = f.coordinator.contextRead(handle.id, {
    expectedFence: 'current', idempotencyKey: 'issue402-context-read',
    query: { kind: 'knowledge', text: 'anything' },
  });
  f.coordination.recordContextRead = original;
  await flush();

  assert.equal(read.ok, true,
    'stage[observation-changed-operation]: the read stands on the operational log, not on its audit');
  const rows = f.coordinator.recordedFailures();
  const audit = rows.find((row) => row.reason === 'context_read_audit');
  assert.ok(audit, 'stage[context-read-audit-silenced]: the refused audit is a named reason, never a bare catch');
  assert.equal(audit.count, 1, 'and it is counted once per refusal');
  assert.equal(audit.lastCode, 'coordination_unavailable', 'the typed cause survives the recording');
  assert.equal(audit.lastMessage, 'coordination audit refused', 'and so does the message');
  assert.equal(f.log.read(handle.id).some((event) => event.payload?.reason === 'context_read_audit'), false,
    'the observational record is the reason registry, not the worker stream');
});

// The operational half. A task the coordinator never bound to a Run has no runId, and the store's
// binding record requires one — so the spawn-time binding is REFUSED BY THE STORE ITSELF. That
// refusal is the path the audit found silent: the worker runs on with no durable generation
// binding and, before this fix, nothing anywhere said so.
test('#402 (RED): a binding the store refuses leaves a typed trace of the generation it lost', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief());
  const receipts = f.log.read(handle.id).filter((event) => event.kind === 'worker.generation_unbound');
  assert.equal(receipts.length, 1,
    'stage[generation-binding-silenced]: a lost durable binding is a durable fact, never a bare return');
  assert.equal(receipts[0].payload.reason, 'generation_unbound', 'the policy reason is named');
  assert.equal(receipts[0].payload.code, 'worker_generation_invalid', 'the typed cause survives');
  assert.equal(receipts[0].payload.processGeneration, 1, 'the receipt names WHICH generation was lost');
  assert.equal(receipts[0].payload.taskId, handle.taskId, 'and the task the binding belonged to');
  assert.equal(receipts[0].payload.runId, null, 'and the run it could not name — here, none');
});

// The same path, driven directly against a store that refuses for its own reason: the method keeps
// its contract (null = not bound, the caller re-binds on the next spawn) and the loss is durable.
test('#402 (RED): a refused generation binding is a typed event on the worker stream, and the call still answers null', async (t) => {
  const f = fixture(t);
  const handle = await f.coordinator.spawn('mock', spawnBrief(), { runId: 'run-402', taskId: 'task-402' });
  // `spawn` answers the caller's projection; the generation lives on the live handle the
  // coordinator itself binds, which is the one the binding path is handed.
  const worker = f.coordinator._workers.get(handle.id);
  assert.ok(Number.isSafeInteger(worker?.processGeneration) && worker.processGeneration > 0,
    'stage[generation-unset]: a bound worker carries the process generation the binding names');
  assert.deepEqual(f.log.read(handle.id).filter((event) => event.kind === 'worker.generation_unbound'), [],
    'stage[binding-already-lost]: the fixture bound this worker cleanly before the writer was poisoned');
  let reached = 0;
  const original = f.coordination.recordWorkerGeneration;
  assert.equal(typeof original, 'function', 'stage[binding-seam-missing]: the binding writer exists');
  f.coordination.recordWorkerGeneration = () => {
    reached += 1;
    throw Object.assign(new Error('coordination binding write refused'), { code: 'coordination_unavailable' });
  };
  const bound = f.coordinator.recordWorkerGeneration(worker);
  f.coordination.recordWorkerGeneration = original;
  await flush();

  assert.equal(reached, 1, 'stage[binding-not-reached]: the poisoned binding writer was the one called');
  assert.equal(bound, null, 'the caller keeps the contract it already handles');
  const receipts = f.log.read(handle.id).filter((event) => event.kind === 'worker.generation_unbound');
  assert.equal(receipts.length, 1,
    'stage[generation-binding-silenced]: a refused binding write is a durable fact, never a bare return');
  assert.equal(receipts[0].payload.reason, 'generation_unbound', 'the policy reason is named');
  assert.equal(receipts[0].payload.code, 'coordination_unavailable', 'the typed cause survives');
  assert.equal(receipts[0].payload.message, 'coordination binding write refused', 'and so does the message');
  assert.equal(receipts[0].payload.processGeneration, worker.processGeneration,
    'the receipt names WHICH generation was lost, not just that one was');
  assert.equal(receipts[0].payload.taskId, worker.taskId);
  assert.equal(receipts[0].payload.runId, 'run-402', 'and the run the binding belonged to');
});
