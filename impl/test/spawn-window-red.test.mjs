// Issue #199 (root) — no failed-verdict inside the spawn-confirmation window. Red-first pin
// suite over the row contract:
//   docs/reference/evidence/phantom-root-2026-08-15/wave-d/row-spawn-window-brief.md
//
// Evidence shape: member claims task (task.claimed) → lifecycle.spawned → turn_started +
// process_started → a SECOND lifecycle.spawned (harness double-spawn) → the drive must NOT
// verdict the member failed while its evidence advances (the member keeps working and completes).
//
// Contract (closed):
//   1. The drive treats a member as failed ONLY on terminal evidence (task failed transition
//      with cause, process_closed with no successor, or startError) — never on a status read
//      racing the spawn-confirmation window. Evidence-count confirmation mirrors the landed
//      tri-state pattern (3794b583): a suspicious read defers to the next poll.
//   2. The double-spawn window: if the second lifecycle.spawned is a harness retry the
//      coordinator owns, bind it to the same member (generation advance), not a new claim.
//   3. This suite reproduces the event shape and asserts the member is NOT verdict-failed while
//      evidence advances.
//
// Red-first: the coordinator row and the drive row each fail at their named stage at HEAD and go
// green ONLY on the row's implementation (the coordinator's same-member generation advance + the
// wave drive's evidence-count terminal confirmation). The typed-evidence and success rows are
// pins — green at HEAD and under the fix, but killed by a plausible WRONG implementation
// (deferring EVERY failed read forever, or refusing a legitimate terminal cause).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import createWave from '../src/wave.mjs';

// ===========================================================================
// Coordinator-level fixtures (the coordinator.test.mjs ScriptableAdapter idiom)
// ===========================================================================

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-spawn-window-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeBrief(overrides = {}) {
  return {
    goal: 'do the thing',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    ...overrides,
  };
}

function makeWorkerResult(overrides = {}) {
  return {
    status: 'completed',
    summary: 'ok',
    artifacts: { commits: ['sha1'], files: [] },
    verification: { command: 'true', claimedExit: 0 },
    openQuestions: [],
    budgetUsed: { tokens: 1, usd: 0.01 },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// Scriptable fake conforming to coordinator.mjs's Adapter contract. The spawn gate lets the
// fixture hold the dispatch window open (nativeSpawnPending stays true) so the worker-origin
// process_started/spawned/turn_started evidence can be interleaved exactly as the wire emits it.
function makeScriptableAdapter() {
  const spawnGate = deferred();
  const adapter = {
    spawnGate,
    calls: { spawn: [], kill: [] },
    _onEvent: null,
    card() {
      return {
        harness: 'mock', version: '1.0.0', authPosture: 'api_key',
        concurrencyCeiling: Infinity, maxContext: 100000,
        verbs: { spawn: 'native', interrupt: 'native' },
      };
    },
    onEvent(cb) { this._onEvent = cb; },
    emit(event) { if (this._onEvent) this._onEvent(event); },
    async spawn(worker, brief) {
      this.calls.spawn.push({ worker, brief });
      await spawnGate.promise;
      return { ok: true };
    },
    async prompt() { return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
    async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; },
  };
  return adapter;
}

function makeWorktrees() {
  return {
    async create(taskId, baseRef) {
      return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' };
    },
    async capture() { return { sha: 'sha-result' }; },
    async createVerifyWorktree() { return { path: '/tmp/verify/x' }; },
    async removeVerifyWorktree() {},
    async remove() {},
    async reconcile() {},
    worktreeAvailable() { return true; },
  };
}

function passingReferee() {
  return async (task, result, opts) => ({
    reverified: true,
    observedExit: task.brief.verification.expectExit,
    matchesClaim: true,
    locus: 'fresh_sandbox',
    note: 'ok',
  });
}

function makeCoordinator({ log, adapters, coordination }) {
  return new Coordinator({
    log,
    coordination: coordination ?? coordinationForLog(log),
    fences: new FenceTable(),
    adapters,
    worktrees: makeWorktrees(),
    capabilities: null,
    referee: passingReferee(),
    route: () => Object.keys(adapters)[0],
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const processStartedPayload = (generation, pid) => ({
  schemaVersion: 1, generation, pid, processGroupId: pid, phase: 'initializing',
});
const spawnedPayload = (sessionId, generation, pid) => ({ sessionId, pid, processGeneration: generation });

// ===========================================================================
// §1 — the coordinator double-spawn window (contract point 2)
// ===========================================================================

test('SW-1 RED: a second lifecycle.spawned for the same member (harness retry) binds a generation advance — never a kill or failed verdict', async () => {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const adapter = makeScriptableAdapter();
  const coordinator = makeCoordinator({ log, adapters: { mock: adapter } });

  const handle = await coordinator.spawn('mock', makeBrief());
  const workerId = handle.id;
  coordinator.tick();
  await flush();
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'working', 'fixture: the member claimed its task');

  // Evidence shape: claim -> process_started -> spawned -> turn_started -> SECOND spawned.
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.process_started', actor: 'worker', payload: processStartedPayload(1, 100) });
  await flush();
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.spawned', actor: 'worker', payload: spawnedPayload('sess-1', 1, 100) });
  await flush();
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  await flush();
  assert.equal(log.read(workerId).filter((e) => e.kind === 'lifecycle.process_attribution_refused').length, 0, 'fixture: the first spawned is admitted');

  // The harness double-spawn: SAME wire session identity, a NEWER harness process.
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.spawned', actor: 'worker', payload: spawnedPayload('sess-1', 2, 200) });
  await flush();
  adapter.spawnGate.resolve();
  await flush();

  const worker = coordinator._workers.get(workerId);
  assert.equal(adapter.calls.kill.length, 0,
    'stage: attribution-refusal kill — a harness retry the coordinator owns must never kill the member');
  assert.equal(log.read(workerId).filter((e) => e.kind === 'lifecycle.process_attribution_refused').length, 0,
    'stage: attribution refusal — the same-member retry is not a foreign attribution');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'working',
    'stage: claim invalidation — the member keeps its task claim');
  assert.equal(worker.status, 'working', 'the member keeps working');
  assert.equal(worker.processGeneration, 2,
    'stage: generation advance — the newer harness process binds to the same member');
  assert.equal(worker.processRef.generation, 2, 'the tracked process is the retry process');
  assert.equal(worker.processRef.pid, 200, 'the tracked process is the retry pid');
  assert.ok(log.read(workerId).some((e) => e.kind === 'lifecycle.process_generation_advanced'),
    'the generation advance is durable');

  // Evidence advances: the member completes its turn — it is never verdict-failed.
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker', payload: { result: makeWorkerResult() } });
  await flush();
  await flush();
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'completed',
    'stage: verdict — the member completes while its evidence advances, never failed');
});

test('SW-2 RED: the generation advance is replay-durable — a restarted coordinator reconstructs the member at the retry process', async () => {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const adapter = makeScriptableAdapter();
  const coordination = coordinationForLog(log);
  const coordinator = makeCoordinator({ log, adapters: { mock: adapter }, coordination });

  const handle = await coordinator.spawn('mock', makeBrief());
  const workerId = handle.id;
  coordinator.tick();
  await flush();

  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.process_started', actor: 'worker', payload: processStartedPayload(1, 100) });
  await flush();
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.spawned', actor: 'worker', payload: spawnedPayload('sess-1', 1, 100) });
  await flush();
  adapter.emit({ worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.spawned', actor: 'worker', payload: spawnedPayload('sess-1', 2, 200) });
  await flush();
  adapter.spawnGate.resolve();
  await flush();
  assert.equal(coordinator._workers.get(workerId).processGeneration, 2, 'fixture: the live member advanced');

  // Restart over the same log directory (the D10 normal replay construction).
  coordination.releaseWriterLease();
  const log2 = new Log(join(dir, 'log'));
  const adapter2 = makeScriptableAdapter();
  const coordinator2 = makeCoordinator({ log: log2, adapters: { mock: adapter2 } });
  const replayed = coordinator2._workers.get(workerId);
  assert.equal(replayed.processGeneration, 2,
    'stage: replay — the reconstructed member is on the retry generation, not the superseded one');
  assert.equal(replayed.processRef.generation, 2, 'replay binds the retry process');
  assert.equal(replayed.processRef.pid, 200, 'replay binds the retry pid');
});

// ===========================================================================
// §2 — the drive's member-status read (contract point 1): evidence-count confirmation
// ===========================================================================

function makeWaveBaton(sequenceByRole) {
  let runSeq = 0;
  const runs = new Map();
  const baton = {
    runs: {
      async start(objective, opts = {}) {
        const role = opts.waveRole;
        const seq = sequenceByRole.get(role) ?? [];
        const run = {
          id: `run-${++runSeq}`,
          role,
          reads: 0,
          async status() {
            const outline = seq[Math.min(this.reads, seq.length - 1)];
            this.reads += 1;
            return { view: outline };
          },
          async inspect() { return { section: null }; },
          async complete() { return { ok: true }; },
          async stop() { return { outline: {} }; },
          async approve() { return { ok: true }; },
          async act() { return { ok: true }; },
          async send() { return { ok: true }; },
        };
        runs.set(role, run);
        return run;
      },
    },
  };
  return { baton, runs };
}

const waveMember = (role, objective) => ({
  role, objective, harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'],
});

const suspiciousFailed = () => ({ phase: 'failed', terminal: false, terminalCause: null });
const running = () => ({ phase: 'working' });
const evidenceFailed = () => ({
  phase: 'failed', terminal: true, terminalCause: { kind: 'provider_failure', code: 'provider_crashed' },
});

test('SW-3 RED: a failed-phase read racing the spawn window is NOT a verdict — evidence advancing keeps the member alive', async () => {
  // Two suspicious reads (the window), then the member's evidence advances and it works to
  // completion. At HEAD the FIRST read verdicts the member failed (the settle loop settles and
  // its outcome re-read still lands on a failed phase); with the evidence-count the drive defers
  // both suspicious reads, watches the evidence advance, and never produces a failed verdict.
  const sequence = [
    suspiciousFailed(),           // racing the window — no terminal evidence
    suspiciousFailed(),           // still racing — no terminal evidence
    running(), running(), running(), running(),
    running(), running(), running(), running(),
    running(), running(), running(), running(),
  ];
  const { baton, runs } = makeWaveBaton(new Map([['alpha', sequence]]));
  const wave = await createWave(baton, { members: [waveMember('alpha', 'alpha objective')], approve: false });

  const outcomes = await wave.settle({ timeoutMs: 300 });
  const outcome = outcomes.find((o) => o.role === 'alpha');
  assert.notEqual(outcome.phase, 'failed',
    'stage: instant failed verdict — a suspicious read inside the window must not verdict the member failed');
  assert.equal(outcome.terminal, false, 'the member is not terminal while its evidence advances');
  assert.ok(runs.get('alpha').reads >= 2,
    'the drive deferred to the next poll instead of settling on the first read');
});

test('SW-4 PIN: the evidence-count confirms — consecutive suspicious reads settle the failed verdict (never an eternal deferral)', async () => {
  // The first poll is suspicious (defers); the count confirms only after
  // SPAWN_WINDOW_CONFIRMATION_POLLS consecutive reads. Green at HEAD (instant verdict) and under
  // the evidence-count; kills an implementation that defers EVERY failed read forever.
  const sequence = [
    suspiciousFailed(), suspiciousFailed(), suspiciousFailed(), suspiciousFailed(),
  ];
  const { baton } = makeWaveBaton(new Map([['alpha', sequence]]));
  const wave = await createWave(baton, { members: [waveMember('alpha', 'alpha objective')], approve: false });

  const outcomes = await wave.settle({ timeoutMs: 1000 });
  const outcome = outcomes.find((o) => o.role === 'alpha');
  assert.equal(outcome.phase, 'failed', 'the evidence-count confirmation settles the member failed');
  assert.equal(outcome.terminal, true);
});

test('SW-5 RED: progress() reports the evidence-count — a suspicious read defers terminal, the confirmation flips it', async () => {
  const sequence = [
    suspiciousFailed(),
    running(),
    suspiciousFailed(), suspiciousFailed(), suspiciousFailed(),
    running(),
  ];
  const { baton } = makeWaveBaton(new Map([['alpha', sequence]]));
  const wave = await createWave(baton, { members: [waveMember('alpha', 'alpha objective')], approve: false });

  // Poll 1 — the suspicious read defers: the member reads phase failed but NOT terminal.
  const first = await wave.progress();
  assert.equal(first.members[0].phase, 'failed', 'the suspicious phase is surfaced honestly');
  assert.equal(first.members[0].terminal, false,
    'stage: instant terminal — the suspicious read must not report terminal; it defers to the next poll');

  // Poll 2 — evidence advanced: the member is working, not failed.
  const second = await wave.progress();
  assert.equal(second.members[0].phase, 'working', 'the member kept working while evidence advanced');
  assert.equal(second.members[0].terminal, false);

  // Polls 3-5 — three consecutive suspicious reads confirm the verdict.
  await wave.progress();
  await wave.progress();
  const confirmed = await wave.progress();
  assert.equal(confirmed.members[0].phase, 'failed');
  assert.equal(confirmed.members[0].terminal, true,
    'stage: no evidence-count — only consecutive suspicious reads confirm terminal');

  // Poll 6 — evidence advanced again (the member recovered); the verdict is NOT sticky.
  const recovered = await wave.progress();
  assert.equal(recovered.members[0].terminal, false, 'a non-suspicious read resets the count');
});

test('SW-6 PIN: a failed read WITH typed terminal evidence settles immediately (the task failed transition with cause)', async () => {
  const sequence = [evidenceFailed()];
  const { baton } = makeWaveBaton(new Map([['alpha', sequence]]));
  const wave = await createWave(baton, { members: [waveMember('alpha', 'alpha objective')], approve: false });

  const outcomes = await wave.settle({ timeoutMs: 300 });
  const outcome = outcomes.find((o) => o.role === 'alpha');
  assert.equal(outcome.phase, 'failed');
  assert.equal(outcome.terminal, true,
    'a typed terminal cause is positive terminal evidence — the drive must not defer it');
});

test('SW-7 PIN: a success resting read settles immediately (success needs no failure cause)', async () => {
  const sequence = [{ phase: 'result_ready', terminal: true }];
  const { baton } = makeWaveBaton(new Map([['alpha', sequence]]));
  const wave = await createWave(baton, { members: [waveMember('alpha', 'alpha objective')], approve: false });

  const outcomes = await wave.settle({ timeoutMs: 300 });
  const outcome = outcomes.find((o) => o.role === 'alpha');
  assert.equal(outcome.phase, 'result_ready');
  assert.equal(outcome.terminal, true);
});
