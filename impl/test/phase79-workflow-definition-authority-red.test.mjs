import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const repoId = 'repo-phase79-definition';
const routes = Object.freeze([
  Object.freeze({ harness: 'mock', model: 'model-a', effort: 'high' }),
  Object.freeze({ harness: 'mock', model: 'model-b', effort: 'low' }),
]);
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
  routes, capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'],
  resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
});

function fixture(name) {
  const world = mkdtempSync(join(tmpdir(), `baton-phase79-definition-${name}-`));
  const repo = join(world, 'repo'); const logDir = join(world, 'log');
  execFileSync('mkdir', ['-p', repo]);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase79@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 79'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: {
    outcome: 'completed', edits: [], delayMs: 20,
  } });
  const nativeCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...nativeCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a', 'model-b'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low', 'high'], serviceTier: null,
      provenance: 'phase79-definition-test', refreshedAt: null,
    },
  });
  let spawnCalls = 0;
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return nativeSpawn(...args); };
  const driver = createDriver({
    repoRoot: repo, repoId, logDir, adapters: { mock: adapter },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId, profiles: { workflow: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { application, driver, spawnCalls: () => spawnCalls, world };
}

const intent = (runId) => ({
  runId, objective: 'Produce two bound Workflow candidates', profile: 'workflow',
  scope: ['impl/**'],
  composition: {
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
    team: [
      { role: 'builder', route: routes[0] },
      { role: 'challenger', route: routes[1] },
    ],
  },
});

test('WF79-D1: Workflow definition prebinding survives a lost Plan proposal and precedes retry proposal', async (t) => {
  const f = fixture('prebind');
  t.after(async () => {
    try { await f.application.shutdown(principal('shutdown')); } catch {}
    rmSync(f.world, { recursive: true, force: true });
  });
  await f.application.ready;
  const propose = f.driver.coordinator.proposePlan.bind(f.driver.coordinator);
  f.driver.coordinator.proposePlan = async () => {
    throw Object.assign(new Error('injected proposal interruption'), { code: 'injected_plan_failure' });
  };
  const interrupted = await f.application.start(intent('run-definition-prebind'), principal('owner'));
  assert.equal(interrupted.phase, 'planning_failed');
  const before = f.driver.coordination.events();
  const definition = before.find((event) => (
    event.kind === 'driver.recorded'
      && event.payload.kind === 'application.workflow_definition_bound'
  ));
  assert.ok(definition);
  assert.equal(before.some((event) => event.kind === 'plan.version_proposed'), false);

  f.driver.coordinator.proposePlan = propose;
  const planned = await f.application.start(intent('run-definition-prebind'), principal('owner'));
  assert.equal(planned.phase, 'awaiting_plan_approval');
  const events = f.driver.coordination.events();
  const plan = events.find((event) => event.kind === 'plan.version_proposed');
  assert.ok(plan);
  assert.ok(definition.seq < plan.seq);
  assert.equal(events.filter((event) => event.payload?.kind === 'application.workflow_definition_bound').length, 1);
  assert.equal(f.spawnCalls(), 0);
});

test('WF79-D2: duplicate Attempt bindings with a recomputed definition digest fail before approval or provider effects', async (t) => {
  const f = fixture('bijection');
  t.after(async () => {
    try { await f.application.shutdown(principal('shutdown')); } catch {}
    rmSync(f.world, { recursive: true, force: true });
  });
  await f.application.ready;
  const recordDriver = f.driver.coordination.recordDriver.bind(f.driver.coordination);
  f.driver.coordination.recordDriver = (kind, payload, auth) => {
    if (kind !== 'application.workflow_definition_bound') return recordDriver(kind, payload, auth);
    const { definitionDigest: ignored, ...core } = payload;
    void ignored;
    const forgedCore = { ...core, attempts: [core.attempts[0], core.attempts[0]] };
    return recordDriver(kind, { ...forgedCore, definitionDigest: digest(forgedCore) }, auth);
  };
  await assert.rejects(
    f.application.start(intent('run-definition-bijection'), principal('owner')),
    (error) => error?.code === 'application_workflow_integrity',
  );
  assert.equal(f.driver.coordination.snapshot().goalPlan.approvals.length, 0);
  assert.equal(f.driver.coordinator.list().length, 0);
  assert.equal(f.spawnCalls(), 0);
});
