import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const BASE = '1'.repeat(40);
const PROGRESS = '2'.repeat(40);
const CHECKPOINT_REF = `refs/baton/checkpoints/${PROGRESS}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, label) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief() {
  return {
    goal: 'make useful partial progress', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the full task is complete',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100_000, usd: 5, wallMin: 30 },
  };
}

function adapter() {
  return {
    callback: null,
    onEvent(callback) { this.callback = callback; },
    emit(worker, kind, payload = {}) {
      this.callback?.({ worker, harness: 'stub@1', turnEpoch: 1, actor: 'worker', kind, payload });
    },
    card() {
      return {
        harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 1, maxContext: 100_000,
        modelSelection: {
          mode: 'exact', configuredDefault: 'stub-model', available: ['stub-model'], family: 'stub',
          acceptedPrefixes: ['stub-'], acceptedAliases: [], reasoningEffort: ['medium'],
          serviceTier: null, provenance: 'fixture', refreshedAt: null,
        },
        verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      };
    },
    async spawn() { return { ok: true }; },
    async prompt() { return { ok: true }; },
    async interrupt(worker) { queueMicrotask(() => this.emit(worker, 'control.interrupt_confirmed')); return { ok: true }; },
    async kill(worker) { queueMicrotask(() => this.emit(worker, 'kill.confirmed')); return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
}

function fixture({ capture = async () => ({ sha: PROGRESS, snapshotted: true, changedPaths: ['partial.txt'] }) } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase70-'));
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  const calls = [];
  const worktrees = {
    async create(taskId) {
      calls.push(['create', taskId]);
      const path = join(root, 'worktree');
      mkdirSync(path, { recursive: true });
      return { path, branch: `baton/${taskId}`, baseSha: BASE };
    },
    async capture(path, opts) {
      calls.push(['capture', path, opts]);
      return capture(path, opts);
    },
    async retainCheckpoint(sha) { calls.push(['retain', sha]); return CHECKPOINT_REF; },
    async resolveCheckpoint(ref) { calls.push(['resolve', ref]); return PROGRESS; },
    async remove(taskId) { calls.push(['remove', taskId]); },
    async reconcile() {},
  };
  const harness = adapter();
  const make = () => new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { stub: harness }, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    approvalTimeoutMs: 100, stopDeadlineMs: 500,
  });
  return { root, log, coordination, calls, worktrees, harness, make, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('PS1-PS4: exact kill checkpoints progress before reap and replay restores one non-adoptable checkpoint', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const coordinator = f.make();
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase70-progress', model: 'stub-model', effort: 'medium' });
  await until(() => coordinator.list()[0]?.worktree, 'owned worktree');

  const stopped = await coordinator.kill(handle.id, 'operator:test');
  assert.deepEqual(stopped, { ok: true, result: 'confirmed', emulated: false });
  const operations = f.calls.map(([kind]) => kind);
  assert.ok(operations.indexOf('capture') < operations.indexOf('retain'));
  assert.ok(operations.indexOf('retain') < operations.indexOf('resolve'));
  assert.ok(operations.indexOf('resolve') < operations.indexOf('remove'));

  const result = await coordinator.result(handle.id);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.checkpoint, { state: 'pinned', sha: PROGRESS, ref: CHECKPOINT_REF });
  assert.equal(result.retainedResultRef, null, 'preserved progress is never an accepted result');
  const preserved = f.log.read(handle.id).filter((event) => event.kind === 'worktree.progress_checkpointed');
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].payload.checkpoint.sha, PROGRESS);

  assert.equal(coordinator.closeAuthority(), true);
  const replay = f.make();
  await replay.startupReady();
  const replayed = await replay.result(handle.id);
  assert.deepEqual(replayed.checkpoint, result.checkpoint);
  assert.equal(f.log.read(handle.id).filter((event) => event.kind === 'worktree.progress_checkpointed').length, 1);
  assert.equal(replay.closeAuthority(), true);
});

test('PS2: capture or checkpoint failure retains the worktree and cannot report confirmed cleanup', async (t) => {
  const f = fixture({ capture: async () => { throw Object.assign(new Error('fixture capture failure'), { code: 'capture_failed' }); } });
  t.after(f.cleanup);
  const coordinator = f.make();
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase70-preservation-failure', model: 'stub-model', effort: 'medium' });
  await until(() => coordinator.list()[0]?.worktree, 'owned worktree');

  const stopped = await coordinator.kill(handle.id, 'policy');
  assert.equal(stopped.ok, false);
  assert.equal(stopped.result, 'preservation_failed');
  assert.equal(f.calls.some(([kind]) => kind === 'remove'), false);
  assert.equal(coordinator._workers.get(handle.id).cleanupPending, true);
  assert.equal(coordinator._workers.get(handle.id).cleanupError, 'progress_preservation_failed');
  assert.equal(f.log.read(handle.id).filter((event) => event.kind === 'worktree.progress_preservation_failed').length, 1);
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
});

test('PS1/PS4: replay cleanup of an already-cancelled exact-closed worker checkpoints before reap', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const coordinator = f.make();
  const publicHandle = await coordinator.spawn('stub', brief(), {
    taskId: 'phase70-replay-cleanup', model: 'stub-model', effort: 'medium',
  });
  await until(() => coordinator.list()[0]?.worktree, 'owned worktree');

  // Model the durable restart window after cancellation/process close but before the original
  // stop response captured progress. Public kill() takes the already-dead cleanup branch here.
  const handle = coordinator._workers.get(publicHandle.id);
  const task = coordinator._tasks.get(publicHandle.taskId);
  task.status = 'cancelled';
  handle.status = 'dead';
  handle.processRef = null;
  handle.cleanupPending = true;

  const cleaned = await coordinator.kill(publicHandle.id, 'policy');
  assert.deepEqual(cleaned, { ok: true, result: 'already_dead' });
  const operations = f.calls.map(([kind]) => kind);
  assert.ok(operations.indexOf('capture') >= 0, 'restart cleanup skipped progress capture');
  assert.ok(operations.indexOf('capture') < operations.indexOf('retain'));
  assert.ok(operations.indexOf('retain') < operations.indexOf('resolve'));
  assert.ok(operations.indexOf('resolve') < operations.indexOf('remove'));
  assert.deepEqual(task.checkpoint, { state: 'pinned', sha: PROGRESS, ref: CHECKPOINT_REF });
  assert.equal(f.log.read(publicHandle.id)
    .filter((event) => event.kind === 'worktree.progress_checkpointed').length, 1);
});

test('PS1-PS4: an already-closed failed transport preserves progress before shutdown/drain cleanup', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const coordinator = f.make();
  const spawned = await coordinator.spawn('stub', brief(), {
    taskId: 'phase70-closed-progress', model: 'stub-model', effort: 'medium',
  });
  await until(() => coordinator.list()[0]?.worktree, 'owned worktree');

  const handle = coordinator._workers.get(spawned.id);
  const task = coordinator._tasks.get(handle.taskId);
  handle.status = 'exited';
  handle.processRef = { generation: 1, pid: 123, processGroupId: 123, state: 'closed', ready: true };
  task.status = 'failed';

  await coordinator._cleanupClosedTransport(handle, task, { seq: 700 });

  assert.deepEqual(f.calls.map(([kind]) => kind), ['create', 'capture', 'retain', 'resolve', 'remove']);
  assert.deepEqual(task.checkpoint, { state: 'pinned', sha: PROGRESS, ref: CHECKPOINT_REF });
  assert.equal(f.log.read(handle.id).filter((event) => event.kind === 'worktree.progress_checkpointed').length, 1);
  assert.equal(handle.localAuthority, false);
  assert.equal(coordinator.closeAuthority(), true);
});

test('PS2: closed-transport cleanup retains runtime and worktree authority when preservation fails', async (t) => {
  const f = fixture({ capture: async () => { throw Object.assign(new Error('fixture capture failure'), { code: 'capture_failed' }); } });
  t.after(f.cleanup);
  let runtimeRemovals = 0;
  const coordinator = new Coordinator({
    log: f.log, coordination: f.coordination, fences: new FenceTable(), adapters: { stub: f.harness }, worktrees: f.worktrees,
    runtimeScopes: {
      create: () => ({ env: {}, replaceEnv: true, posture: { active: true } }),
      remove: () => { runtimeRemovals += 1; },
      reconcile: () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    approvalTimeoutMs: 100, stopDeadlineMs: 500,
  });
  const spawned = await coordinator.spawn('stub', brief(), {
    taskId: 'phase70-closed-preservation-failure', model: 'stub-model', effort: 'medium',
  });
  await until(() => coordinator.list()[0]?.worktree, 'owned worktree');

  const handle = coordinator._workers.get(spawned.id);
  const task = coordinator._tasks.get(handle.taskId);
  handle.status = 'exited';
  handle.processRef = { generation: 1, pid: 124, processGroupId: 124, state: 'closed', ready: true };
  task.status = 'failed';

  await assert.rejects(
    coordinator._cleanupClosedTransport(handle, task, { seq: 701 }),
    (error) => error?.code === 'progress_preservation_failed',
  );
  assert.equal(runtimeRemovals, 0, 'runtime authority remains available with the retained worktree');
  assert.equal(f.calls.some(([kind]) => kind === 'remove'), false);
  assert.equal(handle.cleanupPending, true);
  assert.equal(handle.cleanupError, 'progress_preservation_failed');
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
});

test('PS5-PS7: the unified semantic registry advertises a coordinate-free resume_work action', () => {
  const action = APPLICATION_SEMANTIC_REGISTRY.actions.resume_work;
  assert.equal(action.helpTopic, 'run.act.resume_work');
  assert.deepEqual(action.inputSchema.required, ['reason']);
  assert.deepEqual(Object.keys(action.inputSchema.properties), ['reason']);
  assert.deepEqual(action.serverDerived, ['checkpoint', 'planNode', 'routePolicy', 'recoveryLineage']);
  assert.match(action.summary, /orchestrator-selected harness, model, and effort/u);
});
