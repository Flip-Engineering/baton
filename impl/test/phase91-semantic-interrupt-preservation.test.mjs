import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { projectRunTimelinePage } from '../src/run-timeline.mjs';
import { StoryCompiler } from '../src/story.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

const unavailableSeal = Object.freeze({
  tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const wireDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function preservationReceipt(reattachment = 'not_required') {
  const core = {
    schemaVersion: 2, state: 'preserved', transport: 'attached', attached: true, reattachment,
    sessionDigest: digest('phase91-session'), processGeneration: 3,
    worktreeDigest: digest('phase91-worktree'), routeDigest: digest('phase91-route'),
    planBindingDigest: digest('phase91-plan'), runAuthorityDigest: digest('phase91-run'),
    adapterCardDigest: digest('phase91-card'),
    turnEpoch: 9, fence: 12,
  };
  return { ...core, receiptDigest: digest(core) };
}


function brief({ blocked = false } = {}) {
  return {
    goal: 'preserve one exact semantic provider turn', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the same Plan task completes after an interrupt and successor send',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 10, wallMin: 5 },
    ...(blocked ? { blocked: true } : {}),
  };
}

const governance = {
  schemaVersion: 1,
  maxProviderCallsPerTurn: 20,
  maxToolCallsPerTurn: 20,
  routes: [{
    harness: 'session', model: 'session-model', effort: 'high',
    terminalReserve: { tokens: 0, usd: 0 }, mode: 'observe',
  }],
};

function sessionAdapter({
  confirmInterrupt = true, closeBeforeConfirmation = false, interruptSeal = unavailableSeal,
} = {}) {
  const calls = { spawn: 0, prompt: [], interrupt: 0, kill: 0, approve: [], answer: [] };
  const sessions = new Map();
  const adapter = {
    calls,
    callback: null,
    onEvent(callback) { this.callback = callback; },
    emit(worker, kind, payload = {}, turnEpoch = 1) {
      this.callback?.({ worker, harness: 'session@1', actor: 'worker', kind, payload, turnEpoch });
    },
    card() {
      return {
        harness: 'session', version: '1', authPosture: 'none', concurrencyCeiling: 2,
        maxContext: 100_000,
        verbs: {
          spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
          approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
        },
        modelSelection: {
          mode: 'exact', family: 'session', configuredDefault: 'session-model',
          available: ['session-model'], acceptedAliases: [], acceptedPrefixes: [],
          reasoningEffort: ['high'], configuredEffort: 'high', serviceTier: null,
        },
        sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' },
        governance: {
          usage: {
            tokens: 'native', usd: 'native', tokenMetric: 'session-total',
            terminalSeal: 'native',
          },
          providerCalls: { observation: 'native', enforcement: 'unavailable' },
          toolCalls: { observation: 'native', enforcement: 'unavailable' },
        },
      };
    },
    async spawn(worker) {
      calls.spawn += 1;
      sessions.set(worker, { id: `native-${worker}`, turn: 1, attached: true });
      queueMicrotask(() => adapter.emit(worker, 'lifecycle.spawned', {
        sessionId: `native-${worker}`, modelObserved: 'session-model',
      }));
      return { ok: true };
    },
    async prompt(worker, message, mode) {
      const session = sessions.get(worker);
      calls.prompt.push({ worker, message, mode, sessionId: session?.id ?? null });
      if (!session?.attached) return { ok: false, notSent: true, reason: 'transport closed' };
      session.turn += 1;
      return { ok: true };
    },
    async interrupt(worker, _then, options = {}) {
      calls.interrupt += 1;
      const session = sessions.get(worker);
      if (closeBeforeConfirmation && session) session.attached = false;
      if (confirmInterrupt) queueMicrotask(() => adapter.emit(worker, 'control.interrupt_confirmed', {
        sessionId: session?.id ?? null,
        transportOpen: session?.attached === true,
        preservationRequested: options.preserveTurn === true,
        usageSeal: interruptSeal,
      }));
      return { ok: true };
    },
    async kill(worker) {
      calls.kill += 1;
      const session = sessions.get(worker);
      if (session) session.attached = false;
      queueMicrotask(() => adapter.emit(worker, 'kill.confirmed', { usageSeal: unavailableSeal }));
      return { ok: true, terminal: true };
    },
    async approve(...args) { calls.approve.push(args); return { ok: true }; },
    async answer(...args) { calls.answer.push(args); return { ok: true }; },
  };
  return adapter;
}

function fixture(options = {}) {
  const adapter = sessionAdapter(options);
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-phase91-log-')));
  const coordination = coordinationForLog(log);
  const removals = [];
  const verifications = [];
  const ownedWorktree = mkdtempSync(join(tmpdir(), 'baton-phase91-worktree-'));
  const worktrees = {
    create: async (taskId) => ({ path: ownedWorktree, branch: `baton/${taskId}` }),
    capture: async () => ({ sha: 'capture-sha', snapshotted: false }),
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async (...args) => { removals.push(args); },
    reconcile: async () => {},
    worktreeAvailable: () => true,
    validateSessionContext: async (context) => ({ ok: context.worktree === ownedWorktree }),
  };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: adapter },
    providerGovernance: governance,
    worktrees,
    referee: async (...args) => {
      verifications.push(args);
      return { reverified: true, passed: true, observedExit: 0 };
    },
    route: () => 'session', stopDeadlineMs: options.stopDeadlineMs ?? 80,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  return {
    adapter, coordinator, coordination, log, removals, verifications, worktrees, ownedWorktree,
  };
}

async function spawn(f, taskId = 'phase91-task') {
  const handle = await f.coordinator.spawn('session', brief(), {
    taskId, runId: 'phase91-run', model: 'session-model', effort: 'high',
  });
  await new Promise((resolve) => setImmediate(resolve));
  return handle;
}

// The coordinator's stop machinery is deliberately timer-unref'd — the kernel never pins its
// host's event loop (docs/24 G4 / C4). This fixture's in-process adapter owns no real child
// handle, so when it withholds an interrupt confirmation the only settlement left is the
// coordinator's own stop deadline: hold the loop for exactly that await, so the deadline fires
// and the operation reports its typed outcome instead of the file being cancelled.
async function withLiveLoop(fn) {
  const hold = setInterval(() => {}, 1_000);
  try { return await fn(); } finally { clearInterval(hold); }
}

test('P91-1: semantic preserve-turn interrupt keeps the exact task, session, worktree, route, and Run authority attached', async () => {
  const f = fixture();
  const handle = await spawn(f);
  const before = f.coordinator.list()[0];
  const result = await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: before.fence,
    preserveTurn: true,
  });

  assert.equal(result.result, 'confirmed');
  assert.equal(result.preservation.state, 'preserved');
  assert.equal(result.preservation.transport, 'attached');
  assert.equal(result.preservation.receiptDigest.length, 64);
  const paused = f.coordinator.list()[0];
  assert.equal(paused.status, 'interrupted');
  assert.equal(paused.activeProviderTurns, 0);
  assert.equal(paused.controllableAttached, true);
  assert.equal(paused.taskId, before.taskId);
  assert.deepEqual(paused.sessionRef, before.sessionRef);
  assert.equal(paused.worktree, before.worktree);
  assert.equal(paused.routeKey, before.routeKey);
  assert.equal(f.coordination.task(handle.taskId).status, 'working');
  assert.equal(f.coordination.snapshot().tasks.length, 1);
  assert.equal(f.removals.length, 0);
});

test('P91-2: coordinate-free successor send opens one governed turn on the same native session and same Plan task', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-successor-task');
  const before = f.coordinator.list()[0];
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: before.fence, preserveTurn: true,
  });
  const paused = f.coordinator.list()[0];
  const sent = await f.coordinator.send(handle.id, 'Continue the exact approved task.', 'nudge', {
    expectedFence: paused.fence,
    resumePreservedTurn: true,
  });

  assert.equal(sent.ok, true);
  assert.equal(sent.actualDelivery, 'turn');
  assert.equal(sent.continuation.state, 'admitted');
  assert.equal(f.adapter.calls.spawn, 1, 'no replacement harness process');
  assert.deepEqual(f.adapter.calls.prompt, [{
    worker: handle.id, message: 'Continue the exact approved task.', mode: 'turn',
    sessionId: `native-${handle.id}`,
  }]);
  assert.equal(f.coordinator.list()[0].taskId, handle.taskId);
  assert.equal(f.coordination.snapshot().tasks.length, 1, 'no duplicate Plan-node claim/refinement');
  assert.equal(f.coordination.task(handle.taskId).status, 'working');
  assert.equal(f.log.read(handle.id)
    .filter((event) => event.kind === 'resource.provider_turn_admitted').length, 2);
});

test('P91-3: cancel-by-default remains low-level behavior, while preservation uncertainty never claims an attached session', async () => {
  const ordinary = fixture();
  const ordinaryHandle = await spawn(ordinary, 'phase91-low-level-task');
  const cancelled = await ordinary.coordinator.interrupt(ordinaryHandle.id);
  assert.equal(cancelled.result, 'confirmed');
  assert.equal(cancelled.preservation, undefined);
  assert.equal(ordinary.coordination.task(ordinaryHandle.taskId).status, 'cancelled');

  const uncertain = fixture({ confirmInterrupt: false, stopDeadlineMs: 15 });
  const uncertainHandle = await spawn(uncertain, 'phase91-uncertain-task');
  const forced = await withLiveLoop(() => uncertain.coordinator.interrupt(
    uncertainHandle.id, undefined, 'semantic:owner', {
      expectedFence: uncertain.coordinator.list()[0].fence,
      preserveTurn: true,
    },
  ));
  assert.equal(forced.result, 'preservation_timeout');
  assert.equal(forced.escalation, 'confirmed');
  assert.equal(forced.preservation, undefined);
  assert.equal(uncertain.coordination.task(uncertainHandle.taskId).status, 'failed');
  assert.equal(uncertain.coordinator.list()[0].status, 'dead');
  assert.equal(uncertain.adapter.calls.kill, 1);
  assert.equal(uncertain.removals.length, 1);
  assert.deepEqual(uncertain.log.read(uncertainHandle.id)
    .filter((event) => ['control.forced_stop', 'kill.confirmed'].includes(event.kind))
    .map((event) => event.kind), ['control.forced_stop', 'kill.confirmed']);
});

test('P91-4: a closed transport during confirmation cannot mint a preservation receipt', async () => {
  const f = fixture({ closeBeforeConfirmation: true });
  const handle = await spawn(f, 'phase91-closed-task');
  const result = await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  assert.notEqual(result.preservation?.state, 'preserved');
  assert.equal(result.result, 'preservation_unproven');
  assert.equal(result.escalation, 'confirmed');
  assert.notEqual(f.coordinator.list()[0].controllableAttached, true);
  assert.equal(f.coordination.task(handle.taskId).status, 'failed');
  assert.equal(f.coordinator.list()[0].status, 'dead');
  assert.equal(f.adapter.calls.kill, 1);
  assert.equal(f.removals.length, 1);
});

test('P91-5: whole-Run stop admitted before successor delivery forbids the successor and exactly reaps the preserved member', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-stop-race-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const paused = f.coordinator.list()[0];
  const stopped = f.coordinator.stopRunTargets([handle.id], 'operator');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(['stopping', 'dead'].includes(f.coordinator.list()[0].status));
  const successor = await f.coordinator.send(handle.id, 'This must never start.', 'nudge', {
    expectedFence: paused.fence,
    resumePreservedTurn: true,
  });
  await stopped;

  assert.equal(successor.ok, false);
  assert.equal(f.adapter.calls.prompt.length, 0);
  assert.equal(f.adapter.calls.kill, 1);
  assert.equal(f.coordination.task(handle.taskId).status, 'cancelled');
});

test('P91-6: interrupt resolves a blocked interaction before exposing the preserved member', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-blocked-task');
  f.adapter.emit(handle.id, 'approval.requested', {
    requestId: 'phase91-approval', question: 'May I continue?', blocking: true,
  });
  assert.equal(f.coordinator.list()[0].status, 'blocked');

  const interrupted = await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });

  assert.equal(interrupted.preservation?.state, 'preserved');
  assert.equal(f.coordinator.list()[0].status, 'interrupted');
  assert.equal(f.coordinator.list()[0].pendingApprovalId, null);
  assert.equal(f.coordination.task(handle.taskId).status, 'working');
  assert.deepEqual(f.adapter.calls.approve, [[handle.id, 'phase91-approval', 'cancel', undefined]]);
});

test('P91-7: processless replay refuses a receipt without exact durable Plan control authority', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-restart-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const priorReceipt = f.coordinator.list()[0].sessionPreservation;
  const resumed = sessionAdapter();
  const replay = new Coordinator({
    log: f.log, coordination: f.coordination, fences: new FenceTable(),
    adapters: { session: resumed }, providerGovernance: governance,
    worktrees: f.worktrees,
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    route: () => 'session', stopDeadlineMs: 80, recoveryTimeoutMs: 80,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.equal(replay.list()[0].sessionPreservation.receiptDigest, priorReceipt.receiptDigest);

  const beforeSeq = f.coordination.snapshot().lastSeq;
  const attached = await replay.recover(handle.id);
  assert.equal(attached.result, 'preservation_receipt_invalid');
  assert.equal(resumed.calls.spawn, 0);
  assert.equal(resumed.calls.prompt.length, 0, 'reattachment alone must not admit provider work');
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.equal(replay.list()[0].sessionRef.id, `native-${handle.id}`);
  assert.equal(f.coordination.snapshot().tasks.length, 1);
  assert.equal(f.coordination.snapshot().lastSeq, beforeSeq);
});

test('P91-8: a stale semantic send fence cannot consume the preserved-session receipt', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-stale-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const paused = f.coordinator.list()[0];
  const stale = await f.coordinator.send(handle.id, 'stale continuation', 'nudge', {
    expectedFence: paused.fence - 1,
    resumePreservedTurn: true,
  });
  assert.equal(stale.result, 'stale_fence');
  assert.equal(f.adapter.calls.prompt.length, 0);
  assert.equal(f.coordinator.list()[0].sessionPreservation.state, 'preserved');
});

test('P91-10: Run timeline exposes preservation truth without session or authority coordinates', () => {
  const receipt = preservationReceipt('confirmed');
  const operational = {
    schemaVersion: 1, worker: 'private-phase91-worker', seq: 2,
    ts: '2026-07-19T12:00:02.000Z', kind: 'control.interrupt_confirmed',
    actor: 'worker', taskId: 'private-phase91-task', runId: 'run-phase91-timeline',
    payload: { preservation: receipt, sessionId: 'private-native-session' },
  };
  const events = [{
    schemaVersion: 1, seq: 1, ts: operational.ts, kind: 'evidence.mapped', actor: 'policy',
    idempotencyKey: 'phase91-mapped', payload: {
      worker: operational.worker, workerSeq: operational.seq,
      digest: wireDigest(operational), kind: operational.kind, ts: operational.ts,
    },
  }];
  const page = projectRunTimelinePage({
    runId: 'run-phase91-timeline', events,
    snapshot: {
      tasks: [{ id: operational.taskId, runId: operational.runId,
        assignee: operational.worker, role: 'work' }],
    },
    resolveOperational: () => operational,
  });
  assert.deepEqual(page.items.map((item) => item.kind), ['control.interrupt_confirmed']);
  assert.deepEqual(page.items.map((item) => item.facts), [{
    preservationState: 'preserved', preservationTransport: 'attached',
    reattachment: 'confirmed',
  }]);
  const serialized = JSON.stringify(page);
  for (const secret of [
    'private-phase91-worker', 'private-phase91-task', 'private-native-session',
    receipt.sessionDigest, receipt.worktreeDigest, receipt.routeDigest,
  ]) assert.equal(serialized.includes(secret), false, `timeline leaked ${secret}`);
});

test('P91-11: two concurrent successors consume one receipt and admit exactly one provider turn', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-concurrent-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const paused = f.coordinator.list()[0];
  const target = {
    workerId: paused.id, taskId: paused.taskId, fence: paused.fence, role: null,
    activeCount: 1, turnEpoch: paused.turnEpoch, turnState: paused.status,
    preservationReceiptDigest: paused.sessionPreservation.receiptDigest,
    ...paused.semanticControlBinding,
  };
  const options = () => ({
    expectedFence: paused.fence, resumePreservedTurn: true,
    semanticTarget: target, semanticTargetDigest: digest(target),
  });
  const [first, second] = await Promise.all([
    f.coordinator.send(handle.id, 'first successor', 'nudge', options()),
    f.coordinator.send(handle.id, 'second successor', 'nudge', options()),
  ]);
  assert.equal(first.ok, true);
  assert.equal(first.actualDelivery, 'turn');
  assert.equal(second.ok, false);
  assert.equal(second.result, 'semantic_target_drift');
  assert.equal(f.adapter.calls.prompt.length, 1);
  assert.equal(f.log.read(handle.id)
    .filter((event) => event.kind === 'resource.provider_turn_admitted').length, 2);
});

test('P91-12: stop after provider prompt acceptance makes successor outcome unknown and still exactly reaps', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-post-prompt-stop-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const paused = f.coordinator.list()[0];
  let releasePrompt;
  let observePrompt;
  const promptObserved = new Promise((resolve) => { observePrompt = resolve; });
  const promptGate = new Promise((resolve) => { releasePrompt = resolve; });
  f.adapter.prompt = async (worker, message, mode) => {
    f.adapter.calls.prompt.push({
      worker, message, mode, sessionId: `native-${worker}`,
    });
    observePrompt();
    await promptGate;
    return { ok: true };
  };
  const successorPromise = f.coordinator.send(handle.id, 'accepted before stop', 'nudge', {
    expectedFence: paused.fence, resumePreservedTurn: true,
  });
  await promptObserved;
  const stopPromise = f.coordinator.stopRunTargets([handle.id], 'operator');
  releasePrompt();
  const [successor, stopped] = await Promise.all([successorPromise, stopPromise]);

  assert.equal(successor.ok, false);
  assert.equal(successor.deliveredDespiteStale, true);
  assert.equal(successor.actualDelivery, 'turn');
  assert.equal(stopped.remainingCount, 0);
  assert.equal(f.adapter.calls.prompt.length, 1);
  assert.equal(f.adapter.calls.kill, 1);
  assert.equal(f.removals.length, 1);
  assert.equal(f.coordination.task(handle.taskId).status, 'cancelled');
});

test('P91-13: invalid provider terminal governance forbids preservation and reaps via a separate kill', async () => {
  const f = fixture({
    interruptSeal: {
      tokens: 'reported', usd: 'unavailable',
      counterId: 'never-observed', tokenMetric: 'session-total',
    },
  });
  const handle = await spawn(f, 'phase91-invalid-seal-task');
  const result = await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  assert.equal(result.result, 'provider_governance_invalid');
  assert.equal(result.escalation, 'confirmed');
  assert.equal(result.preservation, undefined);
  assert.equal(f.coordination.task(handle.taskId).status, 'failed');
  assert.equal(f.coordinator.list()[0].status, 'dead');
  assert.equal(f.adapter.calls.kill, 1);
  assert.equal(f.removals.length, 1);
  assert.deepEqual(f.log.read(handle.id).filter((event) => (
    ['control.interrupt_confirmed', 'resource.provider_telemetry_invalid',
      'kill.confirmed'].includes(event.kind)
  )).map((event) => event.kind), [
    'control.interrupt_confirmed', 'resource.provider_telemetry_invalid', 'kill.confirmed',
  ]);
});

test('P91-14: kill supersedes an in-flight preserved interrupt with typed caller settlements', async () => {
  const f = fixture({ confirmInterrupt: false, stopDeadlineMs: 500 });
  const handle = await spawn(f, 'phase91-interrupt-kill-race-task');
  const interruptPromise = f.coordinator.interrupt(
    handle.id, undefined, 'semantic:owner', {
      expectedFence: f.coordinator.list()[0].fence,
      preserveTurn: true,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.coordinator.list()[0].status, 'stopping');
  const killPromise = f.coordinator.kill(handle.id, 'operator');
  const [interrupted, killed] = await Promise.all([interruptPromise, killPromise]);

  assert.deepEqual(interrupted, {
    ok: false, result: 'superseded_by_stop', escalation: 'confirmed',
  });
  assert.equal(killed.result, 'confirmed');
  assert.equal(f.coordination.task(handle.taskId).status, 'cancelled');
  assert.equal(f.coordinator.list()[0].status, 'dead');
  assert.equal(f.adapter.calls.interrupt, 1);
  assert.equal(f.adapter.calls.kill, 1);
  assert.equal(f.removals.length, 1);
  assert.deepEqual(f.log.read(handle.id).filter((event) => [
    'control.interrupt_requested', 'kill.requested', 'control.interrupt_confirmed',
    'kill.confirmed',
  ].includes(event.kind)).map((event) => event.kind), [
    'control.interrupt_requested', 'kill.requested', 'kill.confirmed',
  ]);
});

test('P91-15: delayed interrupt Ack cannot satisfy the later kill operation generation', async () => {
  const f = fixture({ confirmInterrupt: false, stopDeadlineMs: 500 });
  const handle = await spawn(f, 'phase91-operation-generation-task');
  let resolveInterruptAck;
  let resolveKillAck;
  f.adapter.interrupt = async () => {
    f.adapter.calls.interrupt += 1;
    return new Promise((resolve) => { resolveInterruptAck = resolve; });
  };
  f.adapter.kill = async (worker) => {
    f.adapter.calls.kill += 1;
    queueMicrotask(() => f.adapter.emit(worker, 'kill.confirmed', {
      usageSeal: unavailableSeal,
    }));
    return new Promise((resolve) => { resolveKillAck = resolve; });
  };

  let interruptSettled = false;
  let killSettled = false;
  const interruptPromise = f.coordinator.interrupt(
    handle.id, undefined, 'semantic:owner', {
      expectedFence: f.coordinator.list()[0].fence,
      preserveTurn: true,
    },
  ).then((value) => { interruptSettled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  const killPromise = f.coordinator.kill(handle.id, 'operator')
    .then((value) => { killSettled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));

  resolveInterruptAck({ ok: true, terminal: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(interruptSettled, false, 'stale interrupt Ack cannot settle the escalated waiter');
  assert.equal(killSettled, false, 'kill still requires its own operation-bound Ack');
  assert.equal(f.coordinator.list()[0].status, 'stopping');

  resolveKillAck({ ok: true, terminal: true });
  const [interrupted, killed] = await Promise.all([interruptPromise, killPromise]);
  assert.deepEqual(interrupted, {
    ok: false, result: 'superseded_by_stop', escalation: 'confirmed',
  });
  assert.equal(killed.result, 'confirmed');
  assert.equal(f.coordination.task(handle.taskId).status, 'cancelled');
  assert.equal(f.coordinator.list()[0].status, 'dead');
  assert.equal(f.removals.length, 1);
});

test('P91-16: unplanned processless reattachment refuses before a wrong-session spawn or reap', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-reattach-failure-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const resumed = sessionAdapter();
  resumed.spawn = async (worker) => {
    resumed.calls.spawn += 1;
    queueMicrotask(() => resumed.emit(worker, 'lifecycle.spawned', {
      sessionId: `wrong-native-${worker}`, modelObserved: 'session-model',
    }));
    return { ok: true, attached: true };
  };
  const replay = new Coordinator({
    log: f.log, coordination: f.coordination, fences: new FenceTable(),
    adapters: { session: resumed }, providerGovernance: governance,
    worktrees: f.worktrees,
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    route: () => 'session', stopDeadlineMs: 80, recoveryTimeoutMs: 80,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });

  const failed = await replay.recover(handle.id);
  assert.deepEqual(failed, { ok: false, result: 'preservation_receipt_invalid' });
  assert.equal(resumed.calls.spawn, 0);
  assert.equal(resumed.calls.prompt.length, 0);
  assert.equal(resumed.calls.kill, 0);
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.equal(f.coordination.task(handle.taskId).status, 'working');
  assert.equal(f.removals.length, 0);
});

test('P91-17: process close after preservation fails the task, clears control, reaps, and agrees with Story', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-process-close-task');
  const internal = f.coordinator._workers.get(handle.id);
  const process = {
    generation: 1, pid: 42_091, processGroupId: 42_091,
    state: 'ready', ready: true, startedSeq: null, closedSeq: null,
  };
  const started = f.log.append({
    worker: handle.id, harness: 'session@1', turnEpoch: 1,
    kind: 'lifecycle.process_started', actor: 'worker',
    payload: {
      schemaVersion: 1, phase: 'initializing',
      generation: process.generation, pid: process.pid,
      processGroupId: process.processGroupId,
    },
  });
  const ready = f.log.append({
    worker: handle.id, harness: 'session@1', turnEpoch: 1,
    kind: 'lifecycle.process_ready', actor: 'worker',
    payload: {
      schemaVersion: 1,
      generation: process.generation, pid: process.pid,
      processGroupId: process.processGroupId,
    },
  });
  internal.processGeneration = process.generation;
  internal.processRef = { ...process, startedSeq: started.seq };
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  f.adapter.emit(handle.id, 'lifecycle.process_closed', {
    schemaVersion: 1,
    generation: process.generation, pid: process.pid,
    processGroupId: process.processGroupId, code: 0, signal: null, ready: true,
  });
  for (let attempt = 0; attempt < 100 && f.removals.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  const closed = f.coordinator.list()[0];
  assert.equal(closed.status, 'exited');
  assert.equal(closed.sessionPreservation, null);
  assert.equal(closed.controllableAttached, false);
  assert.equal(f.coordinator._workers.get(handle.id).localAuthority, false);
  assert.equal(closed.terminalCause.code, 'transport_closed_after_preservation');
  assert.equal(f.coordination.task(handle.taskId).status, 'failed');
  assert.equal(f.removals.length, 1);

  const story = new StoryCompiler();
  story.ingestBatch(f.log.read(handle.id));
  assert.equal(story.workerState(handle.id).status, closed.status);
  assert.ok(ready.seq < f.log.read(handle.id)
    .find((event) => event.kind === 'lifecycle.process_closed').seq);

  f.coordination.releaseWriterLease({ requireOwned: true });
  const durable = coordinationForLog(f.log, f.coordination.root);
  const replay = new Coordinator({
    log: f.log, coordination: durable, fences: new FenceTable(),
    adapters: { session: sessionAdapter() }, providerGovernance: governance,
    worktrees: f.worktrees,
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    route: () => 'session', watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  assert.equal(replay.list()[0].sessionPreservation, null,
    'restart must not resurrect a receipt after its transport closed');
  assert.equal(durable.task(handle.taskId).status, 'failed');
  durable.releaseWriterLease({ requireOwned: true });
});

test('P91-18: blocked-interaction preparation is durable and a crash before control admission fails safe', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-preparation-crash-task');
  f.adapter.emit(handle.id, 'approval.requested', {
    requestId: 'phase91-crash-approval', question: 'May I continue?', blocking: true,
  });
  const before = f.coordination.task(handle.taskId);
  const prepared = await f.coordinator.prepareSemanticInterrupt(handle.id, 'semantic:owner');
  const after = f.coordination.task(handle.taskId);
  assert.equal(prepared.result, 'interaction_superseded');
  assert.equal(after.status, 'working');
  assert.ok(after.version > before.version);
  assert.equal(f.adapter.calls.approve.length, 0);
  assert.equal(f.adapter.calls.interrupt, 0);
  assert.equal(f.coordination.events().some((event) => event.kind === 'evidence.mapped'
    && event.payload.kind === 'control.interaction_superseded'), true);

  f.coordination.releaseWriterLease({ requireOwned: true });
  const durable = coordinationForLog(f.log, f.coordination.root);
  const resumed = sessionAdapter();
  const replay = new Coordinator({
    log: f.log, coordination: durable, fences: new FenceTable(),
    adapters: { session: resumed }, providerGovernance: governance,
    worktrees: f.worktrees,
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    route: () => 'session', watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  assert.equal(durable.task(handle.taskId).status, 'failed');
  assert.equal(replay.list()[0].pendingApprovalId, null);
  assert.equal(replay.list()[0].pendingQuestionId, null);
  assert.equal(resumed.calls.interrupt, 0);
  assert.equal(resumed.calls.prompt.length, 0);
  assert.equal(f.log.read(handle.id)
    .filter((event) => event.kind === 'control.interaction_superseded').length, 1);
  durable.releaseWriterLease({ requireOwned: true });
});

test('P91-22: Story and Coordinator agree across preserved interrupt and successor admission', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-story-agreement-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const interruptedStory = new StoryCompiler();
  interruptedStory.ingestBatch(f.log.read(handle.id));
  assert.equal(interruptedStory.workerState(handle.id).status,
    f.coordinator.list()[0].status);

  const paused = f.coordinator.list()[0];
  await f.coordinator.send(handle.id, 'Continue the same Story-bound task.', 'nudge', {
    expectedFence: paused.fence,
    resumePreservedTurn: true,
  });
  const workingStory = new StoryCompiler();
  workingStory.ingestBatch(f.log.read(handle.id));
  assert.equal(workingStory.workerState(handle.id).status,
    f.coordinator.list()[0].status);
});

test('P91-23: Story and Coordinator agree immediately on an interrupt with no preservation receipt', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-story-no-receipt-task');
  const interrupted = await f.coordinator.interrupt(handle.id);
  assert.equal(interrupted.result, 'confirmed');
  assert.equal(interrupted.preservation, undefined);
  const publicHandle = f.coordinator.list()[0];
  assert.equal(publicHandle.status, 'idle');

  const story = new StoryCompiler();
  story.ingestBatch(f.log.read(handle.id));
  assert.equal(story.workerState(handle.id).status, publicHandle.status);
  assert.equal(f.log.read(handle.id).some((event) => event.kind === 'kill.confirmed'), false,
    'agreement is observed before and without a masking kill');
});

test('P91-24: a preserved epoch quarantines late completion/crash and only its exact successor verifies once', async () => {
  const f = fixture();
  const handle = await spawn(f, 'phase91-epoch-seal-task');
  await f.coordinator.interrupt(handle.id, undefined, 'semantic:owner', {
    expectedFence: f.coordinator.list()[0].fence,
    preserveTurn: true,
  });
  const paused = f.coordinator.list()[0];
  const sealedEpoch = paused.sessionPreservation.turnEpoch;
  const completedPayload = {
    status: 'completed', progress: 1, summary: 'late old epoch',
    artifacts: { commits: [], files: [] },
    verification: { command: 'true', claimedExit: 0 }, openQuestions: [],
    budgetUsed: { tokens: 0, usd: 0 }, usageSeal: unavailableSeal,
  };
  f.adapter.emit(handle.id, 'lifecycle.turn_completed', completedPayload, 1);
  f.adapter.emit(handle.id, 'lifecycle.crashed', {
    code: 'late_old_epoch', usageSeal: unavailableSeal,
  }, 1);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(f.coordinator.list()[0].status, 'interrupted');
  assert.equal(f.coordination.task(handle.taskId).status, 'working');
  assert.equal(f.verifications.length, 0);
  assert.equal(f.log.read(handle.id)
    .filter((event) => event.kind === 'control.stale_rejected'
      && event.payload?.reason === 'preserved_turn_epoch_sealed').length, 2);
  assert.equal(f.log.read(handle.id)
    .filter((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind))
    .length, 0, 'late old-epoch terminals are quarantined rather than replay-authoritative');

  const sent = await f.coordinator.send(handle.id, 'Open only epoch E+1.', 'nudge', {
    expectedFence: paused.fence,
    resumePreservedTurn: true,
  });
  assert.equal(sent.continuation.turnEpoch, sealedEpoch + 1);
  f.adapter.emit(handle.id, 'lifecycle.turn_completed', {
    ...completedPayload, summary: 'exact successor completed',
  }, 2);
  for (let attempt = 0; attempt < 100
    && f.coordination.task(handle.taskId).status !== 'completed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(f.coordination.task(handle.taskId).status, 'completed');
  assert.equal(f.verifications.length, 1, 'only the exact successor reaches the trust gate');
  assert.equal(f.coordinator.list()[0].status, 'idle');

  f.coordination.releaseWriterLease({ requireOwned: true });
  const durable = coordinationForLog(f.log, f.coordination.root);
  const replay = new Coordinator({
    log: f.log, coordination: durable, fences: new FenceTable(),
    adapters: { session: sessionAdapter() }, providerGovernance: governance,
    worktrees: f.worktrees,
    referee: async () => { throw new Error('replay cannot duplicate verification'); },
    route: () => 'session', watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  assert.equal(durable.task(handle.taskId).status, 'completed');
  assert.equal(replay.list()[0].sessionPreservation, null);
  durable.releaseWriterLease({ requireOwned: true });
});
