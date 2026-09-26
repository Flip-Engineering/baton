import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BatonApplication, MockAdapter, bindBaton, createDriver,
} from '../src/index.mjs';

const repoId = 'repo-issue407-plan-history';
const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'medium' });

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

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

const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification,
  routes: [routeA, routeB],
  capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (principalId) => Object.freeze({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue407-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue407@example.invalid', GIT_COMMITTER_EMAIL: 'issue407@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 407', GIT_COMMITTER_NAME: 'Issue 407' });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, path) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed', edits: [{ path, content: `${route.harness}\n`, delayMs: 20 }],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'issue407-plan-history-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

function fixture({ repo, logDir }) {
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: {
      codex: adapter(routeA, 'candidate-a.txt'),
      grok: adapter(routeB, 'candidate-b.txt'),
    },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    workflowPolicy,
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: { default: profile },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  return {
    application, driver,
    baton: bindBaton(application, principal('workflow-owner')),
  };
}

async function twoRoundWorkflow(current) {
  const workflow = await current.baton.workflow(
    'Produce and correct an attributable Candidate under a two-round policy.',
    {
      team: [
        { role: 'builder', exact: routeA },
        { role: 'challenger', exact: routeB },
      ],
    },
  );
  await workflow.complete();
  const settled = await current.application.wait(
    workflow.id, principal('workflow-owner'), { timeoutMs: 5_000 },
  );
  assert.equal(settled.phase, 'selection_required');
  await workflow.sendFeedback('builder', {
    summary: 'Correct the selected Candidate without losing its immutable basis.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Revise this exact changed path.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  await workflow.select('builder', 'Use builder as the correction basis.');
  const proposed = await workflow.revise('Address the recorded defect in one bounded correction round.');
  assert.equal(proposed.outline.phase, 'awaiting_plan_approval');
  return workflow;
}

function proposedPlans(driver) {
  return driver.coordination.events()
    .filter((event) => event.kind === 'plan.version_proposed')
    .map((event) => event.payload.plan);
}

test('I407a: maxRounds+1 distinct revisions refuse workflow_plan_history_exceeds_policy', async (t) => {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-issue407-depth-'));
  const current = fixture({ repo, logDir });
  t.after(async () => {
    try { await current.application.shutdown(principal('cleanup')); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  const workflow = await twoRoundWorkflow(current);
  // A chain at the bound still reads: two plans under maxRounds 2.
  assert.equal((await workflow.rounds()).section.itemCount, 2);
  // A third distinct revision exceeds the deployment policy's own maxRounds. The facade's
  // eligibility gate would never mint it, so it arrives through plan authority directly —
  // three legitimate linked versions, no repeated identity, hence not a cycle.
  const [first, second] = proposedPlans(current.driver);
  assert.equal(first.predecessor, null);
  assert.deepEqual(
    { planId: second.predecessor.planId, version: second.predecessor.version },
    { planId: first.planId, version: first.version },
  );
  await current.driver.coordinator.proposePlan({
    goal: { goalId: second.goal.goalId, version: second.goal.version, digest: second.goal.digest },
    predecessor: { planId: second.planId, version: second.version, digest: second.digest },
    nodes: [{
      ...second.nodes[0],
      objective: `${second.nodes[0].objective}\nExcess round past the deployment policy.`,
      revision: {
        ...second.nodes[0].revision,
        round: 3,
        predecessorPlan: { planId: second.planId, version: second.version, digest: second.digest },
        // Stale computed identity: round and predecessor moved, so the id and digest
        // recompute at normalize time instead of failing the proposal.
        revisionId: undefined, revisionDigest: undefined,
      },
    }],
  }, {
    actor: 'direct:issue407-proposer',
    principalId: 'issue407-proposer',
    sessionId: 'issue407-proposer-session',
    powers: ['plan:propose'],
    repoId,
    runId: workflow.id,
    idempotencyKey: `issue407:excess-round:${workflow.id}`,
  });
  assert.equal(proposedPlans(current.driver).length, 3);
  await assert.rejects(workflow.rounds(), (error) => (
    error?.code === 'workflow_plan_history_exceeds_policy'
    && error?.detail?.bound === workflowPolicy.maxRounds
    && error?.detail?.observed === workflowPolicy.maxRounds
    && typeof error?.detail?.next === 'string'
  ), 'a deep chain must name the policy bound and the observed depth, never a cycle');
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

test('I407c: a chain within the policy bound reads its full history', async (t) => {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-issue407-within-'));
  const current = fixture({ repo, logDir });
  t.after(async () => {
    try { await current.application.shutdown(principal('cleanup')); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  const workflow = await twoRoundWorkflow(current);
  const rounds = await workflow.rounds();
  assert.equal(rounds.section.itemCount, 2);
  assert.deepEqual(rounds.section.items.map((item) => item.value.kind), [
    'parallel_attempts', 'revision',
  ]);
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
