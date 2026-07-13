import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase62-${name}-`));
const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase62',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const auth = (principalId, powers, idempotencyKey, extra = {}) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
  repoId: 'repo-phase62', runId: null, idempotencyKey, ...extra,
});
const budget = (tokens = 20_000) => ({ tokens, usd: 2, wallMin: 10, providerTurns: 8 });
const verification = Object.freeze({ command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [] });

class NativePlanAdapter {
  constructor() { this.cb = null; this.spawnCalls = 0; this.promptCalls = 0; }
  onEvent(cb) { this.cb = cb; }
  card() {
    return {
      harness: 'mock', version: 'phase62-native', authPosture: 'none', concurrencyCeiling: 2, maxContext: 100_000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
      modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
    };
  }
  async spawn(worker, brief) {
    this.spawnCalls += 1;
    queueMicrotask(() => {
      this.cb?.({ worker, harness: 'mock@phase62-native', turnEpoch: 1, actor: 'worker', kind: 'lifecycle.spawned', payload: { sessionId: `session-${worker}`, pid: 4242 } });
      this.cb?.({
        worker, harness: 'mock@phase62-native', turnEpoch: 1, actor: 'worker', kind: 'lifecycle.turn_completed',
        payload: { status: 'completed', summary: 'done', artifacts: { files: [] }, verification: { command: brief.verification.command, claimedExit: 0 }, openQuestions: [] },
      });
    });
    return { ok: true };
  }
  async prompt() { this.promptCalls += 1; return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill(worker) {
    this.cb?.({ worker, harness: 'mock@phase62-native', turnEpoch: 1, actor: 'worker', kind: 'kill.confirmed', payload: {} });
    return { ok: true };
  }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
}

async function until(fn, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

function make(name, overrides = {}) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase62@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 62'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 100, summary: 'done', files: {} } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...baseCard(), modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  return createDriver({
    repoRoot: repo, repoId: 'repo-phase62', logDir: root(`${name}-log`), adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
    ...overrides,
  });
}

async function approved(driver, suffix = 'one') {
  const goalResult = await driver.coordinator.defineGoal({
    objective: 'Ship one plan-gated change', definitionOfDone: ['node --test passes'],
    constraints: ['No network access'], risk: 'high', budget: budget(), predecessor: null,
  }, auth('goal-owner', ['goal:define'], `goal:${suffix}`));
  const goal = goalResult.goal;
  const planResult = await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Implement the approved slice', definitionOfDone: ['node --test passes'],
      deps: [], pathScope: ['impl/**'], risk: 'high', budget: budget(10_000), verification,
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, auth('planner', ['plan:propose'], `plan:${suffix}`));
  const plan = planResult.plan;
  const approvalResult = await driver.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', ['plan:approve'], `approval:${suffix}`));
  return { goal, plan, approval: approvalResult.approval };
}

test('GP1-GP4/GP6/GP8: goals and plans are append-only, bounded, distinct-authority, and restart-visible', async () => {
  const driver = make('core');
  const { goal, plan, approval } = await approved(driver);
  assert.match(goal.goalId, /^goal:[a-f0-9]{64}$/); assert.equal(goal.version, 1);
  assert.match(plan.planId, /^plan:[a-f0-9]{64}$/); assert.equal(plan.version, 1);
  assert.equal(approval.disposition, 'approved'); assert.notEqual(approval.principalId, plan.proposerPrincipalId);
  const status = await driver.coordinator.goalPlanStatus({ goalId: goal.goalId, planId: plan.planId, throughSeq: null }, auth('observer', ['goal:observe'], 'status:one'));
  assert.equal(status.goal.digest, goal.digest); assert.equal(status.plan.digest, plan.digest);
  assert.equal(status.approval.disposition, 'approved'); assert.equal(status.nodes[0].state, 'ready');
  await assert.rejects(
    driver.coordinator.goalPlanStatus({ goalId: goal.goalId, planId: plan.planId, throughSeq: null }, auth('observer', ['goal:observe'], 'status:cross-run', { runId: 'other-run' })),
    (error) => error.code === 'not_found',
  );
  await assert.rejects(
    driver.coordinator.goalPlanStatus({ goalId: goal.goalId, planId: plan.planId, throughSeq: null }, auth('observer', ['goal:observe'], 'status:cross-repo', { repoId: 'other-repo' })),
    (error) => error.code === 'goal_plan_unauthorized',
  );
  await assert.rejects(driver.coordinator.approvePlan({ goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, plan: { planId: plan.planId, version: plan.version, digest: plan.digest }, expectedDisposition: null, disposition: 'approved' }, auth('planner', ['plan:approve'], 'approval:self')), (error) => error.code === 'plan_self_approval');
  driver.close();
});

test('GP2/GP3/GP8: weakening, cycles, and double-counted budget refuse without durable prefixes', async () => {
  const driver = make('invalid');
  const { goal } = await approved(driver, 'baseline');
  const before = driver.coordination.events().length;
  await assert.rejects(driver.coordinator.defineGoal({ objective: 'Weakened', definitionOfDone: [], constraints: [], risk: 'low', budget: budget(30_000), predecessor: { goalId: goal.goalId, version: goal.version, digest: goal.digest } }, auth('goal-owner', ['goal:define'], 'goal:weaken')), (error) => error.code === 'goal_weakened');
  await assert.rejects(driver.coordinator.proposePlan({ goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null, nodes: [{ key: 'a', objective: 'A', definitionOfDone: ['node --test passes'], deps: ['b'], pathScope: ['**'], risk: 'low', budget: budget(15_000), verification: { ...verification, requiredPredecessorEvidence: ['b'] }, routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code'], effects: ['repository_edit'] }, { key: 'b', objective: 'B', definitionOfDone: [], deps: ['a'], pathScope: ['**'], risk: 'low', budget: budget(15_000), verification: { ...verification, requiredPredecessorEvidence: ['a'] }, routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code'], effects: ['repository_edit'] }] }, auth('planner-2', ['plan:propose'], 'plan:cycle')), (error) => ['plan_cycle', 'plan_budget_exceeded'].includes(error.code));
  assert.equal(driver.coordination.events().length, before);
  driver.close();
});

test('GP5/GP8: mandatory plan-gated spawn binds Brief/route/budget and has one concurrent CAS winner before effects', async () => {
  const driver = make('dispatch'); const { goal, plan } = await approved(driver, 'dispatch');
  const brief = { goal: 'Implement the approved slice', constraints: ['No network access'], pathScope: ['impl/**'], definitionOfDone: 'node --test passes', verification, budget: { tokens: 10_000, usd: 2, wallMin: 10 } };
  const effectsBefore = driver.coordination.events().length;
  await assert.rejects(driver.coordinator.spawn('mock', brief, { taskId: 'ungated' }), (error) => error.code === 'goal_plan_required');
  assert.equal(driver.coordination.events().length, effectsBefore);
  const gate = { goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest, planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'] };
  const attempts = await Promise.allSettled(['planned-a', 'planned-b'].map((taskId) => driver.coordinator.spawn('mock', brief, { taskId, model: 'model-a', effort: 'low', goalPlan: gate, actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session', powers: ['plan:dispatch'], idempotencyKey: `spawn:${taskId}` })));
  assert.equal(attempts.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((row) => row.status === 'rejected' && row.reason?.code === 'plan_dispatch_stale').length, 1);
  const status = await driver.coordinator.goalPlanStatus({ goalId: goal.goalId, planId: plan.planId, throughSeq: null }, auth('observer', ['goal:observe'], 'status:dispatch'));
  assert.equal(status.nodes[0].state, 'dispatched'); assert.match(status.nodes[0].taskId, /^planned-/);
  const durable = driver.coordination.task(status.nodes[0].taskId);
  assert.equal(durable.brief.goalPlan.planDigest, plan.digest); assert.equal(durable.brief.goalPlan.nodeKey, 'implement');
  await driver.coordinator.kill(attempts.find((row) => row.status === 'fulfilled').value.id, 'orchestrator');
  driver.close();
});

test('GP5/GP6/GP8: an admitted plan-gated spawn reconciles an exact lost-response retry without duplicate effects', async () => {
  const driver = make('dispatch-reconcile'); const { goal, plan } = await approved(driver, 'dispatch-reconcile');
  const brief = { goal: 'Implement the approved slice', constraints: ['No network access'], pathScope: ['impl/**'], definitionOfDone: 'node --test passes', verification, budget: { tokens: 10_000, usd: 2, wallMin: 10 } };
  const gate = { goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest, planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'] };
  const opts = { taskId: 'planned-reconcile', model: 'model-a', effort: 'low', goalPlan: gate, actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session', powers: ['plan:dispatch'], idempotencyKey: 'spawn:planned-reconcile' };

  const admitted = await driver.coordinator.spawn('mock', brief, opts);
  const tasksBefore = driver.coordination.events().filter((event) => event.kind === 'task.created').length;
  const workersBefore = driver.coordinator.list().length;
  const replayed = await driver.coordinator.spawn('mock', brief, opts);
  assert.equal(replayed.id, admitted.id);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'task.created').length, tasksBefore);
  assert.equal(driver.coordinator.list().length, workersBefore);

  await assert.rejects(
    () => driver.coordinator.spawn('mock', { ...brief, goal: 'Substituted objective' }, opts),
    (error) => error.code === 'plan_dispatch_conflict',
  );
  await assert.rejects(
    () => driver.coordinator.spawn('mock', brief, { ...opts, idempotencyKey: 'spawn:changed-key' }),
    (error) => error.code === 'plan_dispatch_conflict',
  );
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'task.created').length, tasksBefore);
  assert.equal(driver.coordinator.list().length, workersBefore);
  await driver.coordinator.kill(admitted.id, 'orchestrator');
  await driver.coordinator.drain({ actor: 'test', repoId: 'repo-phase62', idempotencyKey: 'drain:planned-reconcile' });
  driver.close();
});

test('GP5/GP8: plan-bound follow-up and recovery refuse before provider, adapter, runtime, task, or log effects', async () => {
  const adapter = new NativePlanAdapter();
  const driver = make('continuation-refusal', {
    adapters: { mock: adapter },
    referee: async () => ({ reverified: true, passed: true, observedExit: 0, matchesClaim: true }),
  });
  const { goal, plan } = await approved(driver, 'continuation-refusal');
  const brief = { goal: 'Implement the approved slice', constraints: ['No network access'], pathScope: ['impl/**'], definitionOfDone: 'node --test passes', verification, budget: { tokens: 10_000, usd: 2, wallMin: 10 } };
  const gate = { goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest, planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'] };
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'planned-continuation', model: 'model-a', effort: 'low', goalPlan: gate, actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session', powers: ['plan:dispatch'], idempotencyKey: 'spawn:planned-continuation' });
  await until(async () => (await driver.coordinator.result(handle.id)).ready === true);

  const beforeFollowUp = { coordination: driver.coordination.events().length, operational: driver.log.read(handle.id).length, spawnCalls: adapter.spawnCalls, promptCalls: adapter.promptCalls };
  assert.deepEqual(await driver.coordinator.send(handle.id, 'continue', 'turn'), { ok: false, result: 'goal_plan_continuation_not_authorized' });
  assert.deepEqual(
    { coordination: driver.coordination.events().length, operational: driver.log.read(handle.id).length, spawnCalls: adapter.spawnCalls, promptCalls: adapter.promptCalls },
    beforeFollowUp,
  );

  const internal = driver.coordinator._workers.get(handle.id);
  internal.status = 'orphaned';
  const beforeRecovery = { coordination: driver.coordination.events().length, operational: driver.log.read(handle.id).length, spawnCalls: adapter.spawnCalls, promptCalls: adapter.promptCalls };
  assert.deepEqual(await driver.coordinator.recover(handle.id), { ok: false, result: 'goal_plan_continuation_not_authorized' });
  assert.deepEqual(
    { coordination: driver.coordination.events().length, operational: driver.log.read(handle.id).length, spawnCalls: adapter.spawnCalls, promptCalls: adapter.promptCalls },
    beforeRecovery,
  );
  assert.throws(() => driver.coordination.createAndClaimRecoveryRefinement({ refines: 'planned-continuation' }, {}, { actor: 'orchestrator', key: 'recovery:plan-bound' }), (error) => error.code === 'goal_plan_continuation_not_authorized');
  assert.equal(driver.coordination.events().length, beforeRecovery.coordination);
  internal.status = 'idle';
  await driver.coordinator.kill(handle.id, 'test');
  await driver.drainAndClose('test');
});
