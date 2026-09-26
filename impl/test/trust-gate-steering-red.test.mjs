// September 12: automatic checkpoint cycles are retired. These tests retain claim, effect,
// question, and continuation boundaries under explicit orchestration; docs/39 governs.
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
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
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

test('T1: a pausable checkpoint turn with no diff gets NO gate dispatch — no verdict, no kill, no policy nudge', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, worktrees } = setup({ adapter, capture: noDiff });
  let verifyWorktrees = 0;
  const baseCreateVerify = worktrees.createVerifyWorktree;
  worktrees.createVerifyWorktree = async (...args) => { verifyWorktrees += 1; return baseCreateVerify(...args); };
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed', 'no required_effect verdict at a checkpoint');
  assert.notEqual(task.status, 'completed', 'no acceptance at a checkpoint either — deferral is non-dispatch');
  assert.equal(adapter.calls.kill.length, 0, 'the healthy multi-turn worker is never killed');
  assert.equal(verifyWorktrees, 0, 'non-dispatch means the gate never even builds its verify sandbox');
  const gateEvents = ['forbidden_effect_observed', 'required_effect_absent'];
  assert.equal(coordinator._log.read(handle.id).filter((event) => gateEvents.includes(event.payload?.code)).length, 0,
    'zero gate verdict events');
  const nudges = adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:'));
  assert.equal(nudges.length, 0, 'a native checkpoint awaits explicit orchestration');
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
// TG3 — explicit pause ownership (September 12 correction)
// ===========================================================================

test('T5: an unsolicited native turn boundary does not consume a checkpoint', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
  });
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed');
  assert.notEqual(task.status, 'completed', 'the checkpoint itself is never accepted');
  assert.equal(task.status, 'paused', 'a native boundary does not adjudicate work');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1, 'the checkpoint still awaits a steering act');
  assert.equal(adapter.calls.kill.length, 0);
});

test('T6: useful scratchpad work preserves the independent checkpoint', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  emitScratchWrite(adapter, handle, 't6-note', 'the lease binds a working orchestrator parent');
  await flush(40);
  await sleep(60); // past the retired policy window
  await flush(20);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'paused', 'a scratchpad receipt is not a completion decision');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1,
    'the checkpoint remains available to its orchestrator');
  assert.equal(adapter.calls.kill.length, 0);
});

test('T7: repeated scratchpad receipts do not manufacture completion authority', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  for (let index = 0; index < 6; index += 1) emitScratchWrite(adapter, handle, `t7-dup-${index}`, 'x');
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'paused', 'receipt content and repetition do not decide work');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1, 'the original checkpoint remains pending');
});

test('T7b: elapsed time never turns an unanswered checkpoint into a verdict', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  await sleep(60);
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused');
  assert.equal(coordinator.pausedTurns({ taskId: handle.taskId }).length, 1);
  assert.equal(adapter.calls.kill.length, 0);
  assert.equal(adapter.calls.prompt.length, 0);
  assert.equal(coordinator._log.read(handle.id).some((event) => event.kind === 'verify.reverified'), false);
});

test('T8: answering a question does not consume an independent checkpoint', async () => {
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
  assert.equal((await coordinator.respond(requestId, { text: 'yes, approach A' })).ok, true);
  await flush(40);
  await sleep(60);
  await flush(20);
  assert.notEqual(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the resolved interaction does not adjudicate the checkpoint');
  assert.equal(coordinator.pausedTurns({ taskId: coordinator._tasks.get(handle.taskId).id }).length, 1);
});

test('T8b: a pending question and checkpoint survive the retired window', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 't8b:question:1', question: 'stalling question', blocking: false },
  });
  await flush(40);
  assert.notEqual(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the worker remains alive while awaiting a decision');
  await sleep(60); // the retired policy window cannot decide either question or work
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'paused', 'an unanswered question does not authorize a work verdict');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.equal(verdictEvent, undefined, 'there is no automatic gate verdict');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1);
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

test('T10: explicit continuation can create another checkpoint without automatic prompts', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const nudgeCount = () => adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:')).length;
  emitTurnCompleted(adapter, handle, 1);
  await flush(40);
  assert.equal(nudgeCount(), 0, 'the first checkpoint admits no automatic prompt');
  const pauseId = coordinator.pausedTurns({ taskId: handle.taskId })[0].pauseId;
  assert.equal((await coordinator.nudgeTurn(pauseId, 'Continue the investigation')).ok, true);
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  await flush(40);
  emitTurnCompleted(adapter, handle, 2, 'second checkpoint');
  await flush(40);
  assert.equal(nudgeCount(), 0, 'the new checkpoint admits no automatic prompt');
  assert.equal(coordinator.pausedTurns({ taskId: handle.taskId }).length, 1);
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'content.message', actor: 'worker', payload: { text: 'micro-progress chatter' } });
  await flush(20);
  assert.equal(nudgeCount(), 0, 'ordinary chatter cannot trigger policy prompts');
});

test('T10b: an explicit claim runs the full gate and carries no invented expiry authority', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  assert.equal(adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:')).length, 0,
    'no automatic prompt precedes an explicit claim');
  const task = coordinator._tasks.get(handle.taskId);
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId, 'the pause record pends');
  await coordinator.claimTurn(pauseId, { actor: 'orchestrator' }).catch(() => {});
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the claim runs the full final gate on the edit-free pause');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.equal(verdictEvent?.payload?.steered ?? null, null,
    'a claim-resolved verdict carries NO steering-expiry receipt (the claim is its own authority)');
});

// ===========================================================================
// TG4 — the revision-channel verdict (stage: channel missing)
// ===========================================================================

test('T11: a gate failure names its gate in the projected terminal cause and carries the sanitized {gate, detail} verdict', async () => {
  const adapter = new ScriptableAdapter({ pausable: false });
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed');
  // (a) the projected terminal cause names the gate — never 'unknown'.
  const cause = task.terminalCause ?? task.failure ?? null;
  assert.match(JSON.stringify(cause), /required_effect_absent/, 'the projected cause names the gate');
  // (b) the refusal is projected as sanitized {gate, detail} — the DG-1 shape the worker's
  // next-brief channel consumes (v1.0.1: the byte-identical refinement brief is a non-channel).
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent, 'the {gate, detail} verdict event exists');
  const detail = JSON.stringify(verdictEvent.payload?.detail ?? verdictEvent.payload ?? {});
  assert.doesNotMatch(detail, /\/tmp\/wt\//, 'the verdict carries no path strings');
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
  const shaped = tgPlanRequest({ analysis: true });
  const normalized = normalizePlanRequest(shaped.request, tgPolicy, shaped.goal);
  assert.ok(normalized, 'the analysis node validates');
});

test('T13: omitting repository_edit WITHOUT analysis:true is a plan-validation error', () => {
  const shaped = tgPlanRequest({ requiredEffects: [] });
  assert.throws(
    () => normalizePlanRequest(shaped.request, tgPolicy, shaped.goal),
    (error) => error?.name === 'GoalPlanValidationError' && /analysis/i.test(error?.message ?? ''),
    'the refusal names the missing analysis field, not a generic envelope error',
  );
});

test('T14: an analysis node\'s final evaluation SKIPS required_effect and runs every other phase', async () => {
  const adapter = new ScriptableAdapter({ pausable: false });
  const { coordinator } = setup({ adapter, capture: noDiff });
  // The analysis field documents repository_edit as not-required for this node — an edit-free
  // final does NOT fail required_effect (every other phase still runs).
  const handle = await coordinator.spawn('mock', makeBrief({ analysis: true, requiredEffects: [] }));
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed', 'analysis documents the edit as not-required');
  assert.ok(['verifying', 'completed'].includes(task.status), `the final evaluates normally otherwise (got ${task.status})`);
});

test('T14b: a NON-analysis node\'s edit-free final fails required_effect (the flag is the boundary)', async () => {
  const adapter = new ScriptableAdapter({ pausable: false });
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed');
});


// ===========================================================================
// TG6 — coaching retirement (pre-acceptance pin; green today, guards the reword at
// acceptance — no shipped constraint may EVER carry gate-beating coaching)
// ===========================================================================

test('T15: no shipped constraint or profile text coaches progress-by-diff-timing for the gate', () => {
  const recipes = readFileSync(join(import.meta.dirname, '..', 'src', 'recipes.mjs'), 'utf8');
  const forbidden = [/skeleton[- ]first/i, /trust.?gate/i, /beat(?:ing)? the gate/i, /survive the gate/i, /no.?diff/i, /progress gate/i];
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

test('T17: a registered orchestrator claim runs the full gate', async () => {
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
