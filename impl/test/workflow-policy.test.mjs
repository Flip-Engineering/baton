import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WORKFLOW_POLICY, LEGACY_WORKFLOW_POLICY, normalizeWorkflowPolicy,
} from '../src/workflow-policy.mjs';

test('WP80-1: Workflow recursion policy is closed, deployment-owned, and content-addressed', () => {
  assert.equal(DEFAULT_WORKFLOW_POLICY.maxRounds, 8);
  assert.equal(DEFAULT_WORKFLOW_POLICY.maxRevisionAttemptsPerRound, 1);
  assert.equal(DEFAULT_WORKFLOW_POLICY.budgetMode, 'authorized_plan_totals_within_goal');
  assert.equal(DEFAULT_WORKFLOW_POLICY.allocation, 'equal_round_share');
  assert.equal(Object.isFrozen(DEFAULT_WORKFLOW_POLICY), true);
  assert.deepEqual(normalizeWorkflowPolicy(DEFAULT_WORKFLOW_POLICY), DEFAULT_WORKFLOW_POLICY);
  assert.equal(LEGACY_WORKFLOW_POLICY.maxRounds, 2);
  assert.notEqual(LEGACY_WORKFLOW_POLICY.policyDigest, DEFAULT_WORKFLOW_POLICY.policyDigest);
});

test('WP80-2: Workflow recursion policy refuses caller-shaped or unbounded authority', () => {
  assert.throws(() => normalizeWorkflowPolicy({
    ...DEFAULT_WORKFLOW_POLICY, maxRounds: 17,
  }), (error) => error?.code === 'workflow_policy_invalid');
  assert.throws(() => normalizeWorkflowPolicy({
    ...DEFAULT_WORKFLOW_POLICY, callerBudget: { tokens: 1 },
  }), (error) => error?.code === 'workflow_policy_invalid');
  assert.throws(() => normalizeWorkflowPolicy({
    ...DEFAULT_WORKFLOW_POLICY, policyDigest: '0'.repeat(64),
  }), (error) => error?.code === 'workflow_policy_invalid');
});
