// #199 root — no failed-verdict inside the spawn-confirmation window.
// ---------------------------------------------------------------------------
// Issue #199 phantom-failure class: the member claims its task (seq N), lifecycle.spawned N+2,
// turn_started + process_started N+3-4, then a SECOND lifecycle.spawned N+5 (harness
// double-spawn) — and the interpreter verdicts the member failed while it keeps working
// orphaned. Two closed contracts (row-spawn-window):
//
//   1. The interpreter/drive treats a member as failed ONLY on terminal evidence (task failed
//      transition with cause, process_closed with no successor, or startError) — never on a
//      status read racing the spawn-confirmation window. Evidence-count confirmation mirrors the
//      landed tri-state pattern (3794b583): a suspicious read defers to the next poll, and only
//      a persistent streak of consecutive suspicious reads confirms the failed verdict.
//   2. The double-spawn window itself: a second lifecycle.spawned for the same worker is a
//      harness retry the coordinator owns — bind it to the same member (generation advance),
//      never a new claim and never an attribution kill.
//
// Event shape under test (per the brief): claim -> spawned -> process_started -> second spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { createWave } from '../src/wave.mjs';
import runWorkflow from '../src/workflow-interpreter.mjs';

// ---------------------------------------------------------------------------
// Coordinator fixture (mirrors coordinator.test.mjs local-fake conventions)
// ---------------------------------------------------------------------------

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

/** Scriptable worker adapter — events are pushed deterministically via emit(). */
class ScriptableAdapter {
  constructor({ harness = 'mock', version = '1.0.0' } = {}) {
    this._card = { harness, version, authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000, verbs: { spawn: 'native', interrupt: 'native' } };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this.gates = { spawn: null, prompt: null, interrupt: null, approve: null, answer: null, kill: null };
    this.acks = { spawn: { ok: true }, prompt: { ok: true }, interrupt: { ok: true }, approve: { ok: true }, answer: { ok: true }, kill: { ok: true } };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) {
    this.calls.spawn.push({ worker, brief });
    if (this.gates.spawn) await this.gates.spawn;
    return this.acks.spawn;
  }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return this.acks.prompt; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return this.acks.interrupt; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return this.acks.approve; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return this.acks.answer; }
  async kill(worker) { this.calls.kill.push({ worker }); return this.acks.kill; }
}

/** Spy WorktreeManager (mirrors coordinator.test.mjs). */
class SpyWorktreeManager {
  constructor() {
    this.calls = { create: [], capture: [], createVerifyWorktree: [], removeVerifyWorktree: [], remove: [], reconcile: [], worktreeAvailable: [] };
    this.available = true;
  }
  async create(taskId, baseRef) {
    this.calls.create.push({ taskId, baseRef });
    return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' };
  }
  async capture(worktreePath) {
    this.calls.capture.push({ worktreePath });
    return { sha: 'sha-result' };
  }
  async createVerifyWorktree(taskId, sha) {
    this.calls.createVerifyWorktree.push({ taskId, sha });
    return { path: `/tmp/verify/${taskId}-${sha}` };
  }
  async removeVerifyWorktree(verifyPath) {
    this.calls.removeVerifyWorktree.push({ verifyPath });
  }
  async remove(taskId) { this.calls.remove.push({ taskId }); }
  async reconcile() { this.calls.reconcile.push({}); }
  worktreeAvailable(taskId, context) {
    this.calls.worktreeAvailable.push({ taskId, context });
    return this.available;
  }
}

function passingReferee() {
  return async (task, result) => ({
    reverified: true,
    observedExit: task.brief.verification.expectExit,
    matchesClaim: true,
    locus: 'fresh_sandbox',
    note: 'ok',
  });
}

function fixedRoute(vendor) {
  return () => vendor;
}

function setup(overrides = {}) {
  const dir = tmpDir();
  const log = overrides.log ?? new Log(join(dir, 'log'));
  const coordination = overrides.coordination ?? coordinationForLog(log);
  const fences = overrides.fences ?? new FenceTable();
  const adapters = overrides.adapters ?? { mock: new ScriptableAdapter() };
  const worktrees = overrides.worktrees ?? new SpyWorktreeManager();
  let t = 0;
  const now = overrides.now ?? (() => t);
  const advance = (ms) => { t += ms; };
  const coordinator = new Coordinator({
    log,
    coordination,
    fences,
    adapters,
    worktrees,
    capabilities: overrides.capabilities ?? null,
    referee: overrides.referee ?? passingReferee(),
    route: overrides.route ?? fixedRoute(Object.keys(adapters)[0]),
    now,
    approvalTimeoutMs: overrides.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: overrides.stopDeadlineMs ?? 15000,
  });
  return { dir, log, fences, adapters, worktrees, now, advance, coordinator, coordination };
}

// ---------------------------------------------------------------------------
// Contract 2 — the double-spawn window binds to the same member
// ---------------------------------------------------------------------------

test('SW-2: a SECOND lifecycle.spawned for the same worker is a harness retry the coordinator owns — bound (generation advance), never a new claim, never an attribution kill; evidence advances', async () => {
  // The harness emits its lifecycle events INSIDE the coordinator's spawn-confirmation window —
  // exactly what the real adapters do (claude-session emits process_started synchronously in
  // spawn(); its wire lifecycle.spawned can land before the spawn Ack resolves).
  const scripted = new ScriptableAdapter();
  const nativeSpawn = scripted.spawn.bind(scripted);
  scripted.spawn = async (worker, brief) => {
    // process_started (N+4): the harness's first process confirms.
    scripted.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.process_started', actor: 'worker',
      payload: { schemaVersion: 1, generation: 1, pid: 1001, processGroupId: 1001, phase: 'initializing' },
    });
    // A SECOND lifecycle.spawned (N+5): the harness retry's wire identity — same coordinator
    // generation, a NEW process/session (the retry the coordinator owns).
    scripted.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.spawned', actor: 'worker',
      payload: { sessionId: 'sess-retry', processGeneration: 1, pid: 1002 },
    });
    return nativeSpawn(worker, brief);
  };
  const { coordinator, adapters, log, coordination } = setup({ adapters: { mock: scripted } });
  // claim -> spawned (orchestrator) -> turn_started: one ordinary dispatch.
  const handle = await coordinator.spawn('mock', makeBrief());
  assert.equal(handle.status, 'working');
  const worker = handle.id;
  const taskId = handle.taskId;
  const kinds = log.read(worker).map((event) => event.kind);
  assert.ok(kinds.includes('lifecycle.spawned'), 'the dispatch minted its lifecycle.spawned');
  assert.ok(kinds.includes('lifecycle.turn_started'), 'the dispatch minted its lifecycle.turn_started');

  // Contract 2: the retry binds to the same member — no attribution refusal, no kill. The
  // member's identity advanced to the retry's process, and no new claim was minted.
  const refused = log.read(worker).filter((event) => event.kind === 'lifecycle.process_attribution_refused');
  assert.equal(refused.length, 0,
    `the second spawned is bound, never refused (${refused.map((event) => event.payload?.reason ?? event.kind).join(',')})`);
  assert.equal(adapters.mock.calls.kill.length, 0, 'the harness retry never escalates to a kill');
  const claims = coordination.eventsView().filter((event) => event.kind === 'task.claimed'
    && event.payload?.id === taskId);
  assert.equal(claims.length, 1, 'the retry binds to the same member — never a new claim');
  assert.equal(coordinator.list().find((entry) => entry.id === worker).status, 'working',
    'the member keeps working through the double-spawn window');

  // Evidence advances: the retried session completes its turn normally.
  adapters.mock.emit({
    worker, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: makeWorkerResult(),
  });
  await coordinator.wait(200);
  assert.equal(coordination.task(taskId)?.status, 'completed',
    'evidence advances through the double-spawn window to a completed task — never a failed verdict');
});

// ---------------------------------------------------------------------------
// Contract 1 — the drive never verdicts failed on a suspicious status read
// ---------------------------------------------------------------------------

/**
 * A minimal baton facade whose run handle serves scripted status views. The wave surface
 * (createWave/settle) reads entry.run.status() — the drive-loop member-status read that
 * produced the instant failed (wave.mjs).
 */
function scriptedWaveFacade(states) {
  let reads = 0;
  const run = {
    id: 'run-1',
    async approve() {},
    async status() {
      const index = Math.min(reads, states.length - 1);
      reads += 1;
      return { view: states[index] };
    },
    async complete() { return { ok: true }; },
    async inspect() { return null; },
    async send() { return {}; },
    async act() { return { ok: true }; },
    async stop() { return { ok: true }; },
  };
  return {
    runs: {
      async start() { return run; },
      async list() { return { items: [] }; },
      async attach() { return run; },
    },
    waves: { start: () => { throw new Error('unused'); } },
  };
}

const member = (role, objective = `write the ${role} report`, options = {}) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
  ...options,
});

test('SW-1: a failed-phase status read WITHOUT typed terminal evidence is a spawn-window race — the drive defers and the member survives when evidence advances', async () => {
  // The event shape's run view DURING the double-spawn window: phase 'failed' with no typed
  // terminal cause (no task-failed transition, no process-close-with-no-successor, no
  // startError). Evidence then advances: the member returns to work and completes.
  const states = [
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'running', terminalCause: null, nodes: [{ taskId: 't-1', state: 'dispatched' }] },
    { phase: 'completed', terminalCause: { kind: 'provider_failure', code: 'mock' }, nodes: [] },
  ];
  const baton = scriptedWaveFacade(states);
  const wave = await createWave(baton, { members: [member('alpha')] });
  const outcomes = await wave.settle({ timeoutMs: 2_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  assert.equal(alpha.phase, 'completed',
    `evidence advance after the window must win — the member was verdict-failed on a read racing the window (got ${alpha.phase})`);
  assert.equal(alpha.terminal, true, 'the survivor settles terminal on the real completion');
  await wave.close({ reason: 'SW-1 settled.' });
});

test('SW-1b: a persistent failed-without-evidence streak confirms the failed verdict by evidence count (the 3794b583 tri-state pattern)', async () => {
  // Three consecutive suspicious reads (the evidence-count confirmation) then a terminal
  // completion — the drive must confirm the failed verdict WITHOUT the typed cause, exactly
  // like the worktree tri-state's persistent-unknown-streak failure.
  const states = [
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'failed', terminalCause: { kind: 'provider_failure', code: 'spawn_refused' }, nodes: [] },
  ];
  const baton = scriptedWaveFacade(states);
  const wave = await createWave(baton, { members: [member('alpha')] });
  const outcomes = await wave.settle({ timeoutMs: 2_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  assert.equal(alpha.phase, 'failed', 'the evidence-count streak confirms the failed verdict');
  assert.equal(alpha.terminal, true, 'the confirmed failed verdict is terminal');
  await wave.close({ reason: 'SW-1b settled.' });
});

test('SW-3: a typed task-failed transition with cause settles failed on the FIRST read — terminal evidence never defers', async () => {
  // Guard the gate's other side: real terminal evidence (task failed transition WITH cause)
  // is still an immediate failed verdict — the deferral exists for the race, never for the
  // durable fact.
  const states = [
    { phase: 'failed', terminalCause: { kind: 'policy_failure', code: 'worker_worktree_authority_lost' }, nodes: [] },
  ];
  const baton = scriptedWaveFacade(states);
  const wave = await createWave(baton, { members: [member('alpha')] });
  const outcomes = await wave.settle({ timeoutMs: 2_000 });
  const alpha = outcomes.find((outcome) => outcome.role === 'alpha');
  assert.equal(alpha.phase, 'failed', 'a typed task-failed transition with cause is terminal evidence');
  assert.equal(alpha.terminal, true);
  await wave.close({ reason: 'SW-3 settled.' });
});

// ---------------------------------------------------------------------------
// Contract 1 at the interpreter surface — the third drive member-status read
// ---------------------------------------------------------------------------

/**
 * The interpreter's own member-status read (workflow-interpreter.mjs readView over
 * handle.inspect/handle.status) is the third drive surface the #199 gate covers. This facade
 * serves one scripted outline per read (the LAST outline repeats) and records every stop the
 * interpreter issues, so the deliberate reap is observable.
 */
function interpreterFacade(states, stops) {
  let reads = 0;
  const serve = () => states[Math.min(reads, states.length - 1)];
  const run = {
    id: 'run-alpha',
    async inspect() { const state = serve(); reads += 1; return { outline: state }; },
    async status() { const state = serve(); reads += 1; return { view: state }; },
    async stop(reason) {
      stops.push({ role: 'alpha', reason });
      return {
        stop: { status: 'stopped', reason },
        outline: { resources: { state: 'released', cleanupState: 'clean', ownedCount: 0 } },
      };
    },
  };
  const wave = {
    waveId: 'wave:spawn-window-199',
    runs: new Map([['alpha', run]]),
    // Mirrors wave.mjs's own close: every member is stopped and its stop record rides the
    // receipt — this is the reap the interpreter's declared verdict must perform.
    async close({ reason = 'Wave settled.' } = {}) {
      const receipts = [];
      for (const [role, handle] of wave.runs) {
        const stopped = await handle.stop(reason);
        receipts.push({
          role, stop: stopped.stop,
          resources: { ...stopped.outline.resources }, ownedCount: stopped.outline.resources.ownedCount,
        });
      }
      return {
        reason, stops: receipts, remainingCount: 0, residueUnknown: false,
        knowledge: { candidates: 0, admittedThisRun: 0 }, drivesCancelled: 0, pumpQuiescent: true,
      };
    },
  };
  return {
    baton: { waves: { async start() { return wave; } } },
  };
}

/** A hermetic one-member spec whose objectiveRef resolves inside the temp repository. */
function interpreterSpec(repoRoot) {
  mkdirSync(join(repoRoot, 'objectives'), { recursive: true });
  writeFileSync(join(repoRoot, 'objectives', 'alpha.md'), 'write the alpha report\n');
  return {
    schemaVersion: 1,
    idempotencyKey: 'i199-spawn-window',
    members: [{
      role: 'alpha',
      exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
      scope: ['reports/**'],
      objectiveRef: 'objectives/alpha.md',
    }],
    steering: {},
    harvest: { paths: [] },
  };
}

function interpreterRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-swp-interp-'));
  dirs.push(dir);
  return dir;
}

test('SW-4: the interpreter defers a failed-phase read that races the spawn window — the member survives to its real completion', async () => {
  // Read 1-2 land inside the harness's double-spawn window (phase 'failed', no typed terminal
  // evidence); read 3 onward is the member's real completion. The interpreter must NOT declare
  // the member failed on the racing reads — and it must still settle the survivor terminal.
  const stops = [];
  const repoRoot = interpreterRepo();
  const { baton } = interpreterFacade([
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'failed', terminalCause: null, nodes: [] },
    { phase: 'completed', terminalCause: { kind: 'provider_failure', code: 'mock' }, nodes: [] },
  ], stops);
  const receipt = await runWorkflow(baton, interpreterSpec(repoRoot), {
    driver: { pollIntervalMs: 5, stallTimeoutMs: 400 }, repoRoot,
  });
  const alpha = receipt.outcomes.find((outcome) => outcome.role === 'alpha');
  assert.equal(alpha.phase, 'completed', 'the evidence advance wins over the read racing the window');
  assert.equal(alpha.terminal, true, 'the survivor settles terminal on its real completion');
  assert.equal(receipt.verdict, 'WAVE-OK', 'a window race never costs the wave its verdict');
  assert.equal(
    receipt.steering.some((row) => row.evidence === 'wave_member_terminal_confirmed'),
    false,
    'no failed verdict was declared — the real completion arrived first',
  );
});

test('SW-5: a confirmed failed verdict (evidence count) reaps the member deliberately, with the stop on the close receipt', async () => {
  // The view never advances past the racing read: after SPAWN_WINDOW_CONFIRMATION_READS consecutive
  // suspect reads the interpreter declares the failed verdict AND stops the member — the reap rides
  // the close receipt beside the confirmation row, so no live orphan outlives the verdict.
  const stops = [];
  const repoRoot = interpreterRepo();
  const { baton } = interpreterFacade([{ phase: 'failed', terminalCause: null, nodes: [] }], stops);
  const receipt = await runWorkflow(baton, interpreterSpec(repoRoot), {
    driver: { pollIntervalMs: 5, stallTimeoutMs: 400 }, repoRoot,
  });
  const alpha = receipt.outcomes.find((outcome) => outcome.role === 'alpha');
  assert.equal(alpha.phase, 'failed', 'the evidence-count confirmation declares the failed verdict');
  assert.equal(alpha.terminal, true, 'the confirmed verdict is terminal even though the last read still races');
  const confirmation = receipt.steering.find((row) => row.evidence === 'wave_member_terminal_confirmed');
  assert.ok(confirmation, 'the confirmation is recorded on the steering trail');
  assert.equal(confirmation.reads, 3, 'the confirmation is the third consecutive suspect read');
  const deferred = receipt.steering.filter((row) => row.evidence === 'wave_member_spawn_window');
  assert.equal(deferred.length, 2, 'the two deferred reads before the confirmation are recorded');
  assert.deepEqual(stops, [{ role: 'alpha', reason: 'Workflow interpreter settled.' }],
    'the orphaned member is reaped deliberately (one stop), never left live behind the verdict');
  const closeRow = receipt.steering.find((row) => row.evidence === 'wave_close_result');
  assert.equal(closeRow?.receipt?.stops?.[0]?.role, 'alpha', 'the reap rides the close receipt');
});
