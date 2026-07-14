import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, MockAdapter, WebNorthbound, createDriver } from '../src/index.mjs';

const ORIGIN = 'https://control.example.test';
const REPO = 'repo-a';
const RUN = 'run-a';
const digest = (character) => character.repeat(64);
const goal = Object.freeze({ goalId: `goal:${digest('a')}`, version: 1, digest: digest('b') });
const plan = Object.freeze({ planId: `plan:${digest('c')}`, version: 1, digest: digest('d') });
const budget = Object.freeze({ tokens: 10_000, usd: 2, wallMin: 10, providerTurns: 8 });
const verification = Object.freeze({ command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [] });
const node = Object.freeze({
  key: 'implement', objective: 'Implement the approved slice', definitionOfDone: ['tests pass'], deps: [],
  pathScope: ['impl/**'], risk: 'high', budget, verification,
  routes: { harnesses: ['mock'], models: ['model-exact'], efforts: ['low'] },
  capabilities: ['code', 'test'], effects: ['repository_edit'],
});

const principal = (powers) => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'credential-1', authMethod: 'cookie',
  csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: powers, repoIds: [REPO],
});
const context = (powers) => ({ principal: principal(powers), origin: ORIGIN, csrfToken: 'csrf-1', transport: 'https' });
const envelope = (command, args, suffix) => ({
  schemaVersion: 1, commandId: `command-${suffix}`, idempotencyKey: `client-${suffix}`,
  command, args, repoId: REPO, runId: RUN, origin: ORIGIN,
});
const goalArgs = () => ({
  objective: 'Ship the web authority', definitionOfDone: ['tests pass'], constraints: ['No network'],
  risk: 'high', budget: { ...budget }, predecessor: null,
});
const planArgs = () => ({ goal: { ...goal }, predecessor: null, nodes: [{ ...node, budget: { ...budget }, verification: { ...verification }, routes: { ...node.routes } }] });
const approvalArgs = () => ({ goal: { ...goal }, plan: { ...plan }, expectedDisposition: null, disposition: 'approved' });
const statusArgs = () => ({
  goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
  planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, throughSeq: null,
});

function fixture(coordinator = {}) {
  const calls = [];
  const methods = {
    async defineGoal(request, auth) { calls.push({ operation: 'goal_define', request, auth }); return { goal: { ...goal, principalId: 'private-goal-principal' }, event: { payload: { goal: { principalId: 'private-nested-goal-principal' } } } }; },
    async proposePlan(request, auth) { calls.push({ operation: 'plan_propose', request, auth }); return { plan: { ...plan, proposerPrincipalId: 'private-plan-principal' }, event: { payload: { plan: { proposerPrincipalId: 'private-nested-plan-principal' } } } }; },
    async approvePlan(request, auth) { calls.push({ operation: 'plan_approve', request, auth }); return { approval: { disposition: 'approved', principalId: 'private-approval-principal', sessionDigest: digest('e') }, event: { payload: { approval: { principalId: 'private-nested-approval-principal', sessionDigest: digest('f') } } } }; },
    async goalPlanStatus(request, auth) { calls.push({ operation: 'goal_plan_status', request, auth }); return { goal: { ...goal }, plan: { ...plan }, nodes: [] }; },
    async spawn(harness, brief, opts) { calls.push({ operation: 'spawn', harness, brief, opts }); return { id: 'worker-1', taskId: opts.taskId }; },
    ...coordinator,
  };
  const coordination = new CoordinationStore(mkdtempSync(join(tmpdir(), 'baton-phase62-web-')));
  const web = new WebNorthbound({
    coordinator: methods, coordination, repoIds: [REPO], allowedOrigins: [ORIGIN],
    now: () => Date.parse('2026-07-13T12:00:00.000Z'),
  });
  return { web, coordination, calls };
}

function realWebDriver() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-phase62-web-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'phase62@example.invalid'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Phase 62'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repoRoot });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 1, summary: 'done', files: {} } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...baseCard(), modelSelection: { mode: 'exact', configuredDefault: 'model-exact', available: ['model-exact'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  const authorityPolicy = {
    schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 60 * 60 * 1000,
    riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
    limits: { maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024, maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10_000 },
  };
  return createDriver({ repoRoot, repoId: REPO, logDir: mkdtempSync(join(tmpdir(), 'baton-phase62-web-log-')), adapters: { mock: adapter }, goalPlanAuthority: { policy: authorityPolicy, authorize: async () => true } });
}

test('GP1/GP4/GP7: web goal and plan commands bind separate powers and transport-derived authority', async () => {
  const { web, calls } = fixture();
  const cases = [
    ['goal_define', goalArgs(), 'goal:define'],
    ['plan_propose', planArgs(), 'plan:propose'],
    ['plan_approve', approvalArgs(), 'plan:approve'],
    ['goal_plan_status', statusArgs(), 'goal:observe'],
  ];
  for (const [command, args, power] of cases) {
    const suffix = command.replaceAll('_', '-');
    const refused = await web.execute(context(['observe']), envelope(command, args, `refused-${suffix}`));
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    const accepted = await web.execute(context([power]), envelope(command, args, suffix));
    assert.equal(accepted.status, 200);
    if (command !== 'goal_plan_status') assert.doesNotMatch(JSON.stringify(accepted.body), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest|private-/);
  }
  assert.equal(calls.length, 4);
  for (const [index, call] of calls.entries()) {
    const [command, args, power] = cases[index];
    assert.equal(call.operation, command);
    assert.deepEqual(call.request, args);
    assert.deepEqual(call.auth, {
      actor: 'web:user-1:session-1', principalId: 'user-1', sessionId: 'session-1', powers: [power],
      repoId: REPO, runId: RUN, idempotencyKey: `web.command:command-${command.replaceAll('_', '-')}`,
    });
  }
});

test('GP5/GP7: plan-gated web spawn forwards one closed gate and transport-derived dispatch powers', async () => {
  const { web, calls } = fixture();
  const goalPlan = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const brief = { goal: node.objective, constraints: ['No network'], pathScope: ['impl/**'], definitionOfDone: 'tests pass', verification: { ...verification }, budget: { tokens: 10_000, usd: 2, wallMin: 10 } };
  const response = await web.execute(context(['control', 'plan:dispatch']), envelope('spawn', {
    harness: 'mock', model: 'model-exact', effort: 'low', brief, goalPlan,
  }, 'planned-spawn'));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].opts.goalPlan, goalPlan);
  assert.deepEqual(calls[0].opts.capabilities, ['code', 'test']);
  assert.deepEqual(calls[0].opts.effects, ['repository_edit']);
  assert.equal(calls[0].opts.principalId, 'user-1');
  assert.equal(calls[0].opts.sessionId, 'session-1');
  assert.deepEqual(calls[0].opts.powers, ['control', 'plan:dispatch']);
  assert.equal(calls[0].opts.actor, 'web:user-1:session-1');
});

test('GP5/GP7/GP8: authenticated web rejects conflicting plan-owned Brief fields before task dispatch', async () => {
  const driver = realWebDriver();
  const direct = (principalId, powers, idempotencyKey) => ({ actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers, repoId: REPO, runId: RUN, idempotencyKey });
  const { goal: approvedGoal } = await driver.coordinator.defineGoal(goalArgs(), direct('owner', ['goal:define'], 'goal:web-conflicts'));
  const proposed = await driver.coordinator.proposePlan({
    goal: { goalId: approvedGoal.goalId, version: approvedGoal.version, digest: approvedGoal.digest }, predecessor: null,
    nodes: [{ ...node, budget: { ...budget }, verification: { ...verification }, routes: { ...node.routes } }],
  }, direct('planner', ['plan:propose'], 'plan:web-conflicts'));
  const approvedPlan = proposed.plan;
  await driver.coordinator.approvePlan({
    goal: { goalId: approvedGoal.goalId, version: approvedGoal.version, digest: approvedGoal.digest },
    plan: { planId: approvedPlan.planId, version: approvedPlan.version, digest: approvedPlan.digest }, expectedDisposition: null, disposition: 'approved',
  }, direct('approver', ['plan:approve'], 'approval:web-conflicts'));
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: [REPO], allowedOrigins: [ORIGIN], now: () => Date.parse('2026-07-13T12:00:00.000Z') });
  const gate = {
    goalId: approvedGoal.goalId, goalVersion: approvedGoal.version, goalDigest: approvedGoal.digest,
    planId: approvedPlan.planId, planVersion: approvedPlan.version, planDigest: approvedPlan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const matchingBrief = { goal: node.objective, constraints: ['No network'], pathScope: ['impl/**'], definitionOfDone: 'tests pass', verification: { ...verification }, budget: { tokens: 10_000, usd: 2, wallMin: 10 } };
  for (const [index, conflict] of [{ providerTurns: 7 }, { capabilities: ['code'] }, { effects: [] }].entries()) {
    const response = await web.execute(context(['control', 'plan:dispatch']), envelope('spawn', {
      harness: 'mock', model: 'model-exact', effort: 'low', taskId: `web-plan-conflict-${index}`,
      brief: { ...matchingBrief, ...conflict }, goalPlan: gate,
    }, `plan-conflict-${index}`));
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'plan_brief_mismatch');
  }
  assert.equal(driver.coordination.events().filter((event) => ['plan.node_dispatched', 'task.created'].includes(event.kind)).length, 0);
  await driver.drainAndClose('test');
});

test('GP3/GP4/GP6/GP7: authenticated web preserves risk floors, exact heads, and as-of stale status', async () => {
  const driver = realWebDriver();
  const direct = (principalId, powers, idempotencyKey) => ({ actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers, repoId: REPO, runId: RUN, idempotencyKey });
  const { goal: firstGoal } = await driver.coordinator.defineGoal(goalArgs(), direct('owner', ['goal:define'], 'goal:web-heads'));
  const planRequest = (predecessor, risk = 'high') => ({
    goal: { goalId: firstGoal.goalId, version: firstGoal.version, digest: firstGoal.digest }, predecessor,
    nodes: [{ ...node, risk, budget: { ...budget }, verification: { ...verification }, routes: { ...node.routes } }],
  });
  const { plan: firstPlan } = await driver.coordinator.proposePlan(planRequest(null), direct('planner', ['plan:propose'], 'plan:web-heads:1'));
  const approved = await driver.coordinator.approvePlan({
    goal: { goalId: firstGoal.goalId, version: firstGoal.version, digest: firstGoal.digest },
    plan: { planId: firstPlan.planId, version: firstPlan.version, digest: firstPlan.digest }, expectedDisposition: null, disposition: 'approved',
  }, direct('approver', ['plan:approve'], 'approval:web-heads:1'));
  const { plan: secondPlan } = await driver.coordinator.proposePlan(planRequest({ planId: firstPlan.planId, version: firstPlan.version, digest: firstPlan.digest }), direct('planner', ['plan:propose'], 'plan:web-heads:2'));
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination, repoIds: [REPO], allowedOrigins: [ORIGIN], now: () => Date.parse('2026-07-13T12:00:00.000Z') });

  const historical = await web.execute(context(['goal:observe']), envelope('goal_plan_status', {
    goalId: firstGoal.goalId, goalVersion: firstGoal.version, goalDigest: firstGoal.digest,
    planId: firstPlan.planId, planVersion: firstPlan.version, planDigest: firstPlan.digest, throughSeq: approved.event.seq,
  }, 'status-before-plan-supersession'));
  assert.equal(historical.status, 200); assert.equal(historical.body.result.nodes[0].state, 'ready');
  const current = await web.execute(context(['goal:observe']), envelope('goal_plan_status', {
    goalId: firstGoal.goalId, goalVersion: firstGoal.version, goalDigest: firstGoal.digest,
    planId: firstPlan.planId, planVersion: firstPlan.version, planDigest: firstPlan.digest, throughSeq: null,
  }, 'status-after-plan-supersession'));
  assert.equal(current.status, 200); assert.equal(current.body.result.nodes[0].state, 'stale');

  const beforeRisk = driver.coordination.events().filter((event) => event.kind.startsWith('plan.')).length;
  const risk = await web.execute(context(['plan:propose']), envelope('plan_propose', planRequest({ planId: secondPlan.planId, version: secondPlan.version, digest: secondPlan.digest }, 'low'), 'risk-floor'));
  assert.equal(risk.status, 400); assert.equal(risk.body.error.code, 'plan_risk_mismatch');
  assert.equal(driver.coordination.events().filter((event) => event.kind.startsWith('plan.')).length, beforeRisk);

  const staleApproval = await web.execute(context(['plan:approve']), envelope('plan_approve', {
    goal: { goalId: firstGoal.goalId, version: firstGoal.version, digest: firstGoal.digest },
    plan: { planId: firstPlan.planId, version: firstPlan.version, digest: firstPlan.digest }, expectedDisposition: null, disposition: 'approved',
  }, 'stale-plan-approval'));
  assert.equal(staleApproval.status, 409); assert.equal(staleApproval.body.error.code, 'plan_stale');

  await driver.coordinator.defineGoal({ ...goalArgs(), predecessor: { goalId: firstGoal.goalId, version: firstGoal.version, digest: firstGoal.digest } }, direct('owner', ['goal:define'], 'goal:web-heads:2'));
  const beforeGoalStale = driver.coordination.events().filter((event) => event.kind === 'plan.version_proposed').length;
  const staleGoal = await web.execute(context(['plan:propose']), envelope('plan_propose', planRequest({ planId: secondPlan.planId, version: secondPlan.version, digest: secondPlan.digest }), 'stale-goal-proposal'));
  assert.equal(staleGoal.status, 409); assert.equal(staleGoal.body.error.code, 'goal_stale');
  assert.equal(driver.coordination.events().filter((event) => event.kind === 'plan.version_proposed').length, beforeGoalStale);
  await driver.drainAndClose('test');
});

test('GP5/GP7/GP8: lost responses reconcile Goal/Plan mutations and gated spawn under the original admission identity', async () => {
  const cases = [
    ['goal_define', goalArgs(), ['goal:define']],
    ['plan_propose', planArgs(), ['plan:propose']],
    ['plan_approve', approvalArgs(), ['plan:approve']],
    ['spawn', {
      harness: 'mock', model: 'model-exact', effort: 'low',
      brief: { goal: node.objective, constraints: ['No network'], pathScope: ['impl/**'], definitionOfDone: 'tests pass', verification: { ...verification }, budget: { tokens: 10_000, usd: 2, wallMin: 10 } },
      goalPlan: {
        goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
        planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
        nodeKey: 'implement', expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'],
      },
    }, ['control', 'plan:dispatch']],
  ];
  for (const [command, args, powers] of cases) {
    const { web, coordination, calls } = fixture();
    const complete = coordination.completeWebCommand.bind(coordination);
    let loseResponse = true;
    coordination.completeWebCommand = (...values) => {
      if (loseResponse) { loseResponse = false; throw new Error('response append unavailable'); }
      return complete(...values);
    };
    const suffix = `lost-${command.replaceAll('_', '-')}`;
    const admitted = envelope(command, args, suffix);
    assert.equal((await web.execute(context(powers), admitted)).status, 503);
    assert.equal(coordination.webCommand(admitted.commandId).status, 'admitted');
    const retryPrincipal = { ...principal(powers), sessionId: 'session-retry' };
    const replay = await web.execute({ ...context(powers), principal: retryPrincipal }, { ...admitted, commandId: `${admitted.commandId}-retry` });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    if (command !== 'spawn') assert.doesNotMatch(JSON.stringify(replay.body), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest|private-/);
    assert.equal(calls.length, 2);
    const replayedCall = calls[1];
    const auth = command === 'spawn' ? replayedCall.opts : replayedCall.auth;
    assert.equal(auth.actor, 'web:user-1:session-1');
    assert.equal(auth.principalId, 'user-1');
    assert.equal(auth.sessionId, 'session-1');
    assert.deepEqual(auth.powers, powers);
    assert.equal(auth.idempotencyKey, `web.command:${admitted.commandId}`);
    if (command === 'spawn') assert.equal(replayedCall.opts.taskId, `web-${admitted.commandId}`);
    assert.equal(coordination.webCommand(admitted.commandId).status, 'completed');
    if (command !== 'spawn') {
      const completedReplay = await web.execute(context(powers), { ...admitted, commandId: `${admitted.commandId}-completed-retry` });
      assert.equal(completedReplay.status, 200);
      assert.equal(completedReplay.body.replayed, true);
      assert.doesNotMatch(JSON.stringify(completedReplay.body), /actor|idempotencyKey|principalId|proposerPrincipalId|sessionDigest|private-/);
      assert.equal(calls.length, 2);
    }
  }
});

test('GP8: an admitted ordinary non-plan spawn remains observable as 202 and is not redispatched', async () => {
  const { web, coordination, calls } = fixture();
  const complete = coordination.completeWebCommand.bind(coordination);
  let loseResponse = true;
  coordination.completeWebCommand = (...values) => {
    if (loseResponse) { loseResponse = false; throw new Error('response append unavailable'); }
    return complete(...values);
  };
  const admitted = envelope('spawn', {
    harness: 'mock', brief: { goal: 'ordinary task', constraints: [], pathScope: [], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100, usd: 0, wallMin: 1 } },
  }, 'ordinary-lost');
  assert.equal((await web.execute(context(['control']), admitted)).status, 503);
  const replay = await web.execute(context(['control']), { ...admitted, commandId: 'command-ordinary-retry' });
  assert.equal(replay.status, 202);
  assert.equal(replay.body.commandId, admitted.commandId);
  assert.equal(replay.body.replayed, true);
  assert.equal(calls.length, 1);
  assert.equal(coordination.webCommand(admitted.commandId).status, 'admitted');
});

test('GP7/GP8: closed nested schemas and typed non-leaking goal/plan failures refuse safely', async () => {
  const marker = 'private goal authority detail';
  const { web, coordination, calls } = fixture({
    async defineGoal() { throw Object.assign(new Error(marker), { code: 'goal_weakened' }); },
  });
  const malformed = [
    envelope('goal_define', { ...goalArgs(), actor: 'forged' }, 'goal-actor'),
    envelope('plan_propose', { ...planArgs(), nodes: [{ ...planArgs().nodes[0], eventKind: 'task.created' }] }, 'plan-event'),
    envelope('plan_approve', { ...approvalArgs(), plan: { ...plan, credential: 'forged' } }, 'approval-credential'),
    envelope('goal_plan_status', { ...statusArgs(), throughSeq: -1 }, 'status-bound'),
  ];
  for (const request of malformed) {
    const power = { goal_define: 'goal:define', plan_propose: 'plan:propose', plan_approve: 'plan:approve', goal_plan_status: 'goal:observe' }[request.command];
    const response = await web.execute(context([power]), request);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'invalid_command');
  }
  assert.equal(calls.length, 0);
  assert.equal(coordination.events().some((event) => event.kind === 'web.command_admitted'), false);

  const weakened = await web.execute(context(['goal:define']), envelope('goal_define', goalArgs(), 'weakened'));
  assert.equal(weakened.status, 409);
  assert.equal(weakened.body.error.code, 'goal_weakened');
  assert.equal(JSON.stringify(weakened).includes(marker), false);
});
