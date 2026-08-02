// Trust-gate steering epic red suite (contract: docs/reference/evidence/
// trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md v1.0 — issues #64/#61).
//
// Seventeen rows over the folded decisions: TG1's checkpoint/final taxonomy (deferral is
// non-dispatch — no gate events at a checkpoint, full strength at finals); TG3's one bounded
// steering cycle at the pause-admission seam (provenance-marked nudge, bounded window,
// once-per-record, claim counts as the answer); TG2's farm-proof evidence rules (distinct-
// digest dedup, resolution-gated interactions); TG4's revision-channel verdict (sanitized,
// self-naming); TG5's plan-node analysis field (sole omission path); TG6's coaching
// retirement; and regression pins that every final-evaluation behavior is byte-identical.
//
// Red-first: written against the v1.0 contract BEFORE implementation; every row fails for
// the named stage and goes green on the contract's implementation ONLY. Harness pattern
// mirrors test/decision-gate-trust-gate-red.test.mjs (ScriptableAdapter + fake worktrees).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import {
  GoalPlanValidationError, normalizeGoalPlanPolicy, normalizeGoalRequest, normalizePlanRequest,
} from '../src/goal-plan.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-tgs-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function makeBrief(overrides = {}) {
  return {
    goal: 'produce an in-scope diff after legitimate multi-turn work',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor({ pausable = true } = {}) {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
      ...(pausable ? { turnCompletion: 'pausable' } : {}),
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

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function setup({ capture, adapter, coordinatorOpts = {} }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
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
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25, // TG3's bounded window — small for determinism
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });
const withDiff = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['file-in-scope.txt'] });

function emitTurnCompleted(adapter, handle, turnEpoch = 1, output = 'mid-workflow checkpoint') {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output },
  });
}

function emitScratchWrite(adapter, handle, key, text) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'scratchpad.write', actor: 'worker',
    payload: { entry: { kind: 'note', text }, expectedFence: 'current', idempotencyKey: key },
  });
}

// ===========================================================================
// TG1 — checkpoint/final taxonomy (stage: taxonomy missing)
// ===========================================================================

test('T1: a pausable checkpoint turn with no diff gets NO gate dispatch — no verdict, no kill, one policy nudge', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed', 'no required_effect verdict at a checkpoint');
  assert.notEqual(task.status, 'completed', 'no acceptance at a checkpoint either — deferral is non-dispatch');
  assert.equal(adapter.calls.kill.length, 0, 'the healthy multi-turn worker is never killed');
  const gateEvents = ['forbidden_effect_observed', 'worker_path_scope_violation', 'required_effect_absent'];
  assert.equal(coordinator._log.read(handle.id).filter((event) => gateEvents.includes(event.payload?.code)).length, 0,
    'zero gate verdict events');
  const nudges = adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:'));
  assert.equal(nudges.length, 1, 'exactly one provenance-marked progress nudge (TG3)');
});

test('T2: a FINAL (claim-classified) turn with no diff on a required-edit plan still fails required_effect_absent (anti-gaming pin)', async () => {
  const adapter = new ScriptableAdapter({ pausable: false });
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed', 'finals evaluate exactly as today');
  assert.equal(adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:')).length, 0,
    'no steering cycle is spent on a claim-classified (final) turn');
});

test('T3: a pausable checkpoint on a NO-required-effects brief is NOT accepted mid-workflow (no mid-workflow completion)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ requiredEffects: [] }));
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'completed', 'checkpoint pauses never accept (A1: acceptance is final-only too)');
});

// ===========================================================================
// TG3 — the steering cycle (stage: cycle missing)
// ===========================================================================

test('T5: a diff inside the window answers the cycle — settle working, zero gate events', async () => {
  const adapter = new ScriptableAdapter();
  let capture = noDiff;
  const { coordinator } = setup({ adapter, capture: async () => capture() });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  capture = withDiff;
  emitTurnCompleted(adapter, handle, 2, 'diff produced on the continuation turn');
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.ok(['working', 'paused', 'verifying', 'completed'].includes(task.status),
    `the answered cycle never becomes a progress verdict (got ${task.status})`);
  assert.notEqual(task.status, 'failed');
  assert.equal(adapter.calls.kill.length, 0);
});

test('T6: a distinct scratchpad receipt answers the cycle (coordination work is liveness)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  emitScratchWrite(adapter, handle, 't6-note', 'the lease binds a working orchestrator parent');
  await flush(40);
  await sleep(60); // past the 25ms window — the receipt must have answered in time
  await flush(20);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed', 'the distinct receipt answered the cycle before expiry');
  assert.equal(adapter.calls.kill.length, 0);
});

test('T7: duplicate one-char receipts count ONCE — the cycle expires and the full final evaluation lands with the steering receipt', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  for (let index = 0; index < 6; index += 1) emitScratchWrite(adapter, handle, `t7-dup-${index}`, 'x');
  await flush(40);
  await sleep(60); // window expiry
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed', 'dupes do not answer — the verdict proceeds');
  const failedEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'task.failed'
    || (event.kind === 'worktree.progress_unchanged' && event.payload?.state === 'no_progress'));
  assert.ok(failedEvent, 'the verdict event exists');
  assert.ok(JSON.stringify(coordinator._log.read(handle.id)).includes('"answered":false')
    || JSON.stringify(failedEvent.payload ?? {}).includes('steered'),
    'the steering receipt is durable on the verdict (steered.answered === false)');
});

test('T8: a pending question earns nothing; resolving it inside the window answers the cycle', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  const requestId = 't8:question:1';
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId, question: 'should I continue with approach A?', blocking: false },
  });
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed', 'no verdict while the cycle window is open');
  // A pending question does NOT answer: the cycle must still be pending (not settled-working yet).
  // (After expiry the verdict WOULD land — resolution must come first.)
  await coordinator.respond(requestId, { text: 'yes, approach A' }).catch(() => {});
  await flush(40);
  await sleep(60);
  await flush(20);
  assert.notEqual(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the resolved interaction answered the cycle');
});

test('T9: a drivered run gets NO policy cycle (the driver\'s claim cadence owns steering)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  coordinator._coordination.recordDriver('steering.registered', { runId: task.runId },
    { actor: 'orchestrator', key: `driver.recorded:steering.registered:${task.runId}` });
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:')).length, 0,
    'no policy nudge when a driver is registered');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused', 'the pause pends for the driver claim');
  void log;
});

// ===========================================================================
// TG4 — the revision-channel verdict (stage: channel missing)
// ===========================================================================

test('T11: a gate failure verdict reaches the re-driven brief, sanitized and self-naming', async () => {
  const adapter = new ScriptableAdapter({ pausable: false });
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed');
  const failure = task.failure ?? task.terminalCause ?? null;
  assert.match(JSON.stringify(failure), /required_effect/, 'the failure names its gate, never "unknown"');
  const refined = await coordinator._coordination.createAndClaimRecoveryRefinement({
    id: `${task.id}-retry`, refines: task.id, runId: task.runId, taskType: 'general',
    reservedWorkerId: 'w-retry', vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@1.0.0',
    modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","1.0.0","mock-model","low"]',
  }, { actor: 'orchestrator', key: `recovery:${task.id}` });
  const briefText = JSON.stringify(refined.task?.brief ?? {});
  assert.match(briefText, /required_effect/, 'the re-driven brief carries the gate name');
  assert.doesNotMatch(briefText, /file-in-scope\.txt|\/tmp\/wt\//, 'the verdict carries digests, never path strings');
});

// ===========================================================================
// TG5 — the plan-node analysis field (stage: field missing)
// ===========================================================================

const tgPolicy = normalizeGoalPlanPolicy({
  schemaVersion: 1, repoId: 'repo-tgs', mandatory: true, approvalTtlMs: 3_600_000,
  riskClasses: ['low', 'high'], effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: {
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 4_096, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 1_000,
  },
});
const tgBudget = { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 4 };
const tgVerification = {
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
};

function tgPlanRequest(nodeOverrides = {}) {
  const goal = {
    ...normalizeGoalRequest({
      objective: 'survey without producing code', definitionOfDone: ['report written'],
      constraints: [], risk: 'low', budget: tgBudget, predecessor: null,
    }, tgPolicy),
    goalId: `goal:${'a'.repeat(64)}`, version: 1, digest: 'b'.repeat(64),
  };
  return {
    goal,
    request: {
      goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
      nodes: [{
        key: 'survey', objective: 'Survey and report', definitionOfDone: ['report written'],
        deps: [], pathScope: ['docs/**'], risk: 'low', budget: tgBudget, verification: tgVerification,
        routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
        capabilities: ['code', 'test'], effects: ['provider_call'],
        ...nodeOverrides,
      }],
    },
  };
}

test('T12: an analysis:true node may omit requiredEffects (the sole legitimate omission path)', () => {
  const normalized = normalizePlanRequest(tgPlanRequest({ analysis: true }), tgPolicy);
  assert.ok(normalized, 'the analysis node validates');
});

test('T13: omitting repository_edit WITHOUT analysis:true is a plan-validation error', () => {
  assert.throws(
    () => normalizePlanRequest(tgPlanRequest({ requiredEffects: [] }), tgPolicy),
    (error) => error?.name === 'GoalPlanValidationError',
  );
});

// ===========================================================================
// TG6 — coaching retirement (source pin; stage: coaching still shipped)
// ===========================================================================

test('T15: no shipped constraint line coaches writing for the gate', () => {
  const recipes = readFileSync(join(import.meta.dirname, '..', 'src', 'recipes.mjs'), 'utf8');
  const forbidden = [/skeleton/i, /trust gate/i, /beat the gate/i, /survive the gate/i, /write.*first.*diff/i];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(recipes), false, `recipes carries no ${pattern} coaching`);
  }
});

// ===========================================================================
// Regression pins — finals are byte-identical (green before and after)
// ===========================================================================

test('T16: path_scope violation fires identically at a final (regression pin)', async () => {
  const adapter = new ScriptableAdapter({ pausable: false });
  const { coordinator } = setup({
    adapter,
    capture: async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['etc/evil.txt'] }),
  });
  const handle = await coordinator.spawn('mock', makeBrief({ pathScope: ['src/**'] }));
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed', 'an out-of-scope diff still fails at finals');
});

test('T17: an answered cycle on a drivered claim re-runs the FULL gate (drivered final pin)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  coordinator._coordination.recordDriver('steering.registered', { runId: task.runId },
    { actor: 'orchestrator', key: `driver.recorded:steering.registered:${task.runId}` });
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused');
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId, 'the pause record pends');
  await coordinator.claimTurn(pauseId, { actor: 'orchestrator' }).catch(() => {});
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed',
    'a claim on an edit-free pause runs the full final gate — required_effect fires exactly as today');
});
