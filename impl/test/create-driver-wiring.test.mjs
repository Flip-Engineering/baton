// create-driver-wiring.test.mjs — issue #259 slice 0 (docs/audits/2026-09-13-runtime-policy).
//
// Why this file exists: on 2026-09-13 the shared-custody checkpoint displaced one line of driver
// wiring — `route.record = (…) => router.record(…)` in createDriver — and the whole suite stayed
// green (fixed in 5bd37fbf). Nothing failed because every consumer guards the hand-off with
// `typeof this._route.record === 'function'`: an unwired authority is not an error, it is a silent
// no-op, and hub-verified terminals simply stopped recording route observations. The same shape
// repeats for the other late-bound authorities createDriver assembles: each is consulted only
// through a member that tolerates its absence.
//
// So each test here builds the REAL driver (createDriver over a real temp git repo with a
// MockAdapter), runs a real task to a verified terminal, and asserts the injected authority was
// actually consulted — never that the driver merely constructed. The wiring identity assertion
// (`driver.coordinator._route.record` is a function) fails the moment the assignment is deleted,
// and the run assertions fail if the authority is present but unreachable.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver, prepareVerificationRuntime } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-wiring-${name}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function repo() {
  const path = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: path });
  return path;
}

/** Poll a coordinator read until it reports ready; the run is real, so its end is a wall-clock event. */
async function until(fn, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let value = null;
  while (Date.now() < deadline) {
    value = await fn();
    if (predicate(value)) return value;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value)}`);
}

function verification(arguments_, overrides = {}) {
  return {
    command: 'node', arguments: arguments_, cwd: '.',
    envAllowlist: ['PATH', 'LANG', 'WIRING_PROBE'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [], ...overrides,
  };
}

function brief(overrides = {}) {
  return {
    goal: 'prove the driver wiring', constraints: [], pathScope: [],
    definitionOfDone: 'the injected authorities are consulted',
    verification: verification(['-e', "process.exit(process.env.WIRING_PROBE === 'seam-wired' ? 0 : 91)"]),
    budget: { tokens: 10_000, usd: 1, wallMin: 5 },
    ...overrides,
  };
}

// The deployment's closed verifier runtime, distinguished two ways: its digest is what the
// verdict must cite, and its constant is what the verification command can only see through it.
const RUNTIME_POLICY = Object.freeze({
  schemaVersion: 1, pathEntries: Object.freeze([dirname(process.execPath)]),
  constants: Object.freeze({ LANG: 'C', WIRING_PROBE: 'seam-wired' }),
});
const RUNTIME_DIGEST = prepareVerificationRuntime(RUNTIME_POLICY).digest;

const mock = () => new MockAdapter({
  scenario: { outcome: 'completed', edits: [{ path: 'wired.txt', content: 'wired\n' }] },
  card: { harness: 'mock', version: 'wiring-1', model: 'wiring-model' },
});

test('CDW1: one real verified run consults the injected route authority, custody provider, and verifier runtime', async (t) => {
  const repository = repo();
  const logDir = root('log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw1').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  // 1. Route authority. This is the exact guard every route-learning call site uses
  //    (coordinator.mjs `typeof this._route.record === 'function'`), so its absence is the
  //    5bd37fbf regression: a driver whose route authority cannot record.
  assert.equal(typeof driver.coordinator._route.record, 'function', 'createDriver must wire route.record onto the coordinator route authority');
  const recorded = [];
  const routerRecord = driver.router.record.bind(driver.router);
  driver.router.record = (...args) => { recorded.push(args); return routerRecord(...args); };

  // 2. The worktree custody provider. createDriver injects it into the worktree manager as the
  //    live-holder closure whose answer is `coordinator.liveWorkspaceHolders`; watching the
  //    delegate proves the injected provider was consulted rather than bypassed.
  const holderCalls = [];
  const liveHolders = driver.coordinator.liveWorkspaceHolders.bind(driver.coordinator);
  driver.coordinator.liveWorkspaceHolders = (...args) => { holderCalls.push(args); return liveHolders(...args); };

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'wiring-run', taskType: 'general' });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-run');
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));

  // 3. Verifier seam. The verdict cites the injected runtime's digest, and the run only reaches
  //    `completed` because the pinned command read the constant that runtime alone supplies: a
  //    driver that prepared a different runtime (or none) fails one of these two.
  assert.equal(outcome.verdict.runtimeDigest, RUNTIME_DIGEST, 'the verdict must cite the injected verification runtime');
  assert.equal(driver.coordinator.verificationRuntimeDigest(), RUNTIME_DIGEST, 'the coordinator must hold the injected verification runtime digest');
  assert.equal(outcome.verdict.passed, true);

  // 4. Route observation. Without the wiring the coordinator's guard silently skips this call and
  //    learning is lost with no error anywhere.
  assert.ok(recorded.length >= 1, 'a verified terminal must reach router.record through the injected route authority');
  assert.equal(recorded[0][2], true, 'the recorded outcome is the verified win');
  assert.ok(holderCalls.length >= 1, 'the injected custody provider must be consulted at least once by a real run');
  for (const [physicalOwnerId] of holderCalls) {
    assert.equal(typeof physicalOwnerId === 'string' || physicalOwnerId === null || physicalOwnerId === undefined, true);
  }
});

// The control that justifies this file: reproduce the 5bd37fbf shape — a route authority without
// `record` — and show it is SILENT. The same verified terminal still reports `completed`, the
// event log still closes the task, and nothing anywhere throws. A driver-level suite can be fully
// green with route learning dead, which is exactly what happened; only the wiring assertion in
// CDW1 (or an observation count, as here) can see it.
test('CDW3: an authority without record is a silent no-op, not a failure — the shape of 5bd37fbf', async (t) => {
  const repository = repo();
  const logDir = root('control-log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-control', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw3').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const recorded = [];
  const routerRecord = driver.router.record.bind(driver.router);
  driver.router.record = (...args) => { recorded.push(args); return routerRecord(...args); };
  delete driver.coordinator._route.record;
  assert.equal(driver.coordinator._route.record, undefined);

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'wiring-control-run', taskType: 'general' });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-control-run');
  assert.equal(outcome.status, 'completed', 'the run is unaffected by the missing authority');
  assert.equal(outcome.verdict.passed, true);
  assert.equal(recorded.length, 0, 'an unwired route authority loses the observation with no error: this is the regression CDW1 pins');
  assert.equal(driver.coordination.task('wiring-control-run').status, 'completed',
    'the task still reaches its durable terminal — silence, not failure');
});

test('CDW2: the injected goal-plan authority is consulted for goal, plan, approval, and plan-gated dispatch', async (t) => {
  const repository = repo();
  const logDir = root('plan-log');
  const consultations = [];
  const authorize = async (request) => { consultations.push(request); return true; };
  const policy = Object.freeze({
    schemaVersion: 1, repoId: 'repo-wiring-plan', mandatory: false, approvalTtlMs: 3_600_000,
    riskClasses: Object.freeze(['low', 'medium', 'high', 'critical']),
    effectClasses: Object.freeze(['repository_edit', 'provider_call']),
    capabilityClasses: Object.freeze(['code', 'test']),
    limits: Object.freeze({
      maxGoalVersions: 4, maxPlanVersions: 4, maxNodes: 8, maxDepsPerNode: 4,
      maxTextBytes: 4096, maxItems: 16, maxScopePaths: 16, maxRouteValues: 8,
      maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
      maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 60, maxProviderTurns: 100,
    }),
  });
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-plan', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
    goalPlanAuthority: { policy, authorize },
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw2').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const auth = (principalId, powers, idempotencyKey) => ({
    actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
    repoId: 'repo-wiring-plan', runId: null, idempotencyKey,
  });
  const budget = { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 };
  const nodeVerification = verification(['-e', "process.exit(process.env.WIRING_PROBE === 'seam-wired' ? 0 : 91)"], { timeoutMs: 30_000 });
  const intent = { vendor: 'mock', model: 'wiring-model', effort: 'low' };

  const goal = (await driver.coordinator.defineGoal({
    objective: 'Ship the plan-gated slice', definitionOfDone: ['the pinned check passes'],
    constraints: [], risk: 'low', budget, predecessor: null,
  }, auth('goal-owner', ['goal:define'], 'wiring-goal'))).goal;
  const plan = (await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Implement the plan-gated slice', definitionOfDone: ['the pinned check passes'],
      deps: [], pathScope: ['**'], risk: 'low', budget: { tokens: 10_000, usd: 2, wallMin: 10, providerTurns: 8 },
      verification: nodeVerification, routes: { harnesses: ['mock'], models: ['wiring-model'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, auth('planner', ['plan:propose'], 'wiring-plan'))).plan;
  await driver.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', ['plan:approve'], 'wiring-approval'));

  const routeBinding = { vendor: intent.vendor, model: intent.model, effort: intent.effort };
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const admitted = driver.coordination.previewPlanDispatch(gate, routeBinding);
  // The plan's Brief carries the goal/plan coordinates; the caller may not restate them, so the
  // dispatch input is that Brief minus the coordinates (the coordinator re-derives them itself).
  const { goalPlan: _coordinates, ...callerBrief } = admitted.brief;
  const handle = await driver.coordinator.spawn('mock', callerBrief, {
    taskId: 'wiring-plan-run', model: intent.model, effort: intent.effort,
    goalPlan: gate,
    actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: 'wiring-plan-dispatch',
  });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-plan-run');
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));

  const operations = consultations.map((request) => request.operation);
  for (const operation of ['goal_define', 'plan_propose', 'plan_approve', 'plan_dispatch']) {
    assert.ok(operations.includes(operation), `the injected goal-plan authority must be consulted for ${operation} (saw ${operations.join(', ')})`);
  }
  for (const request of consultations) {
    assert.equal(request.repoId, 'repo-wiring-plan');
    assert.match(request.requestDigest, /^[a-f0-9]{64}$/u);
  }
  const principals = new Set(consultations.map((request) => request.principalId));
  for (const principalId of ['goal-owner', 'planner', 'approver', 'dispatcher']) {
    assert.ok(principals.has(principalId), `the authority must see the real principal ${principalId}`);
  }
});
