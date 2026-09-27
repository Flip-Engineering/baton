import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BatonApplication } from '../src/index.mjs';

const repoId = 'repo-issue407-plan-history';

// The deployment's own workflow policy: two rounds. The Plan history ceiling must be this
// maxRounds — never a second literal.
const workflowPolicy = Object.freeze({
  schemaVersion: 1, maxRounds: 2, maxRevisionAttemptsPerRound: 1,
  maxFeedbackPacketsPerRound: 64, maxFeedbackPacketsTotal: 256,
  budgetMode: 'authorized_plan_totals_within_goal', allocation: 'equal_round_share',
  stopConditions: [
    'identical_candidate', 'identical_feedback', 'no_verified_progress',
    'unresolved_contradiction', 'verification_failure',
  ],
});

test('I407b: a repeated plan identity refuses workflow_plan_cycle', () => {
  const runId = 'run:issue407-cycle';
  const goal = {
    goalId: 'goal:issue407-cycle', version: 1, digest: 'd'.repeat(64), runId,
  };
  const head = {
    schemaVersion: 1, planId: 'plan:issue407-cycle', version: 2, digest: 'a'.repeat(64),
    repoId, runId, goal,
    predecessor: { planId: 'plan:issue407-cycle', version: 1, digest: 'b'.repeat(64) },
    nodes: [{ key: 'revision:2:builder', revision: { round: 2 } }],
  };
  const ancestor = {
    schemaVersion: 1, planId: 'plan:issue407-cycle', version: 1, digest: 'b'.repeat(64),
    repoId, runId, goal,
    predecessor: { planId: 'plan:issue407-cycle', version: 2, digest: 'a'.repeat(64) },
    nodes: [{ key: 'revision:2:builder', revision: { round: 2 } }],
  };
  const fakeThis = {
    repoId,
    driver: {
      coordination: {
        snapshot: () => ({ goalPlan: { plans: [head, ancestor] } }),
        workflowPolicy: () => ({ ...workflowPolicy, maxRounds: 5 }),
      },
    },
    _isWorkflowRun: BatonApplication.prototype._isWorkflowRun,
    _runAtPlan: BatonApplication.prototype._runAtPlan,
    _workflowPlanHistoryPolicyBound:
      BatonApplication.prototype._workflowPlanHistoryPolicyBound,
    _workflowPlanHistory: BatonApplication.prototype._workflowPlanHistory,
  };
  // Two linked plans under a bound of five: depth is innocent, but the ancestry repeats the
  // head identity — a proven cycle, not a deep chain.
  assert.throws(() => (
    BatonApplication.prototype._workflowPlanHistory.call(fakeThis, { goal, plan: head })
  ), (error) => (
    error?.code === 'workflow_plan_cycle'
    && error?.detail?.planId === 'plan:issue407-cycle'
    && Array.isArray(error?.detail?.chain)
  ), 'a proven cycle must name the repeated planId');
});

test('I407d: the Plan history ceiling carries no second literal', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // slice 15: `_workflowPlanHistoryPolicyBound` moved to application-observation.mjs — the walk
  // is read there; the no-second-literal law spans both texts.
  const src = readFileSync(join(here, '../src/application.mjs'), 'utf8')
    + readFileSync(join(here, '../src/application-observation.mjs'), 'utf8');
  assert.equal(src.includes('MAX_WORKFLOW_PLAN_HISTORY'), false,
    'the fixed history literal must be gone');
  // The walk member is read whole (the module's own body), never a wider region: the ceiling
  // must derive from maxRounds and must not restate the deployment bound as a literal.
  const bodyMatch = src.match(/_workflowPlanHistoryPolicyBound\(application, current\) \{[\s\S]*?\n  \}/u);
  assert.ok(bodyMatch, 'the history walk must still exist');
  const walk = bodyMatch[0];
  assert.ok(walk.includes('maxRounds'), 'the walk ceiling must derive from maxRounds');
  assert.equal(/\b16\b/.test(walk), false,
    'the walk region must not restate the deployment bound as a literal');
});
