import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(5); }
  throw new Error(`timed out waiting for ${label}`);
};
const brief = () => ({
  goal: 'provider release failure matrix', constraints: [], pathScope: ['**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1_000, usd: 10, wallMin: 1 },
});
const providerPolicy = {
  schemaVersion: 1, maxWireFrameBytes: 1024 * 1024, maxProviderCallsPerTurn: 2, maxToolCallsPerTurn: 2,
  routes: [{ harness: 'stub', model: 'stub-1', effort: 'low', terminalReserve: { tokens: 80, usd: 1 }, mode: 'observe' }],
};
const workerResult = { status: 'completed', summary: 'done', artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 }, openQuestions: [] };
const usageSeal = { tokens: 'reported', usd: 'reported', counterId: 'turn-1', tokenMetric: 'stub-total' };

function adapter(overrides = {}) {
  const calls = { spawn: [], prompt: [], kill: [] };
  const value = {
    calls, cb: null,
    onEvent(cb) { this.cb = cb; },
    emit(worker, kind, payload = {}, turnEpoch = 1) { this.cb?.({ worker, harness: 'stub', actor: 'worker', kind, payload, turnEpoch }); },
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 10_000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      modelSelection: { mode: 'exact', family: 'stub', configuredDefault: 'stub-1', available: ['stub-1'], acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'stub-total', terminalSeal: 'native' },
        providerCalls: { observation: 'native', enforcement: 'unavailable' },
        toolCalls: { observation: 'native', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    }),
    async spawn(...args) { calls.spawn.push(args); return overrides.spawn ? overrides.spawn(value, ...args) : { ok: true }; },
    async prompt(...args) { calls.prompt.push(args); return overrides.prompt ? overrides.prompt(value, ...args) : { ok: true }; },
    async kill(...args) { calls.kill.push(args); return overrides.kill ? overrides.kill(value, ...args) : { ok: true }; },
    async interrupt() { return { ok: true }; }, async approve() { return { ok: true }; }, async answer() { return { ok: true }; },
  };
  return value;
}

function system(ad, options = {}) {
  const log = options.log ?? new Log(mkdtempSync(join(tmpdir(), 'baton-pg57-release-log-')));
  const coordination = options.coordination ?? coordinationForLog(log);
  const worktree = options.worktree ?? mkdtempSync(join(tmpdir(), 'baton-pg57-release-wt-'));
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { stub: ad }, providerGovernance: providerPolicy,
    worktrees: {
      create: async () => ({ path: worktree, ownerTaskId: options.ownerTaskId ?? null }),
      capture: async () => ({ sha: 'capture-sha', snapshotted: false }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {},
    },
    runtimeScopes: options.runtimeScopes,
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    recoveryTimeoutMs: 100, stopDeadlineMs: 50, budgetPolicy: { terminalGraceMs: 1 }, watchdog: { stallMs: 0 },
  });
  return { coordinator, coordination, log, ad, worktree };
}

function admissionReleasedExactlyOnce(log, workerId, phase) {
  const events = log.read(workerId);
  const admissions = events.filter((event) => event.kind === 'resource.provider_turn_admitted' && event.payload?.phase === phase);
  assert.equal(admissions.length, 1, `${phase} must have one admission`);
  const releases = events.filter((event) => event.kind === 'resource.provider_turn_released' && event.payload?.admissionSeq === admissions[0].seq);
  assert.equal(releases.length, 1, `${phase} admission must have exactly one release`);
  assert.ok(releases[0].seq > admissions[0].seq, `${phase} release must follow admission`);
  assert.equal(releases[0].actor, 'policy');
  assert.deepEqual(Object.keys(releases[0].payload).sort(), ['admissionSeq', 'code', 'used']);
  assert.equal(typeof releases[0].payload.code, 'string'); assert.ok(releases[0].payload.code.length > 0);
  assert.deepEqual(releases[0].payload.used, { tokens: 0, usd: 0 });
  const counts = new Map();
  const admittedSeqs = new Set(events.filter((event) => event.kind === 'resource.provider_turn_admitted').map((event) => event.seq));
  for (const release of events.filter((event) => event.kind === 'resource.provider_turn_released')) {
    assert.equal(admittedSeqs.has(release.payload?.admissionSeq), true, 'every release must name a real admission');
    counts.set(release.payload?.admissionSeq, (counts.get(release.payload?.admissionSeq) ?? 0) + 1);
  }
  assert.equal([...counts.values()].every((count) => count === 1), true, 'no provider admission may be released twice');
  return { admission: admissions[0], release: releases[0], releaseCount: events.filter((event) => event.kind === 'resource.provider_turn_released').length };
}

async function completeReusableSession(f, taskId) {
  const handle = await f.coordinator.spawn('stub', brief(), { taskId, model: 'stub-1', effort: 'low' });
  await until(() => f.coordinator.list()[0]?.sessionContext, 'durable session context');
  f.ad.emit(handle.id, 'lifecycle.spawned', { sessionId: `${taskId}-native`, pid: 111 }, 1);
  f.ad.emit(handle.id, 'resource.tokens', { source: 'stub', counterId: 'turn-1', accounting: 'delta', tokens: 20, usd: 0.2, tokenMetric: 'stub-total', modelObserved: 'stub-1' }, 1);
  f.ad.emit(handle.id, 'lifecycle.turn_completed', { result: workerResult, usageSeal }, 1);
  try { await until(() => f.coordination.task(taskId)?.status === 'completed' && f.coordinator.list()[0]?.status === 'idle', 'verified reusable session'); }
  catch (error) {
    const current = f.coordinator.list()[0];
    const observed = f.log.read(handle.id).map((event) => ({ kind: event.kind, code: event.payload?.code ?? null }));
    throw new Error(`${error.message}: ${JSON.stringify({ taskStatus: f.coordination.task(taskId)?.status, workerStatus: current?.status, providerTelemetryFailed: current?.providerTelemetryFailed, observed })}`);
  }
  return handle;
}

function replay(f, replayAdapter = adapter(), runtimeScopes = undefined) {
  return system(replayAdapter, { log: f.log, coordination: f.coordination, worktree: f.worktree, runtimeScopes });
}

test('provider admission is released exactly once when runtime-scope creation fails before adapter spawn, including replay', async () => {
  const removed = []; const ad = adapter();
  const f = system(ad, { runtimeScopes: { reconcile: () => {}, create: () => { throw new Error('private runtime detail'); }, remove: (worker) => removed.push(worker) } });
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'release-runtime', model: 'stub-1', effort: 'low' });
  assert.equal(f.coordination.task(handle.taskId).status, 'failed');
  assert.equal(ad.calls.spawn.length, 0);
  assert.deepEqual(removed, [handle.id]);
  const before = admissionReleasedExactlyOnce(f.log, handle.id, 'spawn');

  const restored = replay(f);
  assert.equal(restored.coordinator.list()[0].providerTurn.sealed, true);
  assert.equal(restored.coordination.task(handle.taskId).status, 'failed');
  assert.equal(admissionReleasedExactlyOnce(f.log, handle.id, 'spawn').releaseCount, before.releaseCount);
});

test('provider admission is released exactly once when the adapter refuses initial spawn, including replay', async () => {
  const ad = adapter({ spawn: async () => ({ ok: false, reason: 'fixture spawn refusal' }) }); const f = system(ad);
  const handle = await f.coordinator.spawn('stub', brief(), { taskId: 'release-spawn-refusal', model: 'stub-1', effort: 'low' });
  await until(() => f.coordination.task(handle.taskId)?.status === 'failed', 'durable spawn refusal');
  assert.equal(ad.calls.spawn.length, 1);
  const before = admissionReleasedExactlyOnce(f.log, handle.id, 'spawn');

  const replayAdapter = adapter(); const restored = replay(f, replayAdapter);
  assert.equal(replayAdapter.calls.spawn.length, 0);
  assert.equal(restored.coordinator.list()[0].providerTurn.sealed, true);
  assert.equal(admissionReleasedExactlyOnce(f.log, handle.id, 'spawn').releaseCount, before.releaseCount);
});

test('provider recovery admission is released exactly once when attached native state cannot commit its refinement, including replay', async () => {
  const original = system(adapter()); const handle = await completeReusableSession(original, 'release-recovery-refinement');
  const resumed = adapter({ spawn: async (ad, worker) => { ad.emit(worker, 'lifecycle.spawned', { sessionId: 'release-recovery-refinement-native', pid: 222 }, 1); return { ok: true }; } });
  const removed = [];
  const recovering = replay(original, resumed, {
    reconcile: () => {}, create: (worker) => ({ env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } }), remove: (worker) => removed.push(worker),
  });
  const rawAppend = recovering.coordination._appendFile;
  recovering.coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('refinement-')) throw new Error('recovery refinement disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(recovering.coordinator.recover(handle.id), (error) => error.code === 'coordination_write_unavailable');
  await until(() => resumed.calls.kill.length === 1 && removed.length === 1, 'recovery transport reap');
  const before = admissionReleasedExactlyOnce(recovering.log, handle.id, 'recovery');

  recovering.coordination._appendFile = rawAppend;
  const restored = replay(recovering);
  assert.equal(restored.coordinator.list()[0].providerTurn.sealed, true);
  assert.equal((await restored.coordinator.result(handle.id)).status, 'completed');
  assert.equal(admissionReleasedExactlyOnce(recovering.log, handle.id, 'recovery').releaseCount, before.releaseCount);
});

test('provider follow-up admission is released exactly once when delivered native state cannot commit its refinement, including replay', async () => {
  const f = system(adapter()); const handle = await completeReusableSession(f, 'release-follow-refinement');
  const rawAppend = f.coordination._appendFile;
  f.coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('refinement-')) throw new Error('follow-up refinement disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(f.coordinator.send(handle.id, 'advance native state', 'turn'), (error) => error.code === 'coordination_write_unavailable');
  await until(() => f.ad.calls.kill.length === 1, 'follow-up transport reap');
  const before = admissionReleasedExactlyOnce(f.log, handle.id, 'follow_up');

  f.coordination._appendFile = rawAppend;
  const restored = replay(f);
  assert.equal(restored.coordinator.list()[0].providerTurn.sealed, true);
  assert.equal((await restored.coordinator.result(handle.id)).status, 'completed');
  assert.equal(admissionReleasedExactlyOnce(f.log, handle.id, 'follow_up').releaseCount, before.releaseCount);
});
