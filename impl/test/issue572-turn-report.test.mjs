import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IdleWorkerAttention } from '../src/idle-worker-attention.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { deriveWakeFrame } from '../src/wake-stream.mjs';

const dirs = [];
const coordinators = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-turn-report-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function makeBrief(overrides = {}) {
  return {
    goal: 'produce an in-scope diff and report completion',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

// The adapter starts each continuation synchronously inside prompt().
class AtomicPausableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'default', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null,
      },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'mock-token', terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this.turns = new Map();
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker) {
    this.calls.spawn.push({ worker });
    const session = { epoch: 1, inFlight: true };
    this.turns.set(worker, session);
    this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: session.epoch,
      kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
    });
    return { ok: true };
  }
  async prompt(worker, content, mode = 'turn') {
    this.calls.prompt.push({ worker, content, mode });
    const session = this.turns.get(worker);
    assert.ok(session, 'prompt before spawn');
    const beginsTurn = !session.inFlight;
    session.inFlight = true;
    if (beginsTurn) {
      session.epoch += 1;
      this.emit({
        worker, harness: 'mock@1.0.0', turnEpoch: session.epoch,
        kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
      });
    }
    return { ok: true };
  }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) {
    this.calls.approve.push({ worker, requestId, decision, payload });
    return { ok: true };
  }
  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    return { ok: true };
  }
  async kill(worker) {
    this.calls.kill.push({ worker });
    const session = this.turns.get(worker);
    if (session) session.inFlight = false;
    queueMicrotask(() => this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: session?.epoch ?? 0,
      kind: 'kill.confirmed', actor: 'policy', payload: {},
    }));
    return { ok: true, terminal: true };
  }
  /** End the in-flight turn exactly as the provider would: one `turn_completed` frame. */
  completeTurn(worker, { output = 'checkpoint', status = 'completed', summary } = {}) {
    const session = this.turns.get(worker);
    assert.ok(session?.inFlight, 'completeTurn requires an in-flight turn');
    session.inFlight = false;
    this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: session.epoch,
      kind: 'lifecycle.turn_completed', actor: 'worker', payload: { status, output, ...(summary === undefined ? {} : { summary }) },
    });
  }
  epoch(worker) { return this.turns.get(worker)?.epoch ?? 0; }
}

function passingReferee(task) {
  return {
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  };
}

const withDiff = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['in-scope.txt'] });
const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

function setup({ adapter, capture }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination,
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: async (t) => passingReferee(t),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
  });
  coordinators.push(coordinator);
  return { dir, log, coordinator, store: coordination };
}

async function flush() {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all(coordinators.map((coordinator) => coordinator._idleWorkerAttention?.flush()));
}

async function fixture(t, { completeBeforeBinding = false } = {}) {
  const adapter = new AtomicPausableAdapter();
  const f = { ...setup({ adapter, capture: withDiff }), adapter };
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner' };
  const runtime = new SwarmRuntime({
    store: f.store, coordinator: f.coordinator, authorize: async () => {},
    prepareRun: async () => {},
    startRun: async ({ runId, participantId }) => {
      f.coordinator.registerParticipantRuntime(runId, {
        env: {}, redactProviderFrame: (frame) => frame,
        onTurnCompleted: (report) => runtime.reportTurnEnd({ ...report, swarmId: 'turns', participantId }),
        isDone: () => f.store.swarm('turns').participants[participantId].leftReason === 'completed',
      });
      const handle = await f.coordinator.spawn('mock', makeBrief(), { runId });
      if (completeBeforeBinding) {
        adapter.completeTurn(handle.id, { output: 'Completed during recruitment' });
        await flush();
      }
    },
  });
  let key = 0;
  const call = (command, args = {}, principal = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'turns', idempotencyKey: `call-${++key}`, ...args }, principal);
  const recruit = async (id, parent = null) => {
    await call('recruit', { participantId: id, objective: `Work as ${id}`, permissions: SWARM_PERMISSIONS },
      parent ? { actor: `worker:${parent.id}`, principalId: `worker:${parent.id}`, sessionId: parent.id } : owner);
    const binding = f.store.swarm('turns').participants[id].bindings.at(-1);
    return f.coordinator._workers.get(binding.workerId);
  };
  await call('create', { purpose: 'Report turn completion' });
  t.after(async () => { await f.coordinator.stopRunTargets([...f.coordinator._workers.keys()], 'orchestrator'); });
  const events = (kind) => f.store.eventsView().filter((e) => e.kind === 'driver.recorded' && e.payload.kind === kind);
  return { ...f, runtime, recruit, call, events };
}

test('a completed swarm turn wakes its parent with the report and remains available for guidance', async (t) => {
  const f = await fixture(t);
  const parent = await f.recruit('lead');
  const child = await f.recruit('builder', parent);
  f.adapter.completeTurn(parent.id, { output: 'Ready to review' });
  await flush();
  f.adapter.completeTurn(child.id, { output: 'Implementation ready for review' });
  await flush();
  assert.equal(f.coordinator._tasks.get(child.taskId).status, 'working');
  assert.deepEqual(f.coordinator.pausedTurns({ workerId: child.id }), []);
  assert.equal(f.log.read(child.id).some((e) => e.kind === 'turn.paused'), false);
  assert.equal(f.adapter.calls.prompt.length, 1);
  assert.equal(f.adapter.calls.prompt[0].worker, parent.id);
  assert.equal(f.adapter.calls.prompt[0].mode, 'turn');
  assert.match(f.adapter.calls.prompt[0].content, /Implementation ready for review/);
  assert.equal(f.adapter.epoch(parent.id), 2);
  assert.equal(f.events('swarm.turn_report_delivered').length, 1);
  const guided = await f.call('guide', { participantId: 'builder', message: 'Add the regression case' });
  assert.equal(guided.guide.delivery.state, 'delivered');
  assert.equal(guided.next.observation.wakeClass, 'turn_reported');
  assert.equal(f.adapter.epoch(child.id), 2);
  f.adapter.completeTurn(child.id, { output: 'Regression added' });
  await flush();
  assert.equal(f.events('swarm.turn_reported').filter((e) => e.payload.participantId === 'builder').length, 2);
  const frame = deriveWakeFrame(f.events('swarm.turn_reported').at(-1));
  assert.equal(frame.wakeClass, guided.next.observation.wakeClass);
  assert.equal(frame.participantId, 'builder');
});

test('the root wake carries the ask and the report wake preserves full turn identity', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  f.adapter.completeTurn(child.id, { output: 'Root review needed', summary: 'Root review needed' });
  await flush();
  const owed = f.events('swarm.root_attention_owed');
  assert.equal(owed.length, 1);
  const frame = deriveWakeFrame(owed[0]);
  assert.equal(frame.wakeClass, 'root_owed');
  assert.match(frame.turnReport.text, /Root review needed/);
  assert.match(frame.turnReport.text, /Choose continue or stop/);
  const reportFrame = deriveWakeFrame(f.events('swarm.turn_reported')[0]);
  assert.equal(reportFrame.turnReport.workerId, child.id);
  assert.equal(reportFrame.turnReport.assignmentDone, false);
  assert.match(frame.turnReport.text, /Root review needed/);
  assert.equal(frame.turnReport.omittedBytes, 0);
  assert.equal(reportFrame.turnReport.reportSeq, f.events('swarm.turn_reported')[0].seq);
});

test('a declared completion runs verification and closes the worker', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  await f.call('update', { event: 'swarm.participant_left', payload: { participantId: 'builder', reason: 'completed' } });
  f.adapter.completeTurn(child.id, { output: 'Assignment complete' });
  await flush();
  assert.equal(f.coordinator._tasks.get(child.taskId).status, 'completed');
  assert.equal(f.events('swarm.turn_reported')[0].payload.assignmentDone, true);
  assert.equal(f.log.read(child.id).filter((e) => e.kind === 'verify.reverified').length, 1);
  assert.equal(f.adapter.calls.kill.length, 1);
  assert.deepEqual(f.coordinator.pausedTurns({ workerId: child.id }), []);
});

test('duplicate terminal frames and duplicate report calls deliver once', async (t) => {
  const f = await fixture(t);
  const parent = await f.recruit('lead');
  const child = await f.recruit('builder', parent);
  f.adapter.completeTurn(child.id, { output: 'Ready' });
  await flush();
  const reported = f.events('swarm.turn_reported')[0];
  f.adapter.emit({ worker: child.id, harness: 'mock@1.0.0', turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker', payload: { status: 'completed', output: 'Ready' } });
  await flush();
  await Promise.all([f.runtime.reportTurnEnd(reported.payload), f.runtime.reportTurnEnd(reported.payload)]);
  assert.equal(f.adapter.calls.prompt.length, 1);
  assert.equal(f.events('swarm.turn_reported').length, 1);
  assert.equal(f.events('swarm.turn_report_delivered').length, 1);
});

test('a failed parent delivery addresses the root once and preserves the report on retry', async (t) => {
  const f = await fixture(t);
  const parent = await f.recruit('lead');
  const child = await f.recruit('builder', parent);
  f.coordinator.guideParticipant = async () => ({ ok: false, result: 'delivery_refused' });
  f.adapter.completeTurn(child.id, { output: 'Preserved report' });
  await flush();
  const report = f.events('swarm.turn_reported')[0];
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
  assert.match(f.events('swarm.root_attention_owed')[0].payload.ask, /Choose continue or stop/);
  const result = await f.runtime.reportTurnEnd({ ...report.payload, report: { output: 'Changed on retry' } });
  assert.equal(result.delivery.state, 'root_addressed');
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
  assert.equal(f.events('swarm.turn_reported').at(-1).payload.report.output, 'Preserved report');
});

test('a turn crash reports failure and the following exit does not report twice', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  f.adapter.emit({ worker: child.id, harness: 'mock@1.0.0', turnEpoch: 1,
    kind: 'lifecycle.crashed', actor: 'worker', payload: { code: 'provider_crashed', message: 'Connection lost' } });
  await flush();
  f.adapter.emit({ worker: child.id, harness: 'mock@1.0.0', turnEpoch: 1,
    kind: 'lifecycle.exited', actor: 'worker', payload: { exitCode: 1 } });
  await flush();
  assert.equal(f.events('swarm.turn_reported').length, 1);
  assert.equal(f.events('swarm.turn_reported')[0].payload.report.status, 'failed');
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
});

test('the report reaches the nearest live ancestor when the immediate parent has exited', async (t) => {
  const f = await fixture(t);
  const grandparent = await f.recruit('root-seat');
  const parent = await f.recruit('lead', grandparent);
  const child = await f.recruit('builder', parent);
  await f.coordinator.stopRunTargets([parent.id], 'orchestrator');
  f.adapter.completeTurn(child.id, { output: 'Review needed' });
  await flush();
  assert.equal(f.adapter.calls.prompt.length, 1);
  assert.equal(f.adapter.calls.prompt[0].worker, grandparent.id);
  assert.equal(f.events('swarm.turn_report_delivered')[0].payload.parentId, 'root-seat');
});

test('an oversized report has a bounded wake preview and a complete named-participant read', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  const output = 'Result 😀 '.repeat(2000);
  f.adapter.completeTurn(child.id, { output });
  await flush();
  const frame = deriveWakeFrame(f.events('swarm.turn_reported')[0]);
  assert.ok(frame.turnReport.omittedBytes > 0);
  assert.equal(Buffer.byteLength(frame.turnReport.text) + frame.turnReport.omittedBytes,
    Buffer.byteLength(JSON.stringify(f.events('swarm.turn_reported')[0].payload.report)));
  const view = await f.runtime.command(frame.turnReport.read.command, frame.turnReport.read.args,
    { actor: 'owner', principalId: 'owner', sessionId: 'owner' });
  assert.equal(view.participants.find((p) => p.participantId === 'builder').turnReports[0].report.output, output);
});

test('report replay after restart preserves a root address even if a parent becomes available', async (t) => {
  const f = await fixture(t);
  const parent = await f.recruit('lead');
  const child = await f.recruit('builder', parent);
  const guide = f.coordinator.guideParticipant.bind(f.coordinator);
  f.coordinator.guideParticipant = async () => ({ ok: false, result: 'delivery_refused' });
  f.adapter.completeTurn(child.id, { output: 'Review at root' });
  await flush();
  f.coordinator.guideParticipant = guide;
  const restarted = new SwarmRuntime({ store: f.store, coordinator: f.coordinator, authorize: async () => {} });
  const result = await restarted.reportTurnEnd(f.events('swarm.turn_reported')[0].payload);
  assert.equal(result.delivery.state, 'root_addressed');
  assert.equal(f.adapter.calls.prompt.length, 0);
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
});

test('a non-swarm turn addresses the root with its report and preserves explicit continuation', async (t) => {
  const adapter = new AtomicPausableAdapter();
  const f = setup({ adapter, capture: withDiff });
  const handle = await f.coordinator.spawn('mock', makeBrief(), { runId: 'run-nonswarm' });
  t.after(() => f.coordinator.stopRunTargets([handle.id], 'orchestrator'));
  adapter.completeTurn(handle.id, { output: 'Non-swarm result' });
  await flush();
  const task = f.coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'working');
  assert.equal(f.log.read(handle.id).some((e) => e.kind === 'turn.paused'), false);
  const owed = f.store.eventsView().filter((e) => e.payload?.kind === 'run.root_attention_owed');
  assert.equal(owed.length, 1);
  const frame = deriveWakeFrame(owed[0]);
  assert.equal(frame.wakeClass, 'root_owed');
  assert.equal(frame.swarmId, null);
  assert.equal(frame.runId, 'run-nonswarm');
  assert.equal(frame.next, 'baton run view run-nonswarm');
  assert.match(frame.turnReport.text, /Non-swarm result/);
  const [continuation] = f.coordinator.pausedTurns({ workerId: handle.id });
  assert.equal((await f.coordinator.nudgeTurn(continuation.pauseId, 'Continue the investigation')).ok, true);
  assert.equal(adapter.epoch(handle.id), 2);
});

test('a non-swarm child report wakes its Run-lineage parent with the result', async (t) => {
  const adapter = new AtomicPausableAdapter();
  const f = setup({ adapter, capture: withDiff });
  const parent = await f.coordinator.spawn('mock', makeBrief(), { runId: 'run-parent' });
  const child = await f.coordinator.spawn('mock', makeBrief(), { runId: 'run-child' });
  t.after(() => f.coordinator.stopRunTargets([parent.id, child.id], 'orchestrator'));
  f.store.runLineage = (runId) => runId === 'run-child'
    ? { parentRunId: 'run-parent', parent: { workerId: parent.id } } : null;
  adapter.completeTurn(parent.id, { output: 'Ready for child' });
  await flush();
  adapter.completeTurn(child.id, { output: 'Child finding' });
  await flush();
  assert.equal(adapter.calls.prompt.length, 1);
  assert.equal(adapter.calls.prompt[0].worker, parent.id);
  assert.match(adapter.calls.prompt[0].content, /Child finding/);
  assert.equal(adapter.epoch(parent.id), 2);
  assert.equal(f.store.eventsView().filter((e) => e.payload?.kind === 'run.turn_report_delivered').length, 1);
  assert.equal(f.coordinator._tasks.get(child.taskId).status, 'working');
});


test('a first turn that completes before recruitment binds the worker still reports to the root', async (t) => {
  const f = await fixture(t, { completeBeforeBinding: true });
  const worker = await f.recruit('fast');
  const report = f.events('swarm.turn_reported')[0];
  const binding = f.store.eventsView().find((event) => event.kind === 'swarm.participant_bound');
  assert.ok(report.seq < binding.seq);
  assert.equal(report.payload.workerId, worker.id);
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
  assert.equal(f.log.read(worker.id).some((event) => event.kind === 'turn.report_delivery_failed'), false);
  await assert.rejects(f.runtime.reportTurnEnd({ ...report.payload, workerId: 'unrelated-worker' }),
    { code: 'swarm_payload_invalid' });
});


test('a refused non-swarm parent delivery records one root report and replay preserves it', async (t) => {
  const adapter = new AtomicPausableAdapter();
  const f = setup({ adapter, capture: withDiff });
  const parent = await f.coordinator.spawn('mock', makeBrief(), { runId: 'run-parent' });
  const child = await f.coordinator.spawn('mock', makeBrief(), { runId: 'run-child' });
  t.after(() => f.coordinator.stopRunTargets([parent.id, child.id], 'orchestrator'));
  f.store.runLineage = (runId) => runId === 'run-child'
    ? { parentRunId: 'run-parent', parent: { workerId: parent.id } } : null;
  let attempts = 0;
  f.coordinator.guideParticipant = async () => { attempts += 1; return { ok: false, result: 'delivery_refused' }; };
  adapter.completeTurn(child.id, { output: 'Report for root' });
  await flush();
  const event = f.log.read(child.id).find((row) => row.kind === 'lifecycle.turn_completed');
  await f.coordinator._reportRunTurn(child, event, { output: 'Changed on retry' });
  const rows = f.store.eventsView().filter((row) => row.payload?.kind === 'run.root_attention_owed');
  assert.equal(rows.length, 1);
  assert.equal(attempts, 1);
  assert.match(rows[0].payload.turnReport.text, /Report for root/);
  assert.equal(rows[0].payload.turnReport.parentFailure.workerId, parent.id);
});

test('a producer-first root report replays under the wake reconciler identity', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  const input = { swarmId: 'turns', participantId: 'builder', workerId: child.id,
    turnSeq: 901, turnEpoch: 1, report: { summary: 'Ready for root review' } };
  await f.runtime.reportTurnEnd(input);
  const key = `swarm-turn-report-owed:turns:builder:${child.id}:1:901`;
  const payload = { swarmId: 'turns', participantId: 'builder', owed: 'turn_reported',
    ask: 'Ready for root review', next: { command: 'swarm.view', swarmId: 'turns' } };
  const owed = f.events('swarm.root_attention_owed');
  assert.equal(owed.length, 1);
  assert.deepEqual(owed[0].payload, { kind: 'swarm.root_attention_owed', ...payload });
  assert.equal(f.store.priorCoordinationEvent(key).seq, owed[0].seq);
  const replay = f.store.recordDriver('swarm.root_attention_owed', payload, { actor: 'wake-reconciler', key });
  assert.equal(replay.event.seq, owed[0].seq);
  await f.runtime.reportTurnEnd(input);
  assert.equal(f.events('swarm.turn_reported').length, 1);
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
  assert.equal(f.store.priorCoordinationEvent(`swarm-turn-report:turns:builder:${child.id}:1:901:root-owed`), null);
});

test('reportTurnEnd invokes an available reconciler and retries a failed owed append', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  let calls = 0;
  f.runtime._reconcileTurnReportedRows = (swarm, actor) => {
    assert.equal(swarm.swarmId, 'turns');
    assert.equal(f.events('swarm.turn_reported').length, 1);
    assert.equal(f.events('swarm.turn_reported')[0].payload.parentId, null);
    calls += 1;
    if (calls === 1) throw new Error('owed append unavailable');
    return f.store.recordDriver('swarm.root_attention_owed', {
      swarmId: 'turns', participantId: 'builder', owed: 'turn_reported', ask: 'Ready',
      next: { command: 'swarm.view', swarmId: 'turns' },
    }, { actor, key: `swarm-turn-report-owed:turns:builder:${child.id}:2:902` });
  };
  const input = { swarmId: 'turns', participantId: 'builder', workerId: child.id,
    turnSeq: 902, turnEpoch: 2, report: 'Ready' };
  await assert.rejects(f.runtime.reportTurnEnd(input), /owed append unavailable/);
  assert.equal(f.events('swarm.root_attention_owed').length, 0);
  await f.runtime.reportTurnEnd(input);
  await f.runtime.reportTurnEnd(input);
  assert.equal(calls, 2);
  assert.equal(f.events('swarm.turn_reported').length, 1);
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
});

test('the fallback root ask follows the reconciler report precedence and keeps previews bounded', async (t) => {
  const f = await fixture(t);
  const child = await f.recruit('builder');
  const text = 'Root report 😀 '.repeat(2000);
  const reports = [text, { summary: 'A summary' }, { summary: '' }, null];
  for (const [i, report] of reports.entries()) {
    await f.runtime.reportTurnEnd({ swarmId: 'turns', participantId: 'builder', workerId: child.id,
      turnSeq: 910 + i, turnEpoch: 1, report });
  }
  const owed = f.events('swarm.root_attention_owed');
  assert.deepEqual(owed.map((event) => event.payload.ask), [text, 'A summary', null, null]);
  const frame = deriveWakeFrame(owed[0]);
  assert.ok(frame.turnReport.omittedBytes > 0);
  assert.equal(Buffer.byteLength(frame.turnReport.text) + frame.turnReport.omittedBytes, Buffer.byteLength(text));
  assert.equal(frame.turnReport.text.includes('\uFFFD'), false);
  assert.deepEqual(frame.turnReport.read.args, { swarmId: 'turns', participantId: 'builder' });
});

test('retry repairs a refused-parent root report without delivering to that parent again', async (t) => {
  const f = await fixture(t);
  const parent = await f.recruit('lead');
  const child = await f.recruit('builder', parent);
  let guides = 0;
  f.coordinator.guideParticipant = async () => {
    guides += 1;
    return { ok: false, result: 'delivery_refused' };
  };
  const record = f.store.recordDriver.bind(f.store);
  let failOwed = true;
  f.store.recordDriver = (kind, ...args) => {
    if (kind === 'swarm.root_attention_owed' && failOwed) throw new Error('owed append unavailable');
    return record(kind, ...args);
  };
  const input = { swarmId: 'turns', participantId: 'builder', workerId: child.id,
    turnSeq: 920, turnEpoch: 1, report: { summary: 'Original report' } };
  await assert.rejects(f.runtime.reportTurnEnd(input), /owed append unavailable/);
  failOwed = false;
  await f.runtime.reportTurnEnd({ ...input, report: { summary: 'Changed on retry' } });
  assert.equal(guides, 1);
  assert.equal(f.events('swarm.turn_reported').length, 2);
  assert.equal(f.events('swarm.turn_reported').at(-1).payload.parentId, null);
  assert.equal(f.events('swarm.root_attention_owed').length, 1);
  assert.equal(f.events('swarm.root_attention_owed')[0].payload.ask, 'Original report');
});

function installPressureObserver(coordinator) {
  coordinator._idleWorkerAttention.close();
  const service = new IdleWorkerAttention(coordinator, {
    observe: async (_coordinator, handle) => ({ observedAt: '2026-09-24T00:00:00.000Z',
      git: { head: 'review-head', uncommitted: { count: 1, entries: [{ status: ' M', path: 'src/change.mjs' }] } },
      resources: { process: { held: true, residentBytes: 4096 },
        worktree: { held: true, path: handle.worktree, allocatedBytes: 8192 },
        runtimeHome: { held: true, path: '/runtime/builder', home: '/runtime/builder/home', allocatedBytes: 2048 } } }),
    pressure: async () => [{ kind: 'memory', availableBytes: 1, requiredBytes: 8192 }],
  });
  coordinator._idleWorkerAttention = service;
  return service;
}

test('retained swarm workers prompt their parent with resources and re-raise under pressure', async (t) => {
  const f = await fixture(t);
  const service = installPressureObserver(f.coordinator);
  t.after(() => service.close());
  const parent = await f.recruit('lead');
  const child = await f.recruit('builder', parent);
  f.adapter.completeTurn(child.id, { output: 'Review this turn' });
  await flush();
  assert.equal(f.adapter.calls.prompt.length, 1);
  assert.equal(f.adapter.calls.prompt[0].worker, parent.id);
  assert.match(f.adapter.calls.prompt[0].content, /Choose continue or stop/);
  assert.match(f.adapter.calls.prompt[0].content, /review-head/);
  assert.match(f.adapter.calls.prompt[0].content, /src\/change.mjs/);
  assert.match(f.adapter.calls.prompt[0].content, /Process memory 4096 bytes/);
  await service.check();
  assert.equal(f.adapter.calls.prompt.length, 2);
  assert.equal(f.adapter.calls.prompt[1].worker, parent.id);
  assert.match(f.adapter.calls.prompt[1].content, /Host pressure: memory/);
  assert.equal(f.events('swarm.turn_reported').length, 1);
  assert.equal(f.events('swarm.worker_idle_prompted').length, 1);
  assert.equal(f.events('swarm.root_attention_owed').length, 0);
  await service.check();
  assert.equal(f.adapter.calls.prompt.length, 2);
  await f.call('guide', { participantId: 'builder', message: 'Continue the implementation' });
  await service.check();
  assert.equal(service.entries.has(child.id), false);
  assert.equal(f.adapter.calls.kill.length, 0);
});

test('pressure raises a root wake with resource ranking and preserves the original turn owed identity', async (t) => {
  const f = await fixture(t);
  const service = installPressureObserver(f.coordinator);
  t.after(() => service.close());
  const child = await f.recruit('builder');
  f.adapter.completeTurn(child.id, { output: 'Review at root' });
  await flush();
  const original = f.events('swarm.turn_reported')[0];
  const originalKey = `swarm-turn-report-owed:turns:builder:${child.id}:${original.payload.turnEpoch}:${original.payload.turnSeq}`;
  assert.match(f.store.priorCoordinationEvent(originalKey).payload.ask, /Review at root/);
  await service.check();
  const owed = f.events('swarm.root_attention_owed');
  assert.deepEqual(owed.map((event) => event.payload.owed), ['turn_reported', 'worker_idle']);
  const frame = deriveWakeFrame(owed[1]);
  assert.equal(frame.wakeClass, 'root_owed');
  assert.equal(frame.participantId, 'builder');
  assert.match(frame.turnReport.text, /Choose continue or stop/);
  assert.match(frame.turnReport.text, /process_group_rss_bytes/);
  const view = await f.runtime.command(frame.turnReport.read.command, frame.turnReport.read.args,
    { actor: 'owner', principalId: 'owner', sessionId: 'owner' });
  const raised = view.participants.find((row) => row.participantId === 'builder').turnReports.at(-1);
  assert.equal(raised.kind, 'swarm.worker_idle_prompted');
  assert.equal(raised.report.operatorDecision.pressure.ranking[0].workerId, child.id);
  await f.runtime.reportTurnEnd(raised);
  assert.equal(f.events('swarm.root_attention_owed').length, 2, 'replaying the pressure report deduplicates');
  assert.equal(f.events('swarm.turn_reported').length, 1);
  assert.equal(f.adapter.calls.kill.length, 0);
});

test('pressure on an ordinary retained run produces an addressed root wake', async (t) => {
  const adapter = new AtomicPausableAdapter();
  const f = setup({ adapter, capture: withDiff });
  const service = installPressureObserver(f.coordinator);
  const handle = await f.coordinator.spawn('mock', makeBrief(), { runId: 'run-retained' });
  t.after(async () => { service.close(); await f.coordinator.stopRunTargets([handle.id], 'orchestrator'); });
  adapter.completeTurn(handle.id, { output: 'Ordinary retained report' });
  await flush();
  await service.check();
  const owed = f.store.eventsView().filter((event) => event.payload?.kind === 'run.root_attention_owed');
  assert.deepEqual(owed.map((event) => event.payload.owed), ['turn_report', 'worker_idle']);
  const frame = deriveWakeFrame(owed[1]);
  assert.equal(frame.wakeClass, 'root_owed');
  assert.equal(frame.workerId, handle.id);
  assert.equal(frame.runId, 'run-retained');
  assert.match(frame.turnReport.text, /Choose continue or stop/);
  assert.match(frame.turnReport.text, /Host pressure: memory/);
  assert.equal(adapter.calls.kill.length, 0);
});
