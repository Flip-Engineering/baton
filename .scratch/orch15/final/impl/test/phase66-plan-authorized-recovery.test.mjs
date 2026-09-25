import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationIntegrityError, CoordinationStore } from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const repoId = 'repo-phase66-recovery';
const runId = 'run-phase66-recovery';
const workerId = 'worker-phase66-recovery';
const route = Object.freeze({ vendor: 'stub', model: 'model-a', effort: 'low' });
const attribution = Object.freeze({
  harnessRequested: 'stub', harnessResolved: 'stub@phase66',
  modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
  effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
  routeKey: '["stub","phase66","model-a","low"]',
});
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});
const policy = Object.freeze({
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

const budget = (tokens, usd, providerTurns) => ({ tokens, usd, wallMin: 10, providerTurns });
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });
const auth = (principalId, key, extra = {}) => ({
  actor: `direct:${principalId}`, principalId, repoId, runId, key,
  sessionDigest: digest({ principalId, session: `${principalId}-session` }),
  ...extra,
});

function gate(goal, plan, nodeKey) {
  const node = plan.nodes.find((row) => row.key === nodeKey);
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey, expectedDispatchVersion: 0,
    capabilities: [...node.capabilities], effects: [...node.effects],
  };
}

function planNode({ key, objective, definitionOfDone, deps, tokens, usd, providerTurns, recovery }) {
  return {
    key, objective, definitionOfDone: [definitionOfDone], deps, pathScope: ['impl/**'], risk: 'high',
    budget: budget(tokens, usd, providerTurns),
    verification: { ...verification, requiredPredecessorEvidence: [...deps] },
    routes: { harnesses: ['stub'], models: ['model-a'], efforts: ['low'] },
    capabilities: recovery ? ['code', 'native_session_recovery', 'test'] : ['code', 'test'],
    effects: ['provider_call', 'repository_edit'],
  };
}

function fixture(name) {
  const directory = mkdtempSync(join(tmpdir(), `baton-phase66-plan-recovery-${name}-`));
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: policy,
    operationalRead,
    clock: () => '2026-07-14T00:00:00.000Z',
  });

  const done = [
    'implemented result is hub verified',
    'eligible native session recovery is exact',
    'ordinary continuation remains separately authorized',
  ];
  const goal = store.defineGoal({
    objective: 'Complete and recover one Plan-bound Run without escaping Goal/Plan authority',
    definitionOfDone: done,
    constraints: ['Recovery must remain local and attach-only'],
    risk: 'high', budget: { ...budget(40_000, 5, 12), wallMin: 30 }, predecessor: null,
  }, auth('goal-owner', 'goal:phase66-recovery')).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [
      planNode({
        key: 'implement', objective: 'Produce the verified recovery predecessor',
        definitionOfDone: done[0], deps: [], tokens: 20_000, usd: 2, providerTurns: 6, recovery: false,
      }),
      planNode({
        key: 'recover', objective: 'Recover the exact native session under explicit Plan authority',
        definitionOfDone: done[1], deps: ['implement'], tokens: 12_000, usd: 2, providerTurns: 4, recovery: true,
      }),
      planNode({
        key: 'ordinary', objective: 'Represent an approved non-recovery continuation node',
        definitionOfDone: done[2], deps: ['implement'], tokens: 8_000, usd: 1, providerTurns: 2, recovery: false,
      }),
    ],
  }, auth('planner', 'plan:phase66-recovery')).plan;
  const approval = store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:phase66-recovery')).approval;

  const implementGate = gate(goal, plan, 'implement');
  const implement = store.previewPlanDispatch(implementGate, route);
  store.createPlanGatedTask({
    id: 'prior-plan-task', brief: implement.brief, deps: implement.resolvedDeps, refines: null,
    runId, taskType: 'general', reservedWorkerId: workerId,
    vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
    effortRequested: route.effort, effortResolved: null, effortObserved: null, routeKey: null,
    sessionRequest: { mode: 'new' },
  }, implementGate, route, auth('dispatcher', 'plan.dispatch:implement'));
  store.claimTask('prior-plan-task', workerId, 1, {
    actor: 'orchestrator', key: 'task.claimed:prior-plan-task',
  }, attribution);
  const verified = {
    worker: workerId, seq: 1, ts: '2026-07-14T00:00:01.000Z', kind: 'verify.reverified',
    actor: 'policy', taskId: 'prior-plan-task', payload: { accept: true, verdict: { ok: true } },
  };
  operational.set(`${workerId}:1`, verified);
  const evidence = store.mapOperationalEvent(verified, {
    actor: 'policy', key: 'evidence:prior-plan-task:verified',
  }).evidence;
  store.transitionTask('prior-plan-task', 'completed', 2, {
    actor: 'policy', key: 'task.completed:prior-plan-task',
  }, evidence);

  const recoveryGate = gate(goal, plan, 'recover');
  const recovery = store.previewPlanDispatch(recoveryGate, route);
  const context = {
    worktree: '/tmp/baton-phase66-plan-recovery-worktree', ownerTaskId: 'prior-plan-task', baseSha: 'base-sha',
  };
  const recoveryFields = {
    id: 'recovery-plan-task', brief: recovery.brief, deps: recovery.resolvedDeps,
    refines: 'prior-plan-task', runId, taskType: 'general', reservedWorkerId: workerId,
    vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
    effortRequested: route.effort,
    sessionRequest: { mode: 'resume', id: 'native-session-phase66', context },
    relation: 'recovery',
  };
  const recoveryAuth = auth('dispatcher', 'plan.recovery:recover', { actor: 'orchestrator' });
  const createRecovery = (overrides = {}) => store.createAndClaimPlanRecoveryRefinement(
    overrides.fields ?? recoveryFields,
    overrides.gate ?? recoveryGate,
    overrides.route ?? route,
    overrides.attribution ?? attribution,
    overrides.auth ?? recoveryAuth,
  );
  return {
    directory, operational, operationalRead, store, goal, plan, approval,
    recovery, recoveryGate, recoveryFields, recoveryAuth, createRecovery,
  };
}

function removeLastEvent(directory) {
  const file = join(directory, 'events.jsonl');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  const removed = JSON.parse(lines.pop());
  writeFileSync(file, `${lines.join('\n')}\n`);
  return removed;
}

test('CE6/CE7: Plan recovery dispatch, refinement creation, and claim are one exact three-event transaction', () => {
  const f = fixture('atomic');
  const before = f.store.events().length;
  const admitted = f.createRecovery();
  const appended = f.store.events().slice(before);

  assert.deepEqual(appended.map((event) => event.kind), [
    'plan.node_dispatched', 'task.created', 'task.claimed',
  ]);
  assert.deepEqual(appended.map((event) => event.batch.index), [0, 1, 2]);
  assert.equal(new Set(appended.map((event) => event.batch.id)).size, 1);
  assert.equal(new Set(appended.map((event) => event.batch.kind)).size, 1);
  assert.equal(appended[0].batch.kind, 'goal_plan_recovery_dispatch');
  assert.equal(new Set(appended.map((event) => event.ts)).size, 1);
  assert.deepEqual(appended.map((event) => event.idempotencyKey), [
    f.recoveryAuth.key, `${f.recoveryAuth.key}:task`, `${f.recoveryAuth.key}:claim`,
  ]);
  assert.equal(new Set(appended.map((event) => event.actor)).size, 1);
  assert.equal(appended[1].seq, appended[0].seq + 1);
  assert.equal(appended[2].seq, appended[1].seq + 1);

  assert.equal(admitted.result, 'claimed');
  assert.equal(admitted.dispatchEvent.seq, appended[0].seq);
  assert.equal(admitted.createdEvent.seq, appended[1].seq);
  assert.equal(admitted.claimedEvent.seq, appended[2].seq);
  assert.equal(admitted.dispatch.binding.nodeKey, 'recover');
  assert.deepEqual(admitted.dispatch.nodeBudget, f.recovery.node.budget);
  assert.deepEqual(admitted.dispatch.route, route);
  assert.deepEqual(admitted.dispatch.capabilities, f.recovery.node.capabilities);
  assert.deepEqual(admitted.dispatch.effects, f.recovery.node.effects);

  assert.equal(admitted.task.status, 'working');
  assert.equal(admitted.task.assignee, workerId);
  assert.equal(admitted.task.refines, 'prior-plan-task');
  assert.equal(admitted.task.relation, 'recovery');
  assert.deepEqual(admitted.task.deps, ['prior-plan-task']);
  assert.equal(admitted.task.brief.goalPlan.nodeKey, 'recover');
  assert.deepEqual(admitted.task.brief.budget, {
    tokens: f.recovery.node.budget.tokens,
    usd: f.recovery.node.budget.usd,
    wallMin: f.recovery.node.budget.wallMin,
  });
  assert.equal(admitted.task.brief.providerTurns, f.recovery.node.budget.providerTurns);

  f.store.releaseWriterLease();
  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy, operationalRead: f.operationalRead });
  assert.equal(replay.task('recovery-plan-task').status, 'working');
  assert.equal(replay.task('recovery-plan-task').brief.goalPlan.nodeKey, 'recover');
  assert.equal(replay.snapshot().goalPlan.dispatches.find((row) => row.taskId === 'recovery-plan-task').nodeBudget.tokens, 12_000);
});

test('CE6/CE7: recovery requires its explicit approved capability and exact Brief, route, effects, and budget', () => {
  const f = fixture('authority');
  const before = f.store.events().length;
  const ordinaryGate = gate(f.goal, f.plan, 'ordinary');
  const ordinary = f.store.previewPlanDispatch(ordinaryGate, route);

  assert.throws(() => f.createRecovery({
    gate: ordinaryGate,
    fields: { ...f.recoveryFields, brief: ordinary.brief, deps: ordinary.resolvedDeps },
  }), (error) => error.code === 'plan_recovery_not_authorized');
  assert.throws(() => f.createRecovery({
    fields: {
      ...f.recoveryFields,
      brief: { ...f.recoveryFields.brief, providerTurns: f.recoveryFields.brief.providerTurns - 1 },
    },
  }), (error) => error.code === 'plan_brief_mismatch');
  assert.throws(() => f.createRecovery({
    gate: { ...f.recoveryGate, effects: ['repository_edit'] },
  }), (error) => error.code === 'plan_effect_mismatch');
  assert.throws(() => f.createRecovery({
    route: { ...route, model: 'model-b' },
  }), (error) => error.code === 'plan_route_mismatch');
  assert.equal(f.store.events().length, before, 'authority conflicts append no dispatch, task, or claim prefix');
});

test('CE6/CE7: the refined Plan task must retain completed hub-verified same-worker lineage', () => {
  const f = fixture('verified-lineage');
  f.operational.delete(`${workerId}:1`);
  const before = f.store.events().length;
  assert.throws(() => f.createRecovery(), (error) => error.code === 'recovery_refinement_unverified');
  assert.equal(f.store.events().length, before);
});

test('CE6/CE8: an admitted Run stop fences the Plan recovery transaction before any prefix', () => {
  const f = fixture('stop-fence');
  const reasonDigest = digest({ reason: 'operator stopped the Run' });
  const requestDigest = digest({ repoId, runId, reasonDigest });
  f.store.admitRunStop({ schemaVersion: 1, repoId, runId, reasonDigest, requestDigest }, {
    actor: 'direct:operator', key: `run.stop:${runId}`,
  });
  const before = f.store.events().length;
  assert.throws(() => f.createRecovery(), (error) => error.code === 'run_stopping');
  assert.equal(f.store.events().length, before);
});

test('CE8: exact response-loss retry is idempotent and a changed request cannot reuse its key', () => {
  const f = fixture('idempotency');
  const first = f.createRecovery();
  const afterFirst = f.store.events().length;
  const replay = f.createRecovery();
  assert.equal(replay.result, 'idempotent');
  assert.equal(replay.dispatchEvent.seq, first.dispatchEvent.seq);
  assert.equal(replay.createdEvent.seq, first.createdEvent.seq);
  assert.equal(replay.claimedEvent.seq, first.claimedEvent.seq);
  assert.equal(f.store.events().length, afterFirst);

  assert.throws(() => f.createRecovery({
    fields: {
      ...f.recoveryFields,
      sessionRequest: { ...f.recoveryFields.sessionRequest, id: 'substituted-native-session' },
    },
  }), (error) => error.code === 'plan_recovery_conflict');
  assert.equal(f.store.events().length, afterFirst);
});

test('CE8 replay: a newline-complete torn Plan recovery triple fails closed', () => {
  const f = fixture('torn-replay');
  f.createRecovery();
  f.store.releaseWriterLease();
  const removed = removeLastEvent(f.directory);
  assert.equal(removed.kind, 'task.claimed');
  assert.throws(
    () => new CoordinationStore(f.directory, { goalPlanPolicy: policy, operationalRead: f.operationalRead }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'goal_plan_recovery_batch_integrity',
  );
});
