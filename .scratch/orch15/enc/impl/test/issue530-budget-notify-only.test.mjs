// Issue #530 / #258: budget validation accepts budgets that exceed the policy ceiling.
// The ceiling is for runtime notifications, not fatal normalisation refusals.
// Type validation (positive integers, valid USD) still refuses invalid budgets.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoalPlanValidationError, normalizeGoalPlanPolicy, normalizeGoalRequest,
  normalizePlanRequest, goalPlanDigest,
} from '../src/goal-plan.mjs';

const policy = normalizeGoalPlanPolicy({
  schemaVersion: 1,
  repoId: 'repo-issue530',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'high'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['code'],
  limits: {
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 4_096, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 500, maxUsd: 1, maxWallMin: 10, maxProviderTurns: 5,
  },
});

const verification = {
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
};

test('Issue #530: goal budget above the policy ceiling is accepted', () => {
  // Every budget field exceeds the corresponding policy limit.
  const aboveCeiling = {
    tokens: 100_000,       // policy.limits.maxTokens = 500
    usd: 50,               // policy.limits.maxUsd = 1
    wallMin: 120,           // policy.limits.maxWallMin = 10
    providerTurns: 200,     // policy.limits.maxProviderTurns = 5
  };
  const goal = normalizeGoalRequest({
    objective: 'Accept a budget above every policy ceiling',
    definitionOfDone: ['passes'],
    constraints: [],
    risk: 'high',
    budget: aboveCeiling,
    predecessor: null,
  }, policy);
  assert.equal(goal.budget.tokens, 100_000);
  assert.equal(goal.budget.usd, 50);
  assert.equal(goal.budget.wallMin, 120);
  assert.equal(goal.budget.providerTurns, 200);
});

test('Issue #530: plan node budget above the policy ceiling is accepted', () => {
  const aboveCeiling = {
    tokens: 100_000,
    usd: 50,
    wallMin: 120,
    providerTurns: 200,
  };
  const goal = normalizeGoalRequest({
    objective: 'Accept a plan node budget above policy ceilings',
    definitionOfDone: ['passes'],
    constraints: [],
    risk: 'high',
    budget: aboveCeiling,
    predecessor: null,
  }, policy);
  const fakeGoal = {
    ...goal,
    goalId: `goal:${'a'.repeat(64)}`,
    version: 1,
    digest: goalPlanDigest(goal),
  };
  const plan = normalizePlanRequest({
    goal: { goalId: fakeGoal.goalId, version: fakeGoal.version, digest: fakeGoal.digest },
    predecessor: null,
    nodes: [{
      key: 'work',
      objective: 'Node with above-ceiling budget',
      definitionOfDone: ['passes'],
      deps: [],
      pathScope: ['impl/**'],
      risk: 'high',
      budget: aboveCeiling,
      verification,
      routes: { schemaVersion: 2, allowed: [{ harness: 'mock', model: 'model-a', effort: 'low' }] },
      capabilities: ['code'],
      effects: ['repository_edit'],
    }],
  }, policy, fakeGoal);
  assert.equal(plan.nodes[0].budget.tokens, 100_000);
  assert.equal(plan.nodes[0].budget.usd, 50);
  assert.equal(plan.nodes[0].budget.wallMin, 120);
  assert.equal(plan.nodes[0].budget.providerTurns, 200);
});

test('Issue #530: invalid budget types still refuse', () => {
  const cases = [
    { tokens: -1, usd: 1, wallMin: 10, providerTurns: 5, label: 'negative tokens' },
    { tokens: 0, usd: 1, wallMin: 10, providerTurns: 5, label: 'zero tokens' },
    { tokens: 1.5, usd: 1, wallMin: 10, providerTurns: 5, label: 'non-integer tokens' },
    { tokens: 100, usd: 'bad', wallMin: 10, providerTurns: 5, label: 'non-numeric usd' },
    { tokens: 100, usd: 1, wallMin: -5, providerTurns: 5, label: 'negative wallMin' },
    { tokens: 100, usd: 1, wallMin: 10, providerTurns: 0, label: 'zero providerTurns' },
    { tokens: 100, usd: 1, wallMin: 10, providerTurns: 1.7, label: 'non-integer providerTurns' },
  ];
  for (const { label, ...budget } of cases) {
    assert.throws(
      () => normalizeGoalRequest({
        objective: `Invalid budget: ${label}`,
        definitionOfDone: ['passes'],
        constraints: [],
        risk: 'high',
        budget,
        predecessor: null,
      }, policy),
      (error) => error instanceof GoalPlanValidationError && error.code === 'plan_budget_exceeded',
      `expected refusal for ${label}`,
    );
  }
});
