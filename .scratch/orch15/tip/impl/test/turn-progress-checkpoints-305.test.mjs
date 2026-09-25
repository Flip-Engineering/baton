// Issue #305 — mid-turn progress checkpoints. A long worker turn is invisible today:
// `worktree.progress_checkpointed` is written only at reap/stop boundaries
// (`_preserveProgressBeforeReap`), so a root watching a seat's long turn sees nothing move
// until the turn ends. The repair: DURING a turn, the coordinator derives bounded
// `turn.progress` checkpoints from the worker's OWN activity rows — completed tool rows,
// file edits, and structured commit shas — at a registry-derived cadence, so wait()/read()
// observers see the turn move without waiting for the boundary.
//
// Red suite (green after the coordinator change lands).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

// The cadence AND the per-checkpoint item budget derive from the ONE view-items bound —
// a checkpoint is one observer screen — never a fresh constant.
const ROWS_PER_CHECKPOINT = FRAME_LIMITS['view.knowledge_slice.items'].value;
assert.ok(Number.isSafeInteger(ROWS_PER_CHECKPOINT) && ROWS_PER_CHECKPOINT > 0);

const dirs = [];
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-305-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

/** D1-conforming scriptable adapter (mirrors the turn-checkpoints 31-b fixture). */
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000,
      verbs: {
        spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
        approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
      },
      decision: 'native',
      turnCompletion: 'pausable',
    };
    this._cb = null;
    this.prompts = [];
  }
  card() { return this._card; }
  onEvent(cb) { this._cb = cb; }
  emit(event) { if (this._cb) this._cb(event); }
  async spawn() { return { ok: true }; }
  async prompt(workerId, message, mode) { this.prompts.push({ workerId, message, mode }); return { ok: true }; }
  async steer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function harnessId(coordinator) {
  const card = coordinator._adapters.mock.card();
  return `${card.harness}@${card.version}`;
}

function kitFor() {
  const d = dir();
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
  const fences = new FenceTable();
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({
        path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base',
      }),
      capture: async () => ({ sha: 'sha-result' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  return { coordinator, coordination, fences, adapter };
}

const brief = (overrides = {}) => ({
  goal: 'g', constraints: [], pathScope: ['.'], definitionOfDone: 'd',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 1000, usd: 1, wallMin: 1 }, ...overrides,
});

async function spawnedKit() {
  const kit = kitFor();
  // Production workers always belong to a run — the checkpoint must carry that attribution.
  const spawned = await kit.coordinator.spawn('mock', brief(), { runId: 'run-305-progress' });
  await until(() => kit.coordinator.list()[0]?.status === 'working');
  const handle = kit.coordinator._workers.get(spawned.id);
  return { ...kit, handle };
}

/** A live worker whose task is genuinely `paused` on an unconsumed 31-a pause record. */
async function pausedKit() {
  const kit = await spawnedKit();
  const task = kit.coordinator._tasks.get(kit.handle.taskId);
  kit.coordinator._coordRecord('steering.registered',
    { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`, 'orchestrator');
  kit.adapter.emit({
    worker: kit.handle.id, harness: harnessId(kit.coordinator), turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: {
      status: 'completed', summary: 'ok', artifacts: { commits: [], files: [] },
      verification: { command: 'true', claimedExit: 0 }, openQuestions: [], budgetUsed: { tokens: 1, usd: 0.01 },
    },
  });
  await until(() => kit.coordination.task(task.id).status === 'paused');
  return { ...kit, task };
}

function emitTurnStarted(kit, turnEpoch = 1) {
  kit.adapter.emit({
    worker: kit.handle.id, harness: harnessId(kit.coordinator), turnEpoch,
    kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
  });
}

function emitToolCall(kit, index, overrides = {}) {
  kit.adapter.emit({
    worker: kit.handle.id, harness: harnessId(kit.coordinator), turnEpoch: 1,
    kind: 'content.tool_call', actor: 'worker',
    payload: { callId: `call-${index}`, phase: 'completed', title: `Tool title ${index}`, ...overrides },
  });
}

function emitFileEdit(kit, index, overrides = {}) {
  kit.adapter.emit({
    worker: kit.handle.id, harness: harnessId(kit.coordinator), turnEpoch: 1,
    kind: 'content.file_edit', actor: 'worker',
    payload: { path: `src/file-${index}.mjs`, ...overrides },
  });
}

const progressRows = (kit) => kit.coordinator._log.byKind(kit.handle.id, 'turn.progress');

test('a turn.progress checkpoint lands every N tool rows with cumulative counts and last titles', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  for (let i = 1; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  const rows = progressRows(kit);
  assert.equal(rows.length, 1, 'exactly one checkpoint after a full window of tool rows');
  const checkpoint = rows[0];
  assert.equal(checkpoint.actor, 'policy', 'the checkpoint is hub-derived, never worker-minted');
  assert.equal(checkpoint.payload.toolCalls, ROWS_PER_CHECKPOINT);
  assert.equal(checkpoint.payload.fileEdits, 0);
  assert.ok(typeof checkpoint.payload.turnEpoch === 'number');
  assert.equal(checkpoint.turnEpoch, checkpoint.payload.turnEpoch, 'the row and payload agree on the turn');
  assert.deepEqual(checkpoint.payload.toolTitles,
    Array.from({ length: ROWS_PER_CHECKPOINT }, (_, i) => `Tool title ${i + 1}`));
  assert.ok(checkpoint.taskId !== null && checkpoint.runId !== null, 'the checkpoint carries task/run attribution');
});

test('fewer than N rows checkpoint nothing: a long turn moves only on the derived cadence', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  for (let i = 1; i < ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  assert.equal(progressRows(kit).length, 0, 'a partial window is not a checkpoint');
  assert.equal(kit.coordinator._log.byKind(kit.handle.id, 'content.tool_call').length, ROWS_PER_CHECKPOINT - 1,
    'the rows themselves still landed — only the checkpoint waits');
});

test('file edits contribute relative paths; the next checkpoint carries cumulative counts', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  emitFileEdit(kit, 1);
  emitFileEdit(kit, 2, { paths: ['src/extra.mjs'] });
  for (let i = 1; i <= ROWS_PER_CHECKPOINT - 3; i += 1) emitToolCall(kit, i);
  // One window closes on a mix of edits and tool rows; absolute worktree paths relativize.
  emitFileEdit(kit, 3, { path: `/tmp/wt/${kit.handle.taskId}/src/abs.mjs` });
  const first = progressRows(kit);
  assert.equal(first.length, 1);
  assert.equal(first[0].payload.fileEdits, 3);
  assert.equal(first[0].payload.toolCalls, ROWS_PER_CHECKPOINT - 3);
  assert.ok(first[0].payload.editedPaths.includes('src/file-1.mjs'));
  assert.ok(first[0].payload.editedPaths.includes('src/extra.mjs'));
  assert.ok(first[0].payload.editedPaths.includes('src/abs.mjs'),
    'an absolute worktree path renders relative to the checkout');
  assert.ok(!first[0].payload.editedPaths.some((p) => p.startsWith('/tmp/')),
    'no absolute checkout path leaks into the checkpoint');
  for (let i = 1; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, 100 + i);
  const second = progressRows(kit);
  assert.equal(second.length, 2, 'the second full window mints the second checkpoint');
  assert.equal(second[1].payload.toolCalls, (ROWS_PER_CHECKPOINT - 3) + ROWS_PER_CHECKPOINT,
    'counts are cumulative across checkpoints of one turn');
  assert.equal(second[1].payload.fileEdits, 3);
  assert.ok(second[1].payload.toolTitles.length <= ROWS_PER_CHECKPOINT,
    'the title list is a bounded sliding window, never the whole turn');
  assert.equal(second[1].payload.toolTitles.at(-1), `Tool title ${100 + ROWS_PER_CHECKPOINT}`,
    'the window keeps the most recent movement');
});

test('commits ride the checkpoint from structured sha fields only — never scraped prose', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(64);
  emitToolCall(kit, 1, { sha: shaA, title: `landed ${shaB} already` });
  emitFileEdit(kit, 1, { commits: [shaA, 'not-a-sha', shaB] });
  for (let i = 3; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  const rows = progressRows(kit);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].payload.commits, [shaA, shaB],
    'structured shas deduplicate in first-seen order; non-shas never qualify');
  assert.ok(!rows[0].payload.commits.includes('not-a-sha'));
});

test('a token-shaped tool title is redacted on the checkpoint, never landing in the ledger', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  const secret = 'sk-abcdefghijklmnop';
  emitToolCall(kit, 1, { title: `rotate ${secret} now` });
  for (let i = 2; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  const rows = progressRows(kit);
  assert.equal(rows.length, 1);
  const titles = rows[0].payload.toolTitles.join('\n');
  assert.ok(!titles.includes(secret), 'the raw secret never lands in the ledger');
  assert.ok(titles.includes('[redacted]'), 'the redaction marker shows where it was cut');
});

test('prose messages never advance the checkpoint: only tool rows, file edits and commits count', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  for (let i = 1; i <= ROWS_PER_CHECKPOINT * 2; i += 1) {
    kit.adapter.emit({
      worker: kit.handle.id, harness: harnessId(kit.coordinator), turnEpoch: 1,
      kind: 'content.message', actor: 'worker', payload: { text: `thinking out loud ${i}` },
    });
  }
  assert.equal(progressRows(kit).length, 0, 'two windows of prose still mint no checkpoint');
});

test('a fresh worker turn_started resets the per-turn counts', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit, 1);
  for (let i = 1; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  assert.equal(progressRows(kit)[0].payload.toolCalls, ROWS_PER_CHECKPOINT);
  emitTurnStarted(kit, 2);
  for (let i = 1; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, 100 + i);
  const rows = progressRows(kit);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].payload.toolCalls, ROWS_PER_CHECKPOINT,
    'the new turn counts its own rows, never its predecessor’s');
});

test('the turn boundary seals the turn: post-pause rows land but checkpoint nothing further', async () => {
  const kit = await pausedKit();
  assert.equal(progressRows(kit).length, 0, 'no checkpoint was minted before the boundary');
  for (let i = 1; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  assert.equal(kit.coordinator._log.byKind(kit.handle.id, 'content.tool_call').length, ROWS_PER_CHECKPOINT,
    'the post-boundary rows still land in the log');
  assert.equal(progressRows(kit).length, 0, 'but a sealed turn mints no checkpoint for them');
});

test('the root sees the turn move through wait(): turn.progress arrives as a digest fact', async () => {
  const kit = await spawnedKit();
  emitTurnStarted(kit);
  for (let i = 1; i <= ROWS_PER_CHECKPOINT; i += 1) emitToolCall(kit, i);
  const digest = await kit.coordinator.wait(500);
  assert.ok(digest.facts.some((fact) => fact.kind === 'turn.progress'),
    'the checkpoint is visible on the hub digest without waiting for the turn boundary');
});
