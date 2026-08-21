// goalplan-narrow-210-red.test.mjs — red-first pin for the goalPlan-class snapshot reads.
//
// #210 (wave-g, row goalplan-narrow): application.mjs still serves goal/plan projections by
// deep-cloning the ENTIRE coordination store — snapshot().goalPlan deep-clones tasks, runs,
// lineage, receipts, evidence, knowledge… every section — to read the goal/plan rows the
// store can serve narrowly. The precedent: goalPlanRun(repoId, runId) (#227) reads
// _goalHeads/_planHeads directly; goalPlanRunPlans / goalPlanRunIds already exist.
//
// The goalPlan class of callsites (each previously a full-store clone):
//   - :2666 _semanticControlTargets      → goalPlanDispatches(repoId, runId)   (new)
//   - :3582 _runAtPlan                   → goalPlanPlanState(repoId, runId, plan) (new)
//   - :3596 _workflowPlanHistory         → goalPlanRunPlans(repoId, runId)     (exists)
//   - :4286 _reconcileApprovedRuns       → goalPlanRunIds(repoId, limit)       (exists)
//   - :12229 listRuns                    → goalPlanSummary(repoId, limit)      (new)
// The two _findRun legacy arms (:3474 main fallback, :3513 read_only_evidence fallback)
// stay: they fire ONLY on stores lacking the narrow accessors, and are pinned by
// find-run-narrow-229-red.test.mjs and phase92-result-intent-vertical RI9.
//
// RED   at HEAD: three direct `snapshot().goalPlan` spellings (:2666, :4286, :12229) remain,
//   the three new store accessors do not exist, and each behavioral row below trips the
//   full-store snapshot (thrown by the fixture) where a narrow read must serve instead.
// GREEN: zero `snapshot().goalPlan` spellings; the store serves every callsite class with a
//   narrow accessor; the three behavioral rows complete without a single snapshot() call.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BatonApplication } from '../src/application.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLICATION_SOURCE = readFileSync(join(root, 'src', 'application.mjs'), 'utf8');
const STORE_SOURCE = readFileSync(join(root, 'src', 'coordination-store.mjs'), 'utf8');

// ── structural rows ───────────────────────────────────────────────────────────

test('GOALPLAN-NARROW-210-S1: the application source contains ZERO `snapshot().goalPlan` spellings', () => {
  const matches = APPLICATION_SOURCE.match(/snapshot\(\)\.goalPlan/g) ?? [];
  assert.equal(matches.length, 0,
    `application.mjs still contains ${matches.length} full-store snapshot().goalPlan spelling(s): ${[...new Set(matches)].join(', ')}`);
});

test('GOALPLAN-NARROW-210-S2: the store serves every narrowed goalPlan callsite class with a narrow accessor', () => {
  for (const accessor of [
    'goalPlanDispatches', // :2666 _semanticControlTargets
    'goalPlanPlanState',  // :3582 _runAtPlan
    'goalPlanRunPlans',   // :3596 _workflowPlanHistory (already existed)
    'goalPlanRunIds',     // :4286 _reconcileApprovedRuns (already existed)
    'goalPlanSummary',    // :12229 listRuns
  ]) {
    assert.match(STORE_SOURCE, new RegExp(`\\b${accessor}\\s*\\(`),
      `coordination-store.mjs lacks the narrow accessor ${accessor}()`);
  }
});

// ── behavioral rows: a modern store (narrow accessors present) must serve each
//    callsite class WITHOUT the full-store snapshot (the fixture throws on any
//    snapshot() call — RED at HEAD because HEAD calls it) ─────────────────────

function snapshotForbidden(coordination) {
  let snapshotCalls = 0;
  return {
    coordination: { ...coordination, snapshot: () => { snapshotCalls += 1; throw new Error('full snapshot is forbidden'); } },
    snapshotCalls: () => snapshotCalls,
  };
}

test('GOALPLAN-NARROW-210-B1: _semanticControlTargets resolves worker dispatches through goalPlanDispatches — zero full-store clones', () => {
  const { coordination, snapshotCalls } = snapshotForbidden({
    goalPlanDispatches(repoId, runId) {
      assert.equal(repoId, 'repo-210');
      assert.equal(runId, 'run-x');
      return [{ taskId: 'task-1', binding: { nodeKey: 'work' } }];
    },
    task: (taskId) => ({ id: taskId, runId: 'run-x' }),
  });
  const app = Object.create(BatonApplication.prototype);
  app.repoId = 'repo-210';
  app._isWorkflowRun = () => true;
  app._workflowDefinition = () => ({ attempts: [{ nodeKey: 'work', role: 'work' }] });
  app.driver = {
    coordinator: {
      list: () => [{
        runId: 'run-x', fence: 1, status: 'working', taskId: 'task-1',
        sessionPreservationCapable: true,
      }],
    },
    coordination,
  };
  const result = app._semanticControlTargets({ goal: { runId: 'run-x' } });
  assert.equal(snapshotCalls(), 0,
    'semantic control targets must read dispatches narrowly — the full-store clone fired');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].nodeKey, 'work');
  assert.equal(result.rows[0].role, 'work');
  assert.deepEqual(result.sendRecipients, ['work']);
});

test('GOALPLAN-NARROW-210-B2: workflow Plan history walks goalPlanRunPlans + goalPlanPlanState — zero full-store clones', () => {
  const plan = {
    planId: 'plan-1', version: 1, digest: 'digest-1', predecessor: null, nodes: [],
    repoId: 'repo-210', runId: 'run-x',
    goal: { goalId: 'goal-1', version: 1, digest: 'goal-digest-1' },
  };
  const { coordination, snapshotCalls } = snapshotForbidden({
    goalPlanRunPlans(repoId, runId) {
      assert.equal(repoId, 'repo-210');
      assert.equal(runId, 'run-x');
      return [plan];
    },
    goalPlanPlanState(repoId, runId, planId, version, digest) {
      assert.equal(repoId, 'repo-210');
      assert.equal(runId, 'run-x');
      assert.equal(planId, 'plan-1');
      assert.equal(version, 1);
      assert.equal(digest, 'digest-1');
      return { approval: { plan: { planId: 'plan-1', version: 1, digest: 'digest-1' } }, dispatches: [] };
    },
  });
  const app = Object.create(BatonApplication.prototype);
  app.repoId = 'repo-210';
  app._isWorkflowRun = () => true;
  app.driver = { coordination };
  const current = {
    goal: { runId: 'run-x', goalId: 'goal-1', version: 1, digest: 'goal-digest-1' },
    plan,
  };
  const history = app._workflowPlanHistory(current);
  assert.equal(snapshotCalls(), 0,
    'workflow Plan history must read plans narrowly — the full-store clone fired');
  assert.equal(history.length, 1);
  assert.equal(history[0].approval.plan.planId, 'plan-1');
  assert.equal(history[0].dispatch, null);
});

test('GOALPLAN-NARROW-210-B3: runs.list projects from goalPlanSummary — zero full-store clones', async () => {
  const goal = {
    repoId: 'repo-210', runId: 'run-x', version: 1, definedEvent: 10, objective: 'objective-210',
  };
  const { coordination, snapshotCalls } = snapshotForbidden({
    goalPlanSummary(repoId, limit) {
      assert.equal(repoId, 'repo-210');
      assert.equal(limit, 100_000);
      return { goals: [goal], plans: [] };
    },
  });
  const current = {
    goal: { runId: 'run-x', goalId: 'goal-1', version: 1, digest: 'goal-digest-1' },
    plan: null, approval: null, dispatch: null, dispatches: [],
    profile: null, profileName: null, profileDigest: null, profileState: 'unavailable',
  };
  const view = {
    resultIntent: 'execute', phase: 'working', progress: { current: 'work' },
    progressClass: null, attention: [], blockedInteraction: null, waitingOn: null,
    route: { kind: 'mock' }, ownership: { workers: 1 },
  };
  const app = Object.create(BatonApplication.prototype);
  app.repoId = 'repo-210';
  app.ready = Promise.resolve();
  app._assertOpen = () => {};
  app._authorize = async () => {};
  app.principals = { observer: { actor: 'test:observer', principalId: 'obs-210', sessionId: 'sess-210' } };
  app._findRun = () => current;
  app._buildView = async () => view;
  app._withContextProjection = (base, built) => built;
  app._semanticActions = () => [];
  app._progressTiming = () => ({});
  app._resolveSpillObjective = (objective) => objective;
  app.driver = { coordination };
  const principal = Object.freeze({ actor: 'test:owner', principalId: 'own-210', sessionId: 'sess-210' });
  const result = await app.listRuns(principal, null);
  assert.equal(snapshotCalls(), 0,
    'runs.list must project from the narrow summary — the full-store clone fired');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'run-x');
  assert.equal(result.items[0].objective, 'objective-210');
});
