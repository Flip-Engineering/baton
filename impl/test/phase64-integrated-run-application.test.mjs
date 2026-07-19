import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BatonApplication, CoordinationStore, DEFAULT_WORKER_POLICY_REQUEST, MockAdapter, bindBaton,
  bindBatonPort, createDriver,
} from '../src/index.mjs';

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

function enablePreservedMockSession(adapter) {
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(), sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' },
  });
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (worker, brief, opts) => {
    const ack = await spawn(worker, brief, opts);
    const session = adapter._sessions.get(worker);
    if (ack.ok && session) queueMicrotask(() => adapter._emit(session, 'lifecycle.spawned', {
      sessionId: `mock-native-${worker}`, modelObserved: opts.model ?? null,
    }));
    return ack;
  };
  const prompt = adapter.prompt.bind(adapter);
  adapter.prompt = async (worker, content, mode = 'turn') => {
    const session = adapter._sessions.get(worker);
    if (mode === 'turn' && session && !session.runStarted && !session.terminal) {
      if (session.haltSignal.aborted) {
        const controller = new AbortController();
        session.haltController = controller;
        session.haltSignal = controller.signal;
      }
      // MockAdapter's reusable test session keeps its wire epoch in spawn options. Initial
      // Application dispatch is epoch 2; the preserved successor is the next exact epoch.
      session.opts.turnEpoch = (session.opts.turnEpoch ?? 2) + 1;
      adapter._emit(session, 'control.send', { content, mode });
      adapter._startSession(session);
      return { ok: true };
    }
    return prompt(worker, content, mode);
  };
  adapter.interrupt = async (worker, _then, options = {}) => {
    const session = adapter._sessions.get(worker);
    if (!session || session.terminal) return { ok: true, terminal: true };
    session.haltController.abort();
    session.runStarted = false;
    session.stopKind = null;
    queueMicrotask(() => adapter._emit(session, 'control.interrupt_confirmed', {
      sessionId: `mock-native-${worker}`, transportOpen: true,
      preservationRequested: options.preserveTurn === true,
      usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
    }));
    return { ok: true };
  };
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

function reopenApplication(driver, authorize = async () => true) {
  return new BatonApplication({
    driver,
    repoId: 'repo-phase64',
    profiles: { 'safe-code': profile },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize,
  });
}

const intent = (overrides = {}) => ({
  runId: 'run-phase64-one',
  objective: 'Repair provider accounting and prove the result',
  profile: 'safe-code',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
  ...overrides,
});

test('UA2/RT5: Pythonic Run streams consume internal pagination and expose attributed facts only', async () => {
  const calls = [];
  const pages = [
    {
      schemaVersion: 1, runId: 'run-stream-client', depth: 'content', cursor: 7,
      terminal: false, content: {
        kind: 'baton.run_timeline.page', runId: 'run-stream-client',
        channel: 'events', cursor: 'opaque-a',
        hasMore: true, items: [{ runId: 'run-stream-client', position: 1, kind: 'task.created' }],
      },
    },
    {
      schemaVersion: 1, runId: 'run-stream-client', depth: 'content', cursor: 8,
      terminal: true, content: {
        kind: 'baton.run_timeline.page', runId: 'run-stream-client',
        channel: 'events', cursor: 'opaque-b',
        hasMore: false, items: [{ runId: 'run-stream-client', position: 2, kind: 'run.stop_completed' }],
      },
    },
  ];
  const baton = bindBatonPort({ command: async (name, args) => {
    calls.push({ name, args });
    return pages.shift();
  } });
  const collected = [];
  for await (const event of baton.runs.open('run-stream-client').events()) collected.push(event);
  assert.deepEqual(collected.map((event) => event.position), [1, 2]);
  assert.deepEqual(calls, [
    { name: 'run.inspect', args: {
      runId: 'run-stream-client', depth: 'content', section: 'execution', item: 'execution:events',
    } },
    { name: 'run.inspect', args: {
      runId: 'run-stream-client', depth: 'content', section: 'execution',
      item: 'execution:events', pageCursor: 'opaque-a',
    } },
  ]);

  const outputCalls = [];
  const outputBaton = bindBatonPort({ command: async (name, args) => {
    outputCalls.push({ name, args });
    return {
      schemaVersion: 1, runId: 'run-output-client', depth: 'content', cursor: 2,
      terminal: true, content: {
        kind: 'baton.run_timeline.page', runId: 'run-output-client',
        channel: 'output', cursor: 'opaque-output',
        hasMore: false, items: [{ runId: 'run-output-client', recipient: 'review', contentTrust: 'untrusted_provider' }],
      },
    };
  } });
  const output = [];
  for await (const item of outputBaton.runs.open('run-output-client').output({ recipient: 'review' })) {
    output.push(item);
  }
  assert.equal(output[0].contentTrust, 'untrusted_provider');
  assert.equal(outputCalls[0].args.recipient, 'review');

  const crossed = bindBatonPort({ command: async () => ({
    schemaVersion: 1, runId: 'run-sibling', depth: 'content', cursor: 1, terminal: true,
    content: {
      kind: 'baton.run_timeline.page', runId: 'run-sibling', channel: 'events',
      cursor: 'opaque-crossed', hasMore: false, items: [],
    },
  }) }).runs.open('run-stream-client');
  await assert.rejects(async () => {
    for await (const event of crossed.events()) void event;
  }, (error) => error.code === 'application_client_protocol_invalid');
});

test('UA1/KC1: application profiles resolve a public harness through one exact private adapter route', async () => {
  const repo = root('public-private-route-repo');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase64@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 64'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = configuredAdapter({ outcome: 'completed', delayMs: 10, summary: 'done', files: {} });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(), harness: 'claude-code',
    modelSelection: {
      mode: 'exact', configuredDefault: 'kimi-k3', available: ['kimi-k3'], family: 'kimi',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['max'], effortRequired: true,
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-phase64', logDir: root('public-private-route-log'),
    adapters: { 'private-kimi-provider': adapter }, goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2000,
  });
  const publicProfile = {
    ...profile,
    routes: [{ harness: 'claude-code', model: 'kimi-k3', effort: 'max' }],
  };
  const application = new BatonApplication({
    driver, repoId: 'repo-phase64', profiles: { public: publicProfile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  const proposed = await application.start({
    runId: 'run-public-private-route', objective: 'prove public to private routing', profile: 'public',
    route: publicProfile.routes[0], scope: ['impl/**'],
  }, principal('owner'));
  assert.deepEqual(proposed.route.requested, publicProfile.routes[0]);
  await application.approve(proposed.runId, proposed.plan.digest, principal('approver'));
  assert.equal(driver.coordinator.list()[0].vendor, 'private-kimi-provider');
  await application.shutdown(principal('shutdown'));
});

test('WP9: profile v2 binds unattended full access through Plan, Brief, adapter options, and route identity', async () => {
  const repo = root('worker-policy-profile-repo');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase64@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 64'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const adapter = configuredAdapter({ outcome: 'completed', delayMs: 10, summary: 'done', files: {} });
  const originalCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...originalCard(),
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'launch', mechanisms: ['test-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'launch', mechanisms: ['test-full-access'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  const spawnCalls = [];
  const originalSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    spawnCalls.push({ worker, brief, options });
    return originalSpawn(worker, brief, options);
  };
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-phase64', logDir: root('worker-policy-profile-log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const policyProfile = { ...profile, schemaVersion: 2, workerPolicy: DEFAULT_WORKER_POLICY_REQUEST };
  const application = new BatonApplication({
    driver, repoId: 'repo-phase64', profiles: { full: policyProfile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  const proposed = await application.start({
    runId: 'run-worker-policy-profile', objective: 'prove durable worker policy', profile: 'full',
    route: policyProfile.routes[0], scope: ['impl/**'],
  }, principal('owner'));
  assert.deepEqual(application.card().profiles[0].workerPolicy, DEFAULT_WORKER_POLICY_REQUEST);
  assert.deepEqual(driver.coordination.snapshot().goalPlan.plans[0].nodes[0].workerPolicy, DEFAULT_WORKER_POLICY_REQUEST);
  const pendingOutline = await application.inspect({
    runId: proposed.runId, depth: 'outline',
  }, principal('observer'));
  assert.equal(pendingOutline.outline.workerPolicy.state, 'requested');
  assert.equal(pendingOutline.outline.workerPolicy.request.access.mode, 'full');
  await application.approve(proposed.runId, proposed.plan.digest, principal('approver'));
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0].brief.workerPolicy, DEFAULT_WORKER_POLICY_REQUEST);
  assert.equal(spawnCalls[0].options.workerPolicy.access.resolved, 'full');
  assert.equal(JSON.parse(driver.coordinator.list()[0].routeKey).length, 7);
  const activeOutline = await application.inspect({
    runId: proposed.runId, depth: 'outline',
  }, principal('observer'));
  assert.equal(activeOutline.outline.workerPolicy.access.resolved, 'full');
  assert.equal(activeOutline.outline.workerPolicy.containment.attestation, 'preferred_gap');
  const help = await application.help({
    topic: 'worker-policy', depth: 'outline', runId: proposed.runId,
  }, principal('observer'));
  assert.match(help.summary, /default is unattended full access/u);
  await application.wait(proposed.runId, principal('observer'), { timeoutMs: 2_000 });
  const evidence = await application.evidence(proposed.runId, principal('observer'));
  assert.equal(evidence.bindings.workerPolicy.access.resolved, 'full');
  await application.shutdown(principal('shutdown'));
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

test('UA3/UA4: a structured provider failure exposes no adoptable or exportable result', async () => {
  const { application, driver } = fixture('provider-failure', {
    scenario: { outcome: 'failed', delayMs: 10, summary: 'provider rejected the turn', files: {} },
  });
  const proposed = await application.start(intent({ runId: 'run-provider-failure' }), principal('failure-owner'));
  await application.approve('run-provider-failure', proposed.plan.digest, principal('failure-approver'));
  const failed = await application.wait('run-provider-failure', principal('failure-owner'), { timeoutMs: 5_000 });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.result, null);
  assert.equal(failed.nodes[0].state, 'failed');
  assert.equal(failed.nextActions.some((action) => ['adopt_result', 'export_result'].includes(action.kind)), false);
  const task = driver.coordination.snapshot().tasks.find((row) => row.runId === 'run-provider-failure');
  assert.equal(task.status, 'failed');
  assert.equal(driver.coordination.snapshot().artifacts.filter((artifact) => artifact.taskId === task.id)
    .some((artifact) => artifact.accepted === true), false);
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
  const run = bindBaton(application, principal('attention-owner')).runs.open('run-attention-redaction');
  const outline = await run.inspect();
  const answer = outline.outline.actions.find((action) => action.kind === 'answer_question');
  assert.equal(answer.target.requestId, view.attention[0].requestId);
  assert.equal(answer.target.question, '[credential-shaped content redacted]');
  assert.equal(JSON.stringify(answer).includes(secret), false);
  const answered = await run.act(answer.actionId, { text: 'Use the configured credential reference only.' });
  assert.equal(answered.outline.attention.count, 0);
  const finished = await application.wait('run-attention-redaction', principal('attention-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  const retry = await application.answer(
    'run-attention-redaction', view.attention[0].requestId, { text: 'Use the configured credential reference only.' },
    principal('attention-owner'),
  );
  assert.equal(retry.lastAction.result, 'already_resolved');
  await application.shutdown(principal('shutdown-admin'));
});

test('UA4/UA6: pending worker approvals are unique Run actions and need no raw request choreography', async () => {
  const { application } = fixture('approval-action', {
    scenario: {
      outcome: 'completed', delayMs: 1, summary: 'approval handled', files: {},
      ask: { kind: 'approval', question: 'Allow the bounded tool call?', blocking: true, afterEditIndex: 0 },
    },
  });
  const proposed = await application.start(intent({ runId: 'run-approval-action' }), principal('approval-owner'));
  await application.approve(proposed.runId, proposed.plan.digest, principal('approval-approver'));
  await application.wait(proposed.runId, principal('approval-owner'), { timeoutMs: 250 });
  const run = bindBaton(application, principal('approval-owner')).runs.open(proposed.runId);
  const outline = await run.inspect();
  const action = outline.outline.actions.find((candidate) => candidate.kind === 'answer_approval');
  assert.ok(action);
  assert.match(action.target.requestId, /^req_/u);
  assert.deepEqual(action.inputSchema.properties.decision.enum, ['allow', 'deny', 'cancel']);
  const answered = await run.act(action.actionId, { decision: 'allow' });
  assert.equal(answered.outline.attention.count, 0);
  const finished = await application.wait(proposed.runId, principal('approval-owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
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
  assert.deepEqual(card.commands, ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'run.recover', 'application.shutdown']);
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

test('RC1/P91: Pythonic send settles durably and interrupt is not advertised without reusable-session proof', async () => {
  const { application, driver } = fixture('semantic-control', { delayMs: 1_500 });
  const proposed = await application.start(
    intent({ runId: 'run-semantic-control' }), principal('control-owner'),
  );
  const running = await application.approve(
    proposed.runId, proposed.plan.digest, principal('control-approver'),
  );
  const workerId = running.ownership.workerIds[0];
  const run = bindBaton(application, principal('control-owner')).runs.open(proposed.runId);
  const outline = await run.inspect();
  const sendAction = outline.outline.actions.find((action) => action.kind === 'send');
  const interruptAction = outline.outline.actions.find((action) => action.kind === 'interrupt');
  assert.deepEqual(sendAction.choices, ['work']);
  assert.deepEqual(sendAction.target, { recipients: ['work'] });
  assert.equal(JSON.stringify(sendAction).includes(workerId), false);
  assert.equal(interruptAction, undefined);

  const sent = await run.send('Keep the verification boundary explicit.');
  assert.deepEqual(sent.lastAction, {
    command: 'run.send', recipient: 'work', delivery: 'nudge', result: 'ok',
    state: 'confirmed', emulated: false, deliveredDespiteStale: false,
    actualDelivery: 'nudge', sessionPreserved: false, continuation: null,
    onlyActiveMember: true, needsAttention: false,
  });
  const records = driver.coordination.events().filter((event) => (
    ['run.control_admitted', 'run.control_effect_started',
      'run.control_provider_acked', 'run.control_settled'].includes(event.kind)
  ));
  assert.deepEqual(records.map((event) => event.kind), [
    'run.control_admitted', 'run.control_effect_started',
    'run.control_provider_acked', 'run.control_settled',
  ]);
  assert.equal(records.every((event) => /^control:[a-f0-9]{64}$/u.test(event.payload.controlId)), true);
  assert.equal(driver.log.read(workerId).some((event) => event.kind === 'control.delivery_requested'
    && /^control:[a-f0-9]{64}$/u.test(event.payload.controlId)), true);
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 application: interrupt projects one paused attached member, then send resumes the same Plan task and completes normally', async () => {
  const { application, adapter, driver } = fixture('semantic-preserved-session', {
    scenario: {
      outcome: 'completed', summary: 'preserved session completed',
      edits: [{ path: 'impl/phase91.txt', content: 'same session\n', delayMs: 1_200 }],
    },
  });
  enablePreservedMockSession(adapter);
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };
  const proposed = await application.start(
    intent({ runId: 'run-semantic-preserved-session' }), principal('control-owner'),
  );
  const running = await application.approve(
    proposed.runId, proposed.plan.digest, principal('control-approver'),
  );
  const workerId = running.ownership.workerIds[0];
  await new Promise((resolve) => setImmediate(resolve));
  const before = driver.coordinator.list().find((worker) => worker.id === workerId);
  const taskCount = driver.coordination.snapshot().tasks.length;
  const run = bindBaton(application, principal('control-owner')).runs.open(proposed.runId);
  const initial = await run.inspect();
  assert.ok(initial.outline.actions.some((action) => action.kind === 'interrupt'));

  const interrupted = await run.interrupt({ reason: 'Pause only this provider turn.' });
  assert.deepEqual({
    phase: interrupted.phase,
    state: interrupted.lastAction.state,
    preserved: interrupted.lastAction.sessionPreserved,
    activeProviderTurns: interrupted.execution.activeProviderTurns,
    controllableAttachedMembers: interrupted.execution.controllableAttachedMembers,
  }, {
    phase: 'interrupted', state: 'confirmed', preserved: true,
    activeProviderTurns: 0, controllableAttachedMembers: 1,
  });
  assert.equal(driver.coordination.task(before.taskId).status, 'working');
  assert.equal(driver.coordination.runStop(proposed.runId), null);
  const interruptControl = driver.coordination.runControls(proposed.runId)[0];
  assert.equal(interruptControl.schemaVersion, 2);
  assert.equal(interruptControl.turnDisposition, 'preserve_turn');
  assert.equal(interruptControl.target.turnState, 'working');
  assert.equal(interruptControl.target.preservationReceiptDigest, null);
  assert.equal(interruptControl.target.sessionDigest, before.semanticControlBinding.sessionDigest);
  assert.equal(interruptControl.providerAck.outcome.preservation.state, 'preserved');
  assert.equal(driver.coordination.events().some((event) => event.kind === 'evidence.mapped'
    && event.payload.kind === 'control.interrupt_confirmed'), true);
  const paused = await run.inspect();
  assert.deepEqual(paused.outline.actions.map((action) => action.kind)
    .filter((kind) => ['send', 'interrupt', 'stop'].includes(kind)), ['send', 'stop']);

  const sent = await run.send('Continue and finish the same exact approved task.');
  assert.equal(sent.lastAction.actualDelivery, 'turn');
  assert.equal(sent.lastAction.continuation, 'admitted');
  assert.equal(spawnCalls, 1);
  assert.equal(driver.coordinator.list()[0].taskId, before.taskId);
  assert.deepEqual(driver.coordinator.list()[0].sessionRef, before.sessionRef);
  assert.equal(driver.coordinator.list()[0].worktree, before.worktree);
  assert.equal(driver.coordinator.list()[0].routeKey, before.routeKey);
  assert.equal(driver.coordination.snapshot().tasks.length, taskCount);
  const sendControl = driver.coordination.runControls(proposed.runId)[1];
  assert.equal(sendControl.schemaVersion, 2);
  assert.equal(sendControl.target.turnState, 'interrupted');
  assert.equal(sendControl.target.preservationReceiptDigest,
    interruptControl.providerAck.outcome.preservation.receiptDigest);
  assert.equal(sendControl.providerAck.outcome.actualDelivery, 'turn');
  assert.equal(sendControl.providerAck.outcome.continuation.state, 'admitted');

  const completed = await application.command(
    'run.wait', { runId: proposed.runId, timeoutMs: 5_000 }, principal('control-owner'),
  );
  assert.equal(completed.phase, 'work_completed');
  assert.equal(completed.nodes[0].state, 'accepted');
  assert.equal(completed.verification.state, 'mechanically_verified');
  assert.equal(completed.result.state, 'accepted');
  assert.equal(completed.evidence.some((artifact) => (
    artifact.kind === 'verification' && artifact.accepted === true
  )), true, 'the hub freshly verifies the resumed exact task before acceptance');
  assert.equal(driver.coordination.snapshot().tasks.length, taskCount);
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 application restart: coordinate-free recovery attach-only reuses the preserved member without a prompt', async () => {
  const first = fixture('phase91-application-restart', {
    scenario: {
      outcome: 'completed', summary: 'preserved restart completes',
      edits: [{ path: 'impl/restarted.txt', content: 'same native session\n', delayMs: 1_200 }],
    },
  });
  enablePreservedMockSession(first.adapter);
  const proposed = await first.application.start(
    intent({ runId: 'run-phase91-application-restart' }), principal('restart-owner'),
  );
  const running = await first.application.approve(
    proposed.runId, proposed.plan.digest, principal('restart-approver'),
  );
  const workerId = running.ownership.workerIds[0];
  const run = bindBaton(first.application, principal('restart-owner')).runs.open(proposed.runId);
  await run.inspect();
  await run.interrupt({ reason: 'Preserve for controller restart.' });
  const taskId = first.driver.coordinator.list()[0].taskId;
  const taskCount = first.driver.coordination.snapshot().tasks.length;
  first.driver.coordination.releaseWriterLease({ requireOwned: true });

  const resumedAdapter = configuredAdapter({
    outcome: 'completed', summary: 'preserved restart completes',
    edits: [{ path: 'impl/restarted.txt', content: 'same native session\n', delayMs: 1 }],
  });
  enablePreservedMockSession(resumedAdapter);
  const spawnOptions = [];
  let promptCalls = 0;
  const spawnResumed = resumedAdapter.spawn.bind(resumedAdapter);
  resumedAdapter.spawn = (worker, brief, opts) => {
    spawnOptions.push(opts);
    return spawnResumed(worker, brief, opts);
  };
  const promptResumed = resumedAdapter.prompt.bind(resumedAdapter);
  resumedAdapter.prompt = (...args) => {
    promptCalls += 1;
    return promptResumed(...args);
  };
  const resumedDriver = createDriver({
    repoRoot: first.repo,
    repoId: 'repo-phase64',
    logDir: first.logDir,
    adapters: { mock: resumedAdapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const restarted = reopenApplication(resumedDriver);
  await restarted.ready;
  const beforeRecovery = await restarted.status(proposed.runId, principal('restart-owner'));
  const contextVerdict = await resumedDriver.coordinator._worktrees.validateSessionContext(
    resumedDriver.coordinator.list()[0].sessionContext,
  );
  assert.equal(beforeRecovery.phase, 'interruption_uncertain', JSON.stringify({
    task: resumedDriver.coordination.task(taskId),
    handles: resumedDriver.coordinator.list(),
    attention: beforeRecovery.attention, contextVerdict,
  }));
  assert.deepEqual(contextVerdict, { ok: true });
  assert.deepEqual(beforeRecovery.nextActions, [{ kind: 'stop' }]);

  const recovered = await restarted.recover(proposed.runId, principal('restart-owner'));
  assert.equal(recovered.phase, 'interrupted', JSON.stringify({
    action: recovered.lastAction, recovery: recovered.recovery,
    handle: resumedDriver.coordinator.list()[0],
    task: resumedDriver.coordination.task(taskId),
  }));
  assert.deepEqual(recovered.lastAction, {
    command: 'run.recover', result: 'attached_preserved',
  });
  assert.deepEqual(recovered.recovery, {
    state: 'interrupted', reattachment: 'confirmed', attempt: 1,
    targetCount: 1, target: null, dispatchDisposition: 'attach_only',
    cleanup: { state: 'owned' },
  });
  assert.equal(spawnOptions.length, 1);
  assert.equal(spawnOptions[0].attachOnly, true);
  assert.equal(spawnOptions[0].session.mode, 'resume');
  assert.equal(spawnOptions[0].session.id, `mock-native-${workerId}`);
  assert.equal(promptCalls, 0, 'reattachment cannot admit a successor prompt');
  assert.equal(resumedDriver.coordinator.list()[0].taskId, taskId);
  assert.equal(resumedDriver.coordination.snapshot().tasks.length, taskCount);

  const resumedRun = bindBaton(restarted, principal('restart-owner')).runs.open(proposed.runId);
  const sent = await resumedRun.send('Continue the same Plan-bound task after restart.');
  assert.equal(sent.lastAction.actualDelivery, 'turn');
  assert.equal(promptCalls, 1);
  assert.equal(spawnOptions.length, 1);
  assert.equal(resumedDriver.coordinator.list()[0].taskId, taskId);
  assert.equal(resumedDriver.coordination.snapshot().tasks.length, taskCount);
  await restarted.shutdown(principal('shutdown-admin'));

  // The first controller is intentionally crash-simulated, so detach its in-memory mock wire
  // from durable authority and clear its long budget timer without emitting stale evidence.
  first.adapter.onEvent(() => {});
  await first.adapter.kill(workerId);
  await new Promise((resolve) => setTimeout(resolve, 40));
});

test('P91 application: process-close attachment uncertainty is quarantined with stop as the only safe action', async () => {
  const { application, adapter, driver } = fixture('phase91-unproven-attachment', {
    scenario: {
      outcome: 'completed', summary: 'attachment becomes unproven',
      edits: [{ path: 'impl/unproven.txt', content: 'unproven\n', delayMs: 1_200 }],
    },
  });
  enablePreservedMockSession(adapter);
  const proposed = await application.start(
    intent({ runId: 'run-phase91-unproven-attachment' }), principal('unproven-owner'),
  );
  await application.approve(
    proposed.runId, proposed.plan.digest, principal('unproven-approver'),
  );
  const run = bindBaton(application, principal('unproven-owner')).runs.open(proposed.runId);
  await run.inspect();
  await run.interrupt({ reason: 'Establish the preserved-session boundary.' });
  const internal = driver.coordinator._workers.get(driver.coordinator.list()[0].id);
  internal.status = 'exited';

  const quarantined = await application.status(proposed.runId, principal('unproven-owner'));
  assert.equal(quarantined.phase, 'interruption_uncertain');
  assert.deepEqual(quarantined.nextActions, [{ kind: 'stop' }]);
  assert.equal(quarantined.execution.activeProviderTurns, 0);
  assert.equal(quarantined.execution.controllableAttachedMembers, 0);
  assert.deepEqual(quarantined.attention.find((item) => item.kind === 'session_preservation'), {
    kind: 'session_preservation', state: 'quarantined',
    reason: 'session_attachment_unproven',
    summary: 'Reusable provider-session attachment is unproven; whole-Run stop is the only safe action.',
  });
  const stopped = await application.stop(
    proposed.runId, 'Reap the quarantined provider session.', principal('unproven-stopper'),
  );
  assert.equal(stopped.stop.receipt.remainingCount, 0);
  assert.equal(driver.coordinator.list()[0].status, 'dead');
  assert.equal(adapter._sessions.get(driver.coordinator.list()[0].id).terminal, true,
    'stop confirms the quarantined preserved transport is physically terminal');
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 application: a stop admitted after successor prompt acceptance maps to outcome_unknown and exactly reaps', async () => {
  const { application, adapter, driver } = fixture('phase91-post-prompt-stop', {
    scenario: {
      outcome: 'completed', summary: 'successor raced stop',
      edits: [{ path: 'impl/post-prompt-stop.txt', content: 'raced\n', delayMs: 1_200 }],
    },
  });
  enablePreservedMockSession(adapter);
  const proposed = await application.start(
    intent({ runId: 'run-phase91-post-prompt-stop' }), principal('race-owner'),
  );
  await application.approve(proposed.runId, proposed.plan.digest, principal('race-approver'));
  const run = bindBaton(application, principal('race-owner')).runs.open(proposed.runId);
  await run.inspect();
  await run.interrupt({ reason: 'Pause before the successor race.' });

  let promptObserved;
  let releasePrompt;
  const observed = new Promise((resolve) => { promptObserved = resolve; });
  const gate = new Promise((resolve) => { releasePrompt = resolve; });
  const prompt = adapter.prompt.bind(adapter);
  adapter.prompt = async (...args) => {
    const accepted = await prompt(...args);
    promptObserved();
    await gate;
    return accepted;
  };
  const sendPromise = run.send('This prompt is accepted before stop admission.');
  await observed;
  const stopPromise = application.stop(
    proposed.runId, 'Stop after prompt acceptance.', principal('race-stopper'),
  );
  for (let attempt = 0; attempt < 200
    && !driver.coordination.runStop(proposed.runId); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(driver.coordination.runStop(proposed.runId), 'stop must be admitted before prompt return');
  releasePrompt();
  const [sent, stopped] = await Promise.all([sendPromise, stopPromise]);

  assert.equal(sent.lastAction.state, 'outcome_unknown');
  assert.equal(sent.lastAction.deliveredDespiteStale, true);
  assert.equal(sent.lastAction.actualDelivery, 'turn');
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.receipt.remainingCount, 0);
  assert.equal(driver.coordination.runControls(proposed.runId).at(-1).status, 'outcome_unknown');
  assert.equal(driver.coordinator.list()[0].status, 'dead');
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 blocked Application: interaction resolution precedes admission and binds the resulting task generation', async () => {
  const { application, adapter, driver } = fixture('phase91-blocked-admission', {
    scenario: {
      outcome: 'completed', summary: 'blocked turn',
      ask: { kind: 'approval', question: 'May the provider continue?', afterEditIndex: 0 },
    },
  });
  enablePreservedMockSession(adapter);
  let approvalDeliveries = 0;
  const approve = adapter.approve.bind(adapter);
  adapter.approve = (...args) => { approvalDeliveries += 1; return approve(...args); };
  const proposed = await application.start(
    intent({ runId: 'run-phase91-blocked-admission' }), principal('blocked-owner'),
  );
  const running = await application.approve(
    proposed.runId, proposed.plan.digest, principal('blocked-approver'),
  );
  const workerId = running.ownership.workerIds[0];
  for (let attempt = 0; attempt < 200
    && driver.coordinator.list()[0]?.status !== 'blocked'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(driver.coordinator.list()[0].status, 'blocked');
  const versionBefore = driver.coordination.task(driver.coordinator.list()[0].taskId).version;
  const run = bindBaton(application, principal('blocked-owner')).runs.open(proposed.runId);
  await run.inspect();
  const interrupted = await run.interrupt({ reason: 'End only the blocked provider turn.' });
  assert.equal(interrupted.phase, 'interrupted');
  assert.equal(approvalDeliveries, 0, 'supersession is local authority; the interrupt ends the wire turn');

  const events = driver.coordination.events();
  const resolution = events.find((event) => event.kind === 'evidence.mapped'
    && event.payload.kind === 'control.interaction_superseded');
  const admission = events.find((event) => event.kind === 'run.control_admitted');
  assert.ok(resolution && admission && resolution.seq < admission.seq);
  const task = driver.coordination.task(driver.coordinator.list()[0].taskId);
  assert.ok(task.version > versionBefore);
  const control = driver.coordination.runControls(proposed.runId)[0];
  assert.equal(control.target.runAuthorityDigest,
    driver.coordinator.list()[0].sessionPreservation.runAuthorityDigest);
  assert.equal(task.status, 'working');
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 binding: task-version-only drift before effect settles refused without a provider call', async () => {
  const { application, adapter, driver } = fixture('phase91-pre-effect-drift', {
    scenario: {
      outcome: 'completed', summary: 'drift target',
      edits: [{ path: 'impl/drift.txt', content: 'drift\n', delayMs: 1_000 }],
    },
  });
  const proposed = await application.start(
    intent({ runId: 'run-phase91-pre-effect-drift' }), principal('drift-owner'),
  );
  const running = await application.approve(
    proposed.runId, proposed.plan.digest, principal('drift-approver'),
  );
  const workerId = running.ownership.workerIds[0];
  let promptCalls = 0;
  const prompt = adapter.prompt.bind(adapter);
  adapter.prompt = (...args) => { promptCalls += 1; return prompt(...args); };
  const admit = driver.coordination.admitRunControl.bind(driver.coordination);
  driver.coordination.admitRunControl = (...args) => {
    const admitted = admit(...args);
    const task = driver.coordinator._tasks.get(driver.coordinator.list()[0].taskId);
    driver.coordinator._coordTransition(
      task, 'input_required', `phase91.version-drift.blocked:${task.id}`,
    );
    task.status = 'input_required';
    driver.coordinator._coordTransition(
      task, 'working', `phase91.version-drift.working:${task.id}`,
    );
    task.status = 'working';
    return admitted;
  };
  const run = bindBaton(application, principal('drift-owner')).runs.open(proposed.runId);
  await run.inspect();
  const result = await run.send('This must not cross a drifted target.');
  assert.equal(result.lastAction.state, 'refused');
  assert.equal(result.lastAction.result, 'semantic_target_drift');
  assert.equal(promptCalls, 0);
  assert.equal(driver.coordination.events()
    .some((event) => event.kind === 'run.control_effect_started'), false);
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 binding: non-fence drift after effect start is refused again in the serialized delivery slot', async () => {
  const { application, adapter, driver } = fixture('phase91-delivery-slot-drift', {
    scenario: {
      outcome: 'completed', summary: 'slot drift target',
      edits: [{ path: 'impl/slot-drift.txt', content: 'drift\n', delayMs: 1_000 }],
    },
  });
  const proposed = await application.start(
    intent({ runId: 'run-phase91-delivery-slot-drift' }), principal('slot-owner'),
  );
  const running = await application.approve(
    proposed.runId, proposed.plan.digest, principal('slot-approver'),
  );
  const workerId = running.ownership.workerIds[0];
  let promptCalls = 0;
  const prompt = adapter.prompt.bind(adapter);
  adapter.prompt = (...args) => { promptCalls += 1; return prompt(...args); };
  const begin = driver.coordination.beginRunControlEffect.bind(driver.coordination);
  driver.coordination.beginRunControlEffect = (...args) => {
    const started = begin(...args);
    driver.coordinator._workers.get(workerId).processGeneration += 1;
    return started;
  };
  const run = bindBaton(application, principal('slot-owner')).runs.open(proposed.runId);
  await run.inspect();
  const result = await run.send('The slot must recheck every v2 binding field.');
  assert.equal(result.lastAction.state, 'refused');
  assert.equal(result.lastAction.result, 'semantic_target_drift');
  assert.equal(promptCalls, 0);
  assert.equal(driver.coordination.events()
    .filter((event) => event.kind === 'run.control_effect_started').length, 1);
  await application.shutdown(principal('shutdown-admin'));
});

test('P91 response loss: preserved interrupt and successor replay from evidence without redelivery', async () => {
  const { application, adapter, driver } = fixture('phase91-preserved-response-loss', {
    scenario: {
      outcome: 'completed', summary: 'response-loss continuation completed',
      edits: [{ path: 'impl/response-loss.txt', content: 'done\n', delayMs: 1_000 }],
    },
  });
  enablePreservedMockSession(adapter);
  let interruptCalls = 0;
  const interrupt = adapter.interrupt.bind(adapter);
  adapter.interrupt = (...args) => { interruptCalls += 1; return interrupt(...args); };
  let promptCalls = 0;
  const prompt = adapter.prompt.bind(adapter);
  adapter.prompt = (...args) => { promptCalls += 1; return prompt(...args); };
  const proposed = await application.start(
    intent({ runId: 'run-phase91-preserved-response-loss' }), principal('loss-owner'),
  );
  await application.approve(proposed.runId, proposed.plan.digest, principal('loss-approver'));
  const run = bindBaton(application, principal('loss-owner')).runs.open(proposed.runId);
  await run.inspect();
  const acknowledge = driver.coordination.acknowledgeRunControl.bind(driver.coordination);
  driver.coordination.acknowledgeRunControl = () => {
    throw Object.assign(new Error('response lost after interrupt confirmation'), { code: 'response_lost' });
  };
  await assert.rejects(run.interrupt({ reason: 'Preserve despite response loss.' }),
    (error) => error.code === 'response_lost');
  driver.coordination.acknowledgeRunControl = acknowledge;
  const afterInterruptRestart = reopenApplication(driver);
  await afterInterruptRestart.ready;
  assert.equal(interruptCalls, 1);
  assert.equal(driver.coordination.runControls(proposed.runId)[0].status, 'confirmed');

  const resumedRun = bindBaton(afterInterruptRestart, principal('loss-owner'))
    .runs.open(proposed.runId);
  const paused = await resumedRun.inspect();
  assert.equal(paused.outline.phase, 'interrupted');
  driver.coordination.acknowledgeRunControl = () => {
    throw Object.assign(new Error('response lost after successor acceptance'), { code: 'response_lost' });
  };
  await assert.rejects(resumedRun.send('Resume exactly once after response loss.'),
    (error) => error.code === 'response_lost');
  driver.coordination.acknowledgeRunControl = acknowledge;
  const afterSendRestart = reopenApplication(driver);
  await afterSendRestart.ready;
  assert.equal(promptCalls, 1);
  assert.deepEqual(driver.coordination.runControls(proposed.runId)
    .map((control) => control.status), ['confirmed', 'confirmed']);
  await afterSendRestart.shutdown(principal('shutdown-admin'));
});

test('P91 compatibility: schema-v1 outcomes retain the Phase90 replay shape', async () => {
  const { application } = fixture('phase91-v1-outcome-shape');
  assert.deepEqual(application._normalizeRunControlOutcome({
    result: 'ok', code: null, emulated: false, deliveredDespiteStale: false,
    actualDelivery: 'turn', preservation: { state: 'preserved' },
  }, 1), {
    result: 'ok', code: null, emulated: false, deliveredDespiteStale: false,
  });
  await application.shutdown(principal('shutdown-admin'));
});

test('RC2: a post-boundary send exception settles outcome_unknown and is never reported as success', async () => {
  const { application, adapter, driver } = fixture('semantic-control-unknown', { delayMs: 1_500 });
  const proposed = await application.start(
    intent({ runId: 'run-semantic-control-unknown' }), principal('control-owner'),
  );
  await application.approve(proposed.runId, proposed.plan.digest, principal('control-approver'));
  adapter.prompt = async () => { throw Object.assign(new Error('wire acknowledgement lost'), { code: 'wire_lost' }); };
  const run = bindBaton(application, principal('control-owner')).runs.open(proposed.runId);
  await run.inspect();
  const result = await run.send('Recheck the current implementation boundary.');
  assert.equal(result.lastAction.state, 'outcome_unknown');
  assert.equal(result.lastAction.result, 'provider_outcome_unknown');
  const settlement = driver.coordination.events()
    .findLast((event) => event.kind === 'run.control_settled');
  assert.equal(settlement.payload.state, 'outcome_unknown');
  assert.equal(settlement.payload.outcome.code, 'provider_boundary_observed');
  assert.equal(driver.log.read(driver.coordinator.list()[0].id)
    .filter((event) => event.kind === 'control.delivery_requested').length, 1);
  await application.shutdown(principal('shutdown-admin'));
});

test('RC3: response-loss replay returns the durable semantic outcome without a second provider call', async () => {
  const { application, adapter, driver } = fixture('semantic-control-replay', { delayMs: 1_500 });
  const proposed = await application.start(
    intent({ runId: 'run-semantic-control-replay' }), principal('control-owner'),
  );
  await application.approve(proposed.runId, proposed.plan.digest, principal('control-approver'));
  const outline = await application.inspect({
    runId: proposed.runId, depth: 'outline',
  }, principal('control-owner'));
  const action = outline.outline.actions.find((candidate) => candidate.kind === 'send');
  const prompt = adapter.prompt.bind(adapter);
  let promptCalls = 0;
  adapter.prompt = (...args) => { promptCalls += 1; return prompt(...args); };
  const args = {
    runId: proposed.runId,
    actionId: action.actionId,
    inputs: { message: 'Preserve the same provider effect.', recipient: 'work', delivery: 'nudge' },
  };
  const context = { transport: 'web', requestId: 'lost-response', idempotencyKey: 'web.command:lost-response' };
  const first = await application.command('run.act', args, principal('control-owner'), context);
  const replay = await application.command('run.act', args, principal('control-owner'), context);
  assert.equal(first.lastAction.state, 'confirmed');
  assert.deepEqual(replay.lastAction, first.lastAction);
  assert.equal(promptCalls, 1);
  const records = driver.coordination.events().filter((event) => (
    ['run.control_admitted', 'run.control_effect_started',
      'run.control_provider_acked', 'run.control_settled'].includes(event.kind)
  ));
  assert.equal(records.length, 4);
  await application.shutdown(principal('shutdown-admin'));
});

test('RC4: restart after admission but before effect starts performs the provider call exactly once', async () => {
  const { application, adapter, driver } = fixture('semantic-control-admission-crash', { delayMs: 1_500 });
  const proposed = await application.start(
    intent({ runId: 'run-semantic-control-admission-crash' }), principal('control-owner'),
  );
  await application.approve(proposed.runId, proposed.plan.digest, principal('control-approver'));
  const run = bindBaton(application, principal('control-owner')).runs.open(proposed.runId);
  await run.inspect();
  const prompt = adapter.prompt.bind(adapter);
  let promptCalls = 0;
  adapter.prompt = (...args) => { promptCalls += 1; return prompt(...args); };
  const begin = driver.coordination.beginRunControlEffect.bind(driver.coordination);
  driver.coordination.beginRunControlEffect = () => {
    throw Object.assign(new Error('crash before effect start'), { code: 'injected_crash' });
  };
  await assert.rejects(run.send('Resume this exact admitted delivery.'),
    (error) => error.code === 'injected_crash');
  assert.equal(promptCalls, 0);
  driver.coordination.beginRunControlEffect = begin;

  const recovered = reopenApplication(driver);
  await recovered.ready;
  assert.equal(promptCalls, 1);
  assert.equal(driver.coordination.runControls(proposed.runId)[0].status, 'confirmed');
  await recovered.shutdown(principal('shutdown-admin'));
});

test('RC5: restart after provider acknowledgement settles without redelivery', async () => {
  const { application, adapter, driver } = fixture('semantic-control-ack-crash', { delayMs: 1_500 });
  const proposed = await application.start(
    intent({ runId: 'run-semantic-control-ack-crash' }), principal('control-owner'),
  );
  await application.approve(proposed.runId, proposed.plan.digest, principal('control-approver'));
  const run = bindBaton(application, principal('control-owner')).runs.open(proposed.runId);
  await run.inspect();
  const prompt = adapter.prompt.bind(adapter);
  let promptCalls = 0;
  adapter.prompt = (...args) => { promptCalls += 1; return prompt(...args); };
  const settle = driver.coordination.settleRunControl.bind(driver.coordination);
  driver.coordination.settleRunControl = () => {
    throw Object.assign(new Error('crash after provider acknowledgement'), { code: 'injected_crash' });
  };
  await assert.rejects(run.send('Do not redeliver after acknowledgement.'),
    (error) => error.code === 'injected_crash');
  assert.equal(promptCalls, 1);
  assert.equal(driver.coordination.runControls(proposed.runId)[0].status, 'provider_acked');
  driver.coordination.settleRunControl = settle;

  const recovered = reopenApplication(driver);
  await recovered.ready;
  assert.equal(promptCalls, 1);
  assert.equal(driver.coordination.runControls(proposed.runId)[0].status, 'confirmed');
  await recovered.shutdown(principal('shutdown-admin'));
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
