// Issue #404 red-first suite — the writeScratchpad handler masks every store refusal code it
// does not translate as `worker_not_active` (coordinator.mjs, the CoordinationRefusal catch).
// An ACTIVE worker that hits a novel store refusal is told the worker is not active, so the
// named remedy is wrong. Owed: the store code crosses verbatim beside the closed allowlist the
// handler translates — a code outside the allowlist is surfaced as itself with the store's
// message, never re-labelled.
//
// Fixture mirrors the nearest existing scratchpad tests (tight-cell-red.test.mjs's lightweight
// Coordinator idiom): a real Coordinator over a real log-backed coordination store, one spawned
// worker, and the store's writeScratchpad seam wrapped so it raises a real CoordinationRefusal
// carrying a code the allowlist has never heard of.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationRefusal } from '../src/coordination-internals.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const dirs = [];
function tmpDir(prefix = 'baton-issue404-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function makeBrief(overrides = {}) {
  return {
    goal: 'work the scratchpad refusal seam', constraints: [], pathScope: ['.'],
    definitionOfDone: 'reports filed', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
      turnCompletion: 'pausable',
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function coordinatorSetup() {
  const log = new Log(join(tmpDir(), 'log'));
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  });
  return { adapter, coordinator, coordination: coordinator._coordination };
}

/** Wrap the store's writeScratchpad seam so the named entry text raises a real
 * CoordinationRefusal with the given code and message; every other write stays real. */
function refuseOnText(coordination, textToken, code, message) {
  const real = coordination.writeScratchpad.bind(coordination);
  coordination.writeScratchpad = (fields, auth) => {
    if (fields.entry.text.includes(textToken)) throw new CoordinationRefusal(message, code);
    return real(fields, auth);
  };
}

test('I404-0 sanity: the fixture writes for real through the handler before any injection', async () => {
  const { coordinator } = coordinatorSetup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:i404-sanity' });
  const receipt = coordinator.writeScratchpad(handle.id, { kind: 'note', text: 'a plain real write' },
    { expectedFence: 'current', idempotencyKey: 'i404:sanity' });
  assert.equal(receipt.ok, true, `the fixture must write for real first: ${JSON.stringify(receipt)}`);
});

test('I404-1 RED: a store code outside the allowlist crosses verbatim with the store message — never re-labelled worker_not_active', async () => {
  const { coordinator, coordination } = coordinatorSetup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:i404-novel' });
  refuseOnText(coordination, 'I404-NOVEL', 'coordination_checkpoint_write_failed',
    'coordination projection checkpoint could not be persisted');

  const receipt = coordinator.writeScratchpad(handle.id, { kind: 'note', text: 'I404-NOVEL hits a novel store refusal' },
    { expectedFence: 'current', idempotencyKey: 'i404:novel' });

  assert.equal(receipt.ok, false);
  assert.equal(receipt.result, 'coordination_checkpoint_write_failed',
    `the store code must cross verbatim; today it is masked: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.message, 'coordination projection checkpoint could not be persisted',
    'the store message rides beside the verbatim code');
  assert.notEqual(receipt.result, 'worker_not_active',
    'an active worker must never be told it is not active because the store invented a new code');
});

test('I404-2: the closed allowlist still translates in place, exactly as before', async () => {
  const { coordinator, coordination } = coordinatorSetup();
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:i404-allowlisted' });
  refuseOnText(coordination, 'I404-ALLOWLISTED', 'scratchpad_write_conflict', 'scratchpad write lost the fence race');

  const receipt = coordinator.writeScratchpad(handle.id, { kind: 'note', text: 'I404-ALLOWLISTED stays translated' },
    { expectedFence: 'current', idempotencyKey: 'i404:allowlisted' });
  assert.deepEqual(receipt, { ok: false, result: 'scratchpad_write_conflict' },
    'the allowlist translation keeps its exact wire shape — no message field, no change');
});

test('I404-3: a genuinely inactive worker is still told worker_not_active', async () => {
  const { coordinator } = coordinatorSetup();
  await coordinator.spawn('mock', makeBrief(), { runId: 'run:i404-inactive' });
  const receipt = coordinator.writeScratchpad('worker:never-spawned', { kind: 'note', text: 'nobody home' },
    { expectedFence: 'current', idempotencyKey: 'i404:inactive' });
  assert.deepEqual(receipt, { ok: false, result: 'worker_not_active' },
    'the genuine liveness refusals are untouched by the verbatim crossing');
});
