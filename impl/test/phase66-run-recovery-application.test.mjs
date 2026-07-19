import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  BatonApplication,
  CoordinationStore,
  Coordinator,
  McpFleetServer,
  parseBatonCli,
  validateApplicationCommandArgs,
} from '../src/index.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase66-run-recovery-${name}-`));
const repoId = 'repo-phase66-run-recovery';
const runId = 'run-phase66-run-recovery';
const workerId = 'worker-phase66-run-recovery';
const route = Object.freeze({ vendor: 'session', model: 'model-a', effort: 'low' });
const applicationRoute = Object.freeze({ harness: 'session', model: 'model-a', effort: 'low' });
const recoveryPolicy = Object.freeze({
  mode: 'manual',
  maxAttempts: 2,
  timeoutMs: 5_000,
  eligibleSessionModes: ['resume'],
  ambiguousDispatch: 'operator_required',
});
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['code', 'native_session_recovery', 'test'],
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
const baseProfile = Object.freeze({
  schemaVersion: 1,
  repoId,
  definitionOfDone: ['the approved Run work is mechanically verified'],
  constraints: ['Keep recovery inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 8 },
  nodeBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification,
  routes: [applicationRoute],
  capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
});
const requestedProfile = Object.freeze({ ...baseProfile, recoveryPolicy });
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });
const budget = () => ({ tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 4 });
const storeAuth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId, repoId, runId, key,
  sessionDigest: digest({ principalId, session: `${principalId}-session` }),
});

function gate(goal, plan, nodeKey) {
  const node = plan.nodes.find((candidate) => candidate.key === nodeKey);
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey, expectedDispatchVersion: 0,
    capabilities: [...node.capabilities], effects: [...node.effects],
  };
}

function routeCard() {
  return {
    harness: 'session', version: 'phase66', authPosture: 'none', concurrencyCeiling: 4, maxContext: 100_000,
    verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
    sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'test',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  };
}

function planFixture(store, profileDigest) {
  const definitionOfDone = ['the approved Run work is mechanically verified'];
  const goal = store.defineGoal({
    objective: 'Complete one recoverable application Run',
    definitionOfDone,
    constraints: [
      'Keep recovery inside the approved repository scope',
      `Baton deployment profile recoverable@${profileDigest}`,
    ],
    risk: 'high',
    budget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 8 },
    predecessor: null,
  }, storeAuth('goal-owner', 'goal:recoverable')).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [
      {
        key: 'work', objective: 'Complete one recoverable application Run', definitionOfDone,
        deps: [], pathScope: ['impl/**'], risk: 'high', budget: budget(), verification,
        routes: { harnesses: ['session'], models: ['model-a'], efforts: ['low'] },
        capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
      },
      {
        key: 'recover', objective: 'Recover the exact approved native session', definitionOfDone,
        deps: ['work'], pathScope: ['impl/**'], risk: 'high', budget: budget(),
        verification: { ...verification, requiredPredecessorEvidence: ['work'] },
        routes: { harnesses: ['session'], models: ['model-a'], efforts: ['low'] },
        capabilities: ['code', 'native_session_recovery', 'test'], effects: ['provider_call', 'repository_edit'],
      },
    ],
  }, storeAuth('planner', 'plan:recoverable')).plan;
  const approval = store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, storeAuth('approver', 'approval:recoverable')).approval;
  return { goal, plan, approval, workGate: gate(goal, plan, 'work'), recoveryGate: gate(goal, plan, 'recover') };
}

function claimAndVerifyPrior(store, planState, operational, id = 'prior-plan-task') {
  const preview = store.previewPlanDispatch(planState.workGate, route);
  store.createPlanGatedTask({
    id, brief: preview.brief, deps: [], refines: null, runId, taskType: 'general', reservedWorkerId: workerId,
    vendorRequested: 'session', modelRequested: 'model-a', modelPolicy: null,
    effortRequested: 'low', effortResolved: null, effortObserved: null, routeKey: null,
    sessionRequest: { mode: 'new' },
  }, planState.workGate, route, storeAuth('dispatcher', 'plan.dispatch:work'));
  store.claimTask(id, workerId, 1, { actor: 'orchestrator', key: `task.claimed:${id}` }, {
    harnessRequested: 'session', harnessResolved: 'session@phase66',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["session","phase66","model-a","low"]',
  });
  const verified = {
    worker: workerId, seq: 1, ts: '2026-07-14T01:00:01.000Z', kind: 'verify.reverified',
    actor: 'policy', taskId: id, payload: { accept: true, verdict: { ok: true } },
  };
  operational.set(`${workerId}:1`, verified);
  const evidence = store.mapOperationalEvent(verified, { actor: 'policy', key: `evidence:${id}:verified` }).evidence;
  store.transitionTask(id, 'completed', 2, { actor: 'policy', key: `task.completed:${id}` }, evidence);
  return store.task(id);
}

function cardDriver() {
  return {
    coordination: {
      pendingRunResultAdoptions: () => [], pendingRunStops: () => [], snapshot: () => ({ goalPlan: { goals: [], plans: [], approvals: [], dispatches: [] } }),
      runResultAdoption: () => null, completeRunResultAdoption: () => null,
      runStop: () => null, completeRunStop: () => null,
    },
    coordinator: {
      routeCards: () => [{ name: 'session', card: routeCard() }], list: () => [],
      stopRunTargets: async () => ({ targetCount: 0 }), preserveResult: async () => null,
    },
    story: { snapshot: () => ({ workers: {} }) },
    drainAndClose: async () => ({ state: 'drained' }),
  };
}

test('CE1/CE6: registry exposes strict stateful run.recover(runId) and accepts no worker/session/route coordinates', () => {
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['run.recover'], {
    args: ['runId'], capabilities: ['control', 'observe'], web: true, mcp: true,
    mcpStateful: true, reconcilable: true,
  });
  assert.equal(validateApplicationCommandArgs('run.recover', { runId }), true);
  for (const extra of [
    { workerId }, { sessionId: 'native-session' }, { route: applicationRoute },
    { timeoutMs: 1 }, { attempt: 1 }, { context: { worktree: '/tmp/substitution' } },
  ]) {
    assert.throws(
      () => validateApplicationCommandArgs('run.recover', { runId, ...extra }),
      (error) => error.code === 'application_command_invalid',
    );
  }
});

test('CE2: recovery policy is closed, deployment-owned, digest-bound, and visible in the application card', async () => {
  const application = new BatonApplication({
    driver: cardDriver(), repoId, profiles: { recoverable: requestedProfile },
    principals: {
      planner: principal('application-planner'), dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  const card = application.card();
  assert.equal(card.commands.includes('run.recover'), true);
  const projected = card.profiles.find((candidate) => candidate.name === 'recoverable');
  assert.deepEqual(projected.recoveryPolicy, {
    mode: recoveryPolicy.mode,
    eligibleSessionModes: recoveryPolicy.eligibleSessionModes,
    ambiguousDispatch: recoveryPolicy.ambiguousDispatch,
  });
  assert.equal(Object.hasOwn(projected.recoveryPolicy, 'maxAttempts'), false);
  assert.equal(Object.hasOwn(projected.recoveryPolicy, 'timeoutMs'), false);
  assert.match(projected.digest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(projected).includes('native-session'), false);
});

test('CE2b: durable Run-control history without its complete recovery authority fails application readiness closed', async () => {
  const driver = cardDriver();
  driver.coordination.events = () => [{ seq: 1, kind: 'run.control_admitted', payload: {} }];
  const application = new BatonApplication({
    driver, repoId, profiles: { recoverable: requestedProfile },
    principals: {
      planner: principal('application-planner'), dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  await assert.rejects(application.ready, (error) => error.code === 'application_config_invalid');
});

function applicationFixture(name, {
  handles = null, authorize = async () => true, outcomeAttempt = 1,
} = {}) {
  const operational = new Map();
  const store = new CoordinationStore(root(`${name}-store`), {
    goalPlanPolicy,
    operationalRead: (worker, seq) => operational.get(`${worker}:${seq}`) ?? null,
    clock: () => '2026-07-14T01:00:00.000Z',
  });
  const calls = [];
  const selectedHandles = handles ?? [{
    id: workerId, taskId: 'prior-plan-task', runId, status: 'orphaned', vendor: 'session',
    sessionRef: { id: 'native-session-phase66', persistence: 'native' },
    sessionContext: { worktree: '/tmp/phase66-recovery-worktree', ownerTaskId: 'prior-plan-task' },
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low', processGeneration: 1,
  }];
  let state;
  const coordinator = {
    routeCards: () => [{ name: 'session', card: routeCard() }],
    list: () => selectedHandles.map((handle) => ({ ...handle })),
    async goalPlanStatus(fields) { return store.goalPlanStatus(fields, { repoId, runId }); },
    async result() {
      return {
        ready: true, status: 'completed', harnessResolved: 'session@phase66',
        modelResolved: 'model-a', modelObserved: 'model-a', effortResolved: 'low', effortObserved: 'low',
        verdict: { accepted: true }, integration: null,
      };
    },
    async recoverPlanBound(selectedWorkerId, request) {
      calls.push({ selectedWorkerId, request });
      const handle = selectedHandles.find((candidate) => candidate.id === selectedWorkerId);
      const preview = store.previewPlanDispatch(state.recoveryGate, route);
      const created = store.createAndClaimPlanRecoveryRefinement({
        id: 'recovery-plan-task', brief: preview.brief, deps: preview.resolvedDeps,
        refines: 'prior-plan-task', runId, taskType: 'general', reservedWorkerId: workerId,
        vendorRequested: 'session', modelRequested: 'model-a', modelPolicy: null, effortRequested: 'low',
        sessionRequest: { mode: 'resume', id: handle.sessionRef.id, context: handle.sessionContext },
        relation: 'recovery',
      }, request.gate, route, {
        harnessRequested: 'session', harnessResolved: 'session@phase66',
        modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
        effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
        routeKey: '["session","phase66","model-a","low"]',
      }, {
        actor: request.actor, principalId: 'application-dispatcher', repoId, runId,
        key: `application:${runId}:recovery:1`,
      });
      handle.taskId = created.task.id;
      handle.processGeneration = 2;
      handle.status = 'working';
      return {
        ok: true, result: 'attached', workerId: selectedWorkerId, taskId: created.task.id,
        attempt: outcomeAttempt, dispatchDisposition: 'dispatch_accepted', processGeneration: 2,
        route: {
          requested: applicationRoute,
          resolved: { harness: 'session@phase66', model: 'model-a', effort: 'low' },
          observed: { harness: 'session@phase66', model: 'model-a', effort: 'low' },
        },
        cleanup: { state: 'owned' },
      };
    },
    stopRunTargets: async () => ({ targetCount: 0 }),
    preserveResult: async () => null,
    wait: async () => ({}),
  };
  const driver = {
    coordination: store, coordinator,
    story: { snapshot: () => ({ workers: {} }) },
    drainAndClose: async () => ({ state: 'drained' }),
  };
  const authorizations = [];
  const application = new BatonApplication({
    driver, repoId, profiles: { recoverable: baseProfile },
    principals: {
      planner: principal('application-planner'), dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async (request) => { authorizations.push(request); return authorize(request); },
  });
  const normalized = application.profiles.get('recoverable');
  const { digest: _priorDigest, ...profileCore } = normalized;
  const recoveryProfile = Object.freeze({ ...profileCore, recoveryPolicy, digest: digest({ ...profileCore, recoveryPolicy }) });
  application.profiles.set('recoverable', recoveryProfile);
  state = planFixture(store, recoveryProfile.digest);
  claimAndVerifyPrior(store, state, operational);
  return { application, authorizations, calls, coordinator, driver, handles: selectedHandles, operational, state, store };
}

test('CE6/CE8: application authorizes before effects and zero/ambiguous selection returns operator truth without leaking coordinates', async () => {
  const denied = applicationFixture('denied', { authorize: async ({ command }) => command !== 'run.recover' });
  await denied.application.ready;
  await assert.rejects(
    denied.application.recover(runId, principal('operator')),
    (error) => error.code === 'application_unauthorized',
  );
  assert.equal(denied.calls.length, 0);
  assert.equal(denied.store.events().some((event) => event.batch?.kind === 'goal_plan_recovery_dispatch'), false);

  const zero = applicationFixture('zero', { handles: [] });
  await zero.application.ready;
  const unavailable = await zero.application.recover(runId, principal('operator'));
  assert.equal(unavailable.lastAction.command, 'run.recover');
  assert.equal(unavailable.lastAction.result, 'unavailable');
  assert.deepEqual(unavailable.recovery, {
    state: 'unavailable', reason: 'no_eligible_target', attempt: 0,
    targetCount: 0, target: null, dispatchDisposition: null,
  });
  assert.equal(zero.calls.length, 0);

  const ambiguousSeed = applicationFixture('ambiguous-seed');
  await ambiguousSeed.application.ready;
  const ambiguousHandles = [
    ...ambiguousSeed.handles,
    {
      id: 'worker-phase66-run-recovery-duplicate', taskId: 'prior-plan-task', runId, status: 'orphaned', vendor: 'session',
      sessionRef: { id: 'other-native-session', persistence: 'native' },
      sessionContext: { worktree: '/tmp/other-phase66-recovery-worktree', ownerTaskId: 'prior-plan-task' },
      modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
      effortRequested: 'low', effortResolved: 'low', effortObserved: 'low', processGeneration: 1,
    },
  ];
  const ambiguous = applicationFixture('ambiguous', { handles: ambiguousHandles });
  await ambiguous.application.ready;
  const operatorRequired = await ambiguous.application.recover(runId, principal('operator'));
  assert.equal(operatorRequired.lastAction.result, 'operator_required');
  assert.equal(operatorRequired.recovery.state, 'operator_required');
  assert.equal(operatorRequired.recovery.reason, 'multiple_eligible_targets');
  assert.equal(operatorRequired.recovery.targetCount, 2);
  assert.equal(ambiguous.calls.length, 0);
  assert.equal(JSON.stringify(operatorRequired).includes('other-native-session'), false);
});

test('CE6-CE8: one eligible orphan is server-selected, admitted once, and projected with exact recovery truth', async () => {
  const f = applicationFixture('success');
  await f.application.ready;
  const view = await f.application.command('run.recover', { runId }, principal('operator'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].selectedWorkerId, workerId);
  assert.deepEqual(Object.keys(f.calls[0].request).sort(), [
    'actor', 'gate', 'maxAttempts', 'profileDigest', 'recoveryPolicyDigest', 'runId', 'timeoutMs',
  ]);
  assert.equal(f.calls[0].request.runId, runId);
  assert.equal(f.calls[0].request.gate.nodeKey, 'recover');
  assert.equal(f.calls[0].request.timeoutMs, recoveryPolicy.timeoutMs);
  assert.equal(f.calls[0].request.maxAttempts, recoveryPolicy.maxAttempts);
  assert.equal(Object.hasOwn(f.calls[0].request, 'attempt'), false);
  assert.equal(f.authorizations.findIndex((row) => row.command === 'run.recover') >= 0, true);
  assert.deepEqual(f.store.events().filter((event) => event.batch?.kind === 'goal_plan_recovery_dispatch')
    .map((event) => event.kind), ['plan.node_dispatched', 'task.created', 'task.claimed']);
  assert.equal(view.lastAction.command, 'run.recover');
  assert.equal(view.lastAction.result, 'attached');
  assert.equal(view.recovery.state, 'working');
  assert.equal(view.recovery.attempt, 1);
  assert.equal(view.recovery.target.workerId, workerId);
  assert.equal(view.recovery.target.taskId, 'recovery-plan-task');
  assert.equal(view.recovery.dispatchDisposition, 'dispatch_accepted');
  assert.equal(view.recovery.processGeneration, 2);
  assert.deepEqual(view.recovery.route.requested, applicationRoute);
  assert.equal(view.recovery.cleanup.state, 'owned');
  assert.equal(JSON.stringify(view.recovery).includes('native-session-phase66'), false);
});

test('CE2/CE8: application delegates attempt derivation and the ceiling to durable Coordinator authority', async () => {
  const retry = applicationFixture('durable-second-attempt', { outcomeAttempt: 2 });
  await retry.application.ready;
  // Generic driver testimony is not attempt authority. Only the dedicated Coordinator/store
  // protocol may derive the head and enforce the deployment-owned ceiling.
  retry.store.recordDriver('recovery.requested', {
    taskId: 'prior-plan-task', workerId, runId, attempt: 1,
  }, { actor: 'direct:operator', key: 'recovery.requested:prior:1' });
  const retried = await retry.application.recover(runId, principal('operator'));
  assert.equal(Object.hasOwn(retry.calls[0].request, 'attempt'), false);
  assert.equal(retry.calls[0].request.maxAttempts, recoveryPolicy.maxAttempts);
  assert.equal(retried.recovery.attempt, 2);
});

test('CE6/CE8: admitted Run stop fences public recovery before Coordinator attach authority', async () => {
  const f = applicationFixture('stop');
  await f.application.ready;
  const reasonDigest = digest({ reason: 'operator stopped the Run' });
  f.store.admitRunStop({
    schemaVersion: 1, repoId, runId, reasonDigest,
    requestDigest: digest({ repoId, runId, reasonDigest }),
  }, { actor: 'direct:operator', key: `run.stop:${runId}` });
  await assert.rejects(
    f.application.recover(runId, principal('operator')),
    (error) => error.code === 'application_run_stopping',
  );
  assert.equal(f.calls.length, 0);
});

function nativeAdapter() {
  const calls = { spawn: [], prompt: [], kill: [] };
  return {
    calls, callback: null,
    onEvent(callback) { this.callback = callback; },
    card: routeCard,
    emit(worker, kind, payload = {}) {
      this.callback?.({ worker, harness: 'session@phase66', turnEpoch: 1, actor: 'worker', kind, payload });
    },
    async spawn(...args) { calls.spawn.push(args); return { ok: true }; },
    async prompt(...args) { calls.prompt.push(args); return { ok: true }; },
    async promptBrief(worker, brief) { calls.prompt.push([worker, brief, 'turn']); return { ok: true }; },
    async steer() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; }, async answer() { return { ok: true }; },
    async kill(worker) { calls.kill.push(worker); this.emit(worker, 'kill.confirmed', {}); return { ok: true }; },
  };
}

async function until(fn, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

async function coordinatorFixture() {
  const log = new Log(root('coordinator-log'));
  const store = new CoordinationStore(root('coordinator-store'), {
    goalPlanPolicy,
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  const state = planFixture(store, 'a'.repeat(64));
  const worktree = root('coordinator-worktree');
  const initial = nativeAdapter();
  const worktrees = {
    create: async () => ({ path: worktree, branch: 'baton/prior-plan-task', baseSha: 'base-sha' }),
    capture: async () => ({ sha: 'captured-sha', snapshotted: false }),
    createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
    remove: async () => {}, reconcile: async () => {},
    validateSessionContext: async (context) => ({ ok: context.worktree === worktree }),
  };
  const original = new Coordinator({
    log, coordination: store, fences: new FenceTable(), adapters: { session: initial }, worktrees, repoId,
    goalPlanAuthority: { policy: store.goalPlanPolicy(), authorize: async () => true },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 100, recoveryTimeoutMs: 500,
  });
  const preview = store.previewPlanDispatch(state.workGate, route);
  const { goalPlan: _binding, ...brief } = preview.brief;
  const handle = await original.spawn('session', brief, {
    taskId: 'prior-plan-task', runId, model: 'model-a', effort: 'low', goalPlan: state.workGate,
    actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: 'spawn:prior-plan-task',
  });
  await until(() => original.list()[0]?.sessionContext);
  initial.emit(handle.id, 'lifecycle.spawned', { sessionId: 'native-session-phase66', pid: 111 });
  initial.emit(handle.id, 'lifecycle.turn_completed', {
    status: 'completed', summary: 'verified predecessor', artifacts: { files: [] },
    verification: { command: 'true', claimedExit: 0 }, openQuestions: [],
  });
  await until(async () => (await original.result(handle.id)).ready === true);

  const resumed = nativeAdapter();
  resumed.spawn = async (recoveredWorker, _brief, options) => {
    resumed.calls.spawn.push([recoveredWorker, _brief, options]);
    resumed.emit(recoveredWorker, 'lifecycle.spawned', { sessionId: 'native-session-phase66', pid: 222 });
    return { ok: true };
  };
  const replay = new Coordinator({
    log, coordination: store, fences: new FenceTable(), adapters: { session: resumed }, worktrees, repoId,
    goalPlanAuthority: { policy: store.goalPlanPolicy(), authorize: async () => true },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 100, recoveryTimeoutMs: 500,
  });
  assert.equal(replay.list()[0].status, 'orphaned');
  return { handle, log, replay, resumed, state, store };
}

test('CE7: dedicated Coordinator Plan recovery attaches first, commits the approved triple, binds intent, then prompts once', async () => {
  const f = await coordinatorFixture();
  let primitiveCalls = 0;
  const primitive = f.store.createAndClaimPlanRecoveryRefinement.bind(f.store);
  f.store.createAndClaimPlanRecoveryRefinement = (...args) => { primitiveCalls += 1; return primitive(...args); };
  let coordinationAtPrompt = null;
  f.resumed.promptBrief = async (recoveredWorker, brief) => {
    coordinationAtPrompt = f.store.events();
    f.resumed.calls.prompt.push([recoveredWorker, brief, 'turn']);
    return { ok: true };
  };
  const recovered = await f.replay.recoverPlanBound(f.handle.id, {
    schemaVersion: 1, runId, gate: f.state.recoveryGate,
    profileDigest: 'a'.repeat(64), recoveryPolicyDigest: 'b'.repeat(64),
    maxAttempts: 2, timeoutMs: 500, actor: 'direct:operator',
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.result, 'attached');
  assert.equal(recovered.attempt, 1);
  assert.equal(primitiveCalls, 1);
  assert.equal(f.resumed.calls.spawn.length, 1);
  assert.equal(f.resumed.calls.spawn[0][2].attachOnly, true);
  assert.equal(f.resumed.calls.spawn[0][2].session.mode, 'resume');
  assert.equal(f.resumed.calls.prompt.length, 1);
  const triple = coordinationAtPrompt.filter((event) => event.batch?.kind === 'goal_plan_recovery_dispatch');
  assert.deepEqual(triple.map((event) => event.kind), ['plan.node_dispatched', 'task.created', 'task.claimed']);
  const intent = coordinationAtPrompt.find((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.continuation_intent');
  assert.ok(intent && triple[2].seq < intent.seq, 'continuation intent follows the claimed Plan recovery task and precedes prompt');
  assert.equal(f.store.task(triple[1].payload.id).brief.goalPlan.nodeKey, 'recover');
  assert.equal(f.store.recoveryDispatchState(f.handle.id).status, 'dispatch_accepted');
});

test('CE1/CE5: CLI and default MCP expose only runId for public recovery and map to the shared command bus', async () => {
  assert.deepEqual(parseBatonCli(['run', 'recover', runId, '--idempotency-key', 'recover-1']), {
    kind: 'command', name: 'run.recover', args: { runId }, idempotencyKey: 'recover-1',
  });

  const calls = [];
  const application = {
    repoId,
    card: () => ({ schemaVersion: 1, repoId, commands: [...Object.keys(APPLICATION_COMMAND_DEFINITIONS)] }),
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal) { calls.push({ name, args, appPrincipal }); return { schemaVersion: 1, runId, phase: 'running' }; },
  };
  const server = new McpFleetServer({
    coordinator: {}, coordination: new CoordinationStore(root('mcp-store')),
    application, shutdownPrincipal: principal('mcp-host'), surface: 'combined',
    principal: {
      userId: 'operator', sessionId: 'stdio', capabilities: ['control', 'observe'], repoIds: [repoId],
      expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
    },
    repoIds: [repoId], now: () => Date.parse('2026-07-14T01:00:00.000Z'),
    maxWaitMs: 5_000, maxMessageBytes: 64 * 1_024, takeToolQuota: () => ({ ok: true }),
  });
  const initialize = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(initialize.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const tools = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const recoveryTool = tools.result.tools.find((tool) => tool.name === 'fleet_run_recover');
  assert.deepEqual(recoveryTool.inputSchema.required, ['repoId', 'idempotencyKey', 'runId']);
  assert.equal(recoveryTool.inputSchema.additionalProperties, false);
  const response = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'fleet_run_recover', arguments: { repoId, idempotencyKey: 'mcp-recover-1', runId },
    },
  });
  assert.equal(response.result.isError, false);
  assert.deepEqual(calls, [{
    name: 'run.recover', args: { runId },
    appPrincipal: { actor: 'mcp:operator:stdio', principalId: 'operator', sessionId: 'stdio' },
  }]);
});
