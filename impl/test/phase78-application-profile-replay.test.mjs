import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const repoId = 'repo-phase78-profile-replay';
const route = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase78-profile-replay-${name}-`));
const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

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

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
});

function profile(maxFiles, maxBytes) {
  return {
    schemaVersion: 1,
    repoId,
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['impl/**'],
    verification,
    routes: [route],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
    exportPolicy: {
      mode: 'manual', format: 'directory-v1', maxFiles, maxBytes,
      requireAdoptedResult: false, requireSemanticReview: false, requireIntegration: false,
    },
  };
}

function configuredAdapter(delayMs = 10, scenario = {}) {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: {
      outcome: 'completed', delayMs, summary: 'profile replay fixture', files: {}, ...scenario,
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function application(driver, selectedProfile, exportRoot) {
  return new BatonApplication({
    driver, repoId, profiles: { deployment: selectedProfile }, exportRoot,
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
}

function driver(repo, logDir, { delayMs = 10, scenario = {} } = {}) {
  return createDriver({
    repoRoot: repo, repoId, logDir, adapters: { mock: configuredAdapter(delayMs, scenario) },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
}

async function assertReplayedRunHasNoLocalOwnership(app, selectedDriver, runId, expectedCause) {
  await app.ready;
  const replayedHandle = selectedDriver.coordinator.list().find((handle) => handle.runId === runId);
  assert.ok(replayedHandle, 'durable worker evidence remains replayable');
  assert.equal(Boolean(replayedHandle.worktree || replayedHandle.sessionContext?.worktree
    || replayedHandle.processRef), true, 'durable resource coordinates remain as evidence');
  assert.deepEqual(selectedDriver.coordinator.localResourceOwnership(replayedHandle.id), { owned: false });

  const status = await app.status(runId, principal('observer'));
  assert.equal(status.phase, 'failed');
  assert.deepEqual(status.terminalCause, expectedCause);
  assert.equal(status.route.launchEnforcement.harness.state, 'matched');
  assert.deepEqual(status.ownership, { workers: 0, workerIds: [], closed: false });
  assert.equal(status.progress.stages.find((stage) => stage.key === 'cleanup').state, 'complete');

  const outline = await app.inspect({ runId, depth: 'outline' }, principal('observer'));
  assert.deepEqual(outline.outline.resources, {
    state: 'complete', ownedCount: 0, cleanupState: 'complete', terminalCause: expectedCause,
  });
  assert.equal(outline.outline.actions.some((action) => action.kind === 'stop'), false);
}

test('exact close/reopen keeps durable Run evidence but projects only current-incarnation resource authority', async (t) => {
  const fixtureRoot = root('local-ownership');
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const repo = join(fixtureRoot, 'repo');
  const logDir = join(fixtureRoot, 'log');
  const exportRoot = join(fixtureRoot, 'exports');
  mkdirSync(repo, { mode: 0o700 });
  mkdirSync(exportRoot, { mode: 0o700 });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase78@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 78'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const definition = profile(17, 17_000);
  const firstDriver = driver(repo, logDir, {
    delayMs: 0, scenario: { budgetUsed: { tokens: 15_000, usd: 0 } },
  });
  const first = application(firstDriver, definition, exportRoot);
  await first.ready;
  const runId = 'run-replay-local-ownership';
  const proposed = await first.start({
    runId, objective: 'Prove replay ownership is local authority only', profile: 'deployment',
    route, scope: ['impl/**'],
  }, principal('owner'));
  await first.approve(runId, proposed.plan.digest, principal('approver'));
  const failed = await first.wait(runId, principal('observer'), { timeoutMs: 2_000 });
  assert.equal(failed.phase, 'failed');
  assert.ok(failed.ownership.workers > 0, 'the launching Coordinator owns cleanup before close');
  const expectedCause = failed.terminalCause;
  assert.equal(expectedCause.code, 'budget_hard_limit_exceeded');
  assert.equal(firstDriver.coordinator.localResourceOwnership(failed.ownership.workerIds[0]).owned, true);
  const closed = await first.shutdown(principal('shutdown'));
  assert.deepEqual(closed.ownership, { workers: 0, workerIds: [], closed: true });

  const currentDriver = driver(repo, logDir);
  const current = application(currentDriver, definition, exportRoot);
  await assertReplayedRunHasNoLocalOwnership(current, currentDriver, runId, expectedCause);
  await current.shutdown(principal('shutdown'));

  const historicalDriver = driver(repo, logDir);
  const historical = application(historicalDriver, profile(29, 29_000), exportRoot);
  await assertReplayedRunHasNoLocalOwnership(historical, historicalDriver, runId, expectedCause);
  assert.deepEqual(historical._findRun(runId).profile.exportPolicy, definition.exportPolicy,
    'the prior registered profile remains the policy authority');
  await historical.shutdown(principal('shutdown'));
});

test('deployment-like export-bound drift replays the exact durable historical profile', async (t) => {
  const fixtureRoot = root('durable');
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const repo = join(fixtureRoot, 'repo');
  const logDir = join(fixtureRoot, 'log');
  const exportRoot = join(fixtureRoot, 'exports');
  mkdirSync(repo, { mode: 0o700 });
  mkdirSync(exportRoot, { mode: 0o700 });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase78@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 78'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const priorDefinition = profile(17, 17_000);
  const firstDriver = driver(repo, logDir);
  const first = application(firstDriver, priorDefinition, exportRoot);
  await first.ready;
  const priorDigest = first.card().profiles[0].digest;
  const proposed = await first.start({
    runId: 'run-prior-profile', objective: 'Prove historical profile replay', profile: 'deployment',
    route, scope: ['impl/**'],
  }, principal('owner'));
  await first.approve(proposed.runId, proposed.plan.digest, principal('approver'));
  await first.stop(proposed.runId, 'Finish the historical profile fixture.', principal('stopper'));
  await first.shutdown(principal('shutdown'));

  const currentDefinition = profile(29, 29_000);
  const secondDriver = driver(repo, logDir);
  const second = application(secondDriver, currentDefinition, exportRoot);
  await second.ready;
  const currentDigest = second.card().profiles[0].digest;
  assert.notEqual(currentDigest, priorDigest, 'deployment-derived bounds change the current profile digest');

  const replayed = second._findRun('run-prior-profile');
  assert.equal(replayed.profile.digest, priorDigest);
  assert.deepEqual(replayed.profile.exportPolicy, priorDefinition.exportPolicy);
  assert.notDeepEqual(replayed.profile.exportPolicy, currentDefinition.exportPolicy);
  const status = await second.status('run-prior-profile', principal('observer'));
  assert.equal(status.phase, 'stopped');
  assert.deepEqual(status.profile, { name: 'deployment', digest: priorDigest });

  const records = secondDriver.coordination.events().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'application.profile_registered');
  assert.equal(records.length, 2);
  assert.deepEqual(new Set(records.map((event) => event.payload.profileDigest)), new Set([priorDigest, currentDigest]));
  assert.equal(records.every((event) => event.payload.repoId === repoId
    && event.payload.name === 'deployment'
    && digest(event.payload.profileDefinition) === event.payload.profileDigest), true);
  await second.shutdown(principal('shutdown'));
});

test('a dispatched legacy Run without a profile body cannot block startup or inherit current policy', async (t) => {
  const fixtureRoot = root('legacy');
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const repo = join(fixtureRoot, 'repo');
  const logDir = join(fixtureRoot, 'log');
  const exportRoot = join(fixtureRoot, 'exports');
  mkdirSync(repo, { mode: 0o700 });
  mkdirSync(exportRoot, { mode: 0o700 });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase78@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 78'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const seedDriver = driver(repo, logDir);
  const store = seedDriver.coordination;
  const legacyDigest = 'a'.repeat(64);
  const runId = 'run-legacy-dispatched';
  const auth = (principalId, key) => ({
    actor: `direct:${principalId}`, principalId, repoId, runId, key,
    sessionDigest: digest({ principalId, session: `${principalId}-session` }),
  });
  const goal = store.defineGoal({
    objective: 'Preserve one legacy dispatched Run',
    definitionOfDone: ['deployment verification passes'],
    constraints: [
      'Keep the change inside the approved repository scope',
      `Baton deployment profile deployment@${legacyDigest}`,
    ],
    risk: 'high', budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 }, predecessor: null,
  }, auth('owner', 'legacy:goal')).goal;
  const plan = store.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'work', objective: goal.objective, definitionOfDone: goal.definitionOfDone, deps: [],
      pathScope: ['impl/**'], risk: 'high',
      budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 }, verification,
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, auth('planner', 'legacy:plan')).plan;
  store.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'legacy:approval'));
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'work', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const preview = store.previewPlanDispatch(gate, { vendor: 'mock', model: 'model-a', effort: 'low' });
  store.createPlanGatedTask({
    id: 'legacy-task', brief: preview.brief, deps: [], refines: null, runId, taskType: 'general',
    reservedWorkerId: 'legacy-worker', vendorRequested: 'mock', modelRequested: 'model-a', modelPolicy: null,
    effortRequested: 'low', effortResolved: null, effortObserved: null, routeKey: null,
    sessionRequest: { mode: 'new' },
  }, gate, { vendor: 'mock', model: 'model-a', effort: 'low' }, auth('dispatcher', 'legacy:dispatch'));
  await seedDriver.closeAsync();

  const currentDefinition = profile(31, 31_000);
  const selectedDriver = driver(repo, logDir);
  const app = application(selectedDriver, currentDefinition, exportRoot);
  await app.ready;
  const currentDigest = app.card().profiles[0].digest;
  assert.notEqual(currentDigest, legacyDigest);
  const status = await app.status(runId, principal('observer'));
  assert.equal(status.profile.digest, legacyDigest);
  assert.equal(status.profile.state, 'historical_definition_unavailable');
  assert.equal(status.policy.state, 'unavailable');
  const replayedHandle = selectedDriver.coordinator.list().find((handle) => handle.runId === runId);
  assert.ok(replayedHandle);
  assert.deepEqual(selectedDriver.coordinator.localResourceOwnership(replayedHandle.id), { owned: false });
  assert.deepEqual(status.ownership, { workers: 0, workerIds: [], closed: false });
  assert.equal(status.progress.stages.find((stage) => stage.key === 'cleanup').state, 'complete');
  assert.deepEqual(status.nextActions, []);
  const outline = await app.inspect({ runId, depth: 'outline' }, principal('observer'));
  assert.equal(outline.policy.currentProfileApplied, false);
  assert.equal(outline.outline.policy.mutationAuthority, 'closed');
  assert.deepEqual(outline.outline.resources, {
    state: 'complete', ownedCount: 0, cleanupState: 'complete', terminalCause: null,
  });
  assert.deepEqual(outline.outline.actions, []);
  assert.equal(selectedDriver.coordination.snapshot().goalPlan.dispatches.length, 1);
  await app.shutdown(principal('shutdown'));
});

test('a profile with every optional policy omitted has one canonical self-verifying registry body', async (t) => {
  const fixtureRoot = root('canonical-defaults');
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const repo = join(fixtureRoot, 'repo');
  const logDir = join(fixtureRoot, 'log');
  const exportRoot = join(fixtureRoot, 'exports');
  mkdirSync(repo, { mode: 0o700 });
  mkdirSync(exportRoot, { mode: 0o700 });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase78@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 78'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const definition = profile(1, 1);
  delete definition.exportPolicy;
  const firstDriver = driver(repo, logDir);
  const first = application(firstDriver, definition, exportRoot);
  await first.ready;
  const profileDigest = first.card().profiles[0].digest;
  await first.shutdown(principal('shutdown'));

  const secondDriver = driver(repo, logDir);
  const second = application(secondDriver, definition, exportRoot);
  await second.ready;
  const records = secondDriver.coordination.events().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'application.profile_registered');
  assert.equal(records.length, 1);
  assert.equal(records[0].payload.profileDigest, profileDigest);
  assert.equal(digest(records[0].payload.profileDefinition), profileDigest);
  assert.deepEqual(Object.fromEntries(['reviewPolicy', 'integrationPolicy', 'followPolicy', 'exportPolicy', 'recoveryPolicy']
    .map((name) => [name, records[0].payload.profileDefinition[name].mode])), {
    reviewPolicy: 'none', integrationPolicy: 'none', followPolicy: 'none',
    exportPolicy: 'none', recoveryPolicy: 'none',
  });
  await second.shutdown(principal('shutdown'));
});
