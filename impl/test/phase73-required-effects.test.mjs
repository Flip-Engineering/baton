import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import {
  GoalPlanValidationError, goalPlanDigest, normalizeGoalPlanPolicy, normalizeGoalRequest,
  normalizePlanRequest,
} from '../src/goal-plan.mjs';
import { projectTypedTerminalCause } from '../src/application-semantics.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase73-${name}-`));
const policy = normalizeGoalPlanPolicy({
  schemaVersion: 1,
  repoId: 'repo-phase73',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'high'],
  effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: {
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 4_096, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 1_000,
  },
});
const budget = { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 4 };
const verification = {
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
};
const auth = (principalId, powers, idempotencyKey) => ({
  actor: `phase73:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
  repoId: 'repo-phase73', runId: null, idempotencyKey,
});

function normalizedGoal() {
  const normalized = normalizeGoalRequest({
    objective: 'Prove required-effect honesty', definitionOfDone: ['verification passes'],
    constraints: [], risk: 'high', budget, predecessor: null,
  }, policy);
  return { ...normalized, goalId: `goal:${'a'.repeat(64)}`, version: 1, digest: 'b'.repeat(64) };
}

function planRequest(requiredEffects) {
  const goal = normalizedGoal();
  return {
    goal,
    request: {
      goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
      nodes: [{
        key: 'work', objective: 'Perform the exact approved work', definitionOfDone: ['verification passes'],
        deps: [], pathScope: ['impl/**'], risk: 'high', budget, verification,
        routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
        capabilities: ['code', 'test'], effects: ['repository_edit'],
        ...(requiredEffects === undefined ? {} : { requiredEffects }),
      }],
    },
  };
}

function adapter(files) {
  const instance = new MockAdapter({
    harness: 'mock', scenario: {
      outcome: 'completed', summary: 'done',
      edits: Object.entries(files).map(([path, content]) => ({ path, content })),
    },
  });
  const card = instance.card.bind(instance);
  instance.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null,
      provenance: 'test', refreshedAt: null,
    },
  });
  return instance;
}

function driver(name, files, options = {}) {
  const repo = root(`${name}-repo`);
  const logDir = root(`${name}-log`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase73@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 73'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const instance = createDriver({
    repoRoot: repo, repoId: 'repo-phase73', logDir,
    adapters: { mock: adapter(files) }, goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 100,
    ...options,
  });
  Object.defineProperty(instance, 'phase73Fixture', { value: Object.freeze({ repo, logDir }) });
  return instance;
}

async function until(fn, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

async function approved(instance, suffix, requiredEffects, effects = ['repository_edit']) {
  const defined = await instance.coordinator.defineGoal({
    objective: 'Prove required-effect honesty', definitionOfDone: ['verification passes'],
    constraints: [], risk: 'high', budget, predecessor: null,
  }, auth('owner', ['goal:define'], `goal:${suffix}`));
  const goal = defined.goal;
  const proposed = await instance.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'work', objective: 'Perform the exact approved work', definitionOfDone: ['verification passes'],
      deps: [], pathScope: ['impl/**'], risk: 'high', budget, verification,
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects,
      ...(requiredEffects === undefined ? {} : { requiredEffects }),
    }],
  }, auth('planner', ['plan:propose'], `plan:${suffix}`));
  const plan = proposed.plan;
  await instance.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', ['plan:approve'], `approve:${suffix}`));
  return { goal, plan, node: plan.nodes[0] };
}

async function spawnApproved(instance, suffix, authority) {
  const { goal, plan, node } = authority;
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: node.key, expectedDispatchVersion: 0,
    capabilities: [...node.capabilities], effects: [...node.effects],
    ...(Object.hasOwn(node, 'requiredEffects') ? { requiredEffects: [...node.requiredEffects] } : {}),
  };
  const preview = instance.coordination.previewPlanDispatch(gate, { vendor: 'mock', model: 'model-a', effort: 'low' });
  const { goalPlan: ignored, ...brief } = preview.brief;
  void ignored;
  return instance.coordinator.spawn('mock', brief, {
    taskId: `phase73-${suffix}`, model: 'model-a', effort: 'low', goalPlan: gate,
    actor: 'phase73:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: `spawn:${suffix}`,
  });
}

test('PH3: requiredEffects is a digest-bound subset and supports only repository_edit', () => {
  const legacy = planRequest(undefined); const required = planRequest(['repository_edit']);
  const legacyPlan = normalizePlanRequest(legacy.request, policy, legacy.goal);
  const requiredPlan = normalizePlanRequest(required.request, policy, required.goal);
  assert.equal(Object.hasOwn(legacyPlan.nodes[0], 'requiredEffects'), false);
  assert.deepEqual(requiredPlan.nodes[0].requiredEffects, ['repository_edit']);
  assert.notEqual(goalPlanDigest(legacyPlan), goalPlanDigest(requiredPlan));

  for (const requiredEffects of [['provider_call'], ['repository_edit', 'provider_call']]) {
    const attempt = planRequest(requiredEffects);
    assert.throws(
      () => normalizePlanRequest(attempt.request, policy, attempt.goal),
      (error) => error instanceof GoalPlanValidationError && error.code === 'plan_required_effect_invalid',
    );
  }
});

test('PH4: the ordinary application projection preserves the bounded policy failure cause', () => {
  assert.deepEqual(projectTypedTerminalCause({
    terminalResult: { terminalCause: { kind: 'policy_failure', code: 'required_effect_absent', private: 'omitted' } },
  }), { kind: 'policy_failure', code: 'required_effect_absent' });
});

test('PH3/PH4: restart replays required-effect authority and the same typed failure without worker claims', async (t) => {
  const first = driver('required-replay', {});
  const authority = await approved(first, 'required-replay', ['repository_edit']);
  const handle = await spawnApproved(first, 'required-replay', authority);
  await until(async () => (await first.coordinator.result(handle.id)).ready);
  await first.drainAndClose('phase73-required-replay-first');

  const replay = createDriver({
    repoRoot: first.phase73Fixture.repo, repoId: 'repo-phase73', logDir: first.phase73Fixture.logDir,
    adapters: { mock: adapter({}) }, goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 100,
  });
  t.after(async () => { await replay.drainAndClose('phase73-required-replay-second').catch(() => {}); });
  await replay.ready;
  const result = await replay.coordinator.result(handle.id);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.terminalCause, { kind: 'policy_failure', code: 'required_effect_absent' });
  assert.equal(result.artifacts, undefined); assert.equal(result.capturedSha, null); assert.equal(result.retainedResultRef, null);
  const snapshot = replay.coordination.snapshot();
  assert.deepEqual(snapshot.goalPlan.plans[0].nodes[0].requiredEffects, ['repository_edit']);
  assert.deepEqual(snapshot.goalPlan.dispatches[0].requiredEffects, ['repository_edit']);
  assert.deepEqual(snapshot.tasks.find((task) => task.id === 'phase73-required-replay').brief.requiredEffects, ['repository_edit']);
});

test('PH3/PH5: required repository_edit rejects an unchanged base before referee or retention', async (t) => {
  const instance = driver('unchanged-required', {});
  t.after(async () => { await instance.drainAndClose('phase73-unchanged-required').catch(() => {}); });
  const authority = await approved(instance, 'unchanged-required', ['repository_edit']);
  const changedGate = {
    goalId: authority.goal.goalId, goalVersion: authority.goal.version, goalDigest: authority.goal.digest,
    planId: authority.plan.planId, planVersion: authority.plan.version, planDigest: authority.plan.digest,
    nodeKey: authority.node.key, expectedDispatchVersion: 0,
    capabilities: [...authority.node.capabilities], effects: [...authority.node.effects], requiredEffects: [],
  };
  assert.throws(
    () => instance.coordination.previewPlanDispatch(changedGate, { vendor: 'mock', model: 'model-a', effort: 'low' }),
    (error) => error.code === 'plan_effect_mismatch',
  );
  const handle = await spawnApproved(instance, 'unchanged-required', authority);
  const result = await until(async () => {
    const current = await instance.coordinator.result(handle.id);
    return current.ready ? current : null;
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.terminalCause, { kind: 'policy_failure', code: 'required_effect_absent' });
  assert.equal(result.capturedSha, null); assert.equal(result.retainedResultRef, null);
  assert.equal(result.artifacts, undefined); assert.equal(result.verdict, null);
  assert.equal(instance.log.read(handle.id).some((event) => event.kind === 'verify.reverified'), false);
  const requiredFailure = instance.log.read(handle.id).find((event) => event.kind === 'error' && event.payload?.code === 'required_effect_absent');
  assert.deepEqual(
    { changed: requiredFailure.payload.requiredEffectEvidence.changedPathCount, inScope: requiredFailure.payload.requiredEffectEvidence.inScopeChangedPathCount },
    { changed: 0, inScope: 0 },
  );
  assert.match(requiredFailure.payload.requiredEffectEvidence.changedPathsDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(instance.coordination.snapshot().goalPlan.dispatches[0].requiredEffects, ['repository_edit']);
  assert.equal(instance.coordination.snapshot().artifacts.filter((artifact) => artifact.taskId === 'phase73-unchanged-required').length, 0);
});

test('PH3/PH5: read-only-permitted unchanged work remains valid, while a required in-scope diff passes', async (t) => {
  const unchanged = driver('unchanged-permitted', {});
  t.after(async () => { await unchanged.drainAndClose('phase73-unchanged-permitted').catch(() => {}); });
  const unchangedAuthority = await approved(unchanged, 'unchanged-permitted', undefined, []);
  const unchangedHandle = await spawnApproved(unchanged, 'unchanged-permitted', unchangedAuthority);
  const unchangedResult = await until(async () => {
    const current = await unchanged.coordinator.result(unchangedHandle.id);
    return current.ready ? current : null;
  });
  assert.equal(unchangedResult.status, 'completed');
  assert.match(unchangedResult.capturedSha, /^[a-f0-9]{40}$/u);

  const changed = driver('changed-required', { 'impl/change.txt': 'changed\n' });
  t.after(async () => { await changed.drainAndClose('phase73-changed-required').catch(() => {}); });
  const changedAuthority = await approved(changed, 'changed-required', ['repository_edit']);
  const changedHandle = await spawnApproved(changed, 'changed-required', changedAuthority);
  const changedResult = await until(async () => {
    const current = await changed.coordinator.result(changedHandle.id);
    return current.ready ? current : null;
  });
  assert.equal(changedResult.status, 'completed', JSON.stringify({ changedResult, events: changed.log.read(changedHandle.id) }));
  assert.match(changedResult.capturedSha, /^[a-f0-9]{40}$/u);
  assert.notEqual(changedResult.capturedSha, changedResult.sessionContext.baseSha);
  const verified = changed.log.read(changedHandle.id).find((event) => event.kind === 'verify.reverified');
  assert.deepEqual(verified.payload.requiredEffects, ['repository_edit']);
  assert.equal(verified.payload.requiredEffectEvidence.repositoryEdit.inScopeChangedPathCount, 1);
});

test('captured mixed-scope changes fail before verifier or result retention', async (t) => {
  const instance = driver('mixed-scope-capture', {
    'impl/allowed.txt': 'allowed\n',
    'outside-plan.txt': 'forbidden\n',
  }, { watchdog: { scopeAction: 'none' } });
  t.after(async () => { await instance.drainAndClose('phase73-mixed-scope').catch(() => {}); });
  const authority = await approved(instance, 'mixed-scope', ['repository_edit']);
  const handle = await spawnApproved(instance, 'mixed-scope', authority);
  const result = await until(async () => {
    const current = await instance.coordinator.result(handle.id);
    return current.ready ? current : null;
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.terminalCause, {
    kind: 'policy_failure', code: 'worker_path_scope_violation',
  });
  assert.equal(result.capturedSha, null);
  assert.equal(result.retainedResultRef, null);
  assert.equal(result.verdict, null);
  assert.equal(instance.log.read(handle.id).some((event) => event.kind === 'verify.reverified'), false);
  const failure = instance.log.read(handle.id).find((event) => (
    event.kind === 'error' && event.payload?.code === 'worker_path_scope_violation'
  ));
  assert.deepEqual({
    changed: failure.payload.pathScopeEvidence.changedPathCount,
    inScope: failure.payload.pathScopeEvidence.inScopeChangedPathCount,
    outside: failure.payload.pathScopeEvidence.outOfScopeChangedPathCount,
  }, { changed: 2, inScope: 1, outside: 1 });
  assert.match(failure.payload.pathScopeEvidence.outOfScopeChangedPathsDigest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(failure.payload.pathScopeEvidence).includes('outside-plan.txt'), false);
  assert.equal(instance.coordination.snapshot().artifacts
    .filter((artifact) => artifact.taskId === 'phase73-mixed-scope').length, 0);
});
