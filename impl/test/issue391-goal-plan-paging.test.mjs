// Issue #391 (consolidated C12): goalPlanRunPlans, goalPlanDispatches and goalPlanRunIds use
// `limit` as a refusal threshold rather than a page bound.
//
// At HEAD a caller passing a real page bound gets `goal_plan_status_oversize` the moment one
// more row exists — the store accessors throw past `limit` instead of answering a page. The
// contract required here (the application's own goal-plan read family, the one derivation every
// application goal-plan read shares):
//   (a) more rows than `limit` → the answer carries the FIRST `limit` rows plus
//       {truncated: true, nextCursor} — never a refusal;
//   (b) the cursor continues the answer where the page stopped, with no row repeated and no row
//       lost, until a page ends the set;
//   (c) exactly `limit` rows (and the empty set) → the whole set, truncated: false, nextCursor
//       null — the same cursor vocabulary evidence.search serves (#312): rows, truncated,
//       nextCursor. Nothing refuses for having more rows.
//
// Real stack: createDriver + MockAdapter + BatonApplication — real goal/plan ledger rows (five
// Runs, a five-generation Plan chain, two dispatched Plan generations), real coordination store.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import {
  goalPlanDispatchesPage, goalPlanRunIdsPage, goalPlanRunPlansPage,
} from '../src/application.mjs';


const repoId = 'repo-issue391';
const route = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});
// The goal/plan authority context a direct planner call carries (normalizeGoalPlanContext shape).
const planAuthority = (principalId, power, idempotencyKey, runId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
  repoId, runId, powers: [power], idempotencyKey,
});

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const profile = Object.freeze({
  schemaVersion: 1, repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'], risk: 'high',
  goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 16 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
    requiredPredecessorEvidence: [],
  },
  routes: [route], capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'],
  resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
});

function fixture(name) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue391-${name}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue391@example.invalid', GIT_COMMITTER_EMAIL: 'issue391@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 391', GIT_COMMITTER_NAME: 'Issue 391' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: {
    outcome: 'completed', edits: [], delayMs: 20,
  } });
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(world, 'log'), adapters: { mock: adapter },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId, profiles: { main: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return {
    application, driver, world,
    cleanup: async () => {
      try { await application.shutdown(principal('shutdown')); } catch { /* teardown best effort */ }
      rmSync(world, { recursive: true, force: true });
    },
  };
}

const startRun = (f, runId) => f.application.start({
  runId, objective: `Page the goal-plan rows of ${runId}`, profile: 'main',
  scope: ['impl/**'],
}, principal('owner'));

/** Propose one successor Plan generation on the run's current goal, carrying the same node. */
const proposeSuccessor = async (f, runId, key) => {
  const { goal, plan } = f.driver.coordination.goalPlanRun(repoId, runId);
  const proposed = await f.driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    predecessor: { planId: plan.planId, version: plan.version, digest: plan.digest },
    nodes: [{ ...plan.nodes[0] }],
  }, planAuthority('planner-391', 'plan:propose', key, runId));
  return proposed.plan;
};

/** Build the ledger rows the paging contract reads: five Runs, a five-generation Plan chain on
 * one of them, and two dispatched Plan generations on another. */
async function seedWorld(f) {
  const runIds = ['run-391-a', 'run-391-b', 'run-391-c', 'run-391-d', 'run-391-e'];
  for (const runId of runIds) await startRun(f, runId);
  for (const round of [2, 3, 4, 5]) {
    await proposeSuccessor(f, 'run-391-a', `issue391:plans:v${round}`);
  }
  const first = f.driver.coordination.goalPlanRun(repoId, 'run-391-b').plan;
  await f.application.approve('run-391-b', first.digest, principal('approver'));
  const second = await proposeSuccessor(f, 'run-391-b', 'issue391:dispatches:v2');
  await f.application.approve('run-391-b', second.digest, principal('approver'));
  return runIds;
}

test('(a) more rows than limit answers the first page with truncated and a cursor, never a refusal', async (t) => {
  const f = fixture('page');
  t.after(f.cleanup);
  await f.application.ready;
  const runIds = await seedWorld(f);
  // The Run index: five rows, page of three.
  const idsPage = goalPlanRunIdsPage(f.driver.coordination, repoId, 3);
  assert.equal(idsPage.rows.length, 3, 'the page carries exactly the first limit rows');
  assert.equal(idsPage.truncated, true, 'more rows exist, so the page is truncated');
  assert.equal(typeof idsPage.nextCursor, 'number', 'the page names where to continue');
  // The Plan history: five generations, page of two — the page cuts the sorted set.
  const plansPage = goalPlanRunPlansPage(f.driver.coordination, repoId, 'run-391-a', 2);
  assert.deepEqual(plansPage.rows.map((row) => row.version), [1, 2]);
  assert.equal(plansPage.truncated, true);
  assert.equal(plansPage.nextCursor, 2);
  // The dispatch rows: two dispatched generations, page of one.
  const dispatchPage = goalPlanDispatchesPage(f.driver.coordination, repoId, 'run-391-b', 1);
  assert.equal(dispatchPage.rows.length, 1);
  assert.equal(dispatchPage.truncated, true);
  assert.equal(typeof dispatchPage.nextCursor, 'number', 'the page names where to continue');
  // Nothing refused for having more rows than the limit — the answer is the page contract.
  assert.deepEqual(
    [...idsPage.rows].sort(), runIds.slice(0, 3).sort(),
    'the page rows come from the run set the ledger actually holds',
  );
});

test('(b) the cursor continues the answer where the page stopped', async (t) => {
  const f = fixture('cursor');
  t.after(f.cleanup);
  await f.application.ready;
  const runIds = await seedWorld(f);
  // The Run index: two pages cover the whole set with no row repeated and none lost.
  const first = goalPlanRunIdsPage(f.driver.coordination, repoId, 3);
  assert.equal(first.truncated, true);
  const second = goalPlanRunIdsPage(f.driver.coordination, repoId, 3, first.nextCursor);
  assert.equal(second.truncated, false, 'the continuation ends the set');
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.rows, ...second.rows].sort(), [...runIds].sort());
  // The Plan history: the five-generation chain walks three pages to exhaustion.
  const versions = [];
  let cursor = 0;
  for (;;) {
    const page = goalPlanRunPlansPage(f.driver.coordination, repoId, 'run-391-a', 2, cursor);
    versions.push(...page.rows.map((row) => row.version));
    if (!page.truncated) { assert.equal(page.nextCursor, null); break; }
    cursor = page.nextCursor;
  }
  assert.deepEqual(versions, [1, 2, 3, 4, 5]);
});

test('(c) exactly limit rows — and the empty set — answer whole, not truncated', async (t) => {
  const f = fixture('exact');
  t.after(f.cleanup);
  await f.application.ready;
  const runIds = await seedWorld(f);
  const exact = goalPlanRunIdsPage(f.driver.coordination, repoId, 5);
  assert.equal(exact.rows.length, 5);
  assert.equal(exact.truncated, false, 'a page that ends the set is not truncated');
  assert.equal(exact.nextCursor, null);
  const plansExact = goalPlanRunPlansPage(f.driver.coordination, repoId, 'run-391-a', 5);
  assert.equal(plansExact.rows.length, 5);
  assert.equal(plansExact.truncated, false);
  assert.equal(plansExact.nextCursor, null);
  // The degenerate page: a run the ledger never started has no rows of its own and answers
  // the empty page honestly.
  const empty = goalPlanRunPlansPage(f.driver.coordination, repoId, 'run-391-never-started', 2);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.truncated, false);
  assert.equal(empty.nextCursor, null);
  // And a page size is still a real argument: a nonsense bound refuses typed, by shape —
  // never by row count.
  assert.throws(
    () => goalPlanRunIdsPage(f.driver.coordination, repoId, 0),
    (error) => error?.code === 'application_goal_plan_page_invalid',
  );
  assert.deepEqual([...exact.rows].sort(), [...runIds].sort());
});
