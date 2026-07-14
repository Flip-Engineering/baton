import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationIntegrityError, CoordinationStore, MockAdapter, createDriver,
} from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase62-red-${name}-`));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase62-red',
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
const goalBudget = () => ({ tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 });
const nodeBudget = () => ({ tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 });
const verification = () => ({ command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [] });
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});
const storeAuth = (principalId, key) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionDigest: createHash('sha256').update(`session:${principalId}`).digest('hex'),
  repoId: policy.repoId,
  runId: null,
  key,
});

function definePlan(store, {
  suffix = 'one', routes = { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
  disposition = null,
} = {}) {
  const goal = store.defineGoal({
    objective: 'Ship the plan-gated change',
    definitionOfDone: ['node --test passes'],
    constraints: ['No network access'],
    risk: 'high',
    budget: goalBudget(),
    predecessor: null,
  }, storeAuth('goal-owner', `goal:${suffix}`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal),
    predecessor: null,
    nodes: [{
      key: 'implement',
      objective: 'Implement the approved slice',
      definitionOfDone: ['node --test passes'],
      deps: [],
      pathScope: ['impl/**'],
      risk: 'high',
      budget: nodeBudget(),
      verification: verification(),
      routes,
      capabilities: ['code', 'test'],
      effects: ['repository_edit'],
    }],
  }, storeAuth('planner', `plan:${suffix}`)).plan;
  let approval = null;
  if (disposition !== null) {
    approval = store.approvePlan({
      goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition,
    }, storeAuth('approver', `approval:${suffix}`)).approval;
  }
  return { goal, plan, approval };
}

function gateFor(goal, plan) {
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
}

function taskFields(state, route, id = 'planned-task') {
  return {
    id,
    brief: state.brief,
    deps: state.resolvedDeps,
    refines: null,
    runId: null,
    taskType: 'general',
    reservedWorkerId: `worker:${id}`,
    vendorRequested: route.vendor,
    modelRequested: route.model,
    modelPolicy: null,
    effortRequested: route.effort,
    effortResolved: null,
    effortObserved: null,
    routeKey: null,
    sessionRequest: { mode: 'new' },
  };
}

function dispatchedStore(name) {
  const directory = root(name);
  const store = new CoordinationStore(directory, { goalPlanPolicy: policy });
  const { goal, plan } = definePlan(store, { suffix: name, disposition: 'approved' });
  const gate = gateFor(goal, plan);
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const state = store.previewPlanDispatch(gate, route);
  const fields = taskFields(state, route);
  const auth = storeAuth('dispatcher', `dispatch:${name}`);
  const created = store.createPlanGatedTask(fields, gate, route, auth);
  return { directory, store, goal, plan, gate, route, fields, auth, created };
}

function rewriteDispatchPair(directory, mutate) {
  const file = join(directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const dispatch = rows.find((event) => event.kind === 'plan.node_dispatched');
  const task = rows[dispatch.seq];
  mutate(dispatch.payload, task.payload);
  dispatch.payload.taskPayloadDigest = canonicalDigest(task.payload);
  const b = dispatch.payload.binding;
  const gate = {
    goalId: b.goalId, goalVersion: b.goalVersion, goalDigest: b.goalDigest,
    planId: b.planId, planVersion: b.planVersion, planDigest: b.planDigest,
    nodeKey: b.nodeKey, expectedDispatchVersion: 0,
    capabilities: dispatch.payload.capabilities, effects: dispatch.payload.effects,
  };
  dispatch.payload.requestDigest = canonicalDigest({ principalId: dispatch.payload.authority.principalId, gate, route: dispatch.payload.route, task: task.payload });
  const batchId = canonicalDigest({
    schemaVersion: 1, kind: 'goal_plan_node_dispatch',
    entries: [dispatch, task].map((event) => ({ kind: event.kind, actor: event.actor, idempotencyKey: event.idempotencyKey, payload: event.payload })),
  });
  dispatch.batch.id = batchId; task.batch.id = batchId;
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
}

function rewriteGoalPlanOrder(directory, order) {
  const file = join(directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const rewritten = order.map((index) => rows[index]);
  for (const [index, event] of rewritten.entries()) {
    event.seq = index + 1;
    if (event.kind === 'goal.version_defined') event.payload.goal.definedEvent = event.seq;
    if (event.kind === 'plan.version_proposed') event.payload.plan.proposedEvent = event.seq;
    if (event.kind === 'plan.approval_decided') event.payload.approval.decidedEvent = event.seq;
  }
  writeFileSync(file, `${rewritten.map(JSON.stringify).join('\n')}\n`);
}

test('GP5/GP6/GP8: exact dispatch replay survives restart and changed bytes conflict without a second task', () => {
  const f = dispatchedStore('restart');
  const scope = { repoId: policy.repoId, runId: null };
  const statusCoordinates = {
    goalId: f.goal.goalId, goalVersion: f.goal.version, goalDigest: f.goal.digest,
    planId: f.plan.planId, planVersion: f.plan.version, planDigest: f.plan.digest, throughSeq: null,
  };
  const beforeStatus = f.store.goalPlanStatus(statusCoordinates, scope);
  const beforeSnapshot = f.store.snapshot();
  f.store.releaseWriterLease();

  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy });
  assert.deepEqual(replay.snapshot(), beforeSnapshot);
  assert.deepEqual(
    replay.goalPlanStatus(statusCoordinates, scope),
    beforeStatus,
  );
  assert.equal(replay.task(f.fields.id).brief.goalPlan.planDigest, f.plan.digest);

  const seq = replay.snapshot().lastSeq;
  const exact = replay.createPlanGatedTask(f.fields, f.gate, f.route, f.auth);
  assert.equal(exact.result, 'idempotent');
  assert.equal(exact.task.id, f.fields.id);
  assert.equal(replay.snapshot().lastSeq, seq);
  assert.throws(
    () => replay.createPlanGatedTask({ ...f.fields, reservedWorkerId: 'worker:substituted' }, f.gate, f.route, f.auth),
    (error) => error.code === 'plan_dispatch_conflict',
  );
  assert.equal(replay.snapshot().lastSeq, seq);
  assert.equal(replay.snapshot().tasks.filter((task) => task.id === f.fields.id).length, 1);
  replay.releaseWriterLease();
});

test('GP6/GP8: a terminal crash seam holds the full reservation until one replay-validated budget settlement', () => {
  const f = dispatchedStore('budget-seam');
  const claimed = f.store.claimTask(f.fields.id, f.fields.reservedWorkerId, 1, { actor: 'orchestrator', key: 'claim:budget-seam' });
  f.store.transitionTask(f.fields.id, 'failed', claimed.task.version, { actor: 'policy', key: 'terminal:budget-seam' }, null);
  const coordinates = {
    goalId: f.goal.goalId, goalVersion: f.goal.version, goalDigest: f.goal.digest,
    planId: f.plan.planId, planVersion: f.plan.version, planDigest: f.plan.digest, throughSeq: null,
  };
  const scope = { repoId: policy.repoId, runId: null };
  const pending = f.store.goalPlanStatus(coordinates, scope).nodes[0].budget;
  assert.equal(pending.status, 'pending'); assert.equal(pending.consumed.tokens, null); assert.equal(pending.held.tokens, 10_000);

  const settled = f.store.settlePlanNodeBudget(f.fields.id, { actor: 'policy', key: 'plan.budget:budget-seam' });
  assert.equal(settled.result, 'settled');
  const held = f.store.goalPlanStatus(coordinates, scope).nodes[0].budget;
  assert.equal(held.status, 'held'); assert.equal(held.consumed.tokens, null); assert.equal(held.released.tokens, null);
  assert.equal(held.held.tokens, 10_000); assert.equal(held.availability.wallMin, 'exact');
  assert.equal(f.store.settlePlanNodeBudget(f.fields.id, { actor: 'policy', key: 'plan.budget:budget-seam' }).result, 'idempotent');
  const expected = f.store.snapshot(); f.store.releaseWriterLease();

  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy });
  assert.deepEqual(replay.snapshot(), expected);
  replay.releaseWriterLease();

  const file = join(f.directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const settlement = rows.find((event) => event.kind === 'plan.node_budget_settled');
  settlement.payload.consumed.tokens = 0;
  const { receiptDigest: _old, ...core } = settlement.payload; settlement.payload.receiptDigest = canonicalDigest(core);
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(f.directory, { goalPlanPolicy: policy }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'plan_budget_settlement_integrity',
  );
});

test('GP5/GP8: a torn goal_plan_node_dispatch batch fails closed on replay', () => {
  const f = dispatchedStore('torn');
  f.store.releaseWriterLease();
  const file = join(f.directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const tail = rows.at(-2);
  assert.equal(tail.kind, 'plan.node_dispatched');
  assert.equal(tail.batch.kind, 'goal_plan_node_dispatch');
  assert.equal(rows.at(-1).kind, 'task.created');
  rows.pop();
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);

  assert.throws(
    () => new CoordinationStore(f.directory, { goalPlanPolicy: policy }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'goal_plan_batch_integrity',
  );
});

test('GP5/GP8: forged dispatch pairs fail semantic replay even after superficial digests are recomputed', () => {
  const mutations = {
    approval_digest: (p, task) => { p.binding.approvalDigest = 'a'.repeat(64); task.brief.goalPlan.approvalDigest = p.binding.approvalDigest; },
    policy_digest: (p, task) => { p.binding.policyDigest = 'b'.repeat(64); task.brief.goalPlan.policyDigest = p.binding.policyDigest; },
    route: (p, task) => { p.route.model = 'outside-plan'; task.modelRequested = 'outside-plan'; },
    deps: (p, task) => { p.resolvedDeps = ['forged-dependency']; task.deps = ['forged-dependency']; },
    capabilities: (p, task) => { p.capabilities = ['code']; task.brief.capabilities = ['code']; },
    effects: (p, task) => { p.effects = []; task.brief.effects = []; },
    verification: (_p, task) => { task.brief.verification.command = 'false'; },
    budget: (p, task) => { p.nodeBudget.tokens -= 1; task.brief.budget.tokens -= 1; },
    goal_coordinate: (p, task) => { p.binding.goalDigest = 'c'.repeat(64); task.brief.goalPlan.goalDigest = p.binding.goalDigest; },
    refines: (_p, task) => { task.refines = 'unchecked-prior'; },
    session: (_p, task) => { task.sessionRequest = { mode: 'resume', id: 'unchecked-session' }; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const fixture = dispatchedStore(`forged-${name}`);
    fixture.store.releaseWriterLease();
    rewriteDispatchPair(fixture.directory, mutate);
    assert.throws(
      () => new CoordinationStore(fixture.directory, { goalPlanPolicy: policy }),
      (error) => error instanceof CoordinationIntegrityError && ['goal_plan_integrity', 'goal_plan_dispatch_integrity'].includes(error.code),
      name,
    );
  }
});

test('GP4/GP5/GP8: self, rejected, and goal-superseded approvals cannot dispatch', () => {
  const rejectedStore = new CoordinationStore(root('rejected'), { goalPlanPolicy: policy });
  const rejected = definePlan(rejectedStore, { suffix: 'rejected' });
  const beforeSelf = rejectedStore.snapshot().lastSeq;
  assert.throws(
    () => rejectedStore.approvePlan({
      goal: ref('goal', rejected.goal), plan: ref('plan', rejected.plan),
      expectedDisposition: null, disposition: 'approved',
    }, storeAuth('planner', 'approval:self')),
    (error) => error.code === 'plan_self_approval',
  );
  assert.equal(rejectedStore.snapshot().lastSeq, beforeSelf);
  rejectedStore.approvePlan({
    goal: ref('goal', rejected.goal), plan: ref('plan', rejected.plan),
    expectedDisposition: null, disposition: 'rejected',
  }, storeAuth('approver', 'approval:rejected'));
  assert.throws(
    () => rejectedStore.previewPlanDispatch(gateFor(rejected.goal, rejected.plan), { vendor: 'mock', model: 'model-a', effort: 'low' }),
    (error) => error.code === 'plan_not_approved',
  );
  rejectedStore.releaseWriterLease();

  const staleStore = new CoordinationStore(root('stale'), { goalPlanPolicy: policy });
  const stale = definePlan(staleStore, { suffix: 'stale', disposition: 'approved' });
  staleStore.defineGoal({
    objective: 'Ship the amended plan-gated change',
    definitionOfDone: ['node --test passes'], constraints: ['No network access'], risk: 'high',
    budget: goalBudget(), predecessor: ref('goal', stale.goal),
  }, storeAuth('goal-owner', 'goal:stale:amend'));
  assert.throws(
    () => staleStore.previewPlanDispatch(gateFor(stale.goal, stale.plan), { vendor: 'mock', model: 'model-a', effort: 'low' }),
    (error) => error.code === 'plan_stale',
  );
  assert.equal(staleStore.snapshot().goalPlan.dispatches.length, 0);
  staleStore.releaseWriterLease();
});

test('GP3/GP4/GP8: plan nodes cannot downgrade goal risk and exact current heads govern new proposals and approvals', () => {
  const directory = root('heads-risk');
  const store = new CoordinationStore(directory, { goalPlanPolicy: policy });
  const goalRequest = {
    objective: 'Preserve exact plan authority', definitionOfDone: ['node --test passes'], constraints: [],
    risk: 'high', budget: goalBudget(), predecessor: null,
  };
  const goal = store.defineGoal(goalRequest, storeAuth('goal-owner', 'goal:heads-risk:1')).goal;
  const makeNode = (risk = 'high') => [{
    key: 'implement', objective: 'Implement exact authority', definitionOfDone: ['node --test passes'], deps: [],
    pathScope: ['impl/**'], risk, budget: nodeBudget(), verification: verification(),
    routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
    capabilities: ['code'], effects: ['repository_edit'],
  }];
  const beforeRisk = store.snapshot().lastSeq;
  assert.throws(
    () => store.proposePlan({ goal: ref('goal', goal), predecessor: null, nodes: makeNode('low') }, storeAuth('planner', 'plan:heads-risk:low')),
    (error) => error.code === 'plan_risk_mismatch',
  );
  assert.equal(store.snapshot().lastSeq, beforeRisk);

  const firstRequest = { goal: ref('goal', goal), predecessor: null, nodes: makeNode() };
  const firstAuth = storeAuth('planner', 'plan:heads-risk:1');
  const first = store.proposePlan(firstRequest, firstAuth).plan;
  const approvalRequest = { goal: ref('goal', goal), plan: ref('plan', first), expectedDisposition: null, disposition: 'approved' };
  const approvalAuth = storeAuth('approver', 'approval:heads-risk:1');
  const firstApproval = store.approvePlan(approvalRequest, approvalAuth);
  const second = store.proposePlan({ goal: ref('goal', goal), predecessor: ref('plan', first), nodes: makeNode() }, storeAuth('planner', 'plan:heads-risk:2')).plan;

  const statusCoordinates = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: first.planId, planVersion: first.version, planDigest: first.digest,
  };
  const scope = { repoId: policy.repoId, runId: null };
  assert.equal(store.goalPlanStatus({ ...statusCoordinates, throughSeq: firstApproval.event.seq }, scope).nodes[0].state, 'ready');
  assert.equal(store.goalPlanStatus({ ...statusCoordinates, throughSeq: null }, scope).nodes[0].state, 'stale');

  assert.equal(store.approvePlan(approvalRequest, approvalAuth).result, 'idempotent', 'lost approval response still coalesces after plan supersession');
  const amended = store.defineGoal({ ...goalRequest, predecessor: ref('goal', goal) }, storeAuth('goal-owner', 'goal:heads-risk:2')).goal;
  assert.equal(amended.version, 2);
  assert.equal(store.proposePlan(firstRequest, firstAuth).result, 'idempotent', 'lost proposal response still coalesces after goal supersession');

  const beforeStale = store.snapshot().lastSeq;
  assert.throws(
    () => store.proposePlan({ goal: ref('goal', goal), predecessor: ref('plan', second), nodes: makeNode() }, storeAuth('planner', 'plan:heads-risk:stale-goal')),
    (error) => error.code === 'goal_stale',
  );
  assert.throws(
    () => store.approvePlan({ goal: ref('goal', goal), plan: ref('plan', second), expectedDisposition: null, disposition: 'approved' }, storeAuth('other-approver', 'approval:heads-risk:stale-goal')),
    (error) => error.code === 'plan_stale',
  );
  assert.equal(store.snapshot().lastSeq, beforeStale);
  store.releaseWriterLease();

  const planStale = new CoordinationStore(root('plan-head-stale'), { goalPlanPolicy: policy });
  const staleGoal = planStale.defineGoal(goalRequest, storeAuth('goal-owner', 'goal:plan-head-stale')).goal;
  const staleFirst = planStale.proposePlan({ goal: ref('goal', staleGoal), predecessor: null, nodes: makeNode() }, storeAuth('planner', 'plan:plan-head-stale:1')).plan;
  planStale.proposePlan({ goal: ref('goal', staleGoal), predecessor: ref('plan', staleFirst), nodes: makeNode() }, storeAuth('planner', 'plan:plan-head-stale:2'));
  const beforePlanStale = planStale.snapshot().lastSeq;
  assert.throws(
    () => planStale.approvePlan({ goal: ref('goal', staleGoal), plan: ref('plan', staleFirst), expectedDisposition: null, disposition: 'approved' }, storeAuth('approver', 'approval:plan-head-stale')),
    (error) => error.code === 'plan_stale',
  );
  assert.equal(planStale.snapshot().lastSeq, beforePlanStale);
  planStale.releaseWriterLease();

  const pinned = dispatchedStore('status-pinned');
  pinned.store.defineGoal({
    objective: 'Ship the amended plan-gated change', definitionOfDone: ['node --test passes'],
    constraints: ['No network access'], risk: 'high', budget: goalBudget(), predecessor: ref('goal', pinned.goal),
  }, storeAuth('goal-owner', 'goal:status-pinned:amend'));
  const pinnedStatus = pinned.store.goalPlanStatus({
    goalId: pinned.goal.goalId, goalVersion: pinned.goal.version, goalDigest: pinned.goal.digest,
    planId: pinned.plan.planId, planVersion: pinned.plan.version, planDigest: pinned.plan.digest, throughSeq: null,
  }, scope);
  assert.equal(pinnedStatus.nodes[0].state, 'dispatched');
  assert.equal(pinnedStatus.nodes[0].taskId, pinned.fields.id);
  pinned.store.releaseWriterLease();
});

test('GP4/GP8: replay rejects proposals and approvals admitted after their exact authority heads were superseded', () => {
  const proposalDirectory = root('replay-stale-goal-head');
  const proposalStore = new CoordinationStore(proposalDirectory, { goalPlanPolicy: policy });
  const goalRequest = {
    objective: 'Reject reordered stale authority', definitionOfDone: ['node --test passes'], constraints: [],
    risk: 'high', budget: goalBudget(), predecessor: null,
  };
  const nodes = [{
    key: 'implement', objective: 'Implement exact authority', definitionOfDone: ['node --test passes'], deps: [],
    pathScope: ['impl/**'], risk: 'high', budget: nodeBudget(), verification: verification(),
    routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code'], effects: ['repository_edit'],
  }];
  const goal = proposalStore.defineGoal(goalRequest, storeAuth('goal-owner', 'goal:replay-head:1')).goal;
  const first = proposalStore.proposePlan({ goal: ref('goal', goal), predecessor: null, nodes }, storeAuth('planner', 'plan:replay-head:1')).plan;
  proposalStore.proposePlan({ goal: ref('goal', goal), predecessor: ref('plan', first), nodes }, storeAuth('planner', 'plan:replay-head:2'));
  proposalStore.defineGoal({ ...goalRequest, predecessor: ref('goal', goal) }, storeAuth('goal-owner', 'goal:replay-head:2'));
  proposalStore.releaseWriterLease();
  rewriteGoalPlanOrder(proposalDirectory, [0, 1, 3, 2]);
  assert.throws(
    () => new CoordinationStore(proposalDirectory, { goalPlanPolicy: policy }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'goal_plan_integrity',
  );

  const approvalDirectory = root('replay-stale-plan-head');
  const approvalStore = new CoordinationStore(approvalDirectory, { goalPlanPolicy: policy });
  const approvalGoal = approvalStore.defineGoal(goalRequest, storeAuth('goal-owner', 'goal:replay-approval')).goal;
  const approvalFirst = approvalStore.proposePlan({ goal: ref('goal', approvalGoal), predecessor: null, nodes }, storeAuth('planner', 'plan:replay-approval:1')).plan;
  approvalStore.approvePlan({ goal: ref('goal', approvalGoal), plan: ref('plan', approvalFirst), expectedDisposition: null, disposition: 'approved' }, storeAuth('approver', 'approval:replay-approval'));
  approvalStore.proposePlan({ goal: ref('goal', approvalGoal), predecessor: ref('plan', approvalFirst), nodes }, storeAuth('planner', 'plan:replay-approval:2'));
  approvalStore.releaseWriterLease();
  rewriteGoalPlanOrder(approvalDirectory, [0, 1, 3, 2]);
  assert.throws(
    () => new CoordinationStore(approvalDirectory, { goalPlanPolicy: policy }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'goal_plan_integrity',
  );
});

test('GP5/GP8: harness, model, and effort constraints each refuse before dispatch', () => {
  const store = new CoordinationStore(root('routes'), { goalPlanPolicy: policy });
  const { goal, plan } = definePlan(store, { suffix: 'routes', disposition: 'approved' });
  const gate = gateFor(goal, plan);
  const before = store.snapshot().lastSeq;
  for (const route of [
    { vendor: 'other', model: 'model-a', effort: 'low' },
    { vendor: 'mock', model: 'model-b', effort: 'low' },
    { vendor: 'mock', model: 'model-a', effort: 'high' },
  ]) {
    assert.throws(
      () => store.previewPlanDispatch(gate, route),
      (error) => error.code === 'plan_route_mismatch',
    );
    assert.equal(store.snapshot().lastSeq, before);
    assert.equal(store.snapshot().goalPlan.dispatches.length, 0);
  }
  store.releaseWriterLease();
});

test('GP3/GP5: every plan node declares explicit scope and selectable harness/model/effort sets', () => {
  const cases = {
    scope: { pathScope: [] },
    harness: { routes: { harnesses: [], models: ['model-a'], efforts: ['low'] } },
    model: { routes: { harnesses: ['mock'], models: [], efforts: ['low'] } },
    effort: { routes: { harnesses: ['mock'], models: ['model-a'], efforts: [] } },
  };
  for (const [name, change] of Object.entries(cases)) {
    const store = new CoordinationStore(root(`explicit-${name}`), { goalPlanPolicy: policy });
    const goal = store.defineGoal({
      objective: 'Require explicit authority', definitionOfDone: ['explicit node'], constraints: [], risk: 'high',
      budget: goalBudget(), predecessor: null,
    }, storeAuth('goal-owner', `goal:explicit:${name}`)).goal;
    const before = store.snapshot().lastSeq;
    const node = {
      key: 'implement', objective: 'Implement explicitly', definitionOfDone: ['explicit node'], deps: [],
      pathScope: ['**'], risk: 'high', budget: nodeBudget(), verification: verification(),
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code'], effects: ['repository_edit'], ...change,
    };
    assert.throws(() => store.proposePlan({ goal: ref('goal', goal), predecessor: null, nodes: [node] }, storeAuth('planner', `plan:explicit:${name}`)), (error) => ['plan_scope_invalid', 'goal_plan_invalid'].includes(error.code));
    assert.equal(store.snapshot().lastSeq, before);
    store.releaseWriterLease();
  }
});

test('GP3/GP8: plan verification is closed direct-exec authority with bounded cwd, env, argv, output, and predecessor evidence', () => {
  const invalid = {
    shell: { ...verification(), command: 'node && false' },
    cwd_escape: { ...verification(), cwd: '../outside' },
    credential_env: { ...verification(), envAllowlist: ['GLM_API_KEY', 'PATH'] },
    credential_argument: { ...verification(), arguments: ['--test', 'access_token=abcdefghijklmnopqrstuvwx'] },
    predecessor_mismatch: { ...verification(), requiredPredecessorEvidence: ['missing-node'] },
    argv_oversize: { ...verification(), arguments: Array(policy.limits.maxItems + 1).fill('x') },
    output_oversize: { ...verification(), maxOutputBytes: 16 * 1024 * 1024 + 1 },
  };
  for (const [name, candidate] of Object.entries(invalid)) {
    const store = new CoordinationStore(root(`verification-${name}`), { goalPlanPolicy: policy });
    const goal = store.defineGoal({
      objective: 'Verify safely', definitionOfDone: ['safe verification'], constraints: [], risk: 'high',
      budget: goalBudget(), predecessor: null,
    }, storeAuth('goal-owner', `goal:verification:${name}`)).goal;
    const before = store.snapshot().lastSeq;
    assert.throws(() => store.proposePlan({
      goal: ref('goal', goal), predecessor: null, nodes: [{
        key: 'verify', objective: 'Run safe verification', definitionOfDone: ['safe verification'], deps: [],
        pathScope: ['impl/**'], risk: 'high', budget: nodeBudget(), verification: candidate,
        routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
        capabilities: ['test'], effects: [],
      }],
    }, storeAuth('planner', `plan:verification:${name}`)), (error) => error.code === (name === 'credential_argument' ? 'goal_plan_secret_rejected' : 'plan_verification_invalid'), name);
    assert.equal(store.snapshot().lastSeq, before, name);
    store.releaseWriterLease();
  }
});

test('GP3/GP4: any verification argument change creates a new plan version that requires fresh approval', () => {
  const store = new CoordinationStore(root('verification-version'), { goalPlanPolicy: policy });
  const goal = store.defineGoal({
    objective: 'Version verification', definitionOfDone: ['safe verification'], constraints: [], risk: 'high',
    budget: goalBudget(), predecessor: null,
  }, storeAuth('goal-owner', 'goal:verification-version')).goal;
  const node = (contract) => [{
    key: 'verify', objective: 'Run verification', definitionOfDone: ['safe verification'], deps: [],
    pathScope: ['impl/**'], risk: 'high', budget: nodeBudget(), verification: contract,
    routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['test'], effects: [],
  }];
  const first = store.proposePlan({ goal: ref('goal', goal), predecessor: null, nodes: node(verification()) }, storeAuth('planner', 'plan:verification-version:1')).plan;
  store.approvePlan({ goal: ref('goal', goal), plan: ref('plan', first), expectedDisposition: null, disposition: 'approved' }, storeAuth('approver', 'approval:verification-version:1'));
  const changed = { ...verification(), arguments: ['--test', 'impl/test/phase62-goal-plan-authority.test.mjs'] };
  const second = store.proposePlan({ goal: ref('goal', goal), predecessor: ref('plan', first), nodes: node(changed) }, storeAuth('planner', 'plan:verification-version:2')).plan;
  assert.equal(second.version, 2); assert.notEqual(second.digest, first.digest);
  const gate = { ...gateFor(goal, second), nodeKey: 'verify', capabilities: ['test'], effects: [] };
  assert.throws(() => store.previewPlanDispatch(gate, { vendor: 'mock', model: 'model-a', effort: 'low' }), (error) => error.code === 'plan_not_approved');
  store.releaseWriterLease();
});

test('GP5/GP8: generic createTask cannot bypass mandatory dispatch or smuggle plan coordinates', () => {
  const store = new CoordinationStore(root('generic'), { goalPlanPolicy: policy });
  const { goal, plan } = definePlan(store, { suffix: 'generic', disposition: 'approved' });
  const state = store.previewPlanDispatch(gateFor(goal, plan), { vendor: 'mock', model: 'model-a', effort: 'low' });
  const before = store.snapshot().lastSeq;
  const plain = { ...taskFields(state, { vendor: 'mock', model: 'model-a', effort: 'low' }, 'plain-bypass') };
  plain.brief = {
    goal: 'Unchecked task', constraints: [], pathScope: [], definitionOfDone: 'done',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 0, wallMin: 1 },
  };
  assert.throws(
    () => store.createTask(plain, { actor: 'orchestrator', key: 'generic:plain' }),
    (error) => error.code === 'goal_plan_required',
  );
  assert.throws(
    () => store.createTask(taskFields(state, { vendor: 'mock', model: 'model-a', effort: 'low' }, 'bound-bypass'), { actor: 'orchestrator', key: 'generic:bound' }),
    (error) => error.code === 'goal_plan_dispatch_api_required',
  );
  assert.equal(store.snapshot().lastSeq, before);
  assert.equal(store.task('plain-bypass'), null);
  assert.equal(store.task('bound-bypass'), null);
  store.releaseWriterLease();
});

test('GP5/GP8: caller verification substitution refuses before task, capacity, or adapter effects', async () => {
  const repo = root('brief-repo');
  const logDir = root('brief-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase62@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 62'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 10, summary: 'unexpected spawn', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...baseCard(), modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  let spawnCalls = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawnCalls += 1; return spawn(...args); };
  let capacityObservations = 0;
  const driver = createDriver({
    repoRoot: repo,
    repoId: policy.repoId,
    logDir,
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    worktreeCapacity: {
      maxReservedBytes: 100_000_000, maxReservedInodes: 100_000,
      minFreeBytes: 1, minFreeInodes: 1, runtimeReserveBytes: 1, runtimeReserveInodes: 1,
    },
    worktreeCapacityObserve: () => {
      capacityObservations += 1;
      return { freeBytes: 1_000_000_000, freeInodes: 1_000_000 };
    },
    stopDeadlineMs: 1_000,
  });
  const ctx = (principalId, powers, idempotencyKey) => ({
    actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
    repoId: policy.repoId, runId: null, idempotencyKey,
  });
  const goal = (await driver.coordinator.defineGoal({
    objective: 'Ship the plan-gated change', definitionOfDone: ['node --test passes'],
    constraints: ['No network access'], risk: 'high', budget: goalBudget(), predecessor: null,
  }, ctx('goal-owner', ['goal:define'], 'goal:brief'))).goal;
  const plan = (await driver.coordinator.proposePlan({
    goal: ref('goal', goal), predecessor: null, nodes: [{
      key: 'implement', objective: 'Implement the approved slice',
      definitionOfDone: ['node --test passes'], deps: [], pathScope: ['impl/**'], risk: 'high',
      budget: nodeBudget(), verification: verification(),
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, ctx('planner', ['plan:propose'], 'plan:brief'))).plan;
  await driver.coordinator.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, ctx('approver', ['plan:approve'], 'approval:brief'));

  const beforeSeq = driver.coordination.snapshot().lastSeq;
  const beforeCapacity = driver.worktreeCapacity.snapshot();
  const beforeObservations = capacityObservations;
  await assert.rejects(
    () => driver.coordinator.spawn('mock', {
      goal: 'Implement the approved slice', constraints: ['No network access'],
      pathScope: ['impl/**'], definitionOfDone: 'node --test passes',
      verification: { ...verification(), command: 'rm', arguments: ['-rf', '.'] },
      budget: { tokens: 10_000, usd: 1, wallMin: 5 },
    }, {
      taskId: 'brief-substitution', goalPlan: gateFor(goal, plan),
      model: 'model-a', effort: 'low',
      actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
      powers: ['plan:dispatch'], idempotencyKey: 'dispatch:brief-substitution',
    }),
    (error) => error.code === 'plan_brief_mismatch',
  );
  assert.equal(driver.coordination.snapshot().lastSeq, beforeSeq);
  assert.equal(driver.coordination.task('brief-substitution'), null);
  assert.deepEqual(driver.worktreeCapacity.snapshot(), beforeCapacity);
  assert.equal(capacityObservations, beforeObservations);
  assert.equal(spawnCalls, 0);
  assert.deepEqual(driver.coordinator.list(), []);
  const approvedBrief = {
    goal: 'Implement the approved slice', constraints: ['No network access'],
    pathScope: ['impl/**'], definitionOfDone: 'node --test passes', verification: verification(),
    budget: { tokens: 10_000, usd: 1, wallMin: 5 },
  };
  const forbidden = [
    { refines: 'prior-task' },
    { taskType: 'review' },
    { session: { mode: 'resume', id: 'native-session' } },
    { review: { parentTaskId: 'prior-task' } },
    { worktreeBaseSha: 'd'.repeat(40) },
    { modelPolicy: { allow: ['model-a'] } },
  ];
  for (const [index, extra] of forbidden.entries()) {
    await assert.rejects(
      () => driver.coordinator.spawn('mock', approvedBrief, {
        taskId: `execution-substitution-${index}`, goalPlan: gateFor(goal, plan),
        model: 'model-a', effort: 'low',
        actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
        powers: ['plan:dispatch'], idempotencyKey: `dispatch:execution-substitution-${index}`,
        ...extra,
      }),
      (error) => error.code === 'plan_execution_mismatch',
    );
  }
  assert.equal(driver.coordination.snapshot().lastSeq, beforeSeq);
  assert.deepEqual(driver.worktreeCapacity.snapshot(), beforeCapacity);
  assert.equal(capacityObservations, beforeObservations);
  assert.equal(spawnCalls, 0);
  assert.deepEqual(driver.coordinator.list(), []);
  driver.close();
});
