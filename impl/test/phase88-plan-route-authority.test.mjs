import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import {
  goalPlanDigest, normalizeGoalPlanPolicy, normalizePlanRequest,
  planRouteAuthorityState, planRouteMatches, planSingleExactRoute,
} from '../src/goal-plan.mjs';

const REPO_ID = 'repo-phase88-routes';
const NOW = '2026-07-19T12:00:00.000Z';
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase88-route-${name}-`));
const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'medium' });
const dispatchRoute = (route) => ({ vendor: route.harness, model: route.model, effort: route.effort });
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const policy = normalizeGoalPlanPolicy({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: {
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 4,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  },
});
const goalBudget = () => ({ tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 });
const nodeBudget = () => ({ tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 });
const verification = () => ({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
  maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
});
const goalRef = (goal) => ({ goalId: goal.goalId, version: goal.version, digest: goal.digest });
const planRef = (plan) => ({ planId: plan.planId, version: plan.version, digest: plan.digest });
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId,
  sessionDigest: digest(`session:${principalId}`), repoId: REPO_ID, runId: null, key,
});
const hypotheticalGoal = Object.freeze({
  schemaVersion: 1, goalId: `goal:${'a'.repeat(64)}`, version: 1, digest: 'b'.repeat(64),
  repoId: REPO_ID, runId: null, objective: 'Close Plan route tuples',
  definitionOfDone: ['route authority is exact'], constraints: [], risk: 'high',
  budget: goalBudget(), predecessor: null, policyDigest: policy.policyDigest,
  principalId: 'owner', definedEvent: 1, definedAt: NOW,
});

function node(routes, overrides = {}) {
  return {
    key: 'work', objective: 'Implement exact route authority',
    definitionOfDone: ['route authority is exact'], deps: [], pathScope: ['impl/**'],
    risk: 'high', budget: nodeBudget(), verification: verification(), routes,
    capabilities: ['code', 'test'], effects: ['repository_edit'], ...overrides,
  };
}

function normalizeRoutes(routes) {
  return normalizePlanRequest({
    goal: goalRef(hypotheticalGoal), predecessor: null, nodes: [node(routes)],
  }, policy, hypotheticalGoal).nodes[0].routes;
}

function defineApprovedPlan(directory, routes, suffix) {
  const store = new CoordinationStore(directory, { goalPlanPolicy: policy, clock: () => NOW });
  const goal = store.defineGoal({
    objective: hypotheticalGoal.objective,
    definitionOfDone: hypotheticalGoal.definitionOfDone,
    constraints: [], risk: 'high', budget: goalBudget(), predecessor: null,
  }, auth('owner', `goal:${suffix}`)).goal;
  const plan = store.proposePlan({
    goal: goalRef(goal), predecessor: null, nodes: [node(routes)],
  }, auth('planner', `plan:${suffix}`)).plan;
  const approval = store.approvePlan({
    goal: goalRef(goal), plan: planRef(plan), expectedDisposition: null, disposition: 'approved',
  }, auth('approver', `approval:${suffix}`)).approval;
  return { store, goal, plan, approval };
}

function gateFor(goal, plan) {
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'work', expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
}

function taskFields(state, route, id = 'phase88-route-task') {
  return {
    id, brief: state.brief, deps: state.resolvedDeps, refines: null, runId: null,
    taskType: 'general', reservedWorkerId: `worker:${id}`,
    vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
    effortRequested: route.effort, effortResolved: null, effortObserved: null,
    routeKey: null, sessionRequest: { mode: 'new' },
  };
}

function rewritePlanAsAmbiguousLegacy(directory) {
  const file = join(directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const proposed = rows.find((event) => event.kind === 'plan.version_proposed');
  const decided = rows.find((event) => event.kind === 'plan.approval_decided');
  const plan = proposed.payload.plan;
  plan.nodes[0].routes = {
    harnesses: [routeA.harness, routeB.harness].sort(),
    models: [routeA.model, routeB.model].sort(),
    efforts: [routeA.effort, routeB.effort].sort(),
  };
  const core = {
    schemaVersion: 1, repoId: plan.repoId, runId: plan.runId,
    goal: plan.goal, predecessor: plan.predecessor, nodes: plan.nodes,
    totals: plan.totals, policyDigest: plan.policyDigest,
  };
  plan.digest = goalPlanDigest(core);
  plan.planId = `plan:${goalPlanDigest({ schemaVersion: 1, goal: plan.goal, firstDigest: plan.digest })}`;
  proposed.payload.requestDigest = goalPlanDigest({ proposerPrincipalId: plan.proposerPrincipalId, ...core });

  const approval = decided.payload.approval;
  approval.plan = planRef(plan);
  const approvalCore = {
    schemaVersion: 1, goal: approval.goal, plan: approval.plan,
    disposition: approval.disposition, policyDigest: approval.policyDigest,
    principalId: approval.principalId, sessionDigest: approval.sessionDigest,
  };
  approval.digest = goalPlanDigest(approvalCore);
  decided.payload.requestDigest = goalPlanDigest({
    principalId: approval.principalId, sessionDigest: approval.sessionDigest,
    goal: approval.goal, plan: approval.plan, disposition: approval.disposition,
    expectedDisposition: null,
  });
  const dispatched = rows.find((event) => event.kind === 'plan.node_dispatched');
  let historical = null;
  if (dispatched) {
    const created = rows.find((event) => event.kind === 'task.created'
      && event.batch?.id === dispatched.batch?.id);
    assert.ok(created, 'historical dispatch must retain its paired task event');
    const binding = dispatched.payload.binding;
    binding.planId = plan.planId;
    binding.planDigest = plan.digest;
    binding.approvalDigest = approval.digest;
    created.payload.brief.goalPlan = structuredClone(binding);
    dispatched.payload.taskPayloadDigest = goalPlanDigest(created.payload);
    const gate = {
      goalId: binding.goalId, goalVersion: binding.goalVersion, goalDigest: binding.goalDigest,
      planId: binding.planId, planVersion: binding.planVersion, planDigest: binding.planDigest,
      nodeKey: binding.nodeKey, expectedDispatchVersion: 0,
      capabilities: dispatched.payload.capabilities, effects: dispatched.payload.effects,
      ...(Object.hasOwn(dispatched.payload, 'requiredEffects')
        ? { requiredEffects: dispatched.payload.requiredEffects } : {}),
    };
    dispatched.payload.requestDigest = goalPlanDigest({
      principalId: dispatched.payload.authority.principalId,
      gate, route: dispatched.payload.route, task: created.payload,
    });
    const pair = [dispatched, created];
    const batchId = goalPlanDigest({
      schemaVersion: 1, kind: 'goal_plan_node_dispatch',
      entries: pair.map((event) => ({
        kind: event.kind, actor: event.actor,
        idempotencyKey: event.idempotencyKey, payload: event.payload,
      })),
    });
    for (const event of pair) event.batch.id = batchId;
    historical = {
      gate: structuredClone(gate), route: structuredClone(dispatched.payload.route),
      task: structuredClone(created.payload),
      auth: auth(dispatched.payload.authority.principalId, dispatched.idempotencyKey),
    };
  }
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  return { plan: structuredClone(plan), approval: structuredClone(approval), historical };
}

test('PR88-1: v2 Plan tuples normalize in locale-independent code-unit order and retain one canonical digest', () => {
  const upper = { harness: 'I', model: 'model-z', effort: 'high' };
  const lower = { harness: 'i', model: 'model-a', effort: 'low' };
  const first = normalizeRoutes({ schemaVersion: 2, allowed: [lower, upper, routeB, routeA] });
  const second = normalizeRoutes({ schemaVersion: 2, allowed: [routeA, routeB, upper, lower] });
  assert.deepEqual(first, second);
  assert.deepEqual(first.allowed.map((route) => route.harness), ['I', 'codex', 'grok', 'i']);
  assert.equal(goalPlanDigest(first), goalPlanDigest(second));
  assert.deepEqual(Object.keys(first).sort(), ['allowed', 'schemaVersion']);
  assert.equal(first.allowed.some((route) => Object.hasOwn(route, 'digest')), false);
});

test('PR88-2: route helpers distinguish closed tuples, safe legacy singleton, and quarantined ambiguity', () => {
  const tuples = { schemaVersion: 2, allowed: [routeB, routeA] };
  assert.deepEqual(planRouteAuthorityState(tuples), {
    schemaVersion: 2, mode: 'tuple', dispatchable: true,
    routeCount: 2, allowed: [routeA, routeB], reason: null,
  });
  assert.equal(planSingleExactRoute(tuples), null);
  assert.equal(planRouteMatches(tuples, dispatchRoute(routeA)), true);
  assert.equal(planRouteMatches(tuples, {
    vendor: routeA.harness, model: routeB.model, effort: routeB.effort,
  }), false);

  const singleton = { harnesses: [routeA.harness], models: [routeA.model], efforts: [routeA.effort] };
  assert.equal(planRouteAuthorityState(singleton).mode, 'legacy_singleton');
  assert.deepEqual(planSingleExactRoute(singleton), routeA);
  assert.equal(planRouteMatches(singleton, routeA), true);

  const ambiguous = {
    harnesses: [routeA.harness, routeB.harness],
    models: [routeA.model, routeB.model], efforts: [routeA.effort, routeB.effort],
  };
  const state = planRouteAuthorityState(ambiguous);
  assert.equal(state.mode, 'legacy_ambiguous');
  assert.equal(state.dispatchable, false);
  assert.deepEqual(state.allowed, []);
  assert.equal(planSingleExactRoute(ambiguous), null);
  const mash = { vendor: routeA.harness, model: routeB.model, effort: routeB.effort };
  assert.equal(planRouteMatches(ambiguous, mash), false);
  assert.equal(planRouteMatches(ambiguous, mash, { historical: true }), true);
});

test('PR88-3: fresh legacy singleton promotes to v2 while fresh ambiguous axes are refused', () => {
  assert.deepEqual(normalizeRoutes({
    harnesses: [routeA.harness], models: [routeA.model], efforts: [routeA.effort],
  }), { schemaVersion: 2, allowed: [routeA] });
  assert.throws(() => normalizeRoutes({
    harnesses: [routeA.harness, routeB.harness],
    models: [routeA.model, routeB.model], efforts: [routeA.effort, routeB.effort],
  }), (error) => error.code === 'plan_route_authority_legacy_ambiguous');
});

test('PR88-4: v2 Plan route schema is closed, unique, nonempty, and policy-bounded', () => {
  const invalid = [
    { schemaVersion: 2, allowed: [] },
    { schemaVersion: 2, allowed: [routeA, routeA] },
    { schemaVersion: 2, allowed: [{ ...routeA, extra: true }] },
    { schemaVersion: 2, allowed: [{ vendor: routeA.harness, model: routeA.model, effort: routeA.effort }] },
    { schemaVersion: 2, allowed: [routeA], extra: true },
    { schemaVersion: 3, allowed: [routeA] },
    { schemaVersion: 2, allowed: Array.from({ length: 5 }, (_, index) => ({
      harness: `h-${index}`, model: `m-${index}`, effort: `e-${index}`,
    })) },
  ];
  for (const routes of invalid) {
    assert.throws(() => normalizeRoutes(routes), (error) => error.code === 'plan_route_invalid');
  }
});

test('PR88-5: live dispatch authorizes exact tuple membership and refuses Cartesian widening without a write', () => {
  const directory = root('live');
  const { store, goal, plan } = defineApprovedPlan(directory, {
    schemaVersion: 2, allowed: [routeA, routeB],
  }, 'live');
  const gate = gateFor(goal, plan);
  assert.equal(store.previewPlanDispatch(gate, dispatchRoute(routeA)).node.key, 'work');
  assert.equal(store.previewPlanDispatch(gate, dispatchRoute(routeB)).node.key, 'work');
  const before = store.snapshot().lastSeq;
  assert.throws(() => store.previewPlanDispatch(gate, {
    vendor: routeA.harness, model: routeB.model, effort: routeB.effort,
  }), (error) => error.code === 'plan_route_mismatch');
  assert.equal(store.snapshot().lastSeq, before);
  assert.equal(store.snapshot().goalPlan.dispatches.length, 0);

  const route = dispatchRoute(routeA);
  const preview = store.previewPlanDispatch(gate, route);
  const fields = taskFields(preview, route);
  const dispatchAuth = auth('dispatcher', 'dispatch:live');
  const created = store.createPlanGatedTask(fields, gate, route, dispatchAuth);
  assert.equal(created.result, 'created');
  const after = store.snapshot().lastSeq;
  assert.equal(store.createPlanGatedTask(fields, gate, route, dispatchAuth).result, 'idempotent');
  assert.equal(store.snapshot().lastSeq, after);
  assert.throws(
    () => store.createPlanGatedTask(fields, gate, dispatchRoute(routeB), dispatchAuth),
    (error) => error.code === 'plan_dispatch_conflict',
  );
  assert.equal(store.snapshot().lastSeq, after);
  store.releaseWriterLease();
});

test('PR88-6: historical ambiguous legacy Plan replays for observation but quarantines every new dispatch', () => {
  const directory = root('legacy-replay');
  const created = defineApprovedPlan(directory, {
    schemaVersion: 2, allowed: [routeA, routeB],
  }, 'legacy-replay');
  const goal = structuredClone(created.goal);
  created.store.releaseWriterLease();
  const rewritten = rewritePlanAsAmbiguousLegacy(directory);

  const replay = new CoordinationStore(directory, { goalPlanPolicy: policy, clock: () => NOW });
  const status = replay.goalPlanStatus({
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: rewritten.plan.planId, planVersion: rewritten.plan.version,
    planDigest: rewritten.plan.digest, throughSeq: null,
  }, { repoId: REPO_ID, runId: null });
  assert.equal(status.approval.disposition, 'approved');
  assert.equal(status.nodes[0].state, 'ready');
  const gate = gateFor(goal, rewritten.plan);
  const before = replay.snapshot().lastSeq;
  for (const route of [
    dispatchRoute(routeA), dispatchRoute(routeB),
    { vendor: routeA.harness, model: routeB.model, effort: routeB.effort },
  ]) {
    assert.throws(
      () => replay.previewPlanDispatch(gate, route),
      (error) => error.code === 'plan_route_authority_legacy_ambiguous',
    );
  }
  assert.equal(replay.snapshot().lastSeq, before);
  assert.equal(replay.snapshot().goalPlan.dispatches.length, 0);
  replay.releaseWriterLease();
});

test('PR88-7: an already-admitted ambiguous legacy dispatch replays only its exact historical transaction', () => {
  const directory = root('legacy-admitted');
  const mash = { harness: routeA.harness, model: routeB.model, effort: routeB.effort };
  const created = defineApprovedPlan(directory, {
    schemaVersion: 2, allowed: [routeA, routeB, mash],
  }, 'legacy-admitted');
  const gate = gateFor(created.goal, created.plan);
  const route = dispatchRoute(mash);
  const preview = created.store.previewPlanDispatch(gate, route);
  const fields = taskFields(preview, route, 'phase88-legacy-admitted');
  const dispatchAuth = auth('dispatcher', 'dispatch:legacy-admitted');
  assert.equal(created.store.createPlanGatedTask(fields, gate, route, dispatchAuth).result, 'created');
  created.store.releaseWriterLease();

  const rewritten = rewritePlanAsAmbiguousLegacy(directory);
  assert.ok(rewritten.historical);
  const replay = new CoordinationStore(directory, { goalPlanPolicy: policy, clock: () => NOW });
  const before = replay.snapshot().lastSeq;
  assert.equal(replay.createPlanGatedTask(
    rewritten.historical.task, rewritten.historical.gate,
    rewritten.historical.route, rewritten.historical.auth,
  ).result, 'idempotent');
  assert.equal(replay.snapshot().lastSeq, before);
  assert.throws(() => replay.createPlanGatedTask(
    rewritten.historical.task, rewritten.historical.gate,
    dispatchRoute(routeA), rewritten.historical.auth,
  ), (error) => error.code === 'plan_dispatch_conflict');
  assert.equal(replay.snapshot().lastSeq, before);
  assert.equal(replay.snapshot().goalPlan.dispatches.length, 1);
  replay.releaseWriterLease();
});
