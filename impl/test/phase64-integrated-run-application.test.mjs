import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, CoordinationStore, MockAdapter, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase64-${name}-`));
const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase64',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase64',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

function configuredAdapter(scenario) {
  const adapter = new MockAdapter({ harness: 'mock', scenario });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function fixture(name, {
  delayMs = 20,
  goalPlanAuthorize = async () => true,
  applicationAuthorize = async () => true,
  scenario = null,
} = {}) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase64@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 64'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const adapter = configuredAdapter(scenario
    ?? { outcome: 'completed', delayMs, summary: 'application run completed', files: {} });

  const logDir = root(`${name}-log`);
  const driver = createDriver({
    repoRoot: repo,
    repoId: 'repo-phase64',
    logDir,
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: goalPlanAuthorize },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId: 'repo-phase64',
    profiles: { 'safe-code': profile },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: applicationAuthorize,
  });
  return { application, adapter, driver, repo, logDir };
}

const intent = (overrides = {}) => ({
  runId: 'run-phase64-one',
  objective: 'Repair provider accounting and prove the result',
  profile: 'safe-code',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
  ...overrides,
});

test('UA1-UA5: concise start stops at a readable distinct-authority approval checkpoint without effects', async () => {
  const { application, adapter, driver } = fixture('start');
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };

  const first = await application.start(intent(), principal('goal-owner'));
  assert.equal(first.phase, 'awaiting_plan_approval');
  assert.equal(first.runId, 'run-phase64-one');
  assert.equal(first.objective, intent().objective);
  assert.match(first.profile.digest, /^[a-f0-9]{64}$/);
  assert.match(first.plan.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.planPreview.objective, intent().objective);
  assert.deepEqual(first.planPreview.node.pathScope, ['impl/**']);
  assert.deepEqual(first.planPreview.node.verification.arguments, []);
  assert.deepEqual(first.planPreview.node.route, intent().route);
  assert.match(first.planPreview.displayDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.nextActions, [{ kind: 'approve_plan', planDigest: first.plan.digest }]);
  assert.deepEqual(first.route.requested, intent().route);
  assert.equal(first.route.resolved, null);
  assert.equal(first.route.observed, null);
  assert.equal(first.nodes[0].state, 'ready');
  assert.equal(driver.coordinator.list().length, 0);
  assert.equal(spawnCalls, 0);

  const replay = await application.start(intent(), principal('goal-owner'));
  assert.equal(replay.plan.digest, first.plan.digest);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'goal.version_defined').length, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.version_proposed').length, 1);
  assert.equal(spawnCalls, 0);

  await assert.rejects(
    application.approve('run-phase64-one', first.plan.digest, principal('application-planner')),
    (error) => error.code === 'plan_self_approval',
  );
  assert.equal(spawnCalls, 0);
  await application.shutdown(principal('shutdown-admin'));
});

test('UA3/UA6: approval return and dispatch use service authorities, not accidental observer power', async () => {
  const goalPlanAuthorize = async ({ power, principalId }) => !(principalId === 'no-observe-approver' && power === 'goal:observe');
  const { application } = fixture('approval-authority', { goalPlanAuthorize, delayMs: 10 });
  const proposed = await application.start(intent({ runId: 'run-approval-authority' }), principal('authority-owner'));
  const admitted = await application.approve('run-approval-authority', proposed.plan.digest, principal('no-observe-approver'));
  assert.equal(admitted.phase, 'running');
  const finished = await application.wait('run-approval-authority', principal('authority-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA2/UA6: a durable Goal-only planning failure remains a readable retryable RunView', async () => {
  const goalPlanAuthorize = async ({ power, principalId }) => !(principalId === 'application-planner' && power === 'plan:propose');
  const { application, driver } = fixture('planning-failure', { goalPlanAuthorize });
  const view = await application.start(intent({ runId: 'run-planning-failure' }), principal('planning-owner'));
  assert.equal(view.phase, 'planning_failed');
  assert.equal(view.plan, null);
  assert.equal(view.lastError.code, 'goal_plan_unauthorized');
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'goal.version_defined').length, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.version_proposed').length, 0);
  const reconstructed = await application.status('run-planning-failure', principal('planning-owner'));
  assert.equal(reconstructed.phase, 'planning');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA5/UA8: deployment shutdown is separately authorized and is never presented as run.close', async () => {
  const applicationAuthorize = async ({ command }) => command !== 'application.shutdown';
  const { application } = fixture('shutdown-authority', { applicationAuthorize });
  await application.start(intent({ runId: 'run-shutdown-authority' }), principal('shutdown-owner'));
  assert.equal(application.card().commands.includes('run.close'), false);
  await assert.rejects(
    application.shutdown(principal('unauthorized-admin')),
    (error) => error.code === 'application_unauthorized',
  );
  await application.detach();
});

test('UA4/UA6: RunView redacts credential-shaped attention and answers it exactly through the Run', async () => {
  const secret = 'api_key=abcdefghijklmnopqrstuvwx';
  const { application } = fixture('attention-redaction', {
    scenario: {
      outcome: 'completed', delayMs: 1, summary: 'attention handled', files: {},
      ask: { kind: 'question', question: `Should I use ${secret}?`, blocking: true, afterEditIndex: 0 },
    },
  });
  const proposed = await application.start(intent({ runId: 'run-attention-redaction' }), principal('attention-owner'));
  await application.approve('run-attention-redaction', proposed.plan.digest, principal('attention-approver'));
  const view = await application.wait('run-attention-redaction', principal('attention-owner'), { timeoutMs: 250 });
  assert.equal(view.phase, 'running');
  assert.equal(view.attention[0].question, '[credential-shaped content redacted]');
  assert.equal(JSON.stringify(view).includes(secret), false);
  const answered = await application.answer(
    'run-attention-redaction', view.attention[0].requestId, { text: 'Use the configured credential reference only.' },
    principal('attention-owner'),
  );
  assert.equal(answered.lastAction.result, 'applied');
  assert.equal(answered.attention.length, 0);
  const finished = await application.wait('run-attention-redaction', principal('attention-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  const retry = await application.answer(
    'run-attention-redaction', view.attention[0].requestId, { text: 'Use the configured credential reference only.' },
    principal('attention-owner'),
  );
  assert.equal(retry.lastAction.result, 'already_resolved');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA3-UA5/UA8: approval dispatches once, status/wait return one RunView, and shutdown proves exact reap', async () => {
  const { application, adapter, driver } = fixture('complete');
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };

  const proposed = await application.start(intent(), principal('goal-owner'));
  assert.equal(proposed.progress.current, 'plan');
  assert.equal(proposed.progress.stages.find((stage) => stage.key === 'plan').state, 'active');
  const admitted = await application.approve('run-phase64-one', proposed.plan.digest, principal('human-approver'));
  assert.equal(admitted.phase, 'running');
  assert.equal(admitted.progress.current, 'provider');
  assert.equal(admitted.progress.stages.find((stage) => stage.key === 'dispatch').state, 'complete');
  assert.equal(spawnCalls, 1);
  assert.match(admitted.nodes[0].taskId, /^baton-[a-f0-9]{24}-work$/);

  const replay = await application.approve('run-phase64-one', proposed.plan.digest, principal('human-approver'));
  assert.equal(replay.nodes[0].taskId, admitted.nodes[0].taskId);
  assert.equal(spawnCalls, 1);

  const finished = await application.wait('run-phase64-one', principal('goal-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  assert.equal(finished.route.requested.harness, 'mock');
  assert.match(finished.route.resolved.harness, /^mock@/);
  assert.equal(finished.route.resolved.model, 'model-a');
  assert.equal(finished.route.resolved.effort, 'low');
  assert.equal(finished.verification.state, 'mechanically_verified');
  assert.equal(finished.semanticReview.state, 'semantics_unverified');
  assert.equal(finished.progress.current, 'result');
  assert.equal(finished.progress.stages.find((stage) => stage.key === 'verification').state, 'complete');
  assert.deepEqual(finished.progress.stages.find((stage) => stage.key === 'semantic_review'), {
    key: 'semantic_review', label: 'Independent semantic review', state: 'complete',
    detail: 'Review not required by selected profile',
  });
  assert.equal(finished.progress.stages.find((stage) => stage.key === 'result').state, 'active');
  assert.match(finished.narrative, /done|worker/i);
  assert.equal(finished.ownership.workers, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.node_dispatched').length, 1);

  const closed = await application.shutdown(principal('shutdown-admin'));
  assert.equal(closed.state, 'closed');
  assert.equal(closed.receipt.state, 'closed');
  assert.equal(closed.receipt.authority.coordinatorClosed, true);
  assert.equal(closed.receipt.authority.writerReleased, true);
  assert.match(closed.receipt.receiptDigest, /^[a-f0-9]{64}$/);
  assert.equal(closed.ownership.workers, 0);
  assert.deepEqual(await application.shutdown(principal('shutdown-admin')), closed);
});

test('UA1: profiles permit narrowing but reject route, scope, and input widening before effects', async () => {
  const { application, adapter } = fixture('profile');
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };

  await assert.rejects(
    application.start(intent({ runId: 'run-route-wide', route: { harness: 'mock', model: 'model-b', effort: 'low' } }), principal('owner')),
    (error) => error.code === 'application_route_not_allowed',
  );
  await assert.rejects(
    application.start(intent({ runId: 'run-scope-wide', scope: ['README.md'] }), principal('owner')),
    (error) => error.code === 'application_scope_not_allowed',
  );
  await assert.rejects(
    application.start({ ...intent({ runId: 'run-input-wide' }), budget: { tokens: 1 } }, principal('owner')),
    (error) => error.code === 'application_intent_invalid',
  );
  const narrowed = await application.start(
    intent({ runId: 'run-real-narrowing', scope: ['impl/src/**'] }),
    principal('owner'),
  );
  assert.deepEqual(narrowed.planPreview.node.pathScope, ['impl/src/**']);
  assert.equal(spawnCalls, 0);
  await application.shutdown(principal('shutdown-admin'));
});

test('UA1: the ordinary concise intent can derive a stable Run ID and default profile scope', async () => {
  const { application } = fixture('concise-intent');
  const concise = {
    objective: 'Fix the bounded accounting path',
    profile: 'safe-code',
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
  };
  const first = await application.start(concise, principal('concise-owner'));
  const replay = await application.start(concise, principal('concise-owner'));
  assert.match(first.runId, /^run-[a-f0-9]{32}$/);
  assert.equal(replay.runId, first.runId);
  assert.equal(replay.plan.digest, first.plan.digest);
  assert.deepEqual(first.planPreview.node.pathScope, ['impl/**', 'spec/**']);
  await application.shutdown(principal('shutdown-admin'));
});

test('UA5: the shared command bus exposes the same run flow and a deployment-derived route card', async () => {
  const { application, adapter } = fixture('command-bus', { delayMs: 10 });
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };
  const card = application.card();
  assert.deepEqual(card.commands, ['application.help', 'run.start', 'run.inspect', 'run.act', 'run.status', 'run.follow', 'run.approve', 'run.wait', 'run.answer', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.review', 'run.integrate', 'run.export', 'run.recover', 'application.shutdown']);
  assert.deepEqual(card.profiles[0].routes, [{ harness: 'mock', model: 'model-a', effort: 'low' }]);

  const proposed = await application.command('run.start', { intent: intent({ runId: 'run-command-bus' }) }, principal('command-owner'));
  assert.equal(proposed.phase, 'awaiting_plan_approval');
  const admitted = await application.command('run.approve', {
    runId: proposed.runId,
    planDigest: proposed.plan.digest,
  }, principal('command-approver'));
  assert.equal(admitted.phase, 'running');
  assert.equal(spawnCalls, 1);
  const finished = await application.command('run.wait', { runId: proposed.runId, timeoutMs: 5_000 }, principal('command-owner'));
  assert.equal(finished.phase, 'work_completed');
  await assert.rejects(
    application.command('worker.spawn', {}, principal('command-owner')),
    (error) => error.code === 'application_command_unavailable',
  );
  const closed = await application.command('application.shutdown', {}, principal('command-owner'));
  assert.equal(closed.state, 'closed');
});

test('UA5/UA6: Run steering resolves ownership and the current fence inside the application', async () => {
  const { application, driver } = fixture('steer', { delayMs: 250 });
  const proposed = await application.command('run.start', {
    intent: intent({ runId: 'run-steer' }),
  }, principal('steer-owner'));
  const admitted = await application.command('run.approve', {
    runId: 'run-steer', planDigest: proposed.plan.digest,
  }, principal('steer-approver'));
  const target = admitted.ownership.workerIds[0];
  assert.equal(typeof target, 'string');
  const before = driver.coordinator.list().find((worker) => worker.id === target);
  assert.equal(Number.isSafeInteger(before.fence), true);

  const steered = await application.command('run.steer', {
    runId: 'run-steer', target, mode: 'nudge',
    message: 'Keep the verification boundary explicit.',
    reason: 'The operator wants an auditable completion claim.',
  }, principal('steer-owner'));
  assert.deepEqual(steered.lastAction, {
    command: 'run.steer', target, mode: 'nudge',
    reason: 'The operator wants an auditable completion claim.', result: 'ok', emulated: false,
  });
  assert.equal(driver.log.read(target).some((event) => event.kind === 'control.nudge'
    && event.actor === 'direct:steer-owner'), true);
  await assert.rejects(application.command('run.steer', {
    runId: 'run-steer', target: 'worker-from-another-run', mode: 'now',
    message: 'Redirect.', reason: 'Wrong owner must be rejected.',
  }, principal('steer-owner')), (error) => error.code === 'application_worker_not_found');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA5/UA8: Run stop before approval closes dispatch durably without spawning or closing Baton', async () => {
  const { application, adapter, driver, logDir } = fixture('stop-before-approval');
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };
  const proposed = await application.start(intent({ runId: 'run-stop-before-approval' }), principal('stop-owner'));

  const stopped = await application.command('run.stop', {
    runId: proposed.runId, reason: 'The operator withdrew this Run before effects were approved.',
  }, principal('stop-operator'));
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.state, 'stopped');
  assert.equal(stopped.stop.receipt.scope, 'run');
  assert.equal(stopped.stop.receipt.targetCount, 0);
  assert.deepEqual(stopped.stop.receipt.effects, {
    coordinatorClosed: false, writerReleased: false, transportsClosed: false,
  });
  assert.equal(stopped.ownership.workers, 0);
  assert.equal(spawnCalls, 0);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'run.stop_admitted').length, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'run.stop_completed').length, 1);
  await assert.rejects(
    application.approve(proposed.runId, proposed.plan.digest, principal('late-approver')),
    (error) => error.code === 'application_run_stopped',
  );
  assert.throws(() => driver.coordination.approvePlan({
    goal: { goalId: proposed.goal.id, version: proposed.goal.version, digest: proposed.goal.digest },
    plan: { planId: proposed.plan.id, version: proposed.plan.version, digest: proposed.plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, {
    actor: 'direct:bypass-attempt', principalId: 'bypass-attempt', sessionDigest: 'a'.repeat(64),
    repoId: 'repo-phase64', runId: proposed.runId, key: 'bypass-after-stop',
  }), (error) => error.code === 'run_stopping');
  assert.equal(application.card().commands.includes('run.start'), true, 'application remains open');
  await application.shutdown(principal('shutdown-admin'));
  const replay = new CoordinationStore(join(logDir, 'coordination'), { goalPlanPolicy: policy });
  assert.equal(replay.runStop(proposed.runId).status, 'stopped');
  assert.equal(replay.runStop(proposed.runId).receipt.remainingCount, 0);
});

test('UA5/UA8: Run stop kills and reaps only its exact workers while another Run remains steerable', async () => {
  const { application, driver } = fixture('stop-isolated', { delayMs: 750 });
  const first = await application.start(intent({ runId: 'run-stop-first' }), principal('first-owner'));
  const firstRunning = await application.approve(first.runId, first.plan.digest, principal('first-approver'));
  const firstWorker = firstRunning.ownership.workerIds[0];
  const second = await application.start(intent({ runId: 'run-stop-second' }), principal('second-owner'));
  const secondRunning = await application.approve(second.runId, second.plan.digest, principal('second-approver'));
  const secondWorker = secondRunning.ownership.workerIds[0];

  const stopped = await application.stop(first.runId, 'Stop this Run and reap its exact worker.', principal('stop-operator'));
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.receipt.targetCount, 1);
  assert.equal(stopped.stop.receipt.remainingCount, 0);
  assert.equal(stopped.stop.receipt.counts.killConfirmed, 1);
  assert.equal(stopped.stop.receipt.checks.dispatchClosed, true);
  assert.equal(stopped.stop.receipt.checks.runAuthorityReleased, true);
  assert.equal(stopped.stop.receipt.effects.coordinatorClosed, false);
  assert.equal(driver.coordinator.list().find((worker) => worker.id === firstWorker).status, 'dead');

  const steered = await application.steer({
    runId: second.runId, target: secondWorker, mode: 'nudge',
    message: 'Continue the second Run.', reason: 'Prove Run-scoped isolation.',
  }, principal('second-owner'));
  assert.equal(steered.lastAction.result, 'ok');
  assert.equal(steered.ownership.workerIds.includes(secondWorker), true);
  assert.equal(driver.coordinator.list().find((worker) => worker.id === secondWorker).status, 'working');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA2/UA3/UA6: an approval-pending Run reconstructs after a clean process detach', async () => {
  const first = fixture('restart', { delayMs: 10 });
  const proposed = await first.application.start(intent({ runId: 'run-restart' }), principal('restart-owner'));
  assert.equal((await first.application.detach()).state, 'detached');
  await assert.rejects(
    first.application.status('run-restart', principal('restart-owner')),
    (error) => error.code === 'application_detached',
  );

  const adapter = configuredAdapter({
    outcome: 'completed', delayMs: 10, summary: 'restarted application completed', files: {},
  });
  const driver = createDriver({
    repoRoot: first.repo,
    repoId: 'repo-phase64',
    logDir: first.logDir,
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId: 'repo-phase64',
    profiles: { 'safe-code': profile },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const reconstructed = await application.status('run-restart', principal('restart-owner'));
  assert.equal(reconstructed.phase, 'awaiting_plan_approval');
  assert.equal(reconstructed.plan.digest, proposed.plan.digest);
  await application.approve('run-restart', proposed.plan.digest, principal('restart-approver'));
  const finished = await application.wait('run-restart', principal('restart-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA3/UA6: startup scheduler dispatches an approved durable node after the approval-response crash boundary', async () => {
  const first = fixture('approved-restart', { delayMs: 10 });
  const runId = 'run-approved-restart';
  const proposed = await first.application.start(intent({ runId }), principal('approved-owner'));
  await first.driver.coordinator.approvePlan({
    goal: { goalId: proposed.goal.id, version: proposed.goal.version, digest: proposed.goal.digest },
    plan: { planId: proposed.plan.id, version: proposed.plan.version, digest: proposed.plan.digest },
    expectedDisposition: null,
    disposition: 'approved',
  }, {
    actor: 'direct:crash-boundary-approver', principalId: 'crash-boundary-approver', sessionId: 'crash-boundary-session',
    powers: ['plan:approve'], repoId: 'repo-phase64', runId, idempotencyKey: `crash-boundary:${runId}:approve`,
  });
  assert.equal(first.driver.coordinator.list().length, 0);
  await first.application.detach();

  const adapter = configuredAdapter({
    outcome: 'completed', delayMs: 10, summary: 'scheduler resumed approved run', files: {},
  });
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };
  const driver = createDriver({
    repoRoot: first.repo,
    repoId: 'repo-phase64',
    logDir: first.logDir,
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId: 'repo-phase64',
    profiles: { 'safe-code': profile },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  assert.equal(spawnCalls, 1);
  const finished = await application.wait(runId, principal('approved-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.node_dispatched').length, 1);
  await application.shutdown(principal('shutdown-admin'));
});

test('UA4-UA8: accepted result is pinned, evidenced, and explicitly adopted without changing the checkout', async () => {
  const { application, driver, repo } = fixture('result-adoption', {
    scenario: {
      outcome: 'completed', delayMs: 10, summary: 'produced an adoptable result',
      files: { 'impl/result.txt': 'accepted result\n' },
    },
  });
  const runId = 'run-result-adoption';
  const proposed = await application.start(intent({ runId }), principal('result-owner'));
  await application.approve(runId, proposed.plan.digest, principal('result-approver'));
  const finished = await application.wait(runId, principal('result-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  assert.equal(finished.result.state, 'accepted');
  assert.match(finished.result.sha, /^[a-f0-9]{40,64}$/);
  assert.equal(finished.result.preservation.state, 'pinned');
  assert.equal(finished.evidence.some((artifact) => artifact.kind === 'commit' && artifact.accepted), true);
  assert.equal(finished.evidence.some((artifact) => artifact.kind === 'verification' && artifact.accepted), true);
  assert.equal(JSON.stringify(finished).includes('refs/baton/results/'), false);

  const beforeEvidenceEvents = driver.coordination.events().length;
  const evidence = await application.command('run.evidence', { runId }, principal('result-owner'));
  assert.equal(evidence.kind, 'baton.run.evidence');
  assert.equal(evidence.phase, 'work_completed');
  assert.equal(evidence.progress.current, 'result');
  assert.equal(evidence.result.sha, finished.result.sha);
  assert.equal(evidence.checks.acceptedArtifactsReverified, true);
  assert.equal(evidence.checks.resultRefReverified, true);
  assert.match(evidence.manifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(driver.coordination.events().length, beforeEvidenceEvents, 'evidence read appends nothing');
  assert.equal(JSON.stringify(evidence).includes('refs/baton/results/'), false);

  await application.start(intent({ runId: 'run-unrelated-after-evidence' }), principal('unrelated-owner'));
  const stable = await application.evidence(runId, principal('result-owner'));
  assert.equal(stable.manifestDigest, evidence.manifestDigest, 'unrelated Run events do not perturb evidence identity');

  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  const adopted = await application.command('run.adopt', {
    runId, nodeKey: 'work', resultSha: evidence.result.sha, evidenceDigest: evidence.manifestDigest,
    reason: 'The verified report is the selected result for this Run.',
  }, principal('result-adopter'));
  assert.equal(adopted.phase, 'work_completed', 'adoption selects a result but cannot fabricate semantic completion');
  assert.equal(adopted.result.state, 'adopted');
  assert.equal(adopted.progress.current, 'cleanup');
  assert.equal(adopted.progress.stages.find((stage) => stage.key === 'result').state, 'complete');
  assert.match(adopted.result.adoption.receiptDigest, /^[a-f0-9]{64}$/);
  assert.equal(adopted.lastAction.command, 'run.adopt');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), headBefore);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), statusBefore);
  assert.equal(execFileSync('git', ['rev-parse', '--verify', `refs/baton/results/${evidence.result.sha}^{commit}`], {
    cwd: repo, encoding: 'utf8',
  }).trim(), evidence.result.sha);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'run.result_adoption_admitted').length, 1);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'run.result_adoption_completed').length, 1);

  const retry = await application.adopt({
    runId, nodeKey: 'work', resultSha: evidence.result.sha, evidenceDigest: evidence.manifestDigest,
    reason: 'The verified report is the selected result for this Run.',
  }, principal('result-adopter'));
  assert.equal(retry.result.adoption.receiptDigest, adopted.result.adoption.receiptDigest);
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'run.result_adoption_admitted').length, 1);
  await assert.rejects(application.adopt({
    runId, nodeKey: 'work', resultSha: evidence.result.sha, evidenceDigest: evidence.manifestDigest,
    reason: 'A changed reason must not reuse the same durable adoption.',
  }, principal('result-adopter')), (error) => error.code === 'application_adopt_conflict');

  const adoptedEvidence = await application.evidence(runId, principal('result-owner'));
  assert.equal(adoptedEvidence.phase, 'work_completed');
  assert.equal(adoptedEvidence.semanticReview.state, 'semantics_unverified');
  assert.notEqual(adoptedEvidence.manifestDigest, evidence.manifestDigest);
  await application.shutdown(principal('shutdown-admin'));
  assert.equal(execFileSync('git', ['rev-parse', '--verify', `refs/baton/results/${evidence.result.sha}^{commit}`], {
    cwd: repo, encoding: 'utf8',
  }).trim(), evidence.result.sha, 'shutdown preserves adopted result refs');
});
