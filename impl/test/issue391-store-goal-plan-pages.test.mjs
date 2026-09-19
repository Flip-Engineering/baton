// Issue #391 (C12, STORE half): the store accessors of the goal-plan read family answered
// `limit` as a REFUSAL THRESHOLD, not a page bound — the moment one more row existed than the
// caller asked for, `goalPlanRunPlans` ('goal/plan Run history exceeds its bounded ceiling'),
// `goalPlanDispatches` ('... Run dispatches exceed their bounded ceiling'), `goalPlanSummary`
// ('goal/plan summary exceeds its bounded ceiling') and `goalPlanRunIds` ('goal/plan Run index
// exceeds its bounded ceiling') threw `goal_plan_status_oversize`. The application half
// (f40213a5) already consumes {rows, truncated, nextCursor} and walks pages to the whole bounded
// set — it only ever avoided the refusal because it passed the store's own whole-set bound as
// the "page" size; the store still threw underneath it for any real page bound.
//
// The contract pinned here, on the same store fixtures the application half's own test builds
// (createDriver + MockAdapter + BatonApplication, real goal/plan ledger rows):
//   (a) N > limit Plans → the store answers the FIRST limit rows with truncated and a resumable
//       nextCursor, and resuming yields the rest — never a refusal;
//   (b) the same over the other two accessors and the head summary (table-driven), and the
//       application's own runs.list readsite walking those pages end to end;
//   (c) exactly ONE page derivation exists across the live sources — the store accessors and the
//       application readsites share it, so no second page implementation can drift;
//   (d) the application readsites no longer reference the count refusal, and the store's only
//       remaining occurrence is the per-row BYTE ceiling, named as such;
//   (e) a store that pages its summary is walked to the whole bounded set by runs.list.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';


const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const readSource = (name) => readFileSync(join(srcDir, name), 'utf8');

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
  const world = mkdtempSync(join(tmpdir(), `baton-issue391-store-${name}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue391@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 391'], { cwd: repo });
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

/** The ledger rows the paging contract reads: five Runs, a five-generation Plan chain on one of
 * them, and two dispatched Plan generations on another. */
async function seedWorld(f) {
  const runIds = ['run-391-a', 'run-391-b', 'run-391-c', 'run-391-d', 'run-391-e'];
  for (const runId of runIds) await startRun(f, runId);
  for (const round of [2, 3, 4, 5]) {
    await proposeSuccessor(f, 'run-391-a', `issue391-store:plans:v${round}`);
  }
  const first = f.driver.coordination.goalPlanRun(repoId, 'run-391-b').plan;
  await f.application.approve('run-391-b', first.digest, principal('approver'));
  const second = await proposeSuccessor(f, 'run-391-b', 'issue391-store:dispatches:v2');
  await f.application.approve('run-391-b', second.digest, principal('approver'));
  return runIds;
}

/** The three row-shaped accessors, each with the run set the seed built and a stable row key. */
const accessors = (coordination) => [
  {
    name: 'goalPlanRunPlans',
    total: 5,
    key: (row) => row.version,
    read: (limit, cursor) => coordination.goalPlanRunPlans(repoId, 'run-391-a', limit, cursor),
  },
  {
    name: 'goalPlanDispatches',
    total: 2,
    // Two dispatched Plan generations carry the SAME node key ('work'), so the identity that tells
    // the rows apart is the generation they belong to.
    key: (row) => `${row.binding.planId}:${row.binding.planVersion}:${row.binding.nodeKey}`,
    read: (limit, cursor) => coordination.goalPlanDispatches(repoId, 'run-391-b', limit, cursor),
  },
  {
    name: 'goalPlanRunIds',
    total: 5,
    key: (row) => row,
    read: (limit, cursor) => coordination.goalPlanRunIds(repoId, limit, cursor),
  },
];

test('(a) N > limit Plans answers the first page with a cursor, never a refusal', async (t) => {
  const f = fixture('plans');
  t.after(f.cleanup);
  await f.application.ready;
  await seedWorld(f);
  const coordination = f.driver.coordination;
  // Five Plan generations, a page of two: the answer is the first two, and the set is truncated.
  const first = coordination.goalPlanRunPlans(repoId, 'run-391-a', 2);
  assert.deepEqual(first.rows.map((row) => row.version), [1, 2]);
  assert.equal(first.truncated, true, 'more rows exist, so the page is truncated');
  assert.equal(first.nextCursor, 2, 'the page names the offset to continue from');
  // Resuming from that cursor yields the rest, and the last page ends the set.
  const second = coordination.goalPlanRunPlans(repoId, 'run-391-a', 2, first.nextCursor);
  assert.deepEqual(second.rows.map((row) => row.version), [3, 4]);
  assert.equal(second.truncated, true);
  assert.equal(second.nextCursor, 4);
  const third = coordination.goalPlanRunPlans(repoId, 'run-391-a', 2, second.nextCursor);
  assert.deepEqual(third.rows.map((row) => row.version), [5]);
  assert.equal(third.truncated, false, 'a page that ends the set is not truncated');
  assert.equal(third.nextCursor, null);
  // A page of exactly the set is the whole set: truncation is about rows LEFT, not rows served.
  const exact = coordination.goalPlanRunPlans(repoId, 'run-391-a', 5);
  assert.equal(exact.rows.length, 5);
  assert.equal(exact.truncated, false);
  assert.equal(exact.nextCursor, null);
  // A run the ledger never started answers the empty page honestly.
  const empty = coordination.goalPlanRunPlans(repoId, 'run-391-never-started', 2);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.truncated, false);

  // A page size is still a real argument: a nonsense bound refuses by SHAPE, never by row count.
  assert.throws(() => coordination.goalPlanRunPlans(repoId, 'run-391-a', 0),
    (error) => error instanceof TypeError, 'the store bound stays real, so a bad page size bites');
});

test('(b) the same page contract holds for dispatches, run ids and the head summary', async (t) => {
  const f = fixture('table');
  t.after(f.cleanup);
  await f.application.ready;
  const runIds = await seedWorld(f);
  const coordination = f.driver.coordination;
  for (const accessor of accessors(coordination)) {
    // One row per page: every page but the last is truncated and names where to continue.
    const asked = [];
    let cursor = 0;
    for (;;) {
      const page = accessor.read(1, cursor);
      assert.equal(page.rows.length, 1, `${accessor.name}: the page carries the rows asked for`);
      asked.push(...page.rows.map(accessor.key));
      if (!page.truncated) { assert.equal(page.nextCursor, null); break; }
      assert.equal(page.nextCursor, cursor + 1, `${accessor.name}: the cursor steps one page`);
      cursor = page.nextCursor;
    }
    assert.equal(asked.length, accessor.total,
      `${accessor.name}: the walk reaches every row exactly once`);
    assert.equal(new Set(asked).size, accessor.total,
      `${accessor.name}: no row repeats across pages`);
    const whole = accessor.read(accessor.total, 0);
    assert.deepEqual(asked, whole.rows.map(accessor.key),
      `${accessor.name}: the walk reproduces the whole set, in order`);
    assert.equal(whole.truncated, false);
    assert.equal(accessor.read(accessor.total - 1, 0).truncated, true,
      `${accessor.name}: one row short of the set is still a truncated page`);
  }
  // The head summary behind runs.list answers the same vocabulary: one page of heads, with the
  // plans of the heads it served, and a cursor to the rest.
  const heads = coordination.goalPlanSummary(repoId, 2);
  assert.equal(heads.goals.length, 2);
  assert.equal(heads.truncated, true);
  assert.equal(heads.nextCursor, 2);
  const headRest = [];
  let cursor = 0;
  for (;;) {
    const page = coordination.goalPlanSummary(repoId, 2, cursor);
    headRest.push(...page.goals.map((goal) => goal.runId));
    if (!page.truncated) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual([...headRest].sort(), [...runIds].sort(),
    'the head summary walk covers every run the ledger holds');
  // The RUN INDEX agrees with the summary, and neither refuses for the row count.
  assert.deepEqual([...coordination.goalPlanRunIds(repoId, 100).rows].sort(), [...runIds].sort());
  // The application's own readsite rides that page: runs.list projects the head summary through
  // the walk, so the whole seeded set comes back rather than one page of it.
  const listed = await f.application.listRuns(principal('observer'), null, {});
  assert.deepEqual([...listed.items.map((item) => item.id)].sort(), [...runIds].sort(),
    'runs.list lists every run the ledger holds, served page by page');
});

test('(e) the runs.list readsite walks the summary pages to the whole bounded set', async () => {
  // Five heads served TWO at a time: runs.list must reach all five through the cursor the store
  // hands back — the readsite's own half of the #391 contract, and the only place the walk can
  // be driven to more than one page (the deployment reads at the registry bound, 100 000).
  const goals = [1, 2, 3, 4, 5].map((index) => ({
    repoId, runId: `run-page-${index}`, version: 1, definedEvent: index,
    objective: `objective ${index}`,
  }));
  const requested = [];
  const coordination = {
    goalPlanSummary(id, limit, cursor = 0) {
      assert.equal(id, repoId);
      assert.equal(limit, FRAME_LIMITS['view.run.records'].value);
      requested.push(cursor);
      const page = goals.slice(cursor, cursor + 2);
      const nextCursor = cursor + page.length < goals.length ? cursor + page.length : null;
      return { goals: page, plans: [], truncated: nextCursor !== null, nextCursor };
    },
  };
  const current = {
    goal: { runId: 'run-page-1', goalId: 'goal-1', version: 1, digest: 'goal-digest-1' },
    plan: null, approval: null, dispatch: null, dispatches: [],
    profile: null, profileName: null, profileDigest: null, profileState: 'unavailable',
  };
  const view = {
    resultIntent: 'execute', phase: 'working', progress: { current: 'work' },
    progressClass: null, attention: [], blockedInteraction: null, waitingOn: null,
    route: { kind: 'mock' }, ownership: { workers: 1 },
  };
  const app = Object.create(BatonApplication.prototype);
  app.repoId = repoId;
  app.ready = Promise.resolve();
  app._assertOpen = () => {};
  app._authorize = async () => {};
  app.principals = { observer: principal('observer') };
  app._findRun = () => current;
  app._buildView = async () => view;
  app._withContextProjection = (base, built) => built;
  app._semanticActions = () => [];
  app._progressTiming = () => ({});
  app._resolveSpillObjective = (objective) => objective;
  app.driver = { coordination };
  const result = await app.listRuns(principal('observer'), null, {});
  assert.deepEqual(result.items.map((item) => item.id),
    ['run-page-5', 'run-page-4', 'run-page-3', 'run-page-2', 'run-page-1'],
    'every head the summary held across its pages reaches runs.list');
  assert.deepEqual(requested, [0, 2, 4], 'the walk resumes from each page the store served');
});

test('(c) the store and the application share ONE page derivation', () => {
  const definitions = [];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.mjs')) continue;
    const found = readSource(name).match(/^export function goalPlanPage\(/gmu) ?? [];
    for (let index = 0; index < found.length; index += 1) definitions.push(name);
  }
  assert.deepEqual(definitions, ['goal-plan.mjs'],
    'the page cut is defined once, in the shared goal-plan module the store and the application read');
  // The application re-exports that one derivation instead of carrying a second one.
  const application = readSource('application.mjs');
  assert.match(application, /export \{ goalPlanPage \};/u,
    'application.mjs re-exports the shared page derivation for its own readers');
  assert.equal(/function goalPlanPage\(/u.test(application), false,
    'application.mjs defines no page derivation of its own');
  // And every module that derives a page reads it from the shared module rather than cutting pages
  // by hand. Issue #259 slice 4 moved the store's page-deriving member into coordination-ledger.mjs,
  // so the store itself may no longer name `goalPlanPage` at all: the claim is about the modules
  // that CALL it — one derivation, imported, wherever the split put its readers.
  for (const name of ['coordination-store.mjs', 'coordination-internals.mjs', 'coordination-ledger.mjs']) {
    const source = readSource(name);
    if (!/goalPlanPage\(/u.test(source)) continue;
    assert.match(source, /import \{[^}]*goalPlanPage[^}]*\} from '\.\/goal-plan\.mjs';/su,
      `${name}: the page derivation comes from the shared module`);
  }
  assert.match(readSource('coordination-ledger.mjs'), /goalPlanPage\(/u,
    'coordination-ledger.mjs: the moved page derivation still reads the one shared derivation');
  assert.equal(/function goalPlanPage\(/u.test(readSource('coordination-store.mjs')), false,
    'coordination-store.mjs cuts no pages of its own');
});

test('(d) no count refusal survives, and the byte ceiling is named as one', () => {
  // Comments NARRATE the refusal this issue removed, so the scan reads code lines only — the same
  // rule the #430 refusal-code gate applies to source it audits.
  const codeLinesWith = (source, needle) => source.split('\n')
    .filter((line) => line.includes(needle))
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    });
  const application = readSource('application.mjs');
  assert.deepEqual(codeLinesWith(application, 'goal_plan_status_oversize'), [],
    'no application readsite raises or catches the count refusal any more');
  const storeLines = ['coordination-store.mjs', 'coordination-ledger.mjs']
    .flatMap((name) => codeLinesWith(readSource(name), 'goal_plan_status_oversize'));
  assert.equal(storeLines.length, 1, 'the store keeps exactly one goal_plan_status_oversize site');
  assert.match(storeLines[0], /maxStatusBytes/u,
    'and it is the single-row BYTE ceiling the policy keeps, not a row count');
  assert.deepEqual(codeLinesWith(readSource('coordination-internals.mjs'), 'goal_plan_status_oversize'),
    [], 'the run-index accessor raises no count refusal');
});
