import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { accept as refereeAccept, withVerificationLane } from '../src/referee.mjs';

const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t, { referee, capture, verificationFor, accept } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-contributions-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const prompts = [];
  let emit;
  const adapter = {
    card: () => ({ harness: 'mock', version: '1', concurrencyCeiling: null, maxContext: 100000,
      turnCompletion: 'pausable' }),
    onEvent(callback) { emit = callback; },
    async spawn() { return { ok: true }; },
    async prompt(worker, content, mode) { prompts.push({ worker, content, mode }); return { ok: true }; },
    async kill(worker) {
      queueMicrotask(() => emit({ worker, actor: 'worker', kind: 'kill.confirmed', turnEpoch: 1, payload: {} }));
      return { ok: true };
    },
  };
  const log = new Log(join(directory, 'log'));
  const pins = new Map();
  const removed = [];
  let checks = 0;
  const worktrees = {
    async create(id) { return { path: `/owned/${id}`, baseSha: BASE, branch: `baton/${id}` }; },
    capture: capture ?? (async () => ({ sha: SHA, baseSha: BASE, changedPaths: ['change.mjs'] })),
    async retainCheckpoint(sha) { const ref = `refs/baton/checkpoints/${sha}`; pins.set(ref, sha); return ref; },
    async resolveCheckpoint(ref) { return pins.get(ref); },
    async createVerifyWorktree(id, sha) { return { path: `/check/${id}/${sha}` }; },
    async createBaseVerifyWorktree(id, sha) { return { path: `/check/${id}/${sha}` }; },
    async removeVerifyWorktree(path) { removed.push(path); },
    async remove() {},
    async reconcile() {},
  };
  const coordination = coordinationForLog(log);
  const coordinator = new Coordinator({ log, coordination, fences: new FenceTable(),
    adapters: { mock: adapter }, worktrees, route: () => 'mock', now: () => 0,
    ...(verificationFor ? { verificationForCapture: verificationFor } : {}),
    // A laned referee (withVerificationLane) is installed as-is so the coordinator sees its lane.
    ...(accept ? { accept } : {}),
    referee: referee?.lane ? referee : async (...args) => {
      checks++;
      if (referee) return referee(...args);
      return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
    },
  });
  const handle = await coordinator.spawn('mock', {
    goal: 'Continue collaborating across several contributions', constraints: [], pathScope: ['**'],
    definitionOfDone: 'Owner decides when collaboration is done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
  });
  emit({ worker: handle.id, actor: 'worker', kind: 'lifecycle.turn_completed', turnEpoch: 1,
    payload: { status: 'completed', output: 'First contribution is available.' } });
  await new Promise(setImmediate);
  return { coordinator, coordination, handle, prompts, log, worktrees, removed, adapter, emit, checks: () => checks };
}

test('capture and checking preserve a continuing participant and its next turn', async (t) => {
  const started = deferred();
  const release = deferred();
  const f = await fixture(t, { referee: async () => {
    started.resolve(); await release.promise;
    return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' };
  } });
  const pauseId = f.coordinator.pausedTurns({ workerId: f.handle.id })[0].pauseId;
  const capture = await f.coordinator.captureContribution(f.handle.id, { contributionId: 'first' });
  assert.equal(capture.sha, SHA);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'paused');
  assert.equal(f.coordinator.pausedTurnStatus(pauseId).state, 'pending');
  const checking = f.coordinator.checkContribution(f.handle.id, { contributionId: 'first', checkId: 'check-1' });
  const duplicate = f.coordinator.checkContribution(f.handle.id, { contributionId: 'first', checkId: 'check-1' });
  await started.promise;
  await f.coordinator.nudgeTurn(pauseId, 'Continue with the second assignment.');
  assert.equal(f.prompts.length, 1);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'working');
  release.resolve();
  const result = await checking;
  assert.equal(result.passed, true);
  assert.deepEqual(await duplicate, result);
  assert.equal(f.checks(), 1);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'working');
  assert.equal(f.log.read(f.handle.id).filter((e) => e.kind === 'verify.reverified').length, 0);
  assert.equal(f.removed.length, 2);
  const replayed = await f.coordinator.checkContribution(f.handle.id, { contributionId: 'first', checkId: 'check-1' });
  assert.deepEqual(replayed, result);
  assert.equal(f.checks(), 1);
});

test('unavailable verification preserves the contribution and leaves the author paused', async (t) => {
  const f = await fixture(t);
  const capture = await f.coordinator.captureContribution(f.handle.id, { contributionId: 'first' });
  f.worktrees.createVerifyWorktree = async () => {
    throw Object.assign(new Error('capacity temporarily unavailable'), { code: 'worktree_capacity_exceeded' });
  };
  await assert.rejects(f.coordinator.checkContribution(f.handle.id, {
    contributionId: 'first', checkId: 'check-1',
  }), { code: 'worktree_capacity_exceeded' });
  assert.equal(f.checks(), 0);
  assert.equal(await f.worktrees.resolveCheckpoint(capture.ref), SHA);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'paused');
  const events = f.log.read(f.handle.id);
  assert.equal(events.filter((e) => e.kind === 'contribution.checked').length, 0);
  assert.equal(events.find((e) => e.kind === 'contribution.check_unavailable').payload.attempt.verifierStarted, false);
  // A controller replay must not blindly repeat an attempt whose prior effects are unknown.
  f.coordinator._contributions = null;
  await assert.rejects(f.coordinator.checkContribution(f.handle.id, {
    contributionId: 'first', checkId: 'check-1',
  }), { code: 'worktree_capacity_exceeded' });
});

test('a retained contribution can be checked after its author stops', async (t) => {
  const f = await fixture(t);
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'first' });
  await f.coordinator.kill(f.handle.id);
  const status = f.coordination.task(f.handle.taskId).status;
  const checked = await f.coordinator.checkContribution(f.handle.id, {
    contributionId: 'first', checkId: 'after-stop',
  });
  assert.equal(checked.passed, true);
  assert.equal(f.coordination.task(f.handle.taskId).status, status);
  assert.equal(f.prompts.length, 0);
});

test('native subagent observations are durably mapped and remain read-only worker observations', async (t) => {
  const f = await fixture(t);
  f.emit({ worker: f.handle.id, actor: 'worker', kind: 'native.subagent_observed', turnEpoch: 1,
    payload: { harness: 'codex', parentWorker: f.handle.id, parentSessionId: 'parent',
      invocationKey: JSON.stringify(['codex', f.handle.id, 'parent', 'call']), collabToolCallId: 'call',
      receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } }, phase: 'completed' } });
  const view = f.coordinator.observedNativeSubagents(f.handle.id);
  assert.equal(view.agents[0].state, 'running');
  assert.equal(f.coordination.eventsView().some((event) => event.kind === 'evidence.mapped'
    && event.payload.kind === 'native.subagent_observed'), true);
  assert.equal(f.coordinator.list().length, 1, 'observed native children are not fake Baton-owned workers');
  assert.equal(f.coordination.task(f.handle.taskId).status, 'paused');
});

test('a failed pin leaves the pause available and does not claim retained work', async (t) => {
  const f = await fixture(t);
  f.worktrees.retainCheckpoint = async () => { throw new Error('pin write failed'); };
  await assert.rejects(f.coordinator.captureContribution(f.handle.id, { contributionId: 'first' }), /pin write failed/);
  assert.equal(f.coordinator.pausedTurns({ workerId: f.handle.id }).length, 1);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'paused');
  assert.equal(f.log.read(f.handle.id).some((e) => e.kind === 'contribution.captured'), false);
});

test('stop waits for an in-flight capture before removing the author workspace', async (t) => {
  const started = deferred();
  const release = deferred();
  const f = await fixture(t, { capture: async () => {
    started.resolve();
    await release.promise;
    return { sha: SHA, baseSha: BASE, changedPaths: ['change.mjs'] };
  } });
  let removed = false;
  f.worktrees.remove = async () => { removed = true; };
  const capturing = f.coordinator.captureContribution(f.handle.id, { contributionId: 'before-stop' });
  await started.promise;
  const stopping = f.coordinator.kill(f.handle.id);
  await new Promise(setImmediate);
  assert.equal(removed, false);
  release.resolve();
  const captured = await capturing;
  await stopping;
  assert.equal(removed, true);
  assert.equal(await f.worktrees.resolveCheckpoint(captured.ref), SHA);
  const checked = await f.coordinator.checkContribution(f.handle.id, {
    contributionId: 'before-stop', checkId: 'after-capture-and-stop',
  });
  assert.equal(checked.passed, true);
  assert.equal(f.prompts.length, 0);
});

test('live captures queue per participant and stop waits for both retained revisions', async (t) => {
  const f = await fixture(t);
  await f.coordinator.guideParticipant(f.handle.id, 'Continue working');
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  f.worktrees.snapshot = async () => {
    calls++;
    if (calls === 1) { entered.resolve(); await release.promise; }
    return { sha: calls === 1 ? SHA : 'c'.repeat(40), baseSha: BASE, changedPaths: [] };
  };
  let removed = false;
  f.worktrees.remove = async () => { removed = true; };
  const first = f.coordinator.captureContribution(f.handle.id, { contributionId: 'first' });
  await entered.promise;
  const second = f.coordinator.captureContribution(f.handle.id, { contributionId: 'second' });
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  const stopping = f.coordinator.kill(f.handle.id);
  await new Promise(setImmediate);
  assert.equal(removed, false);
  release.resolve();
  const captures = await Promise.all([first, second]);
  await stopping;
  assert.equal(removed, true);
  assert.equal(calls, 2);
  for (const capture of captures) assert.equal(await f.worktrees.resolveCheckpoint(capture.ref), capture.sha);
});

test('queued guidance resolves a turn that pauses while an earlier delivery is in flight', async (t) => {
  const f = await fixture(t);
  await f.coordinator.guideParticipant(f.handle.id, 'Continue the investigation.');
  assert.equal(f.coordination.task(f.handle.taskId).status, 'working');
  const started = deferred();
  const release = deferred();
  const prompt = f.adapter.prompt;
  f.adapter.prompt = async (...args) => {
    if (args[1] === 'Earlier message') { started.resolve(); await release.promise; }
    return prompt(...args);
  };
  const earlier = f.coordinator.send(f.handle.id, 'Earlier message', 'nudge');
  await started.promise;
  const guidance = f.coordinator.guideParticipant(f.handle.id, 'Take the newly discovered branch.', { actor: 'peer-reviewer' });
  f.emit({ worker: f.handle.id, actor: 'worker', kind: 'lifecycle.turn_completed', turnEpoch: 2,
    payload: { status: 'completed', output: 'Another partial finding.' } });
  await new Promise(setImmediate);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'paused');
  release.resolve();
  await earlier;
  assert.equal((await guidance).ok, true);
  assert.equal(f.coordination.task(f.handle.taskId).status, 'working');
  assert.equal(f.coordinator.pausedTurns({ workerId: f.handle.id }).length, 0);
  const resumed = f.log.read(f.handle.id).filter((event) => event.kind === 'turn.settled').at(-1);
  assert.equal(resumed.actor, 'peer-reviewer');
});

// #269: when the deployment's verification lane is full, a check says so durably (position in
// the queue) instead of looking like a slow verifier; it still runs, in order, once the lane frees.
test('a check that waits for the verification lane records contribution.check_queued with its position', async (t) => {
  const gate = deferred();
  const referee = withVerificationLane(async () => { await gate.promise; return { reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' }; }, { concurrency: 1 });
  const f = await fixture(t, { referee });
  await f.coordinator.captureContribution(f.handle.id, { contributionId: 'first' });
  const one = f.coordinator.checkContribution(f.handle.id, { contributionId: 'first', checkId: 'check-1' });
  while (referee.lane.running === 0) await new Promise((resolve) => setImmediate(resolve));
  const two = f.coordinator.checkContribution(f.handle.id, { contributionId: 'first', checkId: 'check-2' });
  while (referee.lane.queued === 0) await new Promise((resolve) => setImmediate(resolve));
  const queued = f.log.read(f.handle.id).filter((event) => event.kind === 'contribution.check_queued');
  assert.equal(queued.length, 1, 'only the waiting check is recorded as queued');
  assert.deepEqual(queued[0].payload, { contributionId: 'first', checkId: 'check-2', position: 1, running: 1, concurrency: 1 });
  gate.resolve();
  const [firstReceipt, secondReceipt] = await Promise.all([one, two]);
  assert.equal(firstReceipt.passed, true);
  assert.equal(secondReceipt.passed, true);
  assert.deepEqual({ running: referee.lane.running, queued: referee.lane.queued }, { running: 0, queued: 0 });
});



